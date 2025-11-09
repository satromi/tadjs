/**
 * 既存データ起動プラグイン
 *
 * 既存の外部ファイルをOSのデフォルトアプリで開くプラグイン
 * 実身ファイル名の形式: {実身ID}.{元の拡張子}
 */

class ExistingDataExec {
    constructor() {
        console.log('[ExistingDataExec] 初期化開始');

        this.fileData = null;
        this.realId = null;
        this.windowId = null;

        // メッセージリスナーを設定
        this.setupMessageListener();

        console.log('[ExistingDataExec] 初期化完了');
    }

    /**
     * メッセージリスナーを設定
     */
    setupMessageListener() {
        window.addEventListener('message', async (event) => {
            if (!event.data || !event.data.type) {
                return;
            }

            console.log('[ExistingDataExec] メッセージ受信:', event.data.type, event.data);

            if (event.data.type === 'init') {
                await this.handleInit(event.data);
            } else if (event.data.type === 'load-data') {
                await this.handleLoadData(event.data);
            } else if (event.data.type === 'external-file-opened') {
                // ファイルが開かれた通知を受け取ったら、ウィンドウを閉じる
                this.closeWindow();
            }
        });
    }

    /**
     * initメッセージハンドラ
     */
    async handleInit(data) {
        console.log('[ExistingDataExec] init受信', data);

        this.fileData = data.fileData || {};
        this.realId = data.fileData.realId || data.fileData.fileId;
        this.windowId = data.windowId;

        console.log('[ExistingDataExec] realId:', this.realId);
        console.log('[ExistingDataExec] windowId:', this.windowId);

        // 外部ファイルを開く
        await this.openExternalFile();
    }

    /**
     * load-dataメッセージハンドラ
     */
    async handleLoadData(data) {
        console.log('[ExistingDataExec] load-data受信', data);

        this.realId = data.realId;
        this.windowId = data.windowId;

        console.log('[ExistingDataExec] realId:', this.realId);
        console.log('[ExistingDataExec] windowId:', this.windowId);

        // 外部ファイルを開く
        await this.openExternalFile();
    }

    /**
     * 外部ファイルをOSのデフォルトアプリで開く
     */
    async openExternalFile() {
        if (!this.realId) {
            console.error('[ExistingDataExec] realIdが指定されていません');
            this.closeWindow();
            return;
        }

        console.log('[ExistingDataExec] 外部ファイルを開きます:', this.realId);

        // 親ウィンドウに外部ファイルを開くリクエストを送信
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: 'open-external-file',
                realId: this.realId,
                windowId: this.windowId
            }, '*');
        } else {
            console.error('[ExistingDataExec] 親ウィンドウが見つかりません');
            this.closeWindow();
        }
    }

    /**
     * ウィンドウを閉じる
     */
    closeWindow() {
        console.log('[ExistingDataExec] ウィンドウを閉じます');

        if (this.windowId) {
            // ウィンドウがある場合は閉じる
            if (window.parent && window.parent !== window) {
                window.parent.postMessage({
                    type: 'close-window',
                    windowId: this.windowId
                }, '*');
            }
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
