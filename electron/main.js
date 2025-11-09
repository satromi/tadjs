const electron = require('electron');

// Electronモジュールの型を確認（パスが返される場合がある）
if (typeof electron === 'string') {
    console.error('Electronが文字列として読み込まれました:', electron);
    console.error('Electronアプリとして正しく実行されていません');
    process.exit(1);
}

const { app, BrowserWindow, ipcMain, Menu, dialog } = electron;
const path = require('path');
const fs = require('fs');

let mainWindow;
let pluginManager;

// アプリケーションのルートディレクトリを取得
// 開発時: プロジェクトルート
// パッケージ化後: 実行ファイルのあるディレクトリ
function getAppRootDir() {
    if (app.isPackaged) {
        // パッケージ化された場合: 実行ファイルのディレクトリ
        return path.dirname(app.getPath('exe'));
    } else {
        // 開発時: electron/main.jsから1階層上がプロジェクトルート
        return path.join(__dirname, '..');
    }
}

// プラグインマネージャークラス
class PluginManager {
    constructor() {
        this.plugins = new Map();
        this.appRoot = getAppRootDir();

        // プラグインディレクトリの候補を設定
        // 1. 実行ファイルと同じ階層のpluginsフォルダ（カスタムプラグイン用）
        // 2. resources/app/pluginsフォルダ（パッケージに含まれるプラグイン用）
        this.pluginDirs = [];

        // 実行ファイルと同じ階層のpluginsフォルダ
        const exePluginDir = path.join(this.appRoot, 'plugins');
        if (fs.existsSync(exePluginDir)) {
            this.pluginDirs.push(exePluginDir);
        }

        // パッケージ化されている場合、resources/app/pluginsもチェック
        if (app.isPackaged) {
            const resourcePluginDir = path.join(process.resourcesPath, 'app', 'plugins');
            if (fs.existsSync(resourcePluginDir) && resourcePluginDir !== exePluginDir) {
                this.pluginDirs.push(resourcePluginDir);
            }
        }

        console.log('アプリケーションルート:', this.appRoot);
        console.log('プラグインディレクトリ:', this.pluginDirs);
    }

    // プラグインディレクトリをスキャン
    async loadPlugins() {
        try {
            // プラグインディレクトリが1つもない場合、デフォルトの場所に作成
            if (this.pluginDirs.length === 0) {
                const defaultPluginDir = path.join(this.appRoot, 'plugins');
                fs.mkdirSync(defaultPluginDir, { recursive: true });
                this.pluginDirs.push(defaultPluginDir);
                console.log('プラグインディレクトリを作成しました:', defaultPluginDir);
                return;
            }

            // すべてのプラグインディレクトリをスキャン
            for (const pluginDir of this.pluginDirs) {
                console.log('プラグインディレクトリをスキャン:', pluginDir);

                const pluginFolders = fs.readdirSync(pluginDir, { withFileTypes: true })
                    .filter(dirent => dirent.isDirectory())
                    .map(dirent => dirent.name);

                for (const folderName of pluginFolders) {
                    await this.loadPlugin(pluginDir, folderName);
                }
            }

            console.log(`${this.plugins.size}個のプラグインを読み込みました`);
        } catch (error) {
            console.error('プラグイン読み込みエラー:', error);
        }
    }

    // 個別プラグインを読み込み
    async loadPlugin(pluginDir, folderName) {
        try {
            const pluginPath = path.join(pluginDir, folderName);
            const manifestPath = path.join(pluginPath, 'plugin.json');

            if (!fs.existsSync(manifestPath)) {
                console.warn(`${folderName}: plugin.jsonが見つかりません`);
                return;
            }

            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

            // 既に同じIDのプラグインが読み込まれている場合はスキップ
            if (this.plugins.has(manifest.id)) {
                console.log(`プラグイン ${manifest.id} は既に読み込まれています。スキップします。`);
                return;
            }

            // プラグイン情報を保存
            this.plugins.set(manifest.id, {
                id: manifest.id,
                name: manifest.name,
                version: manifest.version,
                type: manifest.type,
                description: manifest.description,
                icon: manifest.icon,
                basefile: manifest.basefile,
                main: path.join(pluginPath, manifest.main || 'index.html'),
                window: manifest.window,
                contextMenu: manifest.contextMenu || [],
                needsCloseConfirmation: manifest.needsCloseConfirmation || false,
                path: pluginPath,
                manifest: manifest
            });

            console.log(`プラグイン読み込み成功: ${manifest.name} (${manifest.id}) from ${pluginDir}`);
        } catch (error) {
            console.error(`プラグイン読み込みエラー (${folderName}):`, error);
        }
    }

    // プラグイン一覧を取得
    getPlugins() {
        return Array.from(this.plugins.values());
    }

    // プラグインを取得
    getPlugin(id) {
        return this.plugins.get(id);
    }
}

// メインウィンドウの作成
function createWindow() {
    // HTMLやリソースファイルのパスを取得
    let htmlPath, iconPath;

    if (app.isPackaged) {
        // パッケージ化された場合: resources/app/以下にある
        htmlPath = path.join(process.resourcesPath, 'app', 'tadjs-desktop.html');
        iconPath = path.join(process.resourcesPath, 'app', 'favicon.svg');
    } else {
        // 開発時: プロジェクトルート
        const appRoot = path.join(__dirname, '..');
        htmlPath = path.join(appRoot, 'tadjs-desktop.html');
        iconPath = path.join(appRoot, 'favicon.svg');
    }

    console.log('HTMLファイルパス:', htmlPath);
    console.log('アイコンパス:', iconPath);
    console.log('ファイル存在確認 - HTML:', fs.existsSync(htmlPath));
    console.log('ファイル存在確認 - Icon:', fs.existsSync(iconPath));

    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true,
            preload: path.join(__dirname, 'preload.js')
        },
        icon: fs.existsSync(iconPath) ? iconPath : undefined,
        // カラープロファイル設定
        backgroundColor: '#FFFFFF'
    });

    // カスタムメニューを作成
    const menuTemplate = [
        {
            label: 'View',
            submenu: [
                {
                    label: 'Toggle Developer Tools',
                    accelerator: process.platform === 'darwin' ? 'Alt+Command+I' : 'Ctrl+Shift+I',
                    click: () => {
                        mainWindow.webContents.toggleDevTools();
                    }
                },
                {
                    label: 'Reload',
                    accelerator: 'CmdOrCtrl+R',
                    click: () => {
                        mainWindow.reload();
                    }
                },
                {
                    label: 'Toggle Full Screen',
                    accelerator: process.platform === 'darwin' ? 'Ctrl+Command+F' : 'F11',
                    click: () => {
                        mainWindow.setFullScreen(!mainWindow.isFullScreen());
                    }
                }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(menuTemplate);
    Menu.setApplicationMenu(menu);

    // メニューバーを初期状態で非表示にする
    mainWindow.setMenuBarVisibility(false);

    mainWindow.loadFile(htmlPath);

    // 開発ツールを開く（デバッグ用に常に開く）
    // mainWindow.webContents.openDevTools();

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// カラープロファイル設定（色が紫っぽくなる問題の対策）
app.commandLine.appendSwitch('force-color-profile', 'srgb');

// アプリケーション起動
app.whenReady().then(async () => {
    // プラグインマネージャーを初期化
    pluginManager = new PluginManager();
    await pluginManager.loadPlugins();

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// IPC通信: プラグイン一覧取得
ipcMain.handle('get-plugins', async () => {
    return pluginManager.getPlugins();
});

// IPC通信: プラグイン情報取得
ipcMain.handle('get-plugin', async (event, pluginId) => {
    return pluginManager.getPlugin(pluginId);
});

// IPC通信: ファイル読み込みダイアログ
ipcMain.handle('open-file-dialog', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [
            { name: 'TAD Files', extensions: ['tad', 'TAD'] },
            { name: 'BPK Files', extensions: ['bpk', 'BPK'] },
            { name: 'All Files', extensions: ['*'] }
        ]
    });

    if (!result.canceled && result.filePaths.length > 0) {
        const filePath = result.filePaths[0];
        const fileData = fs.readFileSync(filePath);
        return {
            path: filePath,
            name: path.basename(filePath),
            data: Array.from(fileData)
        };
    }

    return null;
});

// IPC通信: ファイル保存ダイアログ
ipcMain.handle('save-file-dialog', async (event, defaultName) => {
    const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: defaultName,
        filters: [
            { name: 'TAD Files', extensions: ['tad'] },
            { name: 'XML Files', extensions: ['xml'] },
            { name: 'All Files', extensions: ['*'] }
        ]
    });

    return result.canceled ? null : result.filePath;
});

// IPC通信: ファイル保存
ipcMain.handle('save-file', async (event, filePath, data) => {
    try {
        const buffer = Buffer.from(data);
        fs.writeFileSync(filePath, buffer);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// IPC通信: ファイル読み込み
ipcMain.handle('read-file', async (event, filePath) => {
    try {
        const fileData = fs.readFileSync(filePath);
        return {
            success: true,
            data: Array.from(fileData)
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// IPC通信: ファイル削除
ipcMain.handle('delete-file', async (event, filePath) => {
    try {
        fs.unlinkSync(filePath);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// IPC通信: メニューバーの表示/非表示
ipcMain.on('set-menu-bar-visibility', (event, visible) => {
    if (mainWindow) {
        mainWindow.setMenuBarVisibility(visible);
    }
});
