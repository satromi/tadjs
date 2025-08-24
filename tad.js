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
 * TADjs Ver0.05
 *
 * BTRONのドキュメント形式である文章TAD、図形TADをブラウザ上で表示するツールです
 * @link https://github.com/satromi/tadjs
 * @author satromi@gmail.com Tw  @satromi
 * @license https://www.apache.org/licenses/LICENSE-2.0 Apache-2.0
*/


// global
let ctx;
let canvas;
let currentFileIndex = 0;  // Track current file index for multiple tabs
let isProcessingBpk = false;  // Flag to indicate BPK processing
let textNest = 0;
let textCharList = new Array();
let textCharPoint = new Array();
let textCharData = new Array();
let textCharDirection = new Array();
let imageNest = 0;
let imagePoint = new Array();
let tronCodeMask = new Array();
let startTadSegment = false;
let startByImageSegment = false;
let tabCharNum = 4;
let tabRulerLinePoint = 0;
let tabRulerLineMove = 0;
let tabRulerLinePos = 0;
let tabRulerLineMoveCount = 0;
let tabRulerLineMovePoint = new Array();
let tabRulerLineMoveFlag = false;
let colorPattern = new Array(65536);

// フォント設定
let textFontSize = 9.6;
let textFontSet = textFontSize + 'px serif';
let textFontColor = '#000000';

// 図形設定
let drawLineColor = '#000000';
let drawLineWidth = 1;
let drawFillColor = '#FFFFFF';
let backgroundColor = '#FFFFFF';


let tadRaw;
let tadRawBuffer;
let tadDataView;
let tadTextDump = '00000000 ';
let planeTextDump = '';
let tadPos = 0;

let textRow    = 0; // 行
let textColumn = 0; // 列
let textWidth = 0;
let textHeight = 0;
let lineMaxHeight = new Array();
let lineSpacingDirection = 0; // 行間
let lineSpacingType = 1; // 行間の種類
let lineSpacingPitch = 1.75; // 行間のピッチ
let textAlign = 0; // 0:左揃え,1:中央揃え,2:右揃え,3:両端揃え,4:均等揃え,5～:予約
let textDirection = 0; // 0:左から右,1:右から左,2:上から下,3-255:予約
let textSpacingDirection = 0; // 文字間隔の方向 0:文字送り方向, 1:文字送り方向の逆
let textSpacingKerning = 0; // 文字間隔カーニング有無 0:無効,1:有効
let textSpacingPattern = 0; // 文字間隔パターン 0:文字送り量,文字アキ量
let textSpacingPitch = 0.125; // SCALE 文字間隔のピッチ


// リンクレコード対応
let linkRecordList = new Array(); // リンクレコードリスト
let linkNo = 0;


let tadDpiH = 72;
let tadDpiV = 72;
let tadDpiHFlag = false;
let tadDpiVFlag = false;

let LOCALHEADSIZE = 96;

const canvasW = 1200;
const canvasH = 1000;
let virtualW = 1200;
let virtualH = 1000;

// スクロール管理変数（レガシー、後方互換性のため残す）
let scrollX = 0;
let scrollY = 0;
let scrollBarWidth = 16;
let showHScrollBar = false;
let showVScrollBar = false;

// タブごとのスクロール状態管理
let tabScrollStates = {};

// 新設計：各TADファイル(nfiles)ごとの描画バッファシステム
let tadFileCanvases = {};      // 各TADファイル(nfiles)ごとのcanvas
let tadFileContexts = {};      // 各TADファイル(nfiles)ごとのcontext  
let tadFileDrawBuffers = {};   // 各TADファイル(nfiles)ごとの描画バッファ領域（ImageData）
let tadRawDataArray = {};      // 各TADファイル(nfiles)ごとのrawデータ保存

// 仮身セグメント処理制御
let isInTextSegment = false;   // 文章セグメント処理中かどうかの判定フラグ


/**
 * タブのスクロール状態を初期化
 * @param {number} tabIndex
 */
function initTabScrollState(tabIndex) {
    if (!tabScrollStates[tabIndex]) {
        tabScrollStates[tabIndex] = {
            scrollX: 0,
            scrollY: 0,
            virtualW: canvasW,
            virtualH: canvasH,
            showHScrollBar: false,
            showVScrollBar: false
        };
        }
}

/**
 * タブのスクロール状態をリセット
 * @param {number} tabIndex
 */
function resetTabScrollState(tabIndex) {
    tabScrollStates[tabIndex] = {
        scrollX: 0,
        scrollY: 0,
        virtualW: canvasW,
        virtualH: canvasH,
        showHScrollBar: false,
        showVScrollBar: false
    };
}

/**
 * 現在のタブのスクロール状態を取得
 * @param {number} tabIndex
 * @returns {object}
 */
function getTabScrollState(tabIndex) {
    initTabScrollState(tabIndex);
    return tabScrollStates[tabIndex];
}

/**
 * 現在のタブのスクロール状態を更新
 * @param {number} tabIndex
 * @param {object} state
 */
function updateTabScrollState(tabIndex, state) {
    initTabScrollState(tabIndex);
    Object.assign(tabScrollStates[tabIndex], state);
}

/**
 * 現在のタブインデックスを取得
 * @returns {number}
 */
function getCurrentTabIndex() {
    // HTMLのcurrentTabIndexが定義されていればそれを使用
    // BPKファイル処理中でもユーザーが選択したタブを尊重
    return typeof currentTabIndex !== 'undefined' ? currentTabIndex : currentFileIndex;
}

/**
 * 現在のタブのスクロール状態をグローバル変数に同期
 * @param {number} tabIndex
 */
function syncTabStateToGlobals(tabIndex) {
    const state = getTabScrollState(tabIndex);
    scrollX = state.scrollX;
    scrollY = state.scrollY;
    virtualW = state.virtualW;
    virtualH = state.virtualH;
    showHScrollBar = state.showHScrollBar;
    showVScrollBar = state.showVScrollBar;
}

/**
 * 各TADファイル(nfiles)ごとのcanvasを生成
 * @param {number} fileIndex ファイルインデックス
 * @param {number} width canvas幅
 * @param {number} height canvas高さ
 */
function createTadFileCanvas(fileIndex, width = 2000, height = 2000) {
    if (!tadFileCanvases[fileIndex]) {
        console.debug(`Creating TAD file canvas for file ${fileIndex} (${width}x${height})`);
        
        // canvasを作成
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.style.display = 'none'; // 見えない状態で保持
        
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, width, height);
        
        tadFileCanvases[fileIndex] = canvas;
        tadFileContexts[fileIndex] = ctx;
        
        console.debug(`TAD file canvas created for file ${fileIndex}`);
    }
    
    return tadFileCanvases[fileIndex];
}

/**
 * TADファイルcanvasの描画内容を描画バッファ領域に保存
 * @param {number} fileIndex ファイルインデックス
 */
function saveTadFileDrawBuffer(fileIndex) {
    const canvas = tadFileCanvases[fileIndex];
    const ctx = tadFileContexts[fileIndex];
    
    if (canvas && ctx) {
        tadFileDrawBuffers[fileIndex] = ctx.getImageData(0, 0, canvas.width, canvas.height);
        console.debug(`Draw buffer saved for TAD file ${fileIndex}`);
    }
}

/**
 * 描画バッファ領域から表示用canvasに描画
 * @param {number} fileIndex ファイルインデックス
 * @param {number} tabIndex 表示先タブインデックス
 * @param {number} scrollX スクロール位置X
 * @param {number} scrollY スクロール位置Y
 */
function renderFromTadFileDrawBuffer(fileIndex, tabIndex, scrollX = 0, scrollY = 0) {
    const drawBuffer = tadFileDrawBuffers[fileIndex];
    if (!drawBuffer) {
        console.warn(`No draw buffer found for TAD file ${fileIndex}`);
        return;
    }
    
    // 表示用canvasを取得
    const displayCanvas = document.getElementById(`canvas-${tabIndex}`);
    if (!displayCanvas) {
        console.warn(`Display canvas not found for tab ${tabIndex}`);
        return;
    }
    
    const displayCtx = displayCanvas.getContext('2d');
    
    // 表示用canvasをクリア
    displayCtx.clearRect(0, 0, displayCanvas.width, displayCanvas.height);
    
    // 一時的なcanvasに描画バッファを復元
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = drawBuffer.width;
    tempCanvas.height = drawBuffer.height;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.putImageData(drawBuffer, 0, 0);
    
    // スクロール位置の有効性を確認
    const maxScrollX = Math.max(0, drawBuffer.width - displayCanvas.width);
    const maxScrollY = Math.max(0, drawBuffer.height - displayCanvas.height);
    const validScrollX = Math.max(0, Math.min(maxScrollX, scrollX));
    const validScrollY = Math.max(0, Math.min(maxScrollY, scrollY));
    
    // スクロール位置を考慮して表示用canvasに転送
    displayCtx.drawImage(
        tempCanvas,
        validScrollX, validScrollY, displayCanvas.width, displayCanvas.height, // 元画像の切り取り範囲
        0, 0, displayCanvas.width, displayCanvas.height                        // 転送先の範囲
    );
    
    //console.debug(`Rendered from draw buffer: file ${fileIndex} -> tab ${tabIndex} (scroll: ${scrollX}, ${scrollY})`);
}

/**
 * Canvas描画前のスクロールオフセット適用
 */
function applyScrollOffset() {
    if (ctx) {
        const tabIndex = getCurrentTabIndex();
        const state = getTabScrollState(tabIndex);
        ctx.save();
        ctx.translate(-state.scrollX, -state.scrollY);
    }
}

/**
 * Canvas描画後のスクロールオフセット復元
 */
function restoreScrollOffset() {
    if (ctx) {
        ctx.restore();
    }
}

/**
 * 現在のTADファイルを再描画
 */
function redrawCurrentTAD() {
    if (!ctx || !canvas) return;
    
    // 現在のタブのスクロール状態を確保
    const tabIndex = getCurrentTabIndex();
    const state = getTabScrollState(tabIndex);
    
    // グローバル変数を現在のタブ状態で同期（描画処理で必要）
    syncTabStateToGlobals(tabIndex);
    
    // Canvas全体をクリア
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0); // リセット transform
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    
    // スクロールオフセットを適用
    applyScrollOffset();
    
    // 既存のTADデータを再処理 (簡易版)
    if (tadRaw && tadRaw.length > 0) {
        const tabIndex = getCurrentTabIndex();
        // 新設計：再描画時は現在のタブに対応するfileIndexで処理
        tadDataArray(tadRaw, true, null, tabIndex);
    }
}


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
        this.fgcol = new Array(); // COLOR()配列
        this.bgcol = new COLOR(); // COLORのみ
        this.mask = new Array(); // UH[]
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
        this.data = new Array();  // UB[]
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

// TADセグメント:用紙サイズ付箋
class PaperSize {
    constructor() {
        this.binding = 0;          // 綴じ方向 0:左綴じ
        this.imposition = 0;       // 面付け指定 0:1面付け,1:2面付け
        this.margin = new Array(); // マージン
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

let GHEAD = new GlobalHead();
let LHEAD = [];
let fusen = new DFUSENSEG();

// 用紙サイズ
let paperSize = new Array();            // 用紙サイズ
let paperBinding = 0;                   // 用紙綴じ方向 0:左綴じ
let paperImposition = 0;                // 用紙面付け指定 0:1面付け,1:2面付け
let paperMargin = new Array();          // 用紙マージン


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
    console.debug("UB_SubID" + SubID);
    return SubID;
}

/**
 * UHからUB ATTRを取得
 * @param {UH} UH 
 * @returns 
 */
function getLastUBinUH(UH) {
    const ATTR = ( UH & 0b00000011);
    console.debug("ATTR" + ATTR);
    return ATTR;
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


function fwrite (p, s, n) {
    const char = String.fromCharCode.apply(null, p.slice(0, s * n));
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
    lh5Decoder.init(tadRawDataArray[currentFileIndex], tadPos, GHEAD.compSize, GHEAD.origSize);
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
    
    // Set BPK processing flag if multiple files
    if (GHEAD.nfiles > 1) {
        isProcessingBpk = true;
        currentFileIndex = 0;
    }
    
    // Buffer for reading data
    const buffer = new Uint8Array(BUFFERSIZE);
    
    // Process all files
    for (let i = 0; i < GHEAD.nfiles; i++) {
        console.debug(`Processing file ${i}, GHEAD.nfiles=${GHEAD.nfiles}`);
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
            rhead.size = Number(uh2uw([view.getUint16(6, true), view.getUint16(4, true)])[0])
            console.debug(`Record Head: type=${rhead.type}, subtype=${rhead.subtype}, size=${rhead.size}`);
            
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
                const nfiles = (typeof GHEAD !== 'undefined' && GHEAD.nfiles) ? GHEAD.nfiles : 1;
                tadDataArray(recordData, false, nfiles, currentFileIndex);
                if (isProcessingBpk) {
                    currentFileIndex++;
                }
            } else {
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
        linkNo = 0;
        console.debug("TadVer " + IntToHex((tadSeg[2]),4).replace('0x',''));
    }

}
/**
 * 文章開始セグメントを処理
 * 文章開始セグメントは複数入れ子になるため、テキストの配列を追加して以後のテキストを格納。
 * 文章終了セグメントで一括してテキストを表示
 * @param {0x0000[]} tadSeg 
 */
function tsTextStart(tadSeg) {
    // 文章セグメント処理開始フラグをオン
    isInTextSegment = true;
    
    let textChar = new STARTTEXTSEG();
    if (startTadSegment == false) {
        startTadSegment = true;
        textChar.h_unit = Number(uh2h(tadSeg[8]));
        textChar.v_unit = Number(uh2h(tadSeg[9]));
        if (textChar.h_unit < 0) {
            tadDpiHFlag = true;
        }
        if (textChar.v_unit < 0) {
            tadDpiVFlag = true;
        }
        tadDpiH = textChar.h_unit; // h_unit
        tadDpiV = textChar.v_unit; // v_unit
    }

    textNest++;
    textCharList.push('');
    tronCodeMask.push(1);
    lineMaxHeight[textRow] = textFontSize

    let viewW = 0;
    let viewH = 0;
    let drawW = 0;
    let drawH = 0;

    // 文章TADの場合、全体が文章であることが示されるため、指定は無効
    if (startByImageSegment == true) {
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

        viewW = textChar.view.right - textChar.view.left;
        viewH = textChar.view.bottom - textChar.view.top;
        drawW = textChar.draw.right - textChar.draw.left;
        drawH = textChar.draw.bottom - textChar.draw.top;
    }

    console.debug('view\r\n');
    console.debug("left " + textChar.view.left);
    console.debug("top " + textChar.view.top);
    console.debug("right " + viewW);
    console.debug("bottom " + viewH);
    console.debug('draw\r\n');
    console.debug("left   " + textChar.draw.left);
    console.debug("top    " + textChar.draw.top);
    console.debug("right  " + drawW);
    console.debug("bottom " + drawH);
    console.debug("h_unit " + textChar.h_unit);
    console.debug("v_unit " + textChar.v_unit);
    console.debug("lang   " + textChar.lang);
    console.debug("bgpat  " + textChar.bpat);

    textCharPoint.push([textChar.view.left,textChar.view.top,viewW,viewH,textChar.draw.left,textChar.draw.top,drawW,drawH]);
    textCharData.push(textChar);
}

/**
 * テキスト描画
 * @param {context} ctx 
 * @param {char} char 
 * @param {int} textfontSize 
 * @param {int} startX 
 * @param {int} startY 
 * @param {int} width 
 * @param {int} linePitch 
 * @param {int} align 
 */
function drawText(ctx, char, textfontSize, startX, startY, width, textPitch, linePitch, align) {
    if (canvasW < width ) {
        width = canvasW;
    } else if (width < 10) {
        width = canvasW;
    }

    const lineHeight = textfontSize * linePitch;

    if (lineMaxHeight.length == 0) {
        lineMaxHeight.push(lineHeight);
    }

    if (lineMaxHeight[textRow] < lineHeight) {
        lineMaxHeight[textRow] = lineHeight;
    }

    textFontSet = textFontSize + 'px serif';
    ctx.fillStyle = textFontColor;
    //console.debug("textFontColor:" + textFontColor);
    ctx.font = textFontSet;
    ctx.textBaseline = "top";

    // 折り返し処理
    if (ctx.measureText(char).width + textWidth > width) {
        textHeight += lineMaxHeight[textRow];
        textRow++;
        lineMaxHeight.push(linePitch)
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
        textHeight += lineMaxHeight[textRow];
        textRow++;
        lineMaxHeight.push(linePitch)
        textWidth = 0;
        textColumn = 0;
        if (tabRulerLineMoveFlag == true) {
            tabRulerLineMoveFlag = false;
        }
    // 改行処理
    } else if (char == String.fromCharCode(Number(TC_CR))) {
        textHeight += lineMaxHeight[textRow];
        textRow++;
        lineMaxHeight.push(linePitch)
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

        textHeight += lineMaxHeight[textRow];
        textRow++;
        lineMaxHeight.push(linePitch)
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
        textWidth += ctx.measureText(char).width * (1 + textPitch);
        textColumn++;
    }
    
    // virtual領域の拡大チェック
    const right = startX + textWidth;
    const bottom = startY + textHeight + lineHeight;
    expandVirtualArea(startX, startY, right, bottom);
}

/**
 * 文章終了セグメントを処理
 * 文章開始セグメント以降格納されていたテキストを一括して表示
 * @param {0x0000[]} tadSeg 
 */
function tsTextEnd(tadSeg) {
    isInTextSegment = false;  // 文章セグメント終了

    const textChar = textCharData[textNest-1];

    console.debug("Text      : " + textCharList[textNest-1]);
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
function tsSizeOfPaperSetFusen(segLen, tadSeg) {
    if (segLen < Number(0x000E)) {
        return;
    }
    // 図形TADの場合は無視される
    if (startByImageSegment == true) {
        return;
    }

    const ATTR = getLastUBinUH(tadSeg[0]);

    if (ATTR === Number(0x00)) {
        paperBinding = 0; // 用紙綴じ方向 0:左綴じ
        paperImposition = 0; // 用紙面付け指定 0:1面付け
    } else if (ATTR === Number(0x01)) {
        paperBinding = 0; // 用紙綴じ方向 0:左綴じ
        paperImposition = 1; // 用紙面付け指定 1:2面付け
    } else if (ATTR === Number(0x02)) {
        paperBinding = 1; // 用紙綴じ方向 1:右綴じ
        paperImposition = 0; // 用紙面付け指定 0:1面付け
    } else if (ATTR === Number(0x03)) {
        paperBinding = 1; // 用紙綴じ方向 1:右綴じ
        paperImposition = 1; // 用紙面付け指定 1:2面付け
    }

    console.debug("length " + IntToHex((tadSeg[1]),4).replace('0x',''));
    console.debug("width  " + IntToHex((tadSeg[2]),4).replace('0x',''));
    console.debug("top    " + IntToHex((tadSeg[3]),4).replace('0x',''));
    console.debug("bottom " + IntToHex((tadSeg[4]),4).replace('0x',''));
    console.debug("left   " + IntToHex((tadSeg[5]),4).replace('0x',''));
    console.debug("right  " + IntToHex((tadSeg[6]),4).replace('0x',''));

    const paperLength = Number(tadSeg[1]);
    const paperWidth = Number(tadSeg[2]);
    const paperTop = Number(tadSeg[3]);
    const paperBottom = Number(tadSeg[4]);
    const paperLeft = Number(tadSeg[5]);
    const paperRight = Number(tadSeg[6]);

    paperSize.push(paperLength, paperWidth, paperTop, paperBottom, paperLeft, paperRight)

    //textCharPoint[textNest-1][3] = viewH;
    //textCharPoint[textNest-1][2] = viewW;
}

/**
 * マージン指定付箋を処理
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 * @returns 
 */
function tsSizeOfMarginSetFusen(segLen, tadSeg) {
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

    const marginTop = Number(tadSeg[1]);
    const marginBottom = Number(tadSeg[2]);
    const marginLeft = Number(tadSeg[3]);
    const marginRight = Number(tadSeg[4]);

    paperMargin.push(marginTop, marginBottom, marginLeft, marginRight)
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
function tsSizeOfPaperOverlayDefineFusen(segLen, tadSeg) {
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
function tsSizeOfPaperOverlaySetFusen(segLen, tadSeg) {
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
    const UB_SubID = getTopUBinUH(tadSeg[0]);

    if (UB_SubID === Number(0x00)) {
        console.debug("用紙指定付箋");
        tsSizeOfPaperSetFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x01)) {
        console.debug("マージン指定付箋");
        tsSizeOfMarginSetFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x02)) {
        console.debug("コラム指定付箋");
        tsSizeOfColumnSetFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x03)) {
        console.debug("用紙オーバーレイ定義付箋");
        tsSizeOfPaperOverlayDefineFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x04)) {
        console.debug("用紙オーバーレイ指定付箋");
        tsSizeOfPaperOverlaySetFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x05)) {
        console.debug("枠あけ指定付箋");
        // TODO: 未実装
    } else if (UB_SubID === Number(0x06)) {
        console.debug("ページ番号指定付箋");
        // TODO: 未実装
    } else if (UB_SubID === Number(0x07)) {
        console.debug("条件改ページ指定付箋");
        // TODO: 未実装
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

    console.debug(`行間隔: ${lineSpacingPitch}, ATTR: ${ATTR}, pitch: ${pitch}, D: ${D}, G: ${G}, msb: ${msb}, a: ${a}, b: ${b}`);

}

/**
 * 行揃え指定付箋を処理
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 */
function tsRulerLineAlignmentSetFusen(segLen, tadSeg) {
    const ATTR = getLastUBinUH(tadSeg[0]);

    lineAlign = Number(ATTR);
    console.debug("行揃え : " + lineAlign);
    textAlign = lineAlign; // テキストの行揃えも同じ値を使用
}

function tsRulerLineDirectionSetFusen(segLen, tadSeg) {
    textDirection = Number(getLastUBinUH(tadSeg[0]));
    console.debug("文字方向 : " + textDirection);
}

/**
 * 行頭移動指定付箋を処理
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 */
function tsRulerLineMoveSetFusen(segLen, tadSeg) {
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
function tsFontNameSetFusen(segLen,tadSeg) {
    if (segLen < Number(0x0004)) {
        return;
    }
    for(let offsetLen=2;offsetLen<tadSeg.length;offsetLen++) {
        console.debug(charTronCode(tadSeg[offsetLen]));
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
}

function tsFontSpacingSetFusen(segLen, tadSeg) {
    if (segLen < Number(0x0002)) {
        return;
    }
    const ATTR = getLastUBinUH(tadSeg[0]);
    const pitch = tadSeg[1];

    textSpacingDirection = (ATTR >>> 7) & 0b1; // 文字送り方向
    textSpacingKerning = (ATTR >>> 6) & 0b1; // カーニング有無
    textSpacingPattern = (ATTR >>> 0) & 0b1; // 0:文字送り量,1:文字アキ量

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
    console.debug(`文字間隔: ${textSpacingPitch}, ATTR: ${ATTR}, pitch: ${pitch}, textSpacingDirection: ${textSpacingDirection}, textSpacingKerning: ${textSpacingKerning}, textSpacingPattern: ${textSpacingPattern}, msb: ${msb}, a: ${a}, b: ${b}`);
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
    console.debug("文字カラー : " + color.color);
    textFontColor = color.color;
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
    }
}

/**
 * 図形開始セグメントを処理
 * @param {0x0000[]} tadSeg 
 */
function tsFig(tadSeg) {
    isInTextSegment = false;  // 図形セグメント開始（文章セグメント処理終了）
    
    if (startTadSegment == false) {
        startTadSegment = true;
        startByImageSegment = true;
        const h_unit = Number(uh2h(tadSeg[8]));
        const v_unit = Number(uh2h(tadSeg[9]));
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

    let viewX = 0;
    let viewY = 0;
    let viewW = 0;
    let viewH = 0;
    let drawX = 0;
    let drawY = 0;
    let drawW = 0;
    let drawH = 0;

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
        viewW = figSeg.view.right - figSeg.view.left;
        viewH = figSeg.view.bottom - figSeg.view.top;
        drawX = figSeg.draw.left;
        drawY = figSeg.draw.top;
        drawW = figSeg.draw.right - drawX;
        drawH = figSeg.draw.bottom - drawY;
        
    } else if (imageNest > 1 && startByImageSegment == true) {
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
    const figX = Number(tadSeg[5]);
    const figY = Number(tadSeg[6]);
    const figW = Number(tadSeg[7]) - figX;
    const figH = Number(tadSeg[8]) - figY;

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
    ctx.fillStyle = drawFillColor;
    ctx.fill();
    ctx.lineWidth = drawLineWidth;
    ctx.strokeStyle = drawLineColor;
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
    const figRH = Number(tadSeg[5]);
    const figRV = Number(tadSeg[6]);
    const figX = Number(tadSeg[7]);
    const figY = Number(tadSeg[8]);
    const figW = Number(tadSeg[9]) - figX;
    const figH = Number(tadSeg[10]) - figY;


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

    ctx.fillStyle = drawFillColor;
    ctx.fill();
    ctx.lineWidth = drawLineWidth;
    ctx.strokeStyle = drawLineColor;
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

    ctx.strokeStyle = drawLineColor
    ctx.beginPath();
    ctx.moveTo(x,y);

    let polygonPoint = 'polygon ';
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
    console.debug(polygonPoint);
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = drawFillColor;
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

    ctx.strokeStyle = drawLineColor;
    ctx.beginPath();
    ctx.moveTo(x,y);

    let linePoint = 'line   ';
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
    console.debug(linePoint);

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

    const angle = Number(uh2h(tadSeg[4]));
    const frameLeft = Number(uh2h(tadSeg[5]));
    const frameTop = Number(uh2h(tadSeg[6]));
    const frameRight = Number(uh2h(tadSeg[7]));
    const frameBottom = Number(uh2h(tadSeg[8]));
    const radiusX = ( frameRight - frameLeft ) / 2;
    const radiusY = (frameBottom - frameTop) / 2;
    const frameCenterX = frameLeft + radiusX;
    const frameCenterY = frameTop + radiusY;

    const radianAngle = angle * Math.PI / 180;

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
    const radianAngle = angle * Math.PI / 180;

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

    ctx.strokeStyle = drawLineColor;
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
    } else if (UB_SubID === Number(0x04)) {
        console.debug("弓形セグメント");
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
    // TODO :未対応
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
    if (segLen < Number(0x16)) {
        return;
    }
    let i = 1;
    let pattern = new COLORPATTERN();
    pattern.id = Number(uh2h(tadSeg[i]));
    pattern.hsize = Number(uh2h(tadSeg[i++]));
    pattern.vsize = Number(uh2h(tadSeg[i++]));
    pattern.ncol = Number(uh2h(tadSeg[i++]));

    let fgColArray = new Array();
    for (let j = 0; j < pattern.ncol; j++) {
        let segNum = i;
        let fgCol = new COLOR();
        fgCol.color = parseColor(uh2uw([tadSeg[segNum+1], tadSeg[segNum]])[0]);
        i += 2;
        fgColArray.push(fgCol);
    }
    pattern.bgcol = parseColor(uh2uw([tadSeg[i+1], tadSeg[i]])[0]);
    i += 2;

    let maskArray = new Array();
    for (let j = 0; j < pattern.ncol; j++) {
        let mask = Number(uh2h(tadSeg[i++]));
        maskArray.push(mask);
    }
    pattern.mask = maskArray;

    colorPattern[pattern.id] = pattern;

    console.debug("id     " + IntToHex((pattern.id),4).replace('0x',''));
    console.debug("hsize  " + IntToHex((pattern.hsize),4).replace('0x',''));
    console.debug("vsize  " + IntToHex((pattern.vsize),4).replace('0x',''));
    console.debug("ncol   " + IntToHex((pattern.ncol),4).replace('0x','')); 
    console.debug("bgcol  " + pattern.bgcol.color);
    console.debug("fgcol  " + fgColArray.map(col => col.color).join(', '));
    console.debug("mask   " + maskArray.join(', '));
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
    } else if (UB_SubID === Number(0x01)) {
        console.debug("マスクデータ定義セグメント");
    } else if (UB_SubID === Number(0x02)) {
        tsFigColorPattern(segLen, tadSeg);
        console.debug("パターン定義セグメント");
    } else if (UB_SubID === Number(0x03)) {
        console.debug("線種定義セグメント");
    } else if (UB_SubID === Number(0x04)) {
        console.debug("マーカー定義セグメント");
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
    let vobj = new VOBJSEG();
    vobj.left = Number(uh2h(tadSeg[0]));
    vobj.top = Number(uh2h(tadSeg[1]));
    vobj.right = Number(uh2h(tadSeg[2]));
    vobj.bottom = Number(uh2h(tadSeg[3]));
    vobj.height = Number(uh2h(tadSeg[4]));
    vobj.chsz = Number(uh2h(tadSeg[5]));
    vobj.frcol = parseColor(uh2uw([tadSeg[7], tadSeg[6]])[0]);
    vobj.tbcol = parseColor(uh2uw([tadSeg[9], tadSeg[8]])[0]);
    vobj.bgcol = parseColor(uh2uw([tadSeg[11], tadSeg[10]])[0]);
    vobj.dlen = Number(uh2h(tadSeg[14]));

    let linkRecordData = new Array();
    for(let offsetLen=15;offsetLen<tadSeg.length;offsetLen++) {
        linkRecordData.push(tadSeg[offsetLen]);
//        let char = charTronCode(Number(tadSeg[offsetLen]));
//        console.debug("linkRecordData[" + offsetLen + "] = [" + char + "] " + IntToHex((tadSeg[offsetLen]),4).replace('0x',''));
    }

    let newLink = new LINK();
    if (isProcessingBpk) {
        newLink = linkRecordList[currentFileIndex][linkNo];
        newLink.left = vobj.left;
        newLink.top = vobj.top;
        newLink.right = vobj.right;
        newLink.bottom = vobj.bottom;
        newLink.dlen = vobj.dlen;
    }

    
    // virtual領域の拡大チェック
    expandVirtualArea(vobj.left, vobj.top, vobj.right, vobj.bottom);


    // LHEADからlink_nameを取得
    if (LHEAD && LHEAD[newLink.link_id - 1]) {
        const lhead = LHEAD[newLink.link_id - 1];
        newLink.link_name = lhead.name;
    }

    // 文章セグメント処理中かどうかで描画位置を変更
    let drawLeft, drawTop, drawRight, lineTop, lineBottom;
    if (isInTextSegment) {
        
        // テキスト位置を仮身の幅分調整
        if (textWidth + (newLink.right - newLink.left) > canvasW) {
            textHeight += textFontSize * lineSpacingPitch;
            textRow++;
            textWidth = 0;
        }

        // 文章セグメント処理中：drawText座標系での描画位置に仮身の枠を配置
        drawLeft = textWidth;
        drawTop = textHeight;
        lineTop = textHeight ;
        drawRight = drawLeft + (newLink.right - newLink.left);
        lineBottom = lineTop + textFontSize;

        // 文章セグメントの位置にリンク位置を修正
        newLink.left = drawLeft;
        newLink.top = lineTop;
        newLink.right = drawRight;
        newLink.bottom = lineBottom;

    } else {
        // 図形セグメント処理中：従来通りの絶対座標
        drawLeft = newLink.left;
        drawTop = newLink.top;
        drawRight = newLink.right;
    }

    textWidth += newLink.right - newLink.left;

    //drawText(ctx, newLink.link_name, 9.6, drawLeft, drawTop, drawRight - drawLeft, textSpacingPitch, lineSpacingPitch, 0);
    ctx.fillText(newLink.link_name,  drawLeft, drawTop);

    ctx.beginPath();
    ctx.rect(drawLeft, lineTop, drawRight - drawLeft, lineBottom - lineTop);
    ctx.fillStyle = drawFillColor;
    //ctx.fill();
    ctx.lineWidth = drawLineWidth;
    ctx.strokeStyle = drawLineColor;
    ctx.stroke();



    linkRecordList[currentFileIndex][linkNo] = newLink;
    linkNo++;

    console.debug(`仮身セグメント left : ${vobj.left}, top : ${vobj.top}, right : ${vobj.right}, bottom : ${vobj.bottom}, dlen : ${vobj.dlen}`);
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

    console.debug("left   " + Number(uh2h(tadSeg[0])));
    console.debug("top    " + Number(uh2h(tadSeg[1])));
    console.debug("right  " + Number(uh2h(tadSeg[2])));
    console.debug("bottom " + Number(uh2h(tadSeg[3])));
    console.debug("chsz   " + IntToHex((tadSeg[4]),4).replace('0x',''));
    console.debug("pict   " + Number(uh2h(tadSeg[11])));

    console.debug("segLen " + Number(segLen));
    console.debug("nowPos " + Number(nowPos)); // 0x26(0d38)は仮身セグメントの開始位置

    const appl = IntToHex((tadSeg[12]),4).replace('0x','')
        + IntToHex((tadSeg[13]),4).replace('0x','')
        + IntToHex((tadSeg[14]),4).replace('0x','');
    
    if (packAppId1 != tadSeg[12] || packAppId2 != tadSeg[13] || packAppId3 != tadSeg[14]) {
        console.debug("書庫形式ではない アプリケーションID");
        console.debug("appl   " + appl);
        return;
    }
    console.debug("書庫形式");

    for (offsetLen=15;offsetLen<31;offsetLen++) {
        console.debug(charTronCode(tadSeg[offsetLen]));
    }

    const dlen = uh2uw([tadSeg[32], tadSeg[31]]);
    console.debug("dlen   " + dlen[0]);

    // グローバルヘッダの読込 330
    let compSeg = new Array();
    for(offsetLen=33;offsetLen<48;offsetLen++) {
        compSeg.push(tadSeg[offsetLen]);
    }
    GHEAD.headType = IntToHex((getTopUBinUH(compSeg[0])),2).replace('0x','');

    GHEAD.checkSum = IntToHex((getLastUBinUH(compSeg[0])),2).replace('0x','');
    GHEAD.version = IntToHex((compSeg[1]),4).replace('0x','');
    GHEAD.crc = IntToHex((compSeg[2]),4).replace('0x','');
    GHEAD.nfiles = Number(compSeg[3]);
    GHEAD.compMethod = Number(compSeg[4]); // 圧縮方式
    GHEAD.fileSize = Number(uh2uw([compSeg[8], compSeg[7]])[0]); // 書庫付箋のサイズ
    GHEAD.origSize = Number(uh2uw([compSeg[10], compSeg[9]])[0]); // 圧縮部の非圧縮サイズ
    GHEAD.compSize = Number(uh2uw([compSeg[12], compSeg[11]])[0]); // 圧縮部の圧縮サイズ
    GHEAD.extSize = Number(uh2uw([compSeg[14], compSeg[13]])[0]); // 拡張部のサイズ
    console.debug("headtype   " + GHEAD.headType);
    console.debug("chechSum   " + GHEAD.checkSum);
    console.debug("version    " + GHEAD.version);
    console.debug("crc        " + GHEAD.crc);
    console.debug("nfiles     " + GHEAD.nfiles);
    console.debug("compmethod " + GHEAD.compMethod);

    compMethod = Number(GHEAD.compMethod);
    if ((compMethod != LH5) && (compMethod != LH0)) {
        console.debug("Error file");
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

    const startPos = nowPos + 66 + 30 + 8; // nowPos38 + Number(0x42) + 30;
    tadPos = startPos;

    crc = INIT_CRC;
    
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
        
        tadDecodeStart(currentFileIndex);
    }

    console.debug("startPos : " + startPos);

    // Read extended data (ルート仮身)
    const extBuf = new Uint16Array(250);
    const extData = new Uint8Array(GHEAD.extSize);
    xRead(compMethod, extData, GHEAD.extSize);

    // Convert to Uint16Array
    const extView = new DataView(extData.buffer);
    for (let i = 0; i < GHEAD.extSize / 2; i++) {
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
    LHEAD = new Array(GHEAD.nfiles);
    console.debug("localHead Num :" + GHEAD.nfiles);

    // 各LOCALHEADを1つずつ読み込み（デバッグのため）
    for (let localheadLoop = 0; localheadLoop < GHEAD.nfiles; localheadLoop++) {
        console.debug("localHead No:" + localheadLoop);
        
        // 1つのLOCALHEADを読み込み
        const lheadData = new Uint8Array(LOCALHEADSIZE);
        xRead(compMethod, lheadData, LOCALHEADSIZE);
        
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
    }
    
    pass1();
    console.debug('PASS1 ok!!');

    pass2(LHEAD);
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
    console.debug("tadSeg " + IntToHex((segID),4).replace('0x',''));

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
        tsFig(tadSeg);
    } else if (segID === Number(TS_FIGEND)) {
        console.debug('図形終了セグメント');
    } else if (segID === Number(TS_IMAGE)) {
        console.debug('画像セグメント');
    } else if (segID === Number(TS_VOBJ)) {
        console.debug('仮身セグメント');
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
    } else if (segID === Number(TS_TATTR)) {
        console.debug('文字割り付け指定付箋');
    } else if (segID === Number(TS_TSTYLE)) {
        console.debug('文字修飾指定付箋');
    } else if (segID === Number(TS_TVAR)) {
        console.debug('変数参照指定付箋');
    } else if (segID === Number(TS_TMEMO)) {
        console.debug('文章メモ指定付箋');
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
    } else if (segID === Number(TS_FMAC)) {
        console.debug('マクロ定義/参照セグメント');
    } else if (segID === Number(TS_FATTR)) {
        console.debug('図形修飾セグメント');
    } else if (segID === Number(TS_FPAGE)) {
        console.debug('図形ページ割り付け指定付箋');
    } else if (segID === Number(TS_FMEMO)) {
        console.debug('図形メモ指定付箋');
    } else if (segID === Number(TS_FAPPL)) {
        console.debug('図形アプリケーション指定付箋');
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
        tronCodeMask[textNest] = char - Number(0xfe21) + 1;
        console.debug("TRON Code面 :" + tronCodeMask[textNest])
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
// let moveflg = 0,
//     Xpoint,
//     Ypoint;

//初期値（サイズ、色、アルファ値）の決定
// let defSize = 7,
//     defColor = "#555";

// function startPoint(e) {
//     e.preventDefault();
//     ctx.beginPath();
//     Xpoint = e.pageX - canvas.offsetLeft;
//     Ypoint = e.pageY - canvas.offsetTop;
//     ctx.moveTo(Xpoint, Ypoint);
// }

function mouseDownListner(e) {
    var rect = e.target.getBoundingClientRect();
	//座標取得
	const mouseX1 = e.clientX - rect.left;
	const mouseY1 = e.clientY - rect.top;
    
    console.debug(`Mouse clicked at (${mouseX1}, ${mouseY1})`);

    // 現在のタブインデックスを取得 
    // currentTabIndexはindex_old2.htmlで定義されるが、BPK処理中はcurrentFileIndexと対応する
    let tabIndex = 0;
    if (typeof currentTabIndex !== 'undefined') {
        tabIndex = currentTabIndex;
    } else if (isProcessingBpk && currentFileIndex > 0) {
        tabIndex = currentFileIndex - 1; // currentFileIndexは次のファイル用に既にインクリメントされている
    }
    
    console.debug(`Current tab index: ${tabIndex}`);
    
    // リンク座標リストを参照してリストにあればリンク先を参照する
    if (linkRecordList && linkRecordList[tabIndex] && linkRecordList[tabIndex].length > 0) {
        //console.debug(`Checking ${linkRecordList[tabIndex].length} links for tab ${tabIndex}`);
        
        for (const link of linkRecordList[tabIndex]) {
            //console.debug(`Link:`, link);
            
            // リンクに座標情報がある場合のみチェック
            if (link.left !== undefined && link.right !== undefined && 
                link.top !== undefined && link.bottom !== undefined) {
                
                if (mouseX1 >= link.left && mouseX1 <= link.right &&
                    mouseY1 >= link.top && mouseY1 <= link.bottom) {

                    console.debug(`Link clicked: ${link.link_name} (ID: ${link.link_id})`);

                    // link_idがある場合は対応するcanvasタブに移動
                    if (link.link_id && link.link_id > 0) {
                        // link_idを0ベースのタブインデックスに変換
                        const targetTabIndex = link.link_id - 1;
                        
                        console.debug(`Navigating to tab ${targetTabIndex} for link_id ${link.link_id}`);
                        
                        // index_old2.htmlのswitchTab関数を呼び出し
                        if (typeof switchTab === 'function') {
                            switchTab(targetTabIndex);
                            console.debug(`Switched to tab ${targetTabIndex}`);
                        } else {
                            console.warn('switchTab function not available');
                            alert(`Link to tab ${targetTabIndex} (${link.link_name})`);
                        }
                    }
                    break;
                }
            }
        }
    } else {
        console.debug(`No links found for tab ${tabIndex}`);
    }
}

/**
 * マウスやタッチでの描画処理
 */
// function movePoint(e) {
//     if (e.buttons === 1 || e.which === 1 || e.type == 'touchmove') {
//         Xpoint = e.pageX - canvas.offsetLeft;
//         Ypoint = e.pageY - canvas.offsetTop;
//         moveflg = 1;

//         ctx.lineTo(Xpoint, Ypoint);
//         ctx.lineCap = "round";
//         ctx.lineWidth = defSize * 2;
//         ctx.strokeStyle = defColor;
//         ctx.stroke(); 
//     }
// }

/**
 * 描画処理終了
 * @param {*} e 
 */
// function endPoint(e) {
//     if (moveflg === 0) {
//         ctx.lineTo(Xpoint-1, Ypoint-1);
//         ctx.lineCap = "round";
//         ctx.lineWidth = defSize * 2;
//         ctx.strokeStyle = defColor;
//         ctx.stroke();
//     }
//     moveflg = 0;
// }

/**
 * キャンバスをクリア
 * @param {*} ctx 
 * @param {*} width 
 * @param {*} height 
 */
function clearCanvas(ctx, width, height) {
    // キャンバス全体をクリア
    ctx.clearRect(0, 0, width, height);
    
    // 背景を白で塗りつぶす
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, width, height);
    
    // 描画スタイルをデフォルトに戻す
    ctx.fillStyle = drawFillColor;
    ctx.strokeStyle = drawLineColor;
    ctx.lineWidth = drawLineWidth;
}

/**
 * Canvas 描画領域を初期化
 */
function canvasInit(canvasId) {
    if (!canvasId) {
        canvasId = 'canvas-0';
    }
    canvas = document.getElementById(canvasId);
    if (canvas && canvas.getContext) {
        ctx = canvas.getContext('2d');
    }

    // キャンバスをクリア
    if (ctx && canvas) {
        clearCanvas(ctx, canvas.width, canvas.height);
        
        canvas.width = canvasW;
        canvas.height = canvasH;
        
        // スクロールオフセットを適用
        applyScrollOffset();

        ctx.fillStyle = 'white'; // 背景色を白に設定
        ctx.fillRect(0, 0, ctx.canvas.clientWidth, ctx.canvas.clientHeight);
    }

    // リンク対応
    canvas.addEventListener("mousedown", mouseDownListner, false);
    
    // PC対応
    //canvas.addEventListener('mousedown', startPoint, false);
    //canvas.addEventListener('mousemove', movePoint, false);
    //canvas.addEventListener('mouseup', endPoint, false);
    // スマホ対応
    //canvas.addEventListener('touchstart', startPoint, false);
    //canvas.addEventListener('touchmove', movePoint, false);
    //canvas.addEventListener('touchend', endPoint, false);
}

function tadDataArray(raw, isRedrawn = false, nfiles = null, fileIndex = null) {
    if (raw && raw.p instanceof Uint8Array) {
        raw = raw.p;
    }

    // === 新設計：各TADファイル(nfiles)ごとのcanvas描画システム ===
    
    // パラメータの決定
    if (nfiles === null) {
        nfiles = (typeof GHEAD !== 'undefined' && GHEAD.nfiles) ? GHEAD.nfiles : 1;
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
    
    // TADファイルごとのcanvasを生成
    const tadCanvas = createTadFileCanvas(fileIndex, 2000, 2000);
    const tadCtx = tadFileContexts[fileIndex];
    
    // 描画コンテキストを一時的にTADファイル用canvasに切り替え
    const originalCanvas = canvas;
    const originalCtx = ctx;
    canvas = tadCanvas;
    ctx = tadCtx;
    
    // tabIndexを定義（fileIndexをtabIndexとして使用）
    const tabIndex = fileIndex;
    
    // タブのスクロール状態を初期化（必要な場合のみ）
    if (!isRedrawn) {
        initTabScrollState(tabIndex);
        syncTabStateToGlobals(tabIndex);
    }
    
    // 再描画時はスクロール状態をリセットしない
    if (!isRedrawn) {
        // virtual領域を初期値にリセット（新しいファイル処理開始時）
        if (!isProcessingBpk || currentFileIndex === 0) {
            // 完全に初期化
            resetTabScrollState(tabIndex);
            syncTabStateToGlobals(tabIndex);
        } else {
            // 既存タブの状態を初期化してからグローバル変数に反映
            initTabScrollState(tabIndex);
            const state = getTabScrollState(tabIndex);
            scrollX = state.scrollX;
            scrollY = state.scrollY;
            virtualW = state.virtualW;
            virtualH = state.virtualH;
            showHScrollBar = state.showHScrollBar;
            showVScrollBar = state.showVScrollBar;
        }
    }

    // Create new tab if processing BPK with multiple files (only for initial processing, not redraws)
    if (!isRedrawn && isProcessingBpk && currentFileIndex > 0) {
        if (typeof createNewTab === 'function') {
            createNewTab(currentFileIndex);
        }
        canvasInit(`canvas-${currentFileIndex}`);
    }

    let rawBuffer = raw.buffer;
    let data_view = new DataView( rawBuffer );

    tadRaw = new Uint8Array(raw);  // slice()を追加
    tadRawBuffer = tadRaw.buffer;
    tadDataView = new DataView( tadRawBuffer );


    let i = 0;

    while(i<1000000) {
        const nowPos = i;   
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
                const offsetRaw = data_view.getUint16(i + offsetLen,true);
                tadTextDump  += ' ' + IntToHex(Number(offsetRaw),4).replace('0x','');
                tadSeg.push(offsetRaw);
            }
            i += segLen;
            tadPerse(segID, segLen, tadSeg, nowPos);

        }else{
            const raw8Plus1 = Number(data_view.getUint16(i,true));
            const char = charTronCode(raw8Plus1);
            tadTextDump  += 'char = ( ' + IntToHex((raw8Plus1),4).replace('0x','') + ' )' + char;
            planeTextDump += char;
            P4 += char;
            i += 2;
            if (textNest > 0){
                drawText(ctx, char, textFontSize,  textCharPoint[textNest-1][0],textCharPoint[textNest-1][1] ,textCharPoint[textNest-1][2], textSpacingPitch, lineSpacingPitch, 0);
            }
        }

        textCharList[textNest-1] += P4;

        tadTextDump += '\r\n';
        tadTextDump += IntToHex((i),8).replace('0x','') + ' ';
    }
    
    // スクロールオフセットを復元
    restoreScrollOffset();
    
    // TAD処理完了後にスクロールバーを更新
    const finalState = getTabScrollState(tabIndex);
    console.debug('TAD processing completed');
    console.debug(`Final state for tab ${tabIndex}:`, finalState);
    
    updateScrollBars();
    
    // スクロールバーが必要な場合のみハンドル更新
    if ((finalState.showHScrollBar || finalState.showVScrollBar) && typeof updateScrollBarHandles === 'function') {
        setTimeout(() => {
            updateScrollBarHandles();
        }, 100);
    }
    
    // 描画内容を描画バッファ領域に保存
    saveTadFileDrawBuffer(fileIndex);
    
    // 描画コンテキストを元に戻す
    canvas = originalCanvas;
    ctx = originalCtx;
    
    // nfiles=1の場合：直接tab 0に表示
    // nfiles>=2の場合：現在のfileIndexに対応するタブに表示
    const displayTabIndex = (nfiles === 1) ? 0 : fileIndex;
    
    // タブが存在する場合のみ表示処理を実行
    if (typeof document !== 'undefined') {
        const targetCanvas = document.getElementById(`canvas-${displayTabIndex}`);
        if (targetCanvas) {
            // 初期表示時はtab 0のみ即座に描画、他のタブは遅延描画
            if (displayTabIndex === 0 && !isRedrawn) {
                // 描画バッファから表示用canvasに描画
                const state = getTabScrollState(displayTabIndex);
                renderFromTadFileDrawBuffer(fileIndex, displayTabIndex, state.scrollX, state.scrollY);
                console.debug(`*** INITIAL DISPLAY: rendering file ${fileIndex} to tab ${displayTabIndex} ***`);
            } else if (!isRedrawn) {
                // 他のタブは遅延描画（必要時にのみ描画）
                console.debug(`*** DEFERRED RENDERING: file ${fileIndex} ready for tab ${displayTabIndex} ***`);
            } else {
                // 再描画時は即座に実行
                const state = getTabScrollState(displayTabIndex);
                renderFromTadFileDrawBuffer(fileIndex, displayTabIndex, state.scrollX, state.scrollY);
            }
        }
    }
    
    console.debug(`*** TAD file ${fileIndex} processing completed ***`);
    
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
    let files;
    let reader = new FileReader();
    let tadRecord = ''
    let linkRecord = ''

    // Reset flags for new file
    isProcessingBpk = false;
    currentFileIndex = 0;
    linkRecordList = [];  // Reset linkRecordList as two-dimensional array
    linkRecordList[0] = [];  // Initialize first index for single files
    
    // 新設計：TADファイル描画バッファシステムをリセット
    tadFileCanvases = {};
    tadFileContexts = {};
    tadFileDrawBuffers = {};
    tadRawDataArray = {};
    
    console.debug('TAD file drawing system reset');
    
    canvasInit();
    
    if (event.target.files) {
        files = event.target.files;
    }else{
        files = event.dataTransfer.files;   
    }
    const fileNum  = files.length;
    tadRecord = files[0];
    for(let numLoop=0;numLoop<fileNum;numLoop++) {
        if (files[numLoop].name.includes('.000')) {
            linkRecord = files[numLoop]
            console.debug("link Record" + linkRecord)
        }
        if (numLoop === (fileNum - 1)) {
            tadRecord = files[numLoop]
            console.debug("TAD Record" + tadRecord)
        }
    }

    reader.onload = function (event) {
        const raw = new Uint8Array(reader.result);
        // console.debug(raw);
        // 新設計：単一ファイル処理（nfiles=1, fileIndex=0）
        tadDataArray(raw, false, 1, 0);
    };

    if (fileNum > 0) {
        reader.readAsArrayBuffer(tadRecord);
        document.getElementById("inputfile").value = '';
    }

}

/**
 * 描画領域拡大のメソッド
 * @param {number} left 
 * @param {number} top 
 * @param {number} right 
 * @param {number} bottom 
 */
function expandVirtualArea(left, top, right, bottom) {
    const tabIndex = getCurrentTabIndex();
    const state = getTabScrollState(tabIndex);
    let updated = false;
    
    let newVirtualW = state.virtualW;
    let newVirtualH = state.virtualH;
    
    if (right > state.virtualW) {
        newVirtualW = right + 50; // 余裕を持たせる
        updated = true;
    }
    
    if (bottom > state.virtualH) {
        newVirtualH = bottom + 50; // 余裕を持たせる
        updated = true;
    }
    
    // タブ別状態を更新
    if (updated) {
        updateTabScrollState(tabIndex, {
            virtualW: newVirtualW,
            virtualH: newVirtualH
        });
        
        // グローバル変数も同期
        virtualW = newVirtualW;
        virtualH = newVirtualH;
    }
    
    // virtualW/H が canvas サイズを超えている場合は常にスクロールバーを更新
    const needsScrollBars = newVirtualW > canvasW || newVirtualH > canvasH;
    
    if (updated || needsScrollBars) {
        updateScrollBars();
    }
}

/**
 * スクロールバーの表示状態を更新
 */
function updateScrollBars() {
    const tabIndex = getCurrentTabIndex();
    const state = getTabScrollState(tabIndex);
    
    // より厳密な判定: 1px以上の差がある場合のみ表示
    const newShowHScrollBar = state.virtualW > canvasW + 1;
    const newShowVScrollBar = state.virtualH > canvasH + 1;
    
    
    // 状態が変化した場合のみ更新
    if (state.showHScrollBar !== newShowHScrollBar || state.showVScrollBar !== newShowVScrollBar) {
        
        // タブ別状態を更新
        updateTabScrollState(tabIndex, {
            showHScrollBar: newShowHScrollBar,
            showVScrollBar: newShowVScrollBar
        });
        
        // グローバル変数も同期
        showHScrollBar = newShowHScrollBar;
        showVScrollBar = newShowVScrollBar;
        
        // HTMLのスクロールバー更新関数を呼び出し
        if (typeof updateScrollBarVisibility === 'function') {
            updateScrollBarVisibility();
        } else {
        }
    } else {
    }
}


/**
 * TAD保存処理
 * TODO: 未実装
 * @returns null
 */
function save() {

    // canvasを画像で保存
    console.debug("save canvas to image");
    const base64 = canvas.toDataURL("image/jpeg");
    document.getElementById("save").href = base64;   
}

// Export functions to global scope for HTML event handlers
if (typeof window !== 'undefined') {
    window.onAddFile = onAddFile;
    window.onDrop = onDrop;
    window.onDragOver = onDragOver;
    window.save = save;
    window.tadSave = save; // Alias for save function
    
    console.debug('TAD.js functions exported to global scope:', {
        onAddFile: typeof window.onAddFile,
        onDrop: typeof window.onDrop, 
        onDragOver: typeof window.onDragOver,
        save: typeof window.save,
        tadSave: typeof window.tadSave
    });
}
