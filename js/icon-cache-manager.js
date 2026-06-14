/**
 * アイコンキャッシュ管理クラス
 * 実身のアイコンを読み込み、キャッシュする共通機能を提供
 * @module js/IconCacheManager
 */

import { getLogger } from './logger.js';

const logger = getLogger('IconCacheManager');

// 失敗キャッシュのTTL（ミリ秒）: この期間を過ぎると再取得を試行。
// loadIconWithRetry は TTL に依存せず clearFailure で即再取得するため、 通常の loadIcon 呼び出しの
// 抑制期間は長めに保つ (短くすると .ico 恒久不在の実身に対する再描画ごとの無駄な read-icon-file が増える)
const FAILURE_CACHE_TTL = 30000;

export class IconCacheManager {
    /**
     * @param {MessageBus} messageBus - MessageBusインスタンス
     * @param {string} logPrefix - ログメッセージのプレフィックス（例: '[EDITOR]'）
     */
    constructor(messageBus, logPrefix = '') {
        this.iconCache = new Map(); // realId -> Base64データ または { failed: true, timestamp: number }
        this._inFlight = new Map(); // realId -> Promise (未応答リクエストの重複排除)
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
            // 失敗キャッシュのTTLチェック
            if (cachedData && cachedData.failed) {
                if (Date.now() - cachedData.timestamp > FAILURE_CACHE_TTL) {
                    this.iconCache.delete(realId);
                    // TTL超過: 再取得を試行
                } else {
                    return null;
                }
            } else {
                logger.debug(`${this.logPrefix} アイコンキャッシュヒット:`, realId, 'データあり:', !!cachedData);
                return cachedData;
            }
        }

        // in-flight 重複排除: 同一 realId の未応答リクエストを1本に集約し、 無駄な read-icon-file 往復を防ぐ
        if (this._inFlight.has(realId)) {
            return this._inFlight.get(realId);
        }
        const promise = this._doLoadIcon(realId);
        this._inFlight.set(realId, promise);
        try {
            return await promise;
        } finally {
            this._inFlight.delete(realId);
        }
    }

    /**
     * アイコンを親ウィンドウ経由で実際に読み込む (loadIcon の in-flight 集約の実体)
     * @param {string} realId - 実身ID
     * @returns {Promise<string|null>}
     */
    async _doLoadIcon(realId) {
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
                        this.iconCache.set(realId, { failed: true, timestamp: Date.now() });
                        return null;
                    }
                } else {
                    // ネストしたiframe環境（プレビュー表示等）では require が使えないため、これは想定内の動作
                    logger.debug(`${this.logPrefix} require not available (nested iframe environment)`);
                    this.iconCache.set(realId, { failed: true, timestamp: Date.now() });
                    return null;
                }
            } else {
                // アイコンが存在しない場合はnullを返す
                this.iconCache.set(realId, { failed: true, timestamp: Date.now() });
                logger.debug(`${this.logPrefix} アイコン読み込み失敗（親から）:`, realId);
                return null;
            }
        } catch (error) {
            // タイムアウト（アイコンがない場合も多いのでnullを返す）
            if (!this.iconCache.has(realId)) {
                this.iconCache.set(realId, { failed: true, timestamp: Date.now() });
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
        const cached = this.iconCache.get(realId);
        // 失敗キャッシュの場合はnullとして返す
        if (cached && cached.failed) return null;
        return cached;
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

    /**
     * 指定 realId の失敗キャッシュを無効化する (再取得を許可)
     * @param {string} realId - 実身ID
     */
    clearFailure(realId) {
        const c = this.iconCache.get(realId);
        if (c && c.failed) this.iconCache.delete(realId);
    }

    /**
     * アイコンを読み込み、 失敗時は一定間隔で再取得をリトライする。
     * 書庫解凍直後は .ico の書き込みが仮身描画より遅れるため、 失敗キャッシュを無効化して再取得し、
     * .ico が揃い次第確実にアイコンを表示する。 既存実身(.ico あり)は初回で成功しリトライしない。
     * @param {string} realId - 実身ID
     * @param {number} retries - 最大リトライ回数
     * @param {number} delay - リトライ間隔(ms)
     * @returns {Promise<string|null>}
     */
    async loadIconWithRetry(realId, retries = 5, delay = 600) {
        let data = await this.loadIcon(realId);
        // nested iframe(require不可)環境では .ico を読めず、 リトライしても回復しないため即返す
        if (typeof require === 'undefined') return data;
        for (let i = 0; i < retries && !data; i++) {
            await new Promise(function (r) { setTimeout(r, delay); });
            this.clearFailure(realId);
            data = await this.loadIcon(realId);
        }
        return data;
    }
}
