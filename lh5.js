/**
 * LH5 decompression implementation
 * Based on the unpack reference implementation
 * Faithfully ported from io.c, huf.c, maketbl.c, decode.c
 */

// Constants from ar.h
const DICBIT = 13;
const DICSIZ = (1 << DICBIT);
const MATCHBIT = 8;
const MAXMATCH = 256;
const THRESHOLD = 3;
const CODE_BIT = 16;
const CHAR_BIT = 8;
const UCHAR_MAX = 255;
const NC = UCHAR_MAX + MAXMATCH + 2 - THRESHOLD;
const CBIT = 9;
const BITBUFSIZ = 32;  // CHAR_BIT * sizeof(uint) = 32

// Huffman coding parameters
const H_NP = DICBIT + 1;   // 14
const H_NT = CODE_BIT + 3; // 19
const PBIT = 4;
const TBIT = 5;
const NPT = H_NT > H_NP ? H_NT : H_NP;

/**
 * LH5 Decoder - faithful port of unpack reference implementation
 */
class LH5Decoder {
    constructor() {
        // Bitstream state (from io.c)
        this.bitbuf = 0;       // uint bitbuf
        this.subbitbuf = 0;    // static uint subbitbuf
        this.bitcount = 0;     // static int bitcount
        this.compsize = 0;
        this.origsize = 0;

        // Huffman tables (from huf.c)
        this.left = new Uint16Array(2 * NC - 1);
        this.right = new Uint16Array(2 * NC - 1);
        this.c_len = new Uint8Array(NC);
        this.pt_len = new Uint8Array(NPT);
        this.c_table = new Uint16Array(4096);   // tablebits=12
        this.pt_table = new Uint16Array(256);    // tablebits=8
        this.blocksize = 0;

        // Decode state (from decode.c)
        this.dtext = new Uint8Array(DICSIZ);     // sliding window
        this.r = 0;              // write position in sliding window
        this.decode_j = 0;       // remaining match bytes (static int j)
        this.decode_i = 0;       // match source position (static uint i)

        // File data
        this.fileData = null;
        this.filePos = 0;
    }

    /**
     * Initialize decoder with file data
     */
    init(fileData, startPos, compsize, origsize) {
        if (!fileData || fileData.length === 0) {
            throw new Error('LH5: 入力データが空です');
        }
        if (startPos < 0 || startPos >= fileData.length) {
            throw new Error(`LH5: 開始位置が不正です: ${startPos}`);
        }
        this.fileData = fileData;
        this.filePos = startPos;
        this.compsize = compsize;
        this.origsize = origsize;

        // Reset decode state (decode_start)
        this.blocksize = 0;
        this.r = 0;
        this.decode_j = 0;
        this.decode_i = 0;
        this.dtext.fill(0);

        // Reset Huffman tables
        this.left.fill(0);
        this.right.fill(0);
        this.c_len.fill(0);
        this.pt_len.fill(0);
        this.c_table.fill(0);
        this.pt_table.fill(0);

        // init_getbits (io.c:140-144)
        this.bitbuf = 0;
        this.subbitbuf = 0;
        this.bitcount = 0;
        this.fillbuf(BITBUFSIZ);
    }

    /**
     * Port of fillbuf(int n) from io.c:48-70
     * Shift bitbuf n bits left, read n bits
     */
    fillbuf(n) {
        this.bitbuf = (n < 32) ? (this.bitbuf << n) : 0;
        while (n > this.bitcount) {
            n -= this.bitcount;
            this.bitbuf |= (n < 32) ? (this.subbitbuf << n) : 0;
            if (this.compsize > 0) {
                this.compsize--;
                this.subbitbuf = this.fileData[this.filePos++] & 0xFF;
            } else {
                this.subbitbuf = 0;
            }
            this.bitcount = CHAR_BIT;
        }
        this.bitbuf |= this.subbitbuf >>> (this.bitcount -= n);
    }

    /**
     * Port of getbits(int n) from io.c:72-89
     */
    getbits(n) {
        const sh = BITBUFSIZ - n;
        const x = (sh >= 32) ? 0 : this.bitbuf >>> sh;
        this.fillbuf(n);
        return x;
    }

    /**
     * Port of make_table() from maketbl.c:7-65
     * Builds decoding table with tree traversal for long codes
     */
    make_table(nchar, bitlen, tablebits, table) {
        const count = new Uint16Array(17);
        const weight = new Uint16Array(17);
        const start = new Uint32Array(18);

        for (let i = 1; i <= 16; i++) count[i] = 0;
        for (let i = 0; i < nchar; i++) count[bitlen[i]]++;

        start[1] = 0;
        for (let i = 1; i <= 16; i++) {
            start[i + 1] = start[i] + (count[i] << (16 - i));
        }
        if ((start[17] & 0xFFFF) !== 0) {
            console.error(`make_table: Bad table (start[17]=${start[17]})`);
            return;
        }

        const jutbits = 16 - tablebits;
        for (let i = 1; i <= tablebits; i++) {
            start[i] >>>= jutbits;
            weight[i] = 1 << (tablebits - i);
        }
        for (let i = tablebits + 1; i <= 16; i++) {
            weight[i] = 1 << (16 - i);
        }

        let i = start[tablebits + 1] >>> jutbits;
        if ((i & 0xFFFF) !== 0) {
            const k = 1 << tablebits;
            while (i < k) table[i++] = 0;
        }

        let avail = nchar;
        const mask = 1 << (15 - tablebits);
        for (let ch = 0; ch < nchar; ch++) {
            const len = bitlen[ch];
            if (len === 0) continue;
            const nextcode = start[len] + weight[len];
            if (len <= tablebits) {
                for (let ii = start[len]; ii < nextcode; ii++) {
                    table[ii] = ch;
                }
            } else {
                // Tree traversal for codes longer than tablebits
                // In C, p is a pointer that traverses table[], left[], right[]
                // In JS, we track the array and index separately
                let k = start[len];
                let pArr = table;              // which array p points into
                let pIdx = k >>> jutbits;      // index within that array
                let ii = len - tablebits;
                while (ii !== 0) {
                    if (pArr[pIdx] === 0) {
                        this.right[avail] = this.left[avail] = 0;
                        pArr[pIdx] = avail++;
                    }
                    const nodeIdx = pArr[pIdx];
                    if (k & mask) {
                        pArr = this.right;
                    } else {
                        pArr = this.left;
                    }
                    pIdx = nodeIdx;
                    k <<= 1;
                    ii--;
                }
                pArr[pIdx] = ch;
            }
            start[len] = nextcode;
        }
    }

    /**
     * Port of read_pt_len() from huf.c:213-242
     */
    read_pt_len(nn, nbit, i_special) {
        const n = this.getbits(nbit);
        if (n === 0) {
            const c = this.getbits(nbit);
            for (let i = 0; i < nn; i++) this.pt_len[i] = 0;
            for (let i = 0; i < 256; i++) this.pt_table[i] = c;
        } else {
            let i = 0;
            while (i < n) {
                // Peek top 3 bits without consuming
                let c = this.bitbuf >>> (BITBUFSIZ - 3);
                if (c === 7) {
                    let mask = 1 << (BITBUFSIZ - 1 - 3);
                    while (mask & this.bitbuf) {
                        mask >>>= 1;
                        c++;
                    }
                }
                this.fillbuf((c < 7) ? 3 : c - 3);
                this.pt_len[i++] = c;
                if (i === i_special) {
                    let cc = this.getbits(2);
                    while (--cc >= 0) this.pt_len[i++] = 0;
                }
            }
            while (i < nn) this.pt_len[i++] = 0;
            this.make_table(nn, this.pt_len, 8, this.pt_table);
        }
    }

    /**
     * Port of read_c_len() from huf.c:244-278
     */
    read_c_len() {
        const n = this.getbits(CBIT);
        if (n === 0) {
            const c = this.getbits(CBIT);
            for (let i = 0; i < NC; i++) this.c_len[i] = 0;
            for (let i = 0; i < 4096; i++) this.c_table[i] = c;
        } else {
            let i = 0;
            while (i < n) {
                // PT table lookup with tree traversal
                let c = this.pt_table[this.bitbuf >>> (BITBUFSIZ - 8)];
                if (c >= H_NT) {
                    let mask = 1 << (BITBUFSIZ - 1 - 8);
                    do {
                        if (this.bitbuf & mask) c = this.right[c];
                        else                    c = this.left[c];
                        mask >>>= 1;
                    } while (c >= H_NT);
                }
                this.fillbuf(this.pt_len[c]);
                if (c <= 2) {
                    if (c === 0) {
                        c = 1;
                    } else if (c === 1) {
                        c = this.getbits(4) + 3;
                    } else {
                        c = this.getbits(CBIT) + 20;
                    }
                    while (--c >= 0) this.c_len[i++] = 0;
                } else {
                    this.c_len[i++] = c - 2;
                }
            }
            while (i < NC) this.c_len[i++] = 0;
            this.make_table(NC, this.c_len, 12, this.c_table);
        }
    }

    /**
     * Port of decode_c() from huf.c:280-303
     */
    decode_c() {
        if (this.blocksize === 0) {
            this.blocksize = this.getbits(16);
            this.read_pt_len(H_NT, TBIT, 3);
            this.read_c_len();
            this.read_pt_len(H_NP, PBIT, -1);
        }
        this.blocksize--;

        // C table lookup with tree traversal
        let j = this.c_table[this.bitbuf >>> (BITBUFSIZ - 12)];
        if (j >= NC) {
            let mask = 1 << (BITBUFSIZ - 1 - 12);
            do {
                if (this.bitbuf & mask) j = this.right[j];
                else                    j = this.left[j];
                mask >>>= 1;
            } while (j >= NC);
        }
        this.fillbuf(this.c_len[j]);
        return j;
    }

    /**
     * Port of decode_p() from huf.c:305-322
     */
    decode_p() {
        // PT table lookup with tree traversal
        let j = this.pt_table[this.bitbuf >>> (BITBUFSIZ - 8)];
        if (j >= H_NP) {
            let mask = 1 << (BITBUFSIZ - 1 - 8);
            do {
                if (this.bitbuf & mask) j = this.right[j];
                else                    j = this.left[j];
                mask >>>= 1;
            } while (j >= H_NP);
        }
        this.fillbuf(this.pt_len[j]);
        if (j !== 0) {
            j = (1 << (j - 1)) + this.getbits(j - 1);
        }
        return j;
    }

    /**
     * Port of decode() from decode.c:16-50
     * Adapted: uses internal dtext[] as sliding window since
     * tad.js passes small buffers (not DICSIZ-sized)
     */
    decode(count, buffer) {
        let outPos = 0;

        // Complete pending match copy from previous call (static j)
        while (this.decode_j > 0) {
            this.dtext[this.r] = this.dtext[this.decode_i];
            this.decode_i = (this.decode_i + 1) & (DICSIZ - 1);
            buffer[outPos] = this.dtext[this.r];
            this.r = (this.r + 1) & (DICSIZ - 1);
            this.decode_j--;
            if (++outPos === count) return count;
        }

        for (;;) {
            const c = this.decode_c();
            if (c <= UCHAR_MAX) {
                this.dtext[this.r] = c;
                buffer[outPos] = c;
                this.r = (this.r + 1) & (DICSIZ - 1);
                if (++outPos === count) return count;
            } else {
                this.decode_j = c - (UCHAR_MAX + 1 - THRESHOLD);
                this.decode_i = (this.r - this.decode_p() - 1) & (DICSIZ - 1);
                while (this.decode_j > 0) {
                    this.dtext[this.r] = this.dtext[this.decode_i];
                    this.decode_i = (this.decode_i + 1) & (DICSIZ - 1);
                    buffer[outPos] = this.dtext[this.r];
                    this.r = (this.r + 1) & (DICSIZ - 1);
                    this.decode_j--;
                    if (++outPos === count) return count;
                }
            }
        }
    }
}


// Export classes and constants to global scope for browser compatibility
if (typeof window !== 'undefined') {
    window.LH5Decoder = LH5Decoder;

    // Export constants for use in tad.js
    window.DICBIT = DICBIT;
    window.DICSIZ = DICSIZ;
    window.MATCHBIT = MATCHBIT;
    window.MAXMATCH = MAXMATCH;
    window.THRESHOLD = THRESHOLD;
    window.CODE_BIT = CODE_BIT;
    window.CHAR_BIT = CHAR_BIT;
    window.UCHAR_MAX = UCHAR_MAX;
    window.NC = NC;
    window.CBIT = CBIT;
    window.BITBUFSIZ = BITBUFSIZ;
    window.H_NP = H_NP;
    window.H_NT = H_NT;
    window.PBIT = PBIT;
    window.TBIT = TBIT;
    window.NPT = NPT;
}
