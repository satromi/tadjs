/**
 * UUID v7 生成ユーティリティ
 * 時刻ベースのUUID生成
 *
 * 
 */

class UuidV7Generator {
    /**
     * UUID v7を生成
     * @returns {string} UUID v7形式の文字列
     */
    static generate() {
        // 現在時刻をミリ秒で取得（48ビット使用）
        const timestamp = Date.now();

        // ランダムビット生成（10バイト = 80ビット、うち74ビット使用）
        const randomBytes = new Uint8Array(10);

        // 環境に応じたランダムバイト生成
        if (typeof window !== 'undefined' && window.crypto) {
            // Browser環境
            window.crypto.getRandomValues(randomBytes);
        } else if (typeof globalThis !== 'undefined' && globalThis.crypto &&
                   typeof globalThis.crypto.getRandomValues === 'function') {
            // Node.js 19+ または Web Crypto API対応環境
            globalThis.crypto.getRandomValues(randomBytes);
        } else if (typeof require === 'function') {
            // Node.js 18以前（CommonJS）
            try {
                const crypto = require('crypto');
                const nodeBytes = crypto.randomBytes(10);
                randomBytes.set(nodeBytes);
            } catch (e) {
                // require失敗時はフォールバック
                for (let i = 0; i < randomBytes.length; i++) {
                    randomBytes[i] = Math.floor(Math.random() * 256);
                }
            }
        } else {
            // フォールバック（非推奨）
            for (let i = 0; i < randomBytes.length; i++) {
                randomBytes[i] = Math.floor(Math.random() * 256);
            }
        }

        // UUID v7フォーマット (RFC 9562準拠)
        // xxxxxxxx-xxxx-7xxx-yxxx-xxxxxxxxxxxx
        // - 最初の48ビット: unix_ts_ms (ミリ秒タイムスタンプ)
        // - 次の4ビット: version = 7
        // - 次の12ビット: rand_a (ランダム)
        // - 次の2ビット: variant = 10
        // - 残り62ビット: rand_b (ランダム)

        const hex = (bytes) => Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');

        // タイムスタンプ部分 (48ビット)
        // 上位32ビット (8桁の16進数)
        const timePart1 = Math.floor(timestamp / 0x10000).toString(16).padStart(8, '0');
        // 下位16ビット (4桁の16進数)
        const timePart2 = (timestamp & 0xFFFF).toString(16).padStart(4, '0');

        // バージョン7 (4ビット) + rand_a (12ビット) = 4桁の16進数
        // randomBytes[0-1]の2バイト(16ビット)から、下位12ビットを使用
        const randA = ((randomBytes[0] << 8) | randomBytes[1]) & 0x0FFF; // 下位12ビット
        const versionPart = '7' + randA.toString(16).padStart(3, '0');

        // バリアント (2ビット: 10) + rand_b の最初の6ビット = 1バイト
        // + rand_b の次の8ビット = 1バイト
        const variantByte = (randomBytes[2] & 0x3F) | 0x80; // 10xxxxxx
        const variantPart = variantByte.toString(16).padStart(2, '0') + hex(randomBytes.slice(3, 4));

        // rand_b の残り (48ビット = 6バイト)
        const randomPart = hex(randomBytes.slice(4, 10));

        return `${timePart1}-${timePart2}-${versionPart}-${variantPart}-${randomPart}`;
    }

    /**
     * UUID v7かどうかを検証
     * @param {string} uuid
     * @returns {boolean}
     */
    static validate(uuid) {
        const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        return pattern.test(uuid);
    }

    /**
     * UUID v7からタイムスタンプを抽出
     * @param {string} uuid
     * @returns {number} ミリ秒タイムスタンプ
     */
    static extractTimestamp(uuid) {
        if (!this.validate(uuid)) {
            throw new Error('Invalid UUID v7');
        }

        // ハイフンを削除して最初の12文字(48ビット)を取得
        const hex = uuid.replace(/-/g, '').slice(0, 12);
        return parseInt(hex, 16);
    }
}

// グローバル関数・クラスとして公開
if (typeof window !== 'undefined') {
    window.generateUUIDv7 = () => UuidV7Generator.generate();
    window.UuidV7Generator = UuidV7Generator;
}

// グローバルスコープにも設定（ES6モジュールからアクセス可能に）
if (typeof globalThis !== 'undefined') {
    globalThis.generateUUIDv7 = () => UuidV7Generator.generate();
    globalThis.UuidV7Generator = UuidV7Generator;
}
