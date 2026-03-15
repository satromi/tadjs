/**
 * FigureConnectorMixin - コネクタ関連機能
 *
 * 図形間の接続ポイント（コネクタ）の計算・描画を担当するMixin。
 *
 * 提供メソッド:
 * - getConnectorDirection(shape, connectorIndex) - コネクタの法線方向を取得
 * - drawConnectedLine(shape) - 接続形状（カギ線・曲線）で線を描画
 * - getConnectorPoints(shape) - 図形のコネクタポイントを取得
 * - drawConnectors(shape) - 図形のコネクタを描画
 * - drawLineEndpointConnectors(line) - 直線の端点にコネクタを描画
 */

export const FigureConnectorMixin = (Base) => class extends Base {

    /**
     * コネクタの法線方向を取得
     * @param {Object} shape - 図形オブジェクト
     * @param {number} connectorIndex - コネクタのインデックス
     * @returns {Object} 法線ベクトル {x, y}（正規化済み）
     */
    getConnectorDirection(shape, connectorIndex) {
        let nx = 0, ny = 0;

        switch (shape.type) {
            case 'rect':
            case 'roundRect':
            case 'vobj':
                // 長方形・仮身のコネクタインデックス:
                // 0:上辺中点, 1:右上角, 2:右辺中点, 3:右下角, 4:下辺中点, 5:左下角, 6:左辺中点, 7:左上角
                switch (connectorIndex) {
                    case 0: nx = 0; ny = -1; break;   // 上辺中点 → 上向き
                    case 1: nx = 1; ny = -1; break;   // 右上角 → 右上向き
                    case 2: nx = 1; ny = 0; break;    // 右辺中点 → 右向き
                    case 3: nx = 1; ny = 1; break;    // 右下角 → 右下向き
                    case 4: nx = 0; ny = 1; break;    // 下辺中点 → 下向き
                    case 5: nx = -1; ny = 1; break;   // 左下角 → 左下向き
                    case 6: nx = -1; ny = 0; break;   // 左辺中点 → 左向き
                    case 7: nx = -1; ny = -1; break;  // 左上角 → 左上向き
                }
                break;

            case 'ellipse':
                // 楕円のコネクタは8方向（0°, 45°, 90°, ...）
                // 法線方向 = 中心から外向きの方向
                const angles = [0, 45, 90, 135, 180, 225, 270, 315];
                const angle = angles[connectorIndex];
                const rad = angle * Math.PI / 180;
                nx = Math.cos(rad);
                ny = Math.sin(rad);
                break;

            case 'polygon':
                // 多角形の場合は、コネクタポイントから法線を計算
                const points = this.getConnectorPoints(shape);
                const numVertices = shape.points.length;

                if (connectorIndex < numVertices) {
                    // 頂点の場合：隣接する2辺の法線の平均
                    const prevIdx = (connectorIndex - 1 + numVertices) % numVertices;
                    const nextIdx = (connectorIndex + 1) % numVertices;
                    const prev = shape.points[prevIdx];
                    const curr = shape.points[connectorIndex];
                    const next = shape.points[nextIdx];

                    // 前の辺の法線
                    const dx1 = curr.x - prev.x;
                    const dy1 = curr.y - prev.y;
                    const nx1 = -dy1;
                    const ny1 = dx1;

                    // 次の辺の法線
                    const dx2 = next.x - curr.x;
                    const dy2 = next.y - curr.y;
                    const nx2 = -dy2;
                    const ny2 = dx2;

                    // 平均
                    nx = (nx1 + nx2) / 2;
                    ny = (ny1 + ny2) / 2;
                } else {
                    // 辺の中点の場合：その辺の法線
                    const edgeIdx = connectorIndex - numVertices;
                    const p1 = shape.points[edgeIdx];
                    const p2 = shape.points[(edgeIdx + 1) % numVertices];
                    const dx = p2.x - p1.x;
                    const dy = p2.y - p1.y;
                    // 法線（左回り90度回転）
                    nx = -dy;
                    ny = dx;
                }
                break;
        }

        // 正規化
        const length = Math.sqrt(nx * nx + ny * ny);
        if (length > 0) {
            nx /= length;
            ny /= length;
        }

        return { x: nx, y: ny };
    }

    /**
     * 接続形状（カギ線・曲線）で線を描画
     * @param {Object} shape - 線図形オブジェクト
     * @returns {Object} {startAngle, endAngle} - 始点と終点の角度（ラジアン）
     */
    drawConnectedLine(shape) {
        const startX = shape.startX;
        const startY = shape.startY;
        const endX = shape.endX;
        const endY = shape.endY;

        // 接続先の図形と法線方向を取得
        const startShape = this.shapes[shape.startConnection.shapeId];
        const endShape = this.shapes[shape.endConnection.shapeId];
        const startDir = this.getConnectorDirection(startShape, shape.startConnection.connectorIndex);
        const endDir = this.getConnectorDirection(endShape, shape.endConnection.connectorIndex);

        // 全体の距離を計算（曲線で使用）
        const totalDist = Math.sqrt(Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2));

        let startAngle = 0;
        let endAngle = 0;

        this.ctx.beginPath();
        this.ctx.moveTo(startX, startY);

        if (shape.lineConnectionType === 'elbow') {
            // カギ線: 図形の辺と直角に延ばし、中間点で繋ぐ
            const midX = (startX + endX) / 2;
            const midY = (startY + endY) / 2;

            // startDirが主に垂直方向か水平方向かを判定
            const startIsVertical = Math.abs(startDir.y) > Math.abs(startDir.x);

            if (startIsVertical) {
                // 垂直 → 水平 → 垂直
                // 始点から垂直にmidYまで延ばす
                this.ctx.lineTo(startX, midY);
                startAngle = Math.atan2(midY - startY, 0) + Math.PI; // 矢印は逆方向
                // 水平に終点のX座標まで
                this.ctx.lineTo(endX, midY);
                // 垂直に終点まで
                this.ctx.lineTo(endX, endY);
                endAngle = Math.atan2(endY - midY, 0);
            } else {
                // 水平 → 垂直 → 水平
                // 始点から水平にmidXまで延ばす
                this.ctx.lineTo(midX, startY);
                startAngle = Math.atan2(0, midX - startX) + Math.PI; // 矢印は逆方向
                // 垂直に終点のY座標まで
                this.ctx.lineTo(midX, endY);
                // 水平に終点まで
                this.ctx.lineTo(endX, endY);
                endAngle = Math.atan2(0, endX - midX);
            }
        } else if (shape.lineConnectionType === 'curve') {
            // 曲線: ベジェ曲線で、制御点を法線方向に配置
            const controlDist = totalDist * 0.25;

            const cp1x = startX + startDir.x * controlDist;
            const cp1y = startY + startDir.y * controlDist;

            const cp2x = endX + endDir.x * controlDist;
            const cp2y = endY + endDir.y * controlDist;

            this.ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, endX, endY);

            // ベジェ曲線の始点のタンジェント：startDir方向の逆（矢印は逆方向）
            startAngle = Math.atan2(startDir.y, startDir.x) + Math.PI;
            // ベジェ曲線の終点のタンジェント：cp2からendへの方向
            endAngle = Math.atan2(endY - cp2y, endX - cp2x);
        }

        this.ctx.stroke();

        return { startAngle, endAngle };
    }

    /**
     * 図形のコネクタポイントを取得
     * @param {Object} shape - 図形オブジェクト
     * @returns {Array} コネクタポイントの配列 [{x, y, index}, ...]
     */
    getConnectorPoints(shape) {
        const points = [];

        switch (shape.type) {
            case 'rect':
            case 'roundRect':
                // 四角形: 4辺の中点 + 4つの角 = 8点
                const width = shape.endX - shape.startX;
                const height = shape.endY - shape.startY;
                const left = shape.startX;
                const right = shape.endX;
                const top = shape.startY;
                const bottom = shape.endY;
                const centerX = left + width / 2;
                const centerY = top + height / 2;

                points.push(
                    { x: centerX, y: top, index: 0 },      // 上辺中点
                    { x: right, y: top, index: 1 },        // 右上角
                    { x: right, y: centerY, index: 2 },    // 右辺中点
                    { x: right, y: bottom, index: 3 },     // 右下角
                    { x: centerX, y: bottom, index: 4 },   // 下辺中点
                    { x: left, y: bottom, index: 5 },      // 左下角
                    { x: left, y: centerY, index: 6 },     // 左辺中点
                    { x: left, y: top, index: 7 }          // 左上角
                );
                break;

            case 'vobj':
                // 仮身: 四角形と同様に4辺の中点 + 4つの角 = 8点
                const vobjWidth = shape.endX - shape.startX;
                const vobjHeight = shape.endY - shape.startY;
                const vobjLeft = shape.startX;
                const vobjRight = shape.endX;
                const vobjTop = shape.startY;
                const vobjBottom = shape.endY;
                const vobjCenterX = shape.startX + vobjWidth / 2;
                const vobjCenterY = shape.startY + vobjHeight / 2;

                points.push(
                    { x: vobjCenterX, y: vobjTop, index: 0 },      // 上辺中点
                    { x: vobjRight, y: vobjTop, index: 1 },        // 右上角
                    { x: vobjRight, y: vobjCenterY, index: 2 },    // 右辺中点
                    { x: vobjRight, y: vobjBottom, index: 3 },     // 右下角
                    { x: vobjCenterX, y: vobjBottom, index: 4 },   // 下辺中点
                    { x: vobjLeft, y: vobjBottom, index: 5 },      // 左下角
                    { x: vobjLeft, y: vobjCenterY, index: 6 },     // 左辺中点
                    { x: vobjLeft, y: vobjTop, index: 7 }          // 左上角
                );
                break;

            case 'ellipse':
                // 円: 8方向（0°, 45°, 90°, 135°, 180°, 225°, 270°, 315°）
                const ellWidth = shape.endX - shape.startX;
                const ellHeight = shape.endY - shape.startY;
                const ellCenterX = shape.startX + ellWidth / 2;
                const ellCenterY = shape.startY + ellHeight / 2;
                const radiusX = Math.abs(ellWidth / 2);
                const radiusY = Math.abs(ellHeight / 2);

                const angles = [0, 45, 90, 135, 180, 225, 270, 315];
                angles.forEach((angle, index) => {
                    const rad = angle * Math.PI / 180;
                    points.push({
                        x: ellCenterX + radiusX * Math.cos(rad),
                        y: ellCenterY + radiusY * Math.sin(rad),
                        index: index
                    });
                });
                break;

            case 'triangle':
                // 三角形: 3頂点 + 3辺の中点 = 6点
                const triWidth = shape.endX - shape.startX;
                let triPoints;

                if (triWidth >= 0) {
                    // 右ドラッグ: 直角が左端（startX位置）
                    triPoints = [
                        { x: shape.startX, y: shape.startY },  // 左上（直角）
                        { x: shape.startX, y: shape.endY },    // 左下
                        { x: shape.endX, y: shape.endY }       // 右下
                    ];
                } else {
                    // 左ドラッグ: 直角が右端（startX位置、startXが右側なので）
                    triPoints = [
                        { x: shape.startX, y: shape.startY },  // 右上（直角）
                        { x: shape.startX, y: shape.endY },    // 右下
                        { x: shape.endX, y: shape.endY }       // 左下
                    ];
                }

                // 頂点
                triPoints.forEach((p, i) => {
                    points.push({ x: p.x, y: p.y, index: i });
                });

                // 辺の中点
                for (let i = 0; i < triPoints.length; i++) {
                    const p1 = triPoints[i];
                    const p2 = triPoints[(i + 1) % triPoints.length];
                    points.push({
                        x: (p1.x + p2.x) / 2,
                        y: (p1.y + p2.y) / 2,
                        index: triPoints.length + i
                    });
                }
                break;

            case 'polygon':
                // 多角形: 全頂点 + 全辺の中点
                if (shape.points && shape.points.length > 2) {
                    let index = 0;

                    // 全頂点
                    shape.points.forEach((point, i) => {
                        points.push({ x: point.x, y: point.y, index: index++ });
                    });

                    // 全辺の中点
                    for (let i = 0; i < shape.points.length; i++) {
                        const p1 = shape.points[i];
                        const p2 = shape.points[(i + 1) % shape.points.length];
                        points.push({
                            x: (p1.x + p2.x) / 2,
                            y: (p1.y + p2.y) / 2,
                            index: index++
                        });
                    }
                }
                break;
        }

        return points;
    }

    /**
     * 図形のコネクタを描画
     * @param {Object} shape - 図形オブジェクト
     */
    drawConnectors(shape) {
        const points = this.getConnectorPoints(shape);
        if (points.length === 0) return;

        this.ctx.save();

        points.forEach(point => {
            this.ctx.beginPath();
            this.ctx.arc(point.x, point.y, this.connectorRadius, 0, 2 * Math.PI);
            this.ctx.fillStyle = '#ffffff';
            this.ctx.fill();
            this.ctx.strokeStyle = '#000000';
            this.ctx.lineWidth = 1;
            this.ctx.stroke();
        });

        this.ctx.restore();
    }

    /**
     * 直線の端点にコネクタを描画
     * @param {Object} line - 直線図形オブジェクト
     */
    drawLineEndpointConnectors(line) {
        if (line.type !== 'line') return;

        this.ctx.save();

        // 接続状態を確認
        const hasStartConnection = line.startConnection && line.startConnection.shapeId !== undefined;
        const hasEndConnection = line.endConnection && line.endConnection.shapeId !== undefined;

        // 始点のコネクタ
        this.ctx.beginPath();
        this.ctx.arc(line.startX, line.startY, this.connectorRadius, 0, 2 * Math.PI);
        // 接続されている場合は青で塗りつぶし、そうでなければ白
        this.ctx.fillStyle = hasStartConnection ? '#0000ff' : '#ffffff';
        this.ctx.fill();
        this.ctx.strokeStyle = '#0000ff'; // 青色の枠線
        this.ctx.lineWidth = 1;
        this.ctx.stroke();

        // 終点のコネクタ
        this.ctx.beginPath();
        this.ctx.arc(line.endX, line.endY, this.connectorRadius, 0, 2 * Math.PI);
        // 接続されている場合は青で塗りつぶし、そうでなければ白
        this.ctx.fillStyle = hasEndConnection ? '#0000ff' : '#ffffff';
        this.ctx.fill();
        this.ctx.strokeStyle = '#0000ff'; // 青色の枠線
        this.ctx.lineWidth = 1;
        this.ctx.stroke();

        this.ctx.restore();
    }
};
