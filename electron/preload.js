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
