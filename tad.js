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
 * TADjs Ver0.08
 *
 * BTRONのドキュメント形式である文章TAD、図形TADをブラウザ上で表示するツールです
 * @link https://github.com/satromi/tadjs
 * @author satromi@gmail.com Tw  @satromi
 * @license https://www.apache.org/licenses/LICENSE-2.0 Apache-2.0
*/


// global
let ctx;
let canvas;

// グローバル変数は関数内でローカル変数として使用

// Helper functions to check dump settings
function isTadDumpEnabled() {
    if (typeof document !== 'undefined') {
        const checkbox = document.getElementById('tad-dump-enabled');
        return checkbox ? checkbox.checked : false;
    }
    return false;
}

function isTextDumpEnabled() {
    if (typeof document !== 'undefined') {
        const checkbox = document.getElementById('text-dump-enabled');
        return checkbox ? checkbox.checked : false;
    }
    return false;
}
let currentFileIndex = 0;  // Track current file index for multiple tabs
let isProcessingBpk = false;  // Flag to indicate BPK processing
let lheadToCanvasMap = {};  // Map from LHEAD file index to actual canvas index
let textNest = 0;
let textCharList = new Array();
let textCharPoint = new Array();
let textCharData = new Array();
let textCharDirection = new Array();
let imagePoint = new Array();
let tronCodeMask = new Array();
let startTadSegment = false;
let startByImageSegment = false;

// セグメントタイプ管理用
const SEGMENT_TYPE = {
    NONE: 'none',
    TEXT: 'text',
    FIGURE: 'figure'
};
let segmentStack = [];  // セグメントタイプのスタック
let currentSegmentType = SEGMENT_TYPE.NONE;  // 現在のセグメントタイプ

// 現在のセグメントタイプを取得
function getCurrentSegmentType() {
    return currentSegmentType;
}

// セグメントタイプが文章セグメントかどうか
function isInTextSegment() {
    return segmentStack.some(seg => seg === SEGMENT_TYPE.TEXT);
}

// セグメントタイプが図形セグメントかどうか
function isInFigureSegment() {
    return segmentStack.some(seg => seg === SEGMENT_TYPE.FIGURE);
}

// 直接の親が文章セグメントかどうか
function isDirectTextSegment() {
    return currentSegmentType === SEGMENT_TYPE.TEXT;
}

// 直接の親が図形セグメントかどうか
function isDirectFigureSegment() {
    return currentSegmentType === SEGMENT_TYPE.FIGURE;
}
let tabCharNum = 4;
let tabRulerLinePoint = 0;
let tabRulerLineMove = 0;
let tabRulerLinePos = 0;
let tabRulerLineMoveCount = 0;
let tabRulerLineMovePoint = new Array();
let tabRulerLineMoveFlag = false;
let colorPattern = []; // 配列として初期化
let groupList = new Array();

// フォント設定
let textFontSize = 9.6;
let textFontSet = textFontSize + 'px serif';
let textFontStyle = 'normal';
let textFontWeight = 400;
let textFontStretch = 'normal';
let textScaleX = 1.0;
let textSkewAngle = 0;
let fontDirection = 0;  // 0:横書き, 1:縦書き（フォント属性用）
let textStrokeStyle = 'none';  // 線種（none, outline）
let textShadowStyle = 'none';  // 影（none, black, white）
let textFontColor = '#000000';

// 図形設定
let drawLineColor = '#000000';
let drawLineWidth = 1;
let drawFillColor = '#FFFFFF';
let backgroundColor = '#FFFFFF';
let colorMap = new Array();

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
let tadTextDumpBuffer = ['00000000 '];
let planeTextDumpBuffer = [];
let tadTextDump = '00000000 ';
let planeTextDump = '';
let tadPos = 0;
let tadRecordDataArray = [];

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

// 行バッファリング用変数
let currentLineOffset = 0;  // 現在行の揃えオフセット

// リンクレコード対応
let linkRecordList = new Array(); // リンクレコードリスト
let execFuncRecordList = new Array(); // 実行機能付箋レコードリスト
let linkNo = 0;


let tadDpiH = 72;
let tadDpiV = 72;
let tadDpiHFlag = false;
let tadDpiVFlag = false;

// 文字修飾状態管理
let textDecorations = {
    underline: null,
    overline: null,
    strikethrough: null,
    box: null,
    invert: null,
    mesh: null,
    background: null,
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
    noprint: []
};

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

let LOCALHEADSIZE = 96;

let canvasW = 1200;
let canvasH = 1000;
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
 * フォント設定を更新
 */
function updateFontSettings() {
    // フォント文字列を構築
    let fontParts = [];
    
    if (textFontStyle !== 'normal') {
        fontParts.push(textFontStyle);
    }
    if (textFontWeight !== 400) {
        fontParts.push(textFontWeight);
    }
    if (textFontStretch !== 'normal') {
        fontParts.push(textFontStretch);
    }
    
    fontParts.push(textFontSize + 'px');
    fontParts.push('serif');
    
    textFontSet = fontParts.join(' ');
    
    console.debug(`Font updated: ${textFontSet}`);
}

/**
 * 各TADファイル(nfiles)ごとのcanvasを生成
 * @param {number} fileIndex ファイルインデックス
 * @param {number} width canvas幅
 * @param {number} height canvas高さ
 */
function createTadFileCanvas(fileIndex, width = 1200, height = 1200) {
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
}

/**
 * Canvas描画前のスクロールオフセット適用
 */
function applyScrollOffset(targetCtx) {
    if (targetCtx) {
        const tabIndex = getCurrentTabIndex();
        const state = getTabScrollState(tabIndex);
        targetCtx.save();
        targetCtx.translate(-state.scrollX, -state.scrollY);
    }
}

/**
 * Canvas描画後のスクロールオフセット復元
 */
function restoreScrollOffset(targetCtx) {
    if (targetCtx) {
        targetCtx.restore();
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
        this.fgcolArray = new Array(); // COLOR()配列
        this.bgcol = new COLOR(); // COLORのみ
        this.mask = new Array(); // UH[]
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
        this.cinfo = new Array();
        this.extlen = 0; // UW
        this.extend = 0; // UW
        this.mask = 0; // UW
        this.compac = 0; // H
        this.planes = 0; // H
        this.pixbits = 0; // H
        this.rowbytes = 0; // H
        this.bounds = new RECT();
        this.base_off = new Array(); // UW
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
        this.data = new Array();  // UB[]
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
        this.margin = new Array(); // マージン
    }
}

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

let GHEAD = new GlobalHead();
let LHEAD = [];

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
    //console.debug("UB_SubID" + SubID);
    return SubID;
}

/**
 * UHからUB ATTRを取得
 * @param {UH} UH 
 * @returns 
 */
function getLastUBinUH(UH) {
    const ATTR = ( UH & 0b00000011);
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
        
        // Check if LH5Decoder is properly initialized with fileData
        if (!lh5Decoder.fileData || !lh5Decoder.initialized) {
            // Try to initialize LH5Decoder dynamically if raw data is available
            if (tadRawDataArray[currentFileIndex]) {
                console.debug(`Attempting dynamic LH5 decoder initialization for currentFileIndex=${currentFileIndex}`);
                try {
                    lh5Decoder.init(tadRawDataArray[currentFileIndex], tadPos, GHEAD.compSize, GHEAD.origSize);
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
function pass2(LHEAD) {
    // Create file info
    const finfoPath = 'file.inf';
    let finfoContent = 'No: f_type, name\\n';
    
    // Set BPK processing flag if multiple files
    if (GHEAD.nfiles > 1) {
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
    for (let i = 0; i < GHEAD.nfiles; i++) {
        console.debug(`Processing file ${i}, GHEAD.nfiles=${GHEAD.nfiles}`);
        const lhead = LHEAD[i];
        const fileName = lhead.name;
        finfoContent += `${i}: 0${lhead.f_type.toString(8)}, ${fileName}\\n`;
        
        // Create record info
        const recInfoPath = `${i}/rec.inf`;
        let recInfoContent = 'No: type, subtype\\n';
        
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
            
            recInfoContent += `${j}: ${rhead.type}, ${rhead.subtype}\\n`;
            
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
                lheadToCanvasMap[i] = tadFileIndex;

                // TADデータを配列に保存（ファイルインデックスと共に）                
                try {
                    tadRecordDataArray.push({
                        fileIndex: i,
                        data: recordData
                    });
                } catch (error) {
                    console.error(`=== ERROR STORING TAD RECORD ===`);
                    console.error(`Error storing LHEAD[${i}] (${LHEAD[i].name}):`, error);
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
                
            } else {
                // Other record types (type !== 0 && type !== 1 && type !== 8)
                // 他のタイプのレコード（画像など）は読み飛ばす
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

    for (let i = 0; i < tadRecordDataArray.length; i++) {
        const record = tadRecordDataArray[i];

        // lheadToCanvasMapで使用されるtadFileIndexを取得
        // tadRecord.fileIndexがLHEADのインデックスなので、それを使ってtadFileIndexを取得
        const lheadIndex = record.fileIndex;
        const tadFileIndex = lheadToCanvasMap[lheadIndex];
        const nfiles = (typeof GHEAD !== 'undefined' && GHEAD.nfiles) ? GHEAD.nfiles : 1;


        if (tadFileIndex !== undefined) {
            // 現在のファイルインデックスを設定してからtadDataArrayを呼び出す
            currentFileIndex = tadFileIndex;
            tadDataArray(record.data, false, nfiles, currentFileIndex, false);
            console.debug(`Completed tadDataArray processing for tadFileIndex ${tadFileIndex}`);
        } else {
            console.debug(`Warning: No tadFileIndex mapping found for LHEAD[${lheadIndex}] during processing`);
        }
    }
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
    
    // セグメントスタックに文章セグメントを追加
    segmentStack.push(SEGMENT_TYPE.TEXT);
    currentSegmentType = SEGMENT_TYPE.TEXT;
    
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

    console.debug(`view: left=${textChar.view.left}, top=${textChar.view.top}, right=${viewW}, bottom=${viewH}`);
    console.debug(`draw: left=${textChar.draw.left}, top=${textChar.draw.top}, right=${drawW}, bottom=${drawH}`);
    console.debug(`h_unit ${textChar.h_unit}, v_unit ${textChar.v_unit}, lang ${textChar.lang}, bgpat ${textChar.bpat}`);

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
function drawText(targetCtx, targetCanvas, char, textfontSize, startX, startY, width, textPitch, linePitch, align) {
    // パラメータとして受け取ったcanvasとctxを使用
    if (!targetCtx || !targetCanvas) {
        console.error('ctx and canvas must be provided as parameters in drawText');
        return;
    }
    
    // ローカル変数として設定
    const ctx = targetCtx;
    const canvasElement = targetCanvas;
    
    if (canvasElement.width < width ) {
        width = canvasElement.width;
    } else if (width < 10) {
        width = canvasElement.width;
    }

    const lineHeight = textfontSize * linePitch;

    if (lineMaxHeight.length == 0) {
        lineMaxHeight.push(lineHeight);
    }

    if (lineMaxHeight[textRow] < lineHeight) {
        lineMaxHeight[textRow] = lineHeight;
    }

    // ctxの最終確認とフォント設定を適用
    if (!ctx) {
        console.error('ctx is still undefined in drawText after parameter assignment. targetCtx was:', targetCtx);
        return;
    }
    
    ctx.fillStyle = textFontColor;
    ctx.font = textFontSet;
    ctx.textBaseline = "alphabetic";  // ベースライン基準に変更
    ctx.textAlign = "left"; // 常に左揃えで描画し、位置は手動計算

    // 折り返し処理
    if (ctx.measureText(char).width + textWidth > width) {
        textHeight += lineMaxHeight[textRow];
        textRow++;
        lineMaxHeight.push(linePitch);
        textWidth = 0;
        textColumn = 0;
        currentLineOffset = 0; // 行オフセットをリセット
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
        lineMaxHeight.push(linePitch);
        textWidth = 0;
        textColumn = 0;
        if (tabRulerLineMoveFlag == true) {
            tabRulerLineMoveFlag = false;
        }
    // 改行処理
    } else if (char == String.fromCharCode(Number(TC_CR))) {
        textHeight += lineMaxHeight[textRow];
        textRow++;
        lineMaxHeight.push(linePitch);
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
        lineMaxHeight.push(linePitch);
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
        // シンプルな位置計算
        const charY = startY + textHeight + textfontSize;  // シンプルな文字位置
        const charWidth = ctx.measureText(char).width;
        let charX = 0 + padding + startX + textWidth;
        
        // 左揃えの基本位置を計算（文字間隔の基準）
        const baseCharX = startX + textWidth;
        
        // 行の開始時（textWidth === 0）に行開始位置を決定
        if (textWidth === 0) {
            if (textAlign === 1) {
                // 中央揃え: 現在の文字幅を基に行幅を推定
                // 平均的な行の文字数を20文字と仮定
                const estimatedLineWidth = Math.min(charWidth * 20, width * 0.8);
                currentLineOffset = (width - estimatedLineWidth) / 2;
            } else if (textAlign === 2) {
                // 右揃え: 現在の文字幅を基に行幅を推定
                const estimatedLineWidth = Math.min(charWidth * 20, width * 0.8);
                currentLineOffset = width - estimatedLineWidth;
            } else {
                // 左揃え: オフセットなし
                currentLineOffset = 0;
            }
        }
        
        // 固定された行開始位置 + 左揃えと同じ文字間隔
        charX = startX + currentLineOffset + textWidth;
        
        // textAlign === 3,4 (両端揃え、均等揃え) は後で実装
        
        // 反転装飾の背景を文字描画前に描画
        if (textDecorations.invert) {
            ctx.save();
            const currentTextColor = textFontColor || '#000000';
            const padding = 2;
            const charHeight = textfontSize * 1.2;
            // ベースライン基準で背景位置を調整
            const top = charY - textfontSize * 0.8;
            
            // 文字の背景を文字色で塗りつぶす
            ctx.fillStyle = currentTextColor;
            ctx.fillRect(charX - padding, top, charWidth + padding * 2, charHeight);
            ctx.restore();
        }
        
        // 無印字チェック
        let shouldPrintChar = true;
        if (textDecorations.noprint) {
            shouldPrintChar = false;  // 文字は印字しない（スペースは確保）
        }
        
        // 文字を描画（無印字でない場合のみ）
        if (shouldPrintChar) {
            ctx.save();  // 変形効果のために保存
            
            // 変形効果を適用
            if (textScaleX !== 1.0 || textSkewAngle !== 0) {
                // skew変換を適用する際、原点を文字の位置に移動してから変換
                ctx.translate(charX, charY);
                ctx.transform(textScaleX, 0, Math.tan(textSkewAngle * Math.PI / 180), 1, 0, 0);
                ctx.translate(-charX, -charY);
            }
            
            // 影の設定
            if (textShadowStyle !== 'none') {
                if (textShadowStyle === 'black') {
                    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
                    ctx.shadowBlur = 2;
                    ctx.shadowOffsetX = 2;
                    ctx.shadowOffsetY = 2;
                } else if (textShadowStyle === 'white') {
                    ctx.shadowColor = 'rgba(255, 255, 255, 0.8)';
                    ctx.shadowBlur = 3;
                    ctx.shadowOffsetX = 1;
                    ctx.shadowOffsetY = 1;
                }
            }
            
            // 反転装飾が有効かチェック
            let actualTextColor = textFontColor;
            if (textDecorations.invert) {
                // 反転装飾の場合、文字色を背景色に変更
                actualTextColor = backgroundColor || '#ffffff';
            }
            
            // 添え字処理
            let actualCharX = charX;
            let actualCharY = charY;
            let savedFontSet = textFontSet;
            
            if (subscriptState.active) {
                // フォントサイズを調整
                const subscriptFontSize = textFontSize * subscriptState.fontSize;
                ctx.font = subscriptFontSize + 'px serif';
                
                // 位置調整
                if (subscriptState.type === 0) {
                    // 下付き
                    actualCharY += textFontSize * 0.3;
                } else if (subscriptState.type === 1) {
                    // 上付き
                    actualCharY -= textFontSize * 0.3;
                }
                
                // 左右位置調整（文字単位の場合）
                if (subscriptState.unit === 1) {
                    if (subscriptState.targetPosition === 1) {
                        // 左寄せ
                        actualCharX -= charWidth * 0.2;
                    }
                }
            }
            
            // 袋文字の処理
            if (textStrokeStyle === 'outline') {
                ctx.strokeStyle = actualTextColor;
                ctx.lineWidth = 1;
                ctx.strokeText(char, actualCharX, actualCharY);
                ctx.fillStyle = actualTextColor === textFontColor ? 'white' : actualTextColor;
                ctx.fillText(char, actualCharX, actualCharY);
                ctx.fillStyle = textFontColor;  // 元の色に戻す
            } else {
                ctx.fillStyle = actualTextColor;
                ctx.fillText(char, actualCharX, actualCharY);
                ctx.fillStyle = textFontColor;  // 元の色に戻す
            }
            
            // 添え字の場合フォントを戻す
            if (subscriptState.active) {
                ctx.font = savedFontSet;
            }
            
            ctx.restore();  // 変形効果と影の設定を復元
        }
        
        // アクティブな装飾がある場合、その範囲を更新
        Object.keys(textDecorations).forEach(type => {
            if (textDecorations[type]) {
                // 装飾が有効な場合、現在の文字位置を更新
                const ranges = decorationRanges[type];
                if (ranges.length > 0 && !ranges[ranges.length - 1].end) {
                    // 継続中の装飾の位置を更新
                    const currentRange = ranges[ranges.length - 1];
                    currentRange.currentX = textWidth + charWidth * (1 + textPitch);
                    currentRange.currentY = textHeight;
                }
            }
        });
        
        textWidth += charWidth * (1 + textPitch);
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
    
    // セグメントスタックから文章セグメントを削除
    if (segmentStack.length > 0 && segmentStack[segmentStack.length - 1] === SEGMENT_TYPE.TEXT) {
        segmentStack.pop();
    }
    // 現在のセグメントタイプを更新
    currentSegmentType = segmentStack.length > 0 ? segmentStack[segmentStack.length - 1] : SEGMENT_TYPE.NONE;

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

    // PaperSizeクラスのインスタンスを作成（まだ存在しない場合）
    if (paperSize === null) {
        paperSize = new PaperSize();
    }

    const ATTR = getLastUBinUH(tadSeg[0]);

    // 綴じ方向と面付け指定を設定
    if (ATTR === Number(0x00)) {
        paperSize.binding = 0; // 用紙綴じ方向 0:左綴じ
        paperSize.imposition = 0; // 用紙面付け指定 0:1面付け
    } else if (ATTR === Number(0x01)) {
        paperSize.binding = 0; // 用紙綴じ方向 0:左綴じ
        paperSize.imposition = 1; // 用紙面付け指定 1:2面付け
    } else if (ATTR === Number(0x02)) {
        paperSize.binding = 1; // 用紙綴じ方向 1:右綴じ
        paperSize.imposition = 0; // 用紙面付け指定 0:1面付け
    } else if (ATTR === Number(0x03)) {
        paperSize.binding = 1; // 用紙綴じ方向 1:右綴じ
        paperSize.imposition = 1; // 用紙面付け指定 1:2面付け
    }

    console.debug("length " + IntToHex((tadSeg[1]),4).replace('0x',''));
    console.debug("width  " + IntToHex((tadSeg[2]),4).replace('0x',''));
    console.debug(`Paper bounds: left=${IntToHex((tadSeg[5]),4).replace('0x','')}, top=${IntToHex((tadSeg[3]),4).replace('0x','')}, right=${IntToHex((tadSeg[6]),4).replace('0x','')}, bottom=${IntToHex((tadSeg[4]),4).replace('0x','')}`);

    // 用紙サイズと余白をPaperSizeクラスに設定
    paperSize.length = Number(tadSeg[1]);
    paperSize.width = Number(tadSeg[2]);
    paperSize.top = Number(tadSeg[3]);
    paperSize.bottom = Number(tadSeg[4]);
    paperSize.left = Number(tadSeg[5]);
    paperSize.right = Number(tadSeg[6]);
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

    // PaperMarginクラスのインスタンスを作成（まだ存在しない場合）
    if (paperMargin === null) {
        paperMargin = new PaperMargin();
    }

    console.debug(`Margin bounds: left=${IntToHex((tadSeg[3]),4).replace('0x','')}, top=${IntToHex((tadSeg[1]),4).replace('0x','')}, right=${IntToHex((tadSeg[4]),4).replace('0x','')}, bottom=${IntToHex((tadSeg[2]),4).replace('0x','')}`);

    // マージンをPaperMarginクラスに設定
    paperMargin.top = Number(tadSeg[1]);
    paperMargin.bottom = Number(tadSeg[2]);
    paperMargin.left = Number(tadSeg[3]);
    paperMargin.right = Number(tadSeg[4]);

    // PaperSizeクラスのmarginプロパティにも設定（関連付け）
    if (paperSize !== null) {
        paperSize.margin = paperMargin;
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

    //0:左揃え, 1:中央揃え, 2:右揃え, 3:両端揃え, 4:均等揃え
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
    console.debug("行頭移動指定付箋セット :" + textColumn);
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
    
    // スペーシング設定
    // TODO: 固定ピッチと比例ピッチの違いをどう扱うか要検討
    // if (spacing === 1) {
    //     // 比例ピッチ
    //     textSpacingPitch = 1.0;  // 比例ピッチモード
    // } else {
    //     // 固定ピッチ
    //     textSpacingPitch = 1.2;  // 固定ピッチモード（デフォルト）
    // }
    
    // 方向設定
    fontDirection = direction;  // 0:横書き, 1:縦書き
    
    // 線種設定（袋文字、影付き等）
    let strokeStyle = 'none';
    let shadowStyle = 'none';
    switch (lineType) {
        case 0: // 通常
            strokeStyle = 'none';
            shadowStyle = 'none';
            break;
        case 1: // 袋文字
            strokeStyle = 'outline';
            shadowStyle = 'none';
            break;
        case 2: // 影付き袋文字
            strokeStyle = 'outline';
            shadowStyle = 'black';
            break;
        case 3: // 白影付き袋文字（立体）
            strokeStyle = 'outline';
            shadowStyle = 'white';
            break;
        default:
            strokeStyle = 'none';
            shadowStyle = 'none';
    }
    
    // 斜体設定
    let fontStyle = 'normal';
    let skewAngle = 0;
    switch (italic) {
        case 1: // 水平斜体弱
            fontStyle = 'italic';
            skewAngle = -10;
            break;
        case 2: // 水平斜体中
            fontStyle = 'italic';
            skewAngle = -15;
            break;
        case 3: // 水平斜体強
            fontStyle = 'italic';
            skewAngle = -20;
            break;
        case 5: // 垂直斜体弱
            fontStyle = 'oblique 10deg';
            break;
        case 6: // 垂直斜体中
            fontStyle = 'oblique 15deg';
            break;
        case 7: // 垂直斜体強
            fontStyle = 'oblique 20deg';
            break;
        default:
            fontStyle = 'normal';
    }
    
    // 太さ設定
    let fontWeight = 400;  // normal
    switch (weight) {
        case 0: fontWeight = 400; break;  // 中字
        case 1: fontWeight = 100; break;  // 極細字
        case 2: fontWeight = 300; break;  // 細字
        case 4: fontWeight = 500; break;  // 中太字
        case 5: fontWeight = 700; break;  // 太字
        case 6: fontWeight = 800; break;  // 極太字
        case 7: fontWeight = 900; break;  // 超太字
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
    
    // グローバル変数に設定を反映
    textFontStyle = fontStyle;
    textFontWeight = fontWeight;
    textFontStretch = fontStretch;
    textScaleX = scaleX;
    textSkewAngle = skewAngle;
    textStrokeStyle = strokeStyle;
    textShadowStyle = shadowStyle;
    
    // フォント設定を更新
    updateFontSettings();
    
    console.debug(`Font type set - spacing:${spacing}, direction:${direction}, lineType:${lineType}, italic:${italic}, weight:${weight}, width:${width}`);
    console.debug(`Applied - style:${fontStyle}, weight:${fontWeight}, stretch:${fontStretch}, scaleX:${scaleX}, stroke:${strokeStyle}, shadow:${shadowStyle}`);
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
        updateFontSettings(); // フォント設定を更新
    } else if (tadSeg[1] & U1) {
        console.debug("Qsize   " + tadSize);
        textFontSize = (tadSeg[1] & sizeMask) / (20 * 0.3528);
        updateFontSettings(); // フォント設定を更新
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
        // TODO
    } else if (UB_SubID === Number(0x07)) {
        console.debug("ルビ終了指定付箋");
        // TODO
    } else if (UB_SubID === Number(0x08)) {
        console.debug("行頭禁則指定付箋");
        // TODO
    } else if (UB_SubID === Number(0x09)) {
        console.debug("行末禁則指定付箋");
        // TODO
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
    let lineType = '';
    if (UB_SubID === 0x00) {
        lineType = 'underline';
    } else if (UB_SubID === 0x02) {
        lineType = 'overline';
    } else if (UB_SubID === 0x04) {
        lineType = 'strikethrough';
    } else if (UB_SubID === 0x06) {
        lineType = 'box';
    } else if (UB_SubID === 0x0C) {
        lineType = 'invert';
    } else if (UB_SubID === 0x0E) {
        lineType = 'mesh';
    } else if (UB_SubID === 0x10) {
        lineType = 'background';
    } else if (UB_SubID === 0x12) {
        lineType = 'noprint';
    } else {
        return;
    }
    
    // ATTRを解析
    const attr = getLastUBinUH(tadSeg[0]);
    let lineStyle = { type: lineType };

    // 線の色を取得
    let color = textFontColor;  // デフォルト色は現在の文字色
    if (segLen >= 6) {
        const colorValue = uh2uw([tadSeg[2], tadSeg[1]])[0];
        const parsedColor = parseColor(colorValue);
        color = (typeof parsedColor === 'object' && parsedColor.color) ? parsedColor.color : parsedColor;
        }
    
    if (lineType === 'invert') {
        // 反転の場合: Axxxxxxxビットフィールド
        const area = (attr & 0x80) >> 7;  // A: 0=文字領域+文字間, 1=文字領域+文字間+行間
        lineStyle = {
            type: lineType,
            area: area
        };
    } else if (lineType === 'mesh' || lineType === 'background') {
        // 網掛け・背景の場合: AIDDKKKKビットフィールド
        const area = (attr & 0x80) >> 7;       // A: 0=文字領域+文字間, 1=文字領域+文字間+行間
        const coarse = (attr & 0x40) >> 6;     // I: 0=標準, 1=粗い
        const density = (attr & 0x30) >> 4;    // D: 0=なし, 1=薄, 2=中, 3=濃
        const pattern = attr & 0x0F;           // K: 0=均等, 1=縦, 2=横
        
        lineStyle = {
            type: lineType,
            area: area,
            coarse: coarse === 1,
            density: density,
            pattern: pattern,
            color: color
        };
    } else if (lineType === 'noprint') {
        // 無印字の場合: 特別な処理は不要
        lineStyle = { type: lineType };
    } else {

        // 従来の線系装飾の場合: DIWWKKKKビットフィールド
        const doubleLines = (attr & 0x80) >> 7;  // D: 線の本数 (0:一本, 1:二本)
        const intensity = (attr & 0x40) >> 6;     // I: 線の濃さ (0:100%, 1:50%)
        const width = (attr & 0x30) >> 4;         // W: 線の太さ (0:なし, 1:細線, 2:中線, 3:太線)
        const style = attr & 0x0F;                // K: 線の種類
        

        
        lineStyle = {
            type: lineType,
            doubleLines: doubleLines === 1,
            intensity: intensity === 0 ? 1.0 : 0.5,
            width: width === 0 ? 1 : width,
            style: getLineStylePattern(style),
            color: color
        };
    }
    
    // 現在のテキスト位置を記録
    textDecorations[lineType] = lineStyle;
    
    const currentPos = {
        x: textWidth,
        y: textHeight,
        startX: textWidth,
        fontSize: textFontSize
    };
    
    decorationRanges[lineType].push({
        start: currentPos,
        end: null,
        style: lineStyle,
        currentX: textWidth,
        currentY: textHeight
    });
    
    console.debug(`${lineType} started - double:${lineStyle.doubleLines}, intensity:${lineStyle.intensity}, width:${lineStyle.width}, style:${lineStyle.style}, color:${lineStyle.color}`);
}

/**
 * 文字修飾指定付箋の線終了を処理
 * @param {*} segLen 
 * @param {*} tadSeg 
 * @param {*} UB_SubID 
 */
function tadTextStyleLineEnd(segLen, tadSeg, UB_SubID) {
    // 装飾タイプを判定
    let lineType = '';
    if (UB_SubID === 0x01) {
        lineType = 'underline';
    } else if (UB_SubID === 0x03) {
        lineType = 'overline';
    } else if (UB_SubID === 0x05) {
        lineType = 'strikethrough';
    } else if (UB_SubID === 0x07) {
        lineType = 'box';
    } else if (UB_SubID === 0x0D) {
        lineType = 'invert';
    } else if (UB_SubID === 0x0F) {
        lineType = 'mesh';
    } else if (UB_SubID === 0x11) {
        lineType = 'background';
    } else if (UB_SubID === 0x13) {
        lineType = 'noprint';
    } else {
        return;
    }
    
    if (decorationRanges[lineType].length > 0) {
        const range = decorationRanges[lineType][decorationRanges[lineType].length - 1];
        if (range && !range.end) {
            // 現在の位置を終了位置として記録
            range.end = {
                x: range.currentX || textWidth,
                y: range.currentY || textHeight
            };
            
            // 装飾を描画
            drawTextDecoration(lineType, range);
            
            console.debug(`${lineType} ended at position (${range.end.x}, ${range.end.y})`);
        }
    }
    
    textDecorations[lineType] = null;
}

/**
 * 線種類のパターンを取得
 * @param {number} style - 線の種類コード
 * @returns {string} Canvas用の線スタイル
 */
function getLineStylePattern(style) {
    switch(style) {
        case 0: return 'solid';      // 実線
        case 1: return 'dashed';     // 破線
        case 2: return 'dotted';     // 点線
        case 3: return 'dash-dot';   // 一点鎖線
        case 4: return 'dash-dot-dot'; // 二点鎖線
        case 5: return 'long-dash';  // 長破線
        case 6: return 'wavy';       // 波線
        default: return 'solid';
    }
}

/**
 * 文字装飾を描画
 * @param {string} type - 装飾タイプ
 * @param {Object} range - 装飾範囲
 */
function drawTextDecoration(type, range) {
    const style = range.style;
    const startX = range.start.startX;
    const endX = range.end.x;
    // シンプルな位置計算
    const fontSize = range.start.fontSize || textFontSize;
    let y = range.start.y;  // シンプルな位置
    
    // Canvas設定を保存
    ctx.save();
    
    // 線のスタイル設定
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.width;
    ctx.globalAlpha = style.intensity;
    
    // 線種の設定
    setLinePattern(style.style);
    
    // 枠囲み線の場合は四角形を描画
    if (type === 'box') {
        // テキストの上下左右に余白を持たせた枠を描画
        const padding = 2;
        // シンプルな枠の位置計算
        const top = y - padding;
        const bottom = y + range.start.fontSize + padding;
        const left = startX - padding;
        const right = endX + padding;
        
        // 枠を描画
        ctx.beginPath();
        ctx.rect(left, top, right - left, bottom - top);
        ctx.stroke();
        
        // 二重枠の場合
        if (style.doubleLines) {
            const offset = style.width + 2;
            ctx.beginPath();
            ctx.rect(left - offset, top - offset, 
                    right - left + offset * 2, 
                    bottom - top + offset * 2);
            ctx.stroke();
        }
    } else if (type === 'invert') {
        // 反転の場合
        drawInvertDecoration(range);
    } else if (type === 'mesh') {
        // 網掛の場合
        drawMeshDecoration(range);
    } else if (type === 'background') {
        // 背景の場合
        drawBackgroundDecoration(range);
    } else if (type === 'noprint') {
        // 無印字の場合（実際の描画処理は文字描画時に行う）
        // ここでは何もしない
    } else {
        // 通常の線装飾の位置を計算（シンプル）
        switch(type) {
            case 'underline':
                y += range.start.fontSize;  // 文字の下
                break;
            case 'overline':
                // そのまま文字の上
                break;
            case 'strikethrough':
                y += range.start.fontSize * 0.5;  // 文字の中央
                break;
        }
        
        // 線を描画
        ctx.beginPath();
        ctx.moveTo(startX, y);
        ctx.lineTo(endX, y);
        ctx.stroke();
        
        // 二本線の場合
        if (style.doubleLines) {
            const offset = style.width + 2;
            ctx.beginPath();
            ctx.moveTo(startX, y + offset);
            ctx.lineTo(endX, y + offset);
            ctx.stroke();
        }
    }
    
    // Canvas設定を復元
    ctx.restore();
}

/**
 * 反転装飾を描画
 * @param {Object} range - 装飾範囲
 */
function drawInvertDecoration(range) {
    // 反転装飾は文字描画時に個別に処理されるため、
    // ここでは何もしない
    // 各文字の描画前に背景が描画され、文字色が変更される
}

/**
 * 網掛け装飾を描画
 * @param {Object} range - 装飾範囲
 */
function drawMeshDecoration(range) {
    const style = range.style;
    if (style.density === 0) return;  // 濃度なしの場合は描画しない
    
    const startX = range.start.startX;
    const endX = range.end.x;
    const padding = style.area === 1 ? 4 : 2;
    
    const top = range.start.y - range.start.fontSize * 0.2 - padding;
    const bottom = range.start.y + range.start.fontSize * 1.2 + padding;
    
    ctx.strokeStyle = style.color;
    ctx.lineWidth = 1;
    ctx.globalAlpha = style.density * 0.3;  // 濃度に応じた透明度
    
    const gridSize = style.coarse ? 8 : 4;  // 粗さに応じたグリッドサイズ
    
    // パターンに応じた網掛け描画
    if (style.pattern === 0) {
        // 均等（格子パターン）
        drawGridPattern(startX, top, endX - startX, bottom - top, gridSize, style.density);
    } else if (style.pattern === 1) {
        // 縦（縦線パターン）
        drawVerticalPattern(startX, top, endX - startX, bottom - top, gridSize, style.density);
    } else if (style.pattern === 2) {
        // 横（横線パターン）
        drawHorizontalPattern(startX, top, endX - startX, bottom - top, gridSize, style.density);
    }
}

/**
 * 背景装飾を描画
 * @param {Object} range - 装飾範囲
 */
function drawBackgroundDecoration(range) {
    const style = range.style;
    if (style.density === 0) return;  // 濃度なしの場合は描画しない
    
    const startX = range.start.startX;
    const endX = range.end.x;
    const padding = style.area === 1 ? 4 : 2;
    
    const top = range.start.y - range.start.fontSize * 0.2 - padding;
    const bottom = range.start.y + range.start.fontSize * 1.2 + padding;
    
    // 背景色でベースを塗る
    ctx.fillStyle = style.color;
    ctx.globalAlpha = style.density * 0.2;  // 濃度に応じた透明度
    ctx.fillRect(startX, top, endX - startX, bottom - top);
    
    // パターンを上書き
    ctx.globalAlpha = style.density * 0.4;
    const gridSize = style.coarse ? 8 : 4;
    
    if (style.pattern === 0) {
        // 均等パターン
        drawGridPattern(startX, top, endX - startX, bottom - top, gridSize, style.density);
    } else if (style.pattern === 1) {
        // 縦パターン
        drawVerticalPattern(startX, top, endX - startX, bottom - top, gridSize, style.density);
    } else if (style.pattern === 2) {
        // 横パターン
        drawHorizontalPattern(startX, top, endX - startX, bottom - top, gridSize, style.density);
    }
}

/**
 * 格子パターンを描画
 */
function drawGridPattern(x, y, width, height, gridSize, density) {
    const cols = Math.ceil(width / gridSize);
    const rows = Math.ceil(height / gridSize);
    const pointsPerCell = Math.min(density, 3);  // 1セルあたりのポイント数
    
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const cellX = x + col * gridSize;
            const cellY = y + row * gridSize;
            
            // 密度に応じてポイントを描画
            for (let p = 0; p < pointsPerCell; p++) {
                const px = cellX + (p % 2) * (gridSize / 2) + gridSize / 4;
                const py = cellY + Math.floor(p / 2) * (gridSize / 2) + gridSize / 4;
                ctx.fillRect(px, py, 1, 1);
            }
        }
    }
}

/**
 * 縦線パターンを描画
 */
function drawVerticalPattern(x, y, width, height, gridSize, density) {
    const cols = Math.ceil(width / gridSize);
    const linesPerCell = Math.min(density, 2);
    
    for (let col = 0; col < cols; col++) {
        for (let line = 0; line < linesPerCell; line++) {
            const lineX = x + col * gridSize + line * (gridSize / 2);
            ctx.beginPath();
            ctx.moveTo(lineX, y);
            ctx.lineTo(lineX, y + height);
            ctx.stroke();
        }
    }
}

/**
 * 横線パターンを描画
 */
function drawHorizontalPattern(x, y, width, height, gridSize, density) {
    const rows = Math.ceil(height / gridSize);
    const linesPerCell = Math.min(density, 2);
    
    for (let row = 0; row < rows; row++) {
        for (let line = 0; line < linesPerCell; line++) {
            const lineY = y + row * gridSize + line * (gridSize / 2);
            ctx.beginPath();
            ctx.moveTo(x, lineY);
            ctx.lineTo(x + width, lineY);
            ctx.stroke();
        }
    }
}

/**
 * 線パターンを設定
 * @param {string} pattern - 線のパターン
 */
function setLinePattern(pattern) {
    switch(pattern) {
        case 'dashed':
            ctx.setLineDash([6, 3]);
            break;
        case 'dotted':
            ctx.setLineDash([2, 2]);
            break;
        case 'dash-dot':
            ctx.setLineDash([8, 3, 2, 3]);
            break;
        case 'dash-dot-dot':
            ctx.setLineDash([8, 3, 2, 3, 2, 3]);
            break;
        case 'long-dash':
            ctx.setLineDash([12, 4]);
            break;
        case 'wavy':
            // 波線は別途実装が必要
            ctx.setLineDash([]);
            break;
        default:
            ctx.setLineDash([]);
    }
}

/**
 * 線属性(l_atr)を適用
 * @param {number} l_atr - 線属性値 (上位8ビット: 線種, 下位8ビット: 線幅)
 * @returns {Object} 元の線設定を返す（復元用）
 */
function applyLineAttribute(l_atr) {
    // 元の設定を保存
    const oldSettings = {
        lineWidth: ctx.lineWidth,
        lineDash: ctx.getLineDash(),
        drawLineWidth: drawLineWidth
    };
    
    // 線幅（下位8ビット）
    const lineWidth = l_atr & 0xFF;
    
    // 線幅が0の場合は何も描画しない
    if (lineWidth === 0) {
        ctx.lineWidth = 0;
        drawLineWidth = 0;
        return oldSettings;
    }
    
    // 線幅を設定（線幅>1の場合は右下方向に太くなる効果を追加）
    ctx.lineWidth = lineWidth;
    drawLineWidth = lineWidth;
    
    // 線種（上位8ビット）
    const lineType = (l_atr >> 8) & 0xFF;
    
    // 線種パターンを適用
    if (linePatternDefinitions[lineType]) {
        ctx.setLineDash(linePatternDefinitions[lineType]);
    } else {
        // 未定義の線種は実線として扱う
        ctx.setLineDash([]);
    }
    
    // 線幅が1より大きい場合、右下方向のオフセット効果のためにシャドウを使用
    if (lineWidth > 1) {
        ctx.shadowColor = 'transparent';
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        // 必要に応じて線の描画位置を微調整
    }
    
    return oldSettings;
}

/**
 * 線属性設定を復元
 * @param {Object} oldSettings - applyLineAttributeで返された設定
 */
function restoreLineAttribute(oldSettings) {
    if (oldSettings) {
        ctx.lineWidth = oldSettings.lineWidth;
        ctx.setLineDash(oldSettings.lineDash);
        drawLineWidth = oldSettings.drawLineWidth;
        // シャドウ設定をリセット
        ctx.shadowColor = 'transparent';
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
    }
}

// 画像セグメントリスト
let imageSegments = [];

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
    imageSeg.h_unit = uh2h(tadSeg[8]);
    imageSeg.v_unit = uh2h(tadSeg[9]);
    
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
    
    // 画像セグメントをリストに追加
    imageSegments.push(imageSeg);
    
    // 文章セグメント内での画像の場合の処理
    if (isDirectTextSegment() || isInTextSegment()) {
        let crFlag = false;

        // 大きな画像の場合は、文字サイズに合わせて調整するのではなく、そのまま描画
        const imageWidth = imageSeg.view.right - imageSeg.view.left;
        const imageHeight = imageSeg.view.bottom - imageSeg.view.top;
        
        // 小さな画像（インライン画像）の場合のみ文字サイズに合わせる
        if (imageWidth <= textFontSize * 2 && imageHeight <= textFontSize * 2) {
            let adjustedWidth = imageWidth;
            let imageTop = imageSeg.view.top - (imageSeg.view.bottom - 1);
            let imageBottom = 1; // ベースライン
            
            if (adjustedWidth <= 0 || imageTop >= 1) {
                // 描画座標から文字サイズを推定
                const drawWidth = imageSeg.draw.right - imageSeg.draw.left;
                const drawHeight = imageSeg.draw.bottom - imageSeg.draw.top;
                if (drawHeight > 0) {
                    imageTop = -textFontSize + 1;
                    adjustedWidth = textFontSize * drawWidth / drawHeight;
                }
            }
            
            // 垂直ベースライン調整
            const imageLeft = -(adjustedWidth / 2);
            const imageRight = imageLeft + adjustedWidth;
            
            // 調整された座標を適用
            imageSeg.view.left = imageLeft;
            imageSeg.view.top = imageTop;
            imageSeg.view.right = imageRight;
            imageSeg.view.bottom = imageBottom;
            
            // テキスト位置を画像幅分進める
            textWidth += adjustedWidth;
        } else {
            // 大きな画像の処理
            
            // 現在の行に画像が収まるかチェック
            if (textWidth + imageWidth > canvasW) {
                // 画像がcanvas幅を超える場合のみ改行
                textHeight += textFontSize * lineSpacingPitch;
                textWidth = 0;
                textRow++;
                // 画像の高さを新しい行の最大高さとして設定
                const imageHeight = imageSeg.view.bottom - imageSeg.view.top;
                lineMaxHeight[textRow] = Math.max(imageHeight, textFontSize * lineSpacingPitch);
                crFlag = true;
            }
            // 画像がcanvas幅に収まる場合は改行しない
        }
        
        // 画像を描画（シンプルな位置計算）
        const imageDrawY = textHeight;
        
        drawImageSegment(imageSeg, ctx, textWidth, imageDrawY);

        // 大きな画像の場合、lineMaxHeightを更新
        if (imageWidth > textFontSize * 2 || imageHeight > textFontSize * 2) {
            if (!lineMaxHeight[textRow]) {
                lineMaxHeight[textRow] = imageHeight;
            } else if (lineMaxHeight[textRow] < imageHeight) {
                lineMaxHeight[textRow] = imageHeight;
            }
        }

        // 画像の後の位置を更新
        if (!crFlag) {
            // 未改行の場合は同じ行を継続
            textWidth += imageWidth;
        }

        // 画像描画後の仮想領域を拡張（調整された位置で計算）
        expandVirtualArea(textWidth, imageDrawY, textWidth + imageWidth, imageDrawY + imageHeight);

    } else if (isInFigureSegment()) {
        // 図形セグメント内での画像

        drawImageSegment(imageSeg, ctx, imageSeg.view.left, imageSeg.view.top);
        // 画像描画後の仮想領域を拡張
        expandVirtualArea(imageSeg.view.left, imageSeg.view.top, 
                         imageSeg.view.right, imageSeg.view.bottom);
    } else {
        // 独立した画像として描画
        drawImageSegment(imageSeg, ctx, 0, 0);
        const imageHeight = imageSeg.view.bottom - imageSeg.view.top;
        const imageWidth = imageSeg.view.right - imageSeg.view.left;
        textHeight += imageHeight;
        // 画像描画後の仮想領域を拡張
        expandVirtualArea(0, 0, imageWidth, textHeight);
    }
}

/**
 * 画像セグメントを描画する汎用関数
 * @param {IMAGESEG} imageSeg - 画像セグメントオブジェクト
 * @param {CanvasRenderingContext2D} canvasCtx - Canvas描画コンテキスト
 * @param {number} offsetX - X座標オフセット
 * @param {number} offsetY - Y座標オフセット
 */
function drawImageSegment(imageSeg, canvasCtx, offsetX = 0, offsetY = 0) {
    if (!imageSeg.bitmap && !imageSeg.imageData) {
        console.debug('No image data to draw');
        return;
    }
    
    // 実際の画像サイズはbounds座標を使用
    const actualWidth = imageSeg.bounds.right - imageSeg.bounds.left;
    const actualHeight = imageSeg.bounds.bottom - imageSeg.bounds.top;
    
    // 描画位置はview座標を使用（ただし、大きな画像の場合は実際のサイズを維持）
    const drawX = imageSeg.view.left + offsetX;
    const drawY = imageSeg.view.top + offsetY;
    
    // 描画サイズは実際の画像サイズを使用
    const drawWidth = actualWidth;
    const drawHeight = actualHeight;
        
    if (imageSeg.imageData) {
        // ImageData形式の場合
        canvasCtx.putImageData(imageSeg.imageData, drawX, drawY);
    } else if (imageSeg.bitmap) {
        // ビットマップデータから描画
        drawBitmapData(imageSeg, canvasCtx, drawX, drawY, drawWidth, drawHeight);
    }
}

/**
 * ビットマップデータを描画する汎用関数
 * @param {IMAGESEG} imageSeg - 画像セグメントオブジェクト
 * @param {CanvasRenderingContext2D} canvasCtx - Canvas描画コンテキスト
 * @param {number} x - 描画X座標
 * @param {number} y - 描画Y座標
 * @param {number} width - 描画幅
 * @param {number} height - 描画高さ
 */
function drawBitmapData(imageSeg, canvasCtx, x, y, width, height) {
    if (!imageSeg.bitmap) {
        console.debug('No bitmap data to draw');
        return;
    }
    
    console.debug(`描画開始: x=${x}, y=${y}, width=${width}, height=${height}`);
    console.debug(`bitmap type: ${typeof imageSeg.bitmap}, length: ${imageSeg.bitmap.length}`);
    
    // 基本的なUint8Array形式での描画
    const imgWidth = imageSeg.bounds.right - imageSeg.bounds.left;
    const imgHeight = imageSeg.bounds.bottom - imageSeg.bounds.top;
    
    console.debug(`画像サイズ: ${imgWidth}x${imgHeight}, pixbits=${imageSeg.pixbits}`);
    
    if (imgWidth <= 0 || imgHeight <= 0) {
        console.debug('Invalid image dimensions');
        return;
    }
    
    // ImageDataを作成
    const imageData = canvasCtx.createImageData(width, height);
    const data = imageData.data;
    
    // ビットマップデータをImageDataに変換
    for (let py = 0; py < height; py++) {
        for (let px = 0; px < width; px++) {
            const srcX = Math.floor((px / width) * imgWidth);
            const srcY = Math.floor((py / height) * imgHeight);
            const srcIndex = srcY * imgWidth + srcX;
            const destIndex = (py * width + px) * 4;
            
            const [r, g, b] = getPixelColor(imageSeg, srcIndex);
            data[destIndex] = r;         // R
            data[destIndex + 1] = g;     // G
            data[destIndex + 2] = b;     // B
            data[destIndex + 3] = 255;   // A
        }
    }
    
    canvasCtx.putImageData(imageData, x, y);
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
 * 文字装飾状態をリセット
 */
function resetTextDecorations() {
    textDecorations = {
        underline: null,
        overline: null,
        strikethrough: null,
        box: null,
        invert: null,
        mesh: null,
        background: null,
        noprint: null
    };
    decorationRanges = {
        underline: [],
        overline: [],
        strikethrough: [],
        box: [],
        invert: [],
        mesh: [],
        background: [],
        noprint: []
    };
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
function tsFig(tadSeg) {
    
    // セグメントスタックに図形セグメントを追加
    segmentStack.push(SEGMENT_TYPE.FIGURE);
    currentSegmentType = SEGMENT_TYPE.FIGURE;
    
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
        
    } else if (isInFigureSegment() > 1 && startByImageSegment == true) {
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
    if ( startByImageSegment == true && isInFigureSegment()) {
        //canvas.width = viewW;
        //canvas.height = viewH;
    }

    console.debug(`figSeg view: left=${figSeg.view.left}, top=${figSeg.view.top}, right=${figSeg.view.right}, bottom=${figSeg.view.bottom}`);
    console.debug(`figSeg draw: left=${figSeg.draw.left}, top=${figSeg.draw.top}, right=${figSeg.draw.right}, bottom=${figSeg.draw.bottom}`);

    imagePoint.push([viewX,viewY,viewW,viewH,drawX,drawY,drawW,drawH]);
}

/**
 * 図形終了 セグメントを処理
 * @param {*} tadSeg 
 */
function tsFigEnd(tadSeg) {
    // 文章セグメント内の図形の場合、lineMaxHeightを更新し位置調整
    if (isInTextSegment() || isDirectTextSegment()) {
        // 図形のサイズを取得（imagePointスタックから）
        if (imagePoint.length > 0) {
            const figInfo = imagePoint[imagePoint.length - 1];
            const figHeight = figInfo[3]; // viewH
            
            // 現在の行のlineMaxHeightを更新
            if (!lineMaxHeight[textRow]) {
                lineMaxHeight[textRow] = figHeight;
            } else if (lineMaxHeight[textRow] < figHeight) {
                lineMaxHeight[textRow] = figHeight;
            }
            
            // 図形描画位置をシンプルに設定
            const figDrawY = textHeight;
            
            // 図形描画用のオフセット情報を更新（各図形要素で使用）
            figInfo[6] = figDrawY;  // drawY位置を更新
        }
    }
    
    // セグメントスタックから図形セグメントを削除
    if (segmentStack.length > 0 && segmentStack[segmentStack.length - 1] === SEGMENT_TYPE.FIGURE) {
        segmentStack.pop();
    }
    // 現在のセグメントタイプを更新
    currentSegmentType = segmentStack.length > 0 ? segmentStack[segmentStack.length - 1] : SEGMENT_TYPE.NONE;
    
    // imagePointスタックからもポップ
    if (imagePoint.length > 0) {
        imagePoint.pop();
    }
}

/**
 * 図形要素セグメント 長方形セグメントを描画
 * @param {int} segLen 
 * @param {{0x0000[]} tadSeg 
 * @returns 
 */
/**
 * カラーパターンから線色と塗り色を設定する共通メソッド
 * @param {number} l_pat - 線パターンID
 * @param {number} f_pat - 塗りパターンID
 * @returns {object} 元の色設定（復元用）
 */
function setColorPattern(l_pat, f_pat) {
    const oldColors = {
        lineColor: drawLineColor,
        fillColor: drawFillColor,
        fillStyle: ctx.fillStyle
    };
    
    if (colorPattern.length > 0) {
        if (colorPattern[l_pat]) {
            const pattern = colorPattern[l_pat];
            // fgcolArrayが存在し、要素があることを確認
            if (pattern.fgcolArray && pattern.fgcolArray.length > 0) {
                drawLineColor = pattern.fgcolArray[0].color;
            }
        }
        if (colorPattern[f_pat]) {
            const pattern = colorPattern[f_pat];
            
            // パターンデータが存在し、有効なサイズを持つ場合
            if (pattern.patternData && pattern.hsize > 0 && pattern.vsize > 0) {
                // パターンが単色かチェック
                let isSolidColor = true;
                const firstColor = pattern.patternData[0][0];
                const differentColors = [];
                
                outer: for (let y = 0; y < pattern.vsize; y++) {
                    for (let x = 0; x < pattern.hsize; x++) {
                        const currentColor = pattern.patternData[y][x];
                        if (currentColor !== firstColor) {
                            isSolidColor = false;
                            if (differentColors.indexOf(currentColor) === -1) {
                                differentColors.push(currentColor);
                            }
                            if (differentColors.length >= 3) break outer; // 3色以上なら早期終了
                        }
                    }
                }
                
                if (isSolidColor) {
                    // 単色の場合は直接色を設定
                    if (firstColor !== null && firstColor !== undefined && firstColor !== -1) {
                        drawFillColor = firstColor;
                        ctx.fillStyle = drawFillColor;
                    } else {
                        // 透明または無効な色の場合はデフォルト色を使用
                        if (pattern.fgcolArray && pattern.fgcolArray.length > 0) {
                            drawFillColor = pattern.fgcolArray[0].color;
                        } else {
                            drawFillColor = '#000000';
                        }
                        ctx.fillStyle = drawFillColor;
                    }
                } else {
                    // パターンの場合はCanvasパターンを作成
                    console.debug(`Creating canvas pattern for pattern ${f_pat}: ${pattern.hsize}x${pattern.vsize}`);
                    const patternCanvas = document.createElement('canvas');
                    patternCanvas.width = pattern.hsize;
                    patternCanvas.height = pattern.vsize;
                    const patternCtx = patternCanvas.getContext('2d');
                    
                    // パターンキャンバスをクリア（透明にする）
                    patternCtx.clearRect(0, 0, pattern.hsize, pattern.vsize);
                    
                    // パターンデータをCanvasに描画
                    for (let y = 0; y < pattern.vsize; y++) {
                        for (let x = 0; x < pattern.hsize; x++) {
                            const color = pattern.patternData[y][x];
                            if (color !== null && color !== undefined && color !== -1) {
                                patternCtx.fillStyle = color;
                                patternCtx.fillRect(x, y, 1, 1);
                            }
                        }
                    }
                    
                    // パターンを作成して設定
                    const canvasPattern = ctx.createPattern(patternCanvas, 'repeat');
                    if (canvasPattern) {
                        ctx.fillStyle = canvasPattern;
                    } else {
                        // パターン作成に失敗した場合は最初の色を使用
                        if (pattern.fgcolArray && pattern.fgcolArray.length > 0) {
                            drawFillColor = pattern.fgcolArray[0].color;
                            ctx.fillStyle = drawFillColor;
                        }
                    }
                }
            } else {
                // パターンデータがない場合は最初の前景色を使用（単色塗りつぶし）
                if (pattern.fgcolArray && pattern.fgcolArray.length > 0) {
                    drawFillColor = pattern.fgcolArray[0].color;
                    ctx.fillStyle = drawFillColor;
                } else {
                    // 前景色もない場合はデフォルト色
                    drawFillColor = '#000000';
                    ctx.fillStyle = drawFillColor;
                }
            }
        }
    }
    
    return oldColors;
}

/**
 * 線色のみカラーパターンから設定する共通メソッド
 * @param {number} l_pat - 線パターンID
 * @returns {string} 元の線色（復元用）
 */
function setLineColorPattern(l_pat) {
    const oldLineColor = drawLineColor;
    
    if (colorPattern.length > 0 && colorPattern[l_pat]) {
        const pattern = colorPattern[l_pat];
        // fgcolArrayが存在し、要素があることを確認
        if (pattern.fgcolArray && pattern.fgcolArray.length > 0) {
            drawLineColor = pattern.fgcolArray[0].color;
        }
    }
    
    return oldLineColor;
}

function tsFigRectAngleDraw(segLen, tadSeg) {
    if (segLen < Number(0x0012)) {
        return;
    }
    const l_atr = Number(tadSeg[1]);
    const l_pat = Number(tadSeg[2]);
    const f_pat = Number(tadSeg[3]);
    const angle = Number(tadSeg[4]);
    const figX = Number(tadSeg[5]);
    const figY = Number(tadSeg[6]);
    const figW = Number(tadSeg[7]) - figX;
    const figH = Number(tadSeg[8]) - figY;

    ctx.save(); // 現在の状態を保存

    console.debug(`Rectangle attributes: l_atr=${IntToHex((tadSeg[1]),4).replace('0x','')}, l_pat=${IntToHex((tadSeg[2]),4).replace('0x','')}, f_pat=${IntToHex((tadSeg[3]),4).replace('0x','')}, angle=${IntToHex((tadSeg[4]),4).replace('0x','')}`);
    console.debug(`Rectangle bounds: left=${IntToHex((tadSeg[5]),4).replace('0x','')}, top=${IntToHex((tadSeg[6]),4).replace('0x','')}, right=${IntToHex((tadSeg[7]),4).replace('0x','')}, bottom=${IntToHex((tadSeg[8]),4).replace('0x','')}`);
    
    // 線属性を適用
    const oldLineSettings = applyLineAttribute(l_atr);
    const oldColors = setColorPattern(l_pat, f_pat);
    
    ctx.beginPath();
    ctx.rect(figX , figY, figW, figH);
    
    if (angle !== 0) {
        // 回転角度が指定されている場合は図形を回転させる
        ctx.translate(figX + figW / 2, figY + figH / 2);
        ctx.rotate((angle * Math.PI) / 180);
        ctx.translate(-(figX + figW / 2), -(figY + figH / 2));
    }
    // setColorPatternでfillStyleが設定されていない場合のみdrawFillColorを設定
    if (ctx.fillStyle === oldColors.fillStyle || !oldColors.fillStyle) {
        ctx.fillStyle = drawFillColor;
    }
    ctx.fill();
    
    // 線幅が0より大きい場合のみ枠線を描画
    if (drawLineWidth > 0) {
        ctx.strokeStyle = drawLineColor;
        ctx.stroke();
    }

    ctx.restore(); // 保存した状態に戻す
    
    drawFillColor = oldColors.fillColor;
    drawLineColor = oldColors.lineColor;
    if (oldColors.fillStyle) {
        ctx.fillStyle = oldColors.fillStyle;
    }
    
    // 線属性を復元
    restoreLineAttribute(oldLineSettings);

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
    const l_atr = Number(tadSeg[1]);
    const l_pat = Number(tadSeg[2]);
    const f_pat = Number(tadSeg[3]);
    const angle = Number(tadSeg[4]);
    const figRH = Number(tadSeg[5]);
    const figRV = Number(tadSeg[6]);
    const figX = Number(tadSeg[7]);
    const figY = Number(tadSeg[8]);
    const figW = Number(tadSeg[9]) - figX;
    const figH = Number(tadSeg[10]) - figY;

    ctx.save(); // 現在の状態を保存

    // console.debug(`RoundRect attributes: l_atr=${IntToHex((tadSeg[1]),4).replace('0x','')}, l_pat=${IntToHex((tadSeg[2]),4).replace('0x','')}, f_pat=${IntToHex((tadSeg[3]),4).replace('0x','')}, angle=${IntToHex((tadSeg[4]),4).replace('0x','')}, rh=${IntToHex((tadSeg[5]),4).replace('0x','')}, rv=${IntToHex((tadSeg[6]),4).replace('0x','')}`);
    // console.debug(`RoundRect bounds: left=${IntToHex((tadSeg[7]),4).replace('0x','')}, top=${IntToHex((tadSeg[8]),4).replace('0x','')}, right=${IntToHex((tadSeg[9]),4).replace('0x','')}, bottom=${IntToHex((tadSeg[10]),4).replace('0x','')}`);

    // 線属性を適用
    const oldLineSettings = applyLineAttribute(l_atr);
    const oldColors = setColorPattern(l_pat, f_pat);
    if (angle !== 0) {
        // 回転角度が指定されている場合は図形を回転させる
        ctx.translate(figX + figW / 2, figY + figH / 2);
        ctx.rotate((angle * Math.PI) / 180);
        ctx.translate(-(figX + figW / 2), -(figY + figH / 2));
    }

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

    // setColorPatternでfillStyleが設定されていない場合のみdrawFillColorを設定
    if (ctx.fillStyle === oldColors.fillStyle || !oldColors.fillStyle) {
        ctx.fillStyle = drawFillColor;
    }
    ctx.fill();
    
    // 線幅が0より大きい場合のみ枠線を描画
    if (drawLineWidth > 0) {
        ctx.strokeStyle = drawLineColor;
        ctx.stroke();
    }

    ctx.restore(); // 保存した状態に戻す
    
    drawFillColor = oldColors.fillColor;
    drawLineColor = oldColors.lineColor;
    if (oldColors.fillStyle) {
        ctx.fillStyle = oldColors.fillStyle;
    }
    
    // 線属性を復元
    restoreLineAttribute(oldLineSettings);

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

    const l_atr = Number(tadSeg[1]);
    const l_pat = Number(tadSeg[2]);
    const f_pat = Number(tadSeg[3]);

    console.debug(`Polygon attributes: l_atr=${IntToHex((tadSeg[1]),4).replace('0x','')}, l_pat=${IntToHex((tadSeg[2]),4).replace('0x','')}, f_pat=${IntToHex((tadSeg[3]),4).replace('0x','')}`);
    console.debug("round  " + IntToHex((tadSeg[4]),4).replace('0x',''));
    console.debug("np     " + IntToHex((tadSeg[5]),4).replace('0x',''));
    console.debug("x      " + IntToHex((tadSeg[6]),4).replace('0x',''));
    console.debug("y      " + IntToHex((tadSeg[7]),4).replace('0x',''));

    // 線属性を適用
    const oldLineSettings = applyLineAttribute(l_atr);
    // カラーパターンを設定
    const oldColors = setColorPattern(l_pat, f_pat);

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
    
    // 塗りつぶしを先に実行
    // setColorPatternでfillStyleが設定されていない場合のみdrawFillColorを設定
    if (ctx.fillStyle === oldColors.fillStyle || !oldColors.fillStyle) {
        ctx.fillStyle = drawFillColor;
    }
    ctx.fill();
    
    // 線幅が0より大きい場合のみ枠線を描画
    if (drawLineWidth > 0) {
        ctx.strokeStyle = drawLineColor;
        ctx.stroke();
    }

    // 色設定を復元
    drawLineColor = oldColors.lineColor;
    drawFillColor = oldColors.fillColor;
    if (oldColors.fillStyle) {
        ctx.fillStyle = oldColors.fillStyle;
    }
    
    // 線属性を復元
    restoreLineAttribute(oldLineSettings);

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
    
    const l_atr = Number(tadSeg[1]);
    const l_pat = Number(tadSeg[2]);
    
    console.debug(`Line attributes: l_atr=${IntToHex((tadSeg[1]),4).replace('0x','')}, l_pat=${IntToHex((tadSeg[2]),4).replace('0x','')}`);
    
    // 線属性を適用
    const oldLineSettings = applyLineAttribute(l_atr);
    // 線色のみカラーパターンを設定
    const oldLineColor = setLineColorPattern(l_pat);
    
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

    // 線幅が0より大きい場合のみ描画
    if (drawLineWidth > 0) {
        ctx.stroke();
    }
    
    // 色設定を復元
    drawLineColor = oldLineColor;
    
    // 線属性を復元
    restoreLineAttribute(oldLineSettings);
    
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
    console.debug(`Ellipse attributes: l_atr=${IntToHex((tadSeg[1]),4).replace('0x','')}, l_pat=${IntToHex((tadSeg[2]),4).replace('0x','')}, f_pat=${IntToHex((tadSeg[3]),4).replace('0x','')}, angle=${IntToHex((tadSeg[4]),4).replace('0x','')}`);
    console.debug(`Ellipse bounds: left=${IntToHex((tadSeg[5]),4).replace('0x','')}, top=${IntToHex((tadSeg[6]),4).replace('0x','')}, right=${IntToHex((tadSeg[7]),4).replace('0x','')}, bottom=${IntToHex((tadSeg[8]),4).replace('0x','')}`);

    const l_atr = Number(tadSeg[1]);
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

    const radianAngle = angle * Math.PI / 180;

    console.debug(radianAngle);
    console.debug(frameCenterX);
    console.debug(frameCenterY);
    console.debug(radiusX);
    console.debug(radiusY);

    ctx.save(); // 現在の状態を保存

    // 線属性を適用
    const oldLineSettings = applyLineAttribute(l_atr);
    const oldColors = setColorPattern(l_pat, f_pat);

    ctx.beginPath();
    ctx.ellipse(frameCenterX, frameCenterY, radiusX, radiusY, radianAngle, 0, Math.PI * 2,false);
    
    // 塗りつぶしを先に実行
    // setColorPatternでfillStyleが設定されていない場合のみdrawFillColorを設定
    if (ctx.fillStyle === oldColors.fillStyle || !oldColors.fillStyle) {
        ctx.fillStyle = drawFillColor;
    }
    ctx.fill();
    
    // 線幅が0より大きい場合のみ枠線を描画
    if (drawLineWidth > 0) {
        ctx.strokeStyle = drawLineColor;
        ctx.stroke();
    }

    ctx.restore(); // 保存した状態に戻す

    drawFillColor = oldColors.fillColor;
    drawLineColor = oldColors.lineColor;
    if (oldColors.fillStyle) {
        ctx.fillStyle = oldColors.fillStyle;
    }
    
    // 線属性を復元
    restoreLineAttribute(oldLineSettings);

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
    
    const l_atr = Number(tadSeg[1]);
    const l_pat = Number(tadSeg[2]);
    
    console.debug(`EllipticalArc attributes: l_atr=${IntToHex((tadSeg[1]),4).replace('0x','')}, l_pat=${IntToHex((tadSeg[2]),4).replace('0x','')}, angle=${IntToHex((tadSeg[3]),4).replace('0x','')}`);
    console.debug(`EllipticalArc bounds: left=${IntToHex((tadSeg[4]),4).replace('0x','')}, top=${IntToHex((tadSeg[5]),4).replace('0x','')}, right=${IntToHex((tadSeg[6]),4).replace('0x','')}, bottom=${IntToHex((tadSeg[7]),4).replace('0x','')}`);
    console.debug(`EllipticalArc points: startx=${IntToHex((tadSeg[8]),4).replace('0x','')}, starty=${IntToHex((tadSeg[9]),4).replace('0x','')}, endx=${IntToHex((tadSeg[10]),4).replace('0x','')}, endy=${IntToHex((tadSeg[11]),4).replace('0x','')}`);

    // 線属性を適用
    const oldLineSettings = applyLineAttribute(l_atr);
    // 線色のみカラーパターンを設定（楕円弧は線のみで塗りはない）
    const oldLineColor = setLineColorPattern(l_pat);

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
    
    // 線幅が0より大きい場合のみ描画
    if (drawLineWidth > 0) {
        ctx.strokeStyle = drawLineColor;
        ctx.stroke();
    }

    // 色設定を復元
    drawLineColor = oldLineColor;
    
    // 線属性を復元
    restoreLineAttribute(oldLineSettings);

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
    
    console.debug(`Polyline attributes: l_atr=${IntToHex((tadSeg[1]),4).replace('0x','')}, l_pat=${IntToHex((tadSeg[2]),4).replace('0x','')}`);
    
    // 線属性を適用
    const oldLineSettings = applyLineAttribute(l_atr);
    
    // 線色のみカラーパターンを設定
    const oldLineColor = setLineColorPattern(l_pat);

    let polyLines = new Array();
    for (let i = 0; i < np; i++) {
        let polyline = new PNT();
        polyline.x = Number(uh2h(tadSeg[5 + (i * 2)]));
        polyline.y = Number(uh2h(tadSeg[6 + (i * 2)]));
        polyLines.push(polyline);
    }

    // 線幅が0の場合は描画しない
    if (drawLineWidth > 0) {
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
    
    // 色設定を復元
    drawLineColor = oldLineColor;
    
    // 線属性を復元
    restoreLineAttribute(oldLineSettings);
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
    
    // 線属性を適用
    const oldLineSettings = applyLineAttribute(l_atr);
    const oldColors = setColorPattern(l_pat, f_pat);
    
    ctx.save(); // 状態を保存
    
    // 曲線を描画
    if (type === 0) {
        // 折れ線
        drawPolylineCurve(points, isClosed);
    } else if (type === 1) {
        // 3次B-スプライン曲線
        drawBSplineCurve(points, isClosed);
    } else {
        console.debug(`Unsupported curve type: ${type}`);
        ctx.restore();
        restoreLineAttribute(oldLineSettings);
        drawFillColor = oldColors.fillColor;
        drawLineColor = oldColors.lineColor;
        return;
    }
    
    ctx.restore(); // 状態を復元
    
    // 色設定を復元
    drawFillColor = oldColors.fillColor;
    drawLineColor = oldColors.lineColor;
    
    // 線属性を復元
    restoreLineAttribute(oldLineSettings);
}

/**
 * 折れ線曲線を描画
 * @param {Array} points - 頂点配列 [{x, y}, ...]
 * @param {boolean} isClosed - 閉じた曲線かどうか
 */
function drawPolylineCurve(points, isClosed) {
    if (points.length < 2) return;
    
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    
    for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
    }
    
    if (isClosed) {
        ctx.closePath();
        // 閉じた曲線の場合は塗りつぶしを先に実行
        ctx.fillStyle = drawFillColor;
        ctx.fill();
    }
    
    // 線幅が0より大きい場合のみ線を描画
    if (drawLineWidth > 0) {
        ctx.strokeStyle = drawLineColor;
        ctx.stroke();
    }
}

/**
 * 3次B-スプライン曲線を描画
 * @param {Array} points - 制御点配列 [{x, y}, ...]
 * @param {boolean} isClosed - 閉じた曲線かどうか
 */
function drawBSplineCurve(points, isClosed) {
    if (points.length < 4) {
        // B-スプライン曲線には最低4つの制御点が必要
        // 足りない場合は折れ線として描画
        drawPolylineCurve(points, isClosed);
        return;
    }
    
    ctx.beginPath();
    
    // 3次B-スプライン曲線をベジエ曲線で近似
    const curvePoints = calculateBSplineCurve(points, isClosed);
    
    if (curvePoints.length === 0) return;
    
    ctx.moveTo(curvePoints[0].x, curvePoints[0].y);
    
    // ベジエ曲線として描画
    for (let i = 1; i < curvePoints.length - 2; i += 3) {
        ctx.bezierCurveTo(
            curvePoints[i].x, curvePoints[i].y,
            curvePoints[i + 1].x, curvePoints[i + 1].y,
            curvePoints[i + 2].x, curvePoints[i + 2].y
        );
    }
    
    if (isClosed) {
        ctx.closePath();
        // 閉じた曲線の場合は塗りつぶしを先に実行
        ctx.fillStyle = drawFillColor;
        ctx.fill();
    }
    
    // 線幅が0より大きい場合のみ線を描画
    if (drawLineWidth > 0) {
        ctx.strokeStyle = drawLineColor;
        ctx.stroke();
    }
}

/**
 * 3次B-スプライン曲線をベジエ制御点に変換
 * @param {Array} controlPoints - B-スプライン制御点
 * @param {boolean} isClosed - 閉じた曲線かどうか
 * @returns {Array} ベジエ曲線の制御点配列
 */
function calculateBSplineCurve(controlPoints, isClosed) {
    const n = controlPoints.length;
    if (n < 4) return [];
    
    const bezierPoints = [];
    
    // 開いた曲線の場合：最初と最後の制御点を重複させる
    let points = [...controlPoints];
    if (!isClosed) {
        // 端点を複製して端点で曲線が始まり終わるようにする
        points = [controlPoints[0], ...controlPoints, controlPoints[n - 1]];
    }
    
    const numSegments = isClosed ? n : n - 3;
    
    for (let i = 0; i < numSegments; i++) {
        const p0 = points[i % points.length];
        const p1 = points[(i + 1) % points.length];
        const p2 = points[(i + 2) % points.length];
        const p3 = points[(i + 3) % points.length];
        
        // B-スプラインからベジエへの変換
        const bezier = convertBSplineToBezier(p0, p1, p2, p3);
        
        if (i === 0) {
            bezierPoints.push(bezier.p0);
        }
        bezierPoints.push(bezier.cp1, bezier.cp2, bezier.p3);
    }
    
    return bezierPoints;
}

/**
 * 4つのB-スプライン制御点から1つのベジエ曲線セグメントを計算
 * @param {Object} p0, p1, p2, p3 - B-スプライン制御点
 * @returns {Object} ベジエ曲線の制御点 {p0, cp1, cp2, p3}
 */
function convertBSplineToBezier(p0, p1, p2, p3) {
    // B-スプライン基底関数からベジエ制御点への変換
    return {
        p0: {
            x: (p1.x + p2.x) / 2,
            y: (p1.y + p2.y) / 2
        },
        cp1: {
            x: (p1.x * 2 + p2.x) / 3,
            y: (p1.y * 2 + p2.y) / 3
        },
        cp2: {
            x: (p1.x + p2.x * 2) / 3,
            y: (p1.y + p2.y * 2) / 3
        },
        p3: {
            x: (p2.x + p3.x) / 2,
            y: (p2.y + p3.y) / 2
        }
    };
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
    } else if (UB_SubID === Number(0x01)) {
        console.debug("グループ終了セグメント");
    }
}

/**
 * TAD描画に関する変数を初期化（デフォルト値に設定）
 * @param {number} x - 開始X座標（オプション）
 * @param {number} y - 開始Y座標（オプション）
 */
function initTAD(x = 0, y = 0) {
    // 描画位置を初期化
    textNest = 0;
    textWidth = x;
    textHeight = y;
    textRow = 0;
    textColumn = 0;
    lineMaxHeight = new Array();
    textCharList = new Array();
    textCharPoint = new Array();
    textCharData = new Array();
    tronCodeMask = new Array();
    
    // フォント関係を初期化（デフォルト値に設定）
    textFontSize = 9.6;
    textFontSet = textFontSize + 'px serif';
    textFontStyle = 'normal';
    textFontWeight = 400;
    textFontStretch = 'normal';
    textScaleX = 1.0;
    textSkewAngle = 0;
    fontDirection = 0;
    textStrokeStyle = 'none';
    textShadowStyle = 'none';
    textFontColor = '#000000';
    
    // 行間関連を初期化（デフォルト値に設定）
    lineSpacingDirection = 0;
    lineSpacingType = 1;
    lineSpacingPitch = 1.75;
    textAlign = 0;
    textDirection = 0;
    textSpacingDirection = 0;
    textSpacingKerning = 0;
    textSpacingPattern = 0;
    textSpacingPitch = 0.125;
    currentSegmentType = SEGMENT_TYPE.NONE;
    segmentStack = [];
    currentLineOffset = 0;
    tabRulerLineMoveFlag = false;
    tabRulerLinePoint = 0;
    colorPattern = [];

    // デフォルトマスクを初期化
    initializeDefaultMasks();

    // Canvas描画設定を初期化
    if (ctx) {
        ctx.textBaseline = "top";
        ctx.textAlign = "left";
    }
}

/**
 * 開いた仮身内にリンク先のTADドキュメントを描画
 * @param {LINK} link - リンクオブジェクト
 * @param {number} x - 描画開始X座標
 * @param {number} y - 描画開始Y座標  
 * @param {number} width - 描画領域の幅
 * @param {number} height - 描画領域の高さ
 * @param {VOBJSEG} vobj - 仮身セグメントオブジェクト
 */
function renderLinkedDocumentInVirtualObj(link, x, y, width, height, vobj) {
    // グローバル変数を使用（シンプルなアプローチ）
    if (!ctx || !canvas) {
        console.error('ctx or canvas not available in renderLinkedDocumentInVirtualObj');
        console.error('ctx:', ctx, 'canvas:', canvas);
        return;
    }
    
    // リンク先のデータが存在しない場合は何もしない
    if (!link || !link.raw) {
        console.debug('No linked document data available');
        return;
    }

    console.debug(`Rendering linked document at (${x}, ${y}) with size (${width}x${height}) link ${link.link_id}`);

    // Canvas状態を手動で保存（ctx.save()の競合を避けるため）
    const savedCanvasState = {
        fillStyle: ctx.fillStyle,
        strokeStyle: ctx.strokeStyle,
        lineWidth: ctx.lineWidth,
        lineCap: ctx.lineCap,
        lineJoin: ctx.lineJoin,
        miterLimit: ctx.miterLimit,
        lineDashOffset: ctx.lineDashOffset,
        shadowOffsetX: ctx.shadowOffsetX,
        shadowOffsetY: ctx.shadowOffsetY,
        shadowBlur: ctx.shadowBlur,
        shadowColor: ctx.shadowColor,
        globalAlpha: ctx.globalAlpha,
        globalCompositeOperation: ctx.globalCompositeOperation,
        font: ctx.font,
        textAlign: ctx.textAlign,
        textBaseline: ctx.textBaseline,
        direction: ctx.direction,
        imageSmoothingEnabled: ctx.imageSmoothingEnabled,
        transform: ctx.getTransform()
    };
    
    // 仮身用のセグメントタイプをスタックに追加
    segmentStack.push(SEGMENT_TYPE.TEXT);
    const savedSegmentType = currentSegmentType;
    currentSegmentType = SEGMENT_TYPE.TEXT;
    
    // 現在の描画位置を保存
    const savedTextWidth = textWidth;
    const savedTextHeight = textHeight;
    const savedTextRow = textRow;
    const savedTextColumn = textColumn;
    const savedTextNest = textNest;
    const savedLineMaxHeight = [...lineMaxHeight];  // 配列をコピー
    const savedTextCharList = [...textCharList];  // 配列をコピー
    const savedTextCharPoint = [...textCharPoint];  // 配列をコピー
    const savedTextCharData = [...textCharData];  // 配列をコピー
    const savedTronCodeMask = [...tronCodeMask];  // 配列をコピー
    
    // フォント関連の状態を保存
    const savedTextFontColor = textFontColor;
    const savedTextFontSet = textFontSet;
    const savedTextFontSize = textFontSize;
    const savedTextFontStyle = textFontStyle;
    const savedTextFontWeight = textFontWeight;
    const savedTextFontStretch = textFontStretch;
    const savedTextScaleX = textScaleX;
    const savedTextSkewAngle = textSkewAngle;
    const savedFontDirection = fontDirection;
    const savedTextStrokeStyle = textStrokeStyle;
    const savedTextShadowStyle = textShadowStyle;
    
    // 行間関連の状態を保存
    const savedLineSpacingPitch = lineSpacingPitch;
    const savedLineSpacingDirection = lineSpacingDirection;
    const savedLineSpacingType = lineSpacingType;
    const savedTextAlignVar = textAlign;
    const savedTextDirection = textDirection;
    const savedCurrentLineOffset = currentLineOffset;

    // タブ・ルーラー関連の状態を保存（型を確認してから保存）
    const savedTabRulerLineMoveFlag = tabRulerLineMoveFlag;
    const savedTabRulerLinePoint = tabRulerLinePoint;  // 数値なので直接保存
    const savedColorPattern = colorPattern;  // 配列をコピー
    const savedGroupList = [...groupList];  // 配列をコピー

    try {
        // クリッピング領域のための一時的なsave/restore（限定的使用）
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, width, height);
        ctx.clip();
        
        // 仮身の背景色を設定（必要に応じて）
        if (vobj && vobj.bgcol) {
            ctx.fillStyle = vobj.bgcol.color || '#FFFFFF';
            ctx.fillRect(x, y, width, height);
        }
        
        // リンク先のTADデータを処理
        if (link.raw) {
            // 元のtadRaw関連変数を保存
            const savedTadRaw = tadRaw;
            const savedTadRawBuffer = tadRawBuffer;
            const savedTadDataView = tadDataView;
            const savedTadPos = tadPos;
            
            // 座標変換を手動で管理
            const currentTransform = ctx.getTransform();
            
            try {
                // Canvas座標系を仮身内にシフト
                ctx.translate(x, y);
                
                // デバッグ：TAD処理前の状態
                console.debug('Before tadRawArray - textWidth:', textWidth, 'textHeight:', textHeight, 'textRow:', textRow);
                
                // 仮身内でのTAD処理（座標系は既にシフト済み）
                tadRawArray(link.raw);
                
                // デバッグ：TAD処理後の状態
                console.debug('After tadRawArray - textWidth:', textWidth, 'textHeight:', textHeight, 'textRow:', textRow);
                
            } finally {
                // 座標変換を手動で復元
                ctx.setTransform(currentTransform);
            }
            
            // 元の変数を復元
            tadRaw = savedTadRaw;
            tadRawBuffer = savedTadRawBuffer;
            tadDataView = savedTadDataView;
            tadPos = savedTadPos;
        }
    } catch (error) {
        console.error('Error rendering linked document:', error);
    } finally {
        // セグメントスタックから削除
        if (segmentStack.length > 0 && segmentStack[segmentStack.length - 1] === SEGMENT_TYPE.TEXT) {
            segmentStack.pop();
        }
        currentSegmentType = savedSegmentType;
        
        // デバッグ：復元前の状態
        console.debug('Before restore - textWidth:', textWidth, 'textHeight:', textHeight, 'textRow:', textRow);
        console.debug('Saved values - textWidth:', savedTextWidth, 'textHeight:', savedTextHeight, 'textRow:', savedTextRow);
        
        // 描画位置を復元
        textWidth = savedTextWidth;
        textHeight = savedTextHeight;
        textRow = savedTextRow;
        textColumn = savedTextColumn;
        textNest = savedTextNest;
        lineMaxHeight = savedLineMaxHeight;
        textCharList = savedTextCharList;
        textCharPoint = savedTextCharPoint;
        textCharData = savedTextCharData;
        tronCodeMask = savedTronCodeMask;
        
        // デバッグ：復元後の状態
        console.debug('After restore - textWidth:', textWidth, 'textHeight:', textHeight, 'textRow:', textRow);

        // フォント関連の状態を復元
        textFontColor = savedTextFontColor;
        textFontSet = savedTextFontSet;
        textFontSize = savedTextFontSize;
        textFontStyle = savedTextFontStyle;
        textFontWeight = savedTextFontWeight;
        textFontStretch = savedTextFontStretch;
        textScaleX = savedTextScaleX;
        textSkewAngle = savedTextSkewAngle;
        fontDirection = savedFontDirection;
        textStrokeStyle = savedTextStrokeStyle;
        textShadowStyle = savedTextShadowStyle;
        
        // 行間関連の状態を復元
        lineSpacingPitch = savedLineSpacingPitch;
        lineSpacingDirection = savedLineSpacingDirection;
        lineSpacingType = savedLineSpacingType;
        textAlign = savedTextAlignVar;
        textDirection = savedTextDirection;
        currentLineOffset = savedCurrentLineOffset;

        // タブ・ルーラー関連の状態を復元
        tabRulerLineMoveFlag = savedTabRulerLineMoveFlag;
        tabRulerLinePoint = savedTabRulerLinePoint;  // 数値なので直接復元
        colorPattern = savedColorPattern;
        groupList = savedGroupList;

        // Canvas状態を手動で復元（ctx.restore()の競合を避けるため）
        ctx.fillStyle = savedCanvasState.fillStyle;
        ctx.strokeStyle = savedCanvasState.strokeStyle;
        ctx.lineWidth = savedCanvasState.lineWidth;
        ctx.lineCap = savedCanvasState.lineCap;
        ctx.lineJoin = savedCanvasState.lineJoin;
        ctx.miterLimit = savedCanvasState.miterLimit;
        ctx.lineDashOffset = savedCanvasState.lineDashOffset;
        ctx.shadowOffsetX = savedCanvasState.shadowOffsetX;
        ctx.shadowOffsetY = savedCanvasState.shadowOffsetY;
        ctx.shadowBlur = savedCanvasState.shadowBlur;
        ctx.shadowColor = savedCanvasState.shadowColor;
        ctx.globalAlpha = savedCanvasState.globalAlpha;
        ctx.globalCompositeOperation = savedCanvasState.globalCompositeOperation;
        ctx.font = savedCanvasState.font;
        ctx.textAlign = savedCanvasState.textAlign;
        ctx.textBaseline = savedCanvasState.textBaseline;
        ctx.direction = savedCanvasState.direction;
        ctx.imageSmoothingEnabled = savedCanvasState.imageSmoothingEnabled;

        // クリッピング領域を復元（一時的なsave/restore）
        ctx.restore();
        ctx.setTransform(savedCanvasState.transform);
        

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

    let linkRecordData = new Array();
    for(let offsetLen=15;offsetLen<tadSeg.length;offsetLen++) {
        linkRecordData.push(tadSeg[offsetLen]);
//        let char = charTronCode(Number(tadSeg[offsetLen]));
//        console.debug("linkRecordData[" + offsetLen + "] = [" + char + "] " + IntToHex((tadSeg[offsetLen]),4).replace('0x',''));
    }

    // 開いた仮身の判定：高さが50ピクセルより大きい場合
    const vobjWidth = vobj.right - vobj.left;
    const vobjHeight = vobj.bottom - vobj.top;
    
    console.debug(`=== VIRTUAL OBJECT DEBUG ===`);

    if (vobjHeight > 50) {
        openVirtualObj = true;
        console.debug(`Virtual Object marked as OPENED (height: ${vobjHeight})`);
    } else {
        console.debug(`Virtual Object marked as CLOSED (height: ${vobjHeight})`);
    }

    let newLink = new LINK();
    console.debug('=== LINK CREATION DEBUG ===');
    console.debug(`isProcessingBpk: ${isProcessingBpk}, currentFileIndex: ${currentFileIndex}, linkNo: ${linkNo}, window.originalLinkId: ${window.originalLinkId}`);

    if (isProcessingBpk) {
        // セカンダリウィンドウの場合、originalLinkIdを使ってグローバルlinkRecordListから取得
        if (window.originalLinkId !== undefined && window.originalLinkId !== null) {
            const globalLinkRecordList = window.linkRecordList || linkRecordList;
            //console.log('Secondary window: using originalLinkId', window.originalLinkId);
            //console.log('Available linkRecordList indices:', globalLinkRecordList ? Object.keys(globalLinkRecordList) : 'null');
            
            // 元のファイルのlinkRecordListから取得
            const targetFileIndex = window.originalLinkId - 1; // link_idは1-indexed
            if (globalLinkRecordList && globalLinkRecordList[targetFileIndex] && globalLinkRecordList[targetFileIndex][linkNo]) {
                newLink = globalLinkRecordList[targetFileIndex][linkNo];
                //console.log(`Using existing link from globalLinkRecordList[${targetFileIndex}][${linkNo}]`);
                //console.log('Retrieved link:', newLink);
            } else {
                //console.log(`No existing link found in globalLinkRecordList[${targetFileIndex}][${linkNo}], creating new one`);
                newLink = new LINK();
            }
        } else {
            // メインウィンドウの場合
            if (linkRecordList[currentFileIndex] && linkRecordList[currentFileIndex][linkNo]) {
                newLink = linkRecordList[currentFileIndex][linkNo];
                //console.log('Main window: using existing link from linkRecordList');
            } else {
                //console.log('Main window: no existing link found, creating new one');
                newLink = new LINK();
            }
        }
        
        newLink.left = vobj.left;
        newLink.top = vobj.top;
        newLink.right = vobj.right;
        newLink.bottom = vobj.bottom;
        newLink.dlen = vobj.dlen;
    }

    // LHEADからlink_nameを取得とリンク先のrawデータを設定
    if (LHEAD && LHEAD[newLink.link_id - 1]) {
        const lhead = LHEAD[newLink.link_id - 1];
        newLink.link_name = lhead.name;
        // リンク先のTADファイルのrawデータをtadRecordDataArrayから取得
        const linkedRecord = tadRecordDataArray.find(record => record.fileIndex === newLink.link_id - 1);
        if (linkedRecord && linkedRecord.data) {
            newLink.raw = linkedRecord.data;
        }
    }

    // 文章セグメント処理中かどうかで描画位置を変更
    let drawLeft = 0, drawTop = 0, drawRight = 0, drawBottom = 0;

    if (isDirectTextSegment() || isInTextSegment()) {
        // テキスト位置を仮身の幅分調整
        if (textWidth + vobjWidth > canvasW) {
            textHeight += (textFontSize * lineSpacingPitch);
            textRow++;
            // 仮身の高さを新しい行の最大高さとして設定
            const vobjHeight = vobj.bottom - vobj.top;
            lineMaxHeight[textRow] = Math.max(vobjHeight, textFontSize * lineSpacingPitch);
            textWidth = 0;
            textColumn = 0;
        }

        // 文章セグメント処理中：シンプルな位置計算
        drawLeft = textWidth;
        drawTop = textHeight;
        drawRight = drawLeft + vobjWidth;
        drawBottom = drawTop + textFontSize;
        console.debug(`left:${drawLeft}, top:${drawTop}, right:${drawRight}, bottom:${drawBottom}, textFontSize:${textFontSize}, lineSpacingPitch:${lineSpacingPitch}`);

        if (openVirtualObj) {
            // 開いた仮身の場合、元のサイズを維持
            drawBottom = drawTop + vobjHeight;
        }

        // lineMaxHeightを更新
        const effectiveHeight = openVirtualObj ? vobjHeight : textFontSize;
        if (!lineMaxHeight[textRow]) {
            lineMaxHeight[textRow] = effectiveHeight;
        } else if (lineMaxHeight[textRow] < effectiveHeight) {
            lineMaxHeight[textRow] = effectiveHeight;
        }

        // 文章セグメントの位置にリンク位置を修正
        newLink.left = drawLeft;
        newLink.top = drawTop;
        newLink.right = drawRight;
        newLink.bottom = drawBottom;

    } else {
        // 図形セグメント処理中：従来通りの絶対座標
        drawLeft = vobj.left;
        drawTop = vobj.top;
        drawRight = vobj.right;
        drawBottom = vobj.bottom;
    }

    if (openVirtualObj) {
        // 開いた仮身の場合、二重枠を描画
        const frameColor = vobj.frcol.color;
        ctx.strokeStyle = frameColor;
        ctx.lineWidth = 2;
        
        // 外枠
        ctx.beginPath();
        ctx.rect(drawLeft, drawTop, drawRight - drawLeft, drawBottom - drawTop);
        ctx.stroke();
        
        // 内枠
        ctx.beginPath();
        ctx.rect(drawLeft + 3, drawTop + 3, drawRight - drawLeft - 6, drawBottom - drawTop - 6);
        ctx.stroke();
        
        // リンク先のドキュメントを仮身枠内に描画
        // 内枠の内側に描画（上下左右に5ピクセルのマージン）
        renderLinkedDocumentInVirtualObj(newLink, drawLeft + 5, drawTop + 5, 
                                         drawRight - drawLeft - 10, drawBottom - drawTop - 10, vobj);
        
        // 開いた仮身後の描画位置を正しく設定
        textHeight = drawBottom;
        textWidth = 0;  // 次の行の開始位置をリセット
        textColumn = 0;
        textRow++;
        // 現状の行の最大高さを更新
        lineMaxHeight[textRow] = Math.max(textFontSize * lineSpacingPitch);

    } else {
        
        // 1. 背景色を描画（必要な場合）
        const tbColor = vobj.tbcol.color;
        ctx.fillStyle = tbColor;
        ctx.fillRect(drawLeft, drawTop, drawRight - drawLeft, drawBottom - drawTop);
        
        // 2. 仮身テキストを描画
        const vobjTextColor = vobj.chcol.color;
        ctx.fillStyle = vobjTextColor;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        
        if (newLink.link_name) {
            //console.debug(`Drawing virtual object text: "${newLink.link_name}" at (${drawLeft}, ${drawTop}) with color ${vobjTextColor}`);
            ctx.fillText(newLink.link_name, drawLeft + 2, drawTop + 2); // わずかにマージンを付ける
        }
        
        // 3. 仮身枠を描画
        const frameColor = vobj.frcol.color;
        ctx.strokeStyle = frameColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.rect(drawLeft, drawTop, drawRight - drawLeft, drawBottom - drawTop);
        ctx.stroke();


        textWidth += vobjWidth;
    }
    console.debug(`Virtual Object size: (left:${drawLeft}, top:${drawTop}, right:${drawRight}, bottom:${drawBottom})`);

    // virtual領域の拡大チェック
    expandVirtualArea(drawLeft, drawTop, drawRight, drawBottom);

    console.log(`=== SAVING VIRTUAL OBJECT LINK ===`);
    console.log(`currentFileIndex: ${currentFileIndex}, linkNo: ${linkNo}`);
    
    // 座標情報をリンクデータに追加
    newLink.left = drawLeft;
    newLink.top = drawTop;
    newLink.right = drawRight;
    newLink.bottom = drawBottom;
    
    //console.debug('Link data to save:', newLink);
    //console.debug(`Coordinates: left=${drawLeft}, top=${drawTop}, right=${drawRight}, bottom=${drawBottom}`);
    //console.debug('linkRecordList before save:', linkRecordList);
    //console.debug('linkRecordList structure check:');
    //console.debug('  - typeof linkRecordList:', typeof linkRecordList);
    //console.debug('  - Array.isArray(linkRecordList):', Array.isArray(linkRecordList));
    //console.debug('  - linkRecordList.length:', linkRecordList.length);
    //console.debug(`  - linkRecordList[${currentFileIndex}]:`, linkRecordList[currentFileIndex]);
    //console.debug(`  - Array.isArray(linkRecordList[${currentFileIndex}]):`, Array.isArray(linkRecordList[currentFileIndex]));

    // linkRecordList[currentFileIndex]が存在しない場合は初期化
    if (!linkRecordList[currentFileIndex]) {
        console.debug(`Initializing linkRecordList[${currentFileIndex}] as empty array`);
        linkRecordList[currentFileIndex] = [];
    }
    
    linkRecordList[currentFileIndex][linkNo] = newLink;
    linkNo++;

    //console.debug('linkRecordList after save:', linkRecordList);
    //console.debug(`linkRecordList[${currentFileIndex}] length:`, linkRecordList[currentFileIndex] ? linkRecordList[currentFileIndex].length : 'undefined');
    //console.debug(`linkRecordList[${currentFileIndex}][${linkNo-1}]:`, linkRecordList[currentFileIndex] ? linkRecordList[currentFileIndex][linkNo-1] : 'undefined');
    console.debug(`仮身セグメント left : ${vobj.left}, top : ${vobj.top}, right : ${vobj.right}, bottom : ${vobj.bottom}, dlen : ${vobj.dlen} textHeight : ${textHeight}`);
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
    
    if (packAppId1 != tadSeg[12] || packAppId2 != tadSeg[13] || packAppId3 != tadSeg[14]) {
        console.debug("書庫形式ではない アプリケーションID");
        console.debug("appl   " + appl);
        return;
    }
    console.debug("書庫形式");

    let fileTadName = [];

    for (offsetLen=15;offsetLen<31;offsetLen++) {
        fileTadName.push(charTronCode(tadSeg[offsetLen]));
    }
    console.debug("fileTadName " + fileTadName);

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
    console.debug(`GHEAD: headtype=${GHEAD.headType}, checkSum=${GHEAD.checkSum}, version=${GHEAD.version}, crc=${GHEAD.crc}, nfiles=${GHEAD.nfiles}, compmethod=${GHEAD.compMethod}`);

    compMethod = Number(GHEAD.compMethod);
    if ((compMethod != LH5) && (compMethod != LH0)) {
        console.debug("Error file");
        return;
    }
    let time = uh2uw([compSeg[6], compSeg[5]]);
    console.debug(`Archive: time=${time[0]}, filesize=${GHEAD.fileSize}, orgsize=${GHEAD.origSize}, compsize=${GHEAD.compSize}, extsize=${GHEAD.extSize}`);

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
        console.debug('tadPos:', tadPos, 'GHEAD.compSize:', GHEAD.compSize, 'GHEAD.origSize:', GHEAD.origSize);
        
        try {
            // tadRawArrayで渡されたrawデータを使用してLH5Decoderを初期化
            if (typeof window !== 'undefined' && window.currentRawData) {
                console.debug('currentRawData length:', window.currentRawData.length);
                // tadPosは0ベースで、startPos(142)から開始
                lh5Decoder.init(window.currentRawData, tadPos, GHEAD.compSize, GHEAD.origSize);
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
                         'startPos=', tadPos, 'compSize=', GHEAD.compSize, 'origSize=', GHEAD.origSize);
            return;
        }
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

        console.debug(`LocalHead[${localheadLoop}]: name="${lhead.name}", origId=${lhead.origId}, compMethod=${lhead.compMethod}, orgsize=${lhead.origSize}, compSize=${lhead.compSize}, f_nlink=${lhead.f_nlink}, crc=${lhead.crc}, fsize=${lhead.f_size}, offset=${lhead.offset}, nrec=${lhead.f_nrec}, f_ltime=${lhead.f_ltime}`);
        
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
        tsFig(tadSeg);
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
        tsGroupSet(segLen, tadSeg);
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

// ダブルクリック用の変数
let lastClickTime = 0;
let lastClickX = 0;
let lastClickY = 0;
const DOUBLE_CLICK_THRESHOLD = 300; // ミリ秒
const CLICK_DISTANCE_THRESHOLD = 5; // ピクセル

function mouseDownListner(e) {
    var rect = e.target.getBoundingClientRect();
	//座標取得
	const mouseX1 = e.clientX - rect.left;
	const mouseY1 = e.clientY - rect.top;
    
    // ダブルクリック判定
    const now = Date.now();
    const timeDiff = now - lastClickTime;
    const distance = Math.sqrt(Math.pow(mouseX1 - lastClickX, 2) + Math.pow(mouseY1 - lastClickY, 2));
    
    // 前回のクリック情報を更新
    lastClickTime = now;
    lastClickX = mouseX1;
    lastClickY = mouseY1;
    
    // ダブルクリックでない場合は処理しない
    if (timeDiff > DOUBLE_CLICK_THRESHOLD || distance > CLICK_DISTANCE_THRESHOLD) {
        return; // シングルクリックなので何もしない
    }
    
    console.debug(`Double-click detected at (${mouseX1}, ${mouseY1})`);

    // BTRONデスクトップ環境では、canvasにvirtualObjectLinksが保存されており、
    // setupVirtualObjectEventsで独自の処理が行われるため、ここでは処理しない
    if (typeof window.btronDesktop !== 'undefined') {
        console.debug('BTRONDesktop environment detected, skipping tad.js link processing');
        return; // BTRONデスクトップの処理に任せる
    }

    // 現在のタブインデックスを取得
    let tabIndex = 0;
    
    // BTRONデスクトップ環境では独自の処理を行うため、tad.jsのタブ処理はスキップ
    if (typeof window.btronDesktop !== 'undefined') {
        return;
    }
    
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
    
    // Try to get canvas element, with fallback for index.html tab system
    canvas = document.getElementById(canvasId);
    console.debug(`canvasInit: document.getElementById('${canvasId}'):`, !!canvas);
    
    
    if (canvas && canvas.getContext) {
        ctx = canvas.getContext('2d');
        
        // Set global window references for compatibility
        window.canvas = canvas;
        window.ctx = ctx;
        
    }

    // キャンバスをクリア
    if (ctx && canvas) {
        clearCanvas(ctx, canvas.width, canvas.height);
        
        canvas.width = canvasW;
        canvas.height = canvasH;
        
        // スクロールオフセットを適用
        applyScrollOffset(ctx);

        ctx.fillStyle = 'white'; // 背景色を白に設定
        ctx.fillRect(0, 0, ctx.canvas.clientWidth, ctx.canvas.clientHeight);
    }

    // リンク対応（ダブルクリック）
    canvas.addEventListener("mousedown", mouseDownListner, false);

}

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
        let P4 = '';

        
        let raw16 = data_view.getUint16(i,true);

        if (raw16 === Number(TNULL)) {
            // 終端
            if (isTadDumpEnabled()) {
                tadTextDumpBuffer.push('buffer over.\r\n');
            }
            if (isTextDumpEnabled()) {
                planeTextDumpBuffer.push('EOF\r\n');
            }
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
            if (isTadDumpEnabled()) {
                tadTextDumpBuffer.push(' segID = ( ' + IntToHex((segID),4).replace('0x','') + ' ) ');
            }

            segLen = Number(data_view.getUint16(i,true));
            if (segLen === Number(0xffff)) {
                i += 2;
                segLen = Number(data_view.getUint32(i,true));
                i += 4;

            }else{
                i += 2;
            }
            if (isTadDumpEnabled()) {
                tadTextDumpBuffer.push(' segLen = ( ' + IntToHex((segLen),4).replace('0x','') + ' ) ');
            }

            for(let offsetLen=0;offsetLen<segLen;offsetLen=offsetLen+2) {
                const offsetRaw = data_view.getUint16(i + offsetLen,true);
                if (isTadDumpEnabled()) {
                    tadTextDumpBuffer.push(' ' + IntToHex(Number(offsetRaw),4).replace('0x',''));
                }
                tadSeg.push(offsetRaw);
            }
            i += segLen;
            tadPerse(segID, segLen, tadSeg, nowPos);

        }else{
            const raw8Plus1 = Number(data_view.getUint16(i,true));
            const char = charTronCode(raw8Plus1);
            if (isTadDumpEnabled()) {
                tadTextDumpBuffer.push('char = ( ' + IntToHex((raw8Plus1),4).replace('0x','') + ' )' + char);
            }
            if (isTextDumpEnabled()) {
                planeTextDumpBuffer.push(char);
            }
            P4 += char;
            i += 2;
            if (textNest > 0){
                // drawText呼び出し前の最終チェック
                if (!ctx || !canvas) {
                    // 緊急修復を試行
                    ctx = window.ctx;
                    canvas = window.canvas;
                    console.debug('Emergency repair attempted - ctx:', !!ctx, 'canvas:', !!canvas);
                }
                drawText(ctx, canvas, char, textFontSize,  textCharPoint[textNest-1][0],textCharPoint[textNest-1][1] ,textCharPoint[textNest-1][2], textSpacingPitch, lineSpacingPitch, 0);
            }
        }

        textCharList[textNest-1] += P4;

        if (isTadDumpEnabled()) {
            tadTextDumpBuffer.push('\r\n');
            tadTextDumpBuffer.push(IntToHex((i),8).replace('0x','') + ' ');
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
        nfiles = (typeof GHEAD !== 'undefined' && GHEAD.nfiles) ? GHEAD.nfiles : 1;
    }
    if (fileIndex === null) {
        fileIndex = (typeof currentFileIndex !== 'undefined') ? currentFileIndex : 0;
    }
    
    console.debug(`*** New tadDataArray: nfiles=${nfiles}, fileIndex=${fileIndex}, isRedrawn=${isRedrawn} ***`);
    
    // Reset text dump buffers for new processing (only if dump is enabled)
    if (!isRedrawn) {
        if (isTadDumpEnabled()) {
            tadTextDumpBuffer = ['00000000 '];
        } else {
            tadTextDumpBuffer = [];
        }
        
        if (isTextDumpEnabled()) {
            planeTextDumpBuffer = [];
        } else {
            planeTextDumpBuffer = [];
        }
    }
    
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
        // btron-desktop環境ではcanvas-X要素が存在しないためスキップ
        const targetCanvas = document.getElementById(`canvas-${currentFileIndex}`);
        if (targetCanvas) {
            canvasInit(`canvas-${currentFileIndex}`);
        }
    }

    // TADセグメント処理
    tadRawArray(raw);
    
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
    
    // Join buffer arrays to create final strings (only if enabled)
    if (isTadDumpEnabled()) {
        tadTextDump = tadTextDumpBuffer.join('');
    } else {
        tadTextDump = 'TAD Dump is disabled';
    }
    
    if (isTextDumpEnabled()) {
        planeTextDump = planeTextDumpBuffer.join('');
    } else {
        planeTextDump = 'Text Dump is disabled';
    }
    
    // Asynchronous DOM update to prevent UI blocking
    const updateDOMElements = () => {
        const binaryInfo = document.getElementById('BainryInfo');
        const tadDumpView = document.getElementById('tadDumpView');
        const tadTextView = document.getElementById('tadTextView');
        
        if (binaryInfo) {
            binaryInfo.innerHTML = 'This File Size : ' + setComma(raw.length) +' Byte<br>Maximum displaye Size : 1000KB(1,000,000 Byte)';
        }
        
        // Only update dump views if they contain actual data (not just disabled message)
        if (tadDumpView) {
            if (isTadDumpEnabled() && tadTextDump && tadTextDump.length > 0) {
                // For large dumps, update in chunks to prevent blocking
                if (tadTextDump.length > 50000) {
                    const chunks = tadTextDump.match(/.{1,10000}/g) || [];
                    tadDumpView.innerHTML = '';
                    let chunkIndex = 0;
                    
                    const updateChunk = () => {
                        if (chunkIndex < chunks.length) {
                            tadDumpView.innerHTML += htmlspecialchars(chunks[chunkIndex]);
                            chunkIndex++;
                            setTimeout(updateChunk, 0);
                        }
                    };
                    updateChunk();
                } else {
                    tadDumpView.innerHTML = htmlspecialchars(tadTextDump);
                }
            } else {
                tadDumpView.innerHTML = htmlspecialchars(tadTextDump);
            }
        }
        
        if (tadTextView) {
            if (isTextDumpEnabled() && planeTextDump && planeTextDump.length > 0) {
                // For large text dumps, update in chunks
                if (planeTextDump.length > 50000) {
                    const chunks = planeTextDump.match(/.{1,10000}/g) || [];
                    tadTextView.innerHTML = '';
                    let chunkIndex = 0;
                    
                    const updateChunk = () => {
                        if (chunkIndex < chunks.length) {
                            tadTextView.innerHTML += htmlspecialchars(chunks[chunkIndex]);
                            chunkIndex++;
                            setTimeout(updateChunk, 0);
                        }
                    };
                    updateChunk();
                } else {
                    tadTextView.innerHTML = htmlspecialchars(planeTextDump);
                }
            } else {
                tadTextView.innerHTML = htmlspecialchars(planeTextDump);
            }
        }
    };
    
    // Use requestIdleCallback for better performance, fallback to setTimeout
    if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(updateDOMElements, { timeout: 1000 });
    } else {
        setTimeout(updateDOMElements, 0);
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
 * 添え字開始指定付箋を処理
 * @param {number} segLen セグメント長
 * @param {Array} tadSeg セグメントデータ
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
    
    console.debug("添え字終了");
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
