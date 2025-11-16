/**
 * 図形・座標計算ユーティリティ
 * 図形編集で頻繁に使用される座標計算や境界ボックス計算を提供
 */

export class GeometryUtils {
    /**
     * 矩形の境界ボックス情報を取得
     * @param {number} startX - 開始X座標
     * @param {number} startY - 開始Y座標
     * @param {number} endX - 終了X座標
     * @param {number} endY - 終了Y座標
     * @returns {{minX: number, minY: number, maxX: number, maxY: number, width: number, height: number, centerX: number, centerY: number}}
     */
    static getBounds(startX, startY, endX, endY) {
        return {
            minX: Math.min(startX, endX),
            minY: Math.min(startY, endY),
            maxX: Math.max(startX, endX),
            maxY: Math.max(startY, endY),
            width: Math.abs(endX - startX),
            height: Math.abs(endY - startY),
            centerX: (startX + endX) / 2,
            centerY: (startY + endY) / 2
        };
    }

    /**
     * 図形の座標を正規化（startX ≤ endX, startY ≤ endY になるように入れ替え）
     * @param {Object} shape - 図形オブジェクト（startX, startY, endX, endYプロパティを持つ）
     * @returns {Object} 正規化された図形オブジェクト
     */
    static normalizeCoords(shape) {
        if (shape.startX > shape.endX) {
            [shape.startX, shape.endX] = [shape.endX, shape.startX];
        }
        if (shape.startY > shape.endY) {
            [shape.startY, shape.endY] = [shape.endY, shape.startY];
        }
        return shape;
    }

    /**
     * 点を中心座標周りに回転
     * @param {number} x - X座標
     * @param {number} y - Y座標
     * @param {number} centerX - 回転の中心X座標
     * @param {number} centerY - 回転の中心Y座標
     * @param {number} angleDegrees - 回転角度（度数法）
     * @returns {{x: number, y: number}} 回転後の座標
     */
    static rotatePoint(x, y, centerX, centerY, angleDegrees) {
        const rad = angleDegrees * Math.PI / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const dx = x - centerX;
        const dy = y - centerY;
        return {
            x: centerX + dx * cos - dy * sin,
            y: centerY + dx * sin + dy * cos
        };
    }

    /**
     * 2点間の距離を計算
     * @param {number} x1 - 点1のX座標
     * @param {number} y1 - 点1のY座標
     * @param {number} x2 - 点2のX座標
     * @param {number} y2 - 点2のY座標
     * @returns {number} 距離
     */
    static distance(x1, y1, x2, y2) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        return Math.sqrt(dx * dx + dy * dy);
    }

    /**
     * 角丸半径を矩形サイズに合わせて制限
     * 角丸半径が幅または高さの半分を超えないようにする
     * @param {number} radius - 角丸半径
     * @param {number} width - 矩形の幅
     * @param {number} height - 矩形の高さ
     * @returns {number} 制限された角丸半径
     */
    static limitCornerRadius(radius, width, height) {
        const maxRadius = Math.min(Math.abs(width) / 2, Math.abs(height) / 2);
        return Math.min(radius, maxRadius);
    }

    /**
     * 点が矩形内にあるかチェック
     * @param {number} px - 点のX座標
     * @param {number} py - 点のY座標
     * @param {number} x - 矩形のX座標
     * @param {number} y - 矩形のY座標
     * @param {number} width - 矩形の幅
     * @param {number} height - 矩形の高さ
     * @returns {boolean} 点が矩形内にある場合true
     */
    static isPointInRect(px, py, x, y, width, height) {
        return px >= x && px <= x + width && py >= y && py <= y + height;
    }

    /**
     * 2つの矩形が重なっているかチェック
     * @param {number} x1 - 矩形1のX座標
     * @param {number} y1 - 矩形1のY座標
     * @param {number} w1 - 矩形1の幅
     * @param {number} h1 - 矩形1の高さ
     * @param {number} x2 - 矩形2のX座標
     * @param {number} y2 - 矩形2のY座標
     * @param {number} w2 - 矩形2の幅
     * @param {number} h2 - 矩形2の高さ
     * @returns {boolean} 重なっている場合true
     */
    static isRectsOverlap(x1, y1, w1, h1, x2, y2, w2, h2) {
        return !(x1 + w1 < x2 || x2 + w2 < x1 || y1 + h1 < y2 || y2 + h2 < y1);
    }

    /**
     * 線分と点の最短距離を計算
     * @param {number} px - 点のX座標
     * @param {number} py - 点のY座標
     * @param {number} x1 - 線分の始点X座標
     * @param {number} y1 - 線分の始点Y座標
     * @param {number} x2 - 線分の終点X座標
     * @param {number} y2 - 線分の終点Y座標
     * @returns {number} 最短距離
     */
    static distanceToLine(px, py, x1, y1, x2, y2) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const lengthSq = dx * dx + dy * dy;

        if (lengthSq === 0) {
            // 線分が点の場合
            return this.distance(px, py, x1, y1);
        }

        // 線分上の最近点のパラメータt (0 ≤ t ≤ 1)
        let t = ((px - x1) * dx + (py - y1) * dy) / lengthSq;
        t = Math.max(0, Math.min(1, t));

        // 最近点の座標
        const nearestX = x1 + t * dx;
        const nearestY = y1 + t * dy;

        return this.distance(px, py, nearestX, nearestY);
    }
}
