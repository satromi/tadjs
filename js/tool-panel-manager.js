/**
 * ToolPanelManager - ツールパネル管理クラス
 * TADjs Desktopのツールパネル（道具パネル）の作成・管理・ドラッグ・ポップアップを担当
 * @module ToolPanelManager
 */

import { getLogger } from './logger.js';
import { UI_UPDATE_DELAY_MS, HOVER_BG_COLOR } from './util.js';

const logger = getLogger('ToolPanelManager');

export class ToolPanelManager {
    /**
     * @param {Object} options - 初期化オプション
     * @param {Object} options.parentMessageBus - メッセージバス
     * @param {Function} options.createWindow - ウィンドウ作成関数
     * @param {Function} options.getWindows - windows Mapを取得する関数
     */
    constructor(options = {}) {
        this.parentMessageBus = options.parentMessageBus;
        this.createWindow = options.createWindow;
        this.getWindows = options.getWindows;

        // ツールパネルとエディタの関連管理
        this.toolPanelRelations = {};

        // ドラッグ状態
        this.isToolPanelDragging = false;
        this.toolPanelDragState = null;
        this._boundHandleToolPanelDrag = null;
        this._boundEndToolPanelDrag = null;

        // ポップアップ状態
        this.toolPanelPopupSource = null;
        this.toolPanelPopupCloseHandler = null;
        this.toolPanelPopupCloseHandlers = [];

        logger.debug('ToolPanelManager initialized');
    }

    /**
     * ツールパネルウィンドウを開く
     * @param {string} pluginId - プラグインID
     * @param {Object} settings - 設定
     * @param {HTMLIFrameElement} pluginIframe - プラグインのiframe
     * @param {Object} panelpos - パネル位置 {x, y}
     */
    openToolPanelWindow(pluginId, settings, pluginIframe, panelpos, panelsize) {
        const pluginPath = `plugins/${pluginId}/tool-panel.html`;

        const content = `<iframe src="${pluginPath}" style="width: 100%; height: 100%; border: none;"></iframe>`;

        // panelposが指定されていればそれを使用、なければデフォルト位置
        const pos = panelpos || { x: 50, y: 50 };
        // panelsizeが指定されていればそれを使用、なければデフォルトサイズ
        const size = panelsize || { width: 424, height: 80 };
        logger.info('[ToolPanelManager] 道具パネル位置:', pos, 'サイズ:', size);

        const windowId = this.createWindow('道具パネル', content, {
            width: size.width,
            height: size.height,
            x: pos.x,
            y: pos.y,
            resizable: false,
            closeable: true,
            alwaysOnTop: true,
            cssClass: 'tool-panel-window',
            scrollable: false,  // スクロールバー非表示
            frame: false  // タイトルバーを非表示
        });

        // 道具パネルと編集ウィンドウの関連付けを保存
        this.toolPanelRelations[windowId] = {
            editorIframe: pluginIframe,
            toolPanelWindowId: windowId
        };

        // 道具パネルウィンドウに初期設定を送信
        setTimeout(() => {
            const windowElement = document.getElementById(windowId);
            if (windowElement) {
                const iframe = windowElement.querySelector('iframe');
                if (iframe && iframe.contentWindow) {
                    // 道具パネルiframeへの参照も保存
                    this.toolPanelRelations[windowId].toolPanelIframe = iframe;

                    // MessageBusにiframeを登録
                    this.parentMessageBus.registerChild(windowId, iframe, {
                        windowId: windowId,
                        pluginId: pluginId
                    });

                    this.parentMessageBus.sendToWindow(windowId, 'init-tool-panel', {
                        settings: settings
                    });
            }
            }

            // プラグインに道具パネルウィンドウのIDを通知
            if (pluginIframe && pluginIframe.contentWindow) {
                const pluginWindowId = this.parentMessageBus.getWindowIdFromIframe(pluginIframe);
                if (pluginWindowId) {
                    this.parentMessageBus.sendToWindow(pluginWindowId, 'tool-panel-window-created', {
                        windowId: windowId
                    });
                } else {
                    logger.warn('[ToolPanelManager] pluginWindowIdが見つかりませんでした。tool-panel-window-createdメッセージを送信できません。');
                }
            }
         }, UI_UPDATE_DELAY_MS);

        logger.info('[ToolPanelManager] 道具パネルウィンドウ作成:', windowId);
    }

    /**
     * ツールパネルのドラッグを開始
     * @param {HTMLElement} toolPanelWindow - 道具パネルウィンドウ要素
     * @param {number} iframeClientX - iframe内のクライアントX座標
     * @param {number} iframeClientY - iframe内のクライアントY座標
     */
    startToolPanelDrag(toolPanelWindow, iframeClientX, iframeClientY) {
        // 既存のハンドラをクリーンアップ
        if (this._boundHandleToolPanelDrag) {
            document.removeEventListener('mousemove', this._boundHandleToolPanelDrag);
        }
        if (this._boundEndToolPanelDrag) {
            document.removeEventListener('mouseup', this._boundEndToolPanelDrag);
        }

        // iframeの位置を取得
        const iframe = toolPanelWindow.querySelector('iframe');
        const iframeRect = iframe.getBoundingClientRect();

        // iframeのクライアント座標をページ座標に変換
        const pageX = iframeRect.left + iframeClientX;
        const pageY = iframeRect.top + iframeClientY;

        this.isToolPanelDragging = true;
        this.toolPanelDragState = {
            element: toolPanelWindow,
            startX: pageX - toolPanelWindow.offsetLeft,
            startY: pageY - toolPanelWindow.offsetTop,
            currentX: null,
            currentY: null,
            lastUpdateTime: 0,
            rafId: null
        };

        this._boundHandleToolPanelDrag = this.handleToolPanelDrag.bind(this);
        this._boundEndToolPanelDrag = this.endToolPanelDrag.bind(this);

        document.addEventListener('mousemove', this._boundHandleToolPanelDrag);
        document.addEventListener('mouseup', this._boundEndToolPanelDrag);

        // ドラッグ中はiframeのポインタイベントを無効化
        const allIframes = document.querySelectorAll('iframe');
        allIframes.forEach(iframe => {
            iframe.style.pointerEvents = 'none';
        });

        logger.debug('[ToolPanelManager] ドラッグ開始: iframeのポインタイベントを無効化');
    }

    /**
     * ツールパネルのドラッグを処理
     * @param {MouseEvent} e - マウスイベント
     */
    handleToolPanelDrag(e) {
        if (!this.isToolPanelDragging || !this.toolPanelDragState) return;

        // 現在のマウス位置を保存
        this.toolPanelDragState.currentX = e.clientX - this.toolPanelDragState.startX;
        this.toolPanelDragState.currentY = e.clientY - this.toolPanelDragState.startY;

        // requestAnimationFrameでパフォーマンスを最適化
        if (!this.toolPanelDragState.rafId) {
            this.toolPanelDragState.rafId = requestAnimationFrame((timestamp) => {
                if (this.toolPanelDragState && this.toolPanelDragState.currentX !== null && this.toolPanelDragState.currentY !== null) {
                    // 100msごとに更新を抑制（スロットリング）
                    if (timestamp - this.toolPanelDragState.lastUpdateTime >= 100) {
                        this.toolPanelDragState.element.style.left = this.toolPanelDragState.currentX + 'px';
                        this.toolPanelDragState.element.style.top = this.toolPanelDragState.currentY + 'px';
                        this.toolPanelDragState.lastUpdateTime = timestamp;
                    }
                    this.toolPanelDragState.rafId = null;
                }
            });
        }
    }

    /**
     * ツールパネルのドラッグを終了
     */
    endToolPanelDrag() {
        // 未完了のrequestAnimationFrameをキャンセル
        if (this.toolPanelDragState && this.toolPanelDragState.rafId) {
            cancelAnimationFrame(this.toolPanelDragState.rafId);
        }

        // 最終位置をエディタに通知
        if (this.toolPanelDragState && this.toolPanelDragState.element) {
            const toolPanelWindow = this.toolPanelDragState.element;
            const rect = toolPanelWindow.getBoundingClientRect();
            const windowId = toolPanelWindow.dataset.windowId;

            // 対応するエディタにツールパネルの移動を通知
            if (this.toolPanelRelations && this.toolPanelRelations[windowId]) {
                const relation = this.toolPanelRelations[windowId];
                const editorIframe = relation.editorIframe;
                if (editorIframe) {
                    const editorWindowId = this.parentMessageBus.getWindowIdFromIframe(editorIframe);
                    if (editorWindowId) {
                        this.parentMessageBus.sendToWindow(editorWindowId, 'tool-panel-window-moved', {
                            pos: {
                                x: rect.left,
                                y: rect.top
                            }
                        });

                        logger.debug('[ToolPanelManager] 道具パネル移動終了を通知:', { x: rect.left, y: rect.top });
                    }
                }
            }
        }

        this.isToolPanelDragging = false;
        this.toolPanelDragState = null;

        // イベントリスナーを削除
        if (this._boundHandleToolPanelDrag) {
            document.removeEventListener('mousemove', this._boundHandleToolPanelDrag);
            this._boundHandleToolPanelDrag = null;
        }
        if (this._boundEndToolPanelDrag) {
            document.removeEventListener('mouseup', this._boundEndToolPanelDrag);
            this._boundEndToolPanelDrag = null;
        }

        // ドラッグ終了後、iframeのポインタイベントを再有効化
        const allIframes = document.querySelectorAll('iframe');
        allIframes.forEach(iframe => {
            iframe.style.pointerEvents = 'auto';
        });

        logger.debug('[ToolPanelManager] ドラッグ終了: iframeのポインタイベントを再有効化');
    }

    /**
     * ツールパネルポップアップを表示
     * @param {Object} data - ポップアップデータ {htmlContent, x, y}
     * @param {Window} source - ツールパネルのWindow
     */
    showToolPanelPopup(data, source) {
        // 既存のポップアップがあれば削除
        this.hideToolPanelPopup();

        // クローズ用のイベントハンドラを保存
        this.toolPanelPopupCloseHandler = null;

        // ポップアップの呼び出し元を保存（閉じる判定に使用）
        this.toolPanelPopupSource = source;

        // エディタにポップアップが開いたことを通知
        const editorFrame = this.getEditorFrameFromToolPanel(source);
        if (editorFrame && editorFrame.contentWindow) {
            const editorWindowId = this.parentMessageBus.getWindowIdFromIframe(editorFrame);
            if (editorWindowId) {
                this.parentMessageBus.sendToWindow(editorWindowId, 'tool-panel-popup-opened', {});
            } else {
                logger.warn('[ToolPanelManager] エディタのwindowIdが見つかりません');
            }
        } else {
            logger.warn('[ToolPanelManager] エディタが見つからないため通知送信失敗');
        }

        // ポップアップ要素を作成
        const popup = document.createElement('div');
        popup.id = 'tool-panel-popup';
        popup.style.cssText = `
            position: fixed;
            background: #c0c0c0;
            border: 2px outset #ffffff;
            box-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
            padding: 8px;
            z-index: 10000;
            min-width: 150px;
            max-height: 400px;
            overflow-y: auto;
            overflow-x: hidden;
        `;

        // HTMLコンテンツを設定
        popup.innerHTML = data.htmlContent;

        // 位置を設定
        popup.style.left = data.x + 'px';
        popup.style.top = data.y + 'px';

        // DOMに追加
        document.body.appendChild(popup);

        // ポップアップ内のイベントハンドラを設定
        const handlePopupClick = (e) => {
            // 外側へのイベント伝播は止める
            e.stopPropagation();

            // チェックボックス、select、color pickerなどのデフォルト動作は妨げない
            const tagName = e.target.tagName.toLowerCase();
            const inputType = e.target.type;
            if (tagName === 'input' && (inputType === 'checkbox' || inputType === 'color')) {
                // チェックボックスとカラーピッカーはpreventDefaultしない
                return;
            }
            if (tagName === 'select' || tagName === 'option') {
                // selectもpreventDefaultしない
                return;
            }

            if (e.target.classList.contains('grid-interval-btn')) {
                e.preventDefault();
                const interval = parseInt(e.target.dataset.interval);

                // すべての間隔ボタンの背景色をリセット
                popup.querySelectorAll('.grid-interval-btn').forEach(btn => {
                    btn.style.background = 'white';
                });

                // クリックされたボタンを選択状態にする
                e.target.style.background = HOVER_BG_COLOR;

                this.sendToToolPanelSource(source, 'popup-grid-interval-click', {
                    interval: interval
                });
            } else if (e.target.classList.contains('material-tool-btn')) {
                e.preventDefault();
                const tool = e.target.dataset.materialTool;

                // すべての画材ツールボタンの背景色をリセット
                popup.querySelectorAll('.material-tool-btn').forEach(btn => {
                    btn.style.background = 'white';
                });

                // クリックされたボタンを選択状態にする
                e.target.style.background = HOVER_BG_COLOR;

                this.sendToToolPanelSource(source, 'popup-material-tool-click', {
                    materialTool: tool
                });
            } else if (e.target.dataset.font) {
                // 基本表計算: フォント選択
                e.preventDefault();
                this.sendToToolPanelSource(source, 'popup-calc-font-select', {
                    fontFamily: e.target.dataset.font
                });
                this.hideToolPanelPopup();
            } else if (e.target.dataset.size) {
                // 基本表計算: フォントサイズ選択
                e.preventDefault();
                this.sendToToolPanelSource(source, 'popup-calc-size-select', {
                    fontSize: parseInt(e.target.dataset.size)
                });
                this.hideToolPanelPopup();
            } else if (e.target.dataset.linestyle) {
                // 基本表計算: 線種選択
                e.preventDefault();
                this.sendToToolPanelSource(source, 'popup-calc-line-style-select', {
                    lineStyle: e.target.dataset.linestyle
                });
                this.hideToolPanelPopup();
            } else if (e.target.dataset.linewidth) {
                // 基本表計算: 線幅選択
                e.preventDefault();
                this.sendToToolPanelSource(source, 'popup-calc-line-width-select', {
                    lineWidth: parseInt(e.target.dataset.linewidth)
                });
                this.hideToolPanelPopup();
            } else if (e.target.dataset.halign) {
                // 基本表計算: 水平配置選択
                e.preventDefault();
                this.sendToToolPanelSource(source, 'popup-calc-halign-select', {
                    align: e.target.dataset.halign
                });
                this.hideToolPanelPopup();
            } else if (e.target.dataset.valign) {
                // 基本表計算: 垂直配置選択
                e.preventDefault();
                this.sendToToolPanelSource(source, 'popup-calc-valign-select', {
                    vAlign: e.target.dataset.valign
                });
                this.hideToolPanelPopup();
            }
        };

        const handlePopupChange = (e) => {
            if (e.target.id === 'gridModeSelect') {
                this.sendToToolPanelSource(source, 'popup-grid-mode-change', {
                    gridMode: e.target.value
                });
            } else if (e.target.id === 'gridIntervalCustom') {
                const value = parseInt(e.target.value);
                if (value > 0 && value <= 200) {
                    this.sendToToolPanelSource(source, 'popup-grid-interval-custom', {
                        interval: value
                    });
                }
            } else if (e.target.id === 'fontSizeSelect') {
                this.sendToEditorFromToolPanel(source, 'update-font-size', {
                    fontSize: parseInt(e.target.value)
                });
            } else if (e.target.id === 'fontFamilySelect') {
                this.sendToEditorFromToolPanel(source, 'update-font-family', {
                    fontFamily: e.target.value
                });
            } else if (e.target.id === 'textColorPicker') {
                this.sendToEditorFromToolPanel(source, 'update-text-color', {
                    textColor: e.target.value
                });
            } else if (e.target.id === 'boldCheck' || e.target.id === 'italicCheck' ||
                       e.target.id === 'underlineCheck' || e.target.id === 'strikethroughCheck') {
                // 文字修飾変更
                const decorationType = e.target.id.replace('Check', '');
                this.sendToEditorFromToolPanel(source, 'update-text-decoration', {
                    decoration: decorationType,
                    enabled: e.target.checked
                });
            } else if (e.target.id === 'fillColorPicker') {
                this.sendToToolPanelSource(source, 'popup-fill-color-change', {
                    fillColor: e.target.value
                });
                // 色選択後、ポップアップを自動的に閉じる
                setTimeout(() => {
                    this.hideToolPanelPopup();
                 }, UI_UPDATE_DELAY_MS);
            } else if (e.target.id === 'fillEnabledCheck') {
                this.sendToToolPanelSource(source, 'popup-fill-enabled-change', {
                    fillEnabled: e.target.checked
                });
            } else if (e.target.id === 'strokeColorPicker') {
                this.sendToToolPanelSource(source, 'popup-stroke-color-change', {
                    strokeColor: e.target.value
                });
                // 色選択後、ポップアップを自動的に閉じる
                setTimeout(() => {
                    this.hideToolPanelPopup();
                 }, UI_UPDATE_DELAY_MS);
            } else if (e.target.id === 'lineWidthSelect') {
                this.sendToToolPanelSource(source, 'popup-line-width-change', {
                    lineWidth: parseInt(e.target.value)
                });
            } else if (e.target.id === 'lineTypeSelect') {
                this.sendToToolPanelSource(source, 'popup-line-type-change', {
                    lineType: parseInt(e.target.value)
                });
            } else if (e.target.id === 'lineConnectionTypeSelect') {
                this.sendToToolPanelSource(source, 'popup-line-connection-type-change', {
                    lineConnectionType: e.target.value
                });
            } else if (e.target.id === 'arrowPositionSelect') {
                this.sendToToolPanelSource(source, 'popup-arrow-position-change', {
                    arrowPosition: e.target.value
                });
            } else if (e.target.id === 'arrowTypeSelect') {
                this.sendToToolPanelSource(source, 'popup-arrow-type-change', {
                    arrowType: e.target.value
                });
            } else if (e.target.id === 'cornerRadiusInput') {
                this.sendToToolPanelSource(source, 'popup-corner-radius-change', {
                    cornerRadius: parseInt(e.target.value)
                });
            } else if (e.target.id === 'brushSizeInput') {
                this.sendToToolPanelSource(source, 'popup-brush-size-change', {
                    brushSize: parseInt(e.target.value)
                });
            }
        };

        // イベントリスナーを登録
        popup.addEventListener('mousedown', (e) => e.stopPropagation(), true);
        popup.addEventListener('click', handlePopupClick, true);
        popup.addEventListener('change', handlePopupChange);

        // 外側をクリックしたら閉じる
        const closePopup = (e) => {
            // ポップアップがまだ存在するか確認
            const currentPopup = document.getElementById('tool-panel-popup');
            if (!currentPopup) {
                return;
            }

            // クリックがポップアップ内かチェック
            const isInsidePopup = currentPopup.contains(e.target);

            if (!isInsidePopup) {
                // クリックが道具パネルまたはエディタウィンドウ内かチェック
                let shouldKeepOpen = false;

                // 道具パネルのiframeを取得
                if (this.toolPanelPopupSource && this.toolPanelPopupSource.frameElement) {
                    const toolPanelFrame = this.toolPanelPopupSource.frameElement;
                    const toolPanelDoc = toolPanelFrame.contentDocument;

                    // 道具パネル内のクリックかチェック
                    if (toolPanelDoc && toolPanelDoc.contains(e.target)) {
                        shouldKeepOpen = true;
                    }

                    // エディタウィンドウ内のクリックの場合は閉じる（shouldKeepOpen = falseのまま）
                    // 道具パネル以外の場所（エディタウィンドウやデスクトップ）をクリックしたらパレットを閉じる
                }

                if (!shouldKeepOpen) {
                    this.hideToolPanelPopup();
                }
            }
        };

        // ハンドラを保存（配列で複数のハンドラを管理）
        this.toolPanelPopupCloseHandlers = [];

        // 少し遅延させてから外側クリックハンドラを登録
        setTimeout(() => {
            // 親ウィンドウのdocumentに登録
            document.addEventListener('mousedown', closePopup, true);
            this.toolPanelPopupCloseHandlers.push({ element: document, handler: closePopup });

            // すべてのiframeのdocumentにもリスナーを登録
            const allIframes = document.querySelectorAll('iframe');

            allIframes.forEach((iframe, index) => {
                try {
                    if (iframe.contentDocument) {
                        iframe.contentDocument.addEventListener('mousedown', closePopup, true);
                        this.toolPanelPopupCloseHandlers.push({
                            element: iframe.contentDocument,
                            handler: closePopup
                        });
                    }
                } catch (e) {
                    // Cannot access iframe document (cross-origin)
                }
            });
         }, UI_UPDATE_DELAY_MS);
    }

    /**
     * ツールパネルポップアップを非表示
     */
    hideToolPanelPopup() {

        // エディタにポップアップが閉じたことを通知（クリーンアップ前に送信）
        if (this.toolPanelPopupSource) {
            const editorFrame = this.getEditorFrameFromToolPanel(this.toolPanelPopupSource);
            if (editorFrame && editorFrame.contentWindow) {
                const editorWindowId = this.parentMessageBus.getWindowIdFromIframe(editorFrame);
                if (editorWindowId) {
                    this.parentMessageBus.sendToWindow(editorWindowId, 'tool-panel-popup-closed', {});
                } else {
                    logger.warn('[ToolPanelManager] エディタのwindowIdが見つかりません');
                }
            }
        }

        // すべてのイベントリスナーをクリーンアップ
        if (this.toolPanelPopupCloseHandlers) {
            this.toolPanelPopupCloseHandlers.forEach(({ element, handler }) => {
                try {
                    element.removeEventListener('mousedown', handler, true);
                } catch (e) {
                    // Error removing listener
                }
            });
            this.toolPanelPopupCloseHandlers = [];
        }

        // 旧形式のハンドラもクリーンアップ（互換性のため）
        if (this.toolPanelPopupCloseHandler) {
            document.removeEventListener('mousedown', this.toolPanelPopupCloseHandler, true);
            this.toolPanelPopupCloseHandler = null;
        }

        // ポップアップの呼び出し元情報をクリア
        this.toolPanelPopupSource = null;

        const popup = document.getElementById('tool-panel-popup');
        if (popup) {
            popup.remove();
        }
    }

    /**
     * ツールパネルからエディタフレームを取得
     * @param {Window} toolPanelWindow - 道具パネルのcontentWindow
     * @returns {HTMLIFrameElement|null} エディタのiframe要素
     */
    getEditorFrameFromToolPanel(toolPanelWindow) {
        if (!toolPanelWindow || !toolPanelWindow.frameElement) {
            return null;
        }

        // toolPanelWindowからiframe要素を取得
        const toolPanelFrame = toolPanelWindow.frameElement;

        // iframeの親ウィンドウ要素（.window）を取得
        const toolPanelWindowElement = toolPanelFrame.closest('.window');
        if (!toolPanelWindowElement) {
            return null;
        }

        const toolPanelWindowId = toolPanelWindowElement.id;

        // toolPanelRelationsから対応する編集iframeを取得
        if (this.toolPanelRelations && this.toolPanelRelations[toolPanelWindowId]) {
            return this.toolPanelRelations[toolPanelWindowId].editorIframe;
        }

        return null;
    }

    /**
     * ツールパネルポップアップからソースへメッセージを送信
     * @param {Window} source - ツールパネルのWindow
     * @param {string} type - メッセージタイプ
     * @param {Object} data - メッセージデータ
     */
    sendToToolPanelSource(source, type, data = {}) {
        if (source && source.postMessage) {
            source.postMessage({ type, ...data }, '*');
        }
    }

    /**
     * ツールパネルからエディタへメッセージを送信
     * @param {Window} source - ツールパネルのWindow
     * @param {string} type - メッセージタイプ
     * @param {Object} data - メッセージデータ
     */
    sendToEditorFromToolPanel(source, type, data = {}) {
        // ツールパネルに対応するエディタを取得
        const editorFrame = this.getEditorFrameFromToolPanel(source);

        if (editorFrame && editorFrame.contentWindow) {
            const editorWindowId = this.parentMessageBus.getWindowIdFromIframe(editorFrame);
            if (editorWindowId) {
                this.parentMessageBus.sendToWindow(editorWindowId, type, data);
            } else {
                logger.warn('[ToolPanelManager] editorWindowIdが見つかりません');
            }
        } else {
            logger.warn('[ToolPanelManager] エディタが見つかりません');
        }
    }

    /**
     * ツールパネル関連のウィンドウをクローズ
     * @param {string} windowId - クローズするウィンドウID
     * @param {Function} unregisterChild - MessageBusからの登録解除関数
     */
    closeRelatedToolPanels(windowId, unregisterChild) {
        logger.info('[ToolPanelManager] toolPanelRelations:', this.toolPanelRelations);

        // windowIdに対応する道具パネルを探してクローズ
        for (const [toolPanelWindowId, relation] of Object.entries(this.toolPanelRelations)) {
            logger.info('[ToolPanelManager] チェック中 toolPanelWindowId:', toolPanelWindowId);

            // editorIframeから対応するwindowIdを取得
            const editorIframe = relation.editorIframe;
            if (editorIframe) {
                const editorWindowId = this.parentMessageBus.getWindowIdFromIframe(editorIframe);

                // このwindowIdと一致する場合、対応する道具パネルを閉じる
                if (editorWindowId === windowId) {
                        logger.info('[ToolPanelManager] 道具パネルウィンドウを閉じる:', toolPanelWindowId);
                        const toolPanelWindow = document.getElementById(toolPanelWindowId);
                        if (toolPanelWindow) {
                            // MessageBusの登録を解除
                            unregisterChild(toolPanelWindowId);
                            toolPanelWindow.remove();
                            const windows = this.getWindows();
                            windows.delete(toolPanelWindowId);
                        }
                        delete this.toolPanelRelations[toolPanelWindowId];
                }
            }
        }
    }

    /**
     * ツールパネルかどうかを判定
     * @param {string} windowId - ウィンドウID
     * @returns {boolean} ツールパネルの場合true
     */
    isToolPanelWindow(windowId) {
        return this.toolPanelRelations && this.toolPanelRelations[windowId] !== undefined;
    }

    /**
     * ツールパネルの移動通知をエディタに送信
     * @param {string} windowId - ツールパネルのウィンドウID
     */
    notifyToolPanelMoved(windowId) {
        const relation = this.toolPanelRelations[windowId];
        if (!relation) return;

        const editorIframe = relation.editorIframe;
        if (!editorIframe) return;

        const editorWindowId = this.parentMessageBus.getWindowIdFromIframe(editorIframe);
        if (!editorWindowId) return;

        const toolPanelWindow = document.getElementById(windowId);
        if (!toolPanelWindow) return;

        const rect = toolPanelWindow.getBoundingClientRect();

        this.parentMessageBus.sendToWindow(editorWindowId, 'tool-panel-window-moved', {
            x: rect.left,
            y: rect.top
        });
    }
}
