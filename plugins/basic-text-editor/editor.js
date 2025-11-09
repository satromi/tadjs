/**
 * 基本文章編集プラグイン
 * TADファイルをリッチテキストエディタで編集
 */

class BasicTextEditor {
    constructor() {
        this.editor = document.getElementById('editor');
        this.currentFile = null;
        this.tadData = null;
        this.isFullscreen = false;
        this.wrapMode = true;
        this.viewMode = 'formatted'; // 'formatted' or 'xml'
        this.dialogMessageId = 0; // ダイアログメッセージID
        this.realId = null; // 実身ID
        this.isModified = false; // 編集状態フラグ
        this.originalContent = ''; // 保存時の内容
        this.updateHeightTimer = null; // スクロールバー更新のデバウンスタイマー
        this.mutationObserver = null; // MutationObserverインスタンス
        this.suppressMutationObserver = false; // MutationObserver一時停止フラグ
        this.selectedImage = null; // 選択中の画像要素
        this.isResizing = false; // リサイズ中フラグ
        this.resizeStartX = 0; // リサイズ開始X座標
        this.resizeStartY = 0; // リサイズ開始Y座標
        this.resizeStartWidth = 0; // リサイズ開始時の幅
        this.resizeStartHeight = 0; // リサイズ開始時の高さ
        this.isDraggingImage = false; // 画像ドラッグ中フラグ
        this.dragStartX = 0; // ドラッグ開始X座標
        this.dragStartY = 0; // ドラッグ開始Y座標
        this.openedRealObjects = new Map(); // 開いている実身を追跡（realId -> windowId）
        this.virtualObjectRenderer = null; // VirtualObjectRendererインスタンス（初期化後に設定）
        this.virtualObjectDropSuccess = false; // 仮身ドロップ成功フラグ
        this.iconCache = new Map(); // アイコンキャッシュ（realId -> Base64データ）
        this.windowId = 'editor-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9); // 一意なウィンドウID

        // パフォーマンス最適化用のデバウンス/スロットル関数
        this.debouncedUpdateContentHeight = null;  // init()で初期化

        this.init();
    }

    init() {
        // VirtualObjectRendererの初期化
        if (window.VirtualObjectRenderer) {
            this.virtualObjectRenderer = new window.VirtualObjectRenderer();
            console.log('[EDITOR] VirtualObjectRenderer initialized');
        }

        // パフォーマンス最適化関数の初期化
        if (window.throttle) {
            console.log('[EDITOR] Performance optimization initialized');
        }

        // デフォルトの折り返しスタイルを設定
        this.editor.style.whiteSpace = 'pre-wrap';
        this.editor.style.wordWrap = 'break-word';

        this.setupEventListeners();
        this.setupContextMenu();
        this.setupWindowActivation();

        // 親ウィンドウからのメッセージを受信
        window.addEventListener('message', (event) => {
            console.log('[EDITOR] メッセージ受信:', event.data);
            console.log('[EDITOR] event.data.type:', event.data ? event.data.type : 'undefined');

            if (event.data && event.data.type === 'init') {
                console.log('[EDITOR] init受信');
                console.log('[EDITOR] fileData:', event.data.fileData);
                console.log('[EDITOR] fileData.xmlData exists:', !!(event.data.fileData && event.data.fileData.xmlData));
                console.log('[EDITOR] fileData.xmlData length:', event.data.fileData && event.data.fileData.xmlData ? event.data.fileData.xmlData.length : 0);

                // realIdを保存（拡張子を除去）
                if (event.data.fileData) {
                    let rawId = event.data.fileData.realId || event.data.fileData.fileId;
                    // _数字.xtad の形式を除去して実身IDのみを取得
                    this.realId = rawId ? rawId.replace(/_\d+\.xtad$/i, '') : null;
                    console.log('[EDITOR] realId設定:', this.realId, '(元:', rawId, ')');

                    // readonlyモードの設定（開いた仮身表示用）
                    if (event.data.fileData.readonly) {
                        this.editor.contentEditable = 'false';
                        this.editor.style.cursor = 'default';
                        console.log('[EDITOR] 読み取り専用モードを適用');
                    }

                    // スクロールバー非表示モードの設定（開いた仮身表示用）
                    if (event.data.fileData.noScrollbar === true) {
                        document.body.style.overflow = 'hidden';
                        this.editor.style.overflow = 'hidden';
                        const pluginContent = document.querySelector('.plugin-content');
                        if (pluginContent) {
                            pluginContent.style.overflow = 'hidden';
                        }
                        console.log('[EDITOR] スクロールバー非表示モードを適用');
                    }

                    // 背景色の設定（開いた仮身表示用）
                    if (event.data.fileData.bgcol) {
                        document.body.style.backgroundColor = event.data.fileData.bgcol;
                        this.editor.style.backgroundColor = event.data.fileData.bgcol;
                        console.log('[EDITOR] 背景色を適用:', event.data.fileData.bgcol);
                    } else if (event.data.fileData.windowConfig && event.data.fileData.windowConfig.backgroundColor) {
                        // ウィンドウ全体の背景色を適用（開いた仮身でない場合）
                        document.body.style.backgroundColor = event.data.fileData.windowConfig.backgroundColor;
                        this.editor.style.backgroundColor = event.data.fileData.windowConfig.backgroundColor;
                        console.log('[EDITOR] ウィンドウ背景色を適用:', event.data.fileData.windowConfig.backgroundColor);
                    }
                }

                this.loadFile(event.data.fileData);

                // キーボードショートカットが動作するようにbodyにフォーカスを設定
                setTimeout(() => {
                    document.body.focus();
                    console.log('[EDITOR] bodyにフォーカスを設定');
                }, 100);
            } else if (event.data && event.data.type === 'window-moved') {
                // ウィンドウ移動終了時にwindowConfigを更新
                this.updateWindowConfig({
                    pos: event.data.pos,
                    width: event.data.width,
                    height: event.data.height
                });
            } else if (event.data && event.data.type === 'window-resized-end') {
                // ウィンドウリサイズ終了時にwindowConfigを更新
                this.updateWindowConfig({
                    pos: event.data.pos,
                    width: event.data.width,
                    height: event.data.height
                });
                // リサイズで折り返しが変わる可能性があるため、スクロールバーを更新
                this.updateContentHeight();
            } else if (event.data && event.data.type === 'window-maximize-toggled') {
                // 全画面表示切り替え時にwindowConfigを更新
                this.updateWindowConfig({
                    pos: event.data.pos,
                    width: event.data.width,
                    height: event.data.height,
                    maximize: event.data.maximize
                });
                // 全画面切り替えで折り返しが変わる可能性があるため、スクロールバーを更新
                this.updateContentHeight();
            } else if (event.data && event.data.type === 'menu-action') {
                console.log('[EDITOR] menu-action受信:', event.data.action);
                this.executeMenuAction(event.data.action, event.data.additionalData);
            } else if (event.data && event.data.type === 'get-menu-definition') {
                console.log('[EDITOR] get-menu-definition受信');
                // メニュー定義を親ウィンドウに返送
                this.getMenuDefinition().then(menuDefinition => {
                    window.parent.postMessage({
                        type: 'menu-definition-response',
                        messageId: event.data.messageId,
                        menuDefinition: menuDefinition
                    }, '*');
                });
            } else if (event.data && event.data.type === 'input-dialog-response') {
                // ダイアログレスポンスを処理
                if (this.dialogCallbacks && this.dialogCallbacks[event.data.messageId]) {
                    this.dialogCallbacks[event.data.messageId](event.data.result);
                    delete this.dialogCallbacks[event.data.messageId];
                }
            } else if (event.data && event.data.type === 'message-dialog-response') {
                // メッセージダイアログレスポンスを処理
                if (this.dialogCallbacks && this.dialogCallbacks[event.data.messageId]) {
                    this.dialogCallbacks[event.data.messageId](event.data.result);
                    delete this.dialogCallbacks[event.data.messageId];
                }
            } else if (event.data && event.data.type === 'window-close-request') {
                // ウィンドウクローズ要求を処理
                this.handleCloseRequest(event.data.windowId);
            } else if (event.data && event.data.type === 'window-closed') {
                // ウィンドウが閉じたことを通知
                this.handleWindowClosed(event.data.windowId, event.data.fileData);
            } else if (event.data && event.data.type === 'parent-drag-position') {
                // 画像ドラッグ中のカーソル位置を表示
                if (this.isDraggingImage) {
                    this.showDropCursor(event.data.clientX, event.data.clientY);
                }
            } else if (event.data && event.data.type === 'parent-mouseup') {
                // ドラッグ終了時にカーソルインジケータを非表示
                this.hideDropCursor();
            } else if (event.data && event.data.type === 'add-virtual-object-from-base') {
                // 原紙箱から仮身追加要求を受信
                console.log('[EDITOR] 原紙箱から仮身追加:', event.data.realId, event.data.name);
                this.addVirtualObjectFromRealId(event.data.realId, event.data.name, event.data.applist);
            } else if (event.data && event.data.type === 'load-virtual-object') {
                // 開いた仮身表示用のデータ受信
                console.log('[EDITOR] load-virtual-object受信:', event.data);

                // readonlyモードの設定（仮身一覧プラグインと同じ処理）
                if (event.data.readonly) {
                    this.editor.contentEditable = 'false';
                    this.editor.style.cursor = 'default';
                    console.log('[EDITOR] 読み取り専用モードを適用');
                }

                // noScrollbarモードの設定（仮身一覧プラグインと同じ処理）
                if (event.data.noScrollbar) {
                    document.body.style.overflow = 'hidden';
                    this.editor.style.overflow = 'hidden';
                    console.log('[EDITOR] スクロールバー非表示モードを適用');
                }

                // 背景色を適用（開いた仮身の場合）
                if (event.data.bgcol) {
                    document.body.style.backgroundColor = event.data.bgcol;
                    this.editor.style.backgroundColor = event.data.bgcol;
                    console.log('[EDITOR] 背景色を適用:', event.data.bgcol);
                }
                this.loadVirtualObjectData(event.data.virtualObj, event.data.realObject);
            } else if (event.data && event.data.type === 'load-data') {
                // 開いた仮身表示用のデータ受信（appListのdefaultOpenから）
                console.log('[EDITOR] load-data受信:', event.data);

                // readonlyモードの設定
                if (event.data.readonly) {
                    this.editor.contentEditable = 'false';
                    this.editor.style.cursor = 'default';
                    document.body.classList.add('readonly-mode');
                    console.log('[EDITOR] 読み取り専用モードを適用');
                }

                // noScrollbarモードの設定
                if (event.data.noScrollbar) {
                    document.body.style.overflow = 'hidden';
                    this.editor.style.overflow = 'hidden';
                    console.log('[EDITOR] スクロールバー非表示モードを適用');
                }

                // 実身データを読み込む
                const realObject = event.data.realObject;
                if (realObject) {
                    // fileIdを保存（loadFile()内で再設定されるため、ここでは設定不要）
                    console.log('[EDITOR] realObject受信:', event.data.realId);

                    // データを読み込む
                    // realObject.records[0].xtadから取得（app.jsのload-data形式に合わせる）
                    const xmlData = (realObject.records && realObject.records[0] && realObject.records[0].xtad)
                        || realObject.xtad
                        || realObject.xmlData;

                    this.loadFile({
                        realId: event.data.realId,
                        xmlData: xmlData
                    });
                }
            } else if (event.data && event.data.type === 'parent-drop-event') {
                // 親ウィンドウから転送されたドロップイベントを処理
                console.log('[EDITOR] parent-drop-event受信:', event.data);
                
                const dragData = event.data.dragData;
                const clientX = event.data.clientX;
                const clientY = event.data.clientY;
                
                // 仮身一覧からの仮身ドロップの場合
                if (dragData.type === 'virtual-object-drag' && dragData.source === 'virtual-object-list') {
                    const virtualObjects = dragData.virtualObjects || [dragData.virtualObject];
                    console.log('[EDITOR] 親ウィンドウ経由で仮身ドロップ受信:', virtualObjects.length, '個', 'ソース:', dragData.source, 'モード:', dragData.mode);
                    
                    // ドロップ位置にカーソルを設定
                    // clientX/clientYはiframe座標系なので、エディタ内の位置として使用
                    const range = document.caretRangeFromPoint(clientX, clientY);
                    if (range) {
                        const selection = window.getSelection();
                        selection.removeAllRanges();
                        selection.addRange(range);
                        console.log('[EDITOR] カーソル位置を設定:', clientX, clientY);
                    }
                    
                    // 複数の仮身を順番に挿入
                    virtualObjects.forEach((virtualObject, index) => {
                        this.insertVirtualObjectLink(virtualObject);
                        // 仮身の間にスペースを挿入（最後以外）
                        if (index < virtualObjects.length - 1) {
                            document.execCommand('insertText', false, ' ');
                        }
                    });
                    
                    // 編集状態を記録
                    this.isModified = true;
                    
                    // コンテンツ高さを更新
                    this.updateContentHeight();
                    
                    // ドラッグ元のウィンドウに「クロスウィンドウドロップ成功」を通知
                    if (window.parent && window.parent !== window) {
                        window.parent.postMessage({
                            type: 'cross-window-drop-success',
                            mode: dragData.mode,
                            source: dragData.source,
                            sourceWindowId: dragData.sourceWindowId,
                            virtualObjectId: virtualObjects[0].link_id // 最初の仮身のIDを通知
                        }, '*');
                    }
                    
                    console.log('[EDITOR] 親ウィンドウ経由でのドロップ処理完了');
                }
            } else if (event.data && event.data.type === 'check-window-id') {
                // クロスウィンドウドロップ成功通知を受信
                console.log('[EDITOR] check-window-id受信:', event.data);
                
                // このウィンドウIDと一致する場合、ドロップ成功フラグを設定
                if (event.data.targetWindowId && event.data.targetWindowId === this.windowId) {
                    console.log('[EDITOR] このウィンドウのドロップ成功を確認: windowId =', this.windowId);
                    this.virtualObjectDropSuccess = true;
                    
                    // moveモードの場合、元の仮身を削除
                    // dropDataフィールドの有無の両方に対応
                    const mode = event.data.dropData?.mode || event.data.mode;
                    const virtualObjectId = event.data.dropData?.virtualObjectId || event.data.virtualObjectId;
                    
                    if (mode === 'move') {
                        // virtualObjectIdから仮身要素を検索して削除
                        let voToRemove = null;
                        if (this.draggingVirtualObject && this.draggingVirtualObject.parentNode) {
                            // draggingVirtualObjectがまだ有効な場合はそれを使用
                            voToRemove = this.draggingVirtualObject;
                        } else if (virtualObjectId) {
                            // draggingVirtualObjectがnullの場合、virtualObjectIdで検索
                            const virtualObjectElements = this.editor.querySelectorAll('.virtual-object');
                            for (const vo of virtualObjectElements) {
                                if (vo.dataset.linkId === virtualObjectId) {
                                    voToRemove = vo;
                                    break;
                                }
                            }
                        }
                        
                        if (voToRemove && voToRemove.parentNode) {
                            console.log('[EDITOR] 元の仮身を削除（クロスウィンドウ移動完了）:', virtualObjectId);
                            voToRemove.remove();
                            this.isModified = true;
                            this.updateContentHeight();
                        } else {
                            console.log('[EDITOR] 削除する仮身が見つかりませんでした:', virtualObjectId);
                        }
                    }
                }
            }
        });

        // ダイアログコールバック管理
        this.dialogCallbacks = {};

        console.log('[基本文章編集] 準備完了');
    }

    setupEventListeners() {
        // キーボードショートカット
        document.addEventListener('keydown', (e) => {
            this.handleKeyboardShortcuts(e);
        });

        // コンテンツ変更時に高さを更新（入力、削除、貼り付けなど）
        this.editor.addEventListener('input', () => {
            this.updateContentHeight();
            // 編集状態を記録
            this.isModified = true;
        });

        // DOMの変更も監視（delete、backspaceなど）
        this.mutationObserver = new MutationObserver(() => {
            // 一時停止フラグがtrueの場合はスキップ
            if (this.suppressMutationObserver) {
                return;
            }
            this.updateContentHeight();
        });
        this.mutationObserver.observe(this.editor, {
            childList: true,
            subtree: true,
            characterData: true
        });

        // クリックイベントで親ウィンドウのコンテキストメニューを閉じる
        document.addEventListener('click', (e) => {
            // 親ウィンドウにメニューを閉じる要求を送信
            if (window.parent && window.parent !== window) {
                window.parent.postMessage({
                    type: 'close-context-menu'
                }, '*');
            }

            // 画像のクリック処理
            if (e.target.tagName === 'IMG') {
                e.preventDefault();
                e.stopPropagation();
                this.selectImage(e.target);
            } else {
                // 画像以外をクリックした場合は選択解除
                this.deselectImage();
            }
        });

        // コピーイベント: 仮身を含む場合はXML形式でコピー
        this.editor.addEventListener('copy', (e) => {
            this.handleCopy(e);
        });

        // 初期高さを設定
        setTimeout(() => this.updateContentHeight(), 100);

        // ドラッグ&ドロップイベント
        this.setupDragAndDrop();

        // スクロール時にリサイズハンドルの位置を更新
        this.editor.addEventListener('scroll', () => {
            if (this.selectedImage) {
                this.createResizeHandle(this.selectedImage);
            }
        });
    }

    /**
     * ドラッグ&ドロップ機能を設定
     */
    setupDragAndDrop() {
        // ドラッグオーバー
        this.editor.addEventListener('dragover', (e) => {
            e.preventDefault();

            // 画像移動中は 'move'、それ以外は effectAllowed に応じて設定
            if (this.isDraggingImage) {
                e.dataTransfer.dropEffect = 'move';
            } else if (e.dataTransfer.effectAllowed === 'move' || e.dataTransfer.effectAllowed === 'copyMove') {
                e.dataTransfer.dropEffect = 'move';
                this.editor.style.backgroundColor = '#e8f4f8';
            } else {
                e.dataTransfer.dropEffect = 'copy';
                this.editor.style.backgroundColor = '#e8f4f8';
            }
        });

        // ドラッグリーブ
        this.editor.addEventListener('dragleave', (e) => {
            e.preventDefault();
            // 画像移動中は背景色を変更しない
            if (!this.isDraggingImage) {
                this.editor.style.backgroundColor = '';
            }
        });

        // ドロップ
        this.editor.addEventListener('drop', async (e) => {
            e.preventDefault();
            this.editor.style.backgroundColor = '';

            // カーソルインジケータを非表示
            this.hideDropCursor();

            try {
                // 選択中の画像を移動する場合
                if (this.isDraggingImage && this.draggingImage) {
                    console.log('[EDITOR] 画像を移動');
                    await this.moveImageToCursor(e, this.draggingImage);
                    this.isDraggingImage = false;
                    this.draggingImage = null;
                    return;
                }

                // 仮身をドロップして移動する場合
                if (this.isDraggingVirtualObject && this.draggingVirtualObjectData) {
                    console.log('[EDITOR] 仮身を移動');

                    // ドロップ位置にカーソルを設定
                    this.setCursorAtDropPosition(e);

                    // 元の仮身要素をそのまま移動（表示属性を保持）
                    const selection = window.getSelection();
                    if (selection.rangeCount > 0 && this.draggingVirtualObject && this.draggingVirtualObject.parentNode) {
                        const range = selection.getRangeAt(0);
                        range.deleteContents();
                        range.insertNode(this.draggingVirtualObject);

                        // 仮身の後にスペースを追加（カーソル移動のため）
                        const space = document.createTextNode(' ');
                        this.draggingVirtualObject.parentNode.insertBefore(space, this.draggingVirtualObject.nextSibling);

                        // カーソルを仮身の後に移動
                        const newRange = document.createRange();
                        newRange.setStartAfter(space);
                        newRange.collapse(true);
                        selection.removeAllRanges();
                        selection.addRange(newRange);

                        console.log('[EDITOR] 仮身移動完了（表示属性保持）');
                    }

                    // ドロップ成功フラグを設定（dragendで元の仮身を削除しないように）
                    // 注: 元の仮身要素を移動しているため、dragendで削除する必要はない
                    this.virtualObjectDropSuccess = true;
                    
                    // ドラッグフラグをクリア（dragendでの削除を防ぐ）
                    this.isDraggingVirtualObject = false;
                    this.draggingVirtualObject = null;
                    this.draggingVirtualObjectData = null;

                    // 編集状態を記録
                    this.isModified = true;
                    this.updateContentHeight();

                    return;
                }

                // 画像ファイルのドロップをチェック
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    const file = e.dataTransfer.files[0];
                    if (file.type.startsWith('image/')) {
                        console.log('[EDITOR] 画像ファイルドロップ:', file.name);
                        await this.insertImageFile(file);
                        return;
                    }
                }

                const data = e.dataTransfer.getData('text/plain');
                if (data) {
                    // JSON形式かどうかチェック
                    try {
                        const dragData = JSON.parse(data);

                        if (dragData.type === 'base-file-copy' && dragData.source === 'base-file-manager') {
                            // 原紙管理からのコピー - 親ウィンドウに処理を委譲
                            // 親ウィンドウが新規実身を生成し、仮身として挿入
                            console.log('[EDITOR] 原紙箱からのドロップを親ウィンドウに委譲');

                            // ドロップ位置にカーソルを設定
                            this.setCursorAtDropPosition(e);

                            // 親ウィンドウにメッセージを送信
                            if (window.parent && window.parent !== window) {
                                window.parent.postMessage({
                                    type: 'base-file-drop-request',
                                    dragData: dragData,
                                    clientX: e.clientX,
                                    clientY: e.clientY
                                }, '*');
                            }
                            return; // 処理を親ウィンドウに任せる
                        } else if (dragData.type === 'archive-file-extract' && dragData.source === 'unpack-file') {
                            // 書庫管理からのファイル展開
                            this.extractArchiveFile(dragData.file, dragData.fileIdMap);
                            return; // 処理完了
                        } else if (dragData.type === 'virtual-object-drag' && dragData.source === 'virtual-object-list') {
                            // 仮身一覧からの仮身ドロップ
                            const virtualObjects = dragData.virtualObjects || [dragData.virtualObject];
                            console.log('[EDITOR] 仮身ドロップ受信:', virtualObjects.length, '個', 'ソース:', dragData.source, 'モード:', dragData.mode);

                            // ドロップ位置にカーソルを設定
                            this.setCursorAtDropPosition(e);

                            // 複数の仮身を順番に挿入
                            virtualObjects.forEach((virtualObject, index) => {
                                this.insertVirtualObjectLink(virtualObject);
                                // 仮身の間にスペースを挿入（最後以外）
                                if (index < virtualObjects.length - 1) {
                                    document.execCommand('insertText', false, ' ');
                                }
                            });

                            // 編集状態を記録
                            this.isModified = true;

                            // コンテンツ高さを更新
                            this.updateContentHeight();

                            // ドラッグ元のウィンドウに「クロスウィンドウドロップ成功」を通知
                            if (window.parent && window.parent !== window) {
                                window.parent.postMessage({
                                    type: 'cross-window-drop-success',
                                    mode: dragData.mode,
                                    source: dragData.source,
                                    sourceWindowId: dragData.sourceWindowId,
                                    virtualObjectId: virtualObjects[0].link_id // 最初の仮身のIDを通知
                                }, '*');
                            }
                            return; // 処理完了
                        }
                    } catch (_jsonError) {
                        // JSON形式でない場合は通常のテキストとして扱う
                        console.log('[EDITOR] 通常のテキストドロップ');
                    }

                    // 通常のテキストドロップの場合は、デフォルト動作を許可
                    // （ブラウザのデフォルトテキスト挿入が動作する）
                }
            } catch (error) {
                console.error('[EDITOR] ドロップ処理エラー:', error);
            }
        });
    }

    /**
     * コピーイベントハンドラ: 仮身を含む場合はXML形式でコピー
     */
    handleCopy(e) {
        try {
            const selection = window.getSelection();
            if (!selection.rangeCount) {
                return; // 選択範囲がない場合はデフォルト動作
            }

            const range = selection.getRangeAt(0);
            const container = range.cloneContents();

            // 選択範囲に仮身が含まれているか確認
            const hasVirtualObject = container.querySelector('.virtual-object') !== null;

            if (!hasVirtualObject) {
                // 仮身が含まれていない場合はデフォルト動作
                return;
            }

            // デフォルト動作を防止
            e.preventDefault();

            // 一時的なコンテナを作成してHTMLからXMLに変換
            const tempDiv = document.createElement('div');
            tempDiv.appendChild(container);

            // XMLに変換
            const xmlContent = this.extractTADXMLFromElement(tempDiv);

            // プレーンテキスト版も作成（仮身は名前のみ）
            const plainText = tempDiv.textContent;

            console.log('[EDITOR] コピー内容（XML）:', xmlContent);
            console.log('[EDITOR] コピー内容（プレーンテキスト）:', plainText);

            // クリップボードに両方の形式でコピー
            e.clipboardData.setData('text/plain', plainText);
            e.clipboardData.setData('text/html', xmlContent);
            e.clipboardData.setData('application/x-tad-xml', xmlContent);

            this.setStatus('クリップボードへコピーしました（仮身を含む）');
        } catch (error) {
            console.error('[EDITOR] コピーエラー:', error);
            // エラー時はデフォルト動作を許可
        }
    }

    /**
     * 原紙ファイルの内容を挿入
     */
    async insertBaseFileContent(baseFile) {
        console.log('[EDITOR] 原紙ファイル挿入:', baseFile.displayName);

        // XMLデータをHTMLに変換して挿入
        if (baseFile.xmlData) {
            const htmlContent = await this.renderTADXML(baseFile.xmlData);

            // カーソル位置に挿入
            const selection = window.getSelection();
            if (selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                range.deleteContents();

                const fragment = document.createRange().createContextualFragment(htmlContent);
                range.insertNode(fragment);
            } else {
                // カーソル位置がない場合は末尾に追加
                this.editor.innerHTML += htmlContent;
            }

            this.updateContentHeight();
            console.log('[EDITOR] 原紙ファイル挿入完了');
        }
    }

    /**
     * 仮身リンクを挿入
     * @param {Object} virtualObject - 仮身オブジェクト
     */
    insertVirtualObjectLink(virtualObject) {
        console.log('[EDITOR] 仮身リンク挿入:', virtualObject.link_name);

        // VirtualObjectRendererを使って仮身要素を作成
        let vobjElement;
        if (this.virtualObjectRenderer) {
            // アイコンパス直接指定（プラグインフォルダ内のアイコンファイル）
            const options = {
                loadIconCallback: (realId) => this.loadIconFromParent(realId)
            };
            vobjElement = this.virtualObjectRenderer.createInlineElement(virtualObject, options);
        } else {
            // フォールバック: VirtualObjectRendererが利用できない場合
            console.warn('[EDITOR] VirtualObjectRenderer not available, using fallback');
            vobjElement = document.createElement('span');
            vobjElement.className = 'virtual-object';
            vobjElement.contentEditable = 'false';
            vobjElement.setAttribute('unselectable', 'on');
            vobjElement.textContent = virtualObject.link_name;

            // 最小限のスタイルを設定
            const frcol = virtualObject.frcol || '#000000';
            const tbcol = virtualObject.tbcol || '#ffffff';
            vobjElement.style.display = 'inline-block';
            vobjElement.style.padding = '4px 8px';
            vobjElement.style.margin = '0 2px';
            vobjElement.style.background = tbcol;
            vobjElement.style.border = `1px solid ${frcol}`;
            vobjElement.style.cursor = 'pointer';
        }

        // クリックイベントは setupVirtualObjectEventHandlers で設定されます

        // 右クリックメニュー用にコンテキストを保存
        vobjElement.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();

            // 実身IDを抽出
            let realId = virtualObject.link_id.replace(/\.(xtad|json)$/, '');
            realId = realId.replace(/_\d+$/, '');

            this.contextMenuVirtualObject = {
                virtualObj: virtualObject,
                element: vobjElement,
                realId: realId
            };

            // 親ウィンドウにコンテキストメニューを要求
            if (window.parent && window.parent !== window) {
                const rect = window.frameElement.getBoundingClientRect();
                window.parent.postMessage({
                    type: 'context-menu-request',
                    x: rect.left + e.clientX,
                    y: rect.top + e.clientY
                }, '*');
            }
        });

        // カーソル位置に挿入
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            range.deleteContents();
            range.insertNode(vobjElement);

            // カーソルを仮身の後ろに移動
            range.setStartAfter(vobjElement);
            range.setEndAfter(vobjElement);
            selection.removeAllRanges();
            selection.addRange(range);
        } else {
            // カーソル位置がない場合は末尾に追加
            this.editor.appendChild(vobjElement);
        }

        this.updateContentHeight();
        console.log('[EDITOR] 仮身リンク挿入完了');

        // 仮身のイベントハンドラをセットアップ（選択、移動、リサイズを可能にする）
        this.setupVirtualObjectEventHandlers();
    }

    /**
     * 原紙箱から仮身を追加
     * @param {string} realId - 実身ID
     * @param {string} name - 実身名
     * @param {Object} applist - アプリケーションリスト
     */
    addVirtualObjectFromRealId(realId, name, applist) {
        console.log('[EDITOR] 原紙箱から仮身を追加:', name, 'realId:', realId);

        // 仮身オブジェクトを作成（デフォルト値で）
        const virtualObj = {
            link_id: `${realId}_0.xtad`,
            link_name: name,
            width: 150,
            heightPx: 30,
            chsz: 14,
            frcol: '#000000',
            chcol: '#000000',
            tbcol: '#ffffff',
            bgcol: '#ffffff',
            dlen: 0,
            applist: applist || {},
            // 表示属性のデフォルト値
            framedisp: 'true',
            namedisp: 'true',
            pictdisp: 'true',
            roledisp: 'false',
            typedisp: 'false',
            updatedisp: 'false'
        };

        // カーソル位置に仮身を挿入
        this.insertVirtualObjectLink(virtualObj);

        // 変更フラグを設定
        this.isModified = true;

        console.log('[EDITOR] 原紙箱から仮身追加完了');
    }

    /**
     * 画像ファイルを挿入
     * @param {File} file - 画像ファイル
     */
    async insertImageFile(file) {
        console.log('[EDITOR] 画像ファイル挿入:', file.name);

        try {
            // 画像をロード
            const img = new Image();
            const reader = new FileReader();

            const imageData = await new Promise((resolve, reject) => {
                reader.onload = (e) => {
                    img.onload = () => {
                        console.log('[EDITOR] 画像ロード完了:', img.width, 'x', img.height);

                        // 画像が大きすぎる場合は縮小（最大600px）
                        const maxSize = 600;
                        let displayWidth = img.width;
                        let displayHeight = img.height;

                        if (displayWidth > maxSize || displayHeight > maxSize) {
                            const scale = Math.min(maxSize / displayWidth, maxSize / displayHeight);
                            displayWidth = Math.floor(displayWidth * scale);
                            displayHeight = Math.floor(displayHeight * scale);
                        }

                        resolve({
                            dataUrl: e.target.result,
                            displayWidth: displayWidth,
                            displayHeight: displayHeight,
                            originalWidth: img.width,
                            originalHeight: img.height
                        });
                    };

                    img.onerror = () => {
                        reject(new Error('画像読み込みエラー'));
                    };

                    img.src = e.target.result;
                };

                reader.onerror = () => {
                    reject(new Error('ファイル読み込みエラー'));
                };

                reader.readAsDataURL(file);
            });

            // 画像番号を取得
            const imgNo = this.getNextImageNumber();

            // ファイル名を生成: realId_recordNo_imgNo.png
            // this.realIdから _数字.xtad を完全に除去
            let realId = this.realId || 'unknown';
            realId = realId.replace(/_\d+\.xtad$/i, '');  // 念のため再度除去
            const recordNo = 0;  // 常に0（実身の最初のレコード）
            const extension = file.name.split('.').pop().toLowerCase();
            const savedFileName = `${realId}_${recordNo}_${imgNo}.${extension}`;

            console.log('[EDITOR] 画像ファイル名生成:', {
                thisRealId: this.realId,
                cleanedRealId: realId,
                imgNo: imgNo,
                savedFileName: savedFileName
            });

            // 画像ファイルを保存
            await this.saveImageFile(file, savedFileName);

            // 画像の色深度情報を設定（PNGの場合の標準値）
            const planes = 3;      // RGB 3プレーン
            const pixbits = 0x0818; // 24ビット色（下位8bit=24, 上位8bit=24）

            // 画像要素を作成
            const imgElement = document.createElement('img');
            imgElement.src = imageData.dataUrl;
            imgElement.style.maxWidth = '100%';
            imgElement.style.height = 'auto';
            imgElement.style.display = 'inline-block';
            imgElement.style.verticalAlign = 'middle';
            imgElement.style.margin = '4px';
            imgElement.setAttribute('data-original-filename', file.name);
            imgElement.setAttribute('data-saved-filename', savedFileName);
            imgElement.setAttribute('data-mime-type', file.type);
            imgElement.setAttribute('data-original-width', imageData.originalWidth);
            imgElement.setAttribute('data-original-height', imageData.originalHeight);
            imgElement.setAttribute('data-display-width', imageData.displayWidth);
            imgElement.setAttribute('data-display-height', imageData.displayHeight);
            imgElement.setAttribute('data-img-no', imgNo);
            imgElement.setAttribute('data-planes', planes);
            imgElement.setAttribute('data-pixbits', pixbits);

            // カーソル位置に挿入
            const selection = window.getSelection();
            if (selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                range.deleteContents();
                range.insertNode(imgElement);

                // カーソルを画像の後ろに移動
                range.setStartAfter(imgElement);
                range.setEndAfter(imgElement);
                selection.removeAllRanges();
                selection.addRange(range);
            } else {
                // カーソル位置がない場合は末尾に追加
                this.editor.appendChild(imgElement);
            }

            this.updateContentHeight();
            this.setStatus(`画像「${file.name}」を挿入しました`);
            console.log('[EDITOR] 画像ファイル挿入完了');

        } catch (error) {
            console.error('[EDITOR] 画像挿入エラー:', error);
            this.setStatus('画像の挿入に失敗しました');
        }
    }

    /**
     * 選択中の仮身をdefaultOpenアプリで開く
     */
    async openSelectedVirtualObject() {
        if (!this.selectedVirtualObject) {
            console.warn('[EDITOR] 選択中の仮身がありません');
            return;
        }

        const vo = this.selectedVirtualObject;
        const linkId = vo.dataset.linkId;
        const linkName = vo.dataset.linkName;
        console.log('[EDITOR] 選択中の仮身を開く:', linkName, linkId);

        // 実身IDを抽出（拡張子とレコード番号を削除）
        let realId = linkId.replace(/\.(xtad|json)$/, '');
        realId = realId.replace(/_\d+$/, '');

        // realId.jsonを読み込んでdefaultOpenを取得
        try {
            const appListData = await this.getAppListData(realId);
            if (!appListData) {
                this.setStatus('appListの取得に失敗しました');
                return;
            }

            const defaultOpen = this.getDefaultOpenFromAppList(appListData);
            if (defaultOpen) {
                const virtualObj = this.buildVirtualObjFromDataset(vo.dataset);

                window.parent.postMessage({
                    type: 'open-virtual-object-real',
                    virtualObj: virtualObj,
                    pluginId: defaultOpen
                }, '*');
            } else {
                this.setStatus('defaultOpenが設定されていません');
            }
        } catch (error) {
            console.error('[EDITOR] defaultOpen取得エラー:', error);
            this.setStatus('defaultOpenの取得に失敗しました');
        }
    }

    /**
     * 仮身を開く
     * @param {Object} virtualObject - 仮身オブジェクト
     */
    openVirtualObject(virtualObject) {
        console.log('[EDITOR] 仮身を開く:', virtualObject.link_name, virtualObject.link_id);

        // applistからデフォルトプラグインを取得
        let defaultPluginId = null;
        if (virtualObject.applist) {
            for (const [pluginId, plugin] of Object.entries(virtualObject.applist)) {
                if (plugin.defaultOpen) {
                    defaultPluginId = pluginId;
                    break;
                }
            }
        }

        console.log('[EDITOR] デフォルトプラグイン:', defaultPluginId);

        // 親ウィンドウにメッセージを送信して仮身リンク先を開く
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: 'open-virtual-object-real',
                virtualObj: virtualObject,
                pluginId: defaultPluginId
            }, '*');
        }
    }

    /**
     * 書庫ファイルを展開して.xtadファイルとして生成
     */
    async extractArchiveFile(file, fileIdMap) {
        console.log('[EDITOR] 書庫ファイル展開:', file.name);

        try {
            // fileオブジェクトから直接XMLデータを取得
            const xmlData = file.xmlData;

            if (xmlData) {
                // ファイル名を生成: UUID_recordIndex.xtad
                const filename = `${file.fileId}_${file.recordIndex}.xtad`;

                // .xtadファイルとしてダウンロード
                this.downloadAsXtad(xmlData, filename);

                console.log(`[EDITOR] ファイル生成: ${filename}`);
            } else {
                console.error('[EDITOR] XMLデータの取得に失敗 - fileオブジェクトにxmlDataが含まれていません');
                console.log('[EDITOR] fileオブジェクト:', file);
            }

        } catch (error) {
            console.error('[EDITOR] 書庫ファイル展開エラー:', error);
        }
    }

    /**
     * XMLデータを.xtadファイルとしてダウンロード
     */
    downloadAsXtad(xmlData, filename) {
        const blob = new Blob([xmlData], { type: 'application/xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    /**
     * ドロップ位置にカーソルを設定
     */
    setCursorAtDropPosition(dropEvent) {
        // ドロップ位置の座標を取得
        const x = dropEvent.clientX;
        const y = dropEvent.clientY;

        console.log('[EDITOR] ドロップ位置:', x, y);

        // ドロップ位置にカーソルを設定
        let range;
        if (document.caretRangeFromPoint) {
            // Chrome, Safari
            range = document.caretRangeFromPoint(x, y);
        } else if (document.caretPositionFromPoint) {
            // Firefox
            const position = document.caretPositionFromPoint(x, y);
            if (position) {
                range = document.createRange();
                range.setStart(position.offsetNode, position.offset);
                range.setEnd(position.offsetNode, position.offset);
            }
        }

        if (range) {
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            console.log('[EDITOR] カーソル位置を設定しました');
        } else {
            console.warn('[EDITOR] カーソル位置を設定できませんでした');
        }
    }

    /**
     * スクロールバー更新
     */
    updateContentHeight() {
        // .plugin-contentのサイズを取得（より正確）
        const pluginContent = document.querySelector('.plugin-content');
        if (!pluginContent) {
            return;
        }

        const contentHeight = pluginContent.scrollHeight;
        const contentWidth = pluginContent.scrollWidth;

        // 親ウィンドウに高さと幅の変更を通知
        if (window.parent && window.parent !== window) {
            const message = {
                type: 'content-size-changed',
                height: contentHeight
            };

            // 折り返しOFFの時のみ幅も送信
            if (!this.wrapMode) {
                message.width = contentWidth;
            }

            window.parent.postMessage(message, '*');

            // スクロールバー更新要求を送信
            window.parent.postMessage({
                type: 'update-scrollbars'
            }, '*');
        }
    }

    handleKeyboardShortcuts(e) {
        // Enter: 改段落（通常の改行）- カーソル直前の文字サイズで行間を設定
        if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
            e.preventDefault();

            // MutationObserverを一時停止
            this.suppressMutationObserver = true;

            const selection = window.getSelection();
            if (selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);

                // デバッグ: DOM構造を確認
                console.log('[EDITOR] Enter押下時のDOM:', this.editor.innerHTML);
                console.log('[EDITOR] startContainer:', range.startContainer);
                console.log('[EDITOR] startContainer.nodeName:', range.startContainer.nodeName);
                console.log('[EDITOR] startContainer.nodeType:', range.startContainer.nodeType);
                console.log('[EDITOR] startOffset:', range.startOffset);

                // カーソル直前の文字サイズを取得
                let fontSize = '14pt'; // デフォルト

                // カーソル位置の要素を取得
                let container = range.startContainer;
                if (container.nodeType === Node.TEXT_NODE) {
                    container = container.parentElement;
                }

                // 親要素を辿って最も近い font-size を探す
                let element = container;
                while (element && element !== this.editor) {
                    const style = window.getComputedStyle(element);
                    if (style.fontSize) {
                        fontSize = style.fontSize;
                        break;
                    }
                    element = element.parentElement;
                }

                // 現在の段落要素を取得
                let currentP = range.startContainer;
                while (currentP && currentP.nodeName !== 'P' && currentP !== this.editor) {
                    currentP = currentP.parentElement;
                }

                console.log('[EDITOR] currentP:', currentP);
                console.log('[EDITOR] currentP.nodeName:', currentP ? currentP.nodeName : 'null');

                if (currentP && currentP.nodeName === 'P') {
                    console.log('[EDITOR] 段落要素が見つかりました');

                    // 現在の段落が空（<br>のみ）かチェック
                    const isEmpty = currentP.childNodes.length === 1 &&
                                   currentP.firstChild.nodeName === 'BR';

                    console.log('[EDITOR] isEmpty:', isEmpty);
                    console.log('[EDITOR] currentP.childNodes.length:', currentP.childNodes.length);
                    console.log('[EDITOR] currentP.innerHTML:', currentP.innerHTML);

                    // 新しい段落を作成
                    const newP = document.createElement('p');
                    newP.innerHTML = '<br>';

                    if (!isEmpty) {
                        console.log('[EDITOR] 段落を分割します');

                        // 空でない場合は、カーソル位置で段落を分割
                        const afterRange = range.cloneRange();
                        afterRange.setEndAfter(currentP.lastChild || currentP);
                        const afterContent = afterRange.extractContents();

                        console.log('[EDITOR] afterContent.textContent:', afterContent.textContent);
                        console.log('[EDITOR] afterContent.childNodes.length:', afterContent.childNodes.length);

                        // 分割後の内容を新しい段落に追加
                        if (afterContent.textContent.trim() === '') {
                            // テキストが空の場合は<br>を保持（既に設定済み）
                            console.log('[EDITOR] afterContentが空なので<br>を保持');
                        } else {
                            // 実際の内容がある場合は追加
                            console.log('[EDITOR] afterContentに内容があるので追加');
                            newP.innerHTML = ''; // 既存の<br>をクリア
                            newP.appendChild(afterContent);
                        }
                    }
                    // isEmpty の場合は、新しい段落は既に<br>を含んでいる
                    // また、元の段落が空になった場合も<br>を追加
                    if (!isEmpty && currentP.childNodes.length === 0) {
                        currentP.innerHTML = '<br>';
                    }

                    // カーソル直前の文字サイズに基づいてline-heightを設定（px単位で固定）
                    const fontSizeValue = parseFloat(fontSize);
                    const lineHeight = fontSizeValue * 1.5; // 1.5倍の行間に調整
                    newP.style.lineHeight = `${lineHeight}px`;

                    // 現在の段落の後に新しい段落を挿入（最下段対応）
                    if (currentP.nextSibling) {
                        currentP.parentNode.insertBefore(newP, currentP.nextSibling);
                    } else {
                        currentP.parentNode.appendChild(newP);
                    }

                    // カーソルを新しい段落の先頭に移動
                    const newRange = document.createRange();
                    // <br>がある場合は、その前にカーソルを配置
                    if (newP.firstChild) {
                        newRange.setStartBefore(newP.firstChild);
                    } else {
                        newRange.setStart(newP, 0);
                    }
                    newRange.collapse(true);
                    selection.removeAllRanges();
                    selection.addRange(newRange);

                    // 新しい段落をスクロール表示（カーソル位置をウィンドウ最下部に配置）
                    newP.scrollIntoView({ block: 'nearest' });
                } else {
                    console.log('[EDITOR] 段落要素が見つからなかったため、デフォルト処理を実行');

                    // 段落要素が見つからない場合はデフォルト処理
                    const p = document.createElement('p');
                    p.innerHTML = '<br>';

                    const fontSizeValue = parseFloat(fontSize);
                    const lineHeight = fontSizeValue * 1.5;
                    p.style.lineHeight = `${lineHeight}px`;

                    range.deleteContents();
                    range.insertNode(p);
                    const newRange = document.createRange();
                    // <br>がある場合は、その前にカーソルを配置
                    if (p.firstChild) {
                        newRange.setStartBefore(p.firstChild);
                        newRange.setEndBefore(p.firstChild);
                    } else {
                        newRange.setStart(p, 0);
                        newRange.setEnd(p, 0);
                    }
                    selection.removeAllRanges();
                    selection.addRange(newRange);

                    // 新しい段落をスクロール表示（カーソル位置をウィンドウ最下部に配置）
                    p.scrollIntoView({ block: 'nearest' });
                }
            }

            // DOM操作完了後、MutationObserverを再開し、スクロールバー更新を1回だけ実行
            setTimeout(() => {
                this.suppressMutationObserver = false;
                this.updateContentHeight();
            }, 0);

            return;
        }

        // Shift+Enter または Ctrl+Enter: 改行（<br>）を挿入
        if ((e.shiftKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            // <br>タグを挿入
            const selection = window.getSelection();
            if (selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                const br = document.createElement('br');
                range.deleteContents();
                range.insertNode(br);

                // カーソルを<br>の後ろに移動
                range.setStartAfter(br);
                range.setEndAfter(br);
                selection.removeAllRanges();
                selection.addRange(range);

                // 改行位置をスクロール表示（カーソル位置をウィンドウ最下部に配置）
                br.scrollIntoView({ behavior: 'smooth', block: 'end' });
            }
            return;
        }

        // Ctrl+C: コピー
        if (e.ctrlKey && e.key === 'c') {
            e.preventDefault();
            this.executeMenuAction('copy');
            return;
        }

        // Ctrl+X: カット（移動）
        if (e.ctrlKey && e.key === 'x') {
            e.preventDefault();
            this.executeMenuAction('cut');
            return;
        }

        // Ctrl+V: ペースト
        if (e.ctrlKey && e.key === 'v') {
            e.preventDefault();
            this.executeMenuAction('paste');
            return;
        }

        // Ctrl+S: 保存
        if (e.ctrlKey && e.key === 's') {
            e.preventDefault();
            this.executeMenuAction('save');
            return;
        }

        // Ctrl+E: ウィンドウを閉じる
        if (e.ctrlKey && e.key === 'e') {
            e.preventDefault();
            this.executeMenuAction('close');
            return;
        }

        // Ctrl+O: 選択中の仮身をdefaultOpenアプリで開く
        if (e.ctrlKey && e.key === 'o') {
            e.preventDefault();
            this.openSelectedVirtualObject();
            return;
        }

        // Ctrl+L: 全画面表示オンオフ
        if (e.ctrlKey && e.key === 'l') {
            e.preventDefault();
            this.toggleFullscreen();
            return;
        }

        // Ctrl+B: 太字
        if (e.ctrlKey && e.key === 'b') {
            e.preventDefault();
            document.execCommand('bold');
        }

        // Ctrl+I: 斜体
        if (e.ctrlKey && e.key === 'i') {
            e.preventDefault();
            document.execCommand('italic');
        }

        // Ctrl+U: 下線
        if (e.ctrlKey && e.key === 'u') {
            e.preventDefault();
            document.execCommand('underline');
        }
    }

    /**
     * TADファイルを読み込み
     */
    async loadFile(fileData) {
        try {
            console.log('[EDITOR] loadFile呼び出し, fileData:', fileData);
            this.setStatus('ファイル読み込み中...');
            this.currentFile = fileData;
            // _数字.xtad の形式を除去して実身IDのみを取得
            let rawId = fileData ? fileData.realId : null;
            this.realId = rawId ? rawId.replace(/_\d+\.xtad$/i, '') : null;

            console.log('[EDITOR] fileDataチェック:', {
                hasXmlData: !!fileData.xmlData,
                hasRawData: !!fileData.rawData,
                fileName: fileData.fileName
            });

            // XMLデータが既に渡されている場合
            if (fileData.xmlData) {
                console.log('[EDITOR] XMLデータを使用, 長さ:', fileData.xmlData.length);
                console.log('[EDITOR] XMLプレビュー:', fileData.xmlData.substring(0, 200));

                this.tadData = fileData.xmlData;

                // XMLを解釈してリッチテキストとして表示
                await this.renderTADXML(fileData.xmlData);

                this.setStatus(`読み込み完了: ${fileData.fileName} (${fileData.xmlData.length}文字)`);

                // DOM更新後にスクロールバーを更新
                setTimeout(() => this.updateContentHeight(), 0);
            }
            // rawDataがある場合は変換を試みる
            else if (fileData.rawData) {
                console.log('rawDataからXMLに変換中...');
                const xmlData = await this.parseTADToXML(fileData.rawData);
                if (xmlData) {
                    this.tadData = xmlData;
                    await this.renderTADXML(xmlData);
                    this.setStatus(`読み込み完了: ${fileData.fileName}`);

                    // DOM更新後にスクロールバーを更新
                    setTimeout(() => this.updateContentHeight(), 0);
                } else {
                    this.editor.innerHTML = '<p>TADファイルの解析に失敗しました</p>';
                    this.setStatus('XMLの生成に失敗しました');
                }
            }
            else {
                // フォールバック: プレーンテキストとして表示
                this.editor.innerHTML = '<p>TADファイルの内容を表示できません</p>';
                this.setStatus('エラー: データ形式が不正です');
            }

        } catch (error) {
            console.error('ファイル読み込みエラー:', error);
            console.error('エラースタック:', error.stack);
            this.editor.innerHTML = '<p>ファイル読み込みエラー</p><pre>' + this.escapeHtml(error.message + '\n' + error.stack) + '</pre>';
            this.setStatus('ファイルの読み込みに失敗しました');
        }
    }

    /**
     * 仮身展開用: 実身データを読み込んで表示
     */
    async loadVirtualObjectData(virtualObj, realObject) {
        try {
            console.log('[EDITOR] loadVirtualObjectData呼び出し:', { virtualObj, realObject });
            this.setStatus('実身データ読み込み中...');

            // realObjectからXTADデータを取得
            if (!realObject || !realObject.records || realObject.records.length === 0) {
                console.error('[EDITOR] レコードが存在しません:', realObject);
                this.editor.innerHTML = '<p>実身データが見つかりません</p>';
                this.setStatus('エラー: 実身データがありません');
                return;
            }

            const firstRecord = realObject.records[0];
            if (!firstRecord || !firstRecord.xtad) {
                console.error('[EDITOR] XTADデータが存在しません:', firstRecord);
                this.editor.innerHTML = '<p>データが見つかりません</p>';
                this.setStatus('エラー: XTADデータがありません');
                return;
            }

            // realIdを設定（保存用）
            // _数字.xtad の形式を除去して実身IDのみを取得
            let rawRealId = realObject.metadata.realId;
            this.realId = rawRealId ? rawRealId.replace(/_\d+\.xtad$/i, '') : null;
            this.currentFile = {
                realId: this.realId,
                fileName: realObject.metadata.realName || '無題'
            };

            // XTADデータ（XML形式）をそのまま使用
            console.log('[EDITOR] XTAD読み込み成功, 長さ:', firstRecord.xtad.length);
            const xmlData = firstRecord.xtad;
            if (xmlData) {
                console.log('[EDITOR] XML変換成功, 長さ:', xmlData.length);
                this.tadData = xmlData;
                await this.renderTADXML(xmlData);
                this.setStatus(`実身読み込み完了: ${this.currentFile.fileName}`);

                // DOM更新後にスクロールバーを更新
                setTimeout(() => this.updateContentHeight(), 0);
            } else {
                console.error('[EDITOR] XML変換失敗');
                this.editor.innerHTML = '<p>XTADデータの解析に失敗しました</p>';
                this.setStatus('エラー: XMLの生成に失敗しました');
            }
        } catch (error) {
            console.error('[EDITOR] 仮身データ読み込みエラー:', error);
            console.error('[EDITOR] エラースタック:', error.stack);
            this.editor.innerHTML = '<p>実身データ読み込みエラー</p><pre>' + this.escapeHtml(error.message + '\n' + error.stack) + '</pre>';
            this.setStatus('実身データの読み込みに失敗しました');
        }
    }

    /**
     * TADファイルをXMLに変換
     */
    async parseTADToXML(rawData) {
        // 親ウィンドウのparseTADToXML関数を使用
        if (window.parent && typeof window.parent.parseTADToXML === 'function') {
            try {
                const uint8Array = rawData instanceof Uint8Array ? rawData : new Uint8Array(rawData);
                const xmlResult = await window.parent.parseTADToXML(uint8Array, 0);
                console.log('XML変換完了:', xmlResult ? xmlResult.substring(0, 100) : 'null');
                return xmlResult;
            } catch (error) {
                console.error('TAD→XML変換エラー:', error);
                return null;
            }
        }
        console.warn('parseTADToXML関数が見つかりません');
        return null;
    }

    /**
     * <link>タグを仮身（Virtual Object）HTMLに変換
     */
    async convertLinkTagsToVirtualObjects(content) {
        // <link ...>...</link> タグを検出して仮身に変換（すべての属性を保持）
        const linkRegex = /<link\s+([^>]*)>(.*?)<\/link>/gi;

        // まず、すべてのlinkタグからrealIdを抽出してアイコンをキャッシュに入れる
        const linkMatches = [];
        let match;
        while ((match = linkRegex.exec(content)) !== null) {
            linkMatches.push({
                fullMatch: match[0],
                attributes: match[1],
                innerContent: match[2]
            });
        }

        // すべてのrealIdに対してアイコンを事前にロード
        const iconLoadPromises = [];
        for (const linkMatch of linkMatches) {
            const attrMap = {};
            const attrRegex = /(\w+)="([^"]*)"/g;
            let attrMatch;

            while ((attrMatch = attrRegex.exec(linkMatch.attributes)) !== null) {
                attrMap[attrMatch[1]] = attrMatch[2];
            }

            if (attrMap.id) {
                // フルIDから実身IDのみを抽出（_0.xtadなどを削除）
                const realId = attrMap.id.replace(/_\d+\.xtad$/i, '');
                console.log('[EDITOR] アイコンを事前ロード:', attrMap.id, '実身ID:', realId);
                iconLoadPromises.push(this.loadIconFromParent(realId));
            }
        }

        // すべてのアイコンをロード（並列実行）
        await Promise.all(iconLoadPromises);
        console.log('[EDITOR] すべてのアイコンのロード完了');

        // キャッシュからアイコンデータを取得してiconDataオブジェクトを作成
        const iconData = {};
        for (const linkMatch of linkMatches) {
            const attrMap = {};
            const attrRegex = /(\w+)="([^"]*)"/g;
            let attrMatch;

            while ((attrMatch = attrRegex.exec(linkMatch.attributes)) !== null) {
                attrMap[attrMatch[1]] = attrMatch[2];
            }

            if (attrMap.id) {
                // フルIDから実身IDのみを抽出（_0.xtadなどを削除）
                const realId = attrMap.id.replace(/_\d+\.xtad$/i, '');
                if (this.iconCache.has(realId)) {
                    const cachedData = this.iconCache.get(realId);
                    if (cachedData) {
                        // iconDataは実身IDをキーにする
                        iconData[realId] = cachedData;
                        console.log('[EDITOR] キャッシュからアイコンデータ取得:', attrMap.id, '実身ID:', realId, 'データ長:', cachedData.length);
                    }
                }
            }
        }

        // アイコンがキャッシュに入ったので、正規表現でHTML変換
        linkRegex.lastIndex = 0; // 正規表現のインデックスをリセット
        return content.replace(linkRegex, (match, attributes, innerContent) => {
            // 属性を解析
            const attrMap = {};
            const attrRegex = /(\w+)="([^"]*)"/g;
            let attrMatch;

            while ((attrMatch = attrRegex.exec(attributes)) !== null) {
                attrMap[attrMatch[1]] = attrMatch[2];
            }

            // data属性として保存（すべての属性を保持）
            let dataAttrs = '';
            for (const [key, value] of Object.entries(attrMap)) {
                const escapedKey = this.escapeHtml(key);
                const escapedValue = this.escapeHtml(value);
                dataAttrs += ` data-link-${escapedKey}="${escapedValue}"`;
            }

            // innerContentも保存（XMLエクスポート時に必要）
            const escapedInnerContent = this.escapeHtml(innerContent.trim());
            dataAttrs += ` data-link-innercontent="${escapedInnerContent}"`;

            // 表示名は<link></link>で囲まれたテキスト（innerContent）を使用
            // innerContentが空の場合はname属性、それもなければidを使用
            const displayName = innerContent.trim() || attrMap.name || attrMap.id || '無題';

            // VirtualObjectRendererを使って仮身要素を作成
            if (this.virtualObjectRenderer) {
                // VirtualObjectオブジェクトを構築
                const virtualObject = {
                    link_id: attrMap.id,
                    link_name: displayName,
                    width: attrMap.width ? parseInt(attrMap.width) : 150,
                    heightPx: attrMap.heightpx ? parseInt(attrMap.heightpx) : 30,
                    frcol: attrMap.frcol || '#000000',
                    chcol: attrMap.chcol || '#000000',
                    tbcol: attrMap.tbcol || '#ffffff',
                    bgcol: attrMap.bgcol || '#ffffff',
                    chsz: attrMap.chsz ? parseFloat(attrMap.chsz) : 14,
                    dlen: attrMap.dlen ? parseInt(attrMap.dlen) : 0,
                    applist: attrMap.applist ? JSON.parse(this.decodeHtml(attrMap.applist)) : {},
                    framedisp: attrMap.framedisp || 'true',
                    namedisp: attrMap.namedisp || 'true',
                    pictdisp: attrMap.pictdisp || 'true',
                    roledisp: attrMap.roledisp || 'false',
                    typedisp: attrMap.typedisp || 'false',
                    updatedisp: attrMap.updatedisp || 'false'
                };

                // アイコンデータを渡す（同期的に設定される）
                const options = {
                    iconData: iconData
                };

                // DOM要素を作成
                const vobjElement = this.virtualObjectRenderer.createInlineElement(virtualObject, options);

                // innerContentをdata属性として追加（XMLエクスポート時に必要）
                const escapedInnerContent = this.escapeHtml(innerContent.trim());
                vobjElement.setAttribute('data-link-innercontent', escapedInnerContent);

                // その他の属性も追加（VirtualObjectRendererが設定しない属性）
                for (const [key, value] of Object.entries(attrMap)) {
                    if (!['id', 'name', 'tbcol', 'frcol', 'chcol', 'bgcol', 'chsz'].includes(key)) {
                        vobjElement.setAttribute(`data-link-${key}`, value);
                    }
                }

                return vobjElement.outerHTML;
            } else {
                // フォールバック: VirtualObjectRendererが利用できない場合
                const frcol = attrMap.frcol || '#000000';
                const chcol = attrMap.chcol || '#000000';
                const tbcol = attrMap.tbcol || '#ffffff';
                const chsz = attrMap.chsz ? parseFloat(attrMap.chsz) : null;
                const fontSize = chsz ? `${chsz}px` : '0.9em';
                const style = `display: inline-block; padding: 4px 8px; margin: 0 2px; background: ${tbcol}; border: 1px solid ${frcol}; cursor: pointer; color: ${chcol}; font-size: ${fontSize}; line-height: 1; vertical-align: middle; user-select: none; -webkit-user-select: none; -moz-user-select: none; -ms-user-select: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;

                return `<span class="virtual-object"${dataAttrs} contenteditable="false" unselectable="on" style="${style}">${this.escapeHtml(displayName)}</span>`;
            }
        });
    }

    /**
     * TAD XML文字修飾タグをHTMLに変換
     */
    async convertDecorationTagsToHTML(content) {
        let html = content;

        // 最初に<link>タグを仮身に変換（他の処理で消されないように先に処理）
        html = await this.convertLinkTagsToVirtualObjects(html);

        // <image>タグを<img>タグに変換（TAD形式: 自己閉じタグ）
        html = html.replace(/<image\s+src="([^"]*)"\s+width="([^"]*)"\s+height="([^"]*)"\s+planes="([^"]*)"\s+pixbits="([^"]*)"\s*\/>/gi,
            (match, src, width, height, planes, pixbits) => {
                // srcから画像ファイルのパスを取得
                // ファイル名のみの場合は、親ウィンドウから画像データを取得する必要がある
                let imagePath = src;

                // ファイル名のみでパスが含まれていない場合
                // loadImagesFromParent()で読み込むため、初期srcは空にする
                if (!src.includes('/') && !src.includes('\\') && !src.startsWith('data:')) {
                    imagePath = '';
                }

                // data-img-noを抽出（ファイル名から）
                const imgNoMatch = src.match(/_(\d+)\./);
                const imgNo = imgNoMatch ? imgNoMatch[1] : '0';

                // XMLのwidthとheightは表示サイズ（リサイズ後のサイズ）として使用
                return `<img src="${imagePath}" data-saved-filename="${src}" data-planes="${planes}" data-pixbits="${pixbits}" data-img-no="${imgNo}" data-needs-load="true" style="width: ${width}px; height: ${height}px; display: inline-block; vertical-align: middle; margin: 4px;">`;
            }
        );

        // XMLの改行文字を削除（タグの外側の改行のみ）
        // テキスト内の<br/>は保持
        html = html.replace(/\n/g, '').replace(/\r/g, '');

        // <font>タグを処理（自己閉じタグのペア形式を処理）
        // 状態管理しながらスタック方式で処理
        let result = '';
        let pos = 0;
        const fontRegex = /<font\s+(size|color|face)="([^"]*)"\s*\/>/g;
        let match;
        const stack = [];

        while ((match = fontRegex.exec(html)) !== null) {
            // マッチする前のテキスト・タグを追加
            result += html.substring(pos, match.index);
            
            const attr = match[1]; // size, color, face
            const value = match[2]; // 値

            if (value === '') {
                // 空文字列 = 終了タグ（元に戻す）
                // スタックから対応する開始タグを探して閉じる
                for (let i = stack.length - 1; i >= 0; i--) {
                    if (stack[i].attr === attr) {
                        result += '</span>';
                        stack.splice(i, 1);
                        break;
                    }
                }
            } else {
                // 値あり = 開始タグ
                let styleValue = '';
                if (attr === 'size') {
                    styleValue = `font-size: ${value}pt;`;
                } else if (attr === 'color') {
                    styleValue = `color: ${value};`;
                } else if (attr === 'face') {
                    styleValue = `font-family: ${value};`;
                }
                result += `<span style="${styleValue}">`;
                stack.push({ attr, value });
            }

            pos = fontRegex.lastIndex;
        }

        // 残りのテキストを追加
        result += html.substring(pos);
        html = result;

        // <underline>タグ -> <u>タグ
        html = html.replace(/<underline>(.*?)<\/underline>/gi, '<u>$1</u>');

        // <overline>タグ -> overlineスタイル
        html = html.replace(/<overline>(.*?)<\/overline>/gi, '<span style="text-decoration: overline;">$1</span>');

        // <strikethrough>タグ -> <s>タグ
        html = html.replace(/<strikethrough>(.*?)<\/strikethrough>/gi, '<s>$1</s>');

        // <bold>タグ -> <b>タグ
        html = html.replace(/<bold>(.*?)<\/bold>/gi, '<b>$1</b>');

        // <italic>タグ -> <i>タグ
        html = html.replace(/<italic>(.*?)<\/italic>/gi, '<i>$1</i>');

        // <superscript>タグ -> <sup>タグ
        html = html.replace(/<superscript>(.*?)<\/superscript>/gi, '<sup>$1</sup>');

        // <subscript>タグ -> <sub>タグ
        html = html.replace(/<subscript>(.*?)<\/subscript>/gi, '<sub>$1</sub>');

        // <bagchar>タグ -> text-strokeスタイル（袋文字）
        html = html.replace(/<bagchar>(.*?)<\/bagchar>/gi, '<span style="-webkit-text-stroke: 1px currentColor; paint-order: stroke fill;">$1</span>');

        // <box>タグ -> 枠囲み線（border）
        html = html.replace(/<box>(.*?)<\/box>/gi, '<span style="border: 1px solid currentColor; padding: 0 2px;">$1</span>');

        // <invert>タグ -> 反転スタイル
        html = html.replace(/<invert>(.*?)<\/invert>/gi, '<span style="background-color: currentColor; color: #ffffff; padding: 0 2px;">$1</span>');

        // <mesh>タグ -> 網掛けスタイル（#00000019 = rgba(0,0,0,0.1)相当）
        html = html.replace(/<mesh>(.*?)<\/mesh>/gi, '<span style="background-image: repeating-linear-gradient(45deg, transparent, transparent 2px, #00000019 2px, #00000019 4px);">$1</span>');

        // <noprint>タグ -> 薄い表示（無印字を示唆）
        html = html.replace(/<noprint>(.*?)<\/noprint>/gi, '<span style="opacity: 0.3;" data-noprint="true">$1</span>');

        // <ruby>タグ -> HTMLのrubyタグ
        // position="0"は行戻し側（上）、position="1"は行送り側（下）
        // position と text 属性を保持してXMLとの往復変換に対応
        html = html.replace(/<ruby\s+position="([01])"\s+text="([^"]*)"\s*>(.*?)<\/ruby>/gi, (match, position, rubyText, baseText) => {
            if (position === '0') {
                // 上側ルビ（通常のルビ）
                return `<ruby position="${position}" text="${rubyText}">${baseText}<rt>${rubyText}</rt></ruby>`;
            } else {
                // 下側ルビ（rtcを使用）
                return `<ruby position="${position}" text="${rubyText}">${baseText}<rtc style="ruby-position: under;">${rubyText}</rtc></ruby>`;
            }
        });

        // <br/>タグを保持
        html = html.replace(/<br\s*\/>/gi, '<br>');

        return html;
    }

    /**
     * TAD XMLから段落要素を抽出
     * <text>タグはレイアウト情報なので無視し、<document>内の<p>タグから直接テキストを抽出
     */
    async parseTextElements(tadXML) {
        console.log('[EDITOR] parseTextElements開始');
        const textElements = [];

        // <document>...</document>を抽出
        const docMatch = /<document>([\s\S]*?)<\/document>/i.exec(tadXML);

        if (!docMatch) {
            console.warn('[EDITOR] <document>タグが見つかりません');
            return textElements;
        }

        const docContent = docMatch[1];
        console.log('[EDITOR] <document>内容抽出完了, 長さ:', docContent.length);

        // <p>タグで段落に分割
        const paragraphRegex = /<p>([\s\S]*?)<\/p>/gi;
        let pMatch;
        let paragraphCount = 0;

        while ((pMatch = paragraphRegex.exec(docContent)) !== null) {
            const paragraphContent = pMatch[1];
            paragraphCount++;
            console.log(`[EDITOR] 段落${paragraphCount}:`, paragraphContent.substring(0, 100));

            // <text>タグは無視（レイアウト情報）
            // <font>タグからフォント情報を抽出（自己閉じタグ形式に対応）

            // <font color="..."/> を抽出
            const fontColorMatch = /<font\s+color="([^"]*)"\s*\/>/i.exec(paragraphContent);
            const fontColor = fontColorMatch ? fontColorMatch[1] : '';

            // <font size="..."/> を抽出
            const fontSizeMatch = /<font\s+size="([^"]*)"\s*\/>/i.exec(paragraphContent);
            const fontSize = fontSizeMatch ? fontSizeMatch[1] : '14';

            // <font face="..."/> を抽出（ネストした引用符に対応）
            const fontFaceMatch = /<font\s+face="([^"]*)"\s*\/>/i.exec(paragraphContent);
            const fontFamily = fontFaceMatch ? fontFaceMatch[1] : '';

            // <text align="..."/> を抽出
            const textAlignMatch = /<text\s+align="([^"]*)"\s*\/>/i.exec(paragraphContent);
            const textAlign = textAlignMatch ? textAlignMatch[1] : 'left';

            // 文字修飾タグをHTMLに変換してコンテンツを取得
            const htmlContent = await this.convertDecorationTagsToHTML(paragraphContent);

            // タグを除去してテキストのみ抽出（plainText用）
            const plainText = paragraphContent
                .replace(/\r\n/g, '')              // XML整形用の\r\nを先に削除
                .replace(/\r/g, '')                // \rを削除
                .replace(/<text[^>]*>/gi, '')      // <text>開始タグを削除
                .replace(/<\/text>/gi, '')         // </text>を削除
                .replace(/<font[^>]*\/>/gi, '')    // <font>自己閉じタグを削除
                .replace(/<font[^>]*>/gi, '')      // <font>開始タグを削除（後方互換性）
                .replace(/<\/font>/gi, '')         // </font>を削除（後方互換性）
                .replace(/<br\s*\/?>/gi, '\n')     // <br>を改行に変換（これは残す）
                .replace(/<[^>]+>/g, '')           // その他のタグを削除
                .trim();

            if (plainText) {
                console.log(`[EDITOR]   テキスト抽出:`, plainText.substring(0, 50));
                if (fontColor) console.log(`[EDITOR]   カラー: ${fontColor}`);
                if (fontSize !== '14') console.log(`[EDITOR]   サイズ: ${fontSize}pt`);
                if (fontFamily) console.log(`[EDITOR]   フォント: ${fontFamily.substring(0, 30)}`);

                textElements.push({
                    fontSize: fontSize,
                    fontFamily: fontFamily,
                    fontColor: fontColor,
                    textAlign: textAlign,
                    content: plainText,
                    htmlContent: htmlContent,  // HTML変換済みコンテンツ
                    rawXML: paragraphContent  // 元のXMLを保持
                });
            } else {
                // 空の段落も保持（改行として）
                console.log(`[EDITOR]   空段落`);
                textElements.push({
                    fontSize: '14',
                    fontFamily: '',
                    fontColor: '',
                    textAlign: textAlign,
                    content: '',
                    rawXML: paragraphContent  // 元のXMLを保持
                });
            }
        }

        console.log('[EDITOR] parseTextElements完了, 要素数:', textElements.length);
        return textElements;
    }

    /**
     * tadXMLをエディタに描画（TAD XMLタグをそのまま使用）
     */
    async renderTADXML(tadXML) {
        if (!tadXML) {
            this.editor.innerHTML = '<p>XMLデータの解析に失敗しました</p>';
            return;
        }

        try {
            console.log('[EDITOR] XML解析開始');

            // <document>...</document>を抽出
            const docMatch = /<document>([\s\S]*?)<\/document>/i.exec(tadXML);
            if (!docMatch) {
                console.warn('[EDITOR] <document>タグが見つかりません');
                this.editor.innerHTML = '<p>Document要素が見つかりません</p>';
                return;
            }

            const docContent = docMatch[1];

            // <p>タグで段落に分割（閉じタグがあるもの）
            const paragraphRegex = /<p>([\s\S]*?)<\/p>/gi;
            let htmlContent = '';
            let pMatch;
            let paragraphCount = 0;
            let lastIndex = 0;

            while ((pMatch = paragraphRegex.exec(docContent)) !== null) {
                paragraphCount++;
                let paragraphContent = pMatch[1];
                lastIndex = paragraphRegex.lastIndex;  // 最後に処理した位置を記録

                console.log(`[EDITOR] 段落${paragraphCount} 元の内容(最初の100文字):`, JSON.stringify(paragraphContent.substring(0, 100)));

                // 段落の前後の空白文字（改行、タブ、スペース）をトリム
                paragraphContent = paragraphContent.trim();

                // <font>と<text>タグから段落レベルのスタイルを抽出
                let style = 'margin: 0.5em 0;';
                let maxFontSize = 14; // デフォルトのフォントサイズ

                // フォントサイズ（段落の最初のもののみ）
                const fontSizeMatch = /<font\s+size="([^"]*)"\s*\/>/i.exec(paragraphContent);
                if (fontSizeMatch) {
                    style += `font-size: ${fontSizeMatch[1]}pt;`;
                    maxFontSize = parseFloat(fontSizeMatch[1]);
                    paragraphContent = paragraphContent.replace(/<font\s+size="[^"]*"\s*\/>/i, '');
                }

                // 段落内の最大フォントサイズを探す（行の高さを決定するため）
                // デフォルト値への復元タグ（9.6pt）は除外する
                const allFontSizes = paragraphContent.match(/<font\s+size="([^"]*)"\s*\/>/g);
                if (allFontSizes && allFontSizes.length > 0) {
                    // すべてのフォントサイズを確認し、最大値を取得
                    allFontSizes.forEach(fontTag => {
                        const sizeMatch = /<font\s+size="([^"]*)"\s*\/>/.exec(fontTag);
                        if (sizeMatch && sizeMatch[1] !== '9.6') {
                            const size = parseFloat(sizeMatch[1]);
                            if (size > maxFontSize) {
                                maxFontSize = size;
                            }
                        }
                    });
                }

                // フォントファミリー（段落の最初のもののみ）
                const fontFaceMatch = /<font\s+face="([^"]*)"\s*\/>/i.exec(paragraphContent);
                if (fontFaceMatch) {
                    style += `font-family: ${fontFaceMatch[1]};`;
                    paragraphContent = paragraphContent.replace(/<font\s+face="[^"]*"\s*\/>/i, '');
                }

                // フォントカラー（段落の最初のもののみ）
                const fontColorMatch = /<font\s+color="([^"]*)"\s*\/>/i.exec(paragraphContent);
                if (fontColorMatch) {
                    style += `color: ${fontColorMatch[1]};`;
                    paragraphContent = paragraphContent.replace(/<font\s+color="[^"]*"\s*\/>/i, '');
                }

                // テキスト配置
                const textAlignMatch = /<text\s+align="([^"]*)"\s*\/>/i.exec(paragraphContent);
                if (textAlignMatch) {
                    style += `text-align: ${textAlignMatch[1]};`;
                    paragraphContent = paragraphContent.replace(/<text\s+align="[^"]*"\s*\/>/gi, '');
                }

                // その他の<text>タグを削除（レイアウト情報）
                paragraphContent = paragraphContent.replace(/<text[^>]*\/>/gi, '');
                paragraphContent = paragraphContent.replace(/<text[^>]*>/gi, '').replace(/<\/text>/gi, '');

                console.log(`[EDITOR] 段落${paragraphCount} スタイル削除後(最初の100文字):`, JSON.stringify(paragraphContent.substring(0, 100)));

                // タグ間の余分な空白・改行を正規化
                // ただしテキストノード内の空白は保持
                paragraphContent = paragraphContent.replace(/>\s+</g, '><');

                console.log(`[EDITOR] 段落${paragraphCount} 空白正規化後(最初の100文字):`, JSON.stringify(paragraphContent.substring(0, 100)));

                // インライン<font>タグをHTMLに変換
                paragraphContent = await this.convertDecorationTagsToHTML(paragraphContent);

                console.log(`[EDITOR] 段落${paragraphCount} HTML変換後(最初の100文字):`, JSON.stringify(paragraphContent.substring(0, 100)));

                // line-heightを最大フォントサイズに基づいて設定
                const lineHeight = maxFontSize * 1.5;
                style += `line-height: ${lineHeight}px;`;

                // 空の段落（XMLソースの整形による改行のみの段落）はスキップ
                if (paragraphContent.trim()) {
                    htmlContent += `<p style="${style}">${paragraphContent}</p>`;
                }
            }

            // 閉じタグがない残りのコンテンツを処理（最後の<p>タグ以降）
            const remainingContent = docContent.substring(lastIndex);
            const openPMatch = /<p>([\s\S]*)$/i.exec(remainingContent);
            if (openPMatch) {
                paragraphCount++;
                let paragraphContent = openPMatch[1].trim();

                console.log(`[EDITOR] 段落${paragraphCount} (閉じタグなし) 元の内容(最初の100文字):`, JSON.stringify(paragraphContent.substring(0, 100)));

                // 段落レベルのスタイルを抽出
                let style = 'margin: 0.5em 0;';
                let maxFontSize = 14; // デフォルトのフォントサイズ

                // フォントサイズ
                const fontSizeMatch = /<font\s+size="([^"]*)"\s*\/>/i.exec(paragraphContent);
                if (fontSizeMatch) {
                    style += `font-size: ${fontSizeMatch[1]}pt;`;
                    maxFontSize = parseFloat(fontSizeMatch[1]);
                    paragraphContent = paragraphContent.replace(/<font\s+size="[^"]*"\s*\/>/i, '');
                }

                // 段落内の最大フォントサイズを探す（行の高さを決定するため）
                // デフォルト値への復元タグ（9.6pt）は除外する
                const allFontSizes = paragraphContent.match(/<font\s+size="([^"]*)"\s*\/>/g);
                if (allFontSizes && allFontSizes.length > 0) {
                    // すべてのフォントサイズを確認し、最大値を取得
                    allFontSizes.forEach(fontTag => {
                        const sizeMatch = /<font\s+size="([^"]*)"\s*\/>/.exec(fontTag);
                        if (sizeMatch && sizeMatch[1] !== '9.6') {
                            const size = parseFloat(sizeMatch[1]);
                            if (size > maxFontSize) {
                                maxFontSize = size;
                            }
                        }
                    });
                }

                // フォントファミリー
                const fontFaceMatch = /<font\s+face="([^"]*)"\s*\/>/i.exec(paragraphContent);
                if (fontFaceMatch) {
                    style += `font-family: ${fontFaceMatch[1]};`;
                    paragraphContent = paragraphContent.replace(/<font\s+face="[^"]*"\s*\/>/i, '');
                }

                // フォントカラー
                const fontColorMatch = /<font\s+color="([^"]*)"\s*\/>/i.exec(paragraphContent);
                if (fontColorMatch) {
                    style += `color: ${fontColorMatch[1]};`;
                    paragraphContent = paragraphContent.replace(/<font\s+color="[^"]*"\s*\/>/i, '');
                }

                // テキスト配置
                const textAlignMatch = /<text\s+align="([^"]*)"\s*\/>/i.exec(paragraphContent);
                if (textAlignMatch) {
                    style += `text-align: ${textAlignMatch[1]};`;
                    paragraphContent = paragraphContent.replace(/<text\s+align="[^"]*"\s*\/>/gi, '');
                }

                // その他の<text>タグを削除
                paragraphContent = paragraphContent.replace(/<text[^>]*\/>/gi, '');
                paragraphContent = paragraphContent.replace(/<text[^>]*>/gi, '').replace(/<\/text>/gi, '');

                // タグ間の余分な空白・改行を正規化
                paragraphContent = paragraphContent.replace(/>\s+</g, '><');

                // インライン<font>タグをHTMLに変換
                paragraphContent = await this.convertDecorationTagsToHTML(paragraphContent);

                console.log(`[EDITOR] 段落${paragraphCount} (閉じタグなし) HTML変換後(最初の100文字):`, JSON.stringify(paragraphContent.substring(0, 100)));

                // line-heightを最大フォントサイズに基づいて設定
                const lineHeight = maxFontSize * 1.5;
                style += `line-height: ${lineHeight}px;`;

                // 空の段落（XMLソースの整形による改行のみの段落）はスキップ
                if (paragraphContent.trim()) {
                    htmlContent += `<p style="${style}">${paragraphContent}</p>`;
                }
            }

            if (htmlContent) {
                this.editor.innerHTML = htmlContent;
                console.log('[EDITOR] TAD XMLコンテンツを設定しました, 段落数:', paragraphCount);

                // 仮身要素にイベントハンドラを追加
                this.setupVirtualObjectEventHandlers();

                // 画像を読み込んで表示
                this.loadImagesFromParent();

                // DOM更新後に自動展開チェック（レイアウトが確定してから）
                setTimeout(() => {
                    this.checkAllVirtualObjectsForAutoExpand();
                }, 200);
            } else {
                console.warn('[EDITOR] 段落要素が見つかりませんでした');
                // 空のエディタを表示
                this.editor.innerHTML = '<p><br></p>';
            }

            // ビューモードを清書モードに設定
            this.viewMode = 'formatted';
        } catch (error) {
            console.error('[EDITOR] XML描画エラー:', error);
            this.editor.innerHTML = '<p>XMLの描画に失敗しました</p><pre>' + this.escapeHtml(error.message) + '</pre>';
        }
    }

    /**
     * 仮身要素にイベントハンドラを設定
     */
    setupVirtualObjectEventHandlers() {
        const virtualObjects = this.editor.querySelectorAll('.virtual-object');
        console.log('[EDITOR] 仮身要素の数:', virtualObjects.length);

        virtualObjects.forEach(vo => {
            // 元の高さを保存（初回のみ）
            if (!vo.dataset.originalHeight && !vo.classList.contains('expanded')) {
                // chsz属性がある場合は、それから高さを計算
                const chsz = vo.dataset.linkChsz ? parseFloat(vo.dataset.linkChsz) : null;
                let height;

                if (chsz) {
                    // 閉じた状態の仮身の高さ（chszはポイント値なのでピクセルに変換）
                    const chszPx = window.convertPtToPx(chsz);
                    const lineHeight = 1.2;
                    const textHeight = Math.ceil(chszPx * lineHeight);
                    height = textHeight + 8; // 閉じた仮身の高さ
                } else {
                    // chsz がない場合は実際の高さを測定
                    const rect = vo.getBoundingClientRect();
                    height = rect.height;
                }

                if (height > 0) {
                    vo.dataset.originalHeight = height.toString();
                    console.log('[EDITOR] 仮身の元の高さを保存:', vo.dataset.linkName, height);
                }
            }

            // chszと実際のheightを比較して、自動的に開いた仮身にするか判定
            this.checkAndAutoExpandVirtualObject(vo);

            // シングルクリックイベント: 選択/非選択を切り替え
            vo.addEventListener('click', (e) => {
                // リサイズエリア(右端8px、下端8px)のクリックは無視
                const rect = vo.getBoundingClientRect();
                const isRightEdge = e.clientX > rect.right - 8;
                const isBottomEdge = e.clientY > rect.bottom - 8;
                if (isRightEdge || isBottomEdge) {
                    return; // リサイズエリアのクリックは無視
                }

                e.preventDefault();
                e.stopPropagation();

                // 他の仮身の選択を解除
                this.editor.querySelectorAll('.virtual-object.selected').forEach(other => {
                    if (other !== vo) {
                        other.classList.remove('selected');
                    }
                });

                // この仮身の選択状態をトグル
                vo.classList.toggle('selected');

                const linkName = vo.dataset.linkName || vo.textContent;
                if (vo.classList.contains('selected')) {
                    this.selectedVirtualObject = vo;
                    console.log('[EDITOR] 仮身選択:', linkName);
                    this.setStatus(`仮身選択: ${linkName}`);
                } else {
                    this.selectedVirtualObject = null;
                    console.log('[EDITOR] 仮身選択解除:', linkName);
                    this.setStatus('');
                }
            });

            // ダブルクリックイベント: defaultOpenアプリで開く
            vo.addEventListener('dblclick', async (e) => {
                e.preventDefault();
                e.stopPropagation();

                const linkId = vo.dataset.linkId;
                const linkName = vo.dataset.linkName;
                console.log('[EDITOR] 仮身ダブルクリック:', linkName, linkId);

                // 実身IDを抽出（拡張子とレコード番号を削除）
                let realId = linkId.replace(/\.(xtad|json)$/, '');
                realId = realId.replace(/_\d+$/, '');

                // realId.jsonを読み込んでdefaultOpenを取得
                try {
                    const appListData = await this.getAppListData(realId);
                    if (!appListData) {
                        this.setStatus('appListの取得に失敗しました');
                        return;
                    }

                    const defaultOpen = this.getDefaultOpenFromAppList(appListData);
                    if (defaultOpen) {
                        console.log('[EDITOR] defaultOpenアプリで起動:', defaultOpen);

                        // 親ウィンドウに実身を開くよう要求
                        const virtualObj = this.buildVirtualObjFromDataset(vo.dataset);

                        window.parent.postMessage({
                            type: 'open-virtual-object-real',
                            virtualObj: virtualObj,
                            pluginId: defaultOpen
                        }, '*');
                    } else {
                        this.setStatus('defaultOpenが設定されていません');
                    }
                } catch (error) {
                    console.error('[EDITOR] defaultOpen取得エラー:', error);
                    this.setStatus('defaultOpenの取得に失敗しました');
                }
            });

            // 仮身要素の上へのドラッグオーバーを防ぐ
            vo.addEventListener('dragover', (e) => {
                // 仮身の上にはドロップできないようにする
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = 'none';
            });

            // 仮身要素の上へのドロップを防ぐ
            vo.addEventListener('drop', (e) => {
                // 仮身の上にはドロップできないようにする
                e.preventDefault();
                e.stopPropagation();
            });

            // ドラッグイベント: 仮身をドラッグ可能にする
            vo.draggable = true;
            vo.addEventListener('dragstart', (e) => {
                // 通常のドラッグは移動、右クリック+ドラッグはコピー
                // ただし、現時点では右クリック判定が難しいため、デフォルトは移動
                e.dataTransfer.effectAllowed = 'move';
                this.isDraggingVirtualObject = true;
                this.draggingVirtualObject = vo;

                // ドラッグ中はすべてのiframeのpointer-eventsを無効化（開いた仮身内へのドロップを防ぐ）
                const allIframes = this.editor.querySelectorAll('.virtual-object-content');
                allIframes.forEach(iframe => {
                    iframe.style.pointerEvents = 'none';
                });
                console.log('[EDITOR] ドラッグ中: iframe pointer-events無効化 (', allIframes.length, '個)');

                // 仮身の情報を保存（エディタ内での移動用）
                // 注: 現在は元の仮身要素をそのまま移動するため、このデータは使用されない
                const attributes = {};
                for (const attr in vo.dataset) {
                    if (attr.startsWith('link')) {
                        attributes[attr] = vo.dataset[attr];
                    }
                }

                this.draggingVirtualObjectData = {
                    attributes: attributes,
                    textContent: vo.textContent,
                    style: vo.getAttribute('style')
                };

                // 仮身一覧プラグインへのドロップ用にJSON形式のデータを設定
                const virtualObj = this.buildVirtualObjFromDataset(vo.dataset);
                const dragData = {
                    type: 'virtual-object-drag',
                    source: 'basic-text-editor',
                    sourceWindowId: this.windowId, // 固定のウィンドウID
                    mode: 'move',
                    virtualObjects: [virtualObj],  // 配列形式（仮身一覧との互換性）
                    virtualObject: virtualObj
                };
                e.dataTransfer.setData('text/plain', JSON.stringify(dragData));

                console.log('[EDITOR] 仮身ドラッグ開始（移動モード）:', vo.dataset.linkName, dragData);
            });

            vo.addEventListener('dragend', (e) => {
                console.log('[EDITOR] 仮身ドラッグ終了:', e.dataTransfer.dropEffect, 'isDragging:', this.isDraggingVirtualObject, 'dropSuccess:', this.virtualObjectDropSuccess);

                // ドラッグ終了時にすべてのiframeのpointer-eventsを再有効化
                const allIframes = this.editor.querySelectorAll('.virtual-object-content');
                allIframes.forEach(iframe => {
                    iframe.style.pointerEvents = 'auto';
                });
                console.log('[EDITOR] ドラッグ終了: iframe pointer-events再有効化 (', allIframes.length, '個)');

                // ドラッグ中フラグがfalseの場合は既に処理済みなのでスキップ（dragendの重複発火対策）
                if (!this.isDraggingVirtualObject) {
                    console.log('[EDITOR] 既に処理済み、スキップ');
                    return;
                }

                // dropEffectが'move'かつドロップが成功した場合のみ、元の仮身を削除
                if (e.dataTransfer.dropEffect === 'move' && this.virtualObjectDropSuccess) {
                    // 要素がまだDOMに存在するかチェック（dragendの重複発火対策）
                    if (vo.parentNode) {
                        console.log('[EDITOR] 元の仮身を削除（移動完了）');
                        vo.remove();
                        this.isModified = true;
                        this.updateContentHeight();
                    } else {
                        console.log('[EDITOR] 仮身は既に削除済み、スキップ');
                    }
                } else {
                    console.log('[EDITOR] ドロップキャンセルまたは失敗、元の仮身を保持');
                }

                this.isDraggingVirtualObject = false;
                this.draggingVirtualObject = null;
                this.draggingVirtualObjectData = null;
                this.virtualObjectDropSuccess = false; // フラグをリセット
            });

            // リサイズイベント: 仮身の右端・下端をドラッグしてサイズ変更
            vo.addEventListener('mousedown', (e) => {
                const rect = vo.getBoundingClientRect();
                const isRightEdge = e.clientX > rect.right - 8;
                const isBottomEdge = e.clientY > rect.bottom - 8;

                if (isRightEdge || isBottomEdge) {
                    e.preventDefault();
                    e.stopPropagation();

                    // リサイズモード開始
                    const startX = e.clientX;
                    const startY = e.clientY;
                    const startWidth = rect.width;
                    const startHeight = rect.height;
                    const minWidth = 50;

                    // 元の高さを保存（初回のみ）
                    if (!vo.dataset.originalHeight) {
                        vo.dataset.originalHeight = startHeight.toString();
                    }
                    const originalHeight = parseFloat(vo.dataset.originalHeight);
                    const minHeight = originalHeight; // 通常サイズより小さくならない
                    const expandThreshold = originalHeight * 1.5; // 1.5倍以上で開いた仮身表示

                    vo.classList.add('resizing');
                    console.log('[EDITOR] 仮身リサイズ開始:', vo.dataset.linkName, 'startWidth:', startWidth, 'startHeight:', startHeight, 'originalHeight:', originalHeight);

                    // リサイズ中はすべてのiframeのポインターイベントを無効化（マウスイベントがiframeに吸収されるのを防ぐ）
                    const allIframes = this.editor.querySelectorAll('.virtual-object-content');
                    allIframes.forEach(iframe => {
                        iframe.style.pointerEvents = 'none';
                    });

                    // 展開処理中フラグ
                    let isExpanding = false;
                    let wasExpanded = vo.classList.contains('expanded');
                    let lastMoveEvent = null; // 最後のマウス移動イベントを保存

                    const onMouseMove = (moveEvent) => {
                        lastMoveEvent = moveEvent; // 最後のイベントを保存
                        let newWidth = startWidth;
                        let newHeight = startHeight;

                        if (isRightEdge) {
                            const deltaX = moveEvent.clientX - startX;
                            newWidth = Math.max(minWidth, startWidth + deltaX);
                            vo.style.width = `${newWidth}px`;
                            vo.style.minWidth = `${newWidth}px`;
                        }

                        if (isBottomEdge) {
                            const deltaY = moveEvent.clientY - startY;
                            newHeight = Math.max(minHeight, startHeight + deltaY);
                            vo.style.height = `${newHeight}px`;
                            vo.style.minHeight = `${newHeight}px`;

                            // 開いた仮身表示の判定（元の高さの1.5倍を基準）
                            const shouldExpand = newHeight >= expandThreshold;

                            if (shouldExpand && !wasExpanded && !isExpanding) {
                                // 展開処理は一度だけ実行
                                isExpanding = true;
                                wasExpanded = true;
                                this.expandVirtualObject(vo, newWidth, newHeight).catch(err => {
                                    console.error('[EDITOR] 展開エラー:', err);
                                }).finally(() => {
                                    isExpanding = false;
                                });
                            } else if (!shouldExpand && wasExpanded) {
                                // 縮小時は即座に通常表示に戻す
                                this.collapseVirtualObject(vo);
                                wasExpanded = false;
                            } else if (shouldExpand && wasExpanded) {
                                // 既に展開済みの場合はサイズだけ更新
                                const iframe = vo.querySelector('.virtual-object-content');
                                if (iframe) {
                                    iframe.style.width = `${newWidth}px`;
                                    iframe.style.height = `${newHeight - 30}px`;
                                }
                            }
                        }
                    };

                    // スロットル版のマウスムーブハンドラ（60FPS制限）
                    const throttledMouseMove = window.throttle ? window.throttle(onMouseMove, 16) : onMouseMove;

                    const onMouseUp = () => {
                        // 最終状態を即座に反映（最後のマウスイベントがあれば）
                        if (lastMoveEvent && throttledMouseMove.immediate) {
                            throttledMouseMove.immediate(lastMoveEvent);
                        }

                        vo.classList.remove('resizing');
                        document.removeEventListener('mousemove', throttledMouseMove);
                        document.removeEventListener('mouseup', onMouseUp);

                        // すべてのiframeのポインターイベントを再有効化
                        allIframes.forEach(iframe => {
                            iframe.style.pointerEvents = '';
                        });

                        // サイズを座標属性に保存してXMLに反映
                        const rect = vo.getBoundingClientRect();
                        const currentWidth = parseInt(vo.style.width) || rect.width;
                        const currentHeight = parseInt(vo.style.height) || rect.height;

                        // 既存の座標を取得（なければデフォルト値を使用）
                        const vobjleft = parseInt(vo.dataset.linkVobjleft) || 5;
                        const vobjtop = parseInt(vo.dataset.linkVobjtop) || 5;

                        // 新しい座標を計算
                        const vobjright = vobjleft + currentWidth;
                        const vobjbottom = vobjtop + currentHeight;

                        // 座標属性を更新
                        vo.dataset.linkVobjleft = vobjleft.toString();
                        vo.dataset.linkVobjtop = vobjtop.toString();
                        vo.dataset.linkVobjright = vobjright.toString();
                        vo.dataset.linkVobjbottom = vobjbottom.toString();

                        // 仮身オブジェクトを構築してXMLに保存
                        const virtualObj = {
                            link_id: vo.dataset.linkId,
                            link_name: vo.dataset.linkName,
                            vobjleft: vobjleft,
                            vobjtop: vobjtop,
                            vobjright: vobjright,
                            vobjbottom: vobjbottom,
                            width: currentWidth,
                            heightPx: currentHeight,
                            chsz: parseFloat(vo.dataset.chsz) || 14,
                            frcol: vo.dataset.frcol || '#000000',
                            chcol: vo.dataset.chcol || '#000000',
                            tbcol: vo.dataset.tbcol || '#ffffff',
                            bgcol: vo.dataset.bgcol || '#ffffff',
                            dlen: parseInt(vo.dataset.dlen) || 0,
                            pictdisp: vo.dataset.pictdisp,
                            namedisp: vo.dataset.namedisp,
                            roledisp: vo.dataset.roledisp,
                            typedisp: vo.dataset.typedisp,
                            updatedisp: vo.dataset.updatedisp,
                            framedisp: vo.dataset.framedisp,
                            autoopen: vo.dataset.autoopen
                        };

                        // リサイズ後の高さを新しい最低高さ（originalHeight）として保存
                        // 閉じた仮身の場合のみ更新（開いた仮身の場合は元の閉じた状態の高さを保持）
                        if (!vo.classList.contains('expanded')) {
                            vo.dataset.originalHeight = currentHeight.toString();
                            console.log('[EDITOR] リサイズにより originalHeight を更新:', vo.dataset.linkName, currentHeight);
                        }

                        // XMLに保存
                        this.updateVirtualObjectInXml(virtualObj);

                        console.log('[EDITOR] 仮身リサイズ終了、XMLに保存:', currentWidth, 'x', currentHeight, '座標:', vobjleft, vobjtop, vobjright, vobjbottom);
                        this.isModified = true;
                    };

                    document.addEventListener('mousemove', throttledMouseMove);
                    document.addEventListener('mouseup', onMouseUp);
                }
            });

            // 右クリックイベント: 仮身の情報を保存（メニューは通常の右クリックメニューで表示）
            vo.addEventListener('contextmenu', () => {
                // 右クリックされた仮身の情報を保存
                const linkId = vo.dataset.linkId;
                const linkName = vo.dataset.linkName;
                console.log('[EDITOR] 仮身右クリック:', linkName, linkId);

                // 仮身を選択状態にする
                this.editor.querySelectorAll('.virtual-object.selected').forEach(other => {
                    other.classList.remove('selected');
                });
                vo.classList.add('selected');

                // 実身IDを抽出して保存
                let realId = linkId.replace(/\.(xtad|json)$/, '');
                realId = realId.replace(/_\d+$/, '');
                console.log('[EDITOR] 抽出されたrealId:', realId, 'from linkId:', linkId);

                // 右クリックされた仮身の情報を保存（メニュー生成時に使用）
                this.contextMenuVirtualObject = {
                    element: vo,
                    realId: realId,
                    virtualObj: this.buildVirtualObjFromDataset(vo.dataset)
                };
                console.log('[EDITOR] contextMenuVirtualObject設定完了:', this.contextMenuVirtualObject);

                // イベントを伝播させて通常の右クリックメニューを表示
            });
        });
    }

    /**
     * 仮身が自動的に開いた状態で表示されるべきかチェック
     */
    checkAndAutoExpandVirtualObject(vo) {
        // 既に展開済みの場合はスキップ
        if (vo.classList.contains('expanded')) {
            return;
        }

        // chsz（文字サイズ）を取得
        const chsz = parseFloat(vo.dataset.linkChsz);
        if (!chsz || isNaN(chsz)) {
            return; // chszが無い場合は自動展開しない
        }

        // vobjheight（指定された高さ）を取得
        const vobjleft = parseInt(vo.dataset.linkVobjleft) || 0;
        const vobjright = parseInt(vo.dataset.linkVobjright) || 0;
        const vobjtop = parseInt(vo.dataset.linkVobjtop) || 0;
        const vobjbottom = parseInt(vo.dataset.linkVobjbottom) || 0;

        const width = vobjright - vobjleft;
        const height = vobjbottom - vobjtop;

        // 最小必要高さを計算（chsz + パディング）
        const minRequiredHeight = chsz + 16; // 上下パディング8pxずつ

        console.log('[EDITOR] 仮身自動展開チェック:', {
            name: vo.dataset.linkName || vo.textContent,
            chsz,
            height,
            minRequiredHeight,
            shouldExpand: height > minRequiredHeight
        });

        // 実際の高さが必要最小高さより大きい場合は自動展開
        if (height > minRequiredHeight && width > 0 && height > 0) {
            console.log('[EDITOR] 仮身を自動展開します:', vo.dataset.linkName || vo.textContent);
            // 次のイベントループで展開（DOMが完全に準備されてから）
            setTimeout(() => {
                this.expandVirtualObject(vo, width, height).catch(err => {
                    console.error('[EDITOR] 自動展開エラー:', err);
                });
            }, 100);
        }
    }

    /**
     * すべての仮身に対して自動展開チェックを実行
     */
    checkAllVirtualObjectsForAutoExpand() {
        console.log('[EDITOR] すべての仮身の自動展開チェックを開始');
        const virtualObjects = this.editor.querySelectorAll('.virtual-object');
        console.log('[EDITOR] 検出された仮身数:', virtualObjects.length);

        virtualObjects.forEach((vo, index) => {
            console.log(`[EDITOR] 仮身[${index}]をチェック:`, vo.dataset.linkName || vo.textContent);
            this.checkAndAutoExpandVirtualObject(vo);
        });
    }

    /**
     * 実身のJSON metadataからappListを取得
     */
    async getAppListData(realId) {
        try {
            console.log('[EDITOR] getAppListData開始 realId:', realId);
            const jsonFileName = `${realId}.json`;
            console.log('[EDITOR] JSONファイル名:', jsonFileName);

            // 親ウィンドウ経由でファイルを読み込む（仮身一覧プラグインと同じ方法）
            return new Promise((resolve) => {
                const messageId = `load-json-${Date.now()}-${Math.random()}`;
                let timeoutId = null;

                const messageHandler = async (event) => {
                    // messageIdまたはrequestIdで一致確認（両方に対応）
                    const matchesId = event.data.messageId === messageId || event.data.requestId === messageId;

                    if (event.data && event.data.type === 'load-data-file-response' && matchesId) {
                        // タイムアウトをクリア
                        if (timeoutId) {
                            clearTimeout(timeoutId);
                            timeoutId = null;
                        }
                        window.removeEventListener('message', messageHandler);

                        if (event.data.success) {
                            try {
                                console.log('[EDITOR] JSONファイル読み込み成功（親ウィンドウ経由）:', jsonFileName);

                                // dataフィールド（Fileオブジェクト）またはcontentフィールド（テキスト）に対応
                                let jsonText;
                                if (event.data.data && event.data.data instanceof File) {
                                    console.log('[EDITOR] Fileオブジェクトをテキストとして読み込み');
                                    jsonText = await event.data.data.text();
                                } else if (event.data.content) {
                                    jsonText = event.data.content;
                                } else {
                                    console.error('[EDITOR] レスポンスにdataまたはcontentフィールドがありません');
                                    resolve(null);
                                    return;
                                }

                                const jsonData = JSON.parse(jsonText);
                                console.log('[EDITOR] JSONパース成功 keys:', Object.keys(jsonData));

                                // applistセクションを返す（小文字）
                                if (jsonData.applist) {
                                    console.log('[EDITOR] applist found:', Object.keys(jsonData.applist));
                                    resolve(jsonData.applist);
                                } else {
                                    console.warn('[EDITOR] applistが設定されていません jsonData:', jsonData);
                                    resolve(null);
                                }
                            } catch (error) {
                                console.error('[EDITOR] JSONパースエラー:', error);
                                resolve(null);
                            }
                        } else {
                            console.error('[EDITOR] JSONファイル読み込み失敗:', event.data.error);
                            resolve(null);
                        }
                    }
                };

                window.addEventListener('message', messageHandler);

                // 親ウィンドウにファイル読み込みを要求
                window.parent.postMessage({
                    type: 'load-data-file-request',
                    fileName: jsonFileName,
                    messageId: messageId,
                    requestId: messageId  // 親ウィンドウはrequestIdを使用
                }, '*');

                console.log('[EDITOR] 親ウィンドウにファイル読み込み要求送信:', jsonFileName);

                // タイムアウト処理（10秒）
                timeoutId = setTimeout(() => {
                    window.removeEventListener('message', messageHandler);
                    console.error('[EDITOR] JSONファイル読み込みタイムアウト:', jsonFileName);
                    resolve(null);
                }, 10000);
            });
        } catch (error) {
            console.error('[EDITOR] appList取得エラー:', error);
            return null;
        }
    }

    /**
     * appListからdefaultOpenのプラグインIDを取得
     */
    getDefaultOpenFromAppList(appListData) {
        for (const [pluginId, appInfo] of Object.entries(appListData)) {
            if (appInfo.defaultOpen === true) {
                return pluginId;
            }
        }
        return null;
    }

    /**
     * datasetからvirtualObjを構築
     */
    buildVirtualObjFromDataset(dataset) {
        const virtualObj = {};
        for (const key in dataset) {
            if (key.startsWith('link')) {
                const attrName = key.replace(/^link/, '').toLowerCase();
                virtualObj['link_' + attrName] = dataset[key];
            }
        }
        return virtualObj;
    }

    /**
     * 仮身の右クリックメニューを表示
     */
    showVirtualObjectContextMenu(e, vo, appListData) {
        console.log('[EDITOR] 仮身の右クリックメニュー表示', appListData);

        // 親ウィンドウにメニュー表示を要求
        const rect = window.frameElement.getBoundingClientRect();

        // 実行メニュー項目を作成
        const executeSubmenu = [];
        for (const [pluginId, appInfo] of Object.entries(appListData)) {
            executeSubmenu.push({
                label: appInfo.name || pluginId,
                action: `execute-with-${pluginId}`,
                pluginId: pluginId
            });
        }

        // メニュー定義
        const contextMenuDef = [
            {
                label: '実行',
                submenu: executeSubmenu
            }
        ];

        // 仮身情報も一緒に送信
        const virtualObj = this.buildVirtualObjFromDataset(vo.dataset);

        window.parent.postMessage({
            type: 'show-virtual-object-context-menu',
            x: rect.left + e.clientX,
            y: rect.top + e.clientY,
            menuDefinition: contextMenuDef,
            virtualObj: virtualObj
        }, '*');
    }

    /**
     * HTMLエスケープ
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * HTMLデコード
     */
    decodeHtml(html) {
        const div = document.createElement('div');
        div.innerHTML = html;
        return div.textContent;
    }

    /**
     * ファイルを保存
     */
    async saveFile() {
        try {
            this.setStatus('保存中...');

            // エディタのHTMLを取得
            const html = this.editor.innerHTML;

            // Electron環境の場合
            if (typeof window.electronAPI !== 'undefined') {
                const filePath = await window.electronAPI.saveFileDialog(this.currentFile?.fileName || 'document.xml');
                if (filePath) {
                    const data = new TextEncoder().encode(html);
                    const result = await window.electronAPI.saveFile(filePath, Array.from(data));
                    if (result.success) {
                        this.setStatus('保存しました');
                    } else {
                        this.setStatus('保存に失敗しました');
                    }
                }
            } else {
                // ブラウザ環境: ダウンロード
                this.downloadAsFile(html, this.currentFile?.fileName || 'document.html');
                this.setStatus('ダウンロードしました');
            }
        } catch (error) {
            console.error('保存エラー:', error);
            this.setStatus('保存に失敗しました');
        }
    }

    /**
     * エディタの内容をTAD XML形式に変換（TAD XMLタグをそのまま抽出）
     */
    convertEditorToXML() {
        console.log('[EDITOR] convertEditorToXML開始');
        console.log('[EDITOR] エディタHTML:', this.editor.innerHTML.substring(0, 500));

        const xmlParts = ['<tad version="1.0" encoding="UTF-8">\r\n'];
        xmlParts.push('<document>\r\n');

        // エディタの各段落（<p>タグ）を処理
        const paragraphs = this.editor.querySelectorAll('p');
        console.log('[EDITOR] 段落数:', paragraphs.length);

        if (paragraphs.length === 0) {
            console.warn('[EDITOR] 段落が見つかりません。エディタの全内容を1段落として処理します');
            // 段落がない場合、エディタ全体を1つの段落として扱う
            xmlParts.push('<p>\r\n');
            this.extractTADXMLFromElement(this.editor, xmlParts);
            xmlParts.push('\r\n</p>\r\n');
        } else {
            paragraphs.forEach((p, index) => {
                console.log(`[EDITOR] 段落${index} HTML:`, p.innerHTML.substring(0, 200));
                xmlParts.push('<p>\r\n');

                // 段落のスタイルを解析してタグに変換
                const fontSize = this.extractFontSize(p);
                const fontFamily = this.extractFontFamily(p);
                const color = this.extractColor(p);
                const textAlign = this.extractTextAlign(p);

                console.log(`[EDITOR] 段落${index} スタイル:`, { fontSize, fontFamily, color, textAlign });

                // text-align情報を自己閉じタグとして追加
                if (textAlign && textAlign !== 'left') {
                    xmlParts.push(`<text align="${textAlign}"/>`);
                }

                // フォント情報を自己閉じタグとして追加
                if (fontFamily) {
                    xmlParts.push(`<font face="${fontFamily}"/>`);
                }
                if (fontSize) {
                    xmlParts.push(`<font size="${fontSize}"/>`);
                }
                if (color) {
                    xmlParts.push(`<font color="${color}"/>`);
                }

                // 段落の内容を取得（TAD XMLタグをそのまま保持）
                this.extractTADXMLFromElement(p, xmlParts);

                xmlParts.push('\r\n</p>\r\n');
            });
        }

        xmlParts.push('</document>\r\n');
        xmlParts.push('</tad>\r\n');

        const xml = xmlParts.join('');
        console.log('[EDITOR] convertEditorToXML完了, XML長さ:', xml.length);
        console.log('[EDITOR] XMLプレビュー:', xml.substring(0, 500));

        return xml;
    }

    /**
     * 要素からTAD XMLタグを抽出（タグをそのまま保持）
     */
    extractTADXMLFromElement(element, xmlParts, fontState = { size: '9.6', color: '#000000', face: '' }) {
        // xmlPartsが配列でない場合（古い呼び出し方）は、配列を作成して戻り値を返す
        const isOldStyle = !Array.isArray(xmlParts);
        if (isOldStyle) {
            fontState = xmlParts || { size: '9.6', color: '#000000', face: '' };
            xmlParts = [];
        }

        let xml = '';  // 一時的な文字列（このメソッド内でのみ使用）
        const nodes = element.childNodes;

        nodes.forEach(node => {
            if (node.nodeType === Node.TEXT_NODE) {
                // テキストノードはXMLエスケープして追加
                xml += this.escapeXml(node.textContent);
            } else if (node.nodeName === 'BR') {
                // 改行タグ
                xml += '<br/>';
            } else if (node.nodeName === 'IMG') {
                // 画像タグを<image>として出力（TAD形式: 自己閉じタグ）
                const savedFileName = node.getAttribute('data-saved-filename') || '';

                // リサイズ後の表示サイズを使用（style.widthから'px'を削除して数値化）
                let displayWidth, displayHeight;
                if (node.style.width && node.style.width.endsWith('px')) {
                    displayWidth = parseFloat(node.style.width);
                } else if (node.getAttribute('data-current-width') && node.getAttribute('data-current-width').endsWith('px')) {
                    displayWidth = parseFloat(node.getAttribute('data-current-width'));
                } else {
                    displayWidth = node.width || node.naturalWidth || 100;
                }

                if (node.style.height && node.style.height.endsWith('px')) {
                    displayHeight = parseFloat(node.style.height);
                } else if (node.getAttribute('data-current-height') && node.getAttribute('data-current-height').endsWith('px')) {
                    displayHeight = parseFloat(node.getAttribute('data-current-height'));
                } else {
                    displayHeight = node.height || node.naturalHeight || 100;
                }

                const planes = parseInt(node.getAttribute('data-planes')) || 3;
                const pixbits = parseInt(node.getAttribute('data-pixbits')) || 0x0818;

                xml += `<image src="${this.escapeXml(savedFileName)}" width="${displayWidth}" height="${displayHeight}" planes="${planes}" pixbits="${pixbits}"/>`;
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                const nodeName = node.nodeName.toLowerCase();

                // TAD XMLタグはそのまま出力
                if (['underline', 'overline', 'strikethrough', 'bagchar', 'box', 'invert', 'mesh', 'noprint', 'ruby'].includes(nodeName)) {
                    // 開始タグ
                    xml += `<${nodeName}`;

                    // 属性を追加
                    if (nodeName === 'ruby') {
                        const position = node.getAttribute('position') || '0';
                        const text = node.getAttribute('text') || '';
                        xml += ` position="${position}" text="${this.escapeXml(text)}"`;
                    }

                    xml += '>';

                    // 子要素を再帰的に処理（現在のフォント状態を引き継ぐ）
                    xml += this.extractTADXMLFromElement(node, fontState);

                    // 終了タグ
                    xml += `</${nodeName}>`;
                }
                // document.execCommandで追加されるHTML要素を処理
                else if (nodeName === 'font') {
                    // <font>タグのスタイルを抽出
                    const color = this.rgbToHex(node.color || node.style.color);
                    const sizeAttr = node.size || this.extractFontSize(node);
                    const face = node.face || this.extractFontFamily(node);

                    // 現在の状態を保存
                    const prevState = { ...fontState };
                    
                    // 新しい状態を作成
                    const newState = { ...fontState };
                    
                    // フォント情報をXMLの自己閉じタグとして出力（開始）
                    if (color) {
                        xml += `<font color="${color}"/>`;
                        newState.color = color;
                    }
                    if (sizeAttr) {
                        xml += `<font size="${sizeAttr}"/>`;
                        newState.size = sizeAttr;
                    }
                    if (face) {
                        xml += `<font face="${face}"/>`;
                        newState.face = face;
                    }

                    // 子要素を再帰的に処理（新しいフォント状態を渡す）
                    xml += this.extractTADXMLFromElement(node, newState);

                    // フォント情報を元に戻す（終了）- 逆順で前の状態に戻す
                    if (face) {
                        xml += `<font face="${prevState.face}"/>`;
                    }
                    if (sizeAttr) {
                        xml += `<font size="${prevState.size}"/>`;
                    }
                    if (color) {
                        xml += `<font color="${prevState.color}"/>`;
                    }
                }
                else if (nodeName === 'b' || nodeName === 'strong') {
                    xml += '<bold>';
                    xml += this.extractTADXMLFromElement(node, fontState);
                    xml += '</bold>';
                }
                else if (nodeName === 'i' || nodeName === 'em') {
                    xml += '<italic>';
                    xml += this.extractTADXMLFromElement(node, fontState);
                    xml += '</italic>';
                }
                else if (nodeName === 'u') {
                    xml += '<underline>';
                    xml += this.extractTADXMLFromElement(node, fontState);
                    xml += '</underline>';
                }
                else if (nodeName === 'sup') {
                    xml += '<superscript>';
                    xml += this.extractTADXMLFromElement(node, fontState);
                    xml += '</superscript>';
                }
                else if (nodeName === 'sub') {
                    xml += '<subscript>';
                    xml += this.extractTADXMLFromElement(node, fontState);
                    xml += '</subscript>';
                }
                else if (nodeName === 'span') {
                    // 仮身（virtual-object）を<link>タグに変換
                    if (node.classList && node.classList.contains('virtual-object')) {
                        // すべてのdata-link-*属性を復元（innercontentと閉じた状態の座標属性を除く）
                        const isExpanded = node.classList.contains('expanded');
                        let attrs = '';
                        let innerContent = '';
                        let applistAttr = '';

                        for (const key in node.dataset) {
                            if (key.startsWith('link')) {
                                const attrName = key.replace(/^link/, '').toLowerCase();
                                const attrValue = node.dataset[key];

                                // innercontentは属性ではなくタグ内テキストとして扱う
                                if (attrName === 'innercontent') {
                                    innerContent = attrValue;
                                }
                                // 展開状態でない場合は座標属性を保存しない
                                else if (!isExpanded && (attrName === 'vobjleft' || attrName === 'vobjtop' || attrName === 'vobjright' || attrName === 'vobjbottom')) {
                                    // 座標属性はスキップ
                                    continue;
                                }
                                else {
                                    attrs += ` ${attrName}="${this.escapeXml(attrValue)}"`;
                                }
                            } else if (key === 'applist') {
                                // applist属性を処理
                                applistAttr = ` applist="${this.escapeXml(node.dataset[key])}"`;
                            }
                        }
                        xml += `<link${attrs}${applistAttr}>${this.escapeXml(innerContent)}</link>`;
                    } else {
                        // spanタグのスタイルを解析
                        const style = node.style;

                        // 現在の状態を保存
                        const prevState = { ...fontState };

                        // 新しい状態を作成
                        const newState = { ...fontState };

                        // スタイル開始
                        if (style.color) {
                            const hexColor = this.rgbToHex(style.color);
                            xml += `<font color="${hexColor}"/>`;
                            newState.color = hexColor;
                        }
                        if (style.fontSize) {
                            const size = style.fontSize.replace('pt', '');
                            xml += `<font size="${size}"/>`;
                            newState.size = size;
                        }
                        if (style.fontFamily) {
                            xml += `<font face="${style.fontFamily}"/>`;
                            newState.face = style.fontFamily;
                        }

                        // 子要素を再帰的に処理（新しいフォント状態を渡す）
                        xml += this.extractTADXMLFromElement(node, newState);

                        // スタイル終了 - 逆順で前の状態に戻す
                        if (style.fontFamily) {
                            xml += `<font face="${prevState.face}"/>`;
                        }
                        if (style.fontSize) {
                            xml += `<font size="${prevState.size}"/>`;
                        }
                        if (style.color) {
                            xml += `<font color="${prevState.color}"/>`;
                        }
                    }
                }
                else {
                    // その他のHTML要素は内容のみ抽出（現在のフォント状態を引き継ぐ）
                    xml += this.extractTADXMLFromElement(node, fontState);
                }
            }
        });

        // 配列に追加
        if (xml) {
            xmlParts.push(xml);
        }

        // 古い呼び出し方の場合は、文字列として返す
        if (isOldStyle) {
            return xmlParts.join('');
        }
    }

    /**
     * 段落からフォントサイズを抽出
     */
    extractFontSize(element) {
        const style = element.style.fontSize;
        if (style) {
            return style.replace('pt', '');
        }
        return null;
    }

    /**
     * 段落からフォントファミリーを抽出
     */
    extractFontFamily(element) {
        const style = element.style.fontFamily;
        if (style) {
            return style.replace(/['"]/g, '');
        }
        return null;
    }

    /**
     * 段落から色を抽出
     */
    extractColor(element) {
        const style = element.style.color;
        if (style) {
            // RGB形式をそのまま返す
            return style;
        }
        return null;
    }

    /**
     * 段落からtext-alignを抽出
     */
    extractTextAlign(element) {
        const style = element.style.textAlign;
        if (style) {
            return style;
        }
        return 'left';
    }

    /**
     * HTML要素からテキストを抽出（<br>は改行として保持、文字修飾をTADタグに変換）
     */
    convertHTMLToText(element) {
        let text = '';
        const nodes = element.childNodes;

        nodes.forEach(node => {
            if (node.nodeType === Node.TEXT_NODE) {
                text += this.escapeXml(node.textContent);
            } else if (node.nodeName === 'BR') {
                text += '<br/>';
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                const nodeName = node.nodeName.toUpperCase();
                const innerText = this.convertHTMLToText(node);

                // HTML要素をTAD XMLタグに変換
                if (nodeName === 'U') {
                    text += `<underline>${innerText}</underline>`;
                } else if (nodeName === 'S') {
                    text += `<strikethrough>${innerText}</strikethrough>`;
                } else if (nodeName === 'RUBY') {
                    // rubyタグの処理
                    const rt = node.querySelector('rt');
                    const rtc = node.querySelector('rtc');
                    let baseText = '';
                    let rubyText = '';
                    let position = '0';

                    // ベーステキストを取得（rtとrtc以外のテキストノード）
                    node.childNodes.forEach(child => {
                        if (child.nodeType === Node.TEXT_NODE) {
                            baseText += child.textContent;
                        } else if (child.nodeName !== 'RT' && child.nodeName !== 'RTC') {
                            baseText += child.textContent;
                        }
                    });

                    if (rtc) {
                        // 下側ルビ
                        rubyText = rtc.textContent;
                        position = '1';
                    } else if (rt) {
                        // 上側ルビ
                        rubyText = rt.textContent;
                        position = '0';
                    }

                    text += `<ruby position="${position}" text="${this.escapeXml(rubyText)}">${this.escapeXml(baseText)}</ruby>`;
                } else if (nodeName === 'SPAN') {
                    const style = node.getAttribute('style') || '';
                    const dataNoprint = node.getAttribute('data-noprint');

                    if (dataNoprint) {
                        text += `<noprint>${innerText}</noprint>`;
                    } else if (style.includes('text-decoration: overline')) {
                        text += `<overline>${innerText}</overline>`;
                    } else if (style.includes('-webkit-text-stroke')) {
                        text += `<bagchar>${innerText}</bagchar>`;
                    } else if (style.includes('border: 1px solid')) {
                        text += `<box>${innerText}</box>`;
                    } else if (style.includes('background-color: currentColor')) {
                        text += `<invert>${innerText}</invert>`;
                    } else if (style.includes('repeating-linear-gradient')) {
                        text += `<mesh>${innerText}</mesh>`;
                    } else {
                        text += innerText;
                    }
                } else {
                    // その他の要素はそのまま内容を追加
                    text += innerText;
                }
            }
        });

        return text;
    }

    /**
     * XMLエスケープ
     */
    escapeXml(text) {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    /**
     * RGB/RGBA形式の色を#rrggbb形式に変換
     * @param {string} color - rgb(r, g, b) または rgba(r, g, b, a) または #rrggbb 形式の色
     * @returns {string} #rrggbb形式の色
     */
    rgbToHex(color) {
        if (!color) return '';
        
        // 既に#rrggbb形式の場合はそのまま返す
        if (color.startsWith('#')) {
            return color;
        }

        // rgb(r, g, b) または rgba(r, g, b, a) 形式をパース
        const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
        if (rgbMatch) {
            const r = parseInt(rgbMatch[1], 10);
            const g = parseInt(rgbMatch[2], 10);
            const b = parseInt(rgbMatch[3], 10);
            
            // 16進数に変換して#rrggbb形式で返す
            return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
        }

        // パースできない場合はそのまま返す
        return color;
    }

    /**
     * XMLとしてエクスポート
     * エディタの内容をTAD XML形式に変換して保存
     */
    async exportToXML() {
        try {
            this.setStatus('エクスポート中...');

            // エディタの内容をTAD XML形式に変換
            const xmlContent = this.convertEditorToXML();

            // 変換後のXMLをtadDataに保存（原稿モード表示用）
            this.tadData = xmlContent;

            console.log('[EDITOR] XMLエクスポート, 長さ:', xmlContent.length);

            // Electron環境の場合
            if (typeof window.electronAPI !== 'undefined') {
                const filePath = await window.electronAPI.saveFileDialog(
                    this.currentFile?.fileName?.replace(/\.[^.]+$/, '.xml') || 'document.xml'
                );
                if (filePath) {
                    const data = new TextEncoder().encode(xmlContent);
                    const result = await window.electronAPI.saveFile(filePath, Array.from(data));
                    if (result.success) {
                        this.setStatus('XMLエクスポートしました');
                    } else {
                        this.setStatus('エクスポートに失敗しました');
                    }
                }
            } else {
                // ブラウザ環境: ダウンロード
                const fileName = this.currentFile?.fileName?.replace(/\.[^.]+$/, '.xml') || 'document.xml';
                this.downloadAsFile(xmlContent, fileName);
                this.setStatus('XMLダウンロードしました');
            }
        } catch (error) {
            console.error('[EDITOR] エクスポートエラー:', error);
            this.setStatus('エクスポートに失敗しました');
        }
    }

    /**
     * 親ウインドウにXMLデータの変更を通知（自動保存用）
     */
    notifyXmlDataChanged() {
        if (window.parent && window.parent !== window) {
            // エディタの内容をTAD XML形式に変換
            const xmlContent = this.convertEditorToXML();

            // tadDataを更新
            this.tadData = xmlContent;

            window.parent.postMessage({
                type: 'xml-data-changed',
                fileId: this.realId,
                xmlData: xmlContent
            }, '*');
            console.log('[EDITOR] xmlTAD変更を通知, realId:', this.realId);
        }
    }

    /**
     * 新たな実身に保存（非再帰的コピー）
     */
    saveAsNewRealObject() {
        console.log('[EDITOR] saveAsNewRealObject - realId:', this.realId);

        // まず現在のデータを保存
        this.notifyXmlDataChanged();
        this.isModified = false;

        // 親ウィンドウに新たな実身への保存を要求
        const messageId = 'save-as-new-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);

        // 応答を待つハンドラ
        const handleMessage = (e) => {
            if (e.data && e.data.type === 'save-as-new-real-object-completed' && e.data.messageId === messageId) {
                window.removeEventListener('message', handleMessage);

                if (e.data.cancelled) {
                    console.log('[EDITOR] 新たな実身への保存がキャンセルされました');
                    this.setStatus('保存がキャンセルされました');
                } else if (e.data.success) {
                    console.log('[EDITOR] 新たな実身への保存成功:', e.data.newRealId, '名前:', e.data.newName);

                    // 既存の仮身から属性を取得（存在する場合）
                    const existingVobjs = this.editor.querySelectorAll('.virtual-object');
                    let vobjAttributes = {
                        chsz: 14,
                        frcol: '#ffffff',
                        chcol: '#000000',
                        tbcol: '#ffffff',
                        bgcol: '#ffffff',
                        dlen: 0,
                        // 表示属性のデフォルト値
                        framedisp: 'true',
                        namedisp: 'true',
                        pictdisp: 'true',
                        roledisp: 'false',
                        typedisp: 'false',
                        updatedisp: 'false'
                    };

                    // 既存の仮身がある場合、その属性をコピー
                    if (existingVobjs.length > 0) {
                        const firstVobj = existingVobjs[0];
                        try {
                            // data-link-*属性から取得
                            const linkChsz = firstVobj.getAttribute('data-link-chsz');
                            const linkFrcol = firstVobj.getAttribute('data-link-frcol');
                            const linkChcol = firstVobj.getAttribute('data-link-chcol');
                            const linkTbcol = firstVobj.getAttribute('data-link-tbcol');
                            const linkBgcol = firstVobj.getAttribute('data-link-bgcol');
                            const linkFramedisp = firstVobj.getAttribute('data-link-framedisp');
                            const linkNamedisp = firstVobj.getAttribute('data-link-namedisp');
                            const linkPictdisp = firstVobj.getAttribute('data-link-pictdisp');
                            const linkRoledisp = firstVobj.getAttribute('data-link-roledisp');
                            const linkTypedisp = firstVobj.getAttribute('data-link-typedisp');
                            const linkUpdatedisp = firstVobj.getAttribute('data-link-updatedisp');

                            if (linkChsz) vobjAttributes.chsz = parseFloat(linkChsz);
                            if (linkFrcol) vobjAttributes.frcol = linkFrcol;
                            if (linkChcol) vobjAttributes.chcol = linkChcol;
                            if (linkTbcol) vobjAttributes.tbcol = linkTbcol;
                            if (linkBgcol) vobjAttributes.bgcol = linkBgcol;
                            if (linkFramedisp) vobjAttributes.framedisp = linkFramedisp;
                            if (linkNamedisp) vobjAttributes.namedisp = linkNamedisp;
                            if (linkPictdisp) vobjAttributes.pictdisp = linkPictdisp;
                            if (linkRoledisp) vobjAttributes.roledisp = linkRoledisp;
                            if (linkTypedisp) vobjAttributes.typedisp = linkTypedisp;
                            if (linkUpdatedisp) vobjAttributes.updatedisp = linkUpdatedisp;

                            console.log('[EDITOR] 既存仮身から属性を取得:', vobjAttributes);
                        } catch (e) {
                            console.warn('[EDITOR] 既存仮身の属性取得失敗、デフォルト値を使用:', e);
                        }
                    }

                    // 新しい仮身をカーソル位置（すぐ後）に挿入
                    const newVirtualObject = {
                        link_id: `${e.data.newRealId}_0.xtad`,
                        link_name: e.data.newName,
                        chsz: vobjAttributes.chsz,
                        frcol: vobjAttributes.frcol,
                        chcol: vobjAttributes.chcol,
                        tbcol: vobjAttributes.tbcol,
                        bgcol: vobjAttributes.bgcol,
                        dlen: vobjAttributes.dlen,
                        applist: {},
                        // 表示属性を設定
                        framedisp: vobjAttributes.framedisp,
                        namedisp: vobjAttributes.namedisp,
                        pictdisp: vobjAttributes.pictdisp,
                        roledisp: vobjAttributes.roledisp,
                        typedisp: vobjAttributes.typedisp,
                        updatedisp: vobjAttributes.updatedisp
                    };

                    console.log('[EDITOR] 新しい仮身の属性:', newVirtualObject);

                    // insertVirtualObjectLinkを使って仮身を挿入
                    this.insertVirtualObjectLink(newVirtualObject);

                    // XMLデータを更新して保存
                    this.notifyXmlDataChanged();

                    this.setStatus('新しい実身に保存しました: ' + e.data.newName);
                    console.log('[EDITOR] 新しい仮身をエディタに挿入しました');
                } else {
                    console.error('[EDITOR] 新たな実身への保存失敗:', e.data.error);
                    this.setStatus('保存に失敗しました');
                }
            }
        };

        window.addEventListener('message', handleMessage);

        window.parent.postMessage({
            type: 'save-as-new-real-object',
            realId: this.realId,
            messageId: messageId
        }, '*');

        console.log('[EDITOR] 新たな実身への保存要求:', this.realId);
    }

    /**
     * ファイルとしてダウンロード
     */
    downloadAsFile(content, filename) {
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    /**
     * ステータスを設定
     * tadjs-desktop.htmlのステータスバーにメッセージを送信
     */
    setStatus(message) {
        console.log(`[基本文章編集] ${message}`);

        // 親ウィンドウにステータスメッセージを送信
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: 'status-message',
                message: message
            }, '*');
        }
    }

    /**
     * 入力ダイアログを表示（プロンプトの置き換え）
     * @param {string} message - 表示するメッセージ
     * @param {string} defaultValue - デフォルト値
     * @param {number} inputWidth - 入力欄の幅（文字数）
     * @returns {Promise<string|null>} - 入力値またはnull（キャンセル時）
     */
    showInputDialog(message, defaultValue = '', inputWidth = 30) {
        return new Promise((resolve) => {
            const messageId = ++this.dialogMessageId;

            // コールバックを登録
            this.dialogCallbacks[messageId] = (result) => {
                // 「取り消し」ボタンの場合はnullを返す
                if (result.button === 'cancel') {
                    resolve(null);
                } else {
                    resolve(result.value);
                }
            };

            // 親ウィンドウにダイアログ表示を要求
            window.parent.postMessage({
                type: 'show-input-dialog',
                messageId: messageId,
                message: message,
                defaultValue: defaultValue,
                inputWidth: inputWidth,
                buttons: [
                    { label: '取り消し', value: 'cancel' },
                    { label: '設　定', value: 'ok' }
                ],
                defaultButton: 1
            }, '*');
        });
    }

    /**
     * メッセージダイアログを表示
     * @param {string} message - 表示するメッセージ
     * @param {Array} buttons - ボタン定義配列
     * @param {number} defaultButton - デフォルトボタンのインデックス
     * @returns {Promise<any>} - 選択されたボタンの値
     */
    showMessageDialog(message, buttons, defaultButton = 0) {
        return new Promise((resolve) => {
            const messageId = ++this.dialogMessageId;

            // コールバックを登録
            this.dialogCallbacks[messageId] = (result) => {
                resolve(result);
            };

            // 親ウィンドウにダイアログ表示を要求
            window.parent.postMessage({
                type: 'show-message-dialog',
                messageId: messageId,
                message: message,
                buttons: buttons,
                defaultButton: defaultButton
            }, '*');
        });
    }

    /**
     * ウィンドウアクティベーションのセットアップ
     */
    setupWindowActivation() {
        // ウィンドウ内のクリックでウィンドウを最前面に
        document.addEventListener('mousedown', (e) => {
            if (window.parent && window.parent !== window) {
                window.parent.postMessage({
                    type: 'activate-window'
                }, '*');
            }
        });
    }

    /**
     * 右クリックメニューのセットアップ
     * ※tadjs-desktop.htmlのメニューシステムを使用するため、独自メニューは無効化
     */
    setupContextMenu() {
        // iframe内の右クリックを無効化し、親ウィンドウに通知
        document.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();

            // 親ウィンドウに右クリック位置を通知
            if (window.parent && window.parent !== window) {
                // iframeの位置を取得
                const rect = window.frameElement.getBoundingClientRect();

                window.parent.postMessage({
                    type: 'context-menu-request',
                    x: rect.left + e.clientX,
                    y: rect.top + e.clientY
                }, '*');
            }
        });
    }

    /**
     * メニュー定義
     */
    async getMenuDefinition() {
        const menuDef = [
            {
                label: '保存',
                submenu: [
                    { label: '元の実身に保存', action: 'save', shortcut: 'Ctrl+S' },
                    { label: '新たな実身に保存', action: 'save-as-new' }
                ]
            },
            {
                label: '表示',
                submenu: [
                    { label: '原稿（xml直接表示）モード', action: 'view-xml' },
                    { label: '清書モード', action: 'view-formatted' },
                    { separator: true },
                    { label: '全画面表示オンオフ', action: 'toggle-fullscreen', shortcut: 'Ctrl+L' },
                    { label: '再表示', action: 'refresh' },
                    { label: '背景色変更', action: 'change-bg-color' },
                    { separator: true },
                    { label: 'ウインドウ幅で折り返し', action: 'toggle-wrap' }
                ]
            },
            {
                label: '編集',
                submenu: [
                    { label: '取消', action: 'undo' },
                    { label: 'クリップボードへコピー', action: 'copy', shortcut: 'Ctrl+C' },
                    { label: 'クリップボードからコピー', action: 'paste', shortcut: 'Ctrl+V' },
                    { label: 'クリップボードへ移動', action: 'cut', shortcut: 'Ctrl+X' },
                    { label: 'クリップボードから移動', action: 'redo', shortcut: 'Ctrl+Z' },
                    { separator: true },
                    { label: 'すべて選択', action: 'select-all' },
                    { separator: true },
                    { label: '検索/置換', action: 'find-replace' }
                ]
            },
            {
                label: '書体',
                submenu: [
                    { label: '書体一覧', action: 'font-list' },
                    { separator: true },
                    { label: 'ゴシック', action: 'font-gothic' },
                    { label: '明朝', action: 'font-mincho' },
                    { label: 'メイリオ', action: 'font-meiryo' }
                ]
            },
            {
                label: '文字修飾',
                submenu: [
                    { label: '標準', action: 'style-normal' },
                    { label: '太字', action: 'style-bold', shortcut: 'Ctrl+B' },
                    { label: '斜体', action: 'style-italic' },
                    { label: '袋文字', action: 'style-bagchar' },
                    { label: '枠囲み', action: 'style-box' },
                    { label: '影付き', action: 'style-shadow' },
                    { separator: true },
                    { label: '下線', action: 'style-underline' },
                    { label: '上線', action: 'style-overline' },
                    { label: '取り消し線', action: 'style-strikethrough' },
                    { label: '網掛', action: 'style-hatched' },
                    { label: '反転', action: 'style-inverse' },
                    { label: '無印字', action: 'style-noprint' },
                    { separator: true },
                    { label: '上付き', action: 'style-superscript' },
                    { label: '下付き', action: 'style-subscript' },
                    { label: '解除', action: 'style-clear' }
                ]
            },
            {
                label: '文字サイズ',
                submenu: [
                    { label: '5（1/2倍）', action: 'size-5' },
                    { label: '7（3/4倍）', action: 'size-7' },
                    { label: '8', action: 'size-8' },
                    { label: '9.6（標準）', action: 'size-9.6' },
                    { label: '11', action: 'size-11' },
                    { label: '12', action: 'size-12' },
                    { label: '13', action: 'size-13' },
                    { label: '14', action: 'size-14' },
                    { label: '16', action: 'size-16' },
                    { label: '18', action: 'size-18' },
                    { label: '19.2（2倍）', action: 'size-19.2' },
                    { label: '29（3倍）', action: 'size-29' },
                    { label: '38（4倍）', action: 'size-38' },
                    { label: '58（6倍）', action: 'size-58' },
                    { label: '77（8倍）', action: 'size-77' },
                    { separator: true },
                    { label: '数値指定', action: 'size-custom' },
                    { separator: true },
                    { label: '全角', action: 'size-fullwidth' },
                    { label: '半角', action: 'size-halfwidth' }
                ]
            },
            {
                label: '文字色',
                submenu: [
                    { label: '黒色', action: 'color-black' },
                    { label: '青色', action: 'color-blue' },
                    { label: '赤色（238,0,0）', action: 'color-red' },
                    { label: 'ピンク色', action: 'color-pink' },
                    { label: '橙色', action: 'color-orange' },
                    { label: '緑色', action: 'color-green' },
                    { label: '黄緑色', action: 'color-lime' },
                    { label: '水色', action: 'color-cyan' },
                    { label: '黄色', action: 'color-yellow' },
                    { label: '白色', action: 'color-white' },
                    { separator: true },
                    { label: '文字色指定（RGB（FFFFFF））', action: 'color-custom' }
                ]
            },
            {
                label: '書式',
                submenu: [
                    { label: '字下げ', action: 'format-indent' },
                    {
                        label: '行揃え',
                        submenu: [
                            { label: '行頭揃え', action: 'align-left' },
                            { label: '中央揃え', action: 'align-center' },
                            { label: '行末揃え', action: 'align-right' }
                        ]
                    },
                    { separator: true },
                    {
                        label: 'ルビ',
                        submenu: [
                            { label: 'ルビ（上）', action: 'ruby-top' },
                            { label: 'ルビ（下）', action: 'ruby-bottom' }
                        ]
                    },
                    { separator: true },
                    { label: '改ページ', action: 'format-pagebreak' }
                ]
            }
        ];

        // 仮身が選択されている場合は仮身操作メニューを追加
        console.log('[EDITOR] getMenuDefinition: contextMenuVirtualObject:', this.contextMenuVirtualObject);
        if (this.contextMenuVirtualObject) {
            try {
                console.log('[EDITOR] getMenuDefinition: 仮身が選択されています realId:', this.contextMenuVirtualObject.realId);

                // 仮身操作メニュー
                const realId = this.contextMenuVirtualObject.realId;
                const isOpened = this.openedRealObjects.has(realId);

                const virtualObjSubmenu = [
                    { label: '開く', action: 'open-real-object', disabled: isOpened },
                    { label: '閉じる', action: 'close-real-object', disabled: !isOpened },
                    { separator: true },
                    { label: '属性変更', action: 'change-virtual-object-attributes' }
                ];

                menuDef.push({
                    label: '仮身操作',
                    submenu: virtualObjSubmenu
                });

                // 実身操作メニュー
                const realObjSubmenu = [
                    { label: '実身名変更', action: 'rename-real-object' },
                    { label: '実身複製', action: 'duplicate-real-object' }
                ];

                menuDef.push({
                    label: '実身操作',
                    submenu: realObjSubmenu
                });

                // 屑実身操作メニュー
                menuDef.push({
                    label: '屑実身操作',
                    action: 'open-trash-real-objects'
                });

                // 実行メニュー
                const applistData = await this.getAppListData(this.contextMenuVirtualObject.realId);
                console.log('[EDITOR] getMenuDefinition: applistData:', applistData);
                if (applistData && Object.keys(applistData).length > 0) {
                    const executeSubmenu = [];
                    for (const [pluginId, appInfo] of Object.entries(applistData)) {
                        console.log('[EDITOR] getMenuDefinition: 実行メニュー項目追加:', pluginId, appInfo);
                        executeSubmenu.push({
                            label: appInfo.name || pluginId,
                            action: `execute-with-${pluginId}`
                        });
                    }

                    menuDef.push({
                        label: '実行',
                        submenu: executeSubmenu
                    });
                    console.log('[EDITOR] getMenuDefinition: 実行メニュー追加完了 項目数:', executeSubmenu.length);
                } else {
                    console.warn('[EDITOR] getMenuDefinition: applistDataが空またはnull');
                }
            } catch (error) {
                console.error('[EDITOR] applist取得エラー:', error);
            }
        } else {
            console.log('[EDITOR] getMenuDefinition: 仮身が選択されていません');
        }

        return menuDef;
    }

    /**
     * コンテキストメニューを表示
     */
    async showContextMenu(x, y) {
        const contextMenu = document.getElementById('context-menu');
        const menuDef = await this.getMenuDefinition();

        contextMenu.innerHTML = this.renderMenu(menuDef);
        contextMenu.style.left = x + 'px';
        contextMenu.style.top = y + 'px';
        contextMenu.classList.add('show');

        // メニュー項目のクリックイベント
        contextMenu.querySelectorAll('.context-menu-item[data-action]').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = item.dataset.action;
                this.executeMenuAction(action);
                this.hideContextMenu();
            });
        });
    }

    /**
     * メニューをHTML化
     */
    renderMenu(menuItems) {
        let html = '';
        menuItems.forEach(item => {
            if (item.separator) {
                html += '<div class="context-menu-separator"></div>';
            } else if (item.submenu) {
                html += `<div class="context-menu-item">
                    <span>${item.label}</span>
                    <span class="arrow">▶</span>
                    <div class="context-submenu">
                        ${this.renderMenu(item.submenu)}
                    </div>
                </div>`;
            } else {
                const shortcut = item.shortcut ? `<span class="shortcut">${item.shortcut}</span>` : '';
                html += `<div class="context-menu-item" data-action="${item.action}">
                    <span>${item.label}</span>
                    ${shortcut}
                </div>`;
            }
        });
        return html;
    }

    /**
     * コンテキストメニューを非表示
     */
    hideContextMenu() {
        const contextMenu = document.getElementById('context-menu');
        contextMenu.classList.remove('show');
    }

    /**
     * メニューアクションを実行
     */
    executeMenuAction(action, additionalData) {
        console.log('[EDITOR] メニューアクション:', action, additionalData);

        // 仮身の実行メニューからのアクション
        if (action.startsWith('execute-with-')) {
            const pluginId = action.replace('execute-with-', '');
            console.log('[EDITOR] 仮身を指定アプリで起動:', pluginId);

            // contextMenuVirtualObjectから仮身情報を取得
            if (this.contextMenuVirtualObject && this.contextMenuVirtualObject.virtualObj) {
                window.parent.postMessage({
                    type: 'open-virtual-object-real',
                    virtualObj: this.contextMenuVirtualObject.virtualObj,
                    pluginId: pluginId
                }, '*');
                this.setStatus(`${pluginId}で実身を開きます`);
            }
            return;
        }

        switch (action) {
            // ファイル操作
            case 'save':
                // 自動保存（実身xtadとjsonのセットで保存）
                this.notifyXmlDataChanged();
                this.isModified = false; // 保存後は未編集状態に
                this.setStatus('保存しました');
                break;

            case 'save-as-new':
                // 新たな実身に保存
                this.saveAsNewRealObject();
                break;

            case 'close':
                // ウィンドウを閉じる
                this.requestCloseWindow();
                break;

            // 表示
            case 'view-xml':
                this.viewXMLMode();
                break;
            case 'view-formatted':
                this.viewFormattedMode();
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
            case 'toggle-wrap':
                this.toggleWrap();
                break;

            // 編集
            case 'undo':
                document.execCommand('undo');
                this.setStatus('元に戻しました');
                break;
            case 'copy':
                // 画像が選択されている場合は画像をコピー
                if (this.selectedImage) {
                    this.copyImage(this.selectedImage);
                    this.setStatus('画像をクリップボードへコピーしました');
                } else if (this.selectedVirtualObject) {
                    // 仮身が選択されている場合は仮身をコピー
                    this.copyVirtualObject(this.selectedVirtualObject);
                    this.setStatus('仮身をクリップボードへコピーしました');
                } else {
                    document.execCommand('copy');
                    this.setStatus('クリップボードへコピーしました');
                }
                break;
            case 'paste':
                // クリップボードに画像がある場合は画像を貼り付け
                if (this.imageClipboard) {
                    this.pasteImage();
                    this.setStatus('画像をクリップボードから貼り付けました');
                } else if (this.virtualObjectClipboard) {
                    // ローカルクリップボードに仮身がある場合は仮身を貼り付け
                    this.pasteVirtualObject();
                    this.setStatus('仮身をクリップボードから貼り付けました');
                } else {
                    // グローバルクリップボードをチェック（非同期）
                    this.pasteFromGlobalClipboard();
                }
                break;
            case 'cut':
                // 画像が選択されている場合は画像を移動
                if (this.selectedImage) {
                    this.cutImage(this.selectedImage);
                    this.setStatus('画像をクリップボードへ移動しました');
                } else if (this.selectedVirtualObject) {
                    // 仮身が選択されている場合は仮身を移動
                    this.cutVirtualObject(this.selectedVirtualObject);
                    this.setStatus('仮身をクリップボードへ移動しました');
                } else {
                    document.execCommand('cut');
                    this.setStatus('クリップボードへ移動しました');
                }
                break;
            case 'redo':
                // クリップボードに画像がある場合は画像を移動（貼り付け後クリア）
                if (this.imageClipboard && this.imageClipboard.isCut) {
                    this.pasteImage();
                    this.imageClipboard = null;  // 移動なのでクリップボードをクリア
                    this.setStatus('画像をクリップボードから移動しました');
                } else if (this.virtualObjectClipboard && this.virtualObjectClipboard.isCut) {
                    // クリップボードに仮身がある場合は仮身を移動（貼り付け後クリア）
                    this.pasteVirtualObject();
                    this.virtualObjectClipboard = null;  // 移動なのでクリップボードをクリア
                    this.setStatus('仮身をクリップボードから移動しました');
                } else {
                    document.execCommand('redo');
                    this.setStatus('やり直しました');
                }
                break;
            case 'select-all':
                document.execCommand('selectAll');
                this.setStatus('すべて選択しました');
                break;
            case 'find-replace':
                this.findReplace();
                break;

            // 書体
            case 'font-list':
                this.showFontList();
                break;
            case 'font-gothic':
                this.applyFont('sans-serif, "Yu Gothic", "游ゴシック", "Meiryo"');
                break;
            case 'font-mincho':
                this.applyFont('serif, "Yu Mincho", "游明朝", "MS Mincho"');
                break;
            case 'font-meiryo':
                this.applyFont('"Meiryo", "メイリオ"');
                break;

            // 文字修飾
            case 'style-normal':
                this.clearFormatting();
                break;
            case 'style-bold':
                document.execCommand('bold');
                this.setStatus('太字を適用しました');
                break;
            case 'style-italic':
                document.execCommand('italic');
                this.setStatus('斜体を適用しました');
                break;
            case 'style-bagchar':
                this.applyBagchar();
                break;
            case 'style-box':
                this.applyBox();
                break;
            case 'style-shadow':
                this.applyTextShadow();
                break;
            case 'style-underline':
                this.applyUnderline();
                break;
            case 'style-overline':
                this.applyOverline();
                break;
            case 'style-strikethrough':
                this.applyStrikethrough();
                break;
            case 'style-hatched':
                this.applyHatched();
                break;
            case 'style-inverse':
                this.applyInverse();
                break;
            case 'style-noprint':
                this.applyNoprint();
                break;
            case 'style-superscript':
                document.execCommand('superscript');
                this.setStatus('上付きを適用しました');
                break;
            case 'style-subscript':
                document.execCommand('subscript');
                this.setStatus('下付きを適用しました');
                break;
            case 'style-clear':
                document.execCommand('removeFormat');
                this.setStatus('書式を解除しました');
                break;

            // 文字サイズ
            case 'size-custom':
                this.customFontSize();
                break;
            case 'size-fullwidth':
                this.applyFullWidth();
                break;
            case 'size-halfwidth':
                this.applyHalfWidth();
                break;

            // 文字色
            case 'color-black':
                document.execCommand('foreColor', false, '#000000');
                this.setStatus('文字色: 黒');
                break;
            case 'color-blue':
                document.execCommand('foreColor', false, '#0000ff');
                this.setStatus('文字色: 青');
                break;
            case 'color-red':
                document.execCommand('foreColor', false, '#ee0000');
                this.setStatus('文字色: 赤');
                break;
            case 'color-pink':
                document.execCommand('foreColor', false, '#ff69b4');
                this.setStatus('文字色: ピンク');
                break;
            case 'color-orange':
                document.execCommand('foreColor', false, '#ff8c00');
                this.setStatus('文字色: 橙');
                break;
            case 'color-green':
                document.execCommand('foreColor', false, '#008000');
                this.setStatus('文字色: 緑');
                break;
            case 'color-lime':
                document.execCommand('foreColor', false, '#7fff00');
                this.setStatus('文字色: 黄緑');
                break;
            case 'color-cyan':
                document.execCommand('foreColor', false, '#00ffff');
                this.setStatus('文字色: 水色');
                break;
            case 'color-yellow':
                document.execCommand('foreColor', false, '#ffff00');
                this.setStatus('文字色: 黄色');
                break;
            case 'color-white':
                document.execCommand('foreColor', false, '#ffffff');
                this.setStatus('文字色: 白');
                break;
            case 'color-custom':
                this.customColor();
                break;

            // 書式
            case 'format-indent':
                document.execCommand('indent');
                this.setStatus('字下げしました');
                break;
            case 'align-left':
                document.execCommand('justifyLeft');
                this.setStatus('行頭揃え');
                break;
            case 'align-center':
                document.execCommand('justifyCenter');
                this.setStatus('中央揃え');
                break;
            case 'align-right':
                document.execCommand('justifyRight');
                this.setStatus('行末揃え');
                break;
            case 'ruby-top':
                this.insertRuby('0');
                break;
            case 'ruby-bottom':
                this.insertRuby('1');
                break;
            case 'format-pagebreak':
                this.insertPageBreak();
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

            default:
                if (action.startsWith('size-')) {
                    const size = action.replace('size-', '');
                    document.execCommand('fontSize', false, '7'); // ダミーサイズを設定
                    const fontElements = document.querySelectorAll('font[size="7"]');
                    fontElements.forEach(el => {
                        el.removeAttribute('size');
                        el.style.fontSize = size + 'pt';
                    });
                    this.updateParagraphLineHeight(); // 段落のline-heightを更新
                    this.setStatus(`文字サイズ: ${size}pt`);
                } else {
                    console.log('[EDITOR] 未実装のアクション:', action);
                    this.setStatus(`未実装: ${action}`);
                }
        }
    }

    /**
     * XML直接表示モード
     */
    viewXMLMode() {
        // XMLモードでない場合（清書モードまたは初期状態）、エディタの内容をXMLに変換
        if (this.viewMode !== 'xml') {
            this.tadData = this.convertEditorToXML();
        }

        if (this.tadData) {
            this.editor.innerHTML = '<pre style="white-space: pre-wrap; word-wrap: break-word; font-family: monospace; font-size: 12px; padding: 10px; background: #f5f5f5; border: 1px solid #ddd; border-radius: 4px;">' +
                this.escapeHtml(this.tadData) +
                '</pre>';
            this.viewMode = 'xml';
            this.setStatus('原稿（XML直接表示）モード');
        }
    }

    /**
     * 清書モード
     */
    async viewFormattedMode() {
        console.log('[EDITOR] viewFormattedMode開始, 現在のモード:', this.viewMode);
        
        // XMLモードの場合、エディタの内容をXMLに変換してtadDataを更新
        if (this.viewMode === 'xml') {
            // XMLモード時はエディタにXMLテキストが表示されているので、それをtadDataに保存
            const preElement = this.editor.querySelector('pre');
            if (preElement) {
                const rawText = preElement.textContent;
                console.log('[EDITOR] preElement.textContent取得, 長さ:', rawText.length);
                console.log('[EDITOR] 最初の200文字:', rawText.substring(0, 200));
                
                this.tadData = rawText;  // textContentは既にデコード済みなのでdecodeHtmlは不要
                
                console.log('[EDITOR] tadData更新完了, 長さ:', this.tadData.length);
                console.log('[EDITOR] tadDataプレビュー:', this.tadData.substring(0, 200));
            } else {
                console.error('[EDITOR] pre要素が見つかりません');
            }
        } else {
            // 清書モードまたは初期状態の場合、エディタの内容をXMLに変換
            console.log('[EDITOR] 清書モードから変換');
            this.tadData = this.convertEditorToXML();
        }

        if (this.tadData) {
            console.log('[EDITOR] renderTADXML呼び出し, tadData長さ:', this.tadData.length);
            this.renderTADXML(this.tadData);
            this.viewMode = 'formatted';
            this.setStatus('清書モード');
        } else {
            console.error('[EDITOR] tadDataが空です');
            this.editor.innerHTML = '<p>XMLデータがありません</p>';
        }
    }

    /**
     * 全画面表示切り替え
     */
    toggleFullscreen() {
        // 親ウィンドウ（tadjs-desktop.js）にメッセージを送信してウィンドウを最大化/元に戻す
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: 'toggle-maximize'
            }, '*');

            this.isFullscreen = !this.isFullscreen;
            this.setStatus(this.isFullscreen ? '全画面表示ON' : '全画面表示OFF');
        } else {
            // 親ウィンドウがない場合は従来のフルスクリーンAPIを使用
            const container = document.querySelector('.editor-container');
            if (!this.isFullscreen) {
                if (container.requestFullscreen) {
                    container.requestFullscreen();
                } else if (container.webkitRequestFullscreen) {
                    container.webkitRequestFullscreen();
                }
                this.isFullscreen = true;
                this.setStatus('全画面表示ON');
            } else {
                if (document.exitFullscreen) {
                    document.exitFullscreen();
                } else if (document.webkitExitFullscreen) {
                    document.webkitExitFullscreen();
                }
                this.isFullscreen = false;
                this.setStatus('全画面表示OFF');
            }
        }
    }

    /**
     * 再表示
     */
    refresh() {
        if (this.viewMode === 'xml') {
            this.viewXMLMode();
        } else {
            this.viewFormattedMode();
        }
        this.setStatus('再表示しました');
    }

    /**
     * 背景色変更
     */
    async changeBgColor() {
        // 現在の背景色を取得
        const currentBgColor = (this.currentFile && this.currentFile.windowConfig && this.currentFile.windowConfig.backgroundColor)
            ? this.currentFile.windowConfig.backgroundColor
            : '#ffffff';

        const color = await this.showInputDialog('背景色を入力してください（例: #ffffff, white）', currentBgColor, 20);
        if (color) {
            this.editor.style.backgroundColor = color;
            this.setStatus(`背景色を${color}に変更しました`);

            // 親ウィンドウに背景色更新を通知（管理用セグメントに保存）
            if (window.parent && window.parent !== window && this.realId) {
                window.parent.postMessage({
                    type: 'update-background-color',
                    fileId: this.realId,
                    backgroundColor: color
                }, '*');
                console.log('[EDITOR] 背景色更新を親ウィンドウに通知:', this.realId, color);
            }

            // this.currentFileを更新（再表示時に正しい色を適用するため）
            if (this.currentFile) {
                if (!this.currentFile.windowConfig) {
                    this.currentFile.windowConfig = {};
                }
                this.currentFile.windowConfig.backgroundColor = color;
            }
        }
    }

    /**
     * 折り返し切り替え
     */
    toggleWrap() {
        this.wrapMode = !this.wrapMode;
        if (this.wrapMode) {
            this.editor.style.whiteSpace = 'pre-wrap';
            this.editor.style.wordWrap = 'break-word';
            this.setStatus('ウインドウ幅で折り返し: ON');
        } else {
            this.editor.style.whiteSpace = 'pre';
            this.editor.style.wordWrap = 'normal';
            this.setStatus('ウインドウ幅で折り返し: OFF');
        }

        // 折り返しモード変更後に高さを更新
        setTimeout(() => this.updateContentHeight(), 100);
    }

    /**
     * 検索/置換
     */
    async findReplace() {
        const searchText = await this.showInputDialog('検索する文字列を入力してください', '', 30);
        if (searchText) {
            const replaceText = await this.showInputDialog('置換後の文字列を入力してください（キャンセルで検索のみ）', '', 30);
            const content = this.editor.innerHTML;

            if (replaceText !== null) {
                const newContent = content.split(searchText).join(replaceText);
                this.editor.innerHTML = newContent;
                this.setStatus(`"${searchText}" を "${replaceText}" に置換しました`);
            } else {
                if (content.includes(searchText)) {
                    this.setStatus(`"${searchText}" が見つかりました`);
                } else {
                    this.setStatus(`"${searchText}" は見つかりませんでした`);
                }
            }
        }
    }

    /**
     * 書体一覧表示
     */
    showFontList() {
        const fonts = [
            'ゴシック (sans-serif)',
            '明朝 (serif)',
            'メイリオ (Meiryo)',
            'MS ゴシック (MS Gothic)',
            'MS 明朝 (MS Mincho)',
            '游ゴシック (Yu Gothic)',
            '游明朝 (Yu Mincho)'
        ];
        alert('利用可能な書体:\n\n' + fonts.join('\n'));
    }

    /**
     * フォント適用
     */
    applyFont(fontFamily) {
        document.execCommand('fontName', false, fontFamily);
        this.setStatus(`書体を変更しました: ${fontFamily}`);
    }

    /**
     * 書式クリア
     */
    clearFormatting() {
        const selection = window.getSelection();
        if (!selection.rangeCount) {
            this.setStatus('テキストを選択してください');
            return;
        }

        const range = selection.getRangeAt(0);
        
        // 選択範囲のテキストを取得
        const selectedText = range.toString();
        
        if (!selectedText) {
            this.setStatus('テキストを選択してください');
            return;
        }

        // 選択範囲を削除して、プレーンテキストとして再挿入
        range.deleteContents();
        const textNode = document.createTextNode(selectedText);
        range.insertNode(textNode);
        
        // カーソル位置をテキストの後ろに移動
        range.setStartAfter(textNode);
        range.setEndAfter(textNode);
        selection.removeAllRanges();
        selection.addRange(range);
        
        this.setStatus('書式を解除しました');
    }

    /**
     * 袋文字
     */
    applyBagchar() {
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const bagchar = document.createElement('bagchar');
            range.surroundContents(bagchar);
            this.setStatus('袋文字を適用しました');
        }
    }

    /**
     * 枠囲み
     */
    applyBox() {
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const box = document.createElement('box');
            range.surroundContents(box);
            this.setStatus('枠囲みを適用しました');
        }
    }

    /**
     * 影付き
     */
    applyTextShadow() {
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const span = document.createElement('span');
            span.style.textShadow = '2px 2px 4px #00000080';
            range.surroundContents(span);
            this.setStatus('影付きを適用しました');
        }
    }

    /**
     * 網掛
     */
    applyHatched() {
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const mesh = document.createElement('mesh');
            range.surroundContents(mesh);
            this.setStatus('網掛を適用しました');
        }
    }

    /**
     * 反転
     */
    applyInverse() {
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const invert = document.createElement('invert');
            range.surroundContents(invert);
            this.setStatus('反転を適用しました');
        }
    }

    /**
     * 下線
     */
    applyUnderline() {
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const underline = document.createElement('underline');
            range.surroundContents(underline);
            this.setStatus('下線を適用しました');
        }
    }

    /**
     * 上線
     */
    applyOverline() {
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const overline = document.createElement('overline');
            range.surroundContents(overline);
            this.setStatus('上線を適用しました');
        }
    }

    /**
     * 取り消し線
     */
    applyStrikethrough() {
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const strikethrough = document.createElement('strikethrough');
            range.surroundContents(strikethrough);
            this.setStatus('取り消し線を適用しました');
        }
    }

    /**
     * 無印字
     */
    applyNoprint() {
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const noprint = document.createElement('noprint');
            range.surroundContents(noprint);
            this.setStatus('無印字を適用しました');
        }
    }

    /**
     * カスタム文字サイズ
     */
    async customFontSize() {
        const size = await this.showInputDialog('文字サイズを入力してください（pt）', '14', 10);
        if (size && !isNaN(size)) {
            document.execCommand('fontSize', false, '7');
            const fontElements = document.querySelectorAll('font[size="7"]');
            fontElements.forEach(el => {
                el.removeAttribute('size');
                el.style.fontSize = size + 'pt';
            });
            this.updateParagraphLineHeight(); // 段落のline-heightを更新
            this.setStatus(`文字サイズ: ${size}pt`);
        }
    }

    /**
     * 現在の段落のline-heightを最大フォントサイズに基づいて更新
     */
    updateParagraphLineHeight() {
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);

            // 現在の段落要素を取得
            let paragraph = range.commonAncestorContainer;
            while (paragraph && paragraph.nodeName !== 'P' && paragraph !== this.editor) {
                paragraph = paragraph.parentElement;
            }

            if (paragraph && paragraph.nodeName === 'P') {
                // 段落内のすべてのフォントサイズを取得
                let maxFontSize = 14; // デフォルト

                // 段落自体のフォントサイズ
                const pStyle = window.getComputedStyle(paragraph);
                if (pStyle.fontSize) {
                    maxFontSize = parseFloat(pStyle.fontSize);
                }

                // 段落内のすべてのfont要素を確認
                const fontElements = paragraph.querySelectorAll('font[style*="font-size"]');
                fontElements.forEach(el => {
                    const size = parseFloat(el.style.fontSize);
                    if (!isNaN(size) && size > maxFontSize) {
                        maxFontSize = size;
                    }
                });

                // line-heightを設定
                const lineHeight = maxFontSize * 1.5;
                paragraph.style.lineHeight = `${lineHeight}px`;
            }
        }
    }

    /**
     * 全角変換
     */
    applyFullWidth() {
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const text = selection.toString();
            const fullwidth = this.toFullWidth(text);
            document.execCommand('insertText', false, fullwidth);
            this.setStatus('全角に変換しました');
        }
    }

    /**
     * 半角変換
     */
    applyHalfWidth() {
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const text = selection.toString();
            const halfwidth = this.toHalfWidth(text);
            document.execCommand('insertText', false, halfwidth);
            this.setStatus('半角に変換しました');
        }
    }

    /**
     * 全角変換ヘルパー
     */
    toFullWidth(str) {
        return str.replace(/[!-~]/g, (char) => {
            return String.fromCharCode(char.charCodeAt(0) + 0xFEE0);
        });
    }

    /**
     * 半角変換ヘルパー
     */
    toHalfWidth(str) {
        return str.replace(/[！-～]/g, (char) => {
            return String.fromCharCode(char.charCodeAt(0) - 0xFEE0);
        });
    }

    /**
     * カスタム文字色
     */
    async customColor() {
        const color = await this.showInputDialog('文字色を入力してください（例: #ff0000, #000000）', '#000000', 20);
        if (color) {
            document.execCommand('foreColor', false, color);
            this.setStatus(`文字色: ${color}`);
        }
    }

    /**
     * 改ページ挿入
     */
    insertPageBreak() {
        const pageBreak = document.createElement('div');
        pageBreak.style.pageBreakAfter = 'always';
        pageBreak.style.borderBottom = '2px dashed #ccc';
        pageBreak.style.margin = '20px 0';
        pageBreak.style.padding = '10px 0';
        pageBreak.textContent = '--- 改ページ ---';

        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            range.insertNode(pageBreak);
            this.setStatus('改ページを挿入しました');
        }
    }

    /**
     * ルビ挿入・編集・削除
     * @param {string} position - "0"で上側、"1"で下側
     */
    async insertRuby(position) {
        const selection = window.getSelection();
        if (selection.rangeCount === 0 || selection.isCollapsed) {
            this.setStatus('テキストを選択してからルビを挿入してください');
            return;
        }

        const range = selection.getRangeAt(0);

        // 選択範囲内に既存のrubyタグがあるかチェック
        const container = range.commonAncestorContainer;
        let existingRuby = null;

        if (container.nodeType === Node.ELEMENT_NODE && container.nodeName.toLowerCase() === 'ruby') {
            existingRuby = container;
        } else if (container.parentNode && container.parentNode.nodeName.toLowerCase() === 'ruby') {
            existingRuby = container.parentNode;
        }

        // 既存のルビがある場合は現在のtext属性を取得
        const currentRubyText = existingRuby ? existingRuby.getAttribute('text') || '' : '';

        const rubyText = await this.showInputDialog('ルビを入力してください（空欄で削除）:', currentRubyText, 30);

        // キャンセルされた場合は何もしない
        if (rubyText === null) {
            return;
        }

        // 既存のルビタグがある場合
        if (existingRuby) {
            if (rubyText === '') {
                // 空文字列の場合はルビタグを削除
                const textContent = existingRuby.textContent;
                const textNode = document.createTextNode(textContent);
                existingRuby.parentNode.replaceChild(textNode, existingRuby);
                this.setStatus('ルビを削除しました');
            } else {
                // ルビテキストを更新
                existingRuby.setAttribute('text', rubyText);
                existingRuby.setAttribute('position', position);
                
                // 既存の<rt>または<rtc>を削除して再作成
                const oldRt = existingRuby.querySelector('rt, rtc');
                if (oldRt) {
                    oldRt.remove();
                }
                
                // 新しい<rt>または<rtc>を作成
                if (position === '0') {
                    const rt = document.createElement('rt');
                    rt.textContent = rubyText;
                    existingRuby.appendChild(rt);
                } else {
                    const rtc = document.createElement('rtc');
                    rtc.style.rubyPosition = 'under';
                    rtc.textContent = rubyText;
                    existingRuby.appendChild(rtc);
                }
                
                this.setStatus('ルビを更新しました');
            }
        } else {
            // 新規ルビタグを作成
            if (rubyText !== '') {
                const selectedText = range.toString();
                const ruby = document.createElement('ruby');
                ruby.setAttribute('position', position);
                ruby.setAttribute('text', rubyText);

                // ベーステキストを追加
                ruby.textContent = selectedText;

                // <rt>または<rtc>を作成して追加
                if (position === '0') {
                    // 上側ルビ
                    const rt = document.createElement('rt');
                    rt.textContent = rubyText;
                    ruby.appendChild(rt);
                } else {
                    // 下側ルビ
                    const rtc = document.createElement('rtc');
                    rtc.style.rubyPosition = 'under';
                    rtc.textContent = rubyText;
                    ruby.appendChild(rtc);
                }

                range.deleteContents();
                range.insertNode(ruby);

                this.setStatus(position === '0' ? 'ルビ（上）を挿入しました' : 'ルビ（下）を挿入しました');
            }
            // rubyTextが空文字列の場合は何もしない
        }
    }

    /**
     * ウィンドウ設定（位置・サイズ・最大化状態）を更新
     * @param {Object} windowConfig - { pos: {x, y}, width, height, maximize }
     */
    updateWindowConfig(windowConfig) {
        if (window.parent && window.parent !== window && this.realId) {
            window.parent.postMessage({
                type: 'update-window-config',
                fileId: this.realId,
                windowConfig: windowConfig
            }, '*');

            console.log('[EDITOR] ウィンドウ設定を更新:', windowConfig);
        }
    }

    /**
     * ウィンドウクローズ要求を処理
     * 編集中の場合は保存確認ダイアログを表示
     * @param {string} windowId - ウィンドウID
     */
    async handleCloseRequest(windowId) {
        console.log('[EDITOR] クローズ要求受信, isModified:', this.isModified);

        if (this.isModified) {
            // 編集中の場合、保存確認ダイアログを表示
            const result = await this.showSaveConfirmDialog();
            console.log('[EDITOR] 保存確認ダイアログ結果:', result);

            if (result === 'cancel') {
                // 取消: クローズをキャンセル
                this.respondCloseRequest(windowId, false);
            } else if (result === 'no') {
                // 保存しない: そのままクローズ
                this.respondCloseRequest(windowId, true);
            } else if (result === 'yes') {
                // 保存: 保存してからクローズ
                this.notifyXmlDataChanged();
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
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: 'window-close-response',
                windowId: windowId,
                allowClose: allowClose
            }, '*');
        }
    }

    /**
     * ウィンドウを閉じるリクエストを送信
     */
    requestCloseWindow() {
        if (window.parent && window.parent !== window) {
            // 親ウィンドウのiframe要素からwindowIdを取得
            const windowElement = window.frameElement ? window.frameElement.closest('.window') : null;
            const windowId = windowElement ? windowElement.id : null;

            if (windowId) {
                window.parent.postMessage({
                    type: 'close-window',
                    windowId: windowId
                }, '*');
            }
        }
    }

    /**
     * 保存確認ダイアログを表示
     * @returns {Promise<string>} 'yes', 'no', 'cancel'
     */
    async showSaveConfirmDialog() {
        return new Promise((resolve) => {
            const messageId = `save-confirm-${++this.dialogMessageId}`;

            // コールバックを登録
            this.dialogCallbacks[messageId] = (result) => {
                resolve(result);
            };

            // 親ウィンドウにダイアログ表示を要求
            if (window.parent && window.parent !== window) {
                window.parent.postMessage({
                    type: 'show-save-confirm-dialog',
                    messageId: messageId,
                    message: '保存してから閉じますか？',
                    buttons: [
                        { label: '取消', value: 'cancel' },
                        { label: '保存しない', value: 'no' },
                        { label: '保存', value: 'yes' }
                    ]
                }, '*');
            }
        });
    }

    /**
     * 次の画像番号を取得
     */
    getNextImageNumber() {
        // エディタ内のすべての画像要素から最大のimgNoを取得
        let maxImgNo = -1;
        const images = this.editor.querySelectorAll('img[data-img-no]');
        images.forEach(img => {
            const imgNo = parseInt(img.getAttribute('data-img-no'));
            if (!isNaN(imgNo) && imgNo > maxImgNo) {
                maxImgNo = imgNo;
            }
        });
        return maxImgNo + 1;
    }

    /**
     * 画像ファイルを保存
     */
    /**
     * 親ウィンドウから画像ファイルを読み込んで表示
     */
    loadImagesFromParent() {
        // data-needs-load="true" 属性を持つすべての画像を取得
        const images = this.editor.querySelectorAll('img[data-needs-load="true"]');

        console.log('[EDITOR] 読み込みが必要な画像数:', images.length);

        images.forEach((img) => {
            const fileName = img.getAttribute('data-saved-filename');
            if (fileName && !fileName.startsWith('data:')) {
                console.log('[EDITOR] 画像読み込み要求:', fileName);

                // 親ウィンドウに画像読み込みを依頼
                const messageId = `load-image-${Date.now()}-${Math.random()}`;

                // レスポンスハンドラを設定
                const handleResponse = (event) => {
                    if (event.data.type === 'load-image-response' && event.data.messageId === messageId) {
                        window.removeEventListener('message', handleResponse);

                        if (event.data.success && event.data.imageData) {
                            // Uint8Arrayに変換
                            const uint8Array = new Uint8Array(event.data.imageData);

                            // Blobを作成
                            const blob = new Blob([uint8Array], { type: event.data.mimeType || 'image/png' });

                            // data: URLを作成
                            const reader = new FileReader();
                            reader.onload = () => {
                                img.src = reader.result;
                                img.removeAttribute('data-needs-load');

                                // 画像読み込み完了後に元のサイズを設定（リサイズ用）
                                img.onload = () => {
                                    if (!img.getAttribute('data-original-width')) {
                                        img.setAttribute('data-original-width', img.naturalWidth);
                                        img.setAttribute('data-original-height', img.naturalHeight);
                                        console.log('[EDITOR] 元のサイズを設定:', img.naturalWidth, 'x', img.naturalHeight);
                                    }
                                };

                                console.log('[EDITOR] 画像読み込み成功:', fileName);
                            };
                            reader.readAsDataURL(blob);
                        } else {
                            console.error('[EDITOR] 画像読み込み失敗:', fileName, event.data.error);
                            img.alt = `画像が見つかりません: ${fileName}`;
                        }
                    }
                };

                window.addEventListener('message', handleResponse);

                // 親ウィンドウに読み込み要求を送信
                window.parent.postMessage({
                    type: 'load-image-file',
                    fileName: fileName,
                    messageId: messageId
                }, '*');
            }
        });
    }

    async saveImageFile(file, fileName) {
        try {
            // ArrayBufferとして読み込み
            const arrayBuffer = await file.arrayBuffer();
            const buffer = new Uint8Array(arrayBuffer);

            // 親ウィンドウにファイル保存を依頼
            window.parent.postMessage({
                type: 'save-image-file',
                fileName: fileName,
                imageData: Array.from(buffer),
                mimeType: file.type
            }, '*');

            console.log('[EDITOR] 画像ファイル保存完了:', fileName);
        } catch (error) {
            console.error('[EDITOR] 画像ファイル保存エラー:', error);
            throw error;
        }
    }

    /**
     * 画像を選択
     */
    selectImage(img) {
        // 既存の選択を解除
        this.deselectImage();

        // 画像を選択状態にする
        this.selectedImage = img;

        // 選択枠のスタイルを追加
        img.style.outline = '2px solid #0078d4';
        img.style.outlineOffset = '2px';
        img.style.position = 'relative';
        img.style.cursor = 'move';

        // 画像のドラッグイベントを設定
        img.draggable = true;
        img.addEventListener('dragstart', (e) => {
            e.dataTransfer.effectAllowed = 'move';
            this.isDraggingImage = true;
            this.draggingImage = img;  // ドラッグ中の画像要素を保存
            this.dragStartX = e.clientX;
            this.dragStartY = e.clientY;

            // 画像の現在のサイズを保存（単位付き文字列で統一）
            const currentWidth = img.style.width || (img.width + 'px');
            const currentHeight = img.style.height || (img.height + 'px');
            img.setAttribute('data-current-width', currentWidth);
            img.setAttribute('data-current-height', currentHeight);
            console.log('[EDITOR] ドラッグ開始時のサイズを保存:', currentWidth, currentHeight);

            console.log('[EDITOR] 画像ドラッグ開始');
        });

        // 画像の右クリックイベントを設定
        img.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            // 右クリックされた画像の情報を保存（メニュー生成時に使用）
            this.contextMenuSelectedImage = img;
            console.log('[EDITOR] 画像右クリック:', img.getAttribute('data-saved-filename'));

            // 親ウィンドウに右クリック位置を通知してメニューを表示
            if (window.parent && window.parent !== window) {
                const rect = window.frameElement.getBoundingClientRect();
                window.parent.postMessage({
                    type: 'context-menu-request',
                    x: rect.left + e.clientX,
                    y: rect.top + e.clientY
                }, '*');
            }
        });

        // リサイズハンドルを作成
        this.createResizeHandle(img);

        console.log('[EDITOR] 画像を選択:', img.getAttribute('data-saved-filename'));
    }

    /**
     * 画像の選択を解除
     */
    deselectImage() {
        if (this.selectedImage) {
            // 選択枠を削除
            this.selectedImage.style.outline = '';
            this.selectedImage.style.outlineOffset = '';
            this.selectedImage.style.cursor = '';

            // リサイズハンドルを削除
            this.removeResizeHandle();

            console.log('[EDITOR] 画像の選択を解除');
            this.selectedImage = null;
        }
    }

    /**
     * リサイズハンドルを作成
     */
    createResizeHandle(img) {
        // 既存のハンドルを削除
        this.removeResizeHandle();

        // リサイズハンドルを作成
        const handle = document.createElement('div');
        handle.id = 'image-resize-handle';
        handle.style.position = 'absolute';
        handle.style.width = '10px';
        handle.style.height = '10px';
        handle.style.backgroundColor = '#0078d4';
        handle.style.border = '1px solid white';
        handle.style.cursor = 'nwse-resize';
        handle.style.zIndex = '1000';

        // 画像の右下に配置
        const rect = img.getBoundingClientRect();
        const editorRect = this.editor.getBoundingClientRect();
        handle.style.left = (rect.right - editorRect.left - 5) + 'px';
        handle.style.top = (rect.bottom - editorRect.top - 5) + 'px';

        // ハンドルのドラッグイベント
        handle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.startResize(e, img);
        });

        // エディタに追加
        this.editor.appendChild(handle);
    }

    /**
     * リサイズハンドルを削除
     */
    removeResizeHandle() {
        const handle = document.getElementById('image-resize-handle');
        if (handle) {
            handle.remove();
        }
    }

    /**
     * リサイズを開始
     */
    startResize(e, img) {
        this.isResizing = true;
        this.resizeStartX = e.clientX;
        this.resizeStartY = e.clientY;
        this.resizeStartWidth = img.width;
        this.resizeStartHeight = img.height;

        // 元の縦横比を保存
        const originalWidth = parseFloat(img.getAttribute('data-original-width')) || img.naturalWidth;
        const originalHeight = parseFloat(img.getAttribute('data-original-height')) || img.naturalHeight;
        this.imageAspectRatio = originalWidth / originalHeight;

        console.log('[EDITOR] リサイズ開始:', this.resizeStartWidth, 'x', this.resizeStartHeight, 'ratio:', this.imageAspectRatio);

        // マウス移動とマウスアップのイベントリスナー
        const handleMouseMove = (e) => {
            if (this.isResizing) {
                this.handleResize(e, img);
            }
        };

        const handleMouseUp = () => {
            this.isResizing = false;
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);

            // リサイズ後のサイズを保存（次回のドラッグ時に使用）
            const currentWidth = img.style.width || (img.width + 'px');
            const currentHeight = img.style.height || (img.height + 'px');
            img.setAttribute('data-current-width', currentWidth);
            img.setAttribute('data-current-height', currentHeight);

            console.log('[EDITOR] リサイズ終了、サイズを保存:', currentWidth, currentHeight);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    }

    /**
     * リサイズ処理
     */
    handleResize(e, img) {
        const deltaX = e.clientX - this.resizeStartX;
        const deltaY = e.clientY - this.resizeStartY;

        // X方向の変化を基準に、縦横比を維持したサイズを計算
        let newWidth = this.resizeStartWidth + deltaX;

        // 最小サイズを設定
        if (newWidth < 50) {
            newWidth = 50;
        }

        // 縦横比を維持して高さを計算
        const newHeight = newWidth / this.imageAspectRatio;

        // 画像のサイズを変更
        img.style.width = newWidth + 'px';
        img.style.height = newHeight + 'px';

        // リサイズハンドルの位置を更新
        const handle = document.getElementById('image-resize-handle');
        if (handle) {
            const rect = img.getBoundingClientRect();
            const editorRect = this.editor.getBoundingClientRect();
            handle.style.left = (rect.right - editorRect.left - 5) + 'px';
            handle.style.top = (rect.bottom - editorRect.top - 5) + 'px';
        }

        // 編集状態を記録
        this.isModified = true;
    }

    /**
     * 画像をカーソル位置に移動
     */
    async moveImageToCursor(e, img) {
        console.log('[EDITOR] 画像移動開始');

        // ドロップ位置のカーソル位置を取得
        const x = e.clientX;
        const y = e.clientY;

        let range;
        if (document.caretRangeFromPoint) {
            range = document.caretRangeFromPoint(x, y);
        } else if (document.caretPositionFromPoint) {
            const position = document.caretPositionFromPoint(x, y);
            range = document.createRange();
            range.setStart(position.offsetNode, position.offset);
        }

        if (!range) {
            console.error('[EDITOR] カーソル位置を取得できませんでした');
            return;
        }

        // 画像の現在のサイズを取得（単位付き文字列で統一）
        const currentWidth = img.getAttribute('data-current-width') || img.style.width || (img.width + 'px');
        const currentHeight = img.getAttribute('data-current-height') || img.style.height || (img.height + 'px');

        console.log('[EDITOR] 移動時のサイズを復元:', currentWidth, currentHeight);

        // 画像を現在の位置から削除（必要な属性を先に取得）
        const savedFilename = img.getAttribute('data-saved-filename');
        const altText = img.alt;
        const originalWidth = img.getAttribute('data-original-width');
        const originalHeight = img.getAttribute('data-original-height');
        const planes = img.getAttribute('data-planes');
        const pixbits = img.getAttribute('data-pixbits');
        const imgNo = img.getAttribute('data-img-no');
        const mimeType = img.getAttribute('data-mime-type');
        img.remove();

        // リサイズハンドルも削除
        this.removeResizeHandle();

        // 新しい画像要素を作成
        const newImg = document.createElement('img');
        newImg.src = savedFilename && savedFilename.startsWith('data:') ? savedFilename : '';
        newImg.alt = altText;
        newImg.style.width = currentWidth;
        newImg.style.height = currentHeight;
        newImg.setAttribute('data-saved-filename', savedFilename);
        // サイズを保存（次回の移動時に使用）
        newImg.setAttribute('data-current-width', currentWidth);
        newImg.setAttribute('data-current-height', currentHeight);
        // 元の画像の属性をコピー（リサイズ比率の維持と画像読み込みに必要）
        if (originalWidth) newImg.setAttribute('data-original-width', originalWidth);
        if (originalHeight) newImg.setAttribute('data-original-height', originalHeight);
        if (planes) newImg.setAttribute('data-planes', planes);
        if (pixbits) newImg.setAttribute('data-pixbits', pixbits);
        if (imgNo) newImg.setAttribute('data-img-no', imgNo);
        if (mimeType) newImg.setAttribute('data-mime-type', mimeType);
        newImg.draggable = false;  // ドラッグ中は一時的に無効化

        // カーソル位置に挿入
        range.insertNode(newImg);

        // 画像の後にスペースを追加（カーソル移動のため）
        const space = document.createTextNode(' ');
        newImg.parentNode.insertBefore(space, newImg.nextSibling);

        // 画像を選択状態にする
        this.selectImage(newImg);

        // data: URLが必要な場合は読み込み
        if (savedFilename && !savedFilename.startsWith('data:')) {
            newImg.setAttribute('data-needs-load', 'true');
            this.loadImagesFromParent();
        }

        // 編集状態を記録
        this.isModified = true;

        console.log('[EDITOR] 画像移動完了:', savedFilename);
    }

    /**
     * ドロップカーソルを表示
     */
    showDropCursor(x, y) {
        // エディタの位置を取得
        const editorRect = this.editor.getBoundingClientRect();

        // エディタ内の相対座標に変換
        const relativeX = x - editorRect.left + this.editor.scrollLeft;
        const relativeY = y - editorRect.top + this.editor.scrollTop;

        // カーソル位置を取得
        let range;
        if (document.caretRangeFromPoint) {
            range = document.caretRangeFromPoint(x, y);
        } else if (document.caretPositionFromPoint) {
            const position = document.caretPositionFromPoint(x, y);
            if (position) {
                range = document.createRange();
                range.setStart(position.offsetNode, position.offset);
            }
        }

        if (!range) {
            return;
        }

        // カーソルインジケータが存在しない場合は作成
        let indicator = document.getElementById('drop-cursor-indicator');
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.id = 'drop-cursor-indicator';
            indicator.style.position = 'absolute';
            indicator.style.width = '2px';
            indicator.style.height = '1.2em';
            indicator.style.backgroundColor = '#0078d4';
            indicator.style.pointerEvents = 'none';
            indicator.style.zIndex = '10000';
            indicator.style.transition = 'left 0.05s, top 0.05s';
            this.editor.appendChild(indicator);
        }

        // カーソル位置にインジケータを配置
        const rects = range.getClientRects();
        if (rects.length > 0) {
            const rect = rects[0];
            indicator.style.left = (rect.left - editorRect.left + this.editor.scrollLeft) + 'px';
            indicator.style.top = (rect.top - editorRect.top + this.editor.scrollTop) + 'px';
            indicator.style.height = rect.height + 'px';
            indicator.style.display = 'block';
        }
    }

    /**
     * ドロップカーソルを非表示
     */
    hideDropCursor() {
        const indicator = document.getElementById('drop-cursor-indicator');
        if (indicator) {
            indicator.style.display = 'none';
        }
    }

    /**
     * 画像をクリップボードへコピー
     */
    copyImage(img) {
        console.log('[EDITOR] 画像をコピー:', img.getAttribute('data-saved-filename'));

        // 画像の全ての属性を保存
        this.imageClipboard = {
            src: img.src,
            alt: img.alt,
            width: img.style.width,
            height: img.style.height,
            savedFilename: img.getAttribute('data-saved-filename'),
            currentWidth: img.getAttribute('data-current-width'),
            currentHeight: img.getAttribute('data-current-height'),
            originalWidth: img.getAttribute('data-original-width'),
            originalHeight: img.getAttribute('data-original-height'),
            planes: img.getAttribute('data-planes'),
            pixbits: img.getAttribute('data-pixbits'),
            imgNo: img.getAttribute('data-img-no'),
            mimeType: img.getAttribute('data-mime-type'),
            isCut: false  // コピーモード
        };

        console.log('[EDITOR] 画像クリップボード:', this.imageClipboard);
    }

    /**
     * 画像をクリップボードへ移動（カット）
     */
    cutImage(img) {
        console.log('[EDITOR] 画像を移動:', img.getAttribute('data-saved-filename'));

        // 画像の全ての属性を保存
        this.imageClipboard = {
            src: img.src,
            alt: img.alt,
            width: img.style.width,
            height: img.style.height,
            savedFilename: img.getAttribute('data-saved-filename'),
            currentWidth: img.getAttribute('data-current-width'),
            currentHeight: img.getAttribute('data-current-height'),
            originalWidth: img.getAttribute('data-original-width'),
            originalHeight: img.getAttribute('data-original-height'),
            planes: img.getAttribute('data-planes'),
            pixbits: img.getAttribute('data-pixbits'),
            imgNo: img.getAttribute('data-img-no'),
            mimeType: img.getAttribute('data-mime-type'),
            isCut: true  // 移動モード
        };

        // 画像を削除
        this.deselectImage();
        img.remove();

        console.log('[EDITOR] 画像を削除し、クリップボードに保存:', this.imageClipboard);

        // 編集状態を記録
        this.isModified = true;
    }

    /**
     * 画像をクリップボードから貼り付け
     */
    pasteImage() {
        if (!this.imageClipboard) {
            console.warn('[EDITOR] クリップボードに画像がありません');
            return;
        }

        console.log('[EDITOR] 画像を貼り付け:', this.imageClipboard);

        // カーソル位置を取得
        const selection = window.getSelection();
        if (selection.rangeCount === 0) {
            console.warn('[EDITOR] カーソル位置が取得できません');
            return;
        }

        const range = selection.getRangeAt(0);

        // 新しい画像要素を作成
        const newImg = document.createElement('img');
        newImg.src = this.imageClipboard.src;
        newImg.alt = this.imageClipboard.alt;
        newImg.style.width = this.imageClipboard.width;
        newImg.style.height = this.imageClipboard.height;
        newImg.setAttribute('data-saved-filename', this.imageClipboard.savedFilename);
        if (this.imageClipboard.currentWidth) newImg.setAttribute('data-current-width', this.imageClipboard.currentWidth);
        if (this.imageClipboard.currentHeight) newImg.setAttribute('data-current-height', this.imageClipboard.currentHeight);
        if (this.imageClipboard.originalWidth) newImg.setAttribute('data-original-width', this.imageClipboard.originalWidth);
        if (this.imageClipboard.originalHeight) newImg.setAttribute('data-original-height', this.imageClipboard.originalHeight);
        if (this.imageClipboard.planes) newImg.setAttribute('data-planes', this.imageClipboard.planes);
        if (this.imageClipboard.pixbits) newImg.setAttribute('data-pixbits', this.imageClipboard.pixbits);
        if (this.imageClipboard.imgNo) newImg.setAttribute('data-img-no', this.imageClipboard.imgNo);
        if (this.imageClipboard.mimeType) newImg.setAttribute('data-mime-type', this.imageClipboard.mimeType);

        // data: URLが必要な場合は読み込み
        if (this.imageClipboard.savedFilename && !this.imageClipboard.savedFilename.startsWith('data:')) {
            newImg.setAttribute('data-needs-load', 'true');
        }

        // カーソル位置に挿入
        range.insertNode(newImg);

        // 画像の後にスペースを追加（カーソル移動のため）
        const space = document.createTextNode(' ');
        newImg.parentNode.insertBefore(space, newImg.nextSibling);

        // カーソルを画像の後に移動
        const newRange = document.createRange();
        newRange.setStartAfter(space);
        newRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(newRange);

        // 画像を読み込む
        if (this.imageClipboard.savedFilename && !this.imageClipboard.savedFilename.startsWith('data:')) {
            this.loadImagesFromParent();
        }

        // 画像を選択
        this.selectImage(newImg);

        // 移動モードの場合はクリップボードをクリア
        if (this.imageClipboard.isCut) {
            this.imageClipboard = null;
            console.log('[EDITOR] 移動モードのためクリップボードをクリア');
        }

        console.log('[EDITOR] 画像貼り付け完了');

        // 編集状態を記録
        this.isModified = true;
    }

    /**
     * 仮身をクリップボードへコピー
     */
    copyVirtualObject(vo) {
        console.log('[EDITOR] 仮身をコピー:', vo.dataset.linkName);

        // 仮身の全ての属性を保存
        const attributes = {};
        for (const attr in vo.dataset) {
            if (attr.startsWith('link')) {
                attributes[attr] = vo.dataset[attr];
            }
        }

        this.virtualObjectClipboard = {
            attributes: attributes,
            textContent: vo.textContent,
            style: vo.getAttribute('style'),
            isCut: false  // コピーモード
        };

        console.log('[EDITOR] 仮身クリップボード:', this.virtualObjectClipboard);
    }

    /**
     * 仮身をクリップボードへ移動（カット）
     */
    cutVirtualObject(vo) {
        console.log('[EDITOR] 仮身を移動:', vo.dataset.linkName);

        // 仮身の全ての属性を保存
        const attributes = {};
        for (const attr in vo.dataset) {
            if (attr.startsWith('link')) {
                attributes[attr] = vo.dataset[attr];
            }
        }

        this.virtualObjectClipboard = {
            attributes: attributes,
            textContent: vo.textContent,
            style: vo.getAttribute('style'),
            isCut: true  // 移動モード
        };

        // 仮身を削除
        vo.classList.remove('selected');
        this.selectedVirtualObject = null;
        vo.remove();

        console.log('[EDITOR] 仮身を削除し、クリップボードに保存:', this.virtualObjectClipboard);

        // 編集状態を記録
        this.isModified = true;
    }

    /**
     * 仮身をクリップボードから貼り付け
     */
    pasteVirtualObject() {
        if (!this.virtualObjectClipboard) {
            console.warn('[EDITOR] クリップボードに仮身がありません');
            return;
        }

        console.log('[EDITOR] 仮身を貼り付け:', this.virtualObjectClipboard);

        // カーソル位置を取得
        const selection = window.getSelection();
        if (selection.rangeCount === 0) {
            console.warn('[EDITOR] カーソル位置が取得できません');
            return;
        }

        const range = selection.getRangeAt(0);

        // 新しい仮身要素を作成
        const newVo = document.createElement('span');
        newVo.className = 'virtual-object';
        newVo.contentEditable = 'false'; // カーソルが入らないようにする
        newVo.setAttribute('unselectable', 'on'); // IE互換
        newVo.textContent = this.virtualObjectClipboard.textContent;
        if (this.virtualObjectClipboard.style) {
            newVo.setAttribute('style', this.virtualObjectClipboard.style);
        }
        // user-select スタイルを追加
        newVo.style.userSelect = 'none';
        newVo.style.webkitUserSelect = 'none';
        newVo.style.mozUserSelect = 'none';
        newVo.style.msUserSelect = 'none';

        // data属性を復元
        for (const attr in this.virtualObjectClipboard.attributes) {
            newVo.dataset[attr] = this.virtualObjectClipboard.attributes[attr];
        }

        // カーソル位置に挿入
        range.insertNode(newVo);

        // 仮身の後にスペースを追加（カーソル移動のため）
        const space = document.createTextNode(' ');
        newVo.parentNode.insertBefore(space, newVo.nextSibling);

        // カーソルを仮身の後に移動
        const newRange = document.createRange();
        newRange.setStartAfter(space);
        newRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(newRange);

        // 新しい仮身にイベントハンドラを設定
        this.setupVirtualObjectEventHandlers();

        // 移動モードの場合はクリップボードをクリア
        if (this.virtualObjectClipboard.isCut) {
            this.virtualObjectClipboard = null;
            console.log('[EDITOR] 移動モードのためクリップボードをクリア');
        }

        console.log('[EDITOR] 仮身貼り付け完了');

        // 編集状態を記録
        this.isModified = true;
    }

    /**
     * グローバルクリップボードから仮身をペースト
     */
    async pasteFromGlobalClipboard() {
        console.log('[EDITOR] グローバルクリップボードをチェック中...');

        // 親ウィンドウからグローバルクリップボードを取得
        const globalClipboard = await this.getGlobalClipboard();

        if (globalClipboard && globalClipboard.link_id) {
            // 仮身データがある場合
            console.log('[EDITOR] グローバルクリップボードに仮身があります:', globalClipboard.link_name);
            this.insertVirtualObjectLink(globalClipboard);
            this.setStatus('仮身をクリップボードから貼り付けました');
        } else {
            // 仮身データがない場合は通常のペースト
            document.execCommand('paste');
            this.setStatus('クリップボードから貼り付けました');
        }
    }

    /**
     * 親ウィンドウからグローバルクリップボードを取得
     * @returns {Promise<Object|null>}
     */
    getGlobalClipboard() {
        return new Promise((resolve) => {
            if (!window.parent || window.parent === window) {
                resolve(null);
                return;
            }

            const messageId = `get-clipboard-${Date.now()}-${Math.random()}`;

            const handleMessage = (e) => {
                if (e.data && e.data.type === 'clipboard-data' && e.data.messageId === messageId) {
                    window.removeEventListener('message', handleMessage);
                    resolve(e.data.clipboardData);
                }
            };

            window.addEventListener('message', handleMessage);

            window.parent.postMessage({
                type: 'get-clipboard',
                messageId: messageId
            }, '*');

            // タイムアウト処理（5秒）
            setTimeout(() => {
                window.removeEventListener('message', handleMessage);
                resolve(null);
            }, 5000);
        });
    }

    /**
     * 仮身をドロップ位置にコピー
     */
    async copyVirtualObjectToCursor(e) {
        if (!this.draggingVirtualObjectData) {
            console.warn('[EDITOR] ドラッグ中の仮身データがありません');
            return;
        }

        console.log('[EDITOR] 仮身をドロップ位置にコピー:', this.draggingVirtualObjectData);

        // ドロップ位置にカーソルを移動
        const range = document.caretRangeFromPoint(e.clientX, e.clientY);
        if (!range) {
            console.warn('[EDITOR] ドロップ位置が取得できません');
            return;
        }

        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);

        // 新しい仮身要素を作成
        const newVo = document.createElement('span');
        newVo.className = 'virtual-object';
        newVo.contentEditable = 'false'; // カーソルが入らないようにする
        newVo.setAttribute('unselectable', 'on'); // IE互換
        newVo.textContent = this.draggingVirtualObjectData.textContent;
        if (this.draggingVirtualObjectData.style) {
            newVo.setAttribute('style', this.draggingVirtualObjectData.style);
        }
        // user-select スタイルを追加
        newVo.style.userSelect = 'none';
        newVo.style.webkitUserSelect = 'none';
        newVo.style.mozUserSelect = 'none';
        newVo.style.msUserSelect = 'none';

        // data属性を復元
        for (const attr in this.draggingVirtualObjectData.attributes) {
            newVo.dataset[attr] = this.draggingVirtualObjectData.attributes[attr];
        }

        // ドロップ位置に挿入
        range.insertNode(newVo);

        // 仮身の後にスペースを追加（カーソル移動のため）
        const space = document.createTextNode(' ');
        newVo.parentNode.insertBefore(space, newVo.nextSibling);

        // カーソルを仮身の後に移動
        const newRange = document.createRange();
        newRange.setStartAfter(space);
        newRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(newRange);

        // 新しい仮身にイベントハンドラを設定
        this.setupVirtualObjectEventHandlers();

        console.log('[EDITOR] 仮身ドロップコピー完了');

        // 編集状態を記録
        this.isModified = true;

        // ステータスメッセージを表示
        this.setStatus('仮身をコピーしました');
    }

    /**
     * 仮身データから仮身要素を作成してカーソル位置に挿入
     * （カーソル位置は既に設定されていることを前提）
     */
    async insertVirtualObjectFromData(virtualObjectData) {
        if (!virtualObjectData) {
            console.warn('[EDITOR] 仮身データがありません');
            return;
        }

        console.log('[EDITOR] 仮身をカーソル位置に挿入:', virtualObjectData);

        const selection = window.getSelection();
        if (selection.rangeCount === 0) {
            console.warn('[EDITOR] カーソル位置が設定されていません');
            return;
        }

        const range = selection.getRangeAt(0);

        // 新しい仮身要素を作成
        const newVo = document.createElement('span');
        newVo.className = 'virtual-object';
        newVo.contentEditable = 'false';
        newVo.setAttribute('unselectable', 'on');
        newVo.textContent = virtualObjectData.textContent;
        if (virtualObjectData.style) {
            newVo.setAttribute('style', virtualObjectData.style);
        }

        // user-select スタイルを追加
        newVo.style.userSelect = 'none';
        newVo.style.webkitUserSelect = 'none';
        newVo.style.mozUserSelect = 'none';
        newVo.style.msUserSelect = 'none';

        // data属性を復元
        for (const attr in virtualObjectData.attributes) {
            newVo.dataset[attr] = virtualObjectData.attributes[attr];
        }

        // カーソル位置に挿入
        range.deleteContents();
        range.insertNode(newVo);

        // 仮身の後にスペースを追加（カーソル移動のため）
        const space = document.createTextNode(' ');
        newVo.parentNode.insertBefore(space, newVo.nextSibling);

        // カーソルを仮身の後に移動
        const newRange = document.createRange();
        newRange.setStartAfter(space);
        newRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(newRange);

        // 新しい仮身にイベントハンドラを設定
        this.setupVirtualObjectEventHandlers();

        console.log('[EDITOR] 仮身挿入完了');

        // 編集状態を記録
        this.isModified = true;

        // コンテンツ高さを更新
        this.updateContentHeight();
    }

    /**
     * 仮身を開いた表示に展開
     */
    async expandVirtualObject(vo, width, height) {
        // 既に展開済みの場合はサイズだけ更新
        if (vo.classList.contains('expanded')) {
            const iframe = vo.querySelector('.virtual-object-content');
            if (iframe) {
                const titleBar = vo.querySelector('.virtual-object-titlebar');
                const chsz = parseFloat(vo.dataset.linkChsz) || 14;
                const titleBarHeight = titleBar ? (chsz + 16) : 0;  // タイトルバーがある場合のみ高さを計算
                // vo要素自体のサイズを更新
                vo.style.width = `${width}px`;
                vo.style.height = `${height}px`;
                // iframeのサイズを更新
                iframe.style.width = `${width}px`;
                iframe.style.height = `${height - titleBarHeight}px`; // タイトルバーがある場合のみ分を引く
            }
            return;
        }

        vo.classList.add('expanded');
        console.log('[EDITOR] 仮身を開いた表示に展開:', vo.dataset.linkName);

        // 実身IDを取得
        const linkId = vo.dataset.linkId;
        console.log('[EDITOR] linkId:', linkId);
        let realId = linkId.replace(/\.(xtad|json)$/, '');
        console.log('[EDITOR] 拡張子削除後:', realId);
        realId = realId.replace(/_\d+$/, '');
        console.log('[EDITOR] レコード番号削除後（最終的な実身ID）:', realId);

        try {
            // appListからdefaultOpenを取得
            const appListData = await this.getAppListData(realId);
            if (!appListData) {
                console.warn('[EDITOR] appListの取得に失敗しました, realId:', realId);
                vo.classList.remove('expanded');
                this.setStatus(`仮身の実身情報が見つかりません: ${realId}`);
                return;
            }

            const defaultOpen = this.getDefaultOpenFromAppList(appListData);
            if (!defaultOpen) {
                console.warn('[EDITOR] defaultOpenが設定されていません, realId:', realId);
                vo.classList.remove('expanded');
                this.setStatus(`仮身のデフォルト起動アプリが設定されていません: ${realId}`);
                return;
            }

            console.log('[EDITOR] defaultOpenプラグイン:', defaultOpen);

            // 実身データを読み込む
            const realObjectData = await this.loadRealObjectData(realId);
            if (!realObjectData) {
                console.warn('[EDITOR] 実身データの読み込みに失敗しました, realId:', realId);
                vo.classList.remove('expanded');
                this.setStatus(`実身データの読み込みに失敗しました: ${realId}`);
                return;
            }

            console.log('[EDITOR] 実身データ読み込み完了:', realObjectData);

            // 仮身の内容を保存
            const originalText = vo.textContent;

            // デバッグ：現在のvo要素のスタイルを確認
            console.log('[EDITOR] 開く前のvo要素スタイル:', JSON.stringify({
                fontSize: vo.style.fontSize,
                computedFontSize: window.getComputedStyle(vo).fontSize,
                textContent: originalText
            }, null, 2));

            // 仮身の色属性を取得
            const frcol = vo.dataset.linkFrcol || '#000000';
            const chcol = vo.dataset.linkChcol || '#000000';
            const tbcol = vo.dataset.linkTbcol || '#ffffff';
            const bgcol = vo.dataset.linkBgcol || '#ffffff';
            const chsz = parseFloat(vo.dataset.linkChsz) || 14;

            // 表示項目の設定を取得
            const showFrame = vo.dataset.linkFramedisp !== 'false'; // デフォルトは表示
            const showName = vo.dataset.linkNamedisp !== 'false'; // デフォルトは表示
            const showUpdate = vo.dataset.linkUpdatedisp === 'true'; // デフォルトは非表示
            const showPict = vo.dataset.linkPictdisp !== 'false'; // デフォルトは表示（今後実装予定）
            const showRole = vo.dataset.linkRoledisp === 'true'; // デフォルトは非表示（今後実装予定）
            const showType = vo.dataset.linkTypedisp === 'true'; // デフォルトは非表示（今後実装予定）

            // 全ての表示属性がオフかどうかを判定
            const showTitleBar = showPict || showName || showRole || showType || showUpdate;

            console.log('[EDITOR] 仮身の色属性:', {
                frcol, chcol, tbcol, bgcol, chsz,
                showFrame, showName, showUpdate, showPict, showRole, showType, showTitleBar,
                'vo.dataset.linkBgcol': vo.dataset.linkBgcol,
                'dataset keys': Object.keys(vo.dataset)
            });

            // タイトルバーの高さ = chsz + 16（上下パディング8pxずつ）
            const titleBarHeight = chsz + 16;

            // 仮身の内容をクリア
            vo.innerHTML = '';

            // 仮身全体のスタイルを設定
            vo.style.position = 'relative';
            vo.style.width = `${width}px`;
            vo.style.height = `${height}px`;
            vo.style.boxSizing = 'border-box';
            vo.style.overflow = 'hidden';
            vo.style.display = 'inline-block';
            vo.style.verticalAlign = 'top';
            vo.style.fontSize = ''; // 閉じた仮身のfontSize設定をクリア
            vo.style.padding = ''; // 閉じた仮身のpadding設定をクリア
            vo.style.margin = ''; // 閉じた仮身のmargin設定をクリア
            vo.style.borderRadius = ''; // 閉じた仮身のborderRadius設定をクリア
            vo.style.background = ''; // 閉じた仮身のbackground設定をクリア

            // 全体枠（frcol, 2px）
            if (showFrame) {
                vo.style.border = `2px solid ${frcol}`;
            } else {
                vo.style.border = 'none';
            }

            // タイトルバー（元の仮身枠部分）
            // 全ての表示属性がオフの場合は非表示
            let contentTop = 0;
            if (showTitleBar) {
                const titleBar = document.createElement('div');
                titleBar.className = 'virtual-object-titlebar';
                titleBar.style.position = 'absolute';
                titleBar.style.top = '0';
                titleBar.style.left = '0';
                titleBar.style.right = '0';
                titleBar.style.height = titleBarHeight + 'px';
                titleBar.style.backgroundColor = tbcol;
                titleBar.style.color = chcol;
                if (showFrame) {
                    titleBar.style.borderBottom = `1px solid ${frcol}`;
                }
                titleBar.style.display = 'flex';
                titleBar.style.alignItems = 'center';
                titleBar.style.paddingLeft = '8px';  // 閉じた仮身と同じpaddingに設定
                titleBar.style.paddingRight = '8px';  // 閉じた仮身と同じpaddingに設定
                titleBar.style.fontSize = chsz + 'px';
                titleBar.style.fontWeight = 'normal';  // 閉じた仮身と同じフォントウェイトに設定
                titleBar.style.boxSizing = 'border-box';
                titleBar.style.overflow = 'hidden';
                titleBar.style.whiteSpace = 'nowrap';
                titleBar.style.userSelect = 'none';

                // タイトルテキストを作成（左から：ピクトグラム、名称、続柄、タイプ、更新日時）
                let titleText = '';

                // ピクトグラム（今後実装予定）
                if (showPict) {
                    // ピクトグラム実装は今後
                }

                // 名称
                if (showName) {
                    titleText += originalText;
                }

                // 続柄（今後実装予定）
                if (showRole) {
                    // 続柄実装は今後
                }

                // タイプ（今後実装予定）
                if (showType) {
                    // タイプ実装は今後
                }

                // 更新日時
                if (showUpdate && realObjectData.updateDate) {
                    const updateDate = new Date(realObjectData.updateDate);
                    const dateStr = updateDate.getFullYear() + '/' +
                                  String(updateDate.getMonth() + 1).padStart(2, '0') + '/' +
                                  String(updateDate.getDate()).padStart(2, '0') + ' ' +
                                  String(updateDate.getHours()).padStart(2, '0') + ':' +
                                  String(updateDate.getMinutes()).padStart(2, '0') + ':' +
                                  String(updateDate.getSeconds()).padStart(2, '0');
                    if (titleText) {
                        titleText += ' ' + dateStr;
                    } else {
                        titleText = dateStr;
                    }
                }

                const titleSpan = document.createElement('span');
                titleSpan.textContent = titleText;
                titleSpan.style.overflow = 'hidden';
                titleSpan.style.textOverflow = 'ellipsis';
                titleSpan.style.whiteSpace = 'nowrap';
                titleBar.appendChild(titleSpan);

                vo.appendChild(titleBar);

                // デバッグ：タイトルバーとtitleSpanのスタイルを確認
                console.log('[EDITOR] タイトルバー作成後のスタイル:', JSON.stringify({
                    'titleBar.fontSize': titleBar.style.fontSize,
                    'titleBar.computedFontSize': window.getComputedStyle(titleBar).fontSize,
                    'titleSpan.fontSize': titleSpan.style.fontSize,
                    'titleSpan.computedFontSize': window.getComputedStyle(titleSpan).fontSize,
                    'vo.fontSize': vo.style.fontSize,
                    'vo.computedFontSize': window.getComputedStyle(vo).fontSize,
                    'chsz': chsz
                }, null, 2));

                contentTop = titleBarHeight;
            }

            // 開いた仮身でも既存のダブルクリックイベント（setupVirtualObjectEventHandlersで設定）が機能する
            // タイトルバーや枠線部分をダブルクリックすると、仮身要素(vo)のイベントが発火する
            // 注: iframe内部でのダブルクリックは、iframeの性質上検知できない

            // iframeを作成してdefaultOpenプラグインを読み込む（コンテンツ表示領域）
            const iframe = document.createElement('iframe');
            iframe.className = 'virtual-object-content';
            iframe.style.position = 'absolute';
            iframe.style.top = contentTop + 'px';
            iframe.style.left = '0';
            iframe.style.right = '0';
            iframe.style.bottom = '0';
            iframe.style.width = '100%';
            iframe.style.height = `${height - contentTop}px`;
            iframe.style.border = 'none';
            iframe.style.overflow = 'hidden'; // スクロールバーを非表示
            iframe.style.backgroundColor = bgcol; // コンテンツ背景色にbgcolを使用
            iframe.style.boxSizing = 'border-box';
            iframe.setAttribute('scrolling', 'no'); // スクロールバー非表示
            iframe.src = `../../plugins/${defaultOpen}/index.html`;

            // iframeを追加
            vo.appendChild(iframe);

            // iframeが読み込まれたら、実身データを渡す
            iframe.onload = () => {
                const virtualObj = this.buildVirtualObjFromDataset(vo.dataset);
                iframe.contentWindow.postMessage({
                    type: 'load-virtual-object',
                    virtualObj: virtualObj,
                    realObject: realObjectData,
                    bgcol: bgcol,          // 背景色を渡す
                    readonly: true,        // 読み取り専用モード（仮身一覧プラグインと同様）
                    noScrollbar: true      // スクロールバー非表示モード（仮身一覧プラグインと同様）
                }, '*');

                console.log('[EDITOR] 開いた仮身表示にデータを送信:', { virtualObj, realObject: realObjectData, bgcol, readonly: true, noScrollbar: true });
            };

        } catch (error) {
            console.error('[EDITOR] 開いた仮身表示エラー:', error);
            // エラーが発生した場合は展開状態を解除
            vo.classList.remove('expanded');
            // 元のテキスト表示に戻す
            const displayName = vo.dataset.linkName || '無題';
            vo.textContent = displayName;
            // ユーザーにエラーを通知
            this.setStatus(`仮身の展開に失敗しました: ${error.message}`);
        }
    }

    /**
     * 実身データを読み込む
     */
    async loadRealObjectData(realId) {
        return new Promise((resolve, reject) => {
            const messageId = `load-real-${Date.now()}-${Math.random()}`;

            const messageHandler = (e) => {
                if (e.data && e.data.messageId === messageId) {
                    window.removeEventListener('message', messageHandler);
                    if (e.data.type === 'real-object-loaded') {
                        resolve(e.data.realObject);
                    } else if (e.data.type === 'real-object-error') {
                        reject(new Error(e.data.error));
                    }
                }
            };

            window.addEventListener('message', messageHandler);

            // タイムアウト設定（5秒）
            setTimeout(() => {
                window.removeEventListener('message', messageHandler);
                reject(new Error('実身データ読み込みタイムアウト'));
            }, 5000);

            // 親ウィンドウに実身データ読み込みを要求
            window.parent.postMessage({
                type: 'load-real-object',
                realId: realId,
                messageId: messageId
            }, '*');
        });
    }

    /**
     * 仮身を通常表示に戻す
     */
    collapseVirtualObject(vo) {
        if (!vo.classList.contains('expanded')) {
            return;
        }

        vo.classList.remove('expanded');
        console.log('[EDITOR] 仮身を通常表示に戻す:', vo.dataset.linkName);

        // iframeとタイトルバーを削除
        const iframe = vo.querySelector('.virtual-object-content');
        const titleBar = vo.querySelector('.virtual-object-titlebar');
        const titleText = titleBar ? titleBar.textContent : vo.dataset.linkName;

        if (iframe) iframe.remove();
        if (titleBar) titleBar.remove();

        // 座標属性を削除（閉じた状態では不要）
        delete vo.dataset.linkVobjleft;
        delete vo.dataset.linkVobjtop;
        delete vo.dataset.linkVobjright;
        delete vo.dataset.linkVobjbottom;

        // 元のテキスト表示に戻す
        vo.textContent = titleText;

        // 閉じた仮身のスタイルを復元
        const frcol = vo.dataset.linkFrcol || '#000000';
        const chcol = vo.dataset.linkChcol || '#000000';
        const tbcol = vo.dataset.linkTbcol || '#ffffff';
        const chsz = parseFloat(vo.dataset.linkChsz) || 14;

        vo.style.display = 'inline-block';
        vo.style.position = 'relative';
        vo.style.verticalAlign = 'middle';
        vo.style.background = tbcol;
        vo.style.border = `1px solid ${frcol}`;
        vo.style.padding = '4px 8px';
        vo.style.margin = '0 2px';
        vo.style.color = chcol;
        vo.style.fontSize = chsz + 'px';
        vo.style.cursor = 'pointer';
        vo.style.userSelect = 'none';
        vo.style.whiteSpace = 'nowrap';
        vo.style.overflow = 'visible';
        vo.style.boxSizing = 'border-box';
        vo.style.width = 'auto';
        vo.style.height = 'auto';
        vo.style.minWidth = 'auto';
        vo.style.minHeight = 'auto';

        // 閉じた時の高さをoriginalHeightとして保存（chszはポイント値なのでピクセルに変換）
        const chszPx = window.convertPtToPx(chsz);
        const lineHeight = 1.2;
        const textHeight = Math.ceil(chszPx * lineHeight);
        const closedHeight = textHeight + 8; // 閉じた仮身の高さ
        vo.dataset.originalHeight = closedHeight.toString();
        console.log('[EDITOR] 仮身を閉じた時の originalHeight を更新:', vo.dataset.linkName, closedHeight);
    }

    /**
     * 選択中の仮身が指し示す実身をデフォルトアプリで開く
     */
    openRealObjectWithDefaultApp() {
        if (!this.contextMenuVirtualObject || !this.contextMenuVirtualObject.virtualObj) {
            console.warn('[EDITOR] 選択中の仮身がありません');
            return;
        }

        const virtualObj = this.contextMenuVirtualObject.virtualObj;
        const realId = this.contextMenuVirtualObject.realId;

        // applistを取得
        this.getAppListData(realId).then(applist => {
            if (!applist || typeof applist !== 'object') {
                console.warn('[EDITOR] applistが存在しません');
                this.setStatus('実身を開くアプリケーションが見つかりません');
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
                console.warn('[EDITOR] 開くためのプラグインが見つかりません');
                this.setStatus('実身を開くアプリケーションが見つかりません');
                return;
            }

            // ウィンドウが開いた通知を受け取るハンドラー
            const messageId = `open-${realId}-${Date.now()}`;
            const handleWindowOpened = (e) => {
                if (e.data && e.data.type === 'window-opened' && e.data.messageId === messageId) {
                    window.removeEventListener('message', handleWindowOpened);

                    if (e.data.success && e.data.windowId) {
                        // 開いたウィンドウを追跡
                        this.openedRealObjects.set(realId, e.data.windowId);
                        console.log('[EDITOR] ウィンドウが開きました:', e.data.windowId, 'realId:', realId);
                        this.setStatus(`実身を${defaultPluginId}で開きました`);
                    }
                }
            };

            window.addEventListener('message', handleWindowOpened);

            // 親ウィンドウ(tadjs-desktop.js)に実身を開くよう要求
            window.parent.postMessage({
                type: 'open-virtual-object-real',
                virtualObj: virtualObj,
                pluginId: defaultPluginId,
                messageId: messageId
            }, '*');

            console.log('[EDITOR] 実身を開く:', realId, 'with', defaultPluginId);
        });
    }

    /**
     * 選択中の仮身が指し示す開いている実身を閉じる
     */
    closeRealObject() {
        if (!this.contextMenuVirtualObject) {
            console.warn('[EDITOR] 選択中の仮身がありません');
            return;
        }

        const realId = this.contextMenuVirtualObject.realId;
        const windowId = this.openedRealObjects.get(realId);

        if (!windowId) {
            console.warn('[EDITOR] 実身が開いていません:', realId);
            this.setStatus('実身が開いていません');
            return;
        }

        // 親ウィンドウにウィンドウを閉じるよう要求
        window.parent.postMessage({
            type: 'close-window',
            windowId: windowId
        }, '*');

        console.log('[EDITOR] ウィンドウを閉じる要求:', windowId);
        this.setStatus('実身を閉じました');
    }

    /**
     * 仮身属性変更ダイアログを表示
     */
    async changeVirtualObjectAttributes() {
        if (!this.contextMenuVirtualObject || !this.contextMenuVirtualObject.virtualObj) {
            console.warn('[EDITOR] 選択中の仮身がありません');
            return;
        }

        const vobj = this.contextMenuVirtualObject.virtualObj;
        const element = this.contextMenuVirtualObject.element;

        // 現在の属性値を取得（elementのdatasetから最新の値を読み取る）
        const pictdisp = element.dataset.linkPictdisp !== undefined ? element.dataset.linkPictdisp : (vobj.pictdisp || 'true');
        const namedisp = element.dataset.linkNamedisp !== undefined ? element.dataset.linkNamedisp : (vobj.namedisp || 'true');
        const roledisp = element.dataset.linkRoledisp !== undefined ? element.dataset.linkRoledisp : (vobj.roledisp || 'false');
        const typedisp = element.dataset.linkTypedisp !== undefined ? element.dataset.linkTypedisp : (vobj.typedisp || 'false');
        const updatedisp = element.dataset.linkUpdatedisp !== undefined ? element.dataset.linkUpdatedisp : (vobj.updatedisp || 'false');
        const framedisp = element.dataset.linkFramedisp !== undefined ? element.dataset.linkFramedisp : (vobj.framedisp || 'true');
        const frcol = element.dataset.linkFrcol || vobj.frcol || '#000000';
        const chcol = element.dataset.linkChcol || vobj.chcol || '#000000';
        const tbcol = element.dataset.linkTbcol || vobj.tbcol || '#ffffff';
        const bgcol = element.dataset.linkBgcol || vobj.bgcol || '#ffffff';
        const autoopen = element.dataset.linkAutoopen !== undefined ? element.dataset.linkAutoopen : (vobj.autoopen || 'false');
        const chsz = element.dataset.linkChsz ? parseFloat(element.dataset.linkChsz) : (parseFloat(vobj.chsz) || 9.6);

        console.log('[EDITOR] 仮身属性ダイアログ用に現在の属性を取得:', {
            pictdisp, namedisp, roledisp, typedisp, updatedisp, framedisp,
            frcol, chcol, tbcol, bgcol, autoopen, chsz
        });

        const currentAttrs = {
            pictdisp: pictdisp !== 'false',  // デフォルトtrue
            namedisp: namedisp !== 'false',  // デフォルトtrue
            roledisp: roledisp === 'true',   // デフォルトfalse
            typedisp: typedisp === 'true',   // デフォルトfalse
            updatedisp: updatedisp === 'true',  // デフォルトfalse
            framedisp: framedisp !== 'false',  // デフォルトtrue
            frcol: frcol,
            chcol: chcol,
            tbcol: tbcol,
            bgcol: bgcol,
            autoopen: autoopen === 'true',
            chsz: chsz
        };

        // 文字サイズの倍率を計算
        const baseFontSize = 9.6;
        const ratio = currentAttrs.chsz / baseFontSize;
        let selectedRatio = '標準';
        const ratioMap = {
            '1/2倍': 0.5,
            '3/4倍': 0.75,
            '標準': 1.0,
            '3/2倍': 1.5,
            '2倍': 2.0,
            '3倍': 3.0,
            '4倍': 4.0
        };

        for (const [label, value] of Object.entries(ratioMap)) {
            if (Math.abs(ratio - value) < 0.01) {
                selectedRatio = label;
                break;
            }
        }

        // 親ウィンドウにダイアログ表示を要求
        const messageId = `change-vobj-attrs-${Date.now()}-${Math.random()}`;

        const handleMessage = (e) => {
            if (e.data && e.data.type === 'virtual-object-attributes-changed' && e.data.messageId === messageId) {
                window.removeEventListener('message', handleMessage);

                if (e.data.success && e.data.attributes) {
                    this.applyVirtualObjectAttributes(e.data.attributes, vobj, element);
                }
            }
        };

        window.addEventListener('message', handleMessage);

        window.parent.postMessage({
            type: 'change-virtual-object-attributes',
            virtualObject: vobj,
            currentAttributes: currentAttrs,
            selectedRatio: selectedRatio,
            messageId: messageId
        }, '*');

        console.log('[EDITOR] 仮身属性変更ダイアログ要求');
    }

    /**
     * 仮身に属性を適用
     */
    applyVirtualObjectAttributes(attrs, vobj, element) {
        if (!vobj || !element) return;

        // 表示項目の設定
        if (attrs.pictdisp !== undefined) vobj.pictdisp = attrs.pictdisp ? 'true' : 'false';
        if (attrs.namedisp !== undefined) vobj.namedisp = attrs.namedisp ? 'true' : 'false';
        if (attrs.roledisp !== undefined) vobj.roledisp = attrs.roledisp ? 'true' : 'false';
        if (attrs.typedisp !== undefined) vobj.typedisp = attrs.typedisp ? 'true' : 'false';
        if (attrs.updatedisp !== undefined) vobj.updatedisp = attrs.updatedisp ? 'true' : 'false';
        if (attrs.framedisp !== undefined) vobj.framedisp = attrs.framedisp ? 'true' : 'false';

        // 色の設定（#ffffff形式のみ）
        const colorRegex = /^#[0-9A-Fa-f]{6}$/;
        if (attrs.frcol && colorRegex.test(attrs.frcol)) vobj.frcol = attrs.frcol;
        if (attrs.chcol && colorRegex.test(attrs.chcol)) vobj.chcol = attrs.chcol;
        if (attrs.tbcol && colorRegex.test(attrs.tbcol)) vobj.tbcol = attrs.tbcol;
        if (attrs.bgcol && colorRegex.test(attrs.bgcol)) vobj.bgcol = attrs.bgcol;

        // 文字サイズの設定
        if (attrs.chsz !== undefined) vobj.chsz = attrs.chsz.toString();

        // 自動起動の設定
        if (attrs.autoopen !== undefined) vobj.autoopen = attrs.autoopen ? 'true' : 'false';

        // DOM要素に属性を適用（閉じた仮身の場合）
        if (element && element.classList.contains('virtual-object')) {
            // 枠線の色
            if (attrs.frcol && colorRegex.test(attrs.frcol)) {
                element.style.borderColor = attrs.frcol;
            }
            // 仮身文字色
            if (attrs.chcol && colorRegex.test(attrs.chcol)) {
                element.style.color = attrs.chcol;
            }
            // 仮身背景色
            if (attrs.tbcol && colorRegex.test(attrs.tbcol)) {
                element.style.backgroundColor = attrs.tbcol;
            }
            // 文字サイズ（chszはポイント値なのでピクセルに変換）
            if (attrs.chsz !== undefined) {
                const chszPx = window.convertPtToPx(attrs.chsz);
                element.style.fontSize = chszPx + 'px';

                // chsz変更時は、閉じた仮身の最低縦幅(originalHeight)を再計算
                if (!element.classList.contains('expanded')) {
                    const lineHeight = 1.2;
                    const textHeight = Math.ceil(chszPx * lineHeight);
                    const newHeight = textHeight + 8; // 閉じた仮身の高さ
                    element.dataset.originalHeight = newHeight.toString();
                    console.log('[EDITOR] chsz変更により originalHeight を再計算:', element.dataset.linkName, newHeight);

                    // 文字サイズに合わせて仮身の幅を再計算
                    const textWidth = this.measureTextWidth(element.dataset.linkName || '', chszPx);
                    const newWidth = textWidth + 16 + 2; // テキスト幅 + padding(16px) + border(2px)
                    element.style.width = newWidth + 'px';
                    element.style.minWidth = newWidth + 'px';
                    console.log('[EDITOR] chsz変更により仮身幅を再計算:', element.dataset.linkName, newWidth);
                }
            }

            // namedisp/pictdispの変更を閉じた仮身に反映
            if (!element.classList.contains('expanded')) {
                const showName = vobj.namedisp !== 'false';
                const showPict = vobj.pictdisp !== 'false';

                if (showName) {
                    // 実身名称を表示
                    element.textContent = vobj.link_name || element.dataset.linkName || '';
                } else if (!showName && !showPict) {
                    // 両方非表示の場合は空にする
                    element.textContent = '';
                }
                // pictdispの処理は将来的に追加（現在はテキストのみ対応）
            }
        }

        // XMLデータに反映するため、dataset属性を更新（data-link-*形式で保存）
        if (element) {
            element.dataset.linkPictdisp = vobj.pictdisp;
            element.dataset.linkNamedisp = vobj.namedisp;
            element.dataset.linkRoledisp = vobj.roledisp;
            element.dataset.linkTypedisp = vobj.typedisp;
            element.dataset.linkUpdatedisp = vobj.updatedisp;
            element.dataset.linkFramedisp = vobj.framedisp;
            element.dataset.linkFrcol = vobj.frcol;
            element.dataset.linkChcol = vobj.chcol;
            element.dataset.linkTbcol = vobj.tbcol;
            element.dataset.linkBgcol = vobj.bgcol;
            element.dataset.linkChsz = vobj.chsz;
            element.dataset.linkAutoopen = vobj.autoopen;
        }

        // elementのdatasetから必要な情報を取得して、完全なvobjオブジェクトを構築
        const completeVobj = {
            link_id: element.dataset.linkId || vobj.link_id,
            link_name: element.dataset.linkName || vobj.link_name,
            vobjleft: parseInt(element.dataset.linkVobjleft) || vobj.vobjleft || 5,
            vobjtop: parseInt(element.dataset.linkVobjtop) || vobj.vobjtop || 5,
            vobjright: parseInt(element.dataset.linkVobjright) || vobj.vobjright || 100,
            vobjbottom: parseInt(element.dataset.linkVobjbottom) || vobj.vobjbottom || 30,
            width: parseInt(element.style.width) || vobj.width,
            heightPx: parseInt(element.style.height) || vobj.heightPx,
            chsz: vobj.chsz,
            frcol: vobj.frcol,
            chcol: vobj.chcol,
            tbcol: vobj.tbcol,
            bgcol: vobj.bgcol,
            dlen: parseInt(element.dataset.linkDlen) || vobj.dlen || 0,
            pictdisp: vobj.pictdisp,
            namedisp: vobj.namedisp,
            roledisp: vobj.roledisp,
            typedisp: vobj.typedisp,
            updatedisp: vobj.updatedisp,
            framedisp: vobj.framedisp,
            autoopen: vobj.autoopen
        };

        // XMLを更新
        this.updateVirtualObjectInXml(completeVobj);

        console.log('[EDITOR] 仮身属性を適用:', attrs, '完全なvobj:', completeVobj);

        // 展開済みの仮身の場合は再描画
        if (element && element.classList.contains('expanded')) {
            console.log('[EDITOR] 展開済み仮身を再描画:', element.dataset.linkName);

            // datasetを更新
            element.dataset.linkChsz = completeVobj.chsz;
            element.dataset.linkFrcol = completeVobj.frcol;
            element.dataset.linkChcol = completeVobj.chcol;
            element.dataset.linkTbcol = completeVobj.tbcol;
            element.dataset.linkBgcol = completeVobj.bgcol;
            element.dataset.linkPictdisp = completeVobj.pictdisp;
            element.dataset.linkNamedisp = completeVobj.namedisp;
            element.dataset.linkRoledisp = completeVobj.roledisp;
            element.dataset.linkTypedisp = completeVobj.typedisp;
            element.dataset.linkUpdatedisp = completeVobj.updatedisp;
            element.dataset.linkFramedisp = completeVobj.framedisp;
            element.dataset.linkAutoopen = completeVobj.autoopen;

            // 背景色のみの変更の場合は、iframeに直接通知して再展開を回避
            const bgcolChanged = attrs.bgcol !== undefined;
            const onlyBgcolChanged = bgcolChanged &&
                Object.keys(attrs).filter(key => attrs[key] !== undefined).length === 1;

            if (onlyBgcolChanged) {
                // 背景色のみ変更の場合、iframeに通知
                const iframe = element.querySelector('.virtual-object-content');
                if (iframe && iframe.contentWindow) {
                    iframe.contentWindow.postMessage({
                        type: 'update-background-color',
                        bgcol: completeVobj.bgcol
                    }, '*');
                    console.log('[EDITOR] 開いた仮身のiframeに背景色変更を通知:', completeVobj.bgcol);
                }
            } else {
                // その他の属性変更がある場合は、再展開
                const currentWidth = parseFloat(element.style.width) || completeVobj.width || 150;
                const currentHeight = parseFloat(element.style.height) || completeVobj.heightPx || 120;

                // 一旦閉じてから再度開く
                this.collapseVirtualObject(element);
                // 少し待ってから再展開（DOMの更新を待つ）
                setTimeout(() => {
                    this.expandVirtualObject(element, currentWidth, currentHeight);
                }, 50);
            }
        }

        this.setStatus('仮身属性を変更しました');
        this.isModified = true;
    }

    /**
     * テキストの幅を測定
     * @param {string} text - 測定するテキスト
     * @param {number} fontSize - フォントサイズ（px）
     * @returns {number} テキストの幅（px）
     */
    measureTextWidth(text, fontSize) {
        // Canvas APIを使用してテキスト幅を測定
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        // エディタと同じフォントファミリーを使用
        context.font = `${fontSize}px 'Noto Sans JP', 'Yu Gothic', 'Meiryo', sans-serif`;
        const metrics = context.measureText(text);
        return Math.ceil(metrics.width);
    }

    /**
     * xmlTAD内の仮身を更新
     * @param {Object} virtualObj - 更新する仮身オブジェクト
     */
    updateVirtualObjectInXml(virtualObj) {
        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(this.tadData, 'text/xml');

            // 更新する<link>要素を探す
            const linkElements = xmlDoc.getElementsByTagName('link');
            for (let i = 0; i < linkElements.length; i++) {
                const linkElement = linkElements[i];
                if (linkElement.getAttribute('id') === virtualObj.link_id) {
                    // 基本属性を更新
                    if (virtualObj.vobjleft !== undefined) linkElement.setAttribute('vobjleft', virtualObj.vobjleft.toString());
                    if (virtualObj.vobjtop !== undefined) linkElement.setAttribute('vobjtop', virtualObj.vobjtop.toString());
                    if (virtualObj.vobjright !== undefined) linkElement.setAttribute('vobjright', virtualObj.vobjright.toString());
                    if (virtualObj.vobjbottom !== undefined) linkElement.setAttribute('vobjbottom', virtualObj.vobjbottom.toString());
                    if (virtualObj.heightPx !== undefined) linkElement.setAttribute('height', virtualObj.heightPx.toString());
                    if (virtualObj.chsz !== undefined) linkElement.setAttribute('chsz', virtualObj.chsz.toString());
                    if (virtualObj.frcol !== undefined) linkElement.setAttribute('frcol', virtualObj.frcol);
                    if (virtualObj.chcol !== undefined) linkElement.setAttribute('chcol', virtualObj.chcol);
                    if (virtualObj.tbcol !== undefined) linkElement.setAttribute('tbcol', virtualObj.tbcol);
                    if (virtualObj.bgcol !== undefined) linkElement.setAttribute('bgcol', virtualObj.bgcol);
                    if (virtualObj.dlen !== undefined) linkElement.setAttribute('dlen', virtualObj.dlen.toString());

                    // 表示属性（あれば設定）
                    if (virtualObj.pictdisp !== undefined) {
                        linkElement.setAttribute('pictdisp', virtualObj.pictdisp.toString());
                    }
                    if (virtualObj.namedisp !== undefined) {
                        linkElement.setAttribute('namedisp', virtualObj.namedisp.toString());
                    }
                    if (virtualObj.roledisp !== undefined) {
                        linkElement.setAttribute('roledisp', virtualObj.roledisp.toString());
                    }
                    if (virtualObj.typedisp !== undefined) {
                        linkElement.setAttribute('typedisp', virtualObj.typedisp.toString());
                    }
                    if (virtualObj.updatedisp !== undefined) {
                        linkElement.setAttribute('updatedisp', virtualObj.updatedisp.toString());
                    }
                    if (virtualObj.framedisp !== undefined) {
                        linkElement.setAttribute('framedisp', virtualObj.framedisp.toString());
                    }
                    if (virtualObj.autoopen !== undefined) {
                        linkElement.setAttribute('autoopen', virtualObj.autoopen.toString());
                    }

                    if (virtualObj.link_name !== undefined) {
                        linkElement.textContent = virtualObj.link_name;
                    }

                    console.log('[EDITOR] <link>要素を更新:', virtualObj.link_id);
                    break;
                }
            }

            // XMLを文字列に戻す
            const serializer = new XMLSerializer();
            this.tadData = serializer.serializeToString(xmlDoc);

            // 自動保存
            this.notifyXmlDataChanged();

        } catch (error) {
            console.error('[EDITOR] xmlTAD更新エラー:', error);
        }
    }

    /**
     * 選択中の仮身が指し示す実身の名前を変更
     */
    async renameRealObject() {
        if (!this.contextMenuVirtualObject || !this.contextMenuVirtualObject.virtualObj) {
            console.warn('[EDITOR] 選択中の仮身がありません');
            return;
        }

        const realId = this.contextMenuVirtualObject.realId;
        const virtualObj = this.contextMenuVirtualObject.virtualObj;
        const currentName = virtualObj.link_name;

        // 親ウィンドウにダイアログ表示を要求
        const messageId = `rename-real-${Date.now()}-${Math.random()}`;

        const handleMessage = (e) => {
            if (e.data && e.data.type === 'real-object-renamed' && e.data.messageId === messageId) {
                window.removeEventListener('message', handleMessage);

                if (e.data.success) {
                    // 仮身の表示名を更新（DOM要素を更新）
                    if (this.contextMenuVirtualObject.element) {
                        const element = this.contextMenuVirtualObject.element;
                        element.textContent = e.data.newName;
                        element.dataset.linkName = e.data.newName;
                    }
                    console.log('[EDITOR] 実身名変更成功:', realId, e.data.newName);
                    this.setStatus(`実身名を「${e.data.newName}」に変更しました`);
                    this.isModified = true;
                }
            }
        };

        window.addEventListener('message', handleMessage);

        window.parent.postMessage({
            type: 'rename-real-object',
            realId: realId,
            currentName: currentName,
            messageId: messageId
        }, '*');

        console.log('[EDITOR] 実身名変更要求:', realId, currentName);
    }

    /**
     * 選択中の仮身が指し示す実身を複製
     */
    async duplicateRealObject() {
        if (!this.contextMenuVirtualObject || !this.contextMenuVirtualObject.virtualObj) {
            console.warn('[EDITOR] 選択中の仮身がありません');
            return;
        }

        const realId = this.contextMenuVirtualObject.realId;

        // 親ウィンドウに実身複製を要求
        const messageId = `duplicate-real-${Date.now()}-${Math.random()}`;

        const handleMessage = (e) => {
            if (e.data && e.data.type === 'real-object-duplicated' && e.data.messageId === messageId) {
                window.removeEventListener('message', handleMessage);

                if (e.data.success) {
                    console.log('[EDITOR] 実身複製成功:', realId, '->', e.data.newRealId);
                    this.setStatus(`実身を複製しました: ${e.data.newName}`);
                }
            }
        };

        window.addEventListener('message', handleMessage);

        window.parent.postMessage({
            type: 'duplicate-real-object',
            realId: realId,
            messageId: messageId
        }, '*');

        console.log('[EDITOR] 実身複製要求:', realId);
    }

    /**
     * 屑実身操作ウィンドウを開く
     */
    openTrashRealObjects() {
        if (window.parent && window.parent !== window && window.parent.pluginManager) {
            try {
                window.parent.pluginManager.launchPlugin('trash-real-objects', null);
                console.log('[EDITOR] 屑実身操作ウィンドウ起動');
                this.setStatus('屑実身操作ウィンドウを起動しました');
            } catch (error) {
                console.error('[EDITOR] 屑実身操作ウィンドウ起動エラー:', error);
                this.setStatus('屑実身操作ウィンドウの起動に失敗しました');
            }
        }
    }

    /**
     * ウィンドウが閉じたことを処理
     */
    handleWindowClosed(windowId, fileData) {
        console.log('[EDITOR] ウィンドウクローズ通知:', windowId, fileData);

        // fileDataから実身IDを取得
        if (fileData && fileData.realId) {
            const realId = fileData.realId;

            // openedRealObjectsから削除
            if (this.openedRealObjects.has(realId)) {
                this.openedRealObjects.delete(realId);
                console.log('[EDITOR] 実身の追跡を削除:', realId);
            }
        }

        // windowIdで検索して削除
        for (const [realId, wId] of this.openedRealObjects.entries()) {
            if (wId === windowId) {
                this.openedRealObjects.delete(realId);
                console.log('[EDITOR] windowIdから実身の追跡を削除:', realId, windowId);
                break;
            }
        }
    }

    /**
     * アイコンファイルを親ウィンドウ経由で読み込む
     * @param {string} realId - 実身ID
     * @returns {Promise<string|null>} Base64エンコードされたアイコンデータ、またはnull
     */
    async loadIconFromParent(realId) {
        // キャッシュをチェック
        if (this.iconCache.has(realId)) {
            const cachedData = this.iconCache.get(realId);
            console.log('[EDITOR] アイコンキャッシュヒット:', realId, 'データあり:', !!cachedData);
            return cachedData;
        }

        console.log('[EDITOR] アイコンキャッシュミス、親ウィンドウに要求:', realId);
        return new Promise((resolve) => {
            let resolved = false; // resolveされたかどうかのフラグ

            const messageHandler = (event) => {
                if (event.data && event.data.type === 'icon-file-loaded' && event.data.realId === realId) {
                    if (resolved) return; // 既にresolveされていたら何もしない
                    resolved = true;
                    window.removeEventListener('message', messageHandler);

                    if (event.data.success) {
                        // キャッシュに保存
                        this.iconCache.set(realId, event.data.data);
                        console.log('[EDITOR] アイコン読み込み成功（親から）:', realId, 'データ長:', event.data.data.length);
                        resolve(event.data.data);
                    } else {
                        // アイコンが存在しない場合はnullを返す
                        this.iconCache.set(realId, null);
                        console.log('[EDITOR] アイコン読み込み失敗（親から）:', realId);
                        resolve(null);
                    }
                }
            };

            window.addEventListener('message', messageHandler);

            window.parent.postMessage({
                type: 'read-icon-file',
                realId: realId
            }, '*');

            // 3秒でタイムアウト（アイコンがない場合も多いのでnullを返す）
            setTimeout(() => {
                if (resolved) return; // 既にresolveされていたら何もしない
                resolved = true;
                window.removeEventListener('message', messageHandler);
                // キャッシュにまだ入っていない場合のみnullをセット
                if (!this.iconCache.has(realId)) {
                    this.iconCache.set(realId, null);
                }
                console.log('[EDITOR] アイコン読み込みタイムアウト:', realId);
                resolve(null);
            }, 3000);
        });
    }

}

// エディタを初期化
document.addEventListener('DOMContentLoaded', () => {
    window.editor = new BasicTextEditor();
});
