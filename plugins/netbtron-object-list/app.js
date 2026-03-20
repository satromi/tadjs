/**
 * NetBtronViewer - NET仮身一覧プラグイン
 * 管理モード（接続・認証・一覧）とビューモード（XTAD描画）の2モード構成
 * ビューモードはvirtual-object-listと同等の機能を提供
 */

const logger = window.getLogger('NetBtronViewer');

// BTRON風デフォルト実身アイコン（16x16 SVG data URI）
const DEFAULT_REAL_OBJECT_ICON = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">' +
    '<rect x="0" y="0" width="16" height="16" fill="#f0f0f0" stroke="#606060" stroke-width="1"/>' +
    '<line x1="3" y1="4" x2="13" y2="4" stroke="#000080" stroke-width="0.8"/>' +
    '<line x1="3" y1="7" x2="13" y2="7" stroke="#000080" stroke-width="0.8"/>' +
    '<line x1="3" y1="10" x2="13" y2="10" stroke="#000080" stroke-width="0.8"/>' +
    '</svg>'
);

// 選択表示用の定数（VOBJ_SELECTION_COLORはutil.jsから読み込み）
const SELECTION_BOX_SHADOW = `0 0 0 2px ${VOBJ_SELECTION_COLOR}`;

/**
 * バックグラウンドアップロードマネージャ
 * 子実身のウィンドウが閉じられた時に変更を検出し、先行してクラウドにアップロードする
 */
class BackgroundUploadManager {
    constructor(plugin) {
        this.plugin = plugin;
        this.pendingUploads = new Map();
        this.completedUploads = new Map();
        this.activeCount = 0;
        this.maxConcurrency = 3;
        this.isPaused = false;
        this.isShuttingDown = false;
        this._processingPromise = null;
    }

    enqueue(realId, options = {}) {
        if (this.isShuttingDown) return;
        if (this.completedUploads.has(realId)) return;
        if (this.pendingUploads.has(realId) && this.pendingUploads.get(realId).status === 'processing') return;
        const priority = options.priority || 'low';
        this.pendingUploads.set(realId, {
            priority,
            status: 'pending',
            parentId: options.parentId || null,
            enqueuedAt: Date.now()
        });
        this._processQueue();
    }

    isCompleted(realId) {
        return this.completedUploads.has(realId);
    }

    pause() {
        this.isPaused = true;
    }

    resume() {
        this.isPaused = false;
        this._processQueue();
    }

    clear() {
        this.pendingUploads.clear();
        this.completedUploads.clear();
        this.activeCount = 0;
    }

    async shutdown(timeout = 5000) {
        this.isShuttingDown = true;
        this.pendingUploads.clear();
        if (this.activeCount > 0 && this._processingPromise) {
            await Promise.race([
                this._processingPromise,
                new Promise(resolve => setTimeout(resolve, timeout))
            ]);
        }
    }

    getStatusText() {
        const pending = [...this.pendingUploads.values()].filter(e => e.status === 'pending').length;
        const processing = this.activeCount;
        const completed = this.completedUploads.size;
        if (processing === 0 && pending === 0) return null;
        return 'バックグラウンド保存中... (' + completed + '/' + (completed + processing + pending) + '件)';
    }

    async _processQueue() {
        if (this.isPaused || this.isShuttingDown) return;
        if (this.activeCount >= this.maxConcurrency) return;

        let nextId = null;
        for (const [realId, entry] of this.pendingUploads) {
            if (entry.status !== 'pending') continue;
            if (!nextId || entry.priority === 'high') {
                nextId = realId;
                if (entry.priority === 'high') break;
            }
        }

        if (!nextId) return;

        const entry = this.pendingUploads.get(nextId);
        entry.status = 'processing';
        this.activeCount++;

        this._processingPromise = this._uploadOne(nextId, entry.parentId).finally(() => {
            this.activeCount--;
            this.pendingUploads.delete(nextId);
            this._processQueue();
        });
    }

    async _uploadOne(realId, parentId) {
        const plugin = this.plugin;
        const tenantId = plugin.currentTenantId;
        if (!tenantId) return;

        try {
            let localMetadata = null;
            try {
                const jsonFile = await plugin.loadDataFileFromParent(realId + '.json');
                if (jsonFile) {
                    const jsonText = await jsonFile.text();
                    localMetadata = JSON.parse(jsonText);
                }
            } catch (e) { logger.debug('[NetBtronViewer] ローカルメタデータ読み込みエラー:', e.message); return; }

            if (!localMetadata) return;

            // 差分判定
            const cloudData = plugin.cloudChildrenData ? plugin.cloudChildrenData.get(realId) : null;
            let needsUpload = true;
            if (cloudData) {
                const cloudUpdateDate = cloudData.metadata?.updateDate;
                const localUpdateDate = localMetadata.updateDate;
                if (cloudUpdateDate && localUpdateDate) {
                    needsUpload = new Date(localUpdateDate) > new Date(cloudUpdateDate);
                }
            }

            if (!needsUpload) {
                this.completedUploads.set(realId, { result: 'skipped', timestamp: Date.now() });
                return;
            }

            // load-real-objectで完全データ取得
            const messageId = plugin.generateMessageId('bg-upload');
            plugin.messageBus.send('load-real-object', { realId, messageId });
            const loadResult = await plugin.messageBus.waitFor('real-object-loaded', 10000,
                (data) => data.messageId === messageId);

            if (!loadResult || !loadResult.realObject) return;

            const realObject = loadResult.realObject;
            const metadata = { ...(realObject.metadata || {}) };
            metadata.id = realId;
            metadata.name = metadata.name || realId;
            if (parentId) {
                metadata.parent_id = parentId;
            }

            const xtadString = realObject.records && realObject.records[0]
                ? realObject.records[0].xtad : null;

            const files = {
                json: Array.from(new TextEncoder().encode(JSON.stringify(metadata, null, 2))),
                xtad: xtadString ? Array.from(new TextEncoder().encode(xtadString)) : null,
                ico: null,
                images: []
            };

            try {
                const icoFile = await plugin.loadDataFileFromParent(realId + '.ico');
                if (icoFile) {
                    const icoBuffer = await icoFile.arrayBuffer();
                    files.ico = Array.from(new Uint8Array(icoBuffer));
                }
            } catch (e) { logger.debug('[NetBtronViewer] 非致命的エラー:', e.message); }

            if (realObject.images && Array.isArray(realObject.images)) {
                for (const img of realObject.images) {
                    if (img.name && img.data) {
                        files.images.push({
                            name: img.name,
                            data: Array.isArray(img.data) ? img.data : Array.from(new Uint8Array(img.data))
                        });
                    }
                }
            }

            if (!files.xtad) return;

            const expectedVer = (cloudData && cloudData.version) ? cloudData.version : 0;
            const result = await window.cloudAPI.saveRealObjectWithVersion(
                tenantId, { metadata }, files, expectedVer
            );

            if (result.success) {
                if (result.realObject) {
                    plugin.cloudChildrenData.set(realId, result.realObject);
                }
                this.completedUploads.set(realId, { result: 'uploaded', timestamp: Date.now() });
                // ステータスバー更新
                const statusText = this.getStatusText();
                if (statusText) {
                    plugin.setStatus(statusText);
                } else {
                    plugin.setStatus('バックグラウンド保存完了');
                }
            }
            // 失敗・競合はcompletedに入れない → フォアグラウンド保存時に再試行
        } catch (e) {
            logger.debug('[NetBtronViewer] バックグラウンドエラー:', e.message);
        }
    }
}

class NetBtronViewer extends window.PluginBase {
    constructor() {
        super('NetBtronViewer');

        // === 管理モード状態 ===
        this.currentUser = null;
        this.currentTenantId = null;
        this.specifiedTenantName = null;  // URLで指定されたテナント名
        this.realObjects = [];
        this.selectedRealObjectId = null;
        this.isAnonymousBrowsing = false;  // 匿名参照モード
        this.internalTenantForBrowse = null;  // 匿名参照用のInternalテナント情報
        this.systemRole = 'user';  // システムロール（system_admin/tenant_creator/user）
        this.tenants = [];  // テナント一覧（オーナー判定用）

        // === ビューモード状態（virtual-object-list移植） ===
        this.isViewMode = false;
        this.fileData = null;
        this.xmlData = null;
        this.tadData = null;
        this.localXmlData = null;  // 初期化時のローカルXTADデータ（管理モードからの復帰用）
        this.virtualObjects = [];
        this.selectedVirtualObjects = new Set();
        this.clipboard = null;
        this.isFullscreen = false;

        // Cloud固有状態
        this.cloudConfig = null;           // 管理セグメントJSONのcloudConfig（テナント紐付き情報）
        this.cloudRealObjectId = null;
        this.cloudFiles = null;
        this.cloudMetadata = null;
        this.cloudVersion = 1;
        this.cloudChildrenData = new Map();  // 子実身メタデータキャッシュ（realId → dbRow）
        this.backgroundUploadManager = null;  // Phase 3: ビューモード時にバックグラウンドアップロード管理

        // 仮身ドラッグのプラグイン固有状態管理
        this.vobjDragState = {
            currentObject: null,
            currentElement: null,
            vobjIndex: null,
            initialLeft: 0,
            initialTop: 0,
            isMouseInThisWindow: true,
            lastMouseOverWindowId: null,
            dropClientX: 0,
            dropClientY: 0,
            selectedObjects: null,
            currentDeltaX: 0,
            currentDeltaY: 0,
            startScrollLeft: 0,
            startScrollTop: 0
        };

        // エッジスクロール用の状態管理
        this.edgeScrollState = {
            isScrolling: false
        };

        // ダブルクリック+ドラッグ用の状態管理
        this.dblClickDragState.lastClickedObject = null;
        this.dblClickDragState.dblClickedObject = null;

        // リサイズ状態管理
        this.isResizing = false;
        this.recreateVirtualObjectTimer = null;
        this.iframeReenableTimeout = null;
        this.justClosedContextMenu = false;

        // 子iframe通信
        this.childMessageBus = null;
        this.iconRequestMap = new Map();
        this.imagePathRequestMap = new Map();
        this.expandedIframes = new Set();

        // cloudAPI: preload.jsはメインウィンドウにのみ設定されるため、
        // iframe内では親ウィンドウから参照を取得する
        if (!window.cloudAPI && window.parent && window.parent.cloudAPI) {
            window.cloudAPI = window.parent.cloudAPI;
        }

        if (window.MessageBus) {
            this.childMessageBus = new window.MessageBus({
                debug: this.debug,
                pluginName: 'NetBtronViewer-Child',
                mode: 'parent'
            });
            this.childMessageBus.start();
        }

        this.setupCrossWindowDropSuccessHandler();
        this.init();
    }

    init() {
        this.initializeCommonComponents('[NetBtronViewer]');

        if (this.messageBus) {
            this.setupMessageBusHandlers();
        }

        this.setupWindowActivation();
        this.initScrollNotification();
        this.setupContextMenu();
        this.setupDragAndDrop();
        this.setupKeyboardShortcuts();
        this.setupVirtualObjectRightButtonHandlers();
        this.setupGlobalMouseHandlers();

        // 管理モードUI
        this.setupUI();
        this.loadSavedConfig();

        // dragoverイベントリスナー
        document.addEventListener('dragover', (e) => {
            this.vobjDragState.isMouseInThisWindow = true;
        });
    }

    // =========================================================
    // 管理モード: UI セットアップ
    // =========================================================

    setupUI() {
        document.getElementById('btn-connect').addEventListener('click', () => this.handleConnect());
        document.getElementById('btn-login').addEventListener('click', () => this.handleLogin());
        document.getElementById('btn-back-config').addEventListener('click', () => this.showPanel('config'));
        document.getElementById('login-password').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.handleLogin();
        });
        document.getElementById('btn-logout').addEventListener('click', () => this.handleLogout());
        document.getElementById('btn-browse').addEventListener('click', () => this.handleAnonymousBrowse());
        document.getElementById('btn-create-tenant').addEventListener('click', () => this.handleCreateTenant());
        document.getElementById('btn-tenant-settings').addEventListener('click', () => this.handleTenantSettings());
        document.getElementById('tenant-select').addEventListener('change', () => this.handleTenantChange());
        document.getElementById('btn-open').addEventListener('click', () => this.handleOpenTenant());
        document.getElementById('btn-upload').addEventListener('click', () => this.handleUpload());
        document.getElementById('btn-download').addEventListener('click', () => this.handleDownload());
        document.getElementById('btn-share').addEventListener('click', () => this.handleShareDialog());
        document.getElementById('btn-delete').addEventListener('click', () => this.handleDelete());
        document.getElementById('btn-refresh').addEventListener('click', () => this.handleRefresh());
        document.getElementById('btn-quota').addEventListener('click', () => this.handleQuotaDisplay());
        document.getElementById('btn-history').addEventListener('click', () => this.handleVersionHistory());
        document.getElementById('btn-login-to-edit').addEventListener('click', () => this.handleLoginToEdit());
        document.getElementById('btn-manage-members').addEventListener('click', () => this.handleMemberManagement());
        document.getElementById('btn-user-management').addEventListener('click', () => this.handleUserManagement());
        document.getElementById('btn-google-login').addEventListener('click', () => this.handleGoogleLogin());
        document.getElementById('btn-signup-with-invite').addEventListener('click', (e) => { e.preventDefault(); this.handleSignupWithInvite(); });
    }

    // =========================================================
    // 管理モード: パネル表示制御
    // =========================================================

    showPanel(panelName) {
        document.getElementById('config-panel').style.display = panelName === 'config' ? '' : 'none';
        document.getElementById('login-panel').style.display = panelName === 'login' ? '' : 'none';
        document.getElementById('main-panel').style.display = panelName === 'main' ? '' : 'none';
    }

    setStatus(message) {
        // 管理モード内のステータスバー（プラグイン内部DOM）
        const statusBar = document.getElementById('status-bar');
        if (statusBar) statusBar.textContent = message;
        // BTRON標準ステータスバー（親ウィンドウ）に送信
        super.setStatus(message);
    }

    // =========================================================
    // 管理モード: 接続設定の保存・復元
    // =========================================================

    loadSavedConfig() {
        try {
            const saved = localStorage.getItem('net-btron-config');
            if (saved) {
                const config = JSON.parse(saved);
                document.getElementById('supabase-url').value = config.url || '';
                document.getElementById('supabase-key').value = config.anonKey || '';
                document.getElementById('login-email').value = config.email || '';
            }
        } catch (e) {
            logger.debug('[NetBtronViewer] 復元失敗:', e.message);
        }
    }

    saveConfig(url, anonKey, email) {
        try {
            localStorage.setItem('net-btron-config', JSON.stringify({ url, anonKey, email }));
        } catch (e) {
            logger.debug('[NetBtronViewer] 設定保存失敗:', e.message);
        }
    }

    /**
     * 保存済み設定をオブジェクトとして取得（フォーム操作なし）
     * @returns {{ url: string, anonKey: string, email: string }|null}
     */
    loadSavedConfigData() {
        try {
            const saved = localStorage.getItem('net-btron-config');
            if (saved) {
                return JSON.parse(saved);
            }
        } catch (e) {
            logger.debug('[NetBtronViewer] 復元失敗:', e.message);
        }
        return null;
    }

    // =========================================================
    // クラウド接続情報の管理セグメントJSON保存
    // =========================================================

    /**
     * クラウド接続情報を管理セグメントJSONに保存
     * @param {string|null} tenantId - テナントID（nullでクリア）
     * @param {string|null} cloudRealObjectId - クラウド上の実身ID（nullでクリア）
     */
    async saveCloudConfigToJson(tenantId, cloudRealObjectId) {
        if (!this.realId) return;

        const messageId = this.generateMessageId('save-cloud-config');
        this.messageBus.send('load-real-object', { realId: this.realId, messageId });

        let loadResult;
        try {
            loadResult = await this.messageBus.waitFor(
                'real-object-loaded', 10000,
                (data) => data.messageId === messageId
            );
        } catch (e) {
            logger.debug('[NetBtronViewer] 実身読み込みエラー:', e.message);
            return;
        }
        if (!loadResult || !loadResult.realObject) return;

        const realObject = loadResult.realObject;

        if (tenantId) {
            // 現在のURL/Keyをlocalstorageから取得してcloudConfigに含める
            const currentConfig = this.loadSavedConfigData();
            realObject.metadata.cloudConfig = {
                supabaseUrl: (currentConfig && currentConfig.url) || '',
                anonKey: (currentConfig && currentConfig.anonKey) || '',
                tenantId: tenantId,
                cloudRealObjectId: cloudRealObjectId || null
            };
        } else {
            delete realObject.metadata.cloudConfig;
        }

        const saveMessageId = this.generateMessageId('save-cloud-config');
        this.messageBus.send('save-real-object', {
            realId: this.realId,
            realObject: realObject,
            messageId: saveMessageId
        });

        try {
            await this.messageBus.waitFor(
                'real-object-saved', 10000,
                (data) => data.messageId === saveMessageId
            );
        } catch (e) {
            logger.debug('[NetBtronViewer] 保存失敗（localStorageにフォールバック）:', e.message);
        }

        this.cloudConfig = realObject.metadata.cloudConfig || null;
    }

    // =========================================================
    // 自動接続・セッション復元
    // =========================================================

    /**
     * 起動時の自動接続処理
     * - URL/APIキーが保存済みなら自動接続→セッション復元→キャッシュ鮮度判定
     * - セッション復元成功 + キャッシュ鮮度OK → ビューモード直行
     * - セッション復元失敗（要パスワード）→ 管理モード（ログインパネル）
     * - 設定なし + ローカルキャッシュあり → ビューモード直行（ローカルデータ表示）
     */
    async tryAutoConnect() {
        // 管理セグメントJSONからcloudConfigを復元
        if (this.fileData && this.fileData.realObject && this.fileData.realObject.cloudConfig) {
            this.cloudConfig = this.fileData.realObject.cloudConfig;
            if (this.cloudConfig.tenantId) {
                this.currentTenantId = this.cloudConfig.tenantId;
                this.saveLastTenantId(this.cloudConfig.tenantId);
            }
            if (this.cloudConfig.cloudRealObjectId) {
                this.cloudRealObjectId = this.cloudConfig.cloudRealObjectId;
            }
            // cloudConfigにURL/Keyがあればフォーム自動補完+localStorage同期
            if (this.cloudConfig.supabaseUrl && this.cloudConfig.anonKey) {
                const saved = this.loadSavedConfigData();
                if (!saved || !saved.url || !saved.anonKey) {
                    // localStorageが空ならcloudConfigから復元
                    this.saveConfig(this.cloudConfig.supabaseUrl, this.cloudConfig.anonKey, (saved && saved.email) || '');
                }
                document.getElementById('supabase-url').value = this.cloudConfig.supabaseUrl;
                document.getElementById('supabase-key').value = this.cloudConfig.anonKey;
            }
        }

        const saved = this.loadSavedConfigData();
        if (!saved || !saved.url || !saved.anonKey) {
            // クラウド設定なし
            if (this.localXmlData) {
                // ローカルキャッシュがあるならビューモードで表示
                await this.enterViewModeLocal();
                this._applyWindowConfig();
                return;
            }
            this.showPanel('config');
            return;
        }

        // UIフィールドに設定を復元
        document.getElementById('supabase-url').value = saved.url;
        document.getElementById('supabase-key').value = saved.anonKey;
        document.getElementById('login-email').value = saved.email || '';

        this.setStatus('接続中...');

        // URLからテナント名を抽出
        const { supabaseUrl, tenantName } = this.parseSupabaseUrl(saved.url);
        this.specifiedTenantName = tenantName;

        try {
            const result = await window.cloudAPI.initialize({
                url: supabaseUrl,
                anonKey: saved.anonKey
            });

            if (!result.success) {
                this.setStatus('接続に失敗しました: ' + result.error);
                this.showPanel('config');
                return;
            }

            // セッション復元試行
            const session = await window.cloudAPI.getSession();
            if (session.success && session.user) {
                // セッション復元成功 → キャッシュ鮮度判定付きで表示
                this.currentUser = session.user;
                this.saveConfig(saved.url, saved.anonKey, session.user.email);
                await this.showMainPanelWithCacheCheck();
            } else {
                // セッション復元失敗（要パスワード）→ ログインパネル
                this.setStatus('ログインしてください');
                this.showPanel('login');
            }
        } catch (error) {
            this.setStatus('接続エラー: ' + error.message);
            this.showPanel('config');
        }
    }

    // =========================================================
    // キャッシュ鮮度判定
    // =========================================================

    /**
     * 前回閲覧情報をlocalStorageに保存
     */
    saveLastViewInfo() {
        if (!this.cloudRealObjectId || !this.currentTenantId || !this.realId) return;
        try {
            const info = {
                cloudRealObjectId: this.cloudRealObjectId,
                cloudTenantId: this.currentTenantId,
                cloudUpdatedAt: this.cloudMetadata ? this.cloudMetadata.updated_at : null,
                cloudVersion: this.cloudVersion || null
            };
            localStorage.setItem(
                'net-btron-last-view-' + this.realId,
                JSON.stringify(info)
            );
        } catch (e) {
            logger.debug('[NetBtronViewer] 閲覧情報保存失敗:', e.message);
        }
    }

    /**
     * 前回閲覧情報をlocalStorageから読み込み
     * @returns {{ cloudRealObjectId: string, cloudTenantId: string, cloudUpdatedAt: string, cloudVersion: number }|null}
     */
    loadLastViewInfo() {
        if (!this.realId) return null;
        try {
            const key = 'net-btron-last-view-' + this.realId;
            const saved = localStorage.getItem(key);
            return saved ? JSON.parse(saved) : null;
        } catch (e) {
            logger.debug('[NetBtronViewer] 閲覧情報読み込みエラー:', e.message);
            return null;
        }
    }

    /**
     * セッション復元成功後のキャッシュ鮮度判定付きメインパネル表示
     * - lastViewInfo + localXmlData あり → クラウドメタデータと比較してキャッシュ使用可否判定
     * - キャッシュ最新 → enterViewModeLocal()（ビューモード直行）
     * - キャッシュ古い → showMainPanel()（テナント一覧）
     */
    async showMainPanelWithCacheCheck() {
        const lastView = this.loadLastViewInfo();

        if (!lastView || !lastView.cloudRealObjectId || !this.localXmlData) {
            // 前回閲覧情報なし or キャッシュなし → 通常のテナント一覧表示
            await this.showMainPanel();
            return;
        }

        // 前回閲覧のテナントを自動選択
        this.currentTenantId = lastView.cloudTenantId;

        // クラウドから対象実身のメタデータを取得して鮮度を確認
        try {
            const metaResult = await window.cloudAPI.getRealObjectsMetadata(
                lastView.cloudTenantId,
                [lastView.cloudRealObjectId]
            );

            if (metaResult.success && metaResult.realObjects && metaResult.realObjects.length > 0) {
                const cloudObj = metaResult.realObjects[0];
                const cloudUpdatedAt = cloudObj.updated_at;

                if (cloudUpdatedAt === lastView.cloudUpdatedAt) {
                    // キャッシュが最新 → ローカルキャッシュでビューモード直行
                    this.cloudRealObjectId = lastView.cloudRealObjectId;
                    this.cloudVersion = cloudObj.version || lastView.cloudVersion;
                    this.cloudMetadata = cloudObj;
                    await this.enterViewModeLocal();
                    this._applyWindowConfig();
                    this.setStatus('ビューモード: ' + (cloudObj.name || lastView.cloudRealObjectId));
                    return;
                }
            }
        } catch (e) {
            logger.debug('[NetBtronViewer] メタデータ取得失敗（テナント一覧へフォールバック）:', e.message);
        }

        // キャッシュが古い or 取得失敗 → テナント一覧表示
        await this.showMainPanel();
    }

    /**
     * 保存されたwindowConfigを適用（ビューモード直行時に使用）
     */
    _applyWindowConfig() {
        if (!this._savedWindowConfig) return;
        if (this._savedWindowConfig.backgroundColor) {
            const canvas = document.querySelector('.virtual-canvas');
            if (canvas) {
                canvas.style.background = this._savedWindowConfig.backgroundColor;
            }
        }
        if (this._savedWindowConfig.scrollPos) {
            setTimeout(() => {
                this.setScrollPosition(this._savedWindowConfig.scrollPos);
            }, 100);
        }
    }

    // =========================================================
    // 管理モード: 接続・認証ハンドラ
    // =========================================================

    /**
     * URLからSupabase URLとテナント名を分離する
     * 例: "https://xxx.supabase.co/my-tenant" → { supabaseUrl: "https://xxx.supabase.co", tenantName: "my-tenant" }
     * 例: "https://xxx.supabase.co" → { supabaseUrl: "https://xxx.supabase.co", tenantName: null }
     */
    parseSupabaseUrl(inputUrl) {
        try {
            const parsed = new URL(inputUrl);
            const pathname = parsed.pathname.replace(/^\/+|\/+$/g, '');  // 前後のスラッシュ除去
            if (pathname) {
                // パスにテナント名が含まれている
                parsed.pathname = '/';
                return { supabaseUrl: parsed.origin, tenantName: pathname };
            }
            return { supabaseUrl: parsed.origin, tenantName: null };
        } catch (e) {
            logger.debug('[NetBtronViewer] URL解析エラー:', e.message);
            return { supabaseUrl: inputUrl, tenantName: null };
        }
    }

    async handleConnect() {
        const rawUrl = document.getElementById('supabase-url').value.trim();
        const anonKey = document.getElementById('supabase-key').value.trim();

        if (!rawUrl || !anonKey) {
            this.setStatus('URLとAnon Keyを入力してください');
            return;
        }

        if (!window.cloudAPI) {
            this.setStatus('クラウドAPIが利用できません');
            return;
        }

        // URLからテナント名を抽出
        const { supabaseUrl, tenantName } = this.parseSupabaseUrl(rawUrl);
        this.specifiedTenantName = tenantName;

        this.setStatus('接続中...');
        logger.info('handleConnect: 接続開始, url:', supabaseUrl, 'tenantName:', tenantName);
        try {
            const result = await window.cloudAPI.initialize({ url: supabaseUrl, anonKey });
            logger.info('handleConnect: initialize結果:', JSON.stringify(result));

            if (result.success) {
                const currentEmail = document.getElementById('login-email').value.trim();
                this.saveConfig(rawUrl, anonKey, currentEmail);
                const session = await window.cloudAPI.getSession();
                logger.info('handleConnect: getSession結果:', JSON.stringify({ success: session.success, hasUser: !!session.user }));
                if (session.success && session.user) {
                    this.currentUser = session.user;
                    // 明示的な接続操作 → 常に管理モード（テナント一覧）を表示
                    await this.showMainPanel();
                    return;
                }
                // Internalテナント名指定があるか確認して「参照」ボタン表示を制御
                this.internalTenantForBrowse = null;
                const browseBtn = document.getElementById('btn-browse');
                const internalInfo = document.getElementById('internal-tenant-info');
                browseBtn.style.display = 'none';
                internalInfo.style.display = 'none';

                if (this.specifiedTenantName) {
                    try {
                        const tenantResult = await window.cloudAPI.getTenantByName(this.specifiedTenantName);
                        if (tenantResult.success && tenantResult.tenant && tenantResult.tenant.visibility === 'internal') {
                            this.internalTenantForBrowse = tenantResult.tenant;
                            browseBtn.style.display = '';
                            internalInfo.style.display = '';
                            internalInfo.textContent = 'テナント「' + tenantResult.tenant.name + '」は内部公開されています。ログインなしで参照できます。';
                        }
                    } catch (e) {
                        logger.warn('handleConnect: テナント名検索エラー:', e.message);
                    }
                }

                this.setStatus('接続成功。ログインしてください');
                this.showPanel('login');
            } else {
                this.setStatus('接続失敗: ' + result.error);
            }
        } catch (error) {
            logger.error('handleConnect: 例外:', error.message);
            this.setStatus('接続エラー: ' + error.message);
        }
    }

    async handleLogin() {
        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;

        if (!email || !password) {
            this.setStatus('メールアドレスとパスワードを入力してください');
            return;
        }

        this.setStatus('ログイン中...');
        logger.info('handleLogin: ログイン開始, email:', email);
        const result = await window.cloudAPI.signIn(email, password);
        logger.info('handleLogin: signIn結果:', JSON.stringify({ success: result.success, hasUser: !!result.user, error: result.error }));

        if (result.success) {
            this.currentUser = result.user;
            // ログイン成功時にメールアドレスも保存
            const savedConfig = localStorage.getItem('net-btron-config');
            if (savedConfig) {
                try {
                    const config = JSON.parse(savedConfig);
                    this.saveConfig(config.url || '', config.anonKey || '', email);
                } catch (e) {
                    logger.debug('[NetBtronViewer] ログイン時設定保存エラー:', e.message);
                }
            }
            // 明示的なログイン操作 → 常に管理モード（テナント一覧）を表示
            await this.showMainPanel();
        } else {
            this.setStatus('ログイン失敗: ' + result.error);
        }
    }

    async handleGoogleLogin() {
        this.setStatus('Googleアカウントで認証中...');
        logger.info('handleGoogleLogin: Google OAuth認証開始');
        const result = await window.cloudAPI.signInWithOAuth('google');
        logger.info('handleGoogleLogin: OAuth結果:', JSON.stringify({ success: result.success, cancelled: result.cancelled, hasUser: !!result.user, error: result.error }));

        if (result.success) {
            this.currentUser = result.user;
            // ログイン成功時にメールアドレスも保存
            const savedConfig = localStorage.getItem('net-btron-config');
            if (savedConfig) {
                try {
                    const config = JSON.parse(savedConfig);
                    this.saveConfig(config.url || '', config.anonKey || '', result.user.email);
                } catch (e) {
                    logger.debug('[NetBtronViewer] Google認証時設定保存エラー:', e.message);
                }
            }
            await this.showMainPanel();
        } else if (result.cancelled) {
            this.setStatus('ログインがキャンセルされました');
        } else {
            this.setStatus('Google認証失敗: ' + (result.error || '不明なエラー'));
        }
    }

    async handleLogout() {
        logger.info('[NetBtronViewer] handleLogout: ログアウト開始');
        this.setStatus('ログアウト中...');
        const result = await window.cloudAPI.signOut();
        logger.info('[NetBtronViewer] handleLogout: signOut結果:', JSON.stringify({ success: result.success, error: result.error }));

        if (result.success) {
            this.currentUser = null;
            this.currentTenantId = null;
            this.realObjects = [];
            this.selectedRealObjectId = null;
            this.isAnonymousBrowsing = false;
            this.internalTenantForBrowse = null;
            // M-5: ログアウト時にlocalStorageのセッション情報をクリア
            try {
                const keysToRemove = [];
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (key && key.startsWith('net-btron-')) {
                        keysToRemove.push(key);
                    }
                }
                keysToRemove.forEach(key => localStorage.removeItem(key));
            } catch (e) {
                logger.debug('[NetBtronViewer] localStorageアクセスエラー:', e.message);
            }
            document.getElementById('tenant-select').disabled = false;
            this.resetAnonymousUI();
            this.setStatus('ログアウトしました');
            this.showPanel('login');
        } else {
            this.setStatus('ログアウト失敗: ' + result.error);
        }
    }

    /**
     * 匿名参照モード: ログインなしでInternalテナントを閲覧
     */
    async handleAnonymousBrowse() {
        if (!this.internalTenantForBrowse) {
            this.setStatus('参照可能なテナントがありません');
            return;
        }

        logger.info('[NetBtronViewer] handleAnonymousBrowse: 匿名参照モード開始, tenant:', this.internalTenantForBrowse.name);
        this.isAnonymousBrowsing = true;
        this.currentUser = null;
        this.currentTenantId = this.internalTenantForBrowse.id;

        this.showPanel('main');

        // ユーザー情報表示
        document.getElementById('user-info').textContent = '匿名参照モード';

        // テナント固定表示
        const select = document.getElementById('tenant-select');
        select.innerHTML = '';
        const option = document.createElement('option');
        option.value = this.internalTenantForBrowse.id;
        option.textContent = this.internalTenantForBrowse.name;
        select.appendChild(option);
        select.disabled = true;

        // 匿名モード用のUI制限を適用
        this.updateAnonymousUI();

        // 実身一覧を取得
        await this.loadRealObjectList();
        this.setStatus('匿名参照モード（読み取り専用）');
    }

    /**
     * 匿名参照モード→ログイン遷移
     */
    handleLoginToEdit() {
        logger.info('[NetBtronViewer] handleLoginToEdit: ログイン画面に遷移');
        this.isAnonymousBrowsing = false;
        this.currentUser = null;
        this.currentTenantId = null;
        this.realObjects = [];
        this.selectedRealObjectId = null;

        // テナントセレクトを再有効化
        document.getElementById('tenant-select').disabled = false;

        // 匿名モードUIを解除
        this.resetAnonymousUI();

        this.showPanel('login');
        this.setStatus('ログインしてください');
    }

    /**
     * 匿名参照モード用のUI制限を適用
     */
    updateAnonymousUI() {
        // 書き込み系ボタンを非表示
        document.getElementById('btn-upload').style.display = 'none';
        document.getElementById('btn-share').style.display = 'none';
        document.getElementById('btn-delete').style.display = 'none';
        document.getElementById('btn-quota').style.display = 'none';
        document.getElementById('btn-history').style.display = 'none';
        document.getElementById('btn-create-tenant').style.display = 'none';
        document.getElementById('btn-tenant-settings').style.display = 'none';
        document.getElementById('btn-manage-members').style.display = 'none';

        // 「ログインして編集」ボタンを表示
        document.getElementById('btn-login-to-edit').style.display = '';

        // ログアウトボタンを非表示
        document.getElementById('btn-logout').style.display = 'none';
    }

    /**
     * 匿名参照モードUI制限を解除
     */
    resetAnonymousUI() {
        document.getElementById('btn-upload').style.display = '';
        document.getElementById('btn-share').style.display = '';
        document.getElementById('btn-delete').style.display = '';
        document.getElementById('btn-quota').style.display = '';
        document.getElementById('btn-history').style.display = '';
        document.getElementById('btn-create-tenant').style.display = '';
        document.getElementById('btn-tenant-settings').style.display = '';
        document.getElementById('btn-manage-members').style.display = '';
        document.getElementById('btn-login-to-edit').style.display = 'none';
        document.getElementById('btn-logout').style.display = '';
    }

    // =========================================================
    // 管理モード: メインパネル表示
    // =========================================================

    async showMainPanel() {
        this.showPanel('main');
        document.getElementById('user-info').textContent = this.currentUser ? this.currentUser.email : '匿名参照モード';

        this.setStatus('テナント一覧を取得中...');

        // getMyProfile と getTenants を並列実行（互いに独立したAPI呼び出し）
        logger.info('showMainPanel: API並列取得開始');
        const [profileResult, result] = await Promise.all([
            this.currentUser ? window.cloudAPI.getMyProfile() : Promise.resolve(null),
            window.cloudAPI.getTenants()
        ]);

        // システムロール取得結果を処理
        if (this.currentUser && profileResult) {
            logger.info('showMainPanel: getMyProfile結果:', JSON.stringify({ success: profileResult.success, systemRole: profileResult.profile ? profileResult.profile.system_role : null, error: profileResult.error }));
            if (profileResult.success && profileResult.profile) {
                this.systemRole = profileResult.profile.system_role || 'user';
            } else {
                this.systemRole = 'user';
            }
        }
        logger.info('showMainPanel: systemRole:', this.systemRole);
        this.updateSystemRoleUI();

        // テナント一覧取得結果を処理
        logger.info('showMainPanel: getTenants結果:', JSON.stringify({ success: result.success, count: result.tenants ? result.tenants.length : 0, error: result.error }));
        if (result.success) {
            this.tenants = result.tenants || [];
            this.renderTenantSelect(result.tenants);
            if (result.tenants.length > 0) {
                // テナント名が指定されている場合はそのテナントを自動選択
                let selectedTenant = null;
                if (this.specifiedTenantName) {
                    selectedTenant = result.tenants.find(
                        t => t.name === this.specifiedTenantName
                    );
                    if (!selectedTenant) {
                        logger.warn('showMainPanel: テナント「' + this.specifiedTenantName + '」が見つかりません');
                        this.setStatus('テナント「' + this.specifiedTenantName + '」が見つかりません');
                        return;
                    }
                } else {
                    // 前回選択したテナントを復元
                    const lastTenantId = this.getLastTenantId();
                    if (lastTenantId) {
                        selectedTenant = result.tenants.find(t => t.id === lastTenantId);
                    }
                    if (!selectedTenant) {
                        selectedTenant = result.tenants[0];
                    }
                }
                logger.info('showMainPanel: テナント選択:', selectedTenant.name, selectedTenant.id);
                this.currentTenantId = selectedTenant.id;
                this.saveLastTenantId(this.currentTenantId);
                document.getElementById('tenant-select').value = this.currentTenantId;
                this.updateButtonStates();
                this.updateOwnerUI();
                await this.loadRealObjectList();
            } else {
                this.realObjects = [];
                this.renderRealObjectList();
                this.setStatus('テナントがありません。「＋」で作成してください');
            }
        } else {
            this.setStatus('テナント取得失敗: ' + result.error);
        }
        this.updateButtonStates();
    }

    renderTenantSelect(tenants) {
        const select = document.getElementById('tenant-select');
        select.innerHTML = '';
        tenants.forEach(t => {
            const option = document.createElement('option');
            option.value = t.id;
            const visIcon = t.visibility === 'internal' ? '\u{1F310} ' : '\u{1F512} ';
            option.textContent = visIcon + t.name;
            select.appendChild(option);
        });
    }

    // =========================================================
    // 管理モード: テナント操作
    // =========================================================

    /**
     * テナント設定ダイアログ（公開範囲の変更）
     */
    async handleTenantSettings() {
        if (!this.currentTenantId) {
            this.setStatus('テナントを選択してください');
            return;
        }

        // 現在のテナント情報を取得
        const tenantsResult = await window.cloudAPI.getTenants();
        if (!tenantsResult.success) {
            this.setStatus('テナント情報取得失敗: ' + tenantsResult.error);
            return;
        }
        const currentTenant = tenantsResult.tenants.find(t => t.id === this.currentTenantId);
        if (!currentTenant) {
            this.setStatus('テナントが見つかりません');
            return;
        }

        // オーナーでない場合は設定変更不可
        if (!this.currentUser || currentTenant.owner_id !== this.currentUser.id) {
            this.setStatus('テナント設定はオーナーのみ変更できます');
            return;
        }

        const currentVisibility = currentTenant.visibility || 'private';
        const dialogHtml = buildTenantSettingsHtml({
            tenantName: currentTenant.name,
            visibility: currentVisibility,
            escapeHtml: this.escapeHtml.bind(this)
        });

        const dialogResult = await this.showCustomDialog({
            title: 'テナント設定',
            dialogHtml: dialogHtml,
            buttons: [
                { label: '削除', value: 'delete' },
                { label: '取消', value: 'cancel' },
                { label: '保存', value: 'save' }
            ],
            defaultButton: 2,
            width: 320
        });

        if (!dialogResult || dialogResult.button === 'cancel') return;

        if (dialogResult.button === 'delete') {
            await this.handleDeleteTenant(currentTenant);
            return;
        }

        const newVisibility = dialogResult.formData?.['tenant-visibility'] || currentTenant.visibility;

        if (newVisibility === currentTenant.visibility) {
            this.setStatus('変更はありません');
            return;
        }

        // 確認ダイアログ（Internal→Privateは即適用、Private→Internalは確認）
        if (newVisibility === 'internal') {
            const confirm = await this.showMessageDialog(
                '内部公開に変更すると、全ユーザーがこのテナントの実身を閲覧できるようになります。\n変更しますか？',
                [
                    { label: 'はい', value: 'yes' },
                    { label: 'いいえ', value: 'no' }
                ],
                1
            );
            if (confirm !== 'yes') return;
        }

        this.setStatus('テナント設定を更新中...');
        const result = await window.cloudAPI.updateTenantVisibility(this.currentTenantId, newVisibility);

        if (result.success) {
            this.setStatus('テナント設定を更新しました');
            await this.showMainPanel();
        } else {
            this.setStatus('テナント設定更新失敗: ' + result.error);
        }
    }

    handleOpenTenant() {
        if (!this.currentTenantId) {
            this.setStatus('テナントを選択してください');
            return;
        }
        if (!this.selectedRealObjectId) {
            // 実身未選択の場合、一覧の先頭を自動選択
            if (this.realObjects.length > 0) {
                this.selectedRealObjectId = this.realObjects[0].id;
            } else {
                this.setStatus('テナントに実身がありません');
                return;
            }
        }
        this.enterViewMode(this.selectedRealObjectId);
    }

    /**
     * テナント削除（確認ダイアログ + Storage/DB全削除）
     * @param {Object} tenant - 削除対象テナントオブジェクト {id, name}
     */
    async handleDeleteTenant(tenant) {
        // 1. 第一確認ダイアログ
        const confirm1 = await this.showMessageDialog(
            'テナント「' + tenant.name + '」を削除しますか？\n\n' +
            'テナント内の全ての実身・バージョン履歴・\nストレージファイルが完全に削除されます。\n' +
            'この操作は元に戻せません。',
            [
                { label: '削除する', value: 'delete' },
                { label: '取消', value: 'cancel' }
            ],
            1
        );
        if (confirm1 !== 'delete') return;

        // 2. 第二確認（テナント名入力）
        const inputName = await this.showInputDialog(
            '削除を確認するには、テナント名「' + tenant.name + '」を入力してください:',
            ''
        );
        if (!inputName || inputName !== tenant.name) {
            this.setStatus('テナント名が一致しません。削除を中止しました。');
            return;
        }

        // 3. 削除実行
        this.setStatus('テナント「' + tenant.name + '」を削除中...');
        try {
            logger.info('[NetBtronViewer] handleDeleteTenant: 削除開始, tenantId:', tenant.id);
            const result = await window.cloudAPI.deleteTenant(tenant.id);
            logger.info('[NetBtronViewer] handleDeleteTenant: 削除結果:', JSON.stringify({ success: result.success, deleted: result.deleted, error: result.error }));

            if (result.success) {
                this.currentTenantId = null;
                localStorage.removeItem('net-btron-last-tenant');
                // 削除されたテナントがcloudConfigの紐付きテナントならクリア
                if (this.cloudConfig && this.cloudConfig.tenantId === tenant.id) {
                    await this.saveCloudConfigToJson(null, null);
                }
                this.setStatus('テナント「' + tenant.name + '」を削除しました（実身 ' + (result.deleted || 0) + ' 件）');
                await this.showMainPanel();
            } else {
                this.setStatus('テナント削除失敗: ' + result.error);
            }
        } catch (error) {
            logger.error('[NetBtronViewer] handleDeleteTenant: エラー:', error.message || error);
            this.setStatus('テナント削除エラー: ' + (error.message || error));
        }
    }

    async handleCreateTenant() {
        // テナント作成ダイアログ（名前＋公開範囲選択）
        const dialogResult = await this.showCustomDialog({
            title: 'テナント作成',
            dialogHtml: buildCreateTenantHtml(),
            buttons: [
                { label: '取消', value: 'cancel' },
                { label: '作成', value: 'create' }
            ],
            defaultButton: 1,
            width: 320
        });

        if (!dialogResult || dialogResult.button !== 'create') return;

        // ダイアログ内のinput値を取得
        const name = dialogResult.formData?.['create-tenant-name'] || '';
        const visibility = dialogResult.formData?.['tenant-visibility'] || 'private';

        if (!name.trim()) {
            this.setStatus('テナント名を入力してください');
            return;
        }

        logger.info('[NetBtronViewer] handleCreateTenant: テナント作成開始, name:', name, ', visibility:', visibility);
        this.setStatus('テナント作成中...');
        const result = await window.cloudAPI.createTenant(name.trim(), visibility);
        logger.info('[NetBtronViewer] handleCreateTenant: createTenant結果:', JSON.stringify({ success: result.success, tenantId: result.tenant?.id, error: result.error }));

        if (!result.success) {
            this.setStatus('テナント作成失敗: ' + result.error);
            return;
        }

        const tenantId = result.tenant.id;

        // 管理セグメントJSONにテナント接続情報が未設定の場合のみ自動アップロード
        if (!this.cloudConfig || !this.cloudConfig.tenantId) {
            this.setStatus('テナント「' + name + '」を作成しました。実身をアップロード中...');
            try {
                const uploaded = await this.uploadInitialRealObject(tenantId);
                if (uploaded) {
                    await this.saveCloudConfigToJson(tenantId, this.cloudRealObjectId);
                    this.setStatus('テナント「' + name + '」を作成し、実身をアップロードしました');
                } else {
                    this.setStatus('テナント「' + name + '」を作成しました（実身アップロード失敗）');
                }
            } catch (error) {
                this.setStatus('テナント作成成功、実身アップロード失敗: ' + (error.message || error));
            }
        } else {
            this.setStatus('テナント「' + name + '」を作成しました');
        }

        await this.showMainPanel();
    }

    /**
     * テナント作成時にローカルの実身データをクラウドにアップロードする
     * @param {string} tenantId - アップロード先テナントID
     * @returns {Promise<boolean>} アップロード成功ならtrue
     */
    async uploadInitialRealObject(tenantId) {
        // ローカル実身データを親ウィンドウから取得
        const localRealId = this.realId;
        if (!localRealId) return false;

        const messageId = this.generateMessageId('upload-initial');
        this.messageBus.send('load-real-object', { realId: localRealId, messageId });

        const loadResult = await this.messageBus.waitFor(
            'real-object-loaded', 10000,
            (data) => data.messageId === messageId
        );

        if (!loadResult || !loadResult.realObject) return false;

        // 新しいUUIDを生成（テナント固有のクラウド実身ID）
        const cloudId = window.UuidV7Generator.generate();
        const realObject = loadResult.realObject;
        const metadata = { ...(realObject.metadata || {}) };
        metadata.id = cloudId;
        metadata.realId = cloudId;
        metadata.name = metadata.name || 'NET仮身一覧';

        // ファイルデータを構築
        const files = {
            json: Array.from(new TextEncoder().encode(JSON.stringify(metadata, null, 2))),
            xtad: realObject.records && realObject.records[0]
                ? Array.from(new TextEncoder().encode(realObject.records[0].xtad))
                : (this.localXmlData
                    ? Array.from(new TextEncoder().encode(this.localXmlData))
                    : null),
            ico: null
        };

        // アイコンファイルの読み込み（Q2: アップロードすべき）
        try {
            const icoFile = await this.loadDataFileFromParent(localRealId + '.ico');
            if (icoFile) {
                const icoBuffer = await icoFile.arrayBuffer();
                files.ico = Array.from(new Uint8Array(icoBuffer));
            }
        } catch (e) {
            logger.debug('[NetBtronViewer] アイコン読み込み失敗:', e.message);
        }

        if (!files.xtad) return false;

        const uploadResult = await window.cloudAPI.uploadRealObject(
            tenantId, { metadata }, files
        );

        if (uploadResult.success) {
            this.cloudRealObjectId = cloudId;
            // 子実身もアップロード（多階層対応）
            const xtadStr = files.xtad ? new TextDecoder().decode(new Uint8Array(files.xtad)) : null;
            if (xtadStr) {
                const childLinks = this.extractLinkIdsFromXtad(xtadStr);
                if (childLinks.length > 0) {
                    this.virtualObjects = childLinks.map(l => ({ link_id: l.realId + '_0.xtad', link_name: l.name }));
                    await this.uploadChildRealObjects(tenantId);
                    this.virtualObjects = [];
                }
            }
            return true;
        }
        return false;
    }

    async handleTenantChange() {
        this.currentTenantId = document.getElementById('tenant-select').value;
        this.selectedRealObjectId = null;
        this.updateButtonStates();
        this.updateOwnerUI();
        if (this.currentTenantId) {
            this.saveLastTenantId(this.currentTenantId);
            // cloudConfigのテナントIDを更新（アップロードはしない）
            const cloudRealObjectId = (this.cloudConfig && this.cloudConfig.cloudRealObjectId) || null;
            await this.saveCloudConfigToJson(this.currentTenantId, cloudRealObjectId);
            await this.loadRealObjectList();
        }
    }

    // =========================================================
    // 管理モード: 実身一覧
    // =========================================================

    async loadRealObjectList() {
        if (!this.currentTenantId) return;

        this.setStatus('実身一覧を取得中...');
        logger.info('loadRealObjectList: テナント:', this.currentTenantId);
        const result = await window.cloudAPI.listRealObjects(this.currentTenantId);
        logger.info('loadRealObjectList: 結果:', JSON.stringify({ success: result.success, count: result.realObjects ? result.realObjects.length : 0, error: result.error }));

        if (result.success) {
            this.realObjects = result.realObjects;
            this.renderRealObjectList();
            this.setStatus(this.realObjects.length + ' 件の実身');
        } else {
            this.realObjects = [];
            this.renderRealObjectList();
            this.setStatus('実身一覧取得失敗: ' + result.error);
        }
        this.updateButtonStates();
    }

    renderRealObjectList() {
        const container = document.getElementById('real-object-list');
        container.innerHTML = '';

        if (this.realObjects.length === 0) {
            const msg = document.createElement('div');
            msg.className = 'empty-message';
            msg.textContent = '実身がありません';
            container.appendChild(msg);
            return;
        }

        this.realObjects.forEach(obj => {
            const item = document.createElement('div');
            item.className = 'real-object-item' + (obj.id === this.selectedRealObjectId ? ' selected' : '');
            item.dataset.id = obj.id;

            const titleArea = document.createElement('div');
            titleArea.className = 'real-object-title-area';

            const iconImg = document.createElement('img');
            iconImg.className = 'real-object-icon';
            iconImg.src = DEFAULT_REAL_OBJECT_ICON;
            titleArea.appendChild(iconImg);

            const nameSpan = document.createElement('span');
            nameSpan.className = 'real-object-name';
            nameSpan.textContent = obj.name;
            titleArea.appendChild(nameSpan);

            if (obj.version !== undefined) {
                const metaSpan = document.createElement('span');
                metaSpan.className = 'real-object-meta';
                metaSpan.textContent = 'v' + obj.version;
                titleArea.appendChild(metaSpan);
            }

            const dateSpan = document.createElement('span');
            dateSpan.className = 'real-object-date';
            dateSpan.textContent = this.formatDate(obj.updated_at);
            titleArea.appendChild(dateSpan);

            item.appendChild(titleArea);

            if (obj.id === this.selectedRealObjectId) {
                item.style.boxShadow = SELECTION_BOX_SHADOW;
            }

            item.addEventListener('click', () => this.selectRealObject(obj.id));
            // ダブルクリックでビューモードに入る
            item.addEventListener('dblclick', () => this.enterViewMode(obj.id));
            container.appendChild(item);
        });
    }

    selectRealObject(realObjectId) {
        this.selectedRealObjectId = realObjectId;

        const items = document.querySelectorAll('#real-object-list .real-object-item');
        items.forEach(item => {
            const isSelected = item.dataset.id === realObjectId;
            item.classList.toggle('selected', isSelected);
            item.style.boxShadow = isSelected ? SELECTION_BOX_SHADOW : '';
        });

        this.updateButtonStates();
    }

    updateButtonStates() {
        const hasSelection = this.selectedRealObjectId !== null;
        const hasTenant = this.currentTenantId !== null;
        document.getElementById('btn-open').disabled = !hasTenant;
        document.getElementById('btn-download').disabled = !hasSelection;

        if (this.isAnonymousBrowsing) {
            // 匿名参照モード: 書き込み系は非表示（updateAnonymousUIで制御済み）
            return;
        }

        document.getElementById('btn-upload').disabled = !hasTenant;
        document.getElementById('btn-share').disabled = !hasSelection;
        document.getElementById('btn-delete').disabled = !hasSelection;
        document.getElementById('btn-quota').disabled = !hasTenant;
        document.getElementById('btn-history').disabled = !hasSelection;
    }

    /**
     * システムロールに基づくUI制御
     * テナント作成ボタン: system_admin/tenant_creatorのみ
     * ユーザー管理ボタン: system_adminのみ
     */
    updateSystemRoleUI() {
        const canCreateTenant = this.systemRole === 'system_admin' || this.systemRole === 'tenant_creator';
        const isSystemAdmin = this.systemRole === 'system_admin';

        document.getElementById('btn-create-tenant').style.display = canCreateTenant ? '' : 'none';
        document.getElementById('btn-user-management').style.display = isSystemAdmin ? '' : 'none';
    }

    /**
     * テナントオーナーに基づくUI制御
     * 設定/メンバーボタン: テナントオーナーのみ表示
     */
    updateOwnerUI() {
        const currentTenant = this.tenants.find(t => t.id === this.currentTenantId);
        const isOwner = currentTenant && this.currentUser && currentTenant.owner_id === this.currentUser.id;

        document.getElementById('btn-tenant-settings').style.display = isOwner ? '' : 'none';
        document.getElementById('btn-manage-members').style.display = isOwner ? '' : 'none';
    }

    // =========================================================
    // 管理モード: アップロード・ダウンロード・削除
    // =========================================================

    async handleUpload() {
        if (!this.currentTenantId) {
            logger.warn('[NetBtronViewer] handleUpload: テナント未選択');
            return;
        }

        this.setStatus('アップロードする実身のJSONファイルを選択してください...');
        const realId = await this.showInputDialog('アップロードする実身IDを入力してください', '');
        if (!realId) return;

        this.setStatus('実身データを読み込み中...');
        const messageId = this.generateMessageId('upload');
        this.messageBus.send('load-real-object', { realId, messageId });

        try {
            const loadResult = await this.messageBus.waitFor('real-object-loaded', 10000,
                (data) => data.messageId === messageId
            );

            if (!loadResult || !loadResult.realObject) {
                this.setStatus('実身データの読み込みに失敗しました');
                return;
            }

            const realObject = loadResult.realObject;
            const files = {
                json: Array.from(new TextEncoder().encode(JSON.stringify(realObject.metadata, null, 2))),
                xtad: realObject.records && realObject.records[0]
                    ? Array.from(new TextEncoder().encode(realObject.records[0].xtad))
                    : null,
                ico: null
            };

            logger.info('[NetBtronViewer] handleUpload: uploadRealObject呼び出し, tenantId:', this.currentTenantId, 'realId:', realId);
            this.setStatus('アップロード中...');
            const uploadResult = await window.cloudAPI.uploadRealObject(
                this.currentTenantId, realObject, files
            );
            logger.info('[NetBtronViewer] handleUpload: uploadRealObject結果:', JSON.stringify({ success: uploadResult.success, error: uploadResult.error }));

            if (uploadResult.success) {
                // 子実身もアップロード（多階層対応）
                this.cloudRealObjectId = realId;
                const xtadStr = realObject.records && realObject.records[0] ? realObject.records[0].xtad : null;
                if (xtadStr) {
                    // 仮身リストを一時的に構築して子実身をアップロード
                    const childLinks = this.extractLinkIdsFromXtad(xtadStr);
                    if (childLinks.length > 0) {
                        this.virtualObjects = childLinks.map(l => ({ link_id: l.realId + '_0.xtad', link_name: l.name }));
                        const childResult = await this.uploadChildRealObjects(this.currentTenantId);
                        this.virtualObjects = [];
                        if (childResult.uploaded > 0 || childResult.conflicted > 0 || childResult.skipped > 0) {
                            let childStatus = '';
                            if (childResult.uploaded > 0) {
                                childStatus += '子実身' + childResult.uploaded + '件';
                            }
                            if (childResult.skipped > 0) {
                                childStatus += (childStatus ? '、' : '') + 'スキップ' + childResult.skipped + '件';
                            }
                            if (childResult.conflicted > 0) {
                                childStatus += (childStatus ? '、' : '') + '競合スキップ' + childResult.conflicted + '件';
                            }
                            this.setStatus('アップロード完了（' + childStatus + '）');
                        } else {
                            this.setStatus('アップロード完了');
                        }
                    } else {
                        this.setStatus('アップロード完了');
                    }
                } else {
                    this.setStatus('アップロード完了');
                }
                this.cloudRealObjectId = null;
                await this.loadRealObjectList();
            } else {
                this.setStatus('アップロード失敗: ' + uploadResult.error);
            }
        } catch (error) {
            this.setStatus('アップロード失敗: ' + error.message);
        }
    }

    async handleDownload() {
        if (!this.currentTenantId || !this.selectedRealObjectId) {
            logger.warn('[NetBtronViewer] handleDownload: テナントまたは実身未選択');
            return;
        }

        logger.info('[NetBtronViewer] handleDownload: ダウンロード開始, tenantId:', this.currentTenantId, 'realId:', this.selectedRealObjectId);
        this.setStatus('ダウンロード中...');
        const result = await window.cloudAPI.downloadRealObject(
            this.currentTenantId, this.selectedRealObjectId
        );
        logger.info('[NetBtronViewer] handleDownload: downloadRealObject結果:', JSON.stringify({ success: result.success, name: result.metadata?.name, error: result.error }));

        if (result.success) {
            this.setStatus('ダウンロード完了（メタデータ: ' + result.metadata.name + '）');
        } else {
            this.setStatus('ダウンロード失敗: ' + result.error);
        }
    }

    async handleDelete() {
        if (!this.currentTenantId || !this.selectedRealObjectId) {
            logger.warn('[NetBtronViewer] handleDelete: テナントまたは実身未選択');
            return;
        }

        const obj = this.realObjects.find(o => o.id === this.selectedRealObjectId);
        const objName = obj ? obj.name : this.selectedRealObjectId;

        const answer = await this.showMessageDialog(
            '「' + objName + '」とその子実身をサーバーから削除しますか？',
            [
                { label: 'はい', value: 'yes' },
                { label: 'いいえ', value: 'no' }
            ],
            1
        );

        if (answer !== 'yes') return;

        logger.info('[NetBtronViewer] handleDelete: 削除開始, tenantId:', this.currentTenantId, 'realId:', this.selectedRealObjectId);
        this.setStatus('削除中（子実身を含む）...');
        const result = await window.cloudAPI.deleteRealObjectWithChildren(
            this.currentTenantId, this.selectedRealObjectId
        );
        logger.info('[NetBtronViewer] handleDelete: deleteRealObjectWithChildren結果:', JSON.stringify({ success: result.success, deleted: result.deleted, error: result.error }));

        if (result.success) {
            this.selectedRealObjectId = null;
            this.updateButtonStates();
            const deletedCount = result.deleted || 1;
            this.setStatus('削除完了（' + deletedCount + '件）');
            await this.loadRealObjectList();
        } else {
            this.setStatus('削除失敗: ' + result.error);
        }
    }

    async handleRefresh() {
        logger.info('[NetBtronViewer] handleRefresh: 一覧更新開始');
        await this.loadRealObjectList();
    }

    /**
     * 容量表示ダイアログを表示
     */
    async handleQuotaDisplay() {
        if (!this.currentTenantId) {
            this.setStatus('テナントが選択されていません');
            return;
        }

        this.setStatus('容量情報を取得中...');

        try {
            const result = await window.cloudAPI.getTenantQuota(this.currentTenantId);
            if (!result.success) {
                this.setStatus('容量情報の取得に失敗しました: ' + (result.error || ''));
                return;
            }

            const q = result.quota;
            const limitMB = (q.storage_limit / (1024 * 1024)).toFixed(1);
            const usedMB = (q.storage_used / (1024 * 1024)).toFixed(1);
            const pct = q.storage_pct || 0;

            // プログレスバーの幅計算（最大20文字）
            const barLen = 20;
            const filledLen = Math.round(barLen * Math.min(pct, 100) / 100);
            const emptyLen = barLen - filledLen;
            const barFilled = '\u2588'.repeat(filledLen);
            const barEmpty = '\u2591'.repeat(emptyLen);

            const message =
                'ストレージ使用量\n' +
                barFilled + barEmpty + '  ' + usedMB + 'MB / ' + limitMB + 'MB (' + pct + '%)\n\n' +
                '実身数: ' + q.object_count + '件\n' +
                'バージョン総数: ' + q.version_count + '件\n\n' +
                'バージョン保持: 最大' + q.max_versions + '世代 / ' + q.retention_days + '日';

            await this.showMessageDialog(
                message,
                [
                    { label: '閉じる', value: 'close' }
                ],
                0
            );

            this.setStatus('');
        } catch (error) {
            this.setStatus('容量情報の取得でエラーが発生しました');
        }
    }

    /**
     * バージョン履歴ダイアログを表示（復元機能付き）
     */
    async handleVersionHistory() {
        if (!this.selectedRealObjectId || !this.currentTenantId) {
            this.setStatus('実身を選択してください');
            return;
        }

        this.setStatus('バージョン履歴を取得中...');

        try {
            const result = await window.cloudAPI.getVersionHistory(
                this.currentTenantId, this.selectedRealObjectId, 50
            );

            if (!result.success) {
                this.setStatus('バージョン履歴の取得に失敗しました: ' + result.error);
                return;
            }

            const versions = result.versions || [];
            if (versions.length === 0) {
                await this.showMessageDialog(
                    'バージョン履歴がありません。\n\n' +
                    '保存時にバージョン管理RPC関数がデプロイされていないか、\n' +
                    'まだバージョン管理付きで保存されていません。',
                    [{ label: '閉じる', value: 'close' }],
                    0
                );
                this.setStatus('');
                return;
            }

            // 実身名を取得
            const realObjectName = this.getSelectedRealObjectName() || this.selectedRealObjectId;

            // バージョン履歴テーブルHTMLを構築
            let tableHtml = '<div style="font-family:monospace;font-size:12px;max-height:300px;overflow-y:auto;">';
            tableHtml += '<table style="width:100%;border-collapse:collapse;">';
            tableHtml += '<tr style="background:#e0e0e0;font-weight:bold;">' +
                '<td style="padding:4px 8px;">選択</td>' +
                '<td style="padding:4px 8px;">Ver</td>' +
                '<td style="padding:4px 8px;">日時</td>' +
                '<td style="padding:4px 8px;">サイズ</td>' +
                '<td style="padding:4px 8px;">差分</td>' +
                '<td style="padding:4px 8px;">状態</td></tr>';

            for (let i = 0; i < versions.length; i++) {
                const v = versions[i];
                const date = v.created_at ? this.formatDate(v.created_at) : '不明';
                const sizeStr = v.total_size ? (v.total_size / 1024).toFixed(1) + 'KB' : '不明';
                const isCurrent = (i === 0);
                const bgColor = (i % 2 === 0) ? '#ffffff' : '#f5f5f5';
                const statusText = isCurrent ? '現在' : '';
                const diffIcon = v.has_xtad_diff ? '有' : (i === versions.length - 1 ? '初版' : '-');

                tableHtml += '<tr style="background:' + bgColor + ';">' +
                    '<td style="padding:4px 8px;text-align:center;">' +
                    (isCurrent ? '' : '<input type="radio" name="restore_version" value="' + Number(v.version) + '" />') +
                    '</td>' +
                    '<td style="padding:4px 8px;">v' + Number(v.version) + '</td>' +
                    '<td style="padding:4px 8px;">' + this.escapeHtml(date) + '</td>' +
                    '<td style="padding:4px 8px;text-align:right;">' + this.escapeHtml(sizeStr) + '</td>' +
                    '<td style="padding:4px 8px;text-align:center;color:' + (v.has_xtad_diff ? '#0066cc' : '#999') + ';">' + diffIcon + '</td>' +
                    '<td style="padding:4px 8px;color:#666;">' + statusText + '</td></tr>';
            }
            tableHtml += '</table></div>';
            tableHtml += '<div style="margin-top:8px;color:#666;font-size:11px;">合計 ' + versions.length + ' バージョン</div>';

            const dialogResult = await this.showCustomDialog({
                title: 'バージョン履歴: ' + realObjectName,
                dialogHtml: tableHtml,
                buttons: [
                    { label: '閉じる', value: 'close' },
                    { label: '差分表示', value: 'diff' },
                    { label: '復元', value: 'restore' }
                ],
                defaultButton: 0,
                width: 560,
                radios: { restore_version: 'restore_version' }
            });

            this.setStatus('');

            if (dialogResult && dialogResult.button === 'restore') {
                const selectedVersion = dialogResult.formData?.restore_version;
                if (!selectedVersion) {
                    await this.showMessageDialog(
                        '復元するバージョンを選択してください。',
                        [{ label: 'OK', value: 'ok' }],
                        0
                    );
                    return;
                }
                await this.handleRestoreVersion(this.selectedRealObjectId, parseInt(selectedVersion));
            } else if (dialogResult && dialogResult.button === 'diff') {
                const selectedVersion = dialogResult.formData?.restore_version;
                if (!selectedVersion) {
                    await this.showMessageDialog(
                        '差分を表示するバージョンを選択してください。\n（現在のバージョン以外を選択）',
                        [{ label: 'OK', value: 'ok' }],
                        0
                    );
                    return;
                }
                await this.handleShowDiff(this.selectedRealObjectId, parseInt(selectedVersion));
            }
        } catch (error) {
            this.setStatus('バージョン履歴の取得でエラーが発生しました');
        }
    }

    /**
     * 指定バージョンに復元する
     * 復元 = 過去バージョンの内容で新バージョンを作成（履歴は破壊しない）
     * @param {string} realId
     * @param {number} version - 復元元のバージョン番号
     */
    async handleRestoreVersion(realId, version) {
        // 確認ダイアログ
        const answer = await this.showMessageDialog(
            'v' + version + ' に復元しますか？\n\n' +
            '現在のバージョンは履歴に残り、\nv' + version + ' の内容で新しいバージョンが作成されます。',
            [
                { label: '復元', value: 'restore' },
                { label: '取消', value: 'cancel' }
            ],
            1
        );

        if (answer !== 'restore') return;

        this.setStatus('v' + version + ' のファイルをダウンロード中...');

        try {
            // 1. 過去バージョンのファイルをダウンロード
            const dlResult = await window.cloudAPI.downloadVersionFiles(
                this.currentTenantId, realId, version
            );

            if (!dlResult.success) {
                this.setStatus('バージョンファイルのダウンロードに失敗しました: ' + dlResult.error);
                return;
            }

            // 2. メタデータを準備（復元元のメタデータをベースに更新日時を現在に）
            const currentMeta = this.cloudMetadata || {};
            const restoredMetadata = {
                ...currentMeta,
                id: realId,
                name: currentMeta.name,
                ref_count: currentMeta.ref_count || 1,
                record_count: currentMeta.record_count || 1,
                updateDate: new Date().toISOString()
            };

            this.setStatus('復元したデータを新バージョンとして保存中...');

            // 3. 新バージョンとして保存
            const saveResult = await window.cloudAPI.saveRealObjectWithVersion(
                this.currentTenantId,
                { metadata: restoredMetadata },
                dlResult.files,
                this.cloudVersion
            );

            if (saveResult.success) {
                // ローカル状態を更新
                if (saveResult.realObject) {
                    this.cloudVersion = saveResult.realObject.version;
                    this.cloudMetadata = saveResult.realObject;
                }
                this.isModified = false;
                this.saveLastViewInfo();

                // XTADデータをローカルにも反映
                if (dlResult.files.xtad) {
                    const decoder = new TextDecoder();
                    this.xmlData = decoder.decode(new Uint8Array(dlResult.files.xtad));
                }

                const newVer = saveResult.newVersion || (saveResult.realObject ? saveResult.realObject.version : '?');
                this.setStatus('v' + version + ' から v' + newVer + ' に復元しました');

                // 一覧を更新
                await this.handleRefresh();
            } else if (saveResult.conflict) {
                this.setStatus('復元失敗: 他のユーザーが先に変更しました');
            } else {
                this.setStatus('復元失敗: ' + saveResult.error);
            }
        } catch (error) {
            this.setStatus('復元中にエラーが発生しました: ' + error.message);
        }
    }

    /**
     * バージョン差分を表示する（XTAD差分 + ファイル変更一覧）
     * @param {string} realId
     * @param {number} version - 表示するバージョン番号
     */
    async handleShowDiff(realId, version) {
        this.setStatus('差分情報を取得中...');

        try {
            const result = await window.cloudAPI.getVersionDiff(
                this.currentTenantId, realId, version
            );

            if (!result.success) {
                this.setStatus('差分情報の取得に失敗しました: ' + result.error);
                return;
            }

            const realObjectName = this.getSelectedRealObjectName() || realId;

            // ファイル変更一覧HTMLを構築
            let html = '';
            const fileChanges = result.fileChanges || [];
            if (fileChanges.length > 0) {
                html += '<div style="margin-bottom:12px;">';
                html += '<div style="font-weight:bold;margin-bottom:4px;font-size:12px;">ファイル変更一覧:</div>';
                html += '<table style="width:100%;border-collapse:collapse;font-size:11px;font-family:monospace;">';
                for (const fc of fileChanges) {
                    let statusLabel = '';
                    let statusColor = '';
                    let sizeInfo = '';
                    switch (fc.status) {
                        case 'added':
                            statusLabel = '追加';
                            statusColor = '#008800';
                            sizeInfo = fc.size ? (fc.size / 1024).toFixed(1) + 'KB' : '';
                            break;
                        case 'deleted':
                            statusLabel = '削除';
                            statusColor = '#cc0000';
                            sizeInfo = fc.prevSize ? (fc.prevSize / 1024).toFixed(1) + 'KB' : '';
                            break;
                        case 'modified':
                            statusLabel = '変更';
                            statusColor = '#cc6600';
                            sizeInfo = (fc.prevSize ? (fc.prevSize / 1024).toFixed(1) : '?') + 'KB → ' + (fc.size ? (fc.size / 1024).toFixed(1) : '?') + 'KB';
                            break;
                        case 'unchanged':
                            statusLabel = '不変';
                            statusColor = '#999999';
                            sizeInfo = fc.size ? (fc.size / 1024).toFixed(1) + 'KB' : '';
                            break;
                    }
                    html += '<tr>' +
                        '<td style="padding:2px 6px;color:' + statusColor + ';font-weight:bold;">[' + statusLabel + ']</td>' +
                        '<td style="padding:2px 6px;">' + this.escapeHtml(fc.name) + '</td>' +
                        '<td style="padding:2px 6px;text-align:right;color:#666;">' + sizeInfo + '</td></tr>';
                }
                html += '</table></div>';
            }

            // XTAD差分HTMLを構築
            const xtadDiff = result.xtadDiff;
            if (xtadDiff && Array.isArray(xtadDiff) && xtadDiff.length > 0) {
                html += '<div style="font-weight:bold;margin-bottom:4px;font-size:12px;">XTAD差分:</div>';
                html += '<div style="max-height:300px;overflow-y:auto;border:1px solid #ccc;background:#fafafa;padding:4px;font-family:monospace;font-size:11px;white-space:pre-wrap;word-break:break-all;">';
                for (const [op, text] of xtadDiff) {
                    const lines = text.split('\n');
                    for (let li = 0; li < lines.length; li++) {
                        const line = lines[li];
                        if (li === lines.length - 1 && line === '') continue;
                        const escapedLine = this.escapeHtml(line);
                        if (op === -1) {
                            html += '<div style="background:#ffdddd;color:#cc0000;">- ' + escapedLine + '</div>';
                        } else if (op === 1) {
                            html += '<div style="background:#ddffdd;color:#008800;">+ ' + escapedLine + '</div>';
                        } else {
                            html += '<div style="color:#333;">  ' + escapedLine + '</div>';
                        }
                    }
                }
                html += '</div>';
            } else {
                html += '<div style="color:#666;font-size:12px;margin-top:8px;">このバージョンにはXTAD差分データがありません。</div>';
            }

            await this.showCustomDialog({
                title: '差分表示: ' + realObjectName + ' v' + version,
                dialogHtml: html,
                buttons: [{ label: '閉じる', value: 'close' }],
                defaultButton: 0,
                width: 600
            });

            this.setStatus('');
        } catch (error) {
            this.setStatus('差分表示でエラーが発生しました: ' + error.message);
        }
    }

    /**
     * 選択中の実身名を取得
     */
    getSelectedRealObjectName() {
        if (!this.selectedRealObjectId || !this.realObjectsList) return null;
        const item = this.realObjectsList.find(obj => obj.id === this.selectedRealObjectId);
        return item ? item.name : null;
    }

    formatDate(isoString) {
        if (!isoString) return '';
        const d = new Date(isoString);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const h = String(d.getHours()).padStart(2, '0');
        const min = String(d.getMinutes()).padStart(2, '0');
        const sec = String(d.getSeconds()).padStart(2, '0');
        return y + '/' + m + '/' + day + ' ' + h + ':' + min + ':' + sec;
    }

    // =========================================================
    // モード切替: 管理モード ↔ ビューモード
    // =========================================================

    /**
     * ローカルXTADデータでビューモードに復帰する
     * クラウド接続済みの場合は子実身メタデータを事前取得してから描画する
     */
    async enterViewModeLocal() {
        if (!this.localXmlData) return;

        this.xmlData = this.localXmlData;
        this.tadData = this.localXmlData;
        this.isViewMode = true;

        // UI切替
        document.getElementById('management-mode').style.display = 'none';
        document.getElementById('view-mode').style.display = '';

        // クラウド接続済みの場合、子実身メタデータを事前取得
        if (this.currentTenantId && this.cloudRealObjectId) {
            this.cloudChildrenData = new Map();
            this.backgroundUploadManager = new BackgroundUploadManager(this);
            try {
                this.setStatus('子実身のメタデータを取得中...');
                await this.downloadChildrenMetadata(this.xmlData);
                await this.downloadChildrenIcons();
            } catch (e) {
                logger.warn('[NetBtronViewer] enterViewModeLocal: 子実身メタデータ取得失敗:', e.message);
            }
        }

        // XTADを解析して描画
        await this.parseVirtualObjects();
        this.renderVirtualObjects();
        this.applyBackgroundColor();

        setTimeout(() => {
            document.body.focus();
        }, 100);
    }

    async enterViewMode(cloudRealObjectId) {
        if (!this.currentTenantId || !cloudRealObjectId) return;

        this.setStatus('実身データをダウンロード中...');

        try {
            const result = await window.cloudAPI.downloadRealObject(
                this.currentTenantId, cloudRealObjectId
            );

            if (!result.success) {
                this.setStatus('ダウンロード失敗: ' + result.error);
                return;
            }

            this.cloudRealObjectId = cloudRealObjectId;
            this.cloudMetadata = result.metadata;
            this.cloudVersion = result.metadata.version || 1;
            this.cloudFiles = result.files || {};

            // XTADデータを取得
            let xtadData = null;
            if (result.files && result.files.xtad) {
                if (result.files.xtad instanceof ArrayBuffer || result.files.xtad instanceof Uint8Array) {
                    xtadData = new TextDecoder().decode(result.files.xtad);
                } else if (Array.isArray(result.files.xtad)) {
                    xtadData = new TextDecoder().decode(new Uint8Array(result.files.xtad));
                } else if (typeof result.files.xtad === 'string') {
                    xtadData = result.files.xtad;
                }
            }

            if (!xtadData) {
                this.setStatus('XTADデータがありません');
                return;
            }

            this.xmlData = xtadData;
            this.tadData = xtadData;
            this.isViewMode = true;
            this.cloudChildrenData = new Map();
            this.backgroundUploadManager = new BackgroundUploadManager(this);

            // 子実身のメタデータを一括ダウンロード
            await this.downloadChildrenMetadata(xtadData);

            // 子実身のアイコンをクラウドからダウンロード
            await this.downloadChildrenIcons();

            // UI切替
            document.getElementById('management-mode').style.display = 'none';
            document.getElementById('view-mode').style.display = '';

            // XTADを解析して描画
            await this.parseVirtualObjects();
            this.renderVirtualObjects();
            this.applyBackgroundColor();

            // キーボードショートカット用にフォーカス設定
            setTimeout(() => {
                document.body.focus();
            }, 100);

            // 閲覧情報を保存（キャッシュ鮮度判定用）
            this.saveLastViewInfo();

            this.setStatus('ビューモード: ' + (this.cloudMetadata.name || cloudRealObjectId));
        } catch (error) {
            this.setStatus('ビューモード切替失敗: ' + error.message);
        }
    }

    exitViewMode() {
        // 現在のxmlDataをローカルデータとして保存（ビューモード復帰用）
        if (this.xmlData) {
            this.localXmlData = this.xmlData;
        }
        this.isViewMode = false;
        this.xmlData = null;
        this.tadData = null;
        this.virtualObjects = [];
        this.selectedVirtualObjects.clear();
        this.cloudRealObjectId = null;
        this.cloudFiles = null;
        this.cloudMetadata = null;
        this.cloudChildrenData = new Map();
        if (this.backgroundUploadManager) {
            this.backgroundUploadManager.clear();
            this.backgroundUploadManager = null;
        }
        this.expandedIframes.clear();

        // UI切替
        document.getElementById('view-mode').style.display = 'none';
        document.getElementById('management-mode').style.display = '';

        // 管理モードの背景色に戻す（CSSの既定値 #dedede を使用）
        document.body.style.backgroundColor = '';

        // ビューモードのDOMをクリア
        const virtualList = document.getElementById('virtualList');
        if (virtualList) {
            virtualList.innerHTML = '';
        }

        this.setStatus('管理モードに戻りました');
    }

    // =========================================================
    // 管理モード: ユーザー管理（system_admin用）
    // =========================================================

    async handleUserManagement() {
        logger.info('[NetBtronViewer] handleUserManagement: 開始, systemRole:', this.systemRole);
        if (this.systemRole !== 'system_admin') return;

        while (true) {
            this.setStatus('ユーザー一覧を取得中...');
            logger.info('[NetBtronViewer] handleUserManagement: listUsers呼び出し');
            const result = await window.cloudAPI.listUsers();
            logger.info('[NetBtronViewer] handleUserManagement: listUsers結果:', JSON.stringify({ success: result.success, count: result.users?.length, error: result.error }));
            if (!result.success) {
                this.setStatus('ユーザー一覧取得失敗: ' + result.error);
                return;
            }

            const users = result.users || [];
            const listHtml = buildUserManagementHtml({ users, currentUserId: this.currentUser.id, escapeHtml: this.escapeHtml.bind(this) });

            const dialogResult = await this.showCustomDialog({
                title: 'ユーザー管理',
                dialogHtml: listHtml,
                buttons: [
                    { label: 'ロール変更', value: 'change' },
                    { label: '閉じる', value: 'close' }
                ],
                defaultButton: 1,
                width: 450,
                radios: { 'selected-user': 'selected-user' }
            });

            logger.info('[NetBtronViewer] handleUserManagement: ダイアログ結果:', JSON.stringify(dialogResult));
            if (!dialogResult || dialogResult.button === 'close') break;

            if (dialogResult.button === 'change') {
                const userId = dialogResult.radios?.['selected-user'];
                const newRole = dialogResult.formData?.['new-system-role'];
                if (!userId || !newRole) {
                    this.setStatus('ユーザーとロールを選択してください');
                    continue;
                }
                logger.info('[NetBtronViewer] handleUserManagement: ロール変更, userId:', userId, 'newRole:', newRole);
                const changeResult = await window.cloudAPI.updateUserSystemRole(userId, newRole);
                logger.info('[NetBtronViewer] handleUserManagement: updateUserSystemRole結果:', JSON.stringify(changeResult));
                if (changeResult.success) {
                    this.setStatus('システムロールを変更しました');
                } else {
                    this.setStatus('ロール変更失敗: ' + changeResult.error);
                }
            }
        }
        this.setStatus('');
    }

    // =========================================================
    // 管理モード: メンバー管理
    // =========================================================

    async handleMemberManagement() {
        if (!this.currentTenantId) {
            logger.warn('[NetBtronViewer] handleMemberManagement: テナント未選択');
            return;
        }

        logger.info('[NetBtronViewer] handleMemberManagement: 開始, tenantId:', this.currentTenantId);

        // ループ型ダイアログ: 「追加」「削除」押下→API呼び出し→再表示
        while (true) {
            this.setStatus('メンバー一覧を取得中...');
            logger.info('[NetBtronViewer] handleMemberManagement: listTenantMembers呼び出し');
            const result = await window.cloudAPI.listTenantMembers(this.currentTenantId);
            logger.info('[NetBtronViewer] handleMemberManagement: listTenantMembers結果:', JSON.stringify({ success: result.success, count: result.members?.length, error: result.error }));
            if (!result.success) {
                this.setStatus('メンバー一覧取得失敗: ' + result.error);
                return;
            }

            const members = result.members || [];
            const listHtml = buildMemberManagementHtml({ members, escapeHtml: this.escapeHtml.bind(this) });

            const buttons = [
                { label: '追加', value: 'add' }
            ];
            if (members.length > 1) {
                buttons.push({ label: '削除', value: 'remove' });
            }
            buttons.push({ label: '招待', value: 'invite' });
            buttons.push({ label: '閉じる', value: 'close' });

            const dialogResult = await this.showCustomDialog({
                title: 'メンバー管理',
                dialogHtml: listHtml,
                buttons: buttons,
                defaultButton: buttons.length - 1,
                width: 380,
                radios: { 'selected-member': 'selected-member' }
            });

            logger.info('[NetBtronViewer] handleMemberManagement: ダイアログ結果:', JSON.stringify(dialogResult ? { button: dialogResult.button, formData: dialogResult.formData, radios: dialogResult.radios } : null));

            if (!dialogResult || dialogResult.button === 'close') break;

            if (dialogResult.button === 'add') {
                // formDataからメールアドレスとロールを取得
                const email = (dialogResult.formData?.['new-member-email'] || '').trim();
                const role = dialogResult.formData?.['new-member-role'] || 'member';
                if (!email) {
                    this.setStatus('メールアドレスを入力してください');
                    continue;
                }

                logger.info('[NetBtronViewer] handleMemberManagement: addTenantMember呼び出し, email:', email, 'role:', role);
                const addResult = await window.cloudAPI.addTenantMember(
                    this.currentTenantId, email, role
                );
                logger.info('[NetBtronViewer] handleMemberManagement: addTenantMember結果:', JSON.stringify(addResult));
                if (addResult.success) {
                    this.setStatus('メンバーを追加しました: ' + email);
                } else {
                    this.setStatus('メンバー追加失敗: ' + addResult.error);
                }
            } else if (dialogResult.button === 'remove') {
                // ラジオボタンで選択されたメンバーのuser_idを取得
                const selectedUserId = dialogResult.radios?.['selected-member'];
                if (!selectedUserId) {
                    this.setStatus('削除するメンバーを選択してください');
                    continue;
                }

                logger.info('[NetBtronViewer] handleMemberManagement: removeTenantMember呼び出し, userId:', selectedUserId);
                const removeResult = await window.cloudAPI.removeTenantMember(
                    this.currentTenantId, selectedUserId
                );
                logger.info('[NetBtronViewer] handleMemberManagement: removeTenantMember結果:', JSON.stringify(removeResult));
                if (removeResult.success) {
                    this.setStatus('メンバーを削除しました');
                } else {
                    this.setStatus('メンバー削除失敗: ' + removeResult.error);
                }
            } else if (dialogResult.button === 'invite') {
                // 招待管理ダイアログを開く
                await this.handleInviteManagement();
            }
            // ループ継続で最新のメンバー一覧を再表示
        }

        this.setStatus('');
    }

    // =========================================================
    // 管理モード: 招待管理
    // =========================================================

    async handleInviteManagement() {
        if (!this.currentTenantId) {
            logger.warn('[NetBtronViewer] handleInviteManagement: テナント未選択');
            return;
        }

        logger.info('[NetBtronViewer] handleInviteManagement: 開始, tenantId:', this.currentTenantId);

        while (true) {
            this.setStatus('招待一覧を取得中...');
            const result = await window.cloudAPI.listInvites(this.currentTenantId);
            if (!result.success) {
                this.setStatus('招待一覧取得失敗: ' + result.error);
                return;
            }

            const invites = result.invites || [];
            const listHtml = buildInviteManagementHtml({ invites, escapeHtml: this.escapeHtml.bind(this) });

            const buttons = [
                { label: '作成', value: 'create' }
            ];
            if (invites.some(inv => inv.status === 'pending')) {
                buttons.push({ label: '取消', value: 'revoke' });
            }
            buttons.push({ label: '閉じる', value: 'close' });

            const dialogResult = await this.showCustomDialog({
                title: '招待管理',
                dialogHtml: listHtml,
                buttons: buttons,
                defaultButton: buttons.length - 1,
                width: 420,
                radios: { 'selected-invite': 'selected-invite' },
                onDialogReady: (dialogElement) => {
                    // コピーボタンのイベントリスナーを設定
                    const copyBtns = dialogElement.querySelectorAll('.invite-copy-btn');
                    copyBtns.forEach(btn => {
                        btn.addEventListener('click', async (e) => {
                            e.stopPropagation();
                            const token = btn.dataset.token;
                            try {
                                await window.electronAPI.clipboardWriteText(token);
                                btn.textContent = '済';
                                setTimeout(() => { btn.textContent = 'コピー'; }, 1500);
                            } catch (err) {
                                logger.error('クリップボードコピーエラー:', err);
                            }
                        });
                    });
                }
            });

            if (!dialogResult || dialogResult.button === 'close') break;

            if (dialogResult.button === 'create') {
                const email = (dialogResult.formData?.['new-invite-email'] || '').trim();
                const role = dialogResult.formData?.['new-invite-role'] || 'member';

                logger.info('[NetBtronViewer] handleInviteManagement: createInvite呼び出し, email:', email, 'role:', role);
                const createResult = await window.cloudAPI.createInvite(
                    this.currentTenantId, email, role
                );
                if (createResult.success) {
                    const token = createResult.invite.token;
                    // トークンをクリップボードにコピー
                    try {
                        await window.electronAPI.clipboardWriteText(token);
                        this.setStatus('招待を作成しました（トークンをクリップボードにコピー済み）');
                    } catch (e) {
                        this.setStatus('招待を作成しました（トークン: ' + token + '）');
                    }
                } else {
                    this.setStatus('招待作成失敗: ' + createResult.error);
                }
            } else if (dialogResult.button === 'revoke') {
                const selectedInviteId = dialogResult.radios?.['selected-invite'];
                if (!selectedInviteId) {
                    this.setStatus('取消する招待を選択してください');
                    continue;
                }

                logger.info('[NetBtronViewer] handleInviteManagement: revokeInvite呼び出し, inviteId:', selectedInviteId);
                const revokeResult = await window.cloudAPI.revokeInvite(selectedInviteId);
                if (revokeResult.success) {
                    this.setStatus('招待を取り消しました');
                } else {
                    this.setStatus('招待取消失敗: ' + revokeResult.error);
                }
            }
        }

        this.setStatus('');
    }

    // =========================================================
    // 招待コードで新規登録
    // =========================================================

    async handleSignupWithInvite() {
        logger.info('[NetBtronViewer] handleSignupWithInvite: 開始');

        // Step 1: 招待トークン入力
        const token = await this.showInputDialog('招待コードを入力してください', '');
        if (!token) {
            return;
        }

        // Step 2: 招待情報を取得
        this.setStatus('招待情報を確認中...');
        const inviteResult = await window.cloudAPI.getInviteByToken(token.trim());
        if (!inviteResult.success) {
            this.setStatus('招待コードが無効です: ' + inviteResult.error);
            return;
        }

        const invite = inviteResult.invite;

        // 有効性チェック
        if (invite.status !== 'pending') {
            this.setStatus('この招待コードは既に使用済みまたは期限切れです');
            return;
        }
        if (new Date(invite.expires_at) < new Date()) {
            this.setStatus('この招待コードは期限切れです');
            return;
        }

        // Step 3: 登録方法選択
        const methodResult = await this.showMessageDialog(
            invite.tenant_name + ' への招待\nロール: ' + (invite.role === 'admin' ? '管理者' : invite.role === 'member' ? 'メンバー' : '読取専用') + '\n\n登録方法を選択してください',
            [
                { label: 'メール/パスワード', value: 'email' },
                { label: 'Googleアカウント', value: 'google' },
                { label: 'キャンセル', value: 'cancel' }
            ],
            0
        );

        if (!methodResult || methodResult === 'cancel') {
            this.setStatus('');
            return;
        }

        if (methodResult === 'google') {
            // Google OAuth で登録
            this.setStatus('Googleアカウントで登録中...');
            const oauthResult = await window.cloudAPI.signInWithOAuth('google');
            if (!oauthResult.success) {
                if (oauthResult.cancelled) {
                    this.setStatus('登録がキャンセルされました');
                } else {
                    this.setStatus('Google認証失敗: ' + (oauthResult.error || '不明なエラー'));
                }
                return;
            }
            this.currentUser = oauthResult.user;

            // HI-5: 招待消費（失敗時はリトライダイアログを表示）
            this.setStatus('テナントに参加中...');
            let consumeSuccess = false;
            for (let attempt = 0; attempt < 3; attempt++) {
                const consumeResult = await window.cloudAPI.consumeInvite(token.trim());
                if (consumeResult.success) {
                    consumeSuccess = true;
                    break;
                }
                if (attempt < 2) {
                    const retry = await this.showMessageDialog(
                        'テナント参加に失敗しました: ' + consumeResult.error + '\n\nリトライしますか？',
                        [{ label: 'リトライ', value: 'retry' }, { label: '中止', value: 'abort' }], 0
                    );
                    if (retry !== 'retry') break;
                } else {
                    this.setStatus('テナント参加失敗: ' + consumeResult.error + '（ログイン済みですが、テナントに未参加です。オーナーに連絡してください）');
                    return;
                }
            }
            if (!consumeSuccess) {
                this.setStatus('テナント参加を中止しました（ログイン済みですが、テナントに未参加です。オーナーに連絡してください）');
                return;
            }

            // ログイン情報を保存
            const savedConfig = localStorage.getItem('net-btron-config');
            if (savedConfig) {
                try {
                    const config = JSON.parse(savedConfig);
                    this.saveConfig(config.url || '', config.anonKey || '', oauthResult.user.email);
                } catch (e) {
                    logger.debug('[NetBtronViewer] OAuth設定保存エラー:', e.message);
                }
            }
            this.setStatus('登録完了！テナントに参加しました');
            await this.showMainPanel();

        } else {
            // メール/パスワードで登録
            const signupHtml = buildSignupFormHtml({ invite, escapeHtml: this.escapeHtml.bind(this) });

            const signupResult = await this.showCustomDialog({
                title: '新規ユーザー登録',
                dialogHtml: signupHtml,
                buttons: [
                    { label: '登録', value: 'register' },
                    { label: 'キャンセル', value: 'cancel' }
                ],
                defaultButton: 0,
                width: 350
            });

            if (!signupResult || signupResult.button === 'cancel') {
                this.setStatus('');
                return;
            }

            const email = (signupResult.formData?.['signup-email'] || '').trim();
            const password = signupResult.formData?.['signup-password'] || '';
            const passwordConfirm = signupResult.formData?.['signup-password-confirm'] || '';

            if (!email) {
                this.setStatus('メールアドレスを入力してください');
                return;
            }
            // LO-4: パスワード強度要件を8文字以上に強化
            if (password.length < 8) {
                this.setStatus('パスワードは8文字以上で入力してください');
                return;
            }
            if (password !== passwordConfirm) {
                this.setStatus('パスワードが一致しません');
                return;
            }

            // サインアップ
            this.setStatus('アカウントを作成中...');
            const signUpResult = await window.cloudAPI.signUp(email, password);
            if (!signUpResult.success) {
                this.setStatus('アカウント作成失敗: ' + signUpResult.error);
                return;
            }
            this.currentUser = signUpResult.user;

            // HI-5: 招待消費（失敗時はリトライダイアログを表示）
            this.setStatus('テナントに参加中...');
            let consumeSuccess = false;
            for (let attempt = 0; attempt < 3; attempt++) {
                const consumeResult = await window.cloudAPI.consumeInvite(token.trim());
                if (consumeResult.success) {
                    consumeSuccess = true;
                    break;
                }
                if (attempt < 2) {
                    const retry = await this.showMessageDialog(
                        'テナント参加に失敗しました: ' + consumeResult.error + '\n\nリトライしますか？',
                        [{ label: 'リトライ', value: 'retry' }, { label: '中止', value: 'abort' }], 0
                    );
                    if (retry !== 'retry') break;
                } else {
                    this.setStatus('テナント参加失敗: ' + consumeResult.error + '（アカウントは作成済みですが、テナントに未参加です。オーナーに連絡してください）');
                    return;
                }
            }
            if (!consumeSuccess) {
                this.setStatus('テナント参加を中止しました（アカウントは作成済みですが、テナントに未参加です。オーナーに連絡してください）');
                return;
            }

            // ログイン情報を保存
            const savedConfig = localStorage.getItem('net-btron-config');
            if (savedConfig) {
                try {
                    const config = JSON.parse(savedConfig);
                    this.saveConfig(config.url || '', config.anonKey || '', email);
                } catch (e) {
                    logger.debug('[NetBtronViewer] 招待登録時設定保存エラー:', e.message);
                }
            }
            this.setStatus('登録完了！テナントに参加しました');
            await this.showMainPanel();
        }
    }

    // =========================================================
    // 管理モード: 共有管理
    // =========================================================

    async handleShareDialog() {
        if (!this.selectedRealObjectId) {
            logger.warn('[NetBtronViewer] handleShareDialog: 実身未選択');
            return;
        }

        const obj = this.realObjects.find(o => o.id === this.selectedRealObjectId);
        const objName = obj ? obj.name : this.selectedRealObjectId;
        logger.info('[NetBtronViewer] handleShareDialog: 開始, objectId:', this.selectedRealObjectId, 'name:', objName);

        // ループ型ダイアログ: 「共有」「解除」押下→API呼び出し→再表示
        while (true) {
            this.setStatus('共有情報を取得中...');
            logger.info('[NetBtronViewer] handleShareDialog: listShares呼び出し, objectId:', this.selectedRealObjectId);
            const result = await window.cloudAPI.listShares(this.selectedRealObjectId);
            logger.info('[NetBtronViewer] handleShareDialog: listShares結果:', JSON.stringify({ success: result.success, count: result.shares?.length, error: result.error }));
            if (!result.success) {
                this.setStatus('共有情報取得失敗: ' + result.error);
                return;
            }

            const shares = result.shares || [];
            const listHtml = buildShareDialogHtml({ objName, shares, escapeHtml: this.escapeHtml.bind(this) });

            const buttons = [
                { label: '共有', value: 'add' }
            ];
            if (shares.length > 0) {
                buttons.push({ label: '解除', value: 'remove' });
            }
            buttons.push({ label: '閉じる', value: 'close' });

            const dialogResult = await this.showCustomDialog({
                title: '共有管理',
                dialogHtml: listHtml,
                buttons: buttons,
                defaultButton: buttons.length - 1,
                width: 380,
                radios: { 'selected-share': 'selected-share' }
            });

            logger.info('[NetBtronViewer] handleShareDialog: ダイアログ結果:', JSON.stringify(dialogResult ? { button: dialogResult.button, formData: dialogResult.formData, radios: dialogResult.radios } : null));

            if (!dialogResult || dialogResult.button === 'close') break;

            if (dialogResult.button === 'add') {
                // formDataから共有先メールアドレスと権限を取得
                const email = (dialogResult.formData?.['share-email'] || '').trim();
                const permission = dialogResult.formData?.['share-permission'] || 'read';
                if (!email) {
                    this.setStatus('メールアドレスを入力してください');
                    continue;
                }

                logger.info('[NetBtronViewer] handleShareDialog: createShare呼び出し, objectId:', this.selectedRealObjectId, 'email:', email, 'permission:', permission);
                const addResult = await window.cloudAPI.createShare(
                    this.selectedRealObjectId, email, permission
                );
                logger.info('[NetBtronViewer] handleShareDialog: createShare結果:', JSON.stringify(addResult));
                if (addResult.success) {
                    this.setStatus('共有を追加しました: ' + email);
                } else {
                    this.setStatus('共有追加失敗: ' + addResult.error);
                }
            } else if (dialogResult.button === 'remove') {
                // ラジオボタンで選択された共有IDを取得
                const shareId = dialogResult.radios?.['selected-share'];
                if (!shareId) {
                    this.setStatus('解除する共有先を選択してください');
                    continue;
                }

                logger.info('[NetBtronViewer] handleShareDialog: deleteShare呼び出し, shareId:', shareId);
                const removeResult = await window.cloudAPI.deleteShare(shareId);
                logger.info('[NetBtronViewer] handleShareDialog: deleteShare結果:', JSON.stringify(removeResult));
                if (removeResult.success) {
                    this.setStatus('共有を解除しました');
                } else {
                    this.setStatus('共有解除失敗: ' + removeResult.error);
                }
            }
            // ループ継続で最新の共有一覧を再表示
        }

        this.setStatus('');
    }

    // escapeHtml(text) は PluginBase に移動済み

    // =========================================================
    // MessageBusハンドラ
    // =========================================================

    setupMessageBusHandlers() {
        // 共通MessageBusハンドラを登録（PluginBaseで定義）
        // window-moved, window-resized-end, window-maximize-toggled,
        // menu-action, get-menu-definition, window-close-request
        this.setupCommonMessageBusHandlers();

        // init メッセージ
        this.messageBus.on('init', async (data) => {
            this.onInit(data);
            this.fileData = data.fileData;
            this.cloudContext = (this.fileData && this.fileData.cloudContext) ? this.fileData.cloudContext : null;

            const realIdValue = this.fileData ? (this.fileData.realId || this.fileData.fileId) : null;
            if (realIdValue) {
                this.realId = this.extractRealId(realIdValue);
            } else {
                this.realId = null;
            }

            if (this.fileData && this.fileData.isFullscreen !== undefined) {
                this.isFullscreen = this.fileData.isFullscreen;
            }

            // xmlDataがあればローカルキャッシュとして保存（この時点では表示しない）
            if (this.fileData && this.fileData.xmlData) {
                this.localXmlData = this.fileData.xmlData;
            }

            // windowConfigを保持（ビューモード直行時に使用）
            if (this.fileData && this.fileData.windowConfig) {
                this._savedWindowConfig = this.fileData.windowConfig;
            }

            // 認証状態に応じてモード判定（セッション復元可能ならビューモード直行）
            await this.tryAutoConnect();

            setTimeout(() => {
                document.body.focus();
            }, 100);
        });

        // window-closed メッセージ
        this.messageBus.on('window-closed', (data) => {
            this.handleWindowClosed(data.windowId, data.fileData);
        });

        // load-virtual-object メッセージ（開いた仮身表示用）
        this.messageBus.on('load-virtual-object', async (data) => {
            if (data.readonly === true) {
                this.isReadonly = true;
                document.body.classList.add('readonly-mode');
            }
            if (data.noScrollbar === true) {
                this.noScrollbar = true;
                document.body.style.overflow = 'hidden';
                const pluginContent = document.querySelector('.plugin-content');
                if (pluginContent) pluginContent.style.overflow = 'hidden';
                const viewerContainer = document.querySelector('.viewer-container');
                if (viewerContainer) viewerContainer.style.overflow = 'hidden';
            }

            if (data.realObject && data.realObject.records && data.realObject.records.length > 0) {
                const firstRecord = data.realObject.records[0];
                this.xmlData = firstRecord.xtad || firstRecord.data;
                this.tadData = this.xmlData;
                if (data.bgcol) this.bgcol = data.bgcol;

                this.isViewMode = true;
                document.getElementById('management-mode').style.display = 'none';
                document.getElementById('view-mode').style.display = '';

                await this.parseVirtualObjects();
                this.renderVirtualObjects();
            }
        });

        // load-data メッセージ
        this.messageBus.on('load-data', async (data) => {
            if (data.readonly === true) {
                this.isReadonly = true;
                document.body.classList.add('readonly-mode');
            }
            if (data.noScrollbar === true) {
                this.noScrollbar = true;
                document.body.style.overflow = 'hidden';
                const pluginContent = document.querySelector('.plugin-content');
                if (pluginContent) pluginContent.style.overflow = 'hidden';
            }
            if (data.bgcol) this.bgcol = data.bgcol;

            if (data.realObject && data.realObject.records && data.realObject.records.length > 0) {
                const firstRecord = data.realObject.records[0];
                this.xmlData = firstRecord.xtad || firstRecord.data;
                this.tadData = this.xmlData;

                this.isViewMode = true;
                document.getElementById('management-mode').style.display = 'none';
                document.getElementById('view-mode').style.display = '';

                await this.parseVirtualObjects();
                this.renderVirtualObjects();
                this.applyBackgroundColor();
            }
        });

        // add-virtual-object メッセージ
        this.messageBus.on('add-virtual-object', async (data) => {
            await this.addVirtualObjectFromFile(data.file);
        });

        // add-virtual-object-from-base メッセージ
        this.messageBus.on('add-virtual-object-from-base', (data) => {
            this.addVirtualObjectFromRealId(data.realId, data.name, data.dropPosition, data.applist, data.linkAttributes);
        });

        // add-virtual-object-from-trash メッセージ
        this.messageBus.on('add-virtual-object-from-trash', (data) => {
            this.addVirtualObjectFromRealId(data.realId, data.name, data.dropPosition, data.applist);
        });

        // insert-root-virtual-object メッセージ
        this.messageBus.on('insert-root-virtual-object', (data) => {
            logger.debug('[NetBtronViewer] [MessageBus] ルート実身配置要求受信:', data.rootFileData);
            this.insertRootVirtualObject(data.rootFileData, data.x, data.y, data.sourceWindowId);
        });

        // window-resized メッセージ
        this.messageBus.on('window-resized', (data) => {
            this.updateCanvasSize();
        });

        // parent-drag-position メッセージ
        this.messageBus.on('parent-drag-position', (data) => {
            this.handleParentDragPosition(data);
        });

        // cross-window-drop-in-progress メッセージ
        this.messageBus.on('cross-window-drop-in-progress', (data) => {
            this.lastDropWasCrossWindow = true;
        });

        // parent-drop-event メッセージ
        this.messageBus.on('parent-drop-event', (data) => {
            if (data.dragData) {
                const canvas = document.querySelector('.virtual-canvas');
                if (!canvas) return;

                const dropEvent = new CustomEvent('drop', { bubbles: true, cancelable: true });
                Object.defineProperty(dropEvent, 'clientX', { value: data.clientX, writable: false });
                Object.defineProperty(dropEvent, 'clientY', { value: data.clientY, writable: false });
                Object.defineProperty(dropEvent, 'dataTransfer', {
                    value: {
                        getData: (type) => {
                            if (type === 'text/plain') return JSON.stringify(data.dragData);
                            return '';
                        }
                    },
                    writable: false
                });
                canvas.dispatchEvent(dropEvent);
            }
        });

        // アイコン読み込みリレー機能
        window.addEventListener('message', (e) => {
            if (e.data && e.data.type === 'read-icon-file') {
                const { realId, messageId } = e.data;
                let sourceIframe = null;
                for (const iframe of this.expandedIframes) {
                    if (iframe.contentWindow === e.source) {
                        sourceIframe = iframe;
                        break;
                    }
                }
                this.iconRequestMap.set(messageId, sourceIframe || e.source);
                this.messageBus.send('read-icon-file', { realId, messageId });
            }
        });

        this.messageBus.on('icon-file-loaded', (data) => {
            const { messageId } = data;
            const source = this.iconRequestMap.get(messageId);
            if (source) {
                try {
                    const targetWindow = source.contentWindow || source;
                    if (targetWindow && typeof targetWindow.postMessage === 'function') {
                        targetWindow.postMessage({ type: 'icon-file-loaded', ...data }, '*');
                    }
                } catch (error) {
                    logger.error('[NetBtronViewer] 子へのicon-file-loaded転送エラー:', error);
                }
                this.iconRequestMap.delete(messageId);
            }
        });

        // 画像ファイルパスリレー機能
        window.addEventListener('message', (e) => {
            if (e.data && e.data.type === 'delete-image-file') {
                // M-10: ソース検証 - 信頼できるiframeからのメッセージのみ受け付ける
                const isTrustedSource = e.source === window.parent ||
                    (this.expandedIframes && Array.from(this.expandedIframes).some(iframe => iframe.contentWindow === e.source));
                if (!isTrustedSource) return;
                this.messageBus.send('delete-image-file', { fileName: e.data.fileName });
            }
        });

        window.addEventListener('message', (e) => {
            if (e.data && e.data.type === 'get-image-file-path') {
                const { fileName, messageId } = e.data;
                let sourceIframe = null;
                for (const iframe of this.expandedIframes) {
                    if (iframe.contentWindow === e.source) {
                        sourceIframe = iframe;
                        break;
                    }
                }
                this.imagePathRequestMap.set(messageId, sourceIframe || e.source);
                this.messageBus.send('get-image-file-path', { fileName, messageId });
            }
        });

        this.messageBus.on('image-file-path-response', (data) => {
            const { messageId } = data;
            const source = this.imagePathRequestMap.get(messageId);
            if (source) {
                try {
                    const targetWindow = source.contentWindow || source;
                    if (targetWindow && typeof targetWindow.postMessage === 'function') {
                        targetWindow.postMessage({ type: 'image-file-path-response', ...data }, '*');
                    }
                } catch (error) {
                    logger.error('[NetBtronViewer] 子へのimage-file-path-response転送エラー:', error);
                }
                this.imagePathRequestMap.delete(messageId);
            }
        });
    }

    handleParentDragPosition(data) {
        if (data.currentMouseOverWindowId !== undefined && data.currentMouseOverWindowId !== null) {
            this.vobjDragState.lastMouseOverWindowId = data.currentMouseOverWindowId;
        }

        if (!data.isOverThisWindow) return;
        if (!this.vobjDragState.currentObject) return;

        const deltaX = data.relativeX - this.virtualObjectDragState.startX;
        const deltaY = data.relativeY - this.virtualObjectDragState.startY;

        const pluginContent = document.querySelector('.plugin-content');
        const scrollDeltaX = pluginContent ? pluginContent.scrollLeft - this.vobjDragState.startScrollLeft : 0;
        const scrollDeltaY = pluginContent ? pluginContent.scrollTop - this.vobjDragState.startScrollTop : 0;

        if (this.vobjDragState.selectedObjects && this.vobjDragState.selectedObjectsInitialPositions) {
            this.vobjDragState.selectedObjects.forEach((item, index) => {
                if (index >= this.vobjDragState.selectedObjectsInitialPositions.length) return;
                const initialPos = this.vobjDragState.selectedObjectsInitialPositions[index];
                if (!initialPos) return;
                const newLeft = initialPos.left + deltaX + scrollDeltaX;
                const newTop = initialPos.top + deltaY + scrollDeltaY;
                const element = document.querySelector(`[data-vobj-index="${item.vobjIndex}"]`);
                if (element) {
                    element.style.left = newLeft + 'px';
                    element.style.top = newTop + 'px';
                }
            });
        }

        this.vobjDragState.currentDeltaX = deltaX;
        this.vobjDragState.currentDeltaY = deltaY;
    }

    // =========================================================
    // ビューモード: XTAD解析
    // =========================================================

    async parseVirtualObjects() {
        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(this.xmlData, 'text/xml');
            const linkElements = xmlDoc.getElementsByTagName('link');

            const parsedObjects = [];
            let xmlIndex = 0;
            for (const link of linkElements) {
                const virtualObj = this.parseLinkElement(link);
                if (virtualObj) {
                    virtualObj._xmlIndex = xmlIndex;
                    parsedObjects.push(virtualObj);
                }
                xmlIndex++;
            }

            const results = await Promise.allSettled(
                parsedObjects.map(obj => this.loadVirtualObjectMetadata(obj))
            );

            this.virtualObjects = [];
            parsedObjects.forEach((obj, index) => {
                if (results[index].status === 'rejected') {
                    logger.warn('[NetBtronViewer] メタデータ読み込み失敗:', obj.link_id, results[index].reason);
                }
                this.virtualObjects.push(obj);
            });

            // 全link要素を正規化（vobjid/applist/scrollx/scrolly/zoomratio等を一括付与）
            this.normalizeXmlLinkElements();

            await this.autoOpenVirtualObjects();
        } catch (error) {
            logger.error('[NetBtronViewer] XML解析エラー:', error);
        }
    }

    /**
     * プラグイン固有のlink要素属性を設定（normalizeXmlLinkElementsから呼ばれる）
     */
    buildPluginSpecificLinkAttributes(linkElement, virtualObj) {
        if (virtualObj.isFixed) {
            linkElement.setAttribute('fixed', 'true');
        } else {
            linkElement.removeAttribute('fixed');
        }
        if (virtualObj.isBackground) {
            linkElement.setAttribute('background', 'true');
        } else {
            linkElement.removeAttribute('background');
        }
    }

    parseLinkElement(linkElement) {
        const baseObj = super.parseLinkElement(linkElement);
        if (!baseObj) return null;

        try {
            return {
                ...baseObj,
                originalLeft: baseObj.vobjleft,
                originalTop: baseObj.vobjtop,
                originalRight: baseObj.vobjright,
                originalBottom: baseObj.vobjbottom,
                isFixed: linkElement.getAttribute('fixed') === 'true',
                isBackground: linkElement.getAttribute('background') === 'true'
            };
        } catch (error) {
            logger.error('[NetBtronViewer] リンク要素解析エラー:', error);
            return null;
        }
    }

    async loadVirtualObjectMetadata(virtualObj) {
        try {
            if (!virtualObj.link_id || virtualObj.link_id === '') {
                virtualObj.applist = {};
                return;
            }

            const baseFileId = window.RealObjectSystem.extractRealId(virtualObj.link_id);
            const jsonFileName = window.RealObjectSystem.getRealObjectJsonFileName(baseFileId);

            // Cloud-first: 子実身のメタデータをcloudChildrenDataから取得
            if (this.cloudChildrenData && this.cloudChildrenData.has(baseFileId)) {
                try {
                    const dbRow = this.cloudChildrenData.get(baseFileId);
                    const meta = dbRow.metadata || {};
                    virtualObj.applist = meta.applist || {};
                    virtualObj.metadata = {
                        name: dbRow.name,
                        applist: meta.applist || {},
                        updateDate: meta.updateDate || dbRow.updated_at,
                        makeDate: meta.makeDate,
                        ref_count: dbRow.ref_count,
                        record_count: dbRow.record_count
                    };
                    virtualObj.updateDate = meta.updateDate || dbRow.updated_at;
                    if (dbRow.name && virtualObj.link_name !== dbRow.name) {
                        virtualObj.link_name = dbRow.name;
                    }
                    return;
                } catch (childError) {
                    logger.debug('[NetBtronViewer] cloudChildrenDataからの取得失敗:', childError.message);
                }
            }

            // ローカルフォールバック: 親ウィンドウのfileObjects
            if (window.parent && window.parent.tadjsDesktop && window.parent.tadjsDesktop.fileObjects) {
                const jsonFile = window.parent.tadjsDesktop.fileObjects[jsonFileName];
                if (jsonFile) {
                    const jsonText = await jsonFile.text();
                    const jsonData = JSON.parse(jsonText);
                    virtualObj.applist = jsonData.applist || {};
                    virtualObj.metadata = jsonData;
                    virtualObj.updateDate = jsonData.updateDate;
                    if (jsonData.name && virtualObj.link_name !== jsonData.name) {
                        virtualObj.link_name = jsonData.name;
                    }
                    return;
                }
            }

            // loadDataFileFromParent経由
            try {
                const jsonFile = await this.loadDataFileFromParent(jsonFileName);
                const jsonText = await jsonFile.text();
                const jsonData = JSON.parse(jsonText);
                virtualObj.applist = jsonData.applist || {};
                virtualObj.metadata = jsonData;
                virtualObj.updateDate = jsonData.updateDate;
                if (jsonData.name && virtualObj.link_name !== jsonData.name) {
                    virtualObj.link_name = jsonData.name;
                }
                return;
            } catch (parentError) {
                // HTTP fetchにフォールバック
                const urlsToTry = [
                    `../../${jsonFileName}`,
                    `../basic-text-editor/${jsonFileName}`,
                    `../virtual-object-list/${jsonFileName}`,
                    `../base-file-manager/${jsonFileName}`
                ];

                for (const jsonUrl of urlsToTry) {
                    try {
                        const response = await fetch(jsonUrl);
                        if (response.ok) {
                            const jsonData = await response.json();
                            virtualObj.applist = jsonData.applist || {};
                            virtualObj.metadata = jsonData;
                            virtualObj.updateDate = jsonData.updateDate;
                            if (jsonData.name && virtualObj.link_name !== jsonData.name) {
                                virtualObj.link_name = jsonData.name;
                            }
                            return;
                        }
                    } catch (fetchError) {
                        logger.debug('[NetBtronViewer] 次のURLを試行:', fetchError.message);
                    }
                }

                // クラウドフォールバック: cloudContextまたはcurrentTenantIdがある場合、親ウィンドウ経由でクラウドDL
                const tenantId = (this.cloudContext && this.cloudContext.tenantId) || this.currentTenantId;
                if (tenantId) {
                    try {
                        const dlMessageId = this.generateMessageId('dl-cloud');
                        this.messageBus.send('download-cloud-to-local', {
                            tenantId: tenantId,
                            realId: baseFileId,
                            messageId: dlMessageId
                        });
                        const dlResult = await this.messageBus.waitFor(
                            'download-cloud-to-local-response', 10000,
                            (d) => d.messageId === dlMessageId
                        );
                        if (dlResult.success) {
                            const jsonFile = await this.loadDataFileFromParent(jsonFileName);
                            const jsonText = await jsonFile.text();
                            const jsonData = JSON.parse(jsonText);
                            virtualObj.applist = jsonData.applist || {};
                            virtualObj.metadata = jsonData;
                            virtualObj.updateDate = jsonData.updateDate;
                            if (jsonData.name && virtualObj.link_name !== jsonData.name) {
                                virtualObj.link_name = jsonData.name;
                            }
                            return;
                        }
                    } catch (cloudError) {
                        logger.debug('[NetBtronViewer] クラウドフォールバック失敗:', cloudError.message);
                    }
                }

                virtualObj.applist = {};
            }
        } catch (error) {
            logger.debug('[NetBtronViewer] applist取得エラー:', error.message);
            virtualObj.applist = {};
        }
    }

    // =========================================================
    // ビューモード: レンダリング
    // =========================================================

    renderVirtualObjects() {
        const listElement = document.getElementById('virtualList');
        if (!listElement) return;

        const pluginContentForScroll = document.querySelector('#view-mode .plugin-content');
        const savedScrollLeft = pluginContentForScroll ? pluginContentForScroll.scrollLeft : 0;
        const savedScrollTop = pluginContentForScroll ? pluginContentForScroll.scrollTop : 0;

        const expandedVirtualObjects = new Set();
        const existingVirtualObjects = listElement.querySelectorAll('.virtual-object-opened');
        existingVirtualObjects.forEach(vobj => {
            const iframe = vobj.querySelector('iframe');
            if (iframe) {
                const linkId = vobj.getAttribute('data-link-id');
                if (linkId) expandedVirtualObjects.add(linkId);
            }
        });

        listElement.innerHTML = '';

        const bounds = window.calculateFigureContentBounds(this.xmlData);
        const margin = 10;
        const contentRight = bounds.right + margin;
        const contentBottom = bounds.bottom + margin;

        const canvas = document.createElement('div');
        canvas.className = 'virtual-canvas';
        canvas.style.position = 'relative';

        const pluginContent = document.querySelector('#view-mode .plugin-content');
        const windowWidth = pluginContent ? pluginContent.clientWidth : 0;
        const windowHeight = pluginContent ? pluginContent.clientHeight : 0;
        const finalWidth = Math.max(contentRight, windowWidth);
        const finalHeight = Math.max(contentBottom, windowHeight);

        canvas.style.width = finalWidth + 'px';
        canvas.style.height = finalHeight + 'px';

        // 図形要素の描画
        if (this.xmlData) {
            try {
                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(this.xmlData, 'text/xml');
                const result = this.renderFigureElements(xmlDoc, canvas);
                if (result.elementCount > 0 && result.figureContainer) {
                    result.figureContainer.style.width = finalWidth + 'px';
                    result.figureContainer.style.height = finalHeight + 'px';
                }
            } catch (figureError) {
                logger.error('[NetBtronViewer] 図形描画エラー:', figureError);
            }
        }

        // z-index管理
        const backgroundObjects = this.virtualObjects.filter(obj => obj.isBackground);
        const normalObjects = this.virtualObjects.filter(obj => !obj.isBackground);
        const allObjectsInOrder = [...backgroundObjects, ...normalObjects];

        allObjectsInOrder.forEach((obj, index) => {
            const chsz = parseFloat(obj.chsz) || DEFAULT_FONT_SIZE;
            const chszPx = window.convertPtToPx(chsz);
            const iconSize = window.convertPtToPx(chsz);
            const textHeight = Math.ceil(chszPx * DEFAULT_LINE_HEIGHT);
            const contentHeight = Math.max(iconSize, textHeight);
            const titleHeight = contentHeight + VOBJ_PADDING_VERTICAL;

            const isOpenVirtualObj = this.isOpenVirtualObject(obj);

            if (!isOpenVirtualObj) {
                obj.vobjbottom = obj.vobjtop + titleHeight;
            }

            const vobjIndex = this.virtualObjects.indexOf(obj);
            const vobjElement = this.createVirtualObjectElement(obj, vobjIndex);

            if (obj.isBackground) {
                vobjElement.style.zIndex = index + 1;
            } else {
                vobjElement.style.zIndex = 1000 + index - backgroundObjects.length;
            }

            canvas.appendChild(vobjElement);

            if (isOpenVirtualObj) {
                setTimeout(() => {
                    this.expandVirtualObject(vobjElement, obj, {
                        readonly: true,
                        noScrollbar: true,
                        bgcol: obj.bgcol
                    }).catch(err => {
                        logger.error('[NetBtronViewer] 展開エラー:', err);
                    });
                }, 0);
            }
        });

        listElement.appendChild(canvas);
        this.notifyScrollChange();
        this.applyBackgroundColor();

        if (this.selectedVirtualObjects.size > 0) {
            this.selectedVirtualObjects.forEach(vobjIndex => {
                const vobjElement = canvas.querySelector(`[data-vobj-index="${vobjIndex}"]`);
                if (vobjElement) {
                    vobjElement.style.boxShadow = SELECTION_BOX_SHADOW;
                }
            });
        }

        if (pluginContentForScroll) {
            const maxScrollLeft = Math.max(0, pluginContentForScroll.scrollWidth - pluginContentForScroll.clientWidth);
            const maxScrollTop = Math.max(0, pluginContentForScroll.scrollHeight - pluginContentForScroll.clientHeight);
            pluginContentForScroll.scrollLeft = Math.min(savedScrollLeft, maxScrollLeft);
            pluginContentForScroll.scrollTop = Math.min(savedScrollTop, maxScrollTop);
        }
    }

    createVirtualObjectElement(obj, vobjIndex) {
        if (!this.virtualObjectRenderer) {
            logger.error('[NetBtronViewer] VirtualObjectRenderer が初期化されていません');
            return document.createElement('div');
        }

        const options = {
            loadIconCallback: (realId) => this.iconManager.loadIcon(realId),
            vobjIndex: vobjIndex
        };

        const vobj = this.virtualObjectRenderer.createBlockElement(obj, options);
        this.attachVirtualObjectEventListeners(vobj, obj);
        return vobj;
    }

    attachVirtualObjectEventListeners(vobj, obj) {
        vobj.addEventListener('click', (e) => {
            this.closeContextMenu();
            e.stopPropagation();
            if (this.isReadonly) return;
            if (this.justSelectedInMouseDown) {
                this.justSelectedInMouseDown = false;
                return;
            }
            const vobjIndex = parseInt(vobj.getAttribute('data-vobj-index'));
            if (isNaN(vobjIndex)) return;
            this.selectVirtualObject(obj, vobj, e, vobjIndex);
        });

        this.makeVirtualObjectDraggable(vobj, obj);
        this.makeVirtualObjectResizable(vobj, obj);
    }

    isOpenVirtualObject(obj) {
        if (this.virtualObjectRenderer) {
            return this.virtualObjectRenderer.isOpenedVirtualObject(obj);
        }
        if (obj.opened !== undefined) return obj.opened === true;
        if (!obj.vobjbottom || !obj.vobjtop) return false;
        const vobjHeight = obj.vobjbottom - obj.vobjtop;
        const minClosedHeight = this._getMinClosedHeightFallback(obj.chsz);
        return vobjHeight > minClosedHeight;
    }

    _getMinClosedHeightFallback(chsz) {
        const chszPx = window.convertPtToPx(parseFloat(chsz) || DEFAULT_FONT_SIZE);
        const textHeight = Math.ceil(chszPx * DEFAULT_LINE_HEIGHT);
        return textHeight + VOBJ_PADDING_VERTICAL;
    }

    // =========================================================
    // ビューモード: 選択
    // =========================================================

    selectVirtualObject(obj, element, event, vobjIndex = null) {
        const isShiftKey = event && event.shiftKey;
        if (vobjIndex === null) {
            vobjIndex = parseInt(element.getAttribute('data-vobj-index'));
        }
        const currentObj = this.virtualObjects[vobjIndex];
        if (!currentObj) return;
        obj = currentObj;

        if (isShiftKey) {
            if (this.selectedVirtualObjects.has(vobjIndex)) {
                this.selectedVirtualObjects.delete(vobjIndex);
                element.style.boxShadow = '';
            } else {
                this.selectedVirtualObjects.add(vobjIndex);
                element.style.boxShadow = SELECTION_BOX_SHADOW;
            }
        } else {
            const allVirtualObjects = document.querySelectorAll('.virtual-object');
            allVirtualObjects.forEach(el => { el.style.boxShadow = ''; });
            this.selectedVirtualObjects.clear();
            this.selectedVirtualObjects.add(vobjIndex);
            element.style.boxShadow = SELECTION_BOX_SHADOW;
        }
    }

    getSelectedVirtualObject() {
        if (this.selectedVirtualObjects.size === 0) return null;
        const firstVobjIndex = Array.from(this.selectedVirtualObjects)[0];
        return this.virtualObjects[firstVobjIndex] || null;
    }

    getSelectedVirtualObjects() {
        return Array.from(this.selectedVirtualObjects)
            .map(index => this.virtualObjects[index])
            .filter(obj => obj !== undefined);
    }

    selectAllVirtualObjects() {
        this.selectedVirtualObjects.clear();
        this.virtualObjects.forEach((obj, index) => {
            if (!obj.isFixed && !obj.isBackground) {
                this.selectedVirtualObjects.add(index);
            }
        });
        this.updateSelectionDisplay();
    }

    updateSelectionDisplay() {
        const allVobjElements = document.querySelectorAll('.virtual-object');
        allVobjElements.forEach(el => { el.style.boxShadow = ''; });
        this.selectedVirtualObjects.forEach(vobjIndex => {
            const element = document.querySelector(`.virtual-object[data-vobj-index="${vobjIndex}"]`);
            if (element) {
                element.style.boxShadow = SELECTION_BOX_SHADOW;
            }
        });
    }

    preserveSelection(operation) {
        const selectedIdentifiers = Array.from(this.selectedVirtualObjects).map(vobjIndex => {
            const vobj = this.virtualObjects[vobjIndex];
            if (vobj) {
                return { link_id: vobj.link_id, vobjleft: vobj.vobjleft, vobjtop: vobj.vobjtop };
            }
            return null;
        }).filter(id => id);

        operation();

        this.selectedVirtualObjects.clear();
        selectedIdentifiers.forEach(identifier => {
            const newIndex = this.virtualObjects.findIndex(v =>
                v.link_id === identifier.link_id &&
                v.vobjleft === identifier.vobjleft &&
                v.vobjtop === identifier.vobjtop
            );
            if (newIndex !== -1) {
                this.selectedVirtualObjects.add(newIndex);
            }
        });
    }

    // =========================================================
    // ビューモード: DOM操作
    // =========================================================

    removeVirtualObjectElement(vobjIndex) {
        const canvas = document.querySelector('.virtual-canvas');
        if (!canvas) return;
        const element = canvas.querySelector(`[data-vobj-index="${vobjIndex}"]`);
        if (element) {
            const iframe = element.querySelector('iframe');
            if (iframe) this.expandedIframes.delete(iframe);
            element.remove();
        }
    }

    async addVirtualObjectElement(obj, insertAt) {
        const canvas = document.querySelector('.virtual-canvas');
        if (!canvas) return;
        const vobjElement = this.createVirtualObjectElement(obj, insertAt);
        vobjElement.style.zIndex = 1000 + insertAt;
        canvas.appendChild(vobjElement);
        if (this.isOpenVirtualObject(obj)) {
            await this.expandVirtualObject(vobjElement, obj, {
                readonly: true, noScrollbar: true, bgcol: obj.bgcol
            });
        }
    }

    updateVobjIndices() {
        const canvas = document.querySelector('.virtual-canvas');
        if (!canvas) return;
        const elements = canvas.querySelectorAll('.virtual-object');
        elements.forEach((element, index) => {
            element.setAttribute('data-vobj-index', index);
        });
    }

    synchronizeAfterArrayChange() {
        for (let i = 0; i < this.virtualObjects.length; i++) {
            this.virtualObjects[i]._xmlIndex = i;
        }
        this.updateVobjIndices();

        const validIndices = new Set();
        this.selectedVirtualObjects.forEach(idx => {
            if (idx >= 0 && idx < this.virtualObjects.length) validIndices.add(idx);
        });
        this.selectedVirtualObjects = validIndices;

        const validIframes = new Set();
        this.expandedIframes.forEach(iframe => {
            if (document.body.contains(iframe)) validIframes.add(iframe);
        });
        this.expandedIframes = validIframes;
    }

    // =========================================================
    // ビューモード: コンテキストメニュー
    // =========================================================

    setupContextMenu() {
        this.justOpenedContextMenu = false;
        this.justCompletedRangeSelection = false;

        document.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (this.virtualObjectDragState.isDragging) return;
            this.justOpenedContextMenu = true;
            setTimeout(() => { this.justOpenedContextMenu = false; }, CONTEXT_MENU_FLAG_CLEAR_MS);
            this.showContextMenuAtEvent(e);
        });

        document.addEventListener('click', () => {
            if (this.justOpenedContextMenu) return;
            if (this.justCompletedRangeSelection) return;
            this.messageBus.send('close-context-menu');
            if (!this.isReadonly && this.selectedVirtualObjects.size > 0) {
                const allVirtualObjects = document.querySelectorAll('.virtual-object');
                allVirtualObjects.forEach(el => { el.style.boxShadow = ''; });
                this.selectedVirtualObjects.clear();
            }
        });
    }

    setupWindowActivation() {
        document.addEventListener('mousedown', () => {
            this.closeContextMenu();
            this.messageBus.send('activate-window');
            document.body.focus();
        });
    }

    // =========================================================
    // ビューモード: ドラッグ&ドロップ
    // =========================================================

    setupDragAndDrop() {
        const listElement = document.getElementById('virtualList');
        if (!listElement) return;

        // ドラッグオーバー
        listElement.addEventListener('dragover', (e) => {
            e.preventDefault();

            const effectAllowed = e.dataTransfer.effectAllowed;
            if (effectAllowed === 'move') {
                e.dataTransfer.dropEffect = 'move';
            } else if (effectAllowed === 'copy') {
                e.dataTransfer.dropEffect = 'copy';
            } else {
                e.dataTransfer.dropEffect = 'copy';
            }

            listElement.style.backgroundColor = LIST_SELECTED_BG_COLOR;

            if (!this.virtualObjectDragState.isDragging) {
                // 別のウィンドウからドラッグされている場合（何もしない）
            }
        });

        // ドラッグリーブ
        listElement.addEventListener('dragleave', (e) => {
            e.preventDefault();
            listElement.style.backgroundColor = '';
        });

        // ドロップ
        listElement.addEventListener('drop', (e) => {
            e.preventDefault();
            listElement.style.backgroundColor = '';

            // URLドロップをチェック（PluginBase共通メソッド）
            const dropX = e.clientX;
            const dropY = e.clientY;
            if (this.checkAndHandleUrlDrop(e, dropX, dropY)) {
                return;
            }

            try {
                // 外部ファイルドロップをチェック（Windowsからのドラッグなど）
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    const files = Array.from(e.dataTransfer.files);
                    logger.info('[NetBtronViewer] 外部ファイルドロップ検出:', files.length, '個のファイル');
                    this.readAndSendFiles(files, e.clientX, e.clientY);
                    return;
                }

                // PluginBase共通メソッドでdragDataをパース
                const dragData = this.parseDragData(e.dataTransfer);
                if (dragData) {
                    if ((dragData.type === 'base-file-copy' || dragData.type === 'user-base-file-copy') && dragData.source === 'base-file-manager') {
                        // 原紙管理からのコピー
                        this.handleBaseFileDrop(dragData, e.clientX, e.clientY);
                        return;
                    } else if (dragData.type === 'trash-real-object-restore' && dragData.source === 'trash-real-objects') {
                        // 屑実身操作からの復元
                        logger.debug('[NetBtronViewer] 屑実身操作からのドロップを親ウィンドウに委譲');
                        this.messageBus.send('trash-real-object-drop-request', {
                            dragData: dragData,
                            clientX: e.clientX,
                            clientY: e.clientY
                        });
                        return;
                    } else if (dragData.type === 'archive-file-extract' && dragData.source === 'unpack-file') {
                        // 書庫解凍からのファイル抽出
                        this.insertArchiveFileAsVirtualObject(dragData, e.clientX, e.clientY);
                        return;
                    } else if (dragData.type === 'virtual-object-drag') {
                        // 仮身のドラッグ
                        const virtualObjects = dragData.virtualObjects || [dragData.virtualObject];
                        logger.debug('[NetBtronViewer] 仮身ドロップ受信:', virtualObjects.length, '個');

                        const isCrossWindow = dragData.sourceWindowId !== this.windowId;
                        if (isCrossWindow) {
                            logger.debug('[NetBtronViewer] クロスウィンドウドロップ検知');
                            this.messageBus.send('notify-cross-window-drop', {
                                sourceWindowId: dragData.sourceWindowId,
                                targetWindowId: this.windowId
                            });
                            this.insertVirtualObjectFromDrag(dragData, e.clientX, e.clientY);
                            dragData.targetWindowId = this.windowId;
                            this.notifyCrossWindowDropSuccess(dragData, virtualObjects);
                        } else {
                            logger.debug('[NetBtronViewer] 同じウィンドウ内でのドロップ');
                            this.vobjDragState.dropClientX = e.clientX;
                            this.vobjDragState.dropClientY = e.clientY;
                            this.virtualObjectDragState.hasMoved = true;
                        }
                        return;
                    } else if (dragData.type === 'image-drag') {
                        // 画像のドラッグ
                        logger.info('[NetBtronViewer] 画像ドロップ受信:', dragData.imageInfo?.savedFilename);
                        this.messageBus.send('image-dropped-on-plugin', {
                            dragData: dragData,
                            clientX: e.clientX,
                            clientY: e.clientY,
                            windowId: this.windowId
                        });
                        return;
                    }
                }
            } catch (error) {
                logger.error('[NetBtronViewer] ドロップ処理エラー:', error);
            }
        });
    }

    makeVirtualObjectDraggable(vobjElement, obj) {
        vobjElement.setAttribute('draggable', 'true');

        vobjElement.addEventListener('dragstart', (e) => {
            if (!this.vobjDragState.currentObject) {
                e.preventDefault();
                return;
            }

            this.initializeVirtualObjectDragStart(e);
            this.lastDropWasCrossWindow = false;
            this.vobjDragState.lastMouseOverWindowId = this.windowId;
            this.vobjDragState.isMouseInThisWindow = true;

            const pluginContent = document.querySelector('#view-mode .plugin-content');
            if (pluginContent) {
                this.vobjDragState.startScrollLeft = pluginContent.scrollLeft;
                this.vobjDragState.startScrollTop = pluginContent.scrollTop;
                pluginContent.style.overflow = 'hidden';
            }

            this.disableIframePointerEvents();

            let virtualObjects = [];
            if (this.vobjDragState.selectedObjects && this.vobjDragState.selectedObjects.length > 0) {
                virtualObjects = this.vobjDragState.selectedObjects.map(item => {
                    const vobj = item.obj;
                    return {
                        link_id: vobj.link_id, link_name: vobj.link_name,
                        width: vobj.width || 150, heightPx: vobj.heightPx || DEFAULT_VOBJ_HEIGHT,
                        chsz: vobj.chsz || DEFAULT_FONT_SIZE, frcol: vobj.frcol || DEFAULT_FRCOL,
                        chcol: vobj.chcol || DEFAULT_CHCOL, tbcol: vobj.tbcol || DEFAULT_TBCOL,
                        bgcol: vobj.bgcol || DEFAULT_BGCOL, dlen: vobj.dlen || 0,
                        applist: vobj.applist || {},
                        originalVobjLeft: vobj.vobjleft, originalVobjTop: vobj.vobjtop,
                        offsetX: vobj.vobjleft - obj.vobjleft, offsetY: vobj.vobjtop - obj.vobjtop
                    };
                });
            } else {
                virtualObjects = [{
                    link_id: obj.link_id, link_name: obj.link_name,
                    width: obj.width || 150, heightPx: obj.heightPx || DEFAULT_VOBJ_HEIGHT,
                    chsz: obj.chsz || DEFAULT_FONT_SIZE, frcol: obj.frcol || DEFAULT_FRCOL,
                    chcol: obj.chcol || DEFAULT_CHCOL, tbcol: obj.tbcol || DEFAULT_TBCOL,
                    bgcol: obj.bgcol || DEFAULT_BGCOL, dlen: obj.dlen || 0,
                    applist: obj.applist || {}, offsetX: 0, offsetY: 0
                }];
            }

            const isDuplicateDrag = this.dblClickDragState.isDblClickDragCandidate || this.dblClickDragState.isDblClickDrag;
            this.setVirtualObjectDragData(e, virtualObjects, 'netbtron-object-list', isDuplicateDrag);
            e.dataTransfer.setData('application/x-vobj-window-id', this.windowId);
            vobjElement.style.opacity = '0.5';
        });

        vobjElement.addEventListener('drag', (e) => {
            if (!this.vobjDragState.currentObject) return;
            if (e.clientX === 0 && e.clientY === 0) return;

            const isSameWindowDrag = (this.vobjDragState.lastMouseOverWindowId === this.windowId);
            if (!isSameWindowDrag) return;

            this.detectVirtualObjectDragMove(e);

            const deltaX = e.clientX - this.virtualObjectDragState.startX;
            const deltaY = e.clientY - this.virtualObjectDragState.startY;

            const pluginContent = document.querySelector('#view-mode .plugin-content');
            const scrollDeltaX = pluginContent ? pluginContent.scrollLeft - this.vobjDragState.startScrollLeft : 0;
            const scrollDeltaY = pluginContent ? pluginContent.scrollTop - this.vobjDragState.startScrollTop : 0;

            if (this.vobjDragState.selectedObjects && this.vobjDragState.selectedObjectsInitialPositions) {
                this.vobjDragState.selectedObjects.forEach((item, index) => {
                    if (index >= this.vobjDragState.selectedObjectsInitialPositions.length) return;
                    const initialPos = this.vobjDragState.selectedObjectsInitialPositions[index];
                    if (!initialPos) return;
                    const newLeft = initialPos.left + deltaX + scrollDeltaX;
                    const newTop = initialPos.top + deltaY + scrollDeltaY;
                    const element = document.querySelector(`[data-vobj-index="${item.vobjIndex}"]`);
                    if (element) {
                        element.style.left = newLeft + 'px';
                        element.style.top = newTop + 'px';
                    }
                });
            }

            this.vobjDragState.currentDeltaX = deltaX;
            this.vobjDragState.currentDeltaY = deltaY;

            const iframe = window.frameElement;
            if (iframe && this.vobjDragState.isMouseInThisWindow) {
                const rect = iframe.getBoundingClientRect();
                const parentX = rect.left + e.clientX;
                const parentY = rect.top + e.clientY;
                this.messageBus.send('child-drag-position', {
                    windowId: this.windowId, clientX: parentX, clientY: parentY
                });
            }

            this.performEdgeScroll(e);
            this.vobjDragState.isMouseInThisWindow = false;
        });

        vobjElement.addEventListener('dragend', (e) => {
            vobjElement.style.opacity = '1';
            vobjElement.style.visibility = 'visible';

            const pluginContent = document.querySelector('#view-mode .plugin-content');
            if (pluginContent) pluginContent.style.overflow = 'auto';
            this.enableIframePointerEvents();
            this.edgeScrollState.isScrolling = false;

            if (e.dataTransfer.dropEffect === 'none') {
                if (pluginContent) {
                    pluginContent.scrollLeft = this.vobjDragState.startScrollLeft;
                    pluginContent.scrollTop = this.vobjDragState.startScrollTop;
                }
                if (this.vobjDragState.selectedObjects && this.vobjDragState.selectedObjectsInitialPositions) {
                    this.vobjDragState.selectedObjects.forEach((item, index) => {
                        const initialPos = this.vobjDragState.selectedObjectsInitialPositions[index];
                        const element = document.querySelector(`[data-vobj-index="${item.vobjIndex}"]`);
                        if (element) {
                            element.style.left = initialPos.left + 'px';
                            element.style.top = initialPos.top + 'px';
                            element.style.visibility = 'visible';
                        }
                    });
                } else {
                    vobjElement.style.left = this.vobjDragState.initialLeft + 'px';
                    vobjElement.style.top = this.vobjDragState.initialTop + 'px';
                }
                this.cleanupVirtualObjectDragState();
                this.cleanupDblClickDragState();
                this.vobjDragState.currentObject = null;
                this.vobjDragState.currentElement = null;
                this.vobjDragState.vobjIndex = null;
                this.vobjDragState.selectedObjects = null;
                this.vobjDragState.selectedObjectsInitialPositions = null;
                this.vobjDragState.dropClientX = undefined;
                this.vobjDragState.dropClientY = undefined;
                this.vobjDragState.lastMouseOverWindowId = null;
            } else {
                if (this.vobjDragState.dropClientX === undefined && e.clientX !== 0 && e.clientY !== 0) {
                    this.vobjDragState.dropClientX = e.clientX;
                    this.vobjDragState.dropClientY = e.clientY;
                }
                setTimeout(() => {
                    if (this.lastDropWasCrossWindow) {
                        this.cleanupVirtualObjectDragState();
                        this.cleanupDblClickDragState();
                        this.vobjDragState.currentObject = null;
                        this.vobjDragState.currentElement = null;
                        this.vobjDragState.vobjIndex = null;
                        this.vobjDragState.selectedObjects = null;
                        this.vobjDragState.selectedObjectsInitialPositions = null;
                        this.virtualObjectDragState.dragMode = null;
                        this.vobjDragState.dropClientX = undefined;
                        this.vobjDragState.dropClientY = undefined;
                        this.vobjDragState.lastMouseOverWindowId = null;
                        this.lastDropWasCrossWindow = false;
                    } else {
                        this.finishDrag();
                    }
                }, 50);
            }
        });

        vobjElement.addEventListener('mousedown', (e) => {
            const now = Date.now();
            const timeSinceLastClick = now - this.dblClickDragState.lastClickTime;
            const isSameObject = this.dblClickDragState.lastClickedObject === obj;

            if (timeSinceLastClick < 300 && isSameObject && e.button === 0) {
                this.setDoubleClickDragCandidate(vobjElement, e);
                this.dblClickDragState.dblClickedObject = obj;
            } else {
                this.resetDoubleClickTimer();
                this.dblClickDragState.lastClickedObject = obj;
            }

            if (this.justClosedContextMenu) return;
            if (this.isReadonly) return;
            if (obj.isFixed || obj.isBackground) return;

            const rect = vobjElement.getBoundingClientRect();
            const isRightEdge = e.clientX > rect.right - 10 && e.clientX <= rect.right + 10;
            const isBottomEdge = e.clientY > rect.bottom - 10 && e.clientY <= rect.bottom + 10;
            if (isRightEdge || isBottomEdge) return;
            if (e.button !== 0) return;

            this.setIframesPointerEvents(false);

            this.vobjDragState.currentObject = obj;
            this.vobjDragState.currentElement = vobjElement;
            this.vobjDragState.vobjIndex = parseInt(vobjElement.getAttribute('data-vobj-index'));
            if (isNaN(this.vobjDragState.vobjIndex)) return;
            this.vobjDragState.initialLeft = obj.vobjleft;
            this.vobjDragState.initialTop = obj.vobjtop;

            const draggedVobjIndex = this.vobjDragState.vobjIndex;
            if (this.selectedVirtualObjects.has(draggedVobjIndex)) {
                this.vobjDragState.selectedObjects = Array.from(this.selectedVirtualObjects).map(vobjIndex => {
                    const vobj = this.virtualObjects[vobjIndex];
                    if (vobj) return { obj: vobj, vobjIndex: vobjIndex };
                    return null;
                }).filter(v => v !== null && !v.obj.isFixed && !v.obj.isBackground);

                this.vobjDragState.selectedObjectsInitialPositions = this.vobjDragState.selectedObjects.map(v => ({
                    left: v.obj.vobjleft, top: v.obj.vobjtop
                }));
            } else {
                this.selectVirtualObject(obj, vobjElement, e, draggedVobjIndex);
                this.justSelectedInMouseDown = true;

                this.vobjDragState.selectedObjects = Array.from(this.selectedVirtualObjects).map(vobjIndex => {
                    const vobj = this.virtualObjects[vobjIndex];
                    if (vobj) return { obj: vobj, vobjIndex: vobjIndex };
                    return null;
                }).filter(v => v !== null && !v.obj.isFixed && !v.obj.isBackground);

                this.vobjDragState.selectedObjectsInitialPositions = this.vobjDragState.selectedObjects.map(v => ({
                    left: v.obj.vobjleft, top: v.obj.vobjtop
                }));
            }
        }, { capture: true });
    }

    finishDrag() {
        if (!this.vobjDragState.currentObject || !this.virtualObjectDragState.hasMoved) {
            this.cleanupVirtualObjectDragState();
            this.cleanupDblClickDragState();
            this.vobjDragState.currentObject = null;
            this.vobjDragState.currentElement = null;
            this.vobjDragState.vobjIndex = null;
            this.vobjDragState.selectedObjects = null;
            this.vobjDragState.selectedObjectsInitialPositions = null;
            this.vobjDragState.dropClientX = undefined;
            this.vobjDragState.dropClientY = undefined;
            this.vobjDragState.lastMouseOverWindowId = null;
            return;
        }

        // ダブルクリック+ドラッグ（実身複製）判定
        if (this.shouldStartDblClickDrag()) {
            const dropX = this.vobjDragState.currentObject.vobjleft + this.vobjDragState.currentDeltaX;
            const dropY = this.vobjDragState.currentObject.vobjtop + this.vobjDragState.currentDeltaY;
            this.handleDoubleClickDragDuplicate(dropX, dropY);
            this.cleanupVirtualObjectDragState();
            this.cleanupDblClickDragState();
            this.vobjDragState.currentObject = null;
            this.vobjDragState.currentElement = null;
            this.vobjDragState.vobjIndex = null;
            this.vobjDragState.selectedObjects = null;
            this.vobjDragState.selectedObjectsInitialPositions = null;
            this.vobjDragState.dropClientX = undefined;
            this.vobjDragState.dropClientY = undefined;
            this.vobjDragState.lastMouseOverWindowId = null;
            return;
        }

        // 通常のドラッグ移動
        const obj = this.vobjDragState.currentObject;
        const deltaX = this.vobjDragState.currentDeltaX;
        const deltaY = this.vobjDragState.currentDeltaY;

        const pluginContent = document.querySelector('#view-mode .plugin-content');
        const scrollDeltaX = pluginContent ? pluginContent.scrollLeft - this.vobjDragState.startScrollLeft : 0;
        const scrollDeltaY = pluginContent ? pluginContent.scrollTop - this.vobjDragState.startScrollTop : 0;

        // 複数選択時は全ての選択仮身を対象、それ以外は単一の仮身
        const objectsToMove = this.vobjDragState.selectedObjects
            ? this.vobjDragState.selectedObjects.map(item => item.obj)
            : (obj && !obj.isFixed && !obj.isBackground ? [obj] : []);

        if (this.virtualObjectDragState.dragMode === 'copy') {
            // コピーモード: 元の仮身を元の位置に戻し、新しい仮身を作成
            objectsToMove.forEach((sourceObj, index) => {
                const width = sourceObj.width || (sourceObj.vobjright - sourceObj.vobjleft);
                const height = sourceObj.heightPx || (sourceObj.vobjbottom - sourceObj.vobjtop);

                const initialLeft = this.vobjDragState.selectedObjectsInitialPositions?.[index]?.left || sourceObj.vobjleft;
                const initialTop = this.vobjDragState.selectedObjectsInitialPositions?.[index]?.top || sourceObj.vobjtop;
                const newLeft = initialLeft + deltaX + scrollDeltaX;
                const newTop = initialTop + deltaY + scrollDeltaY;

                const newObj = {
                    link_id: sourceObj.link_id,
                    link_name: sourceObj.link_name,
                    vobjleft: newLeft,
                    vobjtop: newTop,
                    vobjright: newLeft + width,
                    vobjbottom: newTop + height,
                    width: width,
                    heightPx: height,
                    chsz: sourceObj.chsz || DEFAULT_FONT_SIZE,
                    frcol: sourceObj.frcol || DEFAULT_FRCOL,
                    chcol: sourceObj.chcol || DEFAULT_CHCOL,
                    tbcol: sourceObj.tbcol || DEFAULT_TBCOL,
                    bgcol: sourceObj.bgcol || DEFAULT_BGCOL,
                    dlen: sourceObj.dlen || 0,
                    applist: sourceObj.applist || {},
                    pictdisp: sourceObj.pictdisp || 'true',
                    namedisp: sourceObj.namedisp || 'true',
                    roledisp: sourceObj.roledisp || 'false',
                    typedisp: sourceObj.typedisp || 'false',
                    updatedisp: sourceObj.updatedisp || 'false',
                    framedisp: sourceObj.framedisp || 'true',
                    autoopen: sourceObj.autoopen || 'false',
                    originalLeft: newLeft,
                    originalTop: newTop,
                    originalRight: newLeft + width,
                    originalBottom: newTop + height
                };

                this.virtualObjects.push(newObj);
                this.addVirtualObjectToXml(newObj);

                const insertAt = this.virtualObjects.length - 1;
                this.addVirtualObjectElement(newObj, insertAt);

                this.requestCopyVirtualObject(sourceObj.link_id);
            });
        } else {
            // 移動モード: 位置を更新
            objectsToMove.forEach((targetObj, index) => {
                const width = targetObj.vobjright - targetObj.vobjleft;
                const height = targetObj.vobjbottom - targetObj.vobjtop;

                const initialLeft = this.vobjDragState.selectedObjectsInitialPositions?.[index]?.left || targetObj.vobjleft;
                const initialTop = this.vobjDragState.selectedObjectsInitialPositions?.[index]?.top || targetObj.vobjtop;
                targetObj.vobjleft = Math.round(initialLeft + deltaX + scrollDeltaX);
                targetObj.vobjtop = Math.round(initialTop + deltaY + scrollDeltaY);
                targetObj.vobjright = targetObj.vobjleft + width;
                targetObj.vobjbottom = targetObj.vobjtop + height;
                this.updateVirtualObjectInXml(targetObj);
            });
        }

        this.updateCanvasSize();

        this.cleanupVirtualObjectDragState();
        this.cleanupDblClickDragState();
        this.vobjDragState.currentObject = null;
        this.vobjDragState.currentElement = null;
        this.vobjDragState.vobjIndex = null;
        this.vobjDragState.selectedObjects = null;
        this.vobjDragState.selectedObjectsInitialPositions = null;
        this.vobjDragState.dropClientX = undefined;
        this.vobjDragState.dropClientY = undefined;
        this.vobjDragState.lastMouseOverWindowId = null;
        this.virtualObjectDragState.dragMode = 'move';
    }

    performEdgeScroll(e) {
        const pluginContent = document.querySelector('#view-mode .plugin-content');
        if (!pluginContent) return;

        const rect = pluginContent.getBoundingClientRect();
        const edgeSize = 30;
        const scrollSpeed = 5;

        let scrollX = 0;
        let scrollY = 0;

        if (e.clientX < rect.left + edgeSize) scrollX = -scrollSpeed;
        else if (e.clientX > rect.right - edgeSize) scrollX = scrollSpeed;
        if (e.clientY < rect.top + edgeSize) scrollY = -scrollSpeed;
        else if (e.clientY > rect.bottom - edgeSize) scrollY = scrollSpeed;

        if (scrollX !== 0 || scrollY !== 0) {
            pluginContent.scrollLeft += scrollX;
            pluginContent.scrollTop += scrollY;
        }
    }

    // =========================================================
    // ビューモード: リサイズ
    // =========================================================

    makeVirtualObjectResizable(vobjElement, obj) {
        vobjElement.addEventListener('mousemove', (e) => {
            const rect = vobjElement.getBoundingClientRect();
            const isRightEdge = e.clientX > rect.right - 10 && e.clientX <= rect.right + 10;
            const isBottomEdge = e.clientY > rect.bottom - 10 && e.clientY <= rect.bottom + 10;

            if (isRightEdge && isBottomEdge) vobjElement.style.cursor = 'nwse-resize';
            else if (isRightEdge) vobjElement.style.cursor = 'ew-resize';
            else if (isBottomEdge) vobjElement.style.cursor = 'ns-resize';
            else vobjElement.style.cursor = 'pointer';
        });

        vobjElement.addEventListener('mouseleave', () => {
            vobjElement.style.cursor = 'pointer';
        });

        vobjElement.addEventListener('mousedown', (e) => {
            if (this.isReadonly) return;
            if (obj.isFixed || obj.isBackground) return;

            const rect = vobjElement.getBoundingClientRect();
            const isRightEdge = e.clientX > rect.right - 10 && e.clientX <= rect.right + 10;
            const isBottomEdge = e.clientY > rect.bottom - 10 && e.clientY <= rect.bottom + 10;
            if (!isRightEdge && !isBottomEdge) return;
            if (this.isResizing) return;

            e.preventDefault();
            e.stopPropagation();
            this.isResizing = true;
            this.setIframesPointerEvents(false);
            this.messageBus.send('disable-window-resize');

            const startX = e.clientX;
            const startY = e.clientY;
            const startWidth = rect.width;
            const startHeight = rect.height;
            const minWidth = 50;

            const chsz = Math.round(obj.chsz || DEFAULT_FONT_SIZE);
            const minClosedHeight = this.virtualObjectRenderer.getMinClosedHeight(chsz) + VOBJ_BORDER_WIDTH;
            const minOpenHeight = this.virtualObjectRenderer.getMinOpenHeight(chsz) + VOBJ_BORDER_WIDTH;
            const hasContentArea = vobjElement.querySelector('.virtual-object-content-area') !== null;
            const minHeight = minClosedHeight;

            let currentWidth = startWidth;
            let currentHeight = startHeight < minOpenHeight ? minClosedHeight : startHeight;

            const previewBox = document.createElement('div');
            previewBox.style.position = 'fixed';
            previewBox.style.left = `${rect.left}px`;
            previewBox.style.top = `${rect.top}px`;
            previewBox.style.width = `${currentWidth}px`;
            previewBox.style.height = `${currentHeight}px`;
            previewBox.style.border = '2px dashed rgba(0, 123, 255, 0.8)';
            previewBox.style.backgroundColor = 'rgba(0, 123, 255, 0.1)';
            previewBox.style.pointerEvents = 'none';
            previewBox.style.zIndex = '999999';
            previewBox.style.boxSizing = 'border-box';
            document.body.appendChild(previewBox);

            const onMouseMove = (moveEvent) => {
                if (isRightEdge) {
                    currentWidth = Math.max(minWidth, startWidth + moveEvent.clientX - startX);
                    previewBox.style.width = `${currentWidth}px`;
                }
                if (isBottomEdge) {
                    let newHeight = Math.max(minHeight, startHeight + moveEvent.clientY - startY);
                    currentHeight = newHeight < minOpenHeight ? minClosedHeight : newHeight;
                    previewBox.style.height = `${currentHeight}px`;
                }
            };

            const onMouseUp = () => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                if (previewBox.parentNode) previewBox.parentNode.removeChild(previewBox);
                vobjElement.style.cursor = 'pointer';

                const finalWidth = Math.round(currentWidth);
                const finalHeight = isBottomEdge ? Math.round(currentHeight) : Math.round(startHeight);

                vobjElement.style.width = `${finalWidth}px`;
                vobjElement.style.height = `${finalHeight}px`;

                const heightForSave = finalHeight - VOBJ_BORDER_WIDTH;
                obj.width = finalWidth;
                obj.heightPx = heightForSave;
                obj.vobjright = obj.vobjleft + finalWidth;
                obj.vobjbottom = obj.vobjtop + heightForSave;

                this.updateVirtualObjectInXml(obj);

                const chsz_resize = parseFloat(obj.chsz) || DEFAULT_FONT_SIZE;
                const minClosedHeight_resize = this.virtualObjectRenderer.getMinClosedHeight(chsz_resize);
                const wasOpen = hasContentArea;
                const isNowOpen = finalHeight > minClosedHeight_resize + VOBJ_BORDER_WIDTH;

                if (wasOpen !== isNowOpen) {
                    if (isNowOpen) {
                        obj.opened = true;
                    } else {
                        obj.opened = false;
                        obj.heightPx = minClosedHeight_resize;
                        obj.vobjbottom = obj.vobjtop + minClosedHeight_resize;
                        vobjElement.style.height = `${minClosedHeight_resize}px`;
                        this.updateVirtualObjectInXml(obj);
                    }

                    if (this.recreateVirtualObjectTimer) clearTimeout(this.recreateVirtualObjectTimer);
                    const elementToReplace = vobjElement;
                    let existingVobjIndex = parseInt(elementToReplace.getAttribute('data-vobj-index'));
                    if (isNaN(existingVobjIndex)) existingVobjIndex = this.virtualObjects.indexOf(obj);

                    this.recreateVirtualObjectTimer = setTimeout(() => {
                        if (!elementToReplace.parentNode) { this.recreateVirtualObjectTimer = null; return; }
                        const originalZIndex = elementToReplace.style.zIndex;
                        const newElement = this.createVirtualObjectElement(obj, existingVobjIndex);
                        elementToReplace.replaceWith(newElement);
                        if (originalZIndex) newElement.style.zIndex = originalZIndex;
                        if (isNowOpen) {
                            this.expandVirtualObject(newElement, obj, {
                                readonly: true, noScrollbar: true, bgcol: obj.bgcol
                            }).catch(err => { logger.error('[NetBtronViewer] 展開エラー:', err); });
                        }
                        this.recreateVirtualObjectTimer = null;
                    }, 150);
                }

                this.updateCanvasSize();
                this.messageBus.send('enable-window-resize');
                this.isResizing = false;
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    }

    // =========================================================
    // ビューモード: キーボードショートカット
    // =========================================================

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Escapeでビューモードから管理モードに戻る
            if (e.key === 'Escape' && this.isViewMode && !this.isReadonly) {
                e.preventDefault();
                this.exitViewMode();
                return;
            }

            // ビューモードでない場合はショートカット無効
            if (!this.isViewMode) return;

            if (e.ctrlKey && e.key === 'l') { e.preventDefault(); this.toggleFullscreen(); }
            else if (e.ctrlKey && e.key === 's') { e.preventDefault(); this.saveToFile(); }
            else if (e.ctrlKey && e.key === 'e') { e.preventDefault(); this.requestCloseWindow(); }
            else if (e.ctrlKey && e.key === 'o') { e.preventDefault(); this.openRealObjectWithDefaultApp(); }
            else if (e.ctrlKey && e.key === 'd') {
                e.preventDefault();
                if (this.selectedVirtualObjects.size > 0) this.showArrangeDialog();
            }
            else if (e.key === 'Delete') { e.preventDefault(); this.deleteSelectedVirtualObject(); }
            else if (e.ctrlKey && e.key === 'a') { e.preventDefault(); this.selectAllVirtualObjects(); }
            else if (e.ctrlKey && e.key === 'c') { e.preventDefault(); this.copySelectedVirtualObject(); }
            else if (e.ctrlKey && e.key === 'v') {
                e.preventDefault();
                this.pasteVirtualObject().catch(err => { logger.error('[NetBtronViewer] ペーストエラー:', err); });
            }
            else if (e.ctrlKey && e.key === 'x') { e.preventDefault(); this.cutSelectedVirtualObject(); }
        });
    }

    // =========================================================
    // ビューモード: XML操作
    // =========================================================

    serializeXmlDocument(xmlDoc) {
        const serializer = new XMLSerializer();
        let xmlString = serializer.serializeToString(xmlDoc);
        xmlString = xmlString.replace(/<link([^>]*)>[\s\S]*?<\/link>/g, '<link$1/>');
        xmlString = xmlString.replace(/></g, '>\r\n<');
        xmlString = xmlString.replace(/(\r\n)(\s*\r\n)+/g, '\r\n');
        return xmlString;
    }

    updateVirtualObjectInXml(virtualObj) {
        if (!this.xmlData) return;

        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(this.xmlData, 'text/xml');
            const linkElements = xmlDoc.getElementsByTagName('link');
            let linkElement = null;

            if (virtualObj._xmlIndex !== undefined && virtualObj._xmlIndex < linkElements.length) {
                linkElement = linkElements[virtualObj._xmlIndex];
            } else {
                for (let i = 0; i < linkElements.length; i++) {
                    const link = linkElements[i];
                    if (link.getAttribute('id') === virtualObj.link_id &&
                        (parseInt(link.getAttribute('vobjleft')) || 0) === (virtualObj.originalLeft ?? virtualObj.vobjleft) &&
                        (parseInt(link.getAttribute('vobjtop')) || 0) === (virtualObj.originalTop ?? virtualObj.vobjtop)) {
                        linkElement = link;
                        virtualObj._xmlIndex = i;
                        break;
                    }
                }
                if (!linkElement) {
                    for (let i = 0; i < linkElements.length; i++) {
                        if (linkElements[i].getAttribute('id') === virtualObj.link_id) {
                            linkElement = linkElements[i];
                            virtualObj._xmlIndex = i;
                            break;
                        }
                    }
                }
            }

            if (linkElement) {
                linkElement.setAttribute('vobjleft', virtualObj.vobjleft.toString());
                linkElement.setAttribute('vobjtop', virtualObj.vobjtop.toString());
                linkElement.setAttribute('vobjright', virtualObj.vobjright.toString());
                linkElement.setAttribute('vobjbottom', virtualObj.vobjbottom.toString());
                linkElement.setAttribute('height', (virtualObj.heightPx || DEFAULT_VOBJ_HEIGHT).toString());
                linkElement.setAttribute('chsz', (virtualObj.chsz || DEFAULT_FONT_SIZE).toString());
                linkElement.setAttribute('frcol', virtualObj.frcol || DEFAULT_FRCOL);
                linkElement.setAttribute('chcol', virtualObj.chcol || DEFAULT_CHCOL);
                linkElement.setAttribute('tbcol', virtualObj.tbcol || DEFAULT_TBCOL);
                linkElement.setAttribute('bgcol', virtualObj.bgcol || DEFAULT_BGCOL);
                linkElement.setAttribute('dlen', (virtualObj.dlen || 0).toString());

                if (virtualObj.pictdisp !== undefined) linkElement.setAttribute('pictdisp', virtualObj.pictdisp.toString());
                if (virtualObj.namedisp !== undefined) linkElement.setAttribute('namedisp', virtualObj.namedisp.toString());
                if (virtualObj.roledisp !== undefined) linkElement.setAttribute('roledisp', virtualObj.roledisp.toString());
                if (virtualObj.typedisp !== undefined) linkElement.setAttribute('typedisp', virtualObj.typedisp.toString());
                if (virtualObj.updatedisp !== undefined) linkElement.setAttribute('updatedisp', virtualObj.updatedisp.toString());
                if (virtualObj.framedisp !== undefined) linkElement.setAttribute('framedisp', virtualObj.framedisp.toString());
                if (virtualObj.autoopen !== undefined) linkElement.setAttribute('autoopen', virtualObj.autoopen.toString());

                if (virtualObj.isFixed) { linkElement.setAttribute('fixed', 'true'); } else { linkElement.removeAttribute('fixed'); }
                if (virtualObj.isBackground) { linkElement.setAttribute('background', 'true'); } else { linkElement.removeAttribute('background'); }

                if (virtualObj.linkRelationship && virtualObj.linkRelationship.length > 0) {
                    linkElement.setAttribute('relationship', virtualObj.linkRelationship.join(' '));
                } else if (linkElement.hasAttribute('relationship')) {
                    linkElement.removeAttribute('relationship');
                }

                // applist属性（起動可能アプリリスト）
                if (virtualObj.applist) {
                    const applistStr = typeof virtualObj.applist === 'string'
                        ? virtualObj.applist
                        : JSON.stringify(virtualObj.applist);
                    if (applistStr && applistStr !== '{}') {
                        linkElement.setAttribute('applist', applistStr);
                    }
                }

                // vobjid属性（必須）
                if (virtualObj.vobjid !== undefined) {
                    linkElement.setAttribute('vobjid', virtualObj.vobjid);
                }
                // scrollx/scrolly/zoomratio属性（常に出力）
                if (virtualObj.scrollx !== undefined) {
                    linkElement.setAttribute('scrollx', virtualObj.scrollx.toString());
                }
                if (virtualObj.scrolly !== undefined) {
                    linkElement.setAttribute('scrolly', virtualObj.scrolly.toString());
                }
                if (virtualObj.zoomratio !== undefined) {
                    linkElement.setAttribute('zoomratio', virtualObj.zoomratio.toString());
                }

                virtualObj.originalLeft = virtualObj.vobjleft;
                virtualObj.originalTop = virtualObj.vobjtop;
                virtualObj.originalRight = virtualObj.vobjright;
                virtualObj.originalBottom = virtualObj.vobjbottom;
            }

            this.xmlData = this.serializeXmlDocument(xmlDoc);
            this.notifyXmlDataChanged();
        } catch (error) {
            logger.error('[NetBtronViewer] xmlTAD更新エラー:', error);
        }
    }

    addVirtualObjectToXml(virtualObj) {
        if (!this.xmlData) return;

        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(this.xmlData, 'text/xml');

            // 新しい<link>要素を作成（共通メソッドを使用）
            const linkElement = xmlDoc.createElement('link');
            this.buildLinkElementAttributes(linkElement, virtualObj);
            // プラグイン固有属性：保護状態
            if (virtualObj.isFixed) linkElement.setAttribute('fixed', 'true');
            if (virtualObj.isBackground) linkElement.setAttribute('background', 'true');

            const figureElement = xmlDoc.getElementsByTagName('figure')[0];
            if (figureElement) {
                figureElement.appendChild(linkElement);
            } else {
                xmlDoc.documentElement.appendChild(linkElement);
            }

            const linkElements = xmlDoc.getElementsByTagName('link');
            virtualObj._xmlIndex = linkElements.length - 1;

            this.xmlData = this.serializeXmlDocument(xmlDoc);
            this.notifyXmlDataChanged();
        } catch (error) {
            logger.error('[NetBtronViewer] xmlTAD追加エラー:', error);
        }
    }

    removeVirtualObjectFromXml(virtualObj, xmlIndex) {
        if (!this.xmlData) return;

        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(this.xmlData, 'text/xml');
            const linkElements = xmlDoc.getElementsByTagName('link');

            if (xmlIndex === undefined) {
                xmlIndex = this.virtualObjects.indexOf(virtualObj);
            }

            if (xmlIndex >= 0 && xmlIndex < linkElements.length) {
                const linkElement = linkElements[xmlIndex];
                linkElement.parentNode.removeChild(linkElement);
            } else {
                return;
            }

            this.xmlData = this.serializeXmlDocument(xmlDoc);
            this.notifyXmlDataChanged();
        } catch (error) {
            logger.error('[NetBtronViewer] xmlTAD削除エラー:', error);
        }
    }

    reorderVirtualObjectsInXml() {
        if (!this.xmlData) return;

        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(this.xmlData, 'text/xml');

            const figureElement = xmlDoc.getElementsByTagName('figure')[0];
            const parentElement = figureElement || xmlDoc.documentElement;

            const linkElements = xmlDoc.getElementsByTagName('link');
            const linkArray = [];
            for (let i = 0; i < linkElements.length; i++) {
                linkArray.push(linkElements[i].cloneNode(true));
            }

            for (let i = linkElements.length - 1; i >= 0; i--) {
                linkElements[i].parentNode.removeChild(linkElements[i]);
            }

            const textNodes = [];
            for (let i = 0; i < parentElement.childNodes.length; i++) {
                if (parentElement.childNodes[i].nodeType === Node.TEXT_NODE) {
                    textNodes.push(parentElement.childNodes[i]);
                }
            }
            for (const textNode of textNodes) {
                parentElement.removeChild(textNode);
            }

            const usedIndices = new Set();
            for (const virtualObj of this.virtualObjects) {
                let linkElement = null;

                if (virtualObj._xmlIndex !== undefined && virtualObj._xmlIndex < linkArray.length && !usedIndices.has(virtualObj._xmlIndex)) {
                    linkElement = linkArray[virtualObj._xmlIndex];
                    usedIndices.add(virtualObj._xmlIndex);
                } else {
                    for (let i = 0; i < linkArray.length; i++) {
                        if (!usedIndices.has(i)) {
                            const link = linkArray[i];
                            if (link.getAttribute('id') === virtualObj.link_id &&
                                (parseInt(link.getAttribute('vobjleft')) || 0) === (virtualObj.originalLeft ?? virtualObj.vobjleft) &&
                                (parseInt(link.getAttribute('vobjtop')) || 0) === (virtualObj.originalTop ?? virtualObj.vobjtop)) {
                                linkElement = link;
                                usedIndices.add(i);
                                break;
                            }
                        }
                    }
                    if (!linkElement) {
                        for (let i = 0; i < linkArray.length; i++) {
                            if (!usedIndices.has(i) && linkArray[i].getAttribute('id') === virtualObj.link_id) {
                                linkElement = linkArray[i];
                                usedIndices.add(i);
                                break;
                            }
                        }
                    }
                }

                if (linkElement) {
                    parentElement.appendChild(linkElement);
                }
            }

            this.xmlData = this.serializeXmlDocument(xmlDoc);

            for (let i = 0; i < this.virtualObjects.length; i++) {
                this.virtualObjects[i]._xmlIndex = i;
            }
        } catch (error) {
            logger.error('[NetBtronViewer] xmlTAD順序更新エラー:', error);
        }
    }

    notifyXmlDataChanged() {
        this.saveScrollPosition();
        this.isModified = true;

        this.messageBus.send('xml-data-changed', {
            fileId: this.realId,
            xmlData: this.xmlData
        });
    }

    // =========================================================
    // ビューモード: 保存
    // =========================================================

    saveToFile() {
        if (!this.xmlData) return;
        this.notifyXmlDataChanged();
    }

    async saveAsNewRealObject() {
        if (!this.xmlData) return;

        if (this.selectedVirtualObjects.size !== 1) return;

        const selectedVobjIndex = Array.from(this.selectedVirtualObjects)[0];
        const selectedVobj = this.virtualObjects[selectedVobjIndex];
        if (!selectedVobj) return;

        this.notifyXmlDataChanged();

        const messageId = this.generateMessageId('save-as-new');
        this.messageBus.send('save-as-new-real-object', {
            realId: this.realId,
            messageId: messageId
        });

        try {
            const result = await this.messageBus.waitFor('save-as-new-real-object-completed', 0, (data) => {
                return data.messageId === messageId;
            });

            if (result.cancelled) {
                return;
            } else if (result.success) {
                const newTop = selectedVobj.vobjbottom + 10;
                const newBottom = selectedVobj.vobjbottom + 10 + (selectedVobj.vobjbottom - selectedVobj.vobjtop);
                const newVirtualObj = {
                    link_id: result.newRealId,
                    link_name: result.newName,
                    vobjleft: selectedVobj.vobjleft,
                    vobjtop: newTop,
                    vobjright: selectedVobj.vobjright,
                    vobjbottom: newBottom,
                    originalLeft: selectedVobj.vobjleft,
                    originalTop: newTop,
                    originalRight: selectedVobj.vobjright,
                    originalBottom: newBottom,
                    width: selectedVobj.width,
                    heightPx: selectedVobj.heightPx,
                    chsz: selectedVobj.chsz || DEFAULT_FONT_SIZE,
                    frcol: selectedVobj.frcol || DEFAULT_FRCOL,
                    chcol: selectedVobj.chcol || DEFAULT_CHCOL,
                    tbcol: selectedVobj.tbcol || DEFAULT_TBCOL,
                    bgcol: selectedVobj.bgcol || DEFAULT_BGCOL,
                    dlen: selectedVobj.dlen || 0,
                    applist: selectedVobj.applist || {},
                    pictdisp: selectedVobj.pictdisp || 'true',
                    namedisp: selectedVobj.namedisp || 'true',
                    roledisp: selectedVobj.roledisp || 'false',
                    typedisp: selectedVobj.typedisp || 'false',
                    updatedisp: selectedVobj.updatedisp || 'false',
                    framedisp: selectedVobj.framedisp || 'true',
                    autoopen: selectedVobj.autoopen || 'false'
                };

                this.addVirtualObjectToXml(newVirtualObj);
                this.virtualObjects.push(newVirtualObj);
                this.renderVirtualObjects();
            }
        } catch (error) {
            logger.error('[NetBtronViewer] 新たな実身への保存エラー:', error);
        }
    }

    /**
     * XTAD内の<link>が参照する子孫実身を再帰的にクラウドにアップロード
     * BFS（幅優先探索）で全階層の子孫実身を走査し、それぞれの
     * データファイル（json/xtad/ico）をアップロードする。
     * 循環参照はprocessedIdsで防止。安全上限はMAX_CHILD_UPLOAD_OBJECTS件。
     */
    async uploadChildRealObjects(tenantId) {
        // Phase 3: フォアグラウンド保存中はバックグラウンドキューを一時停止
        if (this.backgroundUploadManager) {
            this.backgroundUploadManager.pause();
        }

        const MAX_OBJECTS = MAX_CHILD_UPLOAD_OBJECTS;
        const CONCURRENCY = 3;
        const processedIds = new Set();

        // 親実身IDを処理済みに追加（再アップロード防止）
        if (this.cloudRealObjectId) {
            processedIds.add(this.cloudRealObjectId);
        }

        let uploaded = 0;
        let failed = 0;
        let conflicted = 0;
        let skipped = 0;

        // 直接の子実身をキューに追加（this.virtualObjectsから）
        const queue = [];
        if (this.virtualObjects) {
            for (const vobj of this.virtualObjects) {
                if (!vobj.link_id) continue;
                const childRealId = this.extractRealId(vobj.link_id);
                if (childRealId && !processedIds.has(childRealId)) {
                    queue.push({ realId: childRealId, name: vobj.link_name || '', parentId: this.cloudRealObjectId });
                }
            }
        }

        if (queue.length === 0) {
            if (this.backgroundUploadManager) this.backgroundUploadManager.resume();
            return { uploaded: 0, failed: 0, conflicted: 0, skipped: 0 };
        }

        // Phase 2: BFS走査前に全子孫IDを収集し、メタデータを一括取得
        if (this.xmlData && this.cloudChildrenData) {
            try {
                const allDescendantIds = await this.collectAllDescendantIds(this.xmlData, processedIds);
                if (allDescendantIds.size > 0) {
                    const unknownIds = [...allDescendantIds].filter(id => !this.cloudChildrenData.has(id));
                    if (unknownIds.length > 0) {
                        const metaResult = await window.cloudAPI.getRealObjectsMetadata(tenantId, unknownIds);
                        if (metaResult.success && metaResult.realObjects) {
                            for (const dbRow of metaResult.realObjects) {
                                this.cloudChildrenData.set(dbRow.id, dbRow);
                            }
                        }
                    }
                }
            } catch (e) {
                logger.debug('[NetBtronViewer] 先行取得失敗（BFSループ内でフォールバック）:', e.message);
            }
        }

        // BFSバッチ並列処理で全階層を走査
        while (queue.length > 0) {
            if (uploaded + failed >= MAX_OBJECTS) {
                logger.warn('[NetBtronViewer] 子実身アップロード上限到達:', MAX_OBJECTS);
                break;
            }

            // キューから最大CONCURRENCY件を取り出し（processedIdsチェック付き）
            const batch = [];
            while (batch.length < CONCURRENCY && queue.length > 0) {
                const item = queue.shift();
                if (processedIds.has(item.realId)) continue;
                processedIds.add(item.realId);
                if (uploaded + failed + batch.length >= MAX_OBJECTS) break;
                batch.push(item);
            }

            if (batch.length === 0) continue;

            // バッチ内の子実身を並列処理
            const batchResults = await Promise.allSettled(
                batch.map(item => this.processOneChildUpload(tenantId, item))
            );

            // 結果集計 + 孫実身のキュー追加
            const allNewIds = [];
            for (let i = 0; i < batchResults.length; i++) {
                const result = batchResults[i];
                if (result.status === 'fulfilled') {
                    const r = result.value;
                    switch (r.status) {
                        case 'uploaded': uploaded++; break;
                        case 'failed': failed++; break;
                        case 'conflicted': conflicted++; break;
                        case 'skipped': skipped++; break;
                    }
                    // 発見された孫実身をキューに追加
                    if (r.nestedLinks && r.nestedLinks.length > 0) {
                        for (const linkInfo of r.nestedLinks) {
                            if (!processedIds.has(linkInfo.realId)) {
                                queue.push({ ...linkInfo, parentId: batch[i].realId });
                                allNewIds.push(linkInfo.realId);
                            }
                        }
                    }
                } else {
                    failed++;
                }
            }

            // 未知IDのクラウドメタデータ一括取得（フォールバック: Phase 2で漏れたID分）
            if (allNewIds.length > 0 && this.cloudChildrenData) {
                const unknownIds = allNewIds.filter(id => !this.cloudChildrenData.has(id));
                if (unknownIds.length > 0) {
                    try {
                        const metaResult = await window.cloudAPI.getRealObjectsMetadata(tenantId, unknownIds);
                        if (metaResult.success && metaResult.realObjects) {
                            for (const dbRow of metaResult.realObjects) {
                                this.cloudChildrenData.set(dbRow.id, dbRow);
                            }
                        }
                    } catch (e) { logger.debug('[NetBtronViewer] 安全側（新規として扱われる）:', e.message); }
                }
            }
        }

        // Phase 3: バックグラウンドキューを再開
        if (this.backgroundUploadManager) {
            this.backgroundUploadManager.resume();
        }

        return { uploaded, failed, conflicted, skipped };
    }

    /**
     * 1件の子実身アップロード処理（バッチ並列処理用）
     * @param {string} tenantId
     * @param {{realId: string, name: string, parentId: string}} item - キューアイテム
     * @returns {{status: string, xtadString: string|null, nestedLinks: Array}}
     */
    async processOneChildUpload(tenantId, item) {
        const { realId, name, parentId } = item;
        let xtadString = null;
        let nestedLinks = [];

        try {
            // Phase 3: バックグラウンドで既にアップロード済みならスキップ
            if (this.backgroundUploadManager && this.backgroundUploadManager.isCompleted(realId)) {
                try {
                    const xtadFile = await this.loadDataFileFromParent(realId + '_0.xtad');
                    if (xtadFile) {
                        xtadString = await xtadFile.text();
                        nestedLinks = this.extractLinkIdsFromXtad(xtadString);
                    }
                } catch (e) { logger.debug('[NetBtronViewer] 非致命的エラー:', e.message); }
                return { status: 'skipped', xtadString, nestedLinks };
            }

            // ローカルJSONファイルを読み込みメタデータを取得
            let localMetadata = null;
            try {
                const jsonFile = await this.loadDataFileFromParent(realId + '.json');
                if (jsonFile) {
                    const jsonText = await jsonFile.text();
                    localMetadata = JSON.parse(jsonText);
                }
            } catch (e) { logger.debug('[NetBtronViewer] ファイルが見つからない:', e.message); }

            if (!localMetadata) {
                if (!(this.cloudChildrenData && this.cloudChildrenData.has(realId))) {
                    return { status: 'failed', xtadString: null, nestedLinks: [] };
                }
                return { status: 'skipped', xtadString: null, nestedLinks: [] };
            }

            // 差分判定: ローカルとクラウドのupdateDateを比較
            const cloudData = this.cloudChildrenData ? this.cloudChildrenData.get(realId) : null;
            let needsUpload = true;

            if (cloudData) {
                const cloudUpdateDate = cloudData.metadata?.updateDate;
                const localUpdateDate = localMetadata.updateDate;
                if (cloudUpdateDate && localUpdateDate) {
                    needsUpload = new Date(localUpdateDate) > new Date(cloudUpdateDate);
                }
            }

            if (needsUpload) {
                // 変更あり or 新規: load-real-objectでフルデータを取得してアップロード
                const messageId = this.generateMessageId('upload-child');
                this.messageBus.send('load-real-object', { realId, messageId });
                const loadResult = await this.messageBus.waitFor('real-object-loaded', 10000,
                    (data) => data.messageId === messageId);

                if (!loadResult || !loadResult.realObject) {
                    return { status: 'failed', xtadString: null, nestedLinks: [] };
                }

                const realObject = loadResult.realObject;
                const metadata = { ...(realObject.metadata || {}) };
                metadata.id = realId;
                metadata.name = metadata.name || name || realId;
                if (parentId) {
                    metadata.parent_id = parentId;
                }

                xtadString = realObject.records && realObject.records[0]
                    ? realObject.records[0].xtad : null;

                const files = {
                    json: Array.from(new TextEncoder().encode(JSON.stringify(metadata, null, 2))),
                    xtad: xtadString
                        ? Array.from(new TextEncoder().encode(xtadString))
                        : null,
                    ico: null,
                    images: []
                };

                // アイコンを読み込み
                try {
                    const icoFile = await this.loadDataFileFromParent(realId + '.ico');
                    if (icoFile) {
                        const icoBuffer = await icoFile.arrayBuffer();
                        files.ico = Array.from(new Uint8Array(icoBuffer));
                    }
                } catch (e) { logger.debug('[NetBtronViewer] アイコン読み込み失敗:', e.message); }

                // 画像ファイルを収集
                if (realObject.images && Array.isArray(realObject.images)) {
                    for (const img of realObject.images) {
                        if (img.name && img.data) {
                            files.images.push({
                                name: img.name,
                                data: Array.isArray(img.data) ? img.data : Array.from(new Uint8Array(img.data))
                            });
                        }
                    }
                }

                if (!files.xtad) {
                    return { status: 'failed', xtadString: null, nestedLinks: [] };
                }

                // クラウドにアップロード（バージョン管理付き保存）
                const expectedVer = (cloudData && cloudData.version) ? cloudData.version : 0;
                const versionedResult = await window.cloudAPI.saveRealObjectWithVersion(
                    tenantId, { metadata }, files, expectedVer
                );

                if (versionedResult.success) {
                    if (versionedResult.realObject) {
                        this.cloudChildrenData.set(realId, versionedResult.realObject);
                    }
                    if (xtadString) nestedLinks = this.extractLinkIdsFromXtad(xtadString);
                    return { status: 'uploaded', xtadString, nestedLinks };
                } else if (versionedResult.conflict) {
                    logger.warn('[NetBtronViewer] 子実身バージョン競合（スキップ）:', realId);
                    if (xtadString) nestedLinks = this.extractLinkIdsFromXtad(xtadString);
                    return { status: 'conflicted', xtadString, nestedLinks };
                } else {
                    logger.warn('[NetBtronViewer] 子実身アップロード失敗:', realId, versionedResult.error);
                    return { status: 'failed', xtadString: null, nestedLinks: [] };
                }
            } else {
                // 変更なし: アップロードスキップ、XTADのみ軽量読み込み（link抽出用）
                try {
                    const xtadFile = await this.loadDataFileFromParent(realId + '_0.xtad');
                    if (xtadFile) {
                        xtadString = await xtadFile.text();
                    }
                } catch (e) { logger.debug('[NetBtronViewer] XTAD読み込み失敗:', e.message); }

                if (xtadString) nestedLinks = this.extractLinkIdsFromXtad(xtadString);
                return { status: 'skipped', xtadString, nestedLinks };
            }
        } catch (error) {
            logger.warn('[NetBtronViewer] 子実身処理エラー:', realId, error.message);
            return { status: 'failed', xtadString: null, nestedLinks: [] };
        }
    }

    /**
     * ローカルXTADを再帰的にBFS走査し、全子孫のrealIdを収集する（Phase 2: 先行メタデータ準備用）
     * @param {string} xtadString - 起点のXTAD文字列
     * @param {Set<string>} processedIds - 既に処理済みのID（循環参照防止）
     * @returns {Promise<Set<string>>} 全子孫の realId セット
     */
    async collectAllDescendantIds(xtadString, processedIds) {
        const allIds = new Set();
        const visited = new Set(processedIds);
        const scanQueue = [xtadString];

        while (scanQueue.length > 0) {
            const currentXtad = scanQueue.shift();
            if (!currentXtad) continue;

            const links = this.extractLinkIdsFromXtad(currentXtad);
            for (const linkInfo of links) {
                const { realId } = linkInfo;
                if (visited.has(realId)) continue;
                visited.add(realId);
                allIds.add(realId);

                // 孫以降のリンクを探すためにローカルXTADを読み込む
                try {
                    const xtadFile = await this.loadDataFileFromParent(realId + '_0.xtad');
                    if (xtadFile) {
                        const childXtad = await xtadFile.text();
                        scanQueue.push(childXtad);
                    }
                } catch (e) {
                    logger.debug('[NetBtronViewer] 読み込み失敗（該当子実身の孫は走査されないのみ）:', e.message);
                }
            }
        }

        return allIds;
    }

    /**
     * XTAD XML文字列から<link>要素のrealIdを抽出する
     * @param {string} xtadString - XTAD XMLの文字列
     * @returns {Array<{realId: string, name: string}>} リンク情報の配列
     */
    extractLinkIdsFromXtad(xtadString) {
        const links = [];
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(xtadString, 'text/xml');
            const linkElements = doc.getElementsByTagName('link');
            for (let i = 0; i < linkElements.length; i++) {
                const linkEl = linkElements[i];
                const linkId = linkEl.getAttribute('id');
                if (linkId) {
                    const realId = this.extractRealId(linkId);
                    if (realId) {
                        const name = linkEl.getAttribute('name') || linkEl.getAttribute('title') || '';
                        links.push({ realId, name });
                    }
                }
            }
        } catch (e) {
            logger.debug('[NetBtronViewer] XMLパースエラー（linkなしとして扱う）:', e.message);
        }
        return links;
    }

    /**
     * XTAD内の子実身メタデータをクラウドから一括ダウンロードし、cloudChildrenDataに格納
     * @param {string} xtadData - 親実身のXTAD文字列
     */
    async downloadChildrenMetadata(xtadData) {
        if (!xtadData || !this.currentTenantId) return;

        const childLinks = this.extractLinkIdsFromXtad(xtadData);
        if (childLinks.length === 0) return;

        // 重複を除去し、親自身を除外
        const uniqueChildIds = [...new Set(childLinks.map(l => l.realId))]
            .filter(id => id !== this.cloudRealObjectId);
        if (uniqueChildIds.length === 0) return;

        try {
            const result = await window.cloudAPI.getRealObjectsMetadata(
                this.currentTenantId, uniqueChildIds
            );
            if (result.success && result.realObjects) {
                for (const dbRow of result.realObjects) {
                    this.cloudChildrenData.set(dbRow.id, dbRow);
                }
            }
        } catch (e) {
            logger.warn('[NetBtronViewer] 子実身メタデータ一括取得失敗:', e.message);
        }
    }

    /**
     * 子実身のアイコンをクラウドからダウンロードしてローカルにキャッシュ
     * 親ウィンドウにMessageBusで依頼し、ローカルファイルとして保存する
     * 保存後は既存のIconCacheManager経由のアイコン読み込みフローで表示される
     */
    async downloadChildrenIcons() {
        if (!this.currentTenantId || !this.cloudChildrenData || this.cloudChildrenData.size === 0) return;

        const realIds = Array.from(this.cloudChildrenData.keys());
        const messageId = this.generateMessageId('cache-icons');

        this.messageBus.send('cache-cloud-icons', {
            tenantId: this.currentTenantId,
            realIds,
            messageId
        });

        try {
            await this.messageBus.waitFor('cloud-icons-cached', 30000,
                (data) => data.messageId === messageId
            );
        } catch (e) {
            logger.debug('[NetBtronViewer] タイムアウト（アイコンなしで表示を続行）:', e.message);
        }
    }

    async saveToCloud() {
        if (!this.xmlData) {
            logger.warn('[NetBtronViewer] saveToCloud: xmlDataなし');
            this.setStatus('保存するデータがありません');
            return;
        }
        if (!this.currentTenantId) {
            logger.warn('[NetBtronViewer] saveToCloud: テナント未接続');
            this.setStatus('クラウド未接続: 管理モードでログインしてから保存してください');
            return;
        }
        if (!this.cloudRealObjectId) {
            logger.warn('[NetBtronViewer] saveToCloud: cloudRealObjectId未設定');
            this.setStatus('クラウド実身が未選択: クラウド実身を開いてから保存してください');
            return;
        }

        // 保存前容量チェック
        try {
            const quotaResult = await window.cloudAPI.getTenantQuota(this.currentTenantId);
            if (quotaResult.success && quotaResult.quota) {
                const q = quotaResult.quota;
                if (q.storage_pct >= 100) {
                    const limitMB = (q.storage_limit / (1024 * 1024)).toFixed(1);
                    const usedMB = (q.storage_used / (1024 * 1024)).toFixed(1);
                    const answer = await this.showMessageDialog(
                        '容量が不足しています。\n' +
                        '使用量: ' + usedMB + 'MB / ' + limitMB + 'MB (' + q.storage_pct + '%)\n\n' +
                        'それでも保存を続行しますか？',
                        [
                            { label: '続行', value: 'yes' },
                            { label: '取消', value: 'no' }
                        ],
                        1
                    );
                    if (answer !== 'yes') {
                        this.setStatus('容量不足のため保存を中断しました');
                        return;
                    }
                } else if (q.storage_pct >= 90) {
                    this.setStatus('警告: ストレージ使用率が' + q.storage_pct + '%です');
                }
            }
        } catch (quotaError) {
            logger.debug('[NetBtronViewer] 容量チェック失敗（保存を妨げない）:', quotaError.message);
        }

        this.setStatus('クラウドに保存中...');
        try {
            const xtadBytes = Array.from(new TextEncoder().encode(this.xmlData));
            const metadata = this.cloudMetadata || {};

            // メタデータを現在のXTADデータから更新
            const updatedMetadata = {
                ...metadata,
                id: this.cloudRealObjectId,
                name: metadata.name,
                ref_count: metadata.ref_count || 1,
                record_count: metadata.record_count || 1,
                updateDate: new Date().toISOString()
            };

            const files = {
                xtad: xtadBytes,
                json: this.cloudFiles ? this.cloudFiles.json : null,
                ico: this.cloudFiles ? this.cloudFiles.ico : null,
                images: this.cloudFiles && this.cloudFiles.images ? this.cloudFiles.images : []
            };

            // バージョン管理付き保存（楽観的排他制御 + 履歴記録）
            const uploadResult = await window.cloudAPI.saveRealObjectWithVersion(
                this.currentTenantId, { metadata: updatedMetadata }, files, this.cloudVersion
            );

            if (uploadResult.success) {
                this.isModified = false;
                // バージョンを更新
                if (uploadResult.realObject) {
                    this.cloudVersion = uploadResult.realObject.version;
                    this.cloudMetadata = uploadResult.realObject;
                }
                // キャッシュ鮮度情報を更新（再オープン時のビューモード自動復帰用）
                this.saveLastViewInfo();
                // 子実身（XTAD内のlinkが参照する実身）もアップロード
                const childResult = await this.uploadChildRealObjects(this.currentTenantId);
                if (childResult.uploaded > 0 || childResult.conflicted > 0 || childResult.skipped > 0) {
                    let childStatus = '';
                    if (childResult.uploaded > 0) {
                        childStatus += '子実身' + childResult.uploaded + '件';
                    }
                    if (childResult.skipped > 0) {
                        childStatus += (childStatus ? '、' : '') + 'スキップ' + childResult.skipped + '件';
                    }
                    if (childResult.conflicted > 0) {
                        childStatus += (childStatus ? '、' : '') + '競合スキップ' + childResult.conflicted + '件';
                    }
                    this.setStatus('クラウドに保存しました（v' + this.cloudVersion + '、' + childStatus + '）');
                } else {
                    this.setStatus('クラウドに保存しました（v' + this.cloudVersion + '）');
                }
            } else if (uploadResult.conflict) {
                // バージョン競合ダイアログ
                const answer = await this.showMessageDialog(
                    '他のユーザーが先に変更を保存しました。\n上書きしますか？',
                    [
                        { label: '上書き保存', value: 'overwrite' },
                        { label: '取消', value: 'cancel' }
                    ],
                    1
                );
                if (answer === 'overwrite') {
                    // N-7修正: 最新バージョンを取得してバージョン管理付き保存に統一（legacy upsertパス廃止）
                    let latestVersion = 0;
                    try {
                        const histResult = await window.cloudAPI.getVersionHistory(
                            this.currentTenantId, this.cloudRealObjectId, 1
                        );
                        if (histResult.success && histResult.versions && histResult.versions.length > 0) {
                            latestVersion = histResult.versions[0].version;
                        }
                    } catch (e) {
                        logger.warn('[NetBtronViewer] 最新バージョン取得失敗、version=0で試行:', e.message);
                    }
                    const forceResult = await window.cloudAPI.saveRealObjectWithVersion(
                        this.currentTenantId, { metadata: updatedMetadata }, files, latestVersion
                    );
                    if (forceResult.success) {
                        this.isModified = false;
                        if (forceResult.realObject) {
                            this.cloudVersion = forceResult.realObject.version;
                            this.cloudMetadata = forceResult.realObject;
                        }
                        if (forceResult.newVersion) {
                            this.cloudVersion = forceResult.newVersion;
                        }
                        // キャッシュ鮮度情報を更新（再オープン時のビューモード自動復帰用）
                        this.saveLastViewInfo();
                        const childResult2 = await this.uploadChildRealObjects(this.currentTenantId);
                        if (childResult2.uploaded > 0 || childResult2.conflicted > 0 || childResult2.skipped > 0) {
                            let childStatus2 = '';
                            if (childResult2.uploaded > 0) {
                                childStatus2 += '子実身' + childResult2.uploaded + '件';
                            }
                            if (childResult2.skipped > 0) {
                                childStatus2 += (childStatus2 ? '、' : '') + 'スキップ' + childResult2.skipped + '件';
                            }
                            if (childResult2.conflicted > 0) {
                                childStatus2 += (childStatus2 ? '、' : '') + '競合スキップ' + childResult2.conflicted + '件';
                            }
                            this.setStatus('クラウドに上書き保存しました（v' + this.cloudVersion + '、' + childStatus2 + '）');
                        } else {
                            this.setStatus('クラウドに上書き保存しました（v' + this.cloudVersion + '）');
                        }
                    } else {
                        logger.error('[NetBtronViewer] クラウド上書き保存失敗:', forceResult.error);
                        this.setStatus('クラウド保存失敗: ' + forceResult.error);
                    }
                }
            } else {
                // RPC関数が未デプロイの場合、バージョン管理なしで自動フォールバック
                if (uploadResult.error && (uploadResult.error.includes('function') || uploadResult.error.includes('rpc'))) {
                    logger.warn('[NetBtronViewer] バージョン管理付き保存が利用できません。バージョン管理なしで保存します:', uploadResult.error);
                    const fallbackResult = await window.cloudAPI.uploadRealObject(
                        this.currentTenantId, { metadata: updatedMetadata }, files
                    );
                    if (fallbackResult.success) {
                        this.isModified = false;
                        if (fallbackResult.realObject) {
                            this.cloudVersion = fallbackResult.realObject.version;
                            this.cloudMetadata = fallbackResult.realObject;
                        }
                        // キャッシュ鮮度情報を更新（再オープン時のビューモード自動復帰用）
                        this.saveLastViewInfo();
                        const childResult3 = await this.uploadChildRealObjects(this.currentTenantId);
                        if (childResult3.uploaded > 0 || childResult3.conflicted > 0 || childResult3.skipped > 0) {
                            let childStatus3 = '';
                            if (childResult3.uploaded > 0) {
                                childStatus3 += '子実身' + childResult3.uploaded + '件';
                            }
                            if (childResult3.skipped > 0) {
                                childStatus3 += (childStatus3 ? '、' : '') + 'スキップ' + childResult3.skipped + '件';
                            }
                            if (childResult3.conflicted > 0) {
                                childStatus3 += (childStatus3 ? '、' : '') + '競合スキップ' + childResult3.conflicted + '件';
                            }
                            this.setStatus('クラウドに保存しました（バージョン管理なし、' + childStatus3 + '）');
                        } else {
                            this.setStatus('クラウドに保存しました（バージョン管理なし）');
                        }
                    } else {
                        logger.error('[NetBtronViewer] クラウド保存失敗（フォールバック）:', fallbackResult.error);
                        this.setStatus('クラウド保存失敗: ' + fallbackResult.error);
                    }
                } else {
                    logger.error('[NetBtronViewer] クラウド保存失敗:', uploadResult.error);
                    this.setStatus('クラウド保存失敗: ' + uploadResult.error);
                }
            }
        } catch (error) {
            logger.error('[NetBtronViewer] クラウド保存例外:', error);
            this.setStatus('クラウド保存失敗: ' + error.message);
        }
    }

    // =========================================================
    // ビューモード: 編集操作
    // =========================================================

    deleteSelectedVirtualObject() {
        const selectedVirtualObject = this.getSelectedVirtualObject();
        if (!selectedVirtualObject) return;
        if (selectedVirtualObject.isFixed || selectedVirtualObject.isBackground) return;

        const realId = selectedVirtualObject.link_id;
        const index = this.virtualObjects.findIndex(obj => obj === selectedVirtualObject);

        this.removeVirtualObjectFromXml(selectedVirtualObject, index);

        if (index !== -1) {
            this.removeVirtualObjectElement(index);
            this.virtualObjects.splice(index, 1);
        }

        this.selectedVirtualObjects.clear();
        this.synchronizeAfterArrayChange();
        this.updateCanvasSize();
        this.requestDeleteVirtualObject(realId);
    }

    copySelectedVirtualObject() {
        const selectedObjects = this.getSelectedVirtualObjects();
        if (selectedObjects.length === 0) return;

        const clipboardData = selectedObjects.map(obj => JSON.parse(JSON.stringify(obj)));
        this.messageBus.send('set-clipboard', {
            clipboardData: clipboardData,
            dataType: 'virtual-objects'
        });
    }

    async pasteVirtualObject() {
        const clipboard = await this.getClipboard();
        if (!clipboard) return;

        const sourceObjects = Array.isArray(clipboard) ? clipboard : [clipboard];
        const newIndices = [];

        for (let i = 0; i < sourceObjects.length; i++) {
            const sourceObj = sourceObjects[i];
            const newVirtualObj = JSON.parse(JSON.stringify(sourceObj));
            const offset = 20 + (i * 10);
            newVirtualObj.vobjleft += offset;
            newVirtualObj.vobjtop += offset;
            newVirtualObj.vobjright += offset;
            newVirtualObj.vobjbottom += offset;
            newVirtualObj.originalLeft = newVirtualObj.vobjleft;
            newVirtualObj.originalTop = newVirtualObj.vobjtop;
            newVirtualObj.originalRight = newVirtualObj.vobjright;
            newVirtualObj.originalBottom = newVirtualObj.vobjbottom;

            const realId = newVirtualObj.link_id;
            this.virtualObjects.push(newVirtualObj);
            this.addVirtualObjectToXml(newVirtualObj);
            await this.loadVirtualObjectMetadata(newVirtualObj);
            newIndices.push(this.virtualObjects.length - 1);
            this.requestCopyVirtualObject(realId);
        }

        this.selectedVirtualObjects.clear();
        newIndices.forEach(idx => this.selectedVirtualObjects.add(idx));
        this.notifyXmlDataChanged();
        this.renderVirtualObjects();
        this.updateCanvasSize();
    }

    cutSelectedVirtualObject() {
        const selectedObjects = this.getSelectedVirtualObjects();
        if (selectedObjects.length === 0) return;

        const cuttableObjects = selectedObjects.filter(obj => !obj.isFixed && !obj.isBackground);
        if (cuttableObjects.length === 0) return;

        const clipboardData = cuttableObjects.map(obj => JSON.parse(JSON.stringify(obj)));
        this.messageBus.send('set-clipboard', {
            clipboardData: clipboardData,
            dataType: 'virtual-objects'
        });

        for (const obj of cuttableObjects) {
            const currentIndex = this.virtualObjects.indexOf(obj);
            if (currentIndex !== -1) {
                this.removeVirtualObjectFromXml(obj, currentIndex);
                this.removeVirtualObjectElement(currentIndex);
                this.virtualObjects.splice(currentIndex, 1);
                this.requestDeleteVirtualObject(obj.link_id);
            }
        }

        this.selectedVirtualObjects.clear();
        this.updateVobjIndices();
        this.updateCanvasSize();
        this.synchronizeAfterArrayChange();
    }

    moveSelectedVirtualObjectToFront() {
        const selectedVirtualObject = this.getSelectedVirtualObject();
        if (!selectedVirtualObject) return;
        if (selectedVirtualObject.isBackground) return;

        for (let i = 0; i < this.virtualObjects.length; i++) {
            this.virtualObjects[i]._xmlIndex = i;
        }

        this.preserveSelection(() => {
            const index = this.virtualObjects.indexOf(selectedVirtualObject);
            if (index !== -1) {
                this.virtualObjects.splice(index, 1);
                this.virtualObjects.push(selectedVirtualObject);
            }
        });

        this.reorderVirtualObjectsInXml();
        this.renderVirtualObjects();
        this.notifyXmlDataChanged();
    }

    moveSelectedVirtualObjectToBack() {
        const selectedVirtualObject = this.getSelectedVirtualObject();
        if (!selectedVirtualObject) return;
        if (selectedVirtualObject.isBackground) return;

        for (let i = 0; i < this.virtualObjects.length; i++) {
            this.virtualObjects[i]._xmlIndex = i;
        }

        const backgroundObjects = this.virtualObjects.filter(obj => obj.isBackground);
        const normalObjects = this.virtualObjects.filter(obj => !obj.isBackground);
        const otherNormalObjects = normalObjects.filter(obj => obj !== selectedVirtualObject);

        this.preserveSelection(() => {
            this.virtualObjects = [...backgroundObjects, selectedVirtualObject, ...otherNormalObjects];
        });

        this.reorderVirtualObjectsInXml();
        this.renderVirtualObjects();
        this.notifyXmlDataChanged();
    }

    // =========================================================
    // ビューモード: 保護
    // =========================================================

    applyProtection(protectionType) {
        if (this.selectedVirtualObjects.size === 0) return;

        const selectedObjects = Array.from(this.selectedVirtualObjects).map(vobjIndex => {
            return this.virtualObjects[vobjIndex];
        }).filter(v => v !== undefined);

        selectedObjects.forEach(obj => {
            if (protectionType === 'fixed') obj.isFixed = true;
            else if (protectionType === 'background') obj.isBackground = true;
            this.updateVirtualObjectInXml(obj);
        });

        if (protectionType === 'background') {
            this.moveSelectedVirtualObjectsToBackground();
            this.reorderVirtualObjectsInXml();
            this.notifyXmlDataChanged();
        }

        this.renderVirtualObjects();

        this.justClosedContextMenu = true;
        setTimeout(() => { this.justClosedContextMenu = false; }, SCROLL_UPDATE_DELAY_MS);
    }

    removeProtection(protectionType) {
        if (this.selectedVirtualObjects.size === 0) return;

        const selectedObjects = Array.from(this.selectedVirtualObjects).map(vobjIndex => {
            return this.virtualObjects[vobjIndex];
        }).filter(v => v !== undefined);

        selectedObjects.forEach(obj => {
            if (protectionType === 'fixed') obj.isFixed = false;
            else if (protectionType === 'background') obj.isBackground = false;
            this.updateVirtualObjectInXml(obj);
        });

        this.renderVirtualObjects();

        this.justClosedContextMenu = true;
        setTimeout(() => { this.justClosedContextMenu = false; }, SCROLL_UPDATE_DELAY_MS);
    }

    moveSelectedVirtualObjectsToBackground() {
        if (this.selectedVirtualObjects.size === 0) return;

        const selectedObjects = Array.from(this.selectedVirtualObjects).map(vobjIndex => {
            return this.virtualObjects[vobjIndex];
        }).filter(v => v !== undefined);

        const unselectedObjects = this.virtualObjects.filter((obj, index) =>
            !this.selectedVirtualObjects.has(index)
        );

        this.preserveSelection(() => {
            this.virtualObjects = [...selectedObjects, ...unselectedObjects];
        });
    }

    // =========================================================
    // ビューモード: ユーティリティ
    // =========================================================

    toggleFullscreen() {
        if (this.messageBus) {
            this.messageBus.send('toggle-maximize');
            this.isFullscreen = !this.isFullscreen;

            if (this.realId) {
                this.messageBus.send('update-fullscreen-state', {
                    fileId: this.realId,
                    isFullscreen: this.isFullscreen
                });
            }
        }
    }

    refresh() {
        this.renderVirtualObjects();
        this.applyBackgroundColor();
    }

    /**
     * 背景色をUIに適用する（PluginBaseオーバーライド）
     * 管理モードではCSS既定値を使用、仮身表示モードでは設定された背景色を適用
     * @param {string} [color] - 背景色（省略時はフォールバック値を使用）
     */
    applyBackgroundColor(color) {
        if (!this.isViewMode) {
            // 管理モード: CSS既定の灰色を使用（インラインスタイルをクリア）
            document.body.style.backgroundColor = '';
            return;
        }

        // 引数が指定されていない場合はフォールバック
        const bgColor = color || this.bgColor ||
            (this._savedWindowConfig && this._savedWindowConfig.backgroundColor) ||
            (this.fileData && this.fileData.windowConfig && this.fileData.windowConfig.backgroundColor);

        if (bgColor) {
            this.bgColor = bgColor;
            document.body.style.backgroundColor = bgColor;
            const canvas = document.querySelector('.virtual-canvas');
            if (canvas) {
                canvas.style.background = bgColor;
            }
        }
    }

    /**
     * 背景色変更時にcloudFiles.jsonも更新する（PluginBaseオーバーライド）
     * クラウド保存時に最新の背景色が反映されるようにする
     */
    async changeBgColor() {
        await super.changeBgColor();

        // cloudFiles.jsonが存在する場合、背景色を更新
        if (this.cloudFiles && this.cloudFiles.json && this.bgColor) {
            try {
                let jsonStr;
                if (this.cloudFiles.json instanceof ArrayBuffer || this.cloudFiles.json instanceof Uint8Array) {
                    jsonStr = new TextDecoder().decode(this.cloudFiles.json);
                } else if (Array.isArray(this.cloudFiles.json)) {
                    jsonStr = new TextDecoder().decode(new Uint8Array(this.cloudFiles.json));
                } else if (typeof this.cloudFiles.json === 'string') {
                    jsonStr = this.cloudFiles.json;
                }
                if (jsonStr) {
                    const jsonObj = JSON.parse(jsonStr);
                    if (jsonObj.window) {
                        jsonObj.window.backgroundColor = this.bgColor;
                    }
                    this.cloudFiles.json = Array.from(new TextEncoder().encode(JSON.stringify(jsonObj, null, 2)));
                }
            } catch (e) {
                logger.debug('[NetBtronViewer] JSON解析エラー（次回クラウド保存時に古い色のまま）:', e.message);
            }
        }
    }

    async handleCloseRequest(windowId) {
        if (this.isViewMode && this.xmlData) {
            this.notifyXmlDataChanged();
        }
        return super.handleCloseRequest(windowId);
    }

    async onSaveBeforeClose() {
        // クラウド接続済みかつ変更ありの場合のみクラウドに保存
        if (this.currentTenantId && this.cloudRealObjectId && this.isModified) {
            await this.saveToCloud();
        }
        // ローカルXTADは親ウィンドウ側で自動保存される（notifyXmlDataChanged経由）
    }

    requestCloseWindow() {
        this.messageBus.send('close-window');
    }

    openRealObjectWithDefaultApp() {
        const selectedVirtualObject = this.getSelectedVirtualObject();
        if (!selectedVirtualObject) return;

        const applist = selectedVirtualObject.applist;
        if (!applist || typeof applist !== 'object') return;

        let defaultPluginId = null;
        for (const [pluginId, config] of Object.entries(applist)) {
            if (config.defaultOpen === true) {
                defaultPluginId = pluginId;
                break;
            }
        }

        if (!defaultPluginId) {
            defaultPluginId = Object.keys(applist)[0];
        }

        if (!defaultPluginId) return;

        this.executeVirtualObjectWithPlugin(defaultPluginId);
    }

    async renameRealObject() {
        const selectedVirtualObject = this.getSelectedVirtualObject();
        if (!selectedVirtualObject) return;

        const realId = window.RealObjectSystem.extractRealId(selectedVirtualObject.link_id);
        this.contextMenuVirtualObject = {
            element: null, realId: realId, virtualObj: selectedVirtualObject
        };

        const result = await window.RealObjectSystem.renameRealObject(this);

        if (result.success) {
            if (this.virtualObjects) {
                for (const vo of this.virtualObjects) {
                    if (vo.link_id === selectedVirtualObject.link_id) {
                        vo.link_name = result.newName;
                    }
                }
            }

            const vobjElements = document.querySelectorAll('.virtual-object, .virtual-object-closed, .virtual-object-opened');
            vobjElements.forEach(element => {
                if (element.getAttribute('data-link-id') === selectedVirtualObject.link_id) {
                    const nameSpan = element.querySelector('.virtual-object-name');
                    if (nameSpan) nameSpan.textContent = result.newName;
                }
            });

            this.saveToFile();
        }

        this.contextMenuVirtualObject = null;
    }

    async duplicateRealObject() {
        const selectedVirtualObject = this.getSelectedVirtualObject();
        if (!selectedVirtualObject) return;

        const realId = window.RealObjectSystem.extractRealId(selectedVirtualObject.link_id);
        this.contextMenuVirtualObject = {
            element: null, realId: realId, virtualObj: selectedVirtualObject
        };

        if (window.parent && window.parent !== window) {
            const messageId = this.generateMessageId('duplicate-real');
            this.messageBus.send('duplicate-real-object', {
                realId: realId, messageId: messageId
            });

            try {
                const result = await this.messageBus.waitFor('real-object-duplicated', 0, (data) => {
                    return data.messageId === messageId;
                });

                if (result.success) {
                    const newVirtualObj = {
                        link_id: result.newRealId,
                        link_name: result.newName,
                        vobjleft: selectedVirtualObject.vobjleft + VOBJ_DROP_OFFSET_X,
                        vobjtop: selectedVirtualObject.vobjtop + VOBJ_DROP_OFFSET_Y,
                        vobjright: selectedVirtualObject.vobjright + VOBJ_DROP_OFFSET_X,
                        vobjbottom: selectedVirtualObject.vobjbottom + VOBJ_DROP_OFFSET_Y,
                        originalLeft: selectedVirtualObject.vobjleft + VOBJ_DROP_OFFSET_X,
                        originalTop: selectedVirtualObject.vobjtop + VOBJ_DROP_OFFSET_Y,
                        originalRight: selectedVirtualObject.vobjright + VOBJ_DROP_OFFSET_X,
                        originalBottom: selectedVirtualObject.vobjbottom + VOBJ_DROP_OFFSET_Y,
                        width: selectedVirtualObject.width,
                        heightPx: selectedVirtualObject.heightPx,
                        chsz: selectedVirtualObject.chsz,
                        frcol: selectedVirtualObject.frcol,
                        chcol: selectedVirtualObject.chcol,
                        tbcol: selectedVirtualObject.tbcol,
                        bgcol: selectedVirtualObject.bgcol,
                        dlen: selectedVirtualObject.dlen,
                        applist: selectedVirtualObject.applist || {},
                        pictdisp: selectedVirtualObject.pictdisp || 'true',
                        namedisp: selectedVirtualObject.namedisp || 'true',
                        roledisp: selectedVirtualObject.roledisp || 'false',
                        typedisp: selectedVirtualObject.typedisp || 'false',
                        updatedisp: selectedVirtualObject.updatedisp || 'false',
                        framedisp: selectedVirtualObject.framedisp || 'true',
                        autoopen: selectedVirtualObject.autoopen || 'false'
                    };

                    this.virtualObjects.push(newVirtualObj);
                    this.addVirtualObjectToXml(newVirtualObj);

                    const insertAt = this.virtualObjects.length - 1;
                    await this.addVirtualObjectElement(newVirtualObj, insertAt);
                    this.updateCanvasSize();
                }
            } catch (error) {
                logger.error('[NetBtronViewer] 実身複製エラー:', error);
            }
        }

        this.contextMenuVirtualObject = null;
    }

    openRealObjectConfig() {
        const selectedVirtualObject = this.getSelectedVirtualObject();
        if (!selectedVirtualObject) return;

        const realId = window.RealObjectSystem.extractRealId(selectedVirtualObject.link_id);
        this.contextMenuVirtualObject = {
            element: null, realId: realId, virtualObj: selectedVirtualObject
        };

        window.RealObjectSystem.openRealObjectConfig(this, realId);
        this.contextMenuVirtualObject = null;
    }

    closeRealObject() {
        const selectedVirtualObject = this.getSelectedVirtualObject();
        if (!selectedVirtualObject) return;

        const realId = window.RealObjectSystem.extractRealId(selectedVirtualObject.link_id);
        this.contextMenuVirtualObject = {
            element: null, realId: realId, virtualObj: selectedVirtualObject
        };

        window.RealObjectSystem.closeRealObject(this);
        this.contextMenuVirtualObject = null;
    }

    openTrashRealObjects() {
        window.RealObjectSystem.openTrashRealObjects(this);
    }

    openVirtualObjectNetwork() {
        const selectedVirtualObject = this.getSelectedVirtualObject();
        if (!selectedVirtualObject) return;

        const realId = window.RealObjectSystem.extractRealId(selectedVirtualObject.link_id);
        if (!realId) return;

        window.RealObjectSystem.openVirtualObjectNetwork(this, realId);
    }

    openRealObjectSearch() {
        window.RealObjectSystem.openRealObjectSearch(this);
    }

    async changeVirtualObjectAttributes() {
        const selectedVirtualObject = this.getSelectedVirtualObject();
        if (!selectedVirtualObject) return;

        const realId = window.RealObjectSystem.extractRealId(selectedVirtualObject.link_id);
        this.contextMenuVirtualObject = {
            element: null, realId: realId, virtualObj: selectedVirtualObject
        };

        try {
            await window.RealObjectSystem.changeVirtualObjectAttributes(this);
        } catch (error) {
            logger.error('[NetBtronViewer] 仮身属性変更エラー:', error);
        }

        this.contextMenuVirtualObject = null;
    }

    async setRelationship() {
        const selectedVirtualObject = this.getSelectedVirtualObject();
        if (!selectedVirtualObject) return { success: false };

        const realId = window.RealObjectSystem.extractRealId(selectedVirtualObject.link_id);
        this.contextMenuVirtualObject = {
            element: null, realId: realId, virtualObj: selectedVirtualObject
        };

        let result = { success: false };
        try {
            result = await super.setRelationship();
        } catch (error) {
            logger.error('[NetBtronViewer] 続柄設定エラー:', error);
        }

        this.contextMenuVirtualObject = null;
        return result;
    }

    async saveVirtualObjectRelationshipToXml(virtualObj) {
        if (virtualObj && virtualObj.link_id) {
            this.updateVirtualObjectInXml(virtualObj);
        }
    }

    onRelationshipUpdated(virtualObj, result) {
        this.renderVirtualObjects();
    }

    handleWindowClosed(windowId, fileData) {
        if (fileData && fileData.realId) {
            const realId = this.extractRealId(fileData.realId);
            if (this.openedRealObjects && this.openedRealObjects.has(realId)) {
                this.openedRealObjects.delete(realId);
            }

            // Phase 3: 子実身ウィンドウが閉じられた時にバックグラウンドアップロードキューに追加
            if (this.backgroundUploadManager && this.currentTenantId && this.cloudRealObjectId && this.isViewMode) {
                const isChild = this.virtualObjects && this.virtualObjects.some(
                    vobj => vobj.link_id && this.extractRealId(vobj.link_id) === realId
                );
                if (isChild) {
                    this.backgroundUploadManager.enqueue(realId, { parentId: this.cloudRealObjectId });
                }
            }
        }

        if (this.openedRealObjects) {
            for (const [realId, wId] of this.openedRealObjects.entries()) {
                if (wId === windowId || (wId && wId.windowId === windowId)) {
                    this.openedRealObjects.delete(realId);
                    break;
                }
            }
        }
    }

    async handleDoubleClickDragDuplicate(dropX, dropY) {
        const obj = this.dblClickDragState.dblClickedObject;
        if (!obj || !obj.link_id) return;

        const realId = obj.link_id;
        const width = obj.width || (obj.vobjright - obj.vobjleft) || 100;
        const height = obj.heightPx || (obj.vobjbottom - obj.vobjtop) || 32;

        const messageId = this.generateMessageId('duplicate');
        this.messageBus.send('duplicate-real-object', {
            realId: realId, messageId: messageId
        });

        try {
            const result = await this.messageBus.waitFor('real-object-duplicated', 0, (data) => {
                return data.messageId === messageId;
            });

            if (result.cancelled) return;

            if (result.success) {
                const newVirtualObj = {
                    link_id: result.newRealId,
                    link_name: result.newName,
                    vobjleft: Math.round(dropX),
                    vobjtop: Math.round(dropY),
                    vobjright: Math.round(dropX + width),
                    vobjbottom: Math.round(dropY + height),
                    width: width, heightPx: height,
                    chsz: obj.chsz || DEFAULT_FONT_SIZE,
                    frcol: obj.frcol || DEFAULT_FRCOL,
                    chcol: obj.chcol || DEFAULT_CHCOL,
                    tbcol: obj.tbcol || DEFAULT_TBCOL,
                    bgcol: obj.bgcol || DEFAULT_BGCOL,
                    dlen: obj.dlen || 0,
                    applist: obj.applist || {},
                    originalLeft: Math.round(dropX),
                    originalTop: Math.round(dropY),
                    originalRight: Math.round(dropX + width),
                    originalBottom: Math.round(dropY + height),
                    pictdisp: obj.pictdisp || 'true',
                    namedisp: obj.namedisp || 'true',
                    roledisp: obj.roledisp || 'false',
                    typedisp: obj.typedisp || 'false',
                    updatedisp: obj.updatedisp || 'false',
                    framedisp: obj.framedisp || 'true',
                    autoopen: obj.autoopen || 'false'
                };

                this.virtualObjects.push(newVirtualObj);
                this.addVirtualObjectToXml(newVirtualObj);

                const insertAt = this.virtualObjects.length - 1;
                await this.addVirtualObjectElement(newVirtualObj, insertAt);
                this.updateCanvasSize();
            }
        } catch (error) {
            logger.error('[NetBtronViewer] ダブルクリックドラッグ複製エラー:', error);
        }
    }

    // =========================================================
    // ビューモード: 仮身追加
    // =========================================================

    async addVirtualObjectFromFile(file) {
        try {
            const fileId = file.name.replace(/\.(tad|TAD|xtad|XTAD|bpk|BPK)$/, '');
            const newVirtualObject = {
                link_id: file.name,
                link_name: fileId,
                vobjleft: 100, vobjtop: 100,
                vobjright: 250, vobjbottom: 130,
                originalLeft: 100, originalTop: 100,
                originalRight: 250, originalBottom: 130,
                width: 100, heightPx: 50,
                chsz: 16, frcol: DEFAULT_FRCOL, chcol: DEFAULT_CHCOL,
                tbcol: DEFAULT_TBCOL, bgcol: DEFAULT_BGCOL,
                applist: {}, metadata: null
            };

            const isBPK = /\.(bpk|BPK)$/.test(file.name);
            const isTAD = /\.(tad|TAD)$/.test(file.name);

            if (!isBPK && !isTAD) {
                await this.loadVirtualObjectMetadata(newVirtualObject);
            }

            if (!newVirtualObject.applist || Object.keys(newVirtualObject.applist).length === 0) {
                if (isBPK) {
                    newVirtualObject.applist = {
                        'tadjs-view': { 'name': 'TADjs表示' },
                        'unpack-file': { 'name': '書庫解凍', 'defaultOpen': true }
                    };
                } else {
                    newVirtualObject.applist = {
                        'tadjs-view': { 'name': 'TADjs表示', 'defaultOpen': true }
                    };
                }
            }

            this.virtualObjects.push(newVirtualObject);
            this.renderVirtualObjects();
        } catch (error) {
            logger.error('[NetBtronViewer] 仮身追加エラー:', error);
        }
    }

    addVirtualObjectFromRealId(realId, name, dropPosition, applist, linkAttributes = null) {
        let x = 100;
        let y = 100 + (this.virtualObjects.length * 40);

        if (dropPosition) {
            const listElement = document.getElementById('virtualList');
            const canvas = listElement ? listElement.querySelector('.virtual-canvas') : null;
            if (canvas) {
                const rect = canvas.getBoundingClientRect();
                x = dropPosition.x - rect.left;
                y = dropPosition.y - rect.top;
            }
        }

        const attrs = linkAttributes || {};
        const halfHeight = Math.floor(DEFAULT_VOBJ_HEIGHT / 2);
        const vobjTop = Math.max(0, y - halfHeight);
        const virtualObj = {
            link_id: `${realId}_0.xtad`,
            link_name: name,
            vobjleft: Math.max(0, x - 75),
            vobjtop: vobjTop,
            vobjright: Math.max(0, x + 75),
            vobjbottom: vobjTop + DEFAULT_VOBJ_HEIGHT,
            width: 150, heightPx: DEFAULT_VOBJ_HEIGHT,
            chsz: attrs.chsz || DEFAULT_FONT_SIZE,
            frcol: attrs.frcol || DEFAULT_FRCOL,
            chcol: attrs.chcol || DEFAULT_CHCOL,
            tbcol: attrs.tbcol || DEFAULT_TBCOL,
            bgcol: attrs.bgcol || DEFAULT_BGCOL,
            dlen: 0,
            applist: applist || {},
            originalLeft: Math.max(0, x - 75),
            originalTop: vobjTop,
            originalRight: Math.max(0, x + 75),
            originalBottom: vobjTop + DEFAULT_VOBJ_HEIGHT
        };

        this.virtualObjects.push(virtualObj);
        this.addVirtualObjectToXml(virtualObj);

        const insertAt = this.virtualObjects.length - 1;
        this.addVirtualObjectElement(virtualObj, insertAt);
        this.updateCanvasSize();
    }

    // =========================================================
    // ビューモード: 整頓
    // =========================================================

    async showArrangeDialog() {
        if (this.selectedVirtualObjects.size === 0) return;

        const selectedCount = this.selectedVirtualObjects.size;
        const isMultiple = selectedCount > 1;
        const disabledClass = !isMultiple ? 'disabled' : '';
        const disabledAttr = !isMultiple ? 'disabled' : '';

        const dialogHtml = buildArrangeDialogHtml({ selectedCount, disabledClass, disabledAttr });

        const result = await this.showCustomDialog({
            title: '整頓',
            dialogHtml: dialogHtml,
            buttons: [
                { label: 'キャンセル', value: 'cancel' },
                { label: 'OK', value: 'ok' }
            ],
            defaultButton: 1,
            inputs: { text: 'columnCount' },
            radios: {
                horizontal: 'horizontal', vertical: 'vertical',
                column: 'column', length: 'length',
                sortBy: 'sortBy', sortOrder: 'sortOrder'
            }
        });

        if (result && result.button === 'ok') {
            const horizontal = (result.radios && result.radios.horizontal) || 'none';
            const vertical = (result.radios && result.radios.vertical) || 'none';
            const column = (result.radios && result.radios.column) || 'none';
            const length = (result.radios && result.radios.length) || 'none';
            const sortBy = (result.radios && result.radios.sortBy) || 'none';
            const sortOrder = (result.radios && result.radios.sortOrder) || 'asc';
            const columnCount = parseInt((result.inputs && result.inputs.columnCount) || '1') || 1;

            this.arrangeVirtualObjects({
                horizontal, vertical, column, columnCount,
                length, sortBy, sortOrder
            });
        }

        return result;
    }

    arrangeVirtualObjects(options) {
        const selectedObjects = Array.from(this.selectedVirtualObjects).map(vobjIndex => {
            return this.virtualObjects[vobjIndex];
        }).filter(v => v !== undefined);
        if (selectedObjects.length === 0) return;

        const topmost = Math.min(...selectedObjects.map(o => o.vobjtop));
        const leftmost = Math.min(...selectedObjects.map(o => o.vobjleft));
        const rightmost = Math.max(...selectedObjects.map(o => o.vobjright));
        const baseCoords = { top: topmost, left: leftmost, right: rightmost };

        const firstObj = selectedObjects[0];

        if (selectedObjects.length > 1 && options.sortBy !== 'none') {
            this.sortVirtualObjects(selectedObjects, options.sortBy, options.sortOrder);
        }

        if (options.length !== 'none') {
            this.adjustVirtualObjectLength(selectedObjects, options.length, firstObj);
        }

        if (selectedObjects.length > 1) {
            let effectiveColumn = options.column;
            if (options.sortBy !== 'none' && options.column === 'none' &&
                options.horizontal === 'none' && options.vertical === 'none') {
                effectiveColumn = 'single';
            }

            if (effectiveColumn === 'single') {
                this.arrangeSingleColumn(selectedObjects, baseCoords, options);
            } else if (effectiveColumn === 'multi-horizontal') {
                this.arrangeMultiColumnHorizontal(selectedObjects, baseCoords, options);
            } else if (effectiveColumn === 'multi-vertical') {
                this.arrangeMultiColumnVertical(selectedObjects, baseCoords, options);
            } else {
                this.adjustHorizontalVertical(selectedObjects, baseCoords, options);
            }
        }

        this.renderVirtualObjects();

        selectedObjects.forEach(obj => {
            this.updateVirtualObjectInXml(obj);
        });
    }

    sortVirtualObjects(objects, sortBy, sortOrder) {
        objects.sort((a, b) => {
            let compare = 0;
            switch (sortBy) {
                case 'name':
                    compare = (a.link_name || '').localeCompare(b.link_name || '');
                    break;
                case 'created':
                    compare = (a.metadata?.makeDate || '').localeCompare(b.metadata?.makeDate || '');
                    break;
                case 'updated':
                    compare = (a.metadata?.updateDate || '').localeCompare(b.metadata?.updateDate || '');
                    break;
                case 'size':
                    compare = (a.metadata?.size || 0) - (b.metadata?.size || 0);
                    break;
            }
            if (sortOrder === 'desc') compare = -compare;
            return compare;
        });
    }

    adjustVirtualObjectLength(objects, lengthType, firstObj) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        objects.forEach(obj => {
            let targetWidth;
            if (lengthType === 'first') {
                targetWidth = firstObj.vobjright - firstObj.vobjleft;
            } else {
                targetWidth = this.calculateRequiredWidth(obj, lengthType, ctx);
            }
            const currentWidth = obj.vobjright - obj.vobjleft;
            const diff = targetWidth - currentWidth;
            obj.vobjright += diff;
            obj.width = targetWidth;
        });
    }

    calculateRequiredWidth(obj, lengthType, ctx) {
        const chszPx = window.convertPtToPx(obj.chsz || DEFAULT_FONT_SIZE);
        ctx.font = `${chszPx}px sans-serif`;

        const paddingLeft = 10;
        const paddingRight = 10;
        const gap = 4;

        const iconSize = Math.round(chszPx * 1.0);
        let totalWidth = paddingLeft + iconSize + gap;

        const nameWidth = ctx.measureText(obj.link_name || '').width;
        totalWidth += nameWidth;

        if (lengthType === 'icon-name') return totalWidth + paddingRight;

        if (obj.metadata && obj.metadata.relationship && obj.metadata.relationship.length > 0) {
            totalWidth += ctx.measureText(' : ' + obj.metadata.relationship.join(' ')).width;
        }

        if (lengthType === 'with-relation') return totalWidth + paddingRight;

        if (obj.applist) {
            for (const [, config] of Object.entries(obj.applist)) {
                if (config && config.defaultOpen === true && config.name) {
                    totalWidth += ctx.measureText(' (' + config.name + ')').width;
                    break;
                }
            }
        }

        if (lengthType === 'without-date') return totalWidth + paddingRight;

        if (lengthType === 'full' && obj.metadata && obj.metadata.updateDate) {
            totalWidth += ctx.measureText(' YYYY/MM/DD HH:MM:SS').width;
        }

        return totalWidth + paddingRight;
    }

    arrangeSingleColumn(objects, baseCoords, options) {
        let currentTop = baseCoords.top;
        const spacing = options.vertical === 'compact' ? 5 : 10;

        objects.forEach(obj => {
            const height = obj.vobjbottom - obj.vobjtop;
            const width = obj.vobjright - obj.vobjleft;

            if (options.horizontal === 'left') {
                obj.vobjleft = baseCoords.left;
                obj.vobjright = obj.vobjleft + width;
            } else if (options.horizontal === 'right') {
                obj.vobjright = baseCoords.right;
                obj.vobjleft = obj.vobjright - width;
            } else {
                obj.vobjleft = baseCoords.left;
                obj.vobjright = obj.vobjleft + width;
            }

            obj.vobjtop = currentTop;
            obj.vobjbottom = currentTop + height;
            currentTop = obj.vobjbottom + spacing;
        });
    }

    arrangeMultiColumnHorizontal(objects, baseCoords, options) {
        const columnCount = options.columnCount || 2;
        const spacing = options.vertical === 'compact' ? 5 : 10;
        const horizontalSpacing = 10;

        const colMaxWidths = new Array(columnCount).fill(0);
        objects.forEach((obj, index) => {
            const width = obj.vobjright - obj.vobjleft;
            const col = index % columnCount;
            if (width > colMaxWidths[col]) colMaxWidths[col] = width;
        });

        const colLefts = [baseCoords.left];
        for (let i = 1; i < columnCount; i++) {
            colLefts[i] = colLefts[i - 1] + colMaxWidths[i - 1] + horizontalSpacing;
        }

        let currentRow = 0;
        let currentCol = 0;
        let rowTops = [baseCoords.top];

        objects.forEach((obj, index) => {
            const height = obj.vobjbottom - obj.vobjtop;
            const width = obj.vobjright - obj.vobjleft;

            obj.vobjleft = colLefts[currentCol];
            obj.vobjright = obj.vobjleft + width;
            obj.vobjtop = rowTops[currentRow];
            obj.vobjbottom = obj.vobjtop + height;

            currentCol++;
            if (currentCol >= columnCount) {
                currentCol = 0;
                currentRow++;
                const rowObjects = objects.slice(Math.max(0, index - columnCount + 1), index + 1);
                const maxBottom = Math.max(...rowObjects.map(o => o.vobjbottom));
                rowTops[currentRow] = maxBottom + spacing;
            }
        });
    }

    arrangeMultiColumnVertical(objects, baseCoords, options) {
        const columnCount = options.columnCount || 2;
        const spacing = options.vertical === 'compact' ? 5 : 10;
        const horizontalSpacing = 10;

        const itemsPerColumn = Math.ceil(objects.length / columnCount);

        const colMaxWidths = new Array(columnCount).fill(0);
        objects.forEach((obj, index) => {
            const width = obj.vobjright - obj.vobjleft;
            const col = Math.floor(index / itemsPerColumn);
            if (width > colMaxWidths[col]) colMaxWidths[col] = width;
        });

        const colLefts = [baseCoords.left];
        for (let i = 1; i < columnCount; i++) {
            colLefts[i] = colLefts[i - 1] + colMaxWidths[i - 1] + horizontalSpacing;
        }

        objects.forEach((obj, index) => {
            const height = obj.vobjbottom - obj.vobjtop;
            const width = obj.vobjright - obj.vobjleft;

            const currentCol = Math.floor(index / itemsPerColumn);
            const currentRow = index % itemsPerColumn;

            obj.vobjleft = colLefts[currentCol];
            obj.vobjright = obj.vobjleft + width;

            if (currentRow === 0) {
                obj.vobjtop = baseCoords.top;
            } else {
                const prevObj = objects[index - 1];
                obj.vobjtop = prevObj.vobjbottom + spacing;
            }
            obj.vobjbottom = obj.vobjtop + height;
        });
    }

    adjustHorizontalVertical(objects, baseCoords, options) {
        if (options.horizontal === 'none' && options.vertical === 'none') return;

        const sortedObjects = [...objects].sort((a, b) => a.vobjtop - b.vobjtop);

        let prevObj = null;
        sortedObjects.forEach(obj => {
            const width = obj.vobjright - obj.vobjleft;
            const height = obj.vobjbottom - obj.vobjtop;

            if (options.horizontal === 'left') {
                obj.vobjleft = baseCoords.left;
                obj.vobjright = obj.vobjleft + width;
            } else if (options.horizontal === 'right') {
                obj.vobjright = baseCoords.right;
                obj.vobjleft = obj.vobjright - width;
            }

            if (prevObj && options.vertical !== 'none') {
                let spacing;
                if (options.vertical === 'compact') spacing = 5;
                else if (options.vertical === 'align') spacing = 10;
                obj.vobjtop = prevObj.vobjbottom + spacing;
                obj.vobjbottom = obj.vobjtop + height;
            }

            prevObj = obj;
        });
    }

    // =========================================================
    // ビューモード: メニュー
    // =========================================================

    async getMenuDefinition() {
        // 管理モード用メニュー
        if (!this.isViewMode) {
            const canEnterCloud = !!this.selectedRealObjectId && !!this.currentTenantId;
            const canEnterLocal = !!this.localXmlData;
            const submenu = [];
            submenu.push({ text: '仮身表示モード', action: 'enter-view-mode', disabled: !canEnterLocal && !canEnterCloud });
            if (canEnterCloud) {
                submenu.push({ text: 'クラウド実身を開く', action: 'enter-view-mode-cloud' });
            }
            submenu.push({ separator: true });
            submenu.push({ text: '更新', action: 'management-refresh' });
            return [
                {
                    text: 'Net-BTRON',
                    submenu: submenu
                }
            ];
        }

        const selectedVirtualObject = this.getSelectedVirtualObject();

        const menuDefinition = this.isReadonly ? [
            {
                text: '表示',
                submenu: [
                    { text: '全画面表示', action: 'toggle-fullscreen', shortcut: 'Ctrl+L' },
                    { text: '再表示', action: 'refresh' }
                ]
            }
        ] : [
            {
                text: '保存',
                submenu: [
                    { text: '元の実身に保存', action: 'save', shortcut: 'Ctrl+S' },
                    { text: '新たな実身に保存', action: 'save-as-new' }
                ]
            },
            {
                text: '表示',
                submenu: [
                    { text: '全画面表示', action: 'toggle-fullscreen', shortcut: 'Ctrl+L' },
                    { text: '再表示', action: 'refresh' },
                    { text: '背景色変更', action: 'change-bg-color' }
                ]
            },
            {
                text: '編集',
                submenu: [
                    { text: 'クリップボードへコピー', action: 'copy', shortcut: 'Ctrl+C' },
                    { text: 'クリップボードからコピー', action: 'paste', shortcut: 'Ctrl+V' },
                    { text: 'クリップボードへ移動', action: 'cut', shortcut: 'Ctrl+X' },
                    { separator: true },
                    { text: '削除', action: 'delete', shortcut: 'Delete' },
                    { separator: true },
                    { text: 'いちばん前へ移動', action: 'front', shortcut: 'Ctrl+F' },
                    { text: 'いちばん後ろへ移動', action: 'back', shortcut: 'Ctrl+R' },
                    { separator: true },
                    { text: '整頓', action: 'arrange-virtual-objects', shortcut: 'Ctrl+D', disabled: this.selectedVirtualObjects.size === 0 }
                ]
            },
            {
                text: '保護',
                submenu: [
                    { text: '固定化', action: 'protect-fix', disabled: this.selectedVirtualObjects.size === 0 },
                    { text: '固定解除', action: 'unprotect-fix', disabled: this.selectedVirtualObjects.size === 0 },
                    { text: '背景化', action: 'protect-background', disabled: this.selectedVirtualObjects.size === 0 },
                    { text: '背景解除', action: 'unprotect-background', disabled: this.selectedVirtualObjects.size === 0 }
                ]
            }
        ];

        // 仮身選択時の追加メニュー
        if (selectedVirtualObject && !this.isReadonly) {
            try {
                const realId = window.RealObjectSystem.extractRealId(selectedVirtualObject.link_id);
                const isOpened = this.openedRealObjects ? this.openedRealObjects.has(realId) : false;

                menuDefinition.push({
                    text: '仮身操作',
                    submenu: [
                        { text: '開く', action: 'open-real-object', disabled: isOpened },
                        { text: '閉じる', action: 'close-real-object', disabled: !isOpened },
                        { separator: true },
                        { text: '属性変更', action: 'change-virtual-object-attributes' },
                        { text: '続柄設定', action: 'set-relationship' }
                    ]
                });

                menuDefinition.push({
                    text: '実身操作',
                    submenu: [
                        { text: '実身名変更', action: 'rename-real-object' },
                        { text: '実身複製', action: 'duplicate-real-object' },
                        { text: '管理情報', action: 'open-realobject-config' },
                        { text: '仮身ネットワーク', action: 'open-virtual-object-network' },
                        { text: '実身/仮身検索', action: 'open-real-object-search' }
                    ]
                });

                menuDefinition.push({
                    text: '屑実身操作',
                    action: 'open-trash-real-objects'
                });

                const applistData = await this.getAppListData(realId);
                if (applistData && Object.keys(applistData).length > 0) {
                    const executeSubmenu = [];
                    for (const [pluginId, appInfo] of Object.entries(applistData)) {
                        executeSubmenu.push({
                            text: appInfo.name || pluginId,
                            action: `execute-with-${pluginId}`
                        });
                    }
                    menuDefinition.push({ text: '実行', submenu: executeSubmenu });
                }
            } catch (error) {
                logger.error('[NetBtronViewer] applist取得エラー:', error);
            }
        }

        // Net-BTRON固有メニュー
        if (!this.isReadonly) {
            menuDefinition.push({
                text: 'Net-BTRON',
                submenu: [
                    { text: 'クラウドに保存', action: 'save-to-cloud' },
                    { separator: true },
                    { text: '管理モードに戻る', action: 'exit-view-mode' }
                ]
            });
        }

        return menuDefinition;
    }

    executeMenuAction(action, additionalData) {
        logger.info('[NetBtronViewer] executeMenuAction:', action);
        this.handleMenuAction(action);
    }

    handleMenuAction(action) {
        if (action.startsWith('execute-with-')) {
            const pluginId = action.replace('execute-with-', '');
            this.executeVirtualObjectWithPlugin(pluginId);
            return;
        }

        switch (action) {
            case 'save': this.saveToFile(); break;
            case 'save-as-new': this.saveAsNewRealObject(); break;
            case 'toggle-fullscreen': this.toggleFullscreen(); break;
            case 'refresh': this.refresh(); break;
            case 'change-bg-color':
                this.changeBgColor().catch(err => { logger.error('[NetBtronViewer] 背景色変更エラー:', err); });
                break;
            case 'copy': this.copySelectedVirtualObject(); break;
            case 'paste':
                this.pasteVirtualObject().catch(err => { logger.error('[NetBtronViewer] ペーストエラー:', err); });
                break;
            case 'cut': this.cutSelectedVirtualObject(); break;
            case 'delete': this.deleteSelectedVirtualObject(); break;
            case 'front': this.moveSelectedVirtualObjectToFront(); break;
            case 'back': this.moveSelectedVirtualObjectToBack(); break;
            case 'arrange-virtual-objects':
                this.showArrangeDialog().catch(err => { logger.error('[NetBtronViewer] 整頓エラー:', err); });
                break;
            case 'protect-fix': this.applyProtection('fixed'); break;
            case 'unprotect-fix': this.removeProtection('fixed'); break;
            case 'protect-background': this.applyProtection('background'); break;
            case 'unprotect-background': this.removeProtection('background'); break;
            case 'open-real-object': this.openRealObjectWithDefaultApp(); break;
            case 'close-real-object': this.closeRealObject(); break;
            case 'change-virtual-object-attributes': this.changeVirtualObjectAttributes(); break;
            case 'set-relationship': this.setRelationship(); break;
            case 'rename-real-object': this.renameRealObject(); break;
            case 'duplicate-real-object': this.duplicateRealObject(); break;
            case 'open-realobject-config': this.openRealObjectConfig(); break;
            case 'open-trash-real-objects': this.openTrashRealObjects(); break;
            case 'open-virtual-object-network': this.openVirtualObjectNetwork(); break;
            case 'open-real-object-search': this.openRealObjectSearch(); break;
            // Net-BTRON固有
            case 'save-to-cloud': this.saveToCloud(); break;
            case 'exit-view-mode': this.exitViewMode(); break;
            // 管理モード用アクション
            case 'enter-view-mode':
                if (this.currentTenantId && this.selectedRealObjectId) {
                    // クラウド接続済み＋実身選択済み → クラウドから開く（優先）
                    this.enterViewMode(this.selectedRealObjectId);
                } else if (this.localXmlData) {
                    // クラウド未接続 → ローカルデータで開く
                    this.enterViewModeLocal();
                } else {
                    this.setStatus('表示可能なデータがありません');
                }
                break;
            case 'enter-view-mode-cloud':
                if (this.currentTenantId && this.selectedRealObjectId) {
                    this.enterViewMode(this.selectedRealObjectId);
                } else {
                    this.setStatus('テナントに接続し、実身を選択してください');
                }
                break;
            case 'management-refresh': this.handleRefresh(); break;
        }
    }

    // =========================================================
    // ビューモード: グローバルマウスイベントハンドラー
    // =========================================================

    /**
     * グローバルマウスイベントハンドラーを設定（ドラッグ用）
     */
    setupGlobalMouseHandlers() {
        // ドラッグ用のmousemoveハンドラ
        const handleDragMouseMove = (e) => {
            // 範囲選択中の更新処理
            if (this.rangeSelectionState.isActive) {
                const canvas = this.rangeSelectionState.container;
                if (canvas) {
                    const rect = canvas.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const y = e.clientY - rect.top;
                    this.updateRangeSelection(x, y);
                }
                return;
            }

            // ダブルクリック+ドラッグ候補の検出
            if (this.shouldStartDblClickDrag(e)) {
                logger.debug('[NetBtronViewer] ダブルクリック+ドラッグを確定（ドラッグ完了待ち）:', this.dblClickDragState.dblClickedObject.link_name);

                const obj = this.dblClickDragState.dblClickedObject;
                const width = obj.width || (obj.vobjright - obj.vobjleft) || 100;
                const height = obj.heightPx || (obj.vobjbottom - obj.vobjtop) || 32;

                const preview = document.createElement('div');
                preview.className = 'dblclick-drag-preview';
                preview.style.position = 'absolute';
                preview.style.border = `2px solid ${PREVIEW_BORDER_COLOR}`;
                preview.style.backgroundColor = 'rgba(0, 120, 212, 0.1)';
                preview.style.pointerEvents = 'none';
                preview.style.zIndex = '10000';
                preview.style.width = width + 'px';
                preview.style.height = height + 'px';
                preview.style.left = obj.vobjleft + 'px';
                preview.style.top = obj.vobjtop + 'px';

                const canvas = document.querySelector('.virtual-canvas');
                if (canvas) {
                    canvas.appendChild(preview);
                }
                return;
            }

            // ダブルクリック+ドラッグ中のプレビュー位置更新
            if (this.dblClickDragState.isDblClickDrag) {
                const preview = document.querySelector('.dblclick-drag-preview');
                if (preview) {
                    const canvas = document.querySelector('.virtual-canvas');
                    if (canvas) {
                        const rect = canvas.getBoundingClientRect();
                        const canvasX = e.clientX - rect.left + canvas.scrollLeft;
                        const canvasY = e.clientY - rect.top + canvas.scrollTop;
                        preview.style.left = canvasX + 'px';
                        preview.style.top = canvasY + 'px';
                    }
                }
                return;
            }

            if (!this.virtualObjectDragState.isDragging) return;

            const deltaX = e.clientX - this.virtualObjectDragState.startX;
            const deltaY = e.clientY - this.virtualObjectDragState.startY;

            if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
                if (!this.virtualObjectDragState.hasMoved) {
                    logger.debug('[NetBtronViewer] mousemove: 移動検知 delta:', deltaX, deltaY);
                }
                this.virtualObjectDragState.hasMoved = true;
            }

            if (this.virtualObjectDragState.hasMoved && this.vobjDragState.currentElement) {
                const newLeft = this.vobjDragState.initialLeft + deltaX;
                const newTop = this.vobjDragState.initialTop + deltaY;

                this.vobjDragState.currentElement.style.left = newLeft + 'px';
                this.vobjDragState.currentElement.style.top = newTop + 'px';
            }
        };

        // スロットル版のmousemoveハンドラ（60FPS制限）
        const throttledDragMouseMove = window.throttleRAF ? window.throttleRAF(handleDragMouseMove) : handleDragMouseMove;

        // document全体でのmousedown（iframe上のクリックも検出するため）
        document.addEventListener('mousedown', (e) => {
            const vobjElement = e.target.closest('.virtual-object');
            if (vobjElement) {
                this.setIframesPointerEvents(false);
                logger.debug('[NetBtronViewer] document mousedown: iframeを無効化（仮身要素内）');

                if (this.iframeReenableTimeout) {
                    clearTimeout(this.iframeReenableTimeout);
                }
                this.iframeReenableTimeout = setTimeout(() => {
                    if (!this.virtualObjectDragState.isDragging && !this.virtualObjectDragState.hasMoved) {
                        logger.debug('[NetBtronViewer] タイムアウト: ドラッグなし（iframe再有効化はスキップ）');
                    }
                }, 200);
            } else if (e.button === 0 && !this.dblClickDragState.isDblClickDragCandidate) {
                const canvas = document.querySelector('.virtual-canvas');
                if (canvas && canvas.contains(e.target)) {
                    const rect = canvas.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const y = e.clientY - rect.top;
                    this.startRangeSelection(canvas, x, y);
                }
            }
        }, { capture: true });

        // document全体でのmousemove
        document.addEventListener('mousemove', throttledDragMouseMove);

        // document全体でのmouseup
        document.addEventListener('mouseup', (e) => {
            logger.debug('[NetBtronViewer] mouseup検知 isDragging:', this.virtualObjectDragState.isDragging, 'hasMoved:', this.virtualObjectDragState.hasMoved, 'button:', e.button);

            // 範囲選択終了処理
            if (this.rangeSelectionState.isActive) {
                const bounds = this.getRangeSelectionBounds();
                const canvas = this.rangeSelectionState.container;
                if (canvas) {
                    bounds.left += canvas.scrollLeft;
                    bounds.right += canvas.scrollLeft;
                    bounds.top += canvas.scrollTop;
                    bounds.bottom += canvas.scrollTop;
                }
                const selectedIndices = this.getVirtualObjectsInRect(bounds);
                logger.debug('[NetBtronViewer] 範囲選択終了:', selectedIndices.length, '個の仮身を選択');

                if (!e.shiftKey) {
                    this.selectedVirtualObjects.clear();
                    const allVobjElements = document.querySelectorAll('.virtual-object');
                    allVobjElements.forEach(el => {
                        el.style.boxShadow = '';
                    });
                }

                selectedIndices.forEach(index => {
                    if (e.shiftKey && this.selectedVirtualObjects.has(index)) {
                        this.selectedVirtualObjects.delete(index);
                    } else {
                        this.selectedVirtualObjects.add(index);
                    }
                });

                this.updateSelectionDisplay();
                this.endRangeSelection();

                this.justCompletedRangeSelection = true;
                setTimeout(() => {
                    this.justCompletedRangeSelection = false;
                }, 100);

                return;
            }

            // ダブルクリック+ドラッグのプレビュー要素を削除
            const preview = document.querySelector('.dblclick-drag-preview');
            if (preview) {
                preview.remove();
            }

            // ダブルクリック+ドラッグ完了時に実身複製処理を実行
            if (this.dblClickDragState.isDblClickDrag) {
                logger.debug('[NetBtronViewer] ダブルクリック+ドラッグ完了、実身複製処理を開始');

                const canvas = document.querySelector('.virtual-canvas');
                if (canvas) {
                    const rect = canvas.getBoundingClientRect();
                    const dropX = e.clientX - rect.left + canvas.scrollLeft;
                    const dropY = e.clientY - rect.top + canvas.scrollTop;

                    this.handleDoubleClickDragDuplicate(dropX, dropY);
                }

                this.cleanupDblClickDragState();
                this.dblClickDragState.dblClickedObject = null;
            }
            // ダブルクリック候補でドラッグしなかった場合、仮身を開く
            else if (this.dblClickDragState.isDblClickDragCandidate) {
                logger.debug('[NetBtronViewer] ダブルクリック検出、仮身を開く');

                const obj = this.dblClickDragState.dblClickedObject;
                const vobj = this.dblClickDragState.dblClickedElement;

                if (obj && vobj && !this.isReadonly) {
                    if (vobj.classList.contains('expanded')) {
                        logger.debug('[NetBtronViewer] 開いた仮身をdefaultOpenで起動:', obj.link_name);

                        const applist = obj.applist || {};
                        let defaultOpenPlugin = null;

                        for (const [pluginId, config] of Object.entries(applist)) {
                            if (config.defaultOpen === true) {
                                defaultOpenPlugin = pluginId;
                                break;
                            }
                        }

                        if (defaultOpenPlugin) {
                            logger.debug('[NetBtronViewer] defaultOpenプラグイン:', defaultOpenPlugin);
                            this.messageBus.send('open-virtual-object-real', {
                                virtualObj: obj,
                                pluginId: defaultOpenPlugin
                            });
                        } else {
                            logger.warn('[NetBtronViewer] defaultOpenプラグインが見つかりません');
                        }
                    } else {
                        this.openVirtualObject(obj);
                    }
                }

                this.cleanupDblClickDragState();
                this.dblClickDragState.dblClickedObject = null;
            }

            // タイムアウトをクリア
            if (this.iframeReenableTimeout) {
                clearTimeout(this.iframeReenableTimeout);
                this.iframeReenableTimeout = null;
            }

            if (this.virtualObjectDragState.isDragging) {
                if (this.virtualObjectDragState.hasMoved) {
                    logger.debug('[NetBtronViewer] mouseup: ドラッグ完了、finishDrag()呼び出し');
                    this.finishDrag();
                } else {
                    logger.debug('[NetBtronViewer] mouseup: 移動なし、状態リセット');
                    this.virtualObjectDragState.isDragging = false;
                    this.vobjDragState.currentObject = null;
                    this.vobjDragState.currentElement = null;
                    this.vobjDragState.vobjIndex = null;
                }
            }
        });
    }

    // =========================================================
    // ビューモード: iframe pointer-events制御
    // =========================================================

    /**
     * 全てのiframeのpointer-eventsを制御
     * @param {boolean} enabled - trueで有効化、falseで無効化
     */
    setIframesPointerEvents(enabled) {
        const iframes = document.querySelectorAll('.virtual-object-content-iframe, .virtual-object-content');
        iframes.forEach(iframe => {
            iframe.style.pointerEvents = enabled ? 'auto' : 'none';
        });
        logger.debug('[NetBtronViewer] iframeのpointer-events:', enabled ? '有効化' : '無効化', 'iframe数:', iframes.length);
    }

    // =========================================================
    // ビューモード: キャンバスサイズ管理
    // =========================================================

    /**
     * キャンバスサイズを仮身の位置に合わせて更新
     */
    updateCanvasSize() {
        const canvas = document.querySelector('.virtual-canvas');
        if (!canvas) {
            logger.warn('[NetBtronViewer] キャンバス要素が見つかりません');
            return;
        }

        const bounds = window.calculateFigureContentBounds(this.xmlData);
        const margin = 10;

        const contentRight = bounds.right + margin;
        const contentBottom = bounds.bottom + margin;

        const pluginContent = document.querySelector('.plugin-content');
        const windowWidth = pluginContent ? pluginContent.clientWidth : 0;
        const windowHeight = pluginContent ? pluginContent.clientHeight : 0;

        const finalWidth = Math.max(contentRight, windowWidth);
        const finalHeight = Math.max(contentBottom, windowHeight);

        canvas.style.width = finalWidth + 'px';
        canvas.style.height = finalHeight + 'px';

        logger.debug('[NetBtronViewer] キャンバスサイズ更新:', finalWidth, 'x', finalHeight, '(コンテンツ:', contentRight, 'x', contentBottom, ', ウィンドウ:', windowWidth, 'x', windowHeight, ')');

        this.notifyScrollChange();
    }

    /**
     * 全画面表示オフ時にキャンバスサイズを縮小（必要に応じて）
     */
    shrinkCanvasIfNeeded() {
        const canvas = document.querySelector('.virtual-canvas');
        if (!canvas) {
            logger.warn('[NetBtronViewer] キャンバス要素が見つかりません');
            return;
        }

        const bounds = window.calculateFigureContentBounds(this.xmlData);
        const margin = 10;

        const contentRight = bounds.right + margin;
        const contentBottom = bounds.bottom + margin;

        const pluginContent = document.querySelector('.plugin-content');
        const windowWidth = pluginContent ? pluginContent.clientWidth : 0;
        const windowHeight = pluginContent ? pluginContent.clientHeight : 0;

        logger.debug('[NetBtronViewer] shrinkCanvasIfNeeded - コンテンツ:', contentRight, 'x', contentBottom, ', ウィンドウ:', windowWidth, 'x', windowHeight);

        const finalWidth = Math.max(contentRight, windowWidth);
        const finalHeight = Math.max(contentBottom, windowHeight);

        canvas.style.width = finalWidth + 'px';
        canvas.style.height = finalHeight + 'px';

        logger.debug('[NetBtronViewer] キャンバスサイズ調整完了:', finalWidth, 'x', finalHeight);

        this.notifyScrollChange();
    }

    /**
     * 必要に応じてキャンバスサイズを拡大
     * @param {string} direction - 'right' または 'bottom'
     * @param {HTMLElement} canvas - キャンバス要素
     * @param {HTMLElement} container - スクロールコンテナ
     */
    expandCanvasIfNeeded(direction, canvas, container) {
        const expandMargin = 50;

        if (direction === 'right') {
            const currentWidth = parseInt(canvas.style.width) || canvas.offsetWidth;
            const maxScrollLeft = canvas.scrollWidth - container.clientWidth;
            if (container.scrollLeft >= maxScrollLeft - 10) {
                canvas.style.width = (currentWidth + expandMargin) + 'px';
            }
        } else if (direction === 'bottom') {
            const currentHeight = parseInt(canvas.style.height) || canvas.offsetHeight;
            const maxScrollTop = canvas.scrollHeight - container.clientHeight;
            if (container.scrollTop >= maxScrollTop - 10) {
                canvas.style.height = (currentHeight + expandMargin) + 'px';
            }
        }
    }

    // =========================================================
    // ビューモード: 仮身実行・自動起動
    // =========================================================

    /**
     * 選択された仮身の実身を指定されたプラグインで開く
     */
    async executeVirtualObjectWithPlugin(pluginId) {
        const selectedVirtualObject = this.getSelectedVirtualObject();
        if (!selectedVirtualObject) {
            logger.warn('[NetBtronViewer] 仮身が選択されていません');
            return;
        }

        const realId = window.RealObjectSystem.extractRealId(selectedVirtualObject.link_id);
        logger.debug('[NetBtronViewer] 仮身の実身を開く:', realId, 'プラグイン:', pluginId);

        const messageId = `open-${realId}-${Date.now()}`;

        this.messageBus.send('open-virtual-object-real', {
            virtualObj: selectedVirtualObject,
            pluginId: pluginId,
            messageId: messageId
        });

        try {
            const result = await this.messageBus.waitFor('window-opened', window.LONG_OPERATION_TIMEOUT_MS, (data) => {
                return data.messageId === messageId;
            });

            if (result.success && result.windowId) {
                this.openedRealObjects.set(realId, result.windowId);
                logger.debug('[NetBtronViewer] ウィンドウが開きました:', result.windowId, 'realId:', realId);

                const baseRealId = window.RealObjectSystem.extractRealId(realId);
                const iconPath = `${baseRealId}.ico`;
                this.messageBus.send('set-window-icon', {
                    windowId: result.windowId,
                    iconPath: iconPath
                });
                logger.debug('[NetBtronViewer] ウィンドウアイコン設定要求:', result.windowId, iconPath);
            }
        } catch (error) {
            logger.error('[NetBtronViewer] ウィンドウを開く処理でエラー:', error);
        }
    }

    /**
     * autoopen属性がtrueの仮身を自動的に開く
     */
    async autoOpenVirtualObjects() {
        logger.debug('[NetBtronViewer] 自動起動処理開始, 仮身数:', this.virtualObjects.length);

        for (const virtualObj of this.virtualObjects) {
            if (virtualObj.autoopen === 'true') {
                logger.debug('[NetBtronViewer] 自動起動する仮身:', virtualObj.link_id);

                try {
                    const applist = virtualObj.applist;
                    if (!applist || typeof applist !== 'object') {
                        logger.warn('[NetBtronViewer] applistが存在しません:', virtualObj.link_id);
                        continue;
                    }

                    let defaultPluginId = null;
                    for (const [pluginId, config] of Object.entries(applist)) {
                        if (config.defaultOpen === true) {
                            defaultPluginId = pluginId;
                            break;
                        }
                    }

                    if (!defaultPluginId) {
                        defaultPluginId = Object.keys(applist)[0];
                    }

                    if (!defaultPluginId) {
                        logger.warn('[NetBtronViewer] 開くためのプラグインが見つかりません:', virtualObj.link_id);
                        continue;
                    }

                    logger.debug('[NetBtronViewer] プラグインを決定:', defaultPluginId);

                    const previousSelection = new Set(this.selectedVirtualObjects);
                    this.selectedVirtualObjects.clear();
                    const vobjIndex = this.virtualObjects.indexOf(virtualObj);
                    this.selectedVirtualObjects.add(vobjIndex);

                    logger.debug('[NetBtronViewer] 仮身を開く処理を開始:', virtualObj.link_id);

                    await this.executeVirtualObjectWithPlugin(defaultPluginId);

                    this.selectedVirtualObjects = previousSelection;

                    logger.debug('[NetBtronViewer] 自動起動完了:', virtualObj.link_id, 'with', defaultPluginId);
                } catch (error) {
                    logger.error('[NetBtronViewer] 自動起動エラー:', virtualObj.link_id, error);
                }
            }
        }
    }

    // =========================================================
    // ビューモード: ドラッグ&ドロップ支援メソッド
    // =========================================================

    /**
     * 原紙ファイルを仮身として挿入
     */
    insertBaseFileAsVirtualObject(baseFile, clientX, clientY) {
        logger.debug('[NetBtronViewer] 原紙ファイル挿入:', baseFile.displayName);

        const listElement = document.getElementById('virtualList');
        const canvas = listElement.querySelector('.virtual-canvas');

        if (!canvas) {
            logger.warn('[NetBtronViewer] キャンバスが見つかりません');
            return;
        }

        const rect = canvas.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;

        const halfHeight = Math.floor(DEFAULT_VOBJ_HEIGHT / 2);
        const vobjTop = Math.max(0, y - halfHeight);
        const virtualObj = {
            link_id: baseFile.pluginId,
            link_name: baseFile.displayName,
            vobjleft: Math.max(0, x - 75),
            vobjtop: vobjTop,
            vobjright: Math.max(0, x + 75),
            vobjbottom: vobjTop + DEFAULT_VOBJ_HEIGHT,
            width: 150,
            heightPx: DEFAULT_VOBJ_HEIGHT,
            chsz: DEFAULT_FONT_SIZE,
            frcol: DEFAULT_FRCOL,
            chcol: DEFAULT_CHCOL,
            tbcol: DEFAULT_TBCOL,
            bgcol: DEFAULT_BGCOL,
            dlen: 0
        };

        this.virtualObjects.push(virtualObj);
        this.addVirtualObjectToXml(virtualObj);
        this.renderVirtualObjects();

        logger.debug('[NetBtronViewer] 原紙ファイル挿入完了');
    }

    /**
     * ドロップされたファイルを読み込んで親ウィンドウに送信
     * @param {File[]} files - ファイル配列
     * @param {number} clientX - ドロップ位置X
     * @param {number} clientY - ドロップ位置Y
     */
    async readAndSendFiles(files, clientX, clientY) {
        const fileDataList = [];

        for (const file of files) {
            try {
                const arrayBuffer = await file.arrayBuffer();
                const uint8Array = new Uint8Array(arrayBuffer);

                let binary = '';
                const chunkSize = 8192;
                for (let i = 0; i < uint8Array.length; i += chunkSize) {
                    const chunk = uint8Array.subarray(i, Math.min(i + chunkSize, uint8Array.length));
                    binary += String.fromCharCode.apply(null, chunk);
                }
                const base64 = btoa(binary);

                fileDataList.push({
                    name: file.name,
                    type: file.type || 'application/octet-stream',
                    size: file.size,
                    data: base64
                });
            } catch (error) {
                logger.error('[NetBtronViewer] ファイル読み込みエラー:', file.name, error);
            }
        }

        if (fileDataList.length > 0) {
            this.messageBus.send('files-dropped-on-plugin', {
                files: fileDataList,
                clientX: clientX,
                clientY: clientY,
                windowId: this.windowId
            });
        }
    }

    /**
     * unpack-fileから書庫ファイルがドロップされた時の処理
     */
    async insertArchiveFileAsVirtualObject(dragData, clientX, clientY) {
        logger.debug('[NetBtronViewer] 書庫ファイルドロップ検出:', dragData.file.name);

        const listElement = document.getElementById('virtualList');
        const canvas = listElement.querySelector('.virtual-canvas');

        if (!canvas) {
            logger.warn('[NetBtronViewer] キャンバスが見つかりません');
            return;
        }

        const rect = canvas.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;

        this.messageBus.send('archive-drop-detected', {
            dropPosition: { x, y },
            dragData: dragData,
            targetWindowId: dragData.windowId,
            sourceWindowId: this.windowId
        });
    }

    /**
     * ドラッグ&ドロップされた仮身を挿入
     * @param {Object} dragData - ドラッグデータ
     * @param {number} clientX - ドロップ位置X
     * @param {number} clientY - ドロップ位置Y
     */
    insertVirtualObjectFromDrag(dragData, clientX, clientY) {
        const virtualObjects = dragData.virtualObjects || [dragData.virtualObject];
        logger.debug('[NetBtronViewer] 仮身ドロップ受信:', virtualObjects.length, '個', 'モード:', dragData.mode, 'ソースウィンドウID:', dragData.sourceWindowId, '現在のウィンドウID:', this.windowId);

        const isSameWindow = dragData.sourceWindowId === this.windowId;
        if (dragData.mode === 'move' && isSameWindow) {
            logger.debug('[NetBtronViewer] 同じウィンドウ内の移動モード: mouseupイベントで既に処理済みのためスキップ');
            return;
        }

        logger.debug('[NetBtronViewer] 新しい仮身を挿入:', isSameWindow ? 'コピーモード' : '別ウィンドウからの移動/コピー');

        const listElement = document.getElementById('virtualList');
        const canvas = listElement.querySelector('.virtual-canvas');

        if (!canvas) {
            logger.warn('[NetBtronViewer] キャンバスが見つかりません');
            return;
        }

        const rect = canvas.getBoundingClientRect();
        const baseX = clientX - rect.left + canvas.scrollLeft;
        const baseY = clientY - rect.top + canvas.scrollTop;

        virtualObjects.forEach((virtualObjectData, index) => {
            const offsetX = virtualObjectData.offsetX || 0;
            const offsetY = virtualObjectData.offsetY || 0;
            const x = baseX + offsetX;
            const y = baseY + offsetY;

            let width = virtualObjectData.width;
            let heightPx = virtualObjectData.heightPx;

            if (!width || !heightPx) {
                const vobjleft = parseInt(virtualObjectData.link_vobjleft) || 0;
                const vobjright = parseInt(virtualObjectData.link_vobjright) || 0;
                const vobjtop = parseInt(virtualObjectData.link_vobjtop) || 0;
                const vobjbottom = parseInt(virtualObjectData.link_vobjbottom) || 0;

                width = width || (vobjright - vobjleft) || 150;
                heightPx = heightPx || (vobjbottom - vobjtop) || DEFAULT_VOBJ_HEIGHT;
            }

            const virtualObj = {
                link_id: virtualObjectData.link_id,
                link_name: virtualObjectData.link_name,
                vobjleft: Math.max(0, x - (width / 2)),
                vobjtop: Math.max(0, y - (heightPx / 2)),
                vobjright: Math.max(0, x + (width / 2)),
                vobjbottom: Math.max(0, y + (heightPx / 2)),
                width: width,
                heightPx: heightPx,
                chsz: virtualObjectData.chsz,
                frcol: virtualObjectData.frcol,
                chcol: virtualObjectData.chcol,
                tbcol: virtualObjectData.tbcol,
                bgcol: virtualObjectData.bgcol,
                dlen: virtualObjectData.dlen,
                applist: virtualObjectData.applist || {},
                pictdisp: virtualObjectData.pictdisp || 'true',
                namedisp: virtualObjectData.namedisp || 'true',
                roledisp: virtualObjectData.roledisp || 'false',
                typedisp: virtualObjectData.typedisp || 'false',
                updatedisp: virtualObjectData.updatedisp || 'false',
                framedisp: virtualObjectData.framedisp || 'true',
                autoopen: virtualObjectData.autoopen || 'false',
                originalLeft: Math.max(0, x - (virtualObjectData.width / 2)),
                originalTop: Math.max(0, y - (virtualObjectData.heightPx / 2)),
                originalRight: Math.max(0, x + (virtualObjectData.width / 2)),
                originalBottom: Math.max(0, y + (virtualObjectData.heightPx / 2))
            };

            this.virtualObjects.push(virtualObj);
            this.addVirtualObjectToXml(virtualObj);

            if (dragData.mode === 'copy') {
                this.requestCopyVirtualObject(virtualObj.link_id);
            }
        });

        this.renderVirtualObjects();
        this.updateCanvasSize();
        this.saveToFile();

        logger.debug('[NetBtronViewer] 仮身挿入完了');
    }

    // =========================================================
    // ビューモード: ルート実身配置（BPK展開用）
    // =========================================================

    /**
     * ルート実身を配置（ドロップによる配置）
     * @param {Object} rootFileData - ルート実身のデータ
     * @param {number} x - 配置位置X
     * @param {number} y - 配置位置Y
     * @param {string} sourceWindowId - 送信元（unpack-file）のウィンドウID
     */
    insertRootVirtualObject(rootFileData, x, y, sourceWindowId) {
        logger.debug('[NetBtronViewer] ルート実身を配置:', rootFileData.name);
        logger.debug('[NetBtronViewer] rootFileData.applist:', rootFileData.applist);

        const halfHeight = Math.floor(DEFAULT_VOBJ_HEIGHT / 2);
        const vobjTop = Math.max(0, y - halfHeight);
        const virtualObj = {
            link_id: rootFileData.fileId,
            link_name: rootFileData.name,
            vobjleft: Math.max(0, x - 75),
            vobjtop: vobjTop,
            vobjright: Math.max(0, x + 75),
            vobjbottom: vobjTop + DEFAULT_VOBJ_HEIGHT,
            width: 150,
            heightPx: DEFAULT_VOBJ_HEIGHT,
            chsz: DEFAULT_FONT_SIZE,
            frcol: DEFAULT_FRCOL,
            chcol: DEFAULT_CHCOL,
            tbcol: DEFAULT_TBCOL,
            bgcol: DEFAULT_BGCOL,
            dlen: 0,
            applist: rootFileData.applist || {},
            originalLeft: Math.max(0, x - 75),
            originalTop: vobjTop,
            originalRight: Math.max(0, x + 75),
            originalBottom: vobjTop + DEFAULT_VOBJ_HEIGHT
        };

        this.virtualObjects.push(virtualObj);
        this.addVirtualObjectToXml(virtualObj);

        const insertAt = this.virtualObjects.length - 1;
        this.addVirtualObjectElement(virtualObj, insertAt);
        this.updateCanvasSize();

        logger.debug('[NetBtronViewer] ルート実身配置完了');

        this.messageBus.send('root-virtual-object-inserted', {
            success: true,
            targetWindowId: sourceWindowId
        });
    }

    // =========================================================
    // ビューモード: 範囲選択ヒットテスト
    // =========================================================

    /**
     * 指定した矩形範囲内にある仮身のインデックスを取得
     * @param {Object} bounds - 矩形範囲 { left, top, right, bottom }
     * @returns {Array<number>} 範囲内の仮身インデックス配列
     */
    getVirtualObjectsInRect(bounds) {
        const indices = [];
        this.virtualObjects.forEach((obj, index) => {
            const objLeft = obj.vobjleft;
            const objTop = obj.vobjtop;
            const objRight = obj.vobjright;
            const objBottom = obj.vobjbottom;

            const intersects = !(objRight < bounds.left ||
                                 objLeft > bounds.right ||
                                 objBottom < bounds.top ||
                                 objTop > bounds.bottom);

            if (intersects) {
                indices.push(index);
            }
        });
        return indices;
    }

    // =========================================================
    // ビューモード: 仮身を開く
    // =========================================================

    /**
     * 仮身を開く（親ウィンドウに仮身リンク先の表示を要求）
     * @param {Object} obj - 仮身オブジェクト
     */
    openVirtualObject(obj) {
        logger.debug('[NetBtronViewer] 仮身を開く:', obj.link_name, obj.link_id);

        const message = {
            linkId: obj.link_id,
            linkName: obj.link_name
        };

        // ビューモード（クラウド実身表示中）の場合、cloudContextを付加
        if (this.isViewMode && this.currentTenantId) {
            message.cloudContext = {
                tenantId: this.currentTenantId
            };
        }

        this.messageBus.send('open-virtual-object', message);
    }

    // =========================================================
    // ビューモード: 仮身属性適用（PluginBaseオーバーライド）
    // =========================================================

    /**
     * 仮身に属性を適用
     * @param {Object} attrs - 適用する属性値
     */
    applyVirtualObjectAttributes(attrs) {
        const vobj = this.contextMenuVirtualObject?.virtualObj || this.getSelectedVirtualObject();
        if (!vobj) return;

        const vobjIndex = this.virtualObjects.indexOf(vobj);
        const oldChsz = parseInt(vobj.chsz) || DEFAULT_FONT_SIZE;

        const changes = this._applyVobjAttrs(vobj, attrs);

        if (!this._hasVobjAttrChanges(changes)) {
            logger.debug('[NetBtronViewer] 属性に変更がないため処理をスキップ');
            return;
        }

        for (const [key, change] of Object.entries(changes)) {
            logger.debug(`[NetBtronViewer] ${key}変更:`, change.old, '->', change.new);
        }

        const chszChanged = this._isVobjAttrChanged(changes, 'chsz');
        const pictdispChanged = this._isVobjAttrChanged(changes, 'pictdisp');

        if (chszChanged) {
            const newChsz = parseInt(vobj.chsz);

            const vobjElement = document.querySelector(`[data-vobj-index="${vobjIndex}"]`);
            const hasContentArea = vobjElement ?
                (vobjElement.querySelector('.virtual-object-content-area') !== null ||
                 vobjElement.querySelector('.virtual-object-content-iframe') !== null) : false;

            const vobjHeight = vobj.vobjbottom - vobj.vobjtop;
            const vobjWidth = vobj.vobjright - vobj.vobjleft;

            logger.debug('[NetBtronViewer] chsz変更:', {
                oldChsz,
                newChsz,
                vobjHeight,
                hasContentArea
            });

            if (!hasContentArea) {
                const lineHeight = DEFAULT_LINE_HEIGHT;
                const newChszPx = window.convertPtToPx(newChsz);
                const textHeight = Math.ceil(newChszPx * lineHeight);
                const newHeight = textHeight + VOBJ_PADDING_VERTICAL;
                vobj.vobjbottom = vobj.vobjtop + newHeight;
                logger.debug('[NetBtronViewer] 閉じた仮身の高さを調整:', vobjHeight, '->', newHeight, `(${newChsz}pt = ${newChszPx}px)`);
            } else {
                const lineHeight = DEFAULT_LINE_HEIGHT;
                const newChszPx = window.convertPtToPx(newChsz);
                const textHeight = Math.ceil(newChszPx * lineHeight);
                const newMinOpenHeight = textHeight + VOBJ_MIN_OPEN_HEIGHT_OFFSET;
                const heightRatio = newChsz / oldChsz;
                const adjustedHeight = Math.max(newMinOpenHeight, Math.round(vobjHeight * heightRatio));
                vobj.vobjbottom = vobj.vobjtop + adjustedHeight;
                logger.debug('[NetBtronViewer] 開いた仮身の高さを比例調整:', vobjHeight, '->', adjustedHeight, 'ratio:', heightRatio);
            }

            const newChszPx = window.convertPtToPx(newChsz);
            const minWidth = Math.max(50, newChszPx * 6);
            if (vobjWidth < minWidth) {
                vobj.vobjright = vobj.vobjleft + minWidth;
                logger.debug('[NetBtronViewer] 最小幅を確保:', vobjWidth, '->', minWidth);
            }
        }

        if (pictdispChanged && !chszChanged) {
            const vobjElement = document.querySelector(`[data-vobj-index="${vobjIndex}"]`);
            const hasContentArea = vobjElement ?
                (vobjElement.querySelector('.virtual-object-content-area') !== null ||
                 vobjElement.querySelector('.virtual-object-content-iframe') !== null) : false;

            if (!hasContentArea) {
                const currentHeight = vobj.vobjbottom - vobj.vobjtop;
                const chsz = parseInt(vobj.chsz) || DEFAULT_FONT_SIZE;
                const lineHeight = DEFAULT_LINE_HEIGHT;
                const chszPx = window.convertPtToPx(chsz);
                const textHeight = Math.ceil(chszPx * lineHeight);
                const newHeight = textHeight + VOBJ_PADDING_VERTICAL;

                if (currentHeight !== newHeight) {
                    vobj.vobjbottom = vobj.vobjtop + newHeight;
                    logger.debug('[NetBtronViewer] pictdisp変更による高さ調整:', currentHeight, '->', newHeight);
                }
            }
        }

        this.updateVirtualObjectInXml(vobj);
        delete vobj.opened;

        const vobjElement = document.querySelector(`[data-vobj-index="${vobjIndex}"]`);
        const iframe = vobjElement ? vobjElement.querySelector('.virtual-object-content-iframe') : null;

        if (vobjElement && iframe) {
            logger.debug('[NetBtronViewer] 開いた仮身の属性を更新:', vobj.link_name);

            const bgcolChanged = attrs.bgcol !== undefined;
            const onlyBgcolChanged = bgcolChanged &&
                Object.keys(attrs).filter(key => attrs[key] !== undefined).length === 1;

            if (onlyBgcolChanged) {
                if (iframe.contentWindow) {
                    iframe.contentWindow.postMessage({
                        type: 'update-background-color',
                        bgcol: vobj.bgcol
                    }, '*');
                    logger.debug('[NetBtronViewer] 開いた仮身のiframeに背景色変更を通知:', vobj.bgcol);
                }
            } else {
                this.renderVirtualObjects();
            }
        } else {
            this.renderVirtualObjects();
        }

        logger.debug('[NetBtronViewer] 仮身属性を適用:', attrs);
    }

    // =========================================================
    // ビューモード: PluginBaseフックメソッドオーバーライド
    // =========================================================

    /**
     * ドラッグモード変更時のフック（PluginBaseから呼び出される）
     * @param {string} newMode - 新しいドラッグモード ('move' | 'copy')
     */
    onDragModeChanged(newMode) {
        logger.debug('[NetBtronViewer] ドラッグモード変更:', newMode);
    }

    /**
     * クロスウィンドウドロップ成功時に元の仮身を削除（PluginBaseから呼び出される）
     * @param {Object} data - ドロップデータ
     */
    onDeleteSourceVirtualObject(data) {
        logger.debug('[NetBtronViewer] [Hook] onDeleteSourceVirtualObject:', data);

        if (data.virtualObjects) {
            logger.debug('[NetBtronViewer] クロスウィンドウmove: 元ウィンドウから仮身を削除', data.virtualObjects.length, '個');

            data.virtualObjects.forEach(vobj => {
                let index = -1;

                if (vobj.originalVobjLeft !== undefined && vobj.originalVobjTop !== undefined) {
                    index = this.virtualObjects.findIndex(v =>
                        v.link_id === vobj.link_id &&
                        v.vobjleft === vobj.originalVobjLeft &&
                        v.vobjtop === vobj.originalVobjTop
                    );
                    logger.debug('[NetBtronViewer] 位置情報を使って検索:', vobj.link_name, '位置:', vobj.originalVobjLeft, vobj.originalVobjTop, 'index:', index);
                } else {
                    index = this.virtualObjects.findIndex(v => v.link_id === vobj.link_id);
                    logger.debug('[NetBtronViewer] link_idのみで検索:', vobj.link_name, 'index:', index);
                }

                if (index !== -1) {
                    logger.debug('[NetBtronViewer] 仮身を削除:', vobj.link_name, 'index:', index);
                    this.removeVirtualObjectFromXml(vobj, index);
                    this.virtualObjects.splice(index, 1);
                } else {
                    logger.warn('[NetBtronViewer] 削除対象の仮身が見つかりません:', vobj.link_name);
                }
            });

            this.renderVirtualObjects();
            this.saveToFile();
        }
    }

    /**
     * 最後に選択したテナントIDをlocalStorageに保存
     * @param {string} tenantId - テナントID
     */
    saveLastTenantId(tenantId) {
        try {
            localStorage.setItem('net-btron-last-tenant', tenantId);
        } catch (e) {
            logger.debug('[NetBtronViewer] localStorage保存エラー:', e.message);
        }
    }

    /**
     * 最後に選択したテナントIDをlocalStorageから取得
     * @returns {string|null} テナントID
     */
    getLastTenantId() {
        try {
            return localStorage.getItem('net-btron-last-tenant');
        } catch (e) {
            logger.debug('[NetBtronViewer] localStorage読み込みエラー:', e.message);
            return null;
        }
    }

    /**
     * クロスウィンドウドロップ成功後のクリーンアップ（PluginBaseから呼び出される）
     * @param {Object} data - ドロップデータ
     */
    onCrossWindowDropSuccess(data) {
        logger.debug('[NetBtronViewer] [Hook] onCrossWindowDropSuccess:', data);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.netBtronViewer = new NetBtronViewer();

    window.addEventListener('resize', () => {
        if (window.netBtronViewer && window.netBtronViewer.isViewMode) {
            window.netBtronViewer.updateCanvasSize();
        }
    });
});
