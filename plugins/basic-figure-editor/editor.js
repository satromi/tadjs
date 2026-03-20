/**
 * 基本図形編集プラグイン
 * TADファイルの図形セグメントを編集
 * @module BasicFigureEditor
 * @extends PluginBase
 * @license MIT
 * @author satromi
 * @version 1.0.0
 */
const logger = window.getLogger('BasicFigureEditor');

class BasicFigureEditor extends
    window.FigureXmlParserMixin(
    window.FigureXmlSerializerMixin(
    window.FigurePropertyApplierMixin(
    window.FigureConnectorMixin(
    window.FigureToolPanelMixin(
    window.FigureSelectionMixin(
    window.FigureClipboardMixin(
    window.FigureEventHandlerMixin(
    window.FigureVirtualObjectMixin(
    window.PluginBase))))))))) {
    constructor() {
        // 基底クラスのコンストラクタを呼び出し
        super('BasicFigureEditor');

        this.canvas = document.getElementById('figureCanvas');
        this.ctx = this.canvas.getContext('2d');

        // Canvas要素のz-index管理のため、positionをabsoluteに設定
        // これにより、仮身（DOM要素）とのz-order制御が可能になる
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        // width, height, backgroundはCSSの設定を維持（上書きしない）

        this.currentFile = null;
        this.tadData = null;
        // this.isFullscreen は PluginBase で初期化済み
        this.viewMode = 'canvas'; // 'canvas' or 'xml'
        // this.realId は基底クラスで定義済み
        this.isModified = false; // 編集状態フラグ
        this.originalContent = ''; // 保存時の内容
        // imagePathCallbacks, imagePathMessageId は PluginBase.getImageFilePath() に移行済み
        // this.iconData は PluginBase で初期化済み

        // 図形編集用のプロパティ
        this.currentTool = 'select'; // 現在選択中のツール
        this.shapes = []; // 描画された図形のリスト
        this.selectedShapes = []; // 選択中の図形
        // マーカー定義（JIS X 9051-84 16ドット用字形）
        this.markerDefinitions = new Map([
            [0, { id: 0, type: 0, size: 16, fgCol: '#000000', shape: 'dot' }],
            [1, { id: 1, type: 0, size: 16, fgCol: '#000000', shape: 'plus' }],
            [2, { id: 2, type: 0, size: 16, fgCol: '#000000', shape: 'star' }],
            [3, { id: 3, type: 0, size: 16, fgCol: '#000000', shape: 'circle' }],
            [4, { id: 4, type: 0, size: 16, fgCol: '#000000', shape: 'cross' }]
        ]);
        this.isDrawing = false;
        this.startX = 0;
        this.startY = 0;
        this.currentShape = null;
        this.currentPath = []; // フリーハンド描画用のパス
        this.isFirstPolygonLine = false; // 多角形の最初の線を描画中かどうか

        // コネクタ機能用のプロパティ
        this.connectorRadius = 3; // コネクタの表示半径(px)
        this.connectorSnapDistance = 5; // スナップ距離(px)
        this.connectorShowDistance = 15; // コネクタ表示距離(px)
        this.vobjConnectorShowDistance = 30; // 仮身用コネクタ表示距離(px)
        this.vobjConnectorSnapDistance = 25; // 仮身用スナップ距離(px)
        this.visibleConnectors = []; // 現在表示中のコネクタ情報 {shapeId, points: [{x, y, index}]}
        this.isDraggingLineEndpoint = false; // 線の端点をドラッグ中か
        this.draggedLineEndpoint = null; // ドラッグ中の線端点情報 {shape, endpoint: 'start'|'end'}
        this.lastMouseX = 0; // 最後のマウスX座標（コネクタ表示用）
        this.lastMouseY = 0; // 最後のマウスY座標（コネクタ表示用）

        // 図形移動用のプロパティ
        this.isDraggingShape = false;
        this.dragOffsets = []; // 各選択図形のドラッグ開始時のオフセット

        // 矩形選択用のプロパティ
        this.isRectangleSelecting = false;
        this.selectionRect = null; // { startX, startY, endX, endY }

        // リサイズプレビュー枠
        this.resizePreviewBox = null;

        // 描画設定
        this.strokeColor = '#000000';
        this.fillColor = '#ffffff';
        this.fillEnabled = true;
        this.fillPatternId = 0; // 0=ソリッド, 2-127=パターンID
        this.customPatterns = {}; // カスタムパターンテーブル（IDをキー）
        this.customMasks = {}; // カスタムマスク定義テーブル（IDをキー）
        this.initializeDefaultMasks();
        this.lineWidth = 2;
        this.lineType = 0; // 0:実線, 1:破線, 2:点線, 3:一点鎖線, 4:二点鎖線, 5:長破線
        this.linePattern = 'solid'; // 後方互換用 'solid', 'dotted', 'dashed'
        this.lineConnectionType = 'straight'; // 'straight', 'elbow', 'curve'
        this.cornerRadius = 0; // 角丸半径
        this.arrowPosition = 'none'; // 'none', 'start', 'end', 'both'
        this.arrowType = 'simple'; // 'simple', 'double', 'filled'
        this.bgColor = '#ffffff';

        // 道具パネル
        this.toolPanel = document.getElementById('toolPanel');
        this.toolPanelVisible = true;

        // クリップボード
        this.clipboard = [];

        // Undo/Redo スタック
        this.undoStack = [];
        this.redoStack = [];

        // 保護フラグ
        this.isProtected = false;

        // 用紙サイズ
        this.paperWidth = 210; // mm
        this.paperHeight = 297; // mm

        // パネル表示フラグ
        this.realSizePanelVisible = false;
        this.paperFrameVisible = false;

        // 道具パネルウィンドウ
        this.toolPanelWindow = null;
        this.toolPanelWindowId = null;

        // 道具パネルポップアップ状態
        this.toolPanelPopupOpen = false;

        // 格子点設定
        this.gridMode = 'none'; // 'none', 'show', 'snap'
        this.gridInterval = 16; // px

        // ズーム倍率
        this.zoomLevel = 1.0;

        // フォント設定（文字枠用）
        this.defaultFontSize = 16;
        this.defaultFontFamily = 'sans-serif';
        this.defaultTextColor = '#000000';

        // 編集中の文字枠
        this.editingTextBox = null;

        // ピクセルマップモード
        this.isPixelmapMode = false; // ピクセルマップモード状態
        this.editingPixelmap = null; // 編集中のピクセルマップ図形
        this.pixelmapTool = 'pencil'; // 現在のピクセルマップツール
        this.pixelmapBrushSize = 1; // ブラシサイズ（ピクセル単位）
        this.lastPixelmapX = null; // 前回描画座標X（線補間用）
        this.lastPixelmapY = null; // 前回描画座標Y（線補間用）

        // 変形モード（頂点編集）
        this.isTransformMode = false; // 変形モード中か
        this.transformingShape = null; // 変形中の図形
        this.transformVertices = []; // 変形ハンドル情報 [{x, y, type, index}]
        this.isDraggingVertex = false; // 頂点ドラッグ中か
        this.draggedVertexIndex = -1; // ドラッグ中の頂点インデックス
        this.vertexDragStartX = 0; // ドラッグ開始時の頂点X座標
        this.vertexDragStartY = 0; // ドラッグ開始時の頂点Y座標

        // 回転モード（Ctrl+リサイズハンドルドラッグ）
        this.isRotating = false; // 回転中フラグ
        this.rotationCenterX = 0; // 回転中心X
        this.rotationCenterY = 0; // 回転中心Y
        this.rotationStartAngle = 0; // ドラッグ開始時のマウス角度（ラジアン）
        this.rotationOriginals = []; // 各図形の元状態 [{shape, rotation, center, startX, startY, endX, endY, ...}]

        // ドラッグクールダウン（連続ドラッグ防止）
        this.dragCooldown = false;
        this.dragCooldownTimeout = null;

        // ダブルクリック+ドラッグ用の状態管理
        // PluginBaseで共通プロパティ（lastClickTime, isDblClickDragCandidate, isDblClickDrag, dblClickedElement, startX, startY）を初期化済み
        // プラグイン固有のプロパティのみ追加
        this.dblClickDragState.lastClickedShape = null;  // 最後にクリックされた図形
        this.dblClickDragState.dblClickedShape = null;   // ダブルクリックされた図形
        this.dblClickDragState.previewElement = null;    // ドラッグ中のプレビュー要素

        // 通常のドラッグ用の状態管理はPluginBase.virtualObjectDragStateを使用

        // ユーザ環境設定（選択枠）
        this.selectionWidth = 2; // 選択枠太さ
        this.selectionBlinkInterval = 600; // 選択枠チラつき間隔(ms)
        this.selectionBlinkState = true; // 選択枠の表示状態
        this.lastBlinkTime = 0; // 最後の点滅切り替え時刻
        this.animationFrameId = null; // アニメーションフレームID

        // MessageBusはPluginBaseで初期化済み

        // 埋め込みモード検出（text-editor内のfigure-segment表示用）
        const urlParams = new URLSearchParams(window.location.search);
        this.embeddedMode = urlParams.get('embedded') === 'true';
        if (this.embeddedMode) {
            this.readonly = true;
            this.toolPanelVisible = false;
            document.body.style.overflow = 'hidden';
            document.body.classList.add('readonly-mode');
        }

        this.init();
    }

    /**
     * MessageBusのハンドラを登録
     * 親ウィンドウからのメッセージを受信して処理
     */
    setupMessageBusHandlers() {
        // init メッセージ
        this.messageBus.on('init', (data) => {
            logger.debug('[FIGURE EDITOR] [MessageBus] init受信');

            // 共通初期化処理（windowId設定、realId設定、背景色復元）
            this.handleInitData(data);
            logger.debug('[FIGURE EDITOR] [MessageBus] windowId更新:', this.windowId);

            // 全画面表示状態を復元
            if (data.fileData && data.fileData.realObject && data.fileData.realObject.window) {
                this.isFullscreen = data.fileData.realObject.window.maximize || false;
                logger.debug('[FIGURE EDITOR] [MessageBus] 全画面表示状態を復元:', this.isFullscreen);

                // 道具パネル位置を復元
                if (data.fileData.realObject.window.panelpos) {
                    this.panelpos = data.fileData.realObject.window.panelpos;
                    logger.debug('[FIGURE EDITOR] [MessageBus] 道具パネル位置を復元:', this.panelpos);
                }

                // 道具パネル表示状態を復元
                if (data.fileData.realObject.window.panel !== undefined) {
                    this.toolPanelVisible = data.fileData.realObject.window.panel;
                    logger.debug('[FIGURE EDITOR] [MessageBus] 道具パネル表示状態を復元:', this.toolPanelVisible);
                }

                // ズーム倍率を復元
                if (data.fileData.realObject.window.zoomratio !== undefined) {
                    this.zoomLevel = data.fileData.realObject.window.zoomratio;
                }
            }

            this.loadFile(data.fileData);

            // ファイル読み込み後に道具パネルの表示状態に従って開く
            setTimeout(() => {
                if (this.toolPanelVisible) {
                    this.openToolPanelWindow();
                }
            }, 500);

            // スクロール位置を復元（DOM更新完了を待つ）
            if (data.fileData && data.fileData.windowConfig && data.fileData.windowConfig.scrollPos) {
                setTimeout(() => {
                    this.setScrollPosition(data.fileData.windowConfig.scrollPos);
                }, 200);
            }
        });

        // 共通MessageBusハンドラを登録（PluginBaseで定義）
        // window-moved, window-resized-end, window-maximize-toggled,
        // menu-action, get-menu-definition, window-close-request
        this.setupCommonMessageBusHandlers();

        // update-vobj-scroll メッセージ（ウィンドウ閉じた時の仮身スクロール位置更新）
        this.messageBus.on('update-vobj-scroll', (data) => {
            if (!data.vobjid || !this.shapes) return;
            const shape = this.shapes.find(s => s.virtualObject && s.virtualObject.vobjid === data.vobjid);
            if (shape) {
                if (data.scrollx !== undefined) shape.virtualObject.scrollx = data.scrollx;
                if (data.scrolly !== undefined) shape.virtualObject.scrolly = data.scrolly;
                if (data.zoomratio !== undefined) shape.virtualObject.zoomratio = data.zoomratio;
                this.saveFile();
            }
        });

        // scroll メッセージ
        this.messageBus.on('scroll', (data) => {
            logger.debug('[FIGURE EDITOR] [MessageBus] scroll受信:', data);
            this.handleScroll(data.scrollLeft, data.scrollTop);
        });

        // input-dialog-response / message-dialog-response は MessageBus が自動処理するためハンドラ不要

        // ===== 道具パネル関連メッセージ =====

        // tool-panel-window-created メッセージ
        this.messageBus.on('tool-panel-window-created', (data) => {
            logger.debug('[FIGURE EDITOR] [MessageBus] 道具パネルウィンドウ作成完了:', data.windowId);
            this.toolPanelWindowId = data.windowId;
        });

        // tool-panel-window-moved メッセージ
        this.messageBus.on('tool-panel-window-moved', (data) => {
            logger.debug('[FIGURE EDITOR] [MessageBus] tool-panel-window-moved受信:', data.pos);
            this.updatePanelPosition(data.pos);
        });

        // select-tool メッセージ
        this.messageBus.on('select-tool', (data) => {
            this.selectTool(data.tool);
            this.currentTool = data.tool;
        });

        // update-fill-color メッセージ
        this.messageBus.on('update-fill-color', (data) => {
            this.fillColor = data.fillColor;
            this.applyFillColorToSelected(data.fillColor);
        });

        // update-fill-enabled メッセージ
        this.messageBus.on('update-fill-enabled', (data) => {
            this.fillEnabled = data.fillEnabled;
            this.applyFillEnabledToSelected(data.fillEnabled);
        });

        // update-fill-pattern メッセージ
        this.messageBus.on('update-fill-pattern', (data) => {
            this.fillPatternId = data.patternId;
            this.applyFillPatternToSelected(data.patternId);
        });

        // open-pattern-editor メッセージ
        this.messageBus.on('open-pattern-editor', (data) => {
            this.openPatternEditorPanel(data.currentPatternId);
        });

        // update-stroke-color メッセージ
        this.messageBus.on('update-stroke-color', (data) => {
            logger.debug('[FIGURE EDITOR] update-stroke-color受信:', data.strokeColor, '選択図形数:', this.selectedShapes.length);
            this.strokeColor = data.strokeColor;
            this.applyStrokeColorToSelected(data.strokeColor);
        });

        // update-line-width メッセージ
        this.messageBus.on('update-line-width', (data) => {
            this.lineWidth = data.lineWidth;
            this.applyLineWidthToSelected(data.lineWidth);
        });

        // update-line-pattern メッセージ（後方互換）
        this.messageBus.on('update-line-pattern', (data) => {
            this.linePattern = data.linePattern;
            // linePatternからlineTypeに変換
            this.lineType = this.linePatternToLineType(data.linePattern);
            this.applyLineTypeToSelected(this.lineType);
        });

        // update-line-type メッセージ
        this.messageBus.on('update-line-type', (data) => {
            this.lineType = data.lineType;
            // lineTypeからlinePatternに変換（後方互換）
            const patternMapping = { 0: 'solid', 1: 'dashed', 2: 'dotted' };
            this.linePattern = patternMapping[data.lineType] || 'solid';
            this.applyLineTypeToSelected(data.lineType);
        });

        // update-line-connection-type メッセージ
        this.messageBus.on('update-line-connection-type', (data) => {
            this.lineConnectionType = data.lineConnectionType;
            this.applyLineConnectionTypeToSelected(data.lineConnectionType);
        });

        // update-corner-radius メッセージ
        this.messageBus.on('update-corner-radius', (data) => {
            this.cornerRadius = data.cornerRadius;
            this.applyCornerRadiusToSelected(data.cornerRadius);
        });

        // update-arrow-position メッセージ
        this.messageBus.on('update-arrow-position', (data) => {
            this.arrowPosition = data.arrowPosition;
            this.applyArrowPositionToSelected(data.arrowPosition);
        });

        // update-arrow-type メッセージ
        this.messageBus.on('update-arrow-type', (data) => {
            this.arrowType = data.arrowType;
            this.applyArrowTypeToSelected(data.arrowType);
        });

        // update-grid-mode メッセージ
        this.messageBus.on('update-grid-mode', (data) => {
            this.gridMode = data.gridMode;
            this.redraw();
        });

        // update-grid-interval メッセージ
        this.messageBus.on('update-grid-interval', (data) => {
            this.gridInterval = data.gridInterval;
            this.redraw();
        });

        // update-zoom-level メッセージ
        this.messageBus.on('update-zoom-level', (data) => {
            const oldZoom = this.zoomLevel;
            this.zoomLevel = data.zoomLevel;
            this.resizeCanvas();
            this.adjustScrollForZoom(oldZoom, this.zoomLevel);
            this.updateVobjPositionsForZoom();
            this.updateWindowConfig({ zoomratio: this.zoomLevel });
        });

        // update-pixelmap-tool メッセージ
        this.messageBus.on('update-pixelmap-tool', (data) => {
            this.pixelmapTool = data.pixelmapTool;
            logger.debug('[FIGURE EDITOR] [MessageBus] ピクセルマップツール変更:', this.pixelmapTool);
        });

        // update-pixelmap-brush-size メッセージ
        this.messageBus.on('update-pixelmap-brush-size', (data) => {
            this.pixelmapBrushSize = data.pixelmapBrushSize;
            logger.debug('[FIGURE EDITOR] [MessageBus] ブラシサイズ変更:', this.pixelmapBrushSize);
        });

        // ===== 画材パネル関連メッセージ =====

        // request-open-material-panel メッセージ（道具パネルから）- トグル動作
        this.messageBus.on('request-open-material-panel', async (data) => {
            const existingWindowId = this.getChildPanelWindowId('material');
            if (existingWindowId) {
                this.closeChildPanelWindow('material');
            } else {
                await this.openMaterialPanel(data.x, data.y);
            }
        });

        // update-font-size メッセージ
        this.messageBus.on('update-font-size', (data) => {
            this.defaultFontSize = data.fontSize;
            if (this.textEditorElement) {
                this.applyFormatToSelection('fontSize', data.fontSize + 'px');
            } else {
                this.applyFontSizeToSelected(data.fontSize);
            }
        });

        // update-font-family メッセージ
        this.messageBus.on('update-font-family', (data) => {
            this.defaultFontFamily = data.fontFamily;
            if (this.textEditorElement) {
                this.applyFormatToSelection('fontFamily', data.fontFamily);
            } else {
                this.applyFontFamilyToSelected(data.fontFamily);
            }
        });

        // update-text-color メッセージ
        this.messageBus.on('update-text-color', (data) => {
            this.defaultTextColor = data.textColor;
            if (this.textEditorElement) {
                this.applyFormatToSelection('color', data.textColor);
            } else {
                this.applyTextColorToSelected(data.textColor);
            }
        });

        // update-text-decoration メッセージ
        this.messageBus.on('update-text-decoration', (data) => {
            if (this.textEditorElement) {
                this.applyTextDecorationToSelection(data.decoration, data.enabled);
            } else {
                this.applyTextDecorationToSelected(data.decoration, data.enabled);
            }
        });

        // get-current-font-settings メッセージ
        this.messageBus.on('get-current-font-settings', () => {
            this.sendCurrentFontSettings();
        });

        // ===== ウィンドウ管理関連メッセージ =====

        // window-opened メッセージ
        this.messageBus.on('window-opened', (data) => {
            logger.debug('[FIGURE EDITOR] [MessageBus] window-opened受信, windowId:', data.windowId);
            // このイベントは各メッセージハンドラーで個別に処理されます
        });

        // window-closed メッセージ
        this.messageBus.on('window-closed', (data) => {
            logger.debug('[FIGURE EDITOR] [MessageBus] window-closed受信, windowId:', data.windowId);
            // openedRealObjectsから削除
            for (const [realId, windowId] of this.openedRealObjects.entries()) {
                if (windowId === data.windowId || (windowId && windowId.windowId === data.windowId)) {
                    this.openedRealObjects.delete(realId);
                    logger.debug('[FIGURE EDITOR] [MessageBus] 実身ウィンドウを追跡から削除:', realId);
                    break;
                }
            }
            // 道具パネルウィンドウが閉じられた場合
            if (data.windowId === this.toolPanelWindowId) {
                this.toolPanelWindowId = null;
                logger.debug('[FIGURE EDITOR] [MessageBus] 道具パネルウィンドウIDをクリア');
            }
        });

        // ===== ドラッグ＆ドロップ関連メッセージ =====

        // check-window-id メッセージ
        this.messageBus.on('check-window-id', (data) => {
            // 親ウィンドウからwindowIdチェック要求
            if (data.targetWindowId === this.windowId) {
                logger.debug('[FIGURE EDITOR] [MessageBus] check-window-id一致、ドロップ成功として処理');
                // 自分宛のメッセージなので、cross-window-drop-successとして処理
                if (this.isDraggingVirtualObjectShape && this.draggingVirtualObjectShape) {
                    const shape = this.draggingVirtualObjectShape;
                    const dragMode = this.virtualObjectDragState.dragMode;

                    logger.debug(`[FIGURE EDITOR] ドロップ成功（モード: ${dragMode}）:`, shape.virtualObject.link_name);

                    // タイムアウトをキャンセル
                    if (this.virtualObjectDragTimeout) {
                        clearTimeout(this.virtualObjectDragTimeout);
                        this.virtualObjectDragTimeout = null;
                    }

                    // 移動モードの場合のみ元の仮身を削除
                    if (dragMode === 'move') {
                        // 選択中の仮身を取得
                        const selectedVirtualObjectShapes = this.selectedShapes.filter(s => s.type === 'vobj');
                        const shapesToDelete = selectedVirtualObjectShapes.includes(shape)
                            ? selectedVirtualObjectShapes
                            : [shape];

                        logger.debug('[FIGURE EDITOR] 移動モード: ', shapesToDelete.length, '個の仮身を削除');

                        // 共通メソッドで仮身を削除
                        this.deleteVirtualObjectShapes(shapesToDelete);
                    } else {
                        logger.debug('[FIGURE EDITOR] コピーモード: 元の仮身を保持');
                    }

                    // フラグをリセット
                    this.isDraggingVirtualObjectShape = false;
                    this.draggingVirtualObjectShape = null;
                }
            }
        });

        // cross-window-drop-success ハンドラはPluginBaseの共通機能に移行
        // onDeleteSourceVirtualObject()とonCrossWindowDropSuccess()フックで処理を実装
        this.setupCrossWindowDropSuccessHandler();

        // ===== データ読み込み関連メッセージ =====

        // load-data メッセージ
        this.messageBus.on('load-data', (data) => {
            logger.debug('[FIGURE EDITOR] [MessageBus] load-data受信:', data);

            // readonlyモードの設定
            if (data.readonly) {
                this.readonly = true;
                document.body.classList.add('readonly-mode');
                logger.debug('[FIGURE EDITOR] [MessageBus] 読み取り専用モードを適用');
            }

            // noScrollbarモードの設定
            if (data.noScrollbar) {
                document.body.style.overflow = 'hidden';
                logger.debug('[FIGURE EDITOR] [MessageBus] スクロールバー非表示モードを適用');
            }

            // 実身データを読み込む
            const realObject = data.realObject;
            if (realObject) {
                // 実身IDを設定
                this.realId = this.extractRealId(data.realId);
                logger.debug('[FIGURE EDITOR] [MessageBus] fileId設定:', this.realId);

                // データを読み込む
                this.loadFile({
                    realId: data.realId,
                    xmlData: realObject.xtad || realObject.records?.[0]?.xtad || realObject.xmlData
                });
            }
        });

        // load-virtual-object メッセージ
        this.messageBus.on('load-virtual-object', async (data) => {
            logger.debug('[FIGURE EDITOR] [MessageBus] load-virtual-object受信:', data);

            // readonlyモードの設定
            if (data.readonly) {
                this.readonly = true;
                document.body.classList.add('readonly-mode');
                logger.debug('[FIGURE EDITOR] [MessageBus] 読み取り専用モードを適用');
            }

            // noScrollbarモードの設定
            if (data.noScrollbar) {
                document.body.style.overflow = 'hidden';
                logger.debug('[FIGURE EDITOR] [MessageBus] スクロールバー非表示モードを適用');
            }

            // 背景色の設定
            if (data.bgcol) {
                this.applyBackgroundColor(data.bgcol);
            }

            // 実身データを読み込む
            const realObject = data.realObject;
            if (realObject) {
                // virtualObjからrealIdを取得
                const virtualObj = data.virtualObj;
                if (virtualObj?.link_id) {
                    this.realId = this.extractRealId(virtualObj.link_id);
                    logger.debug('[FIGURE EDITOR] [MessageBus] fileId設定:', this.realId);
                }

                // データを読み込む（完了を待つ）
                await this.loadFile({
                    realId: this.realId,
                    xmlData: realObject.xtad || realObject.records?.[0]?.xtad || realObject.xmlData
                });

                // スクロール位置を復元（DOM更新完了を待つ）
                // data.scrollPos（仮身ごとの設定）を優先、フォールバックとしてwindowConfig.scrollPos
                const windowConfig = realObject.metadata?.window;
                const scrollPos = data.scrollPos || (windowConfig && windowConfig.scrollPos);
                if (scrollPos) {
                    setTimeout(() => {
                        this.setScrollPosition(scrollPos);
                    }, 200);
                }
            }
        });

        // add-virtual-object-from-base メッセージ
        this.messageBus.on('add-virtual-object-from-base', (data) => {
            logger.debug('[FIGURE EDITOR] [MessageBus] 原紙箱から仮身追加:', data.realId, data.name);
            this.addVirtualObjectFromRealId(data.realId, data.name, data.dropPosition, data.applist);
        });

        // ===== その他のメッセージ =====

        // 開いた仮身内プラグインとのメッセージ転送（PluginBase共通メソッド）
        this.setupChildIframeMessageForwarding({
            forwardToParent: ['load-data-file-request', 'get-image-file-path'],
            forwardToChildren: ['load-data-file-response', 'image-file-path-response']
        });

        // user-config-updated メッセージ
        this.messageBus.on('user-config-updated', () => {
            logger.debug('[FIGURE EDITOR] [MessageBus] ユーザ環境設定更新通知を受信');
            this.loadUserConfig();
        });

        logger.debug('[FIGURE EDITOR] MessageBusハンドラ登録完了');
    }

    init() {
        // 共通コンポーネントの初期化
        this.initializeCommonComponents('[FIGURE EDITOR]');

        // パフォーマンス最適化関数の初期化
        if (window.throttleRAF && window.debounce) {
            // redrawのスロットル版（60FPS制限）
            this.throttledRedraw = window.throttleRAF(() => {
                this.redrawImmediate();
            });

            // handleMouseMoveのスロットル版（60FPS制限）
            this.throttledHandleMouseMove = window.throttleRAF((e) => {
                this.handleMouseMove(e);
            });

            // スクロールバー更新のデバウンス版
            this.debouncedNotifyScrollbarUpdate = window.debounce(() => {
                this.notifyScrollbarUpdateImmediate();
            }, 300);

            logger.debug('[FIGURE EDITOR] Performance optimization initialized');
        }

        // ユーザ環境設定を読み込み
        this.loadUserConfig();

        this.setupCanvas();
        this.setupEventListeners();
        this.setupContextMenu();
        this.setupWindowActivation();

        // スクロール通知初期化（MessageBus経由で親ウィンドウにスクロール状態を通知）
        this.initScrollNotification();

        this.setupGlobalMouseHandlers();
        this.setupVirtualObjectRightButtonHandlers();

        // 選択枠点滅アニメーション開始
        this.startSelectionBlinkAnimation();

        // MessageBusのハンドラを登録
        if (this.messageBus) {
            this.setupMessageBusHandlers();
        }

        logger.debug('[基本図形編集] 準備完了');
    }

    /**
     * ユーザ環境設定を読み込み
     */
    loadUserConfig() {
        // CSS変数から選択枠太さを読み取り
        const selectionWidth = parseInt(getComputedStyle(document.documentElement)
            .getPropertyValue('--selection-width')) || 2;
        this.selectionWidth = selectionWidth;

        // CSS変数から選択枠チラつき間隔を読み取り
        const selectionBlinkInterval = parseInt(getComputedStyle(document.documentElement)
            .getPropertyValue('--selection-blink-interval')) || 600;
        this.selectionBlinkInterval = selectionBlinkInterval;

        logger.debug('[FIGURE EDITOR] ユーザ環境設定読み込み:', {
            selectionWidth: this.selectionWidth,
            selectionBlinkInterval: this.selectionBlinkInterval
        });
    }

    /**
     * 選択枠点滅アニメーション開始
     */
    startSelectionBlinkAnimation() {
        const animate = (currentTime) => {
            // 前回の点滅切り替えからの経過時間をチェック
            if (currentTime - this.lastBlinkTime >= this.selectionBlinkInterval) {
                this.selectionBlinkState = !this.selectionBlinkState;
                this.lastBlinkTime = currentTime;

                // 選択中の図形がある場合のみ再描画
                // 注意: 仮身を再作成しない軽量版の再描画を使用
                if (this.selectedShapes.length > 0) {
                    this.redrawForSelectionBlink();
                }
            }

            // アニメーション継続
            this.animationFrameId = requestAnimationFrame(animate);
        };

        // アニメーション開始
        this.animationFrameId = requestAnimationFrame(animate);
        logger.debug('[FIGURE EDITOR] 選択枠点滅アニメーション開始');
    }

    setupCanvas() {
        // Canvasのサイズを設定
        this.resizeCanvas();

        // 背景色を設定
        this.ctx.fillStyle = this.bgColor;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    /**
     * ウィンドウリサイズ完了時のフック（PluginBase共通ハンドラから呼ばれる）
     * @param {Object} data - リサイズデータ { pos, width, height }
     */
    onWindowResizedEnd(data) {
        this.resizeCanvas();
    }

    /**
     * ウィンドウ最大化切り替え時のフック（PluginBase共通ハンドラから呼ばれる）
     * @param {Object} data - 最大化データ { pos, width, height, maximize }
     */
    onWindowMaximizeToggled(data) {
        // 全画面表示状態を同期
        this.isFullscreen = data.maximize;
        logger.debug('[FIGURE EDITOR] 全画面表示状態を同期:', this.isFullscreen);
        this.resizeCanvas();
    }

    resizeCanvas() {
        const container = document.querySelector('.plugin-content');
        if (container) {
            let finalWidth, finalHeight;

            if (this.embeddedMode && this.figView) {
                // 埋め込みモード: figView寸法をそのまま使用（min 800x600制約なし、zoomLevel=1固定）
                finalWidth = (this.figView.right - this.figView.left) || 200;
                finalHeight = (this.figView.bottom - this.figView.top) || 200;
            } else {
                // 通常モード: コンテンツサイズとウィンドウサイズの大きい方、最小サイズも保証
                const contentSize = this.calculateContentSize();
                const windowWidth = container.clientWidth || 800;
                const windowHeight = container.clientHeight || 600;
                // 論理サイズ: ウィンドウサイズをzoomLevelで割って論理座標空間に変換
                const logicalWidth = Math.max(contentSize.width, windowWidth / this.zoomLevel, 800);
                const logicalHeight = Math.max(contentSize.height, windowHeight / this.zoomLevel, 600);
                // 物理サイズ: 論理サイズ × zoomLevel
                finalWidth = Math.ceil(logicalWidth * this.zoomLevel);
                finalHeight = Math.ceil(logicalHeight * this.zoomLevel);
            }

            this.canvas.width = finalWidth;
            this.canvas.height = finalHeight;

            // キャンバスのCSSサイズを描画バッファサイズと同じに設定
            // これにより、描画可能領域と表示領域が一致します
            this.canvas.style.width = finalWidth + 'px';
            this.canvas.style.height = finalHeight + 'px';

            logger.debug('[FIGURE EDITOR] キャンバスサイズ更新:', finalWidth, 'x', finalHeight);

            this.redraw();

            // スクロールバー更新を通知
            this.notifyScrollbarUpdate();
        }
    }

    /**
     * コンテンツサイズを計算
     */
    calculateContentSize() {
        // マージン
        const MARGIN = 50;

        // 図形が無い場合は最小サイズを返す（十分な描画領域を確保）
        if (this.shapes.length === 0) {
            return {
                width: 800,
                height: 600
            };
        }

        // すべての図形の範囲を計算
        let maxRight = 0;
        let maxBottom = 0;

        this.shapes.forEach(shape => {
            let right = 0;
            let bottom = 0;

            if (shape.type === 'rect' || shape.type === 'document' || shape.type === 'vobj' || shape.type === 'image' || shape.type === 'pixelmap') {
                // startX, startY, endX, endY を使う図形
                right = Math.max(shape.startX || 0, shape.endX || 0);
                bottom = Math.max(shape.startY || 0, shape.endY || 0);
            } else if (shape.type === 'circle') {
                // 円: x, y, radius
                right = (shape.x || 0) + (shape.radius || 0) * 2;
                bottom = (shape.y || 0) + (shape.radius || 0) * 2;
            } else if (shape.type === 'ellipse') {
                // 楕円: x, y, radiusX, radiusY
                right = (shape.x || 0) + (shape.radiusX || 0) * 2;
                bottom = (shape.y || 0) + (shape.radiusY || 0) * 2;
            } else if (shape.type === 'line') {
                right = Math.max(shape.startX || 0, shape.endX || 0);
                bottom = Math.max(shape.startY || 0, shape.endY || 0);
            } else if (shape.type === 'polygon' || shape.type === 'polyline' || shape.type === 'spline' || shape.type === 'curve') {
                // ポリゴン/ポリライン: points配列
                if (shape.points && shape.points.length > 0) {
                    shape.points.forEach(point => {
                        right = Math.max(right, point.x || 0);
                        bottom = Math.max(bottom, point.y || 0);
                    });
                }
            } else if (shape.type === 'arc' || shape.type === 'chord' || shape.type === 'elliptical_arc') {
                // 弧: x, y, radius (または radiusX, radiusY)
                const rx = shape.radiusX || shape.radius || 0;
                const ry = shape.radiusY || shape.radius || 0;
                right = (shape.x || 0) + rx;
                bottom = (shape.y || 0) + ry;
            }

            maxRight = Math.max(maxRight, right);
            maxBottom = Math.max(maxBottom, bottom);
        });

        // マージンを追加
        const contentWidth = maxRight + MARGIN;
        const contentHeight = maxBottom + MARGIN;

        return {
            width: contentWidth,
            height: contentHeight
        };
    }

    /**
     * スクロールバー更新通知（通常はデバウンス版を使用）
     */
    notifyScrollbarUpdate() {
        // デバウンス版が利用可能ならそれを使用
        if (this.debouncedNotifyScrollbarUpdate) {
            this.debouncedNotifyScrollbarUpdate();
        } else {
            // フォールバック: 即座に実行
            this.notifyScrollbarUpdateImmediate();
        }
    }

    /**
     * スクロールバー更新通知（即座実行版）
     */
    notifyScrollbarUpdateImmediate() {
        this.notifyScrollChange();
    }

    /**
     * 線種パターンを適用（後方互換性のため残す）
     * @param {string} pattern - 'solid', 'dashed', 'dotted'
     * @deprecated applyLineType()を使用してください
     */
    applyLinePattern(pattern) {
        // PluginBaseのメソッドを使用（文字列からlineTypeへの変換を自動で行う）
        this.applyLineTypeToCanvas(this.ctx, pattern);
    }

    /**
     * 線種（lineType）をCanvasに適用
     * @param {number|string} lineType - 線種（0-5 または 'solid'/'dashed'/'dotted'）
     */
    applyLineType(lineType) {
        this.applyLineTypeToCanvas(this.ctx, lineType);
    }

    /**
     * 角丸長方形を描画
     */
    drawRoundedRect(x, y, width, height, radius, fillEnabled, lineWidth) {
        // 角丸半径を幅と高さの半分に制限（GeometryUtilsを使用）
        const effectiveRadius = window.GeometryUtils
            ? window.GeometryUtils.limitCornerRadius(radius, width, height)
            : Math.min(radius, Math.min(Math.abs(width) / 2, Math.abs(height) / 2));

        this.ctx.beginPath();
        this.ctx.moveTo(x + effectiveRadius, y);
        this.ctx.lineTo(x + width - effectiveRadius, y);
        this.ctx.arcTo(x + width, y, x + width, y + effectiveRadius, effectiveRadius);
        this.ctx.lineTo(x + width, y + height - effectiveRadius);
        this.ctx.arcTo(x + width, y + height, x + width - effectiveRadius, y + height, effectiveRadius);
        this.ctx.lineTo(x + effectiveRadius, y + height);
        this.ctx.arcTo(x, y + height, x, y + height - effectiveRadius, effectiveRadius);
        this.ctx.lineTo(x, y + effectiveRadius);
        this.ctx.arcTo(x, y, x + effectiveRadius, y, effectiveRadius);
        this.ctx.closePath();
        const shouldFill = fillEnabled !== undefined ? fillEnabled : true;
        if (shouldFill) {
            this.ctx.fill();
        }
        if (lineWidth === undefined || lineWidth > 0) {
            this.ctx.stroke();
        }
    }

    /**
     * 角丸多角形を描画
     */
    drawRoundedPolygon(points, radius, fillEnabled) {
        if (points.length < 3) return;

        this.ctx.beginPath();

        for (let i = 0; i < points.length; i++) {
            const p1 = points[i];
            const p2 = points[(i + 1) % points.length];
            const p0 = points[(i - 1 + points.length) % points.length];

            // 頂点への方向ベクトルを計算
            const dx1 = p1.x - p0.x;
            const dy1 = p1.y - p0.y;
            const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);

            const dx2 = p2.x - p1.x;
            const dy2 = p2.y - p1.y;
            const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);

            // 正規化
            const nx1 = dx1 / len1;
            const ny1 = dy1 / len1;
            const nx2 = dx2 / len2;
            const ny2 = dy2 / len2;

            // 角丸の開始点と終了点
            const offset = Math.min(radius, len1 / 2, len2 / 2);
            const startX = p1.x - nx1 * offset;
            const startY = p1.y - ny1 * offset;
            const endX = p1.x + nx2 * offset;
            const endY = p1.y + ny2 * offset;

            if (i === 0) {
                this.ctx.moveTo(startX, startY);
            } else {
                this.ctx.lineTo(startX, startY);
            }

            this.ctx.arcTo(p1.x, p1.y, endX, endY, offset);
        }

        this.ctx.closePath();
        const shouldFill = fillEnabled !== undefined ? fillEnabled : true;
        if (shouldFill) {
            this.ctx.fill();
        }
        this.ctx.stroke();
    }


    enterTextEditMode(shape) {
        // 編集中の文字枠を記録
        this.editingTextBox = shape;

        // contenteditable divを使用してリッチテキスト編集を実現
        const editor = document.createElement('div');
        editor.id = 'textbox-editor';
        editor.contentEditable = true;

        // 既存のコンテンツを設定（HTMLとして）
        if (shape.richContent) {
            // DOMParserでサニタイズ: script/style/イベント属性を安全に除去
            const sanitized = this.sanitizeHtml(shape.richContent);
            editor.innerHTML = sanitized;
        } else {
            editor.textContent = shape.content || '';
        }

        const minX = Math.min(shape.startX, shape.endX);
        const minY = Math.min(shape.startY, shape.endY);
        const width = Math.abs(shape.endX - shape.startX);
        const height = Math.abs(shape.endY - shape.startY);
        // 論理座標を物理座標に変換してDOM配置
        const pos = this.logicalToPhysical(minX, minY);
        const size = this.logicalToPhysical(width, height);

        editor.style.position = 'absolute';
        editor.style.left = `${pos.x}px`;
        editor.style.top = `${pos.y}px`;
        editor.style.width = `${size.x}px`;
        editor.style.height = `${size.y}px`;
        editor.style.fontSize = `${shape.fontSize * this.zoomLevel}px`;
        editor.style.fontFamily = shape.fontFamily;
        editor.style.color = shape.textColor;
        editor.style.border = '2px solid #ff8f00';
        editor.style.backgroundColor = 'rgba(255, 255, 255, 0.9)';
        editor.style.padding = '5px';
        editor.style.overflow = 'auto';
        editor.style.zIndex = '1000';
        editor.style.outline = 'none';
        editor.style.whiteSpace = 'pre-wrap';
        editor.style.overflowWrap = 'break-word';

        this.canvas.parentElement.appendChild(editor);
        editor.focus();

        // 編集完了
        const finishEdit = () => {
            // リッチコンテンツとプレーンテキストを保存
            shape.richContent = editor.innerHTML;
            shape.content = editor.textContent || editor.innerText;

            editor.remove();
            this.editingTextBox = null;
            this.textEditorElement = null;
            this.redraw();
            this.isModified = true;
            this.saveStateForUndo();
        };

        editor.addEventListener('blur', finishEdit);
        editor.addEventListener('keydown', (e) => {
            // システムショートカット（Ctrl+E, Ctrl+S, Ctrl+L等）は伝播させる
            if (e.ctrlKey && ['e', 's', 'l', 'o'].includes(e.key.toLowerCase())) {
                // Document levelのハンドラで処理するため伝播させる
                return;
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                finishEdit();
            }
            e.stopPropagation();
        });

        // フォント設定変更を受信するためのリスナーを保持
        this.textEditorElement = editor;
    }

    /**
     * 選択範囲にCSSスタイルを適用
     * @param {string} styleName - CSSスタイル名（例：'fontSize', 'fontFamily', 'color'）
     * @param {string} value - 適用する値
     */
    applyFormatToSelection(styleName, value) {
        if (!this.textEditorElement) {
            logger.warn('[EDITOR] テキストエディタが開いていません');
            return;
        }

        const selection = window.getSelection();
        if (!selection.rangeCount) {
            logger.warn('[EDITOR] 選択範囲がありません');
            return;
        }

        const range = selection.getRangeAt(0);

        // 選択範囲が空の場合は全体に適用
        if (range.collapsed) {
            this.textEditorElement.style[styleName] = value;
            logger.debug(`[EDITOR] テキスト全体に ${styleName}=${value} を適用`);
            return;
        }

        // 選択範囲のコンテンツを取得
        const selectedContent = range.extractContents();

        // スタイルを適用したspanで包む
        const span = document.createElement('span');
        span.style[styleName] = value;
        span.appendChild(selectedContent);

        // 範囲に挿入
        range.insertNode(span);

        // 選択範囲を復元
        selection.removeAllRanges();
        const newRange = document.createRange();
        newRange.selectNodeContents(span);
        selection.addRange(newRange);

        logger.debug(`[EDITOR] 選択範囲に ${styleName}=${value} を適用`);
    }

    /**
     * 選択範囲にテキスト装飾を適用
     * @param {string} decoration - 装飾タイプ（'bold', 'italic', 'underline', 'strikethrough'）
     * @param {boolean} enabled - 有効/無効
     */
    applyTextDecorationToSelection(decoration, enabled) {
        if (!this.textEditorElement) {
            logger.warn('[EDITOR] テキストエディタが開いていません');
            return;
        }

        const selection = window.getSelection();
        if (!selection.rangeCount) {
            logger.warn('[EDITOR] 選択範囲がありません');
            return;
        }

        const range = selection.getRangeAt(0);

        // 選択範囲が空の場合は全体に適用
        if (range.collapsed) {
            this.applyDecorationToElement(this.textEditorElement, decoration, enabled);
            logger.debug(`[EDITOR] テキスト全体に ${decoration}=${enabled} を適用`);
            return;
        }

        // 選択範囲のコンテンツを取得
        const selectedContent = range.extractContents();

        // 装飾を適用したspanで包む
        const span = document.createElement('span');
        this.applyDecorationToElement(span, decoration, enabled);
        span.appendChild(selectedContent);

        // 範囲に挿入
        range.insertNode(span);

        // 選択範囲を復元
        selection.removeAllRanges();
        const newRange = document.createRange();
        newRange.selectNodeContents(span);
        selection.addRange(newRange);

        logger.debug(`[EDITOR] 選択範囲に ${decoration}=${enabled} を適用`);
    }

    /**
     * 要素に装飾スタイルを適用
     * @param {HTMLElement} element - 対象要素
     * @param {string} decoration - 装飾タイプ
     * @param {boolean} enabled - 有効/無効
     */
    applyDecorationToElement(element, decoration, enabled) {
        switch (decoration) {
            case 'bold':
                element.style.fontWeight = enabled ? 'bold' : 'normal';
                break;
            case 'italic':
                element.style.fontStyle = enabled ? 'italic' : 'normal';
                break;
            case 'underline':
                if (enabled) {
                    const currentDecoration = element.style.textDecoration || '';
                    if (!currentDecoration.includes('underline')) {
                        element.style.textDecoration = currentDecoration ? `${currentDecoration} underline` : 'underline';
                    }
                } else {
                    element.style.textDecoration = (element.style.textDecoration || '').replace(/\s*underline\s*/g, '').trim();
                }
                break;
            case 'strikethrough':
                if (enabled) {
                    const currentDecoration = element.style.textDecoration || '';
                    if (!currentDecoration.includes('line-through')) {
                        element.style.textDecoration = currentDecoration ? `${currentDecoration} line-through` : 'line-through';
                    }
                } else {
                    element.style.textDecoration = (element.style.textDecoration || '').replace(/\s*line-through\s*/g, '').trim();
                }
                break;
        }
    }

    drawShape(shape) {
        // 線カラーパターン対応
        if (shape.linePatternId >= 1 && typeof createFillPattern === 'function') {
            const patternStroke = createFillPattern(this.ctx, shape.linePatternId, shape.strokeColor, this.customPatterns);
            if (patternStroke) {
                this.ctx.strokeStyle = patternStroke;
            } else {
                this.ctx.strokeStyle = shape.strokeColor;
            }
        } else {
            this.ctx.strokeStyle = shape.strokeColor;
        }
        // パターン塗りつぶし対応
        if (shape.fillPatternId >= 1 && typeof createFillPattern === 'function') {
            const patternFill = createFillPattern(this.ctx, shape.fillPatternId, shape.fillColor, this.customPatterns);
            if (patternFill) {
                this.ctx.fillStyle = patternFill;
            } else {
                this.ctx.fillStyle = shape.fillColor;
            }
        } else {
            this.ctx.fillStyle = shape.fillColor;
        }
        this.ctx.lineWidth = shape.lineWidth;

        // 線種パターンを設定（lineTypeがあればそれを優先、なければlinePatternから変換）
        if (shape.lineType !== undefined) {
            this.applyLineType(shape.lineType);
        } else {
            // 後方互換: lineTypeがない場合はデフォルト実線
            this.applyLineType(0);
        }

        // 回転ラッパー: image/pixelmap/arc系/vobjは内部で回転するのでスキップ
        const wrapperRotation = this.getWrapperRotation(shape);
        if (wrapperRotation !== 0) {
            const bounds = this.getShapeBoundingBox(shape);
            if (bounds) {
                const cx = (bounds.minX + bounds.maxX) / 2;
                const cy = (bounds.minY + bounds.maxY) / 2;
                this.ctx.save();
                this.ctx.translate(cx, cy);
                this.ctx.rotate(wrapperRotation * Math.PI / 180);
                this.ctx.translate(-cx, -cy);
            }
        }

        const width = shape.endX - shape.startX;
        const height = shape.endY - shape.startY;

        switch (shape.type) {
            case 'line':
                // 両端が接続されているかチェック
                const hasStartConnection = shape.startConnection && shape.startConnection.shapeId !== undefined;
                const hasEndConnection = shape.endConnection && shape.endConnection.shapeId !== undefined;
                const bothEndsConnected = hasStartConnection && hasEndConnection;

                let lineAngles = null;
                // 両端が接続されている場合のみ接続形状を適用
                if (bothEndsConnected && shape.lineConnectionType && shape.lineConnectionType !== 'straight') {
                    lineAngles = this.drawConnectedLine(shape);
                } else {
                    // 直線として描画
                    this.ctx.beginPath();
                    this.ctx.moveTo(shape.startX, shape.startY);
                    this.ctx.lineTo(shape.endX, shape.endY);
                    this.ctx.stroke();
                }

                // 矢印を描画
                if (shape.start_arrow || shape.end_arrow) {
                    const arrowType = shape.arrow_type || 'simple';
                    let startAngle, endAngle;

                    if (lineAngles) {
                        // 接続形状の場合は、計算された角度を使用
                        startAngle = lineAngles.startAngle;
                        endAngle = lineAngles.endAngle;
                    } else {
                        // 直線の場合は、単純に始点と終点から角度を計算
                        const dx = shape.endX - shape.startX;
                        const dy = shape.endY - shape.startY;
                        const angle = Math.atan2(dy, dx);
                        startAngle = angle + Math.PI; // 始点は逆向き
                        endAngle = angle;
                    }

                    // 始点の矢印
                    if (shape.start_arrow) {
                        this.drawArrow(shape.startX, shape.startY, startAngle, arrowType, shape.lineWidth, shape.strokeColor);
                    }

                    // 終点の矢印
                    if (shape.end_arrow) {
                        this.drawArrow(shape.endX, shape.endY, endAngle, arrowType, shape.lineWidth, shape.strokeColor);
                    }
                }
                break;

            case 'rect':
            case 'roundRect':
                const cornerRadius = shape.cornerRadius || 0;
                if (cornerRadius > 0) {
                    // 角丸長方形
                    this.drawRoundedRect(shape.startX, shape.startY, width, height, cornerRadius, shape.fillEnabled, shape.lineWidth);
                } else {
                    // 通常の長方形
                    const fillEnabled = shape.fillEnabled !== undefined ? shape.fillEnabled : true;
                    if (fillEnabled) {
                        this.ctx.fillRect(shape.startX, shape.startY, width, height);
                    }
                    if (shape.lineWidth > 0) {
                        this.ctx.strokeRect(shape.startX, shape.startY, width, height);
                    }
                }
                break;

            case 'ellipse':
                const centerX = shape.startX + width / 2;
                const centerY = shape.startY + height / 2;
                const radiusX = Math.abs(width / 2);
                const radiusY = Math.abs(height / 2);

                this.ctx.beginPath();
                this.ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, 2 * Math.PI);
                const fillEnabledEllipse = shape.fillEnabled !== undefined ? shape.fillEnabled : true;
                if (fillEnabledEllipse) {
                    this.ctx.fill();
                }
                if (shape.lineWidth > 0) {
                    this.ctx.stroke();
                }
                break;

            case 'triangle':
                // 三角形描画
                const triangleWidth = shape.endX - shape.startX;

                this.ctx.beginPath();

                if (triangleWidth >= 0) {
                    // 右ドラッグ: 直角が左端（startX位置）
                    // 頂点: 左上(直角), 左下, 右下
                    this.ctx.moveTo(shape.startX, shape.startY);  // 左上（直角）
                    this.ctx.lineTo(shape.startX, shape.endY);     // 左下
                    this.ctx.lineTo(shape.endX, shape.endY);       // 右下
                } else {
                    // 左ドラッグ: 直角が右端（startX位置、startXが右側なので）
                    // 頂点: 右上(直角), 右下, 左下
                    this.ctx.moveTo(shape.startX, shape.startY);  // 右上（直角）
                    this.ctx.lineTo(shape.startX, shape.endY);     // 右下
                    this.ctx.lineTo(shape.endX, shape.endY);       // 左下
                }

                this.ctx.closePath();
                const fillEnabledTriangle = shape.fillEnabled !== undefined ? shape.fillEnabled : true;
                if (fillEnabledTriangle) {
                    this.ctx.fill();
                }
                if (shape.lineWidth > 0) {
                    this.ctx.stroke();
                }
                break;

            case 'arc':
                // 扇形（円弧 + 中心点への線）
                const arcCenterX = shape.startX + width / 2;
                const arcCenterY = shape.startY + height / 2;
                const arcRadiusX = Math.abs(width / 2);
                const arcRadiusY = Math.abs(height / 2);

                this.ctx.beginPath();
                this.ctx.moveTo(arcCenterX, arcCenterY);
                this.ctx.ellipse(arcCenterX, arcCenterY, arcRadiusX, arcRadiusY,
                                 shape.angle ?? 0,
                                 shape.startAngle ?? 0,
                                 shape.endAngle ?? Math.PI / 2);
                this.ctx.closePath();
                const fillEnabledArc = shape.fillEnabled !== undefined ? shape.fillEnabled : true;
                if (fillEnabledArc) {
                    this.ctx.fill();
                }
                this.ctx.stroke();
                break;

            case 'chord':
                // 弦（円弧の両端を直線で結ぶ）
                const chordCenterX = shape.startX + width / 2;
                const chordCenterY = shape.startY + height / 2;
                const chordRadiusX = Math.abs(width / 2);
                const chordRadiusY = Math.abs(height / 2);

                this.ctx.beginPath();
                this.ctx.ellipse(chordCenterX, chordCenterY, chordRadiusX, chordRadiusY,
                                 shape.angle ?? 0,
                                 shape.startAngle ?? 0,
                                 shape.endAngle ?? Math.PI / 2);
                this.ctx.closePath();
                const fillEnabledChord = shape.fillEnabled !== undefined ? shape.fillEnabled : true;
                if (fillEnabledChord) {
                    this.ctx.fill();
                }
                this.ctx.stroke();
                break;

            case 'elliptical_arc':
                // 楕円弧（円弧のみ、閉じない）
                const ellArcCenterX = shape.startX + width / 2;
                const ellArcCenterY = shape.startY + height / 2;
                const ellArcRadiusX = Math.abs(width / 2);
                const ellArcRadiusY = Math.abs(height / 2);

                this.ctx.beginPath();
                this.ctx.ellipse(ellArcCenterX, ellArcCenterY, ellArcRadiusX, ellArcRadiusY,
                                 shape.angle ?? 0,
                                 shape.startAngle ?? 0,
                                 shape.endAngle ?? Math.PI / 2);
                this.ctx.stroke();
                break;

            case 'pencil':
            case 'brush':
                // フリーハンド描画
                if (shape.path && shape.path.length > 1) {
                    this.ctx.beginPath();
                    this.ctx.moveTo(shape.path[0].x, shape.path[0].y);
                    for (let i = 1; i < shape.path.length; i++) {
                        this.ctx.lineTo(shape.path[i].x, shape.path[i].y);
                    }
                    this.ctx.stroke();
                }
                break;

            case 'polyline':
                // 折れ線描画（グラフからのコピーなど）
                if (shape.points && shape.points.length > 1) {
                    this.ctx.beginPath();
                    this.ctx.strokeStyle = shape.strokeColor || DEFAULT_FRCOL;
                    this.ctx.lineWidth = shape.lineWidth || 2;
                    this.ctx.moveTo(shape.points[0].x, shape.points[0].y);
                    for (let i = 1; i < shape.points.length; i++) {
                        this.ctx.lineTo(shape.points[i].x, shape.points[i].y);
                    }
                    this.ctx.stroke();
                }
                break;

            case 'marker':
                if (shape.points && shape.points.length > 0) {
                    const markerDef = this.markerDefinitions.get(shape.markerId);
                    if (markerDef) {
                        for (const pt of shape.points) {
                            this.drawMarker(pt.x, pt.y, markerDef);
                        }
                    }
                }
                break;

            case 'text':
                // テキスト描画（旧形式）
                if (shape.text) {
                    this.ctx.font = shape.fontSize || '16px sans-serif';
                    this.ctx.fillStyle = shape.strokeColor;
                    // textAlign プロパティがあれば適用（デフォルトは 'center'）
                    this.ctx.textAlign = shape.textAlign || 'center';
                    this.ctx.fillText(shape.text, shape.startX, shape.startY);
                    // 他の描画に影響しないよう元に戻す
                    this.ctx.textAlign = 'left';
                }
                break;

            case 'document':
                // 文字枠描画
                this.drawTextBox(shape);
                break;

            case 'pixelmap':
                // ピクセルマップ描画
                this.drawPixelmap(shape);
                break;

            case 'polygon':
                // 多角形描画
                if (shape.points && shape.points.length > 0) {
                    // 描画中のプレビュー表示
                    if (shape.tempEndX !== undefined && shape.tempEndY !== undefined) {
                        // プレビュー中は線のみ描画（塗りつぶしなし）
                        this.ctx.beginPath();

                        // 既存の全ての頂点を繋ぐ
                        this.ctx.moveTo(shape.points[0].x, shape.points[0].y);
                        for (let i = 1; i < shape.points.length; i++) {
                            this.ctx.lineTo(shape.points[i].x, shape.points[i].y);
                        }

                        // マウス位置への線（次の頂点候補）
                        this.ctx.lineTo(shape.tempEndX, shape.tempEndY);

                        // 2点以上ある場合は、開始点への戻り線もプレビュー表示
                        if (shape.points.length >= 2) {
                            this.ctx.lineTo(shape.points[0].x, shape.points[0].y);
                        }

                        // 線のみ描画
                        this.ctx.stroke();
                    } else if (shape.points.length > 2) {
                        // 確定済みの多角形
                        const cornerRadius = shape.cornerRadius || 0;
                        if (cornerRadius > 0) {
                            // 角丸多角形
                            this.drawRoundedPolygon(shape.points, cornerRadius, shape.fillEnabled);
                        } else {
                            // 通常の多角形
                            this.ctx.beginPath();
                            this.ctx.moveTo(shape.points[0].x, shape.points[0].y);
                            for (let i = 1; i < shape.points.length; i++) {
                                this.ctx.lineTo(shape.points[i].x, shape.points[i].y);
                            }
                            this.ctx.closePath();
                            const fillEnabledPolygon = shape.fillEnabled !== undefined ? shape.fillEnabled : true;
                            if (fillEnabledPolygon) {
                                this.ctx.fill();
                            }
                            this.ctx.stroke();
                        }
                    }
                }
                break;

            case 'curve':
                // 自由曲線（ベジェ曲線）
                if (shape.path && shape.path.length > 1) {
                    this.ctx.beginPath();
                    this.ctx.moveTo(shape.path[0].x, shape.path[0].y);

                    for (let i = 1; i < shape.path.length - 2; i++) {
                        const xc = (shape.path[i].x + shape.path[i + 1].x) / 2;
                        const yc = (shape.path[i].y + shape.path[i + 1].y) / 2;
                        this.ctx.quadraticCurveTo(shape.path[i].x, shape.path[i].y, xc, yc);
                    }

                    if (shape.path.length > 2) {
                        const last = shape.path.length - 1;
                        this.ctx.quadraticCurveTo(
                            shape.path[last - 1].x,
                            shape.path[last - 1].y,
                            shape.path[last].x,
                            shape.path[last].y
                        );
                    }
                    this.ctx.stroke();
                }
                break;

            case 'group':
                // グループ化された図形
                if (shape.shapes) {
                    shape.shapes.forEach(s => this.drawShape(s));
                }
                break;

            case 'vobj':
                // 仮身はDOM要素として描画するため、キャンバス描画はスキップ
                // renderVirtualObjectsAsElementsメソッドで描画される
                break;

            case 'image':
                // 画像描画
                if (shape.imageElement && shape.imageElement.complete) {
                    const width = shape.endX - shape.startX;
                    const height = shape.endY - shape.startY;
                    const centerX = shape.startX + width / 2;
                    const centerY = shape.startY + height / 2;

                    this.ctx.save();

                    // 中心点に移動
                    this.ctx.translate(centerX, centerY);

                    // 回転を適用
                    if (shape.rotation) {
                        this.ctx.rotate(shape.rotation * Math.PI / 180);
                    }

                    // 反転を適用
                    const scaleX = shape.flipH ? -1 : 1;
                    const scaleY = shape.flipV ? -1 : 1;
                    this.ctx.scale(scaleX, scaleY);

                    // 画像を描画（中心を原点として）
                    this.ctx.drawImage(shape.imageElement, -width / 2, -height / 2, width, height);

                    this.ctx.restore();
                }
                break;
        }

        // 回転ラッパーの復元
        if (wrapperRotation !== 0) {
            this.ctx.restore();
        }
    }

    /**
     * 矢印を描画
     * @param {number} x - 矢印の位置X
     * @param {number} y - 矢印の位置Y
     * @param {number} angle - 矢印の角度（ラジアン）
     * @param {string} arrowType - 矢印の種類 ('simple', 'filled')
     * @param {number} lineWidth - 線の太さ
     * @param {string} strokeColor - 線の色
     */
    drawArrow(x, y, angle, arrowType, lineWidth, strokeColor) {
        const arrowLength = 15 + lineWidth * 2; // 矢印の長さ
        const arrowWidth = 8 + lineWidth; // 矢印の幅

        this.ctx.save();
        this.ctx.translate(x, y);
        this.ctx.rotate(angle);
        this.ctx.strokeStyle = strokeColor;
        this.ctx.fillStyle = strokeColor;
        this.ctx.lineWidth = lineWidth;
        this.ctx.setLineDash([]); // 矢印は実線で描画

        switch (arrowType) {
            case 'simple': // → (線のみ)
                this.ctx.beginPath();
                this.ctx.moveTo(0, 0);
                this.ctx.lineTo(-arrowLength, -arrowWidth);
                this.ctx.moveTo(0, 0);
                this.ctx.lineTo(-arrowLength, arrowWidth);
                this.ctx.stroke();
                break;

            case 'filled': // ➜ (塗りつぶし)
                this.ctx.beginPath();
                this.ctx.moveTo(0, 0);
                this.ctx.lineTo(-arrowLength, -arrowWidth);
                this.ctx.lineTo(-arrowLength, arrowWidth);
                this.ctx.closePath();
                this.ctx.fill();
                this.ctx.stroke();
                break;
        }

        this.ctx.restore();
    }

    /**
     * キャンバス再描画（通常はスロットル版を使用）
     */
    redraw() {
        // スロットル版が利用可能ならそれを使用
        if (this.throttledRedraw) {
            this.throttledRedraw();
        } else {
            // フォールバック: 即座に実行
            this.redrawImmediate();
        }
    }

    /**
     * キャンバス再描画（即座実行版）
     */
    redrawImmediate() {
        // キャンバスをクリア（物理サイズでクリア、scale前に実行）
        this.ctx.fillStyle = this.bgColor;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // ズームスケールを適用（埋め込みモードではzoomLevel=1固定なので影響なし）
        this.ctx.save();
        this.ctx.scale(this.zoomLevel, this.zoomLevel);

        // 埋め込みモード: figViewの原点分だけキャンバスを移動
        // figViewが(left, top)始まりの場合、図形座標を(0, 0)基準で描画するためにオフセット
        const needsViewportTranslate = this.embeddedMode && this.figView &&
            (this.figView.left !== 0 || this.figView.top !== 0);
        if (needsViewportTranslate) {
            this.ctx.save();
            this.ctx.translate(-this.figView.left, -this.figView.top);
        }

        // 格子点を描画（最後部）
        if (this.gridMode === 'show' || this.gridMode === 'snap') {
            this.drawGrid();
        }

        // 用紙枠を描画
        if (this.paperFrameVisible) {
            this.drawPaperFrame();
        }

        // すべての図形を再描画
        this.shapes.forEach(shape => {
            this.drawShape(shape);
        });

        // 選択中の図形にハイライトを表示
        this.selectedShapes.forEach(shape => {
            this.drawSelectionHighlight(shape);
        });

        // 埋め込みモード: ビューポート移動を復元
        if (needsViewportTranslate) {
            this.ctx.restore();
        }

        // 選択中の図形にコネクタは表示しない（ユーザー要望により無効化）
        // this.selectedShapes.forEach(shape => {
        //     // 四角形、円、多角形、仮身にコネクタを表示
        //     if (shape.type === 'rect' || shape.type === 'roundRect' ||
        //         shape.type === 'ellipse' || shape.type === 'polygon' || shape.type === 'vobj') {
        //         this.drawConnectors(shape);
        //     }
        //     // 直線の端点にコネクタを表示
        //     else if (shape.type === 'line') {
        //         this.drawLineEndpointConnectors(shape);
        //     }
        // });

        // 直線描画中：マウス位置近くの図形のコネクタを表示
        if (this.currentTool === 'line' && this.isDrawing && this.currentShape) {
            // 終点位置（マウス位置）の近くの図形を探す
            const nearbyShapes = this.findNearbyShapes(this.currentShape.endX, this.currentShape.endY);
            nearbyShapes.forEach(item => {
                this.drawConnectors(item.shape);
            });
        }

        // 直線ツール選択中（まだ描画していない）：マウス位置近くの図形のコネクタを表示
        if (this.currentTool === 'line' && !this.isDrawing && !this.currentShape) {
            const nearbyShapes = this.findNearbyShapes(this.lastMouseX, this.lastMouseY);
            nearbyShapes.forEach(item => {
                this.drawConnectors(item.shape);
            });
        }

        // 直線端点ドラッグ中：マウス位置近くの図形のコネクタを表示
        if (this.isDraggingLineEndpoint && this.draggedLineEndpoint) {
            const shape = this.draggedLineEndpoint.shape;
            const endpoint = this.draggedLineEndpoint.endpoint;
            const endpointX = endpoint === 'start' ? shape.startX : shape.endX;
            const endpointY = endpoint === 'start' ? shape.startY : shape.endY;

            const nearbyShapes = this.findNearbyShapes(endpointX, endpointY);
            nearbyShapes.forEach(item => {
                this.drawConnectors(item.shape);
            });
        }

        // 矩形選択のプレビューを描画
        if (this.isRectangleSelecting && this.selectionRect) {
            const minX = Math.min(this.selectionRect.startX, this.selectionRect.endX);
            const maxX = Math.max(this.selectionRect.startX, this.selectionRect.endX);
            const minY = Math.min(this.selectionRect.startY, this.selectionRect.endY);
            const maxY = Math.max(this.selectionRect.startY, this.selectionRect.endY);

            this.ctx.save();
            this.ctx.strokeStyle = 'rgba(0, 123, 255, 0.8)';
            this.ctx.lineWidth = 1;
            this.ctx.setLineDash([5, 5]);
            this.ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
            this.ctx.fillStyle = 'rgba(0, 123, 255, 0.1)';
            this.ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
            this.ctx.restore();
        }

        // 描画中の図形プレビューを表示（マウス停止時もプレビューを維持）
        if (this.currentShape && (this.isDrawing || this.currentTool === 'polygon')) {
            this.drawShape(this.currentShape);
        }

        // ズームスケールを復元
        this.ctx.restore();

        // 仮身をDOM要素として描画
        this.renderVirtualObjectsAsElements();
    }

    /**
     * 選択枠点滅用の軽量再描画
     * 仮身のDOM要素は再作成せず、キャンバス上の図形と選択枠のみを再描画
     */
    redrawForSelectionBlink() {
        // キャンバスをクリア（物理サイズでクリア、scale前に実行）
        this.ctx.fillStyle = this.bgColor;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // ズームスケールを適用
        this.ctx.save();
        this.ctx.scale(this.zoomLevel, this.zoomLevel);

        // 格子点を描画（最後部）
        if (this.gridMode === 'show' || this.gridMode === 'snap') {
            this.drawGrid();
        }

        // すべての図形を再描画（ただし仮身はスキップ）
        this.shapes.forEach(shape => {
            // 仮身以外の図形のみ再描画
            if (shape.type !== 'vobj') {
                this.drawShape(shape);
            }
        });

        // 選択中の図形にハイライトを表示
        this.selectedShapes.forEach(shape => {
            this.drawSelectionHighlight(shape);
        });

        // 選択中の図形にコネクタは表示しない（ユーザー要望により無効化）
        // this.selectedShapes.forEach(shape => {
        //     // 四角形、円、多角形、仮身にコネクタを表示
        //     if (shape.type === 'rect' || shape.type === 'roundRect' ||
        //         shape.type === 'ellipse' || shape.type === 'polygon' || shape.type === 'vobj') {
        //         this.drawConnectors(shape);
        //     }
        //     // 直線の端点にコネクタを表示
        //     else if (shape.type === 'line') {
        //         this.drawLineEndpointConnectors(shape);
        //     }
        // });

        // 直線描画中：マウス位置近くの図形のコネクタを表示
        if (this.currentTool === 'line' && this.isDrawing && this.currentShape) {
            // 終点位置（マウス位置）の近くの図形を探す
            const nearbyShapes = this.findNearbyShapes(this.currentShape.endX, this.currentShape.endY);
            nearbyShapes.forEach(item => {
                this.drawConnectors(item.shape);
            });
        }

        // 直線ツール選択中（まだ描画していない）：マウス位置近くの図形のコネクタを表示
        if (this.currentTool === 'line' && !this.isDrawing && !this.currentShape) {
            const nearbyShapes = this.findNearbyShapes(this.lastMouseX, this.lastMouseY);
            nearbyShapes.forEach(item => {
                this.drawConnectors(item.shape);
            });
        }

        // 直線端点ドラッグ中：マウス位置近くの図形のコネクタを表示
        if (this.isDraggingLineEndpoint && this.draggedLineEndpoint) {
            const shape = this.draggedLineEndpoint.shape;
            const endpoint = this.draggedLineEndpoint.endpoint;
            const endpointX = endpoint === 'start' ? shape.startX : shape.endX;
            const endpointY = endpoint === 'start' ? shape.startY : shape.endY;

            const nearbyShapes = this.findNearbyShapes(endpointX, endpointY);
            nearbyShapes.forEach(item => {
                this.drawConnectors(item.shape);
            });
        }

        // 矩形選択のプレビューを描画
        if (this.isRectangleSelecting && this.selectionRect) {
            const minX = Math.min(this.selectionRect.startX, this.selectionRect.endX);
            const maxX = Math.max(this.selectionRect.startX, this.selectionRect.endX);
            const minY = Math.min(this.selectionRect.startY, this.selectionRect.endY);
            const maxY = Math.max(this.selectionRect.startY, this.selectionRect.endY);

            this.ctx.save();
            this.ctx.strokeStyle = 'rgba(0, 123, 255, 0.8)';
            this.ctx.lineWidth = 1;
            this.ctx.setLineDash([5, 5]);
            this.ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
            this.ctx.fillStyle = 'rgba(0, 123, 255, 0.1)';
            this.ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
            this.ctx.restore();
        }

        // 描画中の図形プレビューを表示（マウス停止時もプレビューを維持）
        if (this.currentShape && (this.isDrawing || this.currentTool === 'polygon')) {
            this.drawShape(this.currentShape);
        }

        // ズームスケールを復元
        this.ctx.restore();

        // 注意: 仮身のDOM要素は再作成しない（パフォーマンス最適化）
        // 既存のDOM要素はそのまま維持される
    }

    drawGrid() {
        const interval = this.gridInterval;
        this.ctx.fillStyle = '#666666'; // より濃い色に変更

        // ctx.scale()が適用済みなので論理サイズで反復
        const logicalWidth = this.canvas.width / this.zoomLevel;
        const logicalHeight = this.canvas.height / this.zoomLevel;

        // 格子点を描画（1x1論理ピクセルで正確に）
        for (let x = 0; x < logicalWidth; x += interval) {
            for (let y = 0; y < logicalHeight; y += interval) {
                this.ctx.fillRect(x, y, 1, 1);
            }
        }
    }

    snapToGrid(x, y) {
        // 格子点拘束が有効な場合、座標を最も近い格子点にスナップ
        if (this.gridMode === 'snap') {
            const interval = this.gridInterval;
            return {
                x: Math.round(x / interval) * interval,
                y: Math.round(y / interval) * interval
            };
        }
        return { x, y };
    }

    /**
     * 物理座標（Canvas上のピクセル座標）から論理座標へ変換
     * @param {number} px - 物理X座標
     * @param {number} py - 物理Y座標
     * @returns {{x: number, y: number}} 論理座標
     */
    physicalToLogical(px, py) {
        return {
            x: px / this.zoomLevel,
            y: py / this.zoomLevel
        };
    }

    /**
     * 論理座標から物理座標（Canvas上のピクセル座標）へ変換
     * @param {number} lx - 論理X座標
     * @param {number} ly - 論理Y座標
     * @returns {{x: number, y: number}} 物理座標
     */
    logicalToPhysical(lx, ly) {
        return {
            x: lx * this.zoomLevel,
            y: ly * this.zoomLevel
        };
    }

    /**
     * ズーム変更時にスクロール位置を調整（画面中央維持）
     * @param {number} oldZoom - 変更前の倍率
     * @param {number} newZoom - 変更後の倍率
     */
    adjustScrollForZoom(oldZoom, newZoom) {
        const container = document.querySelector('.plugin-content');
        if (!container) return;
        const centerLogicalX = (container.scrollLeft + container.clientWidth / 2) / oldZoom;
        const centerLogicalY = (container.scrollTop + container.clientHeight / 2) / oldZoom;
        container.scrollLeft = centerLogicalX * newZoom - container.clientWidth / 2;
        container.scrollTop = centerLogicalY * newZoom - container.clientHeight / 2;
    }

    /**
     * ズーム倍率の表示ラベルを取得
     * @param {number} zoomLevel - ズーム倍率
     * @returns {string} 表示ラベル（例: "x1", "x1/2"）
     */
    getZoomDisplayLabel(zoomLevel) {
        const labels = {
            0.125: 'x1/8',
            0.25: 'x1/4',
            0.5: 'x1/2',
            1: 'x1',
            2: 'x2',
            3: 'x3',
            4: 'x4',
            5: 'x5',
            8: 'x8'
        };
        return labels[zoomLevel] || ('x' + zoomLevel);
    }

    /**
     * ズーム変更時に全仮身のDOM位置・サイズを更新
     */
    updateVobjPositionsForZoom() {
        this.shapes.forEach(shape => {
            if (shape.type === 'vobj' && shape.vobjElement) {
                const width = Math.abs((shape.endX || 0) - (shape.startX || 0));
                const height = Math.abs((shape.endY || 0) - (shape.startY || 0));
                const pos = this.logicalToPhysical(shape.startX, shape.startY);
                const size = this.logicalToPhysical(width, height);
                shape.vobjElement.style.left = pos.x + 'px';
                shape.vobjElement.style.top = pos.y + 'px';
                shape.vobjElement.style.width = size.x + 'px';
                shape.vobjElement.style.height = size.y + 'px';
                if (shape.expanded && shape.expandedElement) {
                    const titleBarHeight = 20;
                    shape.expandedElement.style.left = pos.x + 'px';
                    shape.expandedElement.style.top = (pos.y + titleBarHeight * this.zoomLevel) + 'px';
                    shape.expandedElement.style.width = size.x + 'px';
                    shape.expandedElement.style.height = (size.y - titleBarHeight * this.zoomLevel) + 'px';
                }
            }
        });
    }

    /**
     * HTMLリッチテキストをパースして、スタイル付きテキストセグメントに変換
     * @param {string} html - HTMLリッチテキスト
     * @param {object} defaultStyle - デフォルトスタイル
     * @returns {Array} テキストセグメント配列
     */
    parseRichText(html, defaultStyle) {
        if (!html || typeof html !== 'string') {
            return [];
        }

        // 一時的なdiv要素を作成してHTMLをパース
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;

        const segments = [];
        const parseNode = (node, inheritedStyle) => {
            if (node.nodeType === Node.TEXT_NODE) {
                // テキストノードの場合
                const text = node.textContent;
                if (text) {
                    segments.push({
                        text: text,
                        style: { ...inheritedStyle }
                    });
                }
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                // 要素ノードの場合、スタイルを継承・更新
                const element = node;
                const newStyle = { ...inheritedStyle };

                // インラインスタイルから取得
                if (element.style.fontSize) newStyle.fontSize = parseFloat(element.style.fontSize);
                if (element.style.fontFamily) newStyle.fontFamily = element.style.fontFamily;
                if (element.style.color) newStyle.color = element.style.color;
                if (element.style.fontWeight === 'bold') newStyle.bold = true;
                if (element.style.fontStyle === 'italic') newStyle.italic = true;
                if (element.style.textDecoration) {
                    if (element.style.textDecoration.includes('underline')) newStyle.underline = true;
                    if (element.style.textDecoration.includes('line-through')) newStyle.strikethrough = true;
                }

                // タグ名からスタイルを推測
                if (element.tagName === 'B' || element.tagName === 'STRONG') newStyle.bold = true;
                if (element.tagName === 'I' || element.tagName === 'EM') newStyle.italic = true;
                if (element.tagName === 'U') newStyle.underline = true;
                if (element.tagName === 'S' || element.tagName === 'STRIKE' || element.tagName === 'DEL') newStyle.strikethrough = true;

                // 子ノードを再帰的に処理
                for (const child of element.childNodes) {
                    parseNode(child, newStyle);
                }

                // BRタグの場合は改行を追加
                if (element.tagName === 'BR') {
                    segments.push({
                        text: '\n',
                        style: { ...newStyle }
                    });
                }
            }
        };

        // ルートノードから解析開始
        for (const child of tempDiv.childNodes) {
            parseNode(child, defaultStyle);
        }

        return segments;
    }

    drawTextBox(shape) {
        const minX = Math.min(shape.startX, shape.endX);
        const minY = Math.min(shape.startY, shape.endY);
        const maxX = Math.max(shape.startX, shape.endX);
        const maxY = Math.max(shape.startY, shape.endY);
        const width = Math.abs(shape.endX - shape.startX);
        const height = Math.abs(shape.endY - shape.startY);

        // 選択状態、または作成中（currentShape）、または空の文字枠の場合は枠線を表示
        const isSelected = this.selectedShapes.includes(shape);
        const isCurrentShape = this.currentShape === shape;
        const isEmpty = !shape.content || shape.content.trim() === '';

        if (isSelected || isCurrentShape || isEmpty) {
            if (isSelected) {
                // 選択中は橙色の点線
                this.ctx.strokeStyle = '#ff8f00';
                this.ctx.lineWidth = 2;
                this.ctx.setLineDash([5, 5]);
            } else {
                // 作成中または空の場合は薄いグレーの点線
                this.ctx.strokeStyle = '#cccccc';
                this.ctx.lineWidth = 1;
                this.ctx.setLineDash([5, 5]);
            }
            this.ctx.strokeRect(minX, minY, width, height);
            this.ctx.setLineDash([]);
        }

        // テキストを描画（内容がある場合のみ）
        if (shape.content && shape.content.trim() !== '') {
            const padding = 5;
            const maxWidth = width - padding * 2;

            // リッチテキストがある場合はHTML解析、ない場合は通常テキスト
            let segments = [];
            if (shape.richContent) {
                // デフォルトスタイル
                const defaultStyle = {
                    fontSize: shape.fontSize,
                    fontFamily: shape.fontFamily,
                    color: shape.textColor,
                    bold: shape.decorations.bold,
                    italic: shape.decorations.italic,
                    underline: shape.decorations.underline,
                    strikethrough: shape.decorations.strikethrough
                };
                segments = this.parseRichText(shape.richContent, defaultStyle);
            } else {
                // 通常のテキストを1つのセグメントとして扱う
                segments = [{
                    text: shape.content,
                    style: {
                        fontSize: shape.fontSize,
                        fontFamily: shape.fontFamily,
                        color: shape.textColor,
                        bold: shape.decorations.bold,
                        italic: shape.decorations.italic,
                        underline: shape.decorations.underline,
                        strikethrough: shape.decorations.strikethrough
                    }
                }];
            }

            // セグメントを描画
            let y = minY + padding;
            let currentLineSegments = []; // 現在の行のセグメント
            let currentLineWidth = 0;

            const drawLine = (lineSegments, lineY) => {
                // 行の合計幅を計算
                let totalLineWidth = 0;
                for (const seg of lineSegments) {
                    const style = seg.style;
                    let fontStyle = '';
                    if (style.italic) fontStyle += 'italic ';
                    if (style.bold) fontStyle += 'bold ';
                    this.ctx.font = `${fontStyle}${style.fontSize}px ${style.fontFamily}`;
                    totalLineWidth += this.ctx.measureText(seg.text).width;
                }

                // textAlignに基づいて開始X座標を決定
                let lineX = minX + padding;
                const textAlign = shape.textAlign || 'left';
                if (textAlign === 'center') {
                    lineX = minX + (width - totalLineWidth) / 2;
                } else if (textAlign === 'right') {
                    lineX = minX + width - padding - totalLineWidth;
                }

                for (const seg of lineSegments) {
                    const style = seg.style;
                    const text = seg.text;

                    // フォント設定
                    let fontStyle = '';
                    if (style.italic) fontStyle += 'italic ';
                    if (style.bold) fontStyle += 'bold ';
                    this.ctx.font = `${fontStyle}${style.fontSize}px ${style.fontFamily}`;
                    this.ctx.fillStyle = style.color;
                    this.ctx.textBaseline = 'top';

                    // テキスト描画
                    this.ctx.fillText(text, lineX, lineY);

                    const textWidth = this.ctx.measureText(text).width;

                    // 下線
                    if (style.underline) {
                        this.ctx.strokeStyle = style.color;
                        this.ctx.lineWidth = 1;
                        this.ctx.beginPath();
                        this.ctx.moveTo(lineX, lineY + style.fontSize);
                        this.ctx.lineTo(lineX + textWidth, lineY + style.fontSize);
                        this.ctx.stroke();
                    }

                    // 打ち消し線
                    if (style.strikethrough) {
                        this.ctx.strokeStyle = style.color;
                        this.ctx.lineWidth = 1;
                        this.ctx.beginPath();
                        this.ctx.moveTo(lineX, lineY + style.fontSize / 2);
                        this.ctx.lineTo(lineX + textWidth, lineY + style.fontSize / 2);
                        this.ctx.stroke();
                    }

                    lineX += textWidth;
                }
            };

            // セグメントごとに処理
            for (const segment of segments) {
                const style = segment.style;
                const text = segment.text;

                // フォント設定
                let fontStyle = '';
                if (style.italic) fontStyle += 'italic ';
                if (style.bold) fontStyle += 'bold ';
                this.ctx.font = `${fontStyle}${style.fontSize}px ${style.fontFamily}`;

                // 改行で分割
                const lines = text.split('\n');
                for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
                    const paragraph = lines[lineIdx];

                    // 改行の場合（または段落の区切り）
                    if (lineIdx > 0) {
                        // 現在の行を描画
                        if (currentLineSegments.length > 0) {
                            drawLine(currentLineSegments, y);
                            y += style.fontSize * DEFAULT_LINE_HEIGHT;
                            currentLineSegments = [];
                            currentLineWidth = 0;
                        } else {
                            // 空行
                            y += style.fontSize * DEFAULT_LINE_HEIGHT;
                        }
                    }

                    // 1文字ずつチェックして折り返し
                    let currentText = '';
                    for (let i = 0; i < paragraph.length; i++) {
                        const char = paragraph[i];
                        const testText = currentText + char;
                        const metrics = this.ctx.measureText(testText);

                        if (currentLineWidth + metrics.width > maxWidth && currentText.length > 0) {
                            // 現在のセグメントを行に追加
                            currentLineSegments.push({
                                text: currentText,
                                style: style
                            });

                            // 行を描画
                            drawLine(currentLineSegments, y);
                            y += style.fontSize * DEFAULT_LINE_HEIGHT;

                            // 次の行を開始
                            currentLineSegments = [];
                            currentLineWidth = 0;
                            currentText = char;
                        } else {
                            currentText = testText;
                        }
                    }

                    // 残りのテキストを現在の行に追加
                    if (currentText.length > 0) {
                        const metrics = this.ctx.measureText(currentText);
                        currentLineSegments.push({
                            text: currentText,
                            style: style
                        });
                        currentLineWidth += metrics.width;
                    }
                }
            }

            // 最後の行を描画
            if (currentLineSegments.length > 0) {
                drawLine(currentLineSegments, y);
            }
        }
    }

    drawSelectionHighlight(shape) {
        // 変形モード中は頂点ハンドルを描画（点滅なし、常時表示）
        if (this.isTransformMode && shape === this.transformingShape) {
            this.drawTransformHandles(shape);
            return;
        }

        // 点滅状態がfalseの場合は選択枠を描画しない
        if (!this.selectionBlinkState) {
            return;
        }

        // getShapeBoundingBox を使用してバウンディングボックスを取得
        const bounds = this.getShapeBoundingBox(shape);
        if (!bounds) {
            return; // バウンディングボックスが取得できない場合はスキップ
        }

        // 回転ラッパー: 選択枠も図形と同じ回転で描画
        const rotation = this.getEffectiveRotationDeg(shape);
        if (rotation !== 0) {
            const cx = (bounds.minX + bounds.maxX) / 2;
            const cy = (bounds.minY + bounds.maxY) / 2;
            this.ctx.save();
            this.ctx.translate(cx, cy);
            this.ctx.rotate(rotation * Math.PI / 180);
            this.ctx.translate(-cx, -cy);
        }

        this.ctx.strokeStyle = '#ff8f00';
        this.ctx.lineWidth = this.selectionWidth; // ユーザ環境設定の太さを使用
        this.ctx.setLineDash([5, 5]);

        const width = bounds.maxX - bounds.minX;
        const height = bounds.maxY - bounds.minY;

        this.ctx.strokeRect(bounds.minX, bounds.minY, width, height);
        this.ctx.setLineDash([]);

        // 仮身の場合は専用リサイズを使うため、通常のリサイズハンドルは描画しない
        if (shape.type === 'vobj') {
            if (rotation !== 0) {
                this.ctx.restore();
            }
            return;
        }

        // リサイズハンドルを描画（右下）
        const handleSize = 8;
        this.ctx.fillStyle = '#ffffff';
        this.ctx.strokeStyle = '#ff8f00';
        this.ctx.lineWidth = this.selectionWidth; // ユーザ環境設定の太さを使用
        this.ctx.fillRect(bounds.maxX - handleSize / 2, bounds.maxY - handleSize / 2, handleSize, handleSize);
        this.ctx.strokeRect(bounds.maxX - handleSize / 2, bounds.maxY - handleSize / 2, handleSize, handleSize);

        // 回転ラッパーの復元
        if (rotation !== 0) {
            this.ctx.restore();
        }
    }

    /**
     * 変形モード用の頂点ハンドルを描画
     * @param {Object} shape - 変形中の図形
     */
    drawTransformHandles(shape) {
        // 頂点情報を最新に更新
        this.transformVertices = this.getTransformVertices(shape);

        // 回転ラッパー: 図形と同じ回転で変形ハンドルを描画
        const rotation = this.getWrapperRotation(shape);
        if (rotation !== 0) {
            const bounds = this.getShapeBoundingBox(shape);
            if (bounds) {
                const cx = (bounds.minX + bounds.maxX) / 2;
                const cy = (bounds.minY + bounds.maxY) / 2;
                this.ctx.save();
                this.ctx.translate(cx, cy);
                this.ctx.rotate(rotation * Math.PI / 180);
                this.ctx.translate(-cx, -cy);
            }
        }

        const handleSize = 8;
        const halfSize = handleSize / 2;

        for (const v of this.transformVertices) {
            // 中心点は異なるスタイルで描画
            if (v.type === 'center') {
                this.ctx.fillStyle = '#ff8f00';
                this.ctx.strokeStyle = '#000000';
            } else {
                this.ctx.fillStyle = '#ffffff';
                this.ctx.strokeStyle = '#ff8f00';
            }
            this.ctx.lineWidth = this.selectionWidth;
            this.ctx.fillRect(v.x - halfSize, v.y - halfSize, handleSize, handleSize);
            this.ctx.strokeRect(v.x - halfSize, v.y - halfSize, handleSize, handleSize);
        }

        // 図形の輪郭線を薄く描画（変形対象の視覚的フィードバック）
        this.ctx.strokeStyle = 'rgba(255, 143, 0, 0.5)';
        this.ctx.lineWidth = 1;
        this.ctx.setLineDash([3, 3]);
        const bounds = this.getShapeBoundingBox(shape);
        if (bounds) {
            this.ctx.strokeRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
        }
        this.ctx.setLineDash([]);

        // 回転ラッパーの復元
        if (rotation !== 0) {
            this.ctx.restore();
        }
    }

    drawPixelmap(shape) {
        const minX = Math.min(shape.startX, shape.endX);
        const minY = Math.min(shape.startY, shape.endY);
        const width = Math.abs(shape.endX - shape.startX);
        const height = Math.abs(shape.endY - shape.startY);

        // ImageDataが存在する場合は描画
        if (shape.imageData) {
            // 一時的なcanvasにImageDataを描画
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = shape.imageData.width;
            tempCanvas.height = shape.imageData.height;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.putImageData(shape.imageData, 0, 0);

            const centerX = minX + width / 2;
            const centerY = minY + height / 2;

            this.ctx.save();

            // 中心点に移動
            this.ctx.translate(centerX, centerY);

            // 回転を適用
            if (shape.rotation) {
                this.ctx.rotate(shape.rotation * Math.PI / 180);
            }

            // 反転を適用
            const scaleX = shape.flipH ? -1 : 1;
            const scaleY = shape.flipV ? -1 : 1;
            this.ctx.scale(scaleX, scaleY);

            // メインcanvasに拡大/縮小して描画（中心を原点として）
            this.ctx.drawImage(tempCanvas, -width / 2, -height / 2, width, height);

            this.ctx.restore();
        } else {
            // ImageDataがない場合は背景色で塗りつぶし
            this.ctx.fillStyle = shape.backgroundColor || DEFAULT_BGCOL;
            this.ctx.fillRect(minX, minY, width, height);
        }

        // ピクセルマップモードで編集中の場合は枠を表示
        if (this.isPixelmapMode && this.editingPixelmap === shape) {
            this.ctx.strokeStyle = '#ff8f00';
            this.ctx.lineWidth = 2;
            this.ctx.setLineDash([5, 5]);
            this.ctx.strokeRect(minX, minY, width, height);
            this.ctx.setLineDash([]);
        } else if (this.selectedShapes.includes(shape)) {
            // 選択中の場合も枠を表示
            this.ctx.strokeStyle = '#ff8f00';
            this.ctx.lineWidth = 2;
            this.ctx.setLineDash([5, 5]);
            this.ctx.strokeRect(minX, minY, width, height);
            this.ctx.setLineDash([]);
        } else if (!shape.imageData || this.currentShape === shape) {
            // 作成中または空の場合は薄いグレーの枠線
            this.ctx.strokeStyle = '#cccccc';
            this.ctx.lineWidth = 1;
            this.ctx.setLineDash([5, 5]);
            this.ctx.strokeRect(minX, minY, width, height);
            this.ctx.setLineDash([]);
        }
    }


    finishPolygon() {
        if (this.currentShape && this.currentShape.type === 'polygon') {
            // Undo用に状態を保存
            this.saveStateForUndo();

            // tempEndXとtempEndYを削除
            delete this.currentShape.tempEndX;
            delete this.currentShape.tempEndY;

            // z-indexを設定（未設定の場合のみ）
            if (this.currentShape.zIndex === null || this.currentShape.zIndex === undefined) {
                this.currentShape.zIndex = this.getNextZIndex();
            }

            // 多角形を確定
            this.shapes.push(this.currentShape);
            this.currentShape = null;
            this.isFirstPolygonLine = false;
            this.redraw();
            this.isModified = true;
            this.setStatus('多角形を確定しました');
        }
    }

    async insertText(x, y) {
        const text = await this.showInputDialog('テキストを入力してください', '');

        if (text) {
            // Undo用に状態を保存
            this.saveStateForUndo();

            const textShape = {
                type: 'text',
                startX: x,
                startY: y,
                text: text,
                fontSize: '16px sans-serif',
                strokeColor: this.strokeColor,
                fillColor: this.fillColor,
                lineWidth: this.lineWidth,
                zIndex: this.getNextZIndex()
            };

            this.shapes.push(textShape);
            this.redraw();
            this.isModified = true;
            this.setStatus('テキストを追加しました');
        }

        this.isDrawing = false;
    }


    // getGlobalClipboard() は基底クラス PluginBase で定義

    undo() {
        if (this.undoStack.length > 0) {
            const state = this.undoStack.pop();
            this.redoStack.push(JSON.stringify(this.shapes));
            this.shapes = JSON.parse(state);
            this.redraw();
            this.isModified = true;
            this.setStatus('元に戻しました');
            // スクロールバー更新を通知
            this.resizeCanvas();
        } else {
            // 最後の図形を削除（後方互換性）
            if (this.shapes.length > 0) {
                this.shapes.pop();
                this.redraw();
                this.isModified = true;
                // スクロールバー更新を通知
                this.resizeCanvas();
            }
        }
    }

    // 状態を保存してからアクションを実行
    saveStateForUndo() {
        this.undoStack.push(JSON.stringify(this.shapes));
        // Undoスタックが大きくなりすぎないように制限
        if (this.undoStack.length > 50) {
            this.undoStack.shift();
        }
        // Redoスタックをクリア
        this.redoStack = [];
    }

    // XMLパース系メソッドは figure-xml-parser.js に移動


    // XML保存系メソッドは figure-xml-serializer.js に移動


    setupContextMenu() {
        this.canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();

            // ダブルクリック+ドラッグ状態をクリア（コンテキストメニュー表示時は通常操作を優先）
            if (this.dblClickDragState.dblClickedElement) {
                this.dblClickDragState.dblClickedElement.setAttribute('draggable', 'true');
            }
            // 共通メソッドでクリーンアップ
            this.cleanupDblClickDragState();
            // プラグイン固有のクリーンアップ
            this.dblClickDragState.lastClickTime = 0; // ダブルクリック検出をリセット
            this.dblClickDragState.lastClickedShape = null;
            this.dblClickDragState.dblClickedShape = null;
            // プレビュー要素を削除
            if (this.dblClickDragState.previewElement) {
                this.dblClickDragState.previewElement.remove();
                this.dblClickDragState.previewElement = null;
            }

            // コンテキストメニュー要求（共通メソッドを使用）
            this.showContextMenuAtEvent(e);
        });
    }

    // setupWindowActivation() は PluginBase 共通メソッドを使用

    // updateWindowConfig() は基底クラス PluginBase で定義

    updatePanelPosition(pos) {
        // 道具パネルの位置を更新
        this.panelpos = pos;
        logger.debug('[FIGURE EDITOR] 道具パネル位置を更新:', pos);

        // 親ウィンドウに道具パネル位置の保存を要求
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: 'update-panel-position',
                fileId: this.realId,
                panelpos: pos
            }, '*');
        }
    }

    async getMenuDefinition() {
        const menuDef = [
            {
                label: '保存',
                submenu: [
                    { label: '元の実身に保存', action: 'save', shortcut: 'Ctrl+S' },
                    { label: '新たな実身に保存', action: 'save-as-new' }
                ]
            },
            {
                label: '表示',
                submenu: [
                    { label: '道具パネル表示オンオフ', action: 'toggle-tool-panel' },
                    { label: '実寸パネル表示', action: 'toggle-real-size-panel' },
                    { label: 'パターン編集', action: 'edit-pattern' },
                    { label: '全画面表示オンオフ', action: 'toggle-fullscreen', shortcut: 'Ctrl+L' },
                    { label: '再表示', action: 'refresh' },
                    { label: '背景色変更', action: 'change-bg-color' }
                ]
            },
            {
                label: '編集',
                submenu: [
                    { label: '取消', action: 'undo' },
                    { label: 'クリップボードへコピー', action: 'copy', shortcut: 'Ctrl+C' },
                    { label: 'クリップボードからコピー', action: 'paste', shortcut: 'Ctrl+V' },
                    { label: 'クリップボードへ移動', action: 'cut', shortcut: 'Ctrl+X' },
                    { label: 'クリップボードから移動', action: 'paste-move', shortcut: 'Ctrl+Z' },
                    { label: '削除', action: 'delete-shape', shortcut: 'Delete' },
                    { separator: true },
                    { label: 'グループ化', action: 'group-shapes' },
                    { label: 'グループ化解除', action: 'ungroup-shapes' },
                    { label: '全て選択', action: 'select-all' },
                    { separator: true },
                    { label: 'いちばん前へ', action: 'bring-to-front' },
                    { label: 'いちばん後へ', action: 'send-to-back' },
                    { label: 'ひとつ前へ', action: 'bring-forward' },
                    { label: 'ひとつ後へ', action: 'send-backward' },
                    { label: '位置あわせ', action: 'align-shapes' }
                ]
            },
            {
                label: '図形操作',
                submenu: [
                    { label: '取消', action: 'undo' },
                    { separator: true },
                    { label: '変形', action: 'transform-shape' },
                    { label: '色反転', action: 'invert-color' },
                    { label: '焼き付け', action: 'burn-shape' },
                    { label: '左右反転', action: 'flip-horizontal' },
                    { label: '上下反転', action: 'flip-vertical' },
                    { label: '左90度回転', action: 'rotate-left' },
                    { label: '右90度回転', action: 'rotate-right' }
                ]
            },
            {
                label: '保護',
                submenu: [
                    { label: '固定化', action: 'lock-shape' },
                    { label: '固定解除', action: 'unlock-shape' },
                    { separator: true },
                    { label: '背景化', action: 'to-background' },
                    { label: '背景解除', action: 'from-background' }
                ]
            },
            {
                label: '書式/印刷',
                submenu: [
                    { label: '用紙枠表示オンオフ', action: 'toggle-paper-frame' },
                    { label: '用紙枠設定', action: 'page-setup' }
                ]
            }
        ];

        // 仮身が選択されている場合は仮身操作メニューを追加（PluginBase共通メソッド）
        await this.buildVirtualObjectContextMenus(menuDef);

        return menuDef;
    }

    async executeMenuAction(action, additionalData) {
        logger.debug('[FIGURE EDITOR] メニューアクション実行:', action);

        // 共通アクションを先に処理
        if (await this.executeCommonMenuAction(action, additionalData)) {
            return;
        }

        switch (action) {
            // 保存
            case 'save':
                await this.saveFile();
                break;

            // 表示
            case 'toggle-tool-panel':
                this.toggleToolPanel();
                break;

            case 'toggle-real-size-panel':
                this.toggleRealSizePanel();
                break;

            case 'edit-pattern':
                this.editPattern();
                break;

            case 'refresh':
                this.refresh();
                break;

            // 編集
            case 'undo':
                this.undo();
                break;

            case 'copy':
                await this.copyShapes();
                break;

            case 'paste':
                await this.pasteShapes();
                break;

            case 'cut':
                await this.cutShapes();
                break;

            case 'paste-move':
                await this.pasteMove();
                break;

            case 'delete-shape':
                await this.deleteSelectedShapes();
                break;

            case 'group-shapes':
                this.groupShapes();
                break;

            case 'ungroup-shapes':
                this.ungroupShapes();
                break;

            case 'select-all':
                this.selectAllShapes();
                break;

            case 'bring-to-front':
                this.bringToFront();
                break;

            case 'send-to-back':
                this.sendToBack();
                break;

            case 'bring-forward':
                this.bringForward();
                break;

            case 'send-backward':
                this.sendBackward();
                break;

            case 'align-shapes':
                this.alignShapes();
                break;

            // 図形操作
            case 'transform-shape':
                this.transformShape();
                break;

            case 'invert-color':
                this.invertColor();
                break;

            case 'burn-shape':
                this.burnShape();
                break;

            case 'flip-horizontal':
                this.flipShapes('horizontal');
                break;

            case 'flip-vertical':
                this.flipShapes('vertical');
                break;

            case 'rotate-left':
                this.rotateShapes(-90);
                break;

            case 'rotate-right':
                this.rotateShapes(90);
                break;

            // 保護
            case 'lock-shape':
                this.lockShape();
                break;

            case 'unlock-shape':
                this.unlockShape();
                break;

            case 'to-background':
                this.toBackground();
                break;

            case 'from-background':
                this.fromBackground();
                break;

            // 書式/印刷
            case 'toggle-paper-frame':
                this.togglePaperFrame();
                break;

            case 'page-setup':
                await this.showPageSetup();
                break;

            default:
                logger.debug('[FIGURE EDITOR] 未実装のアクション:', action);
        }
    }

    // === 表示モード ===
    viewXMLMode() {
        this.viewMode = 'xml';
        this.canvas.style.display = 'none';
        // XML表示用の要素を表示（未実装）
        logger.debug('[FIGURE EDITOR] XMLモード');
    }

    viewCanvasMode() {
        this.viewMode = 'canvas';
        this.canvas.style.display = 'block';
        this.redraw();
        logger.debug('[FIGURE EDITOR] キャンバスモード');
    }

    refresh() {
        this.redraw();
        this.setStatus('再表示しました');
    }

    /**
     * グループの座標をオフセット
     * @param {Object} group - グループオブジェクト
     * @param {number} offsetX - X方向のオフセット
     * @param {number} offsetY - Y方向のオフセット
     */
    offsetGroupCoordinates(group, offsetX, offsetY) {
        if (group.startX !== undefined) group.startX += offsetX;
        if (group.startY !== undefined) group.startY += offsetY;
        if (group.endX !== undefined) group.endX += offsetX;
        if (group.endY !== undefined) group.endY += offsetY;

        if (group.shapes) {
            for (const shape of group.shapes) {
                if (shape.type === 'group') {
                    // ネストされたグループは再帰的に処理
                    this.offsetGroupCoordinates(shape, offsetX, offsetY);
                } else {
                    if (shape.startX !== undefined) shape.startX += offsetX;
                    if (shape.startY !== undefined) shape.startY += offsetY;
                    if (shape.endX !== undefined) shape.endX += offsetX;
                    if (shape.endY !== undefined) shape.endY += offsetY;
                    // polylineのpoints配列もオフセット
                    if (shape.points && Array.isArray(shape.points)) {
                        for (const point of shape.points) {
                            if (point.x !== undefined) point.x += offsetX;
                            if (point.y !== undefined) point.y += offsetY;
                        }
                    }
                }
            }
        }
    }

    redo() {
        if (this.redoStack && this.redoStack.length > 0) {
            const state = this.redoStack.pop();
            this.undoStack.push(JSON.stringify(this.shapes));
            this.shapes = JSON.parse(state);
            this.redraw();
            this.isModified = true;
            this.setStatus('やり直しました');
            // スクロールバー更新を通知
            this.resizeCanvas();
        } else {
            this.setStatus('やり直す操作がありません');
        }
    }

    selectAllShapes() {
        this.selectedShapes = [...this.shapes];
        this.redraw();
        this.setStatus(`${this.selectedShapes.length}個の図形を選択しました`);
    }

    // === 図形操作 ===
    async duplicateShape() {
        if (this.selectedShapes.length === 0) {
            this.setStatus('図形が選択されていません');
            return;
        }

        const duplicated = [];
        const imageSavePromises = [];

        for (const shape of this.selectedShapes) {
            const newShape = JSON.parse(JSON.stringify(shape));
            newShape.startX += 20;
            newShape.startY += 20;
            newShape.endX += 20;
            newShape.endY += 20;

            // 画像セグメントの場合
            if (shape.type === 'image') {
                if (shape.imageElement) {
                    newShape.imageElement = shape.imageElement;
                }
                if (shape.imageData) {
                    newShape.imageData = shape.imageData;
                }
                newShape.imgNo = await this.getNextImageNumber();
                // ファイル名を更新（this.realIdを使用）
                const fileId = this.realId || 'unknown';
                const recordNo = 0;
                newShape.fileName = `${fileId}_${recordNo}_${newShape.imgNo}.png`;

                // 画像ファイルを保存（imageElementがある場合）
                if (shape.imageElement) {
                    imageSavePromises.push(this.saveImageFromElement(shape.imageElement, newShape.fileName));
                    logger.debug('[FIGURE EDITOR] 画像複製: ファイル保存予約', newShape.fileName);
                }
            }

            // ピクセルマップの場合
            if (shape.type === 'pixelmap' && shape.imageData) {
                newShape.imageData = new ImageData(
                    new Uint8ClampedArray(shape.imageData.data),
                    shape.imageData.width,
                    shape.imageData.height
                );
                newShape.pixelmapNo = await this.getNextPixelmapNumber();
                // ファイル名を更新（this.realIdを使用）
                const fileId = this.realId || 'unknown';
                const recordNo = 0;
                newShape.fileName = `${fileId}_${recordNo}_${newShape.pixelmapNo}.png`;

                // ピクセルマップ画像ファイルを保存
                imageSavePromises.push(this.savePixelmapImageFile(newShape.imageData, newShape.fileName));
                logger.debug('[FIGURE EDITOR] ピクセルマップ複製: ファイル保存予約', newShape.fileName);
            }

            // 新しいz-indexを割り当て
            newShape.zIndex = this.getNextZIndex();

            duplicated.push(newShape);
        }

        // 画像ファイルの保存を待つ
        if (imageSavePromises.length > 0) {
            await Promise.all(imageSavePromises);
            logger.debug('[FIGURE EDITOR] 画像ファイル保存完了:', imageSavePromises.length, '件');
        }

        this.shapes.push(...duplicated);
        this.selectedShapes = duplicated;
        this.redraw();
        this.isModified = true;
        this.setStatus(`${duplicated.length}個の図形を複写しました`);

        // 画像またはピクセルマップが含まれている場合は自動保存
        const hasImageOrPixelmap = duplicated.some(shape =>
            shape.type === 'image' || shape.type === 'pixelmap'
        );
        if (hasImageOrPixelmap) {
            logger.debug('[FIGURE EDITOR] 画像/ピクセルマップを複製: 自動保存を実行');
            await this.saveFile();
        }
    }

    groupShapes() {
        if (this.selectedShapes.length < 2) {
            this.setStatus('2つ以上の図形を選択してください');
            return;
        }

        // グループ化処理
        const group = {
            type: 'group',
            shapes: [...this.selectedShapes],
            strokeColor: '#000000',
            fillColor: 'transparent',
            lineWidth: 1,
            zIndex: this.getNextZIndex()
        };

        // グループの境界ボックスを計算
        this.updateGroupBounds(group);

        // 選択された図形を削除
        this.selectedShapes.forEach(shape => {
            const index = this.shapes.indexOf(shape);
            if (index > -1) {
                this.shapes.splice(index, 1);
            }
        });

        this.shapes.push(group);
        this.selectedShapes = [group];
        this.redraw();
        this.isModified = true;
        this.setStatus('図形をグループ化しました');
    }

    updateGroupBounds(group) {
        // グループ内の全図形の境界ボックスを計算
        if (!group.shapes || group.shapes.length === 0) return;

        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        group.shapes.forEach(shape => {
            // グループの場合は再帰的に境界ボックスを更新
            if (shape.type === 'group') {
                this.updateGroupBounds(shape);
            }

            const shapeMinX = Math.min(shape.startX || 0, shape.endX || 0);
            const shapeMaxX = Math.max(shape.startX || 0, shape.endX || 0);
            const shapeMinY = Math.min(shape.startY || 0, shape.endY || 0);
            const shapeMaxY = Math.max(shape.startY || 0, shape.endY || 0);

            minX = Math.min(minX, shapeMinX);
            minY = Math.min(minY, shapeMinY);
            maxX = Math.max(maxX, shapeMaxX);
            maxY = Math.max(maxY, shapeMaxY);
        });

        group.startX = minX;
        group.startY = minY;
        group.endX = maxX;
        group.endY = maxY;
    }

    moveGroupShapes(group, deltaX, deltaY) {
        // グループ内のすべての図形を移動
        if (!group.shapes) return;

        group.shapes.forEach(shape => {
            // 座標を移動
            if (shape.startX !== undefined) shape.startX += deltaX;
            if (shape.startY !== undefined) shape.startY += deltaY;
            if (shape.endX !== undefined) shape.endX += deltaX;
            if (shape.endY !== undefined) shape.endY += deltaY;

            // パスを持つ図形の場合
            if (shape.path) {
                shape.path = shape.path.map(p => ({
                    x: p.x + deltaX,
                    y: p.y + deltaY
                }));
            }

            // ポイントを持つ図形の場合
            if (shape.points) {
                shape.points = shape.points.map(p => ({
                    x: p.x + deltaX,
                    y: p.y + deltaY
                }));
            }

            // ネストされたグループの場合は再帰的に移動
            if (shape.type === 'group' && shape.shapes) {
                this.moveGroupShapes(shape, deltaX, deltaY);
            }
        });
    }

    ungroupShapes() {
        if (this.selectedShapes.length === 0) {
            this.setStatus('図形が選択されていません');
            return;
        }

        let ungrouped = false;
        this.selectedShapes.forEach(shape => {
            if (shape.type === 'group' && shape.shapes) {
                const index = this.shapes.indexOf(shape);
                if (index > -1) {
                    this.shapes.splice(index, 1);
                    this.shapes.push(...shape.shapes);
                    ungrouped = true;
                }
            }
        });

        if (ungrouped) {
            this.selectedShapes = [];
            this.redraw();
            this.isModified = true;
            this.setStatus('グループを解除しました');
        } else {
            this.setStatus('選択された図形にグループがありません');
        }
    }

    // === 重なり順序 ===
    bringToFront() {
        if (this.selectedShapes.length === 0) {
            this.setStatus('図形が選択されていません');
            return;
        }

        // 配列操作ベース: 選択図形を配列最後に移動
        // 1. 選択図形をshapes配列から削除
        const selectedSet = new Set(this.selectedShapes);
        const remainingShapes = this.shapes.filter(shape => !selectedSet.has(shape));

        // 2. 選択図形を配列最後に追加
        this.shapes = [...remainingShapes, ...this.selectedShapes];

        // 3. 配列順序に基づいてz-indexを再採番
        this.reassignZIndicesFromArrayOrder();

        this.redraw();
        this.isModified = true;
        this.setStatus('最前面へ移動しました');
    }

    bringForward() {
        if (this.selectedShapes.length === 0) {
            this.setStatus('図形が選択されていません');
            return;
        }

        // 配列操作ベース: 選択図形を配列内で1つ後ろ（前面側）に移動
        const selectedSet = new Set(this.selectedShapes);

        // 配列を後ろから走査して、選択図形を1つ後ろに移動
        for (let i = this.shapes.length - 2; i >= 0; i--) {
            if (selectedSet.has(this.shapes[i]) && !selectedSet.has(this.shapes[i + 1])) {
                // 選択図形で、次が非選択図形の場合、入れ替え
                [this.shapes[i], this.shapes[i + 1]] = [this.shapes[i + 1], this.shapes[i]];
            }
        }

        // 配列順序に基づいてz-indexを再採番
        this.reassignZIndicesFromArrayOrder();

        this.redraw();
        this.isModified = true;
        this.setStatus('前面へ移動しました');
    }

    sendBackward() {
        if (this.selectedShapes.length === 0) {
            this.setStatus('図形が選択されていません');
            return;
        }

        // 配列操作ベース: 選択図形を配列内で1つ前（背面側）に移動
        const selectedSet = new Set(this.selectedShapes);

        // 配列を前から走査して、選択図形を1つ前に移動
        for (let i = 1; i < this.shapes.length; i++) {
            if (selectedSet.has(this.shapes[i]) && !selectedSet.has(this.shapes[i - 1])) {
                // 選択図形で、前が非選択図形の場合、入れ替え
                [this.shapes[i], this.shapes[i - 1]] = [this.shapes[i - 1], this.shapes[i]];
            }
        }

        // 配列順序に基づいてz-indexを再採番
        this.reassignZIndicesFromArrayOrder();

        this.redraw();
        this.isModified = true;
        this.setStatus('背面へ移動しました');
    }

    sendToBack() {
        if (this.selectedShapes.length === 0) {
            this.setStatus('図形が選択されていません');
            return;
        }

        // 配列操作ベース: 選択図形を通常図形の最初に移動
        // 1. 選択図形をshapes配列から削除
        const selectedSet = new Set(this.selectedShapes);
        const remainingShapes = this.shapes.filter(shape => !selectedSet.has(shape));

        // 2. 背景化図形と通常図形を分離
        const backgroundShapes = remainingShapes.filter(shape => shape.isBackground);
        const normalShapes = remainingShapes.filter(shape => !shape.isBackground);

        // 3. 選択図形を通常図形の最初に配置
        // shapes配列 = [背景化図形...] + [選択図形...] + [通常図形...]
        this.shapes = [...backgroundShapes, ...this.selectedShapes, ...normalShapes];

        // 4. 配列順序に基づいてz-indexを再採番
        this.reassignZIndicesFromArrayOrder();

        this.redraw();
        this.isModified = true;
        this.setStatus('最背面へ移動しました');
    }

    // === 回転ヘルパー ===

    /**
     * drawShapeラッパー用の回転角度を返す（度数法）
     * image/pixelmap/arc系/vobjは内部で回転を処理するため0を返す
     */
    getWrapperRotation(shape) {
        if (shape.type === 'image' || shape.type === 'pixelmap') return 0;
        if (shape.type === 'arc' || shape.type === 'chord' || shape.type === 'elliptical_arc') return 0;
        if (shape.type === 'vobj') return 0;
        return shape.rotation || 0;
    }

    /**
     * 全図形タイプ統一の回転角度を返す（度数法）
     * arc系: shape.angle（ラジアン）を度数法に変換
     * その他: shape.rotation（度数法）
     */
    getEffectiveRotationDeg(shape) {
        if (shape.type === 'arc' || shape.type === 'chord' || shape.type === 'elliptical_arc') {
            return (shape.angle || 0) * 180 / Math.PI;
        }
        if (shape.type === 'vobj') return 0;
        return shape.rotation || 0;
    }

    /**
     * 指定座標を図形の回転中心で逆回転する
     */
    inverseRotatePoint(x, y, shape) {
        const rotation = this.getEffectiveRotationDeg(shape);
        if (rotation === 0) return { x, y };
        const bounds = this.getShapeBoundingBox(shape);
        if (!bounds) return { x, y };
        const cx = (bounds.minX + bounds.maxX) / 2;
        const cy = (bounds.minY + bounds.maxY) / 2;
        const rad = -rotation * Math.PI / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const dx = x - cx;
        const dy = y - cy;
        return {
            x: cx + dx * cos - dy * sin,
            y: cy + dx * sin + dy * cos
        };
    }

    // === 回転・反転 ===
    rotateShapes(angle) {
        if (this.selectedShapes.length === 0) {
            this.setStatus('図形が選択されていません');
            return;
        }

        this.selectedShapes.forEach(shape => {
            // 画像の場合は回転角度を記録
            if (shape.type === 'image' || shape.type === 'pixelmap') {
                shape.rotation = (shape.rotation || 0) + angle;
                // -360から360の範囲に正規化
                while (shape.rotation > 360) shape.rotation -= 360;
                while (shape.rotation < -360) shape.rotation += 360;
                return;
            }

            // 弧の場合は角度を調整
            if (shape.type === 'arc' || shape.type === 'chord' || shape.type === 'elliptical_arc') {
                shape.angle = (shape.angle || 0) + angle * Math.PI / 180;
                return;
            }

            // その他の図形はrotationプロパティを更新（Canvas回転ラッパーで描画）
            shape.rotation = (shape.rotation || 0) + angle;
            // -360から360の範囲に正規化
            while (shape.rotation > 360) shape.rotation -= 360;
            while (shape.rotation < -360) shape.rotation += 360;
        });

        this.redraw();
        this.isModified = true;
        this.setStatus(`${angle}度回転しました`);
    }

    flipShapes(direction) {
        if (this.selectedShapes.length === 0) {
            this.setStatus('図形が選択されていません');
            return;
        }

        this.selectedShapes.forEach(shape => {
            // 画像の場合は反転フラグを記録
            if (shape.type === 'image' || shape.type === 'pixelmap') {
                if (direction === 'horizontal') {
                    shape.flipH = !shape.flipH;
                } else {
                    shape.flipV = !shape.flipV;
                }
                return;
            }

            // 弧の場合は角度と座標を反転
            if (shape.type === 'arc' || shape.type === 'chord' || shape.type === 'elliptical_arc') {
                if (direction === 'horizontal') {
                    // 左右反転：開始角度と終了角度を水平軸で反転
                    const startAngle = shape.startAngle ?? 0;
                    const endAngle = shape.endAngle ?? Math.PI / 2;
                    const angle = shape.angle ?? 0;

                    // 水平軸で反転：Math.PI - angle
                    shape.startAngle = Math.PI - endAngle;
                    shape.endAngle = Math.PI - startAngle;
                    // 回転角度も水平軸で反転
                    shape.angle = -angle;

                    // 位置座標も反転
                    const tempX = shape.startX;
                    shape.startX = shape.endX;
                    shape.endX = tempX;
                } else {
                    // 上下反転：開始角度と終了角度を垂直軸で反転
                    const startAngle = shape.startAngle ?? 0;
                    const endAngle = shape.endAngle ?? Math.PI / 2;
                    const angle = shape.angle ?? 0;

                    // 垂直軸で反転：-angle
                    shape.startAngle = -endAngle;
                    shape.endAngle = -startAngle;
                    // 回転角度も垂直軸で反転
                    shape.angle = -angle;

                    // 位置座標も反転
                    const tempY = shape.startY;
                    shape.startY = shape.endY;
                    shape.endY = tempY;
                }
                return;
            }

            // その他の図形は座標を反転
            if (direction === 'horizontal') {
                // 左右反転：startXとendXを入れ替え
                const tempX = shape.startX;
                shape.startX = shape.endX;
                shape.endX = tempX;
            } else {
                // 上下反転：startYとendYを入れ替え
                const tempY = shape.startY;
                shape.startY = shape.endY;
                shape.endY = tempY;
            }
        });

        this.redraw();
        this.isModified = true;
        this.setStatus(`${direction === 'horizontal' ? '左右' : '上下'}反転しました`);
    }

    // === 選択図形への属性適用 ===

    /**
     * 選択図形に属性を適用する汎用メソッド
     * @param {Function} applyFn - 各図形に適用する関数 (shape) => void
     * @param {string} statusMessage - 完了時のステータスメッセージ
     */
    // 属性適用系メソッドは figure-property-applier.js に移動


    sendCurrentFontSettings() {
        // 選択中の文字枠がある場合はその設定、なければデフォルト設定を返す
        let settings = {
            fontSize: this.defaultFontSize,
            fontFamily: this.defaultFontFamily,
            textColor: this.defaultTextColor,
            decorations: {
                bold: false,
                italic: false,
                underline: false,
                strikethrough: false
            }
        };

        // 選択中の文字枠があればその設定を使用
        const selectedTextbox = this.selectedShapes.find(shape => shape.type === 'document');
        if (selectedTextbox) {
            settings = {
                fontSize: selectedTextbox.fontSize,
                fontFamily: selectedTextbox.fontFamily,
                textColor: selectedTextbox.textColor,
                decorations: { ...selectedTextbox.decorations }
            };
        }

        logger.debug('[FIGURE EDITOR] フォント設定を送信:', settings);

        // 親ウィンドウ経由で道具パネルに設定を送信
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: 'current-font-settings',
                settings: settings,
                fromEditor: true
            }, '*');
        }
    }

    // === 保護 ===
    async showProtectSettings() {
        const result = await this.showMessageDialog(
            '図形を保護しますか？\n保護すると編集できなくなります。',
            [
                { label: '保護する', value: 'protect' },
                { label: 'キャンセル', value: 'cancel' }
            ]
        );

        if (result.value === 'protect') {
            this.isProtected = true;
            this.setStatus('保護を設定しました');
        }
    }

    unprotect() {
        this.isProtected = false;
        this.setStatus('保護を解除しました');
    }

    // === 印刷 ===
    async showPageSetup() {
        // PaperSizeが未初期化なら初期化
        if (!this.paperSize) {
            this.initPaperSize();
            this.paperSize.widthMm = this.paperWidth;
            this.paperSize.lengthMm = this.paperHeight;
        }

        // 用紙サイズ選択肢を生成
        const paperOptions = this.getPaperSizeOptions();
        const currentSizeName = this.paperSize.getSizeName() || 'CUSTOM';

        let paperOptionsHtml = '';
        let lastGroup = '';
        paperOptions.forEach(opt => {
            // グループ分け（A判、B判、その他）
            const group = opt.key.charAt(0);
            if (group !== lastGroup && (group === 'A' || group === 'B' || group === 'L')) {
                if (lastGroup) {
                    paperOptionsHtml += '<option disabled>──────────</option>';
                }
                lastGroup = group;
            }
            const selected = opt.key === currentSizeName ? 'selected' : '';
            paperOptionsHtml += `<option value="${opt.key}" ${selected}>${opt.label}</option>`;
        });
        paperOptionsHtml += '<option disabled>──────────</option>';
        paperOptionsHtml += `<option value="CUSTOM" ${currentSizeName === 'CUSTOM' ? 'selected' : ''}>カスタム</option>`;

        // 現在の値
        const curWidth = Math.round(this.paperSize.widthMm * 10) / 10;
        const curHeight = Math.round(this.paperSize.lengthMm * 10) / 10;
        const curTopMm = Math.round(this.paperSize.topMm * 10) / 10;
        const curBottomMm = Math.round(this.paperSize.bottomMm * 10) / 10;
        const curLeftMm = Math.round(this.paperSize.leftMm * 10) / 10;
        const curRightMm = Math.round(this.paperSize.rightMm * 10) / 10;
        const curImposition = this.paperSize.imposition;

        const dialogHtml = `
            <style>
                /* 親ダイアログの既定入力欄を非表示 */
                #dialog-input-field {
                    display: none !important;
                }
                /* 親ダイアログのパディング/マージンを上書き */
                #input-dialog-message:has(.paper-setup-dialog) {
                    margin-bottom: 2px;
                    padding: 2px;
                }
                #input-dialog:has(.paper-setup-dialog) {
                    padding: 4px;
                }
                #input-dialog:has(.paper-setup-dialog) .dialog-buttons {
                    padding: 2px;
                    margin-top: 0px;
                }
                .paper-setup-dialog {
                    font-family: sans-serif;
                    font-size: 11px;
                    padding: 0;
                }
                .paper-setup-dialog .form-row {
                    display: flex;
                    align-items: center;
                    margin-bottom: 2px;
                }
                .paper-setup-dialog .form-row:last-child {
                    margin-bottom: 0;
                }
                .paper-setup-dialog .form-label {
                    width: 40px;
                    font-weight: normal;
                }
                .paper-setup-dialog .form-input {
                    width: 70px;
                    padding: 2px 4px;
                    border: 1px inset #c0c0c0;
                    font-size: 11px;
                }
                .paper-setup-dialog .form-select {
                    width: 200px;
                    padding: 2px 4px;
                    border: 1px inset #c0c0c0;
                    font-size: 11px;
                }
                .paper-setup-dialog .form-unit {
                    margin-left: 4px;
                    color: #666;
                }
                .paper-setup-dialog .margin-group {
                    margin-left: 10px;
                }
                .paper-setup-dialog .margin-row {
                    display: flex;
                    align-items: center;
                    margin-bottom: 1px;
                }
                .paper-setup-dialog .margin-row:last-child {
                    margin-bottom: 0;
                }
                .paper-setup-dialog .margin-label {
                    width: 20px;
                }
                .paper-setup-dialog .margin-input {
                    width: 50px;
                    padding: 2px 4px;
                    border: 1px inset #c0c0c0;
                    margin-right: 8px;
                    font-size: 11px;
                }
            </style>
            <div class="paper-setup-dialog">
                <div class="form-row">
                    <span class="form-label">用紙:</span>
                    <select id="paperSizeSelect" class="form-select">
                        ${paperOptionsHtml}
                    </select>
                </div>
                <div class="form-row">
                    <span class="form-label">横:</span>
                    <input type="number" id="paperWidth" class="form-input" value="${curWidth}" min="10" max="2000" step="0.1">
                    <span class="form-unit">mm</span>
                    <span style="margin-left: 12px;" class="form-label">縦:</span>
                    <input type="number" id="paperHeight" class="form-input" value="${curHeight}" min="10" max="2000" step="0.1">
                    <span class="form-unit">mm</span>
                </div>
                <div class="form-row">
                    <span class="form-label">余白:</span>
                    <div class="margin-group">
                        <div class="margin-row">
                            <span class="margin-label">上:</span>
                            <input type="number" id="marginTop" class="margin-input" value="${curTopMm}" min="0" max="500" step="0.1">
                            <span class="form-unit">mm</span>
                            <span class="margin-label" style="margin-left: 8px;">左:</span>
                            <input type="number" id="marginLeft" class="margin-input" value="${curLeftMm}" min="0" max="500" step="0.1">
                            <span class="form-unit">mm</span>
                        </div>
                        <div class="margin-row">
                            <span class="margin-label">下:</span>
                            <input type="number" id="marginBottom" class="margin-input" value="${curBottomMm}" min="0" max="500" step="0.1">
                            <span class="form-unit">mm</span>
                            <span class="margin-label" style="margin-left: 8px;">右:</span>
                            <input type="number" id="marginRight" class="margin-input" value="${curRightMm}" min="0" max="500" step="0.1">
                            <span class="form-unit">mm</span>
                        </div>
                    </div>
                </div>
                <div class="form-row">
                    <span class="form-label">割付:</span>
                    <div class="radio-group-inline">
                        <label class="radio-label">
                            <input type="radio" name="imposition" value="0" ${curImposition === 0 ? 'checked' : ''}>
                            <span class="radio-indicator"></span>
                            <span>片面</span>
                        </label>
                        <label class="radio-label">
                            <input type="radio" name="imposition" value="1" ${curImposition === 1 ? 'checked' : ''}>
                            <span class="radio-indicator"></span>
                            <span>見開き</span>
                        </label>
                    </div>
                </div>
            </div>
            <script>
                (function() {
                    const paperSelect = document.getElementById('paperSizeSelect');
                    const widthInput = document.getElementById('paperWidth');
                    const heightInput = document.getElementById('paperHeight');
                    const sizes = ${JSON.stringify(Object.fromEntries(paperOptions.map(o => [o.key, {w: o.widthMm, h: o.lengthMm}])))};

                    // 用紙サイズ選択時に寸法を更新
                    paperSelect.addEventListener('change', function() {
                        const selected = this.value;
                        if (sizes[selected]) {
                            widthInput.value = sizes[selected].w;
                            heightInput.value = sizes[selected].h;
                        }
                    });

                    // 寸法変更時にカスタムに切り替え
                    widthInput.addEventListener('input', function() {
                        paperSelect.value = 'CUSTOM';
                    });
                    heightInput.addEventListener('input', function() {
                        paperSelect.value = 'CUSTOM';
                    });
                })();
            </script>
        `;

        const result = await this.showCustomDialog({
            title: '用紙設定',
            dialogHtml: dialogHtml,
            buttons: [
                { label: '取消', value: 'cancel' },
                { label: '標準設定', value: 'default' },
                { label: '設定', value: 'ok' }
            ],
            defaultButton: 2,
            width: 400
        });

        if (!result) {
            return false;
        }

        if (result.button === 'default') {
            // 標準設定（A4）にリセット
            this.paperSize.resetToDefault();
            this.paperWidth = this.paperSize.widthMm;
            this.paperHeight = this.paperSize.lengthMm;
            this.isModified = true;
            this.setStatus('用紙設定を標準（A4）にリセットしました');
            this.redraw();
            return true;
        } else if (result.button === 'ok') {
            // 設定を適用
            const formData = result.formData || {};

            const width = parseFloat(formData.paperWidth) || this.paperWidth;
            const height = parseFloat(formData.paperHeight) || this.paperHeight;
            const marginTop = parseFloat(formData.marginTop) || 0;
            const marginBottom = parseFloat(formData.marginBottom) || 0;
            const marginLeft = parseFloat(formData.marginLeft) || 0;
            const marginRight = parseFloat(formData.marginRight) || 0;
            const imposition = parseInt(formData.imposition) || 0;

            // PaperSizeに設定
            this.paperSize.widthMm = width;
            this.paperSize.lengthMm = height;
            this.paperSize.topMm = marginTop;
            this.paperSize.bottomMm = marginBottom;
            this.paperSize.leftMm = marginLeft;
            this.paperSize.rightMm = marginRight;
            this.paperSize.imposition = imposition;

            // 互換性のためpaperWidth/paperHeightも更新
            this.paperWidth = width;
            this.paperHeight = height;

            this.isModified = true;
            this.setStatus(`用紙設定を ${width}×${height}mm に更新しました`);
            this.redraw();
            return true;
        }

        return false;
    }

    showPrintPreview() {
        this.setStatus('印刷プレビュー（未実装）');
        logger.debug('[FIGURE EDITOR] 印刷プレビュー');
    }

    print() {
        window.print();
        this.setStatus('印刷を実行しました');
    }

    // === 表示パネル ===
    toggleRealSizePanel() {
        this.realSizePanelVisible = !this.realSizePanelVisible;
        this.setStatus(`実寸パネル: ${this.realSizePanelVisible ? '表示' : '非表示'}`);
        logger.debug('[FIGURE EDITOR] 実寸パネル切り替え');
    }

    editPattern() {
        this.openPatternEditorPanel(this.fillPatternId);
    }

    async alignShapes() {
        if (this.selectedShapes.length === 0) {
            this.setStatus('図形が選択されていません');
            return;
        }

        const isMultiple = this.selectedShapes.length >= 2;
        const topleftDisabled = isMultiple ? '' : 'disabled';
        const topleftLabelClass = isMultiple ? '' : ' disabled';

        const dialogHtml = `
<div style="font-size:11px">
    <div style="display:flex;align-items:flex-start;gap:4px;margin-bottom:8px">
        <span style="font-weight:bold;min-width:60px">基準位置</span>
        <div class="radio-group-vertical">
            <label class="radio-label">
                <input type="radio" name="reference" value="origin">
                <span class="radio-indicator"></span>
                <span>原点</span>
            </label>
            <label class="radio-label">
                <input type="radio" name="reference" value="grid" checked>
                <span class="radio-indicator"></span>
                <span>格子点</span>
            </label>
            <label class="radio-label${topleftLabelClass}">
                <input type="radio" name="reference" value="topleft" ${topleftDisabled}>
                <span class="radio-indicator"></span>
                <span>左上図形</span>
            </label>
        </div>
    </div>
    <div style="display:flex;gap:24px">
        <div style="display:flex;align-items:flex-start;gap:4px">
            <span style="font-weight:bold;min-width:30px">垂直</span>
            <div class="radio-group-vertical">
                <label class="radio-label">
                    <input type="radio" name="vertical" value="top">
                    <span class="radio-indicator"></span>
                    <span>上</span>
                </label>
                <label class="radio-label">
                    <input type="radio" name="vertical" value="center">
                    <span class="radio-indicator"></span>
                    <span>中</span>
                </label>
                <label class="radio-label">
                    <input type="radio" name="vertical" value="bottom">
                    <span class="radio-indicator"></span>
                    <span>下</span>
                </label>
            </div>
        </div>
        <div style="display:flex;align-items:flex-start;gap:4px">
            <span style="font-weight:bold;min-width:30px">水平</span>
            <div class="radio-group-vertical">
                <label class="radio-label">
                    <input type="radio" name="horizontal" value="left">
                    <span class="radio-indicator"></span>
                    <span>左</span>
                </label>
                <label class="radio-label">
                    <input type="radio" name="horizontal" value="center">
                    <span class="radio-indicator"></span>
                    <span>中</span>
                </label>
                <label class="radio-label">
                    <input type="radio" name="horizontal" value="right">
                    <span class="radio-indicator"></span>
                    <span>右</span>
                </label>
            </div>
        </div>
        <script>
        (function() {
            ['vertical', 'horizontal'].forEach(function(groupName) {
                var radios = document.querySelectorAll('input[name="' + groupName + '"]');
                var lastChecked = null;
                radios.forEach(function(radio) {
                    if (radio.checked) lastChecked = radio;
                });
                radios.forEach(function(radio) {
                    radio.addEventListener('click', function() {
                        if (this === lastChecked) {
                            this.checked = false;
                            lastChecked = null;
                        } else {
                            lastChecked = this;
                        }
                    });
                });
            });
        })();
        </script>
    </div>
</div>`;

        const result = await this.showCustomDialog({
            title: '位置あわせ',
            dialogHtml: dialogHtml,
            buttons: [
                { label: '取消', value: 'cancel' },
                { label: '実行', value: 'ok' }
            ],
            defaultButton: 1,
            radios: {
                reference: 'reference',
                vertical: 'vertical',
                horizontal: 'horizontal'
            },
            width: 300
        });

        if (!result || result.button !== 'ok') return;

        const reference = (result.radios && result.radios.reference) || 'grid';
        const vertical = (result.radios && result.radios.vertical) || 'none';
        const horizontal = (result.radios && result.radios.horizontal) || 'none';

        if (vertical === 'none' && horizontal === 'none') return;

        // ロック図形を除外した対象図形リスト
        const targets = this.selectedShapes.filter(s => !s.isLocked && !s.isBackground);
        if (targets.length === 0) {
            this.setStatus('移動可能な図形がありません');
            return;
        }

        // 各図形のバウンディングボックスを取得
        const bboxes = targets.map(s => this.getShapeBoundingBox(s));

        this.saveStateForUndo();

        if (reference === 'origin') {
            // 原点基準: 各図形を原点(0,0)に揃える
            for (let i = 0; i < targets.length; i++) {
                const bbox = bboxes[i];
                if (!bbox) continue;
                let dx = 0, dy = 0;
                if (horizontal === 'left') dx = -bbox.minX;
                else if (horizontal === 'center') dx = -(bbox.minX + bbox.maxX) / 2;
                else if (horizontal === 'right') dx = -bbox.maxX;
                if (vertical === 'top') dy = -bbox.minY;
                else if (vertical === 'center') dy = -(bbox.minY + bbox.maxY) / 2;
                else if (vertical === 'bottom') dy = -bbox.maxY;
                this.moveShapeForAlignment(targets[i], dx, dy);
            }
        } else if (reference === 'grid') {
            // 格子点基準: 各図形を個別に最寄り格子点に揃える
            const interval = this.gridInterval;
            for (let i = 0; i < targets.length; i++) {
                const bbox = bboxes[i];
                if (!bbox) continue;
                let dx = 0, dy = 0;
                if (horizontal === 'left') dx = Math.round(bbox.minX / interval) * interval - bbox.minX;
                else if (horizontal === 'center') {
                    const cx = (bbox.minX + bbox.maxX) / 2;
                    dx = Math.round(cx / interval) * interval - cx;
                } else if (horizontal === 'right') dx = Math.round(bbox.maxX / interval) * interval - bbox.maxX;
                if (vertical === 'top') dy = Math.round(bbox.minY / interval) * interval - bbox.minY;
                else if (vertical === 'center') {
                    const cy = (bbox.minY + bbox.maxY) / 2;
                    dy = Math.round(cy / interval) * interval - cy;
                } else if (vertical === 'bottom') dy = Math.round(bbox.maxY / interval) * interval - bbox.maxY;
                this.moveShapeForAlignment(targets[i], dx, dy);
            }
        } else if (reference === 'topleft') {
            // 左上図形基準: 最上(左)の図形を基準に揃える
            let refIdx = 0;
            for (let i = 1; i < targets.length; i++) {
                if (!bboxes[i]) continue;
                if (!bboxes[refIdx] ||
                    bboxes[i].minY < bboxes[refIdx].minY ||
                    (bboxes[i].minY === bboxes[refIdx].minY && bboxes[i].minX < bboxes[refIdx].minX)) {
                    refIdx = i;
                }
            }
            const refBbox = bboxes[refIdx];
            if (!refBbox) return;

            for (let i = 0; i < targets.length; i++) {
                if (i === refIdx) continue; // 基準図形は移動しない
                const bbox = bboxes[i];
                if (!bbox) continue;
                let dx = 0, dy = 0;
                if (horizontal === 'left') dx = refBbox.minX - bbox.minX;
                else if (horizontal === 'center') dx = (refBbox.minX + refBbox.maxX) / 2 - (bbox.minX + bbox.maxX) / 2;
                else if (horizontal === 'right') dx = refBbox.maxX - bbox.maxX;
                if (vertical === 'top') dy = refBbox.minY - bbox.minY;
                else if (vertical === 'center') dy = (refBbox.minY + refBbox.maxY) / 2 - (bbox.minY + bbox.maxY) / 2;
                else if (vertical === 'bottom') dy = refBbox.maxY - bbox.maxY;
                this.moveShapeForAlignment(targets[i], dx, dy);
            }
        }

        this.redraw();
        this.isModified = true;
        this.setStatus('図形を位置合わせしました');
    }

    /**
     * 位置あわせ用の図形移動（全座標タイプ対応）
     * @param {Object} shape - 対象図形
     * @param {number} dx - X方向の移動量
     * @param {number} dy - Y方向の移動量
     */
    moveShapeForAlignment(shape, dx, dy) {
        if (dx === 0 && dy === 0) return;

        // 基本座標
        if (shape.startX !== undefined) shape.startX += dx;
        if (shape.startY !== undefined) shape.startY += dy;
        if (shape.endX !== undefined) shape.endX += dx;
        if (shape.endY !== undefined) shape.endY += dy;

        // arc系の中心座標
        if (shape.centerX !== undefined) shape.centerX += dx;
        if (shape.centerY !== undefined) shape.centerY += dy;

        // polygon/polyline の頂点配列
        if (shape.points) {
            shape.points.forEach(p => { p.x += dx; p.y += dy; });
        }

        // curve/pencil のパス配列
        if (shape.path) {
            shape.path.forEach(p => { p.x += dx; p.y += dy; });
        }

        // グループの子図形
        if (shape.type === 'group' && shape.shapes) {
            this.moveGroupShapes(shape, dx, dy);
        }

        // 仮身のDOM要素位置更新
        if (shape.type === 'vobj' && shape.vobjElement) {
            const pos = this.logicalToPhysical(shape.startX, shape.startY);
            shape.vobjElement.style.left = `${pos.x}px`;
            shape.vobjElement.style.top = `${pos.y}px`;
        }
        if (shape.type === 'vobj' && shape.expanded && shape.expandedElement) {
            const chsz = (shape.virtualObject && shape.virtualObject.chsz) || DEFAULT_FONT_SIZE;
            const chszPx = window.convertPtToPx(chsz);
            const titleBarHeight = Math.max(chszPx, Math.ceil(chszPx * DEFAULT_LINE_HEIGHT)) + VOBJ_PADDING_VERTICAL + 1;
            const expPos = this.logicalToPhysical(shape.startX, shape.startY + titleBarHeight);
            shape.expandedElement.style.left = `${expPos.x}px`;
            shape.expandedElement.style.top = `${expPos.y}px`;
        }
    }

    // === 図形操作（追加） ===
    transformShape() {
        if (this.readonly) return;
        if (this.selectedShapes.length === 0) {
            this.setStatus('図形が選択されていません');
            return;
        }
        const shape = this.selectedShapes[0];
        const transformableTypes = ['polygon', 'arc', 'chord', 'elliptical_arc', 'curve'];
        if (!transformableTypes.includes(shape.type)) {
            this.setStatus('この図形は変形できません');
            return;
        }
        this.enterTransformMode(shape);
    }

    invertColor() {
        if (this.selectedShapes.length === 0) {
            this.setStatus('図形が選択されていません');
            return;
        }

        this.selectedShapes.forEach(shape => {
            // RGB色を反転（共通ユーティリティを使用）
            const invertHex = window.invertColor;

            shape.strokeColor = invertHex(shape.strokeColor);
            // linePatternIdも同期更新
            if (typeof findSolidColorPatternId === 'function') {
                shape.linePatternId = findSolidColorPatternId(shape.strokeColor);
            }
            if (shape.fillColor && shape.fillColor !== 'transparent') {
                shape.fillColor = invertHex(shape.fillColor);
                // fillPatternIdも同期更新
                if (typeof findSolidColorPatternId === 'function') {
                    shape.fillPatternId = findSolidColorPatternId(shape.fillColor);
                }
            }
        });

        this.redraw();
        this.isModified = true;
        this.setStatus('色を反転しました');
    }

    burnShape() {
        // 選択がピクセルマップ1つであることを確認
        if (this.selectedShapes.length === 0) {
            this.setStatus('図形が選択されていません');
            return;
        }
        if (this.selectedShapes.length !== 1) {
            this.setStatus('ピクセルマップを1つ選択してください');
            return;
        }
        const pixelmap = this.selectedShapes[0];
        if (pixelmap.type !== 'pixelmap') {
            this.setStatus('ピクセルマップを選択してください');
            return;
        }

        // ピクセルマップの枠領域を算出
        const pmMinX = Math.min(pixelmap.startX, pixelmap.endX);
        const pmMinY = Math.min(pixelmap.startY, pixelmap.endY);
        const pmMaxX = Math.max(pixelmap.startX, pixelmap.endX);
        const pmMaxY = Math.max(pixelmap.startY, pixelmap.endY);
        const pmWidth = pmMaxX - pmMinX;
        const pmHeight = pmMaxY - pmMinY;

        if (pmWidth <= 0 || pmHeight <= 0) {
            this.setStatus('ピクセルマップのサイズが不正です');
            return;
        }

        // ピクセルマップより前面（shapes配列で後ろ）にある図形から、枠と重なるものを抽出
        const pmIndex = this.shapes.indexOf(pixelmap);
        const overlappingShapes = [];
        for (let i = pmIndex + 1; i < this.shapes.length; i++) {
            const shape = this.shapes[i];
            if (shape.type === 'vobj') continue; // 仮身はCanvas描画されないため除外
            const bounds = this.getShapeBoundingBox(shape);
            if (!bounds) continue;
            // AABB重なり判定
            if (bounds.maxX > pmMinX && bounds.minX < pmMaxX &&
                bounds.maxY > pmMinY && bounds.minY < pmMaxY) {
                overlappingShapes.push(shape);
            }
        }

        if (overlappingShapes.length === 0) {
            this.setStatus('焼き付ける部品がありません');
            return;
        }

        // Undo用に状態を保存
        this.saveStateForUndo();

        // 一時Canvas作成（枠サイズ基準）
        const burnCanvas = document.createElement('canvas');
        burnCanvas.width = pmWidth;
        burnCanvas.height = pmHeight;
        const burnCtx = burnCanvas.getContext('2d');

        // 1. 既存のImageDataを描画
        if (pixelmap.imageData) {
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = pixelmap.imageData.width;
            tempCanvas.height = pixelmap.imageData.height;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.putImageData(pixelmap.imageData, 0, 0);
            // ImageDataサイズ → 枠サイズに拡大/縮小描画
            burnCtx.drawImage(tempCanvas, 0, 0, pmWidth, pmHeight);
        } else {
            // ImageDataがない場合は背景色で初期化
            burnCtx.fillStyle = pixelmap.backgroundColor || DEFAULT_BGCOL;
            burnCtx.fillRect(0, 0, pmWidth, pmHeight);
        }

        // 2. 重なっている部品を焼き付けCanvasに描画
        //    ctxを一時的に差し替えて既存のdrawShape()を再利用する
        const originalCtx = this.ctx;
        const originalZoomLevel = this.zoomLevel;
        const originalSelectedShapes = this.selectedShapes;
        const originalCurrentShape = this.currentShape;

        this.ctx = burnCtx;
        this.zoomLevel = 1;
        this.selectedShapes = []; // 選択枠の描画を防ぐ
        this.currentShape = null; // 作成中枠の描画を防ぐ

        burnCtx.save();

        // ピクセルマップの回転・反転がある場合、逆変換を適用
        // 焼き付ける部品を「ピクセルマップのImageData座標系」に変換する
        const hasRotation = pixelmap.rotation && pixelmap.rotation !== 0;
        const hasFlip = pixelmap.flipH || pixelmap.flipV;

        if (hasRotation || hasFlip) {
            // ピクセルマップの中心を基準に逆変換
            burnCtx.translate(pmWidth / 2, pmHeight / 2);

            // 逆回転（回転の逆）
            if (hasRotation) {
                burnCtx.rotate(-pixelmap.rotation * Math.PI / 180);
            }

            // 逆反転（反転は自身が逆関数）
            if (hasFlip) {
                const invScaleX = pixelmap.flipH ? -1 : 1;
                const invScaleY = pixelmap.flipV ? -1 : 1;
                burnCtx.scale(invScaleX, invScaleY);
            }

            burnCtx.translate(-pmWidth / 2, -pmHeight / 2);
        }

        // 座標オフセット：ピクセルマップの左上を原点にする
        burnCtx.translate(-pmMinX, -pmMinY);

        // クリッピング：ピクセルマップ枠の範囲内のみ描画
        burnCtx.beginPath();
        burnCtx.rect(pmMinX, pmMinY, pmWidth, pmHeight);
        burnCtx.clip();

        for (const shape of overlappingShapes) {
            this.drawShape(shape);
        }

        burnCtx.restore();

        // ctxと状態を元に戻す
        this.ctx = originalCtx;
        this.zoomLevel = originalZoomLevel;
        this.selectedShapes = originalSelectedShapes;
        this.currentShape = originalCurrentShape;

        // 3. 焼き付け結果のImageDataを取得してピクセルマップを更新
        pixelmap.imageData = burnCtx.getImageData(0, 0, pmWidth, pmHeight);

        // 再描画・変更フラグ設定
        this.redraw();
        this.isModified = true;
        this.setStatus('焼き付けを実行しました');
    }

    // === 保護（追加） ===
    lockShape() {
        if (this.selectedShapes.length === 0) {
            this.setStatus('図形が選択されていません');
            return;
        }

        this.saveStateForUndo();

        this.selectedShapes.forEach(shape => {
            shape.locked = true;
        });

        this.redraw();
        this.isModified = true;
        this.setStatus(`${this.selectedShapes.length}個の図形を固定化しました`);
        logger.debug('[FIGURE EDITOR] 図形を固定化:', this.selectedShapes.map(s => s.type));
    }

    unlockShape() {
        if (this.selectedShapes.length === 0) {
            this.setStatus('図形が選択されていません');
            return;
        }

        this.saveStateForUndo();

        this.selectedShapes.forEach(shape => {
            shape.locked = false;
        });

        this.redraw();
        this.isModified = true;
        this.setStatus(`${this.selectedShapes.length}個の図形の固定を解除しました`);
        logger.debug('[FIGURE EDITOR] 図形の固定を解除:', this.selectedShapes.map(s => s.type));
    }

    toBackground() {
        if (this.selectedShapes.length === 0) {
            this.setStatus('図形が選択されていません');
            return;
        }

        this.saveStateForUndo();

        this.selectedShapes.forEach(shape => {
            shape.isBackground = true;
        });

        this.redraw();
        this.isModified = true;
        this.setStatus(`${this.selectedShapes.length}個の図形を背景化しました`);
        logger.debug('[FIGURE EDITOR] 図形を背景化:', this.selectedShapes.map(s => s.type));
    }

    fromBackground() {
        if (this.selectedShapes.length === 0) {
            this.setStatus('図形が選択されていません');
            return;
        }

        this.saveStateForUndo();

        this.selectedShapes.forEach(shape => {
            shape.isBackground = false;
        });

        this.redraw();
        this.isModified = true;
        this.setStatus(`${this.selectedShapes.length}個の図形の背景化を解除しました`);
        logger.debug('[FIGURE EDITOR] 図形の背景化を解除:', this.selectedShapes.map(s => s.type));
    }

    // === 書式/印刷（追加） ===
    togglePaperFrame() {
        this.paperFrameVisible = !this.paperFrameVisible;
        this.redraw();
        this.setStatus(`用紙枠: ${this.paperFrameVisible ? '表示' : '非表示'}`);
    }

    /**
     * 用紙枠を描画
     * 用紙境界と余白境界を点線で表示
     */
    drawPaperFrame() {
        const ctx = this.ctx;

        // mm を px に変換（96dpi想定）
        const mmToPx = (mm) => mm * 96 / 25.4;

        // 用紙サイズ（mm→px）
        const paperWidthPx = mmToPx(this.paperWidth);
        const paperHeightPx = mmToPx(this.paperHeight);

        // 余白（mm→px）
        let marginTopPx = 0;
        let marginBottomPx = 0;
        let marginLeftPx = 0;
        let marginRightPx = 0;

        if (this.paperSize) {
            marginTopPx = mmToPx(this.paperSize.topMm);
            marginBottomPx = mmToPx(this.paperSize.bottomMm);
            marginLeftPx = mmToPx(this.paperSize.leftMm);
            marginRightPx = mmToPx(this.paperSize.rightMm);
        }

        // キャンバスサイズに基づいて必要なページ数を計算
        const canvasWidth = this.canvas.width;
        const canvasHeight = this.canvas.height;
        const pagesX = Math.ceil(canvasWidth / paperWidthPx);
        const pagesY = Math.ceil(canvasHeight / paperHeightPx);

        // 各ページの用紙枠を描画
        for (let pageY = 0; pageY < pagesY; pageY++) {
            for (let pageX = 0; pageX < pagesX; pageX++) {
                const offsetX = pageX * paperWidthPx;
                const offsetY = pageY * paperHeightPx;

                // 用紙境界（点線）
                ctx.save();
                ctx.strokeStyle = GRAY_COLOR;
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 4]);
                ctx.strokeRect(offsetX, offsetY, paperWidthPx, paperHeightPx);
                ctx.restore();

                // 余白境界（細い点線）
                if (marginTopPx > 0 || marginBottomPx > 0 || marginLeftPx > 0 || marginRightPx > 0) {
                    const marginX = offsetX + marginLeftPx;
                    const marginY = offsetY + marginTopPx;
                    const marginW = paperWidthPx - marginLeftPx - marginRightPx;
                    const marginH = paperHeightPx - marginTopPx - marginBottomPx;

                    if (marginW > 0 && marginH > 0) {
                        ctx.save();
                        ctx.strokeStyle = '#c0c0c0';
                        ctx.lineWidth = 1;
                        ctx.setLineDash([2, 2]);
                        ctx.strokeRect(marginX, marginY, marginW, marginH);
                        ctx.restore();
                    }
                }

                // 見開きの場合、中央に綴じ線を描画
                if (this.paperSize && this.paperSize.imposition === 1) {
                    const centerX = offsetX + paperWidthPx / 2;
                    ctx.save();
                    ctx.strokeStyle = '#a0a0a0';
                    ctx.lineWidth = 1;
                    ctx.setLineDash([4, 4]);
                    ctx.beginPath();
                    ctx.moveTo(centerX, offsetY);
                    ctx.lineTo(centerX, offsetY + paperHeightPx);
                    ctx.stroke();
                    ctx.restore();
                }
            }
        }
    }


    /**
     * 選択中の仮身が指し示す実身を複製
     * 複製した実身の仮身を元の仮身の下に追加
     */
    async duplicateRealObject() {
        if (!this.contextMenuVirtualObject || !this.contextMenuVirtualObject.virtualObj) {
            logger.warn('[FIGURE EDITOR] 選択中の仮身がありません');
            return;
        }

        const realId = this.contextMenuVirtualObject.realId;
        const originalVobj = this.contextMenuVirtualObject.virtualObj;

        // 元の仮身の図形を探す
        const originalShape = this.shapes.find(s => s.type === 'vobj' && s.virtualObject === originalVobj);
        if (!originalShape) {
            logger.warn('[FIGURE EDITOR] 元の仮身図形が見つかりません');
            return;
        }

        const messageId = this.generateMessageId('duplicate-real');

        this.messageBus.send('duplicate-real-object', {
            realId: realId,
            messageId: messageId
        });

        try {
            // レスポンスを待つ（ユーザー入力を待つのでタイムアウト無効）
            const result = await this.messageBus.waitFor('real-object-duplicated', 0, (data) => {
                return data.messageId === messageId;
            });

            if (result.success) {
                // 元の仮身の属性をコピーして新しい仮身を作成
                const newVirtualObject = {
                    link_id: result.newRealId,
                    link_name: result.newName,
                    chsz: originalVobj.chsz || DEFAULT_FONT_SIZE,
                    frcol: originalVobj.frcol || DEFAULT_FRCOL,
                    chcol: originalVobj.chcol || DEFAULT_FRCOL,
                    tbcol: originalVobj.tbcol || DEFAULT_BGCOL,
                    bgcol: originalVobj.bgcol || DEFAULT_BGCOL,
                    pictdisp: originalVobj.pictdisp || 'true',
                    namedisp: originalVobj.namedisp || 'true',
                    roledisp: originalVobj.roledisp || 'false',
                    framedisp: originalVobj.framedisp || 'true',
                    typedisp: originalVobj.typedisp || 'false',
                    updatedisp: originalVobj.updatedisp || 'false',
                    dlen: originalVobj.dlen || 0,
                    applist: originalVobj.applist || {}
                };

                // 元の仮身の下に配置（10px下）
                const chszPx = window.convertPtToPx(newVirtualObject.chsz || DEFAULT_FONT_SIZE);
                const lineHeight = DEFAULT_LINE_HEIGHT;
                const textHeight = Math.ceil(chszPx * lineHeight);
                const newHeight = textHeight + VOBJ_PADDING_VERTICAL;

                const newVobjShape = {
                    type: 'vobj',
                    startX: originalShape.startX,
                    startY: originalShape.endY + 10,
                    endX: originalShape.endX,
                    endY: originalShape.endY + 10 + newHeight,
                    virtualObject: newVirtualObject,
                    strokeColor: newVirtualObject.frcol,
                    textColor: newVirtualObject.chcol,
                    fillColor: newVirtualObject.tbcol,
                    lineWidth: 1,
                    originalHeight: newHeight,
                    zIndex: this.getNextZIndex()
                };

                // 図形に追加
                this.shapes.push(newVobjShape);

                // アイコンを事前読み込み
                const baseRealId = window.RealObjectSystem.extractRealId(result.newRealId);
                this.iconManager.loadIcon(baseRealId).then(iconData => {
                    if (iconData && this.virtualObjectRenderer) {
                        this.virtualObjectRenderer.loadIconToCache(baseRealId, iconData);
                    }
                    // 再描画
                    this.renderVirtualObjectsAsElements();
                    this.redraw();
                });

                // 修正フラグを設定
                this.isModified = true;

                this.setStatus(`実身を複製しました: ${result.newName}`);
            }
        } catch (error) {
            logger.error('[FIGURE EDITOR] 実身複製エラー:', error);
            this.setStatus('実身の複製に失敗しました');
        }
    }

    /**
     * 屑実身操作ウィンドウを開く
     */
    openTrashRealObjects() {
        window.RealObjectSystem.openTrashRealObjects(this);
    }

    /**
     * 背景色をUIに適用（PluginBaseのオーバーライド）
     * @param {string} color - 背景色
     */
    applyBackgroundColor(color) {
        this.bgColor = color;
        this.redraw();
    }

    /**
     * クローズ前の保存処理フック（PluginBase共通ハンドラから呼ばれる）
     * 「保存」が選択された時にファイルを保存
     */
    async onSaveBeforeClose() {
        await this.saveFile();
    }

    // handleCloseRequest() と respondCloseRequest() は PluginBase で定義

    // requestCloseWindow() は基底クラス PluginBase で定義

    // showSaveConfirmDialog() は基底クラス PluginBase で定義

    setStatus(message) {
        logger.debug('[FIGURE EDITOR]', message);
        // 親ウィンドウにステータスメッセージを送信（PluginBaseの共通実装を呼び出し）
        super.setStatus(message);
    }

    // showInputDialog() は基底クラス PluginBase で定義

    // showMessageDialog() は基底クラス PluginBase で定義

    // ピクセルマップモードに入る
    enterPixelmapMode(pixelmapShape) {
        // 枠のサイズをチェック（最小10x10ピクセル）
        const width = Math.abs(pixelmapShape.endX - pixelmapShape.startX);
        const height = Math.abs(pixelmapShape.endY - pixelmapShape.startY);

        logger.debug('[FIGURE EDITOR] enterPixelmapMode 呼び出し - サイズ:', width, 'x', height, 'pixelmapShape:', pixelmapShape);

        if (width < 10 || height < 10) {
            logger.debug('[FIGURE EDITOR] ピクセルマップ枠が小さすぎます。最小サイズ: 10x10ピクセル');
            // 小さすぎる枠は削除
            const index = this.shapes.indexOf(pixelmapShape);
            if (index > -1) {
                this.shapes.splice(index, 1);
                this.redraw();
            }
            return;
        }

        this.isPixelmapMode = true;
        this.editingPixelmap = pixelmapShape;
        this.lastPixelmapX = null;
        this.lastPixelmapY = null;

        // キャンバスツールに切り替え（ダブルクリック等でモードに入った場合に必要）
        this.currentTool = 'canvas';
        this.canvas.style.cursor = 'crosshair';

        // 選択状態をクリア（選択枠の表示を防ぐ）
        this.selectedShapes = [];

        // ピクセルマップ枠に対応するImageDataを初期化（まだない場合）
        if (!pixelmapShape.imageData) {
            // オフスクリーンCanvasを作成してImageDataを初期化
            const offscreen = document.createElement('canvas');
            offscreen.width = width;
            offscreen.height = height;
            const offscreenCtx = offscreen.getContext('2d');

            // 背景色が透明でない場合のみ塗りつぶし
            if (pixelmapShape.backgroundColor && pixelmapShape.backgroundColor !== 'transparent') {
                offscreenCtx.fillStyle = pixelmapShape.backgroundColor;
                offscreenCtx.fillRect(0, 0, width, height);
            }
            // 透明の場合はfillRectしない（ImageDataは自動的に透明(0,0,0,0)で初期化される）

            pixelmapShape.imageData = offscreenCtx.getImageData(0, 0, width, height);
        }

        // 道具パネルに画材ツールを表示するメッセージを送る
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: 'enter-pixelmap-mode'
            }, '*');
        }

        // 画材パネルウィンドウを開く（ピクセルマップの右側に配置）
        const pixelmap = this.editingPixelmap;
        const maxX = Math.max(pixelmap.startX, pixelmap.endX);
        const minY = Math.min(pixelmap.startY, pixelmap.endY);

        // キャンバスの位置を考慮して親ウィンドウ座標に変換
        const canvasRect = this.canvas.getBoundingClientRect();
        const iframeRect = window.frameElement ? window.frameElement.getBoundingClientRect() : { left: 0, top: 0 };
        const panelX = iframeRect.left + canvasRect.left + maxX + 10;
        const panelY = iframeRect.top + canvasRect.top + minY;

        this.openMaterialPanel(panelX, panelY);

        this.redraw();
        logger.debug('[FIGURE EDITOR] ピクセルマップモードに入りました - 編集対象:', this.editingPixelmap);
    }

    // ピクセルマップモードを抜ける
    exitPixelmapMode() {
        // ピクセルマップモードで変更があった場合、保存を予約
        const hadModifications = this.isModified && this.editingPixelmap;

        this.isPixelmapMode = false;
        this.editingPixelmap = null;
        this.lastPixelmapX = null;
        this.lastPixelmapY = null;

        // 画材パネルウィンドウを閉じる（開いていれば）
        if (this.getChildPanelWindowId('material')) {
            this.closeChildPanelWindow('material');
        }

        // 道具パネルに通常モードに戻るメッセージを送る
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: 'exit-pixelmap-mode'
            }, '*');
        }

        // 選択ツールに戻す
        this.currentTool = 'select';
        this.redraw();
        logger.debug('[FIGURE EDITOR] ピクセルマップモードを抜けました');

        // 変更があった場合は自動保存を実行（非同期）
        if (hadModifications) {
            logger.debug('[FIGURE EDITOR] ピクセルマップ編集後の自動保存を実行');
            this.saveFile().catch(error => {
                logger.error('[FIGURE EDITOR] ピクセルマップ編集後の自動保存に失敗:', error);
            });
        }
    }

    // ===== 画材パネル関連メソッド =====

    /**
     * 画材パネルを開く
     * @param {number} x - 表示X座標
     * @param {number} y - 表示Y座標
     */
    async openMaterialPanel(x, y) {
        // 既に開いている場合はそのまま（トグルしない）
        const existingWindowId = this.getChildPanelWindowId('material');
        if (existingWindowId) {
            return;
        }

        try {
            const windowId = await this.openChildPanelWindow('material', {
                panelUrl: 'material-panel.html',
                title: '画材',
                width: 175,
                height: 100,
                x: x,
                y: y,
                noTitleBar: true,
                resizable: false,
                initData: {
                    currentTool: this.pixelmapTool,
                    brushSize: this.pixelmapBrushSize,
                    currentColor: this.strokeColor
                }
            });
            logger.debug('[FIGURE EDITOR] 画材パネルを開きました:', windowId);
        } catch (error) {
            logger.error('[FIGURE EDITOR] 画材パネルを開けませんでした:', error);
        }
    }

    /**
     * パターン編集パネルを開く
     * @param {number} currentPatternId - 現在のパターンID
     */
    async openPatternEditorPanel(currentPatternId) {
        // 既に開いている場合はそのまま
        const existingWindowId = this.getChildPanelWindowId('pattern-editor');
        if (existingWindowId) {
            return;
        }

        // パターンデータを準備
        let patternData = null;
        let pixelColors = null;
        if (currentPatternId >= 2) {
            const customPat = this.customPatterns[currentPatternId];
            if (customPat && customPat.type === 'pattern') {
                patternData = customPat.data;
                pixelColors = customPat.pixelColors || null;
            } else if (typeof DEFAULT_PATTERNS !== 'undefined') {
                const patDef = DEFAULT_PATTERNS[currentPatternId];
                if (patDef && patDef.type === 'pattern') {
                    patternData = patDef.data;
                }
            }
        }

        try {
            const windowId = await this.openChildPanelWindow('pattern-editor', {
                panelUrl: 'pattern-editor.html',
                title: 'パターン編集',
                width: 370,
                height: 350,
                x: 100,
                y: 100,
                noTitleBar: false,
                resizable: false,
                initData: {
                    currentPatternId: currentPatternId,
                    patternData: patternData,
                    pixelColors: pixelColors,
                    customPatterns: this.customPatterns
                }
            });
        } catch (error) {
            // パネルを開けなかった場合は何もしない
        }
    }

    // ピクセルマップ枠内でピクセル描画を行う
    handlePixelmapDraw(x, y) {
        logger.debug('[FIGURE EDITOR] handlePixelmapDraw 呼び出し - 座標:', x, y, 'editingPixelmap:', this.editingPixelmap, 'pixelmapTool:', this.pixelmapTool);

        if (!this.editingPixelmap || !this.editingPixelmap.imageData) {
            logger.debug('[FIGURE EDITOR] handlePixelmapDraw: editingPixelmapまたはimageDataが無効');
            return;
        }

        const pixelmap = this.editingPixelmap;
        const minX = Math.min(pixelmap.startX, pixelmap.endX);
        const minY = Math.min(pixelmap.startY, pixelmap.endY);

        // ピクセルマップ内の座標に変換
        const localX = Math.floor(x - minX);
        const localY = Math.floor(y - minY);

        logger.debug('[FIGURE EDITOR] ローカル座標:', localX, localY, 'ImageDataサイズ:', pixelmap.imageData.width, 'x', pixelmap.imageData.height);

        // 範囲外チェック
        if (localX < 0 || localY < 0 ||
            localX >= pixelmap.imageData.width ||
            localY >= pixelmap.imageData.height) {
            logger.debug('[FIGURE EDITOR] 座標が範囲外');
            return;
        }

        logger.debug('[FIGURE EDITOR] 描画ツール実行:', this.pixelmapTool);

        // 画材ツールに応じた描画処理（線補間対応）
        const hasLastPos = this.lastPixelmapX !== null && this.lastPixelmapY !== null;

        switch (this.pixelmapTool) {
            case 'pencil':
                if (hasLastPos) {
                    this.drawLineTo(pixelmap, this.lastPixelmapX, this.lastPixelmapY, localX, localY, this.strokeColor, 1);
                } else {
                    this.drawPixel(pixelmap, localX, localY, this.strokeColor, 1);
                }
                break;
            case 'eraser':
                // 透明で消去（backgroundColor が transparent または未設定の場合は透明、それ以外は背景色）
                const eraserColor = (!pixelmap.backgroundColor || pixelmap.backgroundColor === 'transparent') ? 'transparent' : pixelmap.backgroundColor;
                if (hasLastPos) {
                    this.drawLineTo(pixelmap, this.lastPixelmapX, this.lastPixelmapY, localX, localY, eraserColor, this.pixelmapBrushSize);
                } else {
                    this.drawPixel(pixelmap, localX, localY, eraserColor, this.pixelmapBrushSize);
                }
                break;
            case 'brush':
                if (hasLastPos) {
                    this.drawLineTo(pixelmap, this.lastPixelmapX, this.lastPixelmapY, localX, localY, this.strokeColor, this.pixelmapBrushSize);
                } else {
                    this.drawPixel(pixelmap, localX, localY, this.strokeColor, this.pixelmapBrushSize);
                }
                break;
            case 'airbrush':
                this.drawAirbrush(pixelmap, localX, localY, this.strokeColor, this.pixelmapBrushSize);
                break;
            case 'paint':
                this.floodFill(pixelmap, localX, localY, this.strokeColor);
                break;
            case 'cutter':
                // アートカッター（選択範囲指定）は別途実装が必要
                break;
        }

        // 前回座標を更新（線補間用）
        this.lastPixelmapX = localX;
        this.lastPixelmapY = localY;

        this.redraw();
        this.isModified = true;
        logger.debug('[FIGURE EDITOR] 描画完了');
    }

    // 単一ピクセルまたはブラシサイズでピクセルを描画
    drawPixel(pixelmap, x, y, color, size = 1) {
        const imageData = pixelmap.imageData;
        const isTransparent = color === 'transparent';
        const rgb = isTransparent ? { r: 0, g: 0, b: 0 } : this.hexToRgb(color);
        const alpha = isTransparent ? 0 : 255;

        const halfSize = Math.floor(size / 2);
        for (let dy = -halfSize; dy <= halfSize; dy++) {
            for (let dx = -halfSize; dx <= halfSize; dx++) {
                const px = x + dx;
                const py = y + dy;

                if (px >= 0 && py >= 0 && px < imageData.width && py < imageData.height) {
                    const index = (py * imageData.width + px) * 4;
                    imageData.data[index] = rgb.r;
                    imageData.data[index + 1] = rgb.g;
                    imageData.data[index + 2] = rgb.b;
                    imageData.data[index + 3] = alpha;
                }
            }
        }
    }

    // 2点間を線で補間描画（Bresenham's Line Algorithm）
    drawLineTo(pixelmap, x0, y0, x1, y1, color, size) {
        const dx = Math.abs(x1 - x0);
        const dy = Math.abs(y1 - y0);
        const sx = x0 < x1 ? 1 : -1;
        const sy = y0 < y1 ? 1 : -1;
        let err = dx - dy;

        while (true) {
            this.drawPixel(pixelmap, x0, y0, color, size);

            if (x0 === x1 && y0 === y1) break;

            const e2 = 2 * err;
            if (e2 > -dy) { err -= dy; x0 += sx; }
            if (e2 < dx) { err += dx; y0 += sy; }
        }
    }

    // エアブラシ効果（ランダムに周辺のピクセルを描画）
    drawAirbrush(pixelmap, x, y, color, size) {
        const imageData = pixelmap.imageData;
        const rgb = this.hexToRgb(color);
        const radius = size * 2;

        // エアブラシ効果：ランダムに周辺ピクセルを描画
        for (let i = 0; i < size * 10; i++) {
            const angle = Math.random() * Math.PI * 2;
            const distance = Math.random() * radius;
            const px = Math.floor(x + Math.cos(angle) * distance);
            const py = Math.floor(y + Math.sin(angle) * distance);

            if (px >= 0 && py >= 0 && px < imageData.width && py < imageData.height) {
                const index = (py * imageData.width + px) * 4;
                imageData.data[index] = rgb.r;
                imageData.data[index + 1] = rgb.g;
                imageData.data[index + 2] = rgb.b;
                imageData.data[index + 3] = 255;
            }
        }
    }

    // 塗りつぶし（フラッドフィル）
    floodFill(pixelmap, startX, startY, fillColor) {
        const imageData = pixelmap.imageData;
        const width = imageData.width;
        const height = imageData.height;
        const data = imageData.data;

        const startIndex = (startY * width + startX) * 4;
        const targetColor = {
            r: data[startIndex],
            g: data[startIndex + 1],
            b: data[startIndex + 2],
            a: data[startIndex + 3]
        };

        const fillRgb = this.hexToRgb(fillColor);

        // 既に同じ色の場合は何もしない
        if (targetColor.r === fillRgb.r &&
            targetColor.g === fillRgb.g &&
            targetColor.b === fillRgb.b) {
            return;
        }

        const stack = [{x: startX, y: startY}];
        const visited = new Set();

        while (stack.length > 0) {
            const {x, y} = stack.pop();
            const key = `${x},${y}`;

            if (visited.has(key)) continue;
            if (x < 0 || y < 0 || x >= width || y >= height) continue;

            const index = (y * width + x) * 4;

            // 色が一致するかチェック
            if (data[index] === targetColor.r &&
                data[index + 1] === targetColor.g &&
                data[index + 2] === targetColor.b &&
                data[index + 3] === targetColor.a) {

                // 色を塗る
                data[index] = fillRgb.r;
                data[index + 1] = fillRgb.g;
                data[index + 2] = fillRgb.b;
                data[index + 3] = 255;

                visited.add(key);

                // 4方向に展開
                stack.push({x: x + 1, y: y});
                stack.push({x: x - 1, y: y});
                stack.push({x: x, y: y + 1});
                stack.push({x: x, y: y - 1});
            }
        }
    }

    // HEX色をRGBに変換（共通ユーティリティを使用）
    hexToRgb(hex) {
        return window.hexToRgb ? window.hexToRgb(hex) : {r: 0, g: 0, b: 0};
    }

    // getImageFilePath は PluginBase の共通実装を使用

    // 特定のタイプの図形を座標から探す
    findShapeAt(x, y, type) {
        for (let i = this.shapes.length - 1; i >= 0; i--) {
            const shape = this.shapes[i];
            if (shape.type === type && this.isPointInShape(x, y, shape)) {
                return shape;
            }
        }
        return null;
    }

    // loadRealObjectData() は基底クラス PluginBase で定義

    // loadDataFileFromParent() は PluginBase のキュー管理付きメソッドを使用

    // loadVirtualObjectMetadata() は FigureVirtualObjectMixin で定義

    /**
     * リサイズプレビュー枠を更新
     */
    updateResizePreviewBox(shape) {
        if (!this.resizePreviewBox) {
            logger.warn('[FIGURE EDITOR] リサイズプレビュー枠が存在しません');
            return;
        }

        // Canvas の論理座標を物理座標に変換し、さらに画面座標に変換
        const rect = this.canvas.getBoundingClientRect();
        const physPos = this.logicalToPhysical(shape.startX, shape.startY);
        const physSize = this.logicalToPhysical(shape.endX - shape.startX, shape.endY - shape.startY);

        const screenX = rect.left + physPos.x;
        const screenY = rect.top + physPos.y;

        // プレビュー枠のサイズと位置を更新
        this.resizePreviewBox.style.left = `${screenX}px`;
        this.resizePreviewBox.style.top = `${screenY}px`;
        this.resizePreviewBox.style.width = `${physSize.x}px`;
        this.resizePreviewBox.style.height = `${physSize.y}px`;

        // 図形の回転をCSS transformで適用
        const rotation = this.getEffectiveRotationDeg(shape);
        if (rotation !== 0) {
            this.resizePreviewBox.style.transformOrigin = 'center center';
            this.resizePreviewBox.style.transform = `rotate(${rotation}deg)`;
        } else {
            this.resizePreviewBox.style.transform = '';
        }
    }

    /**
     * リサイズプレビュー枠を削除
     */
    removeResizePreviewBox() {
        if (this.resizePreviewBox && this.resizePreviewBox.parentNode) {
            this.resizePreviewBox.parentNode.removeChild(this.resizePreviewBox);
            this.resizePreviewBox = null;
            logger.debug('[FIGURE EDITOR] リサイズプレビュー枠を削除しました');
        }
    }


    /**
     * デバッグログ出力（デバッグモード時のみ）
     */
    log(...args) {
        if (this.debug) {
            logger.debug('[FIGURE EDITOR]', ...args);
        }
    }

    /**
     * エラーログ出力（常に出力）
     */
    error(...args) {
        logger.error('[FIGURE EDITOR]', ...args);
    }

    /**
     * 警告ログ出力（常に出力）
     */
    warn(...args) {
        logger.warn('[FIGURE EDITOR]', ...args);
    }


    // requestCopyVirtualObject() と requestDeleteVirtualObject() は
    // PluginBase共通メソッドに移行済み

}


// DOMContentLoadedで初期化
document.addEventListener('DOMContentLoaded', () => {
    window.editor = new BasicFigureEditor();
});
