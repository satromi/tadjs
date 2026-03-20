/**
 * PluginBase 仮身ドラッグ機能モジュール
 * 仮身のドラッグ&ドロップ、ダブルクリック+ドラッグ、右ボタンドラッグを提供
 *
 * plugin-base.js から分離された機能モジュール
 */
import { getLogger } from './logger.js';
import { DEFAULT_TIMEOUT_MS } from './util.js';

// UuidV7Generatorはグローバルスコープから取得（uuid-v7.jsがHTMLで先に読み込まれる前提）
const UuidV7Generator = globalThis.UuidV7Generator;

const logger = getLogger('PluginBase');

/**
 * 仮身ドラッグ関連メソッドをPluginBaseのprototypeに追加する
 * @param {Function} PluginBaseClass - PluginBaseクラス
 */
export function applyVobjDragMethods(PluginBaseClass) {
    const proto = PluginBaseClass.prototype;

    // ========================================
    // ドラッグ関連の共通メソッド
    // ========================================

    /**
     * ダブルクリック+ドラッグ候補を設定
     * @param {HTMLElement} element - ダブルクリックされた要素
     * @param {MouseEvent} event - マウスイベント
     */
    proto.setDoubleClickDragCandidate = function(element, event) {
        this.dblClickDragState.isDblClickDragCandidate = true;
        this.dblClickDragState.dblClickedElement = element;
        this.dblClickDragState.startX = event.clientX;
        this.dblClickDragState.startY = event.clientY;
    };

    /**
     * ダブルクリックタイマーをリセット（通常のクリック時）
     */
    proto.resetDoubleClickTimer = function() {
        this.dblClickDragState.lastClickTime = Date.now();
        this.dblClickDragState.isDblClickDragCandidate = false;
    };

    /**
     * ダブルクリック+ドラッグを開始すべきか判定
     * @param {MouseEvent} event - マウスイベント
     * @param {number} threshold - ドラッグ開始のしきい値（px）
     * @returns {boolean} ドラッグを開始すべきならtrue
     */
    proto.shouldStartDblClickDrag = function(event, threshold = 5) {
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
    };

    /**
     * ダブルクリック+ドラッグ状態をクリーンアップ
     * 各プラグインは、このメソッドを呼び出した後、固有のプロパティをクリーンアップすること
     * （例: dragPreview, dblClickedShape, dblClickedObject など）
     */
    proto.cleanupDblClickDragState = function() {
        this.dblClickDragState.isDblClickDrag = false;
        this.dblClickDragState.isDblClickDragCandidate = false;
        this.dblClickDragState.dblClickedElement = null;
    };

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
    proto.setupVirtualObjectRightButtonHandlers = function() {
        if (this._vobjRightButtonSetup) return;
        this._vobjRightButtonSetup = true;

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
    };

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
    proto.initializeVirtualObjectDragStart = function(e) {
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
    };

    /**
     * ドラッグ中の移動を検出
     * サブクラスのdragoverハンドラーから呼び出す
     *
     * しきい値（dragThreshold, デフォルト5px）以上移動した場合にtrue
     *
     * @param {DragEvent} e - dragoverイベント
     * @returns {boolean} 移動が検出されたらtrue
     */
    proto.detectVirtualObjectDragMove = function(e) {
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
    };

    /**
     * 仮身ドラッグ終了時のクリーンアップ
     * サブクラスのdragend/dropハンドラーから呼び出す
     *
     * 注意: isRightButtonPressedはmouseupハンドラおよびinitializeVirtualObjectDragStart()で管理されます
     */
    proto.cleanupVirtualObjectDragState = function() {
        this.virtualObjectDragState.isDragging = false;
        this.virtualObjectDragState.hasMoved = false;
        this.virtualObjectDragState.dragMode = 'move'; // 次のドラッグのためにデフォルトに戻す
        // isRightButtonPressedはmouseupハンドラおよびinitializeVirtualObjectDragStart()で管理
    };

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
     */
    proto.duplicateRealObjectForDrag = async function(virtualObject) {
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
            link_name: result.newName,
            vobjid: UuidV7Generator.generate()
        };
    };

    /**
     * 原紙箱からのドロップ処理（共通メソッド）
     * サブクラスのdropハンドラーから呼び出す
     *
     * @param {Object} dragData - ドラッグデータ
     * @param {number} clientX - ドロップ位置のX座標
     * @param {number} clientY - ドロップ位置のY座標
     * @param {Object} [additionalData] - 追加データ（オプション）
     */
    proto.handleBaseFileDrop = function(dragData, clientX, clientY, additionalData = {}) {
        this.messageBus.send('base-file-drop-request', {
            dragData: dragData,
            clientX: clientX,
            clientY: clientY,
            ...additionalData
        });
    };

    /**
     * DataTransferからURLを抽出
     * ブラウザからのURLドラッグ対応
     *
     * @param {DataTransfer} dataTransfer - ドロップイベントのdataTransfer
     * @returns {string|null} 抽出したURL、またはnull
     */
    proto.extractUrlFromDataTransfer = function(dataTransfer) {
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
    };

    /**
     * URLドロップをチェックし、検出した場合は親ウィンドウに転送
     * サブクラスのdropハンドラーから呼び出す
     *
     * @param {DragEvent} e - ドロップイベント
     * @param {number} dropX - ドロップ位置X（iframe内座標）
     * @param {number} dropY - ドロップ位置Y（iframe内座標）
     * @returns {boolean} URLドロップを検出・処理した場合はtrue
     */
    proto.checkAndHandleUrlDrop = function(e, dropX, dropY) {
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
    };

    /**
     * 開いた仮身のiframe pointer-eventsを無効化
     * ドラッグ中に開いた仮身内へのドロップを防ぐ
     * サブクラスのdragstartハンドラーから呼び出す
     */
    proto.disableIframePointerEvents = function() {
        const allIframes = document.querySelectorAll('.virtual-object-content');
        allIframes.forEach(iframe => {
            iframe.style.pointerEvents = 'none';
        });
    };

    /**
     * 開いた仮身のiframe pointer-eventsを再有効化
     * ドラッグ終了時に開いた仮身内のインタラクションを復元
     * サブクラスのdragendハンドラーから呼び出す
     */
    proto.enableIframePointerEvents = function() {
        const allIframes = document.querySelectorAll('.virtual-object-content');
        allIframes.forEach(iframe => {
            iframe.style.pointerEvents = 'auto';
        });
    };

    /**
     * ドロップ時のdataTransferからJSONデータをパース
     * サブクラスのdropハンドラーから呼び出す
     *
     * @param {DataTransfer} dataTransfer - e.dataTransfer
     * @returns {Object|null} パースされたJSONオブジェクト、失敗時はnull
     */
    proto.parseDragData = function(dataTransfer) {
        const data = dataTransfer.getData('text/plain');
        if (!data) return null;

        try {
            return JSON.parse(data);
        } catch (_jsonError) {
            return null;
        }
    };

    /**
     * 仮身ドラッグデータを構築してdataTransferに設定
     * サブクラスのdragstartハンドラーから呼び出す
     *
     * @param {DragEvent} e - dragstartイベント
     * @param {Array<Object>} virtualObjects - 仮身オブジェクト配列
     * @param {string} sourceName - ドラッグ元プラグイン名（例: 'basic-text-editor'）
     * @param {boolean} [isDuplicateDrag=false] - ダブルクリックドラッグ（実身複製）フラグ
     * @returns {Object} 構築されたdragDataオブジェクト
     */
    proto.setVirtualObjectDragData = function(e, virtualObjects, sourceName, isDuplicateDrag = false) {
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
    };

    /**
     * DOM要素のdatasetから仮身オブジェクトを構築
     * data-link-* 属性を link_* 形式に変換し、短い形式のプロパティも追加
     *
     * @param {DOMStringMap} dataset - DOM要素のdataset（element.dataset）
     * @returns {Object} 仮身オブジェクト（link_id, link_name, tbcol, frcol, chsz等を含む）
     */
    proto.buildVirtualObjFromDataset = function(dataset) {
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

        // vobjid（仮身固有ID）
        if (virtualObj.link_vobjid) virtualObj.vobjid = virtualObj.link_vobjid;

        // scrollx/scrolly/zoomratio（仮身ごとのスクロール位置・ズーム率）
        if (virtualObj.link_scrollx !== undefined) virtualObj.scrollx = parseFloat(virtualObj.link_scrollx);
        if (virtualObj.link_scrolly !== undefined) virtualObj.scrolly = parseFloat(virtualObj.link_scrolly);
        if (virtualObj.link_zoomratio !== undefined) virtualObj.zoomratio = parseFloat(virtualObj.link_zoomratio);

        return virtualObj;
    };

    // ========================================
    // cross-window-drop-success ハンドラ
    // ========================================

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
    proto.setupCrossWindowDropSuccessHandler = function() {
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
    };

    // ========================================
    // 仮身ドラッグ関連のフックメソッド
    // ========================================

    /**
     * ドラッグモードが変更された時のフック（サブクラスでオーバーライド）
     * setupVirtualObjectRightButtonHandlers()で右ボタン操作時に呼ばれる
     *
     * @param {string} newMode - 新しいモード ('move' | 'copy')
     */
    proto.onDragModeChanged = function(newMode) {
        // デフォルト実装は空（サブクラスで必要に応じてオーバーライド）
    };

    /**
     * 元の仮身オブジェクトを削除するフック（サブクラスで実装必須）
     * cross-window-drop-successでmoveモード時に呼ばれる
     *
     * @param {Object} data - ドロップ成功データ
     */
    proto.onDeleteSourceVirtualObject = function(data) {
        // デフォルト実装は空（サブクラスで必ず実装すること）
        logger.warn(`[${this.pluginName}] onDeleteSourceVirtualObject が実装されていません`);
    };

    /**
     * cross-window-drop-success処理完了後のフック（サブクラスでオーバーライド）
     * ドラッグ状態のクリーンアップ後に呼ばれる
     *
     * @param {Object} data - ドロップ成功データ
     */
    proto.onCrossWindowDropSuccess = function(data) {
        // デフォルト実装は空（サブクラスで必要に応じてオーバーライド）
    };

    // ========================================
    // 仮身refCount管理（共通メソッド）
    // ========================================

    /**
     * 仮身コピー要求（refCount+1）
     * 新しい仮身参照が作成された時に呼び出す
     *
     * @param {string} linkId - 仮身のlink_id
     */
    proto.requestCopyVirtualObject = function(linkId) {
        const realId = this.extractRealId(linkId);
        this.messageBus.send('copy-virtual-object', {
            realId: realId,
            messageId: this.generateMessageId('copy-virtual')
        });
    };

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
    proto.requestDeleteVirtualObject = function(linkId) {
        const realId = this.extractRealId(linkId);
        this.messageBus.send('delete-virtual-object', {
            realId: realId,
            messageId: this.generateMessageId('delete-virtual')
        });
    };
}
