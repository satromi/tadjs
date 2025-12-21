/**
 * 検索結果表示プラグイン
 * 実身/仮身検索の結果を仮身一覧形式で表示
 * @module RealObjectSearchResultApp
 * @extends PluginBase
 * @license MIT
 * @author satromi
 * @version 1.0.0
 */
const logger = window.getLogger('RealObjectSearchResult');

class RealObjectSearchResultApp extends window.PluginBase {
    constructor() {
        super('RealObjectSearchResult');

        this.searchResults = [];
        this.searchParams = null;
        this.selectedResult = null;
        this.selectedIndex = -1;
        this.openedRealObjects = new Map();

        // VirtualObjectRenderer を初期化
        if (window.VirtualObjectRenderer) {
            this.virtualObjectRenderer = new window.VirtualObjectRenderer();
        }

        // MessageBusはPluginBaseで初期化済み

        // IconCacheManagerを初期化
        if (window.IconCacheManager && this.messageBus) {
            this.iconManager = new window.IconCacheManager(this.messageBus, '[RealObjectSearchResult]');
        }

        this.init();
    }

    async init() {
        logger.info('[RealObjectSearchResult] 検索結果表示プラグイン初期化');

        // MessageBusのハンドラを設定
        if (this.messageBus) {
            this.setupMessageBusHandlers();
        }

        // 右クリックメニューを設定（PluginBase共通）
        this.setupContextMenu();

        // ウィンドウアクティブ化（PluginBase共通）
        this.setupWindowActivation();

        // スクロール通知初期化（MessageBus経由で親ウィンドウにスクロール状態を通知）
        this.initScrollNotification();

        // キーボードショートカットを設定
        this.setupKeyboardShortcuts();
    }

    /**
     * MessageBusのハンドラを登録
     */
    setupMessageBusHandlers() {
        // 共通MessageBusハンドラを登録（PluginBaseで定義）
        // set-scroll-position など親ウィンドウからの制御メッセージを処理
        this.setupCommonMessageBusHandlers();

        // 初期化メッセージ
        this.messageBus.on('init', async (data) => {
            logger.info('[RealObjectSearchResult] init受信:', data);

            // ウィンドウIDを保存
            if (data.windowId) {
                this.windowId = data.windowId;
                // MessageBusにもwindowIdを設定（レスポンスルーティング用）
                this.messageBus.setWindowId(data.windowId);
            }

            // 検索結果を取得
            if (data.fileData) {
                this.searchResults = data.fileData.searchResults || [];
                this.searchParams = data.fileData.searchParams || null;
            }

            // 検索条件表示
            this.renderSearchInfo();

            // 結果を表示
            await this.renderResults();
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

        // ウィンドウクローズ通知
        this.messageBus.on('window-closed', (data) => {
            if (data.realId && this.openedRealObjects.has(data.realId)) {
                this.openedRealObjects.delete(data.realId);
            }
        });
    }

    /**
     * コンテキストメニュー表示前のフック
     */
    onContextMenu(e) {
        // 右クリックされた要素から結果行を特定
        let target = e.target;
        while (target && target !== document.body && !target.classList.contains('result-row')) {
            target = target.parentElement;
        }

        if (target && target.dataset.index !== undefined) {
            const index = parseInt(target.dataset.index);
            this.selectResult(index);
        }
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

            // 検索文字列が指定されている場合は表示
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
            // スクロールバー更新を通知
            this.notifyScrollChange();
            return;
        }

        for (let index = 0; index < this.searchResults.length; index++) {
            const result = this.searchResults[index];
            const rowElement = await this.createResultElement(result, index);
            listElement.appendChild(rowElement);
        }

        // スクロールバー更新を通知
        this.notifyScrollChange();
    }

    /**
     * アイコンを読み込む
     * IconCacheManagerに委譲
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
        // 結果行コンテナ
        const row = document.createElement('div');
        row.className = 'result-row';
        row.dataset.index = index;
        row.dataset.realId = result.realId;

        // VirtualObjectRendererで仮身要素を作成
        let vobjElement;
        if (this.virtualObjectRenderer && result.virtualObject) {
            // 仮身属性（色、サイズなど）をすべて含める
            const virtualObject = {
                link_id: result.virtualObject.link_id || `${result.realId}_0.xtad`,
                link_name: result.virtualObject.link_name || result.name || '無題',
                // 仮身属性を転送
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
            // フォールバック: 簡易仮身要素
            vobjElement = document.createElement('span');
            vobjElement.className = 'virtual-object';
            vobjElement.textContent = result.name || '無題';
            vobjElement.style.cssText = 'display:inline-block;padding:4px 8px;border:1px solid #000;background:#fff;cursor:pointer;';
        }

        // 仮身要素へのイベント設定（仮身枠のみ対象）
        vobjElement.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            this.openResult(index);
        });

        // ドラッグ設定（仮身枠のみ）
        vobjElement.draggable = true;
        vobjElement.addEventListener('dragstart', (e) => {
            e.stopPropagation();
            this.handleDragStart(e, result);
        });

        row.appendChild(vobjElement);

        // マッチ情報テキスト（仮身枠の外）
        const matchInfo = document.createElement('span');
        matchInfo.className = 'match-info';

        // matchTypeの解析（複合表示形式: name+relationship+content）
        const matchTypeLabels = {
            'name': '名前',
            'relationship': '続柄',
            'content': '本文',
            'date': '日付'
        };

        if (result.matchType === 'date') {
            // 日付のみ一致（文字列検索なし）
            matchInfo.classList.add('match-date');
            matchInfo.textContent = '[日付一致]';
        } else if (result.matchType) {
            // 複合表示形式を解析
            const types = result.matchType.split('+');
            const labels = types.map(t => matchTypeLabels[t] || t).join('+');

            // CSSクラスを追加（最初のタイプを優先）
            if (types.includes('relationship')) {
                matchInfo.classList.add('match-relationship');
            } else if (types.includes('name')) {
                matchInfo.classList.add('match-name');
            } else if (types.includes('content')) {
                matchInfo.classList.add('match-content');
            }

            // 本文一致の場合はマッチテキストを表示
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

        // 行クリックで選択
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

        // 視覚的に選択状態を更新
        const allRows = document.querySelectorAll('.result-row');
        allRows.forEach((row, i) => {
            if (i === index) {
                row.classList.add('selected');
            } else {
                row.classList.remove('selected');
            }
        });

        // contextMenuVirtualObject を設定（共通メソッド用）
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

        logger.info('[RealObjectSearchResult] 結果を開く:', result.realId, result.name);

        this.messageBus.send('open-virtual-object', {
            linkId: result.link_id || `${result.realId}_0.xtad`,
            linkName: result.name
        });
    }

    /**
     * ドラッグ開始
     */
    handleDragStart(event, result) {
        // 検索結果からのドラッグは常にコピーモード
        this.virtualObjectDragState.dragMode = 'copy';

        // PluginBase共通メソッドを使用して仮身ドラッグデータを設定
        // 仮身属性（色など）も含める
        const virtualObject = {
            link_id: result.link_id || `${result.realId}_0.xtad`,
            link_name: result.name,
            // 仮身属性を転送
            ...(result.virtualObject || {})
        };

        // setVirtualObjectDragDataを使用（type: 'virtual-object-drag'、mode: 'copy'を設定）
        this.setVirtualObjectDragData(event, [virtualObject], 'real-object-search-result');
        event.dataTransfer.effectAllowed = 'copy';
    }

    /**
     * クリップボードへ仮身をコピー
     * 仮身一覧プラグインと同じ形式でクリップボードに設定
     */
    copyToClipboard() {
        if (!this.selectedResult) return;

        // 仮身一覧プラグインと同じ形式で仮身データを構築
        // ペースト先で vobjleft, vobjtop などが必要
        const virtualObject = this.selectedResult.virtualObject || {};
        const clipboardData = {
            link_id: this.selectedResult.link_id || `${this.selectedResult.realId}_0.xtad`,
            link_name: this.selectedResult.name,
            // 位置情報（デフォルト値を設定）
            vobjleft: virtualObject.vobjleft || 100,
            vobjtop: virtualObject.vobjtop || 100,
            vobjright: virtualObject.vobjright || 200,
            vobjbottom: virtualObject.vobjbottom || 130,
            // 仮身属性をコピー
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

        // PluginBase共通のsetClipboardを使用（MessageBus経由で親ウィンドウに送信）
        this.setClipboard(clipboardData);
        logger.info('[RealObjectSearchResult] 仮身をクリップボードにコピー:', this.selectedResult.name);
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

        // 結果が選択されている場合は追加メニュー
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
    async handleMenuAction(action) {
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
     * 実身名変更
     */
    async renameRealObject() {
        if (!this.contextMenuVirtualObject) return;

        const result = await window.RealObjectSystem.renameRealObject(this);
        if (result.success && this.selectedResult) {
            // 検索結果の表示名も更新
            this.selectedResult.name = result.newName;
            if (this.selectedResult.virtualObject) {
                this.selectedResult.virtualObject.link_name = result.newName;
            }
            await this.renderResults();
            // 選択状態を復元
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
            // Ctrl+C: クリップボードへコピー
            else if (e.ctrlKey && e.key === 'c') {
                if (this.selectedResult) {
                    e.preventDefault();
                    this.copyToClipboard();
                }
            }
            // Enter: 選択中の結果を開く
            else if (e.key === 'Enter') {
                if (this.selectedIndex >= 0) {
                    this.openResult(this.selectedIndex);
                }
            }
            // 上矢印: 前の結果を選択
            else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (this.selectedIndex > 0) {
                    this.selectResult(this.selectedIndex - 1);
                    this.scrollToSelected();
                }
            }
            // 下矢印: 次の結果を選択
            else if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (this.selectedIndex < this.searchResults.length - 1) {
                    this.selectResult(this.selectedIndex + 1);
                    this.scrollToSelected();
                }
            }
            // Escape: 選択解除
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

// DOMContentLoaded後に初期化
document.addEventListener('DOMContentLoaded', () => {
    window.realObjectSearchResultApp = new RealObjectSearchResultApp();
});
