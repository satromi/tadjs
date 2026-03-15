/**
 * FigureSelectionMixin - 図形選択・変形・リサイズ関連機能
 *
 * 図形の選択、当たり判定、リサイズハンドル、コネクタスナップ、
 * 変形モード（頂点編集）を担当するMixin。
 *
 * 提供メソッド:
 * - selectShapeAt(x, y, shiftKey) - クリック位置の図形を選択
 * - isPointInShape(x, y, shape) - 点が図形内にあるか判定
 * - getShapeBoundingBox(shape) - 図形のバウンディングボックスを取得
 * - getShapesInRectangle(x1, y1, x2, y2) - 矩形内の図形を取得
 * - getResizeHandleAt(x, y) - リサイズハンドルのヒットテスト
 * - findNearbyShapes(x, y) - 近くの図形とコネクタを探す
 * - findSnapConnector(x, y) - 最も近いコネクタを探す（スナップ用）
 * - getConnectedLines(shape) - 図形に接続されている線を取得
 * - getLineEndpointAt(x, y) - 線の端点のヒットテスト
 * - enterTransformMode(shape) - 変形モードに入る
 * - exitTransformMode() - 変形モードを終了
 * - getTransformVertices(shape) - 変形ハンドル頂点情報を取得
 * - getArcEndpoint(shape, angle) - 弧端点の座標を計算
 * - worldToArcLocal(shape, px, py) - ワールド座標を楕円ローカル座標に変換
 * - solveEllipseFromTwoPoints(shape, fixedLocal, draggedLocal) - 2点から楕円パラメータを再計算
 * - getVertexHandleAt(x, y) - 頂点ハンドルのヒットテスト
 * - updateBoundingBoxAfterTransform(shape) - 変形後のバウンディングボックスを再計算
 * - applyVertexDrag(shape, vertexIndex, newX, newY) - 頂点ドラッグを適用
 * - createResizePreviewBox(shape) - リサイズプレビュー枠を作成
 */

const logger = window.getLogger('BasicFigureEditor');

export const FigureSelectionMixin = (Base) => class extends Base {

    selectShapeAt(x, y, shiftKey = false) {
        // クリック位置にある図形を選択
        for (let i = this.shapes.length - 1; i >= 0; i--) {
            const shape = this.shapes[i];

            if (this.isPointInShape(x, y, shape)) {
                if (shiftKey) {
                    // Shiftキーが押されている場合
                    const index = this.selectedShapes.indexOf(shape);
                    if (index >= 0) {
                        // 既に選択されている場合は選択解除
                        this.selectedShapes.splice(index, 1);
                    } else {
                        // 選択されていない場合は追加
                        this.selectedShapes.push(shape);
                    }
                } else {
                    // 通常のクリック
                    const index = this.selectedShapes.indexOf(shape);
                    if (index >= 0 && this.selectedShapes.length === 1) {
                        // 単独で選択されている図形をクリックした場合は選択解除
                        // ただし、道具パネルポップアップが開いている場合は選択を維持
                        if (!this.toolPanelPopupOpen) {
                            this.selectedShapes = [];
                        }
                    } else {
                        // 新しく選択
                        this.selectedShapes = [shape];
                    }
                }
                this.syncSelectedShapeToToolPanel();
                this.redraw();
                return;
            }
        }

        // 何も選択されなかった場合
        // ただし、道具パネルポップアップが開いている場合は選択を維持
        if (!shiftKey && !this.toolPanelPopupOpen) {
            this.selectedShapes = [];
            this.syncSelectedShapeToToolPanel();
            this.redraw();
        }
    }

    isPointInShape(x, y, shape) {
        // バウンディングボックスを取得して当たり判定
        const bounds = this.getShapeBoundingBox(shape);
        if (!bounds) return false;

        // 回転されている図形の場合、テスト点を逆回転してから判定
        const p = this.inverseRotatePoint(x, y, shape);
        return p.x >= bounds.minX && p.x <= bounds.maxX && p.y >= bounds.minY && p.y <= bounds.maxY;
    }

    /**
     * 図形のバウンディングボックスを取得
     * @param {Object} shape - 図形オブジェクト
     * @returns {Object|null} { minX, maxX, minY, maxY } または null
     */
    getShapeBoundingBox(shape) {
        let minX, maxX, minY, maxY;

        if (shape.points && shape.points.length > 0) {
            // polygon: points配列からバウンディングボックスを計算
            minX = Math.min(...shape.points.map(p => p.x));
            maxX = Math.max(...shape.points.map(p => p.x));
            minY = Math.min(...shape.points.map(p => p.y));
            maxY = Math.max(...shape.points.map(p => p.y));
        } else if (shape.path && shape.path.length > 0) {
            // pencil/curve: path配列からバウンディングボックスを計算
            minX = Math.min(...shape.path.map(p => p.x));
            maxX = Math.max(...shape.path.map(p => p.x));
            minY = Math.min(...shape.path.map(p => p.y));
            maxY = Math.max(...shape.path.map(p => p.y));
        } else if (shape.startX !== undefined && shape.endX !== undefined) {
            // 既存: startX/endX/startY/endY を使用
            minX = Math.min(shape.startX, shape.endX);
            maxX = Math.max(shape.startX, shape.endX);
            minY = Math.min(shape.startY, shape.endY);
            maxY = Math.max(shape.startY, shape.endY);
        } else {
            return null;
        }

        return { minX, maxX, minY, maxY };
    }

    getShapesInRectangle(x1, y1, x2, y2) {
        // 矩形内の図形を取得（一部でも重なっていればOK）
        const rectMinX = Math.min(x1, x2);
        const rectMaxX = Math.max(x1, x2);
        const rectMinY = Math.min(y1, y2);
        const rectMaxY = Math.max(y1, y2);

        const shapesInRect = [];
        for (const shape of this.shapes) {
            // バウンディングボックスを取得
            const bounds = this.getShapeBoundingBox(shape);
            if (!bounds) continue;

            // 矩形同士の重なり判定
            if (!(bounds.maxX < rectMinX || bounds.minX > rectMaxX ||
                  bounds.maxY < rectMinY || bounds.minY > rectMaxY)) {
                shapesInRect.push(shape);
            }
        }
        return shapesInRect;
    }

    getResizeHandleAt(x, y) {
        // 変形モード中はリサイズハンドルを無効化
        if (this.isTransformMode) return null;

        // 選択中の図形のリサイズハンドルをチェック
        const handleSize = 8;
        const hitArea = handleSize + 2; // ヒット判定領域を少し大きく

        for (const shape of this.selectedShapes) {
            // 仮身の場合は専用リサイズを使うため、通常のリサイズハンドルは無効
            if (shape.type === 'vobj') {
                continue;
            }

            // 直線の場合はリサイズハンドルを表示しない（端点コネクタで操作）
            if (shape.type === 'line') {
                continue;
            }

            const maxX = Math.max(shape.startX, shape.endX);
            const maxY = Math.max(shape.startY, shape.endY);

            // 回転されている図形の場合、テスト点を逆回転してから判定
            const p = this.inverseRotatePoint(x, y, shape);

            // 右下のハンドル
            if (Math.abs(p.x - maxX) <= hitArea / 2 && Math.abs(p.y - maxY) <= hitArea / 2) {
                return { shape: shape, handle: 'bottom-right' };
            }
        }

        return null;
    }

    /**
     * 指定座標の近くの図形とコネクタを探す
     * @param {number} x - X座標
     * @param {number} y - Y座標
     * @returns {Array} 近くの図形の配列 [{shape, connectors}]
     */
    findNearbyShapes(x, y) {
        const nearbyShapes = [];

        for (const shape of this.shapes) {
            // コネクタ対応図形のみチェック
            if (shape.type !== 'rect' && shape.type !== 'roundRect' &&
                shape.type !== 'ellipse' && shape.type !== 'polygon' && shape.type !== 'vobj') {
                continue;
            }

            // コネクタポイントを取得
            const connectorPoints = this.getConnectorPoints(shape);

            // 仮身の場合は拡張距離を使用
            const showDistance = shape.type === 'vobj' ? this.vobjConnectorShowDistance : this.connectorShowDistance;

            // 各コネクタポイントとの距離をチェック
            for (const point of connectorPoints) {
                const dist = Math.sqrt(
                    Math.pow(x - point.x, 2) + Math.pow(y - point.y, 2)
                );

                if (dist <= showDistance) {
                    nearbyShapes.push({
                        shape: shape,
                        connectors: connectorPoints
                    });
                    break; // 同じ図形は1回だけ追加
                }
            }
        }

        return nearbyShapes;
    }

    /**
     * 指定座標に最も近いコネクタを探す（スナップ用）
     * @param {number} x - X座標
     * @param {number} y - Y座標
     * @returns {Object|null} {shape, connector: {x, y, index}, shapeId} または null
     */
    findSnapConnector(x, y) {
        let closestConnector = null;
        let minDistance = this.connectorSnapDistance;

        for (const shape of this.shapes) {
            // コネクタ対応図形のみチェック
            if (shape.type !== 'rect' && shape.type !== 'roundRect' &&
                shape.type !== 'ellipse' && shape.type !== 'polygon' && shape.type !== 'vobj') {
                continue;
            }

            // コネクタポイントを取得
            const connectorPoints = this.getConnectorPoints(shape);

            // 仮身の場合は拡張距離を使用
            const snapDistance = shape.type === 'vobj' ? this.vobjConnectorSnapDistance : this.connectorSnapDistance;

            // 各コネクタポイントとの距離をチェック
            for (const point of connectorPoints) {
                const dist = Math.sqrt(
                    Math.pow(x - point.x, 2) + Math.pow(y - point.y, 2)
                );

                if (dist < minDistance && dist <= snapDistance) {
                    minDistance = dist;
                    closestConnector = {
                        shape: shape,
                        connector: point,
                        shapeId: this.shapes.indexOf(shape)
                    };
                }
            }
        }

        return closestConnector;
    }

    /**
     * 指定の図形に接続されている線を取得
     * @param {Object} shape - 図形オブジェクト
     * @returns {Array} 接続情報の配列 [{line, endpoint: 'start'|'end', connectorIndex}]
     */
    getConnectedLines(shape) {
        const shapeIndex = this.shapes.indexOf(shape);
        if (shapeIndex === -1) return [];

        const connections = [];

        for (const line of this.shapes) {
            if (line.type !== 'line') continue;

            // startConnectionをチェック
            if (line.startConnection && line.startConnection.shapeId === shapeIndex) {
                connections.push({
                    line: line,
                    endpoint: 'start',
                    connectorIndex: line.startConnection.connectorIndex
                });
            }

            // endConnectionをチェック
            if (line.endConnection && line.endConnection.shapeId === shapeIndex) {
                connections.push({
                    line: line,
                    endpoint: 'end',
                    connectorIndex: line.endConnection.connectorIndex
                });
            }
        }

        return connections;
    }

    /**
     * 線の端点がクリックされたかチェック
     * @param {number} x - クリック位置X
     * @param {number} y - クリック位置Y
     * @returns {Object|null} {shape, endpoint: 'start'|'end'} または null
     */
    getLineEndpointAt(x, y) {
        const threshold = this.connectorRadius + 2; // コネクタ半径+少し余裕（3+2=5px）

        // 選択中の線図形をチェック
        for (const shape of this.selectedShapes) {
            if (shape.type !== 'line') continue;

            // 開始点をチェック
            const distToStart = Math.sqrt(
                Math.pow(x - shape.startX, 2) + Math.pow(y - shape.startY, 2)
            );
            if (distToStart <= threshold) {
                return { shape: shape, endpoint: 'start' };
            }

            // 終了点をチェック
            const distToEnd = Math.sqrt(
                Math.pow(x - shape.endX, 2) + Math.pow(y - shape.endY, 2)
            );
            if (distToEnd <= threshold) {
                return { shape: shape, endpoint: 'end' };
            }
        }

        return null;
    }

    enterTransformMode(shape) {
        if (this.isPixelmapMode || this.editingTextBox) return;
        // 弧系図形のcenterX/Y/radiusX/radiusY正規化（描画作成時はstartX/Y/endX/Yのみ）
        if ((shape.type === 'arc' || shape.type === 'chord' || shape.type === 'elliptical_arc') &&
            shape.centerX === undefined) {
            const width = shape.endX - shape.startX;
            const height = shape.endY - shape.startY;
            shape.centerX = shape.startX + width / 2;
            shape.centerY = shape.startY + height / 2;
            shape.radiusX = Math.abs(width / 2);
            shape.radiusY = Math.abs(height / 2);
            if (shape.startAngle === undefined) shape.startAngle = 0;
            if (shape.endAngle === undefined) shape.endAngle = Math.PI / 2;
            if (shape.angle === undefined) shape.angle = 0;
        }
        this.isTransformMode = true;
        this.transformingShape = shape;
        this.selectedShapes = [shape];
        this.transformVertices = this.getTransformVertices(shape);
        this.setStatus('変形モード：頂点をドラッグして移動（Shift: 水平/垂直制約）');
        this.redraw();
    }

    exitTransformMode() {
        if (!this.isTransformMode) return;
        this.isTransformMode = false;
        this.transformingShape = null;
        this.transformVertices = [];
        this.isDraggingVertex = false;
        this.draggedVertexIndex = -1;
        this.canvas.style.cursor = 'default';
        this.setStatus('');
        this.redraw();
    }

    /**
     * 図形タイプ別の変形ハンドル頂点情報を取得
     * @param {Object} shape - 対象図形
     * @returns {Array} [{x, y, type, index}] type: 'vertex'|'center'
     */
    getTransformVertices(shape) {
        const vertices = [];
        if (shape.type === 'polygon' && shape.points) {
            for (let i = 0; i < shape.points.length; i++) {
                vertices.push({
                    x: shape.points[i].x,
                    y: shape.points[i].y,
                    type: 'vertex',
                    index: i
                });
            }
        } else if (shape.type === 'arc' || shape.type === 'chord' || shape.type === 'elliptical_arc') {
            // 扇形のみ中心点ハンドルを追加
            if (shape.type === 'arc') {
                vertices.push({
                    x: shape.centerX,
                    y: shape.centerY,
                    type: 'center',
                    index: 0
                });
            }
            // 弧始点
            const startPt = this.getArcEndpoint(shape, shape.startAngle);
            vertices.push({
                x: startPt.x,
                y: startPt.y,
                type: 'arc_start',
                index: vertices.length
            });
            // 弧終点
            const endPt = this.getArcEndpoint(shape, shape.endAngle);
            vertices.push({
                x: endPt.x,
                y: endPt.y,
                type: 'arc_end',
                index: vertices.length
            });
        } else if (shape.type === 'curve' && shape.path && shape.path.length >= 2) {
            // 曲線: 始点と終点のハンドル
            vertices.push({
                x: shape.path[0].x,
                y: shape.path[0].y,
                type: 'curve_start',
                index: 0
            });
            vertices.push({
                x: shape.path[shape.path.length - 1].x,
                y: shape.path[shape.path.length - 1].y,
                type: 'curve_end',
                index: shape.path.length - 1
            });
        }
        return vertices;
    }

    /**
     * 弧端点の座標を計算（楕円パラメトリック角度→ワールド座標）
     * @param {Object} shape - 弧系図形
     * @param {number} angle - パラメトリック角度（ラジアン）
     * @returns {{x: number, y: number}}
     */
    getArcEndpoint(shape, angle) {
        const rotation = shape.angle || 0;
        const cosR = Math.cos(rotation);
        const sinR = Math.sin(rotation);
        const lx = shape.radiusX * Math.cos(angle);
        const ly = shape.radiusY * Math.sin(angle);
        return {
            x: shape.centerX + lx * cosR - ly * sinR,
            y: shape.centerY + lx * sinR + ly * cosR
        };
    }

    /**
     * ワールド座標を楕円のローカル座標（中心相対、回転除去済み）に変換
     * @param {Object} shape - 弧系図形
     * @param {number} px - ワールドX
     * @param {number} py - ワールドY
     * @returns {{lx: number, ly: number}}
     */
    worldToArcLocal(shape, px, py) {
        const rotation = shape.angle || 0;
        const cosR = Math.cos(-rotation);
        const sinR = Math.sin(-rotation);
        const dx = px - shape.centerX;
        const dy = py - shape.centerY;
        return {
            lx: dx * cosR - dy * sinR,
            ly: dx * sinR + dy * cosR
        };
    }

    /**
     * 2つの端点位置から楕円パラメータ(rx, ry, startAngle, endAngle)を再計算
     * 固定端点とドラッグ端点のローカル座標から新しい楕円を求める
     * @param {Object} shape - 弧系図形
     * @param {{lx: number, ly: number}} fixedLocal - 固定端点のローカル座標
     * @param {{lx: number, ly: number}} draggedLocal - ドラッグ端点のローカル座標
     * @returns {{radiusX: number, radiusY: number, fixedAngle: number, draggedAngle: number}|null}
     */
    solveEllipseFromTwoPoints(shape, fixedLocal, draggedLocal) {
        const flx = fixedLocal.lx, fly = fixedLocal.ly;
        const dlx = draggedLocal.lx, dly = draggedLocal.ly;

        // 連立方程式: flx²*A + fly²*B = 1, dlx²*A + dly²*B = 1
        // A = 1/rx², B = 1/ry²
        const denom = dly * dly * flx * flx - dlx * dlx * fly * fly;

        if (Math.abs(denom) < 1e-6) {
            // 退化ケース: 角度のみ変更
            return null;
        }

        const B = (flx * flx - dlx * dlx) / denom;
        const A = (Math.abs(flx) > 1e-6) ?
            (1 - fly * fly * B) / (flx * flx) :
            (1 - dly * dly * B) / (dlx * dlx);

        if (A <= 0 || B <= 0) {
            // 有効な楕円が存在しない: 角度のみ変更
            return null;
        }

        const newRx = 1 / Math.sqrt(A);
        const newRy = 1 / Math.sqrt(B);

        // 最小半径制限
        const minRadius = 1;
        if (newRx < minRadius || newRy < minRadius) {
            return null;
        }

        // 新しいパラメトリック角度を計算
        const fixedAngle = Math.atan2(fly / newRy, flx / newRx);
        const draggedAngle = Math.atan2(dly / newRy, dlx / newRx);

        return {
            radiusX: newRx,
            radiusY: newRy,
            fixedAngle: fixedAngle,
            draggedAngle: draggedAngle
        };
    }

    /**
     * 頂点ハンドルのヒットテスト
     * @param {number} x - 論理座標X
     * @param {number} y - 論理座標Y
     * @returns {number} ヒットした頂点インデックス、なければ-1
     */
    getVertexHandleAt(x, y) {
        const handleSize = 8;
        const hitArea = handleSize / 2 + 2;

        // 回転された図形の場合、テスト点を逆回転してから判定
        let testX = x, testY = y;
        if (this.transformingShape) {
            const rotation = this.getWrapperRotation(this.transformingShape);
            if (rotation !== 0) {
                const bounds = this.getShapeBoundingBox(this.transformingShape);
                if (bounds) {
                    const cx = (bounds.minX + bounds.maxX) / 2;
                    const cy = (bounds.minY + bounds.maxY) / 2;
                    const rotated = GeometryUtils.rotatePoint(x, y, cx, cy, -rotation);
                    testX = rotated.x;
                    testY = rotated.y;
                }
            }
        }

        for (let i = 0; i < this.transformVertices.length; i++) {
            const v = this.transformVertices[i];
            if (Math.abs(testX - v.x) <= hitArea && Math.abs(testY - v.y) <= hitArea) {
                return i;
            }
        }
        return -1;
    }

    /**
     * 変形後のバウンディングボックスを再計算・更新
     * @param {Object} shape - 対象図形
     */
    updateBoundingBoxAfterTransform(shape) {
        if (shape.type === 'polygon' && shape.points && shape.points.length > 0) {
            // polygonのbounding boxはpointsから自動計算されるので不要
            return;
        }
        if (shape.type === 'arc' || shape.type === 'chord' || shape.type === 'elliptical_arc') {
            // centerX/Y + radiusX/Y から bounding box を再計算
            const rotation = shape.angle || 0;
            if (Math.abs(rotation) < 1e-6) {
                // 回転なし: 単純な計算
                shape.startX = shape.centerX - shape.radiusX;
                shape.startY = shape.centerY - shape.radiusY;
                shape.endX = shape.centerX + shape.radiusX;
                shape.endY = shape.centerY + shape.radiusY;
            } else {
                // 回転あり: 4隅を計算
                const cosR = Math.cos(rotation);
                const sinR = Math.sin(rotation);
                const corners = [
                    { lx: -shape.radiusX, ly: -shape.radiusY },
                    { lx: shape.radiusX, ly: -shape.radiusY },
                    { lx: shape.radiusX, ly: shape.radiusY },
                    { lx: -shape.radiusX, ly: shape.radiusY }
                ];
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                for (const c of corners) {
                    const wx = shape.centerX + c.lx * cosR - c.ly * sinR;
                    const wy = shape.centerY + c.lx * sinR + c.ly * cosR;
                    minX = Math.min(minX, wx);
                    minY = Math.min(minY, wy);
                    maxX = Math.max(maxX, wx);
                    maxY = Math.max(maxY, wy);
                }
                shape.startX = minX;
                shape.startY = minY;
                shape.endX = maxX;
                shape.endY = maxY;
            }
        }
    }

    /**
     * 頂点ドラッグを適用
     * @param {Object} shape - 対象図形
     * @param {number} vertexIndex - transformVertices配列内のインデックス
     * @param {number} newX - 新しいX座標（論理座標）
     * @param {number} newY - 新しいY座標（論理座標）
     */
    applyVertexDrag(shape, vertexIndex, newX, newY) {
        const vertex = this.transformVertices[vertexIndex];
        if (!vertex) return;

        if (shape.type === 'polygon') {
            // 多角形: 頂点座標を直接更新
            if (shape.points && shape.points[vertex.index]) {
                shape.points[vertex.index].x = newX;
                shape.points[vertex.index].y = newY;
            }
        } else if (shape.type === 'arc' || shape.type === 'chord' || shape.type === 'elliptical_arc') {
            if (vertex.type === 'center') {
                // 中心点ドラッグ: 全体移動
                const dx = newX - shape.centerX;
                const dy = newY - shape.centerY;
                shape.centerX = newX;
                shape.centerY = newY;
                shape.startX += dx;
                shape.startY += dy;
                shape.endX += dx;
                shape.endY += dy;
            } else {
                // 弧端点ドラッグ: 自由移動 → 楕円パラメータ再計算
                const draggedLocal = this.worldToArcLocal(shape, newX, newY);

                // 固定端点を特定
                let fixedAngle;
                if (vertex.type === 'arc_start') {
                    fixedAngle = shape.endAngle;
                } else {
                    fixedAngle = shape.startAngle;
                }
                const fixedPt = this.getArcEndpoint(shape, fixedAngle);
                const fixedLocal = this.worldToArcLocal(shape, fixedPt.x, fixedPt.y);

                // 2点から楕円パラメータを再計算
                const result = this.solveEllipseFromTwoPoints(shape, fixedLocal, draggedLocal);

                if (result) {
                    // 楕円パラメータを更新
                    shape.radiusX = result.radiusX;
                    shape.radiusY = result.radiusY;
                    if (vertex.type === 'arc_start') {
                        shape.startAngle = result.draggedAngle;
                        shape.endAngle = result.fixedAngle;
                    } else {
                        shape.startAngle = result.fixedAngle;
                        shape.endAngle = result.draggedAngle;
                    }
                } else {
                    // 退化ケース: 角度のみ変更（幾何学的角度を使用）
                    const geomAngle = Math.atan2(
                        newY - shape.centerY,
                        newX - shape.centerX
                    );
                    if (vertex.type === 'arc_start') {
                        shape.startAngle = geomAngle;
                    } else {
                        shape.endAngle = geomAngle;
                    }
                }

                // バウンディングボックスを更新
                this.updateBoundingBoxAfterTransform(shape);
            }
        } else if (shape.type === 'curve' && shape.path) {
            // 曲線: 始点または終点の座標を更新
            if (vertex.type === 'curve_start') {
                shape.path[0].x = newX;
                shape.path[0].y = newY;
            } else if (vertex.type === 'curve_end') {
                shape.path[shape.path.length - 1].x = newX;
                shape.path[shape.path.length - 1].y = newY;
            }
        }

        this.isModified = true;
    }

    /**
     * リサイズプレビュー枠を作成
     */
    createResizePreviewBox(shape) {
        // 既存のプレビュー枠がある場合は削除
        this.removeResizePreviewBox();

        // Canvas の論理座標を物理座標に変換し、さらに画面座標に変換
        const rect = this.canvas.getBoundingClientRect();
        const physPos = this.logicalToPhysical(shape.startX, shape.startY);
        const physSize = this.logicalToPhysical(shape.endX - shape.startX, shape.endY - shape.startY);

        const screenX = rect.left + physPos.x;
        const screenY = rect.top + physPos.y;

        // プレビュー枠を作成
        const previewBox = document.createElement('div');
        previewBox.style.position = 'fixed'; // キャンバス外でも表示されるようにfixedを使用
        previewBox.style.left = `${screenX}px`;
        previewBox.style.top = `${screenY}px`;
        previewBox.style.width = `${physSize.x}px`;
        previewBox.style.height = `${physSize.y}px`;
        previewBox.style.border = '2px dashed rgba(0, 123, 255, 0.8)';
        previewBox.style.backgroundColor = 'rgba(0, 123, 255, 0.1)';
        previewBox.style.pointerEvents = 'none';
        previewBox.style.zIndex = '2147483647'; // 最大のz-index値（32bit整数の最大値）
        previewBox.style.boxSizing = 'border-box';

        // 図形の回転をCSS transformで適用
        const rotation = this.getEffectiveRotationDeg(shape);
        if (rotation !== 0) {
            previewBox.style.transformOrigin = 'center center';
            previewBox.style.transform = `rotate(${rotation}deg)`;
        }

        // document.body に直接追加
        document.body.appendChild(previewBox);

        this.resizePreviewBox = previewBox;

        logger.debug('[FIGURE EDITOR] リサイズプレビュー枠を作成しました');
    }
};
