/**
 * electron/main.js
 * TADjs Desktop アプリケーションのメインプロセス
 * 
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

const { app, BrowserWindow, ipcMain, Menu, dialog } = electron;
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const fontList = require('font-list');
const fontkit = require('fontkit');

// node-pty（PTY - 疑似端末）の読み込み
// node-ptyが利用できない場合はchild_processにフォールバック
let pty = null;
let usePtyFallback = false;
try {
    pty = require('node-pty');
    logger.info('node-pty loaded successfully');
} catch (e) {
    logger.warn('node-pty module not available, using child_process fallback:', e.message);
    usePtyFallback = true;
}

const { spawn } = require('child_process');

// PTYプロセス管理（windowId => ptyProcess or childProcess）
const ptyProcesses = new Map();

// winreg は Windows 専用なので条件付きで読み込み
let winreg = null;
if (process.platform === 'win32') {
    try {
        winreg = require('winreg');
    } catch (e) {
        console.warn('winreg module not available');
    }
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

// IPC通信: メニューバーの表示/非表示
ipcMain.on('set-menu-bar-visibility', (event, visible) => {
    if (mainWindow) {
        mainWindow.setMenuBarVisibility(visible);
    }
});

// フォントファイルから複数の名前（日本語名、英語名など）を取得
function getFontAllNames(fontPath, debugFontName = null) {
    try {
        const font = fontkit.openSync(fontPath);
        const nameTable = font['name'];

        if (!nameTable || !Array.isArray(nameTable.records)) {
            return null;
        }

        const names = {
            japanese: null,      // 日本語のフルネーム
            english: null,       // 英語のフルネーム
            japaneseFamily: null, // 日本語のファミリー名
            englishFamily: null   // 英語のファミリー名
        };

        // 日本語フルネーム (Windows platform, Japanese, Full Name)
        const jaFullName = nameTable.records.find(r =>
            r.platformID === 3 && r.languageID === 1041 && r.nameID === 4
        );
        if (jaFullName) {
            names.japanese = jaFullName.value;
        }

        // 日本語ファミリー名
        const jaFamily = nameTable.records.find(r =>
            r.platformID === 3 && r.languageID === 1041 && r.nameID === 1
        );
        if (jaFamily) {
            names.japaneseFamily = jaFamily.value;
        }

        // 英語フルネーム (Windows platform, English US, Full Name)
        const enFullName = nameTable.records.find(r =>
            r.platformID === 3 && r.languageID === 0x0409 && r.nameID === 4
        );
        if (enFullName) {
            names.english = enFullName.value;
        }

        // 英語ファミリー名
        const enFamily = nameTable.records.find(r =>
            r.platformID === 3 && r.languageID === 0x0409 && r.nameID === 1
        );
        if (enFamily) {
            names.englishFamily = enFamily.value;
        }

        return names;
    } catch (error) {
        logger.error('フォント名取得エラー:', fontPath, error.message);
        return null;
    }
}


// プラットフォーム別のフォントディレクトリを取得
function getFontDirectories() {
    if (process.platform === 'win32') {
        return [
            'C:\\Windows\\Fonts',
            path.join(process.env.LOCALAPPDATA || '', 'Microsoft\\Windows\\Fonts')
        ];
    } else if (process.platform === 'darwin') {
        return [
            '/Library/Fonts',
            '/System/Library/Fonts',
            '/System/Library/Fonts/Supplemental',
            path.join(process.env.HOME || '', 'Library/Fonts')
        ];
    } else {
        // Linux
        return [
            '/usr/share/fonts',
            '/usr/local/share/fonts',
            path.join(process.env.HOME || '', '.fonts'),
            path.join(process.env.HOME || '', '.local/share/fonts')
        ];
    }
}

// フォント名に対応するファイルパスを検索
function findFontFile(fontName) {
    const fontDirs = getFontDirectories();

    // フォント名から推測される可能性のあるファイル名
    const possibleNames = [
        `${fontName}.ttf`,
        `${fontName}.ttc`,
        `${fontName}.otf`,
        `${fontName.replace(/\s+/g, '')}.ttf`,
        `${fontName.replace(/\s+/g, '')}.ttc`,
        `${fontName.replace(/\s+/g, '')}.otf`,
        `${fontName.replace(/\s+/g, '').toLowerCase()}.ttf`,
        `${fontName.replace(/\s+/g, '').toLowerCase()}.ttc`,
        `${fontName.replace(/\s+/g, '').toLowerCase()}.otf`
    ];

    for (const dir of fontDirs) {
        if (!fs.existsSync(dir)) continue;

        for (const fileName of possibleNames) {
            const fullPath = path.join(dir, fileName);
            if (fs.existsSync(fullPath)) {
                return fullPath;
            }
        }

        // ディレクトリ内を検索してフォント名にマッチするファイルを探す
        try {
            const files = fs.readdirSync(dir);
            // フォント名の最初の単語を取得（より柔軟なマッチングのため）
            const firstWord = fontName.split(/\s+/)[0].toLowerCase();

            for (const file of files) {
                const ext = path.extname(file).toLowerCase();
                if (['.ttf', '.ttc', '.otf'].includes(ext)) {
                    const fileNameLower = file.toLowerCase();
                    const searchName = fontName.toLowerCase().replace(/\s+/g, '');
                    const fileNameNoExt = file.replace(/\.(ttf|ttc|otf)$/i, '').toLowerCase().replace(/[_\-\s]/g, '');

                    // 複数の条件でマッチング
                    if (fileNameLower.includes(searchName) ||
                        searchName.includes(fileNameNoExt) ||
                        fileNameLower.includes(firstWord)) {
                        return path.join(dir, file);
                    }
                }
            }
        } catch (error) {
            // ディレクトリ読み取りエラーは無視
        }
    }

    return null;
}

// PowerShellでDirectWrite APIを使ってフォント情報を取得（Windows専用）
async function getSystemFontsViaDirectWrite() {
    // Windows以外では空配列を返す
    if (process.platform !== 'win32') {
        logger.debug('getSystemFontsViaDirectWrite: Windows以外のプラットフォームではスキップ');
        return [];
    }

    const psScript = `
        Add-Type -AssemblyName PresentationCore

        $fonts = [System.Windows.Media.Fonts]::SystemFontFamilies
        $result = @()

        foreach ($font in $fonts) {
            # 日本語名と英語名を取得
            $japaneseName = $null
            $englishName = $null

            # 日本語名を取得（ja-jp）
            if ($font.FamilyNames.ContainsKey([System.Globalization.CultureInfo]::GetCultureInfo('ja-JP'))) {
                $japaneseName = $font.FamilyNames[[System.Globalization.CultureInfo]::GetCultureInfo('ja-JP')]
            }

            # 英語名を取得（en-us）
            if ($font.FamilyNames.ContainsKey([System.Globalization.CultureInfo]::GetCultureInfo('en-US'))) {
                $englishName = $font.FamilyNames[[System.Globalization.CultureInfo]::GetCultureInfo('en-US')]
            }

            # 不変の名前（システム名）
            $systemName = $font.Source

            # すべての利用可能な名前を取得
            $allNames = @()
            foreach ($key in $font.FamilyNames.Keys) {
                $name = $font.FamilyNames[$key]
                if ($name -and $allNames -notcontains $name) {
                    $allNames += $name
                }
            }

            $result += @{
                systemName = $systemName
                japanese = $japaneseName
                english = $englishName
                allNames = $allNames
            }
        }

        $result | ConvertTo-Json -Compress
    `;

    try {
        logger.debug('PowerShell DirectWrite APIでフォント取得開始');

        const output = execSync(`powershell -Command "${psScript.replace(/"/g, '\\"')}"`, {
            encoding: 'utf8',
            maxBuffer: 20 * 1024 * 1024
        });

        if (!output || output.trim().length === 0) {
            logger.error('PowerShell出力が空です');
            return [];
        }

        const items = JSON.parse(output);
        const itemsArray = Array.isArray(items) ? items : [items];

        logger.debug('DirectWriteから取得:', itemsArray.length, 'フォント');

        return itemsArray;
    } catch (error) {
        logger.error('DirectWriteフォント取得エラー:', error.message);
        return [];
    }
}

// IPC通信: システムフォント一覧取得（日本語名付き）
ipcMain.handle('get-system-fonts', async () => {
    try {
        logger.info('システムフォント一覧を取得中...');

        // font-list ライブラリで取得（日本語名対応済み）
        const fontNames = await fontList.getFonts({ disableQuoting: true });
        logger.debug('font-listから取得:', fontNames.length, 'フォント');

        // フォント情報を整形
        const fonts = fontNames.map(name => ({
            systemName: name,
            displayName: name,
            allNames: [name]
        }));

        logger.info('フォント情報取得完了:', fonts.length);
        return { success: true, fonts: fonts };
    } catch (error) {
        logger.error('システムフォント取得エラー:', error);
        return { success: false, fonts: [], error: error.message };
    }
});

// ========================================
// PTY（疑似端末）関連 IPC通信
// ========================================

// IPC通信: PTYプロセス生成
ipcMain.handle('pty-spawn', async (event, options) => {
    const { windowId, cwd, cols, rows } = options;

    try {
        // 既存のPTYプロセスがあれば終了
        if (ptyProcesses.has(windowId)) {
            const oldProcess = ptyProcesses.get(windowId);
            if (oldProcess.kill) oldProcess.kill();
            ptyProcesses.delete(windowId);
        }

        const shell = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || 'bash');
        const workingDir = cwd || process.env.HOME || process.env.USERPROFILE;

        // node-ptyが利用可能な場合はそちらを使用
        if (pty && !usePtyFallback) {
            const ptyProcess = pty.spawn(shell, [], {
                name: 'xterm-256color',
                cols: cols || 80,
                rows: rows || 24,
                cwd: workingDir,
                env: process.env
            });

            ptyProcesses.set(windowId, { type: 'pty', process: ptyProcess });

            // データ受信時にレンダラーへ転送
            ptyProcess.onData((data) => {
                if (!event.sender.isDestroyed()) {
                    event.sender.send('pty-data', { windowId, data });
                }
            });

            // プロセス終了時
            ptyProcess.onExit(({ exitCode }) => {
                if (!event.sender.isDestroyed()) {
                    event.sender.send('pty-exit', { windowId, exitCode });
                }
                ptyProcesses.delete(windowId);
            });

            logger.info(`PTY spawned (node-pty): windowId=${windowId}, pid=${ptyProcess.pid}`);
            return { success: true, pid: ptyProcess.pid };
        }

        // フォールバック: child_processを使用
        // PowerShellはパイプI/Oで正しく動作しないため、cmd.exeを使用
        const fallbackShell = process.platform === 'win32' ? 'cmd.exe' : shell;
        const fallbackArgs = process.platform === 'win32' ? ['/Q'] : [];  // /Q: エコーオフ

        logger.info(`PTY spawned (fallback): windowId=${windowId}, shell=${fallbackShell}`);

        const childProcess = spawn(fallbackShell, fallbackArgs, {
            cwd: workingDir,
            env: { ...process.env, TERM: 'xterm-256color' },
            shell: false,
            stdio: ['pipe', 'pipe', 'pipe']
        });

        ptyProcesses.set(windowId, { type: 'child', process: childProcess });

        // フォールバックモードの開始メッセージを送信
        if (!event.sender.isDestroyed()) {
            event.sender.send('pty-data', {
                windowId,
                data: '[Terminal fallback mode - cmd.exe]\r\n'
            });
        }

        // 標準出力をレンダラーへ転送
        childProcess.stdout.on('data', (data) => {
            if (!event.sender.isDestroyed()) {
                event.sender.send('pty-data', { windowId, data: data.toString() });
            }
        });

        // 標準エラー出力をレンダラーへ転送
        childProcess.stderr.on('data', (data) => {
            if (!event.sender.isDestroyed()) {
                event.sender.send('pty-data', { windowId, data: data.toString() });
            }
        });

        // プロセス終了時
        childProcess.on('close', (exitCode) => {
            if (!event.sender.isDestroyed()) {
                event.sender.send('pty-exit', { windowId, exitCode: exitCode || 0 });
            }
            ptyProcesses.delete(windowId);
        });

        childProcess.on('error', (error) => {
            logger.error(`Child process error: ${error.message}`);
            if (!event.sender.isDestroyed()) {
                event.sender.send('pty-data', { windowId, data: `\r\n[Error: ${error.message}]\r\n` });
            }
        });

        return { success: true, pid: childProcess.pid };
    } catch (error) {
        logger.error('PTY spawn error:', error);
        return { success: false, error: error.message };
    }
});

// IPC通信: PTYへの入力送信
ipcMain.handle('pty-write', async (event, { windowId, data }) => {
    const entry = ptyProcesses.get(windowId);
    if (entry) {
        if (entry.type === 'pty') {
            entry.process.write(data);
        } else {
            // child_processの場合はstdinに書き込み
            entry.process.stdin.write(data);
        }
        return { success: true };
    }
    return { success: false, error: 'PTY not found' };
});

// IPC通信: PTYリサイズ
ipcMain.handle('pty-resize', async (event, { windowId, cols, rows }) => {
    const entry = ptyProcesses.get(windowId);
    if (entry) {
        if (entry.type === 'pty' && entry.process.resize) {
            entry.process.resize(cols, rows);
        }
        // child_processの場合はリサイズ不可（無視）
        return { success: true };
    }
    return { success: false, error: 'PTY not found' };
});

// IPC通信: PTYプロセス終了
ipcMain.handle('pty-kill', async (event, { windowId }) => {
    const entry = ptyProcesses.get(windowId);
    if (entry) {
        if (entry.type === 'pty') {
            entry.process.kill();
        } else {
            entry.process.kill('SIGTERM');
        }
        ptyProcesses.delete(windowId);
        logger.info(`PTY killed: windowId=${windowId}`);
        return { success: true };
    }
    return { success: false, error: 'PTY not found' };
});

// アプリ終了時に全PTYプロセスを終了
app.on('before-quit', () => {
    for (const [windowId, entry] of ptyProcesses) {
        logger.info(`Killing PTY on quit: windowId=${windowId}`);
        if (entry.type === 'pty') {
            entry.process.kill();
        } else {
            entry.process.kill('SIGTERM');
        }
    }
    ptyProcesses.clear();
});
