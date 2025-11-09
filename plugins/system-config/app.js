/**
 * システム環境設定プラグイン
 */
class SystemConfigApp {
    constructor() {
        this.selectedBackground = null;
        this.dialogMessageId = 0; // ダイアログメッセージID
        this.dialogCallbacks = {}; // ダイアログコールバック管理
        this.realId = null; // 実身ID
        this.init();
    }

    init() {
        console.log('[SystemConfig] 初期化開始');

        // タブ切り替えイベント
        this.setupTabs();

        // 背景アップロードイベント
        this.setupBackgroundUpload();

        // 背景リスト読み込み
        this.loadBackgroundList();

        // バージョンリスト読み込み
        this.loadVersionList();

        // ボタンイベント
        this.setupButtons();

        // 現在の選択を読み込み
        this.loadCurrentSelection();

        // 親ウィンドウからのメッセージを受信
        this.setupMessageHandler();

        // 右クリックメニュー
        this.setupContextMenu();

        // ウィンドウアクティベーション
        this.setupWindowActivation();
    }

    setupMessageHandler() {
        window.addEventListener('message', (event) => {
            if (event.data && event.data.type === 'init') {
                // fileIdを保存（拡張子を除去）
                if (event.data.fileData) {
                    let rawId = event.data.fileData.realId || event.data.fileData.fileId;
                    this.realId = rawId ? rawId.replace(/_\d+\.xtad$/, '') : null;
                    console.log('[SystemConfig] fileId設定:', this.realId, '(元:', rawId, ')');
                }
            } else if (event.data && event.data.type === 'get-menu-definition') {
                // 編集メニューを返す
                window.parent.postMessage({
                    type: 'menu-definition-response',
                    messageId: event.data.messageId,
                    menuDefinition: [
                        {
                            text: '編集',
                            submenu: [
                                { text: '取消', action: 'undo' },
                                { text: 'クリップボードへコピー', action: 'copy', shortcut: 'Ctrl+C' },
                                { text: 'クリップボードからコピー', action: 'paste', shortcut: 'Ctrl+V' },
                                { text: 'クリップボードへ移動', action: 'cut', shortcut: 'Ctrl+X' },
                                { text: 'クリップボードから移動', action: 'redo', shortcut: 'Ctrl+Z' }
                            ]
                        }
                    ]
                }, '*');
            } else if (event.data && event.data.type === 'message-dialog-response') {
                // メッセージダイアログレスポンスを処理
                if (this.dialogCallbacks && this.dialogCallbacks[event.data.messageId]) {
                    this.dialogCallbacks[event.data.messageId](event.data.result);
                    delete this.dialogCallbacks[event.data.messageId];
                }
            } else if (event.data && event.data.type === 'menu-action') {
                // メニューアクションを処理
                this.handleMenuAction(event.data.action);
            } else if (event.data && event.data.type === 'window-moved') {
                // ウィンドウ移動終了時
                this.updateWindowConfig({
                    pos: event.data.pos,
                    width: event.data.width,
                    height: event.data.height
                });
            }
        });
    }

    handleMenuAction(action) {
        const activeElement = document.activeElement;

        switch (action) {
            case 'copy':
                document.execCommand('copy');
                break;
            case 'paste':
                document.execCommand('paste');
                break;
            case 'cut':
                document.execCommand('cut');
                break;
            case 'undo':
                document.execCommand('undo');
                break;
            case 'redo':
                document.execCommand('redo');
                break;
            case 'select-all':
                if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
                    activeElement.select();
                } else {
                    document.execCommand('selectAll');
                }
                break;
            case 'find-replace':
                // 検索/置換は未実装
                console.log('[SystemConfig] 検索/置換は未実装です');
                break;
        }
    }

    setupContextMenu() {
        // 右クリックメニューを親ウィンドウに委譲
        document.addEventListener('contextmenu', (e) => {
            e.preventDefault();

            // 親ウィンドウに座標を送信
            if (window.parent && window.parent !== window) {
                // iframeの位置を取得して座標を変換
                const rect = window.frameElement.getBoundingClientRect();

                window.parent.postMessage({
                    type: 'context-menu-request',
                    x: rect.left + e.clientX,
                    y: rect.top + e.clientY
                }, '*');
            }
        });

        // 左クリックでメニューを閉じる
        document.addEventListener('click', () => {
            if (window.parent && window.parent !== window) {
                window.parent.postMessage({
                    type: 'close-context-menu'
                }, '*');
            }
        });
    }

    setupWindowActivation() {
        document.addEventListener('mousedown', () => {
            if (window.parent && window.parent !== window) {
                window.parent.postMessage({
                    type: 'activate-window'
                }, '*');
            }
        });
    }

    setupTabs() {
        const tabs = document.querySelectorAll('.tab');
        const panels = document.querySelectorAll('.tab-panel');

        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const targetTab = tab.dataset.tab;

                // アクティブタブの切り替え
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                // パネルの切り替え
                panels.forEach(panel => {
                    panel.classList.remove('active');
                    if (panel.id === targetTab + '-panel') {
                        panel.classList.add('active');
                    }
                });
            });
        });

        // 画面タブのサブタブイベント設定
        const subTabs = document.querySelectorAll('.sub-tab');
        const subPanels = document.querySelectorAll('.sub-tab-panel');

        subTabs.forEach(subTab => {
            subTab.addEventListener('click', () => {
                const targetSubTab = subTab.dataset.subtab;

                // アクティブサブタブの切り替え
                subTabs.forEach(st => st.classList.remove('active'));
                subTab.classList.add('active');

                // サブパネルの切り替え
                subPanels.forEach(panel => {
                    panel.classList.remove('active');
                    if (panel.id === targetSubTab + '-panel') {
                        panel.classList.add('active');
                    }
                });
            });
        });
    }

    setupBackgroundUpload() {
        const uploadButton = document.getElementById('upload-button');
        const fileInput = document.getElementById('background-upload');

        uploadButton.addEventListener('click', () => {
            fileInput.click();
        });

        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file && file.type.startsWith('image/')) {
                this.addBackgroundImage(file);
            }
            fileInput.value = ''; // リセット
        });
    }

    async addBackgroundImage(file) {
        const reader = new FileReader();

        reader.onload = (e) => {
            const dataUrl = e.target.result;
            const bgId = 'bg-' + Date.now();

            // localStorageに保存
            const backgrounds = JSON.parse(localStorage.getItem('systemBackgrounds') || '[]');
            backgrounds.push({
                id: bgId,
                name: file.name,
                data: dataUrl
            });
            localStorage.setItem('systemBackgrounds', JSON.stringify(backgrounds));

            // リストに追加
            this.addBackgroundOption(bgId, file.name, dataUrl);

            console.log('[SystemConfig] 背景画像を追加しました:', file.name);
        };

        reader.readAsDataURL(file);
    }

    loadBackgroundList() {
        const backgrounds = JSON.parse(localStorage.getItem('systemBackgrounds') || '[]');
        console.log('[SystemConfig] 背景リスト読み込み:', backgrounds.length);

        // 「なし」オプションのクリックイベント
        const noneOption = document.querySelector('[data-bg="none"]');
        if (noneOption) {
            noneOption.addEventListener('click', () => {
                this.selectBackground('none');
            });
        }

        backgrounds.forEach(bg => {
            this.addBackgroundOption(bg.id, bg.name, bg.data);
        });
    }

    addBackgroundOption(id, name, dataUrl) {
        const list = document.getElementById('background-list');

        // 既存の要素をチェック
        if (document.querySelector(`[data-bg="${id}"]`)) {
            return;
        }

        const option = document.createElement('div');
        option.className = 'background-option';
        option.dataset.bg = id;

        // 削除ボタン付きのHTMLを設定（元のtadjs-desktop.jsと同じ形式）
        option.innerHTML = `
            <div class="bg-preview" style="background-image: url('${dataUrl}')"></div>
            <span>${name}</span>
            <button class="bg-delete" data-bg-id="${id}">×</button>
        `;

        // クリックで選択
        option.addEventListener('click', (e) => {
            if (e.target.classList.contains('bg-delete')) return;
            this.selectBackground(id);
        });

        // 削除ボタン
        const deleteBtn = option.querySelector('.bg-delete');
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.deleteBackground(id);
        });

        list.appendChild(option);
    }

    async deleteBackground(id) {
        const result = await this.showMessageDialog(
            'この背景画像を削除しますか？',
            [
                { label: '取り消し', value: 'cancel' },
                { label: '削　除', value: 'delete' }
            ],
            0  // デフォルトは取り消し
        );

        if (result !== 'delete') {
            return;
        }

        // localStorageから削除
        const backgrounds = JSON.parse(localStorage.getItem('systemBackgrounds') || '[]');
        const filtered = backgrounds.filter(bg => bg.id !== id);
        localStorage.setItem('systemBackgrounds', JSON.stringify(filtered));

        // DOMから削除
        const option = document.querySelector(`[data-bg="${id}"]`);
        if (option) {
            option.remove();
        }

        // 選択中だった場合はnoneに変更
        if (this.selectedBackground === id) {
            this.selectBackground('none');
        }

        console.log('[SystemConfig] 背景画像を削除しました:', id);
    }

    selectBackground(id) {
        // すべての選択を解除
        document.querySelectorAll('.background-option').forEach(opt => {
            opt.classList.remove('selected');
        });

        // 新しい選択をマーク
        const option = document.querySelector(`[data-bg="${id}"]`);
        if (option) {
            option.classList.add('selected');
            this.selectedBackground = id;
        }
    }

    loadCurrentSelection() {
        const currentBg = localStorage.getItem('selectedBackground') || 'none';
        this.selectBackground(currentBg);
    }

    /**
     * メッセージダイアログを表示
     * @param {string} message - 表示するメッセージ
     * @param {Array} buttons - ボタン定義配列
     * @param {number} defaultButton - デフォルトボタンのインデックス
     * @returns {Promise<any>} - 選択されたボタンの値
     */
    showMessageDialog(message, buttons, defaultButton = 0) {
        return new Promise((resolve) => {
            const messageId = ++this.dialogMessageId;

            // コールバックを登録
            this.dialogCallbacks[messageId] = (result) => {
                resolve(result);
            };

            // 親ウィンドウにダイアログ表示を要求
            window.parent.postMessage({
                type: 'show-message-dialog',
                messageId: messageId,
                message: message,
                buttons: buttons,
                defaultButton: defaultButton
            }, '*');
        });
    }

    setupButtons() {
        const applyButton = document.getElementById('apply-button');
        const cancelButton = document.getElementById('cancel-button');

        applyButton.addEventListener('click', () => {
            this.apply();
        });

        cancelButton.addEventListener('click', () => {
            this.cancel();
        });
    }

    apply() {
        // 選択された背景を保存
        if (this.selectedBackground) {
            localStorage.setItem('selectedBackground', this.selectedBackground);

            // 親ウィンドウに背景適用を通知
            if (window.parent && window.parent !== window) {
                window.parent.postMessage({
                    type: 'apply-background',
                    backgroundId: this.selectedBackground
                }, '*');
            }

            console.log('[SystemConfig] 設定を適用しました');
        }

        // ウィンドウを閉じる
        this.close();
    }

    cancel() {
        // 変更を破棄してウィンドウを閉じる
        this.close();
    }

    close() {
        // 親ウィンドウにウィンドウを閉じるよう通知
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: 'close-window'
            }, '*');
        }
    }

    async loadVersionList() {
        console.log('[SystemConfig] バージョンリスト読み込み');

        // 親ウィンドウからプラグイン情報を取得
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: 'get-plugin-list'
            }, '*');

            // レスポンスを待つ
            window.addEventListener('message', (event) => {
                if (event.data && event.data.type === 'plugin-list-response') {
                    this.renderVersionList(event.data.plugins);
                }
            });
        }
    }

    renderVersionList(plugins) {
        const list = document.getElementById('version-list');
        if (!list) return;

        list.innerHTML = '';

        // プラグイン情報を名前順にソート
        const sortedPlugins = [...plugins].sort((a, b) => {
            return a.name.localeCompare(b.name, 'ja');
        });

        // 各プラグインをリストに追加
        sortedPlugins.forEach(plugin => {
            const item = document.createElement('div');
            item.className = 'version-item';
            item.innerHTML = `
                <div class="version-item-name">${plugin.name}</div>
                <div class="version-item-version">${plugin.version || 'R 4.500'}</div>
            `;
            list.appendChild(item);
        });

        console.log('[SystemConfig] バージョンリスト表示完了:', sortedPlugins.length);
    }

    /**
     * ウィンドウ設定を更新
     * @param {Object} windowConfig - ウィンドウ設定
     */
    updateWindowConfig(windowConfig) {
        if (window.parent && window.parent !== window && this.realId) {
            window.parent.postMessage({
                type: 'update-window-config',
                fileId: this.realId,
                windowConfig: windowConfig
            }, '*');

            console.log('[SystemConfig] ウィンドウ設定を更新:', windowConfig);
        }
    }
}

// DOMContentLoaded後に初期化
document.addEventListener('DOMContentLoaded', () => {
    window.systemConfigApp = new SystemConfigApp();
});
