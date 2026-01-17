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

class BasicFigureEditor extends window.PluginBase {
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
        this.isFullscreen = false;
        this.viewMode = 'canvas'; // 'canvas' or 'xml'
        this.dialogMessageId = 0; // ダイアログメッセージID
        // this.realId は基底クラスで定義済み
        this.isModified = false; // 編集状態フラグ
        this.originalContent = ''; // 保存時の内容
        // imagePathCallbacks, imagePathMessageId は PluginBase.getImageFilePath() に移行済み
        // this.iconData は PluginBase で初期化済み

        // 図形編集用のプロパティ
        this.currentTool = 'select'; // 現在選択中のツール
        this.shapes = []; // 描画された図形のリスト
        this.selectedShapes = []; // 選択中の図形
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

            // 共通初期化処理（windowId設定、スクロール状態送信）
            this.onInit(data);
            logger.debug('[FIGURE EDITOR] [MessageBus] windowId更新:', this.windowId);

            // fileIdを保存（拡張子を除去）
            if (data.fileData) {
                let rawId = data.fileData.realId || data.fileData.fileId;
                this.realId = rawId ? rawId.replace(/_\d+\.xtad$/, '') : null;
                logger.debug('[FIGURE EDITOR] [MessageBus] fileId設定:', this.realId);

                // 背景色の設定
                if (data.fileData.windowConfig && data.fileData.windowConfig.backgroundColor) {
                    this.bgColor = data.fileData.windowConfig.backgroundColor;
                    logger.debug('[FIGURE EDITOR] [MessageBus] ウィンドウ背景色を適用:', this.bgColor);
                }
            }

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

        // scroll メッセージ
        this.messageBus.on('scroll', (data) => {
            logger.debug('[FIGURE EDITOR] [MessageBus] scroll受信:', data);
            this.handleScroll(data.scrollLeft, data.scrollTop);
        });

        // input-dialog-response メッセージ（MessageBusが自動処理）
        this.messageBus.on('input-dialog-response', (data) => {
            logger.debug('[FIGURE EDITOR] [MessageBus] input-dialog-response受信:', data.messageId);
            // sendWithCallback使用時は自動的にコールバックが実行される
        });

        // message-dialog-response メッセージ（MessageBusが自動処理）
        this.messageBus.on('message-dialog-response', (data) => {
            logger.debug('[FIGURE EDITOR] [MessageBus] message-dialog-response受信:', data.messageId);
            // sendWithCallback使用時は自動的にコールバックが実行される
        });

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

        // request-open-material-panel メッセージ（道具パネルから）
        this.messageBus.on('request-open-material-panel', async (data) => {
            await this.openMaterialPanel(data.x, data.y);
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
                if (windowId === data.windowId) {
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
                // fileIdを保存（_数字.xtad の形式を除去して実身IDのみを取得）
                let rawId = data.realId;
                this.realId = rawId ? rawId.replace(/_\d+\.xtad$/i, '') : null;
                logger.debug('[FIGURE EDITOR] [MessageBus] fileId設定:', this.realId, '(元:', rawId, ')');

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

            // 実身データを読み込む
            const realObject = data.realObject;
            if (realObject) {
                // virtualObjからrealIdを取得
                const virtualObj = data.virtualObj;
                let rawId = virtualObj?.link_id;
                if (rawId) {
                    // _数字.xtad の形式を除去して実身IDのみを取得
                    this.realId = rawId.replace(/_\d+\.xtad$/i, '');
                    logger.debug('[FIGURE EDITOR] [MessageBus] fileId設定:', this.realId, '(元:', rawId, ')');
                }

                // データを読み込む（完了を待つ）
                await this.loadFile({
                    realId: this.realId,
                    xmlData: realObject.xtad || realObject.records?.[0]?.xtad || realObject.xmlData
                });

                // スクロール位置を復元（DOM更新完了を待つ）
                const windowConfig = realObject.metadata?.window;
                if (windowConfig && windowConfig.scrollPos) {
                    setTimeout(() => {
                        this.setScrollPosition(windowConfig.scrollPos);
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

        // image-file-path-response メッセージ（レスポンス受信）
        // 自分宛の処理は PluginBase.getImageFilePath() の waitFor で処理
        // 開いた仮身内のプラグインへの転送のみ行う
        this.messageBus.on('image-file-path-response', (data) => {
            const iframes = document.querySelectorAll('iframe');
            iframes.forEach(iframe => {
                if (iframe.contentWindow) {
                    iframe.contentWindow.postMessage({
                        type: 'image-file-path-response',
                        ...data,
                        _messageBus: true,
                        _from: 'BasicFigureEditor'
                    }, '*');
                }
            });
        });

        // user-config-updated メッセージ
        this.messageBus.on('user-config-updated', () => {
            logger.debug('[FIGURE EDITOR] [MessageBus] ユーザ環境設定更新通知を受信');
            this.loadUserConfig();
        });

        // load-data-file-request メッセージ
        this.messageBus.on('load-data-file-request', (data) => {
            // 開いた仮身内のプラグインからのファイル読み込み要求を親ウィンドウに転送
            logger.debug('[FIGURE EDITOR] [MessageBus] load-data-file-request受信、親ウィンドウに転送:', data.fileName);
            // 親ウィンドウに転送（型名を明示的に指定）
            this.messageBus.send('load-data-file-request', data);
        });

        // load-data-file-response メッセージ
        this.messageBus.on('load-data-file-response', (data) => {
            // 親ウィンドウからのファイル読み込みレスポンスを開いた仮身内のプラグインに転送
            logger.debug('[FIGURE EDITOR] [MessageBus] load-data-file-response受信、子iframeに転送:', data.fileName);
            // すべての子iframeに転送（MessageBus形式で送信）
            const iframes = document.querySelectorAll('iframe');
            iframes.forEach(iframe => {
                if (iframe.contentWindow) {
                    iframe.contentWindow.postMessage({
                        type: 'load-data-file-response',
                        ...data,
                        _messageBus: true,
                        _from: 'BasicFigureEditor'
                    }, '*');
                }
            });
        });

        // get-image-file-path メッセージ（開いた仮身内のプラグインからの画像パス取得要求を親ウィンドウに転送）
        this.messageBus.on('get-image-file-path', (data) => {
            logger.debug('[FIGURE EDITOR] [MessageBus] get-image-file-path受信、親ウィンドウに転送:', data.fileName);
            // 親ウィンドウに転送（型名を明示的に指定）
            this.messageBus.send('get-image-file-path', data);
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
            // コンテンツサイズを計算
            const contentSize = this.calculateContentSize();
            const windowWidth = container.clientWidth || 800;
            const windowHeight = container.clientHeight || 600;

            // キャンバスサイズを設定（コンテンツサイズとウィンドウサイズの大きい方、最小サイズも保証）
            const finalWidth = Math.max(contentSize.width, windowWidth, 800);
            const finalHeight = Math.max(contentSize.height, windowHeight, 600);

            this.canvas.width = finalWidth;
            this.canvas.height = finalHeight;

            // キャンバスのCSSサイズを描画バッファサイズと同じに設定
            // これにより、描画可能領域と表示領域が一致します
            this.canvas.style.width = finalWidth + 'px';
            this.canvas.style.height = finalHeight + 'px';

            logger.debug('[FIGURE EDITOR] キャンバスサイズ更新:', finalWidth, 'x', finalHeight, '(コンテンツ:', contentSize.width, 'x', contentSize.height, ', ウィンドウ:', windowWidth, 'x', windowHeight, ')');

            this.redraw();

            // スクロールバー更新を通知
            this.notifyScrollbarUpdate();
        }
    }

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
            }
        });

        // ドラッグ&ドロップイベント
        this.setupDragAndDrop();
    }

    setupDragAndDrop() {
        // 重複登録を防ぐ
        if (this._dragDropSetup) {
            return;
        }
        this._dragDropSetup = true;

        // ドラッグオーバー
        this.canvas.addEventListener('dragover', (e) => {
            e.preventDefault();
            // ドラッグ移動を検出（hasMovedフラグ設定）
            this.detectVirtualObjectDragMove(e);
            // copy と move の両方を受け付ける
            if (e.dataTransfer.effectAllowed === 'move' || e.dataTransfer.effectAllowed === 'copyMove') {
                e.dataTransfer.dropEffect = 'move';
            } else {
                e.dataTransfer.dropEffect = 'copy';
            }
            this.canvas.style.opacity = '0.8';
        });

        // ドラッグリーブ
        this.canvas.addEventListener('dragleave', (e) => {
            e.preventDefault();
            this.canvas.style.opacity = '1.0';
        });

        // ドロップ
        this.canvas.addEventListener('drop', async (e) => {
            e.preventDefault();
            this.canvas.style.opacity = '1.0';

            // URLドロップをチェック（PluginBase共通メソッド）
            const dropX = e.clientX;
            const dropY = e.clientY;
            if (this.checkAndHandleUrlDrop(e, dropX, dropY)) {
                return; // URLドロップは親ウィンドウで処理
            }

            try {
                // 画像ファイルのドロップをチェック
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    const file = e.dataTransfer.files[0];
                    if (file.type.startsWith('image/')) {
                        const rect = this.canvas.getBoundingClientRect();
                        const x = e.clientX - rect.left;
                        const y = e.clientY - rect.top;
                        logger.debug('[FIGURE EDITOR] 画像ファイルドロップ:', file.name);
                        await this.insertImage(x, y, file);
                        return;
                    }
                }

                // PluginBase共通メソッドでdragDataをパース
                const dragData = this.parseDragData(e.dataTransfer);
                if (dragData) {
                    if (dragData.type === 'virtual-object-drag') {
                        // 仮身ドロップ（仮身一覧、基本文章編集などから）
                        logger.info(`[FIGURE EDITOR] 仮身ドロップを検出: source=${dragData.source}, isDuplicateDrag=${dragData.isDuplicateDrag}`);
                        const rect = this.canvas.getBoundingClientRect();
                        const x = e.clientX - rect.left;
                        const y = e.clientY - rect.top;

                        const virtualObjects = dragData.virtualObjects || [dragData.virtualObject];
                        logger.debug('[FIGURE EDITOR] 仮身ドロップ受信:', virtualObjects.length, '個');

                        for (let index = 0; index < virtualObjects.length; index++) {
                            const virtualObject = virtualObjects[index];
                            let targetVirtualObject = virtualObject;

                            // ダブルクリックドラッグ（実身複製）の場合
                            if (dragData.isDuplicateDrag) {
                                logger.info('[FIGURE EDITOR] 実身複製ドラッグを検出');
                                try {
                                    targetVirtualObject = await this.duplicateRealObjectForDrag(virtualObject);
                                    logger.info(`[FIGURE EDITOR] 実身複製成功: ${virtualObject.link_id} -> ${targetVirtualObject.link_id}`);
                                } catch (error) {
                                    logger.error('[FIGURE EDITOR] 実身複製エラー:', error);
                                    continue;
                                }
                            }

                            const offsetX = targetVirtualObject.offsetX || 0;
                            const offsetY = targetVirtualObject.offsetY || 0;
                            // dragDataを渡してmode判定を正確に行う
                            await this.insertVirtualObject(x - offsetX, y - offsetY, targetVirtualObject, dragData);
                        }

                        if (dragData.sourceWindowId !== this.windowId) {
                            this.messageBus.send('cross-window-drop-in-progress', {
                                targetWindowId: this.windowId,
                                sourceWindowId: dragData.sourceWindowId
                            });
                            this.notifyCrossWindowDropSuccess(dragData, virtualObjects);
                        }
                        return;
                    } else if ((dragData.type === 'base-file-copy' || dragData.type === 'user-base-file-copy') && dragData.source === 'base-file-manager') {
                        // 原紙箱からのコピー（システム原紙またはユーザ原紙）
                        const rect = this.canvas.getBoundingClientRect();
                        const x = e.clientX - rect.left;
                        const y = e.clientY - rect.top;
                        this.handleBaseFileDrop(dragData, e.clientX, e.clientY, { dropPosition: { x, y } });
                        return;
                    }
                }
            } catch (error) {
                logger.error('[FIGURE EDITOR] ドロップ処理エラー:', error);
            }
        });

        // クリップボードペースト
        document.addEventListener('paste', async (e) => {
            // このエディタがアクティブな場合のみ処理
            if (!this.canvas || document.activeElement !== this.canvas) {
                return;
            }

            // ローカルクリップボードを優先チェック（図形データ）
            // 直近のローカル操作を優先する（basic-text-editorと同様の挙動）
            if (this.clipboard && this.clipboard.length > 0) {
                e.preventDefault();
                await this.pasteShapes();
                return;
            }

            // ローカルが空の場合、グローバルクリップボードをチェック（仮身データ）
            const globalClipboard = await this.getGlobalClipboard();
            if (globalClipboard && globalClipboard.link_id) {
                e.preventDefault();
                logger.debug('[FIGURE EDITOR] グローバルクリップボードに仮身があります:', globalClipboard.link_name);
                // キャンバス中央に配置
                const x = this.canvas.width / 2;
                const y = this.canvas.height / 2;
                this.insertVirtualObject(x, y, globalClipboard);
                this.setStatus('仮身をクリップボードから貼り付けました');
                return;
            }

            // 画像データをチェック
            const items = e.clipboardData.items;
            for (let i = 0; i < items.length; i++) {
                if (items[i].type.startsWith('image/')) {
                    e.preventDefault();
                    const blob = items[i].getAsFile();
                    logger.debug('[FIGURE EDITOR] 画像をクリップボードからペースト');
                    // キャンバス中央に配置
                    const x = this.canvas.width / 2;
                    const y = this.canvas.height / 2;
                    await this.insertImage(x, y, blob);
                    return;
                }
            }
        });
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
                this.lastMouseX = e.clientX - rect.left + container.scrollLeft;
                this.lastMouseY = e.clientY - rect.top + container.scrollTop;

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

                    const preview = document.createElement('div');
                    preview.className = 'dblclick-drag-preview';
                    preview.style.position = 'absolute';
                    preview.style.border = '2px solid #0078d4';
                    preview.style.backgroundColor = 'rgba(0, 120, 212, 0.1)';
                    preview.style.pointerEvents = 'none';
                    preview.style.zIndex = '10000';
                    preview.style.width = width + 'px';
                    preview.style.height = height + 'px';
                    preview.style.left = shape.startX + 'px';
                    preview.style.top = shape.startY + 'px';

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
                    // マウスアップ位置をキャンバス座標に変換
                    const container = document.querySelector('.editor-container');
                    if (container) {
                        const rect = container.getBoundingClientRect();
                        const canvasX = e.clientX - rect.left + container.scrollLeft;
                        const canvasY = e.clientY - rect.top + container.scrollTop;

                        // handleDoubleClickDragDuplicateメソッドを呼び出し（ドロップ位置を渡す）
                        this.handleDoubleClickDragDuplicate(dblClickedShape, canvasX, canvasY);
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

    selectTool(tool) {
        this.currentTool = tool;
        logger.debug('[FIGURE EDITOR] ツール選択:', tool);

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
                    strokeColor: this.strokeColor,
                    lineWidth: this.lineWidth,
                    lineType: this.lineType,
                    linePattern: this.linePattern, // 後方互換
                    lineConnectionType: this.lineConnectionType,
                    cornerRadius: this.cornerRadius
                }
            }, '*');
        }
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

    handleMouseDown(e) {
        const rect = this.canvas.getBoundingClientRect();
        let x = e.clientX - rect.left;
        let y = e.clientY - rect.top;

        // 格子点拘束を適用
        const snapped = this.snapToGrid(x, y);
        this.startX = snapped.x;
        this.startY = snapped.y;
        this.isDrawing = true;

        if (this.currentTool === 'select') {
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
                linePattern: this.linePattern
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
                    linePattern: this.linePattern,
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
                linePattern: this.linePattern,
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
        let currentX = e.clientX - rect.left;
        let currentY = e.clientY - rect.top;

        // マウス位置を保存（コネクタ表示用）
        this.lastMouseX = currentX;
        this.lastMouseY = currentY;

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

        // ピクセルマップモードでの描画
        if (this.isPixelmapMode && this.currentTool === 'canvas') {
            this.handlePixelmapDraw(currentX, currentY);
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
                    shape.endY = this.resizeOriginalBounds.endY + deltaX / aspectRatio;
                } else {
                    shape.endY = this.resizeOriginalBounds.endY + deltaY;
                    shape.endX = this.resizeOriginalBounds.endX + deltaY * aspectRatio;
                }
            } else {
                // 自由変形
                shape.endX = this.resizeOriginalBounds.endX + deltaX;
                shape.endY = this.resizeOriginalBounds.endY + deltaY;
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

            // 仮身DOM要素のサイズを更新
            if (shape.type === 'vobj' && shape.vobjElement) {
                const newWidth = shape.endX - shape.startX;
                const newHeight = shape.endY - shape.startY;
                shape.vobjElement.style.width = `${newWidth}px`;
                shape.vobjElement.style.height = `${newHeight}px`;
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

                // 展開された仮身のiframe位置を更新
                if (shape.type === 'vobj' && shape.expanded && shape.expandedElement) {
                    const chsz = shape.virtualObject.chsz || 14;
                    const titleBarHeight = chsz + 16;
                    shape.expandedElement.style.left = `${shape.startX}px`;
                    shape.expandedElement.style.top = `${shape.startY + titleBarHeight}px`;
                }

                // 仮身DOM要素の位置を更新
                if (shape.type === 'vobj' && shape.vobjElement) {
                    shape.vobjElement.style.left = `${shape.startX}px`;
                    shape.vobjElement.style.top = `${shape.startY}px`;
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
        } else if (this.isPixelmapMode && this.currentTool === 'canvas') {
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
                const endX = e.clientX - rect.left;
                const endY = e.clientY - rect.top;

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
            this.finishPolygon();
            return;
        }

        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // ダブルクリック位置にある図形を探す
        for (let i = this.shapes.length - 1; i >= 0; i--) {
            const shape = this.shapes[i];
            if (shape.type === 'document' && this.isPointInShape(x, y, shape)) {
                // 文字枠の編集モードに入る
                this.enterTextEditMode(shape);
                return;
            } else if (shape.type === 'pixelmap' && this.isPointInShape(x, y, shape)) {
                // ピクセルマップ枠の編集モードに入る（既にモード中でない場合のみ）
                if (!this.isPixelmapMode) {
                    this.enterPixelmapMode(shape);
                }
                return;
            } else if (shape.type === 'vobj' && this.isPointInShape(x, y, shape)) {
                // 仮身をダブルクリック：defaultOpenプラグインで実身を開く
                // 選択状態にしてから開く
                if (!this.selectedShapes.includes(shape)) {
                    this.selectedShapes = [shape];
                    this.syncSelectedShapeToToolPanel();
                }
                this.openRealObjectWithDefaultApp();
                return;
            }
        }
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
            editor.innerHTML = shape.richContent;
        } else {
            editor.textContent = shape.content || '';
        }

        const minX = Math.min(shape.startX, shape.endX);
        const minY = Math.min(shape.startY, shape.endY);
        const width = Math.abs(shape.endX - shape.startX);
        const height = Math.abs(shape.endY - shape.startY);

        editor.style.position = 'absolute';
        editor.style.left = `${minX}px`;
        editor.style.top = `${minY}px`;
        editor.style.width = `${width}px`;
        editor.style.height = `${height}px`;
        editor.style.fontSize = `${shape.fontSize}px`;
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

        return x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY;
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

            // 右下のハンドル
            if (Math.abs(x - maxX) <= hitArea / 2 && Math.abs(y - maxY) <= hitArea / 2) {
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

    drawShape(shape) {
        this.ctx.strokeStyle = shape.strokeColor;
        this.ctx.fillStyle = shape.fillColor;
        this.ctx.lineWidth = shape.lineWidth;

        // 線種パターンを設定（lineTypeがあればそれを優先、なければlinePatternから変換）
        if (shape.lineType !== undefined) {
            this.applyLineType(shape.lineType);
        } else {
            // 後方互換: linePatternから変換
            this.applyLinePattern(shape.linePattern || 'solid');
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
                    this.ctx.strokeStyle = shape.strokeColor || '#000000';
                    this.ctx.lineWidth = shape.lineWidth || 2;
                    this.ctx.moveTo(shape.points[0].x, shape.points[0].y);
                    for (let i = 1; i < shape.points.length; i++) {
                        this.ctx.lineTo(shape.points[i].x, shape.points[i].y);
                    }
                    this.ctx.stroke();
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

            case 'arc':
                // 扇形 (arc)
                if (shape.centerX !== undefined && shape.centerY !== undefined &&
                    shape.radiusX !== undefined && shape.radiusY !== undefined &&
                    shape.startAngle !== undefined && shape.endAngle !== undefined) {
                    this.ctx.beginPath();
                    this.ctx.moveTo(shape.centerX, shape.centerY);
                    this.ctx.lineTo(shape.startX, shape.startY);
                    this.ctx.ellipse(shape.centerX, shape.centerY, shape.radiusX, shape.radiusY,
                                     shape.angle || 0, shape.startAngle, shape.endAngle, false);
                    this.ctx.lineTo(shape.centerX, shape.centerY);
                    this.ctx.closePath();
                    this.ctx.fill();
                    this.ctx.stroke();
                }
                break;

            case 'chord':
                // 弦 (chord)
                if (shape.centerX !== undefined && shape.centerY !== undefined &&
                    shape.radiusX !== undefined && shape.radiusY !== undefined &&
                    shape.startAngle !== undefined && shape.endAngle !== undefined) {
                    this.ctx.beginPath();
                    this.ctx.ellipse(shape.centerX, shape.centerY, shape.radiusX, shape.radiusY,
                                     shape.angle || 0, shape.startAngle, shape.endAngle, false);
                    this.ctx.closePath();
                    this.ctx.fill();
                    this.ctx.stroke();
                }
                break;

            case 'elliptical_arc':
                // 楕円弧 (elliptical arc) - 線のみで塗りつぶしなし
                if (shape.centerX !== undefined && shape.centerY !== undefined &&
                    shape.radiusX !== undefined && shape.radiusY !== undefined &&
                    shape.startAngle !== undefined && shape.endAngle !== undefined) {
                    this.ctx.beginPath();
                    this.ctx.ellipse(shape.centerX, shape.centerY, shape.radiusX, shape.radiusY,
                                     shape.angle || 0, shape.startAngle, shape.endAngle, false);
                    this.ctx.stroke();
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
    }

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
        // キャンバスをクリア
        this.ctx.fillStyle = this.bgColor;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

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

        // 仮身をDOM要素として描画
        this.renderVirtualObjectsAsElements();
    }

    /**
     * 選択枠点滅用の軽量再描画
     * 仮身のDOM要素は再作成せず、キャンバス上の図形と選択枠のみを再描画
     */
    redrawForSelectionBlink() {
        // キャンバスをクリア
        this.ctx.fillStyle = this.bgColor;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

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

        // 注意: 仮身のDOM要素は再作成しない（パフォーマンス最適化）
        // 既存のDOM要素はそのまま維持される
    }

    drawGrid() {
        const interval = this.gridInterval;
        this.ctx.fillStyle = '#666666'; // より濃い色に変更

        // 格子点を描画（1x1ピクセルで正確に）
        for (let x = 0; x < this.canvas.width; x += interval) {
            for (let y = 0; y < this.canvas.height; y += interval) {
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
                            y += style.fontSize * 1.2;
                            currentLineSegments = [];
                            currentLineWidth = 0;
                        } else {
                            // 空行
                            y += style.fontSize * 1.2;
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
                            y += style.fontSize * 1.2;

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
        // 点滅状態がfalseの場合は選択枠を描画しない
        if (!this.selectionBlinkState) {
            return;
        }

        // getShapeBoundingBox を使用してバウンディングボックスを取得
        const bounds = this.getShapeBoundingBox(shape);
        if (!bounds) {
            return; // バウンディングボックスが取得できない場合はスキップ
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
            return;
        }

        // リサイズハンドルを描画（右下）
        const handleSize = 8;
        this.ctx.fillStyle = '#ffffff';
        this.ctx.strokeStyle = '#ff8f00';
        this.ctx.lineWidth = this.selectionWidth; // ユーザ環境設定の太さを使用
        this.ctx.fillRect(bounds.maxX - handleSize / 2, bounds.maxY - handleSize / 2, handleSize, handleSize);
        this.ctx.strokeRect(bounds.maxX - handleSize / 2, bounds.maxY - handleSize / 2, handleSize, handleSize);
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
            this.ctx.fillStyle = shape.backgroundColor || '#ffffff';
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

    handleKeyboardShortcuts(e) {
        // Ctrl+S: 保存
        if (e.ctrlKey && e.key === 's') {
            e.preventDefault();
            this.saveFile();
            return;
        }

        // Ctrl+E: ウィンドウを閉じる
        if (e.ctrlKey && e.key === 'e') {
            e.preventDefault();
            this.requestCloseWindow();
            return;
        }

        // Ctrl+O: 選択中の仮身をdefaultOpenアプリで開く
        if (e.ctrlKey && e.key === 'o') {
            e.preventDefault();
            this.openRealObjectWithDefaultApp();
            return;
        }

        // Ctrl+L: 全画面表示オンオフ
        if (e.ctrlKey && e.key === 'l') {
            e.preventDefault();
            this.toggleFullscreen();
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

    async insertVirtualObject(x, y, virtualObject, dragData = null) {
        logger.debug('[FIGURE EDITOR] 仮身を配置:', virtualObject.link_name, 'at', x, y);
        // dragDataがある場合はそのmodeを優先、なければローカル状態を使用
        const effectiveMode = dragData?.mode || this.virtualObjectDragState.dragMode;
        // 同一ウィンドウ判定: isDraggingVirtualObjectShapeまたはdragDataのsourceWindowId
        const isSameWindowDrag = this.isDraggingVirtualObjectShape ||
            (dragData && dragData.sourceWindowId === this.windowId);
        logger.debug('[FIGURE EDITOR] ドラッグ状態チェック: isDraggingVirtualObjectShape=', this.isDraggingVirtualObjectShape, 'draggingVirtualObjectShape=', this.draggingVirtualObjectShape ? this.draggingVirtualObjectShape.virtualObject.link_name : 'null', 'effectiveMode=', effectiveMode, 'isSameWindowDrag=', isSameWindowDrag);

        // 同じウィンドウ内での移動かチェック
        // draggingVirtualObjectShapeがnullでも、link_idから既存shapeを探して移動処理を行う
        let oldShape = this.draggingVirtualObjectShape;
        if (isSameWindowDrag && !oldShape && virtualObject.link_id) {
            // link_idから既存のshapeを探す
            oldShape = this.shapes.find(s =>
                s.type === 'vobj' &&
                s.virtualObject &&
                s.virtualObject.link_id === virtualObject.link_id
            );
            if (oldShape) {
                logger.debug('[FIGURE EDITOR] draggingVirtualObjectShapeがnull、link_idから既存shapeを発見:', virtualObject.link_name);
            }
        }

        if (isSameWindowDrag && oldShape) {
            logger.debug('[FIGURE EDITOR] 同じウィンドウ内での仮身ドラッグを検出（モード:', effectiveMode, '）');

            // 移動モードの場合のみ移動、コピーモード（左クリック+右クリック）では仮身コピーを作成
            const shouldMove = effectiveMode === 'move';

            // 移動モードの場合、既存のshapeの座標のみ更新（新しいshapeは作成しない）
            if (shouldMove) {
                logger.debug('[FIGURE EDITOR] 移動モード（shouldMove=true）: 既存shapeの座標を更新');

                // Undo用に状態を保存
                this.saveStateForUndo();

                // 幅と高さは既存のshapeから取得（サイズを保持）
                const width = oldShape.endX - oldShape.startX;
                const height = oldShape.endY - oldShape.startY;
                logger.debug('[FIGURE EDITOR] 既存のshapeサイズを使用: width=', width, 'height=', height);

                // 既存のshapeの座標を更新
                oldShape.startX = x;
                oldShape.startY = y;
                oldShape.endX = x + width;
                oldShape.endY = y + height;

                // 接続されている線の端点を更新
                const connections = this.getConnectedLines(oldShape);
                if (connections.length > 0) {
                    logger.debug('[FIGURE EDITOR] 接続線を', connections.length, '本検出、端点を更新');

                    connections.forEach(conn => {
                        // コネクタポイントを取得
                        const connectorPoints = this.getConnectorPoints(oldShape);
                        const connectorPoint = connectorPoints.find(p => p.index === conn.connectorIndex);

                        if (connectorPoint) {
                            // 線の端点座標を更新
                            if (conn.endpoint === 'start') {
                                conn.line.startX = connectorPoint.x;
                                conn.line.startY = connectorPoint.y;
                                logger.debug('[FIGURE EDITOR] 線の始点を更新:', connectorPoint.x, connectorPoint.y);
                            } else {
                                conn.line.endX = connectorPoint.x;
                                conn.line.endY = connectorPoint.y;
                                logger.debug('[FIGURE EDITOR] 線の終点を更新:', connectorPoint.x, connectorPoint.y);
                            }
                        }
                    });
                }

                // cross-window-drop-successで削除されないようにフラグをクリア
                this.isDraggingVirtualObjectShape = false;
                this.draggingVirtualObjectShape = null;

                this.isModified = true;
                this.setStatus(`仮身「${virtualObject.link_name}」を移動しました`);
                // resizeCanvas()がredraw()を呼ぶので、ここでは呼ばない
                this.resizeCanvas();
                return;
            }
        }

        // 通常の仮身配置（新規追加、またはコピーモード）
        // Undo用に状態を保存
        this.saveStateForUndo();

        // 幅と高さを決定（virtualObjectに含まれていればそれを使用、なければデフォルト値を計算）
        let width, height;

        if (virtualObject.width && virtualObject.heightPx) {
            // リサイズされた値がある場合はそれを使用
            width = virtualObject.width;
            height = virtualObject.heightPx;
        } else {
            // デフォルト値を計算
            const chsz = virtualObject.chsz || 14;
            const chszPx = window.convertPtToPx(chsz);
            const lineHeight = 1.2;
            const textHeight = Math.ceil(chszPx * lineHeight);
            width = 100;
            height = textHeight + 8; // 閉じた仮身の高さ
        }

        // 仮身を図形として追加
        const voShape = {
            type: 'vobj',
            startX: x,
            startY: y,
            endX: x + width,
            endY: y + height,
            virtualObject: virtualObject,
            strokeColor: virtualObject.frcol || '#000000',
            textColor: virtualObject.chcol || '#000000',
            fillColor: virtualObject.tbcol || '#ffffff',
            lineWidth: 1,
            originalHeight: height,  // 元の高さを保存
            zIndex: this.getNextZIndex()
        };

        this.shapes.push(voShape);

        // refCount+1が必要なケース:
        // 1. コピーモードでのドロップ
        // 2. ペースト操作（dragDataなし、ドラッグ中でない）
        // 注: 移動モードのクロスウィンドウドロップはソース側でdeleteVirtualObjectShapesを使用し、
        //     refCountは変更しない（移動は参照の移動であり、増減ではない）
        const shouldIncrementRefCount = effectiveMode === 'copy' ||
            (!dragData && !this.isDraggingVirtualObjectShape);
        if (shouldIncrementRefCount) {
            this.requestCopyVirtualObject(virtualObject.link_id);
        }

        this.isModified = true;
        this.setStatus(`仮身「${virtualObject.link_name}」を配置しました`);
        // resizeCanvas()がredraw()を呼ぶので、ここでは呼ばない
        this.resizeCanvas();
    }

    addVirtualObjectFromRealId(realId, name, dropPosition, applist) {
        logger.debug('[FIGURE EDITOR] 原紙箱から仮身を追加:', name, 'at', dropPosition);

        // メニュー文字サイズを取得（ユーザ環境設定から）
        const menuFontSize = localStorage.getItem('menu-font-size') || '14';
        const chsz = parseFloat(menuFontSize);

        // デフォルト値で仮身オブジェクトを作成
        const virtualObj = {
            link_id: realId,
            link_name: name,
            width: 150,
            heightPx: 30,
            chsz: chsz,  // メニュー文字サイズを使用
            frcol: '#000000',
            chcol: '#000000',
            tbcol: '#ffffff',
            bgcol: '#ffffff',
            dlen: 0,
            pictdisp: 'true',  // ピクトグラムを表示
            namedisp: 'true',  // 名称を表示
            applist: applist || {}
        };

        // ドロップ位置に仮身を配置
        this.insertVirtualObject(dropPosition.x, dropPosition.y, virtualObj);
        logger.debug('[FIGURE EDITOR] 原紙箱から仮身追加完了');
    }

    // getGlobalClipboard() は基底クラス PluginBase で定義

    async insertImage(x, y, file) {
        logger.debug('[FIGURE EDITOR] 画像を配置:', file.name, 'at', x, y);

        // Undo用に状態を保存
        this.saveStateForUndo();

        // 画像をロード
        const img = new Image();
        const reader = new FileReader();

        return new Promise((resolve, reject) => {
            reader.onload = async (e) => {
                img.onload = async () => {
                    logger.debug('[FIGURE EDITOR] 画像ロード完了:', img.width, 'x', img.height);

                    // 画像が大きすぎる場合は縮小（最大10000px）
                    const maxSize = 10000;
                    let width = img.width;
                    let height = img.height;

                    if (width > maxSize || height > maxSize) {
                        const scale = Math.min(maxSize / width, maxSize / height);
                        width = width * scale;
                        height = height * scale;
                    }

                    // 画像番号を取得
                    const imgNo = await this.getNextImageNumber();

                    // ファイル名を生成: fileId_recordNo_imgNo.png
                    const fileId = this.realId || 'unknown';
                    const recordNo = 0;  // 常に0（レコード番号は使用しない）
                    const savedFileName = `${fileId}_${recordNo}_${imgNo}.png`;

                    // 画像ファイルを保存
                    await this.saveImageFile(file, savedFileName);

                    // 画像を図形として追加
                    const imageShape = {
                        type: 'image',
                        startX: x - width / 2,  // 中心に配置
                        startY: y - height / 2,
                        endX: x + width / 2,
                        endY: y + height / 2,
                        imageElement: img,
                        imageData: e.target.result,  // Base64データ（後方互換性のため保持）
                        fileName: savedFileName,  // 保存されたファイル名
                        originalFileName: file.name,  // 元のファイル名
                        mimeType: file.type,
                        imgNo: imgNo,
                        rotation: 0,
                        flipH: false,
                        flipV: false,
                        zIndex: this.getNextZIndex()
                    };

                    this.shapes.push(imageShape);
                    this.redraw();
                    this.isModified = true;
                    this.hasUnsavedChanges = true;
                    this.setStatus(`画像「${file.name}」を配置しました`);
                    // スクロールバー更新を通知
                    this.resizeCanvas();
                    resolve();
                };

                img.onerror = () => {
                    logger.error('[FIGURE EDITOR] 画像読み込みエラー');
                    this.setStatus('画像の読み込みに失敗しました');
                    reject(new Error('画像読み込みエラー'));
                };

                img.src = e.target.result;
            };

            reader.onerror = () => {
                logger.error('[FIGURE EDITOR] ファイル読み込みエラー');
                this.setStatus('ファイルの読み込みに失敗しました');
                reject(new Error('ファイル読み込みエラー'));
            };

            reader.readAsDataURL(file);
        });
    }

    // getNextImageNumber は PluginBase の共通実装を使用

    /**
     * メモリ上の最大画像番号を取得（PluginBase.getNextImageNumber から呼ばれる）
     * @returns {number} 最大画像番号（-1で画像なし）
     */
    getMemoryMaxImageNumber() {
        let maxImgNo = -1;
        this.shapes.forEach(shape => {
            if (shape.type === 'image' && shape.imgNo !== undefined) {
                maxImgNo = Math.max(maxImgNo, shape.imgNo);
            }
        });
        return maxImgNo;
    }

    async getNextPixelmapNumber() {
        // メモリ上の最大値を取得
        let maxPixelmapNo = -1;
        this.shapes.forEach(shape => {
            if (shape.type === 'pixelmap' && shape.pixelmapNo !== undefined) {
                maxPixelmapNo = Math.max(maxPixelmapNo, shape.pixelmapNo);
            }
        });

        // ディスク上の最大値も取得
        if (this.realId) {
            try {
                const diskNextNo = await this.getNextImageFileNumber(this.realId, 0);
                maxPixelmapNo = Math.max(maxPixelmapNo, diskNextNo - 1);
            } catch (error) {
                // ディスク取得失敗時はメモリのみで判断
            }
        }

        return maxPixelmapNo + 1;
    }

    // saveImageFile, deleteImageFile, savePixelmapImageFile, saveImageFromElement は
    // PluginBase の共通実装を使用

    async deleteSelectedShapes() {
        if (this.selectedShapes.length === 0) return;

        // 保護されている図形をフィルタリング
        const protectedShapes = this.selectedShapes.filter(shape =>
            shape.locked || shape.isBackground
        );
        const deletableShapes = this.selectedShapes.filter(shape =>
            !shape.locked && !shape.isBackground
        );

        // 保護されている図形がある場合は警告を表示
        if (protectedShapes.length > 0) {
            const protectionTypes = protectedShapes.map(shape => {
                if (shape.isBackground) return '背景化';
                if (shape.locked) return '固定化';
                return '';
            }).filter(t => t).join('、');

            logger.debug('[FIGURE EDITOR] 保護されている図形が含まれているため削除できません:', protectionTypes);
            this.setStatus(`${protectedShapes.length}個の図形が保護されているため削除できません (${protectionTypes})`);

            // 削除可能な図形がない場合は終了
            if (deletableShapes.length === 0) {
                return;
            }
        }

        // 画像またはピクセルマップが含まれているかチェック（後で自動保存するため）
        const hasImageOrPixelmap = deletableShapes.some(shape =>
            shape.type === 'image' || shape.type === 'pixelmap'
        );

        // 削除可能な図形のみ削除
        deletableShapes.forEach(shape => {
            // 仮身の場合はDOM要素を削除
            if (shape.type === 'vobj') {
                // vobjElement（仮身のDOM要素）を削除
                if (shape.vobjElement && shape.vobjElement.parentNode) {
                    shape.vobjElement.parentNode.removeChild(shape.vobjElement);
                }

                // expandedElement（開いた仮身のiframe要素）を削除
                if (shape.expanded && shape.expandedElement) {
                    shape.expandedElement.remove();
                    delete shape.expandedElement;
                }

                // refCount-1（ユーザーによる削除/カット）
                this.requestDeleteVirtualObject(shape.virtualObject.link_id);
            }

            // 画像の場合はPNGファイルを削除
            if (shape.type === 'image' && shape.fileName) {
                this.deleteImageFile(shape.fileName);
            }

            // ピクセルマップの場合もPNGファイルを削除
            if (shape.type === 'pixelmap' && shape.fileName) {
                this.deleteImageFile(shape.fileName);
            }

            const index = this.shapes.indexOf(shape);
            if (index > -1) {
                this.shapes.splice(index, 1);
            }
        });

        // 削除された図形を選択から除外し、保護された図形のみを選択状態に保つ
        this.selectedShapes = protectedShapes;
        this.redraw();
        this.isModified = true;
        // スクロールバー更新を通知
        this.resizeCanvas();

        // 画像またはピクセルマップが含まれていた場合は削除後に自動保存
        if (hasImageOrPixelmap) {
            logger.debug('[FIGURE EDITOR] 画像/ピクセルマップを削除後: 自動保存を実行');
            await this.saveFile();
        }
    }

    /**
     * 仮身図形を削除する（共通処理）
     * @param {Array} shapesToDelete - 削除する仮身図形の配列
     * @param {Object} options - オプション {redraw: boolean, setModified: boolean}
     */
    deleteVirtualObjectShapes(shapesToDelete, options = {redraw: true, setModified: true}) {
        // 削除する図形のインデックスを記録（降順でソート）
        const indicesToDelete = shapesToDelete
            .map(s => this.shapes.indexOf(s))
            .filter(index => index > -1)
            .sort((a, b) => b - a); // 降順でソート（後ろから削除）

        logger.debug('[FIGURE EDITOR] 削除するインデックス:', indicesToDelete);

        shapesToDelete.forEach(s => {
            // 図形を削除
            const index = this.shapes.indexOf(s);
            if (index > -1) {
                this.shapes.splice(index, 1);
            }

            // 選択状態をクリア
            const selectedIndex = this.selectedShapes.indexOf(s);
            if (selectedIndex > -1) {
                this.selectedShapes.splice(selectedIndex, 1);
            }

            // DOM要素を削除
            if (s.vobjElement && s.vobjElement.parentNode) {
                s.vobjElement.parentNode.removeChild(s.vobjElement);
                logger.debug('[FIGURE EDITOR] 仮身DOM要素を削除:', s.virtualObject.link_name);
            }

            // 展開されたiframeがあれば削除
            if (s.expandedElement && s.expandedElement.parentNode) {
                s.expandedElement.parentNode.removeChild(s.expandedElement);
            }
        });

        // 削除後、接続線のインデックスを更新
        indicesToDelete.forEach(deletedIndex => {
            this.shapes.forEach(shape => {
                if (shape.type === 'line') {
                    // startConnection のインデックスを更新
                    if (shape.startConnection && shape.startConnection.shapeId > deletedIndex) {
                        const oldIndex = shape.startConnection.shapeId;
                        shape.startConnection.shapeId--;
                        logger.debug('[FIGURE EDITOR] 線の始点接続インデックスを更新:', oldIndex, '→', shape.startConnection.shapeId);
                    }
                    // endConnection のインデックスを更新
                    if (shape.endConnection && shape.endConnection.shapeId > deletedIndex) {
                        const oldIndex = shape.endConnection.shapeId;
                        shape.endConnection.shapeId--;
                        logger.debug('[FIGURE EDITOR] 線の終点接続インデックスを更新:', oldIndex, '→', shape.endConnection.shapeId);
                    }
                }
            });
        });

        // 再描画
        if (options.redraw) {
            this.redraw();
        }
        if (options.setModified) {
            this.isModified = true;
        }
    }

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

    async loadFile(fileData) {
        try {
            logger.debug('[FIGURE EDITOR] ファイル読み込み:', fileData);

            this.currentFile = fileData;

            // XMLデータを解析して図形を読み込む
            if (fileData.xmlData) {
                this.parseXmlTadData(fileData.xmlData);
            } else {
                // 新規ファイルの場合は空のキャンバス
                this.shapes = [];
                this.redraw();
            }

            this.originalContent = JSON.stringify(this.shapes);
            this.isModified = false;

            // スクロールバー更新を通知
            this.resizeCanvas();

        } catch (error) {
            logger.error('[FIGURE EDITOR] ファイル読み込みエラー:', error);
        }
    }

    async parseXmlTadData(xmlData) {
        // XMLから図形情報を抽出
        this.log('XML解析:', xmlData);

        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlData, 'text/xml');

            // パースエラーチェック
            const parserError = xmlDoc.querySelector('parsererror');
            if (parserError) {
                logger.error('[FIGURE EDITOR] XML解析エラー:', parserError.textContent);
                this.shapes = [];
                this.redraw();
                return;
            }

            // 用紙サイズを取得（<paper>要素を優先、フォールバックで<papersize>も対応）
            const paperElements = xmlDoc.querySelectorAll('paper');
            if (paperElements.length > 0) {
                // <paper>要素があれば解析（PluginBase共通メソッド使用）
                paperElements.forEach(paper => {
                    this.parsePaperElement(paper);
                });
                // paperSize から paperWidth/paperHeight を同期
                if (this.paperSize) {
                    this.paperWidth = this.paperSize.widthMm;
                    this.paperHeight = this.paperSize.lengthMm;
                }
            } else {
                // 旧形式の<papersize>要素（互換性維持）
                const papersize = xmlDoc.querySelector('papersize');
                if (papersize) {
                    this.paperWidth = parseFloat(papersize.getAttribute('width')) || 210;
                    this.paperHeight = parseFloat(papersize.getAttribute('height')) || 297;
                    // PaperSizeインスタンスも初期化
                    this.initPaperSize();
                    this.paperSize.widthMm = this.paperWidth;
                    this.paperSize.lengthMm = this.paperHeight;
                }
            }

            // <docmargin>要素をパース（余白設定）
            const docmarginElements = xmlDoc.querySelectorAll('docmargin');
            if (docmarginElements.length > 0) {
                const docmargin = docmarginElements[0];
                if (!this.paperMargin) {
                    this.paperMargin = new window.PaperMargin();
                }
                this.paperMargin.top = parseFloat(docmargin.getAttribute('top')) || 0;
                this.paperMargin.bottom = parseFloat(docmargin.getAttribute('bottom')) || 0;
                this.paperMargin.left = parseFloat(docmargin.getAttribute('left')) || 0;
                this.paperMargin.right = parseFloat(docmargin.getAttribute('right')) || 0;
            }

            // 図形セグメント全体を取得
            const figureElem = xmlDoc.querySelector('figure');
            if (!figureElem) {
                logger.debug('[FIGURE EDITOR] 図形セグメントが見つかりません');
                this.shapes = [];
                this.redraw();
                return;
            }

            // 図形要素を解析
            this.shapes = [];

            // figScaleデフォルト初期化（UNITS型: -72 = 72DPI）
            this.figScale = { hunit: -72, vunit: -72 };

            // figView/figDraw/figScale要素から設定情報を読み込む
            const figViewElem = figureElem.querySelector('figView');
            const figDrawElem = figureElem.querySelector('figDraw');
            const figScaleElem = figureElem.querySelector('figScale');

            if (figViewElem) {
                // 表示領域を読み込み（今後のキャンバスサイズ設定に使用可能）
                this.figView = {
                    top: parseFloat(figViewElem.getAttribute('top')) || 0,
                    left: parseFloat(figViewElem.getAttribute('left')) || 0,
                    right: parseFloat(figViewElem.getAttribute('right')) || this.canvas.width,
                    bottom: parseFloat(figViewElem.getAttribute('bottom')) || this.canvas.height
                };
            }
            if (figDrawElem) {
                // 描画領域を読み込み
                this.figDraw = {
                    top: parseFloat(figDrawElem.getAttribute('top')) || 0,
                    left: parseFloat(figDrawElem.getAttribute('left')) || 0,
                    right: parseFloat(figDrawElem.getAttribute('right')) || this.canvas.width,
                    bottom: parseFloat(figDrawElem.getAttribute('bottom')) || this.canvas.height
                };
            }
            if (figScaleElem) {
                // スケール設定を読み込み（PluginBase共通メソッド使用）
                this.figScale = this.parseDocScaleElement(figScaleElem);
            }

            // 座標変換状態を保持
            let pendingTransform = null;

            // figure要素の子要素を順番に処理（text+documentの組み合わせを認識するため）
            const children = Array.from(figureElem.children);
            for (let i = 0; i < children.length; i++) {
                const elem = children[i];
                const tagName = elem.tagName.toLowerCase();

                // transform要素を検出
                if (tagName === 'transform') {
                    pendingTransform = {
                        dh: parseFloat(elem.getAttribute('dh')) || 0,
                        dv: parseFloat(elem.getAttribute('dv')) || 0,
                        hangle: parseFloat(elem.getAttribute('hangle')) || 0,
                        vangle: parseFloat(elem.getAttribute('vangle')) || 0
                    };
                    continue;  // 次の要素へ
                }

                // figView/figDraw/figScale要素は上で処理済みなのでスキップ
                if (tagName === 'figview' || tagName === 'figdraw' || tagName === 'figscale') {
                    continue;
                }

                // 図形要素をパース
                let shape = null;
                if (tagName === 'line') {
                    shape = this.parseLineElement(elem);
                } else if (tagName === 'rect') {
                    shape = this.parseRectElement(elem);
                } else if (tagName === 'ellipse') {
                    shape = this.parseEllipseElement(elem);
                } else if (tagName === 'text') {
                    // 次の要素がdocumentか確認（文字枠の場合）
                    const nextElem = i + 1 < children.length ? children[i + 1] : null;
                    if (nextElem && nextElem.tagName.toLowerCase() === 'document') {
                        // 文字枠として解析
                        shape = this.parseDocumentElement(elem, nextElem);
                        i++; // documentもスキップ
                    } else {
                        // 通常のtext要素として解析（互換性のため）
                        shape = this.parseTextElement(elem);
                    }
                } else if (tagName === 'polyline') {
                    shape = this.parsePolylineElement(elem);
                } else if (tagName === 'spline') {
                    shape = this.parseSplineElement(elem);
                } else if (tagName === 'curve') {
                    shape = this.parseCurveElement(elem);
                } else if (tagName === 'polygon') {
                    shape = this.parsePolygonElement(elem);
                } else if (tagName === 'link') {
                    shape = this.parseLinkElement(elem);
                } else if (tagName === 'arc') {
                    shape = this.parseArcElement(elem);
                } else if (tagName === 'chord') {
                    shape = this.parseChordElement(elem);
                } else if (tagName === 'elliptical_arc') {
                    shape = this.parseEllipticalArcElement(elem);
                } else if (tagName === 'image') {
                    shape = this.parseImageElement(elem);
                } else if (tagName === 'pixelmap') {
                    shape = this.parsePixelmapElement(elem);
                } else if (tagName === 'group') {
                    shape = this.parseGroupElement(elem);
                } else if (tagName === 'document') {
                    // document内にtext要素がある場合は文字枠として処理（新形式）
                    const textElem = elem.querySelector('text');
                    if (textElem) {
                        shape = this.parseDocumentElement(textElem, elem);
                    }
                    // textなしのdocumentは無視（既に処理済み、またはスタンドアロン）
                }

                // 座標変換を適用
                if (shape && pendingTransform) {
                    this.applyTransformToShape(shape, pendingTransform);
                    pendingTransform = null;  // リセット
                }

                if (shape) {
                    this.shapes.push(shape);
                }
            }

            // z-indexの自動採番とソート
            this.normalizeAndSortShapesByZIndex();

            logger.debug('[FIGURE EDITOR] 図形を読み込みました:', this.shapes.length, '個');

            // 仮身のメタデータ（applist等）を読み込み（グループ内を含む全仮身）
            const virtualObjectShapes = this.collectAllVirtualObjectShapes();
            logger.debug('[FIGURE EDITOR] 仮身のメタデータを読み込み中:', virtualObjectShapes.length, '個');
            for (const shape of virtualObjectShapes) {
                await this.loadVirtualObjectMetadata(shape.virtualObject);
            }
            logger.debug('[FIGURE EDITOR] 仮身のメタデータ読み込み完了');

            // 仮身のアイコンを事前読み込み
            await this.preloadVirtualObjectIcons();

            this.redraw();

            // autoopen属性がtrueの仮身を自動的に開く
            await this.autoOpenVirtualObjects();

        } catch (error) {
            logger.error('[FIGURE EDITOR] XML解析エラー:', error);
            this.shapes = [];
            this.redraw();
        }
    }

    /**
     * autoopen属性がtrueの仮身を自動的に開く
     */
    async autoOpenVirtualObjects() {
        // グループ内を含む全仮身を対象
        const virtualObjectShapes = this.collectAllVirtualObjectShapes();

        for (const shape of virtualObjectShapes) {
            const vobj = shape.virtualObject;
            if (vobj.autoopen === 'true') {
                try {
                    // applistを確認
                    const applist = vobj.applist;
                    if (!applist || typeof applist !== 'object') {
                        continue;
                    }

                    // defaultOpen=trueのプラグインを探す
                    let defaultPluginId = null;
                    for (const [pluginId, config] of Object.entries(applist)) {
                        if (config.defaultOpen === true) {
                            defaultPluginId = pluginId;
                            break;
                        }
                    }

                    if (!defaultPluginId) {
                        // defaultOpen=trueがない場合は最初のプラグインを使用
                        defaultPluginId = Object.keys(applist)[0];
                    }

                    if (!defaultPluginId) {
                        continue;
                    }

                    // 実身を開く
                    if (this.messageBus) {
                        this.messageBus.send('open-virtual-object-real', {
                            virtualObj: vobj,
                            pluginId: defaultPluginId
                        });
                    }
                } catch (error) {
                    logger.error('[FIGURE EDITOR] 自動起動エラー:', vobj.link_id, error);
                    // エラーが発生しても次の仮身の起動を続行
                }
            }
        }
    }

    /**
     * グループ内を含む全ての仮身図形を再帰的に収集
     * @param {Array} shapes - 検索対象の図形配列（省略時はthis.shapes）
     * @returns {Array} 仮身図形の配列
     */
    collectAllVirtualObjectShapes(shapes = null) {
        const targetShapes = shapes || this.shapes;
        const result = [];

        for (const shape of targetShapes) {
            if (shape.type === 'vobj' && shape.virtualObject) {
                result.push(shape);
            } else if (shape.type === 'group' && shape.children && shape.children.length > 0) {
                // グループ内を再帰的に検索
                const nestedVobjs = this.collectAllVirtualObjectShapes(shape.children);
                result.push(...nestedVobjs);
            }
        }

        return result;
    }

    /**
     * 図形に座標変換を適用
     * @param {Object} shape 図形オブジェクト
     * @param {Object} transform 変換パラメータ {dh, dv, hangle, vangle}
     */
    applyTransformToShape(shape, transform) {
        switch (shape.type) {
            case 'line':
            case 'rect':
            case 'ellipse':
            case 'roundRect':
                // 開始点・終了点を変換
                const start = this.applyCoordinateTransform(shape.startX, shape.startY, transform);
                const end = this.applyCoordinateTransform(shape.endX, shape.endY, transform);
                shape.startX = start.x;
                shape.startY = start.y;
                shape.endX = end.x;
                shape.endY = end.y;
                break;

            case 'polygon':
            case 'polyline':
            case 'spline':
            case 'curve':
                // 頂点配列を変換
                if (shape.points) {
                    shape.points = this.applyCoordinateTransformToPoints(shape.points, transform);
                }
                break;

            case 'arc':
            case 'chord':
            case 'elliptical_arc':
                // 中心点と境界を変換
                if (shape.centerX !== undefined && shape.centerY !== undefined) {
                    const center = this.applyCoordinateTransform(shape.centerX, shape.centerY, transform);
                    shape.centerX = center.x;
                    shape.centerY = center.y;
                }
                // 境界も変換
                if (shape.startX !== undefined) {
                    const s = this.applyCoordinateTransform(shape.startX, shape.startY, transform);
                    const e = this.applyCoordinateTransform(shape.endX, shape.endY, transform);
                    shape.startX = s.x;
                    shape.startY = s.y;
                    shape.endX = e.x;
                    shape.endY = e.y;
                }
                break;

            case 'text':
            case 'document':
            case 'image':
            case 'pixelmap':
            case 'vobj':
                // 矩形領域を変換
                if (shape.startX !== undefined) {
                    const topLeft = this.applyCoordinateTransform(shape.startX, shape.startY, transform);
                    const bottomRight = this.applyCoordinateTransform(shape.endX, shape.endY, transform);
                    shape.startX = topLeft.x;
                    shape.startY = topLeft.y;
                    shape.endX = bottomRight.x;
                    shape.endY = bottomRight.y;
                }
                break;

            case 'group':
                // グループ内の各図形に再帰適用
                if (shape.shapes) {
                    shape.shapes.forEach(s => this.applyTransformToShape(s, transform));
                }
                break;
        }

        // 回転がある場合は角度も更新（既存のangle属性がある場合）
        if (transform.hangle && transform.hangle !== 0) {
            shape.angle = (shape.angle || 0) + transform.hangle;
        }
    }

    parseLineElement(elem) {
        // tad.js形式: <line l_atr="..." points="x1,y1 x2,y2">
        const pointsStr = elem.getAttribute('points');
        let startX = 0, startY = 0, endX = 0, endY = 0;

        if (pointsStr) {
            // "x1,y1 x2,y2" 形式をパース
            const pairs = pointsStr.trim().split(/\s+/);
            if (pairs.length >= 2) {
                const start = pairs[0].split(',').map(parseFloat);
                const end = pairs[1].split(',').map(parseFloat);
                if (start.length >= 2) {
                    startX = start[0];
                    startY = start[1];
                }
                if (end.length >= 2) {
                    endX = end[0];
                    endY = end[1];
                }
            }
        }

        // 線パターンを取得 (0=solid, 1=dotted, 2=dashed)
        const l_pat = parseInt(elem.getAttribute('l_pat')) || 0;
        const linePattern = l_pat === 1 ? 'dotted' : l_pat === 2 ? 'dashed' : 'solid';

        // 線種・線幅を取得（lineType/lineWidthがあればそれを使用、なければl_atrから抽出）
        let lineType = 0;
        let lineWidth = 1;
        const lineTypeAttr = elem.getAttribute('lineType');
        const lineWidthAttr = elem.getAttribute('lineWidth');
        if (lineTypeAttr !== null && lineWidthAttr !== null) {
            lineType = parseInt(lineTypeAttr) || 0;
            lineWidth = parseInt(lineWidthAttr) || 1;
        } else {
            const l_atr = parseInt(elem.getAttribute('l_atr')) || 1;
            const parsed = this.parseLineAttribute(l_atr);
            lineType = parsed.lineType;
            lineWidth = parsed.lineWidth || 1;
        }

        // 色情報を取得
        const strokeColor = elem.getAttribute('strokeColor') || '#000000';

        // 接続状態を取得 (0=両端接続無し, 1=開始点のみ接続, 2=終端点のみ接続, 3=両端接続)
        const conn_pat = parseInt(elem.getAttribute('conn_pat')) || 0;

        // 開始点接続情報を取得 (format: "shapeId,connectorIndex")
        const start_conn = elem.getAttribute('start_conn') || '';
        let startConnection = null;
        if (start_conn) {
            const parts = start_conn.split(',');
            if (parts.length === 2) {
                startConnection = {
                    shapeId: parseInt(parts[0]),
                    connectorIndex: parseInt(parts[1])
                };
            }
        }

        // 終端点接続情報を取得 (format: "shapeId,connectorIndex")
        const end_conn = elem.getAttribute('end_conn') || '';
        let endConnection = null;
        if (end_conn) {
            const parts = end_conn.split(',');
            if (parts.length === 2) {
                endConnection = {
                    shapeId: parseInt(parts[0]),
                    connectorIndex: parseInt(parts[1])
                };
            }
        }

        // 接続形状を取得 (straight, elbow, curve)
        const lineConnectionType = elem.getAttribute('lineConnectionType') || 'straight';

        // 矢印情報を取得
        const start_arrow = parseInt(elem.getAttribute('start_arrow')) || 0;
        const end_arrow = parseInt(elem.getAttribute('end_arrow')) || 0;
        const arrow_type = elem.getAttribute('arrow_type') || 'simple';

        // z-index属性を取得（指定がない場合はnullのまま、後でソート時に自動採番）
        const zIndex = elem.getAttribute('zIndex');

        const lineShape = {
            type: 'line',
            startX: startX,
            startY: startY,
            endX: endX,
            endY: endY,
            strokeColor: strokeColor,
            fillColor: 'transparent',
            lineWidth: lineWidth,
            lineType: lineType,
            linePattern: linePattern,
            fillEnabled: false,
            connPat: conn_pat,  // 接続状態パターンを保存
            lineConnectionType: lineConnectionType,  // 接続形状を保存
            start_arrow: start_arrow,  // 始点矢印
            end_arrow: end_arrow,  // 終点矢印
            arrow_type: arrow_type,  // 矢印種類
            zIndex: zIndex !== null ? parseInt(zIndex) : null  // z-index
        };

        // 接続情報を復元
        if (startConnection) {
            lineShape.startConnection = startConnection;
        }
        if (endConnection) {
            lineShape.endConnection = endConnection;
        }

        return lineShape;
    }

    parseRectElement(elem) {
        // tad.js形式: <rect round="0/1" l_atr="..." l_pat="..." f_pat="..." angle="..." left="..." top="..." right="..." bottom="...">
        const left = parseFloat(elem.getAttribute('left')) || 0;
        const top = parseFloat(elem.getAttribute('top')) || 0;
        const right = parseFloat(elem.getAttribute('right')) || 0;
        const bottom = parseFloat(elem.getAttribute('bottom')) || 0;
        const round = parseInt(elem.getAttribute('round')) || 0;
        const angle = parseFloat(elem.getAttribute('angle')) || 0;

        // 線パターンを取得 (0=solid, 1=dotted, 2=dashed)
        const l_pat = parseInt(elem.getAttribute('l_pat')) || 0;
        const linePattern = l_pat === 1 ? 'dotted' : l_pat === 2 ? 'dashed' : 'solid';

        // 線種・線幅を取得（lineType/lineWidthがあればそれを使用、なければl_atrから抽出）
        let lineType = 0;
        let lineWidth = 1;
        const lineTypeAttr = elem.getAttribute('lineType');
        const lineWidthAttr = elem.getAttribute('lineWidth');
        if (lineTypeAttr !== null && lineWidthAttr !== null) {
            lineType = parseInt(lineTypeAttr) || 0;
            lineWidth = parseInt(lineWidthAttr) || 1;
        } else {
            const l_atr = parseInt(elem.getAttribute('l_atr')) || 1;
            const parsed = this.parseLineAttribute(l_atr);
            lineType = parsed.lineType;
            lineWidth = parsed.lineWidth || 1;
        }

        // 塗りパターンを取得 (0=有効, 1=無効)
        const f_pat = parseInt(elem.getAttribute('f_pat')) || 0;
        const fillEnabled = f_pat === 0;

        // 色情報を取得
        const fillColor = elem.getAttribute('fillColor') || '#ffffff';
        const strokeColor = elem.getAttribute('strokeColor') || '#000000';

        // 文字枠の判定（新形式：属性としてfontSizeを持つ、または旧形式：documentを持つ）
        const hasFontSize = elem.hasAttribute('fontSize');
        const documentElem = elem.querySelector('document');

        if (hasFontSize || documentElem) {
            // 文字枠として解析
            let content = '';
            let fontSize = 16;
            let fontFamily = 'sans-serif';
            let textColor = '#000000';
            const decorations = {
                bold: false,
                italic: false,
                underline: false,
                strikethrough: false
            };

            if (hasFontSize) {
                // 新形式：属性から取得
                fontSize = parseInt(elem.getAttribute('fontSize')) || 16;
                fontFamily = elem.getAttribute('fontFamily') || 'sans-serif';
                textColor = elem.getAttribute('textColor') || '#000000';

                const decoration = elem.getAttribute('decoration') || '';
                decorations.bold = decoration.includes('B');
                decorations.italic = decoration.includes('I');
                decorations.underline = decoration.includes('U');
                decorations.strikethrough = decoration.includes('S');

                // テキスト内容を取得（BRタグを改行に変換）
                content = elem.innerHTML
                    .replace(/<br\s*\/?>/gi, '\n')
                    .replace(/<[^>]*>/g, '') // その他のタグを除去
                    .trim();
            } else if (documentElem) {
                // 標準形式：document内にtext要素とfont要素がある
                // font要素からフォント情報を取得
                const fontElems = documentElem.querySelectorAll('font');
                fontElems.forEach(fontElem => {
                    if (fontElem.hasAttribute('size')) {
                        fontSize = parseInt(fontElem.getAttribute('size')) || 16;
                    }
                    if (fontElem.hasAttribute('face')) {
                        fontFamily = fontElem.getAttribute('face') || 'sans-serif';
                    }
                    if (fontElem.hasAttribute('color')) {
                        textColor = fontElem.getAttribute('color') || '#000000';
                    }
                });

                // 文字修飾の取得
                if (documentElem.querySelector('underline')) {
                    decorations.underline = true;
                }
                if (documentElem.querySelector('strikethrough')) {
                    decorations.strikethrough = true;
                }

                // テキスト内容を取得（font、text要素を除外し、br要素を改行に変換）
                const docClone = documentElem.cloneNode(true);
                // font、text要素を削除
                docClone.querySelectorAll('font, text').forEach(el => el.remove());
                // underline、strikethrough要素の中身を取り出す
                docClone.querySelectorAll('underline, strikethrough').forEach(el => {
                    const parent = el.parentNode;
                    while (el.firstChild) {
                        parent.insertBefore(el.firstChild, el);
                    }
                    parent.removeChild(el);
                });
                // br要素を改行に変換
                content = docClone.innerHTML
                    .replace(/<br\s*\/?>/gi, '\n')
                    .replace(/<[^>]*>/g, '') // その他のタグを除去
                    .replace(/\r\n/g, '\n')  // \r\nを\nに正規化
                    .replace(/\r/g, '\n')    // \rを\nに正規化
                    .trim();
            }

            return {
                type: 'document',
                startX: left,
                startY: top,
                endX: right,
                endY: bottom,
                content: content,
                fontSize: fontSize,
                fontFamily: fontFamily,
                textColor: textColor,
                fillColor: 'transparent',
                strokeColor: 'transparent',
                lineWidth: 0,
                decorations: decorations
            };
        }

        // 通常の長方形
        // cornerRadius属性があれば使用、なければroundフラグから推定（後方互換性）
        const cornerRadius = elem.hasAttribute('cornerRadius')
            ? parseFloat(elem.getAttribute('cornerRadius'))
            : (round > 0 ? 5 : 0);

        // z-index属性を取得
        const zIndex = elem.getAttribute('zIndex');

        return {
            type: round > 0 ? 'roundRect' : 'rect',
            startX: left,
            startY: top,
            endX: right,
            endY: bottom,
            strokeColor: strokeColor,
            fillColor: fillColor,
            lineWidth: lineWidth,
            lineType: lineType,
            linePattern: linePattern,
            fillEnabled: fillEnabled,
            cornerRadius: cornerRadius,
            angle: angle,
            zIndex: zIndex !== null ? parseInt(zIndex) : null  // z-index
        };
    }

    parseEllipseElement(elem) {
        // tad.js形式: <ellipse l_atr="..." l_pat="..." f_pat="..." angle="..." cx="..." cy="..." rx="..." ry="...">
        const cx = parseFloat(elem.getAttribute('cx')) || 0;
        const cy = parseFloat(elem.getAttribute('cy')) || 0;
        const rx = parseFloat(elem.getAttribute('rx')) || 0;
        const ry = parseFloat(elem.getAttribute('ry')) || 0;
        const angle = parseFloat(elem.getAttribute('angle')) || 0;

        // 線パターンを取得 (0=solid, 1=dotted, 2=dashed)
        const l_pat = parseInt(elem.getAttribute('l_pat')) || 0;
        const linePattern = l_pat === 1 ? 'dotted' : l_pat === 2 ? 'dashed' : 'solid';

        // 線種・線幅を取得（lineType/lineWidthがあればそれを使用、なければl_atrから抽出）
        let lineType = 0;
        let lineWidth = 1;
        const lineTypeAttr = elem.getAttribute('lineType');
        const lineWidthAttr = elem.getAttribute('lineWidth');
        if (lineTypeAttr !== null && lineWidthAttr !== null) {
            lineType = parseInt(lineTypeAttr) || 0;
            lineWidth = parseInt(lineWidthAttr) || 1;
        } else {
            const l_atr = parseInt(elem.getAttribute('l_atr')) || 1;
            const parsed = this.parseLineAttribute(l_atr);
            lineType = parsed.lineType;
            lineWidth = parsed.lineWidth || 1;
        }

        // 塗りパターンを取得 (0=有効, 1=無効)
        const f_pat = parseInt(elem.getAttribute('f_pat')) || 0;
        const fillEnabled = f_pat === 0;

        // 色情報を取得
        const fillColor = elem.getAttribute('fillColor') || '#ffffff';
        const strokeColor = elem.getAttribute('strokeColor') || '#000000';

        // z-index属性を取得
        const zIndex = elem.getAttribute('zIndex');

        return {
            type: 'ellipse',
            startX: cx - rx,
            startY: cy - ry,
            endX: cx + rx,
            endY: cy + ry,
            strokeColor: strokeColor,
            fillColor: fillColor,
            lineWidth: lineWidth,
            lineType: lineType,
            linePattern: linePattern,
            fillEnabled: fillEnabled,
            angle: angle,
            zIndex: zIndex !== null ? parseInt(zIndex) : null  // z-index
        };
    }

    parseTextElement(elem) {
        // テキスト要素
        // z-index属性を取得
        const zIndex = elem.getAttribute('zIndex');

        return {
            type: 'text',
            startX: parseFloat(elem.getAttribute('x')) || 0,
            startY: parseFloat(elem.getAttribute('y')) || 0,
            text: elem.textContent || '',
            fontSize: elem.getAttribute('size') || '16px sans-serif',
            strokeColor: elem.getAttribute('color') || '#000000',
            fillColor: 'transparent',
            lineWidth: 1,
            zIndex: zIndex !== null ? parseInt(zIndex) : null  // z-index
        };
    }

    parseDocumentElement(textElem, documentElem) {
        // text要素とdocument要素を組み合わせて文字枠を構築
        // 位置情報を取得（新形式: docView要素、旧形式: text要素の属性）
        let viewLeft = 0, viewTop = 0, viewRight = 100, viewBottom = 100;

        // 新形式: document内のdocView要素から位置情報を取得
        const docViewElem = documentElem ? documentElem.querySelector('docView') : null;
        if (docViewElem) {
            viewLeft = parseFloat(docViewElem.getAttribute('viewleft')) || 0;
            viewTop = parseFloat(docViewElem.getAttribute('viewtop')) || 0;
            viewRight = parseFloat(docViewElem.getAttribute('viewright')) || 100;
            viewBottom = parseFloat(docViewElem.getAttribute('viewbottom')) || 100;
        } else if (textElem) {
            // 旧形式: text要素の属性から位置情報を取得（後方互換性）
            viewLeft = parseFloat(textElem.getAttribute('viewleft')) || 0;
            viewTop = parseFloat(textElem.getAttribute('viewtop')) || 0;
            viewRight = parseFloat(textElem.getAttribute('viewright')) || 100;
            viewBottom = parseFloat(textElem.getAttribute('viewbottom')) || 100;
        }

        // document要素から文字情報を取得
        let content = '';
        let fontSize = 16;
        let fontFamily = 'sans-serif';
        let textColor = '#000000';
        let textAlign = 'left';  // デフォルトは左揃え
        const decorations = {
            bold: false,
            italic: false,
            underline: false,
            strikethrough: false
        };

        if (documentElem) {
            // document要素の子要素を解析
            let currentText = '';
            const processNode = (node) => {
                if (node.nodeType === Node.TEXT_NODE) {
                    // XMLのフォーマット用の改行（\r\n, \r, \n）は削除
                    const text = node.textContent.replace(/\r\n/g, '').replace(/\r/g, '').replace(/\n/g, '');
                    if (text.trim() !== '') {
                        currentText += text;
                    }
                } else if (node.nodeType === Node.ELEMENT_NODE) {
                    const tagName = node.tagName.toLowerCase();

                    // docView/docDraw要素は設定情報のためスキップ
                    if (tagName === 'docview' || tagName === 'docdraw') {
                        return;
                    }

                    // docScale要素から設定情報を読み込み
                    if (tagName === 'docscale') {
                        this.docScale = this.parseDocScaleElement(node);
                        return;
                    }

                    if (tagName === 'text') {
                        // text要素にalign属性がある場合は取得
                        if (node.hasAttribute('align')) {
                            textAlign = node.getAttribute('align') || 'left';
                        }
                        // viewleft等がある場合は位置情報のみなのでスキップ
                        return;
                    } else if (tagName === 'font') {
                        // フォント設定
                        if (node.hasAttribute('size')) {
                            fontSize = parseInt(node.getAttribute('size')) || 16;
                        }
                        if (node.hasAttribute('face')) {
                            fontFamily = node.getAttribute('face') || 'sans-serif';
                        }
                        if (node.hasAttribute('color')) {
                            textColor = node.getAttribute('color') || '#000000';
                        }
                    } else if (tagName === 'br') {
                        // 改行
                        currentText += '\n';
                    } else if (tagName === 'underline') {
                        decorations.underline = true;
                        // 子要素を処理
                        for (let child of node.childNodes) {
                            processNode(child);
                        }
                        return; // 子要素は処理済み
                    } else if (tagName === 'strikethrough') {
                        decorations.strikethrough = true;
                        // 子要素を処理
                        for (let child of node.childNodes) {
                            processNode(child);
                        }
                        return; // 子要素は処理済み
                    }

                    // その他の要素の子要素を処理
                    for (let child of node.childNodes) {
                        processNode(child);
                    }
                }
            };

            for (let child of documentElem.childNodes) {
                processNode(child);
            }

            content = currentText.trim();
        }

        // z-index属性を取得
        const zIndex = textElem.getAttribute('zIndex');

        return {
            type: 'document',
            startX: viewLeft,
            startY: viewTop,
            endX: viewRight,
            endY: viewBottom,
            content: content,
            fontSize: fontSize,
            fontFamily: fontFamily,
            textColor: textColor,
            textAlign: textAlign,  // テキスト配置
            fillColor: 'transparent',
            strokeColor: 'transparent',
            lineWidth: 0,
            decorations: decorations,
            zIndex: zIndex !== null ? parseInt(zIndex) : null  // z-index
        };
    }

    parsePolylineElement(elem) {
        // tad.js形式: <polyline l_atr="..." l_pat="..." points="x1,y1 x2,y2 ...">
        const pointsStr = elem.getAttribute('points');
        const points = [];

        if (pointsStr) {
            const pairs = pointsStr.trim().split(/\s+/);
            pairs.forEach(pair => {
                const coords = pair.split(',').map(parseFloat);
                if (coords.length >= 2) {
                    points.push({ x: coords[0], y: coords[1] });
                }
            });
        }

        // 線パターンを取得 (0=solid, 1=dotted, 2=dashed)
        const l_pat = parseInt(elem.getAttribute('l_pat')) || 0;
        const linePattern = l_pat === 1 ? 'dotted' : l_pat === 2 ? 'dashed' : 'solid';

        // 線種・線幅を取得（lineType/lineWidthがあればそれを使用、なければl_atrから抽出）
        let lineType = 0;
        let lineWidth = 1;
        const lineTypeAttr = elem.getAttribute('lineType');
        const lineWidthAttr = elem.getAttribute('lineWidth');
        if (lineTypeAttr !== null && lineWidthAttr !== null) {
            lineType = parseInt(lineTypeAttr) || 0;
            lineWidth = parseInt(lineWidthAttr) || 1;
        } else {
            const l_atr = parseInt(elem.getAttribute('l_atr')) || 1;
            const parsed = this.parseLineAttribute(l_atr);
            lineType = parsed.lineType;
            lineWidth = parsed.lineWidth || 1;
        }

        // 色情報を取得
        const strokeColor = elem.getAttribute('strokeColor') || '#000000';

        // z-index属性を取得
        const zIndex = elem.getAttribute('zIndex');

        return {
            type: 'polyline',
            points: points,
            strokeColor: strokeColor,
            fillColor: 'transparent',
            lineWidth: lineWidth,
            lineType: lineType,
            linePattern: linePattern,
            fillEnabled: false,
            zIndex: zIndex !== null ? parseInt(zIndex) : null  // z-index
        };
    }

    parseSplineElement(elem) {
        // スプライン曲線 (curveと同じ形式)
        const pointsStr = elem.getAttribute('points');
        const points = [];

        if (pointsStr) {
            const pairs = pointsStr.trim().split(/\s+/);
            pairs.forEach(pair => {
                const coords = pair.split(',').map(parseFloat);
                if (coords.length >= 2) {
                    points.push({ x: coords[0], y: coords[1] });
                }
            });
        }

        // 線パターンを取得 (0=solid, 1=dotted, 2=dashed)
        const l_pat = parseInt(elem.getAttribute('l_pat')) || 0;
        const linePattern = l_pat === 1 ? 'dotted' : l_pat === 2 ? 'dashed' : 'solid';

        // 線種・線幅を取得（lineType/lineWidthがあればそれを使用、なければl_atrから抽出）
        let lineType = 0;
        let lineWidth = 1;
        const lineTypeAttr = elem.getAttribute('lineType');
        const lineWidthAttr = elem.getAttribute('lineWidth');
        if (lineTypeAttr !== null && lineWidthAttr !== null) {
            lineType = parseInt(lineTypeAttr) || 0;
            lineWidth = parseInt(lineWidthAttr) || 1;
        } else {
            const l_atr = parseInt(elem.getAttribute('l_atr')) || 1;
            const parsed = this.parseLineAttribute(l_atr);
            lineType = parsed.lineType;
            lineWidth = parsed.lineWidth || 1;
        }

        // 色情報を取得
        const strokeColor = elem.getAttribute('strokeColor') || '#000000';

        return {
            type: 'curve',
            path: points,
            strokeColor: strokeColor,
            fillColor: 'transparent',
            lineWidth: lineWidth,
            lineType: lineType,
            linePattern: linePattern,
            fillEnabled: false
        };
    }

    parseCurveElement(elem) {
        // tad.js形式: <curve l_atr="..." l_pat="..." f_pat="..." fillColor="..." strokeColor="..." points="x1,y1 x2,y2 ...">
        const pointsStr = elem.getAttribute('points');
        const points = [];

        if (pointsStr) {
            const pairs = pointsStr.trim().split(/\s+/);
            pairs.forEach(pair => {
                const coords = pair.split(',').map(parseFloat);
                if (coords.length >= 2) {
                    points.push({ x: coords[0], y: coords[1] });
                }
            });
        }

        // 線パターンを取得 (0=solid, 1=dotted, 2=dashed)
        const l_pat = parseInt(elem.getAttribute('l_pat')) || 0;
        const linePattern = l_pat === 1 ? 'dotted' : l_pat === 2 ? 'dashed' : 'solid';

        // 線種・線幅を取得（lineType/lineWidthがあればそれを使用、なければl_atrから抽出）
        let lineType = 0;
        let lineWidth = 1;
        const lineTypeAttr = elem.getAttribute('lineType');
        const lineWidthAttr = elem.getAttribute('lineWidth');
        if (lineTypeAttr !== null && lineWidthAttr !== null) {
            lineType = parseInt(lineTypeAttr) || 0;
            lineWidth = parseInt(lineWidthAttr) || 1;
        } else {
            const l_atr = parseInt(elem.getAttribute('l_atr')) || 1;
            const parsed = this.parseLineAttribute(l_atr);
            lineType = parsed.lineType;
            lineWidth = parsed.lineWidth || 1;
        }

        // 塗りパターンを取得 (0=有効, 1=無効)
        const f_pat = parseInt(elem.getAttribute('f_pat')) || 0;
        const fillEnabled = f_pat === 0;

        // 色情報を取得
        const fillColor = elem.getAttribute('fillColor') || '#ffffff';
        const strokeColor = elem.getAttribute('strokeColor') || '#000000';

        // z-index属性を取得
        const zIndex = elem.getAttribute('zIndex');

        return {
            type: 'curve',
            path: points,
            strokeColor: strokeColor,
            fillColor: fillEnabled ? fillColor : 'transparent',
            lineWidth: lineWidth,
            lineType: lineType,
            linePattern: linePattern,
            fillEnabled: fillEnabled,
            zIndex: zIndex !== null ? parseInt(zIndex) : null  // z-index
        };
    }

    parsePolygonElement(elem) {
        // tad.js形式: <polygon l_atr="..." l_pat="..." f_pat="..." fillColor="..." strokeColor="..." points="x1,y1 x2,y2 ...">
        const pointsStr = elem.getAttribute('points');
        const points = [];

        if (pointsStr) {
            const pairs = pointsStr.trim().split(/\s+/);
            pairs.forEach(pair => {
                const coords = pair.split(',').map(parseFloat);
                if (coords.length >= 2) {
                    points.push({ x: coords[0], y: coords[1] });
                }
            });
        }

        // 線パターンを取得 (0=solid, 1=dotted, 2=dashed)
        const l_pat = parseInt(elem.getAttribute('l_pat')) || 0;
        const linePattern = l_pat === 1 ? 'dotted' : l_pat === 2 ? 'dashed' : 'solid';

        // 線種・線幅を取得（lineType/lineWidthがあればそれを使用、なければl_atrから抽出）
        let lineType = 0;
        let lineWidth = 1;
        const lineTypeAttr = elem.getAttribute('lineType');
        const lineWidthAttr = elem.getAttribute('lineWidth');
        if (lineTypeAttr !== null && lineWidthAttr !== null) {
            lineType = parseInt(lineTypeAttr) || 0;
            lineWidth = parseInt(lineWidthAttr) || 1;
        } else {
            const l_atr = parseInt(elem.getAttribute('l_atr')) || 1;
            const parsed = this.parseLineAttribute(l_atr);
            lineType = parsed.lineType;
            lineWidth = parsed.lineWidth || 1;
        }

        // 塗りパターンを取得 (0=有効, 1=無効)
        const f_pat = parseInt(elem.getAttribute('f_pat')) || 0;
        const fillEnabled = f_pat === 0;

        // 色情報を取得
        const fillColor = elem.getAttribute('fillColor') || '#ffffff';
        const strokeColor = elem.getAttribute('strokeColor') || '#000000';

        // cornerRadius属性があれば使用、なければ0（後方互換性）
        const cornerRadius = elem.hasAttribute('cornerRadius')
            ? parseFloat(elem.getAttribute('cornerRadius'))
            : 0;

        // z-index属性を取得
        const zIndex = elem.getAttribute('zIndex');

        return {
            type: 'polygon',
            points: points,
            strokeColor: strokeColor,
            fillColor: fillColor,
            lineWidth: lineWidth,
            lineType: lineType,
            linePattern: linePattern,
            fillEnabled: fillEnabled,
            cornerRadius: cornerRadius,
            zIndex: zIndex !== null ? parseInt(zIndex) : null  // z-index
        };
    }

    parseLinkElement(elem) {
        // tad.js形式: <link id="..." vobjleft="..." vobjtop="..." vobjright="..." vobjbottom="..." frcol="..." chcol="..." tbcol="...">
        const left = parseFloat(elem.getAttribute('vobjleft')) || 0;
        const top = parseFloat(elem.getAttribute('vobjtop')) || 0;
        const right = parseFloat(elem.getAttribute('vobjright')) || 0;
        const bottom = parseFloat(elem.getAttribute('vobjbottom')) || 0;
        const chsz = parseFloat(elem.getAttribute('chsz')) || 14;

        // originalHeightを計算（chszはポイント値なのでピクセルに変換）
        const chszPx = window.convertPtToPx(chsz);
        const lineHeight = 1.2;
        const textHeight = Math.ceil(chszPx * lineHeight);
        const originalHeight = textHeight + 8; // 閉じた仮身の高さ

        // z-index属性を取得
        const zIndex = elem.getAttribute('zIndex');

        return {
            type: 'vobj',
            startX: left,
            startY: top,
            endX: right,
            endY: bottom,
            virtualObject: {
                link_id: elem.getAttribute('id') || '',
                link_name: elem.textContent || '仮身',
                chsz: chsz,
                frcol: elem.getAttribute('frcol') || '#000000',
                chcol: elem.getAttribute('chcol') || '#000000',
                tbcol: elem.getAttribute('tbcol') || '#ffffff',
                bgcol: elem.getAttribute('bgcol') || '#ffffff',
                pictdisp: elem.getAttribute('pictdisp') || 'true',  // ピクトグラム表示
                namedisp: elem.getAttribute('namedisp') || 'true',  // 名称表示
                roledisp: elem.getAttribute('roledisp') || 'false',
                typedisp: elem.getAttribute('typedisp') || 'false',
                updatedisp: elem.getAttribute('updatedisp') || 'false',
                framedisp: elem.getAttribute('framedisp') || 'true',
                autoopen: elem.getAttribute('autoopen') || 'false',
                // 仮身固有の続柄（link要素のrelationship属性）
                linkRelationship: elem.getAttribute('relationship') ? elem.getAttribute('relationship').split(/\s+/).filter(t => t) : []
            },
            strokeColor: elem.getAttribute('frcol') || '#000000',
            textColor: elem.getAttribute('chcol') || '#000000',
            fillColor: elem.getAttribute('tbcol') || '#ffffff',
            lineWidth: 1,
            originalHeight: originalHeight,
            locked: elem.getAttribute('fixed') === 'true',  // 固定化
            isBackground: elem.getAttribute('background') === 'true',  // 背景化
            zIndex: zIndex !== null ? parseInt(zIndex) : null  // z-index
        };
    }

    parseImageElement(elem) {
        // 画像セグメント: <image l_atr="..." l_pat="..." f_pat="..." angle="..." left="..." top="..." right="..." bottom="..." href="..." />
        const left = parseFloat(elem.getAttribute('left')) || 0;
        const top = parseFloat(elem.getAttribute('top')) || 0;
        const right = parseFloat(elem.getAttribute('right')) || 100;
        const bottom = parseFloat(elem.getAttribute('bottom')) || 100;
        const href = elem.getAttribute('href') || '';

        // 線パターンを取得 (0=solid, 1=dotted, 2=dashed)
        const l_pat = parseInt(elem.getAttribute('l_pat')) || 0;
        const linePattern = l_pat === 1 ? 'dotted' : l_pat === 2 ? 'dashed' : 'solid';

        // 線種・線幅を取得（lineType/lineWidthがあればそれを使用、なければl_atrから抽出）
        let lineType = 0;
        let lineWidth = 1;
        const lineTypeAttr = elem.getAttribute('lineType');
        const lineWidthAttr = elem.getAttribute('lineWidth');
        if (lineTypeAttr !== null && lineWidthAttr !== null) {
            lineType = parseInt(lineTypeAttr) || 0;
            lineWidth = parseInt(lineWidthAttr) || 1;
        } else {
            const l_atr = parseInt(elem.getAttribute('l_atr')) || 1;
            const parsed = this.parseLineAttribute(l_atr);
            lineType = parsed.lineType;
            lineWidth = parsed.lineWidth || 1;
        }

        // 塗りパターンを取得 (0=有効, 1=無効)
        const f_pat = parseInt(elem.getAttribute('f_pat')) || 0;
        const fillEnabled = f_pat === 0;

        // 画像番号を抽出
        let imgNo = 0;
        const match = href.match(/_(\d+)\.png$/);
        if (match) {
            imgNo = parseInt(match[1]);
        }

        // 画像要素を作成
        const img = new Image();
        // 画像ファイルのパスを生成
        if (href) {
            // 親ウィンドウから画像ファイルの絶対パスを取得
            this.getImageFilePath(href).then(filePath => {
                logger.debug('[FIGURE EDITOR] 画像パス取得成功:', href, '->', filePath);
                // 絶対パスをfile:// URLに変換
                let fileUrl = filePath;
                if (filePath.match(/^[A-Za-z]:\\/)) {
                    // Windows絶対パス (C:\...) を file:// URLに変換
                    fileUrl = 'file:///' + filePath.replace(/\\/g, '/');
                } else if (filePath.startsWith('/')) {
                    // Unix絶対パス
                    fileUrl = 'file://' + filePath;
                }
                img.src = fileUrl;
                // 画像読み込み完了時に再描画
                img.onload = () => {
                    logger.debug('[FIGURE EDITOR] 画像読み込み完了:', href);
                    this.redraw();
                };
                img.onerror = () => {
                    logger.error('[FIGURE EDITOR] 画像読み込みエラー:', href, filePath);
                };
            }).catch(error => {
                logger.error('[FIGURE EDITOR] 画像パス取得エラー:', href, error);
            });
        }

        // z-index属性を取得
        const zIndex = elem.getAttribute('zIndex');

        return {
            type: 'image',
            startX: left,
            startY: top,
            endX: right,
            endY: bottom,
            imageElement: img,
            fileName: href,
            imgNo: imgNo,
            lineWidth: lineWidth,
            lineType: lineType,
            linePattern: linePattern,
            fillEnabled: fillEnabled,
            angle: parseFloat(elem.getAttribute('angle')) || 0,
            rotation: parseFloat(elem.getAttribute('rotation')) || 0,
            flipH: elem.getAttribute('flipH') === 'true',
            flipV: elem.getAttribute('flipV') === 'true',
            zIndex: zIndex !== null ? parseInt(zIndex) : null  // z-index
        };
    }

    parsePixelmapElement(elem) {
        // ピクセルマップセグメント: <pixelmap left="..." top="..." right="..." bottom="..." bgcolor="..." href="..." />
        const left = parseFloat(elem.getAttribute('left')) || 0;
        const top = parseFloat(elem.getAttribute('top')) || 0;
        const right = parseFloat(elem.getAttribute('right')) || 100;
        const bottom = parseFloat(elem.getAttribute('bottom')) || 100;
        const backgroundColor = elem.getAttribute('bgcolor') || '#ffffff';
        const href = elem.getAttribute('href') || '';

        // ピクセルマップ番号を抽出
        let pixelmapNo = 0;
        const match = href.match(/_(\d+)\.png$/);
        if (match) {
            pixelmapNo = parseInt(match[1]);
        }

        const shape = {
            type: 'pixelmap',
            startX: left,
            startY: top,
            endX: right,
            endY: bottom,
            backgroundColor: backgroundColor,
            imageData: null,
            pixelmapNo: pixelmapNo,
            fileName: href,
            rotation: parseFloat(elem.getAttribute('rotation')) || 0,
            flipH: elem.getAttribute('flipH') === 'true',
            flipV: elem.getAttribute('flipV') === 'true'
        };

        // href属性がある場合、画像ファイルからImageDataを復元
        if (href) {
            // 親ウィンドウから画像ファイルの絶対パスを取得
            this.getImageFilePath(href).then(filePath => {
                logger.debug('[FIGURE EDITOR] ピクセルマップ画像パス取得成功:', href, '->', filePath);
                const img = new Image();
                img.onload = () => {
                    logger.debug('[FIGURE EDITOR] ピクセルマップ画像読み込み完了:', href);
                    const width = Math.abs(right - left);
                    const height = Math.abs(bottom - top);
                    const tempCanvas = document.createElement('canvas');
                    tempCanvas.width = width;
                    tempCanvas.height = height;
                    const tempCtx = tempCanvas.getContext('2d');
                    tempCtx.drawImage(img, 0, 0, width, height);
                    shape.imageData = tempCtx.getImageData(0, 0, width, height);
                    this.redraw();
                };
                img.onerror = (error) => {
                    logger.error('[FIGURE EDITOR] ピクセルマップ画像読み込みエラー:', href, error);
                };
                // 絶対パスをfile:// URLに変換
                let fileUrl = filePath;
                if (filePath.match(/^[A-Za-z]:\\/)) {
                    // Windows絶対パス (C:\...) を file:// URLに変換
                    fileUrl = 'file:///' + filePath.replace(/\\/g, '/');
                } else if (filePath.startsWith('/')) {
                    // Unix絶対パス
                    fileUrl = 'file://' + filePath;
                }
                img.src = fileUrl;
            }).catch(error => {
                logger.error('[FIGURE EDITOR] ピクセルマップ画像パス取得エラー:', href, error);
            });
        }

        return shape;
    }

    parseGroupElement(elem) {
        // グループセグメント: <group left="..." top="..." right="..." bottom="...">子図形...</group>
        const left = parseFloat(elem.getAttribute('left')) || 0;
        const top = parseFloat(elem.getAttribute('top')) || 0;
        const right = parseFloat(elem.getAttribute('right')) || 100;
        const bottom = parseFloat(elem.getAttribute('bottom')) || 100;

        // 子図形を解析
        const childShapes = [];
        const children = elem.children;
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            const tagName = child.tagName.toLowerCase();

            // 子図形を再帰的に解析
            if (tagName === 'line') {
                childShapes.push(this.parseLineElement(child));
            } else if (tagName === 'rect') {
                childShapes.push(this.parseRectElement(child));
            } else if (tagName === 'ellipse') {
                childShapes.push(this.parseEllipseElement(child));
            } else if (tagName === 'polyline') {
                childShapes.push(this.parsePolylineElement(child));
            } else if (tagName === 'spline') {
                childShapes.push(this.parseSplineElement(child));
            } else if (tagName === 'curve') {
                childShapes.push(this.parseCurveElement(child));
            } else if (tagName === 'polygon') {
                childShapes.push(this.parsePolygonElement(child));
            } else if (tagName === 'link') {
                childShapes.push(this.parseLinkElement(child));
            } else if (tagName === 'arc') {
                childShapes.push(this.parseArcElement(child));
            } else if (tagName === 'chord') {
                childShapes.push(this.parseChordElement(child));
            } else if (tagName === 'elliptical_arc') {
                childShapes.push(this.parseEllipticalArcElement(child));
            } else if (tagName === 'image') {
                childShapes.push(this.parseImageElement(child));
            } else if (tagName === 'pixelmap') {
                childShapes.push(this.parsePixelmapElement(child));
            } else if (tagName === 'group') {
                // ネストされたグループを再帰的に解析
                childShapes.push(this.parseGroupElement(child));
            } else if (tagName === 'text') {
                // 次の要素がdocumentか確認（文字枠の場合）
                const nextChild = i + 1 < children.length ? children[i + 1] : null;
                if (nextChild && nextChild.tagName.toLowerCase() === 'document') {
                    // 文字枠として解析
                    childShapes.push(this.parseDocumentElement(child, nextChild));
                    i++; // documentもスキップ
                } else {
                    // 通常のtext要素として解析
                    childShapes.push(this.parseTextElement(child));
                }
            } else if (tagName === 'document') {
                // document内にtext要素がある場合は文字枠として処理（新形式）
                const textElem = child.querySelector('text');
                if (textElem) {
                    childShapes.push(this.parseDocumentElement(textElem, child));
                }
                // textなしのdocumentは無視
            }
        }

        return {
            type: 'group',
            shapes: childShapes,
            startX: left,
            startY: top,
            endX: right,
            endY: bottom,
            strokeColor: '#000000',
            fillColor: 'transparent',
            lineWidth: 1
        };
    }

    parseArcElement(elem) {
        // tad.js形式: <arc l_atr="..." l_pat="..." f_pat="..." angle="..." cx="..." cy="..." rx="..." ry="..." startX="..." startY="..." endX="..." endY="..." startAngle="..." endAngle="...">
        const centerX = parseFloat(elem.getAttribute('cx')) || 0;
        const centerY = parseFloat(elem.getAttribute('cy')) || 0;
        const radiusX = parseFloat(elem.getAttribute('rx')) || 0;
        const radiusY = parseFloat(elem.getAttribute('ry')) || 0;
        const startX = parseFloat(elem.getAttribute('startX')) || 0;
        const startY = parseFloat(elem.getAttribute('startY')) || 0;
        const endX = parseFloat(elem.getAttribute('endX')) || 0;
        const endY = parseFloat(elem.getAttribute('endY')) || 0;
        const startAngle = parseFloat(elem.getAttribute('startAngle')) || 0;
        const endAngle = parseFloat(elem.getAttribute('endAngle')) || 0;
        const angle = parseFloat(elem.getAttribute('angle')) || 0;

        // 線パターンを取得 (0=solid, 1=dotted, 2=dashed)
        const l_pat = parseInt(elem.getAttribute('l_pat')) || 0;
        const linePattern = l_pat === 1 ? 'dotted' : l_pat === 2 ? 'dashed' : 'solid';

        // 線種・線幅を取得（lineType/lineWidthがあればそれを使用、なければl_atrから抽出）
        let lineType = 0;
        let lineWidth = 1;
        const lineTypeAttr = elem.getAttribute('lineType');
        const lineWidthAttr = elem.getAttribute('lineWidth');
        if (lineTypeAttr !== null && lineWidthAttr !== null) {
            lineType = parseInt(lineTypeAttr) || 0;
            lineWidth = parseInt(lineWidthAttr) || 1;
        } else {
            const l_atr = parseInt(elem.getAttribute('l_atr')) || 1;
            const parsed = this.parseLineAttribute(l_atr);
            lineType = parsed.lineType;
            lineWidth = parsed.lineWidth || 1;
        }

        // 塗りパターンを取得 (0=有効, 1=無効)
        const f_pat = parseInt(elem.getAttribute('f_pat')) || 0;
        const fillEnabled = f_pat === 0;

        // 色情報を取得
        const fillColor = elem.getAttribute('fillColor') || '#ffffff';
        const strokeColor = elem.getAttribute('strokeColor') || '#000000';

        // z-index属性を取得
        const zIndex = elem.getAttribute('zIndex');

        return {
            type: 'arc',
            centerX: centerX,
            centerY: centerY,
            radiusX: radiusX,
            radiusY: radiusY,
            startX: startX,
            startY: startY,
            endX: endX,
            endY: endY,
            startAngle: startAngle,
            endAngle: endAngle,
            angle: angle,
            strokeColor: strokeColor,
            fillColor: fillColor,
            lineWidth: lineWidth,
            lineType: lineType,
            linePattern: linePattern,
            fillEnabled: fillEnabled,
            zIndex: zIndex !== null ? parseInt(zIndex) : null  // z-index
        };
    }

    parseChordElement(elem) {
        // tad.js形式: <chord l_atr="..." l_pat="..." f_pat="..." angle="..." fillColor="..." strokeColor="..." cx="..." cy="..." rx="..." ry="..." startX="..." startY="..." endX="..." endY="..." startAngle="..." endAngle="...">
        const centerX = parseFloat(elem.getAttribute('cx')) || 0;
        const centerY = parseFloat(elem.getAttribute('cy')) || 0;
        const radiusX = parseFloat(elem.getAttribute('rx')) || 0;
        const radiusY = parseFloat(elem.getAttribute('ry')) || 0;
        const startX = parseFloat(elem.getAttribute('startX')) || 0;
        const startY = parseFloat(elem.getAttribute('startY')) || 0;
        const endX = parseFloat(elem.getAttribute('endX')) || 0;
        const endY = parseFloat(elem.getAttribute('endY')) || 0;
        const startAngle = parseFloat(elem.getAttribute('startAngle')) || 0;
        const endAngle = parseFloat(elem.getAttribute('endAngle')) || 0;
        const angle = parseFloat(elem.getAttribute('angle')) || 0;

        // 線パターンを取得 (0=solid, 1=dotted, 2=dashed)
        const l_pat = parseInt(elem.getAttribute('l_pat')) || 0;
        const linePattern = l_pat === 1 ? 'dotted' : l_pat === 2 ? 'dashed' : 'solid';

        // 線種・線幅を取得（lineType/lineWidthがあればそれを使用、なければl_atrから抽出）
        let lineType = 0;
        let lineWidth = 1;
        const lineTypeAttr = elem.getAttribute('lineType');
        const lineWidthAttr = elem.getAttribute('lineWidth');
        if (lineTypeAttr !== null && lineWidthAttr !== null) {
            lineType = parseInt(lineTypeAttr) || 0;
            lineWidth = parseInt(lineWidthAttr) || 1;
        } else {
            const l_atr = parseInt(elem.getAttribute('l_atr')) || 1;
            const parsed = this.parseLineAttribute(l_atr);
            lineType = parsed.lineType;
            lineWidth = parsed.lineWidth || 1;
        }

        // 塗りパターンを取得 (0=有効, 1=無効)
        const f_pat = parseInt(elem.getAttribute('f_pat')) || 0;
        const fillEnabled = f_pat === 0;

        // 色情報を取得
        const fillColor = elem.getAttribute('fillColor') || '#ffffff';
        const strokeColor = elem.getAttribute('strokeColor') || '#000000';

        // z-index属性を取得
        const zIndex = elem.getAttribute('zIndex');

        return {
            type: 'chord',
            centerX: centerX,
            centerY: centerY,
            radiusX: radiusX,
            radiusY: radiusY,
            startX: startX,
            startY: startY,
            endX: endX,
            endY: endY,
            startAngle: startAngle,
            endAngle: endAngle,
            angle: angle,
            strokeColor: strokeColor,
            fillColor: fillColor,
            lineWidth: lineWidth,
            lineType: lineType,
            linePattern: linePattern,
            fillEnabled: fillEnabled,
            zIndex: zIndex !== null ? parseInt(zIndex) : null  // z-index
        };
    }

    parseEllipticalArcElement(elem) {
        // tad.js形式: <elliptical_arc l_atr="..." l_pat="..." angle="..." cx="..." cy="..." rx="..." ry="..." startX="..." startY="..." endX="..." endY="..." startAngle="..." endAngle="...">
        const centerX = parseFloat(elem.getAttribute('cx')) || 0;
        const centerY = parseFloat(elem.getAttribute('cy')) || 0;
        const radiusX = parseFloat(elem.getAttribute('rx')) || 0;
        const radiusY = parseFloat(elem.getAttribute('ry')) || 0;
        const startX = parseFloat(elem.getAttribute('startX')) || 0;
        const startY = parseFloat(elem.getAttribute('startY')) || 0;
        const endX = parseFloat(elem.getAttribute('endX')) || 0;
        const endY = parseFloat(elem.getAttribute('endY')) || 0;
        const startAngle = parseFloat(elem.getAttribute('startAngle')) || 0;
        const endAngle = parseFloat(elem.getAttribute('endAngle')) || 0;
        const angle = parseFloat(elem.getAttribute('angle')) || 0;

        // 線パターンを取得 (0=solid, 1=dotted, 2=dashed)
        const l_pat = parseInt(elem.getAttribute('l_pat')) || 0;
        const linePattern = l_pat === 1 ? 'dotted' : l_pat === 2 ? 'dashed' : 'solid';

        // 線種・線幅を取得（lineType/lineWidthがあればそれを使用、なければl_atrから抽出）
        let lineType = 0;
        let lineWidth = 1;
        const lineTypeAttr = elem.getAttribute('lineType');
        const lineWidthAttr = elem.getAttribute('lineWidth');
        if (lineTypeAttr !== null && lineWidthAttr !== null) {
            lineType = parseInt(lineTypeAttr) || 0;
            lineWidth = parseInt(lineWidthAttr) || 1;
        } else {
            const l_atr = parseInt(elem.getAttribute('l_atr')) || 1;
            const parsed = this.parseLineAttribute(l_atr);
            lineType = parsed.lineType;
            lineWidth = parsed.lineWidth || 1;
        }

        // 色情報を取得
        const strokeColor = elem.getAttribute('strokeColor') || '#000000';

        // z-index属性を取得
        const zIndex = elem.getAttribute('zIndex');

        return {
            type: 'elliptical_arc',
            centerX: centerX,
            centerY: centerY,
            radiusX: radiusX,
            radiusY: radiusY,
            startX: startX,
            startY: startY,
            endX: endX,
            endY: endY,
            startAngle: startAngle,
            endAngle: endAngle,
            angle: angle,
            strokeColor: strokeColor,
            fillColor: 'transparent',
            lineWidth: lineWidth,
            lineType: lineType,
            linePattern: linePattern,
            fillEnabled: false,
            zIndex: zIndex !== null ? parseInt(zIndex) : null  // z-index
        };
    }

    async saveFile() {
        // 保存時にスクロール位置も保存
        this.saveScrollPosition();

        try {
            logger.debug('[FIGURE EDITOR] 保存処理開始, realId:', this.realId);

            if (!this.realId) {
                logger.warn('[FIGURE EDITOR] realIdが未設定のため保存をスキップ');
                this.setStatus('保存に失敗しました（realId未設定）');
                return;
            }

            // 図形データをXMLに変換（画像保存完了を待機）
            const xmlData = await this.convertToXmlTad();

            // 親ウィンドウにXMLデータを送信
            if (this.messageBus) {
                this.messageBus.send('xml-data-changed', {
                    xmlData: xmlData,
                    fileId: this.realId
                });
            }

            this.originalContent = JSON.stringify(this.shapes);
            this.isModified = false;
            this.setStatus('保存しました');

        } catch (error) {
            logger.error('[FIGURE EDITOR] 保存エラー:', error);
            this.setStatus('保存に失敗しました');
        }
    }

    async saveAsNewRealObject() {
        if (!this.realId && !this.realId) {
            logger.warn('[FIGURE EDITOR] 保存するデータがありません');
            this.setStatus('保存するデータがありません');
            return;
        }

        // realIdが未設定の場合はfileIdを使用
        const realIdToUse = this.realId || this.realId;
        logger.debug('[FIGURE EDITOR] saveAsNewRealObject - realId:', this.realId, 'fileId:', this.realId, '使用:', realIdToUse);

        try {
            // まず現在のデータを保存（画像保存完了を待機）
            const xmlData = await this.convertToXmlTad();
            if (this.messageBus) {
                this.messageBus.send('xml-data-changed', {
                    xmlData: xmlData,
                    fileId: this.realId
                });
            }

            this.originalContent = JSON.stringify(this.shapes);
            this.isModified = false;

            // 選択されている仮身を取得
            const selectedVobjShape = this.selectedShapes.find(shape => shape.type === 'vobj');
            if (!selectedVobjShape) {
                logger.warn('[FIGURE EDITOR] 仮身が選択されていません');
                this.setStatus('仮身を選択してください');
                return;
            }

            // 親ウィンドウに新たな実身への保存を要求
            const messageId = this.generateMessageId('save-as-new');

            // 親ウィンドウに保存を要求
            if (this.messageBus) {
                this.messageBus.send('save-as-new-real-object', {
                    realId: realIdToUse,
                    messageId: messageId
                });
            }

            this.setStatus('新しい実身への保存を準備中...');

            // レスポンスを待つ（ユーザー入力を待つのでタイムアウト無効）
            const result = await this.messageBus.waitFor('save-as-new-real-object-completed', 0, (data) => {
                return data.messageId === messageId;
            });

            if (result.cancelled) {
                this.setStatus('保存がキャンセルされました');
            } else if (result.success) {
                this.setStatus('新しい実身に保存しました: ' + result.newName);
                logger.debug('[FIGURE EDITOR] 新しい実身に保存成功:', result.newRealId);

                // 元の仮身の属性をコピーして新しい仮身を作成
                const originalVobj = selectedVobjShape.virtualObject;
                const newVirtualObject = {
                    link_id: `${result.newRealId}_0.xtad`,
                    link_name: result.newName,
                    chsz: originalVobj.chsz || 14,
                    frcol: originalVobj.frcol || '#000000',
                    chcol: originalVobj.chcol || '#000000',
                    tbcol: originalVobj.tbcol || '#ffffff',
                    bgcol: originalVobj.bgcol || '#ffffff',
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
                const chszPx = (newVirtualObject.chsz || 14) * (96 / 72);
                const lineHeight = 1.2;
                const textHeight = Math.ceil(chszPx * lineHeight);
                const newHeight = textHeight + 8;

                const newVobjShape = {
                    type: 'vobj',
                    startX: selectedVobjShape.startX,
                    startY: selectedVobjShape.endY + 10,
                    endX: selectedVobjShape.endX,
                    endY: selectedVobjShape.endY + 10 + newHeight,
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
                const realId = result.newRealId.replace(/_\d+\.xtad$/i, '');
                this.iconManager.loadIcon(realId).then(iconData => {
                    if (iconData && this.virtualObjectRenderer) {
                        this.virtualObjectRenderer.loadIconToCache(realId, iconData);
                    }
                    // 再描画
                    this.redraw();
                });

                // XMLデータを更新（画像保存完了を待機）
                const updatedXmlData = await this.convertToXmlTad();
                if (this.messageBus) {
                    this.messageBus.send('xml-data-changed', {
                        xmlData: updatedXmlData,
                        fileId: this.realId
                    });
                }

                this.originalContent = JSON.stringify(this.shapes);
                this.isModified = false;
            } else {
                this.setStatus('新しい実身への保存に失敗しました');
                logger.error('[FIGURE EDITOR] 新しい実身への保存失敗');
            }

        } catch (error) {
            logger.error('[FIGURE EDITOR] 新しい実身への保存エラー:', error);
            this.setStatus('新しい実身への保存に失敗しました');
        }
    }

    async convertToXmlTad() {
        // 図形データをTAD XML形式に変換（配列を使用して高速化）
        const xmlParts = ['<tad version="1.0" encoding="UTF-8">\r\n'];
        const savePromises = [];

        // 用紙設定が設定されている場合のみ<paper>要素を出力
        if (this.paperSize) {
            xmlParts.push(this.paperSize.toXmlString() + '\r\n');
        }

        // 用紙設定が設定されている場合、または既存のマージン設定がある場合のみ<docmargin>要素を出力
        if (this.paperMargin || this.paperSize) {
            const margin = this.paperMargin || new window.PaperMargin();
            xmlParts.push(`<docmargin top="${margin.top}" bottom="${margin.bottom}" left="${margin.left}" right="${margin.right}" />\r\n`);
        }

        // 図形セグメント開始
        if (this.shapes.length > 0) {
            xmlParts.push('<figure>\r\n');
            xmlParts.push(`<figView top="0" left="0" right="${this.canvas.width}" bottom="${this.canvas.height}"/>\r\n`);
            xmlParts.push(`<figDraw top="0" left="0" right="${this.canvas.width}" bottom="${this.canvas.height}"/>\r\n`);
            // figScale出力（UNITS型: デフォルト-72 = 72DPI）
            const figScaleHunit = this.figScale?.hunit ?? -72;
            const figScaleVunit = this.figScale?.vunit ?? -72;
            xmlParts.push(`<figScale hunit="${figScaleHunit}" vunit="${figScaleVunit}"/>\r\n`);

            // 各図形を追加
            for (let index = 0; index < this.shapes.length; index++) {
                await this.shapeToXML(this.shapes[index], index, xmlParts, savePromises);
            }

            xmlParts.push('</figure>\r\n');
        }

        xmlParts.push('</tad>');

        // 全画像保存の完了を待つ
        if (savePromises.length > 0) {
            await Promise.all(savePromises);
        }

        return xmlParts.join('');
    }

    async shapeToXML(shape, index, xmlParts, savePromises = null) {
        // 図形の線種・線幅（TAD仕様: 上位8bit=線種、下位8bit=線幅）
        const lineType = shape.lineType || 0;
        const lineWidth = shape.lineWidth || 1;
        // 線パターン: solid=0, dotted=1, dashed=2
        const l_pat = shape.linePattern === 'dotted' ? 1 : shape.linePattern === 'dashed' ? 2 : 0;
        // 塗りパターン: 塗りつぶし有効=0, 無効=1
        const f_pat = (shape.fillEnabled !== undefined ? shape.fillEnabled : true) ? 0 : 1;
        // 角度
        const angle = shape.angle || 0;
        // 色情報
        const fillColor = shape.fillColor || '#ffffff';
        const strokeColor = shape.strokeColor || '#000000';

        switch (shape.type) {
            case 'line':
                // tad.js形式: <line l_atr="..." l_pat="..." f_pat="0" strokeColor="..." start_arrow="0" end_arrow="0" conn_pat="..." start_conn="..." end_conn="..." points="x1,y1 x2,y2" />
                const linePoints = `${shape.startX},${shape.startY} ${shape.endX},${shape.endY}`;
                // 接続状態を計算: 0=両端接続無し, 1=開始点のみ接続, 2=終端点のみ接続, 3=両端接続
                let conn_pat = 0;
                let start_conn = '';
                let end_conn = '';

                if (shape.startConnection && shape.endConnection) {
                    conn_pat = 3;
                } else if (shape.startConnection) {
                    conn_pat = 1;
                } else if (shape.endConnection) {
                    conn_pat = 2;
                }

                // 開始点の接続情報を保存 (format: "shapeId,connectorIndex")
                if (shape.startConnection) {
                    start_conn = `${shape.startConnection.shapeId},${shape.startConnection.connectorIndex}`;
                }

                // 終端点の接続情報を保存 (format: "shapeId,connectorIndex")
                if (shape.endConnection) {
                    end_conn = `${shape.endConnection.shapeId},${shape.endConnection.connectorIndex}`;
                }

                // 接続形状を保存 (straight, elbow, curve)
                const lineConnectionType = shape.lineConnectionType || 'straight';

                // 矢印情報を取得
                const start_arrow = shape.start_arrow || 0;
                const end_arrow = shape.end_arrow || 0;
                const arrow_type = shape.arrow_type || 'simple';

                // z-index属性を追加
                const zIndexAttr = shape.zIndex !== undefined && shape.zIndex !== null ? ` zIndex="${shape.zIndex}"` : '';
                xmlParts.push(`<line lineType="${lineType}" lineWidth="${lineWidth}" l_pat="${l_pat}" f_pat="0" strokeColor="${strokeColor}" start_arrow="${start_arrow}" end_arrow="${end_arrow}" arrow_type="${arrow_type}" conn_pat="${conn_pat}" start_conn="${start_conn}" end_conn="${end_conn}" lineConnectionType="${lineConnectionType}" points="${linePoints}"${zIndexAttr} />\r\n`);
                break;

            case 'rect':
            case 'roundRect':
                // tad.js形式: <rect round="0/1" cornerRadius="..." l_atr="..." l_pat="..." f_pat="..." angle="..." fillColor="..." strokeColor="..." left="..." top="..." right="..." bottom="..." />
                const round = shape.cornerRadius && shape.cornerRadius > 0 ? 1 : 0;
                const cornerRadius = shape.cornerRadius || 0;
                const rectZIndexAttr = shape.zIndex !== undefined && shape.zIndex !== null ? ` zIndex="${shape.zIndex}"` : '';
                xmlParts.push(`<rect round="${round}" cornerRadius="${cornerRadius}" lineType="${lineType}" lineWidth="${lineWidth}" l_pat="${l_pat}" f_pat="${f_pat}" angle="${angle}" fillColor="${fillColor}" strokeColor="${strokeColor}" left="${shape.startX}" top="${shape.startY}" right="${shape.endX}" bottom="${shape.endY}"${rectZIndexAttr} />\r\n`);
                break;

            case 'ellipse':
                const cx = (shape.startX + shape.endX) / 2;
                const cy = (shape.startY + shape.endY) / 2;
                const rx = Math.abs(shape.endX - shape.startX) / 2;
                const ry = Math.abs(shape.endY - shape.startY) / 2;
                // tad.js形式: <ellipse l_atr="..." l_pat="..." f_pat="..." angle="..." fillColor="..." strokeColor="..." cx="..." cy="..." rx="..." ry="..." />
                const ellipseZIndexAttr = shape.zIndex !== undefined && shape.zIndex !== null ? ` zIndex="${shape.zIndex}"` : '';
                xmlParts.push(`<ellipse lineType="${lineType}" lineWidth="${lineWidth}" l_pat="${l_pat}" f_pat="${f_pat}" angle="${angle}" fillColor="${fillColor}" strokeColor="${strokeColor}" cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"${ellipseZIndexAttr} />\r\n`);
                break;

            case 'text':
                // テキストは文章セグメントとして出力（document形式）
                {
                    const textContent = this.escapeXml(shape.text);
                    // フォントサイズを抽出（例: "16px sans-serif" → 16）
                    const fontSizeMatch = String(shape.fontSize).match(/(\d+)/);
                    const fontSize = fontSizeMatch ? parseInt(fontSizeMatch[1]) : 16;
                    // テキスト幅を推定（文字数 × フォントサイズ × 0.6）
                    const estimatedWidth = Math.max((textContent.length || 1) * fontSize * 0.6, 50);
                    const estimatedHeight = fontSize * 1.5;

                    const left = Math.round(shape.startX);
                    const top = Math.round(shape.startY);
                    const right = Math.round(shape.startX + estimatedWidth);
                    const bottom = Math.round(shape.startY + estimatedHeight);

                    xmlParts.push('<document>\r\n');
                    xmlParts.push(this.generateDocViewDrawScale(left, top, right, bottom));
                    xmlParts.push(this.generateTextElement({ zIndex: shape.zIndex }));
                    xmlParts.push(`<font size="${fontSize}"/>\r\n`);
                    xmlParts.push(`<font color="${shape.strokeColor || '#000000'}"/>\r\n`);
                    xmlParts.push(`${textContent}\r\n`);
                    xmlParts.push('</document>\r\n');
                }
                break;

            case 'pencil':
            case 'brush':
                // 折れ線として出力 (tad.js形式: <polyline l_atr="..." l_pat="..." strokeColor="..." round="0" start_arrow="0" end_arrow="0" points="x1,y1 x2,y2 ..." />)
                if (shape.path && shape.path.length > 0) {
                    const polylinePoints = shape.path.map(p => `${p.x},${p.y}`).join(' ');
                    const polylineZIndexAttr = shape.zIndex !== undefined && shape.zIndex !== null ? ` zIndex="${shape.zIndex}"` : '';
                    xmlParts.push(`<polyline lineType="${lineType}" lineWidth="${lineWidth}" l_pat="${l_pat}" strokeColor="${strokeColor}" round="0" start_arrow="0" end_arrow="0" points="${polylinePoints}"${polylineZIndexAttr} />\r\n`);
                }
                break;

            case 'polyline':
                // 折れ線として出力（グラフからのコピー等）- shape.pointsを使用
                if (shape.points && shape.points.length > 0) {
                    const polylinePointsStr = shape.points.map(p => `${p.x},${p.y}`).join(' ');
                    const polylineZIndexAttr2 = shape.zIndex !== undefined && shape.zIndex !== null ? ` zIndex="${shape.zIndex}"` : '';
                    xmlParts.push(`<polyline lineType="${lineType}" lineWidth="${lineWidth}" l_pat="${l_pat}" strokeColor="${strokeColor}" round="0" start_arrow="0" end_arrow="0" points="${polylinePointsStr}"${polylineZIndexAttr2} />\r\n`);
                }
                break;

            case 'curve':
                // スプライン曲線として出力 (tad.js形式: <curve l_atr="..." l_pat="..." f_pat="..." fillColor="..." strokeColor="..." type="..." closed="..." points="x1,y1 x2,y2 ..." />)
                if (shape.path && shape.path.length > 0) {
                    const curvePoints = shape.path.map(p => `${p.x},${p.y}`).join(' ');
                    const curveZIndexAttr = shape.zIndex !== undefined && shape.zIndex !== null ? ` zIndex="${shape.zIndex}"` : '';
                    xmlParts.push(`<curve lineType="${lineType}" lineWidth="${lineWidth}" l_pat="${l_pat}" f_pat="${f_pat}" fillColor="${fillColor}" strokeColor="${strokeColor}" type="0" closed="0" start_arrow="0" end_arrow="0" points="${curvePoints}"${curveZIndexAttr} />\r\n`);
                }
                break;

            case 'polygon':
                // tad.js形式: <polygon l_atr="..." l_pat="..." f_pat="..." cornerRadius="..." fillColor="..." strokeColor="..." points="x1,y1 x2,y2 ..." />
                if (shape.points && shape.points.length > 0) {
                    const polygonPoints = shape.points.map(p => `${p.x},${p.y}`).join(' ');
                    const polygonCornerRadius = shape.cornerRadius || 0;
                    const polygonZIndexAttr = shape.zIndex !== undefined && shape.zIndex !== null ? ` zIndex="${shape.zIndex}"` : '';
                    xmlParts.push(`<polygon lineType="${lineType}" lineWidth="${lineWidth}" l_pat="${l_pat}" f_pat="${f_pat}" cornerRadius="${polygonCornerRadius}" fillColor="${fillColor}" strokeColor="${strokeColor}" points="${polygonPoints}"${polygonZIndexAttr} />\r\n`);
                }
                break;

            case 'triangle':
                // 三角形はpolygonとして保存
                const triSaveWidth = shape.endX - shape.startX;
                let triangleSavePoints;

                if (triSaveWidth >= 0) {
                    // 右ドラッグ: 直角が左端（startX位置）
                    triangleSavePoints = `${shape.startX},${shape.startY} ${shape.startX},${shape.endY} ${shape.endX},${shape.endY}`;
                } else {
                    // 左ドラッグ: 直角が右端（startX位置、startXが右側なので）
                    triangleSavePoints = `${shape.startX},${shape.startY} ${shape.startX},${shape.endY} ${shape.endX},${shape.endY}`;
                }

                const triangleZIndexAttr = shape.zIndex !== undefined && shape.zIndex !== null ? ` zIndex="${shape.zIndex}"` : '';
                xmlParts.push(`<polygon lineType="${lineType}" lineWidth="${lineWidth}" l_pat="${l_pat}" f_pat="${f_pat}" cornerRadius="0" fillColor="${fillColor}" strokeColor="${strokeColor}" points="${triangleSavePoints}"${triangleZIndexAttr} />\r\n`);
                break;

            case 'arc':
            case 'chord':
            case 'elliptical_arc':
                // 中心座標と半径を計算
                const acCenterX = shape.centerX || (shape.startX + shape.endX) / 2;
                const acCenterY = shape.centerY || (shape.startY + shape.endY) / 2;
                const acRadiusX = shape.radiusX || Math.abs(shape.endX - shape.startX) / 2;
                const acRadiusY = shape.radiusY || Math.abs(shape.endY - shape.startY) / 2;
                const acStartAngle = shape.startAngle || 0;
                const acEndAngle = shape.endAngle || 90;
                const arcZIndexAttr = shape.zIndex !== undefined && shape.zIndex !== null ? ` zIndex="${shape.zIndex}"` : '';

                if (shape.type === 'arc') {
                    // 扇形
                    xmlParts.push(`<arc lineType="${lineType}" lineWidth="${lineWidth}" l_pat="${l_pat}" f_pat="${f_pat}" angle="${shape.angle || 0}" fillColor="${fillColor}" strokeColor="${strokeColor}" cx="${acCenterX}" cy="${acCenterY}" rx="${acRadiusX}" ry="${acRadiusY}" startAngle="${acStartAngle}" endAngle="${acEndAngle}" start_arrow="0" end_arrow="0"${arcZIndexAttr} />\r\n`);
                } else if (shape.type === 'chord') {
                    // 弦
                    xmlParts.push(`<chord lineType="${lineType}" lineWidth="${lineWidth}" l_pat="${l_pat}" f_pat="${f_pat}" angle="${shape.angle || 0}" fillColor="${fillColor}" strokeColor="${strokeColor}" cx="${acCenterX}" cy="${acCenterY}" rx="${acRadiusX}" ry="${acRadiusY}" startAngle="${acStartAngle}" endAngle="${acEndAngle}" start_arrow="0" end_arrow="0"${arcZIndexAttr} />\r\n`);
                } else {
                    // 楕円弧
                    xmlParts.push(`<elliptical_arc lineType="${lineType}" lineWidth="${lineWidth}" l_pat="${l_pat}" angle="${shape.angle || 0}" strokeColor="${strokeColor}" cx="${acCenterX}" cy="${acCenterY}" rx="${acRadiusX}" ry="${acRadiusY}" startAngle="${acStartAngle}" endAngle="${acEndAngle}" start_arrow="0" end_arrow="0"${arcZIndexAttr} />\r\n`);
                }
                break;

            case 'vobj':
                // tad.js形式: <link id="..." vobjleft="..." vobjtop="..." vobjright="..." vobjbottom="...">
                if (shape.virtualObject) {
                    const vo = shape.virtualObject;
                    const height = shape.endY - shape.startY;
                    // 保護属性を追加
                    const fixedAttr = shape.locked ? ' fixed="true"' : '';
                    const backgroundAttr = shape.isBackground ? ' background="true"' : '';
                    // z-index属性を追加
                    const zIndexAttr = shape.zIndex !== undefined && shape.zIndex !== null ? ` zIndex="${shape.zIndex}"` : '';
                    // 仮身固有の続柄属性を追加
                    const relationshipAttr = vo.linkRelationship && vo.linkRelationship.length > 0
                        ? ` relationship="${vo.linkRelationship.join(' ')}"`
                        : '';
                    // 自己閉じタグ形式（link_nameはJSONから取得する方式に統一）、dlen=0
                    xmlParts.push(`<link id="${vo.link_id}" vobjleft="${shape.startX}" vobjtop="${shape.startY}" vobjright="${shape.endX}" vobjbottom="${shape.endY}" height="${height}" chsz="${vo.chsz || 14}" frcol="${vo.frcol || '#000000'}" chcol="${vo.chcol || '#000000'}" tbcol="${vo.tbcol || '#ffffff'}" bgcol="${vo.bgcol || '#ffffff'}" dlen="0" pictdisp="${vo.pictdisp || 'true'}" namedisp="${vo.namedisp || 'true'}" roledisp="${vo.roledisp || 'false'}" typedisp="${vo.typedisp || 'false'}" updatedisp="${vo.updatedisp || 'false'}" framedisp="${vo.framedisp || 'true'}" autoopen="${vo.autoopen || 'false'}"${relationshipAttr}${fixedAttr}${backgroundAttr}${zIndexAttr}/>\r\n`);
                }
                break;

            case 'image':
                // 画像セグメント - tadjs-viewと同じ形式
                if (shape.fileName) {
                    const rotation = shape.rotation || 0;
                    const flipH = shape.flipH ? 'true' : 'false';
                    const flipV = shape.flipV ? 'true' : 'false';
                    // z-index属性を追加
                    const zIndexAttr = shape.zIndex !== undefined && shape.zIndex !== null ? ` zIndex="${shape.zIndex}"` : '';
                    xmlParts.push(`<image lineType="${lineType}" lineWidth="${lineWidth}" l_pat="${l_pat}" f_pat="${f_pat}" angle="${angle}" rotation="${rotation}" flipH="${flipH}" flipV="${flipV}" left="${shape.startX}" top="${shape.startY}" right="${shape.endX}" bottom="${shape.endY}" href="${this.escapeXml(shape.fileName)}"${zIndexAttr} />\r\n`);
                }
                break;

            case 'document':
                // 文字枠 - TAD.js形式に準拠
                // 1. document要素で文章セグメントを開始
                if (shape.content && shape.content.trim() !== '') {
                    xmlParts.push(`<document>\r\n`);

                    // 2. docView/docDraw/docScale/text形式で位置を定義
                    const textboxZIndexAttr = shape.zIndex !== undefined && shape.zIndex !== null ? ` zIndex="${shape.zIndex}"` : '';
                    xmlParts.push(`<docView viewleft="${shape.startX}" viewtop="${shape.startY}" viewright="${shape.endX}" viewbottom="${shape.endY}"/>\r\n`);
                    xmlParts.push(`<docDraw drawleft="${shape.startX}" drawtop="${shape.startY}" drawright="${shape.endX}" drawbottom="${shape.endY}"/>\r\n`);
                    // 文字枠内docScaleは親figScaleの座標系を継承（UNITS型: デフォルト-72 = 72DPI）
                    const docScaleHunit = this.figScale?.hunit ?? -72;
                    const docScaleVunit = this.figScale?.vunit ?? -72;
                    xmlParts.push(`<docScale hunit="${docScaleHunit}" vunit="${docScaleVunit}"/>\r\n`);
                    xmlParts.push(`<text lang="0" bpat="0"${textboxZIndexAttr}/>\r\n`);

                    // 3. フォント設定
                    const fontSize = shape.fontSize || 16;
                    const fontFamily = shape.fontFamily || 'sans-serif';
                    const textColor = shape.textColor || '#000000';
                    xmlParts.push(`<font size="${fontSize}"/>\r\n`);
                    xmlParts.push(`<font face="${this.escapeXml(fontFamily)}"/>\r\n`);
                    xmlParts.push(`<font color="${this.escapeXml(textColor)}"/>\r\n`);

                    // 4. テキスト配置（textAlign）
                    const textAlign = shape.textAlign || 'left';
                    if (textAlign !== 'left') {
                        xmlParts.push(`<text align="${textAlign}"/>\r\n`);
                    }

                    // 5. 文字修飾の開始タグ
                    const decorations = shape.decorations || {};
                    if (decorations.underline) {
                        xmlParts.push(`<underline>\r\n`);
                    }
                    if (decorations.strikethrough) {
                        xmlParts.push(`<strikethrough>\r\n`);
                    }

                    // 6. テキスト内容（\r\nは無視し、改行は<br/>、改段落は<p></p>で処理）
                    // \r\nを\nに正規化してから分割
                    const normalizedContent = shape.content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
                    const lines = normalizedContent.split('\n');
                    for (let i = 0; i < lines.length; i++) {
                        if (i > 0) {
                            xmlParts.push(`<br/>\r\n`);
                        }
                        xmlParts.push(this.escapeXml(lines[i]));
                    }

                    // 7. 文字修飾の終了タグ（開始と逆順）
                    if (decorations.strikethrough) {
                        xmlParts.push(`</strikethrough>\r\n`);
                    }
                    if (decorations.underline) {
                        xmlParts.push(`</underline>\r\n`);
                    }

                    // 8. document終了
                    xmlParts.push(`</document>\r\n`);
                }
                break;

            case 'pixelmap':
                // ピクセルマップ - ImageDataをPNGファイルとして保存
                const pixelmapZIndexAttr = shape.zIndex !== undefined && shape.zIndex !== null ? ` zIndex="${shape.zIndex}"` : '';
                if (shape.imageData) {
                    // ピクセルマップ番号を取得または生成
                    if (shape.pixelmapNo === undefined) {
                        shape.pixelmapNo = await this.getNextPixelmapNumber();
                    }

                    // ファイル名を生成: fileId_recordNo_pixelmapNo.png
                    const fileId = this.realId || 'unknown';
                    const recordNo = 0;  // 常に0
                    const pixelmapFileName = `${fileId}_${recordNo}_${shape.pixelmapNo}.png`;

                    // ImageDataをPNGとして保存（Promiseを収集して後で待機）
                    const savePromise = this.savePixelmapImageFile(shape.imageData, pixelmapFileName);
                    if (savePromises) {
                        savePromises.push(savePromise);
                    }

                    const rotation = shape.rotation || 0;
                    const flipH = shape.flipH ? 'true' : 'false';
                    const flipV = shape.flipV ? 'true' : 'false';

                    // pixelmap要素として保存（href属性でファイル名を指定）
                    xmlParts.push(`<pixelmap left="${shape.startX}" top="${shape.startY}" right="${shape.endX}" bottom="${shape.endY}" bgcolor="${shape.backgroundColor || '#ffffff'}" rotation="${rotation}" flipH="${flipH}" flipV="${flipV}" href="${this.escapeXml(pixelmapFileName)}"${pixelmapZIndexAttr}/>\r\n`);
                } else {
                    const rotation = shape.rotation || 0;
                    const flipH = shape.flipH ? 'true' : 'false';
                    const flipV = shape.flipV ? 'true' : 'false';

                    // ImageDataがない場合は空のピクセルマップとして保存
                    xmlParts.push(`<pixelmap left="${shape.startX}" top="${shape.startY}" right="${shape.endX}" bottom="${shape.endY}" bgcolor="${shape.backgroundColor || '#ffffff'}" rotation="${rotation}" flipH="${flipH}" flipV="${flipV}"${pixelmapZIndexAttr}/>\r\n`);
                }
                break;

            case 'group':
                // グループをXMLタグで囲んで保存
                if (shape.shapes) {
                    const groupZIndexAttr = shape.zIndex !== undefined && shape.zIndex !== null ? ` zIndex="${shape.zIndex}"` : '';
                    xmlParts.push(`<group left="${shape.startX}" top="${shape.startY}" right="${shape.endX}" bottom="${shape.endY}"${groupZIndexAttr}>\r\n`);
                    for (let i = 0; i < shape.shapes.length; i++) {
                        await this.shapeToXML(shape.shapes[i], `${index}_${i}`, xmlParts, savePromises);
                    }
                    xmlParts.push(`</group>\r\n`);
                }
                break;
        }
    }

    /**
     * shapes配列のz-indexを正規化してソート
     * - z-indexが未設定のshapeに自動採番
     * - 背景化されたshapeは負の値（-1, -2, ...）
     * - 通常のshape（仮身、画像、線など全て）は正の値（1, 2, 3, ...）
     * - Canvasのz-indexは0なので、負の値はCanvas背面、正の値はCanvas前面
     * - z-indexでソート
     */
    normalizeAndSortShapesByZIndex() {
        // 背景化されたshapeと通常のshapeを分離
        const backgroundShapes = [];
        const normalShapes = [];

        for (const shape of this.shapes) {
            if (shape.isBackground) {
                backgroundShapes.push(shape);
            } else {
                normalShapes.push(shape);
            }
        }

        // 背景化されたshapeに負のz-indexを採番（z-index未設定の場合）
        let backgroundIndex = -1;
        for (const shape of backgroundShapes) {
            if (shape.zIndex === null || shape.zIndex === undefined) {
                shape.zIndex = backgroundIndex--;
            }
        }

        // 通常のshapeに正のz-indexを採番（z-index未設定の場合）
        let normalIndex = 1;
        for (const shape of normalShapes) {
            if (shape.zIndex === null || shape.zIndex === undefined) {
                shape.zIndex = normalIndex++;
            }
        }

        // z-indexでソート（小さい順 = 背面から前面へ）
        this.shapes.sort((a, b) => {
            const aZ = a.zIndex !== null && a.zIndex !== undefined ? a.zIndex : 0;
            const bZ = b.zIndex !== null && b.zIndex !== undefined ? b.zIndex : 0;
            return aZ - bZ;
        });

        logger.debug('[FIGURE EDITOR] z-index正規化完了:', {
            total: this.shapes.length,
            background: backgroundShapes.length,
            normal: normalShapes.length
        });
    }

    /**
     * shapes配列の現在の順序に基づいてz-indexを再採番
     * 配列操作ベースのz-order変更に使用
     * - shapes配列は既にz-indexでソート済みと仮定
     * - 背景化図形: -1, -2, -3, ...（配列前方から）
     * - 通常図形: 1, 2, 3, ...（配列前方から）
     */
    reassignZIndicesFromArrayOrder() {
        let backgroundIndex = -1;
        let normalIndex = 1;

        for (const shape of this.shapes) {
            if (shape.isBackground) {
                shape.zIndex = backgroundIndex--;
            } else {
                shape.zIndex = normalIndex++;
            }
        }
    }

    /**
     * 新規図形追加時に使用する次のz-indexを取得
     * 既存図形の最大z-indexに+1した値を返す
     * @returns {number} 次に使用すべきz-index値
     */
    getNextZIndex() {
        let maxZIndex = 0;
        for (const shape of this.shapes) {
            if (shape.zIndex !== null && shape.zIndex !== undefined && shape.zIndex > maxZIndex) {
                maxZIndex = shape.zIndex;
            }
        }
        return maxZIndex + 1;
    }

    // escapeXml は PluginBase に移動済み

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

        // 仮身が選択されている場合は仮身操作メニューを追加
        logger.debug('[FIGURE EDITOR] getMenuDefinition: contextMenuVirtualObject:', this.contextMenuVirtualObject);
        if (this.contextMenuVirtualObject) {
            try {
                logger.debug('[FIGURE EDITOR] getMenuDefinition: 仮身が選択されています realId:', this.contextMenuVirtualObject.realId);

                // 仮身操作メニュー
                const realId = this.contextMenuVirtualObject.realId;
                const isOpened = this.openedRealObjects.has(realId);

                const virtualObjSubmenu = [
                    { label: '開く', action: 'open-real-object', disabled: isOpened },
                    { label: '閉じる', action: 'close-real-object', disabled: !isOpened },
                    { separator: true },
                    { label: '属性変更', action: 'change-virtual-object-attributes' },
                    { label: '続柄設定', action: 'set-relationship' }
                ];

                menuDef.push({
                    label: '仮身操作',
                    submenu: virtualObjSubmenu
                });

                // 実身操作メニュー
                const realObjSubmenu = [
                    { label: '実身名変更', action: 'rename-real-object' },
                    { label: '実身複製', action: 'duplicate-real-object' },
                    { label: '管理情報', action: 'open-realobject-config' },
                    { label: '仮身ネットワーク', action: 'open-virtual-object-network' },
                    { label: '実身/仮身検索', action: 'open-real-object-search' }
                ];

                menuDef.push({
                    label: '実身操作',
                    submenu: realObjSubmenu
                });

                // 屑実身操作メニュー
                menuDef.push({
                    label: '屑実身操作',
                    action: 'open-trash-real-objects'
                });

                // 実行メニュー
                const applistData = await this.getAppListData(this.contextMenuVirtualObject.realId);
                logger.debug('[FIGURE EDITOR] getMenuDefinition: applistData:', applistData);
                if (applistData && Object.keys(applistData).length > 0) {
                    const executeSubmenu = [];
                    for (const [pluginId, appInfo] of Object.entries(applistData)) {
                        logger.debug('[FIGURE EDITOR] getMenuDefinition: 実行メニュー項目追加:', pluginId, appInfo);
                        executeSubmenu.push({
                            label: appInfo.name || pluginId,
                            action: `execute-with-${pluginId}`
                        });
                    }

                    menuDef.push({
                        label: '実行',
                        submenu: executeSubmenu
                    });
                    logger.debug('[FIGURE EDITOR] getMenuDefinition: 実行メニュー追加完了 項目数:', executeSubmenu.length);
                } else {
                    logger.warn('[FIGURE EDITOR] getMenuDefinition: applistDataが空またはnull');
                }
            } catch (error) {
                logger.error('[FIGURE EDITOR] applist取得エラー:', error);
            }
        } else {
            logger.debug('[FIGURE EDITOR] getMenuDefinition: 仮身が選択されていません');
        }

        return menuDef;
    }

    async executeMenuAction(action, additionalData) {
        logger.debug('[FIGURE EDITOR] メニューアクション実行:', action);

        // 仮身の実行メニューからのアクション（基本文章編集プラグインと同じ処理）
        if (action.startsWith('execute-with-')) {
            const pluginId = action.replace('execute-with-', '');
            logger.debug('[FIGURE EDITOR] 仮身を指定アプリで起動:', pluginId);

            // contextMenuVirtualObjectから仮身情報を取得
            if (this.contextMenuVirtualObject && this.contextMenuVirtualObject.virtualObj) {
                    this.messageBus.send('open-virtual-object-real', {
                    virtualObj: this.contextMenuVirtualObject.virtualObj,
                    pluginId: pluginId
                });
                this.setStatus(`${pluginId}で実身を開きます`);
            }
            return;
        }

        switch (action) {
            // 保存
            case 'save':
                await this.saveFile();
                break;

            case 'save-as-new':
                // 新たな実身に保存
                this.saveAsNewRealObject();
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

            case 'toggle-fullscreen':
                this.toggleFullscreen();
                break;

            case 'refresh':
                this.refresh();
                break;

            case 'change-bg-color':
                await this.changeBgColor();
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

            // 仮身操作（基本文章編集プラグインと同じアクション名）
            case 'open-real-object':
                this.openRealObjectWithDefaultApp();
                break;

            case 'close-real-object':
                this.closeRealObject();
                break;

            case 'change-virtual-object-attributes':
                this.changeVirtualObjectAttributes();
                break;

            case 'set-relationship':
                this.setRelationship();
                break;

            // 実身操作
            case 'rename-real-object':
                this.renameRealObject();
                break;

            case 'duplicate-real-object':
                this.duplicateRealObject();
                break;

            case 'open-realobject-config':
                this.openRealObjectConfig();
                break;

            // 屑実身操作
            case 'open-trash-real-objects':
                this.openTrashRealObjects();
                break;

            // 仮身ネットワーク
            case 'open-virtual-object-network':
                this.openVirtualObjectNetwork();
                break;

            // 実身/仮身検索
            case 'open-real-object-search':
                this.openRealObjectSearch();
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

    // === クリップボード操作 ===
    async copyShapes() {
        if (this.selectedShapes.length === 0) {
            this.setStatus('図形が選択されていません');
            return;
        }

        // 画像またはピクセルマップが含まれている場合は自動保存
        // realIdが未設定の場合はsaveFile内で新規実身を作成する
        const hasImageOrPixelmap = this.selectedShapes.some(shape =>
            shape.type === 'image' || shape.type === 'pixelmap'
        );
        if (hasImageOrPixelmap) {
            logger.debug('[FIGURE EDITOR] 画像/ピクセルマップをコピー: 自動保存を実行');
            await this.saveFile();
        }

        // 画像とピクセルマップを特別に処理してコピー
        this.clipboard = this.selectedShapes.map(shape => {
            const copiedShape = JSON.parse(JSON.stringify(shape));

            // 画像セグメントの場合
            if (shape.type === 'image' && shape.imageElement) {
                // imageElementは参照を保持
                copiedShape.imageElement = shape.imageElement;
                copiedShape.imageData = shape.imageData;
            }

            // ピクセルマップの場合
            if (shape.type === 'pixelmap' && shape.imageData) {
                // ImageDataは新しいインスタンスを作成
                copiedShape.imageData = new ImageData(
                    new Uint8ClampedArray(shape.imageData.data),
                    shape.imageData.width,
                    shape.imageData.height
                );
            }

            return copiedShape;
        });

        // 仮身が含まれている場合はグローバルクリップボードにも送信
        const vobjShape = this.selectedShapes.find(shape => shape.type === 'vobj' && shape.virtualObject);
        if (vobjShape && vobjShape.virtualObject) {
            // 仮身オブジェクト全体をコピー（virtual-object-listと同じ方式）
            const clipboardData = JSON.parse(JSON.stringify(vobjShape.virtualObject));
            this.setClipboard(clipboardData);
        } else {
            // 画像セグメントが含まれている場合はグローバルクリップボードにも送信
            const imageShape = this.selectedShapes.find(shape => shape.type === 'image' && shape.imageElement);
            if (imageShape && imageShape.imageElement) {
                this.setImageClipboard(imageShape.imageElement, {
                    width: imageShape.width,
                    height: imageShape.height,
                    name: imageShape.name || 'image.png'
                });
            }
        }

        logger.debug('[FIGURE EDITOR] copyShapes完了: clipboard.length=', this.clipboard.length, 'shapes:', this.clipboard.map(s => s.type));
        this.setStatus(`${this.selectedShapes.length}個の図形をコピーしました`);
    }

    async cutShapes() {
        if (this.selectedShapes.length === 0) {
            this.setStatus('図形が選択されていません');
            return;
        }

        // 仮身が含まれている場合はグローバルクリップボードにも送信（削除前に取得）
        const vobjShape = this.selectedShapes.find(shape => shape.type === 'vobj' && shape.virtualObject);
        if (vobjShape && vobjShape.virtualObject) {
            // 仮身オブジェクト全体をコピー（virtual-object-listと同じ方式）
            const clipboardData = JSON.parse(JSON.stringify(vobjShape.virtualObject));
            this.setClipboard(clipboardData);
        } else {
            // 画像セグメントが含まれている場合はグローバルクリップボードにも送信（削除前に取得）
            const imageShape = this.selectedShapes.find(shape => shape.type === 'image' && shape.imageElement);
            if (imageShape && imageShape.imageElement) {
                this.setImageClipboard(imageShape.imageElement, {
                    width: imageShape.width,
                    height: imageShape.height,
                    name: imageShape.name || 'image.png'
                });
            }
        }

        // 画像とピクセルマップを特別に処理してコピー
        this.clipboard = this.selectedShapes.map(shape => {
            const copiedShape = JSON.parse(JSON.stringify(shape));

            // 画像セグメントの場合
            if (shape.type === 'image' && shape.imageElement) {
                copiedShape.imageElement = shape.imageElement;
                copiedShape.imageData = shape.imageData;
            }

            // ピクセルマップの場合
            if (shape.type === 'pixelmap' && shape.imageData) {
                copiedShape.imageData = new ImageData(
                    new Uint8ClampedArray(shape.imageData.data),
                    shape.imageData.width,
                    shape.imageData.height
                );
            }

            return copiedShape;
        });

        await this.deleteSelectedShapes();
        this.setStatus(`${this.clipboard.length}個の図形を切り取りました`);
    }

    async pasteShapes() {
        logger.debug('[FIGURE EDITOR] pasteShapes開始: clipboard=', this.clipboard ? this.clipboard.length : 'null', 'shapes:', this.clipboard ? this.clipboard.map(s => s.type) : []);
        // ローカルクリップボードを優先チェック（図形データ）
        // basic-text-editorと同様に、直近のローカル操作を優先
        if (this.clipboard && this.clipboard.length > 0) {
            // ローカルクリップボードから貼り付け（下のコードで処理）
            logger.debug('[FIGURE EDITOR] ローカルクリップボードから貼り付け');
        } else {
            // ローカルが空の場合、グローバルクリップボードをチェック
            logger.debug('[FIGURE EDITOR] ローカルクリップボードが空、グローバルをチェック');
            const globalClipboard = await this.getGlobalClipboard();

            // グループ構造の場合（表計算グラフ等）
            if (globalClipboard && globalClipboard.type === 'group' && globalClipboard.group) {
                logger.debug('[FIGURE EDITOR] グローバルクリップボードにグループがあります');
                const group = JSON.parse(JSON.stringify(globalClipboard.group));

                // 座標をオフセット（貼り付け位置調整）
                const offsetX = 20;
                const offsetY = 20;
                this.offsetGroupCoordinates(group, offsetX, offsetY);

                // 新しいz-indexを割り当て
                group.zIndex = this.getNextZIndex();

                this.shapes.push(group);
                this.selectedShapes = [group];
                this.redraw();
                this.isModified = true;
                this.setStatus('グループを貼り付けました');
                return;
            }

            // 仮身の場合
            if (globalClipboard && globalClipboard.link_id) {
                logger.debug('[FIGURE EDITOR] グローバルクリップボードに仮身があります:', globalClipboard.link_name);
                // キャンバス中央に配置
                const x = this.canvas.width / 2;
                const y = this.canvas.height / 2;
                this.insertVirtualObject(x, y, globalClipboard);
                this.setStatus('仮身をクリップボードから貼り付けました');
                return;
            }

            logger.debug('[FIGURE EDITOR] グローバルクリップボードも空');
            this.setStatus('クリップボードが空です');
            return;
        }

        // クリップボードの図形を複製して貼り付け（少しずらす）
        const pastedShapes = [];
        const imageSavePromises = [];

        for (const shape of this.clipboard) {
            const newShape = JSON.parse(JSON.stringify(shape));
            newShape.startX += 20;
            newShape.startY += 20;
            newShape.endX += 20;
            newShape.endY += 20;

            // 画像セグメントの場合
            if (shape.type === 'image') {
                // imageElementを復元
                if (shape.imageElement) {
                    newShape.imageElement = shape.imageElement;
                }
                if (shape.imageData) {
                    newShape.imageData = shape.imageData;
                }
                // 新しい画像番号を割り当て
                newShape.imgNo = await this.getNextImageNumber();
                // ファイル名を更新（this.realIdを使用）
                const fileId = this.realId || 'unknown';
                const recordNo = 0;
                newShape.fileName = `${fileId}_${recordNo}_${newShape.imgNo}.png`;

                // 画像ファイルを保存（imageElementがある場合）
                if (shape.imageElement) {
                    imageSavePromises.push(this.saveImageFromElement(shape.imageElement, newShape.fileName));
                    logger.debug('[FIGURE EDITOR] 画像ペースト: ファイル保存予約', newShape.fileName);
                }
            }

            // ピクセルマップの場合
            if (shape.type === 'pixelmap' && shape.imageData) {
                // ImageDataを復元
                newShape.imageData = new ImageData(
                    new Uint8ClampedArray(shape.imageData.data),
                    shape.imageData.width,
                    shape.imageData.height
                );
                // 新しいピクセルマップ番号を割り当て
                newShape.pixelmapNo = await this.getNextPixelmapNumber();
                // ファイル名を更新（this.realIdを使用）
                const fileId = this.realId || 'unknown';
                const recordNo = 0;
                newShape.fileName = `${fileId}_${recordNo}_${newShape.pixelmapNo}.png`;

                // ピクセルマップ画像ファイルを保存
                imageSavePromises.push(this.savePixelmapImageFile(newShape.imageData, newShape.fileName));
                logger.debug('[FIGURE EDITOR] ピクセルマップペースト: ファイル保存予約', newShape.fileName);
            }

            // 新しいz-indexを割り当て
            newShape.zIndex = this.getNextZIndex();

            pastedShapes.push(newShape);
        }

        // 画像ファイルの保存を待つ
        if (imageSavePromises.length > 0) {
            await Promise.all(imageSavePromises);
            logger.debug('[FIGURE EDITOR] 画像ファイル保存完了:', imageSavePromises.length, '件');
        }

        this.shapes.push(...pastedShapes);
        this.selectedShapes = pastedShapes;
        this.redraw();
        this.isModified = true;
        this.setStatus(`${pastedShapes.length}個の図形を貼り付けました`);
        // スクロールバー更新を通知
        this.resizeCanvas();

        // 画像またはピクセルマップが含まれている場合は自動保存
        const hasImageOrPixelmap = pastedShapes.some(shape =>
            shape.type === 'image' || shape.type === 'pixelmap'
        );
        if (hasImageOrPixelmap) {
            logger.debug('[FIGURE EDITOR] 画像/ピクセルマップをペースト: 自動保存を実行');
            await this.saveFile();
        }
        // クリップボードの位置を更新（次回ペースト時にさらにオフセット）
        for (const shape of this.clipboard) {
            shape.startX += 20;
            shape.startY += 20;
            shape.endX += 20;
            shape.endY += 20;
        }

        logger.debug('[FIGURE EDITOR] pasteShapes完了: clipboard.length=', this.clipboard ? this.clipboard.length : 'null');
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

            // その他の図形は座標を回転（GeometryUtilsを使用）
            const centerX = (shape.startX + shape.endX) / 2;
            const centerY = (shape.startY + shape.endY) / 2;

            if (window.GeometryUtils) {
                // GeometryUtilsで回転
                const rotatedStart = window.GeometryUtils.rotatePoint(
                    shape.startX, shape.startY, centerX, centerY, angle
                );
                const rotatedEnd = window.GeometryUtils.rotatePoint(
                    shape.endX, shape.endY, centerX, centerY, angle
                );
                shape.startX = rotatedStart.x;
                shape.startY = rotatedStart.y;
                shape.endX = rotatedEnd.x;
                shape.endY = rotatedEnd.y;
            } else {
                // フォールバック：従来の実装
                const rad = angle * Math.PI / 180;
                const cos = Math.cos(rad);
                const sin = Math.sin(rad);

                const sx = shape.startX - centerX;
                const sy = shape.startY - centerY;
                shape.startX = centerX + sx * cos - sy * sin;
                shape.startY = centerY + sx * sin + sy * cos;

                const ex = shape.endX - centerX;
                const ey = shape.endY - centerY;
                shape.endX = centerX + ex * cos - ey * sin;
                shape.endY = centerY + ex * sin + ey * cos;
            }

            // 座標を正規化（GeometryUtilsを使用）
            if (window.GeometryUtils) {
                window.GeometryUtils.normalizeCoords(shape);
            } else {
                if (shape.startX > shape.endX) {
                    [shape.startX, shape.endX] = [shape.endX, shape.startX];
                }
                if (shape.startY > shape.endY) {
                    [shape.startY, shape.endY] = [shape.endY, shape.startY];
                }
            }
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
    applyFillColorToSelected(color) {
        if (this.selectedShapes.length === 0) return;

        this.selectedShapes.forEach(shape => {
            shape.fillColor = color;
        });

        this.redraw();
        this.isModified = true;
        this.setStatus(`塗りつぶし色を変更しました: ${color}`);
    }

    applyFillEnabledToSelected(enabled) {
        if (this.selectedShapes.length === 0) return;

        this.selectedShapes.forEach(shape => {
            shape.fillEnabled = enabled;
        });

        this.redraw();
        this.isModified = true;
        this.setStatus(`塗りつぶしを${enabled ? '有効' : '無効'}にしました`);
    }

    applyStrokeColorToSelected(color) {
        logger.debug('[FIGURE EDITOR] applyStrokeColorToSelected:', color, '選択図形数:', this.selectedShapes.length);

        if (this.selectedShapes.length === 0) {
            logger.warn('[FIGURE EDITOR] 選択された図形がありません');
            return;
        }

        this.selectedShapes.forEach((shape, index) => {
            logger.debug(`[FIGURE EDITOR] 図形${index}の線色を変更: ${shape.strokeColor} -> ${color}`);
            shape.strokeColor = color;
        });

        logger.debug('[FIGURE EDITOR] redraw()を呼び出します');
        this.redraw();
        this.isModified = true;
        this.setStatus(`線色を変更しました: ${color}`);
    }

    applyLineWidthToSelected(width) {
        if (this.selectedShapes.length === 0) return;

        this.selectedShapes.forEach(shape => {
            shape.lineWidth = width;
        });

        this.redraw();
        this.isModified = true;
        this.setStatus(`線の太さを変更しました: ${width}px`);
    }

    applyLinePatternToSelected(pattern) {
        if (this.selectedShapes.length === 0) return;

        this.selectedShapes.forEach(shape => {
            shape.linePattern = pattern;
        });

        this.redraw();
        this.isModified = true;
        const patternName = pattern === 'solid' ? '実線' : pattern === 'dotted' ? '点線' : '破線';
        this.setStatus(`線種を変更しました: ${patternName}`);
    }

    /**
     * 選択図形にlineTypeを適用
     * @param {number} lineType - 線種タイプ(0-5)
     */
    applyLineTypeToSelected(lineType) {
        if (this.selectedShapes.length === 0) return;

        this.selectedShapes.forEach(shape => {
            shape.lineType = lineType;
            // 後方互換: linePatternも設定
            const patternMapping = { 0: 'solid', 1: 'dashed', 2: 'dotted' };
            shape.linePattern = patternMapping[lineType] || 'solid';
        });

        this.redraw();
        this.isModified = true;
        const typeName = this.getLineTypeName(lineType);
        this.setStatus(`線種を変更しました: ${typeName}`);
    }

    applyLineConnectionTypeToSelected(connectionType) {
        if (this.selectedShapes.length === 0) return;

        this.selectedShapes.forEach(shape => {
            if (shape.type === 'line') {
                shape.lineConnectionType = connectionType;
            }
        });

        this.redraw();
        this.isModified = true;
        const typeName = connectionType === 'straight' ? '直線' : connectionType === 'elbow' ? 'カギ線' : '曲線';
        this.setStatus(`接続形状を変更しました: ${typeName}`);
    }

    applyCornerRadiusToSelected(radius) {
        if (this.selectedShapes.length === 0) return;

        this.selectedShapes.forEach(shape => {
            if (shape.type === 'rect' || shape.type === 'roundRect') {
                shape.cornerRadius = radius;
                shape.type = radius > 0 ? 'roundRect' : 'rect';
            }
        });

        this.redraw();
        this.isModified = true;
        this.setStatus(`角丸半径を変更しました: ${radius}px`);
    }

    applyArrowPositionToSelected(arrowPosition) {
        if (this.selectedShapes.length === 0) return;

        this.selectedShapes.forEach(shape => {
            if (shape.type === 'line') {
                // arrowPositionから start_arrow と end_arrow を設定
                shape.start_arrow = (arrowPosition === 'start' || arrowPosition === 'both') ? 1 : 0;
                shape.end_arrow = (arrowPosition === 'end' || arrowPosition === 'both') ? 1 : 0;
            }
        });

        this.redraw();
        this.isModified = true;
        const positionName = arrowPosition === 'none' ? 'なし' :
                            arrowPosition === 'start' ? '始点のみ' :
                            arrowPosition === 'end' ? '終点のみ' : '両端';
        this.setStatus(`矢印位置を変更しました: ${positionName}`);
    }

    applyArrowTypeToSelected(arrowType) {
        if (this.selectedShapes.length === 0) return;

        this.selectedShapes.forEach(shape => {
            if (shape.type === 'line') {
                shape.arrow_type = arrowType;
            }
        });

        this.redraw();
        this.isModified = true;
        const typeName = arrowType === 'simple' ? '線のみ' : '塗りつぶし';
        this.setStatus(`矢印種類を変更しました: ${typeName}`);
    }

    applyFontSizeToSelected(fontSize) {
        if (this.selectedShapes.length === 0) return;

        this.selectedShapes.forEach(shape => {
            if (shape.type === 'document') {
                shape.fontSize = fontSize;
            }
        });

        this.redraw();
        this.isModified = true;
        this.setStatus(`フォントサイズを変更しました: ${fontSize}px`);
    }

    applyFontFamilyToSelected(fontFamily) {
        if (this.selectedShapes.length === 0) return;

        this.selectedShapes.forEach(shape => {
            if (shape.type === 'document') {
                shape.fontFamily = fontFamily;
            }
        });

        this.redraw();
        this.isModified = true;
        this.setStatus(`フォントを変更しました`);
    }

    applyTextColorToSelected(textColor) {
        if (this.selectedShapes.length === 0) return;

        this.selectedShapes.forEach(shape => {
            if (shape.type === 'document') {
                shape.textColor = textColor;
            }
        });

        this.redraw();
        this.isModified = true;
        this.setStatus(`文字色を変更しました: ${textColor}`);
    }

    applyTextDecorationToSelected(decoration, enabled) {
        if (this.selectedShapes.length === 0) return;

        this.selectedShapes.forEach(shape => {
            if (shape.type === 'document' && shape.decorations) {
                shape.decorations[decoration] = enabled;
            }
        });

        this.redraw();
        this.isModified = true;
        const statusText = enabled ? `${decoration}を有効にしました` : `${decoration}を無効にしました`;
        this.setStatus(statusText);
    }

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
        this.setStatus('パターン編集（未実装）');
        logger.debug('[FIGURE EDITOR] パターン編集');
    }

    // === 編集（追加） ===
    async pasteMove() {
        // ローカルクリップボードを優先チェック
        if (this.clipboard && this.clipboard.length > 0) {
            // クリップボードから移動（貼り付け後、クリップボードをクリア）
            await this.pasteShapes();
            this.clipboard = [];
            this.setStatus('クリップボードから移動しました');
            return;
        }

        // ローカルが空の場合、グローバルクリップボードをチェック
        const globalClipboard = await this.getGlobalClipboard();
        if (globalClipboard && globalClipboard.link_id) {
            // グローバルクリップボードからの場合は通常のペーストと同じ
            await this.pasteShapes();
            return;
        }

        this.setStatus('クリップボードが空です');
    }

    alignShapes() {
        if (this.selectedShapes.length < 2) {
            this.setStatus('2つ以上の図形を選択してください');
            return;
        }

        // 簡易的な左揃え
        const minX = Math.min(...this.selectedShapes.map(s => Math.min(s.startX, s.endX)));
        this.selectedShapes.forEach(shape => {
            const currentMinX = Math.min(shape.startX, shape.endX);
            const offset = minX - currentMinX;
            shape.startX += offset;
            shape.endX += offset;
        });

        this.redraw();
        this.isModified = true;
        this.setStatus('図形を位置合わせしました');
    }

    // === 図形操作（追加） ===
    transformShape() {
        if (this.selectedShapes.length === 0) {
            this.setStatus('図形が選択されていません');
            return;
        }
        this.setStatus('変形（未実装）');
        logger.debug('[FIGURE EDITOR] 変形');
    }

    invertColor() {
        if (this.selectedShapes.length === 0) {
            this.setStatus('図形が選択されていません');
            return;
        }

        this.selectedShapes.forEach(shape => {
            // RGB色を反転（共通ユーティリティを使用）
            const invertHex = window.invertColor || ((hex) => {
                const r = 255 - parseInt(hex.substr(1, 2), 16);
                const g = 255 - parseInt(hex.substr(3, 2), 16);
                const b = 255 - parseInt(hex.substr(5, 2), 16);
                return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
            });

            shape.strokeColor = invertHex(shape.strokeColor);
            if (shape.fillColor && shape.fillColor !== 'transparent') {
                shape.fillColor = invertHex(shape.fillColor);
            }
        });

        this.redraw();
        this.isModified = true;
        this.setStatus('色を反転しました');
    }

    burnShape() {
        if (this.selectedShapes.length === 0) {
            this.setStatus('図形が選択されていません');
            return;
        }
        this.setStatus('焼き付け（未実装）');
        logger.debug('[FIGURE EDITOR] 焼き付け');
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
                ctx.strokeStyle = '#808080';
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

    // === 仮身操作 ===
    /**
     * 選択中の仮身を閉じる
     */
    closeVirtualObject() {
        // 選択された図形の中から仮身を探す
        const virtualObjectShape = this.selectedShapes.find(shape => shape.type === 'vobj');

        if (!virtualObjectShape || !virtualObjectShape.virtualObject) {
            this.setStatus('仮身が選択されていません');
            logger.warn('[FIGURE EDITOR] 選択中の仮身がありません');
            return;
        }

        const vobj = virtualObjectShape.virtualObject;
        // extractRealIdを使用して一貫したキー形式にする
        const realId = window.RealObjectSystem.extractRealId(vobj.link_id);

        // 開いているかチェック
        if (!this.openedRealObjects.has(realId)) {
            this.setStatus('実身は開いていません');
            logger.debug('[FIGURE EDITOR] 実身は開いていません:', realId);
            return;
        }

        const windowId = this.openedRealObjects.get(realId);
        logger.debug('[FIGURE EDITOR] 実身ウィンドウを閉じます:', windowId, 'realId:', realId);

        // 親ウィンドウにウィンドウクローズを要求
        if (this.messageBus) {
            this.messageBus.send('close-window', {
                windowId: windowId
            });
        }

        // 追跡から削除（window-closedイベントでも削除されるが、ここでも削除）
        this.openedRealObjects.delete(realId);
        this.setStatus('実身を閉じました');
    }

    /**
     * 選択された仮身の実身を指定されたプラグインで開く
     * 仮身一覧プラグインから完全コピー
     * @param {string} pluginId - 開くプラグインのID
     */
    async executeVirtualObjectWithPlugin(pluginId) {
        // 選択中の仮身図形を取得
        const virtualObjectShape = this.selectedShapes.find(s => s.type === 'vobj');
        if (!virtualObjectShape || !virtualObjectShape.virtualObject) {
            logger.warn('[FIGURE EDITOR] 仮身が選択されていません');
            return;
        }

        const selectedVirtualObject = virtualObjectShape.virtualObject;
        // extractRealIdを使用してcontextMenuVirtualObject.realIdと一致させる
        const realId = window.RealObjectSystem.extractRealId(selectedVirtualObject.link_id);
        logger.debug('[FIGURE EDITOR] 仮身の実身を開く:', realId, 'プラグイン:', pluginId);

        // ウィンドウが開いた通知を受け取るハンドラー
        const messageId = `open-${realId}-${Date.now()}`;
        // 親ウィンドウ(tadjs-desktop.js)に実身を開くよう要求
        if (this.messageBus) {
            this.messageBus.send('open-virtual-object-real', {
                virtualObj: selectedVirtualObject,
                pluginId: pluginId,
                messageId: messageId
            });

            try {
                const result = await this.messageBus.waitFor('window-opened', window.LONG_OPERATION_TIMEOUT_MS, (data) => {
                    return data.messageId === messageId;
                });

                if (result.success && result.windowId) {
                    // 開いたウィンドウを追跡
                    this.openedRealObjects.set(realId, result.windowId);
                    logger.debug('[FIGURE EDITOR] ウィンドウが開きました:', result.windowId, 'realId:', realId);

                    // ウィンドウのアイコンを設定
                    // realIdから_0.xtadなどのサフィックスを除去して基本実身IDを取得（共通メソッドを使用）
                    const baseRealId = window.RealObjectSystem.extractRealId(realId);
                    const iconPath = `${baseRealId}.ico`;
                    if (this.messageBus) {
                        this.messageBus.send('set-window-icon', {
                            windowId: result.windowId,
                            iconPath: iconPath
                        });
                        logger.debug('[FIGURE EDITOR] ウィンドウアイコン設定要求:', result.windowId, iconPath);
                    }
                }
            } catch (error) {
                logger.error('[FIGURE EDITOR] ウィンドウ開起エラー:', error);
            }
        }
    }

    /**
     * 選択中の仮身が指し示す実身をデフォルトアプリで開く
     * 仮身一覧プラグインから完全コピー
     */
    openRealObjectWithDefaultApp() {
        // 選択中の仮身図形を取得
        const virtualObjectShape = this.selectedShapes.find(s => s.type === 'vobj');
        if (!virtualObjectShape || !virtualObjectShape.virtualObject) {
            logger.warn('[FIGURE EDITOR] 選択中の仮身がありません');
            return;
        }

        const selectedVirtualObject = virtualObjectShape.virtualObject;

        const applist = selectedVirtualObject.applist;
        if (!applist || typeof applist !== 'object') {
            logger.warn('[FIGURE EDITOR] applistが存在しません');
            return;
        }

        // defaultOpen=trueのプラグインを探す
        let defaultPluginId = null;
        for (const [pluginId, config] of Object.entries(applist)) {
            if (config.defaultOpen === true) {
                defaultPluginId = pluginId;
                break;
            }
        }

        if (!defaultPluginId) {
            // defaultOpen=trueがない場合は最初のプラグインを使用
            defaultPluginId = Object.keys(applist)[0];
        }

        if (!defaultPluginId) {
            logger.warn('[FIGURE EDITOR] 開くためのプラグインが見つかりません');
            return;
        }

        // 実身を開く
        this.executeVirtualObjectWithPlugin(defaultPluginId);

        // 開いた実身を追跡
        const realId = selectedVirtualObject.link_id;
        // windowIdは親ウィンドウから通知される想定
        logger.debug('[FIGURE EDITOR] 実身を開く:', realId, 'with', defaultPluginId);
    }

    /**
     * 仮身に属性を適用
     * @param {Object} attrs - 適用する属性値
     */
    applyVirtualObjectAttributes(attrs) {
        // contextMenuVirtualObjectから仮身情報を取得
        if (!this.contextMenuVirtualObject || !this.contextMenuVirtualObject.virtualObj) {
            logger.warn('[FIGURE EDITOR] 仮身が見つかりません');
            return;
        }

        const vobj = this.contextMenuVirtualObject.virtualObj;
        // shapeを探す（contextMenuVirtualObject.shapeまたはshapes配列から）
        const shape = this.contextMenuVirtualObject.shape
            || this.shapes.find(s => s.type === 'vobj' && s.virtualObject === vobj);

        if (!shape) {
            logger.warn('[FIGURE EDITOR] 仮身図形が見つかりません');
            return;
        }

        // PluginBaseの共通メソッドで属性を適用
        this._applyVobjAttrs(vobj, attrs);

        // 修正フラグを立てる
        this.isModified = true;

        // 既存のDOM要素を削除して強制再作成（属性を反映させるため）
        if (shape.vobjElement && shape.vobjElement.parentNode) {
            shape.vobjElement.remove();
            shape.vobjElement = null;
        }

        // Canvas再描画
        this.redraw();

        // 仮身DOM要素を再生成して表示を更新
        this.renderVirtualObjectsAsElements();

        this.setStatus('仮身属性を変更しました');
    }

    /**
     * 実身のapplistデータを取得（基本文章編集プラグインから丸コピー）
     */
    // getAppListData() は基底クラス PluginBase で定義

    // closeRealObject() は基底クラス PluginBase で定義

    /**
     * 仮身属性変更ダイアログを表示
     */
    async changeVirtualObjectAttributes() {
        // contextMenuVirtualObjectが設定されていない場合は選択中の図形から設定
        if (!this.contextMenuVirtualObject) {
            const virtualObjectShape = this.selectedShapes.find(s => s.type === 'vobj');
            if (!virtualObjectShape || !virtualObjectShape.virtualObject) {
                this.setStatus('仮身が選択されていません');
                return;
            }
            const vobj = virtualObjectShape.virtualObject;
            const realId = window.RealObjectSystem.extractRealId(vobj.link_id);
            this.contextMenuVirtualObject = {
                virtualObj: vobj,
                element: virtualObjectShape.vobjElement,
                realId: realId,
                shape: virtualObjectShape
            };
        }

        await window.RealObjectSystem.changeVirtualObjectAttributes(this);
    }

    /**
     * 続柄設定（changeVirtualObjectAttributesパターン踏襲）
     */
    async setRelationship() {
        // contextMenuVirtualObjectが設定されていない場合は選択中の図形から設定
        if (!this.contextMenuVirtualObject) {
            const virtualObjectShape = this.selectedShapes.find(s => s.type === 'vobj');
            if (!virtualObjectShape || !virtualObjectShape.virtualObject) {
                this.setStatus('仮身が選択されていません');
                return { success: false };
            }
            const vobj = virtualObjectShape.virtualObject;
            const realId = window.RealObjectSystem.extractRealId(vobj.link_id);
            this.contextMenuVirtualObject = {
                virtualObj: vobj,
                element: virtualObjectShape.vobjElement,
                realId: realId,
                shape: virtualObjectShape
            };
        }

        // 親クラスのsetRelationship()を呼び出す（metadata更新とフック呼び出しを含む）
        return await super.setRelationship();
    }

    /**
     * 仮身の続柄をXMLに保存（PluginBaseフックオーバーライド）
     * basic-figure-editorはsaveFile()でXML全体を再構築するため、saveFile()を呼ぶ
     * @param {Object} virtualObj - 更新された仮身オブジェクト
     * @returns {Promise<void>}
     */
    async saveVirtualObjectRelationshipToXml(virtualObj) {
        if (virtualObj && virtualObj.link_id) {
            await this.saveFile();
        }
    }

    /**
     * 続柄更新後の再描画（PluginBaseフック）
     */
    onRelationshipUpdated(virtualObj, result) {
        // contextMenuVirtualObjectからshapeを取得
        const shape = this.contextMenuVirtualObject?.shape
            || this.shapes.find(s => s.type === 'vobj' && s.virtualObject === virtualObj);

        if (shape && shape.vobjElement) {
            // 既存のDOM要素を削除して強制再作成
            if (shape.vobjElement.parentNode) {
                shape.vobjElement.remove();
            }
            shape.vobjElement = null;
        }

        // Canvas再描画と仮身DOM要素の再生成
        this.redraw();
        this.isModified = true;
    }

    /**
     * プラグイン内の全仮身を取得（PluginBaseオーバーライド）
     * @returns {Array<Object>} 仮身情報の配列
     */
    getAllVirtualObjects() {
        return this.shapes
            .filter(shape => shape.type === 'vobj' && shape.virtualObject)
            .map(shape => ({
                virtualObj: shape.virtualObject,
                shape: shape,
                element: shape.vobjElement
            }));
    }

    /**
     * 仮身の表示を更新（PluginBaseオーバーライド）
     * @param {Object} item - getAllVirtualObjectsで返された仮身情報
     */
    async updateVirtualObjectDisplay(item) {
        const { shape } = item;
        if (!shape) return;

        // DOM要素を削除して強制再作成
        if (shape.vobjElement) {
            if (shape.vobjElement.parentNode) {
                shape.vobjElement.remove();
            }
            shape.vobjElement = null;
        }

        // 仮身要素を再作成（vobjElement = nullなので新規作成される）
        this.renderVirtualObjectsAsElements();
        this.redraw();
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
                    chsz: originalVobj.chsz || 14,
                    frcol: originalVobj.frcol || '#000000',
                    chcol: originalVobj.chcol || '#000000',
                    tbcol: originalVobj.tbcol || '#ffffff',
                    bgcol: originalVobj.bgcol || '#ffffff',
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
                const chszPx = (newVirtualObject.chsz || 14) * (96 / 72);
                const lineHeight = 1.2;
                const textHeight = Math.ceil(chszPx * lineHeight);
                const newHeight = textHeight + 8;

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
     * 仮身ネットワークウィンドウを開く
     */
    openVirtualObjectNetwork() {
        if (!this.contextMenuVirtualObject) {
            logger.warn('[FIGURE EDITOR] 仮身が選択されていません');
            this.setStatus('仮身を選択してください');
            return;
        }

        // 実身IDを取得
        const realId = this.contextMenuVirtualObject.realId;
        if (!realId) {
            logger.warn('[FIGURE EDITOR] 実身IDが取得できません');
            this.setStatus('実身IDが取得できません');
            return;
        }

        window.RealObjectSystem.openVirtualObjectNetwork(this, realId);
    }

    /**
     * 実身/仮身検索ウィンドウを開く
     */
    openRealObjectSearch() {
        window.RealObjectSystem.openRealObjectSearch(this);
    }

    toggleFullscreen() {
        if (this.messageBus) {
            this.messageBus.send('toggle-maximize');

            this.isFullscreen = !this.isFullscreen;
            this.setStatus(this.isFullscreen ? '全画面表示ON' : '全画面表示OFF');
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
        // 既に開いている場合はトグル
        const existingWindowId = this.getChildPanelWindowId('material');
        if (existingWindowId) {
            this.closeChildPanelWindow('material');
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

    /**
     * appListからdefaultOpenのプラグインIDを取得
     */
    getDefaultOpenFromAppList(appListData) {
        for (const [pluginId, appInfo] of Object.entries(appListData)) {
            if (appInfo.defaultOpen === true) {
                return pluginId;
            }
        }
        return null;
    }

    // loadRealObjectData() は基底クラス PluginBase で定義

    /**
     * 親ウィンドウからファイルデータを読み込む
     * @param {string} fileName - ファイル名
     * @returns {Promise<Blob>} ファイルデータ
     */
    async loadDataFileFromParent(fileName) {
        const messageId = this.generateMessageId('load');

        if (this.messageBus) {
            this.messageBus.send('load-data-file-request', {
                messageId: messageId,
                fileName: fileName
            });
        }

        try {
            const result = await this.messageBus.waitFor('load-data-file-response', window.DEFAULT_TIMEOUT_MS, (data) => {
                return data.messageId === messageId;
            });
            if (result.success) {
                return result.data;
            } else {
                throw new Error(result.error || 'ファイル読み込み失敗');
            }
        } catch (error) {
            throw new Error('ファイル読み込みエラー: ' + error.message);
        }
    }

    /**
     * 仮身のメタデータ（applist等）をJSONファイルから読み込む
     * @param {Object} virtualObj - 仮身オブジェクト
     */
    async loadVirtualObjectMetadata(virtualObj) {
        try {
            // 実身IDを抽出してJSONファイル名を生成（共通メソッドを使用）
            const baseFileId = window.RealObjectSystem.extractRealId(virtualObj.link_id);
            const jsonFileName = window.RealObjectSystem.getRealObjectJsonFileName(baseFileId);
            logger.debug('[FIGURE EDITOR] メタデータ読み込み試行:', virtualObj.link_id, 'JSONファイル:', jsonFileName);

            // 親ウィンドウのfileObjectsからJSONファイルを取得
            if (window.parent && window.parent.tadjsDesktop && window.parent.tadjsDesktop.fileObjects) {
                const jsonFile = window.parent.tadjsDesktop.fileObjects[jsonFileName];
                logger.debug('[FIGURE EDITOR] fileObjectsから検索:', jsonFileName, 'found:', !!jsonFile);

                if (jsonFile) {
                    const jsonText = await jsonFile.text();
                    const jsonData = JSON.parse(jsonText);

                    // applistはオブジェクト形式 { "plugin-id": { "name": "プラグイン名" }, ... }
                    virtualObj.applist = jsonData.applist || {};
                    virtualObj.metadata = jsonData;
                    virtualObj.updateDate = jsonData.updateDate; // 更新日時を保存
                    // 実身名とlink_nameの同期: JSON.nameが存在し異なる場合はJSON.nameを優先
                    if (jsonData.name && virtualObj.link_name !== jsonData.name) {
                        virtualObj.link_name = jsonData.name;
                    }
                    logger.debug('[FIGURE EDITOR] メタデータ読み込み成功:', virtualObj.link_id, virtualObj.applist);
                } else {
                    // JSONファイルが見つからない場合、Electron環境なら親ウィンドウ経由で読み込み
                    logger.debug('[FIGURE EDITOR] fileObjectsに見つからない、親ウィンドウ経由で試行:', jsonFileName);

                    try {
                        const jsonFile = await this.loadDataFileFromParent(jsonFileName);
                        const jsonText = await jsonFile.text();
                        const jsonData = JSON.parse(jsonText);
                        virtualObj.applist = jsonData.applist || {};
                        virtualObj.metadata = jsonData;
                        virtualObj.updateDate = jsonData.updateDate; // 更新日時を保存
                        // 実身名とlink_nameの同期: JSON.nameが存在し異なる場合はJSON.nameを優先
                        if (jsonData.name && virtualObj.link_name !== jsonData.name) {
                            virtualObj.link_name = jsonData.name;
                        }
                        logger.debug('[FIGURE EDITOR] メタデータ読み込み成功（親ウィンドウ経由）:', jsonFileName, virtualObj.applist);
                    } catch (parentError) {
                        logger.debug('[FIGURE EDITOR] 親ウィンドウ経由で失敗、HTTP fetchにフォールバック:', parentError.message);

                        // HTTP fetchにフォールバック
                        const urlsToTry = [
                            `../../${jsonFileName}`,  // resources/app/
                            `../basic-text-editor/${jsonFileName}`,
                            `../unpack-file/${jsonFileName}`,
                            `../virtual-object-list/${jsonFileName}`,
                            `../base-file-manager/${jsonFileName}`,
                            `../system-config/${jsonFileName}`,
                            `../user-config/${jsonFileName}`,
                            `../tadjs-view/${jsonFileName}`
                        ];

                        let found = false;
                        for (const jsonUrl of urlsToTry) {
                            logger.debug('[FIGURE EDITOR] Fetch URL試行:', jsonUrl);
                            const response = await fetch(jsonUrl);

                            if (response.ok) {
                                const jsonData = await response.json();
                                virtualObj.applist = jsonData.applist || {};
                                virtualObj.metadata = jsonData;
                                virtualObj.updateDate = jsonData.updateDate; // 更新日時を保存
                                // 実身名とlink_nameの同期: JSON.nameが存在し異なる場合はJSON.nameを優先
                                if (jsonData.name && virtualObj.link_name !== jsonData.name) {
                                    virtualObj.link_name = jsonData.name;
                                }
                                logger.debug('[FIGURE EDITOR] メタデータ読み込み成功（HTTP）:', jsonUrl, virtualObj.applist);
                                found = true;
                                break;
                            }
                        }

                        if (!found) {
                            logger.debug('[FIGURE EDITOR] JSONファイルなし（すべてのパスで404）:', virtualObj.link_id);
                            virtualObj.applist = {};
                        }
                    }
                }
            } else {
                // 親ウィンドウのfileObjectsにアクセスできない場合（親ウィンドウ経由で読み込み）
                logger.debug('[FIGURE EDITOR] 親ウィンドウのfileObjectsにアクセスできない、親ウィンドウ経由で読み込み');

                try {
                    const jsonFile = await this.loadDataFileFromParent(jsonFileName);
                    const jsonText = await jsonFile.text();
                    const jsonData = JSON.parse(jsonText);
                    virtualObj.applist = jsonData.applist || {};
                    virtualObj.metadata = jsonData;
                    virtualObj.updateDate = jsonData.updateDate; // 更新日時を保存
                    // 実身名とlink_nameの同期: JSON.nameが存在し異なる場合はJSON.nameを優先
                    if (jsonData.name && virtualObj.link_name !== jsonData.name) {
                        virtualObj.link_name = jsonData.name;
                    }
                    logger.debug('[FIGURE EDITOR] メタデータ読み込み成功（親ウィンドウ経由）:', jsonFileName, virtualObj.applist);
                } catch (error) {
                    logger.debug('[FIGURE EDITOR] メタデータ読み込み失敗:', virtualObj.link_id, error.message);
                    virtualObj.applist = {};
                }
            }
        } catch (error) {
            logger.debug('[FIGURE EDITOR] メタデータ読み込みエラー:', virtualObj.link_id, error);
            virtualObj.applist = {};
        }
    }

    /**
     * 開いた仮身に実身の内容を表示
     * @param {HTMLElement} vobjElement - 仮身のDOM要素
     * @param {Object} shape - 仮身のshapeオブジェクト
     * @param {Object} options - オプション
     * @returns {Promise<HTMLIFrameElement>} コンテンツiframe
     */
    async expandVirtualObject(vobjElement, shape, options = {}) {
        const virtualObject = shape.virtualObject;
        logger.debug('[FIGURE EDITOR] 開いた仮身の展開開始:', virtualObject.link_name);

        // 展開フラグを設定（renderVirtualObjectsAsElementsによる中断を防ぐ）
        this.isExpandingVirtualObject = true;

        try {
            // 実身IDを取得
            const linkId = virtualObject.link_id;
            logger.debug('[FIGURE EDITOR] linkId:', linkId);
            // 実身IDを抽出（共通メソッドを使用）
            const realId = window.RealObjectSystem.extractRealId(linkId);
            logger.debug('[FIGURE EDITOR] 抽出されたrealId:', realId);
            logger.debug('[FIGURE EDITOR] レコード番号削除後（最終的な実身ID）:', realId);

            // 1. defaultOpenプラグインを取得
            const defaultOpenPlugin = this.getDefaultOpenPlugin(virtualObject);
            if (!defaultOpenPlugin) {
                logger.warn('[FIGURE EDITOR] defaultOpenプラグインが見つかりません');
                return null;
            }
            logger.debug('[FIGURE EDITOR] defaultOpenプラグイン:', defaultOpenPlugin);

            // 2. 実身データを読み込む
            const realObjectData = await this.loadRealObjectData(realId);
            if (!realObjectData) {
                logger.warn('[FIGURE EDITOR] 実身データの読み込みに失敗しました, realId:', realId);
                return null;
            }
            logger.debug('[FIGURE EDITOR] 実身データ読み込み完了:', realObjectData);

            // 3. コンテンツ領域を取得
            const contentArea = vobjElement.querySelector('.virtual-object-content-area');
            if (!contentArea) {
                logger.error('[FIGURE EDITOR] コンテンツ領域が見つかりません');
                return null;
            }

            // コンテンツ領域のスクロールバーを非表示（noScrollbarオプション対応）
            if (options.noScrollbar !== false) {
                contentArea.style.overflow = 'hidden';
            }

            // コンテンツ領域自体のドラッグも無効化
            contentArea.style.pointerEvents = 'none';
            contentArea.style.userSelect = 'none';
            contentArea.setAttribute('draggable', 'false');

            // 仮身の色属性を取得
            const bgcol = virtualObject.bgcol || '#ffffff';

            // 4. プラグインをiframeで読み込む（プラグインが描画する）
            const iframe = document.createElement('iframe');
            iframe.className = 'virtual-object-content';
            iframe.style.width = '100%';
            iframe.style.height = '100%';
            iframe.style.border = 'none';
            iframe.style.overflow = 'hidden';
            iframe.style.padding = '0';
            iframe.style.backgroundColor = bgcol;
            iframe.style.userSelect = 'none';
            iframe.style.pointerEvents = 'none'; // 開いた仮身内の操作を無効化（図形編集上では表示のみ）
            iframe.style.webkitUserDrag = 'none'; // Webkitブラウザでのドラッグを無効化
            iframe.setAttribute('draggable', 'false'); // iframe自体のドラッグを無効化
            iframe.src = `../../plugins/${defaultOpenPlugin}/index.html`;

            // iframeロード後にデータを送信（load-virtual-objectメッセージ形式）
            iframe.addEventListener('load', () => {
                logger.debug('[FIGURE EDITOR] iframe読み込み完了、プラグインにload-virtual-objectメッセージ送信');
                iframe.contentWindow.postMessage({
                    type: 'load-virtual-object',
                    virtualObj: virtualObject,
                    realObject: realObjectData,
                    bgcol: bgcol,
                    readonly: options.readonly !== false,
                    noScrollbar: options.noScrollbar !== false
                }, '*');
                logger.debug('[FIGURE EDITOR] 開いた仮身表示にデータを送信:', { virtualObject, realObjectData, bgcol, readonly: options.readonly !== false, noScrollbar: options.noScrollbar !== false });
            });

            contentArea.appendChild(iframe);
            logger.debug('[FIGURE EDITOR] iframe追加完了');

            // shapeにiframeへの参照を保存
            shape.expandedElement = iframe;

            return iframe;
        } catch (error) {
            logger.error('[FIGURE EDITOR] expandVirtualObject エラー:', error);
            return null;
        } finally {
            // 展開フラグをリセット
            this.isExpandingVirtualObject = false;
        }
    }

    /**
     * defaultOpenプラグインを取得
     * @param {Object} virtualObject - 仮身オブジェクト
     * @returns {string|null} プラグインID
     */
    getDefaultOpenPlugin(virtualObject) {
        const applist = virtualObject.applist || {};
        for (const [pluginId, config] of Object.entries(applist)) {
            if (config && config.defaultOpen === true) {
                return pluginId;
            }
        }
        // デフォルトは基本文章編集
        return 'basic-text-editor';
    }


    /**
     * 開いた仮身のサイズを更新
     */
    updateExpandedVirtualObjectSize(shape, width, height) {
        if (!shape.expanded || !shape.vobjElement) {
            return;
        }

        // DOM要素全体のサイズを更新
        shape.vobjElement.style.width = `${width}px`;
        shape.vobjElement.style.height = `${height}px`;

        // 内部のiframeもVirtualObjectRendererによって自動的にリサイズされる
    }

    /**
     * 仮身を通常表示に戻す
     */
    collapseVirtualObject(shape) {
        if (!shape.expanded) {
            return;
        }

        shape.expanded = false;
        logger.debug('[FIGURE EDITOR] 仮身を通常表示に戻す:', shape.virtualObject.link_name);

        // コンテンツ領域内のiframeを削除
        if (shape.vobjElement) {
            const contentArea = shape.vobjElement.querySelector('.virtual-object-content-area');
            if (contentArea) {
                contentArea.innerHTML = ''; // すべての子要素（iframe）を削除
            }
        }

        delete shape.expandedElement;
    }

    /**
     * リサイズプレビュー枠を作成
     */
    createResizePreviewBox(shape) {
        // 既存のプレビュー枠がある場合は削除
        this.removeResizePreviewBox();

        // Canvas の座標を画面座標に変換
        const rect = this.canvas.getBoundingClientRect();
        const canvasX = shape.startX;
        const canvasY = shape.startY;
        const canvasWidth = shape.endX - shape.startX;
        const canvasHeight = shape.endY - shape.startY;

        const screenX = rect.left + canvasX;
        const screenY = rect.top + canvasY;

        // プレビュー枠を作成
        const previewBox = document.createElement('div');
        previewBox.style.position = 'fixed'; // キャンバス外でも表示されるようにfixedを使用
        previewBox.style.left = `${screenX}px`;
        previewBox.style.top = `${screenY}px`;
        previewBox.style.width = `${canvasWidth}px`;
        previewBox.style.height = `${canvasHeight}px`;
        previewBox.style.border = '2px dashed rgba(0, 123, 255, 0.8)';
        previewBox.style.backgroundColor = 'rgba(0, 123, 255, 0.1)';
        previewBox.style.pointerEvents = 'none';
        previewBox.style.zIndex = '2147483647'; // 最大のz-index値（32bit整数の最大値）
        previewBox.style.boxSizing = 'border-box';

        // document.body に直接追加
        document.body.appendChild(previewBox);

        this.resizePreviewBox = previewBox;

        logger.debug('[FIGURE EDITOR] リサイズプレビュー枠を作成しました');
    }

    /**
     * リサイズプレビュー枠を更新
     */
    updateResizePreviewBox(shape) {
        if (!this.resizePreviewBox) {
            logger.warn('[FIGURE EDITOR] リサイズプレビュー枠が存在しません');
            return;
        }

        // Canvas の座標を画面座標に変換
        const rect = this.canvas.getBoundingClientRect();
        const canvasX = shape.startX;
        const canvasY = shape.startY;
        const canvasWidth = shape.endX - shape.startX;
        const canvasHeight = shape.endY - shape.startY;

        const screenX = rect.left + canvasX;
        const screenY = rect.top + canvasY;

        // プレビュー枠のサイズと位置を更新
        this.resizePreviewBox.style.left = `${screenX}px`;
        this.resizePreviewBox.style.top = `${screenY}px`;
        this.resizePreviewBox.style.width = `${canvasWidth}px`;
        this.resizePreviewBox.style.height = `${canvasHeight}px`;
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
     * すべての仮身のアイコンを事前読み込み
     * アイコンデータをthis.iconDataオブジェクトに格納し、DOM要素作成時に使用
     */
    async preloadVirtualObjectIcons() {
        // iconDataは PluginBase で初期化済み、ここでクリア
        this.iconData = {};

        if (!this.virtualObjectRenderer) {
            return;
        }

        // 仮身図形から実身IDを抽出（グループ内を含む全仮身）
        const virtualObjectShapes = this.collectAllVirtualObjectShapes().filter(shape => shape.virtualObject.link_id);
        const realIds = virtualObjectShapes.map(shape =>
            shape.virtualObject.link_id.replace(/_\d+\.xtad$/i, '')
        );

        // PluginBase共通メソッドでアイコン一括読み込み
        await this.loadAndStoreIcons(realIds);

        // VirtualObjectRendererのキャッシュにも格納（Canvas描画時に使用）
        for (const realId of Object.keys(this.iconData)) {
            await this.virtualObjectRenderer.loadIconToCache(realId, this.iconData[realId]);
        }
    }

    /**
     * 仮身をDOM要素として描画
     */
    renderVirtualObjectsAsElements() {
        // リサイズ中は何もしない（DOM要素の削除・再作成を避ける）
        if (this.isResizingVirtualObject) {
            return;
        }

        // 再作成中は何もしない（タイマーベースの再作成を中断しない）
        if (this.isRecreatingVirtualObject) {
            return;
        }

        // 展開中は何もしない（展開操作を中断しない）
        if (this.isExpandingVirtualObject) {
            return;
        }

        // Canvas要素のz-indexを0に設定
        // 背景化図形（z-index < 0）はCanvasより背面、通常図形（z-index > 0）はCanvasより前面
        this.canvas.style.zIndex = '0';

        // 仮身図形をフィルタ
        const virtualObjectShapes = this.shapes.filter(shape =>
            shape.type === 'vobj' && shape.virtualObject
        );

        // 現在有効な仮身のlink_idセットを作成
        const validLinkIds = new Set(virtualObjectShapes.map(shape => shape.virtualObject.link_id));

        // 既存のDOM要素のうち、対応するshapeがないものだけを削除
        const existingElements = document.querySelectorAll('.virtual-object-element');
        existingElements.forEach(el => {
            const linkId = el.dataset.linkId;
            if (!linkId || !validLinkIds.has(linkId)) {
                logger.debug('[FIGURE EDITOR] 不要な仮身DOM要素を削除:', linkId);
                el.remove();
            }
        });

        // 各仮身図形をDOM要素として作成または更新
        virtualObjectShapes.forEach(shape => {
            // 既にDOM要素が存在し、親ノードにも接続されている場合は、位置とサイズのみ更新
            if (shape.vobjElement && shape.vobjElement.parentNode) {
                logger.debug('[FIGURE EDITOR] 既存の仮身DOM要素を再利用:', shape.virtualObject.link_name, 'vobjElement:', !!shape.vobjElement, 'parentNode:', !!shape.vobjElement.parentNode);
                const width = shape.endX - shape.startX;
                const height = shape.endY - shape.startY;

                // 位置、サイズ、z-indexが変わっている場合は更新
                const currentLeft = parseInt(shape.vobjElement.style.left) || 0;
                const currentTop = parseInt(shape.vobjElement.style.top) || 0;
                const currentWidth = parseInt(shape.vobjElement.style.width) || 0;
                const currentHeight = parseInt(shape.vobjElement.style.height) || 0;
                const currentZIndex = parseInt(shape.vobjElement.style.zIndex) || 0;
                const newZIndex = shape.zIndex !== null && shape.zIndex !== undefined ? shape.zIndex : 0;

                if (currentLeft !== shape.startX || currentTop !== shape.startY ||
                    currentWidth !== width || currentHeight !== height || currentZIndex !== newZIndex) {
                    shape.vobjElement.style.left = shape.startX + 'px';
                    shape.vobjElement.style.top = shape.startY + 'px';
                    shape.vobjElement.style.width = width + 'px';
                    shape.vobjElement.style.height = height + 'px';
                    shape.vobjElement.style.zIndex = String(newZIndex);
                }
            } else {
                // DOM要素が存在しない場合のみ新規作成
                logger.debug('[FIGURE EDITOR] 新しい仮身DOM要素を作成:', shape.virtualObject.link_name, 'vobjElement:', !!shape.vobjElement, 'parentNode:', shape.vobjElement ? !!shape.vobjElement.parentNode : 'N/A');
                this.renderVirtualObjectElement(shape);
            }
        });
    }

    /**
     * 個別の仮身をDOM要素として描画
     */
    renderVirtualObjectElement(shape) {
        logger.debug('[FIGURE EDITOR] ★ renderVirtualObjectElement 開始:', shape.virtualObject?.link_name);

        if (!this.virtualObjectRenderer) {
            logger.warn('[FIGURE EDITOR] VirtualObjectRenderer not available');
            return;
        }

        const virtualObject = shape.virtualObject;
        const width = shape.endX - shape.startX;
        const height = shape.endY - shape.startY;

        // VirtualObjectRendererが判定できるように座標情報を設定
        const virtualObjectWithPos = {
            ...virtualObject,
            vobjtop: shape.startY,
            vobjbottom: shape.endY,
            vobjleft: shape.startX,
            vobjright: shape.endX,
            width: width
        };

        // 開いた仮身と閉じた仮身を判定
        const isOpenVirtualObj = this.virtualObjectRenderer.isOpenedVirtualObject(virtualObjectWithPos);

        logger.debug('[FIGURE EDITOR] 仮身判定:', virtualObject.link_name, '高さ:', height, '開いた仮身:', isOpenVirtualObj);

        // VirtualObjectRendererを使用してDOM要素を作成
        // アイコンは事前読み込み済みのiconDataを使用、フォールバックでloadIconCallbackを使用
        const vobjElement = this.virtualObjectRenderer.createBlockElement(virtualObjectWithPos, {
            iconData: this.iconData || {},
            loadIconCallback: (realId) => this.iconManager ? this.iconManager.loadIcon(realId) : Promise.resolve(null)
        });

        if (!vobjElement) {
            logger.warn('[FIGURE EDITOR] Failed to create virtual object element');
            return;
        }

        // クラスを追加
        vobjElement.classList.add('virtual-object-element');

        // 位置とサイズを設定
        vobjElement.style.position = 'absolute';
        vobjElement.style.left = shape.startX + 'px';
        vobjElement.style.top = shape.startY + 'px';
        vobjElement.style.width = width + 'px';
        vobjElement.style.height = height + 'px';
        vobjElement.style.cursor = 'move';
        // z-indexをshapeのzIndexプロパティから設定
        // Canvasのz-indexは0なので、負の値はCanvasより背面、正の値は前面になる
        const zIndex = shape.zIndex !== null && shape.zIndex !== undefined ? shape.zIndex : 1;
        vobjElement.style.zIndex = String(zIndex);

        // draggable属性をtrueに設定（クロスウィンドウドラッグ用）
        vobjElement.setAttribute('draggable', 'true');
        logger.debug('[FIGURE EDITOR] vobjElement初期化: draggable=true, link_name=' + virtualObject.link_name);

        // 仮身要素自体のテキスト選択を無効化（文字部分のドラッグ時の問題を防止）
        vobjElement.style.userSelect = 'none';
        vobjElement.style.webkitUserSelect = 'none';
        // pointer-eventsを明示的にautoに設定（dragend後のリセットを確実にする）
        vobjElement.style.pointerEvents = 'auto';

        // selectstartイベントを防止してテキスト選択ドラッグを完全に無効化
        vobjElement.addEventListener('selectstart', (e) => {
            e.preventDefault();
        });

        // CRITICAL: 仮身内部の全要素のドラッグを無効化（画像ドラッグとの競合を防ぐ）
        const allInnerElements = vobjElement.querySelectorAll('*');
        allInnerElements.forEach(el => {
            // 全ての内部要素のドラッグを無効化
            el.setAttribute('draggable', 'false');
            // pointer-eventsをnoneに設定して、内部要素が直接イベントを受け取らないようにする
            el.style.pointerEvents = 'none';
            // 全ての内部要素のテキスト選択を無効化（文字部分のドラッグ時の問題を防止）
            el.style.userSelect = 'none';
            el.style.webkitUserSelect = 'none';
            // 全ての内部要素のwebkitUserDragを無効化（テキスト/画像ドラッグ防止）
            el.style.webkitUserDrag = 'none';
        });
        logger.debug('[FIGURE EDITOR] 仮身内部要素のドラッグを無効化:', allInnerElements.length, '個の要素');

        // データ属性を設定（shape特定用）
        vobjElement.dataset.shapeId = this.shapes.indexOf(shape);
        vobjElement.dataset.linkId = virtualObject.link_id;

        // 既存のvobjElementがあれば削除（親ノードに接続されている場合）
        if (shape.vobjElement) {
            // イベントリスナーのクリーンアップ
            if (shape.vobjElement._cleanupMouseHandlers) {
                shape.vobjElement._cleanupMouseHandlers();
            }

            // mousedownハンドラーの削除
            if (shape.vobjElement._mousedownHandler) {
                shape.vobjElement.removeEventListener('mousedown', shape.vobjElement._mousedownHandler);
                shape.vobjElement._mousedownHandler = null;
            }

            // dragstartハンドラーの削除
            if (shape.vobjElement._dragstartHandler) {
                shape.vobjElement.removeEventListener('dragstart', shape.vobjElement._dragstartHandler);
                shape.vobjElement._dragstartHandler = null;
            }

            // dragendハンドラーの削除
            if (shape.vobjElement._dragendHandler) {
                shape.vobjElement.removeEventListener('dragend', shape.vobjElement._dragendHandler);
                shape.vobjElement._dragendHandler = null;
            }

            // contextmenuハンドラーの削除
            if (shape.vobjElement._contextmenuHandler) {
                shape.vobjElement.removeEventListener('contextmenu', shape.vobjElement._contextmenuHandler);
                shape.vobjElement._contextmenuHandler = null;
            }

            // この仮身がドラッグ中の場合、ドラッグ状態をクリア
            if (this.draggingVirtualObjectShape === shape) {
                this.draggingVirtualObjectShape = null;
                this.isDraggingVirtualObjectShape = false;
                this.draggingVirtualObjectOffsetX = 0;
                this.draggingVirtualObjectOffsetY = 0;

                // ドラッグタイムアウトをクリア
                if (this.virtualObjectDragTimeout) {
                    clearTimeout(this.virtualObjectDragTimeout);
                    this.virtualObjectDragTimeout = null;
                }
            }

            // DOM要素を削除
            if (shape.vobjElement.parentNode) {
                shape.vobjElement.parentNode.removeChild(shape.vobjElement);
            }
            // 参照をクリア
            shape.vobjElement = null;
        }

        // 既存の展開済みiframeは保持（展開状態を維持）
        // shape.expanded と shape.expandedElement はそのまま保持

        // shapeにDOM要素への参照を保存
        shape.vobjElement = vobjElement;

        // mousedownイベント（ドラッグの準備）
        // 重複登録を防ぐため、既存のハンドラーをクリーンアップ
        if (vobjElement._mousedownHandler) {
            vobjElement.removeEventListener('mousedown', vobjElement._mousedownHandler);
            vobjElement._mousedownHandler = null;
        }

        // 新しいハンドラーを定義
        const mousedownHandler = (e) => {
            logger.debug('[FIGURE EDITOR] vobjElement mousedown: button=' + e.button + ', draggable=' + vobjElement.getAttribute('draggable'));

            // ドラッグクールダウン中は処理をスキップ
            if (this.dragCooldown) {
                logger.debug('[FIGURE EDITOR] ドラッグクールダウン中のため処理をスキップ');
                return;
            }

            // ダブルクリック検出ロジック（読み取り専用モードでも実行）
            const now = Date.now();
            const timeSinceLastClick = now - this.dblClickDragState.lastClickTime;
            const isSameShape = this.dblClickDragState.lastClickedShape === shape;

            // 前回のクリックから300ms以内かつ同じ仮身の場合、ダブルクリック候補（左クリックのみ）
            if (timeSinceLastClick < 300 && isSameShape && e.button === 0) {
                logger.debug('[FIGURE EDITOR] ダブルクリック候補を検出:', virtualObject.link_name);
                this.setDoubleClickDragCandidate(vobjElement, e);  // 共通メソッド使用
                // プラグイン固有のプロパティ設定
                this.dblClickDragState.dblClickedShape = shape;

                // 一時的にdraggableをfalseにして、ブラウザの自動ドラッグを防ぐ
                // これにより、mouseupイベントが確実に発火する
                vobjElement.setAttribute('draggable', 'false');
                logger.debug('[FIGURE EDITOR] draggable=false に設定（ダブルクリック候補）');
            } else {
                // 通常のクリック：時刻と図形を記録（全てのボタンで記録）

                // 前回のダブルクリック候補要素のdraggableをtrueに戻す
                if (this.dblClickDragState.dblClickedElement) {
                    this.dblClickDragState.dblClickedElement.setAttribute('draggable', 'true');
                }

                this.resetDoubleClickTimer();  // 共通メソッド使用
                // プラグイン固有のプロパティ設定
                this.dblClickDragState.lastClickedShape = shape;
            }

            // 読み取り専用モードの場合は、ドラッグとリサイズを無効化（ダブルクリックは許可）
            if (this.readonly) {
                // ダブルクリック検出は上で実行済みなので、ここではreturnのみ
                return;
            }

            // イベントの伝播を止めて、canvas のイベントと競合しないようにする
            e.stopPropagation();
            // e.preventDefault() を削除（dblclickイベントを許可するため）

            // 仮身図形を選択（selectツールの場合のみ）
            if (this.currentTool === 'select') {
                const isAlreadySelected = this.selectedShapes.includes(shape);

                // 左クリックの場合のみ選択処理を実行
                if (e.button === 0) {
                    if (e.shiftKey) {
                        // Shiftキー: トグル選択
                        if (isAlreadySelected) {
                            // 選択解除
                            const index = this.selectedShapes.indexOf(shape);
                            this.selectedShapes.splice(index, 1);
                        } else {
                            // 追加選択
                            this.selectedShapes.push(shape);
                        }
                    } else {
                        // 通常クリック: 他の選択を解除してこの図形のみ選択
                        this.selectedShapes = [shape];
                    }
                    this.redraw();
                    logger.debug('[FIGURE EDITOR] 仮身を選択:', virtualObject.link_name, '選択数:', this.selectedShapes.length);
                } else if (e.button === 2) {
                    // 右クリックの場合、未選択の仮身のみ選択（複数選択を維持するため）
                    if (!isAlreadySelected) {
                        this.selectedShapes = [shape];
                        this.redraw();
                        logger.debug('[FIGURE EDITOR] 右クリックで未選択の仮身を選択:', virtualObject.link_name);
                    }
                }
            }

            // 左クリックのみドラッグ処理、右クリックと中クリックはここで終了（コンテキストメニュー用）
            if (e.button !== 0) {
                return;
            }

            // dragModeはinitializeVirtualObjectDragStart()で設定

            // リサイズエリアのチェック（リサイズエリア内ではドラッグしない）
            const rect = vobjElement.getBoundingClientRect();
            const isRightEdge = e.clientX > rect.right - 10 && e.clientX <= rect.right + 10;
            const isBottomEdge = e.clientY > rect.bottom - 10 && e.clientY <= rect.bottom + 10;
            if (isRightEdge || isBottomEdge) {
                // リサイズエリア内なので、ドラッグ処理はスキップ
                return;
            }

            // 仮身内の相対位置を記録（offsetX/Yは要素内の相対位置）
            const offsetX = e.clientX - rect.left;
            const offsetY = e.clientY - rect.top;

            // ドラッグの準備（マウス移動検出用）
            this.isDraggingVirtualObjectShape = false;
            this.draggingVirtualObjectShape = shape;
            this.draggingVirtualObjectElement = vobjElement;
            this.draggingVirtualObjectOffsetX = offsetX;
            this.draggingVirtualObjectOffsetY = offsetY;
            vobjElement._dragStartX = e.clientX;
            vobjElement._dragStartY = e.clientY;
            vobjElement._dragStarted = false;

            // マウス移動を監視してドラッグを開始
            const mousemoveHandler = (moveEvent) => {
                // ダブルクリック+ドラッグ中は通常のドラッグ処理をスキップ（グローバルハンドラーで処理）
                if (this.dblClickDragState.isDblClickDragCandidate || this.dblClickDragState.isDblClickDrag) {
                    return;
                }

                const dx = Math.abs(moveEvent.clientX - vobjElement._dragStartX);
                const dy = Math.abs(moveEvent.clientY - vobjElement._dragStartY);

                // 5px以上動いたらドラッグ開始マーク
                if (!vobjElement._dragStarted && (dx > 5 || dy > 5)) {
                    vobjElement._dragStarted = true;
                    // hasMovedはPluginBaseで管理
                }
            };

            // クリーンアップ関数（mouseup/dragstart/dragendから呼び出し）
            const cleanupHandlers = () => {
                logger.debug('[FIGURE EDITOR] クリーンアップ: ハンドラ削除、状態リセット');
                document.removeEventListener('mousemove', mousemoveHandler);
                document.removeEventListener('mouseup', mouseupHandler);
                if (vobjElement._handlerTimeout) {
                    clearTimeout(vobjElement._handlerTimeout);
                    vobjElement._handlerTimeout = null;
                }
                vobjElement._dragStarted = false;
                // hasMovedはPluginBaseで管理
                vobjElement._cleanupMouseHandlers = null; // 参照をクリア
            };

            const mouseupHandler = (upEvent) => {
                logger.debug('[FIGURE EDITOR] 要素レベルmouseup: button=' + upEvent.button + ', _dragStarted=' + vobjElement._dragStarted);

                // 左+右同時押しのコピーモード検出はdragstartで行うため、ここでは常にクリーンアップを実行
                logger.debug('[FIGURE EDITOR] 要素レベルmouseup: ハンドラ削除、状態リセット');
                cleanupHandlers();

                // ダブルクリック検出とドラッグ処理はdocument-levelのmouseupハンドラで処理される
            };

            // ハンドラを登録
            document.addEventListener('mousemove', mousemoveHandler);
            document.addEventListener('mouseup', mouseupHandler);

            // クリーンアップ関数を要素に保存（dragstart/dragendから呼び出せるように）
            vobjElement._cleanupMouseHandlers = cleanupHandlers;

            // フェイルセーフ: 5秒後に強制的にクリーンアップ（dragstartでmouseupが発火しない場合の対策）
            vobjElement._handlerTimeout = setTimeout(() => {
                logger.debug('[FIGURE EDITOR] タイムアウト: 強制的にハンドラをクリーンアップ');
                cleanupHandlers();
            }, 5000);

            logger.debug('[FIGURE EDITOR] mousedown/mousemove/mouseupイベントリスナーを登録:', virtualObject.link_name);
        };

        // 重複登録を防ぐため、既存のハンドラーをクリーンアップ
        if (vobjElement._mousedownHandler) {
            vobjElement.removeEventListener('mousedown', vobjElement._mousedownHandler);
            vobjElement._mousedownHandler = null;
        }

        // ハンドラーを登録して参照を保存
        vobjElement.addEventListener('mousedown', mousedownHandler);
        vobjElement._mousedownHandler = mousedownHandler;

        // dragstartイベント
        // 重複登録を防ぐため、既存のハンドラーをクリーンアップ
        if (vobjElement._dragstartHandler) {
            vobjElement.removeEventListener('dragstart', vobjElement._dragstartHandler);
            vobjElement._dragstartHandler = null;
        }

        // 新しいハンドラーを定義
        const dragstartHandler = (e) => {
            logger.debug('[FIGURE EDITOR] dragstart: buttons=' + e.buttons + ', isDblClickDragCandidate=' + this.dblClickDragState.isDblClickDragCandidate + ', isDblClickDrag=' + this.dblClickDragState.isDblClickDrag);

            // mousedownで登録したハンドラをクリーンアップ（dragstartが発火するとmouseupが発火しないため）
            if (vobjElement._cleanupMouseHandlers) {
                logger.debug('[FIGURE EDITOR] dragstart: mousedownハンドラをクリーンアップ');
                vobjElement._cleanupMouseHandlers();
            }

            // ダブルクリック+ドラッグ候補またはダブルクリック+ドラッグ中の場合は通常のドラッグを抑制
            if (this.dblClickDragState.isDblClickDragCandidate || this.dblClickDragState.isDblClickDrag) {
                logger.debug('[FIGURE EDITOR] ダブルクリック+ドラッグ検出、通常のドラッグを抑制');
                e.preventDefault();
                return;
            }

            // mousedownで準備ができているかチェック
            if (!this.draggingVirtualObjectShape || this.draggingVirtualObjectShape !== shape) {
                e.preventDefault();
                return;
            }

            // PluginBase共通メソッドでドラッグ状態を初期化
            this.initializeVirtualObjectDragStart(e);

            // 選択中の仮身を取得（複数選択ドラッグのサポート）
            const selectedVirtualObjectShapes = this.selectedShapes.filter(s => s.type === 'vobj');

            // ドラッグ中の仮身が選択されていない場合は、その仮身のみをドラッグ
            const shapesToDrag = selectedVirtualObjectShapes.includes(shape)
                ? selectedVirtualObjectShapes
                : [shape];

            logger.debug('[FIGURE EDITOR] ドラッグ開始: ', shapesToDrag.length, '個の仮身');

            // 各仮身のドラッグデータを準備
            const virtualObjects = shapesToDrag.map(s => {
                const vo = s.virtualObject;
                return {
                    link_id: vo.link_id,
                    link_name: vo.link_name,
                    width: vo.width || s.width,
                    heightPx: vo.heightPx || s.height,
                    chsz: vo.chsz || 14,
                    frcol: vo.frcol || '#000000',
                    chcol: vo.chcol || '#000000',
                    tbcol: vo.tbcol || '#ffffff',
                    bgcol: vo.bgcol || '#ffffff',
                    dlen: vo.dlen || 0,
                    applist: vo.applist || {},
                    offsetX: (s === shape) ? (this.draggingVirtualObjectOffsetX || 0) : 0,
                    offsetY: (s === shape) ? (this.draggingVirtualObjectOffsetY || 0) : 0
                };
            });

            // PluginBase共通メソッドでdragDataを設定
            // ダブルクリック+ドラッグ（実身複製）判定を追加
            const isDuplicateDrag = this.dblClickDragState.isDblClickDragCandidate || this.dblClickDragState.isDblClickDrag;
            this.setVirtualObjectDragData(e, virtualObjects, 'basic-figure-editor', isDuplicateDrag);

            // フラグを設定
            this.isDraggingVirtualObjectShape = true;
            this.draggingVirtualObjectShape = shape;
            // isDraggingはinitializeVirtualObjectDragStart()で設定済み

            // 半透明にする
            vobjElement.style.opacity = '0.5';
        };

        // ハンドラーを登録して参照を保存
        vobjElement.addEventListener('dragstart', dragstartHandler);
        vobjElement._dragstartHandler = dragstartHandler;

        // mouseupイベント（ドラッグキャンセル、draggableを無効化）
        // 重複登録を防ぐため、既存のハンドラーをクリーンアップ
        if (vobjElement._mouseupHandler) {
            vobjElement.removeEventListener('mouseup', vobjElement._mouseupHandler);
            vobjElement._mouseupHandler = null;
        }

        // 新しいハンドラーを定義
        const mouseupHandler = (_e) => {
            // タイムアウトをクリア（draggable有効化をキャンセル）
            if (vobjElement._draggableTimeout) {
                clearTimeout(vobjElement._draggableTimeout);
                vobjElement._draggableTimeout = null;
            }

            // draggableをtrueに戻す（ダブルクリック+ドラッグ後の状態復元）
            vobjElement.setAttribute('draggable', 'true');

            // ドラッグフラグをリセット（ただし、ドラッグ中の場合はクリアしない）
            // dragstartの後、mouseupが発火してもドラッグは続行されるため
            if (!this.isDraggingVirtualObjectShape) {
                this.draggingVirtualObjectShape = null;
            }
        };

        // ハンドラーを登録して参照を保存
        vobjElement.addEventListener('mouseup', mouseupHandler);
        vobjElement._mouseupHandler = mouseupHandler;

        // dragendイベント
        // 重複登録を防ぐため、既存のハンドラーをクリーンアップ
        if (vobjElement._dragendHandler) {
            vobjElement.removeEventListener('dragend', vobjElement._dragendHandler);
            vobjElement._dragendHandler = null;
        }

        // 新しいハンドラーを定義
        const dragendHandler = () => {
            // mousedownで登録したハンドラをクリーンアップ（バックアップとして）
            if (vobjElement._cleanupMouseHandlers) {
                logger.debug('[FIGURE EDITOR] dragend: mousedownハンドラをクリーンアップ（バックアップ）');
                vobjElement._cleanupMouseHandlers();
            }

            // 透明度を戻す
            vobjElement.style.opacity = '1.0';

            // pointer-eventsを一時的に無効化（dragend直後のクリック防止）
            vobjElement.style.pointerEvents = 'none';

            // 100ms後にpointer-eventsとdraggableを復元（次のドラッグを可能にする）
            setTimeout(() => {
                vobjElement.style.pointerEvents = 'auto';
                vobjElement.setAttribute('draggable', 'true');
                logger.debug('[FIGURE EDITOR] dragend後のpointer-eventsとdraggableを復元');
            }, 100);

            // ドラッグクールダウンを設定（連続ドラッグ防止）
            this.dragCooldown = true;
            if (this.dragCooldownTimeout) {
                clearTimeout(this.dragCooldownTimeout);
            }
            this.dragCooldownTimeout = setTimeout(() => {
                this.dragCooldown = false;
                logger.debug('[FIGURE EDITOR] ドラッグクールダウン解除');
            }, 200);

            // PluginBase共通メソッドでドラッグ状態をクリーンアップ
            this.cleanupVirtualObjectDragState();

            // ダブルクリックドラッグ状態もクリーンアップ（意図しない複製を防止）
            this.cleanupDblClickDragState();
            this.dblClickDragState.lastClickedShape = null;

            // タイムアウトを設定（2秒以内にcross-window-drop-successが来なければリセット）
            if (this.virtualObjectDragTimeout) {
                clearTimeout(this.virtualObjectDragTimeout);
            }

            this.virtualObjectDragTimeout = setTimeout(() => {
                this.isDraggingVirtualObjectShape = false;
                this.draggingVirtualObjectShape = null;
                this.virtualObjectDragTimeout = null;
            }, 2000);
        };

        // ハンドラーを登録して参照を保存
        vobjElement.addEventListener('dragend', dragendHandler);
        vobjElement._dragendHandler = dragendHandler;

        // 右クリックで仮身を選択してコンテキストメニューを表示
        // 重複登録を防ぐため、既存のハンドラーをクリーンアップ
        if (vobjElement._contextmenuHandler) {
            vobjElement.removeEventListener('contextmenu', vobjElement._contextmenuHandler);
            vobjElement._contextmenuHandler = null;
        }

        // 新しいハンドラーを定義
        const contextmenuHandler = (e) => {
            e.preventDefault();
            e.stopPropagation();

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

            // 仮身図形を選択（まだ選択されていない場合）
            if (this.currentTool === 'select') {
                if (!this.selectedShapes.includes(shape)) {
                    this.selectedShapes = [shape];
                    this.redraw();
                    logger.debug('[FIGURE EDITOR] 右クリックで仮身を選択:', virtualObject.link_name);
                }

                // 実身IDを抽出（共通メソッドを使用）
                const realId = window.RealObjectSystem.extractRealId(virtualObject.link_id);

                // 右クリックされた仮身の情報を保存（メニュー生成時に使用）
                this.contextMenuVirtualObject = {
                    element: vobjElement,
                    realId: realId,
                    virtualObj: virtualObject
                };
                logger.debug('[FIGURE EDITOR] contextMenuVirtualObject設定完了:', this.contextMenuVirtualObject);

                // 親ウィンドウにコンテキストメニュー要求を送信（共通メソッドを使用）
                this.showContextMenuAtEvent(e);
            }
        };

        // 重複登録を防ぐため、既存のハンドラーをクリーンアップ
        if (vobjElement._contextmenuHandler) {
            vobjElement.removeEventListener('contextmenu', vobjElement._contextmenuHandler);
            vobjElement._contextmenuHandler = null;
        }

        // ハンドラーを登録して参照を保存
        vobjElement.addEventListener('contextmenu', contextmenuHandler);
        vobjElement._contextmenuHandler = contextmenuHandler;

        // リサイズ機能を追加
        this.makeVirtualObjectResizable(vobjElement, shape);

        // エディタコンテナに追加
        const container = document.querySelector('.editor-container');
        if (container) {
            container.appendChild(vobjElement);
        } else {
            document.body.appendChild(vobjElement);
        }
        logger.debug('[FIGURE EDITOR] ★ renderVirtualObjectElement 完了、DOMに追加:', virtualObject.link_name);

        // 開いた仮身の場合、展開処理を実行（まだ展開されていない場合のみ）
        // 展開試行済み（expanded）またはエラー発生済み（expandError）の場合はスキップ
        if (isOpenVirtualObj && !shape.expanded && !shape.expandError) {
            logger.debug('[FIGURE EDITOR] 開いた仮身を展開:', virtualObject.link_name);
            // 無限ループを防ぐため、先にフラグを設定
            shape.expanded = true;
            // DOMに追加された後に非同期で展開
            setTimeout(() => {
                this.expandVirtualObject(vobjElement, shape, {
                    readonly: true,
                    noScrollbar: true,
                    bgcol: virtualObject.bgcol
                }).catch(err => {
                    logger.error('[FIGURE EDITOR] 仮身展開エラー:', err);
                    // エラー時はエラーフラグを設定（無限ループ防止のためフラグはリセットしない）
                    shape.expandError = true;
                });
            }, 0);
        }
    }

    /**
     * 仮身要素をリサイズ可能にする
     * @param {HTMLElement} vobjElement - 仮身のDOM要素
     * @param {Object} shape - 仮身のshapeオブジェクト
     */
    makeVirtualObjectResizable(vobjElement, shape) {
        const obj = shape.virtualObject;

        // 重複登録を防ぐため、既存のリサイズハンドラーをクリーンアップ
        if (vobjElement._resizeMousemoveHandler) {
            vobjElement.removeEventListener('mousemove', vobjElement._resizeMousemoveHandler);
            vobjElement._resizeMousemoveHandler = null;
        }
        if (vobjElement._resizeMouseleaveHandler) {
            vobjElement.removeEventListener('mouseleave', vobjElement._resizeMouseleaveHandler);
            vobjElement._resizeMouseleaveHandler = null;
        }
        if (vobjElement._resizeMousedownHandler) {
            vobjElement.removeEventListener('mousedown', vobjElement._resizeMousedownHandler);
            vobjElement._resizeMousedownHandler = null;
        }

        // マウス移動でカーソルを変更（リサイズエリアの表示）
        const mousemoveHandler = (e) => {
            // リサイズ中は何もしない
            if (this.isResizingVirtualObject) {
                return;
            }

            const rect = vobjElement.getBoundingClientRect();
            // リサイズエリア：枠の内側10pxから外側10pxまで
            const isRightEdge = e.clientX > rect.right - 10 && e.clientX <= rect.right + 10;
            const isBottomEdge = e.clientY > rect.bottom - 10 && e.clientY <= rect.bottom + 10;

            // カーソルの形状を変更
            if (isRightEdge && isBottomEdge) {
                vobjElement.style.cursor = 'nwse-resize'; // 右下: 斜めリサイズ
            } else if (isRightEdge) {
                vobjElement.style.cursor = 'ew-resize'; // 右: 横リサイズ
            } else if (isBottomEdge) {
                vobjElement.style.cursor = 'ns-resize'; // 下: 縦リサイズ
            } else {
                vobjElement.style.cursor = 'move'; // 通常: 移動カーソル
            }
        };

        // マウスが仮身から離れたらカーソルを元に戻す
        const mouseleaveHandler = () => {
            if (!this.isResizingVirtualObject) {
                vobjElement.style.cursor = 'move';
            }
        };

        // マウスダウンでリサイズ開始
        const mousedownHandler = (e) => {
            // 読み取り専用モードの場合はリサイズを無効化
            if (this.readonly) {
                return;
            }

            const rect = vobjElement.getBoundingClientRect();
            // リサイズエリア：枠の内側10pxから外側10pxまで
            const isRightEdge = e.clientX > rect.right - 10 && e.clientX <= rect.right + 10;
            const isBottomEdge = e.clientY > rect.bottom - 10 && e.clientY <= rect.bottom + 10;

            // リサイズエリア（枠の内側10pxから外側10pxまで）のクリックのみ処理
            if (!isRightEdge && !isBottomEdge) {
                return;
            }

            // 左クリックのみ処理
            if (e.button !== 0) {
                return;
            }

            // リサイズ中は新しいリサイズを開始しない
            if (this.isResizingVirtualObject) {
                logger.debug('[FIGURE EDITOR] リサイズ中のため、新しいリサイズを無視');
                return;
            }

            e.preventDefault();
            e.stopPropagation();

            // draggableタイムアウトをクリア（ドラッグとリサイズの競合を防ぐ）
            if (vobjElement._draggableTimeout) {
                clearTimeout(vobjElement._draggableTimeout);
                vobjElement._draggableTimeout = null;
            }

            // draggableを無効化
            vobjElement.setAttribute('draggable', 'false');

            // リサイズ開始フラグを設定
            this.isResizingVirtualObject = true;

            // リサイズモード開始
            const startX = e.clientX;
            const startY = e.clientY;
            const startWidth = rect.width;
            const startHeight = rect.height;
            const minWidth = 50;

            // chszベースの最小高さを計算
            const chsz = Math.round(obj.chsz || 14); // 浮動小数点誤差を防ぐ
            const lineHeight = 1.2;
            const chszPx = window.convertPtToPx(chsz);
            const textHeight = Math.ceil(chszPx * lineHeight);
            const minClosedHeight = textHeight + 8; // 閉じた仮身の最小高さ = タイトルエリアの高さ
            const minOpenHeight = textHeight + 30; // 開いた仮身の最小高さ（閾値）= タイトルバー(textHeight+8) + 区切り線(2) + コンテンツ最小(20)

            // DOMから実際のコンテンツエリアの有無で開閉状態を判定
            const hasContentArea = vobjElement.querySelector('.virtual-object-content-area') !== null ||
                                  vobjElement.querySelector('.virtual-object-content-iframe') !== null;

            // リサイズ中は閉じた仮身の最小高さまで小さくできるようにする
            const minHeight = minClosedHeight;

            // 初期高さを閾値に基づいて設定
            let currentWidth = startWidth;
            let currentHeight;
            if (startHeight < minOpenHeight) {
                // 閾値未満の場合は、閉じた仮身の高さ
                currentHeight = minClosedHeight;
            } else {
                // 閾値以上の場合は、現在の高さ
                currentHeight = startHeight;
            }

            logger.debug('[FIGURE EDITOR] 仮身リサイズ開始:', obj.link_name, 'startWidth:', startWidth, 'startHeight:', startHeight, 'currentHeight:', currentHeight, 'hasContentArea:', hasContentArea, 'chsz:', chsz, 'minClosedHeight:', minClosedHeight, 'minOpenHeight:', minOpenHeight);

            // リサイズプレビュー枠を作成
            const previewBox = document.createElement('div');
            previewBox.style.position = 'fixed'; // キャンバス外でも表示されるようにfixedを使用
            previewBox.style.left = `${rect.left}px`;
            previewBox.style.top = `${rect.top}px`;
            previewBox.style.width = `${currentWidth}px`;
            previewBox.style.height = `${currentHeight}px`;
            previewBox.style.border = '2px dashed rgba(0, 123, 255, 0.8)';
            previewBox.style.backgroundColor = 'rgba(0, 123, 255, 0.1)';
            previewBox.style.pointerEvents = 'none';
            previewBox.style.zIndex = '999999'; // さらに高いz-indexを使用
            previewBox.style.boxSizing = 'border-box';

            // document.bodyに直接追加（iframe上でも表示される）
            document.body.appendChild(previewBox);

            // 開いた仮身内のiframeのpointer-eventsを無効化（リサイズ中にマウスイベントを親に伝播させる）
            const iframe = vobjElement.querySelector('iframe');
            if (iframe) {
                iframe.style.pointerEvents = 'none';
            }

            const onMouseMove = (moveEvent) => {
                if (isRightEdge) {
                    const deltaX = moveEvent.clientX - startX;
                    currentWidth = Math.max(minWidth, startWidth + deltaX);
                    previewBox.style.width = `${currentWidth}px`;
                }

                if (isBottomEdge) {
                    const deltaY = moveEvent.clientY - startY;
                    let newHeight = Math.max(minHeight, startHeight + deltaY);

                    // 閾値に基づいて高さをスナップ
                    if (newHeight < minOpenHeight) {
                        // 閾値未満の場合は、閉じた仮身の高さに固定
                        currentHeight = minClosedHeight;
                    } else {
                        // 閾値以上の場合は、開いた仮身の高さとして自由に変更可能
                        currentHeight = newHeight;
                    }

                    previewBox.style.height = `${currentHeight}px`;
                }
            };

            const onMouseUp = () => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);

                // プレビュー枠を削除
                if (previewBox && previewBox.parentNode) {
                    previewBox.parentNode.removeChild(previewBox);
                }

                // iframeのpointer-eventsを元に戻す
                if (iframe) {
                    iframe.style.pointerEvents = 'auto';
                }

                // カーソルを元に戻す
                vobjElement.style.cursor = 'move';

                // 最終的なサイズを取得（プレビュー枠のサイズを使用）
                const finalWidth = Math.round(currentWidth);
                const finalHeight = Math.round(currentHeight);

                // shapeのサイズを更新
                shape.endX = shape.startX + finalWidth;
                shape.endY = shape.startY + finalHeight;

                // 仮身オブジェクトのサイズを更新
                obj.width = finalWidth;
                obj.heightPx = finalHeight;

                logger.debug('[FIGURE EDITOR] 仮身リサイズ終了:', obj.link_name, 'newWidth:', finalWidth, 'newHeight:', finalHeight);

                // 開いた仮身と閉じた仮身の判定が変わったかチェック
                const chsz_resize = Math.round(obj.chsz || 14);
                const lineHeight_resize = 1.2;
                const chszPx_resize = window.convertPtToPx(chsz_resize);
                const textHeight_resize = Math.ceil(chszPx_resize * lineHeight_resize);
                const minOpenHeight_resize = textHeight_resize + 30;
                const wasOpen = hasContentArea; // DOMベースの判定を使用
                const isNowOpen = finalHeight >= minOpenHeight_resize;

                if (wasOpen !== isNowOpen) {
                    // 判定が変わった場合は、少し待ってから仮身要素を再作成
                    logger.debug('[FIGURE EDITOR] 開いた仮身/閉じた仮身の判定が変わりました。少し待ってから再作成します。');

                    // 既存のタイマーをクリア（連続したリサイズで最後の一回だけ実行）
                    if (this.recreateVirtualObjectTimer) {
                        clearTimeout(this.recreateVirtualObjectTimer);
                    }

                    // 展開状態をリセット（エラーフラグも含む）
                    shape.expanded = false;
                    shape.expandedElement = null;
                    shape.expandError = false;

                    // 再作成フラグを設定（renderVirtualObjectsAsElementsによる中断を防ぐ）
                    this.isRecreatingVirtualObject = true;

                    // 遅延して再作成（150ms後）
                    this.recreateVirtualObjectTimer = setTimeout(() => {
                        logger.debug('[FIGURE EDITOR] 仮身を再作成します。');

                        // 要素がまだDOMに存在するかチェック
                        if (!vobjElement.parentNode) {
                            logger.warn('[FIGURE EDITOR] 再作成対象の仮身要素がDOMから削除されています');
                            this.recreateVirtualObjectTimer = null;
                            this.isRecreatingVirtualObject = false;
                            return;
                        }

                        // 仮身要素を再描画
                        this.renderVirtualObjectElement(shape);

                        this.recreateVirtualObjectTimer = null;
                        this.isRecreatingVirtualObject = false;
                    }, 150);
                } else {
                    // 判定が変わらない場合は、DOM要素のサイズだけ更新
                    vobjElement.style.width = `${finalWidth}px`;
                    vobjElement.style.height = `${finalHeight}px`;
                }

                // draggableを再び有効化（リサイズ開始時に無効化したため）
                vobjElement.setAttribute('draggable', 'true');

                // リサイズ終了フラグをリセット
                this.isResizingVirtualObject = false;
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        };

        // ハンドラを登録して参照を保存
        vobjElement.addEventListener('mousemove', mousemoveHandler);
        vobjElement._resizeMousemoveHandler = mousemoveHandler;

        vobjElement.addEventListener('mouseleave', mouseleaveHandler);
        vobjElement._resizeMouseleaveHandler = mouseleaveHandler;

        vobjElement.addEventListener('mousedown', mousedownHandler);
        vobjElement._resizeMousedownHandler = mousedownHandler;
    }

    /**
     * 仮身を開く（defaultOpenプラグインで開く）
     */
    openVirtualObject(shape) {
        const virtualObject = shape.virtualObject;
        logger.debug('[FIGURE EDITOR] Opening virtual object:', virtualObject.link_name);

        // 親ウィンドウにメッセージを送信して開く
        // link_idとlink_nameを個別に送る（仮身一覧形式）
        if (this.messageBus) {
            this.messageBus.send('open-virtual-object', {
                linkId: virtualObject.link_id,
                linkName: virtualObject.link_name
            });
        }
    }

    /**
     * ダブルクリック+ドラッグによる実身複製処理
     * @param {Object} shape - 元の仮身図形
     * @param {number} targetX - ドロップ先のX座標
     * @param {number} targetY - ドロップ先のY座標
     */
    async handleDoubleClickDragDuplicate(shape, targetX, targetY) {
        const virtualObject = shape.virtualObject;
        if (!virtualObject || !virtualObject.link_id) {
            logger.error('[FIGURE EDITOR] 複製対象の仮身が不正です');
            return;
        }

        const realId = virtualObject.link_id;
        logger.debug('[FIGURE EDITOR] ダブルクリック+ドラッグによる実身複製:', realId, 'ドロップ位置:', targetX, targetY);

        // 元の仮身のサイズと属性を保存
        const width = virtualObject.width || (shape.endX - shape.startX) || 100;
        const height = virtualObject.heightPx || (shape.endY - shape.startY) || 32;
        const chsz = virtualObject.chsz || 14;
        const frcol = virtualObject.frcol || '#000000';
        const chcol = virtualObject.chcol || '#000000';
        const tbcol = virtualObject.tbcol || '#ffffff';
        const bgcol = virtualObject.bgcol || '#ffffff';
        const dlen = virtualObject.dlen || 0;
        const applist = virtualObject.applist || {};

        // 先にダイアログで名前を入力してもらう
        const defaultName = (virtualObject.link_name || '実身') + 'のコピー';
        const newName = await this.showInputDialog(
            '新しい実身の名称を入力してください',
            defaultName,
            30
        );

        // キャンセルされた場合は何もしない（showInputDialogはキャンセル時にnullを返す）
        if (!newName) {
            logger.debug('[FIGURE EDITOR] 実身複製がキャンセルされました');
            return;
        }

        // メッセージIDを生成
        const messageId = this.generateMessageId('duplicate');

        // MessageBus経由で実身複製を要求（名前を含める）
        this.messageBus.send('duplicate-real-object', {
            realId: realId,
            messageId: messageId,
            newName: newName
        });

        try {
            // レスポンスを待つ（タイムアウト5秒）
            const result = await this.messageBus.waitFor('real-object-duplicated', window.DEFAULT_TIMEOUT_MS, (data) => {
                return data.messageId === messageId;
            });

            if (result.cancelled) {
                logger.debug('[FIGURE EDITOR] 実身複製がキャンセルされました');
            } else if (result.success) {
                // 複製成功: 新しい実身IDで仮身を作成
                const newRealId = result.newRealId;
                const newName = result.newName;
                logger.debug('[FIGURE EDITOR] 実身複製成功:', realId, '->', newRealId, '名前:', newName);

                // 新しい仮身図形を作成（ドロップ位置に配置）
                const newShape = {
                    type: 'vobj',
                    startX: targetX,
                    startY: targetY,
                    endX: targetX + width,
                    endY: targetY + height,
                    virtualObject: {
                        link_id: newRealId,
                        link_name: newName,
                        width: width,
                        heightPx: height,
                        chsz: chsz,
                        frcol: frcol,
                        chcol: chcol,
                        tbcol: tbcol,
                        bgcol: bgcol,
                        dlen: dlen,
                        applist: applist
                    },
                    zIndex: this.getNextZIndex()
                };

                // 図形リストに追加
                this.shapes.push(newShape);

                // 新しい仮身を選択状態にする
                this.selectedShapes = [newShape];

                // 再描画
                this.redraw();

                // 変更フラグを立てる
                this.isModified = true;
                this.hasUnsavedChanges = true;
            } else {
                logger.error('[FIGURE EDITOR] 実身複製失敗:', result.error);
            }
        } catch (error) {
            logger.error('[FIGURE EDITOR] 実身複製エラー:', error);
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

    /**
     * 元の仮身オブジェクトを削除するフック（PluginBase共通機能）
     * cross-window-drop-successでmoveモード時に呼ばれる
     */
    onDeleteSourceVirtualObject(data) {
        // このメソッドはドラッグ元で呼ばれるので、sourceWindowId === this.windowIdは常にtrue
        // クロスウィンドウドロップの場合のみ削除処理を行う（targetWindowIdが存在し、自分と異なる場合）
        if (data.targetWindowId && data.targetWindowId === this.windowId) {
            // ターゲットウィンドウで呼ばれた場合はスキップ（通常はありえない）
            logger.debug('[FIGURE EDITOR] ターゲットウィンドウでの呼び出し: 処理をスキップ');
            return;
        }

        if (!this.isDraggingVirtualObjectShape || !this.draggingVirtualObjectShape) {
            logger.debug('[FIGURE EDITOR] ドラッグ中の仮身がない: 処理をスキップ');
            return;
        }

        const shape = this.draggingVirtualObjectShape;
        logger.debug(`[FIGURE EDITOR] 移動モード: 仮身を削除:`, shape.virtualObject.link_name);

        // タイムアウトをキャンセル
        if (this.virtualObjectDragTimeout) {
            clearTimeout(this.virtualObjectDragTimeout);
            this.virtualObjectDragTimeout = null;
        }

        // 選択中の仮身を取得
        const selectedVirtualObjectShapes = this.selectedShapes.filter(s => s.type === 'vobj');
        const shapesToDelete = selectedVirtualObjectShapes.includes(shape)
            ? selectedVirtualObjectShapes
            : [shape];

        logger.debug('[FIGURE EDITOR] 移動モード: ', shapesToDelete.length, '個の仮身を削除');

        // 共通メソッドで仮身を削除
        this.deleteVirtualObjectShapes(shapesToDelete);
    }

    /**
     * cross-window-drop-success処理完了後のフック（PluginBase共通機能）
     * ドラッグ状態のクリーンアップ後に呼ばれる
     */
    onCrossWindowDropSuccess(data) {
        // フラグをリセット
        this.isDraggingVirtualObjectShape = false;
        this.draggingVirtualObjectShape = null;

        // ドラッグモードはcleanupVirtualObjectDragState()で既にリセット済み
    }

    // requestCopyVirtualObject() と requestDeleteVirtualObject() は
    // PluginBase共通メソッドに移行済み

}


// DOMContentLoadedで初期化
document.addEventListener('DOMContentLoaded', () => {
    window.editor = new BasicFigureEditor();
});
