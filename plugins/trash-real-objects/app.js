/**
 * 屑実身操作プラグイン
 * 別ウィンドウ
 * @module TrashRealObjectsApp
 * @extends PluginBase
 * @license MIT
 * @author satromi
 * @version 1.0.0
 */
const logger = window.getLogger('TrashRealObjects');

class TrashRealObjectsApp extends window.PluginBase {
    constructor() {
        super('TrashRealObjects');

        this.trashObjects = [];
        this.selectedObjects = new Set();  // realIdのSet（複数選択対応）
        this.copyMode = false; // コピーモード
        this.clipboard = null; // クリップボードに保存された屑実身データ

        // MessageBusはPluginBaseで初期化済み

        // IconCacheManagerを初期化
        if (window.IconCacheManager && this.messageBus) {
            this.iconManager = new window.IconCacheManager(this.messageBus, '[TrashRealObjects]');
        }

        this.init();
    }

    async init() {
        logger.info('[TrashRealObjects] 屑実身操作プラグイン初期化');

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

        // リスト背景クリックで選択解除
        this.setupSelectionClear();
    }

    /**
     * リスト背景クリック時の選択解除を設定
     */
    setupSelectionClear() {
        const trashList = document.getElementById('trashList');
        if (trashList) {
            trashList.addEventListener('click', (e) => {
                // 仮身要素からのイベント伝播は stopPropagation() で止まるため
                // ここに来るのはリスト背景クリックのみ
                if (e.target === trashList || e.target.classList.contains('empty-message')) {
                    this.clearSelection();
                }
            });
        }
    }

    /**
     * コンテキストメニュー表示前のフック
     * 右クリックされた要素から屑実身を選択
     * @param {MouseEvent} e - contextmenuイベント
     */
    onContextMenu(e) {
        // 右クリックされた要素から仮身を特定
        let target = e.target;
        while (target && target !== document.body && !target.classList.contains('trash-object-vobj')) {
            target = target.parentElement;
        }

        // 仮身が右クリックされた場合
        if (target && target.dataset.realId) {
            const realId = target.dataset.realId;
            // 右クリックされた仮身が未選択の場合、単一選択として扱う
            if (!this.selectedObjects.has(realId)) {
                this.selectedObjects.clear();
                this.selectedObjects.add(realId);
                this.updateSelectionDisplay();
            }
            // 選択済みの場合はそのまま（複数選択を維持）
        }
    }

    /**
     * MessageBusのハンドラを登録
     * 親ウィンドウからのメッセージを受信して処理
     */
    setupMessageBusHandlers() {
        // 共通MessageBusハンドラを登録（PluginBaseで定義）
        // set-scroll-position など親ウィンドウからの制御メッセージを処理
        this.setupCommonMessageBusHandlers();

        // 初期化メッセージ
        this.messageBus.on('init', async (data) => {
            logger.info('[TrashRealObjects] init受信');

            // 共通初期化処理（windowId設定、スクロール状態送信）
            this.onInit(data);

            // refCount=0の実身を読み込む
            await this.loadTrashRealObjects();

            // 表示
            this.renderTrashObjects();
        });

        // menu-action, get-menu-definition は setupCommonMessageBusHandlers() で登録済み
        // getMenuDefinition() と executeMenuAction() をオーバーライドして処理

        // コピーモード変更
        this.messageBus.on('copy-mode-changed', (data) => {
            this.copyMode = data.copyMode;
        });

        // 未参照実身リスト受信
        this.messageBus.on('unreferenced-real-objects-response', (data) => {
            this.handleUnreferencedRealObjectsResponse(data);
        });
    }

    handleUnreferencedRealObjectsResponse(data) {
        if (data.success && data.realObjects) {
            this.trashObjects = data.realObjects;
            this.renderTrashObjects();
            logger.info('[TrashRealObjects] 屑実身読み込み成功:', this.trashObjects.length, '件');
        } else {
            logger.error('[TrashRealObjects] 屑実身読み込み失敗');
        }
    }

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

        // 屑実身が選択されている場合は「編集」メニューを追加
        if (this.selectedObjects.size > 0) {
            const isSingleSelection = this.selectedObjects.size === 1;
            const editSubmenu = [
                { text: 'クリップボードへコピー', action: 'copy', shortcut: 'Ctrl+C', disabled: !isSingleSelection },
                { text: 'クリップボードからコピー', action: 'paste', shortcut: 'Ctrl+V' },
                { text: 'クリップボードへ移動', action: 'cut', shortcut: 'Ctrl+X', disabled: !isSingleSelection },
                { text: 'クリップボードから移動', action: 'redo', shortcut: 'Ctrl+Z' },
                { separator: true },
                { text: '削除', action: 'delete', shortcut: 'Delete' }
            ];

            menuDefinition.push({
                text: '編集',
                submenu: editSubmenu
            });
        }

        // 再探索メニューを追加
        menuDefinition.push({
            text: '再探索',
            action: 'rescan'
        });

        return menuDefinition;
    }

    /**
     * メニューアクション処理
     * setupCommonMessageBusHandlers() の menu-action ハンドラから呼ばれる
     */
    async executeMenuAction(action) {
        switch (action) {
            case 'toggle-fullscreen':
                this.toggleFullscreen();
                break;
            case 'refresh':
                await this.refresh();
                break;
            case 'copy':
                this.copyToClipboard();
                break;
            case 'paste':
                await this.pasteFromClipboard();
                break;
            case 'cut':
                this.cutToClipboard();
                break;
            case 'redo':
                await this.moveFromClipboard();
                break;
            case 'delete':
                await this.deleteRealObject();
                break;
            case 'rescan':
                await this.rescanFilesystem();
                break;
        }
    }

    async loadTrashRealObjects() {
        const messageId = this.generateMessageId('load-trash');
        this.currentLoadMessageId = messageId;

        this.messageBus.send('get-unreferenced-real-objects', {
            messageId: messageId
        });
    }

    renderTrashObjects() {
        const listElement = document.getElementById('trashList');
        if (!listElement) return;

        listElement.innerHTML = '';

        if (this.trashObjects.length === 0) {
            const emptyMessage = document.createElement('div');
            emptyMessage.className = 'empty-message';
            emptyMessage.textContent = '屑実身はありません';
            listElement.appendChild(emptyMessage);
            // スクロールバーを更新
            this.notifyScrollChange();
            return;
        }

        // 各屑実身を仮身として表示（原紙箱と同じ形式）
        this.trashObjects.forEach((obj, index) => {
            const vobjElement = this.createTrashObjectElement(obj, index);
            listElement.appendChild(vobjElement);
        });

        // スクロールバーを更新
        this.notifyScrollChange();
    }

    createTrashObjectElement(obj, index) {
        const vobj = document.createElement('div');
        vobj.className = 'trash-object-vobj';
        vobj.dataset.realId = obj.realId;
        vobj.dataset.index = index;

        // 選択状態のクラス
        if (this.selectedObjects.has(obj.realId)) {
            vobj.classList.add('selected');
        }

        // アイコン要素
        const icon = document.createElement('img');
        icon.className = 'trash-object-icon';
        icon.alt = '';
        vobj.appendChild(icon);

        // IconCacheManagerでアイコンを読み込み
        if (this.iconManager) {
            this.iconManager.loadIcon(obj.realId).then(iconData => {
                if (iconData) {
                    icon.src = `data:image/x-icon;base64,${iconData}`;
                }
            });
        }

        // タイトルテキスト
        const title = document.createElement('span');
        title.className = 'trash-object-title';
        title.textContent = obj.name || '無題';

        vobj.appendChild(title);

        // draggableを設定
        vobj.draggable = true;

        // クリックで選択（eventを渡してShift+クリック対応）
        vobj.addEventListener('click', (e) => {
            e.stopPropagation();
            this.selectTrashObject(obj, e);
        });

        // ドラッグ開始イベント
        vobj.addEventListener('dragstart', (e) => {
            this.handleDragStart(e, obj);
        });

        // ドラッグ終了イベント
        vobj.addEventListener('dragend', (e) => {
            this.handleDragEnd(e);
        });

        return vobj;
    }

    /**
     * ドラッグ開始処理
     */
    handleDragStart(event, obj) {
        // ドラッグデータを設定
        const dragData = {
            type: 'trash-real-object-restore',
            source: 'trash-real-objects',
            realObject: {
                realId: obj.realId,
                name: obj.name || '無題',
                metadata: obj
            }
        };

        event.dataTransfer.setData('text/plain', JSON.stringify(dragData));
        event.dataTransfer.effectAllowed = 'copy';

        // ドラッグ中のスタイル
        event.target.style.opacity = '0.5';
    }

    /**
     * ドラッグ終了処理
     */
    handleDragEnd(event) {
        // スタイルを元に戻す
        event.target.style.opacity = '1';
    }

    /**
     * 屑実身を選択
     * @param {Object} obj - 選択する屑実身オブジェクト
     * @param {Event} event - クリックイベント（Shiftキー判定用）
     */
    selectTrashObject(obj, event = null) {
        const isShiftKey = event && event.shiftKey;
        const realId = obj.realId;

        if (isShiftKey) {
            // Shift+クリック: トグル選択
            if (this.selectedObjects.has(realId)) {
                // 既に選択されている場合は解除
                this.selectedObjects.delete(realId);
            } else {
                // 選択されていない場合は追加
                this.selectedObjects.add(realId);
            }
        } else {
            // 通常クリック: 単一選択（既存選択をクリアして新規選択）
            this.selectedObjects.clear();
            this.selectedObjects.add(realId);
        }

        // 選択状態を視覚的に更新
        this.updateSelectionDisplay();
    }

    /**
     * 選択状態の表示を更新
     */
    updateSelectionDisplay() {
        const allVobjs = document.querySelectorAll('.trash-object-vobj');
        allVobjs.forEach(vobj => {
            if (this.selectedObjects.has(vobj.dataset.realId)) {
                vobj.classList.add('selected');
            } else {
                vobj.classList.remove('selected');
            }
        });
    }

    /**
     * 全選択を解除
     */
    clearSelection() {
        this.selectedObjects.clear();
        this.updateSelectionDisplay();
    }

    /**
     * 全ての屑実身を選択
     */
    selectAllTrashObjects() {
        this.selectedObjects.clear();
        this.trashObjects.forEach(obj => {
            this.selectedObjects.add(obj.realId);
        });
        this.updateSelectionDisplay();
    }

    /**
     * 選択中の屑実身を取得（単一選択時のみ）
     * @returns {Object|null} 選択中の屑実身オブジェクト（複数選択時はnull）
     */
    getSelectedObject() {
        if (this.selectedObjects.size !== 1) {
            return null;
        }
        const realId = Array.from(this.selectedObjects)[0];
        return this.trashObjects.find(o => o.realId === realId) || null;
    }

    copyToClipboard() {
        // 単一選択時のみ動作
        const selectedObj = this.getSelectedObject();
        if (!selectedObj) return;

        this.clipboard = { ...selectedObj };
        this.copyMode = true;

        // グローバルクリップボードにも仮身形式で設定（他プラグインとの連携用）
        const vobjData = {
            link_id: selectedObj.realId,
            link_name: selectedObj.name || '無題',
            vobjleft: 0,
            vobjtop: 0,
            vobjright: 100,
            vobjbottom: 30
        };
        this.setClipboard(vobjData);

        this.messageBus.send('set-copy-mode', {
            copyMode: true
        });
    }

    async pasteFromClipboard() {
        if (!this.clipboard) {
            logger.warn('[TrashRealObjects] クリップボードが空です');
            return;
        }

        // refCountを1に更新（クリップボードからのコピー）
        await this.updateRefCount(this.clipboard.realId, 1);
        await this.refresh();
    }

    cutToClipboard() {
        // 単一選択時のみ動作
        const selectedObj = this.getSelectedObject();
        if (!selectedObj) return;

        this.clipboard = { ...selectedObj };
        this.copyMode = false;

        // グローバルクリップボードにも仮身形式で設定（他プラグインとの連携用）
        const vobjData = {
            link_id: selectedObj.realId,
            link_name: selectedObj.name || '無題',
            vobjleft: 0,
            vobjtop: 0,
            vobjright: 100,
            vobjbottom: 30
        };
        this.setClipboard(vobjData);

        this.messageBus.send('set-copy-mode', {
            copyMode: false
        });
    }

    async moveFromClipboard() {
        if (!this.clipboard) {
            logger.warn('[TrashRealObjects] クリップボードが空です');
            return;
        }

        // refCountを1に更新（クリップボードからの移動）
        await this.updateRefCount(this.clipboard.realId, 1);
        this.clipboard = null;
        await this.refresh();
    }

    /**
     * 選択中の屑実身を完全に削除
     * 確認ダイアログを表示後、物理削除を実行
     */
    async deleteRealObject() {
        if (this.selectedObjects.size === 0) return;

        const selectedCount = this.selectedObjects.size;
        const realIds = Array.from(this.selectedObjects);

        // 選択されたオブジェクトの名前を取得
        const selectedObjs = this.trashObjects.filter(obj => this.selectedObjects.has(obj.realId));
        const names = selectedObjs.map(obj => obj.name || '無題');

        // 確認メッセージ
        const message = selectedCount === 1
            ? `実身「${names[0]}」を完全に削除しますか？\nこの操作は取り消せません。`
            : `${selectedCount}件の実身を完全に削除しますか？\nこの操作は取り消せません。`;

        // 確認ダイアログを表示
        this.messageBus.sendWithCallback('show-message-dialog', {
            message: message,
            buttons: [
                { label: 'はい', value: 'yes' },
                { label: 'いいえ', value: 'no' }
            ],
            defaultButton: 1  // 「いいえ」をデフォルトに
        }, async (confirmResult) => {
            if (confirmResult.error) {
                logger.warn('[TrashRealObjects] Confirm dialog error:', confirmResult.error);
                return;
            }

            // 「はい」が選択された場合のみ削除
            if (confirmResult.result === 'yes') {
                // 選択された全ての実身を削除
                let deleteCount = 0;
                let errorCount = 0;

                for (const realId of realIds) {
                    await new Promise((resolve) => {
                        this.messageBus.sendWithCallback('physical-delete-real-object', {
                            realId: realId
                        }, (deleteResult) => {
                            if (deleteResult.error) {
                                logger.error('[TrashRealObjects] Delete request error:', deleteResult.error);
                                errorCount++;
                            } else if (deleteResult.success) {
                                logger.info('[TrashRealObjects] 実身削除成功:', realId);
                                deleteCount++;
                            } else {
                                logger.error('[TrashRealObjects] 実身削除失敗:', deleteResult.error);
                                errorCount++;
                            }
                            resolve();
                        });
                    });
                }

                // 選択をクリアしてリストを更新
                this.selectedObjects.clear();
                await this.refresh();

                // エラーがあった場合は通知
                if (errorCount > 0) {
                    this.messageBus.sendWithCallback('show-message-dialog', {
                        message: `${deleteCount}件の削除に成功、${errorCount}件の削除に失敗しました。`,
                        buttons: [
                            { label: 'OK', value: 'ok' }
                        ],
                        defaultButton: 0
                    }, () => {});
                }
            }
        });
    }

    /**
     * 実身のrefCountを更新
     * @param {string} realId - 対象の実身ID
     * @param {number} newRefCount - 新しいrefCount値
     */
    async updateRefCount(realId, newRefCount) {
        this.messageBus.sendWithCallback('update-real-object-refcount', {
            realId: realId,
            refCount: newRefCount
        }, (result) => {
            if (result.error) {
                logger.warn('[TrashRealObjects] UpdateRefCount error:', result.error);
            }
        });
    }

    async refresh() {
        await this.loadTrashRealObjects();
    }

    /**
     * ファイルシステムを再探索して実身/仮身の整合性を確認
     */
    async rescanFilesystem() {
        logger.info('[TrashRealObjects] ファイルシステム再探索開始');

        this.messageBus.sendWithCallback('rescan-filesystem', {}, async (result) => {
            if (result.error) {
                logger.error('[TrashRealObjects] Rescan error:', result.error);
                return;
            }

            if (result.success) {
                logger.info('[TrashRealObjects] 再探索完了:', result.syncCount, '件');
                // 再探索後にリストを再読み込み
                await this.loadTrashRealObjects();
            } else {
                logger.error('[TrashRealObjects] 再探索エラー:', result.error);
            }
        });
    }

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'l') {
                e.preventDefault();
                this.toggleFullscreen();
            } else if (e.ctrlKey && e.key === 'a') {
                // Ctrl+A: 全選択
                e.preventDefault();
                this.selectAllTrashObjects();
            } else if (e.ctrlKey && e.key === 'c') {
                e.preventDefault();
                this.copyToClipboard();
            } else if (e.ctrlKey && e.key === 'v') {
                e.preventDefault();
                this.pasteFromClipboard();
            } else if (e.ctrlKey && e.key === 'x') {
                e.preventDefault();
                this.cutToClipboard();
            } else if (e.ctrlKey && e.key === 'z') {
                e.preventDefault();
                this.moveFromClipboard();
            } else if (e.key === 'Delete') {
                e.preventDefault();
                this.deleteRealObject();
            }
        });
    }
}

// DOMContentLoaded後に初期化
document.addEventListener('DOMContentLoaded', () => {
    window.trashRealObjectsApp = new TrashRealObjectsApp();
});
