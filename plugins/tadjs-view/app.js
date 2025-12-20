/**
 * TADjs表示プラグイン
 * TADファイルとBPKファイルを表示するプラグイン
 *
 * 描画は親ウィンドウのtad.jsを使用し、iframe内のcanvasに描画する
 * 仮身リンクのクリックは親ウィンドウに通知し、親ウィンドウで新しいTADウィンドウを開く
 * 
 * @module TADjsView
 * @extends PluginBase
 * @license MIT
 * @author satromi
 * @version 1.0.0
 */
const logger = window.getLogger('TADjsView');

class TADjsViewPlugin extends window.PluginBase {
    constructor() {
        super('TADjsView');
        logger.info('[TADjsView] 初期化開始');

        this.canvas = null;
        this.fileData = null;
        this.canvasId = 'tadCanvas';
        // this.realId は PluginBase で定義済み
        this.linkRecordList = null; // BPKのlinkRecordList（tad.jsから取得）
        this.tadRecordDataArray = null; // BPKのtadRecordDataArray（tad.jsから取得）
        // this.debug は PluginBase で定義済み（window.TADjsConfig?.debug || false）

        // MessageBusはPluginBaseで初期化済み

        // 初期化
        this.init();
    }

    /**
     * 初期化処理
     */
    init() {
        logger.debug('[TADjsView] 初期化開始');

        // Canvasを取得
        this.canvas = document.getElementById(this.canvasId);
        if (!this.canvas) {
            logger.error('[TADjsView] Canvas element not found');
            return;
        }

        // 初期サイズを設定
        this.canvas.width = 1200;
        this.canvas.height = 1000;

        // MessageBusのハンドラを登録
        if (this.messageBus) {
            this.setupMessageBusHandlers();
        }

        // ウィンドウアクティベーション
        this.setupWindowActivation();

        // Canvasに右クリックメニューイベントを設定
        this.setupContextMenu();

        this.messageBus.send('plugin-ready', {
            pluginId: 'tadjs-view'
        });

        logger.debug('[TADjsView] Plugin initialized');
    }

    /**
     * MessageBusのハンドラを登録
     * 親ウィンドウからのメッセージを受信して処理
     */
    setupMessageBusHandlers() {
        // init メッセージ
        this.messageBus.on('init', (data) => {
            logger.debug('[TADjsView] [MessageBus] init受信:', data);
            // MessageBusにwindowIdを設定（レスポンスルーティング用）
            if (data.windowId) {
                this.messageBus.setWindowId(data.windowId);
            }
            this.fileData = data.fileData;

            // realIdを保存（拡張子を除去）
            if (data.fileData) {
                let rawId = data.fileData.realId || data.fileData.fileId;
                this.realId = rawId ? rawId.replace(/_\d+\.xtad$/, '').replace(/\.(bpk|BPK)$/, '') : null;
                logger.debug('[TADjsView] [MessageBus] realId設定:', this.realId);

                // createTADWindowと同様にoriginalLinkIdを保存
                if (data.fileData.originalLinkId !== undefined) {
                    window.originalLinkId = data.fileData.originalLinkId;
                    logger.debug('[TADjsView] [MessageBus] originalLinkId設定:', window.originalLinkId);
                }

                // 親ウィンドウから受け取ったlinkRecordListを保存
                if (data.fileData.linkRecordList) {
                    this.linkRecordList = data.fileData.linkRecordList;
                    window.linkRecordList = data.fileData.linkRecordList;
                    logger.debug('[TADjsView] [MessageBus] linkRecordList設定:', this.linkRecordList.length, 'files');
                } else {
                    logger.warn('[TADjsView] [MessageBus] No linkRecordList in fileData');
                }

                // tadRecordDataArrayも受け取る
                if (data.fileData.tadRecordDataArray) {
                    this.tadRecordDataArray = data.fileData.tadRecordDataArray;
                    logger.debug('[TADjsView] [MessageBus] tadRecordDataArray設定:', this.tadRecordDataArray.length, 'records');
                }
            }

            // fileData.fileまたはfileData.fileNameからファイル情報を取得
            const fileName = this.fileData?.fileName || this.fileData?.file?.name;
            const rawData = this.fileData?.rawData;
            logger.debug('[TADjsView] [MessageBus] File name:', fileName);

            if (fileName && rawData) {
                // プラグイン内でTAD描画を実行
                const uint8Array = rawData instanceof Uint8Array ? rawData : new Uint8Array(rawData);
                this.renderTAD(fileName, uint8Array);
            } else {
                logger.error('[TADjsView] [MessageBus] No file information or raw data found');
            }
        });

        // window-moved メッセージ
        this.messageBus.on('window-moved', (data) => {
            logger.debug('[TADjsView] [MessageBus] window-moved受信');
            this.updateWindowConfig({
                pos: data.pos,
                width: data.width,
                height: data.height
            });
        });

        // window-resized-end メッセージ
        this.messageBus.on('window-resized-end', (data) => {
            logger.debug('[TADjsView] [MessageBus] window-resized-end受信');
            this.updateWindowConfig({
                pos: data.pos,
                width: data.width,
                height: data.height
            });
        });

        // window-maximize-toggled メッセージ
        this.messageBus.on('window-maximize-toggled', (data) => {
            logger.debug('[TADjsView] [MessageBus] window-maximize-toggled受信');
            this.updateWindowConfig({
                pos: data.pos,
                width: data.width,
                height: data.height,
                maximize: data.maximize
            });
        });

        // get-menu-definition メッセージ
        this.messageBus.on('get-menu-definition', (data) => {
            logger.debug('[TADjsView] [MessageBus] get-menu-definition受信');
            // 右クリックメニュー定義要求に応答（表示専用プラグインなので空メニュー）
            this.messageBus.send('menu-definition-response', {
                messageId: data.messageId,
                menuDefinition: []
            });
        });

        logger.debug('[TADjsView] MessageBusハンドラ登録完了');
    }

    // setupWindowActivation() は PluginBase 共通メソッドを使用

    /**
     * TADファイルをプラグイン内で描画
     * @param {string} fileName - ファイル名
     * @param {Uint8Array} rawData - TADファイルの生データ
     */
    async renderTAD(fileName, rawData) {
        logger.debug('[TADjsView] Rendering TAD file:', fileName);

        try {
            // tad.jsがリンク処理をスキップしないように、canvas.virtualObjectLinksをクリア
            if (this.canvas.virtualObjectLinks) {
                logger.debug('[TADjsView] Clearing existing virtualObjectLinks to allow tad.js link processing');
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
                    logger.debug('[TADjsView] canvasInit called with:', this.canvasId);
                    logger.debug('[TADjsView] window.canvas:', window.canvas);
                    logger.debug('[TADjsView] window.canvas.id:', window.canvas ? window.canvas.id : 'undefined');
                }

                // tad.jsが使用するwindow.canvasからもvirtualObjectLinksをクリア
                logger.debug('[TADjsView] DEBUG: Before clearing - window.canvas.virtualObjectLinks:', window.canvas ? window.canvas.virtualObjectLinks : 'window.canvas is null');
                if (window.canvas && window.canvas.virtualObjectLinks) {
                    logger.debug('[TADjsView] Clearing window.canvas.virtualObjectLinks to allow tad.js link processing');
                    delete window.canvas.virtualObjectLinks;
                    delete window.canvas.tadRecordDataArray;
                }
                logger.debug('[TADjsView] DEBUG: After clearing - window.canvas.virtualObjectLinks:', window.canvas ? window.canvas.virtualObjectLinks : 'window.canvas is null');

                // 描画完了コールバックを設定（tad.jsはwindow.canvas.idから自動的にコールバック名を決定）
                const callbackName = `tadProcessingComplete_${this.canvasId}`;
                logger.debug('[TADjsView] Setting callback:', callbackName);
                window[callbackName] = (tadData) => {
                    logger.debug('[TADjsView] !!!!! TAD processing completed callback called !!!!!');
                    logger.debug('[TADjsView] tadData:', tadData);
                    logger.debug('[TADjsView] tadData.linkRecordList:', tadData ? tadData.linkRecordList : 'tadData is null');
                    logger.debug('[TADjsView] tadData.isProcessingBpk:', tadData ? tadData.isProcessingBpk : 'tadData is null');

                    // tadjs-desktop.jsと同様にtadData.linkRecordListを取得
                    if (tadData && tadData.linkRecordList && tadData.linkRecordList.length > 0) {
                        this.linkRecordList = tadData.linkRecordList;
                        this.tadRecordDataArray = tadData.tadRecordDataArray || [];
                        logger.debug('[TADjsView] Got linkRecordList from tadData:', this.linkRecordList.length, 'files');
                        logger.debug('[TADjsView] linkRecordList[0] length:', this.linkRecordList[0] ? this.linkRecordList[0].length : 'undefined');

                        // tadjs-desktop.jsのsaveTadDataToCanvas相当の処理
                        this.saveTadDataToCanvas();

                        // tadjs-desktop.jsのsetupVirtualObjectEvents相当の処理
                        this.setupVirtualObjectEvents();
                    } else {
                        logger.warn('[TADjsView] No linkRecordList in tadData!', tadData);
                    }

                    this.onRenderingComplete(tadData);
                };
                logger.debug('[TADjsView] Callback set, window[' + callbackName + '] =', typeof window[callbackName]);

                // TAD描画を実行（引数は1つだけ）
                logger.debug('[TADjsView] DEBUG: Calling window.tadRawArray()...');
                window.tadRawArray(rawData);
                logger.debug('[TADjsView] TAD rendering initiated');

                // セカンダリウィンドウで親から受け取ったlinkRecordListがある場合、
                // コールバックが呼ばれない可能性があるため、タイマーで確認
                setTimeout(() => {
                    if (this.linkRecordList && !this.canvas.virtualObjectLinks) {
                        logger.debug('[TADjsView] Callback not called, manually setting up virtual objects');
                        this.saveTadDataToCanvas();
                        this.setupVirtualObjectEvents();
                    }
                }, 100);
            } else {
                logger.error('[TADjsView] TAD.js functions not available');
            }
        } catch (error) {
            logger.error('[TADjsView] Error rendering TAD:', error);
        }
    }

    /**
     * TAD描画完了時の処理
     * @param {Object} data - 描画完了データ
     */
    onRenderingComplete(data) {
        logger.debug('[TADjsView] Rendering complete data:', data);

        // BPKファイルの場合、ファイル0の描画バッファをcanvasに表示
        if (data.isProcessingBpk && window.tadFileDrawBuffers && window.tadFileDrawBuffers[0]) {
            logger.debug('[TADjsView] Rendering BPK file 0 to canvas');
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
                logger.debug('[TADjsView] BPK file 0 rendered successfully');
            }
        }

        // Canvas要素のサイズとスタイルを確認
        logger.debug('[TADjsView] Canvas size:', this.canvas.width, 'x', this.canvas.height);
        logger.debug('[TADjsView] Canvas display:', window.getComputedStyle(this.canvas).display);
        logger.debug('[TADjsView] Canvas visibility:', window.getComputedStyle(this.canvas).visibility);
        logger.debug('[TADjsView] Canvas offsetWidth/Height:', this.canvas.offsetWidth, 'x', this.canvas.offsetHeight);
        logger.debug('[TADjsView] Canvas rect:', this.canvas.getBoundingClientRect());

        // 仮身のダブルクリックイベントを設定
        const virtualLinks = data.linkRecordList && data.linkRecordList[0] ? data.linkRecordList[0] : [];

        // tadjs-desktop.js側と同じように、canvasに仮身情報とTADデータを保存
        this.canvas.virtualObjectLinks = virtualLinks;
        this.canvas.tadRecordDataArray = data.tadRecordDataArray;

        logger.debug('[TADjsView] Saved to canvas:', virtualLinks.length, 'links');

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
            logger.debug('[TADjsView] Context menu requested at canvas:', e.clientX, e.clientY);

            // iframe内の座標を親ウィンドウの座標に変換
            const iframeRect = window.frameElement.getBoundingClientRect();
            const parentX = e.clientX + iframeRect.left;
            const parentY = e.clientY + iframeRect.top;

            logger.debug('[TADjsView] Sending context menu request to parent at:', parentX, parentY);

            this.messageBus.send('context-menu-request', {
                x: parentX,
                y: parentY
            });
        };

        // 右クリックメニューのイベントリスナーを追加
        this.canvas.addEventListener('contextmenu', this.canvas._contextMenuHandler);
    }

    // updateWindowConfig() は基底クラス PluginBase で定義

    /**
     * 仮身リンククリックを親ウィンドウに通知
     * @param {Object} link - リンク情報
     * @param {Array} tadRecordArray - TADレコード配列
     */
    notifyLinkClick(link, tadRecordArray) {
        logger.debug('[TADjsView] Notifying link click:', link);
        logger.debug('[TADjsView] Debug - link.raw exists:', link.raw ? true : false);
        logger.debug('[TADjsView] Debug - link.raw length:', link.raw ? link.raw.length : 0);
        logger.debug('[TADjsView] Debug - link.link_id:', link.link_id);
        logger.debug('[TADjsView] Debug - tadRecordArray available:', tadRecordArray ? true : false);
        logger.debug('[TADjsView] Debug - tadRecordArray length:', tadRecordArray ? tadRecordArray.length : 0);

        // リンク先データを準備
        let linkData = null;

        // createTADWindowと同等の処理：link_idを使ってtadRecordArrayから取得
        if (link.link_id !== undefined && tadRecordArray) {
            // link_idは1始まりなので、配列インデックスとしては-1する
            const linkedIndex = parseInt(link.link_id) - 1;
            logger.debug('[TADjsView] Looking for linked file:', { link_id: link.link_id, linkedIndex, tadRecordArrayLength: tadRecordArray.length });

            if (tadRecordArray[linkedIndex]) {
                const linkedEntry = tadRecordArray[linkedIndex];
                logger.debug('[TADjsView] Found linked entry:', linkedEntry.name);
                linkData = {
                    type: 'bpk',
                    title: linkedEntry.name || link.link_name || `ファイル ${link.link_id}`,
                    data: Array.from(linkedEntry.data),
                    linkId: link.link_id
                };
            } else {
                logger.warn('[TADjsView] Link target not found:', { link_id: link.link_id, linkedIndex, tadRecordArrayLength: tadRecordArray.length });
            }
        } else if (link.raw && link.raw.length > 0) {
            // フォールバック：link.rawがある場合
            logger.debug('[TADjsView] Using link.raw as fallback');
            linkData = {
                type: 'raw',
                title: link.link_name || `仮身 - ${link.link_id || 'リンク'}`,
                data: Array.from(link.raw),
                linkId: link.link_id
            };
        } else {
            logger.warn('[TADjsView] No valid link data found');
        }

        if (linkData) {
            // 親ウィンドウに通知（linkRecordListも一緒に送る）
            logger.debug('[TADjsView] Sending linkRecordList:', this.linkRecordList ? this.linkRecordList.length : 'null', 'files');
            this.messageBus.send('open-tad-link', {
                linkData: linkData,
                linkRecordList: this.linkRecordList  // BPK全体のlinkRecordListを渡す
            });

            logger.debug('[TADjsView] Link click notified to parent:', linkData.title);
        }
    }

    /**
     * TADデータをcanvasに保存（tadjs-desktop.jsのsaveTadDataToCanvas相当）
     */
    saveTadDataToCanvas() {
        logger.debug('[TADjsView] saveTadDataToCanvas called');

        // originalLinkIdを取得（グローバル変数またはfileDataから）
        const originalLinkId = window.originalLinkId ?? this.fileData?.originalLinkId;
        logger.debug('[TADjsView] originalLinkId:', originalLinkId);

        // linkRecordListから適切なインデックスのリンクを取得
        let virtualLinks = [];

        if (originalLinkId !== null && originalLinkId !== undefined) {
            // セカンダリウィンドウの場合：originalLinkId - 1のインデックスを使用
            const linkIndex = parseInt(originalLinkId) - 1;
            logger.debug('[TADjsView] Secondary window: using linkRecordList[' + linkIndex + '] for originalLinkId', originalLinkId);

            if (this.linkRecordList && this.linkRecordList[linkIndex] && Array.isArray(this.linkRecordList[linkIndex])) {
                virtualLinks = [...this.linkRecordList[linkIndex]];
                logger.debug('[TADjsView] Using linkRecordList[' + linkIndex + '] with', virtualLinks.length, 'links');
            } else {
                logger.warn('[TADjsView] linkRecordList[' + linkIndex + '] not found for originalLinkId', originalLinkId);
            }
        } else {
            // メインウィンドウの場合：linkRecordList[0]を使用
            logger.debug('[TADjsView] Main window: using linkRecordList[0]');

            if (this.linkRecordList && this.linkRecordList[0] && Array.isArray(this.linkRecordList[0])) {
                virtualLinks = [...this.linkRecordList[0]];
                logger.debug('[TADjsView] Using linkRecordList[0] with', virtualLinks.length, 'links');
            } else {
                logger.warn('[TADjsView] linkRecordList[0] not found');
            }
        }

        // canvasにデータを保存
        this.canvas.virtualObjectLinks = virtualLinks;
        this.canvas.tadRecordDataArray = this.tadRecordDataArray ? [...this.tadRecordDataArray] : [];

        logger.debug('[TADjsView] Canvas data saved:', {
            virtualObjectLinks: this.canvas.virtualObjectLinks.length,
            tadRecordDataArray: this.canvas.tadRecordDataArray.length
        });
    }

    /**
     * 仮身オブジェクトのダブルクリックイベントを設定（tadjs-desktop.jsのsetupVirtualObjectEvents相当）
     */
    setupVirtualObjectEvents() {
        logger.debug('[TADjsView] setupVirtualObjectEvents called');

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

            logger.debug('[TADjsView] Canvas double-clicked at:', { x, y });

            // canvasに保存された仮身情報を使用
            const links = this.canvas.virtualObjectLinks || [];
            logger.debug('[TADjsView] Available virtual object links:', links.length);

            if (links && links.length > 0) {
                // クリック位置に仮身があるかチェック
                for (let i = 0; i < links.length; i++) {
                    const link = links[i];

                    if (link && link.left !== undefined && link.left <= x && x <= link.right &&
                        link.top !== undefined && link.top <= y && y <= link.bottom) {
                        logger.debug('[TADjsView] Virtual object double-clicked:', link);

                        // tadjs-desktop.jsと同じ処理
                        if (link.raw && link.raw.length > 0) {
                            // リンク先のTADデータがある場合
                            const linkData = {
                                type: 'raw',
                                title: link.link_name || `仮身 - ${link.link_id || 'リンク'}`,
                                data: Array.from(link.raw),
                                linkId: link.link_id
                            };

                            logger.debug('[TADjsView] Opening link with raw data:', linkData.title);
                                            this.messageBus.send('open-tad-link', {
                                linkData: linkData,
                                linkRecordList: this.linkRecordList,
                                tadRecordDataArray: this.tadRecordDataArray
                            });
                        } else if (link.link_id !== undefined) {
                            // BPK内の別ファイルへのリンクの場合
                            const linkedIndex = parseInt(link.link_id) - 1;  // link_idは1始まり、配列は0始まり
                            const tadRecordArray = this.canvas.tadRecordDataArray;

                            logger.debug('[TADjsView] Looking for link_id:', link.link_id, '-> array index:', linkedIndex, 'in tadRecordDataArray:', tadRecordArray ? tadRecordArray.length : 'null');

                            if (tadRecordArray && tadRecordArray[linkedIndex]) {
                                const linkedEntry = tadRecordArray[linkedIndex];
                                const linkData = {
                                    type: 'bpk',
                                    title: linkedEntry.name || `ファイル ${linkedIndex}`,
                                    data: Array.from(linkedEntry.data),
                                    linkId: link.link_id
                                };

                                logger.debug('[TADjsView] Opening linked entry:', linkData.title);
                                                    this.messageBus.send('open-tad-link', {
                                    linkData: linkData,
                                    linkRecordList: this.linkRecordList,
                                    tadRecordDataArray: this.tadRecordDataArray
                                });
                            } else {
                                logger.warn('[TADjsView] Link target not found:', linkedIndex);
                            }
                        }
                        break;
                    }
                }
            }
        };

        // イベントリスナーを追加
        this.canvas.addEventListener('dblclick', this.canvas._virtualObjectHandler);
        logger.debug('[TADjsView] Virtual object events setup complete');
    }

    /**
     * デバッグログ出力（デバッグモード時のみ）
     */
    log(...args) {
        if (this.debug) {
            logger.debug('[TADjsView]', ...args);
        }
    }

    /**
     * エラーログ出力（常に出力）
     */
    error(...args) {
        logger.error('[TADjsView]', ...args);
    }

    /**
     * 警告ログ出力（常に出力）
     */
    warn(...args) {
        logger.warn('[TADjsView]', ...args);
    }
}

// DOMContentLoaded後に初期化
document.addEventListener('DOMContentLoaded', () => {
    window.tadjsViewPlugin = new TADjsViewPlugin();
});
