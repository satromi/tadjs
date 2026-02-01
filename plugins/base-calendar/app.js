/**
 * カレンダープラグイン
 * @module BaseCalendar
 * @extends PluginBase
 * @license MIT
 * @author satromi
 * @version 1.0.0
 */

class BaseCalendarApp extends window.PluginBase {
    constructor() {
        super('BaseCalendar');

        this.fileData = null;
        this.xmlData = null;

        // カレンダー状態
        this.currentYear = new Date().getFullYear();
        this.currentMonth = new Date().getMonth() + 1; // 1-12
        this.currentMonthRealId = null;  // 現在表示中の年月実身ID
        this.currentMonthXmlData = null; // 現在表示中の年月実身のXMLデータ

        // 仮身管理（年月実身内の仮身）
        this.virtualObjects = [];
        this.selectedVirtualObjects = new Set();

        // 自由仮身のドラッグ状態
        this.vobjDragState = {
            currentObject: null,         // ドラッグ中の仮身オブジェクト
            currentElement: null,        // ドラッグ中のDOM要素
            vobjIndex: null,             // ドラッグ中の仮身のインデックス
            initialLeft: 0,              // ドラッグ開始時の要素left位置
            initialTop: 0,               // ドラッグ開始時の要素top位置
            selectedObjects: null,       // 複数選択時の仮身配列
            selectedObjectsInitialPositions: null  // 複数選択時の初期位置配列
        };

        // リサイズ状態
        this.isResizing = false;
        this.recreateVirtualObjectTimer = null;

        // 親カレンダー実身の仮身リスト（年月実身への参照）
        this.monthVirtualObjects = [];

        // DOM参照
        this.calendarContainer = null;
        this.calendarGrid = null;

        // 日セルドラッグ状態（範囲指定で実身作成）
        this.dayCreationDrag = {
            isActive: false,
            startX: 0,
            startY: 0,
            day: null
        };

        // 休日マップ（キー: YYYY/MM/DD, 値: 休日名）
        this.holidayMap = {};

        this.init();
    }

    init() {
        // 共通コンポーネントの初期化
        this.initializeCommonComponents('[BaseCalendar]');

        // MessageBusのハンドラを登録
        if (this.messageBus) {
            this.setupMessageBusHandlers();
        }

        // ウィンドウアクティベーション
        this.setupWindowActivation();

        // 右クリックメニュー
        this.setupContextMenu();

        // キーボードショートカット
        this.setupKeyboardShortcuts();

        // UIイベントリスナー
        this.setupUIEventListeners();

        // スクロール状態通知の初期化
        this.initScrollNotification();

        // ドラッグアンドドロップを設定
        this.setupDragAndDrop();

        // クロスウィンドウドロップハンドラを設定
        this.setupCrossWindowDropSuccessHandler();
    }

    /**
     * キーボードショートカットを設定
     */
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            this.handleKeyboardShortcut(e);
        });
    }

    /**
     * キーボードショートカット処理
     * @param {KeyboardEvent} e - キーボードイベント
     */
    handleKeyboardShortcut(e) {
        // Ctrl+S: 保存
        if (e.ctrlKey && e.key === 's') {
            e.preventDefault();
            this.saveAll();
            return;
        }

        // Ctrl+E: ウィンドウを閉じる
        if (e.ctrlKey && e.key === 'e') {
            e.preventDefault();
            this.requestCloseWindow();
            return;
        }

        // Ctrl+L: 全画面表示オンオフ
        if (e.ctrlKey && e.key === 'l') {
            e.preventDefault();
            this.toggleFullscreen();
            return;
        }

        // Ctrl+O: 選択中の仮身を開く
        if (e.ctrlKey && e.key === 'o') {
            e.preventDefault();
            if (this.contextMenuVirtualObject?.virtualObj) {
                this.openVirtualObject(this.contextMenuVirtualObject.virtualObj);
            } else if (this.selectedVirtualObjects.size > 0) {
                // 最初の選択仮身を開く
                const firstIndex = Array.from(this.selectedVirtualObjects)[0];
                if (this.virtualObjects[firstIndex]) {
                    this.openVirtualObject(this.virtualObjects[firstIndex]);
                }
            }
            return;
        }

        // Ctrl+C: コピー
        if (e.ctrlKey && e.key === 'c') {
            e.preventDefault();
            this.copySelectedVirtualObjects();
            return;
        }

        // Ctrl+V: 貼り付け
        if (e.ctrlKey && e.key === 'v') {
            e.preventDefault();
            this.pasteVirtualObjects();
            return;
        }

        // Ctrl+X: 切り取り
        if (e.ctrlKey && e.key === 'x') {
            e.preventDefault();
            this.cutSelectedVirtualObjects();
            return;
        }

        // Ctrl+Z: クリップボードから移動
        if (e.ctrlKey && e.key === 'z') {
            e.preventDefault();
            this.pasteVirtualObjects(true);
            return;
        }

        // Delete: 削除
        if (e.key === 'Delete') {
            e.preventDefault();
            this.deleteSelectedVirtualObjects();
            return;
        }
    }

    /**
     * UIイベントリスナーを設定
     */
    setupUIEventListeners() {
        // 前月ボタン
        const prevButton = document.getElementById('prevMonth');
        if (prevButton) {
            prevButton.addEventListener('click', () => this.navigateToPrevMonth());
        }

        // 翌月ボタン
        const nextButton = document.getElementById('nextMonth');
        if (nextButton) {
            nextButton.addEventListener('click', () => this.navigateToNextMonth());
        }

        // 年月表示クリック（年月選択パネル）
        const currentMonth = document.getElementById('currentMonth');
        if (currentMonth) {
            currentMonth.addEventListener('click', () => this.showYearMonthDialog());
        }

        // 年月選択ダイアログ
        const dialogMove = document.getElementById('dialogMove');
        if (dialogMove) {
            dialogMove.addEventListener('click', () => this.applyYearMonthSelection());
        }

        const dialogCancel = document.getElementById('dialogCancel');
        if (dialogCancel) {
            dialogCancel.addEventListener('click', () => this.hideYearMonthDialog());
        }

        // ダイアログ外クリックで閉じる
        const dialog = document.getElementById('yearMonthDialog');
        if (dialog) {
            dialog.addEventListener('click', (e) => {
                if (e.target === dialog) {
                    this.hideYearMonthDialog();
                }
            });
        }

        // 年選択肢を初期化（±50年）
        this.initYearSelect();

        // ウィンドウリサイズ対応
        window.addEventListener('resize', () => {
            // カレンダーは自動でリサイズされるので特別な処理は不要
        });

        // 範囲選択中のmousemove処理
        document.addEventListener('mousemove', (e) => {
            if (this.dayCreationDrag.isActive && this.rangeSelectionState.isActive) {
                const grid = document.getElementById('calendarGrid');
                if (grid) {
                    const rect = grid.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const y = e.clientY - rect.top;
                    this.updateRangeSelection(x, y);
                }
            }
        });

        // 範囲選択中にマウスがグリッド外に出た場合の終了処理
        document.addEventListener('mouseup', () => {
            if (this.rangeSelectionState.isActive) {
                this.endRangeSelection();
            }
        });

        // 自由仮身のドラッグ処理（documentレベル）
        document.addEventListener('mousemove', (e) => {
            if (!this.virtualObjectDragState.isDragging) return;
            if (!this.vobjDragState.currentElement) return;

            // ドラッグ移動を検出
            if (this.detectVirtualObjectDragMove(e)) {
                // 移動量を計算
                const dx = e.clientX - this.virtualObjectDragState.startX;
                const dy = e.clientY - this.virtualObjectDragState.startY;

                // 要素を移動
                const element = this.vobjDragState.currentElement;
                element.style.left = `${this.vobjDragState.initialLeft + dx}px`;
                element.style.top = `${this.vobjDragState.initialTop + dy}px`;
            }
        });

        // 自由仮身のドラッグ終了処理（documentレベル）
        document.addEventListener('mouseup', () => {
            if (!this.virtualObjectDragState.isDragging) return;
            if (!this.vobjDragState.currentElement) return;

            if (this.virtualObjectDragState.hasMoved) {
                // 座標を更新
                const vobj = this.vobjDragState.currentObject;
                const element = this.vobjDragState.currentElement;
                const newLeft = parseFloat(element.style.left) || 0;
                const newTop = parseFloat(element.style.top) || 0;
                const width = (vobj.vobjright - vobj.vobjleft) || 150;
                const height = (vobj.vobjbottom - vobj.vobjtop) || DEFAULT_VOBJ_HEIGHT;

                vobj.vobjleft = newLeft;
                vobj.vobjtop = newTop;
                vobj.vobjright = newLeft + width;
                vobj.vobjbottom = newTop + height;

                // 保存
                this.saveMonthToFile();
                this.isModified = true;
            }

            // ドラッグ状態をクリア
            this.cleanupVirtualObjectDragState();
            this.vobjDragState.currentObject = null;
            this.vobjDragState.currentElement = null;
            this.vobjDragState.vobjIndex = null;
        });
    }

    /**
     * 年選択肢を初期化
     */
    initYearSelect() {
        const yearSelect = document.getElementById('yearSelect');
        if (!yearSelect) return;

        const currentYear = new Date().getFullYear();
        yearSelect.innerHTML = '';

        for (let year = currentYear - 50; year <= currentYear + 50; year++) {
            const option = document.createElement('option');
            option.value = year;
            option.textContent = year;
            if (year === this.currentYear) {
                option.selected = true;
            }
            yearSelect.appendChild(option);
        }
    }

    /**
     * MessageBusのハンドラを登録
     */
    setupMessageBusHandlers() {
        // init メッセージ
        this.messageBus.on('init', async (data) => {
            this.onInit(data);
            this.fileData = data.fileData;

            const realIdValue = this.fileData ? (this.fileData.realId || this.fileData.fileId) : null;
            if (realIdValue) {
                this.realId = realIdValue.replace(/_\d+\.xtad$/i, '');
            } else {
                this.realId = null;
            }

            // XMLデータを取得
            if (this.fileData && this.fileData.xmlData) {
                this.xmlData = this.fileData.xmlData;
                // 親実身のXMLを解析して年月仮身リストを取得
                await this.parseMonthVirtualObjects();
                // 休日データを読み込み
                await this.loadHolidayData();
            }

            // 今月のカレンダーを表示
            await this.navigateToMonth(this.currentYear, this.currentMonth);

            // キーボードショートカットが動作するようにbodyにフォーカス
            setTimeout(() => {
                document.body.focus();
            }, 100);
        });

        // 共通MessageBusハンドラを登録
        this.setupCommonMessageBusHandlers();

        // real-object-created メッセージ
        this.messageBus.on('real-object-created', (data) => {
            // waitForで処理されるため、ここでは何もしない
        });

        // real-object-loaded メッセージ
        this.messageBus.on('real-object-loaded', (data) => {
            // waitForで処理されるため、ここでは何もしない
        });

        // parent-drop-event メッセージ（他ウィンドウからの仮身ドロップ）
        this.messageBus.on('parent-drop-event', (data) => {
            this.handleParentDropEvent(data);
        });

        // add-virtual-object-from-base メッセージ（原紙箱からのドロップ）
        this.messageBus.on('add-virtual-object-from-base', async (data) => {
            await this.handleBaseFileDropped(data);
        });

        // add-virtual-object-from-trash メッセージ（屑実身操作からの復元）
        this.messageBus.on('add-virtual-object-from-trash', async (data) => {
            await this.handleBaseFileDropped(data);
        });
    }

    /**
     * 親ウィンドウからのドロップイベントを処理
     * dropイベントをエミュレートしてhandleDropEvent()で統一処理
     * @param {Object} data - ドロップデータ
     */
    async handleParentDropEvent(data) {
        // dragDataがない場合は処理しない
        if (!data.dragData) {
            console.warn('[BaseCalendar] parent-drop-event: dragDataがありません');
            return;
        }

        console.log('[BaseCalendar] parent-drop-event受信:', data.dragData.type);

        // dropイベントをエミュレート（virtual-object-listと同様のパターン）
        const dropEvent = new CustomEvent('drop', { bubbles: true, cancelable: true });
        Object.defineProperty(dropEvent, 'clientX', { value: data.clientX, writable: false });
        Object.defineProperty(dropEvent, 'clientY', { value: data.clientY, writable: false });
        Object.defineProperty(dropEvent, 'dataTransfer', {
            value: {
                getData: (type) => {
                    if (type === 'text/plain') {
                        return JSON.stringify(data.dragData);
                    }
                    return '';
                }
            },
            writable: false
        });

        await this.handleDropEvent(dropEvent);
    }

    /**
     * 原紙箱/屑実身操作からドロップされた実身を処理
     * @param {Object} data - { realId, name, dropPosition, applist }
     */
    async handleBaseFileDropped(data) {
        const { realId, name, dropPosition } = data;

        // 仮身データを構築（PluginBase共通メソッド使用）
        const virtualObj = this.createVirtualObjectData({
            link_id: `${realId}_0.xtad`,
            link_name: name,
            vobjleft: 0,
            vobjtop: 0,
            vobjright: 150,
            vobjbottom: DEFAULT_VOBJ_HEIGHT,
            heightPx: DEFAULT_VOBJ_HEIGHT,
            chsz: 14,
            pictdisp: 'true',
            namedisp: 'true',
            framedisp: 'true'
        });

        // ドロップ座標を取得（なければデフォルト値）
        const coords = dropPosition || { x: 100, y: 100 };

        // 自由仮身として追加
        await this.addFreeVirtualObjectToMonth(virtualObj, coords.x, coords.y);

        // 再描画
        this.renderCalendarGrid();
        this.renderFreeVirtualObjects();
    }

    /**
     * 座標から日を取得
     * @param {number} x - X座標
     * @param {number} y - Y座標
     * @returns {number|null} 日（1-31）またはnull
     */
    getDayFromCoordinates(x, y) {
        // セル要素を取得
        const cell = document.elementFromPoint(x, y)?.closest('.day-cell');
        if (!cell) return null;

        // 日番号を取得
        const dayNumber = cell.querySelector('.day-number');
        if (!dayNumber || dayNumber.classList.contains('other-month')) return null;

        const day = parseInt(dayNumber.textContent);
        return isNaN(day) ? null : day;
    }

    /**
     * 外部からドロップされた仮身を年月実身に追加
     * 座標は一時的な値を使用し、後でカレンダー表示の実際の位置に更新する
     * @param {Object} virtualObj - 仮身オブジェクト
     * @param {number} dropX - ドロップX座標（未使用、互換性のため残す）
     * @param {number} dropY - ドロップY座標（未使用、互換性のため残す）
     * @returns {string|null} 追加した仮身のlink_name（座標更新用）
     */
    async addExternalVirtualObjectToMonth(virtualObj, dropX, dropY) {
        if (!this.currentMonthXmlData) return null;

        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(this.currentMonthXmlData, 'text/xml');
            const figureElement = xmlDoc.querySelector('figure');
            if (!figureElement) return null;

            // 座標計算（一時的なデフォルト座標を使用、後でDOM位置から更新される）
            const coords = this.calculateVirtualObjectPosition();

            // 元の仮身から属性を引き継ぐ（共通メソッドを使用）
            const newVirtualObj = this.createVirtualObjectData({
                link_id: virtualObj.link_id,
                link_name: virtualObj.link_name,
                vobjleft: coords.left,
                vobjtop: coords.top,
                vobjright: coords.right,
                vobjbottom: coords.bottom,
                heightPx: coords.height,
                chsz: virtualObj.chsz,
                frcol: virtualObj.frcol,
                chcol: virtualObj.chcol,
                tbcol: virtualObj.tbcol,
                bgcol: virtualObj.bgcol,
                dlen: virtualObj.dlen,
                pictdisp: virtualObj.pictdisp,
                namedisp: virtualObj.namedisp,
                roledisp: virtualObj.roledisp,
                typedisp: virtualObj.typedisp,
                updatedisp: virtualObj.updatedisp,
                framedisp: virtualObj.framedisp,
                autoopen: virtualObj.autoopen
            });

            // 新しいlink要素を作成（共通メソッドを使用）
            const linkElement = xmlDoc.createElement('link');
            this.buildLinkElementAttributes(linkElement, newVirtualObj);

            // 改行を追加してからlink要素を追加
            figureElement.appendChild(xmlDoc.createTextNode('\n'));
            figureElement.appendChild(linkElement);

            // XMLを文字列に変換
            const serializer = new XMLSerializer();
            let xmlString = serializer.serializeToString(xmlDoc);
            // <link ...>テキスト</link>を<link .../>に変換（自己閉じタグ形式に統一、改行付き）
            xmlString = xmlString.replace(/<link([^>]*)>[^<]*<\/link>/g, '<link$1/>\r\n');
            this.currentMonthXmlData = xmlString;

            // 仮身リストに追加（全属性を含める）
            this.virtualObjects.push({
                link_id: virtualObj.link_id,
                link_name: virtualObj.link_name,
                vobjleft: coords.left,
                vobjtop: coords.top,
                vobjright: coords.right,
                vobjbottom: coords.bottom,
                width: coords.right - coords.left,
                heightPx: coords.bottom - coords.top,
                chsz: newVirtualObj.chsz,
                frcol: newVirtualObj.frcol,
                chcol: newVirtualObj.chcol,
                tbcol: newVirtualObj.tbcol,
                bgcol: newVirtualObj.bgcol,
                dlen: newVirtualObj.dlen,
                pictdisp: newVirtualObj.pictdisp,
                namedisp: newVirtualObj.namedisp,
                roledisp: newVirtualObj.roledisp,
                typedisp: newVirtualObj.typedisp,
                updatedisp: newVirtualObj.updatedisp,
                framedisp: newVirtualObj.framedisp,
                autoopen: newVirtualObj.autoopen
            });

            // 年月実身を保存
            this.saveMonthToFile();

            this.isModified = true;

            // 座標更新用にlink_nameを返す
            return virtualObj.link_name;
        } catch (error) {
            // エラー時は何もしない
            return null;
        }
    }

    /**
     * 親実身のXMLから年月仮身リストを解析
     */
    async parseMonthVirtualObjects() {
        if (!this.xmlData) return;

        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(this.xmlData, 'text/xml');
            const linkElements = xmlDoc.getElementsByTagName('link');

            this.monthVirtualObjects = [];

            for (const link of linkElements) {
                const virtualObj = this.parseLinkElement(link);
                if (virtualObj) {
                    // 自己閉じタグ対応: JSONから実身名を読み込み
                    await this.loadVirtualObjectMetadata(virtualObj);
                    this.monthVirtualObjects.push(virtualObj);
                }
            }
        } catch (error) {
            // エラー時は空配列のまま
        }
    }

    // parseLinkElement はPluginBase共通メソッドを使用

    /**
     * 「休日」という名前の仮身を検索
     * @returns {Object|null} 休日仮身オブジェクト
     */
    findHolidayVirtualObject() {
        return this.monthVirtualObjects.find(vobj => vobj.link_name === '休日') || null;
    }

    /**
     * 「年月日実身」テンプレート仮身を検索
     * @returns {Object|null} テンプレート仮身オブジェクト
     */
    findDayTemplateVirtualObject() {
        return this.monthVirtualObjects.find(vobj => vobj.link_name === '年月日実身') || null;
    }

    /**
     * テンプレートxmlTADに日付を適用
     * @param {string} templateXtad - テンプレートxmlTAD
     * @param {string} dayName - 日名（YYYY/MM/DD形式）
     * @returns {string} 日付置換後のxmlTAD
     */
    applyDateToTemplate(templateXtad, dayName) {
        // YYYY/MM/DD を実際の日付に置換
        let result = templateXtad.replace(/YYYY\/MM\/DD/g, dayName);

        // filename属性も更新
        result = result.replace(/filename="[^"]*"/, `filename="${dayName}"`);

        return result;
    }

    /**
     * 休日データを読み込み
     * 優先1: 年月xtadの休日名document要素から読み込み
     * 優先2: 「休日」仮身から読み込み
     */
    async loadHolidayData() {
        this.holidayMap = {};
        this.holidayLoadedFromXtad = false;

        // 優先1: 年月xtadから休日名documentを検索
        if (this.currentMonthXmlData) {
            try {
                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(this.currentMonthXmlData, 'text/xml');
                const holidayDocs = this.findHolidayDocumentsInXml(xmlDoc);

                if (holidayDocs.length > 0) {
                    // 休日名documentから休日マップを構築
                    for (const doc of holidayDocs) {
                        const holidayName = this.parseHolidayNameDocument(doc);
                        const position = this.getHolidayDocumentPosition(doc);
                        if (holidayName && position) {
                            const dateInfo = this.getDateFromPosition(position);
                            if (dateInfo) {
                                const dateKey = `${dateInfo.year}/${String(dateInfo.month).padStart(2, '0')}/${String(dateInfo.day).padStart(2, '0')}`;
                                this.holidayMap[dateKey] = holidayName;
                            }
                        }
                    }

                    if (Object.keys(this.holidayMap).length > 0) {
                        this.holidayLoadedFromXtad = true;
                        return;
                    }
                }
            } catch (error) {
                // パースエラー時はフォールバック
            }
        }

        // 優先2: 「休日」仮身から読み込み
        const holidayVobj = this.findHolidayVirtualObject();
        if (!holidayVobj) {
            return;
        }

        try {
            // link_idからXTADファイルを読み込み
            const xtadFile = await this.loadDataFileFromParent(holidayVobj.link_id);
            if (!xtadFile) {
                return;
            }

            const xtadContent = typeof xtadFile === 'string' ? xtadFile : await xtadFile.text();
            this.holidayMap = this.parseHolidayXtad(xtadContent);
        } catch (error) {
            // 読み込み失敗時は空のマップのまま
            this.holidayMap = {};
        }
    }

    /**
     * 休日XTADをパースして休日マップを生成
     * @param {string} xtadContent - XTADファイルの内容
     * @returns {Object} 休日マップ（キー: YYYY/MM/DD, 値: 休日名）
     */
    parseHolidayXtad(xtadContent) {
        const holidayMap = {};

        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xtadContent, 'text/xml');

            // <document><p>内のテキストを取得
            const pElement = xmlDoc.querySelector('document > p');
            if (!pElement) {
                return holidayMap;
            }

            const text = pElement.textContent;
            const lines = text.split('\n').filter(line => line.trim());

            for (const line of lines) {
                // タブ区切り: YYYY/MM/DD\t休日名
                const parts = line.split('\t');
                if (parts.length >= 2) {
                    const date = parts[0].trim();
                    const name = parts[1].trim();
                    if (date && name) {
                        holidayMap[date] = name;
                    }
                }
            }
        } catch (error) {
            // パース失敗時は空のマップを返す
        }

        return holidayMap;
    }

    /**
     * 指定日の休日名を取得
     * @param {number} year - 年
     * @param {number} month - 月（1-12）
     * @param {number} day - 日
     * @returns {string|null} 休日名またはnull
     */
    getHolidayName(year, month, day) {
        const dateKey = `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`;
        return this.holidayMap[dateKey] || null;
    }

    /**
     * xtadから休日名document要素を検索
     * @param {Document} xmlDoc - XMLドキュメント
     * @returns {Element[]} 休日名document要素の配列
     */
    findHolidayDocumentsInXml(xmlDoc) {
        const result = [];
        const figure = xmlDoc.querySelector('figure');
        if (!figure) return result;
        const documents = figure.querySelectorAll('document');
        for (const doc of documents) {
            const docmemo = doc.querySelector('docmemo[text="holiday"]');
            if (docmemo) {
                result.push(doc);
            }
        }
        return result;
    }

    /**
     * 休日名document要素から休日名を取得
     * @param {Element} documentElement - 休日名document要素
     * @returns {string|null} 休日名
     */
    parseHolidayNameDocument(documentElement) {
        const docmemo = documentElement.querySelector('docmemo[text="holiday"]');
        if (!docmemo) return null;

        // docmemoの後のテキストノードから休日名を取得
        let nextNode = docmemo.nextSibling;
        if (nextNode && nextNode.nodeType === Node.TEXT_NODE) {
            return nextNode.textContent.trim();
        }
        return null;
    }

    /**
     * 休日名document要素から座標を取得
     * @param {Element} documentElement - 休日名document要素
     * @returns {Object|null} {left, top, right, bottom}
     */
    getHolidayDocumentPosition(documentElement) {
        const docView = documentElement.querySelector('docView');
        if (!docView) return null;
        return {
            left: parseInt(docView.getAttribute('viewleft'), 10),
            top: parseInt(docView.getAttribute('viewtop'), 10),
            right: parseInt(docView.getAttribute('viewright'), 10),
            bottom: parseInt(docView.getAttribute('viewbottom'), 10)
        };
    }

    /**
     * 休日名用のdocument要素XMLを生成
     * @param {string} holidayName - 休日名
     * @param {Object} position - 配置座標 {left, top, right, bottom}
     * @param {number} zIndex - zIndex値
     * @returns {string} XML文字列
     */
    buildHolidayNameDocument(holidayName, position, zIndex) {
        return `<document>
<docView viewleft="${position.left}" viewtop="${position.top}" viewright="${position.right}" viewbottom="${position.bottom}"/>
<docDraw drawleft="${position.left}" drawtop="${position.top}" drawright="${position.right}" drawbottom="${position.bottom}"/>
<docScale hunit="-72" vunit="-72"/>
<text zIndex="${zIndex}"/>
<font size="10"/>
<font color="${SUNDAY_COLOR}"/>
<text align="left"/>
<docmemo text="holiday"/>${holidayName}
</document>
`;
    }

    /**
     * 座標から該当する日付を特定
     * @param {Object} position - {left, top}
     * @returns {Object|null} {year, month, day}
     */
    getDateFromPosition(position) {
        const layout = this.getCalendarLayoutConstants();
        const col = Math.floor(position.left / layout.CELL_WIDTH);
        const row = Math.floor((position.top - layout.GRID_TOP) / layout.CELL_HEIGHT);

        if (col < 0 || col >= 7 || row < 0 || row >= 6) return null;

        const firstDay = new Date(this.currentYear, this.currentMonth - 1, 1);
        const lastDay = new Date(this.currentYear, this.currentMonth, 0);
        const daysInMonth = lastDay.getDate();
        const startDayOfWeek = firstDay.getDay();

        const cellIndex = row * 7 + col;
        const dayOffset = cellIndex - startDayOfWeek + 1;

        if (dayOffset < 1 || dayOffset > daysInMonth) return null;

        return {
            year: this.currentYear,
            month: this.currentMonth,
            day: dayOffset
        };
    }

    /**
     * 前月へ移動
     */
    async navigateToPrevMonth() {
        let year = this.currentYear;
        let month = this.currentMonth - 1;

        if (month < 1) {
            month = 12;
            year--;
        }

        await this.navigateToMonth(year, month);
    }

    /**
     * 翌月へ移動
     */
    async navigateToNextMonth() {
        let year = this.currentYear;
        let month = this.currentMonth + 1;

        if (month > 12) {
            month = 1;
            year++;
        }

        await this.navigateToMonth(year, month);
    }

    /**
     * 指定した年月へ移動
     */
    async navigateToMonth(year, month) {
        this.currentYear = year;
        this.currentMonth = month;

        // 年月表示を更新
        this.updateMonthDisplay();

        // 年月実身を検索または作成
        await this.findOrCreateMonthRealObject(year, month);

        // カレンダーグリッドを描画
        this.renderCalendarGrid();
    }

    /**
     * 年月表示を更新
     */
    updateMonthDisplay() {
        const currentMonthEl = document.getElementById('currentMonth');
        if (currentMonthEl) {
            const monthStr = String(this.currentMonth).padStart(2, '0');
            currentMonthEl.textContent = `${this.currentYear}/${monthStr}`;
        }
    }

    /**
     * 年月実身を検索または作成
     */
    async findOrCreateMonthRealObject(year, month) {
        const monthName = `${year}/${String(month).padStart(2, '0')}`;

        // 親実身の仮身リストから検索
        const existingVobj = this.monthVirtualObjects.find(
            vobj => vobj.link_name === monthName
        );

        if (existingVobj) {
            // 既存の年月実身を読み込み
            const realId = window.RealObjectSystem.extractRealId(existingVobj.link_id);
            await this.loadMonthRealObject(realId);
        } else {
            // 新規年月実身を作成
            await this.createMonthRealObject(year, month);
        }
    }

    /**
     * 年月実身を読み込み
     */
    async loadMonthRealObject(realId) {
        try {
            const messageId = this.generateMessageId('load');
            this.messageBus.send('load-real-object', {
                messageId: messageId,
                realId: realId
            });

            const result = await this.messageBus.waitFor('real-object-loaded',
                window.DEFAULT_TIMEOUT_MS,
                (data) => data.messageId === messageId
            );

            if (result.success && result.realObject) {
                this.currentMonthRealId = realId;
                // 最初のレコードからXMLデータを取得
                if (result.realObject.records && result.realObject.records.length > 0) {
                    this.currentMonthXmlData = result.realObject.records[0].xtad || result.realObject.records[0].data;
                } else {
                    this.currentMonthXmlData = null;
                }
                // 仮身を解析
                await this.parseVirtualObjects();
            }
        } catch (error) {
            this.currentMonthRealId = null;
            this.currentMonthXmlData = null;
            this.virtualObjects = [];
        }
    }

    /**
     * カレンダー図形セグメントを含むxmlTADを生成
     * @param {number} year - 年
     * @param {number} month - 月
     * @returns {string} xmlTAD文字列
     */
    buildCalendarXml(year, month) {
        const monthStr = String(month).padStart(2, '0');
        const monthName = `${year}/${monthStr}`;

        // レイアウト定数（800x600基準）
        const BASE_WIDTH = 800;
        const BASE_HEIGHT = 600;
        const NAV_HEIGHT = 40;
        const WEEKDAY_HEIGHT = 30;
        const GRID_TOP = NAV_HEIGHT + WEEKDAY_HEIGHT; // 70
        const GRID_HEIGHT = BASE_HEIGHT - GRID_TOP;   // 530
        const CELL_WIDTH = Math.floor(BASE_WIDTH / 7); // 114
        const CELL_HEIGHT = Math.floor(GRID_HEIGHT / 6); // 88
        const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
        const WEEKDAY_COLORS = [SUNDAY_COLOR, DEFAULT_FRCOL, DEFAULT_FRCOL, DEFAULT_FRCOL, DEFAULT_FRCOL, DEFAULT_FRCOL, SATURDAY_COLOR];

        // 月の最初の日と最終日
        const firstDay = new Date(year, month - 1, 1);
        const lastDay = new Date(year, month, 0);
        const daysInMonth = lastDay.getDate();
        const startDayOfWeek = firstDay.getDay();

        // 前月の最終日
        const prevMonthLastDay = new Date(year, month - 1, 0);
        const daysInPrevMonth = prevMonthLastDay.getDate();

        // 今日の日付
        const today = new Date();
        const isCurrentMonth = today.getFullYear() === year && (today.getMonth() + 1) === month;
        const todayDate = today.getDate();

        let xmlTAD = `<tad version="1.0" filename="${monthName}" encoding="UTF-8">
<figure>
<figView top="0" left="0" right="${BASE_WIDTH}" bottom="${BASE_HEIGHT}"/>
<figDraw top="0" left="0" right="${BASE_WIDTH}" bottom="${BASE_HEIGHT}"/>
<figScale hunit="-72" vunit="-72"/>
<!-- ナビゲーションバー背景 -->
<rect round="0" lineType="0" lineWidth="1" f_pat="0" fillColor="${HOVER_BG_COLOR}" strokeColor="${GRAY_COLOR}" left="0" top="0" right="${BASE_WIDTH}" bottom="${NAV_HEIGHT}" zIndex="1"/>
<!-- 年月表示テキスト -->
<document>
<docView viewleft="350" viewtop="5" viewright="450" viewbottom="35"/>
<docDraw drawleft="350" drawtop="5" drawright="450" drawbottom="35"/>
<docScale hunit="-72" vunit="-72"/>
<text zIndex="2"/>
<font size="16"/>
<font color="${DEFAULT_CHCOL}"/>
<text align="center"/>
${monthName}
</document>
<!-- 曜日ヘッダー背景 -->
<rect round="0" lineType="0" lineWidth="1" f_pat="0" fillColor="${HOVER_BG_COLOR}" strokeColor="${GRAY_COLOR}" left="0" top="${NAV_HEIGHT}" right="${BASE_WIDTH}" bottom="${GRID_TOP}" zIndex="3"/>
`;

        // 曜日ヘッダーテキスト
        let zIndex = 4;
        for (let i = 0; i < 7; i++) {
            const left = i * CELL_WIDTH;
            const right = (i + 1) * CELL_WIDTH;
            xmlTAD += `<!-- 曜日: ${WEEKDAYS[i]} -->
<document>
<docView viewleft="${left}" viewtop="${NAV_HEIGHT}" viewright="${right}" viewbottom="${GRID_TOP}"/>
<docDraw drawleft="${left}" drawtop="${NAV_HEIGHT}" drawright="${right}" drawbottom="${GRID_TOP}"/>
<docScale hunit="-72" vunit="-72"/>
<text zIndex="${zIndex}"/>
<font size="12"/>
<font color="${WEEKDAY_COLORS[i]}"/>
<text align="center"/>
${WEEKDAYS[i]}
</document>
`;
            zIndex++;
        }

        // カレンダーグリッド - 日セル（6週 × 7日 = 42セル）
        let dayCounter = 1;
        let nextMonthDay = 1;
        zIndex = 10;

        for (let row = 0; row < 6; row++) {
            for (let col = 0; col < 7; col++) {
                const cellIndex = row * 7 + col;
                const left = col * CELL_WIDTH;
                const top = GRID_TOP + row * CELL_HEIGHT;
                const right = (col + 1) * CELL_WIDTH;
                const bottom = GRID_TOP + (row + 1) * CELL_HEIGHT;

                let dayText = '';
                let dayColor = DEFAULT_CHCOL;
                let cellColor = DEFAULT_BGCOL;
                let isOtherMonth = false;
                let currentDay = null;  // 休日チェック用

                if (cellIndex < startDayOfWeek) {
                    // 前月
                    const day = daysInPrevMonth - startDayOfWeek + cellIndex + 1;
                    dayText = String(day);
                    dayColor = GRAY_COLOR;
                    cellColor = DIALOG_BG_COLOR;
                    isOtherMonth = true;
                } else if (dayCounter <= daysInMonth) {
                    // 当月
                    currentDay = dayCounter;  // 休日チェック用に保持
                    dayText = String(dayCounter);
                    if (col === 0) {
                        dayColor = SUNDAY_COLOR; // 日曜
                    } else if (col === 6) {
                        dayColor = SATURDAY_COLOR; // 土曜
                    }
                    // 休日の場合は色を赤に変更
                    const holidayName = this.getHolidayName(year, month, dayCounter);
                    if (holidayName) {
                        dayColor = SUNDAY_COLOR;
                    }
                    if (isCurrentMonth && dayCounter === todayDate) {
                        cellColor = TODAY_CELL_COLOR; // 今日
                    }
                    dayCounter++;
                } else {
                    // 翌月
                    dayText = String(nextMonthDay);
                    dayColor = GRAY_COLOR;
                    cellColor = DIALOG_BG_COLOR;
                    isOtherMonth = true;
                    nextMonthDay++;
                }

                // セル背景
                xmlTAD += `<rect round="0" lineType="0" lineWidth="1" f_pat="0" fillColor="${cellColor}" strokeColor="${DESKTOP_BG_COLOR}" left="${left}" top="${top}" right="${right}" bottom="${bottom}" zIndex="${zIndex}"/>\r\n`;
                zIndex++;

                // 日付テキスト（左上に配置）
                const textLeft = left + 4;
                const textTop = top + 2;
                const textRight = left + 30;
                const textBottom = top + 18;
                xmlTAD += `<document>
<docView viewleft="${textLeft}" viewtop="${textTop}" viewright="${textRight}" viewbottom="${textBottom}"/>
<docDraw drawleft="${textLeft}" drawtop="${textTop}" drawright="${textRight}" drawbottom="${textBottom}"/>
<docScale hunit="-72" vunit="-72"/>
<text zIndex="${zIndex}"/>
<font size="12"/>
<font color="${dayColor}"/>
<text align="left"/>
${dayText}
</document>
`;
                zIndex++;

                // 当月の休日の場合、休日名documentを追加
                if (!isOtherMonth && currentDay) {
                    const holidayName = this.getHolidayName(year, month, currentDay);
                    if (holidayName) {
                        const holidayPosition = {
                            left: left + 30,
                            top: top + 2,
                            right: right - 4,
                            bottom: top + 18
                        };
                        xmlTAD += this.buildHolidayNameDocument(holidayName, holidayPosition, zIndex);
                        zIndex++;
                    }
                }
            }
        }

        xmlTAD += `
</figure>
</tad>`;

        return xmlTAD;
    }

    /**
     * カレンダーレイアウト定数を取得
     * @returns {Object} レイアウト定数
     */
    getCalendarLayoutConstants() {
        return {
            BASE_WIDTH: 800,
            BASE_HEIGHT: 600,
            NAV_HEIGHT: 40,
            WEEKDAY_HEIGHT: 30,
            GRID_TOP: 70, // NAV_HEIGHT + WEEKDAY_HEIGHT
            GRID_HEIGHT: 530, // BASE_HEIGHT - GRID_TOP
            CELL_WIDTH: 114, // Math.floor(800 / 7)
            CELL_HEIGHT: 88, // Math.floor(530 / 6)
            DAY_NUMBER_HEIGHT: 18, // 日付番号の高さ
            EVENT_PADDING: 2, // 仮身の間隔
            EVENT_HEIGHT: 18 // 仮身の高さ
        };
    }

    /**
     * 仮身の日セル内座標を計算
     * @param {string} dayName - 仮身名（YYYY/MM/DD形式）
     * @param {number} indexInCell - セル内での順番（0から）
     * @returns {Object|null} 座標 { left, top, right, bottom }
     */
    calculateVirtualObjectCellPosition(dayName, indexInCell) {
        const layout = this.getCalendarLayoutConstants();

        // 日付を解析
        const parts = dayName.split('/');
        if (parts.length !== 3) return null;
        const year = parseInt(parts[0]);
        const month = parseInt(parts[1]);
        const day = parseInt(parts[2]);

        // 月の最初の日
        const firstDay = new Date(year, month - 1, 1);
        const startDayOfWeek = firstDay.getDay();

        // セルのインデックスを計算（0-41）
        const cellIndex = startDayOfWeek + day - 1;
        const row = Math.floor(cellIndex / 7);
        const col = cellIndex % 7;

        // セルの座標
        const cellLeft = col * layout.CELL_WIDTH;
        const cellTop = layout.GRID_TOP + row * layout.CELL_HEIGHT;

        // 仮身の座標（セル内でイベントエリアに配置）
        const eventTop = cellTop + layout.DAY_NUMBER_HEIGHT + layout.EVENT_PADDING;
        const eventOffset = indexInCell * (layout.EVENT_HEIGHT + layout.EVENT_PADDING);

        return {
            left: cellLeft + layout.EVENT_PADDING,
            top: eventTop + eventOffset,
            right: cellLeft + layout.CELL_WIDTH - layout.EVENT_PADDING,
            bottom: eventTop + eventOffset + layout.EVENT_HEIGHT
        };
    }

    /**
     * 仮身リストから各日ごとの仮身数を取得
     * @returns {Object} { "YYYY/MM/DD": count, ... }
     */
    getVirtualObjectCountsByDay() {
        const counts = {};
        for (const vobj of this.virtualObjects) {
            const dayName = vobj.link_name;
            if (dayName) {
                counts[dayName] = (counts[dayName] || 0) + 1;
            }
        }
        return counts;
    }

    /**
     * カレンダーレイアウトと仮身を含むxmlTADを再生成
     * @returns {string} xmlTAD文字列
     */
    rebuildCalendarXmlWithVirtualObjects() {
        const layout = this.getCalendarLayoutConstants();
        const monthStr = String(this.currentMonth).padStart(2, '0');
        const monthName = `${this.currentYear}/${monthStr}`;
        const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
        const WEEKDAY_COLORS = [SUNDAY_COLOR, DEFAULT_FRCOL, DEFAULT_FRCOL, DEFAULT_FRCOL, DEFAULT_FRCOL, DEFAULT_FRCOL, SATURDAY_COLOR];

        // 月の情報
        const firstDay = new Date(this.currentYear, this.currentMonth - 1, 1);
        const lastDay = new Date(this.currentYear, this.currentMonth, 0);
        const daysInMonth = lastDay.getDate();
        const startDayOfWeek = firstDay.getDay();
        const prevMonthLastDay = new Date(this.currentYear, this.currentMonth - 1, 0);
        const daysInPrevMonth = prevMonthLastDay.getDate();
        const today = new Date();
        const isCurrentMonth = today.getFullYear() === this.currentYear && (today.getMonth() + 1) === this.currentMonth;
        const todayDate = today.getDate();

        let xmlTAD = `<tad version="1.0" filename="${monthName}" encoding="UTF-8">
<figure>
<figView top="0" left="0" right="${layout.BASE_WIDTH}" bottom="${layout.BASE_HEIGHT}"/>
<figDraw top="0" left="0" right="${layout.BASE_WIDTH}" bottom="${layout.BASE_HEIGHT}"/>
<figScale hunit="-72" vunit="-72"/>
<!-- ナビゲーションバー背景 -->
<rect round="0" lineType="0" lineWidth="1" f_pat="0" fillColor="${HOVER_BG_COLOR}" strokeColor="${GRAY_COLOR}" left="0" top="0" right="${layout.BASE_WIDTH}" bottom="${layout.NAV_HEIGHT}" zIndex="1"/>
<!-- 年月表示テキスト -->
<document>
<docView viewleft="350" viewtop="5" viewright="450" viewbottom="35"/>
<docDraw drawleft="350" drawtop="5" drawright="450" drawbottom="35"/>
<docScale hunit="-72" vunit="-72"/>
<text zIndex="2"/>
<font size="16"/>
<font color="${DEFAULT_CHCOL}"/>
<text align="center"/>
${monthName}
</document>

<!-- 曜日ヘッダー背景 -->
<rect round="0" lineType="0" lineWidth="1" f_pat="0" fillColor="${HOVER_BG_COLOR}" strokeColor="${GRAY_COLOR}" left="0" top="${layout.NAV_HEIGHT}" right="${layout.BASE_WIDTH}" bottom="${layout.GRID_TOP}" zIndex="3"/>

`;

        // 曜日ヘッダーテキスト
        let zIndex = 4;
        for (let i = 0; i < 7; i++) {
            const left = i * layout.CELL_WIDTH;
            const right = (i + 1) * layout.CELL_WIDTH;
            xmlTAD += `<!-- 曜日: ${WEEKDAYS[i]} -->
<document>
<docView viewleft="${left}" viewtop="${layout.NAV_HEIGHT}" viewright="${right}" viewbottom="${layout.GRID_TOP}"/>
<docDraw drawleft="${left}" drawtop="${layout.NAV_HEIGHT}" drawright="${right}" drawbottom="${layout.GRID_TOP}"/>
<docScale hunit="-72" vunit="-72"/>
<text zIndex="${zIndex}"/>
<font size="12"/>
<font color="${WEEKDAY_COLORS[i]}"/>
<text align="center"/>
${WEEKDAYS[i]}
</document>

`;
            zIndex++;
        }

        // カレンダーグリッド - 日セル
        let dayCounter = 1;
        let nextMonthDay = 1;
        zIndex = 10;

        for (let row = 0; row < 6; row++) {
            for (let col = 0; col < 7; col++) {
                const cellIndex = row * 7 + col;
                const left = col * layout.CELL_WIDTH;
                const top = layout.GRID_TOP + row * layout.CELL_HEIGHT;
                const right = (col + 1) * layout.CELL_WIDTH;
                const bottom = layout.GRID_TOP + (row + 1) * layout.CELL_HEIGHT;

                let dayText = '';
                let dayColor = DEFAULT_CHCOL;
                let cellColor = DEFAULT_BGCOL;
                let isOtherMonth = false;
                let currentDay = null;  // 休日チェック用

                if (cellIndex < startDayOfWeek) {
                    const day = daysInPrevMonth - startDayOfWeek + cellIndex + 1;
                    dayText = String(day);
                    dayColor = GRAY_COLOR;
                    cellColor = DIALOG_BG_COLOR;
                    isOtherMonth = true;
                } else if (dayCounter <= daysInMonth) {
                    currentDay = dayCounter;  // 休日チェック用に保持
                    dayText = String(dayCounter);
                    if (col === 0) {
                        dayColor = SUNDAY_COLOR;
                    } else if (col === 6) {
                        dayColor = SATURDAY_COLOR;
                    }
                    // 休日の場合は色を赤に変更
                    const holidayName = this.getHolidayName(this.currentYear, this.currentMonth, dayCounter);
                    if (holidayName) {
                        dayColor = SUNDAY_COLOR;
                    }
                    if (isCurrentMonth && dayCounter === todayDate) {
                        cellColor = TODAY_CELL_COLOR;
                    }
                    dayCounter++;
                } else {
                    dayText = String(nextMonthDay);
                    dayColor = GRAY_COLOR;
                    cellColor = DIALOG_BG_COLOR;
                    isOtherMonth = true;
                    nextMonthDay++;
                }

                // セル背景
                xmlTAD += `<rect round="0" lineType="0" lineWidth="1" f_pat="0" fillColor="${cellColor}" strokeColor="${DESKTOP_BG_COLOR}" left="${left}" top="${top}" right="${right}" bottom="${bottom}" zIndex="${zIndex}"/>\r\n`;
                zIndex++;

                // 日付テキスト
                const textLeft = left + 4;
                const textTop = top + 2;
                const textRight = left + 30;
                const textBottom = top + 18;
                xmlTAD += `<document>
<docView viewleft="${textLeft}" viewtop="${textTop}" viewright="${textRight}" viewbottom="${textBottom}"/>
<docDraw drawleft="${textLeft}" drawtop="${textTop}" drawright="${textRight}" drawbottom="${textBottom}"/>
<docScale hunit="-72" vunit="-72"/>
<text zIndex="${zIndex}"/>
<font size="12"/>
<font color="${dayColor}"/>
<text align="left"/>
${dayText}
</document>
`;
                zIndex++;

                // 当月の休日の場合、休日名documentを追加
                if (!isOtherMonth && currentDay) {
                    const holidayName = this.getHolidayName(this.currentYear, this.currentMonth, currentDay);
                    if (holidayName) {
                        const holidayPosition = {
                            left: left + 30,
                            top: top + 2,
                            right: right - 4,
                            bottom: top + 18
                        };
                        xmlTAD += this.buildHolidayNameDocument(holidayName, holidayPosition, zIndex);
                        zIndex++;
                    }
                }
            }
        }

        // 仮身（link要素）を追加
        // 1. 日付仮身（YYYY/MM/DD形式）- 日セル内座標を計算
        // 2. 自由仮身（それ以外）- 既存の座標をそのまま使用
        const dayIndexMap = {}; // 各日の仮身インデックスを追跡
        zIndex = 200; // 仮身用の高いzIndex

        for (const vobj of this.virtualObjects) {
            const linkName = vobj.link_name;
            if (!linkName) continue;

            let left, top, right, bottom;

            if (this.isDateFormatLinkName(linkName)) {
                // 日付仮身：日セル内の座標を計算
                if (dayIndexMap[linkName] === undefined) {
                    dayIndexMap[linkName] = 0;
                }
                const indexInCell = dayIndexMap[linkName]++;

                const pos = this.calculateVirtualObjectCellPosition(linkName, indexInCell);
                if (!pos) continue;

                left = pos.left;
                top = pos.top;
                right = pos.right;
                bottom = pos.bottom;

                // 仮身オブジェクトの座標も更新
                vobj.vobjleft = left;
                vobj.vobjtop = top;
                vobj.vobjright = right;
                vobj.vobjbottom = bottom;
                vobj.width = right - left;
                vobj.heightPx = bottom - top;
            } else {
                // 自由仮身：既存の座標をそのまま使用
                left = vobj.vobjleft || 0;
                top = vobj.vobjtop || 0;
                right = vobj.vobjright || (left + 150);
                bottom = vobj.vobjbottom || (top + DEFAULT_VOBJ_HEIGHT);
            }

            // link要素を生成（自己閉じタグ形式、link_nameはJSONから取得する方式に統一）
            xmlTAD += `<link id="${vobj.link_id}" vobjleft="${left}" vobjtop="${top}" vobjright="${right}" vobjbottom="${bottom}" height="${bottom - top}" chsz="${vobj.chsz || 10}" frcol="${vobj.frcol || CALENDAR_VOBJ_FRCOL}" chcol="${vobj.chcol || DEFAULT_CHCOL}" tbcol="${vobj.tbcol || CALENDAR_VOBJ_BGCOL}" bgcol="${vobj.bgcol || CALENDAR_VOBJ_BGCOL}" dlen="0" pictdisp="${vobj.pictdisp !== undefined ? vobj.pictdisp : 'true'}" namedisp="${vobj.namedisp !== undefined ? vobj.namedisp : 'true'}" roledisp="${vobj.roledisp !== undefined ? vobj.roledisp : 'false'}" typedisp="${vobj.typedisp !== undefined ? vobj.typedisp : 'false'}" updatedisp="${vobj.updatedisp !== undefined ? vobj.updatedisp : 'false'}" framedisp="${vobj.framedisp !== undefined ? vobj.framedisp : 'true'}" autoopen="${vobj.autoopen !== undefined ? vobj.autoopen : 'false'}" zIndex="${zIndex}"/>\r\n`;
            zIndex++;
        }

        xmlTAD += `
</figure>
</tad>`;

        return xmlTAD;
    }

    /**
     * 年月実身を新規作成
     */
    async createMonthRealObject(year, month) {
        const monthName = `${year}/${String(month).padStart(2, '0')}`;
        // 図形セグメントを含むxmlTADを生成
        const initialXtad = this.buildCalendarXml(year, month);

        // 年月実身用のapplist（仮身一覧プラグインで開く、カレンダーでも開ける）
        const applist = {
            'virtual-object-list': {
                "name": "仮身一覧",
                defaultOpen: true
            },
            'base-calendar': {
                "name": "予定表",
                defaultOpen: false
            },
            'basic-text-editor': {
                "name": "基本テキストエディタ",
                defaultOpen: false
            }
        };

        // 年月実身用のwindow設定
        const windowConfig = {
            width: 800,
            height: 600,
            minWidth: 400,
            minHeight: 300
        };

        try {
            const messageId = this.generateMessageId('create');
            this.messageBus.send('create-real-object', {
                messageId: messageId,
                realName: monthName,
                initialXtad: initialXtad,
                applist: applist,
                windowConfig: windowConfig
            });

            const result = await this.messageBus.waitFor('real-object-created',
                window.DEFAULT_TIMEOUT_MS,
                (data) => data.messageId === messageId
            );

            if (result.realId) {
                this.currentMonthRealId = result.realId;
                this.currentMonthXmlData = initialXtad;
                this.virtualObjects = [];

                // 原紙アイコンをコピー（仮身一覧プラグインのアイコン）
                await this.requestCopyTemplateIcon(result.realId, 'virtual-object-list');

                // 親実身に年月仮身を追加
                await this.addMonthVirtualObjectToParent(result.realId, monthName);
            }
        } catch (error) {
            this.currentMonthRealId = null;
            this.currentMonthXmlData = null;
            this.virtualObjects = [];
        }
    }

    /**
     * 親実身に年月仮身を追加
     */
    async addMonthVirtualObjectToParent(realId, monthName) {
        if (!this.xmlData) return;

        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(this.xmlData, 'text/xml');
            // カレンダー実身は<figure>形式（仮身一覧プラグインで開く可能性があるため）
            const figureElement = xmlDoc.querySelector('figure');
            if (!figureElement) return;

            // 新しい仮身の位置を計算（縦に並べる）
            const yOffset = this.monthVirtualObjects.length * 40 + 10;

            // 仮身オブジェクトを作成（共通メソッドを使用）
            const virtualObj = this.createVirtualObjectData({
                link_id: `${realId}_0.xtad`,
                link_name: monthName,
                vobjleft: 10,
                vobjtop: yOffset,
                vobjright: 160,
                vobjbottom: yOffset + DEFAULT_VOBJ_HEIGHT,
                heightPx: DEFAULT_VOBJ_HEIGHT
            });

            // 新しいlink要素を作成（共通メソッドを使用）
            const linkElement = xmlDoc.createElement('link');
            this.buildLinkElementAttributes(linkElement, virtualObj);

            // 改行を追加してからlink要素を追加
            figureElement.appendChild(xmlDoc.createTextNode('\n'));
            figureElement.appendChild(linkElement);

            // XMLを文字列に変換
            const serializer = new XMLSerializer();
            let xmlString = serializer.serializeToString(xmlDoc);
            // <link ...>テキスト</link>を<link .../>に変換（自己閉じタグ形式に統一、改行付き）
            xmlString = xmlString.replace(/<link([^>]*)>[^<]*<\/link>/g, '<link$1/>\r\n');
            this.xmlData = xmlString;

            // 年月仮身リストに追加（全属性を含める）
            this.monthVirtualObjects.push({
                link_id: `${realId}_0.xtad`,
                link_name: monthName,
                vobjleft: 10,
                vobjtop: yOffset,
                vobjright: 160,
                vobjbottom: yOffset + DEFAULT_VOBJ_HEIGHT,
                width: 150,
                heightPx: DEFAULT_VOBJ_HEIGHT,
                chsz: virtualObj.chsz,
                frcol: virtualObj.frcol,
                chcol: virtualObj.chcol,
                tbcol: virtualObj.tbcol,
                bgcol: virtualObj.bgcol,
                dlen: virtualObj.dlen,
                pictdisp: virtualObj.pictdisp,
                namedisp: virtualObj.namedisp,
                roledisp: virtualObj.roledisp,
                typedisp: virtualObj.typedisp,
                updatedisp: virtualObj.updatedisp,
                framedisp: virtualObj.framedisp,
                autoopen: virtualObj.autoopen
            });

            // 親実身を保存
            this.saveToFile();

            this.isModified = true;
        } catch (error) {
            // エラー時は何もしない
        }
    }

    /**
     * 年月実身内の仮身を解析
     */
    async parseVirtualObjects() {
        if (!this.currentMonthXmlData) {
            this.virtualObjects = [];
            return;
        }

        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(this.currentMonthXmlData, 'text/xml');
            const linkElements = xmlDoc.getElementsByTagName('link');

            this.virtualObjects = [];

            for (const link of linkElements) {
                const virtualObj = this.parseLinkElement(link);
                if (virtualObj) {
                    // 自己閉じタグ対応: JSONから実身名を読み込み
                    await this.loadVirtualObjectMetadata(virtualObj);
                    this.virtualObjects.push(virtualObj);
                }
            }
        } catch (error) {
            this.virtualObjects = [];
        }
    }

    /**
     * カレンダーグリッドを描画
     */
    renderCalendarGrid() {
        const grid = document.getElementById('calendarGrid');
        if (!grid) return;

        grid.innerHTML = '';

        // 月の最初の日と最終日を取得
        const firstDay = new Date(this.currentYear, this.currentMonth - 1, 1);
        const lastDay = new Date(this.currentYear, this.currentMonth, 0);
        const daysInMonth = lastDay.getDate();
        const startDayOfWeek = firstDay.getDay(); // 0=日曜日

        // 前月の最終日
        const prevMonthLastDay = new Date(this.currentYear, this.currentMonth - 1, 0);
        const daysInPrevMonth = prevMonthLastDay.getDate();

        // 今日の日付
        const today = new Date();
        const isCurrentMonth = today.getFullYear() === this.currentYear &&
                               (today.getMonth() + 1) === this.currentMonth;
        const todayDate = today.getDate();

        // 6週分（42日）のセルを生成
        let dayCounter = 1;
        let nextMonthDay = 1;

        for (let i = 0; i < 42; i++) {
            const cell = document.createElement('div');
            cell.className = 'day-cell';

            // 日付ヘッダー（日付番号と休日名を含む）
            const dayHeader = document.createElement('div');
            dayHeader.className = 'day-header';

            const dayNumber = document.createElement('div');
            dayNumber.className = 'day-number';

            const dayEvents = document.createElement('div');
            dayEvents.className = 'day-events';

            const dayOfWeek = i % 7;
            let holidayName = null;

            if (i < startDayOfWeek) {
                // 前月の日
                const day = daysInPrevMonth - startDayOfWeek + i + 1;
                dayNumber.textContent = String(day);
                dayNumber.classList.add('other-month');
                cell.classList.add('other-month');
            } else if (dayCounter <= daysInMonth) {
                // 当月の日
                const day = dayCounter;
                dayNumber.textContent = String(day);

                // 休日を取得
                holidayName = this.getHolidayName(this.currentYear, this.currentMonth, day);

                // 曜日の色（休日の場合も日曜色にする）
                if (dayOfWeek === 0 || holidayName) {
                    dayNumber.classList.add('sunday');
                } else if (dayOfWeek === 6) {
                    dayNumber.classList.add('saturday');
                }

                // 今日のハイライト
                if (isCurrentMonth && day === todayDate) {
                    cell.classList.add('today');
                }

                // セルのドラッグイベント（範囲指定で実身作成）
                cell.addEventListener('mousedown', (e) => {
                    // 仮身上でのクリックは除外
                    if (e.target.closest('.event-item')) return;
                    this.handleDayCellMouseDown(e, day);
                });
                cell.addEventListener('mouseup', (e) => {
                    // 仮身上でのクリックは除外
                    if (e.target.closest('.event-item')) return;
                    this.handleDayCellMouseUp(e, day);
                });

                // この日の仮身を表示
                this.renderDayVirtualObjects(dayEvents, day);

                dayCounter++;
            } else {
                // 翌月の日
                dayNumber.textContent = String(nextMonthDay);
                dayNumber.classList.add('other-month');
                cell.classList.add('other-month');
                nextMonthDay++;
            }

            // 日付ヘッダーを構築
            dayHeader.appendChild(dayNumber);

            // 休日名があれば表示
            if (holidayName) {
                const holidayLabel = document.createElement('div');
                holidayLabel.className = 'holiday-name';
                holidayLabel.textContent = holidayName;
                dayHeader.appendChild(holidayLabel);
            }

            cell.appendChild(dayHeader);
            cell.appendChild(dayEvents);
            grid.appendChild(cell);
        }

        // 自由仮身を描画
        this.renderFreeVirtualObjects();
    }

    /**
     * 日セルに仮身を描画
     */
    renderDayVirtualObjects(container, day) {
        // この日に属する仮身をフィルタ（仮身名から日付を抽出）
        const dayStr = String(day).padStart(2, '0');
        const datePrefix = `${this.currentYear}/${String(this.currentMonth).padStart(2, '0')}/${dayStr}`;

        const dayVobjs = this.virtualObjects.filter(vobj => {
            return vobj.link_name && vobj.link_name.startsWith(datePrefix);
        });

        dayVobjs.forEach(vobj => {
            const eventItem = document.createElement('div');
            eventItem.className = 'event-item';

            // アイコン（省略可）
            const iconSpan = document.createElement('span');
            iconSpan.className = 'virtual-object-icon';
            iconSpan.textContent = '';

            // タイトル
            const titleSpan = document.createElement('span');
            titleSpan.className = 'event-title';
            // 日付部分を除いたタイトルを表示
            let displayTitle = vobj.link_name;
            if (displayTitle.startsWith(datePrefix)) {
                displayTitle = displayTitle.substring(datePrefix.length).trim() || vobj.link_name;
            }
            titleSpan.textContent = displayTitle;

            eventItem.appendChild(iconSpan);
            eventItem.appendChild(titleSpan);

            // 仮身インデックスをデータ属性に保存
            const vobjIndex = this.virtualObjects.indexOf(vobj);
            eventItem.dataset.vobjIndex = vobjIndex;

            // シングルクリックで選択
            eventItem.addEventListener('click', (e) => {
                e.stopPropagation();
                this.selectDayVirtualObject(eventItem, vobjIndex);
            });

            // ダブルクリックで実身を開く
            eventItem.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                this.openVirtualObject(vobj);
            });

            // 右クリックでコンテキストメニュー
            eventItem.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                // 選択状態にしてからコンテキストメニュー表示
                this.selectDayVirtualObject(eventItem, vobjIndex);
                this.contextMenuVirtualObject = {
                    element: eventItem,
                    virtualObj: vobj,
                    realId: this.extractRealId(vobj.link_id)
                };
                this.showContextMenuAtEvent(e);
            });

            container.appendChild(eventItem);
        });
    }

    /**
     * 日付仮身を選択
     * @param {HTMLElement} element - 仮身要素
     * @param {number} vobjIndex - 仮身インデックス
     */
    selectDayVirtualObject(element, vobjIndex) {
        // 既存の選択をクリア
        this.clearDayVirtualObjectSelection();

        // 新しい選択を追加
        this.selectedVirtualObjects.add(vobjIndex);
        element.classList.add('selected');
    }

    /**
     * 日付仮身の選択をクリア
     */
    clearDayVirtualObjectSelection() {
        // DOMから選択クラスを削除
        const selectedElements = document.querySelectorAll('.event-item.selected');
        selectedElements.forEach(el => el.classList.remove('selected'));

        // 選択状態をクリア
        this.selectedVirtualObjects.clear();
    }

    // ===== 自由仮身関連メソッド =====

    /**
     * 仮身名が日付形式（YYYY/MM/DD）かどうかを判定
     * @param {string} linkName - 仮身名
     * @returns {boolean}
     */
    isDateFormatLinkName(linkName) {
        if (!linkName) return false;
        return /^\d{4}\/\d{2}\/\d{2}$/.test(linkName);
    }

    /**
     * 選択中の仮身を1つ取得
     * @returns {Object|null} 選択中の仮身オブジェクト
     */
    getSelectedVirtualObject() {
        if (!this.virtualObjects || this.selectedVirtualObjects.size === 0) {
            return null;
        }
        const selectedIndex = Array.from(this.selectedVirtualObjects)[0];
        return this.virtualObjects[selectedIndex] || null;
    }

    /**
     * 仮身の選択をクリア（日付仮身・自由仮身両方）
     */
    clearVirtualObjectSelection() {
        this.selectedVirtualObjects.clear();
        // 日付仮身の選択解除
        const eventItems = document.querySelectorAll('.event-item.selected');
        eventItems.forEach(el => el.classList.remove('selected'));
        // 自由仮身の選択解除
        const freeVobjs = document.querySelectorAll('.free-vobj-canvas .virtual-object-closed.selected');
        freeVobjs.forEach(el => {
            el.classList.remove('selected');
            el.style.outline = '';
        });
    }

    /**
     * 仮身を選択
     * @param {number} vobjIndex - 仮身のインデックス
     * @param {boolean} addToSelection - 既存選択に追加するか（Shift/Ctrl）
     */
    selectVirtualObject(vobjIndex, addToSelection = false) {
        if (!addToSelection) {
            this.clearVirtualObjectSelection();
        }
        this.selectedVirtualObjects.add(vobjIndex);
        this.updateVirtualObjectSelectionDisplay();
    }

    /**
     * 仮身選択表示を更新
     */
    updateVirtualObjectSelectionDisplay() {
        // 日付仮身
        const eventItems = document.querySelectorAll('.event-item');
        eventItems.forEach(el => {
            const index = parseInt(el.dataset.vobjIndex);
            if (this.selectedVirtualObjects.has(index)) {
                el.classList.add('selected');
            } else {
                el.classList.remove('selected');
            }
        });
        // 自由仮身
        const freeVobjs = document.querySelectorAll('.free-vobj-canvas .virtual-object-closed');
        freeVobjs.forEach(el => {
            const index = parseInt(el.dataset.vobjIndex);
            if (this.selectedVirtualObjects.has(index)) {
                el.classList.add('selected');
                el.style.outline = '2px solid ${SELECTION_COLOR}';
            } else {
                el.classList.remove('selected');
                el.style.outline = '';
            }
        });
    }

    /**
     * 自由仮身（非日付形式）をキャンバスに描画
     */
    renderFreeVirtualObjects() {
        let canvas = document.querySelector('.free-vobj-canvas');
        if (!canvas) {
            canvas = document.createElement('div');
            canvas.className = 'free-vobj-canvas';
            const container = document.querySelector('.calendar-container');
            if (container) {
                container.appendChild(canvas);
            }
        }
        canvas.innerHTML = '';

        // 非日付仮身をフィルタ
        const freeVobjs = this.virtualObjects.filter(vobj =>
            !this.isDateFormatLinkName(vobj.link_name)
        );

        freeVobjs.forEach((vobj) => {
            const vobjIndex = this.virtualObjects.indexOf(vobj);
            const element = this.createFreeVirtualObjectElement(vobj, vobjIndex);
            canvas.appendChild(element);

            // 開いた仮身の場合はコンテンツを展開
            if (element.classList.contains('virtual-object-opened')) {
                // DOM追加後に非同期で展開（仮身一覧と同じパターン）
                setTimeout(() => {
                    this.expandVirtualObject(element, vobj, {
                        readonly: true,
                        noScrollbar: true,
                        bgcol: vobj.bgcol
                    }).catch(err => {
                        console.error('[BaseCalendar] 開いた仮身の展開エラー:', err);
                    });
                }, 0);
            }
        });
    }

    /**
     * 自由仮身のDOM要素を作成
     * 仮身一覧プラグインと同様のパターン：createBlockElementの戻り値を直接使用
     * @param {Object} vobj - 仮身オブジェクト
     * @param {number} vobjIndex - 仮身インデックス
     * @returns {HTMLElement}
     */
    createFreeVirtualObjectElement(vobj, vobjIndex) {
        let element;

        // VirtualObjectRendererで描画（仮身一覧と同じパターン）
        if (this.virtualObjectRenderer) {
            // createBlockElementは位置・サイズ設定済みの要素を返す
            element = this.virtualObjectRenderer.createBlockElement(vobj, {
                loadIconCallback: (realId) => this.iconManager ? this.iconManager.loadIcon(realId) : null,
                vobjIndex: vobjIndex
            });
        }

        // VirtualObjectRendererがない場合のフォールバック
        if (!element) {
            element = document.createElement('div');
            element.className = 'virtual-object virtual-object-closed';
            element.style.position = 'absolute';
            element.style.left = `${vobj.vobjleft || 0}px`;
            element.style.top = `${vobj.vobjtop || 0}px`;
            element.style.width = `${(vobj.vobjright - vobj.vobjleft) || 150}px`;
            element.textContent = vobj.link_name || '(名前なし)';
            element.style.background = vobj.bgcol || CALENDAR_VOBJ_BGCOL;
            element.style.border = `1px solid ${vobj.frcol || CALENDAR_VOBJ_FRCOL}`;
            element.style.padding = '2px 4px';
            element.style.fontSize = '10px';
            element.style.overflow = 'hidden';
            element.style.textOverflow = 'ellipsis';
            element.style.whiteSpace = 'nowrap';
        }

        // データ属性を設定
        element.dataset.vobjIndex = vobjIndex;
        element.dataset.linkId = vobj.link_id;

        // 選択状態を反映
        if (this.selectedVirtualObjects.has(vobjIndex)) {
            element.classList.add('selected');
            element.style.outline = '2px solid ${SELECTION_COLOR}';
        }

        // マウスハンドラを設定
        this.setupFreeVobjMouseHandlers(element, vobj, vobjIndex);

        return element;
    }

    /**
     * 自由仮身のマウスハンドラを設定
     * @param {HTMLElement} element - 仮身要素
     * @param {Object} vobj - 仮身オブジェクト
     * @param {number} vobjIndex - 仮身インデックス
     */
    setupFreeVobjMouseHandlers(element, vobj, vobjIndex) {
        // クリックで選択
        element.addEventListener('click', (e) => {
            e.stopPropagation();
            this.handleFreeVobjClick(e, vobj, vobjIndex);
        });

        // ダブルクリックで開く
        element.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            this.handleFreeVobjDblClick(e, vobj, vobjIndex);
        });

        // 右クリックでコンテキストメニュー
        element.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.selectVirtualObject(vobjIndex, false);
            this.contextMenuVirtualObject = {
                element: element,
                virtualObj: vobj,
                realId: this.extractRealId(vobj.link_id)
            };
            this.showContextMenuAtEvent(e);
        });

        // ドラッグ開始（captureモードで登録することで、開いた仮身のコンテンツエリア上でも確実にキャプチャ）
        element.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return; // 左クリックのみ

            // リサイズエリアの場合はドラッグを開始しない
            const rect = element.getBoundingClientRect();
            const isRightEdge = e.clientX > rect.right - 10 && e.clientX <= rect.right + 10;
            const isBottomEdge = e.clientY > rect.bottom - 10 && e.clientY <= rect.bottom + 10;
            if (isRightEdge || isBottomEdge) {
                return; // リサイズ処理に任せる
            }

            e.stopPropagation();

            // 選択されていない場合は選択
            if (!this.selectedVirtualObjects.has(vobjIndex)) {
                this.selectVirtualObject(vobjIndex, e.ctrlKey || e.shiftKey);
            }

            // ドラッグ状態を初期化
            this.vobjDragState.currentObject = vobj;
            this.vobjDragState.currentElement = element;
            this.vobjDragState.vobjIndex = vobjIndex;
            this.vobjDragState.initialLeft = vobj.vobjleft || 0;
            this.vobjDragState.initialTop = vobj.vobjtop || 0;

            // PluginBaseのドラッグ開始処理を利用
            this.initializeVirtualObjectDragStart(e);
        }, { capture: true });

        // リサイズ機能を追加
        this.makeVirtualObjectResizable(element, vobj);

        // 注: ドラッグ中・ドラッグ終了の処理はdocumentレベルで行う
        // （マウスが要素外に出てもドラッグを継続するため）
    }

    /**
     * 自由仮身のクリック処理
     * @param {MouseEvent} e - マウスイベント
     * @param {Object} vobj - 仮身オブジェクト
     * @param {number} vobjIndex - 仮身インデックス
     */
    handleFreeVobjClick(e, vobj, vobjIndex) {
        // Ctrl/Shiftで複数選択
        this.selectVirtualObject(vobjIndex, e.ctrlKey || e.shiftKey);
    }

    /**
     * 自由仮身のダブルクリック処理
     * @param {MouseEvent} e - マウスイベント
     * @param {Object} vobj - 仮身オブジェクト
     * @param {number} vobjIndex - 仮身インデックス
     */
    handleFreeVobjDblClick(e, vobj, vobjIndex) {
        this.openVirtualObject(vobj);
    }

    /**
     * 全てのiframeのpointer-eventsを制御
     * @param {boolean} enabled - trueで有効化、falseで無効化
     */
    setIframesPointerEvents(enabled) {
        const iframes = document.querySelectorAll('.virtual-object-content-iframe, .virtual-object-content');
        iframes.forEach(iframe => {
            iframe.style.pointerEvents = enabled ? 'auto' : 'none';
        });
        console.log('[BaseCalendar] iframeのpointer-events:', enabled ? '有効化' : '無効化', 'iframe数:', iframes.length);
    }

    /**
     * 仮身要素をリサイズ可能にする
     * @param {HTMLElement} vobjElement - 仮身のDOM要素
     * @param {Object} obj - 仮身オブジェクト
     */
    makeVirtualObjectResizable(vobjElement, obj) {
        // マウス移動でカーソルを変更（リサイズエリアの表示）
        vobjElement.addEventListener('mousemove', (e) => {
            // リサイズ中またはドラッグ中はカーソル変更しない
            if (this.isResizing || this.virtualObjectDragState.isDragging) return;

            const rect = vobjElement.getBoundingClientRect();
            // リサイズエリア：枠の内側10pxから外側10pxまで
            const isRightEdge = e.clientX > rect.right - 10 && e.clientX <= rect.right + 10;
            const isBottomEdge = e.clientY > rect.bottom - 10 && e.clientY <= rect.bottom + 10;

            // カーソルの形状を変更
            if (isRightEdge && isBottomEdge) {
                vobjElement.style.cursor = 'nwse-resize'; // 右下: 斜めリサイズ
            } else if (isRightEdge) {
                vobjElement.style.cursor = 'ew-resize'; // 右: 横リサイズ
            } else if (isBottomEdge) {
                vobjElement.style.cursor = 'ns-resize'; // 下: 縦リサイズ
            } else {
                vobjElement.style.cursor = 'pointer'; // 通常: ポインタ
            }
        });

        // マウスが仮身から離れたらカーソルを元に戻す
        vobjElement.addEventListener('mouseleave', () => {
            if (!this.isResizing) {
                vobjElement.style.cursor = 'pointer';
            }
        });

        // マウスダウンでリサイズ開始
        vobjElement.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return; // 左クリックのみ

            const rect = vobjElement.getBoundingClientRect();
            // リサイズエリア：枠の内側10pxから外側10pxまで
            const isRightEdge = e.clientX > rect.right - 10 && e.clientX <= rect.right + 10;
            const isBottomEdge = e.clientY > rect.bottom - 10 && e.clientY <= rect.bottom + 10;

            // リサイズエリア（枠の内側10pxから外側10pxまで）のクリックのみ処理
            if (!isRightEdge && !isBottomEdge) {
                return;
            }

            // リサイズ中は新しいリサイズを開始しない
            if (this.isResizing) {
                console.log('[BaseCalendar] リサイズ中のため、新しいリサイズを無視');
                return;
            }

            e.preventDefault();
            e.stopPropagation();

            // リサイズ開始フラグを設定
            this.isResizing = true;

            // iframeのpointer-eventsを無効化してリサイズをスムーズに
            this.setIframesPointerEvents(false);

            // ウィンドウのリサイズハンドルを一時的に無効化
            this.messageBus.send('disable-window-resize');

            // リサイズモード開始
            const startX = e.clientX;
            const startY = e.clientY;
            const startWidth = rect.width;
            const startHeight = rect.height;
            const minWidth = 50;

            // VirtualObjectRendererのユーティリティメソッドを使用して最小高さを計算
            const chsz = Math.round(obj.chsz || DEFAULT_FONT_SIZE);
            const minClosedHeight = this.virtualObjectRenderer.getMinClosedHeight(chsz);
            const minOpenHeight = this.virtualObjectRenderer.getMinOpenHeight(chsz);

            // DOMから実際のコンテンツエリアの有無で開閉状態を判定
            const hasContentArea = vobjElement.querySelector('.virtual-object-content-area') !== null ||
                                  vobjElement.querySelector('.virtual-object-content-iframe') !== null;

            // リサイズ中は閉じた仮身の最小高さまで小さくできるようにする
            const minHeight = minClosedHeight;

            // 初期高さを閾値に基づいて設定
            let currentWidth = startWidth;
            let currentHeight;
            if (startHeight < minOpenHeight) {
                currentHeight = minClosedHeight;
            } else {
                currentHeight = startHeight;
            }

            console.log('[BaseCalendar] 仮身リサイズ開始:', obj.link_name, 'startWidth:', startWidth, 'startHeight:', startHeight);

            // リサイズプレビュー枠を作成
            const previewBox = document.createElement('div');
            previewBox.style.position = 'fixed';
            previewBox.style.left = `${rect.left}px`;
            previewBox.style.top = `${rect.top}px`;
            previewBox.style.width = `${currentWidth}px`;
            previewBox.style.height = `${currentHeight}px`;
            previewBox.style.border = '2px dashed rgba(0, 123, 255, 0.8)';
            previewBox.style.backgroundColor = 'rgba(0, 123, 255, 0.1)';
            previewBox.style.pointerEvents = 'none';
            previewBox.style.zIndex = '999999';
            previewBox.style.boxSizing = 'border-box';
            document.body.appendChild(previewBox);

            // 開いた仮身内のiframeのpointer-eventsを無効化
            const iframe = vobjElement.querySelector('iframe');
            if (iframe) {
                iframe.style.pointerEvents = 'none';
            }

            const onMouseMove = (moveEvent) => {
                if (isRightEdge) {
                    const deltaX = moveEvent.clientX - startX;
                    currentWidth = Math.max(minWidth, startWidth + deltaX);
                    previewBox.style.width = `${currentWidth}px`;
                }

                if (isBottomEdge) {
                    const deltaY = moveEvent.clientY - startY;
                    let newHeight = Math.max(minHeight, startHeight + deltaY);

                    // 閾値に基づいて高さをスナップ
                    if (newHeight < minOpenHeight) {
                        currentHeight = minClosedHeight;
                    } else {
                        currentHeight = newHeight;
                    }

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

                // iframeのpointer-eventsを元に戻す
                if (iframe) {
                    iframe.style.pointerEvents = 'auto';
                }

                // カーソルを元に戻す
                vobjElement.style.cursor = 'pointer';

                // 最終的なサイズを取得
                const finalWidth = Math.round(currentWidth);
                const finalHeight = Math.round(currentHeight);

                // 実際の要素のサイズを更新
                vobjElement.style.width = `${finalWidth}px`;
                vobjElement.style.height = `${finalHeight}px`;

                // 仮身オブジェクトのサイズを更新
                // 注: DOM要素の高さ（finalHeight）はborderを含む（box-sizing: border-box）
                // TADファイルのheight属性はborderを含まない値を保存する
                const heightForSave = finalHeight - VOBJ_BORDER_WIDTH;
                obj.width = finalWidth;
                obj.heightPx = heightForSave;
                obj.vobjright = obj.vobjleft + finalWidth;
                obj.vobjbottom = obj.vobjtop + heightForSave;

                console.log('[BaseCalendar] 仮身リサイズ終了:', obj.link_name, 'newWidth:', finalWidth, 'newHeight:', finalHeight);

                // 年月実身を保存
                this.saveMonthToFile();
                this.isModified = true;

                // 開いた仮身と閉じた仮身の判定が変わったかチェック
                // VirtualObjectRendererのユーティリティメソッドを使用
                const chsz_resize = Math.round(obj.chsz || DEFAULT_FONT_SIZE);
                const minClosedHeight_resize = this.virtualObjectRenderer.getMinClosedHeight(chsz_resize);
                const wasOpen = hasContentArea;
                // VirtualObjectRendererと同じ閾値を使用: height > minClosedHeight
                const isNowOpen = finalHeight > minClosedHeight_resize;

                if (wasOpen !== isNowOpen) {
                    console.log('[BaseCalendar] 開いた仮身/閉じた仮身の判定が変わりました。再描画します。');

                    // 既存のタイマーをクリア
                    if (this.recreateVirtualObjectTimer) {
                        clearTimeout(this.recreateVirtualObjectTimer);
                    }

                    // 開閉状態を更新
                    if (isNowOpen) {
                        obj.opened = true;
                    } else {
                        obj.opened = false;
                        obj.heightPx = minClosedHeight_resize;
                        obj.vobjbottom = obj.vobjtop + minClosedHeight_resize;
                        vobjElement.style.height = `${minClosedHeight_resize}px`;
                        // 保存を再実行
                        this.saveMonthToFile();
                    }

                    // 遅延して再描画
                    this.recreateVirtualObjectTimer = setTimeout(() => {
                        this.renderFreeVirtualObjects();
                        this.recreateVirtualObjectTimer = null;
                    }, 150);
                }

                // ウィンドウのリサイズハンドルを再有効化
                this.messageBus.send('enable-window-resize');

                // リサイズ終了フラグをリセット
                this.isResizing = false;

                // iframesのpointer-eventsを元に戻す
                this.setIframesPointerEvents(true);
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        }, { capture: true }); // captureモードで先にイベントをキャッチ
    }

    /**
     * ドラッグアンドドロップを設定
     */
    setupDragAndDrop() {
        const container = document.querySelector('.plugin-content');
        if (!container) return;

        // グローバルなdragoverイベントリスナー（仮身一覧と同様のパターン）
        // 親ウィンドウからiframeへのドラッグ時にdropEffectを設定
        document.addEventListener('dragover', (e) => {
            e.preventDefault();
            // effectAllowedに基づいてdropEffectを設定
            const effectAllowed = e.dataTransfer.effectAllowed;
            if (effectAllowed === 'move') {
                e.dataTransfer.dropEffect = 'move';
            } else if (effectAllowed === 'copyMove') {
                e.dataTransfer.dropEffect = 'copy';
            } else {
                e.dataTransfer.dropEffect = 'copy';
            }
        });

        container.addEventListener('dragover', (e) => {
            e.preventDefault();
            // effectAllowedに基づいてdropEffectを設定
            const effectAllowed = e.dataTransfer.effectAllowed;
            if (effectAllowed === 'move') {
                e.dataTransfer.dropEffect = 'move';
            } else {
                e.dataTransfer.dropEffect = 'copy';
            }
        });

        container.addEventListener('drop', (e) => {
            e.preventDefault();
            this.handleDropEvent(e);
        });
    }

    /**
     * ドロップイベントを処理
     * @param {Event} e - ドロップイベント
     */
    async handleDropEvent(e) {
        // URLドロップをチェック（PluginBase共通メソッド）
        const dropX = e.clientX;
        const dropY = e.clientY;
        if (this.checkAndHandleUrlDrop(e, dropX, dropY)) {
            return; // URLドロップは親ウィンドウで処理
        }

        const dragData = this.parseDragData(e.dataTransfer);
        if (!dragData) {
            console.warn('[BaseCalendar] handleDropEvent: dragDataをパースできません');
            return;
        }

        console.log('[BaseCalendar] handleDropEvent:', dragData.type);

        if (dragData.type === 'virtual-object-drag') {
            const virtualObjects = dragData.virtualObjects || [dragData.virtualObject];
            console.log('[BaseCalendar] 仮身ドロップ:', virtualObjects.length, '個');

            for (const vobj of virtualObjects) {
                // 自由仮身として追加（名前は変更しない）
                const result = await this.addFreeVirtualObjectToMonth(vobj, e.clientX, e.clientY);
                console.log('[BaseCalendar] addFreeVirtualObjectToMonth結果:', result ? '成功' : '失敗');
            }

            // クロスウィンドウドロップ成功を通知
            if (dragData.sourceWindowId && dragData.sourceWindowId !== this.windowId) {
                console.log('[BaseCalendar] クロスウィンドウドロップ成功通知送信');
                this.notifyCrossWindowDropSuccess(dragData, virtualObjects);
            }

            this.renderCalendarGrid();
            this.renderFreeVirtualObjects();
        } else if (dragData.type === 'archive-file-extract') {
            // 書庫一覧からのドロップ
            // 親ウィンドウに書庫ドロップ処理を委譲（unpack-fileプラグインに通知される）
            this.messageBus.send('archive-drop-detected', {
                dropPosition: { x: e.clientX, y: e.clientY },
                dragData: dragData,
                targetWindowId: dragData.windowId,
                sourceWindowId: this.windowId
            });
        } else if (dragData.type === 'base-file-copy' || dragData.type === 'user-base-file-copy') {
            // 原紙箱からのドロップ
            // 親ウィンドウに原紙ドロップ処理を委譲
            this.messageBus.send('base-file-drop-request', {
                dropPosition: { x: e.clientX, y: e.clientY },
                clientX: e.clientX,
                clientY: e.clientY,
                dragData: dragData
            });
        }
    }

    /**
     * 自由仮身を年月実身に追加
     * @param {Object} virtualObj - 仮身オブジェクト
     * @param {number} clientX - ドロップX座標
     * @param {number} clientY - ドロップY座標
     */
    async addFreeVirtualObjectToMonth(virtualObj, clientX, clientY) {
        if (!this.currentMonthXmlData) {
            return null;
        }

        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(this.currentMonthXmlData, 'text/xml');
            const figureElement = xmlDoc.querySelector('figure');
            if (!figureElement) {
                return null;
            }

            // ドロップ座標をカレンダーコンテナ座標に変換
            const calendarContainer = document.querySelector('.calendar-container');
            const rect = calendarContainer ? calendarContainer.getBoundingClientRect() : { left: 0, top: 0, width: 600, height: 400 };

            let dropX = clientX - rect.left;
            let dropY = clientY - rect.top;

            // 座標をコンテナ内に収める
            dropX = Math.max(10, Math.min(dropX, rect.width - 160));
            dropY = Math.max(10, Math.min(dropY, rect.height - 40));

            // 仮身のサイズ
            const width = (virtualObj.vobjright - virtualObj.vobjleft) || 150;
            const height = (virtualObj.vobjbottom - virtualObj.vobjtop) || DEFAULT_VOBJ_HEIGHT;

            // 元の仮身から属性を引き継ぐ（共通メソッドを使用）
            const newVirtualObj = this.createVirtualObjectData({
                link_id: virtualObj.link_id,
                link_name: virtualObj.link_name,
                vobjleft: dropX,
                vobjtop: dropY,
                vobjright: dropX + width,
                vobjbottom: dropY + height,
                heightPx: height,
                chsz: virtualObj.chsz,
                frcol: virtualObj.frcol,
                chcol: virtualObj.chcol,
                tbcol: virtualObj.tbcol,
                bgcol: virtualObj.bgcol,
                dlen: virtualObj.dlen,
                pictdisp: virtualObj.pictdisp,
                namedisp: virtualObj.namedisp,
                roledisp: virtualObj.roledisp,
                typedisp: virtualObj.typedisp,
                updatedisp: virtualObj.updatedisp,
                framedisp: virtualObj.framedisp,
                autoopen: virtualObj.autoopen
            });

            // 新しいlink要素を作成（共通メソッドを使用）
            const linkElement = xmlDoc.createElement('link');
            this.buildLinkElementAttributes(linkElement, newVirtualObj);

            // 改行を追加してからlink要素を追加
            figureElement.appendChild(xmlDoc.createTextNode('\n'));
            figureElement.appendChild(linkElement);

            // XMLを文字列に変換
            const serializer = new XMLSerializer();
            let xmlString = serializer.serializeToString(xmlDoc);
            // <link ...>テキスト</link>を<link .../>に変換（自己閉じタグ形式に統一、改行付き）
            xmlString = xmlString.replace(/<link([^>]*)>[^<]*<\/link>/g, '<link$1/>\r\n');
            this.currentMonthXmlData = xmlString;

            // 仮身リストに追加
            this.virtualObjects.push({
                link_id: virtualObj.link_id,
                link_name: virtualObj.link_name,
                vobjleft: dropX,
                vobjtop: dropY,
                vobjright: dropX + width,
                vobjbottom: dropY + height,
                width: width,
                heightPx: height,
                chsz: newVirtualObj.chsz,
                frcol: newVirtualObj.frcol,
                chcol: newVirtualObj.chcol,
                tbcol: newVirtualObj.tbcol,
                bgcol: newVirtualObj.bgcol,
                dlen: newVirtualObj.dlen,
                pictdisp: newVirtualObj.pictdisp,
                namedisp: newVirtualObj.namedisp,
                roledisp: newVirtualObj.roledisp,
                typedisp: newVirtualObj.typedisp,
                updatedisp: newVirtualObj.updatedisp,
                framedisp: newVirtualObj.framedisp,
                autoopen: newVirtualObj.autoopen
            });

            // 年月実身を保存
            this.saveMonthToFile();

            this.isModified = true;

            return virtualObj.link_name;
        } catch (error) {
            return null;
        }
    }

    /**
     * 日セルのマウスダウン処理（範囲指定開始）
     * @param {MouseEvent} e - マウスイベント
     * @param {number} day - 日
     */
    handleDayCellMouseDown(e, day) {
        // 仮身以外をクリックした場合は選択解除
        if (!e.target.closest('.event-item')) {
            this.clearDayVirtualObjectSelection();
        }

        this.dayCreationDrag = {
            isActive: true,
            startX: e.clientX,
            startY: e.clientY,
            day: day
        };

        // 選択枠を表示（カレンダーグリッド内での相対座標）
        const grid = document.getElementById('calendarGrid');
        if (grid) {
            const rect = grid.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            this.startRangeSelection(grid, x, y);
        }
    }

    /**
     * 日セルのマウスアップ処理（範囲指定終了）
     * @param {MouseEvent} e - マウスイベント
     * @param {number} day - 日
     */
    async handleDayCellMouseUp(e, day) {
        // 選択枠を終了
        this.endRangeSelection();

        if (!this.dayCreationDrag.isActive) return;

        const dx = Math.abs(e.clientX - this.dayCreationDrag.startX);
        const dy = Math.abs(e.clientY - this.dayCreationDrag.startY);

        // 10x10px以上の範囲指定の場合のみ実身を作成
        const THRESHOLD = 10;
        if (dx >= THRESHOLD && dy >= THRESHOLD) {
            // ドラッグ開始位置の日を使用
            // 座標は一時的な値を使用し、後でカレンダー表示の実際の位置に更新する
            await this.createDayRealObject(
                this.currentYear,
                this.currentMonth,
                this.dayCreationDrag.day,
                {
                    // カレンダー表示スタイルに合わせたデフォルト属性
                    attributes: {
                        chsz: 10,              // font-size: 10px
                        tbcol: CALENDAR_VOBJ_BGCOL,      // background: #e8f4ff
                        frcol: CALENDAR_VOBJ_FRCOL,      // border: #b0c0d0
                        chcol: DEFAULT_CHCOL,      // text color: black
                        bgcol: CALENDAR_VOBJ_BGCOL,      // background: #e8f4ff
                        pictdisp: true,
                        namedisp: true,
                        framedisp: true,
                        roledisp: false,
                        typedisp: false,
                        updatedisp: false,
                        autoopen: false
                    }
                }
            );
        }

        // ドラッグ状態をリセット
        this.dayCreationDrag = {
            isActive: false,
            startX: 0,
            startY: 0,
            day: null
        };
    }

    /**
     * 年月日実身を作成
     * @param {number} year - 年
     * @param {number} month - 月
     * @param {number} day - 日
     * @param {Object} [options={}] - オプション
     * @param {number} [options.vobjleft] - 仮身左座標
     * @param {number} [options.vobjtop] - 仮身上座標
     * @param {number} [options.width] - 仮身幅
     * @param {number} [options.height] - 仮身高さ
     */
    async createDayRealObject(year, month, day, options = {}) {
        const dayName = `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`;

        // 既存の仮身があるかチェック
        const existingVobj = this.virtualObjects.find(vobj => vobj.link_name === dayName);
        if (existingVobj) {
            // 既存の実身を開く
            this.openVirtualObject(existingVobj);
            return;
        }

        // テンプレート仮身を検索
        let initialXtad = null;
        const templateVobj = this.findDayTemplateVirtualObject();

        if (templateVobj) {
            // テンプレートがある場合: テンプレートを読み込んで日付を適用
            const realIdFromLink = templateVobj.link_id.replace(/_\d+\.xtad$/i, '');
            const templateXtad = await this.loadRealObjectXtad(realIdFromLink);
            if (templateXtad) {
                initialXtad = this.applyDateToTemplate(templateXtad, dayName);
            }
        }

        if (!initialXtad) {
            // テンプレートがない場合: 従来通り自動生成
            initialXtad = this.buildTextDocumentXml(dayName, {
                fontSize: 20,
                align: 'center',
                filename: dayName
            });
        }

        // 年月日実身用のapplist（基本文章編集で開く）
        const applist = {
            'basic-text-editor': {
                name: '基本文章編集',
                defaultOpen: true
            },
            'basic-figure-editor': {
                name: '基本図形編集',
                defaultOpen: false
            }
        };

        try {
            const messageId = this.generateMessageId('create-day');
            this.messageBus.send('create-real-object', {
                messageId: messageId,
                realName: dayName,
                initialXtad: initialXtad,
                applist: applist
            });

            const result = await this.messageBus.waitFor('real-object-created',
                window.DEFAULT_TIMEOUT_MS,
                (data) => data.messageId === messageId
            );

            if (result.realId) {
                // 原紙アイコンをコピー（基本文章編集プラグインのアイコン）
                await this.requestCopyTemplateIcon(result.realId, 'basic-text-editor');

                // 年月実身に仮身を追加
                await this.addDayVirtualObjectToMonth(result.realId, dayName, options);

                // カレンダーを再描画
                this.renderCalendarGrid();
            }
        } catch (error) {
            // エラー時は何もしない
        }
    }

    /**
     * 年月実身に年月日仮身を追加
     * @param {string} realId - 実身ID
     * @param {string} dayName - 日名（YYYY/MM/DD形式）
     * @param {Object} [options={}] - オプション
     * @param {number} [options.vobjleft] - 仮身左座標
     * @param {number} [options.vobjtop] - 仮身上座標
     * @param {number} [options.width] - 仮身幅
     * @param {number} [options.height] - 仮身高さ
     * @param {Object} [options.attributes] - 仮身属性（色など）
     */
    async addDayVirtualObjectToMonth(realId, dayName, options = {}) {
        if (!this.currentMonthXmlData) return;

        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(this.currentMonthXmlData, 'text/xml');
            const figureElement = xmlDoc.querySelector('figure');
            if (!figureElement) return;

            // 座標計算（既存仮身との重なりを回避）
            const coords = this.calculateVirtualObjectPosition(options);

            // 属性を取得（オプションから、またはデフォルト値）
            const attrs = options.attributes || {};

            // 仮身オブジェクトを作成（共通メソッドを使用）
            const virtualObj = this.createVirtualObjectData({
                link_id: `${realId}_0.xtad`,
                link_name: dayName,
                vobjleft: coords.left,
                vobjtop: coords.top,
                vobjright: coords.right,
                vobjbottom: coords.bottom,
                heightPx: coords.height,
                chsz: attrs.chsz,
                frcol: attrs.frcol,
                chcol: attrs.chcol,
                tbcol: attrs.tbcol,
                bgcol: attrs.bgcol,
                dlen: attrs.dlen,
                pictdisp: attrs.pictdisp,
                namedisp: attrs.namedisp,
                roledisp: attrs.roledisp,
                typedisp: attrs.typedisp,
                updatedisp: attrs.updatedisp,
                framedisp: attrs.framedisp,
                autoopen: attrs.autoopen
            });

            // 新しいlink要素を作成（共通メソッドを使用）
            const linkElement = xmlDoc.createElement('link');
            this.buildLinkElementAttributes(linkElement, virtualObj);

            // 改行を追加してからlink要素を追加
            figureElement.appendChild(xmlDoc.createTextNode('\n'));
            figureElement.appendChild(linkElement);

            // XMLを文字列に変換
            const serializer = new XMLSerializer();
            let xmlString = serializer.serializeToString(xmlDoc);
            // <link ...>テキスト</link>を<link .../>に変換（自己閉じタグ形式に統一、改行付き）
            xmlString = xmlString.replace(/<link([^>]*)>[^<]*<\/link>/g, '<link$1/>\r\n');
            this.currentMonthXmlData = xmlString;

            // 仮身リストに追加（全属性を含める）
            this.virtualObjects.push({
                link_id: `${realId}_0.xtad`,
                link_name: dayName,
                vobjleft: coords.left,
                vobjtop: coords.top,
                vobjright: coords.right,
                vobjbottom: coords.bottom,
                width: coords.right - coords.left,
                heightPx: coords.bottom - coords.top,
                chsz: virtualObj.chsz,
                frcol: virtualObj.frcol,
                chcol: virtualObj.chcol,
                tbcol: virtualObj.tbcol,
                bgcol: virtualObj.bgcol,
                dlen: virtualObj.dlen,
                pictdisp: virtualObj.pictdisp,
                namedisp: virtualObj.namedisp,
                roledisp: virtualObj.roledisp,
                typedisp: virtualObj.typedisp,
                updatedisp: virtualObj.updatedisp,
                framedisp: virtualObj.framedisp,
                autoopen: virtualObj.autoopen
            });

            // 年月実身を保存
            this.saveMonthToFile();

            this.isModified = true;
        } catch (error) {
            // エラー時は何もしない
        }
    }

    /**
     * 仮身の配置座標を計算（既存仮身との重なりを回避）
     * @param {Object} options - オプション
     * @returns {Object} 座標 { left, top, right, bottom, height }
     */
    calculateVirtualObjectPosition(options = {}) {
        // デフォルトサイズ
        const DEFAULT_WIDTH = 150;
        const DEFAULT_HEIGHT = 30;

        // オプションから座標を取得、またはデフォルト値を計算
        if (options.vobjleft !== undefined && options.vobjtop !== undefined) {
            // ドラッグで指定された座標を使用
            const width = options.width || DEFAULT_WIDTH;
            const height = options.height || DEFAULT_HEIGHT;
            return {
                left: Math.round(options.vobjleft),
                top: Math.round(options.vobjtop),
                right: Math.round(options.vobjleft + width),
                bottom: Math.round(options.vobjtop + height),
                height: Math.round(height)
            };
        }

        // 既存仮身から次の位置を計算（縦に並べる）
        const existingCount = this.virtualObjects.length;
        const yOffset = existingCount * 40 + 10;

        return {
            left: 10,
            top: yOffset,
            right: 10 + DEFAULT_WIDTH,
            bottom: yOffset + DEFAULT_HEIGHT,
            height: DEFAULT_HEIGHT
        };
    }

    /**
     * 仮身を開く（実身をデフォルトアプリで開く）
     */
    openVirtualObject(virtualObj) {
        // open-virtual-objectメッセージを使用（仮身一覧と同じ）
        this.messageBus.send('open-virtual-object', {
            linkId: virtualObj.link_id,
            linkName: virtualObj.link_name
        });
    }

    /**
     * 親実身を保存
     */
    saveToFile() {
        if (!this.realId || !this.xmlData) return;

        this.messageBus.send('xml-data-changed', {
            fileId: this.realId,
            xmlData: this.xmlData
        });
    }

    /**
     * 年月実身を保存
     * カレンダーレイアウト全体を再生成してから保存する
     */
    saveMonthToFile() {
        if (!this.currentMonthRealId) return;

        // カレンダーレイアウトと仮身を含むxmlTADを再生成
        this.currentMonthXmlData = this.rebuildCalendarXmlWithVirtualObjects();

        this.messageBus.send('xml-data-changed', {
            fileId: this.currentMonthRealId,
            xmlData: this.currentMonthXmlData
        });
    }

    /**
     * 年月選択ダイアログを表示
     */
    showYearMonthDialog() {
        const dialog = document.getElementById('yearMonthDialog');
        const yearSelect = document.getElementById('yearSelect');
        const monthSelect = document.getElementById('monthSelect');

        if (dialog && yearSelect && monthSelect) {
            yearSelect.value = this.currentYear;
            monthSelect.value = this.currentMonth;
            dialog.classList.remove('hidden');
        }
    }

    /**
     * 年月選択ダイアログを非表示
     */
    hideYearMonthDialog() {
        const dialog = document.getElementById('yearMonthDialog');
        if (dialog) {
            dialog.classList.add('hidden');
        }
    }

    /**
     * 年月選択を適用
     */
    async applyYearMonthSelection() {
        const yearSelect = document.getElementById('yearSelect');
        const monthSelect = document.getElementById('monthSelect');

        if (yearSelect && monthSelect) {
            const year = parseInt(yearSelect.value, 10);
            const month = parseInt(monthSelect.value, 10);

            this.hideYearMonthDialog();
            await this.navigateToMonth(year, month);
        }
    }

    /**
     * メニュー定義
     */
    async getMenuDefinition() {
        const menuDef = [];

        // 保存メニュー
        menuDef.push({
            label: '保存',
            submenu: [
                { label: '元の実身に保存', action: 'save', shortcut: 'Ctrl+S' }
            ]
        });

        // 表示メニュー
        menuDef.push({
            label: '表示',
            submenu: [
                { label: '今日へ移動', action: 'goto-today' },
                { label: '年月を選択...', action: 'select-year-month' },
                { separator: true },
                { label: '全画面表示オンオフ', action: 'toggle-fullscreen', shortcut: 'Ctrl+L' },
                { label: '再表示', action: 'refresh' },
                { label: '背景色変更', action: 'change-bg-color' }
            ]
        });

        // 編集メニュー
        const editSubmenu = [
            { label: '取り消し', action: 'undo', disabled: true },
            { label: 'クリップボードへコピー', action: 'copy', shortcut: 'Ctrl+C' },
            { label: 'クリップボードからコピー', action: 'paste', shortcut: 'Ctrl+V' },
            { label: 'クリップボードへ移動', action: 'cut', shortcut: 'Ctrl+X' },
            { label: 'クリップボードから移動', action: 'paste-move', shortcut: 'Ctrl+Z' },
            { label: '削除', action: 'delete', shortcut: 'Delete' }
        ];
        menuDef.push({
            label: '編集',
            submenu: editSubmenu
        });

        // 仮身選択時のメニュー
        if (this.contextMenuVirtualObject) {
            try {
                const realId = this.contextMenuVirtualObject.realId;

                // 仮身操作メニュー
                const virtualObjSubmenu = [
                    { label: '開く', action: 'open-virtual-object', shortcut: 'Ctrl+O' },
                    { label: '閉じる', action: 'close-virtual-object' },
                    { separator: true },
                    { label: '属性変更', action: 'change-virtual-object-attributes' },
                    { label: '続柄設定', action: 'set-relationship' }
                ];

                menuDef.push({
                    label: '仮身操作',
                    submenu: virtualObjSubmenu
                });

                // 実身操作メニュー
                const realObjSubmenu = [
                    { label: '実身名変更', action: 'rename-real-object' },
                    { label: '実身複製', action: 'duplicate-real-object' },
                    { label: '管理情報', action: 'open-real-object-config' },
                    { label: '仮身ネットワーク', action: 'open-virtual-object-network' },
                    { label: '実身/仮身検索', action: 'open-real-object-search' }
                ];

                menuDef.push({
                    label: '実身操作',
                    submenu: realObjSubmenu
                });

                // 実行メニュー（applistから）
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
                // エラー時は仮身メニューなし
            }
        }

        return menuDef;
    }

    /**
     * メニューアクション実行
     */
    executeMenuAction(action) {
        switch (action) {
            // 保存メニュー
            case 'save':
                this.saveAll();
                break;

            // 表示メニュー
            case 'goto-today':
                const today = new Date();
                this.navigateToMonth(today.getFullYear(), today.getMonth() + 1);
                break;
            case 'select-year-month':
                this.showYearMonthDialog();
                break;
            case 'toggle-fullscreen':
                this.toggleFullscreen();
                break;
            case 'refresh':
                this.refresh();
                break;
            case 'change-bg-color':
                this.changeBgColor();
                break;

            // 編集メニュー
            case 'undo':
                // 未実装（disabled）
                break;
            case 'copy':
                this.copySelectedVirtualObjects();
                break;
            case 'paste':
                this.pasteVirtualObjects();
                break;
            case 'cut':
                this.cutSelectedVirtualObjects();
                break;
            case 'paste-move':
                this.pasteVirtualObjects(true);
                break;
            case 'delete':
                this.deleteSelectedVirtualObjects();
                break;

            // 仮身操作メニュー
            case 'open-virtual-object':
                if (this.contextMenuVirtualObject?.virtualObj) {
                    this.openVirtualObject(this.contextMenuVirtualObject.virtualObj);
                }
                break;
            case 'close-virtual-object':
                this.closeSelectedVirtualObject();
                break;
            case 'change-virtual-object-attributes':
                this.changeVirtualObjectAttributes();
                break;
            case 'set-relationship':
                this.setRelationship();
                break;

            // 実身操作メニュー
            case 'rename-real-object':
                this.renameRealObject();
                break;
            case 'duplicate-real-object':
                this.duplicateRealObject();
                break;
            case 'open-real-object-config':
                this.openRealObjectConfig();
                break;
            case 'open-virtual-object-network':
                this.openVirtualObjectNetwork();
                break;
            case 'open-real-object-search':
                this.openRealObjectSearch();
                break;

            default:
                // 実行メニューからのアクション
                if (action.startsWith('execute-with-')) {
                    const pluginId = action.replace('execute-with-', '');
                    if (this.contextMenuVirtualObject?.virtualObj) {
                        this.messageBus.send('open-virtual-object-real', {
                            virtualObj: this.contextMenuVirtualObject.virtualObj,
                            pluginId: pluginId
                        });
                    }
                }
                break;
        }
    }

    // ===== 保存機能 =====

    /**
     * 全データを保存（親実身 + 年月実身）
     */
    saveAll() {
        this.saveToFile();
        this.saveMonthToFile();
        this.setStatus('保存しました');
    }

    /**
     * クローズ前の保存処理（PluginBaseのフックメソッドをオーバーライド）
     * handleCloseRequest()で「保存」が選択された時に呼ばれる
     */
    async onSaveBeforeClose() {
        this.saveToFile();
        this.saveMonthToFile();
    }

    // ===== 表示機能 =====

    /**
     * カレンダーを再表示
     */
    refresh() {
        this.renderCalendarGrid();
        this.setStatus('再表示しました');
    }

    /**
     * 背景色を変更
     */
    async changeBgColor() {
        const currentColor = document.body.style.backgroundColor || DEFAULT_BGCOL;
        const result = await this.showInputDialog(
            '背景色を入力してください（例: #ffffff, rgb(255,255,255)）',
            currentColor,
            200
        );

        if (result) {
            document.body.style.backgroundColor = result;
            const container = document.querySelector('.calendar-container');
            if (container) {
                container.style.backgroundColor = result;
            }
            this.setStatus('背景色を変更しました');
        }
    }

    // ===== 編集機能（仮身クリップボード操作） =====

    /**
     * 選択中の仮身をコピー
     */
    copySelectedVirtualObjects() {
        if (this.selectedVirtualObjects.size === 0 && !this.contextMenuVirtualObject) {
            this.setStatus('コピーする仮身が選択されていません');
            return;
        }

        // コピー対象を収集
        const vobjsToCopy = [];
        if (this.contextMenuVirtualObject) {
            vobjsToCopy.push(this.contextMenuVirtualObject.virtualObj);
        } else {
            for (const index of this.selectedVirtualObjects) {
                if (this.virtualObjects[index]) {
                    vobjsToCopy.push(this.virtualObjects[index]);
                }
            }
        }

        if (vobjsToCopy.length > 0) {
            // グローバルクリップボードに保存
            this.setClipboard({
                type: 'virtual-objects',
                objects: vobjsToCopy,
                isCut: false
            });
            this.setStatus(`${vobjsToCopy.length}個の仮身をコピーしました`);
        }
    }

    /**
     * 選択中の仮身を切り取り
     */
    cutSelectedVirtualObjects() {
        if (this.selectedVirtualObjects.size === 0 && !this.contextMenuVirtualObject) {
            this.setStatus('切り取る仮身が選択されていません');
            return;
        }

        // 切り取り対象を収集
        const vobjsToCut = [];
        if (this.contextMenuVirtualObject) {
            vobjsToCut.push(this.contextMenuVirtualObject.virtualObj);
        } else {
            for (const index of this.selectedVirtualObjects) {
                if (this.virtualObjects[index]) {
                    vobjsToCut.push(this.virtualObjects[index]);
                }
            }
        }

        if (vobjsToCut.length > 0) {
            // グローバルクリップボードに保存（切り取りフラグ付き）
            this.setClipboard({
                type: 'virtual-objects',
                objects: vobjsToCut,
                isCut: true
            });

            // 元の仮身を削除
            this.deleteVirtualObjectsFromXml(vobjsToCut);
            this.renderCalendarGrid();
            this.setStatus(`${vobjsToCut.length}個の仮身を切り取りました`);
        }
    }

    /**
     * 仮身を貼り付け
     * @param {boolean} clearAfterPaste - 貼り付け後にクリップボードをクリアするか
     */
    async pasteVirtualObjects(clearAfterPaste = false) {
        // グローバルクリップボードから取得
        const clipboard = await this.getClipboard();
        if (!clipboard || clipboard.type !== 'virtual-objects') {
            this.setStatus('貼り付ける仮身がありません');
            return;
        }

        const vobjsToPaste = clipboard.objects;
        if (!vobjsToPaste || vobjsToPaste.length === 0) {
            this.setStatus('貼り付ける仮身がありません');
            return;
        }

        // 各仮身を年月実身に追加
        for (const vobj of vobjsToPaste) {
            this.addExternalVirtualObjectToMonth(vobj);
        }

        this.renderCalendarGrid();

        this.setStatus(`${vobjsToPaste.length}個の仮身を貼り付けました`);

        // クリップボードから移動の場合はクリア
        if (clearAfterPaste) {
            this.setClipboard(null);
        }
    }

    /**
     * 選択中の仮身を削除
     */
    deleteSelectedVirtualObjects() {
        if (this.selectedVirtualObjects.size === 0 && !this.contextMenuVirtualObject) {
            this.setStatus('削除する仮身が選択されていません');
            return;
        }

        // 削除対象を収集
        const vobjsToDelete = [];
        if (this.contextMenuVirtualObject) {
            vobjsToDelete.push(this.contextMenuVirtualObject.virtualObj);
        } else {
            for (const index of this.selectedVirtualObjects) {
                if (this.virtualObjects[index]) {
                    vobjsToDelete.push(this.virtualObjects[index]);
                }
            }
        }

        if (vobjsToDelete.length > 0) {
            this.deleteVirtualObjectsFromXml(vobjsToDelete);
            this.clearDayVirtualObjectSelection();
            this.contextMenuVirtualObject = null;
            this.renderCalendarGrid();
            this.setStatus(`${vobjsToDelete.length}個の仮身を削除しました`);
        }
    }

    /**
     * XMLから仮身を削除
     * @param {Array} vobjsToDelete - 削除する仮身の配列
     */
    deleteVirtualObjectsFromXml(vobjsToDelete) {
        if (!this.currentMonthXmlData) return;

        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(this.currentMonthXmlData, 'text/xml');

            for (const vobj of vobjsToDelete) {
                // link_idで検索して削除
                const linkElements = xmlDoc.querySelectorAll(`link[id="${vobj.link_id}"]`);
                linkElements.forEach(el => el.remove());

                // 仮身リストからも削除
                const index = this.virtualObjects.findIndex(v => v.link_id === vobj.link_id);
                if (index >= 0) {
                    this.virtualObjects.splice(index, 1);
                }
            }

            // XMLを更新
            const serializer = new XMLSerializer();
            let xmlString = serializer.serializeToString(xmlDoc);
            // <link ...>テキスト</link>を<link .../>に変換（自己閉じタグ形式に統一、改行付き）
            xmlString = xmlString.replace(/<link([^>]*)>[^<]*<\/link>/g, '<link$1/>\r\n');
            this.currentMonthXmlData = xmlString;
            this.saveMonthToFile();
            this.isModified = true;
        } catch (error) {
            // エラー時は何もしない
        }
    }

    // ===== 仮身操作機能 =====

    /**
     * 仮身に属性を適用（PluginBaseのオーバーライド）
     * @param {Object} attrs - 適用する属性値
     */
    applyVirtualObjectAttributes(attrs) {
        // contextMenuVirtualObjectを使用
        const vobj = this.contextMenuVirtualObject?.virtualObj;
        if (!vobj) return;

        // PluginBaseの共通メソッドで属性を適用し、変更を取得
        const changes = this._applyVobjAttrs(vobj, attrs);

        // 変更がない場合は早期リターン
        if (!this._hasVobjAttrChanges(changes)) {
            return;
        }

        // XMLを更新して保存
        this.updateVirtualObjectInXml(vobj);
        this.renderCalendarGrid();
        this.setStatus('仮身属性を変更しました');
    }

    /**
     * XMLの仮身を更新
     * @param {Object} vobj - 更新する仮身オブジェクト
     */
    updateVirtualObjectInXml(vobj) {
        if (!this.currentMonthXmlData) return;

        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(this.currentMonthXmlData, 'text/xml');

            // link_idで検索
            const linkElement = xmlDoc.querySelector(`link[id="${vobj.link_id}"]`);
            if (!linkElement) return;

            // 属性を更新
            if (vobj.chsz !== undefined) linkElement.setAttribute('chsz', vobj.chsz);
            if (vobj.frcol !== undefined) linkElement.setAttribute('frcol', vobj.frcol);
            if (vobj.chcol !== undefined) linkElement.setAttribute('chcol', vobj.chcol);
            if (vobj.tbcol !== undefined) linkElement.setAttribute('tbcol', vobj.tbcol);
            if (vobj.bgcol !== undefined) linkElement.setAttribute('bgcol', vobj.bgcol);
            if (vobj.pictdisp !== undefined) linkElement.setAttribute('pictdisp', vobj.pictdisp);
            if (vobj.namedisp !== undefined) linkElement.setAttribute('namedisp', vobj.namedisp);
            if (vobj.roledisp !== undefined) linkElement.setAttribute('roledisp', vobj.roledisp);
            if (vobj.typedisp !== undefined) linkElement.setAttribute('typedisp', vobj.typedisp);
            if (vobj.updatedisp !== undefined) linkElement.setAttribute('updatedisp', vobj.updatedisp);
            if (vobj.framedisp !== undefined) linkElement.setAttribute('framedisp', vobj.framedisp);
            if (vobj.autoopen !== undefined) linkElement.setAttribute('autoopen', vobj.autoopen);

            // 仮身固有の続柄（link要素のrelationship属性）
            if (vobj.linkRelationship && vobj.linkRelationship.length > 0) {
                linkElement.setAttribute('relationship', vobj.linkRelationship.join(' '));
            } else if (linkElement.hasAttribute('relationship')) {
                linkElement.removeAttribute('relationship');
            }

            // XMLを更新
            const serializer = new XMLSerializer();
            let xmlString = serializer.serializeToString(xmlDoc);
            // <link ...>テキスト</link>を<link .../>に変換（自己閉じタグ形式に統一、改行付き）
            xmlString = xmlString.replace(/<link([^>]*)>[^<]*<\/link>/g, '<link$1/>\r\n');
            this.currentMonthXmlData = xmlString;
            this.saveMonthToFile();
            this.isModified = true;
        } catch (error) {
            // エラー時は何もしない
        }
    }

    /**
     * 選択中の仮身のウィンドウを閉じる
     */
    closeSelectedVirtualObject() {
        if (!this.contextMenuVirtualObject) {
            this.setStatus('仮身が選択されていません');
            return;
        }

        const realId = this.contextMenuVirtualObject.realId;
        if (realId) {
            this.messageBus.send('close-real-object-windows', { realId: realId });
            this.setStatus('仮身のウィンドウを閉じました');
        }
    }

    /**
     * 続柄設定ダイアログ（PluginBaseのオーバーライド）
     */
    async setRelationship() {
        if (!this.contextMenuVirtualObject) {
            this.setStatus('仮身が選択されていません');
            return { success: false };
        }

        // 親クラスのsetRelationship()を呼び出す（metadata更新とフック呼び出しを含む）
        const result = await super.setRelationship();

        return result;
    }

    /**
     * 仮身の続柄をXMLに保存（PluginBaseフックオーバーライド）
     * @param {Object} virtualObj - 更新された仮身オブジェクト
     * @returns {Promise<void>}
     */
    async saveVirtualObjectRelationshipToXml(virtualObj) {
        if (virtualObj && virtualObj.link_id) {
            this.updateVirtualObjectInXml(virtualObj);
        }
    }

    /**
     * 続柄更新後の再描画（PluginBaseフック）
     */
    onRelationshipUpdated(virtualObj, result) {
        this.renderCalendarGrid();
        this.setStatus('続柄を変更しました');
    }

    // ===== 実身操作機能 =====

    /**
     * 実身複製後のフック（PluginBaseオーバーライド）
     * 複製した実身の仮身をカレンダーに追加
     *
     * @param {Object} originalVirtualObj - 元の仮身オブジェクト
     * @param {Object} result - 複製結果 { success: true, newRealId: string, newName: string }
     */
    async onRealObjectDuplicated(originalVirtualObj, result) {
        // 新しい仮身オブジェクトを作成（元の仮身の属性を継承、位置をオフセット）
        const newVirtualObj = {
            link_id: result.newRealId,
            link_name: result.newName,
            vobjleft: (originalVirtualObj.vobjleft || 100) + 20,
            vobjtop: (originalVirtualObj.vobjtop || 100) + 30,
            vobjright: (originalVirtualObj.vobjright || 200) + 20,
            vobjbottom: (originalVirtualObj.vobjbottom || 200) + 30,
            width: originalVirtualObj.width,
            heightPx: originalVirtualObj.heightPx,
            chsz: originalVirtualObj.chsz,
            frcol: originalVirtualObj.frcol,
            chcol: originalVirtualObj.chcol,
            tbcol: originalVirtualObj.tbcol,
            bgcol: originalVirtualObj.bgcol,
            dlen: originalVirtualObj.dlen,
            applist: originalVirtualObj.applist || {},
            pictdisp: originalVirtualObj.pictdisp || 'true',
            namedisp: originalVirtualObj.namedisp || 'true',
            roledisp: originalVirtualObj.roledisp || 'false',
            typedisp: originalVirtualObj.typedisp || 'false',
            updatedisp: originalVirtualObj.updatedisp || 'false',
            framedisp: originalVirtualObj.framedisp || 'true',
            autoopen: originalVirtualObj.autoopen || 'false'
        };

        // 自由仮身として追加
        await this.addFreeVirtualObjectToMonth(newVirtualObj,
            newVirtualObj.vobjleft, newVirtualObj.vobjtop);

        // 再描画
        this.renderCalendarGrid();
        this.renderFreeVirtualObjects();

        // 保存
        this.saveMonthToFile();
        this.isModified = true;
    }

    /**
     * 仮身ネットワークプラグインを開く
     */
    async openVirtualObjectNetwork() {
        await this.showMessageDialog(
            '仮身ネットワーク機能は現在開発中です。',
            [{ label: 'OK', value: 'ok' }],
            0
        );
    }

    /**
     * 実身/仮身検索プラグインを開く
     */
    async openRealObjectSearch() {
        await this.showMessageDialog(
            '実身/仮身検索機能は現在開発中です。',
            [{ label: 'OK', value: 'ok' }],
            0
        );
    }
}

// プラグインを初期化
const baseCalendarApp = new BaseCalendarApp();
