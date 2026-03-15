/**
 * electron/pty-manager.js
 * PTY（疑似端末）プロセスの管理
 * main.jsから分離
 */

const { ipcMain } = require('electron');
const { getLogger } = require('./logger.cjs');

const logger = getLogger('PTY');

class PtyManager {
    constructor() {
        this.processes = new Map();
        this.pty = null;
        this.useFallback = false;

        // node-ptyの読み込み
        try {
            this.pty = require('node-pty');
            logger.info('node-pty loaded successfully');
        } catch (e) {
            logger.warn('node-pty module not available, using child_process fallback:', e.message);
            this.useFallback = true;
        }
    }

    /**
     * IPCハンドラを登録
     * @param {Function} isPathAllowed パス検証関数
     */
    registerHandlers(isPathAllowed) {
        ipcMain.handle('pty-spawn', async (event, options) => {
            return this.spawn(event, options, isPathAllowed);
        });

        ipcMain.handle('pty-write', async (event, { windowId, data }) => {
            return this.write(windowId, data);
        });

        ipcMain.handle('pty-resize', async (event, { windowId, cols, rows }) => {
            return this.resize(windowId, cols, rows);
        });

        ipcMain.handle('pty-kill', async (event, { windowId }) => {
            return this.kill(windowId);
        });
    }

    /**
     * レンダラーへデータを安全に送信するヘルパー
     */
    _safeSend(sender, channel, data) {
        if (!sender.isDestroyed()) {
            sender.send(channel, data);
        }
    }

    /**
     * PTYプロセスを生成
     */
    async spawn(event, options, isPathAllowed) {
        const { windowId, cwd, cols, rows } = options;

        try {
            // 既存のPTYプロセスがあれば終了
            if (this.processes.has(windowId)) {
                this.killProcess(windowId);
            }

            const shell = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || 'bash');
            const workingDir = cwd || process.env.HOME || process.env.USERPROFILE;

            // cwdのパストラバーサル対策
            if (cwd && !isPathAllowed(cwd)) {
                logger.warn('[PTY] spawn: 許可されていないcwd:', cwd);
                return { success: false, error: '許可されていないパスです' };
            }

            // node-ptyが利用可能な場合
            if (this.pty && !this.useFallback) {
                return this._spawnWithNodePty(event, windowId, shell, workingDir, cols, rows);
            }

            // フォールバック: child_processを使用
            return this._spawnWithChildProcess(event, windowId, shell, workingDir);
        } catch (error) {
            logger.error('PTY spawn error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * node-ptyでプロセスを生成
     */
    _spawnWithNodePty(event, windowId, shell, workingDir, cols, rows) {
        const ptyProcess = this.pty.spawn(shell, [], {
            name: 'xterm-256color',
            cols: cols || 80,
            rows: rows || 24,
            cwd: workingDir,
            env: process.env
        });

        const disposables = [];

        disposables.push(ptyProcess.onData((data) => {
            this._safeSend(event.sender, 'pty-data', { windowId, data });
        }));

        disposables.push(ptyProcess.onExit(({ exitCode }) => {
            this._safeSend(event.sender, 'pty-exit', { windowId, exitCode });
            this.processes.delete(windowId);
        }));

        this.processes.set(windowId, { type: 'pty', process: ptyProcess, disposables });

        logger.info(`PTY spawned (node-pty): windowId=${windowId}, pid=${ptyProcess.pid}`);
        return { success: true, pid: ptyProcess.pid };
    }

    /**
     * child_processでプロセスを生成（フォールバック）
     */
    _spawnWithChildProcess(event, windowId, shell, workingDir) {
        const { spawn } = require('child_process');

        // PowerShellはパイプI/Oで正しく動作しないため、cmd.exeを使用
        const fallbackShell = process.platform === 'win32' ? 'cmd.exe' : shell;
        const fallbackArgs = process.platform === 'win32' ? ['/Q'] : [];

        logger.info(`PTY spawned (fallback): windowId=${windowId}, shell=${fallbackShell}`);

        const childProcess = spawn(fallbackShell, fallbackArgs, {
            cwd: workingDir,
            env: { ...process.env, TERM: 'xterm-256color' },
            shell: false,
            stdio: ['pipe', 'pipe', 'pipe']
        });

        this.processes.set(windowId, { type: 'child', process: childProcess });

        // フォールバックモードの開始メッセージ
        this._safeSend(event.sender, 'pty-data', {
            windowId,
            data: '[Terminal fallback mode - cmd.exe]\r\n'
        });

        childProcess.stdout.on('data', (data) => {
            this._safeSend(event.sender, 'pty-data', { windowId, data: data.toString() });
        });

        childProcess.stderr.on('data', (data) => {
            this._safeSend(event.sender, 'pty-data', { windowId, data: data.toString() });
        });

        childProcess.on('close', (exitCode) => {
            this._safeSend(event.sender, 'pty-exit', { windowId, exitCode: exitCode || 0 });
            this.processes.delete(windowId);
        });

        childProcess.on('error', (error) => {
            logger.error(`Child process error: ${error.message}`);
            this._safeSend(event.sender, 'pty-data', { windowId, data: `\r\n[Error: ${error.message}]\r\n` });
        });

        return { success: true, pid: childProcess.pid };
    }

    /**
     * PTYへの入力送信
     */
    write(windowId, data) {
        const entry = this.processes.get(windowId);
        if (entry) {
            if (entry.type === 'pty') {
                entry.process.write(data);
            } else {
                entry.process.stdin.write(data);
            }
            return { success: true };
        }
        return { success: false, error: 'PTY not found' };
    }

    /**
     * PTYリサイズ
     */
    resize(windowId, cols, rows) {
        const entry = this.processes.get(windowId);
        if (entry) {
            if (entry.type === 'pty' && entry.process.resize) {
                entry.process.resize(cols, rows);
            }
            return { success: true };
        }
        return { success: false, error: 'PTY not found' };
    }

    /**
     * PTYプロセスを終了
     */
    kill(windowId) {
        const result = this.killProcess(windowId);
        if (result) {
            logger.info(`PTY killed: windowId=${windowId}`);
            return { success: true };
        }
        return { success: false, error: 'PTY not found' };
    }

    /**
     * プロセスを終了する内部メソッド
     */
    killProcess(windowId) {
        const entry = this.processes.get(windowId);
        if (!entry) return false;

        if (entry.disposables) {
            entry.disposables.forEach(d => d.dispose());
        }
        if (entry.type === 'pty') {
            entry.process.kill();
        } else {
            entry.process.kill('SIGTERM');
        }
        this.processes.delete(windowId);
        return true;
    }

    /**
     * 全PTYプロセスを終了（アプリ終了時用）
     */
    killAll() {
        for (const [windowId] of this.processes) {
            logger.info(`Killing PTY on quit: windowId=${windowId}`);
            this.killProcess(windowId);
        }
        this.processes.clear();
    }
}

module.exports = { PtyManager };
