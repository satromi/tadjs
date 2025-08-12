/**
 * LH5 decompression implementation
 * Based on the LHA compression algorithm
 */

(function() {
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
const BITBUFSIZ = 16;

// Huffman coding parameters
const NT = CODE_BIT + 3;
const TBIT = 5;
const NP = DICBIT + 1;
const PBIT = 4;

// If NT > NP, then NT is maximum
const NPT = NT > NP ? NT : NP;

class LH5Decoder {
    constructor() {
        this.left = new Uint16Array(2 * NC - 1);
        this.right = new Uint16Array(2 * NC - 1);
        this.c_len = new Uint8Array(NC);
        this.pt_len = new Uint8Array(NPT);
        this.c_table = new Uint16Array(4096);
        this.pt_table = new Uint16Array(256);
        
        this.bitbuf = 0;
        this.subbitbuf = 0;
        this.bitcount = 0;
        this.blocksize = 0;
        
        this.decode_i = 0;
        this.decode_j = 0;
        
        this.fileData = null;
        this.filePos = 0;
    }

    /**
     * Initialize decoder with file data
     */
    init(fileData, startPos) {
        this.fileData = fileData;
        this.filePos = startPos;
        this.bitbuf = 0;
        this.subbitbuf = 0;
        this.bitcount = 0;
        this.decode_i = 0;
        this.decode_j = 0;
        this.blocksize = 0;
        
        // Initialize bit buffer
        this.fillbuf(BITBUFSIZ);

    }

    /**
     * Fill bit buffer
     */
    fillbuf(n) {
        this.bitbuf = ((this.bitbuf << n) & 0xFFFF);
        
        while (n > this.bitcount) {
            this.bitbuf |= (this.subbitbuf << (n - this.bitcount)) & 0xFFFF;
            n -= this.bitcount;
            
            if (this.filePos < this.fileData.length) {
                this.subbitbuf = this.fileData[this.filePos++];
            } else {
                this.subbitbuf = 0;
            }
            this.bitcount = CHAR_BIT;
        }
        
        this.bitbuf |= (this.subbitbuf >>> (this.bitcount - n));
        this.bitbuf &= 0xFFFF;
        this.bitcount -= n;
    }

    /**
     * Get n bits from input
     */
    getbits(n) {
        const x = this.bitbuf >>> (BITBUFSIZ - n);
        this.fillbuf(n);
        return x & 0xFFFF;
    }

    /**
     * Make table for decoding
     */
    make_table(nchar, bitlen, tablebits, table) {
        const count = new Uint16Array(17);
        const weight = new Uint16Array(17);
        const start = new Uint32Array(18);  // Use 32-bit for overflow check
        
        // Initialize count
        for (let i = 1; i <= 16; i++) count[i] = 0;
        for (let i = 0; i < nchar; i++) count[bitlen[i]]++;
        
        // Calculate first code
        start[1] = 0;
        for (let i = 1; i <= 16; i++) {
            start[i + 1] = start[i] + (count[i] << (16 - i));
        }
        
        if (start[17] !== (1 << 16)) {
            console.log('make_table error:', {
                nchar,
                tablebits,
                count: Array.from(count),
                start: Array.from(start),
                expected: 1 << 16
            });
            throw new Error('Bad table');
        }
        
        // Shift data for make table
        const jutbits = 16 - tablebits;
        for (let i = 1; i <= tablebits; i++) {
            start[i] >>>= jutbits;
            weight[i] = 1 << (tablebits - i);
        }
        
        let i = tablebits + 1;
        while (i <= 16) {
            weight[i] = 1 << (16 - i);
            i++;
        }
        
        // Initialize table
        i = start[tablebits + 1] >>> jutbits;
        if (i !== (1 << 16)) {
            const k = 1 << tablebits;
            while (i < k) table[i++] = 0;
        }
        
        // Create table
        let avail = nchar;
        const mask = 1 << (15 - tablebits);
        
        for (let ch = 0; ch < nchar; ch++) {
            const len = bitlen[ch];
            if (len === 0) continue;
            
            const nextcode = (start[len] + weight[len]) & 0xFFFF;
            
            if (len <= tablebits) {
                // Short code
                for (let i = start[len]; i < nextcode; i++) {
                    table[i] = ch;
                }
            } else {
                // Long code
                let k = start[len];
                let p = k >>> jutbits;
                
                // Create tree
                let i = len - tablebits;
                while (i !== 0) {
                    if (table[p] === 0) {
                        this.right[avail] = this.left[avail] = 0;
                        table[p] = avail++;
                    }
                    
                    if (k & mask) {
                        p = this.right[table[p]];
                    } else {
                        p = this.left[table[p]];
                    }
                    k <<= 1;
                    i--;
                }
                table[p] = ch;
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
            for (let i = 0; i < 256; i++) {
                this.pt_table[i] = c;
            }
        } else {
            let i = 0;
            while (i < n) {
                let c = this.bitbuf >>> (BITBUFSIZ - 3);
                
                if (c === 7) {
                    let mask = 1 << (BITBUFSIZ - 1 - 3);
                    while ((this.bitbuf & mask) !== 0) {
                        mask >>>= 1;
                        c++;
                    }
                }
                
                this.fillbuf((c < 7) ? 3 : c - 3);
                
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
            
            this.make_table(nn, this.pt_len, 8, this.pt_table);
        }
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
            for (let i = 0; i < 4096; i++) {
                this.c_table[i] = c;
            }
        } else {
            let i = 0;
            while (i < n) {
                let c = this.pt_table[this.bitbuf >>> (BITBUFSIZ - 8)];
                
                if (c >= NT) {
                    let mask = 1 << (BITBUFSIZ - 1 - 8);
                    do {
                        if ((this.bitbuf & mask) !== 0) {
                            c = this.right[c];
                        } else {
                            c = this.left[c];
                        }
                        mask >>>= 1;
                    } while (c >= NT);
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
                    
                    while (--c >= 0) {
                        this.c_len[i++] = 0;
                    }
                } else {
                    this.c_len[i++] = c - 2;
                }
            }
            
            while (i < NC) {
                this.c_len[i++] = 0;
            }
            
            this.make_table(NC, this.c_len, 12, this.c_table);
        }
    }

    /**
     * Decode character
     */
    decode_c() {
        if (this.blocksize === 0) {
            this.blocksize = this.getbits(16);
            this.read_pt_len(NT, TBIT, 3);
            this.read_c_len();
            this.read_pt_len(NP, PBIT, -1);
        }
        
        this.blocksize--;
        let j = this.c_table[this.bitbuf >>> (BITBUFSIZ - 12)];
        
        if (j >= NC) {
            let mask = 1 << (BITBUFSIZ - 1 - 12);
            do {
                if ((this.bitbuf & mask) !== 0) {
                    j = this.right[j];
                } else {
                    j = this.left[j];
                }
                mask >>>= 1;
            } while (j >= NC);
        }
        
        this.fillbuf(this.c_len[j]);
        return j & 0xFFFF;
    }

    /**
     * Decode position
     */
    decode_p() {
        let j = this.pt_table[this.bitbuf >>> (BITBUFSIZ - 8)];
        
        if (j >= NP) {
            let mask = 1 << (BITBUFSIZ - 1 - 8);
            do {
                if ((this.bitbuf & mask) !== 0) {
                    j = this.right[j];
                } else {
                    j = this.left[j];
                }
                mask >>>= 1;
            } while (j >= NP);
        }
        
        this.fillbuf(this.pt_len[j]);
        
        if (j !== 0) {
            j = ((1 << (j - 1)) + this.getbits(j - 1)) & 0xFFFF;
        }
        
        return j;
    }

    /**
     * Decode specified number of bytes
     */
    decode(count, buffer) {
        let r = 0;
        let c = 0;
        
        while (count > 0) {
            if (this.decode_j === 0) {
                // Decode next character or match
                c = this.decode_c();
                
                if (c < 256) {
                    // Single character
                    buffer[r++] = c;
                    count--;
                } else {
                    // Match
                    this.decode_j = c - 256 + THRESHOLD;
                    this.decode_i = ((r - this.decode_p() - 1) & (DICSIZ - 1));
                }
            } else {
                // Copy from dictionary
                while (this.decode_j > 0 && count > 0) {
                    buffer[r] = buffer[this.decode_i];
                    this.decode_i = (this.decode_i + 1) & (DICSIZ - 1);
                    r++;
                    count--;
                    this.decode_j--;
                }
            }
        }
    }
}

// For non-module environments (when loaded via script tag)
if (typeof window !== 'undefined') {
    window.LH5Decoder = LH5Decoder;
}

})();