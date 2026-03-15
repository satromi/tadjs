/**
 * システム環境設定プラグイン
 * @module SystemConfig
 * @extends PluginBase
 * @license MIT
 * @author satromi
 * @version 1.0.0
 */
const logger = window.getLogger('SystemConfig');

class SystemConfigApp extends window.PluginBase {
    constructor() {
        super('SystemConfig');
        logger.info('[SystemConfig] 初期化開始');

        this.selectedBackground = null;
        // this.realId, this.messageBus は PluginBase で定義済み

        // MessageBusはPluginBaseで初期化済み
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

        // MCP設定読み込み
        this.loadMcpConfig();

        // ボタンイベント
        this.setupButtons();

        // 現在の選択を読み込み
        this.loadCurrentSelection();

        // 右クリックメニュー
        this.setupContextMenu();

        // ウィンドウアクティベーション
        this.setupWindowActivation();

        // カスタムスクロールバーを初期化
        this.initCustomScrollbar('.tab-content');
    }

    setupMessageBusHandlers() {
        // 共通ハンドラを登録
        this.setupCommonMessageBusHandlers();

        // init メッセージ
        this.messageBus.on('init', (data) => {
            // 共通初期化処理（windowId設定、スクロール状態送信）
            this.onInit(data);

            // fileIdを保存（拡張子を除去）
            if (data.fileData) {
                let rawId = data.fileData.realId || data.fileData.fileId;
                this.realId = rawId ? this.extractRealId(rawId) : null;
                logger.info('[SystemConfig] fileId設定:', this.realId, '(元:', rawId, ')');
            }
        });

        // plugin-list-response メッセージ
        this.messageBus.on('plugin-list-response', (data) => {
            this.renderVersionList(data.plugins);
        });

        // mcp-config-response メッセージ
        this.messageBus.on('mcp-config-response', (data) => {
            const checkbox = document.getElementById('enable-mcp-server');
            if (checkbox && data.config) {
                checkbox.checked = !!data.config.enabled;
                this.updateMcpButtonsEnabled(checkbox.checked);
            }
        });

        // mcp-config-saved メッセージ
        this.messageBus.on('mcp-config-saved', (data) => {
            if (data.success) {
                logger.info('[SystemConfig] MCP設定を保存しました');
            } else {
                logger.error('[SystemConfig] MCP設定保存エラー:', data.error);
            }
        });

        // mcp-server-started メッセージ
        this.messageBus.on('mcp-server-started', (data) => {
            if (data.success) {
                this.updateMcpStatus(true);
                logger.info(`[SystemConfig] MCPサーバ起動 PID=${data.pid} exe=${data.exePath}`);
                if (data.args) logger.info(`[SystemConfig] 起動引数: ${JSON.stringify(data.args)}`);
            } else {
                logger.error('[SystemConfig] MCPサーバ起動エラー:', data.error);
            }
        });

        // mcp-server-stopped メッセージ
        this.messageBus.on('mcp-server-stopped', (data) => {
            if (data.success) {
                this.updateMcpStatus(false);
                logger.info('[SystemConfig] MCPサーバを停止しました');
            } else {
                logger.error('[SystemConfig] MCPサーバ停止エラー:', data.error);
            }
        });

        // mcp-server-status-response メッセージ
        this.messageBus.on('mcp-server-status-response', (data) => {
            this.updateMcpStatus(data.running);
        });
    }

    getMenuDefinition() {
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
    }

    async executeMenuAction(action) {
        const activeElement = document.activeElement;
        const isInputField = activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA');

        switch (action) {
            case 'copy':
                if (isInputField) {
                    const selectedText = activeElement.value.substring(activeElement.selectionStart, activeElement.selectionEnd);
                    if (selectedText) {
                        this.setTextClipboard(selectedText);
                        navigator.clipboard.writeText(selectedText).catch(() => {});
                    }
                }
                break;
            case 'paste':
                if (isInputField) {
                    // グローバルクリップボードを優先
                    const globalClipboard = await this.getClipboard();
                    if (globalClipboard && globalClipboard.type === 'text' && globalClipboard.text) {
                        const start = activeElement.selectionStart;
                        const end = activeElement.selectionEnd;
                        const value = activeElement.value;
                        activeElement.value = value.substring(0, start) + globalClipboard.text + value.substring(end);
                        activeElement.selectionStart = activeElement.selectionEnd = start + globalClipboard.text.length;
                        activeElement.dispatchEvent(new Event('input', { bubbles: true }));
                    } else {
                        // システムクリップボードからフォールバック
                        try {
                            const text = await navigator.clipboard.readText();
                            if (text) {
                                const start = activeElement.selectionStart;
                                const end = activeElement.selectionEnd;
                                const value = activeElement.value;
                                activeElement.value = value.substring(0, start) + text + value.substring(end);
                                activeElement.selectionStart = activeElement.selectionEnd = start + text.length;
                                activeElement.dispatchEvent(new Event('input', { bubbles: true }));
                            }
                        } catch (e) {
                            // NotAllowedError等は無視
                        }
                    }
                }
                break;
            case 'cut':
                if (isInputField) {
                    const selectedText = activeElement.value.substring(activeElement.selectionStart, activeElement.selectionEnd);
                    if (selectedText) {
                        this.setTextClipboard(selectedText);
                        navigator.clipboard.writeText(selectedText).catch(() => {});
                        const start = activeElement.selectionStart;
                        const end = activeElement.selectionEnd;
                        activeElement.value = activeElement.value.substring(0, start) + activeElement.value.substring(end);
                        activeElement.selectionStart = activeElement.selectionEnd = start;
                        activeElement.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                }
                break;
            case 'undo':
                document.execCommand('undo');
                break;
            case 'redo':
                document.execCommand('redo');
                break;
            case 'select-all':
                if (isInputField) {
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

    // setupContextMenu() と setupWindowActivation() は PluginBase 共通メソッドを使用

    setupTabs() {
        // メインタブ
        this.initTabSwitcher();
        // 画面タブのサブタブ
        this.initTabSwitcher({
            tabSelector: '.sub-tab',
            panelSelector: '.sub-tab-panel',
            dataAttribute: 'subtab'
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
        const result = await this.showMessageDialog(
            'この背景画像を削除しますか？',
            [
                { label: '取り消し', value: 'cancel' },
                { label: '削　除', value: 'delete' }
            ],
            0
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

    loadMcpConfig() {
        // メインプロセスからMCP設定を取得
        this.messageBus.send('get-mcp-config', {});
        // MCPサーバの稼働状態を取得
        this.messageBus.send('get-mcp-server-status', {});
        // 起動・停止ボタンのイベント設定
        this.setupMcpButtons();
    }

    setupMcpButtons() {
        const startButton = document.getElementById('mcp-start-button');
        const stopButton = document.getElementById('mcp-stop-button');
        const checkbox = document.getElementById('enable-mcp-server');

        if (startButton) {
            startButton.addEventListener('click', () => {
                this.messageBus.send('start-mcp-server', {});
            });
        }
        if (stopButton) {
            stopButton.addEventListener('click', () => {
                this.messageBus.send('stop-mcp-server', {});
            });
        }

        // チェックボックスの変更でボタンの有効/無効を切り替え
        if (checkbox) {
            checkbox.addEventListener('change', () => {
                this.updateMcpButtonsEnabled(checkbox.checked);
            });
        }

        // 初期状態: チェックボックスがOFFならボタンを無効化
        this.updateMcpButtonsEnabled(checkbox ? checkbox.checked : false);
    }

    updateMcpButtonsEnabled(enabled) {
        const startButton = document.getElementById('mcp-start-button');
        const stopButton = document.getElementById('mcp-stop-button');
        const statusEl = document.getElementById('mcp-status');

        if (!enabled) {
            // 無効時: 両ボタンを無効化
            if (startButton) startButton.disabled = true;
            if (stopButton) stopButton.disabled = true;
            if (statusEl) {
                statusEl.textContent = '無効';
                statusEl.className = 'mcp-status stopped';
            }
        } else {
            // 有効時: 現在の稼働状態に基づいてボタンを制御
            this.messageBus.send('get-mcp-server-status', {});
        }
    }

    updateMcpStatus(running) {
        const statusEl = document.getElementById('mcp-status');
        const startButton = document.getElementById('mcp-start-button');
        const stopButton = document.getElementById('mcp-stop-button');
        const checkbox = document.getElementById('enable-mcp-server');

        // チェックボックスがOFFなら常に無効表示
        if (checkbox && !checkbox.checked) {
            if (statusEl) {
                statusEl.textContent = '無効';
                statusEl.className = 'mcp-status stopped';
            }
            if (startButton) startButton.disabled = true;
            if (stopButton) stopButton.disabled = true;
            return;
        }

        if (statusEl) {
            statusEl.textContent = running ? '起動中' : '停止中';
            statusEl.className = 'mcp-status ' + (running ? 'running' : 'stopped');
        }
        if (startButton) {
            startButton.disabled = running;
        }
        if (stopButton) {
            stopButton.disabled = !running;
        }
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
        }

        // MCP設定を保存
        const mcpCheckbox = document.getElementById('enable-mcp-server');
        if (mcpCheckbox && this.messageBus) {
            this.messageBus.send('set-mcp-config', {
                config: { enabled: mcpCheckbox.checked }
            });
        }

        logger.info('[SystemConfig] 設定を適用しました');

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

        // package.jsonからシステムバージョンを取得して表示
        try {
            const response = await fetch('../../package.json');
            if (response.ok) {
                const pkg = await response.json();
                const versionEl = document.getElementById('system-version');
                if (versionEl) {
                    versionEl.textContent = `Ver${pkg.version}`;
                }
            }
        } catch (e) {
            logger.warn('[SystemConfig] package.json読み込みエラー:', e.message);
        }

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

    // updateWindowConfig() は基底クラス PluginBase で定義
}

// DOMContentLoaded後に初期化
document.addEventListener('DOMContentLoaded', () => {
    window.systemConfigApp = new SystemConfigApp();
});
