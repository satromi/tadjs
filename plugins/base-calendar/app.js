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
    }

    /**
     * 親ウィンドウからのドロップイベントを処理
     * @param {Object} data - ドロップデータ
     */
    async handleParentDropEvent(data) {
        const dragData = data.dragData;
        const clientX = data.clientX;
        const clientY = data.clientY;

        // 仮身ドラッグの場合のみ処理
        if (dragData.type !== 'virtual-object-drag') return;

        // ドロップ座標から日セルを特定
        const day = this.getDayFromCoordinates(clientX, clientY);
        if (!day) return;

        // 仮身を取得
        const virtualObjects = dragData.virtualObjects || [dragData.virtualObject];
        if (!virtualObjects || virtualObjects.length === 0) return;

        // 年月実身が読み込まれていない場合は処理しない
        if (!this.currentMonthXmlData) return;

        // 各仮身を年月実身に追加
        for (const virtualObj of virtualObjects) {
            await this.addExternalVirtualObjectToMonth(virtualObj);
        }

        // カレンダーを再描画
        this.renderCalendarGrid();

        // ドラッグ元に成功を通知
        if (dragData.sourceWindowId) {
            this.notifyCrossWindowDropSuccess(dragData, virtualObjects);
        }
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
            this.currentMonthXmlData = serializer.serializeToString(xmlDoc);

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
                    this.monthVirtualObjects.push(virtualObj);
                }
            }
        } catch (error) {
            // エラー時は空配列のまま
        }
    }

    // parseLinkElement はPluginBase共通メソッドを使用

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
        const WEEKDAY_COLORS = ['#cc0000', '#000000', '#000000', '#000000', '#000000', '#000000', '#0000cc'];

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
<rect round="0" lineType="0" lineWidth="1" f_pat="0"
      fillColor="#e0e0e0" strokeColor="#808080"
      left="0" top="0" right="${BASE_WIDTH}" bottom="${NAV_HEIGHT}" zIndex="1"/>

<!-- 年月表示テキスト -->
<document>
  <docView viewleft="350" viewtop="5" viewright="450" viewbottom="35"/>
  <docDraw drawleft="350" drawtop="5" drawright="450" drawbottom="35"/>
  <docScale hunit="-72" vunit="-72"/>
  <text zIndex="2"/>
  <font size="16"/>
  <font color="#000000"/>
  <text align="center"/>
  ${monthName}
</document>

<!-- 曜日ヘッダー背景 -->
<rect round="0" lineType="0" lineWidth="1" f_pat="0"
      fillColor="#e0e0e0" strokeColor="#808080"
      left="0" top="${NAV_HEIGHT}" right="${BASE_WIDTH}" bottom="${GRID_TOP}" zIndex="3"/>

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
                let dayColor = '#000000';
                let cellColor = '#ffffff';
                let isOtherMonth = false;

                if (cellIndex < startDayOfWeek) {
                    // 前月
                    const day = daysInPrevMonth - startDayOfWeek + cellIndex + 1;
                    dayText = String(day);
                    dayColor = '#808080';
                    cellColor = '#f0f0f0';
                    isOtherMonth = true;
                } else if (dayCounter <= daysInMonth) {
                    // 当月
                    dayText = String(dayCounter);
                    if (col === 0) {
                        dayColor = '#cc0000'; // 日曜
                    } else if (col === 6) {
                        dayColor = '#0000cc'; // 土曜
                    }
                    if (isCurrentMonth && dayCounter === todayDate) {
                        cellColor = '#ffffd0'; // 今日
                    }
                    dayCounter++;
                } else {
                    // 翌月
                    dayText = String(nextMonthDay);
                    dayColor = '#808080';
                    cellColor = '#f0f0f0';
                    isOtherMonth = true;
                    nextMonthDay++;
                }

                // セル背景
                xmlTAD += `<rect round="0" lineType="0" lineWidth="1" f_pat="0"
      fillColor="${cellColor}" strokeColor="#c0c0c0"
      left="${left}" top="${top}" right="${right}" bottom="${bottom}" zIndex="${zIndex}"/>
`;
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
        const WEEKDAY_COLORS = ['#cc0000', '#000000', '#000000', '#000000', '#000000', '#000000', '#0000cc'];

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
<rect round="0" lineType="0" lineWidth="1" f_pat="0"
      fillColor="#e0e0e0" strokeColor="#808080"
      left="0" top="0" right="${layout.BASE_WIDTH}" bottom="${layout.NAV_HEIGHT}" zIndex="1"/>

<!-- 年月表示テキスト -->
<document>
  <docView viewleft="350" viewtop="5" viewright="450" viewbottom="35"/>
  <docDraw drawleft="350" drawtop="5" drawright="450" drawbottom="35"/>
  <docScale hunit="-72" vunit="-72"/>
  <text zIndex="2"/>
  <font size="16"/>
  <font color="#000000"/>
  <text align="center"/>
  ${monthName}
</document>

<!-- 曜日ヘッダー背景 -->
<rect round="0" lineType="0" lineWidth="1" f_pat="0"
      fillColor="#e0e0e0" strokeColor="#808080"
      left="0" top="${layout.NAV_HEIGHT}" right="${layout.BASE_WIDTH}" bottom="${layout.GRID_TOP}" zIndex="3"/>

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
                let dayColor = '#000000';
                let cellColor = '#ffffff';

                if (cellIndex < startDayOfWeek) {
                    const day = daysInPrevMonth - startDayOfWeek + cellIndex + 1;
                    dayText = String(day);
                    dayColor = '#808080';
                    cellColor = '#f0f0f0';
                } else if (dayCounter <= daysInMonth) {
                    dayText = String(dayCounter);
                    if (col === 0) {
                        dayColor = '#cc0000';
                    } else if (col === 6) {
                        dayColor = '#0000cc';
                    }
                    if (isCurrentMonth && dayCounter === todayDate) {
                        cellColor = '#ffffd0';
                    }
                    dayCounter++;
                } else {
                    dayText = String(nextMonthDay);
                    dayColor = '#808080';
                    cellColor = '#f0f0f0';
                    nextMonthDay++;
                }

                // セル背景
                xmlTAD += `<rect round="0" lineType="0" lineWidth="1" f_pat="0"
      fillColor="${cellColor}" strokeColor="#c0c0c0"
      left="${left}" top="${top}" right="${right}" bottom="${bottom}" zIndex="${zIndex}"/>
`;
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
            }
        }

        // 仮身（link要素）を追加 - 日ごとにグループ化して座標を計算
        const dayIndexMap = {}; // 各日の仮身インデックスを追跡
        zIndex = 200; // 仮身用の高いzIndex

        for (const vobj of this.virtualObjects) {
            const dayName = vobj.link_name;
            if (!dayName) continue;

            // 日ごとのインデックスを取得・更新
            if (dayIndexMap[dayName] === undefined) {
                dayIndexMap[dayName] = 0;
            }
            const indexInCell = dayIndexMap[dayName]++;

            // 座標を計算
            const pos = this.calculateVirtualObjectCellPosition(dayName, indexInCell);
            if (!pos) continue;

            // link要素を生成
            xmlTAD += `<link id="${vobj.link_id}"
      vobjleft="${pos.left}" vobjtop="${pos.top}"
      vobjright="${pos.right}" vobjbottom="${pos.bottom}"
      height="${pos.bottom - pos.top}"
      chsz="${vobj.chsz || 10}"
      frcol="${vobj.frcol || '#b0c0d0'}"
      chcol="${vobj.chcol || '#000000'}"
      tbcol="${vobj.tbcol || '#e8f4ff'}"
      bgcol="${vobj.bgcol || '#e8f4ff'}"
      dlen="${vobj.dlen || 0}"
      pictdisp="${vobj.pictdisp !== undefined ? vobj.pictdisp : 'true'}"
      namedisp="${vobj.namedisp !== undefined ? vobj.namedisp : 'true'}"
      roledisp="${vobj.roledisp !== undefined ? vobj.roledisp : 'false'}"
      typedisp="${vobj.typedisp !== undefined ? vobj.typedisp : 'false'}"
      updatedisp="${vobj.updatedisp !== undefined ? vobj.updatedisp : 'false'}"
      framedisp="${vobj.framedisp !== undefined ? vobj.framedisp : 'true'}"
      autoopen="${vobj.autoopen !== undefined ? vobj.autoopen : 'false'}"
      zIndex="${zIndex}">${dayName}</link>
`;
            zIndex++;

            // 仮身オブジェクトの座標も更新
            vobj.vobjleft = pos.left;
            vobj.vobjtop = pos.top;
            vobj.vobjright = pos.right;
            vobj.vobjbottom = pos.bottom;
            vobj.width = pos.right - pos.left;
            vobj.heightPx = pos.bottom - pos.top;
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
                vobjbottom: yOffset + 30,
                heightPx: 30
            });

            // 新しいlink要素を作成（共通メソッドを使用）
            const linkElement = xmlDoc.createElement('link');
            this.buildLinkElementAttributes(linkElement, virtualObj);

            // 改行を追加してからlink要素を追加
            figureElement.appendChild(xmlDoc.createTextNode('\n'));
            figureElement.appendChild(linkElement);

            // XMLを文字列に変換
            const serializer = new XMLSerializer();
            this.xmlData = serializer.serializeToString(xmlDoc);

            // 年月仮身リストに追加（全属性を含める）
            this.monthVirtualObjects.push({
                link_id: `${realId}_0.xtad`,
                link_name: monthName,
                vobjleft: 10,
                vobjtop: yOffset,
                vobjright: 160,
                vobjbottom: yOffset + 30,
                width: 150,
                heightPx: 30,
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

            const dayNumber = document.createElement('div');
            dayNumber.className = 'day-number';

            const dayEvents = document.createElement('div');
            dayEvents.className = 'day-events';

            const dayOfWeek = i % 7;

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

                // 曜日の色
                if (dayOfWeek === 0) {
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

            cell.appendChild(dayNumber);
            cell.appendChild(dayEvents);
            grid.appendChild(cell);
        }
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
                        tbcol: '#e8f4ff',      // background: #e8f4ff
                        frcol: '#b0c0d0',      // border: #b0c0d0
                        chcol: '#000000',      // text color: black
                        bgcol: '#e8f4ff',      // background: #e8f4ff
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

        // 新規年月日実身を作成（正しいxmlTAD形式）
        const initialXtad = this.buildTextDocumentXml(dayName, {
            fontSize: 20,
            align: 'center',
            filename: dayName
        });

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
            this.currentMonthXmlData = serializer.serializeToString(xmlDoc);

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
        const currentColor = document.body.style.backgroundColor || '#ffffff';
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
            this.currentMonthXmlData = serializer.serializeToString(xmlDoc);
            this.saveMonthToFile();
            this.isModified = true;
        } catch (error) {
            // エラー時は何もしない
        }
    }

    // ===== 仮身操作機能 =====

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
     * 続柄設定ダイアログ
     */
    async setRelationship() {
        if (!this.contextMenuVirtualObject) {
            this.setStatus('仮身が選択されていません');
            return;
        }

        const result = await this.showMessageDialog(
            '続柄設定機能は現在開発中です。',
            [{ label: 'OK', value: 'ok' }],
            0
        );
    }

    // ===== 実身操作機能 =====

    /**
     * 実身属性設定プラグインを開く
     */
    openRealObjectConfig() {
        if (!this.contextMenuVirtualObject) {
            this.setStatus('仮身が選択されていません');
            return;
        }

        const realId = this.contextMenuVirtualObject.realId;
        if (realId) {
            this.messageBus.send('open-accessory-plugin', {
                pluginId: 'realobject-config',
                params: { realId: realId }
            });
        }
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
