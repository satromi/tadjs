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
 * TADjs Ver0.26
 *
 * BTRONのドキュメント形式である文章TAD、図形TADをブラウザ上で表示するツールです
 * @link https://github.com/satromi/tadjs
 * @author satromi@gmail.com Tw  @satromi
 * @license https://www.apache.org/licenses/LICENSE-2.0 Apache-2.0
*/

// getLoggerが存在しない場合（ブラウザ直接実行時）のフォールバック
const logger = typeof window.getLogger === 'function'
    ? window.getLogger('TADParser')
    : { debug: () => {}, info: () => {}, warn: console.warn, error: console.error };

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
let currentIndentLevel = 0;  // インデントレベル管理

let currentFileIndex = 0;  // Track current file index for multiple tabs
let isProcessingBpk = false;  // Flag to indicate BPK processing
let lheadToCanvasMap = {};  // Map from lHead file index to actual canvas index
let textNest = 0;
let textCharList = [];
let textCharPoint = [];
let textCharData = [];
let textCharDirection = [];
let imagePoint = [];
let tronCodeMask = [];
let startTadSegment = false;
let startByImageSegment = false;
let cantNextLineFlg = 0; // 改行禁止フラグ
let isFontDefined = false; // フォント定義済みフラグ
let isTadStarted = false; // TAD開始フラグ
let isXmlTad = false; // XMLTADフラグ
let isXmlFig = false; // XMLFIGフラグ
let isInVirtualObject = false; // 仮想オブジェクト内フラグ
let virtualObjectOffsetX = 0; // 仮想オブジェクト内Xオフセット
let virtualObjectOffsetY = 0; // 仮想オブジェクト内Yオフセット

// 固定幅空白指定付箋用の状態
let fixedWidthSpaceState = {
    active: false,
    scaleData: 0
};

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
const tabCharNum = 4;
let tabRulerLinePoint = 0;
let tabRulerLineMoveFlag = false;
let colorPattern = []; // 配列として初期化
let groupList = [];

// フォント設定
const defaultFontSize = 9.6; // デフォルトフォントサイズ
let textFontSize = defaultFontSize;
let textFontSet = textFontSize + 'px serif';
let currentFontFamily = 'serif'; // 現在指定されているフォントファミリー

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
let textScaleX = 1.0;
let textSkewAngle = 0;
let fontDirection = 0;  // 0:横書き, 1:縦書き（フォント属性用）
let textStrokeStyle = 'none';  // 線種（none, outline）
let textShadowStyle = 'none';  // 影（none, black, white）
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

// 図形設定
let drawLineColor = '#000000';
let drawLineWidth = 1;
let drawFillColor = '#FFFFFF';
let backgroundColor = '#FFFFFF';
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
let tadTextDumpBuffer = ['00000000 '];
//let planeTextDumpBuffer = [];
//let planeTextDump = '';
let tadTextDump = '00000000 ';
let tadPos = 0;
let tadRecordDataArray = [];

let textRow    = 0; // 行
let textColumn = 0; // 列
let textWidth = 0;
let textHeight = 0;
let lineMaxHeight = [];
let lineSpacingDirection = 0; // 行間
let lineSpacingType = 1; // 行間の種類
let pageCount = 1; // 現在のページ数（ページ番号ではない）
let lineSpacingPitch = 1.75; // 行間のピッチ
let isDetailMode = false; // 詳細モード表示フラグ
let detailModeRulerDrawn = false; // 詳細モードルーラ描画済みフラグ
let textAlign = 0; // 0:左揃え,1:中央揃え,2:右揃え,3:両端揃え,4:均等揃え,5～:予約
let textDirection = 0; // 0:左から右,1:右から左,2:上から下,3-255:予約
let textSpacingDirection = 0; // 文字間隔の方向 0:文字送り方向, 1:文字送り方向の逆
let textSpacingKerning = 0; // 文字間隔カーニング有無 0:無効,1:有効
let textSpacingPattern = 0; // 文字間隔パターン 0:文字送り量,文字アキ量
let textSpacingPitch = 0.125; // SCALE 文字間隔のピッチ

// 行バッファリング用変数
let currentLineOffset = 0;  // 現在行の揃えオフセット

// リンクレコード対応
let linkRecordList = []; // リンクレコードリスト
let execFuncRecordList = []; // 実行機能付箋レコードリスト
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

let localHeadSize = 96;

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
 * 各TADファイル(nfiles)ごとのcanvasを生成
 * @param {number} fileIndex ファイルインデックス
 * @param {number} width canvas幅
 * @param {number} height canvas高さ
 */
function createTadFileCanvas(fileIndex, width = 1200, height = 1200) {
    if (!tadFileCanvases[fileIndex]) {
        logger.debug(`Creating TAD file canvas for file ${fileIndex} (${width}x${height})`);
        
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
        
        logger.debug(`TAD file canvas created for file ${fileIndex}`);
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
        // グローバルスコープにも公開（プラグイン用）
        window.tadFileDrawBuffers = tadFileDrawBuffers;
        logger.debug(`Draw buffer saved for TAD file ${fileIndex}`);

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
        logger.warn(`No draw buffer found for TAD file ${fileIndex}`);
        return;
    }
    
    // 表示用canvasを取得
    const displayCanvas = document.getElementById(`canvas-${tabIndex}`);
    if (!displayCanvas) {
        logger.warn(`Display canvas not found for tab ${tabIndex}`);
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
    
    // 用紙モードが有効な場合、用紙枠を描画
    // index.html用のチェックボックス
    const paperModeCheckbox = document.getElementById('paper-mode-enabled') || 
                            document.getElementById(`canvas-${tabIndex}-paper-mode`);
    
    // tadjs-desktop.js用のウィンドウ属性チェック
    const canvas = document.getElementById(`canvas-${tabIndex}`);
    let paperModeEnabled = false;
    
    if (paperModeCheckbox && paperModeCheckbox.checked) {
        // チェックボックスがある場合（index.html）
        paperModeEnabled = true;
    } else if (canvas) {
        // canvas要素から親ウィンドウを探して、data-paper-mode属性をチェック（tadjs-desktop.js）
        const windowElement = canvas.closest('.window');
        if (windowElement && windowElement.dataset.paperMode === 'true') {
            paperModeEnabled = true;
        }
    }
    
    if (paperModeEnabled) {
        logger.debug(`Drawing paper frame for tab ${tabIndex}`);
        drawPaperFrame(displayCtx, tabIndex, validScrollX, validScrollY);
    }
    
    // 詳細モード（mode=2）の場合、タブ状態表示とルーラを描画
    const canvasElement = document.getElementById(`canvas-${tabIndex}`);
    let displayMode = '0';
    if (canvasElement) {
        const windowElement = canvasElement.closest('.window');
        if (windowElement) {
            displayMode = windowElement.dataset.displayMode || '3';
        } else {
            // index.html の場合
            const displayModeSelect = document.getElementById('display-mode-select');
            if (displayModeSelect) {
                displayMode = displayModeSelect.value;
            }
        }
    }
    
    // 詳細モード表示は描画バッファからの表示時は不要（セグメント処理中に描画されるため）
}

/**
 * 用紙枠を描画する関数
 * @param {CanvasRenderingContext2D} ctx 描画コンテキスト
 * @param {number} tabIndex タブインデックス
 * @param {number} scrollX スクロール位置X
 * @param {number} scrollY スクロール位置Y
 */
function drawPaperFrame(ctx, tabIndex, scrollX = 0, scrollY = 0) {
    // 用紙情報が存在しない場合は何も描画しない
    if (!paperSize || !paperSize.width || !paperSize.length) {
        return;
    }
    
    // 現在のページ番号（タブインデックスから推定、実際にはpageNumber変数を使うべき）
    const currentPageNumber = typeof pageNumber !== 'undefined' ? pageNumber : (tabIndex + 1);
    const isEvenPage = (currentPageNumber % 2) === 0;
    
    // 物理的な左右マージンを計算
    let physicalLeft, physicalRight;
    let shouldSwap = false;
    
    // 右綴じの場合は左右を逆にする
    if (paperSize.binding === 1) {
        shouldSwap = true;
    }
    
    // 左綴じの見開きで偶数ページの場合も左右を逆にする
    if (paperSize.binding === 0 && paperSize.imposition === 1 && isEvenPage) {
        shouldSwap = true;
    }
    
    // 右綴じの見開きで奇数ページの場合は逆にしない
    if (paperSize.binding === 1 && paperSize.imposition === 1 && !isEvenPage) {
        shouldSwap = false;
    }
    
    if (shouldSwap) {
        physicalLeft = paperSize.right;   // 小口側の値を物理的な左に
        physicalRight = paperSize.left;   // ノド側の値を物理的な右に
    } else {
        physicalLeft = paperSize.left;    // ノド側の値を物理的な左に
        physicalRight = paperSize.right;  // 小口側の値を物理的な右に
    }
    
    // 描画スタイルを保存
    ctx.save();
    
    // スクロール位置を考慮して描画位置を調整
    ctx.translate(-scrollX, -scrollY);
    
    // 用紙の外枠を描画（薄い点線）
    ctx.strokeStyle = '#8080804d';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(0, 0, paperSize.width, paperSize.length);
    
    // オーバーレイ領域の枠を描画（やや濃い点線）
    if (paperSize.top !== undefined && paperSize.bottom !== undefined) {
        ctx.strokeStyle = '#64646466';
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(
            physicalLeft,
            paperSize.top,
            paperSize.width - physicalLeft - physicalRight,
            paperSize.length - paperSize.top - paperSize.bottom
        );
    }
    
    // 本文レイアウト領域の枠を描画（最も濃い点線）
    if (paperMargin) {
        // マージンの物理的な左右を計算
        let marginPhysicalLeft, marginPhysicalRight;
        
        if (shouldSwap) {
            marginPhysicalLeft = paperMargin.right;
            marginPhysicalRight = paperMargin.left;
        } else {
            marginPhysicalLeft = paperMargin.left;
            marginPhysicalRight = paperMargin.right;
        }
        
        ctx.strokeStyle = '#40404080';
        ctx.setLineDash([2, 2]);
        ctx.strokeRect(
            marginPhysicalLeft,
            paperMargin.top,
            paperSize.width - marginPhysicalLeft - marginPhysicalRight,
            paperSize.length - paperMargin.top - paperMargin.bottom
        );
    }
    
    // 綴じ方向のインジケータを描画
    ctx.fillStyle = '#8080804d';
    ctx.font = '10px sans-serif';
    const bindingText = paperSize.binding === 0 ? '左綴じ' : '右綴じ';
    const pageText = `ページ${currentPageNumber}`;
    
    if (paperSize.binding === 0) {
        // 左綴じの場合、左上に表示
        ctx.fillText(bindingText + ' ' + pageText, 5 - scrollX, 15 - scrollY);
    } else {
        // 右綴じの場合、右上に表示
        const textWidth = ctx.measureText(bindingText + ' ' + pageText).width;
        ctx.fillText(bindingText + ' ' + pageText, paperSize.width - textWidth - 5 - scrollX, 15 - scrollY);
    }
    
    // 描画スタイルを復元
    ctx.restore();
}

/**
 * 詳細モード表示を描画する関数
 * @param {CanvasRenderingContext2D} ctx 描画コンテキスト
 * @param {number} tabIndex タブインデックス
 * @param {number} scrollX スクロール位置X
 * @param {number} scrollY スクロール位置Y
 */
function drawDetailModeDisplay(ctx, tabIndex, scrollX = 0, scrollY = 0) {
    ctx.save();
    
    // スクロール位置を考慮して描画位置を調整
    ctx.translate(-scrollX, -scrollY);
    
    // ルーラの幅を計算
    let rulerWidth = 1200; // デフォルト幅
    if (paperSize && paperSize.width) {
        rulerWidth = paperSize.width;
    } else if (canvas) {
        rulerWidth = canvas.width;
    }
    
    // 本文レイアウト領域の左端を計算
    let textAreaLeft = 0;
    let textAreaWidth = rulerWidth;
    
    if (paperSize && paperMargin) {
        // 用紙指定とマージン指定がある場合
        const currentPageNumber = typeof pageNumber !== 'undefined' ? pageNumber : 1;
        const isEvenPage = (currentPageNumber % 2) === 0;
        
        // 物理的な左右マージンを計算（用紙枠描画と同じロジック）
        let shouldSwap = false;
        if (paperSize.binding === 1) {
            shouldSwap = true;
        }
        if (paperSize.binding === 0 && paperSize.imposition === 1 && isEvenPage) {
            shouldSwap = true;
        }
        if (paperSize.binding === 1 && paperSize.imposition === 1 && !isEvenPage) {
            shouldSwap = false;
        }
        
        let marginPhysicalLeft, marginPhysicalRight;
        if (shouldSwap) {
            marginPhysicalLeft = paperMargin.right;
            marginPhysicalRight = paperMargin.left;
        } else {
            marginPhysicalLeft = paperMargin.left;
            marginPhysicalRight = paperMargin.right;
        }
        
        textAreaLeft = marginPhysicalLeft;
        textAreaWidth = paperSize.width - marginPhysicalLeft - marginPhysicalRight;
    }
    
    // 標準文字サイズ（9.6）での文字幅を計算
    const standardCharSize = defaultFontSize;
    const charWidth = standardCharSize * 0.8; // 文字幅の概算
    
    // ルーラ背景（薄いグレー）
    ctx.fillStyle = '#f0f0f0cc';
    ctx.fillRect(textAreaLeft, 0, textAreaWidth, 20);
    
    // ルーラ枠線
    ctx.strokeStyle = '#80808080';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.strokeRect(textAreaLeft, 0, textAreaWidth, 20);
    
    // 文字数カウントを5文字おきに表示
    ctx.fillStyle = '#404040cc';
    ctx.font = '8px sans-serif';
    ctx.textAlign = 'center';
    
    for (let charCount = 5; charCount * charWidth < textAreaWidth; charCount += 5) {
        const x = textAreaLeft + charCount * charWidth;
        if (x > textAreaLeft && x < textAreaLeft + textAreaWidth) {
            // 目盛り線
            ctx.beginPath();
            ctx.moveTo(x, 15);
            ctx.lineTo(x, 20);
            ctx.stroke();
            
            // 文字数表示
            ctx.fillText(charCount.toString(), x, 12);
        }
    }
    
    // 1文字おきの小さな目盛り
    ctx.strokeStyle = '#8080804d';
    for (let charCount = 1; charCount * charWidth < textAreaWidth; charCount++) {
        if (charCount % 5 !== 0) { // 5の倍数以外
            const x = textAreaLeft + charCount * charWidth;
            if (x > textAreaLeft && x < textAreaLeft + textAreaWidth) {
                ctx.beginPath();
                ctx.moveTo(x, 17);
                ctx.lineTo(x, 20);
                ctx.stroke();
            }
        }
    }
    
    ctx.restore();
}

/**
 * 詳細モード状態を設定する関数
 * @param {number} tabIndex タブインデックス
 */
function setDetailModeState(tabIndex) {
    // 詳細モード状態をチェック
    const canvasElement = document.getElementById(`canvas-${tabIndex}`);
    let displayMode = '0';
    if (canvasElement) {
        const windowElement = canvasElement.closest('.window');
        if (windowElement) {
            displayMode = windowElement.dataset.displayMode || '3';
        } else {
            // index.html の場合
            const displayModeSelect = document.getElementById('display-mode-select');
            if (displayModeSelect) {
                displayMode = displayModeSelect.value;
            }
        }
    }
    
    isDetailMode = (displayMode === '2');
    detailModeRulerDrawn = false; // リセット
    logger.debug(`Detail mode state set: ${isDetailMode} for tab ${tabIndex}`);
}

/**
 * 詳細モード時のルーラを描画する関数
 */
function drawDetailModeRulerAsSegment() {
    if (!isDetailMode || detailModeRulerDrawn || !ctx) {
        return;
    }
    
    logger.debug('Drawing detail mode ruler as segment');
    
    // ルーラの幅を計算
    let rulerWidth = 1200; // デフォルト幅
    if (paperSize && paperSize.width) {
        rulerWidth = paperSize.width;
    } else if (canvas) {
        rulerWidth = canvas.width;
    }
    
    // 本文レイアウト領域の左端を計算
    let textAreaLeft = 0;
    let textAreaWidth = rulerWidth;
    
    if (paperSize && paperMargin) {
        // 用紙指定とマージン指定がある場合
        const currentPageNumber = typeof pageNumber !== 'undefined' ? pageNumber : 1;
        const isEvenPage = (currentPageNumber % 2) === 0;
        
        // 物理的な左右マージンを計算
        let shouldSwap = false;
        if (paperSize.binding === 1) {
            shouldSwap = true;
        }
        if (paperSize.binding === 0 && paperSize.imposition === 1 && isEvenPage) {
            shouldSwap = true;
        }
        if (paperSize.binding === 1 && paperSize.imposition === 1 && !isEvenPage) {
            shouldSwap = false;
        }
        
        let marginPhysicalLeft, marginPhysicalRight;
        if (shouldSwap) {
            marginPhysicalLeft = paperMargin.right;
            marginPhysicalRight = paperMargin.left;
        } else {
            marginPhysicalLeft = paperMargin.left;
            marginPhysicalRight = paperMargin.right;
        }
        
        textAreaLeft = marginPhysicalLeft;
        textAreaWidth = paperSize.width - marginPhysicalLeft - marginPhysicalRight;
    }
    
    ctx.save();
    
    // 標準文字サイズ（9.6）での文字幅を計算
    const standardCharSize = defaultFontSize;
    const charWidth = standardCharSize * 0.8; // 文字幅の概算
    const rulerHeight = 20;
    
    // ルーラ背景（薄いグレー）
    ctx.fillStyle = '#f0f0f0cc';
    ctx.fillRect(textAreaLeft, textHeight, textAreaWidth, rulerHeight);
    
    // ルーラ枠線
    ctx.strokeStyle = '#80808080';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.strokeRect(textAreaLeft, textHeight, textAreaWidth, rulerHeight);
    
    // 文字数カウントを5文字おきに表示
    ctx.fillStyle = '#404040cc';
    ctx.font = '8px sans-serif';
    ctx.textAlign = 'center';
    
    for (let charCount = 5; charCount * charWidth < textAreaWidth; charCount += 5) {
        const x = textAreaLeft + charCount * charWidth;
        if (x > textAreaLeft && x < textAreaLeft + textAreaWidth) {
            // 目盛り線
            ctx.beginPath();
            ctx.moveTo(x, textHeight + rulerHeight - 5);
            ctx.lineTo(x, textHeight + rulerHeight);
            ctx.stroke();
            
            // 文字数表示
            ctx.fillText(charCount.toString(), x, textHeight + rulerHeight - 8);
        }
    }
    
    // 1文字おきの小さな目盛り
    ctx.strokeStyle = '#8080804d';
    for (let charCount = 1; charCount * charWidth < textAreaWidth; charCount++) {
        if (charCount % 5 !== 0) { // 5の倍数以外
            const x = textAreaLeft + charCount * charWidth;
            if (x > textAreaLeft && x < textAreaLeft + textAreaWidth) {
                ctx.beginPath();
                ctx.moveTo(x, textHeight + rulerHeight - 3);
                ctx.lineTo(x, textHeight + rulerHeight);
                ctx.stroke();
            }
        }
    }
    
    ctx.restore();
    
    // textHeightをルーラ分進める
    textHeight += rulerHeight;
    detailModeRulerDrawn = true;
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
 *      logger.debug(charTronCode(tadSeg8[offsetLen]));
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
    //logger.debug("UB_SubID" + SubID);
    return SubID;
}

/**
 * UHからUB ATTRを取得
 * @param {UH} UH 
 * @returns 
 */
function getLastUBinUH(UH) {
    const ATTR = ( UH & 0b11111111);  // 全8ビットを取得するように修正
    //logger.debug("ATTR" + ATTR);
    return ATTR;
}

/**
 * 下位UBをUHから取得する
 * @param {UH} UH 
 * @returns 
 */
function getBottomUBinUH(UH) {
    const bottomUB = (UH & 0xFF);
    //logger.debug("Bottom UB: " + bottomUB);
    return bottomUB;
}

/**
 * UUID v7を生成する（RFC 9562準拠）
 * タイムスタンプベースの時系列順UUID
 * @returns {string} UUID v7文字列（8-4-4-4-12形式）
 */
function generateUUIDv7() {
    // 現在時刻のミリ秒タイムスタンプ（48ビット使用）
    const timestamp = Date.now();

    // 暗号学的に安全な乱数を生成（10バイト = 80ビット、うち74ビット使用）
    const randomBytes = new Uint8Array(10);
    // ブラウザ環境とNode.js環境の両方に対応
    if (typeof window !== 'undefined' && window.crypto) {
        window.crypto.getRandomValues(randomBytes);
    } else if (typeof globalThis !== 'undefined' && globalThis.crypto) {
        globalThis.crypto.getRandomValues(randomBytes);
    } else {
        // フォールバック: Math.randomを使用（非推奨だが互換性のため）
        for (let i = 0; i < randomBytes.length; i++) {
            randomBytes[i] = Math.floor(Math.random() * 256);
        }
    }

    // UUID v7の構造 (RFC 9562準拠):
    // - 48ビット: unix_ts_ms (Unixエポックからのミリ秒タイムスタンプ)
    // - 4ビット: version (0111 = 7)
    // - 12ビット: rand_a (ランダムビット)
    // - 2ビット: variant (10)
    // - 62ビット: rand_b (ランダムビット)
    // 合計ランダムビット: 74ビット (12 + 62)

    // タイムスタンプを16進数文字列に変換（12桁）
    const timestampHex = timestamp.toString(16).padStart(12, '0');

    // ランダムバイトを16進数に変換
    const randomHex = Array.from(randomBytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

    // UUID v7フォーマットに組み立て
    // time_high (32ビット) + time_mid (16ビット)
    const timeLow = timestampHex;

    // time_hi_and_version: ランダム12ビット + バージョン4ビット(0111)
    const timeHiAndVersion = '7' + randomHex.substring(0, 3);

    // clock_seq_hi_and_reserved: バリアント2ビット(10) + ランダム6ビット
    const clockSeqByte = parseInt(randomHex.substring(3, 5), 16);
    const clockSeqHi = ((clockSeqByte & 0x3F) | 0x80).toString(16).padStart(2, '0');

    // clock_seq_low: ランダム8ビット
    const clockSeqLow = randomHex.substring(5, 7);

    // node: ランダム48ビット
    const node = randomHex.substring(7, 19);

    // 8-4-4-4-12フォーマットで結合
    return `${timeLow.substring(0, 8)}-${timeLow.substring(8, 12)}-${timeHiAndVersion}-${clockSeqHi}${clockSeqLow}-${node}`;
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
        logger.debug(`parseColor: transparent=${transparentMode}, modeBits=${modeBits}, rgb28=${color28}`);
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
        logger.debug(`parseColor: transparent=${transparentMode}, modeBits=${modeBits}, r=${r}, g=${g}, b=${b}`);
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
    logger.debug("make_crctable");
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
    //logger.debug("UPDATE_CRC");
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
            logger.error("LH5Decoder is not initialized!");
            return -1;
        }
        
        // Check if LH5Decoder is properly initialized with fileData
        if (!lh5Decoder.fileData || !lh5Decoder.initialized) {
            // Try to initialize LH5Decoder dynamically if raw data is available
            if (tadRawDataArray[currentFileIndex]) {
                logger.debug(`Attempting dynamic LH5 decoder initialization for currentFileIndex=${currentFileIndex}`);
                try {
                    lh5Decoder.init(tadRawDataArray[currentFileIndex], tadPos, gHead.compSize, gHead.origSize);
                    lh5Decoder.initialized = true;
                    logger.debug("LH5Decoder dynamically initialized successfully");
                } catch (error) {
                    logger.error("Failed to dynamically initialize LH5Decoder:", error);
                    return -1;
                }
            } else {
                logger.error("LH5Decoder is not properly initialized - fileData missing or not initialized");
                logger.debug("Current fileData:", lh5Decoder.fileData ? 'exists' : 'null');
                logger.debug("Initialized flag:", lh5Decoder.initialized);
                logger.debug(`tadRawDataArray[${currentFileIndex}]:`, tadRawDataArray[currentFileIndex]?.length || 'undefined');
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
function pass1() {
    for (let i = 0; i < gHead.nfiles; i++) {
        //const dirName = i.toString();
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
    
    logger.debug(`EXECFUNCRECORD: dlen=${execFuncRecord.dlen}, window_view=${JSON.stringify(execFuncRecord.window_view)}`);
    
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
        logger.debug(`Processing file ${i}, gHead.nfiles=${gHead.nfiles}`);
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
            logger.debug(`Record Head: type=${rhead.type}, subtype=${rhead.subtype}, size=${rhead.size}`);
            
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
                
                logger.debug(`Link Record: fs_name=${link.fs_name}, link_id=${link.link_id}`);

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
                    logger.error(`=== ERROR STORING TAD RECORD ===`);
                    logger.error(`Error storing lHead[${i}] (${lHead[i].name}):`, error);
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
        // tadRecord.fileIndexがlHeadのインデックスなので、それを使ってtadFileIndexを取得
        const lheadIndex = record.fileIndex;
        const tadFileIndex = lheadToCanvasMap[lheadIndex];
        const nfiles = (typeof gHead !== 'undefined' && gHead.nfiles) ? gHead.nfiles : 1;


        if (tadFileIndex !== undefined) {
            // 現在のファイルインデックスを設定してからtadDataArrayを呼び出す
            currentFileIndex = tadFileIndex;
            tadDataArray(record.data, false, nfiles, currentFileIndex, false);
            logger.debug(`Completed tadDataArray processing for tadFileIndex ${tadFileIndex}`);
        } else {
            logger.debug(`Warning: No tadFileIndex mapping found for lHead[${lheadIndex}] during processing`);
        }
    }
}

/**
 * SCALE型データをパースして実際の幅（ピクセル）を取得
 * @param {number} scaleData SCALE型データ（UH形式）
 * @param {number} baseFontSize 基準となるフォントサイズ
 * @param {number} h_unit 水平方向の座標系単位
 * @param {number} v_unit 垂直方向の座標系単位
 * @param {boolean} isVertical 縦書きかどうか
 * @returns {number} 実際の幅（ピクセル）
 */
function parseScaleWidth(scaleData, baseFontSize, h_unit, v_unit, isVertical = false) {
    const msb = (scaleData >> 15) & 0x01;  // MSBを取得

    if (msb === 1) {
        // MSBが1の場合: 絶対指定 (1NNNNNNNNNNNNNNN)
        const absoluteValue = scaleData & 0x7FFF;  // 下位15ビット
        const unit = isVertical ? v_unit : h_unit;
        return absoluteValue * unit;
    } else {
        // MSBが0の場合: 比率指定 (0AAAAAAAABBBBBBBB)
        const A = (scaleData >> 8) & 0x7F;   // 上位7ビット (比率の分子)
        const B = scaleData & 0xFF;          // 下位8ビット (比率の分母)

        const denominator = B === 0 ? 1 : B;  // B=0の場合は比率1
        const ratio = A / denominator;

        // 基準値は文字サイズの縦方向のpx数
        return baseFontSize * ratio;
    }
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
        logger.debug("TadVer " + tadVer);
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

    // XMLパース出力
    if (isXmlDumpEnabled()) {
        logger.debug('tsTextStart: Adding <doc> to xmlBuffer');
        xmlBuffer.push('<document>\r\n<p>\r\n');
        isInDocSegment = true;
        isXmlTad = true;
        currentIndentLevel++;
    }
    
    let textChar = new STARTTEXTSEG();
    if (!startTadSegment) {
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
    lineMaxHeight[textRow] = textFontSize;

    let viewW = 0;
    let viewH = 0;
    let drawW = 0;
    let drawH = 0;

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

        viewW = textChar.view.right - textChar.view.left;
        viewH = textChar.view.bottom - textChar.view.top;
        drawW = textChar.draw.right - textChar.draw.left;
        drawH = textChar.draw.bottom - textChar.draw.top;

        if (isXmlDumpEnabled()) {
            xmlBuffer.push(`<text viewleft="${textChar.view.left}" viewtop="${textChar.view.top}" viewright="${textChar.view.right}" viewbottom="${textChar.view.bottom}" drawleft="${textChar.draw.left}" drawtop="${textChar.draw.top}" drawright="${textChar.draw.right}" drawbottom="${textChar.draw.bottom}"/>\r\n`);
        }
    }

    logger.debug(`view: left=${textChar.view.left}, top=${textChar.view.top}, right=${viewW}, bottom=${viewH}`);
    logger.debug(`draw: left=${textChar.draw.left}, top=${textChar.draw.top}, right=${drawW}, bottom=${drawH}`);
    logger.debug(`h_unit ${textChar.h_unit}, v_unit ${textChar.v_unit}, lang ${textChar.lang}, bgpat ${textChar.bpat}`);

    textCharPoint.push([textChar.view.left,textChar.view.top,viewW,viewH,textChar.draw.left,textChar.draw.top,drawW,drawH]);
    textCharData.push(textChar);
    
    // 詳細モード時のルーラを描画（文章開始時）
    drawDetailModeRulerAsSegment();
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
function drawText(targetCtx, targetCanvas, char, nextChar, textfontSize, startX, startY, width, textPitch, linePitch, align) {
    // パラメータとして受け取ったcanvasとctxを使用
    if (!targetCtx || !targetCanvas) {
        logger.error('ctx and canvas must be provided as parameters in drawText');
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

    // 固定幅空白の処理
    if (fixedWidthSpaceState.active) {
        // 現在の文章開始セグメントの座標系単位を取得
        const h_unit = textCharPoint[textNest-1][5] || 1;
        const v_unit = textCharPoint[textNest-1][6] || 1;
        const isVertical = (textCharPoint[textNest-1][7] === 1) || false;

        // SCALE型データをピクセル幅に変換
        const spaceWidth = parseScaleWidth(fixedWidthSpaceState.scaleData, textfontSize, h_unit, v_unit, isVertical);

        logger.debug(`固定幅空白処理: width=${IntToHex(fixedWidthSpaceState.scaleData, 4)}, calculated=${spaceWidth}px`);

        // 行末までに収まらない場合は次行に追い出し
        if (textWidth + spaceWidth > width) {
            logger.debug("固定幅空白: 行末に収まらないため次行に追い出し");

            // 改行処理
            textHeight += lineMaxHeight[textRow];
            textRow++;
            lineMaxHeight.push(linePitch);
            textWidth = 0;
            textColumn = 0;
            currentLineOffset = 0;

            if (tabRulerLineMoveFlag) {
                logger.debug("行頭移動処理");
                for (let tabLoop = 0; tabLoop < tabRulerLinePoint; tabLoop++) {
                    textWidth += ctx.measureText("　").width;
                    textColumn++;
                }
            }
        }

        // グローバルのwidthよりも長い場合は、行頭から行末まで一行のみ取る
        const finalWidth = Math.min(spaceWidth, width);

        // 空白を描画（視覚的には何も描画しないが、位置を進める）
        textWidth += finalWidth;
        textColumn += Math.ceil(finalWidth / ctx.measureText(" ").width);

        logger.debug(`固定幅空白描画完了: width=${finalWidth}px, newTextWidth=${textWidth}`);

        // 固定幅空白状態をリセット
        fixedWidthSpaceState.active = false;
        fixedWidthSpaceState.scaleData = 0;
    }

    if (lineMaxHeight.length == 0) {
        lineMaxHeight.push(lineHeight);
    }

    if (lineMaxHeight[textRow] < lineHeight) {
        lineMaxHeight[textRow] = lineHeight;
    }

    // ctxの最終確認とフォント設定を適用
    if (!ctx) {
        logger.error('ctx is still undefined in drawText after parameter assignment. targetCtx was:', targetCtx);
        return;
    }
    
    ctx.fillStyle = textFontColor;
    ctx.font = textFontSet;
    ctx.textBaseline = "alphabetic";  // ベースライン基準に変更
    ctx.textAlign = "left"; // 常に左揃えで描画し、位置は手動計算


    const currentCharWidth = ctx.measureText(char).width;
    const WidthOver = (textWidth + currentCharWidth > width);
    let shouldBreak = false;
    let nextCharWidth = 0;
    if (nextChar !== null) {
        nextCharWidth = ctx.measureText(nextChar).width;
    }
    

    // 次の文字で改行要になる場合
    if (!WidthOver && nextChar !== null && (textWidth + currentCharWidth * (1 + textPitch) + nextCharWidth > width)) {
        if (lineStartProhibitionState.active && lineStartProhibitionState.method === 1) {
            // 行頭禁則方法1の処理: 次の文字が行頭で行頭禁則文字の場合、今の文字を行頭に追い出す
            const isProhibitedNext = checkLineStartProhibition(nextChar);
            if (isProhibitedNext) {
                shouldBreak = true;
                cantNextLineFlg = 0; // 次の文字で改行しないフラグをリセット
            }
        }
        if (lineEndProhibitionState.active && lineEndProhibitionState.method === 1) {
            // 行末禁則方法1の処理: 今の文字が行末で行末禁則文字の場合、今の文字を行頭に追い出す
            const isProhibitedCurrent = checkLineEndProhibition(char);
            if (isProhibitedCurrent) {
                shouldBreak = true;
                cantNextLineFlg = 0; // 次の文字で改行しないフラグをリセット
            }
        }
        if (lineStartProhibitionState.active && lineStartProhibitionState.method === 2) {
            // 行頭禁則方法2の処理: 次の文字が行頭で行頭禁則文字の場合、前行の行末に追い込む
            const isProhibitedNext = checkLineStartProhibition(nextChar);
            if (isProhibitedNext) {
                shouldBreak = false;
                cantNextLineFlg = 2; // 次の文字も改行しない
            }
        }
    }

    // 折り返し処理
    if (WidthOver && cantNextLineFlg == 0) {
        shouldBreak = true;
    }

    // 通常の改行処理
    if (shouldBreak) {
        textHeight += lineMaxHeight[textRow];
        textRow++;
        lineMaxHeight.push(linePitch);
        textWidth = 0;
        textColumn = 0;
        currentLineOffset = 0; // 行オフセットをリセット
        if (tabRulerLineMoveFlag) {
            logger.debug("行頭移動処理");
            for (let tabLoop = 0;tabLoop < tabRulerLinePoint; tabLoop++) {
                textWidth += ctx.measureText("　").width;
                textColumn++;
            }
        }
    }

    if (cantNextLineFlg > 0) {
        cantNextLineFlg -= 1;
    }

    // 改段落処理
    if (char == String.fromCharCode(Number(TC_NL))) {
        textHeight += lineMaxHeight[textRow];
        textRow++;
        lineMaxHeight.push(linePitch);
        textWidth = 0;
        textColumn = 0;
        if (tabRulerLineMoveFlag) {
            tabRulerLineMoveFlag = false;
        }
        cantNextLineFlg = 0;

        // XMLパース出力
        if (isXmlDumpEnabled()) {
            const xmlChar = `</p>\r\n<p>\r\n`;
            xmlBuffer.push(xmlChar);
        }
    // 改行処理
    } else if (char == String.fromCharCode(Number(TC_CR))) {
        textHeight += lineMaxHeight[textRow];
        textRow++;
        lineMaxHeight.push(linePitch);
        textWidth = 0;
        textColumn = 0;
        if (tabRulerLineMoveFlag) {
            logger.debug("行頭移動処理");
            for (let tabLoop = 0;tabLoop < tabRulerLinePoint; tabLoop++) {
                textWidth += ctx.measureText("　").width;
                textColumn++;
            }
        }
        cantNextLineFlg = 0;

                // XMLパース出力
        if (isXmlDumpEnabled()) {
            const xmlChar = `<br/>\r\n`;
            xmlBuffer.push(xmlChar);
        }

    // 改ページ処理
    } else if (char == String.fromCharCode(Number(TC_NC)
        || char == String.fromCharCode(Number(TC_FF)))) {

        textHeight += lineMaxHeight[textRow];
        textRow++;
        lineMaxHeight.push(linePitch);
        textWidth = 0;
        textColumn = 0;
        if (tabRulerLineMoveFlag) {
            tabRulerLineMoveFlag = false;
        }
        cantNextLineFlg = 0;
    // Tab処理
    } else if (char == String.fromCharCode(Number(TC_TAB))) {
        logger.debug("Tab処理");
        for (let tabLoop = 0;tabLoop < tabCharNum; tabLoop++) {
            textWidth += ctx.measureText("　").width;
            textColumn++;
            cantNextLineFlg = 0;
        }
    } else {
        const padding = 0;
        // 通常文字の描画処理
        const charY = startY + textHeight + textfontSize;  // シンプルな文字位置
        const charWidth = ctx.measureText(char).width;
        let charX = 0 + padding + startX + textWidth;
        
        // 左揃えの基本位置を計算（文字間隔の基準）
        //const baseCharX = startX + textWidth;
        
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
                    ctx.shadowColor = '#00000080';
                    ctx.shadowBlur = 2;
                    ctx.shadowOffsetX = 2;
                    ctx.shadowOffsetY = 2;
                } else if (textShadowStyle === 'white') {
                    ctx.shadowColor = '#ffffffcc';
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
            // ルビモード中の場合、被ルビ文字列を収集
            if (rubyState.active) {
                // 最初の文字の位置を記録
                if (rubyState.baseText === '') {
                    rubyState.startX = actualCharX;
                    rubyState.startY = actualCharY;
                }
                rubyState.baseText += char;
                // 最後の文字の位置を更新（文字幅を考慮）
                if (textDirection === 1 || textDirection === 3) {
                    // 縦書きの場合
                    rubyState.endX = actualCharX;
                    rubyState.endY = actualCharY + textfontSize;
                } else {
                    // 横書きの場合
                    rubyState.endX = actualCharX + textfontSize;
                    rubyState.endY = actualCharY;
                }
            }

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

    // XMLパース出力
    if (isXmlDumpEnabled() && isInDocSegment) {
        logger.debug('tsTextEnd: Adding </document> to xmlBuffer');
        currentIndentLevel--;
        xmlBuffer.push('\r\n</document>\r\n');
        isInDocSegment = false;
        isXmlTad = false;
    }

    // セグメントスタックから文章セグメントを削除
    if (segmentStack.length > 0 && segmentStack[segmentStack.length - 1] === SEGMENT_TYPE.TEXT) {
        segmentStack.pop();
    }
    // 現在のセグメントタイプを更新
    currentSegmentType = segmentStack.length > 0 ? segmentStack[segmentStack.length - 1] : SEGMENT_TYPE.NONE;

    const textChar = textCharData[textNest-1];

    logger.debug("Text      : " + textCharList[textNest-1]);
    logger.debug("TextPoint : " + textChar.view.left, textChar.view.top, textChar.view.right, textChar.view.bottom, textChar.draw.left, textChar.draw.top, textChar.draw.right, textChar.draw.bottom);


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

    logger.debug(`Paper attr: 0x${ATTR.toString(16).padStart(2, '0')} (binding=${paperSize.binding}, imposition=${paperSize.imposition})`);
    logger.debug("length " + IntToHex((tadSeg[1]),4).replace('0x',''));
    logger.debug("width  " + IntToHex((tadSeg[2]),4).replace('0x',''));
    logger.debug(`Paper overlay margins (logical): top=${IntToHex((tadSeg[3]),4).replace('0x','')}, bottom=${IntToHex((uh2h(tadSeg[4])),4).replace('0x','')}, left(gutter)=${IntToHex((uh2h(tadSeg[5])),4).replace('0x','')}, right(fore-edge)=${IntToHex((uh2h(tadSeg[6])),4).replace('0x','')}`);

    // 用紙サイズを設定
    paperSize.length = Number(tadSeg[1]);
    paperSize.width = Number(tadSeg[2]);
    
    // オーバーレイ領域までのマージンを設定（論理値として保存）
    paperSize.top = Number(tadSeg[3]);
    paperSize.bottom = Number(uh2h(tadSeg[4]));
    
    // 論理的なleft（ノド）とright（小口）の値をそのまま保存
    paperSize.left = Number(uh2h(tadSeg[5]));   // ノド（綴じ側）
    paperSize.right = Number(uh2h(tadSeg[6]));  // 小口（開き側）
    
    logger.debug(`Logical overlay margins stored: left(gutter)=${paperSize.left}, right(fore-edge)=${paperSize.right}`);
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

    // 前のマージン値を保存（継承用）
    const previousMargin = paperMargin ? {
        top: paperMargin.top,
        bottom: paperMargin.bottom,
        left: paperMargin.left,
        right: paperMargin.right
    } : null;

    // PaperMarginクラスのインスタンスを作成（まだ存在しない場合）
    if (paperMargin === null) {
        paperMargin = new PaperMargin();
    }

    logger.debug(`Margin raw values: top=${IntToHex((tadSeg[1]),4).replace('0x','')}, bottom=${IntToHex((tadSeg[2]),4).replace('0x','')}, left(gutter)=${IntToHex((tadSeg[3]),4).replace('0x','')}, right(fore-edge)=${IntToHex((tadSeg[4]),4).replace('0x','')}`);

    // マージン値を取得（0xffffの場合は前の値を継承）
    const topValue = Number(tadSeg[1]);
    const bottomValue = Number(tadSeg[2]);
    const leftValue = Number(tadSeg[3]);
    const rightValue = Number(tadSeg[4]);
    
    // 0xffffの場合は前の値を継承、そうでなければ新しい値を設定（論理値として保存）
    paperMargin.top = (topValue === 0xffff && previousMargin) ? previousMargin.top : topValue;
    paperMargin.bottom = (bottomValue === 0xffff && previousMargin) ? previousMargin.bottom : bottomValue;
    paperMargin.left = (leftValue === 0xffff && previousMargin) ? previousMargin.left : leftValue;     // ノド（綴じ側）
    paperMargin.right = (rightValue === 0xffff && previousMargin) ? previousMargin.right : rightValue;  // 小口（開き側）
    
    logger.debug(`Logical text layout margins stored: top=${paperMargin.top}, bottom=${paperMargin.bottom}, left(gutter)=${paperMargin.left}, right(fore-edge)=${paperMargin.right}`);
    
    // 継承されたマージンがある場合はログ出力
    if (topValue === 0xffff && previousMargin) logger.debug(`  top margin inherited: ${paperMargin.top}`);
    if (bottomValue === 0xffff && previousMargin) logger.debug(`  bottom margin inherited: ${paperMargin.bottom}`);
    if (leftValue === 0xffff && previousMargin) logger.debug(`  left margin inherited: ${paperMargin.left}`);
    if (rightValue === 0xffff && previousMargin) logger.debug(`  right margin inherited: ${paperMargin.right}`);

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
    if (startByImageSegment) {
        return;
    }
    // TODO: 未実装
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
    
    logger.debug(`Conditional page break: cond=${cond}, remain=${IntToHex(remain, 4)}`);
    
    // 現在のページ数を取得（ページ番号ではなくページ数）
    const currentPageCount = typeof pageCount !== 'undefined' ? pageCount : 1;
    
    let shouldBreak = false;
    
    switch (cond) {
        case 0x00:
            // 偶数ページの場合は改ページ
            if (currentPageCount % 2 === 0) {
                shouldBreak = true;
                logger.debug(`Page break on even page (page count: ${currentPageCount})`);
            }
            break;
            
        case 0x01:
            // 奇数ページの場合は改ページ
            if (currentPageCount % 2 === 1) {
                shouldBreak = true;
                logger.debug(`Page break on odd page (page count: ${currentPageCount})`);
            }
            break;
            
        case 0x02: {
            // ページの残り描画域の長さがremain以下の場合は改ページ
            const remainValue = parseScaleValue(remain);
            const pageHeight = getPageHeight();
            const currentYPosition = textHeight;
            const remainingSpace = pageHeight - currentYPosition;
            
            logger.debug(`Remaining space check: remaining=${remainingSpace}, threshold=${remainValue}`);
            
            if (remainingSpace <= remainValue) {
                shouldBreak = true;
                logger.debug(`Page break due to insufficient space (remaining: ${remainingSpace} <= ${remainValue})`);
            }
            break;
        }
            
        default:
            logger.warn(`Unknown page break condition: ${cond}`);
            break;
    }
    
    // 改ページを実行
    if (shouldBreak) {
        performPageBreak();
    }
}

/**
 * SCALE型の値を解析
 * @param {number} scaleValue SCALE型の値
 * @returns {number} 座標系単位での値
 */
function parseScaleValue(scaleValue) {
    const msb = (scaleValue >> 15) & 0x01;
    
    if (msb === 0) {
        // 比率指定（0AAAAAAABBBBBBBB）
        const a = (scaleValue >> 8) & 0x7F;
        const b = scaleValue & 0xFF;
        
        if (b === 0) {
            // B=0の場合は比率1
            return a;
        } else {
            // A/B比率
            return Math.floor(a / b * getPageHeight());
        }
    } else {
        // 絶対指定（1NNNNNNNNNNNNNNN）
        const absoluteValue = scaleValue & 0x7FFF;
        return absoluteValue;
    }
}

/**
 * ページの高さを取得
 * @returns {number} ページの高さ
 */
function getPageHeight() {
    // 用紙モードが有効な場合は用紙の高さを返す
    if (paperSize && paperSize.length) {
        return paperSize.length;
    }
    
    // それ以外はキャンバスの高さを返す
    if (canvas) {
        return canvas.height;
    }
    
    // デフォルト値
    return 1000;
}

/**
 * 改ページを実行
 */
function performPageBreak() {
    // 現在の描画位置を保存
    const prevTextHeight = textHeight;
    
    // ページ区切り線を描画（薄い灰色の点線）
    if (ctx) {
        ctx.save();
        ctx.strokeStyle = '#8080804d';
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);
        
        // 用紙モードの場合は用紙幅、そうでない場合はキャンバス幅
        const lineWidth = (paperSize && paperSize.width) ? paperSize.width : 
                         (canvas ? canvas.width : 1200);
        
        ctx.beginPath();
        ctx.moveTo(0, prevTextHeight);
        ctx.lineTo(lineWidth, prevTextHeight);
        ctx.stroke();
        
        ctx.restore();
    }
    
    // 次のページの先頭に移動
    const pageHeight = getPageHeight();
    const currentPage = Math.floor(textHeight / pageHeight);
    textHeight = (currentPage + 1) * pageHeight;
    
    // ページ数をインクリメント
    if (typeof pageCount !== 'undefined') {
        pageCount++;
    }
    
    logger.debug(`Page break performed: from Y=${prevTextHeight} to Y=${textHeight}`);
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

    logger.debug(`用紙オーバーレイ定義: オーバーレイ番号=${overlayNumber}, 偶数ページ適用=${applyToEvenPages}, 奇数ページ適用=${applyToOddPages}`);

    // overlayDataはTAD文字列として保存
    let overlayData = [];
    for (let i = 0; i < segLen; i++) {
        overlayData.push(tadSeg[i]);
    }

    // グローバル変数またはオブジェクトに保存（後で使用するため）
    // TODO: オーバーレイデータの保存処理を実装
    if (!window.paperOverlays) {
        window.paperOverlays = {};
    }
    window.paperOverlays[overlayNumber] = {
        data: overlayData,
        applyToEvenPages: applyToEvenPages,
        applyToOddPages: applyToOddPages
    };
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
                    logger.debug(`オーバーレイ${i}番を有効化`);
                }
            } else {
                logger.debug(`オーバーレイ${i}番は未定義のため有効化できません`);
            }
        } else {
            // オーバーレイを無効化（ビットが0の場合）
            // 以前アクティブだった場合はログ出力
            if (previousOverlays.includes(i)) {
                logger.debug(`オーバーレイ${i}番を無効化`);
            }
        }
    }

    // 描画順序でソート（0番が最下層、15番が最上層）
    window.activeOverlays.sort((a, b) => a - b);

    logger.debug(`用紙オーバーレイ指定: アクティブオーバーレイ=[${window.activeOverlays.join(', ')}]`);

    // このページから適用を開始するためのフラグ
    window.overlayAppliedFromPage = currentPage;
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

    logger.debug(`図形TAD用紙オーバーレイ定義: オーバーレイ番号=${overlayNumber}, 偶数ページ適用=${applyToEvenPages}, 奇数ページ適用=${applyToOddPages}`);

    // overlayDataはTAD文字列として保存
    let overlayData = [];
    for (let i = 0; i < segLen; i++) {
        overlayData.push(tadSeg[i]);
    }

    // 図形TAD用のオーバーレイとして保存（文書TADとは別管理）
    if (!window.figurePaperOverlays) {
        window.figurePaperOverlays = {};
    }
    window.figurePaperOverlays[overlayNumber] = {
        data: overlayData,
        applyToEvenPages: applyToEvenPages,
        applyToOddPages: applyToOddPages,
        type: 'figure'  // 図形TADであることを示すフラグ
    };
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
                    logger.debug(`図形TADオーバーレイ${i}番を有効化`);
                }
            } else {
                logger.debug(`図形TADオーバーレイ${i}番は未定義のため有効化できません`);
            }
        } else {
            // オーバーレイを無効化（ビットが0の場合）
            if (previousOverlays.includes(i)) {
                logger.debug(`図形TADオーバーレイ${i}番を無効化`);
            }
        }
    }

    // 描画順序でソート（0番が最下層、15番が最上層）
    window.figureActiveOverlays.sort((a, b) => a - b);

    logger.debug(`図形TAD用紙オーバーレイ指定: アクティブオーバーレイ=[${window.figureActiveOverlays.join(', ')}]`);

    // このページから適用を開始するためのフラグ
    window.figureOverlayAppliedFromPage = currentPage;
}

/**
 * ページ指定付箋共通から付箋を判定
 * @param {int} segLen
 * @param {0x0000[]} tadSeg
 */
function tadPageSetFusen(segLen, tadSeg) {
    const UB_SubID = getTopUBinUH(tadSeg[0]);

    if (UB_SubID === Number(0x00)) {
        logger.debug("用紙指定付箋");
        tsDocSizeOfPaperSetFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x01)) {
        logger.debug("マージン指定付箋");
        tsDocSizeOfMarginSetFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x02)) {
        logger.debug("コラム指定付箋");
        tsSizeOfColumnSetFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x03)) {
        logger.debug("用紙オーバーレイ定義付箋");
        tsDocSizeOfPaperOverlayDefineFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x04)) {
        logger.debug("用紙オーバーレイ指定付箋");
        tsDocSizeOfPaperOverlaySetFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x05)) {
        logger.debug("枠あけ指定付箋");
        // TODO: 未実装
    } else if (UB_SubID === Number(0x06)) {
        logger.debug("ページ番号指定付箋");
        // TODO: 未実装
    } else if (UB_SubID === Number(0x07)) {
        logger.debug("条件改ページ指定付箋");
        tsPageBreakConditionFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x08)) {
        logger.debug("充填行指定付箋");
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

    logger.debug(`行間隔: ${lineSpacingPitch}, ATTR: ${ATTR}, pitch: ${pitch}, D: ${D}, G: ${G}, msb: ${msb}, a: ${a}, b: ${b}`);

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
    logger.debug("行揃え : " + lineAlign);
    textAlign = lineAlign; // テキストの行揃えも同じ値を使用

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
    textDirection = Number(getLastUBinUH(tadSeg[0]));
    logger.debug("文字方向 : " + textDirection);
}

/**
 * 行頭移動指定付箋を処理
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 */
function tsRulerLineMoveSetFusen(segLen, tadSeg) {
    logger.debug("行頭移動指定付箋セット :" + textColumn);
    tabRulerLineMoveFlag = true;
    tabRulerLinePoint = textColumn;

    // XML出力（文章セグメント内の場合のみ）
    if (isXmlDumpEnabled()) {
        // indent要素として出力（行頭移動指定付箋）
        // タグの直後の文字位置に基づいてインデントを自動計算
        xmlBuffer.push(`<indent/>`);
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
        logger.debug("行間隔指定付箋");
        tsRulerLineSpacingSetFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x01)) {
        logger.debug("行揃え指定付箋");
        tsRulerLineAlignmentSetFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x02)) {
        logger.debug("タブ書式指定付箋");
        // TODO: 未実装
    } else if (UB_SubID === Number(0x03)) {
        logger.debug("フィールド書式指定付箋");
        // TODO: 未実装
    } else if (UB_SubID === Number(0x04)) {
        logger.debug("文字方向指定付箋");
        tsRulerLineDirectionSetFusen(segLen, tadSeg);
        // TODO: 未実装
    } else if (UB_SubID === Number(0x05)) {
        logger.debug("行頭移動指定付箋");
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
    logger.debug(`Font class: 0x${fontClass.toString(16).padStart(4, '0')}`);
    
    // フォント名を取得（TRONコードからの変換）
    let fontName = '';
    for (let offsetLen = 2; offsetLen < tadSeg.length; offsetLen++) {
        const tronChar = charTronCode(tadSeg[offsetLen]);
        if (tronChar) {
            fontName += tronChar;
        }
    }
    
    logger.debug(`Original font name: "${fontName}"`);
    
    // BTRONフォント名からWebフォント名にマッピング、フォントファミリーを更新
    currentFontFamily = mapBTRONFontToWeb(fontName, fontClass);
    updateFontSet();

    // XML出力（文章セグメント内の場合のみ）
    if (isXmlDumpEnabled()) {
        // HTML5のfont要素として出力
        xmlBuffer.push(`<font face="${currentFontFamily}"/>`);
    }

    logger.debug(`Mapped to font family: ${currentFontFamily}`);
}

/**
 * フォントがブラウザで利用可能かチェックする
 * @param {string} fontName フォント名
 * @returns {boolean} フォントが利用可能かどうか
 */
function isFontAvailable(fontName) {
    // ブラウザ環境でない場合は常にfalseを返す
    if (typeof document === 'undefined' || typeof window === 'undefined') {
        return false;
    }
    try {
        // Canvas要素を作成してフォント測定
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        // テスト文字列
        const testString = 'abcdefghijklmnopqrstuvwxyz0123456789あいうえおかきくけこ';
        
        // デフォルトフォントでのサイズを測定
        ctx.font = '72px serif';
        const defaultWidth = ctx.measureText(testString).width;
        
        // 指定フォントでのサイズを測定
        ctx.font = `72px "${fontName}", serif`;
        const testWidth = ctx.measureText(testString).width;
        
        // サイズが異なればそのフォントが利用可能
        return Math.abs(defaultWidth - testWidth) > 0.1;
    } catch (e) {
        logger.debug(`Font availability check failed for "${fontName}":`, e);
        return false;
    }
}

/**
 * BTRONフォント名をWebフォント名にマッピングする
 * @param {string} btronFontName BTRONフォント名
 * @param {number} fontClass フォントクラス
 * @returns {string} Webフォント名
 */
function mapBTRONFontToWeb(btronFontName, fontClass) {
    // 既定のフォントマッピング
    const fontMapping = {
        '明朝体': 'serif, "Yu Mincho", "游明朝", "メイリオ", "Meiryo"',
        'GT書体': 'GT書体, serif',
        'SS細明朝体': '"Yu Mincho Light", "游明朝 Light", serif, "メイリオ", "Meiryo"',
        'SS明朝体': '"Yu Mincho", "游明朝", serif, "メイリオ", "Meiryo"',
        'ゴシック体': 'sans-serif, "MS UI Gothic", "ＭＳ Ｐゴシック", "MS Gothic"',
        'SS教科書体': '"UD デジタル 教科書体 NP-R", "HGP教科書体", "HGPゴシック", "MS Gothic", sans-serif',
        'SS丸ゴシック体': '"HG丸ゴシックM-PRO", "MS Gothic", sans-serif',
        'SSゴシック体': '"Yu Gothic", "游ゴシック", "ＭＳ Ｐゴシック", "MS Gothic", sans-serif',
        'SSCourier': '"Courier New", monospace',
        'SSTimes': '"Times New Roman", serif'
    };
    
    // 完全マッチを探す
    if (fontMapping[btronFontName]) {
        return fontMapping[btronFontName];
    }
    
    // 部分マッチを探す
    for (const [btronName, webFont] of Object.entries(fontMapping)) {
        if (btronFontName.includes(btronName) || btronName.includes(btronFontName)) {
            return webFont;
        }
    }
    
    // 対応表にないフォント名の場合、直接フォント名を試す
    if (btronFontName && btronFontName.trim() !== '') {
        // フォント名をクォートで囲み、フォールバックを追加
        const directFontSpec = `"${btronFontName}", serif`;
        logger.debug(`Trying direct font specification: ${directFontSpec}`);
        
        // ブラウザでフォントが利用可能かチェック
        if (isFontAvailable(btronFontName)) {
            logger.debug(`Font "${btronFontName}" is available on this system`);
            return directFontSpec;
        } else {
            logger.debug(`Font "${btronFontName}" is not available, falling back to font class estimation`);
        }
    }
    
    // フォントクラスに基づく推定
    if (fontClass !== undefined) {
        const classAnalysis = analyzeFontClass(fontClass);
        logger.debug(`Font class analysis:`, classAnalysis);
        
        // フォント選択ロジック
        if (classAnalysis.hasSerifB || classAnalysis.hasSerifC || classAnalysis.isJapanese) {
            // セリフまたは和風の場合は明朝系
            if (classAnalysis.isJapanese) {
                return '"Yu Mincho", "游明朝", "メイリオ", "Meiryo", serif';
            } else {
                return '"Times New Roman", serif';
            }
        } else if (classAnalysis.isSimple || classAnalysis.isModern) {
            // シンプルまたはモダンの場合はゴシック系
            if (classAnalysis.isJapanese) {
                return '"Yu Gothic", "游ゴシック", "MS Gothic", sans-serif';
            } else {
                return 'Arial, sans-serif';
            }
        } else if (classAnalysis.isMonospace) {
            // 等幅フォントの推定（フリーハンド風でない、シンプル、線が途切れていない）
            if (!classAnalysis.isFreehand && classAnalysis.isSimple && !classAnalysis.isBroken) {
                return '"Courier New", monospace';
            }
        }
        
        // デフォルトの判定
        if (classAnalysis.isJapanese) {
            return 'serif'; // 和風は明朝系
        } else {
            return 'sans-serif'; // その他はゴシック系
        }
    }
    
    // デフォルト
    logger.warn(`Unknown BTRON font: "${btronFontName}", using default serif`);
    return 'serif';
}

/**
 * フォントクラスのビット列を解析する
 * @param {number} fontClass 16ビットのフォントクラス値
 * @returns {Object} 解析結果オブジェクト
 */
function analyzeFontClass(fontClass) {
    // ビット位置の定義（MSBから）
    // ABCDEFGHIJKLMMNN (16ビット)
    
    const analysis = {
        // A: 見出し専用文字
        isHeadingOnly: (fontClass & 0x8000) !== 0,
        
        // B: 線の末端に飾りあり
        hasSerifB: (fontClass & 0x4000) !== 0,
        
        // C: 線の末端に飾りあり  
        hasSerifC: (fontClass & 0x2000) !== 0,
        
        // D: 線幅に抑揚あり
        hasVariableWidth: (fontClass & 0x1000) !== 0,
        
        // E: 線の末端が丸い
        hasRoundedEnds: (fontClass & 0x0800) !== 0,
        
        // F: 角が丸い
        hasRoundedCorners: (fontClass & 0x0400) !== 0,
        
        // G: 線が途切れている
        isBroken: (fontClass & 0x0200) !== 0,
        
        // H: フリーハンド風
        isFreehand: (fontClass & 0x0100) !== 0,
        
        // I: 上品である
        isElegant: (fontClass & 0x0080) !== 0,
        
        // J: シンプルである
        isSimple: (fontClass & 0x0040) !== 0,
        
        // K: モダンである
        isModern: (fontClass & 0x0020) !== 0,
        
        // L: 和風である
        isJapanese: (fontClass & 0x0010) !== 0,
        
        // MM: 文字の大きさによる読みやすさ (2ビット)
        sizeReadability: (fontClass & 0x000C) >> 2,
        
        // NN: 線の太さによる読みやすさ (2ビット)
        weightReadability: (fontClass & 0x0003)
    };
    
    // 追加の推定プロパティ
    analysis.hasSerif = analysis.hasSerifB || analysis.hasSerifC;
    analysis.isMonospace = analysis.isSimple && !analysis.hasVariableWidth && !analysis.isFreehand;
    analysis.isDecorative = analysis.hasRoundedCorners || analysis.isBroken || analysis.isFreehand;
    
    // 読みやすさの解釈
    analysis.sizeReadabilityText = ['常に読みやすい', '小さいと読みにくい', '大きいと読みにくい', '常に読みにくい'][analysis.sizeReadability];
    analysis.weightReadabilityText = ['常に読みやすい', '細いと読みにくい', '太いと読みにくい', '常に読みにくい'][analysis.weightReadability];
    
    return analysis;
}

/**
 * フォントセットを更新する
 */
function updateFontSet() {
    const fontParts = [];
    
    // フォントスタイル
    if (textFontStyle !== 'normal') {
        fontParts.push(textFontStyle);
    }
    
    // フォント変形
    if (textFontStretch !== 'normal') {
        fontParts.push(textFontStretch);
    }
    
    // フォント重み
    if (textFontWeight !== defaultFontWeight) {
        fontParts.push(textFontWeight.toString());
    }
    
    // フォントサイズ
    fontParts.push(textFontSize + 'px');
    
    // フォントファミリー
    fontParts.push(currentFontFamily);
    
    textFontSet = fontParts.join(' ');
    
    logger.debug(`Font set updated: ${textFontSet}`);
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

    if (isXmlDumpEnabled && oldBagChar !== textDecorations.bagChar) {
        if(!oldBagChar){
            logger.debug("袋文字ON")
            xmlBuffer.push("<bagchar>");
        } else {
            logger.debug("袋文字OFF");
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
    if (isXmlDumpEnabled && oldItalic !== textDecorations.italic) {
        if(!oldItalic){
            logger.debug("斜体ON")
            xmlBuffer.push("<i>");
        } else {
            logger.debug("斜体OFF");
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
    if (isXmlDumpEnabled && oldBold !== textDecorations.bold) {
        if(!oldBold){
            logger.debug("太字ON")
            xmlBuffer.push("<strong>");
        } else {
            logger.debug("太字OFF");
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
    
    // グローバル変数に設定を反映
    textFontStyle = fontStyle;
    textFontWeight = fontWeight;
    textFontStretch = fontStretch;
    textScaleX = scaleX;
    textSkewAngle = skewAngle;
    textStrokeStyle = strokeStyle;
    textShadowStyle = shadowStyle;
    
    // フォント設定を更新
    updateFontSet();
    
    logger.debug(`Font type set - spacing:${spacing}, direction:${direction}, lineType:${lineType}, italic:${italic}, weight:${weight}, width:${width}`);
    logger.debug(`Applied - style:${fontStyle}, weight:${fontWeight}, stretch:${fontStretch}, scaleX:${scaleX}, stroke:${strokeStyle}, shadow:${shadowStyle}`);
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
        logger.debug("ptsize  " + textFontSize );
        updateFontSet(); // フォント設定を更新
    } else if (tadSeg[1] & U1) {
        logger.debug("Qsize   " + tadSize);
        textFontSize = (tadSeg[1] & sizeMask) / (20 * 0.3528);
        updateFontSet(); // フォント設定を更新
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
    logger.debug(`文字間隔: ${textSpacingPitch}, ATTR: ${ATTR}, pitch: ${pitch}, textSpacingDirection: ${textSpacingDirection}, textSpacingKerning: ${textSpacingKerning}, textSpacingPattern: ${textSpacingPattern}, msb: ${msb}, a: ${a}, b: ${b}`);

    // XML出力（文章セグメント内の場合のみ）
    if(isXmlDumpEnabled) {
        xmlBuffer.push(`<font space="${textSpacingPitch}"/>`);
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
    logger.debug("文字カラー : " + color.color);
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
        logger.debug("フォント指定付箋");
        tsFontNameSetFusen(segLen,tadSeg);
    } else if (UB_SubID === Number(0x01)) {
        logger.debug("フォント属性指定付箋");
        tsFontTypeSetFusen(segLen,tadSeg);
    } else if (UB_SubID === Number(0x02)) {
        logger.debug("文字サイズ指定付箋");
        tsFontSizeSetFusen(segLen,tadSeg);
    } else if (UB_SubID === Number(0x03)) {
        logger.debug("文字拡大／縮小指定付箋");
    } else if (UB_SubID === Number(0x04)) {
        logger.debug("文字間隔指定付箋");
        tsFontSpacingSetFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x05)) {
        logger.debug("文字回転指定付箋");
    } else if (UB_SubID === Number(0x06)) {
        logger.debug("文字カラー指定付箋");
        tsFontColorSetFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x07)) {
        logger.debug("文字基準位置移動付箋");
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
        logger.debug("固定幅空白指定付箋");
        // TODO
    } else if (UB_SubID === Number(0x01)) {
        logger.debug("充填文字指定付箋");
        // TODO
    } else if (UB_SubID === Number(0x02)) {
        logger.debug("文字罫線指定付箋");
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
    
    // デバッグ情報
    logger.debug("添え字開始: ", {
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
    
    logger.debug("添え字終了");
}

/**
 * 添え字開始指定付箋を処理
 * @param {number} segLen セグメント長
 * @param {Array} tadSeg セグメントデータ
 */
function tsRubyStartFusen(segLen, tadSeg) {
    // ルビ開始指定付箋の処理
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

    logger.debug(`ルビ開始: text="${rubyText}", position=${rubyPosition}`);
}

function tsRubyEndFusen(segLen, tadSeg) {
    // ルビ終了指定付箋の処理
    if (!rubyState.active) {
        logger.warn("ルビ終了付箋が呼ばれましたが、ルビ開始されていません");
        return;
    }

    // ルビを実際に描画
    drawRuby();
    
    // XML出力用
    if (isXmlDumpEnabled()) {
        xmlBuffer.push(`</ruby>`);
    }

    // ルビ状態をリセット
    rubyState.active = false;
    rubyState.baseText = '';
    rubyState.rubyText = '';

    logger.debug("ルビ終了");
}

function drawRuby() {
    if (!rubyState.rubyText || !rubyState.baseText) {
        return;
    }

    // 現在のフォント設定を保存
    const savedFont = ctx.font;
    const savedFillStyle = ctx.fillStyle;

    // ルビ用のフォントサイズを設定
    const rubyFontSize = textFontSize * rubyState.fontSize;
    ctx.font = `${rubyFontSize}px ${currentFontFamily}`;

    // 被ルビ文字列の長さを計算
    let baseTextLength = 0;
    if (textDirection === 1 || textDirection === 3) {
        // 縦書き
        baseTextLength = rubyState.endY - rubyState.startY;
    } else {
        // 横書き
        baseTextLength = rubyState.endX - rubyState.startX;
    }

    // ルビ文字の配置間隔を計算（均等配置）
    const rubyCharCount = rubyState.rubyText.length;
    const rubySpacing = baseTextLength / rubyCharCount;

    // ルビの描画位置を計算
    let rubyX = rubyState.startX;
    let rubyY = rubyState.startY;

    // 縦書きの場合の位置調整
    if (textDirection === 1 || textDirection === 3) {
        // 縦書き
        if (rubyState.position === 0) {
            // 行戻し側（右側）- ルビサイズ分だけ離す
            rubyX += textFontSize + rubyFontSize * 0.2;
        } else {
            // 行送り側（左側）
            rubyX -= rubyFontSize + rubyFontSize * 0.2;
        }

        // ルビ文字を縦に均等配置
        for (let i = 0; i < rubyCharCount; i++) {
            const charY = rubyY + (i * rubySpacing) + (rubySpacing / 2);
            ctx.fillText(rubyState.rubyText[i], rubyX, charY);
        }
    } else {
        // 横書き
        if (rubyState.position === 0) {
            // 行戻し側（上側）- 被ルビ文字列の文字サイズ分だけ上にずらす
            rubyY -= textFontSize;
        } else {
            // 行送り側（下側）
            rubyY += textFontSize + rubyFontSize * 0.2;
        }

        // ルビ文字を横に均等配置
        for (let i = 0; i < rubyCharCount; i++) {
            const charX = rubyX + (i * rubySpacing) + (rubySpacing / 2) - (rubyFontSize / 2);
            ctx.fillText(rubyState.rubyText[i], charX, rubyY);
        }
    }

    // フォント設定を復元
    ctx.font = savedFont;
    ctx.fillStyle = savedFillStyle;
}


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

    logger.debug(`行頭禁則設定: level=${prohibitionLevel}, method=${prohibitionMethod}, chars="${prohibitionChars.join('')}"`);
}

function checkLineStartProhibition(char) {
    // 行頭禁則文字かどうかをチェック
    if (!lineStartProhibitionState.active || lineStartProhibitionState.chars.length === 0) {
        return false;
    }
    return lineStartProhibitionState.chars.includes(char);
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

    logger.debug(`行末禁則設定: level=${prohibitionLevel}, method=${prohibitionMethod}, chars="${prohibitionChars.join('')}"`);
}

function checkLineEndProhibition(char) {
    // 行末禁則文字かどうかをチェック
    if (!lineEndProhibitionState.active || lineEndProhibitionState.chars.length === 0) {
        return false;
    }
    return lineEndProhibitionState.chars.includes(char);
}


/**
 * 固定幅空白指定付箋を処理
 * @param {number} segLen セグメント長
 * @param {Array} tadSeg セグメントデータ
 */
function tsFixedWidthSpaceFusen(segLen, tadSeg) {
    if (segLen < 1) {
        logger.debug("固定幅空白指定付箋: セグメント長が不正");
        return;
    }

    const widthData = tadSeg[1];  // SCALE型の幅データ

    // 固定幅空白状態を設定
    fixedWidthSpaceState.active = true;
    fixedWidthSpaceState.scaleData = widthData;

    logger.debug(`固定幅空白指定付箋: 状態設定完了 scaleData=${IntToHex(widthData, 4)}`);
}

/**
 * 変数参照指定付箋を処理
 * @param {number} segLen セグメント長
 * @param {Array} tadSeg セグメントデータ
 */
function tsVariableReference(segLen, tadSeg) {
    if (segLen < 1) {
        logger.debug("変数参照指定付箋: セグメント長が不正");
        return;
    }

    const varId = tadSeg[1]; // 変数ID
    logger.debug(`変数参照指定付箋: varId=${varId}`);

    const variableValue = getVariableValue(varId);
    if (variableValue !== null) {
        // 変数値を文字列として描画
        for (let i = 0; i < variableValue.length; i++) {
            const char = variableValue.charAt(i);
            if (textNest > 0) {
                // drawText呼び出し前の最終チェック
                if (!ctx || !canvas) {
                    ctx = window.ctx;
                    canvas = window.canvas;
                }

                // 次の文字を先読み
                let nextChar = null;
                if (i + 1 < variableValue.length) {
                    nextChar = variableValue.charAt(i + 1);
                }

                drawText(ctx, canvas, char, nextChar, textFontSize, textCharPoint[textNest-1][0], textCharPoint[textNest-1][1], textCharPoint[textNest-1][2], textSpacingPitch, lineSpacingPitch, 0);
            }
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
        logger.debug("結合開始指定付箋");
        textLigatureFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x01)) {
        logger.debug("結合終了指定付箋");
        textLigatureFusenEnd(segLen, tadSeg);
        // TODO
    } else if (UB_SubID === Number(0x02)) {
        logger.debug("文字割付け開始指定付箋");
        // TODO
    } else if (UB_SubID === Number(0x03)) {
        logger.debug("文字割付け終了指定付箋");
        // TODO
    } else if (UB_SubID === Number(0x04)) {
        logger.debug("添え字開始指定付箋");
        tadSubscriptStart(segLen, tadSeg);
    } else if (UB_SubID === Number(0x05)) {
        logger.debug("添え字終了指定付箋");
        tadSubscriptEnd(segLen, tadSeg);
    } else if (UB_SubID === Number(0x06)) {
        logger.debug("ルビ開始指定付箋");
        tsRubyStartFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x07)) {
        logger.debug("ルビ終了指定付箋");
        tsRubyEndFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x08)) {
        logger.debug("行頭禁則指定付箋");
        tsLineStartProhibitionFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x09)) {
        logger.debug("行末禁則指定付箋");
        tsLineEndProhibitionFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x0A)) {
        logger.debug("固定幅空白指定付箋");
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
        logger.debug("下線開始");
        tadTextStyleLineStart(segLen, tadSeg, UB_SubID);
        // TODO
    } else if (UB_SubID === Number(0x01)) {
        logger.debug("下線終了");
        tadTextStyleLineEnd(segLen, tadSeg, UB_SubID);
        // TODO
    } else if (UB_SubID === Number(0x02)) {
        logger.debug("上線開始");
        tadTextStyleLineStart(segLen, tadSeg, UB_SubID);
        // TODO
    } else if (UB_SubID === Number(0x03)) {
        logger.debug("上線終了");
        tadTextStyleLineEnd(segLen, tadSeg, UB_SubID);
        // TODO
    } else if (UB_SubID === Number(0x04)) {
        logger.debug("打ち消し線開始");
        tadTextStyleLineStart(segLen, tadSeg, UB_SubID);
        // TODO
    } else if (UB_SubID === Number(0x05)) {
        logger.debug("打ち消し線終了");
        tadTextStyleLineEnd(segLen, tadSeg, UB_SubID);
        // TODO
    } else if (UB_SubID === Number(0x06)) {
        logger.debug("枠囲み線開始");
        tadTextStyleLineStart(segLen, tadSeg, UB_SubID);
    } else if (UB_SubID === Number(0x07)) {
        logger.debug("枠囲み線終了");
        tadTextStyleLineEnd(segLen, tadSeg, UB_SubID);
    } else if (UB_SubID === Number(0x08)) {
        logger.debug("上（右）傍点開始");
        // TODO
    } else if (UB_SubID === Number(0x09)) {
        logger.debug("上（右）傍点終了");
        // TODO
    } else if (UB_SubID === Number(0x0A)) {
        logger.debug("下（左）傍点開始");
        // TODO
    } else if (UB_SubID === Number(0x0B)) {
        logger.debug("下（左）傍点終了");
        // TODO
    } else if (UB_SubID === Number(0x0C)) {
        logger.debug("反転開始");
        tadTextStyleLineStart(segLen, tadSeg, UB_SubID);
    } else if (UB_SubID === Number(0x0D)) {
        logger.debug("反転終了");
        tadTextStyleLineEnd(segLen, tadSeg, UB_SubID);
    } else if (UB_SubID === Number(0x0E)) {
        logger.debug("網掛開始");
        tadTextStyleLineStart(segLen, tadSeg, UB_SubID);
    } else if (UB_SubID === Number(0x0F)) {
        logger.debug("網掛終了");
        tadTextStyleLineEnd(segLen, tadSeg, UB_SubID);
    } else if (UB_SubID === Number(0x10)) {
        logger.debug("背景開始");
        tadTextStyleLineStart(segLen, tadSeg, UB_SubID);
    } else if (UB_SubID === Number(0x11)) {
        logger.debug("背景終了");
        tadTextStyleLineEnd(segLen, tadSeg, UB_SubID);
    } else if (UB_SubID === Number(0x12)) {
        logger.debug("無印字開始");
        tadTextStyleLineStart(segLen, tadSeg, UB_SubID);
    } else if (UB_SubID === Number(0x13)) {
        logger.debug("無印字終了");
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
    let xmlTag = null;
    if (UB_SubID === 0x00) {
        lineType = 'underline';
        textDecorations.underline = true;
        xmlTag = "<underline>";
    } else if (UB_SubID === 0x02) {
        lineType = 'overline';
        textDecorations.overline = true;
        xmlTag = "<overline>";
    } else if (UB_SubID === 0x04) {
        lineType = 'strikethrough';
        textDecorations.strikethrough = true;
        xmlTag = "<strikethrough>";
    } else if (UB_SubID === 0x06) {
        lineType = 'box';
        textDecorations.box = true;
        xmlTag = "<box>";
    } else if (UB_SubID === 0x0C) {
        lineType = 'invert';
        textDecorations.invert = true;
        xmlTag = "<invert>";
    } else if (UB_SubID === 0x0E) {
        lineType = 'mesh';
        textDecorations.mesh = true;
        xmlTag = "<mesh>";
    } else if (UB_SubID === 0x10) {
        lineType = 'background';
        xmlTag = "<background>";
        textDecorations.background = true;
    } else if (UB_SubID === 0x12) {
        lineType = 'noprint';
        textDecorations.noprint = true;
        xmlTag = "<noprint>";
    } else {
        return;
    }

    if (isXmlDumpEnabled && xmlTag !== null && isInDocSegment) {
        xmlBuffer.push(`${xmlTag}`);
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
    
    logger.debug(`${lineType} started - double:${lineStyle.doubleLines}, intensity:${lineStyle.intensity}, width:${lineStyle.width}, style:${lineStyle.style}, color:${lineStyle.color}`);
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
    let xmlTag = null;
    if (UB_SubID === 0x01) {
        lineType = 'underline';
        textDecorations.underline = false;
        xmlTag = "</underline>";
    } else if (UB_SubID === 0x03) {
        lineType = 'overline';
        textDecorations.overline = false;
        xmlTag = "</overline>";
    } else if (UB_SubID === 0x05) {
        lineType = 'strikethrough';
        textDecorations.strikethrough = false;
        xmlTag = "</strikethrough>";
    } else if (UB_SubID === 0x07) {
        lineType = 'box';
        textDecorations.box = false;
        xmlTag = "</box>";
    } else if (UB_SubID === 0x0D) {
        lineType = 'invert';
        textDecorations.invert = false;
        xmlTag = "</invert>";
    } else if (UB_SubID === 0x0F) {
        lineType = 'mesh';
        textDecorations.mesh = false;
        xmlTag = "</mesh>";
    } else if (UB_SubID === 0x11) {
        lineType = 'background';
        textDecorations.background = false;
        xmlTag = "</background>";
    } else if (UB_SubID === 0x13) {
        lineType = 'noprint';
        textDecorations.noprint = false;
        xmlTag = "</noprint>";
    } else {
        return;
    }

    if (isXmlDumpEnabled && xmlTag !== null && isInDocSegment) {
        xmlBuffer.push(`${xmlTag}`);
    }

    // 装飾範囲の終了位置を記録
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
            
            logger.debug(`${lineType} ended at position (${range.end.x}, ${range.end.y})`);
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
        logger.debug("画像セグメントが短すぎます");
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
    
    logger.debug(`画像情報: ${width}x${height}, planes=${imageSeg.planes}, pixbits=${imageSeg.pixbits} (0x${imageSeg.pixbits.toString(16)}), rowbytes=${imageSeg.rowbytes}`);
    logger.debug(`bounds: left=${imageSeg.bounds.left}, top=${imageSeg.bounds.top}, right=${imageSeg.bounds.right}, bottom=${imageSeg.bounds.bottom}`);
    
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

    // isXmlDumpEnabled時にPNG画像ファイルを生成
    if (isXmlDumpEnabled() && imageSeg.bitmap) {
        generatePngImage(imageSeg);
    }

    // 文章セグメント内での画像の場合の処理
    if (isDirectTextSegment() || isInTextSegment() || isInVirtualObject) {
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

        drawImageSegment(imageSeg, textWidth, imageDrawY);

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

        drawImageSegment(imageSeg, imageSeg.view.left, imageSeg.view.top);
        // 画像描画後の仮想領域を拡張
        expandVirtualArea(imageSeg.view.left, imageSeg.view.top, 
                        imageSeg.view.right, imageSeg.view.bottom);
    } else {
        // 独立した画像として描画
        drawImageSegment(imageSeg, 0, 0);
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
 * @param {number} offsetX - X座標オフセット
 * @param {number} offsetY - Y座標オフセット
 */
function drawImageSegment(imageSeg, offsetX = 0, offsetY = 0) {
    if (!imageSeg.bitmap && !imageSeg.imageData) {
        logger.debug('No image data to draw');
        return;
    }

    if(isInVirtualObject) {
        // 仮想オブジェクト内の場合は仮想座標を使用
        offsetX += virtualObjectOffsetX;
        offsetY += virtualObjectOffsetY;
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
        ctx.putImageData(imageSeg.imageData, drawX, drawY);
    } else if (imageSeg.bitmap) {
        // ビットマップデータから描画
        drawBitmapData(imageSeg, drawX, drawY, drawWidth, drawHeight);
    }
}

/**
 * ビットマップデータを描画する汎用関数
 * @param {IMAGESEG} imageSeg - 画像セグメントオブジェクト
 * @param {number} x - 描画X座標
 * @param {number} y - 描画Y座標
 * @param {number} width - 描画幅
 * @param {number} height - 描画高さ
 */
function drawBitmapData(imageSeg, x, y, width, height) {
    if (!imageSeg.bitmap) {
        logger.debug('No bitmap data to draw');
        return;
    }
    
    logger.debug(`描画開始: x=${x}, y=${y}, width=${width}, height=${height}`);
    logger.debug(`bitmap type: ${typeof imageSeg.bitmap}, length: ${imageSeg.bitmap.length}`);
    
    // 基本的なUint8Array形式での描画
    const imgWidth = imageSeg.bounds.right - imageSeg.bounds.left;
    const imgHeight = imageSeg.bounds.bottom - imageSeg.bounds.top;
    
    logger.debug(`画像サイズ: ${imgWidth}x${imgHeight}, pixbits=${imageSeg.pixbits}`);
    
    if (imgWidth <= 0 || imgHeight <= 0) {
        logger.debug('Invalid image dimensions');
        return;
    }
    
    // ImageDataを作成
    const imageData = ctx.createImageData(width, height);
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
    // 画像を描画
    ctx.putImageData(imageData, x, y);
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
            logger.debug('[generatePngImage] Invalid image dimensions or no bitmap data');
            return;
        }

        // ファイルID（currentFileIndex）
        const fileId = currentFileIndex;

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

        // ファイル名を生成: fileid_recordno_imgno.png
        const fileName = `${fileId}_${recordNo}_${imgNo}.png`;

        logger.debug(`[generatePngImage] Generating PNG: ${fileName} (${width}x${height})`);

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
                    // ダウンロードリンクを作成
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = fileName;
                    a.style.display = 'none';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);

                    logger.debug(`[generatePngImage] PNG generated: ${fileName}`);
                }
            }, 'image/png');
        } else if (typeof require !== 'undefined') {
            // Node.js環境（将来的にfs.writeFileでファイル保存可能）
            logger.debug('[generatePngImage] Node.js environment - PNG generation not implemented yet');
        }

    } catch (error) {
        logger.error('[generatePngImage] Error generating PNG:', error);
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
        noprint: [],
        bold: []
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
function tsFigStart(tadSeg) {
    
    // セグメントスタックに図形セグメントを追加
    segmentStack.push(SEGMENT_TYPE.FIGURE);
    currentSegmentType = SEGMENT_TYPE.FIGURE;
    
    if (!startTadSegment) {
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

    // XMLダンプ機能が有効な場合、図形開始セグメントの情報をXML形式で出力
    if (isXmlDumpEnabled()) {
        xmlBuffer.push('<figure>\r\n');
        xmlBuffer.push(`<figView top="${figSeg.view.top}" left="${figSeg.view.left}" right="${figSeg.view.right}" bottom="${figSeg.view.bottom}"/>\r\n`);
        xmlBuffer.push(`<figDraw top="${figSeg.draw.top}" left="${figSeg.draw.left}" right="${figSeg.draw.right}" bottom="${figSeg.draw.bottom}"/>\r\n`);
        xmlBuffer.push(`<figScale hunit="${figSeg.h_unit}" vunit="${figSeg.v_unit}"/>\r\n`);
        isXmlFig = true;
    }

    // 図形TADの場合、全体が図形であることが示されるため、指定は無効
    if (!startByImageSegment) {
        viewW = figSeg.view.right - figSeg.view.left;
        viewH = figSeg.view.bottom - figSeg.view.top;
        drawX = figSeg.draw.left;
        drawY = figSeg.draw.top;
        drawW = figSeg.draw.right - drawX;
        drawH = figSeg.draw.bottom - drawY;
        
    } else if (isInFigureSegment() > 1 && startByImageSegment) {
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
    if (startByImageSegment && isInFigureSegment()) {
        //canvas.width = viewW;
        //canvas.height = viewH;
    }

    logger.debug(`figSeg view: left=${figSeg.view.left}, top=${figSeg.view.top}, right=${figSeg.view.right}, bottom=${figSeg.view.bottom}`);
    logger.debug(`figSeg draw: left=${figSeg.draw.left}, top=${figSeg.draw.top}, right=${figSeg.draw.right}, bottom=${figSeg.draw.bottom}`);

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

    // XMLダンプ機能が有効な場合、図形終了タグを出力
    if (isXmlDumpEnabled()) {
        xmlBuffer.push('</figure>\r\n');
        isXmlFig = false;
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
                    logger.debug(`Creating canvas pattern for pattern ${f_pat}: ${pattern.hsize}x${pattern.vsize}`);
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

    logger.debug(`Rectangle attributes: l_atr=${IntToHex((tadSeg[1]),4).replace('0x','')}, l_pat=${IntToHex((tadSeg[2]),4).replace('0x','')}, f_pat=${IntToHex((tadSeg[3]),4).replace('0x','')}, angle=${IntToHex((tadSeg[4]),4).replace('0x','')}`);
    logger.debug(`Rectangle bounds: left=${IntToHex((tadSeg[5]),4).replace('0x','')}, top=${IntToHex((tadSeg[6]),4).replace('0x','')}, right=${IntToHex((tadSeg[7]),4).replace('0x','')}, bottom=${IntToHex((tadSeg[8]),4).replace('0x','')}`);
    
    // 線属性を適用
    const oldLineSettings = applyLineAttribute(l_atr);
    const oldColors = setColorPattern(l_pat, f_pat);

    if(isXmlDumpEnabled()) {
        xmlBuffer.push(`<rect round="0" l_atr="${l_atr}" l_pat="${l_pat}" f_pat="${f_pat}" angle="${figX}" left="${figX}" top="${figY}" right="${figX + figW}" bottom="${figY + figH}">\r\n`);
    }

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

    // logger.debug(`RoundRect attributes: l_atr=${IntToHex((tadSeg[1]),4).replace('0x','')}, l_pat=${IntToHex((tadSeg[2]),4).replace('0x','')}, f_pat=${IntToHex((tadSeg[3]),4).replace('0x','')}, angle=${IntToHex((tadSeg[4]),4).replace('0x','')}, rh=${IntToHex((tadSeg[5]),4).replace('0x','')}, rv=${IntToHex((tadSeg[6]),4).replace('0x','')}`);
    // logger.debug(`RoundRect bounds: left=${IntToHex((tadSeg[7]),4).replace('0x','')}, top=${IntToHex((tadSeg[8]),4).replace('0x','')}, right=${IntToHex((tadSeg[9]),4).replace('0x','')}, bottom=${IntToHex((tadSeg[10]),4).replace('0x','')}`);

    // 線属性を適用
    const oldLineSettings = applyLineAttribute(l_atr);
    const oldColors = setColorPattern(l_pat, f_pat);

    if(isXmlDumpEnabled()) {
        xmlBuffer.push(`<rect round="1" l_atr="${l_atr}" l_pat="${l_pat}" f_pat="${f_pat}" angle="${figX}" figRH="${figRH}" figRV="${figRV}" left="${figX}" top="${figY}" right="${figX + figW}" bottom="${figY + figH}">\r\n`);
    }

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

    logger.debug(`Polygon attributes: l_atr=${IntToHex((tadSeg[1]),4).replace('0x','')}, l_pat=${IntToHex((tadSeg[2]),4).replace('0x','')}, f_pat=${IntToHex((tadSeg[3]),4).replace('0x','')}`);
    logger.debug("round  " + IntToHex((tadSeg[4]),4).replace('0x',''));
    logger.debug("np     " + IntToHex((tadSeg[5]),4).replace('0x',''));
    logger.debug("x      " + IntToHex((tadSeg[6]),4).replace('0x',''));
    logger.debug("y      " + IntToHex((tadSeg[7]),4).replace('0x',''));

    // 線属性を適用
    const oldLineSettings = applyLineAttribute(l_atr);
    // カラーパターンを設定
    const oldColors = setColorPattern(l_pat, f_pat);

    let x = Number(tadSeg[6]);
    let y = Number(tadSeg[7]);

    if(isXmlDumpEnabled()) {
        const pointsArray = [];
        for(let offsetLen=6;offsetLen<tadSeg.length;offsetLen+=2) {
            const px = Number(tadSeg[offsetLen]);
            const py = Number(tadSeg[offsetLen+1]);
            pointsArray.push(`${px},${py}`);
        }
        xmlBuffer.push(`<polygon l_atr="${l_atr}" l_pat="${l_pat}" f_pat="${f_pat}" points="${pointsArray.join(' ')}">\r\n`);
    }

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
    logger.debug(polygonPoint);
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
    
    logger.debug(`Line attributes: l_atr=${IntToHex((tadSeg[1]),4).replace('0x','')}, l_pat=${IntToHex((tadSeg[2]),4).replace('0x','')}`);
    
    // 線属性を適用
    const oldLineSettings = applyLineAttribute(l_atr);
    // 線色のみカラーパターンを設定
    const oldLineColor = setLineColorPattern(l_pat);
    
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
        xmlBuffer.push(`<line l_atr="${l_atr}" l_pat="${l_pat}" f_pat="0" start_arrow="${startArrow}" end_arrow="${endArrow}" points="${pointsArray.join(' ')}">\r\n`);
    }

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
    logger.debug(linePoint);

    // 線幅が0より大きい場合のみ描画
    if (drawLineWidth > 0) {
        ctx.stroke();
    }

    // 矢印修飾がある場合のみ矢印を描画
    if (figureModifierState.hasArrow && tadSeg.length >= 6) {
        const startX = Number(tadSeg[3]);
        const startY = Number(tadSeg[4]);
        const endX = Number(tadSeg[tadSeg.length - 2]);
        const endY = Number(tadSeg[tadSeg.length - 1]);

        // 開始点の矢印（最初の線分の方向）
        if (figureModifierState.startArrow) {
            const secondX = tadSeg.length > 6 ? Number(tadSeg[5]) : endX;
            const secondY = tadSeg.length > 6 ? Number(tadSeg[6]) : endY;
            const startAngle = Math.atan2(secondY - startY, secondX - startX);
            drawArrow(ctx, startX, startY, startAngle + Math.PI); // 反対方向
        }

        // 終了点の矢印（最後の線分の方向）
        if (figureModifierState.endArrow) {
            const prevIndex = tadSeg.length >= 8 ? tadSeg.length - 4 : 3;
            const prevX = Number(tadSeg[prevIndex]);
            const prevY = Number(tadSeg[prevIndex + 1]);
            const endAngle = Math.atan2(endY - prevY, endX - prevX);
            drawArrow(ctx, endX, endY, endAngle);
        }

        // 修飾状態をリセット（次の図形に影響しないように）
        resetFigureModifier();
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
    logger.debug(`Ellipse attributes: l_atr=${IntToHex((tadSeg[1]),4).replace('0x','')}, l_pat=${IntToHex((tadSeg[2]),4).replace('0x','')}, f_pat=${IntToHex((tadSeg[3]),4).replace('0x','')}, angle=${IntToHex((tadSeg[4]),4).replace('0x','')}`);
    logger.debug(`Ellipse bounds: left=${IntToHex((tadSeg[5]),4).replace('0x','')}, top=${IntToHex((tadSeg[6]),4).replace('0x','')}, right=${IntToHex((tadSeg[7]),4).replace('0x','')}, bottom=${IntToHex((tadSeg[8]),4).replace('0x','')}`);

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

    logger.debug(radianAngle);
    logger.debug(frameCenterX);
    logger.debug(frameCenterY);
    logger.debug(radiusX);
    logger.debug(radiusY);

    ctx.save(); // 現在の状態を保存

    // 線属性を適用
    const oldLineSettings = applyLineAttribute(l_atr);
    const oldColors = setColorPattern(l_pat, f_pat);

    if(isXmlDumpEnabled()) {
        xmlBuffer.push(`<ellipse l_atr="${l_atr}" l_pat="${l_pat}" f_pat="${f_pat}" angle="${angle}" cx="${frameCenterX}" cy="${frameCenterY}" rx="${radiusX}" ry="${radiusY}">\r\n`);
    }

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
 * 図形セグメント 扇形セグメントを描画
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 * @returns 
 */
function tsFigArcDraw(segLen, tadSeg) {
    if (segLen < Number(0x0018)) {
        return;
    }
    
    logger.debug(`Arc attributes: l_atr=${IntToHex((tadSeg[1]),4).replace('0x','')}, l_pat=${IntToHex((tadSeg[2]),4).replace('0x','')}, f_pat=${IntToHex((tadSeg[3]),4).replace('0x','')}, angle=${IntToHex((tadSeg[4]),4).replace('0x','')}`);
    logger.debug(`Arc frame: left=${IntToHex((tadSeg[5]),4).replace('0x','')}, top=${IntToHex((tadSeg[6]),4).replace('0x','')}, right=${IntToHex((tadSeg[7]),4).replace('0x','')}, bottom=${IntToHex((tadSeg[8]),4).replace('0x','')}`);
    logger.debug(`Arc points: startX=${IntToHex((tadSeg[9]),4).replace('0x','')}, startY=${IntToHex((tadSeg[10]),4).replace('0x','')}, endX=${IntToHex((tadSeg[11]),4).replace('0x','')}, endY=${IntToHex((tadSeg[12]),4).replace('0x','')}`);

    const l_atr = Number(tadSeg[1]);
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
    
    const radianAngle = angle * Math.PI / 180;
    
    logger.debug(`Arc center: (${centerX}, ${centerY}), radius: (${radiusX}, ${radiusY})`);
    logger.debug(`Start angle: ${startAngle}, End angle: ${endAngle}`);

    ctx.save(); // 現在の状態を保存

    // フレーム矩形でクリッピング
    ctx.beginPath();
    ctx.rect(frameLeft, frameTop, frameRight - frameLeft, frameBottom - frameTop);
    ctx.clip();

    // 線属性を適用
    const oldLineSettings = applyLineAttribute(l_atr);
    const oldColors = setColorPattern(l_pat, f_pat);

    if(isXmlDumpEnabled()) {
        const startArrow = figureModifierState.startArrow ? '1' : '0';
        const endArrow = figureModifierState.endArrow ? '1' : '0';
        xmlBuffer.push(`<arc l_atr="${l_atr}" l_pat="${l_pat}" f_pat="${f_pat}" angle="${angle}" cx="${centerX}" cy="${centerY}" rx="${radiusX}" ry="${radiusY}" startX="${startX}" startY="${startY}" endX="${endX}" endY="${endY}" startAngle="${startAngle}" endAngle="${endAngle}" start_arrow="${startArrow}" end_arrow="${endArrow}">\r\n`);
    }

    ctx.beginPath();

    // 中心から開始点へ
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(startX, startY);

    // 開始点から終了点へ楕円弧（時計回り）
    ctx.ellipse(centerX, centerY, radiusX, radiusY, radianAngle, startAngle, endAngle, false);

    // 終了点から中心へ
    ctx.lineTo(centerX, centerY);
    ctx.closePath();
    
    // 塗りつぶしを先に実行
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

    // 矢印の描画
    if (figureModifierState.hasArrow && segLen >= 0x0018) {
        if (figureModifierState.startArrow) {
            // 開始点から中心方向の角度を計算
            const angleToCenter = Math.atan2(centerY - startY, centerX - startX);
            drawArrow(startX, startY, angleToCenter);
        }

        if (figureModifierState.endArrow) {
            // 終了点から中心方向の角度を計算
            const angleToCenter = Math.atan2(centerY - endY, centerX - endX);
            drawArrow(endX, endY, angleToCenter);
        }

        resetFigureModifier();
    }

    return;
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
    
    logger.debug(`Chord attributes: l_atr=${IntToHex((tadSeg[1]),4).replace('0x','')}, l_pat=${IntToHex((tadSeg[2]),4).replace('0x','')}, f_pat=${IntToHex((tadSeg[3]),4).replace('0x','')}, angle=${IntToHex((tadSeg[4]),4).replace('0x','')}`);
    logger.debug(`Chord frame: left=${IntToHex((tadSeg[5]),4).replace('0x','')}, top=${IntToHex((tadSeg[6]),4).replace('0x','')}, right=${IntToHex((tadSeg[7]),4).replace('0x','')}, bottom=${IntToHex((tadSeg[8]),4).replace('0x','')}`);
    logger.debug(`Chord points: startX=${IntToHex((tadSeg[9]),4).replace('0x','')}, startY=${IntToHex((tadSeg[10]),4).replace('0x','')}, endX=${IntToHex((tadSeg[11]),4).replace('0x','')}, endY=${IntToHex((tadSeg[12]),4).replace('0x','')}`);

    const l_atr = Number(tadSeg[1]);
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
    
    const radianAngle = angle * Math.PI / 180;
    
    logger.debug(`Chord center: (${frameCenterX}, ${frameCenterY}), radius: (${radiusX}, ${radiusY})`);
    logger.debug(`Start angle: ${startAngle}, End angle: ${endAngle}`);
    logger.debug(`Start point on ellipse: (${startXOnEllipse}, ${startYOnEllipse}), End point: (${endXOnEllipse}, ${endYOnEllipse})`);

    ctx.save(); // 現在の状態を保存

    // フレーム矩形でクリッピング
    ctx.beginPath();
    ctx.rect(frameLeft, frameTop, frameRight - frameLeft, frameBottom - frameTop);
    ctx.clip();

    // 線属性を適用
    const oldLineSettings = applyLineAttribute(l_atr);
    const oldColors = setColorPattern(l_pat, f_pat);

    if(isXmlDumpEnabled()) {
        const startArrow = figureModifierState.startArrow ? '1' : '0';
        const endArrow = figureModifierState.endArrow ? '1' : '0';
        xmlBuffer.push(`<chord l_atr="${l_atr}" l_pat="${l_pat}" f_pat="${f_pat}" angle="${angle}" cx="${frameCenterX}" cy="${frameCenterY}" rx="${radiusX}" ry="${radiusY}" startX="${startXOnEllipse}" startY="${startYOnEllipse}" endX="${endXOnEllipse}" endY="${endYOnEllipse}" startAngle="${startAngle}" endAngle="${endAngle}" start_arrow="${startArrow}" end_arrow="${endArrow}">\r\n`);
    }

    ctx.beginPath();

    // 開始点から終了点へ楕円弧（時計回り）
    ctx.ellipse(frameCenterX, frameCenterY, radiusX, radiusY, radianAngle, startAngle, endAngle, false);

    // 終了点から開始点へ直線で結ぶ（弓形を完成させる）
    ctx.closePath();
    
    // 塗りつぶしを先に実行
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
    
    logger.debug(`EllipticalArc attributes: l_atr=${IntToHex((tadSeg[1]),4).replace('0x','')}, l_pat=${IntToHex((tadSeg[2]),4).replace('0x','')}, angle=${IntToHex((tadSeg[3]),4).replace('0x','')}`);
    logger.debug(`EllipticalArc bounds: left=${IntToHex((tadSeg[4]),4).replace('0x','')}, top=${IntToHex((tadSeg[5]),4).replace('0x','')}, right=${IntToHex((tadSeg[6]),4).replace('0x','')}, bottom=${IntToHex((tadSeg[7]),4).replace('0x','')}`);
    logger.debug(`EllipticalArc points: startx=${IntToHex((tadSeg[8]),4).replace('0x','')}, starty=${IntToHex((tadSeg[9]),4).replace('0x','')}, endx=${IntToHex((tadSeg[10]),4).replace('0x','')}, endy=${IntToHex((tadSeg[11]),4).replace('0x','')}`);

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

    logger.debug(radianAngle);
    logger.debug(frameCenterX);
    logger.debug(frameCenterY);
    logger.debug(startX);
    logger.debug(startY);
    logger.debug(radiusX);
    logger.debug(radiusY);
    logger.debug(radianStart);
    logger.debug(radianEnd);

    if(isXmlDumpEnabled()) {
        const startArrow = figureModifierState.startArrow ? '1' : '0';
        const endArrow = figureModifierState.endArrow ? '1' : '0';
        xmlBuffer.push(`<elliptical_arc l_atr="${l_atr}" l_pat="${l_pat}" angle="${angle}" cx="${frameCenterX}" cy="${frameCenterY}" rx="${radiusX}" ry="${radiusY}" startX="${startX}" startY="${startY}" endX="${endX}" endY="${endY}" startAngle="${radianStart}" endAngle="${radianEnd}" start_arrow="${startArrow}" end_arrow="${endArrow}">\r\n`);
    }

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
    
    logger.debug(`Polyline attributes: l_atr=${IntToHex((tadSeg[1]),4).replace('0x','')}, l_pat=${IntToHex((tadSeg[2]),4).replace('0x','')}`);
    
    // 線属性を適用
    const oldLineSettings = applyLineAttribute(l_atr);
    
    // 線色のみカラーパターンを設定
    const oldLineColor = setLineColorPattern(l_pat);

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
        xmlBuffer.push(`<polyline l_atr="${l_atr}" l_pat="${l_pat}" round="${round}" start_arrow="${startArrow}" end_arrow="${endArrow}" points="${pointsArray.join(' ')}">\r\n`);
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

    // 矢印の描画
    if (figureModifierState.hasArrow && np >= 2) {
        const firstPoint = polyLines[0];
        const lastPoint = polyLines[polyLines.length - 1];

        if (figureModifierState.startArrow && polyLines.length >= 2) {
            // 開始点から次の点への角度を計算
            const secondPoint = polyLines[1];
            const angle = Math.atan2(secondPoint.y - firstPoint.y, secondPoint.x - firstPoint.x);
            drawArrow(firstPoint.x, firstPoint.y, angle);
        }

        if (figureModifierState.endArrow && polyLines.length >= 2) {
            // 終了点から前の点への角度を計算
            const prevPoint = polyLines[polyLines.length - 2];
            const angle = Math.atan2(lastPoint.y - prevPoint.y, lastPoint.x - prevPoint.x);
            drawArrow(lastPoint.x, lastPoint.y, angle);
        }

        resetFigureModifier();
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
    const l_pat = Number(tadSeg[2]);
    const f_pat = Number(tadSeg[3]);
    const type = Number(tadSeg[4]);
    const np = Number(tadSeg[5]);
    
    logger.debug(`Curve attributes: mode=${mode}, l_atr=${IntToHex((tadSeg[1]),4).replace('0x','')}, l_pat=${IntToHex((tadSeg[2]),4).replace('0x','')}, f_pat=${IntToHex((tadSeg[3]),4).replace('0x','')}, type=${type}, np=${np}`);
    
    // mode 0 のみ処理
    if (mode !== 0) {
        logger.debug(`Unsupported curve mode: ${mode}`);
        return;
    }
    
    // 頂点数のチェック
    if (np < 2) {
        logger.debug("Curve needs at least 2 points");
        return;
    }
    
    // 必要なデータサイズをチェック（各頂点は x,y で 4バイト）
    const expectedSize = 12 + np * 4;
    if (segLen < expectedSize) {
        logger.debug(`Curve segment too short: expected ${expectedSize}, got ${segLen}`);
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
    
    logger.debug(`Curve type: ${type === 0 ? 'polyline' : 'B-spline'}, ${isClosed ? 'closed' : 'open'}, points: ${np}`);
    
    // 線属性を適用
    const oldLineSettings = applyLineAttribute(l_atr);
    const oldColors = setColorPattern(l_pat, f_pat);

    if(isXmlDumpEnabled()) {
        const pointsArray = [];
        for (let i = 0; i < points.length; i++) {
            pointsArray.push(`${points[i].x},${points[i].y}`);
        }
        const startArrow = figureModifierState.startArrow ? '1' : '0';
        const endArrow = figureModifierState.endArrow ? '1' : '0';
        xmlBuffer.push(`<curve l_atr="${l_atr}" l_pat="${l_pat}" f_pat="${f_pat}" type="${type}" closed="${isClosed ? '1' : '0'}" start_arrow="${startArrow}" end_arrow="${endArrow}" points="${pointsArray.join(' ')}">\r\n`);
    }

    ctx.save(); // 状態を保存

    // 曲線を描画
    if (type === 0) {
        // 折れ線
        drawPolylineCurve(points, isClosed);
    } else if (type === 1) {
        // 3次B-スプライン曲線
        drawBSplineCurve(points, isClosed);
    } else {
        logger.debug(`Unsupported curve type: ${type}`);
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
        logger.debug("長方形セグメント");
        tsFigRectAngleDraw(segLen, tadSeg);
    } else if (UB_SubID === Number(0x01)) {
        logger.debug("角丸長方形セグメント");
        tsFigRoundRectAngleDraw(segLen, tadSeg);
    } else if (UB_SubID === Number(0x02)) {
        logger.debug("楕円セグメント");
        tsFigEllipseDraw(segLen, tadSeg);
    } else if (UB_SubID === Number(0x03)) {
        logger.debug("扇形セグメント");
        tsFigArcDraw(segLen, tadSeg);
    } else if (UB_SubID === Number(0x04)) {
        logger.debug("弓形セグメント");
        tsFigChordDraw(segLen, tadSeg);
    } else if (UB_SubID === Number(0x05)) {
        logger.debug("多角形セグメント");
        tsFigPolygonDraw(segLen, tadSeg);
    } else if (UB_SubID === Number(0x06)) {
        logger.debug("直線セグメント");
        tsFigLineDraw(segLen, tadSeg);
    } else if (UB_SubID === Number(0x07)) {
        logger.debug("楕円弧セグメント");
        tsFigEllipticalArcDraw(segLen, tadSeg);
    } else if (UB_SubID === Number(0x08)) {
        logger.debug("折れ線セグメント");
        tsFigPolylineDraw(segLen, tadSeg);
    } else if (UB_SubID === Number(0x09)) {
        logger.debug("曲線セグメント");
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
        logger.debug(`fgCol[${j}]: ${fgCol.color}`);
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
        
        logger.debug(`Processing pattern ${pattern.id}, layer ${i}: maskId=${maskId}, color=${color}`);
        
        if (!maskData) {
            logger.debug(`  Mask ${maskId} not found`);
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
        logger.debug(`  Set ${pixelsSet} pixels with color ${color}`);
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
        logger.debug(`  Pattern ${pattern.id}: totalPixelsSet=${totalPixelsSet}/${pattern.hsize * pattern.vsize}, bg=${backgroundPixels}, fg=${foregroundPixels}`);
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
        logger.debug("線種定義セグメントが短すぎます");
        return;
    }
    
    // 線種番号を取得 (tadSeg[1])
    const lineTypeNumber = Number(tadSeg[1]);
    
    // パターン数を取得 (tadSeg[2])
    const patternCount = Number(tadSeg[2]);
    
    logger.debug(`線種定義: 線種番号=${lineTypeNumber}, パターン数=${patternCount}`);
    
    // パターンデータが十分にあるかチェック
    if (segLen < 6 + patternCount * 2) {
        logger.debug("線種定義セグメントのパターンデータが不足しています");
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
    
    logger.debug(`線種${lineTypeNumber}のパターンを定義: [${pattern.join(', ')}]`);
}

/**
 * マスクデータ定義セグメントを処理 (0xffb1, SubID: 0x01)
 * @param {number} segLen - セグメント長
 * @param {Array} tadSeg - セグメントデータ
 */
function tsMaskDataDefinition(segLen, tadSeg) {
    // 最小サイズチェック (type(2) + id(2) + hsize(2) + vsize(2) = 8バイト)
    if (segLen < 8) {
        logger.debug("マスクデータ定義セグメントが短すぎます");
        return;
    }
    
    let i = 0;
    // パラメータを取得
    const type = getLastUBinUH(tadSeg[i++]);
    const id = Number(tadSeg[i++]);
    const hsize = Number(tadSeg[i++]);
    const vsize = Number(tadSeg[i++]);

    logger.debug(`Mask definition: type=${type}, id=${id}, hsize=${hsize}, vsize=${vsize}`);
    
    // type 0 (ビットマップ形式) のみ処理
    if (type !== 0) {
        logger.debug(`Unsupported mask type: ${type}`);
        return;
    }
    
    // サイズの検証
    if (hsize <= 0 || vsize <= 0) {
        logger.debug(`Invalid mask size: ${hsize}x${vsize}`);
        return;
    }
    
    if (id < 0) {
        logger.debug(`Invalid mask ID: ${id}`);
        return;
    }
    
    const wordsPerRow = Math.floor((hsize + 15) / 16); // 1行当たりの16bitワード数
    const expectedWords = wordsPerRow * vsize;
    const availableWords = Math.floor((segLen - 4) / 2);
    
    logger.debug(`Mask ${id}: ${hsize}x${vsize}, wordsPerRow=${wordsPerRow}, expectedWords=${expectedWords}, availableWords=${availableWords}`);
    
    // バイト配列として初期化
    const bytesPerRow = Math.ceil(hsize / 8);
    const maskBits = new Array(bytesPerRow * vsize).fill(0);
    
    let wordIndex = 0;
    for (let y = 0; y < vsize; y++) {
        for (let wordInRow = 0; wordInRow < wordsPerRow; wordInRow++) {
            const tadIndex = 4 + wordIndex;
            if (tadIndex >= segLen) {
                logger.debug(`Warning: Not enough mask data at tadIndex ${tadIndex} for row ${y}`);
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
    logger.debug(bitString);
}




/**
 * データ定義セグメントを判定
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 */
function tsDataSet(segLen, tadSeg) {
    const UB_SubID = getTopUBinUH(tadSeg[0]);
    
    if (UB_SubID === Number(0x00)) {
        logger.debug("カラーマップ定義セグメント");
        tsColorMapDefine(segLen, tadSeg);
    } else if (UB_SubID === Number(0x01)) {
        logger.debug("マスクデータ定義セグメント");
        tsMaskDataDefinition(segLen, tadSeg);
    } else if (UB_SubID === Number(0x02)) {
        logger.debug("パターン定義セグメント");
        tsFigColorPattern(segLen, tadSeg);
    } else if (UB_SubID === Number(0x03)) {
        logger.debug("線種定義セグメント");
        tsFigLinePatternDefinition(segLen, tadSeg);
    } else if (UB_SubID === Number(0x04)) {
        logger.debug("マーカー定義セグメント");
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
        logger.debug("グループ開始セグメント");
        let group = new GROUP();
        group.id = Number(uh2h(tadSeg[1]));

        groupList.push(group);
    } else if (UB_SubID === Number(0x01)) {
        logger.debug("グループ終了セグメント");
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

    logger.debug(`Paper attr: 0x${ATTR.toString(16).padStart(2, '0')} (binding=${paperSize.binding}, imposition=${paperSize.imposition})`);
    logger.debug("length " + IntToHex((tadSeg[1]),4).replace('0x',''));
    logger.debug("width  " + IntToHex((tadSeg[2]),4).replace('0x',''));
    logger.debug(`Paper overlay margins (logical): top=${IntToHex((tadSeg[3]),4).replace('0x','')}, bottom=${IntToHex((uh2h(tadSeg[4])),4).replace('0x','')}, left(gutter)=${IntToHex((uh2h(tadSeg[5])),4).replace('0x','')}, right(fore-edge)=${IntToHex((uh2h(tadSeg[6])),4).replace('0x','')}`);

    // 用紙サイズを設定
    paperSize.length = Number(tadSeg[1]);
    paperSize.width = Number(tadSeg[2]);
    
    // オーバーレイ領域までのマージンを設定（論理値として保存）
    paperSize.top = Number(tadSeg[3]);
    paperSize.bottom = Number(uh2h(tadSeg[4]));
    
    // 論理的なleft（ノド）とright（小口）の値をそのまま保存
    paperSize.left = Number(uh2h(tadSeg[5]));   // ノド（綴じ側）
    paperSize.right = Number(uh2h(tadSeg[6]));  // 小口（開き側）
    
    logger.debug(`Logical overlay margins stored: left(gutter)=${paperSize.left}, right(fore-edge)=${paperSize.right}`);
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
        logger.debug("図形用紙指定付箋");
        tsFigurePageSetFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x01)) {
        logger.debug("図形マージン指定付箋");
        tsFigureMarginSetFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x02)) {
        logger.debug("未定義");
    } else if (UB_SubID === Number(0x03)) {
        logger.debug("用紙オーバーレイ定義付箋");
        tsFigureSizeOfPaperOverlayDefineFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x04)) {
        logger.debug("用紙オーバレイ指定付箋");
        tsFigureSizeOfPaperOverlaySetFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x05)) {
        logger.debug("未定義");
    } else if (UB_SubID === Number(0x06)) {
        logger.debug("ページ番号指定付箋");
    }
}


/**
 * 文章メモ指定付箋を処理
 * @param {number} segLen セグメント長
 * @param {Array} tadSeg セグメントデータ
 */
function tsDocumentMemo(segLen, tadSeg) {
    if (segLen < 1) {
        logger.debug("文章メモ指定付箋: セグメント長が不正");
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

    // メモを配列に追加
    documentMemos.push(memoText);

    logger.debug(`文章メモ追加: "${memoText}" (合計 ${documentMemos.length} 個)`);
}

/**
 * 文章メモを取得
 * @returns {Array} 文章メモの配列
 */
function getDocumentMemos() {
    return [...documentMemos]; // コピーを返す
}

/**
 * 文章メモをクリア
 */
function clearDocumentMemos() {
    documentMemos = [];
    logger.debug("文章メモをクリアしました");
}

/**
 * 指定したインデックスの文章メモを取得
 * @param {number} index インデックス（0から開始）
 * @returns {string|null} メモテキストまたはnull
 */
function getDocumentMemo(index) {
    if (index >= 0 && index < documentMemos.length) {
        return documentMemos[index];
    }
    return null;
}

/**
 * 図形メモ指定付箋を処理
 * @param {number} segLen セグメント長
 * @param {Array} tadSeg セグメントデータ
 */
function tsFigureMemo(segLen, tadSeg) {
    if (segLen < 1) {
        logger.debug("図形メモ指定付箋: セグメント長が不正");
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

    // 図形メモを配列に追加
    figureMemos.push(memoText);

    logger.debug(`図形メモ追加: "${memoText}" (合計 ${figureMemos.length} 個)`);
}

/**
 * 図形メモを取得
 * @returns {Array} 図形メモの配列
 */
function getFigureMemos() {
    return [...figureMemos]; // コピーを返す
}

/**
 * 図形メモをクリア
 */
function clearFigureMemos() {
    figureMemos = [];
    logger.debug("図形メモをクリアしました");
}

/**
 * 指定したインデックスの図形メモを取得
 * @param {number} index インデックス（0から開始）
 * @returns {string|null} メモテキストまたはnull
 */
function getFigureMemo(index) {
    if (index >= 0 && index < figureMemos.length) {
        return figureMemos[index];
    }
    return null;
}

/**
 * 図形要素修飾セグメントを処理
 * @param {number} segLen セグメント長
 * @param {Array} tadSeg セグメントデータ
 */
function tsFigureModifier(segLen, tadSeg) {
    if (segLen < 1) {
        logger.debug("図形要素修飾セグメント: セグメント長が不正");
        return;
    }

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

    logger.debug(`図形要素修飾セグメント: arrow=0x${arrow.toString(16)}, startArrow=${startArrow}, endArrow=${endArrow}`);
}

/**
 * 矢印を描画
 * @param {CanvasRenderingContext2D} ctx Canvas描画コンテキスト
 * @param {number} x 矢印の先端X座標
 * @param {number} y 矢印の先端Y座標
 * @param {number} angle 矢印の角度（ラジアン）
 * @param {number} size 矢印のサイズ
 */
function drawArrow(ctx, x, y, angle, size = 10) {
    const arrowLength = size;
    const arrowAngle = Math.PI / 6; // 30度

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    // 矢印の形を描画
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-arrowLength * Math.cos(arrowAngle), -arrowLength * Math.sin(arrowAngle));
    ctx.moveTo(0, 0);
    ctx.lineTo(-arrowLength * Math.cos(arrowAngle), arrowLength * Math.sin(arrowAngle));
    ctx.stroke();

    ctx.restore();
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
    lineMaxHeight = [];
    textCharList = [];
    textCharPoint = [];
    textCharData = [];
    tronCodeMask = [];

    // TADセグメント処理フラグを初期化
    startTadSegment = false;
    startByImageSegment = false;
    isFontDefined = false;
    isTadStarted = false;

    // フォント関係を初期化（デフォルト値に設定）
    textFontSize = defaultFontSize;
    textFontSet = textFontSize + 'px serif';
    currentFontFamily = 'serif';  // フォントファミリーを初期化
    textFontStyle = 'normal';
    textFontWeight = defaultFontWeight;
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
        logger.error('ctx or canvas not available in renderLinkedDocumentInVirtualObj');
        logger.error('ctx:', ctx, 'canvas:', canvas);
        return;
    }

    // リンク先のデータが存在しない場合は何もしない
    if (!link || !link.raw) {
        logger.debug('No linked document data available');
        return;
    }

    logger.debug(`Rendering linked document at (${x}, ${y}) with size (${width}x${height}) link ${link.link_id}`);

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
        isInVirtualObject = true;  // 仮身内描画フラグを設定
        virtualObjectOffsetX = x;
        virtualObjectOffsetY = y;

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
                logger.debug('Before tadRawArray - textWidth:', textWidth, 'textHeight:', textHeight, 'textRow:', textRow);

                // 仮身内でのTAD処理（座標系は既にシフト済み）
                tadRawArray(link.raw);

                // デバッグ：TAD処理後の状態
                logger.debug('After tadRawArray - textWidth:', textWidth, 'textHeight:', textHeight, 'textRow:', textRow);

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
        logger.error('Error rendering linked document:', error);
    } finally {
        // セグメントスタックから削除
        if (segmentStack.length > 0 && segmentStack[segmentStack.length - 1] === SEGMENT_TYPE.TEXT) {
            segmentStack.pop();
        }
        currentSegmentType = savedSegmentType;

        // デバッグ：復元前の状態
        logger.debug('Before restore - textWidth:', textWidth, 'textHeight:', textHeight, 'textRow:', textRow);
        logger.debug('Saved values - textWidth:', savedTextWidth, 'textHeight:', savedTextHeight, 'textRow:', savedTextRow);
        
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
        logger.debug('After restore - textWidth:', textWidth, 'textHeight:', textHeight, 'textRow:', textRow);

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

        isInVirtualObject = false;  // 仮身内描画フラグを設定
        virtualObjectOffsetX = 0;
        virtualObjectOffsetY = 0;
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

    let linkRecordData = [];
    for(let offsetLen=15;offsetLen<tadSeg.length;offsetLen++) {
        linkRecordData.push(tadSeg[offsetLen]);
//        let char = charTronCode(Number(tadSeg[offsetLen]));
//        logger.debug("linkRecordData[" + offsetLen + "] = [" + char + "] " + IntToHex((tadSeg[offsetLen]),4).replace('0x',''));
    }

    // 開いた仮身の判定：高さが50ピクセルより大きい場合
    const vobjWidth = vobj.right - vobj.left;
    const vobjHeight = vobj.bottom - vobj.top;
    
    logger.debug(`=== VIRTUAL OBJECT DEBUG ===`);

    if (vobjHeight > 50) {
        openVirtualObj = true;
        logger.debug(`Virtual Object marked as OPENED (height: ${vobjHeight})`);
    } else {
        logger.debug(`Virtual Object marked as CLOSED (height: ${vobjHeight})`);
    }

    let newLink = new LINK();
    logger.debug('=== LINK CREATION DEBUG ===');
    logger.debug(`isProcessingBpk: ${isProcessingBpk}, currentFileIndex: ${currentFileIndex}, linkNo: ${linkNo}, window.originalLinkId: ${window.originalLinkId}`);

    if (isProcessingBpk) {
        // セカンダリウィンドウの場合、originalLinkIdを使ってグローバルlinkRecordListから取得
        if (window.originalLinkId !== undefined && window.originalLinkId !== null) {
            const globalLinkRecordList = window.linkRecordList || linkRecordList;
            //logger.debug('Secondary window: using originalLinkId', window.originalLinkId);
            //logger.debug('Available linkRecordList indices:', globalLinkRecordList ? Object.keys(globalLinkRecordList) : 'null');
            
            // 元のファイルのlinkRecordListから取得
            const targetFileIndex = window.originalLinkId - 1; // link_idは1-indexed
            if (globalLinkRecordList && globalLinkRecordList[targetFileIndex] && globalLinkRecordList[targetFileIndex][linkNo]) {
                newLink = globalLinkRecordList[targetFileIndex][linkNo];
                //logger.debug(`Using existing link from globalLinkRecordList[${targetFileIndex}][${linkNo}]`);
                //logger.debug('Retrieved link:', newLink);
            } else {
                //logger.debug(`No existing link found in globalLinkRecordList[${targetFileIndex}][${linkNo}], creating new one`);
                newLink = new LINK();
            }
        } else {
            // メインウィンドウの場合
            if (linkRecordList[currentFileIndex] && linkRecordList[currentFileIndex][linkNo]) {
                newLink = linkRecordList[currentFileIndex][linkNo];
                //logger.debug('Main window: using existing link from linkRecordList');
            } else {
                //logger.debug('Main window: no existing link found, creating new one');
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
        logger.debug(`left:${drawLeft}, top:${drawTop}, right:${drawRight}, bottom:${drawBottom}, textFontSize:${textFontSize}, lineSpacingPitch:${lineSpacingPitch}`);

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
            //logger.debug(`Drawing virtual object text: "${newLink.link_name}" at (${drawLeft}, ${drawTop}) with color ${vobjTextColor}`);
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
    logger.debug(`Virtual Object size: (left:${drawLeft}, top:${drawTop}, right:${drawRight}, bottom:${drawBottom})`);

    // virtual領域の拡大チェック
    expandVirtualArea(drawLeft, drawTop, drawRight, drawBottom);

    logger.debug(`=== SAVING VIRTUAL OBJECT LINK ===`);
    logger.debug(`currentFileIndex: ${currentFileIndex}, linkNo: ${linkNo}`);
    
    // 座標情報をリンクデータに追加
    newLink.left = drawLeft;
    newLink.top = drawTop;
    newLink.right = drawRight;
    newLink.bottom = drawBottom;

    // XMLのリンク情報を保存
    if(isXmlDumpEnabled) {
        xmlBuffer.push(`<link id="${newLink.link_id}" vobjleft="${vobj.left}" vobjtop="${vobj.top}" vobjright="${vobj.right}" vobjbottom="${vobj.bottom}" vobjheight="${vobj.height}" chsz="${vobj.chsz}" frcol="${vobj.frcol.color}" chcol="${vobj.chcol.color}" tbcol="${vobj.tbcol.color}" bgcol="${vobj.bgcol.color}" dlen="${vobj.dlen}">${newLink.link_name || ''}</link>\r\n`);
    }
    
    //logger.debug('Link data to save:', newLink);
    //logger.debug(`Coordinates: left=${drawLeft}, top=${drawTop}, right=${drawRight}, bottom=${drawBottom}`);
    //logger.debug('linkRecordList before save:', linkRecordList);
    //logger.debug('linkRecordList structure check:');
    //logger.debug('  - typeof linkRecordList:', typeof linkRecordList);
    //logger.debug('  - Array.isArray(linkRecordList):', Array.isArray(linkRecordList));
    //logger.debug('  - linkRecordList.length:', linkRecordList.length);
    //logger.debug(`  - linkRecordList[${currentFileIndex}]:`, linkRecordList[currentFileIndex]);
    //logger.debug(`  - Array.isArray(linkRecordList[${currentFileIndex}]):`, Array.isArray(linkRecordList[currentFileIndex]));

    // linkRecordList[currentFileIndex]が存在しない場合は初期化
    if (!linkRecordList[currentFileIndex]) {
        logger.debug(`Initializing linkRecordList[${currentFileIndex}] as empty array`);
        linkRecordList[currentFileIndex] = [];
    }
    
    linkRecordList[currentFileIndex][linkNo] = newLink;
    linkNo++;

    //logger.debug('linkRecordList after save:', linkRecordList);
    //logger.debug(`linkRecordList[${currentFileIndex}] length:`, linkRecordList[currentFileIndex] ? linkRecordList[currentFileIndex].length : 'undefined');
    //logger.debug(`linkRecordList[${currentFileIndex}][${linkNo-1}]:`, linkRecordList[currentFileIndex] ? linkRecordList[currentFileIndex][linkNo-1] : 'undefined');
    logger.debug(`仮身セグメント left : ${vobj.left}, top : ${vobj.top}, right : ${vobj.right}, bottom : ${vobj.bottom}, dlen : ${vobj.dlen} textHeight : ${textHeight}`);
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

    logger.debug(`tsSpecity: left=${Number(uh2h(tadSeg[0]))}, top=${Number(uh2h(tadSeg[1]))}, right=${Number(uh2h(tadSeg[2]))}, bottom=${Number(uh2h(tadSeg[3]))}, chsz=${IntToHex((tadSeg[4]),4).replace('0x','')}, pict=${Number(uh2h(tadSeg[11]))}`);

    logger.debug(`segLen ${Number(segLen)}, nowPos ${Number(nowPos)}`); // 0x26(0d38)は仮身セグメントの開始位置

    const appl = IntToHex((tadSeg[12]),4).replace('0x','')
        + IntToHex((tadSeg[13]),4).replace('0x','')
        + IntToHex((tadSeg[14]),4).replace('0x','');
    
    if (packAppId1 != tadSeg[12] || packAppId2 != tadSeg[13] || packAppId3 != tadSeg[14]) {
        logger.debug("書庫形式ではない アプリケーションID");
        logger.debug("appl   " + appl);
        return;
    }
    logger.debug("書庫形式");

    let fileTadName = [];

    for (offsetLen=15;offsetLen<31;offsetLen++) {
        fileTadName.push(charTronCode(tadSeg[offsetLen]));
    }
    logger.debug("fileTadName " + fileTadName.join(''));

    const dlen = uh2uw([tadSeg[32], tadSeg[31]]);
    logger.debug("dlen   " + dlen[0]);

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
    logger.debug(`gHead: headtype=${gHead.headType}, checkSum=${gHead.checkSum}, version=${gHead.version}, crc=${gHead.crc}, nfiles=${gHead.nfiles}, compmethod=${gHead.compMethod}`);

    compMethod = Number(gHead.compMethod);
    if ((compMethod != LH5) && (compMethod != LH0)) {
        logger.debug("Error file");
        return;
    }
    let time = uh2uw([compSeg[6], compSeg[5]]);
    logger.debug(`Archive: time=${time[0]}, filesize=${gHead.fileSize}, orgsize=${gHead.origSize}, compsize=${gHead.compSize}, extsize=${gHead.extSize}`);

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
        logger.debug('Initializing LH5Decoder directly in tsSpecitySegment');
        logger.debug('tadPos:', tadPos, 'gHead.compSize:', gHead.compSize, 'gHead.origSize:', gHead.origSize);
        
        try {
            // tadRawArrayで渡されたrawデータを使用してLH5Decoderを初期化
            if (typeof window !== 'undefined' && window.currentRawData) {
                logger.debug('currentRawData length:', window.currentRawData.length);
                // tadPosは0ベースで、startPos(142)から開始
                lh5Decoder.init(window.currentRawData, tadPos, gHead.compSize, gHead.origSize);
                lh5Decoder.initialized = true; // 重要：初期化フラグを設定
                
                // 初期化後の状態確認
                logger.debug('LH5Decoder initialized successfully with currentRawData');
                logger.debug('LH5Decoder state: fileData=', !!lh5Decoder.fileData, 'filePos=', lh5Decoder.filePos,
                             'compsize=', lh5Decoder.compsize, 'origsize=', lh5Decoder.origsize, 'initialized=', lh5Decoder.initialized);
            } else {
                logger.error('currentRawData not available, cannot initialize LH5Decoder');
                return; // 初期化失敗の場合は処理を停止
            }
        } catch (error) {
            logger.error('Failed to initialize LH5Decoder:', error);
            logger.error('Parameters: fileData length=', window.currentRawData ? window.currentRawData.length : 'null', 
                         'startPos=', tadPos, 'compSize=', gHead.compSize, 'origSize=', gHead.origSize);
            return;
        }
    }

    logger.debug("startPos : " + startPos);

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
        logger.debug("globalStaticBufTop :" + globalStaticBufTop);
    } else {
        logger.debug("tadPos :" + tadPos);
    }

    // ローカルヘッダの一括読込
    lHead = new Array(gHead.nfiles);
    logger.debug("localHead Num :" + gHead.nfiles);

    // 各LOCAlHeadを1つずつ読み込み（デバッグのため）
    for (let localheadLoop = 0; localheadLoop < gHead.nfiles; localheadLoop++) {
        logger.debug("localHead No:" + localheadLoop);
        
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

        logger.debug(`LocalHead[${localheadLoop}]: name="${lhead.name}", origId=${lhead.origId}, compMethod=${lhead.compMethod}, orgsize=${lhead.origSize}, compSize=${lhead.compSize}, f_nlink=${lhead.f_nlink}, crc=${lhead.crc}, fsize=${lhead.f_size}, offset=${lhead.offset}, nrec=${lhead.f_nrec}, f_ltime=${lhead.f_ltime}`);
        
        lHead[localheadLoop] = lhead;
    }
    
    pass1();
    logger.debug('PASS1 ok!!');

    pass2(lHead);
    logger.debug('PASS2 ok!!');
}

/**
 * TADパーサー TADセグメントを判定
 * @param {0x0000} segID 
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 * @param {int} nowPos
 */
function tadPerse(segID, segLen, tadSeg, nowPos) {
    //logger.debug("tadSeg " + IntToHex((segID),4).replace('0x',''));

    if (segID === Number(TS_INFO)) {
        logger.debug('管理情報セグメント');
        tadVer(tadSeg);
    } else if (segID === Number(TS_TEXT)) {
        logger.debug('文章開始セグメント');
        tsTextStart(tadSeg);
    } else if (segID === Number(TS_TEXTEND)) {
        logger.debug('文章終了セグメント');
        tsTextEnd(tadSeg);
    } else if (segID === Number(TS_FIG)) {
        logger.debug('図形開始セグメント');
        tsFigStart(tadSeg);
    } else if (segID === Number(TS_FIGEND)) {
        logger.debug('図形終了セグメント');
        tsFigEnd(tadSeg);
    } else if (segID === Number(TS_IMAGE)) {
        logger.debug('画像セグメント');
        tsImageSegment(segLen, tadSeg);
    } else if (segID === Number(TS_VOBJ)) {
        logger.debug('仮身セグメント');
        logger.debug('Virtual object segment detected! segLen:', segLen, 'currentFileIndex:', currentFileIndex);
        tsVirtualObjSegment(segLen, tadSeg);
    } else if (segID === Number(TS_DFUSEN)) {
        logger.debug('指定付箋セグメント');
        tsSpecitySegment(segLen, tadSeg, nowPos);
    } else if (segID === Number(TS_FFUSEN)) {
        logger.debug('機能付箋セグメント');
    } else if (segID === Number(TS_TPAGE)) {
        logger.debug('文章ページ割付け指定付箋');
        tadPageSetFusen(segLen, tadSeg);
    } else if (segID === Number(TS_TRULER)) {
        logger.debug('行書式指定付箋');
        tadRulerSetFusen(segLen, tadSeg);
    } else if (segID === Number(TS_TFONT)) {
        logger.debug('文字指定付箋');
        tadFontSetFusen(segLen, tadSeg);
    } else if (segID === Number(TS_TCHAR)) {
        logger.debug('特殊文字指定付箋');
        tadSpecialCharFusen(segLen, tadSeg);
    } else if (segID === Number(TS_TATTR)) {
        logger.debug('文字割り付け指定付箋');
        tadTextAlignFusen(segLen, tadSeg);
    } else if (segID === Number(TS_TSTYLE)) {
        logger.debug('文字修飾指定付箋');
        tadTextStyleFusen(segLen, tadSeg);
    } else if (segID === Number(TS_TVAR)) {
        logger.debug('変数参照指定付箋');
        tsVariableReference(segLen, tadSeg);
    } else if (segID === Number(TS_TMEMO)) {
        logger.debug('文章メモ指定付箋');
        tsDocumentMemo(segLen, tadSeg);
    } else if (segID === Number(TS_TAPPL)) {
        logger.debug('文章アプリケーション指定付箋');
    } else if (segID === Number(TS_FPRIM)) {
        logger.debug('図形要素セグメント');
        tsFigDraw(segLen, tadSeg);
    } else if (segID === Number(TS_FDEF)) {
        logger.debug('データ定義セグメント');
        tsDataSet(segLen, tadSeg);
    } else if (segID === Number(TS_FGRP)) {
        logger.debug('グループ定義セグメント');
        tsGroupSet(segLen, tadSeg);
    } else if (segID === Number(TS_FMAC)) {
        logger.debug('マクロ定義/参照セグメント');
    } else if (segID === Number(TS_FATTR)) {
        logger.debug('図形修飾セグメント');
        tsFigureModifier(segLen, tadSeg);
    } else if (segID === Number(TS_FPAGE)) {
        logger.debug('図形ページ割り付け指定付箋');
        tsFigurePageFusen(segLen, tadSeg);
    } else if (segID === Number(TS_FMEMO)) {
        logger.debug('図形メモ指定付箋');
        tsFigureMemo(segLen, tadSeg);
    } else if (segID === Number(TS_FAPPL)) {
        logger.debug('図形アプリケーション指定付箋');
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
        logger.debug("TRON Code面 :" + tronCodeMask[textNest])
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
    
    logger.debug(`Double-click detected at (${mouseX1}, ${mouseY1})`);

    // TADjsデスクトップ環境では、canvasにvirtualObjectLinksが保存されており、
    // setupVirtualObjectEventsで独自の処理が行われるため、ここでは処理しない
    if (typeof window.tadjsDesktop !== 'undefined') {
        logger.debug('TADjsDesktop environment detected, skipping tad.js link processing');
        return; // TADjsデスクトップの処理に任せる
    }

    // 現在のタブインデックスを取得
    let tabIndex = 0;

    // TADjsデスクトップ環境では独自の処理を行うため、tad.jsのタブ処理はスキップ
    if (typeof window.tadjsDesktop !== 'undefined') {
        return;
    }
    
    if (typeof currentTabIndex !== 'undefined') {
        tabIndex = currentTabIndex;
    } else if (window.originalLinkId !== undefined && window.originalLinkId !== null) {
        // セカンダリウィンドウの場合、originalLinkIdを使用
        tabIndex = window.originalLinkId - 1; // originalLinkIdは1-indexed
    } else if (isProcessingBpk && currentFileIndex > 0) {
        tabIndex = currentFileIndex - 1; // currentFileIndexは次のファイル用に既にインクリメントされている
    }
    
    logger.debug(`Current tab index: ${tabIndex}`);

    // リンク座標リストを参照してリストにあればリンク先を参照する
    // canvasに保存されたvirtualObjectLinksがある場合は、
    // TADjsデスクトップ環境またはプラグイン環境なので、独自処理に任せる
    const canvas = e.target;
    if (canvas.virtualObjectLinks) {
        logger.debug('canvas.virtualObjectLinks exists, skipping tad.js link processing');
        return;
    }

    const links = (linkRecordList && linkRecordList[tabIndex]) || [];

    if (links && links.length > 0) {
        //logger.debug(`Checking ${links.length} links for tab ${tabIndex}`);

        for (const link of links) {
            //logger.debug(`Link:`, link);
            
            // リンクに座標情報がある場合のみチェック
            if (link.left !== undefined && link.right !== undefined && 
                link.top !== undefined && link.bottom !== undefined) {
                
                if (mouseX1 >= link.left && mouseX1 <= link.right &&
                    mouseY1 >= link.top && mouseY1 <= link.bottom) {

                    logger.debug(`Link clicked: ${link.link_name} (ID: ${link.link_id})`);

                    // link_idがある場合は対応するcanvasタブに移動
                    if (link.link_id && link.link_id > 0) {
                        // link_idを0ベースのタブインデックスに変換
                        const targetTabIndex = link.link_id - 1;
                        
                        logger.debug(`Navigating to tab ${targetTabIndex} for link_id ${link.link_id}`);
                        
                        // index_old2.htmlのswitchTab関数を呼び出し
                        if (typeof switchTab === 'function') {
                            switchTab(targetTabIndex);
                            logger.debug(`Switched to tab ${targetTabIndex}`);
                        } else {
                            logger.warn('switchTab function not available');
                            alert(`Link to tab ${targetTabIndex} (${link.link_name})`);
                        }
                    }
                    break;
                }
            }
        }
    } else {
        logger.debug(`No links found for tab ${tabIndex}`);
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
    logger.debug(`canvasInit: document.getElementById('${canvasId}'):`, !!canvas);
    
    
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
        let P4 = '';

        let raw16 = data_view.getUint16(i,true);

        if (raw16 === Number(TNULL)) {
            // 終端
            if (isTadDumpEnabled()) {
                tadTextDumpBuffer.push('buffer over.\r\n');
            }
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

        } else {
            const raw8Plus1 = Number(data_view.getUint16(i,true));
            const char = charTronCode(raw8Plus1);
            if (isTadDumpEnabled()) {
                tadTextDumpBuffer.push('char = ( ' + IntToHex((raw8Plus1),4).replace('0x','') + ' )' + char);
            }

            // XML出力（文章セグメント内の場合のみ）
            if (isXmlDumpEnabled()) {
                // XML特殊文字のエスケープ
                const xmlChar = char
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&apos;');
                xmlBuffer.push(xmlChar);
            }
            P4 += char;
            i += 2;
            if (textNest > 0){
                // drawText呼び出し前の最終チェック
                if (!ctx || !canvas) {
                    // 緊急修復を試行
                    ctx = window.ctx;
                    canvas = window.canvas;
                    logger.debug('Emergency repair attempted - ctx:', !!ctx, 'canvas:', !!canvas);
                }

                // 次の文字を先読み（行頭禁則処理のため）
                let nextChar = null;
                if (i < raw.length) {
                    try {
                        const nextRaw8Plus1 = Number(data_view.getUint16(i, true));
                        nextChar = charTronCode(nextRaw8Plus1);
                    } catch (e) {
                        // 先読みに失敗した場合はnullのまま
                    }
                }

                drawText(ctx, canvas, char, nextChar,textFontSize,  textCharPoint[textNest-1][0],textCharPoint[textNest-1][1] ,textCharPoint[textNest-1][2], textSpacingPitch, lineSpacingPitch, 0);
            }
        }

        textCharList[textNest-1] += P4;

        if (isTadDumpEnabled()) {
            tadTextDumpBuffer.push('\r\n');
            tadTextDumpBuffer.push(IntToHex((i),8).replace('0x','') + ' ');
        }
    }

    // XMLBuffer が </document></figure> で終わっていない場合は追加
    if (isXmlDumpEnabled() && xmlBuffer.length > 0) {
        //const lastEntry = xmlBuffer[xmlBuffer.length - 1];
        if (isXmlTad) {
            logger.debug('Adding closing </document> tag to xmlBuffer');
            xmlBuffer.push('</document>\r\n');
        }
        if (isXmlFig) {
            logger.debug('Adding closing </figure> tag to xmlBuffer');
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
    
    logger.debug(`*** New tadDataArray: nfiles=${nfiles}, fileIndex=${fileIndex}, isRedrawn=${isRedrawn} ***`);
    
    // Reset text dump buffers for new processing (only if dump is enabled)
    if (!isRedrawn) {
        if (isTadDumpEnabled()) {
            tadTextDumpBuffer = ['00000000 '];
        } else {
            tadTextDumpBuffer = [];
        }

        // XMLバッファの初期化
        if (isXmlDumpEnabled()) {
            xmlBuffer = [];
            isInDocSegment = false;
            currentIndentLevel = 0;
        }

        // BPK内の各ファイル処理時にTADセグメント処理フラグをリセット
        // これにより、各ファイルが独立して処理される
        startTadSegment = false;
        startByImageSegment = false;
    }
    
    // TADファイルごとのrawデータを保管
    if (!isRedrawn && raw && raw.length > 0) {
        if (!tadRawDataArray[fileIndex]) {
            tadRawDataArray[fileIndex] = new Uint8Array(raw);
            logger.debug(`TAD raw data saved for file ${fileIndex}, size: ${raw.length}`);
        }
    }
    
    // 再描画時は保存されたrawデータを使用
    if (isRedrawn && tadRawDataArray[fileIndex]) {
        raw = tadRawDataArray[fileIndex];
        logger.debug(`Using saved raw data for file ${fileIndex}, size: ${raw.length}`);
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
        // tadjs-desktop環境ではcanvas-X要素が存在しないためスキップ
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
    logger.debug('TAD processing completed');
    logger.debug(`Final state for tab ${tabIndex}:`, finalState);
    
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
                logger.debug(`*** INITIAL DISPLAY: rendering file ${fileIndex} to tab ${displayTabIndex} ***`);
            } else if (!isRedrawn) {
                // 他のタブは遅延描画（必要時にのみ描画）
                logger.debug(`*** DEFERRED RENDERING: file ${fileIndex} ready for tab ${displayTabIndex} ***`);
            } else {
                // 再描画時は即座に実行
                const state = getTabScrollState(displayTabIndex);
                renderFromTadFileDrawBuffer(fileIndex, displayTabIndex, state.scrollX, state.scrollY);
            }
        }
    }
    
    logger.debug(`*** TAD file ${fileIndex} processing completed ***`);
    
    // Join buffer arrays to create final strings (only if enabled)
    if (isTadDumpEnabled()) {
        tadTextDump = tadTextDumpBuffer.join('');
    } else {
        tadTextDump = 'TAD Dump is disabled';
    }
    


    // XML出力の最終処理
    if (isXmlDumpEnabled()) {
        parseXML = xmlBuffer.join('');
        // グローバル配列xmlに追加
        xml.push(parseXML);
        logger.debug(`XML parsed for file ${fileIndex}: ${parseXML.substring(0, 100)}...`);
        logger.debug(`XML array length: ${xml.length}`);
        logger.debug(`xmlBuffer length: ${xmlBuffer.length}`);
        logger.debug(`isInDocSegment: ${isInDocSegment}`);
    } else {
        parseXML = '';
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
                    tadDumpView.value = '';
                    let chunkIndex = 0;

                    const updateChunk = () => {
                        if (chunkIndex < chunks.length) {
                            tadDumpView.value += chunks[chunkIndex];
                            chunkIndex++;
                            setTimeout(updateChunk, 0);
                        }
                    };
                    updateChunk();
                } else {
                    tadDumpView.value = tadTextDump;
                }
            } else {
                tadDumpView.value = tadTextDump;
            }
        }
        
        if (tadTextView) {
            logger.debug(`XML Display Debug: isXmlDumpEnabled=${isXmlDumpEnabled()}, xml.length=${xml ? xml.length : 0}`);
            if (isXmlDumpEnabled() && xml && xml.length > 0) {
                // XML配列の全内容を表示
                let xmlContent = '';
                xml.forEach((xmlData, index) => {
                    logger.debug(`XML Data [${index}]: length=${xmlData ? xmlData.length : 0}`);
                    if (xmlData && xmlData.length > 0) {
                        xmlContent += `<!-- File ${index + 1} -->\n${xmlData}\n`;
                    }
                });

                logger.debug(`Final XML content length: ${xmlContent.length}`);
                if (xmlContent.length > 0) {
                    // XMLを整形して表示（HTMLエスケープ）
                    tadTextView.innerHTML = '<pre>' + htmlspecialchars(xmlContent) + '</pre>';
                } else {
                    tadTextView.innerHTML = '<pre>No XML content generated (empty content)</pre>';
                }
            } else {
                const reason = !isXmlDumpEnabled() ? 'disabled' : 'no data in xml array';
                tadTextView.innerHTML = `<pre>XML Parse is ${reason}</pre>`;
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
    logger.debug(`TAD processing completed for canvas: ${canvasId}, callback: ${callbackName}`);
    logger.debug(`Callback function exists: ${typeof window[callbackName] === 'function'}`);
    logger.debug(`isProcessingBpk: ${isProcessingBpk}, tadRecordDataArray length: ${tadRecordDataArray ? tadRecordDataArray.length : 'null'}, currentFileIndex: ${currentFileIndex}`);
    
    if (typeof window !== 'undefined' && typeof window[callbackName] === 'function') {
        // BPK処理の場合は最後のファイル処理時のみコールバックを呼ぶ
        // 単体TADファイルの場合は常にコールバックを呼ぶ
        const shouldCallCallback = !isProcessingBpk || 
                                !tadRecordDataArray || 
                                tadRecordDataArray.length <= 1 || 
                                currentFileIndex >= tadRecordDataArray.length - 1;
        
        logger.debug(`shouldCallCallback: ${shouldCallCallback}`);
        
        if (shouldCallCallback) {
            setTimeout(() => {
                logger.debug(`Calling ${callbackName} callback (final)`);
                window[callbackName]({
                    linkRecordList: linkRecordList,
                    tadRecordDataArray: tadRecordDataArray,
                    isProcessingBpk: isProcessingBpk,
                    currentFileIndex: currentFileIndex
                });
            }, 10); // DOM更新後に実行
        } else {
            logger.debug(`Skipping callback - not final file (currentFileIndex: ${currentFileIndex}, total files: ${tadRecordDataArray ? tadRecordDataArray.length : 'null'})`);
        }
    } else {
        logger.debug(`Callback ${callbackName} not found or not a function`);
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
            logger.debug('parseTADToXML開始: fileIndex=' + fileIndex + ', データサイズ=' + rawData.length);

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

            logger.debug('tadRawArray呼び出し前: isXmlDumpEnabled=' + isXmlDumpEnabled());

            // TADをパース（同期処理）
            tadRawArray(uint8Array);

            logger.debug('tadRawArray呼び出し後: xml.length=' + xml.length + ', xml[' + fileIndex + '].length=' + (xml[fileIndex] ? xml[fileIndex].length : 0));
            logger.debug('parseXML.length=' + parseXML.length);

            // パース結果のXMLを取得
            let resultXML = '';
            if (xml && xml[fileIndex]) {
                resultXML = xml[fileIndex];
                logger.debug('xml[' + fileIndex + ']から取得: ' + resultXML.length + '文字');
            } else if (parseXML) {
                resultXML = parseXML;
                logger.debug('parseXMLから取得: ' + resultXML.length + '文字');
            }

            // 強制フラグを戻す
            forceXmlDumpEnabled = false;

            logger.debug(`TAD→XML変換完了: ${resultXML.length}文字`);
            if (resultXML.length > 0) {
                logger.debug('XMLプレビュー: ' + resultXML.substring(0, 200));
            }
            resolve(resultXML);
        } catch (error) {
            logger.error('TAD→XML変換エラー:', error);
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
    tadFileCanvases = {};
    tadFileContexts = {};
    tadFileDrawBuffers = {};
    tadRawDataArray = {};
    
    logger.debug('TAD file drawing system reset');
    
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
        // logger.debug(raw);
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
 * TAD保存処理
 * TODO: 未実装
 * @returns null
 */
function save() {

    // canvasを画像で保存
    logger.debug("save canvas to image");
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

    // TAD描画用のコア関数をエクスポート
    window.tadRawArray = tadRawArray;
    window.canvasInit = canvasInit;
    window.initTAD = initTAD;

    // XML変換関数をエクスポート
    window.parseTADToXML = parseTADToXML;

    // 文章メモ関数をエクスポート
    window.getDocumentMemos = getDocumentMemos;
    window.clearDocumentMemos = clearDocumentMemos;
    window.getDocumentMemo = getDocumentMemo;

    // 図形メモ関数をエクスポート
    window.getFigureMemos = getFigureMemos;
    window.clearFigureMemos = clearFigureMemos;
    window.getFigureMemo = getFigureMemo;

    // 図形修飾関数をエクスポート
    window.resetFigureModifier = resetFigureModifier;
    window.drawArrow = drawArrow;

    logger.debug('TAD.js functions exported to global scope:', {
        onAddFile: typeof window.onAddFile,
        onDrop: typeof window.onDrop,
        onDragOver: typeof window.onDragOver,
        save: typeof window.save,
        tadSave: typeof window.tadSave,
        tadRawArray: typeof window.tadRawArray,
        canvasInit: typeof window.canvasInit,
        initTAD: typeof window.initTAD,
        parseTADToXML: typeof window.parseTADToXML,
        getDocumentMemos: typeof window.getDocumentMemos,
        clearDocumentMemos: typeof window.clearDocumentMemos,
        getDocumentMemo: typeof window.getDocumentMemo,
        getFigureMemos: typeof window.getFigureMemos,
        clearFigureMemos: typeof window.clearFigureMemos,
        getFigureMemo: typeof window.getFigureMemo,
        resetFigureModifier: typeof window.resetFigureModifier,
        drawArrow: typeof window.drawArrow
    });
}
