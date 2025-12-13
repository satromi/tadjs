/**
 * URL仮身プラグイン
 *
 * 実身に記載されたURLをブラウザで開くプラグイン
 * 複数行ある場合は、1行ずつ処理してURLを順次開く
 *
 * @module UrlLinkExec
 * @extends PluginBase
 * @license MIT
 * @author satromi
 * @version 1.0.0
 */
const logger = window.getLogger('UrlLinkExec');

class UrlLinkExec extends window.PluginBase {
    constructor() {
        super('UrlLinkExec');
        logger.info('[UrlLinkExec] 初期化開始');

        this.fileData = null;
        // this.realId, this.windowId は PluginBase で定義済み
        this.urls = [];
        this.currentIndex = 0;

        // MessageBus初期化
        if (window.MessageBus) {
            this.messageBus = new window.MessageBus({
                debug: false,
                pluginName: 'UrlLinkExec'
            });
            this.messageBus.start();
            this.setupMessageBusHandlers();
        }

        logger.info('[UrlLinkExec] 初期化完了');
    }

    /**
     * MessageBusのハンドラを登録
     * 親ウィンドウからのメッセージを受信して処理
     */
    setupMessageBusHandlers() {
        // 初期化メッセージ
        this.messageBus.on('init', async (data) => {
            logger.info('[UrlLinkExec] init受信', data);
            await this.handleInit(data);
        });

        // load-dataメッセージ
        this.messageBus.on('load-data', async (data) => {
            logger.info('[UrlLinkExec] load-data受信', data);
            await this.handleLoadData(data);
        });

        // xtadテキストが読み込まれた
        this.messageBus.on('xtad-text-loaded', async (data) => {
            logger.info('[UrlLinkExec] xtad-text-loaded受信', data);
            await this.handleXtadTextLoaded(data);
        });

        // URLが開かれた
        this.messageBus.on('url-opened', async (data) => {
            logger.info('[UrlLinkExec] url-opened受信', data);
            await this.handleUrlOpened(data);
        });
    }

    async handleInit(data) {
        logger.info('[UrlLinkExec] init受信', data);

        // MessageBusにwindowIdを設定（レスポンスルーティング用）
        if (data.windowId) {
            this.messageBus.setWindowId(data.windowId);
        }

        this.fileData = data.fileData || {};
        this.realId = data.fileData.realId || data.fileData.fileId;
        this.windowId = data.windowId;

        logger.info('[UrlLinkExec] realId:', this.realId);
        logger.info('[UrlLinkExec] windowId:', this.windowId);

        // xtadファイルのテキストを読み取るリクエストを送信
        await this.loadXtadText();
    }

    async handleLoadData(data) {
        logger.info('[UrlLinkExec] load-data受信', data);

        this.realId = data.realId;
        this.windowId = data.windowId;

        logger.info('[UrlLinkExec] realId:', this.realId);
        logger.info('[UrlLinkExec] windowId:', this.windowId);

        // xtadファイルのテキストを読み取るリクエストを送信
        await this.loadXtadText();
    }

    async loadXtadText() {
        if (!this.realId) {
            logger.error('[UrlLinkExec] realIdが指定されていません');
            this.closeWindow();
            return;
        }

        logger.info('[UrlLinkExec] xtadテキストを読み込みます:', this.realId);

        this.messageBus.send('read-xtad-text', {
            realId: this.realId,
            windowId: this.windowId
        });
    }

    async handleXtadTextLoaded(data) {
        logger.info('[UrlLinkExec] xtadテキスト受信:', data);

        if (!data.success) {
            logger.error('[UrlLinkExec] xtadテキストの読み込みに失敗しました:', data.error);
            this.closeWindow();
            return;
        }

        const text = data.text || '';
        logger.info('[UrlLinkExec] テキスト内容:', text);

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

        logger.info('[UrlLinkExec] 抽出されたURL:', this.urls);

        if (this.urls.length === 0) {
            logger.info('[UrlLinkExec] 開くURLがありません');
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
            logger.info('[UrlLinkExec] 全てのURLを開きました');
            this.closeWindow();
            return;
        }

        const url = this.urls[this.currentIndex];
        logger.info('[UrlLinkExec] URLを開きます:', url, `(${this.currentIndex + 1}/${this.urls.length})`);

        this.messageBus.send('open-url-external', {
            url: url,
            windowId: this.windowId
        });
    }

    async handleUrlOpened(data) {
        logger.info('[UrlLinkExec] URLが開かれました:', data);

        if (!data.success) {
            logger.error('[UrlLinkExec] URLを開くのに失敗しました:', data.error);
        }

        // 次のURLを開く
        this.currentIndex++;

        // 少し待ってから次のURLを開く（ブラウザの起動が重ならないように）
        setTimeout(async () => {
            await this.openNextUrl();
        }, 500);
    }

    closeWindow() {
        logger.info('[UrlLinkExec] ウィンドウを閉じます');

        if (this.windowId) {
                this.messageBus.send('close-window', {
                windowId: this.windowId
            });
        } else {
            // openable: falseの場合は、iframeを削除
            logger.info('[UrlLinkExec] 非表示iframeを削除します');
            if (window.frameElement) {
                window.frameElement.remove();
            }
        }
    }
}

// プラグインを初期化
const urlLinkExec = new UrlLinkExec();
