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
        this.selectedObject = null;
        this.copyMode = false; // コピーモード
        this.clipboard = null; // クリップボードに保存された屑実身データ

        // MessageBusを初期化
        if (window.MessageBus) {
            this.messageBus = new window.MessageBus({
                debug: false,
                pluginName: 'TrashRealObjects'
            });
            this.messageBus.start();
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

        // キーボードショートカットを設定
        this.setupKeyboardShortcuts();
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

        // 仮身が右クリックされた場合、その仮身を選択
        if (target && target.dataset.realId) {
            const realId = target.dataset.realId;
            const obj = this.trashObjects.find(o => o.realId === realId);
            if (obj) {
                this.selectedObject = obj;
                this.selectTrashObject(obj);
            }
        }
    }

    /**
     * MessageBusのハンドラを登録
     * 親ウィンドウからのメッセージを受信して処理
     */
    setupMessageBusHandlers() {
        // 初期化メッセージ
        this.messageBus.on('init', async (data) => {
            logger.info('[TrashRealObjects] init受信');

            // refCount=0の実身を読み込む
            await this.loadTrashRealObjects();

            // 表示
            this.renderTrashObjects();
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
        if (this.selectedObject) {
            const editSubmenu = [
                { text: 'クリップボードへコピー', action: 'copy', shortcut: 'Ctrl+C' },
                { text: 'クリップボードからコピー', action: 'paste', shortcut: 'Ctrl+V' },
                { text: 'クリップボードへ移動', action: 'cut', shortcut: 'Ctrl+X' },
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

    async handleMenuAction(action) {
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
        const messageId = `load-trash-${Date.now()}-${Math.random()}`;
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
            return;
        }

        // 各屑実身を仮身として表示（原紙箱と同じ形式）
        this.trashObjects.forEach((obj, index) => {
            const vobjElement = this.createTrashObjectElement(obj, index);
            listElement.appendChild(vobjElement);
        });
    }

    createTrashObjectElement(obj, index) {
        const vobj = document.createElement('div');
        vobj.className = 'trash-object-vobj';
        vobj.dataset.realId = obj.realId;
        vobj.dataset.index = index;

        // 仮身枠（原紙箱と同じスタイル）
        vobj.style.border = '1px solid #000000';
        vobj.style.backgroundColor = '#ffffff';
        vobj.style.width = '300px';
        vobj.style.height = '30px';
        vobj.style.margin = '5px';
        vobj.style.padding = '4px';
        vobj.style.cursor = 'pointer';
        vobj.style.display = 'flex';
        vobj.style.alignItems = 'center';
        vobj.style.boxSizing = 'border-box';

        // 選択状態の背景色
        if (this.selectedObject && this.selectedObject.realId === obj.realId) {
            vobj.style.backgroundColor = '#e0e0ff';
        }

        // タイトルテキスト
        const title = document.createElement('span');
        title.textContent = obj.name || obj.realName || '無題';
        title.style.fontSize = '14px';
        title.style.color = '#000000';
        title.style.whiteSpace = 'nowrap';
        title.style.overflow = 'hidden';
        title.style.textOverflow = 'ellipsis';
        title.style.flex = '1';

        vobj.appendChild(title);

        // draggableを設定
        vobj.draggable = true;

        // クリックで選択
        vobj.addEventListener('click', (e) => {
            e.stopPropagation();
            this.selectTrashObject(obj);
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

    selectTrashObject(obj) {
        this.selectedObject = obj;

        // 選択状態を視覚的に更新（全体の再レンダリングではなく、スタイル更新のみ）
        const allVobjs = document.querySelectorAll('.trash-object-vobj');
        allVobjs.forEach(vobj => {
            if (vobj.dataset.realId === obj.realId) {
                vobj.style.backgroundColor = '#e0e0ff';
            } else {
                vobj.style.backgroundColor = '#ffffff';
            }
        });
    }

    copyToClipboard() {
        if (!this.selectedObject) return;

        this.clipboard = { ...this.selectedObject };
        this.copyMode = true;

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
        if (!this.selectedObject) return;

        this.clipboard = { ...this.selectedObject };
        this.copyMode = false;

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
        if (!this.selectedObject) return;

        const realId = this.selectedObject.realId;
        const realName = this.selectedObject.realName || '無題';

        // 確認ダイアログを表示
        this.messageBus.sendWithCallback('show-message-dialog', {
            message: `実身「${realName}」を完全に削除しますか？\nこの操作は取り消せません。`,
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
                // 親ウィンドウに削除要求
                this.messageBus.sendWithCallback('physical-delete-real-object', {
                    realId: realId
                }, async (deleteResult) => {
                    if (deleteResult.error) {
                        logger.error('[TrashRealObjects] Delete request error:', deleteResult.error);
                        return;
                    }

                    if (deleteResult.success) {
                        logger.info('[TrashRealObjects] 実身削除成功:', realId);
                        this.selectedObject = null;
                        await this.refresh();
                    } else {
                        logger.error('[TrashRealObjects] 実身削除失敗:', deleteResult.error);
                        // エラーメッセージも標準ダイアログで表示
                        this.messageBus.sendWithCallback('show-message-dialog', {
                            message: `実身の削除に失敗しました: ${deleteResult.error}`,
                            buttons: [
                                { label: 'OK', value: 'ok' }
                            ],
                            defaultButton: 0
                        }, () => {});
                    }
                });
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
