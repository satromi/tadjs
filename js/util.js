/**
 * 共通ユーティリティ関数
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
 */
export const DEFAULT_TIMEOUT_MS = 5000; // 5秒

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
 * エラーチェック用短期タイムアウト（ミリ秒）
 * エラーレスポンスの即座チェックに適用
 */
export const ERROR_CHECK_TIMEOUT_MS = 100; // 100ミリ秒

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
 * デフォルトフォントサイズ（ピクセル）
 */
export const DEFAULT_FONT_SIZE = 14;

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
export function convertPtToPx(pt) {
    // 96 DPI での標準変換: 1pt = 1.333px
    // JIS Z 8401準拠の最近接偶数への丸めで整数値に変換
    return jisRound(pt * 1.333);
}

/**
 * RGB文字列を16進数色コード（#RRGGBB）に変換
 * @param {string} color - RGB文字列（例: "rgb(255, 0, 0)" または "rgba(255, 0, 0, 0.5)"）
 * @returns {string} 16進数色コード（例: "#ff0000"）または元の文字列
 */
export function rgbToHex(color) {
    // rgb() または rgba() 形式をパース
    const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
    if (rgbMatch) {
        const r = parseInt(rgbMatch[1], 10);
        const g = parseInt(rgbMatch[2], 10);
        const b = parseInt(rgbMatch[3], 10);
        return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
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
