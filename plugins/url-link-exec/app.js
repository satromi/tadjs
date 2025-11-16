/**
 * URL仮身プラグイン
 *
 * 実身に記載されたURLをブラウザで開くプラグイン
 * 複数行ある場合は、1行ずつ処理してURLを順次開く
 */

class UrlLinkExec {
    constructor() {
        console.log('[UrlLinkExec] 初期化開始');

        this.fileData = null;
        this.realId = null;
        this.windowId = null;
        this.urls = [];
        this.currentIndex = 0;

        // MessageBus Phase 2: MessageBusのみを使用
        this.messageBus = null;
        if (window.MessageBus) {
            this.messageBus = new window.MessageBus({
                debug: false,
                pluginName: 'UrlLinkExec'
            });
            this.messageBus.start();
            this.setupMessageBusHandlers();
        }

        console.log('[UrlLinkExec] 初期化完了');
    }

    /**
     * MessageBus Phase 2: MessageBusのハンドラを設定
     */
    setupMessageBusHandlers() {
        // 初期化メッセージ
        this.messageBus.on('init', async (data) => {
            console.log('[UrlLinkExec] init受信', data);
            await this.handleInit(data);
        });

        // load-dataメッセージ
        this.messageBus.on('load-data', async (data) => {
            console.log('[UrlLinkExec] load-data受信', data);
            await this.handleLoadData(data);
        });

        // xtadテキストが読み込まれた
        this.messageBus.on('xtad-text-loaded', async (data) => {
            console.log('[UrlLinkExec] xtad-text-loaded受信', data);
            await this.handleXtadTextLoaded(data);
        });

        // URLが開かれた
        this.messageBus.on('url-opened', async (data) => {
            console.log('[UrlLinkExec] url-opened受信', data);
            await this.handleUrlOpened(data);
        });
    }

    async handleInit(data) {
        console.log('[UrlLinkExec] init受信', data);

        this.fileData = data.fileData || {};
        this.realId = data.fileData.realId || data.fileData.fileId;
        this.windowId = data.windowId;

        console.log('[UrlLinkExec] realId:', this.realId);
        console.log('[UrlLinkExec] windowId:', this.windowId);

        // xtadファイルのテキストを読み取るリクエストを送信
        await this.loadXtadText();
    }

    async handleLoadData(data) {
        console.log('[UrlLinkExec] load-data受信', data);

        this.realId = data.realId;
        this.windowId = data.windowId;

        console.log('[UrlLinkExec] realId:', this.realId);
        console.log('[UrlLinkExec] windowId:', this.windowId);

        // xtadファイルのテキストを読み取るリクエストを送信
        await this.loadXtadText();
    }

    async loadXtadText() {
        if (!this.realId) {
            console.error('[UrlLinkExec] realIdが指定されていません');
            this.closeWindow();
            return;
        }

        console.log('[UrlLinkExec] xtadテキストを読み込みます:', this.realId);

        // MessageBus Phase 2: messageBus.send()を使用
        this.messageBus.send('read-xtad-text', {
            realId: this.realId,
            windowId: this.windowId
        });
    }

    async handleXtadTextLoaded(data) {
        console.log('[UrlLinkExec] xtadテキスト受信:', data);

        if (!data.success) {
            console.error('[UrlLinkExec] xtadテキストの読み込みに失敗しました:', data.error);
            this.closeWindow();
            return;
        }

        const text = data.text || '';
        console.log('[UrlLinkExec] テキスト内容:', text);

        // テキストを行ごとに分割
        const lines = text.split('\n');

        // URLを抽出（空行とコメント行を除外）
        this.urls = lines
            .map(line => line.trim())
            .filter(line => {
                // 空行を除外
                if (!line) return false;
                // #で始まるコメント行を除外
                if (line.startsWith('#')) return false;
                // URLパターンにマッチするかチェック（http:// または https:// で始まる）
                return line.match(/^https?:\/\/.+/i);
            });

        console.log('[UrlLinkExec] 抽出されたURL:', this.urls);

        if (this.urls.length === 0) {
            console.log('[UrlLinkExec] 開くURLがありません');
            this.closeWindow();
            return;
        }

        // 最初のURLを開く
        this.currentIndex = 0;
        await this.openNextUrl();
    }

    async openNextUrl() {
        if (this.currentIndex >= this.urls.length) {
            // 全てのURLを開き終わったら終了
            console.log('[UrlLinkExec] 全てのURLを開きました');
            this.closeWindow();
            return;
        }

        const url = this.urls[this.currentIndex];
        console.log('[UrlLinkExec] URLを開きます:', url, `(${this.currentIndex + 1}/${this.urls.length})`);

        // MessageBus Phase 2: messageBus.send()を使用
        this.messageBus.send('open-url-external', {
            url: url,
            windowId: this.windowId
        });
    }

    async handleUrlOpened(data) {
        console.log('[UrlLinkExec] URLが開かれました:', data);

        if (!data.success) {
            console.error('[UrlLinkExec] URLを開くのに失敗しました:', data.error);
        }

        // 次のURLを開く
        this.currentIndex++;

        // 少し待ってから次のURLを開く（ブラウザの起動が重ならないように）
        setTimeout(async () => {
            await this.openNextUrl();
        }, 500);
    }

    closeWindow() {
        console.log('[UrlLinkExec] ウィンドウを閉じます');

        if (this.windowId) {
            // MessageBus Phase 2: messageBus.send()を使用
            this.messageBus.send('close-window', {
                windowId: this.windowId
            });
        } else {
            // openable: falseの場合は、iframeを削除
            console.log('[UrlLinkExec] 非表示iframeを削除します');
            if (window.frameElement) {
                window.frameElement.remove();
            }
        }
    }
}

// プラグインを初期化
const urlLinkExec = new UrlLinkExec();
