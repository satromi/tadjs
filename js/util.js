/**
 * 共通ユーティリティ関数
 * TADjs Desktopに各種定数と便利な関数を提供
 * @module util
 */

// ========================================
// 定数
// ========================================

// タイムアウト値（ミリ秒）
/**
 * ダイアログのタイムアウト時間（ミリ秒）
 * 保存確認、入力、メッセージなどの各種ダイアログに適用
 */
export const DIALOG_TIMEOUT_MS = 10000; // 10秒

/**
 * 一般的な操作のタイムアウト時間（ミリ秒）
 * clipboard-data, real-object-loaded, load-data-file-response等に適用
 * 注: 多数の仮身を持つドキュメント (背景画面集 等) で 30+ の expandVirtualObject が同時実行されると
 * リクエストキューが詰まり 5 秒では timeout するため 15 秒に拡大
 */
export const DEFAULT_TIMEOUT_MS = 15000; // 15秒

/**
 * 長い操作のタイムアウト時間（ミリ秒）
 * window-opened, save-as-new-real-object-completed, virtual-object-attributes-changed等に適用
 */
export const LONG_OPERATION_TIMEOUT_MS = 30000; // 30秒

/**
 * アイコン読み込みのタイムアウト時間（ミリ秒）
 */
export const ICON_LOAD_TIMEOUT_MS = 3000; // 3秒

/**
 * UI更新遅延時間（ミリ秒）
 * DOM操作後のレイアウト更新待ち等に適用
 */
export const UI_UPDATE_DELAY_MS = 100; // 100ミリ秒

/**
 * 短いUI更新遅延時間（ミリ秒）
 * 即座のレンダリング更新待ち等に適用
 */
export const QUICK_UI_UPDATE_DELAY_MS = 10; // 10ミリ秒

/**
 * アイコン設定遅延時間（ミリ秒）
 * ウィンドウ作成後のアイコン設定待ち等に適用
 */
export const ICON_SET_DELAY_MS = 200; // 200ミリ秒

/**
 * スクロールバー更新遅延時間（ミリ秒）
 * ウィンドウリサイズ後のスクロールバー更新待ち等に適用
 */
export const SCROLL_UPDATE_DELAY_MS = 300; // 300ミリ秒

/**
 * メニュー取得タイムアウト時間（ミリ秒）
 * プラグインからのメニュー定義取得に適用
 */
export const MENU_FETCH_TIMEOUT_MS = 1000; // 1秒

/**
 * ステータス更新間隔（ミリ秒）
 * ステータスバーの時刻表示更新間隔等に適用
 */
export const STATUS_UPDATE_INTERVAL_MS = 1000; // 1秒

/**
 * ステータスメッセージ表示時間（ミリ秒）
 * 一時的なステータスメッセージの表示時間
 */
export const STATUS_MESSAGE_DURATION_MS = 5000; // 5秒

/**
 * コンテキストメニューフラグのクリア遅延（ミリ秒）
 * コンテキストメニュー開閉の即座検出防止用
 */
export const CONTEXT_MENU_FLAG_CLEAR_MS = 100; // 100ミリ秒

/**
 * ダブルクリック判定時間（ミリ秒）
 * 連続クリックをダブルクリックとみなす時間間隔
 */
export const DOUBLE_CLICK_TIME_MS = 1000; // 1秒

/**
 * エラーチェック用短期タイムアウト（ミリ秒）
 * エラーレスポンスの即座チェックに適用
 */
export const ERROR_CHECK_TIMEOUT_MS = 100; // 100ミリ秒

/**
 * リトライ遅延時間（ミリ秒）
 * 要素の検出リトライ等に適用
 */
export const RETRY_DELAY_MS = 50; // 50ミリ秒

/**
 * クリック判定遅延時間（ミリ秒）
 * シングルクリックとダブルクリックの判定待機時間
 */
export const CLICK_DEBOUNCE_DELAY_MS = 250; // 250ミリ秒

/**
 * ウィンドウクローズ後のクリーンアップ遅延（ミリ秒）
 * ウィンドウ削除とフォーカス移動の処理待ち
 */
export const WINDOW_CLOSE_CLEANUP_DELAY_MS = 150; // 150ミリ秒

/**
 * アニメーション完了待機時間（ミリ秒）
 * CSSアニメーション完了後の処理待ち（アニメーション0.2s + 余裕）
 */
export const ANIMATION_COMPLETE_DELAY_MS = 250; // 250ミリ秒

/**
 * データファイル読み込みのタイムアウト時間（ミリ秒）
 */
export const LOAD_DATA_FILE_TIMEOUT_MS = 10000; // 10秒

// デフォルト色
/**
 * デフォルト枠線色（黒）
 */
export const DEFAULT_FRCOL = '#000000';

/**
 * デフォルト文字色（黒）
 */
export const DEFAULT_CHCOL = '#000000';

/**
 * デフォルトタイトルバー背景色（白）
 */
export const DEFAULT_TBCOL = '#ffffff';

/**
 * デフォルト背景色（白）
 */
export const DEFAULT_BGCOL = '#ffffff';

// レイアウト定数
/**
 * デフォルト行の高さ（line-height）
 */
export const DEFAULT_LINE_HEIGHT = 1.2;

/**
 * 仮身枠のボーダー幅（上下合計、ピクセル）
 * DOM要素の高さ（box-sizing: border-box）にはborderが含まれるが、
 * TADファイルのheight属性はborderを含まない値を保存する
 */
export const VOBJ_BORDER_WIDTH = 2;

/**
 * 閉じた仮身の左右パディング合計（ピクセル）
 * 左:8px + 右:8px = 16px
 */
export const VOBJ_PADDING_HORIZONTAL = 16;

/**
 * 閉じた仮身の上下パディング合計（ピクセル）
 * 上:4px + 下:4px = 8px
 */
export const VOBJ_PADDING_VERTICAL = 8;

/**
 * 開いた仮身のタイトルバー上下パディング合計（ピクセル）
 * 上:8px + 下:8px = 16px
 */
export const VOBJ_TITLEBAR_PADDING_VERTICAL = 16;

/**
 * 仮身複製時のドロップ水平オフセット（ピクセル）
 */
export const VOBJ_DROP_OFFSET_X = 20;

/**
 * 仮身複製時のドロップ垂直オフセット（ピクセル）
 */
export const VOBJ_DROP_OFFSET_Y = 30;

/**
 * 開いた仮身のコンテンツエリア最小高さ（ピクセル）
 * 開いた仮身の最小サイズ = 仮身枠 (タイトルバー = 閉じた仮身の高さ) + この値
 * 仮身枠の直下に枠線が来てしまう状態を防ぐためのコンテンツ確保領域
 */
export const VOBJ_MIN_OPEN_HEIGHT_OFFSET = 20;

/**
 * 閉じた仮身のデフォルト高さ（ピクセル）
 * chsz=14pt時のgetMinClosedHeight()計算結果: contentHeight(23) + padding(8) = 31
 */
export const DEFAULT_VOBJ_HEIGHT = 31;

/**
 * デフォルトフォントサイズ (ポイント、 BTRON 標準)
 */
export const DEFAULT_FONT_SIZE = 14;

/**
 * ポイント → ピクセル変換係数 (CSS 標準: 1 inch = 72 pt = 96 px → 96 / 72 = 4 / 3)
 */
export const PT_TO_PX_RATIO = 4 / 3;

/**
 * ピクセル / インチ (CSS 標準 DPI)
 */
export const DPI = 96;

/**
 * 1 文字幅 (ピクセル) = デフォルトフォントサイズ × PT_TO_PX_RATIO
 * BTRON タブ書式の ruler 表示で「線 1 本 = 1 文字幅」 として使用
 * 段落フォントサイズに依存せず文書共通の固定値 (Word 風)
 */
export const CHAR_UNIT_PX = DEFAULT_FONT_SIZE * PT_TO_PX_RATIO;

/**
 * デフォルトフォントファミリー（仮身名表示用）
 */
export const DEFAULT_FONT_FAMILY = "'Noto Sans JP', sans-serif";

/**
 * デフォルトフォントスタイル（normal/italic/oblique）
 */
export const DEFAULT_FONT_STYLE = 'normal';

/**
 * デフォルトフォントウェイト（400 = normal）
 */
export const DEFAULT_FONT_WEIGHT = '400';

/**
 * デフォルトフォントストレッチ（normal/condensed/expanded等）
 */
export const DEFAULT_FONT_STRETCH = 'normal';

/**
 * デフォルト文字間隔（letter-spacing）
 */
export const DEFAULT_LETTER_SPACING = '0';

/**
 * デフォルト入力欄の幅（文字数）
 */
export const DEFAULT_INPUT_WIDTH = 30;

// ウィンドウ定数
/**
 * ウィンドウの最小幅（ピクセル）
 */
export const MIN_WINDOW_WIDTH = 200;

/**
 * ウィンドウの最小高さ（ピクセル）
 */
export const MIN_WINDOW_HEIGHT = 150;

// スクロールバー定数
/**
 * スクロールバーのサムの最小サイズ（ピクセル）
 */
export const MIN_SCROLLBAR_THUMB_SIZE = 20;

// UI色定数
/**
 * デスクトップ背景色
 */
export const DESKTOP_BG_COLOR = '#c0c0c0';

/**
 * スクロールバーのサム色
 */
export const SCROLLBAR_THUMB_COLOR = '#d0d0d0';

/**
 * ホバー時の背景色
 */
export const HOVER_BG_COLOR = '#e0e0e0';

/**
 * ダイアログ背景色
 */
export const DIALOG_BG_COLOR = '#f0f0f0';

/**
 * ボーダー色
 */
export const BORDER_COLOR = '#cccccc';

/**
 * グレー色（無効状態、非アクティブ表示用）
 */
export const GRAY_COLOR = '#808080';

/**
 * 日曜・祝日用の赤色
 */
export const SUNDAY_COLOR = '#ee0000';

/**
 * 土曜日用の青色
 */
export const SATURDAY_COLOR = '#0000cc';

/**
 * 今日のセル背景色（カレンダー用）
 */
export const TODAY_CELL_COLOR = '#ffffd0';

/**
 * 選択枠色（ネイビー）
 */
export const SELECTION_COLOR = '#000080';

/**
 * カレンダー仮身の背景色（水色系）
 */
export const CALENDAR_VOBJ_BGCOL = '#e8f4ff';

/**
 * カレンダー仮身のボーダー色（グレー系）
 */
export const CALENDAR_VOBJ_FRCOL = '#b0c0d0';

/**
 * 仮身選択時の枠色（明るい青）
 */
export const VOBJ_SELECTION_COLOR = '#007bff';

/**
 * リスト選択時の背景色（薄い水色）
 */
export const LIST_SELECTED_BG_COLOR = '#e8f4f8';

/**
 * プレビュー枠線色（Windows青）
 */
export const PREVIEW_BORDER_COLOR = '#0078d4';

/**
 * 子実身アップロードの最大オブジェクト数
 */
export const MAX_CHILD_UPLOAD_OBJECTS = 10000;

// ========================================
// TADデフォルトマスク定義（ID 0-13）
// ========================================

/**
 * TAD仕様のデフォルトマスク定義（ID 0-13、4×4ビットマップ）
 * 16bitワード値配列で格納。MSBが左端ピクセル、1=描画、0=非描画
 * パターン定義セグメントのmask[]フィールドで参照される
 */
export const DEFAULT_MASK_DEFINITIONS = [
    { id: 0,  width: 4, height: 4, wordValues: [0x0000, 0x0000, 0x0000, 0x0000] }, // 未定義（透明）
    { id: 1,  width: 4, height: 4, wordValues: [0x0000, 0x0000, 0x0000, 0x0000] }, // 0%
    { id: 2,  width: 4, height: 4, wordValues: [0x8000, 0x0000, 0x2000, 0x0000] }, // 12.5%
    { id: 3,  width: 4, height: 4, wordValues: [0xa000, 0x0000, 0xa000, 0x0000] }, // 25%
    { id: 4,  width: 4, height: 4, wordValues: [0xa000, 0x5000, 0xa000, 0x5000] }, // 50%
    { id: 5,  width: 4, height: 4, wordValues: [0xa000, 0xf000, 0xa000, 0xf000] }, // 75%
    { id: 6,  width: 4, height: 4, wordValues: [0xb000, 0xf000, 0xe000, 0xf000] }, // 87.5%
    { id: 7,  width: 4, height: 4, wordValues: [0xf000, 0xf000, 0xf000, 0xf000] }, // 100%
    { id: 8,  width: 4, height: 4, wordValues: [0x4000, 0x4000, 0x4000, 0x4000] }, // 縦線
    { id: 9,  width: 4, height: 4, wordValues: [0x0000, 0xf000, 0x0000, 0x0000] }, // 横線
    { id: 10, width: 4, height: 4, wordValues: [0x1000, 0x2000, 0x4000, 0x8000] }, // 右上がり斜線 /
    { id: 11, width: 4, height: 4, wordValues: [0x8000, 0x4000, 0x2000, 0x1000] }, // 左下がり斜線 \
    { id: 12, width: 4, height: 4, wordValues: [0x4000, 0xf000, 0x4000, 0x4000] }, // 縦横クロスハッチ
    { id: 13, width: 4, height: 4, wordValues: [0x9000, 0x6000, 0x6000, 0x9000] }, // 斜線クロスハッチ
];

// ========================================
// ユーティリティ関数
// ========================================

/**
 * JIS丸め（最近接偶数への丸め）
 * JIS Z 8401に準拠した丸め処理
 * @param {number} value - 丸める値
 * @returns {number} 丸められた整数値
 */
function jisRound(value) {
    const lower = Math.floor(value);
    const upper = Math.ceil(value);
    const decimal = value - lower;

    // ちょうど0.5でない場合は通常の四捨五入
    if (Math.abs(decimal - 0.5) >= Number.EPSILON) {
        return Math.round(value);
    }

    // ちょうど0.5の場合、偶数側に丸める（JIS丸め）
    return (lower % 2 === 0) ? lower : upper;
}

/**
 * ポイント（pt）をピクセル（px）に変換
 * @param {number} pt - ポイント値
 * @returns {number} ピクセル値（整数、JIS丸め）
 */
const _ptToPxCache = new Map();
const _PT_TO_PX_CACHE_MAX = 256;

export function convertPtToPx(pt) {
    const cached = _ptToPxCache.get(pt);
    if (cached !== undefined) return cached;
    // 96 DPI での標準変換: 1pt = 1.333px
    // JIS Z 8401準拠の最近接偶数への丸めで整数値に変換
    const result = jisRound(pt * 1.333);
    if (_ptToPxCache.size >= _PT_TO_PX_CACHE_MAX) _ptToPxCache.clear();
    _ptToPxCache.set(pt, result);
    return result;
}

/**
 * ピクセル（px）をポイント（pt）に変換
 * @param {number} px - ピクセル値
 * @returns {number} ポイント値（小数点以下あり）
 */
export function convertPxToPt(px) {
    // 96 DPI での標準変換: 1px = 0.75pt (= 3/4)
    return px * 3 / 4;
}

/**
 * RGB文字列を16進数色コード（#RRGGBB）に変換
 * @param {string} color - RGB文字列（例: "rgb(255, 0, 0)" または "rgba(255, 0, 0, 0.5)"）
 * @returns {string} 16進数色コード（例: "#ff0000"）または元の文字列
 */
export function rgbToHex(color) {
    if (!color) return '';

    // 既に#rrggbb形式の場合はそのまま返す
    if (color.startsWith('#')) {
        // Chrome workaround: #010101（黒色の代替）を#000000に正規化
        if (color.toLowerCase() === '#010101') return '#000000';
        return color;
    }

    // rgb() または rgba() 形式をパース
    const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/i);
    if (rgbMatch) {
        const r = parseInt(rgbMatch[1], 10);
        const g = parseInt(rgbMatch[2], 10);
        const b = parseInt(rgbMatch[3], 10);
        const result = '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
        // Chrome workaround: #010101（黒色の代替）を#000000に正規化
        if (result === '#010101') return '#000000';
        return result;
    }
    return color;
}

/**
 * 16進数色コード（#RRGGBB）をRGBオブジェクトに変換
 * @param {string} hex - 16進数色コード（例: "#ff0000" または "ff0000"）
 * @returns {{r: number, g: number, b: number}} RGBオブジェクト
 */
export function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : {r: 0, g: 0, b: 0};
}

/**
 * 16進数色コードを反転（補色）
 * @param {string} hex - 16進数色コード（例: "#ff0000"）
 * @returns {string} 反転された16進数色コード
 */
export function invertColor(hex) {
    const r = 255 - parseInt(hex.substr(1, 2), 16);
    const g = 255 - parseInt(hex.substr(3, 2), 16);
    const b = 255 - parseInt(hex.substr(5, 2), 16);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

/**
 * HTMLエスケープ - XSS対策用
 * @param {string} text - エスケープする文字列
 * @returns {string} HTMLエスケープされた文字列
 */
export function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#x27;',
        '/': '&#x2F;'
    };
    return String(text).replace(/[&<>"'/]/g, (s) => map[s]);
}

/**
 * XML特殊文字をエスケープ
 * @param {string} text - エスケープする文字列
 * @returns {string} エスケープ済み文字列
 */
export function escapeXml(text) {
    if (typeof text !== 'string') return '';
    return text
        .replace(/\u200B/g, '') // ゼロ幅スペースを除去（カーソル位置保持用の技術的文字）
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/**
 * XML特殊文字をアンエスケープ
 * @param {string} text - アンエスケープする文字列
 * @returns {string} アンエスケープ済み文字列
 */
export function unescapeXml(text) {
    if (typeof text !== 'string') return '';
    return text
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&gt;/g, '>')
        .replace(/&lt;/g, '<')
        .replace(/&amp;/g, '&');
}

/**
 * ペースト用テキストの改行コード正規化
 * Windows改行(\r\n)およびCR(\r)を LF(\n)に統一する
 * @param {string} text - 正規化するテキスト
 * @returns {string} 正規化されたテキスト
 */
export function normalizePasteText(text) {
    if (typeof text !== 'string') return '';
    return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * canvas 要素上のマウス座標を取得 (CSS px、getBoundingClientRect ベース)
 * canvas の論理サイズで処理する場合に使用。DPR 補正は行わない。
 *
 * @param {MouseEvent|PointerEvent} event - マウスイベント
 * @param {HTMLCanvasElement} canvas - canvas 要素
 * @returns {{x: number, y: number}} canvas 左上原点の座標 (CSS px)
 */
export function getCanvasMouseCoordinates(event, canvas) {
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
    };
}

/**
 * 一般 DOM 要素上のマウス座標を取得 (scroll 加算オプション付き)
 * スクロール可能なコンテナ内のマウス位置を取得する場合に使用。
 *
 * @param {MouseEvent|PointerEvent} event - マウスイベント
 * @param {HTMLElement} element - 対象要素
 * @param {{includeScroll?: boolean}} [options] - includeScroll: true で要素の scrollLeft/Top を加算
 * @returns {{x: number, y: number}} 要素左上原点の座標 (CSS px)
 */
export function getElementMouseCoordinates(event, element, options = {}) {
    const rect = element.getBoundingClientRect();
    let x = event.clientX - rect.left;
    let y = event.clientY - rect.top;
    if (options.includeScroll) {
        x += element.scrollLeft;
        y += element.scrollTop;
    }
    return { x, y };
}

/**
 * canvas のバッキングストア座標 (物理ピクセル) を取得
 * High-DPI 環境で canvas.width / canvas.height ベースの座標が必要な場合に使用。
 *
 * @param {MouseEvent|PointerEvent} event - マウスイベント
 * @param {HTMLCanvasElement} canvas - canvas 要素
 * @param {number} [dpr] - devicePixelRatio (省略時は window.devicePixelRatio || 1)
 * @returns {{x: number, y: number}} canvas バッキングストア座標 (物理 px)
 */
export function getCanvasBackingStoreCoordinates(event, canvas, dpr) {
    const factor = dpr || window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    return {
        x: (event.clientX - rect.left) * factor,
        y: (event.clientY - rect.top) * factor
    };
}
