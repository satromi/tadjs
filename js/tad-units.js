/**
 * TAD座標単位変換ユーティリティ
 * @module js/tad-units
 *
 * UNITS型は16bit符号付きデータ型で、分解能を示す。
 * - 正の値: 1cmあたりのドット数（例: 4 = 4dots/cm）
 * - 負の値: 1inchあたりのドット数の負数（例: -120 = 120DPI）
 * - 0: 外側の座標系を継承
 */

/**
 * UNITS型の値をポイント単位での1ドットサイズに変換
 * @param {number} unit - UNITS型の値（16bit符号付き）
 * @returns {number} 1ドットあたりのポイント数
 */
export function getPointsPerUnit(unit) {
    if (unit === 0) {
        // 継承 - デフォルト72DPI（1unit = 1point）
        return 1;
    } else if (unit < 0) {
        // 負: DPIベース
        // 1unit = 1/DPI inch = 72/DPI points
        const dpi = -unit;
        return 72 / dpi;
    } else {
        // 正: dots per cm
        // 1unit = 1/unit cm = 10/(unit*25.4) inch = 720/(unit*25.4) points
        return 720 / (unit * 25.4);
    }
}

/**
 * UNITS単位の値をポイントに変換
 * @param {number} value - UNITS単位での値
 * @param {number} unit - UNITS型の値
 * @returns {number} ポイント単位の値
 */
export function unitsToPoints(value, unit) {
    return value * getPointsPerUnit(unit);
}

/**
 * ポイントをUNITS単位に変換
 * @param {number} points - ポイント単位の値
 * @param {number} unit - UNITS型の値
 * @returns {number} UNITS単位での値
 */
export function pointsToUnits(points, unit) {
    const ppu = getPointsPerUnit(unit);
    return ppu === 0 ? 0 : points / ppu;
}

/**
 * SCALE型の値を解釈してポイント単位で返す
 * @param {number} scaleValue - SCALE型の16ビット値
 * @param {number} baseValuePoints - 比率指定時の基準値（ポイント）
 * @param {number} unit - UNITS型の値（絶対指定時に使用、デフォルト: -72 = 72DPI）
 * @returns {number} ポイント単位の値
 */
export function parseScaleValue(scaleValue, baseValuePoints, unit = -72) {
    const msb = (scaleValue >> 15) & 1;

    if (msb === 1) {
        // 絶対指定: UNITS単位での値
        const value = scaleValue & 0x7FFF;
        return unitsToPoints(value, unit);
    } else {
        // 比率指定: A/B
        const a = (scaleValue >> 8) & 0x7F;
        const b = scaleValue & 0xFF;
        const ratio = b === 0 ? 1 : a / b;
        return baseValuePoints * ratio;
    }
}

/**
 * フォントサイズを小数点第一位まで丸める
 * px→pt変換時の誤差（例: 28pt → 37.324px → 28.007pt）を補正する
 * @param {string|number} size - フォントサイズ（数値または文字列）
 * @returns {string} 丸めた値の文字列
 */
export function roundFontSize(size) {
    const num = parseFloat(size);
    if (isNaN(num)) return size;
    const rounded = Math.round(num * 10) / 10;
    // 整数の場合は小数点以下を省略（28.0 → 28）
    return rounded === Math.floor(rounded) ? rounded.toString() : rounded.toString();
}
