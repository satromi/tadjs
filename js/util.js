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
