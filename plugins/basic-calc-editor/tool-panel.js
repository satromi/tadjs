/**
 * 操作パネル - 基本表計算
 * 書式設定・罫線・セル入力を管理
 * @module plugins/basic-calc-editor/tool-panel
 */
const logger = window.getLogger('CalcToolPanel');

class CalcToolPanel {
    constructor() {
        // 現在の選択セル情報
        this.currentCell = null;
        this.currentValue = '';
        this.currentFormula = '';

        // 書式設定状態
        this.formatState = {
            bold: false,
            italic: false,
            underline: false,
            strikethrough: false,
            superscript: false,
            subscript: false,
            textColor: typeof DEFAULT_CHCOL !== 'undefined' ? DEFAULT_CHCOL : '#000000',
            bgColor: typeof DEFAULT_BGCOL !== 'undefined' ? DEFAULT_BGCOL : '#ffffff',
            borderColor: typeof DEFAULT_FRCOL !== 'undefined' ? DEFAULT_FRCOL : '#000000',
            align: 'left',
            vAlign: 'middle',
            fontFamily: 'MS Gothic',
            fontSize: 12,
            lineStyle: 'solid',
            lineWidth: 1
        };

        // フォントマップ
        this.fontMap = {
            'MS Gothic': 'ゴシック',
            'MS Mincho': '明朝',
            'Meiryo': 'メイリオ'
        };

        // 線種マップ
        this.lineStyleMap = {
            'solid': '実線',
            'dashed': '破線',
            'dotted': '点線',
            'double': '二重線'
        };

        // 線幅マップ
        this.lineWidthMap = {
            1: '細',
            2: '中',
            3: '太'
        };

        // 水平配置マップ
        this.hAlignMap = {
            'left': '左',
            'center': '中央',
            'right': '右'
        };

        // 垂直配置マップ
        this.vAlignMap = {
            'top': '上',
            'middle': '中',
            'bottom': '下'
        };

        // 水平配置アイコン
        this.hAlignIcons = {
            'left': '☰',
            'center': '☰',
            'right': '☰'
        };

        // 垂直配置アイコン
        this.vAlignIcons = {
            'top': '↕',
            'middle': '↕',
            'bottom': '↕'
        };

        // ドラッグ状態
        this.isDragging = false;

        this.init();
    }

    init() {
        logger.info('[CalcToolPanel] 初期化開始');

        // イベントリスナー設定
        this.setupEventListeners();

        // MessageBus（親ウィンドウとの通信）
        this.setupMessageHandlers();

        logger.info('[CalcToolPanel] 初期化完了');
    }

    /**
     * イベントリスナー設定
     */
    setupEventListeners() {
        // 太字ボタン
        document.getElementById('boldBtn').addEventListener('click', () => {
            this.toggleFormat('bold');
        });

        // 斜体ボタン
        document.getElementById('italicBtn').addEventListener('click', () => {
            this.toggleFormat('italic');
        });

        // 下線ボタン
        document.getElementById('underlineBtn').addEventListener('click', () => {
            this.toggleFormat('underline');
        });

        // 取り消し線ボタン
        document.getElementById('strikethroughBtn').addEventListener('click', () => {
            this.toggleFormat('strikethrough');
        });

        // 上付きボタン
        document.getElementById('superscriptBtn').addEventListener('click', () => {
            this.toggleVerticalAlign('superscript');
        });

        // 下付きボタン
        document.getElementById('subscriptBtn').addEventListener('click', () => {
            this.toggleVerticalAlign('subscript');
        });

        // 文字色ピッカー
        document.getElementById('textColorPicker').addEventListener('input', (e) => {
            this.formatState.textColor = e.target.value;
            this.sendFormatUpdate();
        });

        // 背景色ピッカー
        document.getElementById('bgColorPicker').addEventListener('input', (e) => {
            this.formatState.bgColor = e.target.value;
            this.sendFormatUpdate();
        });

        // 水平配置ドロップダウン
        document.getElementById('hAlignDropdownBtn').addEventListener('click', (e) => {
            this.showHAlignPopup(e.currentTarget);
        });

        // 垂直配置ドロップダウン
        document.getElementById('vAlignDropdownBtn').addEventListener('click', (e) => {
            this.showVAlignPopup(e.currentTarget);
        });

        // 罫線ボタン
        document.getElementById('borderAllBtn').addEventListener('click', () => {
            this.setBorder('all');
        });
        document.getElementById('borderOutlineBtn').addEventListener('click', () => {
            this.setBorder('outline');
        });
        document.getElementById('borderTopBtn').addEventListener('click', () => {
            this.setBorder('top');
        });
        document.getElementById('borderBottomBtn').addEventListener('click', () => {
            this.setBorder('bottom');
        });
        document.getElementById('borderLeftBtn').addEventListener('click', () => {
            this.setBorder('left');
        });
        document.getElementById('borderRightBtn').addEventListener('click', () => {
            this.setBorder('right');
        });
        document.getElementById('borderNoneBtn').addEventListener('click', () => {
            this.setBorder('none');
        });

        // 線の色ピッカー
        document.getElementById('borderColorPicker').addEventListener('input', (e) => {
            this.formatState.borderColor = e.target.value;
        });

        // 集合縦棒グラフボタン
        document.getElementById('clusteredBarChartBtn').addEventListener('click', () => {
            this.insertClusteredBarChart();
        });

        // 積上縦棒グラフボタン
        document.getElementById('stackedBarChartBtn').addEventListener('click', () => {
            this.insertStackedBarChart();
        });

        // 折れ線グラフボタン
        document.getElementById('lineChartBtn').addEventListener('click', () => {
            this.insertLineChart();
        });

        // 積上折線グラフボタン
        document.getElementById('stackedLineChartBtn').addEventListener('click', () => {
            this.insertStackedLineChart();
        });

        // フォント選択（ポップアップ）
        document.getElementById('fontDropdownBtn').addEventListener('click', (e) => {
            this.showFontPopup(e.currentTarget);
        });

        // フォントサイズ選択（ポップアップ）
        document.getElementById('sizeDropdownBtn').addEventListener('click', (e) => {
            this.showSizePopup(e.currentTarget);
        });

        // 線種選択（ポップアップ）
        document.getElementById('lineStyleDropdownBtn').addEventListener('click', (e) => {
            this.showLineStylePopup(e.currentTarget);
        });

        // 線幅選択（ポップアップ）
        document.getElementById('lineWidthDropdownBtn').addEventListener('click', (e) => {
            this.showLineWidthPopup(e.currentTarget);
        });

        // セル入力
        const cellInput = document.getElementById('cellInput');
        cellInput.addEventListener('input', () => {
            this.currentValue = cellInput.value;
        });

        cellInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.confirmInput();
            } else if (e.key === 'Escape') {
                this.cancelInput();
            }
        });

        // 確定ボタン
        document.getElementById('confirmBtn').addEventListener('click', () => {
            this.confirmInput();
        });

        // キャンセルボタン
        document.getElementById('cancelBtn').addEventListener('click', () => {
            this.cancelInput();
        });

        // 関数挿入ボタン
        document.getElementById('formulaBtn').addEventListener('click', () => {
            this.insertFormula();
        });

        // ドラッグ
        this.setupDrag();
    }

    /**
     * メッセージハンドラ設定
     */
    setupMessageHandlers() {
        window.addEventListener('message', (e) => {
            const data = e.data;
            if (!data || !data.type) return;

            switch (data.type) {
                case 'init-tool-panel':
                    logger.debug('[CalcToolPanel] init-tool-panel受信', data.settings);
                    if (data.settings) {
                        // 初期設定適用
                    }
                    break;

                case 'calc-cell-selected':
                    this.handleCellSelected(data);
                    break;

                case 'calc-cell-input':
                    this.handleCellInput(data);
                    break;

                // ポップアップからの選択
                case 'popup-calc-font-select':
                    this.setFontFamily(data.fontFamily);
                    document.getElementById('fontDisplay').textContent = this.fontMap[data.fontFamily] || data.fontFamily;
                    break;

                case 'popup-calc-size-select':
                    this.setFontSize(data.fontSize);
                    document.getElementById('sizeDisplay').textContent = data.fontSize;
                    break;

                case 'popup-calc-line-style-select':
                    this.formatState.lineStyle = data.lineStyle;
                    document.getElementById('lineStyleDisplay').textContent = this.lineStyleMap[data.lineStyle] || data.lineStyle;
                    break;

                case 'popup-calc-line-width-select':
                    this.formatState.lineWidth = data.lineWidth;
                    document.getElementById('lineWidthDisplay').textContent = this.lineWidthMap[data.lineWidth] || data.lineWidth;
                    break;

                case 'popup-calc-halign-select':
                    this.setAlign(data.align);
                    this.setHAlignDisplay(data.align);
                    break;

                case 'popup-calc-valign-select':
                    this.setVAlign(data.vAlign);
                    this.setVAlignDisplay(data.vAlign);
                    break;
            }
        });
    }

    /**
     * セル選択ハンドラ
     */
    handleCellSelected(data) {
        logger.debug('[CalcToolPanel] セル選択:', data);

        this.currentCell = {
            col: data.col,
            row: data.row,
            cellRef: data.cellRef
        };

        // セル参照表示更新
        document.getElementById('cellRef').textContent = data.cellRef;

        // 入力欄更新
        const cellInput = document.getElementById('cellInput');
        if (data.formula) {
            cellInput.value = data.formula;
            this.currentFormula = data.formula;
        } else {
            cellInput.value = data.value || '';
            this.currentFormula = '';
        }
        this.currentValue = cellInput.value;

        // 書式状態更新
        if (data.style) {
            this.updateFormatState(data.style);
        }
    }

    /**
     * セル入力ハンドラ
     */
    handleCellInput(data) {
        document.getElementById('cellInput').value = data.value;
        this.currentValue = data.value;
    }

    /**
     * 書式状態更新
     */
    updateFormatState(style) {
        // 太字
        const boldBtn = document.getElementById('boldBtn');
        if (style.fontWeight === 'bold') {
            boldBtn.classList.add('active');
            this.formatState.bold = true;
        } else {
            boldBtn.classList.remove('active');
            this.formatState.bold = false;
        }

        // 斜体
        const italicBtn = document.getElementById('italicBtn');
        if (style.fontStyle === 'italic') {
            italicBtn.classList.add('active');
            this.formatState.italic = true;
        } else {
            italicBtn.classList.remove('active');
            this.formatState.italic = false;
        }

        // 下線（textDecorationに'underline'が含まれているかチェック）
        const underlineBtn = document.getElementById('underlineBtn');
        if (style.textDecoration && style.textDecoration.includes('underline')) {
            underlineBtn.classList.add('active');
            this.formatState.underline = true;
        } else {
            underlineBtn.classList.remove('active');
            this.formatState.underline = false;
        }

        // 取り消し線（textDecorationに'line-through'が含まれているかチェック）
        const strikethroughBtn = document.getElementById('strikethroughBtn');
        if (style.textDecoration && style.textDecoration.includes('line-through')) {
            strikethroughBtn.classList.add('active');
            this.formatState.strikethrough = true;
        } else {
            strikethroughBtn.classList.remove('active');
            this.formatState.strikethrough = false;
        }

        // 上付き
        const superscriptBtn = document.getElementById('superscriptBtn');
        if (style.verticalAlign === 'super') {
            superscriptBtn.classList.add('active');
            this.formatState.superscript = true;
        } else {
            superscriptBtn.classList.remove('active');
            this.formatState.superscript = false;
        }

        // 下付き
        const subscriptBtn = document.getElementById('subscriptBtn');
        if (style.verticalAlign === 'sub') {
            subscriptBtn.classList.add('active');
            this.formatState.subscript = true;
        } else {
            subscriptBtn.classList.remove('active');
            this.formatState.subscript = false;
        }

        // 文字色（デフォルトは黒）
        const textColor = style.color || DEFAULT_CHCOL;
        this.formatState.textColor = textColor;
        document.getElementById('textColorPicker').value = textColor;

        // 背景色（デフォルトは白）
        const bgColor = style.backgroundColor || DEFAULT_BGCOL;
        this.formatState.bgColor = bgColor;
        document.getElementById('bgColorPicker').value = bgColor;

        // フォントサイズ（デフォルトは12）
        const fontSize = style.fontSize || 12;
        this.formatState.fontSize = fontSize;
        document.getElementById('sizeDisplay').textContent = fontSize;

        // フォントファミリー（デフォルトはMS Gothic）
        const fontFamily = style.fontFamily || 'MS Gothic';
        this.formatState.fontFamily = fontFamily;
        document.getElementById('fontDisplay').textContent = this.fontMap[fontFamily] || fontFamily;

        // 水平配置（デフォルトは左揃え）
        const textAlign = style.textAlign || 'left';
        this.formatState.align = textAlign;
        this.setHAlignDisplay(textAlign);

        // 垂直配置（デフォルトは中揃え）
        const vAlign = style.vAlign || 'middle';
        this.formatState.vAlign = vAlign;
        this.setVAlignDisplay(vAlign);
    }

    /**
     * 書式トグル
     */
    toggleFormat(format) {
        this.formatState[format] = !this.formatState[format];

        const btn = document.getElementById(`${format}Btn`);
        if (this.formatState[format]) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }

        this.sendFormatUpdate();
    }

    /**
     * 縦方向配置トグル（上付き・下付きは相互排他的）
     */
    toggleVerticalAlign(type) {
        // 上付きと下付きは同時に設定できない
        if (type === 'superscript') {
            this.formatState.superscript = !this.formatState.superscript;
            if (this.formatState.superscript) {
                this.formatState.subscript = false;
                document.getElementById('subscriptBtn').classList.remove('active');
            }
            const btn = document.getElementById('superscriptBtn');
            if (this.formatState.superscript) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        } else if (type === 'subscript') {
            this.formatState.subscript = !this.formatState.subscript;
            if (this.formatState.subscript) {
                this.formatState.superscript = false;
                document.getElementById('superscriptBtn').classList.remove('active');
            }
            const btn = document.getElementById('subscriptBtn');
            if (this.formatState.subscript) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        }

        this.sendFormatUpdate();
    }

    /**
     * 水平配置設定
     */
    setAlign(align) {
        this.formatState.align = align;
        this.setHAlignDisplay(align);
        this.sendFormatUpdate();
    }

    /**
     * 垂直配置設定
     */
    setVAlign(vAlign) {
        this.formatState.vAlign = vAlign;
        this.setVAlignDisplay(vAlign);
        this.sendFormatUpdate();
    }

    /**
     * 水平配置表示更新
     */
    setHAlignDisplay(align) {
        this.formatState.align = align;
        document.getElementById('hAlignDisplay').textContent = this.hAlignIcons[align] || '☰';
    }

    /**
     * 垂直配置表示更新
     */
    setVAlignDisplay(vAlign) {
        this.formatState.vAlign = vAlign;
        document.getElementById('vAlignDisplay').textContent = this.vAlignIcons[vAlign] || '↕';
    }

    /**
     * フォントファミリー設定
     */
    setFontFamily(family) {
        this.formatState.fontFamily = family;
        this.sendFormatUpdate();
    }

    /**
     * フォントサイズ設定
     */
    setFontSize(size) {
        this.formatState.fontSize = size;
        this.sendFormatUpdate();
    }

    /**
     * 罫線設定
     */
    setBorder(type) {
        logger.debug(`[CalcToolPanel] 罫線設定: ${type}`);

        const lineStyle = this.formatState.lineStyle;
        const lineWidth = this.formatState.lineWidth;
        const lineColor = this.formatState.borderColor;

        this.sendToParent('calc-cell-format', {
            style: {
                border: {
                    type: type,
                    style: lineStyle,
                    width: lineWidth,
                    color: lineColor
                }
            }
        });
    }

    /**
     * 書式更新送信
     */
    sendFormatUpdate() {
        // textDecorationを決定（underline と strikethrough を組み合わせ可能）
        const decorations = [];
        if (this.formatState.underline) {
            decorations.push('underline');
        }
        if (this.formatState.strikethrough) {
            decorations.push('line-through');
        }
        const textDecoration = decorations.length > 0 ? decorations.join(' ') : 'none';

        // verticalAlignを決定（superscript と subscript のどちらか、または undefined）
        let verticalAlign = undefined;
        if (this.formatState.superscript) {
            verticalAlign = 'super';
        } else if (this.formatState.subscript) {
            verticalAlign = 'sub';
        }

        const style = {
            fontWeight: this.formatState.bold ? 'bold' : 'normal',
            fontStyle: this.formatState.italic ? 'italic' : 'normal',
            textDecoration: textDecoration,
            color: this.formatState.textColor,
            backgroundColor: this.formatState.bgColor,
            textAlign: this.formatState.align,
            vAlign: this.formatState.vAlign,
            fontFamily: this.formatState.fontFamily,
            fontSize: this.formatState.fontSize
        };

        // verticalAlign が定義されている場合のみ追加
        if (verticalAlign) {
            style.verticalAlign = verticalAlign;
        }

        this.sendToParent('calc-cell-format', { style });
    }

    /**
     * 入力確定
     */
    confirmInput() {
        const value = document.getElementById('cellInput').value;
        this.sendToParent('calc-cell-value-update', { value });
    }

    /**
     * 入力キャンセル
     */
    cancelInput() {
        // 元の値に戻す
        const cellInput = document.getElementById('cellInput');
        if (this.currentFormula) {
            cellInput.value = this.currentFormula;
        } else {
            cellInput.value = this.currentValue;
        }
    }

    /**
     * 関数挿入
     */
    insertFormula() {
        const cellInput = document.getElementById('cellInput');
        if (!cellInput.value.startsWith('=')) {
            cellInput.value = '=' + cellInput.value;
        }
        cellInput.focus();
    }

    /**
     * 集合縦棒グラフ挿入
     * 選択範囲のデータからグラフを生成するようeditorに通知
     */
    insertClusteredBarChart() {
        this.sendToParent('insert-chart', {
            chartType: 'clustered-bar'
        });
    }

    /**
     * 積上縦棒グラフ挿入
     * 選択範囲のデータから積上グラフを生成するようeditorに通知
     */
    insertStackedBarChart() {
        this.sendToParent('insert-chart', {
            chartType: 'stacked-bar'
        });
    }

    /**
     * 折れ線グラフ挿入
     * 選択範囲のデータから折れ線グラフを生成するようeditorに通知
     */
    insertLineChart() {
        this.sendToParent('insert-chart', {
            chartType: 'line'
        });
    }

    /**
     * 積上折線グラフ挿入
     * 選択範囲のデータから積上折線グラフを生成するようeditorに通知
     */
    insertStackedLineChart() {
        this.sendToParent('insert-chart', {
            chartType: 'stacked-line'
        });
    }

    /**
     * 親ウィンドウにメッセージ送信
     * fromToolPanelフラグを付けて、親が編集ウィンドウに中継できるようにする
     */
    sendToParent(type, data) {
        logger.debug(`[CalcToolPanel] sendToParent: ${type}`, data);
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: type,
                fromToolPanel: true,
                ...data
            }, '*');
            logger.debug(`[CalcToolPanel] メッセージ送信完了: ${type}`);
        } else {
            logger.warn('[CalcToolPanel] 親ウィンドウが見つかりません');
        }
    }

    /**
     * ドラッグ設定
     * ボタン・入力・選択要素以外の余白部分でのみドラッグ可能
     */
    setupDrag() {
        document.body.addEventListener('mousedown', (e) => {
            // ボタン、入力、選択、カラーパレット上でのクリックは除外
            if (e.target.closest('button') ||
                e.target.closest('input') ||
                e.target.closest('select') ||
                e.target.closest('.color-palette')) {
                return;
            }

            this.isDragging = true;

            // 親ウィンドウにドラッグ開始を通知
            this.sendToParent('start-drag-tool-panel', {
                clientX: e.clientX,
                clientY: e.clientY
            });
        });
    }

    /**
     * ポップアップ座標を計算
     */
    getPopupPosition(buttonElement) {
        const rect = buttonElement.getBoundingClientRect();
        const iframeRect = window.frameElement.getBoundingClientRect();
        return {
            x: iframeRect.left + rect.left,
            y: iframeRect.top + rect.bottom + 2
        };
    }

    /**
     * フォント選択ポップアップを表示
     */
    showFontPopup(buttonElement) {
        const pos = this.getPopupPosition(buttonElement);

        const fonts = [
            { value: 'MS Gothic', label: 'MS ゴシック' },
            { value: 'MS Mincho', label: 'MS 明朝' },
            { value: 'Meiryo', label: 'メイリオ' }
        ];

        const htmlContent = fonts.map(font => `
            <div class="popup-item" data-font="${font.value}"
                 style="padding: 4px 8px; cursor: pointer; ${this.formatState.fontFamily === font.value ? 'background: #b0c4de;' : ''}"
                 onmouseover="this.style.background='#d0e0f0'"
                 onmouseout="this.style.background='${this.formatState.fontFamily === font.value ? '#b0c4de' : 'transparent'}'">
                ${font.label}
            </div>
        `).join('');

        this.sendToParent('show-tool-panel-popup', {
            popupType: 'calc-font',
            htmlContent: `<div style="min-width: 100px;">${htmlContent}</div>`,
            x: pos.x,
            y: pos.y
        });
    }

    /**
     * フォントサイズ選択ポップアップを表示
     */
    showSizePopup(buttonElement) {
        const pos = this.getPopupPosition(buttonElement);

        const sizes = [9, 10, 11, 12, 14, 16, 18, 24, 32];

        const htmlContent = sizes.map(size => `
            <div class="popup-item" data-size="${size}"
                 style="padding: 4px 8px; cursor: pointer; ${this.formatState.fontSize === size ? 'background: #b0c4de;' : ''}"
                 onmouseover="this.style.background='#d0e0f0'"
                 onmouseout="this.style.background='${this.formatState.fontSize === size ? '#b0c4de' : 'transparent'}'">
                ${size}
            </div>
        `).join('');

        this.sendToParent('show-tool-panel-popup', {
            popupType: 'calc-size',
            htmlContent: `<div style="min-width: 50px;">${htmlContent}</div>`,
            x: pos.x,
            y: pos.y
        });
    }

    /**
     * 線種選択ポップアップを表示
     */
    showLineStylePopup(buttonElement) {
        const pos = this.getPopupPosition(buttonElement);

        const styles = [
            { value: 'solid', label: '実線' },
            { value: 'dashed', label: '破線' },
            { value: 'dotted', label: '点線' },
            { value: 'double', label: '二重線' }
        ];

        const htmlContent = styles.map(style => `
            <div class="popup-item" data-linestyle="${style.value}"
                 style="padding: 4px 8px; cursor: pointer; ${this.formatState.lineStyle === style.value ? 'background: #b0c4de;' : ''}"
                 onmouseover="this.style.background='#d0e0f0'"
                 onmouseout="this.style.background='${this.formatState.lineStyle === style.value ? '#b0c4de' : 'transparent'}'">
                ${style.label}
            </div>
        `).join('');

        this.sendToParent('show-tool-panel-popup', {
            popupType: 'calc-line-style',
            htmlContent: `<div style="min-width: 60px;">${htmlContent}</div>`,
            x: pos.x,
            y: pos.y
        });
    }

    /**
     * 線幅選択ポップアップを表示
     */
    showLineWidthPopup(buttonElement) {
        const pos = this.getPopupPosition(buttonElement);

        const widths = [
            { value: 1, label: '細' },
            { value: 2, label: '中' },
            { value: 3, label: '太' }
        ];

        const htmlContent = widths.map(width => `
            <div class="popup-item" data-linewidth="${width.value}"
                 style="padding: 4px 8px; cursor: pointer; ${this.formatState.lineWidth === width.value ? 'background: #b0c4de;' : ''}"
                 onmouseover="this.style.background='#d0e0f0'"
                 onmouseout="this.style.background='${this.formatState.lineWidth === width.value ? '#b0c4de' : 'transparent'}'">
                ${width.label}
            </div>
        `).join('');

        this.sendToParent('show-tool-panel-popup', {
            popupType: 'calc-line-width',
            htmlContent: `<div style="min-width: 50px;">${htmlContent}</div>`,
            x: pos.x,
            y: pos.y
        });
    }

    /**
     * 水平配置選択ポップアップを表示
     */
    showHAlignPopup(buttonElement) {
        const pos = this.getPopupPosition(buttonElement);

        const aligns = [
            { value: 'left', label: '左揃え' },
            { value: 'center', label: '中央揃え' },
            { value: 'right', label: '右揃え' }
        ];

        const htmlContent = aligns.map(align => `
            <div class="popup-item" data-halign="${align.value}"
                 style="padding: 4px 8px; cursor: pointer; ${this.formatState.align === align.value ? 'background: #b0c4de;' : ''}"
                 onmouseover="this.style.background='#d0e0f0'"
                 onmouseout="this.style.background='${this.formatState.align === align.value ? '#b0c4de' : 'transparent'}'">
                ${align.label}
            </div>
        `).join('');

        this.sendToParent('show-tool-panel-popup', {
            popupType: 'calc-halign',
            htmlContent: `<div style="min-width: 70px;">${htmlContent}</div>`,
            x: pos.x,
            y: pos.y
        });
    }

    /**
     * 垂直配置選択ポップアップを表示
     */
    showVAlignPopup(buttonElement) {
        const pos = this.getPopupPosition(buttonElement);

        const aligns = [
            { value: 'top', label: '上揃え' },
            { value: 'middle', label: '中揃え' },
            { value: 'bottom', label: '下揃え' }
        ];

        const htmlContent = aligns.map(align => `
            <div class="popup-item" data-valign="${align.value}"
                 style="padding: 4px 8px; cursor: pointer; ${this.formatState.vAlign === align.value ? 'background: #b0c4de;' : ''}"
                 onmouseover="this.style.background='#d0e0f0'"
                 onmouseout="this.style.background='${this.formatState.vAlign === align.value ? '#b0c4de' : 'transparent'}'">
                ${align.label}
            </div>
        `).join('');

        this.sendToParent('show-tool-panel-popup', {
            popupType: 'calc-valign',
            htmlContent: `<div style="min-width: 60px;">${htmlContent}</div>`,
            x: pos.x,
            y: pos.y
        });
    }
}

// 操作パネルのインスタンスを作成
window.addEventListener('DOMContentLoaded', () => {
    window.calcToolPanel = new CalcToolPanel();
});
