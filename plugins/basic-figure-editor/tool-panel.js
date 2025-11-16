/**
 * 基本図形編集プラグイン
 *  道具パネル（別ウィンドウ）
 */

class ToolPanel {
    constructor() {
        this.editorWindow = null; // 親エディタウィンドウへの参照

        // 現在の設定値
        this.fillColor = '#ffffff';
        this.fillEnabled = true;
        this.strokeColor = '#000000';
        this.lineWidth = 2;
        this.linePattern = 'solid';
        this.lineConnectionType = 'straight'; // 'straight', 'elbow', 'curve'
        this.cornerRadius = 0;

        // 格子点設定
        this.gridMode = 'none'; // 'none', 'show', 'snap'
        this.gridInterval = 16; // px

        // ピクセルマップモード
        this.isPixelmapMode = false;
        this.pixelmapTool = 'pencil';
        this.pixelmapBrushSize = 1;

        this.init();
    }

    init() {
        // 親ウィンドウからのメッセージを受信
        window.addEventListener('message', (event) => {
            console.log('[TOOL PANEL] メッセージ受信:', event.data);

            if (event.data && event.data.type === 'init-tool-panel') {
                // 初期設定を受信
                if (event.data.settings) {
                    this.fillColor = event.data.settings.fillColor || '#ffffff';
                    this.fillEnabled = event.data.settings.fillEnabled !== false;
                    this.strokeColor = event.data.settings.strokeColor || '#000000';
                    this.lineWidth = event.data.settings.lineWidth || 2;
                    this.linePattern = event.data.settings.linePattern || 'solid';
                    this.lineConnectionType = event.data.settings.lineConnectionType || 'straight';
                    this.cornerRadius = event.data.settings.cornerRadius || 0;
                }
                this.updatePaletteIcons();
            } else if (event.data && event.data.type === 'tool-selected') {
                // ツール選択状態を更新
                this.updateToolSelection(event.data.tool);
            } else if (event.data && event.data.type === 'popup-grid-interval-click') {
                // 格子点間隔ボタンがクリックされた
                this.gridInterval = event.data.interval;
                console.log('[TOOL PANEL] 格子点間隔を更新:', this.gridInterval);
                this.sendToEditor({
                    type: 'update-grid-interval',
                    gridInterval: this.gridInterval
                });
            } else if (event.data && event.data.type === 'popup-grid-mode-change') {
                // 格子点モードが変更された
                this.gridMode = event.data.gridMode;
                console.log('[TOOL PANEL] 格子点モードを更新:', this.gridMode);
                this.sendToEditor({
                    type: 'update-grid-mode',
                    gridMode: this.gridMode
                });
            } else if (event.data && event.data.type === 'popup-grid-interval-custom') {
                // 格子点間隔カスタム入力が変更された
                this.gridInterval = event.data.interval;
                console.log('[TOOL PANEL] 格子点間隔（カスタム）を更新:', this.gridInterval);
                this.sendToEditor({
                    type: 'update-grid-interval',
                    gridInterval: this.gridInterval
                });
            } else if (event.data && event.data.type === 'current-font-settings') {
                // エディタから現在のフォント設定を受信
                console.log('[TOOL PANEL] 現在のフォント設定:', event.data.settings);
                if (this.fontSettingsButtonElement) {
                    this.showFontPopupInParent(this.fontSettingsButtonElement, event.data.settings);
                    this.fontSettingsButtonElement = null;
                }
            } else if (event.data && event.data.type === 'enter-pixelmap-mode') {
                // ピクセルマップモードに入る
                this.isPixelmapMode = true;
                this.updateCanvasToolIcon();
                console.log('[TOOL PANEL] ピクセルマップモードに入りました');
            } else if (event.data && event.data.type === 'exit-pixelmap-mode') {
                // ピクセルマップモードを抜ける
                this.isPixelmapMode = false;
                this.updateCanvasToolIcon();
                console.log('[TOOL PANEL] ピクセルマップモードを抜けました');
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
            } else if (event.data && event.data.type === 'popup-stroke-color-change') {
                // 線色変更
                console.log('[TOOL PANEL] 線色変更:', event.data.strokeColor);
                this.strokeColor = event.data.strokeColor;
                this.updatePaletteIcons();
                console.log('[TOOL PANEL] update-stroke-colorをエディタに送信:', this.strokeColor);
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
            } else if (event.data && event.data.type === 'popup-line-pattern-change') {
                // 線種変更
                this.linePattern = event.data.linePattern;
                this.sendToEditor({
                    type: 'update-line-pattern',
                    linePattern: this.linePattern
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
            }
        });

        this.setupEventListeners();

        // 親ウィンドウに準備完了を通知
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: 'tool-panel-ready'
            }, '*');
        }

        console.log('[道具パネル] 準備完了');
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
        console.log('[TOOL PANEL] ツール選択:', tool);
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

    showPalettePopup(paletteType, buttonElement) {
        // すべてのポップアップを親ウィンドウに表示
        if (paletteType === 'grid') {
            this.showGridPopupInParent(buttonElement);
            return;
        }

        if (paletteType === 'font') {
            this.showFontPopupInParent(buttonElement);
            return;
        }

        if (paletteType === 'fill') {
            this.showFillPopupInParent(buttonElement);
            return;
        }

        if (paletteType === 'stroke') {
            this.showStrokePopupInParent(buttonElement);
            return;
        }

        if (paletteType === 'lineStyle') {
            this.showLineStylePopupInParent(buttonElement);
            return;
        }

        if (paletteType === 'corner') {
            this.showCornerPopupInParent(buttonElement);
            return;
        }

        if (paletteType === 'material') {
            this.showMaterialPopupInParent(buttonElement);
            return;
        }

        // すべてのポップアップタイプが親ウィンドウ表示に対応済み
        console.warn('[TOOL PANEL] 未知のポップアップタイプ:', paletteType);
    }

    updatePaletteIcons() {
        // 塗りつぶし色アイコンを更新
        const fillIcon = document.querySelector('.fill-icon');
        if (fillIcon) {
            fillIcon.style.background = this.fillColor;
            fillIcon.style.border = '1px solid #000';
        }

        // 線色アイコンを更新
        const strokePaletteBtn = document.getElementById('strokePalette');
        if (strokePaletteBtn) {
            // カスタムプロパティを使用して疑似要素の色を変更
            strokePaletteBtn.style.setProperty('--stroke-color', this.strokeColor);
        }
    }

    showGridPopupInParent(buttonElement) {
        const rect = buttonElement.getBoundingClientRect();
        const iframeRect = window.frameElement.getBoundingClientRect();

        // iframe内の座標を親ウィンドウの座標に変換
        const x = iframeRect.left + rect.left;
        const y = iframeRect.top + rect.bottom + 5;

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
        const rect = buttonElement.getBoundingClientRect();
        const iframeRect = window.frameElement.getBoundingClientRect();

        // iframe内の座標を親ウィンドウの座標に変換
        const x = iframeRect.left + rect.left;
        const y = iframeRect.top + rect.bottom + 5;

        // デフォルト値を設定
        const fontSize = settings.fontSize || 16;
        const fontFamily = settings.fontFamily || 'sans-serif';
        const textColor = settings.textColor || '#000000';
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
                <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                    <input type="checkbox" id="boldCheck" ${decorations.bold ? 'checked' : ''}>
                    <span>太字</span>
                </label>
                <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                    <input type="checkbox" id="italicCheck" ${decorations.italic ? 'checked' : ''}>
                    <span>斜体</span>
                </label>
                <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                    <input type="checkbox" id="underlineCheck" ${decorations.underline ? 'checked' : ''}>
                    <span>下線</span>
                </label>
                <label style="display: flex; align-items: center; gap: 8px;">
                    <input type="checkbox" id="strikethroughCheck" ${decorations.strikethrough ? 'checked' : ''}>
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
        const rect = buttonElement.getBoundingClientRect();
        const iframeRect = window.frameElement.getBoundingClientRect();

        // iframe内の座標を親ウィンドウの座標に変換
        const x = iframeRect.left + rect.left;
        const y = iframeRect.top + rect.bottom + 5;

        const htmlContent = `
            <label style="display: flex; align-items: center; gap: 8px;">
                <span>塗りつぶし色:</span>
                <input type="color" id="fillColorPicker" value="${this.fillColor}" style="width: 60px; height: 30px;">
            </label>
            <label style="display: flex; align-items: center; gap: 8px;">
                <input type="checkbox" id="fillEnabledCheck" ${this.fillEnabled ? 'checked' : ''}>
                <span>塗りつぶし有効</span>
            </label>
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
        const rect = buttonElement.getBoundingClientRect();
        const iframeRect = window.frameElement.getBoundingClientRect();

        // iframe内の座標を親ウィンドウの座標に変換
        const x = iframeRect.left + rect.left;
        const y = iframeRect.top + rect.bottom + 5;

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
        const rect = buttonElement.getBoundingClientRect();
        const iframeRect = window.frameElement.getBoundingClientRect();

        // iframe内の座標を親ウィンドウの座標に変換
        const x = iframeRect.left + rect.left;
        const y = iframeRect.top + rect.bottom + 5;

        const htmlContent = `
            <label style="display: flex; align-items: center; gap: 8px;">
                <span>線の太さ:</span>
                <select id="lineWidthSelect" style="padding: 4px;">
                    <option value="1" ${this.lineWidth === 1 ? 'selected' : ''}>1px</option>
                    <option value="2" ${this.lineWidth === 2 ? 'selected' : ''}>2px</option>
                    <option value="3" ${this.lineWidth === 3 ? 'selected' : ''}>3px</option>
                    <option value="5" ${this.lineWidth === 5 ? 'selected' : ''}>5px</option>
                    <option value="10" ${this.lineWidth === 10 ? 'selected' : ''}>10px</option>
                </select>
            </label>
            <label style="display: flex; align-items: center; gap: 8px;">
                <span>線種:</span>
                <select id="linePatternSelect" style="padding: 4px;">
                    <option value="solid" ${this.linePattern === 'solid' ? 'selected' : ''}>実線</option>
                    <option value="dotted" ${this.linePattern === 'dotted' ? 'selected' : ''}>点線</option>
                    <option value="dashed" ${this.linePattern === 'dashed' ? 'selected' : ''}>破線</option>
                </select>
            </label>
            <label style="display: flex; align-items: center; gap: 8px;">
                <span>接続形状:</span>
                <select id="lineConnectionTypeSelect" style="padding: 4px;">
                    <option value="straight" ${this.lineConnectionType === 'straight' ? 'selected' : ''}>直線</option>
                    <option value="elbow" ${this.lineConnectionType === 'elbow' ? 'selected' : ''}>カギ線</option>
                    <option value="curve" ${this.lineConnectionType === 'curve' ? 'selected' : ''}>曲線</option>
                </select>
            </label>
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
        const rect = buttonElement.getBoundingClientRect();
        const iframeRect = window.frameElement.getBoundingClientRect();

        // iframe内の座標を親ウィンドウの座標に変換
        const x = iframeRect.left + rect.left;
        const y = iframeRect.top + rect.bottom + 5;

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
        const rect = buttonElement.getBoundingClientRect();
        const iframeRect = window.frameElement.getBoundingClientRect();

        // iframe内の座標を親ウィンドウの座標に変換
        const x = iframeRect.left + rect.left;
        const y = iframeRect.top + rect.bottom + 5;

        const htmlContent = `
            <div style="font-weight: bold; margin-bottom: 8px;">画材ツール</div>
            <button class="material-tool-btn" data-material-tool="pencil" style="width: 100%; padding: 8px; margin-bottom: 4px; background: ${this.pixelmapTool === 'pencil' ? '#e0e0e0' : 'white'}; cursor: pointer; border: 1px solid #999;">鉛筆</button>
            <button class="material-tool-btn" data-material-tool="brush" style="width: 100%; padding: 8px; margin-bottom: 4px; background: ${this.pixelmapTool === 'brush' ? '#e0e0e0' : 'white'}; cursor: pointer; border: 1px solid #999;">絵筆</button>
            <button class="material-tool-btn" data-material-tool="eraser" style="width: 100%; padding: 8px; margin-bottom: 4px; background: ${this.pixelmapTool === 'eraser' ? '#e0e0e0' : 'white'}; cursor: pointer; border: 1px solid #999;">消しゴム</button>
            <button class="material-tool-btn" data-material-tool="airbrush" style="width: 100%; padding: 8px; margin-bottom: 4px; background: ${this.pixelmapTool === 'airbrush' ? '#e0e0e0' : 'white'}; cursor: pointer; border: 1px solid #999;">エアブラシ</button>
            <button class="material-tool-btn" data-material-tool="paint" style="width: 100%; padding: 8px; margin-bottom: 4px; background: ${this.pixelmapTool === 'paint' ? '#e0e0e0' : 'white'}; cursor: pointer; border: 1px solid #999;">絵の具</button>
            <button class="material-tool-btn" data-material-tool="artcutter" style="width: 100%; padding: 8px; margin-bottom: 12px; background: ${this.pixelmapTool === 'artcutter' ? '#e0e0e0' : 'white'}; cursor: pointer; border: 1px solid #999;">アートカッター</button>
            <label style="display: flex; align-items: center; gap: 8px;">
                <span>ブラシサイズ:</span>
                <input type="number" id="brushSizeInput" value="${this.pixelmapBrushSize}" min="1" max="20" style="width: 60px; padding: 4px;">
            </label>
        `;

        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: 'show-tool-panel-popup',
                popupType: 'material',
                htmlContent: htmlContent,
                x: x,
                y: y
            }, '*');
        }
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
