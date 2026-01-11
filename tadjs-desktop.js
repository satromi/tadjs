/**
 *
 *   Copyright [2025] [satromi]
 *
 *   Licensed under the Apache License, Version 2.0 (the "License");
 *   you may not use this file except in compliance with the License.
 *   You may obtain a copy of the License at
 *
 *       http://www.apache.org/licenses/LICENSE-2.0
 *
 *   Unless required by applicable law or agreed to in writing, software
 *   distributed under the License is distributed on an "AS IS" BASIS,
 *   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *   See the License for the specific language governing permissions and
 *   limitations under the License.
 *
 * TADjs Ver 0.32
 * ブラウザ上でBTRON風デスクトップ環境を再現

 * @link https://github.com/satromi/tadjs
 * @author satromi@gmail.com Tw  @satromi
 * @license https://www.apache.org/licenses/LICENSE-2.0 Apache-2.0
 */

const logger = window.getLogger('TADjs');

class TADjsDesktop {
    constructor() {
        // 注: windows, activeWindow, windowCounter, windowFocusHistoryは
        // WindowManager初期化後に参照が設定されます
        this.windows = null;
        this.activeWindow = null;
        this.windowCounter = 0;
        this.windowFocusHistory = null;
        // Canvas用の独立カウンタ（ウインドウカウンタと分離し最初のTADをcanvas-0にする）
        this.canvasCounter = 0;
        // 再利用可能なcanvas IDのプール
        this.availableCanvasIds = [];
        this.contextMenu = null;
        this.isDragging = false;
        this.isResizing = false;
        this.dragState = null;
        this.fileObjects = {}; // ファイルオブジェクトを保存
        this.maxFileCacheSize = 100; // ファイルキャッシュの上限数
        this.statusMessageTimer = null; // ステータスメッセージのタイマー
        this.statusTimeUpdateInterval = null; // 時刻更新用インターバル
        this.clipboard = null; // グローバルクリップボード（仮身データ）
        this.closeConfirmCallbacks = {}; // ウィンドウクローズ確認コールバック
        this.closingWindows = new Set(); // 現在クローズ処理中のウィンドウID（重複防止）
        this.openedRealObjects = new Map(); // 開いている実身ID -> ウィンドウIDのマッピング
        this.currentUser = null; // 現在の使用者名（xtad更新時のmakerフィールドに使用）

        // グローバルイベントハンドラー保存用（クリーンアップ時に使用）
        this.globalEventHandlers = {
            mousedown: null,
            mouseup: null,
            dragover: null,
            dragend: null,
            contextmenu: null,
            click: null,
            keydown: null,
            resize: null,
            message: null
        };

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

            // プログラムのベースパス（resources/app/）
            this._programBasePath = this._calculateBasePath();

            // システム設定ファイルのベースパス（実行ファイルと同じディレクトリ）
            this._systemConfigBasePath = this._calculateSystemConfigBasePath();

            // データフォルダ（init()で設定）
            this._basePath = null;

            logger.info(`[TADjs] Electron環境を検出: programBasePath=${this._programBasePath}, systemConfigBasePath=${this._systemConfigBasePath}`);
        } else {
            this.fs = null;
            this.path = null;
            this.process = null;
            this._programBasePath = '.';
            this._systemConfigBasePath = '.';
            this._basePath = '.';

            logger.info('[TADjs] ブラウザ環境を検出');
        }

        if (typeof window.MessageBus === 'undefined') {
            throw new Error('[TADjs] MessageBusが利用できません - アプリケーションを起動できません');
        }

        this.parentMessageBus = new window.MessageBus({
            debug: false,
            pluginName: 'TADjsDesktop',
            mode: 'parent'
        });
        this.parentMessageBus.start();
        logger.info('[TADjs] 親MessageBus初期化完了');

        // MessageRouter初期化（プラグインからのメッセージをルーティング）
        if (typeof window.MessageRouter !== 'undefined') {
            this.messageRouter = new window.MessageRouter(this);
            logger.info('[TADjs] MessageRouter初期化完了');
        } else {
            logger.warn('[TADjs] MessageRouterが利用できません');
            this.messageRouter = null;
        }

        // ScrollbarManager初期化
        if (typeof window.ScrollbarManager !== 'undefined') {
            this.scrollbarManager = new window.ScrollbarManager();
            logger.info('[TADjs] ScrollbarManager初期化完了');
        } else {
            logger.warn('[TADjs] ScrollbarManagerが利用できません');
            this.scrollbarManager = null;
        }

        // DialogManager初期化
        if (typeof window.DialogManager !== 'undefined') {
            this.dialogManager = new window.DialogManager(this.parentMessageBus);
            logger.info('[TADjs] DialogManager初期化完了');
        } else {
            logger.warn('[TADjs] DialogManagerが利用できません');
            this.dialogManager = null;
        }

        // WindowManager初期化
        if (typeof window.WindowManager !== 'undefined') {
            this.windowManager = new window.WindowManager({
                parentMessageBus: this.parentMessageBus,
                scrollbarManager: this.scrollbarManager,
                initScrollbar: this.initScrollbar.bind(this),
                forceUpdateScrollbar: this.forceUpdateScrollbar.bind(this),
                initScrollbarForPlugin: this.initScrollbarForPlugin.bind(this),
                initScrollbarForPluginWithMessageBus: this.initScrollbarForPluginWithMessageBus.bind(this),
                forceUpdateScrollbarForPlugin: this.forceUpdateScrollbarForPlugin.bind(this),
                getToolPanelRelations: () => this.toolPanelRelations
            });
            // WindowManagerの状態へ参照を設定（既存コードとの互換性のため）
            this.windows = this.windowManager.windows;
            this.windowFocusHistory = this.windowManager.windowFocusHistory;
            logger.info('[TADjs] WindowManager初期化完了');
        } else {
            logger.warn('[TADjs] WindowManagerが利用できません');
            this.windowManager = null;
            // フォールバック: 直接初期化
            this.windows = new Map();
            this.windowFocusHistory = [];
        }

        // ContextMenuManager初期化
        if (typeof window.ContextMenuManager !== 'undefined') {
            this.contextMenuManager = new window.ContextMenuManager({
                parentMessageBus: this.parentMessageBus,
                getWindows: () => this.windows,
                closeWindow: this.closeWindow.bind(this),
                setStatusMessage: this.setStatusMessage.bind(this),
                openVirtualObject: this.openVirtualObject.bind(this),
                showVirtualObjectProperties: this.showVirtualObjectProperties.bind(this),
                showFileProperties: this.showFileProperties.bind(this),
                togglePaperMode: this.togglePaperMode.bind(this),
                setDisplayMode: this.setDisplayMode.bind(this),
                toggleWrapAtWindowWidth: this.toggleWrapAtWindowWidth.bind(this),
                showWindowList: this.showWindowList.bind(this),
                clearDesktop: this.clearDesktop.bind(this),
                showSystemInfo: this.showSystemInfo.bind(this),
                showWindowProperties: this.showWindowProperties.bind(this),
                launchPluginForFile: this.launchPluginForFile.bind(this),
                openTADFile: this.openTADFile.bind(this),
                getFileObjects: () => this.fileObjects,
                getActiveWindow: () => this.activeWindow
            });
            logger.info('[TADjs] ContextMenuManager初期化完了');
        } else {
            logger.warn('[TADjs] ContextMenuManagerが利用できません');
            this.contextMenuManager = null;
        }

        // ToolPanelManager初期化
        if (typeof window.ToolPanelManager !== 'undefined') {
            this.toolPanelManager = new window.ToolPanelManager({
                parentMessageBus: this.parentMessageBus,
                createWindow: this.createWindow.bind(this),
                getWindows: () => this.windows
            });
            // ToolPanelManagerの状態へ参照を設定（既存コードとの互換性のため）
            this.toolPanelRelations = this.toolPanelManager.toolPanelRelations;
            logger.info('[TADjs] ToolPanelManager初期化完了');
        } else {
            logger.warn('[TADjs] ToolPanelManagerが利用できません');
            this.toolPanelManager = null;
            // フォールバック: 直接初期化
            this.toolPanelRelations = {};
        }

        // 子パネルウィンドウ管理
        this.childPanelRelations = {};

        // FileManager初期化
        if (typeof window.FileManager !== 'undefined') {
            this.fileManager = new window.FileManager({
                isElectronEnv: this.isElectronEnv,
                basePath: this._basePath,
                fs: this.fs,
                path: this.path,
                process: this.process
            });
            logger.info('[TADjs] FileManager初期化完了');
        } else {
            logger.warn('[TADjs] FileManagerが利用できません');
            this.fileManager = null;
        }

        // UISettingsManager初期化
        if (typeof window.UISettingsManager !== 'undefined') {
            this.uiSettingsManager = new window.UISettingsManager({
                parentMessageBus: this.parentMessageBus
            });
            logger.info('[TADjs] UISettingsManager初期化完了');
        } else {
            logger.warn('[TADjs] UISettingsManagerが利用できません');
            this.uiSettingsManager = null;
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

        // ContextMenuManager のイベントリスナーとハンドラーをセットアップ
        if (this.contextMenuManager) {
            this.contextMenuManager.setupEventListeners();
            this.contextMenuManager.setupMessageBusHandlers();
        }

        this.setupParentMessageBusHandlers();

        // 実身仮身システム初期化
        await this.initRealObjectSystem();

        // ファイルインポートマネージャー初期化
        this.fileImportManager = new window.FileImportManager(this);
        logger.info('[TADjs] FileImportManager初期化完了');

        // MessageRouterハンドラー登録
        this.registerMessageRouterHandlers();

        // プラグインマネージャーは既に初期化されているので、直接初期ウィンドウを作成
        this.createInitialWindow();

        logger.info('TADjs Desktop Environment initialized');
    }

    /**
     * 実身仮身システムを初期化
     */
    async initRealObjectSystem() {
        logger.info('[TADjs] initRealObjectSystem 開始');
        try {
            if (this.isElectronEnv) {
                // urlモジュールを読み込み（pathToFileURL用）
                const { pathToFileURL } = require('url');

                // 1. config.jsから設定を読み込む
                const configModulePath = this.path.join(this._programBasePath, 'js', 'config.js');
                logger.info('[TADjs] config.jsを読み込み:', configModulePath);

                const configModule = await import(pathToFileURL(configModulePath).href);
                const { CONFIG } = configModule;
                const systemConfigRealId = CONFIG.SYSTEM_CONFIG_REAL_ID;

                logger.info('[TADjs] システム設定実身ID:', systemConfigRealId);

                // 2. システム設定実身からデータフォルダを読み込む（実行ファイルと同じディレクトリ）
                const systemConfigXtadPath = this.path.join(this._systemConfigBasePath, `${systemConfigRealId}_0.xtad`);
                let dataFolder = null;

                if (this.fs.existsSync(systemConfigXtadPath)) {
                    try {
                        const configData = this.fs.readFileSync(systemConfigXtadPath, 'utf-8');
                        const match = configData.match(/data_folder\s+"([^"]+)"/);
                        if (match) {
                            dataFolder = match[1].replace(/\\/g, '/');
                            logger.info('[TADjs] データフォルダを設定ファイルから読み込み:', dataFolder);

                            // データフォルダのアクセス権限を検証
                            const folderAccessCheck = this.checkFolderAccess(dataFolder);
                            if (!folderAccessCheck.success) {
                                logger.error('[TADjs] データフォルダへのアクセスに失敗:', folderAccessCheck.error);
                                logger.warn('[TADjs] デフォルトフォルダ（プログラム配置場所）にフォールバック');
                                dataFolder = null; // フォールバック処理へ
                            }
                        }
                    } catch (error) {
                        logger.error('[TADjs] システム設定実身読み込みエラー:', error);
                        logger.warn('[TADjs] デフォルトフォルダを使用');
                    }
                } else {
                    logger.warn('[TADjs] システム設定実身が見つかりません:', systemConfigXtadPath);
                    logger.warn('[TADjs] 予めシステム設定実身を作成してください');
                }

                // 3. データフォルダが取得できなかった場合、デフォルトフォルダにフォールバック
                // 実行ファイルと同じディレクトリの data フォルダ
                if (!dataFolder) {
                    dataFolder = this.path.join(this._systemConfigBasePath, 'data');
                    logger.info('[TADjs] デフォルトデータフォルダを使用:', dataFolder);
                }

                // 4. データフォルダの存在確認と作成
                if (!this.fs.existsSync(dataFolder)) {
                    try {
                        logger.info('[TADjs] データフォルダが存在しないため作成:', dataFolder);
                        this.fs.mkdirSync(dataFolder, { recursive: true });
                    } catch (error) {
                        logger.error('[TADjs] データフォルダの作成に失敗:', error);
                        // 実行ファイルのディレクトリに最終フォールバック
                        dataFolder = this._systemConfigBasePath;
                        logger.warn('[TADjs] 最終フォールバック: 実行ファイルのディレクトリを使用:', dataFolder);
                    }
                }

                // 5. グローバルにデータフォルダを保存
                this._basePath = dataFolder;
                logger.info('[TADjs] データフォルダを設定:', this._basePath);

                // 5-2. FileManagerのbasePathを更新
                if (this.fileManager) {
                    this.fileManager.setDataBasePath(this._basePath);
                }

                // 6. RealObjectSystemを初期化（データフォルダを渡す）
                const systemModulePath = this.path.join(this._programBasePath, 'js', 'real-object-system.js');

                if (!this.fs.existsSync(systemModulePath)) {
                    throw new Error(`モジュールファイルが見つかりません: ${systemModulePath}`);
                }

                const module = await import(pathToFileURL(systemModulePath).href);
                const { RealObjectSystem } = module;

                this.realObjectSystem = new RealObjectSystem(dataFolder);
                logger.info('[TADjs] RealObjectSystem初期化完了、データフォルダ:', dataFolder);
            } else {
                // ブラウザ環境
                const { RealObjectSystem } = await import('./js/real-object-system.js');
                this.realObjectSystem = new RealObjectSystem();
            }

            logger.info('[TADjs] 実身仮身システム初期化完了（ファイル直接アクセスモード）');
            logger.info('[TADjs] this.realObjectSystem:', this.realObjectSystem ? 'OK' : 'NULL');
        } catch (error) {
            logger.error('[TADjs] 実身仮身システム初期化エラー:', error);
            logger.error('[TADjs] エラースタック:', error.stack);
            // エラーが発生してもアプリケーションは継続
        }
    }

    /**
     * データフォルダを設定
     * @param {Object} data - { dataFolder: string }
     * @param {Object} event - イベントオブジェクト
     */
    async handleSetDataFolder(data, event) {
        if (!data.dataFolder) {
            this.parentMessageBus.respondTo(event.source, 'data-folder-set-response', {
                messageId: data.messageId,
                success: false,
                error: 'データフォルダが指定されていません'
            });
            return;
        }

        try {
            // データフォルダの検証（絶対パスかチェック）
            if (!this.path.isAbsolute(data.dataFolder)) {
                throw new Error('データフォルダは絶対パスで指定してください');
            }

            // フォルダアクセス権限を検証
            const accessCheck = this.checkFolderAccess(data.dataFolder);
            if (!accessCheck.success) {
                throw new Error(accessCheck.error);
            }

            // config.jsから設定を読み込む
            const { pathToFileURL } = require('url');
            const configModulePath = this.path.join(this._programBasePath, 'js', 'config.js');
            const configModule = await import(pathToFileURL(configModulePath).href + '?t=' + Date.now()); // キャッシュ回避
            const { CONFIG } = configModule;
            const systemConfigRealId = CONFIG.SYSTEM_CONFIG_REAL_ID;

            // システム設定実身のパスを取得（実行ファイルと同じディレクトリ）
            const systemConfigMetadataPath = this.path.join(this._systemConfigBasePath, `${systemConfigRealId}.json`);
            const systemConfigDataPath = this.path.join(this._systemConfigBasePath, `${systemConfigRealId}_0.xtad`);

            // メタデータを読み込む（存在する場合）
            let metadata = null;
            if (this.fs.existsSync(systemConfigMetadataPath)) {
                metadata = JSON.parse(this.fs.readFileSync(systemConfigMetadataPath, 'utf-8'));
            } else {
                // システム設定実身が存在しない場合はエラー
                throw new Error('システム設定実身が見つかりません。予め作成してください。');
            }

            // 更新日時を更新
            metadata.updateDate = new Date().toISOString();
            metadata.accessDate = new Date().toISOString();

            // データを更新
            const configData = `data_folder "${data.dataFolder.replace(/\\/g, '/')}"`;

            // ファイル書き込み
            this.fs.writeFileSync(systemConfigMetadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
            this.fs.writeFileSync(systemConfigDataPath, configData, 'utf-8');

            logger.info('[TADjs] データフォルダを設定しました:', data.dataFolder);

            this.parentMessageBus.respondTo(event.source, 'data-folder-set-response', {
                messageId: data.messageId,
                success: true
            });
        } catch (error) {
            logger.error('[TADjs] データフォルダの設定に失敗:', error);
            this.parentMessageBus.respondTo(event.source, 'data-folder-set-response', {
                messageId: data.messageId,
                success: false,
                error: error.message
            });
        }
    }

    /**
     * 親MessageBusのハンドラを登録
     * プラグイン(iframe)からのメッセージを親ウィンドウ側で処理
     */
    setupParentMessageBusHandlers() {
        logger.info('[TADjs] 親MessageBusハンドラ登録開始');

        // activate-window: ウィンドウをアクティブ化
        this.parentMessageBus.on('activate-window', (_data, event) => {
            const windowId = this.parentMessageBus.getWindowIdFromSource(event.source);
            if (windowId) {
                this.setActiveWindow(windowId);
            } else {
                logger.warn('[TADjs] activate-window: windowIdが見つかりません');
            }
        });

        // toggle-maximize: ウィンドウの最大化切り替え
        this.parentMessageBus.on('toggle-maximize', (_data, event) => {
            const windowId = this.parentMessageBus.getWindowIdFromSource(event.source);
            if (windowId) {
                this.toggleMaximizeWindow(windowId);
            } else {
                logger.warn('[TADjs] toggle-maximize: windowIdが見つかりません');
            }
        });

        // close-window: ウィンドウを閉じる
        this.parentMessageBus.on('close-window', (data, event) => {
            let windowId = data.windowId;

            // windowIdが指定されていない場合は、送信元から取得
            if (!windowId) {
                windowId = this.parentMessageBus.getWindowIdFromSource(event.source);
            }

            if (windowId) {
                this.closeWindow(windowId);
            } else {
                logger.warn('[TADjs] close-window: windowIdが見つかりません');
            }
        });

        // child-drag-position: 子iframeからのドラッグ位置通知
        // ドラッグ中の表示/非表示制御のため、マウスがどのウィンドウ上にあるかを通知
        // z-index判定は行わず、単純な座標判定のみ（効率化のため）
        this.parentMessageBus.on('child-drag-position', (data) => {
            const clientX = data.clientX;
            const clientY = data.clientY;

            // すべての子ウィンドウに対して、マウスが自分の上にあるかを通知
            for (const [_id, childInfo] of this.parentMessageBus.children.entries()) {
                try {
                    const iframe = childInfo.iframe;
                    if (!iframe) continue;

                    const rect = iframe.getBoundingClientRect();
                    const isOverThisIframe = (
                        clientX >= rect.left && clientX <= rect.right &&
                        clientY >= rect.top && clientY <= rect.bottom
                    );

                    if (childInfo.windowId) {
                        // マウスがこのウィンドウ上にあるかを通知
                        // 座標変換してウィンドウ内相対座標も送る
                        const relativeX = clientX - rect.left;
                        const relativeY = clientY - rect.top;

                        this.parentMessageBus.sendToWindow(childInfo.windowId, 'parent-drag-position', {
                            isOverThisWindow: isOverThisIframe,
                            relativeX: relativeX,
                            relativeY: relativeY,
                            currentMouseOverWindowId: isOverThisIframe ? childInfo.windowId : null
                        });
                    }
                } catch (error) {
                    // エラーはスキップ
                }
            }
        });

        // get-drop-target-window: dragend時にどのウィンドウにドロップしたかを判定
        this.parentMessageBus.on('get-drop-target-window', (data, _source) => {
            const targetWindowId = this.getWindowAtPosition(data.clientX, data.clientY);

            logger.debug('[TADjs] ドロップ先ウィンドウ判定:', {
                clientX: data.clientX,
                clientY: data.clientY,
                targetWindowId: targetWindowId,
                requestFrom: data.sourceWindowId
            });

            // リクエスト元のウィンドウに結果を返す
            this.parentMessageBus.sendToWindow(data.sourceWindowId, 'drop-target-window-response', {
                sourceWindowId: data.sourceWindowId,
                targetWindowId: targetWindowId,
                clientX: data.clientX,
                clientY: data.clientY
            });
        });

        // scroll-state-update: プラグインからのスクロール状態更新
        this.parentMessageBus.on('scroll-state-update', (data) => {
            if (!data.windowId || !this.scrollbarManager) return;

            // スクロール状態をキャッシュに保存
            this.scrollbarManager.updateScrollState(data.windowId, {
                scrollTop: data.scrollTop,
                scrollLeft: data.scrollLeft,
                scrollHeight: data.scrollHeight,
                scrollWidth: data.scrollWidth,
                clientHeight: data.clientHeight,
                clientWidth: data.clientWidth
            });

            // 対応するウィンドウのスクロールバーUIを更新
            const windowInfo = this.windows.get(data.windowId);
            if (windowInfo && windowInfo.element) {
                const vScrollbar = windowInfo.element.querySelector('.custom-scrollbar-vertical');
                const hScrollbar = windowInfo.element.querySelector('.custom-scrollbar-horizontal');

                if (vScrollbar) {
                    this.scrollbarManager.updateScrollbarFromState(vScrollbar, 'vertical', data);
                }
                if (hScrollbar) {
                    this.scrollbarManager.updateScrollbarFromState(hScrollbar, 'horizontal', data);
                }
            }
        });

        // window-maximize-completed: CSSアニメーション完了後のスクロールバー最終更新
        this.parentMessageBus.on('window-maximize-completed', (data) => {
            if (!data.windowId) return;
            this.updateScrollbarsForWindow(data.windowId);
        });

        logger.info('[TADjs] 親MessageBusハンドラ登録完了');
    }

    /**
     * ベースパスを計算（private）
     */
    _calculateBasePath() {
        if (this.process.resourcesPath) {
            // パッケージ化されている場合: resources/app ディレクトリ
            return this.path.join(this.process.resourcesPath, 'app');
        } else {
            // 開発時: プロジェクトルート
            return this.path.dirname(require.main.filename);
        }
    }

    /**
     * システム設定ファイルのベースパスを計算（private）
     */
    _calculateSystemConfigBasePath() {
        if (this.process.resourcesPath) {
            // パッケージ化されている場合: 実行ファイルと同じディレクトリ
            return this.path.dirname(this.process.execPath);
        } else {
            // 開発時: プロジェクトルート
            return this.path.dirname(require.main.filename);
        }
    }

    /**
     * ベースパスを取得（FileManagerに委譲）
     * @returns {string} ベースパス
     */
    getDataBasePath() {
        if (this.fileManager) {
            return this.fileManager.getDataBasePath();
        }
        return this._basePath;
    }

    /**
     * 画像ファイルの絶対パスを取得（FileManagerに委譲）
     * @param {string} fileName - ファイル名
     * @returns {string} 絶対パス
     */
    getImageFilePath(fileName) {
        logger.debug('[TADjs] getImageFilePath呼び出し:', fileName, '_basePath:', this._basePath);
        if (this.fileManager) {
            const result = this.fileManager.getImageFilePath(fileName);
            logger.debug('[TADjs] FileManager経由の結果:', result);
            return result;
        }
        // フォールバック
        if (this.isElectronEnv) {
            const result = this.path.join(this._basePath, fileName);
            logger.debug('[TADjs] フォールバック結果:', result);
            return result;
        }
        return fileName;
    }

    /**
     * データファイルを読み込む（FileManagerに委譲）
     * @param {string} basePath - ベースパス
     * @param {string} fileName - ファイル名
     * @returns {Promise<{success: boolean, data?: string, error?: string}>}
     */
    async loadDataFile(basePath, fileName) {
        if (this.fileManager) {
            return await this.fileManager.loadDataFile(basePath, fileName);
        }
        logger.warn('[TADjs] FileManagerが利用できません');
        return { success: false, error: 'FileManagerが利用できません' };
    }

    /**
     * データファイルをFileオブジェクトとして読み込む（FileManagerに委譲）
     * @param {string} fileName - ファイル名
     * @returns {Promise<File|null>} Fileオブジェクト、見つからない場合null
     */
    async loadDataFileAsFile(fileName) {
        if (this.fileManager) {
            return await this.fileManager.loadDataFileAsFile(fileName);
        }
        logger.warn('[TADjs] FileManagerが利用できません');
        return null;
    }

    /**
     * ファイルオブジェクトまたはファイル情報からUint8Arrayを取得
     * File オブジェクトの場合は arrayBuffer() を使用
     * プレーンオブジェクト（path付き）の場合は fs で読み込む
     * @param {File|Object} file - File オブジェクトまたはファイル情報オブジェクト
     * @returns {Promise<Uint8Array>} ファイル内容
     */
    async getFileAsUint8Array(file) {
        if (file.base64Data) {
            // Base64エンコードされたデータが含まれる場合（インポートされたファイル）
            const binary = atob(file.base64Data);
            const len = binary.length;
            const uint8Array = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                uint8Array[i] = binary.charCodeAt(i);
            }
            return uint8Array;
        } else if (typeof file.arrayBuffer === 'function') {
            // File オブジェクトの場合
            const arrayBuffer = await file.arrayBuffer();
            return new Uint8Array(arrayBuffer);
        } else if (file.path && this.isElectronEnv) {
            // プレーンオブジェクト（Electron環境でpathが利用可能）の場合
            const fs = require('fs');
            const buffer = fs.readFileSync(file.path);
            return new Uint8Array(buffer);
        } else {
            throw new Error('ファイル内容を取得できません: arrayBuffer()もpathも利用できません');
        }
    }

    /**
     * 外部ファイルをOSのデフォルトアプリで開く
     * @param {string} realId - 実身ID
     * @param {string} extension - ファイル拡張子
     * @returns {Promise<{success: boolean, error?: string}>} 結果
     */
    /**
     * 外部ファイルをOSのデフォルトアプリで開く（FileManagerに委譲）
     * @param {string} realId - 実身ID
     * @param {string} extension - ファイル拡張子
     * @returns {Promise<{success: boolean, error?: string}>} 結果
     */
    async openExternalFile(realId, extension) {
        if (this.fileManager) {
            return await this.fileManager.openExternalFile(realId, extension);
        }
        logger.warn('[TADjs] FileManagerが利用できません');
        return { success: false, error: 'FileManagerが利用できません' };
    }

    /**
     * xtadファイルからテキストを読み取る（FileManagerに委譲）
     * @param {string} realId - 実身ID
     * @returns {Promise<{success: boolean, text?: string, error?: string}>} 結果
     */
    async readXtadText(realId) {
        if (this.fileManager) {
            return await this.fileManager.readXtadText(realId);
        }
        logger.warn('[TADjs] FileManagerが利用できません');
        return { success: false, error: 'FileManagerが利用できません' };
    }

    /**
     * URLをブラウザで開く（FileManagerに委譲）
     * @param {string} url - 開くURL
     * @returns {Promise<{success: boolean, error?: string}>} 結果
     */
    async openUrlExternal(url) {
        if (this.fileManager) {
            return await this.fileManager.openUrlExternal(url);
        }
        logger.warn('[TADjs] FileManagerが利用できません');
        return { success: false, error: 'FileManagerが利用できません' };
    }

    /**
     * フォルダへのアクセス権限を検証（FileManagerに委譲）
     * @param {string} folderPath - 検証するフォルダのパス
     * @returns {{success: boolean, error?: string}} 検証結果
     */
    checkFolderAccess(folderPath) {
        if (this.fileManager) {
            return this.fileManager.checkFolderAccess(folderPath);
        }
        logger.warn('[TADjs] FileManagerが利用できません');
        return { success: false, error: 'FileManagerが利用できません' };
    }

    /**
     * アイコンファイルのパスを取得する（FileManagerに委譲）
     * @param {string} realId - 実身ID
     * @returns {Promise<{success: boolean, filePath?: string, error?: string}>} アイコンファイルのパス
     */
    async readIconFile(realId) {
        if (this.fileManager) {
            return await this.fileManager.readIconFile(realId);
        }
        logger.warn('[TADjs] FileManagerが利用できません');
        return { success: false, error: 'FileManagerが利用できません' };
    }

    /**
     * データファイルを保存する（FileManagerに委譲）
     * @param {string} fileName - ファイル名
     * @param {string|ArrayBuffer|Uint8Array} data - 保存するデータ
     * @returns {Promise<boolean>} 成功した場合true
     */
    async saveDataFile(fileName, data) {
        if (this.fileManager) {
            return await this.fileManager.saveDataFile(fileName, data);
        }
        logger.warn('[TADjs] FileManagerが利用できません');
        return false;
    }

    /**
     * プラグインマネージャーの初期化を待ってから初期ウィンドウを作成
     */
    waitForPluginManagerAndCreateWindow() {
        // プラグインマネージャーの初期化完了イベントを待つ
        window.addEventListener('plugin-manager-ready', (e) => {
            if (this.initialWindowCreated) {
                logger.info('[TADjs] 初期ウィンドウは既に作成済みです');
                return;
            }
            logger.info('[TADjs] プラグインマネージャー初期化完了:', e.detail.pluginCount, '個のプラグイン登録');
            this.initialWindowCreated = true;
            this.createInitialWindow();
        }, { once: true });

        // タイムアウト処理（10秒待ってもイベントが来ない場合）
        setTimeout(() => {
            if (this.initialWindowCreated) {
                logger.info('[TADjs] 初期ウィンドウは既に作成済みです（タイムアウト処理）');
                return;
            }
            if (window.pluginManager && window.pluginManager.plugins.size > 0) {
                logger.warn('[TADjs] プラグインマネージャーイベントを待機中にタイムアウト、強制実行します');
                this.initialWindowCreated = true;
                this.createInitialWindow();
            }
        }, window.DIALOG_TIMEOUT_MS);
    }

    /**
     * 保存された背景設定を読み込んで適用（UISettingsManagerに委譲）
     */
    loadSavedBackground() {
        if (this.uiSettingsManager) {
            this.uiSettingsManager.loadSavedBackground();
        } else {
            logger.warn('[TADjs] UISettingsManagerが利用できません');
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

        logger.debug('[TADjs] デフォルトウィンドウを仮身一覧プラグインで開きます');
        logger.debug('[TADjs] 実身ファイル:', defaultJsonFile, defaultXtadFile);

        // データファイルのベースパスを取得
        const dataBasePath = this.getDataBasePath();
        logger.debug('[TADjs] データファイルのベースパス:', dataBasePath);

        // 仮身一覧プラグインを起動
        if (window.pluginManager) {
            const virtualObjectListPlugin = window.pluginManager.getPlugin('virtual-object-list');
            if (virtualObjectListPlugin) {
                try {
                    // JSONファイルを読み込む
                    logger.debug('[TADjs] JSONファイルを読み込み中:', defaultJsonFile);
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
                        logger.debug('[TADjs] JSONファイル読み込み成功:', { name: fileName, window: windowConfig, backgroundColor: backgroundColor, isFullscreen: isFullscreen });
                    } else {
                        logger.warn('[TADjs] JSONファイル読み込み失敗:', jsonResponse.error);
                    }

                    // XTADファイルを読み込む
                    logger.debug('[TADjs] XTADファイルを読み込み中:', defaultXtadFile);
                    const xtadResponse = await this.loadDataFile(dataBasePath, defaultXtadFile);

                    let xmlData = null;
                    if (xtadResponse.success) {
                        xmlData = xtadResponse.data;
                        logger.debug('[TADjs] XTADファイル読み込み成功 (length:', xmlData.length, ')');
                    } else {
                        logger.warn('[TADjs] XTADファイル読み込み失敗:', xtadResponse.error, '- 空のデータで起動します');
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
                    logger.debug('[TADjs] 仮身一覧プラグインで初期ウィンドウを開きました');

                    // ウィンドウのアイコンを設定
                    if (windowId) {
                        const iconPath = `${defaultFileId}.ico`;
                        setTimeout(() => {
                            this.setWindowIcon(windowId, iconPath);
                        }, window.ICON_SET_DELAY_MS);
                    }
                } catch (error) {
                    logger.error('[TADjs] ファイル読み込みエラー:', error);
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
                logger.error('[TADjs] 仮身一覧プラグインが見つかりません');
                this.createFallbackWindow();
            }
        } else {
            logger.error('[TADjs] プラグインマネージャーが初期化されていません');
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
            // リクエスト-レスポンス型（ハンドラー内で手動レスポンスを返す）
            // 注: messageId を使った特殊なレスポンス形式が必要なため、autoResponse は使わない
            'create-real-object': { handler: 'handleCreateRealObject', async: true },
            'copy-virtual-object': { handler: 'handleCopyVirtualObject', async: true },
            'copy-real-object': { handler: 'handleCopyRealObject', async: true },
            'delete-virtual-object': { handler: 'handleDeleteVirtualObject', async: true },
            'load-real-object': { handler: 'handleLoadRealObject', async: true },
            'save-real-object': { handler: 'handleSaveRealObject', async: true },
            'get-unreferenced-real-objects': { handler: 'handleGetUnreferencedRealObjects', async: true },
            'rescan-filesystem': { handler: 'handleRescanFilesystem', async: true },
            'physical-delete-real-object': { handler: 'handlePhysicalDeleteRealObject', async: true },

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
            'get-current-user': { handler: (_, e) => this.handleGetCurrentUser(e) },
            'import-files': { handler: 'handleImportFiles', async: true },
            'save-calc-image-file': { handler: 'handleSaveCalcImageFile', async: true },
            'delete-image-file': { handler: 'handleDeleteImageFile', async: true },
            // 仮身ネットワーク用ハンドラ
            'get-real-object-info': { handler: 'handleGetRealObjectInfo', async: true },
            'get-virtual-objects-from-real': { handler: 'handleGetVirtualObjectsFromReal', async: true },
            // 実身/仮身検索用ハンドラ
            'search-real-objects': { handler: 'handleSearchRealObjects', async: true },
            'abort-search': { handler: 'handleAbortSearch', async: false },
            // 原紙アイコンコピー用ハンドラ
            'copy-template-icon': { handler: 'handleCopyTemplateIcon', async: true },
        };
    }

    setupEventListeners() {
        // メッセージハンドラーマッピングを初期化
        this.initMessageHandlers();

        // 既存リスナーを削除（再初期化時のメモリリーク防止）
        this.removeEventListeners();

        // ハンドラー参照を保持（後で削除可能にするため）
        this._mousedownHandler = (e) => {
            if (e.target === document.getElementById('desktop')) {
                this.setActiveWindow(null);
            }
        };

        this._mouseupHandler = () => {
            this.parentMessageBus.broadcast('parent-mouseup');
        };

        this._dragoverHandler = (e) => {
            e.preventDefault();

            // ドラッグ位置にあるウィンドウを検出してdropEffectを設定
            const x = e.clientX;
            const y = e.clientY;
            const windows = Array.from(document.querySelectorAll('.window')).reverse(); // z-indexの高い順

            for (const win of windows) {
                const rect = win.getBoundingClientRect();
                if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
                    // ウィンドウ上にあればドロップを許可
                    e.dataTransfer.dropEffect = e.dataTransfer.effectAllowed === 'move' ? 'move' : 'copy';
                    return;
                }
            }

            // デスクトップ上もドロップを許可（ファイル取り込み用）
            e.dataTransfer.dropEffect = 'copy';
        };

        this._dragendHandler = () => {
            this.parentMessageBus.broadcast('parent-dragend');
        };

        this._keydownHandler = (e) => {
            this.handleKeyboardShortcuts(e);
        };

        this._resizeHandler = () => {
            this.handleWindowResize();
        };

        this._messageHandler = async (e) => {
            await this.handleMessage(e);
        };

        // デスクトップクリックでアクティブウインドウを解除
        document.addEventListener('mousedown', this._mousedownHandler);

        // mouseupイベントを全てのiframeに通知（ドラッグ終了検知用）
        document.addEventListener('mouseup', this._mouseupHandler);

        // dragover/dragendイベントを全てのiframeに通知
        // 注: iframe内でのドラッグ位置追跡は child-drag-position メッセージで行うため、
        // ここではtrackDragOverIframes()を呼ばない
        document.addEventListener('dragover', this._dragoverHandler);

        document.addEventListener('dragend', this._dragendHandler);

        // キーボードショートカット
        document.addEventListener('keydown', this._keydownHandler);

        // リサイズイベント
        window.addEventListener('resize', this._resizeHandler);

        // プラグインからのメッセージを受信
        window.addEventListener('message', this._messageHandler);
    }

    /**
     * イベントリスナーを削除（再初期化時のメモリリーク防止）
     */
    removeEventListeners() {
        if (this._mousedownHandler) {
            document.removeEventListener('mousedown', this._mousedownHandler);
        }
        if (this._mouseupHandler) {
            document.removeEventListener('mouseup', this._mouseupHandler);
        }
        if (this._dragoverHandler) {
            document.removeEventListener('dragover', this._dragoverHandler);
        }
        if (this._dragendHandler) {
            document.removeEventListener('dragend', this._dragendHandler);
        }
        if (this._keydownHandler) {
            document.removeEventListener('keydown', this._keydownHandler);
        }
        if (this._resizeHandler) {
            window.removeEventListener('resize', this._resizeHandler);
        }
        if (this._messageHandler) {
            window.removeEventListener('message', this._messageHandler);
        }
    }

    /**
     * メッセージイベントハンドラー（setupEventListenersから抽出）
     */
    async handleMessage(e) {
        // ===== MessageRouter優先処理 =====
        if (this.messageRouter) {
            const handled = await this.messageRouter.route(e);
            if (handled) {
                return; // MessageRouterで処理された場合は終了
            }
        }

        // ===== 既存のif-elseチェーン =====
        // ===== 特殊フラグ系 (fromEditor, fromToolPanel) は個別処理を維持 =====
        if (e.data && e.data.fromEditor) {
            // エディタからのメッセージを道具パネルに中継
            logger.debug('[TADjs] エディタメッセージを中継:', e.data.type);

            // 送信元のiframeから編集ウィンドウを特定
            if (e.source && e.source.frameElement) {
                const editorIframe = e.source.frameElement;
                const editorWindow = editorIframe.closest('.window');

                if (editorWindow && this.toolPanelRelations) {
                    // この編集ウィンドウに対応する道具パネルを探す
                    for (const [toolPanelWindowId, relation] of Object.entries(this.toolPanelRelations)) {
                        if (relation.editorIframe === editorIframe) {
                            const toolPanelWindow = document.getElementById(toolPanelWindowId);
                            if (!toolPanelWindow) {
                                // 道具パネルウィンドウが見つからない場合はスキップ
                                continue;
                            }
                            const toolPanelIframe = toolPanelWindow.querySelector('iframe');

                            if (toolPanelIframe && toolPanelIframe.contentWindow) {
                                const windowId = this.parentMessageBus.getWindowIdFromIframe(toolPanelIframe);
                                if (windowId) {
                                    // fromEditorフラグを除去してから道具パネルに中継
                                    const { fromEditor, ...messageData } = e.data;
                                    this.parentMessageBus.sendToWindow(windowId, messageData.type, messageData);
                                    logger.debug('[TADjs] メッセージを道具パネルに送信:', messageData.type);
                                }
                            }
                            break;
                        }
                    }
                }
            }
        } else if (e.data && e.data.fromToolPanel) {
            // 道具パネルからのメッセージ処理

            // 道具パネルからのメッセージを編集ウィンドウに中継（汎用）
            logger.debug('[TADjs] 道具パネルメッセージを中継:', e.data.type);

            // 送信元のiframeから道具パネルウィンドウを特定
            if (e.source && e.source.frameElement) {
                const toolPanelIframe = e.source.frameElement;
                const toolPanelWindow = toolPanelIframe.closest('.window');

                if (toolPanelWindow && this.toolPanelRelations) {
                    const windowId = toolPanelWindow.id;
                    const relation = this.toolPanelRelations[windowId];

                    if (relation && relation.editorIframe && relation.editorIframe.contentWindow) {
                        const editorWindowId = this.parentMessageBus.getWindowIdFromIframe(relation.editorIframe);
                        if (editorWindowId) {
                            // fromToolPanelフラグを除去してから編集ウィンドウに中継
                            const { fromToolPanel, ...messageData } = e.data;
                            this.parentMessageBus.sendToWindow(editorWindowId, messageData.type, messageData);
                            logger.debug('[TADjs] メッセージを編集ウィンドウに送信:', messageData.type);
                        }
                    } else {
                        logger.warn('[TADjs] 中継失敗: relation or editorIframe not found', {
                            hasRelation: !!relation,
                            hasEditorIframe: !!relation?.editorIframe,
                            hasContentWindow: !!relation?.editorIframe?.contentWindow
                        });
                    }
                } else {
                    logger.warn('[TADjs] 中継失敗: toolPanelWindow or toolPanelRelations not found');
                }
            } else {
                logger.warn('[TADjs] 中継失敗: e.source or frameElement not found');
            }
        } else if (e.data && e.data.fromMaterialPanel) {
            // 画材パネルからのメッセージ処理
            // 親エディタウィンドウに中継

            if (e.source && e.source.frameElement) {
                const materialPanelIframe = e.source.frameElement;
                const materialPanelWindow = materialPanelIframe.closest('.window');

                if (materialPanelWindow && this.childPanelRelations) {
                    const windowId = materialPanelWindow.id;
                    const relation = this.childPanelRelations[windowId];

                    if (relation && relation.parentWindowId) {
                        const parentWindow = document.getElementById(relation.parentWindowId);
                        if (parentWindow) {
                            const parentIframe = parentWindow.querySelector('iframe');
                            if (parentIframe && parentIframe.contentWindow) {
                                // fromMaterialPanelフラグを維持して親ウィンドウに中継
                                parentIframe.contentWindow.postMessage(e.data, '*');
                            }
                        }
                    }
                }
            }
        } else if (e.data && e.data.type && this.messageHandlers && this.messageHandlers[e.data.type]) {
            // 汎用メッセージハンドラー（フォールバック）
            const handlerDef = this.messageHandlers[e.data.type];
            logger.debug('[TADjs] 汎用ハンドラー実行:', e.data.type);

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
                    this.parentMessageBus.respondTo(e.source, e.data.type + '-response', {
                        messageId: e.data.messageId,
                        result: result
                    });
                }
            } catch (error) {
                logger.error(`[TADjs] ${e.data.type}処理エラー:`, error);
                if (handlerDef.autoResponse && e.source) {
                    this.parentMessageBus.respondTo(e.source, e.data.type + '-response', {
                        messageId: e.data.messageId,
                        error: error.message
                    });
                }
            }
        }
    }

    /**
     * 指定された座標にあるウィンドウIDを取得（z-index考慮）
     * @param {number} clientX - マウスのX座標（親ウィンドウ座標系）
     * @param {number} clientY - マウスのY座標（親ウィンドウ座標系）
     * @returns {string|null} - ウィンドウID、見つからない場合はnull
     */
    getWindowAtPosition(clientX, clientY) {
        let candidateWindows = [];

        for (const [id, childInfo] of this.parentMessageBus.children.entries()) {
            try {
                const iframe = childInfo.iframe;
                if (!iframe) continue;

                const rect = iframe.getBoundingClientRect();
                const isOverThisIframe = (
                    clientX >= rect.left && clientX <= rect.right &&
                    clientY >= rect.top && clientY <= rect.bottom
                );

                if (isOverThisIframe && childInfo.windowId) {
                    // ウィンドウ要素を取得してz-indexを確認
                    const windowElement = iframe.closest('.window');
                    const zIndex = windowElement ? (parseInt(getComputedStyle(windowElement).zIndex) || 0) : 0;

                    candidateWindows.push({
                        windowId: childInfo.windowId,
                        zIndex: zIndex
                    });
                }
            } catch (error) {
                // エラーはスキップ
            }
        }

        // z-indexが最も高いウィンドウを選択（降順ソート）
        if (candidateWindows.length > 0) {
            candidateWindows.sort((a, b) => b.zIndex - a.zIndex);

            // デバッグ: 複数のウィンドウが重なっている場合のみログ出力
            if (candidateWindows.length > 1) {
                logger.debug('[TADjs] 複数ウィンドウが重なっています:', candidateWindows.map(w => `${w.windowId}(z:${w.zIndex})`).join(', '), '選択:', candidateWindows[0].windowId);
            }

            return candidateWindows[0].windowId;
        }

        return null;
    }

    /**
     * ドラッグ中のマウス位置を追跡し、どのiframeの上にあるかを各iframeに通知
     * @deprecated 頻繁な呼び出しは非効率なため、dragend時のgetWindowAtPosition()を使用すること
     * @param {number} clientX - マウスのX座標（親ウィンドウ座標系）
     * @param {number} clientY - マウスのY座標（親ウィンドウ座標系）
     */
    trackDragOverIframes(clientX, clientY) {
        // まず、現在マウスがどのウィンドウ上にあるかを特定
        // ウィンドウが重なっている場合は、z-indexが最も高い（最前面の）ウィンドウを選択
        let currentMouseOverWindowId = null;
        let candidateWindows = [];

        for (const [id, childInfo] of this.parentMessageBus.children.entries()) {
            try {
                const iframe = childInfo.iframe;
                if (!iframe) continue;

                const rect = iframe.getBoundingClientRect();
                const isOverThisIframe = (
                    clientX >= rect.left && clientX <= rect.right &&
                    clientY >= rect.top && clientY <= rect.bottom
                );

                if (isOverThisIframe && childInfo.windowId) {
                    // ウィンドウ要素を取得してz-indexを確認
                    const windowElement = iframe.closest('.window');
                    const zIndex = windowElement ? (parseInt(getComputedStyle(windowElement).zIndex) || 0) : 0;

                    candidateWindows.push({
                        windowId: childInfo.windowId,
                        zIndex: zIndex
                    });
                }
            } catch (error) {
                // エラーはスキップ
            }
        }

        // z-indexが最も高いウィンドウを選択（降順ソート）
        if (candidateWindows.length > 0) {
            candidateWindows.sort((a, b) => b.zIndex - a.zIndex);
            currentMouseOverWindowId = candidateWindows[0].windowId;

            // デバッグ: 複数のウィンドウが重なっている場合のみログ出力
            if (candidateWindows.length > 1) {
                logger.debug('[TADjs] 複数ウィンドウが重なっています:', candidateWindows.map(w => `${w.windowId}(z:${w.zIndex})`).join(', '), '選択:', currentMouseOverWindowId);
            }
        }

        // MessageBusに登録された各子iframeに通知
        for (const [id, childInfo] of this.parentMessageBus.children.entries()) {
            try {
                const iframe = childInfo.iframe;
                if (!iframe) continue;

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

                // 各iframeに個別のデータを送信（現在マウスがあるウィンドウIDも含める）
                this.parentMessageBus.sendToChild(id, 'parent-drag-position', {
                    isOverThisWindow: isOverThisIframe,
                    currentMouseOverWindowId: currentMouseOverWindowId,  // 追加: 現在マウスがあるウィンドウID
                    clientX: clientX,
                    clientY: clientY,
                    relativeX: relativeX,
                    relativeY: relativeY
                });
            } catch (error) {
                // エラーはスキップ
            }
        }
    }

    /**
     * ステータスバーをセットアップして時刻表示を開始（UISettingsManagerに委譲）
     */
    setupStatusBar() {
        if (this.uiSettingsManager) {
            this.uiSettingsManager.setupStatusBar();
        } else {
            logger.warn('[TADjs] UISettingsManagerが利用できません');
        }
    }

    /**
     * ステータスバーの時刻表示を更新（UISettingsManagerに委譲）
     */
    updateStatusTime() {
        if (this.uiSettingsManager) {
            this.uiSettingsManager.updateStatusTime();
        }
    }

    /**
     * ステータスメッセージを表示（UISettingsManagerに委譲）
     * @param {string} message - 表示するメッセージ
     */
    setStatusMessage(message) {
        if (this.uiSettingsManager) {
            this.uiSettingsManager.setStatusMessage(message);
        }
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
                logger.debug('[TADjs] Drop zone not found - デフォルトウィンドウは仮身一覧プラグインです');
                return;
            }
            
            // より広い範囲でドロップを受け付ける
            const setupDropEvents = (element) => {
                element.addEventListener('dragenter', (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropZone.classList.add('drop-zone-active');
                logger.debug('Drag enter detected');
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
                if (dropZone) {
                    dropZone.classList.remove('drop-zone-hover');
                    dropZone.classList.remove('drop-zone-active');
                }

                logger.debug('[TADjs] Drop event on element:', element.id, e.dataTransfer);

                // 原紙箱からのドラッグデータをチェック
                const textData = e.dataTransfer.getData('text/plain');
                if (textData) {
                    try {
                        const dragData = JSON.parse(textData);

                        // 仮身ドラッグの場合は、documentのdropハンドラーに処理を委譲
                        if (dragData.type === 'virtual-object-drag') {
                            logger.debug('[TADjs] 仮身ドラッグを検出、documentハンドラーに委譲');
                            return; // stopPropagation()を呼ばずにreturn
                        }

                        if (dragData.type === 'base-file-copy' || dragData.type === 'user-base-file-copy') {
                            logger.debug('[TADjs] 原紙箱からのドロップ:', dragData);
                            e.stopPropagation();
                            this.handleBaseFileDrop(dragData, e);
                            return false;
                        }
                    } catch (_err) {
                        // JSONパースエラー - 通常のテキストとして扱う
                    }
                }

                const files = Array.from(e.dataTransfer.files);
                if (files.length > 0) {
                    logger.debug(`Dropped ${files.length} files:`, files);
                    e.stopPropagation();
                    this.handleFilesDrop(files);
                    return false;
                }

                // URLドロップをチェック（ブラウザからのURLドラッグ）
                const uriList = e.dataTransfer.getData('text/uri-list');
                const plainText = e.dataTransfer.getData('text/plain');
                console.log('[TADjs] setupDropEvents - uriList:', uriList, 'plainText:', plainText);
                console.log('[TADjs] setupDropEvents - dataTransfer.types:', Array.from(e.dataTransfer.types));

                let droppedUrl = null;
                if (uriList) {
                    const urls = uriList.split('\n')
                        .map(line => line.trim())
                        .filter(line => line && !line.startsWith('#'));
                    if (urls.length > 0) {
                        droppedUrl = urls[0];
                    }
                } else if (plainText && /^https?:\/\/.+/i.test(plainText.trim())) {
                    droppedUrl = plainText.trim();
                }

                if (droppedUrl) {
                    console.log('[TADjs] setupDropEvents - URLドロップ検出:', droppedUrl);
                    // desktopへのドロップはデフォルト位置（100, 100）を使用
                    this.handleUrlDrop(droppedUrl, null, 100, 100);
                    e.stopPropagation();
                    return false;
                }

                logger.debug('No files or URL in drop event');
                return false;
            });
        };

            // ドロップゾーンとデスクトップ全体でイベントを設定
            setupDropEvents(dropZone);
            setupDropEvents(desktop);
            
            // ドキュメント全体でもドラッグイベントをキャンセル（ブラウザのデフォルト動作を防ぐ）
            // dragenterとdragoverでdropEffectを設定しないと外部からのドロップが受け付けられない
            document.addEventListener('dragenter', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                return false;
            });

            document.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                return false;
            });
            
            document.addEventListener('drop', (e) => {
                console.log('[TADjs] Document drop event fired at:', e.clientX, e.clientY);

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
                console.log('[TADjs] targetWindow:', targetWindow ? targetWindow.id : 'なし');

                // ターゲットウィンドウ内のiframeを取得
                if (targetWindow) {
                    const iframe = targetWindow.querySelector('iframe');
                    console.log('[TADjs] iframe:', iframe ? '存在' : 'なし');
                    if (iframe && iframe.contentWindow) {
                        logger.debug('[TADjs] iframe上でのドロップを検出、iframeにデータを転送:', targetWindow.id);

                        // iframeの座標系に変換（URLドロップでも使用するため先に計算）
                        const iframeRect = iframe.getBoundingClientRect();
                        const iframeX = dropX - iframeRect.left;
                        const iframeY = dropY - iframeRect.top;
                        const windowId = this.parentMessageBus.getWindowIdFromIframe(iframe);

                        // ドロップデータを取得
                        const textData = e.dataTransfer.getData('text/plain');
                        console.log('[TADjs] textData:', textData ? textData.substring(0, 100) : 'なし');

                        // iframeにpostMessageでドロップイベントを転送
                        if (textData) {
                            try {
                                const dragData = JSON.parse(textData);
                                console.log('[TADjs] dragData.type:', dragData.type);

                                // 原紙箱からのドロップの場合は handleBaseFileDrop() で処理
                                if (dragData.type === 'base-file-copy' || dragData.type === 'user-base-file-copy') {
                                    console.log('[TADjs] iframe上への原紙ドロップ検出:', dragData.type);
                                    // 擬似メッセージイベントを作成（handleBaseFileDropが期待する形式）
                                    const pseudoMessageEvent = {
                                        source: iframe.contentWindow,
                                        data: {
                                            dropPosition: { x: iframeX, y: iframeY },
                                            clientX: iframeX,
                                            clientY: iframeY
                                        }
                                    };
                                    this.handleBaseFileDrop(dragData, pseudoMessageEvent);
                                    e.preventDefault();
                                    return false;
                                }

                                // iframe内のドロップイベントとして転送
                                if (windowId) {
                                    this.parentMessageBus.sendToWindow(windowId, 'parent-drop-event', {
                                        dragData: dragData,
                                        clientX: iframeX,
                                        clientY: iframeY
                                    });
                                } else {
                                    logger.warn('[TADjs] windowIdが見つかりませんでした。ドロップイベントを転送できません。');
                                }

                                logger.debug('[TADjs] iframeにドロップイベントを転送完了');

                                // クロスウィンドウドロップの場合、元のウィンドウに成功メッセージを送信
                                if (dragData.sourceWindowId && dragData.sourceWindowId !== windowId) {
                                    logger.debug('[TADjs] クロスウィンドウドロップ検出: source=', dragData.sourceWindowId, 'target=', windowId);
                                    this.parentMessageBus.sendToWindow(dragData.sourceWindowId, 'cross-window-drop-success', {
                                        targetWindowId: windowId
                                    });
                                    logger.debug('[TADjs] cross-window-drop-successメッセージを送信:', dragData.sourceWindowId);
                                }

                                e.preventDefault();
                                return false;
                            } catch (err) {
                                logger.debug('[TADjs] ドロップデータのJSON解析失敗、URLドロップをチェック');
                            }
                        }

                        // URLドロップをチェック（ブラウザからのURLドラッグ）
                        const uriList = e.dataTransfer.getData('text/uri-list');
                        const plainText = e.dataTransfer.getData('text/plain');

                        // URLを抽出（text/uri-listを優先）
                        let droppedUrl = null;
                        if (uriList) {
                            // text/uri-listは改行区切り、#で始まる行はコメント
                            const urls = uriList.split('\n')
                                .map(line => line.trim())
                                .filter(line => line && !line.startsWith('#'));
                            if (urls.length > 0) {
                                droppedUrl = urls[0]; // 最初のURLを使用
                            }
                        } else if (plainText && /^https?:\/\/.+/i.test(plainText.trim())) {
                            droppedUrl = plainText.trim();
                        }

                        if (droppedUrl) {
                            logger.debug('[TADjs] URLドロップ検出:', droppedUrl);
                            this.handleUrlDrop(droppedUrl, iframe, iframeX, iframeY);
                            e.preventDefault();
                            return false;
                        }

                        // 外部ファイルドロップをチェック（Windowsからのドラッグなど）
                        const files = Array.from(e.dataTransfer.files);
                        if (files.length > 0) {
                            logger.debug('[TADjs] 外部ファイルドロップ検出:', files.length, '個のファイル');

                            // FileImportManagerを使用してファイルを処理
                            if (this.fileImportManager) {
                                this.fileImportManager.handleFilesImport(files, iframe).then(() => {
                                    logger.debug('[TADjs] 外部ファイルインポート完了');
                                }).catch(err => {
                                    logger.error('[TADjs] 外部ファイルインポートエラー:', err);
                                });
                            }

                            e.preventDefault();
                            return false;
                        }
                    }
                }

                // iframe以外、またはJSON解析失敗の場合はデフォルト動作を防ぐ
                e.preventDefault();
                return false;
            });
        }, window.UI_UPDATE_DELAY_MS); // 100ms後に実行
    }

    
    /**
     * ドロップされたファイルを処理
     * @param {FileList} files - ドロップされたファイルリスト
     */
    async handleFilesDrop(files) {
        // FileImportManagerに処理を委譲
        await this.fileImportManager.handleFilesDrop(files);
    }

    /**
     * 原紙箱からドロップされた原紙ファイルを処理
     * @param {Object} dragData - ドラッグデータ
     * @param {MessageEvent} messageEvent - メッセージイベント（e.sourceとe.dataを含む）
     */
    async handleBaseFileDrop(dragData, messageEvent) {
        logger.debug('[TADjs] handleBaseFileDrop開始:', dragData);

        // 原紙箱からのドロップでない場合は処理しない
        if (dragData.type !== 'base-file-copy' && dragData.type !== 'user-base-file-copy') {
            logger.debug('[TADjs] handleBaseFileDrop: 原紙箱からのドロップではないためスキップ');
            return;
        }

        // ドロップ元のiframeを取得
        const dropTargetWindow = messageEvent ? messageEvent.source : null;
        // dropPositionがメッセージに含まれている場合はそれを使用、なければclientX/Yから作成
        const dropPosition = messageEvent && messageEvent.data
            ? (messageEvent.data.dropPosition || { x: messageEvent.data.clientX, y: messageEvent.data.clientY })
            : null;
        // targetCellがメッセージに含まれている場合はそれを使用（表計算プラグイン用）
        const targetCell = messageEvent && messageEvent.data ? messageEvent.data.targetCell : null;
        logger.debug('[TADjs] ドロップ先ウィンドウ:', dropTargetWindow ? 'あり' : 'なし', 'ドロップ位置:', dropPosition, 'ターゲットセル:', targetCell);

        // ユーザ原紙の場合は実身を複製して新規作成（システム原紙と同様）
        if (dragData.type === 'user-base-file-copy') {
            const baseFile = dragData.baseFile;
            const sourceRealId = baseFile.realId;
            const displayName = baseFile.displayName;

            // 実身名を入力するダイアログを表示
            const result = await this.showInputDialog(
                '新しい実身の名称を入力してください',
                displayName,
                30,
                [
                    { label: '取消', value: 'cancel' },
                    { label: '設定', value: 'ok' }
                ],
                1 // デフォルトは「設定」ボタン
            );

            logger.debug('[TADjs] ユーザ原紙ダイアログ結果:', result);

            // 取消の場合は何もしない
            if (result.button === 'cancel' || !result.value) {
                logger.debug('[TADjs] ユーザ原紙作成キャンセル');
                return;
            }

            const newName = result.value;
            logger.debug('[TADjs] ユーザ原紙から新しい実身名:', newName);

            // 元の実身を読み込む
            if (!this.realObjectSystem) {
                logger.error('[TADjs] RealObjectSystemが初期化されていません');
                this.setStatusMessage('実身システムが初期化されていません');
                return;
            }

            let sourceRealObject;
            try {
                sourceRealObject = await this.realObjectSystem.loadRealObject(sourceRealId);
                logger.debug('[TADjs] 元の実身読み込み完了:', sourceRealId);
            } catch (error) {
                logger.error('[TADjs] 元の実身読み込みエラー:', error);
                this.setStatusMessage('元の実身の読み込みに失敗しました');
                return;
            }

            // 新しい実身IDを生成
            const newRealId = typeof generateUUIDv7 === 'function' ? generateUUIDv7() : this.generateRealFileIdSet(1).fileId;
            logger.debug('[TADjs] ユーザ原紙から新しい実身ID:', newRealId);

            // 新しいメタデータを作成
            const currentDateTime = new Date().toISOString();
            const newMetadata = {
                ...sourceRealObject.metadata,
                realId: newRealId,
                name: newName,
                makeDate: currentDateTime,
                updateDate: currentDateTime,
                accessDate: currentDateTime,
                refCount: 1,
                maker: this.currentUser || 'TRON User'
            };

            // XTADレコードをコピー（filename属性を更新）
            const newRecords = sourceRealObject.records.map(record => {
                let newXtad = record.xtad;
                if (newXtad) {
                    newXtad = newXtad.replace(/filename="[^"]*"/, `filename="${newName}"`);
                }
                return { xtad: newXtad, images: record.images || [] };
            });

            // RealObjectSystemに保存
            try {
                await this.realObjectSystem.saveRealObject(newRealId, {
                    metadata: newMetadata,
                    records: newRecords
                });
                logger.debug('[TADjs] 新しい実身をRealObjectSystemに保存:', newRealId);
            } catch (error) {
                logger.error('[TADjs] 実身保存エラー:', error);
                this.setStatusMessage('実身の保存に失敗しました');
                return;
            }

            // JSONファイルも保存
            const jsonFileName = window.RealObjectSystem.getRealObjectJsonFileName(newRealId);
            const jsonSaved = await this.saveDataFile(jsonFileName, JSON.stringify(newMetadata, null, 2));
            if (jsonSaved) {
                logger.debug('[TADjs] JSONファイル保存成功:', jsonFileName);
            } else {
                logger.warn('[TADjs] JSONファイル保存失敗:', jsonFileName);
            }

            // アイコンファイルをコピー（存在する場合）
            if (this.isElectronEnv) {
                try {
                    const basePath = this.realObjectSystem.getDataBasePath();
                    const fs = require('fs');
                    const path = require('path');
                    const sourceIcoPath = path.join(basePath, `${sourceRealId}.ico`);
                    const newIcoPath = path.join(basePath, `${newRealId}.ico`);

                    if (fs.existsSync(sourceIcoPath)) {
                        fs.copyFileSync(sourceIcoPath, newIcoPath);
                        logger.debug('[TADjs] アイコンファイルコピー成功:', sourceRealId, '->', newRealId);
                    } else {
                        logger.debug('[TADjs] 元のアイコンファイルが存在しません:', sourceIcoPath);
                    }
                } catch (error) {
                    logger.warn('[TADjs] アイコンファイルコピーエラー:', error.message);
                }

                // PNG画像ファイルをコピー（ピクセルマップ用、存在する場合）
                try {
                    const basePath = this.realObjectSystem.getDataBasePath();
                    const fs = require('fs');
                    const path = require('path');
                    const files = fs.readdirSync(basePath);
                    const pngPattern = new RegExp(`^${sourceRealId.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}_\\d+_\\d+\\.png$`);

                    for (const file of files) {
                        if (pngPattern.test(file)) {
                            const sourcePngPath = path.join(basePath, file);
                            const newPngFile = file.replace(sourceRealId, newRealId);
                            const newPngPath = path.join(basePath, newPngFile);

                            try {
                                fs.copyFileSync(sourcePngPath, newPngPath);
                                logger.debug('[TADjs] PNGファイルコピー成功:', file, '->', newPngFile);
                            } catch (error) {
                                logger.warn('[TADjs] PNGファイルコピーエラー:', file, error.message);
                            }
                        }
                    }
                } catch (error) {
                    logger.warn('[TADjs] PNG検索エラー:', error.message);
                }
            }

            logger.debug('[TADjs] ユーザ原紙から新しい実身を作成しました:', newRealId, newName);

            // ドロップ先のウィンドウに仮身を追加
            if (dropTargetWindow) {
                const windowId = this.parentMessageBus.getWindowIdFromSource(dropTargetWindow);
                if (windowId) {
                    this.parentMessageBus.sendToWindow(windowId, 'add-virtual-object-from-base', {
                        realId: newRealId,
                        name: newName,
                        dropPosition: dropPosition,
                        targetCell: targetCell,
                        applist: newMetadata.applist || {}
                    });
                    logger.debug('[TADjs] ユーザ原紙からドロップ先に仮身を追加:', newRealId, newName, dropPosition, 'targetCell:', targetCell);
                } else {
                    logger.warn('[TADjs] windowIdが見つかりませんでした。仮身を追加できません。');
                }
            } else {
                logger.warn('[TADjs] ドロップ先ウィンドウが不明です');
            }

            this.setStatusMessage(`実身「${newName}」を作成しました`);
            return;
        }

        // システム原紙の場合は新規実身を作成

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

        logger.debug('[TADjs] ダイアログ結果:', result);

        // 取消の場合は何もしない
        if (result.button === 'cancel' || !result.value) {
            logger.debug('[TADjs] キャンセルされました');
            return;
        }

        const newName = result.value;
        logger.debug('[TADjs] 新しい実身名:', newName);

        // 新しい実身IDを生成（tad.jsのgenerateUUIDv7を使用）
        const newRealId = typeof generateUUIDv7 === 'function' ? generateUUIDv7() : this.generateRealFileIdSet(1).fileId;
        logger.debug('[TADjs] 新しい実身ID:', newRealId);

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

            // JSONファイルを読み込む（ネットワークエラー時はフォールバック）
            try {
                const jsonResponse = await fetch(jsonPath);
                if (jsonResponse.ok) {
                    basefileJson = await jsonResponse.json();
                    logger.debug('[TADjs] basefile JSON読み込み完了:', basefileJson);
                } else {
                    // JSONがない場合は空のオブジェクトを作成
                    basefileJson = {
                        name: newName,
                        applist: []
                    };
                    logger.debug('[TADjs] basefile JSONがないため、新規作成');
                }
            } catch (fetchError) {
                // ネットワークエラー時のフォールバック
                logger.warn('[TADjs] basefile JSON読み込みエラー、フォールバック使用:', fetchError);
                basefileJson = {
                    name: newName,
                    applist: []
                };
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
                logger.debug('[TADjs] basefile XTAD読み込み完了');
            } else {
                logger.error('[TADjs] basefile XTAD読み込み失敗');
                return;
            }

        } catch (error) {
            logger.error('[TADjs] basefile読み込みエラー:', error);
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
            refCount: 1,  // 新規作成時は1
            maker: this.currentUser || 'TRON User'  // 使用者名を設定
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
                    name: newName,
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

                logger.debug('[TADjs] 実身をファイルに保存:', newRealId, newName);
            } catch (error) {
                logger.error('[TADjs] 実身保存エラー:', error);
            }
        }

        // Electron環境の場合のファイル保存は既にrealObjectSystemが行っているので不要
        const jsonFileName = window.RealObjectSystem.getRealObjectJsonFileName(newRealId);
        const xtadFileName = `${newRealId}_0.xtad`;

        const jsonSaved = await this.saveDataFile(jsonFileName, JSON.stringify(newRealJson, null, 2));
        const xtadSaved = await this.saveDataFile(xtadFileName, newRealXtad);

        if (jsonSaved && xtadSaved) {
            logger.debug('[TADjs] 新しい実身をファイルシステムに保存しました:', jsonFileName, xtadFileName);
        } else {
            logger.warn('[TADjs] ファイルシステムへの保存に失敗しました');
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
                            logger.debug('[TADjs] アイコンファイルをコピーしました:', baseIconPath, '->', newIconFileName);
                        } else {
                            logger.warn('[TADjs] アイコンファイルのコピーに失敗しました:', newIconFileName);
                        }
                    } else {
                        logger.debug('[TADjs] basefileにアイコンファイルが存在しません:', baseIconPath);
                    }
                } else {
                    logger.debug('[TADjs] basefileにicoファイルが指定されていません');
                }
            } catch (error) {
                logger.warn('[TADjs] アイコンファイルコピー中のエラー:', error.message);
            }
        }

        logger.debug('[TADjs] 新しい実身を保存しました:', newRealId, newName);

        // ドロップ先のウィンドウに仮身を追加
        if (dropTargetWindow) {
            const windowId = this.parentMessageBus.getWindowIdFromSource(dropTargetWindow);
            if (windowId) {
                this.parentMessageBus.sendToWindow(windowId, 'add-virtual-object-from-base', {
                    realId: newRealId,
                    name: newName,
                    dropPosition: dropPosition,
                    targetCell: targetCell,
                    applist: newRealJson.applist || {}
                });
                logger.debug('[TADjs] ドロップ先に仮身を追加:', newRealId, newName, dropPosition, 'targetCell:', targetCell, 'applist:', newRealJson.applist);
            } else {
                logger.warn('[TADjs] windowIdが見つかりませんでした。仮身を追加できません。');
            }
        } else {
            logger.warn('[TADjs] ドロップ先ウィンドウが不明です');
        }

        this.setStatusMessage(`実身「${newName}」を作成しました`);
    }

    /**
     * URLドロップを処理
     * URL原紙を使って新規実身を作成し、ドロップ先に仮身を追加
     * @param {string} url - ドロップされたURL
     * @param {HTMLIFrameElement} targetIframe - ドロップ先のiframe
     * @param {number} dropX - ドロップ位置X（iframe内座標）
     * @param {number} dropY - ドロップ位置Y（iframe内座標）
     */
    async handleUrlDrop(url, targetIframe, dropX, dropY) {
        logger.debug('[TADjs] handleUrlDrop開始:', url);

        // URLからデフォルトの実身名を生成（ホスト名を使用）
        let defaultName = 'URL仮身';
        try {
            const urlObj = new URL(url);
            defaultName = urlObj.hostname || 'URL仮身';
        } catch (e) {
            // URL解析エラーの場合はデフォルト名を使用
        }

        // 実身名を入力するダイアログを表示
        const result = await this.showInputDialog(
            '新しい実身の名称を入力してください',
            defaultName,
            30,
            [
                { label: '取消', value: 'cancel' },
                { label: '設定', value: 'ok' }
            ],
            1
        );

        if (result.button === 'cancel' || !result.value) {
            logger.debug('[TADjs] URLドロップキャンセル');
            return;
        }

        const newName = result.value;
        logger.debug('[TADjs] URL実身名:', newName);

        // 新しい実身IDを生成
        const newRealId = typeof generateUUIDv7 === 'function'
            ? generateUUIDv7()
            : this.generateRealFileIdSet(1).fileId;
        logger.debug('[TADjs] URL実身ID:', newRealId);

        // xtadを生成（URLを段落で囲む）
        const xtadContent = `<tad version="1.0" encoding="UTF-8" filename="${newName}">
<document>
<p>
${url}
</p>
</document>
</tad>
`;

        // メタデータを生成（URL原紙のapplistを使用）
        const currentDateTime = new Date().toISOString();
        const newMetadata = {
            name: newName,
            relationship: [],
            linktype: false,
            makeDate: currentDateTime,
            updateDate: currentDateTime,
            accessDate: currentDateTime,
            periodDate: null,
            refCount: 1,
            editable: true,
            readable: true,
            maker: this.currentUser || 'TRON User',
            window: {
                pos: { x: 100, y: 100 },
                width: 400,
                height: 200,
                minWidth: 200,
                minHeight: 200,
                resizable: true,
                scrollable: true
            },
            applist: {
                'url-link-exec': { name: 'URL仮身', defaultOpen: true },
                'basic-text-editor': { name: '基本文章編集', defaultOpen: false }
            }
        };

        // RealObjectSystemに保存
        try {
            await this.realObjectSystem.saveRealObject(newRealId, {
                metadata: newMetadata,
                records: [{ xtad: xtadContent, images: [] }]
            });
            logger.debug('[TADjs] URL実身保存完了:', newRealId);
        } catch (error) {
            logger.error('[TADjs] URL実身保存エラー:', error);
            this.setStatusMessage('URL実身の保存に失敗しました');
            return;
        }

        // JSONファイルも保存
        const jsonFileName = window.RealObjectSystem.getRealObjectJsonFileName(newRealId);
        await this.saveDataFile(jsonFileName, JSON.stringify(newMetadata, null, 2));

        // XTADファイルも保存
        const xtadFileName = `${newRealId}_0.xtad`;
        await this.saveDataFile(xtadFileName, xtadContent);

        // アイコンファイルをコピー（URL原紙のアイコン）
        const URL_BASE_FILE_REAL_ID = '019a4a5c-8888-4b8a-9d3c-1f6e8a9b2c4d';
        if (this.isElectronEnv) {
            try {
                const basePath = this.realObjectSystem.getDataBasePath();
                const fs = require('fs');
                const path = require('path');
                const sourceIcoPath = path.join(basePath, `${URL_BASE_FILE_REAL_ID}.ico`);
                const newIcoPath = path.join(basePath, `${newRealId}.ico`);

                if (fs.existsSync(sourceIcoPath)) {
                    fs.copyFileSync(sourceIcoPath, newIcoPath);
                    logger.debug('[TADjs] URLアイコンコピー成功');
                } else {
                    // プラグインディレクトリからアイコンをコピー
                    const pluginIcoPath = path.join(__dirname, 'plugins', 'url-link-exec', `${URL_BASE_FILE_REAL_ID}.ico`);
                    if (fs.existsSync(pluginIcoPath)) {
                        fs.copyFileSync(pluginIcoPath, newIcoPath);
                        logger.debug('[TADjs] URLアイコン（プラグインから）コピー成功');
                    }
                }
            } catch (error) {
                logger.warn('[TADjs] URLアイコンコピーエラー:', error.message);
            }
        }

        // ドロップ先のウィンドウに仮身を追加
        if (targetIframe && targetIframe.contentWindow) {
            const windowId = this.parentMessageBus.getWindowIdFromIframe(targetIframe);
            if (windowId) {
                this.parentMessageBus.sendToWindow(windowId, 'add-virtual-object-from-base', {
                    realId: newRealId,
                    name: newName,
                    dropPosition: { x: dropX, y: dropY },
                    applist: newMetadata.applist
                });
                logger.debug('[TADjs] URL仮身追加:', newRealId, newName);
            } else {
                logger.warn('[TADjs] windowIdが見つかりませんでした。URL仮身を追加できません。');
            }
        } else {
            logger.warn('[TADjs] ドロップ先iframeが不明です');
        }

        this.setStatusMessage(`URL実身「${newName}」を作成しました`);
    }

    /**
     * 屑実身操作からドロップされた実身を復元
     * @param {Object} dragData - ドラッグデータ
     * @param {MessageEvent} messageEvent - メッセージイベント
     */
    async handleTrashRealObjectDrop(dragData, messageEvent) {
        logger.debug('[TADjs] handleTrashRealObjectDrop開始:', dragData);

        // 屑実身操作からのドロップでない場合は処理しない
        if (dragData.type !== 'trash-real-object-restore') {
            logger.debug('[TADjs] handleTrashRealObjectDrop: 屑実身操作からのドロップではないためスキップ');
            return;
        }

        // ドロップ元のiframeを取得
        const dropTargetWindow = messageEvent ? messageEvent.source : null;
        const dropPosition = messageEvent && messageEvent.data
            ? (messageEvent.data.dropPosition || { x: messageEvent.data.clientX, y: messageEvent.data.clientY })
            : null;
        logger.debug('[TADjs] ドロップ先ウィンドウ:', dropTargetWindow ? 'あり' : 'なし', 'ドロップ位置:', dropPosition);

        const realObject = dragData.realObject;
        const realId = realObject.realId;
        const name = realObject.name;

        logger.debug('[TADjs] 屑実身を復元:', realId, name);

        // RealObjectSystemから実身を読み込む
        if (!this.realObjectSystem) {
            logger.error('[TADjs] RealObjectSystemが初期化されていません');
            return;
        }

        try {
            // 実身を読み込む
            const loadedRealObject = await this.realObjectSystem.loadRealObject(realId);
            logger.debug('[TADjs] 実身読み込み完了:', realId);

            // 参照カウントを増やす
            const currentRefCount = loadedRealObject.metadata.refCount || 0;
            const newRefCount = currentRefCount + 1;

            // メタデータを更新
            const jsonFileName = window.RealObjectSystem.getRealObjectJsonFileName(realId);
            const jsonPath = this.getDataBasePath() + '/' + jsonFileName;
            const metadata = loadedRealObject.metadata;
            metadata.refCount = newRefCount;
            metadata.accessDate = new Date().toISOString();

            // ファイルに保存
            await this.saveDataFile(jsonFileName, JSON.stringify(metadata, null, 2));
            logger.debug('[TADjs] 参照カウント更新:', realId, currentRefCount, '->', newRefCount);

            // ドロップ先のウィンドウに仮身を追加
            if (dropTargetWindow) {
                const windowId = this.parentMessageBus.getWindowIdFromSource(dropTargetWindow);
                if (windowId) {
                    this.parentMessageBus.sendToWindow(windowId, 'add-virtual-object-from-trash', {
                        realId: realId,
                        name: name,
                        dropPosition: dropPosition,
                        applist: metadata.applist || {}
                    });
                    logger.debug('[TADjs] ドロップ先に仮身を追加:', realId, name, dropPosition);
                } else {
                    logger.warn('[TADjs] windowIdが見つかりませんでした。仮身を追加できません。');
                }
            } else {
                logger.warn('[TADjs] ドロップ先ウィンドウが不明です');
            }

            this.setStatusMessage(`実身「${name}」を復元しました`);
        } catch (error) {
            logger.error('[TADjs] 屑実身復元エラー:', error);
            this.setStatusMessage(`実身「${name}」の復元に失敗しました`);
        }
    }

    /**
     * クロスウィンドウドロップ進行中を元のウィンドウに即座通知（dragendより前）
     * @param {Object} data - ドロップデータ
     */
    notifySourceWindowOfCrossWindowDropInProgress(data) {
        logger.debug('[TADjs] クロスウィンドウドロップ進行中通知:', data.sourceWindowId);

        // 特定のウィンドウ（sourceWindowId）だけに即座通知
        this.parentMessageBus.sendToWindow(data.sourceWindowId, 'cross-window-drop-in-progress', {
            targetWindowId: data.targetWindowId
        });
    }

    /**
     * クロスウィンドウドロップ成功を元のウィンドウに通知
     * @param {Object} data - ドロップデータ
     */
    notifySourceWindowOfCrossWindowDrop(data) {
        logger.debug('[TADjs] クロスウィンドウドロップ通知:', data.sourceWindowId);

        // 特定のウィンドウ（sourceWindowId）だけに通知
        this.parentMessageBus.sendToWindow(data.sourceWindowId, 'cross-window-drop-success', {
            mode: data.mode,
            source: data.source,
            sourceWindowId: data.sourceWindowId,
            targetWindowId: data.targetWindowId,
            virtualObjects: data.virtualObjects
        });
    }

    /**
     * ファイルをキャッシュに追加（上限管理付き）
     * @param {string} key - キャッシュキー
     * @param {File|Blob} file - ファイルオブジェクト
     */
    addFileToCache(key, file) {
        // キャッシュサイズ上限チェック
        const keys = Object.keys(this.fileObjects);
        if (keys.length >= this.maxFileCacheSize) {
            // 最も古いエントリを削除（FIFO）
            delete this.fileObjects[keys[0]];
            logger.debug('[TADjs] ファイルキャッシュ上限到達、古いエントリを削除:', keys[0]);
        }
        this.fileObjects[key] = file;
    }

    /**
     * ファイルアイコンを初期ウインドウに追加
     * @param {File} file - ファイルオブジェクト
     * @param {number} index - ファイルのインデックス
     */
    addFileIcon(file, index) {
        // ファイルオブジェクトを保存
        this.addFileToCache(file.name, file);

        const fileIconsContainer = document.getElementById('file-icons');

        // file-iconsコンテナが存在しない場合は、何もしない（エラー回避）
        if (!fileIconsContainer) {
            logger.warn('[TADjs] file-iconsコンテナが見つかりません:', file.name);
            return;
        }

        const fileIcon = document.createElement('div');
        fileIcon.className = 'file-icon';
        fileIcon.dataset.filename = file.name;
        fileIcon.dataset.fileName = file.name;  // プラグインメニュー用(大文字N)

        // XSS対策: DOM APIを使用して安全に設定
        const iconImage = document.createElement('div');
        iconImage.className = 'file-icon-image';

        const iconText = document.createElement('div');
        iconText.className = 'file-icon-text';
        iconText.textContent = file.name; // textContentでXSS対策

        fileIcon.appendChild(iconImage);
        fileIcon.appendChild(iconText);

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
                }, window.CLICK_DEBOUNCE_DELAY_MS); // 250ms待機
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

            logger.debug('Opening file:', file.name);
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
            logger.debug('Opening TAD file:', file.name, file);
            this.setStatusMessage(`${file.name} を読み込み中...`);

            const uint8Array = await this.getFileAsUint8Array(file);

            logger.debug('TAD data loaded:', uint8Array.length, 'bytes');

            // TADウインドウを作成（従来の処理）
            const windowId = await this.createTADWindow(file.name, uint8Array);

            this.setStatusMessage(`${file.name} を開きました`);
            logger.debug('TAD window created:', windowId);

        } catch (error) {
            logger.error('TADファイルの読み込みエラー:', error);
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
    /**
     * ウィンドウを作成（WindowManagerに委譲）
     * @param {string} title - ウィンドウタイトル
     * @param {string} content - ウィンドウコンテンツ（HTML）
     * @param {Object} options - ウィンドウオプション
     * @returns {string} ウィンドウID
     */
    createWindow(title, content, options = {}) {
        if (this.windowManager) {
            const windowId = this.windowManager.createWindow(
                title,
                content,
                options,
                this.setupWindowEvents.bind(this),
                this.toggleMaximizeWindow.bind(this)
            );
            // windowCounterを同期
            this.windowCounter = this.windowManager.windowCounter;
            return windowId;
        }
        logger.warn('[TADjs] WindowManagerが利用できません');
        return null;
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
        logger.info('[tadjs-desktop.js] createTADWindow called - using plugin system');

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

                logger.info('[tadjs-desktop.js] Creating TAD window via plugin system:', fileData);

                // プラグインウィンドウを作成
                const windowId = await window.pluginManager.createPluginWindow(plugin, fileData);
                return windowId;
            } else {
                logger.error('[tadjs-desktop.js] tadjs-view plugin not found');
                return null;
            }
        } else {
            logger.error('[tadjs-desktop.js] PluginManager not initialized');
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
        logger.warn('[tadjs-desktop.js] renderTADData is deprecated - use createTADWindow instead');
        logger.info('[tadjs-desktop.js] Parameters:', { dataLength: data.length, canvasId, originalLinkId });

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
            
            
            // canvasに保存された仮身情報を使用（各canvasで独立）
            // canvas.virtualObjectLinksには既に[0]のデータが保存されているので、直接使用
            const links = canvas.virtualObjectLinks || (window.linkRecordList && window.linkRecordList[0]) || [];
            
            
            if (links && links.length > 0) {
                
                // クリック位置に仮身があるかチェック
                for (let i = 0; i < links.length; i++) {
                    const link = links[i];
                    
                    if (link && link.left !== undefined && link.left <= x && x <= link.right && 
                        link.top !== undefined && link.top <= y && y <= link.bottom) {
                        
                        // 重複クリック防止（短時間での連続クリックを防ぐ）
                        const now = Date.now();
                        if (this.lastLinkClickTime && now - this.lastLinkClickTime < 1000) {
                            return;
                        }
                        this.lastLinkClickTime = now;
                        
                        // 新しいウィンドウで仮身のリンク先を開く
                        if (link.raw && link.raw.length > 0) {
                            // リンク先のTADデータがある場合は新しいウィンドウで開く
                            const title = link.link_name || `仮身 - ${link.link_id || 'リンク'}`;
                            const windowId = await this.createTADWindow(title, link.raw, null, link.link_id);
                            this.setStatusMessage(`${title} を新しいウィンドウで開きました`);
                        } else if (link.link_id !== undefined) {
                            // BPK内の別ファイルへのリンクの場合 - canvasに保存されたデータを優先
                            const linkedIndex = parseInt(link.link_id);
                            const tadRecordArray = canvas.tadRecordDataArray || window.tadRecordDataArray;
                            
                            
                            if (tadRecordArray && tadRecordArray[linkedIndex]) {
                                const linkedEntry = tadRecordArray[linkedIndex];
                                const title = linkedEntry.name || `ファイル ${linkedIndex}`;
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
            } else {
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
            logger.info('[TADjs] 仮身一覧から仮身を開く:', linkId, linkName);

            // link_idから実身ID（UUID）を抽出（共通メソッドを使用）
            const realId = window.RealObjectSystem.extractRealId(linkId);

            // 実身管理用JSONを読み込む
            try {
                const jsonFileName = window.RealObjectSystem.getRealObjectJsonFileName(realId);
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
                    logger.error('[TADjs] defaultOpen: true のプラグインが見つかりません');
                    this.setStatusMessage('実身を開くプラグインが見つかりません');
                    return;
                }

                logger.info('[TADjs] defaultOpenプラグインで開く:', defaultPlugin);

                // 仮身オブジェクトを構築してopenVirtualObjectRealを呼び出す
                const virtualObj = {
                    link_id: linkId,
                    link_name: linkName
                };

                await this.openVirtualObjectReal(virtualObj, defaultPlugin, null, null);

            } catch (error) {
                logger.error('[TADjs] 仮身を開く際のエラー:', error);
                this.setStatusMessage(`仮身を開く際のエラー: ${error.message}`);
            }
            return;
        }

        // 従来のlinkオブジェクトが渡された場合（TADファイル内の仮身から呼ばれた場合）
        const link = linkIdOrObject;

        if (link.raw && link.raw.length > 0) {
            // リンク先のTADデータがある場合は新しいウィンドウで開く
            const title = link.link_name || `仮身 - ${link.link_id || 'リンク'}`;
            const windowId = await this.createTADWindow(title, link.raw, null, link.link_id);
            this.setStatusMessage(`${title} を開きました`);
        } else if (link.link_id !== undefined) {
            // BPK内の別ファイルへのリンクの場合 - グローバルからデータを取得
            const linkedIndex = parseInt(link.link_id);
            const tadRecordArray = window.tadRecordDataArray;


            if (tadRecordArray && tadRecordArray[linkedIndex]) {
                const linkedEntry = tadRecordArray[linkedIndex];
                const title = linkedEntry.name || `ファイル ${linkedIndex}`;
                logger.debug('openVirtualObject: Opening linked entry:', title, 'data length:', linkedEntry.data ? linkedEntry.data.length : 'null');
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
    /**
     * リサイズハンドルのHTML生成（WindowManagerに委譲）
     * @returns {string} リサイズハンドルのHTML
     */
    createResizeHandles() {
        if (this.windowManager) {
            return this.windowManager.createResizeHandles();
        }
        return ''; // フォールバック
    }

    /**
     * カスタムスクロールバーを作成（WindowManagerに委譲）
     * @param {HTMLElement} windowElement - スクロールバーを追加するウィンドウ要素
     */
    createCustomScrollbar(windowElement) {
        if (this.windowManager) {
            this.windowManager.createCustomScrollbar(windowElement);
        } else {
            logger.warn('[TADjs] WindowManagerが利用できません');
        }
    }
    
    /**
     * スクロールバーの初期化（ScrollbarManagerに委譲）
     * @param {HTMLElement} content - スクロール対象のコンテンツ要素
     * @param {HTMLElement} scrollbar - スクロールバー要素
     * @param {string} direction - スクロール方向（'vertical'または'horizontal'）
     * @returns {Function} クリーンアップ関数
     */
    initScrollbar(content, scrollbar, direction) {
        if (this.scrollbarManager) {
            return this.scrollbarManager.initScrollbar(content, scrollbar, direction);
        }
        logger.warn('[TADjs] ScrollbarManagerが利用できません');
        return () => {}; // 空のクリーンアップ関数
    }

    /**
     * スクロールバーを強制的に更新（ScrollbarManagerに委譲）
     * @param {HTMLElement} content - スクロール対象のコンテンツ要素
     * @param {HTMLElement} scrollbar - スクロールバー要素
     * @param {string} direction - スクロール方向（'vertical'または'horizontal'）
     */
    forceUpdateScrollbar(content, scrollbar, direction) {
        if (this.scrollbarManager) {
            this.scrollbarManager.forceUpdateScrollbar(content, scrollbar, direction);
        } else {
            logger.warn('[TADjs] ScrollbarManagerが利用できません');
        }
    }

    /**
     * プラグインウィンドウのスクロールバーを更新（ScrollbarManagerに委譲）
     * @param {HTMLIFrameElement} iframe - プラグインのiframe要素
     * @param {HTMLElement} content - スクロール対象のコンテンツ要素（.window-content）
     * @param {HTMLElement} scrollbar - スクロールバー要素
     * @param {string} direction - スクロール方向（'vertical'または'horizontal'）
     */
    forceUpdateScrollbarForPlugin(iframe, content, scrollbar, direction) {
        if (this.scrollbarManager) {
            this.scrollbarManager.forceUpdateScrollbarForPlugin(iframe, content, scrollbar, direction);
        } else {
            logger.warn('[TADjs] ScrollbarManagerが利用できません');
        }
    }

    /**
     * プラグインウィンドウ用のスクロールバー初期化（ScrollbarManagerに委譲）
     * @param {HTMLIFrameElement} iframe - プラグインのiframe要素
     * @param {HTMLElement} content - ウィンドウコンテンツ要素（.window-content）
     * @param {HTMLElement} scrollbar - スクロールバー要素
     * @param {string} direction - スクロール方向（'vertical'または'horizontal'）
     */
    initScrollbarForPlugin(iframe, content, scrollbar, direction) {
        if (this.scrollbarManager) {
            this.scrollbarManager.initScrollbarForPlugin(iframe, content, scrollbar, direction);
        } else {
            logger.warn('[TADjs] ScrollbarManagerが利用できません');
        }
    }

    /**
     * プラグインウィンドウ用のMessageBusベーススクロールバー初期化
     * cross-frame DOMアクセスを使用せず、MessageBus経由でスクロール制御
     * @param {HTMLElement} scrollbar - スクロールバー要素
     * @param {string} direction - スクロール方向（'vertical'または'horizontal'）
     * @param {string} windowId - ウィンドウID
     * @returns {Function} クリーンアップ関数
     */
    initScrollbarForPluginWithMessageBus(scrollbar, direction, windowId) {
        if (this.scrollbarManager && this.parentMessageBus) {
            return this.scrollbarManager.initScrollbarForPluginWithMessageBus(
                scrollbar, direction, this.parentMessageBus, windowId
            );
        } else {
            logger.warn('[TADjs] ScrollbarManagerまたはMessageBusが利用できません');
            return () => {};
        }
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
                logger.debug('Maximize corner double-clicked');
                this.toggleMaximizeWindow(windowElement.id);
            });
        }

        // タイトルバーでドラッグ移動（閉じるボタン以外）
        // フレームレスウィンドウ（タイトルバーなし）の場合はスキップ
        if (titlebar) {
            titlebar.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;
                if (e.target.classList.contains('window-close-button')) return;
                e.preventDefault();

                this.startWindowDrag(windowElement, e);
            });
        }

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

        logger.debug('Direct resize - start values:', { startX, startY, startWidth, startHeight, startLeft, startTop });

        const handleMouseMove = (moveEvent) => {
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
            newWidth = Math.max(window.MIN_WINDOW_WIDTH, newWidth);
            newHeight = Math.max(window.MIN_WINDOW_HEIGHT, newHeight);

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

        };

        const handleMouseUp = () => {
            logger.debug('Direct mouseup detected');
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            document.body.style.userSelect = '';

            // ウィンドウサイズ変更後、iframe内のキャンバスサイズ更新を通知
            const iframe = windowElement.querySelector('iframe');

            const windowId = windowElement.dataset.windowId;
            if (this.parentMessageBus && windowId) {
                this.parentMessageBus.sendToWindow(windowId, 'window-resized', {});
            } else {
                logger.warn('[TADjs] windowIdが見つかりませんでした。window-resizedメッセージを送信できません。');
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
     * ウィンドウのドラッグを開始（WindowManagerに委譲）
     * @param {HTMLElement} windowElement - ドラッグするウィンドウ要素
     * @param {MouseEvent} e - マウスイベント
     */
    startWindowDrag(windowElement, e) {
        if (this.windowManager) {
            this.windowManager.startWindowDrag(windowElement, e);
        } else {
            logger.warn('[TADjs] WindowManagerが利用できません');
        }
    }

    /**
     * ウィンドウのドラッグ処理（WindowManagerに委譲）
     * @param {MouseEvent} e - マウスイベント
     */
    handleWindowDrag(e) {
        if (this.windowManager) {
            this.windowManager.handleWindowDrag(e);
        } else {
            logger.warn('[TADjs] WindowManagerが利用できません');
        }
    }

    /**
     * ウィンドウのドラッグを終了（WindowManagerに委譲）
     */
    endWindowDrag() {
        if (this.windowManager) {
            this.windowManager.endWindowDrag();
        } else {
            logger.warn('[TADjs] WindowManagerが利用できません');
        }
    }

    /**
     * 道具パネルのドラッグを開始（ToolPanelManagerに委譲）
     * @param {HTMLElement} toolPanelWindow - 道具パネルウィンドウ要素
     * @param {number} iframeClientX - iframe内のクライアントX座標
     * @param {number} iframeClientY - iframe内のクライアントY座標
     */
    startToolPanelDrag(toolPanelWindow, iframeClientX, iframeClientY) {
        if (this.toolPanelManager) {
            this.toolPanelManager.startToolPanelDrag(toolPanelWindow, iframeClientX, iframeClientY);
        } else {
            logger.warn('[TADjs] ToolPanelManagerが利用できません');
        }
    }

    /**
     * 道具パネルのドラッグ処理（ToolPanelManagerに委譲）
     * @param {MouseEvent} e - マウスイベント
     */
    handleToolPanelDrag(e) {
        if (this.toolPanelManager) {
            this.toolPanelManager.handleToolPanelDrag(e);
        } else {
            logger.warn('[TADjs] ToolPanelManagerが利用できません');
        }
    }

    /**
     * 道具パネルのドラッグを終了（ToolPanelManagerに委譲）
     */
    endToolPanelDrag() {
        if (this.toolPanelManager) {
            this.toolPanelManager.endToolPanelDrag();
        } else {
            logger.warn('[TADjs] ToolPanelManagerが利用できません');
        }
    }

    /**
     * ウィンドウのリサイズを開始（WindowManagerに委譲）
     * @param {HTMLElement} windowElement - リサイズするウィンドウ要素
     * @param {string} direction - リサイズ方向 (n, s, e, w, ne, nw, se, sw)
     * @param {MouseEvent} e - マウスイベント
     */
    startWindowResize(windowElement, direction, e) {
        if (this.windowManager) {
            this.windowManager.startWindowResize(windowElement, direction, e);
        } else {
            logger.warn('[TADjs] WindowManagerが利用できません');
        }
    }

    /**
     * ウィンドウのリサイズ処理（WindowManagerに委譲）
     * @param {MouseEvent} e - マウスイベント
     */
    handleWindowResize(e) {
        if (this.windowManager) {
            this.windowManager.handleWindowResize(e);
        } else {
            logger.warn('[TADjs] WindowManagerが利用できません');
        }
    }

    /**
     * ウィンドウのリサイズを終了（WindowManagerに委譲）
     */
    endWindowResize() {
        if (this.windowManager) {
            this.windowManager.endWindowResize();
        } else {
            logger.warn('[TADjs] WindowManagerが利用できません');
        }
    }

    /**
     * アクティブウィンドウを設定（WindowManagerに委譲）
     * @param {string} windowId - ウィンドウID
     */
    setActiveWindow(windowId) {
        if (this.windowManager) {
            this.windowManager.setActiveWindow(windowId);
            // activeWindowを同期
            this.activeWindow = this.windowManager.activeWindow;
        } else {
            logger.warn('[TADjs] WindowManagerが利用できません');
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
            logger.warn('[TADjs] ウィンドウが見つかりません:', windowId);
            return;
        }

        const windowIcon = window.element.querySelector('.window-icon');
        if (!windowIcon) {
            logger.warn('[TADjs] ウィンドウアイコン要素が見つかりません:', windowId);
            return;
        }

        // アイコンファイルを読み込む
        const iconData = await this.loadIconFileAsBase64(iconPath);
        if (iconData) {
            // CSSの擬似要素を無効化するクラスを追加
            windowIcon.classList.add('custom-icon');

            // アイコンを設定
            windowIcon.style.backgroundImage = `url('data:image/x-icon;base64,${iconData}')`;
            windowIcon.style.backgroundSize = 'contain';
            windowIcon.style.backgroundRepeat = 'no-repeat';
            windowIcon.style.backgroundPosition = 'center';
            windowIcon.style.backgroundColor = 'transparent';
        } else {
            logger.warn('[TADjs] アイコンファイルが読み込めませんでした:', iconPath);
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
                    logger.warn('[TADjs] アイコンファイルが見つかりません:', filePath);
                    return null;
                }

                const buffer = this.fs.readFileSync(filePath);
                const base64Data = buffer.toString('base64');
                return base64Data;
            } catch (error) {
                logger.error('[TADjs] アイコンファイル読み込みエラー:', error);
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
                logger.warn('[TADjs] アイコンファイル取得失敗:', response.status, response.statusText);
                return null;
            }
        } catch (error) {
            logger.error('[TADjs] アイコンファイルfetchエラー:', error);
            return null;
        }
    }

    /**
     * ウィンドウを閉じる
     * @param {string} windowId - 閉じるウィンドウのID
     */
    async closeWindow(windowId) {
        if (!this.windows.has(windowId)) return;

        // 既にクローズ処理中の場合は何もしない（重複防止）
        if (this.closingWindows.has(windowId)) {
            logger.debug('[TADjsDesktop] ウィンドウは既にクローズ処理中:', windowId);
            return;
        }
        this.closingWindows.add(windowId);

        const window = this.windows.get(windowId);

        // closable設定を確認
        let closable = true;
        if (window.options && window.options.closable !== undefined) {
            closable = window.options.closable;
        } else if (window.fileData && window.fileData.windowConfig && window.fileData.windowConfig.closable !== undefined) {
            closable = window.fileData.windowConfig.closable;
        }

        if (!closable) {
            logger.info('[TADjsDesktop] closable=falseのためウィンドウを閉じることができません');
            this.closingWindows.delete(windowId);
            return;
        }

        // プラグインがある場合、クローズ確認を要求
        const iframe = window.element.querySelector('iframe');
        if (iframe && iframe.contentWindow) {
            const allowClose = await this.requestCloseConfirmation(windowId, iframe);
            if (!allowClose) {
                logger.info('[TADjsDesktop] プラグインによりクローズがキャンセルされました');
                this.closingWindows.delete(windowId);
                return;
            }
        }

        window.element.classList.add('closing');

        // 閉じられるウィンドウが子パネルウィンドウである場合、親プラグインに通知
        if (this.childPanelRelations && this.childPanelRelations[windowId]) {
            const relation = this.childPanelRelations[windowId];
            const parentWindow = document.getElementById(relation.parentWindowId);
            if (parentWindow) {
                const parentIframe = parentWindow.querySelector('iframe');
                if (parentIframe && parentIframe.contentWindow) {
                    parentIframe.contentWindow.postMessage({
                        type: 'child-panel-window-closed',
                        windowId: windowId,
                        panelType: relation.panelType
                    }, '*');
                }
            }
            delete this.childPanelRelations[windowId];
        }

        // 道具パネルウィンドウが存在する場合は閉じる
        if (this.toolPanelRelations) {
            logger.info('[TADjs] 閉じるウィンドウID:', windowId);
            logger.info('[TADjs] toolPanelRelations:', this.toolPanelRelations);

            // このウィンドウに関連する道具パネルを探す
            for (const [toolPanelWindowId, relation] of Object.entries(this.toolPanelRelations)) {
                logger.info('[TADjs] チェック中 toolPanelWindowId:', toolPanelWindowId);
                logger.info('[TADjs] relation.editorIframe:', relation.editorIframe);

                if (relation.editorIframe) {
                    const parentWindow = relation.editorIframe.closest('.window');
                    logger.info('[TADjs] parentWindow:', parentWindow, 'id:', parentWindow?.id);

                    if (parentWindow?.id === windowId) {
                        // 親ウィンドウが閉じられるので、道具パネルも閉じる
                        logger.info('[TADjs] 道具パネルウィンドウを閉じる:', toolPanelWindowId);
                        const toolPanelWindow = document.getElementById(toolPanelWindowId);
                        if (toolPanelWindow) {
                            // MessageBusから登録解除
                            this.parentMessageBus.unregisterChild(toolPanelWindowId);
                            toolPanelWindow.remove();
                            this.windows.delete(toolPanelWindowId);
                        }
                        delete this.toolPanelRelations[toolPanelWindowId];
                    }
                }
            }
        }

        // 検索/置換ウィンドウが存在する場合は閉じる
        if (this.findReplaceRelations) {
            for (const [findReplaceWindowId, relation] of Object.entries(this.findReplaceRelations)) {
                if (relation.editorWindowId === windowId) {
                    // 親ウィンドウが閉じられるので、検索/置換ウィンドウも閉じる
                    logger.info('[TADjs] 検索/置換ウィンドウを閉じる:', findReplaceWindowId);
                    const findReplaceWindow = document.getElementById(findReplaceWindowId);
                    if (findReplaceWindow) {
                        this.parentMessageBus.unregisterChild(findReplaceWindowId);
                        findReplaceWindow.remove();
                        this.windows.delete(findReplaceWindowId);
                    }
                    delete this.findReplaceRelations[findReplaceWindowId];
                }
            }
        }

        // 基本表計算用 検索/置換ウィンドウが存在する場合は閉じる
        if (this.calcFindReplaceRelations) {
            for (const [findReplaceWindowId, relation] of Object.entries(this.calcFindReplaceRelations)) {
                if (relation.editorWindowId === windowId) {
                    logger.info('[TADjs] 基本表計算 検索/置換ウィンドウを閉じる:', findReplaceWindowId);
                    const findReplaceWindow = document.getElementById(findReplaceWindowId);
                    if (findReplaceWindow) {
                        this.parentMessageBus.unregisterChild(findReplaceWindowId);
                        findReplaceWindow.remove();
                        this.windows.delete(findReplaceWindowId);
                    }
                    delete this.calcFindReplaceRelations[findReplaceWindowId];
                }
            }
        }

        // 子パネルウィンドウが存在する場合は閉じる
        if (this.childPanelRelations) {
            for (const [childPanelWindowId, relation] of Object.entries(this.childPanelRelations)) {
                if (relation.parentWindowId === windowId) {
                    const childPanelWindow = document.getElementById(childPanelWindowId);
                    if (childPanelWindow) {
                        this.parentMessageBus.unregisterChild(childPanelWindowId);
                        childPanelWindow.remove();
                        this.windows.delete(childPanelWindowId);
                    }
                    // 親プラグインに子パネルが閉じられたことを通知
                    const parentWindow = document.getElementById(windowId);
                    if (parentWindow) {
                        const parentIframe = parentWindow.querySelector('iframe');
                        if (parentIframe && parentIframe.contentWindow) {
                            parentIframe.contentWindow.postMessage({
                                type: 'child-panel-window-closed',
                                windowId: childPanelWindowId,
                                panelType: relation.panelType
                            }, '*');
                        }
                    }
                    delete this.childPanelRelations[childPanelWindowId];
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
                logger.info('[TADjs] 閉じたウィンドウを記録から削除:', realId, windowId);
                break;
            }
        }

        this.parentMessageBus.unregisterChild(windowId);
        logger.info(`[TADjs] Phase 2: 子を解除 windowId=${windowId}`);

        // フォーカス履歴から削除
        const historyIndex = this.windowFocusHistory.indexOf(windowId);
        if (historyIndex !== -1) {
            this.windowFocusHistory.splice(historyIndex, 1);
        }

        // アクティブウィンドウが閉じられた場合、履歴の最後のウィンドウにフォーカス
        const shouldFocusPrevious = this.activeWindow === windowId;

        setTimeout(() => {
            window.element.remove();
            this.windows.delete(windowId);
            this.closingWindows.delete(windowId);

            if (this.activeWindow === windowId) {
                this.activeWindow = null;

                // フォーカス履歴から前のウィンドウを探してフォーカス
                if (shouldFocusPrevious) {
                    // 履歴を後ろから辿って、まだ存在するウィンドウを探す
                    for (let i = this.windowFocusHistory.length - 1; i >= 0; i--) {
                        const prevWindowId = this.windowFocusHistory[i];
                        if (this.windows.has(prevWindowId)) {
                            logger.info('[TADjs] 前のウィンドウにフォーカスを移動:', prevWindowId);
                            this.setActiveWindow(prevWindowId);
                            break;
                        }
                    }
                }
            }
        }, window.WINDOW_CLOSE_CLEANUP_DELAY_MS);
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
            // プラグインがクローズ確認を必要としない場合でも、クリーンアップのためにクローズ通知を送信
            logger.info('[TADjsDesktop] プラグインにクローズ通知を送信（確認不要）:', pluginId);

            return new Promise((resolve) => {
                // コールバックを登録（短いタイムアウト付き）
                const timeoutId = setTimeout(() => {
                    delete this.closeConfirmCallbacks[windowId];
                    logger.info('[TADjsDesktop] クローズ通知タイムアウト、クローズを許可:', pluginId);
                    resolve(true);
                }, 500);

                this.closeConfirmCallbacks[windowId] = (allowClose) => {
                    clearTimeout(timeoutId);
                    logger.info('[TADjsDesktop] プラグインからクローズ応答（確認不要）:', allowClose);
                    resolve(true); // 確認不要の場合は常にtrue
                };

                // プラグインにクローズ要求を送信
                this.parentMessageBus.sendToWindow(windowId, 'window-close-request', {
                    windowId: windowId
                });
            });
        }

        // クローズ確認が必要なプラグインの場合
        logger.info('[TADjsDesktop] プラグインにクローズ確認を要求:', pluginId);

        // タイムアウト値（30秒 - プラグインがクラッシュした場合のフォールバック）
        const CLOSE_CONFIRM_TIMEOUT_MS = 30000;

        return new Promise((resolve) => {
            // タイムアウトを設定（プラグインが応答しない場合のフォールバック）
            const timeoutId = setTimeout(() => {
                logger.warn('[TADjsDesktop] クローズ確認タイムアウト、クローズを許可:', windowId);
                delete this.closeConfirmCallbacks[windowId];
                resolve(true);  // タイムアウト時はクローズを許可
            }, CLOSE_CONFIRM_TIMEOUT_MS);

            // コールバックを登録
            this.closeConfirmCallbacks[windowId] = (allowClose) => {
                clearTimeout(timeoutId);
                delete this.closeConfirmCallbacks[windowId];
                logger.info('[TADjsDesktop] プラグインからクローズ応答:', allowClose);
                resolve(allowClose);
            };

            // プラグインにクローズ要求を送信
            this.parentMessageBus.sendToWindow(windowId, 'window-close-request', {
                windowId: windowId
            });
        });
    }

    /**
     * ウィンドウが閉じたことをすべてのプラグインに通知
     */
    broadcastWindowClosed(windowId, windowInfo) {
        this.parentMessageBus.broadcast('window-closed', {
            windowId: windowId,
            fileData: windowInfo.fileData
        });
    }

    /**
     * ウィンドウの最大化/復元を切り替え（WindowManagerに委譲）
     * @param {string} windowId - 操作するウィンドウのID
     */
    toggleMaximizeWindow(windowId) {
        if (this.windowManager) {
            this.windowManager.toggleMaximizeWindow(windowId);

            // 即時スクロールバー更新（突き抜け防止）
            this.updateScrollbarsForWindow(windowId);

            // フォールバック: 全transition完了を確実に待つ
            // window-maximize-completedはheight/widthどちらか先の完了時点で発火するため
            // 両方完了後の最終更新として250ms後にも実行
            setTimeout(() => {
                this.updateScrollbarsForWindow(windowId);
            }, window.ANIMATION_COMPLETE_DELAY_MS);
        } else {
            logger.warn('[TADjs] WindowManagerが利用できません');
        }
    }

    /**
     * 指定ウィンドウのスクロールバーを更新
     * @param {string} windowId - ウィンドウID
     */
    updateScrollbarsForWindow(windowId) {
        const windowInfo = this.windows.get(windowId);
        if (!windowInfo) return;

        const windowElement = windowInfo.element;
        const iframe = windowElement.querySelector('iframe');
        const content = windowElement.querySelector('.window-content') || windowElement.querySelector('.tad-content');

        if (iframe && content) {
            const vScrollbar = windowElement.querySelector('.custom-scrollbar-vertical');
            const hScrollbar = windowElement.querySelector('.custom-scrollbar-horizontal');

            if (vScrollbar) {
                this.forceUpdateScrollbarForPlugin(iframe, content, vScrollbar, 'vertical');
            }
            if (hScrollbar) {
                this.forceUpdateScrollbarForPlugin(iframe, content, hScrollbar, 'horizontal');
            }
        } else if (content) {
            const scrollbars = windowElement.querySelectorAll('.custom-scrollbar');
            scrollbars.forEach(scrollbar => {
                const direction = scrollbar.classList.contains('vertical') ? 'vertical' : 'horizontal';
                this.forceUpdateScrollbar(content, scrollbar, direction);
            });
        }
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
        logger.info('[TADjs] プラグインにメッセージ転送:', pluginId, message.type);

        try {
            // 全てのプラグインウィンドウを探索
            const pluginWindows = document.querySelectorAll('.window iframe');
            let targetPluginWindow = null;

            logger.info('[TADjs] 検索中のプラグインID:', pluginId);
            logger.info('[TADjs] 存在するウィンドウ数:', pluginWindows.length);

            let targetIframe = null;
            for (const iframe of pluginWindows) {
                // iframe要素自体のdata-plugin-id属性をチェック
                const currentPluginId = iframe.dataset.pluginId;
                logger.info('[TADjs] 発見したプラグインID:', currentPluginId);
                if (currentPluginId === pluginId) {
                    targetIframe = iframe;
                    logger.info('[TADjs] ターゲットプラグイン発見:', pluginId);
                    break;
                }
            }

            if (!targetIframe) {
                logger.error('[TADjs] プラグインウィンドウが見つかりません:', pluginId);
                logger.error('[TADjs] 利用可能なプラグインID一覧:');
                pluginWindows.forEach(iframe => {
                    logger.error('  -', iframe.dataset.pluginId);
                });
                return;
            }

            const windowId = this.parentMessageBus.getWindowIdFromIframe(targetIframe);
            if (windowId) {
                this.parentMessageBus.sendToWindow(windowId, message.type, message);
            } else {
                logger.error('[TADjs] windowIdが見つかりません');
            }

        } catch (error) {
            logger.error('[TADjs] メッセージ転送エラー:', error);
        }
    }

    /**
     * 指定したウィンドウID内の特定のプラグインにメッセージを転送
     * @param {string} windowId - ターゲットウィンドウID
     * @param {string} pluginId - ターゲットプラグインID
     * @param {Object} message - 転送するメッセージ
     */
    async forwardMessageToPluginInWindow(windowId, pluginId, message) {
        logger.info('[TADjs] ウィンドウ内プラグインにメッセージ転送:', windowId, pluginId, message.type);

        try {
            // ウィンドウIDに対応するウィンドウ要素を探す
            const windowElement = document.querySelector(`.window[data-window-id="${windowId}"]`);

            if (!windowElement) {
                logger.error('[TADjs] ウィンドウが見つかりません:', windowId);
                return;
            }

            // そのウィンドウ内の指定されたプラグインIDのiframeを探す
            const iframe = windowElement.querySelector(`iframe[data-plugin-id="${pluginId}"]`);

            if (!iframe || !iframe.contentWindow) {
                logger.error('[TADjs] 指定されたプラグインが見つかりません:', windowId, pluginId);
                return;
            }

            logger.info('[TADjs] メッセージ送信:', windowId, pluginId, message);
            const msgWindowId = this.parentMessageBus.getWindowIdFromIframe(iframe);
            if (msgWindowId) {
                this.parentMessageBus.sendToWindow(msgWindowId, message.type, message);
            } else {
                logger.error('[TADjs] windowIdが見つかりません');
            }
        } catch (error) {
            logger.error('[TADjs] メッセージ転送エラー:', error);
        }
    }

    /**
     * 指定したウィンドウIDのプラグインにメッセージを転送
     * @param {string} windowId - ターゲットウィンドウID
     * @param {Object} message - 転送するメッセージ
     */
    async forwardMessageToWindow(windowId, message) {
        logger.info('[TADjs] ウィンドウIDにメッセージ転送:', windowId, message.type);

        try {
            // ウィンドウIDに対応するiframeを探す
            const windowElement = document.querySelector(`.window[data-window-id="${windowId}"]`);

            if (!windowElement) {
                logger.error('[TADjs] ウィンドウが見つかりません:', windowId);
                return;
            }

            const iframe = windowElement.querySelector('iframe[data-plugin-id]');

            if (!iframe || !iframe.contentWindow) {
                logger.error('[TADjs] iframeが見つかりません:', windowId);
                return;
            }

            logger.info('[TADjs] メッセージ送信:', windowId, message);
            const msgWindowId = this.parentMessageBus.getWindowIdFromIframe(iframe);
            if (msgWindowId) {
                this.parentMessageBus.sendToWindow(msgWindowId, message.type, message);
            } else {
                logger.error('[TADjs] windowIdが見つかりません');
            }
        } catch (error) {
            logger.error('[TADjs] メッセージ転送エラー:', error);
        }
    }

    /**
     * 指定したプラグインタイプの全ウィンドウにメッセージをブロードキャスト
     * @param {string} pluginId - ターゲットプラグインID
     * @param {Object} message - 転送するメッセージ
     */
    async broadcastMessageToPluginType(pluginId, message) {
        logger.info('[TADjs] プラグインタイプにブロードキャスト:', pluginId, message.type);

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
                        logger.info('[TADjs] メッセージ送信:', pluginId, message);
                        targetPluginWindow.postMessage(message, '*');
                        sentCount++;
                    }
                }
            }

            logger.info('[TADjs] ブロードキャスト完了:', sentCount, '個のウィンドウに送信');

        } catch (error) {
            logger.error('[TADjs] ブロードキャストエラー:', error);
        }
    }

    /**
     * unpack-fileから受信した実身ファイルセットを処理
     * @param {Array} files - 生成されたファイル情報の配列
     */
    async handleArchiveFilesGenerated(files, images = []) {
        logger.info('[TADjs] 実身ファイルセット受信処理開始:', files.length, '個のファイルエントリ、', images.length, '個の画像');

        try {
            // fileIdごとにJSONは1度だけ保存
            const savedJsons = new Set();

            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const recordNo = file.recordNo !== undefined ? file.recordNo : 0;

                logger.info(`[TADjs] ファイルエントリ ${i + 1}/${files.length}: ${file.name} (${file.fileId}, レコード: ${recordNo})`);

                // JSONデータをBlobに変換してfileObjectsに保存（実身ごとに1度だけ）
                if (!savedJsons.has(file.fileId)) {
                    const jsonBlob = new Blob([JSON.stringify(file.jsonData, null, 2)], { type: 'application/json' });
                    const jsonFile = new File([jsonBlob], `${file.fileId}.json`, { type: 'application/json' });
                    this.addFileToCache(`${file.fileId}.json`, jsonFile);
                    savedJsons.add(file.fileId);
                    logger.info(`[TADjs] JSONファイル保存（メモリ）: ${file.fileId}.json (実身名: ${file.name})`);

                    // Electron環境の場合、ディスクにも保存
                    try {
                        await this.saveDataFile(`${file.fileId}.json`, JSON.stringify(file.jsonData, null, 2));
                        logger.info(`[TADjs] JSONファイル保存（ディスク）成功: ${file.fileId}.json (実身名: ${file.name})`);
                    } catch (error) {
                        logger.error(`[TADjs] JSONファイルディスク保存エラー: ${file.fileId}.json (実身名: ${file.name})`, error);
                    }

                    // applistをチェックして、対応するプラグインの原紙icoファイルをコピー
                    await this.copyPluginIconForRealObject(file.fileId, file.jsonData);
                } else {
                    logger.info(`[TADjs] JSONファイルスキップ（既存）: ${file.fileId}.json (実身名: ${file.name})`);
                }

                // XTADデータをBlobに変換してfileObjectsに保存（レコードごと）
                if (file.xtadData) {
                    const xtadBlob = new Blob([file.xtadData], { type: 'application/xml' });
                    const xtadFileName = `${file.fileId}_${recordNo}.xtad`;
                    const xtadFile = new File([xtadBlob], xtadFileName, { type: 'application/xml' });
                    this.addFileToCache(xtadFileName, xtadFile);
                    logger.info(`[TADjs] XTADファイル保存（メモリ）: ${xtadFileName} (${file.xtadData.length} bytes)`);

                    // Electron環境の場合、ディスクにも保存
                    try {
                        await this.saveDataFile(xtadFileName, file.xtadData);
                        logger.info(`[TADjs] XTADファイル保存（ディスク）: ${xtadFileName}`);
                    } catch (error) {
                        logger.error(`[TADjs] XTADファイルディスク保存エラー: ${xtadFileName}`, error);
                    }
                } else {
                    logger.warn(`[TADjs] XTADデータがありません: ${file.name} レコード ${recordNo}`);
                }
            }

            // 画像ファイルを保存
            for (let i = 0; i < images.length; i++) {
                const image = images[i];
                const imgFileName = `${image.fileId}_${image.recordNo}_${image.imgNo}.png`;

                if (image.blob) {
                    const imgFile = new File([image.blob], imgFileName, { type: 'image/png' });
                    this.addFileToCache(imgFileName, imgFile);
                    logger.info(`[TADjs] 画像ファイル保存（メモリ）: ${imgFileName} (${image.width}x${image.height})`);

                    // Electron環境の場合、ディスクにも保存
                    try {
                        const arrayBuffer = await image.blob.arrayBuffer();
                        const uint8Array = new Uint8Array(arrayBuffer);
                        await this.saveDataFile(imgFileName, uint8Array);
                        logger.info(`[TADjs] 画像ファイル保存（ディスク）: ${imgFileName}`);
                    } catch (error) {
                        logger.error(`[TADjs] 画像ファイルディスク保存エラー: ${imgFileName}`, error);
                    }
                } else {
                    logger.warn(`[TADjs] 画像データがありません: ${imgFileName}`);
                }
            }

            logger.info('[TADjs] 実身ファイルセット処理完了（XTAD:', files.length, '個、画像:', images.length, '個）');

        } catch (error) {
            logger.error('[TADjs] 実身ファイルセット処理エラー:', error);
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
                logger.info(`[TADjs] applistがありません: ${fileId}`);
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
                logger.info(`[TADjs] defaultOpenなプラグインがありません: ${fileId}`);
                return;
            }

            logger.info(`[TADjs] defaultOpenプラグイン: ${defaultPluginId} for ${fileId}`);

            // プラグイン情報を取得
            if (!window.pluginManager) {
                logger.warn(`[TADjs] pluginManagerが見つかりません`);
                return;
            }

            const plugin = window.pluginManager.getPlugin(defaultPluginId);
            if (!plugin) {
                logger.warn(`[TADjs] プラグインが見つかりません: ${defaultPluginId}`);
                return;
            }

            // basefileのicoファイルパスを取得
            if (!plugin.basefile || !plugin.basefile.ico) {
                logger.info(`[TADjs] プラグインに原紙icoファイルがありません: ${defaultPluginId}`);
                return;
            }

            const baseIcoFileName = plugin.basefile.ico;
            const sourceIcoPath = `${plugin.path}/${baseIcoFileName}`;
            logger.info(`[TADjs] 原紙icoファイルパス: ${sourceIcoPath}`);

            // Electron環境でicoファイルをコピー
            if (this.isElectronEnv && this.fs && this.path) {
                try {
                    const basePath = this.getDataBasePath();
                    const destIcoPath = this.path.join(basePath, `${fileId}.ico`);

                    // 原紙icoファイルが存在するか確認
                    if (this.fs.existsSync(sourceIcoPath)) {
                        // icoファイルをコピー
                        this.fs.copyFileSync(sourceIcoPath, destIcoPath);
                        logger.info(`[TADjs] icoファイルコピー成功: ${sourceIcoPath} -> ${destIcoPath}`);
                    } else {
                        logger.warn(`[TADjs] 原紙icoファイルが見つかりません: ${sourceIcoPath}`);
                    }
                } catch (error) {
                    logger.error(`[TADjs] icoファイルコピーエラー: ${fileId}`, error);
                }
            }

        } catch (error) {
            logger.error(`[TADjs] copyPluginIconForRealObjectエラー: ${fileId}`, error);
        }
    }

    /**
     * コンテキストメニューを表示（ContextMenuManagerに委譲）
     * @param {number} x - X座標
     * @param {number} y - Y座標
     * @param {HTMLElement} target - ターゲット要素
     */
    async showContextMenu(x, y, target) {
        if (this.contextMenuManager) {
            await this.contextMenuManager.showContextMenu(x, y, target);
        } else {
            logger.warn('[TADjs] ContextMenuManagerが利用できません');
        }
    }

    /**
     * 仮身一覧プラグインから呼び出される：選択された仮身の実身を指定されたプラグインで開く
     * @param {Object} virtualObj - 仮身オブジェクト（link_idは実身のファイルID）
     * @param {string} pluginId - 起動するプラグインID
     */
    async openVirtualObjectReal(virtualObj, pluginId, messageId, source) {
        logger.debug('[TADjs] 仮身の実身を開く:', virtualObj.link_id, 'with', pluginId);

        try {
            // link_idから実身ID（UUID）を抽出
            // 形式: "実身ID_recordNo.xtad" または "実身ID" または "実身ID.json"
            const fullRealId = virtualObj.link_id; // _0.xtad付きのフルID

            // 実身IDを抽出（共通メソッドを使用）
            const realId = window.RealObjectSystem.extractRealId(fullRealId);

            logger.debug('[TADjs] 実身ID抽出:', realId, 'フルID:', fullRealId);

            // 既に開いているウィンドウがあればアクティブにして処理を終了
            if (this.openedRealObjects.has(realId)) {
                const existingWindowId = this.openedRealObjects.get(realId);
                logger.info('[TADjs] 実身は既に開いています:', realId, 'ウィンドウID:', existingWindowId);
                // ウィンドウをアクティブにする
                this.setActiveWindow(existingWindowId);
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
                logger.info('[TADjs] BPKファイル:', fileName);

                // fileObjectsからファイルを取得
                let file = this.fileObjects[fileName];

                // fileObjectsに無い場合はloadDataFileAsFileで読み込む
                if (!file) {
                    logger.info('[TADjs] BPKファイルを読み込みます:', fileName);
                    file = await this.loadDataFileAsFile(fileName);
                    if (file) {
                        this.addFileToCache(fileName, file);
                    } else {
                        throw new Error(`ファイルが見つかりません: ${fileName}`);
                    }
                }

                // BPKファイルをバイト配列に変換
                const uint8Array = await this.getFileAsUint8Array(file);

                // プラグインに渡すデータを準備
                const fileData = {
                    realId: fullRealId,  // _0.xtad付きのフルID
                    fileName: fileName,
                    fileData: file,
                    rawData: Array.from(uint8Array),
                    name: virtualObj.link_name || fileName,  // 実身名
                    displayName: virtualObj.link_name || fileName,
                    isBPK: true  // BPKファイルであることを示すフラグ
                };

                // プラグインを起動
                let windowId = null;
                if (window.pluginManager) {
                    windowId = await window.pluginManager.launchPlugin(pluginId, fileData);
                    logger.info('[TADjs] BPKファイルをプラグインで開きました:', pluginId, 'windowId:', windowId);
                    // 開いたウィンドウを記録
                    if (windowId) {
                        this.openedRealObjects.set(realId, windowId);
                    }
                } else {
                    logger.error('[TADjs] プラグインマネージャーが見つかりません');
                }

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

            // tadjs-viewer/tadjs-viewまたはunpack-fileプラグインの場合は、BPKファイルを開く
            if (pluginId === 'tadjs-viewer' || pluginId === 'tadjs-view' || pluginId === 'unpack-file') {
                // link_idから実身IDを抽出し、実身ID.bpkファイルを探す
                const bpkFileName = `${realId}.bpk`;
                logger.info('[TADjs] BPKファイルを開く:', bpkFileName, 'プラグイン:', pluginId);

                // fileObjectsからファイルを取得
                let file = this.fileObjects[bpkFileName];

                // fileObjectsに無い場合はloadDataFileAsFileで読み込む
                if (!file) {
                    logger.info('[TADjs] BPKファイルを読み込みます:', bpkFileName);
                    file = await this.loadDataFileAsFile(bpkFileName);
                    if (file) {
                        this.addFileToCache(bpkFileName, file);
                    } else {
                        throw new Error(`BPKファイルが見つかりません: ${bpkFileName}`);
                    }
                }

                // ファイルをバイト配列に変換
                const uint8Array = await this.getFileAsUint8Array(file);

                // プラグインに渡すデータを準備
                const fileData = {
                    realId: fullRealId,  // _0.xtad付きのフルID
                    fileId: fullRealId,  // 互換性のため
                    fileName: bpkFileName,
                    fileData: file,
                    rawData: Array.from(uint8Array),
                    name: virtualObj.link_name || bpkFileName,  // 実身名
                    displayName: virtualObj.link_name || bpkFileName,
                    isBPK: true  // BPKファイルであることを示すフラグ
                };

                const windowId = await window.pluginManager.launchPlugin(pluginId, fileData);
                logger.info(`[TADjs] ${pluginId}プラグインで実身を開きました:`, bpkFileName, 'windowId:', windowId);

                // 開いたウィンドウを記録
                if (windowId) {
                    this.openedRealObjects.set(realId, windowId);

                    // ウィンドウのアイコンを設定（DOMが準備されるまで少し待つ）
                    const iconPath = `${realId}.ico`;
                    setTimeout(() => {
                        this.setWindowIcon(windowId, iconPath);
                    }, window.ICON_SET_DELAY_MS);
                }

                // ウィンドウをアクティブにする
                if (windowId) {
                    logger.debug('[TADjs] ウィンドウをアクティブにします:', windowId);
                    // DOMが完全に更新されるまで少し待つ
                    setTimeout(() => {
                        this.setActiveWindow(windowId);
                        logger.debug('[TADjs] setActiveWindow呼び出し完了:', windowId);
                     }, window.UI_UPDATE_DELAY_MS);
                } else {
                    logger.warn('[TADjs] windowIdがnullのためアクティブ化できません');
                }

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
            const jsonFileName = window.RealObjectSystem.getRealObjectJsonFileName(realId);
            let jsonFile = this.fileObjects[jsonFileName];

            if (!jsonFile) {
                logger.debug('[TADjs] JSONファイルを読み込みます:', jsonFileName);
                jsonFile = await this.loadDataFileAsFile(jsonFileName);
                if (jsonFile) {
                    this.addFileToCache(jsonFileName, jsonFile);
                } else {
                    throw new Error(`JSONファイルが見つかりません: ${jsonFileName}`);
                }
            }

            // JSONをパース
            const jsonText = await jsonFile.text();
            const jsonData = JSON.parse(jsonText);
            logger.debug('[TADjs] JSON読み込み完了:', jsonData.name);

            // accessDateを更新
            jsonData.accessDate = new Date().toISOString();
            const accessDateSaved = await this.saveDataFile(jsonFileName, JSON.stringify(jsonData, null, 2));
            if (accessDateSaved) {
                logger.debug('[TADjs] accessDate更新完了:', realId);
                // JSONファイルのキャッシュをクリア
                delete this.fileObjects[jsonFileName];
            } else {
                logger.warn('[TADjs] accessDate更新失敗:', jsonFileName);
            }

            // デフォルトレコード（0番）のXTADファイルを読み込む
            const xtadFileName = `${realId}_0.xtad`;
            let xtadFile = this.fileObjects[xtadFileName];

            if (!xtadFile) {
                logger.debug('[TADjs] XTADファイルを読み込みます:', xtadFileName);
                xtadFile = await this.loadDataFileAsFile(xtadFileName);
                if (xtadFile) {
                    this.addFileToCache(xtadFileName, xtadFile);
                } else {
                    throw new Error(`XTADファイルが見つかりません: ${xtadFileName}`);
                }
            }

            // XTADファイルをUint8Arrayに変換
            const arrayBuffer = await xtadFile.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);

            // XTADファイルをXMLとして読み込む（既にXML形式）
            let xmlData = '';
            try {
                xmlData = await xtadFile.text();
                logger.debug(`[TADjs] XTAD読み込み完了: ${xmlData.length}文字`);
            } catch (error) {
                logger.error('[TADjs] XTAD読み込みエラー:', error);
                logger.warn('[TADjs] XMLデータが空のままプラグインを起動します');
            }

            // プラグインに渡すデータを準備
            const fileData = {
                realId: fullRealId,          // _0.xtad付きのフルID
                fileName: xtadFileName,       // XTADファイル名
                fileData: xtadFile,          // XTADファイルオブジェクト
                rawData: Array.from(uint8Array), // XTADのバイトデータ
                xmlData: xmlData,            // XML文字列
                realObject: jsonData,        // 実身管理用セグメント（JSON）
                windowConfig: jsonData.window || null, // ウィンドウ設定
                name: jsonData.name || virtualObj.link_name || realId,  // 実身名
                displayName: jsonData.name || virtualObj.link_name || realId
            };

            // プラグインを起動
            let windowId = null;
            if (window.pluginManager) {
                windowId = await window.pluginManager.launchPlugin(pluginId, fileData);
                logger.debug('[TADjs] プラグインで実身を開きました:', pluginId, 'windowId:', windowId);

                // 開いたウィンドウを記録
                if (windowId) {
                    this.openedRealObjects.set(realId, windowId);

                    // ウィンドウのアイコンを設定（DOMが準備されるまで少し待つ）
                    const iconPath = `${realId}.ico`;
                    setTimeout(() => {
                        this.setWindowIcon(windowId, iconPath);
                    }, window.ICON_SET_DELAY_MS);
                }

                // ウィンドウをアクティブにする
                if (windowId) {
                    logger.debug('[TADjs] ウィンドウをアクティブにします:', windowId);
                    // DOMが完全に更新されるまで少し待つ
                    setTimeout(() => {
                        this.setActiveWindow(windowId);
                        logger.debug('[TADjs] setActiveWindow呼び出し完了:', windowId);
                     }, window.UI_UPDATE_DELAY_MS);
                } else {
                    logger.warn('[TADjs] windowIdがnullのためアクティブ化できません');
                }
            } else {
                logger.error('[TADjs] プラグインマネージャーが見つかりません');
            }

            if (messageId && source) {
                source.postMessage({
                    type: 'window-opened',
                    messageId: messageId,
                    success: !!windowId,
                    windowId: windowId
                }, '*');
            }
        } catch (error) {
            logger.error('[TADjs] 実身を開くエラー:', error);
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
    /**
     * 共通のウィンドウメニュー項目を生成（ContextMenuManagerに委譲）
     * @param {string} windowId - ウィンドウID
     * @returns {Array} メニュー項目の配列
     */
    generateCommonWindowMenuItems(windowId) {
        if (this.contextMenuManager) {
            return this.contextMenuManager.generateCommonWindowMenuItems(windowId);
        }
        logger.warn('[TADjs] ContextMenuManagerが利用できません');
        return [];
    }

    /**
     * コンテキストメニュー項目を生成（ContextMenuManagerに委譲）
     * @param {HTMLElement} target - ターゲット要素
     * @returns {Promise<Array>} メニュー項目の配列
     */
    async generateContextMenuItems(target) {
        if (this.contextMenuManager) {
            return await this.contextMenuManager.generateContextMenuItems(target);
        }
        logger.warn('[TADjs] ContextMenuManagerが利用できません');
        return [];
    }

    /**
     * コンテキストメニューを作成・表示（ContextMenuManagerに委譲）
     * @param {Array<Object>} items - メニュー項目の配列
     * @param {number} x - メニューのX座標
     * @param {number} y - メニューのY座標
     */
    createContextMenu(items, x, y) {
        if (this.contextMenuManager) {
            this.contextMenuManager.createContextMenu(items, x, y);
        } else {
            logger.warn('[TADjs] ContextMenuManagerが利用できません');
        }
    }

    /**
     * メニュー項目をレンダリング（ContextMenuManagerに委譲）
     * @param {HTMLElement} container - メニュー項目を追加するコンテナ要素
     * @param {Array<Object>} items - メニュー項目の配列
     */
    renderMenuItems(container, items) {
        if (this.contextMenuManager) {
            this.contextMenuManager.renderMenuItems(container, items);
        } else {
            logger.warn('[TADjs] ContextMenuManagerが利用できません');
        }
    }

    /**
     * サブメニューの位置を画面内に収まるように調整（ContextMenuManagerに委譲）
     * @param {HTMLElement} submenu - 調整するサブメニュー要素
     */
    adjustSubmenuPosition(submenu) {
        if (this.contextMenuManager) {
            this.contextMenuManager.adjustSubmenuPosition(submenu);
        } else {
            logger.warn('[TADjs] ContextMenuManagerが利用できません');
        }
    }

    /**
     * コンテキストメニューを非表示にする（ContextMenuManagerに委譲）
     */
    hideContextMenu() {
        if (this.contextMenuManager) {
            this.contextMenuManager.hideContextMenu();
        } else {
            logger.warn('[TADjs] ContextMenuManagerが利用できません');
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
    }

    /**
     * メニューアクションを処理（ContextMenuManagerに委譲）
     * @param {string} action - 実行するアクション名
     * @param {*} data - アクションに渡すデータ
     */
    handleMenuAction(action, data) {
        if (this.contextMenuManager) {
            this.contextMenuManager.handleMenuAction(action, data);
        } else {
            logger.warn('[TADjs] ContextMenuManagerが利用できません');
        }
    }

    /**
     * プラグインアクションを処理（ContextMenuManagerに委譲）
     * @param {string} action - 実行するアクション名
     * @param {Object} data - アクションに渡すデータ
     */
    handlePluginAction(action, data) {
        if (this.contextMenuManager) {
            this.contextMenuManager.handlePluginAction(action, data);
        } else {
            logger.warn('[TADjs] ContextMenuManagerが利用できません');
        }
    }

    /**
     * プラグインからメニュー定義を取得（ContextMenuManagerに委譲）
     * @param {HTMLIFrameElement} iframe - プラグインのiframe要素
     * @param {string} windowId - ウィンドウID
     * @returns {Promise<Array>} メニュー項目の配列
     */
    getPluginMenuDefinition(iframe, windowId) {
        if (this.contextMenuManager) {
            return this.contextMenuManager.getPluginMenuDefinition(iframe, windowId);
        }
        logger.warn('[TADjs] ContextMenuManagerが利用できません');
        return Promise.resolve([]);
    }

    /**
     * プラグインのメニュー定義をパースして、actionにplugin-プレフィックスとwindowIdを追加
     * （ContextMenuManagerに委譲）
     */
    parsePluginMenuDefinition(menuDef, windowId) {
        if (this.contextMenuManager) {
            return this.contextMenuManager.parsePluginMenuDefinition(menuDef, windowId);
        }
        logger.warn('[TADjs] ContextMenuManagerが利用できません');
        return [];
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

                    logger.info('[TADjs] プラグインコンテンツサイズ更新:', { height, width });
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
            logger.debug('parseTADToXML関数チェック:', typeof parseTADToXML);
            if (typeof parseTADToXML === 'function') {
                logger.debug('parseTADToXML呼び出し開始, データサイズ:', uint8Array.length);
                try {
                    xmlData = await parseTADToXML(uint8Array, 0);
                    logger.debug(`XML変換完了: ${xmlData.length}文字`);
                } catch (error) {
                    logger.error('parseTADToXML実行エラー:', error);
                }
            } else {
                logger.warn('parseTADToXML関数が見つかりません');
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
            logger.error('プラグイン起動エラー:', error);
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
            logger.warn('Window not found:', windowId);
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
                        logger.debug(`Using originalLinkId as fileIndex: ${fileIndex} for canvas ${canvasId}`);
                    } else {
                        // それでも取得できない場合は、canvasNumberを使用（フォールバック）
                        fileIndex = canvasNumber;
                        logger.warn(`Using canvasNumber as fileIndex: ${fileIndex} for canvas ${canvasId}`);
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
                
                logger.debug(`Toggling paper mode: fileIndex=${fileIndex}, canvasNumber=${canvasNumber}, newMode=${newMode}`);
                
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
            logger.warn('Window not found:', windowId);
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
            logger.warn('Window not found:', windowId);
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
                <div style="width: 500px; padding: 10px; background: ${window.DIALOG_BG_COLOR};">
                    <p>拡張属性テーブル（横スクロールテスト用）</p>
                    <table style="width: 100%; border: 1px solid ${window.BORDER_COLOR};">
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
            logger.debug(`Scroll event: ${direction} direction`);
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
     * デスクトップに背景を適用（UISettingsManagerに委譲）
     * @param {string} bgId - 背景のID（'none'の場合は背景なし）
     */
    applyBackgroundToDesktop(bgId) {
        if (this.uiSettingsManager) {
            this.uiSettingsManager.applyBackgroundToDesktop(bgId);
        } else {
            logger.warn('[TADjs] UISettingsManagerが利用できません');
        }
    }

    /**
     * ユーザー環境設定を適用（UISettingsManagerに委譲）
     */
    applyUserConfig() {
        if (this.uiSettingsManager) {
            this.uiSettingsManager.applyUserConfig();
            // currentUserをUISettingsManagerから同期
            this.currentUser = this.uiSettingsManager.getCurrentUser();
        } else {
            logger.warn('[TADjs] UISettingsManagerが利用できません');
        }
    }

    /**
     * 現在の使用者名を取得
     * @param {MessageEvent} e - メッセージイベント
     */
    handleGetCurrentUser(e) {
        const currentUser = this.currentUser || 'TRON User';

        if (e.source) {
            e.source.postMessage({
                type: 'current-user-response',
                currentUser: currentUser
            }, '*');
        }
    }

    /**
     * すべてのウィンドウのリサイズハンドルを無効化
     */
    disableAllWindowResize() {
        logger.info('[TADjs] ウィンドウリサイズを一時無効化');
        document.querySelectorAll('.window .resize-handle').forEach(handle => {
            handle.style.pointerEvents = 'none';
        });
    }

    /**
     * すべてのウィンドウのリサイズハンドルを再有効化
     */
    enableAllWindowResize() {
        logger.info('[TADjs] ウィンドウリサイズを再有効化');
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
     * ツールパネルから対応するエディタiframeを取得（ToolPanelManagerに委譲）
     * @param {Window} toolPanelWindow - ツールパネルのWindow
     * @returns {HTMLIFrameElement|null} エディタのiframe
     */
    getEditorFrameFromToolPanel(toolPanelWindow) {
        if (this.toolPanelManager) {
            return this.toolPanelManager.getEditorFrameFromToolPanel(toolPanelWindow);
        } else {
            logger.warn('[TADjs] ToolPanelManagerが利用できません');
            return null;
        }
    }

    /**
     * ツールパネルポップアップからソースへメッセージを送信（ToolPanelManagerに委譲）
     * @param {Window} source - ツールパネルのWindow
     * @param {string} type - メッセージタイプ
     * @param {Object} data - 送信データ
     */
    sendToToolPanelSource(source, type, data = {}) {
        if (this.toolPanelManager) {
            this.toolPanelManager.sendToToolPanelSource(source, type, data);
        } else {
            logger.warn('[TADjs] ToolPanelManagerが利用できません');
        }
    }

    /**
     * ツールパネルからエディタへメッセージを送信（ToolPanelManagerに委譲）
     * @param {Window} source - ツールパネルのWindow
     * @param {string} type - メッセージタイプ
     * @param {Object} data - 送信データ
     */
    sendToEditorFromToolPanel(source, type, data = {}) {
        if (this.toolPanelManager) {
            this.toolPanelManager.sendToEditorFromToolPanel(source, type, data);
        } else {
            logger.warn('[TADjs] ToolPanelManagerが利用できません');
        }
    }

    /**
     * メッセージダイアログを表示
     * @param {string} message - 表示するメッセージ
     * @param {Array<{label: string, value: any}>} buttons - ボタン定義の配列
     * @param {number} defaultButton - デフォルトボタンのインデックス (0始まり)
     * @returns {Promise<any>} - 選択されたボタンのvalue
     */
    /**
     * ツールパネルウィンドウを開く（ToolPanelManagerに委譲）
     * @param {string} pluginId - プラグインID
     * @param {Object} settings - 設定
     * @param {HTMLIFrameElement} pluginIframe - プラグインのiframe
     * @param {Object} panelpos - パネル位置 {x, y}
     * @param {Object} panelsize - パネルサイズ {width, height}
     */
    openToolPanelWindow(pluginId, settings, pluginIframe, panelpos, panelsize) {
        if (this.toolPanelManager) {
            this.toolPanelManager.openToolPanelWindow(pluginId, settings, pluginIframe, panelpos, panelsize);
        } else {
            logger.warn('[TADjs] ToolPanelManagerが利用できません');
        }
    }

    /**
     * ツールパネルポップアップを表示（ToolPanelManagerに委譲）
     * @param {Object} data - ポップアップデータ {htmlContent, x, y}
     * @param {Window} source - ツールパネルのWindow
     */
    showToolPanelPopup(data, source) {
        if (this.toolPanelManager) {
            this.toolPanelManager.showToolPanelPopup(data, source);
        } else {
            logger.warn('[TADjs] ToolPanelManagerが利用できません');
        }
    }

    /**
     * ツールパネルポップアップを非表示（ToolPanelManagerに委譲）
     */
    hideToolPanelPopup() {
        if (this.toolPanelManager) {
            this.toolPanelManager.hideToolPanelPopup();
        } else {
            logger.warn('[TADjs] ToolPanelManagerが利用できません');
        }
    }

    /**
     * 画像ファイルを保存（RealObjectSystemに委譲）
     * @param {string} fileName ファイル名
     * @param {Array|Uint8Array} imageDataArray 画像データ
     * @returns {boolean} 成功/失敗
     */
    saveImageFile(fileName, imageDataArray) {
        if (this.realObjectSystem) {
            return this.realObjectSystem.saveImageFile(fileName, imageDataArray);
        }
        logger.warn('[TADjs] RealObjectSystemが利用できません');
        return false;
    }

    /**
     * 画像ファイルを読み込み（RealObjectSystemに委譲）
     * @param {string} fileName ファイル名
     * @param {string} messageId メッセージID
     * @param {Window} source レスポンス送信先
     */
    loadImageFile(fileName, messageId, source) {
        if (this.realObjectSystem) {
            this.realObjectSystem.loadImageFile(fileName, messageId, source);
        } else {
            logger.warn('[TADjs] RealObjectSystemが利用できません');
            source.postMessage({
                type: 'load-image-response',
                messageId: messageId,
                success: false,
                error: 'RealObjectSystem not available'
            }, '*');
        }
    }

    /**
     * メッセージダイアログを表示（DialogManagerに委譲）
     * @param {string} message - 表示するメッセージ
     * @param {Array<{label: string, value: any}>} buttons - ボタン定義の配列
     * @param {number} defaultButton - デフォルトボタンのインデックス (0始まり)
     * @returns {Promise<any>} - 選択されたボタンの値
     */
    showMessageDialog(message, buttons, defaultButton = 0) {
        if (this.dialogManager) {
            return this.dialogManager.showMessageDialog(message, buttons, defaultButton);
        }
        // フォールバック: ブラウザ標準ダイアログ
        logger.warn('[TADjs] DialogManagerが利用できません、ブラウザ標準ダイアログを使用');
        const confirmed = confirm(message);
        const resultValue = confirmed
            ? (buttons[defaultButton]?.value ?? buttons[0]?.value)
            : (buttons[0]?.value ?? 'cancel');
        return Promise.resolve(resultValue);
    }

    /**
     * メッセージダイアログを非表示にする（DialogManagerに委譲）
     */
    hideMessageDialog() {
        if (this.dialogManager) {
            this.dialogManager.hideMessageDialog();
        } else {
            logger.warn('[TADjs] DialogManagerが利用できません');
        }
    }

    /**
     * 入力ダイアログを表示（DialogManagerに委譲）
     * @param {string} message - 表示するメッセージ
     * @param {string} defaultValue - 入力欄のデフォルト値
     * @param {number} inputWidth - 入力欄の幅（文字数）
     * @param {Array<{label: string, value: any}>} buttons - ボタン定義の配列
     * @param {number} defaultButton - デフォルトボタンのインデックス (0始まり)
     * @param {Object} options - オプション
     * @param {boolean} options.colorPicker - カラーピッカーを表示するかどうか
     * @returns {Promise<{button: any, value: string}>} - 選択されたボタンと入力値
     */
    showInputDialog(message, defaultValue = '', inputWidth = window.DEFAULT_INPUT_WIDTH, buttons = [{ label: '取消', value: 'cancel' }, { label: 'OK', value: 'ok' }], defaultButton = 1, options = {}) {
        if (this.dialogManager) {
            return this.dialogManager.showInputDialog(message, defaultValue, inputWidth, buttons, defaultButton, options);
        }
        // フォールバック: ブラウザ標準ダイアログ
        logger.warn('[TADjs] DialogManagerが利用できません、ブラウザ標準ダイアログを使用');
        const inputValue = prompt(message, defaultValue);
        if (inputValue === null) {
            // キャンセル
            return Promise.resolve({ button: 'cancel', value: '' });
        }
        // OKボタンの値を使用
        const okButton = buttons.find(b => b.value === 'ok') || buttons[defaultButton];
        return Promise.resolve({ button: okButton?.value ?? 'ok', value: inputValue });
    }

    /**
     * 入力ダイアログを非表示にする（DialogManagerに委譲）
     */
    hideInputDialog() {
        if (this.dialogManager) {
            this.dialogManager.hideInputDialog();
        } else {
            logger.warn('[TADjs] DialogManagerが利用できません');
        }
    }

    /**
     * カスタムダイアログを表示（DialogManagerに委譲）
     * @param {string} dialogHtml - ダイアログ内に表示するHTML
     * @param {Array<{label: string, value: any}>} buttons - ボタン定義の配列
     * @param {number} defaultButton - デフォルトボタンのインデックス (0始まり)
     * @param {Object} inputs - 入力要素のID {checkbox: 'id1', text: 'id2', radios: {key: 'radioName'}}
     * @returns {Promise<{button: any, checkbox: boolean, input: string, radios: Object, inputs: Object, dialogElement: Element}>}
     */
    showCustomDialog(dialogHtml, buttons, defaultButton = 0, inputs = {}) {
        if (this.dialogManager) {
            return this.dialogManager.showCustomDialog(dialogHtml, buttons, defaultButton, inputs);
        }
        logger.warn('[TADjs] DialogManagerが利用できません');
        return Promise.resolve({ button: 'cancel', checkbox: false, input: '', radios: {}, inputs: {}, dialogElement: null });
    }

    // ========================================
    // MessageRouter ヘルパーメソッド (Phase 1)
    // ========================================

    /**
     * レスポンス送信ヘルパー
     * @param {Window} source - イベントソース
     * @param {string} responseType - レスポンスメッセージタイプ
     * @param {Object} data - レスポンスデータ
     * @param {string} messageId - メッセージID（オプション）
     * @param {string} sourceWindowId - 送信元のwindowId（オプション、source解決失敗時のフォールバック）
     * @returns {boolean} 送信成功したか
     */
    respond(source, responseType, data, messageId = null, sourceWindowId = null) {
        if (!source && !sourceWindowId) {
            logger.error(`[TADjs] Cannot send ${responseType}: source and sourceWindowId are both null`);
            return false;
        }

        const responseData = messageId
            ? { messageId, ...data }
            : data;

        try {
            this.parentMessageBus.respondTo(source, responseType, responseData, sourceWindowId);
            return true;
        } catch (error) {
            logger.error(`[TADjs] Failed to send ${responseType}:`, error);
            return false;
        }
    }

    /**
     * エラーレスポンスヘルパー
     * @param {Window} source - イベントソース
     * @param {string} responseType - レスポンスメッセージタイプ
     * @param {Error|string} error - エラーオブジェクトまたはメッセージ
     * @param {string} messageId - メッセージID（オプション）
     * @param {string} sourceWindowId - 送信元のwindowId（オプション）
     * @returns {boolean} 送信成功したか
     */
    respondError(source, responseType, error, messageId = null, sourceWindowId = null) {
        return this.respond(source, responseType, {
            success: false,
            error: error.message || error
        }, messageId, sourceWindowId);
    }

    /**
     * 成功レスポンスヘルパー
     * @param {Window} source - イベントソース
     * @param {string} responseType - レスポンスメッセージタイプ
     * @param {Object} data - レスポンスデータ
     * @param {string} messageId - メッセージID（オプション）
     * @param {string} sourceWindowId - 送信元のwindowId（オプション）
     * @returns {boolean} 送信成功したか
     */
    respondSuccess(source, responseType, data = {}, messageId = null, sourceWindowId = null) {
        return this.respond(source, responseType, {
            success: true,
            ...data
        }, messageId, sourceWindowId);
    }

    // ========================================
    // Phase A: 拡張レスポンスヘルパー
    // ========================================

    /**
     * 安全にレスポンスを送信（event全体から自動抽出）
     * @param {Object} event - メッセージイベント
     * @param {string} responseType - レスポンスタイプ
     * @param {Object} data - レスポンスデータ
     * @returns {boolean} 送信成功したか
     */
    safeRespondTo(event, responseType, data) {
        if (!event || !event.source) {
            logger.warn(`[TADjs] sourceが存在しないためレスポンス送信をスキップ: ${responseType}`);
            return false;
        }

        const messageId = event.data?.messageId;
        return this.respond(event.source, responseType, data, messageId);
    }

    /**
     * 操作成功レスポンスを送信（success: true付き）
     * @param {Object} event - メッセージイベント
     * @param {string} responseType - レスポンスタイプ
     * @param {Object} result - 結果データ
     * @returns {boolean} 送信成功したか
     */
    respondOperationSuccess(event, responseType, result = {}) {
        return this.safeRespondTo(event, responseType, {
            success: true,
            ...result
        });
    }

    /**
     * 操作エラーレスポンスを送信（success: false付き）
     * @param {Object} event - メッセージイベント
     * @param {string} responseType - レスポンスタイプ
     * @param {Error|string} error - エラー
     * @returns {boolean} 送信成功したか
     */
    respondOperationError(event, responseType, error) {
        return this.safeRespondTo(event, responseType, {
            success: false,
            error: error.message || error
        });
    }

    // ========================================
    // Phase A/D: ログヘルパー（logger.jsに委譲）
    // ========================================

    /**
     * 操作情報ログ（操作名付き）
     * logger.jsのlogOperation()に委譲
     * @param {string} operation - 操作名
     * @param {string} message - ログメッセージ
     * @param {any} data - 追加データ（オプション）
     */
    logInfo(operation, message, data = null) {
        logger.logOperation(operation, message, data);
    }

    /**
     * 操作エラーログ（操作名付き）
     * logger.jsのlogOperationError()に委譲
     * @param {string} operation - 操作名
     * @param {Error|string} error - エラー
     * @param {any} context - コンテキスト情報（オプション）
     */
    logError(operation, error, context = null) {
        logger.logOperationError(operation, error, context);
    }

    /**
     * 操作警告ログ（操作名付き）
     * logger.jsのlogOperationWarn()に委譲
     * @param {string} operation - 操作名
     * @param {string} message - 警告メッセージ
     * @param {any} data - 追加データ（オプション）
     */
    logWarn(operation, message, data = null) {
        logger.logOperationWarn(operation, message, data);
    }

    // ========================================
    // Phase A: ウィンドウ操作ヘルパー
    // ========================================

    /**
     * ウィンドウIDを安全に取得
     * @param {HTMLElement|HTMLIFrameElement|Window} source - ソース要素またはウィンドウ
     * @param {boolean} throwOnMissing - 見つからない場合にエラーをスローするか
     * @returns {string|null} ウィンドウID
     */
    getWindowIdSafely(source, throwOnMissing = false) {
        let windowId = null;

        if (!source) {
            this.logWarn('ウィンドウID取得', 'sourceがnullです');
            if (throwOnMissing) {
                throw new Error('sourceがnullです');
            }
            return null;
        }

        // HTMLElementでdataset.windowIdを持つ場合
        if (source instanceof HTMLElement && source.dataset?.windowId) {
            windowId = source.dataset.windowId;
        }
        // HTMLIFrameElementの場合
        else if (source instanceof HTMLIFrameElement) {
            windowId = this.parentMessageBus.getWindowIdFromIframe(source);
        }
        // Windowオブジェクトの場合
        else if (source.contentWindow) {
            windowId = this.parentMessageBus.getWindowIdFromSource(source.contentWindow);
        }
        // Windowオブジェクト直接の場合
        else if (typeof source === 'object' && source.postMessage) {
            windowId = this.parentMessageBus.getWindowIdFromSource(source);
        }

        if (!windowId) {
            this.logWarn('ウィンドウID取得', 'windowIdが見つかりませんでした');
            if (throwOnMissing) {
                throw new Error('windowIdが見つかりませんでした');
            }
        }

        return windowId;
    }

    /**
     * ウィンドウにメッセージを安全に送信
     * @param {string|HTMLElement|HTMLIFrameElement|Window} windowIdOrSource - windowIDまたはソース要素
     * @param {string} messageType - メッセージタイプ
     * @param {Object} data - メッセージデータ
     * @returns {boolean} 送信成功したか
     */
    sendToWindowSafely(windowIdOrSource, messageType, data) {
        const windowId = typeof windowIdOrSource === 'string'
            ? windowIdOrSource
            : this.getWindowIdSafely(windowIdOrSource);

        if (windowId) {
            this.parentMessageBus.sendToWindow(windowId, messageType, data);
            return true;
        }

        this.logWarn('ウィンドウメッセージ送信', `windowIdが取得できず、${messageType}メッセージを送信できませんでした`);
        return false;
    }

    // ========================================
    // Phase B: RealObjectSystem操作統一ラッパー
    // ========================================

    /**
     * RealObjectSystem操作の統一ラッパー
     *
     * @param {MessageEvent} event - メッセージイベント
     * @param {string} operationName - 操作名（ログ用）
     * @param {Function} operation - 実行する操作関数 async (realObjectSystem, data) => result
     * @param {string} successType - 成功時のレスポンスタイプ
     * @param {Object} options - オプション
     * @param {string} options.errorType - エラー時のレスポンスタイプ（デフォルト: 'real-object-error'）
     * @param {boolean} options.requireRealObjectSystem - realObjectSystemチェックを行うか（デフォルト: true）
     * @param {Function} options.postProcess - 操作成功後の追加処理 (result, event) => modifiedResult
     * @returns {Promise<any>} 操作結果
     */
    async executeRealObjectOperation(event, operationName, operation, successType, options = {}) {
        const {
            errorType = 'real-object-error',
            requireRealObjectSystem = true,
            postProcess = null
        } = options;

        // realObjectSystemの初期化チェック
        if (requireRealObjectSystem && !this.realObjectSystem) {
            const errorMsg = '実身仮身システムが初期化されていません';
            this.logError(operationName, errorMsg);
            this.respondOperationError(event, errorType, errorMsg);
            return;
        }

        try {
            // 操作実行
            let result = await operation(this.realObjectSystem, event.data);

            // 追加処理（オプション）
            if (postProcess) {
                result = await postProcess(result, event);
            }

            // 成功レスポンス送信
            this.respondOperationSuccess(event, successType, result);
            this.logInfo(operationName, '完了', result);

            return result;
        } catch (error) {
            // エラーログとレスポンス送信
            this.logError(operationName, error);
            this.respondOperationError(event, errorType, error);
            throw error;
        }
    }

    /**
     * ダイアログ表示とレスポンス統合ヘルパー
     * @param {string} dialogType - ダイアログタイプ ('message', 'input', 'custom')
     * @param {Object} params - ダイアログパラメータ
     * @param {string} responseType - レスポンスメッセージタイプ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async showDialogAndRespond(dialogType, params, responseType, event) {
        logger.info('[TADjs] showDialogAndRespond called:', {
            dialogType,
            responseType,
            messageId: params.messageId,
            sourceWindowId: params.sourceWindowId,
            hasDialogManager: !!this.dialogManager
        });

        // sourceWindowIdを取得（event.sourceからwindowIdを解決できない場合のフォールバック）
        const sourceWindowId = params.sourceWindowId || null;

        try {
            let result;

            switch (dialogType) {
                case 'message':
                    result = await this.showMessageDialog(
                        params.message,
                        params.buttons,
                        params.defaultButton || 0
                    );
                    break;
                case 'input':
                    logger.info('[TADjs] Showing input dialog:', params.message);
                    result = await this.showInputDialog(
                        params.message,
                        params.defaultValue || '',
                        params.inputWidth || 30,
                        params.buttons,
                        params.defaultButton || 0,
                        {
                            colorPicker: params.colorPicker || false,
                            checkbox: params.checkbox || null
                        }
                    );
                    logger.info('[TADjs] Input dialog result:', result);
                    break;
                case 'custom':
                    result = await this.showCustomDialog(
                        params.dialogHtml,
                        params.buttons,
                        params.defaultButton || 0,
                        { ...(params.inputs || {}), radios: params.radios }
                    );

                    // カスタムダイアログの特殊処理
                    // selectedFontIndex の抽出
                    let selectedFontIndex = null;
                    if (result.dialogElement) {
                        const selectedElement = result.dialogElement.querySelector('.font-list-item.selected');
                        if (selectedElement) {
                            selectedFontIndex = parseInt(selectedElement.getAttribute('data-index'));
                        }
                    }

                    // dialogElement は postMessage で送信できないため除外
                    const { dialogElement, ...resultWithoutElement } = result;

                    // selectedFontIndex を結果に追加
                    this.respondSuccess(event.source, responseType, {
                        result: {
                            ...resultWithoutElement,
                            selectedFontIndex: selectedFontIndex
                        }
                    }, params.messageId, sourceWindowId);
                    return; // 早期リターン

                default:
                    throw new Error(`Unknown dialog type: ${dialogType}`);
            }

            logger.info('[TADjs] Sending dialog response:', {
                responseType,
                messageId: params.messageId,
                sourceWindowId,
                hasResult: !!result
            });
            this.respondSuccess(event.source, responseType, { result }, params.messageId, sourceWindowId);
            logger.info('[TADjs] Dialog response sent successfully');
        } catch (error) {
            logger.error(`[TADjs] Dialog error (${dialogType}):`, error);
            this.respondError(event.source, responseType, error, params.messageId, sourceWindowId);
        }
    }

    // ========================================
    // MessageRouter ハンドラーメソッド (Phase 2)
    // ========================================

    /**
     * show-message-dialog ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleShowMessageDialog(data, event) {
        await this.showDialogAndRespond(
            'message',
            data,
            'message-dialog-response',
            event
        );
    }

    /**
     * show-input-dialog ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleShowInputDialog(data, event) {
        logger.info('[TADjs] handleShowInputDialog called:', {
            messageId: data.messageId,
            message: data.message,
            sourceWindowId: data.sourceWindowId,
            hasEventSource: !!event.source
        });
        await this.showDialogAndRespond(
            'input',
            data,
            'input-dialog-response',
            event
        );
        logger.info('[TADjs] handleShowInputDialog completed');
    }

    /**
     * show-custom-dialog ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleShowCustomDialog(data, event) {
        await this.showDialogAndRespond(
            'custom',
            data,
            'custom-dialog-response',
            event
        );
    }

    /**
     * show-save-confirm-dialog ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleShowSaveConfirmDialog(data, event) {
        await this.showDialogAndRespond(
            'message',
            { ...data, defaultButton: 2 }, // デフォルトは「保存」ボタン
            'message-dialog-response',
            event
        );
    }

    /**
     * MessageRouter ハンドラーを登録
     * Phase 2: ダイアログ系から段階的移行
     */
    registerMessageRouterHandlers() {
        if (!this.messageRouter) {
            logger.warn('[TADjs] MessageRouterが初期化されていません - ハンドラー登録をスキップ');
            return;
        }

        // ダイアログ系ハンドラー登録
        this.messageRouter.register(
            'show-message-dialog',
            this.handleShowMessageDialog.bind(this),
            { autoResponse: false } // 手動レスポンス（ハンドラー内で送信）
        );

        this.messageRouter.register(
            'show-input-dialog',
            this.handleShowInputDialog.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'show-custom-dialog',
            this.handleShowCustomDialog.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'show-save-confirm-dialog',
            this.handleShowSaveConfirmDialog.bind(this),
            { autoResponse: false }
        );

        logger.info('[TADjs] Phase 2: ダイアログ系ハンドラー登録完了 (4件)');

        // Phase 3: ファイル・データ操作系ハンドラー登録
        this.messageRouter.register(
            'open-folder-dialog',
            this.handleOpenFolderDialog.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'check-folder-access',
            this.handleCheckFolderAccess.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'get-data-folder',
            this.handleGetDataFolder.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'get-plugin-list',
            this.handleGetPluginList.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'get-image-file-path',
            this.handleGetImageFilePath.bind(this),
            { autoResponse: false }
        );

        logger.info('[TADjs] Phase 3: ファイル・データ操作系ハンドラー登録完了 (5件)');

        // Phase 4 Batch 1: 単方向メッセージハンドラー登録
        this.messageRouter.register(
            'content-size-changed',
            this.handleContentSizeChanged.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'set-window-icon',
            this.handleSetWindowIcon.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'window-close-response',
            this.handleWindowCloseResponse.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'update-scrollbars',
            this.handleUpdateScrollbars.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'set-clipboard',
            this.handleSetClipboard.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'update-window-config',
            this.handleUpdateWindowConfigRouter.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'update-panel-position',
            this.handleUpdatePanelPositionRouter.bind(this),
            { autoResponse: false }
        );

        logger.info('[TADjs] Phase 4 Batch 1: 単方向メッセージハンドラー登録完了 (7件)');

        // Phase 4 Batch 2: ファイル・データ取得系ハンドラー登録
        this.messageRouter.register(
            'get-file-data',
            this.handleGetFileData.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'save-image-file',
            this.handleSaveImageFile.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'load-image-file',
            this.handleLoadImageFile.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'list-image-files',
            this.handleListImageFiles.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'read-xtad-text',
            this.handleReadXtadText.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'read-icon-file',
            this.handleReadIconFile.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'get-clipboard',
            this.handleGetClipboard.bind(this),
            { autoResponse: false }
        );

        logger.info('[TADjs] Phase 4 Batch 2: ファイル・データ取得系ハンドラー登録完了 (6件)');

        // Phase 4 Batch 3: 実身/仮身操作系ハンドラー登録
        this.messageRouter.register(
            'rename-real-object',
            this.handleRenameRealObjectRouter.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'duplicate-real-object',
            this.handleDuplicateRealObjectRouter.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'save-as-new-real-object',
            this.handleSaveAsNewRealObjectRouter.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'virtualize-selection',
            this.handleVirtualizeSelection.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'change-virtual-object-attributes',
            this.handleChangeVirtualObjectAttributesRouter.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'set-relationship',
            this.handleSetRelationshipRouter.bind(this),
            { autoResponse: false }
        );

        logger.info('[TADjs] Phase 4 Batch 3: 実身/仮身操作系ハンドラー登録完了 (6件)');

        // Phase 4 Batch 4: オブジェクトを開く系ハンドラー登録
        this.messageRouter.register(
            'open-virtual-object',
            this.handleOpenVirtualObject.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'open-virtual-object-real',
            this.handleOpenVirtualObjectReal.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'open-tad-link',
            this.handleOpenTadLink.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'open-external-file',
            this.handleOpenExternalFile.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'open-url-external',
            this.handleOpenUrlExternal.bind(this),
            { autoResponse: false }
        );

        logger.info('[TADjs] Phase 4 Batch 4: オブジェクトを開く系ハンドラー登録完了 (5件)');

        // Phase 4 Batch 5: ドラッグ&ドロップ系 + その他ハンドラー登録 (13件)
        this.messageRouter.register(
            'archive-drop-detected',
            this.handleArchiveDropDetected.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'archive-drop-handled',
            this.handleArchiveDropHandled.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'base-file-drop-request',
            this.handleBaseFileDropRequest.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'insert-root-virtual-object',
            this.handleInsertRootVirtualObject.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'root-virtual-object-inserted',
            this.handleRootVirtualObjectInserted.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'archive-files-generated',
            this.handleArchiveFilesGeneratedRouter.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'base-file-drop-request',
            this.handleBaseFileDropRequest.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'url-drop-request',
            this.handleUrlDropRequest.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'trash-real-object-drop-request',
            this.handleTrashRealObjectDropRequest.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'notify-cross-window-drop',
            this.handleNotifyCrossWindowDrop.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'cross-window-drop-success',
            this.handleCrossWindowDropSuccess.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'files-dropped-on-plugin',
            this.handleFilesDroppedOnPlugin.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'image-dropped-on-plugin',
            this.handleImageDroppedOnPlugin.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'set-data-folder',
            this.handleSetDataFolderRouter.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'request-base-plugins',
            this.handleRequestBasePlugins.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'load-data-file-request',
            this.handleLoadDataFileRequest.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'get-system-fonts',
            this.handleGetSystemFonts.bind(this),
            { autoResponse: false }
        );

        logger.info('[TADjs] Phase 4 Batch 5: ドラッグ&ドロップ系+その他ハンドラー登録完了 (13件)');

        // Phase 4 Batch 6: 道具パネル系 + 特殊フラグ系ハンドラー登録 (6件)
        this.messageRouter.register(
            'open-tool-panel-window',
            this.handleOpenToolPanelWindow.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'show-tool-panel-popup',
            this.handleShowToolPanelPopup.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'hide-tool-panel-popup',
            this.handleHideToolPanelPopup.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'start-drag-tool-panel',
            this.handleStartDragToolPanel.bind(this),
            { autoResponse: false }
        );

        // 特殊フラグ系はカスタムルーティングが必要なため、個別処理を維持
        logger.info('[TADjs] Phase 4 Batch 6: 道具パネル系ハンドラー登録完了 (4件)');
        logger.info('[TADjs] 特殊フラグ系 (fromEditor, fromToolPanel) は個別処理を維持');

        // 子パネルウィンドウ系ハンドラー登録
        this.messageRouter.register(
            'open-child-panel-window',
            this.handleOpenChildPanelWindow.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'send-to-child-panel',
            this.handleSendToChildPanel.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'start-drag-child-panel',
            this.handleStartDragChildPanel.bind(this),
            { autoResponse: false }
        );

        logger.info('[TADjs] 子パネルウィンドウ系ハンドラー登録完了 (3件)');

        // 検索/置換ウィンドウ系ハンドラー登録
        this.messageRouter.register(
            'open-find-replace-window',
            this.handleOpenFindReplaceWindow.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'find-next',
            this.handleFindNext.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'replace-next',
            this.handleReplaceNext.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'replace-all',
            this.handleReplaceAll.bind(this),
            { autoResponse: false }
        );

        logger.info('[TADjs] 検索/置換ウィンドウ系ハンドラー登録完了 (4件)');

        // 基本表計算用 検索/置換ウィンドウ系ハンドラー登録
        this.messageRouter.register(
            'open-calc-find-replace-window',
            this.handleOpenCalcFindReplaceWindow.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'calc-find-next',
            this.handleCalcFindNext.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'calc-replace-next',
            this.handleCalcReplaceNext.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'calc-replace-all',
            this.handleCalcReplaceAll.bind(this),
            { autoResponse: false }
        );

        logger.info('[TADjs] 基本表計算用 検索/置換ウィンドウ系ハンドラー登録完了 (4件)');
    }

    // ========================================
    // MessageRouter ハンドラーメソッド (Phase 3)
    // ========================================

    /**
     * open-folder-dialog ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleOpenFolderDialog(data, event) {
        try {
            if (window.electronAPI && window.electronAPI.openFolderDialog) {
                const result = await window.electronAPI.openFolderDialog();
                this.respondSuccess(event.source, 'folder-dialog-response', {
                    folderPath: result ? result.folderPath : null
                }, data.messageId);
            } else {
                logger.error('[TADjs] electronAPI.openFolderDialogが利用できません');
                this.respondError(event.source, 'folder-dialog-response',
                    new Error('Electron APIが利用できません'), data.messageId);
            }
        } catch (error) {
            logger.error('[TADjs] フォルダ選択ダイアログエラー:', error);
            this.respondError(event.source, 'folder-dialog-response', error, data.messageId);
        }
    }

    /**
     * check-folder-access ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleCheckFolderAccess(data, event) {
        logger.info('[TADjs] check-folder-access受信:', data.folderPath);

        if (data.folderPath) {
            const result = this.checkFolderAccess(data.folderPath);
            this.respondSuccess(event.source, 'folder-access-checked', {
                success: result.success,
                error: result.error
            }, data.messageId);
        } else {
            this.respondSuccess(event.source, 'folder-access-checked', {
                success: false,
                error: 'フォルダパスが指定されていません'
            }, data.messageId);
        }
    }

    /**
     * get-data-folder ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleGetDataFolder(data, event) {
        logger.info('[TADjs] get-data-folder受信');
        this.respondSuccess(event.source, 'data-folder-response', {
            dataFolder: this._basePath
        }, data.messageId);
    }

    /**
     * get-plugin-list ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleGetPluginList(data, event) {
        const plugins = this.getPluginListInfo();
        this.respondSuccess(event.source, 'plugin-list-response', {
            plugins: plugins
        }, data.messageId);
    }

    /**
     * get-image-file-path ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleGetImageFilePath(data, event) {
        const filePath = this.getImageFilePath(data.fileName);
        this.respondSuccess(event.source, 'image-file-path-response', {
            fileName: data.fileName,
            filePath: filePath
        }, data.messageId);
    }

    // ========================================
    // MessageRouter ハンドラーメソッド (Phase 4 Batch 1)
    // ========================================

    /**
     * content-size-changed ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleContentSizeChanged(data, event) {
        this.updatePluginContentSize(event.source, data.height, data.width);
    }

    /**
     * set-window-icon ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleSetWindowIcon(data, event) {
        logger.debug('[TADjs] ウィンドウアイコン設定要求:', data.windowId, data.iconPath);
        this.setWindowIcon(data.windowId, data.iconPath);
    }

    /**
     * window-close-response ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleWindowCloseResponse(data, event) {
        if (this.closeConfirmCallbacks && this.closeConfirmCallbacks[data.windowId]) {
            this.closeConfirmCallbacks[data.windowId](data.allowClose);
            delete this.closeConfirmCallbacks[data.windowId];
        }
    }

    /**
     * update-scrollbars ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleUpdateScrollbars(data, event) {
        const iframe = event.source ? event.source.frameElement : null;

        if (iframe) {
            const windowElement = iframe.closest('.window');

            if (windowElement) {
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
        }
    }

    /**
     * set-clipboard ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleSetClipboard(data, event) {
        this.clipboard = data.clipboardData;
        logger.info('[TADjs] クリップボードを設定:', this.clipboard?.link_name);
    }

    /**
     * update-window-config MessageRouterハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleUpdateWindowConfigRouter(data, event) {
        // 既存のhandleUpdateWindowConfigメソッドを呼び出し
        // 既存メソッドがeventオブジェクト全体を期待しているため、そのまま渡す
        await this.handleUpdateWindowConfig(event).catch(err => {
            logger.error('[TADjs] ウィンドウ設定更新エラー:', err);
        });
    }

    /**
     * update-panel-position MessageRouterハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleUpdatePanelPositionRouter(data, event) {
        // 既存のhandleUpdatePanelPositionメソッドを呼び出し
        // 既存メソッドがeventオブジェクト全体を期待しているため、そのまま渡す
        await this.handleUpdatePanelPosition(event).catch(err => {
            logger.error('[TADjs] 道具パネル位置更新エラー:', err);
        });
    }

    // ========================================
    // MessageRouter ハンドラーメソッド (Phase 4 Batch 2)
    // ========================================

    /**
     * get-file-data ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleGetFileData(data, event) {
        logger.info('[TADjs] ファイルデータ取得要求:', data.fileName);
        const file = this.fileObjects[data.fileName];
        if (file) {
            try {
                const uint8Array = await this.getFileAsUint8Array(file);
                if (event.source) {
                    this.parentMessageBus.respondTo(event.source, 'file-data', {
                        fileName: data.fileName,
                        arrayBuffer: uint8Array.buffer
                    });
                }
            } catch (error) {
                logger.error('[TADjs] ファイルデータ取得エラー:', error);
            }
        } else {
            logger.error('[TADjs] ファイルが見つかりません:', data.fileName);
        }
    }

    /**
     * save-image-file ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleSaveImageFile(data, event) {
        logger.info('[TADjs] 画像ファイル保存要求:', data.fileName);

        let success = false;
        try {
            success = this.saveImageFile(data.fileName, data.imageData);
        } catch (error) {
            logger.error('[TADjs] 画像ファイル保存エラー:', error);
        }

        // レスポンスを返す（messageIdがある場合のみ）
        if (event.source && data.messageId) {
            this.parentMessageBus.respondTo(event.source, 'save-image-result', {
                messageId: data.messageId,
                success: success,
                fileName: data.fileName
            });
        }
    }

    /**
     * list-image-files ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleListImageFiles(data, event) {
        const files = this.realObjectSystem.listImageFiles(data.realId, data.recordNo);

        if (event.source && data.messageId) {
            this.parentMessageBus.respondTo(event.source, 'list-image-files-result', {
                messageId: data.messageId,
                realId: data.realId,
                recordNo: data.recordNo,
                files: files
            });
        }
    }

    /**
     * save-calc-image-file ハンドラー（基本表計算プラグイン用）
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleSaveCalcImageFile(event) {
        const data = event.data;
        logger.info('[TADjs] 表計算用画像ファイル保存要求:', data.fileName);

        let success = false;
        try {
            // base64からUint8Arrayに変換
            const base64 = data.data;
            const binaryString = atob(base64);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }

            success = this.saveImageFile(data.fileName, bytes);
        } catch (error) {
            logger.error('[TADjs] 表計算用画像ファイル保存エラー:', error);
        }

        // レスポンスを返す（save-image-result型で返す）
        if (event.source && data.messageId) {
            this.parentMessageBus.respondTo(event.source, 'save-image-result', {
                messageId: data.messageId,
                success: success,
                fileName: data.fileName
            });
        }
    }

    /**
     * delete-image-file ハンドラー（画像ファイル削除）
     * @param {MessageEvent} event - メッセージイベント（汎用ハンドラーからはeventのみ渡される）
     * @returns {Promise<void>}
     */
    async handleDeleteImageFile(event) {
        // 汎用ハンドラーからはeventのみが渡されるため、event.dataからデータを取得
        const data = event.data || event;
        const fileName = data.fileName;
        logger.info('[TADjs] 画像ファイル削除要求:', fileName);

        let success = false;
        try {
            if (window.electronAPI && window.electronAPI.deleteFile) {
                const basePath = this.getDataBasePath();
                const filePath = this.realObjectSystem.path.join(basePath, fileName);

                // ファイルが存在するか確認
                if (this.realObjectSystem.fs.existsSync(filePath)) {
                    const result = await window.electronAPI.deleteFile(filePath);
                    success = result.success;
                    if (success) {
                        logger.info('[TADjs] 画像ファイル削除成功:', filePath);
                    } else {
                        logger.error('[TADjs] 画像ファイル削除失敗:', result.error);
                    }
                } else {
                    logger.warn('[TADjs] 削除対象の画像ファイルが存在しません:', filePath);
                    success = true; // ファイルがなければ削除成功とみなす
                }
            } else {
                logger.warn('[TADjs] electronAPI.deleteFile が利用できません（ブラウザモード）');
            }
        } catch (error) {
            logger.error('[TADjs] 画像ファイル削除エラー:', error);
        }

        // レスポンスを返す
        if (event.source && data.messageId) {
            this.parentMessageBus.respondTo(event.source, 'delete-image-result', {
                messageId: data.messageId,
                success: success,
                fileName: fileName
            });
        }
    }

    /**
     * get-real-object-info ハンドラー（仮身ネットワーク用）
     * 実身のメタデータを取得
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleGetRealObjectInfo(event) {
        // 汎用ハンドラからはeventのみが渡される
        const data = event.data || {};
        const realId = data.realId;
        logger.info('[TADjs] 実身情報取得要求:', realId);

        let success = false;
        let info = null;

        try {
            // JSONファイルから実身情報を読み込み
            const basePath = this.getDataBasePath();
            const jsonPath = this.realObjectSystem.path.join(basePath, `${realId}.json`);

            if (this.realObjectSystem.fs.existsSync(jsonPath)) {
                const jsonContent = this.realObjectSystem.fs.readFileSync(jsonPath, 'utf-8');
                const metadata = JSON.parse(jsonContent);
                info = {
                    realId: realId,
                    name: metadata.name || '無題',
                    type: metadata.type || 'unknown',
                    updateDate: metadata.updateDate,
                    applist: metadata.applist || {},
                    filePath: jsonPath  // ファイルパスを追加
                };
                success = true;
            } else {
                logger.warn('[TADjs] 実身のJSONファイルが見つかりません:', jsonPath);
            }
        } catch (error) {
            logger.error('[TADjs] 実身情報取得エラー:', error);
        }

        // レスポンスを返す
        if (event.source) {
            this.parentMessageBus.respondTo(event.source, 'real-object-info-response', {
                messageId: data.messageId,
                success: success,
                info: info
            });
        }
    }

    /**
     * get-virtual-objects-from-real ハンドラー（仮身ネットワーク用）
     * 実身のXTADから仮身リストを取得
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleGetVirtualObjectsFromReal(event) {
        // 汎用ハンドラからはeventのみが渡される
        const data = event.data || {};
        const realId = data.realId;
        logger.info('[TADjs] 仮身リスト取得要求:', realId);

        let success = false;
        let virtualObjects = [];

        try {
            // XTADファイルを読み込み
            const basePath = this.getDataBasePath();
            const xtadPath = this.realObjectSystem.path.join(basePath, `${realId}_0.xtad`);

            if (this.realObjectSystem.fs.existsSync(xtadPath)) {
                let xtadContent = this.realObjectSystem.fs.readFileSync(xtadPath, 'utf-8');
                logger.info('[TADjs] XTADファイル読み込み:', xtadPath, 'サイズ:', xtadContent.length);

                // 重複属性を削除（applist属性が2回出現する問題への対応）
                // link要素内で2番目以降のapplist属性を削除
                xtadContent = xtadContent.replace(/<link([^>]*)>/g, (match, attrs) => {
                    let firstApplist = true;
                    const cleanedAttrs = attrs.replace(/\sapplist="[^"]*"/g, (attrMatch) => {
                        if (firstApplist) {
                            firstApplist = false;
                            return attrMatch;
                        }
                        return ''; // 2番目以降は削除
                    });
                    return '<link' + cleanedAttrs + '>';
                });

                // DOMParserでXMLを解析
                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(xtadContent, 'text/xml');

                // パースエラーをチェック
                const parseError = xmlDoc.querySelector('parsererror');
                if (parseError) {
                    logger.error('[TADjs] XMLパースエラー:', parseError.textContent);
                } else {
                    // <link>要素を取得
                    const linkElements = xmlDoc.getElementsByTagName('link');
                    logger.info('[TADjs] link要素数:', linkElements.length);

                    for (const link of linkElements) {
                        const vobj = {
                            link_id: link.getAttribute('id') || '',
                            link_name: link.getAttribute('name') || link.textContent.trim() || '無題',
                            frcol: link.getAttribute('frcol') || '#000000',
                            tbcol: link.getAttribute('tbcol') || '#ffffff',
                            chcol: link.getAttribute('chcol') || '#000000',
                            chsz: parseInt(link.getAttribute('chsz')) || 14
                        };
                        virtualObjects.push(vobj);
                    }
                    success = true;
                    logger.info('[TADjs] 仮身リスト取得成功:', virtualObjects.length, '件');
                }
            } else {
                logger.warn('[TADjs] XTADファイルが見つかりません:', xtadPath);
            }
        } catch (error) {
            logger.error('[TADjs] 仮身リスト取得エラー:', error);
        }

        // レスポンスを返す
        if (event.source) {
            this.parentMessageBus.respondTo(event.source, 'virtual-objects-response', {
                messageId: data.messageId,
                success: success,
                virtualObjects: virtualObjects
            });
        }
    }

    /**
     * search-real-objects ハンドラー（実身/仮身検索用）
     * 実身名検索、全文検索、日付検索を実行
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleSearchRealObjects(event) {
        const data = event.data || {};
        logger.info('[TADjs] 実身/仮身検索要求:', data);

        let success = false;
        let results = [];
        let error = null;

        try {
            if (data.searchType === 'string') {
                results = await this.searchRealObjectsByString(data, event.source);
                success = true;
            } else if (data.searchType === 'date') {
                results = await this.searchRealObjectsByDate(data, event.source);
                success = true;
            } else {
                error = '不明な検索タイプです';
            }
        } catch (err) {
            logger.error('[TADjs] 実身/仮身検索エラー:', err);
            error = err.message;
        }

        // レスポンスを返す
        if (event.source) {
            this.parentMessageBus.respondTo(event.source, 'search-real-objects-response', {
                messageId: data.messageId,
                success: success,
                results: results,
                searchParams: data,
                error: error
            });
        }
    }

    /**
     * 検索中断ハンドラ
     */
    handleAbortSearch() {
        logger.info('[TADjs] 検索中断要求');
        this.searchAborted = true;
    }

    /**
     * 文字列による実身検索
     * @param {Object} params - 検索パラメータ
     * @param {Object} eventSource - 進捗報告用のイベントソース（オプション）
     * @returns {Promise<Array>} 検索結果
     */
    async searchRealObjectsByString(params, eventSource = null) {
        const { searchText, searchTarget, useRegex } = params;
        const results = [];

        // 検索中断フラグをリセット
        this.searchAborted = false;

        // 全実身のメタデータを取得
        const allMetadata = await this.realObjectSystem.getAllMetadata();
        let processedCount = 0;

        // 検索パターンを作成
        let searchPattern;
        if (useRegex) {
            try {
                searchPattern = new RegExp(searchText, 'i');
            } catch (e) {
                throw new Error('正規表現の構文が正しくありません');
            }
        }

        for (const metadata of allMetadata) {
            // 中断チェック
            if (this.searchAborted) {
                logger.info('[TADjs] 文字列検索が中断されました');
                break;
            }

            processedCount++;
            let matchType = null;
            let matchedText = null;
            let nameMatched = false;
            let relationshipMatched = false;
            let contentMatched = false;

            // 実身名検索
            if (searchTarget === 'name' || searchTarget === 'all') {
                const name = metadata.name || '';
                if (useRegex) {
                    if (searchPattern.test(name)) {
                        nameMatched = true;
                    }
                } else {
                    if (name.toLowerCase().includes(searchText.toLowerCase())) {
                        nameMatched = true;
                    }
                }
            }

            // 続柄検索（JSON metadata + link要素のrelationship属性）
            if (searchTarget === 'relationship' || searchTarget === 'all') {
                // JSON metadataの続柄を検索
                const relationships = metadata.relationship || [];
                for (const rel of relationships) {
                    if (useRegex) {
                        if (searchPattern.test(rel)) {
                            relationshipMatched = true;
                            break;
                        }
                    } else {
                        if (rel.toLowerCase().includes(searchText.toLowerCase())) {
                            relationshipMatched = true;
                            break;
                        }
                    }
                }

                // link要素のrelationship属性も検索
                if (!relationshipMatched) {
                    const linkRelationships = await this.extractLinkRelationshipsFromRealObject(metadata.realId);
                    for (const rel of linkRelationships) {
                        if (useRegex) {
                            if (searchPattern.test(rel)) {
                                relationshipMatched = true;
                                break;
                            }
                        } else {
                            if (rel.toLowerCase().includes(searchText.toLowerCase())) {
                                relationshipMatched = true;
                                break;
                            }
                        }
                    }
                }
            }

            // 本文検索
            if (searchTarget === 'content' || searchTarget === 'all') {
                const textContent = await this.extractTextFromRealObject(metadata.realId);
                if (textContent) {
                    if (useRegex) {
                        const match = searchPattern.exec(textContent);
                        if (match) {
                            contentMatched = true;
                            // マッチ箇所の前後を含むテキストを抽出
                            const start = Math.max(0, match.index - 20);
                            const end = Math.min(textContent.length, match.index + match[0].length + 20);
                            matchedText = textContent.substring(start, end);
                        }
                    } else {
                        const lowerContent = textContent.toLowerCase();
                        const lowerSearch = searchText.toLowerCase();
                        const index = lowerContent.indexOf(lowerSearch);
                        if (index >= 0) {
                            contentMatched = true;
                            // マッチ箇所の前後を含むテキストを抽出
                            const start = Math.max(0, index - 20);
                            const end = Math.min(textContent.length, index + searchText.length + 20);
                            matchedText = textContent.substring(start, end);
                        }
                    }
                }
            }

            // マッチタイプを決定（複合表示形式: name+relationship+content）
            const matchTypes = [];
            if (nameMatched) matchTypes.push('name');
            if (relationshipMatched) matchTypes.push('relationship');
            if (contentMatched) matchTypes.push('content');
            if (matchTypes.length > 0) {
                matchType = matchTypes.join('+');
            }

            if (matchType) {
                // 仮身属性を抽出（色、サイズなど）
                const vobjAttrs = await this.extractVobjAttributesFromRealObject(metadata.realId);

                results.push({
                    realId: metadata.realId,
                    name: metadata.name || '無題',
                    link_id: `${metadata.realId}_0.xtad`,
                    matchType: matchType,
                    matchedText: matchedText,
                    makeDate: metadata.makeDate,
                    updateDate: metadata.updateDate,
                    accessDate: metadata.accessDate,
                    // VirtualObjectRenderer用の仮身属性（XTADから抽出した値を含める）
                    virtualObject: {
                        link_id: `${metadata.realId}_0.xtad`,
                        link_name: metadata.name || '無題',
                        ...(vobjAttrs || {})
                    }
                });
            }

            // 進捗報告（10件ごと）
            if (eventSource && processedCount % 10 === 0) {
                this.parentMessageBus.respondTo(eventSource, 'search-real-objects-progress', {
                    totalCount: processedCount,
                    matchCount: results.length
                });
            }
        }

        // 最終進捗報告
        if (eventSource) {
            this.parentMessageBus.respondTo(eventSource, 'search-real-objects-progress', {
                totalCount: processedCount,
                matchCount: results.length
            });
        }

        logger.info('[TADjs] 文字列検索結果:', results.length, '件');
        return results;
    }

    /**
     * 日付による実身検索（文字列+日付複合検索対応）
     * @param {Object} params - 検索パラメータ
     * @param {Object} eventSource - 進捗報告用のイベントソース（オプション）
     * @returns {Promise<Array>} 検索結果
     */
    async searchRealObjectsByDate(params, eventSource = null) {
        const { searchText, searchTarget, useRegex, dateFrom, dateTo, dateTarget } = params;
        const results = [];

        // 検索中断フラグをリセット
        this.searchAborted = false;

        // 全実身のメタデータを取得
        const allMetadata = await this.realObjectSystem.getAllMetadata();
        let processedCount = 0;

        // 日付の変換（datetime-local形式）
        const fromDateTime = dateFrom ? new Date(dateFrom).getTime() : null;
        const toDateTime = dateTo ? new Date(dateTo).getTime() : null;

        // 文字列検索パターンを作成
        let searchPattern = null;
        if (searchText) {
            if (useRegex) {
                try {
                    searchPattern = new RegExp(searchText, 'i');
                } catch (e) {
                    throw new Error('正規表現の構文が正しくありません');
                }
            }
        }

        // 検索対象を決定（デフォルトは全て）
        const effectiveSearchTarget = searchTarget || 'all';

        for (const metadata of allMetadata) {
            // 中断チェック
            if (this.searchAborted) {
                logger.info('[TADjs] 日付検索が中断されました');
                break;
            }

            processedCount++;
            let dateMatched = false;
            let stringMatched = false;
            let matchedText = null;
            let matchType = null;
            let nameMatched = false;
            let relationshipMatched = false;
            let contentMatched = false;

            // 日付フィルタリング（FROM/TOが指定されている場合のみ）
            if (fromDateTime !== null || toDateTime !== null) {
                const dateValue = metadata[dateTarget];
                if (dateValue) {
                    const dateTime = new Date(dateValue).getTime();
                    if (!isNaN(dateTime)) {
                        // FROM/TO両方: 範囲指定
                        // FROMのみ: 以降
                        // TOのみ: 以前
                        const afterFrom = fromDateTime === null || dateTime >= fromDateTime;
                        const beforeTo = toDateTime === null || dateTime <= toDateTime;
                        dateMatched = afterFrom && beforeTo;
                    }
                }
            } else {
                // 日付指定なしの場合は全て一致扱い
                dateMatched = true;
            }

            // 日付が一致しない場合はスキップ
            if (!dateMatched) {
                // 進捗報告
                if (eventSource && processedCount % 10 === 0) {
                    this.parentMessageBus.respondTo(eventSource, 'search-real-objects-progress', {
                        totalCount: processedCount,
                        matchCount: results.length
                    });
                }
                continue;
            }

            // 文字列検索（searchTextが指定されている場合）
            if (searchText) {
                // 実身名検索
                if (effectiveSearchTarget === 'name' || effectiveSearchTarget === 'all') {
                    const name = metadata.name || '';
                    if (useRegex) {
                        if (searchPattern.test(name)) {
                            nameMatched = true;
                        }
                    } else {
                        if (name.toLowerCase().includes(searchText.toLowerCase())) {
                            nameMatched = true;
                        }
                    }
                }

                // 続柄検索（JSON metadata + link要素のrelationship属性）
                if (effectiveSearchTarget === 'relationship' || effectiveSearchTarget === 'all') {
                    // JSON metadataの続柄を検索
                    const relationships = metadata.relationship || [];
                    for (const rel of relationships) {
                        if (useRegex) {
                            if (searchPattern.test(rel)) {
                                relationshipMatched = true;
                                break;
                            }
                        } else {
                            if (rel.toLowerCase().includes(searchText.toLowerCase())) {
                                relationshipMatched = true;
                                break;
                            }
                        }
                    }

                    // link要素のrelationship属性も検索
                    if (!relationshipMatched) {
                        const linkRelationships = await this.extractLinkRelationshipsFromRealObject(metadata.realId);
                        for (const rel of linkRelationships) {
                            if (useRegex) {
                                if (searchPattern.test(rel)) {
                                    relationshipMatched = true;
                                    break;
                                }
                            } else {
                                if (rel.toLowerCase().includes(searchText.toLowerCase())) {
                                    relationshipMatched = true;
                                    break;
                                }
                            }
                        }
                    }
                }

                // 本文検索
                if (effectiveSearchTarget === 'content' || effectiveSearchTarget === 'all') {
                    const textContent = await this.extractTextFromRealObject(metadata.realId);
                    if (textContent) {
                        if (useRegex) {
                            const match = searchPattern.exec(textContent);
                            if (match) {
                                contentMatched = true;
                                const start = Math.max(0, match.index - 20);
                                const end = Math.min(textContent.length, match.index + match[0].length + 20);
                                matchedText = textContent.substring(start, end);
                            }
                        } else {
                            const lowerContent = textContent.toLowerCase();
                            const lowerSearch = searchText.toLowerCase();
                            const index = lowerContent.indexOf(lowerSearch);
                            if (index >= 0) {
                                contentMatched = true;
                                const start = Math.max(0, index - 20);
                                const end = Math.min(textContent.length, index + searchText.length + 20);
                                matchedText = textContent.substring(start, end);
                            }
                        }
                    }
                }

                // 文字列一致を判定
                stringMatched = nameMatched || relationshipMatched || contentMatched;

                // マッチタイプを決定（複合表示形式: name+relationship+content）
                const matchTypes = [];
                if (nameMatched) matchTypes.push('name');
                if (relationshipMatched) matchTypes.push('relationship');
                if (contentMatched) matchTypes.push('content');
                if (matchTypes.length > 0) {
                    matchType = matchTypes.join('+');
                }
            } else {
                // 文字列指定なしの場合は一致扱い
                stringMatched = true;
                matchType = 'date';
            }

            // 日付と文字列の両方が一致した場合に結果に追加
            if (dateMatched && stringMatched) {
                // 仮身属性を抽出（色、サイズなど）
                const vobjAttrs = await this.extractVobjAttributesFromRealObject(metadata.realId);

                results.push({
                    realId: metadata.realId,
                    name: metadata.name || '無題',
                    link_id: `${metadata.realId}_0.xtad`,
                    matchType: matchType,
                    matchedText: matchedText,
                    makeDate: metadata.makeDate,
                    updateDate: metadata.updateDate,
                    accessDate: metadata.accessDate,
                    // VirtualObjectRenderer用の仮身属性（XTADから抽出した値を含める）
                    virtualObject: {
                        link_id: `${metadata.realId}_0.xtad`,
                        link_name: metadata.name || '無題',
                        ...(vobjAttrs || {})
                    }
                });
            }

            // 進捗報告（10件ごと）
            if (eventSource && processedCount % 10 === 0) {
                this.parentMessageBus.respondTo(eventSource, 'search-real-objects-progress', {
                    totalCount: processedCount,
                    matchCount: results.length
                });
            }
        }

        // 最終進捗報告
        if (eventSource) {
            this.parentMessageBus.respondTo(eventSource, 'search-real-objects-progress', {
                totalCount: processedCount,
                matchCount: results.length
            });
        }

        logger.info('[TADjs] 日付検索結果:', results.length, '件');
        return results;
    }

    /**
     * 実身からテキスト内容を抽出（全文検索用）
     * @param {string} realId - 実身ID
     * @returns {Promise<string|null>} テキスト内容
     */
    async extractTextFromRealObject(realId) {
        try {
            const basePath = this.getDataBasePath();

            // 全レコードのXTADファイルからテキストを抽出
            let allText = '';
            let recordNo = 0;

            while (true) {
                const xtadPath = this.realObjectSystem.path.join(basePath, `${realId}_${recordNo}.xtad`);
                if (!this.realObjectSystem.fs.existsSync(xtadPath)) {
                    break;
                }

                const xtadContent = this.realObjectSystem.fs.readFileSync(xtadPath, 'utf-8');
                const textContent = this.extractTextFromXTADContent(xtadContent);
                if (textContent) {
                    allText += textContent + '\n';
                }
                recordNo++;
            }

            return allText.trim() || null;
        } catch (error) {
            logger.warn('[TADjs] テキスト抽出エラー:', realId, error);
            return null;
        }
    }

    /**
     * XTAD XMLコンテンツからテキスト部分を抽出
     * @param {string} xtadContent - XTAD XML文字列
     * @returns {string} 抽出されたテキスト
     */
    extractTextFromXTADContent(xtadContent) {
        try {
            // DOMParserでXMLを解析
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xtadContent, 'text/xml');

            // パースエラーをチェック
            const parseError = xmlDoc.querySelector('parsererror');
            if (parseError) {
                return '';
            }

            // テキストノードを再帰的に収集
            const textParts = [];
            const collectText = (node) => {
                if (node.nodeType === Node.TEXT_NODE) {
                    const text = node.textContent.trim();
                    if (text) {
                        textParts.push(text);
                    }
                } else if (node.nodeType === Node.ELEMENT_NODE) {
                    // link要素のname属性も含める
                    if (node.tagName === 'link') {
                        const linkName = node.getAttribute('name');
                        if (linkName) {
                            textParts.push(linkName);
                        }
                    }
                    // 子ノードを再帰処理
                    for (const child of node.childNodes) {
                        collectText(child);
                    }
                }
            };

            collectText(xmlDoc.documentElement);
            return textParts.join(' ');
        } catch (error) {
            logger.warn('[TADjs] XTAD テキスト抽出エラー:', error);
            return '';
        }
    }

    /**
     * 実身からlink要素のrelationship属性を抽出（続柄検索用）
     * @param {string} realId - 実身ID
     * @returns {Promise<string[]>} 続柄タグの配列
     */
    async extractLinkRelationshipsFromRealObject(realId) {
        try {
            const basePath = this.getDataBasePath();
            const allRelationships = [];
            let recordNo = 0;

            while (true) {
                const xtadPath = this.realObjectSystem.path.join(basePath, `${realId}_${recordNo}.xtad`);
                if (!this.realObjectSystem.fs.existsSync(xtadPath)) {
                    break;
                }

                const xtadContent = this.realObjectSystem.fs.readFileSync(xtadPath, 'utf-8');
                const relationships = this.extractLinkRelationshipsFromXTADContent(xtadContent);
                allRelationships.push(...relationships);
                recordNo++;
            }

            return allRelationships;
        } catch (error) {
            logger.warn('[TADjs] link続柄抽出エラー:', realId, error);
            return [];
        }
    }

    /**
     * XTAD XMLコンテンツからlink要素のrelationship属性を抽出
     * @param {string} xtadContent - XTAD XML文字列
     * @returns {string[]} 続柄タグの配列
     */
    extractLinkRelationshipsFromXTADContent(xtadContent) {
        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xtadContent, 'text/xml');

            const parseError = xmlDoc.querySelector('parsererror');
            if (parseError) {
                return [];
            }

            const relationships = [];
            const linkElements = xmlDoc.getElementsByTagName('link');

            for (let i = 0; i < linkElements.length; i++) {
                const link = linkElements[i];
                const relationshipAttr = link.getAttribute('relationship');
                if (relationshipAttr && relationshipAttr.trim()) {
                    // スペース区切りで分割して配列に追加
                    const tags = relationshipAttr.split(/\s+/).filter(s => s.trim() !== '');
                    relationships.push(...tags);
                }
            }

            return relationships;
        } catch (error) {
            return [];
        }
    }

    /**
     * 実身から仮身属性（色、サイズなど）を抽出
     * @param {string} realId - 実身ID
     * @returns {Promise<Object|null>} 仮身属性オブジェクト
     */
    async extractVobjAttributesFromRealObject(realId) {
        try {
            const basePath = this.getDataBasePath();
            const xtadPath = this.realObjectSystem.path.join(basePath, `${realId}_0.xtad`);

            if (!this.realObjectSystem.fs.existsSync(xtadPath)) {
                return null;
            }

            const xtadContent = this.realObjectSystem.fs.readFileSync(xtadPath, 'utf-8');
            return this.extractVobjAttributesFromXTADContent(xtadContent);
        } catch (error) {
            logger.warn('[TADjs] 仮身属性抽出エラー:', realId, error);
            return null;
        }
    }

    /**
     * XTAD XMLコンテンツから最初のlink要素の仮身属性を抽出
     * @param {string} xtadContent - XTAD XML文字列
     * @returns {Object|null} 仮身属性（chcol, tbcol, frcol, bgcol, chsz等）
     */
    extractVobjAttributesFromXTADContent(xtadContent) {
        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xtadContent, 'text/xml');

            const parseError = xmlDoc.querySelector('parsererror');
            if (parseError) {
                return null;
            }

            // 最初のlink要素を取得
            const linkElement = xmlDoc.querySelector('link');
            if (!linkElement) {
                return null;
            }

            // 仮身属性を抽出
            return {
                chcol: linkElement.getAttribute('chcol') || undefined,
                tbcol: linkElement.getAttribute('tbcol') || undefined,
                frcol: linkElement.getAttribute('frcol') || undefined,
                bgcol: linkElement.getAttribute('bgcol') || undefined,
                chsz: linkElement.getAttribute('chsz') || undefined,
                pictdisp: linkElement.getAttribute('pictdisp') || undefined,
                namedisp: linkElement.getAttribute('namedisp') || undefined,
                roledisp: linkElement.getAttribute('roledisp') || undefined,
                typedisp: linkElement.getAttribute('typedisp') || undefined,
                updatedisp: linkElement.getAttribute('updatedisp') || undefined,
                framedisp: linkElement.getAttribute('framedisp') || undefined
            };
        } catch (error) {
            logger.warn('[TADjs] XTAD 仮身属性抽出エラー:', error);
            return null;
        }
    }

    /**
     * load-image-file ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleLoadImageFile(data, event) {
        logger.info('[TADjs] 画像ファイル読み込み要求:', data.fileName);
        this.loadImageFile(data.fileName, data.messageId, event.source);
    }

    /**
     * read-xtad-text ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleReadXtadText(data, event) {
        logger.info('[TADjs] read-xtad-text受信:', data.realId);
        try {
            const result = await this.readXtadText(data.realId);

            if (event.source) {
                this.parentMessageBus.respondTo(event.source, 'xtad-text-loaded', {
                    realId: data.realId,
                    success: result.success,
                    text: result.text,
                    error: result.error
                });
            }
        } catch (error) {
            logger.error('[TADjs] xtadテキストを読み取るエラー:', error);
            if (event.source) {
                this.parentMessageBus.respondTo(event.source, 'xtad-text-loaded', {
                    realId: data.realId,
                    success: false,
                    error: error.message
                });
            }
        }
    }

    /**
     * read-icon-file ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleReadIconFile(data, event) {
        logger.debug('[TADjs] read-icon-file受信:', data.realId);
        try {
            const result = await this.readIconFile(data.realId);

            if (event.source) {
                this.parentMessageBus.respondTo(event.source, 'icon-file-loaded', {
                    messageId: data.messageId,
                    realId: data.realId,
                    success: result.success,
                    filePath: result.filePath,
                    error: result.error
                });
            }
        } catch (error) {
            logger.error('[TADjs] アイコンファイルパス取得エラー:', error);
            if (event.source) {
                this.parentMessageBus.respondTo(event.source, 'icon-file-loaded', {
                    messageId: data.messageId,
                    realId: data.realId,
                    success: false,
                    error: error.message
                });
            }
        }
    }

    /**
     * get-clipboard ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleGetClipboard(data, event) {
        if (event.source) {
            this.parentMessageBus.respondTo(event.source, 'clipboard-data', {
                messageId: data.messageId,
                clipboardData: this.clipboard
            });
        }
        logger.info('[TADjs] クリップボードを取得:', this.clipboard?.link_name);
    }

    // ========================================
    // MessageRouter ハンドラーメソッド (Phase 4 Batch 3)
    // ========================================

    /**
     * rename-real-object MessageRouterハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleRenameRealObjectRouter(data, event) {
        // 既存のhandleRenameRealObjectメソッドを呼び出し
        await this.handleRenameRealObject(event).catch(err => {
            logger.error('[TADjs] 実身名変更エラー:', err);
        });
    }

    /**
     * duplicate-real-object MessageRouterハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleDuplicateRealObjectRouter(data, event) {
        if (!this.realObjectSystem) {
            logger.error('[TADjs] 実身仮身システムが初期化されていません');
            return;
        }

        const source = event?.source;
        logger.info('[TADjs] duplicate-real-objectメッセージ受信:', {
            messageId: data.messageId,
            realId: data.realId,
            newName: data.newName,
            hasSource: !!source
        });

        if (!source) {
            logger.error('[TADjs] sourceが取得できませんでした');
            return;
        }

        const { realId: fullRealId, messageId } = data;

        // 実身IDを抽出（_0.xtad を除去）
        let realId = fullRealId;
        if (realId.match(/_\d+\.xtad$/i)) {
            realId = realId.replace(/_\d+\.xtad$/i, '');
        }

        try {
            let newName = data.newName;

            // newNameがメッセージに含まれていない場合のみダイアログを表示（後方互換性）
            if (!newName) {
                // 元の実身のメタデータを取得
                const sourceRealObject = await this.realObjectSystem.loadRealObject(realId);
                const defaultName = (sourceRealObject.metadata.name || '実身') + 'のコピー';

                // 名前入力ダイアログを表示
                const result = await this.showInputDialog(
                    '新しい実身の名称を入力してください',
                    defaultName,
                    30,
                    [
                        { label: '取消', value: 'cancel' },
                        { label: '設定', value: 'ok' }
                    ],
                    1
                );

                // キャンセルされた場合
                if (result.button === 'cancel' || !result.value) {
                    logger.info('[TADjs] 実身複製がキャンセルされました');
                    this.parentMessageBus.respondTo(source, 'real-object-duplicated', {
                        messageId: messageId,
                        success: false,
                        cancelled: true
                    });
                    return;
                }

                newName = result.value;
            }

            // RealObjectSystemの実身コピー機能を使用（再帰的コピー）
            const newRealId = await this.realObjectSystem.copyRealObject(realId);

            // 新しい実身のメタデータを取得
            const newRealObject = await this.realObjectSystem.loadRealObject(newRealId);

            // 名前を更新
            newRealObject.metadata.name = newName;
            await this.realObjectSystem.saveRealObject(newRealId, newRealObject);

            // JSONファイルにもrefCountを書き込む
            await this.updateJsonFileRefCount(newRealId);

            // 成功を通知
            this.parentMessageBus.respondTo(source, 'real-object-duplicated', {
                messageId: messageId,
                success: true,
                newRealId: newRealId,
                newName: newName
            });

            logger.info('[TADjs] 実身複製完了:', realId, '->', newRealId, '名前:', newName);
            this.setStatusMessage(`実身を複製しました: ${newName}`);
        } catch (error) {
            logger.error('[TADjs] 実身複製エラー:', error);
            this.parentMessageBus.respondTo(source, 'real-object-duplicated', {
                messageId: messageId,
                success: false,
                error: error.message
            });
        }
    }

    /**
     * save-as-new-real-object MessageRouterハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleSaveAsNewRealObjectRouter(data, event) {
        // 既存のhandleSaveAsNewRealObjectメソッドを呼び出し（Phase 2形式: data, event）
        await this.handleSaveAsNewRealObject(data, event).catch(err => {
            logger.error('[TADjs] 新たな実身に保存エラー:', err);
        });
    }

    /**
     * change-virtual-object-attributes MessageRouterハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleChangeVirtualObjectAttributesRouter(data, event) {
        // 既存のhandleChangeVirtualObjectAttributesメソッドを呼び出し（Phase 2形式: data, event）
        await this.handleChangeVirtualObjectAttributes(data, event).catch(err => {
            logger.error('[TADjs] 仮身属性変更エラー:', err);
        });
    }

    /**
     * set-relationship MessageRouterハンドラー
     * 実身の続柄（relationship）とlink要素のrelationship属性を設定する
     * [タグ]形式は実身JSON用、それ以外はlink属性用
     * @param {Object} data - メッセージデータ { realId, linkId, currentLinkRelationship, messageId }
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleSetRelationshipRouter(data, event) {
        if (!this.realObjectSystem) {
            logger.error('[TADjs] 実身仮身システムが初期化されていません');
            return;
        }

        const source = event?.source;
        if (!source) {
            logger.error('[TADjs] sourceが取得できませんでした');
            return;
        }

        const { realId: fullRealId, linkId, currentLinkRelationship, messageId } = data;

        // 実身IDを抽出（_0.xtad を除去）
        let realId = fullRealId;
        if (realId && realId.match(/_\d+\.xtad$/i)) {
            realId = realId.replace(/_\d+\.xtad$/i, '');
        }

        try {
            // 現在の続柄を取得
            const realObject = await this.realObjectSystem.loadRealObject(realId);
            const currentJsonRelationship = realObject.metadata.relationship || [];
            const currentLinkRel = currentLinkRelationship || [];

            // 表示用テキストを生成（JSON用は[タグ]形式、link用はそのまま）
            const jsonPart = currentJsonRelationship.map(t => `[${t}]`).join(' ');
            const linkPart = currentLinkRel.join(' ');
            const currentText = [jsonPart, linkPart].filter(t => t).join(' ');

            // 入力ダイアログを表示
            const result = await this.showInputDialog(
                '続柄（リレーションタグ名）を入力してください\n[タグ]形式は実身用、それ以外は仮身用（半角スペース区切りで複数設定可）',
                currentText,
                50,
                [
                    { label: '取消', value: 'cancel' },
                    { label: '設定', value: 'ok' }
                ],
                1
            );

            // キャンセルされた場合
            if (result.button === 'cancel' || result.value === null) {
                this.parentMessageBus.respondTo(source, 'relationship-set', {
                    messageId: messageId,
                    success: false,
                    cancelled: true
                });
                return;
            }

            // 入力をパースしてJSON用とlink用に分離
            const parsed = this.parseRelationshipInput(result.value);
            const newJsonRelationship = parsed.jsonRelationship;
            const newLinkRelationship = parsed.linkRelationship;

            // JSONファイルを直接更新（実身の続柄）
            const jsonPath = this.path.join(this.realObjectSystem._basePath, `${realId}.json`);
            const jsonContent = JSON.parse(this.fs.readFileSync(jsonPath, 'utf-8'));
            jsonContent.relationship = newJsonRelationship;
            jsonContent.updateDate = new Date().toISOString();
            this.fs.writeFileSync(jsonPath, JSON.stringify(jsonContent, null, 2));

            // 成功を通知（link属性の更新はプラグイン側で行う）
            this.parentMessageBus.respondTo(source, 'relationship-set', {
                messageId: messageId,
                success: true,
                relationship: newJsonRelationship,
                linkRelationship: newLinkRelationship
            });

            // 表示用テキストを生成
            const displayJsonPart = newJsonRelationship.map(t => `[${t}]`).join(' ');
            const displayLinkPart = newLinkRelationship.join(' ');
            const relationshipText = [displayJsonPart, displayLinkPart].filter(t => t).join(' ') || '（なし）';
            logger.info('[TADjs] 続柄設定完了:', realId, relationshipText);
            this.setStatusMessage(`続柄を設定しました: ${relationshipText}`);
        } catch (error) {
            logger.error('[TADjs] 続柄設定エラー:', error);
            this.parentMessageBus.respondTo(source, 'relationship-set', {
                messageId: messageId,
                success: false,
                error: error.message
            });
        }
    }

    /**
     * 続柄入力文字列をパースしてJSON用とlink属性用に分離
     * [タグ] 形式は実身JSON用、それ以外はlink属性用
     * @param {string} input - 入力文字列（例: "[親1] [親2] 子1 子2"）
     * @returns {{jsonRelationship: string[], linkRelationship: string[]}}
     */
    parseRelationshipInput(input) {
        if (!input || typeof input !== 'string') {
            return { jsonRelationship: [], linkRelationship: [] };
        }

        const jsonRelationship = [];
        const linkRelationship = [];

        // [タグ] 形式を抽出（括弧内にスペースがあっても1つのタグとして扱う）
        const bracketPattern = /\[([^\]]+)\]/g;
        let match;
        let lastIndex = 0;
        const remainingParts = [];

        // 入力文字列を走査
        while ((match = bracketPattern.exec(input)) !== null) {
            // 括弧の前のテキストを保存
            if (match.index > lastIndex) {
                remainingParts.push(input.substring(lastIndex, match.index));
            }
            // 括弧内のタグをJSON用に追加
            const tag = match[1].trim();
            if (tag) {
                jsonRelationship.push(tag);
            }
            lastIndex = match.index + match[0].length;
        }

        // 残りのテキストを保存
        if (lastIndex < input.length) {
            remainingParts.push(input.substring(lastIndex));
        }

        // 残りのテキストをスペース区切りでlink属性用に分割
        const remainingText = remainingParts.join('').trim();
        if (remainingText) {
            const tags = remainingText.split(/\s+/).filter(s => s.trim() !== '');
            linkRelationship.push(...tags);
        }

        return { jsonRelationship, linkRelationship };
    }

    // ========================================
    // MessageRouter ハンドラーメソッド (Phase 4 Batch 4)
    // ========================================

    /**
     * open-virtual-object ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleOpenVirtualObject(data, event) {
        logger.info('[TADjs] 仮身を開く要求:', data);
        this.openVirtualObject(data.linkId, data.linkName);
    }

    /**
     * open-virtual-object-real ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleOpenVirtualObjectReal(data, event) {
        logger.debug('[TADjs] 仮身の実身を開く要求:', data);
        this.openVirtualObjectReal(data.virtualObj, data.pluginId, data.messageId, event.source);
    }

    /**
     * open-tad-link ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleOpenTadLink(data, event) {
        logger.info('[TADjs] TADリンクを開く要求:', data.linkData);
        const linkData = data.linkData;
        const linkRecordList = data.linkRecordList;  // 親ウィンドウから受け取ったlinkRecordList
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
                        tadRecordDataArray: data.tadRecordDataArray || []  // tadRecordDataArrayも渡す
                    };

                    logger.info('[TADjs] tadjs-viewプラグインでリンクを開く:', fileData);
                    logger.info('[TADjs] Passing linkRecordList with', linkRecordList ? linkRecordList.length : 0, 'files');
                    await window.pluginManager.createPluginWindow(plugin, fileData);
                } else {
                    logger.error('[TADjs] tadjs-viewプラグインが見つかりません');
                }
            } else {
                logger.error('[TADjs] プラグインマネージャーが初期化されていません');
            }
        }
    }

    /**
     * open-external-file ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleOpenExternalFile(data, event) {
        logger.info('[TADjs] open-external-file受信:', data.realId, data.extension);
        try {
            const result = await this.openExternalFile(data.realId, data.extension);

            if (event.source) {
                this.parentMessageBus.respondTo(event.source, 'external-file-opened', {
                    realId: data.realId,
                    extension: data.extension,
                    success: result.success,
                    error: result.error
                });
            }
        } catch (error) {
            logger.error('[TADjs] 外部ファイルを開くエラー:', error);
            if (event.source) {
                this.parentMessageBus.respondTo(event.source, 'external-file-opened', {
                    realId: data.realId,
                    extension: data.extension,
                    success: false,
                    error: error.message
                });
            }
        }
    }

    /**
     * open-url-external ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleOpenUrlExternal(data, event) {
        logger.info('[TADjs] open-url-external受信:', data.url);
        try {
            const result = await this.openUrlExternal(data.url);

            if (event.source) {
                this.parentMessageBus.respondTo(event.source, 'url-opened', {
                    url: data.url,
                    success: result.success,
                    error: result.error
                });
            }
        } catch (error) {
            logger.error('[TADjs] URLを開くエラー:', error);
            if (event.source) {
                this.parentMessageBus.respondTo(event.source, 'url-opened', {
                    url: data.url,
                    success: false,
                    error: error.message
                });
            }
        }
    }

    // ========================================
    // MessageRouter ハンドラーメソッド (Phase 4 Batch 5)
    // ========================================

    /**
     * archive-drop-detected ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleArchiveDropDetected(data, event) {
        logger.info('[TADjs] ドロップ通知転送（virtual-object-list → unpack-file）');
        // 特定のウィンドウ内のunpack-fileプラグインのみにメッセージを転送
        // sourceWindowIdをdragDataに追加（unpack-fileがルート配置時に使用）
        const dragDataWithSource = {
            ...data.dragData,
            sourceWindowId: data.sourceWindowId  // virtual-object-listのウィンドウID
        };
        this.forwardMessageToPluginInWindow(data.targetWindowId, 'unpack-file', {
            type: 'archive-drop-detected',
            dropPosition: data.dropPosition,
            dragData: dragDataWithSource
        });
    }

    /**
     * archive-drop-handled ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleArchiveDropHandled(data, event) {
        logger.info('[TADjs] アーカイブドロップ処理完了通知、元のウィンドウID:', data.sourceWindowId);
        if (data.sourceWindowId) {
            this.forwardMessageToWindow(data.sourceWindowId, {
                type: 'cross-window-drop-completed',
                mode: 'copy' // アーカイブドロップはコピー扱い
            });
        }
    }

    /**
     * base-file-drop-request ハンドラー
     * プラグインからの原紙ドロップ要求を処理
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleBaseFileDropRequest(data, event) {
        console.log('[TADjs] base-file-drop-request受信:', data.dragData?.type);
        // 擬似メッセージイベントを作成（handleBaseFileDropが期待する形式）
        const pseudoMessageEvent = {
            source: event.source,
            data: {
                dropPosition: data.dropPosition,
                clientX: data.clientX,
                clientY: data.clientY
            }
        };
        await this.handleBaseFileDrop(data.dragData, pseudoMessageEvent);
    }

    /**
     * insert-root-virtual-object ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleInsertRootVirtualObject(data, event) {
        logger.info('[TADjs] ルート実身配置要求転送（unpack-file → virtual-object-list）');
        // 特定のウィンドウ内のvirtual-object-listプラグインのみにメッセージを転送
        this.forwardMessageToPluginInWindow(data.targetWindowId, 'virtual-object-list', {
            type: 'insert-root-virtual-object',
            rootFileData: data.rootFileData,
            x: data.x,
            y: data.y,
            sourceWindowId: data.sourceWindowId
        });
    }

    /**
     * root-virtual-object-inserted ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleRootVirtualObjectInserted(data, event) {
        logger.info('[TADjs] ルート実身配置完了通知転送（virtual-object-list → unpack-file）');
        // 特定のウィンドウ内のunpack-fileプラグインのみにメッセージを転送
        this.forwardMessageToPluginInWindow(data.targetWindowId, 'unpack-file', {
            type: 'root-virtual-object-inserted',
            success: data.success
        });
    }

    /**
     * archive-files-generated ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleArchiveFilesGeneratedRouter(data, event) {
        const filesCount = data.files ? data.files.length : 0;
        const imagesCount = data.images ? data.images.length : 0;
        const chunkInfo = data.chunkInfo || { index: 0, total: 1, isLast: true };
        logger.info(`[TADjs] 実身ファイルセットチャンク受信 (${chunkInfo.index + 1}/${chunkInfo.total}):`, filesCount, '個のファイル、', imagesCount, '個の画像');
        await this.handleArchiveFilesGenerated(data.files, data.images);
    }

    /**
     * base-file-drop-request ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleBaseFileDropRequest(data, event) {
        logger.info('[TADjs] base-file-drop-request受信:', data);
        this.handleBaseFileDrop(data.dragData, event);
    }

    /**
     * url-drop-request ハンドラー
     * プラグインからのURLドロップ要求を処理
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleUrlDropRequest(data, event) {
        logger.info('[TADjs] url-drop-request受信:', data.url);
        const { url, dropX, dropY, windowId } = data;

        // 対象のiframeを取得（childrenから検索）
        let iframe = null;
        for (const [_id, childInfo] of this.parentMessageBus.children.entries()) {
            if (childInfo.windowId === windowId) {
                iframe = childInfo.iframe;
                break;
            }
        }

        // handleUrlDropを呼び出し
        await this.handleUrlDrop(url, iframe, dropX, dropY);
    }

    /**
     * trash-real-object-drop-request ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleTrashRealObjectDropRequest(data, event) {
        logger.info('[TADjs] trash-real-object-drop-request受信:', data);
        this.handleTrashRealObjectDrop(data.dragData, event);
    }

    /**
     * notify-cross-window-drop ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleNotifyCrossWindowDrop(data, event) {
        logger.info('[TADjs] notify-cross-window-drop受信:', data);
        this.notifySourceWindowOfCrossWindowDropInProgress(data);
    }

    /**
     * cross-window-drop-success ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleCrossWindowDropSuccess(data, event) {
        logger.info('[TADjs] cross-window-drop-success受信:', data);
        this.notifySourceWindowOfCrossWindowDrop(data);
    }

    /**
     * files-dropped-on-plugin ハンドラー
     * プラグインにドロップされたファイルを処理
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleFilesDroppedOnPlugin(data, event) {
        logger.info('[TADjs] files-dropped-on-plugin受信:', data.files?.length, '個のファイル');

        const { files, windowId, targetCell } = data;

        if (!files || files.length === 0) {
            logger.warn('[TADjs] ドロップされたファイルがありません');
            return;
        }

        // ターゲットウィンドウのiframeを取得
        const windowElement = document.getElementById(windowId);
        if (!windowElement) {
            logger.warn('[TADjs] ターゲットウィンドウが見つかりません:', windowId);
            return;
        }

        const iframe = windowElement.querySelector('iframe');
        if (!iframe || !iframe.contentWindow) {
            logger.warn('[TADjs] iframeが見つかりません');
            return;
        }

        // ファイルデータからFileオブジェクトを再構築
        // 複数ファイルの場合、横方向に並べて配置
        let fileIndex = 0;
        for (const fileInfo of files) {
            try {
                if (!fileInfo.data) {
                    logger.warn('[TADjs] ファイルデータがありません:', fileInfo.name);
                    continue;
                }

                // Base64からバイナリデータに変換
                const binary = atob(fileInfo.data);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) {
                    bytes[i] = binary.charCodeAt(i);
                }

                // Fileオブジェクトを作成
                const blob = new Blob([bytes], { type: fileInfo.type || 'application/octet-stream' });
                const file = new File([blob], fileInfo.name, { type: fileInfo.type });

                // FileImportManagerを使用して実身を作成
                if (this.fileImportManager) {
                    const realObjectInfo = await this.fileImportManager.createRealObjectFromImportedFile(file);

                    if (realObjectInfo) {
                        // 各ファイルのセル位置を計算（横方向に並べる）
                        const currentTargetCell = targetCell ? {
                            col: targetCell.col + fileIndex,
                            row: targetCell.row
                        } : null;

                        // プラグインに仮身追加メッセージを送信
                        this.parentMessageBus.sendToWindow(windowId, 'add-virtual-object-from-base', {
                            realId: realObjectInfo.realId,
                            name: realObjectInfo.name,
                            dropPosition: { x: data.clientX, y: data.clientY },
                            targetCell: currentTargetCell,
                            applist: realObjectInfo.applist
                        });
                        this.setStatusMessage(`実身「${realObjectInfo.name}」を作成しました`);
                        fileIndex++;
                    }
                }
            } catch (error) {
                logger.error('[TADjs] ファイル処理エラー:', fileInfo.name, error);
            }
        }
    }

    /**
     * image-dropped-on-plugin ハンドラー
     * プラグインにドロップされた画像を処理（基本文章編集からのドラッグ）
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleImageDroppedOnPlugin(data, event) {
        logger.info('[TADjs] image-dropped-on-plugin受信:', data.dragData?.imageInfo?.savedFilename);

        const { dragData, windowId, clientX, clientY } = data;

        if (!dragData || !dragData.imageInfo) {
            logger.warn('[TADjs] 画像情報がありません');
            return;
        }

        const imageInfo = dragData.imageInfo;
        const savedFilename = imageInfo.savedFilename;

        if (!savedFilename) {
            logger.warn('[TADjs] 画像ファイル名がありません');
            return;
        }

        try {
            // 画像ファイルを読み込む
            let imageData = null;

            if (this.isElectronEnv) {
                const fs = require('fs');
                const path = require('path');

                // データフォルダから画像を読み込む
                const imagePath = path.join(this.getDataBasePath(), savedFilename);

                if (fs.existsSync(imagePath)) {
                    const buffer = fs.readFileSync(imagePath);
                    imageData = buffer;
                    logger.debug('[TADjs] 画像ファイル読み込み成功:', imagePath);
                } else {
                    logger.warn('[TADjs] 画像ファイルが見つかりません:', imagePath);
                    this.setStatusMessage('画像ファイルが見つかりません');
                    return;
                }
            }

            if (!imageData) {
                logger.warn('[TADjs] 画像データを取得できませんでした');
                return;
            }

            // 基本図形編集プラグインの原紙を使用して新しい実身を作成
            const baseFileId = '019a0000-0000-0000-0000-000000000003';  // basic-figure-editor原紙
            const pluginId = 'basic-figure-editor';

            // 新しい実身名
            const newName = savedFilename.replace(/\.[^.]+$/, '');  // 拡張子を除去

            // 新しい実身IDを生成
            const newRealId = typeof generateUUIDv7 === 'function' ? generateUUIDv7() : this.generateRealFileIdSet(1).fileId;

            // 原紙のJSONを読み込む
            const jsonPath = `plugins/${pluginId}/${baseFileId}.json`;
            const jsonResponse = await fetch(jsonPath);
            if (!jsonResponse.ok) {
                logger.error('[TADjs] 原紙JSON読み込み失敗');
                return;
            }
            const basefileJson = await jsonResponse.json();

            // 新しい実身のJSONを作成
            const currentDateTime = new Date().toISOString();
            const newRealJson = {
                ...basefileJson,
                name: newName,
                makeDate: currentDateTime,
                updateDate: currentDateTime,
                accessDate: currentDateTime,
                refCount: 1
            };

            // 画像を含むXTADを作成
            const imageWidth = imageInfo.width || 200;
            const imageHeight = imageInfo.height || 200;
            const newImageFilename = `${newRealId}_0_0.png`;

            const newRealXtad = `<?xml version="1.0" encoding="UTF-8"?>
<tad version="0.2">
<header filename="${newName}"/>
<document>
<figure>
<shape type="image" x="10" y="10" width="${imageWidth}" height="${imageHeight}" savedFilename="${newImageFilename}"/>
</figure>
</document>
</tad>`;

            // ファイルを保存
            const jsonFileName = window.RealObjectSystem.getRealObjectJsonFileName(newRealId);
            const xtadFileName = `${newRealId}_0.xtad`;

            await this.saveDataFile(jsonFileName, JSON.stringify(newRealJson, null, 2));
            await this.saveDataFile(xtadFileName, newRealXtad);
            await this.saveDataFile(newImageFilename, imageData);

            // アイコンをコピー
            try {
                const baseIconPath = `plugins/${pluginId}/${baseFileId}.ico`;
                const iconResponse = await fetch(baseIconPath);
                if (iconResponse.ok) {
                    const iconData = await iconResponse.arrayBuffer();
                    await this.saveDataFile(`${newRealId}.ico`, new Uint8Array(iconData));
                }
            } catch (error) {
                logger.warn('[TADjs] アイコンコピーエラー:', error.message);
            }

            logger.info('[TADjs] 画像から実身を作成しました:', newRealId, newName);

            // プラグインに仮身追加メッセージを送信
            this.parentMessageBus.sendToWindow(windowId, 'add-virtual-object-from-base', {
                realId: newRealId,
                name: newName,
                dropPosition: { x: clientX, y: clientY },
                applist: newRealJson.applist || {}
            });

            this.setStatusMessage(`実身「${newName}」を作成しました`);

        } catch (error) {
            logger.error('[TADjs] 画像処理エラー:', error);
            this.setStatusMessage('画像の処理に失敗しました');
        }
    }

    /**
     * set-data-folder ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleSetDataFolderRouter(data, event) {
        logger.info('[TADjs] set-data-folder受信:', data.dataFolder);
        await this.handleSetDataFolder(data, event);
    }

    /**
     * request-base-plugins ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleRequestBasePlugins(data, event) {
        const basePlugins = window.pluginManager ? window.pluginManager.getBasePlugins() : [];
        if (event.source) {
            this.parentMessageBus.respondTo(event.source, 'base-plugins-response', {
                plugins: basePlugins
            });
        } else {
            logger.warn('[TADjs] e.sourceが存在しません');
        }
    }

    /**
     * load-data-file-request ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleLoadDataFileRequest(data, event) {
        logger.debug('[TADjs] load-data-file-request受信:', data.fileName);
        try {
            const fileData = await this.loadDataFileAsFile(data.fileName);
            if (event.source) {
                if (fileData) {
                    this.parentMessageBus.respondTo(event.source, 'load-data-file-response', {
                        messageId: data.messageId,
                        fileName: data.fileName,
                        success: true,
                        data: fileData
                    });
                } else {
                    this.parentMessageBus.respondTo(event.source, 'load-data-file-response', {
                        messageId: data.messageId,
                        fileName: data.fileName,
                        success: false,
                        error: 'ファイルが見つかりません'
                    });
                }
            }
        } catch (error) {
            logger.error('[TADjs] データファイル読み込みエラー:', error);
            if (event.source) {
                this.parentMessageBus.respondTo(event.source, 'load-data-file-response', {
                    messageId: data.messageId,
                    fileName: data.fileName,
                    success: false,
                    error: error.message
                });
            }
        }
    }

    /**
     * get-system-fonts ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleGetSystemFonts(data, event) {
        logger.info('[TADjs] get-system-fonts受信 messageId:', data.messageId);
        logger.info('[TADjs] Electron環境:', this.isElectronEnv);

        // Electron環境の場合、IPCでメインプロセスに問い合わせ
        if (this.isElectronEnv && typeof require !== 'undefined') {
            logger.info('[TADjs] IPCでメインプロセスに問い合わせ開始');
            const { ipcRenderer } = require('electron');

            ipcRenderer.invoke('get-system-fonts').then(result => {
                logger.info('[TADjs] IPCから応答受信 success:', result.success, 'fonts:', result.fonts ? result.fonts.length : 0);

                if (result.success && result.fonts) {
                    logger.info('[TADjs] 受信したフォント数:', result.fonts.length);
                }

                logger.info('[TADjs] プラグインに応答を送信 messageId:', data.messageId);
                if (event.source) {
                    this.parentMessageBus.respondTo(event.source, 'system-fonts-response', {
                        messageId: data.messageId,
                        fonts: result.success ? result.fonts : []
                    });
                    logger.info('[TADjs] MessageBus送信完了');
                }
            }).catch(error => {
                logger.error('[TADjs] IPC呼び出しエラー:', error);
                if (event.source) {
                    this.parentMessageBus.respondTo(event.source, 'system-fonts-response', {
                        messageId: data.messageId,
                        fonts: []
                    });
                }
            });
        } else {
            // ブラウザ環境の場合は空配列を返す
            logger.info('[TADjs] ブラウザ環境のため、システムフォント一覧は取得できません');
            if (event.source) {
                this.parentMessageBus.respondTo(event.source, 'system-fonts-response', {
                    messageId: data.messageId,
                    fonts: []
                });
            }
        }
    }

    // ========================================
    // MessageRouter ハンドラーメソッド (Phase 4 Batch 6)
    // ========================================

    /**
     * open-tool-panel-window ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleOpenToolPanelWindow(data, event) {
        logger.info('[TADjs] 道具パネルウィンドウを開く:', data.pluginId);
        // e.sourceからiframe要素を取得
        const pluginIframe = event.source ? event.source.frameElement : null;
        this.openToolPanelWindow(data.pluginId, data.settings, pluginIframe, data.panelpos, data.panelsize);
    }

    /**
     * show-tool-panel-popup ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleShowToolPanelPopup(data, event) {
        this.showToolPanelPopup(data, event.source);
    }

    /**
     * hide-tool-panel-popup ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleHideToolPanelPopup(data, event) {
        this.hideToolPanelPopup();
    }

    /**
     * start-drag-tool-panel ハンドラー（fromToolPanel内で処理）
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleStartDragToolPanel(data, event) {
        if (event.source && event.source.frameElement) {
            const toolPanelIframe = event.source.frameElement;
            const toolPanelWindow = toolPanelIframe.closest('.window');

            if (toolPanelWindow) {
                this.startToolPanelDrag(toolPanelWindow, data.clientX, data.clientY);
            }
        }
    }

    // ========================================
    // 子パネルウィンドウ関連
    // ========================================

    /**
     * open-child-panel-window ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleOpenChildPanelWindow(data, event) {
        const { panelType, parentWindowId, pluginId, options, messageId } = data;

        // パネルURLを構築
        const panelUrl = `plugins/${pluginId}/${options.panelUrl}`;
        const content = `<iframe src="${panelUrl}" style="width: 100%; height: 100%; border: none;"></iframe>`;

        // 親ウィンドウの位置を取得（位置が指定されていない場合）
        let x = options.x;
        let y = options.y;
        if (x === undefined || y === undefined) {
            const parentWindow = document.getElementById(parentWindowId);
            if (parentWindow) {
                const rect = parentWindow.getBoundingClientRect();
                x = x ?? rect.right + 10;
                y = y ?? rect.top;
            } else {
                x = x ?? 100;
                y = y ?? 100;
            }
        }

        // ウィンドウ作成
        const windowId = this.createWindow(options.title, content, {
            width: options.width,
            height: options.height,
            x: x,
            y: y,
            resizable: options.resizable !== false,
            maximizable: false,
            minimizable: false,
            closable: true,
            alwaysOnTop: true,
            scrollable: false,
            frame: options.noTitleBar ? false : true,
            cssClass: 'child-panel-window'
        });

        // 子パネル関連を保存
        this.childPanelRelations[windowId] = {
            parentWindowId,
            pluginId,
            panelType
        };

        // MessageBusに登録して初期化
        setTimeout(() => {
            const windowElement = document.getElementById(windowId);
            if (windowElement) {
                const iframe = windowElement.querySelector('iframe');
                if (iframe) {
                    this.parentMessageBus.registerChild(windowId, iframe, {
                        windowId: windowId,
                        pluginId: pluginId
                    });

                    // 初期化メッセージ送信
                    this.parentMessageBus.sendToWindow(windowId, 'init-child-panel', {
                        windowId: windowId,
                        parentWindowId: parentWindowId,
                        panelType: panelType,
                        initData: options.initData
                    });
                }
            }
        }, 100);

        // 作成完了を通知
        this.parentMessageBus.sendToWindow(parentWindowId, 'child-panel-window-created', {
            messageId,
            windowId,
            panelType
        });
    }

    /**
     * send-to-child-panel ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleSendToChildPanel(data, event) {
        const { targetWindowId, type, data: messageData } = data;
        if (targetWindowId) {
            this.parentMessageBus.sendToWindow(targetWindowId, type, messageData);
        }
    }

    /**
     * start-drag-child-panel ハンドラー
     * 子パネルウィンドウのドラッグ開始
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleStartDragChildPanel(data, event) {
        if (event.source && event.source.frameElement) {
            const childPanelIframe = event.source.frameElement;
            const childPanelWindow = childPanelIframe.closest('.window');

            if (childPanelWindow) {
                // iframe内の座標を親ウィンドウの座標に変換
                const iframeRect = childPanelIframe.getBoundingClientRect();
                const parentClientX = iframeRect.left + data.clientX;
                const parentClientY = iframeRect.top + data.clientY;

                // 既存のウィンドウドラッグ機能を利用
                this.startWindowDrag(childPanelWindow, {
                    clientX: parentClientX,
                    clientY: parentClientY
                });
            }
        }
    }

    // ========================================
    // 検索/置換ウィンドウ関連
    // ========================================

    /**
     * open-find-replace-window ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleOpenFindReplaceWindow(data, event) {
        logger.info('[TADjs] 検索/置換ウィンドウを開く');

        const pluginIframe = event.source ? event.source.frameElement : null;
        if (!pluginIframe) {
            logger.warn('[TADjs] プラグインのiframeが見つかりません');
            return;
        }

        const editorWindowId = this.parentMessageBus.getWindowIdFromIframe(pluginIframe);
        if (!editorWindowId) {
            logger.warn('[TADjs] エディタのwindowIdが見つかりません');
            return;
        }

        // エディタウィンドウの位置を取得
        const editorWindow = document.getElementById(editorWindowId);
        if (!editorWindow) {
            logger.warn('[TADjs] エディタウィンドウ要素が見つかりません');
            return;
        }

        const editorRect = editorWindow.getBoundingClientRect();

        // 検索/置換ウィンドウのコンテンツ
        const pluginPath = 'plugins/basic-text-editor/find-replace.html';
        const content = `<iframe src="${pluginPath}" style="width: 100%; height: 100%; border: none;"></iframe>`;

        // ウィンドウ位置: エディタの右上付近
        const windowWidth = 350;
        const windowHeight = 110;
        const pos = {
            x: editorRect.right - windowWidth - 20,
            y: editorRect.top + 30
        };

        const windowId = this.createWindow('検索/置換', content, {
            width: windowWidth,
            height: windowHeight,
            x: pos.x,
            y: pos.y,
            resizable: false,
            maximizable: false,
            closable: true,
            alwaysOnTop: true,
            cssClass: 'find-replace-window',
            scrollable: false,
            iconData: data.iconData || null
        });

        // 検索/置換ウィンドウとエディタの関連付けを保存
        if (!this.findReplaceRelations) {
            this.findReplaceRelations = {};
        }
        this.findReplaceRelations[windowId] = {
            editorWindowId: editorWindowId,
            editorIframe: pluginIframe
        };

        // 検索/置換ウィンドウに初期設定を送信
        setTimeout(() => {
            const windowElement = document.getElementById(windowId);
            if (windowElement) {
                const iframe = windowElement.querySelector('iframe');
                if (iframe && iframe.contentWindow) {
                    // MessageBusにiframeを登録
                    this.parentMessageBus.registerChild(windowId, iframe, {
                        windowId: windowId,
                        pluginId: 'basic-text-editor-find-replace'
                    });

                    this.parentMessageBus.sendToWindow(windowId, 'init-find-replace', {
                        editorWindowId: editorWindowId,
                        initialSearchText: data.initialSearchText || ''
                    });
                }
            }

            // エディタに検索/置換ウィンドウが開いたことを通知
            this.parentMessageBus.sendToWindow(editorWindowId, 'find-replace-window-created', {
                windowId: windowId
            });
        }, 100);

        logger.info('[TADjs] 検索/置換ウィンドウ作成:', windowId);
    }

    /**
     * find-next ハンドラー - 検索/置換ウィンドウからエディタへ転送
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleFindNext(data, event) {
        const relation = this.getFindReplaceRelation(event.source);
        if (relation) {
            this.parentMessageBus.sendToWindow(relation.editorWindowId, 'find-next-request', {
                searchText: data.searchText,
                isRegex: data.isRegex
            });
        }
    }

    /**
     * replace-next ハンドラー - 検索/置換ウィンドウからエディタへ転送
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleReplaceNext(data, event) {
        const relation = this.getFindReplaceRelation(event.source);
        if (relation) {
            this.parentMessageBus.sendToWindow(relation.editorWindowId, 'replace-next-request', {
                searchText: data.searchText,
                replaceText: data.replaceText,
                isRegex: data.isRegex
            });
        }
    }

    /**
     * replace-all ハンドラー - 検索/置換ウィンドウからエディタへ転送
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleReplaceAll(data, event) {
        const relation = this.getFindReplaceRelation(event.source);
        if (relation) {
            this.parentMessageBus.sendToWindow(relation.editorWindowId, 'replace-all-request', {
                searchText: data.searchText,
                replaceText: data.replaceText,
                isRegex: data.isRegex
            });
        }
    }

    /**
     * 検索/置換ウィンドウの関連情報を取得
     * @param {Window} source - 検索/置換ウィンドウのcontentWindow
     * @returns {Object|null} 関連情報 {editorWindowId, editorIframe}
     */
    getFindReplaceRelation(source) {
        if (!source || !source.frameElement || !this.findReplaceRelations) {
            return null;
        }

        const findReplaceFrame = source.frameElement;
        const findReplaceWindowElement = findReplaceFrame.closest('.window');
        if (!findReplaceWindowElement) {
            return null;
        }

        const findReplaceWindowId = findReplaceWindowElement.id;
        return this.findReplaceRelations[findReplaceWindowId] || null;
    }

    // ========================================
    // 基本表計算用 検索/置換ウィンドウ
    // ========================================

    /**
     * open-calc-find-replace-window ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleOpenCalcFindReplaceWindow(data, event) {
        logger.info('[TADjs] 基本表計算 検索/置換ウィンドウを開く');

        const pluginIframe = event.source ? event.source.frameElement : null;
        if (!pluginIframe) {
            logger.warn('[TADjs] プラグインのiframeが見つかりません');
            return;
        }

        const editorWindowId = this.parentMessageBus.getWindowIdFromIframe(pluginIframe);
        if (!editorWindowId) {
            logger.warn('[TADjs] エディタのwindowIdが見つかりません');
            return;
        }

        // エディタウィンドウの位置を取得
        const editorWindow = document.getElementById(editorWindowId);
        if (!editorWindow) {
            logger.warn('[TADjs] エディタウィンドウ要素が見つかりません');
            return;
        }

        const editorRect = editorWindow.getBoundingClientRect();

        // 検索/置換ウィンドウのコンテンツ
        const pluginPath = 'plugins/basic-calc-editor/find-replace.html';
        const content = `<iframe src="${pluginPath}" style="width: 100%; height: 100%; border: none;"></iframe>`;

        // ウィンドウ位置: エディタの右上付近
        const windowWidth = 350;
        const windowHeight = 110;
        const pos = {
            x: editorRect.right - windowWidth - 20,
            y: editorRect.top + 30
        };

        const windowId = this.createWindow('検索/置換', content, {
            width: windowWidth,
            height: windowHeight,
            x: pos.x,
            y: pos.y,
            resizable: false,
            maximizable: false,
            closable: true,
            alwaysOnTop: true,
            cssClass: 'find-replace-window',
            scrollable: false
        });

        // 検索/置換ウィンドウとエディタの関連付けを保存
        if (!this.calcFindReplaceRelations) {
            this.calcFindReplaceRelations = {};
        }
        this.calcFindReplaceRelations[windowId] = {
            editorWindowId: editorWindowId,
            editorIframe: pluginIframe
        };

        // 検索/置換ウィンドウに初期設定を送信
        setTimeout(() => {
            const windowElement = document.getElementById(windowId);
            if (windowElement) {
                const iframe = windowElement.querySelector('iframe');
                if (iframe && iframe.contentWindow) {
                    // MessageBusにiframeを登録
                    this.parentMessageBus.registerChild(windowId, iframe, {
                        windowId: windowId,
                        pluginId: 'basic-calc-editor-find-replace'
                    });

                    this.parentMessageBus.sendToWindow(windowId, 'init-find-replace', {
                        editorWindowId: editorWindowId,
                        initialSearchText: data.initialSearchText || ''
                    });
                }
            }

            // エディタに検索/置換ウィンドウが開いたことを通知
            this.parentMessageBus.sendToWindow(editorWindowId, 'find-replace-window-created', {
                windowId: windowId
            });
        }, 100);

        logger.info('[TADjs] 基本表計算 検索/置換ウィンドウ作成:', windowId);
    }

    /**
     * calc-find-next ハンドラー - 検索/置換ウィンドウからエディタへ転送
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleCalcFindNext(data, event) {
        const relation = this.getCalcFindReplaceRelation(event.source);
        if (relation) {
            this.parentMessageBus.sendToWindow(relation.editorWindowId, 'calc-find-next-request', {
                searchText: data.searchText,
                isRegex: data.isRegex
            });
        }
    }

    /**
     * calc-replace-next ハンドラー - 検索/置換ウィンドウからエディタへ転送
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleCalcReplaceNext(data, event) {
        const relation = this.getCalcFindReplaceRelation(event.source);
        if (relation) {
            this.parentMessageBus.sendToWindow(relation.editorWindowId, 'calc-replace-next-request', {
                searchText: data.searchText,
                replaceText: data.replaceText,
                isRegex: data.isRegex
            });
        }
    }

    /**
     * calc-replace-all ハンドラー - 検索/置換ウィンドウからエディタへ転送
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleCalcReplaceAll(data, event) {
        const relation = this.getCalcFindReplaceRelation(event.source);
        if (relation) {
            this.parentMessageBus.sendToWindow(relation.editorWindowId, 'calc-replace-all-request', {
                searchText: data.searchText,
                replaceText: data.replaceText,
                isRegex: data.isRegex
            });
        }
    }

    /**
     * 基本表計算 検索/置換ウィンドウの関連情報を取得
     * @param {Window} source - 検索/置換ウィンドウのcontentWindow
     * @returns {Object|null} 関連情報 {editorWindowId, editorIframe}
     */
    getCalcFindReplaceRelation(source) {
        if (!source || !source.frameElement || !this.calcFindReplaceRelations) {
            return null;
        }

        const findReplaceFrame = source.frameElement;
        const findReplaceWindowElement = findReplaceFrame.closest('.window');
        if (!findReplaceWindowElement) {
            return null;
        }

        const findReplaceWindowId = findReplaceWindowElement.id;
        return this.calcFindReplaceRelations[findReplaceWindowId] || null;
    }

    // ========================================
    // TADデータ管理
    // ========================================

    /**
     * TADデータをcanvasに保存
     * @param {HTMLCanvasElement} canvas - 保存先のcanvas要素
     * @param {Object} tadData - TADデータオブジェクト
     * @param {string} canvasId - canvas要素のID
     */
    saveTadDataToCanvas(canvas, tadData, canvasId) {
        const { linkRecordList, tadRecordDataArray, currentFileIndex } = tadData;
        
        // canvasIdに対応するウィンドウのoriginalLinkIdを取得
        let originalLinkId = null;
        for (const [windowId, windowInfo] of this.windows) {
            //     canvasId: windowInfo.canvasId,
            //     originalLinkId: windowInfo.originalLinkId,
            //     matches: windowInfo.canvasId === canvasId
            // });
            if (windowInfo.canvasId === canvasId) {
                originalLinkId = windowInfo.originalLinkId;
                break;
            }
        }
        
        // グローバル変数からも確認
        const globalOriginalLinkId = window.originalLinkId;

        // グローバル変数を優先（tad.jsで設定された値を使用）
        if (globalOriginalLinkId !== null && globalOriginalLinkId !== undefined) {
            originalLinkId = globalOriginalLinkId;
        }
        
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

            if (linkRecordList && linkRecordList[linkIndex] && Array.isArray(linkRecordList[linkIndex])) {
                virtualLinks = [...linkRecordList[linkIndex]];
            } else {
                // console.warn(`linkRecordList[${linkIndex}] not found for link_id ${originalLinkId}`);
            }
        } else {
            // メインウィンドウの場合：最初のファイルのリンクレコード

            if (linkRecordList && linkRecordList[0] && Array.isArray(linkRecordList[0])) {
                virtualLinks = [...linkRecordList[0]];
            } else {
                // console.warn('linkRecordList[0] not found');
            }
        }


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

        logger.info('[TADjs] 実身ファイルIDセットを生成:', fileIdSet);
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
            logger.info('[TADjs] xmlTADをファイルに保存開始:', fileId);

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
                    logger.info('[TADjs] xmlTADファイル保存成功:', filename);

                    // キャッシュをクリアして次回は新しいファイルを読み込む
                    delete this.fileObjects[filename];
                    logger.info('[TADjs] ファイルキャッシュをクリア:', filename);

                    // JSONファイルのupdateDateを更新
                    const jsonFileName = `${baseFileId}.json`;
                    const jsonResult = await this.loadDataFile(this.getDataBasePath(), jsonFileName);
                    if (jsonResult.success && jsonResult.data) {
                        const jsonData = JSON.parse(jsonResult.data);
                        jsonData.updateDate = new Date().toISOString();
                        // 使用者名が設定されている場合はmakerフィールドも更新
                        if (this.currentUser) {
                            jsonData.maker = this.currentUser;
                        }

                        const jsonSaved = await this.saveDataFile(jsonFileName, JSON.stringify(jsonData, null, 2));
                        if (jsonSaved) {
                            logger.info('[TADjs] JSONファイルのupdateDate更新完了:', baseFileId);

                            // JSONファイルのキャッシュもクリア
                            delete this.fileObjects[jsonFileName];
                            logger.info('[TADjs] JSONファイルキャッシュをクリア:', jsonFileName);
                        } else {
                            logger.warn('[TADjs] JSONファイル保存失敗:', jsonFileName);
                        }
                    } else {
                        logger.info('[TADjs] JSONファイルが見つかりません（updateDate更新スキップ）:', jsonFileName);
                    }

                    this.setStatusMessage(`ファイルを保存しました: ${filename}`);
                } else {
                    logger.error('[TADjs] xmlTADファイル保存失敗:', filename);
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

                logger.info('[TADjs] xmlTADダウンロード開始:', filename);
                this.setStatusMessage(`ファイルをダウンロード中: ${filename}`);
            }

        } catch (error) {
            logger.error('[TADjs] xmlTAD保存エラー:', error);
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
            logger.info('[TADjs] backgroundColor更新開始:', fileId, backgroundColor);

            // fileIdから実身IDを抽出（_0.xtad等の拡張子を除去）
            const realId = fileId.replace(/_\d+\.xtad$/, '');

            // JSONファイル名を構築
            const jsonFilename = `${realId}.json`;

            // Electron環境の場合、ファイルシステムから読み込んで更新
            if (this.isElectronEnv) {
                const dataBasePath = this.getDataBasePath();
                const jsonPath = this.path.join(dataBasePath, jsonFilename);

                // JSONファイルを読み込み
                try {
                    const jsonContent = this.fs.readFileSync(jsonPath, 'utf-8');
                    const metadata = JSON.parse(jsonContent);

                    // backgroundColorを更新（window.backgroundColor）
                    if (!metadata.window) {
                        metadata.window = {};
                    }
                    metadata.window.backgroundColor = backgroundColor;

                    // updateDateを更新
                    metadata.updateDate = new Date().toISOString();
                    // 使用者名が設定されている場合はmakerフィールドも更新
                    if (this.currentUser) {
                        metadata.maker = this.currentUser;
                    }

                    // JSONファイルに保存
                    const saved = await this.saveDataFile(jsonFilename, JSON.stringify(metadata, null, 2));
                    if (saved) {
                        logger.info('[TADjs] backgroundColor更新成功:', jsonFilename);

                        // ファイル直接アクセス版では不要（ファイル保存のみ）
                        logger.info('[TADjs] backgroundColorを更新:', fileId);

                        this.setStatusMessage(`背景色を更新しました: ${backgroundColor}`);
                    } else {
                        logger.error('[TADjs] backgroundColor更新失敗:', jsonFilename);
                        this.setStatusMessage(`背景色更新エラー: ${jsonFilename}`);
                    }
                } catch (readError) {
                    logger.error('[TADjs] JSONファイル読み込みエラー:', jsonFilename, readError);
                    this.setStatusMessage(`JSONファイル読み込みエラー: ${jsonFilename}`);
                }
            }

        } catch (error) {
            logger.error('[TADjs] backgroundColor更新エラー:', error);
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
            logger.info('[TADjs] isFullscreen更新開始:', fileId, isFullscreen);

            // JSONファイル名を構築
            const jsonFilename = `${fileId}.json`;

            // Electron環境の場合、ファイルシステムから読み込んで更新
            if (this.isElectronEnv) {
                const dataBasePath = this.getDataBasePath();
                const jsonPath = this.path.join(dataBasePath, jsonFilename);

                // JSONファイルを読み込み
                try {
                    const jsonContent = this.fs.readFileSync(jsonPath, 'utf-8');
                    const metadata = JSON.parse(jsonContent);

                    // isFullscreenを更新
                    metadata.isFullscreen = isFullscreen;

                    // metadataにrealIdを設定
                    metadata.realId = fileId;

                    // JSONファイルに保存
                    const saved = await this.saveDataFile(jsonFilename, JSON.stringify(metadata, null, 2));
                    if (saved) {
                        logger.info('[TADjs] isFullscreen更新成功:', jsonFilename);

                        // ファイル直接アクセス版では不要（ファイル保存のみ）
                        logger.info('[TADjs] isFullscreenを更新:', fileId);

                        this.setStatusMessage(`全画面表示状態を更新しました: ${isFullscreen ? 'ON' : 'OFF'}`);
                    } else {
                        logger.error('[TADjs] isFullscreen更新失敗:', jsonFilename);
                        this.setStatusMessage(`全画面表示状態更新エラー: ${jsonFilename}`);
                    }
                } catch (readError) {
                    logger.error('[TADjs] JSONファイル読み込みエラー:', jsonFilename, readError);
                    this.setStatusMessage(`JSONファイル読み込みエラー: ${jsonFilename}`);
                }
            }

        } catch (error) {
            logger.error('[TADjs] isFullscreen更新エラー:', error);
            this.setStatusMessage('全画面表示状態更新エラー');
        }
    }

    /**
     * 実身新規作成ハンドラー
     */
    async handleCreateRealObject(e) {
        return this.executeRealObjectOperation(
            e,
            '実身作成',
            async (realObjectSystem, data) => {
                const { realName, initialXtad, applist, windowConfig } = data;
                const realId = await realObjectSystem.createRealObject(realName, initialXtad, applist, windowConfig);
                return { realId, realName };
            },
            'real-object-created'
        );
    }

    /**
     * 仮身コピーハンドラー
     */
    async handleCopyVirtualObject(e) {
        return this.executeRealObjectOperation(
            e,
            '仮身コピー',
            async (realObjectSystem, data) => {
                const { realId } = data;
                await realObjectSystem.copyVirtualObject(realId);
                return { realId };
            },
            'virtual-object-copied',
            {
                postProcess: async (result, _event) => {
                    // JSONファイルのrefCountも更新
                    await this.updateJsonFileRefCount(result.realId);
                    return result;
                }
            }
        );
    }

    /**
     * 実身コピーハンドラー
     */
    async handleCopyRealObject(e) {
        return this.executeRealObjectOperation(
            e,
            '実身コピー',
            async (realObjectSystem, data) => {
                const { realId } = data;
                const newRealId = await realObjectSystem.copyRealObject(realId);
                return { oldRealId: realId, newRealId };
            },
            'real-object-copied'
        );
    }

    /**
     * 仮身削除ハンドラー
     */
    async handleDeleteVirtualObject(e) {
        return this.executeRealObjectOperation(
            e,
            '仮身削除',
            async (realObjectSystem, data) => {
                const { realId } = data;
                await realObjectSystem.deleteVirtualObject(realId);
                return { realId };
            },
            'virtual-object-deleted',
            {
                postProcess: async (result, _event) => {
                    // JSONファイルのrefCountも更新
                    await this.updateJsonFileRefCount(result.realId);
                    return result;
                }
            }
        );
    }

    /**
     * 実身読み込みハンドラー
     */
    async handleLoadRealObject(e) {
        return this.executeRealObjectOperation(
            e,
            '実身読み込み',
            async (realObjectSystem, data) => {
                const { realId } = data;
                const realObject = await realObjectSystem.loadRealObject(realId);

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

                return { realObject };
            },
            'real-object-loaded'
        );
    }

    /**
     * 実身保存ハンドラー
     */
    async handleSaveRealObject(e) {
        return this.executeRealObjectOperation(
            e,
            '実身保存',
            async (realObjectSystem, data) => {
                const { realId, realObject } = data;
                await realObjectSystem.saveRealObject(realId, realObject);
                return { realId };
            },
            'real-object-saved'
        );
    }

    /**
     * 参照カウント0の実身一覧取得ハンドラー
     */
    async handleGetUnreferencedRealObjects(e) {
        return this.executeRealObjectOperation(
            e,
            '参照カウント0の実身一覧取得',
            async (realObjectSystem, _data) => {
                const unreferencedObjects = await realObjectSystem.getUnreferencedRealObjects();
                return { realObjects: unreferencedObjects };
            },
            'unreferenced-real-objects-response'
        );
    }

    /**
     * ファイルシステム再探索ハンドラー
     * （ファイル直接アクセス版では同期不要なので常に成功を返す）
     */
    async handleRescanFilesystem(e) {
        return this.executeRealObjectOperation(
            e,
            'ファイルシステム再探索',
            async (_realObjectSystem, _data) => {
                // ファイル直接アクセスでは同期不要
                // ファイル数をカウントして返す
                let fileCount = 0;
                if (this.isElectronEnv) {
                    const dataBasePath = this._basePath;
                    const files = this.fs.readdirSync(dataBasePath);
                    fileCount = files.filter(f => f.endsWith('.json')).length;
                }
                return { syncCount: fileCount };
            },
            'rescan-filesystem-response',
            {
                requireRealObjectSystem: false,
                errorType: 'rescan-filesystem-response'
            }
        );
    }

    /**
     * 実身物理削除ハンドラー
     */
    async handlePhysicalDeleteRealObject(e) {
        if (!this.realObjectSystem) {
            logger.error('[TADjs] 実身仮身システムが初期化されていません');
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
                    logger.warn('[TADjs] JSONファイル削除失敗:', jsonResult.error);
                }

                // XTADファイルを削除（複数のレコードがある可能性を考慮）
                for (let i = 0; i < 10; i++) {  // 最大10レコードまで試行
                    const xtadFilePath = `${dataBasePath}/${realId}_${i}.xtad`;
                    const xtadResult = await window.electronAPI.deleteFile(xtadFilePath);
                    if (!xtadResult.success && i === 0) {
                        // 最初のレコードが見つからない場合は警告
                        logger.warn('[TADjs] XTADファイル削除失敗:', xtadResult.error);
                    }
                    // ファイルが見つからなくなったら終了
                    if (!xtadResult.success) {
                        break;
                    }
                }
            } else {
                logger.warn('[TADjs] electronAPI.deleteFile が利用できません（ブラウザモード）');
            }

            if (e.source) {
                e.source.postMessage({
                    type: 'delete-real-object-response',
                    messageId: messageId,
                    success: true,
                    realId: realId
                }, '*');
            }

            logger.info('[TADjs] 実身物理削除完了:', realId);
        } catch (error) {
            logger.error('[TADjs] 実身物理削除エラー:', error);
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
     * 原紙アイコンコピーハンドラー
     * プラグインの原紙アイコンを指定した実身にコピーする
     */
    async handleCopyTemplateIcon(e) {
        if (!this.realObjectSystem) {
            logger.error('[TADjs] 実身仮身システムが初期化されていません');
            return;
        }

        const { realId, pluginId, messageId } = e.data;

        try {
            // プラグイン情報を取得
            const plugin = window.pluginManager && window.pluginManager.plugins.get(pluginId);
            if (!plugin || !plugin.basefile || !plugin.basefile.ico) {
                logger.warn('[TADjs] プラグインまたは原紙アイコンが見つかりません:', pluginId);
                if (e.source) {
                    e.source.postMessage({
                        type: 'template-icon-copied',
                        messageId: messageId,
                        success: false,
                        error: 'プラグインまたは原紙アイコンが見つかりません'
                    }, '*');
                }
                return;
            }

            // 原紙アイコンをコピー
            const success = await this.realObjectSystem.copyTemplateIcon(
                realId,
                pluginId,
                plugin.basefile.ico
            );

            if (e.source) {
                e.source.postMessage({
                    type: 'template-icon-copied',
                    messageId: messageId,
                    success: success,
                    realId: realId,
                    pluginId: pluginId
                }, '*');
            }

            if (success) {
                logger.info('[TADjs] 原紙アイコンコピー完了:', realId, '<-', pluginId);
            }
        } catch (error) {
            logger.error('[TADjs] 原紙アイコンコピーエラー:', error);
            if (e.source) {
                e.source.postMessage({
                    type: 'template-icon-copied',
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
                logger.warn('[TADjs] JSONファイル読み込みエラー:', jsonFileName, error);
            }

            // JSONデータが存在する場合のみrefCountを更新
            if (jsonData) {
                // refCountは既にJSONファイルにあるので、realObjectSystemで更新されたものを使用
                const realObject = await this.realObjectSystem.loadRealObject(realId);
                jsonData.refCount = realObject.metadata.refCount;

                // JSONファイルに保存
                await this.saveDataFile(jsonFileName, JSON.stringify(jsonData, null, 2));
                logger.info('[TADjs] JSONファイルのrefCountを更新:', jsonFileName, 'refCount:', realObject.metadata.refCount);
            } else {
                logger.warn('[TADjs] JSONファイルが見つかりません:', jsonFileName);
            }
        } catch (error) {
            logger.error('[TADjs] JSONファイルrefCount更新エラー:', error);
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
                logger.info('[TADjs] XTADファイルのfilename属性を更新:', xtadFileName);
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

            logger.info('[TADjs] 実身名変更完了:', realId, currentName, '->', newName);
            this.setStatusMessage(`実身名を「${newName}」に変更しました`);
        } catch (error) {
            logger.error('[TADjs] 実身名変更エラー:', error);
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
            const files = this.fs.readdirSync(basePath);
            const xtadFiles = files.filter(f => f.endsWith('_0.xtad'));

            logger.info('[TADjs] リンク名更新対象XTADファイル数:', xtadFiles.length);

            for (const xtadFile of xtadFiles) {
                const xtadResult = await this.loadDataFile(basePath, xtadFile);
                if (!xtadResult.success || !xtadResult.data) continue;

                const content = xtadResult.data;

                // この実身を参照するlinkタグが存在するか確認（自己閉じタグとペアタグの両方に対応）
                const linkPattern = new RegExp(`<link[^>]*id="${realId}_0\\.xtad"[^>]*(?:\\/>|>([^<]*)</link>)`, 'g');

                if (linkPattern.test(content)) {
                    // 後方互換性のため、旧形式（ペアタグ）のname属性とリンクテキストも更新
                    // 新形式（自己閉じタグ）ではこれらは存在しないため、更新されない
                    let updatedContent = content;

                    // 1. name属性を更新（旧形式の後方互換性）
                    updatedContent = updatedContent.replace(
                        new RegExp(`(<link[^>]*id="${realId}_0\\.xtad"[^>]*name=")[^"]*("[^>]*>)`, 'g'),
                        `$1${newName}$2`
                    );

                    // 2. リンクテキストを更新（旧形式の後方互換性）
                    updatedContent = updatedContent.replace(
                        new RegExp(`(<link[^>]*id="${realId}_0\\.xtad"[^>]*>)[^<]*(</link>)`, 'g'),
                        `$1${newName}$2`
                    );

                    // ファイルを保存
                    await this.saveDataFile(xtadFile, updatedContent);
                    logger.info('[TADjs] リンク名とname属性を更新:', xtadFile, '->', newName);
                }
            }
        } catch (error) {
            logger.error('[TADjs] リンク名更新エラー:', error);
        }
    }

    /**
     * ファイル取り込みハンドラー
     * file-import プラグインから呼び出される
     * @param {Object} dataOrEvent - イベント（汎用ハンドラー経由）またはデータ
     * @param {Object} event - イベント（関数ハンドラー経由の場合）
     */
    async handleImportFiles(dataOrEvent, event) {
        logger.info('[TADjs] handleImportFiles開始');

        // 汎用ハンドラー経由の場合: dataOrEventはイベントオブジェクト (e)
        // 関数ハンドラー経由の場合: dataOrEventはデータ (e.data), eventはイベント (e)
        const data = dataOrEvent?.data || dataOrEvent;
        const source = dataOrEvent?.source || event?.source;

        const { files, windowId } = data;

        // 応答を送信するヘルパー関数
        const sendResponse = (responseData) => {
            if (windowId) {
                // windowIdが指定されている場合は、そのウィンドウに送信
                this.parentMessageBus.sendToWindow(windowId, 'files-imported', responseData);
            } else if (source) {
                // sourceが利用可能な場合はrespondToを使用
                this.parentMessageBus.respondTo(source, 'files-imported', responseData);
            } else {
                logger.warn('[TADjs] 応答先が見つかりません（windowId, sourceともにnull）');
            }
        };

        if (!files || files.length === 0) {
            logger.warn('[TADjs] ファイルが指定されていません');
            sendResponse({ success: false, error: 'ファイルが指定されていません' });
            return;
        }

        logger.info('[TADjs] ファイルを取り込みます:', files.length, '個');

        try {
            // アクティブな仮身一覧プラグインのiframeを探す
            let virtualObjectListIframe = null;

            // まず、windows Mapから仮身一覧プラグインのウィンドウを探す
            for (const [wId, windowInfo] of this.windows.entries()) {
                if (windowInfo.pluginId === 'virtual-object-list') {
                    const windowElement = document.getElementById(wId);
                    if (windowElement) {
                        virtualObjectListIframe = windowElement.querySelector('iframe');
                        if (virtualObjectListIframe && virtualObjectListIframe.contentWindow) {
                            logger.info('[TADjs] 仮身一覧プラグインのiframeを見つけました:', wId);
                            break;
                        }
                    }
                }
            }

            // 仮身一覧プラグインが見つからない場合はエラー
            if (!virtualObjectListIframe || !virtualObjectListIframe.contentWindow) {
                logger.error('[TADjs] 仮身一覧プラグインが見つかりません');
                sendResponse({ success: false, error: '仮身一覧プラグインが開かれていません' });
                return;
            }

            // FileImportManagerを使用してファイルをインポート
            if (this.fileImportManager) {
                await this.fileImportManager.handleFilesImport(files, virtualObjectListIframe);

                // 成功を通知
                sendResponse({ success: true });

                logger.info('[TADjs] ファイル取り込み完了');
            } else {
                logger.error('[TADjs] FileImportManagerが初期化されていません');
                sendResponse({ success: false, error: 'FileImportManagerが初期化されていません' });
            }
        } catch (error) {
            logger.error('[TADjs] ファイル取り込みエラー:', error);
            sendResponse({ success: false, error: error.message });
        }
    }

    /**
     * 新たな実身に保存ハンドラー（非再帰的コピー）
     */
    async handleSaveAsNewRealObject(dataOrEvent, event) {
        if (!this.realObjectSystem) {
            logger.error('[TADjs] 実身仮身システムが初期化されていません');
            return;
        }

        // MessageBus Phase 2形式に対応
        const data = dataOrEvent;
        const source = event?.source;
        const { realId: fullRealId, messageId } = data;

        // realIdが未定義の場合はエラー
        if (!fullRealId) {
            logger.error('[TADjs] realIdが未定義です:', data);
            if (source) {
                this.parentMessageBus.respondTo(source, 'save-as-new-real-object-completed', {
                    messageId: messageId,
                    success: false,
                    error: 'realIdが未定義です'
                });
            }
            return;
        }

        // 実身IDを抽出（_0.xtad を除去）
        let realId = fullRealId;
        if (realId.match(/_\d+\.xtad$/i)) {
            realId = realId.replace(/_\d+\.xtad$/i, '');
        }
        logger.info('[TADjs] 実身ID抽出:', realId, 'フルID:', fullRealId);

        try {
            // 元の実身のメタデータを取得
            const sourceRealObject = await this.realObjectSystem.loadRealObject(realId);
            const defaultName = (sourceRealObject.metadata.name || '実身') + 'のコピー';

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
                logger.info('[TADjs] 新たな実身に保存がキャンセルされました');
                if (source) {
                    this.parentMessageBus.respondTo(source, 'save-as-new-real-object-completed', {
                        messageId: messageId,
                        success: false,
                        cancelled: true
                    });
                }
                return;
            }

            const newName = result.value;

            // RealObjectSystemの非再帰的実身コピー機能を使用
            const newRealId = await this.realObjectSystem.copyRealObjectNonRecursive(realId, newName);

            // JSONファイルにもrefCountを書き込む
            await this.updateJsonFileRefCount(newRealId);

            // 成功を通知（プラグイン側で仮身追加処理を行う）
            if (source) {
                this.parentMessageBus.respondTo(source, 'save-as-new-real-object-completed', {
                    messageId: messageId,
                    success: true,
                    newRealId: newRealId,
                    newName: newName
                });
            }

            logger.info('[TADjs] 新たな実身に保存完了:', realId, '->', newRealId, '名前:', newName);
            this.setStatusMessage(`新しい実身に保存しました: ${newName}`);
        } catch (error) {
            logger.error('[TADjs] 新たな実身に保存エラー:', error);
            if (source) {
                this.parentMessageBus.respondTo(source, 'save-as-new-real-object-completed', {
                    messageId: messageId,
                    success: false,
                    error: error.message
                });
            }
        }
    }

    /**
     * 選択範囲を仮身化（新しい実身として切り出し）ハンドラー
     */
    async handleVirtualizeSelection(data, event) {
        if (!this.realObjectSystem) {
            logger.error('[TADjs] 実身仮身システムが初期化されていません');
            return;
        }

        const source = event?.source;
        const { messageId, defaultName, xtadContent, imageFiles, sourceRealId } = data;

        try {
            // 名前入力ダイアログを表示
            const result = await this.showInputDialog(
                '新しい実身の名称を入力してください',
                defaultName || '新規実身',
                30,
                [
                    { label: '取消', value: 'cancel' },
                    { label: '設定', value: 'ok' }
                ],
                1
            );

            // キャンセルされた場合
            if (result.button === 'cancel' || !result.value) {
                logger.info('[TADjs] 仮身化がキャンセルされました');
                if (source) {
                    this.parentMessageBus.respondTo(source, 'virtualize-selection-completed', {
                        messageId: messageId,
                        success: false,
                        cancelled: true
                    });
                }
                return;
            }

            const newName = result.value;

            // 新しい実身IDを生成
            const newRealId = this.realObjectSystem.generateUUIDv7();
            logger.info('[TADjs] 仮身化: 新実身ID生成:', newRealId);

            // 画像ファイルのコピーとXTAD内参照の置換
            let finalXtad = xtadContent;
            const basePath = this.realObjectSystem._basePath;

            if (imageFiles && imageFiles.length > 0) {
                for (let i = 0; i < imageFiles.length; i++) {
                    const imgInfo = imageFiles[i];
                    const newFilename = `${newRealId}_0_${i}.png`;

                    // 元画像ファイルをコピー
                    const sourceImagePath = this.realObjectSystem.path.join(basePath, imgInfo.originalFilename);
                    const destImagePath = this.realObjectSystem.path.join(basePath, newFilename);

                    if (this.realObjectSystem.fs.existsSync(sourceImagePath)) {
                        try {
                            this.realObjectSystem.fs.copyFileSync(sourceImagePath, destImagePath);
                            logger.debug('[TADjs] 画像ファイルコピー:', imgInfo.originalFilename, '->', newFilename);
                        } catch (copyError) {
                            logger.error('[TADjs] 画像ファイルコピーエラー:', copyError);
                        }
                    }

                    // XTAD内のプレースホルダーを実際のファイル名に置換
                    finalXtad = finalXtad.replace(new RegExp(`__IMAGE_${i}__`, 'g'), newFilename);
                }
            }

            // XTAD全体をラップ
            const wrappedXtad = `<tad version="1.0" encoding="UTF-8">\r\n<document>\r\n<p>\r\n${finalXtad}\r\n</p>\r\n</document>\r\n</tad>`;

            // 新規実身を保存
            const newRealObject = {
                metadata: {
                    realId: newRealId,
                    name: newName,
                    recordCount: 1,
                    refCount: 1,
                    makeDate: new Date().toISOString(),
                    updateDate: new Date().toISOString(),
                    accessDate: new Date().toISOString(),
                    applist: {
                        'basic-text-editor': {
                            name: '基本文章編集',
                            defaultOpen: true
                        }
                    }
                },
                records: [{ xtad: wrappedXtad }]
            };

            await this.realObjectSystem.saveRealObject(newRealId, newRealObject);

            // 基本文章編集プラグインのアイコンをコピー（fs.readFileSyncを使用）
            try {
                // プログラムベースパス（plugins フォルダがある場所）を使用
                const programBasePath = this._programBasePath;
                // plugin.json の basefile.ico を参照
                const baseIconPath = this.path.join(programBasePath, 'plugins/basic-text-editor/019a1132-762b-7b02-ba2a-a918a9b37c39.ico');

                if (this.fs.existsSync(baseIconPath)) {
                    const iconData = this.fs.readFileSync(baseIconPath);
                    const newIconFileName = `${newRealId}.ico`;
                    const iconSaved = await this.saveDataFile(newIconFileName, iconData);
                    if (iconSaved) {
                        logger.info('[TADjs] 仮身化: アイコンファイルコピー完了:', newIconFileName);
                    } else {
                        logger.warn('[TADjs] 仮身化: アイコンファイル保存失敗');
                    }
                } else {
                    logger.warn('[TADjs] 仮身化: アイコンファイルが見つかりません:', baseIconPath);
                }
            } catch (iconError) {
                logger.warn('[TADjs] 仮身化: アイコンファイルコピー失敗:', iconError);
            }

            // JSONファイルにrefCountを書き込む
            await this.updateJsonFileRefCount(newRealId);

            // 成功を通知
            if (source) {
                this.parentMessageBus.respondTo(source, 'virtualize-selection-completed', {
                    messageId: messageId,
                    success: true,
                    newRealId: newRealId,
                    newName: newName
                });
            }

            logger.info('[TADjs] 仮身化完了:', newRealId, '名前:', newName);
            this.setStatusMessage(`仮身化しました: ${newName}`);

        } catch (error) {
            logger.error('[TADjs] 仮身化エラー:', error);
            if (source) {
                this.parentMessageBus.respondTo(source, 'virtualize-selection-completed', {
                    messageId: messageId,
                    success: false,
                    error: error.message
                });
            }
        }
    }

    /**
     * 仮身属性変更ハンドラー
     */
    async handleChangeVirtualObjectAttributes(dataOrEvent, event) {
        // MessageBus Phase 2形式に対応
        const data = dataOrEvent;
        const source = event?.source;
        const { virtualObject: _virtualObject, currentAttributes, selectedRatio, messageId } = data;

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
                if (source) {
                    this.parentMessageBus.respondTo(source, 'virtual-object-attributes-changed', {
                        messageId: messageId,
                        success: false
                    });
                }
                return;
            }

            // ダイアログから値を取得
            const attributes = this.extractVirtualObjectAttributesFromDialog(result.dialogElement);

            // 成功を通知
            if (source) {
                this.parentMessageBus.respondTo(source, 'virtual-object-attributes-changed', {
                    messageId: messageId,
                    success: true,
                    attributes: attributes
                });
            }

            logger.info('[TADjs] 仮身属性変更完了:', attributes);
        } catch (error) {
            logger.error('[TADjs] 仮身属性変更エラー:', error);
            if (source) {
                this.parentMessageBus.respondTo(source, 'virtual-object-attributes-changed', {
                    messageId: messageId,
                    success: false,
                    error: error.message
                });
            }
        }
    }

    /**
     * ウィンドウ設定更新ハンドラー
     */
    async handleUpdateWindowConfig(e) {
        const { fileId, windowConfig } = e.data;

        if (!fileId || !windowConfig) {
            logger.error('[TADjs] ウィンドウ設定更新: fileIdまたはwindowConfigが不足');
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
                if (windowConfig.panel !== undefined) {
                    jsonData.window.panel = windowConfig.panel;
                }
                if (windowConfig.panelpos) {
                    jsonData.window.panelpos = windowConfig.panelpos;
                }
                if (windowConfig.backgroundColor !== undefined) {
                    jsonData.window.backgroundColor = windowConfig.backgroundColor;
                }
                if (windowConfig.scrollPos) {
                    jsonData.window.scrollPos = windowConfig.scrollPos;
                }
                if (windowConfig.wordWrap !== undefined) {
                    jsonData.window.wordWrap = windowConfig.wordWrap;
                }

                // updateDateを更新
                jsonData.updateDate = new Date().toISOString();
                // 使用者名が設定されている場合はmakerフィールドも更新
                if (this.currentUser) {
                    jsonData.maker = this.currentUser;
                }

                // JSONファイルに保存
                if (this.isElectronEnv) {
                    const saved = await this.saveDataFile(jsonFileName, JSON.stringify(jsonData, null, 2));
                    if (saved) {
                        logger.info('[TADjs] ウィンドウ設定をJSONファイルに保存:', realId, windowConfig);
                    } else {
                        logger.error('[TADjs] ウィンドウ設定のJSONファイル保存失敗:', jsonFileName);
                    }
                } else {
                    logger.info('[TADjs] ブラウザ環境のためJSONファイル保存をスキップ:', realId);
                }
            } else {
                logger.warn('[TADjs] ウィンドウ設定更新: JSONファイルが見つかりません:', jsonFileName);
            }
        } catch (error) {
            logger.error('[TADjs] ウィンドウ設定更新エラー:', error);
        }
    }

    /**
     * 道具パネル位置更新ハンドラー
     */
    async handleUpdatePanelPosition(e) {
        const { fileId, panelpos } = e.data;

        if (!fileId || !panelpos) {
            logger.error('[TADjs] 道具パネル位置更新: fileIdまたはpanelposが不足');
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

                // panelposを更新
                if (!jsonData.window) {
                    jsonData.window = {};
                }
                jsonData.window.panelpos = panelpos;

                // updateDateを更新
                jsonData.updateDate = new Date().toISOString();
                // 使用者名が設定されている場合はmakerフィールドも更新
                if (this.currentUser) {
                    jsonData.maker = this.currentUser;
                }

                // JSONファイルに保存
                if (this.isElectronEnv) {
                    const saved = await this.saveDataFile(jsonFileName, JSON.stringify(jsonData, null, 2));
                    if (saved) {
                        logger.info('[TADjs] 道具パネル位置をJSONファイルに保存:', realId, panelpos);
                    } else {
                        logger.error('[TADjs] 道具パネル位置のJSONファイル保存失敗:', jsonFileName);
                    }
                } else {
                    logger.info('[TADjs] ブラウザ環境のためJSONファイル保存をスキップ:', realId);
                }
            } else {
                logger.warn('[TADjs] 道具パネル位置更新: JSONファイルが見つかりません:', jsonFileName);
            }
        } catch (error) {
            logger.error('[TADjs] 道具パネル位置更新エラー:', error);
        }
    }

    /**
     * 仮身属性変更ダイアログのHTMLを生成
     */
    /**
     * 仮身属性ダイアログのHTML生成（DialogManagerに委譲）
     * @param {Object} attrs - 仮身属性
     * @param {string} selectedRatio - 選択中の文字サイズ倍率ラベル
     * @returns {string} ダイアログHTML
     */
    createVirtualObjectAttributesDialogHtml(attrs, selectedRatio) {
        if (this.dialogManager) {
            return this.dialogManager.createVirtualObjectAttributesDialogHtml(attrs, selectedRatio);
        }
        logger.warn('[TADjs] DialogManagerが利用できません');
        return '<div>DialogManagerが利用できません</div>';
    }

    /**
     * ダイアログから仮身属性を抽出（DialogManagerに委譲）
     * @param {Element} dialogElement - ダイアログ要素
     * @returns {Object} 仮身属性オブジェクト
     */
    extractVirtualObjectAttributesFromDialog(dialogElement) {
        if (this.dialogManager) {
            return this.dialogManager.extractVirtualObjectAttributesFromDialog(dialogElement);
        }
        logger.warn('[TADjs] DialogManagerが利用できません');
        return {};
    }
}

// デスクトップ環境を初期化
// （tadjs-desktop.htmlで初期化する）

// グローバル変数としてエクスポート（モジュールとして読み込まれるため）
window.TADjsDesktop = TADjsDesktop;