/**
 * TADjs Desktop グローバル設定
 * アプリケーション全体の共通設定を管理
 */

// グローバル設定オブジェクト
window.TADjsConfig = {
    /**
     * デバッグモード
     * true: デバッグログを出力（開発時）
     * false: デバッグログを出力しない（本番時）
     */
    debug: false,

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
