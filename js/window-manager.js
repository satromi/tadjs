/**
 * WindowManager - ウィンドウ管理クラス
 * TADjs Desktopのウィンドウ作成・管理を担当
 * @module WindowManager
 */

import { getLogger } from './logger.js';
import {
    MIN_WINDOW_WIDTH,
    MIN_WINDOW_HEIGHT,
    SCROLL_UPDATE_DELAY_MS
} from './util.js';

const logger = getLogger('WindowManager');

export class WindowManager {
    /**
     * @param {Object} options - 初期化オプション
     * @param {Object} options.parentMessageBus - メッセージバス
     * @param {Object} options.scrollbarManager - スクロールバーマネージャー
     * @param {Function} options.initScrollbar - スクロールバー初期化関数
     * @param {Function} options.forceUpdateScrollbar - スクロールバー更新関数
     * @param {Function} options.initScrollbarForPlugin - プラグインスクロールバー初期化
     * @param {Function} options.initScrollbarForPluginWithMessageBus - MessageBusベースプラグインスクロールバー初期化
     * @param {Function} options.forceUpdateScrollbarForPlugin - プラグインスクロールバー更新
     * @param {Function} options.getToolPanelRelations - ツールパネル関連情報取得関数
     */
    constructor(options = {}) {
        this.parentMessageBus = options.parentMessageBus;
        this.scrollbarManager = options.scrollbarManager;
        this.initScrollbar = options.initScrollbar;
        this.forceUpdateScrollbar = options.forceUpdateScrollbar;
        this.initScrollbarForPlugin = options.initScrollbarForPlugin;
        this.initScrollbarForPluginWithMessageBus = options.initScrollbarForPluginWithMessageBus;
        this.forceUpdateScrollbarForPlugin = options.forceUpdateScrollbarForPlugin;
        this.getToolPanelRelations = options.getToolPanelRelations;

        // ウィンドウ管理用の状態
        this.windows = new Map();
        this.activeWindow = null;
        this.windowFocusHistory = [];
        this.windowCounter = 0;

        // ドラッグ＆リサイズ用の状態
        this.isDragging = false;
        this.isResizing = false;
        this.dragState = null;
        this._boundHandleWindowDrag = null;
        this._boundEndWindowDrag = null;
        this._boundHandleWindowResize = null;
        this._boundEndWindowResize = null;

        logger.debug('WindowManager initialized');
    }

    /**
     * リサイズハンドルのHTML生成
     * @returns {string} リサイズハンドルのHTML
     */
    createResizeHandles() {
        return `
            <div class="resize-handle nw"></div>
            <div class="resize-handle ne"></div>
            <div class="resize-handle sw"></div>
            <div class="resize-handle se"></div>
            <div class="resize-handle n"></div>
            <div class="resize-handle s"></div>
            <div class="resize-handle w"></div>
            <div class="resize-handle e"></div>
        `;
    }

    /**
     * カスタムスクロールバーを作成
     * @param {HTMLElement} windowElement - スクロールバーを追加するウィンドウ要素
     */
    createCustomScrollbar(windowElement) {
        // TADウィンドウかどうかを判定
        const isTADWindow = windowElement.classList.contains('tad-window');

        // スクロール対象を適切に選択
        let content;
        if (isTADWindow) {
            content = windowElement.querySelector('.tad-content');
        } else {
            content = windowElement.querySelector('.window-content');
        }

        if (!content) return;

        // スクロールバーコンテナを作成
        const scrollContainer = document.createElement('div');
        scrollContainer.className = 'custom-scroll-container';

        // 縦スクロールバー
        const vScrollbar = document.createElement('div');
        vScrollbar.className = 'custom-scrollbar custom-scrollbar-vertical vertical';
        vScrollbar.innerHTML = `
            <div class="scroll-track">
                <div class="scroll-thumb">
                    <div class="scroll-thumb-indicator"></div>
                </div>
            </div>
        `;

        // 横スクロールバー
        const hScrollbar = document.createElement('div');
        hScrollbar.className = 'custom-scrollbar custom-scrollbar-horizontal horizontal';
        hScrollbar.innerHTML = `
            <div class="scroll-track">
                <div class="scroll-thumb">
                    <div class="scroll-thumb-indicator"></div>
                </div>
            </div>
        `;

        // 右下コーナー（スクロールバーの交点）
        const scrollCorner = document.createElement('div');
        scrollCorner.className = 'scroll-corner';

        scrollContainer.appendChild(vScrollbar);
        scrollContainer.appendChild(hScrollbar);
        scrollContainer.appendChild(scrollCorner);
        windowElement.appendChild(scrollContainer);

        // プラグインウィンドウ（iframe）かどうかを判定
        const iframe = windowElement.querySelector('iframe');

        if (iframe) {
            // プラグインウィンドウの場合、MessageBusベースのスクロールバー制御のみ使用
            // 従来のcross-frame DOM方式は競合を避けるため無効化
            // プラグインはinitScrollNotification()を呼び出してスクロール状態を通知する必要がある
            const windowId = windowElement.id;
            if (windowId && this.initScrollbarForPluginWithMessageBus) {
                this.initScrollbarForPluginWithMessageBus(vScrollbar, 'vertical', windowId);
                this.initScrollbarForPluginWithMessageBus(hScrollbar, 'horizontal', windowId);
            }
        } else {
            // 通常のウィンドウ（TADウィンドウなど）の場合
            if (this.initScrollbar) {
                this.initScrollbar(content, vScrollbar, 'vertical');
                this.initScrollbar(content, hScrollbar, 'horizontal');
            }

            // TADウィンドウの場合、追加の初期化遅延を設定
            if (isTADWindow && this.forceUpdateScrollbar) {
                setTimeout(() => {
                    this.forceUpdateScrollbar(content, vScrollbar, 'vertical');
                    this.forceUpdateScrollbar(content, hScrollbar, 'horizontal');
                }, SCROLL_UPDATE_DELAY_MS);
            }
        }
    }

    /**
     * ウィンドウを作成
     * @param {string} title - ウィンドウタイトル
     * @param {string} content - ウィンドウコンテンツ（HTML）
     * @param {Object} options - ウィンドウオプション
     * @param {Function} setupWindowEvents - イベント設定用コールバック
     * @param {Function} toggleMaximizeCallback - 最大化トグルコールバック
     * @returns {string} ウィンドウID
     */
    createWindow(title, content, options = {}, setupWindowEvents, toggleMaximizeCallback) {
        const windowId = 'window_' + (++this.windowCounter);
        const windowElement = document.createElement('div');
        windowElement.className = `window normal-window opening ${options.cssClass || ''}`.trim();
        windowElement.id = windowId;
        windowElement.setAttribute('data-window-id', windowId);

        const defaultOptions = {
            width: 400,
            height: 300,
            x: 50 + (this.windowCounter * 30),
            y: 50 + (this.windowCounter * 30),
            resizable: true,
            scrollable: true,
            customScrollbar: true,
            maximize: false,
            maximizable: true,
            minimizable: true,
            closable: true,
            alwaysOnTop: false,
            skipTaskbar: false,
            frame: true,
            transparent: false
        };

        const opts = { ...defaultOptions, ...options };

        // frame: false の場合はタイトルバー要素自体を生成しない
        const titlebarHtml = opts.frame
            ? `<div class="window-titlebar">
                   <div class="window-icon"></div>
                   <div class="window-title">${title}</div>
               </div>`
            : '';

        windowElement.innerHTML = `
            ${titlebarHtml}
            <div class="window-content">
                ${content}
            </div>
            ${(!opts.resizable || !opts.scrollable) ? '' : '<div class="window-corner"></div>'}
            <div class="window-maximize-corner"></div>
            ${opts.resizable ? this.createResizeHandles() : ''}
        `;

        // 位置とサイズを設定
        windowElement.style.left = opts.x + 'px';
        windowElement.style.top = opts.y + 'px';
        windowElement.style.width = opts.width + 'px';
        windowElement.style.height = opts.height + 'px';

        // scrollable設定をdata属性として保存
        windowElement.dataset.scrollable = opts.scrollable ? 'true' : 'false';

        // スクロールバーなしの場合はoverflowを制御
        if (!opts.scrollable) {
            const windowContent = windowElement.querySelector('.window-content');
            if (windowContent) {
                windowContent.style.overflow = 'hidden';
            }
        }

        // ウィンドウオプションを適用
        if (!opts.resizable) {
            windowElement.classList.add('non-resizable');
        }

        if (!opts.frame) {
            windowElement.classList.add('frameless');
            const titlebar = windowElement.querySelector('.window-titlebar');
            if (titlebar) {
                titlebar.style.display = 'none';
            }
        }

        if (opts.transparent) {
            windowElement.style.backgroundColor = 'transparent';
        }

        if (opts.alwaysOnTop) {
            windowElement.style.zIndex = '10000';
            windowElement.classList.add('always-on-top');
        }

        // アイコンを設定（iconDataがある場合）
        if (opts.iconData) {
            const windowIcon = windowElement.querySelector('.window-icon');
            if (windowIcon) {
                const iconUrl = opts.iconData.startsWith('data:')
                    ? opts.iconData
                    : `data:image/x-icon;base64,${opts.iconData}`;
                windowIcon.style.backgroundImage = `url(${iconUrl})`;
                windowIcon.style.backgroundSize = 'contain';
                windowIcon.style.backgroundRepeat = 'no-repeat';
                windowIcon.style.backgroundPosition = 'center';
            }
        }

        // ウインドウコンテナに追加
        document.getElementById('window-container').appendChild(windowElement);

        // カスタムスクロールバーを追加（scrollableがtrueの場合のみ）
        if (opts.customScrollbar && opts.scrollable) {
            this.createCustomScrollbar(windowElement);
        }

        // イベントリスナーを設定
        if (setupWindowEvents) {
            setupWindowEvents(windowElement);
        }

        // ウインドウを管理リストに追加
        this.windows.set(windowId, {
            element: windowElement,
            title: title,
            options: opts,
            isMaximized: false,
            normalRect: { x: opts.x, y: opts.y, width: opts.width, height: opts.height }
        });

        // アクティブウインドウに設定
        this.setActiveWindow(windowId);

        // maximizeオプション - ウィンドウが作成された後に最大化
        if (opts.maximize && opts.maximizable && toggleMaximizeCallback) {
            setTimeout(() => {
                toggleMaximizeCallback(windowId);
            }, 0);
        }

        return windowId;
    }

    /**
     * アクティブウィンドウを設定
     * @param {string} windowId - ウィンドウID
     */
    setActiveWindow(windowId) {
        // 既にアクティブなウィンドウの場合は何もしない
        // （重複呼び出しでiframe.focus()によるカーソル位置リセットを防止）
        if (this.activeWindow === windowId && windowId !== null) {
            return;
        }

        // 前のアクティブウィンドウに非アクティブ化を通知
        // （既に登録解除されているウィンドウにはメッセージを送信しない）
        const previousActiveWindow = this.activeWindow;
        if (previousActiveWindow && previousActiveWindow !== windowId && this.parentMessageBus) {
            if (this.parentMessageBus.isWindowRegistered(previousActiveWindow)) {
                this.parentMessageBus.sendToWindow(previousActiveWindow, 'window-deactivated', {});
            }
        }

        // 全ウインドウを非アクティブに
        document.querySelectorAll('.window').forEach(win => {
            win.classList.remove('front-window');
            win.classList.add('inactive');
        });

        if (windowId && this.windows.has(windowId)) {
            const window = this.windows.get(windowId);
            window.element.classList.add('front-window');
            window.element.classList.remove('inactive');
            this.activeWindow = windowId;

            // フォーカス履歴を更新
            const existingIndex = this.windowFocusHistory.indexOf(windowId);
            if (existingIndex !== -1) {
                this.windowFocusHistory.splice(existingIndex, 1);
            }
            this.windowFocusHistory.push(windowId);

            // 最前面に移動（ただし、alwaysOnTopウィンドウは除外して計算）
            const maxZ = Math.max(...Array.from(document.querySelectorAll('.window:not(.always-on-top)')).map(w =>
                parseInt(getComputedStyle(w).zIndex) || 0));

            // alwaysOnTopウィンドウの場合は、z-indexを変更しない
            if (!window.element.classList.contains('always-on-top')) {
                window.element.style.zIndex = maxZ + 1;
            }

            // ウィンドウ内のiframeにフォーカスを設定
            const iframe = window.element.querySelector('iframe');
            if (iframe) {
                try {
                    iframe.focus();
                    logger.debug('iframeにフォーカスを設定:', windowId);
                } catch (error) {
                    logger.warn('iframeへのフォーカス設定に失敗:', error);
                }
            } else {
                try {
                    window.element.focus();
                    logger.debug('ウィンドウ要素にフォーカスを設定:', windowId);
                } catch (error) {
                    logger.warn('ウィンドウへのフォーカス設定に失敗:', error);
                }
            }

            // 新しいアクティブウィンドウにアクティブ化を通知
            // （まだ登録されていないウィンドウにはメッセージを送信しない）
            if (this.parentMessageBus && this.parentMessageBus.isWindowRegistered(windowId)) {
                this.parentMessageBus.sendToWindow(windowId, 'window-activated', {});
            }
        } else {
            this.activeWindow = null;
        }
    }

    /**
     * ウィンドウの最大化をトグル
     * @param {string} windowId - ウィンドウID
     */
    toggleMaximizeWindow(windowId) {
        if (!this.windows.has(windowId)) return;

        const windowInfo = this.windows.get(windowId);
        const windowElement = windowInfo.element;

        // 既存のtransitionendハンドラを削除（連続toggle対策）
        if (windowInfo._transitionEndHandler) {
            windowElement.removeEventListener('transitionend', windowInfo._transitionEndHandler);
            windowInfo._transitionEndHandler = null;
        }
        // タイムアウトもクリア
        if (windowInfo._transitionTimeout) {
            clearTimeout(windowInfo._transitionTimeout);
            windowInfo._transitionTimeout = null;
        }
        const desktop = document.getElementById('desktop');
        const desktopRect = desktop.getBoundingClientRect();

        // maximizable設定を確認
        let maximizable = true;
        if (windowInfo.options && windowInfo.options.maximizable !== undefined) {
            maximizable = windowInfo.options.maximizable;
        } else if (windowInfo.fileData && windowInfo.fileData.windowConfig) {
            maximizable = windowInfo.fileData.windowConfig.maximizable;
        }

        if (maximizable === false && !windowInfo.isMaximized) {
            logger.debug('maximizable=falseのため全画面化をスキップ');
            return;
        }

        if (windowInfo.isMaximized) {
            // 通常サイズに復元
            windowElement.classList.remove('maximized');

            requestAnimationFrame(() => {
                windowElement.style.left = windowInfo.normalRect.x + 'px';
                windowElement.style.top = windowInfo.normalRect.y + 'px';
                windowElement.style.width = windowInfo.normalRect.width + 'px';
                windowElement.style.height = windowInfo.normalRect.height + 'px';
            });

            windowInfo.isMaximized = false;

            // プラグインに全画面解除を通知
            if (this.parentMessageBus) {
                this.parentMessageBus.sendToWindow(windowId, 'window-maximize-toggled', {
                    maximize: false,
                    pos: {
                        x: windowInfo.normalRect.x,
                        y: windowInfo.normalRect.y
                    },
                    width: windowInfo.normalRect.width,
                    height: windowInfo.normalRect.height
                });
            }

            logger.debug(`Window ${windowId} restored to normal size`);

            // CSSアニメーション完了を待つ（width/height両方の完了を待つ）
            let widthDone = false;
            let heightDone = false;

            const handleTransitionEnd = (e) => {
                if (e.propertyName === 'width') widthDone = true;
                if (e.propertyName === 'height') heightDone = true;

                if (widthDone && heightDone) {
                    windowElement.removeEventListener('transitionend', handleTransitionEnd);
                    windowInfo._transitionEndHandler = null;
                    if (windowInfo._transitionTimeout) {
                        clearTimeout(windowInfo._transitionTimeout);
                        windowInfo._transitionTimeout = null;
                    }

                    if (this.parentMessageBus) {
                        this.parentMessageBus.sendToWindow(windowId, 'window-maximize-completed', {
                            windowId: windowId,
                            maximize: false,
                            width: windowInfo.normalRect.width,
                            height: windowInfo.normalRect.height
                        });
                    }
                }
            };

            windowInfo._transitionEndHandler = handleTransitionEnd;
            windowElement.addEventListener('transitionend', handleTransitionEnd);

            // フォールバック: transitionが発火しない場合のタイムアウト
            windowInfo._transitionTimeout = setTimeout(() => {
                if (windowInfo._transitionEndHandler) {
                    windowElement.removeEventListener('transitionend', windowInfo._transitionEndHandler);
                    windowInfo._transitionEndHandler = null;
                    windowInfo._transitionTimeout = null;

                    // 強制的にwindow-maximize-completedを送信
                    if (this.parentMessageBus) {
                        this.parentMessageBus.sendToWindow(windowId, 'window-maximize-completed', {
                            windowId: windowId,
                            maximize: false,
                            width: windowInfo.normalRect.width,
                            height: windowInfo.normalRect.height
                        });
                    }
                }
            }, 300);  // CSS transition時間(200ms) + マージン
        } else {
            // 現在の位置とサイズを保存
            const currentRect = windowElement.getBoundingClientRect();
            windowInfo.normalRect = {
                x: parseInt(windowElement.style.left),
                y: parseInt(windowElement.style.top),
                width: parseInt(windowElement.style.width),
                height: parseInt(windowElement.style.height)
            };

            // デスクトップ領域全体に最大化
            windowElement.style.left = '0px';
            windowElement.style.top = '0px';
            windowElement.style.width = desktopRect.width + 'px';
            windowElement.style.height = desktopRect.height + 'px';
            windowElement.classList.add('maximized');
            windowInfo.isMaximized = true;

            // プラグインに全画面化を通知
            if (this.parentMessageBus) {
                this.parentMessageBus.sendToWindow(windowId, 'window-maximize-toggled', {
                    maximize: true,
                    pos: {
                        x: 0,
                        y: 0
                    },
                    width: desktopRect.width,
                    height: desktopRect.height
                });
            }

            logger.debug(`Window ${windowId} maximized to desktop size`);

            // CSSアニメーション完了を待つ（width/height両方の完了を待つ）
            let widthDone = false;
            let heightDone = false;

            const handleTransitionEnd = (e) => {
                if (e.propertyName === 'width') widthDone = true;
                if (e.propertyName === 'height') heightDone = true;

                if (widthDone && heightDone) {
                    windowElement.removeEventListener('transitionend', handleTransitionEnd);
                    windowInfo._transitionEndHandler = null;
                    if (windowInfo._transitionTimeout) {
                        clearTimeout(windowInfo._transitionTimeout);
                        windowInfo._transitionTimeout = null;
                    }

                    if (this.parentMessageBus) {
                        this.parentMessageBus.sendToWindow(windowId, 'window-maximize-completed', {
                            windowId: windowId,
                            maximize: true,
                            width: desktopRect.width,
                            height: desktopRect.height
                        });
                    }
                }
            };

            windowInfo._transitionEndHandler = handleTransitionEnd;
            windowElement.addEventListener('transitionend', handleTransitionEnd);

            // フォールバック: transitionが発火しない場合のタイムアウト
            windowInfo._transitionTimeout = setTimeout(() => {
                if (windowInfo._transitionEndHandler) {
                    windowElement.removeEventListener('transitionend', windowInfo._transitionEndHandler);
                    windowInfo._transitionEndHandler = null;
                    windowInfo._transitionTimeout = null;

                    // 強制的にwindow-maximize-completedを送信
                    if (this.parentMessageBus) {
                        this.parentMessageBus.sendToWindow(windowId, 'window-maximize-completed', {
                            windowId: windowId,
                            maximize: true,
                            width: desktopRect.width,
                            height: desktopRect.height
                        });
                    }
                }
            }, 300);  // CSS transition時間(200ms) + マージン
        }
    }

    /**
     * ウィンドウのドラッグを開始
     * @param {HTMLElement} windowElement - ドラッグするウィンドウ要素
     * @param {MouseEvent} e - マウスイベント
     */
    startWindowDrag(windowElement, e) {
        // 既存のイベントリスナーをクリア
        if (this._boundHandleWindowResize) {
            document.removeEventListener('mousemove', this._boundHandleWindowResize);
        }
        if (this._boundEndWindowResize) {
            document.removeEventListener('mouseup', this._boundEndWindowResize);
        }
        if (this._boundHandleWindowDrag) {
            document.removeEventListener('mousemove', this._boundHandleWindowDrag);
        }
        if (this._boundEndWindowDrag) {
            document.removeEventListener('mouseup', this._boundEndWindowDrag);
        }

        this.isDragging = true;
        this.isResizing = false;
        this.dragState = {
            element: windowElement,
            startX: e.clientX - windowElement.offsetLeft,
            startY: e.clientY - windowElement.offsetTop,
            currentX: null,
            currentY: null,
            rafId: null,
            lastUpdateTime: 0
        };

        this._boundHandleWindowDrag = this.handleWindowDrag.bind(this);
        this._boundEndWindowDrag = this.endWindowDrag.bind(this);

        document.addEventListener('mousemove', this._boundHandleWindowDrag);
        document.addEventListener('mouseup', this._boundEndWindowDrag);

        document.body.style.userSelect = 'none';

        // ドラッグ中はすべてのiframeへのポインタイベントを無効化
        const allIframes = document.querySelectorAll('iframe');
        allIframes.forEach(iframe => {
            iframe.style.pointerEvents = 'none';
        });
        logger.debug('[WindowDrag] ドラッグ開始: iframeのポインタイベントを無効化');
    }

    /**
     * ウィンドウのドラッグ処理
     * @param {MouseEvent} e - マウスイベント
     */
    handleWindowDrag(e) {
        if (!this.isDragging || !this.dragState) return;

        this.dragState.currentX = e.clientX - this.dragState.startX;
        this.dragState.currentY = e.clientY - this.dragState.startY;

        if (!this.dragState.rafId) {
            this.dragState.rafId = requestAnimationFrame((timestamp) => {
                if (this.dragState && this.dragState.currentX !== null && this.dragState.currentY !== null) {
                    if (timestamp - this.dragState.lastUpdateTime >= 100) {
                        this.dragState.element.style.left = this.dragState.currentX + 'px';
                        this.dragState.element.style.top = this.dragState.currentY + 'px';
                        this.dragState.lastUpdateTime = timestamp;
                    }
                    this.dragState.rafId = null;
                }
            });
        }
    }

    /**
     * ウィンドウのドラッグを終了
     */
    endWindowDrag() {
        if (this.dragState && this.dragState.rafId) {
            cancelAnimationFrame(this.dragState.rafId);
        }

        // ウィンドウ移動終了をプラグインに通知
        if (this.dragState && this.dragState.element) {
            const windowElement = this.dragState.element;
            const rect = windowElement.getBoundingClientRect();
            const windowId = windowElement.dataset.windowId;

            // 道具パネルウィンドウかどうかを判定
            const toolPanelRelations = this.getToolPanelRelations ? this.getToolPanelRelations() : null;
            const isToolPanel = toolPanelRelations && toolPanelRelations[windowId];

            if (isToolPanel) {
                const relation = toolPanelRelations[windowId];
                const editorIframe = relation.editorIframe;
                if (editorIframe && this.parentMessageBus) {
                    const editorWindowId = this.parentMessageBus.getWindowIdFromIframe(editorIframe);
                    if (editorWindowId) {
                        this.parentMessageBus.sendToWindow(editorWindowId, 'tool-panel-window-moved', {
                            pos: {
                                x: Math.round(rect.left),
                                y: Math.round(rect.top)
                            }
                        });
                        logger.debug('[WindowDrag] 道具パネル移動終了を通知:', { x: rect.left, y: rect.top });
                    }
                }
            } else if (this.parentMessageBus && windowId) {
                this.parentMessageBus.sendToWindow(windowId, 'window-moved', {
                    pos: {
                        x: Math.round(rect.left),
                        y: Math.round(rect.top)
                    },
                    width: Math.round(rect.width),
                    height: Math.round(rect.height)
                });
                logger.debug('[WindowDrag] ウィンドウ移動終了を通知:', { x: rect.left, y: rect.top });
            } else {
                logger.warn('[WindowManager] windowIdが見つかりませんでした。window-movedメッセージを送信できません。');
            }
        }

        this.isDragging = false;
        this.dragState = null;

        if (this._boundHandleWindowDrag) {
            document.removeEventListener('mousemove', this._boundHandleWindowDrag);
            this._boundHandleWindowDrag = null;
        }
        if (this._boundEndWindowDrag) {
            document.removeEventListener('mouseup', this._boundEndWindowDrag);
            this._boundEndWindowDrag = null;
        }

        document.body.style.userSelect = '';

        const allIframes = document.querySelectorAll('iframe');
        allIframes.forEach(iframe => {
            iframe.style.pointerEvents = '';
        });
        logger.debug('[WindowDrag] ドラッグ終了: iframeのポインタイベントを再有効化');
    }

    /**
     * ウィンドウのリサイズを開始
     * @param {HTMLElement} windowElement - リサイズするウィンドウ要素
     * @param {string} direction - リサイズ方向 (n, s, e, w, ne, nw, se, sw)
     * @param {MouseEvent} e - マウスイベント
     */
    startWindowResize(windowElement, direction, e) {
        logger.debug('Starting window resize, direction:', direction, 'element:', windowElement.id);

        // 既存のイベントリスナーをクリア
        if (this._boundHandleWindowResize) {
            document.removeEventListener('mousemove', this._boundHandleWindowResize);
        }
        if (this._boundEndWindowResize) {
            document.removeEventListener('mouseup', this._boundEndWindowResize);
        }
        if (this._boundHandleWindowDrag) {
            document.removeEventListener('mousemove', this._boundHandleWindowDrag);
        }
        if (this._boundEndWindowDrag) {
            document.removeEventListener('mouseup', this._boundEndWindowDrag);
        }

        this.isResizing = true;
        this.isDragging = false;
        const rect = windowElement.getBoundingClientRect();

        logger.debug('Initial rect:', {
            width: rect.width,
            height: rect.height,
            left: rect.left,
            top: rect.top
        });

        this.dragState = {
            element: windowElement,
            direction: direction,
            startX: e.clientX,
            startY: e.clientY,
            startWidth: rect.width,
            startHeight: rect.height,
            startLeft: rect.left,
            startTop: rect.top
        };

        this._boundHandleWindowResize = this.handleWindowResize.bind(this);
        this._boundEndWindowResize = this.endWindowResize.bind(this);

        document.addEventListener('mousemove', this._boundHandleWindowResize, true);
        document.addEventListener('mouseup', this._boundEndWindowResize, true);

        document.body.style.userSelect = 'none';

        // リサイズ中はすべてのiframeへのポインタイベントを無効化
        const allIframes = document.querySelectorAll('iframe');
        allIframes.forEach(iframe => {
            iframe.style.pointerEvents = 'none';
        });
        logger.debug('Resize event listeners added with capture=true, iframe pointer events disabled');
    }

    /**
     * ウィンドウのリサイズ処理
     * @param {MouseEvent} e - マウスイベント
     */
    handleWindowResize(e) {
        if (!this.isResizing || !this.dragState) {
            return;
        }

        const { element, direction, startX, startY, startWidth, startHeight, startLeft, startTop } = this.dragState;
        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;

        let newWidth = startWidth;
        let newHeight = startHeight;
        let newLeft = startLeft;
        let newTop = startTop;

        logger.debug(`Resizing ${direction}: deltaX=${deltaX}, deltaY=${deltaY}, current: ${startWidth}x${startHeight}`);

        if (direction && direction.includes('e')) {
            newWidth = startWidth + deltaX;
            logger.debug('East resize: newWidth =', newWidth);
        }
        if (direction && direction.includes('w')) {
            newWidth = startWidth - deltaX;
            newLeft = startLeft + deltaX;
            logger.debug('West resize: newWidth =', newWidth, 'newLeft =', newLeft);
        }
        if (direction && direction.includes('s')) {
            newHeight = startHeight + deltaY;
            logger.debug('South resize: newHeight =', newHeight);
        }
        if (direction && direction.includes('n')) {
            newHeight = startHeight - deltaY;
            newTop = startTop + deltaY;
            logger.debug('North resize: newHeight =', newHeight, 'newTop =', newTop);
        }

        // 最小サイズ制限
        newWidth = Math.max(MIN_WINDOW_WIDTH, newWidth);
        newHeight = Math.max(MIN_WINDOW_HEIGHT, newHeight);

        // WとNの方向でサイズが最小値に達した場合の位置調整
        if (newWidth === 200 && direction && direction.includes('w')) {
            newLeft = startLeft + startWidth - 200;
        }
        if (newHeight === 150 && direction && direction.includes('n')) {
            newTop = startTop + startHeight - 150;
        }

        logger.debug('Setting element style:', {
            width: newWidth + 'px',
            height: newHeight + 'px',
            left: newLeft + 'px',
            top: newTop + 'px'
        });

        element.style.width = newWidth + 'px';
        element.style.height = newHeight + 'px';
        element.style.left = newLeft + 'px';
        element.style.top = newTop + 'px';

        logger.debug(`Applied new size: ${newWidth}x${newHeight}, position: ${newLeft},${newTop}`);
    }

    /**
     * ウィンドウのリサイズを終了
     */
    endWindowResize() {
        // ウィンドウリサイズ終了をプラグインに通知
        if (this.dragState && this.dragState.element) {
            const windowElement = this.dragState.element;
            const rect = windowElement.getBoundingClientRect();
            const windowId = windowElement.dataset.windowId;

            if (this.parentMessageBus && windowId) {
                this.parentMessageBus.sendToWindow(windowId, 'window-resized-end', {
                    pos: {
                        x: Math.round(rect.left),
                        y: Math.round(rect.top)
                    },
                    width: Math.round(rect.width),
                    height: Math.round(rect.height)
                });
                logger.debug('[WindowResize] ウィンドウリサイズ終了を通知:', { width: rect.width, height: rect.height });
            } else {
                logger.warn('[WindowManager] windowIdが見つかりませんでした。window-resized-endメッセージを送信できません。');
            }
        }

        this.isResizing = false;
        this.dragState = null;

        if (this._boundHandleWindowResize) {
            document.removeEventListener('mousemove', this._boundHandleWindowResize);
            this._boundHandleWindowResize = null;
        }
        if (this._boundEndWindowResize) {
            document.removeEventListener('mouseup', this._boundEndWindowResize);
            this._boundEndWindowResize = null;
        }

        document.body.style.userSelect = '';

        const allIframes = document.querySelectorAll('iframe');
        allIframes.forEach(iframe => {
            iframe.style.pointerEvents = '';
        });
        logger.debug('[WindowResize] リサイズ終了: iframeのポインタイベントを再有効化');
    }
}
