/**
 * LH5 decompression implementation
 * Based on the LHA compression algorithm
 * Ver0.01
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
const BITBUFSIZ = 31;

// Huffman coding parameters
const H_NP = DICBIT + 1;  // 14
const H_NT = CODE_BIT + 3; // 19
const PBIT = 4;
const TBIT = 5;
const NPT = H_NT > H_NP ? H_NT : H_NP;

/**
 * LH5 unified class - combines LH5Decoder and GlobalDecompressedStream
 */
class LH5Decoder {
    constructor() {
        // From original LH5Decoder
        this.bitbuf = 0;      // buffer
        this.bitremain = 0;   // Remaining bits in buffer
        this.compsize = 0;
        this.origsize = 0;
        this.crc = 0;
        
        // Huffman tables
        this.left = new Uint16Array(2 * NC - 1);
        this.right = new Uint16Array(2 * NC - 1);
        this.c_len = new Uint8Array(NC);
        this.pt_len = new Uint8Array(NPT);
        this.c_table = new Uint16Array(65536);
        this.pt_table = new Uint16Array(65536);
        
        // From GlobalDecompressedStream
        this.buffer = new Uint8Array(8192);
        this.rpos = 0;
        this.wpos = 0;
        this.pos = 0;
        this.blocksize = 0;
        
        // File data
        this.fileData = null;
        this.filePos = 0;
    }

    /**
     * Initialize decoder with file data
     */
    init(fileData, startPos, compsize, origsize) {
        this.fileData = fileData;
        this.filePos = startPos;
        this.compsize = compsize;
        this.origsize = origsize;
        
        // Reset stream state
        this.rpos = 0;
        this.wpos = 0;
        this.pos = 0;
        this.blocksize = 0;
        
        // Initialize bitstream
        this.init_getbits();
    }

    /**
     * Port of init_getbits() from io.c
     */
    init_getbits() {
        this.bitbuf = 0;
        this.bitremain = 0;
        this.fillbuf();
    }

    /**
     * fillbuf() implementation
     */
    fillbuf() {
        while (this.bitremain <= (BITBUFSIZ - CHAR_BIT)) {
            if (this.filePos >= this.fileData.length || this.compsize <= 0) {
                //console.debug("End of file in fillbuf - no more data available");
                return false;
            }
            
            const subbitbuf = this.fileData[this.filePos++] & 0xFF;
            this.compsize--;
            
            this.bitbuf |= (subbitbuf << (BITBUFSIZ - CHAR_BIT - this.bitremain)) & 0x7fffffff;
            this.bitremain += CHAR_BIT;
        }
        return true;
    }

    /**
     * Get bits from bitstream
     */
    getbits(n) {
        if (n > BITBUFSIZ) {
            console.error("getbits: len > 31 not supported");
            return 0;
        }
        
        if (!this.fillbuf()) {
            return 0; // EOF
        }
        
        const x = this.bitbuf >>> (BITBUFSIZ - n);
        
        this.bitbuf = (this.bitbuf << n) & 0x7fffffff;
        this.bitremain -= n;
        
        if (this.bitremain < 0) {
            console.warn(`bitremain went negative: ${this.bitremain}, len=${n}. Resetting to 0.`);
            this.bitremain = 0;
        }
        
        return x;
    }

    /**
     * Make table for decoding
     */
    make_table(nchar, bitlen, table) {
        const count = {};
        const start = {};

        for (let i = 0; i < nchar; i++) {
            const bitleni = bitlen[i];
            if (bitleni > 0) {
                count[bitleni] = (count[bitleni] || 0) + 1;
            }
        }
        
        start[1] = 0;
        for (let i = 1; i <= 16; i++) {
            const countI = count[i] || 0;
            start[i + 1] = start[i] + (countI << (16 - i));
        }

        if (start[17] !== 0x10000) {
            console.error(`FATAL: start[17]=${start[17]}, expected=65536`);
            
            // Fill table with zeros as fallback
            for (let i = 0; i < table.length; i++) {
                table[i] = 0;
            }
            return;
        }
        
        // Initialize table
        for (let i = 0; i < table.length; i++) {
            table[i] = 0;
        }
        
        for (let ch = 0; ch < nchar; ch++) {
            const len = bitlen[ch];
            if (len === 0) continue;
            
            let i = start[len];
            const nextcode = i + (1 << (16 - len));
            
            while (i < nextcode) {
                if (i >= 0 && i < table.length) {
                    table[i] = ch;
                }
                i++;
            }   
            start[len] = nextcode;
        }
    }

    /**
     * Read pattern length
     */
    read_pt_len(nn, nbit, i_special) {
        const n = this.getbits(nbit);
        
        if (n === 0) {
            const c = this.getbits(nbit);
            
            for (let i = 0; i < nn; i++) {
                this.pt_len[i] = 0;
            }
            
            for (let i = 0; i < 65536; i++) {
                this.pt_table[i] = c;
            }
            return;
        }
        
        let i = 0;
        while (i < n) {
            let c = this.getbits(3);
            if (c === 7) {
                while (this.getbits(1)) {
                    c++;
                }
            }
            
            this.pt_len[i++] = c;
            
            if (i === i_special) {
                let c = this.getbits(2);
                while (--c >= 0) {
                    this.pt_len[i++] = 0;
                }
            }
        }
        
        while (i < nn) {
            this.pt_len[i++] = 0;
        }
        
        this.make_table(nn, this.pt_len, this.pt_table);
    }

    /**
     * Read character length
     */
    read_c_len() {       
        const n = this.getbits(CBIT);
        
        if (n === 0) {
            const c = this.getbits(CBIT);
            
            for (let i = 0; i < NC; i++) {
                this.c_len[i] = 0;
            }

            for (let i = 0; i < 65536; i++) {
                this.c_table[i] = c;
            }
            return;
        }
        
        const c_len = [];
        let i = 0;
        let count;
        
        while (i < n) {
            const c = this.get_from_pt_table();
            
            if (c <= 2) {
                if (c === 0) {
                    count = 1;
                } else if (c === 1) {
                    count = this.getbits(4) + 3;
                } else if (c === 2) {
                    count = this.getbits(CBIT) + 20;
                }
                while (count-- > 0) {
                    c_len[i++] = 0;
                }
            } else {
                c_len[i++] = c - 2;
            }
        }
        
        while (i < NC) {
            c_len[i++] = 0;
        }
        
        for (let i = 0; i < NC; i++) {
            this.c_len[i] = c_len[i] || 0;
        }
        
        this.make_table(NC, this.c_len, this.c_table);
    }
    
    /**
     * Decode character from PT table
     */
    get_from_pt_table() {
        if (!this.fillbuf()) {
            return 0;
        }
        
        const tableIndex = this.bitbuf >>> (BITBUFSIZ - 16); // Get top 16 bits
        const val = this.pt_table[tableIndex] || 0;
        
        const bitLen = this.pt_len[val] || 0;
        if (bitLen > 0) {
            this.getbits(bitLen);
        }
        
        return val;
    }

    /**
     * decode_c() with better error handling
     */
    decode_c() {
        if (this.blocksize <= 0) {
            this.blocksize = this.getbits(16);
            
            if (this.blocksize === 0) {
                return false; // EOF
            }

            this.read_pt_len(H_NT, TBIT, 3);
            this.read_c_len();
            this.read_pt_len(H_NP, PBIT, -1);
        }
        
        this.blocksize--;

        if (!this.fillbuf()) {
            return UCHAR_MAX + 1; // EOF
        }
        
        const j = this.c_table[this.bitbuf >>> (BITBUFSIZ - 16)] || 0;
        
        const bitLen = this.c_len[j] || 0;
        if (bitLen > 0) {
            this.getbits(bitLen);
        } else {
            this.getbits(1); // Safety fallback
        }
        
        return j;
    }

    /**
     * Decode position
     */
    decode_p() {
        if (!this.fillbuf()) {
            return 0;
        }
        
        const j = this.pt_table[this.bitbuf >>> (BITBUFSIZ - 16)] || 0;
        
        const bitLen = this.pt_len[j] || 0;
        if (bitLen > 0) {
            this.getbits(bitLen);
        }
        
        if (j <= 1) {
            return j;
        }
        
        const extraBits = j - 1;
        if (extraBits > 0 && extraBits <= 16) {
            const result = ((1 << extraBits) + this.getbits(extraBits)) & 0xFFFF;
            return result;
        }
        
        return j;
    }

    /**
     * Read multiple bytes into buffer (unified with ub())
     */
    decode(length, buffer) {
        for (let i = 0; i < length; i++) {
            this.pos++;
            
            // Check if we have data in buffer
            if (this.wpos != this.rpos) {
                buffer[i] = this.buffer[this.rpos];
                this.rpos = (this.rpos + 1) & 0x1fff;
                continue;
            }
            
            // Get character/code from Huffman table
            const c = this.decode_c();
            
            if (c === false) {
                return i; // EOF - return actual bytes read
            }
            
            if (c <= UCHAR_MAX) {
                // Literal character
                this.buffer[this.wpos] = c;
                this.rpos = this.wpos = (this.wpos + 1) & 0x1fff;
                buffer[i] = c;
            } else {
                // LZ77 match: length and distance
                const decode_j = c - (UCHAR_MAX + 1 - THRESHOLD);
                
                // Copy matched data to buffer
                let decode_i = (this.wpos + 0x2000 - this.decode_p() - 1) & 0x1fff;
                for (let j = 0; j < decode_j; j++) {
                    this.buffer[this.wpos] = this.buffer[decode_i];
                    this.wpos = (this.wpos + 1) & 0x1fff;
                    decode_i = (decode_i + 1) & 0x1fff;
                }
                
                // Return first byte of the match
                buffer[i] = this.buffer[this.rpos];
                this.rpos = (this.rpos + 1) & 0x1fff;
            }
        }
        return length;
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