/**
 * LLM連携プラグイン
 * Claude Code CLI実行用ターミナル
 *
 * @module LLMCollaboration
 * @extends PluginBase
 * @license MIT
 * @author satromi
 * @version 1.0.0
 */

const logger = window.getLogger('LLMCollaboration');

class LLMCollaboration extends window.PluginBase {
    constructor() {
        super('LLMCollaboration');

        this.terminal = null;      // xterm.js Terminal インスタンス
        this.fitAddon = null;      // FitAddon インスタンス
        this.ptyPid = null;        // PTYプロセスID
        this.workingDirectory = null;  // ワーキングディレクトリ
        this.isTerminalReady = false;  // ターミナル準備完了フラグ
        this.isFullscreen = false;     // 全画面表示フラグ
        this.backgroundColor = '#1e1e1e';  // 背景色
        this.claudeAutoStarted = false;  // Claude自動起動済みフラグ
        this.claudePromptSent = false;   // Claudeへのプロンプト送信済みフラグ
        this.claudeStartTime = null;     // Claude起動時刻（タイムアウト用）
        this.ptyOutputBuffer = '';       // PTY出力バッファ（プロンプト検出用）
        this.partialEscapeSequence = ''; // 部分的なエスケープシーケンス（チャンク分割対応）
        this.initialPrompt = null;       // 実身から読み取った初期プロンプト
        this.realIdBase = null;          // 実身ID（_0.xtadを除いたベース部分）

        this.init();
    }

    init() {
        this.initializeCommonComponents('[LLM]');
        this.setupMessageBusHandlers();
        this.setupContextMenu();
        this.setupKeyboardShortcuts();

        logger.debug('[LLM連携] 準備完了');
    }

    /**
     * キーボードショートカットを設定
     */
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey) {
                switch (e.key.toLowerCase()) {
                    case 'v':
                        // Ctrl+V: クリップボードからペースト
                        e.preventDefault();
                        this.pasteFromClipboard();
                        break;
                    case 'x':
                        // Ctrl+X: クリップボードへ移動（コピーして選択解除）
                        if (this.terminal && this.terminal.hasSelection()) {
                            e.preventDefault();
                            this.cutToClipboard();
                        }
                        break;
                    case 'l':
                        // Ctrl+L: 全画面表示オンオフ
                        e.preventDefault();
                        this.toggleFullscreen();
                        break;
                }
            }
        });
    }

    /**
     * クリップボードへコピー（navigator.clipboard使用）
     */
    async copyToClipboard() {
        if (!this.terminal) return;
        const selection = this.terminal.getSelection();
        if (selection) {
            try {
                // navigator.clipboardを直接使用（基本文章編集プラグインと同じ方式）
                await navigator.clipboard.writeText(selection);
                logger.debug('[LLM] Copied to clipboard');
            } catch (err) {
                logger.error('[LLM] Copy failed:', err.message);
            }
        }
    }

    /**
     * クリップボードからペースト（MessageBus経由で親ウィンドウから取得）
     * xterm.js の paste() メソッドを使用（推奨される方法）
     */
    async pasteFromClipboard() {
        if (!this.terminal) {
            logger.warn('[LLM] Paste failed: terminal not ready');
            return;
        }
        try {
            // MessageBus経由で親ウィンドウからクリップボードを取得
            // （iframeではnavigator.clipboard.readText()がフォーカス問題で失敗するため）
            const messageId = this.generateMessageId('clipboard');
            this.messageBus.send('get-text-clipboard', { messageId });
            const result = await this.messageBus.waitFor('text-clipboard-data', 5000,
                (data) => data.messageId === messageId
            );

            if (result && result.text) {
                logger.debug('[LLM] Paste from clipboard, text length:', result.text.length);
                // xterm.js の paste() メソッドを使用
                // これにより onData イベントが発火し、PTYに送信される
                this.terminal.paste(result.text);
                logger.debug('[LLM] Text pasted to terminal');
            } else if (result && result.error) {
                logger.error('[LLM] Paste failed:', result.error);
            }
        } catch (err) {
            logger.error('[LLM] Paste failed:', err.message);
        }
    }

    /**
     * クリップボードへ移動（カット）
     */
    async cutToClipboard() {
        if (!this.terminal) return;
        const selection = this.terminal.getSelection();
        if (selection) {
            try {
                await navigator.clipboard.writeText(selection);
                this.terminal.clearSelection();
                logger.debug('[LLM] Cut to clipboard');
            } catch (err) {
                logger.error('[LLM] Cut failed:', err);
            }
        }
    }

    /**
     * 全画面表示オンオフ
     */
    toggleFullscreen() {
        this.isFullscreen = !this.isFullscreen;
        this.messageBus.send('toggle-maximize');
        logger.debug(`[LLM] Fullscreen: ${this.isFullscreen}`);
    }

    /**
     * 再表示（ターミナルをリフレッシュ）
     */
    refreshTerminal() {
        if (this.terminal && this.fitAddon) {
            this.terminal.refresh(0, this.terminal.rows - 1);
            this.fitAddon.fit();
            logger.debug('[LLM] Terminal refreshed');
        }
    }

    /**
     * 背景色をUIに適用（PluginBaseのオーバーライド）
     * changeBgColor()から呼ばれる
     * @param {string} color - 背景色（CSS色指定）
     */
    applyBackgroundColor(color) {
        this.bgColor = color;
        this.backgroundColor = color;
        if (this.terminal) {
            // xtermの背景色を変更
            this.terminal.options.theme = {
                ...this.terminal.options.theme,
                background: color
            };
            // 文字色を背景に合わせて調整
            const foreground = this.isLightColor(color) ? '#000000' : '#d4d4d4';
            this.terminal.options.theme.foreground = foreground;
            this.terminal.options.theme.cursor = this.isLightColor(color) ? '#000000' : '#ffffff';

            logger.debug(`[LLM] Background color changed to ${color}`);
        }
    }

    /**
     * 色が明るいかどうかを判定
     * @param {string} color - 色コード
     * @returns {boolean} 明るい場合true
     */
    isLightColor(color) {
        const hex = color.replace('#', '');
        const r = parseInt(hex.substr(0, 2), 16);
        const g = parseInt(hex.substr(2, 2), 16);
        const b = parseInt(hex.substr(4, 2), 16);
        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
        return brightness > 128;
    }

    /**
     * XTADからプロンプト/指示テキストを抽出
     * @param {string} xmlData - XTADのXMLデータ
     * @returns {string|null} 抽出したテキスト（空の場合はnull）
     */
    extractPromptFromXtad(xmlData) {
        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlData, 'text/xml');

            // パースエラーチェック
            const parseError = xmlDoc.querySelector('parsererror');
            if (parseError) {
                logger.warn('[LLM] XTAD parse error:', parseError.textContent);
                return null;
            }

            // document要素内のすべての<p>要素からテキストを抽出
            const document = xmlDoc.querySelector('document');
            if (!document) {
                return null;
            }

            const paragraphs = document.querySelectorAll('p');
            const textParts = [];

            paragraphs.forEach(p => {
                // <p>要素内のテキストノードを収集（link要素は除く）
                const text = this.extractTextFromElement(p);
                if (text.trim()) {
                    textParts.push(text.trim());
                }
            });

            const fullText = textParts.join('\n').trim();
            return fullText || null;
        } catch (error) {
            logger.error('[LLM] Error extracting prompt from XTAD:', error);
            return null;
        }
    }

    /**
     * 要素からテキストを再帰的に抽出
     * @param {Element} element - DOM要素
     * @returns {string} 抽出したテキスト
     */
    extractTextFromElement(element) {
        let text = '';
        element.childNodes.forEach(node => {
            if (node.nodeType === Node.TEXT_NODE) {
                text += node.textContent;
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                // link要素は仮身なのでスキップ
                if (node.tagName.toLowerCase() !== 'link') {
                    text += this.extractTextFromElement(node);
                }
            }
        });
        return text;
    }

    /**
     * MessageBusのハンドラを登録
     */
    setupMessageBusHandlers() {
        // 共通ハンドラを登録
        this.setupCommonMessageBusHandlers();

        // init メッセージ
        this.messageBus.on('init', async (data) => {
            logger.debug('[LLM] init received:', JSON.stringify({
                windowId: data.windowId,
                realId: data.fileData?.realId,
                fileDataKeys: data.fileData ? Object.keys(data.fileData) : null
            }));

            // 共通初期化処理
            this.onInit(data);

            // realIdを保存（_0.xtadを除いたベース部分を抽出）
            if (data.fileData && data.fileData.realId) {
                // realIdは "xxx_0.xtad" の形式なので、"_0.xtad" を除去してベース部分を取得
                const realId = data.fileData.realId;
                this.realIdBase = realId.replace(/_\d+\.xtad$/, '');
                logger.debug(`[LLM] realIdBase: ${this.realIdBase}`);
            }

            // 実身のXTADからプロンプト/指示を抽出
            if (data.fileData && data.fileData.xmlData) {
                this.initialPrompt = this.extractPromptFromXtad(data.fileData.xmlData);
                if (this.initialPrompt) {
                    logger.debug(`[LLM] Initial prompt extracted: ${this.initialPrompt.substring(0, 100)}...`);
                }
            }

            // ワーキングディレクトリを設定
            // 親ウィンドウからdata_folder（xtadファイルに記載）を取得
            try {
                const messageId = this.generateMessageId('get-data-folder');
                this.messageBus.send('get-data-folder', { messageId });
                const response = await this.messageBus.waitFor('data-folder-response', 5000,
                    (respData) => respData.messageId === messageId
                );
                if (response && response.dataFolder) {
                    this.workingDirectory = response.dataFolder;
                    logger.debug(`[LLM] Working directory from parent: ${this.workingDirectory}`);
                }
            } catch (e) {
                logger.warn('[LLM] Failed to get data folder from parent:', e.message);
            }
            logger.debug(`[LLM] Working directory: ${this.workingDirectory || '(default)'}`);

            // スクロールバーを非表示にする（ターミナルプラグインではスクロールバー不要）
            // 管理用セグメントJSONではscrollable: trueのまま（他プラグインはスクロールバー表示）
            this.messageBus.send('set-scrollbar-visible', { visible: false });
            logger.debug('[LLM] Scrollbar hidden for terminal plugin');

            // ターミナルを初期化
            await this.setupTerminal();

            // PTYを起動
            await this.spawnPty();
        });

        // PTY関連のMessageBusレスポンスハンドラ
        this.messageBus.on('pty-spawn-response', (data) => {
            if (data.success) {
                this.ptyPid = data.pid;
                logger.debug(`[LLM] PTY spawned: PID=${this.ptyPid}`);
                // PTY起動後、少し遅延してからターミナルにフォーカス
                // （フォーカスレポートはフィルタリングされるので問題なし）
                if (this.terminal) {
                    setTimeout(() => {
                        this.terminal.focus();
                        logger.debug('[LLM] Terminal focused after PTY spawn');
                    }, 500);
                }
            } else {
                logger.error('[LLM] PTY spawn failed:', data.error);
                if (this.terminal) {
                    this.terminal.write(`\r\n[PTY spawn failed: ${data.error}]\r\n`);
                }
            }
        });

        // PTYからのデータを受信
        this.messageBus.on('pty-data', (data) => {
            if (this.terminal && data.data) {
                // フォーカスレポートシーケンスをフィルタリング（Claude Codeがフォーカスレポートモードを有効にするため）
                // \x1b[I = Focus In (CSI I), \x1b[O = Focus Out (CSI O)
                // データがチャンク分割される可能性があるため、複数のパターンで対応
                let filteredData = data.data;
                // 標準的なフォーカスレポートシーケンス
                filteredData = filteredData.replace(/\x1b\[I/g, '');
                filteredData = filteredData.replace(/\x1b\[O/g, '');
                // 部分的に分割された場合の対応（前のチャンクで\x1bが来て、このチャンクで[I/[Oが来る場合）
                if (this.partialEscapeSequence) {
                    filteredData = this.partialEscapeSequence + filteredData;
                    this.partialEscapeSequence = '';
                    filteredData = filteredData.replace(/\x1b\[I/g, '').replace(/\x1b\[O/g, '');
                }
                // このチャンクが\x1bで終わる場合、次のチャンクと結合するために保存
                if (filteredData.endsWith('\x1b')) {
                    this.partialEscapeSequence = '\x1b';
                    filteredData = filteredData.slice(0, -1);
                }
                if (filteredData) {
                    this.terminal.write(filteredData);
                }

                // バッファにデータを追加（プロンプト検出用）- フィルタリング前のデータを使用
                this.ptyOutputBuffer += data.data;
                // バッファが大きくなりすぎないよう制限
                if (this.ptyOutputBuffer.length > 2000) {
                    this.ptyOutputBuffer = this.ptyOutputBuffer.slice(-1000);
                }

                // Claude自動起動: PowerShellプロンプト検出
                if (!this.claudeAutoStarted) {
                    // PowerShellプロンプト（PS で始まり > で終わる）を検出
                    const isPsPrompt = /PS [^>]*>\s*$/.test(this.ptyOutputBuffer);
                    if (isPsPrompt) {
                        this.claudeAutoStarted = true;
                        this.claudeStartTime = Date.now();  // Claude起動時刻を記録
                        this.ptyOutputBuffer = '';
                        logger.debug('[LLM] PowerShell prompt detected, starting Claude...');
                        // 少し遅延してからClaudeを起動
                        setTimeout(() => {
                            this.writeToPty('claude\r');
                        }, 100);
                    }
                }
                // Claude起動後、プロンプト送信待ち
                else if (this.claudeAutoStarted && !this.claudePromptSent) {
                    // Claudeの入力待ちプロンプト検出
                    // ANSIエスケープコードを除去
                    const cleanBuffer = this.ptyOutputBuffer.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\r/g, '');

                    // デバッグ: バッファの末尾を確認
                    const bufferEnd = cleanBuffer.slice(-200);
                    if (bufferEnd.includes('>')) {
                        logger.debug(`[LLM] Buffer end (200 chars): "${bufferEnd.replace(/\n/g, '\\n')}"`);
                    }

                    // Claude Codeのプロンプト検出パターン:
                    // 1. 改行の後に「>」が来る（行頭の>）- これがClaude Codeの入力プロンプト
                    // 2. バッファ末尾が「> 」で終わる（入力待ち状態）
                    // 3. タイムアウト: Claude起動後3秒経過したら強制的に送信
                    const hasPromptLine = /\n>\s*$/.test(cleanBuffer) || /\n> /.test(cleanBuffer);
                    const endsWithPrompt = /> $/.test(cleanBuffer) || />\s*$/.test(cleanBuffer);
                    const elapsedTime = Date.now() - (this.claudeStartTime || Date.now());
                    const isTimeout = elapsedTime > 3000;  // 3秒タイムアウト

                    // プロンプトが検出されたか、タイムアウトした場合
                    if (hasPromptLine || endsWithPrompt || isTimeout) {
                        this.claudePromptSent = true;
                        this.ptyOutputBuffer = '';
                        if (isTimeout) {
                            logger.debug(`[LLM] Claude prompt timeout (${elapsedTime}ms), sending initial instruction...`);
                        } else {
                            logger.debug(`[LLM] Claude prompt detected (hasPromptLine=${hasPromptLine}, endsWithPrompt=${endsWithPrompt}), sending initial instruction...`);
                        }
                        // 少し遅延してから指示を送信（Claude Codeの準備完了を待つ）
                        setTimeout(() => {
                            this.sendInitialPrompt();
                        }, 500);
                    }
                }
            }
        });

        // PTY終了通知
        this.messageBus.on('pty-exit', (data) => {
            if (this.terminal) {
                this.terminal.write(`\r\n[Process exited with code ${data.exitCode}]\r\n`);
                this.terminal.write('[Press any key to restart shell...]\r\n');
                this.ptyPid = null;

                // 任意のキーでシェルを再起動
                const restartHandler = this.terminal.onData(async () => {
                    restartHandler.dispose();
                    // Claude自動起動フラグをリセット
                    this.claudeAutoStarted = false;
                    this.claudePromptSent = false;
                    this.claudeStartTime = null;
                    this.ptyOutputBuffer = '';
                    this.partialEscapeSequence = '';
                    await this.spawnPty();
                });
            }
        });
    }

    /**
     * ターミナルUIを初期化
     */
    async setupTerminal() {
        try {
            // グローバル変数からTerminalとFitAddonを取得
            // xterm.jsはUMD形式で、Terminal.Terminalとして公開される
            const Terminal = window.Terminal?.Terminal || window.Terminal;
            const FitAddon = window.FitAddon?.FitAddon || window.FitAddon;

            if (!Terminal) {
                throw new Error('xterm.js Terminal が読み込まれていません');
            }
            if (!FitAddon) {
                throw new Error('FitAddon が読み込まれていません');
            }

            this.terminal = new Terminal({
                cursorBlink: true,
                fontSize: 14,
                fontFamily: 'Consolas, "Courier New", monospace',
                theme: {
                    background: this.backgroundColor,
                    foreground: '#d4d4d4',
                    cursor: '#ffffff',
                    cursorAccent: '#000000',
                    selection: 'rgba(255, 255, 255, 0.3)'
                },
                scrollback: 10000,
                convertEol: true
            });

            this.fitAddon = new FitAddon();
            this.terminal.loadAddon(this.fitAddon);

            const container = document.getElementById('terminal');
            this.terminal.open(container);
            this.fitAddon.fit();

            // カスタムキーイベントハンドラを設定
            // xterm.jsがキーを処理する前に呼ばれる
            // falseを返すとxterm.jsはそのキーを処理しない
            this.terminal.attachCustomKeyEventHandler((e) => {
                if (e.ctrlKey && e.type === 'keydown') {
                    switch (e.key.toLowerCase()) {
                        case 'v':
                            // Ctrl+V: カスタムペースト処理
                            e.preventDefault();
                            this.pasteFromClipboard();
                            return false; // xterm.jsにキーを処理させない
                        case 'c':
                            // Ctrl+C: 選択テキストがあればコピー、なければシグナル送信
                            if (this.terminal.hasSelection()) {
                                e.preventDefault();
                                this.copyToClipboard();
                                return false;
                            }
                            // 選択がなければCtrl+C（SIGINT）をPTYに送信
                            return true;
                        case 'x':
                            // Ctrl+X: 選択テキストがあればカット
                            if (this.terminal.hasSelection()) {
                                e.preventDefault();
                                this.cutToClipboard();
                                return false;
                            }
                            return true;
                        case 'l':
                            // Ctrl+L: 全画面表示オンオフ
                            e.preventDefault();
                            this.toggleFullscreen();
                            return false;
                    }
                }
                return true; // その他のキーはxterm.jsに処理させる
            });

            // ユーザー入力をPTYに送信
            this.terminal.onData((data) => {
                this.writeToPty(data);
            });

            // ウィンドウリサイズ対応
            this._resizeHandler = () => {
                this.handleResize();
            };
            window.addEventListener('resize', this._resizeHandler);

            // ResizeObserverでコンテナのリサイズを検出
            this._resizeObserver = new ResizeObserver(() => {
                this.handleResize();
            });
            this._resizeObserver.observe(container);

            this.isTerminalReady = true;
            logger.debug('[LLM] Terminal initialized');
            // 注: ここでfocus()を呼ばない（タイミングが早すぎてフォーカスレポートが問題を起こす）
        } catch (error) {
            logger.error('[LLM] Terminal initialization error:', error);
            const container = document.getElementById('terminal');
            container.innerHTML = `<div style="color: red; padding: 20px;">
                ターミナルの初期化に失敗しました: ${error.message}
            </div>`;
        }
    }


    /**
     * リサイズ処理
     */
    handleResize() {
        if (this.fitAddon && this.terminal) {
            this.fitAddon.fit();
            this.resizePty();
        }
    }

    /**
     * PTYプロセスを起動（MessageBus経由）
     */
    async spawnPty() {
        if (!this.isTerminalReady || !this.windowId) {
            logger.warn('[LLM] Terminal not ready or windowId not set');
            return;
        }

        try {
            // MessageBus経由で親ウィンドウにPTY起動をリクエスト
            this.messageBus.send('pty-spawn-request', {
                cwd: this.workingDirectory,
                cols: this.terminal.cols,
                rows: this.terminal.rows
            });
        } catch (error) {
            logger.error('[LLM] PTY spawn error:', error);
            this.terminal.write(`\r\n[PTY spawn error: ${error.message}]\r\n`);
        }
    }

    /**
     * PTYにデータを送信（MessageBus経由）
     * @param {string} data - 送信するデータ
     */
    writeToPty(data) {
        if (!this.ptyPid || !this.windowId) return;

        this.messageBus.send('pty-write-request', {
            data: data
        });
    }

    /**
     * PTYをリサイズ（MessageBus経由）
     */
    resizePty() {
        if (!this.ptyPid || !this.windowId || !this.terminal) return;

        this.messageBus.send('pty-resize-request', {
            cols: this.terminal.cols,
            rows: this.terminal.rows
        });
    }

    /**
     * PTYプロセスを終了（MessageBus経由）
     */
    async killPty() {
        if (!this.ptyPid || !this.windowId) return;

        try {
            this.messageBus.send('pty-kill-request', {});
            this.ptyPid = null;
            logger.debug('[LLM] PTY kill requested');
        } catch (error) {
            logger.error('[LLM] PTY kill error:', error);
        }
    }

    /**
     * 初期プロンプトをClaudeに送信
     * Claude起動後に「{realId}_0.xtad の実身の指示を実行して」を自動送信
     */
    async sendInitialPrompt() {
        // realIdを使って指示文を生成
        let prompt;
        if (this.realIdBase) {
            prompt = `CLAUDE.mdの指示を読み直して ${this.realIdBase}_0.xtad の実身の指示を実行して`;
        } else {
            prompt = 'CLAUDE.mdの指示を読み直して この実身の指示を実行して';
        }
        logger.debug('[LLM] Sending initial prompt: ' + prompt);

        // Claude Codeにプロンプトを送信
        // テキストを先に送信し、少し待ってからEnterを送信
        // （Claude Codeのreadlineインターフェースが正しく処理できるように）
        this.writeToPty(prompt);
        logger.debug('[LLM] Prompt text sent to Claude');

        // 100ms待ってからEnterを送信
        setTimeout(() => {
            // Enterキーを送信（\rはCarriage Return = Enter）
            this.writeToPty('\r');
            logger.debug('[LLM] Enter key sent to Claude');
        }, 100);

        // プロンプト送信後にターミナルにフォーカス（ユーザー操作を受け付ける準備）
        if (this.terminal) {
            setTimeout(() => {
                this.terminal.focus();
                logger.debug('[LLM] Terminal focused after sending prompt');
            }, 300);
        }
    }

    /**
     * ウィンドウがアクティブになった時の処理
     * ターミナルにフォーカスを設定
     */
    onWindowActivated() {
        super.onWindowActivated();
        // ウィンドウがアクティブになったらターミナルにフォーカス
        // （フォーカスレポートはフィルタリングされるので常に安全）
        if (this.terminal) {
            setTimeout(() => {
                this.terminal.focus();
                logger.debug('[LLM] Terminal focused on window activated');
            }, 100);
        }
    }

    /**
     * メニュー定義を返す
     * @returns {Array} メニュー定義
     */
    getMenuDefinition() {
        return [
            {
                label: '表示',
                submenu: [
                    {
                        label: '全画面表示オンオフ',
                        action: 'toggle-fullscreen',
                        shortcut: 'Ctrl+L',
                        checked: this.isFullscreen
                    },
                    {
                        label: '再表示',
                        action: 'refresh'
                    },
                    { separator: true },
                    {
                        label: '背景色変更...',
                        action: 'change-background-color'
                    }
                ]
            },
            {
                label: '編集',
                submenu: [
                    {
                        label: 'クリップボードへコピー',
                        action: 'copy',
                        shortcut: 'Ctrl+C'
                    },
                    {
                        label: 'クリップボードからコピー',
                        action: 'paste',
                        shortcut: 'Ctrl+V'
                    },
                    { separator: true },
                    {
                        label: 'クリップボードへ移動',
                        action: 'cut',
                        shortcut: 'Ctrl+X'
                    },
                    {
                        label: 'クリップボードから移動',
                        action: 'paste-move',
                        shortcut: 'Ctrl+Z'
                    }
                ]
            }
        ];
    }

    /**
     * メニューアクションを実行
     * @param {string} action - アクション名
     */
    executeMenuAction(action) {
        switch (action) {
            case 'toggle-fullscreen':
                this.toggleFullscreen();
                break;
            case 'refresh':
                this.refreshTerminal();
                break;
            case 'change-background-color':
                this.changeBgColor();
                break;
            case 'copy':
                this.copyToClipboard();
                break;
            case 'paste':
            case 'paste-move':
                this.pasteFromClipboard();
                break;
            case 'cut':
                this.cutToClipboard();
                break;
            default:
                logger.warn(`[LLM] Unknown menu action: ${action}`);
        }
    }

    /**
     * ウィンドウクローズ時の処理
     * PTYプロセスを終了してからウィンドウを閉じる
     */
    async handleCloseRequest() {
        // リサイズリスナー・ResizeObserverクリーンアップ
        if (this._resizeHandler) {
            window.removeEventListener('resize', this._resizeHandler);
        }
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }
        await this.killPty();
        return super.handleCloseRequest();
    }
}

// プラグインを初期化
// app.jsはES Moduleから動的に読み込まれるため、
// DOMContentLoadedは既に発火済みの可能性がある
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.llmCollaboration = new LLMCollaboration();
    });
} else {
    // DOMContentLoaded は既に発火済み
    window.llmCollaboration = new LLMCollaboration();
}
