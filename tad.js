/**
 * 
 *   Copyright [2025] [satromi]
 *
 *   Licensed under the Apache License, Version 2.0 (the "License");
 *   you may not use this file except in compliance with the License.
 *   You may obtain a copy of the License at
 *
 *       http://www.apache.org/licenses/LICENSE-2.0
 *
 *   Unless required by applicable law or agreed to in writing, software
 *   distributed under the License is distributed on an "AS IS" BASIS,
 *   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *   See the License for the specific language governing permissions and
 *   limitations under the License.
 *
 * TADjs Ver0.02
 *
 * BTRONのドキュメント形式である文章TAD、図形TADをブラウザ上で表示するツールです
 * @link https://github.com/satromi/tadjs
 * @author satromi@gmail.com Tw  @satromi
 * @license https://www.apache.org/licenses/LICENSE-2.0 Apache-2.0
*/




// global
var ctx;
var canvas;
var textNest = 0;
var textCharList = new Array();
var textCharPoint = new Array();
var textCharData = new Array();
var imageNest = 0;
var imagePoint = new Array();
var textFontSize = 9.6;
var tronCodeMask = new Array();
var startTadSegment = false;
var startByImageSegment = false;
var tabCharNum = 4;
//var tabRulerLineMoveFlagOld = false;
var tabRulerLinePoint = 0;
var tabRulerLineMove = 0;
var tabRulerLinePos = 0;
//var tabRulerLineMoveNum = 0;
var tabRulerLineMoveCount = 0;
var tabRulerLineMovePoint = new Array();
var tabRulerLineMoveFlag = false;
var textFontSet = textFontSize + 'px serif';

var decodeArray;
var decodeData;

var tadRaw;
var tadRawBuffer;
var tadDataView;
var tadTextDump = '00000000 ';
var planeTextDump = '';
var tadPos = 0;

var textRow    = 0; // 行
var textColumn = 0; // 列
var textWidth = 0;
var textHeight = 0;

var tadDpiH = 72;
var tadDpiV = 72;
var tadDpiHFlag = false;
var tadDpiVFlag = false;

var LOCALHEADSIZE = 96;

const canvasW = 1500;
const canvasH = 1000;
const virtualW = 10000;
const virtualH = 10000;


// 特殊文字コードの定義
const TNULL	    	= 0x0000;
const TC_TAB	    = 0x0009;
const TC_NL		    = 0x000a;
const TC_NC	    	= 0x000b;
const TC_FF	    	= 0x000c;
const TC_CR	    	= 0x000d;
const TC_LANG   	= 0xfe00;
const TC_FDLM   	= 0xff21;        // パスの区切り
const TC_SPEC   	= 0xff00;
const TC_ESC    	= 0xff80;

// 言語/スクリプト指定の定義
const TSC_SYS	    = 0x0021;        // system script

// TAD 付箋/セグメントの定義(include/tad.h より引用)
const TS_INFO	    = 0xffe0;		// 管理情報セグメント
const TS_TEXT	    = 0xffe1;		// 文章開始セグメント
const TS_TEXTEND	= 0xffe2;		// 文章終了セグメント
const TS_FIG		= 0xffe3;		// 図形開始セグメント
const TS_FIGEND	    = 0xffe4;		// 図形終了セグメント
const TS_IMAGE	    = 0xffe5;		// 画像セグメント
const TS_VOBJ   	= 0xffe6;		// 仮身セグメント
const TS_DFUSEN 	= 0xffe7;		// 指定付箋セグメント
const TS_FFUSEN 	= 0xffe8;		// 機能付箋セグメント
const TS_SFUSEN 	= 0xffe9;		// 設定付箋セグメント

//文章付箋セグメントID
const TS_TPAGE  	= 0xffa0;		// 文章ページ割付け指定付箋
const TS_TRULER	    = 0xffa1;		// 行書式指定付箋
const TS_TFONT  	= 0xffa2;		// 文字指定付箋
const TS_TCHAR  	= 0xffa3;		// 特殊文字指定付箋
const TS_TATTR  	= 0xffa4;		// 文字割り付け指定付箋
const TS_TSTYLE 	= 0xffa5;		// 文字修飾指定付箋
const TS_TVAR   	= 0xffad;		// 変数参照指定付箋
const TS_TMEMO  	= 0xffae;		// 文章メモ指定付箋
const TS_TAPPL  	= 0xffaf;		// 文章アプリケーション指定付箋

// 図形付箋セグメントID
const TS_FPRIM  	= 0xffb0;		// 図形要素セグメント
const TS_FDEF   	= 0xffb1;		// データ定義セグメント
const TS_FGRP   	= 0xffb2;		// グループ定義セグメント
const TS_FMAC   	= 0xffb3;		// マクロ定義/参照セグメント
const TS_FATTR  	= 0xffb4;		// 図形修飾セグメント
const TS_FPAGE  	= 0xffb5;		// 図形ページ割り付け指定付箋
const TS_FMEMO  	= 0xffbe;		// 図形メモ指定付箋
const TS_FAPPL  	= 0xffbf;		// 図形アプリケーション指定付箋

// 書庫形式アプリケーションID
const packAppId1    = 0x8000;
const packAppId2    = 0xc003;
const packAppId3    = 0x8000;

// パック形式
const LH0           = 0;
const LH5           = 5;

// TAD関係
const VOBJ = 1;  // ルート実体

// Data structures
class PNT {
    constructor() {
        this.x = 0;  // H (16-bit)
        this.y = 0;  // H (16-bit)
    }
}

class RECT {
    constructor() {
        this.left = 0;    // H (16-bit)
        this.top = 0;     // H (16-bit)
        this.right = 0;   // H (16-bit)
        this.bottom = 0;  // H (16-bit)
    }
}

class STARTTEXTSEG {
    constructor() {
        this.view = new RECT();
        this.draw = new RECT();
        this.h_unit = 0;  // UNITS(UH)
        this.v_unit = 0;  // UNITS(UH)
        this.lang = 0;   // UH
        this.bpat = 0;  // UH
    }       
}

class STARTFIGSEG {
    constructor() {
        this.view = new RECT();
        this.draw = new RECT();
        this.h_unit = 0;  // UNITS(UH)
        this.v_unit = 0;  // UNITS(UH)
    }       
}

class STARTDRAWSEG {
    constructor() {
        this.view = new RECT();
        this.draw = new RECT();
        this.h_unit = 0;  // UNITS(UH)
        this.v_unit = 0;  // UNITS(UH)
    }
}

class DFUSENSEG {
    constructor() {
        this.view = new RECT();
        this.chsz = 0;  // CHSIZE (UH)
        this.frcol = [0, 0];  // UH[2]
        this.chcol = [0, 0];  // UH[2]
        this.tbcol = [0, 0];  // UH[2]
        this.pict = 0;  // UH
        this.appl = [0, 0, 0];  // UH[3]
        this.name = new Array(16).fill(0);  // TC[16]
        this.dlen = [0, 0];  // UH[2]
    }
}

class RecordHead {
    constructor() {
        this.type = 0;     // H (16-bit)
        this.subtype = 0;  // UH (16-bit)
        this.size = 0;     // W (32-bit)
    }
}

class GlobalHead {
    constructor() {
        this.headType = 0;      // B (8-bit)
        this.checkSum = 0;      // B (8-bit)
        this.version = 0;       // H (16-bit)
        this.crc = 0;           // H (16-bit)
        this.nfiles = 0;        // H (16-bit)
        this.compMethod = 0;    // H (16-bit)
        this.time = 0;          // W (32-bit)
        this.fileSize = 0;      // W (32-bit)
        this.origSize = 0;      // W (32-bit)
        this.compSize = 0;      // W (32-bit)
        this.extSize = 0;       // W (32-bit)
    }
}

// localHead size 96
// function localHead (f_type, f_atype, name, origId, compMethod, orgSize, compSize, reserved,
//     f_nlink, crc, f_size, offset, f_nrec, f_ltime, f_atime, f_mtime, f_ctime) {
//     this.f_type = f_type;               // UH F_STATE    0 + 2
//     this.f_atype = f_atype;             // UH F_ATYPE    2 + 2
//     this.name = name;                   // UH TC[20] ファイル名  4 + 40
//     this.origId = origId;               // H 元ファイルのファイルID  44 + 2
//     this.compMethod = compMthod;       // H ファイル別圧縮時の圧縮法    46 + 2
//     this.orgSize = orgSize;             // W ファイルのレコードパッキング後の非圧縮サイズ    48 + 4
//     this.compSize = compSize;           // W ファイル別圧縮時の圧縮サイズ    52 + 4
//     this.reserved = reserved;           // H[4] 予約領域 56 + 8
//     this.f_nlink = f_nlink;             // H F_STATE 64 + 2
//     this.crc = crc;                     // H ファイル別圧縮時のCRC   66 + 2
//     this.f_size = f_size;               // W F_STATE 68 + 4
//     this.offset = offset;               // W ファイル本体のオフセット    72 + 4
//     this.f_nrec = f_nrec;               // W F_STATE 76 + 4
//     this.f_ltime = f_ltime;             // W STIME F_STATE   80 + 4
//     this.f_atime = f_atime;             // W STIME F_STATE   84 + 4
//     this.f_mtime = f_mtime;             // W STIME F_STATE   88 + 4
//     this.f_ctime = f_ctime;             // W STIME F_STATE   92 + 4
// }

// LocalHeadクラスの定義
class LocalHead {
    constructor() {
        this.f_type = null;                     // < F_STATE
        this.f_atype = null;                    // < F_STATE
        this.name = new Array(20).fill(0);      // ファイル名
        this.origId = null;                     // 元ファイルのファイルID
        this.compMethod = null;                 // ファイル別圧縮時の圧縮法
        this.origSize = null;                   // ファイルのレコードパッキング後の非圧縮サイズ
        this.compSize = null;                   // ファイル別圧縮時の圧縮サイズ
        this.reserve = [null, null, null, null]; // 予約領域
        this.f_nlink = null;                    // < F_STATE
        this.crc = null;                        // ファイル別圧縮時のCRC
        this.f_size = null;                     // < F_STATE
        this.offset = null;                     // ファイル本体のオフセット
        this.f_nrec = null;                     // < F_STATE
        this.f_ltime = null;                    // < F_STATE
        this.f_atime = null;                    // < F_STATE
        this.f_mtime = null;                    // < F_STATE
        this.f_ctime = null;                    // < F_STATE
    }
}

class LINK {
    constructor() {
        this.fs_name = new Array(20).fill(0);  // TC[20]
        this.f_id = 0;      // UH (16-bit)
        this.atr1 = 0;      // UH (16-bit)
        this.atr2 = 0;      // UH (16-bit)
        this.atr3 = 0;      // UH (16-bit)
        this.atr4 = 0;      // UH (16-bit)
        this.atr5 = 0;      // UH (16-bit)
    }
}

var GHEAD = new GlobalHead();
var LHEAD = [];
var fusen = new DFUSENSEG();

// 用紙サイズ
var paperSize = new Array();            // 用紙サイズ
var parepBinding = 0;                   // 用紙綴じ方向 0:左綴じ
var paperImposition = 0;                // 用紙面付け指定 0:1面付け,1:2面付け
var paperMargin = new Array();          // 用紙マージン


// 行書式
var lineAlign = 0;                      // 0:左揃え,1:中央揃え,2:右揃え,3:両端揃え,4:均等揃え,5～:予約

/**
 * Unit計算
 * @param {0x0000} unit 
 * @returns 
 */
function units(unit) {
    if (unit&0x8000) unit|= ~0xffff;
    return unit;
}

/**
 * onDrag
 * @param {Event} event 
 */
function onDragOver(event) {
    event.preventDefault(); 
} 

/**
 * onDrop
 * @param {Event} event 
 */
function onDrop(event) {
    onAddFile(event);
    event.preventDefault(); 
}  

/**
 * HTML tag文字列変換
 * @param {char} str 
 * @returns 
 */
function htmlspecialchars(str) {
    return (str + '').replace(/&/g,'&amp;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;'); 
}

/**
 * IntToHex
 * @param {int} value 
 * @param {int} digits 
 * @returns 
 */
function IntToHex(value,digits) {
    let result = value.toString(16).toUpperCase();

    for(let i=result.length;i<digits;i++) {
        result = '0' + result;
    }

    return '0x' + result; 
}

/**
 * TADセグメント UH2H
 * @param {0x0000} uh   
 * @returns
 */
function uh2h(uh) {
    if (uh&0x8000) uh|= ~0xffff;
    return uh
}

/**
 * TADセグメント UH2UB
 * 呼び出し例
 *  let tadSeg8 = uh2ub(tadSeg);
 *  for(let offsetLen=4;offsetLen<tadSeg8.length;offsetLen++) {
 *      console.log(charTronCode(tadSeg8[offsetLen]));
 *  }
 * @param {0x0000[]} UH
 * @returns
 */
function uh2ub(UH) {
    let uhBuffer = new ArrayBuffer(2);
    let ra16db = new DataView(uhBuffer);
    let tadSeg = new Array();
    for(let i=0;i<UH.length;i++) {
        ra16db.setUint16(i*2, UH[i]);
        tadSeg.push(ra16db.getUint8(0));
        tadSeg.push(ra16db.getUint8(1));
    }
    return tadSeg;
}

/**
 * TADセグメント UH2UW
 * @param {[UH, UH]} UH 
 * @returns 
 */
function uh2uw(UH) {
    // 32bit値が直接渡された場合
    if (typeof UH === "number") {
        return [UH >>> 0]; // 32bit符号なし整数として返す
    }
    // Uint32ArrayやArrayBufferが渡された場合
    if (UH instanceof Uint32Array) {
        return Array.from(UH);
    }
    if (UH instanceof ArrayBuffer && UH.byteLength === 4) {
        let dv = new DataView(UH);
        return [dv.getUint32(0, false)]; // Big Endian
    }    
    var uhBuffer = new ArrayBuffer(4);
    var ra32db = new DataView(uhBuffer);
    var tadSeg = new Array();
    for (let i=0;i<UH.length;i++) {
        ra32db.setUint16(i*2, UH[i], false); // Big Endian
        if ((i % 2) != 0) {
            tadSeg.push(ra32db.getUint32(i/2), false); // Big Endian
        }
    }    
    return tadSeg;
}



/**
 * カンマセット
 * @param {char} S 
 * @returns 
 */
function setComma(S) {
    var result =''; 
    var cnt = 0; 
    
    S = S +'';
    for(let i=S.length-1;i>=0;i--) {
        if (cnt == 3) {
            result =  S[i]+  ',' + result;
            cnt = 1;
        }else{
            result = S[i] + result;
            cnt++;
        }    
    }
    return result;
}

/**
 * エンディアン変換（little2big）
 * @param {int} n 
 * @returns 
 */
function changeEndian(n) {
    let r = n / 0x100;
    r += (n % 0x100) * 0x100;
    return r;
}

/**
 * UHからUB SubIDを取得
 * @param {UH} UH 
 * @returns 
 */
function getTopUBinUH(UH) {
    let SubID = ( UH >> 8);
    console.log("UB_SubID" + SubID);
    return SubID;
}

/**
 * UHからUB ATTRを取得
 * @param {UH} UH 
 * @returns 
 */
function getLastUBinUH(UH) {
    let ATTR = ( UH & 0b00000011);
    // console.log("UB_SubID" + ATTR);
    return ATTR;
}

function fgetc() {
    if (!tadDataView) {
        throw new Error("tadDataViewが未初期化です");
    }
    if (tadPos >= tadDataView.byteLength) {
        throw new Error("fgetc: ファイル終端に到達しました (tadPos=" + tadPos + ")");
    }
    let char = tadDataView.getUint8(tadPos); // & 0xFF;
    let hexChar = IntToHex(char, 2);
    console.debug("fgetc tadPos:" + tadPos + " char:" + char + " hex:" + hexChar);
    tadPos++;
    return char;
}

function fwrite (p, s, n) {
    let char = String.fromCharCode.apply(null, p.slice(0, s * n));

}


/* stdlib.h */
var EXIT_SUCCESS = 0;
var EXIT_FAILURE = 1;

function exit(v) {
	throw v;
}

/* limits.h */
var CHAR_BIT = 8;
var UCHAR_MAX = 255;
var BUFFERSIZE = 8192;  /* Buffer size for file processing */

/* ar.c */

var origsize = 0;
var compsize = 0;
var tadCompSize;
var compMethod = 0; // Global compression method

/* io.c */

var INIT_CRC = 0;  /* CCITT: 0xFFFF */
var arcfile, outfile;
var crc, bitbuf;
var BITBUFSIZ = CHAR_BIT * 2;   /* sizeof bitbuf */

var updateCRC;
var error;
var make_crctable;

(function() {

var CRCPOLY = 0xA001;  /* ANSI CRC-16 */
                       /* CCITT: 0x8408 */
var crctable = new Uint16Array(UCHAR_MAX + 1);

var MASK_16BIT = 0xFFFF; // 16ビットマスク

to16bit = function(value) {
    return value & MASK_16BIT;
}

error = function() {
	var args = arguments;

	console.log(args[0]);
	exit(EXIT_FAILURE);
}

/**
 * make_crctable: CRCテーブルを作成する
 */
make_crctable = function() {
    console.debug("make_crctable");
    for (let i = 0; i <= UCHAR_MAX; i++) {
        let r = i;
        for (let j = 0; j < CHAR_BIT; j++) {
            if (r & 1) {
                r = (r >>> 1) ^ CRCPOLY;
            } else {
                r >>>= 1;
            }

        }
        crctable[i] = r & 0xFFFF;
    }
}

/**
 * Update CRC
 */
updateCRC = function (c) {
    //console.debug("UPDATE_CRC");
    crc = crctable[(crc ^ c) & 0xFF] ^ (crc >>> CHAR_BIT);
    crc &= 0xFFFF;
}

})();

// LH5 decoder instance
var lh5Decoder = null;

// Decode state variables for improved implementation
let decode_n = 0;      // Total bytes decoded
let decode_buftop = 0; // Current position in decode buffer
let decode_bufsize = 0; // Size of decoded data in buffer

// Constants needed for compatibility
var DICBIT = 13;
var DICSIZ = 1 << DICBIT;
let xReadBuf = new Uint8Array(DICSIZ);







/**
 * ファイル解凍
 * @param {*} compMethod 
 * @param {*} l 
 * @returns 
 */
function xRead(compMethod, p, l) {
    console.debug(`xRead: length=${l}, mode=${compMethod}, tadPos=${tadPos}, tadDataView.byteLength=${tadDataView.byteLength}`);

    if (compMethod == LH0) {
        // 非圧縮の場合
        if (tadPos + l > tadDataView.byteLength) {
            throw new Error("xRead: 読み込み範囲がファイルサイズを超えています");
        }
        
        for (let i = 0; i < l; i++) {
            p[i] = tadDataView.getUint8(tadPos + i);
        }
        tadPos += l;
        return 0;
    } else {
        // LH5 圧縮モード - バッファリングを使用した効率的な解凍
        for (let i = 0; i < l; i++) {
            if (decode_buftop >= decode_bufsize) {
                // Buffer empty, decode more
                if (origsize - decode_n > DICSIZ) {
                    lh5Decoder.decode(DICSIZ, xReadBuf);
                    decode_n += DICSIZ;
                    decode_bufsize = DICSIZ;
                } else {
                    const remaining = origsize - decode_n;
                    if (remaining > 0) {
                        lh5Decoder.decode(remaining, xReadBuf);
                        decode_bufsize = remaining;
                        decode_n += remaining;
                    } else {
                        // No more data to decode
                        console.error("xRead: No more data to decode");
                        return -1;
                    }
                }
                decode_buftop = 0;
            }
            p[i] = xReadBuf[decode_buftop++];
            updateCRC(p[i]);
        }
        console.debug("xRead tadPos:" + tadPos + " decode_n:" + decode_n + " decode_buftop:" + decode_buftop + " decode_bufsize:" + decode_bufsize);
        return 0;
    }
}

/**
 * pass1
 * tadファイルのディレクトリを作成
 * 各ファイルのディレクトリは、ファイルIDをディレクトリ名とする。
 * 例: ファイルIDが0x0001のファイルは、ディレクトリ名が"1"となる。
 */
function pass1() {
    for (let i = 0; i < GHEAD.nfiles; i++) {
        const dirName = i.toString();
        // if (!fs.existsSync(dirName)) {
        //     fs.mkdirSync(dirName, { recursive: true });
        // }
    }
}

/**
 * pass2
 * tadファイルの内容を解凍し、各ファイルの内容をディレクトリに保存する。
 * 各ファイルの情報はfile.infに保存され、各レコードの情報はrec.infに保存される。
 */
function pass2(LHEAD) {
    // Create file info
    const finfoPath = 'file.inf';
    let finfoContent = 'No: f_type, name\n';
    
    // Process all files
    for (let i = 0; i < GHEAD.nfiles; i++) {
        const lhead = LHEAD[i];
        const fileName = lhead.name;
        finfoContent += `${i}: 0${lhead.f_type.toString(8)}, ${fileName}\n`;
        
        // Create record info
        const recInfoPath = `${i}/rec.inf`;
        let recInfoContent = 'No: type, subtype\n';
        
        // Process all records
        for (let j = 0; j < lhead.f_nrec; j++) {
            // Read record header
            const rhead = new RecordHead();
            const rheadData = new Uint8Array(8);
            xRead(compMethod, rheadData, 8);
            
            const view = new DataView(rheadData.buffer);
            rhead.type = view.getInt16(0, true);
            rhead.subtype = view.getUint16(2, true);
            rhead.size = view.getUint32(4, true);
            
            recInfoContent += `${j}: ${rhead.type}, ${rhead.subtype}\n`;
            
            // Create output file
            const recFileName = `${i}/${j}`;
            let recordData = new Uint8Array(rhead.size);
            
            if (rhead.type === 0) {
                // Link record
                const linkData = new Uint8Array(52);  // sizeof(LINK)
                xRead(compMethod, linkData, 52);
                
                // Parse LINK structure
                const linkView = new DataView(linkData.buffer);
                const link = new LINK();
                
                // TODO: Process link data
                link.f_id = 0x7777;  // Placeholder
                
                recordData = linkData;
            } else if (rhead.type === 1) {
                // Regular record
                let tempsize = 0;
                while (rhead.size - tempsize > BUFFERSIZE) {
                    xRead(compMethod, buffer, BUFFERSIZE);
                    recordData.set(buffer.slice(0, BUFFERSIZE), tempsize);
                    tempsize += BUFFERSIZE;
                }
                
                if (rhead.size - tempsize > 0) {
                    const remaining = new Uint8Array(rhead.size - tempsize);
                    xRead(compMethod, remaining, rhead.size - tempsize);
                    recordData.set(remaining, tempsize);
                }
                tadDataArray(recordData);
            } else {
                // Regular record
                let tempsize = 0;
                while (rhead.size - tempsize > BUFFERSIZE) {
                    xRead(compMethod, buffer, BUFFERSIZE);
                    recordData.set(buffer.slice(0, BUFFERSIZE), tempsize);
                    tempsize += BUFFERSIZE;
                }
                
                if (rhead.size - tempsize > 0) {
                    const remaining = new Uint8Array(rhead.size - tempsize);
                    xRead(compMethod, remaining, rhead.size - tempsize);
                    recordData.set(remaining, tempsize);
                }
            }
            
            
            //fs.writeFileSync(recFileName, recordData);
        }
        
        //fs.writeFileSync(recInfoPath, recInfoContent);
    }
    
    //fs.writeFileSync(finfoPath, finfoContent);
}

/**
 * 管理情報セグメントを処理
 * ログにバージョン出力
 * @param {0x0000[]} tadSeg 
 */
function tadVer(tadSeg) {
    if (tadSeg[0] === Number(0x0000)) {
        console.log("TadVer " + IntToHex((tadSeg[2]),4).replace('0x',''));
    }

}
/**
 * 文章開始セグメントを処理
 * 文章開始セグメントは複数入れ子になるため、テキストの配列を追加して以後のテキストを格納。
 * 文章終了セグメントで一括してテキストを表示
 * @param {0x0000[]} tadSeg 
 */
function tsTextStart(tadSeg) {
    let textChar = new STARTTEXTSEG();
    if (startTadSegment == false) {
        startTadSegment = true;
        let h_unit = Number(uh2h(tadSeg[8]));
        let v_unit = Number(uh2h(tadSeg[9]));
        textChar.h_unit = Number(uh2h(tadSeg[8]));
        textChar.v_unit = Number(uh2h(tadSeg[9]));
        if (h_unit < 0) {
            tadDpiHFlag = true;
        }
        if (v_unit < 0) {
            tadDpiVFlag = true;
        }
        tadDpiH = h_unit; // h_unit
        tadDpiV = v_unit; // v_unit
    }

    textNest++;
    textCharList.push('');
    tronCodeMask.push(1);

    let viewX = 0;
    let viewY = 0;
    let viewW = 0;
    let viewH = 0;
    let drawX = 0;
    let drawY = 0;
    let drawW = 0;
    let drawH = 0;

    // 文章TADの場合、全体が文章であることが示されるため、指定は無効
    if (startByImageSegment == true) {
        viewX = Number(uh2h(tadSeg[0]));
        viewY = Number(uh2h(tadSeg[1]));
        viewW = Number(uh2h(tadSeg[2])) - viewX;
        viewH = Number(uh2h(tadSeg[3])) - viewY;  
        drawX = Number(uh2h(tadSeg[4]));
        drawY = Number(uh2h(tadSeg[5]));
        drawW = Number(uh2h(tadSeg[6])) - drawX;
        drawH = Number(uh2h(tadSeg[7])) - drawY;
        textChar.view.left = Number(uh2h(tadSeg[0]));
        textChar.view.top = Number(uh2h(tadSeg[1]));
        textChar.view.right = Number(uh2h(tadSeg[2]));
        textChar.view.bottom = Number(uh2h(tadSeg[3]));
        textChar.draw.left = Number(uh2h(tadSeg[4]));
        textChar.draw.top = Number(uh2h(tadSeg[5]));
        textChar.draw.right = Number(uh2h(tadSeg[6]));
        textChar.draw.bottom = Number(uh2h(tadSeg[7]));
        // h_unit, v_unitは代入済
        textChar.lang = Number(tadSeg[10]);
        textChar.bpat = Number(tadSeg[11]);
    }

    console.debug('view\r\n');
    console.debug("left " + viewX);
    console.debug("top " + viewY);
    console.debug("right " + viewW);
    console.debug("bottom " + viewH);
    console.debug('draw\r\n');
    console.debug("left   " + drawX);
    console.debug("top    " + drawY);
    console.debug("right  " + drawW);
    console.debug("bottom " + drawH);
    console.debug("h_unit " + units(tadSeg[8]));
    console.debug("v_unit " + units(tadSeg[9]));
    console.debug("lang   " + Number(tadSeg[10]));
    console.debug("bgpat  " + Number(tadSeg[11]));

    textCharPoint.push([viewX,viewY,viewW,viewH,drawX,drawY,drawW,drawH]);
    textCharData.push(textChar);
}


/**
 * テキスト描画
 * @param {context} ctx 
 * @param {char} char 
 * @param {int} drawfontSize 
 * @param {int} startX 
 * @param {int} startY 
 * @param {int} width 
 * @param {int} lineHight 
 * @param {int} align 
 */
function drawText(ctx, char, drawfontSize, startX, startY, width, lineHight, align) {
    if (canvasW < width ) {
        width = canvasW;
    } else if (width < 10) {
        width = canvasW;
    }

    textFontSet = textFontSize + 'px serif';
    ctx.fillStyle = "black";
    ctx.font = textFontSet;
    ctx.textBaseline = "top";

    // 折り返し処理
    if (ctx.measureText(char).width + textWidth > width) {
        textRow++;
        textHeight += lineHight;
        textWidth = 0;
        textColumn = 0;
        if (tabRulerLineMoveFlag == true) {
            console.debug("行頭移動処理");
            for (let tabLoop = 0;tabLoop < tabRulerLinePoint; tabLoop++) {
                textWidth += ctx.measureText(" ").width;
                textColumn++;
            }
        }
    }
    // 改段落処理
    if (char == String.fromCharCode(Number(TC_NL))) {
        textRow++;
        textHeight += lineHight;
        textWidth = 0;
        textColumn = 0;
        if (tabRulerLineMoveFlag == true) {
            tabRulerLineMoveFlag = false;
        }
    // 改行処理
    } else if (char == String.fromCharCode(Number(TC_CR))) {
        textRow++;
        textHeight += lineHight;
        textWidth = 0;
        textColumn = 0;
        if (tabRulerLineMoveFlag == true) {
            console.debug("行頭移動処理");
            for (let tabLoop = 0;tabLoop < tabRulerLinePoint; tabLoop++) {
                textWidth += ctx.measureText(" ").width;
                textColumn++;
            }
        }
    // 改ページ処理
    } else if (char == String.fromCharCode(Number(TC_NC)
        || char == String.fromCharCode(Number(TC_FF)))) {
        textRow++;
        textHeight += lineHight;
        textWidth = 0;
        textColumn = 0;
        if (tabRulerLineMoveFlag == true) {
            tabRulerLineMoveFlag = false;
        }
    // Tab処理
    } else if (char == String.fromCharCode(Number(TC_TAB))) {
        console.debug("Tab処理");
        for (let tabLoop = 0;tabLoop < tabCharNum; tabLoop++) {
            textWidth += ctx.measureText(" ").width;
            textColumn++;
        }
    } else {
        let padding = 0;
        ctx.fillText(char, 0 + padding + startX + textWidth, startY + textHeight);
        textWidth += ctx.measureText(char).width;
        textColumn++;
    }
}


/**
 * 文章終了セグメントを処理
 * 文章開始セグメント以降格納されていたテキストを一括して表示
 * @param {0x0000[]} tadSeg 
 */
function tsTextEnd(tadSeg) {

    textChar = textCharData[textNest-1];

    console.debug("Text      : " + textCharList[textNest-1]);
    console.debug("TextPoint : " + textCharPoint[textNest-1][0],textCharPoint[textNest-1][1]);
    console.debug("TextPoint : " + textChar.view.left, textChar.view.top, textChar.view.right, textChar.view.bottom, textChar.draw.left, textChar.draw.top, textChar.draw.right, textChar.draw.bottom);


    textCharList.pop();
    textCharPoint.pop();
    textCharData.pop();
    tronCodeMask.pop();
    textNest--;
    textWidth = 0;
    textHeight = 0;
    textRow = 0;
    textColumn = 0;
}

/**
 * 用紙指定付箋を処理
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 * @returns 
 */
function tadSizeOfPaperSetFusen(segLen, tadSeg) {
    if (segLen < Number(0x000E)) {
        return;
    }
    // 図形TADの場合は無視される
    if (startByImageSegment == true) {
        return;
    }

    var ATTR = getLastUBinUH(tadSeg[0]);

    if (ATTR === Number(0x00)) {
        parepBinding = 0; // 用紙綴じ方向 0:左綴じ
        paperImposition = 0; // 用紙面付け指定 0:1面付け
    } else if (ATTR === Number(0x01)) {
        parepBinding = 0; // 用紙綴じ方向 0:左綴じ
        paperImposition = 1; // 用紙面付け指定 1:2面付け
    } else if (ATTR === Number(0x02)) {
        parepBinding = 1; // 用紙綴じ方向 1:右綴じ
        paperImposition = 0; // 用紙面付け指定 0:1面付け
    } else if (ATTR === Number(0x03)) {
        parepBinding = 1; // 用紙綴じ方向 1:右綴じ
        paperImposition = 1; // 用紙面付け指定 1:2面付け
    }

    console.debug("length " + IntToHex((tadSeg[1]),4).replace('0x',''));
    console.debug("width  " + IntToHex((tadSeg[2]),4).replace('0x',''));
    console.debug("top    " + IntToHex((tadSeg[3]),4).replace('0x',''));
    console.debug("bottom " + IntToHex((tadSeg[4]),4).replace('0x',''));
    console.debug("left   " + IntToHex((tadSeg[5]),4).replace('0x',''));
    console.debug("right  " + IntToHex((tadSeg[6]),4).replace('0x',''));

    var peperLength = Number(tadSeg[1]);
    var paperWidth = Number(tadSeg[2]);
    var paperTop = Number(tadSeg[3]);
    var paperBottom = Number(tadSeg[4]);
    var paperLeft = Number(tadSeg[5]);
    var paperRight = Number(tadSeg[6]);

    paperSize.push(peperLength, paperWidth, paperTop, paperBottom, paperLeft, paperRight)

    //textCharPoint[textNest-1][3] = viewH;
    //textCharPoint[textNest-1][2] = viewW;
}

/**
 * マージン指定付箋を処理
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 * @returns 
 */
function tadSizeOfMarginSetFusen(segLen, tadSeg) {
    if (segLen < Number(0x000A)) {
        return;
    }
    // 図形TADの場合は無視される
    if (startByImageSegment == true) {
        return;
    }

    console.debug("top    " + IntToHex((tadSeg[1]),4).replace('0x',''));
    console.debug("bottom " + IntToHex((tadSeg[2]),4).replace('0x',''));
    console.debug("left   " + IntToHex((tadSeg[3]),4).replace('0x',''));
    console.debug("right  " + IntToHex((tadSeg[4]),4).replace('0x',''));

    var marginTop = Number(tadSeg[1]);
    var marginBottom = Number(tadSeg[2]);
    var marginLeft = Number(tadSeg[3]);
    var marginRight = Number(tadSeg[4]);

    paperMargin.push(marginTop, marginBottom, marginLeft, marginRight)
}

/**
 * コラム指定付箋を処理
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 * @returns 
 */
function tadSizeOfColumnSetFusen(segLen, tadSeg) {
    if (segLen < Number(0x0004)) {
        return;
    }
    // 図形TADの場合は無視される
    if (startByImageSegment == true) {
        return;
    }
    // TODO: 未実装
}

/**
 * 用紙オーバーレイ定義付箋を処理
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 * @returns 
 */
function tadSizeOfPaperOverlayDefineFusen(segLen, tadSeg) {
    if (segLen < Number(0x0004)) {
        return;
    }
    // 図形TADの場合は無視される
    if (startByImageSegment == true) {
        return;
    }
    // TODO: 未実装
}

/**
 * 用紙オーバーレイ指定付箋を処理
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 * @returns 
 */
function tadSizeOfPaperOverlaySetFusen(segLen, tadSeg) {
    if (segLen < Number(0x0004)) {
        return;
    }
    // 図形TADの場合は無視される
    if (startByImageSegment == true) {
        return;
    }
    // TODO: 未実装
}

/**
 * ページ指定付箋共通から付箋を判定
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 */
function tadPageSetFusen(segLen, tadSeg) {
    var UB_SubID = getTopUBinUH(tadSeg[0]);

    if (UB_SubID === Number(0x00)) {
        console.log("用紙指定付箋");
        tadSizeOfPaperSetFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x01)) {
        console.log("マージン指定付箋");
        tadSizeOfMarginSetFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x02)) {
        console.log("コラム指定付箋");
        tadSizeOfColumnSetFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x03)) {
        console.log("用紙オーバーレイ定義付箋");
        tadSizeOfPaperOverlayDefineFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x04)) {
        console.log("用紙オーバーレイ指定付箋");
        tadSizeOfPaperOverlaySetFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x05)) {
        console.log("枠あけ指定付箋");
        // TODO: 未実装
    } else if (UB_SubID === Number(0x06)) {
        console.log("ページ番号指定付箋");
        // TODO: 未実装
    } else if (UB_SubID === Number(0x07)) {
        console.log("条件改ページ指定付箋");
        // TODO: 未実装
    } else if (UB_SubID === Number(0x08)) {
        console.log("充填行指定付箋");
        // TODO: 未実装
    } 
}

/**
 * 行間隔指定付箋を処理
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 */
function tadRulerLineSpacingSetFusen(segLen, tadSeg) {
    var ATTR = getLastUBinUH(tadSeg[0]);

}

/**
 * 行揃え指定付箋を処理
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 */
function tadRulerLineAlignmentSetFusen(segLen, tadSeg) {
    var ATTR = getLastUBinUH(tadSeg[0]);

    lineAlign = Number(ATTR);
    console.debug("行揃え : " + lineAlign);
}

/**
 * 行頭移動指定付箋を処理
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 */
function tadRulerLineMoveSetFusen(segLen, tadSeg) {
    //tabRulerLineMovePoint.push(textCharList[textNest-1].length);
    //tabRulerLineMoveFlagOld = true;
    console.debug("行頭移動指定付箋セット :" + textColumn);
    //tabRulerLineMoveNum++;
    tabRulerLineMoveFlag = true;
    tabRulerLinePoint = textColumn;
}


/**
 * 行書式指定付箋から付箋を判定
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 */
function tadRulerSetFusen(segLen, tadSeg) {
    let UB_SubID = getTopUBinUH(tadSeg[0]);

    if (UB_SubID === Number(0x00)) {
        console.log("行間隔指定付箋");
        tadRulerLineSpacingSetFusen(segLen, tadSeg);
        // TODO: 未実装
    } else if (UB_SubID === Number(0x01)) {
        console.log("行揃え指定付箋");
        tadRulerLineAlignmentSetFusen(segLen, tadSeg);
        // TODO: 未実装
    } else if (UB_SubID === Number(0x02)) {
        console.log("タブ書式指定付箋");
        // TODO: 未実装
    } else if (UB_SubID === Number(0x03)) {
        console.log("フィールド書式指定付箋");
        // TODO: 未実装
    } else if (UB_SubID === Number(0x04)) {
        console.log("文字方向指定付箋");
        // TODO: 未実装
    } else if (UB_SubID === Number(0x05)) {
        console.log("行頭移動指定付箋");
        tadRulerLineMoveSetFusen(segLen, tadSeg);
        // TODO: 未実装
    }
}

/**
 * フォント指定付箋を処理
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 * @returns 
 */
function tadFontNameSetFusen(segLen,tadSeg) {
    if (segLen < Number(0x0004)) {
        return;
    }
    for(let offsetLen=2;offsetLen<tadSeg.length;offsetLen++) {
        console.log(IntToHex((tadSeg[offsetLen]),4).replace('0x',''));
        console.log(charTronCode(tadSeg[offsetLen]));
    }
}

/**
 * 文字サイズ指定付箋を処理
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 */
function tadFontSizeSetFusen(segLen,tadSeg) {

    let tadSize = ("0000000000000000" + tadSeg[1].toString(2)).slice( -16 );
    
    var U1 = 16384;
    var U2 = 32768;
    var U3 = 49152;
    var sizeMask = 16383;
    

    if (tadSeg[1] & U2) {
        textFontSize = (tadSeg[1] & sizeMask) / 20;
        console.debug("ptsize  " + textFontSize );
    } else if (tadSeg[1] & U1) {
        console.debug("Qsize   " + tadSize);
        textFontSize = (tadSeg[1] & sizeMask) / (20 * 0.3528);
    }


}

/**
 * 文字指定付箋共通を判定
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 */
function tadFontSetFusen(segLen, tadSeg) {
    let UB_SubID = getTopUBinUH(tadSeg[0]);

    if (UB_SubID === Number(0x00)) {
        console.log("フォント指定付箋");
        tadFontNameSetFusen(segLen,tadSeg);
    } else if (UB_SubID === Number(0x01)) {
        console.log("フォント属性指定付箋");
    } else if (UB_SubID === Number(0x02)) {
        console.log("文字サイズ指定付箋");
        tadFontSizeSetFusen(segLen,tadSeg);
    } else if (UB_SubID === Number(0x03)) {
        console.log("文字拡大／縮小指定付箋");
    } else if (UB_SubID === Number(0x04)) {
        console.log("文字間隔指定付箋");
    } else if (UB_SubID === Number(0x05)) {
        console.log("文字回転指定付箋");
    } else if (UB_SubID === Number(0x06)) {
        console.log("文字カラー指定付箋");
    } else if (UB_SubID === Number(0x07)) {
        console.log("文字基準位置移動付箋");
    }
}

/**
 * 図形開始セグメントを処理
 * @param {0x0000[]} tadSeg 
 */
function tsFig(tadSeg) {
    if (startTadSegment == false) {
        startTadSegment = true;
        startByImageSegment = true;
        var h_unit = Number(uh2h(tadSeg[8]));
        var v_unit = Number(uh2h(tadSeg[9]));
        if (h_unit < 0) {
            tadDpiHFlag = true;
        }
        if (v_unit < 0) {
            tadDpiVFlag = true;
        }
        tadDpiH = h_unit; // h_unit
        tadDpiV = v_unit; // v_unit
    }
    imageNest++;

    let figSeg = new STARTFIGSEG();

    var viewX = 0;
    var viewY = 0;
    var viewW = 0;
    var viewH = 0;
    var drawX = 0;
    var drawY = 0;
    var drawW = 0;
    var drawH = 0;

    figSeg.view.left = Number(uh2h(tadSeg[0]));
    figSeg.view.top = Number(uh2h(tadSeg[1]));
    figSeg.view.right = Number(uh2h(tadSeg[2]));
    figSeg.view.bottom = Number(uh2h(tadSeg[3]));
    figSeg.draw.left = Number(uh2h(tadSeg[4]));
    figSeg.draw.top = Number(uh2h(tadSeg[5]));
    figSeg.draw.right = Number(uh2h(tadSeg[6]));
    figSeg.draw.bottom = Number(uh2h(tadSeg[7]));
    figSeg.h_unit = units(uh2h(tadSeg[8]));
    figSeg.v_unit = units(uh2h(tadSeg[9]));



    // 図形TADの場合、全体が図形であることが示されるため、指定は無効
    if (startByImageSegment == false) {
        // viewW = Number(uh2h(tadSeg[2])) - Number(uh2h(tadSeg[0]));
        // viewH = Number(uh2h(tadSeg[3])) - Number(uh2h(tadSeg[1]));
        // drawX = Number(uh2h(tadSeg[4]));
        // drawY = Number(uh2h(tadSeg[5]));
        // drawW = Number(uh2h(tadSeg[6])) - drawX;
        // drawH = Number(uh2h(tadSeg[7])) - drawY;
        viewW = figSeg.view.right - figSeg.view.left;
        viewH = figSeg.view.bottom - figSeg.view.top;
        drawX = figSeg.draw.left;
        drawY = figSeg.draw.top;
        drawW = figSeg.draw.right - drawX;
        drawH = figSeg.draw.bottom - drawY;
        
    } else if (imageNest > 1 && startByImageSegment == true) {
        // viewX = Number(uh2h(tadSeg[0]));
        // viewY = Number(uh2h(tadSeg[1]));
        // viewW = Number(uh2h(tadSeg[2])) - viewX;
        // viewH = Number(uh2h(tadSeg[3])) - viewY;  
        // drawX = Number(uh2h(tadSeg[4]));
        // drawY = Number(uh2h(tadSeg[5]));
        // drawW = Number(uh2h(tadSeg[6])) - drawX;
        // drawH = Number(uh2h(tadSeg[7])) - drawY;
        viewX = figSeg.view.left;
        viewY = figSeg.view.top;
        viewW = figSeg.view.right - viewX;
        viewH = figSeg.view.bottom - viewY;
        drawX = figSeg.draw.left;
        drawY = figSeg.draw.top;
        drawW = figSeg.draw.right - drawX;
        drawH = figSeg.draw.bottom - drawY;
    }

    // TODO: なぜか、図形TADなのに図形開始セグメントにview定義されていることがあるためcanvasサイズを変更
    // canvasサイズを図形開始セグメントのサイズにあわせる
    if ( startByImageSegment == true && imageNest == 1) {
        //canvas.width = viewW;
        //canvas.height = viewH;
    }

    // view
    console.debug("left   " + figSeg.view.left);
    console.debug("top    " + figSeg.view.top);
    console.debug("right  " + figSeg.view.right);
    console.debug("bottom " + figSeg.view.bottom);
    // draw
    console.debug("left   " + figSeg.draw.left);
    console.debug("top    " + figSeg.draw.top);
    console.debug("right  " + figSeg.draw.right);
    console.debug("bottom " + figSeg.draw.bottom);
    console.debug("h_unit " + figSeg.h_unit);
    console.debug("v_unit " + figSeg.v_unit);

    imagePoint.push([viewX,viewY,viewW,viewH,drawX,drawY,drawW,drawH]);
}

/**
 * 図形要素セグメント 長方形セグメントを描画
 * @param {int} segLen 
 * @param {{0x0000[]} tadSeg 
 * @returns 
 */
function tsFigRectAngleDraw(segLen, tadSeg) {
    if (segLen < Number(0x0012)) {
        return;
    }
    let figX = Number(tadSeg[5]);
    let figY = Number(tadSeg[6]);
    let figW = Number(tadSeg[7]) - Number(tadSeg[5]);
    let figH = Number(tadSeg[8]) - Number(tadSeg[6]);


    console.debug("l_atr  " + IntToHex((tadSeg[1]),4).replace('0x',''));
    console.debug("l_pat  " + IntToHex((tadSeg[2]),4).replace('0x',''));
    console.debug("f_pat  " + IntToHex((tadSeg[3]),4).replace('0x',''));
    console.debug("angle  " + IntToHex((tadSeg[4]),4).replace('0x',''));
    console.debug("left   " + IntToHex((tadSeg[5]),4).replace('0x',''));
    console.debug("top    " + IntToHex((tadSeg[6]),4).replace('0x',''));
    console.debug("right  " + IntToHex((tadSeg[7]),4).replace('0x',''));
    console.debug("bottom " + IntToHex((tadSeg[8]),4).replace('0x',''));



    ctx.beginPath();
    ctx.rect(figX , figY, figW, figH);
    ctx.fillStyle = 'white';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'black';
    ctx.stroke();


    return;
}

/**
 * 図形要素セグメント 角丸長方形セグメントを描画
 * @param {int} segLen 
 * @param {{0x0000[]} tadSeg 
* @returns 
*/
function tsFigRoundRectAngleDraw(segLen, tadSeg) {
    if (segLen < Number(0x0016)) {
        return;
        }
    let figRH = Number(tadSeg[5]);
    let figRV = Number(tadSeg[6]);
    let figX = Number(tadSeg[7]);
    let figY = Number(tadSeg[8]);
    let figW = Number(tadSeg[9]) - figX;
    let figH = Number(tadSeg[10]) - figY;


    console.debug("l_atr  " + IntToHex((tadSeg[1]),4).replace('0x',''));
    console.debug("l_pat  " + IntToHex((tadSeg[2]),4).replace('0x',''));
    console.debug("f_pat  " + IntToHex((tadSeg[3]),4).replace('0x',''));
    console.debug("angle  " + IntToHex((tadSeg[4]),4).replace('0x',''));
    console.debug("rh     " + IntToHex((tadSeg[5]),4).replace('0x',''));
    console.debug("rv     " + IntToHex((tadSeg[6]),4).replace('0x',''));
    console.debug("left   " + IntToHex((tadSeg[7]),4).replace('0x',''));
    console.debug("top    " + IntToHex((tadSeg[8]),4).replace('0x',''));
    console.debug("right  " + IntToHex((tadSeg[9]),4).replace('0x',''));
    console.debug("bottom " + IntToHex((tadSeg[10]),4).replace('0x',''));

    ctx.beginPath();
    ctx.moveTo(figX + (figRH / 2), figY);
    ctx.lineTo(figX + figW - (figRH / 2), figY);
    ctx.arcTo(figX + figW, figY, figX + figW, figY + (figRV / 2), (figRH / 2));
    ctx.lineTo(figX + figW, figY + figH - (figRV / 2));
    ctx.arcTo(figX + figW, figY + figH, figX + figW - (figRH / 2) , figY + figH, (figRV / 2));
    ctx.lineTo(figX + (figRH / 2), figY + figH); 
    ctx.arcTo(figX, figY + figH, figX, figY + figH - (figRV / 2), (figRH / 2));
    ctx.lineTo(figX, figY + (figRV / 2));
    ctx.arcTo(figX, figY, figX + (figRH / 2), figY, (figRV / 2));
    ctx.closePath();

    ctx.fillStyle = 'white';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'black';
    ctx.stroke();


    return;
}

/**
 * 図形セグメント 多角形セグメントを描画
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 * @returns 
 */
function tsFigPolygonDraw(segLen, tadSeg) {
    if (segLen < Number(0x0016)) {
        return;
    }
    console.debug("l_atr  " + IntToHex((tadSeg[1]),4).replace('0x',''));
    console.debug("l_pat  " + IntToHex((tadSeg[2]),4).replace('0x',''));
    console.debug("f_pat  " + IntToHex((tadSeg[3]),4).replace('0x',''));
    console.debug("round  " + IntToHex((tadSeg[4]),4).replace('0x',''));
    console.debug("np     " + IntToHex((tadSeg[5]),4).replace('0x',''));
    console.debug("x      " + IntToHex((tadSeg[6]),4).replace('0x',''));
    console.debug("y      " + IntToHex((tadSeg[7]),4).replace('0x',''));

    let x = Number(tadSeg[6]);
    let y = Number(tadSeg[7]);

    ctx.strokeStyle = 'black';
    ctx.beginPath();
    ctx.moveTo(x,y);

    var polygonPoint = 'polygon ';
    for(let offsetLen=8;offsetLen<tadSeg.length;offsetLen++) {
        if (offsetLen % 2 === 0) {
            polygonPoint += ' x:';
            x = Number(tadSeg[offsetLen]);
        } else {
            polygonPoint += ' y:';
            y = Number(tadSeg[offsetLen]);
            ctx.lineTo(x,y);
        }
        polygonPoint += IntToHex((tadSeg[offsetLen]),4).replace('0x','');
    }
    console.log(polygonPoint);
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = "white";
    ctx.fill();


    return;
}

/**
 * 図形セグメント 直線セグメントを描画
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 * @returns 
 */
function tsFigLineDraw(segLen, tadSeg) {
    if (segLen < Number(0x000E)) {
        return;
    }
    console.debug("l_atr  " + IntToHex((tadSeg[1]),4).replace('0x',''));
    console.debug("l_pat  " + IntToHex((tadSeg[2]),4).replace('0x',''));

    let x = Number(tadSeg[3]);
    let y = Number(tadSeg[4]);

    ctx.strokeStyle = 'black';
    ctx.beginPath();
    ctx.moveTo(x,y);

    var linePoint = 'line   ';
    for(let offsetLen=5;offsetLen<tadSeg.length;offsetLen++) {
        if (offsetLen % 2 === 0) {
            linePoint += ' y:';
            y = Number(tadSeg[offsetLen]);
            ctx.lineTo(x,y);
        } else {
            linePoint += ' x:';
            x = Number(tadSeg[offsetLen]);
        }
        linePoint += IntToHex((tadSeg[offsetLen]),4).replace('0x','');
    }
    console.log(linePoint);

    ctx.stroke();
    return;
}

/**
 * 図形セグメント 楕円セグメントを描画
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 * @returns 
 */
function tsFigEllipseDraw(segLen, tadSeg) {
    if (segLen < Number(0x0012)) {
        return;
    }
    console.debug("l_atr  " + IntToHex((tadSeg[1]),4).replace('0x',''));
    console.debug("l_pat  " + IntToHex((tadSeg[2]),4).replace('0x',''));
    console.debug("f_pat  " + IntToHex((tadSeg[3]),4).replace('0x',''));
    console.debug("angle  " + IntToHex((tadSeg[4]),4).replace('0x',''));
    console.debug("left   " + IntToHex((tadSeg[5]),4).replace('0x',''));
    console.debug("top    " + IntToHex((tadSeg[6]),4).replace('0x',''));
    console.debug("right  " + IntToHex((tadSeg[7]),4).replace('0x',''));
    console.debug("bottom " + IntToHex((tadSeg[8]),4).replace('0x',''));

    let angle = Number(uh2h(tadSeg[4]));
    let frameLeft = Number(uh2h(tadSeg[5]));
    let frameTop = Number(uh2h(tadSeg[6]));
    let frameRight = Number(uh2h(tadSeg[7]));
    let frameBottom = Number(uh2h(tadSeg[8]));
    let radiusX = ( frameRight - frameLeft ) / 2;
    let radiusY = (frameBottom - frameTop) / 2;
    let frameCenterX = frameLeft + radiusX;
    let frameCenterY = frameTop + radiusY;

    let radianAngle = angle * Math.PI / 180;

    console.debug(radianAngle);
    console.debug(frameCenterX);
    console.debug(frameCenterY);
    console.debug(radiusX);
    console.debug(radiusY);

    ctx.beginPath();
    ctx.ellipse(frameCenterX, frameCenterY, radiusX, radiusY, radianAngle, 0, Math.PI * 2,false);
    ctx.stroke();

    return;
}

/**
 * 図形セグメント 楕円弧セグメントを描画
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 * @returns 
 */
function tsFigEllipticalArcDraw(segLen, tadSeg) {
    if (segLen < Number(0x0018)) {
        return;
    }
    console.debug("l_atr  " + IntToHex((tadSeg[1]),4).replace('0x',''));
    console.debug("l_pat  " + IntToHex((tadSeg[2]),4).replace('0x',''));
    console.debug("angle  " + IntToHex((tadSeg[3]),4).replace('0x',''));
    console.debug("left   " + IntToHex((tadSeg[4]),4).replace('0x',''));
    console.debug("top    " + IntToHex((tadSeg[5]),4).replace('0x',''));
    console.debug("right  " + IntToHex((tadSeg[6]),4).replace('0x',''));
    console.debug("bottom " + IntToHex((tadSeg[7]),4).replace('0x',''));
    console.debug("startx " + IntToHex((tadSeg[8]),4).replace('0x',''));
    console.debug("starty " + IntToHex((tadSeg[9]),4).replace('0x',''));
    console.debug("endx   " + IntToHex((tadSeg[10]),4).replace('0x',''));
    console.debug("endy   " + IntToHex((tadSeg[11]),4).replace('0x',''));

    let angle = Number(uh2h(tadSeg[3]));
    let frameLeft = Number(uh2h(tadSeg[4]));
    let frameTop = Number(uh2h(tadSeg[5]));
    let frameRight = Number(uh2h(tadSeg[6]));
    let frameBottom = Number(uh2h(tadSeg[7]));
    let startX = Number(uh2h(tadSeg[8]));
    let startY = Number(uh2h(tadSeg[9]));
    let endX = Number(uh2h(tadSeg[10]));
    let endY = Number(uh2h(tadSeg[11]));
    let radiusX = ( frameRight - frameLeft ) / 2;
    let radiusY = (frameBottom - frameTop) / 2;
    let frameCenterX = frameLeft + radiusX;
    let frameCenterY = frameTop + radiusY;
    let radianStart = Math.atan2(startY - frameCenterY, startX - frameCenterX)
    let radianEnd = Math.atan2(endY - frameCenterY, endX - frameCenterX)
    let radianAngle = angle * Math.PI / 180;

    console.debug(radianAngle);
    console.debug(frameCenterX);
    console.debug(frameCenterY);
    console.debug(startX);
    console.debug(startY);
    console.debug(radiusX);
    console.debug(radiusY);
    console.debug(radianStart);
    console.debug(radianEnd);

    ctx.beginPath();
    ctx.ellipse(frameCenterX, frameCenterY, radiusX, radiusY, radianAngle, radianStart, radianEnd,false);
    ctx.stroke();

    return;
}

/**
 * 図形セグメント 折れ線セグメントを描画
 * @param {int} segLen
 * @param {0x0000[]} tadSeg
 * @returns 
 */
function tsFigPolylineDraw(segLen, tadSeg) {
    if (segLen < Number(0x0007)) {
        return;
    }
    let l_atr = Number(uh2h(tadSeg[1]));
    let l_pat = Number(uh2h(tadSeg[2]));
    let round = Number(uh2h(tadSeg[3]));
    let np = Number(uh2h(tadSeg[4]));

    let polyLines = new Array();
    for (let i = 0; i < np; i++) {
        let polyline = new PNT();
        polyline.x = Number(uh2h(tadSeg[5 + (i * 2)]));
        polyline.y = Number(uh2h(tadSeg[6 + (i * 2)]));
        polyLines.push(polyline);
    }

    ctx.strokeStyle = 'black';
    ctx.beginPath();
    for (let i = 0; i < polyLines.length; i++) {
        let point = polyLines[i];
        if (i === 0) {
            ctx.moveTo(point.x, point.y);
        } else {
            ctx.lineTo(point.x, point.y);
        }
    }
    //ctx.closePath();
    ctx.stroke();

}

/**
 * 図形セグメント 曲線セグメントを描画
 * @param {int} segLen
 * @param {0x0000[]} tadSeg
 * @returns
 */
function tsFigCurveDraw(segLen, tadSeg) {
    if (segLen < Number(0x0007)) {
        return;
    }
    // 曲線セグメントの描画処理
}

/**
 * 図形要素セグメントを判定
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 */
function tsFigDraw(segLen, tadSeg) {
    let UB_SubID = getTopUBinUH(tadSeg[0]);
    
    if (UB_SubID === Number(0x00)) {
        console.log("長方形セグメント");
        tsFigRectAngleDraw(segLen, tadSeg);
    } else if (UB_SubID === Number(0x01)) {
        console.log("角丸長方形セグメント");
        tsFigRoundRectAngleDraw(segLen, tadSeg);
    } else if (UB_SubID === Number(0x02)) {
        console.log("楕円セグメント");
        tsFigEllipseDraw(segLen, tadSeg);
    } else if (UB_SubID === Number(0x03)) {
        console.log("扇形セグメント");
    } else if (UB_SubID === Number(0x04)) {
        console.log("弓形セグメント");
    } else if (UB_SubID === Number(0x05)) {
        console.log("多角形セグメント");
        tsFigPolygonDraw(segLen, tadSeg);
    } else if (UB_SubID === Number(0x06)) {
        console.log("直線セグメント");
        tsFigLineDraw(segLen, tadSeg);
    } else if (UB_SubID === Number(0x07)) {
        console.log("楕円弧セグメント");
        tsFigEllipticalArcDraw(segLen, tadSeg);
    } else if (UB_SubID === Number(0x08)) {
        console.log("折れ線セグメント");
        tsFigPolylineDraw(segLen, tadSeg);
    // TODO :未対応
    } else if (UB_SubID === Number(0x09)) {
        console.log("曲線セグメント");
        tsFigCurveDraw(segLen, tadSeg);
    }
}

/**
 * データ定義セグメントを判定
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 */
function tsDataSet(segLen, tadSeg) {
    let UB_SubID = getTopUBinUH(tadSeg[0]);
    
    if (UB_SubID === Number(0x00)) {
        console.log("カラーマップ定義セグメント");

    } else if (UB_SubID === Number(0x01)) {
        console.log("マスクデータ定義セグメント");

    } else if (UB_SubID === Number(0x02)) {
        console.log("パターン定義セグメント");

    } else if (UB_SubID === Number(0x03)) {
        console.log("線種定義セグメント");

    } else if (UB_SubID === Number(0x04)) {
        console.log("マーカー定義セグメント");

    }
    

}

/**
 * 仮身セグメントを処理
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 * @returns 
 */
function tsVirtualObjSegment(segLen, tadSeg) {
    if (segLen < Number(0x001E)) {
        return;
    }
    console.debug("left   " + IntToHex((tadSeg[0]),4).replace('0x',''));
    console.debug("top    " + IntToHex((tadSeg[1]),4).replace('0x',''));
    console.debug("right  " + IntToHex((tadSeg[2]),4).replace('0x',''));
    console.debug("bottom " + IntToHex((tadSeg[3]),4).replace('0x',''));
    console.debug("height " + IntToHex((tadSeg[4]),4).replace('0x',''));
    console.debug("chsz   " + IntToHex((tadSeg[5]),4).replace('0x',''));
    console.debug("dlen   " + IntToHex((tadSeg[14]),4).replace('0x',''));

    var linkRecordData = '';
    for(let offsetLen=15;offsetLen<tadSeg.length;offsetLen++) {
        linkRecordData += tadSeg[offsetLen];
    }
}

/**
 * 指定付箋セグメントを処理
 * @param {*} segLen 
 * @param {*} tadSeg 
 * @param {int} nowPos
 */
function tsSpecitySegment(segLen, tadSeg, nowPos) {
    var offsetLen;

    if (segLen < Number(0x0042)) {
        return;
    }

    console.debug("left   " + Number(uh2h(tadSeg[0])));
    console.debug("top    " + Number(uh2h(tadSeg[1])));
    console.debug("right  " + Number(uh2h(tadSeg[2])));
    console.debug("bottom " + Number(uh2h(tadSeg[3])));
    console.debug("chsz   " + IntToHex((tadSeg[4]),4).replace('0x',''));
    console.debug("pict   " + Number(uh2h(tadSeg[11])));

    console.debug("segLen " + Number(segLen));
    console.debug("nowPos " + Number(nowPos)); // 0x26(0d38)は仮身セグメントの開始位置

    let appl = IntToHex((tadSeg[12]),4).replace('0x','')
        + IntToHex((tadSeg[13]),4).replace('0x','')
        + IntToHex((tadSeg[14]),4).replace('0x','');
    
    if (packAppId1 != tadSeg[12] || packAppId2 != tadSeg[13] || packAppId3 != tadSeg[14]) {
        console.debug("書庫形式ではない アプリケーションID");
        console.debug("appl   " + appl);
        return;
    }
    console.debug("書庫形式");

    for (offsetLen=15;offsetLen<31;offsetLen++) {
        console.log(charTronCode(tadSeg[offsetLen]));
    }

    let dlen = uh2uw([tadSeg[32], tadSeg[31]]);
    console.debug("dlen   " + dlen[0]);



    // グローバルヘッダの読込 330
    var compSeg = new Array();
    for(offsetLen=33;offsetLen<48;offsetLen++) {
        compSeg.push(tadSeg[offsetLen]);
    }
    GHEAD.headType = IntToHex((getTopUBinUH(compSeg[0])),2).replace('0x','');

    GHEAD.checkSum = IntToHex((getLastUBinUH(compSeg[0])),2).replace('0x','');
    GHEAD.version = IntToHex((compSeg[1]),4).replace('0x','');
    GHEAD.crc = IntToHex((compSeg[2]),4).replace('0x','');
    GHEAD.nfiles = IntToHex((compSeg[3]),4).replace('0x','');
    GHEAD.compMethod = IntToHex((compSeg[4]),4).replace('0x','');
    GHEAD.fileSize = uh2uw([compSeg[8], compSeg[7]])[0];
    GHEAD.origSize = uh2uw([compSeg[10], compSeg[9]])[0];
    GHEAD.compSize = uh2uw([compSeg[12], compSeg[11]])[0];
    GHEAD.extSize = uh2uw([compSeg[14], compSeg[13]])[0];
    console.debug("headtype   " + GHEAD.headType);
    console.debug("chechSum   " + GHEAD.checkSum);
    console.debug("version    " + GHEAD.version);
    console.debug("crc        " + GHEAD.crc);
    console.debug("nfiles     " + GHEAD.nfiles);
    console.debug("compmethod " + GHEAD.compMethod);

    compMethod = Number(GHEAD.compMethod);
    if ((compMethod != LH5) && (compMethod != LH0)) {
        console.log("Error file");
        return;
    }
    let time = uh2uw([compSeg[6], compSeg[5]]);
    console.debug("time       " + time[0]); // 書庫付箋の生成日時
    console.debug("filesize   " + GHEAD.fileSize); // 含まれる実身の合計サイズ
    console.debug("orgsize    " + GHEAD.origSize); // 圧縮部の非圧縮サイズ
    console.debug("compsize   " + GHEAD.compSize); // 圧縮部の圧縮サイズ
    console.debug("extsize    " + GHEAD.extSize); // 拡張部のサイズ

    /* crc テーブルを作成する */
    make_crctable();

    /* CRCを初期化する */  

    var startPos = nowPos + 66 + 30 + 8; // nowPos38 + Number(0x42) + 30;
    tadCompSize = GHEAD.compSize + startPos + 66 + 30; // 66は仮身セグメントの長さ、30はローカルヘッダの長さ
    tadPos = startPos;
    origsize = GHEAD.origSize;
    compsize = GHEAD.compSize;
    crc = INIT_CRC;
    
    // Initialize LH5 decoder if needed
    if (compMethod == LH5) {
        lh5Decoder = new LH5Decoder();
        lh5Decoder.init(new Uint8Array(tadRawBuffer, tadPos), 0);
    }


    console.log("startPos : " + startPos);

    // Read extended data (ルート仮身)
    const extBuf = new Uint16Array(250);
    const extData = new Uint8Array(GHEAD.extSize);
    xRead(compMethod, extData, GHEAD.extSize);

    // Convert to Uint16Array
    const extView = new DataView(extData.buffer);
    for (let i = 0; i < GHEAD.extSize / 2; i++) {
        extBuf[i] = extView.getUint16(i * 2, true);
    }
    
    // if (extBuf[0] !== VOBJ) {
    //     throw new Error('Invalid extended data');
    // }
    console.debug("tadPos :" + tadPos);

    // ローカルヘッダの読込 ここから解凍しながら読込
    let localHeadLen = 96; // ローカルヘッダの長さ
    LHEAD = new Array(GHEAD.nfiles);


    for (let localheadLoop=0;localheadLoop<GHEAD.nfiles;localheadLoop++) {
        console.log("localHead Num :" + GHEAD.nfiles);
        console.log("localHead tadPos" + tadPos);

        const lheadData = new Uint8Array(localHeadLen);
        xRead(compMethod, lheadData, localHeadLen);

        const lhead = new LocalHead();
        const view = new DataView(lheadData.buffer);
        let offset = 0;
        var compLocalHeadSeg = new Array();
        for(let i = 0; i < 48; i++) {
            compLocalHeadSeg.push(view.getUint16(i));
        }

        lhead.f_type = view.getUint16(offset, true); offset += 2;
        lhead.f_atype = view.getUint16(offset, true); offset += 2;
        
        // Read name (20 TC chars = 40 bytes)
        for (let j = 0; j < 20; j++) {
            lhead.name[j] = view.getUint16(offset, true);
            offset += 2;
        }

        lhead.origId = IntToHex(view.getUint16(offset, true), 4).replace('0x', ''); offset += 2;
        lhead.compMethod = IntToHex(view.getUint16(offset, true), 4).replace('0x', ''); offset += 2;
        lhead.origSize = uh2uw([view.getUint16(offset + 2, true), view.getUint16(offset, true)])[0]; offset += 4;
        lhead.compSize = uh2uw([view.getUint16(offset + 2, true), view.getUint16(offset, true)])[0]; offset += 4;

        // Skip reserve[4]
        offset += 8;

        lhead.f_nlink = IntToHex(view.getUint16(offset, true), 4).replace('0x', ''); offset += 2;
        lhead.crc = IntToHex(view.getUint16(offset, true), 4).replace('0x', ''); offset += 2;
        lhead.f_size = uh2uw([view.getUint16(offset + 2, true), view.getUint16(offset, true)])[0]; offset += 4;
        lhead.offset = uh2uw([view.getUint16(offset + 2, true), view.getUint16(offset, true)])[0]; offset += 4;
        lhead.f_nrec = uh2uw([view.getUint16(offset + 2, true), view.getUint16(offset, true)])[0]; offset += 4;
        lhead.f_ltime = uh2uw([view.getUint16(offset + 2, true), view.getUint16(offset, true)])[0]; offset += 4;
        lhead.f_atime = uh2uw([view.getUint16(offset + 2, true), view.getUint16(offset, true)])[0]; offset += 4;
        lhead.f_mtime = uh2uw([view.getUint16(offset + 2, true), view.getUint16(offset, true)])[0]; offset += 4;
        lhead.f_ctime = uh2uw([view.getUint16(offset + 2, true), view.getUint16(offset, true)])[0]; offset += 4;

        console.debug("LocalHead_name :" + lhead.name);
        console.debug("LocalHead_origId :" + lhead.origId);
        console.debug("LocalHead_compMethod :" + lhead.compMethod);
        console.debug("LocalHead_orgsize :" + lhead.origSize);
        console.debug("LocalHead_compSize :" + lhead.compSize);
        console.debug("LocalHead_f_nlink :" + lhead.f_nlink);
        console.debug("LocalHead_crc :" + lhead.crc);
        console.debug("LocalHead_fsize :" + lhead.f_size);
        console.debug("LocalHead_offset :" + lhead.offset);
        console.debug("LocalHead_nrec :" + lhead.f_nrec);
        console.debug("LocalHead_f_ltime :" + lhead.f_ltime);
        
        LHEAD[localheadLoop] = lhead;
        tadPos += localHeadLen; // ローカルヘッダの長さ分進める
    }

    pass1();
    console.log('PASS1 ok!!');

    pass2(LHEAD);
    console.log('PASS2 ok!!');
    

    
}

/**
 * TADパーサー TADセグメントを判定
 * @param {0x0000} segID 
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 * @param {int} nowPos
 */
function tadPerse(segID, segLen, tadSeg, nowPos) {
    console.log("tadSeg " + IntToHex((segID),4).replace('0x',''));

    if (segID === Number(TS_INFO)) {
        console.log('管理情報セグメント');
        tadVer(tadSeg);
    } else if (segID === Number(TS_TEXT)) {
        console.log('文章開始セグメント');
        tsTextStart(tadSeg);
    } else if (segID === Number(TS_TEXTEND)) {
        console.log('文章終了セグメント');
        tsTextEnd(tadSeg);
    } else if (segID === Number(TS_FIG)) {
        console.log('図形開始セグメント');
        tsFig(tadSeg);
    } else if (segID === Number(TS_FIGEND)) {
        console.log('図形終了セグメント');
    } else if (segID === Number(TS_IMAGE)) {
        console.log('画像セグメント');
    } else if (segID === Number(TS_VOBJ)) {
        console.log('仮身セグメント');
        tsVirtualObjSegment(segLen, tadSeg);
    } else if (segID === Number(TS_DFUSEN)) {
        console.log('指定付箋セグメント');
        tsSpecitySegment(segLen, tadSeg, nowPos);
    } else if (segID === Number(TS_FFUSEN)) {
        console.log('機能付箋セグメント');
    } else if (segID === Number(TS_TPAGE)) {
        console.log('文章ページ割付け指定付箋');
        tadPageSetFusen(segLen, tadSeg);
    } else if (segID === Number(TS_TRULER)) {
        console.log('行書式指定付箋');
        tadRulerSetFusen(segLen, tadSeg);
    } else if (segID === Number(TS_TFONT)) {
        console.log('文字指定付箋');
        tadFontSetFusen(segLen, tadSeg);
    } else if (segID === Number(TS_TCHAR)) {
        console.log('特殊文字指定付箋');
    } else if (segID === Number(TS_TATTR)) {
        console.log('文字割り付け指定付箋');
    } else if (segID === Number(TS_TSTYLE)) {
        console.log('文字修飾指定付箋');
    } else if (segID === Number(TS_TVAR)) {
        console.log('変数参照指定付箋');
    } else if (segID === Number(TS_TMEMO)) {
        console.log('文章メモ指定付箋');
    } else if (segID === Number(TS_TAPPL)) {
        console.log('文章アプリケーション指定付箋');
    } else if (segID === Number(TS_FPRIM)) {
        console.log('図形要素セグメント');
        tsFigDraw(segLen, tadSeg);
    } else if (segID === Number(TS_FDEF)) {
        console.log('データ定義セグメント');
        tsDataSet(segLen, tadSeg);
    } else if (segID === Number(TS_FGRP)) {
        console.log('グループ定義セグメント');
    } else if (segID === Number(TS_FMAC)) {
        console.log('マクロ定義/参照セグメント');
    } else if (segID === Number(TS_FATTR)) {
        console.log('図形修飾セグメント');
    } else if (segID === Number(TS_FPAGE)) {
        console.log('図形ページ割り付け指定付箋');
    } else if (segID === Number(TS_FMEMO)) {
        console.log('図形メモ指定付箋');
    } else if (segID === Number(TS_FAPPL)) {
        console.log('図形アプリケーション指定付箋');
    }
}

/**
 * TRONコードを判定
 * TODO: 現状はTRON仕様日本文字コードの第1面 Aゾーン(JIS X 0208)のみ対応
 * @param {char} char 
 * @returns 
 */
function charTronCode(char) {
    let charBuffer = new ArrayBuffer(2);
    let dv = new DataView(charBuffer);
    dv.setUint16(0, char);

    var char8 = new Array(Number(dv.getUint8(0,false)),Number(dv.getUint8(1,false)));
    //var char8 = new Array();
    var int1 = Number(dv.getUint8(0,false));
    var int2 = Number(dv.getUint8(1,false));

    var text = '';

    // TRONコード 面切替
    if ((char >= Number(0xfe21) && char <= Number(0xfe7e) )
    || (char >= Number(0xfe80) && char <= Number(0xfefe))) {
        tronCodeMask[textNest] = char - Number(0xfe21) + 1;
        console.log("TRON Code面 :" + tronCodeMask[textNest])
    }


    // TRONコード 第1面 Aゾーン(JIS X 0208)をjsのUNICODEに変換
    // TODO: JIS2UNICODEが上手く動作しないため、JISをSJISに変換後、SJI2UNICODEを実施
    if ((char >= Number(0x2121) && char <= Number(0x227e) )
    || (char >= Number(0x2420) && char <= Number(0x7e7e))) {
        if (int1 % 2) {
            int1 = ((int1 + 1) / 2) + Number(0x70);
            int2 = int2 + Number(0x1f);
        } else{
            int1 = (int1 / 2) + Number(0x70);
            int2 = int2 + Number(0x7d);
        }
        if (int1 >= Number(0xa0)) {
            int1 = int1 + Number(0x40);
        }
        if (int2 >= Number(0x7f)) {
            int2 = int2 + Number(1);
        }
        
        //console.log('JIS Zone');

        var unicodeArray = Encoding.convert([int1,int2],{
            to: 'UNICODE',
            from: 'SJIS'
        });

        text = Encoding.codeToString(unicodeArray);

    } else if (char >= Number(0x2320) && char <= Number(0x237f)) {
        text = String.fromCharCode(char8[1]);
    } else if (char == Number(TC_NL)
        || char == Number(TC_CR)
        || char == Number(TC_TAB)
        || char == Number(TC_FF)) {
        text = String.fromCharCode(char8[1]);
    }
    return text;
}
var moveflg = 0,
    Xpoint,
    Ypoint;

//初期値（サイズ、色、アルファ値）の決定
var defSize = 7,
    defColor = "#555";

function startPoint(e) {
    e.preventDefault();
    ctx.beginPath();
    Xpoint = e.pageX - canvas.offsetLeft;
    Ypoint = e.pageY - canvas.offsetTop;
    ctx.moveTo(Xpoint, Ypoint);
}

function movePoint(e) {
    if (e.buttons === 1 || e.witch === 1 || e.type == 'touchmove') {
        Xpoint = e.pageX - canvas.offsetLeft;;
        Ypoint = e.pageY - canvas.offsetTop;;
        moveflg = 1;

        ctx.lineTo(Xpoint, Ypoint);
        ctx.lineCap = "round";
        ctx.lineWidth = defSize * 2;
        ctx.strokeStyle = defColor;
        ctx.stroke(); 
    }
}

function endPoint(e) {
    if (moveflg === 0) {
        ctx.lineTo(Xpoint-1, Ypoint-1);
        ctx.lineCap = "round";
        ctx.lineWidth = defSize * 2;
        ctx.strokeStyle = defColor;
        ctx.stroke();
    }
    moveflg = 0;
}

function clearCanvas(ctx, width, height) {
    // キャンバス全体をクリア
    ctx.clearRect(0, 0, width, height);
    
    // 背景を白で塗りつぶす
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, width, height);
    
    // 描画スタイルをデフォルトに戻す
    ctx.fillStyle = 'black';
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1;
}

/**
 * Canvas 描画領域を初期化
 */
function canvasInit() {
    canvas = document.getElementById('canvas');
    if (canvas.getContext) {
        ctx = canvas.getContext('2d');
    }

    // キャンバスをクリア
    clearCanvas(ctx, canvas.width, canvas.height);
    
    canvas.width = canvasW;
    canvas.height = canvasH;

    ctx.clearRect(0, 0, ctx.canvas.clientWidth, ctx.canvas.clientHeight);
    
    // PC対応
    canvas.addEventListener('mousedown', startPoint, false);
    canvas.addEventListener('mousemove', movePoint, false);
    canvas.addEventListener('mouseup', endPoint, false);
    // スマホ対応
    canvas.addEventListener('touchstart', startPoint, false);
    canvas.addEventListener('touchmove', movePoint, false);
    canvas.addEventListener('touchend', endPoint, false);
}


function tadDataArray(raw) {
    if (raw && raw.p instanceof Uint8Array) {
        raw = raw.p;
    }

    var rawBuffer = raw.buffer;
    var data_view = new DataView( rawBuffer );

    tadRaw = new Uint8Array(raw);  // slice()を追加
    tadRawBuffer = tadRaw.buffer;
    tadDataView = new DataView( tadRawBuffer );


    let i = 0;

    while(i<1000000) {
        let nowPos = i;   
        let P4 = '';
        if (i >= raw.length) break;
        let raw16 = data_view.getUint16(i,true);

        if (raw16 === Number(TNULL)) {
            // 終端
            tadTextDump += 'buffer over.\r\n';
            planeTextDump += 'EOF\r\n';
            break;
        }

        let segID = '';
        let segLen = 0;
        let tadSeg = new Array();

        if (raw16 > Number(0xff00)) {
            if (raw16 === Number(0xfffe)) {
                i += 2;
                raw16 = data_view.getUint16(i,true);
                if (raw16 >= Number(0xfe00)) {
                    i += 2;
                    raw16 = data_view.getUint16(i,true);
                    // 0x321 - 0x3FD
                    if (raw16 === Number(0xfefe)) {
                        i += 2;
                        segID = data_view.getUint16(i,true) + 0xff00; // + 0x300;  
                        i += 2;

                    // 0x221 - 0x2FD
                    } else{
                        segID = data_view.getUint8(i,true) + 0xff00; // + 0x200;  
                        i += 2;
                    }
                // 0x121 - 0x1FD
                } else{
                    segID = data_view.getUint16(i,true) + 0xff00; // + 0x100;  
                    i += 2;
                }
            // 0x80 - 0xFD
            } else{
                segID = data_view.getUint8(i,true) + 0xff00;  
                i += 2;
            }
            tadTextDump  += ' segID = ( ' + IntToHex((segID),4).replace('0x','') + ' ) ';

            segLen = Number(data_view.getUint16(i,true));
            if (segLen === Number(0xffff)) {
                i += 2;
                segLen = Number(data_view.getUint32(i,true));
                i += 4;

            }else{
                i += 2;
            }
            tadTextDump  += ' segLen = ( ' + IntToHex((segLen),4).replace('0x','') + ' ) ';

            for(let offsetLen=0;offsetLen<segLen;offsetLen=offsetLen+2) {
                let offsetRaw = data_view.getUint16(i + offsetLen,true);
                tadTextDump  += ' ' + IntToHex(Number(offsetRaw),4).replace('0x','');
                tadSeg.push(offsetRaw);
            }
            i += segLen;
            tadPerse(segID, segLen, tadSeg, nowPos);

        }else{
            let raw8Plus1 = Number(data_view.getUint16(i,true));
            let char = charTronCode(raw8Plus1);
            tadTextDump  += 'char = ( ' + IntToHex((raw8Plus1),4).replace('0x','') + ' )' + char;
            planeTextDump += char;
            P4 += char;
            i += 2;
            if (textNest > 0){
                drawText(ctx, char, textFontSize,  textCharPoint[textNest-1][0],textCharPoint[textNest-1][1] ,textCharPoint[textNest-1][2], textFontSize * 1.2);
            }
        }

        textCharList[textNest-1] += P4;

        tadTextDump += '\r\n';
        tadTextDump += IntToHex((i),8).replace('0x','') + ' ';
    }
    document.getElementById('BainryInfo').innerHTML = 
        'This File Size : ' + setComma(raw.length) +' Byte<br>Maximum displaye Size : 1000KB(1,000,000 Byte)';
    document.getElementById('tadDumpView').innerHTML = htmlspecialchars(tadTextDump);  
    document.getElementById('tadTextView').innerHTML = htmlspecialchars(planeTextDump);
}

/**
 * TADファイル読込処理
 * @param {event} event 
 */
function onAddFile(event) {
    var files;
    var reader = new FileReader();
    var tadRecord = ''
    var linkRecord = ''

    canvasInit();
    
    if (event.target.files) {
        files = event.target.files;
    }else{
        files = event.dataTransfer.files;   
    }
    let fileNum  = files.length;
    tadRecord = files[0];
    for(let numLoop=0;numLoop<fileNum;numLoop++) {
        if (files[numLoop].name.includes('.000')) {
            linkRecord = files[numLoop]
            console.log("link Record" + linkRecord)
        }
        if (numLoop = fileNum - 1) {
            tadRecord = files[numLoop]
            console.log("TAD Record" + tadRecord)
        }
    }

    reader.onload = function (event) {
        let raw = new Uint8Array(reader.result);
        // console.debug(raw);
        tadDataArray(raw);
    };

    if (fileNum > 0) {
        reader.readAsArrayBuffer(tadRecord);
        document.getElementById("inputfile").value = '';
    }

}

/**
 * TAD保存処理
 * TODO: 未実装
 * @returns null
 */
function save() {
    // テキストエリアより文字列を取得
    const txt = document.getElementById('txt').value;
    if (!txt) {return;}

    // 文字列をBlob化
    const blob = new Blob([txt],{ type: 'text/plain' });

    // ダウンロード用のaタグ生成
    const a = document.createElement('a');
    a.href =  URL.createObjectURL(blob);
    a.download = 'sample.txt';
    a.click();
}

// Export functions to global scope for HTML event handlers
if (typeof window !== 'undefined') {
    window.onAddFile = onAddFile;
    window.onDrop = onDrop;
    window.onDragOver = onDragOver;
    window.save = save;
}
