import {
    DIALOG_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS,
    ERROR_CHECK_TIMEOUT_MS,
    DEFAULT_INPUT_WIDTH,
    DEFAULT_FONT_SIZE,
    DEFAULT_FONT_STYLE,
    DEFAULT_FONT_WEIGHT,
    DEFAULT_FONT_STRETCH,
    DEFAULT_LETTER_SPACING,
    DEFAULT_FRCOL,
    DEFAULT_CHCOL,
    DEFAULT_TBCOL,
    DEFAULT_BGCOL,
    DEFAULT_VOBJ_HEIGHT,
    escapeXml as escapeXmlUtil,
    unescapeXml as unescapeXmlUtil,
    rgbToHex as rgbToHexUtil
} from './util.js';
import { getLogger } from './logger.js';
import { throttle } from './performance-utils.js';
import { PaperSize, PaperMargin, PAPER_SIZES, getPaperSizeOptions, pointsToMm, mmToPoints } from './paper-size.js';

const logger = getLogger('PluginBase');

/**
 * テキストスタイル状態管理クラス
 * xmlTADの<font>/<text>タグの効果を段落間で維持するために使用
 */
export class TextStyleStateManager {
    constructor() {
        this.reset();
    }

    /**
     * 状態をデフォルト値にリセット
     */
    reset() {
        // フォント属性
        this.size = String(DEFAULT_FONT_SIZE);
        this.color = DEFAULT_CHCOL;
        this.face = '';
        this.style = DEFAULT_FONT_STYLE;
        this.weight = DEFAULT_FONT_WEIGHT;
        this.stretch = DEFAULT_FONT_STRETCH;
        // 文字送り属性
        this.direction = '0';          // 文字送り方向 (0:横, 1:縦)
        this.kerning = '0';            // カーニング (0:無効, 1:有効)
        this.pattern = '0';            // 文字送りパターン
        this.space = DEFAULT_LETTER_SPACING;  // 文字間隔
        // テキスト属性
        this.align = 'left';
        this.lineHeight = '1';         // 行の高さ
        this.textDirection = '0';      // テキスト方向 (0:横書き, 1:縦書き)
    }

    /**
     * 属性を更新
     * @param {string} attr - 属性名
     * @param {string} value - 値（空文字列はデフォルトにリセット）
     */
    update(attr, value) {
        const defaults = {
            size: String(DEFAULT_FONT_SIZE),
            color: DEFAULT_CHCOL,
            face: '',
            style: DEFAULT_FONT_STYLE,
            weight: DEFAULT_FONT_WEIGHT,
            stretch: DEFAULT_FONT_STRETCH,
            direction: '0',
            kerning: '0',
            pattern: '0',
            space: DEFAULT_LETTER_SPACING,
            align: 'left',
            lineHeight: '1',
            textDirection: '0'
        };

        if (value === '' || value === null || value === undefined) {
            this[attr] = defaults[attr];
        } else {
            this[attr] = value;
        }
    }

    /**
     * <font>タグから属性を更新
     * @param {Object} attrs - 属性オブジェクト { size, color, face, style, weight, stretch, direction, kerning, pattern, space }
     */
    updateFromFontTag(attrs) {
        if (attrs.size !== undefined) this.update('size', attrs.size);
        if (attrs.color !== undefined) this.update('color', attrs.color);
        if (attrs.face !== undefined) this.update('face', attrs.face);
        if (attrs.style !== undefined) this.update('style', attrs.style);
        if (attrs.weight !== undefined) this.update('weight', attrs.weight);
        if (attrs.stretch !== undefined) this.update('stretch', attrs.stretch);
        if (attrs.direction !== undefined) this.update('direction', attrs.direction);
        if (attrs.kerning !== undefined) this.update('kerning', attrs.kerning);
        if (attrs.pattern !== undefined) this.update('pattern', attrs.pattern);
        if (attrs.space !== undefined) this.update('space', attrs.space);
    }

    /**
     * <text>タグから属性を更新
     * @param {Object} attrs - 属性オブジェクト { align, 'line-height', direction }
     */
    updateFromTextTag(attrs) {
        if (attrs.align !== undefined) this.update('align', attrs.align);
        if (attrs['line-height'] !== undefined) this.update('lineHeight', attrs['line-height']);
        if (attrs.direction !== undefined) this.update('textDirection', attrs.direction);
    }

    /**
     * 現在のフォント状態をCSSスタイル文字列として取得
     * デフォルト値と異なる属性のみ出力
     * @returns {string} CSSスタイル文字列
     */
    toCssStyle() {
        let style = '';
        if (this.size !== String(DEFAULT_FONT_SIZE)) style += `font-size: ${this.size}pt;`;
        if (this.color !== DEFAULT_CHCOL) style += `color: ${this.color};`;
        if (this.face) style += `font-family: ${this.face};`;
        if (this.style !== DEFAULT_FONT_STYLE) style += `font-style: ${this.style};`;
        if (this.weight !== DEFAULT_FONT_WEIGHT) style += `font-weight: ${this.weight};`;
        if (this.stretch !== DEFAULT_FONT_STRETCH) style += `font-stretch: ${this.stretch};`;
        if (this.space !== DEFAULT_LETTER_SPACING) style += `letter-spacing: ${this.space}px;`;
        return style;
    }

    /**
     * 現在のテキスト揃えをCSSスタイル文字列として取得
     * @returns {string} CSSスタイル文字列
     */
    toAlignCssStyle() {
        if (this.align !== 'left') {
            return `text-align: ${this.align};`;
        }
        return '';
    }

    /**
     * デフォルト以外のスタイルがあるか確認
     * @returns {boolean} デフォルト以外のスタイルがあればtrue
     */
    hasNonDefaultStyle() {
        return this.size !== String(DEFAULT_FONT_SIZE) ||
               this.color !== DEFAULT_CHCOL ||
               this.face !== '' ||
               this.style !== DEFAULT_FONT_STYLE ||
               this.weight !== DEFAULT_FONT_WEIGHT ||
               this.stretch !== DEFAULT_FONT_STRETCH ||
               this.space !== DEFAULT_LETTER_SPACING;
    }

    /**
     * 現在の状態のコピーを作成
     * @returns {TextStyleStateManager} コピー
     */
    clone() {
        const copy = new TextStyleStateManager();
        copy.size = this.size;
        copy.color = this.color;
        copy.face = this.face;
        copy.style = this.style;
        copy.weight = this.weight;
        copy.stretch = this.stretch;
        copy.direction = this.direction;
        copy.kerning = this.kerning;
        copy.pattern = this.pattern;
        copy.space = this.space;
        copy.align = this.align;
        copy.lineHeight = this.lineHeight;
        copy.textDirection = this.textDirection;
        return copy;
    }
}

/**
 * リクエストキュー管理クラス
 * - 並列実行数の制限
 * - 処理開始時からのタイムアウト計算
 * - 同一キーのリクエスト重複防止
 */
class RequestQueueManager {
    constructor() {
        // 処理タイプ別のキュー
        // Map<string, { queue: Array, active: number, maxConcurrent: number }>
        this._queues = new Map();

        // 同一キーのリクエスト重複防止用
        // Map<string, Promise>
        this._pendingRequests = new Map();
    }

    /**
     * キュー設定を登録
     * @param {string} queueType - キュータイプ（例: 'load-data-file', 'load-real-object'）
     * @param {number} maxConcurrent - 最大同時実行数
     */
    registerQueue(queueType, maxConcurrent = 10) {
        this._queues.set(queueType, {
            queue: [],
            active: 0,
            maxConcurrent: maxConcurrent
        });
    }

    /**
     * リクエストをキューに追加して実行
     * @param {string} queueType - キュータイプ
     * @param {string} requestKey - リクエストの一意キー（重複防止用、nullで重複防止無効）
     * @param {Function} requestFn - 実行する非同期関数
     * @param {number} timeout - タイムアウト（ms）
     * @returns {Promise} 処理結果
     */
    async enqueue(queueType, requestKey, requestFn, timeout) {
        // 同一キーのリクエストが実行中なら、そのPromiseを返す（重複防止）
        if (requestKey && this._pendingRequests.has(requestKey)) {
            return this._pendingRequests.get(requestKey);
        }

        const queueInfo = this._queues.get(queueType);
        if (!queueInfo) {
            // 未登録のキュータイプは直接実行
            return this._executeWithTimeout(requestFn, timeout);
        }

        // Promiseを作成してキューに追加
        let resolvePromise, rejectPromise;
        const promise = new Promise((resolve, reject) => {
            resolvePromise = resolve;
            rejectPromise = reject;
        });

        queueInfo.queue.push({
            requestFn,
            timeout,
            resolve: resolvePromise,
            reject: rejectPromise
        });

        // 重複防止マップに登録
        if (requestKey) {
            this._pendingRequests.set(requestKey, promise);
            promise.finally(() => {
                this._pendingRequests.delete(requestKey);
            });
        }

        // キュー処理を開始
        this._processQueue(queueType);

        return promise;
    }

    /**
     * キューから次のリクエストを処理
     * @private
     */
    _processQueue(queueType) {
        const queueInfo = this._queues.get(queueType);
        if (!queueInfo) return;

        // 最大同時実行数に達している場合は待機
        while (queueInfo.active < queueInfo.maxConcurrent && queueInfo.queue.length > 0) {
            const request = queueInfo.queue.shift();
            queueInfo.active++;

            // 処理開始時からタイムアウトを計算
            this._executeWithTimeout(request.requestFn, request.timeout)
                .then(request.resolve)
                .catch(request.reject)
                .finally(() => {
                    queueInfo.active--;
                    this._processQueue(queueType);
                });
        }
    }

    /**
     * タイムアウト付きで関数を実行
     * @private
     */
    async _executeWithTimeout(fn, timeout) {
        if (!timeout || timeout <= 0) {
            return fn();
        }

        return Promise.race([
            fn(),
            new Promise((_, reject) => {
                setTimeout(() => {
                    reject(new Error(`Request timeout after ${timeout}ms`));
                }, timeout);
            })
        ]);
    }
}

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
        this.bgColor = DEFAULT_BGCOL;  // 背景色（デフォルト白）
        this.debug = window.TADjsConfig?.debug || false;

        // リクエストキューマネージャー初期化
        this._requestQueueManager = new RequestQueueManager();
        this._requestQueueManager.registerQueue('load-data-file', 10);
        this._requestQueueManager.registerQueue('load-real-object', 10);

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

        // 範囲選択（矩形選択）共通状態管理
        this.rangeSelectionState = {
            isActive: false,       // 範囲選択中フラグ
            startX: 0,             // 開始X座標（コンテナ相対）
            startY: 0,             // 開始Y座標（コンテナ相対）
            endX: 0,               // 終了X座標（コンテナ相対）
            endY: 0,               // 終了Y座標（コンテナ相対）
            element: null,         // 選択枠DOM要素
            container: null        // 選択枠を配置するコンテナ
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

        // コンテキストメニュー表示時のマウス位置（貼り付け位置に使用）
        this.lastContextMenuPosition = { x: 0, y: 0 };

        // ファイルデータ（initハンドラで設定）
        this.fileData = null;

        // 用紙サイズ設定
        this.paperSize = null;    // PaperSizeインスタンス
        this.paperMargin = null;  // PaperMarginインスタンス

        // ドキュメントスケール設定（<docScale>要素から読み込み）
        this.docScale = {
            hunit: -72,  // 水平方向スケール単位（UNITS型、デフォルト: -72 = 72DPI）
            vunit: -72   // 垂直方向スケール単位（UNITS型、デフォルト: -72 = 72DPI）
        };

        // ドキュメントテキスト設定（<text>要素から読み込み、将来拡張用）
        this.docText = {
            lang: 0,     // 言語コード
            bpat: 0      // 背景パターン
        };

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

        // スクロールバー幅のCSS変数をiframe内に設定
        // 親ウィンドウのカスタムスクロールバー領域を避けるために使用
        this._initScrollbarWidthVariable();
    }

    /**
     * スクロールバー幅のCSS変数をiframe内に設定
     * localStorageから読み取り、--scrollbar-width変数を設定
     * @private
     */
    _initScrollbarWidthVariable() {
        try {
            const scrollbarWidth = localStorage.getItem('scrollbar-width') || '12';
            document.documentElement.style.setProperty('--scrollbar-width', scrollbarWidth + 'px');
            logger.debug(`[${this.pluginName}] Scrollbar width CSS variable set: ${scrollbarWidth}px`);
        } catch (error) {
            // localStorageアクセスエラー時はデフォルト値を使用
            document.documentElement.style.setProperty('--scrollbar-width', '12px');
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
        return this._requestQueueManager.enqueue(
            'load-data-file',
            `load-data-file:${fileName}`,  // 同一ファイルの重複リクエスト防止
            async () => {
                const messageId = this.generateMessageId('load');

                if (this.messageBus) {
                    this.messageBus.send('load-data-file-request', {
                        messageId: messageId,
                        fileName: fileName
                    });
                } else {
                    throw new Error('MessageBusが初期化されていません');
                }

                // タイムアウトはキューマネージャーで管理するため、waitForは無限待機
                const result = await this.messageBus.waitFor('load-data-file-response', 0, (data) => {
                    return data.messageId === messageId;
                });
                if (result.success) {
                    return result.data;
                } else {
                    throw new Error(result.error || 'ファイル読み込み失敗');
                }
            },
            DEFAULT_TIMEOUT_MS
        );
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

                    // 実身名とlink_nameの同期: JSON.nameが存在し異なる場合はJSON.nameを優先
                    if (jsonData.name && virtualObj.link_name !== jsonData.name) {
                        virtualObj.link_name = jsonData.name;
                    }

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

                // 実身名とlink_nameの同期: JSON.nameが存在し異なる場合はJSON.nameを優先
                if (jsonData.name && virtualObj.link_name !== jsonData.name) {
                    virtualObj.link_name = jsonData.name;
                }

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
     * 実身データを読み込む（キュー管理・重複防止付き）
     * @param {string} realId - 実身ID
     * @returns {Promise<Object>} 実身データ
     */
    async loadRealObjectData(realId) {
        return this._requestQueueManager.enqueue(
            'load-real-object',
            `load-real-object:${realId}`,  // 同一realIdの重複リクエスト防止
            async () => {
                const messageId = this.generateMessageId('load-real');

                // 親ウィンドウに実身データ読み込みを要求
                this.messageBus.send('load-real-object', {
                    realId: realId,
                    messageId: messageId
                });

                try {
                    // タイムアウトはキューマネージャーで管理するため、waitForは無限待機
                    const result = await this.messageBus.waitFor('real-object-loaded', 0, (data) => {
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
                        throw error;
                    }
                }
            },
            DEFAULT_TIMEOUT_MS
        );
    }

    /**
     * 実身のxmlTADを読み込み
     * @param {string} realId - 実身ID
     * @returns {Promise<string|null>} xmlTAD文字列（読み込み失敗時はnull）
     */
    async loadRealObjectXtad(realId) {
        try {
            const realObject = await this.loadRealObjectData(realId);
            if (realObject?.records?.[0]) {
                return realObject.records[0].xtad || realObject.records[0].data || null;
            }
            return null;
        } catch (error) {
            return null;
        }
    }

    // ========================================
    // 開いた仮身のコンテンツ展開
    // ========================================

    /**
     * 仮身のdefaultOpenプラグインを取得
     * @param {Object} virtualObject - 仮身オブジェクト
     * @returns {string|null} プラグインID or null
     */
    getDefaultOpenPlugin(virtualObject) {
        const applist = virtualObject.applist || {};
        for (const [pluginId, config] of Object.entries(applist)) {
            if (config && config.defaultOpen === true) {
                return pluginId;
            }
        }
        return null;
    }

    /**
     * 開いた仮身のコンテンツ領域にプラグインを展開
     * VirtualObjectRenderer.createOpenedBlockElement()で作成された
     * コンテンツ領域にiframeを作成してプラグインをロードする
     *
     * @param {HTMLElement} vobjElement - 仮身のDOM要素（virtual-object-openedクラスを持つ）
     * @param {Object} virtualObject - 仮身オブジェクト
     * @param {Object} options - オプション
     * @param {boolean} [options.readonly=true] - 読み取り専用モード
     * @param {boolean} [options.noScrollbar=true] - スクロールバー非表示
     * @param {string} [options.bgcol] - 背景色（指定しない場合はvirtualObject.bgcolを使用）
     * @returns {Promise<HTMLIFrameElement|null>} 作成したiframe or null
     */
    async expandVirtualObject(vobjElement, virtualObject, options = {}) {
        logger.debug(`[${this.pluginName}] 開いた仮身の展開開始:`, virtualObject.link_name);

        try {
            // 実身IDを抽出
            const realId = window.RealObjectSystem.extractRealId(virtualObject.link_id);
            logger.debug(`[${this.pluginName}] 実身ID:`, realId);

            // applistがない場合はメタデータを読み込む
            if (!virtualObject.applist || Object.keys(virtualObject.applist).length === 0) {
                logger.debug(`[${this.pluginName}] applistがないためメタデータを読み込み:`, virtualObject.link_name);
                await this.loadVirtualObjectMetadata(virtualObject);
            }

            // defaultOpenプラグインを取得
            const defaultOpenPlugin = this.getDefaultOpenPlugin(virtualObject);
            if (!defaultOpenPlugin) {
                logger.warn(`[${this.pluginName}] defaultOpenプラグインが見つかりません:`, virtualObject.link_name);
                return null;
            }
            logger.debug(`[${this.pluginName}] defaultOpenプラグイン:`, defaultOpenPlugin);

            // 実身データを読み込む
            const realObjectData = await this.loadRealObjectData(realId);
            if (!realObjectData) {
                logger.warn(`[${this.pluginName}] 実身データの読み込みに失敗:`, realId);
                return null;
            }
            logger.debug(`[${this.pluginName}] 実身データ読み込み完了`);

            // await後にvobjElementがまだDOMに接続されているか確認
            if (!vobjElement.isConnected) {
                logger.warn(`[${this.pluginName}] 展開処理中に仮身要素がDOMから削除されました:`, virtualObject.link_name);
                return null;
            }

            // コンテンツ領域を取得
            const contentArea = vobjElement.querySelector('.virtual-object-content-area');
            if (!contentArea) {
                logger.error(`[${this.pluginName}] コンテンツ領域が見つかりません`);
                return null;
            }

            // コンテンツ領域のスクロールバーを非表示（noScrollbarオプション対応）
            if (options.noScrollbar !== false) {
                contentArea.style.overflow = 'hidden';
            }

            // 仮身の色属性を取得
            const bgcol = options.bgcol || virtualObject.bgcol || DEFAULT_BGCOL;

            // iframeを作成
            const iframe = document.createElement('iframe');
            iframe.className = 'virtual-object-content';
            iframe.style.width = '100%';
            iframe.style.height = '100%';
            iframe.style.border = 'none';
            iframe.style.overflow = 'hidden';
            iframe.style.padding = '0';
            iframe.style.backgroundColor = bgcol;
            iframe.style.userSelect = 'none';
            iframe.style.pointerEvents = 'none'; // 開いた仮身内の操作を無効化（表示のみ）

            // プラグインをロード
            iframe.src = `../../plugins/${defaultOpenPlugin}/index.html`;

            // iframeロード後にデータを送信
            iframe.addEventListener('load', () => {
                logger.debug(`[${this.pluginName}] iframe読み込み完了、load-virtual-objectメッセージ送信`);
                iframe.contentWindow.postMessage({
                    type: 'load-virtual-object',
                    virtualObj: virtualObject,
                    realObject: realObjectData,
                    bgcol: bgcol,
                    readonly: options.readonly !== false,
                    noScrollbar: options.noScrollbar !== false
                }, '*');
            });

            contentArea.appendChild(iframe);
            logger.debug(`[${this.pluginName}] iframe追加完了`);

            return iframe;
        } catch (error) {
            logger.error(`[${this.pluginName}] expandVirtualObject エラー:`, error);
            return null;
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
                logger.debug(`[${this.pluginName}] 保存確認ダイアログコールバック実行:`, response);

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
                logger.debug(`[${this.pluginName}] ボタンが押されました, value:`, dialogResult);
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
                logger.debug(`[${this.pluginName}] 入力ダイアログコールバック実行:`, result);

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
                    logger.debug(`[${this.pluginName}] キャンセルされました`);
                    resolve(null);
                } else {
                    logger.debug(`[${this.pluginName}] 設定ボタンが押されました, value:`, dialogResult.value);
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
                logger.debug(`[${this.pluginName}] メッセージダイアログコールバック実行:`, result);

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

                logger.debug(`[${this.pluginName}] ボタンが押されました:`, dialogResult);
                resolve(dialogResult);
            }, DIALOG_TIMEOUT_MS);
        });
    }

    /**
     * カスタムダイアログを表示
     * ユーザー操作を待つダイアログなので、タイムアウトを無限（0）に設定
     * @param {Object} options - ダイアログオプション
     * @param {string} options.title - ダイアログタイトル（オプション）
     * @param {string} options.dialogHtml - ダイアログ本体のHTML
     * @param {Array} options.buttons - ボタン定義 [{label, value}]
     * @param {number} options.defaultButton - デフォルトボタンインデックス
     * @param {Object} options.inputs - 入力要素のID指定（オプション）
     * @param {Object} options.radios - ラジオボタンのname指定（オプション）
     * @param {number} options.width - ダイアログ幅（オプション）
     * @returns {Promise<Object|null>} ダイアログ結果またはnull（エラー/キャンセル時）
     */
    async showCustomDialog(options) {
        // ユーザー操作を待つダイアログなので、タイムアウトを無効化（0に設定）
        // ボタンが押されるまで無期限に待機する（showInputDialogと同じパターン）
        const CUSTOM_DIALOG_TIMEOUT_MS = 0;

        const dialogData = {
            title: options.title || '',
            dialogHtml: options.dialogHtml,
            buttons: options.buttons || [{ label: 'OK', value: 'ok' }],
            defaultButton: options.defaultButton ?? 0,
            inputs: options.inputs || {},
            radios: options.radios || {}
        };

        // オプションのwidth指定があれば追加
        if (options.width) {
            dialogData.width = options.width;
        }

        return new Promise((resolve) => {
            this.messageBus.sendWithCallback('show-custom-dialog', dialogData, (result) => {
                logger.debug(`[${this.pluginName}] カスタムダイアログコールバック実行:`, result);

                // null/undefinedチェック（タイムアウト等の異常時対応）
                if (result == null) {
                    logger.warn(`[${this.pluginName}] Custom dialog: resultがnull/undefined`);
                    resolve(null);
                    return;
                }

                // result.result のアンラップ
                const dialogResult = result.result ?? result;

                // エラーチェック
                if (dialogResult == null || dialogResult.error) {
                    logger.warn(`[${this.pluginName}] Custom dialog error:`, dialogResult?.error);
                    resolve(null);
                    return;
                }

                logger.debug(`[${this.pluginName}] カスタムダイアログ結果:`, dialogResult);
                resolve(dialogResult);
            }, CUSTOM_DIALOG_TIMEOUT_MS);
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

        // 成功した場合、同一realIdを持つ全仮身を更新し、フックを呼び出す
        if (result && result.success && this.contextMenuVirtualObject?.virtualObj) {
            const virtualObj = this.contextMenuVirtualObject.virtualObj;
            // result.realIdを使用（非同期操作中にcontextMenuVirtualObjectが変わる可能性があるため）
            const realId = result.realId;

            // 同一realIdを持つ全仮身のlink_nameを更新し、表示を更新
            if (realId) {
                await this.updateAllVirtualObjectsWithRealId(realId, result.newName);
            }

            // プラグイン固有の再描画処理を呼び出す（互換性維持）
            await this.onRealObjectRenamed(virtualObj, result);
        }

        return result;
    }

    /**
     * 選択中の仮身が指し示す実身を複製
     * @returns {Promise<Object>} 複製結果 { success: boolean, newRealId?: string, newName?: string }
     */
    async duplicateRealObject() {
        const result = await window.RealObjectSystem.duplicateRealObject(this);

        // 成功した場合、フックを呼び出す
        if (result && result.success && this.contextMenuVirtualObject?.virtualObj) {
            const originalVirtualObj = this.contextMenuVirtualObject.virtualObj;
            await this.onRealObjectDuplicated(originalVirtualObj, result);
        }

        return result;
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
     * @returns {Promise<Object>} { success: boolean, relationship?: string[], linkRelationship?: string[], cancelled?: boolean }
     */
    async setRelationship() {
        const result = await window.RealObjectSystem.setRelationship(this);

        // 成功した場合、メモリ上のmetadata.relationshipとlinkRelationshipを更新し、フックを呼び出す
        if (result && result.success && this.contextMenuVirtualObject?.virtualObj) {
            const virtualObj = this.contextMenuVirtualObject.virtualObj;

            // メタデータがなければ作成
            if (!virtualObj.metadata) {
                virtualObj.metadata = {};
            }
            virtualObj.metadata.relationship = result.relationship || [];

            // 仮身固有の続柄を更新
            virtualObj.linkRelationship = result.linkRelationship || [];

            // XML保存フックを呼び出し（完了を待つ）
            await this.saveVirtualObjectRelationshipToXml(virtualObj);

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
     * @param {Object} result - setRelationshipの結果 { success: true, relationship: string[], linkRelationship: string[] }
     */
    onRelationshipUpdated(virtualObj, result) {
        // デフォルト実装: 何もしない
        // サブクラスで再描画処理をオーバーライド
    }

    /**
     * 仮身の続柄をXMLに保存するフック（サブクラスでオーバーライド可能）
     * setRelationship()成功後、onRelationshipUpdated()の前に呼ばれる
     *
     * プラグインはこのメソッドをオーバーライドして、
     * updateVirtualObjectInXml(virtualObj)を呼び出す
     *
     * @param {Object} virtualObj - 更新された仮身オブジェクト（linkRelationshipプロパティを含む）
     * @returns {Promise<void>}
     */
    async saveVirtualObjectRelationshipToXml(virtualObj) {
        // デフォルト実装: 何もしない
        // サブクラスでupdateVirtualObjectInXml()呼び出しをオーバーライド
    }

    /**
     * 続柄入力文字列をパースしてJSON用とlink属性用に分離
     * [タグ] 形式は実身JSON用、それ以外はlink属性用
     * @param {string} input - 入力文字列（例: "[親1] [親2] 子1 子2"）
     * @returns {{jsonRelationship: string[], linkRelationship: string[]}}
     */
    parseRelationshipInput(input) {
        if (!input || typeof input !== 'string') {
            return { jsonRelationship: [], linkRelationship: [] };
        }

        const jsonRelationship = [];
        const linkRelationship = [];

        // [タグ] 形式を抽出（括弧内にスペースがあっても1つのタグとして扱う）
        const bracketPattern = /\[([^\]]+)\]/g;
        let match;
        let lastIndex = 0;
        const remainingParts = [];

        // 入力文字列を走査
        let tempInput = input;
        while ((match = bracketPattern.exec(input)) !== null) {
            // 括弧の前のテキストを保存
            if (match.index > lastIndex) {
                remainingParts.push(input.substring(lastIndex, match.index));
            }
            // 括弧内のタグをJSON用に追加
            const tag = match[1].trim();
            if (tag) {
                jsonRelationship.push(tag);
            }
            lastIndex = match.index + match[0].length;
        }

        // 残りのテキストを保存
        if (lastIndex < input.length) {
            remainingParts.push(input.substring(lastIndex));
        }

        // 残りのテキストをスペース区切りでlink属性用に分割
        const remainingText = remainingParts.join('').trim();
        if (remainingText) {
            const tags = remainingText.split(/\s+/).filter(s => s.trim() !== '');
            linkRelationship.push(...tags);
        }

        return { jsonRelationship, linkRelationship };
    }

    /**
     * 続柄を表示用文字列にフォーマット
     * JSON用は[タグ]形式、link用はそのまま表示
     * @param {string[]} jsonRelationship - 実身JSON用の続柄配列
     * @param {string[]} linkRelationship - link属性用の続柄配列
     * @returns {string} 表示用文字列
     */
    formatRelationshipForDisplay(jsonRelationship, linkRelationship) {
        const parts = [];

        // JSON用は[タグ]形式で表示
        if (jsonRelationship && jsonRelationship.length > 0) {
            for (const tag of jsonRelationship) {
                parts.push(`[${tag}]`);
            }
        }

        // link用はそのまま表示
        if (linkRelationship && linkRelationship.length > 0) {
            parts.push(...linkRelationship);
        }

        return parts.join(' ');
    }

    /**
     * link要素からrelationship属性をパース
     * @param {Element} linkElement - DOM link要素
     * @returns {string[]} 続柄配列（スペース区切りを配列化）
     */
    parseLinkRelationship(linkElement) {
        if (!linkElement) return [];

        const relationshipAttr = linkElement.getAttribute('relationship');
        if (!relationshipAttr || relationshipAttr.trim() === '') {
            return [];
        }

        return relationshipAttr.split(/\s+/).filter(s => s.trim() !== '');
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
     * プラグイン内の全仮身を取得（サブクラスでオーバーライド必須）
     * updateAllVirtualObjectsWithRealIdから呼ばれる
     *
     * @returns {Array<Object>} 仮身情報の配列 [{ virtualObj, element?, shape?, ... }, ...]
     */
    getAllVirtualObjects() {
        // デフォルト実装: 空配列を返す
        // サブクラスで実装すること
        return [];
    }

    /**
     * 仮身の表示を更新（サブクラスでオーバーライド必須）
     * updateAllVirtualObjectsWithRealIdから呼ばれる
     *
     * @param {Object} item - getAllVirtualObjectsで返された仮身情報
     */
    async updateVirtualObjectDisplay(item) {
        // デフォルト実装: 何もしない
        // サブクラスで実装すること
    }

    /**
     * 同一realIdを持つ全仮身のlink_nameを更新し、表示を更新
     *
     * @param {string} realId - 対象の実身ID
     * @param {string} newName - 新しい実身名
     */
    async updateAllVirtualObjectsWithRealId(realId, newName) {
        const allVirtualObjects = this.getAllVirtualObjects();

        // 同一realIdを持つ仮身をフィルタ
        const matchingObjects = allVirtualObjects.filter(item => {
            if (!item.virtualObj || !item.virtualObj.link_id) {
                return false;
            }
            const itemRealId = window.RealObjectSystem.extractRealId(item.virtualObj.link_id);
            return itemRealId === realId;
        });

        // 各仮身のlink_nameを更新し、表示を更新
        for (const item of matchingObjects) {
            item.virtualObj.link_name = newName;
            await this.updateVirtualObjectDisplay(item);
        }
    }

    /**
     * 実身複製後のフック（サブクラスでオーバーライド可能）
     * duplicateRealObject()成功後に呼ばれる。複製した仮身の追加などに使用
     *
     * @param {Object} originalVirtualObj - 元の仮身オブジェクト
     * @param {Object} result - duplicateRealObjectの結果 { success: true, newRealId: string, newName: string }
     */
    async onRealObjectDuplicated(originalVirtualObj, result) {
        // デフォルト実装: 何もしない
        // サブクラスで複製した仮身の追加処理をオーバーライド
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

    /**
     * 指定座標にコンテキストメニューを表示
     * iframe座標を親ウィンドウ座標に変換して送信
     *
     * @param {number} x - X座標（iframe内ビューポート座標）
     * @param {number} y - Y座標（iframe内ビューポート座標）
     */
    showContextMenu(x, y) {
        const rect = window.frameElement?.getBoundingClientRect() || { left: 0, top: 0 };
        this.requestContextMenu(rect.left + x, rect.top + y);
    }

    /**
     * マウスイベントからコンテキストメニューを表示
     * イベントのclientX/clientYを親ウィンドウ座標に変換して送信
     *
     * @param {MouseEvent} e - contextmenuイベント
     */
    showContextMenuAtEvent(e) {
        // 貼り付け位置として使用するためマウス位置を保存
        this.lastContextMenuPosition = { x: e.clientX, y: e.clientY };
        this.showContextMenu(e.clientX, e.clientY);
    }

    /**
     * 最後のコンテキストメニュー表示位置を取得
     * 貼り付け操作時に使用
     *
     * @returns {{x: number, y: number}} マウス座標
     */
    getLastContextMenuPosition() {
        return this.lastContextMenuPosition;
    }

    // ========================================
    // 座標変換（共通）
    // ========================================

    /**
     * 座標変換を適用
     * 変形順序: 傾斜(vangle) → 回転(hangle) → 移動(dh,dv)
     *
     * @param {number} x 元のX座標
     * @param {number} y 元のY座標
     * @param {Object} transform 変換パラメータ
     * @param {number} transform.dh 水平移動量
     * @param {number} transform.dv 垂直移動量
     * @param {number} transform.hangle 回転角度（度）
     * @param {number} transform.vangle 傾斜角度（度）
     * @returns {{x: number, y: number}} 変換後の座標
     */
    applyCoordinateTransform(x, y, transform) {
        let newX = x;
        let newY = y;

        // 1. 傾斜処理（vangle）
        if (transform.vangle && transform.vangle !== 0) {
            const vangleRad = transform.vangle * Math.PI / 180;
            const shear = Math.tan(vangleRad);
            newX = newX + newY * shear;
        }

        // 2. 回転処理（hangle）
        if (transform.hangle && transform.hangle !== 0) {
            const hangleRad = transform.hangle * Math.PI / 180;
            const cos = Math.cos(hangleRad);
            const sin = Math.sin(hangleRad);
            const rotatedX = newX * cos - newY * sin;
            const rotatedY = newX * sin + newY * cos;
            newX = rotatedX;
            newY = rotatedY;
        }

        // 3. 移動処理（dh, dv）
        newX += transform.dh || 0;
        newY += transform.dv || 0;

        return { x: Math.round(newX), y: Math.round(newY) };
    }

    /**
     * 座標配列に変換を適用
     * @param {Array} points [[x1,y1], [x2,y2], ...] 形式
     * @param {Object} transform 変換パラメータ
     * @returns {Array} 変換後の座標配列
     */
    applyCoordinateTransformToPoints(points, transform) {
        return points.map(point => {
            const transformed = this.applyCoordinateTransform(point[0], point[1], transform);
            return [transformed.x, transformed.y];
        });
    }

    // ========================================
    // 範囲選択（矩形選択）
    // ========================================

    /**
     * 範囲選択を開始
     * マウスダウン時に呼び出し、選択枠DOM要素を作成
     * @param {HTMLElement} container - 選択枠を配置するコンテナ要素
     * @param {number} x - 開始X座標（コンテナ相対）
     * @param {number} y - 開始Y座標（コンテナ相対）
     */
    startRangeSelection(container, x, y) {
        // 既存の選択枠があれば削除
        this.endRangeSelection();

        // 状態を初期化
        this.rangeSelectionState.isActive = true;
        this.rangeSelectionState.container = container;
        this.rangeSelectionState.startX = x;
        this.rangeSelectionState.startY = y;
        this.rangeSelectionState.endX = x;
        this.rangeSelectionState.endY = y;

        // DOM要素を作成
        const rect = document.createElement('div');
        rect.className = 'range-selection-rect';
        rect.style.left = `${x}px`;
        rect.style.top = `${y}px`;
        rect.style.width = '0px';
        rect.style.height = '0px';
        container.appendChild(rect);
        this.rangeSelectionState.element = rect;
    }

    /**
     * 範囲選択位置を更新
     * マウスムーブ時に呼び出し、選択枠のサイズと位置を更新
     * @param {number} x - 現在のX座標（コンテナ相対）
     * @param {number} y - 現在のY座標（コンテナ相対）
     */
    updateRangeSelection(x, y) {
        if (!this.rangeSelectionState.isActive) return;

        this.rangeSelectionState.endX = x;
        this.rangeSelectionState.endY = y;

        const bounds = this.getRangeSelectionBounds();
        const element = this.rangeSelectionState.element;
        if (element) {
            element.style.left = `${bounds.left}px`;
            element.style.top = `${bounds.top}px`;
            element.style.width = `${bounds.width}px`;
            element.style.height = `${bounds.height}px`;
        }
    }

    /**
     * 範囲選択を終了
     * マウスアップ時に呼び出し、選択枠DOM要素を削除
     */
    endRangeSelection() {
        if (this.rangeSelectionState.element) {
            this.rangeSelectionState.element.remove();
            this.rangeSelectionState.element = null;
        }
        this.rangeSelectionState.isActive = false;
        this.rangeSelectionState.container = null;
    }

    /**
     * 範囲選択の正規化された座標を取得
     * 開始点と終了点を正規化し、left/top/right/bottom/width/heightを返す
     * @returns {Object} { left, top, right, bottom, width, height }
     */
    getRangeSelectionBounds() {
        const { startX, startY, endX, endY } = this.rangeSelectionState;
        return {
            left: Math.min(startX, endX),
            top: Math.min(startY, endY),
            right: Math.max(startX, endX),
            bottom: Math.max(startY, endY),
            width: Math.abs(endX - startX),
            height: Math.abs(endY - startY)
        };
    }

    /**
     * 指定した矩形が範囲選択と交差するか判定
     * 部分的に含まれていればtrueを返す
     * @param {number} left - 判定対象の左座標
     * @param {number} top - 判定対象の上座標
     * @param {number} right - 判定対象の右座標
     * @param {number} bottom - 判定対象の下座標
     * @returns {boolean} 交差している場合true
     */
    isRectInRangeSelection(left, top, right, bottom) {
        if (!this.rangeSelectionState.isActive) return false;

        const bounds = this.getRangeSelectionBounds();

        // 矩形の交差判定（部分的に含まれていればtrue）
        return !(right < bounds.left ||
                 left > bounds.right ||
                 bottom < bounds.top ||
                 top > bounds.bottom);
    }

    // ========================================
    // 用紙サイズ関連
    // ========================================

    /**
     * XML<paper>要素を解析してpaperSize/paperMarginを設定
     * @param {Element} element - paper要素
     */
    parsePaperElement(element) {
        if (!element) return;

        // マージン属性がある場合はPaperMarginとして解析
        if (element.hasAttribute('margintop')) {
            if (!this.paperMargin) {
                this.paperMargin = new PaperMargin();
            }
            this.paperMargin.parseFromElement(element);
        } else {
            // 用紙サイズ属性がある場合はPaperSizeとして解析
            if (element.hasAttribute('length') || element.hasAttribute('width')) {
                if (!this.paperSize) {
                    this.paperSize = new PaperSize();
                }
                this.paperSize.parseFromElement(element);
            }
        }
    }

    /**
     * 用紙サイズをmm単位で取得
     * @returns {{width: number, height: number}} mm単位の幅と高さ
     */
    getPaperSizeInMm() {
        if (this.paperSize) {
            return {
                width: this.paperSize.widthMm,
                height: this.paperSize.lengthMm
            };
        }
        // デフォルトはA4
        return { width: 210, height: 297 };
    }

    /**
     * 用紙サイズを初期化（A4デフォルト）
     */
    initPaperSize() {
        this.paperSize = new PaperSize();
    }

    /**
     * 用紙サイズ選択肢リストを取得
     * @returns {Array} [{key, name, widthMm, lengthMm, label}, ...]
     */
    getPaperSizeOptions() {
        return getPaperSizeOptions();
    }

    /**
     * ポイントをmmに変換
     * @param {number} points - ポイント値
     * @returns {number} mm値
     */
    pointsToMm(points) {
        return pointsToMm(points);
    }

    /**
     * mmをポイントに変換
     * @param {number} mm - mm値
     * @returns {number} ポイント値
     */
    mmToPoints(mm) {
        return mmToPoints(mm);
    }

    // ========================================
    // docScale/docText関連（ドキュメント設定）
    // ========================================

    /**
     * <docScale>要素をパース
     * @param {Element} docScaleElement - docScale要素
     * @returns {{ hunit: number, vunit: number }}
     */
    parseDocScaleElement(docScaleElement) {
        if (!docScaleElement) return { hunit: -72, vunit: -72 };

        return {
            hunit: parseInt(docScaleElement.getAttribute('hunit'), 10) || -72,
            vunit: parseInt(docScaleElement.getAttribute('vunit'), 10) || -72
        };
    }

    /**
     * <text>要素（文書設定用）をパース
     * lang/bpat属性を持つtext要素のみ対象（位置指定用textは除外）
     * @param {Element} textElement - text要素（docScale直後のもの）
     * @returns {{ lang: number, bpat: number }}
     */
    parseDocTextElement(textElement) {
        if (!textElement) return { lang: 0, bpat: 0 };

        // lang属性を持つtext要素のみ対象
        if (!textElement.hasAttribute('lang')) return { lang: 0, bpat: 0 };

        return {
            lang: parseInt(textElement.getAttribute('lang'), 10) || 0,
            bpat: parseInt(textElement.getAttribute('bpat'), 10) || 0
        };
    }

    /**
     * <document>要素からスケール単位を取得
     * @param {Element} documentElement - document要素
     * @returns {{ hunit: number, vunit: number }}
     */
    parseDocumentUnits(documentElement) {
        if (!documentElement) return { hunit: -72, vunit: -72 };

        // <docScale>子要素から取得（小文字で検索）
        const docScale = documentElement.querySelector('docscale');
        if (docScale) {
            return this.parseDocScaleElement(docScale);
        }

        // 見つからない場合はデフォルト値
        return { hunit: -72, vunit: -72 };
    }

    /**
     * <document>要素から文書設定を取得
     * @param {Element} documentElement - document要素
     * @returns {{ lang: number, bpat: number }}
     */
    parseDocumentText(documentElement) {
        if (!documentElement) return { lang: 0, bpat: 0 };

        // lang属性を持つ<text>要素を探す（小文字で検索）
        const textElements = documentElement.querySelectorAll('text');
        for (const textElem of textElements) {
            if (textElem.hasAttribute('lang')) {
                return this.parseDocTextElement(textElem);
            }
        }

        return { lang: 0, bpat: 0 };
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

        // スクロールコンテナをキャッシュ（onInit()での初期送信用）
        this._scrollContainer = container;

        // スクロールイベントをthrottle（16ms ≒ 60fps）
        const throttledHandler = throttle(() => {
            this._sendScrollState(container);
        }, 16);

        container.addEventListener('scroll', throttledHandler);

        this._scrollNotificationEnabled = true;

        // 既にwindowIdが設定されている場合は即座に送信
        // （通常はonInit()で送信されるため、ここでは既存windowIdがある場合のみ）
        if (this.windowId) {
            this._sendScrollState(container);
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

        // 既存のObserverを切断（再初期化対策）
        if (this._scrollbarResizeObserver) {
            this._scrollbarResizeObserver.disconnect();
        }
        if (this._scrollbarMutationObserver) {
            this._scrollbarMutationObserver.disconnect();
        }

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
        this._scrollbarResizeObserver = new ResizeObserver(() => {
            this._updateScrollbarVisibility(container, 'vertical');
            this._updateScrollbarVisibility(container, 'horizontal');
            this._updateScrollbarThumbPosition(container, 'vertical');
            this._updateScrollbarThumbPosition(container, 'horizontal');
        });
        this._scrollbarResizeObserver.observe(container);

        // MutationObserverでコンテンツ変更・属性変更を監視
        this._scrollbarMutationObserver = new MutationObserver(() => {
            // レイアウト再計算を待ってから更新
            requestAnimationFrame(() => {
                this._updateScrollbarVisibility(container, 'vertical');
                this._updateScrollbarVisibility(container, 'horizontal');
                this._updateScrollbarThumbPosition(container, 'vertical');
                this._updateScrollbarThumbPosition(container, 'horizontal');
            });
        });
        // childList: コンテンツ追加/削除, attributes: class変更（タブ切替）, subtree: 子孫要素も監視
        this._scrollbarMutationObserver.observe(container, {
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

            // コンテキストメニュー要求を送信（共通メソッドを使用）
            this.showContextMenuAtEvent(e);
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
     * 図形グループをグローバルクリップボードに設定
     * @param {Object} group - 図形グループオブジェクト
     * @param {string} group.type - 'group'
     * @param {Array} group.shapes - 子図形配列
     * @param {number} group.startX - 左座標
     * @param {number} group.startY - 上座標
     * @param {number} group.endX - 右座標
     * @param {number} group.endY - 下座標
     */
    setGroupClipboard(group) {
        if (!group || group.type !== 'group') {
            logger.error(`[${this.pluginName}] setGroupClipboard: 無効なグループ`);
            return;
        }

        this.setClipboard({
            type: 'group',
            group: group
        });
    }

    /**
     * 図形セグメントをクリップボードに設定（xmlTAD形式）
     * @param {string} xmlTad - xmlTAD形式の図形セグメントデータ
     * @param {Object} [options] - オプション
     * @param {number} [options.width] - 図形領域の幅
     * @param {number} [options.height] - 図形領域の高さ
     * @param {string} [options.sourcePlugin] - コピー元プラグイン名
     * @param {string} [options.sourceRealId] - コピー元の実身ID（pixelmap等の画像ファイル参照解決用）
     */
    setFigureSegmentClipboard(xmlTad, options = {}) {
        if (!xmlTad) {
            logger.error(`[${this.pluginName}] setFigureSegmentClipboard: xmlTadが空です`);
            return;
        }
        const clipboardData = {
            type: 'figure-segment',
            xmlTad: xmlTad,
            width: options.width || 0,
            height: options.height || 0,
            sourcePlugin: options.sourcePlugin || this.pluginName
        };
        if (options.sourceRealId) {
            clipboardData.sourceRealId = options.sourceRealId;
        }
        this.setClipboard(clipboardData);
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

        // effectAllowedを設定（DragEventの場合のみ）
        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed =
                this.virtualObjectDragState.dragMode === 'copy' ? 'copy' : 'move';
        }

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
     * DataTransferからURLを抽出
     * ブラウザからのURLドラッグ対応
     *
     * @param {DataTransfer} dataTransfer - ドロップイベントのdataTransfer
     * @returns {string|null} 抽出したURL、またはnull
     *
     * @example
     * // dropハンドラーでの使用例
     * const url = this.extractUrlFromDataTransfer(e.dataTransfer);
     * if (url) {
     *     this.checkAndHandleUrlDrop(e, dropX, dropY);
     * }
     */
    extractUrlFromDataTransfer(dataTransfer) {
        // text/uri-listを優先（標準的なURL転送形式）
        const uriList = dataTransfer.getData('text/uri-list');
        if (uriList) {
            // 改行区切り、#で始まる行はコメント
            const urls = uriList.split('\n')
                .map(line => line.trim())
                .filter(line => line && !line.startsWith('#'));
            if (urls.length > 0) {
                return urls[0];
            }
        }

        // text/plainでURLパターンをチェック
        const plainText = dataTransfer.getData('text/plain');
        if (plainText && /^https?:\/\/.+/i.test(plainText.trim())) {
            return plainText.trim();
        }

        return null;
    }

    /**
     * URLドロップをチェックし、検出した場合は親ウィンドウに転送
     * サブクラスのdropハンドラーから呼び出す
     *
     * ブラウザからドロップされたURLを検出し、親ウィンドウに処理を委譲する
     *
     * @param {DragEvent} e - ドロップイベント
     * @param {number} dropX - ドロップ位置X（iframe内座標）
     * @param {number} dropY - ドロップ位置Y（iframe内座標）
     * @returns {boolean} URLドロップを検出・処理した場合はtrue
     *
     * @example
     * // dropハンドラーでの使用例（先頭で呼び出す）
     * handleDrop(e) {
     *     e.preventDefault();
     *     const dropX = e.offsetX || e.clientX;
     *     const dropY = e.offsetY || e.clientY;
     *     if (this.checkAndHandleUrlDrop(e, dropX, dropY)) {
     *         return; // URLドロップは親ウィンドウで処理
     *     }
     *     // 以下、既存のドロップ処理...
     * }
     */
    checkAndHandleUrlDrop(e, dropX, dropY) {
        const url = this.extractUrlFromDataTransfer(e.dataTransfer);
        if (!url) {
            return false;
        }

        // 親ウィンドウにURL処理を依頼
        this.messageBus.send('url-drop-request', {
            url: url,
            dropX: dropX,
            dropY: dropY,
            windowId: this.windowId
        });

        e.preventDefault();
        e.stopPropagation();
        return true;
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

        // 仮身固有の続柄（link要素のrelationship属性）
        // data-link-relationship -> link_relationship (string) -> linkRelationship (array)
        if (virtualObj.link_relationship) {
            virtualObj.linkRelationship = virtualObj.link_relationship.split(/\s+/).filter(t => t);
        } else {
            virtualObj.linkRelationship = [];
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
    /**
     * init メッセージ受信時の共通処理
     * 各プラグインのinitハンドラ内で最初に呼び出すこと
     *
     * @param {Object} data - initメッセージのデータ
     */
    onInit(data) {
        // windowIdを設定
        if (data.windowId) {
            this.windowId = data.windowId;
            if (this.messageBus) {
                this.messageBus.setWindowId(data.windowId);
            }
        }

        // 初期スクロール状態を送信（スクロール通知が有効な場合）
        if (this._scrollNotificationEnabled && this._scrollContainer) {
            this._sendScrollState(this._scrollContainer);
        }
    }

    setupCommonMessageBusHandlers() {
        if (!this.messageBus) {
            logger.warn(`[${this.pluginName}] messageBusが初期化されていないため、共通ハンドラ登録をスキップ`);
            return;
        }

        // NOTE: initハンドラは各プラグインで個別に実装する必要がある
        // （MessageBusのon()は同じタイプのハンドラを上書きするため、共通化不可）
        // 各プラグインのinitハンドラで以下を実行すること:
        //   this.onInit(data);  // 共通初期化処理

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
    // TADスタイル処理（data属性方式）
    // ========================================

    /**
     * RGB/RGBA形式の色を#rrggbb形式に変換
     * @param {string} color - rgb(r, g, b) または rgba(r, g, b, a) または #rrggbb 形式の色
     * @returns {string} #rrggbb形式の色（変換不可の場合は空文字列）
     */
    rgbToHex(color) {
        return rgbToHexUtil(color);
    }

    /**
     * TADスタイル情報を持つspanのHTML文字列を生成
     * シンプルにインラインスタイルのみ使用
     * @param {string} attr - スタイル属性 ('color', 'size', 'face')
     * @param {string} value - 属性値
     * @returns {string} span開始タグのHTML文字列
     */
    createTadStyledSpan(attr, value) {
        let styleAttr = '';

        if (attr === 'color') {
            styleAttr = `color: ${value};`;
        } else if (attr === 'size') {
            styleAttr = `font-size: ${value}pt;`;
        } else if (attr === 'face') {
            // フォント名にスペース、カンマ、特殊文字が含まれる場合は引用符で囲む
            // style属性がダブルクォートを使用するため、フォント名はシングルクォートで囲む
            let fontFamily = value;
            if (!/^["']/.test(fontFamily) && (/\s|,/.test(fontFamily) || /[^\x00-\x7F]/.test(fontFamily))) {
                fontFamily = `'${fontFamily}'`;
            }
            styleAttr = `font-family: ${fontFamily};`;
        }

        return `<span style="${styleAttr}">`;
    }

    /**
     * span要素からTADスタイル情報を取得
     * インラインスタイルから直接取得
     * @param {HTMLElement} node - span要素
     * @param {string} attr - 取得する属性 ('color', 'size', 'face')
     * @returns {string|null} 属性値（取得できない場合はnull）
     */
    getTadStyleFromSpan(node, attr) {
        if (!node || !node.style) return null;

        const style = node.style;
        if (attr === 'color' && style.color) {
            return this.rgbToHex(style.color);
        } else if (attr === 'size' && style.fontSize) {
            // pt/px単位を除去
            return style.fontSize.replace('pt', '').replace('px', '');
        } else if (attr === 'face' && style.fontFamily) {
            return style.fontFamily;
        }

        return null;
    }

    // ========================================
    // xmlTAD要素生成ヘルパー
    // ========================================

    /**
     * document内テキスト領域用のdocView/docDraw/docScaleタグを生成
     * @param {number} left - 左座標
     * @param {number} top - 上座標
     * @param {number} right - 右座標
     * @param {number} bottom - 下座標
     * @param {number} hunit - 水平スケール単位（デフォルト: -72）
     * @param {number} vunit - 垂直スケール単位（デフォルト: -72）
     * @returns {string} xmlTADタグ文字列
     */
    generateDocViewDrawScale(left, top, right, bottom, hunit = -72, vunit = -72) {
        return `<docView viewleft="${left}" viewtop="${top}" viewright="${right}" viewbottom="${bottom}"/>\r\n` +
               `<docDraw drawleft="${left}" drawtop="${top}" drawright="${right}" drawbottom="${bottom}"/>\r\n` +
               `<docScale hunit="${hunit}" vunit="${vunit}"/>\r\n`;
    }

    /**
     * text要素（document内）を生成
     * @param {Object} options - オプション
     * @param {number} options.lang - 言語コード（デフォルト: 0）
     * @param {number} options.bpat - 背景パターン（デフォルト: 0）
     * @param {number} options.zIndex - zIndex（省略可）
     * @returns {string} xmlTADタグ文字列
     */
    generateTextElement(options = {}) {
        const { lang = 0, bpat = 0, zIndex } = options;
        const zIndexAttr = zIndex !== undefined ? ` zIndex="${zIndex}"` : '';
        return `<text lang="${lang}" bpat="${bpat}"${zIndexAttr}/>\r\n`;
    }

    // ========================================
    // 線属性（l_atr）解析
    // ========================================

    /**
     * l_atr値からlineTypeとlineWidthを抽出
     * l_atrは16ビット値で、上位8ビットが線種、下位8ビットが線幅
     * @param {number|string} l_atr - 線属性値（16ビット）
     * @returns {{lineType: number, lineWidth: number}}
     */
    parseLineAttribute(l_atr) {
        const numValue = Number(l_atr) || 0;
        return {
            lineType: (numValue >> 8) & 0xFF,
            lineWidth: numValue & 0xFF
        };
    }

    /**
     * lineTypeからCSSのlineDash配列を取得
     * @param {number} lineType - 線種（0-5）
     * @returns {number[]} setLineDash用の配列
     */
    getLinePatternForType(lineType) {
        return PluginBase.LINE_PATTERN_DEFINITIONS[lineType] || [];
    }

    /**
     * lineTypeをCanvasに適用
     * @param {CanvasRenderingContext2D} ctx - Canvasコンテキスト
     * @param {number|string} lineType - 線種（0-5 または 'solid'/'dashed'/'dotted'）
     * @returns {number[]} 適用されたパターン配列
     */
    applyLineTypeToCanvas(ctx, lineType) {
        // 文字列の場合は数値に変換（後方互換性）
        let lineTypeNum = lineType;
        if (typeof lineType === 'string') {
            const mapping = { 'solid': 0, 'dashed': 1, 'dotted': 2 };
            lineTypeNum = mapping[lineType] || 0;
        }
        lineTypeNum = Number(lineTypeNum) || 0;

        const pattern = this.getLinePatternForType(lineTypeNum);
        ctx.setLineDash(pattern);
        return pattern;
    }

    /**
     * lineTypeの表示名を取得
     * @param {number} lineType - 線種（0-5）
     * @returns {string} 日本語名
     */
    getLineTypeName(lineType) {
        return PluginBase.LINE_TYPE_NAMES[lineType] || '実線';
    }

    /**
     * linePatternをlineTypeに変換（後方互換用）
     * @param {string} linePattern - 'solid'/'dashed'/'dotted'
     * @returns {number} lineType (0-5)
     */
    linePatternToLineType(linePattern) {
        const mapping = { 'solid': 0, 'dashed': 1, 'dotted': 2 };
        return mapping[linePattern] || 0;
    }

    /**
     * polyline要素を生成
     * @param {string} points - 座標文字列 "x1,y1 x2,y2 ..."
     * @param {Object} options - オプション
     * @param {number} options.lineType - 線種（デフォルト: 0）
     * @param {number} options.lineWidth - 線幅（デフォルト: 1）
     * @param {number} options.l_pat - 線パターン（デフォルト: 0）
     * @param {number} options.round - 角丸（デフォルト: 0）
     * @param {number} options.start_arrow - 始点矢印（デフォルト: 0）
     * @param {number} options.end_arrow - 終点矢印（デフォルト: 0）
     * @param {string} options.strokeColor - 線色（デフォルト: '#000000'）
     * @param {number} options.zIndex - zIndex（省略可）
     * @returns {string} xmlTADタグ文字列
     */
    generatePolylineElement(points, options = {}) {
        const {
            lineType = 0,
            lineWidth = 1,
            l_pat = 0,
            round = 0,
            start_arrow = 0,
            end_arrow = 0,
            strokeColor = DEFAULT_FRCOL,
            zIndex
        } = options;
        const zIndexAttr = zIndex !== undefined ? ` zIndex="${zIndex}"` : '';
        return `<polyline lineType="${lineType}" lineWidth="${lineWidth}" l_pat="${l_pat}" round="${round}" ` +
               `start_arrow="${start_arrow}" end_arrow="${end_arrow}" ` +
               `strokeColor="${strokeColor}" points="${points}"${zIndexAttr}/>\r\n`;
    }

    /**
     * ellipse要素を生成（円の場合はrx=ryで呼び出す）
     * @param {number} cx - 中心X座標
     * @param {number} cy - 中心Y座標
     * @param {number} rx - X方向半径
     * @param {number} ry - Y方向半径
     * @param {Object} options - オプション
     * @param {number} options.lineType - 線種（デフォルト: 0）
     * @param {number} options.lineWidth - 線幅（デフォルト: 0）
     * @param {number} options.l_pat - 線パターン（デフォルト: 0）
     * @param {number} options.f_pat - 塗りパターン（デフォルト: 1）
     * @param {number} options.angle - 回転角度（デフォルト: 0）
     * @param {string} options.strokeColor - 線色（デフォルト: '#000000'）
     * @param {string} options.fillColor - 塗り色（デフォルト: '#000000'）
     * @param {number} options.zIndex - zIndex（省略可）
     * @returns {string} xmlTADタグ文字列
     */
    generateEllipseElement(cx, cy, rx, ry, options = {}) {
        const {
            lineType = 0,
            lineWidth = 0,
            l_pat = 0,
            f_pat = 1,
            angle = 0,
            strokeColor = DEFAULT_FRCOL,
            fillColor = DEFAULT_FRCOL,
            zIndex
        } = options;
        const zIndexAttr = zIndex !== undefined ? ` zIndex="${zIndex}"` : '';
        return `<ellipse lineType="${lineType}" lineWidth="${lineWidth}" l_pat="${l_pat}" f_pat="${f_pat}" angle="${angle}" ` +
               `cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" ` +
               `strokeColor="${strokeColor}" fillColor="${fillColor}"${zIndexAttr}/>\r\n`;
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
            DEFAULT_BGCOL;

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
     * 仮身選択時のコンテキストメニュー項目を構築してmenuDefに追加
     * contextMenuVirtualObjectが設定されている場合のみ動作
     *
     * 追加されるメニュー:
     * - 仮身操作（開く、閉じる、属性変更、続柄設定）
     * - 実身操作（実身名変更、実身複製、管理情報、仮身ネットワーク、実身/仮身検索）
     * - 屑実身操作（オプション）
     * - 実行（applistから動的生成）
     *
     * @param {Array} menuDef - メニュー定義配列（項目が追加される）
     * @param {Object} [options={}] - カスタマイズオプション
     * @param {string} [options.openAction='open-real-object'] - 「開く」のアクション名
     * @param {string} [options.closeAction='close-real-object'] - 「閉じる」のアクション名
     * @param {string} [options.configAction='open-realobject-config'] - 「管理情報」のアクション名
     * @param {boolean} [options.includeTrash=true] - 屑実身操作メニューを含めるか
     * @param {boolean} [options.includeDisabled=true] - 開く/閉じるのdisabled属性を設定するか
     * @param {string} [options.openShortcut] - 「開く」のショートカットキー表示
     */
    async buildVirtualObjectContextMenus(menuDef, options = {}) {
        if (!this.contextMenuVirtualObject) return;

        const {
            openAction = 'open-real-object',
            closeAction = 'close-real-object',
            configAction = 'open-realobject-config',
            includeTrash = true,
            includeDisabled = true,
            openShortcut = undefined
        } = options;

        try {
            const realId = this.contextMenuVirtualObject.realId;
            const isOpened = this.openedRealObjects ? this.openedRealObjects.has(realId) : false;

            // 仮身操作メニュー
            const openItem = { label: '開く', action: openAction };
            const closeItem = { label: '閉じる', action: closeAction };
            if (includeDisabled) {
                openItem.disabled = isOpened;
                closeItem.disabled = !isOpened;
            }
            if (openShortcut) {
                openItem.shortcut = openShortcut;
            }

            menuDef.push({
                label: '仮身操作',
                submenu: [
                    openItem,
                    closeItem,
                    { separator: true },
                    { label: '属性変更', action: 'change-virtual-object-attributes' },
                    { label: '続柄設定', action: 'set-relationship' }
                ]
            });

            // 実身操作メニュー
            menuDef.push({
                label: '実身操作',
                submenu: [
                    { label: '実身名変更', action: 'rename-real-object' },
                    { label: '実身複製', action: 'duplicate-real-object' },
                    { label: '管理情報', action: configAction },
                    { label: '仮身ネットワーク', action: 'open-virtual-object-network' },
                    { label: '実身/仮身検索', action: 'open-real-object-search' }
                ]
            });

            // 屑実身操作メニュー
            if (includeTrash) {
                menuDef.push({
                    label: '屑実身操作',
                    action: 'open-trash-real-objects'
                });
            }

            // 実行メニュー（applistから動的生成）
            const applistData = await this.getAppListData(this.contextMenuVirtualObject.realId);
            if (applistData && Object.keys(applistData).length > 0) {
                const executeSubmenu = [];
                for (const [pluginId, appInfo] of Object.entries(applistData)) {
                    executeSubmenu.push({
                        label: appInfo.name || pluginId,
                        action: `execute-with-${pluginId}`
                    });
                }
                menuDef.push({
                    label: '実行',
                    submenu: executeSubmenu
                });
            }
        } catch (error) {
            logger.error(`[${this.pluginName}] buildVirtualObjectContextMenus エラー:`, error);
        }
    }

    // ========================================
    // 子iframe メッセージ転送（共通実装）
    // ========================================

    /**
     * 開いた仮身内プラグイン（子iframe）とのメッセージ転送を設定
     *
     * 開いた仮身表示時、子iframeからのリクエストを親ウィンドウに中継し、
     * 親ウィンドウからのレスポンスを子iframeに中継する。
     *
     * @param {Object} config - 転送設定
     * @param {string[]} [config.forwardToParent=[]] - 子iframe→親ウィンドウに転送するメッセージタイプ
     * @param {string[]} [config.forwardToChildren=[]] - 親ウィンドウ→子iframeに転送するメッセージタイプ
     *
     * @example
     * this.setupChildIframeMessageForwarding({
     *     forwardToParent: ['load-image-file', 'get-image-file-path'],
     *     forwardToChildren: ['load-image-response', 'save-image-response', 'image-file-path-response']
     * });
     */
    setupChildIframeMessageForwarding(config = {}) {
        const {
            forwardToParent = [],
            forwardToChildren = []
        } = config;

        // 子iframe からのリクエストを親ウィンドウに転送
        for (const messageType of forwardToParent) {
            this.messageBus.on(messageType, (data) => {
                this.messageBus.send(messageType, data);
            });
        }

        // 親ウィンドウからのレスポンスを子iframe に転送
        for (const messageType of forwardToChildren) {
            this.messageBus.on(messageType, (data) => {
                const iframes = document.querySelectorAll('iframe');
                iframes.forEach(iframe => {
                    if (iframe.contentWindow) {
                        iframe.contentWindow.postMessage({
                            type: messageType,
                            ...data,
                            _messageBus: true,
                            _from: this.pluginName
                        }, '*');
                    }
                });
            });
        }
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

            logger.debug(`[${this.pluginName}] 画像ファイル削除依頼:`, fileName);
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

            // resourceNoを優先し、後方互換としてimageNoもサポート
            const maxNo = Math.max(...result.files.map(f => f.resourceNo ?? f.imageNo));
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
     * 次のリソース番号を取得（メモリ+ディスク両方を考慮）
     * 画像、pixelmap等のリソース番号計算に使用する汎用メソッド
     * @param {Function} getMemoryMaxFn - メモリ上の最大番号を返す関数（デフォルト: -1を返す）
     * @returns {Promise<number>} 次のリソース番号
     */
    async getNextResourceNumber(getMemoryMaxFn = () => -1) {
        // 1. メモリ上の最大値
        const memoryMax = getMemoryMaxFn();

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

    /**
     * 次の画像番号を取得（メモリ+ディスク両方を考慮）
     * @returns {Promise<number>} 次の画像番号
     */
    async getNextImageNumber() {
        return this.getNextResourceNumber(() => this.getMemoryMaxImageNumber());
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

    // ========================================
    // 仮身サイズ計算メソッド
    // ========================================

    /**
     * 仮身属性がサイズに影響するかを判定
     * @param {Object} attrs - 変更された属性
     * @returns {boolean} サイズに影響する場合true
     */
    _isVobjSizeAffectingAttrs(attrs) {
        // サイズに影響する属性: 文字サイズ、表示項目
        const sizeAffectingAttrs = ['chsz', 'pictdisp', 'namedisp', 'roledisp', 'typedisp', 'updatedisp'];
        return sizeAffectingAttrs.some(attr => attr in attrs && attrs[attr] !== undefined);
    }

    /**
     * 仮身テキスト幅を測定（Canvas API使用）
     * @param {string} text - 測定するテキスト
     * @param {number} fontSizePx - フォントサイズ（ピクセル）
     * @returns {number} 幅（ピクセル、切り上げ）
     */
    _measureVobjTextWidth(text, fontSizePx) {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        // 仮身表示で使用するフォントファミリー
        context.font = `${fontSizePx}px 'Noto Sans JP', 'Yu Gothic', 'Meiryo', sans-serif`;
        return Math.ceil(context.measureText(text).width);
    }

    /**
     * 閉じた仮身の幅を計算
     * @param {Object} options - 計算オプション
     * @param {string} options.linkName - 仮身名（表示テキスト）
     * @param {number} options.chszPx - 文字サイズ（ピクセル）
     * @param {boolean} options.showPict - アイコン表示するか
     * @param {boolean} [options.showName=true] - 名称を表示するか
     * @param {string} [options.roleText=''] - 続柄テキスト
     * @param {string} [options.typeText=''] - タイプテキスト
     * @param {string} [options.updateText=''] - 更新日時テキスト
     * @returns {number} 幅（ピクセル）
     */
    _calculateCollapsedVobjWidth(options) {
        const {
            linkName = '',
            chszPx,
            showPict = true,
            showName = true,
            roleText = '',
            typeText = '',
            updateText = ''
        } = options;

        // テキスト部分の幅を計算
        let textContent = '';
        if (showName) {
            textContent += linkName;
        }
        if (roleText) {
            textContent += ' : ' + roleText;
        }
        if (typeText) {
            textContent += ' (' + typeText + ')';
        }
        if (updateText) {
            textContent += ' ' + updateText;
        }

        const textWidth = this._measureVobjTextWidth(textContent, chszPx);

        // アイコン関連
        const iconWidth = showPict ? chszPx : 0;
        const gap = showPict ? 4 : 0;  // アイコンとテキスト間のgap

        // padding: 4px 8px → 左右で16px
        // border: 1px solid → 左右で2px
        const padding = 16;
        const border = 2;

        return iconWidth + gap + textWidth + padding + border;
    }

    // ========================================
    // 図形要素描画メソッド（Phase 2対応）
    // ========================================

    /**
     * 矩形要素（<rect>）をDOM要素として描画
     * @param {Element} rectEl - rect XML要素
     * @param {HTMLElement} container - 描画先コンテナ
     * @returns {HTMLElement} 作成されたDOM要素
     */
    renderRectElement(rectEl, container) {
        const div = document.createElement('div');
        div.className = 'figure-rect';

        // id属性を保持（アニメーション対象の識別用）
        const id = rectEl.getAttribute('id');
        if (id) {
            div.dataset.id = id;
        }

        // 座標取得
        const left = parseFloat(rectEl.getAttribute('left')) || 0;
        const top = parseFloat(rectEl.getAttribute('top')) || 0;
        const right = parseFloat(rectEl.getAttribute('right')) || 0;
        const bottom = parseFloat(rectEl.getAttribute('bottom')) || 0;

        // スタイル属性取得
        const fillColor = rectEl.getAttribute('fillColor') || DEFAULT_BGCOL;
        const strokeColor = rectEl.getAttribute('strokeColor') || DEFAULT_FRCOL;
        const lineWidth = parseFloat(rectEl.getAttribute('lineWidth')) || 1;
        const round = parseFloat(rectEl.getAttribute('round')) || 0;
        const zIndex = parseInt(rectEl.getAttribute('zIndex')) || 0;

        // スタイル設定
        div.style.position = 'absolute';
        div.style.left = `${left}px`;
        div.style.top = `${top}px`;
        div.style.width = `${right - left}px`;
        div.style.height = `${bottom - top}px`;
        div.style.backgroundColor = fillColor;
        div.style.border = `${lineWidth}px solid ${strokeColor}`;
        div.style.borderRadius = `${round}px`;
        div.style.boxSizing = 'border-box';
        div.style.zIndex = zIndex;
        div.style.pointerEvents = 'none';

        if (container) {
            container.appendChild(div);
        }

        return div;
    }

    /**
     * ドキュメント要素（<document>内のテキスト）をDOM要素として描画
     * @param {Element} docEl - document XML要素
     * @param {HTMLElement} container - 描画先コンテナ
     * @returns {HTMLElement} 作成されたDOM要素
     */
    renderDocumentTextElement(docEl, container) {
        const div = document.createElement('div');
        div.className = 'figure-document';

        // docView要素から座標取得
        const docView = docEl.querySelector('docView');
        let left = 0, top = 0, right = 100, bottom = 30;
        if (docView) {
            left = parseFloat(docView.getAttribute('viewleft')) || 0;
            top = parseFloat(docView.getAttribute('viewtop')) || 0;
            right = parseFloat(docView.getAttribute('viewright')) || 100;
            bottom = parseFloat(docView.getAttribute('viewbottom')) || 30;
        }

        // font要素からスタイル取得
        let fontSize = 12;
        let fontColor = DEFAULT_CHCOL;
        const fontElements = docEl.querySelectorAll('font');
        fontElements.forEach(fontEl => {
            if (fontEl.hasAttribute('size')) {
                fontSize = parseFloat(fontEl.getAttribute('size')) || 12;
            }
            if (fontEl.hasAttribute('color')) {
                fontColor = fontEl.getAttribute('color') || DEFAULT_CHCOL;
            }
        });

        // text要素から配置とidを取得
        let textAlign = 'left';
        let zIndex = 0;
        let textId = null;
        const textElements = docEl.querySelectorAll('text');
        textElements.forEach(textEl => {
            if (textEl.hasAttribute('align')) {
                textAlign = textEl.getAttribute('align') || 'left';
            }
            if (textEl.hasAttribute('zIndex')) {
                zIndex = parseInt(textEl.getAttribute('zIndex')) || 0;
            }
            if (textEl.hasAttribute('id')) {
                textId = textEl.getAttribute('id');
            }
        });

        // id属性を保持（アニメーション対象の識別用）
        if (textId) {
            div.dataset.id = textId;
        }

        // テキスト内容を取得（直接のテキストノードまたは<p>要素内）
        let textContent = '';
        // まず<p>要素を確認
        const pElement = docEl.querySelector('p');
        if (pElement) {
            textContent = pElement.textContent.trim();
            // <p>要素のalign属性を取得
            if (pElement.hasAttribute('align')) {
                textAlign = pElement.getAttribute('align') || 'left';
            }
        } else {
            // <p>要素がない場合は直接のテキストノードを取得
            const childNodes = docEl.childNodes;
            for (let i = 0; i < childNodes.length; i++) {
                const node = childNodes[i];
                if (node.nodeType === Node.TEXT_NODE) {
                    const trimmed = node.textContent.trim();
                    if (trimmed) {
                        textContent = trimmed;
                        break;
                    }
                }
            }
        }

        // スタイル設定
        div.style.position = 'absolute';
        div.style.left = `${left}px`;
        div.style.top = `${top}px`;
        div.style.width = `${right - left}px`;
        div.style.height = `${bottom - top}px`;
        div.style.fontSize = `${fontSize}px`;
        div.style.color = fontColor;
        div.style.textAlign = textAlign;
        div.style.display = 'flex';
        div.style.alignItems = 'center';
        div.style.justifyContent = textAlign === 'center' ? 'center' : (textAlign === 'right' ? 'flex-end' : 'flex-start');
        div.style.zIndex = zIndex;
        div.style.pointerEvents = 'none';
        div.style.overflow = 'hidden';
        div.style.whiteSpace = 'nowrap';
        div.style.fontFamily = "'Noto Sans JP', sans-serif";

        div.textContent = textContent;

        if (container) {
            container.appendChild(div);
        }

        return div;
    }

    /**
     * 線要素（<line>）をDOM要素として描画
     * @param {Element} lineEl - line XML要素
     * @param {HTMLElement} container - 描画先コンテナ
     * @returns {HTMLElement} 作成されたDOM要素
     */
    renderLineElement(lineEl, container) {
        const div = document.createElement('div');
        div.className = 'figure-line';

        // id属性を保持（アニメーション対象の識別用）
        const id = lineEl.getAttribute('id');
        if (id) {
            div.dataset.id = id;
        }

        // 座標取得
        const left = parseFloat(lineEl.getAttribute('left')) || 0;
        const top = parseFloat(lineEl.getAttribute('top')) || 0;
        const right = parseFloat(lineEl.getAttribute('right')) || 0;
        const bottom = parseFloat(lineEl.getAttribute('bottom')) || 0;

        // スタイル属性取得
        const strokeColor = lineEl.getAttribute('strokeColor') || DEFAULT_FRCOL;
        const lineWidth = parseFloat(lineEl.getAttribute('lineWidth')) || 1;
        const zIndex = parseInt(lineEl.getAttribute('zIndex')) || 0;

        // 水平線か垂直線かを判定
        const isHorizontal = Math.abs(bottom - top) < Math.abs(right - left);

        div.style.position = 'absolute';
        div.style.zIndex = zIndex;
        div.style.pointerEvents = 'none';

        if (isHorizontal) {
            // 水平線
            div.style.left = `${Math.min(left, right)}px`;
            div.style.top = `${top}px`;
            div.style.width = `${Math.abs(right - left)}px`;
            div.style.height = `${lineWidth}px`;
            div.style.backgroundColor = strokeColor;
        } else {
            // 垂直線
            div.style.left = `${left}px`;
            div.style.top = `${Math.min(top, bottom)}px`;
            div.style.width = `${lineWidth}px`;
            div.style.height = `${Math.abs(bottom - top)}px`;
            div.style.backgroundColor = strokeColor;
        }

        if (container) {
            container.appendChild(div);
        }

        return div;
    }

    /**
     * 円要素（<circle>）をDOM要素として描画
     * @param {Element} circleEl - circle XML要素
     * @param {HTMLElement} container - 描画先コンテナ
     * @returns {HTMLElement} 作成されたDOM要素
     */
    renderCircleElement(circleEl, container) {
        const div = document.createElement('div');
        div.className = 'figure-circle';

        // id属性を保持（アニメーション対象の識別用）
        const id = circleEl.getAttribute('id');
        if (id) {
            div.dataset.id = id;
        }

        // 座標取得（バウンディングボックス）
        const left = parseFloat(circleEl.getAttribute('left')) || 0;
        const top = parseFloat(circleEl.getAttribute('top')) || 0;
        const right = parseFloat(circleEl.getAttribute('right')) || 0;
        const bottom = parseFloat(circleEl.getAttribute('bottom')) || 0;

        // スタイル属性取得
        const fillColor = circleEl.getAttribute('fillColor') || DEFAULT_BGCOL;
        const lineColor = circleEl.getAttribute('lineColor') || DEFAULT_FRCOL;
        const lineWidth = parseFloat(circleEl.getAttribute('lineWidth')) || 1;
        const zIndex = parseInt(circleEl.getAttribute('zIndex')) || 0;

        const width = right - left;
        const height = bottom - top;

        // スタイル設定（CSSで円を描画）
        div.style.position = 'absolute';
        div.style.left = `${left}px`;
        div.style.top = `${top}px`;
        div.style.width = `${width}px`;
        div.style.height = `${height}px`;
        div.style.backgroundColor = fillColor;
        div.style.border = `${lineWidth}px solid ${lineColor}`;
        div.style.borderRadius = '50%';
        div.style.boxSizing = 'border-box';
        div.style.zIndex = zIndex;
        div.style.pointerEvents = 'none';

        if (container) {
            container.appendChild(div);
        }

        return div;
    }

    /**
     * 多角形要素（<polygon>）をDOM要素として描画
     * SVGを使用して描画
     * @param {Element} polygonEl - polygon XML要素
     * @param {HTMLElement} container - 描画先コンテナ
     * @returns {HTMLElement} 作成されたDOM要素
     */
    renderPolygonElement(polygonEl, container) {
        const div = document.createElement('div');
        div.className = 'figure-polygon';

        // id属性を保持（アニメーション対象の識別用）
        const id = polygonEl.getAttribute('id');
        if (id) {
            div.dataset.id = id;
        }

        // 座標取得（バウンディングボックス）
        const left = parseFloat(polygonEl.getAttribute('left')) || 0;
        const top = parseFloat(polygonEl.getAttribute('top')) || 0;
        const right = parseFloat(polygonEl.getAttribute('right')) || 0;
        const bottom = parseFloat(polygonEl.getAttribute('bottom')) || 0;

        // スタイル属性取得
        const fillColor = polygonEl.getAttribute('fillColor') || DEFAULT_BGCOL;
        const lineColor = polygonEl.getAttribute('lineColor') || DEFAULT_FRCOL;
        const lineWidth = parseFloat(polygonEl.getAttribute('lineWidth')) || 1;
        const zIndex = parseInt(polygonEl.getAttribute('zIndex')) || 0;
        const pointsAttr = polygonEl.getAttribute('points') || '';

        const width = right - left;
        const height = bottom - top;

        // SVGで多角形を描画
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', width);
        svg.setAttribute('height', height);
        svg.style.position = 'absolute';
        svg.style.left = `${left}px`;
        svg.style.top = `${top}px`;
        svg.style.overflow = 'visible';

        // points属性を相対座標に変換
        const relativePoints = pointsAttr.split(' ').map(point => {
            const [x, y] = point.split(',').map(Number);
            return `${x - left},${y - top}`;
        }).join(' ');

        const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        polygon.setAttribute('points', relativePoints);
        polygon.setAttribute('fill', fillColor);
        polygon.setAttribute('stroke', lineColor);
        polygon.setAttribute('stroke-width', lineWidth);

        svg.appendChild(polygon);

        div.style.position = 'absolute';
        div.style.left = '0';
        div.style.top = '0';
        div.style.zIndex = zIndex;
        div.style.pointerEvents = 'none';
        div.appendChild(svg);

        if (container) {
            container.appendChild(div);
        }

        return div;
    }

    /**
     * 楕円要素（<ellipse>）をDOM要素として描画
     * SVGで楕円を描画（TAD仕様ではcircleはellipseで表現）
     * @param {Element} ellipseEl - ellipse XML要素
     * @param {HTMLElement} container - 描画先コンテナ
     * @returns {HTMLElement} 作成されたDOM要素
     */
    renderEllipseElement(ellipseEl, container) {
        const div = document.createElement('div');
        div.className = 'figure-ellipse';

        // id属性を保持
        const id = ellipseEl.getAttribute('id');
        if (id) {
            div.dataset.id = id;
        }

        // 座標取得
        const left = parseFloat(ellipseEl.getAttribute('left')) || 0;
        const top = parseFloat(ellipseEl.getAttribute('top')) || 0;
        const right = parseFloat(ellipseEl.getAttribute('right')) || 0;
        const bottom = parseFloat(ellipseEl.getAttribute('bottom')) || 0;

        // スタイル属性取得
        const fillColor = ellipseEl.getAttribute('fillColor') || DEFAULT_BGCOL;
        const lineColor = ellipseEl.getAttribute('lineColor') || ellipseEl.getAttribute('strokeColor') || DEFAULT_FRCOL;
        const lineWidth = parseFloat(ellipseEl.getAttribute('lineWidth')) || 1;
        const zIndex = parseInt(ellipseEl.getAttribute('zIndex')) || 0;

        const width = right - left;
        const height = bottom - top;
        const rx = width / 2;
        const ry = height / 2;

        // SVGで楕円を描画
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', width);
        svg.setAttribute('height', height);
        svg.style.overflow = 'visible';

        const ellipse = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
        ellipse.setAttribute('cx', rx);
        ellipse.setAttribute('cy', ry);
        ellipse.setAttribute('rx', rx);
        ellipse.setAttribute('ry', ry);
        ellipse.setAttribute('fill', fillColor);
        ellipse.setAttribute('stroke', lineColor);
        ellipse.setAttribute('stroke-width', lineWidth);

        svg.appendChild(ellipse);

        div.style.position = 'absolute';
        div.style.left = `${left}px`;
        div.style.top = `${top}px`;
        div.style.zIndex = zIndex;
        div.style.pointerEvents = 'none';
        div.appendChild(svg);

        if (container) {
            container.appendChild(div);
        }

        return div;
    }

    /**
     * 円弧要素（<arc>）をDOM要素として描画
     * SVGで扇形を描画
     * @param {Element} arcEl - arc XML要素
     * @param {HTMLElement} container - 描画先コンテナ
     * @returns {HTMLElement} 作成されたDOM要素
     */
    renderArcElement(arcEl, container) {
        const div = document.createElement('div');
        div.className = 'figure-arc';

        const id = arcEl.getAttribute('id');
        if (id) {
            div.dataset.id = id;
        }

        const left = parseFloat(arcEl.getAttribute('left')) || 0;
        const top = parseFloat(arcEl.getAttribute('top')) || 0;
        const right = parseFloat(arcEl.getAttribute('right')) || 0;
        const bottom = parseFloat(arcEl.getAttribute('bottom')) || 0;
        const startAngle = parseFloat(arcEl.getAttribute('startAngle')) || 0;
        const endAngle = parseFloat(arcEl.getAttribute('endAngle')) || 90;

        const fillColor = arcEl.getAttribute('fillColor') || DEFAULT_BGCOL;
        const lineColor = arcEl.getAttribute('lineColor') || DEFAULT_FRCOL;
        const lineWidth = parseFloat(arcEl.getAttribute('lineWidth')) || 1;
        const zIndex = parseInt(arcEl.getAttribute('zIndex')) || 0;

        const width = right - left;
        const height = bottom - top;
        const rx = width / 2;
        const ry = height / 2;
        const cx = rx;
        const cy = ry;

        // 角度をラジアンに変換（TADは時計回り、SVGは反時計回り）
        const startRad = (startAngle * Math.PI) / 180;
        const endRad = (endAngle * Math.PI) / 180;

        // 始点と終点の座標
        const x1 = cx + rx * Math.cos(startRad);
        const y1 = cy + ry * Math.sin(startRad);
        const x2 = cx + rx * Math.cos(endRad);
        const y2 = cy + ry * Math.sin(endRad);

        // 大円弧フラグ
        const largeArc = (endAngle - startAngle) > 180 ? 1 : 0;

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', width);
        svg.setAttribute('height', height);
        svg.style.overflow = 'visible';

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        // 扇形パス（中心から始点、弧、中心へ戻る）
        const d = `M ${cx} ${cy} L ${x1} ${y1} A ${rx} ${ry} 0 ${largeArc} 1 ${x2} ${y2} Z`;
        path.setAttribute('d', d);
        path.setAttribute('fill', fillColor);
        path.setAttribute('stroke', lineColor);
        path.setAttribute('stroke-width', lineWidth);

        svg.appendChild(path);

        div.style.position = 'absolute';
        div.style.left = `${left}px`;
        div.style.top = `${top}px`;
        div.style.zIndex = zIndex;
        div.style.pointerEvents = 'none';
        div.appendChild(svg);

        if (container) {
            container.appendChild(div);
        }

        return div;
    }

    /**
     * 弦要素（<chord>）をDOM要素として描画
     * 円弧と直線で囲まれた領域
     * @param {Element} chordEl - chord XML要素
     * @param {HTMLElement} container - 描画先コンテナ
     * @returns {HTMLElement} 作成されたDOM要素
     */
    renderChordElement(chordEl, container) {
        const div = document.createElement('div');
        div.className = 'figure-chord';

        const id = chordEl.getAttribute('id');
        if (id) {
            div.dataset.id = id;
        }

        const left = parseFloat(chordEl.getAttribute('left')) || 0;
        const top = parseFloat(chordEl.getAttribute('top')) || 0;
        const right = parseFloat(chordEl.getAttribute('right')) || 0;
        const bottom = parseFloat(chordEl.getAttribute('bottom')) || 0;
        const startAngle = parseFloat(chordEl.getAttribute('startAngle')) || 0;
        const endAngle = parseFloat(chordEl.getAttribute('endAngle')) || 90;

        const fillColor = chordEl.getAttribute('fillColor') || DEFAULT_BGCOL;
        const lineColor = chordEl.getAttribute('lineColor') || DEFAULT_FRCOL;
        const lineWidth = parseFloat(chordEl.getAttribute('lineWidth')) || 1;
        const zIndex = parseInt(chordEl.getAttribute('zIndex')) || 0;

        const width = right - left;
        const height = bottom - top;
        const rx = width / 2;
        const ry = height / 2;
        const cx = rx;
        const cy = ry;

        const startRad = (startAngle * Math.PI) / 180;
        const endRad = (endAngle * Math.PI) / 180;

        const x1 = cx + rx * Math.cos(startRad);
        const y1 = cy + ry * Math.sin(startRad);
        const x2 = cx + rx * Math.cos(endRad);
        const y2 = cy + ry * Math.sin(endRad);

        const largeArc = (endAngle - startAngle) > 180 ? 1 : 0;

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', width);
        svg.setAttribute('height', height);
        svg.style.overflow = 'visible';

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        // 弦パス（始点から弧を描き、直線で始点へ戻る）
        const d = `M ${x1} ${y1} A ${rx} ${ry} 0 ${largeArc} 1 ${x2} ${y2} Z`;
        path.setAttribute('d', d);
        path.setAttribute('fill', fillColor);
        path.setAttribute('stroke', lineColor);
        path.setAttribute('stroke-width', lineWidth);

        svg.appendChild(path);

        div.style.position = 'absolute';
        div.style.left = `${left}px`;
        div.style.top = `${top}px`;
        div.style.zIndex = zIndex;
        div.style.pointerEvents = 'none';
        div.appendChild(svg);

        if (container) {
            container.appendChild(div);
        }

        return div;
    }

    /**
     * 楕円弧要素（<elliptical_arc>）をDOM要素として描画
     * 塗りつぶしのない楕円弧
     * @param {Element} ellArcEl - elliptical_arc XML要素
     * @param {HTMLElement} container - 描画先コンテナ
     * @returns {HTMLElement} 作成されたDOM要素
     */
    renderEllipticalArcElement(ellArcEl, container) {
        const div = document.createElement('div');
        div.className = 'figure-elliptical-arc';

        const id = ellArcEl.getAttribute('id');
        if (id) {
            div.dataset.id = id;
        }

        const left = parseFloat(ellArcEl.getAttribute('left')) || 0;
        const top = parseFloat(ellArcEl.getAttribute('top')) || 0;
        const right = parseFloat(ellArcEl.getAttribute('right')) || 0;
        const bottom = parseFloat(ellArcEl.getAttribute('bottom')) || 0;
        const startAngle = parseFloat(ellArcEl.getAttribute('startAngle')) || 0;
        const endAngle = parseFloat(ellArcEl.getAttribute('endAngle')) || 90;

        const lineColor = ellArcEl.getAttribute('lineColor') || DEFAULT_FRCOL;
        const lineWidth = parseFloat(ellArcEl.getAttribute('lineWidth')) || 1;
        const zIndex = parseInt(ellArcEl.getAttribute('zIndex')) || 0;

        const width = right - left;
        const height = bottom - top;
        const rx = width / 2;
        const ry = height / 2;
        const cx = rx;
        const cy = ry;

        const startRad = (startAngle * Math.PI) / 180;
        const endRad = (endAngle * Math.PI) / 180;

        const x1 = cx + rx * Math.cos(startRad);
        const y1 = cy + ry * Math.sin(startRad);
        const x2 = cx + rx * Math.cos(endRad);
        const y2 = cy + ry * Math.sin(endRad);

        const largeArc = (endAngle - startAngle) > 180 ? 1 : 0;

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', width);
        svg.setAttribute('height', height);
        svg.style.overflow = 'visible';

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        // 弧のみ（塗りつぶしなし）
        const d = `M ${x1} ${y1} A ${rx} ${ry} 0 ${largeArc} 1 ${x2} ${y2}`;
        path.setAttribute('d', d);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', lineColor);
        path.setAttribute('stroke-width', lineWidth);

        svg.appendChild(path);

        div.style.position = 'absolute';
        div.style.left = `${left}px`;
        div.style.top = `${top}px`;
        div.style.zIndex = zIndex;
        div.style.pointerEvents = 'none';
        div.appendChild(svg);

        if (container) {
            container.appendChild(div);
        }

        return div;
    }

    /**
     * 折れ線要素（<polyline>）をDOM要素として描画
     * @param {Element} polylineEl - polyline XML要素
     * @param {HTMLElement} container - 描画先コンテナ
     * @returns {HTMLElement} 作成されたDOM要素
     */
    renderPolylineElement(polylineEl, container) {
        const div = document.createElement('div');
        div.className = 'figure-polyline';

        const id = polylineEl.getAttribute('id');
        if (id) {
            div.dataset.id = id;
        }

        const left = parseFloat(polylineEl.getAttribute('left')) || 0;
        const top = parseFloat(polylineEl.getAttribute('top')) || 0;
        const right = parseFloat(polylineEl.getAttribute('right')) || 0;
        const bottom = parseFloat(polylineEl.getAttribute('bottom')) || 0;
        const pointsAttr = polylineEl.getAttribute('points') || '';

        const lineColor = polylineEl.getAttribute('lineColor') || polylineEl.getAttribute('strokeColor') || DEFAULT_FRCOL;
        const lineWidth = parseFloat(polylineEl.getAttribute('lineWidth')) || 1;
        const zIndex = parseInt(polylineEl.getAttribute('zIndex')) || 0;

        const width = right - left;
        const height = bottom - top;

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', width);
        svg.setAttribute('height', height);
        svg.style.overflow = 'visible';

        // points属性を相対座標に変換
        const relativePoints = pointsAttr.split(' ').map(point => {
            const [x, y] = point.split(',').map(Number);
            return `${x - left},${y - top}`;
        }).join(' ');

        const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        polyline.setAttribute('points', relativePoints);
        polyline.setAttribute('fill', 'none');
        polyline.setAttribute('stroke', lineColor);
        polyline.setAttribute('stroke-width', lineWidth);

        svg.appendChild(polyline);

        div.style.position = 'absolute';
        div.style.left = `${left}px`;
        div.style.top = `${top}px`;
        div.style.zIndex = zIndex;
        div.style.pointerEvents = 'none';
        div.appendChild(svg);

        if (container) {
            container.appendChild(div);
        }

        return div;
    }

    /**
     * 曲線要素（<curve>）をDOM要素として描画
     * ベジェ曲線またはスプライン曲線
     * @param {Element} curveEl - curve XML要素
     * @param {HTMLElement} container - 描画先コンテナ
     * @returns {HTMLElement} 作成されたDOM要素
     */
    renderCurveElement(curveEl, container) {
        const div = document.createElement('div');
        div.className = 'figure-curve';

        const id = curveEl.getAttribute('id');
        if (id) {
            div.dataset.id = id;
        }

        const left = parseFloat(curveEl.getAttribute('left')) || 0;
        const top = parseFloat(curveEl.getAttribute('top')) || 0;
        const right = parseFloat(curveEl.getAttribute('right')) || 0;
        const bottom = parseFloat(curveEl.getAttribute('bottom')) || 0;
        const pointsAttr = curveEl.getAttribute('points') || '';
        const curveType = curveEl.getAttribute('type') || 'spline';

        const lineColor = curveEl.getAttribute('lineColor') || DEFAULT_FRCOL;
        const lineWidth = parseFloat(curveEl.getAttribute('lineWidth')) || 1;
        const zIndex = parseInt(curveEl.getAttribute('zIndex')) || 0;

        const width = right - left;
        const height = bottom - top;

        // ポイントを配列として解析
        const points = pointsAttr.split(' ').map(point => {
            const [x, y] = point.split(',').map(Number);
            return { x: x - left, y: y - top };
        });

        if (points.length < 2) {
            if (container) container.appendChild(div);
            return div;
        }

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', width);
        svg.setAttribute('height', height);
        svg.style.overflow = 'visible';

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        let d = `M ${points[0].x} ${points[0].y}`;

        if (curveType === 'bezier' && points.length >= 4) {
            // ベジェ曲線：制御点を使用
            for (let i = 1; i < points.length - 2; i += 3) {
                const cp1 = points[i];
                const cp2 = points[i + 1];
                const end = points[i + 2];
                d += ` C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${end.x} ${end.y}`;
            }
        } else {
            // スプライン曲線：カーブを滑らかに接続（簡易実装）
            for (let i = 1; i < points.length; i++) {
                const prev = points[i - 1];
                const curr = points[i];
                const midX = (prev.x + curr.x) / 2;
                const midY = (prev.y + curr.y) / 2;
                d += ` Q ${prev.x} ${prev.y}, ${midX} ${midY}`;
            }
            d += ` L ${points[points.length - 1].x} ${points[points.length - 1].y}`;
        }

        path.setAttribute('d', d);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', lineColor);
        path.setAttribute('stroke-width', lineWidth);

        svg.appendChild(path);

        div.style.position = 'absolute';
        div.style.left = `${left}px`;
        div.style.top = `${top}px`;
        div.style.zIndex = zIndex;
        div.style.pointerEvents = 'none';
        div.appendChild(svg);

        if (container) {
            container.appendChild(div);
        }

        return div;
    }

    /**
     * 画像要素（<image>）をDOM要素として描画
     * @param {Element} imageEl - image XML要素
     * @param {HTMLElement} container - 描画先コンテナ
     * @param {string} basePath - 画像パスのベースパス（実身ID）
     * @returns {HTMLElement} 作成されたDOM要素
     */
    renderImageElement(imageEl, container, basePath = '') {
        const div = document.createElement('div');
        div.className = 'figure-image';

        const id = imageEl.getAttribute('id');
        if (id) {
            div.dataset.id = id;
        }

        const left = parseFloat(imageEl.getAttribute('left')) || 0;
        const top = parseFloat(imageEl.getAttribute('top')) || 0;
        const right = parseFloat(imageEl.getAttribute('right')) || 0;
        const bottom = parseFloat(imageEl.getAttribute('bottom')) || 0;
        const href = imageEl.getAttribute('href') || imageEl.getAttribute('src') || '';
        const zIndex = parseInt(imageEl.getAttribute('zIndex')) || 0;

        const width = right - left;
        const height = bottom - top;

        const img = document.createElement('img');
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'contain';

        // 画像パスを解決
        if (href) {
            // basePathがある場合は相対パスを解決
            if (basePath && !href.startsWith('http') && !href.startsWith('data:')) {
                img.src = `../data/${href}`;
            } else {
                img.src = href;
            }
        }

        div.style.position = 'absolute';
        div.style.left = `${left}px`;
        div.style.top = `${top}px`;
        div.style.width = `${width}px`;
        div.style.height = `${height}px`;
        div.style.zIndex = zIndex;
        div.style.pointerEvents = 'none';
        div.appendChild(img);

        if (container) {
            container.appendChild(div);
        }

        return div;
    }

    /**
     * 図形要素全体をDOM要素として描画
     * xmlTADのfigure要素内の全図形要素を描画
     * @param {Document|Element} xmlDoc - XMLドキュメントまたはfigure要素
     * @param {HTMLElement} container - 描画先コンテナ
     * @returns {Object} 描画結果 { figureContainer, elementCount }
     */
    renderFigureElements(xmlDoc, container) {
        // figure要素を取得
        const figureEl = xmlDoc.querySelector ? xmlDoc.querySelector('figure') : null;
        if (!figureEl) {
            return { figureContainer: null, elementCount: 0 };
        }

        // 図形コンテナを作成
        const figureContainer = document.createElement('div');
        figureContainer.className = 'figure-content';
        figureContainer.style.position = 'absolute';
        figureContainer.style.left = '0';
        figureContainer.style.top = '0';

        // figView要素からサイズ取得
        const figView = figureEl.querySelector('figView');
        let figWidth = 800, figHeight = 600;
        if (figView) {
            figWidth = parseFloat(figView.getAttribute('right')) || 800;
            figHeight = parseFloat(figView.getAttribute('bottom')) || 600;
        }
        figureContainer.style.width = `${figWidth}px`;
        figureContainer.style.height = `${figHeight}px`;

        let elementCount = 0;

        // rect要素を描画
        const rectElements = figureEl.querySelectorAll('rect');
        rectElements.forEach(rectEl => {
            this.renderRectElement(rectEl, figureContainer);
            elementCount++;
        });

        // line要素を描画
        const lineElements = figureEl.querySelectorAll('line');
        lineElements.forEach(lineEl => {
            this.renderLineElement(lineEl, figureContainer);
            elementCount++;
        });

        // circle要素を描画
        const circleElements = figureEl.querySelectorAll('circle');
        circleElements.forEach(circleEl => {
            this.renderCircleElement(circleEl, figureContainer);
            elementCount++;
        });

        // polygon要素を描画
        const polygonElements = figureEl.querySelectorAll('polygon');
        polygonElements.forEach(polygonEl => {
            this.renderPolygonElement(polygonEl, figureContainer);
            elementCount++;
        });

        // ellipse要素（楕円）を描画
        const ellipseElements = figureEl.querySelectorAll('ellipse');
        ellipseElements.forEach(ellipseEl => {
            this.renderEllipseElement(ellipseEl, figureContainer);
            elementCount++;
        });

        // arc要素（円弧）を描画
        const arcElements = figureEl.querySelectorAll('arc');
        arcElements.forEach(arcEl => {
            this.renderArcElement(arcEl, figureContainer);
            elementCount++;
        });

        // chord要素（弦）を描画
        const chordElements = figureEl.querySelectorAll('chord');
        chordElements.forEach(chordEl => {
            this.renderChordElement(chordEl, figureContainer);
            elementCount++;
        });

        // elliptical_arc要素（楕円弧）を描画
        const ellipticalArcElements = figureEl.querySelectorAll('elliptical_arc');
        ellipticalArcElements.forEach(ellipticalArcEl => {
            this.renderEllipticalArcElement(ellipticalArcEl, figureContainer);
            elementCount++;
        });

        // polyline要素（折れ線）を描画
        const polylineElements = figureEl.querySelectorAll('polyline');
        polylineElements.forEach(polylineEl => {
            this.renderPolylineElement(polylineEl, figureContainer);
            elementCount++;
        });

        // curve要素（曲線）を描画
        const curveElements = figureEl.querySelectorAll('curve');
        curveElements.forEach(curveEl => {
            this.renderCurveElement(curveEl, figureContainer);
            elementCount++;
        });

        // image要素（画像）を描画
        const imageElements = figureEl.querySelectorAll('image');
        imageElements.forEach(imageEl => {
            this.renderImageElement(imageEl, figureContainer);
            elementCount++;
        });

        // document要素（テキストボックス）を描画
        const docElements = figureEl.querySelectorAll('document');
        docElements.forEach(docEl => {
            this.renderDocumentTextElement(docEl, figureContainer);
            elementCount++;
        });

        if (container) {
            container.appendChild(figureContainer);
        }

        return { figureContainer, elementCount };
    }

    /**
     * xmlTADヘッダーを構築
     * @param {string} version - バージョン（"1.0": 文書, "02.00": 図形）
     * @param {string} filename - 実身名（省略可能）
     * @returns {string} xmlTADヘッダー文字列
     */
    buildXmlTadHeader(version, filename) {
        if (filename) {
            return `<tad version="${version}" filename="${filename}" encoding="UTF-8">`;
        }
        return `<tad version="${version}" encoding="UTF-8">`;
    }

    /**
     * テキスト文書用のxmlTADを構築
     * 正しいxmlTAD形式でテキスト文書を生成する
     * @param {string} textContent - テキスト内容
     * @param {Object} options - オプション
     * @param {number} options.fontSize - フォントサイズ（デフォルト: 14）
     * @param {string} options.align - テキスト配置（'left', 'center', 'right'）
     * @param {string} options.filename - 実身名（省略可能）
     * @returns {string} xmlTAD文字列
     */
    buildTextDocumentXml(textContent, options = {}) {
        const fontSize = options.fontSize || DEFAULT_FONT_SIZE;
        const align = options.align || 'left';
        const filename = options.filename || '';

        let xmlContent = this.buildXmlTadHeader('1.0', filename) + '\n';
        xmlContent += '<document>\n';
        xmlContent += '<p>\n';

        // フォントサイズ指定（デフォルト値以外の場合）- <p>内に配置
        if (fontSize !== DEFAULT_FONT_SIZE) {
            xmlContent += `<font size="${fontSize}"/>\n`;
        }

        // 配置指定（左寄せ以外の場合）- <p>内に配置
        if (align !== 'left') {
            xmlContent += `<text align="${align}"/>\n`;
        }

        xmlContent += textContent;
        xmlContent += '\n</p>\n';
        xmlContent += '</document>\n';
        xmlContent += '</tad>\n';

        return xmlContent;
    }

    /**
     * <link>要素から仮身オブジェクトを解析
     * XMLのlink要素から仮身属性を読み取り、オブジェクトとして返す
     * @param {Element} linkElement - DOM link要素
     * @returns {Object|null} 仮身オブジェクト（エラー時はnull）
     */
    parseLinkElement(linkElement) {
        if (!linkElement) return null;

        try {
            const vobjleft = parseInt(linkElement.getAttribute('vobjleft')) || 0;
            const vobjtop = parseInt(linkElement.getAttribute('vobjtop')) || 0;
            const vobjright = parseInt(linkElement.getAttribute('vobjright')) || 0;
            const vobjbottom = parseInt(linkElement.getAttribute('vobjbottom')) || 0;

            return {
                // 識別属性
                link_id: linkElement.getAttribute('id') || '',
                link_name: linkElement.textContent?.trim() || '',
                // 座標属性
                vobjleft: vobjleft,
                vobjtop: vobjtop,
                vobjright: vobjright,
                vobjbottom: vobjbottom,
                width: vobjright - vobjleft,
                heightPx: vobjbottom - vobjtop,
                height: parseInt(linkElement.getAttribute('height')) || 0,
                // スタイル属性
                chsz: parseInt(linkElement.getAttribute('chsz')) || DEFAULT_FONT_SIZE,
                frcol: linkElement.getAttribute('frcol') || DEFAULT_FRCOL,
                chcol: linkElement.getAttribute('chcol') || DEFAULT_CHCOL,
                tbcol: linkElement.getAttribute('tbcol') || DEFAULT_TBCOL,
                bgcol: linkElement.getAttribute('bgcol') || DEFAULT_BGCOL,
                dlen: parseInt(linkElement.getAttribute('dlen')) || 0,
                // 表示属性
                pictdisp: linkElement.getAttribute('pictdisp') || 'true',
                namedisp: linkElement.getAttribute('namedisp') || 'true',
                roledisp: linkElement.getAttribute('roledisp') || 'false',
                typedisp: linkElement.getAttribute('typedisp') || 'false',
                updatedisp: linkElement.getAttribute('updatedisp') || 'false',
                framedisp: linkElement.getAttribute('framedisp') || 'true',
                autoopen: linkElement.getAttribute('autoopen') || 'false',
                // 仮身固有の続柄（link要素のrelationship属性）
                linkRelationship: this.parseLinkRelationship(linkElement)
            };
        } catch (error) {
            return null;
        }
    }

    /**
     * 仮身オブジェクトデータを生成（デフォルト値付き）
     * 仮身の全属性を一元管理し、標準的な仮身オブジェクトを生成する
     * @param {Object} baseData - 基本データ
     * @param {string} baseData.link_id - 仮身ID（必須）
     * @param {string} [baseData.link_name] - 仮身名
     * @param {number} [baseData.vobjleft] - 左座標
     * @param {number} [baseData.vobjtop] - 上座標
     * @param {number} [baseData.vobjright] - 右座標
     * @param {number} [baseData.vobjbottom] - 下座標
     * @param {number} [baseData.heightPx] - 高さ（ピクセル）
     * @param {number} [baseData.chsz] - 文字サイズ
     * @param {string} [baseData.frcol] - 枠色
     * @param {string} [baseData.chcol] - 文字色
     * @param {string} [baseData.tbcol] - タイトルバー背景色
     * @param {string} [baseData.bgcol] - 背景色
     * @param {number} [baseData.dlen] - データ長
     * @param {string} [baseData.pictdisp] - アイコン表示（'true'/'false'）
     * @param {string} [baseData.namedisp] - 名前表示（'true'/'false'）
     * @param {string} [baseData.roledisp] - 続柄表示（'true'/'false'）
     * @param {string} [baseData.typedisp] - 型表示（'true'/'false'）
     * @param {string} [baseData.updatedisp] - 更新日表示（'true'/'false'）
     * @param {string} [baseData.framedisp] - 枠表示（'true'/'false'）
     * @param {string} [baseData.autoopen] - 自動オープン（'true'/'false'）
     * @returns {Object} 完全な仮身オブジェクト
     */
    createVirtualObjectData(baseData) {
        return {
            // 必須属性
            link_id: baseData.link_id,
            link_name: baseData.link_name || '',
            // 座標属性
            vobjleft: baseData.vobjleft !== undefined ? baseData.vobjleft : 10,
            vobjtop: baseData.vobjtop !== undefined ? baseData.vobjtop : 10,
            vobjright: baseData.vobjright !== undefined ? baseData.vobjright : 160,
            vobjbottom: baseData.vobjbottom !== undefined ? baseData.vobjbottom : 40,
            heightPx: baseData.heightPx !== undefined ? baseData.heightPx : DEFAULT_VOBJ_HEIGHT,
            // スタイル属性
            chsz: baseData.chsz !== undefined ? baseData.chsz : DEFAULT_FONT_SIZE,
            frcol: baseData.frcol || DEFAULT_FRCOL,
            chcol: baseData.chcol || DEFAULT_CHCOL,
            tbcol: baseData.tbcol || DEFAULT_TBCOL,
            bgcol: baseData.bgcol || DEFAULT_BGCOL,
            dlen: baseData.dlen !== undefined ? baseData.dlen : 0,
            // 表示属性（文字列として）
            pictdisp: baseData.pictdisp !== undefined ? baseData.pictdisp : 'true',
            namedisp: baseData.namedisp !== undefined ? baseData.namedisp : 'true',
            roledisp: baseData.roledisp !== undefined ? baseData.roledisp : 'false',
            typedisp: baseData.typedisp !== undefined ? baseData.typedisp : 'false',
            updatedisp: baseData.updatedisp !== undefined ? baseData.updatedisp : 'false',
            framedisp: baseData.framedisp !== undefined ? baseData.framedisp : 'true',
            autoopen: baseData.autoopen !== undefined ? baseData.autoopen : 'false',
            // 仮身固有の続柄（link要素のrelationship属性）
            linkRelationship: baseData.linkRelationship || []
        };
    }

    /**
     * 仮身用のlink要素に標準属性を設定
     * virtual-object-listと同じ属性セットを設定する
     * @param {Element} linkElement - DOM link要素
     * @param {Object} virtualObj - 仮身オブジェクト
     */
    buildLinkElementAttributes(linkElement, virtualObj) {
        // 必須属性
        linkElement.setAttribute('id', virtualObj.link_id);
        linkElement.setAttribute('vobjleft', (virtualObj.vobjleft || 10).toString());
        linkElement.setAttribute('vobjtop', (virtualObj.vobjtop || 10).toString());
        linkElement.setAttribute('vobjright', (virtualObj.vobjright || 160).toString());
        linkElement.setAttribute('vobjbottom', (virtualObj.vobjbottom || 40).toString());
        linkElement.setAttribute('height', (virtualObj.heightPx || DEFAULT_VOBJ_HEIGHT).toString());
        linkElement.setAttribute('chsz', (virtualObj.chsz || DEFAULT_FONT_SIZE).toString());
        linkElement.setAttribute('frcol', virtualObj.frcol || DEFAULT_FRCOL);
        linkElement.setAttribute('chcol', virtualObj.chcol || DEFAULT_CHCOL);
        linkElement.setAttribute('tbcol', virtualObj.tbcol || DEFAULT_TBCOL);
        linkElement.setAttribute('bgcol', virtualObj.bgcol || DEFAULT_BGCOL);
        linkElement.setAttribute('dlen', (virtualObj.dlen || 0).toString());

        // 表示属性（デフォルト値を設定）
        linkElement.setAttribute('pictdisp', virtualObj.pictdisp !== undefined ? virtualObj.pictdisp.toString() : 'true');
        linkElement.setAttribute('namedisp', virtualObj.namedisp !== undefined ? virtualObj.namedisp.toString() : 'true');
        linkElement.setAttribute('roledisp', virtualObj.roledisp !== undefined ? virtualObj.roledisp.toString() : 'false');
        linkElement.setAttribute('typedisp', virtualObj.typedisp !== undefined ? virtualObj.typedisp.toString() : 'false');
        linkElement.setAttribute('updatedisp', virtualObj.updatedisp !== undefined ? virtualObj.updatedisp.toString() : 'false');
        linkElement.setAttribute('framedisp', virtualObj.framedisp !== undefined ? virtualObj.framedisp.toString() : 'true');
        linkElement.setAttribute('autoopen', virtualObj.autoopen !== undefined ? virtualObj.autoopen.toString() : 'false');

        // 仮身固有の続柄（link要素のrelationship属性）
        if (virtualObj.linkRelationship && virtualObj.linkRelationship.length > 0) {
            linkElement.setAttribute('relationship', virtualObj.linkRelationship.join(' '));
        } else {
            // 空の場合は属性を削除
            linkElement.removeAttribute('relationship');
        }

        // テキスト内容は書き込まない（自己閉じタグ形式）
        // link_nameはJSONから取得する方式に統一
    }

    /**
     * 原紙アイコンコピーを要求
     * @param {string} realId - 実身ID
     * @param {string} pluginId - プラグインID
     * @returns {Promise<boolean>} 成功/失敗
     */
    async requestCopyTemplateIcon(realId, pluginId) {
        const messageId = this.generateMessageId('copy-icon');
        this.messageBus.send('copy-template-icon', {
            realId: realId,
            pluginId: pluginId,
            messageId: messageId
        });

        try {
            const result = await this.messageBus.waitFor('template-icon-copied',
                window.DEFAULT_TIMEOUT_MS,
                (data) => data.messageId === messageId
            );
            return result.success;
        } catch (error) {
            return false;
        }
    }

    /**
     * 図形コンテナにスケーリングを適用
     * アスペクト比を維持してコンテナサイズに合わせる
     * @param {HTMLElement} outerContainer - 外側のコンテナ（スケーリング適用先）
     * @param {HTMLElement} figureContainer - 図形コンテナ（.figure-content）
     * @param {number} baseWidth - 基本幅（デフォルト: 800）
     * @param {number} baseHeight - 基本高さ（デフォルト: 600）
     * @returns {number} 適用されたスケール値
     */
    applyFigureScaling(outerContainer, figureContainer, baseWidth = 800, baseHeight = 600) {
        if (!outerContainer || !figureContainer) {
            return 1;
        }

        const containerWidth = outerContainer.clientWidth;
        const containerHeight = outerContainer.clientHeight;

        // アスペクト比を維持したスケール計算
        const scaleX = containerWidth / baseWidth;
        const scaleY = containerHeight / baseHeight;
        const scale = Math.min(scaleX, scaleY);

        // 最小スケール制限（400x300 = 0.5）
        const minScale = 0.5;
        const finalScale = Math.max(scale, minScale);

        // トランスフォーム適用
        figureContainer.style.transformOrigin = 'top left';
        figureContainer.style.transform = `scale(${finalScale})`;

        return finalScale;
    }

    // ========================================
    // line-height計算関連メソッド
    // ========================================

    /**
     * DOM要素/DocumentFragment内の最大フォントサイズを計算
     * @param {Element|DocumentFragment} content - 対象要素
     * @param {number} defaultSize - デフォルトサイズ（pt）
     * @returns {number} 最大フォントサイズ（pt）
     */
    calculateMaxFontSizeInContent(content, defaultSize = DEFAULT_FONT_SIZE) {
        let maxSize = defaultSize;

        // DocumentFragmentまたはElementの場合
        if (content && (content.nodeType === Node.DOCUMENT_FRAGMENT_NODE || content.nodeType === Node.ELEMENT_NODE)) {
            // 直接のテキストノードがある場合はデフォルトサイズを使用
            // スタイル付き要素（span, font）を検索
            const styledElements = content.querySelectorAll('[style*="font-size"]');
            styledElements.forEach(el => {
                const style = el.style.fontSize;
                if (style) {
                    let size;
                    if (style.endsWith('pt')) {
                        size = parseFloat(style);
                    } else if (style.endsWith('px')) {
                        // pxをptに変換（1pt ≈ 1.333px）
                        size = parseFloat(style) / 1.333;
                    }
                    if (!isNaN(size) && size > maxSize) {
                        maxSize = size;
                    }
                }
            });
        }

        return maxSize;
    }

    /**
     * xmlTADの段落コンテンツから最大フォントサイズを計算
     * 自己閉じタグとペアタグの両方を検出
     * @param {string} paragraphContent - 段落のXMLコンテンツ
     * @param {number} defaultSize - デフォルトサイズ（pt）
     * @returns {number} 最大フォントサイズ（pt）
     */
    calculateMaxFontSizeFromXml(paragraphContent, defaultSize = DEFAULT_FONT_SIZE) {
        let maxSize = defaultSize;

        // 自己閉じタグ形式: <font size="18"/>
        const selfClosingRegex = /<font\s+size="([^"]*)"\s*\/>/gi;
        let match;
        while ((match = selfClosingRegex.exec(paragraphContent)) !== null) {
            const size = parseFloat(match[1]);
            if (!isNaN(size) && size > maxSize) {
                maxSize = size;
            }
        }

        // ペアタグ形式: <font size="18">...</font>
        const pairTagRegex = /<font\s+size="([^"]*)">/gi;
        while ((match = pairTagRegex.exec(paragraphContent)) !== null) {
            const size = parseFloat(match[1]);
            if (!isNaN(size) && size > maxSize) {
                maxSize = size;
            }
        }

        return maxSize;
    }

    /**
     * フォントサイズに基づいてline-heightを計算
     * @param {number} fontSize - フォントサイズ（pt）
     * @param {number} ratio - line-height係数（デフォルト: 1.5）
     * @returns {number} line-height（px）
     */
    calculateLineHeight(fontSize, ratio = 1.5) {
        return fontSize * ratio;
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
    frcol: DEFAULT_FRCOL,
    chcol: DEFAULT_CHCOL,
    tbcol: DEFAULT_TBCOL,
    bgcol: DEFAULT_BGCOL,
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

// ========================================
// 線種パターン定義
// ========================================

/**
 * 線種パターン定義（TAD仕様準拠）
 * Canvas の setLineDash() に渡す配列を定義
 * @type {Object.<number, number[]>}
 */
PluginBase.LINE_PATTERN_DEFINITIONS = {
    0: [],                    // 実線
    1: [6, 3],               // 破線
    2: [2, 2],               // 点線
    3: [8, 3, 2, 3],         // 一点鎖線
    4: [8, 3, 2, 3, 2, 3],   // 二点鎖線
    5: [12, 4]               // 長破線
};

/**
 * 線種の日本語名定義
 * @type {Object.<number, string>}
 */
PluginBase.LINE_TYPE_NAMES = {
    0: '実線',
    1: '破線',
    2: '点線',
    3: '一点鎖線',
    4: '二点鎖線',
    5: '長破線'
};
