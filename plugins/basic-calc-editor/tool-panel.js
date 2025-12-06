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
            textColor: '#000000',
            bgColor: '#ffffff',
            borderColor: '#000000',
            align: 'left',
            fontFamily: 'MS Gothic',
            fontSize: 12
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

        // 配置ボタン
        document.getElementById('alignLeftBtn').addEventListener('click', () => {
            this.setAlign('left');
        });
        document.getElementById('alignCenterBtn').addEventListener('click', () => {
            this.setAlign('center');
        });
        document.getElementById('alignRightBtn').addEventListener('click', () => {
            this.setAlign('right');
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
            logger.debug(`[CalcToolPanel] 線の色変更: ${e.target.value}`);
        });

        // フォント選択
        document.getElementById('fontSelect').addEventListener('change', (e) => {
            this.setFontFamily(e.target.value);
        });

        // フォントサイズ選択
        document.getElementById('sizeSelect').addEventListener('change', (e) => {
            this.setFontSize(parseInt(e.target.value));
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
        const textColor = style.color || '#000000';
        this.formatState.textColor = textColor;
        document.getElementById('textColorPicker').value = textColor;

        // 背景色（デフォルトは白）
        const bgColor = style.backgroundColor || '#ffffff';
        this.formatState.bgColor = bgColor;
        document.getElementById('bgColorPicker').value = bgColor;

        // フォントサイズ（デフォルトは12）
        const fontSize = style.fontSize || 12;
        this.formatState.fontSize = fontSize;
        document.getElementById('sizeSelect').value = fontSize;

        // フォントファミリー（デフォルトはMS Gothic）
        const fontFamily = style.fontFamily || 'MS Gothic';
        this.formatState.fontFamily = fontFamily;
        document.getElementById('fontSelect').value = fontFamily;

        // 配置（デフォルトは左揃え）
        const textAlign = style.textAlign || 'left';
        this.setAlignButtonState(textAlign);
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
     * 配置設定
     */
    setAlign(align) {
        this.formatState.align = align;
        this.setAlignButtonState(align);
        this.sendFormatUpdate();
    }

    /**
     * 配置ボタン状態更新
     */
    setAlignButtonState(align) {
        document.getElementById('alignLeftBtn').classList.remove('active');
        document.getElementById('alignCenterBtn').classList.remove('active');
        document.getElementById('alignRightBtn').classList.remove('active');

        if (align === 'left') {
            document.getElementById('alignLeftBtn').classList.add('active');
        } else if (align === 'center') {
            document.getElementById('alignCenterBtn').classList.add('active');
        } else if (align === 'right') {
            document.getElementById('alignRightBtn').classList.add('active');
        }
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

        const lineStyle = document.getElementById('lineStyleSelect').value;
        const lineWidth = document.getElementById('lineWidthSelect').value;
        const lineColor = this.formatState.borderColor;

        this.sendToParent('calc-cell-format', {
            style: {
                border: {
                    type: type,
                    style: lineStyle,
                    width: parseInt(lineWidth),
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
}

// 操作パネルのインスタンスを作成
window.addEventListener('DOMContentLoaded', () => {
    window.calcToolPanel = new CalcToolPanel();
});
