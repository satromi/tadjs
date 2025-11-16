/**
 * 共通ユーティリティ関数
 */

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
