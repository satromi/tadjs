import { getLogger, LogLevel } from './logger.js';

/**
 * プラグイン間通信を管理するメッセージバス
 * window.postMessage を使用したメッセージングを簡素化
 *
 * 主な機能:
 * - メッセージタイプ別のハンドラ登録
 * - コールバック付きメッセージ送信
 * - Promise ベースのメッセージ待機
 * - 自動的なコールバック管理
 * - 親→子の双方向通信サポート
 */
export class MessageBus {
    /**
     * @param {Object} options - 設定オプション
     * @param {boolean} options.debug - デバッグログを出力するか
     * @param {string} options.pluginName - プラグイン名（ログ表示用）
     * @param {string} options.mode - 動作モード: 'child'（デフォルト）または 'parent'
     */
    constructor(options = {}) {
        this.pluginName = options.pluginName || 'Plugin';
        this.mode = options.mode || 'child';  // 'child' または 'parent'
        this.handlers = new Map();           // type -> handler
        this.callbacks = new Map();          // messageId -> callback
        this.waiters = new Map();            // type -> array of { filter, resolve, reject, timeoutId }
        this.callbackCounter = 0;
        this.isListening = false;
        this._boundHandler = null;          // イベントリスナーの参照を保持（削除用）

        // 子モードの場合: windowIdを保持（レスポンスルーティング用）
        if (this.mode === 'child') {
            this.windowId = null;            // 親から割り当てられたwindowId
        }

        // Logger初期化（pluginName + MessageBus をモジュール名として使用）
        this.logger = getLogger(`${this.pluginName} MessageBus`);
        // debugオプションが指定された場合はDEBUGレベルに設定
        if (options.debug) {
            this.logger.setLevel(LogLevel.DEBUG);
        }

        // 親モードの場合のみ子iframe管理用Mapを初期化
        if (this.mode === 'parent') {
            this.children = new Map();       // id -> { iframe, windowId, pluginId }
            this.windowToChild = new Map();  // windowId -> id
            this.pluginToChild = new Map();  // pluginId -> id
        }
    }

    /**
     * 子モードでwindowIdを設定
     * initメッセージ受信時に呼び出す
     * @param {string} windowId - 親から割り当てられたwindowId
     */
    setWindowId(windowId) {
        if (this.mode !== 'child') {
            this.warn('setWindowId() is only available in child mode');
            return;
        }
        this.windowId = windowId;
        this.log(`WindowId set: ${windowId}`);
    }

    /**
     * メッセージリスナーを開始
     * 既に開始されている場合は何もしない
     */
    start() {
        if (this.isListening) {
            this.warn('MessageBus already started');
            return;
        }

        this._boundHandler = this._handleMessage.bind(this);
        window.addEventListener('message', this._boundHandler);
        this.isListening = true;
        this.log('MessageBus started');
    }

    /**
     * メッセージリスナーを停止
     * メモリリークを防ぐため、不要になったら必ず呼ぶこと
     */
    stop() {
        if (!this.isListening) {
            this.warn('MessageBus not started');
            return;
        }

        if (this._boundHandler) {
            window.removeEventListener('message', this._boundHandler);
            this._boundHandler = null;
        }

        this.isListening = false;
        this.handlers.clear();

        // すべてのコールバックのタイムアウトをクリア
        for (const [messageId, callbackData] of this.callbacks.entries()) {
            if (callbackData.timeoutId) {
                clearTimeout(callbackData.timeoutId);
            }
        }
        this.callbacks.clear();

        this.log('MessageBus stopped');
    }

    /**
     * メッセージタイプに対するハンドラを登録
     * 同じタイプに複数のハンドラを登録すると、最後のものが使用される
     *
     * @param {string} messageType - メッセージタイプ
     * @param {Function} handler - ハンドラ関数 (data, event) => void
     */
    on(messageType, handler) {
        if (typeof handler !== 'function') {
            this.error(`Handler for ${messageType} must be a function`);
            return;
        }

        if (this.handlers.has(messageType)) {
            this.warn(`Handler for ${messageType} is being replaced`);
        }

        this.handlers.set(messageType, handler);
        this.log(`Handler registered for: ${messageType}`);
    }

    /**
     * ハンドラを削除
     *
     * @param {string} messageType - メッセージタイプ
     */
    off(messageType) {
        if (this.handlers.delete(messageType)) {
            this.log(`Handler removed for: ${messageType}`);
        } else {
            this.warn(`No handler found for: ${messageType}`);
        }
    }

    /**
     * 親ウィンドウにメッセージを送信
     *
     * @param {string} type - メッセージタイプ
     * @param {Object} data - 送信データ
     */
    send(type, data = {}) {
        if (!window.parent || window.parent === window) {
            this.warn('Parent window not available for sending:', type);
            return;
        }

        try {
            // 子モードの場合、windowIdを自動的に含める（レスポンスルーティング用）
            const messageData = { type, ...data };
            if (this.mode === 'child' && this.windowId && !data.sourceWindowId) {
                messageData.sourceWindowId = this.windowId;
            }
            window.parent.postMessage(messageData, '*');
            this.log(`Sent message: ${type}`, data);
        } catch (error) {
            this.error(`Failed to send message ${type}:`, error);
        }
    }

    /**
     * メッセージを送信してレスポンスを待つ（コールバック版）
     * タイムアウト機能付き
     *
     * @param {string} type - 送信メッセージタイプ
     * @param {Object} data - 送信データ
     * @param {Function} callback - レスポンス受信時のコールバック (data) => void
     * @param {number} timeout - タイムアウト（ミリ秒、デフォルト5000、0またはnullでタイムアウト無効）
     * @returns {string} messageId - コールバックをキャンセルする際に使用
     */
    sendWithCallback(type, data, callback, timeout = 5000) {
        if (typeof callback !== 'function') {
            this.error(`Callback for ${type} must be a function`);
            return null;
        }

        const messageId = `${type}_${++this.callbackCounter}_${Date.now()}`;

        // タイムアウト設定（timeout が 0 または null の場合はタイムアウトを無効化）
        let timeoutId = null;
        if (timeout && timeout > 0) {
            timeoutId = setTimeout(() => {
                if (this.callbacks.has(messageId)) {
                    this.callbacks.delete(messageId);
                    this.warn(`Callback timeout for messageId: ${messageId} (${timeout}ms)`);
                    // タイムアウト時にコールバックを呼び出す（エラー情報付き）
                    try {
                        callback({ error: 'timeout', messageId, timeout });
                    } catch (error) {
                        this.error(`Error in timeout callback for ${messageId}:`, error);
                    }
                }
            }, timeout);
        }

        // コールバックとタイムアウトIDを保存
        this.callbacks.set(messageId, {
            callback: callback,
            timeoutId: timeoutId
        });

        this.send(type, { messageId, ...data });
        const timeoutInfo = timeout && timeout > 0 ? `${timeout}ms` : 'no timeout';
        this.log(`Registered callback for messageId: ${messageId} (${timeoutInfo})`);
        return messageId;
    }

    /**
     * コールバックをキャンセル
     * タイムアウトやクリーンアップ時に使用
     *
     * @param {string} messageId - sendWithCallbackで返されたID
     */
    cancelCallback(messageId) {
        const callbackData = this.callbacks.get(messageId);
        if (callbackData) {
            // タイムアウトをクリア
            if (callbackData.timeoutId) {
                clearTimeout(callbackData.timeoutId);
            }
            this.callbacks.delete(messageId);
            this.log(`Callback cancelled for: ${messageId}`);
        }
    }

    /**
     * 特定のメッセージタイプを待つ（Promise版）
     * タイムアウト機能付き
     *
     * @param {string} messageType - 待つメッセージタイプ
     * @param {number} timeout - タイムアウト（ミリ秒、デフォルト5000、0またはnullでタイムアウト無効）
     * @param {Function} filter - オプション：メッセージをフィルタリングする関数 (data) => boolean
     * @returns {Promise<Object>} メッセージデータ
     */
    waitFor(messageType, timeout = 5000, filter = null) {
        return new Promise((resolve, reject) => {
            // タイムアウト設定（timeout が 0 または null の場合はタイムアウトを無効化）
            let timeoutId = null;
            if (timeout && timeout > 0) {
                timeoutId = setTimeout(() => {
                    // タイムアウト時にwaitersから削除
                    this._removeWaiter(messageType, waiterEntry);
                    reject(new Error(`Timeout waiting for message: ${messageType} (${timeout}ms)`));
                }, timeout);
            }

            const waiterEntry = { filter, resolve, reject, timeoutId };

            // waitersリストに追加
            if (!this.waiters.has(messageType)) {
                this.waiters.set(messageType, []);
            }
            this.waiters.get(messageType).push(waiterEntry);
            const timeoutInfo = timeout && timeout > 0 ? `${timeout}ms` : 'no timeout';
            this.log(`Waiter added for: ${messageType} (${timeoutInfo}, total: ${this.waiters.get(messageType).length})`);
        });
    }

    /**
     * waitersリストから特定のwaiterを削除
     * @private
     */
    _removeWaiter(messageType, waiterEntry) {
        if (!this.waiters.has(messageType)) {
            return;
        }

        const waitList = this.waiters.get(messageType);
        const index = waitList.indexOf(waiterEntry);
        if (index >= 0) {
            clearTimeout(waiterEntry.timeoutId);
            waitList.splice(index, 1);
            this.log(`Waiter removed for: ${messageType} (remaining: ${waitList.length})`);

            if (waitList.length === 0) {
                this.waiters.delete(messageType);
            }
        }
    }

    /**
     * メッセージ受信の内部ハンドラ
     * すべてのメッセージを受け取り、適切なハンドラまたはコールバックに振り分ける
     *
     * @private
     * @param {MessageEvent} event - メッセージイベント
     */
    _handleMessage(event) {
        const data = event.data;

        // データが無いまたはtypeプロパティが無い場合はスキップ
        if (!data || !data.type) {
            return;
        }

        this.log(`Received message: ${data.type}`, data);

        // messageId付きレスポンスの場合、コールバックを実行
        if (data.messageId && this.callbacks.has(data.messageId)) {
            const callbackData = this.callbacks.get(data.messageId);
            this.callbacks.delete(data.messageId);

            // タイムアウトをクリア
            if (callbackData.timeoutId) {
                clearTimeout(callbackData.timeoutId);
            }

            try {
                callbackData.callback(data);
                this.log(`Callback executed for: ${data.messageId}`);
            } catch (error) {
                this.error(`Error in callback for ${data.messageId}:`, error);
            }
            return;
        }

        // waitersをチェック（複数のwaitForが同じメッセージタイプを待つ場合）
        if (this.waiters.has(data.type)) {
            const waitList = this.waiters.get(data.type);
            this.log(`Checking waiters for: ${data.type}, waiter count: ${waitList.length}`, {
                messageId: data.messageId,
                success: data.success
            });
            // フィルタに一致するwaiterを実行（後ろから処理して削除時にインデックスがずれないようにする）
            for (let i = waitList.length - 1; i >= 0; i--) {
                const waiter = waitList[i];
                // フィルタが無いか、フィルタを通過した場合
                const filterPassed = !waiter.filter || waiter.filter(data);
                this.log(`Waiter ${i}: filter passed = ${filterPassed}`, {
                    hasFilter: !!waiter.filter,
                    messageId: data.messageId
                });
                if (filterPassed) {
                    clearTimeout(waiter.timeoutId);
                    waitList.splice(i, 1);
                    waiter.resolve(data);
                    this.log(`Waiter resolved for: ${data.type} (remaining: ${waitList.length})`);
                }
            }

            // 全てのwaiterが処理されたら削除
            if (waitList.length === 0) {
                this.waiters.delete(data.type);
            }
        }

        // 登録されたハンドラを実行
        if (this.handlers.has(data.type)) {
            const handler = this.handlers.get(data.type);

            try {
                handler(data, event);
            } catch (error) {
                this.error(`Error in handler for ${data.type}:`, error);
                // エラーが発生してもメッセージバスは継続動作
            }
        }
        // ハンドラが登録されていない場合は何もしない（意図的に無視）
    }

    /**
     * デバッグログ出力（DEBUGレベル以上で出力）
     */
    log(...args) {
        this.logger.debug(...args);
    }

    /**
     * 警告ログ出力（WARNレベル以上で出力）
     */
    warn(...args) {
        this.logger.warn(...args);
    }

    /**
     * エラーログ出力（ERRORレベル以上で出力）
     */
    error(...args) {
        this.logger.error(...args);
    }

    // ========================================
    // 親モード専用メソッド（子iframe管理・送信）
    // ========================================

    /**
     * 子iframe（プラグイン）を登録
     * 親モードでのみ使用
     *
     * @param {string} id - 一意な識別子（通常はwindowId）
     * @param {HTMLIFrameElement} iframe - 子iframe要素
     * @param {Object} options - オプション
     * @param {string} options.windowId - ウィンドウID
     * @param {string} options.pluginId - プラグインID
     */
    registerChild(id, iframe, options = {}) {
        if (this.mode !== 'parent') {
            this.error('registerChild() can only be called in parent mode');
            return;
        }

        if (!iframe || !iframe.contentWindow) {
            this.error(`Invalid iframe for child: ${id}`);
            return;
        }

        const childInfo = {
            iframe: iframe,
            windowId: options.windowId || id,
            pluginId: options.pluginId || null
        };

        this.children.set(id, childInfo);

        // 逆引き用マップにも登録
        if (childInfo.windowId) {
            this.windowToChild.set(childInfo.windowId, id);
        }
        if (childInfo.pluginId) {
            this.pluginToChild.set(childInfo.pluginId, id);
        }

        this.log(`Child registered: ${id} (windowId: ${childInfo.windowId}, pluginId: ${childInfo.pluginId})`);
    }

    /**
     * 子iframeの登録を解除
     * 親モードでのみ使用
     *
     * @param {string} id - 子の識別子
     */
    unregisterChild(id) {
        if (this.mode !== 'parent') {
            this.error('unregisterChild() can only be called in parent mode');
            return;
        }

        const childInfo = this.children.get(id);
        if (!childInfo) {
            this.warn(`Child not found: ${id}`);
            return;
        }

        // 逆引き用マップからも削除
        if (childInfo.windowId) {
            this.windowToChild.delete(childInfo.windowId);
        }
        if (childInfo.pluginId) {
            this.pluginToChild.delete(childInfo.pluginId);
        }

        this.children.delete(id);
        this.log(`Child unregistered: ${id}`);
    }

    /**
     * 特定の子iframeにメッセージを送信
     * 親モードでのみ使用
     *
     * @param {string} id - 子の識別子
     * @param {string} type - メッセージタイプ
     * @param {Object} data - 送信データ
     */
    sendToChild(id, type, data = {}) {
        if (this.mode !== 'parent') {
            this.error('sendToChild() can only be called in parent mode');
            return;
        }

        const childInfo = this.children.get(id);
        if (!childInfo) {
            this.warn(`Child not found: ${id}`);
            return;
        }

        if (!childInfo.iframe || !childInfo.iframe.contentWindow) {
            this.error(`Invalid iframe for child: ${id}`);
            return;
        }

        try {
            childInfo.iframe.contentWindow.postMessage({ type, ...data }, '*');
            this.log(`Sent to child ${id}: ${type}`, data);
        } catch (error) {
            this.error(`Failed to send to child ${id}:`, error);
        }
    }

    /**
     * windowIdを指定して子iframeにメッセージを送信
     * 親モードでのみ使用
     *
     * @param {string} windowId - ウィンドウID
     * @param {string} type - メッセージタイプ
     * @param {Object} data - 送信データ
     */
    sendToWindow(windowId, type, data = {}) {
        if (this.mode !== 'parent') {
            this.error('sendToWindow() can only be called in parent mode');
            return;
        }

        const childId = this.windowToChild.get(windowId);
        if (!childId) {
            this.warn(`Window not found: ${windowId}`);
            return;
        }

        this.sendToChild(childId, type, data);
    }

    /**
     * pluginIdを指定して子iframeにメッセージを送信
     * 同じpluginIdを持つ最初の子に送信される
     * 親モードでのみ使用
     *
     * @param {string} pluginId - プラグインID
     * @param {string} type - メッセージタイプ
     * @param {Object} data - 送信データ
     */
    sendToPlugin(pluginId, type, data = {}) {
        if (this.mode !== 'parent') {
            this.error('sendToPlugin() can only be called in parent mode');
            return;
        }

        const childId = this.pluginToChild.get(pluginId);
        if (!childId) {
            this.warn(`Plugin not found: ${pluginId}`);
            return;
        }

        this.sendToChild(childId, type, data);
    }

    /**
     * すべての子iframeにメッセージをブロードキャスト
     * 親モードでのみ使用
     *
     * @param {string} type - メッセージタイプ
     * @param {Object} data - 送信データ
     */
    broadcast(type, data = {}) {
        if (this.mode !== 'parent') {
            this.error('broadcast() can only be called in parent mode');
            return;
        }

        let successCount = 0;
        let errorCount = 0;

        for (const [id, childInfo] of this.children.entries()) {
            if (!childInfo.iframe || !childInfo.iframe.contentWindow) {
                this.warn(`Invalid iframe for child: ${id}`);
                errorCount++;
                continue;
            }

            try {
                childInfo.iframe.contentWindow.postMessage({ type, ...data }, '*');
                successCount++;
            } catch (error) {
                this.error(`Failed to broadcast to child ${id}:`, error);
                errorCount++;
            }
        }

        this.log(`Broadcast ${type}: ${successCount} sent, ${errorCount} failed`);
    }

    /**
     * iframeからwindowIdを取得
     * 親モードでのみ使用
     *
     * @param {HTMLIFrameElement|Window} iframeOrWindow - iframe要素またはcontentWindow
     * @returns {string|null} - windowId、見つからない場合はnull
     */
    getWindowIdFromIframe(iframeOrWindow) {
        if (this.mode !== 'parent') {
            this.error('getWindowIdFromIframe() can only be called in parent mode');
            return null;
        }

        // iframeOrWindowがHTMLIFrameElementの場合
        let targetWindow = null;
        if (iframeOrWindow && iframeOrWindow.contentWindow) {
            targetWindow = iframeOrWindow.contentWindow;
        } else if (iframeOrWindow && iframeOrWindow.window === iframeOrWindow) {
            // iframeOrWindowがWindowオブジェクトの場合
            targetWindow = iframeOrWindow;
        }

        if (!targetWindow) {
            this.warn('Invalid iframe or window');
            return null;
        }

        // children Mapから逆引き
        for (const [id, childInfo] of this.children.entries()) {
            if (childInfo.iframe && childInfo.iframe.contentWindow === targetWindow) {
                return childInfo.windowId;
            }
        }

        // windowIdが見つからない（openable: false のプラグインでは正常動作）
        this.log('WindowId not found for the given iframe/window (may be openable: false plugin)');
        return null;
    }

    /**
     * e.source（メッセージイベントのsource）からwindowIdを取得
     * 親モードでのみ使用
     *
     * @param {Window} source - メッセージイベントのe.source
     * @returns {string|null} - windowId、見つからない場合はnull
     */
    getWindowIdFromSource(source) {
        if (this.mode !== 'parent') {
            this.error('getWindowIdFromSource() can only be called in parent mode');
            return null;
        }

        return this.getWindowIdFromIframe(source);
    }

    /**
     * e.sourceに対してレスポンスメッセージを送信
     * 親モードでのみ使用
     *
     * @param {Window} source - メッセージイベントのe.source
     * @param {string} type - レスポンスメッセージタイプ
     * @param {Object} data - レスポンスデータ
     * @param {string} sourceWindowId - 送信元のwindowId（オプション、source解決失敗時のフォールバック）
     */
    respondTo(source, type, data = {}, sourceWindowId = null) {
        if (this.mode !== 'parent') {
            this.error('respondTo() can only be called in parent mode');
            return;
        }

        // e.sourceからwindowIdを取得
        let windowId = source ? this.getWindowIdFromSource(source) : null;

        // sourceから取得できない場合、sourceWindowIdをフォールバックとして使用
        if (!windowId && sourceWindowId) {
            windowId = sourceWindowId;
            this.logger.debug(`[respondTo] Using sourceWindowId fallback: ${windowId}`);
        }

        this.log(`respondTo: type=${type}, windowId=${windowId}, hasSource=${!!source}, sourceWindowId=${sourceWindowId}`, {
            messageId: data.messageId,
            success: data.success,
            error: data.error
        });

        if (windowId) {
            // MessageBus経由で送信
            this.sendToWindow(windowId, type, data);
            this.logger.debug(`[respondTo] Response sent via MessageBus: ${type}, windowId=${windowId}`);
        } else if (source && source.postMessage) {
            // フォールバック: 旧postMessage方式（openable: false のプラグインでは正常動作）
            this.logger.debug(`[respondTo] Using fallback postMessage (windowId not found)`);
            try {
                source.postMessage({ type, ...data }, '*');
                this.logger.debug(`[respondTo] Response sent via fallback postMessage: ${type}`);
            } catch (error) {
                this.error(`[respondTo] Failed to send response via fallback: ${type}`, error);
            }
        } else {
            this.error(`[respondTo] Cannot send response: no valid target for ${type}`, {
                hasSource: !!source,
                hasPostMessage: !!(source && source.postMessage),
                windowId: windowId,
                sourceWindowId: sourceWindowId,
                messageId: data.messageId
            });
        }
    }
}
