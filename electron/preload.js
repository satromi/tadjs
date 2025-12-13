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
    deleteFile: (filePath) => ipcRenderer.invoke('delete-file', filePath)
};
