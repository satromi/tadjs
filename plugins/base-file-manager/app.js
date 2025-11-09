/**
 * 原紙箱プラグイン
 * 原紙ファイルを仮身形式で一覧表示し、ドラッグ&ドロップでコピー配置を実現
 */
class BaseFileManager {
    constructor() {
        this.baseFiles = [];
        this.pluginConfig = null;
        this.realId = null; // 実身ID
        this.fileData = null; // ファイルデータ
        this.dialogCallbacks = {}; // ダイアログコールバック
        this.isFullscreen = false; // 全画面表示フラグ
        this.virtualObjectRenderer = null; // VirtualObjectRenderer
        this.iconCache = new Map(); // アイコンキャッシュ (realId -> base64)
        this.init();
    }

    init() {
        console.log('[BaseFileManager] 初期化開始');

        // VirtualObjectRendererの初期化
        if (window.VirtualObjectRenderer) {
            this.virtualObjectRenderer = new window.VirtualObjectRenderer();
            console.log('[BaseFileManager] VirtualObjectRenderer initialized');
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
        window.addEventListener('message', (event) => {
            console.log('[BaseFileManager] メッセージ受信:', event.data?.type, event.data);

            if (event.data && event.data.type === 'init') {
                console.log('[BaseFileManager] init受信', event.data);

                // fileDataを保存
                if (event.data.fileData) {
                    this.fileData = event.data.fileData;
                    console.log('[BaseFileManager] fileData保存完了:', this.fileData);

                    let rawId = event.data.fileData.realId || event.data.fileData.fileId;
                    // _0.xtadなどの拡張子を除去
                    this.realId = rawId ? rawId.replace(/_\d+\.xtad$/, '') : null;
                    console.log('[BaseFileManager] realId設定:', this.realId, '(元:', rawId, ')');
                } else {
                    console.warn('[BaseFileManager] fileDataが存在しません:', event.data);
                }

                // 背景色を適用
                this.applyBackgroundColor();

                // 原紙ファイルを読み込み
                this.loadBaseFiles();
            } else if (event.data && event.data.type === 'window-moved') {
                // ウィンドウ移動終了時にwindowConfigを更新
                this.updateWindowConfig({
                    pos: event.data.pos,
                    width: event.data.width,
                    height: event.data.height
                });
            } else if (event.data && event.data.type === 'window-resized-end') {
                // ウィンドウリサイズ終了時にwindowConfigを更新
                this.updateWindowConfig({
                    pos: event.data.pos,
                    width: event.data.width,
                    height: event.data.height
                });
            } else if (event.data && event.data.type === 'window-maximize-toggled') {
                // 全画面表示切り替え時にwindowConfigを更新
                this.updateWindowConfig({
                    pos: event.data.pos,
                    width: event.data.width,
                    height: event.data.height,
                    maximize: event.data.maximize
                });
            } else if (event.data && event.data.type === 'get-menu-definition') {
                // メニュー定義を返す
                const menuDefinition = this.getMenuDefinition();
                window.parent.postMessage({
                    type: 'menu-definition-response',
                    messageId: event.data.messageId,
                    menuDefinition: menuDefinition
                }, '*');
            } else if (event.data && event.data.type === 'menu-action') {
                console.log('[BaseFileManager] menu-action受信:', event.data.action);
                this.handleMenuAction(event.data.action);
            } else if (event.data && (event.data.type === 'custom-dialog-response' || event.data.type === 'input-dialog-response')) {
                // カスタムダイアログのレスポンス
                console.log('[BaseFileManager] ダイアログレスポンス受信:', event.data.type, event.data);
                const callback = this.dialogCallbacks[event.data.messageId];
                if (callback) {
                    console.log('[BaseFileManager] コールバック実行:', event.data.messageId);
                    callback(event.data.result);
                    delete this.dialogCallbacks[event.data.messageId];
                } else {
                    console.warn('[BaseFileManager] コールバックが見つかりません:', event.data.messageId);
                }
            }
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

    handleMenuAction(action) {
        console.log('[BaseFileManager] handleMenuAction呼び出し:', action);
        switch (action) {
            case 'reload':
                console.log('[BaseFileManager] リロード実行');
                this.loadBaseFiles();
                break;
            case 'close':
                console.log('[BaseFileManager] ウィンドウを閉じる');
                this.requestCloseWindow();
                break;
            case 'change-bg-color':
                console.log('[BaseFileManager] 背景色変更開始');
                this.changeBgColor();
                break;
            case 'toggle-fullscreen':
                console.log('[BaseFileManager] 全画面表示切り替え');
                this.toggleFullscreen();
                break;
            default:
                console.warn('[BaseFileManager] 未知のアクション:', action);
        }
    }

    setupContextMenu() {
        document.addEventListener('contextmenu', (e) => {
            e.preventDefault();

            if (window.parent && window.parent !== window) {
                const rect = window.frameElement.getBoundingClientRect();

                window.parent.postMessage({
                    type: 'context-menu-request',
                    x: rect.left + e.clientX,
                    y: rect.top + e.clientY
                }, '*');
            }
        });

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

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ctrl+E: ウィンドウを閉じる
            if (e.ctrlKey && e.key === 'e') {
                e.preventDefault();
                this.handleMenuAction('close');
                return;
            }
        });
    }

    requestCloseWindow() {
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: 'request-close-window'
            }, '*');
        }
    }

    /**
     * 原紙ファイルを読み込む
     * プラグインの type="base" で basefile が指定されているものを対象
     */
    async loadBaseFiles() {
        console.log('[BaseFileManager] 原紙ファイル読み込み開始');

        try {
            // 親ウィンドウにプラグイン一覧を要求
            console.log('[BaseFileManager] request-base-plugins送信中...');
            console.log('[BaseFileManager] window.parent:', window.parent);
            window.parent.postMessage({
                type: 'request-base-plugins'
            }, '*');
            console.log('[BaseFileManager] request-base-plugins送信完了');

            // レスポンスを待つ
            console.log('[BaseFileManager] レスポンス待機中...');
            const response = await this.waitForMessage('base-plugins-response', 5000);
            console.log('[BaseFileManager] レスポンス受信:', response);

            if (response && response.plugins) {
                console.log('[BaseFileManager] 原紙プラグイン:', response.plugins);

                // 原紙ファイルを読み込んで表示
                await this.loadAndDisplayBaseFiles(response.plugins);
            } else {
                console.warn('[BaseFileManager] 原紙プラグインが見つかりません');
            }

        } catch (error) {
            console.error('[BaseFileManager] 原紙ファイル読み込みエラー:', error);
        }
    }

    /**
     * メッセージを待つヘルパー関数
     */
    waitForMessage(messageType, timeout = 5000) {
        return new Promise((resolve, reject) => {
            const handler = (event) => {
                if (event.data && event.data.type === messageType) {
                    window.removeEventListener('message', handler);
                    clearTimeout(timer);
                    resolve(event.data);
                }
            };

            const timer = setTimeout(() => {
                window.removeEventListener('message', handler);
                reject(new Error(`Timeout waiting for ${messageType}`));
            }, timeout);

            window.addEventListener('message', handler);
        });
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

                console.log(`[BaseFileManager] 読み込み: ${plugin.name} (${basefileName})`);

                try {
                    // 原紙ファイルのパスを構築（相対パス）
                    const basefilePath = `../../plugins/${plugin.id}/${basefileName}`;

                    // ファイルを読み込む
                    const response = await fetch(basefilePath);
                    if (!response.ok) {
                        console.warn(`[BaseFileManager] ファイルが見つかりません: ${basefilePath}`);
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

                        console.log(`[BaseFileManager] 追加: ${displayName} realId: ${realId} icon: ${iconFile}`);
                    }

                } catch (error) {
                    console.error(`[BaseFileManager] ファイル読み込みエラー (${plugin.name}):`, error);
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
            console.log('[BaseFileManager] XML形式のファイル:', xmlText.substring(0, 100) + '...');
            return xmlText;
        }

        // TADバイナリ形式の場合はparsTADToXMLで変換
        if (window.parent && typeof window.parent.parseTADToXML === 'function') {
            try {
                const xmlResult = await window.parent.parseTADToXML(rawData, 0);
                return xmlResult;
            } catch (error) {
                console.error('[BaseFileManager] XML変換エラー:', error);
                return null;
            }
        }
        console.warn('[BaseFileManager] parseTADToXML関数が見つかりません');
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

        console.log(`[BaseFileManager] ${this.baseFiles.length}個の原紙を表示`);
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
        console.log('[BaseFileManager] アイコン読み込み:', realId, baseFile.iconFile);

        // キャッシュにあればそれを返す
        if (this.iconCache.has(realId)) {
            console.log('[BaseFileManager] アイコンキャッシュヒット:', realId);
            return this.iconCache.get(realId);
        }

        // iconFileがない場合
        if (!baseFile.iconFile) {
            console.log('[BaseFileManager] アイコンファイルが設定されていません:', realId);
            return null;
        }

        try {
            // アイコンファイルのパスを構築
            const iconPath = `../../plugins/${baseFile.pluginId}/${baseFile.iconFile}`;
            console.log('[BaseFileManager] アイコンパス:', iconPath);

            // アイコンファイルを読み込む
            const response = await fetch(iconPath);
            if (!response.ok) {
                console.warn('[BaseFileManager] アイコンファイルが見つかりません:', iconPath);
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
            console.log('[BaseFileManager] アイコン読み込み成功:', realId);

            return base64;
        } catch (error) {
            console.error('[BaseFileManager] アイコン読み込みエラー:', realId, error);
            return null;
        }
    }

    /**
     * ドラッグ開始処理
     */
    handleDragStart(event, baseFile, index) {
        console.log('[BaseFileManager] ドラッグ開始:', baseFile.displayName);

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
        console.log('[BaseFileManager] ドラッグ終了');

        // スタイルを元に戻す
        event.target.style.opacity = '1';
    }

    /**
     * 原紙ファイルを開く
     */
    openBaseFile(baseFile) {
        console.log('[BaseFileManager] 原紙ファイルを開く:', baseFile.displayName);

        // 親ウィンドウに原紙ファイルを開くよう要求
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: 'open-base-file',
                pluginId: baseFile.pluginId,
                basefile: baseFile.basefile,
                displayName: baseFile.displayName
            }, '*');
        }
    }

    /**
     * ウィンドウ設定（位置・サイズ・最大化状態）を更新
     * @param {Object} windowConfig - { pos: {x, y}, width, height, maximize }
     */
    updateWindowConfig(windowConfig) {
        if (window.parent && window.parent !== window && this.realId) {
            window.parent.postMessage({
                type: 'update-window-config',
                fileId: this.realId,
                windowConfig: windowConfig
            }, '*');

            console.log('[BaseFileManager] ウィンドウ設定を更新:', windowConfig);
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
                    console.log('[BaseFileManager] 背景色を適用:', bgColor);
                } else {
                    console.warn('[BaseFileManager] .base-file-list 要素が見つかりません');
                }
            }, 100);
        } else {
            console.log('[BaseFileManager] 背景色が設定されていません');
        }
    }

    /**
     * 背景色変更ダイアログを表示
     */
    async changeBgColor() {
        console.log('[BaseFileManager] changeBgColor開始 fileData:', this.fileData);
        return new Promise((resolve) => {
            const messageId = `bg_color_${Date.now()}_${Math.random()}`;

            // 現在の背景色を取得
            const currentBgColor = (this.fileData && this.fileData.windowConfig && this.fileData.windowConfig.backgroundColor)
                ? this.fileData.windowConfig.backgroundColor
                : '#ffffff';
            console.log('[BaseFileManager] 現在の背景色:', currentBgColor);

            // ダイアログのHTML要素を作成
            const dialogHtml = `
                <div style="margin-bottom: 10px;">ウインドウ背景色を選択してください。</div>
                <div style="margin-bottom: 10px;">
                    <label style="display: block; margin-bottom: 5px;">#FFFFFF形式で入力：</label>
                    <input type="text" id="bgColorInput" placeholder="#FFFFFF" value="${currentBgColor}"
                           style="width: 100%; padding: 5px; box-sizing: border-box;">
                </div>
            `;

            this.dialogCallbacks[messageId] = (result) => {
                console.log('[BaseFileManager] ダイアログコールバック呼び出し:', result);
                if (result.button === 'ok') {
                    const inputColor = result.input;
                    console.log('[BaseFileManager] 入力された色:', inputColor);

                    // 入力された色を検証
                    if (/^#[0-9A-Fa-f]{6}$/.test(inputColor)) {
                        const newBgColor = inputColor;
                        console.log('[BaseFileManager] 色検証OK:', newBgColor);

                        // コンテナと一覧の背景色を変更
                        const container = document.querySelector('.manager-container');
                        const list = document.querySelector('.base-file-list');
                        if (container) {
                            container.style.background = newBgColor;
                        }
                        if (list) {
                            list.style.background = newBgColor;
                            console.log('[BaseFileManager] 背景色を変更しました:', newBgColor);
                        } else {
                            console.error('[BaseFileManager] .base-file-listが見つかりません');
                        }

                        // 実身管理用セグメントのbackgroundColorを更新
                        if (this.realId && window.parent && window.parent !== window) {
                            window.parent.postMessage({
                                type: 'update-background-color',
                                fileId: this.realId,
                                backgroundColor: newBgColor
                            }, '*');
                            console.log('[BaseFileManager] 背景色更新を親ウィンドウに通知:', this.realId, newBgColor);
                        }

                        // this.fileDataを更新（再表示時に正しい色を適用するため）
                        if (!this.fileData) {
                            console.warn('[BaseFileManager] fileDataが未定義、初期化します');
                            this.fileData = {};
                        }
                        if (!this.fileData.windowConfig) {
                            this.fileData.windowConfig = {};
                        }
                        this.fileData.windowConfig.backgroundColor = newBgColor;
                        console.log('[BaseFileManager] fileData更新完了:', this.fileData);
                    } else {
                        console.warn('[BaseFileManager] 無効な色形式:', inputColor);
                    }
                } else {
                    console.log('[BaseFileManager] ダイアログがキャンセルされました');
                }
                resolve(result);
            };

            // 親ウィンドウにカスタムダイアログ表示を要求
            if (window.parent && window.parent !== window) {
                console.log('[BaseFileManager] ダイアログ表示要求送信:', messageId);
                window.parent.postMessage({
                    type: 'show-custom-dialog',
                    messageId: messageId,
                    dialogHtml: dialogHtml,
                    buttons: [
                        { label: '取消', value: 'cancel' },
                        { label: '設定', value: 'ok' }
                    ],
                    defaultButton: 1,
                    inputs: {
                        text: 'bgColorInput'
                    }
                }, '*');
                console.log('[BaseFileManager] ダイアログ表示要求送信完了');
            } else {
                console.error('[BaseFileManager] 親ウィンドウが存在しません');
            }
        });
    }

    /**
     * 全画面表示を切り替え
     */
    toggleFullscreen() {
        // 親ウィンドウにメッセージを送信してウィンドウを最大化/元に戻す
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: 'toggle-maximize'
            }, '*');

            this.isFullscreen = !this.isFullscreen;
            console.log('[BaseFileManager] 全画面表示:', this.isFullscreen ? 'ON' : 'OFF');

            // 実身管理用セグメントのfullscreenフラグを更新
            if (this.realId && window.parent && window.parent !== window) {
                window.parent.postMessage({
                    type: 'update-fullscreen-state',
                    fileId: this.realId,
                    isFullscreen: this.isFullscreen
                }, '*');
                console.log('[BaseFileManager] 全画面表示状態更新を親ウィンドウに通知:', this.realId, this.isFullscreen);
            }
        }
    }
}

// DOMContentLoaded後に初期化
document.addEventListener('DOMContentLoaded', () => {
    window.baseFileManager = new BaseFileManager();
});
