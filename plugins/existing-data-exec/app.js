/**
 * 既存データ起動プラグイン
 *
 * 既存の外部ファイルをOSのデフォルトアプリで開くプラグイン
 * 実身のxtadファイルから拡張子情報を読み取り、実身名+拡張子のファイルを開く
 */

class ExistingDataExec {
    constructor() {
        console.log('[ExistingDataExec] 初期化開始');

        this.fileData = null;
        this.realId = null;
        this.realName = null;
        this.windowId = null;
        this.extension = null;

        // MessageBus Phase 2: MessageBusのみを使用
        this.messageBus = null;
        if (window.MessageBus) {
            this.messageBus = new window.MessageBus({
                debug: false,
                pluginName: 'ExistingDataExec'
            });
            this.messageBus.start();
            this.setupMessageBusHandlers();
        }

        console.log('[ExistingDataExec] 初期化完了');
    }

    /**
     * MessageBus Phase 2: MessageBusのハンドラを設定
     */
    setupMessageBusHandlers() {
        // 初期化メッセージ
        this.messageBus.on('init', async (data) => {
            console.log('[ExistingDataExec] init受信', data);
            await this.handleInit(data);
        });

        // load-dataメッセージ
        this.messageBus.on('load-data', async (data) => {
            console.log('[ExistingDataExec] load-data受信', data);
            await this.handleLoadData(data);
        });

        // xtadテキストが読み込まれた
        this.messageBus.on('xtad-text-loaded', async (data) => {
            console.log('[ExistingDataExec] xtad-text-loaded受信', data);
            await this.handleXtadTextLoaded(data);
        });

        // 外部ファイルが開かれた
        this.messageBus.on('external-file-opened', (data) => {
            console.log('[ExistingDataExec] external-file-opened受信', data);
            this.closeWindow();
        });
    }

    /**
     * initメッセージハンドラ
     */
    async handleInit(data) {
        console.log('[ExistingDataExec] init受信', data);

        this.fileData = data.fileData || {};
        this.realId = data.fileData.realId || data.fileData.fileId;
        this.realName = data.fileData.name || data.fileData.realName || '';
        this.windowId = data.windowId;

        // realIdから実身ID部分を抽出（_0.xtad などを除去）
        let baseRealId = this.realId;
        // .xtad, .json などの拡張子を除去
        baseRealId = baseRealId.replace(/\.(xtad|json)$/, '');
        // _recordNo の部分を除去（例: _0, _1, _10 など）
        baseRealId = baseRealId.replace(/_\d+$/, '');
        this.baseRealId = baseRealId;

        console.log('[ExistingDataExec] realId:', this.realId);
        console.log('[ExistingDataExec] baseRealId:', this.baseRealId);
        console.log('[ExistingDataExec] realName:', this.realName);
        console.log('[ExistingDataExec] windowId:', this.windowId);

        // xtadファイルのテキストを読み取るリクエストを送信
        await this.loadXtadText();
    }

    /**
     * load-dataメッセージハンドラ
     */
    async handleLoadData(data) {
        console.log('[ExistingDataExec] load-data受信', data);

        this.realId = data.realId;
        this.realName = data.realName || '';
        this.windowId = data.windowId;

        console.log('[ExistingDataExec] realId:', this.realId);
        console.log('[ExistingDataExec] realName:', this.realName);
        console.log('[ExistingDataExec] windowId:', this.windowId);

        // xtadファイルのテキストを読み取るリクエストを送信
        await this.loadXtadText();
    }

    /**
     * xtadテキストを読み込む
     */
    async loadXtadText() {
        if (!this.realId) {
            console.error('[ExistingDataExec] realIdが指定されていません');
            this.closeWindow();
            return;
        }

        console.log('[ExistingDataExec] xtadテキストを読み込みます:', this.realId);

        // MessageBus Phase 2: messageBus.send()を使用
        this.messageBus.send('read-xtad-text', {
            realId: this.realId,
            windowId: this.windowId
        });
    }

    /**
     * xtadテキストが読み込まれた時の処理
     */
    async handleXtadTextLoaded(data) {
        console.log('[ExistingDataExec] xtadテキスト受信:', data);

        if (!data.success) {
            console.error('[ExistingDataExec] xtadテキストの読み込みに失敗しました:', data.error);
            this.closeWindow();
            return;
        }

        const text = data.text || '';
        console.log('[ExistingDataExec] テキスト内容:', text);

        // テキストから拡張子を抽出（空白と改行を除去）
        this.extension = text.trim();

        if (!this.extension) {
            console.error('[ExistingDataExec] 拡張子が指定されていません');
            this.closeWindow();
            return;
        }

        console.log('[ExistingDataExec] 拡張子:', this.extension);

        // 外部ファイルを開く
        await this.openExternalFile();
    }

    /**
     * 外部ファイルをOSのデフォルトアプリで開く
     */
    async openExternalFile() {
        if (!this.baseRealId || !this.extension) {
            console.error('[ExistingDataExec] 実身IDまたは拡張子が指定されていません');
            this.closeWindow();
            return;
        }

        console.log('[ExistingDataExec] 外部ファイルを開きます:', this.baseRealId, this.extension);

        // MessageBus Phase 2: messageBus.send()を使用
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
        console.log('[ExistingDataExec] ウィンドウを閉じます');

        if (this.windowId) {
            // MessageBus Phase 2: messageBus.send()を使用
            this.messageBus.send('close-window', {
                windowId: this.windowId
            });
        } else {
            // openable: falseの場合は、iframeを削除
            console.log('[ExistingDataExec] 非表示iframeを削除します');
            if (window.frameElement) {
                window.frameElement.remove();
            }
        }
    }
}

// プラグインを初期化
const existingDataExec = new ExistingDataExec();
