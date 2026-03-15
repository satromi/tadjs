/**
 * FigureToolPanelMixin - 道具パネル関連機能
 *
 * 道具パネルウィンドウの表示・非表示、ツール選択、
 * パネルとのメッセージ通信を担当するMixin。
 *
 * 提供メソッド:
 * - selectTool(tool) - ツールを選択
 * - openToolPanelWindow() - 道具パネルウィンドウを開く
 * - toggleToolPanel() - 道具パネルの表示/非表示を切り替え
 * - handlePatternEditorMessage(data) - パターン編集パネルからのメッセージ処理
 * - handleMaterialPanelMessage(data) - 画材パネルからのメッセージ処理
 * - sendToToolPanel(message) - 道具パネルにメッセージを送信
 * - syncSelectedShapeToToolPanel() - 選択図形の属性をツールパネルに同期
 * - onChildPanelClosed(panelType, windowId) - 子パネルが閉じられたときの処理
 */

const logger = window.getLogger('BasicFigureEditor');

export const FigureToolPanelMixin = (Base) => class extends Base {

    selectTool(tool) {
        this.currentTool = tool;

        // 変形モード中にツールが変更された場合は変形モードを終了
        if (this.isTransformMode) {
            this.exitTransformMode();
        }

        // キャンバスツール以外が選択された場合、ピクセルマップモードを抜ける
        if (tool !== 'canvas' && this.isPixelmapMode) {
            this.exitPixelmapMode();
        }

        // カーソルの形状を変更
        switch (tool) {
            case 'select':
                this.canvas.style.cursor = 'default';
                break;
            case 'pencil':
            case 'brush':
                this.canvas.style.cursor = 'crosshair';
                break;
            default:
                this.canvas.style.cursor = 'crosshair';
        }
    }

    /**
     * 道具パネルウィンドウを開く
     */
    openToolPanelWindow() {
        logger.debug('[FIGURE EDITOR] 道具パネルウィンドウを開く');

        // 親ウィンドウに道具パネルウィンドウの作成を要求
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: 'open-tool-panel-window',
                pluginId: 'basic-figure-editor',
                panelpos: this.panelpos || { x: 50, y: 50 }, // 道具パネルの位置を指定
                settings: {
                    fillColor: this.fillColor,
                    fillEnabled: this.fillEnabled,
                    fillPatternId: this.fillPatternId,
                    customPatterns: this.customPatterns,
                    strokeColor: this.strokeColor,
                    lineWidth: this.lineWidth,
                    lineType: this.lineType,
                    linePatternId: this.linePatternId || 0,
                    lineConnectionType: this.lineConnectionType,
                    cornerRadius: this.cornerRadius,
                    zoomLevel: this.zoomLevel
                }
            }, '*');
        }
    }

    toggleToolPanel() {
        // 道具パネルウィンドウの表示/非表示を切り替え
        if (this.toolPanelWindowId) {
            // 道具パネルが開いている場合は閉じる
            logger.debug('[FIGURE EDITOR] 道具パネルウィンドウを閉じます:', this.toolPanelWindowId);
            if (this.messageBus) {
                this.messageBus.send('close-window', {
                    windowId: this.toolPanelWindowId
                });
            }
            this.toolPanelWindowId = null;
            this.toolPanelVisible = false;
            this.setStatus('道具パネルを閉じました');

            // 実身管理用JSONにパネル状態を保存
            this.updateWindowConfig({ panel: false });
        } else {
            // 道具パネルが閉じている場合は開く
            logger.debug('[FIGURE EDITOR] 道具パネルウィンドウを開きます');
            this.openToolPanelWindow();
            this.toolPanelVisible = true;
            this.setStatus('道具パネルを開きました');

            // 実身管理用JSONにパネル状態を保存
            this.updateWindowConfig({ panel: true });
        }
    }

    /**
     * パターン編集パネルからのメッセージを処理
     * @param {Object} data - メッセージデータ
     */
    handlePatternEditorMessage(data) {
        if (data.type === 'pattern-replaced') {
            // パターンが入替えられた
            const patternId = data.id;
            const patternData = data.data;
            const pixelColors = data.pixelColors || null;

            if (patternId !== undefined && patternId !== null && patternData && Array.isArray(patternData)) {
                // パターンID 0（透明、変更不可）の場合はID 1として登録
                const effectiveId = patternId < 1 ? 1 : Math.min(patternId, 127);

                // カスタムパターンテーブルに登録（pixelColors含む）
                this.customPatterns[effectiveId] = {
                    id: effectiveId,
                    type: 'pattern',
                    data: patternData,
                    pixelColors: pixelColors
                };

                // 現在の塗りパターンを更新
                this.fillPatternId = effectiveId;

                // 影響する図形を再描画
                this.redraw();
                this.isModified = true;

                // ツールパネルに更新を通知（パターンデータ・pixelColors・fillPatternId含む）
                this.sendToToolPanel({
                    type: 'patterns-updated',
                    patternId: effectiveId,
                    patternData: patternData,
                    pixelColors: pixelColors,
                    fillPatternId: effectiveId
                });

                // パターン編集パネルにも通知（開いている場合）
                const patternEditorWindowId = this.getChildPanelWindowId('pattern-editor');
                if (patternEditorWindowId) {
                    this.sendToChildPanel('pattern-editor', 'patterns-updated', {
                        patternId: effectiveId,
                        patternData: patternData,
                        pixelColors: pixelColors
                    });
                }
            }
        }
    }

    /**
     * 画材パネルからのメッセージを処理
     * @param {Object} data - メッセージデータ
     */
    handleMaterialPanelMessage(data) {
        switch (data.type) {
            case 'material-tool-selected':
                this.pixelmapTool = data.tool;
                logger.debug('[FIGURE EDITOR] 画材ツール変更:', this.pixelmapTool);
                // 道具パネルにも通知
                this.sendToToolPanel({
                    type: 'update-pixelmap-tool-selection',
                    tool: data.tool
                });
                break;
            case 'material-brush-size-changed':
                this.pixelmapBrushSize = data.brushSize;
                logger.debug('[FIGURE EDITOR] ブラシサイズ変更:', this.pixelmapBrushSize);
                break;
            case 'material-color-changed':
                this.strokeColor = data.color;
                logger.debug('[FIGURE EDITOR] 描画色変更:', this.strokeColor);
                break;
        }
    }

    /**
     * 道具パネルにメッセージを送信
     * @param {Object} message - メッセージデータ
     */
    sendToToolPanel(message) {
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                ...message,
                fromEditor: true
            }, '*');
        }
    }

    /**
     * 選択図形の属性をツールパネルに同期
     */
    syncSelectedShapeToToolPanel() {
        if (this.selectedShapes.length === 0) {
            // 選択解除時：エディタの現在設定を送信
            this.sendToToolPanel({
                type: 'sync-shape-attributes',
                attributes: {
                    fillColor: this.fillColor,
                    fillEnabled: this.fillEnabled,
                    fillPatternId: this.fillPatternId,
                    strokeColor: this.strokeColor,
                    lineWidth: this.lineWidth,
                    lineType: this.lineType,
                    lineConnectionType: this.lineConnectionType,
                    cornerRadius: this.cornerRadius,
                    arrowPosition: this.arrowPosition,
                    arrowType: this.arrowType
                },
                isShapeSelected: false
            });
            return;
        }

        // 最初の選択図形から属性を取得
        const shape = this.selectedShapes[0];

        // 矢印位置を導出
        let arrowPosition = 'none';
        if (shape.start_arrow === 1 && shape.end_arrow === 1) {
            arrowPosition = 'both';
        } else if (shape.start_arrow === 1) {
            arrowPosition = 'start';
        } else if (shape.end_arrow === 1) {
            arrowPosition = 'end';
        }

        // 塗りつぶし有効判定
        const fillEnabled = shape.fillColor && shape.fillColor !== 'transparent';

        this.sendToToolPanel({
            type: 'sync-shape-attributes',
            attributes: {
                fillColor: shape.fillColor || this.fillColor,
                fillEnabled: fillEnabled,
                fillPatternId: shape.fillPatternId || 0,
                strokeColor: shape.strokeColor || this.strokeColor,
                lineWidth: shape.lineWidth || this.lineWidth,
                lineType: shape.lineType !== undefined ? shape.lineType : this.lineType,
                lineConnectionType: shape.lineConnectionType || this.lineConnectionType,
                cornerRadius: shape.cornerRadius || 0,
                arrowPosition: arrowPosition,
                arrowType: shape.arrow_type || 'simple'
            },
            isShapeSelected: true
        });
    }

    /**
     * 子パネルが閉じられたときの処理
     * @param {string} panelType - パネルタイプ
     * @param {string} windowId - ウィンドウID
     */
    onChildPanelClosed(panelType, windowId) {
        if (panelType === 'material') {
            logger.debug('[FIGURE EDITOR] 画材パネルが閉じられました:', windowId);
        }
    }
};
