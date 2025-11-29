/**
 * TADjs Desktop 統一ログシステム
 * ES6モジュール版（レンダラープロセス・プラグイン用）
 * @module js/logger
 */

/**
 * ログレベル定義
 */
export const LogLevel = {
    NONE: 0,    // ログ出力なし
    ERROR: 1,   // エラーのみ
    WARN: 2,    // 警告以上
    INFO: 3,    // 情報以上
    DEBUG: 4,   // デバッグ以上
    TRACE: 5    // すべて（詳細トレース含む）
};

/**
 * 文字列からLogLevelへの変換
 * @param {string} levelStr - ログレベル文字列
 * @returns {number} ログレベル値
 */
export function parseLogLevel(levelStr) {
    if (typeof levelStr === 'number') {
        return levelStr;
    }
    const upper = String(levelStr).toUpperCase();
    return LogLevel[upper] ?? LogLevel.INFO;
}

/**
 * 統一ログ出力クラス
 */
export class Logger {
    /**
     * @param {string} moduleName - モジュール名（プレフィックスに使用）
     * @param {Object} options - オプション
     * @param {number} options.level - ログレベル（デフォルト: INFO）
     */
    constructor(moduleName, options = {}) {
        this.moduleName = moduleName;
        this.level = options.level ?? LogLevel.INFO;
    }

    /**
     * ログレベルを設定
     * @param {number} level - ログレベル
     */
    setLevel(level) {
        this.level = level;
    }

    /**
     * エラーログ（LogLevel.ERROR以上で出力）
     * @param {...any} args - ログ引数
     */
    error(...args) {
        if (this.level >= LogLevel.ERROR) {
            console.error(`[${this.moduleName}]`, ...args);
        }
    }

    /**
     * 警告ログ（LogLevel.WARN以上で出力）
     * @param {...any} args - ログ引数
     */
    warn(...args) {
        if (this.level >= LogLevel.WARN) {
            console.warn(`[${this.moduleName}]`, ...args);
        }
    }

    /**
     * 情報ログ（LogLevel.INFO以上で出力）
     * @param {...any} args - ログ引数
     */
    info(...args) {
        if (this.level >= LogLevel.INFO) {
            console.log(`[${this.moduleName}]`, ...args);
        }
    }

    /**
     * デバッグログ（LogLevel.DEBUG以上で出力）
     * @param {...any} args - ログ引数
     */
    debug(...args) {
        if (this.level >= LogLevel.DEBUG) {
            console.debug(`[${this.moduleName}]`, ...args);
        }
    }

    /**
     * トレースログ（LogLevel.TRACE以上で出力）
     * @param {...any} args - ログ引数
     */
    trace(...args) {
        if (this.level >= LogLevel.TRACE) {
            console.debug(`[${this.moduleName}:TRACE]`, ...args);
        }
    }

    // ========================================
    // 操作ベースのログメソッド
    // ========================================

    /**
     * 操作情報ログ（操作名付き）
     * @param {string} operation - 操作名
     * @param {string} message - メッセージ
     * @param {any} data - データ（オプション）
     */
    logOperation(operation, message, data = null) {
        if (this.level >= LogLevel.INFO) {
            if (data !== null) {
                console.log(`[${this.moduleName}] ${operation}: ${message}`, data);
            } else {
                console.log(`[${this.moduleName}] ${operation}: ${message}`);
            }
        }
    }

    /**
     * 操作エラーログ（操作名付き）
     * @param {string} operation - 操作名
     * @param {Error|string} error - エラーオブジェクトまたはメッセージ
     * @param {any} context - コンテキスト（オプション）
     */
    logOperationError(operation, error, context = null) {
        if (this.level >= LogLevel.ERROR) {
            const errorMessage = error.message || error;
            if (context !== null) {
                console.error(`[${this.moduleName}] ${operation}エラー:`, errorMessage, context);
            } else {
                console.error(`[${this.moduleName}] ${operation}エラー:`, errorMessage);
            }
        }
    }

    /**
     * 操作警告ログ（操作名付き）
     * @param {string} operation - 操作名
     * @param {string} message - メッセージ
     * @param {any} data - データ（オプション）
     */
    logOperationWarn(operation, message, data = null) {
        if (this.level >= LogLevel.WARN) {
            if (data !== null) {
                console.warn(`[${this.moduleName}] ${operation}: ${message}`, data);
            } else {
                console.warn(`[${this.moduleName}] ${operation}: ${message}`);
            }
        }
    }
}

/**
 * グローバルログマネージャー
 * 全モジュールのLoggerインスタンスを管理
 */
class LogManager {
    constructor() {
        this.loggers = new Map();
        this.globalLevel = LogLevel.INFO;
        this.moduleOverrides = new Map();
    }

    /**
     * モジュール用Loggerを取得（なければ作成）
     * @param {string} moduleName - モジュール名
     * @returns {Logger} Loggerインスタンス
     */
    getLogger(moduleName) {
        if (!this.loggers.has(moduleName)) {
            const level = this.moduleOverrides.get(moduleName) ?? this.globalLevel;
            this.loggers.set(moduleName, new Logger(moduleName, { level }));
        }
        return this.loggers.get(moduleName);
    }

    /**
     * グローバルログレベルを設定
     * @param {number} level - ログレベル
     */
    setGlobalLevel(level) {
        this.globalLevel = level;
        for (const [name, logger] of this.loggers.entries()) {
            if (!this.moduleOverrides.has(name)) {
                logger.setLevel(level);
            }
        }
    }

    /**
     * 特定モジュールのログレベルを設定
     * @param {string} moduleName - モジュール名
     * @param {number} level - ログレベル
     */
    setModuleLevel(moduleName, level) {
        this.moduleOverrides.set(moduleName, level);
        if (this.loggers.has(moduleName)) {
            this.loggers.get(moduleName).setLevel(level);
        }
    }

    /**
     * 設定オブジェクトからログレベルを初期化
     * @param {Object} config - 設定オブジェクト
     * @param {string} config.level - グローバルログレベル
     * @param {Object} config.modules - モジュール別ログレベル
     */
    configure(config) {
        if (!config) return;

        if (config.level) {
            this.setGlobalLevel(parseLogLevel(config.level));
        }

        if (config.modules) {
            for (const [moduleName, level] of Object.entries(config.modules)) {
                this.setModuleLevel(moduleName, parseLogLevel(level));
            }
        }
    }
}

// シングルトンインスタンス
export const logManager = new LogManager();

/**
 * モジュール用Loggerを取得する便利関数
 * @param {string} moduleName - モジュール名
 * @returns {Logger} Loggerインスタンス
 */
export function getLogger(moduleName) {
    return logManager.getLogger(moduleName);
}

// グローバル設定が存在する場合は適用
if (typeof window !== 'undefined' && window.TADjsConfig?.log) {
    logManager.configure(window.TADjsConfig.log);
}
