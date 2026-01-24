/**
 * 基本文章編集プラグイン
 * TADファイルをリッチテキストエディタで編集
 *
 * @module BasicTextEditor
 * @extends PluginBase
 * @license MIT
 * @author satromi
 * @version 1.0.0
 */
const logger = window.getLogger('BasicTextEditor');

class BasicTextEditor extends window.PluginBase {
    constructor() {
        // 基底クラスのコンストラクタを呼び出し
        super('BasicTextEditor');

        this.editor = document.getElementById('editor');
        this.currentFile = null;
        this.tadData = null;
        // isFullscreenはPluginBaseで初期化・管理される
        this.wrapMode = true;
        this.viewMode = 'formatted'; // 'formatted' or 'xml'
        // this.realId は基底クラスで定義済み
        this.isModified = false; // 編集状態フラグ
        this.originalContent = ''; // 保存時の内容
        this.updateHeightTimer = null; // スクロールバー更新のデバウンスタイマー
        this.mutationObserver = null; // MutationObserverインスタンス
        this.suppressMutationObserverCount = 0; // MutationObserver一時停止カウンタ（ネスト対応）
        this.selectedImage = null; // 選択中の画像要素
        this.lastSelectedText = ''; // メニュー操作用の最後の選択テキスト
        this.isResizing = false; // リサイズ中フラグ
        this.resizeStartX = 0; // リサイズ開始X座標
        this.resizeStartY = 0; // リサイズ開始Y座標
        this.resizeStartWidth = 0; // リサイズ開始時の幅
        this.resizeStartHeight = 0; // リサイズ開始時の高さ
        this.isDraggingImage = false; // 画像ドラッグ中フラグ
        this.dragStartX = 0; // ドラッグ開始X座標
        this.dragStartY = 0; // ドラッグ開始Y座標

        // 仮身ドラッグ用の詳細状態管理（PluginBaseで定義済み）
        // virtualObjectDragState: { dragMode, isRightButtonPressed, hasMoved, startX, startY, isDragging, dragThreshold }

        // ダブルクリック+ドラッグ（実身複製）用の状態管理
        // PluginBaseで共通プロパティ（lastClickTime, isDblClickDragCandidate, isDblClickDrag, dblClickedElement, startX, startY）を初期化済み
        // プラグイン固有のプロパティのみ追加
        this.dblClickDragState.lastClickedElement = null;  // 最後にクリックされた仮身要素
        this.dblClickDragState.dragPreview = null;         // ドラッグ中のプレビュー要素
        this.dblClickDragState.lastMouseX = 0;             // 最新のマウスX座標
        this.dblClickDragState.lastMouseY = 0;             // 最新のマウスY座標
        this.dblClickDragState.rafId = null;               // requestAnimationFrameのID

        this.recentFonts = []; // 最近使用したフォント（最大10個）
        this.systemFonts = []; // システムフォント一覧
        this.virtualObjectDropSuccess = false; // 仮身ドロップ成功フラグ
        // this.windowId はPluginBaseで定義済み
        // imagePathCallbacks, imagePathMessageId は PluginBase.getImageFilePath() に移行済み

        // 用紙設定関連プロパティ
        this.paperFrameVisible = false;  // 用紙枠表示オン/オフ
        this.paperWidth = 595;           // 用紙幅（ポイント）デフォルトA4
        this.paperHeight = 842;          // 用紙高さ（ポイント）デフォルトA4
        this.paperSize = null;           // PaperSizeオブジェクト（後で初期化）

        // 座標単位設定（UNITS型）
        this.docUnits = {
            h_unit: -72,  // 水平方向の座標単位（デフォルト: -72 = 72DPI）
            v_unit: -72   // 垂直方向の座標単位（デフォルト: -72 = 72DPI）
        };

        // ページ追跡（条件付き改ページ用）
        this.pageTracker = {
            currentPage: 1,           // 現在のページ番号（1始まり）
            remainingHeight: 0,       // 現在のページの残り高さ（ポイント）
            pageHeight: 0,            // 1ページの本文領域高さ（ポイント）
            textDirection: 'horizontal' // 文字方向
        };

        // パフォーマンス最適化用のデバウンス/スロットル関数
        this.debouncedUpdateContentHeight = null;  // init()で初期化
        this.debouncedUpdatePageBreaks = null;     // init()で初期化（ページ区切り再計算用）

        // MessageBusはPluginBaseで初期化済み

        this.init();
    }

    init() {
        // 共通コンポーネントの初期化
        this.initializeCommonComponents('[EDITOR]');

        // パフォーマンス最適化関数の初期化
        if (window.throttle) {
            logger.debug('[EDITOR] Performance optimization initialized');
        }

        // ページ区切り再計算用のdebounced関数を初期化（300ms遅延）
        if (window.debounce) {
            this.debouncedUpdatePageBreaks = debounce(() => {
                if (this.paperFrameVisible) {
                    this.updatePageBreakVisibility();
                }
            }, 300);
        }

        // デフォルトの折り返しスタイルを設定
        this.editor.style.whiteSpace = 'pre-wrap';
        this.editor.style.wordWrap = 'break-word';

        this.setupEventListeners();
        this.setupContextMenu();
        this.setupWindowActivation();

        // スクロール通知初期化（MessageBus経由で親ウィンドウにスクロール状態を通知）
        this.initScrollNotification();

        // 仮身ドラッグ用の右ボタンハンドラーを設定（PluginBase共通機能）
        this.setupVirtualObjectRightButtonHandlers();

        // MessageBusのハンドラを登録
        if (this.messageBus) {
            this.setupMessageBusHandlers();
        }

        logger.debug('[基本文章編集] 準備完了');
    }

    /**
     * MessageBusのハンドラを登録
     * 親ウィンドウからのメッセージを受信して処理
     */
    setupMessageBusHandlers() {
        // init メッセージ
        this.messageBus.on('init', (data) => {
            // 共通初期化処理（windowId設定、スクロール状態送信）
            this.onInit(data);

            // realIdを保存（拡張子を除去）
            if (data.fileData) {
                let rawId = data.fileData.realId || data.fileData.fileId;
                this.realId = rawId ? rawId.replace(/_\d+\.xtad$/i, '') : null;

                // readonlyモードの設定（開いた仮身表示用）
                if (data.fileData.readonly) {
                    this.editor.contentEditable = 'false';
                    this.editor.style.cursor = 'default';
                }

                // スクロールバー非表示モードの設定（開いた仮身表示用）
                if (data.fileData.noScrollbar === true) {
                    document.body.style.overflow = 'hidden';
                    this.editor.style.overflow = 'hidden';
                    const pluginContent = document.querySelector('.plugin-content');
                    if (pluginContent) {
                        pluginContent.style.overflow = 'hidden';
                    }
                }

                // 背景色の設定（開いた仮身表示用）
                if (data.fileData.bgcol) {
                    this.applyBackgroundColor(data.fileData.bgcol);
                } else if (data.fileData.windowConfig && data.fileData.windowConfig.backgroundColor) {
                    this.applyBackgroundColor(data.fileData.windowConfig.backgroundColor);
                }
            }

            this.loadFile(data.fileData);

            // スクロール位置を復元（DOM更新完了を待つ）
            if (data.fileData && data.fileData.windowConfig && data.fileData.windowConfig.scrollPos) {
                setTimeout(() => {
                    this.setScrollPosition(data.fileData.windowConfig.scrollPos);
                }, 150);
            }

            // エディタにフォーカス（DOM更新完了を待つ）
            setTimeout(() => {
                this.editor.focus();
            }, 200);

            // 折り返し設定を復元（未定義の場合はtrue）
            if (data.fileData && data.fileData.windowConfig) {
                const wordWrap = data.fileData.windowConfig.wordWrap !== undefined
                    ? data.fileData.windowConfig.wordWrap
                    : true;
                this.wrapMode = wordWrap;
                if (this.wrapMode) {
                    this.editor.style.whiteSpace = 'pre-wrap';
                    this.editor.style.wordWrap = 'break-word';
                } else {
                    this.editor.style.whiteSpace = 'pre';
                    this.editor.style.wordWrap = 'normal';
                }
                // 段落要素のインラインスタイルも更新（DOM更新完了を待つ）
                setTimeout(() => {
                    const paragraphs = this.editor.querySelectorAll('p');
                    paragraphs.forEach(p => {
                        p.style.whiteSpace = this.wrapMode ? 'pre-wrap' : 'pre';
                    });
                }, 200);
            }
        });

        // load-virtual-object メッセージ（開いた仮身表示用）
        this.messageBus.on('load-virtual-object', async (data) => {

            // 初期メッセージをクリア（開いた仮身表示では不要）
            if (this.editor.innerHTML === '<p>ここに文章を入力してください...</p>') {
                this.editor.innerHTML = '';
            }

            // readonlyモードの設定
            if (data.readonly) {
                this.editor.contentEditable = 'false';
                this.editor.style.cursor = 'default';
            }

            // スクロールバー非表示モードの設定
            if (data.noScrollbar === true) {
                document.body.style.overflow = 'hidden';
                this.editor.style.overflow = 'hidden';
                const pluginContent = document.querySelector('.plugin-content');
                if (pluginContent) {
                    pluginContent.style.overflow = 'hidden';
                }
            }

            // 背景色の設定
            if (data.bgcol) {
                this.applyBackgroundColor(data.bgcol);
            }

            // realObjectからデータを読み込む
            const realObject = data.realObject;
            if (realObject) {
                // virtualObjからrealIdを取得
                const virtualObj = data.virtualObj;
                let rawId = virtualObj?.link_id;
                if (rawId) {
                    // _数字.xtad の形式を除去して実身IDのみを取得
                    this.realId = rawId.replace(/_\d+\.xtad$/i, '');
                }

                // データを読み込む（完了を待つ）
                await this.loadFile({
                    realId: this.realId,
                    xmlData: realObject.xtad || realObject.records?.[0]?.xtad || realObject.xmlData
                });

                // 折り返し設定を適用（管理用セグメントJSONのwindowから取得）
                const windowConfig = realObject.metadata?.window;
                if (windowConfig) {
                    const wordWrap = windowConfig.wordWrap !== undefined
                        ? windowConfig.wordWrap
                        : true;
                    this.wrapMode = wordWrap;

                    // wordWrap=trueの場合、エディタ幅を元のウインドウサイズに固定
                    // これにより折り返し位置が元のウインドウ表示と一致する
                    if (this.wrapMode && windowConfig.width) {
                        this.editor.style.width = windowConfig.width + 'px';
                        this.editor.style.minWidth = windowConfig.width + 'px';
                        this.editor.style.maxWidth = windowConfig.width + 'px';
                    }

                    if (this.wrapMode) {
                        this.editor.style.whiteSpace = 'pre-wrap';
                        this.editor.style.wordWrap = 'break-word';
                    } else {
                        this.editor.style.whiteSpace = 'pre';
                        this.editor.style.wordWrap = 'normal';
                    }
                    // 段落要素のインラインスタイルも更新（DOM更新完了を待つ）
                    setTimeout(() => {
                        const paragraphs = this.editor.querySelectorAll('p');
                        paragraphs.forEach(p => {
                            p.style.whiteSpace = this.wrapMode ? 'pre-wrap' : 'pre';
                        });
                    }, 100);

                    // スクロール位置を復元（DOM更新完了を待つ）
                    // noScrollbar時は直接editorのscrollTopを設定
                    if (windowConfig.scrollPos) {
                        // 複数のrequestAnimationFrameで確実にDOMレンダリング完了を待つ
                        requestAnimationFrame(() => {
                            requestAnimationFrame(() => {
                                // editorに直接スクロール位置を設定
                                this.editor.scrollLeft = windowConfig.scrollPos.x || 0;
                                this.editor.scrollTop = windowConfig.scrollPos.y || 0;
                            });
                        });
                    }

                    // エディタにフォーカス
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            this.editor.focus();
                        });
                    });
                }
            }
        });

        // 共通MessageBusハンドラを登録（PluginBaseで定義）
        // window-moved, window-resized-end, window-maximize-toggled,
        // menu-action, get-menu-definition, window-close-request
        this.setupCommonMessageBusHandlers();

        // ダイアログレスポンスはMessageBusが自動的に処理するため、ハンドラ不要

        // window-closed メッセージ
        this.messageBus.on('window-closed', (data) => {
            this.handleWindowClosed(data.windowId, data.fileData);
        });

        // parent-drag-position メッセージ
        this.messageBus.on('parent-drag-position', (data) => {
            if (this.isDraggingImage) {
                this.showDropCursor(data.clientX, data.clientY);
            }
        });

        // parent-mouseup メッセージ
        this.messageBus.on('parent-mouseup', (data) => {
            this.hideDropCursor();
        });

        // add-virtual-object-from-base メッセージ
        this.messageBus.on('add-virtual-object-from-base', (data) => {
            this.addVirtualObjectFromRealId(data.realId, data.name, data.applist);
        });

        // parent-drop-event メッセージ
        this.messageBus.on('parent-drop-event', (data) => {
            const dragData = data.dragData;
            const clientX = data.clientX;
            const clientY = data.clientY;

            // 任意のプラグインからの仮身ドロップ
            if (dragData.type === 'virtual-object-drag') {
                const virtualObjects = dragData.virtualObjects || [dragData.virtualObject];

                // ドロップ位置にカーソルを設定
                const range = document.caretRangeFromPoint(clientX, clientY);
                if (range) {
                    const selection = window.getSelection();
                    selection.removeAllRanges();
                    selection.addRange(range);
                }

                // 複数の仮身を順番に挿入
                virtualObjects.forEach((virtualObject, index) => {
                    this.insertVirtualObjectLink(virtualObject);
                    if (index < virtualObjects.length - 1) {
                        document.execCommand('insertText', false, ' ');
                    }
                });

                // コピーモードの場合はrefCount+1（移動モードは変更なし）
                if (dragData.mode === 'copy') {
                    virtualObjects.forEach(virtualObject => {
                        this.requestCopyVirtualObject(virtualObject.link_id);
                    });
                }

                this.isModified = true;
                this.updateContentHeight();

                // ドラッグ元のウィンドウに成功を通知
                // PluginBaseの共通メソッドを使用
                this.notifyCrossWindowDropSuccess(dragData, virtualObjects);
            }
        });

        // check-window-id メッセージ
        this.messageBus.on('check-window-id', (data) => {

            // このウィンドウIDと一致する場合、ドロップ成功フラグを設定
            if (data.targetWindowId && data.targetWindowId === this.windowId) {
                this.virtualObjectDropSuccess = true;

                // moveモードの場合、元の仮身を削除
                const mode = data.dropData?.mode || data.mode;
                const virtualObjectId = data.dropData?.virtualObjectId || data.virtualObjectId;

                if (mode === 'move') {
                    let voToRemove = null;
                    if (this.draggingVirtualObject && this.draggingVirtualObject.parentNode) {
                        voToRemove = this.draggingVirtualObject;
                    } else if (virtualObjectId) {
                        const virtualObjectElements = this.editor.querySelectorAll('.virtual-object');
                        for (const vo of virtualObjectElements) {
                            if (vo.dataset.linkId === virtualObjectId) {
                                voToRemove = vo;
                                break;
                            }
                        }
                    }

                    if (voToRemove && voToRemove.parentNode) {
                        voToRemove.remove();
                        this.isModified = true;
                        this.updateContentHeight();
                    }
                }
            }
        });

        // load-image-file メッセージ（開いた仮身内のプラグインからの画像読み込み要求を親ウィンドウに転送）
        this.messageBus.on('load-image-file', (data) => {
            // 親ウィンドウに転送（型名を明示的に指定）
            this.messageBus.send('load-image-file', data);
        });

        // load-image-response メッセージ（親ウィンドウからのレスポンスを開いた仮身内のプラグインに転送）
        this.messageBus.on('load-image-response', (data) => {
            // すべての子iframeに転送（MessageBus形式で送信）
            const iframes = document.querySelectorAll('iframe');
            iframes.forEach(iframe => {
                if (iframe.contentWindow) {
                    iframe.contentWindow.postMessage({
                        type: 'load-image-response',
                        ...data,
                        _messageBus: true,
                        _from: 'BasicTextEditor'
                    }, '*');
                }
            });
        });

        // save-image-response メッセージ（親ウィンドウからのレスポンスを開いた仮身内のプラグインに転送）
        this.messageBus.on('save-image-response', (data) => {
            // すべての子iframeに転送（MessageBus形式で送信）
            const iframes = document.querySelectorAll('iframe');
            iframes.forEach(iframe => {
                if (iframe.contentWindow) {
                    iframe.contentWindow.postMessage({
                        type: 'save-image-response',
                        ...data,
                        _messageBus: true,
                        _from: 'BasicTextEditor'
                    }, '*');
                }
            });
        });

        // get-image-file-path メッセージ（開いた仮身内のプラグインからの画像パス取得要求を親ウィンドウに転送）
        this.messageBus.on('get-image-file-path', (data) => {
            // 親ウィンドウに転送（型名を明示的に指定）
            this.messageBus.send('get-image-file-path', data);
        });

        // image-file-path-response メッセージ（親ウィンドウからのレスポンス）
        // 自分宛の処理は PluginBase.getImageFilePath() の waitFor で処理
        // 開いた仮身内のプラグインへの転送のみ行う
        this.messageBus.on('image-file-path-response', (data) => {
            const iframes = document.querySelectorAll('iframe');
            iframes.forEach(iframe => {
                if (iframe.contentWindow) {
                    iframe.contentWindow.postMessage({
                        type: 'image-file-path-response',
                        ...data,
                        _messageBus: true,
                        _from: 'BasicTextEditor'
                    }, '*');
                }
            });
        });

        // cross-window-drop-success ハンドラはPluginBaseの共通機能に移行
        // onDeleteSourceVirtualObject()フックで仮身削除処理を実装
        this.setupCrossWindowDropSuccessHandler();

        // 検索/置換ウィンドウからのメッセージ
        this.messageBus.on('find-replace-window-created', (data) => {
            this.findReplaceWindowId = data.windowId;
        });

        this.messageBus.on('find-next-request', (data) => {
            this.findTextInEditor(data.searchText, data.isRegex);
        });

        this.messageBus.on('replace-next-request', (data) => {
            this.replaceTextInEditor(data.searchText, data.replaceText, data.isRegex);
        });

        this.messageBus.on('replace-all-request', (data) => {
            this.replaceAllTextInEditor(data.searchText, data.replaceText, data.isRegex);
        });

        logger.debug('[EDITOR] MessageBusハンドラ登録完了');
    }

    setupEventListeners() {
        // キーボードショートカット
        document.addEventListener('keydown', (e) => {
            this.handleKeyboardShortcuts(e);
        });

        // コンテンツ変更時に高さを更新（入力、削除、貼り付けなど）
        this.editor.addEventListener('input', (e) => {
            this.updateContentHeight();
            // 編集状態を記録
            this.isModified = true;
            // 用紙枠表示中はページ区切りを再計算（debounce適用）
            if (this.debouncedUpdatePageBreaks) {
                this.debouncedUpdatePageBreaks();
            }
        });

        // DOMの変更も監視（delete、backspaceなど）
        this.mutationObserver = new MutationObserver((mutations) => {
            // 一時停止カウンタが0より大きい場合はスキップ（ネスト対応）
            if (this.suppressMutationObserverCount > 0) {
                return;
            }

            // 削除された画像を検出して削除候補を収集
            const filesToDelete = new Set();
            mutations.forEach(mutation => {
                if (mutation.removedNodes) {
                    mutation.removedNodes.forEach(node => {
                        // 削除されたノードがimg要素の場合
                        if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'IMG') {
                            const savedFilename = node.getAttribute('data-saved-filename');
                            if (savedFilename && !savedFilename.startsWith('data:')) {
                                filesToDelete.add(savedFilename);
                            }
                        }
                        // 削除されたノード内にimg要素がある場合（親要素ごと削除された場合）
                        if (node.nodeType === Node.ELEMENT_NODE && node.querySelectorAll) {
                            const imgs = node.querySelectorAll('img[data-saved-filename]');
                            imgs.forEach(img => {
                                const savedFilename = img.getAttribute('data-saved-filename');
                                if (savedFilename && !savedFilename.startsWith('data:')) {
                                    filesToDelete.add(savedFilename);
                                }
                            });
                        }
                    });
                }
            });

            // 遅延して削除（DOM操作完了後に存在確認）
            if (filesToDelete.size > 0) {
                setTimeout(() => {
                    filesToDelete.forEach(filename => {
                        // DOM内に同じファイル名の画像が残っていないか確認
                        const stillExists = this.editor.querySelector(
                            `img[data-saved-filename="${filename}"]`
                        );
                        if (!stillExists) {
                            this.deleteImageFile(filename);
                        }
                    });
                }, 0);
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
            this.messageBus.send('close-context-menu');

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

        // ペーストイベント: ブラウザのネイティブペーストを防ぎ、カスタム処理を使用
        this.editor.addEventListener('paste', (e) => {
            // デフォルト動作を防止（ブラウザによる画像などの自動ペーストを防ぐ）
            e.preventDefault();
            // カスタムペースト処理を実行
            this.handlePaste(e);
        });

        // 選択変更イベント: メニュー操作用に選択テキストを保存、カーソル位置をトラッキング
        document.addEventListener('selectionchange', () => {
            const selection = window.getSelection();
            const selectedText = selection.toString();
            if (selectedText) {
                this.lastSelectedText = selectedText;
            }
        });

        // 初期高さを設定
        setTimeout(() => this.updateContentHeight(), window.UI_UPDATE_DELAY_MS);

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

            // URLドロップをチェック（PluginBase共通メソッド）
            const dropX = e.clientX;
            const dropY = e.clientY;
            if (this.checkAndHandleUrlDrop(e, dropX, dropY)) {
                return; // URLドロップは親ウィンドウで処理
            }

            try {
                // 選択中の画像を移動する場合
                if (this.isDraggingImage && this.draggingImage) {
                    logger.debug('[EDITOR] 画像を移動');
                    await this.moveImageToCursor(e, this.draggingImage);
                    this.isDraggingImage = false;
                    this.draggingImage = null;
                    return;
                }

                // 仮身をドロップして移動/コピーする場合
                if (this.isDraggingVirtualObject && this.draggingVirtualObjectData) {
                    // ドロップ位置にカーソルを設定
                    this.setCursorAtDropPosition(e);

                    const selection = window.getSelection();
                    if (selection.rangeCount > 0 && this.draggingVirtualObject && this.draggingVirtualObject.parentNode) {
                        // コピーモードの場合は元の仮身を残し、新しい仮身を作成
                        if (this.virtualObjectDragState.dragMode === 'copy') {
                            logger.debug('[EDITOR] コピーモードでドロップ: 元の仮身を保持し、新しい仮身を作成');

                            const range = selection.getRangeAt(0);
                            range.deleteContents();

                            // 元の仮身要素をクローン
                            const clonedVo = this.draggingVirtualObject.cloneNode(true);

                            // クローンのイベントハンドラフラグを削除（新しいハンドラを登録できるようにする）
                            delete clonedVo.dataset.handlersAttached;

                            // クローンを挿入
                            range.insertNode(clonedVo);

                            // 仮身の後にスペースを追加（カーソル移動のため）
                            const space = document.createTextNode(' ');
                            clonedVo.parentNode.insertBefore(space, clonedVo.nextSibling);

                            // カーソルを仮身の後に移動
                            const newRange = document.createRange();
                            newRange.setStartAfter(space);
                            newRange.collapse(true);
                            selection.removeAllRanges();
                            selection.addRange(newRange);

                            // 元の仮身の透明度を元に戻す
                            this.draggingVirtualObject.style.opacity = '1';

                            // クローンされた仮身にイベントハンドラを再設定
                            // setupVirtualObjectEventHandlers() は全ての仮身要素に対してイベントリスナーを設定する
                            this.setupVirtualObjectEventHandlers();

                            // ドロップ成功フラグを設定（dragendで元の仮身を削除しないように）
                            this.virtualObjectDropSuccess = true;
                        } else {
                            // 移動モード（既存の処理）
                            logger.debug('[EDITOR] 移動モードでドロップ');

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

                            // 仮身移動完了（表示属性保持）
                            // ドロップ成功フラグを設定（dragendで元の仮身を削除しないように）
                            // 注: 元の仮身要素を移動しているため、dragendで削除する必要はない
                            this.virtualObjectDropSuccess = true;
                        }
                    }

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
                        await this.insertImageFile(file);
                        return;
                    }
                }

                // PluginBase共通メソッドでdragDataをパース
                const dragData = this.parseDragData(e.dataTransfer);
                if (dragData) {
                    if ((dragData.type === 'base-file-copy' || dragData.type === 'user-base-file-copy') && dragData.source === 'base-file-manager') {
                        // 原紙管理からのコピー（システム原紙またはユーザ原紙）- 親ウィンドウに処理を委譲
                        this.setCursorAtDropPosition(e);
                        this.handleBaseFileDrop(dragData, e.clientX, e.clientY);
                        return;
                    } else if (dragData.type === 'archive-file-extract' && dragData.source === 'unpack-file') {
                        // 書庫解凍からのファイル展開
                        this.extractArchiveFile(dragData.file, dragData.fileIdMap);
                        return;
                    } else if (dragData.type === 'virtual-object-drag') {
                        // 任意のプラグインからの仮身ドロップ
                        logger.debug(`[EDITOR] 仮身ドロップを検出: source=${dragData.source}, isDuplicateDrag=${dragData.isDuplicateDrag}`);
                        const virtualObjects = dragData.virtualObjects || [dragData.virtualObject];

                        // ドロップ位置にカーソルを設定
                        this.setCursorAtDropPosition(e);

                        // 複数の仮身を順番に挿入
                        for (let index = 0; index < virtualObjects.length; index++) {
                            const virtualObject = virtualObjects[index];
                            let targetVirtualObject = virtualObject;

                            // ダブルクリックドラッグ（実身複製）の場合
                            if (dragData.isDuplicateDrag) {
                                logger.debug('[EDITOR] 実身複製ドラッグを検出');
                                try {
                                    targetVirtualObject = await this.duplicateRealObjectForDrag(virtualObject);
                                    logger.debug(`[EDITOR] 実身複製成功: ${virtualObject.link_id} -> ${targetVirtualObject.link_id}`);
                                } catch (error) {
                                    logger.error('[EDITOR] 実身複製エラー:', error);
                                    continue;
                                }
                            }

                            this.insertVirtualObjectLink(targetVirtualObject);
                            if (index < virtualObjects.length - 1) {
                                document.execCommand('insertText', false, ' ');
                            }

                            // コピーモードの場合はrefCount+1（移動モードは変更なし）
                            if (dragData.mode === 'copy') {
                                this.requestCopyVirtualObject(targetVirtualObject.link_id);
                            }
                        }

                        this.isModified = true;
                        this.updateContentHeight();
                        this.notifyCrossWindowDropSuccess(dragData, virtualObjects);
                        return;
                    }
                }
                // 通常のテキストドロップの場合は、デフォルト動作を許可
            } catch (error) {
                logger.error('[EDITOR] ドロップ処理エラー:', error);
            }
        });

        // 右ボタン処理はPluginBaseのsetupVirtualObjectRightButtonHandlers()で処理

        // ダブルクリック+ドラッグ用のグローバルmousemoveハンドラー
        document.addEventListener('mousemove', (e) => {
            // ダブルクリック+ドラッグ候補の検出
            // 共通メソッドでドラッグ開始判定
            if (this.shouldStartDblClickDrag(e)) {
                logger.debug('[EDITOR] ダブルクリック+ドラッグを確定（ドラッグ完了待ち）');

                // 視覚的なフィードバック用の半透明仮身枠を作成（プラグイン固有）
                const vo = this.dblClickDragState.dblClickedElement;
                if (vo && !this.dblClickDragState.dragPreview) {
                    const preview = vo.cloneNode(true);
                    preview.style.position = 'fixed';
                    preview.style.opacity = '0.5';
                    preview.style.pointerEvents = 'none';
                    preview.style.zIndex = '10000';
                    preview.style.willChange = 'transform'; // GPU最適化
                    preview.style.transform = `translate(${e.clientX + 10}px, ${e.clientY + 10}px)`;
                    preview.classList.add('drag-preview');
                    document.body.appendChild(preview);
                    this.dblClickDragState.dragPreview = preview;
                }
            }

            // ドラッグ中のプレビュー位置を更新（requestAnimationFrameで滑らかに）
            if (this.dblClickDragState.isDblClickDrag && this.dblClickDragState.dragPreview) {
                // 最新のマウス座標を保存
                this.dblClickDragState.lastMouseX = e.clientX;
                this.dblClickDragState.lastMouseY = e.clientY;

                // requestAnimationFrameがまだ実行されていない場合のみ予約
                if (!this.dblClickDragState.rafId) {
                    this.dblClickDragState.rafId = requestAnimationFrame(() => {
                        const preview = this.dblClickDragState.dragPreview;
                        if (preview) {
                            // transformを使用（レイアウト再計算を回避、GPU合成のみ）
                            preview.style.transform = `translate(${this.dblClickDragState.lastMouseX + 10}px, ${this.dblClickDragState.lastMouseY + 10}px)`;
                        }
                        this.dblClickDragState.rafId = null;
                    });
                }
            }
        });

        // ダブルクリック+ドラッグ用のグローバルmouseupハンドラー
        document.addEventListener('mouseup', (e) => {
            // ダブルクリック+ドラッグ確定後のmouseup処理（実身複製）
            if (this.dblClickDragState.isDblClickDrag && e.button === 0) {
                logger.debug('[EDITOR] ダブルクリック+ドラッグ完了、実身を複製');
                const vo = this.dblClickDragState.dblClickedElement;

                // requestAnimationFrameをキャンセル
                if (this.dblClickDragState.rafId) {
                    cancelAnimationFrame(this.dblClickDragState.rafId);
                    this.dblClickDragState.rafId = null;
                }

                // プレビューを削除
                if (this.dblClickDragState.dragPreview) {
                    // GPU最適化を解除（メモリ節約）
                    this.dblClickDragState.dragPreview.style.willChange = 'auto';
                    this.dblClickDragState.dragPreview.remove();
                    this.dblClickDragState.dragPreview = null;
                }

                if (vo) {
                    // エディタ内での座標を計算
                    const editorRect = this.editor.getBoundingClientRect();
                    const dropX = e.clientX - editorRect.left + this.editor.scrollLeft;
                    const dropY = e.clientY - editorRect.top + this.editor.scrollTop;

                    this.handleDoubleClickDragDuplicate(vo, dropX, dropY);
                }

                // 状態をリセット（共通メソッド使用）
                this.cleanupDblClickDragState();
                return;
            }

            // ダブルクリック候補でドラッグしなかった場合
            // 既存のdblclickイベントハンドラに処理を任せる（展開処理は不要）
            if (this.dblClickDragState.isDblClickDragCandidate && e.button === 0) {
                logger.debug('[EDITOR] ダブルクリック検出、既存のdblclickイベントに処理を委譲');

                // requestAnimationFrameをキャンセル（念のため）
                if (this.dblClickDragState.rafId) {
                    cancelAnimationFrame(this.dblClickDragState.rafId);
                    this.dblClickDragState.rafId = null;
                }

                // プレビューがあれば削除（念のため）
                if (this.dblClickDragState.dragPreview) {
                    this.dblClickDragState.dragPreview.style.willChange = 'auto';
                    this.dblClickDragState.dragPreview.remove();
                    this.dblClickDragState.dragPreview = null;
                }

                // 状態をリセット（共通メソッド使用）
                this.cleanupDblClickDragState();
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
            const selectedText = selection.toString();

            // 選択範囲に仮身が含まれているか確認
            const hasVirtualObject = container.querySelector('.virtual-object') !== null;

            if (!hasVirtualObject) {
                // 仮身が含まれていない場合でもグローバルクリップボードを更新
                // （Ctrl+Cでブラウザのデフォルトコピーと同時に実行される）
                if (selectedText) {
                    this.setTextClipboard(selectedText);
                    // テキストコピー時はローカルの画像・仮身クリップボードをクリア
                    // （ペースト時にテキストが優先されるようにする）
                    this.imageClipboard = null;
                    this.virtualObjectClipboard = null;
                }
                return; // ブラウザのデフォルト動作も許可
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

            logger.debug('[EDITOR] コピー内容（XML）:', xmlContent);
            logger.debug('[EDITOR] コピー内容（プレーンテキスト）:', plainText);

            // クリップボードに両方の形式でコピー
            e.clipboardData.setData('text/plain', plainText);
            e.clipboardData.setData('text/html', xmlContent);
            e.clipboardData.setData('application/x-tad-xml', xmlContent);

            this.setStatus('クリップボードへコピーしました（仮身を含む）');
        } catch (error) {
            logger.error('[EDITOR] コピーエラー:', error);
            // エラー時はデフォルト動作を許可
        }
    }

    /**
     * ペーストイベントを処理
     * テキストを優先し、画像のみの場合は画像を挿入
     */
    async handlePaste(e) {
        try {
            // 読み取り専用の場合はペーストを無視
            if (this.editor.contentEditable === 'false') {
                this.setStatus('読み取り専用モードです');
                return;
            }

            // ローカルクリップボードを最優先でチェック（画像・仮身）
            if (this.imageClipboard) {
                this.pasteImage();
                this.setStatus('画像をクリップボードから貼り付けました');
                return;
            }

            if (this.virtualObjectClipboard) {
                this.pasteVirtualObject();
                this.setStatus('仮身をクリップボードから貼り付けました');
                return;
            }

            // clipboardDataからデータを取得
            const clipboardData = e.clipboardData;
            if (!clipboardData) {
                // clipboardDataがない場合はグローバルクリップボード経由でペースト
                await this.pasteFromGlobalClipboard();
                return;
            }

            // TAD XMLデータをチェック（仮身を含むコピー）
            const tadXml = clipboardData.getData('application/x-tad-xml');
            if (tadXml) {
                logger.debug('[EDITOR] TAD XMLをペースト:', tadXml);
                const htmlContent = await this.renderTADXML(tadXml);
                document.execCommand('insertHTML', false, htmlContent);
                this.updateParagraphLineHeight(); // 段落のline-heightを更新
                this.isModified = true;
                this.setStatus('仮身を含むコンテンツを貼り付けました');
                return;
            }

            // グローバルクリップボードをチェック（アプリ内コピーを優先）
            const globalClipboard = await this.getGlobalClipboard();

            // グローバルクリップボードにテキストがある場合は優先使用
            // （メニュー操作等でシステムクリップボード書き込みが失敗した場合に対応）
            if (globalClipboard && globalClipboard.type === 'text' && globalClipboard.text) {
                document.execCommand('insertText', false, globalClipboard.text);
                this.updateParagraphLineHeight(); // 段落のline-heightを更新
                this.isModified = true;
                this.setStatus('テキストをクリップボードから貼り付けました');
                return;
            }

            // グローバルクリップボードにテキストがない場合はシステムクリップボードを使用
            const text = clipboardData.getData('text/plain');
            if (text) {
                document.execCommand('insertText', false, text);
                this.updateParagraphLineHeight(); // 段落のline-heightを更新
                this.isModified = true;
                this.setStatus('クリップボードから貼り付けました');
                return;
            }

            // テキストがない場合は画像・仮身をチェック
            if (globalClipboard && globalClipboard.type === 'image' && globalClipboard.dataUrl) {
                await this.insertImageFromDataUrl(globalClipboard.dataUrl, globalClipboard.name || 'image.png');
                this.setStatus('画像をクリップボードから貼り付けました');
                return;
            }

            if (globalClipboard && globalClipboard.link_id) {
                this.insertVirtualObjectLink(globalClipboard);
                this.requestCopyVirtualObject(globalClipboard.link_id);
                this.setStatus('仮身をクリップボードから貼り付けました');
                return;
            }

            // 画像ファイルをチェック（テキストがない場合のみ）
            const items = clipboardData.items;
            if (items) {
                for (let i = 0; i < items.length; i++) {
                    if (items[i].type.startsWith('image/')) {
                        const blob = items[i].getAsFile();
                        if (blob) {
                            const reader = new FileReader();
                            reader.onload = async (event) => {
                                await this.insertImageFromDataUrl(event.target.result, 'clipboard_image.png');
                                this.setStatus('画像をクリップボードから貼り付けました');
                            };
                            reader.readAsDataURL(blob);
                            return;
                        }
                    }
                }
            }

            this.setStatus('貼り付け可能なデータがありません');
        } catch (error) {
            logger.error('[EDITOR] ペーストエラー:', error);
            this.setStatus('貼り付けに失敗しました');
        }
    }

    /**
     * 原紙ファイルの内容を挿入
     */
    async insertBaseFileContent(baseFile) {
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
        }
    }

    /**
     * 仮身リンクを挿入
     * @param {Object} virtualObject - 仮身オブジェクト
     */
    insertVirtualObjectLink(virtualObject) {

        // VirtualObjectRendererを使って仮身要素を作成
        let vobjElement;
        if (this.virtualObjectRenderer) {
            // アイコンパス直接指定（プラグインフォルダ内のアイコンファイル）
            const options = {
                loadIconCallback: (realId) => this.iconManager.loadIcon(realId)
            };
            vobjElement = this.virtualObjectRenderer.createInlineElement(virtualObject, options);
        } else {
            // フォールバック: VirtualObjectRendererが利用できない場合
            logger.warn('[EDITOR] VirtualObjectRenderer not available, using fallback');
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

            // 実身IDを抽出（共通メソッドを使用）
            const realId = window.RealObjectSystem.extractRealId(virtualObject.link_id);

            this.contextMenuVirtualObject = {
                virtualObj: virtualObject,
                element: vobjElement,
                realId: realId
            };

            // 親ウィンドウにコンテキストメニューを要求（共通メソッドを使用）
            this.showContextMenuAtEvent(e);
        });

        // カーソル位置に挿入
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            range.deleteContents();
            range.insertNode(vobjElement);

            // 仮身が<p>要素内に配置されていることを確認
            this.ensureInsideParagraph(vobjElement);

            // カーソルを仮身の後ろに移動
            range.setStartAfter(vobjElement);
            range.setEndAfter(vobjElement);
            selection.removeAllRanges();
            selection.addRange(range);
        } else {
            // カーソル位置がない場合は新しい段落を作成して末尾に追加
            const p = document.createElement('p');
            p.appendChild(vobjElement);
            this.editor.appendChild(p);
        }

        this.updateContentHeight();
        this.updateParagraphLineHeight(); // 段落のline-heightを更新

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
    }

    /**
     * 画像ファイルを挿入
     * @param {File} file - 画像ファイル
     */
    async insertImageFile(file) {

        try {
            // 画像をロード
            const img = new Image();
            const reader = new FileReader();

            const imageData = await new Promise((resolve, reject) => {
                reader.onload = (e) => {
                    img.onload = () => {
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
            const imgNo = await this.getNextImageNumber();

            // ファイル名を生成: realId_recordNo_imgNo.png
            // this.realIdから _数字.xtad を完全に除去
            let realId = this.realId || 'unknown';
            realId = realId.replace(/_\d+\.xtad$/i, '');  // 念のため再度除去
            const recordNo = 0;  // 常に0（実身の最初のレコード）
            const extension = file.name.split('.').pop().toLowerCase();
            const savedFileName = `${realId}_${recordNo}_${imgNo}.${extension}`;

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

        } catch (error) {
            logger.error('[EDITOR] 画像挿入エラー:', error);
            this.setStatus('画像の挿入に失敗しました');
        }
    }

    /**
     * DataURLから画像を挿入（グローバルクリップボードからのペースト用）
     * @param {string} dataUrl - 画像のDataURL
     * @param {string} fileName - ファイル名
     */
    async insertImageFromDataUrl(dataUrl, fileName = 'image.png') {
        try {
            // 画像をロード
            const img = new Image();

            const imageData = await new Promise((resolve, reject) => {
                img.onload = () => {
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
                        dataUrl: dataUrl,
                        displayWidth: displayWidth,
                        displayHeight: displayHeight,
                        originalWidth: img.width,
                        originalHeight: img.height
                    });
                };

                img.onerror = () => {
                    reject(new Error('画像読み込みエラー'));
                };

                img.src = dataUrl;
            });

            // 画像番号を取得
            const imgNo = await this.getNextImageNumber();

            // ファイル名を生成: realId_recordNo_imgNo.png
            let realId = this.realId || 'unknown';
            realId = realId.replace(/_\d+\.xtad$/i, '');
            const recordNo = 0;
            const extension = fileName.split('.').pop().toLowerCase() || 'png';
            const savedFileName = `${realId}_${recordNo}_${imgNo}.${extension}`;

            // 画像ファイルを保存（PluginBase共通メソッド使用）
            await this.saveImageFile(dataUrl, savedFileName);

            // 画像の色深度情報を設定（PNGの場合の標準値）
            const planes = 3;
            const pixbits = 0x0818;

            // 画像要素を作成
            const imgElement = document.createElement('img');
            imgElement.src = imageData.dataUrl;
            imgElement.style.maxWidth = '100%';
            imgElement.style.height = 'auto';
            imgElement.style.display = 'inline-block';
            imgElement.style.verticalAlign = 'middle';
            imgElement.style.margin = '4px';
            imgElement.setAttribute('data-original-filename', fileName);
            imgElement.setAttribute('data-saved-filename', savedFileName);
            imgElement.setAttribute('data-mime-type', 'image/png');
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

        } catch (error) {
            logger.error('[EDITOR] DataURLからの画像挿入エラー:', error);
            this.setStatus('画像の挿入に失敗しました');
        }
    }

    /**
     * 選択中の仮身をdefaultOpenアプリで開く
     */
    async openSelectedVirtualObject() {
        if (!this.selectedVirtualObject) {
            logger.warn('[EDITOR] 選択中の仮身がありません');
            return;
        }

        const vo = this.selectedVirtualObject;
        const linkId = vo.dataset.linkId;
        const linkName = vo.dataset.linkName;

        // 実身IDを抽出（共通メソッドを使用）
        const realId = window.RealObjectSystem.extractRealId(linkId);

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

                    this.messageBus.send('open-virtual-object-real', {
                    virtualObj: virtualObj,
                    pluginId: defaultOpen
                });
            } else {
                this.setStatus('defaultOpenが設定されていません');
            }
        } catch (error) {
            logger.error('[EDITOR] defaultOpen取得エラー:', error);
            this.setStatus('defaultOpenの取得に失敗しました');
        }
    }

    /**
     * 仮身を開く
     * @param {Object} virtualObject - 仮身オブジェクト
     */
    openVirtualObject(virtualObject) {
        logger.debug('[EDITOR] 仮身を開く:', virtualObject.link_name, virtualObject.link_id);

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

        // 親ウィンドウにメッセージを送信して仮身リンク先を開く
        this.messageBus.send('open-virtual-object-real', {
            virtualObj: virtualObject,
            pluginId: defaultPluginId
        });
    }

    /**
     * 書庫ファイルを展開して.xtadファイルとして生成
     */
    async extractArchiveFile(file, fileIdMap) {
        try {
            // fileオブジェクトから直接XMLデータを取得
            const xmlData = file.xmlData;

            if (xmlData) {
                // ファイル名を生成: UUID_recordIndex.xtad
                const filename = `${file.fileId}_${file.recordIndex}.xtad`;

                // .xtadファイルとしてダウンロード
                this.downloadAsXtad(xmlData, filename);
            } else {
                logger.error('[EDITOR] XMLデータの取得に失敗 - fileオブジェクトにxmlDataが含まれていません');
            }

        } catch (error) {
            logger.error('[EDITOR] 書庫ファイル展開エラー:', error);
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
        }
    }

    /**
     * ウィンドウリサイズ完了時のフック（PluginBase共通ハンドラから呼ばれる）
     * リサイズで折り返しが変わる可能性があるため、スクロールバーを更新
     * @param {Object} data - リサイズデータ { pos, width, height }
     */
    onWindowResizedEnd(data) {
        this.updateContentHeight();
    }

    /**
     * ウィンドウ最大化切り替え時のフック（PluginBase共通ハンドラから呼ばれる）
     * 全画面切り替えで折り返しが変わる可能性があるため、スクロールバーを更新
     * @param {Object} data - 最大化データ { pos, width, height, maximize }
     */
    onWindowMaximizeToggled(data) {
        this.updateContentHeight();
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

            this.messageBus.send(message.type, message);

            // スクロールバー更新要求を送信
            this.notifyScrollChange();
        }
    }

    handleKeyboardShortcuts(e) {
        // Tab: 行頭移動指定付箋を挿入
        if (e.key === 'Tab' && !e.ctrlKey && !e.shiftKey) {
            e.preventDefault();
            this.insertTextTab();
            return;
        }

        // Enter: 改段落（通常の改行）- カーソル直前の文字サイズで行間を設定
        if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
            e.preventDefault();

            // MutationObserverを一時停止
            this.suppressMutationObserverCount++;

            const selection = window.getSelection();
            if (selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);

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

                // カーソル位置のスタイルを取得（スタイル引き継ぎ用）
                let caretStyle = this.getCaretStyle(container);

                // containerがP要素の場合、カーソルがspan外（段落末尾など）にある可能性がある
                // その場合、段落内の最後のスタイル付き要素からスタイルを取得
                if (container.nodeName === 'P') {
                    // 段落内の最後のテキストを含む要素を探す
                    let lastStyledElement = this.findLastStyledElement(container);
                    if (lastStyledElement && lastStyledElement !== container) {
                        caretStyle = this.getCaretStyle(lastStyledElement);
                    } else if (container.style.fontSize) {
                        // 段落自体にstyle.fontSizeが設定されている場合（空の段落など）
                        // pt単位をpx単位に変換してcaretStyleに設定
                        let fontSizePt = parseFloat(container.style.fontSize);
                        if (container.style.fontSize.endsWith('pt')) {
                            caretStyle.fontSize = (fontSizePt * 1.333) + 'px';
                        }
                    }
                }

                const needsInherit = this.needsStyleInherit(caretStyle);

                // 現在の段落要素を取得
                let currentP = range.startContainer;
                while (currentP && currentP.nodeName !== 'P' && currentP !== this.editor) {
                    currentP = currentP.parentElement;
                }

                if (currentP && currentP.nodeName === 'P') {

                    // 現在の段落が空（<br>のみ、またはスタイル継承spanのみ）かチェック
                    let isEmpty = currentP.childNodes.length === 1 &&
                                 currentP.firstChild.nodeName === 'BR';

                    // スタイル継承spanのみの場合も空として扱う
                    // 構造: <p><span style="...">​<br></span></p>
                    // ※ブラウザによりノード構造が異なる可能性があるため、
                    //   ノード数ではなくテキストコンテンツで判定する
                    if (!isEmpty && currentP.childNodes.length === 1 &&
                        currentP.firstChild.nodeName === 'SPAN') {
                        const span = currentP.firstChild;
                        // spanのテキストコンテンツがゼロ幅スペースのみ、または空の場合
                        const textContent = span.textContent.replace(/\u200B/g, '').trim();
                        if (textContent === '') {
                            isEmpty = true;
                        }
                    }

                    // 新しい段落を作成
                    const newP = document.createElement('p');
                    newP.innerHTML = '<br>';

                    // インデントスタイルをcurrentPからコピー（padding-left, text-indent）
                    if (currentP.style.paddingLeft) {
                        newP.style.paddingLeft = currentP.style.paddingLeft;
                    }
                    if (currentP.style.textIndent) {
                        newP.style.textIndent = currentP.style.textIndent;
                    }

                    // スタイル引き継ぎ用のspanを保持
                    let styleSpan = null;

                    if (!isEmpty) {
                        // 空でない場合は、カーソル位置で段落を分割
                        const afterRange = range.cloneRange();
                        afterRange.setEndAfter(currentP.lastChild || currentP);
                        const afterContent = afterRange.extractContents();

                        // 分割後の内容を新しい段落に追加
                        if (afterContent.textContent.trim() === '') {
                            // テキストが空の場合、スタイル引き継ぎが必要ならspanを追加
                            if (needsInherit) {
                                newP.innerHTML = '';
                                styleSpan = this.createStyleInheritSpan(caretStyle);
                                // スタイル継承spanに<br>を追加（行高とカーソル配置のため）
                                styleSpan.appendChild(document.createElement('br'));
                                newP.appendChild(styleSpan);

                                // 段落にもフォントサイズを設定（extractFontSize対応）
                                let fontSizePt = parseFloat(caretStyle.fontSize);
                                if (caretStyle.fontSize && caretStyle.fontSize.endsWith('px')) {
                                    fontSizePt = fontSizePt / 1.333;  // px → pt 変換
                                }
                                fontSizePt = Math.round(fontSizePt * 10) / 10;
                                if (Math.abs(fontSizePt - 14) > 0.5) {
                                    newP.style.fontSize = `${fontSizePt}pt`;
                                }
                            }
                            // スタイル引き継ぎ不要なら<br>を保持（既に設定済み）
                        } else {
                            // 実際の内容がある場合は追加
                            newP.innerHTML = ''; // 既存の<br>をクリア
                            newP.appendChild(afterContent);

                            // extractContents()後に残る空のspan構造をクリーンアップ
                            this.removeEmptySpans(newP);

                            // newPにもフォントサイズを設定（コンテンツがある場合でも）
                            if (needsInherit) {
                                let fontSizePt = parseFloat(caretStyle.fontSize);
                                if (caretStyle.fontSize && caretStyle.fontSize.endsWith('px')) {
                                    fontSizePt = fontSizePt / 1.333;
                                }
                                fontSizePt = Math.round(fontSizePt * 10) / 10;
                                if (Math.abs(fontSizePt - 14) > 0.5) {
                                    newP.style.fontSize = `${fontSizePt}pt`;
                                }
                            }
                        }
                    } else {
                        // isEmpty の場合もスタイル引き継ぎが必要ならspanを追加
                        if (needsInherit) {
                            newP.innerHTML = '';
                            styleSpan = this.createStyleInheritSpan(caretStyle);
                            // スタイル継承spanに<br>を追加（行高とカーソル配置のため）
                            styleSpan.appendChild(document.createElement('br'));
                            newP.appendChild(styleSpan);

                            // 段落にもフォントサイズを設定（extractFontSize対応）
                            let fontSizePt = parseFloat(caretStyle.fontSize);
                            if (caretStyle.fontSize && caretStyle.fontSize.endsWith('px')) {
                                fontSizePt = fontSizePt / 1.333;  // px → pt 変換
                            }
                            fontSizePt = Math.round(fontSizePt * 10) / 10;
                            if (Math.abs(fontSizePt - 14) > 0.5) {
                                newP.style.fontSize = `${fontSizePt}pt`;
                            }
                        }
                    }
                    // また、元の段落が空になった場合もスタイル引き継ぎ処理
                    if (!isEmpty && currentP.childNodes.length === 0) {
                        if (needsInherit) {
                            // フォントサイズ引き継ぎが必要な場合はstyleSpanを追加
                            const currentStyleSpan = this.createStyleInheritSpan(caretStyle);
                            currentStyleSpan.appendChild(document.createElement('br'));
                            currentP.appendChild(currentStyleSpan);

                            // 段落にもフォントサイズを設定（extractFontSize対応）
                            let fontSizePt = parseFloat(caretStyle.fontSize);
                            if (caretStyle.fontSize && caretStyle.fontSize.endsWith('px')) {
                                fontSizePt = fontSizePt / 1.333;
                            }
                            fontSizePt = Math.round(fontSizePt * 10) / 10;
                            if (Math.abs(fontSizePt - 14) > 0.5) {
                                currentP.style.fontSize = `${fontSizePt}pt`;
                            }
                        } else {
                            currentP.innerHTML = '<br>';
                        }
                    }

                    // 新段落の内容に基づいてline-heightを設定
                    // 空の段落（<br>のみ）: デフォルトサイズ（14pt）基準
                    // コンテンツあり: そのコンテンツの最大フォントサイズ基準
                    let newParagraphFontSize = 14; // デフォルト
                    if (newP.textContent.trim() !== '') {
                        // 新段落にコンテンツがある場合は最大フォントサイズを計算
                        newParagraphFontSize = this.calculateMaxFontSizeInContent(newP, 14);
                    } else if (needsInherit) {
                        // 空だがスタイル引き継ぎがある場合は引き継いだサイズを使用
                        newParagraphFontSize = parseFloat(caretStyle.fontSize) || 14;
                    }
                    const lineHeight = this.calculateLineHeight(newParagraphFontSize);
                    newP.style.lineHeight = `${lineHeight}px`;

                    // 現在の段落の後に新しい段落を挿入（最下段対応）
                    if (currentP.nextSibling) {
                        currentP.parentNode.insertBefore(newP, currentP.nextSibling);
                    } else {
                        currentP.parentNode.appendChild(newP);
                    }

                    // カーソルを新しい段落の先頭に移動
                    const newRange = document.createRange();
                    if (styleSpan) {
                        // スタイル引き継ぎspanがある場合、ゼロ幅スペースのテキストノード内にカーソルを配置
                        // テキストノードのオフセット1（ゼロ幅スペースの後）に配置することで
                        // 入力文字が確実にテキストノードに追加され、spanのスタイルが適用される
                        newRange.setStart(styleSpan.firstChild, 1);  // ゼロ幅スペースの後
                    } else if (newP.firstChild) {
                        // <br>がある場合は、その前にカーソルを配置
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
                    // 段落要素が見つからない場合はデフォルト処理
                    const p = document.createElement('p');

                    // スタイル引き継ぎ用のspan
                    let styleSpanAlt = null;
                    if (needsInherit) {
                        styleSpanAlt = this.createStyleInheritSpan(caretStyle);
                        p.appendChild(styleSpanAlt);
                    } else {
                        p.innerHTML = '<br>';
                    }

                    // line-height設定（スタイル引き継ぎがある場合はそのサイズを使用）
                    let altFontSize = 14;
                    if (needsInherit) {
                        altFontSize = parseFloat(caretStyle.fontSize) || 14;
                    }
                    const lineHeight = this.calculateLineHeight(altFontSize);
                    p.style.lineHeight = `${lineHeight}px`;

                    range.deleteContents();
                    range.insertNode(p);
                    const newRange = document.createRange();
                    if (styleSpanAlt) {
                        // スタイル引き継ぎspanがある場合、その中のゼロ幅スペースの後にカーソルを配置
                        newRange.setStart(styleSpanAlt.firstChild, 1);
                        newRange.setEnd(styleSpanAlt.firstChild, 1);
                    } else if (p.firstChild) {
                        // <br>がある場合は、その前にカーソルを配置
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
                this.suppressMutationObserverCount--;
                this.updateContentHeight();
            }, 0);

            return;
        }

        // Shift+Enter または Ctrl+Enter: 改行（<br>）を挿入
        if ((e.shiftKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();

            // MutationObserverを一時停止
            this.suppressMutationObserverCount++;

            // <br>タグを挿入
            const selection = window.getSelection();
            if (selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                const br = document.createElement('br');
                range.deleteContents();
                range.insertNode(br);

                // <br>の後にゼロ幅スペースのテキストノードを挿入
                // ゼロ幅スペースによりカーソル位置が確実に保持される
                const textNode = document.createTextNode('\u200B');
                br.parentNode.insertBefore(textNode, br.nextSibling);

                // 新しいRangeを作成してカーソルを配置
                const newRange = document.createRange();
                newRange.setStart(textNode, 1); // ゼロ幅スペースの後
                newRange.collapse(true);
                selection.removeAllRanges();
                selection.addRange(newRange);

                // 改行位置をスクロール表示（必要最小限のスクロール）
                br.scrollIntoView({ block: 'nearest' });
            }

            // DOM操作完了後、MutationObserverを再開
            setTimeout(() => {
                this.suppressMutationObserverCount--;
                this.updateContentHeight();
            }, 0);

            return;
        }

        // Backspace: ゼロ幅スペース+<br>のセット削除
        if (e.key === 'Backspace') {
            const selection = window.getSelection();
            if (selection.rangeCount > 0 && selection.isCollapsed) {
                const range = selection.getRangeAt(0);
                const node = range.startContainer;
                const offset = range.startOffset;

                // カーソルがテキストノード内でオフセット1の位置にあり、
                // そのテキストノードがゼロ幅スペースで始まる場合
                if (node.nodeType === Node.TEXT_NODE && offset === 1 &&
                    node.textContent.charAt(0) === '\u200B') {

                    // ケース2を先にチェック: 直前のノードが<br>の場合（Shift+Enterで挿入）
                    // ※ケース1より優先。<br>+ZWSPのセットを削除する
                    const prevSibling = node.previousSibling;
                    if (prevSibling && prevSibling.nodeName === 'BR') {
                        e.preventDefault();

                        // MutationObserverを一時停止
                        this.suppressMutationObserverCount++;

                        // ゼロ幅スペースを削除
                        node.textContent = node.textContent.substring(1);

                        // <br>を削除
                        prevSibling.parentNode.removeChild(prevSibling);

                        // カーソル位置を調整（テキストノードが空になった場合は直前のノードへ）
                        if (node.textContent.length === 0) {
                            // 空のテキストノードを削除
                            const parent = node.parentNode;
                            const prevNode = node.previousSibling;
                            parent.removeChild(node);

                            // 直前のノードにカーソルを移動
                            if (prevNode) {
                                const newRange = document.createRange();
                                if (prevNode.nodeType === Node.TEXT_NODE) {
                                    newRange.setStart(prevNode, prevNode.textContent.length);
                                } else {
                                    newRange.setStartAfter(prevNode);
                                }
                                newRange.collapse(true);
                                selection.removeAllRanges();
                                selection.addRange(newRange);
                            }
                        } else {
                            // テキストノードの先頭にカーソルを移動
                            const newRange = document.createRange();
                            newRange.setStart(node, 0);
                            newRange.collapse(true);
                            selection.removeAllRanges();
                            selection.addRange(newRange);
                        }

                        // DOM操作完了後、MutationObserverを再開
                        setTimeout(() => {
                            this.suppressMutationObserverCount--;
                            this.updateContentHeight();
                        }, 0);

                        return;
                    }

                    // ケース1: span内のゼロ幅スペースのみの場合（applyFontColor等で挿入）
                    // ※spanがZWSPテキストノードのみを含む場合のみ適用
                    const parent = node.parentNode;
                    if (parent && parent.nodeName === 'SPAN' &&
                        node.textContent === '\u200B' &&
                        parent.childNodes.length === 1) {
                        e.preventDefault();

                        // MutationObserverを一時停止
                        this.suppressMutationObserverCount++;

                        // spanの前にカーソルを移動してからspanを削除
                        const spanParent = parent.parentNode;
                        const prevNode = parent.previousSibling;

                        const newRange = document.createRange();
                        if (prevNode && prevNode.nodeType === Node.TEXT_NODE) {
                            newRange.setStart(prevNode, prevNode.textContent.length);
                        } else if (prevNode) {
                            newRange.setStartAfter(prevNode);
                        } else {
                            newRange.setStart(spanParent, 0);
                        }
                        newRange.collapse(true);
                        selection.removeAllRanges();
                        selection.addRange(newRange);

                        // spanを削除
                        spanParent.removeChild(parent);

                        // DOM操作完了後、MutationObserverを再開
                        setTimeout(() => {
                            this.suppressMutationObserverCount--;
                            this.updateContentHeight();
                        }, 0);

                        return;
                    }

                }

                // ケース3: offset === 0で直前のノードが<br>の場合
                // （マウスクリック時やファイル再読み込み後にカーソルがoffset 0に配置される場合の対応）
                if (node.nodeType === Node.TEXT_NODE && offset === 0) {
                    let prevSibling = node.previousSibling;

                    // 直前がゼロ幅スペースのみのテキストノードの場合はスキップ
                    if (prevSibling && prevSibling.nodeType === Node.TEXT_NODE &&
                        prevSibling.textContent === '\u200B') {
                        prevSibling = prevSibling.previousSibling;
                    }

                    if (prevSibling && prevSibling.nodeName === 'BR') {
                        e.preventDefault();

                        // MutationObserverを一時停止
                        this.suppressMutationObserverCount++;

                        // 直前のノードがZWSPのみのテキストノードなら削除
                        const directPrevSibling = node.previousSibling;
                        if (directPrevSibling && directPrevSibling.nodeType === Node.TEXT_NODE &&
                            directPrevSibling.textContent === '\u200B') {
                            directPrevSibling.parentNode.removeChild(directPrevSibling);
                        }

                        // <br>を削除
                        prevSibling.parentNode.removeChild(prevSibling);

                        // <br>の前のノードを探してカーソルを移動
                        const prevNode = node.previousSibling;
                        const newRange = document.createRange();
                        if (prevNode && prevNode.nodeType === Node.TEXT_NODE) {
                            // テキストノードの末尾にカーソルを移動
                            newRange.setStart(prevNode, prevNode.textContent.length);
                        } else if (prevNode && prevNode.nodeName === 'BR') {
                            // 連続した<br>の場合、次の<br>の後にカーソル配置
                            newRange.setStartAfter(prevNode);
                        } else if (prevNode) {
                            newRange.setStartAfter(prevNode);
                        } else {
                            // 前にノードがない場合は現在のテキストノードの先頭に留まる
                            newRange.setStart(node, 0);
                        }
                        newRange.collapse(true);
                        selection.removeAllRanges();
                        selection.addRange(newRange);

                        // DOM操作完了後、MutationObserverを再開
                        setTimeout(() => {
                            this.suppressMutationObserverCount--;
                            this.updateContentHeight();
                        }, 0);

                        return;
                    }
                }
            }
            // それ以外の場合はブラウザのデフォルト動作に任せる
        }

        // Delete: <br>+ゼロ幅スペースのセット削除、span内ゼロ幅スペース削除
        if (e.key === 'Delete') {
            const selection = window.getSelection();
            if (selection.rangeCount > 0 && selection.isCollapsed) {
                const range = selection.getRangeAt(0);
                const node = range.startContainer;
                const offset = range.startOffset;

                // カーソルがテキストノードの末尾にある場合
                if (node.nodeType === Node.TEXT_NODE && offset === node.textContent.length) {
                    // 次のノードがゼロ幅スペースのみのspanの場合（applyFontColor等で挿入）
                    const nextSibling = node.nextSibling;
                    if (nextSibling && nextSibling.nodeName === 'SPAN' &&
                        nextSibling.textContent === '\u200B') {
                        e.preventDefault();

                        // MutationObserverを一時停止
                        this.suppressMutationObserverCount++;

                        // spanを削除
                        nextSibling.parentNode.removeChild(nextSibling);

                        // DOM操作完了後、MutationObserverを再開
                        setTimeout(() => {
                            this.suppressMutationObserverCount--;
                            this.updateContentHeight();
                        }, 0);

                        return;
                    }

                    // 次のノードが<br>かどうか確認
                    if (nextSibling && nextSibling.nodeName === 'BR') {
                        // <br>の次がゼロ幅スペースで始まるテキストノードか確認
                        const afterBr = nextSibling.nextSibling;
                        if (afterBr && afterBr.nodeType === Node.TEXT_NODE &&
                            afterBr.textContent.charAt(0) === '\u200B') {
                            e.preventDefault();

                            // MutationObserverを一時停止
                            this.suppressMutationObserverCount++;

                            // <br>を削除
                            nextSibling.parentNode.removeChild(nextSibling);

                            // ゼロ幅スペースを削除
                            afterBr.textContent = afterBr.textContent.substring(1);

                            // 空になったテキストノードを削除
                            if (afterBr.textContent.length === 0) {
                                afterBr.parentNode.removeChild(afterBr);
                            }

                            // DOM操作完了後、MutationObserverを再開
                            setTimeout(() => {
                                this.suppressMutationObserverCount--;
                                this.updateContentHeight();
                            }, 0);

                            return;
                        }
                    }
                }
                // カーソルが要素ノード内にある場合（段落の末尾など）
                else if (node.nodeType === Node.ELEMENT_NODE) {
                    const children = node.childNodes;
                    if (offset < children.length) {
                        const nextNode = children[offset];
                        if (nextNode && nextNode.nodeName === 'BR') {
                            // <br>の次がゼロ幅スペースで始まるテキストノードか確認
                            const afterBr = nextNode.nextSibling;
                            if (afterBr && afterBr.nodeType === Node.TEXT_NODE &&
                                afterBr.textContent.charAt(0) === '\u200B') {
                                e.preventDefault();

                                // MutationObserverを一時停止
                                this.suppressMutationObserverCount++;

                                // <br>を削除
                                nextNode.parentNode.removeChild(nextNode);

                                // ゼロ幅スペースを削除
                                afterBr.textContent = afterBr.textContent.substring(1);

                                // 空になったテキストノードを削除
                                if (afterBr.textContent.length === 0) {
                                    afterBr.parentNode.removeChild(afterBr);
                                }

                                // DOM操作完了後、MutationObserverを再開
                                setTimeout(() => {
                                    this.suppressMutationObserverCount--;
                                    this.updateContentHeight();
                                }, 0);

                                return;
                            }
                        }
                    }
                }
            }
            // それ以外の場合はブラウザのデフォルト動作に任せる
        }

        // 左矢印キー: ゼロ幅スペースをスキップ
        if (e.key === 'ArrowLeft' && !e.shiftKey) {
            const selection = window.getSelection();
            if (selection.rangeCount > 0 && selection.isCollapsed) {
                const range = selection.getRangeAt(0);
                const node = range.startContainer;
                const offset = range.startOffset;

                // カーソルがテキストノード内でオフセット1の位置にあり、
                // そのテキストノードがゼロ幅スペースで始まる場合
                if (node.nodeType === Node.TEXT_NODE && offset === 1 &&
                    node.textContent.charAt(0) === '\u200B') {
                    e.preventDefault();

                    // 直前のノードが<br>の場合、<br>の前に移動
                    const prevSibling = node.previousSibling;
                    if (prevSibling && prevSibling.nodeName === 'BR') {
                        const newRange = document.createRange();
                        const beforeBr = prevSibling.previousSibling;
                        if (beforeBr && beforeBr.nodeType === Node.TEXT_NODE) {
                            newRange.setStart(beforeBr, beforeBr.textContent.length);
                        } else {
                            newRange.setStartBefore(prevSibling);
                        }
                        newRange.collapse(true);
                        selection.removeAllRanges();
                        selection.addRange(newRange);
                    }
                    return;
                }
            }
        }

        // 右矢印キー: ゼロ幅スペースをスキップ
        if (e.key === 'ArrowRight' && !e.shiftKey) {
            const selection = window.getSelection();
            if (selection.rangeCount > 0 && selection.isCollapsed) {
                const range = selection.getRangeAt(0);
                const node = range.startContainer;
                const offset = range.startOffset;

                // カーソルがテキストノードの末尾にある場合
                if (node.nodeType === Node.TEXT_NODE && offset === node.textContent.length) {
                    // 次のノードが<br>で、その次がゼロ幅スペースで始まるテキストノードの場合
                    const nextSibling = node.nextSibling;
                    if (nextSibling && nextSibling.nodeName === 'BR') {
                        const afterBr = nextSibling.nextSibling;
                        if (afterBr && afterBr.nodeType === Node.TEXT_NODE &&
                            afterBr.textContent.charAt(0) === '\u200B') {
                            e.preventDefault();

                            // ゼロ幅スペースの後に移動
                            const newRange = document.createRange();
                            newRange.setStart(afterBr, 1);
                            newRange.collapse(true);
                            selection.removeAllRanges();
                            selection.addRange(newRange);
                            return;
                        }
                    }
                }
            }
        }

        // Ctrl+C: コピー
        if (e.ctrlKey && e.key === 'c') {
            // 画像または仮身が選択されている場合のみカスタム処理
            if (this.selectedImage || this.selectedVirtualObject) {
                e.preventDefault();
                this.executeMenuAction('copy');
            }
            // テキストの場合はブラウザのデフォルト動作を使用
            return;
        }

        // Ctrl+X: カット（移動）
        if (e.ctrlKey && e.key === 'x') {
            // 画像または仮身が選択されている場合のみカスタム処理
            if (this.selectedImage || this.selectedVirtualObject) {
                e.preventDefault();
                this.executeMenuAction('cut');
            }
            // テキストの場合はブラウザのデフォルト動作を使用
            return;
        }

        // Ctrl+V: ペースト（pasteイベントハンドラーで処理）
        // keydownでpreventDefaultしないと、pasteイベント内のclipboardDataが取得できない場合がある
        // 処理はpasteイベントハンドラー(handlePaste)に任せる
        if (e.ctrlKey && e.key === 'v') {
            // pasteイベントが発火するので、ここでは何もしない
            return;
        }

        // Ctrl+Z: クリップボードから移動
        if (e.ctrlKey && e.key === 'z') {
            e.preventDefault();
            this.executeMenuAction('redo');
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
            this.requestCloseWindow();
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

        // Ctrl+Shift+I: 斜体
        if (e.ctrlKey && e.shiftKey && e.key === 'I') {
            e.preventDefault();
            document.execCommand('italic');
            return;
        }

        // Ctrl+I: 字下げ
        // 注: 通常Ctrl+Iは斜体だが、BTRONでは字下げに使用
        if (e.ctrlKey && !e.shiftKey && e.key === 'i') {
            e.preventDefault();
            this.applyIndent();
            return;
        }

        // Ctrl+U: 下線
        if (e.ctrlKey && e.key === 'u') {
            e.preventDefault();
            document.execCommand('underline');
            return;
        }

        // Ctrl+F: 検索/置換
        if (e.ctrlKey && e.key === 'f') {
            e.preventDefault();
            this.findReplace();
            return;
        }

        // Ctrl+9: 仮身化
        if (e.ctrlKey && e.key === '9') {
            e.preventDefault();
            const selection = window.getSelection();
            if (selection && selection.toString().trim().length > 0) {
                this.virtualizeSelection();
            }
            return;
        }
    }

    /**
     * TADファイルを読み込み
     */
    async loadFile(fileData) {
        try {
            logger.debug('[EDITOR] loadFile呼び出し, fileData:', fileData);
            this.setStatus('ファイル読み込み中...');
            this.currentFile = fileData;
            // _数字.xtad の形式を除去して実身IDのみを取得
            let rawId = fileData ? fileData.realId : null;
            this.realId = rawId ? rawId.replace(/_\d+\.xtad$/i, '') : null;

            logger.debug('[EDITOR] fileDataチェック:', {
                hasXmlData: !!fileData.xmlData,
                hasRawData: !!fileData.rawData,
                fileName: fileData.fileName
            });

            // XMLデータが既に渡されている場合
            if (fileData.xmlData) {
                logger.debug('[EDITOR] XMLデータを使用, 長さ:', fileData.xmlData.length);

                this.tadData = fileData.xmlData;

                // XMLを解釈してリッチテキストとして表示
                await this.renderTADXML(fileData.xmlData);

                this.setStatus(`読み込み完了: ${fileData.fileName} (${fileData.xmlData.length}文字)`);

                // DOM更新後にスクロールバーを更新
                setTimeout(() => this.updateContentHeight(), 0);

                // autoopen属性がtrueの仮身を自動的に開く
                await this.autoOpenVirtualObjects();
            }
            // rawDataがある場合は変換を試みる
            else if (fileData.rawData) {
                logger.debug('rawDataからXMLに変換中...');
                const xmlData = await this.parseTADToXML(fileData.rawData);
                if (xmlData) {
                    this.tadData = xmlData;
                    await this.renderTADXML(xmlData);
                    this.setStatus(`読み込み完了: ${fileData.fileName}`);

                    // DOM更新後にスクロールバーを更新
                    setTimeout(() => this.updateContentHeight(), 0);

                    // autoopen属性がtrueの仮身を自動的に開く
                    await this.autoOpenVirtualObjects();
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
            logger.error('ファイル読み込みエラー:', error);
            logger.error('エラースタック:', error.stack);
            this.editor.innerHTML = '<p>ファイル読み込みエラー</p><pre>' + this.escapeHtml(error.message + '\n' + error.stack) + '</pre>';
            this.setStatus('ファイルの読み込みに失敗しました');
        }
    }

    /**
     * autoopen属性がtrueの仮身を自動的に開く
     */
    async autoOpenVirtualObjects() {
        const virtualObjects = this.editor.querySelectorAll('.virtual-object');

        for (const vo of virtualObjects) {
            const autoopen = vo.dataset.linkAutoopen;
            if (autoopen === 'true') {
                try {
                    // applistを取得（data-applist属性から）
                    let applist = null;
                    if (vo.dataset.applist) {
                        try {
                            applist = JSON.parse(this.decodeHtml(vo.dataset.applist));
                        } catch (e) {
                            continue;
                        }
                    }

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

                    // 仮身オブジェクトを構築
                    const virtualObj = this.buildVirtualObjFromDataset(vo.dataset);

                    // 実身を開く
                    if (this.messageBus) {
                        this.messageBus.send('open-virtual-object-real', {
                            virtualObj: virtualObj,
                            pluginId: defaultPluginId
                        });
                    }
                } catch (error) {
                    logger.error('[EDITOR] 自動起動エラー:', vo.dataset.linkId, error);
                    // エラーが発生しても次の仮身の起動を続行
                }
            }
        }
    }

    /**
     * 仮身展開用: 実身データを読み込んで表示
     */
    async loadVirtualObjectData(virtualObj, realObject) {
        try {
            logger.debug('[EDITOR] loadVirtualObjectData呼び出し:', { virtualObj, realObject });
            this.setStatus('実身データ読み込み中...');

            // realObjectからXTADデータを取得
            if (!realObject || !realObject.records || realObject.records.length === 0) {
                logger.error('[EDITOR] レコードが存在しません:', realObject);
                this.editor.innerHTML = '<p>実身データが見つかりません</p>';
                this.setStatus('エラー: 実身データがありません');
                return;
            }

            const firstRecord = realObject.records[0];
            if (!firstRecord || !firstRecord.xtad) {
                logger.error('[EDITOR] XTADデータが存在しません:', firstRecord);
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
                fileName: realObject.metadata.name || '無題'
            };

            // XTADデータ（XML形式）をそのまま使用
            logger.debug('[EDITOR] XTAD読み込み成功, 長さ:', firstRecord.xtad.length);
            const xmlData = firstRecord.xtad;
            if (xmlData) {
                logger.debug('[EDITOR] XML変換成功, 長さ:', xmlData.length);
                this.tadData = xmlData;
                await this.renderTADXML(xmlData);
                this.setStatus(`実身読み込み完了: ${this.currentFile.fileName}`);

                // DOM更新後にスクロールバーを更新
                setTimeout(() => this.updateContentHeight(), 0);
            } else {
                logger.error('[EDITOR] XML変換失敗');
                this.editor.innerHTML = '<p>XTADデータの解析に失敗しました</p>';
                this.setStatus('エラー: XMLの生成に失敗しました');
            }
        } catch (error) {
            logger.error('[EDITOR] 仮身データ読み込みエラー:', error);
            logger.error('[EDITOR] エラースタック:', error.stack);
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
                logger.debug('XML変換完了:', xmlResult ? xmlResult.substring(0, 100) : 'null');
                return xmlResult;
            } catch (error) {
                logger.error('TAD→XML変換エラー:', error);
                return null;
            }
        }
        logger.warn('parseTADToXML関数が見つかりません');
        return null;
    }

    /**
     * <link>タグを仮身（Virtual Object）HTMLに変換
     */
    async convertLinkTagsToVirtualObjects(content) {
        // <link ...>...</link> または <link .../> タグを検出して仮身に変換（すべての属性を保持）
        const linkRegex = /<link\s+([^>]*?)(?:\/>|>(.*?)<\/link>)/gi;

        // まず、すべてのlinkタグからrealIdを抽出してアイコンをキャッシュに入れる
        const linkMatches = [];
        let match;
        while ((match = linkRegex.exec(content)) !== null) {
            linkMatches.push({
                fullMatch: match[0],
                attributes: match[1],
                innerContent: match[2] || ''
            });
        }

        // すべてのrealIdに対してアイコンを事前にロード
        // readonly（開いた仮身表示）モードではアイコンロードをスキップ（高速化のため）
        const iconLoadPromises = [];
        const isReadonly = this.editor.contentEditable === 'false';

        if (!isReadonly) {
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
                    logger.debug('[EDITOR] アイコンを事前ロード:', attrMap.id, '実身ID:', realId);
                    iconLoadPromises.push(this.iconManager.loadIcon(realId));
                }
            }

            // すべてのアイコンをロード（並列実行）
            await Promise.all(iconLoadPromises);
        } else {
            logger.debug('[EDITOR] readonlyモードのためアイコン事前ロードをスキップ');
        }

        // 仮身のメタデータ（relationship等）を事前ロード
        const metadataCache = {};
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
                if (!metadataCache[realId]) {
                    // 一時的なvirtualObjを作成してメタデータをロード
                    const tempVobj = { link_id: attrMap.id };
                    try {
                        await this.loadVirtualObjectMetadata(tempVobj);
                        if (tempVobj.metadata) {
                            metadataCache[realId] = tempVobj.metadata;
                        }
                    } catch (e) {
                        // メタデータ読み込み失敗は無視
                    }
                }
            }
        }

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
                if (this.iconManager.hasInCache(realId)) {
                    const cachedData = this.iconManager.getFromCache(realId);
                    if (cachedData) {
                        // iconDataは実身IDをキーにする
                        iconData[realId] = cachedData;
                        logger.debug('[EDITOR] キャッシュからアイコンデータ取得:', attrMap.id, '実身ID:', realId, 'データ長:', cachedData.length);
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
            // 自己閉じタグの場合はinnerContentがundefinedになるため空文字で処理
            const safeInnerContent = innerContent || '';
            const escapedInnerContent = this.escapeHtml(safeInnerContent.trim());
            dataAttrs += ` data-link-innercontent="${escapedInnerContent}"`;

            // 表示名は<link></link>で囲まれたテキスト（innerContent）を使用
            // innerContentが空の場合はname属性、それもなければidを使用
            const displayName = safeInnerContent.trim() || attrMap.name || attrMap.id || '無題';

            // VirtualObjectRendererを使って仮身要素を作成
            if (this.virtualObjectRenderer) {
                // VirtualObjectオブジェクトを構築
                // フルIDから実身IDのみを抽出
                const realId = attrMap.id.replace(/_\d+\.xtad$/i, '');

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
                    applist: this.parseApplist(attrMap.applist),
                    framedisp: attrMap.framedisp || 'true',
                    namedisp: attrMap.namedisp || 'true',
                    pictdisp: attrMap.pictdisp || 'true',
                    roledisp: attrMap.roledisp || 'false',
                    typedisp: attrMap.typedisp || 'false',
                    updatedisp: attrMap.updatedisp || 'false',
                    autoopen: attrMap.autoopen || 'false',
                    // 仮身固有の続柄（link要素のrelationship属性）
                    linkRelationship: attrMap.relationship ? attrMap.relationship.split(/\s+/).filter(t => t) : []
                };

                // 事前ロードしたメタデータを適用（relationship, updateDate等）
                if (metadataCache[realId]) {
                    virtualObject.metadata = metadataCache[realId];
                    // applistもJSONから取得したものを優先（より正確）
                    if (metadataCache[realId].applist) {
                        virtualObject.applist = metadataCache[realId].applist;
                    }
                    // updateDateをvirtualObjectに直接設定（VirtualObjectRendererが参照）
                    if (metadataCache[realId].updateDate) {
                        virtualObject.updateDate = metadataCache[realId].updateDate;
                    }
                    // 実身名もJSONから取得したものを優先（自己閉じタグ対応）
                    if (metadataCache[realId].name) {
                        virtualObject.link_name = metadataCache[realId].name;
                    }
                }

                // アイコンデータを渡す（同期的に設定される）
                // readonlyモード（開いた仮身表示）ではiconDataが空のため、iconBasePathで直接読み込み
                const options = {
                    iconData: iconData
                };

                // readonlyモード（開いた仮身表示）の場合、iconBasePathを使用
                // MessageBusリレーを使わず、直接ファイルパスを指定
                if (isReadonly && typeof require !== 'undefined') {
                    try {
                        const path = require('path');
                        // __dirnameはindex.htmlのディレクトリ: plugins/basic-text-editor/
                        // dataフォルダは: ../../../../data/
                        const dataPath = path.join(__dirname, '..', '..', '..', '..', 'data') + path.sep;
                        options.iconBasePath = dataPath;
                        logger.debug('[EDITOR] readonlyモード: iconBasePath設定:', dataPath);
                    } catch (e) {
                        // Electron環境でない場合はloadIconCallbackをフォールバックとして使用
                        options.loadIconCallback = (realId) => this.iconManager.loadIcon(realId);
                        logger.debug('[EDITOR] iconBasePath設定失敗、loadIconCallbackを使用:', e.message);
                    }
                } else if (!isReadonly) {
                    // 通常モードではloadIconCallbackを使用
                    options.loadIconCallback = (realId) => this.iconManager.loadIcon(realId);
                }

                // DOM要素を作成
                const vobjElement = this.virtualObjectRenderer.createInlineElement(virtualObject, options);

                // innerContentをdata属性として追加（XMLエクスポート時に必要）
                // safeInnerContentは上で定義済み（自己閉じタグの場合は空文字）
                const escapedInnerContentForAttr = this.escapeHtml(safeInnerContent.trim());
                vobjElement.setAttribute('data-link-innercontent', escapedInnerContentForAttr);

                // その他の属性も追加（VirtualObjectRendererが設定しない属性）
                // applistはVirtualObjectRendererがdata-applistとして設定するため除外
                for (const [key, value] of Object.entries(attrMap)) {
                    if (!['id', 'name', 'tbcol', 'frcol', 'chcol', 'bgcol', 'chsz', 'applist'].includes(key)) {
                        vobjElement.setAttribute(`data-link-${key}`, value);
                    }
                }

                return vobjElement.outerHTML;
            } else {
                // フォールバック: VirtualObjectRendererが利用できない場合
                const realId = attrMap.id.replace(/_\d+\.xtad$/i, '');
                // 実身名もJSONから取得したものを優先（自己閉じタグ対応）
                const finalDisplayName = (metadataCache[realId]?.name) || displayName;
                const frcol = attrMap.frcol || '#000000';
                const chcol = attrMap.chcol || '#000000';
                const tbcol = attrMap.tbcol || '#ffffff';
                const chsz = attrMap.chsz ? parseFloat(attrMap.chsz) : null;
                const fontSize = chsz ? `${window.convertPtToPx(chsz)}px` : '0.9em';  // ポイント値をピクセル値に変換
                const style = `display: inline-block; padding: 4px 8px; margin: 0 2px; background: ${tbcol}; border: 1px solid ${frcol}; cursor: pointer; color: ${chcol}; font-size: ${fontSize}; line-height: 1; vertical-align: middle; user-select: none; -webkit-user-select: none; -moz-user-select: none; -ms-user-select: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;

                return `<span class="virtual-object"${dataAttrs} contenteditable="false" unselectable="on" style="${style}">${this.escapeHtml(finalDisplayName)}</span>`;
            }
        });
    }

    /**
     * TAD XML文字修飾タグをHTMLに変換
     * @param {string} content - 変換対象のコンテンツ
     * @param {TextStyleStateManager} textStyleState - テキストスタイル状態（段落間引き継ぎ用、オプション）
     */
    async convertDecorationTagsToHTML(content, textStyleState = null) {
        let html = content;

        // 最初に<link>タグを仮身に変換（他の処理で消されないように先に処理）
        html = await this.convertLinkTagsToVirtualObjects(html);

        // <image>タグを<img>タグに変換（TAD形式: 自己閉じタグ）
        // zIndex等の追加属性がある場合も対応
        html = html.replace(/<image\s+src="([^"]*)"\s+width="([^"]*)"\s+height="([^"]*)"\s+planes="([^"]*)"\s+pixbits="([^"]*)"(?:\s+[^>]*)?\s*\/>/gi,
            (match, src, width, height, planes, pixbits) => {
                // srcから画像ファイルのパスを取得
                // 画像は loadImagesFromParent() で正しいパスを設定するため、
                // 初期srcは常に空にする（ブラウザの即時読み込みを防止）
                let imagePath = '';

                // data: URL の場合のみ直接設定
                if (src.startsWith('data:')) {
                    imagePath = src;
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

        // XMLエンティティのタブ文字（&#9; または &#x9;）を実際のタブ文字に変換
        html = html.replace(/&#0*9;/g, '\t');
        html = html.replace(/&#[xX]0*9;/g, '\t');

        // 固定サイズ（14pt）のタブ文字の特別処理（連続タブにも対応）
        // <font size="14"/>[タブ1つ以上]<font size="[元のサイズ]"/> → <span style="font-size: 14pt;">[タブ文字列]</span><font size="[元のサイズ]"/>
        html = html.replace(/<font\s+size="14"\s*\/>([\t]+)<font\s+size="(\d+)"\s*\/>/g,
            (_match, tabs, size) => {
                return `<span style="font-size: 14pt;">${tabs}</span><font size="${size}"/>`;
            });

        // <font>タグを処理（自己閉じタグとペアタグの両方に対応）
        // シンプルなアプローチ: 各fontタグを個別のspanに変換
        // インラインスタイルでスタイル情報を保持
        let result = '';
        let pos = 0;
        const fontRegex = /<font\s+(size|color|face)="([^"]*)"\s*\/?>|<\/font>/gi;
        let match;
        const stack = []; // { attr, value, isSelfClosing }

        while ((match = fontRegex.exec(html)) !== null) {
            result += html.substring(pos, match.index);

            const fullMatch = match[0];

            if (fullMatch.toLowerCase() === '</font>') {
                // ペアタグ終了
                if (stack.length > 0) {
                    result += '</span>';
                    const popped = stack.pop();

                    // textStyleStateを前の状態に戻す
                    if (textStyleState && !popped.isSelfClosing) {
                        // 同じ属性の前の値を探す（入れ子対応）
                        let previousValue = null;
                        for (let i = stack.length - 1; i >= 0; i--) {
                            if (stack[i].attr === popped.attr) {
                                previousValue = stack[i].value;
                                break;
                            }
                        }
                        // 前の値がなければnullでデフォルトにリセット
                        textStyleState.update(popped.attr, previousValue);
                    }
                }
            } else {
                const attr = match[1].toLowerCase();
                const value = match[2];
                const isSelfClosing = fullMatch.endsWith('/>');

                // textStyleStateが渡されている場合、状態を更新
                if (textStyleState) {
                    textStyleState.update(attr, value);
                }

                if (value === '' && isSelfClosing) {
                    // 空文字列の自己閉じ = 終了タグ（後方互換）
                    for (let i = stack.length - 1; i >= 0; i--) {
                        if (stack[i].attr === attr) {
                            result += '</span>';
                            stack.splice(i, 1);
                            break;
                        }
                    }
                } else {
                    // 開始タグ: spanを生成
                    const spanHtml = this.createTadStyledSpan(attr, value);
                    result += spanHtml;
                    stack.push({ attr, value, isSelfClosing });
                }
            }

            pos = fontRegex.lastIndex;
        }

        result += html.substring(pos);

        // 閉じられていないspanを閉じる
        while (stack.length > 0) {
            result += '</span>';
            stack.pop();
        }

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

        // <attend>タグ -> <sup>/<sub>タグ（data属性で属性を保持）
        // type: 0=下付き(sub), 1=上付き(sup)
        // position: 0=前置, 1=後置
        // unit: 0=文字列単位, 1=文字単位
        // targetPosition: 0=右, 1=左
        // baseline: 0-4
        html = html.replace(/<attend\s+type="([01])"\s+position="(\d+)"\s+unit="(\d+)"\s+targetPosition="(\d+)"\s+baseline="(\d+)"\s*>(.*?)<\/attend>/gi,
            (match, type, position, unit, targetPosition, baseline, content) => {
                const tag = type === '1' ? 'sup' : 'sub';
                return `<${tag} data-attend-type="${type}" data-attend-position="${position}" data-attend-unit="${unit}" data-attend-target-position="${targetPosition}" data-attend-baseline="${baseline}">${content}</${tag}>`;
            }
        );

        // <superscript>タグ -> <sup>タグ（後方互換性）
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
        logger.debug('[EDITOR] parseTextElements開始');
        const textElements = [];

        // <document>...</document>を抽出
        const docMatch = /<document>([\s\S]*?)<\/document>/i.exec(tadXML);

        if (!docMatch) {
            logger.warn('[EDITOR] <document>タグが見つかりません');
            return textElements;
        }

        const docContent = docMatch[1];
        logger.debug('[EDITOR] <document>内容抽出完了, 長さ:', docContent.length);

        // <p>タグで段落に分割
        const paragraphRegex = /<p>([\s\S]*?)<\/p>/gi;
        let pMatch;
        let paragraphCount = 0;

        while ((pMatch = paragraphRegex.exec(docContent)) !== null) {
            const paragraphContent = pMatch[1];
            paragraphCount++;
            logger.debug(`[EDITOR] 段落${paragraphCount}:`, paragraphContent.substring(0, 100));

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
                logger.debug(`[EDITOR]   テキスト抽出:`, plainText.substring(0, 50));
                if (fontColor) logger.debug(`[EDITOR]   カラー: ${fontColor}`);
                if (fontSize !== '14') logger.debug(`[EDITOR]   サイズ: ${fontSize}pt`);
                if (fontFamily) logger.debug(`[EDITOR]   フォント: ${fontFamily.substring(0, 30)}`);

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
                logger.debug(`[EDITOR]   空段落`);
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

        logger.debug('[EDITOR] parseTextElements完了, 要素数:', textElements.length);
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
            // <document>...</document>を抽出
            const docMatch = /<document[^>]*>([\s\S]*?)<\/document>/i.exec(tadXML);
            if (!docMatch) {
                logger.warn('[EDITOR] <document>タグが見つかりません');
                this.editor.innerHTML = '<p>Document要素が見つかりません</p>';
                return;
            }

            let docContent = docMatch[1];

            // フォールバック: 不正な<docoverlay=形式を正規化（属性名欠落の修正）
            tadXML = tadXML.replace(/<docoverlay="([^"]*)"\s*\/>/gi, '<docoverlay data="$1" />');

            // フォールバック: <p>タグなしで始まるコンテンツを検出
            // メタ要素（paper, docmargin, docScale, text, docoverlay）を除いた後、
            // <p>で始まらず</p>で終わるコンテンツがあれば暗黙的に<p>でラップ
            const metaPattern = /^(\s*(<paper[^>]*\/>|<docmargin[^>]*\/>|<docScale[^>]*\/>|<text[^>]*\/>|<docoverlay[^>]*\/>)\s*)*/i;
            const metaMatch = metaPattern.exec(docContent);
            if (metaMatch) {
                const afterMeta = docContent.substring(metaMatch[0].length);
                // <p>で始まらないが</p>を含む場合
                if (afterMeta && !afterMeta.trim().startsWith('<p>') && !afterMeta.trim().startsWith('<p ')) {
                    const firstCloseP = afterMeta.indexOf('</p>');
                    if (firstCloseP !== -1) {
                        // 最初の</p>の前のコンテンツを<p>でラップ
                        const beforeCloseP = afterMeta.substring(0, firstCloseP);
                        const afterCloseP = afterMeta.substring(firstCloseP);
                        docContent = metaMatch[0] + '<p>' + beforeCloseP + afterCloseP;
                        logger.debug('[EDITOR] フォールバック: <p>タグなしコンテンツを検出、暗黙的にラップしました');
                    }
                }
            }

            // XMLをパース
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(tadXML, 'text/xml');

            // <document>要素からh_unit/v_unitをパース
            const documentElement = xmlDoc.querySelector('document');
            if (documentElement) {
                this.parseDocumentElement(documentElement);
            }

            // <paper>要素をパース（用紙設定）
            const paperElements = xmlDoc.querySelectorAll('paper');
            if (paperElements.length > 0) {
                paperElements.forEach(paper => {
                    this.parsePaperElement(paper);
                });
                // paperSizeからpaperWidth/paperHeightを同期
                if (this.paperSize) {
                    this.paperWidth = this.paperSize.width;
                    this.paperHeight = this.paperSize.length;
                }
                logger.debug(`[EDITOR] 用紙設定をロード: ${this.paperSize ? window.pointsToMm(this.paperWidth).toFixed(0) : 210}×${this.paperSize ? window.pointsToMm(this.paperHeight).toFixed(0) : 297}mm`);
            }
            // 注意: <paper>要素がない場合はpaperSizeをnullのままにする
            // （条件付き保存で<paper>/<docmargin>を出力しないため）

            // <docmargin>要素をパース（余白設定）
            const docmarginElements = xmlDoc.querySelectorAll('docmargin');
            if (docmarginElements.length > 0) {
                const docmargin = docmarginElements[0];
                if (!this.paperMargin) {
                    this.paperMargin = new window.PaperMargin();
                }
                this.paperMargin.top = parseFloat(docmargin.getAttribute('top')) || 0;
                this.paperMargin.bottom = parseFloat(docmargin.getAttribute('bottom')) || 0;
                this.paperMargin.left = parseFloat(docmargin.getAttribute('left')) || 0;
                this.paperMargin.right = parseFloat(docmargin.getAttribute('right')) || 0;
                logger.debug(`[EDITOR] 余白設定をロード: top=${this.paperMargin.top}, bottom=${this.paperMargin.bottom}, left=${this.paperMargin.left}, right=${this.paperMargin.right}`);
            }

            // ページ追跡を初期化（条件付き改ページ用）
            this.initPageTracker();

            // テキストスタイル状態を段落ループの外で初期化（段落間引き継ぎ用）
            const textStyleState = new window.TextStyleStateManager();

            // <p>タグと<pagebreak>タグを順番に処理
            // 正規表現で<p>...</p>と<pagebreak .../>を取得
            const elementRegex = /<p>([\s\S]*?)<\/p>|<pagebreak\s+([^>]*)\/>/gi;
            let htmlContent = '';
            let elementMatch;
            let paragraphCount = 0;
            let lastIndex = 0;

            while ((elementMatch = elementRegex.exec(docContent)) !== null) {
                // <pagebreak>要素の処理
                if (elementMatch[2] !== undefined) {
                    // <pagebreak>要素を処理
                    const attrString = elementMatch[2];
                    const condMatch = /cond="(\d+)"/.exec(attrString);
                    const remainMatch = /remain="(\d+)"/.exec(attrString);

                    const cond = condMatch ? parseInt(condMatch[1], 10) : 0;
                    const remain = remainMatch ? parseInt(remainMatch[1], 10) : 0;

                    // 条件を評価
                    const triggered = this.evaluatePageBreakCondition(cond, remain);

                    // 条件付き改ページ要素を作成
                    let pageBreakClasses = 'conditional-page-break';
                    let pageBreakAttrs = `data-cond="${cond}" data-remain="${remain}" data-triggered="${triggered ? 'true' : 'false'}"`;

                    if (triggered) {
                        pageBreakClasses += ' triggered';
                        if (this.paperFrameVisible) {
                            pageBreakClasses += ' page-break-visible';
                        }
                        // ページ追跡を更新
                        this.pageTracker.currentPage++;
                        this.pageTracker.remainingHeight = this.pageTracker.pageHeight;
                    }

                    htmlContent += `<div class="${pageBreakClasses}" ${pageBreakAttrs}></div>`;
                    lastIndex = elementRegex.lastIndex;
                    continue;
                }

                // <p>要素の処理
                paragraphCount++;
                let paragraphContent = elementMatch[1];
                lastIndex = elementRegex.lastIndex;  // 最後に処理した位置を記録

                // 段落の前後の空白文字（改行、スペースのみ）をトリム（タブは保持）
                paragraphContent = paragraphContent.replace(/^[\r\n ]+|[\r\n ]+$/g, '');

                // <font>と<text>タグから段落レベルのスタイルを抽出
                let style = 'margin: 0.5em 0; white-space: pre-wrap;';
                let maxFontSize = 14; // デフォルトのフォントサイズ

                // 前段落から継承されたスタイルを適用
                const inheritedStyle = textStyleState.toCssStyle();
                const inheritedAlignStyle = textStyleState.toAlignCssStyle();
                if (inheritedStyle) {
                    style += inheritedStyle;
                    // 継承されたサイズがあれば最大フォントサイズを更新
                    if (textStyleState.size !== '14') {
                        maxFontSize = parseFloat(textStyleState.size);
                    }
                }
                if (inheritedAlignStyle) {
                    style += inheritedAlignStyle;
                }

                // フォントサイズ（段落の最初のもののみ）- スタイル抽出のみ、タグは残す
                // 自己閉じタグとペアタグの両方をチェック
                const fontSizeSelfClosingMatch = /<font\s+size="([^"]*)"\s*\/>/i.exec(paragraphContent);
                const fontSizePairTagMatch = /<font\s+size="([^"]*)">/i.exec(paragraphContent);
                // 最初に出現する方を採用
                let firstFontSizeMatch = null;
                if (fontSizeSelfClosingMatch && fontSizePairTagMatch) {
                    firstFontSizeMatch = fontSizeSelfClosingMatch.index < fontSizePairTagMatch.index
                        ? fontSizeSelfClosingMatch : fontSizePairTagMatch;
                } else {
                    firstFontSizeMatch = fontSizeSelfClosingMatch || fontSizePairTagMatch;
                }
                if (firstFontSizeMatch) {
                    style += `font-size: ${firstFontSizeMatch[1]}pt;`;
                    maxFontSize = parseFloat(firstFontSizeMatch[1]);
                    // タグは削除せず残す（convertDecorationTagsToHTMLで処理される）
                }

                // 段落内の最大フォントサイズを探す（行の高さを決定するため）
                // 自己閉じタグとペアタグの両方を検出
                const xmlMaxFontSize = this.calculateMaxFontSizeFromXml(paragraphContent, maxFontSize);
                if (xmlMaxFontSize > maxFontSize) {
                    maxFontSize = xmlMaxFontSize;
                }

                // フォントファミリーは段落レベルでは適用せず、convertDecorationTagsToHTMLでインライン処理
                // （段落内に複数のfont faceがある場合に正しく個別適用するため）

                // フォントカラー（段落の最初のもののみ）- スタイル抽出のみ、タグは残す
                const fontColorMatch = /<font\s+color="([^"]*)"\s*\/>/i.exec(paragraphContent);
                if (fontColorMatch) {
                    style += `color: ${fontColorMatch[1]};`;
                    // タグは削除せず残す（convertDecorationTagsToHTMLで処理される）
                }

                // テキスト配置
                const textAlignMatch = /<text\s+align="([^"]*)"\s*\/>/i.exec(paragraphContent);
                if (textAlignMatch) {
                    style += `text-align: ${textAlignMatch[1]};`;
                    paragraphContent = paragraphContent.replace(/<text\s+align="[^"]*"\s*\/>/gi, '');
                }

                // <indent/>タグを段落スタイルに変換（行頭移動指定付箋）
                const indentMatch = /<indent\s*\/>/i.exec(paragraphContent);
                if (indentMatch) {
                    // タグの位置を取得
                    const tagPosition = indentMatch.index;

                    // タグより前のXMLコンテンツを取得
                    const beforeTag = paragraphContent.substring(0, tagPosition);

                    // 現在の段落スタイルを使って実際の文字幅を計算（DOMで実測）
                    const indentPx = await this.calculateTextWidthBeforeIndent(
                        beforeTag,
                        style
                    );

                    if (indentPx > 0) {
                        style += `padding-left: ${indentPx}px; text-indent: -${indentPx}px;`;
                    }

                    // <indent/>タグを削除
                    paragraphContent = paragraphContent.replace(/<indent\s*\/>/gi, '');
                }

                // その他の<text>タグを削除（レイアウト情報）
                paragraphContent = paragraphContent.replace(/<text[^>]*\/>/gi, '');
                paragraphContent = paragraphContent.replace(/<text[^>]*>/gi, '').replace(/<\/text>/gi, '');

                // タグ間の余分な改行を正規化
                // ただしテキストノード内の空白（タブ、スペース含む）は保持
                paragraphContent = paragraphContent.replace(/>[\r\n]+</g, '><');

                // インライン<font>タグをHTMLに変換（textStyleStateを渡して段落間で状態を引き継ぐ）
                paragraphContent = await this.convertDecorationTagsToHTML(paragraphContent, textStyleState);

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

                // 段落レベルのスタイルを抽出
                let style = 'margin: 0.5em 0; white-space: pre-wrap;';
                let maxFontSize = 14; // デフォルトのフォントサイズ

                // 前段落から継承されたスタイルを適用
                const inheritedStyleRemainder = textStyleState.toCssStyle();
                const inheritedAlignStyleRemainder = textStyleState.toAlignCssStyle();
                if (inheritedStyleRemainder) {
                    style += inheritedStyleRemainder;
                    if (textStyleState.size !== '14') {
                        maxFontSize = parseFloat(textStyleState.size);
                    }
                }
                if (inheritedAlignStyleRemainder) {
                    style += inheritedAlignStyleRemainder;
                }

                // フォントサイズ（自己閉じタグとペアタグの両方をチェック）
                const fontSizeSelfClosingMatch = /<font\s+size="([^"]*)"\s*\/>/i.exec(paragraphContent);
                const fontSizePairTagMatch = /<font\s+size="([^"]*)">/i.exec(paragraphContent);
                // 最初に出現する方を採用
                let firstFontSizeMatch = null;
                if (fontSizeSelfClosingMatch && fontSizePairTagMatch) {
                    firstFontSizeMatch = fontSizeSelfClosingMatch.index < fontSizePairTagMatch.index
                        ? fontSizeSelfClosingMatch : fontSizePairTagMatch;
                } else {
                    firstFontSizeMatch = fontSizeSelfClosingMatch || fontSizePairTagMatch;
                }
                if (firstFontSizeMatch) {
                    style += `font-size: ${firstFontSizeMatch[1]}pt;`;
                    maxFontSize = parseFloat(firstFontSizeMatch[1]);
                    // 自己閉じタグの場合のみ削除（ペアタグはconvertDecorationTagsToHTMLで処理）
                    if (fontSizeSelfClosingMatch && (!fontSizePairTagMatch || fontSizeSelfClosingMatch.index < fontSizePairTagMatch.index)) {
                        paragraphContent = paragraphContent.replace(/<font\s+size="[^"]*"\s*\/>/i, '');
                    }
                }

                // 段落内の最大フォントサイズを探す（行の高さを決定するため）
                // 自己閉じタグとペアタグの両方を検出
                const xmlMaxFontSize = this.calculateMaxFontSizeFromXml(paragraphContent, maxFontSize);
                if (xmlMaxFontSize > maxFontSize) {
                    maxFontSize = xmlMaxFontSize;
                }

                // フォントファミリーは段落レベルでは適用せず、convertDecorationTagsToHTMLでインライン処理
                // （段落内に複数のfont faceがある場合に正しく個別適用するため）

                // フォントカラーは段落レベルで処理しない
                // 色はペアタグ方式でspan要素レベルで処理する（convertDecorationTagsToHTMLで変換）

                // テキスト配置
                const textAlignMatch = /<text\s+align="([^"]*)"\s*\/>/i.exec(paragraphContent);
                if (textAlignMatch) {
                    style += `text-align: ${textAlignMatch[1]};`;
                    paragraphContent = paragraphContent.replace(/<text\s+align="[^"]*"\s*\/>/gi, '');
                }

                // <indent/>タグを段落スタイルに変換（行頭移動指定付箋）
                const indentMatch = /<indent\s*\/>/i.exec(paragraphContent);
                if (indentMatch) {
                    // タグの位置を取得
                    const tagPosition = indentMatch.index;

                    // タグより前のXMLコンテンツを取得
                    const beforeTag = paragraphContent.substring(0, tagPosition);

                    // 現在の段落スタイルを使って実際の文字幅を計算（DOMで実測）
                    const indentPx = await this.calculateTextWidthBeforeIndent(
                        beforeTag,
                        style
                    );

                    if (indentPx > 0) {
                        style += `padding-left: ${indentPx}px; text-indent: -${indentPx}px;`;
                    }

                    // <indent/>タグを削除
                    paragraphContent = paragraphContent.replace(/<indent\s*\/>/gi, '');
                }

                // その他の<text>タグを削除
                paragraphContent = paragraphContent.replace(/<text[^>]*\/>/gi, '');
                paragraphContent = paragraphContent.replace(/<text[^>]*>/gi, '').replace(/<\/text>/gi, '');

                // タグ間の余分な空白・改行を正規化
                paragraphContent = paragraphContent.replace(/>\s+</g, '><');

                // インライン<font>タグをHTMLに変換（textStyleStateを渡して段落間で状態を引き継ぐ）
                paragraphContent = await this.convertDecorationTagsToHTML(paragraphContent, textStyleState);

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

                // 仮身要素にイベントハンドラを追加
                this.setupVirtualObjectEventHandlers();

                // 画像を読み込んで表示
                this.loadImagesFromParent();

                // DOM更新後に自動展開チェック（レイアウトが確定してから）
                setTimeout(() => {
                    this.checkAllVirtualObjectsForAutoExpand();
                }, 200);
            } else {
                logger.warn('[EDITOR] 段落要素が見つかりませんでした');
                // 空のエディタを表示
                this.editor.innerHTML = '<p><br></p>';
            }

            // ビューモードを清書モードに設定
            this.viewMode = 'formatted';
        } catch (error) {
            logger.error('[EDITOR] XML描画エラー:', error);
            this.editor.innerHTML = '<p>XMLの描画に失敗しました</p><pre>' + this.escapeHtml(error.message) + '</pre>';
        }
    }

    /**
     * 仮身要素にイベントハンドラを設定
     */
    setupVirtualObjectEventHandlers() {
        const virtualObjects = this.editor.querySelectorAll('.virtual-object');

        virtualObjects.forEach(vo => {
            // 既にイベントハンドラーが登録されている場合はスキップ（重複登録を防ぐ）
            if (vo.dataset.handlersAttached === 'true') {
                return;
            }

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
                    logger.debug('[EDITOR] 仮身の元の高さを保存:', vo.dataset.linkName, height);
                }
            }

            // chszと実際のheightを比較して、自動的に開いた仮身にするか判定
            this.checkAndAutoExpandVirtualObject(vo);

            // ダブルクリック+ドラッグ検出用のmousedownイベント（capturing phaseで優先実行）
            vo.addEventListener('mousedown', (e) => {
                logger.debug('[EDITOR-DBL] 仮身mousedown検出:', {
                    button: e.button,
                    linkName: vo.dataset.linkName,
                    target: e.target.tagName,
                    handlersAttached: vo.dataset.handlersAttached
                });

                // リサイズエリア以外でのクリックをダブルクリック判定の対象とする
                const rect = vo.getBoundingClientRect();
                const isRightEdge = e.clientX > rect.right - 8;
                const isBottomEdge = e.clientY > rect.bottom - 8;

                logger.debug('[EDITOR-DBL] リサイズエリアチェック:', {
                    isRightEdge,
                    isBottomEdge,
                    button: e.button
                });

                // リサイズエリアではない場合のみダブルクリック判定を行う
                if (!isRightEdge && !isBottomEdge && e.button === 0) {
                    const now = Date.now();
                    const timeSinceLastClick = now - this.dblClickDragState.lastClickTime;
                    const isSameElement = this.dblClickDragState.lastClickedElement === vo;

                    logger.debug('[EDITOR-DBL] ダブルクリック判定:', {
                        timeSinceLastClick,
                        isSameElement,
                        lastClickTime: this.dblClickDragState.lastClickTime,
                        now
                    });

                    // 前回のクリックから300ms以内かつ同じ要素の場合、ダブルクリック+ドラッグ候補
                    if (timeSinceLastClick < 300 && isSameElement) {
                        logger.debug('[EDITOR] ダブルクリック+ドラッグ候補を検出:', vo.dataset.linkName);
                        this.setDoubleClickDragCandidate(vo, e);  // 共通メソッド使用
                        // NOTE: e.preventDefault()はここでは呼ばない（dragstartで処理）
                    } else {
                        // 通常のクリック：時刻と要素を記録
                        logger.debug('[EDITOR-DBL] 通常のクリック、時刻と要素を記録');
                        this.resetDoubleClickTimer();  // 共通メソッド使用
                        this.dblClickDragState.lastClickedElement = vo;  // プラグイン固有
                    }
                }
            }, true); // capturing phaseで登録

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
                    logger.debug('[EDITOR] 仮身選択:', linkName);
                    this.setStatus(`仮身選択: ${linkName}`);
                } else {
                    this.selectedVirtualObject = null;
                    logger.debug('[EDITOR] 仮身選択解除:', linkName);
                    this.setStatus('');
                }
            });

            // ダブルクリックイベント: defaultOpenアプリで開く
            vo.addEventListener('dblclick', async (e) => {
                e.preventDefault();
                e.stopPropagation();

                const linkId = vo.dataset.linkId;
                const linkName = vo.dataset.linkName;
                logger.debug('[EDITOR] 仮身ダブルクリック:', linkName, linkId);

                // 実身IDを抽出（共通メソッドを使用）
                const realId = window.RealObjectSystem.extractRealId(linkId);

                // realId.jsonを読み込んでdefaultOpenを取得
                try {
                    const appListData = await this.getAppListData(realId);
                    if (!appListData) {
                        this.setStatus('appListの取得に失敗しました');
                        return;
                    }

                    const defaultOpen = this.getDefaultOpenFromAppList(appListData);
                    if (defaultOpen) {
                        logger.debug('[EDITOR] defaultOpenアプリで起動:', defaultOpen);

                        // 親ウィンドウに実身を開くよう要求
                        const virtualObj = this.buildVirtualObjFromDataset(vo.dataset);

                                    this.messageBus.send('open-virtual-object-real', {
                            virtualObj: virtualObj,
                            pluginId: defaultOpen
                        });
                    } else {
                        this.setStatus('defaultOpenが設定されていません');
                    }
                } catch (error) {
                    logger.error('[EDITOR] defaultOpen取得エラー:', error);
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
                // ダブルクリック+ドラッグ候補またはダブルクリック+ドラッグ確定の場合は、通常のドラッグをキャンセル
                if (this.dblClickDragState.isDblClickDragCandidate || this.dblClickDragState.isDblClickDrag) {
                    logger.debug('[EDITOR] ダブルクリック+ドラッグ中のため、通常のdragstartをキャンセル');
                    e.preventDefault();
                    return;
                }

                // PluginBase共通メソッドでドラッグ状態を初期化
                this.initializeVirtualObjectDragStart(e);

                this.isDraggingVirtualObject = true;
                this.draggingVirtualObject = vo;

                // ドラッグ中はすべてのiframeのpointer-eventsを無効化                this.disableIframePointerEvents();

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

                // デバッグ: ドラッグ開始時のdatasetをログ出力
                logger.debug('[EDITOR] dragstart時のvo.dataset:', {
                    linkName: vo.dataset.linkName,
                    linkBgcol: vo.dataset.linkBgcol,
                    linkTbcol: vo.dataset.linkTbcol,
                    linkFrcol: vo.dataset.linkFrcol,
                    linkChcol: vo.dataset.linkChcol,
                    linkChsz: vo.dataset.linkChsz,
                    linkWidth: vo.dataset.linkWidth,
                    linkHeightpx: vo.dataset.linkHeightpx,
                    bgcol: vo.dataset.bgcol,
                    tbcol: vo.dataset.tbcol
                });

                // 仮身一覧プラグインへのドロップ用にJSON形式のデータを設定
                const virtualObj = this.buildVirtualObjFromDataset(vo.dataset);

                // PluginBase共通メソッドでdragDataを設定
                this.setVirtualObjectDragData(e, [virtualObj], 'basic-text-editor');

                logger.debug('[EDITOR] 仮身ドラッグ開始:', vo.dataset.linkName, 'モード:', this.virtualObjectDragState.dragMode);
            });

            // drag イベント: ドラッグ中の移動検知とコピーモード切り替え
            vo.addEventListener('drag', (e) => {
                // PluginBase共通メソッドでドラッグ移動を検知
                this.detectVirtualObjectDragMove(e);
            });

            vo.addEventListener('dragend', (e) => {
                logger.debug('[EDITOR] 仮身ドラッグ終了:', e.dataTransfer.dropEffect, 'isDragging:', this.isDraggingVirtualObject, 'dropSuccess:', this.virtualObjectDropSuccess);

                // ドラッグ終了時にすべてのiframeのpointer-eventsを再有効化
                const allIframes = this.editor.querySelectorAll('.virtual-object-content');
                allIframes.forEach(iframe => {
                    iframe.style.pointerEvents = 'auto';
                });
                logger.debug('[EDITOR] ドラッグ終了: iframe pointer-events再有効化 (', allIframes.length, '個)');

                // ドラッグ中フラグがfalseの場合は既に処理済みなのでスキップ（dragendの重複発火対策）
                if (!this.isDraggingVirtualObject) {
                    logger.debug('[EDITOR] 既に処理済み、スキップ');
                    return;
                }

                // cross-window-drop-successメッセージが到着する時間を待つ（500ms程度）
                setTimeout(() => {
                    // クロスウィンドウドロップ成功の場合は、既にcross-window-drop-successハンドラで処理済み
                    if (this.crossWindowDropSuccess) {
                        logger.debug('[EDITOR] クロスウィンドウドロップ成功、既に処理済み');
                        this.crossWindowDropSuccess = false; // フラグをリセット
                        return;
                    }

                    // 同じウィンドウ内でのドロップの場合
                    if (e.dataTransfer.dropEffect === 'move' && this.virtualObjectDropSuccess) {
                        // 要素がまだDOMに存在するかチェック（dragendの重複発火対策）
                        if (vo.parentNode) {
                            logger.debug('[EDITOR] 同じウィンドウ内で移動: 元の仮身を削除');
                            vo.remove();
                            this.isModified = true;
                            this.updateContentHeight();
                        } else {
                            logger.debug('[EDITOR] 仮身は既に削除済み、スキップ');
                        }
                    } else {
                        logger.debug('[EDITOR] ドロップキャンセルまたは失敗、元の仮身を保持');
                    }

                    // ドラッグ状態をクリア
                    this.isDraggingVirtualObject = false;
                    this.draggingVirtualObject = null;
                    this.draggingVirtualObjectData = null;
                    this.virtualObjectDropSuccess = false; // フラグをリセット

                    // PluginBase共通メソッドでドラッグ状態をクリーンアップ
                    this.cleanupVirtualObjectDragState();

                    // ダブルクリックドラッグ状態もクリーンアップ（意図しない複製を防止）
                    this.cleanupDblClickDragState();
                    this.dblClickDragState.lastClickedShape = null;
                }, 500);
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
                    logger.debug('[EDITOR] 仮身リサイズ開始:', vo.dataset.linkName, 'startWidth:', startWidth, 'startHeight:', startHeight, 'originalHeight:', originalHeight);

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
                                    logger.error('[EDITOR] 展開エラー:', err);
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
                            logger.debug('[EDITOR] リサイズにより originalHeight を更新:', vo.dataset.linkName, currentHeight);
                        }

                        // XMLに保存
                        this.updateVirtualObjectInXml(virtualObj);

                        logger.debug('[EDITOR] 仮身リサイズ終了、XMLに保存:', currentWidth, 'x', currentHeight, '座標:', vobjleft, vobjtop, vobjright, vobjbottom);
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
                logger.debug('[EDITOR] 仮身右クリック:', linkName, linkId);

                // 仮身を選択状態にする
                this.editor.querySelectorAll('.virtual-object.selected').forEach(other => {
                    other.classList.remove('selected');
                });
                vo.classList.add('selected');

                // 実身IDを抽出（共通メソッドを使用）
                const realId = window.RealObjectSystem.extractRealId(linkId);
                logger.debug('[EDITOR] 抽出されたrealId:', realId, 'from linkId:', linkId);

                // 右クリックされた仮身の情報を保存（メニュー生成時に使用）
                this.contextMenuVirtualObject = {
                    element: vo,
                    realId: realId,
                    virtualObj: this.buildVirtualObjFromDataset(vo.dataset)
                };
                logger.debug('[EDITOR] contextMenuVirtualObject設定完了:', this.contextMenuVirtualObject);

                // イベントを伝播させて通常の右クリックメニューを表示
            });

            // イベントハンドラー登録完了フラグを設定
            vo.dataset.handlersAttached = 'true';
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

        logger.debug('[EDITOR] 仮身自動展開チェック:', {
            name: vo.dataset.linkName || vo.textContent,
            chsz,
            height,
            minRequiredHeight,
            shouldExpand: height > minRequiredHeight
        });

        // 実際の高さが必要最小高さより大きい場合は自動展開
        if (height > minRequiredHeight && width > 0 && height > 0) {
            logger.debug('[EDITOR] 仮身を自動展開します:', vo.dataset.linkName || vo.textContent);
            // 次のイベントループで展開（DOMが完全に準備されてから）
            setTimeout(() => {
                this.expandVirtualObject(vo, width, height).catch(err => {
                    logger.error('[EDITOR] 自動展開エラー:', err);
                });
            }, 100);
        }
    }

    /**
     * すべての仮身に対して自動展開チェックを実行
     */
    checkAllVirtualObjectsForAutoExpand() {
        logger.debug('[EDITOR] すべての仮身の自動展開チェックを開始');
        const virtualObjects = this.editor.querySelectorAll('.virtual-object');
        logger.debug('[EDITOR] 検出された仮身数:', virtualObjects.length);

        virtualObjects.forEach((vo, index) => {
            logger.debug(`[EDITOR] 仮身[${index}]をチェック:`, vo.dataset.linkName || vo.textContent);
            this.checkAndAutoExpandVirtualObject(vo);
        });
    }

    /**
     * 実身のJSON metadataからappListを取得
     */
    // getAppListData() は基底クラス PluginBase で定義

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

    // buildVirtualObjFromDataset() は PluginBase で定義

    /**
     * 仮身の右クリックメニューを表示
     */
    showVirtualObjectContextMenu(e, vo, appListData) {
        logger.debug('[EDITOR] 仮身の右クリックメニュー表示', appListData);

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

        this.messageBus.send('show-virtual-object-context-menu', {
            x: rect.left + e.clientX,
            y: rect.top + e.clientY,
            menuDefinition: contextMenuDef,
            virtualObj: virtualObj
        });
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
     * applist属性を安全にパース
     * @param {string} applistStr - applist属性値
     * @returns {Object} パースされたオブジェクト、失敗時は空オブジェクト
     */
    parseApplist(applistStr) {
        if (!applistStr || applistStr.trim() === '') {
            return {};
        }
        try {
            const decoded = this.decodeHtml(applistStr);
            if (!decoded || decoded.trim() === '') {
                return {};
            }
            return JSON.parse(decoded);
        } catch (e) {
            logger.warn('[EDITOR] applistパースエラー:', applistStr, e.message);
            return {};
        }
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
            logger.error('保存エラー:', error);
            this.setStatus('保存に失敗しました');
        }
    }

    /**
     * エディタの内容をTAD XML形式に変換（TAD XMLタグをそのまま抽出）
     */
    async convertEditorToXML() {
        logger.debug('[EDITOR] convertEditorToXML開始');
        logger.debug('[EDITOR] エディタHTML:', this.editor.innerHTML.substring(0, 500));

        const xmlParts = ['<tad version="1.0" encoding="UTF-8">\r\n'];
        xmlParts.push('<document>\r\n');

        // <docScale>要素を出力（スケール単位）
        xmlParts.push(`<docScale hunit="${this.docScale.hunit}" vunit="${this.docScale.vunit}"/>\r\n`);

        // <text>要素を出力（言語・背景パターン）
        xmlParts.push(`<text lang="${this.docText.lang}" bpat="${this.docText.bpat}"/>\r\n`);

        // 用紙設定が設定されている場合のみ<paper>要素を出力
        if (this.paperSize) {
            xmlParts.push(this.paperSize.toXmlString() + '\r\n');
        }

        // 用紙設定が設定されている場合、または既存のマージン設定がある場合のみ<docmargin>要素を出力
        if (this.paperMargin || this.paperSize) {
            const margin = this.paperMargin || new window.PaperMargin();
            xmlParts.push(`<docmargin top="${margin.top}" bottom="${margin.bottom}" left="${margin.left}" right="${margin.right}" />\r\n`);
        }

        // エディタの各段落（<p>タグ）を処理
        const paragraphs = this.editor.querySelectorAll('p');
        logger.debug('[EDITOR] 段落数:', paragraphs.length);

        if (paragraphs.length === 0) {
            logger.warn('[EDITOR] 段落が見つかりません。エディタの全内容を1段落として処理します');
            // 段落がない場合、エディタ全体を1つの段落として扱う
            xmlParts.push('<p>\r\n');

            // デフォルトのフォント状態を設定
            const defaultFontState = {
                size: '14',
                color: null,  // null = 色未設定（黒色と区別）
                face: ''
            };

            this.extractTADXMLFromElement(this.editor, xmlParts, defaultFontState);
            xmlParts.push('\r\n</p>\r\n');
        } else {
            // エディタの直接の子要素を走査（段落外の仮身も処理するため）
            const editorChildren = Array.from(this.editor.childNodes);

            // デフォルトのフォント状態
            const defaultFontState = {
                size: '14',
                color: null,  // null = 色未設定（黒色と区別）
                face: ''
            };

            // 前の段落のフォント状態を追跡（冗長なタグ出力を防ぐ）
            let prevParagraphFontState = { ...defaultFontState };

            // 段落の有効色を追跡（ブラウザデフォルト黒色との区別用）
            let prevParagraphEffectiveColor = null;

            for (const child of editorChildren) {
                // 段落要素の処理
                if (child.nodeType === Node.ELEMENT_NODE && child.nodeName.toLowerCase() === 'p') {
                    const p = child;
                    xmlParts.push('<p>\r\n');

                    // 段落のスタイルを解析してタグに変換
                    const fontSize = this.extractFontSize(p);
                    const fontFamily = this.extractFontFamily(p);
                    const color = this.extractColor(p);
                    const textAlign = this.extractTextAlign(p);
                    const indentPx = this.extractIndentPx(p);

                    // text-align情報を自己閉じタグとして追加
                    if (textAlign && textAlign !== 'left') {
                        xmlParts.push(`<text align="${textAlign}"/>`);
                    }

                    // 段落の有効色を計算（段落のインラインカラー または 前段落の有効色）
                    const effectiveColor = color || prevParagraphEffectiveColor;

                    // 段落のフォント状態を設定
                    // ※sizeは前段落から継承されるサイズを使用する（現段落のfontSizeは行高計算用のため除外）
                    // これにより、SPAN要素に明示的に設定されたサイズと継承サイズを比較してペアタグ出力を判定できる
                    const paragraphFontState = {
                        size: prevParagraphFontState.size || '14',
                        color: color !== null ? color : prevParagraphFontState.color,
                        face: fontFamily || prevParagraphFontState.face
                    };

                    // 段落レベルでフォント情報を出力（前の段落と異なる場合のみ）
                    // ※色・サイズはペアタグ方式でSPAN要素レベルで処理するため、段落レベルでは出力しない
                    if (fontFamily && fontFamily !== prevParagraphFontState.face) {
                        xmlParts.push(`<font face="${fontFamily}"/>`);
                    }
                    // 段落レベルでフォントサイズを出力
                    const isEmptyParagraph = this.isParagraphEffectivelyEmpty(p);
                    let inheritedFontSizeForPairTag = null;  // ペアタグ出力用（空段落・非空段落共通）

                    // 空段落・非空段落共通：有効なフォントサイズ（14以外）があればペアタグで囲む
                    // ※読み込み時に段落にstyle.fontSizeが設定されるため、fontSizeがある場合も処理が必要
                    const effectiveFontSize = fontSize || prevParagraphFontState.size;
                    if (effectiveFontSize && effectiveFontSize !== '14') {
                        inheritedFontSizeForPairTag = effectiveFontSize;
                        // ペアタグで囲む場合、extractTADXMLFromElement()で重複タグが出力されないよう
                        // paragraphFontState.sizeを更新
                        paragraphFontState.size = effectiveFontSize;
                    }

                    // 次の段落のために現在の状態を保存
                    // ※sizeは段落のfontSizeを使用（空段落への継承用）
                    prevParagraphFontState = {
                        size: fontSize || prevParagraphFontState.size,
                        color: paragraphFontState.color,
                        face: paragraphFontState.face
                    };
                    prevParagraphEffectiveColor = effectiveColor;

                    // 段落の内容を取得（TAD XMLタグをそのまま保持）
                    const xmlPartsLengthBefore = xmlParts.length;

                    this.extractTADXMLFromElement(p, xmlParts, paragraphFontState, effectiveColor);

                    // extractTADXMLFromElement()が追加した内容を取得
                    const paragraphContentParts = xmlParts.slice(xmlPartsLengthBefore);
                    const paragraphContent = paragraphContentParts.join('');

                    // 追加された内容を一旦削除
                    xmlParts.length = xmlPartsLengthBefore;

                    // インデントタグを適切な位置に挿入（実測による文字位置特定）
                    // フォントサイズは段落のサイズ、または前段落からの継承サイズを使用
                    let finalContent = paragraphContent;
                    if (indentPx > 0) {
                        const effectiveFontSizePt = fontSize || prevParagraphFontState.size || '14';
                        const indentCharCount = await this.findIndentCharPositionByWidth(paragraphContent, indentPx, effectiveFontSizePt);
                        finalContent = this.insertIndentTagAtPosition(paragraphContent, indentCharCount);
                    }

                    // 継承フォントサイズがある場合、ペアタグで囲む
                    if (inheritedFontSizeForPairTag) {
                        finalContent = `<font size="${inheritedFontSizeForPairTag}">${finalContent}</font>`;
                    }

                    xmlParts.push(finalContent);

                    xmlParts.push('\r\n</p>\r\n');
                }
                // 段落外の仮身要素を処理（新しい段落として出力）
                else if (child.nodeType === Node.ELEMENT_NODE &&
                         child.classList &&
                         child.classList.contains('virtual-object')) {
                    xmlParts.push('<p>\r\n');
                    // 仮身単体をラッパーで包んで処理
                    const tempWrapper = document.createElement('div');
                    tempWrapper.appendChild(child.cloneNode(true));
                    this.extractTADXMLFromElement(tempWrapper, xmlParts, defaultFontState);
                    xmlParts.push('\r\n</p>\r\n');
                }
                // 条件付き改ページ要素を処理
                else if (child.nodeType === Node.ELEMENT_NODE &&
                         child.classList &&
                         child.classList.contains('conditional-page-break')) {
                    xmlParts.push(this.serializePageBreakElement(child));
                    xmlParts.push('\r\n');
                }
                // 通常の改ページ要素を処理
                else if (child.nodeType === Node.ELEMENT_NODE &&
                         child.classList &&
                         child.classList.contains('page-break') &&
                         !child.classList.contains('conditional-page-break')) {
                    // 通常の改ページは無条件改ページとして出力
                    xmlParts.push('<pagebreak cond="0" remain="0" />\r\n');
                }
                // その他の要素ノード（div等）も段落として処理
                else if (child.nodeType === Node.ELEMENT_NODE &&
                         child.nodeName.toLowerCase() !== 'br') {
                    xmlParts.push('<p>\r\n');
                    this.extractTADXMLFromElement(child, xmlParts, defaultFontState);
                    xmlParts.push('\r\n</p>\r\n');
                }
                // テキストノードがある場合も段落として処理
                else if (child.nodeType === Node.TEXT_NODE && child.textContent.trim()) {
                    xmlParts.push('<p>\r\n');
                    xmlParts.push(this.escapeXml(child.textContent));
                    xmlParts.push('\r\n</p>\r\n');
                }
                // BRは改行として処理（段落間の空行）
                else if (child.nodeType === Node.ELEMENT_NODE && child.nodeName.toLowerCase() === 'br') {
                    xmlParts.push('<p>\r\n<br/>\r\n</p>\r\n');
                }
            }
        }

        xmlParts.push('</document>\r\n');
        xmlParts.push('</tad>\r\n');

        const xml = xmlParts.join('');
        logger.debug('[EDITOR] convertEditorToXML完了, XML長さ:', xml.length);

        return xml;
    }

    /**
     * 要素からTAD XMLタグを抽出（タグをそのまま保持）
     * @param {Element} element - 処理対象の要素
     * @param {Array|Object} xmlParts - XML出力配列（後方互換性のためObjectも受け付ける）
     * @param {Object} fontState - 現在のフォント状態
     * @param {string|null} effectiveColor - 段落の有効色（ブラウザデフォルト黒色との区別用）
     */
    extractTADXMLFromElement(element, xmlParts, fontState = { size: '14', color: '#000000', face: '' }, effectiveColor = null) {
        // xmlPartsが配列でない場合（古い呼び出し方）は、配列を作成して戻り値を返す
        // 古いスタイル: extractTADXMLFromElement(element, fontState, effectiveColor)
        // 新しいスタイル: extractTADXMLFromElement(element, xmlPartsArray, fontState, effectiveColor)
        const isOldStyle = !Array.isArray(xmlParts);
        if (isOldStyle) {
            // 古いスタイルでは: xmlParts=fontState, fontState=effectiveColor
            const oldEffectiveColor = fontState;  // 3rd param was effectiveColor
            fontState = xmlParts || { size: '14', color: '#000000', face: '' };
            xmlParts = [];
            effectiveColor = (typeof oldEffectiveColor === 'string' || oldEffectiveColor === null) ? oldEffectiveColor : null;
        }

        let xml = '';  // 一時的な文字列（このメソッド内でのみ使用）
        const nodes = element.childNodes;

        nodes.forEach(node => {
            if (node.nodeType === Node.TEXT_NODE) {
                // テキストノードはXMLエスケープして追加
                // font sizeは親要素（span）で既に処理されているため、ここでは出力しない
                const escapedText = this.escapeXml(node.textContent);
                xml += escapedText;
            } else if (node.nodeName === 'BR') {
                // 改行タグ
                xml += '<br/>\r\n';
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

                    // 子要素を再帰的に処理（現在のフォント状態とeffectiveColorを引き継ぐ）
                    xml += this.extractTADXMLFromElement(node, fontState, effectiveColor);

                    // 終了タグ
                    xml += `</${nodeName}>`;
                }
                // document.execCommandで追加されるHTML要素を処理
                else if (nodeName === 'font') {
                    // <font>タグのスタイルを抽出
                    const color = this.rgbToHex(node.color || node.style.color);
                    const sizeAttr = node.size || this.extractFontSize(node);
                    const face = node.face || this.extractFontFamily(node);

                    // 新しい状態を作成
                    const newState = { ...fontState };

                    // フォントタグ追跡（ペアタグ用）
                    let colorTagOpened = false;
                    let sizeTagOpened = false;
                    let faceTagOpened = false;

                    // フォント情報を出力
                    // 色・サイズ・フェイスすべてペアタグ方式: <font ...>content</font>
                    // 黒色（#000000）はデフォルト色なので出力不要
                    if (color && color !== '#000000' && color !== fontState.color) {
                        xml += `<font color="${color}">`;
                        colorTagOpened = true;
                        newState.color = color;
                    }
                    if (sizeAttr) {
                        xml += `<font size="${sizeAttr}">`;
                        sizeTagOpened = true;
                        newState.size = sizeAttr;
                    }
                    if (face) {
                        xml += `<font face="${face}">`;
                        faceTagOpened = true;
                        newState.face = face;
                    }

                    // 子要素を再帰的に処理（新しいフォント状態とeffectiveColorを渡す）
                    xml += this.extractTADXMLFromElement(node, newState, effectiveColor);

                    // ペアタグを閉じる（開いた順の逆順で閉じる）
                    if (faceTagOpened) {
                        xml += '</font>';
                    }
                    if (sizeTagOpened) {
                        xml += '</font>';
                    }
                    if (colorTagOpened) {
                        xml += '</font>';
                    }
                }
                else if (nodeName === 'b' || nodeName === 'strong') {
                    xml += '<bold>';
                    xml += this.extractTADXMLFromElement(node, fontState, effectiveColor);
                    xml += '</bold>';
                }
                else if (nodeName === 'i' || nodeName === 'em') {
                    xml += '<italic>';
                    xml += this.extractTADXMLFromElement(node, fontState, effectiveColor);
                    xml += '</italic>';
                }
                else if (nodeName === 'u') {
                    xml += '<underline>';
                    xml += this.extractTADXMLFromElement(node, fontState, effectiveColor);
                    xml += '</underline>';
                }
                else if (nodeName === 'sup') {
                    // data-attend属性がある場合は元の属性を復元、なければデフォルト値
                    const type = node.getAttribute('data-attend-type') || '1';
                    const position = node.getAttribute('data-attend-position') || '0';
                    const unit = node.getAttribute('data-attend-unit') || '0';
                    const targetPosition = node.getAttribute('data-attend-target-position') || '0';
                    const baseline = node.getAttribute('data-attend-baseline') || '0';

                    xml += `<attend type="${type}" position="${position}" unit="${unit}" targetPosition="${targetPosition}" baseline="${baseline}">`;
                    xml += this.extractTADXMLFromElement(node, fontState, effectiveColor);
                    xml += '</attend>';
                }
                else if (nodeName === 'sub') {
                    // data-attend属性がある場合は元の属性を復元、なければデフォルト値
                    const type = node.getAttribute('data-attend-type') || '0';
                    const position = node.getAttribute('data-attend-position') || '0';
                    const unit = node.getAttribute('data-attend-unit') || '0';
                    const targetPosition = node.getAttribute('data-attend-target-position') || '0';
                    const baseline = node.getAttribute('data-attend-baseline') || '0';

                    xml += `<attend type="${type}" position="${position}" unit="${unit}" targetPosition="${targetPosition}" baseline="${baseline}">`;
                    xml += this.extractTADXMLFromElement(node, fontState, effectiveColor);
                    xml += '</attend>';
                }
                else if (nodeName === 'span') {
                    // タブマーカー（表示用）はタブ文字として出力
                    if (node.classList && node.classList.contains('tab-marker')) {
                        xml += '\t';
                    }
                    // 仮身（virtual-object）を<link>タグに変換
                    else if (node.classList && node.classList.contains('virtual-object')) {
                        // すべてのdata-link-*属性を復元（innercontentと閉じた状態の座標属性を除く）
                        const isExpanded = node.classList.contains('expanded');
                        let attrs = '';
                        let innerContent = '';
                        let applistAttr = '';

                        for (const key in node.dataset) {
                            if (key.startsWith('link')) {
                                const attrName = key.replace(/^link/, '').toLowerCase();
                                const attrValue = node.dataset[key];

                                // innercontentとnameは不要（link_nameはJSONから取得する方式に統一）
                                if (attrName === 'innercontent' || attrName === 'name') {
                                    continue;
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
                        // 自己閉じタグ形式（link_nameはJSONから取得する方式に統一）
                        xml += `<link${attrs}${applistAttr}/>`;
                    } else if (!node._tabProcessed) {
                        // 処理済みのタブspanはスキップ

                        // 固定サイズ（14pt）のタブ文字の特別処理
                        // インラインスタイルからスタイル情報を取得
                        // computedStyleは使用しない（ブラウザデフォルトが混入するため）
                        const style = {
                            color: this.getTadStyleFromSpan(node, 'color') || '',
                            fontSize: this.getTadStyleFromSpan(node, 'size') ? `${this.getTadStyleFromSpan(node, 'size')}pt` : (node.style.fontSize || ''),
                            fontFamily: this.getTadStyleFromSpan(node, 'face') || node.style.fontFamily || ''
                        };
                        const textContent = node.textContent;

                        // タブ文字を含むかチェック
                        if (textContent.includes('\t')) {
                            // フォントサイズを14ptと比較（px単位の場合も考慮: 14pt ≈ 18.67px）
                            let is14pt = false;
                            if (style.fontSize) {
                                if (style.fontSize === '14pt') {
                                    is14pt = true;
                                } else if (style.fontSize.endsWith('px')) {
                                    const px = parseFloat(style.fontSize);
                                    // 14pt = 18.6667px (許容誤差0.5px)
                                    is14pt = Math.abs(px - 18.6667) < 0.5;
                                }
                            }

                            // タブのみの場合（1つまたは連続したタブ）
                            if (is14pt && /^[\t]+$/.test(textContent)) {
                                // 連続タブの終端を探す
                                let endNode = node;
                                let allTabs = textContent;

                                // 次の兄弟が14ptのタブspanである限り、スキップして全タブ文字を収集
                                while (endNode.nextSibling &&
                                       endNode.nextSibling.nodeType === Node.ELEMENT_NODE &&
                                       endNode.nextSibling.nodeName === 'SPAN') {
                                    const nextSpan = endNode.nextSibling;
                                    const nextStyle = nextSpan.style;
                                    const nextText = nextSpan.textContent;

                                    // 14ptのタブspanかチェック
                                    let nextIs14pt = false;
                                    if (nextStyle.fontSize) {
                                        if (nextStyle.fontSize === '14pt') {
                                            nextIs14pt = true;
                                        } else if (nextStyle.fontSize.endsWith('px')) {
                                            const px = parseFloat(nextStyle.fontSize);
                                            nextIs14pt = Math.abs(px - 18.6667) < 0.5;
                                        }
                                    }

                                    if (nextIs14pt && /^[\t]+$/.test(nextText)) {
                                        // 連続タブの一部なので、タブ文字を追加してスキップ
                                        allTabs += nextText;
                                        endNode = nextSpan;
                                    } else {
                                        // タブspanでないので終了
                                        break;
                                    }
                                }

                                // 連続タブの終端の次のノードからフォントサイズを取得
                                let nextFontSize = fontState.size || '14';
                                if (endNode.nextSibling &&
                                    endNode.nextSibling.nodeType === Node.ELEMENT_NODE &&
                                    endNode.nextSibling.nodeName === 'SPAN' &&
                                    endNode.nextSibling.style.fontSize) {
                                    const size = window.roundFontSize(endNode.nextSibling.style.fontSize.replace('pt', '').replace('px', ''));
                                    if (size) nextFontSize = size;
                                }

                                // タブ文字を出力（自己閉じタグは使用しない）
                                // タブは14ptで表示されるため、fontStateを14にリセット
                                // 後続のSPAN要素処理でペアタグが正しく出力される
                                xml += allTabs;
                                fontState.size = '14';

                                // 処理済みのタブspanをスキップするためのマーク
                                // (次のループでこのノードが再度処理されないように)
                                let skipNode = node.nextSibling;
                                while (skipNode && skipNode !== endNode.nextSibling) {
                                    if (skipNode.nodeType === Node.ELEMENT_NODE) {
                                        skipNode._tabProcessed = true;
                                    }
                                    skipNode = skipNode.nextSibling;
                                }
                            } else {
                                // タブ+他の文字の場合、または14pt以外の場合
                                // テキストを分割してタブを個別処理
                                const parts = textContent.split(/(\t)/);

                                // タブ後のフォントサイズを決定
                                let tabFollowSize = fontState.size || '14';
                                if (node.nextSibling &&
                                    node.nextSibling.nodeType === Node.ELEMENT_NODE &&
                                    node.nextSibling.nodeName === 'SPAN' &&
                                    node.nextSibling.style.fontSize) {
                                    tabFollowSize = window.roundFontSize(node.nextSibling.style.fontSize.replace('pt', '').replace('px', ''));
                                } else if (style.fontSize) {
                                    // span自身のフォントサイズ
                                    tabFollowSize = window.roundFontSize(style.fontSize.replace('pt', '').replace('px', ''));
                                }

                                parts.forEach((part, index) => {
                                    if (part === '\t') {
                                        // タブは14ptで出力（自己閉じタグは使用しない）
                                        xml += '\t';
                                        fontState.size = '14';  // タブ後はfontStateを14にリセット
                                    } else if (part.length > 0) {
                                        // テキスト部分をペアタグで囲む
                                        const textSize = tabFollowSize || fontState.size || '14';
                                        if (textSize !== '14') {
                                            xml += `<font size="${textSize}">`;
                                            xml += this.escapeXml(part);
                                            xml += '</font>';
                                        } else {
                                            xml += this.escapeXml(part);
                                        }
                                        fontState.size = textSize;
                                    }
                                });
                            }
                        } else {
                            // 空のspan要素（テキストなし）の場合、fontタグ出力せずに状態のみ更新
                            // ゼロ幅スペース（\u200B）も空扱いとする
                            const hasTextContent = node.textContent && node.textContent.replace(/\u200B/g, '').trim().length > 0;

                            if (!hasTextContent) {
                                // 空のspan要素の場合、fontStateのみ更新して子要素を処理
                                const newState = { ...fontState };

                                if (style.fontSize) {
                                    const size = window.roundFontSize(style.fontSize.replace('pt', '').replace('px', ''));
                                    newState.size = size;
                                }
                                if (style.color) {
                                    const hexColor = this.rgbToHex(style.color);
                                    const isDefaultBlack = hexColor === '#000000';
                                    // ブラウザデフォルト黒色で有効色が非黒色の場合は状態を更新しない
                                    if (!(isDefaultBlack && effectiveColor && effectiveColor !== '#000000')) {
                                        newState.color = hexColor;
                                    }
                                }
                                if (style.fontFamily) {
                                    newState.face = style.fontFamily;
                                }

                                // 子要素を処理（空要素でも子要素がある可能性）
                                xml += this.extractTADXMLFromElement(node, newState, effectiveColor);

                                // fontStateを更新（呼び出し元に反映）
                                fontState.color = newState.color;
                                fontState.size = newState.size;
                                fontState.face = newState.face;
                            } else {
                                // テキストを含むspan要素の通常処理
                                // 新しい状態を作成
                                const newState = { ...fontState };

                                // フォントタグを追跡（ペアタグ用）
                                let colorTagOpened = false;
                                let sizeTagOpened = false;
                                let faceTagOpened = false;

                                // スタイル開始
                                // 色・サイズ・フェイスすべてペアタグ方式: <font ...>content</font>
                                if (style.color) {
                                    const hexColor = this.rgbToHex(style.color);
                                    // ペアタグ方式：色があれば常に出力
                                    xml += `<font color="${hexColor}">`;
                                    colorTagOpened = true;
                                    newState.color = hexColor;
                                }
                                if (style.fontSize) {
                                    const size = window.roundFontSize(style.fontSize.replace('pt', '').replace('px', ''));
                                    // ペアタグ方式：親と異なるサイズの場合のみ出力（重複防止）
                                    if (size !== fontState.size) {
                                        xml += `<font size="${size}">`;
                                        sizeTagOpened = true;
                                    }
                                    newState.size = size;
                                }
                                if (style.fontFamily) {
                                    if (style.fontFamily !== fontState.face) {
                                        // ペアタグ方式：フェイスが変わった場合のみ出力
                                        xml += `<font face="${style.fontFamily}">`;
                                        faceTagOpened = true;
                                    }
                                    // newStateは常に更新
                                    newState.face = style.fontFamily;
                                }

                                // 子要素を再帰的に処理（新しいフォント状態を渡す）
                                xml += this.extractTADXMLFromElement(node, newState, effectiveColor);

                                // ペアタグを閉じる（開いた順の逆順で閉じる）
                                if (faceTagOpened) {
                                    xml += '</font>';
                                }
                                if (sizeTagOpened) {
                                    xml += '</font>';
                                }
                                if (colorTagOpened) {
                                    xml += '</font>';
                                }

                                // fontStateを更新（ペアタグとして閉じたものは除外、スコープ終了のため）
                                // ペアタグを開いた場合、そのスコープは終了したので、
                                // 兄弟要素に状態を伝搬させない（同じフォントの別span要素も正しく出力するため）
                                if (!colorTagOpened) {
                                    fontState.color = newState.color;
                                }
                                if (!sizeTagOpened) {
                                    fontState.size = newState.size;
                                }
                                if (!faceTagOpened) {
                                    fontState.face = newState.face;
                                }
                            }
                        }
                    }
                }
                else {
                    // その他のHTML要素は内容のみ抽出（現在のフォント状態とeffectiveColorを引き継ぐ）
                    xml += this.extractTADXMLFromElement(node, fontState, effectiveColor);
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
            const size = style.replace('pt', '').replace('px', '');
            return window.roundFontSize(size);
        }
        return null;
    }

    /**
     * 段落が実質的に空かどうかを判定
     * <br>のみ、またはゼロ幅スペースのみのspanを含む場合にtrueを返す
     * @param {HTMLElement} paragraph - 段落要素
     * @returns {boolean}
     */
    isParagraphEffectivelyEmpty(paragraph) {
        const children = paragraph.childNodes;

        for (const child of children) {
            if (child.nodeType === Node.ELEMENT_NODE) {
                if (child.nodeName === 'BR') {
                    continue;  // <br>は空扱い
                }
                if (child.nodeName === 'SPAN') {
                    // ゼロ幅スペースのみなら空扱い
                    const text = child.textContent.replace(/\u200B/g, '').trim();
                    if (text === '') {
                        continue;
                    }
                }
                return false;  // 他の要素があれば空ではない
            } else if (child.nodeType === Node.TEXT_NODE) {
                // テキストノードがあれば空ではない（ゼロ幅スペース除く）
                const text = child.textContent.replace(/\u200B/g, '').trim();
                if (text !== '') {
                    return false;
                }
            }
        }

        return true;  // 全て空扱いの要素のみ
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
     * 段落から色を抽出（常に16進数形式で返す）
     */
    extractColor(element) {
        const style = element.style.color;
        if (style) {
            // RGB形式を16進数に変換して返す
            return this.rgbToHex(style);
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
     * <indent/>タグより前のXMLコンテンツの実際の文字幅を計算
     * DOMに実際に配置して実測することで正確な幅を取得
     * <br/>がある場合は、<indent/>と同じ行のテキストのみを測定
     * @param {string} xmlContent - <indent/>タグより前のXMLコンテンツ
     * @param {string} paragraphStyle - 段落全体のスタイル文字列
     * @returns {Promise<number>} 計算された文字幅（ピクセル）
     */
    async calculateTextWidthBeforeIndent(xmlContent, paragraphStyle = '') {
        // 改行コードや余分な空白を削除
        let cleanedXml = xmlContent.replace(/\r\n|\r|\n/g, '');

        // <br/>がある場合は、最後の<br/>以降のテキストのみを測定
        // （<indent/>と同じ行にあるテキストの幅が必要）
        const brMatch = cleanedXml.match(/^([\s\S]*)<br\s*\/?>/i);
        if (brMatch) {
            // 最後の<br/>以降のコンテンツを取得
            const lastBrIndex = cleanedXml.lastIndexOf('<br');
            if (lastBrIndex !== -1) {
                // <br/>タグの終了位置を見つける
                const brEndIndex = cleanedXml.indexOf('>', lastBrIndex);
                if (brEndIndex !== -1) {
                    cleanedXml = cleanedXml.substring(brEndIndex + 1);
                }
            }
        }

        // タブ文字を14ptのspanに包む（BTRONではタブは常に14pt）
        // 複数のタブ文字も一括で処理
        cleanedXml = cleanedXml.replace(/(\t+)/g, '<span style="font-size: 14pt;">$1</span>');

        // エディタの計算済みスタイルを取得
        const editorStyle = window.getComputedStyle(this.editor);

        // 一時的な測定用要素を作成（段落要素として作成）
        const measureElement = document.createElement('p');

        // 段落のスタイルを適用
        measureElement.style.cssText = paragraphStyle;

        // エディタのフォント関連のスタイルを明示的にコピー
        measureElement.style.fontFamily = editorStyle.fontFamily;
        measureElement.style.fontSize = editorStyle.fontSize;
        measureElement.style.fontWeight = editorStyle.fontWeight;
        measureElement.style.fontStyle = editorStyle.fontStyle;
        measureElement.style.lineHeight = editorStyle.lineHeight;
        measureElement.style.letterSpacing = editorStyle.letterSpacing;

        // タブサイズを明示的に設定
        measureElement.style.tabSize = '4';
        measureElement.style.MozTabSize = '4';

        // 測定用の必須スタイルを設定
        measureElement.style.position = 'absolute';
        measureElement.style.visibility = 'hidden';
        measureElement.style.whiteSpace = 'pre';
        measureElement.style.top = '-9999px';
        measureElement.style.left = '-9999px';
        measureElement.style.pointerEvents = 'none';
        measureElement.style.margin = '0';
        measureElement.style.padding = '0';
        measureElement.style.border = 'none';

        // XMLコンテンツをHTMLに変換して配置
        const htmlContent = await this.convertDecorationTagsToHTML(cleanedXml);
        measureElement.innerHTML = htmlContent;

        // エディタ内に追加して測定（エディタのすべてのスタイルを継承）
        this.editor.appendChild(measureElement);
        const width = measureElement.getBoundingClientRect().width;
        this.editor.removeChild(measureElement);

        return width;
    }

    /**
     * 段落からインデント幅（ピクセル）を抽出（<indent/>タグ用）
     */
    extractIndentPx(element) {
        const paddingLeft = parseFloat(element.style.paddingLeft) || 0;
        const textIndent = parseFloat(element.style.textIndent) || 0;

        // padding-leftとtext-indentが設定されていて、text-indentが負の値の場合
        if (paddingLeft > 0 && textIndent < 0 && Math.abs(textIndent) === paddingLeft) {
            return paddingLeft;
        }

        return 0;
    }

    /**
     * XMLコンテンツから指定ピクセル幅に対応する文字位置を実測で特定
     * @param {string} xmlContent - XMLコンテンツ
     * @param {number} targetWidth - 目標のピクセル幅
     * @returns {Promise<number>} 文字位置（0始まり）
     */
    async findIndentCharPositionByWidth(xmlContent, targetWidth, fontSizePt = '14') {
        if (targetWidth <= 0) {
            return 0;
        }

        // XMLからタグを除いた実際の文字列を取得
        let charPositions = []; // [{xmlIndex: XMLでの位置, char: 文字}]
        let i = 0;

        while (i < xmlContent.length) {
            if (xmlContent[i] === '<') {
                // タグをスキップ
                const tagEnd = xmlContent.indexOf('>', i);
                if (tagEnd === -1) break;
                i = tagEnd + 1;
            } else if (xmlContent[i] === '&') {
                // エンティティ
                const entityEnd = xmlContent.indexOf(';', i);
                if (entityEnd === -1) break;
                const entity = xmlContent.substring(i, entityEnd + 1);
                // エンティティを実際の文字に変換
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = entity;
                charPositions.push({ xmlIndex: i, char: tempDiv.textContent });
                i = entityEnd + 1;
            } else {
                // 通常の文字
                charPositions.push({ xmlIndex: i, char: xmlContent[i] });
                i++;
            }
        }

        // 1文字ずつ追加しながら幅を測定し、targetWidthに最も近い位置を探す
        let bestPosition = 0;
        let bestDiff = targetWidth;

        for (let pos = 1; pos <= charPositions.length; pos++) {
            const testText = charPositions.slice(0, pos).map(p => p.char).join('');
            const width = await this.measureXmlTextWidth(testText, fontSizePt);

            const diff = Math.abs(width - targetWidth);
            if (diff < bestDiff) {
                bestDiff = diff;
                bestPosition = pos;
            }

            // 目標幅を超えたら終了（最も近い位置は見つかっている）
            if (width >= targetWidth) {
                break;
            }
        }

        return bestPosition;
    }

    /**
     * テキストの実際の幅を測定（エディタのスタイルを使用）
     * @param {string} text - 測定するテキスト
     * @param {string} fontSizePt - フォントサイズ（ポイント単位、デフォルト: '14'）
     */
    async measureXmlTextWidth(text, fontSizePt = '14') {
        const measureElement = document.createElement('span');
        const editorStyle = window.getComputedStyle(this.editor);

        measureElement.style.fontFamily = editorStyle.fontFamily;
        measureElement.style.fontSize = `${fontSizePt}pt`;  // 指定されたフォントサイズを使用
        measureElement.style.fontWeight = editorStyle.fontWeight;
        measureElement.style.fontStyle = editorStyle.fontStyle;
        measureElement.style.letterSpacing = editorStyle.letterSpacing;
        measureElement.style.whiteSpace = 'pre';
        measureElement.style.position = 'absolute';
        measureElement.style.visibility = 'hidden';
        measureElement.style.top = '-9999px';
        measureElement.textContent = text;

        this.editor.appendChild(measureElement);
        const width = measureElement.getBoundingClientRect().width;
        this.editor.removeChild(measureElement);

        return width;
    }

    /**
     * XMLコンテンツの特定の文字位置に<indent/>タグを挿入
     * charCountは「インデント位置より前の文字数」を表す
     * つまり、charCount文字の後に<indent/>を挿入する
     */
    insertIndentTagAtPosition(xmlContent, charCount) {
        if (charCount <= 0) {
            return xmlContent;
        }

        let charCounter = 0;
        let result = '';
        let i = 0;
        let indentInserted = false;

        while (i < xmlContent.length) {
            if (xmlContent[i] === '<') {
                // タグの開始
                const tagEnd = xmlContent.indexOf('>', i);
                if (tagEnd === -1) {
                    // タグが閉じていない（エラー）
                    result += xmlContent.substring(i);
                    break;
                }

                const tag = xmlContent.substring(i, tagEnd + 1);
                result += tag;
                i = tagEnd + 1;
            } else if (xmlContent[i] === '&') {
                // エンティティの開始
                const entityEnd = xmlContent.indexOf(';', i);
                if (entityEnd === -1) {
                    // エンティティが閉じていない（エラー）
                    result += xmlContent.substring(i);
                    break;
                }

                // インデントタグを挿入（文字を追加する前にチェック）
                if (!indentInserted && charCounter === charCount) {
                    result += '<indent/>';
                    indentInserted = true;
                }

                const entity = xmlContent.substring(i, entityEnd + 1);
                result += entity;
                charCounter++; // エンティティは1文字としてカウント
                i = entityEnd + 1;
            } else {
                // インデントタグを挿入（文字を追加する前にチェック）
                if (!indentInserted && charCounter === charCount) {
                    result += '<indent/>';
                    indentInserted = true;
                }

                // 通常の文字
                result += xmlContent[i];
                charCounter++;
                i++;
            }
        }

        // 最後まで挿入されなかった場合（charCountがコンテンツ長と一致）
        if (!indentInserted && charCounter === charCount) {
            result += '<indent/>';
        }

        return result;
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
                text += '<br/>\r\n';
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                const nodeName = node.nodeName.toUpperCase();
                const innerText = this.convertHTMLToText(node);

                // HTML要素をTAD XMLタグに変換
                // 標準HTMLタグ
                if (nodeName === 'U' || nodeName === 'UNDERLINE') {
                    text += `<underline>${innerText}</underline>`;
                } else if (nodeName === 'S' || nodeName === 'STRIKETHROUGH') {
                    text += `<strikethrough>${innerText}</strikethrough>`;
                } else if (nodeName === 'OVERLINE') {
                    text += `<overline>${innerText}</overline>`;
                } else if (nodeName === 'INVERT') {
                    text += `<invert>${innerText}</invert>`;
                } else if (nodeName === 'MESH') {
                    text += `<mesh>${innerText}</mesh>`;
                } else if (nodeName === 'NOPRINT') {
                    text += `<noprint>${innerText}</noprint>`;
                } else if (nodeName === 'BAGCHAR') {
                    text += `<bagchar>${innerText}</bagchar>`;
                } else if (nodeName === 'BOX') {
                    text += `<box>${innerText}</box>`;
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

    // escapeXml は PluginBase に移動済み

    /**
     * RGB/RGBA形式の色を#rrggbb形式に変換（共通ユーティリティを使用）
     * @param {string} color - rgb(r, g, b) または rgba(r, g, b, a) または #rrggbb 形式の色
     * @returns {string} #rrggbb形式の色
     */
    rgbToHex(color) {
        if (!color) return '';

        let result;

        // 既に#rrggbb形式の場合
        if (color.startsWith('#')) {
            result = color;
        } else {
            // 共通ユーティリティ関数を使用
            result = window.rgbToHex ? window.rgbToHex(color) : color;
        }

        // Chrome workaround: #010101（黒色の代替）を#000000に正規化
        if (result && result.toLowerCase() === '#010101') {
            result = '#000000';
        }

        return result;
    }

    /**
     * XMLとしてエクスポート
     * エディタの内容をTAD XML形式に変換して保存
     */
    async exportToXML() {
        try {
            this.setStatus('エクスポート中...');

            // エディタの内容をTAD XML形式に変換
            const xmlContent = await this.convertEditorToXML();

            // 変換後のXMLをtadDataに保存（原稿モード表示用）
            this.tadData = xmlContent;

            logger.debug('[EDITOR] XMLエクスポート, 長さ:', xmlContent.length);

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
            logger.error('[EDITOR] エクスポートエラー:', error);
            this.setStatus('エクスポートに失敗しました');
        }
    }

    /**
     * 親ウインドウにXMLデータの変更を通知（自動保存用）
     */
    async notifyXmlDataChanged() {
        // 保存時にスクロール位置、折り返し設定も保存
        this.saveScrollPosition();
        this.updateWindowConfig({ wordWrap: this.wrapMode });

        if (window.parent && window.parent !== window) {
            // エディタの内容をTAD XML形式に変換
            const xmlContent = await this.convertEditorToXML();

            // tadDataを更新
            this.tadData = xmlContent;

            this.messageBus.send('xml-data-changed', {
                fileId: this.realId,
                xmlData: xmlContent
            });
            logger.debug('[EDITOR] xmlTAD変更を通知, realId:', this.realId);
        }
    }

    /**
     * 新たな実身に保存（非再帰的コピー）
     */
    async saveAsNewRealObject() {
        logger.debug('[EDITOR] saveAsNewRealObject - realId:', this.realId);

        // まず現在のデータを保存
        this.notifyXmlDataChanged();
        this.isModified = false;

        // 親ウィンドウに新たな実身への保存を要求
        const messageId = this.generateMessageId('save-as-new');

        this.messageBus.send('save-as-new-real-object', {
            realId: this.realId,
            messageId: messageId
        });

        logger.debug('[EDITOR] 新たな実身への保存要求:', this.realId);

        try {
            // レスポンスを待つ（ユーザー入力を待つのでタイムアウト無効）
            const result = await this.messageBus.waitFor('save-as-new-real-object-completed', 0, (data) => {
                return data.messageId === messageId;
            });

            if (result.cancelled) {
                logger.debug('[EDITOR] 新たな実身への保存がキャンセルされました');
                this.setStatus('保存がキャンセルされました');
            } else if (result.success) {
                logger.debug('[EDITOR] 新たな実身への保存成功:', result.newRealId, '名前:', result.newName);

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

                        logger.debug('[EDITOR] 既存仮身から属性を取得:', vobjAttributes);
                    } catch (e) {
                        logger.warn('[EDITOR] 既存仮身の属性取得失敗、デフォルト値を使用:', e);
                    }
                }

                // 新しい仮身をカーソル位置（すぐ後）に挿入
                const newVirtualObject = {
                    link_id: `${result.newRealId}_0.xtad`,
                    link_name: result.newName,
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

                // insertVirtualObjectLinkを使って仮身を挿入
                this.insertVirtualObjectLink(newVirtualObject);

                // XMLデータを更新して保存
                this.notifyXmlDataChanged();

                this.setStatus('新しい実身に保存しました: ' + result.newName);
                logger.debug('[EDITOR] 新しい仮身をエディタに挿入しました');
            } else {
                logger.error('[EDITOR] 新たな実身への保存失敗:', result.error);
                this.setStatus('保存に失敗しました');
            }
        } catch (error) {
            logger.error('[EDITOR] 新たな実身への保存エラー:', error);
            this.setStatus('保存に失敗しました');
        }
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
        logger.debug(`[基本文章編集] ${message}`);
        // 親ウィンドウにステータスメッセージを送信（PluginBaseの共通実装を呼び出し）
        super.setStatus(message);
    }

    /**
     * 入力ダイアログを表示（プロンプトの置き換え）
     * @param {string} message - 表示するメッセージ
     * @param {string} defaultValue - デフォルト値
     * @param {number} inputWidth - 入力欄の幅（文字数）
     * @returns {Promise<string|null>} - 入力値またはnull（キャンセル時）
     */
    // showInputDialog() は基底クラス PluginBase で定義

    /**
     * メッセージダイアログを表示
     * @param {string} message - 表示するメッセージ
     * @param {Array} buttons - ボタン定義配列
     * @param {number} defaultButton - デフォルトボタンのインデックス
     * @returns {Promise<any>} - 選択されたボタンの値
     */
    // showMessageDialog() は基底クラス PluginBase で定義

    // setupWindowActivation() は PluginBase 共通メソッドを使用

    /**
     * 右クリックメニューのセットアップ
     * ※tadjs-desktop.htmlのメニューシステムを使用するため、独自メニューは無効化
     */
    setupContextMenu() {
        // iframe内の右クリックを無効化し、親ウィンドウに通知
        document.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();

            // ドラッグ中は右クリックメニューを表示しない（コピーモード用の右ボタン操作として使用）
            if (this.isDraggingVirtualObject) {
                logger.debug('[EDITOR] ドラッグ中のため右クリックメニューを抑制');
                return;
            }

            // 親ウィンドウに右クリック位置を通知（共通メソッドを使用）
            this.showContextMenuAtEvent(e);
        });
    }

    /**
     * メニュー定義
     */
    async getMenuDefinition() {
        // 選択範囲の有無を確認（仮身化メニューの有効/無効判定用）
        const selection = window.getSelection();
        const hasSelection = selection && selection.toString().trim().length > 0;

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
                    { label: 'ウインドウ幅で折り返しオンオフ', action: 'toggle-wrap' }
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
                    { label: '検索/置換', action: 'find-replace', shortcut: 'Ctrl+F' },
                    { separator: true },
                    { label: '仮身化', action: 'virtualize', shortcut: 'Ctrl+9', disabled: !hasSelection }
                ]
            },
            {
                label: '書体',
                submenu: this.getFontSubmenu()
            },
            {
                label: '文字修飾',
                submenu: [
                    { label: '標準', action: 'style-normal' },
                    { label: '太字', action: 'style-bold', shortcut: 'Ctrl+B' },
                    { label: '斜体', action: 'style-italic',
                        shortcut: 'Ctrl+Shift+I'},
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
                    { separator: true },
                    { label: '字下げ', action: 'style-indent', shortcut: 'Tab' },
                    { label: '解除', action: 'style-clear' }
                ]
            },
            {
                label: '文字サイズ',
                submenu: [
                    { label: '5（1/2倍）', action: 'size-5' },
                    { label: '7（3/4倍）', action: 'size-7' },
                    { label: '8', action: 'size-8' },
                    { label: '9.6（旧標準）', action: 'size-9.6' },
                    { label: '11', action: 'size-11' },
                    { label: '12', action: 'size-12' },
                    { label: '13', action: 'size-13' },
                    { label: '14（標準）', action: 'size-14' },
                    { label: '16', action: 'size-16' },
                    { label: '18', action: 'size-18' },
                    { label: '21（1.5倍）', action: 'size-21' },
                    { label: '28（2倍）', action: 'size-28' },
                    { label: '40', action: 'size-40' },
                    { label: '60', action: 'size-60' },
                    { label: '80', action: 'size-80' },
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
                    { label: '字下げ', action: 'format-indent', shortcut: 'Ctrl+I' },
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
                    { label: '改ページ', action: 'format-pagebreak' },
                    { separator: true },
                    { label: '用紙枠表示オンオフ', action: 'toggle-paper-frame' },
                    { label: '用紙設定...', action: 'page-setup' }
                ]
            }
        ];

        // 仮身が選択されている場合は仮身操作メニューを追加
        logger.debug('[EDITOR] getMenuDefinition: contextMenuVirtualObject:', this.contextMenuVirtualObject);
        if (this.contextMenuVirtualObject) {
            try {
                logger.debug('[EDITOR] getMenuDefinition: 仮身が選択されています realId:', this.contextMenuVirtualObject.realId);

                // 仮身操作メニュー
                const realId = this.contextMenuVirtualObject.realId;
                const isOpened = this.openedRealObjects.has(realId);

                const virtualObjSubmenu = [
                    { label: '開く', action: 'open-real-object', disabled: isOpened },
                    { label: '閉じる', action: 'close-real-object', disabled: !isOpened },
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
                    { label: '管理情報', action: 'open-realobject-config' },
                    { label: '仮身ネットワーク', action: 'open-virtual-object-network' },
                    { label: '実身/仮身検索', action: 'open-real-object-search' }
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
                logger.debug('[EDITOR] getMenuDefinition: applistData:', applistData);
                if (applistData && Object.keys(applistData).length > 0) {
                    const executeSubmenu = [];
                    for (const [pluginId, appInfo] of Object.entries(applistData)) {
                        logger.debug('[EDITOR] getMenuDefinition: 実行メニュー項目追加:', pluginId, appInfo);
                        executeSubmenu.push({
                            label: appInfo.name || pluginId,
                            action: `execute-with-${pluginId}`
                        });
                    }

                    menuDef.push({
                        label: '実行',
                        submenu: executeSubmenu
                    });
                    logger.debug('[EDITOR] getMenuDefinition: 実行メニュー追加完了 項目数:', executeSubmenu.length);
                } else {
                    logger.warn('[EDITOR] getMenuDefinition: applistDataが空またはnull');
                }
            } catch (error) {
                logger.error('[EDITOR] applist取得エラー:', error);
            }
        } else {
            logger.debug('[EDITOR] getMenuDefinition: 仮身が選択されていません');
        }

        return menuDef;
    }

    // showContextMenu() / renderMenu() / hideContextMenu() は PluginBase 共通メソッドを使用

    /**
     * メニューアクションを実行
     */
    executeMenuAction(action, additionalData) {
        logger.debug('[EDITOR] メニューアクション:', action, additionalData);

        // 仮身の実行メニューからのアクション
        if (action.startsWith('execute-with-')) {
            const pluginId = action.replace('execute-with-', '');
            logger.debug('[EDITOR] 仮身を指定アプリで起動:', pluginId);

            // contextMenuVirtualObjectから仮身情報を取得
            if (this.contextMenuVirtualObject && this.contextMenuVirtualObject.virtualObj) {
                    this.messageBus.send('open-virtual-object-real', {
                    virtualObj: this.contextMenuVirtualObject.virtualObj,
                    pluginId: pluginId
                });
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
                // メニューからの呼び出し時はフォーカスがないためエディタにフォーカスを戻す
                this.editor.focus();
                document.execCommand('undo');
                this.setStatus('元に戻しました');
                break;
            case 'copy':
                // メニューからの呼び出し時はフォーカスがないためエディタにフォーカスを戻す
                this.editor.focus();
                // 画像が選択されている場合は画像をコピー
                if (this.selectedImage) {
                    this.copyImage(this.selectedImage);
                    this.setStatus('画像をクリップボードへコピーしました');
                } else if (this.selectedVirtualObject) {
                    // 仮身が選択されている場合は仮身をコピー
                    this.copyVirtualObject(this.selectedVirtualObject);
                    this.setStatus('仮身をクリップボードへコピーしました');
                } else {
                    // テキストをクリップボードにコピー（Clipboard API使用）
                    this.copyTextToClipboard();
                }
                break;
            case 'paste':
                // メニューからの呼び出し時はフォーカスがないためエディタにフォーカスを戻す
                this.editor.focus();
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
                // メニューからの呼び出し時はフォーカスがないためエディタにフォーカスを戻す
                this.editor.focus();
                // 画像が選択されている場合は画像を移動
                if (this.selectedImage) {
                    this.cutImage(this.selectedImage);
                    this.setStatus('画像をクリップボードへ移動しました');
                } else if (this.selectedVirtualObject) {
                    // 仮身が選択されている場合は仮身を移動
                    this.cutVirtualObject(this.selectedVirtualObject);
                    this.setStatus('仮身をクリップボードへ移動しました');
                } else {
                    // テキストをクリップボードに移動（Clipboard API使用）
                    this.cutTextToClipboard();
                }
                break;
            case 'redo':
                // メニューからの呼び出し時はフォーカスがないためエディタにフォーカスを戻す
                this.editor.focus();
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
                    // テキストの場合: グローバルクリップボードから移動
                    this.pasteMoveFromGlobalClipboard();
                }
                break;
            case 'select-all':
                document.execCommand('selectAll');
                this.setStatus('すべて選択しました');
                break;
            case 'find-replace':
                this.findReplace();
                break;
            case 'virtualize':
                this.virtualizeSelection();
                break;

            // 書体
            case 'font-list':
                this.showFontList();
                break;
            case 'font-gothic':
                this.applyFont('"Noto Sans JP", sans-serif');
                break;
            case 'font-mincho':
                this.applyFont('"Noto Serif JP", serif');
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
            case 'style-indent':
                this.insertTextTab();
                this.setStatus('字下げを挿入しました');
                break;
            case 'style-clear':
                this.clearDecorationOnly();
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

            // 文字色（applyFontColorで確実にスタイルを適用）
            case 'color-black':
                logger.debug('[EDITOR] color-black action triggered');
                this.applyFontColor('#000000');
                this.setStatus('文字色: 黒');
                break;
            case 'color-blue':
                this.applyFontColor('#0000ff');
                this.setStatus('文字色: 青');
                break;
            case 'color-red':
                this.applyFontColor('#ee0000');
                this.setStatus('文字色: 赤');
                break;
            case 'color-pink':
                this.applyFontColor('#ff69b4');
                this.setStatus('文字色: ピンク');
                break;
            case 'color-orange':
                this.applyFontColor('#ff8c00');
                this.setStatus('文字色: 橙');
                break;
            case 'color-green':
                this.applyFontColor('#008000');
                this.setStatus('文字色: 緑');
                break;
            case 'color-lime':
                this.applyFontColor('#7fff00');
                this.setStatus('文字色: 黄緑');
                break;
            case 'color-cyan':
                this.applyFontColor('#00ffff');
                this.setStatus('文字色: 水色');
                break;
            case 'color-yellow':
                this.applyFontColor('#ffff00');
                this.setStatus('文字色: 黄色');
                break;
            case 'color-white':
                this.applyFontColor('#ffffff');
                this.setStatus('文字色: 白');
                break;
            case 'color-custom':
                this.customColor();
                break;

            // 書式
            case 'format-indent':
                this.applyIndent();
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

            // 用紙設定
            case 'toggle-paper-frame':
                this.togglePaperFrame();
                break;
            case 'page-setup':
                this.showPageSetup();
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

            case 'open-realobject-config':
                this.openRealObjectConfig();
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

            default:
                if (action.startsWith('size-')) {
                    const size = action.replace('size-', '');
                    const selection = window.getSelection();

                    if (selection.rangeCount > 0) {
                        const range = selection.getRangeAt(0);
                        const selectedText = range.toString();

                        // タブ文字を含むかチェック
                        if (selectedText.includes('\t')) {
                            // タブ文字を含む場合は特別処理（タブは14pt固定、それ以外は指定サイズ）
                            this.applyFontSizeWithTabHandling(range, size);
                        } else {
                            // タブ文字を含まない場合は通常処理
                            document.execCommand('fontSize', false, '7'); // ダミーサイズを設定
                            const fontElements = document.querySelectorAll('font[size="7"]');
                            fontElements.forEach(el => {
                                el.removeAttribute('size');
                                el.style.fontSize = size + 'pt';
                            });
                        }

                        this.updateParagraphLineHeight(); // 段落のline-heightを更新
                        this.setStatus(`文字サイズ: ${size}pt`);
                    }
                } else if (action.startsWith('font-recent-')) {
                    // 最近使用したフォントを適用
                    const index = parseInt(action.replace('font-recent-', ''));
                    if (index >= 0 && index < this.recentFonts.length) {
                        this.applyFont(this.recentFonts[index]);
                    }
                } else {
                    logger.debug('[EDITOR] 未実装のアクション:', action);
                    this.setStatus(`未実装: ${action}`);
                }
        }
    }

    /**
     * XML直接表示モード
     */
    async viewXMLMode() {
        // XMLモードでない場合（清書モードまたは初期状態）、エディタの内容をXMLに変換
        if (this.viewMode !== 'xml') {
            this.tadData = await this.convertEditorToXML();
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
        logger.debug('[EDITOR] viewFormattedMode開始, 現在のモード:', this.viewMode);
        
        // XMLモードの場合、エディタの内容をXMLに変換してtadDataを更新
        if (this.viewMode === 'xml') {
            // XMLモード時はエディタにXMLテキストが表示されているので、それをtadDataに保存
            const preElement = this.editor.querySelector('pre');
            if (preElement) {
                const rawText = preElement.textContent;
                logger.debug('[EDITOR] preElement.textContent取得, 長さ:', rawText.length);
                logger.debug('[EDITOR] 最初の200文字:', rawText.substring(0, 200));
                
                this.tadData = rawText;  // textContentは既にデコード済みなのでdecodeHtmlは不要
                
                logger.debug('[EDITOR] tadData更新完了, 長さ:', this.tadData.length);
                logger.debug('[EDITOR] tadDataプレビュー:', this.tadData.substring(0, 200));
            } else {
                logger.error('[EDITOR] pre要素が見つかりません');
            }
        } else {
            // 清書モードまたは初期状態の場合、エディタの内容をXMLに変換
            logger.debug('[EDITOR] 清書モードから変換');
            this.tadData = await this.convertEditorToXML();
        }

        if (this.tadData) {
            logger.debug('[EDITOR] renderTADXML呼び出し, tadData長さ:', this.tadData.length);
            await this.renderTADXML(this.tadData);
            this.viewMode = 'formatted';
            this.setStatus('清書モード');
        } else {
            logger.error('[EDITOR] tadDataが空です');
            this.editor.innerHTML = '<p>XMLデータがありません</p>';
        }
    }

    // toggleFullscreen()はPluginBaseで共通化（window-maximize-toggledでisFullscreenが同期される）

    /**
     * タブ文字を挿入
     */
    insertTextTab() {
        const selection = window.getSelection();
        if (selection.rangeCount === 0) return;

        const range = selection.getRangeAt(0);

        // カーソル位置の要素から現在のフォントサイズを取得
        let currentNode = range.startContainer;
        if (currentNode.nodeType === Node.TEXT_NODE) {
            currentNode = currentNode.parentNode;
        }
        const computedStyle = window.getComputedStyle(currentNode);
        const currentFontSize = parseFloat(computedStyle.fontSize);

        // 選択範囲を削除
        range.deleteContents();

        // タブ文字を14ptのフォントサイズで挿入
        const baseFontSize = 14 * 1.33; // 14pt = 約18.67px

        if (Math.abs(currentFontSize - baseFontSize) > 0.5) {
            // 現在のフォントサイズが14ptと異なる場合、タブだけ14ptに固定

            // 直前のノードが14ptのタブ専用spanかチェック
            let previousNode = range.startContainer;
            if (previousNode.nodeType === Node.TEXT_NODE) {
                previousNode = previousNode.previousSibling;
            } else if (previousNode.previousSibling) {
                previousNode = previousNode.previousSibling;
            }

            // 直前のノードが14ptのspanで、タブ文字のみを含む場合は、そこに追加
            if (previousNode &&
                previousNode.nodeType === Node.ELEMENT_NODE &&
                previousNode.nodeName === 'SPAN' &&
                previousNode.style.fontSize === '14pt' &&
                /^[\t]+$/.test(previousNode.textContent)) {

                // 既存のタブspanに追加
                previousNode.textContent += '\t';

                // カーソルをタブspanの後ろに移動
                range.setStartAfter(previousNode);
                range.setEndAfter(previousNode);
            } else {
                // 新しいタブspanを作成
                const tabSpan = document.createElement('span');
                tabSpan.style.fontSize = '14pt';
                tabSpan.textContent = '\t';

                range.insertNode(tabSpan);

                // カーソルをタブの後ろに移動
                range.setStartAfter(tabSpan);
                range.setEndAfter(tabSpan);
            }
        } else {
            // 現在のフォントサイズが14ptの場合、通常のタブ文字を挿入
            const tabText = document.createTextNode('\t');
            range.insertNode(tabText);

            // カーソルをタブの後ろに移動
            range.setStartAfter(tabText);
            range.setEndAfter(tabText);
        }

        selection.removeAllRanges();
        selection.addRange(range);

        // input イベントを手動で発火（変更フラグ設定とコンテンツ高さ更新のため）
        const inputEvent = new Event('input', {
            bubbles: true,
            cancelable: true
        });
        this.editor.dispatchEvent(inputEvent);

        logger.debug('[EDITOR] タブ挿入 (フォントサイズ: 14pt固定)');
    }

    /**
     * 字下げを適用（行頭移動指定付箋）
     * カーソル位置を基準に、段落全体にインデントを設定
     */
    applyIndent() {
        const selection = window.getSelection();
        if (selection.rangeCount === 0) return;

        const range = selection.getRangeAt(0);

        // カーソル位置のノードから段落要素を取得
        let paragraph = range.startContainer;
        while (paragraph && paragraph.nodeName !== 'P') {
            paragraph = paragraph.parentNode;
        }

        if (!paragraph || paragraph.nodeName !== 'P') {
            logger.warn('[EDITOR] 段落要素が見つかりません');
            return;
        }

        // 段落の先頭からカーソル位置までの実際のピクセル幅を測定
        const indentPx = this.measureIndentWidth(paragraph, range.startContainer, range.startOffset);

        if (indentPx === 0) {
            logger.debug('[EDITOR] カーソルが段落の先頭にあるため、字下げを適用しません');
            return;
        }

        // 段落にインデントスタイルを設定
        paragraph.style.paddingLeft = `${indentPx}px`;
        paragraph.style.textIndent = `-${indentPx}px`;

        // 変更フラグ
        this.isModified = true;

        logger.debug(`[EDITOR] 字下げ適用: ${indentPx}px`);
        this.setStatus(`字下げしました (${Math.round(indentPx)}px)`);
    }

    /**
     * 段落の先頭からカーソル位置までの実際のインデント幅を測定
     * DOMに実際に描画されている位置を使用し、フォントサイズを問わず正確に測定
     */
    measureIndentWidth(paragraph, targetNode, targetOffset) {
        // 段落の先頭からカーソル位置までのRangeを作成（空チェック用）
        const checkRange = document.createRange();
        checkRange.setStart(paragraph, 0);
        checkRange.setEnd(targetNode, targetOffset);

        // テキストを取得して空チェック
        const text = checkRange.toString();
        if (text.length === 0) {
            return 0;
        }

        // カーソル位置に一時的なマーカー要素を挿入
        const tempMarker = document.createElement('span');
        tempMarker.style.display = 'inline';
        tempMarker.style.width = '0';
        tempMarker.style.height = '0';

        // Rangeを折り畳んでカーソル位置に設定
        const insertRange = document.createRange();
        insertRange.setStart(targetNode, targetOffset);
        insertRange.setEnd(targetNode, targetOffset);
        insertRange.insertNode(tempMarker);

        // DOM上の実際の位置を取得
        const markerRect = tempMarker.getBoundingClientRect();
        const paragraphRect = paragraph.getBoundingClientRect();

        // インデント幅を計算（段落左端からマーカー位置まで）
        const indentPx = markerRect.left - paragraphRect.left;

        // マーカーを削除
        tempMarker.remove();

        return Math.max(0, indentPx);
    }

    /**
     * タブ1文字の幅を測定（エディタの基準フォントで）
     */
    measureTabWidth() {
        const measureElement = document.createElement('span');
        measureElement.style.fontFamily = window.getComputedStyle(this.editor).fontFamily;
        measureElement.style.fontSize = '14pt';
        measureElement.style.tabSize = '4';
        measureElement.style.MozTabSize = '4';
        measureElement.style.whiteSpace = 'pre';
        measureElement.style.position = 'absolute';
        measureElement.style.visibility = 'hidden';
        measureElement.textContent = '\t';

        this.editor.appendChild(measureElement);
        const width = measureElement.getBoundingClientRect().width;
        this.editor.removeChild(measureElement);

        return width;
    }

    /**
     * テキストの幅を測定（エディタの基準フォントで）
     */
    measureTextWidth(text) {
        const measureElement = document.createElement('span');
        measureElement.style.fontFamily = window.getComputedStyle(this.editor).fontFamily;
        measureElement.style.fontSize = '14pt';
        measureElement.style.whiteSpace = 'pre';
        measureElement.style.position = 'absolute';
        measureElement.style.visibility = 'hidden';
        measureElement.textContent = text;

        this.editor.appendChild(measureElement);
        const width = measureElement.getBoundingClientRect().width;
        this.editor.removeChild(measureElement);

        return width;
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
     * 背景色をUIに適用（PluginBaseのオーバーライド）
     * @param {string} color - 背景色
     */
    applyBackgroundColor(color) {
        this.bgColor = color;
        this.editor.style.backgroundColor = color;
        document.body.style.backgroundColor = color;

        // スクロールコンテナに背景色を適用（スクロール時の灰色表示を防ぐ）
        const pluginContent = document.querySelector('.plugin-content');
        if (pluginContent) {
            pluginContent.style.backgroundColor = color;
        }

        // editor-containerに背景色を適用
        const editorContainer = document.querySelector('.editor-container');
        if (editorContainer) {
            editorContainer.style.backgroundColor = color;
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

        // 段落要素のインラインスタイルも更新
        const paragraphs = this.editor.querySelectorAll('p');
        paragraphs.forEach(p => {
            p.style.whiteSpace = this.wrapMode ? 'pre-wrap' : 'pre';
        });

        // 折り返し設定を保存
        this.updateWindowConfig({ wordWrap: this.wrapMode });

        // 折り返しモード変更後に高さを更新
        setTimeout(() => this.updateContentHeight(), window.UI_UPDATE_DELAY_MS);
    }

    /**
     * 検索/置換ウィンドウを開く
     */
    async findReplace() {
        // 選択中のテキストがあれば初期検索文字列として使用
        const selection = window.getSelection();
        let initialSearchText = '';
        if (selection && selection.toString().trim()) {
            initialSearchText = selection.toString().trim();
        }

        // 検索/置換ウィンドウを開く
        this.messageBus.send('open-find-replace-window', {
            initialSearchText: initialSearchText,
            iconData: this.iconData || null
        });
    }

    /**
     * 選択範囲を仮身化（新しい実身として切り出し、仮身に置換）
     */
    async virtualizeSelection() {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0 || selection.toString().trim().length === 0) {
            this.setStatus('選択範囲がありません');
            return;
        }

        // 選択テキストの先頭10文字を取得（ダイアログ初期値用）
        const selectedText = selection.toString().trim();
        const defaultName = selectedText.substring(0, 10);

        // 選択範囲をXTAD形式に変換（画像情報も収集）
        const range = selection.getRangeAt(0);
        const extractResult = this.extractSelectionAsXtad(range);
        if (!extractResult || !extractResult.xtad) {
            this.setStatus('選択範囲の変換に失敗しました');
            return;
        }

        // 親ウィンドウに仮身化を要求
        const messageId = this.generateMessageId('virtualize');

        this.messageBus.send('virtualize-selection', {
            messageId: messageId,
            defaultName: defaultName,
            xtadContent: extractResult.xtad,
            imageFiles: extractResult.imageFiles,
            sourceRealId: this.realId
        });

        try {
            // レスポンスを待つ
            const result = await this.messageBus.waitFor('virtualize-selection-completed', window.LONG_OPERATION_TIMEOUT_MS, (data) => {
                return data.messageId === messageId;
            });

            if (result.cancelled) {
                this.setStatus('仮身化がキャンセルされました');
                return;
            }

            if (result.success) {
                // 選択範囲を削除
                range.deleteContents();

                // 新しい仮身を挿入
                const virtualObject = {
                    link_id: `${result.newRealId}_0.xtad`,
                    link_name: result.newName,
                    chsz: 14,
                    frcol: '#000000',
                    chcol: '#000000',
                    tbcol: '#ffffff',
                    bgcol: '#ffffff',
                    pictdisp: 'true',
                    namedisp: 'true',
                    framedisp: 'true'
                };

                // 仮身要素を作成
                const vobjElement = this.virtualObjectRenderer.createInlineElement(virtualObject, {
                    loadIconCallback: (realId) => this.iconManager ? this.iconManager.loadIcon(realId) : Promise.resolve(null)
                });

                // カーソル位置に挿入
                range.insertNode(vobjElement);

                // 仮身が<p>要素内に配置されていることを確認（段落外の場合は修正）
                this.ensureInsideParagraph(vobjElement);

                // 仮身のイベントハンドラをセットアップ
                this.setupVirtualObjectEventHandlers();

                // 変更を通知
                this.notifyXmlDataChanged();

                this.setStatus('仮身化しました: ' + result.newName);
            } else {
                this.setStatus('仮身化に失敗しました: ' + (result.error || '不明なエラー'));
            }
        } catch (error) {
            this.setStatus('仮身化に失敗しました');
        }
    }

    /**
     * 要素が<p>要素内に配置されていることを確認し、必要に応じて修正
     * 仮身挿入後にDOMが段落外に配置された場合に修正する
     * @param {HTMLElement} element - 確認対象の要素
     */
    ensureInsideParagraph(element) {
        // 要素の親を確認
        const parent = element.parentNode;

        // 親がエディタ自体の場合（<p>の外に配置されている）
        if (parent === this.editor) {
            // 新しい<p>要素を作成して仮身を包む
            const p = document.createElement('p');
            parent.insertBefore(p, element);
            p.appendChild(element);
        }
    }

    /**
     * 選択範囲をXTAD形式に変換（画像情報も収集）
     * @param {Range} range - 選択範囲
     * @returns {{ xtad: string, imageFiles: Array }} XTAD文字列と画像ファイル情報
     */
    extractSelectionAsXtad(range) {
        // TODO: Phase 2で実装
        const container = range.cloneContents();

        // 簡易実装: 選択範囲のHTMLからXTADを生成
        const tempDiv = document.createElement('div');
        tempDiv.appendChild(container);

        const xmlParts = [];
        const imageFiles = [];
        let imageIndex = 0;

        // フォント状態の初期値
        const fontState = {
            size: '14',
            color: '#000000',
            face: ''
        };

        // 選択範囲内の要素を走査してXTADに変換
        this.extractTADXMLFromSelectionNode(tempDiv, xmlParts, imageFiles, imageIndex, fontState);

        return {
            xtad: xmlParts.join(''),
            imageFiles: imageFiles
        };
    }

    /**
     * 選択範囲のノードからTAD XMLを抽出（画像情報も収集）
     */
    extractTADXMLFromSelectionNode(element, xmlParts, imageFiles, imageIndex, fontState) {
        const nodes = element.childNodes;

        nodes.forEach(node => {
            if (node.nodeType === Node.TEXT_NODE) {
                xmlParts.push(this.escapeXml(node.textContent));
            } else if (node.nodeName === 'BR') {
                xmlParts.push('<br/>\r\n');
            } else if (node.nodeName === 'IMG') {
                // 画像タグを処理
                const savedFileName = node.getAttribute('data-saved-filename') || '';
                if (savedFileName) {
                    // 画像ファイル情報を収集
                    imageFiles.push({
                        originalFilename: savedFileName,
                        newFilename: `__IMAGE_${imageFiles.length}__`, // プレースホルダー
                        imageIndex: imageFiles.length
                    });
                }

                // 画像サイズを取得
                let displayWidth = node.naturalWidth || 100;
                let displayHeight = node.naturalHeight || 100;
                if (node.style.width && node.style.width.endsWith('px')) {
                    displayWidth = parseInt(node.style.width);
                }
                if (node.style.height && node.style.height.endsWith('px')) {
                    displayHeight = parseInt(node.style.height);
                }

                xmlParts.push(`<image src="__IMAGE_${imageFiles.length - 1}__" width="${displayWidth}" height="${displayHeight}"/>`);
            } else if (node.classList && node.classList.contains('virtual-object')) {
                // 仮身要素を処理
                const linkId = node.dataset.linkId || '';
                const attrs = [];

                if (linkId) attrs.push(`id="${this.escapeXml(linkId)}"`);
                // name属性は出力しない（link_nameはJSONから取得する方式に統一）

                // その他の属性も保持
                const attrNames = ['tbcol', 'frcol', 'chcol', 'bgcol', 'chsz', 'framedisp', 'namedisp', 'pictdisp', 'roledisp', 'typedisp', 'updatedisp'];
                attrNames.forEach(attrName => {
                    const value = node.dataset[attrName];
                    if (value) attrs.push(`${attrName}="${this.escapeXml(value)}"`);
                });

                // 自己閉じタグ形式（link_nameはJSONから取得する方式に統一）
                xmlParts.push(`<link ${attrs.join(' ')}/>`);
            } else if (node.nodeName === 'P') {
                // 段落
                xmlParts.push('<p>\r\n');
                this.extractTADXMLFromSelectionNode(node, xmlParts, imageFiles, imageIndex, fontState);
                xmlParts.push('\r\n</p>\r\n');
            } else if (node.nodeName === 'B' || node.nodeName === 'STRONG') {
                xmlParts.push('<b>');
                this.extractTADXMLFromSelectionNode(node, xmlParts, imageFiles, imageIndex, fontState);
                xmlParts.push('</b>');
            } else if (node.nodeName === 'I' || node.nodeName === 'EM') {
                xmlParts.push('<i>');
                this.extractTADXMLFromSelectionNode(node, xmlParts, imageFiles, imageIndex, fontState);
                xmlParts.push('</i>');
            } else if (node.nodeName === 'U') {
                xmlParts.push('<u>');
                this.extractTADXMLFromSelectionNode(node, xmlParts, imageFiles, imageIndex, fontState);
                xmlParts.push('</u>');
            } else if (node.nodeName === 'SPAN' || node.nodeName === 'DIV') {
                // SPANやDIVは再帰的に処理
                this.extractTADXMLFromSelectionNode(node, xmlParts, imageFiles, imageIndex, fontState);
            } else {
                // その他の要素は再帰的に処理
                this.extractTADXMLFromSelectionNode(node, xmlParts, imageFiles, imageIndex, fontState);
            }
        });
    }

    /**
     * テキストを検索して選択状態にする
     * @param {string} searchText - 検索文字列
     * @param {boolean} isRegex - 正規表現モード
     */
    findTextInEditor(searchText, isRegex) {
        if (!searchText) return;

        // TreeWalkerでテキストノードからテキストを収集（innerTextとの不一致を回避）
        const textData = this.getTextNodesData();
        const text = textData.fullText;
        let startIndex = 0;

        // 現在の選択位置から検索を開始
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            // 選択範囲の終端位置を取得
            startIndex = this.getTextOffsetFromNode(textData.nodes, range.endContainer, range.endOffset);
        }

        let matchIndex = -1;
        let matchLength = searchText.length;

        try {
            if (isRegex) {
                const regex = new RegExp(searchText, 'g');
                let match;
                while ((match = regex.exec(text)) !== null) {
                    if (match.index >= startIndex) {
                        matchIndex = match.index;
                        matchLength = match[0].length;
                        break;
                    }
                }
                // 見つからなければ先頭から再検索
                if (matchIndex === -1) {
                    regex.lastIndex = 0;
                    match = regex.exec(text);
                    if (match) {
                        matchIndex = match.index;
                        matchLength = match[0].length;
                    }
                }
            } else {
                matchIndex = text.indexOf(searchText, startIndex);
                // 見つからなければ先頭から再検索
                if (matchIndex === -1) {
                    matchIndex = text.indexOf(searchText);
                }
            }
        } catch (e) {
            this.setStatus('正規表現エラー: ' + e.message);
            return;
        }

        if (matchIndex !== -1) {
            this.selectTextRangeFromNodes(textData.nodes, matchIndex, matchLength);
            this.setStatus(`"${searchText}" が見つかりました`);
        } else {
            this.setStatus(`"${searchText}" は見つかりませんでした`);
        }
    }

    /**
     * テキストノードのデータを取得
     * @returns {{nodes: Array, fullText: string}} ノード配列と結合テキスト
     */
    getTextNodesData() {
        const walker = document.createTreeWalker(
            this.editor,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );

        const nodes = [];
        let fullText = '';
        let node;

        while (node = walker.nextNode()) {
            nodes.push({
                node: node,
                start: fullText.length,
                length: node.textContent.length
            });
            fullText += node.textContent;
        }

        return { nodes, fullText };
    }

    /**
     * ノードとオフセットからテキスト全体での位置を取得
     * @param {Array} nodes - ノードデータ配列
     * @param {Node} targetNode - 対象ノード
     * @param {number} offset - ノード内オフセット
     * @returns {number} テキスト全体でのオフセット
     */
    getTextOffsetFromNode(nodes, targetNode, offset) {
        for (const nodeData of nodes) {
            if (nodeData.node === targetNode) {
                return nodeData.start + offset;
            }
        }
        // テキストノードでない場合は0を返す
        return 0;
    }

    /**
     * ノードデータを使用してテキスト範囲を選択
     * @param {Array} nodes - ノードデータ配列
     * @param {number} startOffset - 開始位置
     * @param {number} length - 選択文字数
     */
    selectTextRangeFromNodes(nodes, startOffset, length) {
        let startNode = null;
        let startNodeOffset = 0;
        let endNode = null;
        let endNodeOffset = 0;
        const endOffset = startOffset + length;

        for (const nodeData of nodes) {
            const nodeEnd = nodeData.start + nodeData.length;

            // 開始位置を探す
            if (!startNode && nodeEnd > startOffset) {
                startNode = nodeData.node;
                startNodeOffset = startOffset - nodeData.start;
            }

            // 終了位置を探す
            if (startNode && nodeEnd >= endOffset) {
                endNode = nodeData.node;
                endNodeOffset = endOffset - nodeData.start;
                break;
            }
        }

        if (startNode && endNode) {
            const range = document.createRange();
            range.setStart(startNode, startNodeOffset);
            range.setEnd(endNode, endNodeOffset);

            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);

            // エディタにフォーカスを戻して選択色を青にする
            this.editor.focus();

            // 選択範囲が見えるようにスクロール
            const rect = range.getBoundingClientRect();
            const editorRect = this.editor.getBoundingClientRect();
            if (rect.top < editorRect.top || rect.bottom > editorRect.bottom) {
                startNode.parentElement?.scrollIntoView({ block: 'center' });
            }
        }
    }

    /**
     * テキストを置換（現在選択中のテキストを置換して次を検索）
     * @param {string} searchText - 検索文字列
     * @param {string} replaceText - 置換文字列
     * @param {boolean} isRegex - 正規表現モード
     */
    replaceTextInEditor(searchText, replaceText, isRegex) {
        if (!searchText) return;

        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
            const selectedText = selection.toString();

            // 選択中のテキストが検索文字列と一致するか確認
            let matches = false;
            try {
                if (isRegex) {
                    const regex = new RegExp('^' + searchText + '$');
                    matches = regex.test(selectedText);
                } else {
                    matches = (selectedText === searchText);
                }
            } catch (e) {
                this.setStatus('正規表現エラー: ' + e.message);
                return;
            }

            if (matches) {
                // 置換を実行
                const range = selection.getRangeAt(0);
                range.deleteContents();
                const textNode = document.createTextNode(replaceText);
                range.insertNode(textNode);

                // カーソルを置換後のテキストの後ろに移動
                range.setStartAfter(textNode);
                range.setEndAfter(textNode);
                selection.removeAllRanges();
                selection.addRange(range);

                this.isModified = true;
                this.setStatus(`置換しました`);
            }
        }

        // 次を検索
        this.findTextInEditor(searchText, isRegex);
    }

    /**
     * すべて置換
     * @param {string} searchText - 検索文字列
     * @param {string} replaceText - 置換文字列
     * @param {boolean} isRegex - 正規表現モード
     */
    replaceAllTextInEditor(searchText, replaceText, isRegex) {
        if (!searchText) return;

        const text = this.editor.innerText;
        let count = 0;

        try {
            if (isRegex) {
                const regex = new RegExp(searchText, 'g');
                const matches = text.match(regex);
                count = matches ? matches.length : 0;
            } else {
                let pos = 0;
                while ((pos = text.indexOf(searchText, pos)) !== -1) {
                    count++;
                    pos += searchText.length;
                }
            }
        } catch (e) {
            this.setStatus('正規表現エラー: ' + e.message);
            return;
        }

        if (count === 0) {
            this.setStatus(`"${searchText}" は見つかりませんでした`);
            return;
        }

        // TreeWalkerでテキストノードを走査して置換
        const walker = document.createTreeWalker(
            this.editor,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );

        const nodesToProcess = [];
        let node;
        while (node = walker.nextNode()) {
            nodesToProcess.push(node);
        }

        let totalReplaced = 0;
        try {
            const regex = isRegex ? new RegExp(searchText, 'g') : null;

            nodesToProcess.forEach(textNode => {
                const originalText = textNode.textContent;
                let newText;

                if (isRegex) {
                    newText = originalText.replace(regex, replaceText);
                } else {
                    newText = originalText.split(searchText).join(replaceText);
                }

                if (originalText !== newText) {
                    textNode.textContent = newText;
                }
            });

            totalReplaced = count;
        } catch (e) {
            this.setStatus('正規表現エラー: ' + e.message);
            return;
        }

        this.isModified = true;
        this.setStatus(`${totalReplaced}件置換しました`);
    }

    /**
     * テキスト範囲を選択状態にする
     * @param {number} startOffset - 開始位置（文字インデックス）
     * @param {number} length - 選択文字数
     */
    selectTextRange(startOffset, length) {
        const walker = document.createTreeWalker(
            this.editor,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );

        let currentOffset = 0;
        let startNode = null;
        let startNodeOffset = 0;
        let endNode = null;
        let endNodeOffset = 0;
        let node;

        while (node = walker.nextNode()) {
            const nodeLength = node.textContent.length;

            // 開始位置を探す
            if (!startNode && currentOffset + nodeLength > startOffset) {
                startNode = node;
                startNodeOffset = startOffset - currentOffset;
            }

            // 終了位置を探す
            if (startNode && currentOffset + nodeLength >= startOffset + length) {
                endNode = node;
                endNodeOffset = startOffset + length - currentOffset;
                break;
            }

            currentOffset += nodeLength;
        }

        if (startNode && endNode) {
            const range = document.createRange();
            range.setStart(startNode, startNodeOffset);
            range.setEnd(endNode, endNodeOffset);

            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);

            // 選択範囲が見えるようにスクロール
            const rect = range.getBoundingClientRect();
            const editorRect = this.editor.getBoundingClientRect();
            if (rect.top < editorRect.top || rect.bottom > editorRect.bottom) {
                startNode.parentElement?.scrollIntoView({ block: 'center' });
            }
        }
    }

    /**
     * 書体サブメニューを取得
     */
    getFontSubmenu() {
        const submenu = [
            { label: '書体一覧', action: 'font-list' },
            { separator: true },
            { label: 'ゴシック', action: 'font-gothic' },
            { label: '明朝', action: 'font-mincho' },
            { label: 'メイリオ', action: 'font-meiryo' }
        ];

        // 最近使用したフォントを追加
        if (this.recentFonts.length > 0) {
            submenu.push({ separator: true });

            this.recentFonts.forEach((font, index) => {
                // フォント名から引用符を削除して表示
                const displayName = font.replace(/"/g, '');
                submenu.push({
                    label: displayName,
                    action: `font-recent-${index}`
                });
            });
        }

        return submenu;
    }

    /**
     * 英語フォント名から日本語名へのマッピング
     */

    /**
     * フォント名に日本語が含まれているかチェック
     */
    hasJapanese(str) {
        // ひらがな、カタカナ、漢字を含むかチェック
        return /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(str);
    }

    /**
     * フォント一覧をソート（日本語フォントを先に表示）
     */
    sortFonts(fonts) {
        // 日本語を含むフォントと含まないフォントに分類
        const japaneseFonts = [];
        const otherFonts = [];

        fonts.forEach(font => {
            if (this.hasJapanese(font)) {
                japaneseFonts.push(font);
            } else {
                otherFonts.push(font);
            }
        });

        // それぞれをソート
        japaneseFonts.sort((a, b) => a.localeCompare(b, 'ja'));
        otherFonts.sort((a, b) => a.localeCompare(b, 'en'));

        // 日本語フォントを先に、その後英語フォント
        return [...japaneseFonts, ...otherFonts];
    }

    /**
     * フォントオブジェクト配列をソート（日本語フォントを先に表示）
     */
    sortFontObjects(fontObjects) {
        // 日本語を含むフォントと含まないフォントに分類
        const japaneseFonts = [];
        const otherFonts = [];

        fontObjects.forEach(fontObj => {
            if (this.hasJapanese(fontObj.displayName)) {
                japaneseFonts.push(fontObj);
            } else {
                otherFonts.push(fontObj);
            }
        });

        // それぞれをソート
        japaneseFonts.sort((a, b) => a.displayName.localeCompare(b.displayName, 'ja'));
        otherFonts.sort((a, b) => a.displayName.localeCompare(b.displayName, 'en'));

        // 日本語フォントを先に、その後英語フォント
        return [...japaneseFonts, ...otherFonts];
    }

    /**
     * システムフォント一覧を取得
     */
    async getSystemFonts() {
        // 一時的にキャッシュを無効化してテスト
        // if (this.systemFonts.length > 0) {
        //     logger.debug('[EDITOR] キャッシュからフォント一覧を返す:', this.systemFonts.length);
        //     return this.systemFonts;
        // }

        let fonts = [];

        try {
            // Electron環境かどうかチェック
            const isElectron = window.parent && window.parent !== window &&
                             typeof window.parent.postMessage === 'function';

            // Electron環境では常に親ウィンドウ（レジストリベース）から取得
            // Font Access API (queryLocalFonts) が使える場合でもブラウザのみ
            if ('queryLocalFonts' in window && !isElectron) {
                logger.debug('[EDITOR] Font Access APIを使用してフォント一覧を取得');
                const fontData = await window.queryLocalFonts();

                // フォント名を抽出（重複を除く）
                const fontNames = new Set();
                fontData.forEach(font => {
                    // family プロパティがある場合
                    if (font.family) {
                        fontNames.add(font.family);
                    }
                    // fullName プロパティがある場合
                    if (font.fullName && !fontNames.has(font.fullName)) {
                        fontNames.add(font.fullName);
                    }
                });

                // システム名と表示名のオブジェクト配列を作成
                const fontObjects = Array.from(fontNames).map(systemName => ({
                    systemName: systemName,
                    displayName: systemName,
                    allNames: [systemName]
                }));

                // 表示名でソート
                fonts = this.sortFontObjects(fontObjects);
                logger.debug('[EDITOR] Font Access APIで取得したフォント数:', fonts.length);
            } else {
                logger.debug('[EDITOR] 親ウィンドウに要求します（Electron環境またはFont Access API不可）');

                // 親ウィンドウにフォント一覧を要求（APIから日本語名付きで取得）
                const systemFonts = await this.requestSystemFontsFromParent();

                // 親ウィンドウから取得できなかった場合はフォールバック
                if (systemFonts.length === 0) {
                    logger.debug('[EDITOR] 親ウィンドウからフォント取得失敗、フォールバックを使用');
                    const fallbackFonts = await this.detectFontsFromCommonList();
                    // フォールバックも文字列配列なのでオブジェクト配列に変換
                    fonts = fallbackFonts.map(systemName => ({
                        systemName: systemName,
                        displayName: systemName,
                        allNames: [systemName]
                    }));
                    fonts = this.sortFontObjects(fonts);
                } else {
                    // 親ウィンドウから返されたフォントは既に{systemName, displayName}形式
                    // 配列の各要素をチェックして、オブジェクトか文字列か判定
                    if (typeof systemFonts[0] === 'string') {
                        // 古い形式（文字列配列）の場合は変換
                        fonts = systemFonts.map(systemName => ({
                            systemName: systemName,
                            displayName: systemName,
                            allNames: [systemName]
                        }));
                    } else {
                        // 新しい形式（オブジェクト配列）はそのまま使用
                        fonts = systemFonts;

                        // allNamesがない古い形式の場合、displayNameをallNamesに変換
                        fonts = fonts.map(font => {
                            if (!font.allNames || font.allNames.length === 0) {
                                return {
                                    ...font,
                                    allNames: [font.displayName, font.systemName].filter((v, i, a) => v && a.indexOf(v) === i)
                                };
                            }
                            return font;
                        });

                    }
                    fonts = this.sortFontObjects(fonts);
                    logger.debug('[EDITOR] 親ウィンドウから取得したフォント数:', fonts.length);
                }
            }
        } catch (error) {
            logger.error('[EDITOR] フォント取得エラー:', error);

            // フォールバック: 一般的なフォントリストをテスト
            logger.debug('[EDITOR] フォールバック: 一般的なフォントリストを使用');
            const fallbackFonts = await this.detectFontsFromCommonList();
            const fontObjects = fallbackFonts.map(systemName => ({
                systemName: systemName,
                displayName: systemName,
                allNames: [systemName]
            }));
            fonts = this.sortFontObjects(fontObjects);
        }

        this.systemFonts = fonts;
        logger.debug('[EDITOR] 最終的に検出されたフォント数:', fonts.length);
        return fonts;
    }

    /**
     * 親ウィンドウからシステムフォント一覧を要求
     */
    async requestSystemFontsFromParent() {
        const messageId = this.generateMessageId('get-fonts');
        logger.debug('[EDITOR] 親ウィンドウにフォント要求を送信開始 messageId:', messageId);

        // 親ウィンドウに要求
        if (!window.parent || window.parent === window) {
            logger.warn('[EDITOR] 親ウィンドウが存在しない');
            return [];
        }

        logger.debug('[EDITOR] 親ウィンドウにpostMessage送信: type=get-system-fonts');
        this.messageBus.send('get-system-fonts', {
            messageId: messageId
        });
        logger.debug('[EDITOR] postMessage送信完了');

        try {
            // レスポンスを待つ（5秒タイムアウト）
            const result = await this.messageBus.waitFor('system-fonts-response', window.DEFAULT_TIMEOUT_MS, (data) => {
                return data.messageId === messageId;
            });
            logger.debug('[EDITOR] 親ウィンドウからフォント一覧を受信:', result.fonts.length, '件');
            return result.fonts || [];
        } catch (error) {
            logger.warn('[EDITOR] フォント一覧取得タイムアウト（5秒経過）、フォールバックを使用');
            return [];
        }
    }

    /**
     * 一般的なフォントリストから検出
     */
    async detectFontsFromCommonList() {
        const testFonts = [
            'Noto Sans JP', 'Noto Serif JP', 'Meiryo', 'メイリオ',
            'MS Gothic', 'MS Mincho', 'MS PGothic', 'MS PMincho',
            'MS UI Gothic', 'MS 明朝', 'MS ゴシック',
            'Yu Gothic', 'Yu Mincho', '游ゴシック', '游明朝',
            'Yu Gothic UI', 'Yu Gothic Medium', 'Yu Gothic Light',
            'Arial', 'Times New Roman', 'Verdana', 'Georgia',
            'Courier New', 'Comic Sans MS', 'Impact', 'Trebuchet MS',
            'Segoe UI', 'Tahoma', 'Consolas', 'Calibri',
            'BIZ UDゴシック', 'BIZ UD明朝', 'BIZ UDPゴシック', 'BIZ UDP明朝',
            'UD デジタル 教科書体', 'UD デジタル 教科書体 N-B', 'UD デジタル 教科書体 N-R',
            'HGSゴシックE', 'HGS明朝E', 'HGSゴシックM', 'HGS明朝B',
            'HGP創英角ゴシックUB', 'HGP創英角ポップ体', 'HGP創英プレゼンスEB',
            'HG正楷書体-PRO', 'HG行書体', 'HGP行書体', 'HGS行書体',
            'HG丸ゴシックM-PRO', 'HGP丸ゴシックM-PRO', 'HGS丸ゴシックM-PRO',
            'HG創英角ゴシックUB', 'HG創英角ポップ体', 'HG創英プレゼンスEB',
            'HGP教科書体', 'HGS教科書体', 'HG教科書体',
            'メイリオ', 'Meiryo UI',
            'Cambria', 'Cambria Math', 'Candara', 'Century Gothic',
            'Franklin Gothic Medium', 'Garamond', 'Palatino Linotype',
            'Century', 'Book Antiqua', 'Bookman Old Style'
        ];

        const availableFonts = [];
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');

        // デフォルトフォントでの描画
        const testText = 'abcdefghijklmnopqrstuvwxyz0123456789あいうえお漢字';
        context.font = '72px monospace';
        const baselineWidth = context.measureText(testText).width;

        // 各フォントをテスト
        for (const font of testFonts) {
            context.font = `72px "${font}", monospace`;
            const width = context.measureText(testText).width;

            // 幅が異なればフォントが利用可能
            if (width !== baselineWidth) {
                availableFonts.push(font);
            }
        }

        return this.sortFonts(availableFonts);
    }

    /**
     * 書体一覧表示
     */
    async showFontList() {
        // システムフォント一覧を取得（完全に取得完了するまで待機）
        logger.debug('[EDITOR] システムフォント取得開始');
        const fonts = await this.getSystemFonts();
        logger.debug('[EDITOR] システムフォント取得完了:', fonts.length, 'フォント');

        if (fonts.length === 0) {
            alert('利用可能なフォントが見つかりませんでした。');
            return;
        }

        // フォント選択用のリストHTMLを作成（標準クラス使用）
        const fontListHtml = fonts.map((fontObj, index) => {
            // 表示名をエスケープ
            const escapedDisplayName = fontObj.displayName.replace(/'/g, "\\'").replace(/"/g, '&quot;');

            // プレビュー用のfont-family（allNamesの全ての名前を使用）
            let fontFamilyForPreview;
            if (fontObj.allNames && fontObj.allNames.length > 0) {
                // allNamesの各名前をエスケープしてカンマ区切りに
                fontFamilyForPreview = fontObj.allNames
                    .map(name => `'${name.replace(/'/g, "\\'")}'`)
                    .join(',');
            } else {
                fontFamilyForPreview = `'${fontObj.systemName.replace(/'/g, "\\'")}'`;
            }
            fontFamilyForPreview += ',sans-serif'; // フォールバック

            return `<div class="dialog-listbox-item" data-index="${index}" style="font-family:${fontFamilyForPreview}">${escapedDisplayName}</div>`;
        }).join('');

        const dialogHtml = `
            <style>
                .dialog-listbox-item:last-child {
                    border-bottom: none;
                }
            </style>
            <div class="dialog-listbox">
                ${fontListHtml}
            </div>
            <script>
                // イベント委譲でクリック処理
                document.querySelector('.dialog-listbox').addEventListener('click', function(e) {
                    const item = e.target.closest('.dialog-listbox-item');
                    if (item) {
                        // 他の選択を解除
                        this.querySelectorAll('.dialog-listbox-item').forEach(el => {
                            el.classList.remove('selected');
                        });
                        // この要素を選択
                        item.classList.add('selected');
                    }
                });
            </script>
        `;

        logger.debug('[EDITOR] 書体一覧ダイアログ要求:', fonts.length, 'フォント');

        const result = await this.showCustomDialog({
            title: '書体一覧',
            dialogHtml: dialogHtml,
            buttons: [
                { label: 'キャンセル', value: 'cancel' },
                { label: 'OK', value: 'ok' }
            ],
            defaultButton: 1
        });

        logger.debug('[EDITOR] ダイアログ応答:', result);

        if (result && result.button === 'ok') {
            logger.debug('[EDITOR] OKボタンが押されました');

            // 選択されたフォントのインデックスを取得（selectedItemIndexを使用）
            const fontIndex = result.selectedItemIndex;
            if (fontIndex !== null && fontIndex !== undefined && fontIndex >= 0 && fontIndex < fonts.length) {
                const selectedFontObj = fonts[fontIndex];
                logger.debug('[EDITOR] フォント選択:', selectedFontObj.displayName);
                logger.debug('[EDITOR] 利用可能な全ての名前:', selectedFontObj.allNames);

                // allNamesがあれば全ての名前を使用、なければdisplayNameのみ
                let fontFamilyCSS;
                if (selectedFontObj.allNames && selectedFontObj.allNames.length > 0) {
                    // 各名前をクォートで囲んでカンマ区切りに
                    fontFamilyCSS = selectedFontObj.allNames
                        .map(name => `"${name}"`)
                        .join(', ');
                } else {
                    fontFamilyCSS = `"${selectedFontObj.displayName}"`;
                }

                logger.debug('[EDITOR] CSS font-family:', fontFamilyCSS);
                this.applyFont(fontFamilyCSS);
            } else {
                logger.debug('[EDITOR] フォントが選択されていません');
            }
        } else {
            logger.debug('[EDITOR] OKボタンが押されませんでした。button:', result?.button);
        }

        return result;
    }

    /**
     * フォント適用
     */
    applyFont(fontFamily) {
        logger.debug('[EDITOR] applyFont呼び出し:', fontFamily);

        // フォントの可用性をチェック
        this.checkFontAvailability(fontFamily);

        const selection = window.getSelection();

        // 選択範囲がある場合
        if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
            logger.debug('[EDITOR] 選択範囲にフォント適用');
            document.execCommand('fontName', false, fontFamily);

            // 適用後の確認
            const container = selection.getRangeAt(0).commonAncestorContainer;
            const element = container.nodeType === 3 ? container.parentElement : container;
            logger.debug('[EDITOR] 適用後のfont-family:', window.getComputedStyle(element).fontFamily);
        } else {
            // 選択範囲がない場合、エディタ全体に適用
            logger.debug('[EDITOR] エディタ全体にフォント適用');
            const paragraphs = this.editor.querySelectorAll('p');
            if (paragraphs.length > 0) {
                paragraphs.forEach(p => {
                    p.style.fontFamily = fontFamily;
                    logger.debug('[EDITOR] 段落にfont-family設定:', p.style.fontFamily, '→ computed:', window.getComputedStyle(p).fontFamily);
                });
            } else {
                this.editor.style.fontFamily = fontFamily;
                logger.debug('[EDITOR] エディタにfont-family設定:', this.editor.style.fontFamily);
            }
        }

        // 最近使用したフォントに追加
        this.addRecentFont(fontFamily);

        this.setStatus(`書体を変更しました: ${fontFamily}`);
        this.isModified = true;
    }

    /**
     * フォントの可用性をチェック
     */
    checkFontAvailability(fontFamily) {
        // 引用符を削除してチェック
        const cleanFontName = fontFamily.replace(/["']/g, '');

        // document.fonts APIが利用可能な場合
        if (document.fonts && document.fonts.check) {
            const isAvailable = document.fonts.check(`12px ${fontFamily}`);
            logger.debug(`[EDITOR] フォント可用性チェック: ${cleanFontName} →`, isAvailable);

            if (!isAvailable) {
                logger.warn(`[EDITOR] フォント "${cleanFontName}" はシステムで利用できない可能性があります`);
            }
        } else {
            logger.debug('[EDITOR] document.fonts APIが利用できません');
        }

        // Canvas APIを使った代替チェック
        this.checkFontAvailabilityByCanvas(cleanFontName);
    }

    /**
     * Canvas APIを使ってフォントが利用可能かチェック
     */
    checkFontAvailabilityByCanvas(fontName) {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');

        // ベースラインフォントでテキストの幅を測定
        context.font = '72px monospace';
        const baselineWidth = context.measureText('abcdefghijklmnopqrstuvwxyz').width;

        // 指定フォントでテキストの幅を測定
        context.font = `72px "${fontName}", monospace`;
        const testWidth = context.measureText('abcdefghijklmnopqrstuvwxyz').width;

        const isAvailable = baselineWidth !== testWidth;
        logger.debug(`[EDITOR] Canvas APIチェック: ${fontName} →`, isAvailable, `(baseline: ${baselineWidth}, test: ${testWidth})`);

        return isAvailable;
    }

    /**
     * 最近使用したフォントに追加
     */
    addRecentFont(fontFamily) {
        // 既に存在する場合は削除
        const index = this.recentFonts.indexOf(fontFamily);
        if (index !== -1) {
            this.recentFonts.splice(index, 1);
        }

        // 先頭に追加
        this.recentFonts.unshift(fontFamily);

        // 最大10個まで
        if (this.recentFonts.length > 10) {
            this.recentFonts = this.recentFonts.slice(0, 10);
        }
    }

    /**
     * 書式クリア（標準）
     * 選択範囲およびその親要素から文字修飾タグを削除
     * 文字色・文字サイズは保持する
     */
    clearFormatting() {
        const selection = window.getSelection();
        if (!selection.rangeCount) {
            this.setStatus('テキストを選択してください');
            return;
        }

        const range = selection.getRangeAt(0);
        const selectedText = range.toString();

        if (!selectedText) {
            this.setStatus('テキストを選択してください');
            return;
        }

        // 文字修飾タグのリスト（カスタム要素と標準HTML）
        const decorationTags = [
            'UNDERLINE', 'OVERLINE', 'STRIKETHROUGH',
            'MESH', 'INVERT', 'NOPRINT', 'BAGCHAR', 'BOX',
            'U', 'S', 'B', 'I', 'SUB', 'SUP'
        ];

        // 選択範囲の共通祖先を取得
        const container = range.commonAncestorContainer;
        let current = container.nodeType === Node.TEXT_NODE ? container.parentNode : container;

        // 祖先要素から文字修飾タグを検出
        const tagsToRemove = [];
        while (current && current !== this.editor && current.nodeType === Node.ELEMENT_NODE) {
            const nodeName = current.nodeName.toUpperCase();
            if (decorationTags.includes(nodeName)) {
                tagsToRemove.push(current);
            }
            // SPANでスタイル付きのものもチェック
            if (nodeName === 'SPAN') {
                const style = current.getAttribute('style') || '';
                if (style.includes('text-decoration') ||
                    style.includes('-webkit-text-stroke') ||
                    style.includes('background-color: currentColor') ||
                    style.includes('repeating-linear-gradient') ||
                    current.hasAttribute('data-noprint')) {
                    tagsToRemove.push(current);
                }
            }
            current = current.parentNode;
        }

        // タグを削除（内容は保持）
        tagsToRemove.forEach(tag => {
            const parent = tag.parentNode;
            if (parent) {
                while (tag.firstChild) {
                    parent.insertBefore(tag.firstChild, tag);
                }
                parent.removeChild(tag);
            }
        });

        this.setStatus('書式を解除しました');
    }

    /**
     * 文字修飾のみ解除（解除）
     * 文字サイズ・文字色は保持したまま、文字修飾のみを削除
     */
    clearDecorationOnly() {
        const selection = window.getSelection();
        if (!selection.rangeCount) {
            this.setStatus('テキストを選択してください');
            return;
        }

        const range = selection.getRangeAt(0);
        const selectedText = range.toString();

        if (!selectedText) {
            this.setStatus('テキストを選択してください');
            return;
        }

        // 文字修飾タグのリスト（fontタグは除外 - サイズ・色を保持）
        const decorationTags = [
            'UNDERLINE', 'OVERLINE', 'STRIKETHROUGH',
            'MESH', 'INVERT', 'NOPRINT', 'BAGCHAR', 'BOX',
            'U', 'S', 'B', 'I', 'SUB', 'SUP'
        ];

        // 選択範囲の共通祖先を取得
        const container = range.commonAncestorContainer;
        let current = container.nodeType === Node.TEXT_NODE ? container.parentNode : container;

        // 祖先要素から文字修飾タグを検出
        const tagsToRemove = [];
        while (current && current !== this.editor && current.nodeType === Node.ELEMENT_NODE) {
            const nodeName = current.nodeName.toUpperCase();
            if (decorationTags.includes(nodeName)) {
                tagsToRemove.push(current);
            }
            // SPANでスタイル付きのものもチェック（text-decorationのみ、font関連は除外）
            if (nodeName === 'SPAN') {
                const style = current.getAttribute('style') || '';
                if (style.includes('text-decoration') ||
                    style.includes('-webkit-text-stroke') ||
                    style.includes('background-color: currentColor') ||
                    style.includes('repeating-linear-gradient') ||
                    current.hasAttribute('data-noprint')) {
                    tagsToRemove.push(current);
                }
            }
            current = current.parentNode;
        }

        // タグを削除（内容は保持）
        tagsToRemove.forEach(tag => {
            const parent = tag.parentNode;
            if (parent) {
                while (tag.firstChild) {
                    parent.insertBefore(tag.firstChild, tag);
                }
                parent.removeChild(tag);
            }
        });

        this.setStatus('文字修飾を解除しました');
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
     * 選択範囲の文字色を取得
     * @returns {string|null} 文字色（rgb形式またはhex形式）、黒以外の場合のみ返す
     */
    getSelectionTextColor() {
        const selection = window.getSelection();
        if (!selection.rangeCount) return null;

        const range = selection.getRangeAt(0);
        let startNode = range.startContainer;
        if (startNode.nodeType === Node.TEXT_NODE) {
            startNode = startNode.parentNode;
        }

        const computedStyle = window.getComputedStyle(startNode);
        const color = computedStyle.color;

        // 黒色（rgb(0, 0, 0)）以外の場合のみ返す
        if (color && color !== 'rgb(0, 0, 0)') {
            return color;
        }
        return null;
    }

    /**
     * 下線
     * 文字色と同じ色で下線を適用
     */
    applyUnderline() {
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const textColor = this.getSelectionTextColor();

            const underline = document.createElement('underline');
            // 文字色と同じ色で下線を設定
            if (textColor) {
                underline.style.textDecorationColor = textColor;
            }

            range.surroundContents(underline);
            this.setStatus('下線を適用しました');
        }
    }

    /**
     * 上線
     * 文字色と同じ色で上線を適用
     */
    applyOverline() {
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const textColor = this.getSelectionTextColor();

            const overline = document.createElement('overline');
            // 文字色と同じ色で上線を設定
            if (textColor) {
                overline.style.textDecorationColor = textColor;
            }

            range.surroundContents(overline);
            this.setStatus('上線を適用しました');
        }
    }

    /**
     * 取り消し線
     * 文字色と同じ色で取り消し線を適用
     */
    applyStrikethrough() {
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const textColor = this.getSelectionTextColor();

            const strikethrough = document.createElement('strikethrough');
            // 文字色と同じ色で取り消し線を設定
            if (textColor) {
                strikethrough.style.textDecorationColor = textColor;
            }

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
            const selection = window.getSelection();
            if (selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                const selectedText = range.toString();

                // 選択範囲にタブ文字が含まれているかチェック
                if (selectedText.includes('\t')) {
                    // タブ文字を含む場合は、特別処理
                    this.applyFontSizeWithTabHandling(range, size);
                } else {
                    // タブ文字を含まない場合は通常処理
                    document.execCommand('fontSize', false, '7');
                    const fontElements = document.querySelectorAll('font[size="7"]');
                    fontElements.forEach(el => {
                        el.removeAttribute('size');
                        el.style.fontSize = size + 'pt';
                    });
                }

                this.updateParagraphLineHeight(); // 段落のline-heightを更新
                this.setStatus(`文字サイズ: ${size}pt`);
            }
        }
    }

    /**
     * タブ文字を含む選択範囲にフォントサイズを適用
     * タブは14ptに固定、それ以外は指定サイズに変更
     */
    applyFontSizeWithTabHandling(range, size) {
        // 選択範囲の内容を取得
        const fragment = range.cloneContents();

        // 新しいコンテナを作成
        const container = document.createElement('div');
        container.appendChild(fragment);

        // タブ文字を処理
        this.processFontSizeInNode(container, size);

        // 選択範囲を削除
        range.deleteContents();

        // DocumentFragmentを使って正しい順序で挿入
        const newFragment = document.createDocumentFragment();
        while (container.firstChild) {
            newFragment.appendChild(container.firstChild);
        }

        range.insertNode(newFragment);
    }

    /**
     * ノード内のテキストにフォントサイズを適用（タブは14pt固定）
     */
    processFontSizeInNode(node, size) {
        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent;
            if (text.includes('\t')) {
                // タブを含む場合は分割処理
                const parts = text.split(/(\t)/); // タブをキャプチャグループで分割
                const parent = node.parentNode;

                // 新しいノードを配列に格納
                const newNodes = [];
                parts.forEach(part => {
                    if (part === '\t') {
                        // タブは14ptのspanで囲む
                        const tabSpan = document.createElement('span');
                        tabSpan.style.fontSize = '14pt';
                        tabSpan.textContent = '\t';
                        newNodes.push(tabSpan);
                    } else if (part.length > 0) {
                        // 通常のテキストは指定サイズのspanで囲む
                        const textSpan = document.createElement('span');
                        textSpan.style.fontSize = size + 'pt';
                        textSpan.textContent = part;
                        newNodes.push(textSpan);
                    }
                });

                // 元のノードの位置に新しいノードを挿入
                const nextSibling = node.nextSibling;
                newNodes.forEach(newNode => {
                    parent.insertBefore(newNode, nextSibling);
                });

                // 元のテキストノードを削除
                parent.removeChild(node);
            } else {
                // タブを含まない場合は、親要素にフォントサイズを適用
                if (node.parentNode && node.parentNode.nodeType === Node.ELEMENT_NODE) {
                    const span = document.createElement('span');
                    span.style.fontSize = size + 'pt';
                    span.textContent = text;
                    node.parentNode.replaceChild(span, node);
                }
            }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            // 要素ノードの場合は子ノードを再帰的に処理
            // 既存のspan要素で14ptのタブを含む場合は保持
            if (node.nodeName === 'SPAN' &&
                node.textContent === '\t') {
                // フォントサイズを14ptと比較（px単位の場合も考慮）
                let is14pt = false;
                if (node.style.fontSize) {
                    if (node.style.fontSize === '14pt') {
                        is14pt = true;
                    } else if (node.style.fontSize.endsWith('px')) {
                        const px = parseFloat(node.style.fontSize);
                        is14pt = Math.abs(px - 18.6667) < 0.5;
                    }
                }

                if (is14pt) {
                    // 14ptのタブspanはそのまま保持
                    return;
                } else {
                    // 14pt以外のタブspanは14ptに変更
                    node.style.fontSize = '14pt';
                    return;
                }
            }

            // 既存のspan要素（タブ以外）はフォントサイズを変更
            if (node.nodeName === 'SPAN' && node.style.fontSize) {
                node.style.fontSize = size + 'pt';
                // 子ノードは処理しない（すでにspanで囲まれているため）
                return;
            }

            // 子ノードを配列にコピー（処理中にchildNodesが変化するため）
            const children = Array.from(node.childNodes);
            children.forEach(child => {
                this.processFontSizeInNode(child, size);
            });

            // 自身の要素にはフォントサイズを適用しない（子要素に適用済み）
        }
    }

    /**
     * 現在の段落のline-heightと段落レベルのfont-sizeを最大フォントサイズに基づいて更新
     * 複数行にまたがってフォントサイズを変更した場合、段落レベルのfont-sizeも更新する
     */
    updateParagraphLineHeight() {
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);

            // 選択範囲内のすべての段落要素を取得
            const paragraphs = new Set();

            // 開始位置の段落を取得
            let startParagraph = range.startContainer;
            while (startParagraph && startParagraph.nodeName !== 'P' && startParagraph !== this.editor) {
                startParagraph = startParagraph.parentElement;
            }
            if (startParagraph && startParagraph.nodeName === 'P') {
                paragraphs.add(startParagraph);
            }

            // 終了位置の段落を取得
            let endParagraph = range.endContainer;
            while (endParagraph && endParagraph.nodeName !== 'P' && endParagraph !== this.editor) {
                endParagraph = endParagraph.parentElement;
            }
            if (endParagraph && endParagraph.nodeName === 'P') {
                paragraphs.add(endParagraph);
            }

            // 選択範囲内の段落をすべて取得
            const allParagraphs = Array.from(this.editor.querySelectorAll('p'));
            const startIndex = allParagraphs.indexOf(startParagraph);
            const endIndex = allParagraphs.indexOf(endParagraph);
            if (startIndex !== -1 && endIndex !== -1) {
                for (let i = startIndex; i <= endIndex; i++) {
                    paragraphs.add(allParagraphs[i]);
                }
            }

            // 各段落について更新
            paragraphs.forEach(paragraph => {
                if (paragraph && paragraph.nodeName === 'P') {
                    // 段落内のすべてのフォントサイズを取得
                    let maxFontSize = 14; // デフォルト

                    // 段落内のすべてのfont要素とspan要素を確認（属性セレクタではなく直接プロパティをチェック）
                    const allElements = paragraph.querySelectorAll('font, span');
                    allElements.forEach(el => {
                        if (el.style.fontSize) {
                            const size = parseFloat(el.style.fontSize);
                            if (!isNaN(size) && size > maxFontSize) {
                                maxFontSize = size;
                            }
                        }
                    });

                    // line-heightを設定
                    const lineHeight = maxFontSize * 1.5;
                    paragraph.style.lineHeight = `${lineHeight}px`;

                    // 段落レベルのfont-sizeを更新（XML保存時にextractFontSize()が正しい値を返すように）
                    paragraph.style.fontSize = `${maxFontSize}pt`;
                }
            });
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

    // ========================================
    // 改段落時スタイル引き継ぎ
    // ========================================

    /**
     * カーソル位置の文字スタイルを取得
     * ネストされたfont要素も考慮して、祖先を辿ってスタイルをマージ
     * @param {Element} element - 基準要素
     * @returns {Object} スタイル情報
     */
    getCaretStyle(element) {
        const computedStyle = window.getComputedStyle(element);
        const result = {
            fontSize: computedStyle.fontSize,
            color: computedStyle.color,
            fontWeight: computedStyle.fontWeight,
            fontStyle: computedStyle.fontStyle,
            textDecoration: computedStyle.textDecoration,
            fontFamily: computedStyle.fontFamily
        };

        // font要素のネストに対応: 祖先のfont要素からsize/color属性を取得
        let current = element;
        while (current && current !== this.editor) {
            if (current.tagName === 'FONT') {
                // font要素のsize属性（最も内側を優先するため、未設定の場合のみ取得）
                const fontSizeAttr = current.getAttribute('size');
                if (fontSizeAttr && !result.fontSizeFromAttr) {
                    result.fontSizeFromAttr = fontSizeAttr;
                }
                // font要素のcolor属性
                const colorAttr = current.getAttribute('color');
                if (colorAttr && !result.colorFromAttr) {
                    result.colorFromAttr = colorAttr;
                }
            }
            current = current.parentElement;
        }

        return result;
    }

    /**
     * 段落内の最後のテキストを含むスタイル付き要素を探す
     * カーソルがP要素内（span外）にある場合に使用
     * @param {Element} paragraph - 段落要素
     * @returns {Element|null} 最後のスタイル付き要素、見つからない場合はnull
     */
    findLastStyledElement(paragraph) {
        // 段落内を後ろから探索して、テキストを含む最後の要素を見つける
        const walker = document.createTreeWalker(
            paragraph,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );

        let lastTextNode = null;
        let lastStyledTextNode = null;  // スタイル付き要素内の最後のテキストノード
        let node;
        while (node = walker.nextNode()) {
            // 空白のみのテキストノードは除外
            if (node.textContent.trim() !== '' || node.textContent === '\u200B') {
                lastTextNode = node;
                // 親がP要素以外（span等のスタイル付き要素）の場合は記録
                if (node.parentElement && node.parentElement !== paragraph) {
                    lastStyledTextNode = node;
                }
            }
        }

        // 最後のテキストノードの親がスタイル付き要素の場合はそれを返す
        if (lastTextNode) {
            let parent = lastTextNode.parentElement;
            if (parent && parent !== paragraph) {
                return parent;
            }
        }

        // 最後のテキストノードの親がP要素の場合（スタイルなしテキスト）、
        // その前のスタイル付き要素内の最後のテキストノードを使用
        if (lastStyledTextNode) {
            return lastStyledTextNode.parentElement;
        }

        return null;
    }

    /**
     * スタイル引き継ぎが必要か判定
     * @param {Object} style - スタイル情報
     * @returns {boolean} 引き継ぎ必要ならtrue
     */
    needsStyleInherit(style) {
        // フォントサイズがデフォルト（14pt）以外
        // computedStyleはpx単位で返されるため、pt値に変換して比較
        let fontSizePt = parseFloat(style.fontSize);
        if (style.fontSize && style.fontSize.endsWith('px')) {
            fontSizePt = fontSizePt / 1.333;  // px → pt 変換
        }
        if (Math.abs(fontSizePt - 14) > 0.5) return true;

        // 色が黒以外（rgb(0, 0, 0) または rgb(1, 1, 1) はデフォルト扱い）
        if (style.color && style.color !== 'rgb(0, 0, 0)' && style.color !== 'rgb(1, 1, 1)') return true;

        // 太字
        if (style.fontWeight === 'bold' || parseInt(style.fontWeight) >= 700) return true;

        // 斜体
        if (style.fontStyle === 'italic' || style.fontStyle === 'oblique') return true;

        // 下線等（none以外で、かつ実際に装飾がある場合）
        if (style.textDecoration && !style.textDecoration.startsWith('none')) return true;

        return false;
    }

    /**
     * スタイル引き継ぎ用のspanを作成
     * @param {Object} style - スタイル情報
     * @returns {HTMLSpanElement} span要素
     */
    createStyleInheritSpan(style) {
        const span = document.createElement('span');

        // フォントサイズ
        // computedStyleはpx単位で返されるため、pt値に変換して比較・設定
        let fontSizePt = parseFloat(style.fontSize);
        if (style.fontSize && style.fontSize.endsWith('px')) {
            fontSizePt = fontSizePt / 1.333;  // px → pt 変換
        }
        if (Math.abs(fontSizePt - 14) > 0.5) {
            span.style.fontSize = fontSizePt + 'pt';  // pt単位で設定
        }

        // 色（黒以外）
        if (style.color && style.color !== 'rgb(0, 0, 0)' && style.color !== 'rgb(1, 1, 1)') {
            span.style.color = style.color;
        }

        // 太字
        if (style.fontWeight === 'bold' || parseInt(style.fontWeight) >= 700) {
            span.style.fontWeight = 'bold';
        }

        // 斜体
        if (style.fontStyle === 'italic' || style.fontStyle === 'oblique') {
            span.style.fontStyle = style.fontStyle;
        }

        // 下線等
        if (style.textDecoration && !style.textDecoration.startsWith('none')) {
            span.style.textDecoration = style.textDecoration;
        }

        // ゼロ幅スペースを追加（spanが消えないように）
        span.appendChild(document.createTextNode('\u200B'));

        return span;
    }

    /**
     * 空のspan要素を再帰的に削除
     * extractContents()後に残る空のspan構造をクリーンアップする
     * @param {HTMLElement} element - クリーンアップ対象の要素
     */
    removeEmptySpans(element) {
        if (!element) return;

        // 子要素を後ろから処理（削除時のインデックスずれを防ぐ）
        const children = Array.from(element.childNodes);
        for (let i = children.length - 1; i >= 0; i--) {
            const child = children[i];
            if (child.nodeType === Node.ELEMENT_NODE && child.nodeName === 'SPAN') {
                // 再帰的に子のspanも処理
                this.removeEmptySpans(child);

                // spanが空（テキストコンテンツなし、または空白のみ）なら削除
                // ただし、ZWSPのみのspanは残す（スタイル継承用）
                const textContent = child.textContent;
                const hasOnlyZWSP = textContent === '\u200B';
                const hasBR = child.querySelector('br');

                if (!hasOnlyZWSP && !hasBR && textContent.trim() === '') {
                    child.parentNode.removeChild(child);
                }
            }
        }
    }

    /**
     * フォント色を適用
     * - 選択範囲あり: document.execCommandで複雑な選択にも対応
     * - 選択範囲なし: カーソル位置に空のspanを挿入し、次の入力に色を適用
     * @param {string} color - 色コード（例: #000000）
     */
    applyFontColor(color) {
        logger.debug('[EDITOR] applyFontColor called:', color);

        const selection = window.getSelection();
        if (!selection.rangeCount) {
            logger.warn('[EDITOR] applyFontColor: rangeCount=0');
            return;
        }

        const range = selection.getRangeAt(0);

        if (range.collapsed) {
            // 選択範囲なし（カーソルのみ）: 空のspanを挿入
            logger.debug('[EDITOR] applyFontColor: カーソル位置に色spanを挿入');
            const span = document.createElement('span');
            span.style.color = color;
            // ゼロ幅スペースを入れてspanが消えないようにする
            span.appendChild(document.createTextNode('\u200B'));
            range.insertNode(span);

            // カーソルをspan内に配置
            const newRange = document.createRange();
            newRange.setStart(span.firstChild, 1); // ゼロ幅スペースの後
            newRange.collapse(true);
            selection.removeAllRanges();
            selection.addRange(newRange);

            // 変更フラグを設定
            this.isModified = true;
        } else {
            // 選択範囲あり: document.execCommandを使用（複雑な選択範囲に対応）
            logger.debug('[EDITOR] applyFontColor: execCommandで色を適用');

            // Chrome/Electron workaround: 黒色(#000000)はspanを生成せず既存の色を削除するだけ
            // 近似色(#010101)を使用してspanを生成させ、保存時に正規化する
            let execColor = color;
            if (color.toLowerCase() === '#000000') {
                execColor = '#010101';
                logger.debug('[EDITOR] applyFontColor: 黒色→#010101に変換（Chrome workaround）');
            }
            document.execCommand('foreColor', false, execColor);
        }

        // input イベントを発火（変更フラグ設定のため）
        const inputEvent = new Event('input', { bubbles: true, cancelable: true });
        this.editor.dispatchEvent(inputEvent);
    }

    /**
     * カスタム文字色
     */
    async customColor() {
        const color = await this.showInputDialog('文字色を入力してください（例: #ff0000, #000000）', '#000000', 20, { colorPicker: true });
        if (color) {
            this.applyFontColor(color);
            this.setStatus(`文字色: ${color}`);
        }
    }

    /**
     * 改ページ挿入
     */
    insertPageBreak() {
        const pageBreak = document.createElement('div');
        pageBreak.className = 'page-break';
        // 用紙枠表示がオンの場合はpage-break-visibleクラスも追加
        if (this.paperFrameVisible) {
            pageBreak.classList.add('page-break-visible');
        }
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
                const parentNode = existingRuby.parentNode;
                parentNode.replaceChild(textNode, existingRuby);
                // 隣接テキストノードを結合して空白の蓄積を防ぐ
                parentNode.normalize();
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

    // updateWindowConfig() は基底クラス PluginBase で定義

    /**
     * ウィンドウが非アクティブになった時の処理（PluginBase hook override）
     * 選択位置とスクロール位置を保存
     */
    onWindowDeactivated() {
        // 選択範囲（カーソル位置）を保存
        this._saveSelection();
        // スクロール位置を保存
        this.saveScrollPosition();
    }

    /**
     * ウィンドウがアクティブになった時の処理（PluginBase hook override）
     * スクロール位置と選択位置を復元してフォーカスを設定
     */
    onWindowActivated() {
        if (!this.editor) return;

        // .plugin-contentのスクロール位置を保存
        const pluginContent = document.querySelector('.plugin-content');
        const savedScrollPos = pluginContent ? {
            x: pluginContent.scrollLeft,
            y: pluginContent.scrollTop
        } : null;

        // エディタにフォーカスを設定
        this.editor.focus();

        // スクロール位置を復元（フォーカスでリセットされる場合があるため）
        if (pluginContent && savedScrollPos) {
            requestAnimationFrame(() => {
                pluginContent.scrollLeft = savedScrollPos.x;
                pluginContent.scrollTop = savedScrollPos.y;

                // 選択範囲（カーソル位置）を復元
                this._restoreSelection();
            });
        } else {
            // pluginContentがない場合も選択範囲の復元を試みる
            requestAnimationFrame(() => {
                this._restoreSelection();
            });
        }
    }

    /**
     * クローズ前の保存処理フック（PluginBase共通ハンドラから呼ばれる）
     * 「保存」が選択された時にXMLデータの変更を通知
     */
    async onSaveBeforeClose() {
        this.notifyXmlDataChanged();
    }

    // handleCloseRequest() と respondCloseRequest() は PluginBase で定義

    // requestCloseWindow() は基底クラス PluginBase で定義

    // showSaveConfirmDialog() は基底クラス PluginBase で定義

    // getNextImageNumber は PluginBase の共通実装を使用

    /**
     * メモリ上の最大画像番号を取得（PluginBase.getNextImageNumber から呼ばれる）
     * @returns {number} 最大画像番号（-1で画像なし）
     */
    getMemoryMaxImageNumber() {
        // エディタ内のすべての画像要素から最大のimgNoを取得
        let maxImgNo = -1;
        const images = this.editor.querySelectorAll('img[data-img-no]');
        images.forEach(img => {
            const imgNo = parseInt(img.getAttribute('data-img-no'));
            if (!isNaN(imgNo) && imgNo > maxImgNo) {
                maxImgNo = imgNo;
            }
        });
        return maxImgNo;
    }

    /**
     * 画像ファイルを保存
     */
    /**
     * 親ウィンドウから画像ファイルを読み込んで表示
     */
    async loadImagesFromParent() {
        // data-needs-load="true" 属性を持つすべての画像を取得
        const images = this.editor.querySelectorAll('img[data-needs-load="true"]');

        // 各画像を順番に読み込む
        for (const img of images) {
            const fileName = img.getAttribute('data-saved-filename');
            if (fileName && !fileName.startsWith('data:')) {
                logger.debug('[EDITOR] 画像読み込み要求:', fileName);

                try {
                    // PluginBase共通メソッドで画像パスを取得
                    const filePath = await this.getImageFilePath(fileName);

                    if (filePath) {
                        // Electron環境の場合、ファイルを直接読み込む
                        if (typeof require !== 'undefined') {
                            try {
                                const fs = require('fs');
                                const buffer = fs.readFileSync(filePath);
                                const uint8Array = new Uint8Array(buffer);

                                // MIMEタイプを推測
                                const ext = filePath.split('.').pop().toLowerCase();
                                let mimeType = 'image/png';
                                if (ext === 'jpg' || ext === 'jpeg') {
                                    mimeType = 'image/jpeg';
                                } else if (ext === 'gif') {
                                    mimeType = 'image/gif';
                                } else if (ext === 'bmp') {
                                    mimeType = 'image/bmp';
                                }

                                // Blobを作成
                                const blob = new Blob([uint8Array], { type: mimeType });

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
                                            logger.debug('[EDITOR] 元のサイズを設定:', img.naturalWidth, 'x', img.naturalHeight);
                                        }
                                    };

                                    logger.debug('[EDITOR] 画像読み込み成功:', fileName);
                                };
                                reader.readAsDataURL(blob);
                            } catch (error) {
                                logger.error('[EDITOR] ファイル読み込みエラー:', fileName, error);
                                img.alt = `画像が見つかりません: ${fileName}`;
                            }
                        } else {
                            // ブラウザ/iframe環境の場合
                            // 絶対パスをfile:// URLに変換
                            let fileUrl = filePath;
                            if (filePath.match(/^[A-Za-z]:\\/)) {
                                // Windows絶対パス (C:\...) を file:// URLに変換
                                fileUrl = 'file:///' + filePath.replace(/\\/g, '/');
                            } else if (filePath.startsWith('/')) {
                                // Unix絶対パス
                                fileUrl = 'file://' + filePath;
                            }
                            img.src = fileUrl;
                            img.removeAttribute('data-needs-load');
                            logger.debug('[EDITOR] 画像URLを設定:', fileUrl);
                        }
                    } else {
                        logger.error('[EDITOR] 画像パス取得失敗:', fileName);
                        img.alt = `画像が見つかりません: ${fileName}`;
                    }
                } catch (error) {
                    logger.error('[EDITOR] 画像読み込みタイムアウトまたはエラー:', fileName, error);
                    img.alt = `画像が見つかりません: ${fileName}`;
                }
            }
        }
    }

    // saveImageFile, deleteImageFile は PluginBase の共通実装を使用

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
            logger.debug('[EDITOR] ドラッグ開始時のサイズを保存:', currentWidth, currentHeight);

            // 他のウィンドウでドロップを受け取れるようにデータを設定
            const imageData = {
                type: 'image-drag',
                source: 'basic-text-editor',
                sourceWindowId: this.windowId,
                imageInfo: {
                    savedFilename: img.getAttribute('data-saved-filename'),
                    width: parseInt(currentWidth),
                    height: parseInt(currentHeight),
                    originalWidth: img.getAttribute('data-original-width'),
                    originalHeight: img.getAttribute('data-original-height'),
                    mimeType: img.getAttribute('data-mime-type') || 'image/png'
                }
            };
            e.dataTransfer.setData('text/plain', JSON.stringify(imageData));

            logger.debug('[EDITOR] 画像ドラッグ開始');
        });

        // 画像の右クリックイベントを設定
        img.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            // 右クリックされた画像の情報を保存（メニュー生成時に使用）
            this.contextMenuSelectedImage = img;
            logger.debug('[EDITOR] 画像右クリック:', img.getAttribute('data-saved-filename'));

            // 親ウィンドウに右クリック位置を通知してメニューを表示（共通メソッドを使用）
            this.showContextMenuAtEvent(e);
        });

        // リサイズハンドルを作成
        this.createResizeHandle(img);

        logger.debug('[EDITOR] 画像を選択:', img.getAttribute('data-saved-filename'));
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

            logger.debug('[EDITOR] 画像の選択を解除');
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

        logger.debug('[EDITOR] リサイズ開始:', this.resizeStartWidth, 'x', this.resizeStartHeight, 'ratio:', this.imageAspectRatio);

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

            logger.debug('[EDITOR] リサイズ終了、サイズを保存:', currentWidth, currentHeight);
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
        logger.debug('[EDITOR] 画像移動開始');

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
            logger.error('[EDITOR] カーソル位置を取得できませんでした');
            return;
        }

        // 画像の現在のサイズを取得（単位付き文字列で統一）
        // 優先順位: data-current-* > style.* > 実際の表示サイズ
        let currentWidth = img.getAttribute('data-current-width') || img.style.width;
        let currentHeight = img.getAttribute('data-current-height') || img.style.height;

        // 単位がない場合や値がない場合は実際の表示サイズを使用
        if (!currentWidth || parseFloat(currentWidth) === 0) {
            currentWidth = (img.offsetWidth || img.width || 100) + 'px';
        } else if (!currentWidth.includes('px') && !currentWidth.includes('%')) {
            currentWidth = parseFloat(currentWidth) + 'px';
        }
        if (!currentHeight || parseFloat(currentHeight) === 0) {
            currentHeight = (img.offsetHeight || img.height || 100) + 'px';
        } else if (!currentHeight.includes('px') && !currentHeight.includes('%')) {
            currentHeight = parseFloat(currentHeight) + 'px';
        }

        logger.debug('[EDITOR] 移動時のサイズを復元:', currentWidth, currentHeight);

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

        logger.debug('[EDITOR] 画像移動完了:', savedFilename);
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
    async copyImage(img) {
        logger.debug('[EDITOR] 画像をコピー:', img.getAttribute('data-saved-filename'));

        // 画像データをDataURLとして取得（PluginBase共通メソッド使用）
        const dataUrl = await this.imageElementToDataUrlAsync(img);

        // 画像の全ての属性を保存
        this.imageClipboard = {
            src: dataUrl || img.src,
            dataUrl: dataUrl,  // DataURLを保持（貼り付け時に使用）
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

        logger.debug('[EDITOR] 画像クリップボード:', this.imageClipboard);
    }

    /**
     * 画像をクリップボードへ移動（カット）
     * ファイル削除前に画像データをDataURLとして保持する
     */
    async cutImage(img) {
        logger.debug('[EDITOR] 画像を移動:', img.getAttribute('data-saved-filename'));

        const savedFilename = img.getAttribute('data-saved-filename');

        // 画像データをDataURLとして取得（ファイル削除前に実行、PluginBase共通メソッド使用）
        const dataUrl = await this.imageElementToDataUrlAsync(img);

        // 画像の全ての属性を保存
        this.imageClipboard = {
            src: dataUrl || img.src,
            dataUrl: dataUrl,  // DataURLを保持（貼り付け時に使用）
            alt: img.alt,
            width: img.style.width,
            height: img.style.height,
            savedFilename: savedFilename,
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

        // MutationObserverを一時停止して画像を削除（ファイル削除をバイパス）
        this.suppressMutationObserverCount++;
        try {
            this.deselectImage();
            img.remove();
        } finally {
            this.suppressMutationObserverCount--;
        }

        // 手動でファイルを削除
        if (savedFilename && !savedFilename.startsWith('data:')) {
            this.deleteImageFile(savedFilename);
        }

        logger.debug('[EDITOR] 画像を削除し、クリップボードに保存:', this.imageClipboard);

        // 編集状態を記録
        this.isModified = true;
    }

    // imageElementToDataUrlAsync() は基底クラス PluginBase で定義

    /**
     * 画像をクリップボードから貼り付け
     */
    async pasteImage() {
        if (!this.imageClipboard) {
            logger.warn('[EDITOR] クリップボードに画像がありません');
            return;
        }

        logger.debug('[EDITOR] 画像を貼り付け:', this.imageClipboard);

        // カーソル位置を取得
        const selection = window.getSelection();
        if (selection.rangeCount === 0) {
            logger.warn('[EDITOR] カーソル位置が取得できません');
            return;
        }

        const range = selection.getRangeAt(0);

        // 新しい画像要素を作成
        const newImg = document.createElement('img');
        newImg.alt = this.imageClipboard.alt;
        newImg.style.width = this.imageClipboard.width;
        newImg.style.height = this.imageClipboard.height;

        // 新しいファイル名を生成して保存（コピーモード・カットモード共通）
        // カットモードでは元ファイルは削除済みなので、dataUrlから新しいファイルを作成する
        let newSavedFilename = this.imageClipboard.savedFilename;
        const hasDataUrl = this.imageClipboard.dataUrl && this.imageClipboard.dataUrl.startsWith('data:');
        const needsNewFile = this.imageClipboard.savedFilename && !this.imageClipboard.savedFilename.startsWith('data:');

        if (needsNewFile && hasDataUrl) {
            // 新しい画像番号を取得
            const imgNo = await this.getNextImageNumber();

            // 新しいファイル名を生成
            let realId = this.realId || 'unknown';
            realId = realId.replace(/_\d+\.xtad$/i, '');
            const recordNo = 0;
            const extension = this.imageClipboard.savedFilename.split('.').pop().toLowerCase() || 'png';
            newSavedFilename = `${realId}_${recordNo}_${imgNo}.${extension}`;

            // 画像データを新しいファイル名で保存（dataUrlを使用）
            await this.copyImageToFile(newImg, newSavedFilename, this.imageClipboard.dataUrl);

            logger.debug(`[EDITOR] ${this.imageClipboard.isCut ? 'カット' : 'コピー'}モード: 新しいファイル名で保存:`, newSavedFilename);

            // 新しい画像番号を設定
            newImg.setAttribute('data-img-no', imgNo);
        } else {
            if (this.imageClipboard.imgNo) newImg.setAttribute('data-img-no', this.imageClipboard.imgNo);
        }

        // 画像ソースを設定（dataUrlがあればそれを使用、なければ元のsrc）
        newImg.src = this.imageClipboard.dataUrl || this.imageClipboard.src;

        newImg.setAttribute('data-saved-filename', newSavedFilename);
        if (this.imageClipboard.currentWidth) newImg.setAttribute('data-current-width', this.imageClipboard.currentWidth);
        if (this.imageClipboard.currentHeight) newImg.setAttribute('data-current-height', this.imageClipboard.currentHeight);
        if (this.imageClipboard.originalWidth) newImg.setAttribute('data-original-width', this.imageClipboard.originalWidth);
        if (this.imageClipboard.originalHeight) newImg.setAttribute('data-original-height', this.imageClipboard.originalHeight);
        if (this.imageClipboard.planes) newImg.setAttribute('data-planes', this.imageClipboard.planes);
        if (this.imageClipboard.pixbits) newImg.setAttribute('data-pixbits', this.imageClipboard.pixbits);
        if (this.imageClipboard.mimeType) newImg.setAttribute('data-mime-type', this.imageClipboard.mimeType);

        // data: URLが必要な場合は読み込み（移動モードまたはdata: URL以外の場合）
        if (newSavedFilename && !newSavedFilename.startsWith('data:')) {
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
        if (newSavedFilename && !newSavedFilename.startsWith('data:')) {
            this.loadImagesFromParent();
        }

        // 画像を選択
        this.selectImage(newImg);

        // 移動モードの場合はクリップボードをクリア
        if (this.imageClipboard.isCut) {
            this.imageClipboard = null;
            logger.debug('[EDITOR] 移動モードのためクリップボードをクリア');
        }

        logger.debug('[EDITOR] 画像貼り付け完了');

        // 編集状態を記録
        this.isModified = true;
    }

    /**
     * 画像をクリップボードにコピーする際のファイル保存
     * @param {HTMLImageElement} imgElement - 画像要素
     * @param {string} fileName - 保存するファイル名
     * @param {string} srcUrl - 画像のソースURL（data: URLまたはfile:// URL）
     */
    async copyImageToFile(imgElement, fileName, srcUrl) {
        try {
            // srcがdata: URLの場合はそのまま使用
            if (srcUrl && srcUrl.startsWith('data:')) {
                // PluginBase共通メソッドでDataURLから保存
                await this.saveImageFile(srcUrl, fileName);
            } else {
                // 画像が読み込まれるまで待機
                await new Promise((resolve, reject) => {
                    if (imgElement.complete && imgElement.naturalWidth > 0) {
                        resolve();
                    } else {
                        imgElement.onload = resolve;
                        imgElement.onerror = reject;
                        // タイムアウト設定
                        setTimeout(() => reject(new Error('画像読み込みタイムアウト')), 5000);
                    }
                });

                // PluginBase共通メソッドで画像要素から保存
                await super.saveImageFromElement(imgElement, fileName);
            }

            logger.debug('[EDITOR] 画像ファイル保存完了(コピー):', fileName);
        } catch (error) {
            logger.error('[EDITOR] 画像ファイル保存エラー(コピー):', error);
        }
    }

    /**
     * 仮身をクリップボードへコピー
     */
    copyVirtualObject(vo) {
        logger.debug('[EDITOR] 仮身をコピー:', vo.dataset.linkName);

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

        logger.debug('[EDITOR] 仮身クリップボード:', this.virtualObjectClipboard);
    }

    /**
     * 仮身をクリップボードへ移動（カット）
     */
    cutVirtualObject(vo) {
        logger.debug('[EDITOR] 仮身を移動:', vo.dataset.linkName);

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

        // refCount-1（カット = ドキュメントから参照が削除される）
        const linkId = attributes.linkId || attributes.linkLinkId;
        if (linkId) {
            this.requestDeleteVirtualObject(linkId);
        }

        // 編集状態を記録
        this.isModified = true;
    }

    /**
     * 仮身をクリップボードから貼り付け
     */
    pasteVirtualObject() {
        if (!this.virtualObjectClipboard) {
            logger.warn('[EDITOR] クリップボードに仮身がありません');
            return;
        }

        logger.debug('[EDITOR] 仮身を貼り付け:', this.virtualObjectClipboard);

        // カーソル位置を取得
        const selection = window.getSelection();
        if (selection.rangeCount === 0) {
            logger.warn('[EDITOR] カーソル位置が取得できません');
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

        // refCount+1（ペースト = 新しい参照が作成される）
        const linkId = this.virtualObjectClipboard.attributes.linkId ||
            this.virtualObjectClipboard.attributes.linkLinkId;
        if (linkId) {
            this.requestCopyVirtualObject(linkId);
        }

        // 移動モードの場合はクリップボードをクリア
        if (this.virtualObjectClipboard.isCut) {
            this.virtualObjectClipboard = null;
        }

        // 編集状態を記録
        this.isModified = true;
    }

    /**
     * グローバルクリップボードから仮身または画像をペースト
     */
    async pasteFromGlobalClipboard() {
        logger.debug('[EDITOR] グローバルクリップボードをチェック中...');

        // 親ウィンドウからグローバルクリップボードを取得
        const globalClipboard = await this.getGlobalClipboard();

        if (globalClipboard && globalClipboard.link_id) {
            // 仮身データがある場合
            this.insertVirtualObjectLink(globalClipboard);
            // refCount+1（グローバルクリップボードからのペースト = 新しい参照が作成される）
            this.requestCopyVirtualObject(globalClipboard.link_id);
            this.setStatus('仮身をクリップボードから貼り付けました');
        } else if (globalClipboard && globalClipboard.type === 'image' && globalClipboard.dataUrl) {
            // 画像データがある場合（他プラグインからの画像コピー）
            await this.insertImageFromDataUrl(globalClipboard.dataUrl, globalClipboard.name || 'image.png');
            this.setStatus('画像をクリップボードから貼り付けました');
        } else if (globalClipboard && globalClipboard.type === 'text' && globalClipboard.text) {
            // テキストデータがある場合（グローバルクリップボード優先）
            document.execCommand('insertText', false, globalClipboard.text);
            this.setStatus('テキストをクリップボードから貼り付けました');
        } else {
            // グローバルクリップボードにデータがない場合はシステムクリップボードからテキストをペースト
            await this.pasteTextFromClipboard();
        }

        // 編集状態を記録
        this.isModified = true;
    }

    /**
     * グローバルクリップボードから移動（貼り付け後クリア）
     */
    async pasteMoveFromGlobalClipboard() {
        logger.debug('[EDITOR] グローバルクリップボードから移動中...');

        // 親ウィンドウからグローバルクリップボードを取得
        const globalClipboard = await this.getGlobalClipboard();

        if (globalClipboard && globalClipboard.link_id) {
            // 仮身データがある場合
            this.insertVirtualObjectLink(globalClipboard);
            // 移動なのでrefCountは変更しない（元の場所から削除されているため）
            this.setStatus('仮身をクリップボードから移動しました');
            // グローバルクリップボードをクリア
            this.setClipboard(null);
        } else if (globalClipboard && globalClipboard.type === 'image' && globalClipboard.dataUrl) {
            // 画像データがある場合（他プラグインからの画像コピー）
            await this.insertImageFromDataUrl(globalClipboard.dataUrl, globalClipboard.name || 'image.png');
            this.setStatus('画像をクリップボードから移動しました');
            // グローバルクリップボードをクリア
            this.setClipboard(null);
        } else if (globalClipboard && globalClipboard.type === 'text' && globalClipboard.text) {
            // テキストデータがある場合（グローバルクリップボード優先）
            document.execCommand('insertText', false, globalClipboard.text);
            this.setStatus('テキストをクリップボードから移動しました');
            // グローバルクリップボードをクリア（移動なので）
            this.setClipboard(null);
        } else {
            // グローバルクリップボードにデータがない場合はシステムクリップボードからテキストを移動
            await this.pasteMoveTextFromClipboard();
        }

        // 編集状態を記録
        this.isModified = true;
    }

    /**
     * テキストをクリップボードにコピー（Clipboard API使用）
     */
    async copyTextToClipboard() {
        const selection = window.getSelection();
        // 現在の選択テキスト、または保存済みの選択テキストを使用
        // （メニュークリック時にフォーカスが外れて選択が消える場合の対策）
        const selectedText = selection.toString() || this.lastSelectedText;

        if (selectedText) {
            // グローバルクリップボードにテキストを保存（確実な方法）
            this.setTextClipboard(selectedText);

            // テキストコピー時はローカルの画像・仮身クリップボードをクリア
            // （ペースト時にテキストが優先されるようにする）
            this.imageClipboard = null;
            this.virtualObjectClipboard = null;

            try {
                // システムクリップボードにも書き込み（外部アプリ連携用、失敗してもOK）
                await navigator.clipboard.writeText(selectedText);
            } catch (error) {
                // システムクリップボード書き込み失敗は無視
                // グローバルクリップボードに保存済みなので問題なし
            }
            this.setStatus('クリップボードへコピーしました');
        } else {
            this.setStatus('コピーするテキストが選択されていません');
        }
    }

    /**
     * テキストをクリップボードに移動（Clipboard API使用）
     */
    async cutTextToClipboard() {
        const selection = window.getSelection();
        // 現在の選択テキスト、または保存済みの選択テキストを使用
        const selectedText = selection.toString() || this.lastSelectedText;

        if (selectedText) {
            // グローバルクリップボードにテキストを保存（確実な方法）
            this.setTextClipboard(selectedText);

            // テキストコピー時はローカルの画像・仮身クリップボードをクリア
            // （ペースト時にテキストが優先されるようにする）
            this.imageClipboard = null;
            this.virtualObjectClipboard = null;

            // 選択範囲を削除（フォーカス復帰後に選択が残っている場合のみ）
            if (!selection.isCollapsed) {
                document.execCommand('delete');
            }

            try {
                // システムクリップボードにも書き込み（外部アプリ連携用、失敗してもOK）
                await navigator.clipboard.writeText(selectedText);
            } catch (error) {
                // システムクリップボード書き込み失敗は無視
                // グローバルクリップボードに保存済みなので問題なし
            }
            this.setStatus('クリップボードへ移動しました');
            this.isModified = true;
        } else {
            this.setStatus('移動するテキストが選択されていません');
        }
    }

    /**
     * システムクリップボードからテキストをペースト（Clipboard API使用）
     */
    async pasteTextFromClipboard() {
        try {
            const text = await navigator.clipboard.readText();
            if (text) {
                // テキストを挿入
                document.execCommand('insertText', false, text);
                this.updateParagraphLineHeight(); // 段落のline-heightを更新
                this.setStatus('クリップボードから貼り付けました');
            } else {
                this.setStatus('クリップボードにデータがありません');
            }
        } catch (error) {
            // NotAllowedError: クロスプラグイン間でフォーカスがない場合に発生
            // グローバルクリップボードで対応済みのため、システムクリップボードアクセス失敗は無視
            if (error.name === 'NotAllowedError') {
                this.setStatus('貼り付け可能なデータがありません');
                return;
            }
            // その他のエラーも同様に処理（危険なdocument.execCommand('paste')は使用しない）
            this.setStatus('貼り付けに失敗しました');
        }
    }

    /**
     * システムクリップボードからテキストを移動（貼り付け後クリア）
     */
    async pasteMoveTextFromClipboard() {
        try {
            const text = await navigator.clipboard.readText();
            if (text) {
                // テキストを挿入
                document.execCommand('insertText', false, text);
                this.updateParagraphLineHeight(); // 段落のline-heightを更新
                // システムクリップボードをクリア
                await navigator.clipboard.writeText('');
                this.setStatus('クリップボードから移動しました');
            } else {
                this.setStatus('クリップボードにデータがありません');
            }
        } catch (error) {
            // NotAllowedError: クロスプラグイン間でフォーカスがない場合に発生
            // グローバルクリップボードで対応済みのため、システムクリップボードアクセス失敗は無視
            if (error.name === 'NotAllowedError') {
                this.setStatus('移動可能なデータがありません');
                return;
            }
            // その他のエラーも同様に処理（危険なdocument.execCommand('paste')は使用しない）
            this.setStatus('移動に失敗しました');
        }
    }

    // getGlobalClipboard() は基底クラス PluginBase で定義

    /**
     * 仮身をドロップ位置にコピー
     */
    async copyVirtualObjectToCursor(e) {
        if (!this.draggingVirtualObjectData) {
            logger.warn('[EDITOR] ドラッグ中の仮身データがありません');
            return;
        }

        logger.debug('[EDITOR] 仮身をドロップ位置にコピー:', this.draggingVirtualObjectData);

        // ドロップ位置にカーソルを移動
        const range = document.caretRangeFromPoint(e.clientX, e.clientY);
        if (!range) {
            logger.warn('[EDITOR] ドロップ位置が取得できません');
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

        logger.debug('[EDITOR] 仮身ドロップコピー完了');

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
            logger.warn('[EDITOR] 仮身データがありません');
            return;
        }

        logger.debug('[EDITOR] 仮身をカーソル位置に挿入:', virtualObjectData);

        const selection = window.getSelection();
        if (selection.rangeCount === 0) {
            logger.warn('[EDITOR] カーソル位置が設定されていません');
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

        logger.debug('[EDITOR] 仮身挿入完了');

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
        logger.debug('[EDITOR] 仮身を開いた表示に展開:', vo.dataset.linkName);

        // 実身IDを取得
        const linkId = vo.dataset.linkId;
        // 実身IDを抽出（共通メソッドを使用）
        const realId = window.RealObjectSystem.extractRealId(linkId);

        try {
            // appListからdefaultOpenを取得
            const appListData = await this.getAppListData(realId);
            if (!appListData) {
                logger.error('[EDITOR] ★★エラー: appListの取得に失敗しました:', {
                    realId: realId,
                    linkName: vo.dataset.linkName,
                    dataset属性: {
                        pictdisp: vo.dataset.linkPictdisp,
                        namedisp: vo.dataset.linkNamedisp,
                        framedisp: vo.dataset.linkFramedisp
                    }
                });
                vo.classList.remove('expanded');
                this.setStatus(`仮身の実身情報が見つかりません: ${realId}`);
                return;
            }

            const defaultOpen = this.getDefaultOpenFromAppList(appListData);
            if (!defaultOpen) {
                logger.error('[EDITOR] ★★エラー: defaultOpenが設定されていません:', {
                    realId: realId,
                    linkName: vo.dataset.linkName,
                    appListData: appListData
                });
                vo.classList.remove('expanded');
                this.setStatus(`仮身のデフォルト起動アプリが設定されていません: ${realId}`);
                return;
            }

            logger.debug('[EDITOR] defaultOpenプラグイン:', defaultOpen);

            // 実身データを読み込む
            const realObjectData = await this.loadRealObjectData(realId);
            if (!realObjectData) {
                logger.error('[EDITOR] ★★エラー: 実身データの読み込みに失敗しました:', {
                    realId: realId,
                    linkName: vo.dataset.linkName
                });
                vo.classList.remove('expanded');
                this.setStatus(`実身データの読み込みに失敗しました: ${realId}`);
                return;
            }

            logger.debug('[EDITOR] 実身データ読み込み完了:', realObjectData);

            // 仮身の内容を保存
            const originalText = vo.textContent;

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
            vo.style.verticalAlign = 'bottom';
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
                titleBar.style.gap = '4px';  // VirtualObjectRendererと同じ
                titleBar.style.paddingLeft = '8px';
                titleBar.style.paddingRight = '8px';
                titleBar.style.fontSize = window.convertPtToPx(chsz) + 'px';  // ポイント値をピクセル値に変換
                titleBar.style.lineHeight = '1.2';  // VirtualObjectRendererと同じ
                titleBar.style.fontWeight = 'normal';
                titleBar.style.boxSizing = 'border-box';
                titleBar.style.overflow = 'hidden';
                titleBar.style.whiteSpace = 'nowrap';
                titleBar.style.userSelect = 'none';

                // VirtualObjectRendererと同じ構造でタイトル要素を構築
                const chszPx = window.convertPtToPx(chsz);

                // ピクトグラム（アイコン）
                if (showPict) {
                    const iconImg = document.createElement('img');
                    iconImg.className = 'virtual-object-icon';
                    iconImg.style.width = chszPx + 'px';
                    iconImg.style.height = chszPx + 'px';
                    iconImg.style.objectFit = 'contain';
                    iconImg.style.flexShrink = '0';
                    iconImg.style.backgroundColor = 'transparent';

                    // アイコンを読み込む
                    this.iconManager.loadIcon(realId).then(iconData => {
                        if (iconData) {
                            iconImg.src = `data:image/x-icon;base64,${iconData}`;
                        }
                    }).catch(error => {
                        logger.error('[EDITOR] アイコン読み込みエラー:', realId, error);
                    });

                    titleBar.appendChild(iconImg);
                }

                // テキスト部分（VirtualObjectRendererと同じ構造）
                const textSpan = document.createElement('span');
                textSpan.style.overflow = 'hidden';
                textSpan.style.textOverflow = 'ellipsis';
                textSpan.style.whiteSpace = 'nowrap';
                textSpan.style.flex = '1';

                // 名称
                if (showName) {
                    const nameSpan = document.createElement('span');
                    nameSpan.textContent = originalText;
                    textSpan.appendChild(nameSpan);
                }

                // 続柄（VirtualObjectRendererと同じロジック）
                if (showRole && realObjectData && realObjectData.metadata && realObjectData.metadata.relationship && realObjectData.metadata.relationship.length > 0) {
                    const relationshipText = realObjectData.metadata.relationship.join(' ');
                    const relationshipSpan = document.createElement('span');
                    relationshipSpan.textContent = ' : ' + relationshipText;
                    textSpan.appendChild(relationshipSpan);
                }

                // タイプ（VirtualObjectRendererと同じロジック）
                if (showType && realObjectData && realObjectData.applist) {
                    let typeName = '';
                    for (const [, config] of Object.entries(realObjectData.applist)) {
                        if (config && config.defaultOpen === true && config.name) {
                            typeName = config.name;
                            break;
                        }
                    }

                    if (typeName) {
                        const typeSpan = document.createElement('span');
                        typeSpan.textContent = ' (' + typeName + ')';
                        textSpan.appendChild(typeSpan);
                    }
                }

                // 更新日時
                if (showUpdate && realObjectData && realObjectData.metadata && realObjectData.metadata.updateDate) {
                    const updateDate = new Date(realObjectData.metadata.updateDate);
                    const dateStr = updateDate.getFullYear() + '/' +
                                  String(updateDate.getMonth() + 1).padStart(2, '0') + '/' +
                                  String(updateDate.getDate()).padStart(2, '0') + ' ' +
                                  String(updateDate.getHours()).padStart(2, '0') + ':' +
                                  String(updateDate.getMinutes()).padStart(2, '0') + ':' +
                                  String(updateDate.getSeconds()).padStart(2, '0');
                    const updateSpan = document.createElement('span');
                    updateSpan.textContent = ' ' + dateStr;
                    textSpan.appendChild(updateSpan);
                }

                titleBar.appendChild(textSpan);

                vo.appendChild(titleBar);

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

                logger.debug('[EDITOR] 開いた仮身表示にデータを送信:', { virtualObj, realObject: realObjectData, bgcol, readonly: true, noScrollbar: true });
            };

        } catch (error) {
            logger.error('[EDITOR] 開いた仮身表示エラー:', error);
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
    // loadRealObjectData() は基底クラス PluginBase で定義

    /**
     * 仮身を通常表示に戻す
     */
    async collapseVirtualObject(vo) {
        if (!vo.classList.contains('expanded')) {
            return;
        }

        vo.classList.remove('expanded');
        logger.debug('[EDITOR] 仮身を通常表示に戻す:', vo.dataset.linkName);

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

        // 閉じた仮身のスタイルと内容を復元（VirtualObjectRendererと同じ構造）
        const frcol = vo.dataset.linkFrcol || '#000000';
        const chcol = vo.dataset.linkChcol || '#000000';
        const tbcol = vo.dataset.linkTbcol || '#ffffff';
        const chsz = parseFloat(vo.dataset.linkChsz) || 14;
        const chszPx = window.convertPtToPx(chsz);

        // 表示設定を取得
        const showPict = vo.dataset.linkPictdisp !== 'false';
        const showName = vo.dataset.linkNamedisp !== 'false';
        const showRole = vo.dataset.linkRoledisp === 'true';
        const showType = vo.dataset.linkTypedisp === 'true';
        const showUpdate = vo.dataset.linkUpdatedisp === 'true';

        // 実身IDを取得
        const linkId = vo.dataset.linkId;
        const realId = linkId ? linkId.replace(/_\d+\.xtad$/i, '') : null;

        // 実身データを読み込む（更新日時、続柄、タイプ表示用）
        let realObjectData = null;
        if (realId && (showRole || showType || showUpdate)) {
            try {
                realObjectData = await this.loadRealObjectData(realId);
                logger.debug('[EDITOR] collapseVirtualObject - 実身データ読み込み成功:', realId);
                logger.debug('[EDITOR] realObjectData:', JSON.stringify({
                    hasMetadata: !!realObjectData?.metadata,
                    hasUpdateDate: !!realObjectData?.metadata?.updateDate,
                    updateDate: realObjectData?.metadata?.updateDate,
                    hasApplist: !!realObjectData?.applist,
                    hasRelationship: !!realObjectData?.metadata?.relationship
                }, null, 2));
            } catch (error) {
                logger.error('[EDITOR] 実身データの読み込みエラー:', realId, error);
            }
        }

        // VirtualObjectRendererと同じスタイルを適用
        vo.style.display = 'inline-flex';
        vo.style.alignItems = 'center';
        vo.style.gap = '4px';
        vo.style.position = 'relative';
        vo.style.verticalAlign = 'middle';
        vo.style.background = tbcol;
        vo.style.border = `1px solid ${frcol}`;
        vo.style.borderWidth = '1px';  // 明示的にボーダー幅をリセット
        vo.style.padding = '4px 8px';
        vo.style.margin = '0 2px';
        vo.style.color = chcol;
        vo.style.fontSize = chszPx + 'px';
        vo.style.lineHeight = '1.2';
        vo.style.cursor = 'pointer';
        vo.style.userSelect = 'none';
        vo.style.whiteSpace = 'nowrap';
        vo.style.overflow = 'hidden';
        vo.style.textOverflow = 'ellipsis';
        vo.style.boxSizing = 'border-box';
        vo.style.width = 'auto';
        vo.style.height = 'auto';
        vo.style.minWidth = 'auto';
        vo.style.minHeight = 'auto';
        vo.style.maxWidth = 'none';  // 幅制限を解除（VirtualObjectRendererのmaxWidth: '100%'をリセット）
        // 選択状態のスタイルをリセット（枠が太くなる問題対策）
        vo.style.outline = 'none';
        vo.classList.remove('selected');

        // 内容をクリアして再構築
        vo.innerHTML = '';

        // ピクトグラム（アイコン）
        if (showPict) {
            const iconImg = document.createElement('img');
            iconImg.className = 'virtual-object-icon';
            iconImg.style.width = chszPx + 'px';
            iconImg.style.height = chszPx + 'px';
            // min-width/min-heightを設定してsrcが空でもスペースを確保
            iconImg.style.minWidth = chszPx + 'px';
            iconImg.style.minHeight = chszPx + 'px';
            iconImg.style.objectFit = 'contain';
            iconImg.style.flexShrink = '0';
            iconImg.style.backgroundColor = 'transparent';
            iconImg.style.boxSizing = 'border-box';

            // アイコンを読み込む
            if (realId) {
                this.iconManager.loadIcon(realId).then(iconData => {
                    if (iconData) {
                        iconImg.src = `data:image/x-icon;base64,${iconData}`;
                    }
                }).catch(error => {
                    logger.error('[EDITOR] アイコン読み込みエラー:', realId, error);
                });
            }

            vo.appendChild(iconImg);
        }

        // テキスト部分
        const textSpan = document.createElement('span');
        textSpan.style.overflow = 'hidden';
        textSpan.style.textOverflow = 'ellipsis';
        textSpan.style.whiteSpace = 'nowrap';
        textSpan.style.flex = '1';

        // 名称
        if (showName) {
            const nameSpan = document.createElement('span');
            nameSpan.textContent = titleText || vo.dataset.linkName || '無題';
            textSpan.appendChild(nameSpan);
        }

        // 続柄
        if (showRole && realObjectData && realObjectData.metadata && realObjectData.metadata.relationship && realObjectData.metadata.relationship.length > 0) {
            const relationshipText = realObjectData.metadata.relationship.join(' ');
            const relationshipSpan = document.createElement('span');
            relationshipSpan.textContent = ' : ' + relationshipText;
            textSpan.appendChild(relationshipSpan);
        }

        // タイプ
        if (showType && realObjectData && realObjectData.applist) {
            let typeName = '';
            for (const [, config] of Object.entries(realObjectData.applist)) {
                if (config && config.defaultOpen === true && config.name) {
                    typeName = config.name;
                    break;
                }
            }

            if (typeName) {
                const typeSpan = document.createElement('span');
                typeSpan.textContent = ' (' + typeName + ')';
                textSpan.appendChild(typeSpan);
            }
        }

        // 更新日時
        if (showUpdate && realObjectData && realObjectData.metadata && realObjectData.metadata.updateDate) {
            const updateDate = new Date(realObjectData.metadata.updateDate);
            const dateStr = updateDate.getFullYear() + '/' +
                          String(updateDate.getMonth() + 1).padStart(2, '0') + '/' +
                          String(updateDate.getDate()).padStart(2, '0') + ' ' +
                          String(updateDate.getHours()).padStart(2, '0') + ':' +
                          String(updateDate.getMinutes()).padStart(2, '0') + ':' +
                          String(updateDate.getSeconds()).padStart(2, '0');
            const updateSpan = document.createElement('span');
            updateSpan.textContent = ' ' + dateStr;
            textSpan.appendChild(updateSpan);
        }

        vo.appendChild(textSpan);

        // コンテンツを追加した後、実際の幅を測定して固定幅を設定（リサイズを防ぐため）
        // レイアウト完了を待つ（requestAnimationFrame二重呼び出しで確実に待機）
        await new Promise(resolve =>
            requestAnimationFrame(() => requestAnimationFrame(resolve))
        );
        // getBoundingClientRect().widthでサブピクセル精度の幅を取得し、Math.ceilで切り上げ
        // offsetWidthは整数に丸められるため、数ピクセル足りなくなる問題を回避
        const actualWidth = Math.ceil(vo.getBoundingClientRect().width);
        vo.style.width = actualWidth + 'px';
        vo.style.minWidth = actualWidth + 'px';

        // 閉じた時の高さをoriginalHeightとして保存
        const textHeight = Math.ceil(chszPx * 1.2);  // lineHeight = 1.2
        const closedHeight = textHeight + 8; // 閉じた仮身の高さ
        vo.dataset.originalHeight = closedHeight.toString();
        logger.debug('[EDITOR] 仮身を閉じた時の originalHeight を更新:', vo.dataset.linkName, closedHeight, '幅:', actualWidth);
    }

    /**
     * 選択中の仮身が指し示す実身をデフォルトアプリで開く
     */
    openRealObjectWithDefaultApp() {
        if (!this.contextMenuVirtualObject || !this.contextMenuVirtualObject.virtualObj) {
            logger.warn('[EDITOR] 選択中の仮身がありません');
            return;
        }

        const virtualObj = this.contextMenuVirtualObject.virtualObj;
        const realId = this.contextMenuVirtualObject.realId;

        // applistを取得
        this.getAppListData(realId).then(async (applist) => {
            if (!applist || typeof applist !== 'object') {
                logger.warn('[EDITOR] applistが存在しません');
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
                logger.warn('[EDITOR] 開くためのプラグインが見つかりません');
                this.setStatus('実身を開くアプリケーションが見つかりません');
                return;
            }

            // ウィンドウが開いた通知を受け取る
            const messageId = `open-${realId}-${Date.now()}`;

            // 親ウィンドウ(tadjs-desktop.js)に実身を開くよう要求
            this.messageBus.send('open-virtual-object-real', {
                virtualObj: virtualObj,
                pluginId: defaultPluginId,
                messageId: messageId
            });

            logger.debug('[EDITOR] 実身を開く:', realId, 'with', defaultPluginId);

            try {
                // ウィンドウが開いた通知を待つ（タイムアウト30秒）
                const result = await this.messageBus.waitFor('window-opened', window.LONG_OPERATION_TIMEOUT_MS, (data) => {
                    return data.messageId === messageId;
                });

                if (result.success && result.windowId) {
                    // 開いたウィンドウを追跡
                    this.openedRealObjects.set(realId, result.windowId);
                    logger.debug('[EDITOR] ウィンドウが開きました:', result.windowId, 'realId:', realId);
                    this.setStatus(`実身を${defaultPluginId}で開きました`);
                }
            } catch (error) {
                logger.error('[EDITOR] ウィンドウを開く際のエラー:', error);
                this.setStatus('実身を開くのに失敗しました');
            }
        });
    }

    // closeRealObject() は基底クラス PluginBase で定義

    /**
     * 仮身属性変更ダイアログを表示
     */
    async changeVirtualObjectAttributes() {
        await window.RealObjectSystem.changeVirtualObjectAttributes(this);
    }

    /**
     * 仮身の続柄をXMLに保存（PluginBaseフックオーバーライド）
     * @param {Object} virtualObj - 更新された仮身オブジェクト
     * @returns {Promise<void>}
     */
    async saveVirtualObjectRelationshipToXml(virtualObj) {
        if (virtualObj && virtualObj.link_id) {
            // DOM要素のdata-link-relationship属性も更新
            // （convertEditorToXML()がDOMからXMLを生成するため必要）
            const element = this.contextMenuVirtualObject?.element;
            if (element) {
                if (virtualObj.linkRelationship && virtualObj.linkRelationship.length > 0) {
                    element.setAttribute('data-link-relationship', virtualObj.linkRelationship.join(' '));
                } else if (element.hasAttribute('data-link-relationship')) {
                    element.removeAttribute('data-link-relationship');
                }
            }
            this.updateVirtualObjectInXml(virtualObj);
        }
    }

    /**
     * 続柄更新後の再描画（PluginBaseフック）
     * 仮身のDOM要素を再描画して続柄表示を更新
     * applyVirtualObjectAttributesと同じcollapseVirtualObjectパターンを使用
     * 注意: roledispは自動的に変更しない（ユーザーが明示的に仮身属性で設定するまでオフのまま）
     */
    async onRelationshipUpdated(virtualObj, result) {
        const element = this.contextMenuVirtualObject?.element;
        if (!element || !element.parentNode) return;

        // applyVirtualObjectAttributesと同様にcollapseVirtualObjectで再描画
        // これにより一貫した表示が保証される（roledispがtrueなら続柄が表示される）
        if (!element.classList.contains('expanded')) {
            // 閉じた仮身の場合、collapseVirtualObjectで再描画
            // 続柄が変更されるため、幅は再計算された値をそのまま使用
            element.classList.add('expanded');
            await this.collapseVirtualObject(element);
            // collapseVirtualObjectで計算された幅をそのまま使用
            // （続柄表示の有無に応じた正しい幅が適用される）
        }

        this.isModified = true;
    }

    /**
     * 実身名変更後の再描画（PluginBaseフック）
     * 仮身のDOM要素を再描画して属性表示（実身名、続柄、日付等）を更新
     * onRelationshipUpdatedと同じcollapseVirtualObjectパターンを使用
     */
    async onRealObjectRenamed(virtualObj, result) {
        const element = this.contextMenuVirtualObject?.element;
        if (!element || !element.parentNode) return;

        // dataset.linkNameはRealObjectSystemで更新済み
        // 閉じた仮身の場合、collapseVirtualObjectで再描画
        if (!element.classList.contains('expanded')) {
            // 実身名が変更されるため、幅は再計算された値をそのまま使用
            element.classList.add('expanded');
            await this.collapseVirtualObject(element);
            // collapseVirtualObjectで計算された幅をそのまま使用
            // （新しい実身名の長さに応じた正しい幅が適用される）
        }
        // 開いた仮身の場合はRealObjectSystemでのtextContent/dataset更新で十分
        // （タイトルバー等への反映が必要な場合は追加処理を実装）
    }

    /**
     * プラグイン内の全仮身を取得（PluginBaseオーバーライド）
     * @returns {Array<Object>} 仮身情報の配列
     */
    getAllVirtualObjects() {
        const elements = this.editor.querySelectorAll('.virtual-object');
        return Array.from(elements).map(element => ({
            virtualObj: {
                link_id: element.dataset.linkId,
                link_name: element.dataset.linkName
            },
            element: element
        }));
    }

    /**
     * 仮身の表示を更新（PluginBaseオーバーライド）
     * @param {Object} item - getAllVirtualObjectsで返された仮身情報
     */
    async updateVirtualObjectDisplay(item) {
        const { virtualObj, element } = item;
        if (!element || !element.parentNode) {
            return;
        }

        // DOM要素のdatasetを更新
        element.dataset.linkName = virtualObj.link_name;

        // 閉じた仮身の場合、collapseVirtualObjectで再描画
        if (!element.classList.contains('expanded')) {
            element.classList.add('expanded');
            await this.collapseVirtualObject(element);
        }
        // 開いた仮身の場合はタイトルバーの名前を更新
        else {
            // タイトルバー内の名前spanを正しいセレクタで取得
            // 構造: .virtual-object-titlebar > span(textSpan) > span:first-child(nameSpan)
            const nameSpan = element.querySelector('.virtual-object-titlebar > span > span:first-child');
            if (nameSpan) {
                nameSpan.textContent = virtualObj.link_name;
            }
        }
    }

    /**
     * 表示属性値をbooleanに変換するヘルパー
     * 文字列'true'/'false'とboolean両方を正しく処理
     * @param {string|boolean|undefined} value - 属性値
     * @param {boolean} defaultValue - デフォルト値
     * @returns {boolean}
     */
    parseBooleanAttr(value, defaultValue) {
        if (value === undefined || value === null) {
            return defaultValue;
        }
        if (typeof value === 'boolean') {
            return value;
        }
        // 文字列として比較
        const strValue = String(value).toLowerCase();
        if (strValue === 'true') return true;
        if (strValue === 'false') return false;
        return defaultValue;
    }

    /**
     * 仮身オブジェクトから現在の属性値を取得（element.dataset対応）
     * @param {Object} vobj - 仮身オブジェクト
     * @param {HTMLElement|null} element - DOM要素
     * @returns {Object} 現在の属性値
     */
    getVirtualObjectCurrentAttrs(vobj, element) {
        if (!element || !element.dataset) {
            // elementがない場合はデフォルト実装を使用
            return window.RealObjectSystem.buildCurrentAttrsFromVobj(vobj);
        }

        // elementのdatasetから最新の値を読み取る（vobjをフォールバック）
        // parseBooleanAttrで文字列/boolean両方を正しく処理
        const pictdispRaw = element.dataset.linkPictdisp !== undefined ? element.dataset.linkPictdisp : vobj.pictdisp;
        const namedispRaw = element.dataset.linkNamedisp !== undefined ? element.dataset.linkNamedisp : vobj.namedisp;
        const roledispRaw = element.dataset.linkRoledisp !== undefined ? element.dataset.linkRoledisp : vobj.roledisp;
        const typedispRaw = element.dataset.linkTypedisp !== undefined ? element.dataset.linkTypedisp : vobj.typedisp;
        const updatedispRaw = element.dataset.linkUpdatedisp !== undefined ? element.dataset.linkUpdatedisp : vobj.updatedisp;
        const framedispRaw = element.dataset.linkFramedisp !== undefined ? element.dataset.linkFramedisp : vobj.framedisp;
        const autoopenRaw = element.dataset.linkAutoopen !== undefined ? element.dataset.linkAutoopen : vobj.autoopen;

        const frcol = element.dataset.linkFrcol || vobj.frcol || '#000000';
        const chcol = element.dataset.linkChcol || vobj.chcol || '#000000';
        const tbcol = element.dataset.linkTbcol || vobj.tbcol || '#ffffff';
        const bgcol = element.dataset.linkBgcol || vobj.bgcol || '#ffffff';
        const chsz = element.dataset.linkChsz ? parseFloat(element.dataset.linkChsz) : (parseFloat(vobj.chsz) || 14);

        return {
            pictdisp: this.parseBooleanAttr(pictdispRaw, true),
            namedisp: this.parseBooleanAttr(namedispRaw, true),
            roledisp: this.parseBooleanAttr(roledispRaw, false),
            typedisp: this.parseBooleanAttr(typedispRaw, false),
            updatedisp: this.parseBooleanAttr(updatedispRaw, false),
            framedisp: this.parseBooleanAttr(framedispRaw, true),
            frcol: frcol,
            chcol: chcol,
            tbcol: tbcol,
            bgcol: bgcol,
            autoopen: this.parseBooleanAttr(autoopenRaw, false),
            chsz: chsz
        };
    }

    /**
     * 仮身に属性を適用
     * @param {Object} attrs - 適用する属性値
     */
    async applyVirtualObjectAttributes(attrs) {
        // contextMenuVirtualObjectからvobj, elementを取得
        if (!this.contextMenuVirtualObject) return;
        const vobj = this.contextMenuVirtualObject.virtualObj;
        const element = this.contextMenuVirtualObject.element;
        if (!vobj || !element) return;

        // datasetから現在の属性値を読み取って、vobjにマージ（link_プレフィックスの有無に対応）
        this._mergeVobjFromDataset(vobj, element);

        // PluginBaseの共通メソッドで属性を適用し、変更を取得
        const changes = this._applyVobjAttrs(vobj, attrs);

        // DOM要素に属性を適用（閉じた仮身の場合）
        if (element && element.classList.contains('virtual-object')) {
            // 基本スタイル（枠線、文字色、背景色）を適用
            this._applyVobjStyles(element, attrs);

            // 文字サイズ変更時の追加処理（閉じた仮身のサイズ調整）
            if (this._isVobjAttrChanged(changes, 'chsz')) {
                const newChsz = parseFloat(vobj.chsz);
                const chszPx = window.convertPtToPx(newChsz);
                element.style.fontSize = chszPx + 'px';

                // chsz変更時は、閉じた仮身の最低縦幅(originalHeight)を再計算
                if (!element.classList.contains('expanded')) {
                    const lineHeight = 1.2;
                    const textHeight = Math.ceil(chszPx * lineHeight);
                    const newHeight = textHeight + 8; // 閉じた仮身の高さ
                    element.dataset.originalHeight = newHeight.toString();
                    logger.debug('[EDITOR] chsz変更により originalHeight を再計算:', element.dataset.linkName, newHeight);

                    // 文字サイズに合わせて仮身の幅を再計算（アイコンとgapを含む）
                    const showPict = vobj.pictdisp !== 'false';
                    const newWidth = this._calculateCollapsedVobjWidth({
                        linkName: element.dataset.linkName || '',
                        chszPx: chszPx,
                        showPict: showPict,
                        showName: vobj.namedisp !== 'false'
                    });
                    element.style.width = newWidth + 'px';
                    element.style.minWidth = newWidth + 'px';
                    logger.debug('[EDITOR] chsz変更により仮身幅を再計算:', element.dataset.linkName, newWidth);
                }
            }

            // 閉じた仮身の場合は、dataset更新後にcollapseVirtualObjectで再描画
            // （pictdisp, namedisp等の表示属性を正しく反映させるため）
        }

        // XMLデータに反映するため、dataset属性を更新（data-link-*形式で保存）
        this._syncVobjToDataset(element, vobj);

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

        logger.debug('[EDITOR] 仮身属性を適用:', attrs, '完全なvobj:', completeVobj);

        // 展開済みの仮身の場合は再描画
        if (element && element.classList.contains('expanded')) {
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
                    logger.debug('[EDITOR] 開いた仮身のiframeに背景色変更を通知:', completeVobj.bgcol);
                }
            } else {
                // その他の属性変更がある場合は、再展開
                const currentWidth = parseFloat(element.style.width) || completeVobj.width || 150;
                const currentHeight = parseFloat(element.style.height) || completeVobj.heightPx || 120;

                // 一旦閉じてから再度開く（awaitで完了を待つ）
                await this.collapseVirtualObject(element);
                // 少し待ってから再展開（DOMの更新を待つ）
                setTimeout(() => {
                    this.expandVirtualObject(element, currentWidth, currentHeight).catch(err => {
                        logger.error('[EDITOR] エラー: 仮身の再展開に失敗しました:', {
                            error: err,
                            linkName: element.dataset.linkName,
                            linkId: element.dataset.linkId
                        });
                        this.setStatus('仮身属性変更後の再描画に失敗しました');
                        // 失敗時は再度展開を試みる
                        setTimeout(() => {
                            this.expandVirtualObject(element, currentWidth, currentHeight).catch(retryErr => {
                                logger.error('[EDITOR] リトライも失敗しました:', retryErr);
                            });
                        }, 200);
                    });
                }, 50);
            }
        } else if (element && !element.classList.contains('expanded')) {
            // 閉じた仮身の場合
            // サイズに影響する属性が変更されたかを判定
            const sizeAffecting = this._isVobjSizeAffectingAttrs(attrs);

            if (sizeAffecting) {
                // サイズ影響あり: collapseVirtualObjectで再描画
                // （pictdisp, namedispなどの表示属性を正しく反映させるため）

                // 一度expandedクラスを追加してからcollapseすることで、collapseVirtualObjectの処理を実行
                element.classList.add('expanded');
                await this.collapseVirtualObject(element);

                // サイズ影響属性変更時は collapseVirtualObject で計算された幅をそのまま使用
                // （アイコン有無、表示項目の変化に応じた正しい幅が適用される）
            }
            // サイズに影響しない属性（色など）の場合は、_applyVobjStyles で既にスタイル適用済み
            // collapseVirtualObject を呼ばないことで、幅の変動を防ぐ
        }

        this.setStatus('仮身属性を変更しました');
        this.isModified = true;
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

                    // 仮身固有の続柄（link要素のrelationship属性）
                    if (virtualObj.linkRelationship && virtualObj.linkRelationship.length > 0) {
                        linkElement.setAttribute('relationship', virtualObj.linkRelationship.join(' '));
                    } else if (linkElement.hasAttribute('relationship')) {
                        linkElement.removeAttribute('relationship');
                    }

                    // テキスト内容は書き込まない（自己閉じタグ形式）
                    // link_nameはJSONから取得する方式に統一

                    logger.debug('[EDITOR] <link>要素を更新:', virtualObj.link_id);
                    break;
                }
            }

            // XMLを文字列に戻す
            const serializer = new XMLSerializer();
            let xmlString = serializer.serializeToString(xmlDoc);
            // <link ...>テキスト</link>を<link .../>に変換（自己閉じタグ形式に統一）
            xmlString = xmlString.replace(/<link([^>]*)>[^<]*<\/link>/g, '<link$1/>');
            this.tadData = xmlString;

            // 自動保存
            this.notifyXmlDataChanged();

        } catch (error) {
            logger.error('[EDITOR] xmlTAD更新エラー:', error);
        }
    }

    // renameRealObject() は基底クラス PluginBase で定義

    /**
     * 選択中の仮身が指し示す実身を複製
     * 複製した仮身を元の仮身のすぐ後ろに挿入
     */
    async duplicateRealObject() {
        if (!this.contextMenuVirtualObject || !this.contextMenuVirtualObject.virtualObj) {
            logger.warn('[EDITOR] 選択中の仮身がありません');
            return;
        }

        const realId = this.contextMenuVirtualObject.realId;
        const originalVobj = this.contextMenuVirtualObject.virtualObj;
        const originalElement = this.contextMenuVirtualObject.element;

        const messageId = this.generateMessageId('duplicate-real');

        this.messageBus.send('duplicate-real-object', {
            realId: realId,
            messageId: messageId
        });

        try {
            // レスポンスを待つ（ユーザー入力を待つのでタイムアウト無効）
            const result = await this.messageBus.waitFor('real-object-duplicated', 0, (data) => {
                return data.messageId === messageId;
            });

            if (result.success) {
                // 新しい仮身オブジェクトを作成（元の仮身の属性を引き継ぐ）
                const newVirtualObj = {
                    link_id: result.newRealId,
                    link_name: result.newName,
                    width: originalVobj.width || 150,
                    heightPx: originalVobj.heightPx || 30,
                    chsz: originalVobj.chsz || 14,
                    frcol: originalVobj.frcol || '#000000',
                    chcol: originalVobj.chcol || '#000000',
                    tbcol: originalVobj.tbcol || '#ffffff',
                    bgcol: originalVobj.bgcol || '#ffffff',
                    dlen: 0,
                    applist: originalVobj.applist || {},
                    pictdisp: originalVobj.pictdisp || 'true',
                    namedisp: originalVobj.namedisp || 'true',
                    roledisp: originalVobj.roledisp || 'false',
                    typedisp: originalVobj.typedisp || 'false',
                    updatedisp: originalVobj.updatedisp || 'false',
                    framedisp: originalVobj.framedisp || 'true',
                    autoopen: originalVobj.autoopen || 'false'
                };

                // 元の仮身のすぐ後ろにカーソルを配置
                if (originalElement && originalElement.parentNode) {
                    const selection = window.getSelection();
                    const range = document.createRange();
                    range.setStartAfter(originalElement);
                    range.collapse(true);
                    selection.removeAllRanges();
                    selection.addRange(range);
                }

                // 新しい仮身を挿入
                this.insertVirtualObjectLink(newVirtualObj);

                // 編集状態を記録
                this.isModified = true;
                this.updateContentHeight();

                this.setStatus(`実身を複製しました: ${result.newName}`);
            }
        } catch (error) {
            logger.error('[EDITOR] 実身複製エラー:', error);
            this.setStatus('実身の複製に失敗しました');
        }
    }

    /**
     * ダブルクリック+ドラッグによる実身複製処理
     * @param {HTMLElement} vo - 元の仮身要素
     * @param {number} dropX - ドロップ位置のX座標（エディタ内座標）
     * @param {number} dropY - ドロップ位置のY座標（エディタ内座標）
     */
    async handleDoubleClickDragDuplicate(vo, dropX, dropY) {
        const realId = window.RealObjectSystem.extractRealId(vo.dataset.linkId);
        logger.debug('[EDITOR] ダブルクリック+ドラッグによる実身複製:', realId, 'ドロップ位置:', dropX, dropY);

        // 元の仮身のデータを保存
        const virtualObj = this.buildVirtualObjFromDataset(vo.dataset);

        // 先にダイアログで名前を入力してもらう
        const defaultName = (vo.dataset.linkName || '実身') + 'のコピー';
        const newName = await this.showInputDialog(
            '新しい実身の名称を入力してください',
            defaultName,
            30
        );

        // キャンセルされた場合は何もしない（showInputDialogはキャンセル時にnullを返す）
        if (!newName) {
            logger.debug('[EDITOR] 実身複製がキャンセルされました');
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
                logger.debug('[EDITOR] 実身複製がキャンセルされました');
            } else if (result.success) {
                // 複製成功: 新しい実身IDで仮身を作成
                const newRealId = result.newRealId;
                const newName = result.newName;
                logger.debug('[EDITOR] 実身複製成功:', realId, '->', newRealId, '名前:', newName);

                // 新しい仮身オブジェクトを作成（元の仮身の属性を引き継ぐ）
                const newVirtualObj = {
                    link_id: `${newRealId}_0.xtad`,
                    link_name: newName,
                    width: virtualObj.width || 150,
                    heightPx: virtualObj.heightPx || 30,
                    chsz: virtualObj.chsz || 14,
                    frcol: virtualObj.frcol || '#000000',
                    chcol: virtualObj.chcol || '#000000',
                    tbcol: virtualObj.tbcol || '#ffffff',
                    bgcol: virtualObj.bgcol || '#ffffff',
                    dlen: 0,
                    applist: virtualObj.applist || {},
                    pictdisp: virtualObj.pictdisp || 'true',
                    namedisp: virtualObj.namedisp || 'true',
                    roledisp: virtualObj.roledisp || 'false',
                    typedisp: virtualObj.typedisp || 'false',
                    updatedisp: virtualObj.updatedisp || 'false',
                    framedisp: virtualObj.framedisp || 'true',
                    autoopen: virtualObj.autoopen || 'false'
                };

                // ドロップ位置に新しい仮身を挿入
                const selection = window.getSelection();
                const editorRect = this.editor.getBoundingClientRect();

                // スクロールを考慮したクライアント座標を計算
                const clientX = dropX - this.editor.scrollLeft + editorRect.left;
                const clientY = dropY - this.editor.scrollTop + editorRect.top;

                // 座標からカーソル位置を取得（ブラウザ互換性のため両方試す）
                let range = null;
                if (document.caretRangeFromPoint) {
                    range = document.caretRangeFromPoint(clientX, clientY);
                } else if (document.caretPositionFromPoint) {
                    const position = document.caretPositionFromPoint(clientX, clientY);
                    if (position) {
                        range = document.createRange();
                        range.setStart(position.offsetNode, position.offset);
                    }
                }

                // rangeが取得できない、またはエディタ外の場合は、エディタの最後に配置
                if (!range || !this.editor.contains(range.startContainer)) {
                    range = document.createRange();
                    range.selectNodeContents(this.editor);
                    range.collapse(false);
                    logger.debug('[EDITOR] ドロップ位置が不正、エディタの最後に配置');
                } else {
                    logger.debug('[EDITOR] ドロップ位置にカーソルを設定:', dropX, dropY);
                }

                selection.removeAllRanges();
                selection.addRange(range);

                // 新しい仮身を挿入
                this.insertVirtualObjectLink(newVirtualObj);

                // 編集状態を記録
                this.isModified = true;
                this.updateContentHeight();
            } else {
                logger.error('[EDITOR] 実身複製失敗:', result.error);
            }
        } catch (error) {
            logger.error('[EDITOR] 実身複製エラー:', error);
        }
    }

    /**
     * 屑実身操作ウィンドウを開く
     */
    openTrashRealObjects() {
        window.RealObjectSystem.openTrashRealObjects(this);
    }

    /**
     * 仮身ネットワークウィンドウを開く
     */
    openVirtualObjectNetwork() {
        if (!this.contextMenuVirtualObject) {
            logger.warn('[EDITOR] 仮身が選択されていません');
            this.setStatus('仮身を選択してください');
            return;
        }

        // 実身IDを取得
        const realId = this.contextMenuVirtualObject.realId;
        if (!realId) {
            logger.warn('[EDITOR] 実身IDが取得できません');
            this.setStatus('実身IDが取得できません');
            return;
        }

        window.RealObjectSystem.openVirtualObjectNetwork(this, realId);
    }

    /**
     * 実身/仮身検索ウィンドウを開く
     */
    openRealObjectSearch() {
        window.RealObjectSystem.openRealObjectSearch(this);
    }

    /**
     * ウィンドウが閉じたことを処理
     */
    handleWindowClosed(windowId, fileData) {
        // fileDataから実身IDを取得
        if (fileData && fileData.realId) {
            const realId = fileData.realId;

            // openedRealObjectsから削除
            if (this.openedRealObjects.has(realId)) {
                this.openedRealObjects.delete(realId);
                logger.debug('[EDITOR] 実身の追跡を削除:', realId);
            }
        }

        // windowIdで検索して削除
        for (const [realId, wId] of this.openedRealObjects.entries()) {
            if (wId === windowId) {
                this.openedRealObjects.delete(realId);
                logger.debug('[EDITOR] windowIdから実身の追跡を削除:', realId, windowId);
                break;
            }
        }
    }

    /**
     * デバッグログ出力（デバッグモード時のみ）
     */
    log(...args) {
        if (this.debug) {
            logger.debug('[EDITOR]', ...args);
        }
    }

    /**
     * エラーログ出力（常に出力）
     */
    error(...args) {
        logger.error('[EDITOR]', ...args);
    }

    /**
     * 警告ログ出力（常に出力）
     */
    warn(...args) {
        logger.warn('[EDITOR]', ...args);
    }

    /**
     * 元の仮身オブジェクトを削除するフック（PluginBase共通機能）
     * cross-window-drop-successでmoveモード時に呼ばれる
     */
    onDeleteSourceVirtualObject(data) {
        if (!this.draggingVirtualObject) return;

        // エディタから仮身を削除（draggingVirtualObjectはDOM要素）
        if (this.draggingVirtualObject.parentNode) {
            this.draggingVirtualObject.remove();
        }

        this.isModified = true;
        this.updateContentHeight();
    }

    /**
     * cross-window-drop-success処理完了後のフック（PluginBase共通機能）
     * ドラッグ状態のクリーンアップ後に呼ばれる
     */
    onCrossWindowDropSuccess(data) {
        // クロスウィンドウドロップ成功フラグを立てる（dragendでの重複削除を防ぐため）
        this.crossWindowDropSuccess = true;

        // ドラッグ状態をクリア
        this.isDraggingVirtualObject = false;
        this.draggingVirtualObject = null;
        this.draggingVirtualObjectData = null;

        if (data.mode === 'copy') {
            // コピーモードの場合は元の仮身の透明度を元に戻す
            logger.debug('[EDITOR] コピーモードでクロスウィンドウドロップ: 元の仮身を保持');
            // 注: draggingVirtualObjectは既にクリアされているので、
            // 透明度の復元はdragendハンドラで処理される
        }
    }

    /**
     * 用紙枠表示オンオフ
     */
    togglePaperFrame() {
        this.paperFrameVisible = !this.paperFrameVisible;
        this.updatePageBreakVisibility();
        this.setStatus(`用紙枠: ${this.paperFrameVisible ? '表示' : '非表示'}`);
    }

    /**
     * ページ区切り線の表示/非表示を更新
     * 用紙枠表示がオンの場合、用紙サイズに基づいて自動的にページ区切り線を表示
     */
    updatePageBreakVisibility() {
        // 既存の自動ページ区切りを削除
        const existingAutoBreaks = this.editor.querySelectorAll('.auto-page-break');
        existingAutoBreaks.forEach(pb => pb.remove());

        // 手動で挿入した改ページの表示更新
        const manualPageBreaks = this.editor.querySelectorAll('.page-break');
        manualPageBreaks.forEach(pb => {
            if (this.paperFrameVisible) {
                pb.classList.add('page-break-visible');
            } else {
                pb.classList.remove('page-break-visible');
            }
        });

        // 用紙枠表示がオフなら終了
        if (!this.paperFrameVisible) {
            return;
        }

        // PaperSizeが未初期化なら初期化
        if (!this.paperSize) {
            this.initPaperSize();
        }

        // 本文領域の高さを計算（用紙高さ - 上余白 - 下余白）mm単位
        const contentHeightMm = this.paperSize.lengthMm - this.paperSize.topMm - this.paperSize.bottomMm;

        // mm から px に変換（96dpi基準: 1mm ≈ 3.78px）
        const mmToPx = 3.78;
        const pageHeightPx = contentHeightMm * mmToPx;

        if (pageHeightPx <= 0) {
            return;
        }

        // エディタ内のコンテンツ高さを取得
        const editorRect = this.editor.getBoundingClientRect();
        const editorScrollHeight = this.editor.scrollHeight;

        // ページ数を計算
        const totalPages = Math.ceil(editorScrollHeight / pageHeightPx);

        if (totalPages <= 1) {
            return; // 1ページ以下なら区切り線不要
        }

        // 各段落の位置を取得してページ区切り位置を決定
        const paragraphs = this.editor.querySelectorAll('p');
        let lastInsertedPosition = 0;

        for (let pageNum = 1; pageNum < totalPages; pageNum++) {
            const targetPosition = pageHeightPx * pageNum;

            // targetPositionに最も近い段落の後にページ区切りを挿入
            let insertAfterElement = null;
            let closestDistance = Infinity;

            paragraphs.forEach(p => {
                const pRect = p.getBoundingClientRect();
                const pBottom = pRect.bottom - editorRect.top + this.editor.scrollTop;

                // targetPositionより前で、最も近い段落を探す
                if (pBottom <= targetPosition && pBottom > lastInsertedPosition) {
                    const distance = targetPosition - pBottom;
                    if (distance < closestDistance) {
                        closestDistance = distance;
                        insertAfterElement = p;
                    }
                }
            });

            if (insertAfterElement) {
                // 自動ページ区切り要素を作成
                const autoPageBreak = document.createElement('div');
                autoPageBreak.className = 'auto-page-break';
                autoPageBreak.setAttribute('data-page', pageNum);

                // 段落の後に挿入
                insertAfterElement.parentNode.insertBefore(autoPageBreak, insertAfterElement.nextSibling);

                lastInsertedPosition = insertAfterElement.getBoundingClientRect().bottom - editorRect.top + this.editor.scrollTop;
            }
        }

        logger.debug(`[EDITOR] 自動ページ区切り: ${totalPages - 1}箇所に挿入 (ページ高さ: ${pageHeightPx.toFixed(0)}px)`);
    }

    /**
     * 用紙設定ダイアログを表示
     */
    async showPageSetup() {
        // PaperSizeが未初期化なら初期化
        if (!this.paperSize) {
            this.initPaperSize();
            this.paperSize.widthMm = window.pointsToMm(this.paperWidth);
            this.paperSize.lengthMm = window.pointsToMm(this.paperHeight);
        }

        // 用紙サイズ選択肢を生成
        const paperOptions = this.getPaperSizeOptions();
        const currentSizeName = this.paperSize.getSizeName() || 'CUSTOM';

        let paperOptionsHtml = '';
        let lastGroup = '';
        paperOptions.forEach(opt => {
            // グループ分け（A判、B判、その他）
            const group = opt.key.charAt(0);
            if (group !== lastGroup && (group === 'A' || group === 'B' || group === 'L')) {
                if (lastGroup) {
                    paperOptionsHtml += '<option disabled>──────────</option>';
                }
                lastGroup = group;
            }
            const selected = opt.key === currentSizeName ? 'selected' : '';
            paperOptionsHtml += `<option value="${opt.key}" ${selected}>${opt.label}</option>`;
        });
        paperOptionsHtml += '<option disabled>──────────</option>';
        paperOptionsHtml += `<option value="CUSTOM" ${currentSizeName === 'CUSTOM' ? 'selected' : ''}>カスタム</option>`;

        // 現在の値（0.01mm精度で丸めて誤差蓄積を軽減）
        const curWidth = Math.round(this.paperSize.widthMm * 100) / 100;
        const curHeight = Math.round(this.paperSize.lengthMm * 100) / 100;
        const curTopMm = Math.round(this.paperSize.topMm * 100) / 100;
        const curBottomMm = Math.round(this.paperSize.bottomMm * 100) / 100;
        const curLeftMm = Math.round(this.paperSize.leftMm * 100) / 100;
        const curRightMm = Math.round(this.paperSize.rightMm * 100) / 100;
        const curImposition = this.paperSize.imposition;

        const dialogHtml = `
            <style>
                /* 親ダイアログの既定入力欄を非表示 */
                #dialog-input-field {
                    display: none !important;
                }
                /* 親ダイアログのパディング/マージンを上書き */
                #input-dialog-message:has(.paper-setup-dialog) {
                    margin-bottom: 2px;
                    padding: 2px;
                }
                #input-dialog:has(.paper-setup-dialog) {
                    padding: 4px;
                }
                #input-dialog:has(.paper-setup-dialog) .dialog-buttons {
                    padding: 2px;
                    margin-top: 0px;
                }
                .paper-setup-dialog {
                    font-family: sans-serif;
                    font-size: 11px;
                    padding: 0;
                }
                .paper-setup-dialog .form-row {
                    display: flex;
                    align-items: center;
                    margin-bottom: 2px;
                }
                .paper-setup-dialog .form-row:last-child {
                    margin-bottom: 0;
                }
                .paper-setup-dialog .form-label {
                    width: 40px;
                    font-weight: normal;
                }
                .paper-setup-dialog .form-input {
                    width: 70px;
                    padding: 2px 4px;
                    border: 1px inset #c0c0c0;
                    font-size: 11px;
                }
                .paper-setup-dialog .form-select {
                    width: 200px;
                    padding: 2px 4px;
                    border: 1px inset #c0c0c0;
                    font-size: 11px;
                }
                .paper-setup-dialog .form-unit {
                    margin-left: 4px;
                    color: #666;
                }
                .paper-setup-dialog .margin-group {
                    margin-left: 10px;
                }
                .paper-setup-dialog .margin-row {
                    display: flex;
                    align-items: center;
                    margin-bottom: 1px;
                }
                .paper-setup-dialog .margin-row:last-child {
                    margin-bottom: 0;
                }
                .paper-setup-dialog .margin-label {
                    width: 20px;
                }
                .paper-setup-dialog .margin-input {
                    width: 50px;
                    padding: 2px 4px;
                    border: 1px inset #c0c0c0;
                    margin-right: 8px;
                    font-size: 11px;
                }
            </style>
            <div class="paper-setup-dialog">
                <div class="form-row">
                    <span class="form-label">用紙:</span>
                    <select id="paperSizeSelect" class="form-select">
                        ${paperOptionsHtml}
                    </select>
                </div>
                <div class="form-row">
                    <span class="form-label">横:</span>
                    <input type="number" id="paperWidth" class="form-input" value="${curWidth}" min="10" max="2000" step="0.1">
                    <span class="form-unit">mm</span>
                    <span style="margin-left: 12px;" class="form-label">縦:</span>
                    <input type="number" id="paperHeight" class="form-input" value="${curHeight}" min="10" max="2000" step="0.1">
                    <span class="form-unit">mm</span>
                </div>
                <div class="form-row">
                    <span class="form-label">余白:</span>
                    <div class="margin-group">
                        <div class="margin-row">
                            <span class="margin-label">上:</span>
                            <input type="number" id="marginTop" class="margin-input" value="${curTopMm}" min="0" max="500" step="0.1">
                            <span class="form-unit">mm</span>
                            <span class="margin-label" style="margin-left: 8px;">左:</span>
                            <input type="number" id="marginLeft" class="margin-input" value="${curLeftMm}" min="0" max="500" step="0.1">
                            <span class="form-unit">mm</span>
                        </div>
                        <div class="margin-row">
                            <span class="margin-label">下:</span>
                            <input type="number" id="marginBottom" class="margin-input" value="${curBottomMm}" min="0" max="500" step="0.1">
                            <span class="form-unit">mm</span>
                            <span class="margin-label" style="margin-left: 8px;">右:</span>
                            <input type="number" id="marginRight" class="margin-input" value="${curRightMm}" min="0" max="500" step="0.1">
                            <span class="form-unit">mm</span>
                        </div>
                    </div>
                </div>
                <div class="form-row">
                    <span class="form-label">割付:</span>
                    <div class="radio-group-inline">
                        <label class="radio-label">
                            <input type="radio" name="imposition" value="0" ${curImposition === 0 ? 'checked' : ''}>
                            <span class="radio-indicator"></span>
                            <span>片面</span>
                        </label>
                        <label class="radio-label">
                            <input type="radio" name="imposition" value="1" ${curImposition === 1 ? 'checked' : ''}>
                            <span class="radio-indicator"></span>
                            <span>見開き</span>
                        </label>
                    </div>
                </div>
            </div>
            <script>
                (function() {
                    const paperSelect = document.getElementById('paperSizeSelect');
                    const widthInput = document.getElementById('paperWidth');
                    const heightInput = document.getElementById('paperHeight');
                    const sizes = ${JSON.stringify(Object.fromEntries(paperOptions.map(o => [o.key, {w: o.widthMm, h: o.lengthMm}])))};

                    // 用紙サイズ選択時に寸法を更新
                    paperSelect.addEventListener('change', function() {
                        const selected = this.value;
                        if (sizes[selected]) {
                            widthInput.value = sizes[selected].w;
                            heightInput.value = sizes[selected].h;
                        }
                    });

                    // 寸法変更時にカスタムに切り替え
                    widthInput.addEventListener('input', function() {
                        paperSelect.value = 'CUSTOM';
                    });
                    heightInput.addEventListener('input', function() {
                        paperSelect.value = 'CUSTOM';
                    });
                })();
            </script>
        `;

        const result = await this.showCustomDialog({
            title: '用紙設定',
            dialogHtml: dialogHtml,
            buttons: [
                { label: '取消', value: 'cancel' },
                { label: '標準設定', value: 'default' },
                { label: '設定', value: 'ok' }
            ],
            defaultButton: 2,
            width: 400
        });

        if (!result) {
            return false;
        }

        if (result.button === 'default') {
            // 標準設定（A4）にリセット
            this.paperSize.resetToDefault();
            this.paperWidth = this.paperSize.width;
            this.paperHeight = this.paperSize.length;
            this.isModified = true;
            this.setStatus('用紙設定を標準（A4）にリセットしました');
            return true;
        } else if (result.button === 'ok') {
            // 設定を適用
            const formData = result.formData || {};

            const width = parseFloat(formData.paperWidth) || window.pointsToMm(this.paperWidth);
            const height = parseFloat(formData.paperHeight) || window.pointsToMm(this.paperHeight);
            const marginTop = parseFloat(formData.marginTop) || 0;
            const marginBottom = parseFloat(formData.marginBottom) || 0;
            const marginLeft = parseFloat(formData.marginLeft) || 0;
            const marginRight = parseFloat(formData.marginRight) || 0;
            const imposition = parseInt(formData.imposition) || 0;

            // PaperSizeに設定
            this.paperSize.widthMm = width;
            this.paperSize.lengthMm = height;
            this.paperSize.topMm = marginTop;
            this.paperSize.bottomMm = marginBottom;
            this.paperSize.leftMm = marginLeft;
            this.paperSize.rightMm = marginRight;
            this.paperSize.imposition = imposition;

            // ポイント単位でも更新
            this.paperWidth = this.paperSize.width;
            this.paperHeight = this.paperSize.length;

            this.isModified = true;
            this.setStatus(`用紙設定を ${width}×${height}mm に更新しました`);
            return true;
        }

        return false;
    }

    // loadDataFileFromParent() および loadVirtualObjectMetadata() は
    // PluginBase から継承（js/plugin-base.js）

    // ========================================
    // 条件付き改ページ関連メソッド
    // ========================================

    /**
     * <document>要素からdocScale/text設定をパース
     * @param {Element} documentElement - document要素
     */
    parseDocumentElement(documentElement) {
        if (!documentElement) return;

        // <docScale>子要素からスケール単位を取得（PluginBase共通メソッド使用）
        this.docScale = this.parseDocumentUnits(documentElement);

        // <text>子要素から言語・背景パターンを取得（PluginBase共通メソッド使用）
        this.docText = this.parseDocumentText(documentElement);

        // 後方互換: this.docUnitsを同期（pagebreak等で使用）
        this.docUnits = {
            h_unit: this.docScale.hunit,
            v_unit: this.docScale.vunit
        };

        logger.debug(`[EDITOR] 座標単位: hunit=${this.docScale.hunit}, vunit=${this.docScale.vunit}`);
        logger.debug(`[EDITOR] テキスト設定: lang=${this.docText.lang}, bpat=${this.docText.bpat}`);
    }

    /**
     * ページ追跡を初期化
     */
    initPageTracker() {
        if (!this.paperSize) {
            this.pageTracker = {
                currentPage: 1,
                remainingHeight: 0,
                pageHeight: 0,
                textDirection: 'horizontal'
            };
            return;
        }

        // 本文領域の高さを計算（ポイント単位）
        const marginTop = this.paperMargin?.top || 0;
        const marginBottom = this.paperMargin?.bottom || 0;
        const pageHeight = this.paperSize.length - marginTop - marginBottom;

        this.pageTracker = {
            currentPage: 1,
            remainingHeight: pageHeight,
            pageHeight: pageHeight,
            textDirection: 'horizontal'
        };

        logger.debug(`[EDITOR] ページ追跡初期化: pageHeight=${pageHeight}pt`);
    }

    /**
     * UNITS単位の値をポイントに変換
     * @param {number} value - UNITS単位での値
     * @param {number} unit - UNITS型の値
     * @returns {number} ポイント単位の値
     */
    unitsToPoints(value, unit) {
        if (unit === 0) {
            // 継承 - デフォルト72DPI（1unit = 1point）
            return value;
        } else if (unit < 0) {
            // 負: DPIベース
            const dpi = -unit;
            return value * 72 / dpi;
        } else {
            // 正: dots per cm
            return value * 720 / (unit * 25.4);
        }
    }

    /**
     * SCALE型の値を解釈してポイント単位で返す
     * @param {number} scaleValue - SCALE型の16ビット値
     * @returns {number} ポイント単位の値
     */
    parseScaleValue(scaleValue) {
        // 用紙設定がない場合は0を返す
        if (!this.paperSize) {
            return 0;
        }

        const msb = (scaleValue >> 15) & 1;

        if (msb === 1) {
            // 絶対指定: v_unit単位での値
            const value = scaleValue & 0x7FFF;
            return this.unitsToPoints(value, this.docUnits.v_unit);
        } else {
            // 比率指定: A/B
            const a = (scaleValue >> 8) & 0x7F;
            const b = scaleValue & 0xFF;
            const ratio = b === 0 ? 1 : a / b;

            // 基準値は用紙の長さ（横書き前提）
            const baseValue = this.paperSize.length;
            return baseValue * ratio;
        }
    }

    /**
     * 条件付き改ページの条件を評価
     * @param {number} cond - 改ページ条件（0, 1, 2）
     * @param {number} remain - 残り領域の閾値（SCALE型）
     * @returns {boolean} 改ページを実行すべきかどうか
     */
    evaluatePageBreakCondition(cond, remain) {
        // 用紙設定がない場合は常にfalse
        if (!this.paperSize) {
            return false;
        }

        switch (cond) {
            case 0:
                // 現在のページが偶数の場合、改ページ
                return this.pageTracker.currentPage % 2 === 0;

            case 1:
                // 現在のページが奇数の場合、改ページ
                return this.pageTracker.currentPage % 2 === 1;

            case 2:
                // 残り領域がremain以下の場合、改ページ
                const threshold = this.parseScaleValue(remain);
                return this.pageTracker.remainingHeight <= threshold;

            default:
                // 不明な条件は無視
                return false;
        }
    }

    /**
     * <pagebreak>要素を処理してDOM要素を生成
     * @param {Element} pagebreakElement - pagebreak要素
     * @returns {HTMLElement|null} 生成されたDOM要素、または条件不成立時はnull
     */
    parsePageBreakElement(pagebreakElement) {
        // 用紙設定がない場合は無視
        if (!this.paperSize) {
            return null;
        }

        const cond = parseInt(pagebreakElement.getAttribute('cond'), 10) || 0;
        const remain = parseInt(pagebreakElement.getAttribute('remain'), 10) || 0;

        // 条件を評価
        const triggered = this.evaluatePageBreakCondition(cond, remain);

        // 条件付き改ページ要素を作成
        const pageBreakDiv = document.createElement('div');
        pageBreakDiv.className = 'conditional-page-break';
        pageBreakDiv.setAttribute('data-cond', cond);
        pageBreakDiv.setAttribute('data-remain', remain);
        pageBreakDiv.setAttribute('data-triggered', triggered ? 'true' : 'false');

        if (triggered) {
            // 条件が成立した場合、ページ区切り表示
            pageBreakDiv.classList.add('triggered');
            if (this.paperFrameVisible) {
                pageBreakDiv.classList.add('page-break-visible');
            }
            // ページ追跡を更新
            this.pageTracker.currentPage++;
            this.pageTracker.remainingHeight = this.pageTracker.pageHeight;
        }

        return pageBreakDiv;
    }

    /**
     * 条件付き改ページ要素からXMLを生成
     * @param {HTMLElement} element - 条件付き改ページ要素
     * @returns {string} XML文字列
     */
    serializePageBreakElement(element) {
        const cond = element.getAttribute('data-cond') || '0';
        const remain = element.getAttribute('data-remain') || '0';
        return `<pagebreak cond="${cond}" remain="${remain}" />`;
    }

}

// BasicTextEditorクラスをグローバルに公開（継承用）
window.BasicTextEditor = BasicTextEditor;

// エディタを初期化（basic-text-editorプラグインの場合のみ）
document.addEventListener('DOMContentLoaded', () => {
    // スライドプラグインなど継承先では自前でインスタンス化するため、
    // basic-text-editorプラグインの場合のみインスタンス化
    const isBasicTextEditor = document.body.getAttribute('data-plugin-id') === 'basic-text-editor' ||
                              !document.body.hasAttribute('data-plugin-id');
    if (isBasicTextEditor) {
        window.editor = new BasicTextEditor();
    }
});
