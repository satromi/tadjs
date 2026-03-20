/**
 * electron/main.js
 * TADjs Desktop アプリケーションのメインプロセス
 *
 */

const electron = require('electron');
const { getLogger } = require('./logger.cjs');

const logger = getLogger('Main');

// Electronモジュールの型を確認（パスが返される場合がある）
if (typeof electron === 'string') {
    logger.error('Electronが文字列として読み込まれました:', electron);
    logger.error('Electronアプリとして正しく実行されていません');
    process.exit(1);
}

const { app, BrowserWindow, ipcMain, Menu, dialog, shell } = electron;
const path = require('path');
const fs = require('fs');
const { registerFontIpcHandlers, getFontAllNames, getFontDirectories, findFontFile, getSystemFontsViaDirectWrite } = require('./ipc-font');
const { registerCloudIpcHandlers } = require('./ipc-cloud');
const { PtyManager } = require('./pty-manager');

// PTYマネージャー
const ptyManager = new PtyManager();

// winreg は Windows 専用なので条件付きで読み込み
let winreg = null;
if (process.platform === 'win32') {
    try {
        winreg = require('winreg');
    } catch (e) {
        logger.warn('[Main] winreg module not available');
    }
}

// CloudAccessManager（Net-BTRONクラウド実身共有）
let cloudAccessManager = null;
try {
    const { CloudAccessManager } = require('./cloud-access-manager');
    cloudAccessManager = new CloudAccessManager();
    // セッション永続化用のファイルパスを設定
    cloudAccessManager._sessionFilePath = path.join(app.getPath('userData'), 'net-btron-session');
    logger.info('CloudAccessManager loaded successfully');
} catch (e) {
    logger.warn('CloudAccessManager not available:', e.message);
}

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

        logger.info('アプリケーションルート:', this.appRoot);
        logger.info('プラグインディレクトリ:', this.pluginDirs);
    }

    // プラグインディレクトリをスキャン
    async loadPlugins() {
        try {
            // プラグインディレクトリが1つもない場合、デフォルトの場所に作成
            if (this.pluginDirs.length === 0) {
                const defaultPluginDir = path.join(this.appRoot, 'plugins');
                fs.mkdirSync(defaultPluginDir, { recursive: true });
                this.pluginDirs.push(defaultPluginDir);
                logger.info('プラグインディレクトリを作成しました:', defaultPluginDir);
                return;
            }

            // すべてのプラグインディレクトリをスキャン
            for (const pluginDir of this.pluginDirs) {
                logger.debug('プラグインディレクトリをスキャン:', pluginDir);

                const pluginFolders = fs.readdirSync(pluginDir, { withFileTypes: true })
                    .filter(dirent => dirent.isDirectory())
                    .map(dirent => dirent.name);

                for (const folderName of pluginFolders) {
                    await this.loadPlugin(pluginDir, folderName);
                }
            }

            logger.info(`${this.plugins.size}個のプラグインを読み込みました`);
        } catch (error) {
            logger.error('プラグイン読み込みエラー:', error);
        }
    }

    // 個別プラグインを読み込み
    async loadPlugin(pluginDir, folderName) {
        try {
            const pluginPath = path.join(pluginDir, folderName);
            const manifestPath = path.join(pluginPath, 'plugin.json');

            if (!fs.existsSync(manifestPath)) {
                logger.warn(`${folderName}: plugin.jsonが見つかりません`);
                return;
            }

            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

            // 既に同じIDのプラグインが読み込まれている場合はスキップ
            if (this.plugins.has(manifest.id)) {
                logger.debug(`プラグイン ${manifest.id} は既に読み込まれています。スキップします。`);
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

            logger.debug(`プラグイン読み込み成功: ${manifest.name} (${manifest.id}) from ${pluginDir}`);
        } catch (error) {
            logger.error(`プラグイン読み込みエラー (${folderName}):`, error);
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

    logger.debug('HTMLファイルパス:', htmlPath);
    logger.debug('アイコンパス:', iconPath);
    logger.debug('ファイル存在確認 - HTML:', fs.existsSync(htmlPath));
    logger.debug('ファイル存在確認 - Icon:', fs.existsSync(iconPath));

    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: true,
            nodeIntegrationInSubFrames: true,
            contextIsolation: false,
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

    // 外部URLへのナビゲーションを防ぐ（URLドロップ時にブラウザ表示される問題の対策）
    mainWindow.webContents.on('will-navigate', (event, url) => {
        // file://以外のプロトコルへのナビゲーションを防ぐ
        if (!url.startsWith('file://')) {
            logger.debug('[Main] 外部URLへのナビゲーションをブロック:', url);
            event.preventDefault();
        }
    });

    // 新しいウィンドウを開くことも防ぐ
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (!url.startsWith('file://')) {
            logger.debug('[Main] 外部URLへの新規ウィンドウをブロック:', url);
            return { action: 'deny' };
        }
        return { action: 'allow' };
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// カラープロファイル設定（色が紫っぽくなる問題の対策）
app.commandLine.appendSwitch('force-color-profile', 'srgb');

// Linux向け: 日本語ロケール設定（文字化け対策）
if (process.platform === 'linux') {
    app.commandLine.appendSwitch('lang', 'ja-JP');
}

// MCPサーバモード判定
// --mcp フラグ（Electron内部spawn用）または TADJS_MCP_MODE 環境変数（外部プロセス用）
// 外部プロセスからの起動時はElectron/Chromiumが --mcp を不正な引数として拒否するため、
// 環境変数で代替する
const isMcpMode = process.argv.includes('--mcp') || process.env.TADJS_MCP_MODE === '1';

if (isMcpMode) {
    // MCPモード: stdioサーバとして起動（GUIなし）
    // console.logがstdoutに出力されるとMCPプロトコルが壊れるためstderrにリダイレクト
    const originalConsoleLog = console.log;
    console.log = (...args) => console.error('[MCP]', ...args);

    console.error('[MCP] MCPモード開始 process.argv:', JSON.stringify(process.argv));
    console.error('[MCP] PID:', process.pid);

    // プロセス終了時のログ
    process.on('exit', (code) => {
        console.error(`[MCP] プロセス終了 code=${code}`);
    });
    process.on('beforeExit', (code) => {
        console.error(`[MCP] beforeExit code=${code}`);
    });
    process.on('uncaughtException', (err) => {
        console.error('[MCP] uncaughtException:', err.stack || err);
    });
    process.on('unhandledRejection', (reason) => {
        console.error('[MCP] unhandledRejection:', reason);
    });

    console.error('[MCP] app.whenReady() 待機中...');
    app.whenReady().then(async () => {
        console.error('[MCP] app.whenReady() 完了');
        try {
            // MCP有効設定を確認（--forceオプションまたはTADJS_MCP_FORCE環境変数で設定を無視可能）
            const forceMode = process.argv.includes('--force') || process.env.TADJS_MCP_FORCE === '1';
            console.error(`[MCP] forceMode=${forceMode}`);
            if (!forceMode) {
                const mcpConfigPath = path.join(getAppRootDir(), 'mcp-config.json');
                console.error(`[MCP] 設定ファイル確認: ${mcpConfigPath}`);
                try {
                    const configData = fs.readFileSync(mcpConfigPath, 'utf-8');
                    const config = JSON.parse(configData);
                    if (!config.enabled) {
                        console.error('[MCP] MCPサーバは無効に設定されています。システム環境設定で有効にしてください。');
                        process.exit(0);
                    }
                    console.error('[MCP] 設定ファイル: enabled=true');
                } catch (readErr) {
                    // 設定ファイルが存在しない場合はデフォルトで無効
                    console.error('[MCP] MCP設定ファイルが見つかりません。システム環境設定でMCPサーバを有効にしてください。');
                    process.exit(0);
                }
            }

            console.error('[MCP] mcp-server.js を require 中...');
            const { startMcpServer } = require('./mcp/mcp-server');
            console.error('[MCP] mcp-server.js require 完了');
            const dataFolderIdx = process.argv.indexOf('--data-folder');
            const dataFolder = dataFolderIdx >= 0
                ? process.argv[dataFolderIdx + 1]
                : (process.env.TADJS_MCP_DATA_FOLDER || path.join(getAppRootDir(), 'data'));
            console.error(`[MCP] dataFolder=${dataFolder}`);
            console.error('[MCP] startMcpServer() 呼び出し中...');
            await startMcpServer(dataFolder);
            console.error('[MCP] startMcpServer() 完了 - サーバ稼働中');
        } catch (err) {
            console.error('[MCP] サーバ起動エラー:', err.stack || err);
            process.exit(1);
        }
    }).catch(err => {
        console.error('[MCP] app.whenReady() エラー:', err.stack || err);
        process.exit(1);
    });
} else {

// 二重起動防止
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    // 既に別のインスタンスが起動している場合、即座に終了
    app.quit();
} else {
    // 2つ目のインスタンスが起動しようとした時
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        // 最初のインスタンスのウィンドウにフォーカスを当てる
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });

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
}

} // isMcpMode else ブロック終了

app.on('window-all-closed', () => {
    // MCPモードではGUIなしで動作するため、app.quit()を呼ばない
    if (!isMcpMode && process.platform !== 'darwin') {
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
        const fileData = await fs.promises.readFile(filePath);
        return {
            path: filePath,
            name: path.basename(filePath),
            data: Array.from(fileData)
        };
    }

    return null;
});

// IPC通信: フォルダ選択ダイアログ
ipcMain.handle('open-folder-dialog', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: 'データ配置フォルダを選択'
    });

    if (!result.canceled && result.filePaths.length > 0) {
        return {
            folderPath: result.filePaths[0]
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

// パストラバーサル対策: ファイルパスがアプリケーションの許可ディレクトリ内かを検証
function isPathAllowed(filePath) {
    const resolved = path.resolve(filePath);
    const appDir = getAppRootDir();
    const userDataDir = app.getPath('userData');
    const tempDir = app.getPath('temp');
    // アプリケーションディレクトリ、ユーザーデータ、テンポラリのいずれかの配下であること
    return resolved.startsWith(appDir + path.sep) ||
           resolved.startsWith(userDataDir + path.sep) ||
           resolved.startsWith(tempDir + path.sep) ||
           resolved === appDir ||
           resolved === userDataDir;
}

// IPC通信: ファイル保存
ipcMain.handle('save-file', async (event, filePath, data) => {
    try {
        if (!isPathAllowed(filePath)) {
            logger.warn('[Main] ファイル保存: 許可されていないパス:', filePath);
            return { success: false, error: '許可されていないパスです' };
        }
        const buffer = Buffer.from(data);
        await fs.promises.writeFile(filePath, buffer);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// IPC通信: ファイル読み込み
ipcMain.handle('read-file', async (event, filePath) => {
    try {
        if (!isPathAllowed(filePath)) {
            logger.warn('[Main] ファイル読み込み: 許可されていないパス:', filePath);
            return { success: false, error: '許可されていないパスです' };
        }
        const fileData = await fs.promises.readFile(filePath);
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
        if (!isPathAllowed(filePath)) {
            logger.warn('[Main] ファイル削除: 許可されていないパス:', filePath);
            return { success: false, error: '許可されていないパスです' };
        }
        await fs.promises.unlink(filePath);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// IPC通信: フルスクリーン開始
ipcMain.handle('enter-fullscreen', async () => {
    if (mainWindow && !mainWindow.isFullScreen()) {
        mainWindow.setFullScreen(true);
        return { success: true };
    }
    return { success: false };
});

// IPC通信: フルスクリーン終了
ipcMain.handle('exit-fullscreen', async () => {
    if (mainWindow && mainWindow.isFullScreen()) {
        mainWindow.setFullScreen(false);
        return { success: true };
    }
    return { success: false };
});

// IPC通信: クリップボードからテキスト読み取り
ipcMain.handle('clipboard-read-text', async () => {
    return electron.clipboard.readText();
});

// IPC通信: クリップボードにテキスト書き込み
ipcMain.handle('clipboard-write-text', async (event, text) => {
    electron.clipboard.writeText(text);
    return { success: true };
});

// MCPサーバ子プロセス管理
let mcpChildProcess = null;

// レンダラーにMCPログを転送するヘルパー
function sendMcpLog(message) {
    logger.info(message);
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('mcp-server-log', message);
    }
}

// IPC通信: MCPサーバ起動
ipcMain.handle('start-mcp-server', async () => {
    if (mcpChildProcess) {
        return { success: false, error: 'MCPサーバは既に起動しています' };
    }
    try {
        const { spawn } = require('child_process');
        const exePath = app.getPath('exe');
        const dataFolder = path.join(getAppRootDir(), 'data');
        // Electronの二重起動競合を避けるため、別のユーザーデータディレクトリを使用
        const mcpUserDataDir = path.join(app.getPath('userData'), 'mcp-server');
        const spawnArgs = [
            '--mcp', '--force',
            '--data-folder', dataFolder,
            '--user-data-dir=' + mcpUserDataDir
        ];
        sendMcpLog(`[MCP] 起動コマンド: ${exePath}`);
        sendMcpLog(`[MCP] 起動引数: ${JSON.stringify(spawnArgs)}`);
        mcpChildProcess = spawn(exePath, spawnArgs, {
            stdio: ['pipe', 'pipe', 'pipe'],
            detached: false
        });
        sendMcpLog(`[MCP] 子プロセス PID: ${mcpChildProcess.pid}`);
        // stderrを監視（MCPモードの全ログはstderrに出力される）→レンダラーに転送
        mcpChildProcess.stderr.on('data', (data) => {
            sendMcpLog(`[MCP-stderr] ${data.toString().trim()}`);
        });
        mcpChildProcess.stdout.on('data', (data) => {
            sendMcpLog(`[MCP-stdout] ${data.toString().substring(0, 500)}`);
        });
        mcpChildProcess.on('exit', (code, signal) => {
            sendMcpLog(`[MCP] 子プロセス終了 code=${code} signal=${signal}`);
            mcpChildProcess = null;
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('mcp-server-status', { running: false, exitCode: code, signal });
            }
        });
        mcpChildProcess.on('error', (err) => {
            sendMcpLog(`[MCP] spawnエラー: ${err.message}`);
            mcpChildProcess = null;
        });
        sendMcpLog('[MCP] spawn完了、子プロセス起動待ち...');
        return { success: true, pid: mcpChildProcess.pid, exePath, args: spawnArgs };
    } catch (err) {
        sendMcpLog(`[MCP] 起動例外: ${err.message}`);
        mcpChildProcess = null;
        return { success: false, error: err.message };
    }
});

// IPC通信: MCPサーバ停止
ipcMain.handle('stop-mcp-server', async () => {
    if (!mcpChildProcess) {
        return { success: false, error: 'MCPサーバは起動していません' };
    }
    try {
        const proc = mcpChildProcess;
        mcpChildProcess = null;
        if (!proc.killed) {
            proc.kill('SIGTERM');
            // Windowsではkillが効かない場合があるためタイムアウト後にSIGKILL
            setTimeout(() => {
                try { if (!proc.killed) proc.kill('SIGKILL'); } catch (_) {}
            }, 3000);
        }
        logger.info('[Main] MCPサーバ子プロセスを停止しました');
        return { success: true };
    } catch (err) {
        logger.error('[Main] MCPサーバ停止エラー:', err);
        return { success: false, error: err.message };
    }
});

// IPC通信: MCPサーバ状態取得
ipcMain.handle('get-mcp-server-status', async () => {
    return { running: mcpChildProcess !== null };
});

// IPC通信: MCPサーバにJSON-RPCリクエスト送信（テスト用）
ipcMain.handle('send-mcp-request', async (event, jsonRpcRequest) => {
    if (!mcpChildProcess) {
        return { success: false, error: 'MCPサーバは起動していません' };
    }
    try {
        const requestStr = typeof jsonRpcRequest === 'string'
            ? jsonRpcRequest
            : JSON.stringify(jsonRpcRequest);
        sendMcpLog(`[MCP-stdin] ${requestStr.substring(0, 300)}`);
        mcpChildProcess.stdin.write(requestStr + '\n');
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// IPC通信: MCP設定の読み込み
ipcMain.handle('get-mcp-config', async () => {
    try {
        const mcpConfigPath = path.join(getAppRootDir(), 'mcp-config.json');
        const configData = await fs.promises.readFile(mcpConfigPath, 'utf-8');
        return { success: true, config: JSON.parse(configData) };
    } catch (err) {
        // ファイルが存在しない場合はデフォルト値を返す
        return { success: true, config: { enabled: false } };
    }
});

// IPC通信: MCP設定の保存
ipcMain.handle('set-mcp-config', async (event, config) => {
    try {
        const mcpConfigPath = path.join(getAppRootDir(), 'mcp-config.json');
        await fs.promises.writeFile(mcpConfigPath, JSON.stringify(config, null, 2), 'utf-8');
        return { success: true };
    } catch (err) {
        logger.error('[Main] MCP設定保存エラー:', err);
        return { success: false, error: err.message };
    }
});

// IPC通信: メニューバーの表示/非表示
ipcMain.on('set-menu-bar-visibility', (event, visible) => {
    if (mainWindow) {
        mainWindow.setMenuBarVisibility(visible);
    }
});

// フォントIPCハンドラを分離モジュールから登録
registerFontIpcHandlers();

// PTY IPCハンドラを分離モジュールから登録
ptyManager.registerHandlers(isPathAllowed);

// クラウドIPCハンドラを分離モジュールから登録
registerCloudIpcHandlers(cloudAccessManager);

// アプリ終了時に全PTYプロセスを終了
app.on('before-quit', () => {
    ptyManager.killAll();
});
