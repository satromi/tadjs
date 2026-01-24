/**
 * 検索結果表示ウィンドウ
 * real-object-searchのサブウィンドウとして動作
 */
class SearchResultViewerApp {
    constructor() {
        this.searchResults = [];
        this.searchParams = null;
        this.selectedResult = null;
        this.selectedIndex = -1;
        this.parentSearchWindowId = null;
        this.windowId = null;
        this.messageBus = null;
        this.openedRealObjects = new Map();
        this.contextMenuVirtualObject = null;

        // VirtualObjectRenderer を初期化
        if (window.VirtualObjectRenderer) {
            this.virtualObjectRenderer = new window.VirtualObjectRenderer();
        }

        this.init();
    }

    async init() {
        // MessageBusの初期化を待つ
        await this.waitForMessageBus();

        // IconCacheManagerを初期化
        if (window.IconCacheManager && this.messageBus) {
            this.iconManager = new window.IconCacheManager(this.messageBus, '[SearchResultViewer]');
        }

        this.setupMessageBusHandlers();
        this.setupContextMenu();
        this.setupKeyboardShortcuts();

        // 親ウィンドウにready信号を送信（initメッセージを要求）
        window.parent.postMessage({ type: 'iframe-ready' }, '*');
    }

    async waitForMessageBus() {
        return new Promise((resolve) => {
            const check = () => {
                if (window.MessageBus) {
                    this.messageBus = new window.MessageBus({ pluginName: 'SearchResultViewer' });
                    this.messageBus.start();
                    resolve();
                } else {
                    setTimeout(check, 50);
                }
            };
            check();
        });
    }

    setupMessageBusHandlers() {
        // 初期化メッセージ
        this.messageBus.on('init', async (data) => {
            this.windowId = data.windowId;

            if (data.fileData) {
                this.searchResults = data.fileData.searchResults || [];
                this.searchParams = data.fileData.searchParams || null;
                this.parentSearchWindowId = data.fileData.parentWindowId;
            }

            // 検索条件表示
            this.renderSearchInfo();

            // 結果を表示
            await this.renderResults();

            // スクロールバー連携を設定
            this.setupScrollbarIntegration();
        });

        // ウィンドウクローズ要求
        this.messageBus.on('window-close-request', () => {
            this.messageBus.send('close-window', { windowId: this.windowId });
        });

        // メニュー定義要求
        this.messageBus.on('get-menu-definition', (data) => {
            this.messageBus.send('menu-definition-response', {
                messageId: data.messageId,
                menuDefinition: this.getMenuDefinition()
            });
        });

        // メニューアクション
        this.messageBus.on('menu-action', (data) => {
            this.executeMenuAction(data.action);
        });

        // スクロール位置設定要求（親からのスクロールバードラッグ）
        this.messageBus.on('set-scroll-position', (data) => {
            if (data.windowId === this.windowId) {
                const container = document.getElementById('pluginContent');
                if (container) {
                    if (typeof data.scrollTop === 'number') {
                        container.scrollTop = data.scrollTop;
                    }
                    if (typeof data.scrollLeft === 'number') {
                        container.scrollLeft = data.scrollLeft;
                    }
                }
            }
        });

        // ウィンドウクローズ通知（開いた実身の追跡用）
        this.messageBus.on('window-closed', (data) => {
            if (data.realId && this.openedRealObjects.has(data.realId)) {
                this.openedRealObjects.delete(data.realId);
            }
        });
    }

    /**
     * スクロールバー連携を設定
     */
    setupScrollbarIntegration() {
        const container = document.getElementById('pluginContent');
        if (!container) return;

        const sendScrollState = () => {
            if (!this.windowId) return;

            this.messageBus.send('scroll-state-update', {
                windowId: this.windowId,
                scrollTop: container.scrollTop,
                scrollLeft: container.scrollLeft,
                scrollHeight: container.scrollHeight,
                scrollWidth: container.scrollWidth,
                clientHeight: container.clientHeight,
                clientWidth: container.clientWidth
            });
        };

        let scrollTimer = null;
        container.addEventListener('scroll', () => {
            if (scrollTimer) return;
            scrollTimer = setTimeout(() => {
                scrollTimer = null;
                sendScrollState();
            }, 16);
        });

        // 初期スクロール状態を送信
        sendScrollState();

        // ResizeObserverでコンテンツサイズ変更を検知
        if (window.ResizeObserver) {
            const resizeObserver = new ResizeObserver(() => {
                sendScrollState();
            });
            resizeObserver.observe(container);
        }

        // sendScrollStateを保存して後から呼べるようにする
        this._sendScrollState = sendScrollState;
    }

    /**
     * スクロール状態を通知（コンテンツ変更時に呼ぶ）
     */
    notifyScrollChange() {
        if (this._sendScrollState) {
            this._sendScrollState();
        }
    }

    setupContextMenu() {
        document.addEventListener('contextmenu', (e) => {
            e.preventDefault();

            // 右クリックされた要素から結果行を特定して選択
            let target = e.target;
            while (target && target !== document.body && !target.classList.contains('result-row')) {
                target = target.parentElement;
            }
            if (target && target.dataset.index !== undefined) {
                const index = parseInt(target.dataset.index);
                this.selectResult(index);
            }

            // 右クリックメニューは親ウィンドウに委譲
            const iframeRect = window.frameElement?.getBoundingClientRect() || { left: 0, top: 0 };
            this.messageBus.send('context-menu-request', {
                windowId: this.windowId,
                x: e.clientX + iframeRect.left,
                y: e.clientY + iframeRect.top
            });
        });
    }

    /**
     * 検索条件を表示
     */
    renderSearchInfo() {
        const infoElement = document.getElementById('search-info');
        if (!infoElement || !this.searchParams) {
            if (infoElement) {
                infoElement.textContent = `検索結果: ${this.searchResults.length} 件`;
            }
            return;
        }

        let infoText = '';
        if (this.searchParams.searchType === 'string') {
            const targetText = {
                'name': '実身名',
                'content': '全文',
                'both': '実身名+全文'
            }[this.searchParams.searchTarget] || '';

            infoText = `検索: "${this.searchParams.searchText}" (${targetText}`;
            if (this.searchParams.useRegex) {
                infoText += ', 正規表現';
            }
            infoText += `) - ${this.searchResults.length} 件`;
        } else if (this.searchParams.searchType === 'date') {
            const dateTargetText = {
                'makeDate': '生成日',
                'updateDate': '更新日',
                'accessDate': 'アクセス日',
                'all': '全日付'
            }[this.searchParams.dateTarget] || '';

            let dateRange = '';
            if (this.searchParams.dateFrom && this.searchParams.dateTo) {
                dateRange = `${this.searchParams.dateFrom} ～ ${this.searchParams.dateTo}`;
            } else if (this.searchParams.dateFrom) {
                dateRange = `${this.searchParams.dateFrom} 以降`;
            } else if (this.searchParams.dateTo) {
                dateRange = `${this.searchParams.dateTo} 以前`;
            }

            infoText = `日付検索: ${dateRange} (${dateTargetText})`;

            if (this.searchParams.searchText) {
                const targetText = {
                    'name': '実身名',
                    'content': '全文',
                    'both': '実身名+全文'
                }[this.searchParams.searchTarget] || '';

                infoText += `, 検索: "${this.searchParams.searchText}" (${targetText}`;
                if (this.searchParams.useRegex) {
                    infoText += ', 正規表現';
                }
                infoText += ')';
            }

            infoText += ` - ${this.searchResults.length} 件`;
        }

        infoElement.textContent = infoText;
    }

    /**
     * 結果を表示
     */
    async renderResults() {
        const listElement = document.getElementById('resultList');
        if (!listElement) return;

        listElement.innerHTML = '';

        if (this.searchResults.length === 0) {
            const emptyMessage = document.createElement('div');
            emptyMessage.className = 'empty-message';
            emptyMessage.textContent = '検索結果はありません';
            listElement.appendChild(emptyMessage);
            this.notifyScrollChange();
            return;
        }

        for (let index = 0; index < this.searchResults.length; index++) {
            const result = this.searchResults[index];
            const rowElement = await this.createResultElement(result, index);
            listElement.appendChild(rowElement);
        }

        this.notifyScrollChange();
    }

    /**
     * アイコンを読み込む
     */
    loadIcon(realId) {
        if (this.iconManager) {
            return this.iconManager.loadIcon(realId);
        }
        return Promise.resolve(null);
    }

    /**
     * 結果項目要素を作成
     */
    async createResultElement(result, index) {
        const row = document.createElement('div');
        row.className = 'result-row';
        row.dataset.index = index;
        row.dataset.realId = result.realId;

        // VirtualObjectRendererで仮身要素を作成
        let vobjElement;
        if (this.virtualObjectRenderer && result.virtualObject) {
            const virtualObject = {
                link_id: result.virtualObject.link_id || `${result.realId}_0.xtad`,
                link_name: result.virtualObject.link_name || result.name || '無題',
                chcol: result.virtualObject.chcol,
                tbcol: result.virtualObject.tbcol,
                frcol: result.virtualObject.frcol,
                bgcol: result.virtualObject.bgcol,
                chsz: result.virtualObject.chsz,
                pictdisp: result.virtualObject.pictdisp,
                namedisp: result.virtualObject.namedisp,
                roledisp: result.virtualObject.roledisp,
                typedisp: result.virtualObject.typedisp,
                updatedisp: result.virtualObject.updatedisp,
                framedisp: result.virtualObject.framedisp
            };

            vobjElement = this.virtualObjectRenderer.createInlineElement(virtualObject, {
                loadIconCallback: (realId) => this.loadIcon(realId)
            });
        } else {
            vobjElement = document.createElement('span');
            vobjElement.className = 'virtual-object';
            vobjElement.textContent = result.name || '無題';
            vobjElement.style.cssText = 'display:inline-block;padding:4px 8px;border:1px solid #000;background:#fff;cursor:pointer;';
        }

        vobjElement.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            this.openResult(index);
        });

        vobjElement.draggable = true;
        vobjElement.addEventListener('dragstart', (e) => {
            e.stopPropagation();
            this.handleDragStart(e, result);
        });

        row.appendChild(vobjElement);

        // マッチ情報テキスト
        const matchInfo = document.createElement('span');
        matchInfo.className = 'match-info';

        const matchTypeLabels = {
            'name': '名前',
            'relationship': '続柄',
            'content': '本文',
            'date': '日付'
        };

        if (result.matchType === 'date') {
            matchInfo.classList.add('match-date');
            matchInfo.textContent = '[日付一致]';
        } else if (result.matchType) {
            const types = result.matchType.split('+');
            const labels = types.map(t => matchTypeLabels[t] || t).join('+');

            if (types.includes('relationship')) {
                matchInfo.classList.add('match-relationship');
            } else if (types.includes('name')) {
                matchInfo.classList.add('match-name');
            } else if (types.includes('content')) {
                matchInfo.classList.add('match-content');
            }

            if (types.includes('content') && result.matchedText) {
                const matchText = result.matchedText.length > 30
                    ? result.matchedText.substring(0, 30) + '...'
                    : result.matchedText;
                matchInfo.textContent = `[${labels}一致] ${matchText}`;
            } else {
                matchInfo.textContent = `[${labels}一致]`;
            }
        }

        row.appendChild(matchInfo);

        row.addEventListener('click', (e) => {
            this.selectResult(index);
        });

        return row;
    }

    /**
     * 結果を選択
     */
    selectResult(index) {
        this.selectedIndex = index;
        this.selectedResult = this.searchResults[index];

        const allRows = document.querySelectorAll('.result-row');
        allRows.forEach((row, i) => {
            if (i === index) {
                row.classList.add('selected');
            } else {
                row.classList.remove('selected');
            }
        });

        if (this.selectedResult) {
            const vobjElement = allRows[index]?.querySelector('.virtual-object');
            this.contextMenuVirtualObject = {
                element: vobjElement,
                realId: this.selectedResult.realId,
                virtualObj: {
                    link_id: this.selectedResult.link_id || `${this.selectedResult.realId}_0.xtad`,
                    link_name: this.selectedResult.name
                }
            };
        }
    }

    /**
     * 結果を開く
     */
    openResult(index) {
        const result = this.searchResults[index];
        if (!result) return;

        this.messageBus.send('open-virtual-object', {
            linkId: result.link_id || `${result.realId}_0.xtad`,
            linkName: result.name
        });
    }

    /**
     * ドラッグ開始
     */
    handleDragStart(event, result) {
        const virtualObject = {
            link_id: result.link_id || `${result.realId}_0.xtad`,
            link_name: result.name,
            ...(result.virtualObject || {})
        };

        // PluginBase.setVirtualObjectDragDataと同じ形式でデータを設定
        // 親ウィンドウのドロップハンドラはtext/plainからJSONをパースする
        const dragData = {
            type: 'virtual-object-drag',
            mode: 'copy',
            virtualObjects: [virtualObject],
            virtualObject: virtualObject, // 後方互換性のため
            source: 'search-result-viewer',
            sourceWindowId: this.windowId
        };

        event.dataTransfer.setData('text/plain', JSON.stringify(dragData));
        event.dataTransfer.effectAllowed = 'copy';
    }

    /**
     * クリップボードへ仮身をコピー
     */
    copyToClipboard() {
        if (!this.selectedResult) return;

        const virtualObject = this.selectedResult.virtualObject || {};
        const clipboardData = {
            link_id: this.selectedResult.link_id || `${this.selectedResult.realId}_0.xtad`,
            link_name: this.selectedResult.name,
            vobjleft: virtualObject.vobjleft || 100,
            vobjtop: virtualObject.vobjtop || 100,
            vobjright: virtualObject.vobjright || 200,
            vobjbottom: virtualObject.vobjbottom || 130,
            chcol: virtualObject.chcol,
            tbcol: virtualObject.tbcol,
            frcol: virtualObject.frcol,
            bgcol: virtualObject.bgcol,
            chsz: virtualObject.chsz,
            pictdisp: virtualObject.pictdisp,
            namedisp: virtualObject.namedisp,
            roledisp: virtualObject.roledisp,
            typedisp: virtualObject.typedisp,
            updatedisp: virtualObject.updatedisp,
            framedisp: virtualObject.framedisp
        };

        // MessageBus経由でクリップボードに設定
        this.messageBus.send('set-clipboard', {
            data: clipboardData
        });
    }

    /**
     * メニュー定義を返す
     */
    getMenuDefinition() {
        const menuDefinition = [
            {
                text: '表示',
                submenu: [
                    { text: '全画面表示', action: 'toggle-fullscreen', shortcut: 'Ctrl+L' },
                    { text: '再表示', action: 'refresh' }
                ]
            }
        ];

        if (this.selectedResult) {
            menuDefinition.push({
                text: '編集',
                submenu: [
                    { text: 'クリップボードへコピー', action: 'copy-to-clipboard', shortcut: 'Ctrl+C' }
                ]
            });

            menuDefinition.push({
                text: '仮身操作',
                submenu: [
                    { text: '開く', action: 'open-selected' }
                ]
            });

            menuDefinition.push({
                text: '実身操作',
                submenu: [
                    { text: '実身名変更', action: 'rename-real-object' },
                    { text: '実身複製', action: 'duplicate-real-object' },
                    { text: '仮身ネットワーク', action: 'open-virtual-object-network' },
                    { text: '実身/仮身検索', action: 'open-real-object-search' }
                ]
            });
        }

        return menuDefinition;
    }

    /**
     * メニューアクション処理
     */
    async executeMenuAction(action) {
        switch (action) {
            case 'toggle-fullscreen':
                this.toggleFullscreen();
                break;
            case 'refresh':
                await this.renderResults();
                break;
            case 'copy-to-clipboard':
                this.copyToClipboard();
                break;
            case 'open-selected':
                if (this.selectedIndex >= 0) {
                    this.openResult(this.selectedIndex);
                }
                break;
            case 'rename-real-object':
                await this.renameRealObject();
                break;
            case 'duplicate-real-object':
                await this.duplicateRealObject();
                break;
            case 'open-virtual-object-network':
                this.openVirtualObjectNetwork();
                break;
            case 'open-real-object-search':
                this.openRealObjectSearch();
                break;
        }
    }

    /**
     * 全画面表示トグル
     */
    toggleFullscreen() {
        this.messageBus.send('toggle-fullscreen', {
            windowId: this.windowId
        });
    }

    /**
     * ウィンドウを閉じる要求
     */
    requestCloseWindow() {
        this.messageBus.send('close-window', { windowId: this.windowId });
    }

    /**
     * 実身名変更
     */
    async renameRealObject() {
        if (!this.contextMenuVirtualObject) return;

        const result = await window.RealObjectSystem.renameRealObject(this);
        if (result.success && this.selectedResult) {
            this.selectedResult.name = result.newName;
            if (this.selectedResult.virtualObject) {
                this.selectedResult.virtualObject.link_name = result.newName;
            }
            await this.renderResults();
            this.selectResult(this.selectedIndex);
        }
    }

    /**
     * 実身複製
     */
    async duplicateRealObject() {
        if (!this.contextMenuVirtualObject) return;
        await window.RealObjectSystem.duplicateRealObject(this);
    }

    /**
     * 仮身ネットワークを開く
     */
    openVirtualObjectNetwork() {
        if (!this.selectedResult) return;
        window.RealObjectSystem.openVirtualObjectNetwork(this, this.selectedResult.realId);
    }

    /**
     * 実身/仮身検索を開く
     */
    openRealObjectSearch() {
        window.RealObjectSystem.openRealObjectSearch(this);
    }

    /**
     * キーボードショートカット設定
     */
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'l') {
                e.preventDefault();
                this.toggleFullscreen();
            }
            else if (e.ctrlKey && e.key === 'e') {
                e.preventDefault();
                this.requestCloseWindow();
            }
            else if (e.ctrlKey && e.key === 'c') {
                if (this.selectedResult) {
                    e.preventDefault();
                    this.copyToClipboard();
                }
            }
            else if (e.key === 'Enter') {
                if (this.selectedIndex >= 0) {
                    this.openResult(this.selectedIndex);
                }
            }
            else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (this.selectedIndex > 0) {
                    this.selectResult(this.selectedIndex - 1);
                    this.scrollToSelected();
                }
            }
            else if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (this.selectedIndex < this.searchResults.length - 1) {
                    this.selectResult(this.selectedIndex + 1);
                    this.scrollToSelected();
                }
            }
            else if (e.key === 'Escape') {
                this.selectedIndex = -1;
                this.selectedResult = null;
                this.contextMenuVirtualObject = null;
                document.querySelectorAll('.result-row.selected').forEach(el => {
                    el.classList.remove('selected');
                });
            }
        });
    }

    /**
     * 選択中の項目までスクロール
     */
    scrollToSelected() {
        const selectedElement = document.querySelector('.result-row.selected');
        if (selectedElement) {
            selectedElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }
}

window.searchResultApp = new SearchResultViewerApp();
