/**
 * システム環境設定プラグイン
 */
const logger = window.getLogger('SystemConfig');

class SystemConfigApp extends window.PluginBase {
    constructor() {
        super('SystemConfig');
        logger.info('[SystemConfig] 初期化開始');

        this.selectedBackground = null;
        // this.realId, this.messageBus は PluginBase で定義済み

        // MessageBus初期化
        if (window.MessageBus) {
            this.messageBus = new window.MessageBus({
                debug: false,
                pluginName: 'SystemConfig'
            });
            this.messageBus.start();
        }
        this.init();
    }

    init() {
        logger.info('[SystemConfig] 初期化開始');

        // MessageBusのハンドラを登録
        if (this.messageBus) {
            this.setupMessageBusHandlers();
        }

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

        // 右クリックメニュー
        this.setupContextMenu();

        // ウィンドウアクティベーション
        this.setupWindowActivation();
    }

    setupMessageBusHandlers() {
        // init メッセージ
        this.messageBus.on('init', (data) => {
            // fileIdを保存（拡張子を除去）
            if (data.fileData) {
                let rawId = data.fileData.realId || data.fileData.fileId;
                this.realId = rawId ? rawId.replace(/_\d+\.xtad$/, '') : null;
                logger.info('[SystemConfig] fileId設定:', this.realId, '(元:', rawId, ')');
            }
        });

        // get-menu-definition メッセージ
        this.messageBus.on('get-menu-definition', async (data) => {
            // 編集メニューを返す
            const menuDefinition = [
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
            ];
            this.messageBus.send('menu-definition-response', {
                messageId: data.messageId,
                menuDefinition: menuDefinition
            });
        });

        // menu-action メッセージ
        this.messageBus.on('menu-action', (data) => {
            this.handleMenuAction(data.action);
        });

        // window-moved メッセージ
        this.messageBus.on('window-moved', (data) => {
            this.updateWindowConfig({
                pos: data.pos,
                width: data.width,
                height: data.height
            });
        });

        // plugin-list-response メッセージ
        this.messageBus.on('plugin-list-response', (data) => {
            this.renderVersionList(data.plugins);
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
                logger.info('[SystemConfig] 検索/置換は未実装です');
                break;
        }
    }

    setupContextMenu() {
        // 右クリックメニューを親ウィンドウに委譲
        document.addEventListener('contextmenu', (e) => {
            e.preventDefault();

            // 親ウィンドウに座標を送信
            if (this.messageBus) {
                // iframeの位置を取得して座標を変換
                const rect = window.frameElement.getBoundingClientRect();

                this.messageBus.send('context-menu-request', {
                    x: rect.left + e.clientX,
                    y: rect.top + e.clientY
                });
            }
        });

        // 左クリックでメニューを閉じる
        document.addEventListener('click', () => {
            if (this.messageBus) {
                this.messageBus.send('close-context-menu', {});
            }
        });
    }

    setupWindowActivation() {
        document.addEventListener('mousedown', () => {
            if (this.messageBus) {
                this.messageBus.send('activate-window', {});
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

            logger.info('[SystemConfig] 背景画像を追加しました:', file.name);
        };

        reader.readAsDataURL(file);
    }

    loadBackgroundList() {
        const backgrounds = JSON.parse(localStorage.getItem('systemBackgrounds') || '[]');
        logger.info('[SystemConfig] 背景リスト読み込み:', backgrounds.length);

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
        const result = await new Promise((resolve) => {
            this.messageBus.sendWithCallback('show-message-dialog', {
                message: 'この背景画像を削除しますか？',
                buttons: [
                    { label: '取り消し', value: 'cancel' },
                    { label: '削　除', value: 'delete' }
                ],
                defaultButton: 0
            }, (response) => {
                // Dialog result is wrapped in response.result
                const dialogResult = response.result || response;
                if (dialogResult.error) {
                    logger.warn('[SystemConfig] ダイアログエラー:', dialogResult.error);
                    resolve('cancel');
                    return;
                }
                resolve(dialogResult);
            }, 30000);
        });

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

        logger.info('[SystemConfig] 背景画像を削除しました:', id);
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
            if (this.messageBus) {
                this.messageBus.send('apply-background', {
                    backgroundId: this.selectedBackground
                });
            }

            logger.info('[SystemConfig] 設定を適用しました');
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
        if (this.messageBus) {
            this.messageBus.send('close-window', {});
        }
    }

    async loadVersionList() {
        logger.info('[SystemConfig] バージョンリスト読み込み');

        // 親ウィンドウからプラグイン情報を取得
        this.messageBus.send('get-plugin-list', {});
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

        logger.info('[SystemConfig] バージョンリスト表示完了:', sortedPlugins.length);
    }

    /**
     * ウィンドウ設定を更新
     * @param {Object} windowConfig - ウィンドウ設定
     */
    updateWindowConfig(windowConfig) {
        if (this.messageBus && this.realId) {
            this.messageBus.send('update-window-config', {
                fileId: this.realId,
                windowConfig: windowConfig
            });

            logger.info('[SystemConfig] ウィンドウ設定を更新:', windowConfig);
        }
    }
}

// DOMContentLoaded後に初期化
document.addEventListener('DOMContentLoaded', () => {
    window.systemConfigApp = new SystemConfigApp();
});
