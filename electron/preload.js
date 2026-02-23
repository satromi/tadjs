// Preloadスクリプト - レンダラープロセスとメインプロセス間の安全な通信
const { ipcRenderer } = require('electron');

// contextIsolation: falseの場合は、直接windowに追加
// nodeIntegration: trueなので、レンダラープロセスで直接requireできますが、
// 念のためAPIを提供しておきます
window.electronAPI = {
    // プラグイン関連
    getPlugins: () => ipcRenderer.invoke('get-plugins'),
    getPlugin: (pluginId) => ipcRenderer.invoke('get-plugin', pluginId),

    // ファイル操作
    openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
    openFolderDialog: () => ipcRenderer.invoke('open-folder-dialog'),
    saveFileDialog: (defaultName) => ipcRenderer.invoke('save-file-dialog', defaultName),
    saveFile: (filePath, data) => ipcRenderer.invoke('save-file', filePath, data),
    readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
    deleteFile: (filePath) => ipcRenderer.invoke('delete-file', filePath),

    // フルスクリーン制御
    enterFullscreen: () => ipcRenderer.invoke('enter-fullscreen'),
    exitFullscreen: () => ipcRenderer.invoke('exit-fullscreen'),

    // クリップボード操作
    clipboardReadText: () => ipcRenderer.invoke('clipboard-read-text'),
    clipboardWriteText: (text) => ipcRenderer.invoke('clipboard-write-text', text),

    // PTY（疑似端末）操作
    ptySpawn: (options) => ipcRenderer.invoke('pty-spawn', options),
    ptyWrite: (windowId, data) => ipcRenderer.invoke('pty-write', { windowId, data }),
    ptyResize: (windowId, cols, rows) => ipcRenderer.invoke('pty-resize', { windowId, cols, rows }),
    ptyKill: (windowId) => ipcRenderer.invoke('pty-kill', { windowId }),
    onPtyData: (callback) => ipcRenderer.on('pty-data', (event, data) => callback(data)),
    onPtyExit: (callback) => ipcRenderer.on('pty-exit', (event, data) => callback(data))
};

// Net-BTRON クラウド実身共有 API
window.cloudAPI = {
    // 初期化
    initialize: (config) => ipcRenderer.invoke('cloud-initialize', config),

    // 認証
    signIn: (email, password) => ipcRenderer.invoke('cloud-sign-in', { email, password }),
    signInWithOAuth: (provider) => ipcRenderer.invoke('cloud-sign-in-oauth', { provider }),
    signUp: (email, password) => ipcRenderer.invoke('cloud-sign-up', { email, password }),
    signOut: () => ipcRenderer.invoke('cloud-sign-out'),
    getSession: () => ipcRenderer.invoke('cloud-get-session'),

    // 招待管理
    createInvite: (tenantId, email, role) => ipcRenderer.invoke('cloud-create-invite', { tenantId, email, role }),
    getInviteByToken: (token) => ipcRenderer.invoke('cloud-get-invite-by-token', { token }),
    consumeInvite: (token) => ipcRenderer.invoke('cloud-consume-invite', { token }),
    listInvites: (tenantId) => ipcRenderer.invoke('cloud-list-invites', { tenantId }),
    revokeInvite: (inviteId) => ipcRenderer.invoke('cloud-revoke-invite', { inviteId }),

    // システムロール管理
    getMyProfile: () => ipcRenderer.invoke('cloud-get-my-profile'),
    updateUserSystemRole: (userId, role) => ipcRenderer.invoke('cloud-update-user-system-role', { userId, role }),
    listUsers: () => ipcRenderer.invoke('cloud-list-users'),

    // テナント
    getTenants: () => ipcRenderer.invoke('cloud-get-tenants'),
    createTenant: (name, visibility) => ipcRenderer.invoke('cloud-create-tenant', { name, visibility }),
    updateTenantVisibility: (tenantId, visibility) => ipcRenderer.invoke('cloud-update-tenant-visibility', { tenantId, visibility }),
    getTenantByName: (name) => ipcRenderer.invoke('cloud-get-tenant-by-name', { name }),
    deleteTenant: (tenantId) => ipcRenderer.invoke('cloud-delete-tenant', { tenantId }),

    // テナントメンバー管理
    listTenantMembers: (tenantId) => ipcRenderer.invoke('cloud-list-tenant-members', { tenantId }),
    addTenantMember: (tenantId, email, role) => ipcRenderer.invoke('cloud-add-tenant-member', { tenantId, email, role }),
    removeTenantMember: (tenantId, userId) => ipcRenderer.invoke('cloud-remove-tenant-member', { tenantId, userId }),

    // 実身操作
    listRealObjects: (tenantId) => ipcRenderer.invoke('cloud-list-real-objects', { tenantId }),
    uploadRealObject: (tenantId, realObject, files) => ipcRenderer.invoke('cloud-upload-real-object', { tenantId, realObject, files }),
    uploadRealObjectVersioned: (tenantId, realObject, files, expectedVersion) => ipcRenderer.invoke('cloud-upload-real-object-versioned', { tenantId, realObject, files, expectedVersion }),
    downloadRealObject: (tenantId, realId) => ipcRenderer.invoke('cloud-download-real-object', { tenantId, realId }),
    downloadFile: (tenantId, realId, fileName) => ipcRenderer.invoke('cloud-download-file', { tenantId, realId, fileName }),
    deleteRealObject: (tenantId, realId) => ipcRenderer.invoke('cloud-delete-real-object', { tenantId, realId }),

    // 多階層実身操作
    getRealObjectsMetadata: (tenantId, realIds) => ipcRenderer.invoke('cloud-get-real-objects-metadata', { tenantId, realIds }),
    deleteRealObjectWithChildren: (tenantId, realId) => ipcRenderer.invoke('cloud-delete-real-object-with-children', { tenantId, realId }),

    // バージョン管理
    saveRealObjectWithVersion: (tenantId, realObject, files, expectedVersion) => ipcRenderer.invoke('cloud-save-real-object-with-version', { tenantId, realObject, files, expectedVersion }),
    getVersionHistory: (tenantId, realId, limit) => ipcRenderer.invoke('cloud-get-version-history', { tenantId, realId, limit }),
    downloadVersionFiles: (tenantId, realId, version) => ipcRenderer.invoke('cloud-download-version-files', { tenantId, realId, version }),
    getVersionDiff: (tenantId, realId, version) => ipcRenderer.invoke('cloud-get-version-diff', { tenantId, realId, version }),

    // 容量管理
    getTenantQuota: (tenantId) => ipcRenderer.invoke('cloud-get-tenant-quota', { tenantId }),

    // 共有管理
    listShares: (objectId) => ipcRenderer.invoke('cloud-list-shares', { objectId }),
    createShare: (objectId, email, permission) => ipcRenderer.invoke('cloud-create-share', { objectId, email, permission }),
    deleteShare: (shareId) => ipcRenderer.invoke('cloud-delete-share', { shareId }),
    listSharedWithMe: () => ipcRenderer.invoke('cloud-list-shared-with-me'),

    // リアルタイム通知（メインプロセスからのイベント受信）
    onRealtimeEvent: (callback) => ipcRenderer.on('cloud-realtime-event', (event, data) => callback(data)),
    subscribeToTenant: (tenantId) => ipcRenderer.invoke('cloud-subscribe-tenant', { tenantId }),
    unsubscribeFromTenant: (tenantId) => ipcRenderer.invoke('cloud-unsubscribe-tenant', { tenantId })
};
