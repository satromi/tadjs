/**
 * 原紙箱プラグイン
 * 原紙ファイルを仮身形式で一覧表示し、ドラッグ&ドロップでコピー配置を実現
 */
const logger = window.getLogger('BaseFileManager');

class BaseFileManager {
    constructor() {
        this.baseFiles = [];
        this.pluginConfig = null;
        this.realId = null; // 実身ID
        this.fileData = null; // ファイルデータ
        this.isFullscreen = false; // 全画面表示フラグ
        this.virtualObjectRenderer = null; // VirtualObjectRenderer
        this.iconCache = new Map(); // アイコンキャッシュ (realId -> base64)
        this.debug = window.TADjsConfig?.debug || false; // デバッグモード（config.jsで管理）

        // MessageBusの初期化（即座に開始）
        this.messageBus = null;
        if (window.MessageBus) {
            this.messageBus = new window.MessageBus({
                debug: this.debug,
                pluginName: 'BaseFileManager'
            });
            this.messageBus.start();
        } else {
            logger.warn('[BaseFileManager] MessageBus not available');
        }

        this.init();
    }

    init() {
        // VirtualObjectRendererの初期化
        if (window.VirtualObjectRenderer) {
            this.virtualObjectRenderer = new window.VirtualObjectRenderer();
        }

        // 親ウィンドウからのメッセージを受信
        this.setupMessageHandler();

        // ウィンドウアクティベーション
        this.setupWindowActivation();

        // 右クリックメニュー
        this.setupContextMenu();

        // キーボードショートカット
        this.setupKeyboardShortcuts();
    }

    setupMessageHandler() {
        // MessageBusのハンドラを登録（Phase 2: MessageBusのみ使用）
        if (this.messageBus) {
            this.setupMessageBusHandlers();
        } else {
            logger.error('[BaseFileManager] MessageBus not available - cannot setup message handlers');
        }
    }

    /**
     * MessageBusのハンドラを登録
     * Phase 2: MessageBusのみで動作
     */
    setupMessageBusHandlers() {
        // init メッセージ
        this.messageBus.on('init', async (data) => {
            // fileDataを保存
            if (data.fileData) {
                this.fileData = data.fileData;
                let rawId = data.fileData.realId || data.fileData.fileId;
                this.realId = rawId ? rawId.replace(/_\d+\.xtad$/, '') : null;
            }

            // 背景色を適用してファイルを読み込む
            this.applyBackgroundColor();
            await this.loadBaseFiles();
        });

        // window-moved メッセージ
        this.messageBus.on('window-moved', (data) => {
            if (data.pos && data.width !== undefined && data.height !== undefined) {
                this.updateWindowConfig({
                    pos: data.pos,
                    width: data.width,
                    height: data.height
                });
            }
        });

        // window-resized-end メッセージ
        this.messageBus.on('window-resized-end', (data) => {
            if (data.width !== undefined && data.height !== undefined) {
                this.updateWindowConfig({
                    width: data.width,
                    height: data.height
                });
            }
        });

        // window-maximize-toggled メッセージ
        this.messageBus.on('window-maximize-toggled', (data) => {
            if (data.width !== undefined && data.height !== undefined) {
                this.updateWindowConfig({
                    width: data.width,
                    height: data.height
                });
            }
        });

        // get-menu-definition メッセージ
        this.messageBus.on('get-menu-definition', (data) => {
            const menuDefinition = this.getMenuDefinition();
            this.messageBus.send('menu-definition-response', {
                messageId: data.messageId,
                menuDefinition: menuDefinition
            });
        });

        // menu-action メッセージ
        this.messageBus.on('menu-action', (data) => {
            this.handleMenuAction(data.action);
        });

        // custom-dialog-response メッセージ (MessageBusが自動処理)
        this.messageBus.on('custom-dialog-response', (data) => {
            // sendWithCallback使用時は自動的にコールバックが実行される
        });

        // input-dialog-response メッセージ (MessageBusが自動処理)
        this.messageBus.on('input-dialog-response', (data) => {
            // sendWithCallback使用時は自動的にコールバックが実行される
        });
    }

    getMenuDefinition() {
        return [
            {
                text: '表示',
                submenu: [
                    { text: '全画面表示', action: 'toggle-fullscreen', shortcut: 'Ctrl+L' },
                    { text: '背景色変更', action: 'change-bg-color' }
                ]
            },
            {
                text: '編集',
                submenu: [
                    { text: '再読込', action: 'reload' }
                ]
            }
        ];
    }

    async handleMenuAction(action) {
        switch (action) {
            case 'reload':
                await this.loadBaseFiles();
                break;
            case 'close':
                this.requestCloseWindow();
                break;
            case 'change-bg-color':
                await this.changeBgColor();
                break;
            case 'toggle-fullscreen':
                this.toggleFullscreen();
                break;
            default:
                logger.warn('[BaseFileManager] 未知のアクション:', action);
        }
    }

    setupContextMenu() {
        document.addEventListener('contextmenu', (e) => {
            e.preventDefault();

            const rect = window.frameElement.getBoundingClientRect();

            // MessageBus Phase 2: messageBus.send()を使用
            this.messageBus.send('context-menu-request', {
                x: rect.left + e.clientX,
                y: rect.top + e.clientY
            });
        });

        document.addEventListener('click', () => {
            // MessageBus Phase 2: messageBus.send()を使用
            this.messageBus.send('close-context-menu');
        });
    }

    setupWindowActivation() {
        document.addEventListener('mousedown', () => {
            // MessageBus Phase 2: messageBus.send()を使用
            this.messageBus.send('activate-window');
        });
    }

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ctrl+E: ウィンドウを閉じる
            if (e.ctrlKey && e.key === 'e') {
                e.preventDefault();
                this.handleMenuAction('close');
                return;
            }

            // Ctrl+L: 全画面表示切り替え
            if (e.ctrlKey && e.key === 'l') {
                e.preventDefault();
                this.handleMenuAction('toggle-fullscreen');
                return;
            }
        });
    }

    requestCloseWindow() {
        // MessageBus Phase 2: messageBus.send()を使用
        this.messageBus.send('close-window', {
            windowId: this.windowId
        });
    }

    /**
     * 原紙ファイルを読み込む
     * プラグインの type="base" で basefile が指定されているものを対象
     */
    async loadBaseFiles() {
        try {
            // MessageBus使用
            this.messageBus.send('request-base-plugins');

            // レスポンスを待つ
            const response = await this.messageBus.waitFor('base-plugins-response', window.DEFAULT_TIMEOUT_MS);

            if (response && response.plugins) {
                // 原紙ファイルを読み込んで表示
                await this.loadAndDisplayBaseFiles(response.plugins);
            } else {
                logger.warn('[BaseFileManager] 原紙プラグインが見つかりません');
            }

        } catch (error) {
            logger.error('[BaseFileManager] 原紙ファイル読み込みエラー:', error);
        }
    }


    /**
     * 原紙ファイルを読み込んで表示
     */
    async loadAndDisplayBaseFiles(plugins) {
        this.baseFiles = [];

        for (const plugin of plugins) {
            if (plugin.type === 'base' && plugin.basefile) {
                // basefileがオブジェクトの場合はxmltadプロパティを、文字列の場合はそのまま使用
                const basefileName = typeof plugin.basefile === 'object'
                    ? plugin.basefile.xmltad
                    : plugin.basefile;

                try {
                    // 原紙ファイルのパスを構築（相対パス）
                    const basefilePath = `../../plugins/${plugin.id}/${basefileName}`;

                    // ファイルを読み込む
                    const response = await fetch(basefilePath);
                    if (!response.ok) {
                        logger.warn(`[BaseFileManager] ファイルが見つかりません: ${basefilePath}`);
                        continue;
                    }

                    const arrayBuffer = await response.arrayBuffer();
                    const uint8Array = new Uint8Array(arrayBuffer);

                    // XMLに変換
                    const xmlData = await this.convertToXML(uint8Array);

                    if (xmlData) {
                        // <tad>タグのfilename属性を取得
                        const filenameMatch = xmlData.match(/<tad[^>]+filename="([^"]*)"/i);
                        const displayName = filenameMatch ? filenameMatch[1] : plugin.name;

                        // realIdとiconFileを取得
                        let realId = null;
                        let iconFile = null;
                        if (typeof plugin.basefile === 'object') {
                            // jsonファイル名から実身IDを抽出
                            if (plugin.basefile.json) {
                                realId = plugin.basefile.json.replace(/\.json$/, '');
                            }
                            iconFile = plugin.basefile.ico || null;
                        }

                        this.baseFiles.push({
                            pluginId: plugin.id,
                            pluginName: plugin.name,
                            displayName: displayName,
                            basefile: plugin.basefile,
                            realId: realId,
                            iconFile: iconFile,
                            xmlData: xmlData,
                            rawData: uint8Array
                        });
                    }

                } catch (error) {
                    logger.error(`[BaseFileManager] ファイル読み込みエラー (${plugin.name}):`, error);
                }
            }
        }

        // 仮身一覧を表示
        this.renderBaseFiles();
    }

    /**
     * TADデータをXMLに変換
     */
    async convertToXML(rawData) {
        // すでにXML形式かチェック（先頭が'<'ならXMLテキスト）
        const textDecoder = new TextDecoder('utf-8');
        const firstChar = textDecoder.decode(rawData.slice(0, 1));

        if (firstChar === '<') {
            // すでにXML形式なのでそのまま文字列として返す
            const xmlText = textDecoder.decode(rawData);
            return xmlText;
        }

        // TADバイナリ形式の場合はparsTADToXMLで変換
        if (window.parent && typeof window.parent.parseTADToXML === 'function') {
            try {
                const xmlResult = await window.parent.parseTADToXML(rawData, 0);
                return xmlResult;
            } catch (error) {
                logger.error('[BaseFileManager] XML変換エラー:', error);
                return null;
            }
        }
        logger.warn('[BaseFileManager] parseTADToXML関数が見つかりません');
        return null;
    }

    /**
     * 原紙ファイルを仮身形式で表示
     */
    renderBaseFiles() {
        const listElement = document.getElementById('baseFileList');
        if (!listElement) return;

        listElement.innerHTML = '';

        if (this.baseFiles.length === 0) {
            const emptyMessage = document.createElement('div');
            emptyMessage.className = 'empty-message';
            emptyMessage.textContent = '原紙ファイルがありません';
            listElement.appendChild(emptyMessage);
            return;
        }

        // 各原紙ファイルを仮身として表示
        this.baseFiles.forEach((baseFile, index) => {
            const vobjElement = this.createVirtualObject(baseFile, index);
            listElement.appendChild(vobjElement);
        });
    }

    /**
     * 仮身要素を作成
     */
    createVirtualObject(baseFile, index) {
        // メニュー文字サイズを取得（ポイント値）
        const menuFontSize = localStorage.getItem('menu-font-size') || '14';
        const chsz = parseFloat(menuFontSize);

        // ピクセル値に変換（フォールバック用）
        const chszPx = window.convertPtToPx ? window.convertPtToPx(chsz) : Math.round(chsz * 1.333);

        // VirtualObjectRendererを使用する場合
        if (this.virtualObjectRenderer && baseFile.realId) {
            // 仮身オブジェクトを作成
            const virtualObject = {
                link_id: `${baseFile.realId}_0.xtad`,
                link_name: baseFile.displayName,
                chsz: chsz,  // ポイント値を渡す
                frcol: '#000000',
                chcol: '#000000',
                tbcol: '#ffffff',
                bgcol: '#ffffff',
                pictdisp: 'true',
                namedisp: 'true',
                roledisp: 'false',
                typedisp: 'false',
                updatedisp: 'false',
                framedisp: 'true',
                autoopen: 'false'
            };

            // VirtualObjectRendererでインライン要素を作成
            const vobj = this.virtualObjectRenderer.createInlineElement(virtualObject, {
                loadIconCallback: (realId) => this.loadIcon(realId, baseFile)
            });

            vobj.className = 'base-file-vobj';
            vobj.dataset.index = index;
            vobj.draggable = true;
            vobj.style.margin = '8px';
            vobj.style.cursor = 'move';

            // ドラッグ開始イベント
            vobj.addEventListener('dragstart', (e) => {
                this.handleDragStart(e, baseFile, index);
            });

            // ドラッグ終了イベント
            vobj.addEventListener('dragend', (e) => {
                this.handleDragEnd(e);
            });

            // ダブルクリックイベント（開く）
            vobj.addEventListener('dblclick', () => {
                this.openBaseFile(baseFile);
            });

            return vobj;
        }

        // フォールバック：VirtualObjectRendererが利用できない場合
        const vobj = document.createElement('div');
        vobj.className = 'base-file-vobj';
        vobj.dataset.index = index;
        vobj.draggable = true;

        // 仮身枠
        vobj.style.border = '1px solid #000000';
        vobj.style.backgroundColor = '#ffffff';
        vobj.style.padding = '4px 8px';
        vobj.style.margin = '8px';
        vobj.style.cursor = 'move';
        vobj.style.display = 'inline-block';
        vobj.style.minWidth = '150px';
        vobj.style.textAlign = 'center';

        // タイトル
        const title = document.createElement('span');
        title.className = 'base-file-title';
        title.textContent = baseFile.displayName;
        title.style.fontSize = chszPx + 'px';  // ピクセル値を使用
        title.style.color = '#000000';

        vobj.appendChild(title);

        // ドラッグ開始イベント
        vobj.addEventListener('dragstart', (e) => {
            this.handleDragStart(e, baseFile, index);
        });

        // ドラッグ終了イベント
        vobj.addEventListener('dragend', (e) => {
            this.handleDragEnd(e);
        });

        // ダブルクリックイベント（開く）
        vobj.addEventListener('dblclick', () => {
            this.openBaseFile(baseFile);
        });

        return vobj;
    }

    /**
     * アイコンを読み込む
     */
    async loadIcon(realId, baseFile) {
        // キャッシュにあればそれを返す
        if (this.iconCache.has(realId)) {
            return this.iconCache.get(realId);
        }

        // iconFileがない場合
        if (!baseFile.iconFile) {
            return null;
        }

        try {
            // アイコンファイルのパスを構築
            const iconPath = `../../plugins/${baseFile.pluginId}/${baseFile.iconFile}`;

            // アイコンファイルを読み込む
            const response = await fetch(iconPath);
            if (!response.ok) {
                logger.warn('[BaseFileManager] アイコンファイルが見つかりません:', iconPath);
                return null;
            }

            // バイナリデータを取得
            const arrayBuffer = await response.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);

            // Base64に変換
            let binary = '';
            for (let i = 0; i < uint8Array.byteLength; i++) {
                binary += String.fromCharCode(uint8Array[i]);
            }
            const base64 = btoa(binary);

            // キャッシュに保存
            this.iconCache.set(realId, base64);

            return base64;
        } catch (error) {
            logger.error('[BaseFileManager] アイコン読み込みエラー:', realId, error);
            return null;
        }
    }

    /**
     * ドラッグ開始処理
     */
    handleDragStart(event, baseFile, index) {
        // ドラッグデータを設定（コピー用）
        const dragData = {
            type: 'base-file-copy',
            source: 'base-file-manager',
            baseFile: {
                pluginId: baseFile.pluginId,
                pluginName: baseFile.pluginName,
                displayName: baseFile.displayName,
                basefile: baseFile.basefile,
                xmlData: baseFile.xmlData
            }
        };

        event.dataTransfer.setData('text/plain', JSON.stringify(dragData));
        event.dataTransfer.effectAllowed = 'copy';

        // ドラッグ中のスタイル
        event.target.style.opacity = '0.5';
    }

    /**
     * ドラッグ終了処理
     */
    handleDragEnd(event) {
        // スタイルを元に戻す
        event.target.style.opacity = '1';
    }

    /**
     * 原紙ファイルを開く
     */
    openBaseFile(baseFile) {
        // MessageBus Phase 2: messageBus.send()を使用
        this.messageBus.send('open-base-file', {
            pluginId: baseFile.pluginId,
            basefile: baseFile.basefile,
            displayName: baseFile.displayName
        });
    }

    /**
     * ウィンドウ設定（位置・サイズ・最大化状態）を更新
     * @param {Object} windowConfig - { pos: {x, y}, width, height, maximize }
     */
    updateWindowConfig(windowConfig) {
        if (this.realId) {
            // MessageBus Phase 2: messageBus.send()を使用
            this.messageBus.send('update-window-config', {
                fileId: this.realId,
                windowConfig: windowConfig
            });
        }
    }

    /**
     * 背景色を適用
     */
    applyBackgroundColor() {
        if (this.fileData && this.fileData.windowConfig && this.fileData.windowConfig.backgroundColor) {
            // DOM要素が生成されるまで待機
            setTimeout(() => {
                const container = document.querySelector('.manager-container');
                const list = document.querySelector('.base-file-list');
                const bgColor = this.fileData.windowConfig.backgroundColor;

                if (container) {
                    container.style.background = bgColor;
                }
                if (list) {
                    list.style.background = bgColor;
                } else {
                    logger.warn('[BaseFileManager] .base-file-list 要素が見つかりません');
                }
            }, 100);
        }
    }

    /**
     * 背景色変更ダイアログを表示
     */
    async changeBgColor() {
        return new Promise((resolve) => {
            // 現在の背景色を取得
            const currentBgColor = (this.fileData && this.fileData.windowConfig && this.fileData.windowConfig.backgroundColor)
                ? this.fileData.windowConfig.backgroundColor
                : '#ffffff';

            // ダイアログのHTML要素を作成
            const dialogHtml = `
                <div style="margin-bottom: 10px;">ウインドウ背景色を選択してください。</div>
                <div style="margin-bottom: 10px;">
                    <label style="display: block; margin-bottom: 5px;">#FFFFFF形式で入力：</label>
                    <input type="text" id="bgColorInput" placeholder="#FFFFFF" value="${currentBgColor}"
                           style="width: 100%; padding: 5px; box-sizing: border-box;">
                </div>
            `;

            const handleResponse = (result) => {
                logger.info('[BaseFileManager] 背景色変更ダイアログコールバック実行:', result);

                // Dialog result is wrapped in result.result
                const dialogResult = result.result || result;

                if (dialogResult.button === 'ok') {
                    logger.info('[BaseFileManager] OKボタンが押されました');
                    const inputColor = dialogResult.input;

                    // 入力された色を検証
                    if (/^#[0-9A-Fa-f]{6}$/.test(inputColor)) {
                        const newBgColor = inputColor;

                        // コンテナと一覧の背景色を変更
                        const container = document.querySelector('.manager-container');
                        const list = document.querySelector('.base-file-list');
                        if (container) {
                            container.style.background = newBgColor;
                        }
                        if (list) {
                            list.style.background = newBgColor;
                        } else {
                            logger.error('[BaseFileManager] .base-file-listが見つかりません');
                        }

                        // 実身管理用セグメントのbackgroundColorを更新
                        if (this.realId) {
                            // MessageBus Phase 2: messageBus.send()を使用
                            this.messageBus.send('update-background-color', {
                                fileId: this.realId,
                                backgroundColor: newBgColor
                            });
                        }

                        // this.fileDataを更新（再表示時に正しい色を適用するため）
                        if (!this.fileData) {
                            logger.warn('[BaseFileManager] fileDataが未定義、初期化します');
                            this.fileData = {};
                        }
                        if (!this.fileData.windowConfig) {
                            this.fileData.windowConfig = {};
                        }
                        this.fileData.windowConfig.backgroundColor = newBgColor;
                    } else {
                        logger.warn('[BaseFileManager] 無効な色形式:', inputColor);
                    }
                } else {
                    logger.info('[BaseFileManager] OKボタンが押されませんでした。button:', dialogResult.button);
                }
                resolve(result);
            };

            // MessageBus使用
            this.messageBus.sendWithCallback('show-custom-dialog', {
                dialogHtml: dialogHtml,
                buttons: [
                    { label: '取消', value: 'cancel' },
                    { label: '設定', value: 'ok' }
                ],
                defaultButton: 1,
                inputs: {
                    text: 'bgColorInput'
                }
            }, handleResponse);
        });
    }

    /**
     * 全画面表示を切り替え
     */
    toggleFullscreen() {
        // MessageBus Phase 2: messageBus.send()を使用
        this.messageBus.send('toggle-maximize');

        this.isFullscreen = !this.isFullscreen;

        // 実身管理用セグメントのfullscreenフラグを更新
        if (this.realId) {
            // MessageBus Phase 2: messageBus.send()を使用
            this.messageBus.send('update-fullscreen-state', {
                fileId: this.realId,
                isFullscreen: this.isFullscreen
            });
        }
    }

    /**
     * デバッグログ出力（デバッグモード時のみ）
     */
    log(...args) {
        if (this.debug) {
            logger.info('[BaseFileManager]', ...args);
        }
    }

    /**
     * エラーログ出力（常に出力）
     */
    error(...args) {
        logger.error('[BaseFileManager]', ...args);
    }

    /**
     * 警告ログ出力（常に出力）
     */
    warn(...args) {
        logger.warn('[BaseFileManager]', ...args);
    }
}

// DOMContentLoaded後に初期化
document.addEventListener('DOMContentLoaded', () => {
    window.baseFileManager = new BaseFileManager();
});
