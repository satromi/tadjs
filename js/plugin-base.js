import {
    DIALOG_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS,
    ERROR_CHECK_TIMEOUT_MS,
    DEFAULT_INPUT_WIDTH
} from './util.js';
import { getLogger } from './logger.js';

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

                // Dialog result is wrapped in response.result
                const dialogResult = response.result || response;

                if (dialogResult.error) {
                    logger.warn(`[${this.pluginName}] Save confirm dialog error:`, dialogResult.error);
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
     * @returns {Promise<string|null>} 入力値（キャンセル時はnull）
     */
    async showInputDialog(message, defaultValue = '', inputWidth = DEFAULT_INPUT_WIDTH) {
        // ユーザー入力を待つダイアログなので、タイムアウトを無効化（0に設定）
        // ボタンが押されるまで無期限に待機する
        const INPUT_DIALOG_TIMEOUT_MS = 0;

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
                logger.info(`[${this.pluginName}] 入力ダイアログコールバック実行:`, result);

                // Dialog result is wrapped in result.result
                const dialogResult = result.result || result;

                if (dialogResult.error) {
                    logger.warn(`[${this.pluginName}] Input dialog error:`, dialogResult.error);
                    resolve(null);
                    return;
                }

                // 「取り消し」ボタンの場合はnullを返す
                if (dialogResult.button === 'cancel') {
                    logger.info(`[${this.pluginName}] キャンセルされました`);
                    resolve(null);
                } else {
                    logger.info(`[${this.pluginName}] 設定ボタンが押されました, value:`, dialogResult.value);
                    resolve(dialogResult.value);
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
        return new Promise((resolve, reject) => {
            this.messageBus.sendWithCallback('show-message-dialog', {
                message: message,
                buttons: buttons,
                defaultButton: defaultButton
            }, (result) => {
                logger.info(`[${this.pluginName}] メッセージダイアログコールバック実行:`, result);

                // Dialog result is wrapped in result.result
                const dialogResult = result.result || result;

                if (dialogResult.error) {
                    logger.warn(`[${this.pluginName}] Message dialog error:`, dialogResult.error);
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
        this.messageBus.send('toggle-maximize');
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
        const messageId = 'duplicate-' + Date.now() + '-' + Math.random().toString(36).substring(2, 11);

        this.messageBus.send('duplicate-real-object', {
            realId: sourceRealId,
            messageId: messageId
        });

        const result = await this.messageBus.waitFor('real-object-duplicated',
            window.DEFAULT_TIMEOUT_MS, (data) => data.messageId === messageId);

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
        this.messageBus.on('window-close-request', (data) => {
            logger.debug(`[${this.pluginName}] [MessageBus] window-close-request受信`);
            this.handleCloseRequest(data.windowId);
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

        logger.info(`[${this.pluginName}] 共通MessageBusハンドラ登録完了 (10件)`);

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

            if (result === 'cancel') {
                // 取消: クローズをキャンセル
                this.respondCloseRequest(windowId, false);
            } else if (result === 'no') {
                // 保存しない: そのままクローズ
                this.respondCloseRequest(windowId, true);
            } else if (result === 'yes') {
                // 保存: 保存してからクローズ
                await this.onSaveBeforeClose();
                this.isModified = false;
                this.respondCloseRequest(windowId, true);
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
            messageId: `copy-virtual-${Date.now()}-${Math.random()}`
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
            messageId: `delete-virtual-${Date.now()}-${Math.random()}`
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

        const messageId = `get-clipboard-${Date.now()}-${Math.random()}`;

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

            // 親ウィンドウ(tadjs-desktop.js)にファイル保存を依頼
            this.messageBus.send('save-image-file', {
                fileName: fileName,
                imageData: Array.from(bytes),
                mimeType: detectedMimeType
            });

            logger.debug(`[${this.pluginName}] 画像ファイル保存依頼:`, fileName);
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

            // 親ウィンドウ(tadjs-desktop.js)にファイル保存を依頼
            this.messageBus.send('save-image-file', {
                fileName: fileName,
                imageData: Array.from(buffer),
                mimeType: 'image/png'
            });

            logger.debug(`[${this.pluginName}] ピクセルマップ画像ファイル保存依頼:`, fileName);
        } catch (error) {
            logger.error(`[${this.pluginName}] ピクセルマップ画像ファイル保存エラー:`, error);
        }
    }

    /**
     * HTMLImageElementからPNG画像ファイルを保存
     * @param {HTMLImageElement} imageElement - 保存する画像要素
     * @param {string} fileName - 保存先ファイル名
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

            // 親ウィンドウ(tadjs-desktop.js)にファイル保存を依頼
            this.messageBus.send('save-image-file', {
                fileName: fileName,
                imageData: Array.from(buffer),
                mimeType: 'image/png'
            });

            logger.debug(`[${this.pluginName}] 画像ファイル保存依頼(Element):`, fileName);
        } catch (error) {
            logger.error(`[${this.pluginName}] 画像ファイル保存エラー(Element):`, error);
        }
    }
}
