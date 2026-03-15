/**
 * 基本図形編集プラグイン
 *  道具パネル（別ウィンドウ）
 * @module plugins/basic-figure-editor/tool-panel
 * @license MIT
 * @author satromi
 * @version 1.0.0
 */
const logger = window.getLogger('ToolPanel');

class ToolPanel {
    constructor() {
        this.editorWindow = null; // 親エディタウィンドウへの参照

        // 現在の設定値
        this.fillColor = DEFAULT_BGCOL;
        this.fillEnabled = true;
        this.fillPatternId = 0; // 0=ソリッド, 2-127=パターンID
        this.strokeColor = DEFAULT_FRCOL;
        this.lineWidth = 2;
        this.lineType = 0; // 0:実線, 1:破線, 2:点線, 3:一点鎖線, 4:二点鎖線, 5:長破線
        this.lineConnectionType = 'straight'; // 'straight', 'elbow', 'curve'
        this.cornerRadius = 0;
        this.arrowPosition = 'none'; // 'none', 'start', 'end', 'both'
        this.arrowType = 'simple'; // 'simple', 'double', 'filled'

        // 格子点設定
        this.gridMode = 'none'; // 'none', 'show', 'snap'
        this.gridInterval = 16; // px

        // ズーム倍率
        this.zoomLevel = 1.0;

        // ピクセルマップモード
        this.isPixelmapMode = false;
        this.pixelmapTool = 'pencil';
        this.pixelmapBrushSize = 1;

        // カスタムパターン（editor.jsのcustomPatternsのローカルコピー）
        this.localCustomPatterns = {};

        this.init();
    }

    init() {
        // 親ウィンドウからのメッセージを受信
        window.addEventListener('message', (event) => {
            logger.debug('[TOOL PANEL] メッセージ受信:', event.data);

            if (event.data && event.data.type === 'init-tool-panel') {
                // 初期設定を受信
                if (event.data.settings) {
                    this.fillColor = event.data.settings.fillColor || DEFAULT_BGCOL;
                    this.fillEnabled = event.data.settings.fillEnabled !== false;
                    this.fillPatternId = event.data.settings.fillPatternId || 0;
                    this.strokeColor = event.data.settings.strokeColor || DEFAULT_FRCOL;
                    this.lineWidth = event.data.settings.lineWidth || 2;
                    // lineType対応（後方互換: linePatternがあればlineTypeに変換）
                    if (event.data.settings.lineType !== undefined) {
                        this.lineType = event.data.settings.lineType;
                    } else if (event.data.settings.linePattern) {
                        const patternMapping = { 'solid': 0, 'dashed': 1, 'dotted': 2 };
                        this.lineType = patternMapping[event.data.settings.linePattern] || 0;
                    } else {
                        this.lineType = 0;
                    }
                    this.lineConnectionType = event.data.settings.lineConnectionType || 'straight';
                    this.cornerRadius = event.data.settings.cornerRadius || 0;
                    // カスタムパターンを受信
                    if (event.data.settings.customPatterns) {
                        this.localCustomPatterns = event.data.settings.customPatterns;
                    }
                }
                if (event.data.settings.zoomLevel !== undefined) {
                    this.zoomLevel = event.data.settings.zoomLevel;
                    this.updateZoomButtonLabel();
                }
                this.updatePaletteIcons();
            } else if (event.data && event.data.type === 'popup-zoom-level-change') {
                // ズーム倍率変更
                this.zoomLevel = event.data.zoomLevel;
                this.updateZoomButtonLabel();
                this.sendToEditor({
                    type: 'update-zoom-level',
                    zoomLevel: this.zoomLevel
                });
            } else if (event.data && event.data.type === 'tool-selected') {
                // ツール選択状態を更新
                this.updateToolSelection(event.data.tool);
            } else if (event.data && event.data.type === 'popup-grid-interval-click') {
                // 格子点間隔ボタンがクリックされた
                this.gridInterval = event.data.interval;
                logger.debug('[TOOL PANEL] 格子点間隔を更新:', this.gridInterval);
                this.sendToEditor({
                    type: 'update-grid-interval',
                    gridInterval: this.gridInterval
                });
            } else if (event.data && event.data.type === 'popup-grid-mode-change') {
                // 格子点モードが変更された
                this.gridMode = event.data.gridMode;
                logger.debug('[TOOL PANEL] 格子点モードを更新:', this.gridMode);
                this.sendToEditor({
                    type: 'update-grid-mode',
                    gridMode: this.gridMode
                });
            } else if (event.data && event.data.type === 'popup-grid-interval-custom') {
                // 格子点間隔カスタム入力が変更された
                this.gridInterval = event.data.interval;
                logger.debug('[TOOL PANEL] 格子点間隔（カスタム）を更新:', this.gridInterval);
                this.sendToEditor({
                    type: 'update-grid-interval',
                    gridInterval: this.gridInterval
                });
            } else if (event.data && event.data.type === 'current-font-settings') {
                // エディタから現在のフォント設定を受信
                logger.debug('[TOOL PANEL] 現在のフォント設定:', event.data.settings);
                if (this.fontSettingsButtonElement) {
                    this.showFontPopupInParent(this.fontSettingsButtonElement, event.data.settings);
                    this.fontSettingsButtonElement = null;
                }
            } else if (event.data && event.data.type === 'enter-pixelmap-mode') {
                // ピクセルマップモードに入る
                this.isPixelmapMode = true;
                this.updateCanvasToolIcon();
                logger.debug('[TOOL PANEL] ピクセルマップモードに入りました');
            } else if (event.data && event.data.type === 'exit-pixelmap-mode') {
                // ピクセルマップモードを抜ける
                this.isPixelmapMode = false;
                this.updateCanvasToolIcon();
                logger.debug('[TOOL PANEL] ピクセルマップモードを抜けました');
            } else if (event.data && event.data.type === 'popup-fill-color-change') {
                // 塗りつぶし色変更
                this.fillColor = event.data.fillColor;
                this.updatePaletteIcons();
                this.sendToEditor({
                    type: 'update-fill-color',
                    fillColor: this.fillColor
                });
            } else if (event.data && event.data.type === 'popup-fill-enabled-change') {
                // 塗りつぶし有効/無効
                this.fillEnabled = event.data.fillEnabled;
                this.sendToEditor({
                    type: 'update-fill-enabled',
                    fillEnabled: this.fillEnabled
                });
            } else if (event.data && event.data.type === 'popup-fill-pattern-change') {
                // パターン選択
                this.fillPatternId = event.data.patternId;
                this.updatePaletteIcons();
                this.sendToEditor({
                    type: 'update-fill-pattern',
                    patternId: this.fillPatternId
                });
            } else if (event.data && event.data.type === 'open-pattern-editor-request') {
                // パターン編集パネルを開く要求
                this.sendToEditor({
                    type: 'open-pattern-editor',
                    currentPatternId: this.fillPatternId
                });
            } else if (event.data && event.data.type === 'popup-stroke-color-change') {
                // 線色変更
                logger.debug('[TOOL PANEL] 線色変更:', event.data.strokeColor);
                this.strokeColor = event.data.strokeColor;
                this.updatePaletteIcons();
                logger.debug('[TOOL PANEL] update-stroke-colorをエディタに送信:', this.strokeColor);
                this.sendToEditor({
                    type: 'update-stroke-color',
                    strokeColor: this.strokeColor
                });
            } else if (event.data && event.data.type === 'popup-line-width-change') {
                // 線の太さ変更
                this.lineWidth = event.data.lineWidth;
                this.sendToEditor({
                    type: 'update-line-width',
                    lineWidth: this.lineWidth
                });
            } else if (event.data && event.data.type === 'popup-line-type-change') {
                // 線種変更（lineType 0-5）
                this.lineType = event.data.lineType;
                this.sendToEditor({
                    type: 'update-line-type',
                    lineType: this.lineType
                });
            } else if (event.data && event.data.type === 'popup-line-connection-type-change') {
                // 接続形状変更
                this.lineConnectionType = event.data.lineConnectionType;
                this.sendToEditor({
                    type: 'update-line-connection-type',
                    lineConnectionType: this.lineConnectionType
                });
            } else if (event.data && event.data.type === 'popup-corner-radius-change') {
                // 角丸半径変更
                this.cornerRadius = event.data.cornerRadius;
                this.sendToEditor({
                    type: 'update-corner-radius',
                    cornerRadius: this.cornerRadius
                });
            } else if (event.data && event.data.type === 'popup-arrow-position-change') {
                // 矢印位置変更
                this.arrowPosition = event.data.arrowPosition;
                this.sendToEditor({
                    type: 'update-arrow-position',
                    arrowPosition: this.arrowPosition
                });
            } else if (event.data && event.data.type === 'popup-arrow-type-change') {
                // 矢印種類変更
                this.arrowType = event.data.arrowType;
                this.sendToEditor({
                    type: 'update-arrow-type',
                    arrowType: this.arrowType
                });
            } else if (event.data && event.data.type === 'popup-material-tool-click') {
                // 画材ツール選択
                this.pixelmapTool = event.data.materialTool;
                this.sendToEditor({
                    type: 'update-pixelmap-tool',
                    pixelmapTool: this.pixelmapTool
                });
            } else if (event.data && event.data.type === 'popup-brush-size-change') {
                // ブラシサイズ変更
                this.pixelmapBrushSize = event.data.brushSize;
                this.sendToEditor({
                    type: 'update-pixelmap-brush-size',
                    pixelmapBrushSize: this.pixelmapBrushSize
                });
            } else if (event.data && event.data.type === 'patterns-updated') {
                // カスタムパターンの更新通知（pixelColors含む）
                if (event.data.patternId !== undefined && event.data.patternData) {
                    this.localCustomPatterns[event.data.patternId] = {
                        id: event.data.patternId,
                        type: 'pattern',
                        data: event.data.patternData,
                        pixelColors: event.data.pixelColors || null
                    };
                }
                // fillPatternIdが含まれていれば更新（入替時に塗りパターンを切り替え）
                if (event.data.fillPatternId !== undefined) {
                    this.fillPatternId = event.data.fillPatternId;
                }
                this.updatePaletteIcons();
            } else if (event.data && event.data.type === 'sync-shape-attributes') {
                // 選択図形の属性を同期
                const attrs = event.data.attributes;
                if (attrs) {
                    this.fillColor = attrs.fillColor || DEFAULT_BGCOL;
                    this.fillEnabled = attrs.fillEnabled !== false;
                    this.fillPatternId = attrs.fillPatternId || 0;
                    this.strokeColor = attrs.strokeColor || DEFAULT_FRCOL;
                    this.lineWidth = attrs.lineWidth || 2;
                    this.lineType = attrs.lineType !== undefined ? attrs.lineType : 0;
                    this.lineConnectionType = attrs.lineConnectionType || 'straight';
                    this.cornerRadius = attrs.cornerRadius || 0;
                    this.arrowPosition = attrs.arrowPosition || 'none';
                    this.arrowType = attrs.arrowType || 'simple';
                }
                this.updatePaletteIcons();
            }
        });

        this.setupEventListeners();

        // 親ウィンドウに準備完了を通知
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: 'tool-panel-ready'
            }, '*');
        }

        logger.info('[道具パネル] 準備完了');
    }

    setupEventListeners() {
        // 図形描画ツールボタンのクリックイベント
        const toolButtons = document.querySelectorAll('.tool-btn[data-tool]');
        toolButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const tool = btn.dataset.tool;
                this.selectTool(tool);

                // アクティブ状態を更新
                toolButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });

        // パレットボタンのクリックイベント
        document.getElementById('fillPalette').addEventListener('click', (e) => {
            this.showPalettePopup('fill', e.currentTarget);
        });

        document.getElementById('strokePalette').addEventListener('click', (e) => {
            this.showPalettePopup('stroke', e.currentTarget);
        });

        document.getElementById('lineStylePalette').addEventListener('click', (e) => {
            this.showPalettePopup('lineStyle', e.currentTarget);
        });

        document.getElementById('cornerPalette').addEventListener('click', (e) => {
            this.showPalettePopup('corner', e.currentTarget);
        });

        // キャンバスツール（ピクセルマップモード時は画材パレットを表示）
        document.getElementById('canvasTool').addEventListener('click', (e) => {
            if (this.isPixelmapMode) {
                // ピクセルマップモード時は画材パレットを表示
                this.showPalettePopup('material', e.currentTarget);
            } else {
                // 通常モード時はキャンバスツールを選択
                this.selectTool('canvas');
            }
        });

        // フォント設定ボタン
        document.getElementById('fontSettings').addEventListener('click', (e) => {
            // エディタに現在のフォント設定を要求
            this.sendToEditor({
                type: 'get-current-font-settings'
            });
            // ポップアップ表示はエディタからのレスポンスを待つ
            this.fontSettingsButtonElement = e.currentTarget;
        });

        // 格子点設定ボタン
        document.getElementById('gridSettings').addEventListener('click', (e) => {
            this.showPalettePopup('grid', e.currentTarget);
        });

        // 倍率ボタン
        document.getElementById('zoomPalette').addEventListener('click', (e) => {
            this.showPalettePopup('zoom', e.currentTarget);
        });

        // ウィンドウドラッグ機能（ボタン以外の領域でドラッグ可能）
        this.setupWindowDrag();
    }

    setupWindowDrag() {
        document.body.addEventListener('mousedown', (e) => {
            // ボタン要素上でのクリックは除外
            if (e.target.closest('button') || e.target.closest('.palette-popup')) {
                return;
            }

            // 親ウィンドウにドラッグ開始を通知
            if (window.parent && window.parent !== window) {
                window.parent.postMessage({
                    type: 'start-drag-tool-panel',
                    clientX: e.clientX,
                    clientY: e.clientY,
                    fromToolPanel: true
                }, '*');
            }

            e.preventDefault();
        });
    }

    selectTool(tool) {
        logger.debug('[TOOL PANEL] ツール選択:', tool);
        this.sendToEditor({
            type: 'select-tool',
            tool: tool
        });
    }

    updateToolSelection(tool) {
        const toolButtons = document.querySelectorAll('.tool-btn[data-tool]');
        toolButtons.forEach(btn => {
            if (btn.dataset.tool === tool) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }

    /**
     * ボタン要素からポップアップ表示位置を計算（iframe→親ウィンドウ座標変換）
     */
    getPopupPosition(buttonElement) {
        const rect = buttonElement.getBoundingClientRect();
        const iframeRect = window.frameElement.getBoundingClientRect();
        return {
            x: iframeRect.left + rect.left,
            y: iframeRect.top + rect.bottom + 5
        };
    }

    showPalettePopup(paletteType, buttonElement) {
        const dispatch = {
            grid:      'showGridPopupInParent',
            font:      'showFontPopupInParent',
            fill:      'showFillPopupInParent',
            stroke:    'showStrokePopupInParent',
            lineStyle: 'showLineStylePopupInParent',
            corner:    'showCornerPopupInParent',
            material:  'showMaterialPopupInParent',
            zoom:      'showZoomPopupInParent',
        };
        const handler = dispatch[paletteType];
        if (handler) {
            this[handler](buttonElement);
        } else {
            logger.warn('[TOOL PANEL] 未知のポップアップタイプ:', paletteType);
        }
    }

    updatePaletteIcons() {
        // 塗りつぶし色アイコンを更新
        const fillIcon = document.querySelector('.fill-icon');
        if (fillIcon) {
            if (this.fillPatternId >= 2 && typeof DEFAULT_PATTERNS !== 'undefined') {
                // パターンプレビュー表示（カスタムパターン優先）
                const customPat = this.localCustomPatterns && this.localCustomPatterns[this.fillPatternId];
                const patDef = customPat || DEFAULT_PATTERNS[this.fillPatternId];
                if (patDef) {
                    const previewCanvas = createPatternPreviewCanvas(patDef, 16, this.fillColor);
                    fillIcon.style.background = `url(${previewCanvas.toDataURL()})`;
                    fillIcon.style.backgroundSize = '16px 16px';
                    fillIcon.style.border = '1px solid #000';
                } else {
                    fillIcon.style.background = this.fillColor;
                    fillIcon.style.border = '1px solid #000';
                }
            } else {
                fillIcon.style.background = this.fillColor;
                fillIcon.style.border = '1px solid #000';
            }
        }

        // 線色アイコンを更新
        const strokePaletteBtn = document.getElementById('strokePalette');
        if (strokePaletteBtn) {
            // カスタムプロパティを使用して疑似要素の色を変更
            strokePaletteBtn.style.setProperty('--stroke-color', this.strokeColor);
        }
    }

    showGridPopupInParent(buttonElement) {
        const { x, y } = this.getPopupPosition(buttonElement);

        const htmlContent = `
            <div style="font-weight: bold; margin-bottom: 8px;">格子点設定</div>
            <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
                <span style="min-width: 80px;">表示モード:</span>
                <select id="gridModeSelect" style="flex: 1; padding: 4px;">
                    <option value="none" ${this.gridMode === 'none' ? 'selected' : ''}>なし</option>
                    <option value="show" ${this.gridMode === 'show' ? 'selected' : ''}>表示のみ</option>
                    <option value="snap" ${this.gridMode === 'snap' ? 'selected' : ''}>格子点拘束</option>
                </select>
            </label>
            <div style="font-weight: bold; margin-bottom: 6px; font-size: 12px;">間隔 (px):</div>
            <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; margin-bottom: 4px; min-width: 220px;">
                <button class="grid-interval-btn" data-interval="4" style="padding: 8px 4px; border: 1px solid #ccc; background: ${this.gridInterval === 4 ? '#e0e0e0' : 'white'}; cursor: pointer; font-size: 11px;">4</button>
                <button class="grid-interval-btn" data-interval="8" style="padding: 8px 4px; border: 1px solid #ccc; background: ${this.gridInterval === 8 ? '#e0e0e0' : 'white'}; cursor: pointer; font-size: 11px;">8</button>
                <button class="grid-interval-btn" data-interval="16" style="padding: 8px 4px; border: 1px solid #ccc; background: ${this.gridInterval === 16 ? '#e0e0e0' : 'white'}; cursor: pointer; font-size: 11px;">16</button>
                <button class="grid-interval-btn" data-interval="32" style="padding: 8px 4px; border: 1px solid #ccc; background: ${this.gridInterval === 32 ? '#e0e0e0' : 'white'}; cursor: pointer; font-size: 11px;">32</button>
                <button class="grid-interval-btn" data-interval="64" style="padding: 8px 4px; border: 1px solid #ccc; background: ${this.gridInterval === 64 ? '#e0e0e0' : 'white'}; cursor: pointer; font-size: 11px;">64</button>
            </div>
            <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; margin-bottom: 12px; min-width: 220px;">
                <button class="grid-interval-btn" data-interval="5" style="padding: 8px 4px; border: 1px solid #ccc; background: ${this.gridInterval === 5 ? '#e0e0e0' : 'white'}; cursor: pointer; font-size: 11px;">5</button>
                <button class="grid-interval-btn" data-interval="10" style="padding: 8px 4px; border: 1px solid #ccc; background: ${this.gridInterval === 10 ? '#e0e0e0' : 'white'}; cursor: pointer; font-size: 11px;">10</button>
                <button class="grid-interval-btn" data-interval="20" style="padding: 8px 4px; border: 1px solid #ccc; background: ${this.gridInterval === 20 ? '#e0e0e0' : 'white'}; cursor: pointer; font-size: 11px;">20</button>
                <button class="grid-interval-btn" data-interval="25" style="padding: 8px 4px; border: 1px solid #ccc; background: ${this.gridInterval === 25 ? '#e0e0e0' : 'white'}; cursor: pointer; font-size: 11px;">25</button>
                <button class="grid-interval-btn" data-interval="40" style="padding: 8px 4px; border: 1px solid #ccc; background: ${this.gridInterval === 40 ? '#e0e0e0' : 'white'}; cursor: pointer; font-size: 11px;">40</button>
                <button class="grid-interval-btn" data-interval="50" style="padding: 8px 4px; border: 1px solid #ccc; background: ${this.gridInterval === 50 ? '#e0e0e0' : 'white'}; cursor: pointer; font-size: 11px;">50</button>
            </div>
            <label style="display: flex; align-items: center; gap: 8px;">
                <span style="min-width: 80px;">自由入力:</span>
                <input type="number" id="gridIntervalCustom" value="${this.gridInterval}" min="1" max="200" style="flex: 1; padding: 4px;">
            </label>
        `;

        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: 'show-tool-panel-popup',
                htmlContent: htmlContent,
                x: x,
                y: y
            }, '*');
        }
    }

    showFontPopupInParent(buttonElement, settings = {}) {
        const { x, y } = this.getPopupPosition(buttonElement);

        // デフォルト値を設定
        const fontSize = settings.fontSize || 16;
        const fontFamily = settings.fontFamily || 'sans-serif';
        const textColor = settings.textColor || DEFAULT_CHCOL;
        const decorations = settings.decorations || {
            bold: false,
            italic: false,
            underline: false,
            strikethrough: false
        };

        const htmlContent = `
            <div style="font-weight: bold; margin-bottom: 8px;">フォント・書式設定</div>

            <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                <span style="min-width: 80px;">フォントサイズ:</span>
                <select id="fontSizeSelect" style="flex: 1; padding: 4px;">
                    <option value="10" ${fontSize === 10 ? 'selected' : ''}>10px</option>
                    <option value="12" ${fontSize === 12 ? 'selected' : ''}>12px</option>
                    <option value="14" ${fontSize === 14 ? 'selected' : ''}>14px</option>
                    <option value="16" ${fontSize === 16 ? 'selected' : ''}>16px</option>
                    <option value="18" ${fontSize === 18 ? 'selected' : ''}>18px</option>
                    <option value="20" ${fontSize === 20 ? 'selected' : ''}>20px</option>
                    <option value="24" ${fontSize === 24 ? 'selected' : ''}>24px</option>
                    <option value="28" ${fontSize === 28 ? 'selected' : ''}>28px</option>
                    <option value="32" ${fontSize === 32 ? 'selected' : ''}>32px</option>
                    <option value="36" ${fontSize === 36 ? 'selected' : ''}>36px</option>
                </select>
            </label>

            <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                <span style="min-width: 80px;">フォント:</span>
                <select id="fontFamilySelect" style="flex: 1; padding: 4px;">
                    <option value="sans-serif" ${fontFamily === 'sans-serif' ? 'selected' : ''}>ゴシック</option>
                    <option value="serif" ${fontFamily === 'serif' ? 'selected' : ''}>明朝</option>
                    <option value="monospace" ${fontFamily === 'monospace' ? 'selected' : ''}>等幅</option>
                </select>
            </label>

            <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                <span style="min-width: 80px;">文字色:</span>
                <input type="color" id="textColorPicker" value="${textColor}" style="flex: 1; height: 30px;">
            </label>

            <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #999;">
                <div style="font-weight: bold; margin-bottom: 6px;">文字修飾</div>
                <label class="checkbox-label" style="margin-bottom: 4px;">
                    <input type="checkbox" id="boldCheck" ${decorations.bold ? 'checked' : ''}>
                    <span class="checkbox-indicator"></span>
                    <span>太字</span>
                </label>
                <label class="checkbox-label" style="margin-bottom: 4px;">
                    <input type="checkbox" id="italicCheck" ${decorations.italic ? 'checked' : ''}>
                    <span class="checkbox-indicator"></span>
                    <span>斜体</span>
                </label>
                <label class="checkbox-label" style="margin-bottom: 4px;">
                    <input type="checkbox" id="underlineCheck" ${decorations.underline ? 'checked' : ''}>
                    <span class="checkbox-indicator"></span>
                    <span>下線</span>
                </label>
                <label class="checkbox-label">
                    <input type="checkbox" id="strikethroughCheck" ${decorations.strikethrough ? 'checked' : ''}>
                    <span class="checkbox-indicator"></span>
                    <span>打ち消し線</span>
                </label>
            </div>
        `;

        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: 'show-tool-panel-popup',
                popupType: 'font',
                htmlContent: htmlContent,
                x: x,
                y: y
            }, '*');
        }
    }

    showFillPopupInParent(buttonElement) {
        const { x, y } = this.getPopupPosition(buttonElement);

        // パターン選択グリッドHTML生成（16列×8行 = 128パターン）
        let patternGridHtml = '';
        if (typeof DEFAULT_PATTERNS !== 'undefined') {
            patternGridHtml = '<div style="font-size: 11px; margin-bottom: 4px; color: #333;">パターン:</div>';
            patternGridHtml += '<div style="display: grid; grid-template-columns: repeat(16, 16px); gap: 1px; margin-bottom: 8px;">';
            for (let i = 0; i < DEFAULT_PATTERNS.length; i++) {
                // カスタムパターンがあれば上書き
                const customPat = this.localCustomPatterns && this.localCustomPatterns[i];
                const pat = customPat || DEFAULT_PATTERNS[i];
                const isSelected = (this.fillPatternId === i && i >= 2) || (this.fillPatternId === 0 && i === 0);
                const selectedStyle = isSelected ? 'outline: 2px solid #0078d7; outline-offset: -1px;' : '';
                let bgStyle = '';
                if (pat.type === 'solid') {
                    bgStyle = `background: ${pat.color};`;
                } else if (pat.type === 'pattern') {
                    const previewCanvas = createPatternPreviewCanvas(pat, 16, '#000000');
                    bgStyle = `background: url(${previewCanvas.toDataURL()}); background-size: 16px 16px;`;
                }
                patternGridHtml += `<div class="fill-pattern-cell" data-pattern-id="${i}" ` +
                    `style="width: 16px; height: 16px; border: 1px solid #999; cursor: pointer; ${bgStyle} ${selectedStyle}" ` +
                    `title="パターン ${i}"></div>`;
            }
            patternGridHtml += '</div>';
        }

        const htmlContent = `
            <label style="display: flex; align-items: center; gap: 8px;">
                <span>塗りつぶし色:</span>
                <input type="color" id="fillColorPicker" value="${this.fillColor}" style="width: 60px; height: 30px;">
            </label>
            <label class="checkbox-label" style="margin-top: 4px;">
                <input type="checkbox" id="fillEnabledCheck" ${this.fillEnabled ? 'checked' : ''}>
                <span class="checkbox-indicator"></span>
                <span>塗りつぶし有効</span>
            </label>
            <div style="border-top: 1px solid #999; margin: 8px 0;"></div>
            ${patternGridHtml}
            <div style="display: flex; gap: 8px;">
                <button id="patternEditBtn" style="padding: 4px 12px; border: 1px outset #c0c0c0; background: #dedede; cursor: pointer; font-size: 11px;">パターン編集...</button>
            </div>
        `;

        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: 'show-tool-panel-popup',
                popupType: 'fill',
                htmlContent: htmlContent,
                x: x,
                y: y
            }, '*');
        }
    }

    showStrokePopupInParent(buttonElement) {
        const { x, y } = this.getPopupPosition(buttonElement);

        const htmlContent = `
            <label style="display: flex; align-items: center; gap: 8px;">
                <span>線色:</span>
                <input type="color" id="strokeColorPicker" value="${this.strokeColor}" style="width: 60px; height: 30px;">
            </label>
        `;

        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: 'show-tool-panel-popup',
                popupType: 'stroke',
                htmlContent: htmlContent,
                x: x,
                y: y
            }, '*');
        }
    }

    showLineStylePopupInParent(buttonElement) {
        const { x, y } = this.getPopupPosition(buttonElement);

        const htmlContent = `
            <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                <span>線の太さ:</span>
                <select id="lineWidthSelect" style="padding: 4px;">
                    <option value="1" ${this.lineWidth === 1 ? 'selected' : ''}>1px</option>
                    <option value="2" ${this.lineWidth === 2 ? 'selected' : ''}>2px</option>
                    <option value="3" ${this.lineWidth === 3 ? 'selected' : ''}>3px</option>
                    <option value="5" ${this.lineWidth === 5 ? 'selected' : ''}>5px</option>
                    <option value="10" ${this.lineWidth === 10 ? 'selected' : ''}>10px</option>
                </select>
            </label>
            <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                <span>線種:</span>
                <select id="lineTypeSelect" style="padding: 4px;">
                    <option value="0" ${this.lineType === 0 ? 'selected' : ''}>実線 ─────</option>
                    <option value="1" ${this.lineType === 1 ? 'selected' : ''}>破線 ── ── ──</option>
                    <option value="2" ${this.lineType === 2 ? 'selected' : ''}>点線 ･････</option>
                    <option value="3" ${this.lineType === 3 ? 'selected' : ''}>一点鎖線 ─･─･─</option>
                    <option value="4" ${this.lineType === 4 ? 'selected' : ''}>二点鎖線 ─･･─･･</option>
                    <option value="5" ${this.lineType === 5 ? 'selected' : ''}>長破線 ─── ───</option>
                </select>
            </label>
            <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                <span>接続形状:</span>
                <select id="lineConnectionTypeSelect" style="padding: 4px;">
                    <option value="straight" ${this.lineConnectionType === 'straight' ? 'selected' : ''}>直線</option>
                    <option value="elbow" ${this.lineConnectionType === 'elbow' ? 'selected' : ''}>カギ線</option>
                    <option value="curve" ${this.lineConnectionType === 'curve' ? 'selected' : ''}>曲線</option>
                </select>
            </label>
            <div style="border-top: 1px solid #ccc; margin: 8px 0; padding-top: 8px;">
                <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                    <span>矢印位置:</span>
                    <select id="arrowPositionSelect" style="padding: 4px;">
                        <option value="none" ${this.arrowPosition === 'none' ? 'selected' : ''}>なし</option>
                        <option value="start" ${this.arrowPosition === 'start' ? 'selected' : ''}>始点のみ</option>
                        <option value="end" ${this.arrowPosition === 'end' ? 'selected' : ''}>終点のみ</option>
                        <option value="both" ${this.arrowPosition === 'both' ? 'selected' : ''}>両端</option>
                    </select>
                </label>
                <label style="display: flex; align-items: center; gap: 8px;">
                    <span>矢印種類:</span>
                    <select id="arrowTypeSelect" style="padding: 4px;">
                        <option value="simple" ${this.arrowType === 'simple' ? 'selected' : ''}>→ (線のみ)</option>
                        <option value="filled" ${this.arrowType === 'filled' ? 'selected' : ''}>➜ (塗りつぶし)</option>
                    </select>
                </label>
            </div>
        `;

        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: 'show-tool-panel-popup',
                popupType: 'lineStyle',
                htmlContent: htmlContent,
                x: x,
                y: y
            }, '*');
        }
    }

    showCornerPopupInParent(buttonElement) {
        const { x, y } = this.getPopupPosition(buttonElement);

        const htmlContent = `
            <label style="display: flex; align-items: center; gap: 8px;">
                <span>角丸半径:</span>
                <input type="number" id="cornerRadiusInput" value="${this.cornerRadius}" min="0" max="100" style="width: 60px; padding: 4px;">
            </label>
        `;

        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: 'show-tool-panel-popup',
                popupType: 'corner',
                htmlContent: htmlContent,
                x: x,
                y: y
            }, '*');
        }
    }

    showMaterialPopupInParent(buttonElement) {
        const { x, y } = this.getPopupPosition(buttonElement);

        // 画材パネルウィンドウを開くようエディタに要求
        this.sendToEditor({
            type: 'request-open-material-panel',
            x: x,
            y: y
        });
    }

    sendToEditor(message) {
        if (window.parent && window.parent !== window) {
            // 道具パネルからのメッセージであることを示すフラグを追加
            window.parent.postMessage({
                ...message,
                fromToolPanel: true
            }, '*');
        }
    }

    showZoomPopupInParent(buttonElement) {
        const { x, y } = this.getPopupPosition(buttonElement);

        const zoomOptions = [
            { value: '0.125', label: 'x1/8' },
            { value: '0.25', label: 'x1/4' },
            { value: '0.5', label: 'x1/2' },
            { value: '1', label: 'x1' },
            { value: '2', label: 'x2' },
            { value: '3', label: 'x3' },
            { value: '4', label: 'x4' },
            { value: '5', label: 'x5' },
            { value: '8', label: 'x8' }
        ];

        const optionsHtml = zoomOptions.map(opt => {
            const selected = parseFloat(opt.value) === this.zoomLevel ? 'selected' : '';
            return `<option value="${opt.value}" ${selected}>${opt.label}</option>`;
        }).join('');

        const htmlContent = `
            <label style="display: flex; align-items: center; gap: 8px;">
                <span>倍率:</span>
                <select id="zoomLevelSelect" style="padding: 4px; min-width: 80px;">
                    ${optionsHtml}
                </select>
            </label>
        `;

        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: 'show-tool-panel-popup',
                popupType: 'zoom',
                htmlContent: htmlContent,
                x: x,
                y: y
            }, '*');
        }
    }

    updateZoomButtonLabel() {
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
        const label = labels[this.zoomLevel] || ('x' + this.zoomLevel);
        const zoomLabel = document.querySelector('.zoom-label');
        if (zoomLabel) {
            zoomLabel.textContent = label;
        }
    }

    updateCanvasToolIcon() {
        const canvasTool = document.getElementById('canvasTool');
        if (canvasTool) {
            const iconSpan = canvasTool.querySelector('.tool-icon');
            if (this.isPixelmapMode) {
                iconSpan.textContent = '🎨'; // ピクセルマップモード時は画材アイコン
                canvasTool.title = '画材';
            } else {
                iconSpan.textContent = '🖼'; // 通常モード時はキャンバスアイコン
                canvasTool.title = 'キャンバス';
            }
        }
    }
}

// ツールパネルを初期化
const toolPanel = new ToolPanel();
