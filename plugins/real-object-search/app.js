/**
 * 実身/仮身検索プラグイン
 * 実身名と実身内の全文検索を行う
 * @module RealObjectSearchApp
 * @extends PluginBase
 * @license MIT
 * @author satromi
 * @version 1.0.0
 */
const logger = window.getLogger('RealObjectSearch');

class RealObjectSearchApp extends window.PluginBase {
    constructor() {
        super('RealObjectSearch');

        this.currentTab = 'string';
        this.isSearching = false;
        this.searchAborted = false;

        // MessageBusはPluginBaseで初期化済み

        this.init();
    }

    async init() {
        logger.info('[RealObjectSearch] 実身/仮身検索プラグイン初期化');

        // MessageBusのハンドラを設定
        if (this.messageBus) {
            this.setupMessageBusHandlers();
        }

        // 右クリックメニューを設定（PluginBase共通）
        this.setupContextMenu();

        // ウィンドウアクティブ化（PluginBase共通）
        this.setupWindowActivation();

        // タブ切り替えを設定
        this.setupTabs();

        // 検索ボタンを設定
        this.setupSearchButtons();

        // キーボードショートカットを設定
        this.setupKeyboardShortcuts();
    }

    /**
     * MessageBusのハンドラを登録
     */
    setupMessageBusHandlers() {
        // 初期化メッセージ
        this.messageBus.on('init', async (data) => {
            logger.info('[RealObjectSearch] init受信:', data);

            // 共通初期化処理（windowId設定、スクロール状態送信）
            this.onInit(data);
        });

        // メニューアクション
        this.messageBus.on('menu-action', (data) => {
            this.handleMenuAction(data.action);
        });

        // メニュー定義要求
        this.messageBus.on('get-menu-definition', (data) => {
            const menuDefinition = this.getMenuDefinition();
            this.messageBus.send('menu-definition-response', {
                messageId: data.messageId,
                menuDefinition: menuDefinition
            });
        });

        // 検索結果レスポンス
        this.messageBus.on('search-real-objects-response', (data) => {
            this.handleSearchResponse(data);
        });

        // 検索進捗レスポンス
        this.messageBus.on('search-real-objects-progress', (data) => {
            this.handleSearchProgress(data);
        });
    }

    /**
     * タブ切り替えを設定
     */
    setupTabs() {
        const tabs = document.querySelectorAll('.tab');
        const panels = document.querySelectorAll('.tab-panel');

        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const targetTab = tab.dataset.tab;
                this.currentTab = targetTab;

                // アクティブタブの切り替え
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                // パネルの切り替え
                panels.forEach(panel => {
                    panel.classList.remove('active');
                    if (panel.id === targetTab + '-panel') {
                        panel.classList.add('active');
                    }
                });
            });
        });
    }

    /**
     * 検索ボタンを設定
     */
    setupSearchButtons() {
        // 文字列タブの検索ボタン
        const searchButton = document.getElementById('search-button');
        if (searchButton) {
            searchButton.addEventListener('click', () => {
                this.executeSearch();
            });
        }

        // 文字列タブの中断ボタン
        const stringAbortButton = document.getElementById('string-abort-button');
        if (stringAbortButton) {
            stringAbortButton.addEventListener('click', () => {
                this.abortSearch();
            });
        }

        // 日付タブの検索ボタン
        const dateSearchButton = document.getElementById('date-search-button');
        if (dateSearchButton) {
            dateSearchButton.addEventListener('click', () => {
                this.executeSearch();
            });
        }

        // 日付タブの中断ボタン
        const abortButton = document.getElementById('abort-button');
        if (abortButton) {
            abortButton.addEventListener('click', () => {
                this.abortSearch();
            });
        }

        // 文字列タブ: Enterキーでも検索実行
        const searchInput = document.getElementById('search-text');
        if (searchInput) {
            searchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.executeSearch();
                }
            });
        }

        // 日付タブ: Enterキーでも検索実行
        const dateSearchInput = document.getElementById('date-search-text');
        if (dateSearchInput) {
            dateSearchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.executeSearch();
                }
            });
        }
    }

    /**
     * 検索を実行
     */
    executeSearch() {
        if (this.isSearching) {
            logger.warn('[RealObjectSearch] 検索中です');
            return;
        }

        if (this.currentTab === 'string') {
            this.executeStringSearch();
        } else if (this.currentTab === 'date') {
            this.executeDateSearch();
        }
    }

    /**
     * 文字列検索を実行
     */
    executeStringSearch() {
        const searchText = document.getElementById('search-text').value.trim();
        const searchTarget = document.querySelector('input[name="search-target"]:checked').value;
        const useRegexValue = document.querySelector('input[name="string-use-regex"]:checked').value;
        const useRegex = (useRegexValue === 'on');
        const searchDepth = parseInt(document.getElementById('string-search-depth').value) || 255;

        // バリデーション
        if (!searchText) {
            this.showStatus('検索キーワードを入力してください', 'error');
            return;
        }

        // 正規表現のバリデーション
        if (useRegex) {
            try {
                new RegExp(searchText, 'i');
            } catch (e) {
                this.showStatus('正規表現の構文が正しくありません', 'error');
                return;
            }
        }

        this.isSearching = true;
        this.searchAborted = false;
        this.showStatus('検索中...', 'searching');
        this.setStringSearchButtonsEnabled(false, true);
        this.resetStringCounts();

        const messageId = this.generateMessageId('search');

        this.messageBus.send('search-real-objects', {
            messageId: messageId,
            searchType: 'string',
            searchText: searchText,
            searchTarget: searchTarget,
            useRegex: useRegex,
            searchDepth: searchDepth
        });

        logger.info('[RealObjectSearch] 文字列検索リクエスト送信:', {
            searchText,
            searchTarget,
            useRegex,
            searchDepth
        });
    }

    /**
     * 月の最終日を取得
     * @param {number} year - 年
     * @param {number} month - 月（1-12）
     * @returns {number} その月の最終日
     */
    getLastDayOfMonth(year, month) {
        // 翌月の0日 = 当月の最終日
        return new Date(year, month, 0).getDate();
    }

    /**
     * 個別入力フィールドから日付文字列を組み立てる
     * @param {string} prefix - フィールドIDのプレフィックス（'date-from' または 'date-to'）
     * @param {boolean} isFrom - FROMフィールドかどうか
     * @returns {string|null} ISO形式の日付文字列、または年が未入力の場合はnull
     */
    buildDateTimeString(prefix, isFrom) {
        const yearStr = document.getElementById(`${prefix}-year`).value.trim();
        const monthStr = document.getElementById(`${prefix}-month`).value.trim();
        const dayStr = document.getElementById(`${prefix}-day`).value.trim();
        const hourStr = document.getElementById(`${prefix}-hour`).value.trim();
        const minuteStr = document.getElementById(`${prefix}-minute`).value.trim();
        const secondStr = document.getElementById(`${prefix}-second`).value.trim();

        // 年が未入力の場合はフィルタなし
        if (!yearStr) {
            return null;
        }

        const year = parseInt(yearStr, 10);
        if (isNaN(year) || year < 1 || year > 9999) {
            return null;
        }

        let month, day, hour, minute, second;

        if (isFrom) {
            // FROM: デフォルトは期間の開始
            month = monthStr ? parseInt(monthStr, 10) : 1;
            day = dayStr ? parseInt(dayStr, 10) : 1;
            hour = hourStr ? parseInt(hourStr, 10) : 0;
            minute = minuteStr ? parseInt(minuteStr, 10) : 0;
            second = secondStr ? parseInt(secondStr, 10) : 0;
        } else {
            // TO: デフォルトは期間の終了
            if (!monthStr) {
                // 年のみ指定 → 12月31日
                month = 12;
                day = 31;
            } else {
                month = parseInt(monthStr, 10);
                if (!dayStr) {
                    // 年月のみ指定 → その月の最終日
                    day = this.getLastDayOfMonth(year, month);
                } else {
                    day = parseInt(dayStr, 10);
                }
            }
            hour = hourStr ? parseInt(hourStr, 10) : 23;
            minute = minuteStr ? parseInt(minuteStr, 10) : 59;
            second = secondStr ? parseInt(secondStr, 10) : 59;
        }

        // 値の範囲チェックと補正
        month = Math.max(1, Math.min(12, month || 1));
        const maxDay = this.getLastDayOfMonth(year, month);
        day = Math.max(1, Math.min(maxDay, day || 1));
        hour = Math.max(0, Math.min(23, hour || 0));
        minute = Math.max(0, Math.min(59, minute || 0));
        second = Math.max(0, Math.min(59, second || 0));

        // ISO形式で返す (datetime-local互換)
        const monthPadded = String(month).padStart(2, '0');
        const dayPadded = String(day).padStart(2, '0');
        const hourPadded = String(hour).padStart(2, '0');
        const minutePadded = String(minute).padStart(2, '0');
        const secondPadded = String(second).padStart(2, '0');

        return `${year}-${monthPadded}-${dayPadded}T${hourPadded}:${minutePadded}:${secondPadded}`;
    }

    /**
     * 日付検索を実行（文字列+日付複合検索）
     */
    executeDateSearch() {
        const searchText = document.getElementById('date-search-text').value.trim();
        const searchTarget = document.querySelector('input[name="date-search-target"]:checked').value;
        const useRegexValue = document.querySelector('input[name="date-use-regex"]:checked').value;
        const useRegex = (useRegexValue === 'on');
        const dateTarget = document.querySelector('input[name="date-target"]:checked').value;
        const searchDepth = parseInt(document.getElementById('search-depth').value) || 255;

        // 個別入力フィールドから日付を組み立て
        const dateFrom = this.buildDateTimeString('date-from', true);
        const dateTo = this.buildDateTimeString('date-to', false);

        // 正規表現のバリデーション
        if (searchText && useRegex) {
            try {
                new RegExp(searchText, 'i');
            } catch (e) {
                this.showStatus('正規表現の構文が正しくありません', 'error');
                return;
            }
        }

        // 日付の妥当性チェック
        if (dateFrom && dateTo && new Date(dateFrom) > new Date(dateTo)) {
            this.showStatus('日付FROMは日付TOより前である必要があります', 'error');
            return;
        }

        this.isSearching = true;
        this.searchAborted = false;
        this.showStatus('検索中...', 'searching');
        this.setDateSearchButtonsEnabled(false, true);
        this.resetCounts();

        const messageId = this.generateMessageId('search');

        this.messageBus.send('search-real-objects', {
            messageId: messageId,
            searchType: 'date',
            searchText: searchText,
            searchTarget: searchTarget,
            useRegex: useRegex,
            dateFrom: dateFrom,
            dateTo: dateTo,
            dateTarget: dateTarget,
            searchDepth: searchDepth
        });

        logger.info('[RealObjectSearch] 日付検索リクエスト送信:', {
            searchText,
            searchTarget,
            useRegex,
            dateFrom,
            dateTo,
            dateTarget,
            searchDepth
        });
    }

    /**
     * 検索を中断
     */
    abortSearch() {
        if (this.isSearching) {
            this.searchAborted = true;
            this.messageBus.send('abort-search', {});
            this.showStatus('検索を中断しました', '');
            this.isSearching = false;
            this.setStringSearchButtonsEnabled(true, false);
            this.setDateSearchButtonsEnabled(true, false);
        }
    }

    /**
     * 検索結果レスポンスを処理
     */
    handleSearchResponse(data) {
        this.isSearching = false;
        this.setStringSearchButtonsEnabled(true, false);
        this.setDateSearchButtonsEnabled(true, false);

        if (!data.success) {
            this.showStatus(`検索エラー: ${data.error}`, 'error');
            return;
        }

        const resultCount = data.results ? data.results.length : 0;
        logger.info('[RealObjectSearch] 検索結果:', resultCount, '件');

        // カウント表示を更新
        if (this.currentTab === 'string') {
            this.updateStringMatchCount(resultCount);
        } else if (this.currentTab === 'date') {
            this.updateMatchCount(resultCount);
        }

        if (resultCount === 0) {
            this.showStatus('検索結果はありません', '');
            return;
        }

        this.showStatus(`${resultCount} 件見つかりました。結果ウィンドウを開きます...`, '');

        // 検索結果ウィンドウを開く
        this.openSearchResultWindow(data.results, data.searchParams);
    }

    /**
     * 検索進捗レスポンスを処理
     */
    handleSearchProgress(data) {
        if (this.currentTab === 'string') {
            this.updateStringTotalCount(data.totalCount);
            this.updateStringMatchCount(data.matchCount);
        } else if (this.currentTab === 'date') {
            this.updateTotalCount(data.totalCount);
            this.updateMatchCount(data.matchCount);
        }
    }

    /**
     * 検索結果ウィンドウを開く
     * 複数ウィンドウを開くことが可能
     */
    openSearchResultWindow(results, searchParams) {
        if (window.parent && window.parent.tadjsDesktop) {
            try {
                // 検索ウィンドウの位置を取得して、重ならない位置を計算
                let windowX = 100;
                let windowY = 100;

                // 親ウィンドウから検索ウィンドウの位置を取得
                const iframeElement = window.frameElement;
                if (iframeElement) {
                    const windowElement = iframeElement.closest('.window');
                    if (windowElement) {
                        const rect = windowElement.getBoundingClientRect();
                        // 検索ウィンドウの右側に配置（少しオフセット）
                        windowX = rect.right + 20;
                        windowY = rect.top;

                        // 画面外にはみ出す場合は調整
                        const screenWidth = window.parent.innerWidth || 1024;
                        const screenHeight = window.parent.innerHeight || 768;
                        const resultWindowWidth = 600;
                        const resultWindowHeight = 500;

                        if (windowX + resultWindowWidth > screenWidth) {
                            // 右側に収まらない場合は左側に配置
                            windowX = Math.max(10, rect.left - resultWindowWidth - 20);
                        }
                        if (windowY + resultWindowHeight > screenHeight) {
                            windowY = Math.max(10, screenHeight - resultWindowHeight - 50);
                        }
                    }
                }

                // 検索条件をタイトルに反映
                let windowTitle = '検索結果';
                if (searchParams && searchParams.searchText) {
                    windowTitle = `検索結果: ${searchParams.searchText}`;
                }

                const initData = {
                    searchResults: results,
                    searchParams: searchParams,
                    parentSearchWindowId: this.windowId
                };

                // createIframeWindow方式で検索結果ウィンドウを開く（複数可能）
                window.parent.tadjsDesktop.createIframeWindow(
                    'plugins/real-object-search/result/index.html',
                    windowTitle,
                    initData,
                    {
                        width: 600,
                        height: 500,
                        resizable: true,
                        customScrollbar: true,
                        pos: {
                            x: windowX,
                            y: windowY
                        }
                    }
                );
                logger.info('[RealObjectSearch] 検索結果ウィンドウ起動');
            } catch (error) {
                logger.error('[RealObjectSearch] 検索結果ウィンドウ起動エラー:', error);
                this.showStatus('検索結果ウィンドウの起動に失敗しました', 'error');
            }
        }
    }

    /**
     * ステータス表示
     */
    showStatus(message, statusClass) {
        const statusElement = document.getElementById('search-status');
        if (statusElement) {
            statusElement.textContent = message;
            statusElement.className = 'search-status';
            if (statusClass) {
                statusElement.classList.add(statusClass);
            }
        }
    }

    /**
     * 文字列タブのボタンの有効/無効を設定
     */
    setStringSearchButtonsEnabled(searchEnabled, abortEnabled) {
        const searchButton = document.getElementById('search-button');
        const stringAbortButton = document.getElementById('string-abort-button');
        if (searchButton) {
            searchButton.disabled = !searchEnabled;
        }
        if (stringAbortButton) {
            stringAbortButton.disabled = !abortEnabled;
        }
    }

    /**
     * 日付タブのボタンの有効/無効を設定
     */
    setDateSearchButtonsEnabled(searchEnabled, abortEnabled) {
        const dateSearchButton = document.getElementById('date-search-button');
        const abortButton = document.getElementById('abort-button');
        if (dateSearchButton) {
            dateSearchButton.disabled = !searchEnabled;
        }
        if (abortButton) {
            abortButton.disabled = !abortEnabled;
        }
    }

    /**
     * 文字列タブのカウント表示をリセット
     */
    resetStringCounts() {
        const totalCount = document.getElementById('string-total-count');
        const matchCount = document.getElementById('string-match-count');
        if (totalCount) totalCount.textContent = '0';
        if (matchCount) matchCount.textContent = '0';
    }

    /**
     * 日付タブのカウント表示をリセット
     */
    resetCounts() {
        const totalCount = document.getElementById('total-count');
        const matchCount = document.getElementById('match-count');
        if (totalCount) totalCount.textContent = '0';
        if (matchCount) matchCount.textContent = '0';
    }

    /**
     * 文字列タブの件数表示を更新
     */
    updateStringTotalCount(count) {
        const totalCount = document.getElementById('string-total-count');
        if (totalCount) {
            totalCount.textContent = count.toString();
        }
    }

    /**
     * 文字列タブの該当件数表示を更新
     */
    updateStringMatchCount(count) {
        const matchCount = document.getElementById('string-match-count');
        if (matchCount) {
            matchCount.textContent = count.toString();
        }
    }

    /**
     * 日付タブの件数表示を更新
     */
    updateTotalCount(count) {
        const totalCount = document.getElementById('total-count');
        if (totalCount) {
            totalCount.textContent = count.toString();
        }
    }

    /**
     * 日付タブの該当件数表示を更新
     */
    updateMatchCount(count) {
        const matchCount = document.getElementById('match-count');
        if (matchCount) {
            matchCount.textContent = count.toString();
        }
    }

    /**
     * メニュー定義を返す
     */
    getMenuDefinition() {
        return [
            {
                text: '表示',
                submenu: [
                    { text: '全画面表示', action: 'toggle-fullscreen', shortcut: 'Ctrl+L' }
                ]
            }
        ];
    }

    /**
     * メニューアクション処理
     */
    handleMenuAction(action) {
        switch (action) {
            case 'toggle-fullscreen':
                this.toggleFullscreen();
                break;
        }
    }

    /**
     * キーボードショートカット設定
     */
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ctrl+L: 全画面表示
            if (e.ctrlKey && e.key === 'l') {
                e.preventDefault();
                this.toggleFullscreen();
            }
            // Ctrl+E: ウィンドウを閉じる
            else if (e.ctrlKey && e.key === 'e') {
                e.preventDefault();
                this.requestCloseWindow();
            }
            // Escape: 検索中なら中断、そうでなければウィンドウを閉じる
            else if (e.key === 'Escape') {
                if (this.isSearching) {
                    this.abortSearch();
                } else {
                    this.requestCloseWindow();
                }
            }
        });
    }
}

// DOMContentLoaded後に初期化
document.addEventListener('DOMContentLoaded', () => {
    window.realObjectSearchApp = new RealObjectSearchApp();
});
