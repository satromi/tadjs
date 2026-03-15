/**
 * js/request-queue-manager.js
 * リクエストキュー管理クラス
 * - 並列実行数の制限
 * - 処理開始時からのタイムアウト計算
 * - 同一キーのリクエスト重複防止
 * plugin-base.js から分離
 */

export class RequestQueueManager {
    constructor() {
        // 処理タイプ別のキュー
        // Map<string, { queue: Array, active: number, maxConcurrent: number }>
        this._queues = new Map();

        // 同一キーのリクエスト重複防止用
        // Map<string, Promise>
        this._pendingRequests = new Map();
    }

    /**
     * キュー設定を登録
     * @param {string} queueType - キュータイプ（例: 'load-data-file', 'load-real-object'）
     * @param {number} maxConcurrent - 最大同時実行数
     */
    registerQueue(queueType, maxConcurrent = 10) {
        this._queues.set(queueType, {
            queue: [],
            active: 0,
            maxConcurrent: maxConcurrent
        });
    }

    /**
     * リクエストをキューに追加して実行
     * @param {string} queueType - キュータイプ
     * @param {string} requestKey - リクエストの一意キー（重複防止用、nullで重複防止無効）
     * @param {Function} requestFn - 実行する非同期関数
     * @param {number} timeout - タイムアウト（ms）
     * @returns {Promise} 処理結果
     */
    async enqueue(queueType, requestKey, requestFn, timeout) {
        // 同一キーのリクエストが実行中なら、そのPromiseを返す（重複防止）
        if (requestKey && this._pendingRequests.has(requestKey)) {
            return this._pendingRequests.get(requestKey);
        }

        const queueInfo = this._queues.get(queueType);
        if (!queueInfo) {
            // 未登録のキュータイプは直接実行
            return this._executeWithTimeout(requestFn, timeout);
        }

        // Promiseを作成してキューに追加
        let resolvePromise, rejectPromise;
        const promise = new Promise((resolve, reject) => {
            resolvePromise = resolve;
            rejectPromise = reject;
        });

        queueInfo.queue.push({
            requestFn,
            timeout,
            resolve: resolvePromise,
            reject: rejectPromise
        });

        // 重複防止マップに登録
        if (requestKey) {
            this._pendingRequests.set(requestKey, promise);
            // finally()は新しいPromiseを生成するため、元のrejectが伝播して
            // Uncaught (in promise) エラーになる。catch()で抑制する。
            promise.finally(() => {
                this._pendingRequests.delete(requestKey);
            }).catch(() => {});
        }

        // キュー処理を開始
        this._processQueue(queueType);

        return promise;
    }

    /**
     * キューから次のリクエストを処理
     * @private
     */
    _processQueue(queueType) {
        const queueInfo = this._queues.get(queueType);
        if (!queueInfo) return;

        // 最大同時実行数に達している場合は待機
        while (queueInfo.active < queueInfo.maxConcurrent && queueInfo.queue.length > 0) {
            const request = queueInfo.queue.shift();
            queueInfo.active++;

            // 処理開始時からタイムアウトを計算
            this._executeWithTimeout(request.requestFn, request.timeout)
                .then(request.resolve)
                .catch(request.reject)
                .finally(() => {
                    queueInfo.active--;
                    this._processQueue(queueType);
                });
        }
    }

    /**
     * タイムアウト付きで関数を実行
     * @private
     */
    async _executeWithTimeout(fn, timeout) {
        if (!timeout || timeout <= 0) {
            return fn();
        }

        let timeoutId;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
                reject(new Error(`Request timeout after ${timeout}ms`));
            }, timeout);
        });

        try {
            const result = await Promise.race([fn(), timeoutPromise]);
            clearTimeout(timeoutId);
            return result;
        } catch (e) {
            clearTimeout(timeoutId);
            throw e;
        }
    }
}
