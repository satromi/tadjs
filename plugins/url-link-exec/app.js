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

        // メッセージリスナーを設定
        this.setupMessageListener();

        console.log('[UrlLinkExec] 初期化完了');
    }

    setupMessageListener() {
        window.addEventListener('message', async (event) => {
            if (!event.data || !event.data.type) {
                return;
            }

            console.log('[UrlLinkExec] メッセージ受信:', event.data.type, event.data);

            if (event.data.type === 'init') {
                await this.handleInit(event.data);
            } else if (event.data.type === 'load-data') {
                await this.handleLoadData(event.data);
            } else if (event.data.type === 'xtad-text-loaded') {
                // xtadファイルのテキストを受信
                await this.handleXtadTextLoaded(event.data);
            } else if (event.data.type === 'url-opened') {
                // URLが開かれた通知を受け取る
                await this.handleUrlOpened(event.data);
            }
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

        // 親ウィンドウにxtadテキストを読み込むリクエストを送信
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: 'read-xtad-text',
                realId: this.realId,
                windowId: this.windowId
            }, '*');
        } else {
            console.error('[UrlLinkExec] 親ウィンドウが見つかりません');
            this.closeWindow();
        }
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

        // 親ウィンドウにURLを開くリクエストを送信
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: 'open-url-external',
                url: url,
                windowId: this.windowId
            }, '*');
        } else {
            console.error('[UrlLinkExec] 親ウィンドウが見つかりません');
            this.closeWindow();
        }
    }

    async handleUrlOpened(data) {
        console.log('[UrlLinkExec] URLが開かれました:', data);

        if (!data.success) {
            console.error('[UrlLinkExec] URLを開くのに失敗しました:', data.error);
        }

        // 次のURLを開く
        this.currentIndex++;

        // 少し待ってから次のURLを開く（ブラウザの起動が重ならないように）
        setTimeout(() => {
            this.openNextUrl();
        }, 500);
    }

    closeWindow() {
        console.log('[UrlLinkExec] ウィンドウを閉じます');

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
            console.log('[UrlLinkExec] 非表示iframeを削除します');
            if (window.frameElement) {
                window.frameElement.remove();
            }
        }
    }
}

// プラグインを初期化
const urlLinkExec = new UrlLinkExec();
