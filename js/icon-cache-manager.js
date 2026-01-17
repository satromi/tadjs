/**
 * アイコンキャッシュ管理クラス
 * 実身のアイコンを読み込み、キャッシュする共通機能を提供
 * @module js/IconCacheManager
 */

import { getLogger } from './logger.js';

const logger = getLogger('IconCacheManager');

export class IconCacheManager {
    /**
     * @param {MessageBus} messageBus - MessageBusインスタンス
     * @param {string} logPrefix - ログメッセージのプレフィックス（例: '[EDITOR]'）
     */
    constructor(messageBus, logPrefix = '') {
        this.iconCache = new Map(); // realId -> Base64データ
        this.messageBus = messageBus;
        this.logPrefix = logPrefix;
    }

    /**
     * アイコンを読み込む（キャッシュ優先）
     * @param {string} realId - 実身ID
     * @returns {Promise<string|null>} Base64エンコードされたアイコンデータ（失敗時はnull）
     */
    async loadIcon(realId) {
        // キャッシュチェック
        if (this.iconCache.has(realId)) {
            const cachedData = this.iconCache.get(realId);
            logger.debug(`${this.logPrefix} アイコンキャッシュヒット:`, realId, 'データあり:', !!cachedData);
            return cachedData;
        }

        // 親ウィンドウにアイコンファイルのパスを要求
        const messageId = `icon-${realId}-${Date.now()}`;
        this.messageBus.send('read-icon-file', {
            realId: realId,
            messageId: messageId
        });

        try {
            // レスポンスを待つ（タイムアウト: 5秒）
            const result = await this.messageBus.waitFor('icon-file-loaded', 5000, (data) => {
                return data.messageId === messageId;
            });

            if (result.success && result.filePath) {
                // Electron環境でファイルを読み込み
                if (typeof require !== 'undefined') {
                    try {
                        const fs = require('fs');
                        const buffer = fs.readFileSync(result.filePath);
                        const base64 = buffer.toString('base64');

                        // VirtualObjectRendererが data:image/x-icon;base64, を追加するので、ここでは Base64 のみ返す

                        // キャッシュに保存
                        this.iconCache.set(realId, base64);
                        logger.debug(`${this.logPrefix} アイコン読み込み成功（親から）:`, realId, 'パス:', result.filePath);
                        return base64;
                    } catch (error) {
                        logger.error(`${this.logPrefix} アイコンファイル読み込みエラー:`, realId, error);
                        this.iconCache.set(realId, null);
                        return null;
                    }
                } else {
                    // ネストしたiframe環境（プレビュー表示等）では require が使えないため、これは想定内の動作
                    logger.debug(`${this.logPrefix} require not available (nested iframe environment)`);
                    this.iconCache.set(realId, null);
                    return null;
                }
            } else {
                // アイコンが存在しない場合はnullを返す
                this.iconCache.set(realId, null);
                logger.debug(`${this.logPrefix} アイコン読み込み失敗（親から）:`, realId);
                return null;
            }
        } catch (error) {
            // タイムアウト（アイコンがない場合も多いのでnullを返す）
            if (!this.iconCache.has(realId)) {
                this.iconCache.set(realId, null);
            }
            logger.debug(`${this.logPrefix} アイコン読み込みタイムアウト:`, realId);
            return null;
        }
    }

    /**
     * キャッシュから直接データを取得（同期的）
     * @param {string} realId - 実身ID
     * @returns {string|null|undefined} Base64データ、またはnull（キャッシュミスの場合はundefined）
     */
    getFromCache(realId) {
        return this.iconCache.get(realId);
    }

    /**
     * キャッシュに存在するかチェック
     * @param {string} realId - 実身ID
     * @returns {boolean}
     */
    hasInCache(realId) {
        return this.iconCache.has(realId);
    }

    /**
     * キャッシュをクリア
     */
    clearCache() {
        this.iconCache.clear();
        logger.debug(`${this.logPrefix} アイコンキャッシュをクリアしました`);
    }
}
