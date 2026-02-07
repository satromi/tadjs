/**
 * MessageRouter - postMessageイベントを適切なハンドラーに振り分ける
 *
 * メッセージルーティング機構
 * 既存のmessageHandlersとの互換性を保ちながら、段階的に移行可能
 */

import { getLogger } from './logger.js';

const logger = getLogger('MessageRouter');

export class MessageRouter {
    /**
     * @param {TADjsDesktop} tadjs - TADjsDesktopインスタンス
     */
    constructor(tadjs) {
        this.tadjs = tadjs;
        this.handlers = new Map();

        // 既存のmessageHandlersとの互換性を保持
        this.legacyHandlers = tadjs.messageHandlers || {};

        logger.info('[MessageRouter] 初期化完了');
    }

    /**
     * ハンドラーを登録
     * @param {string} messageType - メッセージタイプ
     * @param {Function} handler - ハンドラー関数 async (data, event) => result
     * @param {Object} options - オプション
     * @param {boolean} options.autoResponse - 自動レスポンス送信（デフォルト: true）
     * @param {string} options.responseType - レスポンスメッセージタイプ（デフォルト: messageType + '-response'）
     */
    register(messageType, handler, options = {}) {
        const config = {
            handler,
            autoResponse: options.autoResponse !== undefined ? options.autoResponse : true,
            responseType: options.responseType || `${messageType}-response`,
            ...options
        };

        this.handlers.set(messageType, config);
        logger.debug(`[MessageRouter] ハンドラー登録: ${messageType}`);
    }

    /**
     * 複数のハンドラーを一括登録
     * @param {Object} handlerMap - { messageType: handler } または { messageType: { handler, options } } のマップ
     */
    registerBatch(handlerMap) {
        for (const [messageType, config] of Object.entries(handlerMap)) {
            if (typeof config === 'function') {
                this.register(messageType, config);
            } else {
                this.register(messageType, config.handler, config);
            }
        }
        logger.info(`[MessageRouter] 一括登録完了: ${Object.keys(handlerMap).length}件`);
    }

    /**
     * メッセージをルーティング
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<boolean>} - ハンドリングされた場合true、されなかった場合false
     */
    async route(event) {
        const data = event.data;
        if (!data || !data.type) {
            return false;
        }

        const messageType = data.type;
        const config = this.handlers.get(messageType);

        if (!config) {
            // 新規ハンドラーが見つからない場合、レガシーハンドラーを確認
            if (this.legacyHandlers[messageType]) {
                logger.debug(`[MessageRouter] レガシーハンドラーに委譲: ${messageType}`);
                return false; // レガシーシステムに処理を任せる
            }
            // 登録されていないメッセージタイプ
            return false;
        }

        try {
            logger.debug(`[MessageRouter] ルーティング: ${messageType}`);

            // ハンドラー実行
            const result = await config.handler(data, event);

            // 自動レスポンス送信
            if (config.autoResponse && event.source && this.tadjs?.parentMessageBus) {
                this.tadjs.parentMessageBus.respondTo(
                    event.source,
                    config.responseType,
                    {
                        messageId: data.messageId,
                        success: true,
                        result: result
                    }
                );
                logger.debug(`[MessageRouter] 自動レスポンス送信: ${config.responseType}`);
            }

            return true; // 処理完了
        } catch (error) {
            logger.error(`[MessageRouter] ハンドラーエラー (${messageType}):`, error);

            // エラーレスポンス送信
            if (config.autoResponse && event.source && this.tadjs?.parentMessageBus) {
                this.tadjs.parentMessageBus.respondTo(
                    event.source,
                    config.responseType,
                    {
                        messageId: data.messageId,
                        success: false,
                        error: error.message
                    }
                );
                logger.debug(`[MessageRouter] エラーレスポンス送信: ${config.responseType}`);
            }

            return true; // エラーでも処理済みとする
        }
    }

    /**
     * 登録されているハンドラー数を取得
     * @returns {number} ハンドラー数
     */
    getHandlerCount() {
        return this.handlers.size;
    }

    /**
     * 登録されているメッセージタイプの一覧を取得
     * @returns {string[]} メッセージタイプの配列
     */
    getRegisteredTypes() {
        return Array.from(this.handlers.keys());
    }
}
