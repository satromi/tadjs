/**
 * TADjs Desktop グローバル設定
 * アプリケーション全体の共通設定を管理
 */

// グローバル設定オブジェクト
window.TADjsConfig = {
    /**
     * デバッグモード（レガシー、log.levelを使用推奨）
     * true: デバッグログを出力（開発時）
     * false: デバッグログを出力しない（本番時）
     */
    debug: false,

    /**
     * ログ設定
     */
    log: {
        /**
         * グローバルログレベル
         * 'NONE'  - ログ出力なし
         * 'ERROR' - エラーのみ
         * 'WARN'  - 警告以上
         * 'INFO'  - 情報以上（デフォルト）
         * 'DEBUG' - デバッグ以上
         * 'TRACE' - すべて（詳細トレース含む）
         */
        level: 'INFO',

        /**
         * モジュール別ログレベル上書き
         * 例: { 'RealObjectSystem': 'DEBUG', 'TADParser': 'WARN' }
         */
        modules: {}
    },

    /**
     * バージョン情報
     */
    version: '1.0.0',

    /**
     * パフォーマンス設定
     */
    performance: {
        // スクロールのスロットル間隔（ミリ秒）
        scrollThrottle: 16,
        // リサイズのデバウンス間隔（ミリ秒）
        resizeDebounce: 100
    },

    /**
     * UI設定
     */
    ui: {
        // デフォルトのフォントサイズ（ポイント）
        defaultFontSize: 14,
        // デフォルトの線幅（ピクセル）
        defaultLineWidth: 1
    }
};

console.log('[Config] TADjs Desktop設定読み込み完了 (debug:', window.TADjsConfig.debug, ')');

// ES6モジュールとしてエクスポート（Electron環境でのimport用）
export const CONFIG = {
    // システム設定実身のID
    SYSTEM_CONFIG_REAL_ID: '019ab620-1e6a-7d17-9598-bccfe61293e0',

    // デフォルトデータフォルダ名（相対パス）
    DEFAULT_DATA_FOLDER_NAME: 'xtaddata'
};
