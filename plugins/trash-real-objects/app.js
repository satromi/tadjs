/**
 * 屑実身操作プラグイン
 *  別ウィンドウ
 */
class TrashRealObjectsApp {
    constructor() {
        this.trashObjects = [];
        this.selectedObject = null;
        this.copyMode = false; // コピーモード
        this.clipboard = null; // クリップボードに保存された屑実身データ

        this.init();
    }

    async init() {
        console.log('[TrashRealObjects] 屑実身操作プラグイン初期化');

        // メッセージハンドラーを設定
        this.setupMessageHandler();

        // 右クリックメニューを設定
        this.setupContextMenu();

        // ウィンドウアクティブ化
        this.setupWindowActivation();

        // キーボードショートカットを設定
        this.setupKeyboardShortcuts();
    }

    setupMessageHandler() {
        window.addEventListener('message', async (event) => {
            if (event.data && event.data.type === 'init') {
                console.log('[TrashRealObjects] init受信');

                // refCount=0の実身を読み込む
                await this.loadTrashRealObjects();

                // 表示
                this.renderTrashObjects();
            } else if (event.data && event.data.type === 'menu-action') {
                this.handleMenuAction(event.data.action);
            } else if (event.data && event.data.type === 'get-menu-definition') {
                console.log('[TrashRealObjects] get-menu-definition受信, messageId:', event.data.messageId);
                const menuDefinition = this.getMenuDefinition();
                console.log('[TrashRealObjects] メニュー定義を生成:', menuDefinition);
                if (window.parent && window.parent !== window) {
                    window.parent.postMessage({
                        type: 'menu-definition-response',
                        messageId: event.data.messageId,
                        menuDefinition: menuDefinition
                    }, '*');
                    console.log('[TrashRealObjects] menu-definition-response送信');
                }
            } else if (event.data && event.data.type === 'copy-mode-changed') {
                this.copyMode = event.data.copyMode;
                console.log('[TrashRealObjects] コピーモード設定:', this.copyMode);
            } else if (event.data && event.data.type === 'unreferenced-real-objects-response') {
                this.handleUnreferencedRealObjectsResponse(event.data);
            }
        });
    }

    handleUnreferencedRealObjectsResponse(data) {
        if (data.success && data.realObjects) {
            this.trashObjects = data.realObjects;
            this.renderTrashObjects();
            console.log('[TrashRealObjects] 屑実身読み込み成功:', this.trashObjects.length, '件');
        } else {
            console.error('[TrashRealObjects] 屑実身読み込み失敗');
        }
    }

    getMenuDefinition() {
        console.log('[TrashRealObjects] getMenuDefinition呼び出し, selectedObject:', this.selectedObject ? this.selectedObject.realId : 'なし');

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
            console.log('[TrashRealObjects] 編集メニューを追加');
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
        } else {
            console.log('[TrashRealObjects] 編集メニューをスキップ（selectedObjectなし）');
        }

        // 再探索メニューを追加
        menuDefinition.push({
            text: '再探索',
            action: 'rescan'
        });

        return menuDefinition;
    }

    handleMenuAction(action) {
        switch (action) {
            case 'toggle-fullscreen':
                this.toggleFullscreen();
                break;
            case 'refresh':
                this.refresh();
                break;
            case 'copy':
                this.copyToClipboard();
                break;
            case 'paste':
                this.pasteFromClipboard();
                break;
            case 'cut':
                this.cutToClipboard();
                break;
            case 'redo':
                this.moveFromClipboard();
                break;
            case 'delete':
                this.deleteRealObject();
                break;
            case 'rescan':
                this.rescanFilesystem();
                break;
        }
    }

    async loadTrashRealObjects() {
        if (window.parent && window.parent !== window) {
            const messageId = `load-trash-${Date.now()}-${Math.random()}`;
            this.currentLoadMessageId = messageId;

            window.parent.postMessage({
                type: 'get-unreferenced-real-objects',
                messageId: messageId
            }, '*');

            console.log('[TrashRealObjects] 屑実身読み込み要求送信:', messageId);
        }
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

        console.log(`[TrashRealObjects] ${this.trashObjects.length}個の屑実身を表示`);
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
        console.log('[TrashRealObjects] ドラッグ開始:', obj.name || obj.realId);

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
        console.log('[TrashRealObjects] ドラッグ終了');

        // スタイルを元に戻す
        event.target.style.opacity = '1';
    }

    selectTrashObject(obj) {
        console.log('[TrashRealObjects] 選択:', obj ? obj.realId : 'なし');
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

        // 親ウィンドウにコピーモードを通知
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: 'set-copy-mode',
                copyMode: true
            }, '*');
        }

        console.log('[TrashRealObjects] クリップボードへコピー:', this.selectedObject.realId);
    }

    async pasteFromClipboard() {
        if (!this.clipboard) {
            console.warn('[TrashRealObjects] クリップボードが空です');
            return;
        }

        // refCountを1に更新（クリップボードからのコピー）
        await this.updateRefCount(this.clipboard.realId, 1);
        await this.refresh();

        console.log('[TrashRealObjects] クリップボードからコピー:', this.clipboard.realId);
    }

    cutToClipboard() {
        if (!this.selectedObject) return;

        this.clipboard = { ...this.selectedObject };
        this.copyMode = false;

        // 親ウィンドウにコピーモードを通知
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: 'set-copy-mode',
                copyMode: false
            }, '*');
        }

        console.log('[TrashRealObjects] クリップボードへ移動:', this.selectedObject.realId);
    }

    async moveFromClipboard() {
        if (!this.clipboard) {
            console.warn('[TrashRealObjects] クリップボードが空です');
            return;
        }

        // refCountを1に更新（クリップボードからの移動）
        await this.updateRefCount(this.clipboard.realId, 1);
        this.clipboard = null;
        await this.refresh();

        console.log('[TrashRealObjects] クリップボードから移動完了');
    }

    async deleteRealObject() {
        if (!this.selectedObject) return;

        const realId = this.selectedObject.realId;
        const realName = this.selectedObject.realName || '無題';

        // 標準メッセージダイアログで確認
        const dialogMessageId = `confirm-delete-${Date.now()}-${Math.random()}`;

        const handleDialogResponse = async (e) => {
            if (e.data && e.data.type === 'message-dialog-response' && e.data.messageId === dialogMessageId) {
                window.removeEventListener('message', handleDialogResponse);

                // 「はい」が選択された場合のみ削除
                if (e.data.result === 'yes') {
                    // 親ウィンドウに削除要求
                    const deleteMessageId = `delete-real-${Date.now()}-${Math.random()}`;

                    const handleDeleteResponse = (e) => {
                        if (e.data && e.data.type === 'delete-real-object-response' && e.data.messageId === deleteMessageId) {
                            window.removeEventListener('message', handleDeleteResponse);

                            if (e.data.success) {
                                console.log('[TrashRealObjects] 実身削除成功:', realId);
                                this.selectedObject = null;
                                this.refresh();
                            } else {
                                console.error('[TrashRealObjects] 実身削除失敗:', e.data.error);
                                // エラーメッセージも標準ダイアログで表示
                                const errorMessageId = `error-delete-${Date.now()}-${Math.random()}`;
                                window.parent.postMessage({
                                    type: 'show-message-dialog',
                                    messageId: errorMessageId,
                                    message: `実身の削除に失敗しました: ${e.data.error}`,
                                    buttons: [
                                        { label: 'OK', value: 'ok' }
                                    ],
                                    defaultButton: 0
                                }, '*');
                            }
                        }
                    };

                    window.addEventListener('message', handleDeleteResponse);

                    window.parent.postMessage({
                        type: 'physical-delete-real-object',
                        realId: realId,
                        messageId: deleteMessageId
                    }, '*');
                }
            }
        };

        window.addEventListener('message', handleDialogResponse);

        // 確認ダイアログを表示
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: 'show-message-dialog',
                messageId: dialogMessageId,
                message: `実身「${realName}」を完全に削除しますか？\nこの操作は取り消せません。`,
                buttons: [
                    { label: 'はい', value: 'yes' },
                    { label: 'いいえ', value: 'no' }
                ],
                defaultButton: 1  // 「いいえ」をデフォルトに
            }, '*');
        }
    }

    async updateRefCount(realId, newRefCount) {
        if (window.parent && window.parent !== window) {
            const messageId = `update-refcount-${Date.now()}-${Math.random()}`;

            const handleMessage = (e) => {
                if (e.data && e.data.type === 'update-refcount-response' && e.data.messageId === messageId) {
                    window.removeEventListener('message', handleMessage);
                    console.log('[TrashRealObjects] refCount更新完了:', realId, newRefCount);
                }
            };

            window.addEventListener('message', handleMessage);

            window.parent.postMessage({
                type: 'update-real-object-refcount',
                realId: realId,
                refCount: newRefCount,
                messageId: messageId
            }, '*');
        }
    }

    async refresh() {
        await this.loadTrashRealObjects();
    }

    async rescanFilesystem() {
        console.log('[TrashRealObjects] ファイルシステム再探索開始');

        // 親ウィンドウに再探索要求を送信
        if (window.parent && window.parent !== window) {
            const messageId = `rescan-${Date.now()}-${Math.random()}`;

            const handleResponse = async (e) => {
                if (e.data && e.data.type === 'rescan-filesystem-response' && e.data.messageId === messageId) {
                    window.removeEventListener('message', handleResponse);

                    if (e.data.success) {
                        console.log('[TrashRealObjects] 再探索完了:', e.data.syncCount, '件');
                        // 再探索後にリストを再読み込み
                        await this.loadTrashRealObjects();
                    } else {
                        console.error('[TrashRealObjects] 再探索エラー:', e.data.error);
                    }
                }
            };

            window.addEventListener('message', handleResponse);

            window.parent.postMessage({
                type: 'rescan-filesystem',
                messageId: messageId
            }, '*');
        }
    }

    toggleFullscreen() {
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: 'toggle-fullscreen'
            }, '*');
        }
    }

    setupContextMenu() {
        document.addEventListener('contextmenu', (e) => {
            e.preventDefault();

            console.log('[TrashRealObjects] 右クリック検出, target:', e.target);

            // 右クリックされた要素から仮身を特定
            let target = e.target;
            while (target && target !== document.body && !target.classList.contains('trash-object-vobj')) {
                target = target.parentElement;
            }

            console.log('[TrashRealObjects] 仮身要素:', target ? target.dataset.realId : 'なし');

            // 仮身が右クリックされた場合、その仮身を選択
            if (target && target.dataset.realId) {
                const realId = target.dataset.realId;
                console.log('[TrashRealObjects] 仮身realId:', realId);
                const obj = this.trashObjects.find(o => o.realId === realId);
                if (obj) {
                    console.log('[TrashRealObjects] 仮身を選択:', obj.realName);
                    this.selectedObject = obj;  // 直接設定（再レンダリングを避ける）
                    // 視覚的に選択状態を更新
                    this.selectTrashObject(obj);
                    console.log('[TrashRealObjects] selectedObject設定完了:', this.selectedObject.realId);
                } else {
                    console.log('[TrashRealObjects] 仮身が見つかりません:', realId);
                }
            } else {
                console.log('[TrashRealObjects] 仮身以外の場所を右クリック');
            }

            if (window.parent && window.parent !== window) {
                const rect = window.frameElement.getBoundingClientRect();

                window.parent.postMessage({
                    type: 'context-menu-request',
                    x: rect.left + e.clientX,
                    y: rect.top + e.clientY
                }, '*');
            }
        });

        document.addEventListener('click', () => {
            if (window.parent && window.parent !== window) {
                window.parent.postMessage({
                    type: 'close-context-menu'
                }, '*');
            }
        });
    }

    setupWindowActivation() {
        document.addEventListener('mousedown', () => {
            if (window.parent && window.parent !== window) {
                window.parent.postMessage({
                    type: 'activate-window'
                }, '*');
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
