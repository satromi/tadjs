/**
 * ユーザ環境設定プラグイン
 */
class UserConfigApp {
    constructor() {
        this.timeUpdateInterval = null;
        this.realId = null; // 実身ID
        this.messageBus = null;
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
        console.log('[UserConfig] 初期化開始');

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

    setupMessageBusHandlers() {
        // init メッセージ
        this.messageBus.on('init', (data) => {
            // fileIdを保存（拡張子を除去）
            if (data.fileData) {
                let rawId = data.fileData.realId || data.fileData.fileId;
                this.realId = rawId ? rawId.replace(/_\d+\.xtad$/, '') : null;
                console.log('[UserConfig] fileId設定:', this.realId, '(元:', rawId, ')');
            }
        });

        // get-menu-definition メッセージ
        this.messageBus.on('get-menu-definition', async (data) => {
            // 編集メニューを返す
            return [
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
                console.log('[UserConfig] 検索/置換は未実装です');
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
    }

    setupButtons() {
        const applyButton = document.getElementById('apply-button');
        const cancelButton = document.getElementById('cancel-button');
        const kanaKanjiButton = document.getElementById('kana-kanji-button');

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
                    console.warn('[UserConfig] Message dialog error:', result.error);
                }
                // 結果は特に使用しない
            });
        });

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

    apply() {
        const usernameInput = document.getElementById('username');
        const inputMethodSelect = document.getElementById('input-method');

        const username = usernameInput?.value || 'TRON User';
        const inputMethod = inputMethodSelect?.value || 'romaji';

        // LocalStorageに保存
        localStorage.setItem('username', username);
        localStorage.setItem('inputMethod', inputMethod);

        // 表示属性を保存
        this.saveDisplayConfig();

        console.log('[UserConfig] 設定を適用しました:', { username, inputMethod });

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
     * ウィンドウ設定を更新
     * @param {Object} windowConfig - ウィンドウ設定
     */
    updateWindowConfig(windowConfig) {
        if (this.messageBus && this.realId) {
            this.messageBus.send('update-window-config', {
                fileId: this.realId,
                windowConfig: windowConfig
            });

            console.log('[UserConfig] ウィンドウ設定を更新:', windowConfig);
        }
    }
}

// DOMContentLoaded後に初期化
document.addEventListener('DOMContentLoaded', () => {
    window.userConfigApp = new UserConfigApp();
});
