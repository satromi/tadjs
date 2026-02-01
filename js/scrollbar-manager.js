/**
 * スクロールバー管理クラス
 * ウィンドウとプラグインのスクロールバー初期化・更新を担当
 * @module ScrollbarManager
 */

import { getLogger } from './logger.js';
import { SCROLLBAR_THUMB_COLOR } from './util.js';

const logger = getLogger('ScrollbarManager');

export class ScrollbarManager {
    constructor() {
        // MessageBusベースのスクロール状態をキャッシュ
        // key: windowId, value: { scrollTop, scrollLeft, scrollHeight, scrollWidth, clientHeight, clientWidth }
        this._scrollStateCache = new Map();
    }

    /**
     * プラグインからのスクロール状態更新を受信して保存
     * @param {string} windowId - ウィンドウID
     * @param {Object} state - スクロール状態
     */
    updateScrollState(windowId, state) {
        this._scrollStateCache.set(windowId, state);
    }

    /**
     * キャッシュされたスクロール状態を取得
     * @param {string} windowId - ウィンドウID
     * @returns {Object|null} スクロール状態
     */
    getScrollState(windowId) {
        return this._scrollStateCache.get(windowId) || null;
    }

    /**
     * MessageBusベースのスクロールバー更新
     * プラグインから受信したスクロール状態を使用してスクロールバーUIを更新
     * @param {HTMLElement} scrollbar - スクロールバー要素
     * @param {string} direction - スクロール方向（'vertical'または'horizontal'）
     * @param {Object} state - スクロール状態 { scrollTop, scrollLeft, scrollHeight, scrollWidth, clientHeight, clientWidth }
     */
    updateScrollbarFromState(scrollbar, direction, state) {
        const thumb = scrollbar.querySelector('.scroll-thumb');
        const track = scrollbar.querySelector('.scroll-track');

        if (!thumb || !track) return;

        const trackRect = track.getBoundingClientRect();

        if (direction === 'vertical') {
            const { scrollTop, scrollHeight, clientHeight } = state;

            scrollbar.style.display = 'block';

            if (scrollHeight <= clientHeight) {
                // スクロール不要
                thumb.style.height = Math.max(window.MIN_SCROLLBAR_THUMB_SIZE, trackRect.height - 4) + 'px';
                thumb.style.top = '2px';
                thumb.style.background = window.SCROLLBAR_THUMB_COLOR;
                thumb.style.cursor = 'default';
            } else {
                // スクロール可能
                const viewportRatio = clientHeight / scrollHeight;
                const thumbHeight = Math.max(window.MIN_SCROLLBAR_THUMB_SIZE, trackRect.height * viewportRatio);
                const scrollRatio = scrollTop / (scrollHeight - clientHeight);
                const maxThumbTop = trackRect.height - thumbHeight;
                const thumbTop = scrollRatio * maxThumbTop;

                thumb.style.height = thumbHeight + 'px';
                thumb.style.top = thumbTop + 'px';
                thumb.style.background = 'var(--window-titlebar-active)';
                thumb.style.cursor = 'pointer';
            }
        } else {
            const { scrollLeft, scrollWidth, clientWidth } = state;

            scrollbar.style.display = 'block';

            if (scrollWidth <= clientWidth) {
                // スクロール不要
                thumb.style.width = Math.max(window.MIN_SCROLLBAR_THUMB_SIZE, trackRect.width - 4) + 'px';
                thumb.style.left = '2px';
                thumb.style.background = window.SCROLLBAR_THUMB_COLOR;
                thumb.style.cursor = 'default';
            } else {
                // スクロール可能
                const viewportRatio = clientWidth / scrollWidth;
                const thumbWidth = Math.max(window.MIN_SCROLLBAR_THUMB_SIZE, trackRect.width * viewportRatio);
                const scrollRatio = scrollLeft / (scrollWidth - clientWidth);
                const maxThumbLeft = trackRect.width - thumbWidth;
                const thumbLeft = scrollRatio * maxThumbLeft;

                thumb.style.width = thumbWidth + 'px';
                thumb.style.left = thumbLeft + 'px';
                thumb.style.background = 'var(--window-titlebar-active)';
                thumb.style.cursor = 'pointer';
            }
        }
    }

    /**
     * MessageBusベースのプラグインスクロールバー初期化
     * cross-frame DOMアクセスを使用せず、MessageBus経由でスクロール制御
     * @param {HTMLElement} scrollbar - スクロールバー要素
     * @param {string} direction - スクロール方向（'vertical'または'horizontal'）
     * @param {Object} messageBus - MessageBusインスタンス
     * @param {string} windowId - ウィンドウID
     * @returns {Function} クリーンアップ関数
     */
    initScrollbarForPluginWithMessageBus(scrollbar, direction, messageBus, windowId) {
        const thumb = scrollbar.querySelector('.scroll-thumb');
        const track = scrollbar.querySelector('.scroll-track');

        if (!thumb || !track) {
            return () => {};
        }

        let isDragging = false;
        let startPos = 0;
        let startScroll = 0;

        // キャッシュされたスクロール状態を取得
        const getState = () => this.getScrollState(windowId);

        // ドラッグ開始
        const handleMouseDown = (e) => {
            const state = getState();
            if (!state) return;

            // スクロール不要な場合はドラッグ無効
            if (direction === 'vertical' && state.scrollHeight <= state.clientHeight) return;
            if (direction === 'horizontal' && state.scrollWidth <= state.clientWidth) return;

            isDragging = true;

            if (direction === 'vertical') {
                startPos = e.clientY;
                startScroll = state.scrollTop;
            } else {
                startPos = e.clientX;
                startScroll = state.scrollLeft;
            }
            thumb.classList.add('dragging');
            e.preventDefault();
        };

        thumb.addEventListener('mousedown', handleMouseDown);

        // ドラッグ中
        const handleMouseMove = (e) => {
            if (!isDragging) return;

            const state = getState();
            if (!state) return;

            const trackRect = track.getBoundingClientRect();

            if (direction === 'vertical') {
                const delta = e.clientY - startPos;
                const thumbHeight = parseFloat(thumb.style.height);
                const maxThumbMove = trackRect.height - thumbHeight;
                const maxScroll = state.scrollHeight - state.clientHeight;

                if (maxThumbMove > 0 && maxScroll > 0) {
                    const scrollDelta = (delta / maxThumbMove) * maxScroll;
                    const newScrollTop = Math.max(0, Math.min(maxScroll, startScroll + scrollDelta));

                    // MessageBus経由でプラグインにスクロール位置を送信（親→子）
                    messageBus.sendToWindow(windowId, 'set-scroll-position', {
                        windowId: windowId,
                        scrollTop: newScrollTop
                    });
                }
            } else {
                const delta = e.clientX - startPos;
                const thumbWidth = parseFloat(thumb.style.width);
                const maxThumbMove = trackRect.width - thumbWidth;
                const maxScroll = state.scrollWidth - state.clientWidth;

                if (maxThumbMove > 0 && maxScroll > 0) {
                    const scrollDelta = (delta / maxThumbMove) * maxScroll;
                    const newScrollLeft = Math.max(0, Math.min(maxScroll, startScroll + scrollDelta));

                    // MessageBus経由でプラグインにスクロール位置を送信（親→子）
                    messageBus.sendToWindow(windowId, 'set-scroll-position', {
                        windowId: windowId,
                        scrollLeft: newScrollLeft
                    });
                }
            }
        };

        // ドラッグ終了
        const handleMouseUp = () => {
            if (isDragging) {
                isDragging = false;
                thumb.classList.remove('dragging');
            }
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);

        // トラッククリック
        const handleTrackClick = (e) => {
            if (e.target === thumb || thumb.contains(e.target)) return;

            const state = getState();
            if (!state) return;

            // スクロール不要な場合はクリック無効
            if (direction === 'vertical' && state.scrollHeight <= state.clientHeight) return;
            if (direction === 'horizontal' && state.scrollWidth <= state.clientWidth) return;

            const trackRect = track.getBoundingClientRect();

            if (direction === 'vertical') {
                const clickPos = e.clientY - trackRect.top;
                const thumbHeight = parseFloat(thumb.style.height);
                const targetRatio = (clickPos - thumbHeight / 2) / (trackRect.height - thumbHeight);
                const clampedRatio = Math.max(0, Math.min(1, targetRatio));
                const newScrollTop = clampedRatio * (state.scrollHeight - state.clientHeight);

                messageBus.sendToWindow(windowId, 'set-scroll-position', {
                    windowId: windowId,
                    scrollTop: newScrollTop
                });
            } else {
                const clickPos = e.clientX - trackRect.left;
                const thumbWidth = parseFloat(thumb.style.width);
                const targetRatio = (clickPos - thumbWidth / 2) / (trackRect.width - thumbWidth);
                const clampedRatio = Math.max(0, Math.min(1, targetRatio));
                const newScrollLeft = clampedRatio * (state.scrollWidth - state.clientWidth);

                messageBus.sendToWindow(windowId, 'set-scroll-position', {
                    windowId: windowId,
                    scrollLeft: newScrollLeft
                });
            }
        };

        track.addEventListener('click', handleTrackClick);

        // クリーンアップ関数を返す
        return () => {
            thumb.removeEventListener('mousedown', handleMouseDown);
            track.removeEventListener('click', handleTrackClick);
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }

    /**
     * iframe内のスクロールコンテナを検出
     * プラグインごとに異なるスクロールコンテナをサポート
     * @param {Document} iframeDoc - iframeのdocument
     * @returns {HTMLElement|null} スクロールコンテナ要素
     */
    findScrollContainer(iframeDoc) {
        if (!iframeDoc) return null;
        // 検索順序: data属性 → .plugin-content → body
        return iframeDoc.querySelector('[data-scroll-container="true"]') ||
               iframeDoc.querySelector('.plugin-content') ||
               iframeDoc.body;
    }

    /**
     * 通常ウィンドウ用のスクロールバー初期化
     * @param {HTMLElement} content - スクロール対象のコンテンツ要素
     * @param {HTMLElement} scrollbar - スクロールバー要素
     * @param {string} direction - スクロール方向（'vertical'または'horizontal'）
     * @returns {Function} クリーンアップ関数
     */
    initScrollbar(content, scrollbar, direction) {
        const thumb = scrollbar.querySelector('.scroll-thumb');
        const track = scrollbar.querySelector('.scroll-track');

        let isDragging = false;
        let startPos = 0;
        let startScroll = 0;

        // コンテンツのスクロール状態を更新
        const updateScrollbar = () => {
            // まずtrack要素の実際のサイズを取得
            const trackRect = track.getBoundingClientRect();

            if (direction === 'vertical') {
                const scrollHeight = content.scrollHeight;
                const clientHeight = content.clientHeight;

                // 常時表示
                scrollbar.style.display = 'block';

                if (scrollHeight <= clientHeight) {
                    // スクロール不要の場合
                    thumb.style.height = Math.max(window.MIN_SCROLLBAR_THUMB_SIZE, trackRect.height - 4) + 'px';
                    thumb.style.top = '2px';
                    thumb.style.background = window.SCROLLBAR_THUMB_COLOR;
                    thumb.style.cursor = 'default';
                } else {
                    // スクロール可能な場合
                    const viewportRatio = clientHeight / scrollHeight;
                    const thumbHeight = Math.max(window.MIN_SCROLLBAR_THUMB_SIZE, trackRect.height * viewportRatio);
                    const scrollRatio = content.scrollTop / (scrollHeight - clientHeight);
                    const maxThumbTop = trackRect.height - thumbHeight;
                    const thumbTop = scrollRatio * maxThumbTop;

                    thumb.style.height = thumbHeight + 'px';
                    thumb.style.top = thumbTop + 'px';
                    thumb.style.background = 'var(--window-titlebar-active)';
                    thumb.style.cursor = 'pointer';
                }
            } else {
                const scrollWidth = content.scrollWidth;
                const clientWidth = content.clientWidth;

                // 常時表示
                scrollbar.style.display = 'block';

                if (scrollWidth <= clientWidth) {
                    // スクロール不要の場合
                    thumb.style.width = Math.max(window.MIN_SCROLLBAR_THUMB_SIZE, trackRect.width - 4) + 'px';
                    thumb.style.left = '2px';
                    thumb.style.background = window.SCROLLBAR_THUMB_COLOR;
                    thumb.style.cursor = 'default';
                } else {
                    // スクロール可能な場合
                    const viewportRatio = clientWidth / scrollWidth;
                    const thumbWidth = Math.max(window.MIN_SCROLLBAR_THUMB_SIZE, trackRect.width * viewportRatio);
                    const scrollRatio = content.scrollLeft / (scrollWidth - clientWidth);
                    const maxThumbLeft = trackRect.width - thumbWidth;
                    const thumbLeft = scrollRatio * maxThumbLeft;

                    thumb.style.width = thumbWidth + 'px';
                    thumb.style.left = thumbLeft + 'px';
                    thumb.style.background = 'var(--window-titlebar-active)';
                    thumb.style.cursor = 'pointer';
                }
            }
        };

        // ドラッグ開始
        thumb.addEventListener('mousedown', (e) => {
            // スクロール不要な場合はドラッグ無効
            if (direction === 'vertical' && content.scrollHeight <= content.clientHeight) return;
            if (direction === 'horizontal' && content.scrollWidth <= content.clientWidth) return;

            isDragging = true;
            if (direction === 'vertical') {
                startPos = e.clientY;
                startScroll = content.scrollTop;
            } else {
                startPos = e.clientX;
                startScroll = content.scrollLeft;
            }
            thumb.classList.add('dragging');
            e.preventDefault();
        });

        // ドラッグ中
        const handleMouseMove = (e) => {
            if (!isDragging) return;

            const trackRect = track.getBoundingClientRect();

            if (direction === 'vertical') {
                const delta = e.clientY - startPos;
                const thumbHeight = parseFloat(thumb.style.height);
                const maxThumbMove = trackRect.height - thumbHeight;
                const scrollHeight = content.scrollHeight - content.clientHeight;

                if (maxThumbMove > 0) {
                    const scrollDelta = (delta / maxThumbMove) * scrollHeight;
                    content.scrollTop = Math.max(0, Math.min(scrollHeight, startScroll + scrollDelta));
                }
            } else {
                const delta = e.clientX - startPos;
                const thumbWidth = parseFloat(thumb.style.width);
                const maxThumbMove = trackRect.width - thumbWidth;
                const scrollWidth = content.scrollWidth - content.clientWidth;

                if (maxThumbMove > 0) {
                    const scrollDelta = (delta / maxThumbMove) * scrollWidth;
                    content.scrollLeft = Math.max(0, Math.min(scrollWidth, startScroll + scrollDelta));
                }
            }
        };

        // ドラッグ終了
        const handleMouseUp = () => {
            if (isDragging) {
                isDragging = false;
                thumb.classList.remove('dragging');
            }
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);

        // トラッククリック
        track.addEventListener('click', (e) => {
            if (e.target === thumb || thumb.contains(e.target)) return;

            // スクロール不要な場合はクリック無効
            if (direction === 'vertical' && content.scrollHeight <= content.clientHeight) return;
            if (direction === 'horizontal' && content.scrollWidth <= content.clientWidth) return;

            const trackRect = track.getBoundingClientRect();

            if (direction === 'vertical') {
                const clickPos = e.clientY - trackRect.top;
                const thumbHeight = parseFloat(thumb.style.height);
                const targetRatio = (clickPos - thumbHeight / 2) / (trackRect.height - thumbHeight);
                const clampedRatio = Math.max(0, Math.min(1, targetRatio));
                content.scrollTop = clampedRatio * (content.scrollHeight - content.clientHeight);
            } else {
                const clickPos = e.clientX - trackRect.left;
                const thumbWidth = parseFloat(thumb.style.width);
                const targetRatio = (clickPos - thumbWidth / 2) / (trackRect.width - thumbWidth);
                const clampedRatio = Math.max(0, Math.min(1, targetRatio));
                content.scrollLeft = clampedRatio * (content.scrollWidth - content.clientWidth);
            }
        });

        // スクロールイベントをリッスン
        content.addEventListener('scroll', updateScrollbar);

        // リサイズ監視（ウィンドウサイズ変更時など）
        const resizeObserver = new ResizeObserver(() => {
            // 少し遅延させてから更新（レンダリング完了を待つ）
            setTimeout(updateScrollbar, window.QUICK_UI_UPDATE_DELAY_MS);
        });
        resizeObserver.observe(content);

        // 初期更新（少し遅延させる）
        setTimeout(updateScrollbar, window.UI_UPDATE_DELAY_MS);

        // クリーンアップ関数を返す
        return () => {
            content.removeEventListener('scroll', updateScrollbar);
            resizeObserver.disconnect();
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }

    /**
     * 通常ウィンドウのスクロールバーを強制的に更新
     * @param {HTMLElement} content - スクロール対象のコンテンツ要素
     * @param {HTMLElement} scrollbar - スクロールバー要素
     * @param {string} direction - スクロール方向（'vertical'または'horizontal'）
     */
    forceUpdateScrollbar(content, scrollbar, direction) {
        const thumb = scrollbar.querySelector('.scroll-thumb');
        const track = scrollbar.querySelector('.scroll-track');

        if (!thumb || !track || !content) return;

        // trackの実際のサイズを取得
        const trackRect = track.getBoundingClientRect();

        if (direction === 'vertical') {
            const scrollHeight = content.scrollHeight;
            const clientHeight = content.clientHeight;

            if (scrollHeight <= clientHeight) {
                // スクロール不要
                thumb.style.height = Math.max(window.MIN_SCROLLBAR_THUMB_SIZE, trackRect.height - 4) + 'px';
                thumb.style.top = '2px';
                thumb.style.background = SCROLLBAR_THUMB_COLOR;
                thumb.style.cursor = 'default';
            } else {
                // スクロール可能
                const viewportRatio = clientHeight / scrollHeight;
                const thumbHeight = Math.max(window.MIN_SCROLLBAR_THUMB_SIZE, trackRect.height * viewportRatio);
                const scrollRatio = content.scrollTop / (scrollHeight - clientHeight);
                const maxThumbTop = trackRect.height - thumbHeight;
                const thumbTop = scrollRatio * maxThumbTop;

                thumb.style.height = thumbHeight + 'px';
                thumb.style.top = thumbTop + 'px';
                thumb.style.background = 'var(--window-titlebar-active)';
                thumb.style.cursor = 'pointer';
            }
        } else {
            const scrollWidth = content.scrollWidth;
            const clientWidth = content.clientWidth;

            if (scrollWidth <= clientWidth) {
                // スクロール不要
                thumb.style.width = Math.max(window.MIN_SCROLLBAR_THUMB_SIZE, trackRect.width - 4) + 'px';
                thumb.style.left = '2px';
                thumb.style.background = SCROLLBAR_THUMB_COLOR;
                thumb.style.cursor = 'default';
            } else {
                // スクロール可能
                const viewportRatio = clientWidth / scrollWidth;
                const thumbWidth = Math.max(window.MIN_SCROLLBAR_THUMB_SIZE, trackRect.width * viewportRatio);
                const scrollRatio = content.scrollLeft / (scrollWidth - clientWidth);
                const maxThumbLeft = trackRect.width - thumbWidth;
                const thumbLeft = scrollRatio * maxThumbLeft;

                thumb.style.width = thumbWidth + 'px';
                thumb.style.left = thumbLeft + 'px';
                thumb.style.background = 'var(--window-titlebar-active)';
                thumb.style.cursor = 'pointer';
            }
        }
    }

    /**
     * プラグインウィンドウのスクロールバーを更新（iframe内のコンテンツサイズを参照）
     * @param {HTMLIFrameElement} iframe - プラグインのiframe要素
     * @param {HTMLElement} content - スクロール対象のコンテンツ要素（.window-content）
     * @param {HTMLElement} scrollbar - スクロールバー要素
     * @param {string} direction - スクロール方向（'vertical'または'horizontal'）
     */
    forceUpdateScrollbarForPlugin(iframe, content, scrollbar, direction) {
        const thumb = scrollbar.querySelector('.scroll-thumb');
        const track = scrollbar.querySelector('.scroll-track');

        if (!thumb || !track || !content || !iframe) return;

        try {
            // iframe内のスクロールコンテナを取得
            const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
            const pluginContent = this.findScrollContainer(iframeDoc);

            if (!pluginContent) return;

            // trackの実際のサイズを取得
            const trackRect = track.getBoundingClientRect();

            if (direction === 'vertical') {
                const scrollHeight = pluginContent.scrollHeight;
                const clientHeight = pluginContent.clientHeight;

                if (scrollHeight <= clientHeight) {
                    // スクロール不要
                    thumb.style.height = Math.max(window.MIN_SCROLLBAR_THUMB_SIZE, trackRect.height - 4) + 'px';
                    thumb.style.top = '2px';
                    thumb.style.background = window.SCROLLBAR_THUMB_COLOR;
                    thumb.style.cursor = 'default';
                } else {
                    // スクロール可能
                    const viewportRatio = clientHeight / scrollHeight;
                    const thumbHeight = Math.max(window.MIN_SCROLLBAR_THUMB_SIZE, trackRect.height * viewportRatio);
                    // pluginContentの現在のscrollTopを使用
                    const scrollRatio = pluginContent.scrollTop / (scrollHeight - clientHeight);
                    const maxThumbTop = trackRect.height - thumbHeight;
                    const thumbTop = scrollRatio * maxThumbTop;

                    thumb.style.height = thumbHeight + 'px';
                    thumb.style.top = thumbTop + 'px';
                    thumb.style.background = 'var(--window-titlebar-active)';
                    thumb.style.cursor = 'pointer';
                }
            } else {
                const scrollWidth = pluginContent.scrollWidth;
                const clientWidth = pluginContent.clientWidth;

                if (scrollWidth <= clientWidth) {
                    // スクロール不要
                    thumb.style.width = Math.max(window.MIN_SCROLLBAR_THUMB_SIZE, trackRect.width - 4) + 'px';
                    thumb.style.left = '2px';
                    thumb.style.background = window.SCROLLBAR_THUMB_COLOR;
                    thumb.style.cursor = 'default';
                } else {
                    // スクロール可能
                    const viewportRatio = clientWidth / scrollWidth;
                    const thumbWidth = Math.max(window.MIN_SCROLLBAR_THUMB_SIZE, trackRect.width * viewportRatio);
                    // pluginContentの現在のscrollLeftを使用
                    const scrollRatio = pluginContent.scrollLeft / (scrollWidth - clientWidth);
                    const maxThumbLeft = trackRect.width - thumbWidth;
                    const thumbLeft = scrollRatio * maxThumbLeft;

                    thumb.style.width = thumbWidth + 'px';
                    thumb.style.left = thumbLeft + 'px';
                    thumb.style.background = 'var(--window-titlebar-active)';
                    thumb.style.cursor = 'pointer';
                }
            }
        } catch (error) {
            logger.error('スクロールバー更新エラー:', error);
        }
    }

    /**
     * プラグインウィンドウ用のスクロールバー初期化（iframe内のbodyをスクロール）
     * @param {HTMLIFrameElement} iframe - プラグインのiframe要素
     * @param {HTMLElement} content - ウィンドウコンテンツ要素（.window-content）
     * @param {HTMLElement} scrollbar - スクロールバー要素
     * @param {string} direction - スクロール方向（'vertical'または'horizontal'）
     */
    initScrollbarForPlugin(iframe, content, scrollbar, direction) {
        const thumb = scrollbar.querySelector('.scroll-thumb');
        const track = scrollbar.querySelector('.scroll-track');

        logger.debug('initScrollbarForPlugin呼び出し:', {
            direction,
            thumb: !!thumb,
            track: !!track,
            iframe: !!iframe
        });

        if (!thumb || !track || !iframe) {
            logger.warn('スクロールバー要素が見つかりません');
            return;
        }

        let isDragging = false;
        let startPos = 0;
        let startScroll = 0;
        let scrollElement = null; // スクロール要素をキャッシュ

        // スクロール要素を取得する関数
        const getScrollElement = () => {
            if (scrollElement) return scrollElement;
            const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
            scrollElement = this.findScrollContainer(iframeDoc);
            return scrollElement;
        };

        // ドラッグ開始
        thumb.addEventListener('mousedown', (e) => {
            try {
                const pluginContent = getScrollElement();

                if (!pluginContent) {
                    logger.warn('スクロール要素が見つかりません');
                    return;
                }

                logger.debug('スクロール情報:', {
                    direction,
                    scrollHeight: pluginContent.scrollHeight,
                    scrollWidth: pluginContent.scrollWidth,
                    clientHeight: pluginContent.clientHeight,
                    clientWidth: pluginContent.clientWidth
                });

                // スクロール不要な場合はドラッグ無効
                if (direction === 'vertical' && pluginContent.scrollHeight <= pluginContent.clientHeight) {
                    logger.debug('垂直スクロール不要、ドラッグ無効');
                    return;
                }
                if (direction === 'horizontal' && pluginContent.scrollWidth <= pluginContent.clientWidth) {
                    logger.debug('水平スクロール不要、ドラッグ無効');
                    return;
                }

                isDragging = true;

                if (direction === 'vertical') {
                    startPos = e.clientY;
                    startScroll = pluginContent.scrollTop;
                } else {
                    startPos = e.clientX;
                    startScroll = pluginContent.scrollLeft;
                }
                thumb.classList.add('dragging');
                e.preventDefault();
                logger.debug('ドラッグ開始:', { isDragging, startPos, startScroll });
            } catch (error) {
                logger.error('スクロールバードラッグ開始エラー:', error);
            }
        });

        // ドラッグ中
        const handleMouseMove = (e) => {
            if (!isDragging) return;

            try {
                const pluginContent = getScrollElement();

                if (!pluginContent) return;

                const trackRect = track.getBoundingClientRect();

                if (direction === 'vertical') {
                    const delta = e.clientY - startPos;
                    const thumbHeight = parseFloat(thumb.style.height);
                    const maxThumbMove = trackRect.height - thumbHeight;
                    const scrollHeight = pluginContent.scrollHeight - pluginContent.clientHeight;

                    logger.debug('垂直スクロール計算:', {
                        delta,
                        thumbHeight,
                        maxThumbMove,
                        scrollHeight
                    });

                    if (maxThumbMove > 0) {
                        const scrollDelta = (delta / maxThumbMove) * scrollHeight;
                        const newScrollTop = Math.max(0, Math.min(scrollHeight, startScroll + scrollDelta));
                        pluginContent.scrollTop = newScrollTop;
                        logger.debug('scrollTop設定:', newScrollTop);
                    }
                } else {
                    const delta = e.clientX - startPos;
                    const thumbWidth = parseFloat(thumb.style.width);
                    const maxThumbMove = trackRect.width - thumbWidth;
                    const scrollWidth = pluginContent.scrollWidth - pluginContent.clientWidth;

                    if (maxThumbMove > 0) {
                        const scrollDelta = (delta / maxThumbMove) * scrollWidth;
                        const newScrollLeft = Math.max(0, Math.min(scrollWidth, startScroll + scrollDelta));
                        pluginContent.scrollLeft = newScrollLeft;
                        logger.debug('scrollLeft設定:', newScrollLeft);
                    }
                }

                // スクロールバー表示を更新
                this.forceUpdateScrollbarForPlugin(iframe, content, scrollbar, direction);
            } catch (error) {
                logger.error('スクロールバードラッグ中エラー:', error);
            }
        };

        // ドラッグ終了
        const handleMouseUp = () => {
            if (isDragging) {
                logger.debug('スクロールバードラッグ終了:', direction);
                isDragging = false;
                thumb.classList.remove('dragging');
            }
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);

        // iframe内のスクロールコンテナにscrollイベントリスナーを登録
        // iframeの読み込みを待ってから登録
        const setupScrollListener = (retryCount = 0) => {
            try {
                const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                // スクロールコンテナを検出
                let pluginContent = this.findScrollContainer(iframeDoc);

                if (!pluginContent && retryCount < 5) {
                    // スクロールコンテナが見つからない場合、少し待ってから再試行
                    setTimeout(() => setupScrollListener(retryCount + 1), window.RETRY_DELAY_MS);
                    return;
                }

                if (!pluginContent) {
                    logger.warn('iframe内のスクロール要素が見つかりません');
                    return;
                }

                // スクロール要素をキャッシュに保存
                scrollElement = pluginContent;

                pluginContent.addEventListener('scroll', () => {
                    this.forceUpdateScrollbarForPlugin(iframe, content, scrollbar, direction);
                });

                // リサイズ監視（プラグインコンテンツサイズ変更時に更新）
                try {
                    const resizeObserver = new ResizeObserver(() => {
                        setTimeout(() => {
                            this.forceUpdateScrollbarForPlugin(iframe, content, scrollbar, direction);
                        }, window.QUICK_UI_UPDATE_DELAY_MS || 50);
                    });
                    resizeObserver.observe(pluginContent);
                } catch (resizeError) {
                    // ResizeObserver非対応環境では無視
                }

                // 初期表示時のスクロールバーを更新
                this.forceUpdateScrollbarForPlugin(iframe, content, scrollbar, direction);
            } catch (error) {
                logger.error('scrollリスナー登録エラー:', error);
            }
        };

        // iframeがすでに読み込まれているかチェック
        if (iframe.contentDocument && iframe.contentDocument.readyState === 'complete') {
            setupScrollListener();
        } else {
            iframe.addEventListener('load', setupScrollListener, { once: true });
        }

        logger.debug('スクロールバーイベントハンドラ登録完了:', direction);
    }
}
