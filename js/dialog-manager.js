/**
 * DialogManager - ダイアログ管理クラス
 * TADjs Desktopのダイアログ表示・非表示を管理
 * @module DialogManager
 */

import { getLogger } from './logger.js';
import { UI_UPDATE_DELAY_MS } from './util.js';

const logger = getLogger('DialogManager');

export class DialogManager {
    /**
     * @param {Object} parentMessageBus - 親ウィンドウのMessageBus（オプション）
     */
    constructor(parentMessageBus = null) {
        this.parentMessageBus = parentMessageBus;
        logger.debug('DialogManager initialized');
    }

    /**
     * ダイアログ表示を全プラグインに通知
     */
    notifyDialogOpened() {
        if (this.parentMessageBus && typeof this.parentMessageBus.broadcast === 'function') {
            this.parentMessageBus.broadcast('parent-dialog-opened', {});
        }
    }

    /**
     * ダイアログ非表示を全プラグインに通知
     */
    notifyDialogClosed() {
        if (this.parentMessageBus && typeof this.parentMessageBus.broadcast === 'function') {
            this.parentMessageBus.broadcast('parent-dialog-closed', {});
        }
    }

    /**
     * ダイアログボタンを生成（共通処理）
     * @param {HTMLElement} container - ボタンコンテナ
     * @param {Array<{label: string, value: any}>} buttons - ボタン定義
     * @param {number} defaultButton - デフォルトボタンインデックス
     * @param {Function} onButtonClick - クリック時コールバック (value) => void
     * @returns {HTMLElement[]} 生成されたボタン要素の配列
     */
    createDialogButtons(container, buttons, defaultButton, onButtonClick) {
        container.innerHTML = '';
        const buttonElements = [];

        buttons.forEach((buttonDef, index) => {
            const button = document.createElement('button');
            button.className = 'dialog-button';
            button.textContent = buttonDef.label;
            button.dataset.value = JSON.stringify(buttonDef.value);
            button.dataset.index = index;

            if (index === defaultButton) {
                button.classList.add('default');
            }

            button.addEventListener('click', () => {
                onButtonClick(buttonDef.value);
            });

            container.appendChild(button);
            buttonElements.push(button);
        });

        return buttonElements;
    }

    /**
     * ダイアログ用キーボードハンドラを設定（共通処理）
     * @param {HTMLElement} container - ボタンコンテナ
     * @param {number} defaultButton - デフォルトボタンインデックス
     * @param {Function} onSelect - ボタン選択時コールバック (value) => void
     * @returns {Function} 削除用のハンドラ関数
     */
    setupDialogKeyboardHandler(container, defaultButton, onSelect) {
        const handleKeyDown = (e) => {
            const buttons = Array.from(container.querySelectorAll('.dialog-button'));
            if (buttons.length === 0) return;

            const focusedElement = document.activeElement;
            const currentIndex = buttons.indexOf(focusedElement);

            switch (e.key) {
                case 'Tab':
                    // ボタンにフォーカスがある場合のみTab制御
                    if (currentIndex >= 0) {
                        e.preventDefault();
                        if (buttons.length > 1) {
                            let nextIndex;
                            if (e.shiftKey) {
                                // Shift+Tab: 前へ
                                nextIndex = currentIndex <= 0 ? buttons.length - 1 : currentIndex - 1;
                            } else {
                                // Tab: 次へ
                                nextIndex = currentIndex >= buttons.length - 1 ? 0 : currentIndex + 1;
                            }
                            buttons[nextIndex].focus();
                        }
                    }
                    break;

                case 'Enter':
                    // フォーカス中のボタンがあればそれを実行、なければデフォルトボタン
                    if (focusedElement && focusedElement.classList.contains('dialog-button')) {
                        e.preventDefault();
                        const value = JSON.parse(focusedElement.dataset.value);
                        onSelect(value);
                    } else if (buttons[defaultButton]) {
                        e.preventDefault();
                        const value = JSON.parse(buttons[defaultButton].dataset.value);
                        onSelect(value);
                    }
                    break;
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return handleKeyDown;
    }

    /**
     * メッセージダイアログを表示
     * @param {string} message - 表示するメッセージ
     * @param {Array<{label: string, value: any}>} buttons - ボタン定義の配列
     * @param {number} defaultButton - デフォルトボタンのインデックス (0始まり)
     * @returns {Promise<any>} - 選択されたボタンの値
     */
    showMessageDialog(message, buttons, defaultButton = 0) {
        return new Promise((resolve) => {
            const overlay = document.getElementById('dialog-overlay');
            const dialog = document.getElementById('message-dialog');
            const messageText = document.getElementById('dialog-message-text');
            const buttonsContainer = document.getElementById('dialog-message-buttons');

            // メッセージを設定
            messageText.textContent = message;

            // キーボードハンドラ参照用
            let keyboardHandler = null;

            // ダイアログを閉じて結果を返す共通処理
            const closeAndResolve = (value) => {
                if (keyboardHandler) {
                    document.removeEventListener('keydown', keyboardHandler);
                }
                this.hideMessageDialog();
                resolve(value);
            };

            // 共通処理でボタンを作成
            const buttonElements = this.createDialogButtons(
                buttonsContainer,
                buttons,
                defaultButton,
                closeAndResolve
            );

            // 共通処理でキーボードハンドラを設定（Tab/Enter対応）
            keyboardHandler = this.setupDialogKeyboardHandler(
                buttonsContainer,
                defaultButton,
                closeAndResolve
            );

            // プラグインにダイアログ表示を通知
            this.notifyDialogOpened();

            // ダイアログを表示
            overlay.style.display = 'block';
            dialog.style.display = 'block';

            // デフォルトボタンにフォーカス
            if (buttonElements[defaultButton]) {
                buttonElements[defaultButton].focus();
            }
        });
    }

    /**
     * メッセージダイアログを非表示にする
     */
    hideMessageDialog() {
        const overlay = document.getElementById('dialog-overlay');
        const dialog = document.getElementById('message-dialog');
        overlay.style.display = 'none';
        dialog.style.display = 'none';
        // プラグインにダイアログ非表示を通知
        this.notifyDialogClosed();
    }

    /**
     * 入力ダイアログを表示
     * @param {string} message - 表示するメッセージ
     * @param {string} defaultValue - 入力欄のデフォルト値
     * @param {number} inputWidth - 入力欄の幅（文字数）
     * @param {Array<{label: string, value: any}>} buttons - ボタン定義の配列
     * @param {number} defaultButton - デフォルトボタンのインデックス (0始まり)
     * @param {Object} options - オプション
     * @param {boolean} options.colorPicker - カラーピッカーを表示するかどうか
     * @param {Object} options.checkbox - チェックボックス設定 { label: string, checked: boolean }
     * @returns {Promise<{button: any, value: string, checkbox: boolean}>} - 選択されたボタン、入力値、チェックボックス状態
     */
    showInputDialog(message, defaultValue = '', inputWidth = window.DEFAULT_INPUT_WIDTH, buttons = [{ label: '取消', value: 'cancel' }, { label: 'OK', value: 'ok' }], defaultButton = 1, options = {}) {
        logger.info('[DialogManager] showInputDialog called:', { message, defaultValue, inputWidth });

        return new Promise((resolve) => {
            const overlay = document.getElementById('dialog-overlay');
            const dialog = document.getElementById('input-dialog');
            const messageText = document.getElementById('input-dialog-message');
            const inputField = document.getElementById('dialog-input-field');
            const buttonsContainer = document.getElementById('input-dialog-buttons');

            logger.info('[DialogManager] DOM elements:', {
                hasOverlay: !!overlay,
                hasDialog: !!dialog,
                hasMessageText: !!messageText,
                hasInputField: !!inputField,
                hasButtonsContainer: !!buttonsContainer
            });

            if (!overlay || !dialog || !messageText || !inputField || !buttonsContainer) {
                logger.error('[DialogManager] Missing required DOM elements!');
                resolve({ button: 'cancel', value: '', checkbox: false });
                return;
            }

            // メッセージを設定
            messageText.textContent = message;

            // 入力欄を設定
            inputField.value = defaultValue;
            inputField.style.width = `${inputWidth}ch`;
            inputField.select();

            // 既存のチェックボックスを削除
            const existingCheckbox = document.getElementById('dialog-checkbox-container');
            if (existingCheckbox) {
                existingCheckbox.remove();
            }

            // チェックボックスオプションが有効な場合
            let checkboxElement = null;
            if (options.checkbox && options.checkbox.label) {
                const container = document.createElement('div');
                container.id = 'dialog-checkbox-container';
                container.className = 'dialog-checkbox-container';

                const label = document.createElement('label');
                checkboxElement = document.createElement('input');
                checkboxElement.type = 'checkbox';
                checkboxElement.id = 'dialog-checkbox';
                checkboxElement.checked = options.checkbox.checked || false;

                const labelText = document.createTextNode(options.checkbox.label);
                label.appendChild(checkboxElement);
                label.appendChild(labelText);
                container.appendChild(label);

                // メッセージの後、入力欄の前に挿入
                inputField.parentNode.insertBefore(container, inputField);
            }

            // 既存のカラーピッカーを削除
            const existingColorPicker = document.getElementById('dialog-color-picker');
            if (existingColorPicker) {
                existingColorPicker.remove();
            }

            // カラーピッカーオプションが有効な場合
            let colorPicker = null;
            if (options.colorPicker) {
                colorPicker = document.createElement('input');
                colorPicker.type = 'color';
                colorPicker.id = 'dialog-color-picker';
                colorPicker.className = 'dialog-color-picker';
                // デフォルト値が有効なカラーコードでない場合は黒をセット
                colorPicker.value = /^#[0-9A-Fa-f]{6}$/.test(defaultValue) ? defaultValue : '#000000';
                inputField.parentNode.insertBefore(colorPicker, inputField.nextSibling);

                // カラーピッカー→テキスト入力の同期
                colorPicker.addEventListener('input', () => {
                    inputField.value = colorPicker.value;
                });
                // テキスト入力→カラーピッカーの同期
                inputField.addEventListener('input', () => {
                    if (/^#[0-9A-Fa-f]{6}$/.test(inputField.value)) {
                        colorPicker.value = inputField.value;
                    }
                });
            }

            // 結果を生成する関数
            const getResult = (buttonValue) => {
                return {
                    button: buttonValue,
                    value: inputField.value,
                    checkbox: checkboxElement ? checkboxElement.checked : false
                };
            };

            // キーボードハンドラ参照用
            let keyboardHandler = null;

            // ダイアログを閉じて結果を返す共通処理
            const closeAndResolve = (buttonValue) => {
                if (keyboardHandler) {
                    document.removeEventListener('keydown', keyboardHandler);
                }
                this.hideInputDialog();
                resolve(getResult(buttonValue));
            };

            // 共通処理でボタンを作成
            this.createDialogButtons(
                buttonsContainer,
                buttons,
                defaultButton,
                closeAndResolve
            );

            // 共通処理でキーボードハンドラを設定（Tab/Enter対応）
            keyboardHandler = this.setupDialogKeyboardHandler(
                buttonsContainer,
                defaultButton,
                closeAndResolve
            );

            // プラグインにダイアログ表示を通知
            this.notifyDialogOpened();

            // ダイアログを表示
            overlay.style.display = 'block';
            dialog.style.display = 'block';

            // 入力欄にフォーカス（入力ダイアログは入力欄を最初にフォーカス）
            setTimeout(() => {
                inputField.focus();
                inputField.select();
             }, UI_UPDATE_DELAY_MS);
        });
    }

    /**
     * 入力ダイアログを非表示にする
     */
    hideInputDialog() {
        const overlay = document.getElementById('dialog-overlay');
        const dialog = document.getElementById('input-dialog');
        overlay.style.display = 'none';
        // プラグインにダイアログ非表示を通知
        this.notifyDialogClosed();
        dialog.style.display = 'none';
    }

    /**
     * カスタムダイアログを表示
     * @param {string} dialogHtml - ダイアログ内に表示するHTML
     * @param {Array<{label: string, value: any}>} buttons - ボタン定義の配列
     * @param {number} defaultButton - デフォルトボタンのインデックス (0始まり)
     * @param {Object} inputs - 入力要素のID {checkbox: 'id1', text: 'id2', radios: {key: 'radioName'}}
     * @returns {Promise<{button: any, checkbox: boolean, input: string, radios: Object, inputs: Object, dialogElement: Element}>}
     */
    showCustomDialog(dialogHtml, buttons, defaultButton = 0, inputs = {}) {
        return new Promise((resolve) => {
            const overlay = document.getElementById('dialog-overlay');
            const dialog = document.getElementById('input-dialog');
            const messageText = document.getElementById('input-dialog-message');
            const buttonsContainer = document.getElementById('input-dialog-buttons');

            // showInputDialogで追加された要素をクリア
            const existingCheckbox = document.getElementById('dialog-checkbox-container');
            if (existingCheckbox) {
                existingCheckbox.remove();
            }
            const existingColorPicker = document.getElementById('dialog-color-picker');
            if (existingColorPicker) {
                existingColorPicker.remove();
            }

            // カスタムHTMLを設定
            messageText.innerHTML = dialogHtml;

            // innerHTML で挿入された script タグは実行されないため、手動で実行
            // DOM要素が準備された後に実行するため setTimeout を使用
            const scripts = messageText.querySelectorAll('script');
            scripts.forEach(script => {
                const scriptContent = script.textContent;
                script.remove();
                setTimeout(() => {
                    try {
                        eval(scriptContent);
                    } catch (e) {
                        console.error('ダイアログスクリプト実行エラー:', e);
                    }
                }, 0);
            });

            // フォームデータ収集関数（共通化）
            const collectFormData = () => {
                let checkboxValue = false;
                let textValue = '';
                let radiosValue = {};

                if (inputs.checkbox) {
                    const checkboxElement = document.getElementById(inputs.checkbox);
                    if (checkboxElement) {
                        checkboxValue = checkboxElement.checked;
                    }
                }

                if (inputs.text) {
                    const textElement = document.getElementById(inputs.text);
                    if (textElement) {
                        textValue = textElement.value;
                    }
                }

                // ラジオボタンの値を取得
                if (inputs.radios) {
                    for (const [key, radioName] of Object.entries(inputs.radios)) {
                        const radioElement = messageText.querySelector(`input[name="${radioName}"]:checked`);
                        if (radioElement) {
                            radiosValue[key] = radioElement.value;
                        }
                    }
                }

                // ダイアログ内の全入力要素を自動収集 (formData)
                const formData = {};
                // テキスト入力、数値入力
                messageText.querySelectorAll('input[id][type="text"], input[id][type="number"], input[id]:not([type])').forEach(el => {
                    formData[el.id] = el.value;
                });
                // セレクトボックス
                messageText.querySelectorAll('select[id]').forEach(el => {
                    formData[el.id] = el.value;
                });
                // チェックボックス
                messageText.querySelectorAll('input[id][type="checkbox"]').forEach(el => {
                    formData[el.id] = el.checked;
                });
                // ラジオボタン (name属性でグループ化)
                const radioNames = new Set();
                messageText.querySelectorAll('input[type="radio"][name]').forEach(el => {
                    radioNames.add(el.name);
                });
                radioNames.forEach(name => {
                    const checked = messageText.querySelector(`input[type="radio"][name="${name}"]:checked`);
                    if (checked) {
                        formData[name] = checked.value;
                    }
                });

                // ダイアログ要素への参照を保持
                const dialogElement = messageText.cloneNode(true);

                return {
                    checkbox: checkboxValue,
                    input: textValue,
                    radios: radiosValue,
                    inputs: { columnCount: textValue },
                    formData: formData,
                    dialogElement: dialogElement
                };
            };

            // キーボードハンドラ参照用
            let keyboardHandler = null;

            // ダイアログを閉じて結果を返す共通処理
            const closeAndResolve = (buttonValue) => {
                if (keyboardHandler) {
                    document.removeEventListener('keydown', keyboardHandler);
                }
                const formData = collectFormData();
                this.hideInputDialog();
                resolve({
                    button: buttonValue,
                    ...formData
                });
            };

            // 共通処理でボタンを作成
            this.createDialogButtons(
                buttonsContainer,
                buttons,
                defaultButton,
                closeAndResolve
            );

            // 共通処理でキーボードハンドラを設定（Tab/Enter対応）
            keyboardHandler = this.setupDialogKeyboardHandler(
                buttonsContainer,
                defaultButton,
                closeAndResolve
            );

            // プラグインにダイアログ表示を通知
            this.notifyDialogOpened();

            // ダイアログを表示
            overlay.style.display = 'block';
            dialog.style.display = 'block';

            // テキスト入力欄があればフォーカス
            if (inputs.text) {
                setTimeout(() => {
                    const textElement = document.getElementById(inputs.text);
                    if (textElement) {
                        textElement.focus();
                        textElement.select();
                    }
                 }, UI_UPDATE_DELAY_MS);
            }
        });
    }

    /**
     * 仮身属性ダイアログのHTML生成
     * @param {Object} attrs - 仮身属性
     * @param {string} selectedRatio - 選択中の文字サイズ倍率ラベル
     * @returns {string} ダイアログHTML
     */
    createVirtualObjectAttributesDialogHtml(attrs, selectedRatio) {
        return `
            <div class="vobj-attr-dialog">
                <div class="vobj-attr-title">
                    仮身属性変更
                </div>
                <div class="vobj-attr-grid">
                    <!-- 左側: 表示項目 -->
                    <div>
                        <div class="vobj-attr-section-title">表示項目：</div>
                        <label class="vobj-attr-checkbox-label">
                            <input type="checkbox" id="pictdisp" ${attrs.pictdisp ? 'checked' : ''}> <span>ピクトグラム</span>
                        </label>
                        <label class="vobj-attr-checkbox-label">
                            <input type="checkbox" id="namedisp" ${attrs.namedisp ? 'checked' : ''}> <span>名称</span>
                        </label>
                        <label class="vobj-attr-checkbox-label">
                            <input type="checkbox" id="roledisp" ${attrs.roledisp ? 'checked' : ''}> <span>続柄</span>
                        </label>
                        <label class="vobj-attr-checkbox-label">
                            <input type="checkbox" id="typedisp" ${attrs.typedisp ? 'checked' : ''}> <span>タイプ</span>
                        </label>
                        <label class="vobj-attr-checkbox-label">
                            <input type="checkbox" id="updatedisp" ${attrs.updatedisp ? 'checked' : ''}> <span>更新日時</span>
                        </label>
                        <label class="vobj-attr-checkbox-label">
                            <input type="checkbox" id="framedisp" ${attrs.framedisp ? 'checked' : ''}> <span>仮身枠</span>
                        </label>
                    </div>

                    <!-- 中央: 色 -->
                    <div>
                        <div class="vobj-attr-section-title">色：</div>
                        <label class="vobj-attr-color-label">
                            <span>枠</span>
                            <input type="text" id="frcol" value="${attrs.frcol}" class="vobj-attr-color-input">
                            <input type="color" id="frcol-picker" value="${attrs.frcol}" class="vobj-attr-color-picker">
                        </label>
                        <label class="vobj-attr-color-label">
                            <span>仮身文字</span>
                            <input type="text" id="chcol" value="${attrs.chcol}" class="vobj-attr-color-input">
                            <input type="color" id="chcol-picker" value="${attrs.chcol}" class="vobj-attr-color-picker">
                        </label>
                        <label class="vobj-attr-color-label">
                            <span>仮身背景</span>
                            <input type="text" id="tbcol" value="${attrs.tbcol}" class="vobj-attr-color-input">
                            <input type="color" id="tbcol-picker" value="${attrs.tbcol}" class="vobj-attr-color-picker">
                        </label>
                        <label class="vobj-attr-color-label last">
                            <span>表示領域背景</span>
                            <input type="text" id="bgcol" value="${attrs.bgcol}" class="vobj-attr-color-input">
                            <input type="color" id="bgcol-picker" value="${attrs.bgcol}" class="vobj-attr-color-picker">
                        </label>
                        <label class="vobj-attr-checkbox-label">
                            <input type="checkbox" id="autoopen" ${attrs.autoopen ? 'checked' : ''}> <span>自動起動</span>
                        </label>
                    </div>

                    <!-- 右側: 文字サイズ -->
                    <div>
                        <label class="vobj-attr-size-label">
                            <span class="vobj-attr-section-title" style="display: inline;">文字サイズ：</span>
                            <select id="chszSelect" class="vobj-attr-select">
                                <option value="0.5" ${selectedRatio === '1/2倍' ? 'selected' : ''}>1/2倍</option>
                                <option value="0.75" ${selectedRatio === '3/4倍' ? 'selected' : ''}>3/4倍</option>
                                <option value="1.0" ${selectedRatio === '標準' ? 'selected' : ''}>標準</option>
                                <option value="1.5" ${selectedRatio === '3/2倍' ? 'selected' : ''}>3/2倍</option>
                                <option value="2.0" ${selectedRatio === '2倍' ? 'selected' : ''}>2倍</option>
                                <option value="3.0" ${selectedRatio === '3倍' ? 'selected' : ''}>3倍</option>
                                <option value="4.0" ${selectedRatio === '4倍' ? 'selected' : ''}>4倍</option>
                            </select>
                        </label>
                        <label class="vobj-attr-custom-label">
                            <span>自由入力</span>
                            <input type="number" id="chszCustom" step="1" min="1" value="${attrs.chsz}"
                                   class="vobj-attr-custom-input">
                        </label>
                    </div>
                </div>
            </div>
            <script>
                // 文字サイズの選択ドロップダウンと自由入力を同期
                const chszSelect = document.getElementById('chszSelect');
                const chszCustom = document.getElementById('chszCustom');
                const baseFontSize = 14; // BTRONの標準文字サイズ

                // ドロップダウン変更時: 倍率をピクセル値に変換
                chszSelect.addEventListener('change', () => {
                    const ratio = parseFloat(chszSelect.value);
                    chszCustom.value = Math.round(baseFontSize * ratio);
                });

                // 自由入力変更時: ピクセル値を倍率に逆変換してドロップダウンを更新
                chszCustom.addEventListener('input', () => {
                    const pixelValue = parseInt(chszCustom.value);
                    const ratio = pixelValue / baseFontSize;
                    const options = chszSelect.options;
                    let matched = false;
                    for (let i = 0; i < options.length; i++) {
                        if (Math.abs(parseFloat(options[i].value) - ratio) < 0.01) {
                            chszSelect.selectedIndex = i;
                            matched = true;
                            break;
                        }
                    }
                    if (!matched) {
                        chszSelect.selectedIndex = -1; // 該当する倍率がない場合は選択解除
                    }
                });

                // カラーピッカーとテキスト入力の同期
                const colorFields = ['frcol', 'chcol', 'tbcol', 'bgcol'];
                colorFields.forEach(fieldId => {
                    const textInput = document.getElementById(fieldId);
                    const colorPicker = document.getElementById(fieldId + '-picker');
                    if (textInput && colorPicker) {
                        // カラーピッカー変更時: テキスト入力を更新
                        colorPicker.addEventListener('input', () => {
                            textInput.value = colorPicker.value;
                        });
                        // テキスト入力変更時: 有効なカラーコードならカラーピッカーを更新
                        textInput.addEventListener('input', () => {
                            if (/^#[0-9A-Fa-f]{6}$/.test(textInput.value)) {
                                colorPicker.value = textInput.value;
                            }
                        });
                    }
                });
            </script>
        `;
    }

    /**
     * ダイアログから仮身属性を抽出
     * @param {Element} dialogElement - ダイアログ要素
     * @returns {Object} 仮身属性オブジェクト
     */
    extractVirtualObjectAttributesFromDialog(dialogElement) {
        const chszValue = parseInt(dialogElement.querySelector('#chszCustom').value) || 14;

        return {
            pictdisp: dialogElement.querySelector('#pictdisp').checked,
            namedisp: dialogElement.querySelector('#namedisp').checked,
            roledisp: dialogElement.querySelector('#roledisp').checked,
            typedisp: dialogElement.querySelector('#typedisp').checked,
            updatedisp: dialogElement.querySelector('#updatedisp').checked,
            framedisp: dialogElement.querySelector('#framedisp').checked,
            frcol: dialogElement.querySelector('#frcol').value,
            chcol: dialogElement.querySelector('#chcol').value,
            tbcol: dialogElement.querySelector('#tbcol').value,
            bgcol: dialogElement.querySelector('#bgcol').value,
            autoopen: dialogElement.querySelector('#autoopen').checked,
            chsz: chszValue
        };
    }
}
