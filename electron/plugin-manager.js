/**
 * プラグインマネージャー (レンダラープロセス用)
 * ブラウザ環境でプラグインを管理
 * @module electron/plugin-manager
 *
 */
class PluginManager {
    constructor() {
        this.plugins = new Map();
        this.contextMenuHandlers = [];
    }

    /**
     * プラグインを初期化
     */
    async initialize() {
        // Electron環境の場合（nodeIntegration有効）
        if (typeof require !== 'undefined') {
            try {
                const { ipcRenderer } = require('electron');
                const plugins = await ipcRenderer.invoke('get-plugins');
                console.log('メインプロセスからプラグインを取得:', plugins);
                plugins.forEach(plugin => {
                    this.registerPlugin(plugin);
                });
            } catch (error) {
                console.error('プラグイン取得エラー:', error);
                // フォールバック: ブラウザモード
                await this.registerDemoPlugins();
            }
        }
        // Electron環境の場合（contextBridge使用）
        else if (typeof window.electronAPI !== 'undefined') {
            const plugins = await window.electronAPI.getPlugins();
            plugins.forEach(plugin => {
                this.registerPlugin(plugin);
            });
        }
        // ブラウザ環境の場合（開発用）
        else {
            console.warn('Electron APIが見つかりません。ブラウザモードで起動しています。');
            // デモ用プラグインを登録
            await this.registerDemoPlugins();
        }

        console.log(`${this.plugins.size}個のプラグインを登録しました`);

        // 初期化完了イベントを発火
        window.dispatchEvent(new CustomEvent('plugin-manager-ready', {
            detail: { pluginCount: this.plugins.size }
        }));
    }

    /**
     * プラグインを登録
     */
    registerPlugin(plugin) {
        this.plugins.set(plugin.id, plugin);

        // コンテキストメニューハンドラを登録
        if (plugin.contextMenu && Array.isArray(plugin.contextMenu)) {
            plugin.contextMenu.forEach(menuItem => {
                this.contextMenuHandlers.push({
                    pluginId: plugin.id,
                    label: menuItem.label,
                    fileTypes: menuItem.fileTypes || ['*'],
                    action: menuItem.action
                });
            });
        }
    }

    /**
     * デモ用プラグインを登録（開発用）
     */
    async registerDemoPlugins() {
        // plugins/ディレクトリ内の各プラグインのplugin.jsonを読み込む
        const pluginDirs = [
            'basic-text-editor',
            'virtual-object-list',
            'base-file-manager',
            'unpack-file',
            'tadjs-view',
            'system-config',
            'user-config'
        ];

        for (const dir of pluginDirs) {
            try {
                const response = await fetch(`plugins/${dir}/plugin.json`);
                if (response.ok) {
                    const pluginConfig = await response.json();
                    console.log(`[PluginManager] plugin.json読み込み成功 (${dir}):`, pluginConfig);
                    // mainパスを補完
                    if (pluginConfig.main && !pluginConfig.main.startsWith('plugins/')) {
                        pluginConfig.main = `plugins/${dir}/${pluginConfig.main}`;
                    }
                    this.registerPlugin(pluginConfig);
                    console.log(`[PluginManager] プラグイン登録完了: ${pluginConfig.name} (${pluginConfig.id}), type: ${pluginConfig.type}, basefile:`, pluginConfig.basefile);
                } else {
                    console.warn(`[PluginManager] plugin.jsonが見つかりません: plugins/${dir}/plugin.json`);
                }
            } catch (error) {
                console.error(`[PluginManager] プラグイン読み込みエラー (${dir}):`, error);
            }
        }

        // 以下は互換性のため残す（plugin.jsonがない場合のフォールバック）
        const demoPlugin = {
            id: 'basic-text-editor',
            name: '基本文章編集',
            version: '1.0.0',
            description: 'TADファイル用リッチテキストエディタ',
            main: 'plugins/basic-text-editor/index.html',
            window: {
                width: 800,
                height: 600,
                resizable: true,
                scrollable: true
            },
            contextMenu: [
                {
                    label: '基本文章編集',
                    fileTypes: ['tad', 'TAD', 'bpk', 'BPK'],
                    action: 'open-editor'
                }
            ]
        };

        const systemConfigPlugin = {
            id: 'system-config',
            name: 'システム環境設定',
            version: '1.0.0',
            type: 'accessory',
            description: 'システム全体の環境設定を行います',
            icon: '⚙️',
            main: 'plugins/system-config/index.html',
            window: {
                width: 500,
                height: 380,
                resizable: false,
                scrollable: false,
                singleInstance: true
            }
        };

        const userConfigPlugin = {
            id: 'user-config',
            name: 'ユーザ環境設定',
            version: '1.0.0',
            type: 'accessory',
            description: 'ユーザごとの環境設定を行います',
            icon: '👤',
            main: 'plugins/user-config/index.html',
            window: {
                width: 450,
                height: 320,
                resizable: false,
                scrollable: false,
                singleInstance: true
            }
        };

        const virtualObjectListPlugin = {
            id: 'virtual-object-list',
            name: '仮身一覧',
            version: '1.0.0',
            type: 'viewer',
            description: 'TADファイル内の仮身を一覧表示します',
            main: 'plugins/virtual-object-list/index.html',
            window: {
                width: 600,
                height: 500,
                resizable: true,
                scrollable: true
            },
            contextMenu: [
                {
                    label: '仮身一覧',
                    fileTypes: ['tad', 'TAD', 'bpk', 'BPK'],
                    action: 'open-virtual-list'
                }
            ]
        };

        const trashRealObjectsPlugin = {
            id: 'trash-real-objects',
            name: '屑実身操作',
            version: '1.0.0',
            type: 'utility',
            description: 'refCount=0の屑実身を一覧表示します',
            main: 'plugins/trash-real-objects/index.html',
            window: {
                width: 600,
                height: 500,
                resizable: true,
                scrollable: true
            }
        };

        const baseFileManagerPlugin = {
            id: 'base-file-manager',
            name: '原紙箱',
            version: '1.0.0',
            type: 'base',
            basefile: 'base-file-manager.xtad',
            description: '原紙ファイルを管理し、仮身形式で一覧表示します',
            icon: '📑',
            main: 'plugins/base-file-manager/index.html',
            window: {
                width: 700,
                height: 500,
                resizable: true,
                scrollable: true
            },
            contextMenu: [
                {
                    label: '原紙箱',
                    fileTypes: ['xtad', 'XTAD'],
                    action: 'open-base-manager'
                }
            ]
        };

        const unpackFilePlugin = {
            id: 'unpack-file',
            name: '書庫解凍',
            version: '1.0.0',
            type: 'base',
            basefile: 'unpack-file.xtad',
            description: 'BPK書庫ファイルを解凍し、実身ファイルを生成します',
            icon: '📦',
            main: 'plugins/unpack-file/index.html',
            window: {
                width: 200,
                height: 50,
                resizable: false,
                scrollable: false
            },
            contextMenu: [
                {
                    label: '書庫解凍',
                    fileTypes: ['bpk', 'BPK'],
                    action: 'open-unpack'
                }
            ]
        };

        const tadjsViewPlugin = {
            id: 'tadjs-view',
            name: 'TADjs表示',
            version: '1.0.0',
            type: 'genko',
            description: 'TADファイルとBPKファイルを表示します',
            icon: '📄',
            main: 'plugins/tadjs-view/index.html',
            window: {
                width: 800,
                height: 600,
                resizable: true,
                scrollable: true
            }
        };

    }

    /**
     * 原紙タイプのプラグイン一覧を取得
     */
    getBasePlugins() {
        const allPlugins = Array.from(this.plugins.values());
        const basePlugins = allPlugins.filter(plugin => plugin.type === 'base');
        return basePlugins;
    }

    /**
     * プラグイン一覧を取得
     */
    getPlugins() {
        return Array.from(this.plugins.values());
    }

    /**
     * 特定のプラグインを取得
     */
    getPlugin(pluginId) {
        return this.plugins.get(pluginId);
    }

    /**
     * ファイルタイプに対応するコンテキストメニューを取得
     */
    getContextMenuForFile(fileName) {
        const ext = fileName.split('.').pop().toLowerCase();

        return this.contextMenuHandlers.filter(handler => {
            return handler.fileTypes.includes('*') ||
                   handler.fileTypes.includes(ext) ||
                   handler.fileTypes.includes(ext.toUpperCase());
        });
    }

    /**
     * 小物タイプのプラグイン一覧を取得
     */
    getAccessoryPlugins() {
        return Array.from(this.plugins.values()).filter(plugin => plugin.type === 'accessory');
    }

    /**
     * 実身を開くことができるプラグイン（実行可能プラグイン）を取得
     * @returns {Array<Object>} 実行可能プラグインの配列
     */
    getExecutablePlugins() {
        return Array.from(this.plugins.values()).filter(plugin => {
            // openable: falseのプラグインは除外
            // openableが未定義の場合はtrueとして扱う
            return plugin.openable !== false;
        });
    }

    /**
     * プラグインを起動
     */
    async launchPlugin(pluginId, fileData = null) {
        const plugin = this.getPlugin(pluginId);
        if (!plugin) {
            console.error(`プラグインが見つかりません: ${pluginId}`);
            return null;
        }

        // singleInstanceチェック
        if (plugin.window && plugin.window.singleInstance) {
            // 既に起動しているか確認
            const existingWindow = this.findPluginWindow(pluginId);
            if (existingWindow) {
                // 既存のウィンドウにフォーカスを移動
                console.log(`[PluginManager] ${plugin.name} は既に起動しています。フォーカスを移動します。`);
                if (window.tadjsDesktop) {
                    window.tadjsDesktop.setActiveWindow(existingWindow);
                }
                return existingWindow;
            }
        }

        // 小物アプリ（accessory）でbasefileが設定されている場合は読み込む
        if (plugin.type === 'accessory' && plugin.basefile && !fileData) {
            console.log(`[PluginManager] 小物アプリ ${plugin.name} のbasefileを読み込みます:`, plugin.basefile);
            console.log(`[PluginManager] plugin.main:`, plugin.main);
            try {
                // 実身IDを取得（拡張子を除去）
                const realId = plugin.basefile.json.replace(/\.json$/, '');

                // まず、保存された実身ファイル（アプリルート）を読み込もうとする
                let jsonData = null;
                let xmlData = null;

                if (typeof require !== 'undefined' && typeof process !== 'undefined' && process.versions && process.versions.electron) {
                    // Electron環境の場合、保存されたファイルを読み込む
                    try {
                        const basePath = window.tadjsDesktop.getDataBasePath();

                        const jsonResult = await window.tadjsDesktop.loadDataFile(basePath, `${realId}.json`);
                        if (jsonResult.success) {
                            jsonData = JSON.parse(jsonResult.data);
                            console.log(`[PluginManager] 保存されたJSONファイルを読み込み:`, jsonData.name);
                            console.log(`[PluginManager] window設定:`, jsonData.window);
                            console.log(`[PluginManager] pos:`, jsonData.window?.pos);
                        } else {
                            console.log(`[PluginManager] JSON読み込み失敗:`, jsonResult.error);
                        }

                        const xtadResult = await window.tadjsDesktop.loadDataFile(basePath, `${realId}_0.xtad`);
                        if (xtadResult.success) {
                            xmlData = xtadResult.data;
                            console.log(`[PluginManager] 保存されたXTADファイルを読み込み: ${xmlData.length}文字`);
                        } else {
                            console.log(`[PluginManager] XTAD読み込み失敗:`, xtadResult.error);
                        }
                    } catch (error) {
                        console.log(`[PluginManager] 保存されたファイル読み込みエラー:`, error);
                    }
                }

                // 保存されたファイルがない場合は、プラグインフォルダ内のデフォルトファイルを読み込む
                if (!jsonData || !xmlData) {
                    // Windowsのバックスラッシュをスラッシュに変換
                    const normalizedMain = plugin.main.replace(/\\/g, '/');
                    console.log(`[PluginManager] normalizedMain:`, normalizedMain);

                    // plugin.mainから相対パスを生成（例: plugins/system-config/index.html -> plugins/system-config）
                    let pluginDir = normalizedMain.substring(0, normalizedMain.lastIndexOf('/'));
                    console.log(`[PluginManager] pluginDir (before):`, pluginDir);

                    // 絶対パスの場合は、pluginsディレクトリ以降を抽出
                    const pluginsIndex = pluginDir.indexOf('plugins/');
                    if (pluginsIndex !== -1) {
                        pluginDir = pluginDir.substring(pluginsIndex);
                    }
                    console.log(`[PluginManager] pluginDir (after):`, pluginDir);

                    const jsonPath = `${pluginDir}/${plugin.basefile.json}`;
                    const xtadPath = `${pluginDir}/${plugin.basefile.xmltad}`;

                    console.log(`[PluginManager] JSONパス: ${jsonPath}, XTADパス: ${xtadPath}`);

                    // JSONファイルを読み込む
                    if (!jsonData) {
                        const jsonResponse = await fetch(jsonPath);
                        if (!jsonResponse.ok) {
                            throw new Error(`JSONファイルが見つかりません: ${jsonPath}`);
                        }
                        jsonData = await jsonResponse.json();
                        console.log(`[PluginManager] デフォルトJSON読み込み完了:`, jsonData.name);
                    }

                    // XTADファイルを読み込む
                    if (!xmlData) {
                        const xtadResponse = await fetch(xtadPath);
                        if (!xtadResponse.ok) {
                            throw new Error(`XTADファイルが見つかりません: ${xtadPath}`);
                        }
                        xmlData = await xtadResponse.text();
                        console.log(`[PluginManager] デフォルトXTAD読み込み完了: ${xmlData.length}文字`);
                    }
                }

                // fileDataを作成
                fileData = {
                    realId: realId,
                    fileId: `${realId}_0.xtad`,
                    fileName: plugin.basefile.xmltad,
                    displayName: jsonData.name || plugin.name,
                    xmlData: xmlData,
                    windowConfig: jsonData.window
                };

                console.log(`[PluginManager] 小物アプリのfileDataを作成:`, fileData);
                console.log(`[PluginManager] windowConfig.pos:`, fileData.windowConfig?.pos);
            } catch (error) {
                console.error(`[PluginManager] basefile読み込みエラー:`, error);
                // エラーが発生してもウィンドウは開く（fileDataなし）
            }
        }

        // プラグインウィンドウを作成
        return await this.createPluginWindow(plugin, fileData);
    }

    /**
     * 指定されたプラグインIDのウィンドウを検索
     */
    findPluginWindow(pluginId) {
        if (!window.tadjsDesktop || !window.tadjsDesktop.windows) {
            return null;
        }

        for (const [windowId, windowInfo] of window.tadjsDesktop.windows) {
            if (windowInfo.pluginId === pluginId) {
                return windowId;
            }
        }
        return null;
    }

    /**
     * プラグインウィンドウを作成
     */
    async createPluginWindow(plugin, fileData) {
        // TADjsDesktopを使用してプラグインウィンドウを作成
        if (typeof window.tadjsDesktop !== 'undefined') {
            const { iframeHtml, iframeId, pluginSrc } = this.createPluginContent(plugin, fileData);

            // プラグインタイプに応じてウィンドウサイズを決定
            let windowOptions = {
                width: 800,
                height: 600,
                x: 100,
                y: 100,
                resizable: true
            };

            // fileDataのwindowConfig設定を最優先で使用（実身のJSONファイル設定）
            if (fileData && fileData.windowConfig) {
                console.log(`[PluginManager] 実身JSONファイルのwindow設定:`, fileData.windowConfig);
                windowOptions = {
                    width: fileData.windowConfig.width || 800,
                    height: fileData.windowConfig.height || 600,
                    x: fileData.windowConfig.pos ? fileData.windowConfig.pos.x : 100,
                    y: fileData.windowConfig.pos ? fileData.windowConfig.pos.y : 100,
                    resizable: fileData.windowConfig.resizable !== undefined ? fileData.windowConfig.resizable : true,
                    scrollable: fileData.windowConfig.scrollable !== undefined ? fileData.windowConfig.scrollable : true,
                    maximize: fileData.windowConfig.maximize !== undefined ? fileData.windowConfig.maximize : false,
                    maximizable: fileData.windowConfig.maximizable !== undefined ? fileData.windowConfig.maximizable : true,
                    minimizable: fileData.windowConfig.minimizable !== undefined ? fileData.windowConfig.minimizable : true,
                    closable: fileData.windowConfig.closable !== undefined ? fileData.windowConfig.closable : true,
                    alwaysOnTop: fileData.windowConfig.alwaysOnTop !== undefined ? fileData.windowConfig.alwaysOnTop : false,
                    skipTaskbar: fileData.windowConfig.skipTaskbar !== undefined ? fileData.windowConfig.skipTaskbar : false,
                    frame: fileData.windowConfig.frame !== undefined ? fileData.windowConfig.frame : true,
                    transparent: fileData.windowConfig.transparent !== undefined ? fileData.windowConfig.transparent : false
                };
                console.log(`[PluginManager] 適用するwindowOptions (実身設定):`, windowOptions);
            }
            // プラグインのwindow設定があれば使用
            else if (plugin.window) {
                console.log(`[PluginManager] プラグイン "${plugin.name}" (${plugin.id}) のwindow設定:`, plugin.window);
                windowOptions = {
                    width: plugin.window.width || 800,
                    height: plugin.window.height || 600,
                    x: 100,
                    y: 100,
                    resizable: plugin.window.resizable !== undefined ? plugin.window.resizable : true,
                    scrollable: plugin.window.scrollable !== undefined ? plugin.window.scrollable : true,
                    maximize: plugin.window.maximize !== undefined ? plugin.window.maximize : false,
                    maximizable: plugin.window.maximizable !== undefined ? plugin.window.maximizable : true,
                    minimizable: plugin.window.minimizable !== undefined ? plugin.window.minimizable : true,
                    closable: plugin.window.closable !== undefined ? plugin.window.closable : true,
                    alwaysOnTop: plugin.window.alwaysOnTop !== undefined ? plugin.window.alwaysOnTop : false,
                    skipTaskbar: plugin.window.skipTaskbar !== undefined ? plugin.window.skipTaskbar : false,
                    frame: plugin.window.frame !== undefined ? plugin.window.frame : true,
                    transparent: plugin.window.transparent !== undefined ? plugin.window.transparent : false
                };
                console.log(`[PluginManager] 適用するwindowOptions (プラグイン設定):`, windowOptions);
            }
            // 小物プラグインでwindow設定がない場合はデフォルト
            else if (plugin.type === 'accessory') {
                windowOptions = {
                    width: 500,
                    height: 380,
                    x: 100,
                    y: 100,
                    resizable: false
                };
            }
            else {
                console.log(`[PluginManager] プラグイン "${plugin.name}" (${plugin.id}) にはwindow設定がありません。デフォルトを使用します。`);
            }

            // openableフラグをチェック
            const isOpenable = plugin.window && plugin.window.openable !== undefined ? plugin.window.openable : true;

            // openable: falseの場合は、ウィンドウを開かずにプラグインを実行
            if (!isOpenable) {
                console.log(`[PluginManager] プラグイン "${plugin.name}" は openable: false のため、ウィンドウを開きません`);

                // 非表示のiframeを作成してプラグインを実行
                const hiddenIframeId = `plugin-iframe-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                const hiddenIframe = document.createElement('iframe');
                hiddenIframe.id = hiddenIframeId;
                hiddenIframe.style.display = 'none';
                // IMPORTANT: nodeintegration属性を先に設定してからsrcを設定
                hiddenIframe.setAttribute('nodeintegration', '');
                hiddenIframe.setAttribute('data-plugin-id', plugin.id);
                hiddenIframe.src = plugin.main; // nodeintegration設定後にsrcを設定
                document.body.appendChild(hiddenIframe);

                // iframeが読み込まれたら、initメッセージを送信
                hiddenIframe.addEventListener('load', () => {
                    console.log(`[PluginManager] 非表示プラグイン読み込み完了: ${plugin.name}`);

                    const initData = {
                        type: 'init',
                        fileData: fileData || {},
                        windowId: null // ウィンドウIDはnull
                    };

                    hiddenIframe.contentWindow.postMessage(initData, '*');
                });

                return null; // ウィンドウIDはnull
            }

            // ウィンドウタイトルを決定（fileDataのdisplayNameを優先）
            const windowTitle = (fileData && fileData.displayName) || plugin.name;

            // 実身のアイコンを読み込む（realIdがある場合）
            if (fileData && fileData.realId) {
                try {
                    const iconResult = await window.tadjsDesktop.readIconFile(fileData.realId);
                    if (iconResult.success && iconResult.data) {
                        // Base64エンコードされたアイコンデータをwindowOptionsに追加
                        windowOptions.iconData = iconResult.data;
                        console.log(`[PluginManager] 実身アイコンを読み込みました: ${fileData.realId}`);
                    }
                } catch (error) {
                    console.warn(`[PluginManager] アイコン読み込みエラー: ${error.message}`);
                }
            }

            const windowId = window.tadjsDesktop.createWindow(
                windowTitle,
                iframeHtml,
                windowOptions
            );

            // プラグイン固有のデータを保存
            const windowInfo = window.tadjsDesktop.windows.get(windowId);
            if (windowInfo) {
                windowInfo.pluginId = plugin.id;
                windowInfo.fileData = fileData;
            }

            // IMPORTANT: iframe設定（nodeintegration属性を設定してからsrcを設定）
            setTimeout(() => {
                const iframe = document.getElementById(iframeId);
                if (iframe) {
                    // nodeintegration属性を設定してからsrcを設定（これが重要！）
                    iframe.setAttribute('nodeintegration', '');
                    console.log(`[PluginManager] nodeintegration属性を設定: ${iframeId}`);

                    // srcを設定（nodeintegration設定後）
                    iframe.src = pluginSrc;
                    console.log(`[PluginManager] iframe srcを設定: ${pluginSrc}`);
                }
            }, 50); // iframe作成を待つ

            // 親MessageBusに子(iframe)を登録
            // IMPORTANT: initメッセージ送信前に登録する必要があるため、initializePluginMessaging内で登録
            // registerChildの呼び出しはinitializePluginMessagingに移動

            // プラグインへのメッセージ送信を初期化
            this.initializePluginMessaging(iframeId, plugin, fileData, windowId);

            console.log(`プラグインウィンドウを作成しました: ${plugin.name} (${windowId})`);
            return windowId;
        } else {
            console.error('TADjsDesktopが見つかりません');
            return null;
        }
    }

    /**
     * プラグインコンテンツを作成
     */
    createPluginContent(plugin, fileData) {
        // iframeのIDを生成
        const iframeId = `plugin-iframe-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        console.log('プラグインコンテンツ作成:', plugin.id, 'xmlData length:', fileData && fileData.xmlData ? fileData.xmlData.length : 0);

        // iframeのHTML文字列を返す（srcは後から設定）
        const iframeHtml = `
            <iframe id="${iframeId}"
                    style="width: 100%; height: 100%; border: none;"
                    tabindex="0"
                    data-plugin-id="${plugin.id}"
                    data-plugin-src="${plugin.main}">
            </iframe>
        `;

        return { iframeHtml, iframeId, pluginSrc: plugin.main };
    }

    /**
     * プラグインへのメッセージ送信を初期化
     */
    initializePluginMessaging(iframeId, plugin, fileData, windowId) {
        // iframeが読み込まれた後にpostMessageでデータを送信
        setTimeout(() => {
            const iframe = document.getElementById(iframeId);
            console.log('iframe検索:', iframeId, 'found:', !!iframe);
            if (iframe) {
                // 親MessageBusに子(iframe)を登録する関数
                // IMPORTANT: initメッセージ送信直前に登録することで、
                // プラグインからのメッセージを確実に受信できるようにする
                const registerChildIfNeeded = () => {
                    if (window.tadjsDesktop.parentMessageBus && iframe.contentWindow) {
                        // 既に登録されているかチェック
                        const existingChild = window.tadjsDesktop.parentMessageBus.children?.get(windowId);
                        if (!existingChild || existingChild.iframe !== iframe) {
                            window.tadjsDesktop.parentMessageBus.registerChild(windowId, iframe, {
                                windowId: windowId,
                                pluginId: plugin.id,
                                realId: fileData?.realId || null
                            });
                            console.log(`[PluginManager] 子を登録 windowId=${windowId}, pluginId=${plugin.id}, realId=${fileData?.realId}`);
                        }
                    }
                };

                let messageSent = false; // 二重送信防止フラグ
                let pluginReadyReceived = false; // plugin-ready受信フラグ
                let fallbackTimeoutId = null; // フォールバックタイムアウトID

                const sendMessage = () => {
                    if (messageSent) return; // 既に送信済みの場合はスキップ
                    if (iframe.contentWindow) {
                        messageSent = true; // 送信済みフラグを立てる
                        // フォールバックタイムアウトをクリア
                        if (fallbackTimeoutId) {
                            clearTimeout(fallbackTimeoutId);
                            fallbackTimeoutId = null;
                        }
                        // initメッセージ送信直前に子を登録
                        registerChildIfNeeded();

                        console.log('postMessage送信:', {
                            type: 'init',
                            pluginId: plugin.id,
                            windowId: windowId,
                            fileName: fileData ? fileData.fileName : null,
                            xmlDataLength: fileData && fileData.xmlData ? fileData.xmlData.length : 0,
                            rawDataLength: fileData && fileData.rawData ? fileData.rawData.length : 0,
                            fileDataKeys: fileData ? Object.keys(fileData) : [],
                            triggeredBy: pluginReadyReceived ? 'plugin-ready' : 'fallback-timeout'
                        });
                        iframe.contentWindow.postMessage({
                            type: 'init',
                            pluginId: plugin.id,
                            windowId: windowId,
                            fileData: fileData || null
                        }, '*');

                        // このウィンドウがアクティブなら window-activated を送信
                        // (setActiveWindowはプラグイン登録前に呼ばれるため、ここで補完)
                        if (window.tadjsDesktop?.windowManager?.activeWindow === windowId &&
                            window.tadjsDesktop?.parentMessageBus) {
                            window.tadjsDesktop.parentMessageBus.sendToWindow(windowId, 'window-activated', {});
                            console.log(`[PluginManager] window-activated送信: ${windowId}`);
                        }
                    }
                };

                // plugin-readyメッセージを待つリスナー
                const handlePluginReady = (event) => {
                    // このiframeからのメッセージかチェック
                    if (event.source !== iframe.contentWindow) return;
                    if (event.data && event.data.type === 'plugin-ready') {
                        console.log(`[PluginManager] plugin-ready受信: ${iframeId}`);
                        pluginReadyReceived = true;
                        window.removeEventListener('message', handlePluginReady);
                        sendMessage();
                    }
                };
                window.addEventListener('message', handlePluginReady);

                // loadイベントを待つ
                iframe.addEventListener('load', () => {
                    console.log('iframe loaded:', iframeId);
                    // plugin-readyを待つが、フォールバックタイムアウトも設定
                    if (!messageSent && !fallbackTimeoutId) {
                        fallbackTimeoutId = setTimeout(() => {
                            if (!messageSent) {
                                console.log(`[PluginManager] plugin-readyタイムアウト、フォールバック送信: ${iframeId}`);
                                window.removeEventListener('message', handlePluginReady);
                                sendMessage();
                            }
                        }, 500); // 500ms待ってもplugin-readyが来なければフォールバック
                    }
                });

                // 既に読み込まれている場合に備えてフォールバックタイムアウトを設定
                if (iframe.contentDocument && iframe.contentDocument.readyState === 'complete') {
                    console.log('iframe already loaded, waiting for plugin-ready:', iframeId);
                    if (!fallbackTimeoutId) {
                        fallbackTimeoutId = setTimeout(() => {
                            if (!messageSent) {
                                console.log(`[PluginManager] plugin-readyタイムアウト、フォールバック送信: ${iframeId}`);
                                window.removeEventListener('message', handlePluginReady);
                                sendMessage();
                            }
                        }, 500); // 500ms待ってもplugin-readyが来なければフォールバック
                    }
                }
            }
        }, 100);
    }
}

// グローバルに公開
window.PluginManager = PluginManager;
