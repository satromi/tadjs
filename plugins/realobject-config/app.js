/**
 * 管理情報プラグイン
 * 実身の管理情報を参照・編集するプラグイン
 */

class RealObjectConfigApp extends PluginBase {
    constructor() {
        super('RealObjectConfig');
        this.realId = null;
        this.realObjectData = null;
        this.originalApplist = null;
        this.selectedRowIndex = -1;
        this.isModified = false;

        // 初期化を実行
        this.initialize();
    }

    /**
     * 初期化処理
     */
    async initialize() {
        // MessageBusハンドラを設定
        this.setupMessageBusHandlers();

        // タブ切り替えを設定
        this.setupTabs();

        // ボタンイベントを設定
        this.setupButtons();

        // 右クリックメニュー
        this.setupContextMenu();

        // ウィンドウアクティベーション
        this.setupWindowActivation();

        // カスタムスクロールバーを初期化
        this.initCustomScrollbar('.tab-content');
    }

    /**
     * MessageBusハンドラを設定
     */
    setupMessageBusHandlers() {
        // 共通MessageBusハンドラを登録（PluginBaseで定義）
        // window-moved, window-resized-end, window-maximize-toggled,
        // menu-action, get-menu-definition, window-close-request
        this.setupCommonMessageBusHandlers();

        // initメッセージ
        this.messageBus.on('init', async (data) => {
            if (data.windowId) {
                this.messageBus.setWindowId(data.windowId);
            }

            // 引数からrealIdを取得（fileData内にネストされている）
            const realId = data.fileData?.realId || data.realId;
            if (realId) {
                this.realId = realId;
                await this.loadRealObjectInfo();
            }
        });

        // menu-action, get-menu-definition は setupCommonMessageBusHandlers() で登録済み
    }

    /**
     * タブ切り替えを設定
     */
    setupTabs() {
        const tabs = document.querySelectorAll('.tab');
        const panels = document.querySelectorAll('.tab-panel');

        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                // 全タブの選択を解除
                tabs.forEach(t => t.classList.remove('active'));
                panels.forEach(p => p.classList.remove('active'));

                // クリックしたタブを選択
                tab.classList.add('active');
                const panelId = tab.dataset.tab + '-panel';
                const panel = document.getElementById(panelId);
                if (panel) {
                    panel.classList.add('active');
                }
            });
        });
    }

    /**
     * ボタンイベントを設定
     */
    setupButtons() {
        // 適用ボタン
        document.getElementById('apply-button').addEventListener('click', () => {
            this.applyChanges();
        });

        // キャンセルボタン
        document.getElementById('cancel-button').addEventListener('click', () => {
            this.cancelChanges();
        });

        // 行追加ボタン
        document.getElementById('add-row-button').addEventListener('click', () => {
            this.addApplistRow();
        });

        // 行削除ボタン
        document.getElementById('delete-row-button').addEventListener('click', () => {
            this.deleteApplistRow();
        });

        // デフォルト起動ボタン
        document.getElementById('set-default-button').addEventListener('click', () => {
            this.setDefaultOpen();
        });
    }

    /**
     * 実身情報を読み込む
     */
    async loadRealObjectInfo() {
        if (!this.realId) return;

        try {
            // 管理用セグメントJSONを読み込む
            const jsonFileName = `${this.realId}.json`;
            const jsonBlob = await this.loadDataFileFromParent(jsonFileName);

            if (jsonBlob) {
                const jsonText = await jsonBlob.text();
                this.realObjectData = JSON.parse(jsonText);
                this.originalApplist = JSON.parse(JSON.stringify(this.realObjectData.applist || {}));

                // 実身情報タブを更新
                this.updateInfoTab();

                // 使用者管理タブを更新
                this.updateOwnerTab();

                // 付箋指定タブを更新
                this.updateApplistTab();
            }

            // xtadファイルを読み込む（サイズとlinkカウント用）
            const xtadFileName = `${this.realId}_0.xtad`;
            const xtadBlob = await this.loadDataFileFromParent(xtadFileName);

            if (xtadBlob) {
                // ファイルサイズ
                const fileSize = xtadBlob.size;
                document.getElementById('file-size').textContent = this.formatNumber(fileSize);

                // linkタグカウント
                const xtadText = await xtadBlob.text();
                const linkCount = this.countLinkTags(xtadText);
                document.getElementById('link-count').textContent = linkCount.toString();
            }

            // ファイルパスを取得
            await this.loadFilePath();

        } catch (error) {
            // エラー時は表示を「取得不可」にする
            this.setErrorDisplay();
        }
    }

    /**
     * ファイルパスを読み込む（get-real-object-infoを使用）
     */
    async loadFilePath() {
        try {
            const messageId = `get-info-${Date.now()}-${Math.random()}`;
            this.messageBus.send('get-real-object-info', {
                realId: this.realId,
                messageId: messageId
            });

            const result = await this.messageBus.waitFor('real-object-info-response', 5000, (data) => {
                return data.messageId === messageId;
            });

            if (result && result.success && result.info && result.info.filePath) {
                document.getElementById('file-path').textContent = result.info.filePath;
            } else {
                document.getElementById('file-path').textContent = '取得不可';
            }
        } catch (error) {
            document.getElementById('file-path').textContent = '取得不可';
        }
    }

    /**
     * 実身情報タブを更新
     */
    updateInfoTab() {
        if (!this.realObjectData) return;

        // 続柄
        const relationship = this.realObjectData.relationship;
        if (Array.isArray(relationship)) {
            document.getElementById('relationship').textContent = relationship.join(' ') || '-';
        } else if (typeof relationship === 'string') {
            document.getElementById('relationship').textContent = relationship || '-';
        } else {
            document.getElementById('relationship').textContent = '-';
        }

        // 作成日時
        const makeDate = this.realObjectData.makeDate;
        document.getElementById('make-date').textContent = this.formatDateTime(makeDate);

        // 更新日時
        const updateDate = this.realObjectData.updateDate;
        document.getElementById('update-date').textContent = this.formatDateTime(updateDate);

        // 参照仮身数
        const refCount = this.realObjectData.refCount;
        document.getElementById('ref-count').textContent = refCount !== undefined ? refCount.toString() : '-';
    }

    /**
     * 使用者管理タブを更新
     */
    updateOwnerTab() {
        if (!this.realObjectData) return;

        // 所有者
        const maker = this.realObjectData.maker;
        document.getElementById('owner').textContent = maker || '-';
    }

    /**
     * 付箋指定タブを更新
     */
    updateApplistTab() {
        if (!this.realObjectData) return;

        const applist = this.realObjectData.applist || {};

        // データタイプ（デフォルト起動のname）
        let dataType = '-';
        for (const [pluginId, info] of Object.entries(applist)) {
            if (info.defaultOpen) {
                dataType = info.name || pluginId;
                break;
            }
        }
        document.getElementById('data-type').textContent = dataType;

        // テーブルを構築
        this.renderApplistTable();
    }

    /**
     * applistテーブルをレンダリング
     */
    renderApplistTable() {
        const tbody = document.getElementById('applist-tbody');
        tbody.innerHTML = '';

        const applist = this.realObjectData.applist || {};
        let index = 0;

        for (const [pluginId, info] of Object.entries(applist)) {
            const tr = document.createElement('tr');
            tr.dataset.index = index;

            if (index === this.selectedRowIndex) {
                tr.classList.add('selected');
            }

            // ラジオボタン列
            const tdSelect = document.createElement('td');
            tdSelect.className = 'col-select';
            const radioLabel = document.createElement('label');
            radioLabel.className = 'radio-label';
            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = 'applist-select';
            radio.checked = (index === this.selectedRowIndex);
            const indicator = document.createElement('span');
            indicator.className = 'radio-indicator';
            radioLabel.appendChild(radio);
            radioLabel.appendChild(indicator);
            tdSelect.appendChild(radioLabel);

            // ラジオボタンのクリックで行選択（クロージャでindexを保持）
            const currentIndex = index;
            radioLabel.addEventListener('click', (e) => {
                e.stopPropagation(); // 行のクリックイベントと重複しないように
                this.selectRow(currentIndex);
            });

            // 正式名称列
            const tdName = document.createElement('td');
            tdName.className = 'col-name';
            const inputName = document.createElement('input');
            inputName.type = 'text';
            inputName.value = info.name || '';
            inputName.dataset.pluginId = pluginId;
            inputName.dataset.field = 'name';
            inputName.addEventListener('change', (e) => this.onApplistChange(e));
            inputName.addEventListener('click', (e) => e.stopPropagation()); // 行選択を防止
            tdName.appendChild(inputName);

            // プラグイン名列
            const tdPlugin = document.createElement('td');
            tdPlugin.className = 'col-plugin';
            const inputPlugin = document.createElement('input');
            inputPlugin.type = 'text';
            inputPlugin.value = pluginId;
            inputPlugin.dataset.originalPluginId = pluginId;
            inputPlugin.dataset.field = 'pluginId';
            inputPlugin.addEventListener('change', (e) => this.onPluginIdChange(e));
            inputPlugin.addEventListener('click', (e) => e.stopPropagation()); // 行選択を防止
            tdPlugin.appendChild(inputPlugin);

            // デフォルト列
            const tdDefault = document.createElement('td');
            tdDefault.className = 'col-default';
            if (info.defaultOpen) {
                tdDefault.innerHTML = '<span class="default-mark">*</span>';
            }

            tr.appendChild(tdSelect);
            tr.appendChild(tdName);
            tr.appendChild(tdPlugin);
            tr.appendChild(tdDefault);

            // 行クリックで選択（currentIndexを使用）
            tr.addEventListener('click', () => {
                this.selectRow(currentIndex);
            });

            tbody.appendChild(tr);
            index++;
        }
    }

    /**
     * 行を選択
     */
    selectRow(index) {
        this.selectedRowIndex = index;
        this.renderApplistTable();
    }

    /**
     * applistフィールド変更時
     */
    onApplistChange(e) {
        const pluginId = e.target.dataset.pluginId;
        const field = e.target.dataset.field;
        const value = e.target.value;

        if (this.realObjectData.applist && this.realObjectData.applist[pluginId]) {
            this.realObjectData.applist[pluginId][field] = value;
            this.isModified = true;
        }
    }

    /**
     * プラグインID変更時
     */
    onPluginIdChange(e) {
        const originalPluginId = e.target.dataset.originalPluginId;
        const newPluginId = e.target.value;

        if (originalPluginId !== newPluginId && this.realObjectData.applist) {
            const applistData = this.realObjectData.applist[originalPluginId];
            if (applistData) {
                delete this.realObjectData.applist[originalPluginId];
                this.realObjectData.applist[newPluginId] = applistData;
                this.isModified = true;
                this.renderApplistTable();
            }
        }
    }

    /**
     * 行追加
     */
    addApplistRow() {
        if (!this.realObjectData.applist) {
            this.realObjectData.applist = {};
        }

        // 新規プラグインIDを生成
        let newId = 'new-plugin';
        let counter = 1;
        while (this.realObjectData.applist[newId]) {
            newId = `new-plugin-${counter}`;
            counter++;
        }

        this.realObjectData.applist[newId] = {
            name: '新規プラグイン',
            defaultOpen: false
        };

        this.isModified = true;
        this.renderApplistTable();
    }

    /**
     * 行削除
     */
    deleteApplistRow() {
        if (this.selectedRowIndex < 0) return;

        const applist = this.realObjectData.applist || {};
        const keys = Object.keys(applist);

        if (this.selectedRowIndex < keys.length) {
            const keyToDelete = keys[this.selectedRowIndex];
            delete this.realObjectData.applist[keyToDelete];
            this.selectedRowIndex = -1;
            this.isModified = true;
            this.renderApplistTable();
            this.updateApplistTab();
        }
    }

    /**
     * デフォルト起動を設定
     */
    setDefaultOpen() {
        if (this.selectedRowIndex < 0) return;

        const applist = this.realObjectData.applist || {};
        const keys = Object.keys(applist);

        if (this.selectedRowIndex < keys.length) {
            // 全てのdefaultOpenをfalseに
            for (const key of keys) {
                this.realObjectData.applist[key].defaultOpen = false;
            }

            // 選択行をtrueに
            const selectedKey = keys[this.selectedRowIndex];
            this.realObjectData.applist[selectedKey].defaultOpen = true;

            this.isModified = true;
            this.renderApplistTable();
            this.updateApplistTab();
        }
    }

    /**
     * 変更を適用
     */
    async applyChanges() {
        if (!this.isModified) {
            this.closeWindow();
            return;
        }

        try {
            // 1. 実身を読み込む
            const loadMessageId = `load-real-object-${Date.now()}-${Math.random()}`;
            this.messageBus.send('load-real-object', {
                realId: this.realId,
                messageId: loadMessageId
            });

            const loadResult = await this.messageBus.waitFor('real-object-loaded', 5000, (data) => {
                return data.messageId === loadMessageId;
            });

            if (!loadResult || !loadResult.success || !loadResult.realObject) {
                await this.showMessageDialog('実身の読み込みに失敗しました。', [{ label: 'OK', value: 'ok' }], 0);
                return;
            }

            // 2. メタデータのapplistを更新
            const realObject = loadResult.realObject;
            realObject.metadata = realObject.metadata || {};
            realObject.metadata.applist = this.realObjectData.applist;

            // 3. 実身を保存する
            const saveMessageId = `save-real-object-${Date.now()}-${Math.random()}`;
            this.messageBus.send('save-real-object', {
                realId: this.realId,
                realObject: realObject,
                messageId: saveMessageId
            });

            const saveResult = await this.messageBus.waitFor('real-object-saved', 5000, (data) => {
                return data.messageId === saveMessageId;
            });

            if (saveResult && saveResult.success) {
                this.isModified = false;
                this.closeWindow();
            } else {
                await this.showMessageDialog('保存に失敗しました。', [{ label: 'OK', value: 'ok' }], 0);
            }
        } catch (error) {
            await this.showMessageDialog('保存中にエラーが発生しました。', [{ label: 'OK', value: 'ok' }], 0);
        }
    }

    /**
     * ウィンドウを閉じる（キャンセルボタン押下時）
     * isModified が true の場合は handleCloseRequest() で
     * 「保存してから閉じますか？」ダイアログが表示される
     */
    cancelChanges() {
        this.closeWindow();
    }

    /**
     * クローズ前の保存処理（PluginBase.handleCloseRequest()から呼ばれる）
     * 「保存してから閉じますか？」で「保存」が選択された時に実行
     */
    async onSaveBeforeClose() {
        try {
            // 1. 実身を読み込む
            const loadMessageId = `load-real-object-${Date.now()}-${Math.random()}`;
            this.messageBus.send('load-real-object', {
                realId: this.realId,
                messageId: loadMessageId
            });

            const loadResult = await this.messageBus.waitFor('real-object-loaded', 5000, (data) => {
                return data.messageId === loadMessageId;
            });

            const realObject = loadResult.realObject;

            // 2. applistを更新
            realObject.applist = this.buildApplistFromUI();

            // 3. 実身を保存する
            const saveMessageId = `save-real-object-${Date.now()}-${Math.random()}`;
            this.messageBus.send('save-real-object', {
                realId: this.realId,
                realObject: realObject,
                messageId: saveMessageId
            });

            const saveResult = await this.messageBus.waitFor('real-object-saved', 5000, (data) => {
                return data.messageId === saveMessageId;
            });

            if (!saveResult || !saveResult.success) {
                await this.showMessageDialog('保存に失敗しました。', [{ label: 'OK', value: 'ok' }], 0);
            }
        } catch (error) {
            await this.showMessageDialog('保存中にエラーが発生しました。', [{ label: 'OK', value: 'ok' }], 0);
        }
    }

    /**
     * ウィンドウを閉じる
     */
    closeWindow() {
        this.messageBus.send('close-window', {});
    }

    /**
     * エラー時の表示設定
     */
    setErrorDisplay() {
        document.getElementById('relationship').textContent = '取得不可';
        document.getElementById('file-path').textContent = '取得不可';
        document.getElementById('file-size').textContent = '取得不可';
        document.getElementById('make-date').textContent = '取得不可';
        document.getElementById('update-date').textContent = '取得不可';
        document.getElementById('ref-count').textContent = '取得不可';
        document.getElementById('link-count').textContent = '取得不可';
        document.getElementById('owner').textContent = '取得不可';
        document.getElementById('data-type').textContent = '取得不可';
    }

    /**
     * linkタグをカウント
     */
    countLinkTags(xtadContent) {
        const linkRegex = /<link[^>]*>/gi;
        const matches = xtadContent.match(linkRegex);
        return matches ? matches.length : 0;
    }

    /**
     * 数値をカンマ区切りでフォーマット
     */
    formatNumber(num) {
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    /**
     * 日時をフォーマット
     */
    formatDateTime(isoString) {
        if (!isoString) return '-';

        try {
            const date = new Date(isoString);
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const hours = String(date.getHours()).padStart(2, '0');
            const minutes = String(date.getMinutes()).padStart(2, '0');
            const seconds = String(date.getSeconds()).padStart(2, '0');

            return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
        } catch (error) {
            return '-';
        }
    }

    /**
     * メニュー定義を取得
     */
    getMenuDefinition() {
        return [];
    }

    /**
     * メニューアクションを処理
     */
    handleMenuAction(action) {
        // 現時点では特になし
    }
}

// DOMContentLoaded後に初期化
document.addEventListener('DOMContentLoaded', () => {
    window.realObjectConfigApp = new RealObjectConfigApp();
});
