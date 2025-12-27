import {
    DIALOG_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS,
    ERROR_CHECK_TIMEOUT_MS,
    DEFAULT_INPUT_WIDTH,
    escapeXml as escapeXmlUtil,
    unescapeXml as unescapeXmlUtil
} from './util.js';
import { getLogger } from './logger.js';
import { throttle } from './performance-utils.js';

const logger = getLogger('PluginBase');

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

        // 共通プロパティ
        this.virtualObjectRenderer = null;
        this.openedRealObjects = new Map();
        this.iconManager = null;
        this.iconData = {};  // アイコンデータキャッシュ { realId: base64Data }
        this.bgColor = '#ffffff';  // 背景色（デフォルト白）
        this.debug = window.TADjsConfig?.debug || false;

        // ダブルクリック+ドラッグの共通状態管理
        this.dblClickDragState = {
            lastClickTime: 0,
            isDblClickDragCandidate: false,
            isDblClickDrag: false,
            dblClickedElement: null,
            startX: 0,
            startY: 0
        };

        // 仮身ドラッグ共通状態管理
        this.virtualObjectDragState = {
            isRightButtonPressed: false,   // 右ボタン押下フラグ
            dragMode: 'move',              // 'move' | 'copy'
            hasMoved: false,               // ドラッグ移動検出フラグ
            isDragging: false,             // ドラッグ中フラグ
            startX: 0,                     // ドラッグ開始X座標
            startY: 0,                     // ドラッグ開始Y座標
            dragThreshold: 5               // ドラッグ判定しきい値(px)
        };

        // 親ウィンドウのダイアログ表示状態
        this.dialogVisible = false;

        // ウィンドウのアクティブ状態
        this.isWindowActive = false;

        // 編集状態フラグ（エディタ系プラグイン用）
        // コンテンツ変更時にtrueに設定、保存後にfalseにリセット
        // handleCloseRequest()で保存確認ダイアログ表示の判断に使用
        this.isModified = false;

        // 全画面表示状態フラグ
        // window-maximize-toggledで同期される
        this.isFullscreen = false;

        // ファイルデータ（initハンドラで設定）
        this.fileData = null;

        // 選択範囲の保存用（ウィンドウ非アクティブ時に保存）
        this.savedSelection = null;

        // スクロール通知機能（MessageBus経由で親ウィンドウにスクロール状態を通知）
        this.scrollContainerSelector = '.plugin-content';  // スクロールコンテナのCSSセレクタ
        this._scrollNotificationEnabled = false;           // スクロール通知が有効かどうか
        this._lastScrollState = null;                      // 最後に送信したスクロール状態

        // 子パネルウィンドウ管理（panelType => windowId）
        this.childPanelWindows = new Map();

        // プラグインID（URLから自動取得）
        this.pluginId = this._extractPluginIdFromUrl();

        // MessageBusの初期化（即座に開始）
        // サブクラスで独自のMessageBus初期化が必要な場合は、
        // super()呼び出し後にthis.messageBusを上書き可能
        if (window.MessageBus) {
            this.messageBus = new window.MessageBus({
                debug: this.debug,
                pluginName: pluginName
            });
            this.messageBus.start();
            logger.debug(`[${pluginName}] MessageBus initialized by PluginBase`);
        }
    }

    /**
     * 共通コンポーネントを初期化
     * 各プラグインのinit()から呼び出すこと
     * @param {string} logPrefix - IconCacheManagerのログプレフィックス（例: '[EDITOR]'）
     */
    initializeCommonComponents(logPrefix = '') {
        // VirtualObjectRendererの初期化
        if (window.VirtualObjectRenderer && !this.virtualObjectRenderer) {
            this.virtualObjectRenderer = new window.VirtualObjectRenderer();
            logger.debug(`[${this.pluginName}] VirtualObjectRenderer initialized`);
        }

        // IconCacheManagerの初期化
        if (window.IconCacheManager && this.messageBus && !this.iconManager) {
            this.iconManager = new window.IconCacheManager(this.messageBus, logPrefix);
            logger.debug(`[${this.pluginName}] IconCacheManager initialized`);
        }
    }

    // ========================================
    // 実身データアクセス
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
     * 親ウィンドウ経由でデータファイルを読み込む（MessageBus利用）
     * プラグインからJSON/xtadファイル等を読み込む際に使用
     *
     * @param {string} fileName - ファイル名
     * @returns {Promise<Blob>} ファイルデータ（Blobオブジェクト）
     * @throws {Error} ファイル読み込みエラー
     *
     * @example
     * const jsonFile = await this.loadDataFileFromParent('realId.json');
     * const jsonText = await jsonFile.text();
     * const jsonData = JSON.parse(jsonText);
     */
    async loadDataFileFromParent(fileName) {
        const messageId = this.generateMessageId('load');

        if (this.messageBus) {
            this.messageBus.send('load-data-file-request', {
                messageId: messageId,
                fileName: fileName
            });
        } else {
            throw new Error('MessageBusが初期化されていません');
        }

        try {
            const result = await this.messageBus.waitFor('load-data-file-response', DEFAULT_TIMEOUT_MS, (data) => {
                return data.messageId === messageId;
            });
            if (result.success) {
                return result.data;
            } else {
                throw new Error(result.error || 'ファイル読み込み失敗');
            }
        } catch (error) {
            throw new Error('ファイル読み込みエラー: ' + error.message);
        }
    }

    /**
     * 仮身のメタデータ（applist、relationship、updateDate等）をJSONファイルから読み込む
     * ドキュメント読み込み時や仮身表示時に使用
     *
     * @param {Object} virtualObj - 仮身オブジェクト（link_idを持つ）
     * @returns {Promise<void>}
     *
     * 読み込み後、virtualObjに以下のプロパティが設定される:
     * - applist: アプリケーションリスト
     * - metadata: JSONファイルの全データ
     * - updateDate: 更新日時
     *
     * @example
     * const virtualObject = { link_id: 'realId_0.xtad', ... };
     * await this.loadVirtualObjectMetadata(virtualObject);
     * // virtualObject.metadata.relationship で続柄にアクセス可能
     */
    async loadVirtualObjectMetadata(virtualObj) {
        try {
            // 実身IDを抽出してJSONファイル名を生成（共通メソッドを使用）
            const baseFileId = window.RealObjectSystem.extractRealId(virtualObj.link_id);
            const jsonFileName = window.RealObjectSystem.getRealObjectJsonFileName(baseFileId);

            // 1. 親ウィンドウのfileObjectsから直接取得を試みる
            if (window.parent && window.parent.tadjsDesktop && window.parent.tadjsDesktop.fileObjects) {
                const jsonFile = window.parent.tadjsDesktop.fileObjects[jsonFileName];

                if (jsonFile) {
                    const jsonText = await jsonFile.text();
                    const jsonData = JSON.parse(jsonText);

                    virtualObj.applist = jsonData.applist || {};
                    virtualObj.metadata = jsonData;
                    virtualObj.updateDate = jsonData.updateDate;
                    return;
                }
            }

            // 2. MessageBus経由で親ウィンドウからファイル読み込み
            try {
                const jsonFile = await this.loadDataFileFromParent(jsonFileName);
                const jsonText = await jsonFile.text();
                const jsonData = JSON.parse(jsonText);
                virtualObj.applist = jsonData.applist || {};
                virtualObj.metadata = jsonData;
                virtualObj.updateDate = jsonData.updateDate;
                return;
            } catch (loadError) {
                // MessageBus経由でも失敗した場合はデフォルト値を設定
                logger.debug(`[${this.pluginName}] メタデータ読み込み失敗: ${jsonFileName}`, loadError.message);
            }

            // 読み込み失敗時はデフォルト値を設定
            virtualObj.applist = virtualObj.applist || {};
        } catch (error) {
            logger.debug(`[${this.pluginName}] loadVirtualObjectMetadata エラー:`, error.message);
            virtualObj.applist = virtualObj.applist || {};
        }
    }

    /**
     * 実身データを読み込む
     * @param {string} realId - 実身ID
     * @returns {Promise<Object>} 実身データ
     */
    async loadRealObjectData(realId) {
        const messageId = this.generateMessageId('load-real');

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
    // ダイアログ表示
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
                logger.info(`[${this.pluginName}] 保存確認ダイアログコールバック実行:`, response);

                // null/undefinedチェック（タイムアウト等の異常時対応）
                if (response == null) {
                    logger.warn(`[${this.pluginName}] Save confirm dialog: responseがnull/undefined`);
                    resolve('cancel');
                    return;
                }

                // Dialog result is wrapped in response.result
                const dialogResult = response.result ?? response;

                if (dialogResult == null || dialogResult.error) {
                    logger.warn(`[${this.pluginName}] Save confirm dialog error:`, dialogResult?.error);
                    resolve('cancel');
                    return;
                }

                // dialogResult は 'yes', 'no', 'cancel' の文字列
                logger.info(`[${this.pluginName}] ボタンが押されました, value:`, dialogResult);
                resolve(dialogResult);
            }, DIALOG_TIMEOUT_MS);
        });
    }

    /**
     * 入力ダイアログを表示
     * @param {string} message - メッセージ
     * @param {string} defaultValue - デフォルト値
     * @param {number} inputWidth - 入力欄の幅（文字数）
     * @param {Object} options - オプション
     * @param {boolean} options.colorPicker - カラーピッカーを表示するかどうか
     * @param {Object} options.checkbox - チェックボックス設定 { label: string, checked: boolean }
     * @returns {Promise<string|{value: string, checkbox: boolean}|null>} 入力値（checkboxオプション使用時はオブジェクト、キャンセル時はnull）
     */
    async showInputDialog(message, defaultValue = '', inputWidth = DEFAULT_INPUT_WIDTH, options = {}) {
        // ユーザー入力を待つダイアログなので、タイムアウトを無効化（0に設定）
        // ボタンが押されるまで無期限に待機する
        const INPUT_DIALOG_TIMEOUT_MS = 0;

        return new Promise((resolve, reject) => {
            this.messageBus.sendWithCallback('show-input-dialog', {
                message: message,
                defaultValue: defaultValue,
                inputWidth: inputWidth,
                colorPicker: options.colorPicker || false,
                checkbox: options.checkbox || null,
                buttons: [
                    { label: '取り消し', value: 'cancel' },
                    { label: '設　定', value: 'ok' }
                ],
                defaultButton: 1
            }, (result) => {
                logger.info(`[${this.pluginName}] 入力ダイアログコールバック実行:`, result);

                // null/undefinedチェック（タイムアウト等の異常時対応）
                if (result == null) {
                    logger.warn(`[${this.pluginName}] Input dialog: resultがnull/undefined`);
                    resolve(null);
                    return;
                }

                // Dialog result is wrapped in result.result
                const dialogResult = result.result ?? result;

                if (dialogResult == null || dialogResult.error) {
                    logger.warn(`[${this.pluginName}] Input dialog error:`, dialogResult?.error);
                    resolve(null);
                    return;
                }

                // 「取り消し」ボタンの場合はnullを返す
                if (dialogResult.button === 'cancel') {
                    logger.info(`[${this.pluginName}] キャンセルされました`);
                    resolve(null);
                } else {
                    logger.info(`[${this.pluginName}] 設定ボタンが押されました, value:`, dialogResult.value);
                    // checkboxオプションが指定されている場合はオブジェクトで返す
                    if (options.checkbox) {
                        resolve({
                            value: dialogResult.value,
                            checkbox: dialogResult.checkbox || false
                        });
                    } else {
                        resolve(dialogResult.value);
                    }
                }
            }, INPUT_DIALOG_TIMEOUT_MS);
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
        // ボタン配列の検証
        if (!Array.isArray(buttons) || buttons.length === 0) {
            logger.warn(`[${this.pluginName}] showMessageDialog: 無効なボタン配列、デフォルトを使用`);
            buttons = [{ label: 'OK', value: 'ok' }];
            defaultButton = 0;
        }

        return new Promise((resolve, reject) => {
            this.messageBus.sendWithCallback('show-message-dialog', {
                message: message,
                buttons: buttons,
                defaultButton: defaultButton
            }, (result) => {
                logger.info(`[${this.pluginName}] メッセージダイアログコールバック実行:`, result);

                // null/undefinedチェック（タイムアウト等の異常時対応）
                if (result == null) {
                    logger.warn(`[${this.pluginName}] Message dialog: resultがnull/undefined`);
                    resolve(null);
                    return;
                }

                // Dialog result is wrapped in result.result
                const dialogResult = result.result ?? result;

                if (dialogResult == null || dialogResult.error) {
                    logger.warn(`[${this.pluginName}] Message dialog error:`, dialogResult?.error);
                    resolve(null);
                    return;
                }

                logger.info(`[${this.pluginName}] ボタンが押されました:`, dialogResult);
                resolve(dialogResult);
            }, DIALOG_TIMEOUT_MS);
        });
    }

    // ========================================
    // 実身/仮身操作
    // ========================================

    /**
     * 選択中の仮身が指し示す実身を閉じる
     */
    closeRealObject() {
        window.RealObjectSystem.closeRealObject(this);
    }

    /**
     * 選択中の仮身が指し示す実身の名前を変更
     * @returns {Promise<Object>} 結果オブジェクト { success: boolean, newName?: string, realId?: string }
     */
    async renameRealObject() {
        const result = await window.RealObjectSystem.renameRealObject(this);

        // 成功した場合、メモリ上のlink_nameを更新し、フックを呼び出す
        if (result && result.success && this.contextMenuVirtualObject?.virtualObj) {
            const virtualObj = this.contextMenuVirtualObject.virtualObj;
            virtualObj.link_name = result.newName;

            // プラグイン固有の再描画処理を呼び出す
            await this.onRealObjectRenamed(virtualObj, result);
        }

        return result;
    }

    /**
     * 選択中の仮身が指し示す実身を複製
     * @returns {Promise<Object>} 複製結果
     */
    async duplicateRealObject() {
        return await window.RealObjectSystem.duplicateRealObject(this);
    }

    /**
     * 管理情報ウィンドウを開く
     * contextMenuVirtualObjectが設定されている前提
     */
    openRealObjectConfig() {
        const realId = this.contextMenuVirtualObject?.realId;
        if (!realId) {
            this.setStatus('仮身を選択してください');
            return;
        }
        window.RealObjectSystem.openRealObjectConfig(this, realId);
    }

    /**
     * 仮身の属性を変更
     * @returns {Promise<void>}
     */
    async changeVirtualObjectAttributes() {
        return await window.RealObjectSystem.changeVirtualObjectAttributes(this);
    }

    /**
     * 続柄を設定
     * @returns {Promise<Object>} { success: boolean, relationship?: string[], cancelled?: boolean }
     */
    async setRelationship() {
        const result = await window.RealObjectSystem.setRelationship(this);

        // 成功した場合、メモリ上のmetadata.relationshipを更新し、フックを呼び出す
        if (result && result.success && this.contextMenuVirtualObject?.virtualObj) {
            const virtualObj = this.contextMenuVirtualObject.virtualObj;

            // メタデータがなければ作成
            if (!virtualObj.metadata) {
                virtualObj.metadata = {};
            }
            virtualObj.metadata.relationship = result.relationship || [];

            // プラグイン固有の再描画処理を呼び出す
            this.onRelationshipUpdated(virtualObj, result);
        }

        return result;
    }

    /**
     * 続柄更新後のフック（サブクラスでオーバーライド可能）
     * setRelationship()成功後に呼ばれる。仮身の再描画などに使用
     *
     * @param {Object} virtualObj - 更新された仮身オブジェクト
     * @param {Object} result - setRelationshipの結果 { success: true, relationship: string[] }
     */
    onRelationshipUpdated(virtualObj, result) {
        // デフォルト実装: 何もしない
        // サブクラスで再描画処理をオーバーライド
    }

    /**
     * 実身名変更後のフック（サブクラスでオーバーライド可能）
     * renameRealObject()成功後に呼ばれる。仮身の再描画などに使用
     *
     * @param {Object} virtualObj - 更新された仮身オブジェクト（link_nameは更新済み）
     * @param {Object} result - renameRealObjectの結果 { success: true, newName: string, realId: string }
     */
    async onRealObjectRenamed(virtualObj, result) {
        // デフォルト実装: 何もしない
        // サブクラスで再描画処理をオーバーライド
    }

    /**
     * 仮身オブジェクトから現在の属性値を取得（サブクラスでオーバーライド可能）
     * RealObjectSystem.changeVirtualObjectAttributesから呼ばれる
     *
     * @param {Object} vobj - 仮身オブジェクト
     * @param {HTMLElement|null} element - DOM要素（オプション）
     * @returns {Object} 現在の属性値
     */
    getVirtualObjectCurrentAttrs(vobj, element = null) {
        // デフォルト実装: RealObjectSystemのヘルパーを使用
        return window.RealObjectSystem.buildCurrentAttrsFromVobj(vobj);
    }

    /**
     * 仮身に属性を適用（サブクラスでオーバーライド必須）
     * RealObjectSystem.changeVirtualObjectAttributesから呼ばれる
     *
     * @param {Object} attrs - 適用する属性値
     */
    applyVirtualObjectAttributes(attrs) {
        // デフォルト実装: 何もしない（サブクラスでオーバーライドすること）
        logger.warn(`[${this.pluginName}] applyVirtualObjectAttributesがオーバーライドされていません`);
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
    // ウィンドウ操作・メッセージング
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
        if (this.messageBus) {
            this.messageBus.send('toggle-maximize');
        }
    }

    /**
     * 全画面表示のオン/オフを切り替え
     * toggleMaximize()のエイリアス
     */
    toggleFullscreen() {
        this.toggleMaximize();
    }

    /**
     * コンテキストメニューを閉じる
     */
    closeContextMenu() {
        this.messageBus.send('close-context-menu');
    }

    /**
     * コンテキストメニュー要求を送信
     * @param {number} x - メニュー表示X座標（スクリーン座標）
     * @param {number} y - メニュー表示Y座標（スクリーン座標）
     */
    requestContextMenu(x, y) {
        this.messageBus.send('context-menu-request', { x, y });
    }

    // ========================================
    // イベントハンドラ設定（共通）
    // ========================================

    /**
     * ウィンドウアクティベーションハンドラを設定
     * マウスダウン時にウィンドウをアクティブにする
     *
     * サブクラスのinit()から呼び出すこと
     */
    setupWindowActivation() {
        document.addEventListener('mousedown', () => {
            this.activateWindow();
        });
    }

    // ========================================
    // スクロール通知機能（MessageBus経由）
    // ========================================

    /**
     * スクロール通知機能を初期化
     * スクロールコンテナのscrollイベントを監視し、MessageBus経由で親に通知
     *
     * サブクラスのinit()から呼び出すこと
     * scrollContainerSelectorで対象を指定可能（デフォルト: .plugin-content）
     */
    initScrollNotification() {
        const container = document.querySelector(this.scrollContainerSelector);
        if (!container) {
            logger.warn(`[${this.pluginName}] スクロールコンテナが見つかりません: ${this.scrollContainerSelector}`);
            return;
        }

        if (!this.messageBus) {
            logger.warn(`[${this.pluginName}] MessageBusが未初期化のためスクロール通知をスキップ`);
            return;
        }

        // スクロールコンテナをキャッシュ（notifyScrollChange用）
        this._scrollContainer = container;

        // スクロールイベントをthrottle（16ms ≒ 60fps）
        const throttledHandler = throttle(() => {
            this._sendScrollState(container);
        }, 16);

        container.addEventListener('scroll', throttledHandler);

        // 初期状態を送信（windowIdが設定されるまでリトライ）
        this._scheduleInitialScrollState(container, 0);

        this._scrollNotificationEnabled = true;
        logger.debug(`[${this.pluginName}] スクロール通知初期化完了: ${this.scrollContainerSelector}`);
    }

    /**
     * 初期スクロール状態の送信をスケジュール（windowId設定待ち）
     * @param {HTMLElement} container - スクロールコンテナ
     * @param {number} retryCount - リトライ回数
     * @private
     */
    _scheduleInitialScrollState(container, retryCount) {
        const maxRetries = 20; // 最大20回 × 100ms = 2秒
        const retryInterval = 100;

        if (this.windowId) {
            // windowIdが設定されている場合は即座に送信
            this._sendScrollState(container);
            logger.debug(`[${this.pluginName}] 初期スクロール状態送信完了`);
        } else if (retryCount < maxRetries) {
            // windowIdが未設定の場合はリトライ
            setTimeout(() => {
                this._scheduleInitialScrollState(container, retryCount + 1);
            }, retryInterval);
        } else {
            logger.warn(`[${this.pluginName}] 初期スクロール状態送信タイムアウト（windowId未設定）`);
        }
    }

    /**
     * スクロール状態変更を親ウィンドウに手動通知
     * プログラムによるスクロール（scrollIntoView等）後に呼び出すこと
     *
     * 使用例:
     *   this.scrollCellIntoView(cell);
     *   this.notifyScrollChange();
     */
    notifyScrollChange() {
        if (!this._scrollNotificationEnabled || !this._scrollContainer) {
            return;
        }
        this._sendScrollState(this._scrollContainer);
    }

    /**
     * スクロール状態をMessageBus経由で親に送信
     * @param {HTMLElement} container - スクロールコンテナ
     * @private
     */
    _sendScrollState(container) {
        if (!this.messageBus || !this.windowId) return;

        const state = {
            scrollTop: container.scrollTop,
            scrollLeft: container.scrollLeft,
            scrollHeight: container.scrollHeight,
            scrollWidth: container.scrollWidth,
            clientHeight: container.clientHeight,
            clientWidth: container.clientWidth
        };

        // 前回と同じ状態なら送信しない
        if (this._lastScrollState &&
            this._lastScrollState.scrollTop === state.scrollTop &&
            this._lastScrollState.scrollLeft === state.scrollLeft &&
            this._lastScrollState.scrollHeight === state.scrollHeight &&
            this._lastScrollState.scrollWidth === state.scrollWidth &&
            this._lastScrollState.clientHeight === state.clientHeight &&
            this._lastScrollState.clientWidth === state.clientWidth) {
            return;
        }

        this._lastScrollState = state;

        this.messageBus.send('scroll-state-update', {
            windowId: this.windowId,
            ...state
        });
    }

    /**
     * 親からのスクロール位置設定要求を処理
     * @param {Object} data - { scrollTop?: number, scrollLeft?: number }
     */
    handleSetScrollPosition(data) {
        const container = document.querySelector(this.scrollContainerSelector);
        if (!container) return;

        if (typeof data.scrollTop === 'number') {
            container.scrollTop = data.scrollTop;
        }
        if (typeof data.scrollLeft === 'number') {
            container.scrollLeft = data.scrollLeft;
        }
    }

    // ========================================
    // カスタムスクロールバー機能
    // ========================================

    /**
     * カスタムスクロールバーを初期化
     * btron-desktop.cssのスクロールバースタイルを使用してカスタムスクロールバーを表示
     *
     * @param {string} containerSelector - スクロールコンテナのCSSセレクタ
     * @param {Object} options - オプション
     * @param {boolean} options.vertical - 縦スクロールバーを表示（デフォルト: true）
     * @param {boolean} options.horizontal - 横スクロールバーを表示（デフォルト: false）
     *
     * @example
     * // 縦スクロールバーのみ
     * this.initCustomScrollbar('.tab-content');
     *
     * // 縦横両方
     * this.initCustomScrollbar('.content', { vertical: true, horizontal: true });
     */
    initCustomScrollbar(containerSelector, options = {}) {
        const { vertical = true, horizontal = false } = options;
        const container = document.querySelector(containerSelector);

        if (!container) {
            logger.warn(`[${this.pluginName}] カスタムスクロールバー: コンテナが見つかりません: ${containerSelector}`);
            return;
        }

        // ラッパーを作成してコンテナを囲む
        const wrapper = document.createElement('div');
        wrapper.className = 'plugin-scrollbar-wrapper';

        // コンテナの親に挿入し、コンテナをラッパーに移動
        container.parentNode.insertBefore(wrapper, container);
        wrapper.appendChild(container);

        // コンテナにスクロールコンテンツ用クラス追加
        container.classList.add('plugin-scrollbar-content');

        // カスタムスクロールバー状態を保存
        this._customScrollbars = this._customScrollbars || {};
        this._scrollbarWrapper = wrapper;
        this._scrollContainer = container;

        // 縦スクロールバー（ラッパーに追加）
        if (vertical) {
            this._createCustomScrollbar(wrapper, container, 'vertical');
        }

        // 横スクロールバー（ラッパーに追加）
        if (horizontal) {
            this._createCustomScrollbar(wrapper, container, 'horizontal');
        }

        // スクロールコーナー（縦横両方の場合）
        if (vertical && horizontal) {
            this._createScrollCorner(wrapper);
        }

        // スクロールイベントでツマミ位置を同期
        container.addEventListener('scroll', throttle(() => {
            this._updateScrollbarThumbPosition(container, 'vertical');
            this._updateScrollbarThumbPosition(container, 'horizontal');
        }, 16));

        // ResizeObserverでコンテナサイズ変更を監視
        const resizeObserver = new ResizeObserver(() => {
            this._updateScrollbarVisibility(container, 'vertical');
            this._updateScrollbarVisibility(container, 'horizontal');
            this._updateScrollbarThumbPosition(container, 'vertical');
            this._updateScrollbarThumbPosition(container, 'horizontal');
        });
        resizeObserver.observe(container);

        // MutationObserverでコンテンツ変更・属性変更を監視
        const mutationObserver = new MutationObserver(() => {
            // レイアウト再計算を待ってから更新
            requestAnimationFrame(() => {
                this._updateScrollbarVisibility(container, 'vertical');
                this._updateScrollbarVisibility(container, 'horizontal');
                this._updateScrollbarThumbPosition(container, 'vertical');
                this._updateScrollbarThumbPosition(container, 'horizontal');
            });
        });
        // childList: コンテンツ追加/削除, attributes: class変更（タブ切替）, subtree: 子孫要素も監視
        mutationObserver.observe(container, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'style']
        });

        // 初期状態を設定（即座に実行してチラつきを防ぐ）
        this._updateScrollbarVisibility(container, 'vertical');
        this._updateScrollbarVisibility(container, 'horizontal');
        this._updateScrollbarThumbPosition(container, 'vertical');
        this._updateScrollbarThumbPosition(container, 'horizontal');

        logger.debug(`[${this.pluginName}] カスタムスクロールバー初期化完了: ${containerSelector}`);
    }

    /**
     * カスタムスクロールバーDOM要素を作成
     * @param {HTMLElement} wrapper - スクロールバーを配置するラッパー要素
     * @param {HTMLElement} scrollContainer - スクロールコンテナ
     * @param {string} direction - 'vertical' | 'horizontal'
     * @private
     */
    _createCustomScrollbar(wrapper, scrollContainer, direction) {
        const scrollbar = document.createElement('div');
        scrollbar.className = `custom-scrollbar ${direction}`;

        const track = document.createElement('div');
        track.className = 'scroll-track';

        const thumb = document.createElement('div');
        thumb.className = 'scroll-thumb';

        const indicator = document.createElement('div');
        indicator.className = 'scroll-thumb-indicator';

        thumb.appendChild(indicator);
        track.appendChild(thumb);
        scrollbar.appendChild(track);
        wrapper.appendChild(scrollbar);  // ラッパーに追加（スクロール領域の外）

        // ツマミドラッグイベントを設定
        this._setupThumbDrag(scrollContainer, thumb, direction);

        // トラッククリックでスクロール
        track.addEventListener('click', (e) => {
            if (e.target === thumb || thumb.contains(e.target)) return;
            this._handleTrackClick(scrollContainer, track, e, direction);
        });

        // 状態を保存
        this._customScrollbars[direction] = { scrollbar, track, thumb };
    }

    /**
     * スクロールコーナーを作成
     * @param {HTMLElement} container - スクロールコンテナ
     * @private
     */
    _createScrollCorner(container) {
        const corner = document.createElement('div');
        corner.className = 'scroll-corner';
        container.appendChild(corner);
        this._customScrollbars.corner = corner;
    }

    /**
     * ツマミのドラッグイベントを設定
     * @param {HTMLElement} container - スクロールコンテナ
     * @param {HTMLElement} thumb - ツマミ要素
     * @param {string} direction - 'vertical' | 'horizontal'
     * @private
     */
    _setupThumbDrag(container, thumb, direction) {
        let isDragging = false;
        let startPos = 0;
        let startScroll = 0;

        const onMouseDown = (e) => {
            e.preventDefault();
            isDragging = true;
            thumb.classList.add('dragging');
            startPos = direction === 'vertical' ? e.clientY : e.clientX;
            startScroll = direction === 'vertical' ? container.scrollTop : container.scrollLeft;
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        };

        const onMouseMove = (e) => {
            if (!isDragging) return;

            const scrollbarData = this._customScrollbars[direction];
            if (!scrollbarData) return;

            const track = scrollbarData.track;
            const trackRect = track.getBoundingClientRect();
            const currentPos = direction === 'vertical' ? e.clientY : e.clientX;
            const delta = currentPos - startPos;

            // トラックサイズに対するスクロール量を計算
            const trackSize = direction === 'vertical' ? trackRect.height : trackRect.width;
            const contentSize = direction === 'vertical' ? container.scrollHeight : container.scrollWidth;
            const viewportSize = direction === 'vertical' ? container.clientHeight : container.clientWidth;

            const scrollRatio = contentSize / trackSize;
            const newScroll = startScroll + (delta * scrollRatio);

            if (direction === 'vertical') {
                container.scrollTop = Math.max(0, Math.min(newScroll, contentSize - viewportSize));
            } else {
                container.scrollLeft = Math.max(0, Math.min(newScroll, contentSize - viewportSize));
            }
        };

        const onMouseUp = () => {
            isDragging = false;
            thumb.classList.remove('dragging');
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        thumb.addEventListener('mousedown', onMouseDown);
    }

    /**
     * トラッククリック時のスクロール処理
     * @param {HTMLElement} container - スクロールコンテナ
     * @param {HTMLElement} track - トラック要素
     * @param {MouseEvent} e - クリックイベント
     * @param {string} direction - 'vertical' | 'horizontal'
     * @private
     */
    _handleTrackClick(container, track, e, direction) {
        const trackRect = track.getBoundingClientRect();
        const clickPos = direction === 'vertical'
            ? e.clientY - trackRect.top
            : e.clientX - trackRect.left;
        const trackSize = direction === 'vertical' ? trackRect.height : trackRect.width;

        const contentSize = direction === 'vertical' ? container.scrollHeight : container.scrollWidth;
        const viewportSize = direction === 'vertical' ? container.clientHeight : container.clientWidth;

        const scrollRatio = clickPos / trackSize;
        const targetScroll = (contentSize - viewportSize) * scrollRatio;

        if (direction === 'vertical') {
            container.scrollTop = targetScroll;
        } else {
            container.scrollLeft = targetScroll;
        }
    }

    /**
     * スクロールバーのツマミ位置を更新
     * @param {HTMLElement} container - スクロールコンテナ
     * @param {string} direction - 'vertical' | 'horizontal'
     * @private
     */
    _updateScrollbarThumbPosition(container, direction) {
        const scrollbarData = this._customScrollbars?.[direction];
        if (!scrollbarData) return;

        const { track, thumb } = scrollbarData;
        const trackRect = track.getBoundingClientRect();
        const trackSize = direction === 'vertical' ? trackRect.height : trackRect.width;

        const contentSize = direction === 'vertical' ? container.scrollHeight : container.scrollWidth;
        const viewportSize = direction === 'vertical' ? container.clientHeight : container.clientWidth;
        const scrollPos = direction === 'vertical' ? container.scrollTop : container.scrollLeft;

        // ツマミサイズ（最小20px）
        const thumbSize = Math.max(20, (viewportSize / contentSize) * trackSize);

        // ツマミ位置
        const maxScroll = contentSize - viewportSize;
        const scrollRatio = maxScroll > 0 ? scrollPos / maxScroll : 0;
        const thumbPos = scrollRatio * (trackSize - thumbSize);

        if (direction === 'vertical') {
            thumb.style.height = `${thumbSize}px`;
            thumb.style.top = `${thumbPos}px`;
        } else {
            thumb.style.width = `${thumbSize}px`;
            thumb.style.left = `${thumbPos}px`;
        }
    }

    /**
     * スクロールバーの表示/非表示を更新
     * @param {HTMLElement} container - スクロールコンテナ
     * @param {string} direction - 'vertical' | 'horizontal'
     * @private
     */
    _updateScrollbarVisibility(container, direction) {
        const scrollbarData = this._customScrollbars?.[direction];
        if (!scrollbarData) return;

        const { scrollbar } = scrollbarData;
        const contentSize = direction === 'vertical' ? container.scrollHeight : container.scrollWidth;
        const viewportSize = direction === 'vertical' ? container.clientHeight : container.clientWidth;

        // スクロール可能な場合のみ表示（常に表示する場合はコメントアウト）
        const needsScrollbar = contentSize > viewportSize;
        scrollbar.style.display = needsScrollbar ? 'block' : 'none';

        // ツマミも表示/非表示を切り替え
        const thumb = scrollbarData.thumb;
        if (thumb) {
            thumb.style.display = needsScrollbar ? 'flex' : 'none';
        }
    }

    /**
     * コンテキストメニューハンドラを設定
     * 右クリック時にコンテキストメニューを表示、クリック時に閉じる
     *
     * サブクラスのinit()から呼び出すこと
     * カスタム処理が必要な場合は onContextMenu(e) をオーバーライド
     */
    setupContextMenu() {
        document.addEventListener('contextmenu', (e) => {
            e.preventDefault();

            // サブクラスでカスタム処理を行うフック
            this.onContextMenu?.(e);

            // コンテキストメニュー要求を送信
            const rect = window.frameElement?.getBoundingClientRect() || { left: 0, top: 0 };
            this.requestContextMenu(rect.left + e.clientX, rect.top + e.clientY);
        });

        document.addEventListener('click', () => {
            this.closeContextMenu();
        });
    }

    /**
     * コンテキストメニュー表示前のフック（サブクラスでオーバーライド）
     * 右クリック時の追加処理（選択状態の更新など）を行う
     *
     * @param {MouseEvent} e - contextmenuイベント
     */
    onContextMenu(e) {
        // デフォルト実装は空（サブクラスで必要に応じてオーバーライド）
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

    /**
     * クロスウィンドウドロップ成功を通知
     * 仮身ドロップ完了時に、ドラッグ元に成功を通知する
     *
     * @param {Object} dragData - ドラッグデータ
     * @param {Array} virtualObjects - 仮身オブジェクト配列
     */
    notifyCrossWindowDropSuccess(dragData, virtualObjects) {
        const message = {
            mode: dragData.mode || this.virtualObjectDragState.dragMode,
            source: dragData.source,
            sourceWindowId: dragData.sourceWindowId,
            virtualObjects: virtualObjects,
            virtualObjectId: virtualObjects?.[0]?.link_id
        };

        // dragDataにtargetWindowIdがある場合は含める
        if (dragData.targetWindowId) {
            message.targetWindowId = dragData.targetWindowId;
        }

        this.messageBus.send('cross-window-drop-success', message);
    }

    /**
     * ウィンドウ設定（位置・サイズ・最大化状態）を更新
     * @param {Object} windowConfig - { pos: {x, y}, width, height, maximize }
     */
    updateWindowConfig(windowConfig) {
        if (this.messageBus && this.realId) {
            this.messageBus.send('update-window-config', {
                fileId: this.realId,
                windowConfig: windowConfig
            });
        }
    }

    // ========================================
    // クリップボード操作
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
            logger.error(`[${this.pluginName}] クリップボードデータ取得エラー:`, error);
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

    /**
     * HTMLImageElementからDataURLを生成
     * @param {HTMLImageElement} imageElement - 画像要素
     * @param {string} [mimeType='image/png'] - MIMEタイプ
     * @returns {string|null} DataURL、失敗時はnull
     */
    imageElementToDataUrl(imageElement, mimeType = 'image/png') {
        if (!imageElement) return null;
        try {
            const canvas = document.createElement('canvas');
            canvas.width = imageElement.naturalWidth || imageElement.width;
            canvas.height = imageElement.naturalHeight || imageElement.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(imageElement, 0, 0);
            return canvas.toDataURL(mimeType);
        } catch (error) {
            logger.error(`[${this.pluginName}] DataURL変換エラー:`, error);
            return null;
        }
    }

    /**
     * 画像をグローバルクリップボードに設定
     * @param {HTMLImageElement|string} source - 画像要素またはDataURL
     * @param {Object} [options={}] - オプション
     * @param {number} [options.width] - 幅（省略時はsourceから取得）
     * @param {number} [options.height] - 高さ（省略時はsourceから取得）
     * @param {string} [options.name='image.png'] - ファイル名
     */
    setImageClipboard(source, options = {}) {
        let dataUrl;
        let width = options.width;
        let height = options.height;

        if (source instanceof HTMLImageElement) {
            dataUrl = this.imageElementToDataUrl(source);
            if (!width) width = source.naturalWidth || source.width;
            if (!height) height = source.naturalHeight || source.height;
        } else if (typeof source === 'string' && source.startsWith('data:')) {
            dataUrl = source;
        } else {
            logger.error(`[${this.pluginName}] setImageClipboard: 無効なソース`);
            return;
        }

        if (!dataUrl) return;

        this.setClipboard({
            type: 'image',
            dataUrl: dataUrl,
            width: width,
            height: height,
            name: options.name || 'image.png'
        });
    }

    /**
     * テキストをグローバルクリップボードに設定
     * @param {string} text - テキスト
     */
    setTextClipboard(text) {
        if (!text) return;
        this.setClipboard({
            type: 'text',
            text: text
        });
    }

    /**
     * HTMLImageElementからDataURLを非同期で生成（未読み込み対応）
     * @param {HTMLImageElement} imageElement - 画像要素
     * @param {string} [mimeType='image/png'] - MIMEタイプ
     * @returns {Promise<string|null>} DataURL
     */
    async imageElementToDataUrlAsync(imageElement, mimeType = 'image/png') {
        if (!imageElement) return null;

        // 既にdata: URLならそのまま返す
        if (imageElement.src && imageElement.src.startsWith('data:')) {
            return imageElement.src;
        }

        // 画像が読み込まれているか確認
        if (imageElement.complete && imageElement.naturalWidth > 0) {
            return this.imageElementToDataUrl(imageElement, mimeType);
        }

        // 画像を再読み込み
        return new Promise((resolve) => {
            const tempImg = new Image();
            tempImg.crossOrigin = 'anonymous';
            tempImg.onload = () => {
                resolve(this.imageElementToDataUrl(tempImg, mimeType));
            };
            tempImg.onerror = () => {
                logger.error(`[${this.pluginName}] 画像読み込みエラー:`, imageElement.src);
                resolve(null);
            };
            tempImg.src = imageElement.src;
        });
    }

    /**
     * URLから画像を読み込んでDataURLを生成
     * @param {string} imageUrl - 画像URL
     * @param {Object} [options={}] - オプション
     * @param {number} [options.timeout=5000] - タイムアウト(ms)
     * @param {string} [options.mimeType='image/png'] - MIMEタイプ
     * @returns {Promise<string|null>} DataURL
     */
    async loadImageFromUrl(imageUrl, options = {}) {
        const timeout = options.timeout || 5000;
        const mimeType = options.mimeType || 'image/png';

        return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';

            const timeoutId = setTimeout(() => {
                if (!img.complete) {
                    logger.warn(`[${this.pluginName}] 画像読み込みタイムアウト:`, imageUrl);
                    resolve(null);
                }
            }, timeout);

            img.onload = () => {
                clearTimeout(timeoutId);
                resolve(this.imageElementToDataUrl(img, mimeType));
            };
            img.onerror = () => {
                clearTimeout(timeoutId);
                logger.error(`[${this.pluginName}] 画像読み込みエラー:`, imageUrl);
                resolve(null);
            };
            img.src = imageUrl;
        });
    }

    // ========================================
    // ドラッグ関連の共通メソッド
    // ========================================

    /**
     * ダブルクリック+ドラッグ候補を設定
     * @param {HTMLElement} element - ダブルクリックされた要素
     * @param {MouseEvent} event - マウスイベント
     */
    setDoubleClickDragCandidate(element, event) {
        this.dblClickDragState.isDblClickDragCandidate = true;
        this.dblClickDragState.dblClickedElement = element;
        this.dblClickDragState.startX = event.clientX;
        this.dblClickDragState.startY = event.clientY;
    }

    /**
     * ダブルクリックタイマーをリセット（通常のクリック時）
     */
    resetDoubleClickTimer() {
        this.dblClickDragState.lastClickTime = Date.now();
        this.dblClickDragState.isDblClickDragCandidate = false;
    }

    /**
     * ダブルクリック+ドラッグを開始すべきか判定
     * @param {MouseEvent} event - マウスイベント
     * @param {number} threshold - ドラッグ開始のしきい値（px）
     * @returns {boolean} ドラッグを開始すべきならtrue
     */
    shouldStartDblClickDrag(event, threshold = 5) {
        // ダブルクリック候補でない、または既にドラッグ中の場合はfalse
        if (!this.dblClickDragState.isDblClickDragCandidate || this.dblClickDragState.isDblClickDrag) {
            return false;
        }

        const deltaX = event.clientX - this.dblClickDragState.startX;
        const deltaY = event.clientY - this.dblClickDragState.startY;

        // しきい値以上移動した場合、ドラッグ開始
        if (Math.abs(deltaX) > threshold || Math.abs(deltaY) > threshold) {
            this.dblClickDragState.isDblClickDrag = true;
            this.dblClickDragState.isDblClickDragCandidate = false;
            return true;
        }

        return false;
    }

    /**
     * ダブルクリック+ドラッグ状態をクリーンアップ
     * 各プラグインは、このメソッドを呼び出した後、固有のプロパティをクリーンアップすること
     * （例: dragPreview, dblClickedShape, dblClickedObject など）
     */
    cleanupDblClickDragState() {
        this.dblClickDragState.isDblClickDrag = false;
        this.dblClickDragState.isDblClickDragCandidate = false;
        this.dblClickDragState.dblClickedElement = null;
    }

    // ========================================
    // 仮身ドラッグ関連の共通メソッド
    // ========================================

    /**
     * 仮身ドラッグ用の右ボタンイベントハンドラーを設定
     * documentレベルでmousedown/mouseupを監視し、コピーモードを制御
     *
     * サブクラスは init() で this.setupVirtualObjectRightButtonHandlers() を呼び出すこと
     *
     * 動作:
     * - 右ボタン押下時: isRightButtonPressedフラグをtrue、ドラッグ中ならコピーモードに切り替え
     * - 右ボタン解放時: isRightButtonPressedフラグをfalse
     * - 左ボタン解放時: 右ボタンが押されたままならコピーモードに切り替え
     */
    setupVirtualObjectRightButtonHandlers() {
        // mousedown: 右ボタン押下検出
        document.addEventListener('mousedown', (e) => {
            if (e.button === 2) {
                this.virtualObjectDragState.isRightButtonPressed = true;

                // ドラッグ中かつ移動済みならコピーモードに即座に切り替え
                if (this.virtualObjectDragState.isDragging &&
                    this.virtualObjectDragState.hasMoved) {
                    this.virtualObjectDragState.dragMode = 'copy';
                    this.onDragModeChanged?.('copy'); // サブクラスフック
                }
            }
        });

        // mouseup: 右ボタン解放検出
        document.addEventListener('mouseup', (e) => {
            if (e.button === 2) {
                this.virtualObjectDragState.isRightButtonPressed = false;

                // コピーモードのドラッグ中なら左ボタンmouseupを待つ
                if (this.virtualObjectDragState.isDragging &&
                    this.virtualObjectDragState.dragMode === 'copy') {
                    return;
                }
            }

            // 左ボタンmouseup時の最終判定
            if (e.button === 0 && this.virtualObjectDragState.isDragging) {
                const isRightStillPressed = (e.buttons & 2) !== 0 ||
                                           this.virtualObjectDragState.isRightButtonPressed;

                if (this.virtualObjectDragState.hasMoved && isRightStillPressed) {
                    this.virtualObjectDragState.dragMode = 'copy';
                    this.onDragModeChanged?.('copy'); // サブクラスフック
                    return;
                }
            }
        });
    }

    /**
     * 仮身ドラッグ開始時の共通処理
     * サブクラスのdragstartハンドラーから呼び出す
     *
     * 実行内容:
     * - ドラッグ状態を初期化（dragMode, hasMoved, isDragging, startX/Y）
     * - 右ボタンが既に押されている場合はコピーモードに設定
     * - dataTransfer.effectAllowedを設定
     *
     * @param {DragEvent} e - dragstartイベント
     * @returns {Object} ドラッグデータ { dragMode, hasMoved }
     */
    initializeVirtualObjectDragStart(e) {
        // ドラッグ状態を初期化
        this.virtualObjectDragState.dragMode = 'move'; // デフォルト
        this.virtualObjectDragState.hasMoved = false;
        this.virtualObjectDragState.isDragging = true;
        this.virtualObjectDragState.startX = e.clientX;
        this.virtualObjectDragState.startY = e.clientY;

        // 右ボタンの実際の状態を確認（e.buttonsビットマスク: 2 = 右ボタン）
        // これにより、isRightButtonPressedの状態が古い場合も正しく同期される
        const isRightActuallyPressed = (e.buttons & 2) !== 0;
        this.virtualObjectDragState.isRightButtonPressed = isRightActuallyPressed;

        // 右ボタンが実際に押されている場合はコピーモード
        if (isRightActuallyPressed) {
            this.virtualObjectDragState.dragMode = 'copy';
        }

        // effectAllowedを設定
        e.dataTransfer.effectAllowed =
            this.virtualObjectDragState.dragMode === 'copy' ? 'copy' : 'move';

        return {
            dragMode: this.virtualObjectDragState.dragMode,
            hasMoved: this.virtualObjectDragState.hasMoved
        };
    }

    /**
     * ドラッグ中の移動を検出
     * サブクラスのdragoverハンドラーから呼び出す
     *
     * しきい値（dragThreshold, デフォルト5px）以上移動した場合にtrue
     *
     * @param {DragEvent} e - dragoverイベント
     * @returns {boolean} 移動が検出されたらtrue
     */
    detectVirtualObjectDragMove(e) {
        if (!this.virtualObjectDragState.isDragging) return false;
        if (this.virtualObjectDragState.hasMoved) return true; // 既に検出済み

        const deltaX = e.clientX - this.virtualObjectDragState.startX;
        const deltaY = e.clientY - this.virtualObjectDragState.startY;

        if (Math.abs(deltaX) > this.virtualObjectDragState.dragThreshold ||
            Math.abs(deltaY) > this.virtualObjectDragState.dragThreshold) {
            this.virtualObjectDragState.hasMoved = true;
            return true;
        }

        return false;
    }

    /**
     * 仮身ドラッグ終了時のクリーンアップ
     * サブクラスのdragend/dropハンドラーから呼び出す
     *
     * 注意: isRightButtonPressedはmouseupハンドラおよびinitializeVirtualObjectDragStart()で管理されます
     */
    cleanupVirtualObjectDragState() {
        this.virtualObjectDragState.isDragging = false;
        this.virtualObjectDragState.hasMoved = false;
        this.virtualObjectDragState.dragMode = 'move'; // 次のドラッグのためにデフォルトに戻す
        // isRightButtonPressedはmouseupハンドラおよびinitializeVirtualObjectDragStart()で管理
    }

    /**
     * ダブルクリックドラッグ時の実身複製処理（共通メソッド）
     * サブクラスのdropハンドラーから呼び出す
     *
     * dragData.isDuplicateDragがtrueの場合に実身を複製し、
     * 新しいlink_idとlink_nameを持つ仮身オブジェクトを返す
     *
     * @param {Object} virtualObject - 元の仮身オブジェクト
     * @returns {Promise<Object>} 複製された仮身オブジェクト（link_id, link_nameが更新される）
     * @throws {Error} 実身複製に失敗した場合
     *
     * @example
     * // dropハンドラーでの使用例
     * if (dragData.isDuplicateDrag) {
     *     try {
     *         targetVirtualObject = await this.duplicateRealObjectForDrag(virtualObject);
     *     } catch (error) {
     *         logger.error('実身複製エラー:', error);
     *         continue; // 次の仮身へ
     *     }
     * }
     */
    async duplicateRealObjectForDrag(virtualObject) {
        const sourceRealId = window.RealObjectSystem.extractRealId(virtualObject.link_id);
        const messageId = this.generateMessageId('duplicate');

        this.messageBus.send('duplicate-real-object', {
            realId: sourceRealId,
            messageId: messageId
        });

        const result = await this.messageBus.waitFor('real-object-duplicated',
            DEFAULT_TIMEOUT_MS, (data) => data.messageId === messageId);

        if (!result.success) {
            throw new Error(result.error || '実身複製失敗');
        }

        return {
            ...virtualObject,
            link_id: result.newRealId,
            link_name: result.newName
        };
    }

    /**
     * 原紙箱からのドロップ処理（共通メソッド）
     * サブクラスのdropハンドラーから呼び出す
     *
     * base-file-managerからドロップされたファイルを親ウィンドウに処理を委譲する
     *
     * @param {Object} dragData - ドラッグデータ
     * @param {number} clientX - ドロップ位置のX座標
     * @param {number} clientY - ドロップ位置のY座標
     * @param {Object} [additionalData] - 追加データ（オプション）
     *
     * @example
     * // dropハンドラーでの使用例
     * if (dragData.type === 'base-file-copy' && dragData.source === 'base-file-manager') {
     *     this.handleBaseFileDrop(dragData, e.clientX, e.clientY);
     *     return;
     * }
     */
    handleBaseFileDrop(dragData, clientX, clientY, additionalData = {}) {
        this.messageBus.send('base-file-drop-request', {
            dragData: dragData,
            clientX: clientX,
            clientY: clientY,
            ...additionalData
        });
    }

    /**
     * 開いた仮身のiframe pointer-eventsを無効化
     * ドラッグ中に開いた仮身内へのドロップを防ぐ
     * サブクラスのdragstartハンドラーから呼び出す
     *
     * @example
     * // dragstartハンドラーでの使用例
     * this.disableIframePointerEvents();
     */
    disableIframePointerEvents() {
        const allIframes = document.querySelectorAll('.virtual-object-content');
        allIframes.forEach(iframe => {
            iframe.style.pointerEvents = 'none';
        });
    }

    /**
     * 開いた仮身のiframe pointer-eventsを再有効化
     * ドラッグ終了時に開いた仮身内のインタラクションを復元
     * サブクラスのdragendハンドラーから呼び出す
     *
     * @example
     * // dragendハンドラーでの使用例
     * this.enableIframePointerEvents();
     */
    enableIframePointerEvents() {
        const allIframes = document.querySelectorAll('.virtual-object-content');
        allIframes.forEach(iframe => {
            iframe.style.pointerEvents = 'auto';
        });
    }

    /**
     * ドロップ時のdataTransferからJSONデータをパース
     * サブクラスのdropハンドラーから呼び出す
     *
     * @param {DataTransfer} dataTransfer - e.dataTransfer
     * @returns {Object|null} パースされたJSONオブジェクト、失敗時はnull
     *
     * @example
     * // dropハンドラーでの使用例
     * const dragData = this.parseDragData(e.dataTransfer);
     * if (!dragData) return;
     * if (dragData.type === 'virtual-object-drag') { ... }
     */
    parseDragData(dataTransfer) {
        const data = dataTransfer.getData('text/plain');
        if (!data) return null;

        try {
            return JSON.parse(data);
        } catch (_jsonError) {
            return null;
        }
    }

    /**
     * 仮身ドラッグデータを構築してdataTransferに設定
     * サブクラスのdragstartハンドラーから呼び出す
     *
     * @param {DragEvent} e - dragstartイベント
     * @param {Array<Object>} virtualObjects - 仮身オブジェクト配列
     * @param {string} sourceName - ドラッグ元プラグイン名（例: 'basic-text-editor'）
     * @param {boolean} [isDuplicateDrag=false] - ダブルクリックドラッグ（実身複製）フラグ
     * @returns {Object} 構築されたdragDataオブジェクト
     *
     * @example
     * // dragstartハンドラーでの使用例
     * const virtualObj = this.buildVirtualObjFromDataset(vo.dataset);
     * this.setVirtualObjectDragData(e, [virtualObj], 'basic-text-editor');
     */
    setVirtualObjectDragData(e, virtualObjects, sourceName, isDuplicateDrag = false) {
        const dragData = {
            type: 'virtual-object-drag',
            source: sourceName,
            sourceWindowId: this.windowId,
            mode: this.virtualObjectDragState.dragMode,
            virtualObjects: virtualObjects,
            virtualObject: virtualObjects[0], // 後方互換性のため
            isDuplicateDrag: isDuplicateDrag
        };

        e.dataTransfer.setData('text/plain', JSON.stringify(dragData));
        return dragData;
    }

    /**
     * DOM要素のdatasetから仮身オブジェクトを構築
     * data-link-* 属性を link_* 形式に変換し、短い形式のプロパティも追加
     *
     * @param {DOMStringMap} dataset - DOM要素のdataset（element.dataset）
     * @returns {Object} 仮身オブジェクト（link_id, link_name, tbcol, frcol, chsz等を含む）
     *
     * @example
     * // dragstartハンドラーでの使用例
     * const virtualObj = this.buildVirtualObjFromDataset(vo.dataset);
     * this.setVirtualObjectDragData(e, [virtualObj], 'basic-text-editor');
     *
     * @example
     * // 仮身を開く際の使用例
     * const virtualObj = this.buildVirtualObjFromDataset(vo.dataset);
     * this.openVirtualObjectReal(virtualObj, pluginId);
     */
    buildVirtualObjFromDataset(dataset) {
        const virtualObj = {};

        // data-link-* 形式の属性を抽出（dataset.linkXxx形式）
        for (const key in dataset) {
            if (key.startsWith('link')) {
                const attrName = key.replace(/^link/, '').toLowerCase();
                virtualObj['link_' + attrName] = dataset[key];
            }
        }

        // 仮身属性を短い形式でも追加（仮身一覧プラグインとの互換性のため）
        // 色属性（link_tbcol → tbcol）
        if (virtualObj.link_tbcol) virtualObj.tbcol = virtualObj.link_tbcol;
        if (virtualObj.link_frcol) virtualObj.frcol = virtualObj.link_frcol;
        if (virtualObj.link_chcol) virtualObj.chcol = virtualObj.link_chcol;
        if (virtualObj.link_bgcol) virtualObj.bgcol = virtualObj.link_bgcol;

        // サイズ・レイアウト属性
        if (virtualObj.link_chsz) virtualObj.chsz = parseFloat(virtualObj.link_chsz);
        if (virtualObj.link_width) virtualObj.width = parseInt(virtualObj.link_width);
        if (virtualObj.link_heightpx) virtualObj.heightPx = parseInt(virtualObj.link_heightpx);
        if (virtualObj.link_dlen) virtualObj.dlen = parseInt(virtualObj.link_dlen);

        // 座標属性
        if (virtualObj.link_vobjleft) virtualObj.vobjleft = parseInt(virtualObj.link_vobjleft);
        if (virtualObj.link_vobjtop) virtualObj.vobjtop = parseInt(virtualObj.link_vobjtop);
        if (virtualObj.link_vobjright) virtualObj.vobjright = parseInt(virtualObj.link_vobjright);
        if (virtualObj.link_vobjbottom) virtualObj.vobjbottom = parseInt(virtualObj.link_vobjbottom);

        // 表示属性
        if (virtualObj.link_framedisp) virtualObj.framedisp = virtualObj.link_framedisp;
        if (virtualObj.link_namedisp) virtualObj.namedisp = virtualObj.link_namedisp;
        if (virtualObj.link_pictdisp) virtualObj.pictdisp = virtualObj.link_pictdisp;
        if (virtualObj.link_roledisp) virtualObj.roledisp = virtualObj.link_roledisp;
        if (virtualObj.link_typedisp) virtualObj.typedisp = virtualObj.link_typedisp;
        if (virtualObj.link_updatedisp) virtualObj.updatedisp = virtualObj.link_updatedisp;

        // applist属性（data-applist形式で直接設定されている）
        if (dataset.applist) {
            try {
                virtualObj.applist = JSON.parse(dataset.applist);
            } catch (e) {
                virtualObj.applist = {};
            }
        }

        // autoopen属性
        if (dataset.autoopen) {
            virtualObj.autoopen = dataset.autoopen;
        }

        return virtualObj;
    }

    // ========================================
    // 共通MessageBusハンドラ登録
    // ========================================

    /**
     * 共通のMessageBusハンドラを登録
     * サブクラスのsetupMessageBusHandlers()から呼び出すこと
     *
     * 登録されるハンドラ:
     * - window-moved: ウィンドウ移動時の設定更新
     * - window-resized-end: リサイズ完了時の設定更新 + onWindowResizedEnd()フック
     * - window-maximize-toggled: 最大化切り替え時の設定更新 + onWindowMaximizeToggled()フック
     * - menu-action: メニューアクション実行
     * - get-menu-definition: メニュー定義取得要求
     * - window-close-request: クローズ要求
     */
    setupCommonMessageBusHandlers() {
        if (!this.messageBus) {
            logger.warn(`[${this.pluginName}] messageBusが初期化されていないため、共通ハンドラ登録をスキップ`);
            return;
        }

        // NOTE: initハンドラは各プラグインで個別に実装する必要がある
        // （MessageBusのon()は同じタイプのハンドラを上書きするため、共通化不可）
        // 各プラグインのinitハンドラで以下を実行すること:
        //   1. this.windowId = data.windowId;
        //   2. this.messageBus.setWindowId(data.windowId);

        // window-moved メッセージ
        this.messageBus.on('window-moved', (data) => {
            logger.debug(`[${this.pluginName}] [MessageBus] window-moved受信`);
            this.updateWindowConfig({
                pos: data.pos,
                width: data.width,
                height: data.height
            });
        });

        // window-resized-end メッセージ
        this.messageBus.on('window-resized-end', (data) => {
            logger.debug(`[${this.pluginName}] [MessageBus] window-resized-end受信`);
            this.updateWindowConfig({
                pos: data.pos,
                width: data.width,
                height: data.height
            });
            // サブクラスでオーバーライド可能なフック
            this.onWindowResizedEnd?.(data);
        });

        // window-maximize-toggled メッセージ
        this.messageBus.on('window-maximize-toggled', (data) => {
            logger.debug(`[${this.pluginName}] [MessageBus] window-maximize-toggled受信`);

            // isFullscreen状態を同期
            this.isFullscreen = data.maximize;

            this.updateWindowConfig({
                pos: data.pos,
                width: data.width,
                height: data.height,
                maximize: data.maximize
            });
            // サブクラスでオーバーライド可能なフック
            this.onWindowMaximizeToggled?.(data);
        });

        // menu-action メッセージ
        this.messageBus.on('menu-action', (data) => {
            logger.debug(`[${this.pluginName}] [MessageBus] menu-action受信:`, data.action);
            this.executeMenuAction(data.action, data.additionalData);
        });

        // get-menu-definition メッセージ
        this.messageBus.on('get-menu-definition', async (data) => {
            logger.debug(`[${this.pluginName}] [MessageBus] get-menu-definition受信`);
            const menuDefinition = await this.getMenuDefinition();
            this.messageBus.send('menu-definition-response', {
                messageId: data.messageId,
                menuDefinition: menuDefinition
            });
        });

        // window-close-request メッセージ
        this.messageBus.on('window-close-request', async (data) => {
            logger.debug(`[${this.pluginName}] [MessageBus] window-close-request受信`);
            try {
                await this.handleCloseRequest(data.windowId);
            } catch (error) {
                // エラー発生時はクローズを許可（ハングアップ防止）
                this.respondCloseRequest(data.windowId, true);
            }
        });

        // parent-dialog-opened メッセージ（親ウィンドウでダイアログが開いた）
        this.messageBus.on('parent-dialog-opened', () => {
            this.dialogVisible = true;
            logger.debug(`[${this.pluginName}] [MessageBus] parent-dialog-opened受信`);
        });

        // parent-dialog-closed メッセージ（親ウィンドウでダイアログが閉じた）
        this.messageBus.on('parent-dialog-closed', () => {
            this.dialogVisible = false;
            logger.debug(`[${this.pluginName}] [MessageBus] parent-dialog-closed受信`);
        });

        // window-activated メッセージ（ウィンドウがアクティブになった）
        this.messageBus.on('window-activated', () => {
            this.isWindowActive = true;
            logger.debug(`[${this.pluginName}] [MessageBus] window-activated受信`);
            this.onWindowActivated();
        });

        // window-deactivated メッセージ（ウィンドウが非アクティブになった）
        this.messageBus.on('window-deactivated', () => {
            this.isWindowActive = false;
            logger.debug(`[${this.pluginName}] [MessageBus] window-deactivated受信`);
            this.onWindowDeactivated();
        });

        // set-scroll-position メッセージ（親からのスクロール位置設定要求）
        this.messageBus.on('set-scroll-position', (data) => {
            if (data.windowId === this.windowId) {
                this.handleSetScrollPosition(data);
            }
        });

        // child-panel-window-closed メッセージ（子パネルウィンドウが閉じられた）
        this.messageBus.on('child-panel-window-closed', (data) => {
            // childPanelWindowsから削除
            for (const [panelType, windowId] of this.childPanelWindows.entries()) {
                if (windowId === data.windowId) {
                    this.childPanelWindows.delete(panelType);
                    // フックメソッド呼び出し（オーバーライド可能）
                    this.onChildPanelClosed(panelType, windowId);
                    break;
                }
            }
        });

        logger.info(`[${this.pluginName}] 共通MessageBusハンドラ登録完了 (12件)`);

        // plugin-ready シグナルを親ウィンドウに送信
        // これにより親ウィンドウはプラグインの準備完了を確認してからinitを送信できる
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({ type: 'plugin-ready' }, '*');
            logger.debug(`[${this.pluginName}] plugin-readyシグナル送信`);
        }
    }

    /**
     * cross-window-drop-successの共通ハンドラーを設定
     * moveモード時に onDeleteSourceVirtualObject() フックを呼び出す
     *
     * サブクラスは setupMessageBusHandlers() でこのメソッドを呼び出すこと
     *
     * 動作:
     * - moveモード: onDeleteSourceVirtualObject()フックを呼び出して元のオブジェクトを削除
     * - copyモード: 何もしない
     * - ドラッグ状態をクリーンアップ
     * - onCrossWindowDropSuccess()フックを呼び出す（サブクラス固有の処理）
     */
    setupCrossWindowDropSuccessHandler() {
        this.messageBus.on('cross-window-drop-success', (data) => {
            if (data.mode === 'move') {
                // moveモード: サブクラスで元のオブジェクトを削除
                this.onDeleteSourceVirtualObject?.(data);
            }
            // copyモードの場合は何もしない

            // ドラッグ状態をクリーンアップ
            this.cleanupVirtualObjectDragState();

            // サブクラス固有のクリーンアップ
            this.onCrossWindowDropSuccess?.(data);
        });
    }

    /**
     * ウィンドウリサイズ完了時のフック（サブクラスでオーバーライド）
     * @param {Object} data - リサイズデータ { pos, width, height }
     */
    onWindowResizedEnd(data) {
        // デフォルト実装は空（サブクラスで必要に応じてオーバーライド）
    }

    /**
     * ウィンドウ最大化切り替え時のフック（サブクラスでオーバーライド）
     * @param {Object} data - 最大化データ { pos, width, height, maximize }
     */
    onWindowMaximizeToggled(data) {
        // デフォルト実装は空（サブクラスで必要に応じてオーバーライド）
    }

    /**
     * ウィンドウがアクティブになった時のフック（サブクラスでオーバーライド）
     * window-activatedメッセージ受信時に呼び出される
     */
    onWindowActivated() {
        // デフォルト実装は空（サブクラスで必要に応じてオーバーライド）
    }

    /**
     * ウィンドウが非アクティブになった時のフック（サブクラスでオーバーライド）
     * window-deactivatedメッセージ受信時に呼び出される
     */
    onWindowDeactivated() {
        // デフォルト実装は空（サブクラスで必要に応じてオーバーライド）
    }

    // ========================================
    // ウィンドウクローズ処理（テンプレートメソッドパターン）
    // ========================================

    /**
     * ウィンドウクローズ要求を処理
     * 編集中の場合は保存確認ダイアログを表示し、必要に応じて保存後にクローズ
     *
     * サブクラスでカスタマイズする場合:
     * - onSaveBeforeClose(): 保存処理をオーバーライド
     * - または handleCloseRequest() 自体をオーバーライド
     *
     * @param {string} windowId - ウィンドウID
     */
    async handleCloseRequest(windowId) {
        logger.debug(`[${this.pluginName}] クローズ要求受信, isModified:`, this.isModified);

        // クローズ前にスクロール位置を保存
        const scrollPos = this.getScrollPosition();
        if (scrollPos) {
            this.updateWindowConfig({ scrollPos });
        }

        if (this.isModified) {
            // 編集中の場合、保存確認ダイアログを表示
            const result = await this.showSaveConfirmDialog();
            logger.debug(`[${this.pluginName}] 保存確認ダイアログ結果:`, result);

            // resultがundefined/nullの場合はキャンセル扱い（タイムアウト等の異常時）
            if (!result || result === 'cancel') {
                // 取消: クローズをキャンセル
                this.respondCloseRequest(windowId, false);
            } else if (result === 'no') {
                // 保存しない: そのままクローズ
                this.respondCloseRequest(windowId, true);
            } else if (result === 'yes') {
                // 保存: 保存してからクローズ
                try {
                    await this.onSaveBeforeClose();
                    this.isModified = false;
                    this.respondCloseRequest(windowId, true);
                } catch (error) {
                    // 保存失敗時はユーザーに通知し、クローズをキャンセル
                    logger.error(`[${this.pluginName}] onSaveBeforeClose失敗:`, error);
                    await this.showMessageDialog('保存に失敗しました', [{ label: 'OK', value: 'ok' }], 0);
                    this.respondCloseRequest(windowId, false);
                }
            }
        } else {
            // 未編集の場合、そのままクローズ
            this.respondCloseRequest(windowId, true);
        }
    }

    /**
     * クローズ前の保存処理フック（サブクラスでオーバーライド）
     * handleCloseRequest()で「保存」が選択された時に呼ばれる
     *
     * @example
     * // basic-text-editorでの実装例
     * async onSaveBeforeClose() {
     *     this.notifyXmlDataChanged();
     * }
     *
     * // basic-figure-editorでの実装例
     * async onSaveBeforeClose() {
     *     await this.saveFile();
     * }
     */
    async onSaveBeforeClose() {
        // デフォルト実装: 何もしない（読み取り専用プラグイン向け）
        logger.debug(`[${this.pluginName}] onSaveBeforeClose: デフォルト実装（何もしない）`);
    }

    /**
     * クローズ要求に応答
     * @param {string} windowId - ウィンドウID
     * @param {boolean} allowClose - クローズを許可するか
     */
    respondCloseRequest(windowId, allowClose) {
        logger.debug(`[${this.pluginName}] クローズ応答送信, windowId:`, windowId, ', allowClose:', allowClose);
        if (this.messageBus) {
            this.messageBus.send('window-close-response', {
                windowId: windowId,
                allowClose: allowClose
            });
        }
    }

    // ========================================
    // スクロール位置管理
    // ========================================

    /**
     * 現在のスクロール位置を取得（サブクラスでオーバーライド可能）
     * デフォルトでは .plugin-content 要素のスクロール位置を返す
     * @returns {Object|null} { x, y } または null
     */
    getScrollPosition() {
        const pluginContent = document.querySelector('.plugin-content');
        if (pluginContent) {
            return {
                x: pluginContent.scrollLeft,
                y: pluginContent.scrollTop
            };
        }
        return null;
    }

    /**
     * スクロール位置を設定（サブクラスでオーバーライド可能）
     * キャンバスサイズが縮小した場合は最大スクロール可能位置に制限
     * @param {Object} scrollPos - { x, y }
     */
    setScrollPosition(scrollPos) {
        if (!scrollPos) return;
        const pluginContent = document.querySelector('.plugin-content');
        if (pluginContent) {
            const maxScrollLeft = Math.max(0, pluginContent.scrollWidth - pluginContent.clientWidth);
            const maxScrollTop = Math.max(0, pluginContent.scrollHeight - pluginContent.clientHeight);
            pluginContent.scrollLeft = Math.min(scrollPos.x || 0, maxScrollLeft);
            pluginContent.scrollTop = Math.min(scrollPos.y || 0, maxScrollTop);
        }
    }

    /**
     * スクロール位置を保存してウィンドウ設定に反映
     * 自動保存や明示的保存時に呼び出す
     */
    saveScrollPosition() {
        const scrollPos = this.getScrollPosition();
        if (scrollPos) {
            this.updateWindowConfig({ scrollPos });
        }
    }

    /**
     * スクロール位置を保持しながら要素にフォーカス
     * 一部のブラウザでfocus()呼び出し時にスクロール位置がリセットされる問題を回避
     *
     * @param {HTMLElement} element - フォーカスする要素
     */
    focusWithScrollPreservation(element) {
        if (!element) return;
        const scrollPos = {
            x: element.scrollLeft,
            y: element.scrollTop
        };
        element.focus();
        requestAnimationFrame(() => {
            element.scrollLeft = scrollPos.x;
            element.scrollTop = scrollPos.y;
        });
    }

    /**
     * 現在の選択範囲（カーソル位置）を保存
     * ウィンドウ非アクティブ時に呼び出し、復元時に使用
     */
    _saveSelection() {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) {
            this.savedSelection = null;
            return;
        }

        const range = selection.getRangeAt(0);
        this.savedSelection = {
            startContainer: range.startContainer,
            startOffset: range.startOffset,
            endContainer: range.endContainer,
            endOffset: range.endOffset,
            collapsed: range.collapsed
        };
    }

    /**
     * 保存された選択範囲（カーソル位置）を復元
     * ウィンドウアクティブ時に呼び出し
     * @returns {boolean} 復元に成功した場合true
     */
    _restoreSelection() {
        if (!this.savedSelection) return false;

        try {
            const selection = window.getSelection();
            if (!selection) return false;

            // 保存されたノードがまだDOMに存在するか確認
            if (!document.contains(this.savedSelection.startContainer) ||
                !document.contains(this.savedSelection.endContainer)) {
                this.savedSelection = null;
                return false;
            }

            const range = document.createRange();
            range.setStart(this.savedSelection.startContainer, this.savedSelection.startOffset);
            range.setEnd(this.savedSelection.endContainer, this.savedSelection.endOffset);

            selection.removeAllRanges();
            selection.addRange(range);
            return true;
        } catch (e) {
            // オフセットが無効な場合などのエラーを無視
            this.savedSelection = null;
            return false;
        }
    }

    // ========================================
    // 共通ユーティリティメソッド
    // ========================================

    /**
     * ログ出力（プラグイン名付き）
     * @param {...any} args - ログ引数
     */
    log(...args) {
        logger.info(`[${this.pluginName}]`, ...args);
    }

    /**
     * 警告ログ出力（プラグイン名付き）
     * @param {...any} args - ログ引数
     */
    warn(...args) {
        logger.warn(`[${this.pluginName}]`, ...args);
    }

    /**
     * エラーログ出力（プラグイン名付き）
     * @param {...any} args - ログ引数
     */
    error(...args) {
        logger.error(`[${this.pluginName}]`, ...args);
    }

    /**
     * ユニークなメッセージIDを生成
     * MessageBusでの request/response ペアリングに使用
     *
     * @param {string} [prefix='msg'] - プレフィックス（操作種別を示す）
     * @returns {string} ユニークなメッセージID
     *
     * @example
     * const messageId = this.generateMessageId('duplicate');
     * // => 'duplicate-1734567890123-a1b2c3d4e'
     *
     * this.messageBus.send('duplicate-real-object', { realId, messageId });
     * const result = await this.messageBus.waitFor('real-object-duplicated', TIMEOUT,
     *     (data) => data.messageId === messageId);
     */
    generateMessageId(prefix = 'msg') {
        return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    // ========================================
    // 子パネルウィンドウ管理
    // ========================================

    /**
     * URLからプラグインIDを抽出
     * plugins/{pluginId}/index.html 形式のURLからpluginIdを取得
     * @returns {string|null} プラグインID、取得できない場合はnull
     * @private
     */
    _extractPluginIdFromUrl() {
        try {
            const path = window.location.pathname;
            const match = path.match(/plugins\/([^/]+)\//);
            return match ? match[1] : null;
        } catch {
            return null;
        }
    }

    /**
     * 子パネルウィンドウを開く
     * @param {string} panelType - パネル種別（'material', 'settings' など）
     * @param {Object} options - ウィンドウオプション
     * @param {string} options.panelUrl - パネルのHTMLパス（プラグインからの相対パス）
     * @param {string} [options.title='設定'] - ウィンドウタイトル
     * @param {number} [options.width=200] - 幅
     * @param {number} [options.height=300] - 高さ
     * @param {number} [options.x] - X座標（省略時は自動配置）
     * @param {number} [options.y] - Y座標（省略時は自動配置）
     * @param {Object} [options.initData={}] - 初期化データ
     * @returns {Promise<string>} 作成されたウィンドウID
     */
    async openChildPanelWindow(panelType, options) {
        // 既に開いている場合はそのウィンドウIDを返す
        if (this.childPanelWindows.has(panelType)) {
            return this.childPanelWindows.get(panelType);
        }

        return new Promise((resolve, reject) => {
            const messageId = this.generateMessageId('child-panel');

            this.messageBus.send('open-child-panel-window', {
                panelType,
                parentWindowId: this.windowId,
                pluginId: this.pluginId,
                options: {
                    panelUrl: options.panelUrl,
                    title: options.title || '設定',
                    width: options.width || 200,
                    height: options.height || 300,
                    x: options.x,
                    y: options.y,
                    noTitleBar: options.noTitleBar || false,
                    resizable: options.resizable !== false,
                    initData: options.initData || {}
                },
                messageId
            });

            this.messageBus.waitFor('child-panel-window-created', DEFAULT_TIMEOUT_MS,
                (data) => data.messageId === messageId
            ).then(data => {
                this.childPanelWindows.set(panelType, data.windowId);
                resolve(data.windowId);
            }).catch(reject);
        });
    }

    /**
     * 子パネルウィンドウを閉じる
     * @param {string} panelTypeOrWindowId - パネル種別またはウィンドウID
     */
    closeChildPanelWindow(panelTypeOrWindowId) {
        let windowId = panelTypeOrWindowId;

        // パネル種別で指定された場合はウィンドウIDを取得
        if (this.childPanelWindows.has(panelTypeOrWindowId)) {
            windowId = this.childPanelWindows.get(panelTypeOrWindowId);
            this.childPanelWindows.delete(panelTypeOrWindowId);
        }

        this.messageBus.send('close-window', { windowId });
    }

    /**
     * 子パネルウィンドウの表示/非表示を切り替え
     * @param {string} panelType - パネル種別
     * @param {Object} options - openChildPanelWindowと同じオプション
     * @returns {Promise<string|null>} 開いた場合はウィンドウID、閉じた場合はnull
     */
    async toggleChildPanelWindow(panelType, options) {
        if (this.childPanelWindows.has(panelType)) {
            this.closeChildPanelWindow(panelType);
            return null;
        } else {
            return this.openChildPanelWindow(panelType, options);
        }
    }

    /**
     * 子パネルウィンドウのIDを取得
     * @param {string} panelType - パネル種別
     * @returns {string|undefined} ウィンドウID（開いていない場合はundefined）
     */
    getChildPanelWindowId(panelType) {
        return this.childPanelWindows.get(panelType);
    }

    /**
     * 子パネルウィンドウにメッセージを送信
     * @param {string} panelType - パネル種別
     * @param {string} type - メッセージタイプ
     * @param {Object} [data={}] - 送信データ
     */
    sendToChildPanel(panelType, type, data = {}) {
        const windowId = this.childPanelWindows.get(panelType);
        if (windowId) {
            this.messageBus.send('send-to-child-panel', {
                targetWindowId: windowId,
                type,
                data
            });
        }
    }

    /**
     * 子パネルウィンドウが閉じられた時のフック
     * サブクラスでオーバーライドして独自の処理を追加可能
     * @param {string} panelType - パネル種別
     * @param {string} windowId - ウィンドウID
     */
    onChildPanelClosed(panelType, windowId) {
        // サブクラスでオーバーライド可能
    }

    // ========================================
    // XML エスケープ処理（util.jsに委譲）
    // ========================================

    /**
     * XML特殊文字をエスケープ
     * @param {string} text - エスケープする文字列
     * @returns {string} エスケープ済み文字列
     */
    escapeXml(text) {
        return escapeXmlUtil(text);
    }

    /**
     * XML特殊文字をアンエスケープ
     * @param {string} text - アンエスケープする文字列
     * @returns {string} アンエスケープ済み文字列
     */
    unescapeXml(text) {
        return unescapeXmlUtil(text);
    }

    // ========================================
    // アイコン読み込みヘルパー
    // ========================================

    /**
     * 単一アイコンを読み込んでthis.iconDataに格納
     * @param {string} realId - 実身ID
     * @returns {Promise<string|null>} アイコンデータ（base64）、失敗時はnull
     */
    async loadAndStoreIcon(realId) {
        if (!this.iconManager) return null;
        try {
            const iconData = await this.iconManager.loadIcon(realId);
            if (iconData) {
                this.iconData[realId] = iconData;
            }
            return iconData;
        } catch (error) {
            logger.debug(`[${this.pluginName}] アイコン読み込みエラー:`, realId, error.message);
            return null;
        }
    }

    /**
     * 複数アイコンを一括読み込んでthis.iconDataに格納
     * @param {string[]} realIds - 実身ID配列
     * @returns {Promise<void>}
     */
    async loadAndStoreIcons(realIds) {
        if (!this.iconManager || !realIds || realIds.length === 0) return;

        // 重複を除去
        const uniqueIds = [...new Set(realIds)];

        const promises = uniqueIds.map(realId =>
            this.iconManager.loadIcon(realId)
                .then(iconData => {
                    if (iconData) {
                        this.iconData[realId] = iconData;
                    }
                })
                .catch(() => {})
        );

        await Promise.all(promises);
    }

    // ========================================
    // 背景色変更（共通処理）
    // ========================================

    /**
     * 背景色変更ダイアログを表示し、背景色を変更する
     * サブクラスでapplyBackgroundColor()をオーバーライドして
     * プラグイン固有の背景色適用処理を実装する
     */
    async changeBgColor() {
        // 現在の背景色を取得
        const currentBgColor = this.bgColor ||
            this.currentFile?.windowConfig?.backgroundColor ||
            this.fileData?.windowConfig?.backgroundColor ||
            '#ffffff';

        const result = await this.showInputDialog(
            '背景色を入力してください（例: #ffffff）',
            currentBgColor,
            20,
            { colorPicker: true }
        );

        // キャンセルまたは空の場合は何もしない
        if (!result || (typeof result === 'object' && !result.value)) {
            return;
        }

        // 入力値を取得
        const newBgColor = typeof result === 'object' ? result.value : result;

        this.bgColor = newBgColor;

        // プラグイン固有の背景色適用（サブクラスでオーバーライド）
        this.applyBackgroundColor(newBgColor);

        this.isModified = true;

        // 親ウィンドウに背景色更新を通知
        if (this.messageBus && this.realId) {
            this.messageBus.send('update-background-color', {
                fileId: this.realId,
                backgroundColor: newBgColor
            });
        }

        // currentFile/fileDataを更新
        if (this.currentFile) {
            if (!this.currentFile.windowConfig) {
                this.currentFile.windowConfig = {};
            }
            this.currentFile.windowConfig.backgroundColor = newBgColor;
        }
        if (this.fileData) {
            if (!this.fileData.windowConfig) {
                this.fileData.windowConfig = {};
            }
            this.fileData.windowConfig.backgroundColor = newBgColor;
        }
    }

    /**
     * 背景色をUIに適用する（サブクラスでオーバーライド）
     * @param {string} color - 背景色
     */
    applyBackgroundColor(color) {
        // 背景色を記録（changeBgColorで現在色を取得するため）
        this.bgColor = color;
        // デフォルト実装: document.bodyに適用
        document.body.style.backgroundColor = color;
    }

    // ========================================
    // 仮身ドラッグ関連のフックメソッド
    // ========================================

    /**
     * ドラッグモードが変更された時のフック（サブクラスでオーバーライド）
     * setupVirtualObjectRightButtonHandlers()で右ボタン操作時に呼ばれる
     *
     * @param {string} newMode - 新しいモード ('move' | 'copy')
     *
     * @example
     * // basic-figure-editorでの実装例
     * onDragModeChanged(newMode) {
     *     logger.debug('[FIGURE EDITOR] ドラッグモード変更:', newMode);
     *     // プレビュー表示の更新など
     * }
     */
    onDragModeChanged(newMode) {
        // デフォルト実装は空（サブクラスで必要に応じてオーバーライド）
    }

    /**
     * 元の仮身オブジェクトを削除するフック（サブクラスで実装必須）
     * cross-window-drop-successでmoveモード時に呼ばれる
     *
     * @param {Object} data - ドロップ成功データ
     * @param {string} data.mode - ドラッグモード ('move')
     * @param {string} data.source - ドラッグ元プラグイン名
     * @param {string} data.sourceWindowId - ドラッグ元ウィンドウID
     * @param {Array} data.virtualObjects - 仮身オブジェクト配列
     * @param {string} data.virtualObjectId - 仮身ID
     *
     * @example
     * // virtual-object-listでの実装例
     * onDeleteSourceVirtualObject(data) {
     *     const linkId = data.virtualObjectId || data.virtualObjects[0]?.link_id;
     *     this.removeVirtualObjectFromList(linkId);
     * }
     *
     * // basic-calc-editorでの実装例
     * onDeleteSourceVirtualObject(data) {
     *     if (this.dragSourceCell) {
     *         const { col, row } = this.dragSourceCell;
     *         this.clearCell(col, row);
     *     }
     * }
     *
     * // basic-text-editorでの実装例
     * onDeleteSourceVirtualObject(data) {
     *     if (this.draggingVirtualObject && this.draggingVirtualObject.parentNode) {
     *         this.draggingVirtualObject.parentNode.removeChild(this.draggingVirtualObject);
     *     }
     * }
     */
    onDeleteSourceVirtualObject(data) {
        // デフォルト実装は空（サブクラスで必ず実装すること）
        logger.warn(`[${this.pluginName}] onDeleteSourceVirtualObject が実装されていません`);
    }

    /**
     * cross-window-drop-success処理完了後のフック（サブクラスでオーバーライド）
     * ドラッグ状態のクリーンアップ後に呼ばれる
     *
     * @param {Object} data - ドロップ成功データ
     *
     * @example
     * // プラグイン固有の状態クリア
     * onCrossWindowDropSuccess(data) {
     *     this.dragSourceCell = null;
     *     this.draggingVirtualObject = null;
     * }
     */
    onCrossWindowDropSuccess(data) {
        // デフォルト実装は空（サブクラスで必要に応じてオーバーライド）
    }

    // ========================================
    // 仮身refCount管理（共通メソッド）
    // ========================================

    /**
     * 仮身コピー要求（refCount+1）
     * 新しい仮身参照が作成された時に呼び出す
     * - コピーモードドロップ時
     * - クリップボードからペースト時
     *
     * 注意: 移動モードでは呼ばないこと（参照が移動するだけなので）
     *
     * @param {string} linkId - 仮身のlink_id
     */
    requestCopyVirtualObject(linkId) {
        const realId = this.extractRealId(linkId);
        this.messageBus.send('copy-virtual-object', {
            realId: realId,
            messageId: this.generateMessageId('copy-virtual')
        });
    }

    /**
     * 仮身削除要求（refCount-1）
     * 仮身参照が削除された時に呼び出す
     * - ユーザーによる明示的削除時（メニュー/キー）
     * - カット操作時
     *
     * 注意: 移動モードクロスウィンドウドロップでは呼ばないこと
     *       （ターゲット側で+1されず、ソース側で-1すると不整合になる）
     *
     * @param {string} linkId - 仮身のlink_id
     */
    requestDeleteVirtualObject(linkId) {
        const realId = this.extractRealId(linkId);
        this.messageBus.send('delete-virtual-object', {
            realId: realId,
            messageId: this.generateMessageId('delete-virtual')
        });
    }

    // ========================================
    // ステータスメッセージ（共通実装）
    // ========================================

    /**
     * ステータスメッセージを設定
     * 親ウィンドウのステータスバーにメッセージを送信
     * サブクラスでオーバーライド可能
     *
     * @param {string} message - 表示するメッセージ
     */
    setStatus(message) {
        this.sendStatusMessage(message);
    }

    // ========================================
    // グローバルクリップボード（共通実装）
    // ========================================

    /**
     * グローバルクリップボードからデータを取得
     * messageId方式でレスポンスを待つ
     *
     * @returns {Promise<Object|null>} クリップボードデータ（仮身データ等）
     */
    async getGlobalClipboard() {
        if (!window.parent || window.parent === window) {
            return null;
        }

        const messageId = this.generateMessageId('get-clipboard');

        this.messageBus.send('get-clipboard', {
            messageId: messageId
        });

        try {
            const result = await this.messageBus.waitFor('clipboard-data', DEFAULT_TIMEOUT_MS, (data) => {
                return data.messageId === messageId;
            });
            return result.clipboardData;
        } catch (error) {
            logger.warn(`[${this.pluginName}] クリップボード取得タイムアウト:`, error);
            return null;
        }
    }

    // ========================================
    // 仮身実行メニュー関連（共通実装）
    // ========================================

    /**
     * execute-with-アクションを処理
     * executeMenuAction()から呼び出して使用
     *
     * @param {string} action - アクション名
     * @returns {boolean} 処理した場合はtrue
     *
     * @example
     * executeMenuAction(action, additionalData) {
     *     if (this.handleExecuteWithAction(action)) return;
     *     // 他のアクション処理...
     * }
     */
    handleExecuteWithAction(action) {
        if (!action.startsWith('execute-with-')) {
            return false;
        }
        const pluginId = action.replace('execute-with-', '');
        logger.debug(`[${this.pluginName}] 仮身を指定アプリで起動:`, pluginId);

        // サブクラスでgetContextMenuVirtualObject()を実装している場合
        const contextVo = this.getContextMenuVirtualObject?.();
        if (contextVo) {
            this.openVirtualObjectReal(contextVo, pluginId);
            this.setStatus(`${pluginId}で実身を開きます`);
        }
        return true;
    }

    /**
     * コンテキストメニューで選択中の仮身を取得（サブクラスでオーバーライド）
     * handleExecuteWithAction()から呼ばれる
     *
     * @returns {Object|null} 仮身オブジェクト（virtualObj形式）
     */
    getContextMenuVirtualObject() {
        // デフォルト実装: contextMenuVirtualObjectプロパティを参照
        return this.contextMenuVirtualObject?.virtualObj || null;
    }

    /**
     * 実行サブメニューをapplistから生成
     *
     * @param {Object} applistData - applistデータ { pluginId: { name, ... }, ... }
     * @param {string} [labelKey='label'] - ラベルキー（'label' または 'text'）
     * @returns {Array} サブメニュー項目配列 [{ label/text, action }, ...]
     *
     * @example
     * const applistData = await this.getAppListData(realId);
     * if (applistData && Object.keys(applistData).length > 0) {
     *     const executeSubmenu = this.buildExecuteSubmenu(applistData);
     *     menuDef.push({ label: '実行', submenu: executeSubmenu });
     * }
     */
    buildExecuteSubmenu(applistData, labelKey = 'label') {
        const executeSubmenu = [];
        for (const [pluginId, appInfo] of Object.entries(applistData)) {
            const item = {
                action: `execute-with-${pluginId}`
            };
            item[labelKey] = appInfo.name || pluginId;
            executeSubmenu.push(item);
        }
        return executeSubmenu;
    }

    /**
     * 仮身の実身を指定プラグインで開く
     *
     * @param {Object} virtualObj - 仮身オブジェクト
     * @param {string} pluginId - 開くプラグインのID
     * @param {string} [messageId] - メッセージID（省略時は自動生成）
     */
    openVirtualObjectReal(virtualObj, pluginId, messageId = null) {
        if (!virtualObj || !pluginId) {
            logger.warn(`[${this.pluginName}] openVirtualObjectReal: virtualObjまたはpluginIdが未指定`);
            return;
        }

        const msgId = messageId || `open-${virtualObj.link_id || 'unknown'}-${Date.now()}`;

        this.messageBus.send('open-virtual-object-real', {
            virtualObj: virtualObj,
            pluginId: pluginId,
            messageId: msgId
        });

        logger.debug(`[${this.pluginName}] 実身を開く:`, virtualObj.link_id || virtualObj.link_name, 'with', pluginId);
    }

    // ========================================
    // ウィンドウ操作（共通実装）
    // ========================================

    /**
     * ウィンドウを閉じるリクエストを送信
     * 親ウィンドウに対してclose-windowメッセージを送信
     */
    requestCloseWindow() {
        if (window.parent && window.parent !== window) {
            const windowElement = window.frameElement ? window.frameElement.closest('.window') : null;
            const windowId = windowElement ? windowElement.id : null;

            if (windowId && this.messageBus) {
                this.messageBus.send('close-window', {
                    windowId: windowId
                });
            }
        }
    }

    // ========================================
    // 実身操作（共通実装）
    // ========================================

    /**
     * 選択中の仮身が指し示す開いている実身を閉じる
     * contextMenuVirtualObjectが設定されている前提
     */
    closeRealObject() {
        window.RealObjectSystem.closeRealObject(this);
    }

    /**
     * 選択中の仮身が指し示す実身名を変更
     * @returns {Promise<{success: boolean, newName?: string}>}
     */
    async renameRealObject() {
        return await window.RealObjectSystem.renameRealObject(this);
    }

    /**
     * 選択中の仮身が指し示す実身を複製
     */
    async duplicateRealObject() {
        await window.RealObjectSystem.duplicateRealObject(this);
    }

    // ========================================
    // 画像ファイル操作（共通実装）
    // ========================================

    /**
     * 画像ファイルを削除
     * @param {string} fileName - 削除する画像ファイル名
     */
    deleteImageFile(fileName) {
        if (!fileName) return;

        try {
            // 親ウィンドウ(tadjs-desktop.js)にファイル削除を依頼
            this.messageBus.send('delete-image-file', {
                fileName: fileName
            });

            logger.info(`[${this.pluginName}] 画像ファイル削除依頼:`, fileName);
        } catch (error) {
            logger.error(`[${this.pluginName}] 画像ファイル削除依頼エラー:`, error);
        }
    }

    /**
     * 画像ファイルを保存
     * FileオブジェクトまたはDataURL文字列から保存可能
     *
     * @param {File|Blob|string} source - 保存するソース（File/Blob または DataURL文字列）
     * @param {string} fileName - 保存先ファイル名
     * @param {string} [mimeType] - MIMEタイプ（省略時はソースから推測）
     * @returns {Promise<boolean>} 成功時true
     */
    async saveImageFile(source, fileName, mimeType = null) {
        try {
            let bytes;
            let detectedMimeType;

            if (source instanceof File || source instanceof Blob) {
                // File/Blobオブジェクトから保存
                const arrayBuffer = await source.arrayBuffer();
                bytes = new Uint8Array(arrayBuffer);
                detectedMimeType = mimeType || source.type || 'application/octet-stream';
            } else if (typeof source === 'string' && source.startsWith('data:')) {
                // DataURLから保存
                const base64 = source.split(',')[1];
                const binaryString = atob(base64);
                bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                detectedMimeType = mimeType || source.split(',')[0].split(':')[1].split(';')[0];
            } else {
                throw new Error('Invalid source: must be File, Blob, or DataURL string');
            }

            const messageId = this.generateMessageId('save-image');

            // 親ウィンドウ(tadjs-desktop.js)にファイル保存を依頼
            this.messageBus.send('save-image-file', {
                messageId: messageId,
                fileName: fileName,
                imageData: Array.from(bytes),
                mimeType: detectedMimeType
            });

            // レスポンスを待つ
            const result = await this.messageBus.waitFor('save-image-result', 10000,
                (data) => data.messageId === messageId
            );

            if (!result.success) {
                logger.error(`[${this.pluginName}] 画像ファイル保存失敗:`, fileName);
                return false;
            }

            logger.debug(`[${this.pluginName}] 画像ファイル保存完了:`, fileName);
            return true;
        } catch (error) {
            logger.error(`[${this.pluginName}] 画像ファイル保存エラー:`, error);
            return false;
        }
    }

    /**
     * ImageDataからPNG画像ファイルを保存
     * @param {ImageData} imageData - 保存するImageData
     * @param {string} fileName - 保存先ファイル名
     * @returns {Promise<boolean>} 成功時true
     */
    async savePixelmapImageFile(imageData, fileName) {
        try {
            // ImageDataをPNG形式のBlobに変換
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = imageData.width;
            tempCanvas.height = imageData.height;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.putImageData(imageData, 0, 0);

            // CanvasからBlobを取得
            const blob = await new Promise((resolve) => {
                tempCanvas.toBlob(resolve, 'image/png');
            });

            // BlobをArrayBufferに変換
            const arrayBuffer = await blob.arrayBuffer();
            const buffer = new Uint8Array(arrayBuffer);

            const messageId = this.generateMessageId('save-pixelmap');

            // 親ウィンドウ(tadjs-desktop.js)にファイル保存を依頼
            this.messageBus.send('save-image-file', {
                messageId: messageId,
                fileName: fileName,
                imageData: Array.from(buffer),
                mimeType: 'image/png'
            });

            // レスポンスを待つ
            const result = await this.messageBus.waitFor('save-image-result', 10000,
                (data) => data.messageId === messageId
            );

            if (!result.success) {
                logger.error(`[${this.pluginName}] ピクセルマップ保存失敗:`, fileName);
                return false;
            }

            logger.debug(`[${this.pluginName}] ピクセルマップ保存完了:`, fileName);
            return true;
        } catch (error) {
            logger.error(`[${this.pluginName}] ピクセルマップ画像ファイル保存エラー:`, error);
            return false;
        }
    }

    /**
     * HTMLImageElementからPNG画像ファイルを保存
     * @param {HTMLImageElement} imageElement - 保存する画像要素
     * @param {string} fileName - 保存先ファイル名
     * @returns {Promise<boolean>} 成功時true
     */
    async saveImageFromElement(imageElement, fileName) {
        try {
            // 画像をCanvasに描画してPNGに変換
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = imageElement.naturalWidth || imageElement.width;
            tempCanvas.height = imageElement.naturalHeight || imageElement.height;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(imageElement, 0, 0);

            // CanvasからBlobを取得
            const blob = await new Promise((resolve) => {
                tempCanvas.toBlob(resolve, 'image/png');
            });

            // BlobをArrayBufferに変換
            const arrayBuffer = await blob.arrayBuffer();
            const buffer = new Uint8Array(arrayBuffer);

            const messageId = this.generateMessageId('save-image-element');

            // 親ウィンドウ(tadjs-desktop.js)にファイル保存を依頼
            this.messageBus.send('save-image-file', {
                messageId: messageId,
                fileName: fileName,
                imageData: Array.from(buffer),
                mimeType: 'image/png'
            });

            // レスポンスを待つ
            const result = await this.messageBus.waitFor('save-image-result', 10000,
                (data) => data.messageId === messageId
            );

            if (!result.success) {
                logger.error(`[${this.pluginName}] 画像ファイル保存失敗(Element):`, fileName);
                return false;
            }

            logger.debug(`[${this.pluginName}] 画像ファイル保存完了(Element):`, fileName);
            return true;
        } catch (error) {
            logger.error(`[${this.pluginName}] 画像ファイル保存エラー(Element):`, error);
            return false;
        }
    }

    /**
     * ディスク上の既存ファイルを考慮した次の画像ファイル番号を取得
     * @param {string} realId - 実身ID
     * @param {number} recordNo - レコード番号（デフォルト: 0）
     * @returns {Promise<number>} 次の画像番号
     */
    async getNextImageFileNumber(realId, recordNo = 0) {
        try {
            const messageId = this.generateMessageId('list-image-files');

            this.messageBus.send('list-image-files', {
                messageId: messageId,
                realId: realId,
                recordNo: recordNo
            });

            const result = await this.messageBus.waitFor('list-image-files-result', 5000,
                (data) => data.messageId === messageId
            );

            if (!result.files || result.files.length === 0) {
                return 0;
            }

            const maxNo = Math.max(...result.files.map(f => f.imageNo));
            return maxNo + 1;
        } catch (error) {
            logger.warn(`[${this.pluginName}] ディスクからの連番取得失敗:`, error);
            return 0;
        }
    }

    /**
     * 画像ファイルの絶対パスを取得
     * @param {string} fileName - ファイル名
     * @returns {Promise<string|null>} 絶対パス（取得失敗時はnull）
     */
    async getImageFilePath(fileName) {
        try {
            const messageId = this.generateMessageId('image-path');

            this.messageBus.send('get-image-file-path', {
                messageId: messageId,
                fileName: fileName
            });

            const result = await this.messageBus.waitFor('image-file-path-response', 5000,
                (data) => data.messageId === messageId
            );

            return result.filePath;
        } catch (error) {
            logger.warn(`[${this.pluginName}] 画像パス取得失敗:`, error);
            return null;
        }
    }

    /**
     * メモリ上の最大画像番号を取得（子クラスでオーバーライド）
     * @returns {number} 最大画像番号（-1で画像なし）
     */
    getMemoryMaxImageNumber() {
        return -1;
    }

    /**
     * 次の画像番号を取得（メモリ+ディスク両方を考慮）
     * @returns {Promise<number>} 次の画像番号
     */
    async getNextImageNumber() {
        // 1. メモリ上の最大値（子クラスで実装）
        const memoryMax = this.getMemoryMaxImageNumber();

        // 2. ディスク上の最大値
        let diskMax = -1;
        if (this.realId) {
            try {
                const diskNextNo = await this.getNextImageFileNumber(this.realId, 0);
                diskMax = diskNextNo - 1;
            } catch (error) {
                // ディスク取得失敗時はメモリのみで判断
            }
        }

        return Math.max(memoryMax, diskMax) + 1;
    }

    // ========================================
    // 仮身属性処理ヘルパー（内部メソッド）
    // ========================================

    /**
     * カラーコードが有効かどうかを検証
     * @param {string} color - 検証するカラーコード
     * @returns {boolean} 有効な場合true
     */
    _isValidVobjColor(color) {
        return color && PluginBase.VOBJ_COLOR_REGEX.test(color);
    }

    /**
     * ブール値を文字列 'true'/'false' に変換
     * @param {boolean|string} value - 変換する値
     * @returns {string} 'true' または 'false'
     */
    _boolToVobjString(value) {
        if (typeof value === 'string') {
            return value.toLowerCase() === 'true' ? 'true' : 'false';
        }
        return value ? 'true' : 'false';
    }

    /**
     * 仮身オブジェクトにデフォルト値を設定
     * 既に値がある属性は上書きしない
     * @param {Object} vobj - 仮身オブジェクト
     * @param {Object} [overrides] - デフォルト値のオーバーライド
     * @returns {Object} デフォルト値が設定されたvobjオブジェクト
     */
    _ensureVobjDefaults(vobj, overrides = {}) {
        const defaults = { ...PluginBase.VOBJ_DEFAULT_ATTRS, ...overrides };

        for (const [key, defaultValue] of Object.entries(defaults)) {
            if (!vobj[key]) {
                vobj[key] = defaultValue;
            }
        }

        return vobj;
    }

    /**
     * DOM要素のdatasetから仮身属性を読み取り、vobjにマージ
     * link_プレフィックスの有無に対応
     * @param {Object} vobj - 仮身オブジェクト
     * @param {HTMLElement} element - DOM要素
     * @returns {Object} 属性がマージされたvobjオブジェクト
     */
    _mergeVobjFromDataset(vobj, element) {
        if (!element || !element.dataset) return vobj;

        // 各属性についてlink_プレフィックス版とdataset版をフォールバック
        const attrMappings = [
            ['pictdisp', 'linkPictdisp'],
            ['namedisp', 'linkNamedisp'],
            ['roledisp', 'linkRoledisp'],
            ['typedisp', 'linkTypedisp'],
            ['updatedisp', 'linkUpdatedisp'],
            ['framedisp', 'linkFramedisp'],
            ['frcol', 'linkFrcol'],
            ['chcol', 'linkChcol'],
            ['tbcol', 'linkTbcol'],
            ['bgcol', 'linkBgcol'],
            ['chsz', 'linkChsz'],
            ['autoopen', 'linkAutoopen'],
            ['link_id', 'linkId'],
            ['link_name', 'linkName']
        ];

        for (const [vobjKey, datasetKey] of attrMappings) {
            if (!vobj[vobjKey]) {
                // link_プレフィックス版、dataset版、デフォルト値の順で探す
                const linkKey = `link_${vobjKey}`;
                vobj[vobjKey] = vobj[linkKey]
                    || element.dataset[datasetKey]
                    || PluginBase.VOBJ_DEFAULT_ATTRS[vobjKey]
                    || '';
            }
        }

        return vobj;
    }

    /**
     * 属性変更オブジェクトを仮身オブジェクトに適用
     * 共通の正規化処理（ブール変換、カラー検証）を実行
     * @param {Object} vobj - 仮身オブジェクト（変更される）
     * @param {Object} attrs - 適用する属性変更
     * @returns {Object} 変更があった属性のキーと新しい値を含むオブジェクト
     */
    _applyVobjAttrs(vobj, attrs) {
        const changes = {};

        // 表示関連のブール属性を適用
        for (const attrName of PluginBase.VOBJ_DISPLAY_BOOL_ATTRS) {
            if (attrs[attrName] !== undefined) {
                const newValue = this._boolToVobjString(attrs[attrName]);
                if (vobj[attrName] !== newValue) {
                    changes[attrName] = { old: vobj[attrName], new: newValue };
                    vobj[attrName] = newValue;
                }
            }
        }

        // カラー属性を適用（検証付き）
        for (const attrName of PluginBase.VOBJ_COLOR_ATTRS) {
            if (attrs[attrName] && this._isValidVobjColor(attrs[attrName])) {
                if (vobj[attrName] !== attrs[attrName]) {
                    changes[attrName] = { old: vobj[attrName], new: attrs[attrName] };
                    vobj[attrName] = attrs[attrName];
                }
            }
        }

        // 文字サイズの適用
        if (attrs.chsz !== undefined) {
            const newChsz = attrs.chsz.toString();
            if (vobj.chsz !== newChsz) {
                changes.chsz = { old: vobj.chsz, new: newChsz };
                vobj.chsz = newChsz;
            }
        }

        // 自動起動の適用
        if (attrs.autoopen !== undefined) {
            const newValue = this._boolToVobjString(attrs.autoopen);
            if (vobj.autoopen !== newValue) {
                changes.autoopen = { old: vobj.autoopen, new: newValue };
                vobj.autoopen = newValue;
            }
        }

        return changes;
    }

    /**
     * 属性変更をDOM要素のdatasetに反映
     * @param {HTMLElement} element - 対象のDOM要素
     * @param {Object} vobj - 属性を含む仮身オブジェクト
     */
    _syncVobjToDataset(element, vobj) {
        if (!element) return;

        element.dataset.linkPictdisp = vobj.pictdisp;
        element.dataset.linkNamedisp = vobj.namedisp;
        element.dataset.linkRoledisp = vobj.roledisp;
        element.dataset.linkTypedisp = vobj.typedisp;
        element.dataset.linkUpdatedisp = vobj.updatedisp;
        element.dataset.linkFramedisp = vobj.framedisp;
        element.dataset.linkFrcol = vobj.frcol;
        element.dataset.linkChcol = vobj.chcol;
        element.dataset.linkTbcol = vobj.tbcol;
        element.dataset.linkBgcol = vobj.bgcol;
        element.dataset.linkChsz = vobj.chsz;
        element.dataset.linkAutoopen = vobj.autoopen;
    }

    /**
     * 属性変更をDOM要素のスタイルに反映（閉じた仮身用）
     * @param {HTMLElement} element - 対象のDOM要素
     * @param {Object} attrs - 適用する属性
     */
    _applyVobjStyles(element, attrs) {
        if (!element) return;

        // 枠線の色
        if (attrs.frcol && this._isValidVobjColor(attrs.frcol)) {
            element.style.borderColor = attrs.frcol;
        }
        // 仮身文字色
        if (attrs.chcol && this._isValidVobjColor(attrs.chcol)) {
            element.style.color = attrs.chcol;
        }
        // 仮身背景色
        if (attrs.tbcol && this._isValidVobjColor(attrs.tbcol)) {
            element.style.backgroundColor = attrs.tbcol;
        }
    }

    /**
     * 変更があったかどうかを判定
     * @param {Object} changes - _applyVobjAttrs()が返す変更オブジェクト
     * @returns {boolean} 変更があった場合true
     */
    _hasVobjAttrChanges(changes) {
        return Object.keys(changes).length > 0;
    }

    /**
     * 特定の属性が変更されたかどうかを判定
     * @param {Object} changes - _applyVobjAttrs()が返す変更オブジェクト
     * @param {string} attrName - 確認する属性名
     * @returns {boolean} 指定属性が変更された場合true
     */
    _isVobjAttrChanged(changes, attrName) {
        return attrName in changes;
    }
}

// ========================================
// 仮身属性の静的定数
// ========================================

/** カラーコード検証用正規表現 */
PluginBase.VOBJ_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

/** 仮身属性のデフォルト値 */
PluginBase.VOBJ_DEFAULT_ATTRS = {
    pictdisp: 'true',
    namedisp: 'true',
    roledisp: 'false',
    typedisp: 'false',
    updatedisp: 'false',
    framedisp: 'true',
    frcol: '#000000',
    chcol: '#000000',
    tbcol: '#ffffff',
    bgcol: '#ffffff',
    chsz: '14',
    autoopen: 'false'
};

/** 表示関連のブール属性名一覧 */
PluginBase.VOBJ_DISPLAY_BOOL_ATTRS = [
    'pictdisp',
    'namedisp',
    'roledisp',
    'typedisp',
    'updatedisp',
    'framedisp'
];

/** カラー属性名一覧 */
PluginBase.VOBJ_COLOR_ATTRS = ['frcol', 'chcol', 'tbcol', 'bgcol'];
