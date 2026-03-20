/**
 * FigureEventHandlerMixin - イベントハンドラー関連機能
 *
 * マウスイベント、キーボードショートカット、スクロール処理を担当するMixin。
 *
 * 提供メソッド:
 * - setupEventListeners() - イベントリスナーを設定
 * - setupGlobalMouseHandlers() - グローバルマウスイベントハンドラーを設定
 * - handleScroll(scrollLeft, scrollTop) - スクロールイベントを処理
 * - handleMouseDown(e) - マウスダウンイベントを処理
 * - handleMouseMove(e) - マウスムーブイベントを処理
 * - handleMouseUp(e) - マウスアップイベントを処理
 * - handleDoubleClick(e) - ダブルクリックイベントを処理
 * - handleKeyboardShortcuts(e) - キーボードショートカットを処理
 */

const logger = window.getLogger('BasicFigureEditor');

export const FigureEventHandlerMixin = (Base) => class extends Base {

    setupEventListeners() {
        // Canvasのマウスイベント
        this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));

        // mousemoveはスロットル版を使用（60FPS制限）
        const mouseMoveHandler = this.throttledHandleMouseMove || ((e) => this.handleMouseMove(e));
        this.canvas.addEventListener('mousemove', mouseMoveHandler);

        this.canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        this.canvas.addEventListener('dblclick', (e) => this.handleDoubleClick(e));

        // キーボードショートカット
        document.addEventListener('keydown', (e) => {
            this.handleKeyboardShortcuts(e);
        });

        // クリックイベントで親ウィンドウのコンテキストメニューを閉じる
        document.addEventListener('click', (e) => {
            this.messageBus.send('close-context-menu');
        });

        // ウィンドウリサイズ
        window.addEventListener('resize', () => {
            this.resizeCanvas();
        });

        // 道具パネルポップアップの開閉通知を受信
        window.addEventListener('message', (e) => {
            if (e.data && e.data.type === 'tool-panel-popup-opened') {
                this.toolPanelPopupOpen = true;
            } else if (e.data && e.data.type === 'tool-panel-popup-closed') {
                this.toolPanelPopupOpen = false;
            } else if (e.data && e.data.fromMaterialPanel) {
                // 画材パネルからのメッセージを処理
                this.handleMaterialPanelMessage(e.data);
            } else if (e.data && e.data.fromPatternEditor) {
                // パターン編集パネルからのメッセージを処理
                this.handlePatternEditorMessage(e.data);
            }
        });

        // ドラッグ&ドロップイベント
        this.setupDragAndDrop();
    }

    /**
     * グローバルマウスイベントハンドラーを設定（仮身一覧プラグインと同じパターン）
     */
    setupGlobalMouseHandlers() {
        logger.debug('[FIGURE EDITOR] ★★★ setupGlobalMouseHandlers 呼び出し ★★★');

        // ドラッグ用のmousemoveハンドラ
        const handleDragMouseMove = (e) => {
            // マウス座標を常に更新（コネクタ表示のため）
            const container = document.querySelector('.editor-container');
            if (container) {
                const rect = container.getBoundingClientRect();
                // 物理座標から論理座標に変換
                const physX = e.clientX - rect.left + container.scrollLeft;
                const physY = e.clientY - rect.top + container.scrollTop;
                const logical = this.physicalToLogical(physX, physY);
                this.lastMouseX = logical.x;
                this.lastMouseY = logical.y;

                // 直線ツール選択中または線の端点ドラッグ中は再描画（コネクタ表示のため）
                if (this.currentTool === 'line' || this.isDraggingLineEndpoint) {
                    this.redraw();
                }
            }

            // ダブルクリック+ドラッグ候補の検出
            // 共通メソッドでドラッグ開始判定
            if (this.shouldStartDblClickDrag(e)) {
                logger.debug('[FIGURE EDITOR] ダブルクリック+ドラッグを確定（ドラッグ完了待ち）、プレビュー作成');

                // プレビュー要素を作成（プラグイン固有）
                const shape = this.dblClickDragState.dblClickedShape;
                if (shape && shape.type === 'vobj') {
                    const width = Math.abs(shape.endX - shape.startX);
                    const height = Math.abs(shape.endY - shape.startY);
                    // 論理座標を物理座標に変換してDOM配置
                    const pos = this.logicalToPhysical(shape.startX, shape.startY);
                    const size = this.logicalToPhysical(width, height);

                    const preview = document.createElement('div');
                    preview.className = 'dblclick-drag-preview';
                    preview.style.position = 'absolute';
                    preview.style.border = '2px solid #0078d4';
                    preview.style.backgroundColor = 'rgba(0, 120, 212, 0.1)';
                    preview.style.pointerEvents = 'none';
                    preview.style.zIndex = '10000';
                    preview.style.width = size.x + 'px';
                    preview.style.height = size.y + 'px';
                    preview.style.left = pos.x + 'px';
                    preview.style.top = pos.y + 'px';

                    const container = document.querySelector('.editor-container');
                    if (container) {
                        container.appendChild(preview);
                        this.dblClickDragState.previewElement = preview;
                    }
                }
                return;
            }

            // ダブルクリック+ドラッグ中のプレビュー位置更新
            if (this.dblClickDragState.isDblClickDrag && this.dblClickDragState.previewElement) {
                const preview = this.dblClickDragState.previewElement;
                const container = document.querySelector('.editor-container');
                if (container) {
                    const rect = container.getBoundingClientRect();
                    // プレビューDOM要素は物理座標で配置
                    const canvasX = e.clientX - rect.left + container.scrollLeft;
                    const canvasY = e.clientY - rect.top + container.scrollTop;
                    preview.style.left = canvasX + 'px';
                    preview.style.top = canvasY + 'px';
                }
                return;
            }

            // デバッグ: isDblClickDrag状態の確認
            if (this.dblClickDragState.isDblClickDrag) {
                logger.debug('[FIGURE EDITOR] handleDragMouseMove: isDblClickDrag=true, previewElement=' + (this.dblClickDragState.previewElement ? 'あり' : 'なし'));
            }
        };

        // スロットル版のmousemoveハンドラ（60FPS制限）
        const throttledDragMouseMove = window.throttleRAF ? window.throttleRAF(handleDragMouseMove) : handleDragMouseMove;

        // document全体でのmousedown（iframe上のクリックも検出するため）
        document.addEventListener('mousedown', (e) => {
            // 仮身要素内でのmousedownを検出
            const vobjElement = e.target.closest('.virtual-object');
            if (vobjElement) {
                // 基本図形編集プラグインではiframe無効化は不要
                logger.debug('[FIGURE EDITOR] document mousedown: 仮身要素内');
            }
        }, { capture: true });

        // document全体でのmousemove
        document.addEventListener('mousemove', throttledDragMouseMove);

        // document全体でのmouseup
        document.addEventListener('mouseup', (e) => {
            logger.debug('[FIGURE EDITOR] ★★★ document mouseup検知 ★★★');
            logger.debug('[FIGURE EDITOR] document mouseup: isDblClickDrag=' + this.dblClickDragState.isDblClickDrag + ', isDblClickDragCandidate=' + this.dblClickDragState.isDblClickDragCandidate + ', button=' + e.button);

            // ダブルクリック+ドラッグのプレビュー要素を削除
            const preview = this.dblClickDragState.previewElement;
            if (preview) {
                preview.remove();
                this.dblClickDragState.previewElement = null;
            }

            // ダブルクリック+ドラッグ確定後のmouseup処理（実身複製）
            if (this.dblClickDragState.isDblClickDrag) {
                logger.debug('[FIGURE EDITOR] ダブルクリック+ドラッグ完了、実身を複製');

                const dblClickedShape = this.dblClickDragState.dblClickedShape;
                const dblClickedElement = this.dblClickDragState.dblClickedElement;

                if (dblClickedShape && dblClickedElement && !this.readonly) {
                    // マウスアップ位置をキャンバス座標（論理座標）に変換
                    const container = document.querySelector('.editor-container');
                    if (container) {
                        const rect = container.getBoundingClientRect();
                        const physX = e.clientX - rect.left + container.scrollLeft;
                        const physY = e.clientY - rect.top + container.scrollTop;
                        const logical = this.physicalToLogical(physX, physY);

                        // handleDoubleClickDragDuplicateメソッドを呼び出し（ドロップ位置を渡す）
                        this.handleDoubleClickDragDuplicate(dblClickedShape, logical.x, logical.y);
                    }

                    // draggableをtrueに戻す
                    dblClickedElement.setAttribute('draggable', 'true');
                }

                // 状態をクリア（共通メソッド使用）
                this.cleanupDblClickDragState();
                // プラグイン固有のクリーンアップ
                this.dblClickDragState.dblClickedShape = null;
                return;
            }

            // ダブルクリック候補でドラッグしなかった場合、仮身を開く
            if (this.dblClickDragState.isDblClickDragCandidate) {
                logger.debug('[FIGURE EDITOR] ダブルクリック検出、仮身を開く');

                const dblClickedShape = this.dblClickDragState.dblClickedShape;
                const dblClickedElement = this.dblClickDragState.dblClickedElement;

                if (dblClickedShape && dblClickedElement && !this.readonly) {
                    // ダブルクリックされた仮身を選択状態にする
                    if (!this.selectedShapes.includes(dblClickedShape)) {
                        this.selectedShapes = [dblClickedShape];
                    }

                    // 仮身を開く
                    this.openRealObjectWithDefaultApp();
                }

                // draggableをtrueに戻す
                if (dblClickedElement) {
                    dblClickedElement.setAttribute('draggable', 'true');
                }

                // 状態をクリア（共通メソッド使用）
                this.cleanupDblClickDragState();
                // プラグイン固有のクリーンアップ
                this.dblClickDragState.dblClickedShape = null;
            }
        });
    }

    /**
     * スクロールイベントを処理
     */
    handleScroll(scrollLeft, scrollTop) {
        const container = document.querySelector('.plugin-content');
        if (container) {
            // コンテナをスクロール
            container.scrollLeft = scrollLeft;
            container.scrollTop = scrollTop;
            logger.debug('[FIGURE EDITOR] スクロール位置更新:', scrollLeft, scrollTop);
        }
    }

    handleMouseDown(e) {
        // 読み取り専用モードの場合は操作を無効化
        if (this.readonly) {
            return;
        }

        const rect = this.canvas.getBoundingClientRect();
        // 物理座標から論理座標に変換
        const physical = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        const logical = this.physicalToLogical(physical.x, physical.y);
        let x = logical.x;
        let y = logical.y;

        // 格子点拘束を適用
        const snapped = this.snapToGrid(x, y);
        this.startX = snapped.x;
        this.startY = snapped.y;
        this.isDrawing = true;

        // ピクセルマップモード中の処理を最優先（currentToolに関わらず）
        if (this.isPixelmapMode) {
            if (this.editingPixelmap && this.isPointInShape(this.startX, this.startY, this.editingPixelmap)) {
                // 枠内クリック → 描画
                this.handlePixelmapDraw(this.startX, this.startY);
            } else {
                // 枠外クリック → モード終了
                this.exitPixelmapMode();
                this.isDrawing = false;
            }
            return;
        }

        if (this.currentTool === 'select') {
            // 変形モード中の処理
            if (this.isTransformMode) {
                const vertexIdx = this.getVertexHandleAt(this.startX, this.startY);
                if (vertexIdx >= 0) {
                    // 頂点ハンドルのドラッグ開始
                    this.isDraggingVertex = true;
                    this.draggedVertexIndex = vertexIdx;
                    const v = this.transformVertices[vertexIdx];
                    this.vertexDragStartX = v.x;
                    this.vertexDragStartY = v.y;
                    this.saveStateForUndo();
                    this.canvas.style.cursor = 'grabbing';
                    return;
                }
                // 変形中の図形上をクリックした場合は何もしない
                if (this.isPointInShape(this.startX, this.startY, this.transformingShape)) {
                    return;
                }
                // 図形外クリック: 変形モード終了
                this.exitTransformMode();
                // fall through して通常の選択処理を継続
            }

            // 図形選択モード
            // リサイズハンドルをクリックしたかチェック
            const resizeHandle = this.getResizeHandleAt(this.startX, this.startY);
            if (resizeHandle) {
                // 保護されている図形かチェック
                if (resizeHandle.shape.locked || resizeHandle.shape.isBackground) {
                    const protectionType = resizeHandle.shape.isBackground ? '背景化' : '固定化';
                    logger.debug('[FIGURE EDITOR] 保護されている図形のためリサイズできません:', protectionType);
                    this.setStatus(`保護されている図形のためリサイズできません (${protectionType})`);
                    return;
                }

                // Ctrl+ハンドルドラッグ → 回転モード開始
                if (e.ctrlKey) {
                    this.isRotating = true;

                    // 回転対象: 選択中の図形すべて（vobj, lineは除外）
                    const rotationTargets = this.selectedShapes.filter(s => s.type !== 'vobj' && s.type !== 'line');
                    if (rotationTargets.length === 0) {
                        this.isRotating = false;
                        return;
                    }

                    // 回転中心を計算（全対象図形の結合バウンディングボックスの中心）
                    let combinedMinX = Infinity, combinedMinY = Infinity;
                    let combinedMaxX = -Infinity, combinedMaxY = -Infinity;
                    for (const s of rotationTargets) {
                        const b = this.getShapeBoundingBox(s);
                        if (!b) continue;
                        combinedMinX = Math.min(combinedMinX, b.minX);
                        combinedMinY = Math.min(combinedMinY, b.minY);
                        combinedMaxX = Math.max(combinedMaxX, b.maxX);
                        combinedMaxY = Math.max(combinedMaxY, b.maxY);
                    }
                    this.rotationCenterX = (combinedMinX + combinedMaxX) / 2;
                    this.rotationCenterY = (combinedMinY + combinedMaxY) / 2;

                    // ドラッグ開始角度を計算
                    this.rotationStartAngle = Math.atan2(
                        this.startY - this.rotationCenterY,
                        this.startX - this.rotationCenterX
                    );

                    // 各図形の元状態を保存
                    this.rotationOriginals = rotationTargets.map(s => {
                        const b = this.getShapeBoundingBox(s);
                        const cx = b ? (b.minX + b.maxX) / 2 : 0;
                        const cy = b ? (b.minY + b.maxY) / 2 : 0;
                        const original = {
                            shape: s,
                            rotation: this.getEffectiveRotationDeg(s),
                            centerX: cx,
                            centerY: cy
                        };
                        // 座標系の元値を保存
                        if (s.points) {
                            original.points = s.points.map(p => ({ x: p.x, y: p.y }));
                        } else if (s.path) {
                            original.path = s.path.map(p => ({ x: p.x, y: p.y }));
                        }
                        if (s.startX !== undefined) {
                            original.startX = s.startX;
                            original.startY = s.startY;
                            original.endX = s.endX;
                            original.endY = s.endY;
                        }
                        return original;
                    });

                    return;
                }

                // リサイズ開始
                this.isResizing = true;
                this.resizingShape = resizeHandle.shape;
                this.resizeStartX = this.startX;
                this.resizeStartY = this.startY;
                this.resizeOriginalBounds = {
                    startX: resizeHandle.shape.startX,
                    startY: resizeHandle.shape.startY,
                    endX: resizeHandle.shape.endX,
                    endY: resizeHandle.shape.endY
                };

                // リサイズプレビュー枠を作成
                this.createResizePreviewBox(resizeHandle.shape);

                // 仮身の場合、iframe の pointer-events を無効化し、z-indexを下げる
                if (resizeHandle.shape.type === 'vobj' && resizeHandle.shape.expandedElement) {
                    resizeHandle.shape.expandedElement.style.pointerEvents = 'none';
                    resizeHandle.shape.originalZIndex = resizeHandle.shape.expandedElement.style.zIndex;
                    resizeHandle.shape.expandedElement.style.zIndex = '1';
                }

                return;
            }

            // 線の端点をクリックしたかチェック
            const lineEndpoint = this.getLineEndpointAt(this.startX, this.startY);
            if (lineEndpoint) {
                // 線の端点ドラッグ開始
                this.isDraggingLineEndpoint = true;
                this.draggedLineEndpoint = lineEndpoint;
                return;
            }

            // クリック位置に選択中の図形があるかチェック
            let clickedSelectedShape = false;
            for (const shape of this.selectedShapes) {
                if (this.isPointInShape(this.startX, this.startY, shape)) {
                    clickedSelectedShape = true;
                    break;
                }
            }

            if (clickedSelectedShape && !e.shiftKey) {
                // 選択済みの図形をクリックした場合

                // 保護されている図形があるかチェック
                const hasProtectedShape = this.selectedShapes.some(shape =>
                    shape.locked || shape.isBackground
                );

                if (hasProtectedShape) {
                    // 保護されている図形が含まれている場合はドラッグを禁止
                    const protectedShapes = this.selectedShapes.filter(shape =>
                        shape.locked || shape.isBackground
                    );
                    const protectionTypes = protectedShapes.map(shape => {
                        if (shape.isBackground) return '背景化';
                        if (shape.locked) return '固定化';
                        return '';
                    }).filter(t => t).join('、');

                    logger.debug('[FIGURE EDITOR] 保護されている図形が含まれているため移動できません:', protectionTypes);
                    this.setStatus(`保護されている図形が含まれているため移動できません (${protectionTypes})`);
                    return;
                }

                // 仮身図形の場合、DOM要素のpointer-eventsを有効化（ドラッグ用）
                this.selectedShapes.forEach(shape => {
                    if (shape.type === 'vobj' && shape.vobjElement) {
                        shape.vobjElement.style.pointerEvents = 'auto';
                    }
                });

                // ドラッグ開始（仮身も含む）
                this.isDraggingShape = true;
                this.dragOffsets = this.selectedShapes.map(shape => ({
                    shape: shape,
                    offsetX: this.startX - (shape.startX || 0),
                    offsetY: this.startY - (shape.startY || 0),
                    offsetEndX: shape.endX !== undefined ? this.startX - shape.endX : 0,
                    offsetEndY: shape.endY !== undefined ? this.startY - shape.endY : 0
                }));
            } else {
                // クリック位置に図形があるかチェック
                let shapeFound = false;
                for (let i = this.shapes.length - 1; i >= 0; i--) {
                    const shape = this.shapes[i];
                    if (this.isPointInShape(this.startX, this.startY, shape)) {
                        shapeFound = true;
                        break;
                    }
                }

                if (shapeFound) {
                    // 図形をクリックした場合は選択
                    this.selectShapeAt(this.startX, this.startY, e.shiftKey);
                } else {
                    // 空白エリアをクリックした場合は矩形選択モード開始
                    this.isRectangleSelecting = true;
                    this.selectionRect = {
                        startX: this.startX,
                        startY: this.startY,
                        endX: this.startX,
                        endY: this.startY
                    };

                    // Shiftキーが押されていない場合は既存の選択をクリア
                    if (!e.shiftKey && !this.toolPanelPopupOpen) {
                        this.selectedShapes = [];
                        this.redraw();
                    }
                }
            }
        } else if (this.currentTool === 'text') {
            // 文字枠作成モード - 長方形を描くように枠を作成
            this.currentShape = {
                type: 'document',
                startX: this.startX,
                startY: this.startY,
                endX: this.startX,
                endY: this.startY,
                content: '',
                fontSize: this.defaultFontSize,
                fontFamily: this.defaultFontFamily,
                textColor: this.defaultTextColor,
                fillColor: 'transparent',
                strokeColor: 'transparent',
                lineWidth: 0,
                decorations: {
                    bold: false,
                    italic: false,
                    underline: false,
                    strikethrough: false
                }
            };
        } else if (this.currentTool === 'canvas') {
            // ピクセルマップモード
            logger.debug('[FIGURE EDITOR] キャンバスツールクリック - isPixelmapMode:', this.isPixelmapMode, '座標:', this.startX, this.startY);

            if (!this.isPixelmapMode) {
                // ピクセルマップ枠作成モード - クリック位置の既存ピクセルマップをチェック
                const clickedPixelmap = this.findShapeAt(this.startX, this.startY, 'pixelmap');
                logger.debug('[FIGURE EDITOR] clickedPixelmap:', clickedPixelmap);

                if (clickedPixelmap) {
                    // 既存のピクセルマップをクリック -> 編集モードに入る
                    logger.debug('[FIGURE EDITOR] 既存ピクセルマップをクリック、編集モードに入ります');
                    this.enterPixelmapMode(clickedPixelmap);
                    this.isDrawing = false;
                } else {
                    // 新規ピクセルマップ枠を作成
                    logger.debug('[FIGURE EDITOR] 新規ピクセルマップ枠を作成開始');
                    this.currentShape = {
                        type: 'pixelmap',
                        startX: this.startX,
                        startY: this.startY,
                        endX: this.startX,
                        endY: this.startY,
                        backgroundColor: 'transparent',
                        imageData: null
                    };
                }
            } else {
                // ピクセルマップモード内での描画
                logger.debug('[FIGURE EDITOR] ピクセルマップモード内でのクリック - 描画処理を実行');

                // ピクセルマップ枠内かチェック
                if (this.editingPixelmap && this.isPointInShape(this.startX, this.startY, this.editingPixelmap)) {
                    // 枠内でのクリック -> 描画
                    this.handlePixelmapDraw(this.startX, this.startY);
                } else {
                    // 枠外でのクリック -> 編集モードを終了
                    logger.debug('[FIGURE EDITOR] ピクセルマップ枠外をクリック - 編集モードを終了');
                    this.exitPixelmapMode();
                    this.isDrawing = false;
                }
            }
        } else if (this.currentTool === 'pencil' || this.currentTool === 'brush' || this.currentTool === 'curve') {
            // フリーハンド描画開始
            this.currentPath = [{ x: this.startX, y: this.startY }];
            this.currentShape = {
                type: this.currentTool,
                path: this.currentPath,
                strokeColor: this.strokeColor,
                fillColor: this.fillColor,
                lineWidth: this.currentTool === 'brush' ? this.lineWidth * 2 : this.lineWidth,
                lineType: this.lineType,
                linePatternId: this.linePatternId || 0,
                fillPatternId: this.fillPatternId || 0
            };
        } else if (this.currentTool === 'polygon') {
            // 多角形描画（最初はドラッグ、その後クリックで頂点追加）
            if (!this.currentShape) {
                // 最初の頂点：ドラッグで第2頂点を決定
                this.currentShape = {
                    type: 'polygon',
                    points: [{ x: this.startX, y: this.startY }],
                    strokeColor: this.strokeColor,
                    fillColor: this.fillEnabled ? this.fillColor : 'transparent',
                    lineWidth: this.lineWidth,
                    lineType: this.lineType,
                    linePatternId: this.linePatternId || 0,
                    fillPatternId: this.fillPatternId || 0,
                    cornerRadius: this.cornerRadius,
                    tempEndX: this.startX,
                    tempEndY: this.startY
                };
                this.isFirstPolygonLine = true;
                // isDrawingをtrueのままにしてドラッグ可能にする
                // 初期表示（開始点のみ）を描画
                this.redraw();
                this.drawShape(this.currentShape);
            } else {
                // 2つ目以降の頂点追加
                // 重複チェック: 前の頂点と同じ位置なら追加しない（ダブルクリック対策）
                const lastPoint = this.currentShape.points[this.currentShape.points.length - 1];
                if (!(lastPoint && lastPoint.x === this.startX && lastPoint.y === this.startY)) {
                    this.currentShape.points.push({ x: this.startX, y: this.startY });
                }
                this.currentShape.tempEndX = this.startX;
                this.currentShape.tempEndY = this.startY;
                this.redraw();
                this.drawShape(this.currentShape);
                // ドラッグ不要なのでisDrawingをfalseに
                this.isDrawing = false;
            }
        } else {
            // 通常の図形描画開始
            let startX = this.startX;
            let startY = this.startY;
            let startConnection = null;

            // 直線描画時：開始点をコネクタにスナップ
            if (this.currentTool === 'line') {
                const snapConnector = this.findSnapConnector(this.startX, this.startY);
                if (snapConnector) {
                    startX = snapConnector.connector.x;
                    startY = snapConnector.connector.y;
                    startConnection = {
                        shapeId: snapConnector.shapeId,
                        connectorIndex: snapConnector.connector.index
                    };
                }
            }

            this.currentShape = {
                type: this.currentTool,
                startX: startX,
                startY: startY,
                endX: startX,
                endY: startY,
                strokeColor: this.strokeColor,
                fillColor: this.fillEnabled ? this.fillColor : 'transparent',
                lineWidth: this.lineWidth,
                lineType: this.lineType,
                linePatternId: this.linePatternId || 0,
                fillEnabled: this.fillEnabled,
                fillPatternId: this.fillPatternId,
                lineConnectionType: this.currentTool === 'line' ? this.lineConnectionType : undefined,
                cornerRadius: this.currentTool === 'rect' || this.currentTool === 'polygon' ? this.cornerRadius : 0
            };

            // 直線の場合、開始点の接続情報と矢印情報を保存
            if (this.currentTool === 'line') {
                if (startConnection) {
                    this.currentShape.startConnection = startConnection;
                }
                // 矢印情報を追加
                this.currentShape.start_arrow = (this.arrowPosition === 'start' || this.arrowPosition === 'both') ? 1 : 0;
                this.currentShape.end_arrow = (this.arrowPosition === 'end' || this.arrowPosition === 'both') ? 1 : 0;
                this.currentShape.arrow_type = this.arrowType;
            }
        }
    }

    handleMouseMove(e) {
        const rect = this.canvas.getBoundingClientRect();
        // 物理座標から論理座標に変換
        const physical = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        const logical = this.physicalToLogical(physical.x, physical.y);
        let currentX = logical.x;
        let currentY = logical.y;

        // マウス位置を保存（コネクタ表示用）
        this.lastMouseX = currentX;
        this.lastMouseY = currentY;

        // 変形モード中の処理
        if (this.isTransformMode) {
            if (this.isDraggingVertex) {
                // 頂点ドラッグ中
                let newX = currentX;
                let newY = currentY;

                // 回転された図形の場合、マウス座標を逆回転して回転前の座標系に変換
                const wrapperRot = this.getWrapperRotation(this.transformingShape);
                if (wrapperRot !== 0) {
                    const bounds = this.getShapeBoundingBox(this.transformingShape);
                    if (bounds) {
                        const cx = (bounds.minX + bounds.maxX) / 2;
                        const cy = (bounds.minY + bounds.maxY) / 2;
                        const rotated = GeometryUtils.rotatePoint(newX, newY, cx, cy, -wrapperRot);
                        newX = rotated.x;
                        newY = rotated.y;
                    }
                }

                // Shift制約: 水平/垂直方向に拘束
                if (e.shiftKey) {
                    const dx = Math.abs(newX - this.vertexDragStartX);
                    const dy = Math.abs(newY - this.vertexDragStartY);
                    if (dx > dy) {
                        newY = this.vertexDragStartY; // 水平移動
                    } else {
                        newX = this.vertexDragStartX; // 垂直移動
                    }
                }
                // 格子点拘束を適用
                const snapped = this.snapToGrid(newX, newY);
                this.applyVertexDrag(this.transformingShape, this.draggedVertexIndex, snapped.x, snapped.y);
                this.redraw();
                return;
            }
            // ホバー時のカーソル変更
            const vertexIdx = this.getVertexHandleAt(currentX, currentY);
            this.canvas.style.cursor = vertexIdx >= 0 ? 'grab' : 'default';
            return;
        }

        // 直線ツール選択中は常にコネクタを表示するため、再描画
        if (this.currentTool === 'line' && !this.isDrawing) {
            this.redraw();
        }

        // 多角形描画中は常にプレビュー表示を更新
        const isPolygonDrawing = this.currentTool === 'polygon' && this.currentShape;
        if (!this.isDrawing && !isPolygonDrawing && !this.isRectangleSelecting) return;

        // 矩形選択中
        if (this.isRectangleSelecting) {
            this.selectionRect.endX = currentX;
            this.selectionRect.endY = currentY;
            this.redraw();
            return;
        }

        // ピクセルマップモードでの描画（currentToolに関わらず最優先）
        if (this.isPixelmapMode) {
            this.handlePixelmapDraw(currentX, currentY);
            return;
        }

        // 回転ドラッグ中
        if (this.isRotating) {
            // 現在のマウス角度を計算
            const currentAngle = Math.atan2(
                currentY - this.rotationCenterY,
                currentX - this.rotationCenterX
            );
            let deltaAngle = (currentAngle - this.rotationStartAngle) * 180 / Math.PI;

            // Ctrl+Shift: 15度スナップ
            if (e.shiftKey) {
                deltaAngle = Math.round(deltaAngle / 15) * 15;
            }

            const deltaRad = deltaAngle * Math.PI / 180;
            const cosDelta = Math.cos(deltaRad);
            const sinDelta = Math.sin(deltaRad);

            // 各図形を更新
            for (const orig of this.rotationOriginals) {
                const s = orig.shape;

                // 1. 自己回転の更新
                const newRotation = orig.rotation + deltaAngle;
                if (s.type === 'arc' || s.type === 'chord' || s.type === 'elliptical_arc') {
                    s.angle = newRotation * Math.PI / 180;
                } else {
                    s.rotation = newRotation;
                }

                // 2. 複数図形の場合: 結合中心周りの軌道移動
                if (this.rotationOriginals.length > 1) {
                    // 元の図形中心から結合中心までの相対位置
                    const relX = orig.centerX - this.rotationCenterX;
                    const relY = orig.centerY - this.rotationCenterY;
                    // 回転後の図形中心
                    const newCX = this.rotationCenterX + relX * cosDelta - relY * sinDelta;
                    const newCY = this.rotationCenterY + relX * sinDelta + relY * cosDelta;
                    // 移動量
                    const moveX = newCX - orig.centerX;
                    const moveY = newCY - orig.centerY;

                    // 座標を移動
                    if (orig.points) {
                        for (let i = 0; i < orig.points.length; i++) {
                            s.points[i].x = orig.points[i].x + moveX;
                            s.points[i].y = orig.points[i].y + moveY;
                        }
                    }
                    if (orig.path) {
                        for (let i = 0; i < orig.path.length; i++) {
                            s.path[i].x = orig.path[i].x + moveX;
                            s.path[i].y = orig.path[i].y + moveY;
                        }
                    }
                    if (orig.startX !== undefined) {
                        s.startX = orig.startX + moveX;
                        s.startY = orig.startY + moveY;
                        s.endX = orig.endX + moveX;
                        s.endY = orig.endY + moveY;
                    }
                }
            }

            this.redraw();
            // ステータスバーに角度表示
            const displayAngle = ((deltaAngle % 360) + 360) % 360;
            this.setStatus(`回転: ${displayAngle.toFixed(1)}°`);
            return;
        }

        if (this.isResizing) {
            // リサイズ中
            const shape = this.resizingShape;
            const deltaX = currentX - this.resizeStartX;
            const deltaY = currentY - this.resizeStartY;

            // 仮身の場合の最小サイズを設定
            let minWidth = 10; // 通常の図形の最小幅
            let minHeight = 10; // 通常の図形の最小高さ

            if (shape.type === 'vobj') {
                minWidth = 50; // 仮身の最小幅
                minHeight = shape.originalHeight || 32; // chszから計算された元の高さ
            }

            // シフトキーが押されている場合は縦横比を維持
            if (e.shiftKey) {
                const originalWidth = Math.abs(this.resizeOriginalBounds.endX - this.resizeOriginalBounds.startX);
                const originalHeight = Math.abs(this.resizeOriginalBounds.endY - this.resizeOriginalBounds.startY);
                const aspectRatio = originalWidth / originalHeight;

                // より変化量の大きい方向に合わせる
                if (Math.abs(deltaX) > Math.abs(deltaY)) {
                    shape.endX = this.resizeOriginalBounds.endX + deltaX;
                    // 格子点拘束: 主軸(X)をスナップし、副軸(Y)はアスペクト比から算出
                    if (this.gridMode === 'snap') {
                        const snapped = this.snapToGrid(shape.endX, 0);
                        shape.endX = snapped.x;
                    }
                    shape.endY = shape.startY + (shape.endX - shape.startX) / aspectRatio;
                } else {
                    shape.endY = this.resizeOriginalBounds.endY + deltaY;
                    // 格子点拘束: 主軸(Y)をスナップし、副軸(X)はアスペクト比から算出
                    if (this.gridMode === 'snap') {
                        const snapped = this.snapToGrid(0, shape.endY);
                        shape.endY = snapped.y;
                    }
                    shape.endX = shape.startX + (shape.endY - shape.startY) * aspectRatio;
                }
            } else {
                // 自由変形
                shape.endX = this.resizeOriginalBounds.endX + deltaX;
                shape.endY = this.resizeOriginalBounds.endY + deltaY;
                // 格子点拘束をendX/endYに適用
                if (this.gridMode === 'snap') {
                    const snapped = this.snapToGrid(shape.endX, shape.endY);
                    shape.endX = snapped.x;
                    shape.endY = snapped.y;
                }
            }

            // 最小サイズを適用
            const currentWidth = shape.endX - shape.startX;
            const currentHeight = shape.endY - shape.startY;

            if (currentWidth < minWidth) {
                shape.endX = shape.startX + minWidth;
            }
            if (currentHeight < minHeight) {
                shape.endY = shape.startY + minHeight;
            }

            // 仮身の場合、iframe のサイズを更新（展開済みの場合のみ）
            if (shape.type === 'vobj' && shape.expanded) {
                const newHeight = shape.endY - shape.startY;
                const newWidth = shape.endX - shape.startX;
                this.updateExpandedVirtualObjectSize(shape, newWidth, newHeight);
            }

            // 仮身DOM要素のサイズを更新（論理座標を物理座標に変換）
            if (shape.type === 'vobj' && shape.vobjElement) {
                const newWidth = shape.endX - shape.startX;
                const newHeight = shape.endY - shape.startY;
                const resizeSize = this.logicalToPhysical(newWidth, newHeight);
                shape.vobjElement.style.width = `${resizeSize.x}px`;
                shape.vobjElement.style.height = `${resizeSize.y}px`;
            }

            // リサイズプレビュー枠を更新
            this.updateResizePreviewBox(shape);

            this.redraw();
            this.isModified = true;
            return;
        }

        // 線の端点ドラッグ中
        if (this.isDraggingLineEndpoint) {
            const shape = this.draggedLineEndpoint.shape;
            const endpoint = this.draggedLineEndpoint.endpoint;

            // コネクタスナップをチェック
            let snapX = currentX;
            let snapY = currentY;
            let snappedConnector = null;

            // 全図形をチェックして、近くにコネクタがあるかチェック
            for (const targetShape of this.shapes) {
                // 自分自身の線はスキップ
                if (targetShape === shape) continue;

                // コネクタ対応図形のみチェック
                if (targetShape.type !== 'rect' && targetShape.type !== 'roundRect' &&
                    targetShape.type !== 'ellipse' && targetShape.type !== 'polygon' && targetShape.type !== 'vobj') {
                    continue;
                }

                // コネクタポイントを取得
                const connectorPoints = this.getConnectorPoints(targetShape);

                // 各コネクタポイントとの距離をチェック
                for (const point of connectorPoints) {
                    const dist = Math.sqrt(
                        Math.pow(currentX - point.x, 2) + Math.pow(currentY - point.y, 2)
                    );

                    if (dist <= this.connectorSnapDistance) {
                        snapX = point.x;
                        snapY = point.y;
                        snappedConnector = { shapeId: this.shapes.indexOf(targetShape), connectorIndex: point.index };
                        break;
                    }
                }

                if (snappedConnector) break;
            }

            // 線の端点を更新
            if (endpoint === 'start') {
                shape.startX = snapX;
                shape.startY = snapY;
            } else {
                shape.endX = snapX;
                shape.endY = snapY;
            }

            // 接続情報を更新
            if (snappedConnector) {
                if (endpoint === 'start') {
                    shape.startConnection = snappedConnector;
                } else {
                    shape.endConnection = snappedConnector;
                }
            } else {
                // スナップしていない場合は接続を解除
                if (endpoint === 'start') {
                    shape.startConnection = null;
                } else {
                    shape.endConnection = null;
                }
            }

            this.redraw();
            this.isModified = true;
            return;
        }

        if (this.isDraggingShape) {
            // 図形をドラッグ移動中
            this.dragOffsets.forEach(offset => {
                const shape = offset.shape;
                // 図形の左上座標を計算
                let newStartX = currentX - offset.offsetX;
                let newStartY = currentY - offset.offsetY;

                // 格子点拘束を図形の左上座標に適用
                if (this.gridMode === 'snap' && shape.startX !== undefined && shape.startY !== undefined) {
                    const snapped = this.snapToGrid(newStartX, newStartY);
                    const deltaX = snapped.x - newStartX;
                    const deltaY = snapped.y - newStartY;
                    newStartX = snapped.x;
                    newStartY = snapped.y;

                    // endXとendYも同じdeltaで調整
                    if (shape.endX !== undefined && shape.endY !== undefined) {
                        shape.endX = (currentX - offset.offsetEndX) + deltaX;
                        shape.endY = (currentY - offset.offsetEndY) + deltaY;
                    }
                } else if (shape.endX !== undefined && shape.endY !== undefined) {
                    shape.endX = currentX - offset.offsetEndX;
                    shape.endY = currentY - offset.offsetEndY;
                }

                if (shape.startX !== undefined && shape.startY !== undefined) {
                    const deltaX = newStartX - shape.startX;
                    const deltaY = newStartY - shape.startY;

                    shape.startX = newStartX;
                    shape.startY = newStartY;

                    // 弧系図形のcenterX/Yも連動して移動
                    if ((shape.type === 'arc' || shape.type === 'chord' || shape.type === 'elliptical_arc') &&
                        shape.centerX !== undefined) {
                        shape.centerX += deltaX;
                        shape.centerY += deltaY;
                    }

                    // グループの場合、子図形も移動
                    if (shape.type === 'group' && shape.shapes) {
                        this.moveGroupShapes(shape, deltaX, deltaY);
                    }
                }

                // パスを持つ図形（フリーハンド、多角形）の場合
                if (shape.path) {
                    const deltaX = currentX - this.startX;
                    const deltaY = currentY - this.startY;
                    shape.path = shape.path.map(p => ({
                        x: p.x + deltaX,
                        y: p.y + deltaY
                    }));
                }

                if (shape.points) {
                    const deltaX = currentX - this.startX;
                    const deltaY = currentY - this.startY;
                    shape.points = shape.points.map(p => ({
                        x: p.x + deltaX,
                        y: p.y + deltaY
                    }));
                }

                // 展開された仮身のiframe位置を更新（論理座標を物理座標に変換）
                if (shape.type === 'vobj' && shape.expanded && shape.expandedElement) {
                    const chsz = shape.virtualObject.chsz || DEFAULT_FONT_SIZE;
                    const chszPx = window.convertPtToPx(chsz);
                    const titleBarHeight = Math.max(chszPx, Math.ceil(chszPx * DEFAULT_LINE_HEIGHT)) + VOBJ_PADDING_VERTICAL + 1;
                    const expPos = this.logicalToPhysical(shape.startX, shape.startY + titleBarHeight);
                    shape.expandedElement.style.left = `${expPos.x}px`;
                    shape.expandedElement.style.top = `${expPos.y}px`;
                }

                // 仮身DOM要素の位置を更新（論理座標を物理座標に変換）
                if (shape.type === 'vobj' && shape.vobjElement) {
                    const movePos = this.logicalToPhysical(shape.startX, shape.startY);
                    shape.vobjElement.style.left = `${movePos.x}px`;
                    shape.vobjElement.style.top = `${movePos.y}px`;
                }
            });

            // 接続されている線の端点を更新
            this.dragOffsets.forEach(offset => {
                const shape = offset.shape;
                const connections = this.getConnectedLines(shape);

                connections.forEach(conn => {
                    // 移動後のコネクタポイントを取得
                    const connectorPoints = this.getConnectorPoints(shape);
                    const connectorPoint = connectorPoints.find(p => p.index === conn.connectorIndex);

                    if (connectorPoint) {
                        // 線の端点を更新
                        if (conn.endpoint === 'start') {
                            conn.line.startX = connectorPoint.x;
                            conn.line.startY = connectorPoint.y;
                        } else {
                            conn.line.endX = connectorPoint.x;
                            conn.line.endY = connectorPoint.y;
                        }
                    }
                });
            });

            // ドラッグ開始位置を更新
            this.startX = currentX;
            this.startY = currentY;
            this.redraw();
            this.isModified = true;
        } else if (this.isPixelmapMode) {
            // ピクセルマップモードでのドラッグ描画
            this.handlePixelmapDraw(currentX, currentY);
        } else if (this.currentTool === 'pencil' || this.currentTool === 'brush' || this.currentTool === 'curve') {
            // フリーハンド描画のパスに点を追加
            this.currentPath.push({ x: currentX, y: currentY });
            this.currentShape.path = this.currentPath;
            this.redraw();
            this.drawShape(this.currentShape);
        } else if (this.currentTool === 'polygon' && this.currentShape) {
            // 多角形描画中：次の頂点位置をプレビュー表示
            if (this.isFirstPolygonLine) {
                // 最初の線はドラッグ中
                this.currentShape.tempEndX = currentX;
                this.currentShape.tempEndY = currentY;
            } else {
                // 2つ目以降：マウス位置に向かってプレビューライン表示
                this.currentShape.tempEndX = currentX;
                this.currentShape.tempEndY = currentY;
            }
            this.redraw();
            this.drawShape(this.currentShape);
        } else if (this.currentShape) {
            // 通常の図形描画
            // 直線描画時：終点をコネクタにスナップ
            if (this.currentTool === 'line') {
                const snapConnector = this.findSnapConnector(currentX, currentY);
                if (snapConnector) {
                    currentX = snapConnector.connector.x;
                    currentY = snapConnector.connector.y;
                    // 終点の接続情報を一時保存（マウスアップ時に確定）
                    this.currentShape.tempEndConnection = {
                        shapeId: snapConnector.shapeId,
                        connectorIndex: snapConnector.connector.index
                    };
                } else {
                    // スナップしていない場合は接続情報をクリア
                    this.currentShape.tempEndConnection = null;
                }
            }
            // 格子点拘束を適用（フリーハンド以外、直線はコネクタスナップ優先）
            else if (this.gridMode === 'snap' && this.currentTool !== 'curve' && this.currentTool !== 'pencil' && this.currentTool !== 'brush') {
                const snapped = this.snapToGrid(currentX, currentY);
                currentX = snapped.x;
                currentY = snapped.y;
            }

            // Shiftキーが押されている場合、長方形と円と三角形は縦横比1:1にする
            if (e.shiftKey && (this.currentTool === 'rect' || this.currentTool === 'ellipse' || this.currentTool === 'triangle')) {
                const deltaX = currentX - this.startX;
                const deltaY = currentY - this.startY;

                // 変化量の大きい方向に合わせて正方形/正円にする
                const size = Math.max(Math.abs(deltaX), Math.abs(deltaY));

                // 符号を保持して適用
                currentX = this.startX + (deltaX >= 0 ? size : -size);
                currentY = this.startY + (deltaY >= 0 ? size : -size);
            }

            this.currentShape.endX = currentX;
            this.currentShape.endY = currentY;
            this.redraw();
            this.drawShape(this.currentShape);
        }
    }

    handleMouseUp(e) {
        // 変形モード: 頂点ドラッグ終了
        if (this.isDraggingVertex) {
            this.isDraggingVertex = false;
            this.draggedVertexIndex = -1;
            this.canvas.style.cursor = 'grab';
            this.isDrawing = false;
            // Undo用の状態は saveStateForUndo() でドラッグ開始時に保存済み
            this.resizeCanvas();
            this.redraw();
            return;
        }

        // ピクセルマップモードの描画終了時に前回座標をリセット
        if (this.isPixelmapMode) {
            this.lastPixelmapX = null;
            this.lastPixelmapY = null;
        }

        // 矩形選択終了
        if (this.isRectangleSelecting) {
            this.isRectangleSelecting = false;

            if (this.selectionRect) {
                const shapesInRect = this.getShapesInRectangle(
                    this.selectionRect.startX,
                    this.selectionRect.startY,
                    this.selectionRect.endX,
                    this.selectionRect.endY
                );

                if (e.shiftKey) {
                    // Shiftキー: 既存の選択にトグル追加
                    shapesInRect.forEach(shape => {
                        const index = this.selectedShapes.indexOf(shape);
                        if (index >= 0) {
                            // 既に選択されている場合は解除
                            this.selectedShapes.splice(index, 1);
                        } else {
                            // 選択されていない場合は追加
                            this.selectedShapes.push(shape);
                        }
                    });
                } else {
                    // 通常: 矩形内の図形のみを選択
                    this.selectedShapes = shapesInRect;
                }

                this.syncSelectedShapeToToolPanel();
                this.selectionRect = null;
                this.redraw();
            }
            return;
        }

        if (!this.isDrawing) return;

        // 多角形描画中の処理
        if (this.currentTool === 'polygon') {
            if (this.isFirstPolygonLine) {
                // 最初の線のドラッグ終了：2つ目の頂点を追加
                const rect = this.canvas.getBoundingClientRect();
                // 物理座標から論理座標に変換
                const physEnd = { x: e.clientX - rect.left, y: e.clientY - rect.top };
                const logEnd = this.physicalToLogical(physEnd.x, physEnd.y);
                const endX = logEnd.x;
                const endY = logEnd.y;

                // 重複チェック: 前の頂点と同じ位置なら追加しない（ドラッグなしの場合）
                const lastPoint = this.currentShape.points[this.currentShape.points.length - 1];
                if (!(lastPoint && lastPoint.x === endX && lastPoint.y === endY)) {
                    this.currentShape.points.push({ x: endX, y: endY });
                }
                this.currentShape.tempEndX = endX;
                this.currentShape.tempEndY = endY;
                this.isFirstPolygonLine = false;
                this.redraw();
                this.drawShape(this.currentShape);
            }
            this.isDrawing = false;
            return;
        }

        this.isDrawing = false;

        if (this.isRotating) {
            // 回転終了
            this.isRotating = false;
            this.rotationOriginals = [];
            this.isModified = true;
            this.saveStateForUndo();
            this.resizeCanvas();
            this.redraw();
            return;
        }

        if (this.isResizing) {
            // リサイズ終了
            const resizedShape = this.resizingShape;

            // リサイズプレビュー枠を削除
            this.removeResizePreviewBox();

            // 仮身の場合、iframe の pointer-events と z-index を元に戻す
            if (resizedShape && resizedShape.type === 'vobj' && resizedShape.expandedElement) {
                resizedShape.expandedElement.style.pointerEvents = 'none'; // キャンバス側でイベント処理
                if (resizedShape.originalZIndex !== undefined) {
                    resizedShape.expandedElement.style.zIndex = resizedShape.originalZIndex;
                    delete resizedShape.originalZIndex;
                }
            }

            this.isResizing = false;
            this.resizingShape = null;
            this.resizeOriginalBounds = null;

            // 仮身のリサイズは makeVirtualObjectResizable() で処理されるため、ここでは何もしない
            // （古い処理は無効化）

            // Undo用に状態を保存
            this.saveStateForUndo();
            // スクロールバー更新を通知
            this.resizeCanvas();
        } else if (this.isDraggingLineEndpoint) {
            // 線の端点ドラッグ終了
            this.isDraggingLineEndpoint = false;
            this.draggedLineEndpoint = null;

            // Undo用に状態を保存
            this.saveStateForUndo();
        } else if (this.isDraggingShape) {
            // ドラッグ終了
            this.isDraggingShape = false;

            // 仮身図形のDOM要素のpointer-eventsを無効化
            this.shapes.forEach(shape => {
                if (shape.type === 'vobj' && shape.vobjElement) {
                    shape.vobjElement.style.pointerEvents = 'none';
                }
            });

            this.dragOffsets = [];
            // Undo用に状態を保存
            this.saveStateForUndo();
            // スクロールバー更新を通知
            this.resizeCanvas();
        } else if (this.currentShape) {
            // Undo用に状態を保存
            this.saveStateForUndo();

            // 直線の場合：終点の接続情報を確定
            if (this.currentShape.type === 'line' && this.currentShape.tempEndConnection) {
                this.currentShape.endConnection = this.currentShape.tempEndConnection;
                delete this.currentShape.tempEndConnection;
            }

            // z-indexを設定（未設定の場合のみ）
            if (this.currentShape.zIndex === null || this.currentShape.zIndex === undefined) {
                this.currentShape.zIndex = this.getNextZIndex();
            }

            // 図形を確定
            this.shapes.push(this.currentShape);

            // 文字枠の場合は自動的に選択状態にする
            if (this.currentShape.type === 'document') {
                this.selectedShapes = [this.currentShape];
                this.syncSelectedShapeToToolPanel();
            }

            // ピクセルマップ枠の場合は自動的にピクセルマップモードに入る
            if (this.currentShape.type === 'pixelmap') {
                this.enterPixelmapMode(this.currentShape);
            }

            this.currentShape = null;
            this.currentPath = [];
            this.redraw();
            this.isModified = true;
            // スクロールバー更新を通知
            this.resizeCanvas();
        }
    }

    handleDoubleClick(e) {
        // 多角形描画中のダブルクリック：多角形を確定
        if (this.currentTool === 'polygon' && this.currentShape) {
            // 読み取り専用モードでは多角形描画自体ができないのでここには来ない
            if (this.readonly) return;
            this.finishPolygon();
            return;
        }

        const rect = this.canvas.getBoundingClientRect();
        // 物理座標から論理座標に変換
        const physical = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        const logical = this.physicalToLogical(physical.x, physical.y);
        const x = logical.x;
        const y = logical.y;

        // ダブルクリック位置にある図形を探す
        for (let i = this.shapes.length - 1; i >= 0; i--) {
            const shape = this.shapes[i];
            if (shape.type === 'document' && this.isPointInShape(x, y, shape)) {
                // 読み取り専用モードでは文字枠編集を無効化
                if (this.readonly) return;
                // 文字枠の編集モードに入る
                this.enterTextEditMode(shape);
                return;
            } else if (shape.type === 'pixelmap' && this.isPointInShape(x, y, shape)) {
                // 読み取り専用モードではピクセルマップ編集を無効化
                if (this.readonly) return;
                // ピクセルマップ枠の編集モードに入る（既にモード中でない場合のみ）
                if (!this.isPixelmapMode) {
                    this.enterPixelmapMode(shape);
                }
                return;
            } else if (shape.type === 'vobj' && this.isPointInShape(x, y, shape)) {
                // 仮身をダブルクリック：defaultOpenプラグインで実身を開く（読み取り専用でも許可）
                // 選択状態にしてから開く
                if (!this.selectedShapes.includes(shape)) {
                    this.selectedShapes = [shape];
                    this.syncSelectedShapeToToolPanel();
                }
                this.openRealObjectWithDefaultApp();
                return;
            } else if ((shape.type === 'polygon' || shape.type === 'arc' ||
                        shape.type === 'chord' || shape.type === 'elliptical_arc' ||
                        shape.type === 'curve') &&
                       this.isPointInShape(x, y, shape)) {
                // 変形対象図形をダブルクリック: 変形モードに入る
                if (this.readonly) return;
                this.enterTransformMode(shape);
                return;
            }
        }
    }

    handleKeyboardShortcuts(e) {
        // Ctrl+S: 保存（読み取り専用モードでは何もしない）
        if (e.ctrlKey && e.key === 's') {
            e.preventDefault();
            if (!this.readonly) {
                this.saveFile();
            }
            return;
        }

        // Ctrl+E: ウィンドウを閉じる（読み取り専用でも許可）
        if (e.ctrlKey && e.key === 'e') {
            e.preventDefault();
            this.requestCloseWindow();
            return;
        }

        // Ctrl+O: 選択中の仮身をdefaultOpenアプリで開く（読み取り専用でも許可）
        if (e.ctrlKey && e.key === 'o') {
            e.preventDefault();
            this.openRealObjectWithDefaultApp();
            return;
        }

        // Ctrl+L: 全画面表示オンオフ（読み取り専用でも許可）
        if (e.ctrlKey && e.key === 'l') {
            e.preventDefault();
            this.toggleFullscreen();
            return;
        }

        // 以下、読み取り専用モードでは無効化
        if (this.readonly) {
            return;
        }

        // Ctrl+A: 全選択
        if (e.ctrlKey && e.key === 'a') {
            e.preventDefault();
            this.selectAllShapes();
            return;
        }

        // Ctrl+C: クリップボードへコピー
        if (e.ctrlKey && e.key === 'c') {
            e.preventDefault();
            this.copyShapes();  // async but fire-and-forget in keyboard handler
            return;
        }

        // Ctrl+V: クリップボードからコピー（貼り付け）
        if (e.ctrlKey && e.key === 'v') {
            e.preventDefault();
            this.pasteShapes();  // async but fire-and-forget in keyboard handler
            return;
        }

        // Ctrl+X: クリップボードへ移動（切り取り）
        if (e.ctrlKey && e.key === 'x') {
            e.preventDefault();
            this.cutShapes();  // async but fire-and-forget in keyboard handler
            return;
        }

        // Delete: 選択図形を削除
        if (e.key === 'Delete') {
            e.preventDefault();
            this.deleteSelectedShapes();  // async but fire-and-forget in keyboard handler
            return;
        }

        // Ctrl+Z: クリップボードから移動
        if (e.ctrlKey && e.key === 'z') {
            e.preventDefault();
            this.pasteMove();
            return;
        }

        // Enter または Escape: 多角形描画を完了
        if ((e.key === 'Enter' || e.key === 'Escape') && this.currentTool === 'polygon' && this.currentShape) {
            e.preventDefault();
            this.finishPolygon();
        }

        // Escape: ピクセルマップモードを抜ける
        if (e.key === 'Escape' && this.isPixelmapMode) {
            e.preventDefault();
            this.exitPixelmapMode();
        }

        // Escape: 変形モードを抜ける
        if (e.key === 'Escape' && this.isTransformMode) {
            e.preventDefault();
            this.exitTransformMode();
        }
    }
};
