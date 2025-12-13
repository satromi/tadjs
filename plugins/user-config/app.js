/**
 * ユーザ環境設定プラグイン
 * @module UserConfig
 * @extends PluginBase
 * @license MIT
 * @author satromi
 * @version 1.0.0
 */
const logger = window.getLogger('UserConfig');

class UserConfigApp extends window.PluginBase {
    constructor() {
        super('UserConfig');
        logger.info('[UserConfig] 初期化開始');

        this.timeUpdateInterval = null;
        this.dataFolderChanged = false; // データフォルダが変更されたかどうか
        // this.realId, this.messageBus は PluginBase で定義済み

        // MessageBus初期化
        if (window.MessageBus) {
            this.messageBus = new window.MessageBus({
                debug: false,
                pluginName: 'UserConfig'
            });
            this.messageBus.start();
        }
        this.init();
    }

    init() {
        logger.info('[UserConfig] 初期化開始');

        // MessageBusのハンドラを登録
        if (this.messageBus) {
            this.setupMessageBusHandlers();
        }

        // タブ切り替えイベント
        this.setupTabs();

        // ボタンイベント
        this.setupButtons();

        // 時刻更新
        this.startTimeUpdater();

        // 右クリックメニュー
        this.setupContextMenu();

        // ウィンドウアクティベーション
        this.setupWindowActivation();

        // 設定を読み込み
        this.loadConfig();
    }

    /**
     * sendWithCallbackをPromiseでラップするヘルパーメソッド
     * @param {string} type - メッセージタイプ
     * @param {Object} data - 送信データ
     * @param {number} timeout - タイムアウト（ミリ秒）
     * @returns {Promise<Object>} レスポンスデータ
     */
    sendWithCallbackAsync(type, data = {}, timeout = 5000) {
        return new Promise((resolve, reject) => {
            this.messageBus.sendWithCallback(type, data, (result) => {
                if (result.error) {
                    reject(new Error(result.error));
                } else {
                    resolve(result);
                }
            }, timeout);
        });
    }

    setupMessageBusHandlers() {
        // init メッセージ
        this.messageBus.on('init', (data) => {
            // MessageBusにwindowIdを設定（レスポンスルーティング用）
            if (data.windowId) {
                this.messageBus.setWindowId(data.windowId);
            }

            // fileIdを保存（拡張子を除去）
            if (data.fileData) {
                let rawId = data.fileData.realId || data.fileData.fileId;
                this.realId = rawId ? rawId.replace(/_\d+\.xtad$/, '') : null;
                logger.info('[UserConfig] fileId設定:', this.realId, '(元:', rawId, ')');
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
                logger.info('[UserConfig] 検索/置換は未実装です');
                break;
        }
    }

    // setupContextMenu() と setupWindowActivation() は PluginBase 共通メソッドを使用

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
    }

    setupButtons() {
        const applyButton = document.getElementById('apply-button');
        const cancelButton = document.getElementById('cancel-button');
        const kanaKanjiButton = document.getElementById('kana-kanji-button');
        const selectFolderButton = document.getElementById('select-folder-button');

        applyButton.addEventListener('click', () => {
            this.apply();
        });

        cancelButton.addEventListener('click', () => {
            this.cancel();
        });

        kanaKanjiButton.addEventListener('click', () => {
            this.messageBus.sendWithCallback('show-message-dialog', {
                message: 'かな漢字変換設定は未実装です',
                buttons: [
                    { label: '了　解', value: 'ok' }
                ],
                defaultButton: 0
            }, (result) => {
                if (result.error) {
                    logger.warn('[UserConfig] Message dialog error:', result.error);
                }
                // 結果は特に使用しない
            });
        });

        if (selectFolderButton) {
            selectFolderButton.addEventListener('click', () => {
                this.selectDataFolder();
            });
        }

        // 表示属性のスライダーと数値入力の連動
        this.setupDisplaySliders();

        // 表示属性のボタングループ
        this.setupSizeButtons();
    }

    setupDisplaySliders() {
        const sliders = [
            { slider: 'title-font-size', number: 'title-font-size-num' },
            { slider: 'scrollbar-width', number: 'scrollbar-width-num' },
            { slider: 'menu-font-size', number: 'menu-font-size-num' },
            { slider: 'cursor-blink', number: 'cursor-blink-num' },
            { slider: 'selection-blink', number: 'selection-blink-num' },
            { slider: 'menu-delay', number: 'menu-delay-num' }
        ];

        sliders.forEach(({ slider, number }) => {
            const sliderElem = document.getElementById(slider);
            const numberElem = document.getElementById(number);

            if (sliderElem && numberElem) {
                // スライダー変更時
                sliderElem.addEventListener('input', (e) => {
                    numberElem.value = e.target.value;
                });

                // 数値入力変更時
                numberElem.addEventListener('input', (e) => {
                    const value = parseInt(e.target.value);
                    if (!isNaN(value)) {
                        sliderElem.value = value;
                    }
                });
            }
        });
    }

    setupSizeButtons() {
        const buttonGroups = document.querySelectorAll('.button-group');

        buttonGroups.forEach(group => {
            const buttons = group.querySelectorAll('.size-button');
            buttons.forEach(button => {
                button.addEventListener('click', () => {
                    // 同じグループ内の他のボタンの active を外す
                    buttons.forEach(b => b.classList.remove('active'));
                    // クリックされたボタンに active を付ける
                    button.classList.add('active');
                });
            });
        });
    }

    startTimeUpdater() {
        const updateTime = () => {
            const timeElement = document.getElementById('current-time');
            if (timeElement) {
                const currentTime = new Date().toLocaleString('ja-JP', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                });
                timeElement.textContent = currentTime;
            }
        };

        // 初回実行
        updateTime();

        // 1秒ごとに時刻を更新
        this.timeUpdateInterval = setInterval(updateTime, 1000);
    }

    loadConfig() {
        const username = localStorage.getItem('username') || 'TRON User';
        const inputMethod = localStorage.getItem('inputMethod') || 'romaji';

        const usernameInput = document.getElementById('username');
        const inputMethodSelect = document.getElementById('input-method');

        if (usernameInput) {
            usernameInput.value = username;
        }

        if (inputMethodSelect) {
            inputMethodSelect.value = inputMethod;
        }

        // 表示属性の読み込み
        this.loadDisplayConfig();

        // データフォルダの読み込み
        this.loadDataFolderConfig();
    }

    loadDisplayConfig() {
        // スライダー設定
        const sliderDefaults = {
            'title-font-size': 14,
            'scrollbar-width': 12,
            'menu-font-size': 14,
            'cursor-blink': 800,
            'selection-blink': 600,
            'menu-delay': 200
        };

        Object.entries(sliderDefaults).forEach(([id, defaultValue]) => {
            const value = localStorage.getItem(id) || defaultValue;
            const sliderElem = document.getElementById(id);
            const numberElem = document.getElementById(id + '-num');

            if (sliderElem) sliderElem.value = value;
            if (numberElem) numberElem.value = value;
        });

        // ボタン設定
        const buttonDefaults = {
            'cursor-width': '1',
            'pointer-size': 'small',
            'selection-width': '1'
        };

        Object.entries(buttonDefaults).forEach(([setting, defaultValue]) => {
            const value = localStorage.getItem(setting) || defaultValue;
            const buttons = document.querySelectorAll(`[data-setting="${setting}"]`);
            buttons.forEach(button => {
                if (button.dataset.value === value) {
                    button.classList.add('active');
                } else {
                    button.classList.remove('active');
                }
            });
        });
    }

    async apply() {
        const usernameInput = document.getElementById('username');
        const inputMethodSelect = document.getElementById('input-method');

        const username = usernameInput?.value || 'TRON User';
        const inputMethod = inputMethodSelect?.value || 'romaji';

        // LocalStorageに保存
        localStorage.setItem('username', username);
        localStorage.setItem('inputMethod', inputMethod);

        // 表示属性を保存
        this.saveDisplayConfig();

        // データフォルダを保存
        await this.saveDataFolder();

        logger.info('[UserConfig] 設定を適用しました:', { username, inputMethod });

        // 親ウィンドウに設定適用を通知
        if (this.messageBus) {
            this.messageBus.send('apply-user-config', {});
        }

        // ウィンドウを閉じる
        this.close();
    }

    saveDisplayConfig() {
        // スライダー設定を保存
        const sliderIds = [
            'title-font-size',
            'scrollbar-width',
            'menu-font-size',
            'cursor-blink',
            'selection-blink',
            'menu-delay'
        ];

        sliderIds.forEach(id => {
            const elem = document.getElementById(id);
            if (elem) {
                localStorage.setItem(id, elem.value);
            }
        });

        // ボタン設定を保存
        const settings = ['cursor-width', 'pointer-size', 'selection-width'];
        settings.forEach(setting => {
            const activeButton = document.querySelector(`[data-setting="${setting}"].active`);
            if (activeButton) {
                localStorage.setItem(setting, activeButton.dataset.value);
            }
        });
    }

    cancel() {
        // 変更を破棄してウィンドウを閉じる
        this.close();
    }

    close() {
        // タイマーをクリア
        if (this.timeUpdateInterval) {
            clearInterval(this.timeUpdateInterval);
            this.timeUpdateInterval = null;
        }

        // 親ウィンドウにウィンドウを閉じるよう通知
        if (this.messageBus) {
            this.messageBus.send('close-window', {});
        }
    }

    /**
     * フォルダ選択ダイアログを開く
     */
    async selectDataFolder() {
        try {
            // 親ウィンドウにフォルダ選択ダイアログを要求
            const result = await this.sendWithCallbackAsync('open-folder-dialog', {});

            if (result && result.folderPath) {
                // フォルダアクセス権限をチェック
                const accessCheck = await this.sendWithCallbackAsync('check-folder-access', {
                    folderPath: result.folderPath
                });

                if (accessCheck.success) {
                    // 表示を更新
                    const folderDisplay = document.getElementById('folder-path-display');
                    if (folderDisplay) {
                        folderDisplay.textContent = result.folderPath;
                        folderDisplay.classList.remove('not-set');
                    }
                    // フォルダが変更されたフラグを設定
                    this.dataFolderChanged = true;
                    logger.info('[UserConfig] データフォルダ変更フラグを設定:', this.dataFolderChanged);
                } else {
                    // エラーダイアログを表示
                    await this.sendWithCallbackAsync('show-message-dialog', {
                        message: `フォルダへのアクセスに失敗しました:\n${accessCheck.error}`,
                        buttons: [
                            { label: '了　解', value: 'ok' }
                        ],
                        defaultButton: 0
                    });
                }
            }
        } catch (error) {
            logger.error('[UserConfig] フォルダ選択エラー:', error);
        }
    }

    /**
     * データフォルダ設定を読み込む
     */
    async loadDataFolderConfig() {
        try {
            const result = await this.sendWithCallbackAsync('get-data-folder', {});

            const folderDisplay = document.getElementById('folder-path-display');
            if (folderDisplay && result && result.dataFolder) {
                folderDisplay.textContent = result.dataFolder;
                folderDisplay.classList.remove('not-set');
            } else if (folderDisplay) {
                logger.warn('[UserConfig] データフォルダが取得できませんでした');
                folderDisplay.textContent = '未設定';
                folderDisplay.classList.add('not-set');
            }
        } catch (error) {
            logger.error('[UserConfig] データフォルダ設定の読み込みに失敗:', error);
            // エラー時も「未設定」と表示
            const folderDisplay = document.getElementById('folder-path-display');
            if (folderDisplay) {
                folderDisplay.textContent = '未設定';
                folderDisplay.classList.add('not-set');
            }
        }
    }

    /**
     * データフォルダを保存
     */
    async saveDataFolder() {
        logger.info('[UserConfig] saveDataFolder呼び出し, dataFolderChanged:', this.dataFolderChanged);
        // フォルダが変更されていない場合は何もしない
        if (!this.dataFolderChanged) {
            logger.info('[UserConfig] フォルダ変更なし、スキップ');
            return;
        }

        const folderDisplay = document.getElementById('folder-path-display');
        const folderPath = folderDisplay?.textContent;

        if (folderPath && folderPath !== '未設定') {
            try {
                const result = await this.sendWithCallbackAsync('set-data-folder', {
                    dataFolder: folderPath
                });

                if (result.success) {
                    // 再起動通知を表示
                    await this.sendWithCallbackAsync('show-message-dialog', {
                        message: 'データフォルダが変更されました。\n変更を反映するには再起動が必要です。',
                        buttons: [
                            { label: '了　解', value: 'ok' }
                        ],
                        defaultButton: 0
                    });
                } else {
                    logger.error('[UserConfig] データフォルダの保存に失敗:', result.error);
                    // エラーダイアログを表示
                    await this.sendWithCallbackAsync('show-message-dialog', {
                        message: `データフォルダの設定に失敗しました:\n${result.error}`,
                        buttons: [
                            { label: '了　解', value: 'ok' }
                        ],
                        defaultButton: 0
                    });
                }
            } catch (error) {
                logger.error('[UserConfig] データフォルダの保存に失敗:', error);
            }
        }
    }

    // updateWindowConfig() は基底クラス PluginBase で定義
}

// DOMContentLoaded後に初期化
document.addEventListener('DOMContentLoaded', () => {
    window.userConfigApp = new UserConfigApp();
});
