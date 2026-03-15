/**
 * PluginBase スクロールバー機能モジュール
 * カスタムスクロールバーとスクロール通知機能を提供
 *
 * plugin-base.js から分離された機能モジュール
 */
import { getLogger } from './logger.js';
import { throttle } from './performance-utils.js';

const logger = getLogger('PluginBase');

/**
 * スクロールバー関連メソッドをPluginBaseのprototypeに追加する
 * @param {Function} PluginBaseClass - PluginBaseクラス
 */
export function applyScrollbarMethods(PluginBaseClass) {
    const proto = PluginBaseClass.prototype;

    /**
     * スクロールバー幅のCSS変数をiframe内に設定
     * localStorageから読み取り、--scrollbar-width変数を設定
     * @private
     */
    proto._initScrollbarWidthVariable = function() {
        try {
            const scrollbarWidth = localStorage.getItem('scrollbar-width') || '12';
            document.documentElement.style.setProperty('--scrollbar-width', scrollbarWidth + 'px');
            logger.debug(`[${this.pluginName}] Scrollbar width CSS variable set: ${scrollbarWidth}px`);
        } catch (error) {
            // localStorageアクセスエラー時はデフォルト値を使用
            document.documentElement.style.setProperty('--scrollbar-width', '12px');
        }
    };

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
    proto.initScrollNotification = function() {
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
    };

    /**
     * スクロール状態変更を親ウィンドウに手動通知
     * プログラムによるスクロール（scrollIntoView等）後に呼び出すこと
     *
     * 使用例:
     *   this.scrollCellIntoView(cell);
     *   this.notifyScrollChange();
     */
    proto.notifyScrollChange = function() {
        if (!this._scrollNotificationEnabled || !this._scrollContainer) {
            return;
        }
        this._sendScrollState(this._scrollContainer);
    };

    /**
     * スクロール状態をMessageBus経由で親に送信
     * @param {HTMLElement} container - スクロールコンテナ
     * @private
     */
    proto._sendScrollState = function(container) {
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
    };

    /**
     * 親からのスクロール位置設定要求を処理
     * @param {Object} data - { scrollTop?: number, scrollLeft?: number }
     */
    proto.handleSetScrollPosition = function(data) {
        const container = document.querySelector(this.scrollContainerSelector);
        if (!container) return;

        if (typeof data.scrollTop === 'number') {
            container.scrollTop = data.scrollTop;
        }
        if (typeof data.scrollLeft === 'number') {
            container.scrollLeft = data.scrollLeft;
        }
    };

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
    proto.initCustomScrollbar = function(containerSelector, options = {}) {
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
    };

    /**
     * カスタムスクロールバーDOM要素を作成
     * @param {HTMLElement} wrapper - スクロールバーを配置するラッパー要素
     * @param {HTMLElement} scrollContainer - スクロールコンテナ
     * @param {string} direction - 'vertical' | 'horizontal'
     * @private
     */
    proto._createCustomScrollbar = function(wrapper, scrollContainer, direction) {
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
    };

    /**
     * スクロールコーナーを作成
     * @param {HTMLElement} container - スクロールコンテナ
     * @private
     */
    proto._createScrollCorner = function(container) {
        const corner = document.createElement('div');
        corner.className = 'scroll-corner';
        container.appendChild(corner);
        this._customScrollbars.corner = corner;
    };

    /**
     * ツマミのドラッグイベントを設定
     * @param {HTMLElement} container - スクロールコンテナ
     * @param {HTMLElement} thumb - ツマミ要素
     * @param {string} direction - 'vertical' | 'horizontal'
     * @private
     */
    proto._setupThumbDrag = function(container, thumb, direction) {
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
    };

    /**
     * トラッククリック時のスクロール処理
     * @param {HTMLElement} container - スクロールコンテナ
     * @param {HTMLElement} track - トラック要素
     * @param {MouseEvent} e - クリックイベント
     * @param {string} direction - 'vertical' | 'horizontal'
     * @private
     */
    proto._handleTrackClick = function(container, track, e, direction) {
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
    };

    /**
     * スクロールバーのツマミ位置を更新
     * @param {HTMLElement} container - スクロールコンテナ
     * @param {string} direction - 'vertical' | 'horizontal'
     * @private
     */
    proto._updateScrollbarThumbPosition = function(container, direction) {
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
    };

    /**
     * スクロールバーの表示/非表示を更新
     * @param {HTMLElement} container - スクロールコンテナ
     * @param {string} direction - 'vertical' | 'horizontal'
     * @private
     */
    proto._updateScrollbarVisibility = function(container, direction) {
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
    };

    // ========================================
    // スクロール位置管理
    // ========================================

    /**
     * 現在のスクロール位置を取得（サブクラスでオーバーライド可能）
     * デフォルトでは .plugin-content 要素のスクロール位置を返す
     * @returns {Object|null} { x, y } または null
     */
    proto.getScrollPosition = function() {
        const pluginContent = document.querySelector('.plugin-content');
        if (pluginContent) {
            return {
                x: pluginContent.scrollLeft,
                y: pluginContent.scrollTop
            };
        }
        return null;
    };

    /**
     * スクロール位置を設定（サブクラスでオーバーライド可能）
     * キャンバスサイズが縮小した場合は最大スクロール可能位置に制限
     * @param {Object} scrollPos - { x, y }
     */
    proto.setScrollPosition = function(scrollPos) {
        if (!scrollPos) return;
        const pluginContent = document.querySelector('.plugin-content');
        if (pluginContent) {
            const maxScrollLeft = Math.max(0, pluginContent.scrollWidth - pluginContent.clientWidth);
            const maxScrollTop = Math.max(0, pluginContent.scrollHeight - pluginContent.clientHeight);
            pluginContent.scrollLeft = Math.min(scrollPos.x || 0, maxScrollLeft);
            pluginContent.scrollTop = Math.min(scrollPos.y || 0, maxScrollTop);
        }
    };

    /**
     * スクロール位置を保存してウィンドウ設定に反映
     * 自動保存や明示的保存時に呼び出す
     */
    proto.saveScrollPosition = function() {
        const scrollPos = this.getScrollPosition();
        if (scrollPos) {
            this.updateWindowConfig({ scrollPos });
        }
    };

    /**
     * スクロール位置を保持しながら要素にフォーカス
     * 一部のブラウザでfocus()呼び出し時にスクロール位置がリセットされる問題を回避
     *
     * @param {HTMLElement} element - フォーカスする要素
     */
    proto.focusWithScrollPreservation = function(element) {
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
    };
}
