import {
    DIALOG_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS,
    ERROR_CHECK_TIMEOUT_MS,
    DEFAULT_INPUT_WIDTH
} from './util.js';

/**
 * プラグイン共通基底クラス
 * 複数のプラグインで共通の機能を提供します
 *
 * 使用方法:
 * class MyPlugin extends PluginBase {
 *     constructor() {
 *         super('MyPlugin');
 *         // プラグイン固有の初期化
 *     }
 * }
 */
export class PluginBase {
    /**
     * @param {string} pluginName - プラグイン名（ログ出力用）
     */
    constructor(pluginName) {
        this.pluginName = pluginName;
        this.messageBus = null;
        this.windowId = null;
        this.realId = null;
    }

    // ========================================
    // 🟢 高優先度: 完全に同一のメソッド
    // ========================================

    /**
     * 実身のappListデータを取得
     * @param {string} realId - 実身ID
     * @returns {Promise<Object>} appListデータ
     */
    async getAppListData(realId) {
        return await window.RealObjectSystem.getAppListData(this, realId);
    }

    /**
     * 実身データを読み込む
     * @param {string} realId - 実身ID
     * @returns {Promise<Object>} 実身データ
     */
    async loadRealObjectData(realId) {
        const messageId = `load-real-${Date.now()}-${Math.random()}`;

        // 親ウィンドウに実身データ読み込みを要求
        this.messageBus.send('load-real-object', {
            realId: realId,
            messageId: messageId
        });

        try {
            // レスポンスを待つ
            const result = await this.messageBus.waitFor('real-object-loaded', DEFAULT_TIMEOUT_MS, (data) => {
                return data.messageId === messageId;
            });
            return result.realObject;
        } catch (error) {
            // エラーレスポンスの可能性もチェック
            try {
                const errorResult = await this.messageBus.waitFor('real-object-error', ERROR_CHECK_TIMEOUT_MS, (data) => {
                    return data.messageId === messageId;
                });
                throw new Error(errorResult.error);
            } catch {
                throw new Error('実身データ読み込みタイムアウト');
            }
        }
    }

    // ========================================
    // 🟡 中優先度: ダイアログメソッド（統一版）
    // ========================================

    /**
     * 保存確認ダイアログを表示
     * @returns {Promise<string>} 'yes', 'no', 'cancel'
     */
    async showSaveConfirmDialog() {
        return new Promise((resolve, reject) => {
            this.messageBus.sendWithCallback('show-save-confirm-dialog', {
                message: '保存してから閉じますか？',
                buttons: [
                    { label: '取消', value: 'cancel' },
                    { label: '保存しない', value: 'no' },
                    { label: '保存', value: 'yes' }
                ]
            }, (response) => {
                console.log(`[${this.pluginName}] 保存確認ダイアログコールバック実行:`, response);

                // Dialog result is wrapped in response.result
                const dialogResult = response.result || response;

                if (dialogResult.error) {
                    console.warn(`[${this.pluginName}] Save confirm dialog error:`, dialogResult.error);
                    resolve('cancel');
                    return;
                }

                // dialogResult は 'yes', 'no', 'cancel' の文字列
                console.log(`[${this.pluginName}] ボタンが押されました, value:`, dialogResult);
                resolve(dialogResult);
            }, DIALOG_TIMEOUT_MS);
        });
    }

    /**
     * 入力ダイアログを表示
     * @param {string} message - メッセージ
     * @param {string} defaultValue - デフォルト値
     * @param {number} inputWidth - 入力欄の幅（文字数）
     * @returns {Promise<string|null>} 入力値（キャンセル時はnull）
     */
    async showInputDialog(message, defaultValue = '', inputWidth = DEFAULT_INPUT_WIDTH) {
        return new Promise((resolve, reject) => {
            this.messageBus.sendWithCallback('show-input-dialog', {
                message: message,
                defaultValue: defaultValue,
                inputWidth: inputWidth,
                buttons: [
                    { label: '取り消し', value: 'cancel' },
                    { label: '設　定', value: 'ok' }
                ],
                defaultButton: 1
            }, (result) => {
                console.log(`[${this.pluginName}] 入力ダイアログコールバック実行:`, result);

                // Dialog result is wrapped in result.result
                const dialogResult = result.result || result;

                if (dialogResult.error) {
                    console.warn(`[${this.pluginName}] Input dialog error:`, dialogResult.error);
                    resolve(null);
                    return;
                }

                // 「取り消し」ボタンの場合はnullを返す
                if (dialogResult.button === 'cancel') {
                    console.log(`[${this.pluginName}] キャンセルされました`);
                    resolve(null);
                } else {
                    console.log(`[${this.pluginName}] 設定ボタンが押されました, value:`, dialogResult.value);
                    resolve(dialogResult.value);
                }
            }, DIALOG_TIMEOUT_MS);
        });
    }

    /**
     * メッセージダイアログを表示
     * @param {string} message - メッセージ
     * @param {Array} buttons - ボタン定義配列 [{ label, value }, ...]
     * @param {number} defaultButton - デフォルトボタンのインデックス
     * @returns {Promise<string>} 選択されたボタンのvalue
     */
    async showMessageDialog(message, buttons, defaultButton = 0) {
        return new Promise((resolve, reject) => {
            this.messageBus.sendWithCallback('show-message-dialog', {
                message: message,
                buttons: buttons,
                defaultButton: defaultButton
            }, (result) => {
                console.log(`[${this.pluginName}] メッセージダイアログコールバック実行:`, result);

                // Dialog result is wrapped in result.result
                const dialogResult = result.result || result;

                if (dialogResult.error) {
                    console.warn(`[${this.pluginName}] Message dialog error:`, dialogResult.error);
                    resolve(null);
                    return;
                }

                console.log(`[${this.pluginName}] ボタンが押されました:`, dialogResult);
                resolve(dialogResult);
            }, DIALOG_TIMEOUT_MS);
        });
    }

    // ========================================
    // 🟡 中優先度: RealObjectSystem委譲メソッド
    // ========================================

    /**
     * 選択中の仮身が指し示す実身を閉じる
     */
    closeRealObject() {
        window.RealObjectSystem.closeRealObject(this);
    }

    /**
     * 選択中の仮身が指し示す実身の名前を変更
     * @returns {Promise<Object>} 結果オブジェクト
     */
    async renameRealObject() {
        return await window.RealObjectSystem.renameRealObject(this);
    }

    /**
     * 選択中の仮身が指し示す実身を複製
     * @returns {Promise<Object>} 複製結果
     */
    async duplicateRealObject() {
        return await window.RealObjectSystem.duplicateRealObject(this);
    }

    /**
     * 仮身の属性を変更
     * @returns {Promise<void>}
     */
    async changeVirtualObjectAttributes() {
        return await window.RealObjectSystem.changeVirtualObjectAttributes(this);
    }

    /**
     * ごみ箱実身を開く
     */
    openTrashRealObjects() {
        window.RealObjectSystem.openTrashRealObjects(this);
    }

    /**
     * linkIdから実身IDを抽出
     * @param {string} linkId - リンクID
     * @returns {string} 実身ID
     */
    extractRealId(linkId) {
        return window.RealObjectSystem.extractRealId(linkId);
    }

    // ========================================
    // 🟠 低優先度: MessageBus共通操作
    // ========================================

    /**
     * ウィンドウをアクティブにする
     */
    activateWindow() {
        this.messageBus.send('activate-window');
    }

    /**
     * ウィンドウの最大化/復元を切り替え
     */
    toggleMaximize() {
        this.messageBus.send('toggle-maximize');
    }

    /**
     * コンテキストメニューを閉じる
     */
    closeContextMenu() {
        this.messageBus.send('close-context-menu');
    }

    /**
     * ステータスメッセージを送信
     * @param {string} message - ステータスメッセージ
     */
    sendStatusMessage(message) {
        this.messageBus.send('status-message', {
            windowId: this.windowId,
            message: message
        });
    }

    // ========================================
    // 🟠 低優先度: クリップボード操作
    // ========================================

    /**
     * クリップボードからデータを取得
     * @returns {Promise<any>} クリップボードデータ
     */
    async getClipboard() {
        this.messageBus.send('get-clipboard', {
            windowId: this.windowId
        });

        try {
            const result = await this.messageBus.waitFor('clipboard-data', DEFAULT_TIMEOUT_MS, (data) => {
                return data.windowId === this.windowId;
            });
            return result.clipboardData;
        } catch (error) {
            console.error(`[${this.pluginName}] クリップボードデータ取得エラー:`, error);
            return null;
        }
    }

    /**
     * クリップボードにデータを設定
     * @param {any} data - 設定するデータ
     */
    setClipboard(data) {
        this.messageBus.send('set-clipboard', {
            windowId: this.windowId,
            clipboardData: data
        });
    }

    // ========================================
    // 共通ユーティリティメソッド
    // ========================================

    /**
     * ログ出力（プラグイン名付き）
     * @param {...any} args - ログ引数
     */
    log(...args) {
        console.log(`[${this.pluginName}]`, ...args);
    }

    /**
     * 警告ログ出力（プラグイン名付き）
     * @param {...any} args - ログ引数
     */
    warn(...args) {
        console.warn(`[${this.pluginName}]`, ...args);
    }

    /**
     * エラーログ出力（プラグイン名付き）
     * @param {...any} args - ログ引数
     */
    error(...args) {
        console.error(`[${this.pluginName}]`, ...args);
    }
}
