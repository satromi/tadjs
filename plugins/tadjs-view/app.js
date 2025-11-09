/**
 * TADjs表示プラグイン
 * TADファイルとBPKファイルを表示するプラグイン
 *
 * 描画は親ウィンドウのtad.jsを使用し、iframe内のcanvasに描画する
 */
class TADjsViewPlugin {
    constructor() {
        this.canvas = null;
        this.fileData = null;
        this.canvasId = 'tadCanvas';
        this.realId = null; // 実身ID
        this.linkRecordList = null; // BPKのlinkRecordList（tad.jsから取得）
        this.tadRecordDataArray = null; // BPKのtadRecordDataArray（tad.jsから取得）

        // 初期化
        this.init();
    }

    /**
     * 初期化処理
     */
    init() {
        console.log('[TADjsView] 初期化開始');

        // Canvasを取得
        this.canvas = document.getElementById(this.canvasId);
        if (!this.canvas) {
            console.error('[TADjsView] Canvas element not found');
            return;
        }

        // 初期サイズを設定
        this.canvas.width = 1200;
        this.canvas.height = 1000;

        // 親ウィンドウからのメッセージを受信
        this.setupMessageHandler();

        // ウィンドウアクティベーション
        this.setupWindowActivation();

        // Canvasに右クリックメニューイベントを設定
        this.setupContextMenu();

        // 親ウィンドウに準備完了を通知
        window.parent.postMessage({
            type: 'plugin-ready',
            pluginId: 'tadjs-view'
        }, '*');

        console.log('[TADjsView] Plugin initialized');
    }

    /**
     * メッセージハンドラーを設定
     */
    setupMessageHandler() {
        window.addEventListener('message', (event) => {
            console.log('[TADjsView] Received message:', event.data?.type);

            if (event.data && event.data.type === 'init') {
                console.log('[TADjsView] Plugin initialized with data:', event.data);
                this.fileData = event.data.fileData;

                // realIdを保存（拡張子を除去）
                if (event.data.fileData) {
                    let rawId = event.data.fileData.realId || event.data.fileData.fileId;
                    this.realId = rawId ? rawId.replace(/_\d+\.xtad$/, '').replace(/\.(bpk|BPK)$/, '') : null;
                    console.log('[TADjsView] realId設定:', this.realId, '(元:', rawId, ')');

                    // createTADWindowと同様にoriginalLinkIdを保存
                    if (event.data.fileData.originalLinkId !== undefined) {
                        window.originalLinkId = event.data.fileData.originalLinkId;
                        console.log('[TADjsView] originalLinkId設定:', window.originalLinkId);
                    }

                    // 親ウィンドウから受け取ったlinkRecordListを保存
                    if (event.data.fileData.linkRecordList) {
                        this.linkRecordList = event.data.fileData.linkRecordList;
                        window.linkRecordList = event.data.fileData.linkRecordList;
                        console.log('[TADjsView] linkRecordList設定:', this.linkRecordList.length, 'files');
                        console.log('[TADjsView] Received linkRecordList[0]:', this.linkRecordList[0]);
                        console.log('[TADjsView] Received linkRecordList[4]:', this.linkRecordList[4]);
                    } else {
                        console.warn('[TADjsView] No linkRecordList in fileData');
                    }

                    // tadRecordDataArrayも受け取る
                    if (event.data.fileData.tadRecordDataArray) {
                        this.tadRecordDataArray = event.data.fileData.tadRecordDataArray;
                        console.log('[TADjsView] tadRecordDataArray設定:', this.tadRecordDataArray.length, 'records');
                    }
                }

                // fileData.fileまたはfileData.fileNameからファイル情報を取得
                const fileName = this.fileData?.fileName || this.fileData?.file?.name;
                const rawData = this.fileData?.rawData;
                console.log('[TADjsView] File name:', fileName);
                console.log('[TADjsView] Raw data:', rawData ? `${rawData.length} bytes` : 'not found');

                if (fileName && rawData) {
                    // プラグイン内でTAD描画を実行
                    const uint8Array = rawData instanceof Uint8Array ? rawData : new Uint8Array(rawData);
                    this.renderTAD(fileName, uint8Array);
                } else {
                    console.error('[TADjsView] No file information or raw data found in fileData');
                }
            } else if (event.data && event.data.type === 'window-moved') {
                // ウィンドウ移動終了時にwindowConfigを更新
                this.updateWindowConfig({
                    pos: event.data.pos,
                    width: event.data.width,
                    height: event.data.height
                });
            } else if (event.data && event.data.type === 'window-resized-end') {
                // ウィンドウリサイズ終了時にwindowConfigを更新
                this.updateWindowConfig({
                    pos: event.data.pos,
                    width: event.data.width,
                    height: event.data.height
                });
            } else if (event.data && event.data.type === 'window-maximize-toggled') {
                // 全画面表示切り替え時にwindowConfigを更新
                this.updateWindowConfig({
                    pos: event.data.pos,
                    width: event.data.width,
                    height: event.data.height,
                    maximize: event.data.maximize
                });
            } else if (event.data && event.data.type === 'get-menu-definition') {
                console.log('[TADjsView] Menu definition request received, messageId:', event.data.messageId);
                // 右クリックメニュー定義要求に応答（表示専用プラグインなので空メニュー）
                window.parent.postMessage({
                    type: 'menu-definition-response',
                    messageId: event.data.messageId,
                    menuDefinition: []
                }, '*');
                console.log('[TADjsView] Menu definition response sent');
            }
        });
    }

    /**
     * ウィンドウアクティベーション設定
     */
    setupWindowActivation() {
        document.addEventListener('mousedown', () => {
            if (window.parent && window.parent !== window) {
                window.parent.postMessage({
                    type: 'activate-window'
                }, '*');
            }
        });
    }

    /**
     * TADファイルをプラグイン内で描画
     * @param {string} fileName - ファイル名
     * @param {Uint8Array} rawData - TADファイルの生データ
     */
    async renderTAD(fileName, rawData) {
        console.log('[TADjsView] Rendering TAD file:', fileName);

        try {
            // tad.jsがリンク処理をスキップしないように、canvas.virtualObjectLinksをクリア
            if (this.canvas.virtualObjectLinks) {
                console.log('[TADjsView] Clearing existing virtualObjectLinks to allow tad.js link processing');
                delete this.canvas.virtualObjectLinks;
                delete this.canvas.tadRecordDataArray;
            }

            // TAD.jsの初期化
            if (typeof window.canvasInit === 'function') {
                window.canvasInit(this.canvasId);
            }

            if (typeof window.initTAD === 'function') {
                window.initTAD(this.canvas.width, this.canvas.height);
            }

            // TAD描画処理
            if (typeof window.tadRawArray === 'function') {
                // canvasInit を先に実行してwindow.canvasを設定
                if (typeof window.canvasInit === 'function') {
                    window.canvasInit(this.canvasId);
                    console.log('[TADjsView] canvasInit called with:', this.canvasId);
                    console.log('[TADjsView] window.canvas:', window.canvas);
                    console.log('[TADjsView] window.canvas.id:', window.canvas ? window.canvas.id : 'undefined');
                }

                // tad.jsが使用するwindow.canvasからもvirtualObjectLinksをクリア
                console.log('[TADjsView] DEBUG: Before clearing - window.canvas.virtualObjectLinks:', window.canvas ? window.canvas.virtualObjectLinks : 'window.canvas is null');
                if (window.canvas && window.canvas.virtualObjectLinks) {
                    console.log('[TADjsView] Clearing window.canvas.virtualObjectLinks to allow tad.js link processing');
                    delete window.canvas.virtualObjectLinks;
                    delete window.canvas.tadRecordDataArray;
                }
                console.log('[TADjsView] DEBUG: After clearing - window.canvas.virtualObjectLinks:', window.canvas ? window.canvas.virtualObjectLinks : 'window.canvas is null');

                // 描画完了コールバックを設定（tad.jsはwindow.canvas.idから自動的にコールバック名を決定）
                const callbackName = `tadProcessingComplete_${this.canvasId}`;
                console.log('[TADjsView] Setting callback:', callbackName);
                window[callbackName] = (tadData) => {
                    console.log('[TADjsView] !!!!! TAD processing completed callback called !!!!!');
                    console.log('[TADjsView] tadData:', tadData);
                    console.log('[TADjsView] tadData.linkRecordList:', tadData ? tadData.linkRecordList : 'tadData is null');
                    console.log('[TADjsView] tadData.isProcessingBpk:', tadData ? tadData.isProcessingBpk : 'tadData is null');

                    // tadjs-desktop.jsと同様にtadData.linkRecordListを取得
                    if (tadData && tadData.linkRecordList && tadData.linkRecordList.length > 0) {
                        this.linkRecordList = tadData.linkRecordList;
                        this.tadRecordDataArray = tadData.tadRecordDataArray || [];
                        console.log('[TADjsView] Got linkRecordList from tadData:', this.linkRecordList.length, 'files');
                        console.log('[TADjsView] linkRecordList[0] length:', this.linkRecordList[0] ? this.linkRecordList[0].length : 'undefined');

                        // tadjs-desktop.jsのsaveTadDataToCanvas相当の処理
                        this.saveTadDataToCanvas();

                        // tadjs-desktop.jsのsetupVirtualObjectEvents相当の処理
                        this.setupVirtualObjectEvents();
                    } else {
                        console.warn('[TADjsView] No linkRecordList in tadData!', tadData);
                    }

                    this.onRenderingComplete(tadData);
                };
                console.log('[TADjsView] Callback set, window[' + callbackName + '] =', typeof window[callbackName]);

                // TAD描画を実行（引数は1つだけ）
                console.log('[TADjsView] DEBUG: Calling window.tadRawArray()...');
                window.tadRawArray(rawData);
                console.log('[TADjsView] TAD rendering initiated');

                // セカンダリウィンドウで親から受け取ったlinkRecordListがある場合、
                // コールバックが呼ばれない可能性があるため、タイマーで確認
                setTimeout(() => {
                    if (this.linkRecordList && !this.canvas.virtualObjectLinks) {
                        console.log('[TADjsView] Callback not called, manually setting up virtual objects');
                        this.saveTadDataToCanvas();
                        this.setupVirtualObjectEvents();
                    }
                }, 100);
            } else {
                console.error('[TADjsView] TAD.js functions not available');
            }
        } catch (error) {
            console.error('[TADjsView] Error rendering TAD:', error);
        }
    }

    /**
     * TAD描画完了時の処理
     * @param {Object} data - 描画完了データ
     */
    onRenderingComplete(data) {
        console.log('[TADjsView] Rendering complete data:', data);

        // BPKファイルの場合、ファイル0の描画バッファをcanvasに表示
        if (data.isProcessingBpk && window.tadFileDrawBuffers && window.tadFileDrawBuffers[0]) {
            console.log('[TADjsView] Rendering BPK file 0 to canvas');
            const drawBuffer = window.tadFileDrawBuffers[0];
            const ctx = this.canvas.getContext('2d');

            if (ctx && drawBuffer) {
                // canvasをクリア
                ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

                // 描画バッファをcanvasに転送
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = drawBuffer.width;
                tempCanvas.height = drawBuffer.height;
                const tempCtx = tempCanvas.getContext('2d');
                tempCtx.putImageData(drawBuffer, 0, 0);

                // canvasに描画
                ctx.drawImage(
                    tempCanvas,
                    0, 0, this.canvas.width, this.canvas.height,
                    0, 0, this.canvas.width, this.canvas.height
                );
                console.log('[TADjsView] BPK file 0 rendered successfully');
            }
        }

        // Canvas要素のサイズとスタイルを確認
        console.log('[TADjsView] Canvas size:', this.canvas.width, 'x', this.canvas.height);
        console.log('[TADjsView] Canvas display:', window.getComputedStyle(this.canvas).display);
        console.log('[TADjsView] Canvas visibility:', window.getComputedStyle(this.canvas).visibility);
        console.log('[TADjsView] Canvas offsetWidth/Height:', this.canvas.offsetWidth, 'x', this.canvas.offsetHeight);
        console.log('[TADjsView] Canvas rect:', this.canvas.getBoundingClientRect());

        // 仮身のダブルクリックイベントを設定
        const virtualLinks = data.linkRecordList && data.linkRecordList[0] ? data.linkRecordList[0] : [];

        // tadjs-desktop.js側と同じように、canvasに仮身情報とTADデータを保存
        this.canvas.virtualObjectLinks = virtualLinks;
        this.canvas.tadRecordDataArray = data.tadRecordDataArray;

        console.log('[TADjsView] Saved to canvas:', virtualLinks.length, 'links');

        // Note: setupVirtualObjectEventsは、renderTAD()のsetTimeoutで呼ばれるため、ここでは呼ばない
        // （二重呼び出しを避けるため）
    }

    /**
     * 右クリックメニューの設定
     */
    setupContextMenu() {
        // 既存のハンドラーを削除
        if (this.canvas._contextMenuHandler) {
            this.canvas.removeEventListener('contextmenu', this.canvas._contextMenuHandler);
        }

        // 新しい右クリックメニューハンドラーを作成
        this.canvas._contextMenuHandler = (e) => {
            e.preventDefault();
            console.log('[TADjsView] Context menu requested at canvas:', e.clientX, e.clientY);

            // iframe内の座標を親ウィンドウの座標に変換
            const iframeRect = window.frameElement.getBoundingClientRect();
            const parentX = e.clientX + iframeRect.left;
            const parentY = e.clientY + iframeRect.top;

            console.log('[TADjsView] Sending context menu request to parent at:', parentX, parentY);

            window.parent.postMessage({
                type: 'context-menu-request',
                x: parentX,
                y: parentY
            }, '*');
        };

        // 右クリックメニューのイベントリスナーを追加
        this.canvas.addEventListener('contextmenu', this.canvas._contextMenuHandler);
    }

    /**
     * ウィンドウ設定を更新
     * @param {Object} windowConfig - ウィンドウ設定
     */
    updateWindowConfig(windowConfig) {
        if (window.parent && window.parent !== window && this.realId) {
            window.parent.postMessage({
                type: 'update-window-config',
                fileId: this.realId,
                windowConfig: windowConfig
            }, '*');

            console.log('[TADjsView] ウィンドウ設定を更新:', windowConfig);
        }
    }

    /**
     * 仮身リンククリックを親ウィンドウに通知
     * @param {Object} link - リンク情報
     * @param {Array} tadRecordArray - TADレコード配列
     */
    notifyLinkClick(link, tadRecordArray) {
        console.log('[TADjsView] Notifying link click:', link);
        console.log('[TADjsView] Debug - link.raw exists:', link.raw ? true : false);
        console.log('[TADjsView] Debug - link.raw length:', link.raw ? link.raw.length : 0);
        console.log('[TADjsView] Debug - link.link_id:', link.link_id);
        console.log('[TADjsView] Debug - tadRecordArray available:', tadRecordArray ? true : false);
        console.log('[TADjsView] Debug - tadRecordArray length:', tadRecordArray ? tadRecordArray.length : 0);

        // リンク先データを準備
        let linkData = null;

        // createTADWindowと同等の処理：link_idを使ってtadRecordArrayから取得
        if (link.link_id !== undefined && tadRecordArray) {
            // link_idは1始まりなので、配列インデックスとしては-1する
            const linkedIndex = parseInt(link.link_id) - 1;
            console.log('[TADjsView] Looking for linked file:', { link_id: link.link_id, linkedIndex, tadRecordArrayLength: tadRecordArray.length });

            if (tadRecordArray[linkedIndex]) {
                const linkedEntry = tadRecordArray[linkedIndex];
                console.log('[TADjsView] Found linked entry:', linkedEntry.name);
                linkData = {
                    type: 'bpk',
                    title: linkedEntry.name || link.link_name || `ファイル ${link.link_id}`,
                    data: Array.from(linkedEntry.data),
                    linkId: link.link_id
                };
            } else {
                console.warn('[TADjsView] Link target not found:', { link_id: link.link_id, linkedIndex, tadRecordArrayLength: tadRecordArray.length });
            }
        } else if (link.raw && link.raw.length > 0) {
            // フォールバック：link.rawがある場合
            console.log('[TADjsView] Using link.raw as fallback');
            linkData = {
                type: 'raw',
                title: link.link_name || `仮身 - ${link.link_id || 'リンク'}`,
                data: Array.from(link.raw),
                linkId: link.link_id
            };
        } else {
            console.warn('[TADjsView] No valid link data found');
        }

        if (linkData) {
            // 親ウィンドウに通知（linkRecordListも一緒に送る）
            console.log('[TADjsView] Sending linkRecordList:', this.linkRecordList ? this.linkRecordList.length : 'null', 'files');
            window.parent.postMessage({
                type: 'open-tad-link',
                linkData: linkData,
                linkRecordList: this.linkRecordList  // BPK全体のlinkRecordListを渡す
            }, '*');

            console.log('[TADjsView] Link click notified to parent:', linkData.title);
        }
    }

    /**
     * TADデータをcanvasに保存（tadjs-desktop.jsのsaveTadDataToCanvas相当）
     */
    saveTadDataToCanvas() {
        console.log('[TADjsView] saveTadDataToCanvas called');

        // originalLinkIdを取得（グローバル変数またはfileDataから）
        const originalLinkId = window.originalLinkId ?? this.fileData?.originalLinkId;
        console.log('[TADjsView] originalLinkId:', originalLinkId);

        // linkRecordListから適切なインデックスのリンクを取得
        let virtualLinks = [];

        if (originalLinkId !== null && originalLinkId !== undefined) {
            // セカンダリウィンドウの場合：originalLinkId - 1のインデックスを使用
            const linkIndex = parseInt(originalLinkId) - 1;
            console.log('[TADjsView] Secondary window: using linkRecordList[' + linkIndex + '] for originalLinkId', originalLinkId);

            if (this.linkRecordList && this.linkRecordList[linkIndex] && Array.isArray(this.linkRecordList[linkIndex])) {
                virtualLinks = [...this.linkRecordList[linkIndex]];
                console.log('[TADjsView] Using linkRecordList[' + linkIndex + '] with', virtualLinks.length, 'links');
            } else {
                console.warn('[TADjsView] linkRecordList[' + linkIndex + '] not found for originalLinkId', originalLinkId);
            }
        } else {
            // メインウィンドウの場合：linkRecordList[0]を使用
            console.log('[TADjsView] Main window: using linkRecordList[0]');

            if (this.linkRecordList && this.linkRecordList[0] && Array.isArray(this.linkRecordList[0])) {
                virtualLinks = [...this.linkRecordList[0]];
                console.log('[TADjsView] Using linkRecordList[0] with', virtualLinks.length, 'links');
            } else {
                console.warn('[TADjsView] linkRecordList[0] not found');
            }
        }

        // canvasにデータを保存
        this.canvas.virtualObjectLinks = virtualLinks;
        this.canvas.tadRecordDataArray = this.tadRecordDataArray ? [...this.tadRecordDataArray] : [];

        console.log('[TADjsView] Canvas data saved:', {
            virtualObjectLinks: this.canvas.virtualObjectLinks.length,
            tadRecordDataArray: this.canvas.tadRecordDataArray.length
        });
    }

    /**
     * 仮身オブジェクトのダブルクリックイベントを設定（tadjs-desktop.jsのsetupVirtualObjectEvents相当）
     */
    setupVirtualObjectEvents() {
        console.log('[TADjsView] setupVirtualObjectEvents called');

        // 既存のイベントリスナーを削除
        if (this.canvas._virtualObjectHandler) {
            this.canvas.removeEventListener('dblclick', this.canvas._virtualObjectHandler);
        }

        // 新しいダブルクリックハンドラーを作成
        this.canvas._virtualObjectHandler = (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const displayX = e.clientX - rect.left;
            const displayY = e.clientY - rect.top;

            // canvasの実際のサイズと表示サイズを比較してスケール比を計算
            const scaleX = this.canvas.width / rect.width;
            const scaleY = this.canvas.height / rect.height;

            // クリック座標をcanvasの実際の座標系に変換
            const x = displayX * scaleX;
            const y = displayY * scaleY;

            console.log('[TADjsView] Canvas double-clicked at:', { x, y });

            // canvasに保存された仮身情報を使用
            const links = this.canvas.virtualObjectLinks || [];
            console.log('[TADjsView] Available virtual object links:', links.length);

            if (links && links.length > 0) {
                // クリック位置に仮身があるかチェック
                for (let i = 0; i < links.length; i++) {
                    const link = links[i];

                    if (link && link.left !== undefined && link.left <= x && x <= link.right &&
                        link.top !== undefined && link.top <= y && y <= link.bottom) {
                        console.log('[TADjsView] Virtual object double-clicked:', link);

                        // tadjs-desktop.jsと同じ処理
                        if (link.raw && link.raw.length > 0) {
                            // リンク先のTADデータがある場合
                            const linkData = {
                                type: 'raw',
                                title: link.link_name || `仮身 - ${link.link_id || 'リンク'}`,
                                data: Array.from(link.raw),
                                linkId: link.link_id
                            };

                            console.log('[TADjsView] Opening link with raw data:', linkData.title);
                            window.parent.postMessage({
                                type: 'open-tad-link',
                                linkData: linkData,
                                linkRecordList: this.linkRecordList,
                                tadRecordDataArray: this.tadRecordDataArray
                            }, '*');
                        } else if (link.link_id !== undefined) {
                            // BPK内の別ファイルへのリンクの場合
                            const linkedIndex = parseInt(link.link_id) - 1;  // link_idは1始まり、配列は0始まり
                            const tadRecordArray = this.canvas.tadRecordDataArray;

                            console.log('[TADjsView] Looking for link_id:', link.link_id, '-> array index:', linkedIndex, 'in tadRecordDataArray:', tadRecordArray ? tadRecordArray.length : 'null');

                            if (tadRecordArray && tadRecordArray[linkedIndex]) {
                                const linkedEntry = tadRecordArray[linkedIndex];
                                const linkData = {
                                    type: 'bpk',
                                    title: linkedEntry.name || `ファイル ${linkedIndex}`,
                                    data: Array.from(linkedEntry.data),
                                    linkId: link.link_id
                                };

                                console.log('[TADjsView] Opening linked entry:', linkData.title);
                                window.parent.postMessage({
                                    type: 'open-tad-link',
                                    linkData: linkData,
                                    linkRecordList: this.linkRecordList,
                                    tadRecordDataArray: this.tadRecordDataArray
                                }, '*');
                            } else {
                                console.warn('[TADjsView] Link target not found:', linkedIndex);
                            }
                        }
                        break;
                    }
                }
            }
        };

        // イベントリスナーを追加
        this.canvas.addEventListener('dblclick', this.canvas._virtualObjectHandler);
        console.log('[TADjsView] Virtual object events setup complete');
    }
}

// DOMContentLoaded後に初期化
document.addEventListener('DOMContentLoaded', () => {
    window.tadjsViewPlugin = new TADjsViewPlugin();
});
