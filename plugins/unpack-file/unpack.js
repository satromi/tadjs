/**
 * ✅ MODIFIED VERSION - CACHE BUSTER 2025-01-XX-17:00 ✅
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
 *
 * BTRONのドキュメント形式である文章TAD、図形TADをブラウザ上で表示するツールです
 * @link https://github.com/satromi/tadjs
 * @author satromi@gmail.com Tw  @satromi
 * @license https://www.apache.org/licenses/LICENSE-2.0 Apache-2.0
*/




// グローバル変数は関数内でローカル変数として使用



// XMLダンプ強制有効化フラグ（parseTADToXML関数用）
let forceXmlDumpEnabled = false;

function isXmlDumpEnabled() {
    // 強制有効化フラグが立っている場合
    if (forceXmlDumpEnabled) {
        return true;
    }

    if (typeof document !== 'undefined') {
        const checkbox = document.getElementById('xml-dump-enabled');
        return checkbox ? checkbox.checked : false;
    }
    return false;
}

// XMLパース関連のグローバル変数
let xml = [];  // グローバル配列: 各ファイルのXML出力を格納
let parseXML = '';  // 現在処理中のXML文字列
let xmlBuffer = [];  // XML構築用のバッファ
let isInDocSegment = false;  // 文章セグメント内かどうかのフラグ
let isParagraphOpen = false;  // 段落タグが開いているかどうかのフラグ

let currentFileIndex = 0;  // Track current file index for multiple tabs
let currentXmlSlotIndex = -1;  // Track XML slot index for TAD records

// 実身ID管理用グローバル変数
let realIdMap = new Map();  // lHead index -> UUID mapping
let archiveFiles = [];  // 解凍された実身情報の配列
let generatedImages = [];  // 生成された画像情報の配列
let isProcessingBpk = false;  // Flag to indicate BPK processing
let lheadToCanvasMap = {};  // Map from lHead file index to actual canvas index
let recordTypeMap = {};  // Map: fileIndex -> array of record types
let calcRecordTypeMap = {};  // Map for calc TAD: fileIndex -> array of record types    
let startTadSegment = false;
let startByImageSegment = false;
let isTadStarted = false; // TAD開始フラグ
let isXmlTad = false; // XMLTADフラグ
let isXmlFig = false; // XMLFIGフラグ
let isCalcTad = false; // 基本表計算形式TADフラグ
let calcActiveDecorations = []; // 表計算セルのアクティブな装飾タグ追跡用
let currentIndentLevel = 0; // XMLインデントレベル

// 図形セグメント内のz-index管理用カウンタ
let figureZIndexCounter = 0;

// セグメントタイプ管理用
const SEGMENT_TYPE = {
    NONE: 'none',
    TEXT: 'text',
    FIGURE: 'figure'
};
let segmentStack = [];  // セグメントタイプのスタック
let currentSegmentType = SEGMENT_TYPE.NONE;  // 現在のセグメントタイプ


let colorPattern = []; // 配列として初期化
let groupList = [];

// フォント設定
const defaultFontSize = 14; // デフォルトフォントサイズ
let textFontSize = defaultFontSize;
let textFontSet = textFontSize + 'px serif';

// ルビ関連の状態変数
let rubyState = {
    active: false,           // ルビモード中かどうか
    baseText: '',           // 被ルビ文字列
    rubyText: '',           // ルビ文字列
    position: 0,            // 0: 行戻し側（上/右）、1: 行送り側（下/左）
    fontSize: 0.5,          // ルビのフォントサイズ比率（1/2 or 1/3）
    startX: 0,              // ルビ開始位置X
    startY: 0,              // ルビ開始位置Y
    endX: 0,                // ルビ終了位置X
    endY: 0                 // ルビ終了位置Y
};

// 行頭禁則関連の状態変数
let lineStartProhibitionState = {
    active: false,           // 行頭禁則処理が有効かどうか
    level: 0,               // 禁則レベル（0: 一重禁則、1: 多重禁則）
    method: 0,              // 禁則方法（0: 無し、1: 追い出し、2: 追い込み）
    chars: []              // 禁則対象文字のリスト
};

// 行末禁則関連の状態変数
let lineEndProhibitionState = {
    active: false,           // 行末禁則処理が有効かどうか
    level: 0,               // 禁則レベル（0: 一重禁則、1: 多重禁則）
    method: 0,              // 禁則方法（0: 無し、1: 追い出し、2: 追い込み）
    chars: []              // 禁則対象文字のリスト
};
let textFontStyle = 'normal';
const defaultFontWeight = 400;
let textFontWeight = defaultFontWeight;
let textFontStretch = 'normal';
let textFontColor = '#000000';

// テキスト装飾状態管理
let textDecoration = {
    strong : false,
    underline: false,
    overline: false,
    strikethrough: false,
    box: false,
    invert: false,
    mesh: false,
    background: false,
    noprint: false
}

// 変数参照管理
let variableReferences = new Map(); // ユーザー定義変数
let currentPageNumber = 1;          // 現在のページ番号
let totalPageNumber = 1;            // 全体のページ番号
let documentFileName = '';          // 実身名

// 文章、図形メモ管理
let documentMemos = [];             // 文章メモの配列
let figureMemos = [];               // 図形メモの配列

// 図形要素修飾管理
let figureModifierState = {
    hasArrow: false,                // 矢印修飾があるかどうか
    startArrow: false,              // 開始点に矢印を描画
    endArrow: false                 // 終了点に矢印を描画
};

// 座標変換状態管理（直後のセグメントに適用）
let figureTransformState = {
    active: false,                  // 変換が有効かどうか
    dh: 0,                          // 水平方向移動量
    dv: 0,                          // 垂直方向移動量
    hangle: 0,                      // 回転角度（度）、反時計回り
    vangle: 0                       // 傾斜角度（度）、-90 < vangle < +90
};

// 図形設定
let drawLineColor = '#000000';
let drawLineWidth = 1;
let drawFillColor = '#FFFFFF';
let colorMap = [];

// 線種定義（デフォルト値）
let linePatternDefinitions = {
    0: [],                    // 実線
    1: [6, 3],               // 破線
    2: [2, 2],               // 点線
    3: [8, 3, 2, 3],         // 一点鎖線
    4: [8, 3, 2, 3, 2, 3],   // 二点鎖線
    5: [12, 4]               // 長破線
};

// マスクデータ定義
let maskDefinitions = new Map();

/**
 * マスクデータクラス
 */
class MaskData {
    constructor(id, hsize, vsize, maskBits) {
        this.id = id;        // マスクID
        this.hsize = hsize;  // 横サイズ
        this.vsize = vsize;  // 縦サイズ
        this.maskBits = maskBits; // ビットマスクデータ
    }
    
    /**
     * 指定座標のマスク値を取得（1:描画, 0:描画しない）
     * @param {number} x - X座標
     * @param {number} y - Y座標
     * @returns {number} マスク値
     */
    getMaskValue(x, y) {
        if (x < 0 || x >= this.hsize || y < 0 || y >= this.vsize) {
            return 0; // 範囲外は描画しない
        }
        
        // パターンの繰り返し
        const patternX = x % this.hsize;
        const patternY = y % this.vsize;
        
        // バイト位置とビット位置を計算
        const bytesPerRow = Math.ceil(this.hsize / 8);
        const byteIndex = patternY * bytesPerRow + Math.floor(patternX / 8);
        const bitIndex = 7 - (patternX % 8); // MSBから開始
        
        if (byteIndex >= this.maskBits.length) {
            return 0;
        }
        
        const bit = (this.maskBits[byteIndex] >> bitIndex) & 1;
        
        return bit;
    }
    
    // マスクが全て1かどうかをチェック
    isAllOnes() {
        const totalBits = this.hsize * this.vsize;
        let onesCount = 0;
        
        for (let y = 0; y < this.vsize; y++) {
            for (let x = 0; x < this.hsize; x++) {
                if (this.getMaskValue(x, y) === 1) {
                    onesCount++;
                }
            }
        }
        
        return onesCount === totalBits;
    }
}

// デフォルトマスク1-13を定義（4x4パターン）
function initializeDefaultMasks() {
    // マスク1: 0000000000000000 (全て描画しない)
    maskDefinitions.set(1, new MaskData(1, 4, 4, [0x00, 0x00, 0x00, 0x00]));    
    // マスク2: 1000000000100000
    maskDefinitions.set(2, new MaskData(2, 4, 4, [0x80, 0x00, 0x20, 0x00]));    
    // マスク3: 1010000010100000
    maskDefinitions.set(3, new MaskData(3, 4, 4, [0xA0, 0x00, 0xA0, 0x00]));
    // マスク4: 1010010110100101
    maskDefinitions.set(4, new MaskData(4, 4, 4, [0xA0, 0x50, 0xA0, 0x50]));
    // マスク5: 1010111110101111
    maskDefinitions.set(5, new MaskData(5, 4, 4, [0xA0, 0xF0, 0xA0, 0xF0]));
    // マスク6: 1011111111101111
    maskDefinitions.set(6, new MaskData(6, 4, 4, [0xB0, 0xF0, 0xE0, 0xF0]));
    // マスク7: 1111111111111111 (全て描画)
    maskDefinitions.set(7, new MaskData(7, 4, 4, [0xF0, 0xF0, 0xF0, 0xF0]));
    // マスク8: 0100010001000100 (垂直線)
    maskDefinitions.set(8, new MaskData(8, 4, 4, [0x40, 0x40, 0x40, 0x40]));
    // マスク9: 0000111100000000 (水平線)
    maskDefinitions.set(9, new MaskData(9, 4, 4, [0x00, 0xF0, 0x00, 0x00]));
    // マスク10: 0001001001001000
    maskDefinitions.set(10, new MaskData(10, 4, 4, [0x10, 0x20, 0x40, 0x80]));
    // マスク11: 0001100001000010
    maskDefinitions.set(11, new MaskData(11, 4, 4, [0x10, 0x80, 0x40, 0x20]));
    // マスク12: 0100111101000100
    maskDefinitions.set(12, new MaskData(12, 4, 4, [0x40, 0xF0, 0x40, 0x40]));
    // マスク13: 0001101001001010
    maskDefinitions.set(13, new MaskData(13, 4, 4, [0x10, 0xA0, 0x40, 0xA0]));
}

let tadRaw;
let tadRawBuffer;
let tadDataView;
let tadPos = 0;
let tadRecordDataArray = [];




// リンクレコード対応
let linkRecordList = []; // リンクレコードリスト
let execFuncRecordList = []; // 実行機能付箋レコードリスト
let linkNo = 0;



// 文字修飾状態管理
let textDecorations = {
    underline: null,
    overline: null,
    strikethrough: null,
    box: null,
    invert: null,
    mesh: null,
    background: null,
    bold: null,
    italic: null,
    bagChar: null,
    noprint: null
};
// 装飾が適用される文字位置を記録
let decorationRanges = {
    underline: [],
    overline: [],
    strikethrough: [],
    box: [],
    invert: [],
    mesh: [],
    background: [],
    bold: [],
    italic: [],
    bagChar: [],
    noprint: []
};

/**
 * 現在アクティブな文字修飾タグ名の配列を取得
 * 仮身出力時に文字修飾を一時的に閉じて再開するために使用
 * @returns {string[]} アクティブな文字修飾タグ名の配列
 */
function getActiveDecorations() {
    const active = [];
    if (textDecorations.underline) active.push('underline');
    if (textDecorations.overline) active.push('overline');
    if (textDecorations.strikethrough) active.push('strikethrough');
    if (textDecorations.box) active.push('box');
    if (textDecorations.invert) active.push('invert');
    if (textDecorations.mesh) active.push('mesh');
    if (textDecorations.background) active.push('background');
    if (textDecorations.noprint) active.push('noprint');
    return active;
}

// 添え字状態管理
let subscriptState = {
    active: false,          // 添え字モードが有効か
    type: 0,                // 0:下付き, 1:上付き
    position: 0,            // 位置指定 (F値) 0:前置, 1:後置
    unit: 1,                // 0:文字列単位, 1:文字単位
    targetPosition: 0,      // U値: 0:右(右下/右上), 1:左(左下/左上)
    baseline: 0,            // pos値: ベースライン位置 (0:下, 1:上, 2:中央, 3:左, 4:右)
    fontSize: 0.7,          // 添え字のフォントサイズ比率
    offset: { x: 0, y: 0 }  // 添え字のオフセット位置
};

const localHeadSize = 96;



// 新設計：各TADファイル(nfiles)ごとの描画バッファシステム

let tadRawDataArray = {};      // 各TADファイル(nfiles)ごとのrawデータ保存


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

// 基本表計算形式アプリケーションID
const calcAppId1    = 0x8000;
const calcAppId2    = 0x0009;
const calcAppId3    = 0x8000;

//その他のレコードタイプ対応フラグ
let enableAnotherRecord = false;

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

// TADセグメント:長方形
class RECT {
    constructor() {
        this.left = 0;    // H (16-bit)
        this.top = 0;     // H (16-bit)
        this.right = 0;   // H (16-bit)
        this.bottom = 0;  // H (16-bit)
    }
}

// TADセグメント:カラー
class COLOR {
    constructor() {
        this.transparent = false; // true: 透明色
        this.mode = 1; // 0: 28bitカラー, 1: 絶対RGB指定, 2: 予約
        this.color = ''; // 色コード
        this.r = 0;  // R (8-bit)
        this.g = 0;  // G (8-bit)
        this.b = 0;  // B (8-bit)
    }
}

// TADセグメント:カラーパターン付箋
class COLORPATTERN {
    constructor() {
        this.type = 0; // UB
        this.id = 0; // UH
        this.hsize = 0; // UH
        this.vsize = 0; // UH
        this.ncol = 0; // UH
        this.fgcolArray = []; // COLOR()配列
        this.bgcol = new COLOR(); // COLORのみ
        this.mask = []; // UH[]
        this.patternData = null; // 2次元配列のパターンデータ
    }
}

// TADセグメント:文章開始付箋
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

// TADセグメント:図形開始付箋
class STARTFIGSEG {
    constructor() {
        this.view = new RECT();
        this.draw = new RECT();
        this.h_unit = 0;  // UNITS(UH)
        this.v_unit = 0;  // UNITS(UH)
    }       
}

class IMAGESEG {
    constructor() {
        this.view = new RECT();
        this.draw = new RECT();
        this.h_unit = 0;  // UNITS(UH)
        this.v_unit = 0;  // UNITS(UH)
        this.slope = 0;  // H
        this.color = new COLOR();
        this.cinfo = [];
        this.extlen = 0; // UW
        this.extend = 0; // UW
        this.mask = 0; // UW
        this.compac = 0; // H
        this.planes = 0; // H
        this.pixbits = 0; // H
        this.rowbytes = 0; // H
        this.bounds = new RECT();
        this.base_off = []; // UW
        this.planedata = 0;
        this.maskdata = 0;
        this.extenddata = 0;
        
        // 追加プロパティ
        this.bitmap = null;                 // ビットマップデータ
        this.imageData = null;              // ImageData
    }
}

// TADセグメント:指定付箋
class DFUSENSEG {
    constructor() {
        this.view = new RECT();
        this.chsz = 0;  // CHSIZE (UH)
        this.frcol = new COLOR();  // UH[2]
        this.chcol = new COLOR();  // UH[2]
        this.tbcol = new COLOR();  // UH[2]
        this.pict = 0;  // UH
        this.appl = [0, 0, 0];  // UH[3]
        this.name = new Array(16).fill(0);  // TC[16]
        this.dlen = [0, 0];  // UH[2]
    }
}

// TADセグメント:仮身付箋
class VOBJSEG {
    constructor() {
        this.view = new RECT();
        this.height = 0;  // H (16-bit)
        this.chsz = 0;  // CHSIZE (UH)
        this.frcol = new COLOR();  // UH[2]
        this.chcol = new COLOR();  // UH[2]
        this.tbcol = new COLOR();  // UH[2]
        this.bgcol = new COLOR();  // UH[2]
        this.dlen = 0;  // UH
        this.data = [];  // UB[]
    }
}

// TADセグメント:リンク付箋
class LINK {
    constructor() {
        this.fs_name = "";  // TC[20]
        this.f_id = 0;      // UH (16-bit)
        this.atr1 = 0;      // UH (16-bit)
        this.atr2 = 0;      // UH (16-bit)
        this.atr3 = 0;      // UH (16-bit)
        this.atr4 = 0;      // UH (16-bit)
        this.atr5 = 0;      // UH (16-bit)
    }
}

// リンクレコード
class LINKRECORD {
    constructor() {
        this.fs_name = "";  // TC[20]
        this.link_name = ""; // TC[20]
        this.link_id = 0;      // UH (16-bit)
        this.atr1 = 0;      // UH (16-bit)
        this.atr2 = 0;      // UH (16-bit)
        this.atr3 = 0;      // UH (16-bit)
        this.atr4 = 0;      // UH (16-bit)
        this.atr5 = 0;      // UH (16-bit)
        this.left = 0;         // UH (16-bit)
        this.top = 0;          // UH (16-bit)
        this.right = 0;       // UH (16-bit)
        this.bottom = 0;      // UH (16-bit)
    }

}

// EXECFUNCRECORD (実行機能付箋レコード) 構造体クラス
// EXECFUNCRECORD (実行機能付箋レコード) クラス
class EXECFUNCRECORD {
    constructor() {
        this.view = new RECT(); // view
        this.chsz = 0;  // CHSIZE (UH)
        this.frcol = new COLOR();  // UH[2]
        this.chcol = new COLOR();  // UH[2]
        this.tbcol = new COLOR();  // UH[2]
        this.pict = 0;  // pict (UH)
        this.appl = [0, 0, 0];  // UH[3]
        this.name = new Array(32).fill(0);  // TC[32]
        this.type = new Array(32).fill(0);  // TC[32]
        this.dlen = 0;  // UH
        this.data = [];  // UB[]
        this.window_view = new RECT(); // view
    }
}

// TADセグメント:用紙サイズ付箋
class PaperSize {
    constructor() {
        this.binding = 0;          // 綴じ方向 0:左綴じ, 1:右綴じ
        this.imposition = 0;       // 面付け指定 0:1面付け, 1:2面付け
        this.length = 0;           // 用紙長さ
        this.width = 0;            // 用紙幅
        this.top = 0;              // 上余白
        this.bottom = 0;           // 下余白
        this.left = 0;             // 左余白
        this.right = 0;            // 右余白
        this.margin = []; // マージン
    }
}

// 用紙サイズ定数定義（width/length: ポイント、widthMm/lengthMm: ミリメートル、72dpi基準）
const PAPER_SIZES = {
    // A判シリーズ（ISO 216）
    A0: { width: 2384, length: 3370, widthMm: 841, lengthMm: 1189, name: 'A0' },
    A1: { width: 1684, length: 2384, widthMm: 594, lengthMm: 841, name: 'A1' },
    A2: { width: 1191, length: 1684, widthMm: 420, lengthMm: 594, name: 'A2' },
    A3: { width: 842, length: 1191, widthMm: 297, lengthMm: 420, name: 'A3' },
    A4: { width: 595, length: 842, widthMm: 210, lengthMm: 297, name: 'A4' },
    A5: { width: 420, length: 595, widthMm: 148, lengthMm: 210, name: 'A5' },
    A6: { width: 298, length: 420, widthMm: 105, lengthMm: 148, name: 'A6' },
    A7: { width: 210, length: 298, widthMm: 74, lengthMm: 105, name: 'A7' },
    A8: { width: 148, length: 210, widthMm: 52, lengthMm: 74, name: 'A8' },

    // B判シリーズ（JIS B）
    B0: { width: 2920, length: 4127, widthMm: 1030, lengthMm: 1456, name: 'B0' },
    B1: { width: 2064, length: 2920, widthMm: 728, lengthMm: 1030, name: 'B1' },
    B2: { width: 1460, length: 2064, widthMm: 515, lengthMm: 728, name: 'B2' },
    B3: { width: 1032, length: 1460, widthMm: 364, lengthMm: 515, name: 'B3' },
    B4: { width: 729, length: 1032, widthMm: 257, lengthMm: 364, name: 'B4' },
    B5: { width: 516, length: 729, widthMm: 182, lengthMm: 257, name: 'B5' },
    B6: { width: 363, length: 516, widthMm: 128, lengthMm: 182, name: 'B6' },
    B7: { width: 258, length: 363, widthMm: 91, lengthMm: 128, name: 'B7' },
    B8: { width: 181, length: 258, widthMm: 64, lengthMm: 91, name: 'B8' },

    // その他の主要な用紙サイズ
    LETTER: { width: 612, length: 792, widthMm: 215.9, lengthMm: 279.4, name: 'Letter' },           // US Letter (8.5" x 11")
    LEGAL: { width: 612, length: 1008, widthMm: 215.9, lengthMm: 355.6, name: 'Legal' },            // US Legal (8.5" x 14")
    TABLOID: { width: 792, length: 1224, widthMm: 279.4, lengthMm: 431.8, name: 'Tabloid' },        // Tabloid (11" x 17")
    LEDGER: { width: 1224, length: 792, widthMm: 431.8, lengthMm: 279.4, name: 'Ledger' },          // Ledger (17" x 11")
    EXECUTIVE: { width: 522, length: 756, widthMm: 184.2, lengthMm: 266.7, name: 'Executive' },     // Executive (7.25" x 10.5")
    POSTCARD: { width: 283, length: 420, widthMm: 100, lengthMm: 148, name: 'Postcard' },           // はがき (100mm x 148mm)
    POSTCARD_REPLY: { width: 283, length: 567, widthMm: 100, lengthMm: 200, name: 'Reply Postcard' }, // 往復はがき (148mm x 200mm)
    NAGAGATA3: { width: 340, length: 666, widthMm: 120, lengthMm: 235, name: '長形3号' },            // 長形3号封筒 (120mm x 235mm)
    KAKUGATA2: { width: 680, length: 941, widthMm: 240, lengthMm: 332, name: '角形2号' }             // 角形2号封筒 (240mm x 332mm)
};

// TADセグメント:用紙マージン付箋
class PaperMargin {
    constructor() {
        this.top = 0;    // 上余白
        this.bottom = 0; // 下余白
        this.left = 0;   // 左余白
        this.right = 0;  // 右余白
    }
}

// RecordHead
class RecordHead {
    constructor() {
        this.type = 0;     // H (16-bit)
        this.subtype = 0;  // UH (16-bit)
        this.size = 0;     // W (32-bit)
    }
}

// GlobalHead
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

// LocalHead
class LocalHead {
    constructor() {
        this.f_type = null;                     // UH F_STATE 
        this.f_atype = null;                    // UH F_STATE
        this.name = "";      // UH TC[20] ファイル名
        this.origId = null;                     // H 元ファイルのファイルID
        this.compMethod = null;                 // H ファイル別圧縮時の圧縮法
        this.origSize = null;                   // W ファイルのレコードパッキング後の非圧縮サイズ
        this.compSize = null;                   // W ファイル別圧縮時の圧縮サイズ
        this.reserve = [null, null, null, null]; // H[4] 予約領域
        this.f_nlink = null;                    // H F_STATE
        this.crc = null;                        // H ファイル別圧縮時のCRC
        this.f_size = null;                     // W F_SIZE
        this.offset = null;                     // W ファイル本体のオフセット
        this.f_nrec = null;                     // W F_STATE
        this.f_ltime = null;                    // W F_STATE
        this.f_atime = null;                    // W F_STATE
        this.f_mtime = null;                    // W F_STATE
        this.f_ctime = null;                    // W F_STATE
    }
}

// グループID管理
class GROUP {
    constructor() {
        this.id = 0;          // UH (16-bit)
    }
}

let gHead = new GlobalHead();
let lHead = [];

// 用紙サイズ
let paperSize = null;                   // 用紙サイズ（PaperSizeクラスのインスタンス）
let paperMargin = null;                 // 用紙マージン（PaperMarginクラスのインスタンス）

// 行書式
let lineAlign = 0;                      // 0:左揃え,1:中央揃え,2:右揃え,3:両端揃え,4:均等揃え,5～:予約

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
 * 符号なし16ビット整数を符号付き16ビット整数に変換
 * @param {number} value 符号なし16ビット整数（0x0000～0xFFFF）
 * @returns {number} 符号付き16ビット整数（-32768～32767）
 */
function toSignedInt16(value) {
    if (value & 0x8000) value |= ~0xffff;
    return value;
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
 *      console.debug(charTronCode(tadSeg8[offsetLen]));
 *  }
 * @param {0x0000[]} UH
 * @returns
 */
function uh2ub(UH) {
    let uhBuffer = new ArrayBuffer(2);
    let ra16db = new DataView(uhBuffer);
    let tadSeg = [];
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
    if (UH.length % 2 !== 0) {
        throw new Error("UH配列の長さは偶数である必要があります（2つのUint16で1つのUint32を構成）");
    }

    const uwArray = new Uint32Array(UH.length / 2);
    for (let i = 0; i < UH.length; i += 2) {
        const high16 = UH[i];       // 上位16bit
        const low16 = UH[i + 1];    // 下位16bit

        // ビッグエンディアンとして結合（high16が先）
        const uw = (high16 << 16) | low16;
        uwArray[i / 2] = uw;
    }

    return uwArray;
}

/**
 * カンマセット
 * @param {char} S 
 * @returns 
 */
function setComma(S) {
    let result =''; 
    let cnt = 0; 

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
    const SubID = ( UH >> 8);
    //console.debug("UB_SubID" + SubID);
    return SubID;
}

/**
 * UHからUB ATTRを取得
 * @param {UH} UH 
 * @returns 
 */
function getLastUBinUH(UH) {
    const ATTR = ( UH & 0b11111111);  // 全8ビットを取得するように修正
    //console.debug("ATTR" + ATTR);
    return ATTR;
}

/**
 * 下位UBをUHから取得する
 * @param {UH} UH 
 * @returns 
 */
function getBottomUBinUH(UH) {
    const bottomUB = (UH & 0xFF);
    //console.debug("Bottom UB: " + bottomUB);
    return bottomUB;
}

/**
 * カラーを取得
 * @param {*} raw 32bit値
 * @param {*} offset
 * @returns
 */
function parseColor(raw, offset = 0) {

    const msb = (raw >>> 31) & 0x1;
    const modeBits = (raw >>> 28) & 0x7;

    let transparentMode = false;

    if (msb === 1) {
        transparentMode = true;
    }

    if (modeBits === 0) {
        // 28bitカラー（下位28bitがカラー値）
        const color28 = raw & 0x0FFFFFFF;
        const r = (color28 >>> 16) & 0xFF;
        const g = (color28 >>> 8) & 0xFF;
        const b = color28 & 0xFF;
        console.debug(`parseColor: transparent=${transparentMode}, modeBits=${modeBits}, rgb28=${color28}`);
        return {
            transparent: transparentMode,
            mode: modeBits, // 28bitカラー
            color: `#${color28.toString(16).padStart(6, '0')}`,
            r, g, b
        };
    }

    if (modeBits === 1) {
        // 絶対RGB指定
        const r = (raw >>> 16) & 0xFF;
        const g = (raw >>> 8) & 0xFF;
        const b = (raw >>> 0) & 0xFF;
        console.debug(`parseColor: transparent=${transparentMode}, modeBits=${modeBits}, r=${r}, g=${g}, b=${b}`);
        return {
            transparent: transparentMode,
            mode: modeBits,    // 絶対RGB指定
            color: `#${[r, g, b].map(c => c.toString(16).padStart(2, '0')).join('')}`,
            r, g, b
        };
    }

    return {
        transparent: false,
        mode: modeBits,
        raw
    };
}


/* limits.h */
// CHAR_BIT参照用の関数
function getCHAR_BIT() {
    return (typeof window !== 'undefined' && window.CHAR_BIT) || 8;
}
const BUFFERSIZE = 8192;  /* Buffer size for file processing */

/* ar.c */

let compMethod = 0; // Global compression method

/* io.c */

const INIT_CRC = 0;  /* CCITT: 0xFFFF */
let crc;

const CRCPOLY = 0xA001;  /* ANSI CRC-16 */
                       /* CCITT: 0x8408 */
// UCHAR_MAX参照用の関数
function getUCHAR_MAX() {
    return (typeof window !== 'undefined' && window.UCHAR_MAX) || 255;
}

let crctable = null; // 初期化は必要時に実行

/**
 * make_crctable: CRCテーブルを作成する
 */
function make_crctable() {
    console.debug("make_crctable");
    // 遅延初期化
    if (crctable === null) {
        crctable = new Uint16Array(getUCHAR_MAX() + 1);
    }
    for (let i = 0; i <= getUCHAR_MAX(); i++) {
        let r = i;
        for (let j = 0; j < getCHAR_BIT(); j++) {
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
function updateCRC(c) {
    //console.debug("UPDATE_CRC");
    crc = crctable[(crc ^ c) & 0xFF] ^ (crc >>> getCHAR_BIT());
    crc &= 0xFFFF;
}

// LH5 decoder instance
let lh5Decoder = null;

// Global static buffer for LZ77 dictionary (matching C implementation)
let globalStaticN = 0;
let globalStaticBufTop = 0; 

// Global decoder state (static variables from decode.c)
let globalDecodeJ = 0;  // static int j in decode.c
let globalDecodeI = 0;  // static uint i in decode.c

// Working unpack.js style decode buffer management
let decode_buf = null;      // デコード専用バッファ
let decode_n = 0;          // デコード済み総バイト数
let decode_buftop = 0;     // バッファ内位置
let decode_bufsize = 0;    // バッファ内有効データサイズ

// Global decode state accessor functions
let getGlobalDecodeJ = () => 0;
let setGlobalDecodeJ = (value) => {};
let getGlobalDecodeI = () => 0;
let setGlobalDecodeI = (value) => {};
let getGlobalStaticN = () => 0;

// setGlobalDecodeAccessors function for compatibility
function setGlobalDecodeAccessors(getJ, setJ, getI, setI, getN) {
    getGlobalDecodeJ = getJ;
    setGlobalDecodeJ = setJ;
    getGlobalDecodeI = getI;
    setGlobalDecodeI = setI;
    getGlobalStaticN = getN;
}
function xRead(compMethod, p, l) {    
    if (compMethod == LH0) {
        // 非圧縮の場合 - Direct read for uncompressed data
        if (tadPos + l > tadDataView.byteLength) {
            throw new Error("xRead: 読み込み範囲がファイルサイズを超えています");
        }
        
        for (let i = 0; i < l; i++) {
            p[i] = tadDataView.getUint8(tadPos + i);
        }
        tadPos += l;
        return 0; // 成功
    } else {
        // LH5 圧縮モード
        if (lh5Decoder === null) {
            console.error("LH5Decoder is not initialized!");
            return -1;
        }
        
        // Check if LH5Decoder is properly initialized with fileData
        if (!lh5Decoder.fileData || !lh5Decoder.initialized) {
            // Try to initialize LH5Decoder dynamically if raw data is available
            if (tadRawDataArray[currentFileIndex]) {
                console.debug(`Attempting dynamic LH5 decoder initialization for currentFileIndex=${currentFileIndex}`);
                try {
                    lh5Decoder.init(tadRawDataArray[currentFileIndex], tadPos, gHead.compSize, gHead.origSize);
                    lh5Decoder.initialized = true;
                    console.debug("LH5Decoder dynamically initialized successfully");
                } catch (error) {
                    console.error("Failed to dynamically initialize LH5Decoder:", error);
                    return -1;
                }
            } else {
                console.error("LH5Decoder is not properly initialized - fileData missing or not initialized");
                console.debug("Current fileData:", lh5Decoder.fileData ? 'exists' : 'null');
                console.debug("Initialized flag:", lh5Decoder.initialized);
                console.debug(`tadRawDataArray[${currentFileIndex}]:`, tadRawDataArray[currentFileIndex]?.length || 'undefined');
                return -1;
            }
        }

        const bytesRead = lh5Decoder.decode(l, p);
        
        // Update CRC for all read bytes
        for (let i = 0; i < bytesRead; i++) {
            updateCRC(p[i]);
        }
        
        return bytesRead === l ? 0 : -1; // 成功の場合は0、エラーの場合は-1
    }
}


/**
 * Initialize decompression
 */
function tadDecodeStart(currentFileIndex) {
    crc = INIT_CRC;
    decode_n = 0;
    decode_buftop = 0;
    decode_bufsize = 0;
        
    // Create unified LH5Decoder instance from lh5.js
    lh5Decoder = new LH5Decoder();
    lh5Decoder.init(tadRawDataArray[currentFileIndex], tadPos, gHead.compSize, gHead.origSize);
}

/**
 * pass1
 * tadファイルのディレクトリを作成
 * 各ファイルのディレクトリは、ファイルIDをディレクトリ名とする。
 * 例: ファイルIDが0x0001のファイルは、ディレクトリ名が"1"となる。
 */
/**
 * Pass1: 全実身のUUID生成と管理用JSON生成
 * この段階でrealIdMapを完成させる
 */
function pass1() {
    console.log('[Pass1] 実身UUID生成と管理用JSON生成開始');

    // realIdMapをクリア
    realIdMap.clear();

    for (let i = 0; i < gHead.nfiles; i++) {
        const lhead = lHead[i];

        // UUID v7を生成
        const uuid = generateUUIDv7();

        // realIdMapに登録 (lHead index -> UUID)
        realIdMap.set(i, uuid);

        console.log(`[Pass1] 実身 ${i}: ${lhead.name} -> UUID: ${uuid}`);
    }

    console.log(`[Pass1] 完了: ${realIdMap.size} 個の実身UUIDを生成`);
}

/**
 * EXECFUNCRECORD（実行機能付箋レコード）を解析してexecFuncRecordListに追加
 * @param {Uint8Array} recordData レコードデータ
 * @param {number} fileIndex ファイルインデックス
 */
function parseExecFuncRecord(recordData, fileIndex) {
    // EXECFUNCRECORD構造を解析
    const execFuncRecord = new EXECFUNCRECORD();
    const execView = new DataView(recordData.buffer);
    
    // EXECFUNCRECORDの各フィールドを読み込み
    // view (RECT) - offset 0x00
    let recordOffset = 0;
    execFuncRecord.view.left = execView.getUint16(recordOffset, true); recordOffset += 2;
    execFuncRecord.view.top = execView.getUint16(recordOffset, true); recordOffset += 2;
    execFuncRecord.view.right = execView.getUint16(recordOffset, true); recordOffset += 2;
    execFuncRecord.view.bottom = execView.getUint16(recordOffset, true); recordOffset += 2;

    // chsz (UH) - offset 0x08
    execFuncRecord.chsz = execView.getUint16(recordOffset, true); recordOffset += 2;

    // frcol, chcol, tbcol (COLOR - UH[2] each)
    execFuncRecord.frcol = uh2uw([execView.getUint16(recordOffset + 2, true), execView.getUint16(recordOffset, true)])[0]; recordOffset += 4;
    execFuncRecord.chcol = uh2uw([execView.getUint16(recordOffset + 2, true), execView.getUint16(recordOffset, true)])[0]; recordOffset += 4;
    execFuncRecord.tbcol = uh2uw([execView.getUint16(recordOffset + 2, true), execView.getUint16(recordOffset, true)])[0]; recordOffset += 4;
    
    // pict (UH) - offset 0x16
    execFuncRecord.pict = execView.getUint16(recordOffset, true); recordOffset += 2;
    
    // appl (UH[3]) - offset 0x18
    execFuncRecord.appl[0] = execView.getUint16(recordOffset, true); recordOffset += 2;
    execFuncRecord.appl[1] = execView.getUint16(recordOffset, true); recordOffset += 2;
    execFuncRecord.appl[2] = execView.getUint16(recordOffset, true); recordOffset += 2;
    
    // name (TC[32]) - offset 0x1E
    for (let k = 0; k < 16; k++) {
        execFuncRecord.name[k] = execView.getUint16(recordOffset, true);
        recordOffset += 2;
    }
    
    // type (TC[32]) - offset 0x5E
    for (let k = 0; k < 16; k++) {
        execFuncRecord.type[k] = execView.getUint16(recordOffset, true);
        recordOffset += 2;
    }
    
    // dlen (UH) - offset 0x9E
    execFuncRecord.dlen = execView.getUint16(recordOffset, true); recordOffset += 2;

    // data (UB[]) - offset 0xA0, length = dlen
    if (execFuncRecord.dlen > 0 && recordData.length >= recordOffset + 0x10) {
        
        // dlen > 0x10以上だったら、dataの0x04からviewを読み取ってwindow_viewにセット
        if (execFuncRecord.dlen >= 0x10) {
            // 無精してrecordOffsetの0x64から読み取る
            recordOffset+= 4; // dataの0x04相当
            
            execFuncRecord.window_view.left = execView.getUint16(recordOffset, true); recordOffset += 2;
            execFuncRecord.window_view.top = execView.getUint16(recordOffset, true); recordOffset += 2;
            execFuncRecord.window_view.right = execView.getUint16(recordOffset, true); recordOffset += 2;
            execFuncRecord.window_view.bottom = execView.getUint16(recordOffset, true);
        }
    }
    
    console.debug(`EXECFUNCRECORD: dlen=${execFuncRecord.dlen}, window_view=${JSON.stringify(execFuncRecord.window_view)}`);
    
    // ファイルごとにexecFuncRecordListを管理
    if (!execFuncRecordList[fileIndex]) {
        execFuncRecordList[fileIndex] = [];
    }
    execFuncRecordList[fileIndex].push(execFuncRecord);
}

/**
 * pass2
 * tadファイルの内容を解凍し、各ファイルの内容をディレクトリに保存する。
 * 各ファイルの情報はfile.infに保存され、各レコードの情報はrec.infに保存される。
 */
function pass2(lHead) {
    // Create file info
    //const finfoPath = 'file.inf';
    //let finfoContent = 'No: f_type, name\\n';

    // BPK解凍時はXMLダンプを強制的に有効化
    forceXmlDumpEnabled = true;
    console.log('[UnpackJS] forceXmlDumpEnabled を有効化しました');

    // Set BPK processing flag if multiple files
    if (gHead.nfiles > 1) {
        isProcessingBpk = true;
        currentFileIndex = 0;
    }
    
    // Buffer for reading data
    const buffer = new Uint8Array(BUFFERSIZE);

    // lheadToCanvasMapを初期化
    lheadToCanvasMap = {};
    
    // TADファイルのインデックスカウンター
    let tadFileIndex = 0;
    
    // Process all files
    for (let i = 0; i < gHead.nfiles; i++) {
        console.debug(`Processing file ${i}, gHead.nfiles=${gHead.nfiles}`);
        const lhead = lHead[i];
        //const fileName = lhead.name;
        //finfoContent += `${i}: 0${lhead.f_type.toString(8)}, ${fileName}\\n`;

        // Create record info
        //const recInfoPath = `${i}/rec.inf`;
        //let recInfoContent = 'No: type, subtype\\n';

        // Process all records
        for (let j = 0; j < lhead.f_nrec; j++) {
            // 現在のレコード番号を設定（PNG生成用）
            currentRecordNo = j;

            // Read record header
            const rhead = new RecordHead();
            const rheadData = new Uint8Array(8);
            xRead(compMethod, rheadData, 8);

            const view = new DataView(rheadData.buffer);
            rhead.type = view.getInt16(0, true);
            rhead.subtype = view.getUint16(2, true);
            rhead.size = Number(uh2uw([view.getUint16(6, true), view.getUint16(4, true)])[0])
            console.debug(`Record Head: type=${rhead.type}, subtype=${rhead.subtype}, size=${rhead.size}`);

            // レコードタイプを記録
            if (!recordTypeMap[i]) {
                recordTypeMap[i] = [];
            }
            recordTypeMap[i].push(rhead.type);

            //recInfoContent += `${j}: ${rhead.type}, ${rhead.subtype}\\n`;

            // Create output file
            //const recFileName = `${i}/${j}`;
            let recordData = new Uint8Array(rhead.size);

            if (rhead.type === 0) {
                // Link record
                const linkData = new Uint8Array(52);  // sizeof(LINK)
                xRead(compMethod, linkData, 52);

                // Parse LINK structure
                const linkView = new DataView(linkData.buffer);
                const link = new LINKRECORD();
                let pos = 0;
                for (let k = 0; k < 20; k++) {
                    link.fs_name = link.fs_name + charTronCode(Number(linkView.getUint16(pos, true))); // TC[20] ファイル名
                    pos += 2;
                }
                link.link_id = Number(linkView.getUint16(pos, true)) + 1; pos += 2;
                link.atr1 = linkView.getUint16(pos, true); pos += 2;
                link.atr2 = linkView.getUint16(pos, true); pos += 2;
                link.atr3 = linkView.getUint16(pos, true); pos += 2;
                link.atr4 = linkView.getUint16(pos, true); pos += 2;
                link.atr5 = linkView.getUint16(pos, true); pos += 2;

                console.debug(`Link Record: fs_name=${link.fs_name}, link_id=${link.link_id}`);

                // ファイルごとにlinkRecordListを管理
                if (!linkRecordList[i]) {
                    linkRecordList[i] = [];
                }
                linkRecordList[i].push(link); // リンクレコードを保存 (ファイルインデックス別)

                recordData = linkData;

                // リンクレコードはXML不要
                console.debug(`[UnpackJS] リンクレコードはXML生成不要`);

            } else if (rhead.type === 1) {
                // Regular record
                let tempsize = 0;
                while (rhead.size - tempsize > BUFFERSIZE) {
                    xRead(compMethod, buffer, BUFFERSIZE);
                    recordData.set(buffer.slice(), tempsize);
                    tempsize += BUFFERSIZE;
                }

                if (rhead.size - tempsize > 0) {
                    const remaining = new Uint8Array(rhead.size - tempsize);
                    xRead(compMethod, remaining, rhead.size - tempsize);
                    recordData.set(remaining, tempsize);
                }
                // 新設計：nfilesとfileIndexを明示的に渡す
                lheadToCanvasMap[i] = tadFileIndex;

                // TADデータを配列に保存（ファイルインデックスと共に）
                try {
                    // XML配列のインデックスを予約（後でtadDataArrayが実際のXMLを格納）
                    const xmlSlotIndex = isXmlDumpEnabled() ? xml.length : -1;
                    if (isXmlDumpEnabled()) {
                        xml.push(''); // 仮のスロット予約
                        console.debug(`[UnpackJS] TADレコード用にXMLスロット予約 xml[${xmlSlotIndex}]`);
                    }

                    tadRecordDataArray.push({
                        fileIndex: i,
                        data: recordData,
                        xmlSlotIndex: xmlSlotIndex  // XMLスロットのインデックスを記録
                    });
                } catch (error) {
                    console.error(`=== ERROR STORING TAD RECORD ===`);
                    console.error(`Error storing lHead[${i}] (${lHead[i].name}):`, error);
                }

                // tadFileIndexをインクリメント（実際にデータを保存した後）
                tadFileIndex++;

            } else if (rhead.type === 8) {
                // 実行機能付箋レコード (EXECFUNCRECORD)
                let tempsize = 0;
                while (rhead.size - tempsize > BUFFERSIZE) {
                    xRead(compMethod, buffer, BUFFERSIZE);
                    recordData.set(buffer.slice(), tempsize);
                    tempsize += BUFFERSIZE;
                }

                if (rhead.size - tempsize > 0) {
                    const remaining = new Uint8Array(rhead.size - tempsize);
                    xRead(compMethod, remaining, rhead.size - tempsize);
                    recordData.set(remaining, tempsize);
                }

                // 専用メソッドを使用してEXECFUNCRECORDを解析
                parseExecFuncRecord(recordData, i);

                // 実行機能付箋レコードはXML不要
                console.debug(`[UnpackJS] 実行機能付箋レコードはXML生成不要`);

            } else {
                // Other record types (type !== 0 && type !== 1 && type !== 8)
                // 他のタイプのレコード（画像など）
                let tempsize = 0;
                while (rhead.size - tempsize > BUFFERSIZE) {
                    xRead(compMethod, buffer, BUFFERSIZE);
                    recordData.set(buffer.slice(), tempsize);
                    tempsize += BUFFERSIZE;
                }

                if (rhead.size - tempsize > 0) {
                    const remaining = new Uint8Array(rhead.size - tempsize);
                    xRead(compMethod, remaining, rhead.size - tempsize);
                    recordData.set(remaining, tempsize);
                }

                // その他のレコードタイプの場合はバイナリXMLを生成
                if (isXmlDumpEnabled() && enableAnotherRecord) {
                    // バイナリデータをBase64エンコード
                    const base64Data = btoa(String.fromCharCode(...recordData));

                    // バイナリXMLを生成
                    const binaryXml = `<tad version="0121" encoding="UTF-8">\n<binary type="${rhead.type}" subtype="${rhead.subtype}" size="${rhead.size}" encoding="base64">\n${base64Data}\n</binary>\n</tad>`;

                    xml.push(binaryXml);
                    console.debug(`[UnpackJS] その他のレコード(type=${rhead.type})用にバイナリXMLを追加 (xml.length = ${xml.length}, size=${rhead.size})`);
                }
            }
            //fs.writeFileSync(recFileName, recordData);
        }   
        //fs.writeFileSync(recInfoPath, recInfoContent);
    }

    for (let i = 0; i < tadRecordDataArray.length; i++) {
        const record = tadRecordDataArray[i];

        // lheadToCanvasMapで使用されるtadFileIndexを取得
        // tadRecord.fileIndexがlHeadのインデックスなので、それを使ってtadFileIndexを取得
        const lheadIndex = record.fileIndex;
        const tadFileIndex = lheadToCanvasMap[lheadIndex];
        const nfiles = (typeof gHead !== 'undefined' && gHead.nfiles) ? gHead.nfiles : 1;

        isCalcTad = false
        

        if (tadFileIndex !== undefined) {
            // 各TADレコード処理前にXMLバッファをクリア（連結を防ぐため）
            parseXML = '';
            xmlBuffer = [];
            isInDocSegment = false;
            currentIndentLevel = 0;
            console.debug(`[UnpackJS] TADレコード ${i} のXMLバッファをクリア (tadFileIndex: ${tadFileIndex}, xmlSlot: ${record.xmlSlotIndex})`);

            // 現在のファイルインデックスを設定してからtadDataArrayを呼び出す
            currentFileIndex = tadFileIndex;

            // XMLスロットインデックスを設定（tadDataArrayが使用）
            currentXmlSlotIndex = record.xmlSlotIndex;

            tadDataArray(record.data, false, nfiles, currentFileIndex, false);
            console.debug(`Completed tadDataArray processing for tadFileIndex ${tadFileIndex}, xmlSlot ${record.xmlSlotIndex}`);
        } else {
            console.debug(`Warning: No tadFileIndex mapping found for lHead[${lheadIndex}] during processing`);
        }

        // calcレコードタイプを記録
        if (!calcRecordTypeMap[i]) {
            calcRecordTypeMap[i] = [];
        }
        calcRecordTypeMap[i].push(isCalcTad ? 1 : 0);
    }

    // 解凍が完了したら、実身情報を構築
    processExtractedFiles(lHead);
}

/**
 * 解凍されたファイルを処理してarchiveFiles配列を構築
 * @param {Array} lHead - lHeadの配列
 */
function processExtractedFiles(lHead) {
    console.log('[UnpackJS] 解凍ファイル処理開始');

    // 初期化（realIdMapはpass1()で既に生成済みなのでクリアしない）
    archiveFiles = [];
    generatedImages = [];

    // window.xmlの内容をデバッグ出力
    if (typeof xml !== 'undefined') {
        console.log('[UnpackJS] xml配列の要素数:', Array.isArray(xml) ? xml.length : 'not array');
    } else {
        console.warn('[UnpackJS] xml配列が未定義です');
    }

    // lHeadから実身情報を取得
    if (typeof lHead !== 'undefined' && Array.isArray(lHead)) {
        console.log('[UnpackJS] lHead の要素数:', lHead.length);

        let xmlIndex = 0; // xml配列のインデックス

        lHead.forEach((lhead, index) => {
            // Pass1で生成済みのUUIDを取得
            const uuid = realIdMap.get(index);
            if (!uuid) {
                console.error(`[UnpackJS] 実身 ${index} のUUIDが見つかりません`);
                return;
            }

            console.log(`[UnpackJS] 実身 ${index}: ${lhead.name} -> UUID: ${uuid} (Pass1で生成済み)`);

            // レコード数を取得
            const nrec = lhead.f_nrec || 1;
            console.log(`[UnpackJS] 実身 ${index}: ${lhead.name}, レコード数: ${nrec}`);

            // この実身のレコードタイプ情報を取得
            const recordTypes = recordTypeMap[index] || [];
            const calcRecordTypes = calcRecordTypeMap[index] || [];

            // xml配列から各レコードのXMLデータを取得
            const recordXmls = [];
            if (typeof xml !== 'undefined' && Array.isArray(xml)) {
                for (let recNo = 0; recNo < nrec; recNo++) {
                    const recType = recordTypes[recNo];

                    // XMLが生成されるレコードタイプかどうかを判定
                    // type=0 (リンクレコード): XML不要
                    // type=1 (TAD): XMLあり
                    // type=8 (実行機能付箋): XML不要
                    // その他のタイプ: enableAnotherRecordがtrueの場合のみXMLあり
                    const hasXml = (recType === 1) || (recType !== 0 && recType !== 8 && enableAnotherRecord);

                    if (!hasXml) {
                        // XML不要なレコードタイプ
                        recordXmls.push(null);
                        console.log(`[UnpackJS] 実身 ${index}, レコード ${recNo}: type=${recType} (XML不要)`);
                    } else {
                        // XMLありのレコードタイプ
                        if (xmlIndex < xml.length) {
                            recordXmls.push(xml[xmlIndex]);
                            console.log(`[UnpackJS] 実身 ${index}, レコード ${recNo}: type=${recType}, xml[${xmlIndex}] (長さ: ${xml[xmlIndex] ? xml[xmlIndex].length : 0})`);
                            xmlIndex++;
                        } else {
                            console.warn(`[UnpackJS] xml[${xmlIndex}] が範囲外です`);
                            recordXmls.push(null);
                        }
                    }
                }
            }

            // 実身情報を保存
            archiveFiles.push({
                fileId: uuid,
                f_id: index + 1,
                name: lhead.name || `file_${index}`,
                recordIndex: index,
                nrec: nrec,
                recordXmls: recordXmls, // レコードごとのXML配列
                calcRecordTypes: calcRecordTypes // 基本表計算形式TADのレコードタイプ配列
            });

            console.log(`[UnpackJS] 実身追加: ${lhead.name} (UUID: ${uuid}, nrec: ${nrec}, レコード数: ${recordXmls.length})`);
        });
    }

    console.log('[UnpackJS] 解凍ファイル処理完了:', archiveFiles.length, '個の実身');
}

/**
 * 管理情報セグメントを処理
 * ログにバージョン出力
 * @param {0x0000[]} tadSeg
 */
function tadVer(tadSeg) {
    const tadVer = IntToHex((tadSeg[2]),4).replace('0x','');
    if (tadSeg[0] === Number(0x0000)) {
        linkNo = 0;
        console.debug("TadVer " + tadVer);
    }
    if (isXmlDumpEnabled()) {
        // filename属性を追加（currentFileIndexからlHead配列を参照して取得）
        let filename = '';

        // lHeadとcurrentFileIndexが有効な場合
        if (typeof lHead !== 'undefined' && Array.isArray(lHead) && lHead.length > 0) {
            // currentFileIndexに対応するlHeadインデックスを探す
            // lheadToCanvasMapの逆引きを使用
            for (let i = 0; i < lHead.length; i++) {
                if (lheadToCanvasMap[i] === currentFileIndex) {
                    filename = lHead[i].name || '';
                    break;
                }
            }
        }

        const filenameAttr = filename ? ` filename="${filename}"` : '';
        xmlBuffer.push(`<tad version="${tadVer}"${filenameAttr} encoding="UTF-8">\r\n`);
        isTadStarted = true;
    }

}
/**
 * 文章開始セグメントを処理
 * 文章開始セグメントは複数入れ子になるため、テキストの配列を追加して以後のテキストを格納。
 * 文章終了セグメントで一括してテキストを表示
 * @param {0x0000[]} tadSeg 
 */
function tsTextStart(tadSeg) {

    // セグメントスタックに文章セグメントを追加
    segmentStack.push(SEGMENT_TYPE.TEXT);
    currentSegmentType = SEGMENT_TYPE.TEXT;
    
    let textChar = new STARTTEXTSEG();
    if (!startTadSegment) {
        startTadSegment = true;
        textChar.h_unit = units(uh2h(tadSeg[8]));
        textChar.v_unit = units(uh2h(tadSeg[9]));
        textChar.lang = Number(tadSeg[10]);
        textChar.bpat = Number(tadSeg[11]);
    }
        
    // XMLパース出力
    if (isXmlDumpEnabled()) {
        console.debug('tsTextStart: Adding <doc> to xmlBuffer');
        xmlBuffer.push('<document>\r\n');
        xmlBuffer.push(`<docScale hunit="${textChar.h_unit}" vunit="${textChar.v_unit}"/>\r\n`);
        xmlBuffer.push(`<text lang="${textChar.lang}" bpat="${textChar.bpat}"/>\r\n`);
        isInDocSegment = true;
        isXmlTad = true;
        xmlBuffer.push('<p>');  // 段落開始タグを出力
        isParagraphOpen = true;  // 段落が開始
        currentIndentLevel++;
    }

    // 文章TADの場合、全体が文章であることが示されるため、指定は無効
    if (startByImageSegment) {
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

        if (isXmlDumpEnabled()) {
            // docView/docDraw/docScale/text形式で出力
            xmlBuffer.push(`<docView viewleft="${textChar.view.left}" viewtop="${textChar.view.top}" viewright="${textChar.view.right}" viewbottom="${textChar.view.bottom}"/>\r\n`);
            xmlBuffer.push(`<docDraw drawleft="${textChar.draw.left}" drawtop="${textChar.draw.top}" drawright="${textChar.draw.right}" drawbottom="${textChar.draw.bottom}"/>\r\n`);
            xmlBuffer.push(`<docScale hunit="${textChar.h_unit}" vunit="${textChar.v_unit}"/>\r\n`);
            // 図形セグメント内のテキストの場合はz-indexを付与
            if (currentSegmentType === SEGMENT_TYPE.FIGURE) {
                figureZIndexCounter++;
                xmlBuffer.push(`<text lang="${textChar.lang}" bpat="${textChar.bpat}" zIndex="${figureZIndexCounter}"/>\r\n`);
            } else {
                xmlBuffer.push(`<text lang="${textChar.lang}" bpat="${textChar.bpat}"/>\r\n`);
            }
        }
    }
}



/**
 * 文章終了セグメントを処理
 * 文章開始セグメント以降格納されていたテキストを一括して表示
 * @param {0x0000[]} tadSeg 
 */
function tsTextEnd(tadSeg) {

    // XMLパース出力
    if (isXmlDumpEnabled() && isInDocSegment) {
        console.debug('tsTextEnd: Adding </document> to xmlBuffer');

        // 開いている装飾タグを閉じる（開いた順と逆順で閉じる）
        // noprint → mesh → invert → box → strikethrough → overline → underline → strong → i → bagchar
        if (textDecorations.noprint) {
            console.debug('tsTextEnd: Closing open <noprint> tag');
            xmlBuffer.push('</noprint>');
            textDecorations.noprint = false;
        }
        if (textDecorations.mesh) {
            console.debug('tsTextEnd: Closing open <mesh> tag');
            xmlBuffer.push('</mesh>');
            textDecorations.mesh = false;
        }
        if (textDecorations.invert) {
            console.debug('tsTextEnd: Closing open <invert> tag');
            xmlBuffer.push('</invert>');
            textDecorations.invert = false;
        }
        if (textDecorations.box) {
            console.debug('tsTextEnd: Closing open <box> tag');
            xmlBuffer.push('</box>');
            textDecorations.box = false;
        }
        if (textDecorations.strikethrough) {
            console.debug('tsTextEnd: Closing open <strikethrough> tag');
            xmlBuffer.push('</strikethrough>');
            textDecorations.strikethrough = false;
        }
        if (textDecorations.overline) {
            console.debug('tsTextEnd: Closing open <overline> tag');
            xmlBuffer.push('</overline>');
            textDecorations.overline = false;
        }
        if (textDecorations.underline) {
            console.debug('tsTextEnd: Closing open <underline> tag');
            xmlBuffer.push('</underline>');
            textDecorations.underline = false;
        }
        if (textDecorations.bold) {
            console.debug('tsTextEnd: Closing open <strong> tag');
            xmlBuffer.push('</strong>');
            textDecorations.bold = false;
        }
        if (textDecorations.italic) {
            console.debug('tsTextEnd: Closing open <i> tag');
            xmlBuffer.push('</i>');
            textDecorations.italic = false;
        }
        if (textDecorations.bagChar) {
            console.debug('tsTextEnd: Closing open <bagchar> tag');
            xmlBuffer.push('</bagchar>');
            textDecorations.bagChar = false;
        }

        // 開いている段落タグがあれば閉じる
        if (isParagraphOpen) {
            console.debug('tsTextEnd: Closing open paragraph tag');
            xmlBuffer.push('</p>\r\n');
            isParagraphOpen = false;
        }

        currentIndentLevel--;
        xmlBuffer.push('</document>\r\n');
        isInDocSegment = false;
        isXmlTad = false;
    }

    // セグメントスタックから文章セグメントを削除
    if (segmentStack.length > 0 && segmentStack[segmentStack.length - 1] === SEGMENT_TYPE.TEXT) {
        segmentStack.pop();
    }
    // 現在のセグメントタイプを更新
    currentSegmentType = segmentStack.length > 0 ? segmentStack[segmentStack.length - 1] : SEGMENT_TYPE.NONE;

}

/**
 * 用紙指定付箋を処理
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 * @returns 
 */
function tsDocSizeOfPaperSetFusen(segLen, tadSeg) {
    if (segLen < Number(0x000E)) {
        return;
    }
    // 図形TADの場合は無視される
    if (startByImageSegment) {
        return;
    }

    // PaperSizeクラスのインスタンスを作成（まだ存在しない場合）
    if (paperSize === null) {
        paperSize = new PaperSize();
    }

    const ATTR = getLastUBinUH(tadSeg[0]);

    // 綴じ方向と面付け指定をビットマスクで解析
    // bit0: P (面付け指定) 0:1面付け, 1:2面付け
    // bit1: D (綴じ方向) 0:左綴じ, 1:右綴じ
    paperSize.imposition = (ATTR & 0x01) ? 1 : 0;  // bit0: P
    paperSize.binding = (ATTR & 0x02) ? 1 : 0;     // bit1: D

    // 用紙サイズを設定
    paperSize.length = Number(tadSeg[1]);
    paperSize.width = Number(tadSeg[2]);
    
    // オーバーレイ領域までのマージンを設定（論理値として保存）
    paperSize.top = Number(tadSeg[3]);
    paperSize.bottom = Number(uh2h(tadSeg[4]));
    
    // 論理的なleft（ノド）とright（小口）の値をそのまま保存
    paperSize.left = Number(uh2h(tadSeg[5]));   // ノド（綴じ側）
    paperSize.right = Number(uh2h(tadSeg[6]));  // 小口（開き側）

    // XMLダンプ用
    if (isXmlDumpEnabled()) {
        xmlBuffer.push(`<paper type="doc" length="${paperSize.length}" width="${paperSize.width}" binding="${paperSize.binding}" imposition="${paperSize.imposition}" top="${paperSize.top}" bottom="${paperSize.bottom}" left="${paperSize.left}" right="${paperSize.right}" />\r\n`);
    }
}

/**
 * マージン指定付箋を処理
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 * @returns 
 */
function tsDocSizeOfMarginSetFusen(segLen, tadSeg) {
    if (segLen < Number(0x000A)) {
        return;
    }
    // 図形TADの場合は無視される
    if (startByImageSegment) {
        return;
    }

    console.debug(`Margin raw values: top=${IntToHex((tadSeg[1]),4).replace('0x','')}, bottom=${IntToHex((tadSeg[2]),4).replace('0x','')}, left(gutter)=${IntToHex((tadSeg[3]),4).replace('0x','')}, right(fore-edge)=${IntToHex((tadSeg[4]),4).replace('0x','')}`);

    // マージン値を取得（0xffffの場合は前の値を継承）
    const topValue = Number(tadSeg[1]);
    const bottomValue = Number(tadSeg[2]);
    const leftValue = Number(tadSeg[3]);
    const rightValue = Number(tadSeg[4]);
    
    // XMLダンプ用
    if (isXmlDumpEnabled()) {
        xmlBuffer.push(`<docmargin top="${topValue}" bottom="${bottomValue}" left="${leftValue}" right="${rightValue}" />\r\n`);
    }
}

/**
 * コラム指定付箋を処理
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 * @returns 
 */
function tsSizeOfColumnSetFusen(segLen, tadSeg) {
    if (segLen < Number(0x0004)) {
        return;
    }
    // 図形TADの場合は無視される
    if (startByImageSegment) {
        return;
    }
    
    const CCCC = getLastUBinUH(tadSeg[0]);
    // 下位4ビットのコラム数を取得
    const column = Number(CCCC & 0x0F); // 0x0F = 00001111

    const colsp = Number(tadSeg[1]); // コラム感のマージンを座標系単位で指定

    if (segLen > Number(0x0004)) {
        // TopUBは予約とのこと
        // const DIWWKKKK = getTopUBinUH(tadSeg[2]);

        const DIWWKKKK = getLastUBinUH(tadSeg[2]);
        // 上位4ビットのコラム間隔指定を取得
        const lastColline = (DIWWKKKK >> 4) & 0x0F; // DIWW（上位4ビット）
        // lastColline のビット配置: [D][I][W][W] = bits 3,2,1,0
        const lastDensity = (lastColline >> 3) & 0x01;  // bit 3 = D: 0:100%、1:50%
        const lastLine = (lastColline >> 2) & 0x01;     // bit 2 = I: 0:1本、1:2本
        const lastWidth = lastColline & 0x03;           // bits 1-0 = WW: 0:なし、1:細線、2:中線、3:太線
        const lastType = Number(DIWWKKKK & 0x0F); // 0:実線、1:破線、2:点線、3:一点鎖線、4:二点鎖線、5:長鎖線, 6:波線、7:予約、8:未定義

        console.debug(`Column set: column=${column}, colsp=${colsp}, lastLine=${lastLine}, lastDensity=${lastDensity}, lastWidth=${lastWidth}, lastType=${lastType}`);

        if (isXmlDumpEnabled()) {
            xmlBuffer.push(`<column column="${column}" colsp="${colsp}" colline="${lastColline}" linenum="${lastLine}" lineDensity="${lastDensity}" lineWidth="${lastWidth}" lineType="${lastType}" />\r\n`);
        }
    } else {
        console.debug(`Column set: column=${column}, colsp=${colsp}`);
        if (isXmlDumpEnabled()) {
            xmlBuffer.push(`<column column="${column}" colsp="${colsp}" />\r\n`);
        }
    }
}

/**
 * 条件改ページ指定付箋を処理
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 * @returns 
 */
function tsPageBreakConditionFusen(segLen, tadSeg) {
    if (segLen < Number(0x0004)) {
        return;
    }
    // 図形TADの場合は無視される
    if (startByImageSegment) {
        return;
    }
    
    const cond = getLastUBinUH(tadSeg[0]);
    const remain = Number(tadSeg[1]);
    
    console.debug(`Conditional page break: cond=${cond}, remain=${IntToHex(remain, 4)}`);

    if (isXmlDumpEnabled()) {
        xmlBuffer.push(`<pagebreak cond="${cond}" remain="${remain}" />\r\n`);
    }
}

/**
 * 用紙オーバーレイ定義付箋を処理
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 * @returns 
 */
function tsDocSizeOfPaperOverlayDefineFusen(segLen, tadSeg) {
    if (segLen < Number(0x0004)) {
        return;
    }
    // 図形TADの場合は無視される
    if (startByImageSegment) {
        return;
    }

    // ATTRを取得（xxPPNNNN形式）
    const ATTR = getLastUBinUH(tadSeg[0]);

    // PP部分を取得（ビット4-5）
    const pageFlags = (ATTR >> 4) & 0x03;
    // NNNN部分を取得（ビット0-3）
    const overlayNumber = ATTR & 0x0F;

    // ページ適用フラグの解釈
    let applyToEvenPages = true;  // 偶数ページに適用
    let applyToOddPages = true;   // 奇数ページに適用

    if (pageFlags === 1) {
        applyToEvenPages = false;  // 偶数ページには適用しない
    } else if (pageFlags === 2) {
        applyToOddPages = false;   // 奇数ページには適用しない
    }

    console.debug(`用紙オーバーレイ定義: オーバーレイ番号=${overlayNumber}, 偶数ページ適用=${applyToEvenPages}, 奇数ページ適用=${applyToOddPages}`);

    // overlayDataはTAD文字列として保存
    let overlayData = [];
    for (let i = 0; i < segLen; i++) {
        overlayData.push(tadSeg[i]);
    }

    // XMLダンプ用
    if (isXmlDumpEnabled()) {
        xmlBuffer.push(`<docoverlay data="${overlayData.join(', ')}" />\r\n`);
    }
}

/**
 * 用紙オーバーレイ指定付箋を処理
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 * @returns 
 */
function tsDocSizeOfPaperOverlaySetFusen(segLen, tadSeg) {
    if (segLen < Number(0x0004)) {
        return;
    }
    // 図形TADの場合は無視される
    if (startByImageSegment) {
        return;
    }

    // overlayを取得（16ビットのビットマップ）
    // 各ビットはMSBから順に0-15の各オーバーレイ番号に対応
    // 1で適用、0で解除
    const overlay = tadSeg[1];

    // 現在のページ番号を取得（グローバル変数から）
    // TODO: ページ番号の管理が必要
    const currentPage = window.currentPageNumber || 1;

    // アクティブなオーバーレイを管理する配列を初期化
    if (!window.activeOverlays) {
        window.activeOverlays = [];
    }

    // 以前のアクティブオーバーレイ設定を保存（デバッグ用）
    const previousOverlays = [...window.activeOverlays];

    // 新しいアクティブオーバーレイの設定を作成
    window.activeOverlays = [];

    // 各ビットをチェックして、有効/無効なオーバーレイ番号を処理
    for (let i = 0; i < 16; i++) {
        // MSBから順にチェック（0番がMSB、15番がLSB）
        const bitPosition = 15 - i;
        const isActive = (overlay >> bitPosition) & 0x01;

        if (isActive === 1) {
            // オーバーレイを有効化
            // オーバーレイが定義されているかチェック
            if (window.paperOverlays && window.paperOverlays[i]) {
                const overlayDef = window.paperOverlays[i];

                // ページ適用条件をチェック
                const isEvenPage = (currentPage % 2) === 0;
                const shouldApply = (isEvenPage && overlayDef.applyToEvenPages) ||
                                   (!isEvenPage && overlayDef.applyToOddPages);

                if (shouldApply) {
                    window.activeOverlays.push(i);
                    console.debug(`オーバーレイ${i}番を有効化`);
                }
            } else {
                console.debug(`オーバーレイ${i}番は未定義のため有効化できません`);
            }
        } else {
            // オーバーレイを無効化（ビットが0の場合）
            // 以前アクティブだった場合はログ出力
            if (previousOverlays.includes(i)) {
                console.debug(`オーバーレイ${i}番を無効化`);
            }
        }
    }

    // 描画順序でソート（0番が最下層、15番が最上層）
    window.activeOverlays.sort((a, b) => a - b);

    // XMLダンプ用
    if (isXmlDumpEnabled()) {
        xmlBuffer.push(`<docoverlay active="${window.activeOverlays.join(', ')}" />\r\n`);
    }

    console.debug(`用紙オーバーレイ指定: アクティブオーバーレイ=[${window.activeOverlays.join(', ')}]`);

}

/**
 * 図形TAD用：用紙オーバーレイ定義付箋を処理
 * @param {int} segLen
 * @param {0x0000[]} tadSeg
 * @returns
 */
function tsFigureSizeOfPaperOverlayDefineFusen(segLen, tadSeg) {
    if (segLen < Number(0x0004)) {
        return;
    }
    // 文書TADの場合は無視される（図形TAD専用）
    if (!startByImageSegment) {
        return;
    }

    // ATTRを取得（xxPPNNNN形式）
    const ATTR = getLastUBinUH(tadSeg[0]);

    // PP部分を取得（ビット4-5）
    const pageFlags = (ATTR >> 4) & 0x03;
    // NNNN部分を取得（ビット0-3）
    const overlayNumber = ATTR & 0x0F;

    // ページ適用フラグの解釈
    let applyToEvenPages = true;  // 偶数ページに適用
    let applyToOddPages = true;   // 奇数ページに適用

    if (pageFlags === 1) {
        applyToEvenPages = false;  // 偶数ページには適用しない
    } else if (pageFlags === 2) {
        applyToOddPages = false;   // 奇数ページには適用しない
    }

    console.debug(`図形TAD用紙オーバーレイ定義: オーバーレイ番号=${overlayNumber}, 偶数ページ適用=${applyToEvenPages}, 奇数ページ適用=${applyToOddPages}`);

    // overlayDataはTAD文字列として保存
    let overlayData = [];
    for (let i = 0; i < segLen; i++) {
        overlayData.push(tadSeg[i]);
    }

    // XMLダンプ用
    if (isXmlDumpEnabled()) {
        xmlBuffer.push(`<figoverlay number="${overlayNumber}" even="${applyToEvenPages}" odd="${applyToOddPages}" overlayData="${overlayData.join(',')}" />\r\n`);
    }
}

/**
 * 図形TAD用：用紙オーバーレイ指定付箋を処理
 * @param {int} segLen
 * @param {0x0000[]} tadSeg
 * @returns
 */
function tsFigureSizeOfPaperOverlaySetFusen(segLen, tadSeg) {
    if (segLen < Number(0x0004)) {
        return;
    }
    // 文書TADの場合は無視される（図形TAD専用）
    if (!startByImageSegment) {
        return;
    }

    // overlayを取得（16ビットのビットマップ）
    const overlay = tadSeg[1];

    // 現在のページ番号を取得
    const currentPage = window.currentPageNumber || 1;

    // 図形TAD用のアクティブオーバーレイを管理
    if (!window.figureActiveOverlays) {
        window.figureActiveOverlays = [];
    }

    // 以前のアクティブオーバーレイ設定を保存
    const previousOverlays = [...window.figureActiveOverlays];

    // 新しいアクティブオーバーレイの設定を作成
    window.figureActiveOverlays = [];

    // 各ビットをチェックして、有効/無効なオーバーレイ番号を処理
    for (let i = 0; i < 16; i++) {
        // MSBから順にチェック（0番がMSB、15番がLSB）
        const bitPosition = 15 - i;
        const isActive = (overlay >> bitPosition) & 0x01;

        if (isActive === 1) {
            // オーバーレイを有効化
            if (window.figurePaperOverlays && window.figurePaperOverlays[i]) {
                const overlayDef = window.figurePaperOverlays[i];

                // ページ適用条件をチェック
                const isEvenPage = (currentPage % 2) === 0;
                const shouldApply = (isEvenPage && overlayDef.applyToEvenPages) ||
                                   (!isEvenPage && overlayDef.applyToOddPages);

                if (shouldApply) {
                    window.figureActiveOverlays.push(i);
                    console.debug(`図形TADオーバーレイ${i}番を有効化`);
                }
            } else {
                console.debug(`図形TADオーバーレイ${i}番は未定義のため有効化できません`);
            }
        } else {
            // オーバーレイを無効化（ビットが0の場合）
            if (previousOverlays.includes(i)) {
                console.debug(`図形TADオーバーレイ${i}番を無効化`);
            }
        }
    }

    // 描画順序でソート（0番が最下層、15番が最上層）
    window.figureActiveOverlays.sort((a, b) => a - b);

    console.debug(`図形TAD用紙オーバーレイ指定: アクティブオーバーレイ=[${window.figureActiveOverlays.join(', ')}]`);

    if (isXmlDumpEnabled()) {
        xmlBuffer.push(`<figoverlay active="${window.figureActiveOverlays.join(', ')}" />\r\n`);
    }

}

/**
 * ページ指定付箋共通から付箋を判定
 * @param {int} segLen
 * @param {0x0000[]} tadSeg
 */
function tadPageSetFusen(segLen, tadSeg) {
    const UB_SubID = getTopUBinUH(tadSeg[0]);

    if (UB_SubID === Number(0x00)) {
        console.debug("用紙指定付箋");
        tsDocSizeOfPaperSetFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x01)) {
        console.debug("マージン指定付箋");
        tsDocSizeOfMarginSetFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x02)) {
        console.debug("コラム指定付箋");
        tsSizeOfColumnSetFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x03)) {
        console.debug("用紙オーバーレイ定義付箋");
        tsDocSizeOfPaperOverlayDefineFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x04)) {
        console.debug("用紙オーバーレイ指定付箋");
        tsDocSizeOfPaperOverlaySetFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x05)) {
        console.debug("枠あけ指定付箋");
        // TODO: 未実装
    } else if (UB_SubID === Number(0x06)) {
        console.debug("ページ番号指定付箋");
        // TODO: 未実装
    } else if (UB_SubID === Number(0x07)) {
        console.debug("条件改ページ指定付箋");
        tsPageBreakConditionFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x08)) {
        console.debug("充填行指定付箋");
        // TODO: 未実装
    }
}

/**
 * 行間隔指定付箋を処理
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 */
function tsRulerLineSpacingSetFusen(segLen, tadSeg) {
    const ATTR = getLastUBinUH(tadSeg[0]);
    const pitch = tadSeg[1];
    const D = (ATTR >>> 7) & 0b1;
    const G = (ATTR >>> 0) & 0b1;
    let a = ( pitch >>> 8) & 0b01111111;
    let b = ( pitch >>> 0) & 0b11111111;
    const n = (pitch >>> 0) & 0x7FFF;
    if (b === 0) {
        a = 1;
        b = 1;
    }

    const msb = (pitch >>> 15) & 0b1;
    if (msb === 0) {
        if (G === 0) {
            // 行送りサイズ
            lineSpacingPitch = 1 + (a / b);
        } else {
            // 行間隔サイズ
            lineSpacingPitch = 1 + (a / b);
        }
    } else{
        // 文字開始セグメントのv_unitで指定される座標単位での幅
        if (G === 0) {
            lineSpacingPitch = n + 1;
        } else  {
            lineSpacingPitch = n + 1;
        }
    }

    // XML出力
    if (isXmlDumpEnabled()) {
        // HTML5のp要素のline-height属性として出力
        xmlBuffer.push(`<text line-height="${lineSpacingPitch}"/>`);
    }
}

/**
 * 行揃え指定付箋を処理
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 */
function tsRulerLineAlignmentSetFusen(segLen, tadSeg) {
    const ATTR = getLastUBinUH(tadSeg[0]);

    //0:左揃え, 1:中央揃え, 2:右揃え, 3:両端揃え, 4:均等揃え
    lineAlign = Number(ATTR);

    let xmlTag = null;
    switch (lineAlign) {
        case 0:
            xmlTag = 'left';
            break;
        case 1:
            xmlTag = 'center';
            break;
        case 2:
            xmlTag = 'right';
            break;
        case 3:
            xmlTag = 'justify';
            break;
        case 4:
            xmlTag = 'justify-all';
            break;
        default:
            xmlTag = 'left';
            break;
    }
    // XML出力（文章セグメント内の場合のみ）
    if (isXmlDumpEnabled()) {
        // HTML5のp要素のalign属性として出力
        xmlBuffer.push(`<text align="${xmlTag}"/>`);
    }
}

function tsRulerLineDirectionSetFusen(segLen, tadSeg) {
    const textDirection = Number(getLastUBinUH(tadSeg[0]));
    console.debug("文字方向 : " + textDirection);

    // XML出力
    if (isXmlDumpEnabled()) {
        // HTML5のp要素のdir属性として出力
        const dirValue = textDirection === 0 ? '0' : '1'; // 0:横書き(ltr), 1:縦書き(rtl)
        xmlBuffer.push(`<text direction="${dirValue}"/>`);
    }
}

/**
 * 行頭移動指定付箋を処理
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 */
function tsRulerLineMoveSetFusen(segLen, tadSeg) {

    // XML出力（文章セグメント内の場合のみ）
    if (isXmlDumpEnabled()) {
        // 表計算セルの場合、タブ出力前に装飾終了タグを出力
        if (isCalcTad && calcActiveDecorations.length > 0) {
            // 逆順で終了タグを出力
            while (calcActiveDecorations.length > 0) {
                const tag = calcActiveDecorations.pop();
                xmlBuffer.push(`</${tag}>`);
            }
        }
        // HTML5のtab要素として出力
        xmlBuffer.push(`<tab/>`);
    }
}

/**
 * 行書式指定付箋から付箋を判定
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 */
function tadRulerSetFusen(segLen, tadSeg) {
    const UB_SubID = getTopUBinUH(tadSeg[0]);

    if (UB_SubID === Number(0x00)) {
        console.debug("行間隔指定付箋");
        tsRulerLineSpacingSetFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x01)) {
        console.debug("行揃え指定付箋");
        tsRulerLineAlignmentSetFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x02)) {
        console.debug("タブ書式指定付箋");
        // TODO: 未実装
    } else if (UB_SubID === Number(0x03)) {
        console.debug("フィールド書式指定付箋");
        // TODO: 未実装
    } else if (UB_SubID === Number(0x04)) {
        console.debug("文字方向指定付箋");
        tsRulerLineDirectionSetFusen(segLen, tadSeg);
        // TODO: 未実装
    } else if (UB_SubID === Number(0x05)) {
        console.debug("行頭移動指定付箋");
        tsRulerLineMoveSetFusen(segLen, tadSeg);
    }
}

/**
 * フォント指定付箋を処理
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 * @returns 
 */
/**
 * フォント名指定付箋を処理
 * @param {number} segLen セグメント長
 * @param {Array} tadSeg TADセグメントデータ
 */
function tsFontNameSetFusen(segLen, tadSeg) {
    if (segLen < Number(0x0004)) {
        return;
    }
    
    // class取得（UH形式）
    const fontClass = Number(tadSeg[1]);
    console.debug(`Font class: 0x${fontClass.toString(16).padStart(4, '0')}`);
    
    // フォント名を取得（TRONコードからの変換）
    let fontName = '';
    for (let offsetLen = 2; offsetLen < tadSeg.length; offsetLen++) {
        const tronChar = charTronCode(tadSeg[offsetLen]);
        if (tronChar) {
            fontName += tronChar;
        }
    }
    
    console.debug(`Original font name: "${fontName}"`);

    // XML出力（文章セグメント内の場合のみ）
    if (isXmlDumpEnabled()) {
        // HTML5のfont要素として出力
        xmlBuffer.push(`<font face="${fontName}"/>`);
    }

}


/**
 * フォント属性指定付箋を処理
 * @param {*} segLen 
 * @param {*} tadSeg 
 * @returns 
 */
function tsFontTypeSetFusen(segLen, tadSeg) {
    if (segLen < Number(0x0004)) {
        return;
    }
    const ATTR = tadSeg[1];  // ATTRはUH形式で2番目の要素
    
    // ATTR解析: SDRRLLLIIIBBBWWW
    const spacing = (ATTR >>> 15) & 0b1;      // S: スペーシング (0:固定ピッチ, 1:比例ピッチ)
    const direction = (ATTR >>> 14) & 0b1;    // D: 方向 (0:横書き, 1:縦書き)
    const reserved = (ATTR >>> 12) & 0b11;    // RR: 予約
    const lineType = (ATTR >>> 9) & 0b111;    // LLL: 線種
    const italic = (ATTR >>> 6) & 0b111;      // III: 斜体
    const weight = (ATTR >>> 3) & 0b111;      // BBB: 太さ
    const width = ATTR & 0b111;               // WWW: 幅
    

    
    // 線種設定（袋文字、影付き等）
    let strokeStyle = 'none';
    const oldBagChar = textDecorations.bagChar; // 以前の袋文字設定を保存
    let shadowStyle = 'none';
    switch (lineType) {
        case 0: // 通常
            strokeStyle = 'none';
            shadowStyle = 'none';
            textDecorations.bagChar = false;
            break;
        case 1: // 袋文字
            strokeStyle = 'outline';
            shadowStyle = 'none';
            textDecorations.bagChar = true;
            break;
        case 2: // 影付き袋文字
            strokeStyle = 'outline';
            shadowStyle = 'black';
            textDecorations.bagChar = true;
            break;
        case 3: // 白影付き袋文字（立体）
            strokeStyle = 'outline';
            shadowStyle = 'white';
            textDecorations.bagChar = true;
            break;
        default:
            strokeStyle = 'none';
            shadowStyle = 'none';
            textDecorations.bagChar = false;
    }

    // bagCharタグの出力（null→false遷移ではタグを出力しない）
    if (isXmlDumpEnabled()) {
        if (textDecorations.bagChar && !oldBagChar) {
            // null/false → true: 袋文字モードに入る
            console.debug("袋文字ON")
            xmlBuffer.push("<bagchar>");
        } else if (!textDecorations.bagChar && oldBagChar) {
            // true → null/false: 袋文字モードから出る
            console.debug("袋文字OFF");
            xmlBuffer.push("</bagchar>");
        }
    }

    // 斜体設定
    let fontStyle = 'normal';
    let skewAngle = 0;  // 水平斜体用の傾き角度
    const oldItalic = textDecorations.italic; // 以前の斜体設定を保存
    switch (italic) {
        case 1: // 水平斜体弱
            fontStyle = 'italic';
            skewAngle = -10;
            textDecorations.italic = true;
            break;
        case 2: // 水平斜体中
            fontStyle = 'italic';
            skewAngle = -15;
            textDecorations.italic = true;
            break;
        case 3: // 水平斜体強
            fontStyle = 'italic';
            skewAngle = -20;
            textDecorations.italic = true;
            break;
        case 5: // 垂直斜体弱
            fontStyle = 'oblique 10deg';
            textDecorations.italic = true;
            break;
        case 6: // 垂直斜体中
            fontStyle = 'oblique 15deg';
            textDecorations.italic = true;
            break;
        case 7: // 垂直斜体強
            fontStyle = 'oblique 20deg';
            textDecorations.italic = true;
            break;
        default:
            fontStyle = 'normal';
            textDecorations.italic = false;
            break;
    }
    // italicタグの出力（null→false遷移ではタグを出力しない）
    if (isXmlDumpEnabled()) {
        if (textDecorations.italic && !oldItalic) {
            // null/false → true: 斜体モードに入る
            console.debug("斜体ON")
            xmlBuffer.push("<i>");
        } else if (!textDecorations.italic && oldItalic) {
            // true → null/false: 斜体モードから出る
            console.debug("斜体OFF");
            xmlBuffer.push("</i>");
        }
    }

    // 太さ設定
    let fontWeight = defaultFontWeight;  // normal
    const oldBold = textDecorations.bold; // 以前の太字設定を保存
    switch (weight) {
        case 0: // 中字
            fontWeight = defaultFontWeight;
            textDecorations.bold = false;
            break;
        case 1: // 極細字
            fontWeight = 100;
            textDecorations.bold = false;
            break;
        case 2: // 細字
            fontWeight = 300;
            textDecorations.bold = false;
            break;
        case 4: // 中太字
            fontWeight = 500;
            textDecorations.bold = true;
            break;
        case 5: // 太字
            fontWeight = 700;
            textDecorations.bold = true;
            break;
        case 6: // 極太字
            fontWeight = 800;
            textDecorations.bold = true;
            break;
        case 7: // 超太字
            fontWeight = 900;
            textDecorations.bold = true;
            break;
    }
    // boldタグの出力（null→false遷移ではタグを出力しない）
    if (isXmlDumpEnabled()) {
        if (textDecorations.bold && !oldBold) {
            // null/false → true: 太字モードに入る
            console.debug("太字ON")
            xmlBuffer.push("<strong>");
        } else if (!textDecorations.bold && oldBold) {
            // true → null/false: 太字モードから出る
            console.debug("太字OFF");
            xmlBuffer.push("</strong>");
        }
    }
    
    // 幅設定（文字の水平スケール）
    let fontStretch = 'normal';
    let scaleX = 1.0;
    switch (width) {
        case 0: 
            fontStretch = 'normal';
            scaleX = 1.0;
            break;
        case 1: 
            fontStretch = 'condensed';
            scaleX = 0.8;
            break;  // 圧縮
        case 2: 
            fontStretch = 'extra-condensed';
            scaleX = 0.6;
            break;  // 極圧縮
        case 3: 
            fontStretch = 'ultra-condensed';
            scaleX = 0.5;
            break;  // 超圧縮
        case 5: 
            fontStretch = 'extra-expanded';
            scaleX = 1.5;
            break;  // 極幅広
        case 6: 
            fontStretch = 'ultra-expanded';
            scaleX = 2.0;
            break;  // 超幅広
    }

    if (isXmlDumpEnabled) {
        // XML出力（文章セグメント内の場合のみ）
        xmlBuffer.push(`<font style="${fontStyle}" weight="${fontWeight}" stretch="${fontStretch}" stretchscale="${scaleX}"/>`);
    }

}

/**
 * 文字サイズ指定付箋を処理
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 */
function tsFontSizeSetFusen(segLen,tadSeg) {

    let tadSize = ("0000000000000000" + tadSeg[1].toString(2)).slice( -16 );
    
    const U1 = 16384;
    const U2 = 32768;
    const U3 = 49152;
    const sizeMask = 16383;

    if (tadSeg[1] & U2) {
        textFontSize = (tadSeg[1] & sizeMask) / 20;
        console.debug("ptsize  " + textFontSize );
    } else if (tadSeg[1] & U1) {
        console.debug("Qsize   " + tadSize);
        textFontSize = (tadSeg[1] & sizeMask) / (20 * 0.3528);
    }

    // XML出力（文章セグメント内の場合のみ）
    if(isXmlDumpEnabled) {
        xmlBuffer.push(`<font size="${textFontSize}"/>`);
    }
}

function tsFontSpacingSetFusen(segLen, tadSeg) {
    if (segLen < Number(0x0002)) {
        return;
    }
    const ATTR = getLastUBinUH(tadSeg[0]);
    const pitch = tadSeg[1];

    const textSpacingDirection = (ATTR >>> 7) & 0b1; // 文字送り方向
    let textSpacingKerning = (ATTR >>> 6) & 0b1; // カーニング有無
    const textSpacingPattern = (ATTR >>> 0) & 0b1; // 0:文字送り量,1:文字アキ量
    let textSpacingPitch = 0;

    let a = ( pitch >>> 8) & 0b01111111;
    let b = ( pitch >>> 0) & 0b11111111;
    const n = (pitch >>> 0) & 0x7FFF;
    if (b === 0) {
        a = 1;
        b = 1;
    }

    const msb = (pitch >>> 15) & 0b1;
    if (msb === 0) {
        if (textSpacingPattern === 0) {
            // :文字送り量
            textSpacingPitch = (a / b);
        } else {
            // 文字アキ量
            textSpacingPitch = (a / b);
        }
    } else{
        // 文字開始セグメントのv_unitで指定される座標単位での幅
        if (textSpacingPattern === 0) {
            textSpacingPitch = n;
        } else  {
            textSpacingPitch = n;
        }
    }

    // XML出力（文章セグメント内の場合のみ）
    if(isXmlDumpEnabled) {
        xmlBuffer.push(`<font direction="${textSpacingDirection}" kerning="${textSpacingKerning}" pattern="${textSpacingPattern}" space="${textSpacingPitch}"/>`);
    }
}

/**
 * 文字カラー指定付箋を処理
 * @param {*} segLen 
 * @param {*} tadSeg 
 * @returns 
 */
function tsFontColorSetFusen(segLen, tadSeg) {
    if (segLen < Number(0x0004)) {
        return;
    }
    // 文字カラー指定付箋は、文字色を設定するための付箋
    // tadSeg[1]にカラーコードが格納されている
    // 例: tadSeg[1] = 0x0000FF (青色)
    let color = new COLOR();
    color = parseColor(uh2uw([tadSeg[2], tadSeg[1]])[0]);
    textFontColor = color.color;

    // XML出力（文章セグメント内の場合のみ）
    if(isXmlDumpEnabled) {
        xmlBuffer.push(`<font color="${textFontColor}"/>`);
    }
}

/**
 * 文字指定付箋共通を判定
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 */
function tadFontSetFusen(segLen, tadSeg) {
    const UB_SubID = getTopUBinUH(tadSeg[0]);

    if (UB_SubID === Number(0x00)) {
        console.debug("フォント指定付箋");
        tsFontNameSetFusen(segLen,tadSeg);
    } else if (UB_SubID === Number(0x01)) {
        console.debug("フォント属性指定付箋");
        tsFontTypeSetFusen(segLen,tadSeg);
    } else if (UB_SubID === Number(0x02)) {
        console.debug("文字サイズ指定付箋");
        tsFontSizeSetFusen(segLen,tadSeg);
    } else if (UB_SubID === Number(0x03)) {
        console.debug("文字拡大／縮小指定付箋");
    } else if (UB_SubID === Number(0x04)) {
        console.debug("文字間隔指定付箋");
        tsFontSpacingSetFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x05)) {
        console.debug("文字回転指定付箋");
    } else if (UB_SubID === Number(0x06)) {
        console.debug("文字カラー指定付箋");
        tsFontColorSetFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x07)) {
        console.debug("文字基準位置移動付箋");
        // TODO
    }
}

/**
 * 特殊文字指定付箋を処理
 * @param {*} segLen 
 * @param {*} tadSeg 
 */
function tadSpecialCharFusen(segLen, tadSeg) {
    const UB_SubID = getTopUBinUH(tadSeg[0]);

        if (UB_SubID === Number(0x00)) {
        console.debug("固定幅空白指定付箋");
        // TODO
    } else if (UB_SubID === Number(0x01)) {
        console.debug("充填文字指定付箋");
        // TODO
    } else if (UB_SubID === Number(0x02)) {
        console.debug("文字罫線指定付箋");
        // サポートしない
    }
}

/**
 * 添え字開始指定付箋を処理
 * @param {*} segLen 
 * @param {*} tadSeg 
 */
function tadSubscriptStart(segLen, tadSeg) {
    // デフォルトで2バイトデータ取得
    let dataOffset = 0;
    
    // SubIDを取得 (最初のバイトの下位4ビットは既に処理済み)
    
    // typeフィールドを取得 (1バイト目の上位4ビット)
    const typeByte = getBottomUBinUH(tadSeg[dataOffset]);
    const F = (typeByte >> 3) & 0x01;  // ビット3: 前置(0)/後置(1)
    const unit = (typeByte >> 2) & 0x01;  // ビット2: 文字列単位(0)/文字単位(1)
    const type = typeByte & 0x03;  // ビット0-1: 0:下付き, 1:上付き, 2-3:予約
    
    dataOffset++;
    
    // 追加パラメータがある場合
    if (segLen > 2) {
        // U値またはpos値を取得
        const paramByte = tadSeg[dataOffset];
        
        if (unit === 1) {
            // 文字単位の場合: U値 (位置指定)
            subscriptState.targetPosition = paramByte & 0x01;  // 0:右, 1:左
        } else {
            // 文字列単位の場合: pos値 (ベースライン位置)
            subscriptState.baseline = paramByte & 0x07;  // 0-4の値
        }
    }
    
    // 添え字状態を更新
    subscriptState.active = true;
    subscriptState.type = type;
    subscriptState.position = F;
    subscriptState.unit = unit;
    
    // フォントサイズの調整（添え字は通常のサイズの60-70%）
    const savedFontSize = textFontSize;
    subscriptState.savedFontSize = savedFontSize;

    // XML出力用
    if (isXmlDumpEnabled()) {
        xmlBuffer.push(`<attend type="${type}" position="${F}" unit="${unit}" targetPosition="${subscriptState.targetPosition}" baseline="${subscriptState.baseline}">`);
    }
    
    // デバッグ情報
    console.debug("添え字開始: ", {
        type: type === 0 ? "下付き" : "上付き",
        position: F === 0 ? "前置" : "後置",
        unit: unit === 0 ? "文字列単位" : "文字単位",
        targetPosition: subscriptState.targetPosition,
        baseline: subscriptState.baseline
    });
}

/**
 * 添え字終了指定付箋を処理
 * @param {number} segLen セグメント長
 * @param {Array} tadSeg セグメントデータ
 */
function tadSubscriptEnd(segLen, tadSeg) {
    // 添え字状態をリセット
    subscriptState.active = false;
    
    // フォントサイズを元に戻す
    if (subscriptState.savedFontSize) {
        textFontSize = subscriptState.savedFontSize;
        textFontSet = textFontSize + 'px serif';
        delete subscriptState.savedFontSize;
    }
    
    // オフセットをリセット
    subscriptState.offset = { x: 0, y: 0 };

    // XML出力用
    if (isXmlDumpEnabled()) {
        xmlBuffer.push(`</attend>`);
    }
    
    console.debug("添え字終了");
}

/**
 * ルビ開始指定付箋を処理
 * @param {number} segLen セグメント長
 * @param {Array} tadSeg セグメントデータ
 */
function tsRubyStartFusen(segLen, tadSeg) {
    // attr = getLastUBinUH(tadSeg[0]) で属性を取得
    const attr = getLastUBinUH(tadSeg[0]);

    // attrのビット構成: UUUUxxxP
    // P: ルビ配置側 (0: 行戻し側, 1: 行送り側)
    const rubyPosition = attr & 0x01;

    // ルビ文字列を取得（tadSeg[1]以降はTRONコード列）
    let rubyText = '';
    for (let i = 1; i < segLen && i < tadSeg.length; i++) {
        const tronChar = charTronCode(tadSeg[i]);
        if (tronChar) {
            rubyText += tronChar;
        }
    }

    // ルビ状態を更新
    rubyState.active = true;
    rubyState.rubyText = rubyText;
    rubyState.position = rubyPosition;
    rubyState.baseText = '';  // 被ルビ文字列をリセット

    // 現在の描画位置を記録
    // charX, charY はグローバルスコープで管理されていないため、
    // ルビ開始時点では位置を記録できない
    // ルビ終了時に描画位置から計算する必要がある
    rubyState.startX = 0;  // 後で更新
    rubyState.startY = 0;  // 後で更新

    // ルビのフォントサイズを決定（暫定的に1/2に設定）
    // TODO: 行送り間隔と文字数比率に基づいて1/2か1/3を選択
    rubyState.fontSize = 0.5;

    // XML出力用
    if (isXmlDumpEnabled()) {
        xmlBuffer.push(`<ruby position="${rubyPosition}" text="${rubyText}">`);
    }
}

/**
 * ルビ終了指定付箋の処理
 * @param {*} segLen 
 * @param {*} tadSeg 
 * @returns 
 */
function tsRubyEndFusen(segLen, tadSeg) {
    if (!rubyState.active) {
        console.warn("ルビ終了付箋が呼ばれましたが、ルビ開始されていません");
        return;
    }
    
    // XML出力用
    if (isXmlDumpEnabled()) {
        xmlBuffer.push(`</ruby>`);
    }

    // ルビ状態をリセット
    rubyState.active = false;
    rubyState.baseText = '';
    rubyState.rubyText = '';
}

/**
 * 行頭禁則指定付箋の処理
 * @param {*} segLen 
 * @param {*} tadSeg 
 */
function tsLineStartProhibitionFusen(segLen, tadSeg) {
    // 行頭禁則指定付箋の処理
    // attr = getLastUBinUH(tadSeg[0]) で属性を取得
    const attr = getLastUBinUH(tadSeg[0]);

    // attrのビット構成: xxxLKKKK
    // L: 禁則レベル (ビット4)
    // K: 禁則方法 (ビット0-3)
    const prohibitionLevel = (attr >> 4) & 0x01;  // L: 0=一重禁則、1=多重禁則
    const prohibitionMethod = attr & 0x0F;        // K: 禁則方法

    // 禁則対象文字列を取得（tadSeg[1]以降はTRONコード列）
    let prohibitionChars = [];
    for (let i = 1; i < segLen && i < tadSeg.length; i++) {
        const tronChar = charTronCode(tadSeg[i]);
        if (tronChar) {
            prohibitionChars.push(tronChar);
        }
    }

    // 行頭禁則状態を更新
    if (prohibitionMethod === 0 || prohibitionChars.length === 0) {
        // 禁則無し、または禁則文字が空の場合
        lineStartProhibitionState.active = false;
        lineStartProhibitionState.method = 0;
        lineStartProhibitionState.chars = [];
    } else {
        lineStartProhibitionState.active = true;
        lineStartProhibitionState.level = prohibitionLevel;
        lineStartProhibitionState.method = prohibitionMethod;
        lineStartProhibitionState.chars = prohibitionChars;
    }

    console.debug(`行頭禁則設定: level=${prohibitionLevel}, method=${prohibitionMethod}, chars="${prohibitionChars.join('')}"`);
}


function tsLineEndProhibitionFusen(segLen, tadSeg) {
    // 行末禁則指定付箋の処理
    // attr = getLastUBinUH(tadSeg[0]) で属性を取得
    const attr = getLastUBinUH(tadSeg[0]);

    // attrのビット構成: xxxLKKKK
    // L: 禁則レベル (ビット4)
    // K: 禁則方法 (ビット0-3)
    const prohibitionLevel = (attr >> 4) & 0x01;  // L: 0=一重禁則、1=多重禁則
    const prohibitionMethod = attr & 0x0F;        // K: 禁則方法

    // 禁則対象文字列を取得（tadSeg[1]以降はTRONコード列）
    let prohibitionChars = [];
    for (let i = 1; i < segLen && i < tadSeg.length; i++) {
        const tronChar = charTronCode(tadSeg[i]);
        if (tronChar) {
            prohibitionChars.push(tronChar);
        }
    }

    // 行末禁則状態を更新
    if (prohibitionMethod === 0 || prohibitionChars.length === 0) {
        // 禁則無し、または禁則文字が空の場合
        lineEndProhibitionState.active = false;
        lineEndProhibitionState.method = 0;
        lineEndProhibitionState.chars = [];
    } else {
        lineEndProhibitionState.active = true;
        lineEndProhibitionState.level = prohibitionLevel;
        lineEndProhibitionState.method = prohibitionMethod;
        lineEndProhibitionState.chars = prohibitionChars;
    }

    console.debug(`行末禁則設定: level=${prohibitionLevel}, method=${prohibitionMethod}, chars="${prohibitionChars.join('')}"`);
}



/**
 * 固定幅空白指定付箋を処理
 * @param {number} segLen セグメント長
 * @param {Array} tadSeg セグメントデータ
 */
function tsFixedWidthSpaceFusen(segLen, tadSeg) {
    if (segLen < 1) {
        console.debug("固定幅空白指定付箋: セグメント長が不正");
        return;
    }

    const widthData = tadSeg[1];  // SCALE型の幅データ

    if (isXmlDumpEnabled()) {
        xmlBuffer.push(`<fixedSpace width="${Number(widthData).toString(16).padStart(4, '0')}"/>`);
    }
}

/**
 * 変数参照指定付箋を処理
 * @param {number} segLen セグメント長
 * @param {Array} tadSeg セグメントデータ
 */
function tsVariableReference(segLen, tadSeg) {
    if (segLen < 1) {
        console.debug("変数参照指定付箋: セグメント長が不正");
        return;
    }

    const varId = tadSeg[1]; // 変数ID
    console.debug(`変数参照指定付箋: varId=${varId}`);

    const variableValue = getVariableValue(varId);
    if (variableValue !== null) {
        // 変数値を文字列として描画
        for (let i = 0; i < variableValue.length; i++) {
            const char = variableValue.charAt(i);
        }
    }
}

/**
 * 変数IDに対応する値を取得
 * @param {number} varId 変数ID
 * @returns {string|null} 変数値
 */
function getVariableValue(varId) {
    const now = new Date();

    switch (varId) {
        case 0: // 自身の実身名
            return documentFileName || 'unnamed';

        case 100: // 年（西暦下二桁）
            return String(now.getFullYear()).slice(-2);

        case 101: // 元号（簡易実装）
            { const year = now.getFullYear();
            if (year >= 2019) return '令和';
            else if (year >= 1989) return '平成';
            else if (year >= 1926) return '昭和';
            else return '大正'; }

        case 110: // 月（1桁）
            return String(now.getMonth() + 1);

        case 111: // 月（2桁）
            return String(now.getMonth() + 1).padStart(2, '0');

        case 112: // 月（英小文字3文字）
            { const monthsLower = ['jan', 'feb', 'mar', 'apr', 'may', 'jun',
                                    'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
            return monthsLower[now.getMonth()]; }

        case 113: // 月（英大文字3文字）
            { const monthsUpper = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
                                    'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
            return monthsUpper[now.getMonth()]; }

        case 120: // 日（1桁）
            return String(now.getDate());

        case 121: // 日（2桁）
            return String(now.getDate()).padStart(2, '0');

        case 200: // 現在ページ番号（数字）
            return String(currentPageNumber);

        case 201: // 現在ページ番号（小文字ローマ数字）
            return toRomanNumeral(currentPageNumber, false);

        case 202: // 現在ページ番号（大文字ローマ数字）
            return toRomanNumeral(currentPageNumber, true);

        case 250: // 全体ページ番号（数字）
            return String(totalPageNumber);

        case 251: // 全体ページ番号（小文字ローマ数字）
            return toRomanNumeral(totalPageNumber, false);

        case 252: // 全体ページ番号（大文字ローマ数字）
            return toRomanNumeral(totalPageNumber, true);

        default:
            // ユーザー定義変数
            return variableReferences.get(varId) || null;
    }
}

/**
 * 数字をローマ数字に変換
 * @param {number} num 数字
 * @param {boolean} uppercase 大文字かどうか
 * @returns {string} ローマ数字
 */
function toRomanNumeral(num, uppercase = true) {
    const values = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
    const numerals = uppercase
        ? ['M', 'CM', 'D', 'CD', 'C', 'XC', 'L', 'XL', 'X', 'IX', 'V', 'IV', 'I']
        : ['m', 'cm', 'd', 'cd', 'c', 'xc', 'l', 'xl', 'x', 'ix', 'v', 'iv', 'i'];

    let result = '';
    for (let i = 0; i < values.length; i++) {
        while (num >= values[i]) {
            result += numerals[i];
            num -= values[i];
        }
    }
    return result;
}

/**
 * 特殊文字指定付箋を処理
 * @param {*} segLen 
 * @param {*} tadSeg 
 */
function tadTextAlignFusen(segLen, tadSeg) {
    const UB_SubID = getTopUBinUH(tadSeg[0]);

    if (UB_SubID === Number(0x00)) {
        console.debug("結合開始指定付箋");
        textLigatureFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x01)) {
        console.debug("結合終了指定付箋");
        textLigatureFusenEnd(segLen, tadSeg);
        // TODO
    } else if (UB_SubID === Number(0x02)) {
        console.debug("文字割付け開始指定付箋");
        // TODO
    } else if (UB_SubID === Number(0x03)) {
        console.debug("文字割付け終了指定付箋");
        // TODO
    } else if (UB_SubID === Number(0x04)) {
        console.debug("添え字開始指定付箋");
        tadSubscriptStart(segLen, tadSeg);
    } else if (UB_SubID === Number(0x05)) {
        console.debug("添え字終了指定付箋");
        tadSubscriptEnd(segLen, tadSeg);
    } else if (UB_SubID === Number(0x06)) {
        console.debug("ルビ開始指定付箋");
        tsRubyStartFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x07)) {
        console.debug("ルビ終了指定付箋");
        tsRubyEndFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x08)) {
        console.debug("行頭禁則指定付箋");
        tsLineStartProhibitionFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x09)) {
        console.debug("行末禁則指定付箋");
        tsLineEndProhibitionFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x0A)) {
        console.debug("固定幅空白指定付箋");
        tsFixedWidthSpaceFusen(segLen, tadSeg);
    }
}

/**
 * 文字修飾指定付箋を処理
 * @param {*} segLen 
 * @param {*} tadSeg 
 */
function tadTextStyleFusen(segLen, tadSeg) {
    const UB_SubID = getTopUBinUH(tadSeg[0]);

    if (UB_SubID === Number(0x00)) {
        console.debug("下線開始");
        tadTextStyleLineStart(segLen, tadSeg, UB_SubID);
        // TODO
    } else if (UB_SubID === Number(0x01)) {
        console.debug("下線終了");
        tadTextStyleLineEnd(segLen, tadSeg, UB_SubID);
        // TODO
    } else if (UB_SubID === Number(0x02)) {
        console.debug("上線開始");
        tadTextStyleLineStart(segLen, tadSeg, UB_SubID);
        // TODO
    } else if (UB_SubID === Number(0x03)) {
        console.debug("上線終了");
        tadTextStyleLineEnd(segLen, tadSeg, UB_SubID);
        // TODO
    } else if (UB_SubID === Number(0x04)) {
        console.debug("打ち消し線開始");
        tadTextStyleLineStart(segLen, tadSeg, UB_SubID);
        // TODO
    } else if (UB_SubID === Number(0x05)) {
        console.debug("打ち消し線終了");
        tadTextStyleLineEnd(segLen, tadSeg, UB_SubID);
        // TODO
    } else if (UB_SubID === Number(0x06)) {
        console.debug("枠囲み線開始");
        tadTextStyleLineStart(segLen, tadSeg, UB_SubID);
    } else if (UB_SubID === Number(0x07)) {
        console.debug("枠囲み線終了");
        tadTextStyleLineEnd(segLen, tadSeg, UB_SubID);
    } else if (UB_SubID === Number(0x08)) {
        console.debug("上（右）傍点開始");
        // TODO
    } else if (UB_SubID === Number(0x09)) {
        console.debug("上（右）傍点終了");
        // TODO
    } else if (UB_SubID === Number(0x0A)) {
        console.debug("下（左）傍点開始");
        // TODO
    } else if (UB_SubID === Number(0x0B)) {
        console.debug("下（左）傍点終了");
        // TODO
    } else if (UB_SubID === Number(0x0C)) {
        console.debug("反転開始");
        tadTextStyleLineStart(segLen, tadSeg, UB_SubID);
    } else if (UB_SubID === Number(0x0D)) {
        console.debug("反転終了");
        tadTextStyleLineEnd(segLen, tadSeg, UB_SubID);
    } else if (UB_SubID === Number(0x0E)) {
        console.debug("網掛開始");
        tadTextStyleLineStart(segLen, tadSeg, UB_SubID);
    } else if (UB_SubID === Number(0x0F)) {
        console.debug("網掛終了");
        tadTextStyleLineEnd(segLen, tadSeg, UB_SubID);
    } else if (UB_SubID === Number(0x10)) {
        console.debug("背景開始");
        tadTextStyleLineStart(segLen, tadSeg, UB_SubID);
    } else if (UB_SubID === Number(0x11)) {
        console.debug("背景終了");
        tadTextStyleLineEnd(segLen, tadSeg, UB_SubID);
    } else if (UB_SubID === Number(0x12)) {
        console.debug("無印字開始");
        tadTextStyleLineStart(segLen, tadSeg, UB_SubID);
    } else if (UB_SubID === Number(0x13)) {
        console.debug("無印字終了");
        tadTextStyleLineEnd(segLen, tadSeg, UB_SubID);
    }
}

/**
 * 文字修飾指定付箋の線開始を処理
 * @param {*} segLen 
 * @param {*} tadSeg 
 * @param {*} UB_SubID 
 */
function tadTextStyleLineStart(segLen, tadSeg, UB_SubID) {
    // 装飾タイプを判定
    let xmlTag = null;
    if (UB_SubID === 0x00) {
        textDecorations.underline = true;
        xmlTag = "<underline>";
    } else if (UB_SubID === 0x02) {
        textDecorations.overline = true;
        xmlTag = "<overline>";
    } else if (UB_SubID === 0x04) {
        textDecorations.strikethrough = true;
        xmlTag = "<strikethrough>";
    } else if (UB_SubID === 0x06) {
        textDecorations.box = true;
        xmlTag = "<box>";
    } else if (UB_SubID === 0x0C) {
        textDecorations.invert = true;
        xmlTag = "<invert>";
    } else if (UB_SubID === 0x0E) {
        textDecorations.mesh = true;
        xmlTag = "<mesh>";
    } else if (UB_SubID === 0x10) {
        xmlTag = "<background>";
        textDecorations.background = true;
    } else if (UB_SubID === 0x12) {
        textDecorations.noprint = true;
        xmlTag = "<noprint>";
    } else {
        return;
    }

    if (isXmlDumpEnabled && xmlTag !== null && isInDocSegment) {
        xmlBuffer.push(`${xmlTag}`);
    }
}

/**
 * 文字修飾指定付箋の線終了を処理
 * @param {*} segLen 
 * @param {*} tadSeg 
 * @param {*} UB_SubID 
 */
function tadTextStyleLineEnd(segLen, tadSeg, UB_SubID) {
    // 装飾タイプを判定
    // 閉じタグは開いている場合のみ出力する（null→false遷移ではタグを出力しない）
    let lineType = '';
    let xmlTag = null;
    if (UB_SubID === 0x01) {
        lineType = 'underline';
        if (textDecorations.underline) {
            xmlTag = "</underline>";
        }
        textDecorations.underline = false;
    } else if (UB_SubID === 0x03) {
        lineType = 'overline';
        if (textDecorations.overline) {
            xmlTag = "</overline>";
        }
        textDecorations.overline = false;
    } else if (UB_SubID === 0x05) {
        lineType = 'strikethrough';
        if (textDecorations.strikethrough) {
            xmlTag = "</strikethrough>";
        }
        textDecorations.strikethrough = false;
    } else if (UB_SubID === 0x07) {
        lineType = 'box';
        if (textDecorations.box) {
            xmlTag = "</box>";
        }
        textDecorations.box = false;
    } else if (UB_SubID === 0x0D) {
        lineType = 'invert';
        if (textDecorations.invert) {
            xmlTag = "</invert>";
        }
        textDecorations.invert = false;
    } else if (UB_SubID === 0x0F) {
        lineType = 'mesh';
        if (textDecorations.mesh) {
            xmlTag = "</mesh>";
        }
        textDecorations.mesh = false;
    } else if (UB_SubID === 0x11) {
        lineType = 'background';
        if (textDecorations.background) {
            xmlTag = "</background>";
        }
        textDecorations.background = false;
    } else if (UB_SubID === 0x13) {
        lineType = 'noprint';
        if (textDecorations.noprint) {
            xmlTag = "</noprint>";
        }
        textDecorations.noprint = false;
    } else {
        return;
    }

    if (isXmlDumpEnabled && xmlTag !== null && isInDocSegment) {
        xmlBuffer.push(`${xmlTag}`);
    }

    textDecorations[lineType] = null;
}



// 画像番号カウンタ（ファイルとレコードごとに管理）
const imageCounters = {}; // { 'fileid_recordno': imgno }

// 現在のレコード番号（pass2で設定）
let currentRecordNo = 0;

/**
 * 画像セグメント処理
 * @param {number} segLen - セグメント長
 * @param {Array} tadSeg - セグメントデータ
 */
function tsImageSegment(segLen, tadSeg) {
    
    if (segLen < 0x3C) {
        console.debug("画像セグメントが短すぎます");
        return;
    }
    
    // 新しい画像セグメントを作成
    const imageSeg = new IMAGESEG();
    
    // ビュー座標を取得 (RECT構造体のプロパティにアクセス)
    imageSeg.view.left = uh2h(tadSeg[0]);
    imageSeg.view.top = uh2h(tadSeg[1]);
    imageSeg.view.right = uh2h(tadSeg[2]);
    imageSeg.view.bottom = uh2h(tadSeg[3]);
    
    // 描画座標を取得
    imageSeg.draw.left = uh2h(tadSeg[4]);
    imageSeg.draw.top = uh2h(tadSeg[5]);
    imageSeg.draw.right = uh2h(tadSeg[6]);
    imageSeg.draw.bottom = uh2h(tadSeg[7]);
    
    // ユニット情報
    imageSeg.h_unit = units(uh2h(tadSeg[8]));
    imageSeg.v_unit = units(uh2h(tadSeg[9]));
    
    // 傾き情報
    imageSeg.slope = uh2h(tadSeg[10]);
    
    // 基本的な色情報の読み取り（シンプル化）
    const colorValue = uh2uw([tadSeg[12], tadSeg[11]])[0];
    imageSeg.color = parseColor(colorValue);
    
    // カラー情報配列
    imageSeg.cinfo[0] = uh2h(tadSeg[12]);
    imageSeg.cinfo[1] = uh2h(tadSeg[13]);
    imageSeg.cinfo[2] = uh2h(tadSeg[14]);
    imageSeg.cinfo[3] = uh2h(tadSeg[15]);
    
    // 画像の詳細情報
    imageSeg.extlen = uh2uw([tadSeg[17], tadSeg[16]])[0];   // extlen (UW)
    imageSeg.extend = uh2uw([tadSeg[19], tadSeg[18]])[0];   // extoff (UW)
    imageSeg.mask = uh2uw([tadSeg[21], tadSeg[20]])[0];     // maskoffset (UW)
    imageSeg.compac = uh2h(tadSeg[22]);                     // compac (UH)
    imageSeg.planes = uh2h(tadSeg[23]);                     // planes (UH)
    imageSeg.pixbits = uh2h(tadSeg[24]);                    // pixbits (UH)
    imageSeg.rowbytes = uh2h(tadSeg[25]);                   // rowbytes (UH)
    
    // バウンディング情報
    imageSeg.bounds.left = uh2h(tadSeg[26]);
    imageSeg.bounds.top = uh2h(tadSeg[27]);
    imageSeg.bounds.right = uh2h(tadSeg[28]);
    imageSeg.bounds.bottom = uh2h(tadSeg[29]);
    
    // 画像の幅と高さを計算
    const width = imageSeg.bounds.right - imageSeg.bounds.left;
    const height = imageSeg.bounds.bottom - imageSeg.bounds.top;
    
    console.debug(`画像情報: ${width}x${height}, planes=${imageSeg.planes}, pixbits=${imageSeg.pixbits} (0x${imageSeg.pixbits.toString(16)}), rowbytes=${imageSeg.rowbytes}`);
    console.debug(`bounds: left=${imageSeg.bounds.left}, top=${imageSeg.bounds.top}, right=${imageSeg.bounds.right}, bottom=${imageSeg.bounds.bottom}`);
    
    // プレーンオフセット情報を読み取り
    const planeOffsetStart = 30; // プレーンオフセットの開始位置
    
    // 最初のプレーンオフセットから実際の画像データ開始位置を特定
    const imageDataStart = planeOffsetStart + imageSeg.planes * 2; // 各プレーンオフセット分をスキップ
    
    if (segLen > imageDataStart * 2) {
        const imageDataLen = segLen - (imageDataStart * 2);
        
        // ビットマップデータを抽出（従来の方法）
        if (imageDataLen > 0) {
            imageSeg.bitmap = new Uint8Array(imageDataLen);
            for (let i = 0; i < Math.floor(imageDataLen / 2); i++) {
                if (imageDataStart + i < tadSeg.length) {
                    const word = tadSeg[imageDataStart + i];
                    imageSeg.bitmap[i * 2] = word & 0xFF;
                    if (i * 2 + 1 < imageDataLen) {
                        imageSeg.bitmap[i * 2 + 1] = (word >> 8) & 0xFF;
                    }
                }
            }
        }
    }

    // isXmlDumpEnabled時にPNG画像ファイルを生成
    if (isXmlDumpEnabled() && imageSeg.bitmap) {
        const filename = generatePngImage(imageSeg);

        // XMLタグを追加（エディタ用形式: left/top/right/bottom/href）
        figureZIndexCounter++;
        const xmlTag = `<image lineType="0" lineWidth="1" l_pat="0" f_pat="0" angle="0" rotation="0" flipH="false" flipV="false" left="${imageSeg.bounds.left}" top="${imageSeg.bounds.top}" right="${imageSeg.bounds.right}" bottom="${imageSeg.bounds.bottom}" href="${filename}" zIndex="${figureZIndexCounter}"/>\r\n`;
        xmlBuffer.push(xmlTag);
        resetFigureModifier();
        resetFigureTransformState();
    }
}

/**
 * ピクセル色を取得する汎用関数
 * @param {IMAGESEG} imageSeg - 画像セグメントオブジェクト
 * @param {number} pixelIndex - ピクセルインデックス
 * @returns {Array} [r, g, b]
 */
function getPixelColor(imageSeg, pixelIndex) {
    if (!imageSeg.bitmap || imageSeg.bitmap.length === 0) {
        return [0, 0, 0];
    }
    
    // pixbitsを解釈
    const pixelcount = imageSeg.pixbits & 0xFF;      // 実際のビット数
    const pixeldatawidth = (imageSeg.pixbits >> 8) & 0xFF; // データ幅
    
    // データ幅に基づいてバイト数を計算
    let bytesPerPixel;
    if (pixeldatawidth > 0) {
        // データ幅が指定されている場合はそれを使用
        bytesPerPixel = Math.ceil(pixeldatawidth / 8);
    } else {
        // データ幅が0の場合は実際のビット数から計算
        bytesPerPixel = Math.ceil(pixelcount / 8);
    }
    
    const byteIndex = pixelIndex * bytesPerPixel;
    if (byteIndex >= imageSeg.bitmap.length) {
        return [0, 0, 0];
    }
    
    // ピクセルカウントに基づいて色を取得
    switch(pixelcount) {
        case 1: { // 1bit モノクロ
            const bitIndex = pixelIndex % 8;
            const byteIdx = Math.floor(pixelIndex / 8);
            if (byteIdx >= imageSeg.bitmap.length) return [0, 0, 0];
            const bit = (imageSeg.bitmap[byteIdx] >> (7 - bitIndex)) & 1;
            const mono = bit ? 255 : 0;
            return [mono, mono, mono];
        }
        
        case 8: { // 8bit グレースケール
            const gray8 = imageSeg.bitmap[byteIndex];
            return [gray8, gray8, gray8];
        }
        
        case 16: { // 16bit カラー (5-6-5 RGB)
            if (byteIndex + 1 >= imageSeg.bitmap.length) return [0, 0, 0];
            const rgb16 = (imageSeg.bitmap[byteIndex + 1] << 8) | imageSeg.bitmap[byteIndex];
            const r16 = ((rgb16 >> 11) & 0x1F) << 3;
            const g16 = ((rgb16 >> 5) & 0x3F) << 2;
            const b16 = (rgb16 & 0x1F) << 3;
            return [r16, g16, b16];
        }
        
        case 24: { // 24bit フルカラー
            // pixeldatawidthが32の場合、4バイト境界でデータが格納される
            if (byteIndex + 2 >= imageSeg.bitmap.length) return [0, 0, 0];
            return [
                imageSeg.bitmap[byteIndex + 2], // R
                imageSeg.bitmap[byteIndex + 1], // G
                imageSeg.bitmap[byteIndex]      // B
            ];
        }
        
        case 32: { // 32bit フルカラー+アルファ
            if (byteIndex + 3 >= imageSeg.bitmap.length) return [0, 0, 0];
            return [
                imageSeg.bitmap[byteIndex + 2], // R
                imageSeg.bitmap[byteIndex + 1], // G
                imageSeg.bitmap[byteIndex]      // B
                // byteIndex + 3 はアルファチャンネル（無視）
            ];
        }
        
        default: {
            // デフォルトは最初の3バイトをRGBとして扱う
            if (byteIndex + 2 < imageSeg.bitmap.length) {
                return [
                    imageSeg.bitmap[byteIndex + 2] || 0,
                    imageSeg.bitmap[byteIndex + 1] || 0,
                    imageSeg.bitmap[byteIndex] || 0
                ];
            }
            return [0, 0, 0];
        }
    }
}

/**
 * PNG画像ファイルを生成（isXmlDumpEnabled時）
 * @param {IMAGESEG} imageSeg - 画像セグメントオブジェクト
 */
function generatePngImage(imageSeg) {
    try {
        // 画像サイズを取得
        const width = imageSeg.bounds.right - imageSeg.bounds.left;
        const height = imageSeg.bounds.bottom - imageSeg.bounds.top;

        if (width <= 0 || height <= 0 || !imageSeg.bitmap) {
            console.debug('[generatePngImage] Invalid image dimensions or no bitmap data');
            return;
        }

        // 実身ID（UUID）を取得
        // currentFileIndexからrealIdMapを使ってUUIDに変換
        const fileId = realIdMap.get(currentFileIndex) || `unknown_${currentFileIndex}`;

        // レコード番号（現在のレコード番号）
        const recordNo = currentRecordNo;

        // 画像番号のキーを生成
        const counterKey = `${fileId}_${recordNo}`;

        // 画像番号を取得・インクリメント
        if (!imageCounters[counterKey]) {
            imageCounters[counterKey] = 0;
        }
        const imgNo = imageCounters[counterKey];
        imageCounters[counterKey]++;

        // ファイル名を生成: 実身ID_recordno_imgno.png
        const fileName = `${fileId}_${recordNo}_${imgNo}.png`;

        console.log(`[generatePngImage] Generating PNG: ${fileName} (${width}x${height})`);

        // CanvasにImageDataを描画してPNGに変換
        if (typeof document !== 'undefined') {
            // ブラウザ環境
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = width;
            tempCanvas.height = height;
            const tempCtx = tempCanvas.getContext('2d');

            // ImageDataを作成
            const imageData = tempCtx.createImageData(width, height);
            const data = imageData.data;

            // ビットマップデータをImageDataに変換
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const srcIndex = y * width + x;
                    const destIndex = (y * width + x) * 4;

                    const [r, g, b] = getPixelColor(imageSeg, srcIndex);
                    data[destIndex] = r;         // R
                    data[destIndex + 1] = g;     // G
                    data[destIndex + 2] = b;     // B
                    data[destIndex + 3] = 255;   // A（不透明）
                }
            }

            tempCtx.putImageData(imageData, 0, 0);

            // Canvas to Blob
            tempCanvas.toBlob((blob) => {
                if (blob) {
                    // 生成した画像情報を配列に保存
                    generatedImages.push({
                        fileId: fileId,
                        recordNo: recordNo,
                        imgNo: imgNo,
                        fileName: fileName,
                        blob: blob,
                        width: width,
                        height: height
                    });

                    console.log(`[generatePngImage] PNG generated and stored: ${fileName} (${width}x${height})`);

                    // 開発用：ダウンロードリンクも作成（デバッグ時のみ）
                    if (false) {  // デバッグ時はtrueに変更
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = fileName;
                        a.style.display = 'none';
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                    }
                }
            }, 'image/png');
            return fileName;
        } else if (typeof require !== 'undefined') {
            // Node.js環境（将来的にfs.writeFileでファイル保存可能）
            console.debug('[generatePngImage] Node.js environment - PNG generation not implemented yet');
        }

    } catch (error) {
        console.error('[generatePngImage] Error generating PNG:', error);
    }
}

/**
 * 結合開始指定付箋を処理
 * @param {*} segLen 
 * @param {*} tadSeg 
 */
function textLigatureFusen(segLen, tadSeg) {

}

/**
 * 結合終了指定付箋を処理
 * @param {*} segLen 
 * @param {*} tadSeg 
 */
function textLigatureFusenEnd(segLen, tadSeg) {

}

/**
 * 図形開始セグメントを処理
 * @param {0x0000[]} tadSeg 
 */
function tsFigStart(tadSeg) {

    // セグメントスタックに図形セグメントを追加
    segmentStack.push(SEGMENT_TYPE.FIGURE);
    currentSegmentType = SEGMENT_TYPE.FIGURE;

    // z-indexカウンタを初期化
    figureZIndexCounter = 0;

    if (!startTadSegment) {
        startTadSegment = true;
        startByImageSegment = true;
        const h_unit = units(uh2h(tadSeg[8]));
        const v_unit = units(uh2h(tadSeg[9]));
        if (h_unit < 0) {
            tadDpiHFlag = true;
        }
        if (v_unit < 0) {
            tadDpiVFlag = true;
        }
        tadDpiH = h_unit; // h_unit
        tadDpiV = v_unit; // v_unit
    }

    let figSeg = new STARTFIGSEG();
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

    // XMLダンプ機能が有効な場合、図形開始セグメントの情報をXML形式で出力
    if (isXmlDumpEnabled()) {
        xmlBuffer.push('<figure>\r\n');
        xmlBuffer.push(`<figView top="${figSeg.view.top}" left="${figSeg.view.left}" right="${figSeg.view.right}" bottom="${figSeg.view.bottom}"/>\r\n`);
        xmlBuffer.push(`<figDraw top="${figSeg.draw.top}" left="${figSeg.draw.left}" right="${figSeg.draw.right}" bottom="${figSeg.draw.bottom}"/>\r\n`);
        xmlBuffer.push(`<figScale hunit="${figSeg.h_unit}" vunit="${figSeg.v_unit}"/>\r\n`);
        isXmlFig = true;
    }
}

/**
 * 図形終了 セグメントを処理
 * @param {*} tadSeg 
 */
function tsFigEnd(tadSeg) {
    // XMLダンプ機能が有効な場合、図形終了タグを出力
    if (isXmlDumpEnabled()) {
        xmlBuffer.push('</figure>\r\n');
        isXmlFig = false;
    }
}


/**
 * 図形要素セグメント 長方形セグメントを描画
 * @param {*} segLen 
 * @param {*} tadSeg 
 * @returns 
 */
function tsFigRectAngleDraw(segLen, tadSeg) {
    if (segLen < Number(0x0012)) {
        return;
    }
    const l_atr = Number(tadSeg[1]);
    const lineType = (l_atr >> 8) & 0xFF;
    const lineWidth = l_atr & 0xFF;
    const l_pat = Number(tadSeg[2]);
    const f_pat = Number(tadSeg[3]);
    const angle = Number(tadSeg[4]);
    const figX = Number(tadSeg[5]);
    const figY = Number(tadSeg[6]);
    const figW = Number(tadSeg[7]) - figX;
    const figH = Number(tadSeg[8]) - figY;

    if(isXmlDumpEnabled()) {
        figureZIndexCounter++;
        xmlBuffer.push(`<rect round="0" lineType="${lineType}" lineWidth="${lineWidth}" l_pat="${l_pat}" f_pat="${f_pat}" angle="${angle}" left="${figX}" top="${figY}" right="${figX + figW}" bottom="${figY + figH}" zIndex="${figureZIndexCounter}" />\r\n`);
        resetFigureModifier();
        resetFigureTransformState();
    }
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
    const l_atr = Number(tadSeg[1]);
    const lineType = (l_atr >> 8) & 0xFF;
    const lineWidth = l_atr & 0xFF;
    const l_pat = Number(tadSeg[2]);
    const f_pat = Number(tadSeg[3]);
    const angle = Number(tadSeg[4]);
    const figRH = Number(tadSeg[5]);
    const figRV = Number(tadSeg[6]);
    const figX = Number(tadSeg[7]);
    const figY = Number(tadSeg[8]);
    const figW = Number(tadSeg[9]) - figX;
    const figH = Number(tadSeg[10]) - figY;

    if(isXmlDumpEnabled()) {
        figureZIndexCounter++;
        xmlBuffer.push(`<rect round="1" lineType="${lineType}" lineWidth="${lineWidth}" l_pat="${l_pat}" f_pat="${f_pat}" angle="${angle}" figRH="${figRH}" figRV="${figRV}" left="${figX}" top="${figY}" right="${figX + figW}" bottom="${figY + figH}" zIndex="${figureZIndexCounter}" />\r\n`);
        resetFigureModifier();
        resetFigureTransformState();
    }
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

    const l_atr = Number(tadSeg[1]);
    const lineType = (l_atr >> 8) & 0xFF;
    const lineWidth = l_atr & 0xFF;
    const l_pat = Number(tadSeg[2]);
    const f_pat = Number(tadSeg[3]);

    console.debug(`Polygon attributes: l_atr=${IntToHex((tadSeg[1]),4).replace('0x','')}, l_pat=${IntToHex((tadSeg[2]),4).replace('0x','')}, f_pat=${IntToHex((tadSeg[3]),4).replace('0x','')}`);
    console.debug("round  " + IntToHex((tadSeg[4]),4).replace('0x',''));
    console.debug("np     " + IntToHex((tadSeg[5]),4).replace('0x',''));
    console.debug("x      " + IntToHex((tadSeg[6]),4).replace('0x',''));
    console.debug("y      " + IntToHex((tadSeg[7]),4).replace('0x',''));

    let x = Number(tadSeg[6]);
    let y = Number(tadSeg[7]);

    if(isXmlDumpEnabled()) {
        const pointsArray = [];
        for(let offsetLen=6;offsetLen<tadSeg.length;offsetLen+=2) {
            const px = Number(tadSeg[offsetLen]);
            const py = Number(tadSeg[offsetLen+1]);
            pointsArray.push(`${px},${py}`);
        }
        figureZIndexCounter++;
        xmlBuffer.push(`<polygon lineType="${lineType}" lineWidth="${lineWidth}" l_pat="${l_pat}" f_pat="${f_pat}" points="${pointsArray.join(' ')}" zIndex="${figureZIndexCounter}" />\r\n`);
        resetFigureModifier();
        resetFigureTransformState();
    }
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
    
    const l_atr = Number(tadSeg[1]);
    const lineType = (l_atr >> 8) & 0xFF;
    const lineWidth = l_atr & 0xFF;
    const l_pat = Number(tadSeg[2]);

    let x = Number(tadSeg[3]);
    let y = Number(tadSeg[4]);

    if(isXmlDumpEnabled()) {
        const pointsArray = [];
        for(let offsetLen=3;offsetLen<tadSeg.length;offsetLen+=2) {
            const px = Number(tadSeg[offsetLen]);
            const py = Number(tadSeg[offsetLen+1]);
            pointsArray.push(`${px},${py}`);
        }
        const startArrow = figureModifierState.startArrow ? '1' : '0';
        const endArrow = figureModifierState.endArrow ? '1' : '0';
        figureZIndexCounter++;
        xmlBuffer.push(`<line lineType="${lineType}" lineWidth="${lineWidth}" l_pat="${l_pat}" f_pat="0" start_arrow="${startArrow}" end_arrow="${endArrow}" arrow_type="simple" points="${pointsArray.join(' ')}" zIndex="${figureZIndexCounter}" />\r\n`);
        resetFigureModifier();
        resetFigureTransformState();
    }
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

    const l_atr = Number(tadSeg[1]);
    const lineType = (l_atr >> 8) & 0xFF;
    const lineWidth = l_atr & 0xFF;
    const l_pat = Number(tadSeg[2]);
    const f_pat = Number(tadSeg[3]);
    const angle = Number(uh2h(tadSeg[4]));
    const frameLeft = Number(uh2h(tadSeg[5]));
    const frameTop = Number(uh2h(tadSeg[6]));
    const frameRight = Number(uh2h(tadSeg[7]));
    const frameBottom = Number(uh2h(tadSeg[8]));
    const radiusX = ( frameRight - frameLeft ) / 2;
    const radiusY = (frameBottom - frameTop) / 2;
    const frameCenterX = frameLeft + radiusX;
    const frameCenterY = frameTop + radiusY;

    if(isXmlDumpEnabled()) {
        figureZIndexCounter++;
        xmlBuffer.push(`<ellipse lineType="${lineType}" lineWidth="${lineWidth}" l_pat="${l_pat}" f_pat="${f_pat}" angle="${angle}" cx="${frameCenterX}" cy="${frameCenterY}" rx="${radiusX}" ry="${radiusY}" zIndex="${figureZIndexCounter}" />\r\n`);
        resetFigureModifier();
        resetFigureTransformState();
    }
}

/**
 * 図形セグメント 扇形セグメントを描画
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 * @returns 
 */
function tsFigArcDraw(segLen, tadSeg) {
    if (segLen < Number(0x0018)) {
        return;
    }

    const l_atr = Number(tadSeg[1]);
    const lineType = (l_atr >> 8) & 0xFF;
    const lineWidth = l_atr & 0xFF;
    const l_pat = Number(tadSeg[2]);
    const f_pat = Number(tadSeg[3]);
    const angle = Number(uh2h(tadSeg[4]));

    // フレーム座標（half-openなので right と bottom に +1）
    const frameLeft = Number(uh2h(tadSeg[5]));
    const frameTop = Number(uh2h(tadSeg[6]));
    const frameRight = Number(uh2h(tadSeg[7])) + 1;
    const frameBottom = Number(uh2h(tadSeg[8])) + 1;

    // 開始・終了点
    const startX = Number(uh2h(tadSeg[9]));
    const startY = Number(uh2h(tadSeg[10]));
    const endX = Number(uh2h(tadSeg[11]));
    const endY = Number(uh2h(tadSeg[12]));

    const radiusX = (frameRight - frameLeft) / 2;
    const radiusY = (frameBottom - frameTop) / 2;
    const centerX = frameLeft + radiusX;
    const centerY = frameTop + radiusY;

    // 開始・終了角度を計算（楕円上の点から角度を求める）
    const startAngle = Math.atan2((startY - centerY) / radiusY, (startX - centerX) / radiusX);
    const endAngle = Math.atan2((endY - centerY) / radiusY, (endX - centerX) / radiusX);

    if(isXmlDumpEnabled()) {
        const startArrow = figureModifierState.startArrow ? '1' : '0';
        const endArrow = figureModifierState.endArrow ? '1' : '0';
        figureZIndexCounter++;
        xmlBuffer.push(`<arc lineType="${lineType}" lineWidth="${lineWidth}" l_pat="${l_pat}" f_pat="${f_pat}" angle="${angle}" cx="${centerX}" cy="${centerY}" rx="${radiusX}" ry="${radiusY}" startX="${startX}" startY="${startY}" endX="${endX}" endY="${endY}" startAngle="${startAngle}" endAngle="${endAngle}" start_arrow="${startArrow}" end_arrow="${endArrow}" arrow_type="simple" zIndex="${figureZIndexCounter}" />\r\n`);
        resetFigureModifier();
        resetFigureTransformState();
    }
}

/**
 * 図形セグメント 弓形セグメントを描画
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 * @returns 
 */
function tsFigChordDraw(segLen, tadSeg) {
    if (segLen < Number(0x0018)) {
        return;
    }

    const l_atr = Number(tadSeg[1]);
    const lineType = (l_atr >> 8) & 0xFF;
    const lineWidth = l_atr & 0xFF;
    const l_pat = Number(tadSeg[2]);
    const f_pat = Number(tadSeg[3]);
    const angle = Number(uh2h(tadSeg[4]));

    // フレーム座標（half-openなので right と bottom に +1）
    const frameLeft = Number(uh2h(tadSeg[5]));
    const frameTop = Number(uh2h(tadSeg[6]));
    const frameRight = Number(uh2h(tadSeg[7])) + 1;
    const frameBottom = Number(uh2h(tadSeg[8])) + 1;

    // 開始・終了点の指定位置
    const startx = Number(uh2h(tadSeg[9]));
    const starty = Number(uh2h(tadSeg[10]));
    const endx = Number(uh2h(tadSeg[11]));
    const endy = Number(uh2h(tadSeg[12]));

    const radiusX = (frameRight - frameLeft) / 2;
    const radiusY = (frameBottom - frameTop) / 2;
    const frameCenterX = frameLeft + radiusX;
    const frameCenterY = frameTop + radiusY;

    // 楕円の中心とstart/endを結ぶ直線が楕円と交わる点を計算
    // 開始点の角度を計算
    const startAngleRaw = Math.atan2(starty - frameCenterY, startx - frameCenterX);
    // 楕円上の実際の開始点を計算
    const startXOnEllipse = frameCenterX + radiusX * Math.cos(startAngleRaw);
    const startYOnEllipse = frameCenterY + radiusY * Math.sin(startAngleRaw);

    // 終了点の角度を計算
    const endAngleRaw = Math.atan2(endy - frameCenterY, endx - frameCenterX);
    // 楕円上の実際の終了点を計算
    const endXOnEllipse = frameCenterX + radiusX * Math.cos(endAngleRaw);
    const endYOnEllipse = frameCenterY + radiusY * Math.sin(endAngleRaw);

    // 楕円座標系での角度を計算
    const startAngle = Math.atan2((startYOnEllipse - frameCenterY) / radiusY, (startXOnEllipse - frameCenterX) / radiusX);
    const endAngle = Math.atan2((endYOnEllipse - frameCenterY) / radiusY, (endXOnEllipse - frameCenterX) / radiusX);

    if(isXmlDumpEnabled()) {
        const startArrow = figureModifierState.startArrow ? '1' : '0';
        const endArrow = figureModifierState.endArrow ? '1' : '0';
        figureZIndexCounter++;
        xmlBuffer.push(`<chord lineType="${lineType}" lineWidth="${lineWidth}" l_pat="${l_pat}" f_pat="${f_pat}" angle="${angle}" cx="${frameCenterX}" cy="${frameCenterY}" rx="${radiusX}" ry="${radiusY}" startX="${startXOnEllipse}" startY="${startYOnEllipse}" endX="${endXOnEllipse}" endY="${endYOnEllipse}" startAngle="${startAngle}" endAngle="${endAngle}" start_arrow="${startArrow}" end_arrow="${endArrow}" arrow_type="simple" zIndex="${figureZIndexCounter}" />\r\n`);
        resetFigureModifier();
        resetFigureTransformState();
    }
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

    const l_atr = Number(tadSeg[1]);
    const lineType = (l_atr >> 8) & 0xFF;
    const lineWidth = l_atr & 0xFF;
    const l_pat = Number(tadSeg[2]);
    const angle = Number(uh2h(tadSeg[3]));
    const frameLeft = Number(uh2h(tadSeg[4]));
    const frameTop = Number(uh2h(tadSeg[5]));
    const frameRight = Number(uh2h(tadSeg[6]));
    const frameBottom = Number(uh2h(tadSeg[7]));
    const startX = Number(uh2h(tadSeg[8]));
    const startY = Number(uh2h(tadSeg[9]));
    const endX = Number(uh2h(tadSeg[10]));
    const endY = Number(uh2h(tadSeg[11]));
    const radiusX = ( frameRight - frameLeft ) / 2;
    const radiusY = (frameBottom - frameTop) / 2;
    const frameCenterX = frameLeft + radiusX;
    const frameCenterY = frameTop + radiusY;
    const radianStart = Math.atan2(startY - frameCenterY, startX - frameCenterX)
    const radianEnd = Math.atan2(endY - frameCenterY, endX - frameCenterX)

    if(isXmlDumpEnabled()) {
        const startArrow = figureModifierState.startArrow ? '1' : '0';
        const endArrow = figureModifierState.endArrow ? '1' : '0';
        figureZIndexCounter++;
        xmlBuffer.push(`<elliptical_arc lineType="${lineType}" lineWidth="${lineWidth}" l_pat="${l_pat}" angle="${angle}" cx="${frameCenterX}" cy="${frameCenterY}" rx="${radiusX}" ry="${radiusY}" startX="${startX}" startY="${startY}" endX="${endX}" endY="${endY}" startAngle="${radianStart}" endAngle="${radianEnd}" start_arrow="${startArrow}" end_arrow="${endArrow}" arrow_type="simple" zIndex="${figureZIndexCounter}" />\r\n`);
        resetFigureModifier();
        resetFigureTransformState();
    }
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
    const l_atr = Number(uh2h(tadSeg[1]));
    const lineType = (l_atr >> 8) & 0xFF;
    const lineWidth = l_atr & 0xFF;
    const l_pat = Number(uh2h(tadSeg[2]));
    const round = Number(uh2h(tadSeg[3]));
    const np = Number(uh2h(tadSeg[4]));

    console.debug(`Polyline attributes: l_atr=${IntToHex((tadSeg[1]),4).replace('0x','')}, l_pat=${IntToHex((tadSeg[2]),4).replace('0x','')}`);



    let polyLines = [];
    for (let i = 0; i < np; i++) {
        let polyline = new PNT();
        polyline.x = Number(uh2h(tadSeg[5 + (i * 2)]));
        polyline.y = Number(uh2h(tadSeg[6 + (i * 2)]));
        polyLines.push(polyline);
    }

    if(isXmlDumpEnabled()) {
        const pointsArray = [];
        for (let i = 0; i < polyLines.length; i++) {
            pointsArray.push(`${polyLines[i].x},${polyLines[i].y}`);
        }
        const startArrow = figureModifierState.startArrow ? '1' : '0';
        const endArrow = figureModifierState.endArrow ? '1' : '0';
        figureZIndexCounter++;
        xmlBuffer.push(`<polyline lineType="${lineType}" lineWidth="${lineWidth}" l_pat="${l_pat}" round="${round}" start_arrow="${startArrow}" end_arrow="${endArrow}" arrow_type="simple" points="${pointsArray.join(' ')}" zIndex="${figureZIndexCounter}" />\r\n`);
        resetFigureModifier();
        resetFigureTransformState();
    }
}

/**
 * 図形セグメント 曲線セグメントを描画
 * @param {int} segLen
 * @param {0x0000[]} tadSeg
 * @returns
 */
function tsFigCurveDraw(segLen, tadSeg) {
    if (segLen < Number(0x000C)) { // 最小サイズ: mode(2) + l_atr(2) + l_pat(2) + f_pat(2) + type(2) + np(2) = 12バイト
        return;
    }
    
    // パラメータ解析
    const mode = getLastUBinUH(tadSeg[0]);
    const l_atr = Number(tadSeg[1]);
    const lineType = (l_atr >> 8) & 0xFF;
    const lineWidth = l_atr & 0xFF;
    const l_pat = Number(tadSeg[2]);
    const f_pat = Number(tadSeg[3]);
    const type = Number(tadSeg[4]);
    const np = Number(tadSeg[5]);

    console.debug(`Curve attributes: mode=${mode}, l_atr=${IntToHex((tadSeg[1]),4).replace('0x','')}, l_pat=${IntToHex((tadSeg[2]),4).replace('0x','')}, f_pat=${IntToHex((tadSeg[3]),4).replace('0x','')}, type=${type}, np=${np}`);
    
    // mode 0 のみ処理
    if (mode !== 0) {
        console.debug(`Unsupported curve mode: ${mode}`);
        return;
    }
    
    // 頂点数のチェック
    if (np < 2) {
        console.debug("Curve needs at least 2 points");
        return;
    }
    
    // 必要なデータサイズをチェック（各頂点は x,y で 4バイト）
    const expectedSize = 12 + np * 4;
    if (segLen < expectedSize) {
        console.debug(`Curve segment too short: expected ${expectedSize}, got ${segLen}`);
        return;
    }
    
    // 頂点データを読み取り
    const points = [];
    for (let i = 0; i < np; i++) {
        const x = Number(uh2h(tadSeg[6 + i * 2]));
        const y = Number(uh2h(tadSeg[7 + i * 2]));
        points.push({ x: x, y: y });
    }
    
    // 閉じた曲線かどうかを判定
    const isClosed = (points[0].x === points[np - 1].x && points[0].y === points[np - 1].y);
    
    console.debug(`Curve type: ${type === 0 ? 'polyline' : 'B-spline'}, ${isClosed ? 'closed' : 'open'}, points: ${np}`);
    

    if(isXmlDumpEnabled()) {
        const pointsArray = [];
        for (let i = 0; i < points.length; i++) {
            pointsArray.push(`${points[i].x},${points[i].y}`);
        }
        const startArrow = figureModifierState.startArrow ? '1' : '0';
        const endArrow = figureModifierState.endArrow ? '1' : '0';
        figureZIndexCounter++;
        xmlBuffer.push(`<curve lineType="${lineType}" lineWidth="${lineWidth}" l_pat="${l_pat}" f_pat="${f_pat}" type="${type}" closed="${isClosed ? '1' : '0'}" start_arrow="${startArrow}" end_arrow="${endArrow}" arrow_type="simple" points="${pointsArray.join(' ')}" zIndex="${figureZIndexCounter}" />\r\n`);
        resetFigureModifier();
        resetFigureTransformState();
    }
}

/**
 * 図形要素セグメントを判定
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 */
function tsFigDraw(segLen, tadSeg) {
    const UB_SubID = getTopUBinUH(tadSeg[0]);
    
    if (UB_SubID === Number(0x00)) {
        console.debug("長方形セグメント");
        tsFigRectAngleDraw(segLen, tadSeg);
    } else if (UB_SubID === Number(0x01)) {
        console.debug("角丸長方形セグメント");
        tsFigRoundRectAngleDraw(segLen, tadSeg);
    } else if (UB_SubID === Number(0x02)) {
        console.debug("楕円セグメント");
        tsFigEllipseDraw(segLen, tadSeg);
    } else if (UB_SubID === Number(0x03)) {
        console.debug("扇形セグメント");
        tsFigArcDraw(segLen, tadSeg);
    } else if (UB_SubID === Number(0x04)) {
        console.debug("弓形セグメント");
        tsFigChordDraw(segLen, tadSeg);
    } else if (UB_SubID === Number(0x05)) {
        console.debug("多角形セグメント");
        tsFigPolygonDraw(segLen, tadSeg);
    } else if (UB_SubID === Number(0x06)) {
        console.debug("直線セグメント");
        tsFigLineDraw(segLen, tadSeg);
    } else if (UB_SubID === Number(0x07)) {
        console.debug("楕円弧セグメント");
        tsFigEllipticalArcDraw(segLen, tadSeg);
    } else if (UB_SubID === Number(0x08)) {
        console.debug("折れ線セグメント");
        tsFigPolylineDraw(segLen, tadSeg);
    } else if (UB_SubID === Number(0x09)) {
        console.debug("曲線セグメント");
        tsFigCurveDraw(segLen, tadSeg);
    }
}

/**
 * 図形:パターン定義セグメントを処理
 * パターン定義セグメントは、図形のパターンを定義するためのセグメント
 * 例えば、線のパターンや塗りつぶしのパターンなどを定義する
 * @param {*} segLen 
 * @param {*} tadSeg 
 * @returns 
 */
function tsFigColorPattern(segLen, tadSeg) {
    if (segLen < Number(0x000E)) {
        return;
    }
    let i = 1;
    let pattern = new COLORPATTERN();
    pattern.id = Number(uh2h(tadSeg[i++]));
    pattern.hsize = Number(uh2h(tadSeg[i++]));
    pattern.vsize = Number(uh2h(tadSeg[i++]));
    pattern.ncol = Number(uh2h(tadSeg[i++]));

    // 全ての色を配列に格納（前景色 + 背景色）
    const allColors = [];
    
    for (let j = 0; j < pattern.ncol; j++) {
        let fgCol = new COLOR();
        fgCol = parseColor(uh2uw([tadSeg[i+1], tadSeg[i]])[0]);
        i+= 2;
        pattern.fgcolArray.push(fgCol);
        allColors.push(fgCol.color);
        console.debug(`fgCol[${j}]: ${fgCol.color}`);
    }
    
    pattern.bgcol = parseColor(uh2uw([tadSeg[i+1], tadSeg[i]])[0]);
    i += 2;
    allColors.push(pattern.bgcol.color); // 背景色も配列の最後に追加

    // マスクID配列を読み込み
    const maskIds = [];
    for (let j = 0; j < pattern.ncol; j++) {
        const mask = Number(uh2h(tadSeg[i++]));
        pattern.mask.push(mask);
        maskIds.push(mask);
    }

    // パターンデータを生成
    // 初期値は最後の色（背景色）で埋める
    pattern.patternData = Array(pattern.vsize).fill(null).map(() => 
        Array(pattern.hsize).fill(pattern.bgcol.color)
    );
    
    for (let i = 0; i < pattern.ncol; i++) {
        const maskId = maskIds[i];
        const color = allColors[i];
        const maskData = maskDefinitions.get(maskId);
        
        console.debug(`Processing pattern ${pattern.id}, layer ${i}: maskId=${maskId}, color=${color}`);
        
        if (!maskData) {
            console.debug(`  Mask ${maskId} not found`);
            continue;
        }
        
        let pixelsSet = 0;
        for (let y = 0; y < pattern.vsize; y++) {
            for (let x = 0; x < pattern.hsize; x++) {
                const maskX = x % maskData.hsize;
                const maskY = y % maskData.vsize;
                const maskValue = maskData.getMaskValue(maskX, maskY);
                
                if (color === null || color === undefined || color === -1) {
                    // 透明色の場合：マスクが0の場所に描
                    if (maskValue !== 0) {
                        continue;
                    }
                } else {
                    // 通常色の場合：マスクが1の場所に描画
                    if (maskValue === 0) {
                        continue;
                    }
                }
                
                pattern.patternData[y][x] = color;
                pixelsSet++;
            }
        }
        console.debug(`  Set ${pixelsSet} pixels with color ${color}`);
    }
    
    // デバッグ: パターン全体のピクセル数をチェック
    if (pattern.id >= 6 && pattern.id <= 10) {
        let totalPixelsSet = 0;
        let backgroundPixels = 0;
        let foregroundPixels = 0;
        for (let dy = 0; dy < pattern.vsize; dy++) {
            for (let dx = 0; dx < pattern.hsize; dx++) {
                if (pattern.patternData[dy][dx] === pattern.bgcol.color) {
                    backgroundPixels++;
                } else {
                    foregroundPixels++;
                    totalPixelsSet++;
                }
            }
        }
        console.debug(`  Pattern ${pattern.id}: totalPixelsSet=${totalPixelsSet}/${pattern.hsize * pattern.vsize}, bg=${backgroundPixels}, fg=${foregroundPixels}`);
    }

    colorPattern[pattern.id] = pattern;
}

/**
 * カラーマップ定義セグメントを処理
 * @param {*} segLen 
 * @param {*} tadSeg 
 * @returns 
 */
function tsColorMapDefine(segLen, tadSeg) {
    if (segLen < Number(0x0008)) {
        return;
    }
    const nent = Number(uh2h(tadSeg[1]));
    let nentNo = 2;
    for (let i = 0; i < nent; i++) {
        let color = new COLOR();
        color = parseColor(uh2uw([tadSeg[nentNo + 1], tadSeg[nentNo]])[0]);
        nentNo += 2;
        colorMap[i] = color;
    }
}

/**
 * 線種定義セグメントを処理 (0xffb1, SubID: 0x03)
 * @param {number} segLen - セグメント長
 * @param {Array} tadSeg - セグメントデータ
 */
function tsFigLinePatternDefinition(segLen, tadSeg) {
    // 最小サイズチェック (SubID(2) + 線種番号(2) + パターン数(2) = 6バイト)
    if (segLen < 6) {
        console.debug("線種定義セグメントが短すぎます");
        return;
    }
    
    // 線種番号を取得 (tadSeg[1])
    const lineTypeNumber = Number(tadSeg[1]);
    
    // パターン数を取得 (tadSeg[2])
    const patternCount = Number(tadSeg[2]);
    
    console.debug(`線種定義: 線種番号=${lineTypeNumber}, パターン数=${patternCount}`);
    
    // パターンデータが十分にあるかチェック
    if (segLen < 6 + patternCount * 2) {
        console.debug("線種定義セグメントのパターンデータが不足しています");
        return;
    }
    
    // パターンデータを読み取る
    const pattern = [];
    for (let i = 0; i < patternCount; i++) {
        // 各パターン値は2バイト (tadSeg[3 + i])
        const patternValue = Number(tadSeg[3 + i]);
        pattern.push(patternValue);
    }
    
    // 線種定義を更新
    linePatternDefinitions[lineTypeNumber] = pattern;
    
    console.debug(`線種${lineTypeNumber}のパターンを定義: [${pattern.join(', ')}]`);
}

/**
 * マスクデータ定義セグメントを処理 (0xffb1, SubID: 0x01)
 * @param {number} segLen - セグメント長
 * @param {Array} tadSeg - セグメントデータ
 */
function tsMaskDataDefinition(segLen, tadSeg) {
    // 最小サイズチェック (type(2) + id(2) + hsize(2) + vsize(2) = 8バイト)
    if (segLen < 8) {
        console.debug("マスクデータ定義セグメントが短すぎます");
        return;
    }
    
    let i = 0;
    // パラメータを取得
    const type = getLastUBinUH(tadSeg[i++]);
    const id = Number(tadSeg[i++]);
    const hsize = Number(tadSeg[i++]);
    const vsize = Number(tadSeg[i++]);

    console.debug(`Mask definition: type=${type}, id=${id}, hsize=${hsize}, vsize=${vsize}`);
    
    // type 0 (ビットマップ形式) のみ処理
    if (type !== 0) {
        console.debug(`Unsupported mask type: ${type}`);
        return;
    }
    
    // サイズの検証
    if (hsize <= 0 || vsize <= 0) {
        console.debug(`Invalid mask size: ${hsize}x${vsize}`);
        return;
    }
    
    if (id < 0) {
        console.debug(`Invalid mask ID: ${id}`);
        return;
    }
    
    const wordsPerRow = Math.floor((hsize + 15) / 16); // 1行当たりの16bitワード数
    const expectedWords = wordsPerRow * vsize;
    const availableWords = Math.floor((segLen - 4) / 2);
    
    console.debug(`Mask ${id}: ${hsize}x${vsize}, wordsPerRow=${wordsPerRow}, expectedWords=${expectedWords}, availableWords=${availableWords}`);
    
    // バイト配列として初期化
    const bytesPerRow = Math.ceil(hsize / 8);
    const maskBits = new Array(bytesPerRow * vsize).fill(0);
    
    let wordIndex = 0;
    for (let y = 0; y < vsize; y++) {
        for (let wordInRow = 0; wordInRow < wordsPerRow; wordInRow++) {
            const tadIndex = 4 + wordIndex;
            if (tadIndex >= segLen) {
                console.debug(`Warning: Not enough mask data at tadIndex ${tadIndex} for row ${y}`);
                return; // データ不足の場合は処理を中断
            }
            
            // tadSegから直接16bit値を取得（既にUH形式）
            const word16 = Number(tadSeg[tadIndex]) & 0xFFFF;

            // 16bitワードから各ビットを抽出してバイト配列に格納
            for (let bit = 0; bit < 16; bit++) {
                const x = wordInRow * 16 + bit;
                if (x >= hsize) break; // 行の終端を超えない
                
                const byteIndex = y * bytesPerRow + Math.floor(x / 8);
                const bitIndex = 7 - (x % 8); // MSBから
                const bitValue = (word16 >> (15 - bit)) & 1;
                
                if (bitValue) {
                    maskBits[byteIndex] |= (1 << bitIndex);
                }
            }
            wordIndex++;
        }
    }
    
    // マスクデータを作成・登録
    const maskData = new MaskData(id, hsize, vsize, maskBits);
    maskDefinitions.set(id, maskData);

    
    // マスクデータをビット表現で出力（行単位で正しく処理）
    let bitString = 'Mask data (bits):\n';
    for (let y = 0; y < vsize; y++) {
        let rowBits = '';
        for (let x = 0; x < hsize; x++) {
            // 行単位でのバイト位置とビット位置を計算
            const byteIndex = y * bytesPerRow + Math.floor(x / 8);
            const bitIndex = 7 - (x % 8); // MSBから開始
            const bit = (maskBits[byteIndex] >> bitIndex) & 1;
            rowBits += bit.toString();
        }
        bitString += `  Row ${y.toString().padStart(2, '0')}: ${rowBits}\n`;
    }
    console.debug(bitString);
}




/**
 * データ定義セグメントを判定
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 */
function tsDataSet(segLen, tadSeg) {
    const UB_SubID = getTopUBinUH(tadSeg[0]);
    
    if (UB_SubID === Number(0x00)) {
        console.debug("カラーマップ定義セグメント");
        tsColorMapDefine(segLen, tadSeg);
    } else if (UB_SubID === Number(0x01)) {
        console.debug("マスクデータ定義セグメント");
        tsMaskDataDefinition(segLen, tadSeg);
    } else if (UB_SubID === Number(0x02)) {
        console.debug("パターン定義セグメント");
        tsFigColorPattern(segLen, tadSeg);
    } else if (UB_SubID === Number(0x03)) {
        console.debug("線種定義セグメント");
        tsFigLinePatternDefinition(segLen, tadSeg);
    } else if (UB_SubID === Number(0x04)) {
        console.debug("マーカー定義セグメント");
    }
}

/**
 * グループ開始セグメント
 * @param {*} segLen 
 * @param {*} tadSeg 
 * @returns 
 */
function tsGroupSet(segLen, tadSeg) {
    const UB_SubID = getTopUBinUH(tadSeg[0]);

    if (UB_SubID === Number(0x00)) {
        console.debug("グループ開始セグメント");
        let group = new GROUP();
        group.id = Number(uh2h(tadSeg[1]));

        groupList.push(group);

        if(isXmlDumpEnabled()) {
            if (group.id === 0) {
                xmlBuffer.push(`<group>\r\n`);
            } else {
                xmlBuffer.push(`<group id="${group.id}">\r\n`);
            }
        }
    } else if (UB_SubID === Number(0x01)) {
        console.debug("グループ終了セグメント");

        if(isXmlDumpEnabled()) {
            xmlBuffer.push(`</group>\r\n`);
        }
    }
}

/**
 * 図形用紙指定付箋
 */
function tsFigurePageSetFusen(segLen, tadSeg) {
    if (segLen < Number(0x0007)) {
        return;
    }
    // 文章TADの場合は無視される
    if (!startByImageSegment) {
        return;
    }

    // PaperSizeクラスのインスタンスを作成（まだ存在しない場合）
    if (paperSize === null) {
        paperSize = new PaperSize();
    }    

    const ATTR = getLastUBinUH(tadSeg[0]);

    // 綴じ方向と面付け指定をビットマスクで解析
    // bit0: P (面付け指定) 0:1面付け, 1:2面付け
    // bit1: D (綴じ方向) 0:左綴じ, 1:右綴じ
    paperSize.imposition = (ATTR & 0x01) ? 1 : 0;  // bit0: P
    paperSize.binding = (ATTR & 0x02) ? 1 : 0;     // bit1: D

    // 用紙サイズを設定
    paperSize.length = Number(tadSeg[1]);
    paperSize.width = Number(tadSeg[2]);
    
    // オーバーレイ領域までのマージンを設定（論理値として保存）
    paperSize.top = Number(tadSeg[3]);
    paperSize.bottom = Number(uh2h(tadSeg[4]));
    
    // 論理的なleft（ノド）とright（小口）の値をそのまま保存
    paperSize.left = Number(uh2h(tadSeg[5]));   // ノド（綴じ側）
    paperSize.right = Number(uh2h(tadSeg[6]));  // 小口（開き側）

    // XMLダンプ機能が有効な場合
    if (isXmlDumpEnabled()) {
        xmlBuffer.push(`<paper imposition="${paperSize.imposition}" binding="${paperSize.binding}" length="${paperSize.length}" width="${paperSize.width}" top="${paperSize.top}" bottom="${paperSize.bottom}" left="${paperSize.left}" right="${paperSize.right}" />\r\n`);
    }
}

/**
 * 図形マージン指定付箋
 */
function tsFigureMarginSetFusen(segLen, tadSeg) {
    if (segLen < Number(0x0005)) {
        return;
    }
    // 文章TADの場合は無視される
    if (!startByImageSegment) {
        return;
    }

    // PaperSizeクラスのインスタンスを作成（まだ存在しない場合）
    if (paperSize === null) {
        return;
    }

    if (paperMargin === null) {
        paperMargin = new PaperMargin();
    }

    // マージンを設定（物理値として保存）
    paperMargin.top = Number(tadSeg[1]);
    paperMargin.bottom = Number(tadSeg[2]);
    paperMargin.left = Number(tadSeg[3]);
    paperMargin.right = Number(tadSeg[4]);

    
    // XMLダンプ機能が有効な場合
    if (isXmlDumpEnabled()) {
        xmlBuffer.push(`<paper margintop="${paperMargin.top}" marginbottom="${paperMargin.bottom}" marginleft="${paperMargin.left}" marginright="${paperMargin.right}" />\r\n`);
    }

}

/**
 * 図形ページ割り付け指定付箋
 * @param {*} segLen 
 * @param {*} tadSeg 
 * @returns 
 */
function tsFigurePageFusen(segLen, tadSeg) {
    const UB_SubID = getTopUBinUH(tadSeg[0]);

    if (UB_SubID === Number(0x00)) {
        console.debug("図形用紙指定付箋");
        tsFigurePageSetFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x01)) {
        console.debug("図形マージン指定付箋");
        tsFigureMarginSetFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x02)) {
        console.debug("未定義");
    } else if (UB_SubID === Number(0x03)) {
        console.debug("用紙オーバーレイ定義付箋");
        tsFigureSizeOfPaperOverlayDefineFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x04)) {
        console.debug("用紙オーバレイ指定付箋");
        tsFigureSizeOfPaperOverlaySetFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x05)) {
        console.debug("未定義");
    } else if (UB_SubID === Number(0x06)) {
        console.debug("ページ番号指定付箋");
    }
}


/**
 * 文章メモ指定付箋を処理
 * @param {number} segLen セグメント長
 * @param {Array} tadSeg セグメントデータ
 */
function tsDocumentMemo(segLen, tadSeg) {
    if (segLen < 1) {
        console.debug("文章メモ指定付箋: セグメント長が不正");
        return;
    }

    // tadSeg[1]以降はTRONコード列
    // segLenから読む範囲を決定（セグメント長 - ヘッダー部分）
    const memoDataLength = segLen - 1;
    let memoText = '';

    // TRONコード列をテキストに変換
    for (let i = 1; i <= memoDataLength && i < tadSeg.length; i++) {
        const tronChar = charTronCode(tadSeg[i]);
        if (tronChar) {
            memoText += tronChar;
        }
    }

    // XMLダンプ機能が有効な場合、文章メモタグを出力
    if (isXmlDumpEnabled()) {
        xmlBuffer.push(`<docmemo text="${memoText}" />\r\n`);
    }
}


/**
 * 図形メモ指定付箋を処理
 * @param {number} segLen セグメント長
 * @param {Array} tadSeg セグメントデータ
 */
function tsFigureMemo(segLen, tadSeg) {
    if (segLen < 1) {
        console.debug("図形メモ指定付箋: セグメント長が不正");
        return;
    }

    // tadSeg[1]以降はTRONコード列
    // segLenから読む範囲を決定（セグメント長 - ヘッダー部分）
    const memoDataLength = segLen - 1;
    let memoText = '';

    // TRONコード列をテキストに変換
    for (let i = 1; i <= memoDataLength && i < tadSeg.length; i++) {
        const tronChar = charTronCode(tadSeg[i]);
        if (tronChar) {
            memoText += tronChar;
        }
    }


    // XMLダンプ機能が有効な場合、図形メモタグを出力
    if (isXmlDumpEnabled()) {
        xmlBuffer.push(`<figmemo text="${memoText}" />\r\n`);
    }
}

/**
 * 図形要素修飾セグメントを処理
 * @param {number} segLen セグメント長
 * @param {Array} tadSeg セグメントデータ
 */
function tsFigureArrowsModifier(segLen, tadSeg) {
    const arrow = tadSeg[1]; // UHのビット列

    // ビット解析: xxxxxxxxxxxxxxES
    // S: 開始点に矢印（ビット0）
    // E: 終了点に矢印（ビット1）
    const startArrow = (arrow & 0x01) !== 0;  // ビット0
    const endArrow = (arrow & 0x02) !== 0;    // ビット1

    // 図形修飾状態を設定
    figureModifierState.hasArrow = startArrow || endArrow;
    figureModifierState.startArrow = startArrow;
    figureModifierState.endArrow = endArrow;

    console.debug(`図形要素修飾セグメント: arrow=0x${arrow.toString(16)}, startArrow=${startArrow}, endArrow=${endArrow}`);

    // XMLダンプ機能が有効な場合、図形修飾タグを出力
    // if (isXmlDumpEnabled()) {
    //     xmlBuffer.push(`<figmodifier arrow="0x${arrow.toString(16)}" start="${startArrow}" end="${endArrow}" />\r\n`);
    // }
}

/**
 * 図形修飾状態をリセット
 */
function resetFigureModifier() {
    figureModifierState.hasArrow = false;
    figureModifierState.startArrow = false;
    figureModifierState.endArrow = false;
}

/**
 * 座標変換セグメントを処理
 * 直後のセグメントを変形する
 *
 * 【データ定義】
 * tadSeg[1] = dh（水平方向移動量）
 * tadSeg[2] = dv（垂直方向移動量）
 * tadSeg[3] = hangle（回転角度、≧0、反時計回り）※省略可
 * tadSeg[4] = vangle（傾斜角度、-90 < vangle < +90）※省略可
 *
 * 【変形順序】
 * 1. vangle による傾斜処理
 * 2. hangle による回転処理
 * 3. dh, dv による移動処理
 *
 * @param {number} segLen セグメント長（0x0006: dh,dvのみ、0x000A: 全パラメータ）
 * @param {Array} tadSeg セグメントデータ
 */
function tsFigureTransformation(segLen, tadSeg) {
    // セグメント長チェック: 0x0006（dh,dvのみ）または 0x000A（全パラメータ）
    if (segLen !== Number(0x0006) && segLen !== Number(0x0008) && segLen !== Number(0x000A)) {
        console.debug("座標変換セグメント: セグメント長が不正 segLen=0x" + segLen.toString(16));
        return;
    }

    // 移動量を取得（符号付き16ビット整数として解釈）
    const dh = toSignedInt16(tadSeg[1]);
    const dv = toSignedInt16(tadSeg[2]);

    // 回転角度（省略時は0）
    let hangle = 0;
    if (segLen >= Number(0x0008) && tadSeg[3] !== undefined) {
        hangle = toSignedInt16(tadSeg[3]);
    }

    // 傾斜角度（省略時は0）
    let vangle = 0;
    if (segLen >= Number(0x000A) && tadSeg[4] !== undefined) {
        vangle = toSignedInt16(tadSeg[4]);
        // 傾斜角度の範囲チェック: -90 < vangle < +90
        if (vangle <= -90 || vangle >= 90) {
            console.debug("座標変換セグメント: 傾斜角度が範囲外 vangle=" + vangle);
            vangle = Math.max(-89, Math.min(89, vangle)); // 範囲内に丸める
        }
    }

    // 変換状態を設定（直後のセグメントで使用）
    figureTransformState.active = true;
    figureTransformState.dh = dh;
    figureTransformState.dv = dv;
    figureTransformState.hangle = hangle;
    figureTransformState.vangle = vangle;

    // XML出力
    if (isXmlDumpEnabled()) {
        xmlBuffer.push(`<transform dh="${dh}" dv="${dv}" hangle="${hangle}" vangle="${vangle}" />\r\n`);
    }

    console.debug(`座標変換セグメント: dh=${dh}, dv=${dv}, hangle=${hangle}, vangle=${vangle}`);
}

/**
 * 座標変換状態をリセット
 */
function resetFigureTransformState() {
    figureTransformState.active = false;
    figureTransformState.dh = 0;
    figureTransformState.dv = 0;
    figureTransformState.hangle = 0;
    figureTransformState.vangle = 0;
}

/**
 * 座標に変換を適用
 * 変形順序: 傾斜(vangle) → 回転(hangle) → 移動(dh,dv)
 *
 * @param {number} x 元のX座標
 * @param {number} y 元のY座標
 * @returns {{x: number, y: number}} 変換後の座標
 */
function applyFigureTransform(x, y) {
    if (!figureTransformState.active) {
        return { x, y };
    }

    let newX = x;
    let newY = y;

    // 1. 傾斜処理（vangle）
    // 水平方向の直線は変化しないが、垂直方向の直線は傾く
    // 正のvangleで右下がりになる
    if (figureTransformState.vangle !== 0) {
        const vangleRad = figureTransformState.vangle * Math.PI / 180;
        const shear = Math.tan(vangleRad);
        newX = newX + newY * shear;
        // newY は変化しない
    }

    // 2. 回転処理（hangle）
    // 原点(0,0)を中心に反時計回りに回転
    if (figureTransformState.hangle !== 0) {
        const hangleRad = figureTransformState.hangle * Math.PI / 180;
        const cos = Math.cos(hangleRad);
        const sin = Math.sin(hangleRad);
        const rotatedX = newX * cos - newY * sin;
        const rotatedY = newX * sin + newY * cos;
        newX = rotatedX;
        newY = rotatedY;
    }

    // 3. 移動処理（dh, dv）
    newX += figureTransformState.dh;
    newY += figureTransformState.dv;

    return { x: Math.round(newX), y: Math.round(newY) };
}

/**
 * 座標配列に変換を適用
 * @param {Array} points [[x1,y1], [x2,y2], ...] 形式の座標配列
 * @returns {Array} 変換後の座標配列
 */
function applyFigureTransformToPoints(points) {
    if (!figureTransformState.active) {
        return points;
    }
    return points.map(point => {
        const transformed = applyFigureTransform(point[0], point[1]);
        return [transformed.x, transformed.y];
    });
}

/**
 * 図形修飾セグメントを処理
 * @param {number} segLen セグメント長
 * @param {Array} tadSeg セグメントデータ
 */
function tsFigureModifier(segLen, tadSeg) {
    if (segLen < 1) {
        console.debug("図形修飾セグメント: セグメント長が不正");
        return;
    }

    const UB_SubID = getTopUBinUH(tadSeg[0]);
    
    if (UB_SubID === Number(0x00)) {
        console.debug("図形要素修飾セグメント");
        tsFigureArrowsModifier(segLen, tadSeg);
    } else if (UB_SubID === Number(0x01)) {
        console.debug("座標変換セグメント");
        tsFigureTransformation(segLen, tadSeg);
    }
}

/**
 * TAD描画に関する変数を初期化（デフォルト値に設定）
 * @param {number} x - 開始X座標（オプション）
 * @param {number} y - 開始Y座標（オプション）
 */
function initTAD(x = 0, y = 0) {
    // 描画位置を初期化

    // フォント関係を初期化（デフォルト値に設定）
    textFontSize = defaultFontSize;
    textFontStyle = 'normal';
    textFontWeight = defaultFontWeight;
    textFontStretch = 'normal';
    textFontColor = '#000000';

    currentSegmentType = SEGMENT_TYPE.NONE;
    segmentStack = [];

    colorPattern = [];

    // 図形修飾・変換状態をリセット
    resetFigureModifier();
    resetFigureTransformState();

    // デフォルトマスクを初期化
    initializeDefaultMasks();
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

    let openVirtualObj = false;

    let vobj = new VOBJSEG();
    vobj.left = Number(uh2h(tadSeg[0]));
    vobj.top = Number(uh2h(tadSeg[1]));
    vobj.right = Number(uh2h(tadSeg[2]));
    vobj.bottom = Number(uh2h(tadSeg[3]));
    vobj.height = Number(uh2h(tadSeg[4]));
    vobj.chsz = Number(uh2h(tadSeg[5]));
    vobj.frcol = parseColor(uh2uw([tadSeg[7], tadSeg[6]])[0]);
    vobj.chcol = parseColor(uh2uw([tadSeg[9], tadSeg[8]])[0]);
    vobj.tbcol = parseColor(uh2uw([tadSeg[11], tadSeg[10]])[0]);
    vobj.bgcol = parseColor(uh2uw([tadSeg[13], tadSeg[12]])[0]);
    vobj.dlen = Number(uh2h(tadSeg[14]));

    let linkRecordData = [];
    for(let offsetLen=15;offsetLen<tadSeg.length;offsetLen++) {
        linkRecordData.push(tadSeg[offsetLen]);
    }


    let newLink = new LINK();

    if (isProcessingBpk) {
        // セカンダリウィンドウの場合、originalLinkIdを使ってグローバルlinkRecordListから取得
        if (window.originalLinkId !== undefined && window.originalLinkId !== null) {
            const globalLinkRecordList = window.linkRecordList || linkRecordList;
            
            // 元のファイルのlinkRecordListから取得
            const targetFileIndex = window.originalLinkId - 1; // link_idは1-indexed
            if (globalLinkRecordList && globalLinkRecordList[targetFileIndex] && globalLinkRecordList[targetFileIndex][linkNo]) {
                newLink = globalLinkRecordList[targetFileIndex][linkNo];
            } else {
                newLink = new LINK();
            }
        } else {
            // メインウィンドウの場合
            if (linkRecordList[currentFileIndex] && linkRecordList[currentFileIndex][linkNo]) {
                newLink = linkRecordList[currentFileIndex][linkNo];
            } else {
                newLink = new LINK();
            }
        }
        
        newLink.left = vobj.left;
        newLink.top = vobj.top;
        newLink.right = vobj.right;
        newLink.bottom = vobj.bottom;
        newLink.dlen = vobj.dlen;
    }

    // lHeadからlink_nameを取得とリンク先のrawデータを設定
    if (lHead && lHead[newLink.link_id - 1]) {
        const lhead = lHead[newLink.link_id - 1];
        newLink.link_name = lhead.name;
        // リンク先のTADファイルのrawデータをtadRecordDataArrayから取得
        const linkedRecord = tadRecordDataArray.find(record => record.fileIndex === newLink.link_id - 1);
        if (linkedRecord && linkedRecord.data) {
            newLink.raw = linkedRecord.data;
        }
    }

    if (openVirtualObj) {
        // リンク先のドキュメントを仮身枠内に描画
        // 内枠の内側に描画（上下左右に5ピクセルのマージン）
        //renderLinkedDocumentInVirtualObj();
    }

    // XMLのリンク情報を保存
    if(isXmlDumpEnabled) {
        // newLink.link_idは1-indexed、realIdMapは0-indexedなので-1する
        const linkedFileIndex = newLink.link_id - 1;
        const realId = realIdMap.get(linkedFileIndex) || newLink.link_id;

        console.log(`[tsVirtualObjSegment] link_id=${newLink.link_id}, linkedFileIndex=${linkedFileIndex}, realId=${realId}`);

        // 仮身には文字修飾を付けないため、アクティブな文字修飾を一時的に閉じる
        const activeDecorations = getActiveDecorations();
        for (let i = activeDecorations.length - 1; i >= 0; i--) {
            xmlBuffer.push(`</${activeDecorations[i]}>`);
        }

        // 図形セグメント内のz-index管理
        // XMLのリンク情報を保存（自己閉じタグ形式）
        // link_nameはJSONから取得する方式に統一
        figureZIndexCounter++;
        xmlBuffer.push(`<link id="${realId}_0.xtad" vobjleft="${vobj.left}" vobjtop="${vobj.top}" vobjright="${vobj.right}" vobjbottom="${vobj.bottom}" vobjheight="${vobj.height}" chsz="${vobj.chsz}" frcol="${vobj.frcol.color}" chcol="${vobj.chcol.color}" tbcol="${vobj.tbcol.color}" bgcol="${vobj.bgcol.color}" dlen="${vobj.dlen}" zIndex="${figureZIndexCounter}"/>\r\n`);

        // 文字修飾を再度開く
        for (const deco of activeDecorations) {
            xmlBuffer.push(`<${deco}>`);
        }
    }


    // linkRecordList[currentFileIndex]が存在しない場合は初期化
    if (!linkRecordList[currentFileIndex]) {
        console.debug(`Initializing linkRecordList[${currentFileIndex}] as empty array`);
        linkRecordList[currentFileIndex] = [];
    }
    
    linkRecordList[currentFileIndex][linkNo] = newLink;
    linkNo++;
}

/**
 * 表計算形式のデータセット
 * @param {int} segLen
 * @param {0x0000[]} tadSeg
 */
function tsSpecitySegmentCalc(dataSeg) {

    if (isXmlDumpEnabled()) {
        // セル位置 (列番号をA,B,C...形式に変換)
        const row = Number(uh2h(dataSeg[1]));  // 1始まり
        const col = Number(uh2h(dataSeg[2]));  // 1始まり
        // 列番号を英字に変換 (1=A, 2=B, ... 26=Z, 27=AA, ...)
        let colLetter = '';
        let c = col - 1;  // 0始まりに変換
        do {
            colLetter = String.fromCharCode(65 + (c % 26)) + colLetter;
            c = Math.floor(c / 26) - 1;
        } while (c >= 0);
        const cellRef = colLetter + row;  // rowはそのまま使用
        xmlBuffer.push(`<calcPos cell="${cellRef}"/>`);
        console.debug(`calcPos cell=${cellRef} (col=${col} row=${row})`);

        // dataSeg[4], dataSeg[5]から各バイトを取得（直接ビット演算で抽出）
        // dataSeg[4]: 下位バイト=文字サイズ, 上位バイト=文字修飾
        const fontSizeCode = dataSeg[4] & 0xFF;  // 下位バイト
        const deco = (dataSeg[4] >> 8) & 0xFF;   // 上位バイト
        // dataSeg[5]: 下位バイト=罫線, 上位バイト=文字色
        const border = dataSeg[5] & 0xFF;         // 下位バイト
        const colorCode = (dataSeg[5] >> 8) & 0xFF;             // 上位バイト

        // デバッグ: 生データをダンプ
        console.log(`[tsSpecitySegmentCalc] cell=${cellRef} dataSeg[4]=0x${dataSeg[4].toString(16).padStart(4,'0')} dataSeg[5]=0x${dataSeg[5].toString(16).padStart(4,'0')}`);
        console.log(`  fontSizeCode=0x${fontSizeCode.toString(16)} deco=0x${deco.toString(16)} border=0x${border.toString(16)} colorCode=0x${colorCode.toString(16)}`);

        // 文字サイズ: 0=無指定(12), 1=1/2倍(6), 2=3/4倍(9), 3=1倍(12), 4=2倍(24), 5=3倍(36), 6=4倍(48)
        // デフォルト(12)以外の場合のみ出力
        if (fontSizeCode !== 0 && fontSizeCode !== 3) {
            const fontSizeMap = {1:6, 2:9, 4:24, 5:36, 6:48};
            const fontSize = fontSizeMap[fontSizeCode];
            if (fontSize) {
                xmlBuffer.push(`<font size="${fontSize}"/>`);
            }
        }

        // 文字修飾: 1=太字, 2=斜体, 4=下線, 0x20=網掛け, 0x40=反転
        // 開始/終了タグ形式で出力（セル終了時に終了タグを出力）
        calcActiveDecorations = []; // セル開始時にリセット
        if (deco !== 0) {
            if (deco & 1) { xmlBuffer.push('<bold>'); calcActiveDecorations.push('bold'); }
            if (deco & 2) { xmlBuffer.push('<italic>'); calcActiveDecorations.push('italic'); }
            if (deco & 4) { xmlBuffer.push('<underline>'); calcActiveDecorations.push('underline'); }
            if (deco & 0x20) { xmlBuffer.push('<mesh>'); calcActiveDecorations.push('mesh'); }
            if (deco & 0x40) { xmlBuffer.push('<invert>'); calcActiveDecorations.push('invert'); }
        }

        // 罫線: 下位4ビット=縦線(左), 上位4ビット=横線(上), 0=なし, 1=細線, 2=太線, 3=点線
        if (border !== 0) {
            const vLine = border & 0x0F;  // 下位4ビット
            const hLine = (border >> 4) & 0x0F;  // 上位4ビット
            const lineTypeMap = {1:'line', 2:'double', 3:'dot'};
            let calcCellAttrs = [];
            if (vLine > 0) {
                calcCellAttrs.push(`borderLeft="1" borderLeftType="${lineTypeMap[vLine] || 'line'}"`);
            }
            if (hLine > 0) {
                calcCellAttrs.push(`borderTop="1" borderTopType="${lineTypeMap[hLine] || 'line'}"`);
            }
            if (calcCellAttrs.length > 0) {
                xmlBuffer.push(`<calcCell ${calcCellAttrs.join(' ')}/>`);
            }
        }

        // 文字色: 0=白, 1=黒, 2=赤, 3=黄緑, 4=青, 5=黄, 6=ピンク, 7=水色
        // デフォルト(黒=#000000)以外の場合のみ出力
        if (colorCode !== 1) {
            const colorMap = {
                0:'#ffffff', 2:'#ff0000', 3:'#00ff00',
                4:'#0000ff', 5:'#ffff00', 6:'#ff00ff', 7:'#00ffff'
            };
            const color = colorMap[colorCode];
            if (color) {
                xmlBuffer.push(`<font color="${color}"/>`);
            }
        }
    }
}

/**
 * 指定付箋セグメントを処理
 * @param {*} segLen 
 * @param {*} tadSeg 
 * @param {int} nowPos
 */
function tsSpecitySegment(segLen, tadSeg, nowPos) {
    let offsetLen;

    if (segLen < Number(0x0042)) {
        return;
    }

    console.debug(`tsSpecity: left=${Number(uh2h(tadSeg[0]))}, top=${Number(uh2h(tadSeg[1]))}, right=${Number(uh2h(tadSeg[2]))}, bottom=${Number(uh2h(tadSeg[3]))}, chsz=${IntToHex((tadSeg[4]),4).replace('0x','')}, pict=${Number(uh2h(tadSeg[11]))}`);

    console.debug(`segLen ${Number(segLen)}, nowPos ${Number(nowPos)}`); // 0x26(0d38)は仮身セグメントの開始位置

    const appl = IntToHex((tadSeg[12]),4).replace('0x','')
        + IntToHex((tadSeg[13]),4).replace('0x','')
        + IntToHex((tadSeg[14]),4).replace('0x','');

    let fileTadName = [];

    for (offsetLen=15;offsetLen<31;offsetLen++) {
        fileTadName.push(charTronCode(tadSeg[offsetLen]));
    }
    console.debug("fileTadName " + fileTadName.join(''));

    const dlen = uh2uw([tadSeg[32], tadSeg[31]]);
    console.debug("dlen   " + dlen[0]);
    
    if (calcAppId1 == tadSeg[12] && calcAppId2 == tadSeg[13] && calcAppId3 == tadSeg[14]) {
        console.debug("基本表計算形式の アプリケーションID");
        console.debug("appl   " + appl);
        console.debug("dlen   " + dlen[0]);

        // 基本表計算形式TADフラグを設定
        isCalcTad = true;

        let dataSeg = [];
        for(dataLen=0;dataLen<dlen[0];dataLen++) {
            dataSeg.push(tadSeg[dataLen + 33]);
        }

        tsSpecitySegmentCalc(dataSeg);


        return;
    }
    
    else if (packAppId1 != tadSeg[12] || packAppId2 != tadSeg[13] || packAppId3 != tadSeg[14]) {
        console.debug("書庫形式ではない アプリケーションID");
        console.debug("appl   " + appl);
        return;
    }
    console.debug("書庫形式");


    // グローバルヘッダの読込 330
    let compSeg = [];
    for(offsetLen=33;offsetLen<48;offsetLen++) {
        compSeg.push(tadSeg[offsetLen]);
    }
    gHead.headType = IntToHex((getTopUBinUH(compSeg[0])),2).replace('0x','');

    gHead.checkSum = IntToHex((getLastUBinUH(compSeg[0])),2).replace('0x','');
    gHead.version = IntToHex((compSeg[1]),4).replace('0x','');
    gHead.crc = IntToHex((compSeg[2]),4).replace('0x','');
    gHead.nfiles = Number(compSeg[3]);
    gHead.compMethod = Number(compSeg[4]); // 圧縮方式
    gHead.fileSize = Number(uh2uw([compSeg[8], compSeg[7]])[0]); // 書庫付箋のサイズ
    gHead.origSize = Number(uh2uw([compSeg[10], compSeg[9]])[0]); // 圧縮部の非圧縮サイズ
    gHead.compSize = Number(uh2uw([compSeg[12], compSeg[11]])[0]); // 圧縮部の圧縮サイズ
    gHead.extSize = Number(uh2uw([compSeg[14], compSeg[13]])[0]); // 拡張部のサイズ
    console.debug(`gHead: headtype=${gHead.headType}, checkSum=${gHead.checkSum}, version=${gHead.version}, crc=${gHead.crc}, nfiles=${gHead.nfiles}, compmethod=${gHead.compMethod}`);

    compMethod = Number(gHead.compMethod);
    if ((compMethod != LH5) && (compMethod != LH0)) {
        console.debug("Error file");
        return;
    }
    let time = uh2uw([compSeg[6], compSeg[5]]);
    console.debug(`Archive: time=${time[0]}, filesize=${gHead.fileSize}, orgsize=${gHead.origSize}, compsize=${gHead.compSize}, extsize=${gHead.extSize}`);

    /* crc テーブルを作成する */
    make_crctable();

    const startPos = nowPos + 66 + 30 + 8; // nowPos38 + Number(0x42) + 30;
    tadPos = startPos;

    crc = INIT_CRC;
    const DICBIT = 13;
    const DICSIZ = (1 << DICBIT);
    
    // Initialize LH5 decoder if needed
    if (compMethod == LH5) {
        decode_buf = new Uint8Array(DICSIZ);
        
        lh5Decoder = new LH5Decoder();

        // Set up global decode state accessors
        setGlobalDecodeAccessors(
            () => globalDecodeJ,              // getGlobalDecodeJ
            (value) => { globalDecodeJ = value; }, // setGlobalDecodeJ
            () => globalDecodeI,              // getGlobalDecodeI
            (value) => { globalDecodeI = value; }, // setGlobalDecodeI
            () => globalStaticN               // getGlobalStaticN
        );
        
        // LH5Decoderを直接初期化（tadRawDataArrayに依存しない）
        console.debug('Initializing LH5Decoder directly in tsSpecitySegment');
        console.debug('tadPos:', tadPos, 'gHead.compSize:', gHead.compSize, 'gHead.origSize:', gHead.origSize);
        
        try {
            // tadRawArrayで渡されたrawデータを使用してLH5Decoderを初期化
            if (typeof window !== 'undefined' && window.currentRawData) {
                console.debug('currentRawData length:', window.currentRawData.length);
                // tadPosは0ベースで、startPos(142)から開始
                lh5Decoder.init(window.currentRawData, tadPos, gHead.compSize, gHead.origSize);
                lh5Decoder.initialized = true; // 重要：初期化フラグを設定
                
                // 初期化後の状態確認
                console.debug('LH5Decoder initialized successfully with currentRawData');
                console.debug('LH5Decoder state: fileData=', !!lh5Decoder.fileData, 'filePos=', lh5Decoder.filePos,
                             'compsize=', lh5Decoder.compsize, 'origsize=', lh5Decoder.origsize, 'initialized=', lh5Decoder.initialized);
            } else {
                console.error('currentRawData not available, cannot initialize LH5Decoder');
                return; // 初期化失敗の場合は処理を停止
            }
        } catch (error) {
            console.error('Failed to initialize LH5Decoder:', error);
            console.error('Parameters: fileData length=', window.currentRawData ? window.currentRawData.length : 'null', 
                         'startPos=', tadPos, 'compSize=', gHead.compSize, 'origSize=', gHead.origSize);
            return;
        }
    }

    console.debug("startPos : " + startPos);

    // Read extended data (ルート仮身)
    const extBuf = new Uint16Array(250);
    const extData = new Uint8Array(gHead.extSize);
    xRead(compMethod, extData, gHead.extSize);

    // Convert to Uint16Array
    const extView = new DataView(extData.buffer);
    for (let i = 0; i < gHead.extSize / 2; i++) {
        extBuf[i] = extView.getUint16(i * 2, true);
    }
    
    if (extBuf[0] !== VOBJ) {
        //throw new Error('Invalid extended data');
    }
    if (compMethod == LH5) {
        console.debug("globalStaticBufTop :" + globalStaticBufTop);
    } else {
        console.debug("tadPos :" + tadPos);
    }

    // ローカルヘッダの一括読込
    lHead = new Array(gHead.nfiles);
    console.debug("localHead Num :" + gHead.nfiles);

    // 各LOCAlHeadを1つずつ読み込み（デバッグのため）
    for (let localheadLoop = 0; localheadLoop < gHead.nfiles; localheadLoop++) {
        console.debug("localHead No:" + localheadLoop);
        
        // 1つのLOCAlHeadを読み込み
        const lheadData = new Uint8Array(localHeadSize);
        xRead(compMethod, lheadData, localHeadSize);
        
        const lhead = new LocalHead();
        const view = new DataView(lheadData.buffer);
        let offset = 0;

        lhead.f_type = view.getUint16(offset, true); offset += 2;
        lhead.f_atype = view.getUint16(offset, true); offset += 2;
        
        // Read name (20 TC chars = 40 bytes)
        for (let j = 0; j < 20; j++) {
            lhead.name += charTronCode(Number(view.getUint16(offset, true)));
            offset += 2;
        }

        lhead.origId = Number(view.getUint16(offset, true)); offset += 2;
        lhead.compMethod = Number(view.getUint16(offset, true)); offset += 2;
        lhead.origSize = Number(uh2uw([view.getUint16(offset + 2, true), view.getUint16(offset, true)])[0]); offset += 4;
        lhead.compSize = Number(uh2uw([view.getUint16(offset + 2, true), view.getUint16(offset, true)])[0]); offset += 4;

        // Skip reserve[4]
        offset += 8;

        lhead.f_nlink = IntToHex(view.getUint16(offset, true), 4).replace('0x', ''); offset += 2;
        lhead.crc = IntToHex(view.getUint16(offset, true), 4).replace('0x', ''); offset += 2;
        lhead.f_size = Number(uh2uw([view.getUint16(offset + 2, true), view.getUint16(offset, true)])[0]); offset += 4;
        lhead.offset = Number(uh2uw([view.getUint16(offset + 2, true), view.getUint16(offset, true)])[0]); offset += 4;
        lhead.f_nrec = Number(uh2uw([view.getUint16(offset + 2, true), view.getUint16(offset, true)])[0]); offset += 4;
        lhead.f_ltime = Number(uh2uw([view.getUint16(offset + 2, true), view.getUint16(offset, true)])[0]); offset += 4;
        lhead.f_atime = Number(uh2uw([view.getUint16(offset + 2, true), view.getUint16(offset, true)])[0]); offset += 4;
        lhead.f_mtime = Number(uh2uw([view.getUint16(offset + 2, true), view.getUint16(offset, true)])[0]); offset += 4;
        lhead.f_ctime = Number(uh2uw([view.getUint16(offset + 2, true), view.getUint16(offset, true)])[0]); offset += 4;

        console.debug(`LocalHead[${localheadLoop}]: name="${lhead.name}", origId=${lhead.origId}, compMethod=${lhead.compMethod}, orgsize=${lhead.origSize}, compSize=${lhead.compSize}, f_nlink=${lhead.f_nlink}, crc=${lhead.crc}, fsize=${lhead.f_size}, offset=${lhead.offset}, nrec=${lhead.f_nrec}, f_ltime=${lhead.f_ltime}`);
        
        lHead[localheadLoop] = lhead;
    }
    
    pass1();
    console.debug('PASS1 ok!!');

    pass2(lHead);
    console.debug('PASS2 ok!!');
}

/**
 * TADパーサー TADセグメントを判定
 * @param {0x0000} segID 
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 * @param {int} nowPos
 */
function tadPerse(segID, segLen, tadSeg, nowPos) {
    //console.debug("tadSeg " + IntToHex((segID),4).replace('0x',''));

    if (segID === Number(TS_INFO)) {
        console.debug('管理情報セグメント');
        tadVer(tadSeg);
    } else if (segID === Number(TS_TEXT)) {
        console.debug('文章開始セグメント');
        tsTextStart(tadSeg);
    } else if (segID === Number(TS_TEXTEND)) {
        console.debug('文章終了セグメント');
        tsTextEnd(tadSeg);
    } else if (segID === Number(TS_FIG)) {
        console.debug('図形開始セグメント');
        tsFigStart(tadSeg);
    } else if (segID === Number(TS_FIGEND)) {
        console.debug('図形終了セグメント');
        tsFigEnd(tadSeg);
    } else if (segID === Number(TS_IMAGE)) {
        console.debug('画像セグメント');
        tsImageSegment(segLen, tadSeg);
    } else if (segID === Number(TS_VOBJ)) {
        console.debug('仮身セグメント');
        console.log('Virtual object segment detected! segLen:', segLen, 'currentFileIndex:', currentFileIndex);
        tsVirtualObjSegment(segLen, tadSeg);
    } else if (segID === Number(TS_DFUSEN)) {
        console.debug('指定付箋セグメント');
        tsSpecitySegment(segLen, tadSeg, nowPos);
    } else if (segID === Number(TS_FFUSEN)) {
        console.debug('機能付箋セグメント');
    } else if (segID === Number(TS_TPAGE)) {
        console.debug('文章ページ割付け指定付箋');
        tadPageSetFusen(segLen, tadSeg);
    } else if (segID === Number(TS_TRULER)) {
        console.debug('行書式指定付箋');
        tadRulerSetFusen(segLen, tadSeg);
    } else if (segID === Number(TS_TFONT)) {
        console.debug('文字指定付箋');
        tadFontSetFusen(segLen, tadSeg);
    } else if (segID === Number(TS_TCHAR)) {
        console.debug('特殊文字指定付箋');
        tadSpecialCharFusen(segLen, tadSeg);
    } else if (segID === Number(TS_TATTR)) {
        console.debug('文字割り付け指定付箋');
        tadTextAlignFusen(segLen, tadSeg);
    } else if (segID === Number(TS_TSTYLE)) {
        console.debug('文字修飾指定付箋');
        tadTextStyleFusen(segLen, tadSeg);
    } else if (segID === Number(TS_TVAR)) {
        console.debug('変数参照指定付箋');
        tsVariableReference(segLen, tadSeg);
    } else if (segID === Number(TS_TMEMO)) {
        console.debug('文章メモ指定付箋');
        tsDocumentMemo(segLen, tadSeg);
    } else if (segID === Number(TS_TAPPL)) {
        console.debug('文章アプリケーション指定付箋');
    } else if (segID === Number(TS_FPRIM)) {
        console.debug('図形要素セグメント');
        tsFigDraw(segLen, tadSeg);
    } else if (segID === Number(TS_FDEF)) {
        console.debug('データ定義セグメント');
        tsDataSet(segLen, tadSeg);
    } else if (segID === Number(TS_FGRP)) {
        console.debug('グループ定義セグメント');
        tsGroupSet(segLen, tadSeg);
    } else if (segID === Number(TS_FMAC)) {
        console.debug('マクロ定義/参照セグメント');
    } else if (segID === Number(TS_FATTR)) {
        console.debug('図形修飾セグメント');
        tsFigureModifier(segLen, tadSeg);
    } else if (segID === Number(TS_FPAGE)) {
        console.debug('図形ページ割り付け指定付箋');
        tsFigurePageFusen(segLen, tadSeg);
    } else if (segID === Number(TS_FMEMO)) {
        console.debug('図形メモ指定付箋');
        tsFigureMemo(segLen, tadSeg);
    } else if (segID === Number(TS_FAPPL)) {
        console.debug('図形アプリケーション指定付箋');
    }

    if (segID !== Number(TS_FATTR)) {
        // 図形修飾セグメント以外は矢印状態をリセット
        resetFigureModifier();
        resetFigureTransformState();
    }
}

/**
 * TRONコードを判定
 * TODO: 現状はTRON仕様日本文字コードの第1面 Aゾーン(JIS X 0208)のみ対応
 * @param {char} char 
 * @returns 
 */
function charTronCode(char) {
    const charBuffer = new ArrayBuffer(2);
    const dv = new DataView(charBuffer);
    dv.setUint16(0, char);

    const char8 = new Array(Number(dv.getUint8(0,false)),Number(dv.getUint8(1,false)));
    let int1 = Number(dv.getUint8(0,false));
    let int2 = Number(dv.getUint8(1,false));

    let text = '';

    // TRONコード 面切替
    if ((char >= Number(0xfe21) && char <= Number(0xfe7e) )
    || (char >= Number(0xfe80) && char <= Number(0xfefe))) {
        const tronCodeMask = char - Number(0xfe21) + 1;
        if (isXmlDumpEnabled()) {
            xmlBuffer.push(`<tcode mask="${tronCodeMask}" />\r\n`);
        }
        console.debug("TRON Code面 :" + tronCodeMask)
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

        const unicodeArray = Encoding.convert([int1,int2],{
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


/**
 * TADデータを処理
 * @param {*} raw 
 */
function tadRawArray(raw){
    // LH5Decoder初期化用にrawデータをグローバルに保存
    if (typeof window !== 'undefined') {
        window.currentRawData = raw;
    }

    let rawBuffer = raw.buffer;
    let data_view = new DataView( rawBuffer );

    tadRaw = new Uint8Array(raw);  // slice()を追加
    tadRawBuffer = tadRaw.buffer;
    tadDataView = new DataView( tadRawBuffer );

    initTAD(0, 0);

    let i = 0;
    
    while(i < raw.length) {
        const nowPos = i;   

        let raw16 = data_view.getUint16(i,true);

        if (raw16 === Number(TNULL)) {
            // 終端
            if (isXmlDumpEnabled()) {
                xmlBuffer.push('\r\n');
            }
            break;
        }

        let segID = '';
        let segLen = 0;
        let tadSeg = [];

        if (raw16 > Number(TC_SPEC)) {
            if (raw16 === Number(0xfffe)) {
                i += 2;
                raw16 = data_view.getUint16(i,true);
                if (raw16 >= Number(TC_SPEC)) {
                    i += 2;
                    raw16 = data_view.getUint16(i,true);
                    // 0x321 - 0x3FD
                    if (raw16 === Number(0xfefe)) {
                        i += 2;
                        segID = data_view.getUint16(i,true) + TC_SPEC; // + 0x300;  
                        i += 2;

                    // 0x221 - 0x2FD
                    } else{
                        segID = data_view.getUint8(i,true) + TC_SPEC; // + 0x200;  
                        i += 2;
                    }
                // 0x121 - 0x1FD
                } else{
                    segID = data_view.getUint16(i,true) + TC_SPEC; // + 0x100;  
                    i += 2;
                }
            // 0x80 - 0xFD
            } else{
                segID = data_view.getUint8(i,true) + TC_SPEC;  
                i += 2;
            }

            segLen = Number(data_view.getUint16(i,true));
            if (segLen === Number(0xffff)) {
                i += 2;
                segLen = Number(data_view.getUint32(i,true));
                i += 4;

            }else{
                i += 2;
            }


            for(let offsetLen=0;offsetLen<segLen;offsetLen=offsetLen+2) {
                const offsetRaw = data_view.getUint16(i + offsetLen,true);
                tadSeg.push(offsetRaw);
            }
            i += segLen;
            tadPerse(segID, segLen, tadSeg, nowPos);

        } else {
            const raw8Plus1 = Number(data_view.getUint16(i,true));
            const char = charTronCode(raw8Plus1);


            // XML出力（文章セグメント内の場合のみ）
            if (isXmlDumpEnabled()) {
                // 改行文字を検出して段落タグを閉じて開く
                if (raw8Plus1 === TC_CR || raw8Plus1 === TC_NL) {
                    // 表計算セルの場合、改行前に装飾終了タグを出力
                    if (isCalcTad && calcActiveDecorations.length > 0) {
                        while (calcActiveDecorations.length > 0) {
                            const tag = calcActiveDecorations.pop();
                            xmlBuffer.push(`</${tag}>`);
                        }
                    }
                    // 文章セグメント内であれば段落タグで区切る
                    if (isInDocSegment) {
                        // 段落を閉じる前に装飾タグを閉じる（逆順）
                        // noprint → mesh → invert → box → strikethrough → overline → underline → strong → i → bagchar
                        if (textDecorations.noprint) {
                            xmlBuffer.push('</noprint>');
                        }
                        if (textDecorations.mesh) {
                            xmlBuffer.push('</mesh>');
                        }
                        if (textDecorations.invert) {
                            xmlBuffer.push('</invert>');
                        }
                        if (textDecorations.box) {
                            xmlBuffer.push('</box>');
                        }
                        if (textDecorations.strikethrough) {
                            xmlBuffer.push('</strikethrough>');
                        }
                        if (textDecorations.overline) {
                            xmlBuffer.push('</overline>');
                        }
                        if (textDecorations.underline) {
                            xmlBuffer.push('</underline>');
                        }
                        if (textDecorations.bold) {
                            xmlBuffer.push('</strong>');
                        }
                        if (textDecorations.italic) {
                            xmlBuffer.push('</i>');
                        }
                        if (textDecorations.bagChar) {
                            xmlBuffer.push('</bagchar>');
                        }

                        // 段落を閉じて新しい段落を開く
                        xmlBuffer.push('</p>\r\n<p>');

                        // 新しい段落で装飾タグを再度開く（正順）
                        // bagchar → i → strong → underline → overline → strikethrough → box → invert → mesh → noprint
                        if (textDecorations.bagChar) {
                            xmlBuffer.push('<bagchar>');
                        }
                        if (textDecorations.italic) {
                            xmlBuffer.push('<i>');
                        }
                        if (textDecorations.bold) {
                            xmlBuffer.push('<strong>');
                        }
                        if (textDecorations.underline) {
                            xmlBuffer.push('<underline>');
                        }
                        if (textDecorations.overline) {
                            xmlBuffer.push('<overline>');
                        }
                        if (textDecorations.strikethrough) {
                            xmlBuffer.push('<strikethrough>');
                        }
                        if (textDecorations.box) {
                            xmlBuffer.push('<box>');
                        }
                        if (textDecorations.invert) {
                            xmlBuffer.push('<invert>');
                        }
                        if (textDecorations.mesh) {
                            xmlBuffer.push('<mesh>');
                        }
                        if (textDecorations.noprint) {
                            xmlBuffer.push('<noprint>');
                        }

                        isParagraphOpen = true;  // 新しい段落が開始
                    }
                } else {
                    // XML特殊文字のエスケープ
                    const xmlChar = char
                        .replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;')
                        .replace(/"/g, '&quot;')
                        .replace(/'/g, '&apos;');
                    xmlBuffer.push(xmlChar);
                    // テキストが追加されたら段落は開いている
                    if (isInDocSegment) {
                        isParagraphOpen = true;
                    }
                }
            }
            i += 2;
        }
    }

    // XMLBuffer が </document></figure> で終わっていない場合は追加
    if (isXmlDumpEnabled() && xmlBuffer.length > 0) {
        //const lastEntry = xmlBuffer[xmlBuffer.length - 1];
        if (isXmlTad) {
            console.debug('Adding closing </document> tag to xmlBuffer');
            // 開いている段落タグがあれば閉じる
            if (isParagraphOpen) {
                xmlBuffer.push('</p>\r\n');
                isParagraphOpen = false;
            }
            xmlBuffer.push('</document>\r\n');
        }
        if (isXmlFig) {
            console.debug('Adding closing </figure> tag to xmlBuffer');
            xmlBuffer.push('</figure>\r\n');
        }
        if (isTadStarted) {
            xmlBuffer.push('</tad>\r\n');
        }
    }
}

function tadDataArray(raw, isRedrawn = false, nfiles = null, fileIndex = null) {
    if (raw && raw.p instanceof Uint8Array) {
        raw = raw.p;
    }

    // === 新設計：各TADファイル(nfiles)ごとのcanvas描画システム ===
    
    // パラメータの決定
    if (nfiles === null) {
        nfiles = (typeof gHead !== 'undefined' && gHead.nfiles) ? gHead.nfiles : 1;
    }
    if (fileIndex === null) {
        fileIndex = (typeof currentFileIndex !== 'undefined') ? currentFileIndex : 0;
    }
    
    console.debug(`*** New tadDataArray: nfiles=${nfiles}, fileIndex=${fileIndex}, isRedrawn=${isRedrawn} ***`);
    
    // TADファイルごとのrawデータを保管
    if (!isRedrawn && raw && raw.length > 0) {
        if (!tadRawDataArray[fileIndex]) {
            tadRawDataArray[fileIndex] = new Uint8Array(raw);
            console.debug(`TAD raw data saved for file ${fileIndex}, size: ${raw.length}`);
        }
    }
    
    // 再描画時は保存されたrawデータを使用
    if (isRedrawn && tadRawDataArray[fileIndex]) {
        raw = tadRawDataArray[fileIndex];
        console.debug(`Using saved raw data for file ${fileIndex}, size: ${raw.length}`);
    }
    
    // tabIndexを定義（fileIndexをtabIndexとして使用）
    const tabIndex = fileIndex;

    // TADセグメント処理
    tadRawArray(raw);

    console.debug('TAD processing completed');

    // XML出力の最終処理
    if (isXmlDumpEnabled()) {
        parseXML = xmlBuffer.join('');

        // BPK解凍時でXMLスロットが予約されている場合はそのスロットに格納
        if (currentXmlSlotIndex >= 0) {
            xml[currentXmlSlotIndex] = parseXML;
            console.debug(`XML stored in reserved slot xml[${currentXmlSlotIndex}] for file ${fileIndex}: ${parseXML.substring(0, 100)}...`);
        } else {
            // 通常の場合はpushで追加
            xml.push(parseXML);
            console.debug(`XML parsed for file ${fileIndex}: ${parseXML.substring(0, 100)}...`);
        }
        console.debug(`XML array length: ${xml.length}`);
        console.debug(`xmlBuffer length: ${xmlBuffer.length}`);
        console.debug(`isInDocSegment: ${isInDocSegment}`);
    } else {
        parseXML = '';
    }
    
    // TAD処理完了のコールバックを呼び出し（最後のファイル処理時のみ）
    const canvasId = window.canvas ? window.canvas.id : 'canvas-0';
    const callbackName = `tadProcessingComplete_${canvasId}`;
    console.debug(`TAD processing completed for canvas: ${canvasId}, callback: ${callbackName}`);
    console.debug(`Callback function exists: ${typeof window[callbackName] === 'function'}`);
    console.debug(`isProcessingBpk: ${isProcessingBpk}, tadRecordDataArray length: ${tadRecordDataArray ? tadRecordDataArray.length : 'null'}, currentFileIndex: ${currentFileIndex}`);
    
    if (typeof window !== 'undefined' && typeof window[callbackName] === 'function') {
        // BPK処理の場合は最後のファイル処理時のみコールバックを呼ぶ
        // 単体TADファイルの場合は常にコールバックを呼ぶ
        const shouldCallCallback = !isProcessingBpk || 
                                !tadRecordDataArray || 
                                tadRecordDataArray.length <= 1 || 
                                currentFileIndex >= tadRecordDataArray.length - 1;
        
        console.debug(`shouldCallCallback: ${shouldCallCallback}`);
        
        if (shouldCallCallback) {
            setTimeout(() => {
                console.debug(`Calling ${callbackName} callback (final)`);
                window[callbackName]({
                    linkRecordList: linkRecordList,
                    tadRecordDataArray: tadRecordDataArray,
                    isProcessingBpk: isProcessingBpk,
                    currentFileIndex: currentFileIndex
                });
            }, 10); // DOM更新後に実行
        } else {
            console.debug(`Skipping callback - not final file (currentFileIndex: ${currentFileIndex}, total files: ${tadRecordDataArray ? tadRecordDataArray.length : 'null'})`);
        }
    } else {
        console.debug(`Callback ${callbackName} not found or not a function`);
    }
}

/**
 * TADファイルをパースしてXMLを取得
 * @param {Uint8Array|Array} rawData - TADファイルのバイトデータ
 * @param {number} fileIndex - ファイルインデックス（デフォルト0）
 * @returns {Promise<string>} - パース結果のXML文字列
 */
async function parseTADToXML(rawData, fileIndex = 0) {
    return new Promise((resolve, reject) => {
        try {
            console.log('parseTADToXML開始: fileIndex=' + fileIndex + ', データサイズ=' + rawData.length);

            // XMLダンプを強制的に有効化
            forceXmlDumpEnabled = true;

            // xml配列をクリア（指定したインデックスのみ）
            if (!xml) {
                xml = [];
            }
            xml[fileIndex] = '';

            // parseXMLをクリア
            parseXML = '';
            xmlBuffer = [];
            isInDocSegment = false;
            currentIndentLevel = 0;

            // Uint8Arrayに変換
            const uint8Array = rawData instanceof Uint8Array ? rawData : new Uint8Array(rawData);

            console.log('tadRawArray呼び出し前: isXmlDumpEnabled=' + isXmlDumpEnabled());

            // TADをパース（同期処理）
            tadRawArray(uint8Array);

            console.log('tadRawArray呼び出し後: xml.length=' + xml.length + ', xml[' + fileIndex + '].length=' + (xml[fileIndex] ? xml[fileIndex].length : 0));
            console.log('parseXML.length=' + parseXML.length);

            // パース結果のXMLを取得
            let resultXML = '';
            if (xml && xml[fileIndex]) {
                resultXML = xml[fileIndex];
                console.log('xml[' + fileIndex + ']から取得: ' + resultXML.length + '文字');
            } else if (parseXML) {
                resultXML = parseXML;
                console.log('parseXMLから取得: ' + resultXML.length + '文字');
            }

            // 強制フラグを戻す
            forceXmlDumpEnabled = false;

            console.log(`TAD→XML変換完了: ${resultXML.length}文字`);
            if (resultXML.length > 0) {
                console.log('XMLプレビュー: ' + resultXML.substring(0, 200));
            }
            resolve(resultXML);
        } catch (error) {
            console.error('TAD→XML変換エラー:', error);
            forceXmlDumpEnabled = false;
            reject(error);
        }
    });
}


/**
 * TADファイル読込処理
 * @param {event} event
 */
function onAddFile(event) {
    let files;
    const reader = new FileReader();
    let tadRecord = '';

    // Reset flags for new file
    isProcessingBpk = false;
    currentFileIndex = 0;
    linkRecordList = [];  // Reset linkRecordList as two-dimensional array
    linkRecordList[0] = [];  // Initialize first index for single files

    // XMLパース関連のリセット
    xml = [];
    parseXML = '';
    xmlBuffer = [];
    isInDocSegment = false;
    currentIndentLevel = 0;

    // 新設計：TADファイル描画バッファシステムをリセット
    tadRawDataArray = {};
    
    console.debug('TAD file drawing system reset');
    
    
    if (event.target.files) {
        files = event.target.files;
    }else{
        files = event.dataTransfer.files;   
    }
    const fileNum  = files.length;
    tadRecord = files[0];
    for(let numLoop=0;numLoop<fileNum;numLoop++) {
        if (files[numLoop].name.includes('.000')) {
            //linkRecord = files[numLoop]
        }
        if (numLoop === (fileNum - 1)) {
            tadRecord = files[numLoop]
        }
    }

    reader.onload = function (event) {
        const raw = new Uint8Array(reader.result);
        // console.debug(raw);
        // すべてのファイルでtadRawArrayを使用（シンプル）
        tadRawArray(raw);
    };

    if (fileNum > 0) {
        reader.readAsArrayBuffer(tadRecord);
        document.getElementById("inputfile").value = '';
    }

}


/**
 * unpack.jsの結果を取得するためのアクセサ関数
 */
function getArchiveFiles() {
    return archiveFiles;
}

function getGeneratedImages() {
    return generatedImages;
}

function getRealIdMap() {
    return realIdMap;
}

// Export functions to global scope for HTML event handlers
if (typeof window !== 'undefined') {
    window.onAddFile = onAddFile;
    window.onDrop = onDrop;
    window.getArchiveFiles = getArchiveFiles;
    window.getGeneratedImages = getGeneratedImages;
    window.getRealIdMap = getRealIdMap;
    window.onDragOver = onDragOver;

    // XML変換関数をエクスポート
    window.parseTADToXML = parseTADToXML;

    // 図形修飾関数をエクスポート
    window.resetFigureModifier = resetFigureModifier;
    window.resetFigureTransformState = resetFigureTransformState;
    window.applyFigureTransform = applyFigureTransform;
    window.applyFigureTransformToPoints = applyFigureTransformToPoints;

    // BPK解凍用関数をエクスポート
    window.tadRawArray = tadRawArray;
    window.initTAD = initTAD;

    console.debug('TAD.js functions exported to global scope:', {
        onAddFile: typeof window.onAddFile,
        onDrop: typeof window.onDrop,
        onDragOver: typeof window.onDragOver,
        parseTADToXML: typeof window.parseTADToXML,
        resetFigureModifier: typeof window.resetFigureModifier,
        resetFigureTransformState: typeof window.resetFigureTransformState,
        applyFigureTransform: typeof window.applyFigureTransform,
        tadRawArray: typeof window.tadRawArray,
        initTAD: typeof window.initTAD
    });
}
