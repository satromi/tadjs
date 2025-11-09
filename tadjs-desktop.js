/**
 * TADjs Desktop Environment
 * ブラウザ上でBTRON風デスクトップ環境を再現
 */

class TADjsDesktop {
    constructor() {
        this.windows = new Map();
        this.activeWindow = null;
        this.windowCounter = 0;
        // Canvas用の独立カウンタ（ウインドウカウンタと分離し最初のTADをcanvas-0にする）
        this.canvasCounter = 0;
        // 再利用可能なcanvas IDのプール
        this.availableCanvasIds = [];
        this.contextMenu = null;
        this.isDragging = false;
        this.isResizing = false;
        this.dragState = null;
        this.fileObjects = {}; // ファイルオブジェクトを保存
        this.statusMessageTimer = null; // ステータスメッセージのタイマー
        this.clipboard = null; // グローバルクリップボード（仮身データ）
        this.closeConfirmCallbacks = {}; // ウィンドウクローズ確認コールバック
        this.openedRealObjects = new Map(); // 開いている実身ID -> ウィンドウIDのマッピング

        // 実身仮身システム (init()で初期化)
        this.realObjectSystem = null;

        // 初期ウィンドウ作成済みフラグ
        this.initialWindowCreated = false;

        // Electron環境チェック（コンストラクタで1回だけ）
        this.isElectronEnv = typeof require !== 'undefined' &&
                              typeof process !== 'undefined' &&
                              process.versions &&
                              process.versions.electron;

        if (this.isElectronEnv) {
            // 依存関係を事前に解決（require呼び出しは1回だけ）
            this.fs = require('fs');
            this.path = require('path');
            this.process = require('process');

            // ベースパスをキャッシュ
            this._basePath = this._calculateBasePath();

            console.log(`[TADjs] Electron環境を検出: basePath=${this._basePath}`);
        } else {
            this.fs = null;
            this.path = null;
            this.process = null;
            this._basePath = '.';

            console.log('[TADjs] ブラウザ環境を検出');
        }

        this.init();
    }

    /**
     * デスクトップ環境を初期化
     */
    async init() {
        this.setupEventListeners();
        this.setupStatusBar();
        this.setupDropZone();

        // 前回設定された背景を読み込む
        this.loadSavedBackground();

        // ユーザ環境設定を適用
        this.applyUserConfig();

        // 実身仮身システム初期化
        await this.initRealObjectSystem();

        // プラグインマネージャーは既に初期化されているので、直接初期ウィンドウを作成
        this.createInitialWindow();

        console.log('TADjs Desktop Environment initialized');
    }

    /**
     * 実身仮身システムを初期化
     */
    async initRealObjectSystem() {
        console.log('[TADjs] initRealObjectSystem 開始');
        try {
            // 環境チェックは既にコンストラクタで実施済み
            if (this.isElectronEnv) {
                console.log('[TADjs] Electron環境を検出');

                // app.isPackagedの判定にはprocess.resourcesPathを使用
                let basePath;
                if (this.process.resourcesPath) {
                    // パッケージ化されている場合
                    basePath = this.path.join(this.process.resourcesPath, 'app');
                    console.log('[TADjs] パッケージ化環境');
                } else {
                    // 開発時: tadjs-desktop.jsと同じディレクトリ
                    basePath = this.path.dirname(require.main.filename);
                    console.log('[TADjs] 開発環境');
                }

                console.log('[TADjs] basePath:', basePath);
                const systemModulePath = this.path.join(basePath, 'js', 'real-object-system.js');
                console.log('[TADjs] systemModulePath:', systemModulePath);

                // ファイルの存在確認（this.fsを使用）
                if (!this.fs.existsSync(systemModulePath)) {
                    throw new Error(`モジュールファイルが見つかりません: ${systemModulePath}`);
                }
                console.log('[TADjs] モジュールファイル確認OK');

                console.log('[TADjs] モジュールを読み込み中...');
                // ES6 モジュールなので動的 import を使用
                const module = await import('file://' + systemModulePath);
                const { RealObjectSystem } = module;
                console.log('[TADjs] モジュール読み込み成功');

                console.log('[TADjs] RealObjectSystem インスタンス化中...');
                this.realObjectSystem = new RealObjectSystem();
                console.log('[TADjs] RealObjectSystem インスタンス化成功');
            } else {
                console.log('[TADjs] ブラウザ環境を検出');
                // ブラウザ環境では動的インポート
                const { RealObjectSystem } = await import('./js/real-object-system.js');

                this.realObjectSystem = new RealObjectSystem();
            }

            console.log('[TADjs] 実身仮身システム初期化完了（ファイル直接アクセスモード）');
            console.log('[TADjs] this.realObjectSystem:', this.realObjectSystem ? 'OK' : 'NULL');
        } catch (error) {
            console.error('[TADjs] 実身仮身システム初期化エラー:', error);
            console.error('[TADjs] エラースタック:', error.stack);
            // エラーが発生してもアプリケーションは継続
        }
    }

    /**
     * ベースパスを計算（private）
     */
    _calculateBasePath() {
        if (this.process.resourcesPath) {
            // パッケージ化されている場合: 実行ファイルと同じディレクトリ
            return this.path.dirname(this.process.execPath);
        } else {
            // 開発時: プロジェクトルート
            return this.path.dirname(require.main.filename);
        }
    }

    /**
     * データファイル（.json, .xtad）のベースパスを取得
     * @returns {string} データファイルのベースパス
     */
    getDataBasePath() {
        return this._basePath;
    }

    // 画像ファイルの絶対パスを取得
    getImageFilePath(fileName) {
        if (this.isElectronEnv) {
            return this.path.join(this._basePath, fileName);
        }
        return fileName;
    }

    /**
     * データファイルを読み込む
     * @param {string} basePath - ベースパス
     * @param {string} fileName - ファイル名
     * @returns {Promise<{success: boolean, data?: string, error?: string}>}
     */
    async loadDataFile(basePath, fileName) {
        // Electron環境の場合
        if (this.isElectronEnv) {
            const filePath = this.path.join(basePath, fileName);

            try {
                console.log('[TADjs] ファイルを読み込み:', filePath);

                if (!this.fs.existsSync(filePath)) {
                    return {
                        success: false,
                        error: `ファイルが見つかりません: ${filePath}`
                    };
                }

                const data = this.fs.readFileSync(filePath, 'utf8');
                return { success: true, data };
            } catch (error) {
                return {
                    success: false,
                    error: `ファイル読み込みエラー: ${error.message}`
                };
            }
        }

        // ブラウザ環境の場合: HTTP fetch
        try {
            const url = `/${fileName}`;
            const response = await fetch(url);

            if (response.ok) {
                const data = await response.text();
                return { success: true, data };
            } else {
                return {
                    success: false,
                    error: `HTTP ${response.status}: ${response.statusText}`
                };
            }
        } catch (error) {
            return {
                success: false,
                error: `Fetch エラー: ${error.message}`
            };
        }
    }

    /**
     * データファイルをFileオブジェクトとして読み込む
     * @param {string} fileName - ファイル名
     * @returns {Promise<File|null>} Fileオブジェクト、見つからない場合null
     */
    async loadDataFileAsFile(fileName) {
        // Electron環境の場合
        if (this.isElectronEnv) {
            const basePath = this._basePath;

            // exe置き場フォルダから探す
            let filePath = this.path.join(basePath, fileName);

            if (this.fs.existsSync(filePath)) {
                console.log('[TADjs] ファイルを読み込み:', filePath);
                const buffer = this.fs.readFileSync(filePath);
                const blob = new Blob([buffer]);
                return new File([blob], fileName, { type: 'application/octet-stream' });
            }

            // resources/appから探す
            if (this.process.resourcesPath) {
                filePath = this.path.join(this.process.resourcesPath, 'app', fileName);
                if (this.fs.existsSync(filePath)) {
                    console.log('[TADjs] ファイルを読み込み:', filePath);
                    const buffer = this.fs.readFileSync(filePath);
                    const blob = new Blob([buffer]);
                    return new File([blob], fileName, { type: 'application/octet-stream' });
                }
            }

            console.error('[TADjs] ファイルが見つかりません:', fileName);
            return null;
        }

        // ブラウザ環境の場合: HTTP fetch
        try {
            const url = `/${fileName}`;
            const response = await fetch(url);

            if (response.ok) {
                const blob = await response.blob();
                return new File([blob], fileName, { type: 'application/octet-stream' });
            } else {
                console.error('[TADjs] HTTP fetch失敗:', response.status, response.statusText);
                return null;
            }
        } catch (error) {
            console.error('[TADjs] Fetch エラー:', error);
            return null;
        }
    }

    /**
     * 外部ファイルをOSのデフォルトアプリで開く
     * @param {string} realId - 実身ID（ファイル名として使用）
     * @returns {Promise<{success: boolean, error?: string}>} 結果
     */
    async openExternalFile(realId) {
        // Electron環境の場合のみ動作
        if (this.isElectronEnv) {
            const { shell } = require('electron');
            const basePath = this._basePath;

            // exe置き場フォルダから探す
            let filePath = this.path.join(basePath, realId);

            if (this.fs.existsSync(filePath)) {
                console.log('[TADjs] 外部ファイルを開きます:', filePath);
                try {
                    const result = await shell.openPath(filePath);
                    if (result) {
                        // 空文字列以外が返された場合はエラー
                        console.error('[TADjs] ファイルを開けませんでした:', result);
                        return { success: false, error: result };
                    }
                    console.log('[TADjs] 外部ファイルを開きました:', filePath);
                    return { success: true };
                } catch (error) {
                    console.error('[TADjs] ファイルを開くエラー:', error);
                    return { success: false, error: error.message };
                }
            }

            console.error('[TADjs] ファイルが見つかりません:', realId);
            return { success: false, error: 'ファイルが見つかりません' };
        }

        // ブラウザ環境では動作しない
        console.warn('[TADjs] 外部ファイルを開く機能はElectron環境でのみ動作します');
        return { success: false, error: 'Electron環境でのみ動作します' };
    }

    /**
     * xtadファイルからテキストを読み取る
     * @param {string} realId - 実身ID
     * @returns {Promise<{success: boolean, text?: string, error?: string}>} 結果
     */
    async readXtadText(realId) {
        // Electron環境の場合のみ動作
        if (this.isElectronEnv) {
            const basePath = this._basePath;

            // xtadファイルのパスを構築
            // realIdが既に_0.xtadで終わっている場合はそのまま使用
            let xtadPath;
            if (realId.endsWith('_0.xtad') || realId.endsWith('.xtad')) {
                xtadPath = this.path.join(basePath, realId);
            } else {
                xtadPath = this.path.join(basePath, `${realId}_0.xtad`);
            }

            if (!this.fs.existsSync(xtadPath)) {
                console.error('[TADjs] xtadファイルが見つかりません:', xtadPath);
                return { success: false, error: 'xtadファイルが見つかりません' };
            }

            try {
                console.log('[TADjs] xtadファイルを読み込みます:', xtadPath);
                const xmlContent = this.fs.readFileSync(xtadPath, 'utf-8');

                // XMLからテキストを抽出
                // 1. <text>タグの内容を取得
                let text = '';
                const textMatch = xmlContent.match(/<text>([\s\S]*?)<\/text>/);
                if (textMatch) {
                    text = textMatch[1].trim();
                } else {
                    // 2. <document>タグ内の<p>タグからテキストを抽出
                    const documentMatch = xmlContent.match(/<document>([\s\S]*?)<\/document>/);
                    if (documentMatch) {
                        const documentContent = documentMatch[1];
                        // すべての<p>タグからテキストを抽出
                        const pMatches = documentContent.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g);
                        const lines = [];
                        for (const match of pMatches) {
                            // HTMLタグを除去してテキストのみを抽出
                            let lineText = match[1]
                                .replace(/<br\s*\/?>/gi, '')
                                .replace(/<[^>]+>/g, '')
                                .trim();
                            if (lineText) {
                                lines.push(lineText);
                            }
                        }
                        text = lines.join('\n');
                    }
                }

                console.log('[TADjs] xtadテキストを読み取りました:', text.substring(0, 100));
                return { success: true, text: text };
            } catch (error) {
                console.error('[TADjs] xtadファイルを読み込むエラー:', error);
                return { success: false, error: error.message };
            }
        }

        // ブラウザ環境では動作しない
        console.warn('[TADjs] xtadファイルを読み込む機能はElectron環境でのみ動作します');
        return { success: false, error: 'Electron環境でのみ動作します' };
    }

    /**
     * URLをブラウザで開く
     * @param {string} url - 開くURL
     * @returns {Promise<{success: boolean, error?: string}>} 結果
     */
    async openUrlExternal(url) {
        // Electron環境の場合のみ動作
        if (this.isElectronEnv) {
            const { shell } = require('electron');

            try {
                console.log('[TADjs] URLを開きます:', url);
                await shell.openExternal(url);
                console.log('[TADjs] URLを開きました:', url);
                return { success: true };
            } catch (error) {
                console.error('[TADjs] URLを開くエラー:', error);
                return { success: false, error: error.message };
            }
        }

        // ブラウザ環境では動作しない
        console.warn('[TADjs] URLを開く機能はElectron環境でのみ動作します');
        return { success: false, error: 'Electron環境でのみ動作します' };
    }

    /**
     * アイコンファイルを読み込む
     * @param {string} realId - 実身ID
     * @returns {Promise<{success: boolean, data?: string, error?: string}>} Base64エンコードされたアイコンデータ
     */
    async readIconFile(realId) {
        // Electron環境の場合のみ動作
        if (this.isElectronEnv) {
            const basePath = this._basePath;
            const iconPath = this.path.join(basePath, `${realId}.ico`);

            try {
                // アイコンファイルが存在するかチェック
                if (!this.fs.existsSync(iconPath)) {
                    console.log('[TADjs] アイコンファイルが見つかりません:', iconPath);
                    return { success: false, error: 'Icon file not found' };
                }

                console.log('[TADjs] アイコンファイルを読み込みます:', iconPath);
                const buffer = this.fs.readFileSync(iconPath);
                const base64 = buffer.toString('base64');
                console.log('[TADjs] アイコンファイル読み込み成功:', iconPath, 'サイズ:', buffer.length, 'bytes');
                return { success: true, data: base64 };
            } catch (error) {
                console.error('[TADjs] アイコンファイル読み込みエラー:', error);
                return { success: false, error: error.message };
            }
        }

        // ブラウザ環境では動作しない
        console.warn('[TADjs] アイコンファイル読み込み機能はElectron環境でのみ動作します');
        return { success: false, error: 'Electron環境でのみ動作します' };
    }

    /**
     * データファイルを保存する
     * @param {string} fileName - ファイル名
     * @param {string|ArrayBuffer|Uint8Array} data - 保存するデータ
     * @returns {Promise<boolean>} 成功した場合true
     */
    async saveDataFile(fileName, data) {
        // Electron環境の場合
        if (this.isElectronEnv) {
            const basePath = this._basePath;
            const filePath = this.path.join(basePath, fileName);

            try {
                console.log('[TADjs] ファイルを保存:', filePath);

                // データをBufferに変換
                let buffer;
                if (typeof data === 'string') {
                    buffer = Buffer.from(data, 'utf8');
                } else if (data instanceof Uint8Array) {
                    buffer = Buffer.from(data);
                } else if (data instanceof ArrayBuffer) {
                    buffer = Buffer.from(new Uint8Array(data));
                } else {
                    buffer = Buffer.from(data);
                }

                this.fs.writeFileSync(filePath, buffer);
                console.log('[TADjs] ファイル保存成功:', filePath);
                return true;
            } catch (error) {
                console.error('[TADjs] ファイル保存エラー:', error);
                return false;
            }
        }

        // ブラウザ環境では保存不可
        console.warn('[TADjs] ブラウザ環境ではファイル保存はサポートされていません');
        return false;
    }

    /**
     * プラグインマネージャーの初期化を待ってから初期ウィンドウを作成
     */
    waitForPluginManagerAndCreateWindow() {
        // プラグインマネージャーの初期化完了イベントを待つ
        window.addEventListener('plugin-manager-ready', (e) => {
            if (this.initialWindowCreated) {
                console.log('[TADjs] 初期ウィンドウは既に作成済みです');
                return;
            }
            console.log('[TADjs] プラグインマネージャー初期化完了:', e.detail.pluginCount, '個のプラグイン登録');
            this.initialWindowCreated = true;
            this.createInitialWindow();
        }, { once: true });

        // タイムアウト処理（10秒待ってもイベントが来ない場合）
        setTimeout(() => {
            if (this.initialWindowCreated) {
                console.log('[TADjs] 初期ウィンドウは既に作成済みです（タイムアウト処理）');
                return;
            }
            if (window.pluginManager && window.pluginManager.plugins.size > 0) {
                console.warn('[TADjs] プラグインマネージャーイベントを待機中にタイムアウト、強制実行します');
                this.initialWindowCreated = true;
                this.createInitialWindow();
            }
        }, 10000);
    }

    /**
     * 保存された背景設定を読み込んで適用
     */
    loadSavedBackground() {
        const savedBackground = localStorage.getItem('selectedBackground');
        if (savedBackground) {
            this.applyBackgroundToDesktop(savedBackground);
        }
    }

    /**
     * 初期表示用のファイル一覧ウインドウを作成
     * デフォルトで仮身一覧プラグインを開く
     */
    async createInitialWindow() {
        // デフォルト実身ファイルID
        const defaultFileId = '0199ce83-6e83-7d42-8962-d2ad8c721654';
        const defaultJsonFile = `${defaultFileId}.json`;
        const defaultXtadFile = `${defaultFileId}_0.xtad`;

        console.log('[TADjs] デフォルトウィンドウを仮身一覧プラグインで開きます');
        console.log('[TADjs] 実身ファイル:', defaultJsonFile, defaultXtadFile);

        // データファイルのベースパスを取得
        const dataBasePath = this.getDataBasePath();
        console.log('[TADjs] データファイルのベースパス:', dataBasePath);

        // 仮身一覧プラグインを起動
        if (window.pluginManager) {
            const virtualObjectListPlugin = window.pluginManager.getPlugin('virtual-object-list');
            if (virtualObjectListPlugin) {
                try {
                    // JSONファイルを読み込む
                    console.log('[TADjs] JSONファイルを読み込み中:', defaultJsonFile);
                    const jsonResponse = await this.loadDataFile(dataBasePath, defaultJsonFile);

                    let windowConfig = null;
                    let applist = null;
                    let backgroundColor = null;
                    let isFullscreen = false;
                    let fileName = 'BTRON'; // デフォルト名
                    if (jsonResponse.success) {
                        const jsonData = JSON.parse(jsonResponse.data);
                        windowConfig = jsonData.window;
                        applist = jsonData.applist || null;
                        backgroundColor = jsonData.backgroundColor || null;
                        isFullscreen = jsonData.isFullscreen || false;
                        fileName = jsonData.name || fileName;
                        console.log('[TADjs] JSONファイル読み込み成功:', { name: fileName, window: windowConfig, backgroundColor: backgroundColor, isFullscreen: isFullscreen });
                    } else {
                        console.warn('[TADjs] JSONファイル読み込み失敗:', jsonResponse.error);
                    }

                    // XTADファイルを読み込む
                    console.log('[TADjs] XTADファイルを読み込み中:', defaultXtadFile);
                    const xtadResponse = await this.loadDataFile(dataBasePath, defaultXtadFile);

                    let xmlData = null;
                    if (xtadResponse.success) {
                        xmlData = xtadResponse.data;
                        console.log('[TADjs] XTADファイル読み込み成功 (length:', xmlData.length, ')');
                    } else {
                        console.warn('[TADjs] XTADファイル読み込み失敗:', xtadResponse.error, '- 空のデータで起動します');
                    }

                    // デフォルトファイルデータを準備
                    const fileData = {
                        fileId: defaultFileId,
                        jsonFile: defaultJsonFile,
                        xtadFile: defaultXtadFile,
                        displayName: fileName,
                        isDefault: true,
                        xmlData: xmlData,
                        windowConfig: windowConfig,
                        applist: applist,
                        backgroundColor: backgroundColor,
                        isFullscreen: isFullscreen
                    };

                    // プラグインを起動
                    const windowId = await window.pluginManager.launchPlugin('virtual-object-list', fileData);
                    console.log('[TADjs] 仮身一覧プラグインで初期ウィンドウを開きました');

                    // ウィンドウのアイコンを設定
                    if (windowId) {
                        const iconPath = `${defaultFileId}.ico`;
                        setTimeout(() => {
                            this.setWindowIcon(windowId, iconPath);
                        }, 200);
                    }
                } catch (error) {
                    console.error('[TADjs] ファイル読み込みエラー:', error);
                    // エラー時はxmlDataなしで起動
                    const fileData = {
                        fileId: defaultFileId,
                        jsonFile: defaultJsonFile,
                        xtadFile: defaultXtadFile,
                        displayName: 'BTRON',
                        isDefault: true,
                        xmlData: null
                    };
                    window.pluginManager.launchPlugin('virtual-object-list', fileData);
                }
            } else {
                console.error('[TADjs] 仮身一覧プラグインが見つかりません');
                this.createFallbackWindow();
            }
        } else {
            console.error('[TADjs] プラグインマネージャーが初期化されていません');
            this.createFallbackWindow();
        }
    }

    /**
     * フォールバック用の簡易ウィンドウを作成
     */
    createFallbackWindow() {
        const content = `
            <div id="file-drop-zone" style="height: 100%; padding: 8px;">
                <div class="drop-message">
                    TADファイルをここにドラッグ&ドロップしてください
                </div>
                <div class="file-icons" id="file-icons"></div>
            </div>
        `;

        const windowId = this.createWindow('BTRON', content, {
            width: 300,
            height: 400,
            x: 20,
            y: 20,
            resizable: true,
            closeable: false
        });

        this.initialWindow = windowId;
    }

    /**
     * 各種イベントリスナーを設定
     */
    /**
     * メッセージハンドラーのマッピング（汎用化）
     * typeをキーとして、処理関数を定義
     */
    initMessageHandlers() {
        this.messageHandlers = {
            // リクエスト-レスポンス型（自動的にレスポンスを返す）
            'create-real-object': { handler: 'handleCreateRealObject', async: true, autoResponse: true },
            'copy-virtual-object': { handler: 'handleCopyVirtualObject', async: true, autoResponse: true },
            'copy-real-object': { handler: 'handleCopyRealObject', async: true, autoResponse: true },
            'delete-virtual-object': { handler: 'handleDeleteVirtualObject', async: true, autoResponse: true },
            'load-real-object': { handler: 'handleLoadRealObject', async: true, autoResponse: true },
            'save-real-object': { handler: 'handleSaveRealObject', async: true, autoResponse: true },
            'get-unreferenced-real-objects': { handler: 'handleGetUnreferencedRealObjects', async: true, autoResponse: true },
            'rescan-filesystem': { handler: 'handleRescanFilesystem', async: true, autoResponse: true },
            'physical-delete-real-object': { handler: 'handlePhysicalDeleteRealObject', async: true, autoResponse: true },

            // 単方向メッセージ型
            'xml-data-changed': { handler: (data) => this.saveXmlDataToFile(data.fileId, data.xmlData) },
            'update-background-color': { handler: (data) => this.updateBackgroundColor(data.fileId, data.backgroundColor) },
            'update-fullscreen-state': { handler: (data) => this.updateFullscreenState(data.fileId, data.isFullscreen) },
            'status-message': { handler: (data) => this.setStatusMessage(data.message) },
            'close-context-menu': { handler: () => this.hideContextMenu() },
            'apply-background': { handler: (data) => data.backgroundId && this.applyBackgroundToDesktop(data.backgroundId) },
            'apply-user-config': { handler: () => this.applyUserConfig() },
            'disable-window-resize': { handler: () => this.disableAllWindowResize() },
            'enable-window-resize': { handler: () => this.enableAllWindowResize() },
        };
    }

    setupEventListeners() {
        // メッセージハンドラーマッピングを初期化
        this.initMessageHandlers();

        // デスクトップクリックでアクティブウインドウを解除
        document.addEventListener('mousedown', (e) => {
            if (e.target === document.getElementById('desktop')) {
                this.setActiveWindow(null);
            }
        });

        // mouseupイベントを全てのiframeに通知（ドラッグ終了検知用）
        document.addEventListener('mouseup', () => {
            // 全てのiframeにmouseupメッセージを送信
            const iframes = document.querySelectorAll('iframe');
            iframes.forEach(iframe => {
                try {
                    iframe.contentWindow.postMessage({
                        type: 'parent-mouseup'
                    }, '*');
                } catch (error) {
                    // クロスオリジンの場合はスキップ
                }
            });
        });

        // ドラッグ中のマウス位置を追跡し、どのiframeの上にあるかを通知
        document.addEventListener('dragover', (e) => {
            e.preventDefault();
            console.log('[TADjs] dragover:', e.clientX, e.clientY);
            // 現在のマウス位置を各iframeに通知
            this.trackDragOverIframes(e.clientX, e.clientY);
        });

        document.addEventListener('dragend', () => {
            // 全てのiframeにdragend通知
            const iframes = document.querySelectorAll('iframe');
            iframes.forEach(iframe => {
                try {
                    iframe.contentWindow.postMessage({
                        type: 'parent-dragend'
                    }, '*');
                } catch (error) {
                    // クロスオリジンの場合はスキップ
                }
            });
        });

        // 右クリックメニューを開いた直後かどうかのフラグ
        this.justOpenedContextMenu = false;

        // コンテキストメニュー
        document.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            // 右クリックメニューを開いたことを記録
            this.justOpenedContextMenu = true;
            setTimeout(() => {
                this.justOpenedContextMenu = false;
            }, 100);
            this.showContextMenu(e.pageX, e.pageY, e.target);
        });

        // メニューを閉じる
        document.addEventListener('click', (e) => {
            // 右クリックメニューを開いた直後は無視
            if (this.justOpenedContextMenu) {
                return;
            }
            if (!e.target.closest('.context-menu')) {
                this.hideContextMenu();
            }
        });

        // キーボードショートカット
        document.addEventListener('keydown', (e) => {
            this.handleKeyboardShortcuts(e);
        });

        // リサイズイベント
        window.addEventListener('resize', () => {
            this.handleWindowResize();
        });

        // プラグインからのメッセージを受信
        window.addEventListener('message', async (e) => {
            if (e.data && e.data.type === 'context-menu-request') {
                console.log('[TADjs] コンテキストメニューリクエスト受信:', e.data);
                // プラグインから送信されたメッセージの場合、送信元iframeを取得
                const iframe = e.source ? e.source.frameElement : null;
                const target = iframe || document.elementFromPoint(e.data.x, e.data.y);
                this.showContextMenu(e.data.x, e.data.y, target);
            // status-message は汎用ハンドラーに移行
            } else if (e.data && e.data.type === 'content-size-changed') {
                // プラグインのコンテンツサイズが変更された
                this.updatePluginContentSize(e.source, e.data.height, e.data.width);
            } else if (e.data && e.data.type === 'content-height-changed') {
                // 後方互換性のため残す
                this.updatePluginContentSize(e.source, e.data.height);
            // close-context-menu は汎用ハンドラーに移行
            } else if (e.data && e.data.type === 'open-virtual-object') {
                // 仮身一覧プラグインから仮身をダブルクリックした際の要求
                console.log('[TADjs] 仮身を開く要求:', e.data);
                this.openVirtualObject(e.data.linkId, e.data.linkName);
            } else if (e.data && e.data.type === 'open-virtual-object-real') {
                // 仮身一覧プラグインから実身を開く要求
                console.log('[TADjs] 仮身の実身を開く要求:', e.data);
                this.openVirtualObjectReal(e.data.virtualObj, e.data.pluginId, e.data.messageId, e.source);
            } else if (e.data && e.data.type === 'set-window-icon') {
                // 仮身一覧プラグインからウィンドウアイコン設定要求
                console.log('[TADjs] ウィンドウアイコン設定要求:', e.data.windowId, e.data.iconPath);
                this.setWindowIcon(e.data.windowId, e.data.iconPath);
            } else if (e.data && e.data.type === 'get-file-data') {
                // プラグインからファイルデータ取得要求
                console.log('[TADjs] ファイルデータ取得要求:', e.data.fileName);
                const file = this.fileObjects[e.data.fileName];
                if (file) {
                    file.arrayBuffer().then(arrayBuffer => {
                        e.source.postMessage({
                            type: 'file-data',
                            fileName: e.data.fileName,
                            arrayBuffer: arrayBuffer
                        }, '*');
                    });
                } else {
                    console.error('[TADjs] ファイルが見つかりません:', e.data.fileName);
                }
            } else if (e.data && e.data.type === 'save-image-file') {
                // プラグインから画像ファイル保存要求
                console.log('[TADjs] 画像ファイル保存要求:', e.data.fileName);
                this.saveImageFile(e.data.fileName, e.data.imageData);
            } else if (e.data && e.data.type === 'load-image-file') {
                // プラグインから画像ファイル読み込み要求
                console.log('[TADjs] 画像ファイル読み込み要求:', e.data.fileName);
                this.loadImageFile(e.data.fileName, e.data.messageId, e.source);
            } else if (e.data && e.data.type === 'get-image-file-path') {
                // プラグインから画像ファイルパス取得要求
                const filePath = this.getImageFilePath(e.data.fileName);
                e.source.postMessage({
                    type: 'image-file-path-response',
                    requestId: e.data.requestId,
                    fileName: e.data.fileName,
                    filePath: filePath
                }, '*');
            } else if (e.data && e.data.type === 'open-tad-link') {
                // プラグインから仮身リンクを開く要求
                console.log('[TADjs] TADリンクを開く要求:', e.data.linkData);
                const linkData = e.data.linkData;
                const linkRecordList = e.data.linkRecordList;  // 親ウィンドウから受け取ったlinkRecordList
                if (linkData && linkData.data) {
                    // Uint8Arrayに変換
                    const tadData = new Uint8Array(linkData.data);

                    // tadjs-viewプラグインで開く
                    if (window.pluginManager) {
                        const plugin = window.pluginManager.getPlugin('tadjs-view');
                        if (plugin) {
                            // fileDataを作成
                            const fileData = {
                                fileName: linkData.title + '.tad',
                                rawData: tadData,
                                displayName: linkData.title,
                                fileId: null,
                                realId: null,
                                originalLinkId: linkData.linkId,  // createTADWindowと同様にoriginalLinkIdを渡す
                                linkRecordList: linkRecordList,   // BPK全体のlinkRecordListを渡す
                                tadRecordDataArray: e.data.tadRecordDataArray || []  // tadRecordDataArrayも渡す
                            };

                            console.log('[TADjs] tadjs-viewプラグインでリンクを開く:', fileData);
                            console.log('[TADjs] Passing linkRecordList with', linkRecordList ? linkRecordList.length : 0, 'files');
                            await window.pluginManager.createPluginWindow(plugin, fileData);
                        } else {
                            console.error('[TADjs] tadjs-viewプラグインが見つかりません');
                        }
                    } else {
                        console.error('[TADjs] プラグインマネージャーが初期化されていません');
                    }
                }
            } else if (e.data && e.data.type === 'archive-drop-detected') {
                // virtual-object-listからunpack-fileへドロップ通知を転送
                console.log('[TADjs] ドロップ通知転送（virtual-object-list → unpack-file）');
                // 特定のウィンドウ内のunpack-fileプラグインのみにメッセージを転送
                if (e.data.targetWindowId) {
                    this.forwardMessageToPluginInWindow(e.data.targetWindowId, 'unpack-file', {
                        type: 'archive-drop-detected',
                        dropPosition: e.data.dropPosition,
                        dragData: e.data.dragData
                    });
                } else {
                    // 後方互換性のため、windowIdがない場合は従来通り
                    this.forwardMessageToPlugin('unpack-file', {
                        type: 'archive-drop-detected',
                        dropPosition: e.data.dropPosition,
                        dragData: e.data.dragData
                    });
                }
            } else if (e.data && e.data.type === 'archive-drop-handled') {
                // unpack-fileから「ドロップを処理した」通知を受信
                // 元のvirtual-object-listウィンドウに通知して、dragendでfinishDrag()をスキップさせる
                console.log('[TADjs] アーカイブドロップ処理完了通知、元のウィンドウID:', e.data.sourceWindowId);
                if (e.data.sourceWindowId) {
                    this.forwardMessageToWindow(e.data.sourceWindowId, {
                        type: 'cross-window-drop-completed',
                        mode: 'copy' // アーカイブドロップはコピー扱い
                    });
                }
            } else if (e.data && e.data.type === 'insert-root-virtual-object') {
                // unpack-fileからvirtual-object-listへルート実身配置要求を転送
                console.log('[TADjs] ルート実身配置要求転送（unpack-file → virtual-object-list）');
                // 特定のウィンドウ内のvirtual-object-listプラグインのみにメッセージを転送
                if (e.data.targetWindowId) {
                    this.forwardMessageToPluginInWindow(e.data.targetWindowId, 'virtual-object-list', {
                        type: 'insert-root-virtual-object',
                        rootFileData: e.data.rootFileData,
                        x: e.data.x,
                        y: e.data.y,
                        sourceWindowId: e.data.sourceWindowId
                    });
                } else {
                    // 後方互換性のため、targetWindowIdがない場合は全てにブロードキャスト
                    this.broadcastMessageToPluginType('virtual-object-list', {
                        type: 'insert-root-virtual-object',
                        rootFileData: e.data.rootFileData,
                        x: e.data.x,
                        y: e.data.y
                    });
                }
            } else if (e.data && e.data.type === 'root-virtual-object-inserted') {
                // virtual-object-listからunpack-fileへ配置完了通知を転送
                console.log('[TADjs] ルート実身配置完了通知転送（virtual-object-list → unpack-file）');
                // 特定のウィンドウ内のunpack-fileプラグインのみにメッセージを転送
                if (e.data.targetWindowId) {
                    this.forwardMessageToPluginInWindow(e.data.targetWindowId, 'unpack-file', {
                        type: 'root-virtual-object-inserted',
                        success: e.data.success
                    });
                } else {
                    // 後方互換性のため、targetWindowIdがない場合は従来通り
                    this.forwardMessageToPlugin('unpack-file', {
                        type: 'root-virtual-object-inserted',
                        success: e.data.success
                    });
                }
            } else if (e.data && e.data.type === 'archive-files-generated') {
                // unpack-fileから実身ファイルセット生成完了通知（分割チャンク対応）
                const filesCount = e.data.files ? e.data.files.length : 0;
                const imagesCount = e.data.images ? e.data.images.length : 0;
                const chunkInfo = e.data.chunkInfo || { index: 0, total: 1, isLast: true };
                console.log(`[TADjs] 実身ファイルセットチャンク受信 (${chunkInfo.index + 1}/${chunkInfo.total}):`, filesCount, '個のファイル、', imagesCount, '個の画像');
                await this.handleArchiveFilesGenerated(e.data.files, e.data.images);
            } else if (e.data && e.data.type === 'toggle-maximize') {
                // プラグインからウィンドウ最大化/元に戻す要求
                // メッセージ送信元のiframeを含むウィンドウを探す
                const iframe = e.source ? e.source.frameElement : null;
                if (iframe) {
                    const windowElement = iframe.closest('.window');
                    if (windowElement) {
                        const windowId = windowElement.id;
                        this.toggleMaximizeWindow(windowId);
                    }
                }
            // apply-background, apply-user-config は汎用ハンドラーに移行
            } else if (e.data && e.data.type === 'close-window') {
                // プラグインからウィンドウを閉じる要求
                let windowId = e.data.windowId;

                // windowIdが指定されていない場合は、送信元のiframeから検索
                if (!windowId) {
                    const iframe = e.source ? e.source.frameElement : null;
                    if (iframe) {
                        const windowElement = iframe.closest('.window');
                        if (windowElement) {
                            windowId = windowElement.dataset.windowId;
                        }
                    }
                }

                if (windowId) {
                    this.closeWindow(windowId);
                }
            } else if (e.data && e.data.type === 'open-external-file') {
                // 既存データをOSのデフォルトアプリで開く
                console.log('[TADjs] open-external-file受信:', e.data.realId);
                try {
                    const result = await this.openExternalFile(e.data.realId);

                    // プラグインに開いた通知を送信
                    if (e.source) {
                        e.source.postMessage({
                            type: 'external-file-opened',
                            realId: e.data.realId,
                            success: result.success,
                            error: result.error
                        }, '*');
                    }
                } catch (error) {
                    console.error('[TADjs] 外部ファイルを開くエラー:', error);
                    if (e.source) {
                        e.source.postMessage({
                            type: 'external-file-opened',
                            realId: e.data.realId,
                            success: false,
                            error: error.message
                        }, '*');
                    }
                }
            } else if (e.data && e.data.type === 'read-xtad-text') {
                // xtadファイルからテキストを読み取る
                console.log('[TADjs] read-xtad-text受信:', e.data.realId);
                try {
                    const result = await this.readXtadText(e.data.realId);

                    // プラグインにテキストを送信
                    if (e.source) {
                        e.source.postMessage({
                            type: 'xtad-text-loaded',
                            realId: e.data.realId,
                            success: result.success,
                            text: result.text,
                            error: result.error
                        }, '*');
                    }
                } catch (error) {
                    console.error('[TADjs] xtadテキストを読み取るエラー:', error);
                    if (e.source) {
                        e.source.postMessage({
                            type: 'xtad-text-loaded',
                            realId: e.data.realId,
                            success: false,
                            error: error.message
                        }, '*');
                    }
                }
            } else if (e.data && e.data.type === 'open-url-external') {
                // URLをブラウザで開く
                console.log('[TADjs] open-url-external受信:', e.data.url);
                try {
                    const result = await this.openUrlExternal(e.data.url);

                    // プラグインに開いた通知を送信
                    if (e.source) {
                        e.source.postMessage({
                            type: 'url-opened',
                            url: e.data.url,
                            success: result.success,
                            error: result.error
                        }, '*');
                    }
                } catch (error) {
                    console.error('[TADjs] URLを開くエラー:', error);
                    if (e.source) {
                        e.source.postMessage({
                            type: 'url-opened',
                            url: e.data.url,
                            success: false,
                            error: error.message
                        }, '*');
                    }
                }
            } else if (e.data && e.data.type === 'read-icon-file') {
                // アイコンファイルを読み込む
                console.log('[TADjs] read-icon-file受信:', e.data.realId);
                try {
                    const result = await this.readIconFile(e.data.realId);

                    // プラグインにアイコンデータを送信
                    if (e.source) {
                        e.source.postMessage({
                            type: 'icon-file-loaded',
                            realId: e.data.realId,
                            success: result.success,
                            data: result.data,
                            error: result.error
                        }, '*');
                    }
                } catch (error) {
                    console.error('[TADjs] アイコンファイル読み込みエラー:', error);
                    if (e.source) {
                        e.source.postMessage({
                            type: 'icon-file-loaded',
                            realId: e.data.realId,
                            success: false,
                            error: error.message
                        }, '*');
                    }
                }
            } else if (e.data && e.data.type === 'request-base-plugins') {
                // 原紙プラグイン一覧取得要求
                console.log('[TADjs] request-base-plugins受信');
                console.log('[TADjs] window.pluginManager:', window.pluginManager);
                const basePlugins = window.pluginManager ? window.pluginManager.getBasePlugins() : [];
                console.log('[TADjs] basePlugins:', basePlugins);
                if (e.source) {
                    e.source.postMessage({
                        type: 'base-plugins-response',
                        plugins: basePlugins
                    }, '*');
                    console.log('[TADjs] base-plugins-response送信:', basePlugins.length, '個');
                } else {
                    console.warn('[TADjs] e.sourceが存在しません');
                }
            } else if (e.data && e.data.type === 'load-data-file-request') {
                // プラグインからデータファイル読み込み要求
                console.log('[TADjs] load-data-file-request受信:', e.data.fileName);
                try {
                    const fileData = await this.loadDataFileAsFile(e.data.fileName);
                    if (e.source) {
                        e.source.postMessage({
                            type: 'load-data-file-response',
                            requestId: e.data.requestId,
                            fileName: e.data.fileName,
                            success: true,
                            data: fileData
                        }, '*');
                    }
                } catch (error) {
                    console.error('[TADjs] データファイル読み込みエラー:', error);
                    if (e.source) {
                        e.source.postMessage({
                            type: 'load-data-file-response',
                            requestId: e.data.requestId,
                            fileName: e.data.fileName,
                            success: false,
                            error: error.message
                        }, '*');
                    }
                }
            } else if (e.data && e.data.type === 'base-file-drop-request') {
                // iframe内で原紙箱からのドロップが検出された
                console.log('[TADjs] base-file-drop-request受信:', e.data);
                this.handleBaseFileDrop(e.data.dragData, e);
            } else if (e.data && e.data.type === 'trash-real-object-drop-request') {
                // iframe内で屑実身操作からのドロップが検出された
                console.log('[TADjs] trash-real-object-drop-request受信:', e.data);
                this.handleTrashRealObjectDrop(e.data.dragData, e);
            } else if (e.data && e.data.type === 'cross-window-drop-success') {
                // 別ウィンドウへのドロップ成功通知を元のウィンドウに転送
                console.log('[TADjs] cross-window-drop-success受信:', e.data);
                this.notifySourceWindowOfCrossWindowDrop(e.data);
            } else if (e.data && e.data.type === 'get-plugin-list') {
                // プラグインリスト取得要求
                const plugins = this.getPluginListInfo();
                if (e.source) {
                    e.source.postMessage({
                        type: 'plugin-list-response',
                        plugins: plugins
                    }, '*');
                }
            } else if (e.data && e.data.type === 'show-input-dialog') {
                // プラグインからの入力ダイアログ要求
                this.showInputDialog(
                    e.data.message,
                    e.data.defaultValue || '',
                    e.data.inputWidth || 30,
                    e.data.buttons,
                    e.data.defaultButton || 0
                ).then(result => {
                    if (e.source) {
                        e.source.postMessage({
                            type: 'input-dialog-response',
                            messageId: e.data.messageId,
                            result: result
                        }, '*');
                    }
                });
            } else if (e.data && e.data.type === 'show-message-dialog') {
                // プラグインからのメッセージダイアログ要求
                this.showMessageDialog(
                    e.data.message,
                    e.data.buttons,
                    e.data.defaultButton || 0
                ).then(result => {
                    if (e.source) {
                        e.source.postMessage({
                            type: 'message-dialog-response',
                            messageId: e.data.messageId,
                            result: result
                        }, '*');
                    }
                });
            } else if (e.data && e.data.type === 'show-custom-dialog') {
                // プラグインからのカスタムダイアログ要求
                this.showCustomDialog(
                    e.data.dialogHtml,
                    e.data.buttons,
                    e.data.defaultButton || 0,
                    { ...(e.data.inputs || {}), radios: e.data.radios }
                ).then(result => {
                    if (e.source) {
                        // dialogElement は postMessage で送信できないため除外
                        const { dialogElement, ...resultWithoutElement } = result;
                        e.source.postMessage({
                            type: 'input-dialog-response',
                            messageId: e.data.messageId,
                            result: resultWithoutElement
                        }, '*');
                    }
                });
            } else if (e.data && e.data.type === 'show-save-confirm-dialog') {
                // プラグインからの保存確認ダイアログ要求
                this.showMessageDialog(
                    e.data.message,
                    e.data.buttons,
                    2 // デフォルトは「保存」ボタン
                ).then(result => {
                    if (e.source) {
                        e.source.postMessage({
                            type: 'message-dialog-response',
                            messageId: e.data.messageId,
                            result: result
                        }, '*');
                    }
                });
            } else if (e.data && e.data.type === 'open-tool-panel-window') {
                // プラグインから道具パネルウィンドウを開く要求
                console.log('[TADjs] 道具パネルウィンドウを開く:', e.data.pluginId);
                // e.sourceからiframe要素を取得
                const pluginIframe = e.source ? e.source.frameElement : null;
                this.openToolPanelWindow(e.data.pluginId, e.data.settings, pluginIframe);
            } else if (e.data && e.data.type === 'show-tool-panel-popup') {
                // 道具パネルからポップアップ表示要求
                this.showToolPanelPopup(e.data, e.source);
            } else if (e.data && e.data.type === 'hide-tool-panel-popup') {
                // 道具パネルからポップアップ非表示要求
                this.hideToolPanelPopup();
            } else if (e.data && e.data.fromEditor) {
                // エディタからのメッセージを道具パネルに中継
                console.log('[TADjs] エディタメッセージを中継:', e.data.type);

                // 送信元のiframeから編集ウィンドウを特定
                if (e.source && e.source.frameElement) {
                    const editorIframe = e.source.frameElement;
                    const editorWindow = editorIframe.closest('.window');

                    if (editorWindow && this.toolPanelRelations) {
                        // この編集ウィンドウに対応する道具パネルを探す
                        for (const [toolPanelWindowId, relation] of Object.entries(this.toolPanelRelations)) {
                            if (relation.editorIframe === editorIframe) {
                                const toolPanelWindow = document.getElementById(toolPanelWindowId);
                                const toolPanelIframe = toolPanelWindow.querySelector('iframe');

                                if (toolPanelIframe && toolPanelIframe.contentWindow) {
                                    // fromEditorフラグを除去してから道具パネルに中継
                                    const { fromEditor, ...messageData } = e.data;
                                    toolPanelIframe.contentWindow.postMessage(messageData, '*');
                                    console.log('[TADjs] メッセージを道具パネルに送信:', messageData.type);
                                }
                                break;
                            }
                        }
                    }
                }
            } else if (e.data && e.data.fromToolPanel) {
                // 道具パネルからのメッセージ処理

                // 道具パネルのドラッグ開始
                if (e.data.type === 'start-drag-tool-panel') {
                    if (e.source && e.source.frameElement) {
                        const toolPanelIframe = e.source.frameElement;
                        const toolPanelWindow = toolPanelIframe.closest('.window');

                        if (toolPanelWindow) {
                            this.startToolPanelDrag(toolPanelWindow, e.data.clientX, e.data.clientY);
                        }
                    }
                } else {
                    // 道具パネルからのメッセージを編集ウィンドウに中継（汎用）
                    console.log('[TADjs] 道具パネルメッセージを中継:', e.data.type);

                    // 送信元のiframeから道具パネルウィンドウを特定
                    if (e.source && e.source.frameElement) {
                        const toolPanelIframe = e.source.frameElement;
                        const toolPanelWindow = toolPanelIframe.closest('.window');

                        if (toolPanelWindow && this.toolPanelRelations) {
                            const windowId = toolPanelWindow.id;
                            const relation = this.toolPanelRelations[windowId];

                            if (relation && relation.editorIframe && relation.editorIframe.contentWindow) {
                                // fromToolPanelフラグを除去してから編集ウィンドウに中継
                                const { fromToolPanel, ...messageData } = e.data;
                                relation.editorIframe.contentWindow.postMessage(messageData, '*');
                                console.log('[TADjs] メッセージを編集ウィンドウに送信:', messageData.type);
                            } else {
                                console.warn('[TADjs] 中継失敗: relation or editorIframe not found', {
                                    hasRelation: !!relation,
                                    hasEditorIframe: !!relation?.editorIframe,
                                    hasContentWindow: !!relation?.editorIframe?.contentWindow
                                });
                            }
                        } else {
                            console.warn('[TADjs] 中継失敗: toolPanelWindow or toolPanelRelations not found');
                        }
                    } else {
                        console.warn('[TADjs] 中継失敗: e.source or frameElement not found');
                    }
                }
            } else if (e.data && e.data.type === 'window-close-response') {
                // プラグインからのクローズ応答
                if (this.closeConfirmCallbacks && this.closeConfirmCallbacks[e.data.windowId]) {
                    this.closeConfirmCallbacks[e.data.windowId](e.data.allowClose);
                    delete this.closeConfirmCallbacks[e.data.windowId];
                }
            // xml-data-changed, update-background-color, update-fullscreen-state は汎用ハンドラーに移行
            } else if (e.data && e.data.type === 'update-scrollbars') {
                // プラグインからスクロールバー更新要求
                const iframe = e.source ? e.source.frameElement : null;

                if (iframe) {
                    const windowElement = iframe.closest('.window');

                    if (windowElement) {
                        const content = windowElement.querySelector('.window-content');
                        const vScrollbar = windowElement.querySelector('.custom-scrollbar-vertical');
                        const hScrollbar = windowElement.querySelector('.custom-scrollbar-horizontal');

                        if (content && vScrollbar) {
                            // console.log('[TADjs] 垂直スクロールバー更新開始');
                            this.forceUpdateScrollbarForPlugin(iframe, content, vScrollbar, 'vertical');
                        }
                        if (content && hScrollbar) {
                            // console.log('[TADjs] 水平スクロールバー更新開始');
                            this.forceUpdateScrollbarForPlugin(iframe, content, hScrollbar, 'horizontal');
                        }
                        // console.log('[TADjs] スクロールバー更新:', windowElement.id);
                    }
                }
            } else if (e.data && e.data.type === 'activate-window') {
                // プラグインからウィンドウをアクティブにする要求
                const iframe = e.source ? e.source.frameElement : null;
                if (iframe) {
                    const windowElement = iframe.closest('.window');
                    if (windowElement) {
                        this.setActiveWindow(windowElement.id);
                    }
                }
            } else if (e.data && e.data.type === 'create-real-object') {
                // 実身の新規作成
                this.handleCreateRealObject(e).catch(err => {
                    console.error('[TADjs] 実身作成エラー:', err);
                });
            } else if (e.data && e.data.type === 'copy-virtual-object') {
                // 仮身のコピー
                this.handleCopyVirtualObject(e).catch(err => {
                    console.error('[TADjs] 仮身コピーエラー:', err);
                });
            } else if (e.data && e.data.type === 'copy-real-object') {
                // 実身のコピー
                this.handleCopyRealObject(e).catch(err => {
                    console.error('[TADjs] 実身コピーエラー:', err);
                });
            } else if (e.data && e.data.type === 'delete-virtual-object') {
                // 仮身の削除
                this.handleDeleteVirtualObject(e).catch(err => {
                    console.error('[TADjs] 仮身削除エラー:', err);
                });
            } else if (e.data && e.data.type === 'load-real-object') {
                // 実身の読み込み
                this.handleLoadRealObject(e).catch(err => {
                    console.error('[TADjs] 実身読み込みエラー:', err);
                });
            } else if (e.data && e.data.type === 'save-real-object') {
                // 実身の保存
                this.handleSaveRealObject(e).catch(err => {
                    console.error('[TADjs] 実身保存エラー:', err);
                });
            } else if (e.data && e.data.type === 'get-unreferenced-real-objects') {
                // 参照カウント0の実身一覧取得
                this.handleGetUnreferencedRealObjects(e).catch(err => {
                    console.error('[TADjs] 参照カウント0の実身一覧取得エラー:', err);
                });
            } else if (e.data && e.data.type === 'rescan-filesystem') {
                // ファイルシステム再探索
                this.handleRescanFilesystem(e).catch(err => {
                    console.error('[TADjs] ファイルシステム再探索エラー:', err);
                });
            } else if (e.data && e.data.type === 'physical-delete-real-object') {
                // 実身の物理削除
                this.handlePhysicalDeleteRealObject(e).catch(err => {
                    console.error('[TADjs] 実身物理削除エラー:', err);
                });
            } else if (e.data && e.data.type === 'set-clipboard') {
                // クリップボードに仮身データを設定
                this.clipboard = e.data.clipboardData;
                console.log('[TADjs] クリップボードを設定:', this.clipboard?.link_name);
            } else if (e.data && e.data.type === 'get-clipboard') {
                // クリップボードデータを取得
                if (e.source) {
                    e.source.postMessage({
                        type: 'clipboard-data',
                        messageId: e.data.messageId,
                        clipboardData: this.clipboard
                    }, '*');
                }
                console.log('[TADjs] クリップボードを取得:', this.clipboard?.link_name);
            } else if (e.data && e.data.type === 'rename-real-object') {
                // 実身名変更
                this.handleRenameRealObject(e).catch(err => {
                    console.error('[TADjs] 実身名変更エラー:', err);
                });
            } else if (e.data && e.data.type === 'duplicate-real-object') {
                // 実身複製
                this.handleDuplicateRealObject(e).catch(err => {
                    console.error('[TADjs] 実身複製エラー:', err);
                });
            } else if (e.data && e.data.type === 'save-as-new-real-object') {
                // 新たな実身に保存（非再帰的コピー）
                this.handleSaveAsNewRealObject(e).catch(err => {
                    console.error('[TADjs] 新たな実身に保存エラー:', err);
                });
            } else if (e.data && e.data.type === 'change-virtual-object-attributes') {
                // 仮身属性変更
                this.handleChangeVirtualObjectAttributes(e).catch(err => {
                    console.error('[TADjs] 仮身属性変更エラー:', err);
                });
            } else if (e.data && e.data.type === 'update-window-config') {
                // ウィンドウ設定更新
                this.handleUpdateWindowConfig(e).catch(err => {
                    console.error('[TADjs] ウィンドウ設定更新エラー:', err);
                });
            } else if (e.data && e.data.type && this.messageHandlers && this.messageHandlers[e.data.type]) {
                // 汎用メッセージハンドラー（フォールバック）
                const handlerDef = this.messageHandlers[e.data.type];
                console.log('[TADjs] 汎用ハンドラー実行:', e.data.type);

                try {
                    let result;
                    if (typeof handlerDef.handler === 'string') {
                        // メソッド名の文字列の場合
                        result = handlerDef.async
                            ? await this[handlerDef.handler](e)
                            : this[handlerDef.handler](e);
                    } else {
                        // 関数の場合
                        result = handlerDef.async
                            ? await handlerDef.handler(e.data, e)
                            : handlerDef.handler(e.data, e);
                    }

                    // 自動レスポンスが有効な場合
                    if (handlerDef.autoResponse && e.source) {
                        e.source.postMessage({
                            type: e.data.type + '-response',
                            requestId: e.data.requestId,
                            result: result
                        }, '*');
                    }
                } catch (error) {
                    console.error(`[TADjs] ${e.data.type}処理エラー:`, error);
                    if (handlerDef.autoResponse && e.source) {
                        e.source.postMessage({
                            type: e.data.type + '-response',
                            requestId: e.data.requestId,
                            error: error.message
                        }, '*');
                    }
                }
            }
        });
    }

    /**
     * ドラッグ中のマウス位置を追跡し、どのiframeの上にあるかを各iframeに通知
     * @param {number} clientX - マウスのX座標（親ウィンドウ座標系）
     * @param {number} clientY - マウスのY座標（親ウィンドウ座標系）
     */
    trackDragOverIframes(clientX, clientY) {
        // 全てのiframeをチェック
        const iframes = document.querySelectorAll('iframe');
        iframes.forEach(iframe => {
            try {
                // iframeの位置とサイズを取得（親ウィンドウ座標系）
                const rect = iframe.getBoundingClientRect();

                // マウスがこのiframeの上にあるかチェック
                const isOverThisIframe = (
                    clientX >= rect.left && clientX <= rect.right &&
                    clientY >= rect.top && clientY <= rect.bottom
                );

                // iframe内の相対座標を計算
                const relativeX = clientX - rect.left;
                const relativeY = clientY - rect.top;

                // 各iframeに通知（マウスが上にあるかどうかに関わらず全てに通知）
                iframe.contentWindow.postMessage({
                    type: 'parent-drag-position',
                    isOverThisWindow: isOverThisIframe,
                    clientX: clientX,
                    clientY: clientY,
                    relativeX: relativeX,
                    relativeY: relativeY
                }, '*');
            } catch (error) {
                // クロスオリジンの場合はスキップ
            }
        });
    }

    /**
     * ステータスバーをセットアップして時刻表示を開始
     */
    setupStatusBar() {
        // 即座に時刻を更新
        this.updateStatusTime();
        
        // 次の秒の開始時点に合わせてタイマーを開始
        const now = new Date();
        const msUntilNextSecond = 1000 - now.getMilliseconds();
        
        // 次の秒の開始時点で最初の更新を行い、その後1秒ごとに更新
        setTimeout(() => {
            this.updateStatusTime();
            // 以降は正確に1秒ごとに更新
            setInterval(() => this.updateStatusTime(), 1000);
        }, msUntilNextSecond);
    }

    /**
     * ステータスバーの時刻表示を更新
     */
    updateStatusTime() {
        const now = new Date();
        const timeString = now.getFullYear() + '/' +
                          String(now.getMonth() + 1).padStart(2, '0') + '/' +
                          String(now.getDate()).padStart(2, '0') + ' ' +
                          String(now.getHours()).padStart(2, '0') + ':' +
                          String(now.getMinutes()).padStart(2, '0') + ':' +
                          String(now.getSeconds()).padStart(2, '0');
        
        document.getElementById('status-time').textContent = timeString;
    }

    /**
     * ステータスメッセージを表示（5秒後に自動消去）
     * @param {string} message - 表示するメッセージ
     */
    setStatusMessage(message) {
        // 既存のタイマーをクリア
        if (this.statusMessageTimer) {
            clearTimeout(this.statusMessageTimer);
            this.statusMessageTimer = null;
        }

        document.getElementById('status-message').textContent = message;

        // 5秒後に元に戻す
        this.statusMessageTimer = setTimeout(() => {
            document.getElementById('status-message').textContent = 'システム準備完了';
            this.statusMessageTimer = null;
        }, 5000);
    }

    /**
     * ファイルのドラッグ&ドロップゾーンを設定
     */
    setupDropZone() {
        // 初期ウインドウ作成後にドロップゾーンを設定
        setTimeout(() => {
            const dropZone = document.getElementById('file-drop-zone');
            const desktop = document.getElementById('desktop');

            if (!dropZone) {
                console.log('[TADjs] Drop zone not found - デフォルトウィンドウは仮身一覧プラグインです');
                return;
            }
            
            // より広い範囲でドロップを受け付ける
            const setupDropEvents = (element) => {
                element.addEventListener('dragenter', (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropZone.classList.add('drop-zone-active');
                console.log('Drag enter detected');
            });
            
            element.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = 'copy';
                dropZone.classList.add('drop-zone-hover');
                return false;
            });

            element.addEventListener('dragleave', (e) => {
                e.preventDefault();
                e.stopPropagation();
                // 要素の外に出た場合のみクラスを削除
                const rect = element.getBoundingClientRect();
                const x = e.clientX;
                const y = e.clientY;
                
                if (x <= rect.left || x >= rect.right || y <= rect.top || y >= rect.bottom) {
                    dropZone.classList.remove('drop-zone-hover');
                    dropZone.classList.remove('drop-zone-active');
                }
            });

            element.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropZone.classList.remove('drop-zone-hover');
                dropZone.classList.remove('drop-zone-active');

                console.log('Drop event:', e.dataTransfer);

                // 原紙箱からのドラッグデータをチェック
                const textData = e.dataTransfer.getData('text/plain');
                if (textData) {
                    try {
                        const dragData = JSON.parse(textData);
                        if (dragData.type === 'base-file-copy') {
                            console.log('[TADjs] 原紙箱からのドロップ:', dragData);
                            this.handleBaseFileDrop(dragData, e);
                            return false;
                        }
                    } catch (_err) {
                        // JSONパースエラー - 通常のテキストとして扱う
                    }
                }

                const files = Array.from(e.dataTransfer.files);
                if (files.length > 0) {
                    console.log(`Dropped ${files.length} files:`, files);
                    this.handleFilesDrop(files);
                } else {
                    console.log('No files in drop event');
                }
                return false;
            });
        };
        
            // ドロップゾーンとデスクトップ全体でイベントを設定
            setupDropEvents(dropZone);
            setupDropEvents(desktop);
            
            // ドキュメント全体でもドラッグイベントをキャンセル（ブラウザのデフォルト動作を防ぐ）
            document.addEventListener('dragover', (e) => {
                e.preventDefault();
                return false;
            });
            
            document.addEventListener('drop', (e) => {
                // ドロップ位置のウィンドウとiframeを取得
                const dropX = e.clientX;
                const dropY = e.clientY;
                
                // ドロップ位置にあるウィンドウを見つける
                const windows = Array.from(document.querySelectorAll('.window')).reverse(); // z-indexの高い順
                let targetWindow = null;
                
                for (const win of windows) {
                    const rect = win.getBoundingClientRect();
                    if (dropX >= rect.left && dropX <= rect.right && 
                        dropY >= rect.top && dropY <= rect.bottom) {
                        targetWindow = win;
                        break;
                    }
                }
                
                // ターゲットウィンドウ内のiframeを取得
                if (targetWindow) {
                    const iframe = targetWindow.querySelector('iframe');
                    if (iframe && iframe.contentWindow) {
                        console.log('[TADjs] iframe上でのドロップを検出、iframeにデータを転送:', targetWindow.id);
                        
                        // ドロップデータを取得
                        const textData = e.dataTransfer.getData('text/plain');
                        
                        // iframeにpostMessageでドロップイベントを転送
                        if (textData) {
                            try {
                                const dragData = JSON.parse(textData);
                                
                                // iframeの座標系に変換
                                const iframeRect = iframe.getBoundingClientRect();
                                const iframeX = dropX - iframeRect.left;
                                const iframeY = dropY - iframeRect.top;
                                
                                // iframe内のドロップイベントとして転送
                                iframe.contentWindow.postMessage({
                                    type: 'parent-drop-event',
                                    dragData: dragData,
                                    clientX: iframeX,
                                    clientY: iframeY
                                }, '*');
                                
                                console.log('[TADjs] iframeにドロップイベントを転送完了');
                                e.preventDefault();
                                return false;
                            } catch (err) {
                                console.log('[TADjs] ドロップデータのJSON解析失敗、通常処理へ');
                            }
                        }
                    }
                }
                
                // iframe以外、またはJSON解析失敗の場合はデフォルト動作を防ぐ
                e.preventDefault();
                return false;
            });
        }, 100); // 100ms後に実行
    }

    
    /**
     * ドロップされたファイルを処理
     * @param {FileList} files - ドロップされたファイルリスト
     */
    handleFilesDrop(files) {
        this.setStatusMessage(`${files.length}個のファイルを受け取りました`);

        console.log('[TADjs] handleFilesDrop - files:', files.length);

        // アクティブなウィンドウを取得
        const activeWindow = document.querySelector('.window.active');
        console.log('[TADjs] activeWindow:', activeWindow ? activeWindow.id : 'null');

        // アクティブなウィンドウの情報を取得（windows Mapから）
        let pluginId = null;
        if (activeWindow) {
            const windowInfo = this.windows.get(activeWindow.id);
            if (windowInfo && windowInfo.pluginId) {
                pluginId = windowInfo.pluginId;
            }
        }
        console.log('[TADjs] pluginId:', pluginId);

        // アクティブなウィンドウがプラグインウィンドウかチェック
        if (activeWindow && pluginId) {
            console.log('[TADjs] アクティブなプラグインウィンドウ:', pluginId);

            // 仮身一覧プラグインの場合は、仮身として追加
            if (pluginId === 'virtual-object-list') {
                const iframe = activeWindow.querySelector('iframe');
                console.log('[TADjs] iframe:', iframe ? 'found' : 'null', 'contentWindow:', iframe && iframe.contentWindow ? 'found' : 'null');

                if (iframe && iframe.contentWindow) {
                    files.forEach(async (file) => {
                        console.log('[TADjs] 仮身一覧プラグインにファイルを追加:', file.name);

                        // ファイルをメモリに保存
                        this.fileObjects[file.name] = file;

                        // Electron環境の場合、ファイルシステムにも保存
                        try {
                            const arrayBuffer = await file.arrayBuffer();
                            const uint8Array = new Uint8Array(arrayBuffer);
                            await this.saveDataFile(file.name, uint8Array);
                            console.log('[TADjs] ファイルをディスクに保存しました:', file.name);
                        } catch (error) {
                            console.error('[TADjs] ファイル保存エラー:', error);
                        }

                        // プラグインに仮身追加メッセージを送信
                        iframe.contentWindow.postMessage({
                            type: 'add-virtual-object',
                            file: {
                                name: file.name,
                                // ファイルの中身は後で読み込むため、ここではファイル名のみ
                            }
                        }, '*');
                    });
                    return; // 処理完了
                }
            } else {
                // その他のプラグインウィンドウの場合は、各ファイルを開く
                files.forEach((file) => {
                    console.log('[TADjs] プラグインウィンドウでファイルを開く:', file.name);
                    this.openTADFile(file);
                });
                return; // 処理完了
            }
        }

        // アクティブなウィンドウがない、またはプラグインウィンドウでない場合
        {
            console.log('[TADjs] アクティブなウィンドウがない、またはプラグインウィンドウでない');

            // デフォルトウィンドウの場合は、ファイルアイコンを追加
            // file-iconsコンテナが存在するかチェック
            const fileIconsContainer = document.getElementById('file-icons');
            console.log('[TADjs] file-iconsコンテナ:', fileIconsContainer ? 'found' : 'null');

            if (fileIconsContainer) {
                // file-iconsコンテナが存在する場合は、ファイルアイコンを追加
                console.log('[TADjs] file-iconsコンテナにファイルアイコンを追加');
                files.forEach((file, index) => {
                    this.addFileIcon(file, index);
                });
            } else {
                // file-iconsコンテナが存在しない場合、仮身一覧プラグインのウィンドウを探す
                // windows Mapから仮身一覧プラグインのウィンドウを探す
                let virtualObjectListWindow = null;
                for (const [windowId, windowInfo] of this.windows.entries()) {
                    if (windowInfo.pluginId === 'virtual-object-list') {
                        virtualObjectListWindow = document.getElementById(windowId);
                        break;
                    }
                }
                console.log('[TADjs] 仮身一覧プラグインのウィンドウ:', virtualObjectListWindow ? virtualObjectListWindow.id : 'null');

                if (virtualObjectListWindow) {
                    // 仮身一覧プラグインがあれば、そこに追加
                    const iframe = virtualObjectListWindow.querySelector('iframe');
                    console.log('[TADjs] 仮身一覧プラグインのiframe:', iframe ? 'found' : 'null');

                    if (iframe && iframe.contentWindow) {
                        console.log('[TADjs] 仮身一覧プラグインに追加（フォールバック）');
                        files.forEach(async (file) => {
                            console.log('[TADjs] 仮身一覧プラグインにファイルを追加:', file.name);

                            // ファイルをメモリに保存
                            this.fileObjects[file.name] = file;

                            // Electron環境の場合、ファイルシステムにも保存
                            try {
                                const arrayBuffer = await file.arrayBuffer();
                                const uint8Array = new Uint8Array(arrayBuffer);
                                await this.saveDataFile(file.name, uint8Array);
                                console.log('[TADjs] ファイルをディスクに保存しました:', file.name);
                            } catch (error) {
                                console.error('[TADjs] ファイル保存エラー:', error);
                            }

                            iframe.contentWindow.postMessage({
                                type: 'add-virtual-object',
                                file: { name: file.name }
                            }, '*');
                        });
                    }
                } else {
                    // どちらもない場合は、警告を出す（ファイルは開かない）
                    console.warn('[TADjs] 初期ウィンドウも仮身一覧プラグインもありません。ファイルを配置できません。');
                }
            }
        }
    }

    /**
     * 原紙箱からドロップされた原紙ファイルを処理
     * @param {Object} dragData - ドラッグデータ
     * @param {MessageEvent} messageEvent - メッセージイベント（e.sourceとe.dataを含む）
     */
    async handleBaseFileDrop(dragData, messageEvent) {
        console.log('[TADjs] handleBaseFileDrop開始:', dragData);

        // 原紙箱からのドロップでない場合は処理しない
        if (dragData.type !== 'base-file-copy') {
            console.log('[TADjs] handleBaseFileDrop: 原紙箱からのドロップではないためスキップ');
            return;
        }

        // ドロップ元のiframeを取得
        const dropTargetWindow = messageEvent ? messageEvent.source : null;
        // dropPositionがメッセージに含まれている場合はそれを使用、なければclientX/Yから作成
        const dropPosition = messageEvent && messageEvent.data
            ? (messageEvent.data.dropPosition || { x: messageEvent.data.clientX, y: messageEvent.data.clientY })
            : null;
        console.log('[TADjs] ドロップ先ウィンドウ:', dropTargetWindow ? 'あり' : 'なし', 'ドロップ位置:', dropPosition);

        // 実身名を入力するダイアログを表示
        const result = await this.showInputDialog(
            '新しい実身の名称を入力してください',
            dragData.baseFile.displayName,
            30,
            [
                { label: '取消', value: 'cancel' },
                { label: '設定', value: 'ok' }
            ],
            1 // デフォルトは「設定」ボタン
        );

        console.log('[TADjs] ダイアログ結果:', result);

        // 取消の場合は何もしない
        if (result.button === 'cancel' || !result.value) {
            console.log('[TADjs] キャンセルされました');
            return;
        }

        const newName = result.value;
        console.log('[TADjs] 新しい実身名:', newName);

        // 新しい実身IDを生成（tad.jsのgenerateUUIDv7を使用）
        const newRealId = typeof generateUUIDv7 === 'function' ? generateUUIDv7() : this.generateRealFileIdSet(1).fileId;
        console.log('[TADjs] 新しい実身ID:', newRealId);

        // basefileの情報を取得
        const baseFile = dragData.baseFile;
        const pluginId = baseFile.pluginId;

        // basefileのJSONとXTADを読み込む
        let basefileJson = null;
        let basefileXtad = null;
        let basefileJsonName = null;  // basefileのJSONファイル名を保存
        let basefileIcoName = null;   // basefileのICOファイル名を保存

        try {
            // JSONファイルのパスを構築
            if (typeof baseFile.basefile === 'object') {
                basefileJsonName = baseFile.basefile.json;
                basefileIcoName = baseFile.basefile.ico;  // icoファイル名を取得
            } else {
                // basefileが文字列の場合、_0.xtadを削除して.jsonを追加
                // 例: "0199eb7d-6e78-79fb-fe14-1865d0a23d0f_0.xtad" -> "0199eb7d-6e78-79fb-fe14-1865d0a23d0f.json"
                basefileJsonName = baseFile.basefile.replace(/_\d+\.xtad$/i, '.json');
                basefileIcoName = baseFile.basefile.replace(/_\d+\.xtad$/i, '.ico');  // icoファイル名も推測
            }
            const jsonPath = `plugins/${pluginId}/${basefileJsonName}`;

            // JSONファイルを読み込む
            const jsonResponse = await fetch(jsonPath);
            if (jsonResponse.ok) {
                basefileJson = await jsonResponse.json();
                console.log('[TADjs] basefile JSON読み込み完了:', basefileJson);
            } else {
                // JSONがない場合は空のオブジェクトを作成
                basefileJson = {
                    name: newName,
                    applist: []
                };
                console.log('[TADjs] basefile JSONがないため、新規作成');
            }

            // XTADファイルのパスを構築
            const xtadFileName = typeof baseFile.basefile === 'object'
                ? baseFile.basefile.xmltad
                : baseFile.basefile;
            const xtadPath = `plugins/${pluginId}/${xtadFileName}`;

            // XTADファイルを読み込む
            const xtadResponse = await fetch(xtadPath);
            if (xtadResponse.ok) {
                basefileXtad = await xtadResponse.text();
                console.log('[TADjs] basefile XTAD読み込み完了');
            } else {
                console.error('[TADjs] basefile XTAD読み込み失敗');
                return;
            }

        } catch (error) {
            console.error('[TADjs] basefile読み込みエラー:', error);
            return;
        }

        // 新しい実身のJSONを作成（nameとrefCountを更新）
        const currentDateTime = new Date().toISOString();
        const newRealJson = {
            ...basefileJson,
            name: newName,
            makeDate: currentDateTime,     // 作成日時
            updateDate: currentDateTime,   // 更新日時
            accessDate: currentDateTime,   // アクセス日時
            refCount: 1  // 新規作成時は1
        };

        // 新しい実身のXTADを作成（filename属性を更新）
        const newRealXtad = basefileXtad.replace(
            /filename="[^"]*"/,
            `filename="${newName}"`
        );

        // RealObjectSystemに実身を登録（ファイルに直接保存）
        if (this.realObjectSystem) {
            try {
                const metadata = {
                    realId: newRealId,
                    realName: newName,
                    recordCount: 1,
                    refCount: 1,  // 新規作成時は1
                    createdAt: new Date().toISOString(),
                    modifiedAt: new Date().toISOString()
                };

                const realObject = {
                    metadata: metadata,
                    records: [{ xtad: newRealXtad, images: [] }]
                };

                await this.realObjectSystem.saveRealObject(newRealId, realObject);

                console.log('[TADjs] 実身をファイルに保存:', newRealId, newName);
            } catch (error) {
                console.error('[TADjs] 実身保存エラー:', error);
            }
        }

        // Electron環境の場合のファイル保存は既にrealObjectSystemが行っているので不要
        const jsonFileName = `${newRealId}.json`;
        const xtadFileName = `${newRealId}_0.xtad`;

        const jsonSaved = await this.saveDataFile(jsonFileName, JSON.stringify(newRealJson, null, 2));
        const xtadSaved = await this.saveDataFile(xtadFileName, newRealXtad);

        if (jsonSaved && xtadSaved) {
            console.log('[TADjs] 新しい実身をファイルシステムに保存しました:', jsonFileName, xtadFileName);
        } else {
            console.warn('[TADjs] ファイルシステムへの保存に失敗しました');
        }

        // アイコンファイル（.ico）をコピー
        if (this.isElectronEnv) {
            try {
                // basefileIcoNameが指定されている場合のみコピー
                if (basefileIcoName) {
                    const baseIconPath = `plugins/${pluginId}/${basefileIcoName}`;

                    // アイコンファイルが存在するかチェック
                    const iconResponse = await fetch(baseIconPath);
                    if (iconResponse.ok) {
                        const iconData = await iconResponse.arrayBuffer();
                        const newIconFileName = `${newRealId}.ico`;
                        const iconSaved = await this.saveDataFile(newIconFileName, iconData);
                        if (iconSaved) {
                            console.log('[TADjs] アイコンファイルをコピーしました:', baseIconPath, '->', newIconFileName);
                        } else {
                            console.warn('[TADjs] アイコンファイルのコピーに失敗しました:', newIconFileName);
                        }
                    } else {
                        console.log('[TADjs] basefileにアイコンファイルが存在しません:', baseIconPath);
                    }
                } else {
                    console.log('[TADjs] basefileにicoファイルが指定されていません');
                }
            } catch (error) {
                console.warn('[TADjs] アイコンファイルコピー中のエラー:', error.message);
            }
        }

        console.log('[TADjs] 新しい実身を保存しました:', newRealId, newName);

        // ドロップ先のウィンドウに仮身を追加
        if (dropTargetWindow) {
            dropTargetWindow.postMessage({
                type: 'add-virtual-object-from-base',
                realId: newRealId,
                name: newName,
                dropPosition: dropPosition,
                applist: newRealJson.applist || {}  // applist情報も送信
            }, '*');
            console.log('[TADjs] ドロップ先に仮身を追加:', newRealId, newName, dropPosition, 'applist:', newRealJson.applist);
        } else {
            console.warn('[TADjs] ドロップ先ウィンドウが不明です');
        }

        this.setStatusMessage(`実身「${newName}」を作成しました`);
    }

    /**
     * 屑実身操作からドロップされた実身を復元
     * @param {Object} dragData - ドラッグデータ
     * @param {MessageEvent} messageEvent - メッセージイベント
     */
    async handleTrashRealObjectDrop(dragData, messageEvent) {
        console.log('[TADjs] handleTrashRealObjectDrop開始:', dragData);

        // 屑実身操作からのドロップでない場合は処理しない
        if (dragData.type !== 'trash-real-object-restore') {
            console.log('[TADjs] handleTrashRealObjectDrop: 屑実身操作からのドロップではないためスキップ');
            return;
        }

        // ドロップ元のiframeを取得
        const dropTargetWindow = messageEvent ? messageEvent.source : null;
        const dropPosition = messageEvent && messageEvent.data
            ? (messageEvent.data.dropPosition || { x: messageEvent.data.clientX, y: messageEvent.data.clientY })
            : null;
        console.log('[TADjs] ドロップ先ウィンドウ:', dropTargetWindow ? 'あり' : 'なし', 'ドロップ位置:', dropPosition);

        const realObject = dragData.realObject;
        const realId = realObject.realId;
        const name = realObject.name;

        console.log('[TADjs] 屑実身を復元:', realId, name);

        // RealObjectSystemから実身を読み込む
        if (!this.realObjectSystem) {
            console.error('[TADjs] RealObjectSystemが初期化されていません');
            return;
        }

        try {
            // 実身を読み込む
            const loadedRealObject = await this.realObjectSystem.loadRealObject(realId);
            console.log('[TADjs] 実身読み込み完了:', realId);

            // 参照カウントを増やす
            const currentRefCount = loadedRealObject.metadata.refCount || 0;
            const newRefCount = currentRefCount + 1;

            // メタデータを更新
            const jsonFileName = `${realId}.json`;
            const jsonPath = this.getDataBasePath() + '/' + jsonFileName;
            const metadata = loadedRealObject.metadata;
            metadata.refCount = newRefCount;
            metadata.accessDate = new Date().toISOString();

            // ファイルに保存
            await this.saveDataFile(jsonFileName, JSON.stringify(metadata, null, 2));
            console.log('[TADjs] 参照カウント更新:', realId, currentRefCount, '->', newRefCount);

            // ドロップ先のウィンドウに仮身を追加
            if (dropTargetWindow) {
                dropTargetWindow.postMessage({
                    type: 'add-virtual-object-from-trash',
                    realId: realId,
                    name: name,
                    dropPosition: dropPosition,
                    applist: metadata.applist || {}
                }, '*');
                console.log('[TADjs] ドロップ先に仮身を追加:', realId, name, dropPosition);
            } else {
                console.warn('[TADjs] ドロップ先ウィンドウが不明です');
            }

            this.setStatusMessage(`実身「${name}」を復元しました`);
        } catch (error) {
            console.error('[TADjs] 屑実身復元エラー:', error);
            this.setStatusMessage(`実身「${name}」の復元に失敗しました`);
        }
    }

    /**
     * クロスウィンドウドロップ成功を元のウィンドウに通知
     * @param {Object} data - ドロップデータ
     */
    notifySourceWindowOfCrossWindowDrop(data) {
        console.log('[TADjs] クロスウィンドウドロップ通知:', data.sourceWindowId);

        // 全てのiframeに問い合わせて、sourceWindowIdと一致するものを探す
        const iframes = document.querySelectorAll('iframe');

        iframes.forEach(iframe => {
            try {
                // 各iframeに「あなたのwindowIdはこれですか？」と問い合わせる
                // より確実な方法：全iframeにブロードキャストして、該当するものだけが反応する
                iframe.contentWindow.postMessage({
                    type: 'check-window-id',
                    targetWindowId: data.sourceWindowId,
                    dropData: {
                        mode: data.mode,
                        virtualObjectId: data.virtualObjectId
                    }
                }, '*');
            } catch (error) {
                // クロスオリジンエラーは無視
                console.warn('[TADjs] iframe通知エラー:', error);
            }
        });
    }

    /**
     * ファイルアイコンを初期ウインドウに追加
     * @param {File} file - ファイルオブジェクト
     * @param {number} index - ファイルのインデックス
     */
    addFileIcon(file, index) {
        // ファイルオブジェクトを保存
        this.fileObjects[file.name] = file;

        const fileIconsContainer = document.getElementById('file-icons');

        // file-iconsコンテナが存在しない場合は、何もしない（エラー回避）
        if (!fileIconsContainer) {
            console.warn('[TADjs] file-iconsコンテナが見つかりません:', file.name);
            return;
        }

        const fileIcon = document.createElement('div');
        fileIcon.className = 'file-icon';
        fileIcon.dataset.filename = file.name;
        fileIcon.dataset.fileName = file.name;  // プラグインメニュー用(大文字N)

        fileIcon.innerHTML = `
            <div class="file-icon-image"></div>
            <div class="file-icon-text">${file.name}</div>
        `;

        // クリックとダブルクリックを区別するためのタイマー
        let clickTimer = null;

        // クリックイベント（選択）
        fileIcon.addEventListener('click', (e) => {
            e.stopPropagation();

            if (clickTimer === null) {
                clickTimer = setTimeout(() => {
                    // シングルクリック：選択
                    this.selectFileIcon(fileIcon);
                    clickTimer = null;
                }, 250); // 250ms待機
            }
        });

        // ダブルクリックでファイルを開く
        fileIcon.addEventListener('dblclick', (e) => {
            e.stopPropagation();

            // シングルクリックタイマーをクリア
            if (clickTimer !== null) {
                clearTimeout(clickTimer);
                clickTimer = null;
            }

            console.log('Opening file:', file.name);
            this.openTADFile(file);
        });

        fileIconsContainer.appendChild(fileIcon);
    }

    /**
     * ファイルアイコンを選択状態にする
     * @param {HTMLElement} icon - ファイルアイコン要素
     */
    selectFileIcon(icon) {
        // 既存の選択を解除
        document.querySelectorAll('.file-icon.selected').forEach(el => {
            el.classList.remove('selected');
        });
        
        // 新しい選択
        icon.classList.add('selected');
    }

    async openTADFile(file) {
        try {
            console.log('Opening TAD file:', file.name, file);
            this.setStatusMessage(`${file.name} を読み込み中...`);

            const arrayBuffer = await file.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);

            console.log('TAD data loaded:', uint8Array.length, 'bytes');

            // TADウインドウを作成（従来の処理）
            const windowId = await this.createTADWindow(file.name, uint8Array);

            this.setStatusMessage(`${file.name} を開きました`);
            console.log('TAD window created:', windowId);

        } catch (error) {
            console.error('TADファイルの読み込みエラー:', error);
            this.setStatusMessage(`エラー: ${file.name} を開けませんでした`);
        }
    }

    /**
     * 新しいウインドウを作成
     * @param {string} title - ウインドウタイトル
     * @param {string} content - ウインドウのHTML内容
     * @param {Object} options - ウインドウオプション (width, height, x, y, resizable, closeable等)
     * @returns {string} 作成されたウインドウのID
     */
    createWindow(title, content, options = {}) {
        const windowId = 'window_' + (++this.windowCounter);
        const windowElement = document.createElement('div');
        windowElement.className = `window normal-window opening ${options.cssClass || ''}`.trim();
        windowElement.id = windowId;
        windowElement.setAttribute('data-window-id', windowId);
        
        const defaultOptions = {
            width: 400,
            height: 300,
            x: 50 + (this.windowCounter * 30),
            y: 50 + (this.windowCounter * 30),
            resizable: true,
            scrollable: true,  // スクロール可能かどうか
            customScrollbar: true,  // カスタムスクロールバーを有効化
            maximize: false,  // 最大化状態
            maximizable: true,  // 最大化可能かどうか
            minimizable: true,  // 最小化可能かどうか
            closable: true,  // 閉じることができるかどうか
            alwaysOnTop: false,  // 常に最前面
            skipTaskbar: false,  // タスクバーに表示しない
            frame: true,  // ウィンドウフレームを表示
            transparent: false  // 透明背景
        };

        const opts = { ...defaultOptions, ...options };

        windowElement.innerHTML = `
            <div class="window-titlebar">
                <div class="window-icon"></div>
                <div class="window-title">${title}</div>
            </div>
            <div class="window-content">
                ${content}
            </div>
            ${(!opts.resizable || !opts.scrollable) ? '' : '<div class="window-corner"></div>'}
            <div class="window-maximize-corner"></div>
            ${opts.resizable ? this.createResizeHandles() : ''}
        `;

        // 位置とサイズを設定
        windowElement.style.left = opts.x + 'px';
        windowElement.style.top = opts.y + 'px';
        windowElement.style.width = opts.width + 'px';
        windowElement.style.height = opts.height + 'px';

        // scrollable設定をdata属性として保存
        windowElement.dataset.scrollable = opts.scrollable ? 'true' : 'false';

        // スクロールバーなしの場合はoverflowを制御
        if (!opts.scrollable) {
            const windowContent = windowElement.querySelector('.window-content');
            if (windowContent) {
                windowContent.style.overflow = 'hidden';
            }
        }

        // ウィンドウオプションを適用
        // resizableオプション（リサイズハンドルは既にinnerHTMLで設定済み）
        if (!opts.resizable) {
            windowElement.classList.add('non-resizable');
        }

        // frameオプション
        if (!opts.frame) {
            windowElement.classList.add('frameless');
            const titlebar = windowElement.querySelector('.window-titlebar');
            if (titlebar) {
                titlebar.style.display = 'none';
            }
        }

        // transparentオプション
        if (opts.transparent) {
            windowElement.style.backgroundColor = 'transparent';
        }

        // alwaysOnTopオプション
        if (opts.alwaysOnTop) {
            windowElement.style.zIndex = '10000';
            windowElement.classList.add('always-on-top');
        }

        // アイコンを設定（iconDataがある場合）
        if (opts.iconData) {
            const windowIcon = windowElement.querySelector('.window-icon');
            if (windowIcon) {
                // iconDataがBase64文字列の場合、data URLに変換
                const iconUrl = opts.iconData.startsWith('data:')
                    ? opts.iconData
                    : `data:image/x-icon;base64,${opts.iconData}`;
                windowIcon.style.backgroundImage = `url(${iconUrl})`;
                windowIcon.style.backgroundSize = 'contain';
                windowIcon.style.backgroundRepeat = 'no-repeat';
                windowIcon.style.backgroundPosition = 'center';
            }
        }

        // ウインドウコンテナに追加
        document.getElementById('window-container').appendChild(windowElement);

        // カスタムスクロールバーを追加（scrollableがtrueの場合のみ）
        if (opts.customScrollbar && opts.scrollable) {
            this.createCustomScrollbar(windowElement);
        }

        // イベントリスナーを設定
        this.setupWindowEvents(windowElement);
        
        // ウインドウを管理リストに追加
        this.windows.set(windowId, {
            element: windowElement,
            title: title,
            options: opts,
            isMaximized: false,
            normalRect: { x: opts.x, y: opts.y, width: opts.width, height: opts.height }
        });

        // アクティブウインドウに設定
        this.setActiveWindow(windowId);

        // maximizeオプション - ウィンドウが作成された後に最大化
        if (opts.maximize && opts.maximizable) {
            // setTimeoutで次のイベントループで最大化を実行
            setTimeout(() => {
                this.toggleMaximizeWindow(windowId);
            }, 0);
        }

        return windowId;
    }

    /**
     * TADファイル用のウインドウを作成
     * @param {string} filename - ファイル名
     * @param {Object} data - TADデータ
     * @param {string|null} forceCanvasId - 強制的に使用するCanvas ID
     * @param {string|null} originalLinkId - リンク元のID
     * @returns {string} Canvas ID
     */
    /**
     * TADウィンドウを作成（プラグインシステム経由）
     * @param {string} filename - ファイル名
     * @param {Uint8Array} data - TADファイルのバイナリデータ
     * @param {string|null} _forceCanvasId - 強制的に使用するcanvas ID（非推奨、使用されない）
     * @param {number|null} originalLinkId - 元のリンクID（セカンダリウィンドウの場合）
     * @returns {string|null} 作成されたウィンドウID、失敗時はnull
     */
    async createTADWindow(filename, data, _forceCanvasId = null, originalLinkId = null) {
        console.log('[tadjs-desktop.js] createTADWindow called - using plugin system');

        // プラグインマネージャー経由でTADファイルを開く
        if (window.pluginManager) {
            const plugin = window.pluginManager.getPlugin('tadjs-view');
            if (plugin) {
                // fileDataを作成
                const fileData = {
                    fileName: filename,
                    rawData: data,
                    displayName: filename.replace('.tad', ''),
                    fileId: null,
                    realId: null,
                    originalLinkId: originalLinkId,
                    linkRecordList: window.linkRecordList || [],
                    tadRecordDataArray: window.tadRecordDataArray || []
                };

                console.log('[tadjs-desktop.js] Creating TAD window via plugin system:', fileData);

                // プラグインウィンドウを作成
                const windowId = await window.pluginManager.createPluginWindow(plugin, fileData);
                return windowId;
            } else {
                console.error('[tadjs-desktop.js] tadjs-view plugin not found');
                return null;
            }
        } else {
            console.error('[tadjs-desktop.js] PluginManager not initialized');
            return null;
        }
    }

    /**
     * 実行機能レコードからウインドウ位置情報を取得
     * @param {number} fileIndex - ファイルインデックス
     * @returns {Object|null} 位置情報 {x, y, width, height}
     */
    getWindowPositionFromExecFunc(fileIndex) {
        // tad.jsのexecFuncRecordListにアクセス
        if (typeof execFuncRecordList !== 'undefined' && execFuncRecordList[fileIndex] && execFuncRecordList[fileIndex].length > 0) {
            const execFunc = execFuncRecordList[fileIndex][0]; // 最初の実行機能付箋レコードを使用
            
            // window_viewが有効な場合はそれを優先使用
            if (execFunc.window_view && (execFunc.window_view.left || execFunc.window_view.top || execFunc.window_view.right || execFunc.window_view.bottom)) {
                const width = execFunc.window_view.right - execFunc.window_view.left;
                const height = execFunc.window_view.bottom - execFunc.window_view.top;
                
                // 有効なサイズの場合のみ使用
                if (width > 50 && height > 50) {
                    return {
                        x: execFunc.window_view.left,
                        y: execFunc.window_view.top,
                        width: width,
                        height: height,
                        source: 'window_view'
                    };
                }
            }
            
            // window_viewが無効な場合は元のviewを使用
            if (execFunc.view && (execFunc.view.left || execFunc.view.top || execFunc.view.right || execFunc.view.bottom)) {
                const width = execFunc.view.right - execFunc.view.left;
                const height = execFunc.view.bottom - execFunc.view.top;
                
                // 有効なサイズの場合のみ使用
                if (width > 50 && height > 50) {
                    return {
                        x: execFunc.view.left,
                        y: execFunc.view.top,
                        width: width,
                        height: height,
                        source: 'view'
                    };
                }
            }
        }
        return null;
    }

    /**
     * TADデータをCanvasに描画
     * @param {Object} data - TADデータ
     * @param {string} canvasId - Canvas要素のID
     * @param {string|null} originalLinkId - リンク元のID
     */
    /**
     * TADデータをプラグイン経由でレンダリング
     * 注: 現在はcreatePluginWindow経由で処理されるため、この関数は使用されていません
     * @deprecated プラグインシステム経由で直接ウィンドウが作成されるため不要
     * @param {Uint8Array} data - TADファイルのバイナリデータ
     * @param {string} canvasId - レンダリング先のcanvas ID（非推奨）
     * @param {number|null} originalLinkId - 元のリンクID（セカンダリウィンドウの場合）
     */
    async renderTADData(data, canvasId, originalLinkId = null) {
        console.warn('[tadjs-desktop.js] renderTADData is deprecated - use createTADWindow instead');
        console.log('[tadjs-desktop.js] Parameters:', { dataLength: data.length, canvasId, originalLinkId });

        // createTADWindowにリダイレクト
        const filename = `canvas-${canvasId}.tad`;
        return await this.createTADWindow(filename, data, canvasId, originalLinkId);
    }

    /**
     * 仮身（仮想オブジェクト）のイベントリスナーを設定
     * @param {HTMLCanvasElement} canvas - イベントを設定するcanvas要素
     */
    setupVirtualObjectEvents(canvas) {
        // 既存のイベントリスナーを削除してから新しいものを追加（重複防止）
        if (canvas._virtualObjectHandler) {
            canvas.removeEventListener('dblclick', canvas._virtualObjectHandler);
        }
        
        // 新しいダブルクリックハンドラーを作成
        canvas._virtualObjectHandler = async (e) => {
            const rect = canvas.getBoundingClientRect();
            const displayX = e.clientX - rect.left;
            const displayY = e.clientY - rect.top;
            
            // canvasの実際のサイズと表示サイズを比較してスケール比を計算
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;
            
            // クリック座標をcanvasの実際の座標系に変換
            const x = displayX * scaleX;
            const y = displayY * scaleY;
            
            // console.log(`TADjsDesktop dblclick at display(${displayX}, ${displayY}) -> canvas(${x}, ${y}) on canvas:`, canvas.id);
            // console.log(`Canvas size: ${canvas.width}x${canvas.height}, Display size: ${rect.width}x${rect.height}, Scale: ${scaleX}x${scaleY}`);
            
            // canvasに保存された仮身情報を使用（各canvasで独立）
            // canvas.virtualObjectLinksには既に[0]のデータが保存されているので、直接使用
            const links = canvas.virtualObjectLinks || (window.linkRecordList && window.linkRecordList[0]) || [];
            
            // console.log('Available virtual object links:', links);
            
            if (links && links.length > 0) {
                // console.log(`Checking ${links.length} links for hit test`);
                
                // クリック位置に仮身があるかチェック
                for (let i = 0; i < links.length; i++) {
                    const link = links[i];
                    // console.log(`Link ${i}:`, link);
                    // console.log(`  Coordinates: left=${link.left}, top=${link.top}, right=${link.right}, bottom=${link.bottom}`);
                    // console.log(`  Click position: x=${x}, y=${y}`);
                    // console.log(`  Hit test: ${link.left} <= ${x} <= ${link.right} && ${link.top} <= ${y} <= ${link.bottom}`);
                    
                    if (link && link.left !== undefined && link.left <= x && x <= link.right && 
                        link.top !== undefined && link.top <= y && y <= link.bottom) {
                        // console.log('Virtual object double-clicked:', link);
                        
                        // 重複クリック防止（短時間での連続クリックを防ぐ）
                        const now = Date.now();
                        if (this.lastLinkClickTime && now - this.lastLinkClickTime < 1000) {
                            // console.log('Duplicate click detected, ignoring');
                            return;
                        }
                        this.lastLinkClickTime = now;
                        
                        // 新しいウィンドウで仮身のリンク先を開く
                        if (link.raw && link.raw.length > 0) {
                            // リンク先のTADデータがある場合は新しいウィンドウで開く
                            const title = link.link_name || `仮身 - ${link.link_id || 'リンク'}`;
                            // console.log(`Opening link window with raw data: ${link.raw.length} bytes`);
                            // console.log('Link raw data preview:', link.raw.slice(0, 20));
                            const windowId = await this.createTADWindow(title, link.raw, null, link.link_id);
                            this.setStatusMessage(`${title} を新しいウィンドウで開きました`);
                        } else if (link.link_id !== undefined) {
                            // BPK内の別ファイルへのリンクの場合 - canvasに保存されたデータを優先
                            const linkedIndex = parseInt(link.link_id);
                            const tadRecordArray = canvas.tadRecordDataArray || window.tadRecordDataArray;
                            
                            // console.log('Looking for link_id:', linkedIndex, 'in tadRecordArray:', tadRecordArray ? tadRecordArray.length : 'null');
                            
                            if (tadRecordArray && tadRecordArray[linkedIndex]) {
                                const linkedEntry = tadRecordArray[linkedIndex];
                                const title = linkedEntry.name || `ファイル ${linkedIndex}`;
                                // console.log('Opening linked entry:', title, 'data length:', linkedEntry.data ? linkedEntry.data.length : 'null');
                                const windowId = await this.createTADWindow(title, linkedEntry.data, null, link.link_id);
                                this.setStatusMessage(`${title} を新しいウィンドウで開きました`);
                            } else {
                                // console.warn('Link target not found:', linkedIndex, 'available entries:', tadRecordArray ? tadRecordArray.length : 'null');
                                this.setStatusMessage(`リンク先のファイル (${link.link_id}) が見つかりません`);
                            }
                        } else {
                            this.setStatusMessage('リンク先のデータが見つかりません');
                        }
                        break;
                    }
                }
                // console.log('No virtual object found at click position');
            } else {
                // console.log('No virtual object links available');
            }
        };
        
        // イベントリスナーを追加
        canvas.addEventListener('dblclick', canvas._virtualObjectHandler);

        // 右クリックメニューの既存ハンドラーを削除
        if (canvas._contextMenuHandler) {
            canvas.removeEventListener('contextmenu', canvas._contextMenuHandler);
        }
        
        // 新しい右クリックメニューハンドラーを作成
        canvas._contextMenuHandler = (e) => {
            e.preventDefault();
            // 右クリックメニューを表示
            this.showContextMenu(e.clientX, e.clientY, e.target);
        };
        
        // 右クリックメニューのイベントリスナーを追加
        canvas.addEventListener('contextmenu', canvas._contextMenuHandler);
    }

    /**
     * 仮身（仮想オブジェクト）を開く
     * @param {Object} link - リンク情報オブジェクト
     */
    async openVirtualObject(linkIdOrObject, linkName = null) {
        // linkIdとlinkNameが個別に渡された場合（仮身一覧から呼ばれた場合）
        if (typeof linkIdOrObject === 'string' && linkName !== null) {
            const linkId = linkIdOrObject;
            console.log('[TADjs] 仮身一覧から仮身を開く:', linkId, linkName);

            // link_idから実身ID（UUID）を抽出
            let realId = linkId;
            realId = realId.replace(/\.(xtad|json|bpk|BPK)$/, '');
            realId = realId.replace(/_\d+$/, '');

            // 実身管理用JSONを読み込む
            try {
                const jsonFileName = `${realId}.json`;
                const jsonFile = await this.loadDataFileAsFile(jsonFileName);
                if (!jsonFile) {
                    throw new Error(`JSONファイルが見つかりません: ${jsonFileName}`);
                }
                const jsonText = await jsonFile.text();
                const realJson = JSON.parse(jsonText);

                // defaultOpen: true のプラグインを探す
                let defaultPlugin = null;
                if (realJson.applist) {
                    for (const [pluginId, pluginInfo] of Object.entries(realJson.applist)) {
                        if (pluginInfo.defaultOpen === true) {
                            defaultPlugin = pluginId;
                            break;
                        }
                    }
                }

                if (!defaultPlugin) {
                    console.error('[TADjs] defaultOpen: true のプラグインが見つかりません');
                    this.setStatusMessage('実身を開くプラグインが見つかりません');
                    return;
                }

                console.log('[TADjs] defaultOpenプラグインで開く:', defaultPlugin);

                // 仮身オブジェクトを構築してopenVirtualObjectRealを呼び出す
                const virtualObj = {
                    link_id: linkId,
                    link_name: linkName
                };

                await this.openVirtualObjectReal(virtualObj, defaultPlugin, null, null);

            } catch (error) {
                console.error('[TADjs] 仮身を開く際のエラー:', error);
                this.setStatusMessage(`仮身を開く際のエラー: ${error.message}`);
            }
            return;
        }

        // 従来のlinkオブジェクトが渡された場合（TADファイル内の仮身から呼ばれた場合）
        const link = linkIdOrObject;
        // console.log('Opening virtual object:', link);

        if (link.raw && link.raw.length > 0) {
            // リンク先のTADデータがある場合は新しいウィンドウで開く
            const title = link.link_name || `仮身 - ${link.link_id || 'リンク'}`;
            const windowId = await this.createTADWindow(title, link.raw, null, link.link_id);
            this.setStatusMessage(`${title} を開きました`);
        } else if (link.link_id !== undefined) {
            // BPK内の別ファイルへのリンクの場合 - グローバルからデータを取得
            const linkedIndex = parseInt(link.link_id);
            const tadRecordArray = window.tadRecordDataArray;

            // console.log('openVirtualObject: Looking for link_id:', linkedIndex, 'in global tadRecordArray:', tadRecordArray ? tadRecordArray.length : 'null');

            if (tadRecordArray && tadRecordArray[linkedIndex]) {
                const linkedEntry = tadRecordArray[linkedIndex];
                const title = linkedEntry.name || `ファイル ${linkedIndex}`;
                console.log('openVirtualObject: Opening linked entry:', title, 'data length:', linkedEntry.data ? linkedEntry.data.length : 'null');
                // const windowId = this.createTADWindow(title, linkedEntry.data, null, link.link_id);
                this.setStatusMessage(`${title} を開きました`);
            } else {
                // console.warn('openVirtualObject: Link target not found:', linkedIndex, 'available entries:', tadRecordArray ? tadRecordArray.length : 0);
                this.setStatusMessage(`リンク先のファイル (${link.link_id}) が見つかりません`);
            }
        } else {
            this.setStatusMessage('リンク先のデータが見つかりません');
        }
    }

    /**
     * ウィンドウのリサイズハンドルHTMLを生成
     * @returns {string} リサイズハンドルのHTML文字列
     */
    createResizeHandles() {
        return `
            <div class="resize-handle nw"></div>
            <div class="resize-handle ne"></div>
            <div class="resize-handle sw"></div>
            <div class="resize-handle se"></div>
            <div class="resize-handle n"></div>
            <div class="resize-handle s"></div>
            <div class="resize-handle w"></div>
            <div class="resize-handle e"></div>
        `;
    }

    /**
     * カスタムスクロールバーを作成
     * @param {HTMLElement} windowElement - スクロールバーを追加するウィンドウ要素
     */
    createCustomScrollbar(windowElement) {
        // TADウィンドウかどうかを判定
        const isTADWindow = windowElement.classList.contains('tad-window');
        
        // スクロール対象を適切に選択
        let content;
        if (isTADWindow) {
            content = windowElement.querySelector('.tad-content');
        } else {
            content = windowElement.querySelector('.window-content');
        }
        
        if (!content) return;

        // スクロールバーコンテナを作成
        const scrollContainer = document.createElement('div');
        scrollContainer.className = 'custom-scroll-container';
        
        // 縦スクロールバー
        const vScrollbar = document.createElement('div');
        vScrollbar.className = 'custom-scrollbar custom-scrollbar-vertical vertical';
        vScrollbar.innerHTML = `
            <div class="scroll-track">
                <div class="scroll-thumb">
                    <div class="scroll-thumb-indicator"></div>
                </div>
            </div>
        `;

        // 横スクロールバー
        const hScrollbar = document.createElement('div');
        hScrollbar.className = 'custom-scrollbar custom-scrollbar-horizontal horizontal';
        hScrollbar.innerHTML = `
            <div class="scroll-track">
                <div class="scroll-thumb">
                    <div class="scroll-thumb-indicator"></div>
                </div>
            </div>
        `;
        
        // 右下コーナー（スクロールバーの交点）
        const scrollCorner = document.createElement('div');
        scrollCorner.className = 'scroll-corner';
        
        scrollContainer.appendChild(vScrollbar);
        scrollContainer.appendChild(hScrollbar);
        scrollContainer.appendChild(scrollCorner);
        windowElement.appendChild(scrollContainer);

        // プラグインウィンドウ（iframe）かどうかを判定
        const iframe = windowElement.querySelector('iframe');

        if (iframe) {
            // プラグインウィンドウの場合、iframe専用の初期化
            this.initScrollbarForPlugin(iframe, content, vScrollbar, 'vertical');
            this.initScrollbarForPlugin(iframe, content, hScrollbar, 'horizontal');
        } else {
            // 通常のウィンドウ（TADウィンドウなど）の場合
            this.initScrollbar(content, vScrollbar, 'vertical');
            this.initScrollbar(content, hScrollbar, 'horizontal');

            // TADウィンドウの場合、追加の初期化遅延を設定
            if (isTADWindow) {
                setTimeout(() => {
                    this.forceUpdateScrollbar(content, vScrollbar, 'vertical');
                    this.forceUpdateScrollbar(content, hScrollbar, 'horizontal');
                }, 300);
            }
        }
    }
    
    /**
     * スクロールバーの初期化
     * @param {HTMLElement} content - スクロール対象のコンテンツ要素
     * @param {HTMLElement} scrollbar - スクロールバー要素
     * @param {string} direction - スクロール方向（'vertical'または'horizontal'）
     */
    initScrollbar(content, scrollbar, direction) {
        const thumb = scrollbar.querySelector('.scroll-thumb');
        const track = scrollbar.querySelector('.scroll-track');
        
        let isDragging = false;
        let startPos = 0;
        let startScroll = 0;
        
        // コンテンツのスクロール状態を更新
        const updateScrollbar = () => {
            // まずtrack要素の実際のサイズを取得
            const trackRect = track.getBoundingClientRect();
            
            if (direction === 'vertical') {
                const scrollHeight = content.scrollHeight;
                const clientHeight = content.clientHeight;
                
                // 常時表示
                scrollbar.style.display = 'block';
                
                if (scrollHeight <= clientHeight) {
                    // スクロール不要の場合
                    thumb.style.height = Math.max(20, trackRect.height - 4) + 'px';
                    thumb.style.top = '2px';
                    thumb.style.background = '#d0d0d0';
                    thumb.style.cursor = 'default';
                } else {
                    // スクロール可能な場合
                    const viewportRatio = clientHeight / scrollHeight;
                    const thumbHeight = Math.max(20, trackRect.height * viewportRatio);
                    const scrollRatio = content.scrollTop / (scrollHeight - clientHeight);
                    const maxThumbTop = trackRect.height - thumbHeight;
                    const thumbTop = scrollRatio * maxThumbTop;
                    
                    thumb.style.height = thumbHeight + 'px';
                    thumb.style.top = thumbTop + 'px';
                    thumb.style.background = 'var(--window-titlebar-active)';
                    thumb.style.cursor = 'pointer';
                }
            } else {
                const scrollWidth = content.scrollWidth;
                const clientWidth = content.clientWidth;
                
                // 常時表示
                scrollbar.style.display = 'block';
                
                if (scrollWidth <= clientWidth) {
                    // スクロール不要の場合
                    thumb.style.width = Math.max(20, trackRect.width - 4) + 'px';
                    thumb.style.left = '2px';
                    thumb.style.background = '#d0d0d0';
                    thumb.style.cursor = 'default';
                } else {
                    // スクロール可能な場合
                    const viewportRatio = clientWidth / scrollWidth;
                    const thumbWidth = Math.max(20, trackRect.width * viewportRatio);
                    const scrollRatio = content.scrollLeft / (scrollWidth - clientWidth);
                    const maxThumbLeft = trackRect.width - thumbWidth;
                    const thumbLeft = scrollRatio * maxThumbLeft;
                    
                    thumb.style.width = thumbWidth + 'px';
                    thumb.style.left = thumbLeft + 'px';
                    thumb.style.background = 'var(--window-titlebar-active)';
                    thumb.style.cursor = 'pointer';
                }
            }
        };
        
        // ドラッグ開始
        thumb.addEventListener('mousedown', (e) => {
            // スクロール不要な場合はドラッグ無効
            if (direction === 'vertical' && content.scrollHeight <= content.clientHeight) return;
            if (direction === 'horizontal' && content.scrollWidth <= content.clientWidth) return;
            
            isDragging = true;
            if (direction === 'vertical') {
                startPos = e.clientY;
                startScroll = content.scrollTop;
            } else {
                startPos = e.clientX;
                startScroll = content.scrollLeft;
            }
            thumb.classList.add('dragging');
            e.preventDefault();
        });
        
        // ドラッグ中
        const handleMouseMove = (e) => {
            if (!isDragging) return;
            
            const trackRect = track.getBoundingClientRect();
            
            if (direction === 'vertical') {
                const delta = e.clientY - startPos;
                const thumbHeight = parseFloat(thumb.style.height);
                const maxThumbMove = trackRect.height - thumbHeight;
                const scrollHeight = content.scrollHeight - content.clientHeight;
                
                if (maxThumbMove > 0) {
                    const scrollDelta = (delta / maxThumbMove) * scrollHeight;
                    content.scrollTop = Math.max(0, Math.min(scrollHeight, startScroll + scrollDelta));
                }
            } else {
                const delta = e.clientX - startPos;
                const thumbWidth = parseFloat(thumb.style.width);
                const maxThumbMove = trackRect.width - thumbWidth;
                const scrollWidth = content.scrollWidth - content.clientWidth;
                
                if (maxThumbMove > 0) {
                    const scrollDelta = (delta / maxThumbMove) * scrollWidth;
                    content.scrollLeft = Math.max(0, Math.min(scrollWidth, startScroll + scrollDelta));
                }
            }
        };
        
        // ドラッグ終了
        const handleMouseUp = () => {
            if (isDragging) {
                isDragging = false;
                thumb.classList.remove('dragging');
            }
        };
        
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        
        // トラッククリック
        track.addEventListener('click', (e) => {
            if (e.target === thumb || thumb.contains(e.target)) return;
            
            // スクロール不要な場合はクリック無効
            if (direction === 'vertical' && content.scrollHeight <= content.clientHeight) return;
            if (direction === 'horizontal' && content.scrollWidth <= content.clientWidth) return;
            
            const trackRect = track.getBoundingClientRect();
            
            if (direction === 'vertical') {
                const clickPos = e.clientY - trackRect.top;
                const thumbHeight = parseFloat(thumb.style.height);
                const targetRatio = (clickPos - thumbHeight / 2) / (trackRect.height - thumbHeight);
                const clampedRatio = Math.max(0, Math.min(1, targetRatio));
                content.scrollTop = clampedRatio * (content.scrollHeight - content.clientHeight);
            } else {
                const clickPos = e.clientX - trackRect.left;
                const thumbWidth = parseFloat(thumb.style.width);
                const targetRatio = (clickPos - thumbWidth / 2) / (trackRect.width - thumbWidth);
                const clampedRatio = Math.max(0, Math.min(1, targetRatio));
                content.scrollLeft = clampedRatio * (content.scrollWidth - content.clientWidth);
            }
        });
        
        // スクロールイベントをリッスン
        content.addEventListener('scroll', updateScrollbar);
        
        // リサイズ監視（ウィンドウサイズ変更時など）
        const resizeObserver = new ResizeObserver(() => {
            // 少し遅延させてから更新（レンダリング完了を待つ）
            setTimeout(updateScrollbar, 10);
        });
        resizeObserver.observe(content);
        
        // 初期更新（少し遅延させる）
        setTimeout(updateScrollbar, 100);
        
        // クリーンアップ関数を返す
        return () => {
            content.removeEventListener('scroll', updateScrollbar);
            resizeObserver.disconnect();
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }

    /**
     * スクロールバーを強制的に更新（TADウィンドウの初期化時に使用）
     * @param {HTMLElement} content - スクロール対象のコンテンツ要素
     * @param {HTMLElement} scrollbar - スクロールバー要素
     * @param {string} direction - スクロール方向（'vertical'または'horizontal'）
     */
    forceUpdateScrollbar(content, scrollbar, direction) {
        const thumb = scrollbar.querySelector('.scroll-thumb');
        const track = scrollbar.querySelector('.scroll-track');
        
        if (!thumb || !track || !content) return;
        
        // trackの実際のサイズを取得
        const trackRect = track.getBoundingClientRect();
        
        if (direction === 'vertical') {
            const scrollHeight = content.scrollHeight;
            const clientHeight = content.clientHeight;
            
            if (scrollHeight <= clientHeight) {
                // スクロール不要
                thumb.style.height = Math.max(20, trackRect.height - 4) + 'px';
                thumb.style.top = '2px';
                thumb.style.background = '#d0d0d0';
                thumb.style.cursor = 'default';
            } else {
                // スクロール可能
                const viewportRatio = clientHeight / scrollHeight;
                const thumbHeight = Math.max(20, trackRect.height * viewportRatio);
                const scrollRatio = content.scrollTop / (scrollHeight - clientHeight);
                const maxThumbTop = trackRect.height - thumbHeight;
                const thumbTop = scrollRatio * maxThumbTop;
                
                thumb.style.height = thumbHeight + 'px';
                thumb.style.top = thumbTop + 'px';
                thumb.style.background = 'var(--window-titlebar-active)';
                thumb.style.cursor = 'pointer';
            }
        } else {
            const scrollWidth = content.scrollWidth;
            const clientWidth = content.clientWidth;
            
            if (scrollWidth <= clientWidth) {
                // スクロール不要
                thumb.style.width = Math.max(20, trackRect.width - 4) + 'px';
                thumb.style.left = '2px';
                thumb.style.background = '#d0d0d0';
                thumb.style.cursor = 'default';
            } else {
                // スクロール可能
                const viewportRatio = clientWidth / scrollWidth;
                const thumbWidth = Math.max(20, trackRect.width * viewportRatio);
                const scrollRatio = content.scrollLeft / (scrollWidth - clientWidth);
                const maxThumbLeft = trackRect.width - thumbWidth;
                const thumbLeft = scrollRatio * maxThumbLeft;
                
                thumb.style.width = thumbWidth + 'px';
                thumb.style.left = thumbLeft + 'px';
                thumb.style.background = 'var(--window-titlebar-active)';
                thumb.style.cursor = 'pointer';
            }
        }
    }

    /**
     * プラグインウィンドウのスクロールバーを更新（iframe内のコンテンツサイズを参照）
     * @param {HTMLIFrameElement} iframe - プラグインのiframe要素
     * @param {HTMLElement} content - スクロール対象のコンテンツ要素（.window-content）
     * @param {HTMLElement} scrollbar - スクロールバー要素
     * @param {string} direction - スクロール方向（'vertical'または'horizontal'）
     */
    forceUpdateScrollbarForPlugin(iframe, content, scrollbar, direction) {
        const thumb = scrollbar.querySelector('.scroll-thumb');
        const track = scrollbar.querySelector('.scroll-track');

        if (!thumb || !track || !content || !iframe) return;

        try {
            // iframe内の.plugin-contentまたはbodyを取得
            const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
            const pluginContent = iframeDoc.querySelector('.plugin-content') || iframeDoc.body;

            if (!pluginContent) return;

            // trackの実際のサイズを取得
            const trackRect = track.getBoundingClientRect();

            if (direction === 'vertical') {
                const scrollHeight = pluginContent.scrollHeight;
                const clientHeight = pluginContent.clientHeight;

                // console.log('[TADjs] スクロールバー更新(垂直):', {
                //     scrollHeight,
                //     clientHeight,
                //     needsScroll: scrollHeight > clientHeight
                // });

                if (scrollHeight <= clientHeight) {
                    // スクロール不要
                    thumb.style.height = Math.max(20, trackRect.height - 4) + 'px';
                    thumb.style.top = '2px';
                    thumb.style.background = '#d0d0d0';
                    thumb.style.cursor = 'default';
                } else {
                    // スクロール可能
                    const viewportRatio = clientHeight / scrollHeight;
                    const thumbHeight = Math.max(20, trackRect.height * viewportRatio);
                    // pluginContentの現在のscrollTopを使用
                    const scrollRatio = pluginContent.scrollTop / (scrollHeight - clientHeight);
                    const maxThumbTop = trackRect.height - thumbHeight;
                    const thumbTop = scrollRatio * maxThumbTop;

                    thumb.style.height = thumbHeight + 'px';
                    thumb.style.top = thumbTop + 'px';
                    thumb.style.background = 'var(--window-titlebar-active)';
                    thumb.style.cursor = 'pointer';
                }
            } else {
                const scrollWidth = pluginContent.scrollWidth;
                const clientWidth = pluginContent.clientWidth;

                // console.log('[TADjs] スクロールバー更新(水平):', {
                //     scrollWidth,
                //     clientWidth,
                //     needsScroll: scrollWidth > clientWidth
                // });

                if (scrollWidth <= clientWidth) {
                    // スクロール不要
                    thumb.style.width = Math.max(20, trackRect.width - 4) + 'px';
                    thumb.style.left = '2px';
                    thumb.style.background = '#d0d0d0';
                    thumb.style.cursor = 'default';
                } else {
                    // スクロール可能
                    const viewportRatio = clientWidth / scrollWidth;
                    const thumbWidth = Math.max(20, trackRect.width * viewportRatio);
                    // pluginContentの現在のscrollLeftを使用
                    const scrollRatio = pluginContent.scrollLeft / (scrollWidth - clientWidth);
                    const maxThumbLeft = trackRect.width - thumbWidth;
                    const thumbLeft = scrollRatio * maxThumbLeft;

                    thumb.style.width = thumbWidth + 'px';
                    thumb.style.left = thumbLeft + 'px';
                    thumb.style.background = 'var(--window-titlebar-active)';
                    thumb.style.cursor = 'pointer';
                }
            }
        } catch (error) {
            console.error('[TADjs] スクロールバー更新エラー:', error);
        }
    }

    /**
     * プラグインウィンドウ用のスクロールバー初期化（ iframe内のbodyをスクロール）
     * @param {HTMLIFrameElement} iframe - プラグインのiframe要素
     * @param {HTMLElement} content - ウィンドウコンテンツ要素（.window-content）
     * @param {HTMLElement} scrollbar - スクロールバー要素
     * @param {string} direction - スクロール方向（'vertical'または'horizontal'）
     */
    initScrollbarForPlugin(iframe, content, scrollbar, direction) {
        const thumb = scrollbar.querySelector('.scroll-thumb');
        const track = scrollbar.querySelector('.scroll-track');

        console.log('[TADjs] initScrollbarForPlugin呼び出し:', {
            direction,
            thumb: !!thumb,
            track: !!track,
            iframe: !!iframe
        });

        if (!thumb || !track || !iframe) {
            console.warn('[TADjs] スクロールバー要素が見つかりません');
            return;
        }

        let isDragging = false;
        let startPos = 0;
        let startScroll = 0;
        let scrollElement = null; // スクロール要素をキャッシュ

        // スクロール要素を取得する関数
        const getScrollElement = () => {
            if (scrollElement) return scrollElement;
            const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
            scrollElement = iframeDoc.querySelector('.plugin-content') || iframeDoc.body;
            return scrollElement;
        };

        // ドラッグ開始
        thumb.addEventListener('mousedown', (e) => {
            try {
                const pluginContent = getScrollElement();

                if (!pluginContent) {
                    console.warn('[TADjs] スクロール要素が見つかりません');
                    return;
                }

                console.log('[TADjs] スクロール情報:', {
                    direction,
                    scrollHeight: pluginContent.scrollHeight,
                    scrollWidth: pluginContent.scrollWidth,
                    clientHeight: pluginContent.clientHeight,
                    clientWidth: pluginContent.clientWidth
                });

                // スクロール不要な場合はドラッグ無効
                if (direction === 'vertical' && pluginContent.scrollHeight <= pluginContent.clientHeight) {
                    console.log('[TADjs] 垂直スクロール不要、ドラッグ無効');
                    return;
                }
                if (direction === 'horizontal' && pluginContent.scrollWidth <= pluginContent.clientWidth) {
                    console.log('[TADjs] 水平スクロール不要、ドラッグ無効');
                    return;
                }

                isDragging = true;

                if (direction === 'vertical') {
                    startPos = e.clientY;
                    startScroll = pluginContent.scrollTop;
                } else {
                    startPos = e.clientX;
                    startScroll = pluginContent.scrollLeft;
                }
                thumb.classList.add('dragging');
                e.preventDefault();
                console.log('[TADjs] ドラッグ開始:', { isDragging, startPos, startScroll });
            } catch (error) {
                console.error('[TADjs] スクロールバードラッグ開始エラー:', error);
            }
        });

        // ドラッグ中
        const handleMouseMove = (e) => {
            if (!isDragging) return;

            try {
                const pluginContent = getScrollElement();

                if (!pluginContent) return;

                const trackRect = track.getBoundingClientRect();

                if (direction === 'vertical') {
                    const delta = e.clientY - startPos;
                    const thumbHeight = parseFloat(thumb.style.height);
                    const maxThumbMove = trackRect.height - thumbHeight;
                    const scrollHeight = pluginContent.scrollHeight - pluginContent.clientHeight;

                    console.log('[TADjs] 垂直スクロール計算:', {
                        delta,
                        thumbHeight,
                        maxThumbMove,
                        scrollHeight
                    });

                    if (maxThumbMove > 0) {
                        const scrollDelta = (delta / maxThumbMove) * scrollHeight;
                        const newScrollTop = Math.max(0, Math.min(scrollHeight, startScroll + scrollDelta));
                        pluginContent.scrollTop = newScrollTop;
                        console.log('[TADjs] scrollTop設定:', newScrollTop);
                    }
                } else {
                    const delta = e.clientX - startPos;
                    const thumbWidth = parseFloat(thumb.style.width);
                    const maxThumbMove = trackRect.width - thumbWidth;
                    const scrollWidth = pluginContent.scrollWidth - pluginContent.clientWidth;

                    if (maxThumbMove > 0) {
                        const scrollDelta = (delta / maxThumbMove) * scrollWidth;
                        const newScrollLeft = Math.max(0, Math.min(scrollWidth, startScroll + scrollDelta));
                        pluginContent.scrollLeft = newScrollLeft;
                        console.log('[TADjs] scrollLeft設定:', newScrollLeft);
                    }
                }

                // スクロールバー表示を更新
                this.forceUpdateScrollbarForPlugin(iframe, content, scrollbar, direction);
            } catch (error) {
                console.error('[TADjs] スクロールバードラッグ中エラー:', error);
            }
        };

        // ドラッグ終了
        const handleMouseUp = () => {
            if (isDragging) {
                console.log('[TADjs] スクロールバードラッグ終了:', direction);
                isDragging = false;
                thumb.classList.remove('dragging');
            }
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);

        // iframe内の.plugin-contentまたはbodyにscrollイベントリスナーを登録
        // iframeの読み込みを待ってから登録
        const setupScrollListener = (retryCount = 0) => {
            try {
                const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                // .plugin-contentがあればそれを使用、なければbodyを使用
                let pluginContent = iframeDoc.querySelector('.plugin-content');

                if (!pluginContent && retryCount < 5) {
                    // .plugin-contentが見つからない場合、少し待ってから再試行
                    setTimeout(() => setupScrollListener(retryCount + 1), 50);
                    return;
                }

                // 5回試してもなければbodyを使用
                if (!pluginContent) {
                    pluginContent = iframeDoc.body;
                    if (!pluginContent) {
                        console.warn('[TADjs] iframe内のスクロール要素が見つかりません');
                        return;
                    }
                }

                pluginContent.addEventListener('scroll', () => {
                    this.forceUpdateScrollbarForPlugin(iframe, content, scrollbar, direction);
                });

                // 初期表示時のスクロールバーを更新
                this.forceUpdateScrollbarForPlugin(iframe, content, scrollbar, direction);
            } catch (error) {
                console.error('[TADjs] scrollリスナー登録エラー:', error);
            }
        };

        // iframeがすでに読み込まれているかチェック
        if (iframe.contentDocument && iframe.contentDocument.readyState === 'complete') {
            setupScrollListener();
        } else {
            iframe.addEventListener('load', setupScrollListener, { once: true });
        }

        console.log('[TADjs] スクロールバーイベントハンドラ登録完了:', direction);
    }

    /**
     * ウィンドウのイベントリスナーを設定
     * @param {HTMLElement} windowElement - イベントを設定するウィンドウ要素
     */
    setupWindowEvents(windowElement) {
        const titlebar = windowElement.querySelector('.window-titlebar');
        const windowIcon = windowElement.querySelector('.window-icon');
        
        // ウインドウをクリックでアクティブに
        windowElement.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            this.setActiveWindow(windowElement.id);
        });

        // アイコンのダブルクリックでウインドウを閉じる
        if (windowIcon) {
            windowIcon.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                e.preventDefault();
                this.closeWindow(windowElement.id);
            });
        }

        // 左上頂点（window-maximize-corner）のダブルクリックで全画面表示切り替え
        const maximizeCorner = windowElement.querySelector('.window-maximize-corner');
        if (maximizeCorner) {
            maximizeCorner.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                e.preventDefault();
                console.debug('Maximize corner double-clicked');
                this.toggleMaximizeWindow(windowElement.id);
            });
        }

        // タイトルバーでドラッグ移動（閉じるボタン以外）
        titlebar.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            if (e.target.classList.contains('window-close-button')) return;
            e.preventDefault();

            this.startWindowDrag(windowElement, e);
        });

        // リサイズハンドル
        const resizeHandles = windowElement.querySelectorAll('.resize-handle');
        resizeHandles.forEach((handle, index) => {
            handle.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                e.stopPropagation();

                // クラス名から方向を取得（resize-handle se -> se）
                const direction = handle.classList[1] || handle.className.split(' ')[1];

                this.startDirectResize(windowElement, direction, e);
            });
        });

        // window-cornerのリサイズ処理
        const windowCorner = windowElement.querySelector('.window-corner');
        if (windowCorner) {
            windowCorner.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                e.stopPropagation();

                this.startDirectResize(windowElement, 'se', e);
            });
        }

        // framelessウィンドウの場合、window-contentでドラッグ可能にする
        if (windowElement.classList.contains('frameless')) {
            const windowContent = windowElement.querySelector('.window-content');
            if (windowContent) {
                windowContent.addEventListener('mousedown', (e) => {
                    if (e.button !== 0) return;
                    // iframe内のクリックは除外
                    if (e.target.tagName === 'IFRAME') return;
                    // すでに他の要素でハンドリングされている場合は除外
                    if (e.defaultPrevented) return;

                    e.preventDefault();
                    this.startWindowDrag(windowElement, e);
                });
            }
        }
    }

    /**
     * ウィンドウの直接リサイズを開始
     * @param {HTMLElement} windowElement - リサイズするウィンドウ要素
     * @param {string} direction - リサイズ方向（'nw', 'ne', 'sw', 'se', 'n', 's', 'w', 'e'）
     * @param {MouseEvent} e - マウスイベント
     */
    startDirectResize(windowElement, direction, e) {
        // 簡単なアプローチ：直接ここでマウスイベントを処理
        const startX = e.clientX;
        const startY = e.clientY;
        const startRect = windowElement.getBoundingClientRect();
        const startWidth = startRect.width;
        const startHeight = startRect.height;
        const startLeft = startRect.left;
        const startTop = startRect.top;

        console.log('Direct resize - start values:', { startX, startY, startWidth, startHeight, startLeft, startTop });

        const handleMouseMove = (moveEvent) => {
            // console.log('Direct mousemove detected');
            const deltaX = moveEvent.clientX - startX;
            const deltaY = moveEvent.clientY - startY;

            let newWidth = startWidth;
            let newHeight = startHeight;
            let newLeft = startLeft;
            let newTop = startTop;

            if (direction.includes('e')) {
                newWidth = startWidth + deltaX;
            }
            if (direction.includes('w')) {
                newWidth = startWidth - deltaX;
                newLeft = startLeft + deltaX;
            }
            if (direction.includes('s')) {
                newHeight = startHeight + deltaY;
            }
            if (direction.includes('n')) {
                newHeight = startHeight - deltaY;
                newTop = startTop + deltaY;
            }

            // 最小サイズ制限
            newWidth = Math.max(200, newWidth);
            newHeight = Math.max(150, newHeight);

            windowElement.style.width = newWidth + 'px';
            windowElement.style.height = newHeight + 'px';
            windowElement.style.left = newLeft + 'px';
            windowElement.style.top = newTop + 'px';

            // リサイズ中にスクロールバーを更新
            const iframe = windowElement.querySelector('iframe');
            if (iframe) {
                const content = windowElement.querySelector('.window-content');
                const vScrollbar = windowElement.querySelector('.custom-scrollbar-vertical');
                const hScrollbar = windowElement.querySelector('.custom-scrollbar-horizontal');

                if (content && vScrollbar) {
                    this.forceUpdateScrollbarForPlugin(iframe, content, vScrollbar, 'vertical');
                }
                if (content && hScrollbar) {
                    this.forceUpdateScrollbarForPlugin(iframe, content, hScrollbar, 'horizontal');
                }
            }

            // console.log('Direct resize applied:', { newWidth, newHeight, newLeft, newTop });
        };

        const handleMouseUp = () => {
            console.log('Direct mouseup detected');
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            document.body.style.userSelect = '';

            // ウィンドウサイズ変更後、iframe内のキャンバスサイズ更新を通知
            const iframe = windowElement.querySelector('iframe');
            if (iframe && iframe.contentWindow) {
                iframe.contentWindow.postMessage({
                    type: 'window-resized'
                }, '*');
            }

            // プラグインのスクロールバーを更新
            if (iframe) {
                const content = windowElement.querySelector('.window-content');
                const vScrollbar = windowElement.querySelector('.custom-scrollbar-vertical');
                const hScrollbar = windowElement.querySelector('.custom-scrollbar-horizontal');

                if (content && vScrollbar) {
                    this.forceUpdateScrollbarForPlugin(iframe, content, vScrollbar, 'vertical');
                }
                if (content && hScrollbar) {
                    this.forceUpdateScrollbarForPlugin(iframe, content, hScrollbar, 'horizontal');
                }
            }
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        document.body.style.userSelect = 'none';

        // 旧方式も試す
        this.startWindowResize(windowElement, direction, e);
    }

    /**
     * ウィンドウのドラッグを開始
     * @param {HTMLElement} windowElement - ドラッグするウィンドウ要素
     * @param {MouseEvent} e - マウスイベント
     */
    startWindowDrag(windowElement, e) {
        // 既存のイベントリスナーをクリア
        if (this._boundHandleWindowResize) {
            document.removeEventListener('mousemove', this._boundHandleWindowResize);
        }
        if (this._boundEndWindowResize) {
            document.removeEventListener('mouseup', this._boundEndWindowResize);
        }
        if (this._boundHandleWindowDrag) {
            document.removeEventListener('mousemove', this._boundHandleWindowDrag);
        }
        if (this._boundEndWindowDrag) {
            document.removeEventListener('mouseup', this._boundEndWindowDrag);
        }

        this.isDragging = true;
        this.isResizing = false; // リサイズ状態をリセット
        this.dragState = {
            element: windowElement,
            startX: e.clientX - windowElement.offsetLeft,
            startY: e.clientY - windowElement.offsetTop,
            currentX: null,
            currentY: null,
            rafId: null,
            lastUpdateTime: 0
        };

        // bind関数の参照を保存
        this._boundHandleWindowDrag = this.handleWindowDrag.bind(this);
        this._boundEndWindowDrag = this.endWindowDrag.bind(this);

        document.addEventListener('mousemove', this._boundHandleWindowDrag);
        document.addEventListener('mouseup', this._boundEndWindowDrag);

        document.body.style.userSelect = 'none';

        // ドラッグ中はすべてのiframeへのポインタイベントを無効化
        // これにより、カーソルがiframe上を通過してもmouseイベントが親documentで捕捉される
        const allIframes = document.querySelectorAll('iframe');
        allIframes.forEach(iframe => {
            iframe.style.pointerEvents = 'none';
        });
        console.log('[WindowDrag] ドラッグ開始: iframeのポインタイベントを無効化');
    }

    /**
     * ウィンドウのドラッグ処理
     * @param {MouseEvent} e - マウスイベント
     */
    handleWindowDrag(e) {
        if (!this.isDragging || !this.dragState) return;

        // 現在のマウス位置を保存
        this.dragState.currentX = e.clientX - this.dragState.startX;
        this.dragState.currentY = e.clientY - this.dragState.startY;

        // requestAnimationFrameで次のフレームに更新を予約
        if (!this.dragState.rafId) {
            this.dragState.rafId = requestAnimationFrame((timestamp) => {
                if (this.dragState && this.dragState.currentX !== null && this.dragState.currentY !== null) {
                    // 100ms以上経過した場合のみ更新（10FPS）
                    if (timestamp - this.dragState.lastUpdateTime >= 100) {
                        this.dragState.element.style.left = this.dragState.currentX + 'px';
                        this.dragState.element.style.top = this.dragState.currentY + 'px';
                        this.dragState.lastUpdateTime = timestamp;
                    }
                    this.dragState.rafId = null;
                }
            });
        }
    }

    /**
     * ウィンドウのドラッグを終了
     */
    endWindowDrag() {
        // 未完了のrequestAnimationFrameをキャンセル
        if (this.dragState && this.dragState.rafId) {
            cancelAnimationFrame(this.dragState.rafId);
        }

        // ウィンドウ移動終了をプラグインに通知
        if (this.dragState && this.dragState.element) {
            const windowElement = this.dragState.element;
            const rect = windowElement.getBoundingClientRect();

            const iframe = windowElement.querySelector('iframe');
            if (iframe && iframe.contentWindow) {
                iframe.contentWindow.postMessage({
                    type: 'window-moved',
                    pos: {
                        x: Math.round(rect.left),
                        y: Math.round(rect.top)
                    },
                    width: Math.round(rect.width),
                    height: Math.round(rect.height)
                }, '*');
                console.log('[WindowDrag] ウィンドウ移動終了を通知:', { x: rect.left, y: rect.top });
            }
        }

        this.isDragging = false;
        this.dragState = null;

        // 保存された関数参照を使用してイベントリスナーを削除
        if (this._boundHandleWindowDrag) {
            document.removeEventListener('mousemove', this._boundHandleWindowDrag);
            this._boundHandleWindowDrag = null;
        }
        if (this._boundEndWindowDrag) {
            document.removeEventListener('mouseup', this._boundEndWindowDrag);
            this._boundEndWindowDrag = null;
        }

        document.body.style.userSelect = '';

        // すべてのiframeのポインタイベントを再有効化
        const allIframes = document.querySelectorAll('iframe');
        allIframes.forEach(iframe => {
            iframe.style.pointerEvents = '';
        });
        console.log('[WindowDrag] ドラッグ終了: iframeのポインタイベントを再有効化');
    }

    /**
     * 道具パネルのドラッグを開始
     * @param {HTMLElement} toolPanelWindow - 道具パネルウィンドウ要素
     * @param {number} iframeClientX - iframe内のマウスX座標
     * @param {number} iframeClientY - iframe内のマウスY座標
     */
    startToolPanelDrag(toolPanelWindow, iframeClientX, iframeClientY) {
        // 既存のイベントリスナーをクリア
        if (this._boundHandleToolPanelDrag) {
            document.removeEventListener('mousemove', this._boundHandleToolPanelDrag);
        }
        if (this._boundEndToolPanelDrag) {
            document.removeEventListener('mouseup', this._boundEndToolPanelDrag);
        }

        // iframe要素の位置を取得
        const iframe = toolPanelWindow.querySelector('iframe');
        const iframeRect = iframe.getBoundingClientRect();

        // iframe内の座標をページ座標に変換
        const pageX = iframeRect.left + iframeClientX;
        const pageY = iframeRect.top + iframeClientY;

        this.isToolPanelDragging = true;
        this.toolPanelDragState = {
            element: toolPanelWindow,
            startX: pageX - toolPanelWindow.offsetLeft,
            startY: pageY - toolPanelWindow.offsetTop,
            currentX: null,
            currentY: null,
            rafId: null,
            lastUpdateTime: 0
        };

        // bind関数の参照を保存
        this._boundHandleToolPanelDrag = this.handleToolPanelDrag.bind(this);
        this._boundEndToolPanelDrag = this.endToolPanelDrag.bind(this);

        document.addEventListener('mousemove', this._boundHandleToolPanelDrag);
        document.addEventListener('mouseup', this._boundEndToolPanelDrag);

        document.body.style.userSelect = 'none';

        // ドラッグ中はすべてのiframeへのポインタイベントを無効化
        const allIframes = document.querySelectorAll('iframe');
        allIframes.forEach(iframe => {
            iframe.style.pointerEvents = 'none';
        });
        console.log('[ToolPanelDrag] ドラッグ開始: iframeのポインタイベントを無効化');
    }

    /**
     * 道具パネルのドラッグ処理
     * @param {MouseEvent} e - マウスイベント
     */
    handleToolPanelDrag(e) {
        if (!this.isToolPanelDragging || !this.toolPanelDragState) return;

        // 現在のマウス位置を保存
        this.toolPanelDragState.currentX = e.clientX - this.toolPanelDragState.startX;
        this.toolPanelDragState.currentY = e.clientY - this.toolPanelDragState.startY;

        // requestAnimationFrameで次のフレームに更新を予約
        if (!this.toolPanelDragState.rafId) {
            this.toolPanelDragState.rafId = requestAnimationFrame((timestamp) => {
                if (this.toolPanelDragState && this.toolPanelDragState.currentX !== null && this.toolPanelDragState.currentY !== null) {
                    // 100ms以上経過した場合のみ更新（10FPS）
                    if (timestamp - this.toolPanelDragState.lastUpdateTime >= 100) {
                        this.toolPanelDragState.element.style.left = this.toolPanelDragState.currentX + 'px';
                        this.toolPanelDragState.element.style.top = this.toolPanelDragState.currentY + 'px';
                        this.toolPanelDragState.lastUpdateTime = timestamp;
                    }
                    this.toolPanelDragState.rafId = null;
                }
            });
        }
    }

    /**
     * 道具パネルのドラッグを終了
     */
    endToolPanelDrag() {
        // 未完了のrequestAnimationFrameをキャンセル
        if (this.toolPanelDragState && this.toolPanelDragState.rafId) {
            cancelAnimationFrame(this.toolPanelDragState.rafId);
        }

        this.isToolPanelDragging = false;
        this.toolPanelDragState = null;

        // 保存された関数参照を使用してイベントリスナーを削除
        if (this._boundHandleToolPanelDrag) {
            document.removeEventListener('mousemove', this._boundHandleToolPanelDrag);
            this._boundHandleToolPanelDrag = null;
        }
        if (this._boundEndToolPanelDrag) {
            document.removeEventListener('mouseup', this._boundEndToolPanelDrag);
            this._boundEndToolPanelDrag = null;
        }

        document.body.style.userSelect = '';

        // すべてのiframeのポインタイベントを再有効化
        const allIframes = document.querySelectorAll('iframe');
        allIframes.forEach(iframe => {
            iframe.style.pointerEvents = '';
        });
        console.log('[ToolPanelDrag] ドラッグ終了: iframeのポインタイベントを再有効化');
    }

    /**
     * ウィンドウのリサイズを開始
     * @param {HTMLElement} windowElement - リサイズするウィンドウ要素
     * @param {string} direction - リサイズ方向
     * @param {MouseEvent} e - マウスイベント
     */
    startWindowResize(windowElement, direction, e) {
        console.log('Starting window resize, direction:', direction, 'element:', windowElement.id);

        // 既存のイベントリスナーをクリア
        if (this._boundHandleWindowResize) {
            document.removeEventListener('mousemove', this._boundHandleWindowResize);
        }
        if (this._boundEndWindowResize) {
            document.removeEventListener('mouseup', this._boundEndWindowResize);
        }
        if (this._boundHandleWindowDrag) {
            document.removeEventListener('mousemove', this._boundHandleWindowDrag);
        }
        if (this._boundEndWindowDrag) {
            document.removeEventListener('mouseup', this._boundEndWindowDrag);
        }

        this.isResizing = true;
        this.isDragging = false; // ドラッグ状態をリセット
        const rect = windowElement.getBoundingClientRect();

        console.log('Initial rect:', {
            width: rect.width,
            height: rect.height,
            left: rect.left,
            top: rect.top
        });

        this.dragState = {
            element: windowElement,
            direction: direction,
            startX: e.clientX,
            startY: e.clientY,
            startWidth: rect.width,
            startHeight: rect.height,
            startLeft: rect.left,
            startTop: rect.top
        };

        // bind関数の参照を保存
        this._boundHandleWindowResize = this.handleWindowResize.bind(this);
        this._boundEndWindowResize = this.endWindowResize.bind(this);

        document.addEventListener('mousemove', this._boundHandleWindowResize, true);
        document.addEventListener('mouseup', this._boundEndWindowResize, true);

        // テスト用：直接mousemoveイベントをテスト
        const testMouseMove = (e) => {
            this.handleWindowResize(e);
        };
        document.addEventListener('mousemove', testMouseMove);

        document.body.style.userSelect = 'none';

        // リサイズ中はすべてのiframeへのポインタイベントを無効化
        const allIframes = document.querySelectorAll('iframe');
        allIframes.forEach(iframe => {
            iframe.style.pointerEvents = 'none';
        });
        console.log('Resize event listeners added with capture=true, iframe pointer events disabled');
    }

    /**
     * ウィンドウのリサイズ処理
     * @param {MouseEvent} e - マウスイベント
     */
    handleWindowResize(e) {
        if (!this.isResizing || !this.dragState) {
            return;
        }

        const { element, direction, startX, startY, startWidth, startHeight, startLeft, startTop } = this.dragState;
        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;
        
        let newWidth = startWidth;
        let newHeight = startHeight;
        let newLeft = startLeft;
        let newTop = startTop;

        console.log(`Resizing ${direction}: deltaX=${deltaX}, deltaY=${deltaY}, current: ${startWidth}x${startHeight}`);

        if (direction && direction.includes('e')) {
            newWidth = startWidth + deltaX;
            console.log('East resize: newWidth =', newWidth);
        }
        if (direction && direction.includes('w')) {
            newWidth = startWidth - deltaX;
            newLeft = startLeft + deltaX;
            console.log('West resize: newWidth =', newWidth, 'newLeft =', newLeft);
        }
        if (direction && direction.includes('s')) {
            newHeight = startHeight + deltaY;
            console.log('South resize: newHeight =', newHeight);
        }
        if (direction && direction.includes('n')) {
            newHeight = startHeight - deltaY;
            newTop = startTop + deltaY;
            console.log('North resize: newHeight =', newHeight, 'newTop =', newTop);
        }

        // 最小サイズ制限
        newWidth = Math.max(200, newWidth);
        newHeight = Math.max(150, newHeight);

        // WとNの方向でサイズが最小値に達した場合の位置調整
        if (newWidth === 200 && direction && direction.includes('w')) {
            newLeft = startLeft + startWidth - 200;
        }
        if (newHeight === 150 && direction && direction.includes('n')) {
            newTop = startTop + startHeight - 150;
        }

        console.log('Setting element style:', {
            width: newWidth + 'px',
            height: newHeight + 'px',
            left: newLeft + 'px',
            top: newTop + 'px'
        });

        element.style.width = newWidth + 'px';
        element.style.height = newHeight + 'px';
        element.style.left = newLeft + 'px';
        element.style.top = newTop + 'px';

        console.log(`Applied new size: ${newWidth}x${newHeight}, position: ${newLeft},${newTop}`);
    }

    /**
     * ウィンドウのリサイズを終了
     */
    endWindowResize() {
        // ウィンドウリサイズ終了をプラグインに通知
        if (this.dragState && this.dragState.element) {
            const windowElement = this.dragState.element;
            const rect = windowElement.getBoundingClientRect();

            const iframe = windowElement.querySelector('iframe');
            if (iframe && iframe.contentWindow) {
                iframe.contentWindow.postMessage({
                    type: 'window-resized-end',
                    pos: {
                        x: Math.round(rect.left),
                        y: Math.round(rect.top)
                    },
                    width: Math.round(rect.width),
                    height: Math.round(rect.height)
                }, '*');
                console.log('[WindowResize] ウィンドウリサイズ終了を通知:', { width: rect.width, height: rect.height });
            }
        }

        this.isResizing = false;
        this.dragState = null;

        // 保存された関数参照を使用してイベントリスナーを削除
        if (this._boundHandleWindowResize) {
            document.removeEventListener('mousemove', this._boundHandleWindowResize);
            this._boundHandleWindowResize = null;
        }
        if (this._boundEndWindowResize) {
            document.removeEventListener('mouseup', this._boundEndWindowResize);
            this._boundEndWindowResize = null;
        }

        document.body.style.userSelect = '';

        // すべてのiframeのポインタイベントを再有効化
        const allIframes = document.querySelectorAll('iframe');
        allIframes.forEach(iframe => {
            iframe.style.pointerEvents = '';
        });
        console.log('[WindowResize] リサイズ終了: iframeのポインタイベントを再有効化');
    }

    /**
     * 指定したウィンドウをアクティブにする
     * @param {string} windowId - アクティブにするウィンドウのID
     */
    setActiveWindow(windowId) {
        // 全ウインドウを非アクティブに
        document.querySelectorAll('.window').forEach(win => {
            win.classList.remove('front-window');
            win.classList.add('inactive');
        });

        if (windowId && this.windows.has(windowId)) {
            const window = this.windows.get(windowId);
            window.element.classList.add('front-window');
            window.element.classList.remove('inactive');
            this.activeWindow = windowId;

            // 最前面に移動（ただし、alwaysOnTopウィンドウは除外して計算）
            const maxZ = Math.max(...Array.from(document.querySelectorAll('.window:not(.always-on-top)')).map(w =>
                parseInt(getComputedStyle(w).zIndex) || 0));

            // alwaysOnTopウィンドウの場合は、z-indexを変更しない
            if (!window.element.classList.contains('always-on-top')) {
                window.element.style.zIndex = maxZ + 1;
            }

            // ウィンドウ内のiframeにフォーカスを設定
            const iframe = window.element.querySelector('iframe');
            if (iframe) {
                try {
                    iframe.focus();
                    console.log('[TADjs] iframeにフォーカスを設定しました:', windowId);
                } catch (error) {
                    console.warn('[TADjs] iframeへのフォーカス設定に失敗:', error);
                }
            } else {
                // iframeがない場合はウィンドウ要素自体にフォーカス
                try {
                    window.element.focus();
                    console.log('[TADjs] ウィンドウ要素にフォーカスを設定しました:', windowId);
                } catch (error) {
                    console.warn('[TADjs] ウィンドウへのフォーカス設定に失敗:', error);
                }
            }
        } else {
            this.activeWindow = null;
        }
    }

    /**
     * ウィンドウのアイコンを設定
     * @param {string} windowId - ウィンドウID
     * @param {string} iconPath - アイコンファイルのパス
     */
    async setWindowIcon(windowId, iconPath) {
        const window = this.windows.get(windowId);
        if (!window) {
            console.warn('[TADjs] ウィンドウが見つかりません:', windowId);
            return;
        }

        const windowIcon = window.element.querySelector('.window-icon');
        if (!windowIcon) {
            console.warn('[TADjs] ウィンドウアイコン要素が見つかりません:', windowId);
            return;
        }

        // デバッグ: 設定前の状態を確認
        console.log('[TADjs] アイコン設定前のクラス:', windowIcon.className);
        console.log('[TADjs] アイコン設定前のスタイル:', windowIcon.style.cssText);

        // アイコンファイルを読み込む
        const iconData = await this.loadIconFileAsBase64(iconPath);
        if (iconData) {
            // CSSの擬似要素を無効化するクラスを追加
            windowIcon.classList.add('custom-icon');

            // デバッグ: クラス追加後の状態を確認
            console.log('[TADjs] custom-iconクラス追加後:', windowIcon.className);

            // アイコンを設定
            windowIcon.style.backgroundImage = `url('data:image/x-icon;base64,${iconData}')`;
            windowIcon.style.backgroundSize = 'contain';
            windowIcon.style.backgroundRepeat = 'no-repeat';
            windowIcon.style.backgroundPosition = 'center';
            windowIcon.style.backgroundColor = 'transparent';

            // デバッグ: 設定後の状態を確認
            console.log('[TADjs] スタイル設定後:', windowIcon.style.cssText);

            // デバッグ: 計算済みスタイルを確認
            // Note: window.getComputedStyle はこのコンテキストで利用できないためコメントアウト
            // const computedStyle = window.getComputedStyle(windowIcon);
            // console.log('[TADjs] 計算済みスタイル:', {
            //     backgroundImage: computedStyle.backgroundImage,
            //     backgroundColor: computedStyle.backgroundColor,
            //     backgroundSize: computedStyle.backgroundSize,
            //     backgroundPosition: computedStyle.backgroundPosition,
            //     backgroundRepeat: computedStyle.backgroundRepeat,
            //     display: computedStyle.display,
            //     width: computedStyle.width,
            //     height: computedStyle.height
            // });

            // デバッグ: 擬似要素のスタイルも確認
            // const beforeStyle = window.getComputedStyle(windowIcon, '::before');
            // const afterStyle = window.getComputedStyle(windowIcon, '::after');
            // console.log('[TADjs] ::before display:', beforeStyle.display);
            // console.log('[TADjs] ::after display:', afterStyle.display);

            console.log('[TADjs] ウィンドウアイコン設定完了:', windowId, iconPath);
        } else {
            console.warn('[TADjs] アイコンファイルが読み込めませんでした:', iconPath);
        }
    }

    /**
     * アイコンファイルをbase64エンコードして読み込む
     * @param {string} iconPath - アイコンファイルのパス
     * @returns {Promise<string|null>} base64エンコードされたアイコンデータ
     */
    async loadIconFileAsBase64(iconPath) {
        // Electron環境の場合
        if (this.isElectronEnv) {
            const basePath = this.getDataBasePath();
            const filePath = this.path.join(basePath, iconPath);

            try {
                if (!this.fs.existsSync(filePath)) {
                    console.warn('[TADjs] アイコンファイルが見つかりません:', filePath);
                    return null;
                }

                const buffer = this.fs.readFileSync(filePath);
                const base64Data = buffer.toString('base64');
                console.log('[TADjs] アイコンファイル読み込み成功:', filePath);
                return base64Data;
            } catch (error) {
                console.error('[TADjs] アイコンファイル読み込みエラー:', error);
                return null;
            }
        }

        // ブラウザ環境の場合
        try {
            const url = `/${iconPath}`;
            const response = await fetch(url);

            if (response.ok) {
                const arrayBuffer = await response.arrayBuffer();
                const base64Data = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
                return base64Data;
            } else {
                console.warn('[TADjs] アイコンファイル取得失敗:', response.status, response.statusText);
                return null;
            }
        } catch (error) {
            console.error('[TADjs] アイコンファイルfetchエラー:', error);
            return null;
        }
    }

    /**
     * ウィンドウを閉じる
     * @param {string} windowId - 閉じるウィンドウのID
     */
    async closeWindow(windowId) {
        if (!this.windows.has(windowId)) return;

        const window = this.windows.get(windowId);

        // closable設定を確認
        let closable = true;
        if (window.options && window.options.closable !== undefined) {
            closable = window.options.closable;
        } else if (window.fileData && window.fileData.windowConfig && window.fileData.windowConfig.closable !== undefined) {
            closable = window.fileData.windowConfig.closable;
        }

        if (!closable) {
            console.log('[TADjsDesktop] closable=falseのためウィンドウを閉じることができません');
            return;
        }

        // プラグインがある場合、クローズ確認を要求
        const iframe = window.element.querySelector('iframe');
        if (iframe && iframe.contentWindow) {
            const allowClose = await this.requestCloseConfirmation(windowId, iframe);
            if (!allowClose) {
                console.log('[TADjsDesktop] プラグインによりクローズがキャンセルされました');
                return;
            }
        }

        window.element.classList.add('closing');

        // 道具パネルウィンドウが存在する場合は閉じる
        if (this.toolPanelRelations) {
            console.log('[TADjs] 閉じるウィンドウID:', windowId);
            console.log('[TADjs] toolPanelRelations:', this.toolPanelRelations);

            // このウィンドウに関連する道具パネルを探す
            for (const [toolPanelWindowId, relation] of Object.entries(this.toolPanelRelations)) {
                console.log('[TADjs] チェック中 toolPanelWindowId:', toolPanelWindowId);
                console.log('[TADjs] relation.editorIframe:', relation.editorIframe);

                if (relation.editorIframe) {
                    const parentWindow = relation.editorIframe.closest('.window');
                    console.log('[TADjs] parentWindow:', parentWindow, 'id:', parentWindow?.id);

                    if (parentWindow?.id === windowId) {
                        // 親ウィンドウが閉じられるので、道具パネルも閉じる
                        console.log('[TADjs] 道具パネルウィンドウを閉じる:', toolPanelWindowId);
                        const toolPanelWindow = document.getElementById(toolPanelWindowId);
                        if (toolPanelWindow) {
                            toolPanelWindow.remove();
                            this.windows.delete(toolPanelWindowId);
                        }
                        delete this.toolPanelRelations[toolPanelWindowId];
                    }
                }
            }
        }

        // canvasIdがある場合は再利用可能リストに追加
        if (window.canvasId) {
            const match = window.canvasId.match(/canvas-(\d+)/);
            if (match) {
                const canvasNumber = parseInt(match[1]);
                this.availableCanvasIds.push(canvasNumber);
            }
        }

        // ウィンドウが閉じたことをすべてのプラグインに通知
        this.broadcastWindowClosed(windowId, window);

        // openedRealObjectsから削除（windowIdから実身IDを逆引き）
        for (const [realId, openedWindowId] of this.openedRealObjects.entries()) {
            if (openedWindowId === windowId) {
                this.openedRealObjects.delete(realId);
                console.log('[TADjs] 閉じたウィンドウを記録から削除:', realId, windowId);
                break;
            }
        }

        setTimeout(() => {
            window.element.remove();
            this.windows.delete(windowId);

            if (this.activeWindow === windowId) {
                this.activeWindow = null;
            }
        }, 150);
    }

    /**
     * プラグインにクローズ確認を要求
     * @param {string} windowId - ウィンドウID
     * @param {HTMLIFrameElement} iframe - プラグインのiframe
     * @returns {Promise<boolean>} クローズを許可するか
     */
    async requestCloseConfirmation(windowId, iframe) {
        // プラグインのメタデータを確認
        const windowInfo = this.windows.get(windowId);
        const pluginId = windowInfo?.pluginId;

        if (!pluginId) {
            // プラグインIDが不明な場合は即座にクローズ許可
            return true;
        }

        // プラグインマネージャーからプラグイン情報を取得
        const plugin = window.pluginManager?.getPlugin(pluginId);

        if (!plugin || !plugin.needsCloseConfirmation) {
            // プラグインがクローズ確認を必要としない場合は即座に許可
            console.log('[TADjsDesktop] プラグインはクローズ確認不要:', pluginId);
            return true;
        }

        // クローズ確認が必要なプラグインの場合
        console.log('[TADjsDesktop] プラグインにクローズ確認を要求:', pluginId);

        return new Promise((resolve) => {
            // コールバックを登録（タイムアウトなし - ユーザーが必ず応答するまで待つ）
            this.closeConfirmCallbacks[windowId] = (allowClose) => {
                console.log('[TADjsDesktop] プラグインからクローズ応答:', allowClose);
                resolve(allowClose);
            };

            // プラグインにクローズ要求を送信
            iframe.contentWindow.postMessage({
                type: 'window-close-request',
                windowId: windowId
            }, '*');
        });
    }

    /**
     * ウィンドウが閉じたことをすべてのプラグインに通知
     */
    broadcastWindowClosed(windowId, windowInfo) {
        // すべてのウィンドウのiframeに通知
        this.windows.forEach((win) => {
            const iframe = win.element.querySelector('iframe');
            if (iframe && iframe.contentWindow) {
                try {
                    iframe.contentWindow.postMessage({
                        type: 'window-closed',
                        windowId: windowId,
                        fileData: windowInfo.fileData
                    }, '*');
                } catch (error) {
                    console.warn('[TADjs] ウィンドウクローズ通知エラー:', error);
                }
            }
        });
    }

    /**
     * ウィンドウの最大化/復元を切り替え
     * @param {string} windowId - 操作するウィンドウのID
     */
    toggleMaximizeWindow(windowId) {
        if (!this.windows.has(windowId)) return;

        const windowInfo = this.windows.get(windowId);
        const windowElement = windowInfo.element;
        const desktop = document.getElementById('desktop');
        const desktopRect = desktop.getBoundingClientRect();

        // maximizable設定を確認（options.maximizable優先、次にfileData.windowConfig.maximizable）
        let maximizable = true;
        if (windowInfo.options && windowInfo.options.maximizable !== undefined) {
            maximizable = windowInfo.options.maximizable;
        } else if (windowInfo.fileData && windowInfo.fileData.windowConfig) {
            maximizable = windowInfo.fileData.windowConfig.maximizable;
        }

        if (maximizable === false && !windowInfo.isMaximized) {
            // maximizable=falseの場合は最大化不可
            console.log('[TADjsDesktop] maximizable=falseのため全画面化をスキップ');
            return;
        }

        if (windowInfo.isMaximized) {
            // 通常サイズに復元（アニメーションあり）
            windowElement.classList.remove('maximized');

            // CSSトランジション開始のため、次のフレームで実際のサイズ変更を適用
            requestAnimationFrame(() => {
                windowElement.style.left = windowInfo.normalRect.x + 'px';
                windowElement.style.top = windowInfo.normalRect.y + 'px';
                windowElement.style.width = windowInfo.normalRect.width + 'px';
                windowElement.style.height = windowInfo.normalRect.height + 'px';
            });

            windowInfo.isMaximized = false;

            // プラグインに全画面解除を通知
            const iframe = windowElement.querySelector('iframe');
            if (iframe && iframe.contentWindow) {
                iframe.contentWindow.postMessage({
                    type: 'window-maximize-toggled',
                    maximize: false,
                    pos: {
                        x: windowInfo.normalRect.x,
                        y: windowInfo.normalRect.y
                    },
                    width: windowInfo.normalRect.width,
                    height: windowInfo.normalRect.height
                }, '*');
            }

            console.debug(`Window ${windowId} restored to normal size`);

            // CSSアニメーション完了を待つ
            const handleTransitionEnd = (e) => {
                // width または height のトランジションが完了したとき
                if (e.propertyName === 'width' || e.propertyName === 'height') {
                    windowElement.removeEventListener('transitionend', handleTransitionEnd);

                    // アニメーション完了後にプラグインに通知
                    if (iframe && iframe.contentWindow) {
                        iframe.contentWindow.postMessage({
                            type: 'window-maximize-completed',
                            maximize: false,
                            width: windowInfo.normalRect.width,
                            height: windowInfo.normalRect.height
                        }, '*');
                    }
                }
            };
            windowElement.addEventListener('transitionend', handleTransitionEnd);
        } else {
            // 現在の位置とサイズを保存
            const currentRect = windowElement.getBoundingClientRect();
            windowInfo.normalRect = {
                x: parseInt(windowElement.style.left),
                y: parseInt(windowElement.style.top),
                width: parseInt(windowElement.style.width),
                height: parseInt(windowElement.style.height)
            };

            // デスクトップ領域全体に最大化
            // desktopRect.heightは既にCSSでbottom:20pxが適用されているため、
            // ステータスバーの高さは既に考慮されている
            windowElement.style.left = '0px';
            windowElement.style.top = '0px';
            windowElement.style.width = desktopRect.width + 'px';
            windowElement.style.height = desktopRect.height + 'px';
            windowElement.classList.add('maximized');
            windowInfo.isMaximized = true;

            // プラグインに全画面化を通知
            const iframe = windowElement.querySelector('iframe');
            if (iframe && iframe.contentWindow) {
                iframe.contentWindow.postMessage({
                    type: 'window-maximize-toggled',
                    maximize: true,
                    pos: {
                        x: 0,
                        y: 0
                    },
                    width: desktopRect.width,
                    height: desktopRect.height
                }, '*');
            }

            console.debug(`Window ${windowId} maximized to desktop size`);

            // CSSアニメーション完了を待つ
            const handleTransitionEnd = (e) => {
                // width または height のトランジションが完了したとき
                if (e.propertyName === 'width' || e.propertyName === 'height') {
                    windowElement.removeEventListener('transitionend', handleTransitionEnd);

                    // アニメーション完了後にプラグインに通知
                    if (iframe && iframe.contentWindow) {
                        iframe.contentWindow.postMessage({
                            type: 'window-maximize-completed',
                            maximize: true,
                            width: desktopRect.width,
                            height: desktopRect.height
                        }, '*');
                    }
                }
            };
            windowElement.addEventListener('transitionend', handleTransitionEnd);
        }

        // カスタムスクロールバーの更新（CSSアニメーション完了後に実行）
        // アニメーションは0.2sなので、余裕を持って250ms後に実行
        setTimeout(() => {
            const iframe = windowElement.querySelector('iframe');
            const content = windowElement.querySelector('.window-content') || windowElement.querySelector('.tad-content');

            if (iframe && content) {
                // プラグインウィンドウの場合
                const vScrollbar = windowElement.querySelector('.custom-scrollbar-vertical');
                const hScrollbar = windowElement.querySelector('.custom-scrollbar-horizontal');

                if (vScrollbar) {
                    this.forceUpdateScrollbarForPlugin(iframe, content, vScrollbar, 'vertical');
                }
                if (hScrollbar) {
                    this.forceUpdateScrollbarForPlugin(iframe, content, hScrollbar, 'horizontal');
                }
            } else if (content) {
                // TADウィンドウなど通常のウィンドウの場合
                const scrollbars = windowElement.querySelectorAll('.custom-scrollbar');
                scrollbars.forEach(scrollbar => {
                    const direction = scrollbar.classList.contains('vertical') ? 'vertical' : 'horizontal';
                    this.forceUpdateScrollbar(content, scrollbar, direction);
                });
            }
        }, 250);
    }

    /**
     * 書庫解凍の確認メッセージダイアログを表示
     * @param {Window} targetPluginWindow - ターゲットプラグインのウィンドウ
     * @param {Object} dragData - ドラッグされたデータ
     * @param {Object} dropPosition - ドロップ位置 {x, y}
     */

    /**
     * 指定したプラグインにメッセージを転送
     * @param {string} pluginId - ターゲットプラグインID
     * @param {Object} message - 転送するメッセージ
     */
    async forwardMessageToPlugin(pluginId, message) {
        console.log('[TADjs] プラグインにメッセージ転送:', pluginId, message.type);

        try {
            // 全てのプラグインウィンドウを探索
            const pluginWindows = document.querySelectorAll('.window iframe');
            let targetPluginWindow = null;

            console.log('[TADjs] 検索中のプラグインID:', pluginId);
            console.log('[TADjs] 存在するウィンドウ数:', pluginWindows.length);

            for (const iframe of pluginWindows) {
                // iframe要素自体のdata-plugin-id属性をチェック
                const currentPluginId = iframe.dataset.pluginId;
                console.log('[TADjs] 発見したプラグインID:', currentPluginId);
                if (currentPluginId === pluginId) {
                    targetPluginWindow = iframe.contentWindow;
                    console.log('[TADjs] ターゲットプラグイン発見:', pluginId);
                    break;
                }
            }

            if (!targetPluginWindow) {
                console.error('[TADjs] プラグインウィンドウが見つかりません:', pluginId);
                console.error('[TADjs] 利用可能なプラグインID一覧:');
                pluginWindows.forEach(iframe => {
                    console.error('  -', iframe.dataset.pluginId);
                });
                return;
            }

            // プラグインにメッセージを送信
            console.log('[TADjs] メッセージ送信:', pluginId, message);
            targetPluginWindow.postMessage(message, '*');

        } catch (error) {
            console.error('[TADjs] メッセージ転送エラー:', error);
        }
    }

    /**
     * 指定したウィンドウID内の特定のプラグインにメッセージを転送
     * @param {string} windowId - ターゲットウィンドウID
     * @param {string} pluginId - ターゲットプラグインID
     * @param {Object} message - 転送するメッセージ
     */
    async forwardMessageToPluginInWindow(windowId, pluginId, message) {
        console.log('[TADjs] ウィンドウ内プラグインにメッセージ転送:', windowId, pluginId, message.type);

        try {
            // ウィンドウIDに対応するウィンドウ要素を探す
            const windowElement = document.querySelector(`.window[data-window-id="${windowId}"]`);

            if (!windowElement) {
                console.error('[TADjs] ウィンドウが見つかりません:', windowId);
                return;
            }

            // そのウィンドウ内の指定されたプラグインIDのiframeを探す
            const iframe = windowElement.querySelector(`iframe[data-plugin-id="${pluginId}"]`);

            if (!iframe || !iframe.contentWindow) {
                console.error('[TADjs] 指定されたプラグインが見つかりません:', windowId, pluginId);
                return;
            }

            // プラグインにメッセージを送信
            console.log('[TADjs] メッセージ送信:', windowId, pluginId, message);
            iframe.contentWindow.postMessage(message, '*');

        } catch (error) {
            console.error('[TADjs] メッセージ転送エラー:', error);
        }
    }

    /**
     * 指定したウィンドウIDのプラグインにメッセージを転送
     * @param {string} windowId - ターゲットウィンドウID
     * @param {Object} message - 転送するメッセージ
     */
    async forwardMessageToWindow(windowId, message) {
        console.log('[TADjs] ウィンドウIDにメッセージ転送:', windowId, message.type);

        try {
            // ウィンドウIDに対応するiframeを探す
            const windowElement = document.querySelector(`.window[data-window-id="${windowId}"]`);

            if (!windowElement) {
                console.error('[TADjs] ウィンドウが見つかりません:', windowId);
                return;
            }

            const iframe = windowElement.querySelector('iframe[data-plugin-id]');

            if (!iframe || !iframe.contentWindow) {
                console.error('[TADjs] iframeが見つかりません:', windowId);
                return;
            }

            // プラグインにメッセージを送信
            console.log('[TADjs] メッセージ送信:', windowId, message);
            iframe.contentWindow.postMessage(message, '*');

        } catch (error) {
            console.error('[TADjs] メッセージ転送エラー:', error);
        }
    }

    /**
     * 指定したプラグインタイプの全ウィンドウにメッセージをブロードキャスト
     * @param {string} pluginId - ターゲットプラグインID
     * @param {Object} message - 転送するメッセージ
     */
    async broadcastMessageToPluginType(pluginId, message) {
        console.log('[TADjs] プラグインタイプにブロードキャスト:', pluginId, message.type);

        try {
            // 全てのプラグインウィンドウを探索
            const pluginWindows = document.querySelectorAll('.window iframe');
            let sentCount = 0;

            for (const iframe of pluginWindows) {
                // iframe要素自体のdata-plugin-id属性をチェック
                const currentPluginId = iframe.dataset.pluginId;
                if (currentPluginId === pluginId) {
                    const targetPluginWindow = iframe.contentWindow;
                    if (targetPluginWindow) {
                        console.log('[TADjs] メッセージ送信:', pluginId, message);
                        targetPluginWindow.postMessage(message, '*');
                        sentCount++;
                    }
                }
            }

            console.log('[TADjs] ブロードキャスト完了:', sentCount, '個のウィンドウに送信');

        } catch (error) {
            console.error('[TADjs] ブロードキャストエラー:', error);
        }
    }

    /**
     * unpack-fileから受信した実身ファイルセットを処理
     * @param {Array} files - 生成されたファイル情報の配列
     */
    async handleArchiveFilesGenerated(files, images = []) {
        console.log('[TADjs] 実身ファイルセット受信処理開始:', files.length, '個のファイルエントリ、', images.length, '個の画像');

        try {
            // fileIdごとにJSONは1度だけ保存
            const savedJsons = new Set();

            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const recordNo = file.recordNo !== undefined ? file.recordNo : 0;

                console.log(`[TADjs] ファイルエントリ ${i + 1}/${files.length}: ${file.name} (${file.fileId}, レコード: ${recordNo})`);

                // JSONデータをBlobに変換してfileObjectsに保存（実身ごとに1度だけ）
                if (!savedJsons.has(file.fileId)) {
                    const jsonBlob = new Blob([JSON.stringify(file.jsonData, null, 2)], { type: 'application/json' });
                    const jsonFile = new File([jsonBlob], `${file.fileId}.json`, { type: 'application/json' });
                    this.fileObjects[`${file.fileId}.json`] = jsonFile;
                    savedJsons.add(file.fileId);
                    console.log(`[TADjs] JSONファイル保存（メモリ）: ${file.fileId}.json (実身名: ${file.name})`);

                    // Electron環境の場合、ディスクにも保存
                    try {
                        await this.saveDataFile(`${file.fileId}.json`, JSON.stringify(file.jsonData, null, 2));
                        console.log(`[TADjs] JSONファイル保存（ディスク）成功: ${file.fileId}.json (実身名: ${file.name})`);
                    } catch (error) {
                        console.error(`[TADjs] JSONファイルディスク保存エラー: ${file.fileId}.json (実身名: ${file.name})`, error);
                    }

                    // applistをチェックして、対応するプラグインの原紙icoファイルをコピー
                    await this.copyPluginIconForRealObject(file.fileId, file.jsonData);
                } else {
                    console.log(`[TADjs] JSONファイルスキップ（既存）: ${file.fileId}.json (実身名: ${file.name})`);
                }

                // XTADデータをBlobに変換してfileObjectsに保存（レコードごと）
                if (file.xtadData) {
                    const xtadBlob = new Blob([file.xtadData], { type: 'application/xml' });
                    const xtadFileName = `${file.fileId}_${recordNo}.xtad`;
                    const xtadFile = new File([xtadBlob], xtadFileName, { type: 'application/xml' });
                    this.fileObjects[xtadFileName] = xtadFile;
                    console.log(`[TADjs] XTADファイル保存（メモリ）: ${xtadFileName} (${file.xtadData.length} bytes)`);

                    // Electron環境の場合、ディスクにも保存
                    try {
                        await this.saveDataFile(xtadFileName, file.xtadData);
                        console.log(`[TADjs] XTADファイル保存（ディスク）: ${xtadFileName}`);
                    } catch (error) {
                        console.error(`[TADjs] XTADファイルディスク保存エラー: ${xtadFileName}`, error);
                    }
                } else {
                    console.warn(`[TADjs] XTADデータがありません: ${file.name} レコード ${recordNo}`);
                }
            }

            // 画像ファイルを保存
            for (let i = 0; i < images.length; i++) {
                const image = images[i];
                const imgFileName = `${image.fileId}_${image.recordNo}_${image.imgNo}.png`;

                if (image.blob) {
                    const imgFile = new File([image.blob], imgFileName, { type: 'image/png' });
                    this.fileObjects[imgFileName] = imgFile;
                    console.log(`[TADjs] 画像ファイル保存（メモリ）: ${imgFileName} (${image.width}x${image.height})`);

                    // Electron環境の場合、ディスクにも保存
                    try {
                        const arrayBuffer = await image.blob.arrayBuffer();
                        const uint8Array = new Uint8Array(arrayBuffer);
                        await this.saveDataFile(imgFileName, uint8Array);
                        console.log(`[TADjs] 画像ファイル保存（ディスク）: ${imgFileName}`);
                    } catch (error) {
                        console.error(`[TADjs] 画像ファイルディスク保存エラー: ${imgFileName}`, error);
                    }
                } else {
                    console.warn(`[TADjs] 画像データがありません: ${imgFileName}`);
                }
            }

            console.log('[TADjs] 実身ファイルセット処理完了（XTAD:', files.length, '個、画像:', images.length, '個）');

        } catch (error) {
            console.error('[TADjs] 実身ファイルセット処理エラー:', error);
        }
    }

    /**
     * 実身のapplistに基づいて、対応するプラグインの原紙icoファイルをコピー
     * @param {string} fileId - 実身のファイルID
     * @param {Object} jsonData - 実身のメタデータ
     */
    async copyPluginIconForRealObject(fileId, jsonData) {
        try {
            // applistをチェック
            if (!jsonData.applist) {
                console.log(`[TADjs] applistがありません: ${fileId}`);
                return;
            }

            // defaultOpen: trueのプラグインを探す
            let defaultPluginId = null;
            for (const [pluginId, pluginInfo] of Object.entries(jsonData.applist)) {
                if (pluginInfo.defaultOpen === true) {
                    defaultPluginId = pluginId;
                    break;
                }
            }

            if (!defaultPluginId) {
                console.log(`[TADjs] defaultOpenなプラグインがありません: ${fileId}`);
                return;
            }

            console.log(`[TADjs] defaultOpenプラグイン: ${defaultPluginId} for ${fileId}`);

            // プラグイン情報を取得
            if (!window.pluginManager) {
                console.warn(`[TADjs] pluginManagerが見つかりません`);
                return;
            }

            const plugin = window.pluginManager.getPlugin(defaultPluginId);
            if (!plugin) {
                console.warn(`[TADjs] プラグインが見つかりません: ${defaultPluginId}`);
                return;
            }

            // basefileのicoファイルパスを取得
            if (!plugin.basefile || !plugin.basefile.ico) {
                console.log(`[TADjs] プラグインに原紙icoファイルがありません: ${defaultPluginId}`);
                return;
            }

            const baseIcoFileName = plugin.basefile.ico;
            const sourceIcoPath = `${plugin.path}/${baseIcoFileName}`;
            console.log(`[TADjs] 原紙icoファイルパス: ${sourceIcoPath}`);

            // Electron環境でicoファイルをコピー
            if (this.isElectronEnv && this.fs && this.path) {
                try {
                    const basePath = this.getDataBasePath();
                    const destIcoPath = this.path.join(basePath, `${fileId}.ico`);

                    // 原紙icoファイルが存在するか確認
                    if (this.fs.existsSync(sourceIcoPath)) {
                        // icoファイルをコピー
                        this.fs.copyFileSync(sourceIcoPath, destIcoPath);
                        console.log(`[TADjs] icoファイルコピー成功: ${sourceIcoPath} -> ${destIcoPath}`);
                    } else {
                        console.warn(`[TADjs] 原紙icoファイルが見つかりません: ${sourceIcoPath}`);
                    }
                } catch (error) {
                    console.error(`[TADjs] icoファイルコピーエラー: ${fileId}`, error);
                }
            }

        } catch (error) {
            console.error(`[TADjs] copyPluginIconForRealObjectエラー: ${fileId}`, error);
        }
    }

    async showContextMenu(x, y, target) {
        // コンテキストに応じてメニューを生成
        console.log('[TADjs] showContextMenu呼び出し, target:', target);
        const menuItems = await this.generateContextMenuItems(target);
        console.log('[TADjs] 生成されたメニュー項目:', menuItems);
        this.createContextMenu(menuItems, x, y);
    }

    /**
     * 仮身一覧プラグインから呼び出される：選択された仮身の実身を指定されたプラグインで開く
     * @param {Object} virtualObj - 仮身オブジェクト（link_idは実身のファイルID）
     * @param {string} pluginId - 起動するプラグインID
     */
    async openVirtualObjectReal(virtualObj, pluginId, messageId, source) {
        console.log('[TADjs] 仮身の実身を開く:', virtualObj.link_id, 'with', pluginId);

        try {
            // link_idから実身ID（UUID）を抽出
            // 形式: "実身ID_recordNo.xtad" または "実身ID" または "実身ID.json"
            const fullRealId = virtualObj.link_id; // _0.xtad付きのフルID
            let realId = fullRealId;

            // .xtad, .json などの拡張子を除去
            realId = realId.replace(/\.(xtad|json)$/, '');

            // _recordNo の部分を除去（例: _0, _1, _10 など）
            realId = realId.replace(/_\d+$/, '');

            console.log('[TADjs] 実身ID抽出:', realId, 'フルID:', fullRealId);

            // 既に開いているウィンドウがあればアクティブにして処理を終了
            if (this.openedRealObjects.has(realId)) {
                const existingWindowId = this.openedRealObjects.get(realId);
                console.log('[TADjs] 実身は既に開いています:', realId, 'ウィンドウID:', existingWindowId);
                // ウィンドウをアクティブにする
                this.setActiveWindow(existingWindowId);
                // 呼び出し元に通知
                if (messageId && source) {
                    source.postMessage({
                        type: 'window-opened',
                        messageId: messageId,
                        success: true,
                        windowId: existingWindowId,
                        alreadyOpened: true
                    }, '*');
                }
                return;
            }

            // BPK/bpkファイルの場合は、JSONファイル不要でそのまま開く
            if (virtualObj.link_id.match(/\.(bpk|BPK)$/i)) {
                const fileName = virtualObj.link_id;
                console.log('[TADjs] BPKファイル:', fileName);

                // fileObjectsからファイルを取得
                let file = this.fileObjects[fileName];

                // fileObjectsに無い場合はloadDataFileAsFileで読み込む
                if (!file) {
                    console.log('[TADjs] BPKファイルを読み込みます:', fileName);
                    file = await this.loadDataFileAsFile(fileName);
                    if (file) {
                        this.fileObjects[fileName] = file;
                    } else {
                        throw new Error(`ファイルが見つかりません: ${fileName}`);
                    }
                }

                // BPKファイルをバイト配列に変換
                const arrayBuffer = await file.arrayBuffer();
                const uint8Array = new Uint8Array(arrayBuffer);

                // プラグインに渡すデータを準備
                const fileData = {
                    realId: fullRealId,  // _0.xtad付きのフルID
                    fileName: fileName,
                    fileData: file,
                    rawData: Array.from(uint8Array),
                    displayName: virtualObj.link_name || fileName,
                    isBPK: true  // BPKファイルであることを示すフラグ
                };

                // プラグインを起動
                let windowId = null;
                if (window.pluginManager) {
                    windowId = await window.pluginManager.launchPlugin(pluginId, fileData);
                    console.log('[TADjs] BPKファイルをプラグインで開きました:', pluginId, 'windowId:', windowId);
                    // 開いたウィンドウを記録
                    if (windowId) {
                        this.openedRealObjects.set(realId, windowId);
                    }
                } else {
                    console.error('[TADjs] プラグインマネージャーが見つかりません');
                }

                // 呼び出し元に通知
                if (messageId && source) {
                    source.postMessage({
                        type: 'window-opened',
                        messageId: messageId,
                        success: !!windowId,
                        windowId: windowId
                    }, '*');
                }
                return;
            }

            // tadjs-viewプラグインの場合は、ファイルをそのまま開く
            if (pluginId === 'tadjs-view') {
                // link_idがそのままファイル名
                const fileName = virtualObj.link_id;

                // fileObjectsからファイルを取得
                let file = this.fileObjects[fileName];

                // fileObjectsに無い場合はloadDataFileAsFileで読み込む
                if (!file) {
                    console.log('[TADjs] ファイルを読み込みます:', fileName);
                    file = await this.loadDataFileAsFile(fileName);
                    if (file) {
                        this.fileObjects[fileName] = file;
                    } else {
                        throw new Error(`ファイルが見つかりません: ${fileName}`);
                    }
                }

                // ファイルをバイト配列に変換
                const arrayBuffer = await file.arrayBuffer();
                const uint8Array = new Uint8Array(arrayBuffer);

                // tadjs-viewプラグインで開く
                const fileData = {
                    file: { name: fileName },
                    fileName: fileName,
                    rawData: Array.from(uint8Array),  // ← rawDataを追加！
                    displayName: virtualObj.link_name || fileName
                };

                const windowId = await window.pluginManager.launchPlugin(pluginId, fileData);
                console.log('[TADjs] tadjs-viewプラグインで実身を開きました:', fileName, 'windowId:', windowId);

                // 開いたウィンドウを記録
                if (windowId) {
                    this.openedRealObjects.set(realId, windowId);

                    // ウィンドウのアイコンを設定（DOMが準備されるまで少し待つ）
                    const iconPath = `${realId}.ico`;
                    setTimeout(() => {
                        this.setWindowIcon(windowId, iconPath);
                    }, 200);
                }

                // ウィンドウをアクティブにする
                if (windowId) {
                    console.log('[TADjs] ウィンドウをアクティブにします:', windowId);
                    // DOMが完全に更新されるまで少し待つ
                    setTimeout(() => {
                        this.setActiveWindow(windowId);
                        console.log('[TADjs] setActiveWindow呼び出し完了:', windowId);
                    }, 100);
                } else {
                    console.warn('[TADjs] windowIdがnullのためアクティブ化できません');
                }

                // 呼び出し元に通知
                if (messageId && source) {
                    source.postMessage({
                        type: 'window-opened',
                        messageId: messageId,
                        success: !!windowId,
                        windowId: windowId
                    }, '*');
                }
                return;
            }

            // 実身ID.jsonを読み込む
            const jsonFileName = `${realId}.json`;
            let jsonFile = this.fileObjects[jsonFileName];

            if (!jsonFile) {
                console.log('[TADjs] JSONファイルを読み込みます:', jsonFileName);
                jsonFile = await this.loadDataFileAsFile(jsonFileName);
                if (jsonFile) {
                    this.fileObjects[jsonFileName] = jsonFile;
                } else {
                    throw new Error(`JSONファイルが見つかりません: ${jsonFileName}`);
                }
            }

            // JSONをパース
            const jsonText = await jsonFile.text();
            const jsonData = JSON.parse(jsonText);
            console.log('[TADjs] JSON読み込み完了:', jsonData.name);

            // accessDateを更新
            jsonData.accessDate = new Date().toISOString();
            const accessDateSaved = await this.saveDataFile(jsonFileName, JSON.stringify(jsonData, null, 2));
            if (accessDateSaved) {
                console.log('[TADjs] accessDate更新完了:', realId);
                // JSONファイルのキャッシュをクリア
                delete this.fileObjects[jsonFileName];
            } else {
                console.warn('[TADjs] accessDate更新失敗:', jsonFileName);
            }

            // デフォルトレコード（0番）のXTADファイルを読み込む
            const xtadFileName = `${realId}_0.xtad`;
            let xtadFile = this.fileObjects[xtadFileName];

            if (!xtadFile) {
                console.log('[TADjs] XTADファイルを読み込みます:', xtadFileName);
                xtadFile = await this.loadDataFileAsFile(xtadFileName);
                if (xtadFile) {
                    this.fileObjects[xtadFileName] = xtadFile;
                } else {
                    throw new Error(`XTADファイルが見つかりません: ${xtadFileName}`);
                }
            }

            // XTADファイルをUint8Arrayに変換
            const arrayBuffer = await xtadFile.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);

            // XTADファイルをXMLとして読み込む（既にXML形式）
            let xmlData = '';
            if (pluginId !== 'unpack-file') {
                try {
                    xmlData = await xtadFile.text();
                    console.log(`[TADjs] XTAD読み込み完了: ${xmlData.length}文字`);
                } catch (error) {
                    console.error('[TADjs] XTAD読み込みエラー:', error);
                    console.warn('[TADjs] XMLデータが空のままプラグインを起動します');
                }
            } else if (pluginId === 'unpack-file') {
                console.log('[TADjs] unpack-fileプラグインのため、XML読み込みをスキップ');
            }

            // プラグインに渡すデータを準備
            const fileData = {
                realId: fullRealId,          // _0.xtad付きのフルID
                fileName: xtadFileName,       // XTADファイル名
                fileData: xtadFile,          // XTADファイルオブジェクト
                rawData: Array.from(uint8Array), // XTADのバイトデータ
                xmlData: xmlData,            // XML文字列
                jsonData: jsonData,          // 実身管理用セグメント（JSON）
                windowConfig: jsonData.window || null, // ウィンドウ設定
                displayName: jsonData.name || virtualObj.link_name || realId
            };

            // プラグインを起動
            let windowId = null;
            if (window.pluginManager) {
                windowId = await window.pluginManager.launchPlugin(pluginId, fileData);
                console.log('[TADjs] プラグインで実身を開きました:', pluginId, 'windowId:', windowId);

                // 開いたウィンドウを記録
                if (windowId) {
                    this.openedRealObjects.set(realId, windowId);

                    // ウィンドウのアイコンを設定（DOMが準備されるまで少し待つ）
                    const iconPath = `${realId}.ico`;
                    setTimeout(() => {
                        this.setWindowIcon(windowId, iconPath);
                    }, 200);
                }

                // ウィンドウをアクティブにする
                if (windowId) {
                    console.log('[TADjs] ウィンドウをアクティブにします:', windowId);
                    // DOMが完全に更新されるまで少し待つ
                    setTimeout(() => {
                        this.setActiveWindow(windowId);
                        console.log('[TADjs] setActiveWindow呼び出し完了:', windowId);
                    }, 100);
                } else {
                    console.warn('[TADjs] windowIdがnullのためアクティブ化できません');
                }
            } else {
                console.error('[TADjs] プラグインマネージャーが見つかりません');
            }

            // 呼び出し元に通知
            if (messageId && source) {
                source.postMessage({
                    type: 'window-opened',
                    messageId: messageId,
                    success: !!windowId,
                    windowId: windowId
                }, '*');
            }
        } catch (error) {
            console.error('[TADjs] 実身を開くエラー:', error);
            // エラー時も通知
            if (messageId && source) {
                source.postMessage({
                    type: 'window-opened',
                    messageId: messageId,
                    success: false,
                    error: error.message
                }, '*');
            }
        }
    }

    /**
     * ウィンドウの共通メニュー項目を生成
     * プラグインにも継承されるメニュー項目
     */
    generateCommonWindowMenuItems(windowId) {
        return [
            { text: '閉じる', action: 'close', shortcut: 'Ctrl+E', data: { windowId } }
        ];
    }

    async generateContextMenuItems(target) {
        const items = [];

        if (target.closest('.window')) {
            const windowElement = target.closest('.window');
            const windowId = windowElement.id;
            const windowInfo = this.windows.get(windowId);
            
            // TADウィンドウかどうかを判定
            if (windowInfo && windowInfo.canvasId) {
                const canvasId = windowInfo.canvasId;
                const paperModeEnabled = windowElement.dataset.paperMode === 'true';
                const displayMode = windowElement.dataset.displayMode || '3';
                const wrapAtWindowWidth = windowElement.dataset.wrapAtWindowWidth !== 'false';

                // 共通メニュー項目を追加
                items.push(...this.generateCommonWindowMenuItems(windowId));
                items.push({ separator: true });

                // TADウィンドウ固有のメニュー
                items.push(
                    { text: displayMode === '0' ? '✓ 1: 原稿モード' : '1: 原稿モード', action: 'set-display-mode', data: { windowId, canvasId, mode: '0' } },
                    { text: displayMode === '2' ? '✓ 2: 詳細モード' : '2: 詳細モード', action: 'set-display-mode', data: { windowId, canvasId, mode: '2' } },
                    { text: displayMode === '3' ? '✓ 3: 清書モード' : '3: 清書モード', action: 'set-display-mode', data: { windowId, canvasId, mode: '3' } },
                    { text: wrapAtWindowWidth ? '✓ ウインドウ幅で折り返し' : 'ウインドウ幅で折り返し', action: 'toggle-wrap-at-window-width', data: { windowId, canvasId } },
                    { separator: true },
                    { text: paperModeEnabled ? '✓ 用紙モード' : '用紙モード', action: 'toggle-paper-mode', data: { windowId, canvasId } },
                    { separator: true },
                    { text: 'プロパティ', action: 'window-properties' }
                );
            } else {
                // プラグインウィンドウかどうかを確認
                const iframe = windowElement.querySelector('iframe[data-plugin-id]');
                if (iframe && iframe.contentWindow) {
                    // 共通メニュー項目を追加
                    items.push(...this.generateCommonWindowMenuItems(windowId));

                    // プラグインからメニュー定義を取得
                    try {
                        const pluginMenuItems = await this.getPluginMenuDefinition(iframe, windowId);
                        if (pluginMenuItems.length > 0) {
                            items.push({ separator: true });
                            items.push(...pluginMenuItems);
                        }
                    } catch (error) {
                        console.error('[TADjs] プラグインメニュー取得エラー:', error);
                        // フォールバック: 基本メニューのみ
                    }

                    // 「小物」タイプのプラグインをサブメニューとして追加
                    if (window.pluginManager) {
                        const accessoryPlugins = window.pluginManager.getAccessoryPlugins();
                        if (accessoryPlugins.length > 0) {
                            const accessorySubmenu = accessoryPlugins.map(plugin => ({
                                text: plugin.name,
                                action: 'launch-accessory',
                                data: { pluginId: plugin.id }
                            }));

                            items.push({ separator: true });
                            items.push({
                                text: '小物',
                                submenu: accessorySubmenu
                            });
                        }
                    }
                } else {
                    // 通常ウィンドウのメニュー（初期ウィンドウなど）
                    // 選択中のファイルがあるかチェック
                    const selectedFileIcon = windowElement.querySelector('.file-icon.selected');
                    const fileName = selectedFileIcon ? selectedFileIcon.dataset.fileName : null;

                    items.push(
                        { text: '閉じる', action: 'close', shortcut: 'Ctrl+E' },
                        { text: '最小化', action: 'minimize' }
                    );

                    // 「小物」タイプのプラグインをサブメニューとして追加
                    if (window.pluginManager) {
                        const accessoryPlugins = window.pluginManager.getAccessoryPlugins();
                        if (accessoryPlugins.length > 0) {
                            const accessorySubmenu = accessoryPlugins.map(plugin => ({
                                text: plugin.name,
                                action: 'launch-accessory',
                                data: { pluginId: plugin.id }
                            }));

                            items.push(
                                { separator: true },
                                {
                                    text: '小物',
                                    submenu: accessorySubmenu
                                }
                            );
                        }
                    }

                    // ファイルが選択されている場合、「実行」メニューを追加
                    if (window.pluginManager && fileName) {
                        const pluginMenus = window.pluginManager.getContextMenuForFile(fileName);
                        if (pluginMenus.length > 0) {
                            const executeSubmenu = pluginMenus.map(menu => ({
                                text: menu.label,
                                action: 'plugin-action',
                                data: { pluginId: menu.pluginId, fileName: fileName }
                            }));

                            items.push(
                                { separator: true },
                                {
                                    text: '実行',
                                    submenu: executeSubmenu
                                }
                            );
                        }
                    }
                }
            }
        } else {
            // デスクトップのメニュー
            items.push(
                { text: 'ファイルを開く...', action: 'open-file' },
                { separator: true },
                { text: 'ウインドウ一覧', action: 'window-list' },
                { text: 'デスクトップをクリア', action: 'clear-desktop' },
                { separator: true }
            );

            // 「小物」タイプのプラグインをサブメニューとして追加
            if (window.pluginManager) {
                const accessoryPlugins = window.pluginManager.getAccessoryPlugins();
                console.log('[TADjs] 小物プラグイン取得:', accessoryPlugins.length, '個');
                if (accessoryPlugins.length > 0) {
                    const accessorySubmenu = accessoryPlugins.map(plugin => ({
                        text: plugin.name,
                        action: 'launch-accessory',
                        data: { pluginId: plugin.id }
                    }));

                    items.push({
                        text: '小物',
                        submenu: accessorySubmenu
                    });

                    items.push({ separator: true });
                } else {
                    console.warn('[TADjs] 小物プラグインが見つかりません');
                }
            } else {
                console.warn('[TADjs] プラグインマネージャーが見つかりません');
            }

            items.push(
                { text: 'システム情報', action: 'system-info' }
            );
        }
        
        return items;
    }

    /**
     * コンテキストメニューを作成・表示
     * @param {Array<Object>} items - メニュー項目の配列
     * @param {number} x - メニューのX座標
     * @param {number} y - メニューのY座標
     */
    createContextMenu(items, x, y) {
        console.log('[TADjs] createContextMenu呼び出し, items:', items, 'x:', x, 'y:', y);
        // 既存のメニューを削除
        this.hideContextMenu();

        const menu = document.createElement('div');
        menu.className = 'context-menu';
        menu.id = 'dynamic-context-menu';

        this.renderMenuItems(menu, items);

        // 画面端での位置調整
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';
        menu.style.display = 'block';

        document.body.appendChild(menu);

        // 画面からはみ出る場合の調整
        const rect = menu.getBoundingClientRect();
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;

        if (rect.right > windowWidth) {
            menu.style.left = (x - rect.width) + 'px';
        }
        if (rect.bottom > windowHeight) {
            menu.style.top = (y - rect.height) + 'px';
        }
    }

    /**
     * メニュー項目をレンダリング
     * @param {HTMLElement} container - メニュー項目を追加するコンテナ要素
     * @param {Array<Object>} items - メニュー項目の配列
     */
    renderMenuItems(container, items) {
        items.forEach(item => {
            if (item.separator) {
                const separator = document.createElement('div');
                separator.className = 'menu-separator';
                container.appendChild(separator);
            } else if (item.submenu) {
                // サブメニューがある場合
                const menuItem = document.createElement('div');
                menuItem.className = 'menu-item has-submenu';

                const textSpan = document.createElement('span');
                textSpan.className = 'menu-text';
                textSpan.textContent = item.text;
                menuItem.appendChild(textSpan);

                const arrow = document.createElement('span');
                arrow.className = 'menu-arrow';
                arrow.textContent = '▶';
                menuItem.appendChild(arrow);

                // サブメニューコンテナ
                const submenu = document.createElement('div');
                submenu.className = 'context-submenu';
                this.renderMenuItems(submenu, item.submenu);
                menuItem.appendChild(submenu);

                // マウスオーバー時にサブメニューの位置を調整
                menuItem.addEventListener('mouseenter', () => {
                    this.adjustSubmenuPosition(submenu);
                });

                container.appendChild(menuItem);
            } else {
                const menuItem = document.createElement('div');
                menuItem.className = 'menu-item';
                menuItem.dataset.action = item.action;

                if (item.shortcut) {
                    menuItem.innerHTML = `
                        <span class="menu-text">${item.text}</span>
                        <span class="menu-shortcut">${item.shortcut}</span>
                    `;
                } else {
                    menuItem.textContent = item.text;
                }

                menuItem.onclick = () => {
                    this.handleMenuAction(item.action, item.data);
                    this.hideContextMenu();
                };

                container.appendChild(menuItem);
            }
        });
    }

    /**
     * サブメニューの位置を画面内に収まるように調整
     * @param {HTMLElement} submenu - 調整するサブメニュー要素
     */
    adjustSubmenuPosition(submenu) {
        // サブメニューを一時的に表示して位置を測定
        submenu.style.display = 'block';

        const rect = submenu.getBoundingClientRect();
        const windowHeight = window.innerHeight;
        const windowWidth = window.innerWidth;

        // 右側にはみ出る場合は左側に表示
        if (rect.right > windowWidth) {
            submenu.style.left = 'auto';
            submenu.style.right = '100%';
        } else {
            submenu.style.left = '100%';
            submenu.style.right = 'auto';
        }

        // 下側にはみ出る場合は上に調整
        if (rect.bottom > windowHeight) {
            const overflow = rect.bottom - windowHeight;
            const currentTop = parseInt(submenu.style.top || '-2') || -2;
            submenu.style.top = (currentTop - overflow - 10) + 'px';
        }

        // 上側にはみ出る場合は下に調整
        if (rect.top < 0) {
            const overflow = -rect.top;
            const currentTop = parseInt(submenu.style.top || '-2') || -2;
            submenu.style.top = (currentTop + overflow + 10) + 'px';
        }

        // 表示状態をCSSのホバーに任せる（一時的な表示を解除）
        submenu.style.display = '';
    }

    /**
     * コンテキストメニューを非表示にする
     */
    hideContextMenu() {
        console.log('[TADjs] hideContextMenu呼び出し');
        const staticMenu = document.getElementById('context-menu');
        const dynamicMenu = document.getElementById('dynamic-context-menu');

        if (staticMenu) {
            console.log('[TADjs] 静的メニューを非表示');
            staticMenu.style.display = 'none';
        }
        if (dynamicMenu) {
            console.log('[TADjs] 動的メニューを削除');
            dynamicMenu.remove();
        }
    }

    /**
     * キーボードショートカットを処理
     * @param {KeyboardEvent} e - キーボードイベント
     */
    handleKeyboardShortcuts(e) {
        const selectedIcon = document.querySelector('.file-icon.selected');

        // Ctrl+W: アクティブウインドウを閉じる
        if (e.ctrlKey && e.key === 'w') {
            e.preventDefault();
            if (this.activeWindow) {
                this.closeWindow(this.activeWindow);
            }
        }
        
        // Enter: 選択されたファイルを開く
        if (e.key === 'Enter' && selectedIcon) {
            e.preventDefault();
            const filename = selectedIcon.dataset.filename;
            this.handleMenuAction('open');
        }
        
        // Alt+Enter: プロパティ表示
        if (e.altKey && e.key === 'Enter' && selectedIcon) {
            e.preventDefault();
            this.handleMenuAction('properties');
        }
        
        // Escape: メニューを閉じる
        if (e.key === 'Escape') {
            this.hideContextMenu();
        }
    }

    /**
     * メニューアクションを処理
     * @param {string} action - 実行するアクション名
     * @param {*} data - アクションに渡すデータ
     */
    handleMenuAction(action, data) {
        const selectedIcon = document.querySelector('.file-icon.selected');

        switch (action) {
            case 'open':
                if (selectedIcon) {
                    const filename = selectedIcon.dataset.filename;
                    // ファイルオブジェクトを再取得（保存されている場合）
                    if (this.fileObjects && this.fileObjects[filename]) {
                        this.openTADFile(this.fileObjects[filename]);
                    } else {
                        this.setStatusMessage(`エラー: ${filename} のデータが見つかりません`);
                    }
                }
                break;
                
            case 'open-vobj':
                if (data) {
                    this.openVirtualObject(data);
                }
                break;
                
            case 'vobj-properties':
                if (data) {
                    this.showVirtualObjectProperties(data);
                }
                break;
                
            case 'properties':
                if (selectedIcon) {
                    const filename = selectedIcon.dataset.filename;
                    this.showFileProperties(filename);
                }
                break;
                
            case 'close':
                if (data && data.windowId) {
                    this.closeWindow(data.windowId);
                } else if (this.activeWindow) {
                    this.closeWindow(this.activeWindow);
                }
                break;

            case 'minimize':
                if (data && data.windowId) {
                    // 将来的に実装
                    this.setStatusMessage('最小化機能は未実装です');
                } else {
                    this.setStatusMessage('最小化機能は未実装です');
                }
                break;
                
            case 'toggle-paper-mode':
                if (data && data.windowId && data.canvasId) {
                    this.togglePaperMode(data.windowId, data.canvasId);
                }
                break;
                
            case 'set-display-mode':
                if (data && data.windowId && data.canvasId && data.mode) {
                    this.setDisplayMode(data.windowId, data.canvasId, data.mode);
                }
                break;
                
            case 'toggle-wrap-at-window-width':
                if (data && data.windowId && data.canvasId) {
                    this.toggleWrapAtWindowWidth(data.windowId, data.canvasId);
                }
                break;
                
            case 'open-file':
                this.showFileOpenDialog();
                break;
                
            case 'window-list':
                this.showWindowList();
                break;
                
            case 'clear-desktop':
                this.clearDesktop();
                break;

            case 'launch-accessory':
                if (data && data.pluginId && window.pluginManager) {
                    window.pluginManager.launchPlugin(data.pluginId);
                }
                break;
                
            case 'system-info':
                this.showSystemInfo();
                break;
                
            case 'window-properties':
                if (this.activeWindow) {
                    this.showWindowProperties(this.activeWindow);
                }
                break;

            case 'plugin-action':
                if (data && data.pluginId && data.fileName) {
                    this.launchPluginForFile(data.pluginId, data.fileName);
                }
                break;

            // プラグインアクション（基本文章編集）
            default:
                if (action.startsWith('plugin-')) {
                    this.handlePluginAction(action, data);
                }
                break;
        }
    }

    /**
     * プラグインアクションを処理
     * @param {string} action - 実行するアクション名
     * @param {Object} data - アクションに渡すデータ
     */
    handlePluginAction(action, data) {
        if (!data || !data.windowId) return;

        const windowElement = document.getElementById(data.windowId);
        if (!windowElement) return;

        const iframe = windowElement.querySelector('iframe[data-plugin-id]');
        if (!iframe || !iframe.contentWindow) return;

        // アクション名から "plugin-" プレフィックスを除去
        const pluginAction = action.replace('plugin-', '');

        // iframeにメッセージを送信
        iframe.contentWindow.postMessage({
            type: 'menu-action',
            action: pluginAction
        }, '*');

        console.log('[TADjs] プラグインアクション送信:', pluginAction);
    }

    /**
     * プラグインからメニュー定義を取得
     * @param {HTMLIFrameElement} iframe - プラグインのiframe要素
     * @param {string} windowId - ウィンドウID
     * @returns {Promise<Array>} メニュー項目の配列
     */
    getPluginMenuDefinition(iframe, windowId) {
        return new Promise((resolve, reject) => {
            const messageId = `menu-request-${Date.now()}`;
            console.log('[TADjs] プラグインメニュー定義を要求:', messageId);
            const timeout = setTimeout(() => {
                console.error('[TADjs] プラグインメニュー取得タイムアウト:', messageId);
                window.removeEventListener('message', handler);
                reject(new Error('プラグインメニュー取得タイムアウト'));
            }, 1000);

            const handler = (event) => {
                if (event.data && event.data.type === 'menu-definition-response' && event.data.messageId === messageId) {
                    console.log('[TADjs] menu-definition-response受信:', event.data);
                    clearTimeout(timeout);
                    window.removeEventListener('message', handler);

                    // プラグインのメニュー定義をパースして、windowIdをdataに追加
                    const menuItems = this.parsePluginMenuDefinition(event.data.menuDefinition, windowId);
                    console.log('[TADjs] パース後のメニュー項目:', menuItems);
                    resolve(menuItems);
                }
            };

            window.addEventListener('message', handler);

            // プラグインにメニュー定義を要求
            iframe.contentWindow.postMessage({
                type: 'get-menu-definition',
                messageId: messageId
            }, '*');
        });
    }

    /**
     * プラグインのメニュー定義をパースして、actionにplugin-プレフィックスとwindowIdを追加
     */
    parsePluginMenuDefinition(menuDef, windowId) {
        if (!Array.isArray(menuDef)) return [];

        return menuDef.map(item => {
            if (item.separator) {
                return { separator: true };
            }

            const parsed = {
                text: item.label || item.text
            };

            if (item.shortcut) {
                parsed.shortcut = item.shortcut;
            }

            if (item.submenu) {
                parsed.submenu = this.parsePluginMenuDefinition(item.submenu, windowId);
            } else if (item.action) {
                // actionにplugin-プレフィックスを追加
                parsed.action = `plugin-${item.action}`;
                parsed.data = { windowId };
            }

            return parsed;
        });
    }

    /**
     * プラグインコンテンツのサイズを更新
     * @param {Window} iframeWindow - プラグインのiframeウィンドウオブジェクト
     * @param {number} height - 新しい高さ（ピクセル）
     * @param {number} [width] - 新しい幅（ピクセル、省略可）
     */
    updatePluginContentSize(iframeWindow, height, width) {
        // iframeWindowから対応するiframe要素を見つける
        const iframes = document.querySelectorAll('iframe[data-plugin-id]');
        for (const iframe of iframes) {
            if (iframe.contentWindow === iframeWindow) {
                // windowElementを取得
                const windowElement = iframe.closest('.window');

                // scrollable設定を確認（data-scrollable属性から取得）
                const isScrollable = windowElement && windowElement.dataset.scrollable === 'true';

                if (isScrollable) {
                    // スクロール可能な場合はiframeの高さを設定しない（100%のまま）
                } else {
                    // スクロール不可の場合のみiframeの高さを更新
                    iframe.style.height = height + 'px';

                    // 幅が指定されている場合は幅も更新、指定されていない場合は100%に戻す
                    if (width !== undefined) {
                        iframe.style.width = width + 'px';
                    } else {
                        iframe.style.width = '100%';
                    }

                    console.log('[TADjs] プラグインコンテンツサイズ更新:', { height, width });
                }
                break;
            }
        }
    }

    /**
     * プラグインを起動してファイルを開く
     */
    async launchPluginForFile(pluginId, fileName) {
        if (!window.pluginManager) {
            this.setStatusMessage('プラグインマネージャーが初期化されていません');
            return;
        }

        const selectedIcon = document.querySelector('.file-icon.selected');
        if (!selectedIcon) {
            this.setStatusMessage('ファイルが選択されていません');
            return;
        }

        // ファイルデータを取得
        const fileData = this.fileObjects[fileName];
        if (!fileData) {
            this.setStatusMessage(`エラー: ${fileName} のデータが見つかりません`);
            return;
        }

        try {
            this.setStatusMessage(`XML変換中: ${fileName}...`);

            // FileオブジェクトをUint8Arrayに変換
            const arrayBuffer = await fileData.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);

            // TADファイルをXMLに変換
            let xmlData = '';
            console.log('parseTADToXML関数チェック:', typeof parseTADToXML);
            if (typeof parseTADToXML === 'function') {
                console.log('parseTADToXML呼び出し開始, データサイズ:', uint8Array.length);
                try {
                    xmlData = await parseTADToXML(uint8Array, 0);
                    console.log(`XML変換完了: ${xmlData.length}文字`);
                } catch (error) {
                    console.error('parseTADToXML実行エラー:', error);
                }
            } else {
                console.warn('parseTADToXML関数が見つかりません');
            }

            // プラグインに渡すデータを準備
            const pluginData = {
                fileName: fileName,
                fileData: fileData,
                rawData: Array.from(uint8Array),
                xmlData: xmlData
            };

            await window.pluginManager.launchPlugin(pluginId, pluginData);
            this.setStatusMessage(`プラグインを起動しました: ${fileName}`);
        } catch (error) {
            console.error('プラグイン起動エラー:', error);
            this.setStatusMessage('プラグインの起動に失敗しました');
        }
    }
    
    /**
     * 用紙モードの切り替え
     * @param {string} windowId ウィンドウID
     * @param {string} canvasId キャンバスID
     */
    togglePaperMode(windowId, canvasId) {
        const windowElement = document.getElementById(windowId);
        const windowInfo = this.windows.get(windowId);
        
        if (!windowElement || !windowInfo) {
            console.warn('Window not found:', windowId);
            return;
        }
        
        // 現在の状態を取得してトグル
        const currentMode = windowElement.dataset.paperMode === 'true';
        const newMode = !currentMode;
        
        // ウィンドウの属性を更新
        windowElement.dataset.paperMode = newMode.toString();
        
        // TADデータを再描画
        if (windowInfo.tadData) {
            // canvasIdから番号を抽出
            const canvasNumber = parseInt(canvasId.replace('canvas-', ''));
            
            // renderFromTadFileDrawBufferを呼び出して再描画
            if (typeof renderFromTadFileDrawBuffer === 'function') {
                // ファイルインデックスを取得
                let fileIndex = windowInfo.fileIndex;
                if (fileIndex === null || fileIndex === undefined) {
                    // fileIndexが設定されていない場合、originalLinkIdを使用
                    if (windowInfo.originalLinkId !== null && windowInfo.originalLinkId !== undefined) {
                        fileIndex = windowInfo.originalLinkId;
                        console.log(`Using originalLinkId as fileIndex: ${fileIndex} for canvas ${canvasId}`);
                    } else {
                        // それでも取得できない場合は、canvasNumberを使用（フォールバック）
                        fileIndex = canvasNumber;
                        console.warn(`Using canvasNumber as fileIndex: ${fileIndex} for canvas ${canvasId}`);
                    }
                }
                
                // 現在のスクロール位置を取得（あれば）
                const scrollX = windowInfo.scrollX || 0;
                const scrollY = windowInfo.scrollY || 0;
                
                // 用紙モードチェックボックスの状態を一時的に設定
                const tempCheckbox = document.createElement('input');
                tempCheckbox.type = 'checkbox';
                tempCheckbox.id = `${canvasId}-paper-mode`;
                tempCheckbox.checked = newMode;
                tempCheckbox.style.display = 'none';
                document.body.appendChild(tempCheckbox);
                
                console.log(`Toggling paper mode: fileIndex=${fileIndex}, canvasNumber=${canvasNumber}, newMode=${newMode}`);
                
                // 再描画
                renderFromTadFileDrawBuffer(fileIndex, canvasNumber, scrollX, scrollY);
                
                // 一時チェックボックスを削除
                tempCheckbox.remove();
            }
        }
        
        // ステータスメッセージを表示
        const modeText = newMode ? '有効' : '無効';
        this.setStatusMessage(`用紙モードを${modeText}にしました`);
    }
    
    /**
     * 表示モードの設定
     * @param {string} windowId ウィンドウID
     * @param {string} _canvasId キャンバスID（非推奨、使用されない）
     * @param {string} mode 表示モード ('0', '2', '3')
     */
    setDisplayMode(windowId, _canvasId, mode) {
        const windowElement = document.getElementById(windowId);
        const windowInfo = this.windows.get(windowId);
        
        if (!windowElement || !windowInfo) {
            console.warn('Window not found:', windowId);
            return;
        }
        
        // ウィンドウの属性を更新
        windowElement.dataset.displayMode = mode;

        // ステータスメッセージを表示
        const modeNames = { '0': '原稿モード', '2': '詳細モード', '3': '清書モード' };
        this.setStatusMessage(`表示モードを${modeNames[mode]}に変更しました`);
    }
    
    /**
     * ウィンドウ幅で折り返しの切り替え
     * @param {string} windowId ウィンドウID
     * @param {string} _canvasId キャンバスID（非推奨、使用されない）
     */
    toggleWrapAtWindowWidth(windowId, _canvasId) {
        const windowElement = document.getElementById(windowId);
        const windowInfo = this.windows.get(windowId);
        
        if (!windowElement || !windowInfo) {
            console.warn('Window not found:', windowId);
            return;
        }
        
        // 現在の状態を取得してトグル
        const currentMode = windowElement.dataset.wrapAtWindowWidth !== 'false';
        const newMode = !currentMode;
        
        // ウィンドウの属性を更新
        windowElement.dataset.wrapAtWindowWidth = newMode.toString();

        // ステータスメッセージを表示
        const modeText = newMode ? '有効' : '無効';
        this.setStatusMessage(`ウィンドウ幅で折り返しを${modeText}にしました`);
    }
    
    showFileProperties(fileInfo) {
        const content = `
            <div style="padding: 10px; overflow: auto; height: 100%;">
                <h3>ファイルのプロパティ</h3>
                <p><strong>ファイル名:</strong> ${fileInfo.name}</p>
                <p><strong>サイズ:</strong> ${fileInfo.size} バイト</p>
                <p><strong>種類:</strong> ${fileInfo.type || 'TADドキュメント'}</p>
                <p><strong>更新日時:</strong> ${new Date(fileInfo.lastModified).toLocaleString()}</p>
                <hr>
                <!-- スクロールテスト用の追加コンテンツ -->
                <h4>詳細情報</h4>
                <p>ファイルパス: /home/user/documents/${fileInfo.name}</p>
                <p>アクセス権限: 読み取り/書き込み</p>
                <p>所有者: ユーザー</p>
                <p>グループ: users</p>
                <p>エンコーディング: UTF-8</p>
                <p>圧縮形式: LH5</p>
                <p>仮想オブジェクト数: 5</p>
                <p>リンク数: 3</p>
                <p>バージョン: 1.0</p>
                <p>作成者: TADjs System</p>
                <p>コメント: このファイルはTADjs環境で作成されました。</p>
                <div style="width: 500px; padding: 10px; background: #f0f0f0;">
                    <p>拡張属性テーブル（横スクロールテスト用）</p>
                    <table style="width: 100%; border: 1px solid #ccc;">
                        <tr><td>属性1</td><td>値1</td><td>説明1</td><td>タイプ</td><td>更新日時</td></tr>
                        <tr><td>属性2</td><td>値2</td><td>説明2</td><td>タイプ</td><td>更新日時</td></tr>
                    </table>
                </div>
            </div>
        `;
        
        this.createWindow(`プロパティ: ${fileInfo.name}`, content, {
            width: 350,
            height: 400,
            x: 200,
            y: 100
        });
    }

    /**
     * ファイルを開くダイアログを表示
     */
    showFileOpenDialog() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.tad,.TAD,.bpk,.BPK';
        input.multiple = true;
        
        input.onchange = (e) => {
            const files = Array.from(e.target.files);
            this.handleFilesDrop(files);
        };
        
        input.click();
    }

    /**
     * 開いているウィンドウの一覧を表示
     */
    showWindowList() {
        let content = '<h3>開いているウインドウ</h3>';

        if (this.windows.size === 0) {
            content += '<p>開いているウインドウはありません</p>';
        } else {
            content += '<ul>';
            this.windows.forEach((window, id) => {
                const activeText = id === this.activeWindow ? ' (アクティブ)' : '';
                content += `<li onclick="window.tadjsDesktop.setActiveWindow('${id}')" style="cursor: pointer; padding: 2px;">${window.title}${activeText}</li>`;
            });
            content += '</ul>';
        }
        
        this.createWindow('ウインドウ一覧', content, {
            width: 250,
            height: 200
        });
    }

    /**
     * デスクトップ上のファイルアイコンをクリア
     */
    clearDesktop() {
        // ファイルアイコンをクリア
        document.getElementById('file-icons').innerHTML = '';
        this.fileObjects = {};
        this.setStatusMessage('デスクトップをクリアしました');
    }

    showSystemInfo() {
        const content = `
            <h3>システム情報</h3>
            <p><strong>TADjs Desktop Environment</strong></p>
            <p>Version: 1.0</p>
            <p>ブラウザ: ${navigator.userAgent.split(' ')[0]}</p>
            <p>画面解像度: ${screen.width} x ${screen.height}</p>
            <p>開いているウインドウ: ${this.windows.size}個</p>
            <p>TAD.js: ${typeof tadRawArray !== 'undefined' ? '利用可能' : '見つかりません'}</p>
        `;
        
        this.createWindow('システム情報', content, {
            width: 300,
            height: 250,
            resizable: false
        });
    }


    /**
     * スクロールバーのイベントを設定
     * @param {string} windowId - ウィンドウID
     * @param {string} direction - スクロール方向
     * @param {HTMLElement} scrollTarget - スクロール対象要素
     */
    setupScrollbarEvents(windowId, direction, scrollTarget) {
        // コンテンツのスクロールイベントを設定
        scrollTarget.addEventListener('scroll', () => {
            console.log(`Scroll event: ${direction} direction`);
        });
    }
    

    /**
     * ウィンドウのプロパティダイアログを表示
     * @param {string} windowId - 対象ウィンドウのID
     */
    showWindowProperties(windowId) {
        const window = this.windows.get(windowId);
        if (!window) return;
        
        const rect = window.element.getBoundingClientRect();
        const content = `
            <h3>ウインドウプロパティ</h3>
            <p>タイトル: ${window.title}</p>
            <p>位置: (${Math.round(rect.left)}, ${Math.round(rect.top)})</p>
            <p>サイズ: ${Math.round(rect.width)} x ${Math.round(rect.height)}</p>
            <p>状態: ${windowId === this.activeWindow ? 'アクティブ' : '非アクティブ'}</p>
        `;
        
        this.createWindow(`${window.title} - プロパティ`, content, {
            width: 250,
            height: 180,
            resizable: false
        });
    }

    showVirtualObjectProperties(link) {
        const content = `
            <h3>仮身プロパティ</h3>
            <p>名前: ${link.link_name || '(無名)'}</p>
            <p>ID: ${link.link_id}</p>
            <p>位置: (${link.left}, ${link.top})</p>
            <p>サイズ: ${link.right - link.left} x ${link.bottom - link.top}</p>
            <p>データサイズ: ${link.dlen || 0} バイト</p>
            <p>リンクデータ: ${link.raw ? '有り' : '無し'}</p>
        `;
        
        this.createWindow('仮身プロパティ', content, {
            width: 250,
            height: 200,
            resizable: false
        });
    }
    /**
     * デスクトップに背景を適用
     * @param {string} bgId - 背景のID（'none'の場合は背景なし）
     */
    applyBackgroundToDesktop(bgId) {
        const desktop = document.getElementById('desktop');

        if (bgId === 'none') {
            desktop.style.backgroundImage = 'none';
            desktop.style.backgroundColor = '#c0c0c0';
        } else {
            const savedBackgrounds = JSON.parse(localStorage.getItem('systemBackgrounds') || '[]');
            const background = savedBackgrounds.find(bg => bg.id == bgId);

            if (background) {
                desktop.style.backgroundImage = `url('${background.data}')`;
                desktop.style.backgroundRepeat = 'no-repeat';
                desktop.style.backgroundSize = 'cover';
                desktop.style.backgroundPosition = 'center';
            }
        }
    }

    /**
     * ユーザー環境設定を適用
     */
    applyUserConfig() {
        // タイトル文字サイズ
        const titleFontSize = localStorage.getItem('title-font-size') || '14';
        document.documentElement.style.setProperty('--title-font-size', titleFontSize + 'px');
        document.querySelectorAll('.window-title').forEach(title => {
            title.style.fontSize = titleFontSize + 'px';
        });

        // スクロールバー幅
        const scrollbarWidth = localStorage.getItem('scrollbar-width') || '12';
        document.documentElement.style.setProperty('--scrollbar-width', scrollbarWidth + 'px');

        // メニュー文字サイズ
        const menuFontSize = localStorage.getItem('menu-font-size') || '14';
        document.documentElement.style.setProperty('--menu-font-size', menuFontSize + 'px');

        // カーソル点滅間隔
        const cursorBlink = localStorage.getItem('cursor-blink') || '800';
        document.documentElement.style.setProperty('--cursor-blink-interval', cursorBlink + 'ms');

        // 選択枠チラつき間隔
        const selectionBlink = localStorage.getItem('selection-blink') || '600';
        document.documentElement.style.setProperty('--selection-blink-interval', selectionBlink + 'ms');

        // メニュー反応時間
        const menuDelay = localStorage.getItem('menu-delay') || '200';
        document.documentElement.style.setProperty('--menu-delay', menuDelay + 'ms');

        // カーソル太さ
        const cursorWidth = localStorage.getItem('cursor-width') || '1';
        document.documentElement.style.setProperty('--cursor-width', cursorWidth + 'px');

        // ポインタ表示サイズ
        const pointerSize = localStorage.getItem('pointer-size') || 'small';
        const cursorSizeMap = { small: '16px', medium: '24px', large: '32px' };
        document.documentElement.style.setProperty('--pointer-size', cursorSizeMap[pointerSize] || '16px');

        // 選択枠太さ
        const selectionWidth = localStorage.getItem('selection-width') || '1';
        document.documentElement.style.setProperty('--selection-width', selectionWidth + 'px');

        console.log('[TADjs] ユーザ環境設定を適用しました');

        // 全てのプラグインに設定変更を通知
        document.querySelectorAll('.window iframe').forEach(iframe => {
            if (iframe.contentWindow) {
                iframe.contentWindow.postMessage({
                    type: 'user-config-updated'
                }, '*');
            }
        });
    }

    /**
     * すべてのウィンドウのリサイズハンドルを無効化
     */
    disableAllWindowResize() {
        console.log('[TADjs] ウィンドウリサイズを一時無効化');
        document.querySelectorAll('.window .resize-handle').forEach(handle => {
            handle.style.pointerEvents = 'none';
        });
    }

    /**
     * すべてのウィンドウのリサイズハンドルを再有効化
     */
    enableAllWindowResize() {
        console.log('[TADjs] ウィンドウリサイズを再有効化');
        document.querySelectorAll('.window .resize-handle').forEach(handle => {
            handle.style.pointerEvents = '';
        });
    }

    /**
     * プラグイン一覧情報を取得
     * @returns {Array<Object>} プラグイン情報の配列
     */
    getPluginListInfo() {
        const plugins = [];

        if (window.pluginManager && window.pluginManager.plugins) {
            window.pluginManager.plugins.forEach((plugin, id) => {
                plugins.push({
                    id: plugin.id,
                    name: plugin.name,
                    version: plugin.version || 'R 4.500',
                    type: plugin.type || 'base'
                });
            });
        }

        return plugins;
    }

    /**
     * ブラウザウィンドウのリサイズを処理
     */
    handleWindowResize() {
        // ウインドウサイズ変更時の処理
        // 必要に応じてウインドウ位置を調整
    }

    /**
     * 道具パネルのcontentWindowから対応する編集ウィンドウのiframeを取得
     * @param {Window} toolPanelWindow - 道具パネルのcontentWindow
     * @returns {HTMLIFrameElement|null} - 編集ウィンドウのiframe
     */
    getEditorFrameFromToolPanel(toolPanelWindow) {
        if (!toolPanelWindow || !toolPanelWindow.frameElement) {
            return null;
        }

        // 道具パネルのiframe要素
        const toolPanelFrame = toolPanelWindow.frameElement;

        // 道具パネルが属するウィンドウを探す
        const toolPanelWindowElement = toolPanelFrame.closest('.window');
        if (!toolPanelWindowElement) {
            return null;
        }

        const toolPanelWindowId = toolPanelWindowElement.id;

        // toolPanelRelationsから対応する編集iframeを取得
        if (this.toolPanelRelations && this.toolPanelRelations[toolPanelWindowId]) {
            return this.toolPanelRelations[toolPanelWindowId].editorIframe;
        }

        return null;
    }

    /**
     * メッセージダイアログを表示
     * @param {string} message - 表示するメッセージ
     * @param {Array<{label: string, value: any}>} buttons - ボタン定義の配列
     * @param {number} defaultButton - デフォルトボタンのインデックス (0始まり)
     * @returns {Promise<any>} - 選択されたボタンのvalue
     */
    openToolPanelWindow(pluginId, settings, pluginIframe) {
        const pluginPath = `plugins/${pluginId}/tool-panel.html`;

        const content = `<iframe src="${pluginPath}" style="width: 100%; height: 100%; border: none;"></iframe>`;

        const windowId = this.createWindow('道具パネル', content, {
            width: 390,
            height: 80,
            x: 50,
            y: 50,
            resizable: false,
            closeable: true,
            alwaysOnTop: true,
            cssClass: 'tool-panel-window',
            scrollable: false,  // スクロールバー非表示
            frame: false  // タイトルバーを非表示
        });

        // 道具パネルと編集ウィンドウの関連付けを保存
        if (!this.toolPanelRelations) {
            this.toolPanelRelations = {};
        }
        this.toolPanelRelations[windowId] = {
            editorIframe: pluginIframe,
            toolPanelWindowId: windowId
        };

        // 道具パネルウィンドウに初期設定を送信
        setTimeout(() => {
            const windowElement = document.getElementById(windowId);
            if (windowElement) {
                const iframe = windowElement.querySelector('iframe');
                if (iframe && iframe.contentWindow) {
                    // 道具パネルiframeへの参照も保存
                    this.toolPanelRelations[windowId].toolPanelIframe = iframe;

                    iframe.contentWindow.postMessage({
                        type: 'init-tool-panel',
                        settings: settings
                    }, '*');
                }
            }

            // プラグインに道具パネルウィンドウのIDを通知
            if (pluginIframe && pluginIframe.contentWindow) {
                pluginIframe.contentWindow.postMessage({
                    type: 'tool-panel-window-created',
                    windowId: windowId
                }, '*');
            }
        }, 100);

        console.log('[TADjs] 道具パネルウィンドウ作成:', windowId);
    }

    showToolPanelPopup(data, source) {
        // 既存のポップアップがあれば削除
        this.hideToolPanelPopup();

        // クローズ用のイベントハンドラを保存
        this.toolPanelPopupCloseHandler = null;

        // ポップアップ要素を作成
        const popup = document.createElement('div');
        popup.id = 'tool-panel-popup';
        popup.style.cssText = `
            position: fixed;
            background: #c0c0c0;
            border: 2px outset #ffffff;
            box-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
            padding: 8px;
            z-index: 10000;
            min-width: 150px;
            max-height: 400px;
            overflow-y: auto;
            overflow-x: hidden;
        `;

        // HTMLコンテンツを設定
        popup.innerHTML = data.htmlContent;

        // 位置を設定
        popup.style.left = data.x + 'px';
        popup.style.top = data.y + 'px';

        // DOMに追加
        document.body.appendChild(popup);

        // ポップアップ内のイベントハンドラを設定
        const handlePopupClick = (e) => {
            // 外側へのイベント伝播は止める
            e.stopPropagation();

            // チェックボックス、select、color pickerなどのデフォルト動作は妨げない
            const tagName = e.target.tagName.toLowerCase();
            const inputType = e.target.type;
            if (tagName === 'input' && (inputType === 'checkbox' || inputType === 'color')) {
                // チェックボックスとカラーピッカーはpreventDefaultしない
                return;
            }
            if (tagName === 'select' || tagName === 'option') {
                // selectもpreventDefaultしない
                return;
            }

            if (e.target.classList.contains('grid-interval-btn')) {
                e.preventDefault();
                const interval = parseInt(e.target.dataset.interval);

                // すべての間隔ボタンの背景色をリセット
                popup.querySelectorAll('.grid-interval-btn').forEach(btn => {
                    btn.style.background = 'white';
                });

                // クリックされたボタンを選択状態にする
                e.target.style.background = '#e0e0e0';

                if (source && source.frameElement) {
                    source.postMessage({
                        type: 'popup-grid-interval-click',
                        interval: interval
                    }, '*');
                }
            } else if (e.target.classList.contains('material-tool-btn')) {
                e.preventDefault();
                const tool = e.target.dataset.materialTool;

                // すべての画材ツールボタンの背景色をリセット
                popup.querySelectorAll('.material-tool-btn').forEach(btn => {
                    btn.style.background = 'white';
                });

                // クリックされたボタンを選択状態にする
                e.target.style.background = '#e0e0e0';

                if (source && source.frameElement) {
                    source.postMessage({
                        type: 'popup-material-tool-click',
                        materialTool: tool
                    }, '*');
                }
            }
        };

        const handlePopupChange = (e) => {
            if (e.target.id === 'gridModeSelect') {
                if (source && source.frameElement) {
                    source.postMessage({
                        type: 'popup-grid-mode-change',
                        gridMode: e.target.value
                    }, '*');
                }
            } else if (e.target.id === 'gridIntervalCustom') {
                const value = parseInt(e.target.value);
                if (value > 0 && value <= 200 && source && source.frameElement) {
                    source.postMessage({
                        type: 'popup-grid-interval-custom',
                        interval: value
                    }, '*');
                }
            } else if (e.target.id === 'fontSizeSelect') {
                // フォントサイズ変更 - 道具パネルから対応する編集ウィンドウを探す
                const editorFrame = this.getEditorFrameFromToolPanel(source);
                if (editorFrame && editorFrame.contentWindow) {
                    editorFrame.contentWindow.postMessage({
                        type: 'update-font-size',
                        fontSize: parseInt(e.target.value)
                    }, '*');
                }
            } else if (e.target.id === 'fontFamilySelect') {
                // フォント変更
                const editorFrame = this.getEditorFrameFromToolPanel(source);
                if (editorFrame && editorFrame.contentWindow) {
                    editorFrame.contentWindow.postMessage({
                        type: 'update-font-family',
                        fontFamily: e.target.value
                    }, '*');
                }
            } else if (e.target.id === 'textColorPicker') {
                // 文字色変更
                const editorFrame = this.getEditorFrameFromToolPanel(source);
                if (editorFrame && editorFrame.contentWindow) {
                    editorFrame.contentWindow.postMessage({
                        type: 'update-text-color',
                        textColor: e.target.value
                    }, '*');
                }
            } else if (e.target.id === 'boldCheck' || e.target.id === 'italicCheck' ||
                       e.target.id === 'underlineCheck' || e.target.id === 'strikethroughCheck') {
                // 文字修飾変更
                const decorationType = e.target.id.replace('Check', '');
                const editorFrame = this.getEditorFrameFromToolPanel(source);
                if (editorFrame && editorFrame.contentWindow) {
                    editorFrame.contentWindow.postMessage({
                        type: 'update-text-decoration',
                        decoration: decorationType,
                        enabled: e.target.checked
                    }, '*');
                }
            } else if (e.target.id === 'fillColorPicker') {
                // 塗りつぶし色変更
                if (source && source.frameElement) {
                    source.postMessage({
                        type: 'popup-fill-color-change',
                        fillColor: e.target.value
                    }, '*');
                }
            } else if (e.target.id === 'fillEnabledCheck') {
                // 塗りつぶし有効/無効
                if (source && source.frameElement) {
                    source.postMessage({
                        type: 'popup-fill-enabled-change',
                        fillEnabled: e.target.checked
                    }, '*');
                }
            } else if (e.target.id === 'strokeColorPicker') {
                // 線色変更
                if (source && source.frameElement) {
                    source.postMessage({
                        type: 'popup-stroke-color-change',
                        strokeColor: e.target.value
                    }, '*');
                }
            } else if (e.target.id === 'lineWidthSelect') {
                // 線の太さ変更
                if (source && source.frameElement) {
                    source.postMessage({
                        type: 'popup-line-width-change',
                        lineWidth: parseInt(e.target.value)
                    }, '*');
                }
            } else if (e.target.id === 'linePatternSelect') {
                // 線種変更
                if (source && source.frameElement) {
                    source.postMessage({
                        type: 'popup-line-pattern-change',
                        linePattern: e.target.value
                    }, '*');
                }
            } else if (e.target.id === 'cornerRadiusInput') {
                // 角丸半径変更
                if (source && source.frameElement) {
                    source.postMessage({
                        type: 'popup-corner-radius-change',
                        cornerRadius: parseInt(e.target.value)
                    }, '*');
                }
            } else if (e.target.id === 'brushSizeInput') {
                // ブラシサイズ変更
                if (source && source.frameElement) {
                    source.postMessage({
                        type: 'popup-brush-size-change',
                        brushSize: parseInt(e.target.value)
                    }, '*');
                }
            }
        };

        // イベントリスナーを登録
        popup.addEventListener('mousedown', (e) => e.stopPropagation(), true);
        popup.addEventListener('click', handlePopupClick, true);
        popup.addEventListener('change', handlePopupChange);

        // 外側をクリックしたら閉じる
        const closePopup = (e) => {
            console.log('[POPUP] closePopup called, target:', e.target, 'tagName:', e.target.tagName);

            // ポップアップがまだ存在するか確認
            const currentPopup = document.getElementById('tool-panel-popup');
            if (!currentPopup) {
                console.log('[POPUP] Popup already removed');
                return;
            }

            // クリックがポップアップ内かチェック
            const isInsidePopup = currentPopup.contains(e.target);
            console.log('[POPUP] isInsidePopup:', isInsidePopup);

            if (!isInsidePopup) {
                console.log('[POPUP] Closing popup - click outside detected');
                this.hideToolPanelPopup();
            }
        };

        // ハンドラを保存（配列で複数のハンドラを管理）
        this.toolPanelPopupCloseHandlers = [];

        // 少し遅延させてから外側クリックハンドラを登録
        setTimeout(() => {
            // 親ウィンドウのdocumentに登録
            document.addEventListener('mousedown', closePopup, true);
            this.toolPanelPopupCloseHandlers.push({ element: document, handler: closePopup });
            console.log('[POPUP] Added listener to main document');

            // すべてのiframeのdocumentにもリスナーを登録
            const allIframes = document.querySelectorAll('iframe');
            console.log('[POPUP] Found', allIframes.length, 'iframes');

            allIframes.forEach((iframe, index) => {
                try {
                    if (iframe.contentDocument) {
                        iframe.contentDocument.addEventListener('mousedown', closePopup, true);
                        this.toolPanelPopupCloseHandlers.push({
                            element: iframe.contentDocument,
                            handler: closePopup
                        });
                        console.log('[POPUP] Added listener to iframe', index);
                    }
                } catch (e) {
                    console.log('[POPUP] Cannot access iframe', index, 'document:', e.message);
                }
            });
        }, 100);
    }

    hideToolPanelPopup() {
        console.log('[POPUP] hideToolPanelPopup called');

        // すべてのイベントリスナーをクリーンアップ
        if (this.toolPanelPopupCloseHandlers) {
            this.toolPanelPopupCloseHandlers.forEach(({ element, handler }) => {
                try {
                    element.removeEventListener('mousedown', handler, true);
                    console.log('[POPUP] Removed listener from element');
                } catch (e) {
                    console.log('[POPUP] Error removing listener:', e.message);
                }
            });
            this.toolPanelPopupCloseHandlers = [];
        }

        // 旧形式のハンドラもクリーンアップ（互換性のため）
        if (this.toolPanelPopupCloseHandler) {
            document.removeEventListener('mousedown', this.toolPanelPopupCloseHandler, true);
            this.toolPanelPopupCloseHandler = null;
        }

        const popup = document.getElementById('tool-panel-popup');
        if (popup) {
            console.log('[POPUP] Removing popup element');
            popup.remove();
        }
    }

    saveImageFile(fileName, imageDataArray) {
        try {

            // XTADファイルと同じディレクトリ（実行ファイルのディレクトリ）に保存
            const basePath = this.getDataBasePath();
            const filePath = this.path.join(basePath, fileName);

            // Uint8Arrayに変換して保存
            const buffer = Buffer.from(imageDataArray);
            this.fs.writeFileSync(filePath, buffer);

            console.log('[TADjs] 画像ファイル保存成功:', filePath);
            return true;
        } catch (error) {
            console.error('[TADjs] 画像ファイル保存エラー:', error);
            return false;
        }
    }

    loadImageFile(fileName, messageId, source) {
        try {

            // XTADファイルと同じディレクトリから読み込み
            const basePath = this.getDataBasePath();
            const filePath = this.path.join(basePath, fileName);

            console.log('[TADjs] 画像ファイル読み込み:', filePath);

            // ファイルが存在するかチェック
            if (!this.fs.existsSync(filePath)) {
                console.error('[TADjs] 画像ファイルが見つかりません:', filePath);
                source.postMessage({
                    type: 'load-image-response',
                    messageId: messageId,
                    success: false,
                    error: 'File not found'
                }, '*');
                return;
            }

            // ファイルを読み込み
            const buffer = this.fs.readFileSync(filePath);
            const imageData = Array.from(buffer);

            // MIMEタイプを推測
            const ext = this.path.extname(fileName).toLowerCase();
            let mimeType = 'image/png';
            if (ext === '.jpg' || ext === '.jpeg') {
                mimeType = 'image/jpeg';
            } else if (ext === '.gif') {
                mimeType = 'image/gif';
            } else if (ext === '.bmp') {
                mimeType = 'image/bmp';
            }

            // レスポンスを送信
            source.postMessage({
                type: 'load-image-response',
                messageId: messageId,
                success: true,
                imageData: imageData,
                mimeType: mimeType
            }, '*');

            console.log('[TADjs] 画像ファイル読み込み成功:', filePath, '(', buffer.length, 'bytes)');
        } catch (error) {
            console.error('[TADjs] 画像ファイル読み込みエラー:', error);
            source.postMessage({
                type: 'load-image-response',
                messageId: messageId,
                success: false,
                error: error.message
            }, '*');
        }
    }

    showMessageDialog(message, buttons, defaultButton = 0) {
        return new Promise((resolve) => {
            const overlay = document.getElementById('dialog-overlay');
            const dialog = document.getElementById('message-dialog');
            const messageText = document.getElementById('dialog-message-text');
            const buttonsContainer = document.getElementById('dialog-message-buttons');

            // メッセージを設定
            messageText.textContent = message;

            // ボタンをクリア
            buttonsContainer.innerHTML = '';

            // ボタンを作成
            buttons.forEach((buttonDef, index) => {
                const button = document.createElement('button');
                button.className = 'dialog-button';
                button.textContent = buttonDef.label;

                // デフォルトボタンにマーク
                if (index === defaultButton) {
                    button.classList.add('default');
                }

                button.addEventListener('click', () => {
                    this.hideMessageDialog();
                    resolve(buttonDef.value);
                });

                buttonsContainer.appendChild(button);
            });

            // Enterキーでデフォルトボタンを押す
            const handleKeyDown = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.hideMessageDialog();
                    document.removeEventListener('keydown', handleKeyDown);
                    resolve(buttons[defaultButton].value);
                }
            };
            document.addEventListener('keydown', handleKeyDown);

            // ダイアログを表示
            overlay.style.display = 'block';
            dialog.style.display = 'block';

            // デフォルトボタンにフォーカス
            const defaultBtn = buttonsContainer.children[defaultButton];
            if (defaultBtn) {
                defaultBtn.focus();
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
    }

    /**
     * 入力ダイアログを表示
     * @param {string} message - 表示するメッセージ
     * @param {string} defaultValue - 入力欄のデフォルト値
     * @param {number} inputWidth - 入力欄の幅（文字数）
     * @param {Array<{label: string, value: any}>} buttons - ボタン定義の配列
     * @param {number} defaultButton - デフォルトボタンのインデックス (0始まり)
     * @returns {Promise<{button: any, value: string}>} - 選択されたボタンと入力値
     */
    showInputDialog(message, defaultValue = '', inputWidth = 30, buttons = [{ label: '取消', value: 'cancel' }, { label: 'OK', value: 'ok' }], defaultButton = 1) {
        return new Promise((resolve) => {
            const overlay = document.getElementById('dialog-overlay');
            const dialog = document.getElementById('input-dialog');
            const messageText = document.getElementById('input-dialog-message');
            const inputField = document.getElementById('dialog-input-field');
            const buttonsContainer = document.getElementById('input-dialog-buttons');

            // メッセージを設定
            messageText.textContent = message;

            // 入力欄を設定
            inputField.value = defaultValue;
            inputField.style.width = `${inputWidth}ch`;
            inputField.select();

            // ボタンをクリア
            buttonsContainer.innerHTML = '';

            // ボタンを作成
            buttons.forEach((buttonDef, index) => {
                const button = document.createElement('button');
                button.className = 'dialog-button';
                button.textContent = buttonDef.label;

                // デフォルトボタンにマーク
                if (index === defaultButton) {
                    button.classList.add('default');
                }

                button.addEventListener('click', () => {
                    this.hideInputDialog();
                    resolve({
                        button: buttonDef.value,
                        value: inputField.value
                    });
                });

                buttonsContainer.appendChild(button);
            });

            // Enterキーでデフォルトボタンを押す
            const handleKeyDown = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.hideInputDialog();
                    document.removeEventListener('keydown', handleKeyDown);
                    resolve({
                        button: buttons[defaultButton].value,
                        value: inputField.value
                    });
                }
            };
            document.addEventListener('keydown', handleKeyDown);

            // ダイアログを表示
            overlay.style.display = 'block';
            dialog.style.display = 'block';

            // 入力欄にフォーカス
            setTimeout(() => {
                inputField.focus();
                inputField.select();
            }, 100);
        });
    }

    /**
     * 入力ダイアログを非表示にする
     */
    hideInputDialog() {
        const overlay = document.getElementById('dialog-overlay');
        const dialog = document.getElementById('input-dialog');
        overlay.style.display = 'none';
        dialog.style.display = 'none';
    }

    /**
     * カスタムダイアログを表示
     * @param {string} dialogHtml - ダイアログ内に表示するHTML
     * @param {Array<{label: string, value: any}>} buttons - ボタン定義の配列
     * @param {number} defaultButton - デフォルトボタンのインデックス (0始まり)
     * @param {Object} inputs - 入力要素のID {checkbox: 'id1', text: 'id2'}
     * @returns {Promise<{button: any, checkbox: boolean, input: string}>}
     */
    showCustomDialog(dialogHtml, buttons, defaultButton = 0, inputs = {}) {
        return new Promise((resolve) => {
            const overlay = document.getElementById('dialog-overlay');
            const dialog = document.getElementById('input-dialog');
            const messageText = document.getElementById('input-dialog-message');
            const buttonsContainer = document.getElementById('input-dialog-buttons');

            // カスタムHTMLを設定
            messageText.innerHTML = dialogHtml;

            // ボタンをクリア
            buttonsContainer.innerHTML = '';

            // ボタンを作成
            buttons.forEach((buttonDef, index) => {
                const button = document.createElement('button');
                button.className = 'dialog-button';
                button.textContent = buttonDef.label;

                // デフォルトボタンにマーク
                if (index === defaultButton) {
                    button.classList.add('default');
                }

                button.addEventListener('click', () => {
                    // 入力値を取得
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

                    // ダイアログ要素への参照を保持
                    const dialogElement = messageText.cloneNode(true);

                    this.hideInputDialog();
                    resolve({
                        button: buttonDef.value,
                        checkbox: checkboxValue,
                        input: textValue,
                        radios: radiosValue,
                        inputs: { columnCount: textValue },
                        dialogElement: dialogElement
                    });
                });

                buttonsContainer.appendChild(button);
            });

            // Enterキーでデフォルトボタンを押す
            const handleKeyDown = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();

                    // 入力値を取得
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

                    // ダイアログ要素への参照を保持
                    const dialogElement = messageText.cloneNode(true);

                    this.hideInputDialog();
                    document.removeEventListener('keydown', handleKeyDown);
                    resolve({
                        button: buttons[defaultButton].value,
                        checkbox: checkboxValue,
                        input: textValue,
                        radios: radiosValue,
                        inputs: { columnCount: textValue },
                        dialogElement: dialogElement
                    });
                }
            };
            document.addEventListener('keydown', handleKeyDown);

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
                }, 100);
            }
        });
    }

    /**
     * TADデータをcanvasに保存
     * @param {HTMLCanvasElement} canvas - 保存先のcanvas要素
     * @param {Object} tadData - TADデータオブジェクト
     * @param {string} canvasId - canvas要素のID
     */
    saveTadDataToCanvas(canvas, tadData, canvasId) {
        //console.log(`=== saveTadDataToCanvas called for ${canvasId} ===`);
        const { linkRecordList, tadRecordDataArray, currentFileIndex } = tadData;
        
        // canvasIdに対応するウィンドウのoriginalLinkIdを取得
        let originalLinkId = null;
        for (const [windowId, windowInfo] of this.windows) {
            // console.log(`Checking window ${windowId}:`, {
            //     canvasId: windowInfo.canvasId,
            //     originalLinkId: windowInfo.originalLinkId,
            //     matches: windowInfo.canvasId === canvasId
            // });
            if (windowInfo.canvasId === canvasId) {
                originalLinkId = windowInfo.originalLinkId;
                //console.log(`Found matching window ${windowId} with originalLinkId:`, originalLinkId);
                break;
            }
        }
        
        // グローバル変数からも確認
        const globalOriginalLinkId = window.originalLinkId;
        // console.log(`Global originalLinkId: ${globalOriginalLinkId}, Local originalLinkId: ${originalLinkId}`);

        // グローバル変数を優先（tad.jsで設定された値を使用）
        if (globalOriginalLinkId !== null && globalOriginalLinkId !== undefined) {
            originalLinkId = globalOriginalLinkId;
            // console.log(`Using global originalLinkId: ${originalLinkId}`);
        }
        
        // console.debug('saveTadDataToCanvas called:', {
        //     canvasId,
        //     originalLinkId,
        //     currentFileIndex,
        //     linkRecordListLength: linkRecordList ? linkRecordList.length : 0,
        //     tadRecordDataArrayLength: tadRecordDataArray ? tadRecordDataArray.length : 0
        // });
        
        
        // linkRecordListから該当link_idのリンクを取得
        let virtualLinks = [];
        
        if (originalLinkId !== null && originalLinkId !== undefined) {
            // セカンダリウィンドウの場合：link_id - 1のインデックスを使用
            const linkIndex = parseInt(originalLinkId) - 1;
            // console.log(`Secondary window: using linkRecordList[${linkIndex}] for originalLinkId ${originalLinkId}`);

            if (linkRecordList && linkRecordList[linkIndex] && Array.isArray(linkRecordList[linkIndex])) {
                virtualLinks = [...linkRecordList[linkIndex]];
                // console.log(`Using linkRecordList[${linkIndex}] with ${virtualLinks.length} links`);
            } else {
                // console.warn(`linkRecordList[${linkIndex}] not found for link_id ${originalLinkId}`);
            }
        } else {
            // メインウィンドウの場合：最初のファイルのリンクレコード
            // console.log('Main window: using linkRecordList[0]');

            if (linkRecordList && linkRecordList[0] && Array.isArray(linkRecordList[0])) {
                virtualLinks = [...linkRecordList[0]];
                // console.log(`Using linkRecordList[0] with ${virtualLinks.length} links`);
            } else {
                // console.warn('linkRecordList[0] not found');
            }
        }

        // console.debug('Final virtualLinks for', canvasId, ':', virtualLinks);

        // canvasにデータを保存
        canvas.virtualObjectLinks = virtualLinks;
        canvas.tadRecordDataArray = tadRecordDataArray ? [...tadRecordDataArray] : [];
        
        
        // 仮身オブジェクトのイベントを設定
        this.setupVirtualObjectEvents(canvas);

        this.setStatusMessage('TADファイルの描画が完了しました（コールバック経由）');
    }

    /**
     * 実身ファイルIDセットを生成
     * BTRONの実身/仮身モデルに従ったファイル名を生成
     * @param {number} recordCount - レコード数（デフォルト: 1）
     * @returns {Object} ファイルIDセット
     * {
     *   fileId: string,              // UUID v7
     *   jsonFile: string,            // fileid.json
     *   xtadFiles: string[]          // fileid_recordno.xtad の配列
     * }
     */
    generateRealFileIdSet(recordCount = 1) {
        // tad.jsのgenerateUUIDv7()を使用してファイルIDを生成
        const fileId = typeof generateUUIDv7 === 'function' ? generateUUIDv7() : this.generateUUIDv7Fallback();

        // JSONファイル名: fileid.json
        const jsonFile = `${fileId}.json`;

        // XTADファイル名の配列: fileid_recordno.xtad
        const xtadFiles = [];
        for (let i = 0; i < recordCount; i++) {
            xtadFiles.push(`${fileId}_${i}.xtad`);
        }

        const fileIdSet = {
            fileId: fileId,
            jsonFile: jsonFile,
            xtadFiles: xtadFiles
        };

        console.log('[TADjs] 実身ファイルIDセットを生成:', fileIdSet);
        return fileIdSet;
    }

    /**
     * UUID v7フォールバック生成（tad.jsが利用できない場合）
     * @returns {string} UUID v7文字列
     */
    generateUUIDv7Fallback() {
        const timestamp = Date.now();
        const randomBytes = new Uint8Array(10);

        if (typeof window !== 'undefined' && window.crypto) {
            window.crypto.getRandomValues(randomBytes);
        } else {
            for (let i = 0; i < randomBytes.length; i++) {
                randomBytes[i] = Math.floor(Math.random() * 256);
            }
        }

        const timestampHex = timestamp.toString(16).padStart(12, '0');
        const randomHex = Array.from(randomBytes)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');

        const timeLow = timestampHex;
        const timeHiAndVersion = '7' + randomHex.substring(0, 3);
        const clockSeqByte = parseInt(randomHex.substring(3, 5), 16);
        const clockSeqHi = ((clockSeqByte & 0x3F) | 0x80).toString(16).padStart(2, '0');
        const clockSeqLow = randomHex.substring(5, 7);
        const node = randomHex.substring(7, 19);

        return `${timeLow.substring(0, 8)}-${timeLow.substring(8, 12)}-${timeHiAndVersion}-${clockSeqHi}${clockSeqLow}-${node}`;
    }

    /**
     * xmlTADをXTADファイルに保存（ブラウザ環境ではダウンロード）
     * @param {string} fileId - ファイルID
     * @param {string} xmlData - 保存するxmlTAD文字列
     */
    async saveXmlDataToFile(fileId, xmlData) {
        try {
            console.log('[TADjs] xmlTADをファイルに保存開始:', fileId);

            // fileIdから拡張子を除去（既に_0.xtadが含まれている場合に対応）
            let baseFileId = fileId;
            if (baseFileId.endsWith('_0.xtad')) {
                baseFileId = baseFileId.substring(0, baseFileId.length - 7); // '_0.xtad'を除去
            } else if (baseFileId.endsWith('.xtad')) {
                baseFileId = baseFileId.substring(0, baseFileId.length - 5); // '.xtad'を除去
            }

            // ファイル名を構築（recordno 0のXTADファイル）
            const filename = `${baseFileId}_0.xtad`;

            // Electron環境の場合、ファイルシステムに保存
            if (this.isElectronEnv) {
                const saved = await this.saveDataFile(filename, xmlData);
                if (saved) {
                    console.log('[TADjs] xmlTADファイル保存成功:', filename);

                    // キャッシュをクリアして次回は新しいファイルを読み込む
                    delete this.fileObjects[filename];
                    console.log('[TADjs] ファイルキャッシュをクリア:', filename);

                    // JSONファイルのupdateDateを更新
                    const jsonFileName = `${baseFileId}.json`;
                    const jsonResult = await this.loadDataFile(this.getDataBasePath(), jsonFileName);
                    if (jsonResult.success && jsonResult.data) {
                        const jsonData = JSON.parse(jsonResult.data);
                        jsonData.updateDate = new Date().toISOString();

                        const jsonSaved = await this.saveDataFile(jsonFileName, JSON.stringify(jsonData, null, 2));
                        if (jsonSaved) {
                            console.log('[TADjs] JSONファイルのupdateDate更新完了:', baseFileId);

                            // JSONファイルのキャッシュもクリア
                            delete this.fileObjects[jsonFileName];
                            console.log('[TADjs] JSONファイルキャッシュをクリア:', jsonFileName);
                        } else {
                            console.warn('[TADjs] JSONファイル保存失敗:', jsonFileName);
                        }
                    } else {
                        console.log('[TADjs] JSONファイルが見つかりません（updateDate更新スキップ）:', jsonFileName);
                    }

                    this.setStatusMessage(`ファイルを保存しました: ${filename}`);
                } else {
                    console.error('[TADjs] xmlTADファイル保存失敗:', filename);
                    this.setStatusMessage(`ファイル保存エラー: ${filename}`);
                }
            } else {
                // ブラウザ環境の場合、ダウンロード
                const blob = new Blob([xmlData], { type: 'text/xml' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                a.style.display = 'none';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);

                console.log('[TADjs] xmlTADダウンロード開始:', filename);
                this.setStatusMessage(`ファイルをダウンロード中: ${filename}`);
            }

        } catch (error) {
            console.error('[TADjs] xmlTAD保存エラー:', error);
            this.setStatusMessage('ファイル保存エラー');
        }
    }

    /**
     * 実身管理用セグメントのbackgroundColorを更新
     * @param {string} fileId - ファイルID
     * @param {string} backgroundColor - 背景色
     */
    async updateBackgroundColor(fileId, backgroundColor) {
        try {
            console.log('[TADjs] backgroundColor更新開始:', fileId, backgroundColor);

            // JSONファイル名を構築
            const jsonFilename = `${fileId}.json`;

            // Electron環境の場合、ファイルシステムから読み込んで更新
            if (this.isElectronEnv) {
                const dataBasePath = this.getDataBasePath();
                const jsonPath = path.join(dataBasePath, jsonFilename);

                // JSONファイルを読み込み
                try {
                    const jsonContent = fs.readFileSync(jsonPath, 'utf-8');
                    const metadata = JSON.parse(jsonContent);

                    // backgroundColorを更新（window.backgroundColor）
                    if (!metadata.window) {
                        metadata.window = {};
                    }
                    metadata.window.backgroundColor = backgroundColor;

                    // metadataにrealIdを設定
                    metadata.realId = fileId;

                    // JSONファイルに保存
                    const saved = await this.saveDataFile(jsonFilename, JSON.stringify(metadata, null, 2));
                    if (saved) {
                        console.log('[TADjs] backgroundColor更新成功:', jsonFilename);

                        // ファイル直接アクセス版では不要（ファイル保存のみ）
                        console.log('[TADjs] backgroundColorを更新:', fileId);

                        this.setStatusMessage(`背景色を更新しました: ${backgroundColor}`);
                    } else {
                        console.error('[TADjs] backgroundColor更新失敗:', jsonFilename);
                        this.setStatusMessage(`背景色更新エラー: ${jsonFilename}`);
                    }
                } catch (readError) {
                    console.error('[TADjs] JSONファイル読み込みエラー:', jsonFilename, readError);
                    this.setStatusMessage(`JSONファイル読み込みエラー: ${jsonFilename}`);
                }
            }

        } catch (error) {
            console.error('[TADjs] backgroundColor更新エラー:', error);
            this.setStatusMessage('背景色更新エラー');
        }
    }

    /**
     * 実身管理用セグメントのisFullscreenを更新
     * @param {string} fileId - ファイルID
     * @param {boolean} isFullscreen - 全画面表示フラグ
     */
    async updateFullscreenState(fileId, isFullscreen) {
        try {
            console.log('[TADjs] isFullscreen更新開始:', fileId, isFullscreen);

            // JSONファイル名を構築
            const jsonFilename = `${fileId}.json`;

            // Electron環境の場合、ファイルシステムから読み込んで更新
            if (this.isElectronEnv) {
                const dataBasePath = this.getDataBasePath();
                const jsonPath = path.join(dataBasePath, jsonFilename);

                // JSONファイルを読み込み
                try {
                    const jsonContent = fs.readFileSync(jsonPath, 'utf-8');
                    const metadata = JSON.parse(jsonContent);

                    // isFullscreenを更新
                    metadata.isFullscreen = isFullscreen;

                    // metadataにrealIdを設定
                    metadata.realId = fileId;

                    // JSONファイルに保存
                    const saved = await this.saveDataFile(jsonFilename, JSON.stringify(metadata, null, 2));
                    if (saved) {
                        console.log('[TADjs] isFullscreen更新成功:', jsonFilename);

                        // ファイル直接アクセス版では不要（ファイル保存のみ）
                        console.log('[TADjs] isFullscreenを更新:', fileId);

                        this.setStatusMessage(`全画面表示状態を更新しました: ${isFullscreen ? 'ON' : 'OFF'}`);
                    } else {
                        console.error('[TADjs] isFullscreen更新失敗:', jsonFilename);
                        this.setStatusMessage(`全画面表示状態更新エラー: ${jsonFilename}`);
                    }
                } catch (readError) {
                    console.error('[TADjs] JSONファイル読み込みエラー:', jsonFilename, readError);
                    this.setStatusMessage(`JSONファイル読み込みエラー: ${jsonFilename}`);
                }
            }

        } catch (error) {
            console.error('[TADjs] isFullscreen更新エラー:', error);
            this.setStatusMessage('全画面表示状態更新エラー');
        }
    }

    /**
     * 実身新規作成ハンドラー
     */
    async handleCreateRealObject(e) {
        if (!this.realObjectSystem) {
            console.error('[TADjs] 実身仮身システムが初期化されていません');
            return;
        }

        const { realName, initialXtad, messageId } = e.data;

        try {
            const realId = await this.realObjectSystem.createRealObject(realName, initialXtad);

            if (e.source) {
                e.source.postMessage({
                    type: 'real-object-created',
                    messageId: messageId,
                    realId: realId,
                    realName: realName
                }, '*');
            }

            console.log('[TADjs] 実身作成完了:', realId, realName);
        } catch (error) {
            console.error('[TADjs] 実身作成エラー:', error);
            if (e.source) {
                e.source.postMessage({
                    type: 'real-object-error',
                    messageId: messageId,
                    error: error.message
                }, '*');
            }
        }
    }

    /**
     * 仮身コピーハンドラー
     */
    async handleCopyVirtualObject(e) {
        if (!this.realObjectSystem) {
            console.error('[TADjs] 実身仮身システムが初期化されていません');
            return;
        }

        const { realId, messageId } = e.data;

        try {
            await this.realObjectSystem.copyVirtualObject(realId);

            // JSONファイルのrefCountも更新
            await this.updateJsonFileRefCount(realId);

            if (e.source) {
                e.source.postMessage({
                    type: 'virtual-object-copied',
                    messageId: messageId,
                    realId: realId
                }, '*');
            }

            console.log('[TADjs] 仮身コピー完了:', realId);
        } catch (error) {
            console.error('[TADjs] 仮身コピーエラー:', error);
            if (e.source) {
                e.source.postMessage({
                    type: 'real-object-error',
                    messageId: messageId,
                    error: error.message
                }, '*');
            }
        }
    }

    /**
     * 実身コピーハンドラー
     */
    async handleCopyRealObject(e) {
        if (!this.realObjectSystem) {
            console.error('[TADjs] 実身仮身システムが初期化されていません');
            return;
        }

        const { realId, messageId } = e.data;

        try {
            const newRealId = await this.realObjectSystem.copyRealObject(realId);

            if (e.source) {
                e.source.postMessage({
                    type: 'real-object-copied',
                    messageId: messageId,
                    oldRealId: realId,
                    newRealId: newRealId
                }, '*');
            }

            console.log('[TADjs] 実身コピー完了:', realId, '→', newRealId);
        } catch (error) {
            console.error('[TADjs] 実身コピーエラー:', error);
            if (e.source) {
                e.source.postMessage({
                    type: 'real-object-error',
                    messageId: messageId,
                    error: error.message
                }, '*');
            }
        }
    }

    /**
     * 仮身削除ハンドラー
     */
    async handleDeleteVirtualObject(e) {
        if (!this.realObjectSystem) {
            console.error('[TADjs] 実身仮身システムが初期化されていません');
            return;
        }

        const { realId, messageId } = e.data;

        try {
            await this.realObjectSystem.deleteVirtualObject(realId);

            // JSONファイルのrefCountも更新
            await this.updateJsonFileRefCount(realId);

            if (e.source) {
                e.source.postMessage({
                    type: 'virtual-object-deleted',
                    messageId: messageId,
                    realId: realId
                }, '*');
            }

            console.log('[TADjs] 仮身削除完了:', realId);
        } catch (error) {
            console.error('[TADjs] 仮身削除エラー:', error);
            if (e.source) {
                e.source.postMessage({
                    type: 'real-object-error',
                    messageId: messageId,
                    error: error.message
                }, '*');
            }
        }
    }

    /**
     * 実身読み込みハンドラー
     */
    async handleLoadRealObject(e) {
        if (!this.realObjectSystem) {
            console.error('[TADjs] 実身仮身システムが初期化されていません');
            return;
        }

        const { realId, messageId } = e.data;

        try {
            const realObject = await this.realObjectSystem.loadRealObject(realId);

            // プラグイン（editor.js）互換性のため、トップレベルにもデータを追加
            if (realObject.records && realObject.records.length > 0) {
                realObject.xtad = realObject.records[0].xtad;
                realObject.rawData = realObject.records[0].rawData;
                realObject.xmlData = realObject.records[0].xtad; // virtual-object-list用
            }

            // applistをトップレベルに追加（virtual-object-list用）
            if (realObject.metadata && realObject.metadata.applist) {
                realObject.applist = realObject.metadata.applist;
            }

            if (e.source) {
                e.source.postMessage({
                    type: 'real-object-loaded',
                    messageId: messageId,
                    realObject: realObject
                }, '*');
            }

            console.log('[TADjs] 実身読み込み完了:', realId);
        } catch (error) {
            console.error('[TADjs] 実身読み込みエラー:', error);

            if (e.source) {
                e.source.postMessage({
                    type: 'real-object-error',
                    messageId: messageId,
                    error: error.message
                }, '*');
            }
        }
    }

    /**
     * 実身保存ハンドラー
     */
    async handleSaveRealObject(e) {
        if (!this.realObjectSystem) {
            console.error('[TADjs] 実身仮身システムが初期化されていません');
            return;
        }

        const { realId, realObject, messageId } = e.data;

        try {
            await this.realObjectSystem.saveRealObject(realId, realObject);

            if (e.source) {
                e.source.postMessage({
                    type: 'real-object-saved',
                    messageId: messageId,
                    realId: realId
                }, '*');
            }

            console.log('[TADjs] 実身保存完了:', realId);
        } catch (error) {
            console.error('[TADjs] 実身保存エラー:', error);
            if (e.source) {
                e.source.postMessage({
                    type: 'real-object-error',
                    messageId: messageId,
                    error: error.message
                }, '*');
            }
        }
    }

    /**
     * 参照カウント0の実身一覧取得ハンドラー
     */
    async handleGetUnreferencedRealObjects(e) {
        if (!this.realObjectSystem) {
            console.error('[TADjs] 実身仮身システムが初期化されていません');
            return;
        }

        const { messageId } = e.data;

        try {
            const unreferencedObjects = await this.realObjectSystem.getUnreferencedRealObjects();

            if (e.source) {
                e.source.postMessage({
                    type: 'unreferenced-real-objects-response',
                    messageId: messageId,
                    success: true,
                    realObjects: unreferencedObjects
                }, '*');
            }

            console.log('[TADjs] 参照カウント0の実身一覧取得完了:', unreferencedObjects.length, '件');
        } catch (error) {
            console.error('[TADjs] 参照カウント0の実身一覧取得エラー:', error);
            if (e.source) {
                e.source.postMessage({
                    type: 'real-object-error',
                    messageId: messageId,
                    error: error.message
                }, '*');
            }
        }
    }

    /**
     * ファイルシステム再探索ハンドラー
     * （ファイル直接アクセス版では同期不要なので常に成功を返す）
     */
    async handleRescanFilesystem(e) {
        const { messageId } = e.data;

        try {
            // ファイル直接アクセスでは同期不要
            // ファイル数をカウントして返す
            let fileCount = 0;
            if (this.isElectronEnv) {
                const dataBasePath = this._basePath;
                const files = this.fs.readdirSync(dataBasePath);
                fileCount = files.filter(f => f.endsWith('.json')).length;
            }

            if (e.source) {
                e.source.postMessage({
                    type: 'rescan-filesystem-response',
                    messageId: messageId,
                    success: true,
                    syncCount: fileCount
                }, '*');
            }

            console.log('[TADjs] ファイルシステム再探索完了:', fileCount, '件（同期不要）');
        } catch (error) {
            console.error('[TADjs] ファイルシステム再探索エラー:', error);
            if (e.source) {
                e.source.postMessage({
                    type: 'rescan-filesystem-response',
                    messageId: messageId,
                    success: false,
                    error: error.message
                }, '*');
            }
        }
    }

    /**
     * 実身物理削除ハンドラー
     */
    async handlePhysicalDeleteRealObject(e) {
        if (!this.realObjectSystem) {
            console.error('[TADjs] 実身仮身システムが初期化されていません');
            return;
        }

        const { realId, messageId } = e.data;

        try {
            // 実身を削除
            await this.realObjectSystem.physicalDeleteRealObject(realId);

            // ファイルシステムから削除
            if (window.electronAPI && window.electronAPI.deleteFile) {
                const dataBasePath = this.getDataBasePath();
                const jsonFilePath = `${dataBasePath}/${realId}.json`;

                // JSONファイルを削除
                const jsonResult = await window.electronAPI.deleteFile(jsonFilePath);
                if (!jsonResult.success) {
                    console.warn('[TADjs] JSONファイル削除失敗:', jsonResult.error);
                }

                // XTADファイルを削除（複数のレコードがある可能性を考慮）
                for (let i = 0; i < 10; i++) {  // 最大10レコードまで試行
                    const xtadFilePath = `${dataBasePath}/${realId}_${i}.xtad`;
                    const xtadResult = await window.electronAPI.deleteFile(xtadFilePath);
                    if (!xtadResult.success && i === 0) {
                        // 最初のレコードが見つからない場合は警告
                        console.warn('[TADjs] XTADファイル削除失敗:', xtadResult.error);
                    }
                    // ファイルが見つからなくなったら終了
                    if (!xtadResult.success) {
                        break;
                    }
                }
            } else {
                console.warn('[TADjs] electronAPI.deleteFile が利用できません（ブラウザモード）');
            }

            if (e.source) {
                e.source.postMessage({
                    type: 'delete-real-object-response',
                    messageId: messageId,
                    success: true,
                    realId: realId
                }, '*');
            }

            console.log('[TADjs] 実身物理削除完了:', realId);
        } catch (error) {
            console.error('[TADjs] 実身物理削除エラー:', error);
            if (e.source) {
                e.source.postMessage({
                    type: 'delete-real-object-response',
                    messageId: messageId,
                    success: false,
                    error: error.message
                }, '*');
            }
        }
    }

    /**
     * JSONファイルのrefCountを更新
     * @param {string} realId - 実身ID
     */
    async updateJsonFileRefCount(realId) {
        try {
            // JSONファイル名
            const jsonFileName = `${realId}.json`;

            // 既存のJSONファイルを読み込む
            let jsonData = null;
            try {
                const jsonResult = await this.loadDataFile(this.getDataBasePath(), jsonFileName);
                if (jsonResult.success && jsonResult.data) {
                    jsonData = JSON.parse(jsonResult.data);
                }
            } catch (error) {
                console.warn('[TADjs] JSONファイル読み込みエラー:', jsonFileName, error);
            }

            // JSONデータが存在する場合のみrefCountを更新
            if (jsonData) {
                // refCountは既にJSONファイルにあるので、realObjectSystemで更新されたものを使用
                const realObject = await this.realObjectSystem.loadRealObject(realId);
                jsonData.refCount = realObject.metadata.refCount;

                // JSONファイルに保存
                await this.saveDataFile(jsonFileName, JSON.stringify(jsonData, null, 2));
                console.log('[TADjs] JSONファイルのrefCountを更新:', jsonFileName, 'refCount:', realObject.metadata.refCount);
            } else {
                console.warn('[TADjs] JSONファイルが見つかりません:', jsonFileName);
            }
        } catch (error) {
            console.error('[TADjs] JSONファイルrefCount更新エラー:', error);
        }
    }

    /**
     * 実身名変更ハンドラー
     */
    async handleRenameRealObject(e) {
        let { realId, currentName, messageId } = e.data;

        // realIdから_0.xtadなどを除去してベースIDのみにする
        realId = realId.replace(/_\d+\.xtad$/i, '');

        try {
            // ダイアログを表示して新しい実身名を入力
            const result = await this.showInputDialog(
                '実身名を入力してください',
                currentName,
                30,
                [
                    { label: '取消', value: 'cancel' },
                    { label: '決定', value: 'ok' }
                ],
                1 // デフォルトは「決定」ボタン
            );

            if (result.button === 'cancel' || !result.value) {
                // キャンセルされた
                if (e.source) {
                    e.source.postMessage({
                        type: 'real-object-renamed',
                        messageId: messageId,
                        success: false
                    }, '*');
                }
                return;
            }

            const newName = result.value;

            // JSONファイルを更新
            const jsonFileName = `${realId}.json`;
            const jsonResult = await this.loadDataFile(this.getDataBasePath(), jsonFileName);
            if (jsonResult.success && jsonResult.data) {
                const jsonData = JSON.parse(jsonResult.data);
                jsonData.name = newName;
                await this.saveDataFile(jsonFileName, JSON.stringify(jsonData, null, 2));
            }

            // XTADファイルを更新（filename属性を変更）
            const xtadFileName = `${realId}_0.xtad`;
            const xtadResult = await this.loadDataFile(this.getDataBasePath(), xtadFileName);
            if (xtadResult.success && xtadResult.data) {
                const newXtadContent = xtadResult.data.replace(
                    /filename="[^"]*"/,
                    `filename="${newName}"`
                );
                await this.saveDataFile(xtadFileName, newXtadContent);
                console.log('[TADjs] XTADファイルのfilename属性を更新:', xtadFileName);
            }

            // この実身を参照しているすべての仮身一覧XTADファイルを更新
            await this.updateLinkNamesInParentXtads(realId, newName);

            // 成功を通知
            if (e.source) {
                e.source.postMessage({
                    type: 'real-object-renamed',
                    messageId: messageId,
                    success: true,
                    newName: newName
                }, '*');
            }

            console.log('[TADjs] 実身名変更完了:', realId, currentName, '->', newName);
            this.setStatusMessage(`実身名を「${newName}」に変更しました`);
        } catch (error) {
            console.error('[TADjs] 実身名変更エラー:', error);
            if (e.source) {
                e.source.postMessage({
                    type: 'real-object-renamed',
                    messageId: messageId,
                    success: false,
                    error: error.message
                }, '*');
            }
        }
    }

    /**
     * 実身を参照しているすべての親XTADファイル内のリンク名を更新
     * @param {string} realId - 実身ID
     * @param {string} newName - 新しい実身名
     */
    async updateLinkNamesInParentXtads(realId, newName) {
        try {
            const basePath = this.getDataBasePath();

            // すべてのXTADファイルを検索
            const files = fs.readdirSync(basePath);
            const xtadFiles = files.filter(f => f.endsWith('_0.xtad'));

            console.log('[TADjs] リンク名更新対象XTADファイル数:', xtadFiles.length);

            for (const xtadFile of xtadFiles) {
                const xtadResult = await this.loadDataFile(basePath, xtadFile);
                if (!xtadResult.success || !xtadResult.data) continue;

                const content = xtadResult.data;

                // この実身を参照するlinkタグが存在するか確認
                const linkPattern = new RegExp(`<link[^>]*id="${realId}_0\\.xtad"[^>]*>([^<]*)</link>`, 'g');

                if (linkPattern.test(content)) {
                    // リンク名を更新
                    const updatedContent = content.replace(
                        new RegExp(`(<link[^>]*id="${realId}_0\\.xtad"[^>]*>)[^<]*(</link>)`, 'g'),
                        `$1${newName}$2`
                    );

                    // ファイルを保存
                    await this.saveDataFile(xtadFile, updatedContent);
                    console.log('[TADjs] リンク名を更新:', xtadFile, '->', newName);
                }
            }
        } catch (error) {
            console.error('[TADjs] リンク名更新エラー:', error);
        }
    }

    /**
     * 実身複製ハンドラー
     */
    async handleDuplicateRealObject(e) {
        if (!this.realObjectSystem) {
            console.error('[TADjs] 実身仮身システムが初期化されていません');
            return;
        }

        const { realId: fullRealId, messageId } = e.data;

        // 実身IDを抽出（_0.xtad を除去）
        let realId = fullRealId;
        if (realId.match(/_\d+\.xtad$/i)) {
            realId = realId.replace(/_\d+\.xtad$/i, '');
        }
        console.log('[TADjs] 実身ID抽出:', realId, 'フルID:', fullRealId);

        try {
            // 元の実身のメタデータを取得
            const sourceRealObject = await this.realObjectSystem.loadRealObject(realId);
            const defaultName = sourceRealObject.metadata.realName + 'のコピー';

            // 名前入力ダイアログを表示
            const result = await this.showInputDialog(
                '新しい実身の名称を入力してください',
                defaultName,
                30,
                [
                    { label: '取消', value: 'cancel' },
                    { label: '設定', value: 'ok' }
                ],
                1 // デフォルトは「設定」ボタン
            );

            // キャンセルされた場合
            if (result.button === 'cancel' || !result.value) {
                console.log('[TADjs] 実身複製がキャンセルされました');
                if (e.source) {
                    e.source.postMessage({
                        type: 'real-object-duplicated',
                        messageId: messageId,
                        success: false,
                        cancelled: true
                    }, '*');
                }
                return;
            }

            const newName = result.value;

            // RealObjectSystemの実身コピー機能を使用（再帰的コピー）
            const newRealId = await this.realObjectSystem.copyRealObject(realId);

            // 新しい実身のメタデータを取得
            const newRealObject = await this.realObjectSystem.loadRealObject(newRealId);

            // 名前を更新
            newRealObject.metadata.realName = newName;
            await this.realObjectSystem.saveRealObject(newRealId, newRealObject);

            // JSONファイルにもrefCountを書き込む
            await this.updateJsonFileRefCount(newRealId);

            // 成功を通知
            if (e.source) {
                e.source.postMessage({
                    type: 'real-object-duplicated',
                    messageId: messageId,
                    success: true,
                    newRealId: newRealId,
                    newName: newName
                }, '*');
            }

            console.log('[TADjs] 実身複製完了:', realId, '->', newRealId, '名前:', newName);
            this.setStatusMessage(`実身を複製しました: ${newName}`);
        } catch (error) {
            console.error('[TADjs] 実身複製エラー:', error);
            if (e.source) {
                e.source.postMessage({
                    type: 'real-object-duplicated',
                    messageId: messageId,
                    success: false,
                    error: error.message
                }, '*');
            }
        }
    }

    /**
     * 新たな実身に保存ハンドラー（非再帰的コピー）
     */
    async handleSaveAsNewRealObject(e) {
        if (!this.realObjectSystem) {
            console.error('[TADjs] 実身仮身システムが初期化されていません');
            return;
        }

        const { realId: fullRealId, messageId } = e.data;

        // realIdが未定義の場合はエラー
        if (!fullRealId) {
            console.error('[TADjs] realIdが未定義です:', e.data);
            if (e.source) {
                e.source.postMessage({
                    type: 'save-as-new-real-object-completed',
                    messageId: messageId,
                    success: false,
                    error: 'realIdが未定義です'
                }, '*');
            }
            return;
        }

        // 実身IDを抽出（_0.xtad を除去）
        let realId = fullRealId;
        if (realId.match(/_\d+\.xtad$/i)) {
            realId = realId.replace(/_\d+\.xtad$/i, '');
        }
        console.log('[TADjs] 実身ID抽出:', realId, 'フルID:', fullRealId);

        try {
            // 元の実身のメタデータを取得
            const sourceRealObject = await this.realObjectSystem.loadRealObject(realId);
            const defaultName = sourceRealObject.metadata.realName + 'のコピー';

            // 名前入力ダイアログを表示
            const result = await this.showInputDialog(
                '新しい実身の名称を入力してください',
                defaultName,
                30,
                [
                    { label: '取消', value: 'cancel' },
                    { label: '設定', value: 'ok' }
                ],
                1 // デフォルトは「設定」ボタン
            );

            // キャンセルされた場合
            if (result.button === 'cancel' || !result.value) {
                console.log('[TADjs] 新たな実身に保存がキャンセルされました');
                if (e.source) {
                    e.source.postMessage({
                        type: 'save-as-new-real-object-completed',
                        messageId: messageId,
                        success: false,
                        cancelled: true
                    }, '*');
                }
                return;
            }

            const newName = result.value;

            // RealObjectSystemの非再帰的実身コピー機能を使用
            const newRealId = await this.realObjectSystem.copyRealObjectNonRecursive(realId, newName);

            // JSONファイルにもrefCountを書き込む
            await this.updateJsonFileRefCount(newRealId);

            // 成功を通知（プラグイン側で仮身追加処理を行う）
            if (e.source) {
                e.source.postMessage({
                    type: 'save-as-new-real-object-completed',
                    messageId: messageId,
                    success: true,
                    newRealId: newRealId,
                    newName: newName
                }, '*');
            }

            console.log('[TADjs] 新たな実身に保存完了:', realId, '->', newRealId, '名前:', newName);
            this.setStatusMessage(`新しい実身に保存しました: ${newName}`);
        } catch (error) {
            console.error('[TADjs] 新たな実身に保存エラー:', error);
            if (e.source) {
                e.source.postMessage({
                    type: 'save-as-new-real-object-completed',
                    messageId: messageId,
                    success: false,
                    error: error.message
                }, '*');
            }
        }
    }

    /**
     * 仮身属性変更ハンドラー
     */
    async handleChangeVirtualObjectAttributes(e) {
        const { virtualObject, currentAttributes, selectedRatio, messageId } = e.data;

        try {
            // ダイアログHTML を生成
            const dialogHtml = this.createVirtualObjectAttributesDialogHtml(currentAttributes, selectedRatio);

            // ダイアログを表示
            const result = await this.showCustomDialog(
                dialogHtml,
                [
                    { label: '取消', value: 'cancel' },
                    { label: '決定', value: 'ok' }
                ],
                1 // デフォルトは「決定」ボタン
            );

            if (result.button === 'cancel') {
                // キャンセルされた
                if (e.source) {
                    e.source.postMessage({
                        type: 'virtual-object-attributes-changed',
                        messageId: messageId,
                        success: false
                    }, '*');
                }
                return;
            }

            // ダイアログから値を取得
            const attributes = this.extractVirtualObjectAttributesFromDialog(result.dialogElement);

            // 成功を通知
            if (e.source) {
                e.source.postMessage({
                    type: 'virtual-object-attributes-changed',
                    messageId: messageId,
                    success: true,
                    attributes: attributes
                }, '*');
            }

            console.log('[TADjs] 仮身属性変更完了:', attributes);
        } catch (error) {
            console.error('[TADjs] 仮身属性変更エラー:', error);
            if (e.source) {
                e.source.postMessage({
                    type: 'virtual-object-attributes-changed',
                    messageId: messageId,
                    success: false,
                    error: error.message
                }, '*');
            }
        }
    }

    /**
     * ウィンドウ設定更新ハンドラー
     */
    async handleUpdateWindowConfig(e) {
        const { fileId, windowConfig } = e.data;

        if (!fileId || !windowConfig) {
            console.error('[TADjs] ウィンドウ設定更新: fileIdまたはwindowConfigが不足');
            return;
        }

        try {
            // realIdを抽出（fileIdは{realId}_0.xtadの形式またはrealIdそのもの）
            const realId = fileId.replace(/_\d+\.xtad$/, '');

            // JSONファイルから実身データを読み込んで更新
            const jsonFileName = `${realId}.json`;
            const jsonResult = await this.loadDataFile(this.getDataBasePath(), jsonFileName);

            if (jsonResult.success && jsonResult.data) {
                const jsonData = JSON.parse(jsonResult.data);

                // windowConfigを更新
                if (!jsonData.window) {
                    jsonData.window = {};
                }
                if (windowConfig.pos) {
                    jsonData.window.pos = windowConfig.pos;
                }
                if (windowConfig.width !== undefined) {
                    jsonData.window.width = windowConfig.width;
                }
                if (windowConfig.height !== undefined) {
                    jsonData.window.height = windowConfig.height;
                }
                if (windowConfig.maximize !== undefined) {
                    jsonData.window.maximize = windowConfig.maximize;
                }

                // updateDateを更新
                jsonData.updateDate = new Date().toISOString();

                // JSONファイルに保存
                if (this.isElectronEnv) {
                    const saved = await this.saveDataFile(jsonFileName, JSON.stringify(jsonData, null, 2));
                    if (saved) {
                        console.log('[TADjs] ウィンドウ設定をJSONファイルに保存:', realId, windowConfig);
                    } else {
                        console.error('[TADjs] ウィンドウ設定のJSONファイル保存失敗:', jsonFileName);
                    }
                } else {
                    console.log('[TADjs] ブラウザ環境のためJSONファイル保存をスキップ:', realId);
                }
            } else {
                console.warn('[TADjs] ウィンドウ設定更新: JSONファイルが見つかりません:', jsonFileName);
            }
        } catch (error) {
            console.error('[TADjs] ウィンドウ設定更新エラー:', error);
        }
    }

    /**
     * 仮身属性変更ダイアログのHTMLを生成
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
                        </label>
                        <label class="vobj-attr-color-label">
                            <span>仮身文字</span>
                            <input type="text" id="chcol" value="${attrs.chcol}" class="vobj-attr-color-input">
                        </label>
                        <label class="vobj-attr-color-label">
                            <span>仮身背景</span>
                            <input type="text" id="tbcol" value="${attrs.tbcol}" class="vobj-attr-color-input">
                        </label>
                        <label class="vobj-attr-color-label last">
                            <span>表示領域背景</span>
                            <input type="text" id="bgcol" value="${attrs.bgcol}" class="vobj-attr-color-input">
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
            </script>
        `;
    }

    /**
     * ダイアログから仮身属性を抽出
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

// デスクトップ環境を初期化
// （tadjs-desktop.htmlで初期化する）