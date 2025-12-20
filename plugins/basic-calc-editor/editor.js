/**
 * 基本表計算エディタ
 * TADjs Desktop用スプレッドシートプラグイン
 * @module CalcEditor
 * @extends PluginBase
 * @license MIT
 * @author satromi
 * @version 1.0.0
 */
const logger = window.getLogger('CalcEditor');

class CalcEditor extends window.PluginBase {
    constructor() {
        // 基底クラスのコンストラクタを呼び出し
        super('CalcEditor');

        // グリッド設定
        this.defaultRows = 100;
        this.defaultCols = 26; // A-Z
        this.cellWidth = 80;
        this.cellHeight = 22;
        this.rowHeaderWidth = 50;
        this.colHeaderHeight = 24;

        // 動的グリッド拡張設定
        this.currentMaxRow = this.defaultRows;  // 現在のグリッド行数
        this.currentMaxCol = this.defaultCols;  // 現在のグリッド列数
        this.maxRowLimit = 1000000;  // 行の上限（32bit範囲相当）
        this.maxColLimit = 16384;    // 列の上限（XFD = 16384、Excel互換）
        this.rowExpandChunk = 50;    // 行拡張のチャンクサイズ
        this.colExpandChunk = 10;    // 列拡張のチャンクサイズ

        // データ管理
        this.cells = new Map(); // "col,row" -> { value, formula, displayValue, style, merge }
        this.virtualObjects = new Map(); // "col,row" -> virtualObjectData
        this.columnWidths = new Map(); // col -> width (デフォルトはthis.cellWidth)
        this.rowHeights = new Map(); // row -> height (デフォルトはthis.cellHeight)
        this.mergedCells = new Map(); // "startCol,startRow" -> { startCol, startRow, endCol, endRow }

        // 選択状態
        this.selectedCell = null; // { col, row } - アクティブセル
        this.selectionRange = null; // { startCol, startRow, endCol, endRow } - 選択範囲
        this.anchorCell = null; // { col, row } - Shift選択の基点
        this.isSelecting = false; // マウスドラッグ選択中フラグ
        this.isEditing = false;
        this.editingCell = null;
        this.savedCellSelection = null; // ウィンドウ非アクティブ時のセル選択保存用

        // フィルハンドル
        this.fillHandle = null;
        this.isDraggingFill = false;
        this.fillStartCell = null;

        // リサイズ関連
        this.isResizingColumn = false;
        this.isResizingRow = false;
        this.resizingTarget = null; // {type: 'column'/'row', index: number}
        this.resizeStartPos = null;
        this.resizeStartSize = null;

        // ドラッグ＆ドロップ関連
        // virtualObjectDragStateとdblClickDragStateはPluginBaseで定義済み
        this.dragSourceCell = null; // {col, row} - ドラッグ元のセル位置
        this.virtualObjectDropSuccess = false; // ドロップ成功フラグ

        // プラグイン固有のダブルクリックドラッグプロパティ
        this.dblClickDragState.dblClickedCell = null; // {col, row}

        // ウィンドウ・ファイル情報
        // windowIdはPluginBaseで定義済み
        this.realId = null;
        this.fileName = null;
        this.isModified = false;

        // 操作パネル
        this.operationPanelVisible = true; // 初期表示ON
        this.operationPanelWindowId = null;
        this.panelpos = { x: 50, y: 50 };

        // 最後に通知したセル（重複通知防止用）
        this.lastNotifiedCell = null;

        // 仮身関連
        this.contextMenuVirtualObject = null; // コンテキストメニュー表示時の仮身
        this.openedRealObjects = new Map(); // 開いている実身のID → windowId のマップ
        this.selectedVirtualObjectCell = null; // 選択中の仮身セル { col, row }
        this.isResizingVirtualObject = false; // 仮身リサイズ中フラグ
        // this.iconData は PluginBase で初期化済み

        // 画像パス取得関連
        this.imagePathCallbacks = {}; // messageId -> callback
        this.imagePathMessageId = 0;

        // 画像セル関連
        this.selectedImageCell = null; // 選択中の画像セル { col, row }
        this.isResizingImage = false; // 画像リサイズ中フラグ
        this.contextMenuImage = null; // コンテキストメニュー表示時の画像情報

        // VirtualObjectRenderer初期化
        if (window.VirtualObjectRenderer) {
            this.virtualObjectRenderer = new window.VirtualObjectRenderer();
            logger.info('[CalcEditor] VirtualObjectRenderer初期化完了');
        } else {
            logger.warn('[CalcEditor] VirtualObjectRendererが利用できません');
            this.virtualObjectRenderer = null;
        }

        // MessageBusはPluginBaseで初期化済み

        this.init();
    }

    init() {
        logger.info('[CalcEditor] 初期化開始');

        // IconCacheManager初期化（MessageBus初期化後に実行）
        if (window.IconCacheManager && this.messageBus) {
            this.iconManager = new window.IconCacheManager(this.messageBus, '[CalcEditor]');
            logger.info('[CalcEditor] IconCacheManager初期化完了');
        } else {
            logger.warn('[CalcEditor] IconCacheManagerが利用できません');
            this.iconManager = null;
        }

        // MessageBusハンドラ設定
        if (this.messageBus) {
            this.setupMessageBusHandlers();
        }

        // グリッド初期化
        this.initGrid();

        // 仮身ドラッグ用の右ボタンハンドラーを設定（PluginBase共通機能）
        this.setupVirtualObjectRightButtonHandlers();

        // イベントリスナー設定
        this.setupEventListeners();

        // ウィンドウアクティベーション（PluginBase共通）
        this.setupWindowActivation();

        // スクロール通知初期化（MessageBus経由で親ウィンドウにスクロール状態を通知）
        this.initScrollNotification();

        // キーボードショートカット
        this.setupKeyboardShortcuts();

        // フィルハンドル初期化
        this.setupFillHandle();

        // IME有効化用の常時フォーカスtextareaを設定
        this.setupImeInput();

        logger.info('[CalcEditor] 初期化完了');
    }

    /**
     * MessageBusハンドラ設定
     */
    setupMessageBusHandlers() {
        // 共通MessageBusハンドラを登録（PluginBaseで定義）
        // window-moved, window-resized-end, window-maximize-toggled,
        // menu-action, get-menu-definition, window-close-request
        this.setupCommonMessageBusHandlers();

        // 初期化メッセージ
        this.messageBus.on('init', async (data) => {
            logger.info('[CalcEditor] init受信', data);
            this.windowId = data.windowId;
            // MessageBusにもwindowIdを設定（レスポンスルーティング用）
            if (data.windowId) {
                this.messageBus.setWindowId(data.windowId);
            }

            if (data.fileData) {
                // realIdから_数字.xtadを除去（basic-figure-editorと同じ形式）
                let rawId = data.fileData.realId;
                this.realId = rawId ? rawId.replace(/_\d+\.xtad$/i, '') : null;
                logger.debug('[CalcEditor] realId設定:', this.realId, '(元:', rawId, ')');
                this.fileName = data.fileData.fileName || data.fileData.displayName || '新規表計算';

                // XMLデータがあれば読み込み（親はxmlDataフィールドを使用）
                if (data.fileData.xmlData) {
                    await this.loadXtadData(data.fileData.xmlData);
                }

                // 操作パネル位置を復元
                if (data.fileData.realObject && data.fileData.realObject.window && data.fileData.realObject.window.panelpos) {
                    this.panelpos = data.fileData.realObject.window.panelpos;
                    logger.debug('[CalcEditor] 操作パネル位置を復元:', this.panelpos);
                }

                // 操作パネル表示状態を復元
                if (data.fileData.realObject && data.fileData.realObject.window && typeof data.fileData.realObject.window.panel === 'boolean') {
                    this.operationPanelVisible = data.fileData.realObject.window.panel;
                    logger.debug('[CalcEditor] 操作パネル表示状態を復元:', this.operationPanelVisible);
                }

                // 背景色の設定（開いた仮身の表示領域背景）
                if (data.fileData.bgcol) {
                    this.applyBackgroundColor(data.fileData.bgcol);
                }
            }

            // 操作パネルを開く
            setTimeout(() => {
                if (this.operationPanelVisible) {
                    this.openOperationPanel();
                }
            }, 500);

            // スクロール位置を復元（DOM更新完了を待つ）
            if (data.fileData && data.fileData.windowConfig && data.fileData.windowConfig.scrollPos) {
                setTimeout(() => {
                    this.setScrollPosition(data.fileData.windowConfig.scrollPos);
                }, 200);
            }
        });

        // window-moved, window-resized-end はsetupCommonMessageBusHandlers()で登録済み

        // 操作パネルウィンドウ作成完了
        this.messageBus.on('tool-panel-window-created', (data) => {
            logger.debug('[CalcEditor] 操作パネルウィンドウ作成完了:', data.windowId);
            this.operationPanelWindowId = data.windowId;
        });

        // 操作パネル位置移動
        this.messageBus.on('tool-panel-window-moved', (data) => {
            logger.debug('[CalcEditor] 操作パネル位置移動:', data.pos);
            this.updatePanelPosition(data.pos);
        });

        // menu-action, get-menu-definition はsetupCommonMessageBusHandlers()で登録済み

        // 親ウィンドウからのドロップイベント
        this.messageBus.on('parent-drop-event', (data) => {
            logger.info('[CalcEditor] parent-drop-event受信');
            const dragData = data.dragData;
            const clientX = data.clientX;
            const clientY = data.clientY;

            logger.debug('[CalcEditor] dragData:', dragData);
            logger.debug('[CalcEditor] clientX:', clientX, 'clientY:', clientY);

            // 任意のプラグインからの仮身ドロップの場合
            if (dragData.type === 'virtual-object-drag') {
                logger.info(`[CalcEditor] 仮身ドロップを検出: source=${dragData.source}`);

                const virtualObjects = dragData.virtualObjects || [dragData.virtualObject];
                logger.debug('[CalcEditor] 仮身数:', virtualObjects.length);

                // セル要素を取得
                const cell = document.elementFromPoint(clientX, clientY)?.closest('.cell');
                if (!cell) {
                    logger.warn('[CalcEditor] ドロップ位置にセルが見つかりません');
                    return;
                }

                const col = parseInt(cell.dataset.col);
                const row = parseInt(cell.dataset.row);

                logger.info(`[CalcEditor] 仮身ドロップ: ${this.colToLetter(col)}${row}`);

                // 複数の仮身を順番に挿入（横方向に並べる）
                virtualObjects.forEach((virtualObject, index) => {
                    const targetCol = col + index;
                    if (targetCol >= this.defaultCols) return;

                    // 対象セルを選択
                    this.selectCell(targetCol, row);

                    // link_idから実身IDを抽出
                    const realId = window.RealObjectSystem.extractRealId(virtualObject.link_id);

                    // 仮身オブジェクト全体を渡す
                    this.insertVirtualObject(virtualObject);

                    // コピーモードの場合はrefCount+1（移動モードは変更なし）
                    if (dragData.mode === 'copy') {
                        this.requestCopyVirtualObject(virtualObject.link_id);
                    }
                });

                // ドラッグ元のウィンドウに「クロスウィンドウドロップ成功」を通知
                // PluginBaseの共通メソッドを使用
                this.notifyCrossWindowDropSuccess(dragData, virtualObjects);

                logger.info('[CalcEditor] 仮身ドロップ処理完了');
            }
        });

        // add-virtual-object-from-base メッセージ（原紙箱からの仮身追加）
        this.messageBus.on('add-virtual-object-from-base', (data) => {
            logger.debug('[CalcEditor] [MessageBus] 原紙箱から仮身追加:', data.realId, data.name);
            this.addVirtualObjectFromRealId(data.realId, data.name, data.targetCell, data.applist);
        });

        // 操作パネルからのセル値更新
        this.messageBus.on('calc-cell-value-update', (data) => {
            // ウィンドウがアクティブでない場合、空の値更新は無視
            // （操作パネルからの正当な入力には値が含まれるはず）
            if (!this.isWindowActive && (!data.value || data.value === '')) {
                logger.info('[CalcEditor] ウィンドウ非アクティブのため空のセル値更新をスキップ');
                return;
            }
            if (this.selectedCell) {
                this.setCellValue(this.selectedCell.col, this.selectedCell.row, data.value);
                this.renderCell(this.selectedCell.col, this.selectedCell.row);
            }
        });

        // 操作パネルからの書式設定
        this.messageBus.on('calc-cell-format', (data) => {
            // 範囲選択がある場合は範囲全体に適用
            if (this.selectionRange) {
                this.applyStyleToRange(this.selectionRange, data.style);
            } else if (this.selectedCell) {
                // 単一セル選択の場合、枠線があれば特別処理
                if (data.style.border) {
                    // 単一セルを範囲として扱う
                    const singleCellRange = {
                        startCol: this.selectedCell.col,
                        startRow: this.selectedCell.row,
                        endCol: this.selectedCell.col,
                        endRow: this.selectedCell.row
                    };
                    this.applyBorderToRange(singleCellRange, data.style.border);

                    // 枠線以外のスタイルがあれば適用
                    const styleWithoutBorder = { ...data.style };
                    delete styleWithoutBorder.border;
                    if (Object.keys(styleWithoutBorder).length > 0) {
                        this.setCellStyle(this.selectedCell.col, this.selectedCell.row, styleWithoutBorder);
                        this.renderCell(this.selectedCell.col, this.selectedCell.row);
                    }
                } else {
                    // 枠線以外のスタイル
                    this.setCellStyle(this.selectedCell.col, this.selectedCell.row, data.style);
                    this.renderCell(this.selectedCell.col, this.selectedCell.row);
                }
            } else {
                logger.warn('[CalcEditor] セルが選択されていません');
            }
        });

        // window-close-request はsetupCommonMessageBusHandlers()で登録済み

        // 仮身挿入
        this.messageBus.on('insert-virtual-object', (data) => {
            // 仮身オブジェクト全体が渡された場合
            if (data.virtualObject) {
                this.insertVirtualObject(data.virtualObject);
            }
            // 旧形式（realIdとrealInfoが個別に渡された場合）の後方互換性対応
            else if (data.realId && data.realInfo) {
                // 簡易的な仮身オブジェクトを構築
                const virtualObject = {
                    link_id: `${data.realId}_0.xtad`,
                    link_name: data.realInfo.displayName || data.realInfo.fileName || 'unknown',
                    realId: data.realId,
                    displayName: data.realInfo.displayName || data.realInfo.fileName || 'unknown',
                    pluginType: data.realInfo.pluginType || 'base',
                    iconPath: data.realInfo.iconPath || null
                };
                this.insertVirtualObject(virtualObject);
            } else {
                logger.warn('[CalcEditor] insert-virtual-object: 不正なデータ形式', data);
            }
        });

        // 検索/置換ウィンドウからのリクエスト
        this.messageBus.on('calc-find-next-request', (data) => {
            this.findInCells(data.searchText, data.isRegex);
        });

        this.messageBus.on('calc-replace-next-request', (data) => {
            this.replaceInCells(data.searchText, data.replaceText, data.isRegex);
        });

        this.messageBus.on('calc-replace-all-request', (data) => {
            this.replaceAllInCells(data.searchText, data.replaceText, data.isRegex);
        });

        // ウィンドウクローズ通知（開いた仮身の追跡用）
        this.messageBus.on('window-closed', (data) => {
            // openedRealObjectsから削除
            for (const [realId, windowId] of this.openedRealObjects.entries()) {
                if (windowId === data.windowId) {
                    this.openedRealObjects.delete(realId);
                    logger.debug('[CalcEditor] 実身ウィンドウを追跡から削除:', realId);
                    break;
                }
            }
        });

        // 画像ファイルパス応答
        this.messageBus.on('image-file-path-response', (data) => {
            logger.debug('[CalcEditor] image-file-path-response受信:', data.messageId);
            if (this.imagePathCallbacks && this.imagePathCallbacks[data.messageId]) {
                this.imagePathCallbacks[data.messageId](data.filePath);
                delete this.imagePathCallbacks[data.messageId];
            }
        });

        // cross-window-drop-success ハンドラはPluginBaseの共通機能に移行
        // onDeleteSourceVirtualObject()フックで仮身削除処理を実装
        this.setupCrossWindowDropSuccessHandler();
    }

    /**
     * 列幅を取得（カスタム幅またはデフォルト）
     */
    getColumnWidth(col) {
        return this.columnWidths.get(col) || this.cellWidth;
    }

    /**
     * 行高を取得（カスタム高さまたはデフォルト）
     */
    getRowHeight(row) {
        return this.rowHeights.get(row) || this.cellHeight;
    }

    /**
     * 列幅を設定
     */
    setColumnWidth(col, width) {
        this.columnWidths.set(col, Math.max(20, width)); // 最小幅20px
        this.applyColumnWidth(col);
    }

    /**
     * 行高を設定
     */
    setRowHeight(row, height) {
        this.rowHeights.set(row, Math.max(15, height)); // 最小高さ15px
        this.applyRowHeight(row);
    }

    /**
     * 列幅をDOMに適用
     */
    applyColumnWidth(col) {
        const width = this.getColumnWidth(col);
        // 列ヘッダー
        const colHeader = document.querySelector(`.column-header[data-col="${col}"]`);
        if (colHeader) {
            colHeader.style.width = width + 'px';
            colHeader.style.minWidth = width + 'px';
        }
        // すべての該当セル
        const cells = document.querySelectorAll(`.cell[data-col="${col}"]`);
        cells.forEach(cell => {
            cell.style.width = width + 'px';
            cell.style.minWidth = width + 'px';
        });
    }

    /**
     * 行高をDOMに適用
     */
    applyRowHeight(row) {
        const height = this.getRowHeight(row);
        // 行ヘッダー
        const rowHeader = document.querySelector(`.row-header[data-row="${row}"]`);
        if (rowHeader) {
            rowHeader.style.height = height + 'px';
        }
        // グリッド行全体
        const gridRow = document.querySelector(`.grid-row[data-row="${row}"]`);
        if (gridRow) {
            gridRow.style.height = height + 'px';
        }
        // すべての該当セル
        const cells = document.querySelectorAll(`.cell[data-row="${row}"]`);
        cells.forEach(cell => {
            cell.style.height = height + 'px';
        });
    }

    /**
     * グリッド初期化
     */
    initGrid() {
        const headerContainer = document.getElementById('grid-header');
        const bodyContainer = document.getElementById('grid-body');

        // 列ヘッダー生成
        for (let col = 1; col <= this.defaultCols; col++) {
            const colHeader = document.createElement('div');
            colHeader.className = 'column-header';
            colHeader.textContent = this.colToLetter(col);
            colHeader.dataset.col = col;
            headerContainer.appendChild(colHeader);
        }

        // 行生成
        for (let row = 1; row <= this.defaultRows; row++) {
            const gridRow = document.createElement('div');
            gridRow.className = 'grid-row';
            gridRow.dataset.row = row;

            // 行ヘッダー
            const rowHeader = document.createElement('div');
            rowHeader.className = 'row-header';
            rowHeader.textContent = row;
            rowHeader.dataset.row = row;
            gridRow.appendChild(rowHeader);

            // セル生成
            for (let col = 1; col <= this.defaultCols; col++) {
                const cell = document.createElement('div');
                cell.className = 'cell';
                cell.dataset.col = col;
                cell.dataset.row = row;
                gridRow.appendChild(cell);
            }

            bodyContainer.appendChild(gridRow);
        }

        logger.info(`[CalcEditor] グリッド生成完了: ${this.defaultCols}列 x ${this.defaultRows}行`);
    }

    /**
     * グリッドを指定された行・列まで拡張
     * @param {number} toRow - 必要な行番号
     * @param {number} toCol - 必要な列番号
     * @returns {boolean} 拡張が行われたかどうか
     */
    expandGridTo(toRow, toCol) {
        // 上限チェック
        toRow = Math.min(toRow, this.maxRowLimit);
        toCol = Math.min(toCol, this.maxColLimit);

        // 拡張が必要かチェック
        if (toRow <= this.currentMaxRow && toCol <= this.currentMaxCol) {
            return false;
        }

        const headerContainer = document.getElementById('grid-header');
        const bodyContainer = document.getElementById('grid-body');

        // 列ヘッダーの拡張
        if (toCol > this.currentMaxCol) {
            const newMaxCol = Math.max(toCol, this.currentMaxCol + this.colExpandChunk);
            const targetMaxCol = Math.min(newMaxCol, this.maxColLimit);

            for (let col = this.currentMaxCol + 1; col <= targetMaxCol; col++) {
                const colHeader = document.createElement('div');
                colHeader.className = 'column-header';
                colHeader.textContent = this.colToLetter(col);
                colHeader.dataset.col = col;
                headerContainer.appendChild(colHeader);
            }

            // 既存の行に新しいセルを追加
            const rows = bodyContainer.querySelectorAll('.grid-row');
            rows.forEach((gridRow) => {
                const rowNum = parseInt(gridRow.dataset.row);
                for (let col = this.currentMaxCol + 1; col <= targetMaxCol; col++) {
                    const cell = document.createElement('div');
                    cell.className = 'cell';
                    cell.dataset.col = col;
                    cell.dataset.row = rowNum;
                    gridRow.appendChild(cell);
                }
            });

            this.currentMaxCol = targetMaxCol;
            logger.info(`[CalcEditor] 列を拡張: ${targetMaxCol}列まで`);

            // カスタム行高を新しいセルに適用
            this.rowHeights.forEach((_, row) => {
                this.applyRowHeight(row);
            });
        }

        // 行の拡張
        if (toRow > this.currentMaxRow) {
            const newMaxRow = Math.max(toRow, this.currentMaxRow + this.rowExpandChunk);
            const targetMaxRow = Math.min(newMaxRow, this.maxRowLimit);

            for (let row = this.currentMaxRow + 1; row <= targetMaxRow; row++) {
                const gridRow = document.createElement('div');
                gridRow.className = 'grid-row';
                gridRow.dataset.row = row;

                // 行ヘッダー
                const rowHeader = document.createElement('div');
                rowHeader.className = 'row-header';
                rowHeader.textContent = row;
                rowHeader.dataset.row = row;
                gridRow.appendChild(rowHeader);

                // セル生成
                for (let col = 1; col <= this.currentMaxCol; col++) {
                    const cell = document.createElement('div');
                    cell.className = 'cell';
                    cell.dataset.col = col;
                    cell.dataset.row = row;
                    gridRow.appendChild(cell);
                }

                bodyContainer.appendChild(gridRow);
            }

            this.currentMaxRow = targetMaxRow;
            logger.info(`[CalcEditor] 行を拡張: ${targetMaxRow}行まで`);

            // カスタム列幅を新しいセルに適用
            this.columnWidths.forEach((_, col) => {
                this.applyColumnWidth(col);
            });
        }

        // スクロールバー更新を通知
        this.notifyScrollChange();

        return true;
    }

    /**
     * イベントリスナー設定
     */
    setupEventListeners() {
        const gridBody = document.getElementById('grid-body');

        // セルマウスダウン（選択開始）
        gridBody.addEventListener('mousedown', (e) => {
            const cell = e.target.closest('.cell');
            if (cell && e.button === 0) { // 左クリックのみ
                const col = parseInt(cell.dataset.col);
                const row = parseInt(cell.dataset.row);

                if (e.shiftKey && this.anchorCell) {
                    // Shift+クリック: 範囲選択
                    this.selectRange(this.anchorCell.col, this.anchorCell.row, col, row);
                } else {
                    // 通常クリック: 単一セル選択＆ドラッグ開始
                    // 範囲選択をクリアしてから選択（ドラッグで再度範囲選択される）
                    this.selectCell(col, row, true);
                    this.isSelecting = true;
                }
            }
        });

        // マウス移動（ドラッグ選択）
        gridBody.addEventListener('mousemove', (e) => {
            if (this.isSelecting && this.anchorCell) {
                const cell = e.target.closest('.cell');
                if (cell) {
                    const col = parseInt(cell.dataset.col);
                    const row = parseInt(cell.dataset.row);
                    this.selectRange(this.anchorCell.col, this.anchorCell.row, col, row);
                }
            }
        });

        // マウスアップ（選択終了）
        document.addEventListener('mouseup', (e) => {
            if (this.isSelecting) {
                this.isSelecting = false;
            }
        });

        // セルダブルクリック（仮身を開く or 編集開始）
        gridBody.addEventListener('dblclick', (e) => {
            const cell = e.target.closest('.cell');
            if (cell) {
                const col = parseInt(cell.dataset.col);
                const row = parseInt(cell.dataset.row);
                const key = `${col},${row}`;
                const cellData = this.cells.get(key);

                // 仮身セルの場合は仮身を開く
                if (cellData && cellData.contentType === 'virtualObject' && cellData.virtualObject) {
                    const virtualObject = cellData.virtualObject;
                    if (virtualObject.link_id) {
                        logger.info(`[CalcEditor] 仮身ダブルクリック: ${virtualObject.link_id}`);
                        if (this.messageBus) {
                            this.messageBus.send('open-virtual-object', {
                                linkId: virtualObject.link_id,
                                linkName: virtualObject.link_name || '無題'
                            });
                        }
                    } else {
                        logger.warn('[CalcEditor] 仮身にlink_idがありません');
                    }
                } else {
                    // 通常セルは編集モード
                    this.startEditing(col, row);
                }
            }
        });

        // 列ヘッダークリック
        const gridHeader = document.getElementById('grid-header');
        gridHeader.addEventListener('click', (e) => {
            const colHeader = e.target.closest('.column-header');
            if (colHeader) {
                const col = parseInt(colHeader.dataset.col);
                this.selectColumn(col);
            }
        });

        // 行ヘッダークリック
        gridBody.addEventListener('click', (e) => {
            const rowHeader = e.target.closest('.row-header');
            if (rowHeader) {
                const row = parseInt(rowHeader.dataset.row);
                this.selectRow(row);
            }
        });

        // コンテキストメニュー
        gridBody.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.showContextMenu(e.clientX, e.clientY);
        });

        // クリックイベントで親ウィンドウのコンテキストメニューを閉じる
        document.addEventListener('click', (e) => {
            this.closeContextMenu();
        });

        // ドラッグ&ドロップ機能
        this.setupDragAndDrop();

        // リサイズ機能
        this.setupResizeHandlers();
    }

    /**
     * ドラッグ&ドロップ機能を設定
     */
    setupDragAndDrop() {
        const container = document.querySelector('.plugin-content');
        if (!container) {
            logger.error('[CalcEditor] .plugin-contentが見つかりません');
            return;
        }

        // ドラッグオーバー
        container.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();

            logger.debug('[CalcEditor] dragover イベント');

            // ドラッグ中のフラグを立てる
            if (this.dragSourceCell) {
                this.virtualObjectDragState.hasMoved = true;
            }

            // effectAllowedに応じてdropEffectを設定
            if (e.dataTransfer.effectAllowed === 'move' || e.dataTransfer.effectAllowed === 'copyMove') {
                e.dataTransfer.dropEffect = 'move';
            } else {
                e.dataTransfer.dropEffect = 'copy';
            }

            container.style.backgroundColor = '#e8f4f8';
        });

        // ドラッグリーブ
        container.addEventListener('dragleave', (e) => {
            // 子要素への移動でdragleaveが発火するのを防ぐ
            if (e.target === container) {
                logger.debug('[CalcEditor] dragleave イベント');
                container.style.backgroundColor = '';
            }
        });

        // ドロップ
        container.addEventListener('drop', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            logger.info('[CalcEditor] drop イベント');

            container.style.backgroundColor = '';

            try {
                // 外部ファイルドロップをチェック（Windowsからのドラッグなど）
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    const files = Array.from(e.dataTransfer.files);
                    logger.info('[CalcEditor] 外部ファイルドロップ検出:', files.length, '個のファイル');

                    // ドロップ位置からセルを特定
                    const cell = document.elementFromPoint(e.clientX, e.clientY)?.closest('.cell');
                    let targetCell = null;
                    if (cell) {
                        targetCell = {
                            col: parseInt(cell.dataset.col),
                            row: parseInt(cell.dataset.row)
                        };
                        logger.info('[CalcEditor] ドロップ先セル:', this.colToLetter(targetCell.col) + targetCell.row);
                    } else {
                        logger.warn('[CalcEditor] ドロップ位置にセルが見つかりません、デフォルト位置を使用');
                        targetCell = { col: 1, row: 1 };
                    }

                    // 画像ファイルとその他のファイルを分離
                    const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'ico', 'svg'];
                    const imageFiles = [];
                    const otherFiles = [];

                    for (const file of files) {
                        const ext = file.name.split('.').pop().toLowerCase();
                        if (imageExtensions.includes(ext)) {
                            imageFiles.push(file);
                        } else {
                            otherFiles.push(file);
                        }
                    }

                    // 画像ファイルは直接セルに挿入
                    if (imageFiles.length > 0) {
                        logger.info('[CalcEditor] 画像ファイル検出:', imageFiles.length, '個');
                        this.insertImageFilesToCells(imageFiles, targetCell);
                    }

                    // その他のファイルは親に送信
                    if (otherFiles.length > 0) {
                        this.readAndSendFiles(otherFiles, e.clientX, e.clientY, targetCell);
                    }

                    return;
                }

                // PluginBase共通メソッドでdragDataをパース（linkタグXMLは別処理）
                const data = e.dataTransfer.getData('text/plain');
                logger.debug('[CalcEditor] ドロップデータ:', data);

                if (!data) {
                    logger.warn('[CalcEditor] ドロップデータが空です');
                    return;
                }

                // linkタグXML（仮身）かどうかチェック
                if (data.trim().startsWith('<link')) {
                    logger.info('[CalcEditor] linkタグXMLを検出 - 表計算内での仮身ドロップ処理');

                    // linkタグをパースして仮身オブジェクトに変換
                    const virtualObject = this.parseLinkTag(data);
                    if (!virtualObject) {
                        logger.warn('[CalcEditor] linkタグのパースに失敗');
                        return;
                    }

                    // ドロップ位置のセルを取得
                    const cell = document.elementFromPoint(e.clientX, e.clientY)?.closest('.cell');
                    if (!cell) {
                        logger.warn('[CalcEditor] ドロップ位置にセルが見つかりません');
                        return;
                    }

                    const col = parseInt(cell.dataset.col);
                    const row = parseInt(cell.dataset.row);
                    const key = `${col},${row}`;

                    logger.info(`[CalcEditor] 仮身をセルに配置: ${this.colToLetter(col)}${row}`, virtualObject);

                    // メタデータをJSONから読み込み（続柄、更新日時など）、完了後にセルを設定
                    // 移動モード用の情報を保持（コールバック内で参照するため）
                    const dragSourceCellInfo = this.dragSourceCell ? { ...this.dragSourceCell } : null;
                    const dragMode = this.virtualObjectDragState.dragMode;

                    this.loadVirtualObjectMetadata(virtualObject).then(() => {
                        // セルに仮身を設定
                        this.cells.set(key, {
                            value: '',
                            formula: '',
                            displayValue: '',
                            style: {},
                            virtualObject: virtualObject,
                            contentType: 'virtualObject'
                        });

                        this.isModified = true;
                        this.renderCell(col, row);

                        // デバッグ: ドラッグ元の状態を確認
                        logger.info('[CalcEditor] ドラッグ元の状態確認:', {
                            dragSourceCell: dragSourceCellInfo,
                            dragMode: dragMode
                        });

                        // 移動モードの場合は、ドラッグ元のセルをクリア
                        if (dragSourceCellInfo && dragMode === 'move') {
                            const sourceKey = `${dragSourceCellInfo.col},${dragSourceCellInfo.row}`;
                            logger.info(`[CalcEditor] 移動モード条件チェック: sourceKey=${sourceKey}, targetKey=${key}`);
                            // ドラッグ先と同じセルでない場合のみクリア
                            if (sourceKey !== key) {
                                this.cells.delete(sourceKey);
                                this.renderCell(dragSourceCellInfo.col, dragSourceCellInfo.row);
                                logger.info(`[CalcEditor] ドラッグ元のセルをクリア（移動モード）: ${this.colToLetter(dragSourceCellInfo.col)}${dragSourceCellInfo.row}`);
                            } else {
                                logger.info('[CalcEditor] 同じセルへのドロップのため、元のセルはクリアしない');
                            }
                        } else if (dragSourceCellInfo && dragMode === 'copy') {
                            logger.info(`[CalcEditor] ドラッグ元のセルを保持（コピーモード）: ${this.colToLetter(dragSourceCellInfo.col)}${dragSourceCellInfo.row}`);
                        } else {
                            logger.warn('[CalcEditor] ドラッグ元のセルをクリアしない理由:', {
                                hasDragSourceCell: !!dragSourceCellInfo,
                                dragMode: dragMode
                            });
                        }

                        // ドロップ成功フラグを設定（dragendでのリセットを防ぐ）
                        this.virtualObjectDropSuccess = true;

                        logger.info('[CalcEditor] 仮身ドロップ完了');
                    });
                    return;
                }

                // PluginBase共通メソッドでJSON parseを実行
                const dragData = this.parseDragData(e.dataTransfer);
                if (!dragData) {
                    logger.warn('[CalcEditor] ドロップデータがJSON形式ではありません');
                    return;
                }
                logger.debug('[CalcEditor] パース成功:', dragData);

                // 原紙箱からのドロップ
                if ((dragData.type === 'base-file-copy' || dragData.type === 'user-base-file-copy') && dragData.source === 'base-file-manager') {
                    logger.info('[CalcEditor] 原紙箱からのドロップを検出');

                    // セル要素を取得
                    const cell = document.elementFromPoint(e.clientX, e.clientY)?.closest('.cell');
                    if (cell) {
                        const col = parseInt(cell.dataset.col);
                        const row = parseInt(cell.dataset.row);
                        // PluginBase共通メソッドを呼び出し
                        this.handleBaseFileDrop(dragData, e.clientX, e.clientY, { targetCell: { col, row } });
                    } else {
                        logger.warn('[CalcEditor] ドロップ位置にセルが見つかりません');
                    }
                    return;
                }

                // 任意のプラグインからの仮身ドロップ
                if (dragData.type === 'virtual-object-drag') {
                    logger.info(`[CalcEditor] 仮身ドロップを検出: source=${dragData.source}, isDuplicateDrag=${dragData.isDuplicateDrag}`);

                    const virtualObjects = dragData.virtualObjects || [dragData.virtualObject];
                    logger.debug('[CalcEditor] 仮身数:', virtualObjects.length);

                    // セル要素を取得
                    const cell = document.elementFromPoint(e.clientX, e.clientY)?.closest('.cell');
                    if (!cell) {
                        logger.warn('[CalcEditor] ドロップ位置にセルが見つかりません');
                        return;
                    }

                    const col = parseInt(cell.dataset.col);
                    const row = parseInt(cell.dataset.row);

                    logger.info(`[CalcEditor] 仮身ドロップ: ${this.colToLetter(col)}${row}`);

                    // 複数の仮身を順番に挿入（横方向に並べる）
                    for (let index = 0; index < virtualObjects.length; index++) {
                        const virtualObject = virtualObjects[index];
                        const targetCol = col + index;
                        if (targetCol > this.defaultCols) break;

                        // 対象セルを選択
                        this.selectCell(targetCol, row);

                        let targetVirtualObject = virtualObject;

                        // ダブルクリックドラッグ（実身複製）の場合
                        if (dragData.isDuplicateDrag) {
                            logger.info('[CalcEditor] 実身複製ドラッグを検出');
                            try {
                                targetVirtualObject = await this.duplicateRealObjectForDrag(virtualObject);
                                logger.info(`[CalcEditor] 実身複製成功: ${virtualObject.link_id} -> ${targetVirtualObject.link_id}`);
                            } catch (error) {
                                logger.error('[CalcEditor] 実身複製エラー:', error);
                                continue; // 次の仮身へ
                            }
                        }

                        // link_idから実身IDを抽出
                        const realId = window.RealObjectSystem.extractRealId(targetVirtualObject.link_id);

                        // 仮身オブジェクト全体を渡す
                        this.insertVirtualObject(targetVirtualObject);

                        // コピーモードの場合はrefCount+1（移動モードは変更なし）
                        if (dragData.mode === 'copy') {
                            this.requestCopyVirtualObject(targetVirtualObject.link_id);
                        }
                    }

                    // ドラッグ元のウィンドウに「クロスウィンドウドロップ成功」を通知
                    if (this.messageBus) {
                        // PluginBaseの共通メソッドを使用
                        dragData.targetWindowId = this.windowId;
                        this.notifyCrossWindowDropSuccess(dragData, virtualObjects);
                    }
                }
            } catch (err) {
                logger.error('[CalcEditor] ドロップ処理エラー:', err);
            }
        });
    }

    /**
     * リサイズハンドラー設定
     */
    setupResizeHandlers() {
        const gridHeader = document.getElementById('grid-header');
        const gridBody = document.getElementById('grid-body');
        const RESIZE_HANDLE_WIDTH = 5; // リサイズ判定領域の幅（ピクセル）

        // 列ヘッダーのマウス移動（カーソル変更とリサイズ準備）
        gridHeader.addEventListener('mousemove', (e) => {
            if (this.isResizingColumn) return;

            const colHeader = e.target.closest('.column-header');
            if (!colHeader) {
                return;
            }

            const rect = colHeader.getBoundingClientRect();
            const offsetX = e.clientX - rect.left;

            // 右端付近かチェック（前の列のリサイズ）
            if (offsetX <= RESIZE_HANDLE_WIDTH) {
                // 左端付近 - 前の列をリサイズ
                const col = parseInt(colHeader.dataset.col);
                if (col > 1) {
                    colHeader.style.cursor = 'col-resize';
                    colHeader.dataset.resizeCol = col - 1;
                } else {
                    colHeader.style.cursor = 'default';
                }
            } else if (rect.width - offsetX <= RESIZE_HANDLE_WIDTH) {
                // 右端付近 - この列をリサイズ
                colHeader.style.cursor = 'col-resize';
                const col = parseInt(colHeader.dataset.col);
                colHeader.dataset.resizeCol = col;
            } else {
                colHeader.style.cursor = 'pointer';
                delete colHeader.dataset.resizeCol;
            }
        });

        // 列ヘッダーのマウスダウン（リサイズ開始）
        gridHeader.addEventListener('mousedown', (e) => {
            const colHeader = e.target.closest('.column-header');
            if (!colHeader || !colHeader.dataset.resizeCol) return;

            e.preventDefault();
            e.stopPropagation();
            const col = parseInt(colHeader.dataset.resizeCol);
            this.isResizingColumn = true;
            this.resizingTarget = { type: 'column', index: col };
            this.resizeStartPos = e.clientX;
            this.resizeStartSize = this.getColumnWidth(col);

            logger.debug(`[CalcEditor] 列リサイズ開始: col=${col}, 初期幅=${this.resizeStartSize}`);
        });

        // グローバルマウス移動（リサイズ中の処理）
        document.addEventListener('mousemove', (e) => {
            if (this.isResizingColumn) {
                const deltaX = e.clientX - this.resizeStartPos;
                const newWidth = this.resizeStartSize + deltaX;
                this.setColumnWidth(this.resizingTarget.index, newWidth);
            } else if (this.isResizingRow) {
                const deltaY = e.clientY - this.resizeStartPos;
                const newHeight = this.resizeStartSize + deltaY;
                this.setRowHeight(this.resizingTarget.index, newHeight);
            }
        });

        // 行ヘッダーのマウス移動（カーソル変更とリサイズ準備）
        gridBody.addEventListener('mousemove', (e) => {
            const rowHeader = e.target.closest('.row-header');
            if (!rowHeader) return;

            const rect = rowHeader.getBoundingClientRect();
            const offsetY = e.clientY - rect.top;

            // 上端付近かチェック（前の行のリサイズ）
            if (offsetY <= RESIZE_HANDLE_WIDTH) {
                // 上端付近 - 前の行をリサイズ
                const row = parseInt(rowHeader.dataset.row);
                if (row > 1) {
                    rowHeader.style.cursor = 'row-resize';
                    rowHeader.dataset.resizeRow = row - 1;
                } else {
                    rowHeader.style.cursor = 'default';
                }
            } else if (rect.height - offsetY <= RESIZE_HANDLE_WIDTH) {
                // 下端付近 - この行をリサイズ
                rowHeader.style.cursor = 'row-resize';
                const row = parseInt(rowHeader.dataset.row);
                rowHeader.dataset.resizeRow = row;
            } else {
                rowHeader.style.cursor = 'pointer';
                delete rowHeader.dataset.resizeRow;
            }
        });

        // 行ヘッダーのマウスダウン（リサイズ開始）
        gridBody.addEventListener('mousedown', (e) => {
            const rowHeader = e.target.closest('.row-header');
            if (!rowHeader || !rowHeader.dataset.resizeRow) return;

            e.preventDefault();
            e.stopPropagation();
            const row = parseInt(rowHeader.dataset.resizeRow);
            this.isResizingRow = true;
            this.resizingTarget = { type: 'row', index: row };
            this.resizeStartPos = e.clientY;
            this.resizeStartSize = this.getRowHeight(row);

            logger.debug(`[CalcEditor] 行リサイズ開始: row=${row}, 初期高さ=${this.resizeStartSize}`);
        });

        // document全体でのmousemove（ダブルクリックドラッグ処理用）
        document.addEventListener('mousemove', (e) => {
            // PluginBase共通メソッドでドラッグ開始判定
            if (this.shouldStartDblClickDrag(e)) {
                logger.debug('[CalcEditor] ダブルクリックドラッグ確定');
            }

            // ダブルクリックドラッグ中の処理（視覚的フィードバックは省略）
            // 他のプラグインではdragPreviewを表示するが、calc-editorでは不要
        });

        // document全体でのmouseup（ダブルクリックドラッグ終了処理用）
        document.addEventListener('mouseup', (e) => {
            // ダブルクリックドラッグ確定中のmouseupで実身複製を実行
            if (this.dblClickDragState.isDblClickDrag && e.button === 0) {
                const sourceCell = this.dblClickDragState.dblClickedCell;
                if (sourceCell) {
                    // ドロップ位置のセルを取得
                    const cell = document.elementFromPoint(e.clientX, e.clientY)?.closest('.cell');
                    if (cell) {
                        const targetCol = parseInt(cell.dataset.col);
                        const targetRow = parseInt(cell.dataset.row);

                        logger.info(`[CalcEditor] ダブルクリックドラッグで実身複製: ${this.colToLetter(sourceCell.col)}${sourceCell.row} -> ${this.colToLetter(targetCol)}${targetRow}`);
                        this.handleDoubleClickDragDuplicate(sourceCell.col, sourceCell.row, targetCol, targetRow);
                    }
                }

                // PluginBase共通メソッドでダブルクリックドラッグ状態をクリア
                this.cleanupDblClickDragState();
                this.dblClickDragState.dblClickedCell = null; // プラグイン固有プロパティもクリア
                return;
            }

            // ダブルクリック候補のmouseupで通常のdblclickイベントに委譲
            if (this.dblClickDragState.isDblClickDragCandidate && e.button === 0) {
                logger.debug('[CalcEditor] ダブルクリック検出（移動なし）、ダブルクリックイベントに委譲');
                // PluginBase共通メソッドでクリーンアップ
                this.cleanupDblClickDragState();
                // dblclickイベントが発火するので、ここでは何もしない
            }
        });

        // document全体でのmousedown（仮身ドラッグ中の右ボタン検出用）
        // 右ボタン処理はPluginBaseのsetupVirtualObjectRightButtonHandlers()で処理

        // マウスアップ（リサイズ終了）
        document.addEventListener('mouseup', (e) => {
            if (this.isResizingColumn || this.isResizingRow) {
                logger.debug('[CalcEditor] リサイズ終了');
                this.isResizingColumn = false;
                this.isResizingRow = false;
                this.resizingTarget = null;
                this.resizeStartPos = null;
                this.resizeStartSize = null;
                gridHeader.style.cursor = 'default';
                this.isModified = true; // 変更フラグを立てる
            }
        });

        // マウスリーブ（カーソルリセット）
        gridHeader.addEventListener('mouseleave', () => {
            if (!this.isResizingColumn) {
                // 全ての列ヘッダーのカーソルをリセット
                const colHeaders = gridHeader.querySelectorAll('.column-header');
                colHeaders.forEach(header => {
                    header.style.cursor = 'pointer';
                });
            }
        });
    }

    /**
     * キーボードショートカット設定
     */
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // 編集中は特別な処理
            if (this.isEditing) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.finishEditing();
                    // 下のセルに移動
                    if (this.selectedCell) {
                        this.selectCell(this.selectedCell.col, this.selectedCell.row + 1);
                    }
                } else if (e.key === 'Tab') {
                    e.preventDefault();
                    this.finishEditing();
                    // 右のセルに移動
                    if (this.selectedCell) {
                        this.selectCell(this.selectedCell.col + 1, this.selectedCell.row);
                    }
                } else if (e.key === 'Escape') {
                    this.cancelEditing();
                }
                return;
            }

            // 非編集中のキー操作
            if (!this.selectedCell) return;

            const { col, row } = this.selectedCell;

            switch (e.key) {
                case 'ArrowUp':
                    e.preventDefault();
                    if (e.shiftKey && this.anchorCell) {
                        // Shift+Arrow: 範囲選択を拡張
                        const newRow = Math.max(1, row - 1);
                        this.selectRange(this.anchorCell.col, this.anchorCell.row, col, newRow);
                    } else if (row > 1) {
                        this.selectCell(col, row - 1);
                    }
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    if (e.shiftKey && this.anchorCell) {
                        const newRow = Math.min(this.maxRowLimit, row + 1);
                        this.selectRange(this.anchorCell.col, this.anchorCell.row, col, newRow);
                    } else if (row < this.maxRowLimit) {
                        this.selectCell(col, row + 1);
                    }
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    if (e.shiftKey && this.anchorCell) {
                        const newCol = Math.max(1, col - 1);
                        this.selectRange(this.anchorCell.col, this.anchorCell.row, newCol, row);
                    } else if (col > 1) {
                        this.selectCell(col - 1, row);
                    }
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    if (e.shiftKey && this.anchorCell) {
                        const newCol = Math.min(this.maxColLimit, col + 1);
                        this.selectRange(this.anchorCell.col, this.anchorCell.row, newCol, row);
                    } else if (col < this.maxColLimit) {
                        this.selectCell(col + 1, row);
                    }
                    break;
                case 'Enter':
                    e.preventDefault();
                    this.startEditing(col, row);
                    break;
                case 'F2':
                    e.preventDefault();
                    this.startEditing(col, row);
                    break;
                case 'Delete':
                case 'Backspace':
                    e.preventDefault();
                    // 仮身が選択されている場合は仮身を削除
                    if (this.selectedVirtualObjectCell) {
                        const vobjCol = this.selectedVirtualObjectCell.col;
                        const vobjRow = this.selectedVirtualObjectCell.row;
                        this.deselectVirtualObject();
                        this.clearCell(vobjCol, vobjRow);
                    // 画像が選択されている場合は画像を削除
                    } else if (this.selectedImageCell) {
                        const imgCol = this.selectedImageCell.col;
                        const imgRow = this.selectedImageCell.row;
                        this.deselectImage();
                        this.clearCell(imgCol, imgRow);
                    } else {
                        this.clearCell(col, row);
                    }
                    break;
                case 'c':
                    if (e.ctrlKey) {
                        e.preventDefault();
                        this.copyCell();
                    }
                    break;
                case 'v':
                    if (e.ctrlKey) {
                        e.preventDefault();
                        this.pasteCell();
                    }
                    break;
                case 'x':
                    if (e.ctrlKey) {
                        e.preventDefault();
                        this.cutCell();
                    }
                    break;
                case 's':
                    if (e.ctrlKey) {
                        e.preventDefault();
                        this.saveDocument();
                    }
                    break;
                case 'd':
                    if (e.ctrlKey) {
                        e.preventDefault();
                        this.fillDown();
                    }
                    break;
                case 'r':
                    if (e.ctrlKey) {
                        e.preventDefault();
                        this.fillRight();
                    }
                    break;
                case 'e':
                    if (e.ctrlKey) {
                        e.preventDefault();
                        this.requestCloseWindow();
                    }
                    break;
                case 'f':
                    if (e.ctrlKey) {
                        e.preventDefault();
                        this.openFindReplaceWindow();
                    }
                    break;
                case 'l':
                    if (e.ctrlKey) {
                        e.preventDefault();
                        this.toggleFullscreen();
                    }
                    break;
                default:
                    // 文字入力で編集開始（IME入力中はスキップ）
                    if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey && !e.isComposing) {
                        // 編集モードでない場合のみ開始（2重入力防止）
                        if (!this.isEditing) {
                            e.preventDefault(); // デフォルトのキー入力処理をキャンセル（2重入力防止）
                            this.startEditing(col, row, e.key);
                        }
                    }
            }
        });

        // documentレベルでIME入力開始を検出（日本語入力対応）
        document.addEventListener('compositionstart', (e) => {
            logger.debug('[CalcEditor] compositionstart検出', e);

            // 編集モードでない場合、かつ選択中のセルがある場合
            if (!this.isEditing && this.selectedCell) {
                const { col, row } = this.selectedCell;
                logger.debug(`[CalcEditor] IME入力開始 - セル${this.colToLetter(col)}${row}の編集モードに入る`);

                // 編集モードに入る（initialValueは空）
                this.startEditing(col, row, '');

                // 編集用inputにフォーカスを当てる
                setTimeout(() => {
                    if (this.editingInput) {
                        this.editingInput.focus();
                        logger.debug('[CalcEditor] 編集用inputにフォーカスを設定');
                    }
                }, 0);
            }
        });
    }

    /**
     * IME有効化用の常時フォーカスtextareaを設定
     */
    setupImeInput() {
        const imeInput = document.getElementById('ime-input');
        if (!imeInput) {
            logger.warn('[CalcEditor] ime-input要素が見つかりません');
            return;
        }

        // 初期フォーカス（preventScroll: true でスクロール位置がリセットされるのを防ぐ）
        imeInput.focus({ preventScroll: true });
        logger.debug('[CalcEditor] ime-inputに初期フォーカスを設定');

        // blurイベントで常にフォーカスを戻す（IMEを常に有効にするため）
        imeInput.addEventListener('blur', () => {
            // 編集モード中、親ウィンドウでダイアログ表示中、またはウィンドウが非アクティブの場合はime-inputにフォーカスを戻さない
            if (!this.isEditing && !this.dialogVisible && this.isWindowActive) {
                setTimeout(() => {
                    imeInput.focus({ preventScroll: true });
                    logger.debug('[CalcEditor] blur後にime-inputにフォーカスを再設定');
                }, 0);
            }
        });

        logger.debug('[CalcEditor] IME input設定完了');
    }

    /**
     * フィルハンドル初期化
     */
    setupFillHandle() {
        // フィルハンドル要素を作成
        this.fillHandle = document.createElement('div');
        this.fillHandle.className = 'fill-handle';
        this.fillHandle.style.display = 'none';
        document.querySelector('.spreadsheet-container').appendChild(this.fillHandle);

        // フィルハンドルのマウスダウン
        this.fillHandle.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            this.isDraggingFill = true;

            // フィルの開始位置を記録
            if (this.selectionRange) {
                this.fillStartCell = {
                    startCol: this.selectionRange.startCol,
                    startRow: this.selectionRange.startRow,
                    endCol: this.selectionRange.endCol,
                    endRow: this.selectionRange.endRow
                };
            } else if (this.selectedCell) {
                this.fillStartCell = {
                    startCol: this.selectedCell.col,
                    startRow: this.selectedCell.row,
                    endCol: this.selectedCell.col,
                    endRow: this.selectedCell.row
                };
            }
        });

        // グリッド上でのマウス移動（フィルドラッグ中）
        const gridBody = document.getElementById('grid-body');
        gridBody.addEventListener('mousemove', (e) => {
            if (this.isDraggingFill && this.fillStartCell) {
                const cell = e.target.closest('.cell');
                if (cell) {
                    const col = parseInt(cell.dataset.col);
                    const row = parseInt(cell.dataset.row);

                    // ドラッグ方向を判定（開始範囲から外れた方向のみ）
                    let newStartCol = this.fillStartCell.startCol;
                    let newStartRow = this.fillStartCell.startRow;
                    let newEndCol = this.fillStartCell.endCol;
                    let newEndRow = this.fillStartCell.endRow;

                    if (col > newEndCol) {
                        newEndCol = col;
                    } else if (col < newStartCol) {
                        newStartCol = col;
                    }

                    if (row > newEndRow) {
                        newEndRow = row;
                    } else if (row < newStartRow) {
                        newStartRow = row;
                    }

                    // 選択範囲を更新（フィル用）
                    this.clearSelection();
                    this.selectionRange = {
                        startCol: newStartCol,
                        startRow: newStartRow,
                        endCol: newEndCol,
                        endRow: newEndRow
                    };
                    this.selectedCell = { col: newEndCol, row: newEndRow };
                    this.renderSelection();
                }
            }
        });

        // マウスアップ（フィル実行）
        document.addEventListener('mouseup', (e) => {
            if (this.isDraggingFill && this.fillStartCell && this.selectionRange) {
                // フィルを実行
                this.executeFill();
                this.isDraggingFill = false;
                this.fillStartCell = null;
            }
        });
    }

    /**
     * フィル実行
     */
    executeFill() {
        if (!this.fillStartCell || !this.selectionRange) return;

        const src = this.fillStartCell;
        const dest = this.selectionRange;

        // ソースデータを取得
        const sourceData = [];
        for (let row = src.startRow; row <= src.endRow; row++) {
            const rowData = [];
            for (let col = src.startCol; col <= src.endCol; col++) {
                const key = `${col},${row}`;
                const cellData = this.cells.get(key);
                rowData.push({
                    value: cellData ? (cellData.formula || cellData.value || '') : '',
                    hasFormula: cellData ? !!cellData.formula : false,
                    style: cellData ? { ...cellData.style } : {}
                });
            }
            sourceData.push(rowData);
        }

        const srcWidth = src.endCol - src.startCol + 1;
        const srcHeight = src.endRow - src.startRow + 1;

        // 各方向にフィル
        for (let row = dest.startRow; row <= dest.endRow; row++) {
            for (let col = dest.startCol; col <= dest.endCol; col++) {
                // ソース範囲内はスキップ
                if (col >= src.startCol && col <= src.endCol &&
                    row >= src.startRow && row <= src.endRow) {
                    continue;
                }

                // ソースセルを特定（パターンを繰り返す）
                const srcColIdx = (col - src.startCol) % srcWidth;
                const srcRowIdx = (row - src.startRow) % srcHeight;
                const adjustedSrcColIdx = srcColIdx >= 0 ? srcColIdx : srcWidth + srcColIdx;
                const adjustedSrcRowIdx = srcRowIdx >= 0 ? srcRowIdx : srcHeight + srcRowIdx;

                // ソース範囲内のどのセルに対応するか
                let sourceCol = (col - dest.startCol) % srcWidth;
                let sourceRow = (row - dest.startRow) % srcHeight;
                if (sourceCol < 0) sourceCol += srcWidth;
                if (sourceRow < 0) sourceRow += srcHeight;

                const srcCell = sourceData[sourceRow] ? sourceData[sourceRow][sourceCol] : null;
                if (!srcCell) continue;

                // オフセット計算
                const colOffset = col - (src.startCol + sourceCol);
                const rowOffset = row - (src.startRow + sourceRow);

                let value = srcCell.value;
                if (srcCell.hasFormula) {
                    value = this.adjustFormulaReferences(srcCell.value, colOffset, rowOffset);
                }

                this.setCellValue(col, row, value);
                if (srcCell.style && Object.keys(srcCell.style).length > 0) {
                    this.setCellStyle(col, row, srcCell.style);
                }
                this.renderCell(col, row);
            }
        }

        logger.debug(`[CalcEditor] フィル実行: ${this.colToLetter(src.startCol)}${src.startRow}:${this.colToLetter(src.endCol)}${src.endRow} -> ${this.colToLetter(dest.startCol)}${dest.startRow}:${this.colToLetter(dest.endCol)}${dest.endRow}`);
    }

    /**
     * 列番号をアルファベットに変換
     */
    colToLetter(col) {
        let letter = '';
        while (col > 0) {
            col--;
            letter = String.fromCharCode(65 + (col % 26)) + letter;
            col = Math.floor(col / 26);
        }
        return letter;
    }

    /**
     * アルファベットを列番号に変換
     */
    letterToCol(letter) {
        let col = 0;
        for (let i = 0; i < letter.length; i++) {
            col = col * 26 + (letter.charCodeAt(i) - 64);
        }
        return col;
    }

    /**
     * セル選択
     * @param {number} col - 列番号
     * @param {number} row - 行番号
     * @param {boolean} clearRange - 範囲選択をクリアするか（デフォルトtrue）
     */
    selectCell(col, row, clearRange = true) {
        // 下限チェック
        if (col < 1 || row < 1) {
            return;
        }

        // 上限チェック
        if (col > this.maxColLimit || row > this.maxRowLimit) {
            return;
        }

        // グリッド拡張が必要な場合は拡張
        if (col > this.currentMaxCol || row > this.currentMaxRow) {
            this.expandGridTo(row, col);
        }

        // 結合セルの場合は起点セルを選択
        const mergeOrigin = this.getMergeOrigin(col, row);
        if (mergeOrigin && (mergeOrigin.col !== col || mergeOrigin.row !== row)) {
            col = mergeOrigin.col;
            row = mergeOrigin.row;
        }

        // 編集中なら終了
        if (this.isEditing) {
            this.finishEditing();
        }

        // 以前の選択を解除
        this.clearSelection();

        // 仮身選択を解除（別のセルが選択された場合）
        if (this.selectedVirtualObjectCell) {
            const vobjCell = this.selectedVirtualObjectCell;
            if (vobjCell.col !== col || vobjCell.row !== row) {
                this.deselectVirtualObject();
            }
        }

        // 画像選択を解除（別のセルが選択された場合）
        if (this.selectedImageCell) {
            const imgCell = this.selectedImageCell;
            if (imgCell.col !== col || imgCell.row !== row) {
                this.deselectImage();
            }
        }

        // 新しいセルを選択
        this.selectedCell = { col, row };
        this.anchorCell = { col, row }; // Shift選択の基点を更新

        if (clearRange) {
            this.selectionRange = null;
        }

        const cell = this.getCellElement(col, row);
        if (cell) {
            cell.classList.add('selected');
            // カスタムスクロール（stickyヘッダーを考慮）
            this.scrollCellIntoView(cell);
            // スクロール状態を親ウィンドウに通知（スクロールバー連動）
            this.notifyScrollChange();
            // フィルハンドルの位置を更新
            this.updateFillHandlePosition(cell);
        }

        // 仮身セルの場合、contextMenuVirtualObjectを設定
        const key = `${col},${row}`;
        const cellData = this.cells.get(key);
        if (cellData && cellData.contentType === 'virtualObject' && cellData.virtualObject) {
            // 実身IDを抽出（共通メソッドを使用）
            const realId = window.RealObjectSystem ?
                window.RealObjectSystem.extractRealId(cellData.virtualObject.link_id) :
                cellData.virtualObject.link_id.replace(/_\d+\.xtad$/i, '');

            this.contextMenuVirtualObject = {
                element: cell,
                realId: realId,
                virtualObj: cellData.virtualObject,
                cellKey: key
            };
        } else {
            this.contextMenuVirtualObject = null;
        }

        // 操作パネルに通知
        this.notifyCellSelection(col, row);

        logger.debug(`[CalcEditor] セル選択: ${this.colToLetter(col)}${row}`);
    }

    /**
     * 範囲選択
     * @param {number} startCol - 開始列
     * @param {number} startRow - 開始行
     * @param {number} endCol - 終了列
     * @param {number} endRow - 終了行
     */
    selectRange(startCol, startRow, endCol, endRow) {
        // 範囲を正規化（小さい値を開始に）
        const minCol = Math.min(startCol, endCol);
        const maxCol = Math.max(startCol, endCol);
        const minRow = Math.min(startRow, endRow);
        const maxRow = Math.max(startRow, endRow);

        // 下限チェック
        if (minCol < 1 || minRow < 1) {
            return;
        }

        // 上限チェック（上限を超えている場合は上限に制限）
        const clampedMaxCol = Math.min(maxCol, this.maxColLimit);
        const clampedMaxRow = Math.min(maxRow, this.maxRowLimit);

        // グリッド拡張が必要な場合は拡張
        if (clampedMaxCol > this.currentMaxCol || clampedMaxRow > this.currentMaxRow) {
            this.expandGridTo(clampedMaxRow, clampedMaxCol);
        }

        // 以前の選択を解除
        this.clearSelection();

        // 範囲を設定
        this.selectionRange = {
            startCol: minCol,
            startRow: minRow,
            endCol: maxCol,
            endRow: maxRow
        };

        // アクティブセルを終点に設定
        this.selectedCell = { col: endCol, row: endRow };

        // 範囲内のセルをハイライト
        this.renderSelection();

        // 操作パネルに通知
        this.notifyCellSelection(endCol, endRow);

        logger.debug(`[CalcEditor] 範囲選択: ${this.colToLetter(minCol)}${minRow}:${this.colToLetter(maxCol)}${maxRow}`);
    }

    /**
     * 選択をクリア
     */
    clearSelection() {
        // selectedクラスを持つセルをクリア
        const selectedCells = document.querySelectorAll('.cell.selected, .cell.in-range');
        selectedCells.forEach(cell => {
            cell.classList.remove('selected', 'in-range');
        });

        // 列・行ヘッダーの選択もクリア
        const selectedHeaders = document.querySelectorAll('.column-header.selected, .row-header.selected');
        selectedHeaders.forEach(header => {
            header.classList.remove('selected');
        });
    }

    /**
     * 選択範囲を描画
     */
    renderSelection() {
        // フィルハンドルの位置を更新する対象セル
        let targetCell = null;

        if (!this.selectionRange) {
            // 単一セル選択
            if (this.selectedCell) {
                const cell = this.getCellElement(this.selectedCell.col, this.selectedCell.row);
                if (cell) {
                    cell.classList.add('selected');
                    targetCell = cell;
                }
            }
        } else {
            const { startCol, startRow, endCol, endRow } = this.selectionRange;

            for (let row = startRow; row <= endRow; row++) {
                for (let col = startCol; col <= endCol; col++) {
                    const cell = this.getCellElement(col, row);
                    if (cell) {
                        if (col === this.selectedCell.col && row === this.selectedCell.row) {
                            cell.classList.add('selected');
                        } else {
                            cell.classList.add('in-range');
                        }
                    }
                }
            }

            // 範囲選択の場合、右下のセルにフィルハンドルを配置
            targetCell = this.getCellElement(endCol, endRow);
        }

        // フィルハンドルの位置を更新
        this.updateFillHandlePosition(targetCell);
    }

    /**
     * フィルハンドルの位置を更新
     */
    updateFillHandlePosition(targetCell) {
        if (!this.fillHandle) return;

        if (targetCell && !this.isEditing) {
            const rect = targetCell.getBoundingClientRect();
            const container = document.querySelector('.spreadsheet-container');
            const containerRect = container.getBoundingClientRect();

            // セルの右下角に配置（セルの外側に少しはみ出す）
            this.fillHandle.style.left = `${rect.right - containerRect.left - 4}px`;
            this.fillHandle.style.top = `${rect.bottom - containerRect.top - 4}px`;
            this.fillHandle.style.display = 'block';
        } else {
            this.fillHandle.style.display = 'none';
        }
    }

    /**
     * 列選択
     */
    selectColumn(col) {
        logger.debug(`[CalcEditor] 列選択: ${this.colToLetter(col)}`);

        // 編集中なら終了
        if (this.isEditing) {
            this.finishEditing();
        }

        // 以前の選択を解除
        this.clearSelection();

        // 列全体を範囲選択（現在のグリッド範囲内）
        this.selectionRange = {
            startCol: col,
            startRow: 1,
            endCol: col,
            endRow: this.currentMaxRow
        };
        this.selectedCell = { col, row: 1 };
        this.anchorCell = { col, row: 1 };

        // 範囲を描画
        this.renderSelection();

        // 列ヘッダーをハイライト
        const colHeader = document.querySelector(`.column-header[data-col="${col}"]`);
        if (colHeader) {
            colHeader.classList.add('selected');
        }

        // 操作パネルに通知
        this.notifyCellSelection(col, 1);
    }

    /**
     * 行選択
     */
    selectRow(row) {
        logger.debug(`[CalcEditor] 行選択: ${row}`);

        // 編集中なら終了
        if (this.isEditing) {
            this.finishEditing();
        }

        // 以前の選択を解除
        this.clearSelection();

        // 行全体を範囲選択（現在のグリッド範囲内）
        this.selectionRange = {
            startCol: 1,
            startRow: row,
            endCol: this.currentMaxCol,
            endRow: row
        };
        this.selectedCell = { col: 1, row };
        this.anchorCell = { col: 1, row };

        // 範囲を描画
        this.renderSelection();

        // 行ヘッダーをハイライト
        const rowHeader = document.querySelector(`.row-header[data-row="${row}"]`);
        if (rowHeader) {
            rowHeader.classList.add('selected');
        }

        // 操作パネルに通知
        this.notifyCellSelection(1, row);
    }

    /**
     * セル要素取得
     */
    getCellElement(col, row) {
        return document.querySelector(`.cell[data-col="${col}"][data-row="${row}"]`);
    }

    /**
     * セルが表示領域内に見えるようにスクロール
     * ブラウザのscrollIntoViewはstickyヘッダーを考慮しないため、カスタム実装
     * @param {HTMLElement} cell - セル要素
     */
    scrollCellIntoView(cell) {
        if (!cell) return;

        const pluginContent = document.querySelector('.plugin-content');
        if (!pluginContent) return;

        const headerHeight = 24; // .grid-headerの高さ
        const cellRect = cell.getBoundingClientRect();
        const containerRect = pluginContent.getBoundingClientRect();

        // 垂直方向：セルがstickyヘッダーの下に隠れていないか確認
        const visibleTop = containerRect.top + headerHeight;
        const visibleBottom = containerRect.bottom;

        if (cellRect.top < visibleTop) {
            // セルが上に隠れている - 上にスクロール
            const scrollAmount = cellRect.top - visibleTop;
            pluginContent.scrollTop += scrollAmount;
        } else if (cellRect.bottom > visibleBottom) {
            // セルが下に隠れている - 下にスクロール
            const scrollAmount = cellRect.bottom - visibleBottom;
            pluginContent.scrollTop += scrollAmount;
        }

        // 水平方向：行ヘッダー（50px）を考慮
        const rowHeaderWidth = 50;
        const visibleLeft = containerRect.left + rowHeaderWidth;
        const visibleRight = containerRect.right;

        if (cellRect.left < visibleLeft) {
            // セルが左に隠れている - 左にスクロール
            const scrollAmount = cellRect.left - visibleLeft;
            pluginContent.scrollLeft += scrollAmount;
        } else if (cellRect.right > visibleRight) {
            // セルが右に隠れている - 右にスクロール
            const scrollAmount = cellRect.right - visibleRight;
            pluginContent.scrollLeft += scrollAmount;
        }
    }

    /**
     * セル値取得（数式評価用）
     * 数式セルの場合は計算結果（displayValue）を返す
     */
    getCellValue(col, row) {
        const key = `${col},${row}`;
        const cellData = this.cells.get(key);
        if (!cellData) return '';

        // 数式セルの場合は計算結果を返す
        if (cellData.formula) {
            return cellData.displayValue || '';
        }

        // 通常のセルは値を返す
        return cellData.value || '';
    }

    /**
     * セル値設定
     */
    setCellValue(col, row, value) {
        const key = `${col},${row}`;
        let cellData = this.cells.get(key) || {
            value: '',
            formula: '',
            displayValue: '',
            style: {},
            virtualObject: null,
            contentType: 'text'
        };

        // 数式かどうかを判定
        if (typeof value === 'string' && value.startsWith('=')) {
            cellData.formula = value;
            cellData.value = ''; // 数式セルは値を空にする
            cellData.displayValue = this.evaluateFormula(value, col, row, new Set([key]));
            cellData.contentType = 'formula';
            cellData.virtualObject = null; // 数式セルは仮身を持たない
        } else {
            cellData.value = value;
            cellData.formula = '';
            cellData.displayValue = value;
            cellData.contentType = 'text';
            cellData.virtualObject = null; // テキストセルは仮身を持たない
        }

        this.cells.set(key, cellData);
        this.isModified = true;

        logger.info(`[CalcEditor] セル値設定: ${this.colToLetter(col)}${row} = ${value}`);

        // このセルに依存する他のセルを再計算
        this.recalculateDependentCells(col, row);
    }

    /**
     * セルスタイル設定
     */
    setCellStyle(col, row, style) {
        const key = `${col},${row}`;
        let cellData = this.cells.get(key) || {
            value: '',
            formula: '',
            displayValue: '',
            style: {},
            virtualObject: null,
            contentType: 'text'
        };

        // 枠線は特別処理（各辺を個別にマージ）
        if (style.border) {
            if (!cellData.style.border) {
                cellData.style.border = {};
            }
            // 各辺を個別にマージ
            Object.assign(cellData.style.border, style.border);
        }

        // 枠線以外のスタイルをマージ
        const styleWithoutBorder = { ...style };
        delete styleWithoutBorder.border;
        cellData.style = { ...cellData.style, ...styleWithoutBorder };

        this.cells.set(key, cellData);
        this.isModified = true;

        logger.info(`[CalcEditor] セルスタイル設定: ${this.colToLetter(col)}${row}`, style);
        logger.info(`[CalcEditor] 適用後のスタイル:`, cellData.style);
    }

    /**
     * 範囲選択に対してスタイルを適用
     */
    applyStyleToRange(range, style) {
        const { startCol, startRow, endCol, endRow } = range;

        // 枠線の場合は特別処理
        if (style.border) {
            this.applyBorderToRange(range, style.border);
        }

        // 枠線以外のスタイル（色、フォントなど）を範囲内の全セルに適用
        const styleWithoutBorder = { ...style };
        delete styleWithoutBorder.border;

        if (Object.keys(styleWithoutBorder).length > 0) {
            for (let row = startRow; row <= endRow; row++) {
                for (let col = startCol; col <= endCol; col++) {
                    this.setCellStyle(col, row, styleWithoutBorder);
                    this.renderCell(col, row);
                }
            }
        }
    }

    /**
     * 範囲選択に対して枠線を適用
     */
    applyBorderToRange(range, border) {
        const { startCol, startRow, endCol, endRow } = range;
        const borderType = border.type;

        logger.info(`[CalcEditor] 範囲枠線適用: type=${borderType}, range=${this.colToLetter(startCol)}${startRow}:${this.colToLetter(endCol)}${endRow}`);

        // 枠線の各辺のスタイルを作成
        const borderDef = {
            width: border.width || 1,
            style: border.style || 'solid',
            color: border.color || '#000000'
        };

        switch (borderType) {
            case 'all':
                // 格子: 範囲内の全セルに全方向の枠線
                for (let row = startRow; row <= endRow; row++) {
                    for (let col = startCol; col <= endCol; col++) {
                        this.setCellStyle(col, row, {
                            border: {
                                top: borderDef,
                                bottom: borderDef,
                                left: borderDef,
                                right: borderDef
                            }
                        });
                        this.renderCell(col, row);
                    }
                }
                break;

            case 'outline':
                // 外枠: 範囲の外周のみに枠線
                for (let row = startRow; row <= endRow; row++) {
                    for (let col = startCol; col <= endCol; col++) {
                        const isTop = (row === startRow);
                        const isBottom = (row === endRow);
                        const isLeft = (col === startCol);
                        const isRight = (col === endCol);

                        if (isTop || isBottom || isLeft || isRight) {
                            // 各セルの位置に応じて必要な辺の枠線を設定
                            const cellBorder = {};
                            if (isTop) cellBorder.top = borderDef;
                            if (isBottom) cellBorder.bottom = borderDef;
                            if (isLeft) cellBorder.left = borderDef;
                            if (isRight) cellBorder.right = borderDef;

                            this.setCellStyle(col, row, { border: cellBorder });
                            this.renderCell(col, row);
                        }
                    }
                }
                break;

            case 'top':
                // 上枠線: 上端の行のセルに上枠線
                for (let col = startCol; col <= endCol; col++) {
                    this.setCellStyle(col, startRow, { border: { top: borderDef } });
                    this.renderCell(col, startRow);
                }
                break;

            case 'bottom':
                // 下枠線: 下端の行のセルに下枠線
                for (let col = startCol; col <= endCol; col++) {
                    this.setCellStyle(col, endRow, { border: { bottom: borderDef } });
                    this.renderCell(col, endRow);
                }
                break;

            case 'left':
                // 左枠線: 左端の列のセルに左枠線
                for (let row = startRow; row <= endRow; row++) {
                    this.setCellStyle(startCol, row, { border: { left: borderDef } });
                    this.renderCell(startCol, row);
                }
                break;

            case 'right':
                // 右枠線: 右端の列のセルに右枠線
                for (let row = startRow; row <= endRow; row++) {
                    this.setCellStyle(endCol, row, { border: { right: borderDef } });
                    this.renderCell(endCol, row);
                }
                break;

            case 'none':
                // 枠線なし: 範囲内の全セルの枠線を削除
                for (let row = startRow; row <= endRow; row++) {
                    for (let col = startCol; col <= endCol; col++) {
                        const key = `${col},${row}`;
                        let cellData = this.cells.get(key);
                        if (cellData && cellData.style) {
                            delete cellData.style.border;
                            this.cells.set(key, cellData);
                        }
                        this.renderCell(col, row);
                    }
                }
                break;
        }
    }

    /**
     * セル表示更新
     */
    renderCell(col, row) {
        const cell = this.getCellElement(col, row);
        if (!cell) return;

        const key = `${col},${row}`;
        const cellData = this.cells.get(key);

        if (cellData) {
            // contentTypeに応じて表示を切り替え
            if (cellData.contentType === 'virtualObject' && cellData.virtualObject) {
                // 仮身の表示
                cell.textContent = ''; // まずクリア

                if (this.virtualObjectRenderer) {
                    // VirtualObjectRendererで仮身要素を作成
                    const options = {
                        iconData: this.iconData || {},
                        loadIconCallback: (realId) => this.iconManager ? this.iconManager.loadIcon(realId) : Promise.resolve(null)
                    };

                    // 開いた仮身かどうかを判定
                    const isOpenedVobj = this.isOpenedVirtualObjectInCell(cellData.virtualObject);
                    const cellKey = `${col},${row}`;
                    let vobjElement;

                    if (isOpenedVobj) {
                        // 開いた仮身: createBlockElementを使用
                        // vobjbottom/vobjtopを設定（createBlockElementが必要とする）
                        // opened: true を明示的に設定（vobjtop=0がfalsyと判定されるのを回避）
                        const virtualObjectWithPos = {
                            ...cellData.virtualObject,
                            opened: true,
                            vobjtop: 0,
                            vobjbottom: cellData.virtualObject.heightPx || 100,
                            vobjleft: 0,
                            vobjright: cellData.virtualObject.width || 150
                        };
                        vobjElement = this.virtualObjectRenderer.createBlockElement(virtualObjectWithPos, options);
                        // position: absoluteを解除（セル内表示用）
                        vobjElement.style.position = 'relative';
                        vobjElement.style.left = '0';
                        vobjElement.style.top = '0';
                    } else {
                        // 閉じた仮身: createInlineElementを使用
                        vobjElement = this.virtualObjectRenderer.createInlineElement(cellData.virtualObject, options);
                    }

                    // セル内の仮身専用のクラスを追加
                    vobjElement.classList.add('virtual-object-in-cell');

                    // 仮身のサイズが設定されている場合は適用
                    if (cellData.virtualObject.width) {
                        vobjElement.style.width = `${cellData.virtualObject.width}px`;
                    }
                    if (cellData.virtualObject.heightPx) {
                        vobjElement.style.height = `${cellData.virtualObject.heightPx}px`;
                    }

                    // ドラッグ可能に設定
                    vobjElement.setAttribute('draggable', 'true');

                    // mousedownイベントハンドラ - セル選択を防ぐ、ダブルクリックドラッグを検出、仮身選択
                    vobjElement.addEventListener('mousedown', (e) => {
                        e.stopPropagation(); // セル選択イベントに伝播させない

                        if (e.button !== 0) return; // 左クリックのみ

                        // リサイズ中は何もしない
                        if (this.isResizingVirtualObject) {
                            return;
                        }

                        const now = Date.now();
                        const timeSinceLastClick = now - this.dblClickDragState.lastClickTime;
                        const lastCell = this.dblClickDragState.dblClickedCell;
                        const isSameElement = lastCell && lastCell.col === col && lastCell.row === row;

                        logger.debug(`[CalcEditor] 仮身mousedown:`, { col, row, timeSinceLastClick, isSameElement });

                        // ダブルクリック判定（500ms以内 && 同じ要素）
                        if (timeSinceLastClick < 500 && isSameElement) {
                            // PluginBase共通メソッドでダブルクリック候補を設定
                            this.setDoubleClickDragCandidate(vobjElement, e);
                            this.dblClickDragState.dblClickedCell = { col, row };
                            logger.debug('[CalcEditor] ダブルクリック候補設定');
                        } else {
                            // 通常のクリック：PluginBase共通メソッドでタイマーをリセット
                            this.resetDoubleClickTimer();
                            this.dblClickDragState.dblClickedCell = { col, row };

                            // 仮身を選択状態にする
                            this.selectVirtualObject(col, row);
                        }
                    });

                    // dragstartイベントハンドラ
                    vobjElement.addEventListener('dragstart', (e) => {
                        // ダブルクリックドラッグ候補の場合は、通常のドラッグをキャンセル
                        if (this.dblClickDragState.isDblClickDragCandidate) {
                            logger.debug('[CalcEditor] ダブルクリックドラッグ候補のため、通常のdragstartをキャンセル');
                            e.preventDefault();
                            this.dblClickDragState.isDblClickDrag = true;
                            return;
                        }

                        e.stopPropagation(); // セル選択イベントとの競合を防ぐ

                        // ドラッグ中のセル選択を解除
                        this.isSelecting = false;

                        // PluginBase共通メソッドでドラッグ状態を初期化
                        this.initializeVirtualObjectDragStart(e);

                        // ドラッグ元のセル位置を記録
                        this.dragSourceCell = { col, row };

                        logger.info('[CalcEditor] dragstart: ドラッグ開始', {
                            dragSourceCell: this.dragSourceCell,
                            dragMode: this.virtualObjectDragState.dragMode,
                            isRightButtonPressed: this.virtualObjectDragState.isRightButtonPressed
                        });

                        // PluginBase共通メソッドでdragDataを設定
                        const virtualObj = cellData.virtualObject;
                        this.setVirtualObjectDragData(e, [virtualObj], 'basic-calc-editor');

                        logger.info(`[CalcEditor] 仮身ドラッグ開始: ${cellData.virtualObject.link_id}, モード: ${this.virtualObjectDragState.dragMode}`);
                    });

                    // dragendイベントハンドラ
                    vobjElement.addEventListener('dragend', (e) => {
                        logger.debug('[CalcEditor] 仮身ドラッグ終了, dropEffect:', e.dataTransfer.dropEffect, 'dropSuccess:', this.virtualObjectDropSuccess);

                        // dropイベントの処理を待つために少し遅延させる
                        setTimeout(() => {
                            // dropイベントで処理済みの場合はスキップ
                            if (this.virtualObjectDropSuccess) {
                                logger.debug('[CalcEditor] ドロップ成功、既に処理済み');
                                this.virtualObjectDropSuccess = false;
                            } else {
                                // 他のウィンドウへのドロップまたはキャンセルの場合
                                logger.debug('[CalcEditor] ドロップキャンセルまたは他ウィンドウへのドロップ');
                            }

                            // PluginBase共通メソッドでドラッグ状態をクリーンアップ
                            this.cleanupVirtualObjectDragState();

                            // ダブルクリックドラッグ状態もクリーンアップ（意図しない複製を防止）
                            this.cleanupDblClickDragState();
                            this.dblClickDragState.lastClickedShape = null;

                            // プラグイン固有の状態をクリア
                            this.dragSourceCell = null;
                        }, 50); // 50ms遅延
                    });

                    // contextmenuイベントハンドラ（右クリックメニュー）
                    vobjElement.addEventListener('contextmenu', (e) => {
                        e.preventDefault();
                        e.stopPropagation(); // gridBodyのcontextmenuを抑止

                        // 仮身を選択状態にする
                        this.selectVirtualObject(col, row);

                        // 実身IDを抽出（共通メソッドを使用）
                        const realId = window.RealObjectSystem ?
                            window.RealObjectSystem.extractRealId(cellData.virtualObject.link_id) :
                            cellData.virtualObject.link_id.replace(/_\d+\.xtad$/i, '');

                        // contextMenuVirtualObjectを設定
                        this.contextMenuVirtualObject = {
                            element: vobjElement,
                            realId: realId,
                            virtualObj: cellData.virtualObject,
                            cellKey: `${col},${row}`
                        };

                        // コンテキストメニューを表示
                        this.showContextMenu(e.clientX, e.clientY);
                    });

                    cell.appendChild(vobjElement);

                    // 開いた仮身の場合、コンテンツを展開（まだ展開されていない場合のみ）
                    if (isOpenedVobj && !cellData.expanded && !cellData.expandError) {
                        cellData.expanded = true; // 先にフラグ設定（無限ループ防止）
                        setTimeout(() => {
                            this.expandVirtualObjectInCell(vobjElement, cellData.virtualObject, cellKey).catch(err => {
                                logger.error('[CalcEditor] 仮身展開エラー:', err);
                                cellData.expandError = true;
                            });
                        }, 0);
                    }
                } else {
                    // フォールバック: VirtualObjectRendererが利用できない場合
                    cell.textContent = `[仮身: ${cellData.virtualObject.link_name || '(名前なし)'}]`;
                }
            } else if (cellData.contentType === 'image' && cellData.imageInfo) {
                // 画像セルの表示
                cell.textContent = ''; // まずクリア

                const imageSrc = cellData.imageInfo.dataUrl || cellData.imageInfo.src;
                if (imageSrc) {
                    // コンテナdivを作成
                    const imageContainer = document.createElement('div');
                    imageContainer.className = 'image-in-cell';

                    // カスタムサイズがある場合は適用
                    if (cellData.imageInfo.displayWidth) {
                        imageContainer.style.width = `${cellData.imageInfo.displayWidth}px`;
                    }
                    if (cellData.imageInfo.displayHeight) {
                        imageContainer.style.height = `${cellData.imageInfo.displayHeight}px`;
                    }

                    const img = document.createElement('img');
                    img.src = imageSrc;
                    img.alt = cellData.imageInfo.name || '画像';
                    img.draggable = false; // セル内画像はドラッグ不可

                    // 画像がロードされたらセルサイズを調整（必要に応じて）
                    img.onload = () => {
                    };

                    img.onerror = () => {
                        imageContainer.textContent = '[画像ロードエラー]';
                    };

                    imageContainer.appendChild(img);

                    // mousedownイベントハンドラ - 画像選択
                    imageContainer.addEventListener('mousedown', (e) => {
                        e.stopPropagation(); // セル選択イベントに伝播させない

                        if (e.button !== 0) return; // 左クリックのみ

                        // リサイズ中は何もしない
                        if (this.isResizingImage) {
                            return;
                        }

                        // 画像を選択状態にする
                        this.selectImage(col, row);
                    });

                    cell.appendChild(imageContainer);
                } else {
                    // 画像パスがまだ取得できていない場合は読み込み中表示
                    cell.textContent = '[画像読み込み中...]';
                    cell.style.color = '#888';
                    cell.style.fontStyle = 'italic';
                }
            } else {
                // テキスト or 数式の表示
                cell.textContent = cellData.displayValue || cellData.value || '';
            }

            // 数式セルのスタイル
            if (cellData.formula) {
                cell.classList.add('formula');
            } else {
                cell.classList.remove('formula');
            }

            // エラーチェック
            if (cellData.displayValue && cellData.displayValue.toString().startsWith('#')) {
                cell.classList.add('error');
            } else {
                cell.classList.remove('error');
            }

            // カスタムスタイル適用
            if (cellData.style) {
                // 背景色
                if (cellData.style.backgroundColor) {
                    cell.style.backgroundColor = cellData.style.backgroundColor;
                }
                // テキスト色
                if (cellData.style.color) {
                    cell.style.color = cellData.style.color;
                }
                // フォントウェイト（太字）
                if (cellData.style.fontWeight) {
                    cell.style.fontWeight = cellData.style.fontWeight;
                }
                // フォントスタイル（イタリック）
                if (cellData.style.fontStyle) {
                    cell.style.fontStyle = cellData.style.fontStyle;
                }
                // テキスト装飾（下線）
                if (cellData.style.textDecoration) {
                    cell.style.textDecoration = cellData.style.textDecoration;
                }
                // フォントファミリー
                if (cellData.style.fontFamily) {
                    cell.style.fontFamily = cellData.style.fontFamily;
                }
                // フォントサイズ
                if (cellData.style.fontSize) {
                    cell.style.fontSize = `${cellData.style.fontSize}px`;
                }
                // テキスト配置（水平）
                if (cellData.style.textAlign) {
                    cell.style.justifyContent = cellData.style.textAlign === 'left' ? 'flex-start' :
                        cellData.style.textAlign === 'right' ? 'flex-end' : 'center';
                }
                // セル内垂直配置（上/中/下揃え）
                if (cellData.style.vAlign) {
                    cell.style.alignItems = cellData.style.vAlign === 'top' ? 'flex-start' :
                        cellData.style.vAlign === 'bottom' ? 'flex-end' : 'center';
                }
                // 縦方向配置（上付き・下付き）
                if (cellData.style.verticalAlign) {
                    cell.style.verticalAlign = cellData.style.verticalAlign;
                }
                // 網掛け（mesh）
                if (cellData.style.mesh) {
                    // 斜線パターンで網掛けを表現
                    cell.style.backgroundImage = 'repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(0,0,0,0.3) 2px, rgba(0,0,0,0.3) 4px)';
                } else {
                    cell.style.backgroundImage = '';
                }
                // 反転（invert）
                if (cellData.style.invert) {
                    // 前景色と背景色を反転
                    const currentBg = cellData.style.backgroundColor || '#ffffff';
                    const currentColor = cellData.style.color || '#000000';
                    cell.style.backgroundColor = currentColor;
                    cell.style.color = currentBg;
                }
                // ボーダー（罫線）- 各辺を個別に設定
                if (cellData.style.border) {
                    const border = cellData.style.border;

                    // 各辺を個別に処理
                    if (border.top) {
                        cell.style.borderTop = `${border.top.width}px ${border.top.style} ${border.top.color}`;
                    } else {
                        cell.style.borderTop = '';
                    }

                    if (border.bottom) {
                        cell.style.borderBottom = `${border.bottom.width}px ${border.bottom.style} ${border.bottom.color}`;
                    } else {
                        cell.style.borderBottom = '';
                    }

                    if (border.left) {
                        cell.style.borderLeft = `${border.left.width}px ${border.left.style} ${border.left.color}`;
                    } else {
                        cell.style.borderLeft = '';
                    }

                    if (border.right) {
                        cell.style.borderRight = `${border.right.width}px ${border.right.style} ${border.right.color}`;
                    } else {
                        cell.style.borderRight = '';
                    }
                } else {
                    // 枠線情報がない場合はクリア
                    cell.style.borderTop = '';
                    cell.style.borderBottom = '';
                    cell.style.borderLeft = '';
                    cell.style.borderRight = '';
                }
            }
        } else {
            cell.textContent = '';
            cell.classList.remove('formula', 'error');
            // width/heightを保持したまま、他のスタイルプロパティをクリア
            cell.style.backgroundColor = '';
            cell.style.color = '';
            cell.style.fontWeight = '';
            cell.style.fontStyle = '';
            cell.style.textDecoration = '';
            cell.style.fontFamily = '';
            cell.style.fontSize = '';
            cell.style.justifyContent = '';
            cell.style.backgroundImage = '';  // 網掛けクリア
            cell.style.borderTop = '';
            cell.style.borderBottom = '';
            cell.style.borderLeft = '';
            cell.style.borderRight = '';
            // width/height/minWidthはそのまま保持（カスタム列幅・行高を維持）
        }
    }

    /**
     * 編集開始
     */
    startEditing(col, row, initialValue = null) {
        const cell = this.getCellElement(col, row);
        if (!cell) return;

        this.isEditing = true;
        this.editingCell = { col, row };
        cell.classList.add('editing');

        // 入力フィールド作成
        const input = document.createElement('input');
        input.type = 'text';

        // 初期値設定（数式があれば数式を、なければ値を表示）
        const key = `${col},${row}`;
        const cellData = this.cells.get(key);
        if (initialValue !== null) {
            input.value = initialValue;
        } else if (cellData && cellData.formula) {
            input.value = cellData.formula;
        } else if (cellData) {
            input.value = cellData.value || '';
        }

        cell.textContent = '';
        cell.appendChild(input);
        input.focus();
        if (initialValue !== null) {
            input.setSelectionRange(input.value.length, input.value.length);
        } else {
            input.select();
        }

        // IME入力状態を管理
        let isComposing = false;

        // IME入力開始
        input.addEventListener('compositionstart', () => {
            isComposing = true;
        });

        // IME入力確定
        input.addEventListener('compositionend', () => {
            isComposing = false;
            // 確定後に入力値を通知
            this.notifyCellInput(input.value);
        });

        // 入力イベント（IME入力中は除外）
        input.addEventListener('input', () => {
            if (!isComposing) {
                // 操作パネルに入力値を通知
                this.notifyCellInput(input.value);
            }
        });

        logger.debug(`[CalcEditor] 編集開始: ${this.colToLetter(col)}${row}`);
    }

    /**
     * 編集終了
     */
    finishEditing() {
        if (!this.isEditing || !this.editingCell) return;

        // ウィンドウが非アクティブの場合は編集状態をキャンセル
        // （他ウィンドウへのフォーカス移動時に誤って空の値を保存するのを防ぐ）
        if (!this.isWindowActive) {
            logger.info('[CalcEditor] ウィンドウ非アクティブのため編集をキャンセル');
            this.cancelEditing();
            return;
        }

        const { col, row } = this.editingCell;
        const cell = this.getCellElement(col, row);
        if (!cell) return;

        const input = cell.querySelector('input');
        if (input) {
            const value = input.value;
            this.setCellValue(col, row, value);
        }

        cell.classList.remove('editing');
        this.renderCell(col, row);

        this.isEditing = false;
        this.editingCell = null;

        // IME有効化用のtextareaにフォーカスを戻す
        // preventScroll: true でスクロール位置がリセットされるのを防ぐ
        const imeInput = document.getElementById('ime-input');
        if (imeInput) {
            setTimeout(() => {
                imeInput.focus({ preventScroll: true });
                logger.debug('[CalcEditor] 編集終了後、ime-inputにフォーカスを再設定');
            }, 0);
        }

        logger.debug(`[CalcEditor] 編集終了: ${this.colToLetter(col)}${row}`);
    }

    /**
     * 編集キャンセル
     */
    cancelEditing() {
        if (!this.isEditing || !this.editingCell) return;

        const { col, row } = this.editingCell;
        const cell = this.getCellElement(col, row);
        if (cell) {
            cell.classList.remove('editing');
            this.renderCell(col, row);
        }

        this.isEditing = false;
        this.editingCell = null;

        // ウィンドウがアクティブな場合のみ、IME有効化用のtextareaにフォーカスを戻す
        // preventScroll: true でスクロール位置がリセットされるのを防ぐ
        const imeInput = document.getElementById('ime-input');
        if (imeInput && this.isWindowActive) {
            setTimeout(() => {
                imeInput.focus({ preventScroll: true });
                logger.debug('[CalcEditor] 編集キャンセル後、ime-inputにフォーカスを再設定');
            }, 0);
        }

        logger.debug(`[CalcEditor] 編集キャンセル`);
    }

    /**
     * ウィンドウが非アクティブになった時のハンドラ（PluginBaseのオーバーライド）
     * 編集中の場合はキャンセル、セル選択とスクロール位置を保存
     */
    onWindowDeactivated() {
        if (this.isEditing) {
            this.cancelEditing();
        }
        // スクロール位置を保存
        this.saveScrollPosition();
        // セル選択状態を保存
        this.savedCellSelection = {
            selectedCell: this.selectedCell ? { ...this.selectedCell } : null,
            selectionRange: this.selectionRange ? { ...this.selectionRange } : null
        };
    }

    /**
     * ウィンドウがアクティブになった時のハンドラ（PluginBaseのオーバーライド）
     * セル選択とスクロール位置を復元
     */
    onWindowActivated() {
        // スクロール位置を一時保存（focus時にリセットされる可能性があるため）
        const pluginContent = document.querySelector('.plugin-content');
        const savedScrollPos = pluginContent ? {
            x: pluginContent.scrollLeft,
            y: pluginContent.scrollTop
        } : null;

        // IME入力用textareaにフォーカス
        // preventScroll: true でスクロール位置がリセットされるのを防ぐ
        const imeInput = document.querySelector('#ime-input');
        if (imeInput) {
            imeInput.focus({ preventScroll: true });
        }

        // スクロール位置とセル選択を復元
        requestAnimationFrame(() => {
            if (pluginContent && savedScrollPos) {
                pluginContent.scrollLeft = savedScrollPos.x;
                pluginContent.scrollTop = savedScrollPos.y;
            }
            if (this.savedCellSelection) {
                if (this.savedCellSelection.selectedCell) {
                    this.selectedCell = this.savedCellSelection.selectedCell;
                }
                if (this.savedCellSelection.selectionRange) {
                    this.selectionRange = this.savedCellSelection.selectionRange;
                }
                // 選択ハイライトを再描画
                this.clearSelection();
                this.renderSelection();
            }
        });
    }

    /**
     * セルクリア
     */
    clearCell(col, row) {
        const key = `${col},${row}`;
        const cellData = this.cells.get(key);

        // 仮身セルの場合はrefCount-1
        if (cellData && cellData.contentType === 'virtualObject' && cellData.virtualObject) {
            this.requestDeleteVirtualObject(cellData.virtualObject.link_id);
        }

        // 画像セルの場合はPNGファイルを削除
        if (cellData && cellData.contentType === 'image' && cellData.imageInfo && cellData.imageInfo.href) {
            this.deleteImageFile(cellData.imageInfo.href);
        }

        this.cells.delete(key);
        this.renderCell(col, row);
        this.isModified = true;
    }

    /**
     * 数式評価（基本実装）
     * @param {string} formula - 評価する数式
     * @param {number} col - 評価元のセル列
     * @param {number} row - 評価元のセル行
     * @param {Set} evaluating - 現在評価中のセル（循環参照検出用）
     */
    evaluateFormula(formula, col, row, evaluating = new Set()) {
        try {
            // = を除去
            let expr = formula.substring(1).trim();

            // 範囲参照を配列に変換（例: A1:A10 -> [A1の値, A2の値, ..., A10の値]）
            expr = expr.replace(/([A-Z]+)(\d+):([A-Z]+)(\d+)/g, (match, startCol, startRow, endCol, endRow) => {
                const startColNum = this.letterToCol(startCol);
                const endColNum = this.letterToCol(endCol);
                const startRowNum = parseInt(startRow);
                const endRowNum = parseInt(endRow);

                const values = [];
                for (let r = startRowNum; r <= endRowNum; r++) {
                    for (let c = startColNum; c <= endColNum; c++) {
                        const refKey = `${c},${r}`;

                        // 循環参照チェック
                        if (evaluating.has(refKey)) {
                            return '#CIRCULAR!';
                        }

                        const value = this.getCellValueWithRecalc(c, r, evaluating);
                        // 数値のみを配列に追加（空セルや文字列は除外）
                        if (value !== '' && !isNaN(Number(value))) {
                            values.push(Number(value));
                        }
                    }
                }

                return JSON.stringify(values);
            });

            // 旧形式の参照 ［row,col］ を変換（半角・全角両対応）
            // 例: [1,2] -> row=1, col=2 のセルの値
            expr = expr.replace(/[\[［](\d+)[,，](\d+)[\]］]/g, (match, r, c) => {
                const refRow = parseInt(r);
                const refCol = parseInt(c);
                const refKey = `${refCol},${refRow}`;

                // 循環参照チェック
                if (evaluating.has(refKey)) {
                    return '#CIRCULAR!';
                }

                const value = this.getCellValueWithRecalc(refCol, refRow, evaluating);
                return isNaN(Number(value)) ? `"${value}"` : value;
            });

            // A1形式の単一セル参照を変換
            expr = expr.replace(/\b([A-Z]+)(\d+)\b/g, (match, letters, rowNum) => {
                const refCol = this.letterToCol(letters);
                const refRow = parseInt(rowNum);
                const refKey = `${refCol},${refRow}`;

                // 循環参照チェック
                if (evaluating.has(refKey)) {
                    return '#CIRCULAR!';
                }

                const value = this.getCellValueWithRecalc(refCol, refRow, evaluating);
                return isNaN(Number(value)) ? `"${value}"` : value;
            });

            // 循環参照エラーが含まれている場合
            if (expr.includes('#CIRCULAR!')) {
                return '#CIRCULAR!';
            }

            // formulajsの関数を利用可能にする
            const formulajs = window.formulajs || {};

            // 計算実行（セキュリティ注意：本番ではより安全な方法を使用）
            // formulajsの関数をローカルスコープで使えるようにする
            const SUM = formulajs.SUM || function(...args) { return args.flat().reduce((a, b) => a + b, 0); };
            const AVERAGE = formulajs.AVERAGE || function(...args) { const arr = args.flat(); return arr.reduce((a, b) => a + b, 0) / arr.length; };
            const COUNT = formulajs.COUNT || function(...args) { return args.flat().length; };
            const MAX = formulajs.MAX || Math.max;
            const MIN = formulajs.MIN || Math.min;
            const IF = formulajs.IF || function(condition, trueVal, falseVal) { return condition ? trueVal : falseVal; };
            const ROUND = formulajs.ROUND || Math.round;
            const FLOOR = formulajs.FLOOR || Math.floor;
            const CEIL = formulajs.CEILING || Math.ceil;
            const ABS = formulajs.ABS || Math.abs;
            const SQRT = formulajs.SQRT || Math.sqrt;
            const POWER = formulajs.POWER || Math.pow;
            const MOD = formulajs.MOD || function(a, b) { return a % b; };
            const PI = formulajs.PI || function() { return Math.PI; };
            const RAND = formulajs.RAND || Math.random;
            const RANDBETWEEN = formulajs.RANDBETWEEN || function(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; };

            // eslint-disable-next-line no-eval
            const result = eval(expr);
            return result;
        } catch (e) {
            logger.error(`[CalcEditor] 数式エラー: ${formula}`, e);
            return '#ERROR!';
        }
    }

    /**
     * 再計算付きセル値取得
     * 数式セルの場合、循環参照チェックをしながら再評価する
     */
    getCellValueWithRecalc(col, row, evaluating) {
        const key = `${col},${row}`;
        const cellData = this.cells.get(key);
        if (!cellData) return '';

        // 数式セルの場合は再評価
        if (cellData.formula) {
            // 評価中セットに追加
            const newEvaluating = new Set(evaluating);
            newEvaluating.add(key);

            // 再評価
            const recalcValue = this.evaluateFormula(cellData.formula, col, row, newEvaluating);
            // 再計算結果を保存
            cellData.displayValue = recalcValue;
            this.cells.set(key, cellData);

            return recalcValue;
        }

        // 通常のセルは値を返す
        return cellData.value || '';
    }

    /**
     * 依存するセルを再計算
     * 指定されたセルに依存するすべての数式セルを再計算する
     */
    recalculateDependentCells(changedCol, changedRow) {
        const changedRef = `${this.colToLetter(changedCol)}${changedRow}`;
        const changedKey = `${changedCol},${changedRow}`;

        // すべてのセルをチェックして、変更されたセルを参照している数式を再計算
        this.cells.forEach((cellData, key) => {
            if (!cellData.formula || key === changedKey) return;

            // 数式に変更されたセルへの参照が含まれているかチェック
            // A1形式と[row,col]形式の両方をチェック
            const formula = cellData.formula;
            const hasA1Ref = new RegExp(`\\b${changedRef}\\b`).test(formula);
            const hasOldRef = new RegExp(`\\[${changedRow},${changedCol}\\]`).test(formula) ||
                              new RegExp(`［${changedRow}，${changedCol}］`).test(formula);

            if (hasA1Ref || hasOldRef) {
                const [col, row] = key.split(',').map(Number);
                // 再評価
                cellData.displayValue = this.evaluateFormula(cellData.formula, col, row, new Set([key]));
                this.cells.set(key, cellData);
                // セル表示を更新
                this.renderCell(col, row);

                logger.debug(`[CalcEditor] 依存セル再計算: ${this.colToLetter(col)}${row} = ${cellData.displayValue}`);

                // このセルに依存するセルも再帰的に再計算
                this.recalculateDependentCells(col, row);
            }
        });
    }

    /**
     * 全角記号を半角に変換（BTRON互換）
     * BTRONでは "、=、+、-、*、/ などが全角で保存される
     */
    convertFullWidthToHalfWidth(value) {
        if (!value) return value;

        // 全角→半角の変換マップ（記号のみ、英数字は変換しない）
        const fullToHalf = {
            '"': '"', '"': '"', // 全角ダブルクォート
            "'": "'", "'": "'", // 全角シングルクォート
            '＝': '=',
            '＋': '+',
            '－': '-',
            '×': '*',
            '÷': '/',
            '（': '(',
            '）': ')',
            '［': '[',  // 全角角括弧
            '］': ']',
            '，': ',',  // 全角カンマ
            '＊': '*',
            '／': '/',
            '＜': '<',
            '＞': '>',
            '％': '%',
            '＾': '^',
            '＆': '&',
            '｜': '|',
            '：': ':',
            '；': ';',
            '．': '.',
            '　': ' ' // 全角スペース
        };

        let result = '';
        for (const char of value) {
            result += fullToHalf[char] || char;
        }
        return result;
    }

    /**
     * 旧形式の数式を新形式に変換
     * 例: "3=1+[1,2]" -> "=1+B1"
     * - 全角記号を半角に変換
     * - 先頭の計算結果（数字=）を除去
     * - [row,col] または ［row，col］ 形式をA1形式に変換
     */
    convertOldFormulaFormat(value) {
        if (!value) return value;

        // 全角記号を半角に変換
        value = this.convertFullWidthToHalfWidth(value);

        // 先頭の計算結果を除去（例: "3=1+2" -> "=1+2"）
        // パターン: 数字（小数点含む）の後に=が続く場合
        value = value.replace(/^-?[\d.]+(?==)/, '');

        // [row,col] 形式をA1形式に変換（半角括弧）
        value = value.replace(/\[(\d+),(\d+)\]/g, (match, r, c) => {
            const row = parseInt(r);
            const col = parseInt(c);
            return `${this.colToLetter(col)}${row}`;
        });

        // ［row，col］ 形式をA1形式に変換（全角括弧）
        value = value.replace(/［(\d+)，(\d+)］/g, (match, r, c) => {
            const row = parseInt(r);
            const col = parseInt(c);
            return `${this.colToLetter(col)}${row}`;
        });

        return value;
    }

    /**
     * 操作パネルにセル選択を通知
     * 重複通知を防ぐため、前回と同じセルの場合はスキップ
     */
    notifyCellSelection(col, row) {
        if (!this.operationPanelWindowId) return;

        // 重複チェック: 同じセルなら通知をスキップ
        const cellKey = `${col},${row}`;
        if (this.lastNotifiedCell === cellKey) {
            return;
        }
        this.lastNotifiedCell = cellKey;

        const cellData = this.cells.get(cellKey) || { value: '', formula: '', displayValue: '', style: {} };

        // 親ウィンドウ経由で操作パネルに送信（fromEditorフラグで中継）
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: 'calc-cell-selected',
                fromEditor: true,
                col,
                row,
                cellRef: `${this.colToLetter(col)}${row}`,
                value: cellData.value || '',
                formula: cellData.formula || '',
                displayValue: cellData.displayValue || '',
                style: cellData.style || {}
            }, '*');
        }
    }

    /**
     * 操作パネルに入力値を通知
     */
    notifyCellInput(value) {
        if (!this.operationPanelWindowId) return;

        // 親ウィンドウ経由で操作パネルに送信（fromEditorフラグで中継）
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: 'calc-cell-input',
                fromEditor: true,
                value
            }, '*');
        }
    }

    /**
     * 操作パネルを開く
     */
    openOperationPanel() {
        logger.debug('[CalcEditor] 操作パネルを開く');

        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: 'open-tool-panel-window',
                pluginId: 'basic-calc-editor',
                panelpos: this.panelpos || { x: 50, y: 50 },
                panelsize: { width: 500, height: 90 }, // 3行分のサイズ
                settings: {
                    // 初期設定
                }
            }, '*');
        }

        this.operationPanelVisible = true;

        // 実身管理用JSONにパネル状態を保存
        this.updateWindowConfig({ panel: true });
    }

    /**
     * 操作パネルを閉じる
     */
    closeOperationPanel() {
        if (this.operationPanelWindowId && this.messageBus) {
            this.messageBus.send('close-window', {
                windowId: this.operationPanelWindowId
            });
        }
        this.operationPanelVisible = false;
        this.operationPanelWindowId = null;

        // 実身管理用JSONにパネル状態を保存
        this.updateWindowConfig({ panel: false });
    }

    /**
     * 操作パネル表示切り替え
     */
    toggleOperationPanel() {
        if (this.operationPanelVisible) {
            this.closeOperationPanel();
        } else {
            this.openOperationPanel();
        }
    }

    /**
     * コンテキストメニュー表示（TADjs標準コンテキストメニューを使用）
     */
    showContextMenu(x, y) {
        // iframe内の座標を親ウィンドウの座標に変換してPluginBase共通メソッドを使用
        const rect = window.frameElement ? window.frameElement.getBoundingClientRect() : { left: 0, top: 0 };
        this.requestContextMenu(rect.left + x, rect.top + y);
    }

    /**
     * 内部クリップボード（数式情報を保持）
     */
    clipboard = null;

    /**
     * セルコピー（範囲対応）
     * 画像セルの場合はDataURLも含めてコピーする
     */
    async copyCell() {
        if (!this.selectedCell) return;

        // 画像セルのDataURLを事前に取得（コピー時も確実にデータを保持）
        await this.preloadImageDataForCopy();

        // 範囲選択がある場合は範囲をコピー
        if (this.selectionRange) {
            const { startCol, startRow, endCol, endRow } = this.selectionRange;
            const copiedCells = [];
            let firstVirtualObject = null;

            for (let row = startRow; row <= endRow; row++) {
                const rowData = [];
                for (let col = startCol; col <= endCol; col++) {
                    const key = `${col},${row}`;
                    const cellData = this.cells.get(key);
                    const vo = cellData && cellData.virtualObject ? JSON.parse(JSON.stringify(cellData.virtualObject)) : null;
                    if (vo && !firstVirtualObject) {
                        firstVirtualObject = vo;
                    }
                    // 画像情報もコピー
                    const imgInfo = cellData && cellData.imageInfo ? JSON.parse(JSON.stringify(cellData.imageInfo)) : null;
                    rowData.push({
                        value: cellData ? (cellData.formula || cellData.value || '') : '',
                        hasFormula: cellData ? !!cellData.formula : false,
                        style: cellData ? { ...cellData.style } : {},
                        contentType: cellData ? cellData.contentType || 'text' : 'text',
                        virtualObject: vo,
                        imageInfo: imgInfo
                    });
                }
                copiedCells.push(rowData);
            }

            this.clipboard = {
                type: 'range',
                data: copiedCells,
                sourceCol: startCol,
                sourceRow: startRow
            };

            // システムクリップボードにもテキストとしてコピー
            const textData = copiedCells.map(row =>
                row.map(cell => cell.hasFormula ? cell.value : cell.value).join('\t')
            ).join('\n');

            // グローバルクリップボードに送信（仮身優先、なければテキスト）
            if (firstVirtualObject) {
                // 仮身オブジェクト全体をコピー（virtual-object-listと同じ方式）
                this.setClipboard(firstVirtualObject);
            } else if (textData) {
                // テキストをグローバルクリップボードに設定
                this.setTextClipboard(textData);
            }

            navigator.clipboard.writeText(textData).catch(e => {});

            logger.debug(`[CalcEditor] 範囲コピー: ${this.colToLetter(startCol)}${startRow}:${this.colToLetter(endCol)}${endRow}`);
        } else {
            // 単一セルコピー
            const { col, row } = this.selectedCell;
            const key = `${col},${row}`;
            const cellData = this.cells.get(key);
            const virtualObject = cellData && cellData.virtualObject ? JSON.parse(JSON.stringify(cellData.virtualObject)) : null;
            // 画像情報もコピー
            const imageInfo = cellData && cellData.imageInfo ? JSON.parse(JSON.stringify(cellData.imageInfo)) : null;

            this.clipboard = {
                type: 'cell',
                data: {
                    value: cellData ? (cellData.formula || cellData.value || '') : '',
                    hasFormula: cellData ? !!cellData.formula : false,
                    style: cellData ? { ...cellData.style } : {},
                    contentType: cellData ? cellData.contentType || 'text' : 'text',
                    virtualObject: virtualObject,
                    imageInfo: imageInfo
                },
                sourceCol: col,
                sourceRow: row
            };

            const textValue = cellData ? (cellData.value || '') : '';

            // グローバルクリップボードに送信（仮身優先、なければテキスト）
            if (virtualObject) {
                // 仮身オブジェクト全体をコピー（virtual-object-listと同じ方式）
                this.setClipboard(virtualObject);
            } else if (textValue) {
                // テキストをグローバルクリップボードに設定
                this.setTextClipboard(textValue);
            }

            navigator.clipboard.writeText(textValue).catch(e => {});

            logger.debug(`[CalcEditor] セルコピー: ${this.colToLetter(col)}${row}`);
        }
    }

    /**
     * セル切り取り
     * 画像セルの場合はファイル削除前にDataURLを取得して保持する
     */
    async cutCell() {
        if (!this.selectedCell) return;

        // 画像セルのDataURLを事前に取得（ファイル削除前に実行）
        // ※copyCell()内でもpreloadImageDataForCopy()が呼ばれるが、二重ロードは避けられる
        await this.preloadImageDataForCut();

        // コピーを実行（imageInfo.dataUrlが設定済み）
        await this.copyCell();

        // 範囲選択がある場合は範囲をクリア
        if (this.selectionRange) {
            const { startCol, startRow, endCol, endRow } = this.selectionRange;
            for (let row = startRow; row <= endRow; row++) {
                for (let col = startCol; col <= endCol; col++) {
                    this.clearCell(col, row);
                }
            }
        } else {
            this.clearCell(this.selectedCell.col, this.selectedCell.row);
        }
    }

    /**
     * コピー/カット操作前に画像セルのDataURLを事前取得
     * ファイル削除後でも貼り付けできるようにデータをメモリに保持する
     */
    async preloadImageDataForCopy() {
        const cellsToProcess = [];

        // 対象セルをリストアップ
        if (this.selectionRange) {
            const { startCol, startRow, endCol, endRow } = this.selectionRange;
            for (let row = startRow; row <= endRow; row++) {
                for (let col = startCol; col <= endCol; col++) {
                    cellsToProcess.push({ col, row });
                }
            }
        } else if (this.selectedCell) {
            cellsToProcess.push(this.selectedCell);
        }

        // 画像セルのDataURLを取得
        for (const { col, row } of cellsToProcess) {
            const key = `${col},${row}`;
            const cellData = this.cells.get(key);

            if (cellData && cellData.contentType === 'image' && cellData.imageInfo) {
                // dataUrlがない場合はsrcからロード（PluginBase共通メソッド使用）
                if (!cellData.imageInfo.dataUrl && cellData.imageInfo.src) {
                    const dataUrl = await this.loadImageFromUrl(cellData.imageInfo.src);
                    if (dataUrl) {
                        cellData.imageInfo.dataUrl = dataUrl;
                    }
                }
            }
        }
    }

    /**
     * カット操作前に画像セルのDataURLを事前取得（preloadImageDataForCopyのエイリアス）
     */
    async preloadImageDataForCut() {
        return this.preloadImageDataForCopy();
    }

    /**
     * セル貼り付け（数式の相対参照調整対応）
     */
    async pasteCell() {
        if (!this.selectedCell) return;
        const { col: destCol, row: destRow } = this.selectedCell;

        // 内部クリップボードがある場合はそちらを使用
        if (this.clipboard) {
            if (this.clipboard.type === 'range') {
                // 範囲貼り付け
                const { data, sourceCol, sourceRow } = this.clipboard;
                const colOffset = destCol - sourceCol;
                const rowOffset = destRow - sourceRow;

                for (let r = 0; r < data.length; r++) {
                    for (let c = 0; c < data[r].length; c++) {
                        const cellInfo = data[r][c];
                        const targetCol = destCol + c;
                        const targetRow = destRow + r;

                        if (targetCol > this.defaultCols || targetRow > this.defaultRows) continue;

                        const key = `${targetCol},${targetRow}`;

                        // 仮身セルの場合は直接セルデータを設定
                        if (cellInfo.contentType === 'virtualObject' && cellInfo.virtualObject) {
                            this.cells.set(key, {
                                value: '',
                                formula: '',
                                displayValue: '',
                                style: cellInfo.style || {},
                                virtualObject: JSON.parse(JSON.stringify(cellInfo.virtualObject)), // deep copy
                                contentType: 'virtualObject'
                            });
                            // refCount+1（ペースト = 新しい参照が作成される）
                            this.requestCopyVirtualObject(cellInfo.virtualObject.link_id);
                            this.isModified = true;
                        } else if (cellInfo.contentType === 'image' && cellInfo.imageInfo) {
                            // 画像セルの場合は新しいファイル名で保存
                            await this.pasteImageCell(key, cellInfo, targetCol, targetRow);
                        } else {
                            // 通常のセル（テキスト・数式）
                            let value = cellInfo.value;
                            if (cellInfo.hasFormula) {
                                // 数式の相対参照を調整
                                value = this.adjustFormulaReferences(value, colOffset + c, rowOffset + r);
                            }

                            this.setCellValue(targetCol, targetRow, value);
                            if (cellInfo.style && Object.keys(cellInfo.style).length > 0) {
                                this.setCellStyle(targetCol, targetRow, cellInfo.style);
                            }
                        }

                        this.renderCell(targetCol, targetRow);
                    }
                }

                logger.debug(`[CalcEditor] 範囲貼り付け: ${this.colToLetter(destCol)}${destRow}`);
            } else {
                // 単一セル貼り付け
                const { data, sourceCol, sourceRow } = this.clipboard;
                const colOffset = destCol - sourceCol;
                const rowOffset = destRow - sourceRow;
                const key = `${destCol},${destRow}`;

                // 仮身セルの場合は直接セルデータを設定
                if (data.contentType === 'virtualObject' && data.virtualObject) {
                    this.cells.set(key, {
                        value: '',
                        formula: '',
                        displayValue: '',
                        style: data.style || {},
                        virtualObject: JSON.parse(JSON.stringify(data.virtualObject)), // deep copy
                        contentType: 'virtualObject'
                    });
                    // refCount+1（ペースト = 新しい参照が作成される）
                    this.requestCopyVirtualObject(data.virtualObject.link_id);
                    this.isModified = true;
                } else if (data.contentType === 'image' && data.imageInfo) {
                    // 画像セルの場合は新しいファイル名で保存
                    await this.pasteImageCell(key, data, destCol, destRow);
                } else {
                    // 通常のセル（テキスト・数式）
                    let value = data.value;
                    if (data.hasFormula) {
                        value = this.adjustFormulaReferences(value, colOffset, rowOffset);
                    }

                    this.setCellValue(destCol, destRow, value);
                    if (data.style && Object.keys(data.style).length > 0) {
                        this.setCellStyle(destCol, destRow, data.style);
                    }
                }
                this.renderCell(destCol, destRow);

                logger.debug(`[CalcEditor] セル貼り付け: ${this.colToLetter(destCol)}${destRow}`);
            }
        } else {
            // グローバルクリップボードをチェック（他ウィンドウからのコピー対応）
            const globalClipboard = await this.getGlobalClipboard();
            if (globalClipboard) {
                if (globalClipboard.type === 'text' && globalClipboard.text) {
                    // テキストをセルに設定
                    this.setCellValue(destCol, destRow, globalClipboard.text);
                    this.renderCell(destCol, destRow);
                    return;
                } else if (globalClipboard.link_id) {
                    // 仮身をセルに設定
                    const key = `${destCol},${destRow}`;
                    this.cells.set(key, {
                        value: '',
                        formula: '',
                        displayValue: '',
                        style: {},
                        virtualObject: JSON.parse(JSON.stringify(globalClipboard)),
                        contentType: 'virtualObject'
                    });
                    this.requestCopyVirtualObject(globalClipboard.link_id);
                    this.isModified = true;
                    this.renderCell(destCol, destRow);
                    return;
                } else if (globalClipboard.type === 'image' && globalClipboard.dataUrl) {
                    // 画像をセルに設定
                    await this.pasteImageFromGlobalClipboard(globalClipboard, destCol, destRow);
                    return;
                }
            }

            // システムクリップボードから貼り付け（フォーカスがある場合のみ動作）
            try {
                const text = await navigator.clipboard.readText();
                if (text) {
                    this.setCellValue(destCol, destRow, text);
                    this.renderCell(destCol, destRow);
                }
            } catch (e) {
                // NotAllowedError等は無視（グローバルクリップボードで対応済み）
            }
        }
    }

    /**
     * 画像セルを貼り付け（新しいファイル名で保存）
     * @param {string} key - セルキー
     * @param {Object} cellInfo - コピーされたセル情報
     * @param {number} targetCol - 貼り付け先列
     * @param {number} targetRow - 貼り付け先行
     */
    async pasteImageCell(key, cellInfo, targetCol, targetRow) {
        const sourceImageInfo = cellInfo.imageInfo;

        // 新しい画像番号を取得
        const imgNo = this.getNextImageNumber();

        // 新しいファイル名を生成
        let realId = this.realId || 'unknown';
        realId = realId.replace(/_\d+\.xtad$/i, '');
        const recordNo = 0;
        const extension = sourceImageInfo.href ? sourceImageInfo.href.split('.').pop().toLowerCase() : 'png';
        const newFileName = `${realId}_${recordNo}_${imgNo}.${extension}`;

        // 新しいimageInfoを作成
        const newImageInfo = JSON.parse(JSON.stringify(sourceImageInfo));
        newImageInfo.href = newFileName;

        // 画像データがある場合は新しいファイル名で保存
        const imageSrc = sourceImageInfo.dataUrl || sourceImageInfo.src;
        if (imageSrc && imageSrc.startsWith('data:')) {
            // Data URLから保存（PluginBase共通メソッド使用）
            await this.saveImageFile(imageSrc, newFileName);
            newImageInfo.src = imageSrc;
            newImageInfo.dataUrl = imageSrc;
        } else if (imageSrc) {
            // file:// URLの場合は画像を読み込んでからData URLとして保存（PluginBase共通メソッド使用）
            try {
                const dataUrl = await this.loadImageFromUrl(imageSrc);
                if (dataUrl) {
                    await this.saveImageFile(dataUrl, newFileName);
                    newImageInfo.src = dataUrl;
                    newImageInfo.dataUrl = dataUrl;
                }
            } catch (error) {
                logger.error('[CalcEditor] 画像読み込みエラー:', error);
            }
        }

        // セルに画像を設定
        this.cells.set(key, {
            value: '',
            formula: '',
            displayValue: '',
            style: cellInfo.style || {},
            imageInfo: newImageInfo,
            contentType: 'image'
        });

        this.isModified = true;
        logger.debug(`[CalcEditor] 画像セル貼り付け: ${this.colToLetter(targetCol)}${targetRow}, ${newFileName}`);
    }

    /**
     * グローバルクリップボードから画像をセルに貼り付け
     * @param {Object} clipboardData - グローバルクリップボードの画像データ
     * @param {number} col - 貼り付け先列
     * @param {number} row - 貼り付け先行
     */
    async pasteImageFromGlobalClipboard(clipboardData, col, row) {
        const key = `${col},${row}`;

        // 新しい画像番号を取得
        const imgNo = this.getNextImageNumber();

        // 新しいファイル名を生成
        let realId = this.realId || 'unknown';
        realId = realId.replace(/_\d+\.xtad$/i, '');
        const recordNo = 0;
        const extension = 'png';
        const newFileName = `${realId}_${recordNo}_${imgNo}.${extension}`;

        // 画像データを保存（PluginBase共通メソッド使用）
        await this.saveImageFile(clipboardData.dataUrl, newFileName);

        // セルに画像を設定
        const imageInfo = {
            href: newFileName,
            src: clipboardData.dataUrl,
            dataUrl: clipboardData.dataUrl,
            width: clipboardData.width || 100,
            height: clipboardData.height || 100,
            name: clipboardData.name || 'image.png'
        };

        this.cells.set(key, {
            value: '',
            formula: '',
            displayValue: '',
            style: {},
            imageInfo: imageInfo,
            contentType: 'image'
        });

        this.isModified = true;
        this.renderCell(col, row);
        logger.debug(`[CalcEditor] グローバルクリップボードから画像貼り付け: ${this.colToLetter(col)}${row}, ${newFileName}`);
    }

    // loadImageFromUrl() は基底クラス PluginBase で定義

    /**
     * 数式の相対参照を調整
     * @param {string} formula - 元の数式
     * @param {number} colOffset - 列オフセット
     * @param {number} rowOffset - 行オフセット
     * @returns {string} 調整後の数式
     */
    adjustFormulaReferences(formula, colOffset, rowOffset) {
        if (!formula.startsWith('=')) return formula;

        // A1形式の参照を調整（$は絶対参照を示す）
        // パターン: $?[A-Z]+$?[0-9]+
        return formula.replace(/(\$?)([A-Z]+)(\$?)(\d+)/g, (match, colAbs, colLetters, rowAbs, rowNum) => {
            let newCol = this.letterToCol(colLetters);
            let newRow = parseInt(rowNum);

            // 絶対参照でない場合のみオフセットを適用
            if (!colAbs) {
                newCol += colOffset;
            }
            if (!rowAbs) {
                newRow += rowOffset;
            }

            // 範囲外チェック
            if (newCol < 1 || newCol > this.defaultCols || newRow < 1 || newRow > this.defaultRows) {
                return '#REF!';
            }

            return `${colAbs}${this.colToLetter(newCol)}${rowAbs}${newRow}`;
        });
    }

    /**
     * 下方向にフィル
     */
    fillDown() {
        if (!this.selectionRange) return;

        const { startCol, startRow, endCol, endRow } = this.selectionRange;
        if (startRow === endRow) return; // 1行だけでは実行不可

        // 最初の行のデータを下の行にコピー
        for (let col = startCol; col <= endCol; col++) {
            const sourceKey = `${col},${startRow}`;
            const sourceData = this.cells.get(sourceKey);

            for (let row = startRow + 1; row <= endRow; row++) {
                const rowOffset = row - startRow;

                if (sourceData) {
                    let value = sourceData.formula || sourceData.value || '';
                    if (sourceData.formula) {
                        value = this.adjustFormulaReferences(sourceData.formula, 0, rowOffset);
                    }
                    this.setCellValue(col, row, value);
                    if (sourceData.style) {
                        this.setCellStyle(col, row, sourceData.style);
                    }
                } else {
                    this.clearCell(col, row);
                }
                this.renderCell(col, row);
            }
        }

        logger.debug(`[CalcEditor] 下方向フィル: ${this.colToLetter(startCol)}${startRow}:${this.colToLetter(endCol)}${endRow}`);
    }

    /**
     * 右方向にフィル
     */
    fillRight() {
        if (!this.selectionRange) return;

        const { startCol, startRow, endCol, endRow } = this.selectionRange;
        if (startCol === endCol) return; // 1列だけでは実行不可

        // 最初の列のデータを右の列にコピー
        for (let row = startRow; row <= endRow; row++) {
            const sourceKey = `${startCol},${row}`;
            const sourceData = this.cells.get(sourceKey);

            for (let col = startCol + 1; col <= endCol; col++) {
                const colOffset = col - startCol;

                if (sourceData) {
                    let value = sourceData.formula || sourceData.value || '';
                    if (sourceData.formula) {
                        value = this.adjustFormulaReferences(sourceData.formula, colOffset, 0);
                    }
                    this.setCellValue(col, row, value);
                    if (sourceData.style) {
                        this.setCellStyle(col, row, sourceData.style);
                    }
                } else {
                    this.clearCell(col, row);
                }
                this.renderCell(col, row);
            }
        }

        logger.debug(`[CalcEditor] 右方向フィル: ${this.colToLetter(startCol)}${startRow}:${this.colToLetter(endCol)}${endRow}`);
    }

    /**
     * 行挿入
     * 指定行に空行を挿入し、それ以降のデータを下にシフト
     */
    insertRow(row) {
        logger.debug(`[CalcEditor] 行挿入: ${row}`);

        // 最終行から指定行まで逆順にデータをシフト
        const newCells = new Map();

        this.cells.forEach((cellData, key) => {
            const [col, r] = key.split(',').map(Number);
            if (r >= row) {
                // 指定行以降は1行下にシフト
                const newKey = `${col},${r + 1}`;
                newCells.set(newKey, cellData);
            } else {
                // 指定行より上はそのまま
                newCells.set(key, cellData);
            }
        });

        this.cells = newCells;

        // 行高もシフト
        const newRowHeights = new Map();
        this.rowHeights.forEach((height, r) => {
            if (r >= row) {
                // 指定行以降は1行下にシフト
                newRowHeights.set(r + 1, height);
            } else {
                // 指定行より上はそのまま
                newRowHeights.set(r, height);
            }
        });
        this.rowHeights = newRowHeights;

        // グリッドを再構築
        this.rebuildGrid();
        this.isModified = true;

        logger.info(`[CalcEditor] 行${row}に空行を挿入しました`);
    }

    /**
     * 列挿入
     * 指定列に空列を挿入し、それ以降のデータを右にシフト
     */
    insertColumn(col) {
        logger.debug(`[CalcEditor] 列挿入: ${col}`);

        const newCells = new Map();

        this.cells.forEach((cellData, key) => {
            const [c, row] = key.split(',').map(Number);
            if (c >= col) {
                // 指定列以降は1列右にシフト
                const newKey = `${c + 1},${row}`;
                newCells.set(newKey, cellData);
            } else {
                // 指定列より左はそのまま
                newCells.set(key, cellData);
            }
        });

        this.cells = newCells;

        // 列幅もシフト
        const newColumnWidths = new Map();
        this.columnWidths.forEach((width, c) => {
            if (c >= col) {
                // 指定列以降は1列右にシフト
                newColumnWidths.set(c + 1, width);
            } else {
                // 指定列より左はそのまま
                newColumnWidths.set(c, width);
            }
        });
        this.columnWidths = newColumnWidths;

        // グリッドを再構築
        this.rebuildGrid();
        this.isModified = true;

        logger.info(`[CalcEditor] 列${this.colToLetter(col)}に空列を挿入しました`);
    }

    /**
     * 行削除
     * 指定行を削除し、それ以降のデータを上にシフト
     */
    deleteRow(row) {
        logger.debug(`[CalcEditor] 行削除: ${row}`);

        const newCells = new Map();

        this.cells.forEach((cellData, key) => {
            const [col, r] = key.split(',').map(Number);
            if (r === row) {
                // 削除対象行はスキップ
            } else if (r > row) {
                // 削除行より下は1行上にシフト
                const newKey = `${col},${r - 1}`;
                newCells.set(newKey, cellData);
            } else {
                // 削除行より上はそのまま
                newCells.set(key, cellData);
            }
        });

        this.cells = newCells;

        // 行高もシフト
        const newRowHeights = new Map();
        this.rowHeights.forEach((height, r) => {
            if (r === row) {
                // 削除対象行はスキップ
            } else if (r > row) {
                // 削除行より下は1行上にシフト
                newRowHeights.set(r - 1, height);
            } else {
                // 削除行より上はそのまま
                newRowHeights.set(r, height);
            }
        });
        this.rowHeights = newRowHeights;

        // グリッドを再構築
        this.rebuildGrid();
        this.isModified = true;

        logger.info(`[CalcEditor] 行${row}を削除しました`);
    }

    /**
     * 列削除
     * 指定列を削除し、それ以降のデータを左にシフト
     */
    deleteColumn(col) {
        logger.debug(`[CalcEditor] 列削除: ${col}`);

        const newCells = new Map();

        this.cells.forEach((cellData, key) => {
            const [c, row] = key.split(',').map(Number);
            if (c === col) {
                // 削除対象列はスキップ
            } else if (c > col) {
                // 削除列より右は1列左にシフト
                const newKey = `${c - 1},${row}`;
                newCells.set(newKey, cellData);
            } else {
                // 削除列より左はそのまま
                newCells.set(key, cellData);
            }
        });

        this.cells = newCells;

        // 列幅もシフト
        const newColumnWidths = new Map();
        this.columnWidths.forEach((width, c) => {
            if (c === col) {
                // 削除対象列はスキップ
            } else if (c > col) {
                // 削除列より右は1列左にシフト
                newColumnWidths.set(c - 1, width);
            } else {
                // 削除列より左はそのまま
                newColumnWidths.set(c, width);
            }
        });
        this.columnWidths = newColumnWidths;

        // グリッドを再構築
        this.rebuildGrid();
        this.isModified = true;

        logger.info(`[CalcEditor] 列${this.colToLetter(col)}を削除しました`);
    }

    /**
     * 全セルを再描画
     */
    renderAllCells() {
        // 全セルをクリア
        for (let row = 1; row <= this.defaultRows; row++) {
            for (let col = 1; col <= this.defaultCols; col++) {
                const cell = this.getCellElement(col, row);
                if (cell) {
                    cell.textContent = '';
                    cell.classList.remove('formula', 'error');
                    // width/heightを保持したまま、他のスタイルプロパティをクリア
                    cell.style.backgroundColor = '';
                    cell.style.color = '';
                    cell.style.fontWeight = '';
                    cell.style.fontStyle = '';
                    cell.style.textDecoration = '';
                    cell.style.fontFamily = '';
                    cell.style.fontSize = '';
                    cell.style.justifyContent = '';
                    cell.style.borderTop = '';
                    cell.style.borderBottom = '';
                    cell.style.borderLeft = '';
                    cell.style.borderRight = '';
                    // width/height/minWidthはそのまま保持（カスタム列幅・行高を維持）
                }
            }
        }

        // データのあるセルを描画
        this.cells.forEach((cellData, key) => {
            const [col, row] = key.split(',').map(Number);
            this.renderCell(col, row);
        });
    }

    /**
     * グリッドを再構築（行・列の挿入・削除後に使用）
     */
    rebuildGrid() {
        logger.debug('[CalcEditor] グリッド再構築開始');

        // 既存のグリッドをクリア
        const headerContainer = document.getElementById('grid-header');
        const bodyContainer = document.getElementById('grid-body');

        // ヘッダーとボディをクリア（コーナーは残す）
        while (headerContainer.children.length > 1) {
            headerContainer.removeChild(headerContainer.lastChild);
        }
        while (bodyContainer.firstChild) {
            bodyContainer.removeChild(bodyContainer.firstChild);
        }

        // 現在のグリッドサイズをリセット
        this.currentMaxRow = this.defaultRows;
        this.currentMaxCol = this.defaultCols;

        // グリッドを再生成
        this.initGrid();

        // 全セルを再描画（先にセル内容を描画）
        this.renderAllCells();

        // カスタム列幅を再適用（renderAllCells後に適用して、cssTextクリアの影響を受けないようにする）
        this.columnWidths.forEach((_, col) => {
            this.applyColumnWidth(col);
        });

        // カスタム行高を再適用
        this.rowHeights.forEach((_, row) => {
            this.applyRowHeight(row);
        });

        logger.debug('[CalcEditor] グリッド再構築完了');
    }

    /**
     * 仮身のアイコンを事前にキャッシュに読み込み、iconDataオブジェクトを構築
     * @param {string} xtadData - TAD XMLデータ
     */
    async preloadVirtualObjectIcons(xtadData) {
        // iconDataは PluginBase で初期化済み、ここでクリア
        this.iconData = {};

        if (!this.iconManager) {
            return;
        }

        // <link>タグから実身IDを抽出
        const linkRegex = /<link\s+([^>]*)>(.*?)<\/link>/gi;
        const realIds = [];
        let match;

        while ((match = linkRegex.exec(xtadData)) !== null) {
            const attrs = match[1];

            // 属性をパース
            const attrMap = {};
            const attrRegex = /(\w+)="([^"]*)"/g;
            let attrMatch;
            while ((attrMatch = attrRegex.exec(attrs)) !== null) {
                attrMap[attrMatch[1]] = this.unescapeXml(attrMatch[2]);
            }

            if (attrMap.id) {
                // フルIDから実身IDのみを抽出（_0.xtadなどを削除）
                const realId = attrMap.id.replace(/_\d+\.xtad$/i, '');
                realIds.push(realId);
            }
        }

        // PluginBase共通メソッドでアイコン一括読み込み
        await this.loadAndStoreIcons(realIds);
    }

    /**
     * xtadデータ読み込み
     * cell="A1"形式とcol/row形式の両方に対応
     * <calcCell>タグと文字装飾タグにも対応
     */
    async loadXtadData(xtadData) {
        logger.info('[CalcEditor] xtadデータ読み込み');

        try {
            // 仮身のアイコンを事前にキャッシュに読み込む（基本文章編集と同じ方式）
            await this.preloadVirtualObjectIcons(xtadData);

            // <calcSize>タグをパースして列幅・行高を設定
            const calcSizePattern = /<calcSize cell="([^"]+)" (width|height)="(\d+)"\/?\s*>/g;
            let sizeMatch;
            while ((sizeMatch = calcSizePattern.exec(xtadData)) !== null) {
                const cell = sizeMatch[1];
                const sizeType = sizeMatch[2]; // 'width' or 'height'
                const sizeValue = parseInt(sizeMatch[3]);

                if (sizeType === 'height') {
                    // 行高（cellは数字）
                    const row = parseInt(cell);
                    if (!isNaN(row)) {
                        this.rowHeights.set(row, sizeValue);
                        logger.debug(`[CalcEditor] 行高読み込み: row=${row}, height=${sizeValue}`);
                    }
                } else if (sizeType === 'width') {
                    // 列幅（cellは文字 A, B, C...）
                    const col = this.letterToCol(cell);
                    if (col > 0) {
                        this.columnWidths.set(col, sizeValue);
                        logger.debug(`[CalcEditor] 列幅読み込み: col=${cell}(${col}), width=${sizeValue}`);
                    }
                }
            }

            // 読み込んだ列幅・行高をDOMに適用
            for (const col of this.columnWidths.keys()) {
                this.applyColumnWidth(col);
            }
            for (const row of this.rowHeights.keys()) {
                this.applyRowHeight(row);
            }

            let matchCount = 0;

            // cell="A1"形式をパース（新形式）
            // <calcPos>タグを全て検索して、各セルを個別に処理
            // タブまたは次の<calcPos>までをマッチ（非貪欲）
            const calcPosPattern = /<calcPos cell="([A-Z]+)(\d+)"\/?>([^\t\n\r]*?)(?=\t|<calcPos|<\/p>|<p>|$)/g;
            let match;

            while ((match = calcPosPattern.exec(xtadData)) !== null) {
                const colLetters = match[1];
                const row = parseInt(match[2]);
                const col = this.letterToCol(colLetters);
                let contentAfterCalcPos = match[3];

                logger.debug(`[CalcEditor] セル解析: ${colLetters}${row}, 内容: "${contentAfterCalcPos}"`);

                // <calcCell>タグがあればスタイルを抽出
                let cellStyle = {};
                const calcCellMatch = contentAfterCalcPos.match(/<calcCell ([^>]+)\/>/);
                if (calcCellMatch) {
                    cellStyle = this.parseCalcCellTag(calcCellMatch[1]);
                    // <calcCell>タグを除去
                    contentAfterCalcPos = contentAfterCalcPos.replace(/<calcCell [^>]+\/>/, '');
                }

                // <text align>タグがあればテキスト配置を抽出
                const textAlignMatch = /<text\s+align="([^"]*)"\s*\/>/i.exec(contentAfterCalcPos);
                if (textAlignMatch) {
                    cellStyle.textAlign = textAlignMatch[1];
                    // <text align>タグを除去
                    contentAfterCalcPos = contentAfterCalcPos.replace(/<text\s+align="[^"]*"\s*\/>/, '');
                }

                // <cell valign>タグがあれば垂直配置を抽出
                const cellVAlignMatch = /<cell\s+valign="([^"]*)"\s*\/>/i.exec(contentAfterCalcPos);
                if (cellVAlignMatch) {
                    cellStyle.vAlign = cellVAlignMatch[1];
                    // <cell valign>タグを除去
                    contentAfterCalcPos = contentAfterCalcPos.replace(/<cell\s+valign="[^"]*"\s*\/>/, '');
                }

                // <link>タグがあれば仮身セルとして処理
                const linkMatch = contentAfterCalcPos.match(/<link\s+([^>]*)>(.*?)<\/link>/);
                if (linkMatch) {
                    const attrs = linkMatch[1];
                    const innerContent = linkMatch[2];

                    // 属性をパース
                    const attrMap = {};
                    const attrRegex = /(\w+)="([^"]*)"/g;
                    let attrMatch;
                    while ((attrMatch = attrRegex.exec(attrs)) !== null) {
                        // XML エンティティをデコード
                        attrMap[attrMatch[1]] = this.unescapeXml(attrMatch[2]);
                    }

                    // applistをパース（エラーハンドリング付き）
                    let applist = undefined;
                    if (attrMap.applist) {
                        try {
                            applist = JSON.parse(attrMap.applist);
                        } catch (e) {
                            logger.warn('[CalcEditor] applistのJSON.parseに失敗:', attrMap.applist, e);
                        }
                    }

                    // 仮身オブジェクトを作成
                    const virtualObject = {
                        link_id: attrMap.id || '',
                        link_name: attrMap.name || this.unescapeXml(innerContent) || '',
                        tbcol: attrMap.tbcol,
                        frcol: attrMap.frcol,
                        chcol: attrMap.chcol,
                        bgcol: attrMap.bgcol,
                        chsz: attrMap.chsz,
                        framedisp: attrMap.framedisp,
                        namedisp: attrMap.namedisp !== undefined ? attrMap.namedisp : 'true',
                        pictdisp: attrMap.pictdisp !== undefined ? attrMap.pictdisp : 'true',
                        roledisp: attrMap.roledisp,
                        typedisp: attrMap.typedisp,
                        updatedisp: attrMap.updatedisp,
                        width: attrMap.width ? parseFloat(attrMap.width) : undefined,
                        heightPx: attrMap.heightPx ? parseFloat(attrMap.heightPx) : undefined,
                        autoopen: attrMap.autoopen || 'false',
                        applist: applist
                    };

                    // メタデータをJSONから読み込み（続柄、更新日時など）
                    await this.loadVirtualObjectMetadata(virtualObject);

                    // セルに仮身を設定
                    const key = `${col},${row}`;
                    const cellData = {
                        value: '',
                        formula: '',
                        displayValue: '',
                        style: cellStyle,
                        virtualObject: virtualObject,
                        contentType: 'virtualObject'
                    };

                    this.cells.set(key, cellData);
                    this.renderCell(col, row);
                    matchCount++;
                } else {
                    // <image>タグがあれば画像セルとして処理
                    const imageMatch = contentAfterCalcPos.match(/<image\s+([^>]*)(?:\/>|>)/);
                    if (imageMatch) {
                        const imageAttrs = imageMatch[1];

                        // 属性をパース
                        const imageAttrMap = {};
                        const imageAttrRegex = /(\w+)="([^"]*)"/g;
                        let imageAttrMatch;
                        while ((imageAttrMatch = imageAttrRegex.exec(imageAttrs)) !== null) {
                            imageAttrMap[imageAttrMatch[1]] = imageAttrMatch[2];
                        }

                        // 画像情報を作成
                        const imageInfo = {
                            href: imageAttrMap.href || '',
                            name: imageAttrMap.href?.split('/').pop() || '画像',
                            left: parseFloat(imageAttrMap.left) || 0,
                            top: parseFloat(imageAttrMap.top) || 0,
                            right: parseFloat(imageAttrMap.right) || 100,
                            bottom: parseFloat(imageAttrMap.bottom) || 100,
                            l_atr: imageAttrMap.l_atr || '1',
                            l_pat: imageAttrMap.l_pat || '0',
                            f_pat: imageAttrMap.f_pat || '1',
                            angle: parseFloat(imageAttrMap.angle) || 0,
                            rotation: parseFloat(imageAttrMap.rotation) || 0,
                            flipH: imageAttrMap.flipH === 'true',
                            flipV: imageAttrMap.flipV === 'true',
                            displayWidth: imageAttrMap.displayWidth ? parseFloat(imageAttrMap.displayWidth) : undefined,
                            displayHeight: imageAttrMap.displayHeight ? parseFloat(imageAttrMap.displayHeight) : undefined
                        };

                        // セルに画像を設定
                        const key = `${col},${row}`;
                        const cellData = {
                            value: '',
                            formula: '',
                            displayValue: '',
                            style: cellStyle,
                            imageInfo: imageInfo,
                            contentType: 'image'
                        };

                        this.cells.set(key, cellData);

                        // 画像ファイルパスを非同期で取得してセルを更新
                        if (imageInfo.href) {
                            const currentCol = col;
                            const currentRow = row;
                            this.getImageFilePath(imageInfo.href).then(filePath => {
                                logger.debug('[CalcEditor] 画像パス取得成功:', imageInfo.href, '->', filePath);
                                // 絶対パスをfile:// URLに変換
                                let fileUrl = filePath;
                                if (filePath.match(/^[A-Za-z]:\\/)) {
                                    // Windows絶対パス (C:\...) を file:// URLに変換
                                    fileUrl = 'file:///' + filePath.replace(/\\/g, '/');
                                } else if (filePath.startsWith('/')) {
                                    // Unix絶対パス
                                    fileUrl = 'file://' + filePath;
                                }
                                // セルデータを更新
                                const cellDataToUpdate = this.cells.get(`${currentCol},${currentRow}`);
                                if (cellDataToUpdate && cellDataToUpdate.imageInfo) {
                                    cellDataToUpdate.imageInfo.src = fileUrl;
                                    this.renderCell(currentCol, currentRow);
                                }
                            }).catch(error => {
                                logger.error('[CalcEditor] 画像パス取得エラー:', imageInfo.href, error);
                            });
                        }

                        this.renderCell(col, row);
                        matchCount++;
                        logger.debug(`[CalcEditor] 画像セル読み込み: ${colLetters}${row}, href=${imageInfo.href}`);
                        continue;
                    }

                    // 通常セル: セルの値と文字装飾を解析
                    const { value, style: formatStyle } = this.parseCellValueWithFormatting(contentAfterCalcPos);

                    // スタイルをマージ
                    const combinedStyle = { ...cellStyle, ...formatStyle };

                    if (value || Object.keys(combinedStyle).length > 0) {
                        // BTRONの全角文字を半角に変換 + [row,col]形式をA1形式に変換
                        const convertedValue = this.convertOldFormulaFormat(value);
                        this.setCellValue(col, row, convertedValue);
                        if (Object.keys(combinedStyle).length > 0) {
                            this.setCellStyle(col, row, combinedStyle);
                        }
                        this.renderCell(col, row);
                        matchCount++;
                    }
                }
            }

            // col/row形式もパース（旧形式・後方互換性）
            if (matchCount === 0) {
                const colRowRegex = /<calcPos col="(\d+)" row="(\d+)"\/?>([^<\t]*)/g;

                while ((match = colRowRegex.exec(xtadData)) !== null) {
                    const row = parseInt(match[1]); // colとrowが逆（BTRONの仕様）
                    const col = parseInt(match[2]);
                    let value = match[3].trim();

                    // 値がタブで始まる場合は除去
                    if (value.startsWith('\t')) {
                        value = value.substring(1);
                    }

                    // 旧形式の数式を新形式に変換
                    value = this.convertOldFormulaFormat(value);

                    if (value) {
                        this.setCellValue(col, row, value);
                        this.renderCell(col, row);
                        matchCount++;
                    }
                }
            }

            // <calcMerge>タグをパースしてセル結合を復元
            const calcMergePattern = /<calcMerge range="([A-Z]+)(\d+):([A-Z]+)(\d+)"\/?\s*>/g;
            let mergeMatch;
            while ((mergeMatch = calcMergePattern.exec(xtadData)) !== null) {
                const startColLetter = mergeMatch[1];
                const startRow = parseInt(mergeMatch[2]);
                const endColLetter = mergeMatch[3];
                const endRow = parseInt(mergeMatch[4]);

                const startCol = this.letterToCol(startColLetter);
                const endCol = this.letterToCol(endColLetter);

                if (startCol > 0 && endCol > 0 && startRow > 0 && endRow > 0) {
                    // 結合情報を登録（レンダリングなしで内部状態のみ設定）
                    const key = `${startCol},${startRow}`;
                    this.mergedCells.set(key, {
                        startCol: startCol,
                        startRow: startRow,
                        endCol: endCol,
                        endRow: endRow
                    });
                }
            }

            // 結合セルをレンダリング
            if (this.mergedCells.size > 0) {
                for (const [key, mergeInfo] of this.mergedCells) {
                    this.renderMergedCells(mergeInfo.startCol, mergeInfo.startRow, mergeInfo.endCol, mergeInfo.endRow);
                }
            }

            logger.info(`[CalcEditor] ${this.cells.size}セル読み込み完了`);

            // データがある範囲までグリッドを拡張
            let maxDataRow = this.defaultRows;
            let maxDataCol = this.defaultCols;
            for (const [key, cellData] of this.cells) {
                const [colStr, rowStr] = key.split(',');
                const col = parseInt(colStr);
                const row = parseInt(rowStr);
                if (col > maxDataCol) maxDataCol = col;
                if (row > maxDataRow) maxDataRow = row;
            }
            // 結合セルも考慮
            for (const [key, mergeInfo] of this.mergedCells) {
                if (mergeInfo.endCol > maxDataCol) maxDataCol = mergeInfo.endCol;
                if (mergeInfo.endRow > maxDataRow) maxDataRow = mergeInfo.endRow;
            }
            // グリッドを拡張
            if (maxDataRow > this.currentMaxRow || maxDataCol > this.currentMaxCol) {
                this.expandGridTo(maxDataRow, maxDataCol);
                logger.info(`[CalcEditor] データ範囲に合わせてグリッド拡張: ${this.colToLetter(maxDataCol)}${maxDataRow}まで`);
            }

            // autoopen属性がtrueの仮身を自動的に開く
            await this.autoOpenVirtualObjects();
        } catch (e) {
            logger.error('[CalcEditor] xtadデータ読み込みエラー', e);
        }
    }

    /**
     * autoopen属性がtrueの仮身を自動的に開く
     */
    async autoOpenVirtualObjects() {
        for (const [key, cellData] of this.cells) {
            if (cellData.contentType === 'virtualObject' && cellData.virtualObject) {
                const vobj = cellData.virtualObject;
                if (vobj.autoopen === 'true') {
                    try {
                        // applistを確認
                        const applist = vobj.applist;
                        if (!applist || typeof applist !== 'object') {
                            continue;
                        }

                        // defaultOpen=trueのプラグインを探す
                        let defaultPluginId = null;
                        for (const [pluginId, config] of Object.entries(applist)) {
                            if (config.defaultOpen === true) {
                                defaultPluginId = pluginId;
                                break;
                            }
                        }

                        if (!defaultPluginId) {
                            // defaultOpen=trueがない場合は最初のプラグインを使用
                            defaultPluginId = Object.keys(applist)[0];
                        }

                        if (!defaultPluginId) {
                            continue;
                        }

                        // 実身を開く
                        if (this.messageBus) {
                            this.messageBus.send('open-virtual-object-real', {
                                virtualObj: vobj,
                                pluginId: defaultPluginId
                            });
                        }
                    } catch (error) {
                        logger.error('[CalcEditor] 自動起動エラー:', vobj.link_id, error);
                        // エラーが発生しても次の仮身の起動を続行
                    }
                }
            }
        }
    }

    /**
     * <calcCell>タグの属性からスタイルを抽出
     */
    parseCalcCellTag(attrs) {
        const style = {};

        // 背景色
        const bgColMatch = attrs.match(/bgCol="([^"]+)"/);
        if (bgColMatch) {
            style.backgroundColor = bgColMatch[1];
        }

        // 枠線 - 各辺を個別に処理
        const borderProps = {};
        const borderTypes = ['Top', 'Bottom', 'Left', 'Right'];
        let hasBorder = false;

        borderTypes.forEach(side => {
            const enabled = attrs.match(new RegExp(`border${side}="1"`));
            if (enabled) {
                hasBorder = true;
                const typeMatch = attrs.match(new RegExp(`border${side}Type="([^"]+)"`));
                const widthMatch = attrs.match(new RegExp(`border${side}Width="([^"]+)"`));
                const colorMatch = attrs.match(new RegExp(`border${side}Color="([^"]+)"`));

                // 各辺を個別のオブジェクトとして格納
                const sideKey = side.toLowerCase();
                borderProps[sideKey] = {
                    style: typeMatch ? (typeMatch[1] === 'dash' ? 'dashed' : typeMatch[1] === 'dot' ? 'dotted' : typeMatch[1] === 'line' ? 'solid' : 'solid') : 'solid',
                    width: widthMatch ? parseInt(widthMatch[1]) : 1,
                    color: colorMatch ? colorMatch[1] : '#000000'
                };
            }
        });

        if (hasBorder) {
            style.border = borderProps;
        }

        return style;
    }

    /**
     * セルの値から文字装飾タグを解析
     */
    parseCellValueWithFormatting(content) {
        let value = content;
        const style = {};

        // タブと改行を削除
        value = value.replace(/[\t\n\r]/g, '');

        // <font>タグからスタイルを抽出
        const fontColorMatch = value.match(/<font color="([^"]+)"\/>/);
        if (fontColorMatch) {
            style.color = fontColorMatch[1];
            value = value.replace(/<font color="[^"]+"\/>/g, '');
        }

        const fontSizeMatch = value.match(/<font size="([^"]+)"\/>/);
        if (fontSizeMatch) {
            style.fontSize = parseInt(fontSizeMatch[1]);
            value = value.replace(/<font size="[^"]+"\/>/g, '');
        }

        const fontFaceMatch = value.match(/<font face="([^"]+)"\/>/);
        if (fontFaceMatch) {
            style.fontFamily = fontFaceMatch[1];
            value = value.replace(/<font face="[^"]+"\/>/g, '');
        }

        // 自己終了タグ (<bold/>, <italic/>, etc.) を開始/終了タグ形式に変換
        // 例: <bold/>A2 → <bold>A2</bold>
        const selfClosingTags = ['bold', 'italic', 'underline', 'mesh', 'invert', 'strikethrough', 'superscript', 'subscript'];
        for (const tag of selfClosingTags) {
            // <tag/>の後に続くテキストを<tag>...</tag>で囲む
            const selfClosingRegex = new RegExp(`<${tag}/>([^<]*)`, 'g');
            value = value.replace(selfClosingRegex, `<${tag}>$1</${tag}>`);
        }

        // <bold>タグ
        if (value.includes('<bold>')) {
            style.fontWeight = 'bold';
            value = value.replace(/<\/?bold>/g, '');
        }

        // <italic>タグ
        if (value.includes('<italic>')) {
            style.fontStyle = 'italic';
            value = value.replace(/<\/?italic>/g, '');
        }

        // <underline>タグと<strikethrough>タグ（同時に適用可能）
        const decorations = [];
        if (value.includes('<underline>')) {
            decorations.push('underline');
            value = value.replace(/<\/?underline>/g, '');
        }
        if (value.includes('<strikethrough>')) {
            decorations.push('line-through');
            value = value.replace(/<\/?strikethrough>/g, '');
        }
        if (decorations.length > 0) {
            style.textDecoration = decorations.join(' ');
        }

        // <superscript>タグ
        if (value.includes('<superscript>')) {
            style.verticalAlign = 'super';
            value = value.replace(/<\/?superscript>/g, '');
        }

        // <subscript>タグ
        if (value.includes('<subscript>')) {
            style.verticalAlign = 'sub';
            value = value.replace(/<\/?subscript>/g, '');
        }

        // <mesh>タグ（網掛け）
        if (value.includes('<mesh>')) {
            style.mesh = true;
            value = value.replace(/<\/?mesh>/g, '');
        }

        // <invert>タグ（反転）
        if (value.includes('<invert>')) {
            style.invert = true;
            value = value.replace(/<\/?invert>/g, '');
        }

        // XMLエンティティをデコード
        value = value
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            .replace(/&amp;/g, '&');

        value = value.trim();

        // ダブルクォートを削除（"B4" → B4）
        // 先頭と末尾のダブルクォート（半角・全角）を削除
        // U+0022 ("), U+FF02 ("), U+201C ("), U+201D ("), U+301D (〝), U+301E (〞)
        value = value.replace(/^[\u0022\u201C\u201D\u301D\u301E\uFF02]/, '').replace(/[\u0022\u201C\u201D\u301D\u301E\uFF02]$/, '');

        return { value, style };
    }

    /**
     * xtadデータ生成
     * セル位置はcell="A1"形式で出力
     */
    generateXtadData() {
        logger.info(`[CalcEditor] generateXtadData開始 - セル数: ${this.cells.size}`);

        let xtad = `<tad version="1.0" filename="${this.fileName || '表計算'}" encoding="UTF-8">\n`;
        xtad += '<document>\n';

        // 行高・列幅のカスタムサイズを出力（デフォルトと異なるもののみ）
        // 先に行高を出力
        const customRows = [];
        for (let row = 1; row <= this.defaultRows; row++) {
            if (this.rowHeights.has(row)) {
                const height = this.rowHeights.get(row);
                if (height !== this.cellHeight) {
                    customRows.push(row);
                }
            }
        }
        customRows.forEach(row => {
            const height = this.rowHeights.get(row);
            xtad += `<calcSize cell="${row}" height="${height}"/>\n`;
        });

        // 次に列幅を出力
        const customCols = [];
        for (let col = 1; col <= this.defaultCols; col++) {
            if (this.columnWidths.has(col)) {
                const width = this.columnWidths.get(col);
                if (width !== this.cellWidth) {
                    customCols.push(col);
                }
            }
        }
        customCols.forEach(col => {
            const width = this.columnWidths.get(col);
            const colLetter = this.colToLetter(col);
            xtad += `<calcSize cell="${colLetter}" width="${width}"/>\n`;
        });

        // セル結合情報を出力
        for (const [key, mergeInfo] of this.mergedCells) {
            const startRef = `${this.colToLetter(mergeInfo.startCol)}${mergeInfo.startRow}`;
            const endRef = `${this.colToLetter(mergeInfo.endCol)}${mergeInfo.endRow}`;
            xtad += `<calcMerge range="${startRef}:${endRef}"/>\n`;
        }

        xtad += '<p>\n';
        xtad += '<paper type="doc" length="1403" width="992" binding="0" imposition="0" top="94" bottom="94" left="94" right="47" />\n';
        xtad += '<docmargin top="94" bottom="94" left="94" right="47" />\n';

        // 行ごとにセルを出力
        let maxRow = 1;
        let maxCol = 1;
        this.cells.forEach((cellData, key) => {
            const [col, row] = key.split(',').map(Number);
            maxRow = Math.max(maxRow, row);
            maxCol = Math.max(maxCol, col);
        });

        logger.info(`[CalcEditor] maxRow=${maxRow}, maxCol=${maxCol}`);

        for (let row = 1; row <= maxRow; row++) {
            if (row > 1) xtad += '<p>';

            for (let col = 1; col <= maxCol; col++) {
                const key = `${col},${row}`;
                const cellData = this.cells.get(key);
                // 数式がある場合は数式を、なければ値を保存
                const value = cellData ? (cellData.formula || cellData.value || '') : '';
                // セル参照をA1形式に変換
                const cellRef = `${this.colToLetter(col)}${row}`;

                // <calcPos>タグ
                xtad += `<calcPos cell="${cellRef}"/>`;

                // <calcCell>タグ（セルの枠線・背景色）
                if (cellData && cellData.style) {
                    const calcCellTag = this.generateCalcCellTag(cellData.style);
                    if (calcCellTag) {
                        xtad += calcCellTag;
                    }
                }

                // <text align>タグ（テキスト配置）
                if (cellData && cellData.style && cellData.style.textAlign && cellData.style.textAlign !== 'left') {
                    xtad += `<text align="${cellData.style.textAlign}"/>`;
                }

                // <cell valign>タグ（垂直配置）
                if (cellData && cellData.style && cellData.style.vAlign && cellData.style.vAlign !== 'middle') {
                    xtad += `<cell valign="${cellData.style.vAlign}"/>`;
                }

                // セルの値（仮身、画像、または文字装飾タグ付き）
                if (cellData && cellData.contentType === 'virtualObject' && cellData.virtualObject) {
                    // 仮身セル: <link>タグを生成
                    xtad += this.generateLinkTag(cellData.virtualObject);
                } else if (cellData && cellData.contentType === 'image' && cellData.imageInfo) {
                    // 画像セル: <image>タグを生成
                    xtad += this.generateImageTag(cellData.imageInfo);
                } else {
                    // 通常セル: 文字装飾タグ付き
                    xtad += this.generateCellValueWithFormatting(value, cellData?.style);
                }

                if (col < maxCol) {
                    xtad += '\t';
                }
            }

            xtad += '</p>\n';
        }

        xtad += '</document>\n';
        xtad += '</tad>\n';

        logger.info(`[CalcEditor] generateXtadData完了 - データ長: ${xtad.length}`);
        logger.info(`[CalcEditor] 生成されたXTADの最初の500文字:`, xtad.substring(0, 500));

        return xtad;
    }

    /**
     * <calcCell>タグを生成（セル枠線・背景色）
     */
    generateCalcCellTag(style) {
        if (!style) return '';

        let attrs = [];

        // 背景色
        if (style.backgroundColor && style.backgroundColor !== '#ffffff') {
            attrs.push(`bgCol="${style.backgroundColor}"`);
        }

        // 枠線（border）- 各辺を個別に処理
        if (style.border) {
            const border = style.border;

            // 上枠線
            if (border.top) {
                const borderType = border.top.style === 'solid' ? 'line' :
                                 border.top.style === 'dashed' ? 'dash' :
                                 border.top.style === 'dotted' ? 'dot' :
                                 border.top.style === 'double' ? 'double' : 'line';
                attrs.push(`borderTop="1" borderTopType="${borderType}" borderTopWidth="${border.top.width}" borderTopColor="${border.top.color}"`);
            }

            // 下枠線
            if (border.bottom) {
                const borderType = border.bottom.style === 'solid' ? 'line' :
                                 border.bottom.style === 'dashed' ? 'dash' :
                                 border.bottom.style === 'dotted' ? 'dot' :
                                 border.bottom.style === 'double' ? 'double' : 'line';
                attrs.push(`borderBottom="1" borderBottomType="${borderType}" borderBottomWidth="${border.bottom.width}" borderBottomColor="${border.bottom.color}"`);
            }

            // 左枠線
            if (border.left) {
                const borderType = border.left.style === 'solid' ? 'line' :
                                 border.left.style === 'dashed' ? 'dash' :
                                 border.left.style === 'dotted' ? 'dot' :
                                 border.left.style === 'double' ? 'double' : 'line';
                attrs.push(`borderLeft="1" borderLeftType="${borderType}" borderLeftWidth="${border.left.width}" borderLeftColor="${border.left.color}"`);
            }

            // 右枠線
            if (border.right) {
                const borderType = border.right.style === 'solid' ? 'line' :
                                 border.right.style === 'dashed' ? 'dash' :
                                 border.right.style === 'dotted' ? 'dot' :
                                 border.right.style === 'double' ? 'double' : 'line';
                attrs.push(`borderRight="1" borderRightType="${borderType}" borderRightWidth="${border.right.width}" borderRightColor="${border.right.color}"`);
            }
        }

        if (attrs.length === 0) return '';

        return `<calcCell ${attrs.join(' ')}/>`;
    }

    /**
     * セルの値を文字装飾タグで囲む
     */
    generateCellValueWithFormatting(value, style) {
        if (!value || !style) return this.escapeXml(value);

        let result = this.escapeXml(value);

        // フォント設定（自己閉じタグ）
        let fontTags = '';

        if (style.color && style.color !== '#000000') {
            fontTags += `<font color="${style.color}"/>`;
        }

        if (style.fontSize && style.fontSize !== 12) {
            fontTags += `<font size="${style.fontSize}"/>`;
        }

        if (style.fontFamily && style.fontFamily !== 'MS Gothic') {
            fontTags += `<font face="${style.fontFamily}"/>`;
        }

        // 文字修飾（開始・終了タグ）
        if (style.fontWeight === 'bold') {
            result = `<bold>${result}</bold>`;
        }

        if (style.fontStyle === 'italic') {
            result = `<italic>${result}</italic>`;
        }

        // textDecorationは'underline'、'line-through'、または'underline line-through'の可能性がある
        if (style.textDecoration && style.textDecoration.includes('underline')) {
            result = `<underline>${result}</underline>`;
        }

        if (style.textDecoration && style.textDecoration.includes('line-through')) {
            result = `<strikethrough>${result}</strikethrough>`;
        }

        if (style.verticalAlign === 'super') {
            result = `<superscript>${result}</superscript>`;
        }

        if (style.verticalAlign === 'sub') {
            result = `<subscript>${result}</subscript>`;
        }

        // フォントタグを先頭に追加
        return fontTags + result;
    }

    // escapeXml / unescapeXml は PluginBase に移動済み

    /**
     * <link>タグを生成（仮身）
     * @param {Object} virtualObject - 仮身オブジェクト
     * @returns {string} <link>タグ
     */
    generateLinkTag(virtualObject) {
        if (!virtualObject || !virtualObject.link_id) {
            logger.warn('[CalcEditor] 仮身情報が不正です:', virtualObject);
            return '';
        }

        // 必須属性
        let attrs = ` id="${this.escapeXml(virtualObject.link_id)}"`;

        // 名前
        const linkName = virtualObject.link_name || virtualObject.displayName || '';
        if (linkName) {
            attrs += ` name="${this.escapeXml(linkName)}"`;
        }

        // 色属性
        if (virtualObject.tbcol) attrs += ` tbcol="${this.escapeXml(virtualObject.tbcol)}"`;
        if (virtualObject.frcol) attrs += ` frcol="${this.escapeXml(virtualObject.frcol)}"`;
        if (virtualObject.chcol) attrs += ` chcol="${this.escapeXml(virtualObject.chcol)}"`;
        if (virtualObject.bgcol) attrs += ` bgcol="${this.escapeXml(virtualObject.bgcol)}"`;

        // 文字サイズ
        if (virtualObject.chsz) attrs += ` chsz="${this.escapeXml(virtualObject.chsz)}"`;

        // 表示設定
        if (virtualObject.framedisp !== undefined) attrs += ` framedisp="${virtualObject.framedisp}"`;
        if (virtualObject.namedisp !== undefined) attrs += ` namedisp="${virtualObject.namedisp}"`;
        if (virtualObject.pictdisp !== undefined) attrs += ` pictdisp="${virtualObject.pictdisp}"`;
        if (virtualObject.roledisp !== undefined) attrs += ` roledisp="${virtualObject.roledisp}"`;
        if (virtualObject.typedisp !== undefined) attrs += ` typedisp="${virtualObject.typedisp}"`;
        if (virtualObject.updatedisp !== undefined) attrs += ` updatedisp="${virtualObject.updatedisp}"`;

        // サイズ設定（仮身のサイズ）
        if (virtualObject.width) attrs += ` width="${virtualObject.width}"`;
        if (virtualObject.heightPx) attrs += ` heightPx="${virtualObject.heightPx}"`;

        // applist（プラグイン設定）
        if (virtualObject.applist) {
            attrs += ` applist="${this.escapeXml(JSON.stringify(virtualObject.applist))}"`;
        }

        // 内容（linkタグ内のテキスト）
        const innerContent = linkName;

        return `<link${attrs}>${this.escapeXml(innerContent)}</link>`;
    }

    /**
     * <image>タグを生成
     * @param {Object} imageInfo - 画像情報
     * @returns {string} <image>タグ
     */
    generateImageTag(imageInfo) {
        if (!imageInfo || !imageInfo.href) {
            logger.warn('[CalcEditor] 画像情報が不正です:', imageInfo);
            return '';
        }

        // 基本図形編集プラグインと同じ形式でタグを生成
        let attrs = '';

        // 線属性
        attrs += ` l_atr="${imageInfo.l_atr || '1'}"`;
        attrs += ` l_pat="${imageInfo.l_pat || '0'}"`;
        attrs += ` f_pat="${imageInfo.f_pat || '1'}"`;

        // 回転・反転
        attrs += ` angle="${imageInfo.angle || 0}"`;
        attrs += ` rotation="${imageInfo.rotation || 0}"`;
        attrs += ` flipH="${imageInfo.flipH || false}"`;
        attrs += ` flipV="${imageInfo.flipV || false}"`;

        // 位置（セル内での相対位置）
        attrs += ` left="${imageInfo.left || 0}"`;
        attrs += ` top="${imageInfo.top || 0}"`;
        attrs += ` right="${imageInfo.right || 100}"`;
        attrs += ` bottom="${imageInfo.bottom || 100}"`;

        // 表示サイズ（リサイズ後のサイズ）
        if (imageInfo.displayWidth) {
            attrs += ` displayWidth="${imageInfo.displayWidth}"`;
        }
        if (imageInfo.displayHeight) {
            attrs += ` displayHeight="${imageInfo.displayHeight}"`;
        }

        // ファイル参照
        attrs += ` href="${this.escapeXml(imageInfo.href)}"`;

        return `<image${attrs} />`;
    }

    /**
     * ダブルクリックドラッグによる実身複製処理
     * @param {number} sourceCol - 元のセルの列番号
     * @param {number} sourceRow - 元のセルの行番号
     * @param {number} targetCol - ドロップ先セルの列番号
     * @param {number} targetRow - ドロップ先セルの行番号
     */
    async handleDoubleClickDragDuplicate(sourceCol, sourceRow, targetCol, targetRow) {
        const sourceKey = `${sourceCol},${sourceRow}`;
        const sourceCellData = this.cells.get(sourceKey);

        if (!sourceCellData || sourceCellData.contentType !== 'virtualObject' || !sourceCellData.virtualObject) {
            logger.warn('[CalcEditor] ダブルクリックドラッグ: 元のセルに仮身がありません');
            return;
        }

        const virtualObject = sourceCellData.virtualObject;
        const realId = virtualObject.link_id.replace(/_\d+\.xtad$/i, '');

        logger.debug('[CalcEditor] ダブルクリックドラッグによる実身複製:', realId, 'ドロップ位置:', `${this.colToLetter(targetCol)}${targetRow}`);

        // 先にダイアログで名前を入力してもらう
        const defaultName = (virtualObject.link_name || '実身') + 'のコピー';
        const newName = await this.showInputDialog(
            '新しい実身の名称を入力してください',
            defaultName,
            30
        );

        // キャンセルされた場合は何もしない（showInputDialogはキャンセル時にnullを返す）
        if (!newName) {
            logger.debug('[CalcEditor] 実身複製がキャンセルされました');
            return;
        }
        const messageId = this.generateMessageId('duplicate');

        // MessageBus経由で実身複製を要求（名前を含める）
        this.messageBus.send('duplicate-real-object', {
            realId: realId,
            messageId: messageId,
            newName: newName
        });

        try {
            // タイムアウト5秒で応答を待つ
            const result = await this.messageBus.waitFor('real-object-duplicated', 5000, (data) => {
                return data.messageId === messageId;
            });

            if (result.cancelled) {
                logger.debug('[CalcEditor] 実身複製がキャンセルされました');
            } else if (result.success) {
                // 複製成功: 新しい実身IDで仮身を作成
                const newRealId = result.newRealId;
                const newName = result.newName;
                logger.debug('[CalcEditor] 実身複製成功:', realId, '->', newRealId, '名前:', newName);

                // 新しい仮身オブジェクトを作成（元の仮身の属性を引き継ぐ）
                const newVirtualObject = {
                    link_id: `${newRealId}_0.xtad`,
                    link_name: newName,
                    tbcol: virtualObject.tbcol || '#ffffff',
                    frcol: virtualObject.frcol || '#000000',
                    chcol: virtualObject.chcol || '#000000',
                    bgcol: virtualObject.bgcol || '#ffffff',
                    chsz: virtualObject.chsz || '',
                    framedisp: virtualObject.framedisp,
                    namedisp: virtualObject.namedisp,
                    pictdisp: virtualObject.pictdisp,
                    roledisp: virtualObject.roledisp,
                    typedisp: virtualObject.typedisp,
                    updatedisp: virtualObject.updatedisp,
                    applist: virtualObject.applist || {}
                };

                // ドロップ位置のセルに新しい仮身を設定
                const targetKey = `${targetCol},${targetRow}`;
                this.cells.set(targetKey, {
                    value: '',
                    formula: '',
                    displayValue: '',
                    style: {},
                    virtualObject: newVirtualObject,
                    contentType: 'virtualObject'
                });

                this.isModified = true;
                this.renderCell(targetCol, targetRow);
            } else {
                logger.error('[CalcEditor] 実身複製に失敗しました');
            }
        } catch (error) {
            logger.error('[CalcEditor] 実身複製エラー:', error);
        }
    }

    /**
     * linkタグXMLから仮身オブジェクトをパース
     * @param {string} linkXml - <link>タグを含むXML文字列
     * @returns {Object|null} 仮身オブジェクト、パース失敗時はnull
     */
    parseLinkTag(linkXml) {
        try {
            const linkMatch = linkXml.match(/<link\s+([^>]*)>(.*?)<\/link>/);
            if (!linkMatch) {
                logger.warn('[CalcEditor] linkタグのマッチに失敗:', linkXml);
                return null;
            }

            const attrs = linkMatch[1];
            const innerContent = linkMatch[2];

            // 属性をパース
            const attrMap = {};
            const attrRegex = /(\w+)="([^"]*)"/g;
            let attrMatch;
            while ((attrMatch = attrRegex.exec(attrs)) !== null) {
                // XML エンティティをデコード
                attrMap[attrMatch[1]] = this.unescapeXml(attrMatch[2]);
            }

            // applistをパース（エラーハンドリング付き）
            let applist = undefined;
            if (attrMap.applist) {
                try {
                    applist = JSON.parse(attrMap.applist);
                } catch (e) {
                    logger.warn('[CalcEditor] applistのJSON.parseに失敗:', attrMap.applist, e);
                }
            }

            // 仮身オブジェクトを作成
            const virtualObject = {
                link_id: attrMap.id || '',
                link_name: attrMap.name || this.unescapeXml(innerContent) || '',
                tbcol: attrMap.tbcol,
                frcol: attrMap.frcol,
                chcol: attrMap.chcol,
                bgcol: attrMap.bgcol,
                chsz: attrMap.chsz,
                framedisp: attrMap.framedisp,
                namedisp: attrMap.namedisp,
                pictdisp: attrMap.pictdisp,
                roledisp: attrMap.roledisp,
                typedisp: attrMap.typedisp,
                updatedisp: attrMap.updatedisp,
                width: attrMap.width ? parseFloat(attrMap.width) : undefined,
                heightPx: attrMap.heightPx ? parseFloat(attrMap.heightPx) : undefined,
                applist: applist
            };

            logger.debug('[CalcEditor] linkタグパース成功:', virtualObject);
            return virtualObject;
        } catch (error) {
            logger.error('[CalcEditor] linkタグパースエラー:', error);
            return null;
        }
    }

    /**
     * ドキュメント保存
     */
    saveDocument() {
        // 保存時にスクロール位置も保存
        this.saveScrollPosition();

        logger.info('[CalcEditor] ドキュメント保存');
        logger.info(`[CalcEditor] realId: ${this.realId}, messageBus存在: ${!!this.messageBus}`);
        logger.info(`[CalcEditor] cells.size: ${this.cells.size}`);

        const xmlData = this.generateXtadData();
        logger.info(`[CalcEditor] xmlData生成完了, 長さ: ${xmlData.length}`);

        if (this.messageBus) {
            logger.info('[CalcEditor] messageBus.sendを呼び出し中...');
            // MessageBusの子モードではsendを使用（basic-text-editorと同じメッセージ名）
            this.messageBus.send('xml-data-changed', {
                fileId: this.realId,
                xmlData: xmlData
            });
            logger.info('[CalcEditor] messageBus.send呼び出し完了');
        } else {
            logger.error('[CalcEditor] messageBusが存在しません！');
        }

        this.isModified = false;
        logger.info('[CalcEditor] isModifiedをfalseに設定');
    }

    /**
     * 新たな実身に保存（名前を付けて保存）
     */
    async saveDocumentAs() {
        logger.info('[CalcEditor] 新たな実身に保存');

        // まず現在のデータを保存
        this.saveDocument();

        // 親ウィンドウに新たな実身への保存を要求（basic-text-editorと同じ方式）
        const messageId = this.generateMessageId('save-as-new');

        this.messageBus.send('save-as-new-real-object', {
            realId: this.realId,
            messageId: messageId
        });

        logger.info('[CalcEditor] 新たな実身への保存要求:', this.realId);

        try {
            // レスポンスを待つ（ユーザー入力を待つのでタイムアウト無効）
            const result = await this.messageBus.waitFor('save-as-new-real-object-completed', 0, (data) => {
                return data.messageId === messageId;
            });

            if (result.cancelled) {
                logger.info('[CalcEditor] 新たな実身への保存がキャンセルされました');
            } else if (result.success) {
                logger.info('[CalcEditor] 新たな実身への保存成功:', result.newRealId, '名前:', result.newName);
                // realIdを更新
                this.realId = result.newRealId;
                this.fileName = result.newName;
            } else {
                logger.error('[CalcEditor] 新たな実身への保存失敗:', result.error);
            }
        } catch (error) {
            logger.error('[CalcEditor] 新たな実身への保存エラー:', error);
        }
    }

    /**
     * 全画面表示の切り替え
     */
    toggleFullscreen() {
        logger.info('[CalcEditor] 全画面表示切り替え');

        // 親ウィンドウ（tadjs-desktop.js）にメッセージを送信してウィンドウを最大化/元に戻す
        if (this.messageBus) {
            this.messageBus.send('toggle-maximize');

            // 状態を反転（実際の状態は親ウィンドウが管理）
            this.isFullscreen = !this.isFullscreen;
            logger.info(`[CalcEditor] 全画面表示${this.isFullscreen ? 'ON' : 'OFF'}`);
        }
    }

    /**
     * 表示を更新（再描画）
     */
    refreshView() {
        logger.info('[CalcEditor] 表示を更新');
        this.rebuildGrid();
    }

    /**
     * 背景色をUIに適用（PluginBaseのオーバーライド）
     * @param {string} color - 背景色
     */
    applyBackgroundColor(color) {
        this.bgColor = color;
        const gridBody = document.querySelector('.grid-body');
        if (gridBody) {
            gridBody.style.backgroundColor = color;
        }
    }

    // updateWindowConfig() は基底クラス PluginBase で定義
    // getScrollPosition() は基底クラス PluginBase で定義（.plugin-contentを使用）
    // setScrollPosition() は基底クラス PluginBase で定義（.plugin-contentを使用）

    /**
     * 操作パネル位置を更新
     */
    updatePanelPosition(pos) {
        // 操作パネルの位置を更新
        this.panelpos = pos;
        logger.debug('[CalcEditor] 操作パネル位置を更新:', pos, 'realId:', this.realId);

        // realIdまたはposが設定されていない場合は何もしない
        if (!this.realId || !pos) {
            logger.warn('[CalcEditor] realIdまたはposが未設定のため、パネル位置更新をスキップ', { realId: this.realId, pos: pos });
            return;
        }

        // 親ウィンドウに操作パネル位置の保存を要求
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: 'update-panel-position',
                fileId: this.realId,
                panelpos: pos
            }, '*');
        }
    }

    /**
     * メニューアクションを実行
     * @param {string} action - アクション名
     * @param {Object} additionalData - 追加データ（未使用）
     */
    executeMenuAction(action, additionalData) {
        this.handleMenuAction(action);
    }

    /**
     * メニューアクション処理
     */
    handleMenuAction(action) {
        logger.debug(`[CalcEditor] メニューアクション: ${action}`);

        // 仮身の実行メニューからのアクション（basic-figure-editorと同じ処理）
        if (action.startsWith('execute-with-')) {
            const pluginId = action.replace('execute-with-', '');
            logger.info('[CalcEditor] 仮身を指定アプリで起動:', pluginId);
            this.executeVirtualObjectWithPlugin(pluginId);
            return;
        }

        switch (action) {
            case 'save':
                this.saveDocument();
                break;
            case 'toggle-operation-panel':
                this.toggleOperationPanel();
                break;
            case 'cut':
                this.cutCell();
                break;
            case 'copy':
                this.copyCell();
                break;
            case 'paste':
                this.pasteCell();
                break;
            case 'clear':
                if (this.selectedCell) {
                    this.clearCell(this.selectedCell.col, this.selectedCell.row);
                }
                break;
            case 'insert-row':
                if (this.selectedCell) {
                    this.insertRow(this.selectedCell.row);
                }
                break;
            case 'insert-col':
                if (this.selectedCell) {
                    this.insertColumn(this.selectedCell.col);
                }
                break;
            case 'delete-row':
                if (this.selectedCell) {
                    this.deleteRow(this.selectedCell.row);
                }
                break;
            case 'delete-col':
                if (this.selectedCell) {
                    this.deleteColumn(this.selectedCell.col);
                }
                break;
            case 'fill-down':
                this.fillDown();
                break;
            case 'fill-right':
                this.fillRight();
                break;
            case 'find-replace':
                this.openFindReplaceWindow();
                break;
            case 'merge-cells':
                this.mergeCells();
                break;
            case 'unmerge-cells':
                this.unmergeSelectedCells();
                break;
            case 'close':
                this.requestCloseWindow();
                break;
            case 'save-as':
                this.saveDocumentAs();
                break;
            case 'toggle-fullscreen':
                this.toggleFullscreen();
                break;
            case 'refresh-view':
                this.refreshView();
                break;
            case 'change-bg-color':
                this.changeBgColor();
                break;
            case 'show-font-menu':
                // フォントメニューは親ウィンドウ側で処理
                this.sendToParent('request-font-menu', {});
                break;
            case 'show-text-decoration-menu':
                // 文字修飾メニューは親ウィンドウ側で処理
                this.sendToParent('request-text-decoration-menu', {});
                break;
            case 'show-font-size-menu':
                // 文字サイズメニューは親ウィンドウ側で処理
                this.sendToParent('request-font-size-menu', {});
                break;
            case 'show-text-color-menu':
                // 文字色メニューは親ウィンドウ側で処理
                this.sendToParent('request-text-color-menu', {});
                break;
            case 'show-accessories-menu':
                // 小物メニューは親ウィンドウ側で処理
                this.sendToParent('request-accessories-menu', {});
                break;

            // 仮身操作
            case 'open-real-object':
                this.openRealObjectWithDefaultApp();
                break;
            case 'close-real-object':
                this.closeRealObject();
                break;
            case 'change-virtual-object-attributes':
                this.changeVirtualObjectAttributes();
                break;
            case 'set-relationship':
                this.setRelationship();
                break;

            // 実身操作
            case 'rename-real-object':
                this.renameRealObject();
                break;
            case 'duplicate-real-object':
                this.duplicateRealObject();
                break;

            // 屑実身操作
            case 'open-trash-real-objects':
                this.openTrashRealObjects();
                break;

            // 仮身ネットワーク
            case 'open-virtual-object-network':
                this.openVirtualObjectNetwork();
                break;

            // 実身/仮身検索
            case 'open-real-object-search':
                this.openRealObjectSearch();
                break;
        }
    }

    /**
     * メニュー定義（コンテキストメニュー用）
     * 基本文章編集プラグインと同様の構造
     */
    async getMenuDefinition() {
        // 注: '閉じる'は親ウィンドウ（ContextMenuManager）が自動追加するため、ここには含めない
        const menuDef = [
            {
                label: '保存',
                submenu: [
                    { label: '元の実身に保存', action: 'save', shortcut: 'Ctrl+S' },
                    { label: '新たな実身に保存', action: 'save-as' }
                ]
            },
            {
                label: '表示',
                submenu: [
                    { label: '操作パネル表示オンオフ', action: 'toggle-operation-panel', checked: this.operationPanelVisible },
                    { separator: true },
                    { label: '全画面表示オンオフ', action: 'toggle-fullscreen', shortcut: 'Ctrl+L' },
                    { label: '再表示', action: 'refresh-view' },
                    { label: '背景色変更', action: 'change-bg-color' }
                ]
            },
            {
                label: '編集',
                submenu: [
                    { label: '切り取り', action: 'cut', shortcut: 'Ctrl+X' },
                    { label: 'コピー', action: 'copy', shortcut: 'Ctrl+C' },
                    { label: '貼り付け', action: 'paste', shortcut: 'Ctrl+V' },
                    { separator: true },
                    { label: 'セルをクリア', action: 'clear', shortcut: 'Delete' },
                    { separator: true },
                    { label: '行を挿入', action: 'insert-row' },
                    { label: '列を挿入', action: 'insert-col' },
                    { label: '行を削除', action: 'delete-row' },
                    { label: '列を削除', action: 'delete-col' },
                    { separator: true },
                    { label: '下方向にフィル', action: 'fill-down', shortcut: 'Ctrl+D' },
                    { label: '右方向にフィル', action: 'fill-right', shortcut: 'Ctrl+R' },
                    { separator: true },
                    { label: '検索/置換', action: 'find-replace', shortcut: 'Ctrl+F' },
                    { separator: true },
                    { label: 'セルを結合', action: 'merge-cells' },
                    { label: 'セル結合を解除', action: 'unmerge-cells' }
                ]
            },
            { label: '書体', action: 'show-font-menu', hasSubmenu: true },
            // 文字修飾、文字サイズ、文字色を先に追加
            { label: '文字修飾', action: 'show-text-decoration-menu', hasSubmenu: true },
            { label: '文字サイズ', action: 'show-font-size-menu', hasSubmenu: true },
            { label: '文字色', action: 'show-text-color-menu', hasSubmenu: true }
        ];

        // 仮身が選択されている場合は仮身操作・実身操作メニューを追加（文字色の下に表示）
        if (this.contextMenuVirtualObject) {
            const realId = this.contextMenuVirtualObject.realId;
            const isOpened = this.openedRealObjects ? this.openedRealObjects.has(realId) : false;

            // 仮身操作メニュー
            menuDef.push({
                label: '仮身操作',
                submenu: [
                    { label: '開く', action: 'open-real-object', disabled: isOpened },
                    { label: '閉じる', action: 'close-real-object', disabled: !isOpened },
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
                    { label: '仮身ネットワーク', action: 'open-virtual-object-network' },
                    { label: '実身/仮身検索', action: 'open-real-object-search' }
                ]
            });

            // 屑実身操作メニュー
            menuDef.push({
                label: '屑実身操作',
                action: 'open-trash-real-objects'
            });

            // 実行メニュー（applistからサブメニューを生成）
            try {
                const applistData = await this.getAppListData(realId);
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
                logger.error('[CalcEditor] applist取得エラー:', error);
            }
        }

        return menuDef;
    }

    /**
     * 選択中の仮身が指し示す実身をデフォルトアプリで開く
     * basic-figure-editorから移植
     */
    openRealObjectWithDefaultApp() {
        if (!this.contextMenuVirtualObject || !this.contextMenuVirtualObject.virtualObj) {
            logger.warn('[CalcEditor] 選択中の仮身がありません');
            return;
        }

        const selectedVirtualObject = this.contextMenuVirtualObject.virtualObj;

        const applist = selectedVirtualObject.applist;
        if (!applist || typeof applist !== 'object') {
            logger.warn('[CalcEditor] applistが存在しません');
            return;
        }

        // defaultOpen=trueのプラグインを探す
        let defaultPluginId = null;
        for (const [pluginId, config] of Object.entries(applist)) {
            if (config.defaultOpen === true) {
                defaultPluginId = pluginId;
                break;
            }
        }

        if (!defaultPluginId) {
            // defaultOpen=trueがない場合は最初のプラグインを使用
            defaultPluginId = Object.keys(applist)[0];
        }

        if (!defaultPluginId) {
            logger.warn('[CalcEditor] 開くためのプラグインが見つかりません');
            return;
        }

        // 実身を開く
        this.executeVirtualObjectWithPlugin(defaultPluginId);

        logger.debug('[CalcEditor] 実身を開く:', selectedVirtualObject.link_id, 'with', defaultPluginId);
    }

    /**
     * 選択された仮身の実身を指定されたプラグインで開く
     * basic-figure-editorから移植
     * @param {string} pluginId - 開くプラグインのID
     */
    async executeVirtualObjectWithPlugin(pluginId) {
        if (!this.contextMenuVirtualObject || !this.contextMenuVirtualObject.virtualObj) {
            logger.warn('[CalcEditor] 仮身が選択されていません');
            return;
        }

        const selectedVirtualObject = this.contextMenuVirtualObject.virtualObj;
        const realId = selectedVirtualObject.link_id;
        logger.debug('[CalcEditor] 仮身の実身を開く:', realId, 'プラグイン:', pluginId);

        // ウィンドウが開いた通知を受け取るハンドラー
        const messageId = `open-${realId}-${Date.now()}`;

        // 親ウィンドウ(tadjs-desktop.js)に実身を開くよう要求
        if (this.messageBus) {
            this.messageBus.send('open-virtual-object-real', {
                virtualObj: selectedVirtualObject,
                pluginId: pluginId,
                messageId: messageId
            });

            try {
                const result = await this.messageBus.waitFor('window-opened', window.LONG_OPERATION_TIMEOUT_MS, (data) => {
                    return data.messageId === messageId;
                });

                if (result.success && result.windowId) {
                    // 開いたウィンドウを追跡
                    this.openedRealObjects.set(realId, result.windowId);
                    logger.debug('[CalcEditor] ウィンドウが開きました:', result.windowId, 'realId:', realId);

                    // ウィンドウのアイコンを設定
                    const baseRealId = window.RealObjectSystem.extractRealId(realId);
                    const iconPath = `${baseRealId}.ico`;
                    if (this.messageBus) {
                        this.messageBus.send('set-window-icon', {
                            windowId: result.windowId,
                            iconPath: iconPath
                        });
                        logger.debug('[CalcEditor] ウィンドウアイコン設定要求:', result.windowId, iconPath);
                    }
                }
            } catch (error) {
                logger.error('[CalcEditor] ウィンドウ開起エラー:', error);
            }
        }
    }

    // closeRealObject() は基底クラス PluginBase で定義

    /**
     * ステータスメッセージを設定
     * @param {string} message - 表示するメッセージ
     */
    setStatus(message) {
        logger.debug('[CalcEditor] Status:', message);
        // 親ウィンドウにステータスメッセージを送信（PluginBaseの共通実装を呼び出し）
        super.setStatus(message);
    }

    /**
     * 仮身の属性変更
     */
    async changeVirtualObjectAttributes() {
        if (!this.contextMenuVirtualObject || !this.contextMenuVirtualObject.virtualObj) {
            logger.warn('[CalcEditor] 仮身が選択されていません');
            return;
        }

        // RealObjectSystemの共通メソッドを使用
        await window.RealObjectSystem.changeVirtualObjectAttributes(this);
    }

    /**
     * 仮身に属性を適用
     * @param {Object} attrs - 適用する属性値
     */
    applyVirtualObjectAttributes(attrs) {
        // contextMenuVirtualObjectからcellKeyを取得
        if (!this.contextMenuVirtualObject || !this.contextMenuVirtualObject.cellKey) {
            logger.warn('[CalcEditor] 仮身が選択されていません');
            return;
        }

        const cellKey = this.contextMenuVirtualObject.cellKey;
        const cellData = this.cells.get(cellKey);
        if (!cellData || !cellData.virtualObject) {
            logger.warn('[CalcEditor] 仮身が見つかりません:', cellKey);
            return;
        }

        const vobj = cellData.virtualObject;

        // PluginBaseの共通メソッドで属性を適用
        this._applyVobjAttrs(vobj, attrs);

        // 変更をマーク
        this.isModified = true;

        // セルを再描画
        const [col, row] = cellKey.split(',').map(Number);
        this.renderCell(col, row);

        logger.info('[CalcEditor] 仮身属性を適用しました:', cellKey);
    }

    /**
     * 続柄更新後の再描画（PluginBaseフック）
     */
    onRelationshipUpdated(virtualObj, result) {
        // contextMenuVirtualObjectからcellKeyを取得
        if (!this.contextMenuVirtualObject || !this.contextMenuVirtualObject.cellKey) {
            return;
        }

        const cellKey = this.contextMenuVirtualObject.cellKey;
        const cellData = this.cells.get(cellKey);
        if (!cellData || !cellData.virtualObject) {
            return;
        }

        // 変更をマーク
        this.isModified = true;

        // セルを再描画
        const [col, row] = cellKey.split(',').map(Number);
        this.renderCell(col, row);
    }

    /**
     * 実身名を変更
     * RealObjectSystemの共通メソッドを使用
     */
    async renameRealObject() {
        const result = await window.RealObjectSystem.renameRealObject(this);

        // 名前変更成功時、仮身の表示を更新
        if (result && result.success && this.contextMenuVirtualObject) {
            const cellKey = this.contextMenuVirtualObject.cellKey;
            if (cellKey) {
                const cellData = this.cells.get(cellKey);
                if (cellData && cellData.virtualObject) {
                    // 仮身の名前を更新
                    cellData.virtualObject.link_name = result.newName;
                    // セルを再描画
                    const [col, row] = cellKey.split(',').map(Number);
                    this.renderCell(col, row);
                }
            }
        }
    }

    /**
     * 実身を複製し、下のセルに配置
     */
    async duplicateRealObject() {
        if (!this.contextMenuVirtualObject || !this.contextMenuVirtualObject.virtualObj) {
            logger.warn('[CalcEditor] 選択中の仮身がありません');
            return;
        }

        const realId = this.contextMenuVirtualObject.realId;
        const originalVobj = this.contextMenuVirtualObject.virtualObj;
        const cellKey = this.contextMenuVirtualObject.cellKey;

        logger.info('[CalcEditor] 実身複製:', realId);

        // 親ウィンドウに実身複製を要求
        const messageId = this.generateMessageId('duplicate-real');

        this.messageBus.send('duplicate-real-object', {
            realId: realId,
            messageId: messageId
        });

        try {
            // レスポンスを待つ
            const result = await this.messageBus.waitFor('real-object-duplicated', 0, (data) => {
                return data.messageId === messageId;
            });

            if (result.success && result.newRealId) {
                logger.info('[CalcEditor] 実身複製成功:', realId, '->', result.newRealId);
                this.setStatus(`実身を複製しました: ${result.newName}`);

                // 現在のセル位置を取得
                const [col, row] = cellKey.split(',').map(Number);

                // 下のセルに新しい仮身を配置
                const targetRow = row + 1;

                // 新しい仮身オブジェクトを作成（元の仮身をベースに）
                const newVirtualObject = {
                    link_id: `${result.newRealId}_0.xtad`,
                    link_name: result.newName,
                    width: originalVobj.width || 150,
                    heightPx: originalVobj.heightPx || 30,
                    chsz: originalVobj.chsz || 14,
                    frcol: originalVobj.frcol || '#000000',
                    chcol: originalVobj.chcol || '#000000',
                    tbcol: originalVobj.tbcol || '#ffffff',
                    bgcol: originalVobj.bgcol || '#ffffff',
                    dlen: 0,
                    pictdisp: originalVobj.pictdisp || 'true',
                    namedisp: originalVobj.namedisp || 'true',
                    applist: originalVobj.applist || {}
                };

                // 下のセルを選択して仮身を挿入
                this.selectCell(col, targetRow);
                this.insertVirtualObject(newVirtualObject);

                // 変更をマーク
                this.isModified = true;

                logger.info(`[CalcEditor] 複製した仮身を${this.colToLetter(col)}${targetRow}に配置`);
            } else {
                logger.warn('[CalcEditor] 実身複製がキャンセルされました');
            }
        } catch (error) {
            logger.error('[CalcEditor] 実身複製エラー:', error);
            this.setStatus('実身の複製に失敗しました');
        }
    }

    /**
     * 屑実身操作ウィンドウを開く
     */
    openTrashRealObjects() {
        if (window.RealObjectSystem) {
            window.RealObjectSystem.openTrashRealObjects(this);
        }
    }

    /**
     * 仮身ネットワークウィンドウを開く
     */
    openVirtualObjectNetwork() {
        if (!this.contextMenuVirtualObject || !this.contextMenuVirtualObject.virtualObj) {
            logger.warn('[CalcEditor] 仮身が選択されていません');
            this.setStatus('仮身を選択してください');
            return;
        }

        // 実身IDを取得
        const realId = this.contextMenuVirtualObject.virtualObj.realId;
        if (!realId) {
            logger.warn('[CalcEditor] 実身IDが取得できません');
            this.setStatus('実身IDが取得できません');
            return;
        }

        if (window.RealObjectSystem) {
            window.RealObjectSystem.openVirtualObjectNetwork(this, realId);
        }
    }

    /**
     * 実身/仮身検索ウィンドウを開く
     */
    openRealObjectSearch() {
        if (window.RealObjectSystem) {
            window.RealObjectSystem.openRealObjectSearch(this);
        }
    }

    // ========================================
    // 検索/置換機能
    // ========================================

    /**
     * 検索/置換ウィンドウを開く
     */
    openFindReplaceWindow() {
        // 選択中のセルの値があれば初期検索文字列として使用
        let initialSearchText = '';
        if (this.selectedCell) {
            const key = `${this.selectedCell.col},${this.selectedCell.row}`;
            const cellData = this.cells.get(key);
            if (cellData && cellData.value && cellData.contentType !== 'virtualObject') {
                initialSearchText = cellData.value;
            }
        }

        // 検索/置換ウィンドウを開く
        this.messageBus.send('open-calc-find-replace-window', {
            initialSearchText: initialSearchText
        });
    }

    /**
     * セル内を検索
     * @param {string} searchText - 検索文字列
     * @param {boolean} isRegex - 正規表現モード
     */
    findInCells(searchText, isRegex) {
        if (!searchText) return;

        // 現在のセル位置から検索開始
        let startCol = 1;
        let startRow = 1;
        if (this.selectedCell) {
            startCol = this.selectedCell.col;
            startRow = this.selectedCell.row;
            // 次のセルから検索開始
            startCol++;
            if (startCol > this.defaultCols) {
                startCol = 1;
                startRow++;
            }
        }

        // 検索パターン
        let regex;
        try {
            regex = isRegex ? new RegExp(searchText) : null;
        } catch (e) {
            // 正規表現エラー
            this.messageBus.send('find-result', { found: false, error: e.message });
            return;
        }

        // 全セルを走査して検索
        const found = this.searchFromPosition(startCol, startRow, searchText, regex);

        if (!found) {
            // 先頭から再検索
            const foundFromStart = this.searchFromPosition(1, 1, searchText, regex, startCol, startRow);
            if (!foundFromStart) {
                this.messageBus.send('find-result', { found: false });
            }
        }
    }

    /**
     * 指定位置からセルを検索
     * @param {number} startCol - 開始列
     * @param {number} startRow - 開始行
     * @param {string} searchText - 検索文字列
     * @param {RegExp|null} regex - 正規表現オブジェクト
     * @param {number} limitCol - 検索終了列（オプション）
     * @param {number} limitRow - 検索終了行（オプション）
     * @returns {boolean} 見つかったかどうか
     */
    searchFromPosition(startCol, startRow, searchText, regex, limitCol = null, limitRow = null) {
        for (let row = startRow; row <= this.defaultRows; row++) {
            const colStart = (row === startRow) ? startCol : 1;
            for (let col = colStart; col <= this.defaultCols; col++) {
                // 制限位置に到達したら終了
                if (limitRow !== null && limitCol !== null) {
                    if (row > limitRow || (row === limitRow && col >= limitCol)) {
                        return false;
                    }
                }

                const key = `${col},${row}`;
                const cellData = this.cells.get(key);
                if (!cellData) continue;

                // 検索対象のテキストを決定
                let text = '';
                if (cellData.contentType === 'virtualObject' && cellData.virtualObject) {
                    // 仮身の場合は仮身名を検索
                    text = cellData.virtualObject.link_name || '';
                } else {
                    // 通常セルは値を検索
                    text = cellData.value || '';
                }

                if (!text) continue;

                // マッチ判定
                const matches = regex ? regex.test(text) : text.includes(searchText);
                if (matches) {
                    // セルを選択
                    this.selectCell(col, row);
                    this.messageBus.send('find-result', { found: true, cell: `${this.colToLetter(col)}${row}` });
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * 選択中のセルを置換して次を検索
     * @param {string} searchText - 検索文字列
     * @param {string} replaceText - 置換文字列
     * @param {boolean} isRegex - 正規表現モード
     */
    replaceInCells(searchText, replaceText, isRegex) {
        if (!searchText) return;

        // 現在選択中のセルが検索文字列を含むか確認
        if (this.selectedCell) {
            const key = `${this.selectedCell.col},${this.selectedCell.row}`;
            const cellData = this.cells.get(key);

            if (cellData && cellData.contentType !== 'virtualObject') {
                const text = cellData.value || '';

                let regex;
                try {
                    regex = isRegex ? new RegExp(searchText) : null;
                } catch (e) {
                    return;
                }

                const matches = regex ? regex.test(text) : text.includes(searchText);
                if (matches) {
                    // 置換実行
                    let newValue;
                    if (isRegex) {
                        newValue = text.replace(new RegExp(searchText, 'g'), replaceText);
                    } else {
                        newValue = text.split(searchText).join(replaceText);
                    }
                    this.setCellValue(this.selectedCell.col, this.selectedCell.row, newValue);
                    this.renderCell(this.selectedCell.col, this.selectedCell.row);
                    this.isModified = true;
                }
            }
        }

        // 次を検索
        this.findInCells(searchText, isRegex);
    }

    /**
     * 全セルを置換
     * @param {string} searchText - 検索文字列
     * @param {string} replaceText - 置換文字列
     * @param {boolean} isRegex - 正規表現モード
     */
    replaceAllInCells(searchText, replaceText, isRegex) {
        if (!searchText) return;

        let regex;
        try {
            regex = isRegex ? new RegExp(searchText, 'g') : null;
        } catch (e) {
            this.messageBus.send('find-result', { found: false, error: e.message });
            return;
        }

        let replaceCount = 0;

        // 全セルを走査
        for (const [key, cellData] of this.cells) {
            if (cellData.contentType === 'virtualObject') continue;

            const text = cellData.value || '';
            if (!text) continue;

            const matches = regex ? regex.test(text) : text.includes(searchText);
            if (matches) {
                // 置換実行
                let newValue;
                if (isRegex) {
                    // 正規表現の場合、gフラグで全置換
                    newValue = text.replace(new RegExp(searchText, 'g'), replaceText);
                } else {
                    newValue = text.split(searchText).join(replaceText);
                }

                // セル位置を取得
                const [col, row] = key.split(',').map(Number);
                this.setCellValue(col, row, newValue);
                this.renderCell(col, row);
                replaceCount++;
            }
        }

        if (replaceCount > 0) {
            this.isModified = true;
        }

        this.messageBus.send('find-result', { found: replaceCount > 0, replaceCount: replaceCount });
    }

    // ========================================
    // セル結合機能
    // ========================================

    /**
     * セルを結合
     * 選択範囲のセルを1つに結合する
     */
    mergeCells() {
        if (!this.selectionRange) {
            // 単一セル選択時は結合不可
            return;
        }

        const { startCol, startRow, endCol, endRow } = this.selectionRange;

        // 既に結合されているセルを含む場合はエラー
        for (let row = startRow; row <= endRow; row++) {
            for (let col = startCol; col <= endCol; col++) {
                if (this.isCellInMerge(col, row)) {
                    alert('選択範囲内に既に結合されているセルがあります');
                    return;
                }
            }
        }

        // 仮身を含むセルがある場合は警告
        for (let row = startRow; row <= endRow; row++) {
            for (let col = startCol; col <= endCol; col++) {
                const key = `${col},${row}`;
                const cellData = this.cells.get(key);
                if (cellData && cellData.contentType === 'virtualObject') {
                    alert('仮身を含むセルは結合できません');
                    return;
                }
            }
        }

        // 結合情報を作成
        const mergeKey = `${startCol},${startRow}`;
        const mergeInfo = { startCol, startRow, endCol, endRow };
        this.mergedCells.set(mergeKey, mergeInfo);

        // 起点セル（左上）に結合情報を設定
        const originKey = `${startCol},${startRow}`;
        let originCell = this.cells.get(originKey) || this.createEmptyCell();
        originCell.merge = {
            isMerged: true,
            isMergeOrigin: true,
            mergeRange: mergeInfo
        };
        this.cells.set(originKey, originCell);

        // 他のセルに結合情報を設定（値はクリア）
        for (let row = startRow; row <= endRow; row++) {
            for (let col = startCol; col <= endCol; col++) {
                if (col === startCol && row === startRow) continue;

                const key = `${col},${row}`;
                let cellData = this.cells.get(key) || this.createEmptyCell();
                cellData.merge = {
                    isMerged: true,
                    isMergeOrigin: false,
                    mergeOrigin: { col: startCol, row: startRow }
                };
                // 値をクリア（起点セルに統合）
                cellData.value = '';
                cellData.formula = '';
                cellData.displayValue = '';
                this.cells.set(key, cellData);
            }
        }

        // 結合セルをレンダリング
        this.renderMergedCells(mergeInfo);
        this.isModified = true;
    }

    /**
     * セル結合を解除
     * @param {number} col - 列番号
     * @param {number} row - 行番号
     */
    unmergeCells(col, row) {
        // 指定セルが結合に含まれているか確認
        const mergeInfo = this.getMergeInfoForCell(col, row);
        if (!mergeInfo) {
            return;
        }

        const { startCol, startRow, endCol, endRow } = mergeInfo;
        const mergeKey = `${startCol},${startRow}`;

        // 結合情報を削除
        this.mergedCells.delete(mergeKey);

        // 各セルの結合情報をクリア
        for (let r = startRow; r <= endRow; r++) {
            for (let c = startCol; c <= endCol; c++) {
                const key = `${c},${r}`;
                const cellData = this.cells.get(key);
                if (cellData && cellData.merge) {
                    delete cellData.merge;
                }
            }
        }

        // 結合解除後のセルをレンダリング
        this.renderUnmergedCells(mergeInfo);
        this.isModified = true;
    }

    /**
     * 選択範囲の結合を解除
     */
    unmergeSelectedCells() {
        if (this.selectedCell) {
            this.unmergeCells(this.selectedCell.col, this.selectedCell.row);
        }
    }

    /**
     * 空のセルデータを作成
     * @returns {Object} 空のセルデータ
     */
    createEmptyCell() {
        return {
            value: '',
            formula: '',
            displayValue: '',
            style: {},
            virtualObject: null,
            contentType: 'text'
        };
    }

    /**
     * セルが結合に含まれているか確認
     * @param {number} col - 列番号
     * @param {number} row - 行番号
     * @returns {boolean} 結合に含まれているかどうか
     */
    isCellInMerge(col, row) {
        const key = `${col},${row}`;
        const cellData = this.cells.get(key);
        return cellData && cellData.merge && cellData.merge.isMerged;
    }

    /**
     * セルが結合の起点かどうか確認
     * @param {number} col - 列番号
     * @param {number} row - 行番号
     * @returns {boolean} 結合の起点かどうか
     */
    isMergeOrigin(col, row) {
        const key = `${col},${row}`;
        const cellData = this.cells.get(key);
        return cellData && cellData.merge && cellData.merge.isMergeOrigin;
    }

    /**
     * セルの結合情報を取得
     * @param {number} col - 列番号
     * @param {number} row - 行番号
     * @returns {Object|null} 結合情報 {startCol, startRow, endCol, endRow}
     */
    getMergeInfoForCell(col, row) {
        const key = `${col},${row}`;
        const cellData = this.cells.get(key);
        if (!cellData || !cellData.merge) {
            return null;
        }

        if (cellData.merge.isMergeOrigin) {
            return cellData.merge.mergeRange;
        } else if (cellData.merge.mergeOrigin) {
            const originKey = `${cellData.merge.mergeOrigin.col},${cellData.merge.mergeOrigin.row}`;
            const originCell = this.cells.get(originKey);
            if (originCell && originCell.merge) {
                return originCell.merge.mergeRange;
            }
        }
        return null;
    }

    /**
     * 結合の起点セルを取得
     * @param {number} col - 列番号
     * @param {number} row - 行番号
     * @returns {Object|null} 起点セル {col, row}
     */
    getMergeOrigin(col, row) {
        const key = `${col},${row}`;
        const cellData = this.cells.get(key);
        if (!cellData || !cellData.merge) {
            return null;
        }

        if (cellData.merge.isMergeOrigin) {
            return { col, row };
        } else if (cellData.merge.mergeOrigin) {
            return cellData.merge.mergeOrigin;
        }
        return null;
    }

    /**
     * 結合セルをレンダリング
     * @param {Object} mergeInfo - 結合情報
     */
    renderMergedCells(mergeInfo) {
        const { startCol, startRow, endCol, endRow } = mergeInfo;

        // 起点以外のセルを非表示
        for (let row = startRow; row <= endRow; row++) {
            for (let col = startCol; col <= endCol; col++) {
                const cell = this.getCellElement(col, row);
                if (!cell) continue;

                if (col === startCol && row === startRow) {
                    // 起点セル: サイズを拡大
                    let totalWidth = 0;
                    let totalHeight = 0;
                    for (let c = startCol; c <= endCol; c++) {
                        totalWidth += this.getColumnWidth(c);
                    }
                    for (let r = startRow; r <= endRow; r++) {
                        totalHeight += this.getRowHeight(r);
                    }
                    cell.style.width = totalWidth + 'px';
                    cell.style.minWidth = totalWidth + 'px';
                    cell.style.height = totalHeight + 'px';
                    cell.classList.add('merged-origin');
                    this.renderCell(col, row);
                } else {
                    // 結合されたセル: 非表示
                    cell.style.display = 'none';
                    cell.classList.add('merged-hidden');
                }
            }
        }
    }

    /**
     * 結合解除後のセルをレンダリング
     * @param {Object} mergeInfo - 結合情報
     */
    renderUnmergedCells(mergeInfo) {
        const { startCol, startRow, endCol, endRow } = mergeInfo;

        for (let row = startRow; row <= endRow; row++) {
            for (let col = startCol; col <= endCol; col++) {
                const cell = this.getCellElement(col, row);
                if (!cell) continue;

                // サイズと表示をリセット
                cell.style.display = '';
                cell.style.width = this.getColumnWidth(col) + 'px';
                cell.style.minWidth = this.getColumnWidth(col) + 'px';
                cell.style.height = this.getRowHeight(row) + 'px';
                cell.classList.remove('merged-origin', 'merged-hidden');
                this.renderCell(col, row);
            }
        }
    }

    /**
     * 画像ファイルをセルに挿入
     * @param {File[]} imageFiles - 画像ファイル配列
     * @param {Object} startCell - 開始セル { col, row }
     */
    async insertImageFilesToCells(imageFiles, startCell) {
        logger.info('[CalcEditor] insertImageFilesToCells開始:', imageFiles.length, '個の画像');

        let currentCol = startCell.col;
        const row = startCell.row;
        let imageIndex = 0;

        for (const file of imageFiles) {
            try {
                const ext = file.name.split('.').pop().toLowerCase();
                const baseName = file.name.replace(/\.[^.]+$/, '');

                // 画像をData URLとして読み込み
                const dataUrl = await this.readFileAsDataUrl(file);

                // 画像のサイズを取得
                const imageSize = await this.getImageDimensions(dataUrl);

                // 画像ファイル名を生成（realId_recordNo_imgNo.ext形式）
                // recordNo = 0（表計算は単一レコード）、imgNoは既存画像の最大値+1
                const imgNo = this.getNextImageNumber();
                const imageFileName = `${this.realId}_0_${imgNo}.${ext}`;

                // 画像ファイルを保存（PluginBase共通メソッド使用）
                await this.saveImageFile(dataUrl, imageFileName);

                // 画像情報を作成
                const imageInfo = {
                    href: imageFileName,
                    name: baseName,
                    src: dataUrl, // 表示用にData URLを保持
                    dataUrl: dataUrl,
                    left: 0,
                    top: 0,
                    right: imageSize.width,
                    bottom: imageSize.height,
                    originalWidth: imageSize.width,
                    originalHeight: imageSize.height,
                    l_atr: '1',
                    l_pat: '0',
                    f_pat: '1',
                    angle: 0,
                    rotation: 0,
                    flipH: false,
                    flipV: false
                };

                // セルに画像を設定
                const key = `${currentCol},${row}`;
                const cellData = {
                    value: '',
                    formula: '',
                    displayValue: '',
                    style: {},
                    imageInfo: imageInfo,
                    contentType: 'image'
                };

                this.cells.set(key, cellData);
                this.renderCell(currentCol, row);

                logger.info(`[CalcEditor] 画像セル追加: ${this.colToLetter(currentCol)}${row}, ${imageFileName}`);

                // 次の列へ
                currentCol++;
                imageIndex++;

            } catch (error) {
                logger.error('[CalcEditor] 画像ファイル処理エラー:', file.name, error);
            }
        }

        // 変更フラグを立てる
        this.isModified = true;

        logger.info('[CalcEditor] insertImageFilesToCells完了');
    }

    /**
     * ファイルをData URLとして読み込む
     * @param {File} file - ファイル
     * @returns {Promise<string>} Data URL
     */
    readFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('ファイル読み込みエラー'));
            reader.readAsDataURL(file);
        });
    }

    /**
     * Data URLから画像のサイズを取得
     * @param {string} dataUrl - Data URL
     * @returns {Promise<{width: number, height: number}>}
     */
    getImageDimensions(dataUrl) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                resolve({ width: img.width, height: img.height });
            };
            img.onerror = () => {
                reject(new Error('画像読み込みエラー'));
            };
            img.src = dataUrl;
        });
    }

    // saveImageFile, deleteImageFile は PluginBase の共通実装を使用

    /**
     * 次の画像番号を取得
     * 既存の画像セルから最大のimgNoを探し、+1を返す
     * @returns {number} 次の画像番号
     */
    getNextImageNumber() {
        let maxImgNo = -1;

        // 全セルを走査して画像セルのimgNoを取得
        this.cells.forEach((cellData) => {
            if (cellData.contentType === 'image' && cellData.imageInfo && cellData.imageInfo.href) {
                // href形式: realId_recordNo_imgNo.ext
                const match = cellData.imageInfo.href.match(/_(\d+)\.[^.]+$/);
                if (match) {
                    const imgNo = parseInt(match[1]);
                    if (!isNaN(imgNo) && imgNo > maxImgNo) {
                        maxImgNo = imgNo;
                    }
                }
            }
        });

        return maxImgNo + 1;
    }

    /**
     * 画像ファイルの絶対パスを取得（非同期）
     * @param {string} fileName - ファイル名
     * @returns {Promise<string>} 絶対パス
     */
    getImageFilePath(fileName) {
        return new Promise((resolve, reject) => {
            const messageId = `img_${this.imagePathMessageId++}`;

            // コールバックを登録
            this.imagePathCallbacks[messageId] = (filePath) => {
                resolve(filePath);
            };

            // タイムアウト設定（5秒）
            setTimeout(() => {
                if (this.imagePathCallbacks[messageId]) {
                    delete this.imagePathCallbacks[messageId];
                    reject(new Error('画像パス取得タイムアウト'));
                }
            }, 5000);

            this.messageBus.send('get-image-file-path', {
                messageId: messageId,
                fileName: fileName
            });
        });
    }

    /**
     * ドロップされたファイルを読み込んで親ウィンドウに送信
     * @param {File[]} files - ファイル配列
     * @param {number} clientX - ドロップ位置X
     * @param {number} clientY - ドロップ位置Y
     * @param {Object} targetCell - ドロップ先セル { col, row }
     */
    async readAndSendFiles(files, clientX, clientY, targetCell) {
        const fileDataList = [];

        for (const file of files) {
            try {
                // ファイル内容をArrayBufferとして読み込み
                const arrayBuffer = await file.arrayBuffer();
                const uint8Array = new Uint8Array(arrayBuffer);

                // Base64に変換
                let binary = '';
                const chunkSize = 8192;
                for (let i = 0; i < uint8Array.length; i += chunkSize) {
                    const chunk = uint8Array.subarray(i, Math.min(i + chunkSize, uint8Array.length));
                    binary += String.fromCharCode.apply(null, chunk);
                }
                const base64 = btoa(binary);

                fileDataList.push({
                    name: file.name,
                    type: file.type || 'application/octet-stream',
                    size: file.size,
                    data: base64
                });
            } catch (error) {
                logger.error('[CalcEditor] ファイル読み込みエラー:', file.name, error);
            }
        }

        if (fileDataList.length > 0) {
            this.messageBus.send('files-dropped-on-plugin', {
                files: fileDataList,
                clientX: clientX,
                clientY: clientY,
                targetCell: targetCell,
                windowId: this.windowId
            });
        }
    }

    /**
     * 仮身を挿入
     * @param {Object} virtualObject - 仮身オブジェクト（完全な情報を含む）
     */
    insertVirtualObject(virtualObject) {
        if (!this.selectedCell) {
            logger.warn('[CalcEditor] セルが選択されていません');
            return;
        }

        const { col, row } = this.selectedCell;
        const realId = window.RealObjectSystem.extractRealId(virtualObject.link_id);
        logger.info(`[CalcEditor] 仮身挿入: ${this.colToLetter(col)}${row}, realId: ${realId}`);

        // セルに仮身データを設定
        const key = `${col},${row}`;
        let cellData = this.cells.get(key) || {
            value: '',
            formula: '',
            displayValue: '',
            style: {},
            virtualObject: null,
            contentType: 'text'
        };

        // 仮身オブジェクトをそのまま保存（VirtualObjectRendererが必要とする全プロパティを保持）
        // contentTypeを'virtualObject'に変更
        cellData.contentType = 'virtualObject';
        cellData.virtualObject = virtualObject;
        cellData.value = ''; // 仮身セルは値を持たない
        cellData.formula = '';
        cellData.displayValue = '';

        this.cells.set(key, cellData);

        // 変更フラグを立てる
        this.isModified = true;

        // メタデータをJSONから読み込み（続柄、更新日時など）、完了後に再レンダリング
        this.loadVirtualObjectMetadata(virtualObject).then(() => {
            this.renderCell(col, row);
            logger.info('[CalcEditor] 仮身挿入完了（メタデータ読み込み完了）');
        });
    }

    /**
     * 原紙箱から仮身を追加
     * @param {string} realId - 実身ID
     * @param {string} name - 表示名
     * @param {Object} targetCell - 対象セル { col, row }
     * @param {Object} applist - アプリリスト
     */
    addVirtualObjectFromRealId(realId, name, targetCell, applist) {
        logger.debug('[CalcEditor] 原紙箱から仮身を追加:', name, 'at', targetCell);

        // メニュー文字サイズを取得（ユーザ環境設定から）
        const menuFontSize = localStorage.getItem('menu-font-size') || '14';
        const chsz = parseFloat(menuFontSize);

        // デフォルト値で仮身オブジェクトを作成
        const virtualObj = {
            link_id: realId,
            link_name: name,
            width: 150,
            heightPx: 30,
            chsz: chsz,  // メニュー文字サイズを使用
            frcol: '#000000',
            chcol: '#000000',
            tbcol: '#ffffff',
            bgcol: '#ffffff',
            dlen: 0,
            pictdisp: 'true',  // ピクトグラムを表示
            namedisp: 'true',  // 名称を表示
            applist: applist || {}
        };

        // 対象セルを選択して仮身を挿入
        if (targetCell) {
            this.selectCell(targetCell.col, targetCell.row);
        }
        this.insertVirtualObject(virtualObj);

        logger.debug('[CalcEditor] 原紙箱から仮身追加完了');
    }

    /**
     * セル内仮身が開いた仮身かどうかを判定
     * @param {Object} virtualObject - 仮身オブジェクト
     * @returns {boolean} 開いた仮身ならtrue
     */
    isOpenedVirtualObjectInCell(virtualObject) {
        // 明示的なopenedプロパティがあればそれを優先
        if (virtualObject.opened !== undefined) {
            return virtualObject.opened === true;
        }

        // heightPxベースの判定（セル内仮身用）
        const heightPx = virtualObject.heightPx || 30;
        const chsz = parseFloat(virtualObject.chsz) || 14;

        // 閉じた仮身の最小高さを計算（chszはポイント値なのでピクセルに変換）
        const chszPx = window.convertPtToPx ? window.convertPtToPx(chsz) : chsz * 1.333;
        const lineHeight = 1.2;
        const textHeight = Math.ceil(chszPx * lineHeight);
        const minClosedHeight = textHeight + 8;

        // 開いた仮身の閾値（タイトルバー + 区切り線 + コンテンツ最小）
        const minOpenHeight = textHeight + 30;

        // 閾値以上なら開いた仮身と判定
        return heightPx >= minOpenHeight;
    }

    /**
     * デフォルトオープンプラグインを取得
     * @param {Object} virtualObject - 仮身オブジェクト
     * @returns {string|null} プラグインID
     */
    getDefaultOpenPlugin(virtualObject) {
        const applist = virtualObject.applist || {};
        for (const [pluginId, config] of Object.entries(applist)) {
            if (config && config.defaultOpen === true) {
                return pluginId;
            }
        }
        // デフォルトは基本文章編集
        return 'basic-text-editor';
    }

    /**
     * 開いた仮身に実身の内容を表示
     * @param {HTMLElement} vobjElement - 仮身のDOM要素
     * @param {Object} virtualObject - 仮身オブジェクト
     * @param {string} cellKey - セルキー
     * @returns {Promise<HTMLIFrameElement>} コンテンツiframe
     */
    async expandVirtualObjectInCell(vobjElement, virtualObject, cellKey) {
        logger.debug('[CalcEditor] 開いた仮身の展開開始:', virtualObject.link_name);

        try {
            // 実身IDを取得
            const linkId = virtualObject.link_id;
            const realId = window.RealObjectSystem.extractRealId(linkId);

            // 1. defaultOpenプラグインを取得
            const defaultOpenPlugin = this.getDefaultOpenPlugin(virtualObject);
            if (!defaultOpenPlugin) {
                logger.warn('[CalcEditor] defaultOpenプラグインが見つかりません');
                return null;
            }

            // 2. 実身データを読み込む（PluginBase継承メソッド使用）
            const realObjectData = await this.loadRealObjectData(realId);
            if (!realObjectData) {
                logger.warn('[CalcEditor] 実身データの読み込みに失敗しました, realId:', realId);
                return null;
            }

            // 3. コンテンツ領域を取得
            const contentArea = vobjElement.querySelector('.virtual-object-content-area');
            if (!contentArea) {
                logger.error('[CalcEditor] コンテンツ領域が見つかりません');
                return null;
            }

            // コンテンツ領域のスクロールバーを非表示
            contentArea.style.overflow = 'hidden';
            contentArea.style.pointerEvents = 'none';
            contentArea.style.userSelect = 'none';

            // 仮身の背景色を取得
            const bgcol = virtualObject.bgcol || '#ffffff';

            // 4. プラグインをiframeで読み込む
            const iframe = document.createElement('iframe');
            iframe.className = 'virtual-object-content';
            iframe.style.width = '100%';
            iframe.style.height = '100%';
            iframe.style.border = 'none';
            iframe.style.overflow = 'hidden';
            iframe.style.padding = '0';
            iframe.style.backgroundColor = bgcol;
            iframe.style.userSelect = 'none';
            iframe.style.pointerEvents = 'none'; // 開いた仮身内の操作を無効化
            iframe.style.webkitUserDrag = 'none';
            iframe.setAttribute('draggable', 'false');
            iframe.src = `../../plugins/${defaultOpenPlugin}/index.html`;

            // iframeロード後にデータを送信
            iframe.addEventListener('load', () => {
                logger.debug('[CalcEditor] iframe読み込み完了、プラグインにload-virtual-objectメッセージ送信');
                iframe.contentWindow.postMessage({
                    type: 'load-virtual-object',
                    virtualObj: virtualObject,
                    realObject: realObjectData,
                    bgcol: bgcol,
                    readonly: true,
                    noScrollbar: true
                }, '*');
            });

            contentArea.appendChild(iframe);

            // セルデータに展開状態を保存
            const cellData = this.cells.get(cellKey);
            if (cellData) {
                cellData.expanded = true;
                cellData.expandedElement = iframe;
            }

            return iframe;
        } catch (error) {
            logger.error('[CalcEditor] expandVirtualObjectInCell エラー:', error);
            return null;
        }
    }

    /**
     * 仮身を選択状態にする
     * @param {number} col - 列番号
     * @param {number} row - 行番号
     */
    selectVirtualObject(col, row) {
        const key = `${col},${row}`;
        const cellData = this.cells.get(key);

        // 仮身セルでない場合は何もしない
        if (!cellData || cellData.contentType !== 'virtualObject' || !cellData.virtualObject) {
            return;
        }

        // 既に選択中の仮身があれば解除
        if (this.selectedVirtualObjectCell) {
            this.deselectVirtualObject();
        }

        // 選択状態を設定
        this.selectedVirtualObjectCell = { col, row };

        // 仮身要素に選択クラスを追加
        const cell = this.getCellElement(col, row);
        if (cell) {
            const vobjElement = cell.querySelector('.virtual-object-in-cell');
            if (vobjElement) {
                vobjElement.classList.add('selected');
                // リサイズ機能を有効化
                this.makeVirtualObjectResizable(vobjElement, col, row);
            }
        }

        logger.debug(`[CalcEditor] 仮身選択: ${this.colToLetter(col)}${row}`);
    }

    /**
     * 仮身の選択を解除する
     */
    deselectVirtualObject() {
        if (!this.selectedVirtualObjectCell) {
            return;
        }

        const { col, row } = this.selectedVirtualObjectCell;
        const cell = this.getCellElement(col, row);

        if (cell) {
            const vobjElement = cell.querySelector('.virtual-object-in-cell');
            if (vobjElement) {
                vobjElement.classList.remove('selected');
                // リサイズハンドラを削除
                this.removeVirtualObjectResizeHandlers(vobjElement);
            }
        }

        logger.debug(`[CalcEditor] 仮身選択解除: ${this.colToLetter(col)}${row}`);
        this.selectedVirtualObjectCell = null;
    }

    /**
     * 画像を選択状態にする
     * @param {number} col - 列番号
     * @param {number} row - 行番号
     */
    selectImage(col, row) {
        const key = `${col},${row}`;
        const cellData = this.cells.get(key);

        // 画像セルでない場合は何もしない
        if (!cellData || cellData.contentType !== 'image' || !cellData.imageInfo) {
            return;
        }

        // 既に選択中の画像があれば解除
        if (this.selectedImageCell) {
            this.deselectImage();
        }

        // 仮身選択も解除
        if (this.selectedVirtualObjectCell) {
            this.deselectVirtualObject();
        }

        // 選択状態を設定
        this.selectedImageCell = { col, row };

        // 画像要素に選択クラスを追加
        const cell = this.getCellElement(col, row);
        if (cell) {
            const imageContainer = cell.querySelector('.image-in-cell');
            if (imageContainer) {
                imageContainer.classList.add('selected');
                // リサイズ機能を有効化
                this.makeImageResizable(imageContainer, col, row);
            }
        }
    }

    /**
     * 画像の選択を解除する
     */
    deselectImage() {
        if (!this.selectedImageCell) {
            return;
        }

        const { col, row } = this.selectedImageCell;
        const cell = this.getCellElement(col, row);

        if (cell) {
            const imageContainer = cell.querySelector('.image-in-cell');
            if (imageContainer) {
                imageContainer.classList.remove('selected');
                // リサイズハンドラを削除
                this.removeImageResizeHandlers(imageContainer);
            }
        }

        this.selectedImageCell = null;
    }

    /**
     * 仮身のリサイズハンドラを削除
     * @param {HTMLElement} vobjElement - 仮身要素
     */
    removeVirtualObjectResizeHandlers(vobjElement) {
        if (vobjElement._resizeMousemoveHandler) {
            vobjElement.removeEventListener('mousemove', vobjElement._resizeMousemoveHandler);
            vobjElement._resizeMousemoveHandler = null;
        }
        if (vobjElement._resizeMouseleaveHandler) {
            vobjElement.removeEventListener('mouseleave', vobjElement._resizeMouseleaveHandler);
            vobjElement._resizeMouseleaveHandler = null;
        }
        if (vobjElement._resizeMousedownHandler) {
            vobjElement.removeEventListener('mousedown', vobjElement._resizeMousedownHandler);
            vobjElement._resizeMousedownHandler = null;
        }
        // カーソルをリセット
        vobjElement.style.cursor = '';
    }

    /**
     * 仮身要素をリサイズ可能にする
     * @param {HTMLElement} vobjElement - 仮身要素
     * @param {number} col - 列番号
     * @param {number} row - 行番号
     */
    makeVirtualObjectResizable(vobjElement, col, row) {
        // 重複登録を防ぐため、既存のリサイズハンドラーをクリーンアップ
        this.removeVirtualObjectResizeHandlers(vobjElement);

        // マウス移動でカーソルを変更（リサイズエリアの表示）
        const mousemoveHandler = (e) => {
            // リサイズ中は何もしない
            if (this.isResizingVirtualObject) {
                return;
            }

            const rect = vobjElement.getBoundingClientRect();
            // リサイズエリア：枠の内側8pxから外側4pxまで
            const isRightEdge = e.clientX > rect.right - 8 && e.clientX <= rect.right + 4;
            const isBottomEdge = e.clientY > rect.bottom - 8 && e.clientY <= rect.bottom + 4;

            // カーソルの形状を変更
            if (isRightEdge && isBottomEdge) {
                vobjElement.style.cursor = 'nwse-resize'; // 右下: 斜めリサイズ
            } else if (isRightEdge) {
                vobjElement.style.cursor = 'ew-resize'; // 右: 横リサイズ
            } else if (isBottomEdge) {
                vobjElement.style.cursor = 'ns-resize'; // 下: 縦リサイズ
            } else {
                vobjElement.style.cursor = 'move'; // 通常: 移動カーソル
            }
        };

        // マウスが仮身から離れたらカーソルを元に戻す
        const mouseleaveHandler = () => {
            if (!this.isResizingVirtualObject) {
                vobjElement.style.cursor = 'move';
            }
        };

        // マウスダウンでリサイズ開始
        const mousedownHandler = (e) => {
            const rect = vobjElement.getBoundingClientRect();
            // リサイズエリア：枠の内側8pxから外側4pxまで
            const isRightEdge = e.clientX > rect.right - 8 && e.clientX <= rect.right + 4;
            const isBottomEdge = e.clientY > rect.bottom - 8 && e.clientY <= rect.bottom + 4;

            // リサイズエリア以外のクリックは無視
            if (!isRightEdge && !isBottomEdge) {
                return;
            }

            // 左クリックのみ処理
            if (e.button !== 0) {
                return;
            }

            // リサイズ中は新しいリサイズを開始しない
            if (this.isResizingVirtualObject) {
                return;
            }

            e.preventDefault();
            e.stopPropagation();

            // draggableを無効化
            vobjElement.setAttribute('draggable', 'false');

            // リサイズ開始フラグを設定
            this.isResizingVirtualObject = true;

            // リサイズモード開始
            const startX = e.clientX;
            const startY = e.clientY;
            // 仮身要素の現在のサイズを取得（セルサイズではなく仮身サイズ）
            const vobjRect = vobjElement.getBoundingClientRect();
            const startWidth = Math.round(vobjRect.width);
            const startHeight = Math.round(vobjRect.height);
            const minWidth = 24;  // 最小幅（アイコンサイズ程度）
            const minHeight = 16; // 最小高さ

            // リサイズプレビュー枠を作成（仮身要素の位置に表示）
            const previewBox = document.createElement('div');
            previewBox.style.position = 'fixed';
            previewBox.style.left = `${vobjRect.left}px`;
            previewBox.style.top = `${vobjRect.top}px`;
            previewBox.style.width = `${startWidth}px`;
            previewBox.style.height = `${startHeight}px`;
            previewBox.style.border = '2px dashed rgba(255, 143, 0, 0.8)';
            previewBox.style.backgroundColor = 'rgba(255, 143, 0, 0.1)';
            previewBox.style.pointerEvents = 'none';
            previewBox.style.zIndex = '999999';
            previewBox.style.boxSizing = 'border-box';
            document.body.appendChild(previewBox);

            let currentWidth = startWidth;
            let currentHeight = startHeight;

            const onMouseMove = (moveEvent) => {
                if (isRightEdge) {
                    const deltaX = moveEvent.clientX - startX;
                    currentWidth = Math.max(minWidth, startWidth + deltaX);
                    previewBox.style.width = `${currentWidth}px`;
                }

                if (isBottomEdge) {
                    const deltaY = moveEvent.clientY - startY;
                    currentHeight = Math.max(minHeight, startHeight + deltaY);
                    previewBox.style.height = `${currentHeight}px`;
                }
            };

            const onMouseUp = () => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);

                // プレビュー枠を削除
                if (previewBox && previewBox.parentNode) {
                    previewBox.parentNode.removeChild(previewBox);
                }

                // カーソルを元に戻す
                vobjElement.style.cursor = 'move';

                // 最終的なサイズを取得
                const finalWidth = Math.round(currentWidth);
                const finalHeight = Math.round(currentHeight);

                // 仮身オブジェクトのサイズを更新（セルサイズは変更しない）
                const key = `${col},${row}`;
                const cellData = this.cells.get(key);
                if (cellData && cellData.virtualObject) {
                    // 開いた/閉じた状態の判定（リサイズ前）
                    const wasOpened = this.isOpenedVirtualObjectInCell(cellData.virtualObject);

                    if (isRightEdge && finalWidth !== startWidth) {
                        cellData.virtualObject.width = finalWidth;
                    }
                    if (isBottomEdge && finalHeight !== startHeight) {
                        cellData.virtualObject.heightPx = finalHeight;
                    }

                    // 開いた/閉じた状態の判定（リサイズ後）
                    const isNowOpened = this.isOpenedVirtualObjectInCell(cellData.virtualObject);

                    // 状態が変わった場合は展開状態をリセット
                    if (wasOpened !== isNowOpened) {
                        logger.debug('[CalcEditor] 開いた/閉じた仮身の状態が変わりました:', wasOpened, '->', isNowOpened);
                        cellData.expanded = false;
                        cellData.expandedElement = null;
                        cellData.expandError = false;
                    }
                }

                // セル表示を更新（仮身サイズのみ変更、セルサイズは変更しない）
                if (finalWidth !== startWidth || finalHeight !== startHeight) {
                    this.renderCell(col, row);
                    this.isModified = true;

                    // 仮身を再選択
                    setTimeout(() => {
                        this.selectVirtualObject(col, row);
                    }, 10);
                }

                // draggableを再び有効化
                vobjElement.setAttribute('draggable', 'true');

                // リサイズ終了フラグをリセット
                this.isResizingVirtualObject = false;
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        };

        // ハンドラを登録して参照を保存
        vobjElement.addEventListener('mousemove', mousemoveHandler);
        vobjElement._resizeMousemoveHandler = mousemoveHandler;

        vobjElement.addEventListener('mouseleave', mouseleaveHandler);
        vobjElement._resizeMouseleaveHandler = mouseleaveHandler;

        vobjElement.addEventListener('mousedown', mousedownHandler, true); // キャプチャフェーズで先にリサイズ判定
        vobjElement._resizeMousedownHandler = mousedownHandler;
    }

    /**
     * 画像のリサイズハンドラを削除
     * @param {HTMLElement} containerElement - 画像コンテナ要素
     */
    removeImageResizeHandlers(containerElement) {
        if (containerElement._resizeMousemoveHandler) {
            containerElement.removeEventListener('mousemove', containerElement._resizeMousemoveHandler);
            containerElement._resizeMousemoveHandler = null;
        }
        if (containerElement._resizeMouseleaveHandler) {
            containerElement.removeEventListener('mouseleave', containerElement._resizeMouseleaveHandler);
            containerElement._resizeMouseleaveHandler = null;
        }
        if (containerElement._resizeMousedownHandler) {
            containerElement.removeEventListener('mousedown', containerElement._resizeMousedownHandler, true);
            containerElement._resizeMousedownHandler = null;
        }
        // カーソルをリセット
        containerElement.style.cursor = '';
    }

    /**
     * 画像要素をリサイズ可能にする
     * @param {HTMLElement} containerElement - 画像コンテナ要素
     * @param {number} col - 列番号
     * @param {number} row - 行番号
     */
    makeImageResizable(containerElement, col, row) {
        // 重複登録を防ぐため、既存のリサイズハンドラーをクリーンアップ
        this.removeImageResizeHandlers(containerElement);

        // マウス移動でカーソルを変更（リサイズエリアの表示）
        const mousemoveHandler = (e) => {
            // リサイズ中は何もしない
            if (this.isResizingImage) {
                return;
            }

            const rect = containerElement.getBoundingClientRect();
            // リサイズエリア：枠の内側8pxから外側4pxまで
            const isRightEdge = e.clientX > rect.right - 8 && e.clientX <= rect.right + 4;
            const isBottomEdge = e.clientY > rect.bottom - 8 && e.clientY <= rect.bottom + 4;

            // カーソルの形状を変更
            if (isRightEdge && isBottomEdge) {
                containerElement.style.cursor = 'nwse-resize'; // 右下: 斜めリサイズ
            } else if (isRightEdge) {
                containerElement.style.cursor = 'ew-resize'; // 右: 横リサイズ
            } else if (isBottomEdge) {
                containerElement.style.cursor = 'ns-resize'; // 下: 縦リサイズ
            } else {
                containerElement.style.cursor = 'pointer'; // 通常: ポインタ
            }
        };

        // マウスがコンテナから離れたらカーソルを元に戻す
        const mouseleaveHandler = () => {
            if (!this.isResizingImage) {
                containerElement.style.cursor = 'pointer';
            }
        };

        // マウスダウンでリサイズ開始
        const mousedownHandler = (e) => {
            const rect = containerElement.getBoundingClientRect();
            // リサイズエリア：枠の内側8pxから外側4pxまで
            const isRightEdge = e.clientX > rect.right - 8 && e.clientX <= rect.right + 4;
            const isBottomEdge = e.clientY > rect.bottom - 8 && e.clientY <= rect.bottom + 4;

            // リサイズエリア以外のクリックは無視
            if (!isRightEdge && !isBottomEdge) {
                return;
            }

            // 左クリックのみ処理
            if (e.button !== 0) {
                return;
            }

            // リサイズ中は新しいリサイズを開始しない
            if (this.isResizingImage) {
                return;
            }

            e.preventDefault();
            e.stopPropagation();

            // リサイズ開始フラグを設定
            this.isResizingImage = true;

            // リサイズモード開始
            const startX = e.clientX;
            const startY = e.clientY;
            // コンテナ要素の現在のサイズを取得
            const containerRect = containerElement.getBoundingClientRect();
            const startWidth = Math.round(containerRect.width);
            const startHeight = Math.round(containerRect.height);
            const minWidth = 24;  // 最小幅
            const minHeight = 24; // 最小高さ

            // リサイズプレビュー枠を作成
            const previewBox = document.createElement('div');
            previewBox.style.position = 'fixed';
            previewBox.style.left = `${containerRect.left}px`;
            previewBox.style.top = `${containerRect.top}px`;
            previewBox.style.width = `${startWidth}px`;
            previewBox.style.height = `${startHeight}px`;
            previewBox.style.border = '2px dashed rgba(255, 143, 0, 0.8)';
            previewBox.style.backgroundColor = 'rgba(255, 143, 0, 0.1)';
            previewBox.style.pointerEvents = 'none';
            previewBox.style.zIndex = '999999';
            previewBox.style.boxSizing = 'border-box';
            document.body.appendChild(previewBox);

            let currentWidth = startWidth;
            let currentHeight = startHeight;

            const onMouseMove = (moveEvent) => {
                if (isRightEdge) {
                    const deltaX = moveEvent.clientX - startX;
                    currentWidth = Math.max(minWidth, startWidth + deltaX);
                    previewBox.style.width = `${currentWidth}px`;
                }

                if (isBottomEdge) {
                    const deltaY = moveEvent.clientY - startY;
                    currentHeight = Math.max(minHeight, startHeight + deltaY);
                    previewBox.style.height = `${currentHeight}px`;
                }
            };

            const onMouseUp = () => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);

                // プレビュー枠を削除
                if (previewBox && previewBox.parentNode) {
                    previewBox.parentNode.removeChild(previewBox);
                }

                // カーソルを元に戻す
                containerElement.style.cursor = 'pointer';

                // 最終的なサイズを取得
                const finalWidth = Math.round(currentWidth);
                const finalHeight = Math.round(currentHeight);

                // 画像オブジェクトのサイズを更新
                const key = `${col},${row}`;
                const cellData = this.cells.get(key);
                if (cellData && cellData.imageInfo) {
                    if (isRightEdge && finalWidth !== startWidth) {
                        cellData.imageInfo.displayWidth = finalWidth;
                    }
                    if (isBottomEdge && finalHeight !== startHeight) {
                        cellData.imageInfo.displayHeight = finalHeight;
                    }
                }

                // セル表示を更新
                if (finalWidth !== startWidth || finalHeight !== startHeight) {
                    this.renderCell(col, row);
                    this.isModified = true;

                    // 画像を再選択
                    setTimeout(() => {
                        this.selectImage(col, row);
                    }, 10);
                }

                // リサイズ終了フラグをリセット
                this.isResizingImage = false;
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        };

        // ハンドラを登録して参照を保存
        containerElement.addEventListener('mousemove', mousemoveHandler);
        containerElement._resizeMousemoveHandler = mousemoveHandler;

        containerElement.addEventListener('mouseleave', mouseleaveHandler);
        containerElement._resizeMouseleaveHandler = mouseleaveHandler;

        containerElement.addEventListener('mousedown', mousedownHandler, true); // キャプチャフェーズで先にリサイズ判定
        containerElement._resizeMousedownHandler = mousedownHandler;
    }

    /**
     * ウィンドウクローズ要求を処理
     * @param {string} windowId - ウィンドウID
     */
    async handleCloseRequest(windowId) {
        logger.debug('[CalcEditor] クローズ要求受信, isModified:', this.isModified);

        if (this.isModified) {
            // 編集中の場合、保存確認ダイアログを表示
            const result = await this.showSaveConfirmDialog();
            logger.debug('[CalcEditor] 保存確認ダイアログ結果:', result);

            if (result === 'cancel') {
                // 取消: クローズをキャンセル
                this.respondCloseRequest(windowId, false);
            } else if (result === 'no') {
                // 保存しない: そのままクローズ
                this.respondCloseRequest(windowId, true);
            } else if (result === 'yes') {
                // 保存: 保存してからクローズ
                await this.saveDocument();
                this.isModified = false;
                this.respondCloseRequest(windowId, true);
            }
        } else {
            // 未編集の場合、そのままクローズ
            this.respondCloseRequest(windowId, true);
        }
    }

    /**
     * クローズ要求に応答
     * @param {string} windowId - ウィンドウID
     * @param {boolean} allowClose - クローズを許可するか
     */
    respondCloseRequest(windowId, allowClose) {
        logger.debug('[CalcEditor] クローズ応答送信, windowId:', windowId, ', allowClose:', allowClose);
        if (this.messageBus) {
            this.messageBus.send('window-close-response', {
                windowId: windowId,
                allowClose: allowClose
            });
        }
    }

    /**
     * 保存確認ダイアログを表示
     * @returns {Promise<string>} 'yes', 'no', 'cancel'
     */
    async showSaveConfirmDialog() {
        return new Promise((resolve) => {
            this.messageBus.sendWithCallback('show-save-confirm-dialog', {
                message: '保存してから閉じますか？',
                buttons: [
                    { label: '取消', value: 'cancel' },
                    { label: '保存しない', value: 'no' },
                    { label: '保存', value: 'yes' }
                ]
            }, (response) => {
                logger.info('[CalcEditor] 保存確認ダイアログコールバック実行:', response);

                const dialogResult = response.result || response;

                if (dialogResult.error) {
                    logger.warn('[CalcEditor] 保存確認ダイアログエラー:', dialogResult.error);
                    resolve('cancel');
                    return;
                }

                const value = dialogResult.value || dialogResult;
                resolve(value);
            });
        });
    }

    // requestCloseWindow() は基底クラス PluginBase で定義

    /**
     * 親ウィンドウにメッセージ送信
     * @param {string} type - メッセージタイプ
     * @param {object} data - 送信データ
     */
    sendToParent(type, data = {}) {
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: type,
                fromEditor: true,
                ...data
            }, '*');
            logger.debug(`[CalcEditor] sendToParent: ${type}`, data);
        } else {
            logger.warn('[CalcEditor] 親ウィンドウが見つかりません');
        }
    }

    /**
     * 元の仮身オブジェクトを削除するフック（PluginBase共通機能）
     * cross-window-drop-successでmoveモード時に呼ばれる
     */
    onDeleteSourceVirtualObject(data) {
        if (!this.dragSourceCell) return;

        const { col, row } = this.dragSourceCell;
        const key = `${col},${row}`;
        const cellData = this.cells.get(key);

        if (cellData && cellData.contentType === 'virtualObject') {
            logger.info(`[CalcEditor] moveモード: 元のセル ${this.colToLetter(col)}${row} から仮身を削除`);

            // セルをクリア
            cellData.contentType = 'text';
            cellData.virtualObject = null;
            cellData.value = '';
            cellData.displayValue = '';
            cellData.formula = '';

            this.cells.set(key, cellData);

            // セルを再レンダリング
            this.renderCell(col, row);

            // 変更フラグを立てる
            this.isModified = true;
        }
    }

    /**
     * cross-window-drop-success処理完了後のフック（PluginBase共通機能）
     * ドラッグ状態のクリーンアップ後に呼ばれる
     */
    onCrossWindowDropSuccess(data) {
        // ドラッグソース情報をクリア
        this.dragSourceCell = null;

        if (data.mode === 'copy') {
            logger.debug('[CalcEditor] copyモード: 元のセルを保持');
        }
    }
}

// エディタのインスタンスを作成
window.addEventListener('DOMContentLoaded', () => {
    window.calcEditor = new CalcEditor();
});
