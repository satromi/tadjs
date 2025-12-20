/**
 * 既存データ起動プラグイン
 *
 * 既存の外部ファイルをOSのデフォルトアプリで開くプラグイン
 * 実身のxtadファイルから拡張子情報を読み取り、実身名+拡張子のファイルを開く
 * 外部ファイルを開いた後、ウィンドウを閉じる
 *
 * @module ExistingDataExec
 * @extends PluginBase
 * @license MIT
 * @author satromi
 * @version 1.0.0
 */
const logger = window.getLogger('ExistingDataExec');

class ExistingDataExec extends window.PluginBase {
    constructor() {
        super('ExistingDataExec');
        logger.info('[ExistingDataExec] 初期化開始');

        this.fileData = null;
        // this.realId, this.windowId は PluginBase で定義済み
        this.realName = null;
        this.extension = null;

        // MessageBusはPluginBaseで初期化済み
        if (this.messageBus) {
            this.setupMessageBusHandlers();
        }

        logger.info('[ExistingDataExec] 初期化完了');
    }

    /**
     * MessageBusのハンドラを登録
     * 親ウィンドウからのメッセージを受信して処理
     */
    setupMessageBusHandlers() {
        // 初期化メッセージ
        this.messageBus.on('init', async (data) => {
            logger.info('[ExistingDataExec] init受信', data);
            await this.handleInit(data);
        });

        // load-dataメッセージ
        this.messageBus.on('load-data', async (data) => {
            logger.info('[ExistingDataExec] load-data受信', data);
            await this.handleLoadData(data);
        });

        // xtadテキストが読み込まれた
        this.messageBus.on('xtad-text-loaded', async (data) => {
            logger.info('[ExistingDataExec] xtad-text-loaded受信', data);
            await this.handleXtadTextLoaded(data);
        });

        // 外部ファイルが開かれた
        this.messageBus.on('external-file-opened', (data) => {
            logger.info('[ExistingDataExec] external-file-opened受信', data);
            this.closeWindow();
        });
    }

    /**
     * initメッセージハンドラ
     */
    async handleInit(data) {
        logger.info('[ExistingDataExec] init受信', data);

        // MessageBusにwindowIdを設定（レスポンスルーティング用）
        if (data.windowId) {
            this.messageBus.setWindowId(data.windowId);
        }

        this.fileData = data.fileData || {};
        this.realId = data.fileData.realId || data.fileData.fileId;
        this.realName = data.fileData.name || '';
        this.windowId = data.windowId;

        // realIdから実身ID部分を抽出（PluginBaseの共通メソッドを使用）
        this.baseRealId = this.extractRealId(this.realId);

        logger.info('[ExistingDataExec] realId:', this.realId);
        logger.info('[ExistingDataExec] baseRealId:', this.baseRealId);
        logger.info('[ExistingDataExec] realName:', this.realName);
        logger.info('[ExistingDataExec] windowId:', this.windowId);

        // xtadファイルのテキストを読み取るリクエストを送信
        await this.loadXtadText();
    }

    /**
     * load-dataメッセージハンドラ
     */
    async handleLoadData(data) {
        logger.info('[ExistingDataExec] load-data受信', data);

        this.realId = data.realId;
        this.realName = data.realName || '';
        this.windowId = data.windowId;

        logger.info('[ExistingDataExec] realId:', this.realId);
        logger.info('[ExistingDataExec] realName:', this.realName);
        logger.info('[ExistingDataExec] windowId:', this.windowId);

        // xtadファイルのテキストを読み取るリクエストを送信
        await this.loadXtadText();
    }

    /**
     * xtadテキストを読み込む
     */
    async loadXtadText() {
        if (!this.realId) {
            logger.error('[ExistingDataExec] realIdが指定されていません');
            this.closeWindow();
            return;
        }

        logger.info('[ExistingDataExec] xtadテキストを読み込みます:', this.realId);

        this.messageBus.send('read-xtad-text', {
            realId: this.realId,
            windowId: this.windowId
        });
    }

    /**
     * xtadテキストが読み込まれた時の処理
     */
    async handleXtadTextLoaded(data) {
        logger.info('[ExistingDataExec] xtadテキスト受信:', data);

        if (!data.success) {
            logger.error('[ExistingDataExec] xtadテキストの読み込みに失敗しました:', data.error);
            this.closeWindow();
            return;
        }

        const text = data.text || '';
        logger.info('[ExistingDataExec] テキスト内容:', text);

        // テキストから拡張子を抽出（空白と改行を除去）
        this.extension = text.trim();

        if (!this.extension) {
            logger.error('[ExistingDataExec] 拡張子が指定されていません');
            this.closeWindow();
            return;
        }

        logger.info('[ExistingDataExec] 拡張子:', this.extension);

        // 外部ファイルを開く
        await this.openExternalFile();
    }

    /**
     * 外部ファイルをOSのデフォルトアプリで開く
     */
    async openExternalFile() {
        if (!this.baseRealId || !this.extension) {
            logger.error('[ExistingDataExec] 実身IDまたは拡張子が指定されていません');
            this.closeWindow();
            return;
        }

        logger.info('[ExistingDataExec] 外部ファイルを開きます:', this.baseRealId, this.extension);

        this.messageBus.send('open-external-file', {
            realId: this.baseRealId,
            extension: this.extension,
            windowId: this.windowId
        });
    }

    /**
     * ウィンドウを閉じる
     */
    closeWindow() {
        logger.info('[ExistingDataExec] ウィンドウを閉じます');

        if (this.windowId) {
                this.messageBus.send('close-window', {
                windowId: this.windowId
            });
        } else {
            // openable: falseの場合は、iframeを削除
            logger.info('[ExistingDataExec] 非表示iframeを削除します');
            if (window.frameElement) {
                window.frameElement.remove();
            }
        }
    }
}

// プラグインを初期化
const existingDataExec = new ExistingDataExec();
