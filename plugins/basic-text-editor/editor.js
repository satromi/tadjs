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

class BasicTextEditor extends
    window.TextTadParserMixin(
    window.TextXmlSerializerMixin(
    window.TextVirtualObjectMixin(
    window.PluginBase))) {
    constructor() {
        // 基底クラスのコンストラクタを呼び出し
        super('BasicTextEditor');

        this.editor = document.getElementById('editor');
        this.currentFile = null;
        this.tadData = null;
        // isFullscreenはPluginBaseで初期化・管理される
        this.wrapMode = true;
        this.viewMode = 'formatted'; // 'formatted' | 'detailed' | 'xml' (「原稿モード」は xml 直接表示)
        // this.realId は基底クラスで定義済み
        this.isModified = false; // 編集状態フラグ
        this.originalContent = ''; // 保存時の内容
        this.updateHeightTimer = null; // スクロールバー更新のデバウンスタイマー
        this.mutationObserver = null; // MutationObserverインスタンス
        this.suppressMutationObserverCount = 0; // MutationObserver一時停止カウンタ（ネスト対応）
        this.decorationManager = null; // 詳細モード装飾オーバーレイマネージャ
        this._overlayElement = null;   // オーバーレイ div への参照 (renderTADXML 後の再アタッチ用)
        this.selectedImage = null; // 選択中の画像要素
        this.selectedFigureSegment = null; // 選択中の図形セグメント要素
        this.figureSegmentClipboard = null; // ローカル図形セグメントクリップボード
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

    // ---- 選択範囲ヘルパー ----

    /**
     * 現在の選択範囲を取得する
     * @returns {{ selection: Selection, range: Range } | null} 選択範囲がなければnull
     */
    _getSelectionRange() {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return null;
        return { selection, range: selection.getRangeAt(0) };
    }

    /**
     * 選択範囲を設定する
     * @param {Range} range - 設定するRange
     */
    _setSelectionRange(range) {
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
    }

    /**
     * 編集済みフラグを立てる
     */
    _markModified() {
        this.isModified = true;
    }

    /**
     * MessageBusのハンドラを登録
     * 親ウィンドウからのメッセージを受信して処理
     */
    setupMessageBusHandlers() {
        // init メッセージ
        this.messageBus.on('init', async (data) => {
            // 共通初期化処理（windowId設定、realId設定、背景色復元）
            this.handleInitData(data);

            if (data.fileData) {
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
            }

            // 折り返し設定を loadFile 前に確定 (text-tad-parser.js が this.wrapMode を参照するため)
            // wrapMode=true の場合、 paperWidth より windowConfig.width を優先 (applyWidth: true)
            this.applyWordWrapConfig(data.fileData?.windowConfig, {
                applyWidth: true,
                paragraphUpdateDelay: 200
            });

            // 表示モード (viewMode) を永続化された値から復元
            const savedViewMode = data.fileData?.windowConfig?.viewMode;
            if (savedViewMode === 'detailed' || savedViewMode === 'xml' || savedViewMode === 'formatted') {
                this.viewMode = savedViewMode;
            }

            await this.loadFile(data.fileData);

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
                if (virtualObj?.link_id) {
                    this.realId = this.extractRealId(virtualObj.link_id);
                }

                // 管理用セグメントJSONのwindowから取得（複数のパスに対応）
                // realObject.metadata.window (旧形式) / realObject.window (新形式: 実身JSONルート直下) / realObject.records[0].window のいずれか
                const windowConfig = realObject.metadata?.window
                    || realObject.window
                    || realObject.records?.[0]?.window
                    || null;

                // 折り返し設定と viewMode を loadFile 前に確定 (text-tad-parser が wrapMode を参照するため、 loadFile 内で viewMode に応じた切替が行われるため)
                this.applyWordWrapConfig(windowConfig, {
                    applyWidth: true,
                    paragraphUpdateDelay: 100
                });
                const savedViewMode = windowConfig?.viewMode;
                if (savedViewMode === 'detailed' || savedViewMode === 'xml' || savedViewMode === 'formatted') {
                    this.viewMode = savedViewMode;
                }

                // データを読み込む（完了を待つ）
                await this.loadFile({
                    realId: this.realId,
                    xmlData: realObject.xtad || realObject.records?.[0]?.xtad || realObject.xmlData
                });

                // スクロール位置を復元（DOM更新完了を待つ）
                // data.scrollPos（仮身ごとの設定）を優先、フォールバックとしてwindowConfig.scrollPos
                const scrollPos = data.scrollPos || (windowConfig && windowConfig.scrollPos);
                if (scrollPos && (scrollPos.x || scrollPos.y)) {
                    // 複数のrequestAnimationFrameで確実にDOMレンダリング完了を待つ
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            // .plugin-contentにスクロール位置を設定
                            // （noScrollbar時はeditorにoverflow:hiddenが設定されるが、
                            //   editorにはmax-heightがないため全高に拡張されscrollTopが効かない。
                            //   .plugin-contentは固定サイズなのでscrollTopが機能する）
                            const pluginContent = document.querySelector('.plugin-content');
                            if (pluginContent) {
                                pluginContent.scrollLeft = scrollPos.x || 0;
                                pluginContent.scrollTop = scrollPos.y || 0;
                            }
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
        });

        // 共通MessageBusハンドラを登録（PluginBaseで定義）
        // window-moved, window-resized-end, window-maximize-toggled,
        // menu-action, get-menu-definition, window-close-request
        this.setupCommonMessageBusHandlers();

        // update-vobj-scroll メッセージ（ウィンドウ閉じた時の仮身スクロール位置更新）
        this.messageBus.on('update-vobj-scroll', async (data) => {
            if (!data.vobjid) return;
            try {
                // DOM上の仮身要素からvobjidで検索（this.tadDataは古いxtadでvobjidがない場合があるためDOMを使用）
                const vobjElements = this.editor.querySelectorAll('.virtual-object');
                let found = false;
                for (const vo of vobjElements) {
                    if (vo.dataset.linkVobjid === data.vobjid) {
                        // DOM上のdata属性を更新 (シリアライザはこれらを <link> タグの属性として出力する)
                        if (data.scrollx !== undefined) vo.dataset.linkScrollx = data.scrollx.toString();
                        if (data.scrolly !== undefined) vo.dataset.linkScrolly = data.scrolly.toString();
                        if (data.zoomratio !== undefined) vo.dataset.linkZoomratio = data.zoomratio.toString();
                        if (data.viewMode !== undefined) vo.dataset.linkViewmode = data.viewMode;
                        if (data.wordWrap !== undefined) vo.dataset.linkWordwrap = data.wordWrap.toString();
                        found = true;
                        break;
                    }
                }
                if (found) {
                    // セーフティネット: 仮身データ破壊 (linkId 欠落) を検知した場合は自動保存を抑制
                    const damagedVobjs = this.editor.querySelectorAll('.virtual-object:not([data-link-id])').length;
                    if (damagedVobjs > 0) {
                        logger.error(`[EDITOR] update-vobj-scroll: linkId 欠落の仮身 ${damagedVobjs} 個を検知、 自動保存を抑制`);
                        this.isModified = true;
                        return;
                    }
                    // DOMからxtadを再生成して保存 (notifyXmlDataChanged 内でも link 数チェックあり)
                    const xmlData = await this.convertEditorToXML();
                    if (xmlData) {
                        this.tadData = xmlData;
                        this.notifyXmlDataChanged();
                    }
                }
            } catch (error) {
                logger.error('[EDITOR] update-vobj-scroll処理エラー:', error);
            }
        });

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

        // 開いた仮身内プラグインとのメッセージ転送（PluginBase共通メソッド）
        this.setupChildIframeMessageForwarding({
            forwardToParent: ['load-image-file', 'get-image-file-path'],
            forwardToChildren: ['load-image-response', 'save-image-response', 'image-file-path-response']
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

        // 改ページ要素 (.page-break / .conditional-page-break) の Backspace/Delete 削除
        this.editor.addEventListener('keydown', (e) => {
            if (e.key !== 'Backspace' && e.key !== 'Delete') return;
            const sel = window.getSelection();
            if (sel.rangeCount === 0) return;
            const range = sel.getRangeAt(0);
            if (!range.collapsed) return;

            const container = range.startContainer;
            const offset = range.startOffset;
            let target = null;

            if (e.key === 'Backspace') {
                if (container.nodeType === Node.TEXT_NODE && offset === 0) {
                    target = container.previousSibling;
                } else if (container.nodeType === Node.ELEMENT_NODE && offset > 0) {
                    target = container.childNodes[offset - 1];
                }
            } else if (e.key === 'Delete') {
                if (container.nodeType === Node.TEXT_NODE && offset === container.textContent.length) {
                    target = container.nextSibling;
                } else if (container.nodeType === Node.ELEMENT_NODE && offset < container.childNodes.length) {
                    target = container.childNodes[offset];
                }
            }

            if (target && target.nodeType === Node.ELEMENT_NODE && target.classList &&
                (target.classList.contains('page-break') || target.classList.contains('conditional-page-break'))) {
                target.remove();
                e.preventDefault();
                this.isModified = true;
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
            // セーフティネット: 想定外経路で素の <p> が追加された場合、 直前段落から CSS を継承
            // (個別経路は inheritParagraphStyle で対応済み、 これは漏れた経路への保険)
            mutations.forEach(mutation => {
                if (mutation.addedNodes) {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'P'
                            && !node.getAttribute('style') && !node.getAttribute('data-tab-format')) {
                            // 素の <p> (style 未設定 + data-tab-format 未設定) のみ対象
                            const prev = node.previousElementSibling;
                            if (prev && prev.tagName === 'P' && this.inheritParagraphStyle) {
                                this.inheritParagraphStyle(prev, node);
                            }
                        }
                    });
                }
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
            subtree: true
            // characterData は不要（画像削除検知は childList のみで完結）
        });

        // クリックイベントで親ウィンドウのコンテキストメニューを閉じる
        document.addEventListener('click', (e) => {
            // 親ウィンドウにメニューを閉じる要求を送信
            this.messageBus.send('close-context-menu');

            // 図形セグメントのクリック処理
            const figureSegment = e.target.closest('.figure-segment');
            if (figureSegment) {
                e.preventDefault();
                e.stopPropagation();
                this.selectFigureSegment(figureSegment);
                return;
            }

            // 画像のクリック処理
            if (e.target.tagName === 'IMG') {
                e.preventDefault();
                e.stopPropagation();
                this.selectImage(e.target);
            } else {
                // 画像・図形セグメント以外をクリックした場合は選択解除
                this.deselectImage();
                this.deselectFigureSegment();
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

        // 詳細モード装飾オーバーレイの初期化
        this._initDecorationOverlay();
    }

    _initDecorationOverlay() {
        if (!window.DecorationManager || !window.ParagraphMarkRenderer || !window.BrMarkRenderer) {
            return;
        }
        const overlay = document.createElement('div');
        overlay.className = 'decoration-overlay';
        overlay.setAttribute('contenteditable', 'false');
        this.editor.appendChild(overlay);
        this._overlayElement = overlay;
        this.decorationManager = new window.DecorationManager(this.editor, overlay);
        this.decorationManager.registerRenderer(new window.ParagraphMarkRenderer());
        this.decorationManager.registerRenderer(new window.BrMarkRenderer());
        if (window.IndentMarkRenderer) {
            this.decorationManager.registerRenderer(new window.IndentMarkRenderer());
        }
        if (this.viewMode === 'detailed') {
            this.decorationManager.enable();
        }
    }

    _refreshDecorationOverlay() {
        if (!this.decorationManager || !this._overlayElement) return;
        if (this._overlayElement.parentNode !== this.editor) {
            this.editor.appendChild(this._overlayElement);
        }
        // viewMode は呼出元 (viewDetailedMode 等) が renderTADXML の後で更新するため、
        // DOM の classList で判定する (renderTADXML 内のフックから呼ばれても正しく動く)
        const isDetailMode = this.editor.classList.contains('detail-mode');
        if (isDetailMode) {
            if (!this.decorationManager.enabled) {
                this.decorationManager.enable();
            } else {
                this.decorationManager.rebuild();
            }
        } else {
            if (this.decorationManager.enabled) {
                this.decorationManager.disable();
            }
        }
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
                this.editor.style.backgroundColor = LIST_SELECTED_BG_COLOR;
            } else {
                e.dataTransfer.dropEffect = 'copy';
                this.editor.style.backgroundColor = LIST_SELECTED_BG_COLOR;
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
        this._dblClickDragMouseMoveHandler = (e) => {
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
            if (this.dblClickDragState && this.dblClickDragState.isDblClickDrag && this.dblClickDragState.dragPreview) {
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
        };
        document.addEventListener('mousemove', this._dblClickDragMouseMoveHandler);

        // ダブルクリック+ドラッグ用のグローバルmouseupハンドラー
        this._dblClickDragMouseUpHandler = (e) => {
            if (!this.dblClickDragState) return;
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
        };
        document.addEventListener('mouseup', this._dblClickDragMouseUpHandler);
    }

    /**
     * 選択範囲のコンテナから、各段落ごとに個別XML生成してTAD XMLを構築
     * extractTADXMLFromElementは単独では<p>タグを出力しないため、
     * 呼び出し側で段落ごとに処理して<p>タグ・fontSizeを付与する
     * @param {HTMLElement} tempDiv - 選択範囲を含むコンテナ
     * @param {Selection} selection - 現在のSelection（単一段落内選択時のfontSize参照用）
     * @returns {string} TAD XML（必ず<p>タグで囲まれた形式）
     */
    buildCopyXmlFromContainer(tempDiv, selection) {
        const paragraphs = tempDiv.querySelectorAll('p');
        if (paragraphs.length > 0) {
            // <p>タグが1つ以上ある場合: 段落ごとに処理（複数段落対応）
            const xmlParts = [];
            for (const p of paragraphs) {
                const fontSize = this.getParagraphFontSizePt(p);
                // <p>の中身のみextract（<p>タグは自分でラップする）
                const innerXml = this.extractTADXMLFromElement(p);
                xmlParts.push(`<p><font size="${fontSize}"/>${innerXml}</p>`);
            }
            return xmlParts.join('');
        } else {
            // <p>タグなし（単一段落内の一部選択）
            const innerXml = this.extractTADXMLFromElement(tempDiv);
            let fontSize = 14;
            if (selection && selection.rangeCount > 0) {
                let startP = selection.getRangeAt(0).startContainer;
                while (startP && startP.nodeName !== 'P') startP = startP.parentElement;
                fontSize = this.getParagraphFontSizePt(startP);
            }
            return `<p><font size="${fontSize}"/>${innerXml}</p>`;
        }
    }

    /**
     * <p>要素のfontSizeをpt単位で取得（px→pt変換対応）
     */
    getParagraphFontSizePt(pElement) {
        if (pElement && pElement.style && pElement.style.fontSize) {
            const s = pElement.style.fontSize;
            if (s.endsWith('pt')) return Math.round(parseFloat(s));
            if (s.endsWith('px')) return Math.round(parseFloat(s) * 0.75);
        }
        return 14;
    }

    /**
     * コピー時のXML後処理: 各段落の先頭に<font size="X"/>を明示付与
     * extractTADXMLFromElementは14ptの段落で<font>を省略するため、
     * そのままのXMLをペーストすると前段落のフォント状態が継承されてしまう。
     * 各段落のサイズを明示付与することで、ペースト側で確実に正しいサイズが反映される。
     * @param {string} xmlContent - コピー対象XML
     * @param {HTMLElement} sourceContainer - コピー元DOM（<p>のstyle.fontSize参照）
     * @returns {string} 修正後XML
     */
    ensureExplicitFontSizeInParagraphs(xmlContent, sourceContainer) {
        const paragraphs = sourceContainer.querySelectorAll('p');
        const fontSizes = Array.from(paragraphs).map(p => this.getParagraphFontSizePt(p));

        let index = 0;
        return xmlContent.replace(/<p>([\s\S]*?)<\/p>/gi, (match, content) => {
            const size = fontSizes[index] !== undefined ? fontSizes[index] : 14;
            index++;
            // 段落先頭付近に既に<font size>がある場合はスキップ（メタタグの後もチェック）
            if (/^\s*(?:<(text|tab-format|indent|pagebreak|docoverlay)[^>]*\/>\s*)*<font\s+size="[^"]*"/i.test(content)) {
                return match;
            }
            return `<p><font size="${size}"/>${content}</p>`;
        });
    }

    /**
     * コピーイベントハンドラ: 仮身を含む場合はXML形式でコピー
     */
    handleCopy(e) {
        try {
            console.log('[EDITOR:DEBUG] handleCopy 呼び出し');
            const selection = window.getSelection();
            if (!selection.rangeCount) {
                return; // 選択範囲がない場合はデフォルト動作
            }

            const range = selection.getRangeAt(0);
            const container = range.cloneContents();
            const selectedText = selection.toString();

            // 選択範囲に仮身が含まれているか確認
            const hasVirtualObject = container.querySelector('.virtual-object') !== null;
            console.log('[EDITOR:DEBUG] handleCopy hasVirtualObject:', hasVirtualObject);

            if (!hasVirtualObject) {
                // 仮身が含まれていない場合でもグローバルクリップボードを更新
                // （Ctrl+Cでブラウザのデフォルトコピーと同時に実行される）
                if (selectedText) {
                    // selection.toString()は<p>境界で\n\nを返す
                    // \n\nは改段落、\nは改行として保持する
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

            // 段落ごとに個別処理してXML生成（複数段落対応 + fontSize明示付与）
            let xmlContent = this.buildCopyXmlFromContainer(tempDiv, selection);

            // プレーンテキスト版も作成（仮身は名前のみ）
            // innerTextを使用: textContentでは<p>や<br>の改行が失われるため
            // innerTextはレンダリング結果に基づき適切に改行を挿入する
            // ※innerTextはDOMに接続されていない要素では動作しないため一時的にbodyに追加
            tempDiv.style.position = 'absolute';
            tempDiv.style.left = '-9999px';
            document.body.appendChild(tempDiv);
            const plainText = tempDiv.innerText;
            document.body.removeChild(tempDiv);

            console.log('[EDITOR:DEBUG] handleCopy XML:', xmlContent);
            console.log('[EDITOR:DEBUG] handleCopy プレーンテキスト:', plainText);

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
    /**
     * TAD XMLフラグメント（仮身を含む可能性あり）をカーソル位置に貼り付け
     * 共通ルート: handlePaste(Ctrl+V)とpasteFromGlobalClipboard(メニュー操作)の両方から呼ばれる
     * @param {string} tadXml - コピー元から取得したXMLフラグメント（<p>...<link/>...</p>等）
     * @param {string} plainTextFallback - XML失敗時のフォールバック用プレーンテキスト
     */
    async pasteTadXmlFragment(tadXml, plainTextFallback) {
        console.log('[EDITOR:DEBUG] pasteTadXmlFragment 呼び出し, tadXml:', tadXml);

        // <document>でラップしてパース検証（コピー元XMLが単一rootでないケース対応）
        const wrappedXml = `<document>${tadXml}</document>`;
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(wrappedXml, 'text/xml');
        const parseError = xmlDoc.querySelector('parsererror');
        if (parseError) {
            logger.error('[EDITOR] ペーストXMLパースエラー:', parseError.textContent);
            if (plainTextFallback) {
                this.insertPlainText(plainTextFallback);
                this.updateParagraphLineHeight(true);
                this.isModified = true;
                this.setStatus('プレーンテキストとして貼り付けました（XML解析失敗）');
                return;
            }
            this.setStatus('貼り付けに失敗しました（XML解析エラー）');
            return;
        }

        // linkタグのvobjidを新規生成（仮身インスタンスIDの重複回避）
        // linkId（参照先実身ID）は変更しない
        const links = xmlDoc.querySelectorAll('link');
        for (const link of links) {
            link.setAttribute('vobjid', UuidV7Generator.generate());
        }

        // renderTADXML を returnHtml:true モードで呼び出し、段落処理・フォントサイズ継承・
        // line-height計算を含むHTML文字列を取得（editor.innerHTML上書きはスキップ）
        const serializer = new XMLSerializer();
        const wrappedXmlWithNewVobjid = serializer.serializeToString(xmlDoc.documentElement);
        const htmlContent = await this.renderTADXML(wrappedXmlWithNewVobjid, { returnHtml: true });

        if (!htmlContent) {
            if (plainTextFallback) {
                this.insertPlainText(plainTextFallback);
                this.updateParagraphLineHeight(true);
                this.isModified = true;
                this.setStatus('プレーンテキストとして貼り付けました');
                return;
            }
            this.setStatus('貼り付けに失敗しました');
            return;
        }

        // カーソル位置にHTMLを挿入（既存内容は保持）
        // ブラウザサニタイズ回避のためRange APIを使うが、<p>タグのネスト正規化で
        // 改段落が消える問題があるため、カーソル位置の<p>の直後へinsertBeforeで挿入する
        const selection = window.getSelection();
        if (selection.rangeCount === 0) {
            this.editor.insertAdjacentHTML('beforeend', htmlContent);
        } else {
            const range = selection.getRangeAt(0);
            range.deleteContents();

            // カーソル位置の最外<p>要素(editor直下)を取得
            let currentP = range.startContainer;
            while (currentP && currentP.nodeName !== 'P' && currentP !== this.editor) {
                currentP = currentP.parentElement;
            }

            if (currentP && currentP.nodeName === 'P' && currentP.parentElement === this.editor) {
                // カーソル位置の<p>の直後にhtmlContentの各<p>を挿入（<p>ネスト回避）
                const tempContainer = document.createElement('div');
                tempContainer.innerHTML = htmlContent;
                const newNodes = Array.from(tempContainer.childNodes);
                let lastInserted = currentP;
                for (const node of newNodes) {
                    lastInserted.parentNode.insertBefore(node, lastInserted.nextSibling);
                    lastInserted = node;
                }
                // カーソルを最後の挿入ノードの後ろに移動
                if (lastInserted && lastInserted !== currentP) {
                    const newRange = document.createRange();
                    newRange.setStartAfter(lastInserted);
                    newRange.collapse(true);
                    selection.removeAllRanges();
                    selection.addRange(newRange);
                }
            } else {
                // <p>の外（エディタ直下テキストなど、通常は発生しない）: 従来のフラグメント挿入
                const fragment = range.createContextualFragment(htmlContent);
                const lastNode = fragment.lastChild;
                range.insertNode(fragment);
                if (lastNode) {
                    const newRange = document.createRange();
                    newRange.setStartAfter(lastNode);
                    newRange.collapse(true);
                    selection.removeAllRanges();
                    selection.addRange(newRange);
                }
            }
        }

        // 挿入した仮身要素に contenteditable="false" を明示的に設定
        const vobjElements = this.editor.querySelectorAll('.virtual-object:not([contenteditable])');
        vobjElements.forEach(vo => {
            vo.setAttribute('contenteditable', 'false');
        });

        // 後処理: 仮身イベントハンドラ、画像読み込み、図形iframe初期化
        this.setupVirtualObjectEventHandlers();
        await this.loadImagesFromParent();
        this.initFigureSegmentIframes();

        this.updateParagraphLineHeight(true);
        this.isModified = true;
        this.setStatus('仮身を含むコンテンツを貼り付けました');
    }

    async handlePaste(e) {
        try {
            console.log('[EDITOR:DEBUG] handlePaste 呼び出し');
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

            // ★ awaitの前にclipboardDataのデータを同期的に読み取る
            // （DataTransferオブジェクトはawait後に無効化されるため）
            const tadXml = clipboardData.getData('application/x-tad-xml');
            const plainText = clipboardData.getData('text/plain');
            const imageBlobs = [];
            if (clipboardData.items) {
                for (let i = 0; i < clipboardData.items.length; i++) {
                    if (clipboardData.items[i].type.startsWith('image/')) {
                        const blob = clipboardData.items[i].getAsFile();
                        if (blob) {
                            imageBlobs.push(blob);
                        }
                    }
                }
            }

            // TAD XMLデータをチェック（仮身を含むコピー: Ctrl+Cでhandle Copyが書き込んだXML）
            if (tadXml) {
                await this.pasteTadXmlFragment(tadXml, plainText);
                return;
            }

            // グローバルクリップボードをチェック（アプリ内コピーを優先）
            const globalClipboard = await this.getGlobalClipboard();

            // グローバルクリップボードの全型をチェック（アプリ内コピーをシステムクリップボードより優先）
            if (globalClipboard) {
                // tad-xml: 右クリックメニュー「コピー」で仮身含む範囲をコピーした場合
                if (globalClipboard.type === 'tad-xml' && globalClipboard.xml) {
                    await this.pasteTadXmlFragment(globalClipboard.xml, globalClipboard.text);
                    return;
                }
                if (globalClipboard.type === 'text' && globalClipboard.text) {
                    // テキスト（メニュー操作等でシステムクリップボード書き込みが失敗した場合に対応）
                    this.insertPlainText(globalClipboard.text);
                    this.updateParagraphLineHeight(true); // 全段落のline-heightを更新
                    this.isModified = true;
                    this.setStatus('テキストをクリップボードから貼り付けました');
                    return;
                }
                if (globalClipboard.type === 'figure-segment') {
                    // 図形セグメント（グラフ等）はCanvas描画で貼り付け（xmlTadデータ保持）
                    await this.insertFigureSegment(globalClipboard.xmlTad, globalClipboard.sourceRealId);
                    return;
                }
                if (globalClipboard.type === 'image' && globalClipboard.dataUrl) {
                    await this.insertImageFromDataUrl(globalClipboard.dataUrl, globalClipboard.name || 'image.png');
                    this.setStatus('画像をクリップボードから貼り付けました');
                    return;
                }
                if (globalClipboard.link_id) {
                    this.insertVirtualObjectLink(globalClipboard);
                    this.requestCopyVirtualObject(globalClipboard.link_id);
                    this.setStatus('仮身をクリップボードから貼り付けました');
                    return;
                }
            }

            // グローバルクリップボードにデータがない場合はシステムクリップボードを使用
            // clipboardData.getData('text/plain')の結果を優先し、空の場合はElectron IPC経由で取得
            const systemText = plainText || await this.getSystemClipboardText();
            if (systemText) {
                this.insertPlainText(systemText);
                this.updateParagraphLineHeight(true); // 全段落のline-heightを更新
                this.isModified = true;
                this.setStatus('クリップボードから貼り付けました');
                return;
            }

            // 画像ファイルをチェック（テキストがない場合のみ）
            if (imageBlobs.length > 0) {
                const blob = imageBlobs[0];
                const reader = new FileReader();
                reader.onload = async (event) => {
                    await this.insertImageFromDataUrl(event.target.result, 'clipboard_image.png');
                    this.setStatus('画像をクリップボードから貼り付けました');
                };
                reader.readAsDataURL(blob);
                return;
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
                loadIconCallback: (realId) => this.iconManager.loadIconWithRetry(realId)
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
            const frcol = virtualObject.frcol || DEFAULT_FRCOL;
            const tbcol = virtualObject.tbcol || DEFAULT_TBCOL;
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
            // 既存末尾段落から CSS を継承 (タブ書式・字下げ・行揃え等を維持)
            const lastP = this.editor.querySelector('p:last-of-type');
            if (lastP) this.inheritParagraphStyle(lastP, p);
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
            vobjid: UuidV7Generator.generate(),
            link_id: `${realId}_0.xtad`,
            link_name: name,
            width: 150,
            heightPx: DEFAULT_VOBJ_HEIGHT,
            chsz: DEFAULT_FONT_SIZE,
            frcol: DEFAULT_FRCOL,
            chcol: DEFAULT_CHCOL,
            tbcol: DEFAULT_TBCOL,
            bgcol: DEFAULT_BGCOL,
            dlen: 0,
            applist: applist || {},
            scrollx: 0,
            scrolly: 0,
            zoomratio: 1.0,
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
     * @param {Object} options - オプション
     * @param {string} options.figureXmlTad - base64エンコードされた図形xmlTadデータ
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

    /**
     * 新規段落 (destP) に親段落 (srcP) の inline style と data-tab-format 属性を継承する
     * BTRON 仕様: タブ書式付箋・字下げ付箋・行揃え・行間隔・禁則指定は「次の付箋まで継続適用」
     * → 編集中に新規 <p> を作る場合 (Enter / paste / 仮身挿入 / タブ書式メニュー等) は親段落の CSS を確実に継承する
     * 継承対象:
     *   - 字下げ系: padding-left, text-indent
     *   - タブ書式系: tab-size, MozTabSize, margin-left/right, break-after/inside, margin-top/bottom (pargap)
     *   - 表示系: text-align, line-height, font-size
     *   - 禁則系: line-break, word-break
     *   - data-tab-format JSON (CSS 計算 + ルーラー整合性)
     */
    inheritParagraphStyle(srcP, destP) {
        if (!srcP || !destP || !srcP.style) return;
        const props = [
            'paddingLeft', 'textIndent',
            'tabSize', 'MozTabSize',
            'marginLeft', 'marginRight',
            'marginTop', 'marginBottom',
            'lineHeight', 'fontSize', 'fontFamily', 'color',
            'textAlign',
            'lineBreak', 'wordBreak',
            'breakAfter', 'breakInside',
        ];
        for (const prop of props) {
            if (srcP.style[prop]) destP.style[prop] = srcP.style[prop];
        }
        const tabFormatJson = srcP.getAttribute && srcP.getAttribute('data-tab-format');
        if (tabFormatJson) destP.setAttribute('data-tab-format', tabFormatJson);
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
                let fontSize = `${DEFAULT_FONT_SIZE}pt`; // デフォルト

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
                            caretStyle.fontSize = window.convertPtToPx(fontSizePt) + 'px';
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
                    // 補助 br (詳細モード装飾オーバーレイで装飾対象外)
                    newP.innerHTML = '<br data-filler="1">';

                    // 段落 CSS を currentP から新規段落へ継承 (共通ヘルパー経由)
                    // BTRON 仕様: タブ書式付箋・字下げ付箋・行揃え・禁則指定は「次の付箋まで継続適用」
                    this.inheritParagraphStyle(currentP, newP);

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
                                    fontSizePt = window.convertPxToPt(fontSizePt);
                                }
                                fontSizePt = Math.round(fontSizePt * 10) / 10;
                                if (Math.abs(fontSizePt - DEFAULT_FONT_SIZE) > 0.5) {
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
                                    fontSizePt = window.convertPxToPt(fontSizePt);
                                }
                                fontSizePt = Math.round(fontSizePt * 10) / 10;
                                if (Math.abs(fontSizePt - DEFAULT_FONT_SIZE) > 0.5) {
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
                                fontSizePt = window.convertPxToPt(fontSizePt);
                            }
                            fontSizePt = Math.round(fontSizePt * 10) / 10;
                            if (Math.abs(fontSizePt - DEFAULT_FONT_SIZE) > 0.5) {
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
                                fontSizePt = window.convertPxToPt(fontSizePt);
                            }
                            fontSizePt = Math.round(fontSizePt * 10) / 10;
                            if (Math.abs(fontSizePt - DEFAULT_FONT_SIZE) > 0.5) {
                                currentP.style.fontSize = `${fontSizePt}pt`;
                            }
                        } else {
                            // 補助 br (詳細モード装飾オーバーレイで装飾対象外)
                            currentP.innerHTML = '<br data-filler="1">';
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
                        newParagraphFontSize = parseFloat(caretStyle.fontSize) || DEFAULT_FONT_SIZE;
                    }
                    // line-height は currentP からコピー (浮動小数点誤差で <text line-height/> が毎回変動するのを防ぐ)
                    if (currentP.style.lineHeight) {
                        newP.style.lineHeight = currentP.style.lineHeight;
                    } else {
                        const lineHeight = this.calculateLineHeight(newParagraphFontSize);
                        newP.style.lineHeight = `${lineHeight}px`;
                    }

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

                    // 直前の段落 (editor 末尾の <p>) から CSS を継承
                    // (タブ書式・字下げ・行揃え・禁則指定を維持)
                    const refP = this.editor.querySelector('p:last-of-type');
                    if (refP) this.inheritParagraphStyle(refP, p);

                    // スタイル引き継ぎ用のspan
                    let styleSpanAlt = null;
                    if (needsInherit) {
                        styleSpanAlt = this.createStyleInheritSpan(caretStyle);
                        p.appendChild(styleSpanAlt);
                    } else {
                        // 補助 br (詳細モード装飾オーバーレイで装飾対象外)
                        p.innerHTML = '<br data-filler="1">';
                    }

                    // line-height設定（スタイル引き継ぎがある場合はそのサイズを使用）
                    let altFontSize = 14;
                    if (needsInherit) {
                        altFontSize = parseFloat(caretStyle.fontSize) || DEFAULT_FONT_SIZE;
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
                // 詳細モード装飾: ユーザー意図の改行であることをマーキング (空段落補助 br との区別用)
                br.setAttribute('data-user-br', '1');
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

                // カーソルが ZWSP テキストノードの先頭 (offset 0) にある場合
                // = Shift+Enter で挿入した改行行の先頭 → ZWSP + 次の br を 1 セットで削除
                // (これがないと 1 回目の Delete で ZWSP 1 文字しか消えず、 視覚的に変化なしに見える)
                if (node.nodeType === Node.TEXT_NODE && offset === 0 &&
                    node.textContent.charAt(0) === '​') {
                    const nextSibling = node.nextSibling;
                    if (nextSibling && nextSibling.nodeName === 'BR') {
                        e.preventDefault();
                        this.suppressMutationObserverCount++;

                        // 削除前に「削除後のカーソル位置」 となるノードを取得
                        // 連続 Delete で同じ位置から削除できるようにするため、 ZWSP の前のノード (br1 など) を覚えておく
                        const prevSibling = node.previousSibling;
                        // 削除した br の元の次のノード = 削除後に同じ「行頭」 になる場所
                        const afterBr = nextSibling.nextSibling;

                        // 次の br を削除
                        nextSibling.parentNode.removeChild(nextSibling);
                        // ZWSP の 1 文字を削除
                        node.textContent = node.textContent.substring(1);
                        if (node.textContent.length === 0) {
                            node.parentNode.removeChild(node);
                        }

                        // カーソル位置を明示設定: 次の ZWSP の先頭 (= 連続 Delete で次の改行を消せる位置)
                        const newRange = document.createRange();
                        if (afterBr && afterBr.parentNode &&
                            afterBr.nodeType === Node.TEXT_NODE &&
                            afterBr.textContent.charAt(0) === '​') {
                            // 次が ZWSP テキストノード → その先頭にカーソル (次の Delete でセット削除可能)
                            newRange.setStart(afterBr, 0);
                        } else if (prevSibling && prevSibling.parentNode) {
                            // フォールバック: 前のノードの直後
                            newRange.setStartAfter(prevSibling);
                        } else if (afterBr && afterBr.parentNode) {
                            newRange.setStartBefore(afterBr);
                        } else {
                            // 最終フォールバック: 削除元の親の先頭
                            const parent = nextSibling.parentNode;
                            if (parent) newRange.setStart(parent, 0);
                        }
                        newRange.collapse(true);
                        selection.removeAllRanges();
                        selection.addRange(newRange);

                        setTimeout(() => {
                            this.suppressMutationObserverCount--;
                            this.updateContentHeight();
                        }, 0);

                        return;
                    }
                }

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
                return;
            }
            // 選択範囲に仮身を含む場合はブラウザのネイティブcopyイベントに任せる
            // （handleCopyでTAD XML形式でクリップボードにコピーされる）
            const selection = window.getSelection();
            if (selection.rangeCount > 0) {
                const container = selection.getRangeAt(0).cloneContents();
                if (container.querySelector('.virtual-object')) {
                    return;
                }
            }
            // 通常テキスト選択時はexecuteMenuActionでシステムクリップボードに確実にコピー
            // （ElectronメニューにEdit roleがない環境でもCtrl+Cが動作するため）
            e.preventDefault();
            this.executeMenuAction('copy');
            return;
        }

        // Ctrl+X: カット（移動）
        if (e.ctrlKey && e.key === 'x') {
            // 画像または仮身が選択されている場合のみカスタム処理
            if (this.selectedImage || this.selectedVirtualObject) {
                e.preventDefault();
                this.executeMenuAction('cut');
                return;
            }
            // 選択範囲に仮身を含む場合はブラウザのネイティブcutイベントに任せる
            const selection = window.getSelection();
            if (selection.rangeCount > 0) {
                const container = selection.getRangeAt(0).cloneContents();
                if (container.querySelector('.virtual-object')) {
                    return;
                }
            }
            // 通常テキスト選択時はexecuteMenuActionでシステムクリップボードに確実に移動
            e.preventDefault();
            this.executeMenuAction('cut');
            return;
        }

        // Ctrl+V: ペーストはpasteイベント経由で処理
        // （keydownでe.preventDefault()するとpasteイベントが発火しなくなるため、
        //   ここではpreventDefaultせずブラウザのデフォルト動作でpasteイベントを発火させる）
        // ただし、画像/仮身が選択されている場合はpasteイベントが正しく処理されないため
        // executeMenuAction経由で処理する
        if (e.ctrlKey && e.key === 'v') {
            if (this.selectedImage || this.selectedVirtualObject) {
                e.preventDefault();
                this.executeMenuAction('paste');
            }
            // テキスト編集時はブラウザのデフォルト動作でpasteイベントを発火させる
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
            this.insertIndentAnchor();
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
            // 実身IDを設定
            this.realId = fileData ? this.extractRealId(fileData.realId) : null;

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

                // 永続化された表示モードを反映
                if (this.viewMode === 'detailed') {
                    await this.viewDetailedMode();
                } else if (this.viewMode === 'xml') {
                    await this.viewXMLMode();
                } else {
                    // formatted: editor のクラスを設定 (mode 初期表示用)
                    this.editor.classList.remove('detail-mode', 'xml-mode');
                    this.editor.classList.add('formatted-mode');
                }

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
    // TADパース系メソッドは text-tad-parser.js に移動

    /**
     * 指定した仮身を選択状態にし、他の仮身の選択を解除する
     * @param {Element} vo - 対象の仮身要素
     */
    selectVirtualObject(vo) {
        this.editor.querySelectorAll('.virtual-object.selected').forEach(other => {
            if (other !== vo) {
                other.classList.remove('selected');
            }
        });
        vo.classList.add('selected');
    }

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
                    const lineHeight = DEFAULT_LINE_HEIGHT;
                    const textHeight = Math.ceil(chszPx * lineHeight);
                    height = textHeight + VOBJ_PADDING_VERTICAL; // 閉じた仮身の高さ
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

                // この仮身の選択状態をトグル（他の仮身の選択は解除）
                if (vo.classList.contains('selected')) {
                    vo.classList.remove('selected');
                } else {
                    this.selectVirtualObject(vo);
                }

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
                        // 注: DOM要素の高さ（currentHeight）はborderを含む（box-sizing: border-box）
                        // TADファイルのheight属性はborderを含まない値を保存する
                        const heightForSave = currentHeight - VOBJ_BORDER_WIDTH;
                        const vobjright = vobjleft + currentWidth;
                        const vobjbottom = vobjtop + heightForSave;

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
                            heightPx: heightForSave,
                            chsz: parseFloat(vo.dataset.chsz) || DEFAULT_FONT_SIZE,
                            frcol: vo.dataset.frcol || DEFAULT_FRCOL,
                            chcol: vo.dataset.chcol || DEFAULT_CHCOL,
                            tbcol: vo.dataset.tbcol || DEFAULT_TBCOL,
                            bgcol: vo.dataset.bgcol || DEFAULT_BGCOL,
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
                this.selectVirtualObject(vo);

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

        // 最小必要高さを計算（rendererと同じ計算式）
        const chszPx = window.convertPtToPx(chsz);
        const minRequiredHeight = Math.max(chszPx, Math.ceil(chszPx * DEFAULT_LINE_HEIGHT)) + VOBJ_PADDING_VERTICAL + 1;

        logger.debug('[EDITOR] 仮身自動展開チェック:', {
            name: vo.dataset.linkName || vo.textContent,
            chsz,
            height,
            minRequiredHeight,
            shouldExpand: height > minRequiredHeight
        });

        // 実際の高さが必要最小高さより大きい場合は自動展開対象
        if (height > minRequiredHeight && width > 0 && height > 0) {
            logger.debug('[EDITOR] 仮身を自動展開対象として登録:', vo.dataset.linkName || vo.textContent);
            // IntersectionObserver で画面内に入った時に展開 (F: 画面外展開の遅延)
            // 画面内 (+ マージン 200px) に入った瞬間に expandVirtualObject を実行
            this._scheduleAutoExpand(vo, width, height);
        }
    }

    /**
     * 仮身を IntersectionObserver で監視し、 viewport に入った時に展開する
     * (F: 画面外仮身の展開を遅延、 体感速度向上)
     * @param {HTMLElement} vo - 仮身要素
     * @param {number} width - 展開後の幅
     * @param {number} height - 展開後の高さ
     */
    _scheduleAutoExpand(vo, width, height) {
        // 既に展開済みの仮身は再度監視・展開しない
        // (checkAllVirtualObjectsForAutoExpand が複数回呼ばれた時のリセット防止)
        if (vo.classList.contains('expanded')) return;
        // 既に同じ vo が監視中なら重複登録しない
        if (this._autoExpandPending && this._autoExpandPending.has(vo)) return;
        if (!this._autoExpandObserver) {
            // 初回のみ IntersectionObserver を作成
            // rootMargin で画面外 200px までは「画面内」 と扱い、 スクロールに余裕を持たせる
            this._autoExpandObserver = new IntersectionObserver((entries) => {
                for (const entry of entries) {
                    if (!entry.isIntersecting) continue;
                    const target = entry.target;
                    const info = this._autoExpandPending && this._autoExpandPending.get(target);
                    if (!info) continue;
                    this._autoExpandPending.delete(target);
                    this._autoExpandObserver.unobserve(target);
                    // expand は async だが await しない (並列展開、 A: setTimeout 撤去)
                    this.expandVirtualObject(target, info.width, info.height).catch(err => {
                        logger.error('[EDITOR] 自動展開エラー:', err);
                    });
                }
            }, {
                root: this.editor,
                rootMargin: '200px 0px 200px 0px',
                threshold: 0
            });
            this._autoExpandPending = new Map();
        }
        // 既に登録済みでも、 サイズ変更があり得るので最新値で上書き
        this._autoExpandPending.set(vo, { width, height });
        this._autoExpandObserver.observe(vo);
    }

    /**
     * IntersectionObserver の状態をリセット (renderTADXML 再呼び出し時等に呼ぶ)
     */
    _resetAutoExpandObserver() {
        if (this._autoExpandObserver) {
            this._autoExpandObserver.disconnect();
            this._autoExpandObserver = null;
        }
        if (this._autoExpandPending) {
            this._autoExpandPending.clear();
            this._autoExpandPending = null;
        }
    }

    /**
     * すべての仮身に対して自動展開チェックを実行
     * (A: 並列化、 F: 画面内のみ展開 = 画面外は IntersectionObserver 監視)
     */
    checkAllVirtualObjectsForAutoExpand() {
        logger.debug('[EDITOR] すべての仮身の自動展開チェックを開始');
        // 再呼出時は IO 状態をリセット (再描画/モード切替対応)
        // ただし対象は **未展開の仮身のみ** にして、 既に展開済みの仮身を再展開しない
        this._resetAutoExpandObserver();
        const virtualObjects = this.editor.querySelectorAll('.virtual-object:not(.expanded)');
        logger.debug('[EDITOR] 検出された未展開仮身数:', virtualObjects.length);

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
     * HTMLエスケープ（PluginBase共通メソッドを使用）
     */
    // escapeHtml(text) は PluginBase に移動済み

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
    // XML生成系メソッドは text-xml-serializer.js に移動

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
                    { label: (this.viewMode === 'xml' ? '✓ ' : '   ') + '原稿（xml直接表示）モード', action: 'view-xml' },
                    { label: (this.viewMode === 'detailed' ? '✓ ' : '   ') + '詳細モード', action: 'view-detailed' },
                    { label: (this.viewMode === 'formatted' ? '✓ ' : '   ') + '清書モード', action: 'view-formatted' },
                    { separator: true },
                    { label: '全画面表示オンオフ', action: 'toggle-fullscreen', shortcut: 'Ctrl+L' },
                    { label: '再表示', action: 'refresh' },
                    { label: '背景色変更', action: 'change-bg-color' },
                    { separator: true },
                    { label: (this.wrapMode ? '✓ ' : '   ') + 'ウインドウ幅で折り返し', action: 'toggle-wrap' }
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
                    { label: '新規タブ書式...', action: 'format-new-tab-format' },
                    { label: '字下げ', action: 'format-indent', shortcut: 'Ctrl+I' },
                    {
                        label: '行揃え',
                        submenu: [
                            { label: '行頭揃え', action: 'align-left' },
                            { label: '中央揃え', action: 'align-center' },
                            { label: '行末揃え', action: 'align-right' }
                        ]
                    },
                    {
                        label: '文字間隔',
                        submenu: [
                            { label: '文字間隔なし', action: 'charspace-0' },
                            { label: '1/16字あき', action: 'charspace-0.0625' },
                            { label: '1/8字あき', action: 'charspace-0.125' },
                            { label: '1/4字あき', action: 'charspace-0.25' },
                            { label: '3/8字あき', action: 'charspace-0.375' },
                            { label: '1/2字あき', action: 'charspace-0.5' },
                            { label: '3/4字あき', action: 'charspace-0.75' }
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

        // 仮身が選択されている場合は仮身操作メニューを追加（PluginBase共通メソッド）
        await this.buildVirtualObjectContextMenus(menuDef);

        return menuDef;
    }

    // showContextMenu() / renderMenu() / hideContextMenu() は PluginBase 共通メソッドを使用

    /**
     * メニューアクションを実行
     */
    async executeMenuAction(action, additionalData) {
        logger.debug('[EDITOR] メニューアクション:', action, additionalData);

        // 共通アクションを先に処理
        if (await this.executeCommonMenuAction(action, additionalData)) {
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

            // 表示
            case 'view-xml':
                this.viewXMLMode();
                break;
            case 'view-detailed':
                this.viewDetailedMode();
                break;
            case 'view-formatted':
                this.viewFormattedMode();
                break;
            case 'refresh':
                this.refresh();
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
                // 図形セグメントが選択されている場合は図形セグメントをコピー
                if (this.selectedFigureSegment) {
                    this.copyFigureSegment(this.selectedFigureSegment);
                    this.setStatus('図形セグメントをクリップボードへコピーしました');
                } else if (this.selectedImage) {
                    // 画像が選択されている場合は画像をコピー
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
                // ローカルクリップボードに図形セグメントがある場合は図形セグメントを貼り付け
                if (this.figureSegmentClipboard) {
                    this.pasteFigureSegment();
                    this.setStatus('図形セグメントをクリップボードから貼り付けました');
                } else if (this.imageClipboard) {
                    // クリップボードに画像がある場合は画像を貼り付け
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
                // 図形セグメントが選択されている場合は図形セグメントを移動
                if (this.selectedFigureSegment) {
                    this.copyFigureSegment(this.selectedFigureSegment);
                    this.selectedFigureSegment.remove();
                    this.selectedFigureSegment = null;
                    this.isModified = true;
                    this.setStatus('図形セグメントをクリップボードへ移動しました');
                } else if (this.selectedImage) {
                    // 画像が選択されている場合は画像を移動
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
                // ローカルクリップボードに図形セグメントがある場合は図形セグメントを移動（貼り付け後クリア）
                if (this.figureSegmentClipboard) {
                    this.pasteFigureSegment();
                    this.figureSegmentClipboard = null;
                    this.setStatus('図形セグメントをクリップボードから移動しました');
                } else if (this.imageClipboard && this.imageClipboard.isCut) {
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
                this.insertIndentAnchor();
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
            case 'format-new-tab-format':
                this.applyNewTabFormat();
                break;
            case 'format-indent':
                this.insertIndentAnchor();
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
            // 文字間隔
            case 'charspace-0':
            case 'charspace-0.0625':
            case 'charspace-0.125':
            case 'charspace-0.25':
            case 'charspace-0.375':
            case 'charspace-0.5':
            case 'charspace-0.75':
                this.applyCharSpacing(action.replace('charspace-', ''));
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
        // 詳細モード由来の装飾要素 (タブ書式帯状 UI) を削除して元の HTML 構造に戻す
        if (this.viewMode === 'detailed') {
            this.cleanupDetailModeArtifacts();
        }
        // XMLモードでない場合（清書モードまたは初期状態）、エディタの内容をXMLに変換
        if (this.viewMode !== 'xml') {
            this.tadData = await this.convertEditorToXML();
        }

        if (this.tadData) {
            this.editor.innerHTML = '<pre style="white-space: pre-wrap; word-wrap: break-word; font-family: monospace; font-size: 12px; padding: 10px; background: #f5f5f5; border: 1px solid #ddd; border-radius: 4px;">' +
                this.escapeHtml(this.tadData) +
                '</pre>';
            this.viewMode = 'xml';
            this.editor.classList.remove('formatted-mode', 'detail-mode');
            this.editor.classList.add('xml-mode');
            this.updateWindowConfig({ viewMode: this.viewMode, wordWrap: this.wrapMode });
            this.setStatus('原稿（XML直接表示）モード');
            this._refreshDecorationOverlay();
        }
    }

    /**
     * 清書モード
     */
    async viewFormattedMode() {
        logger.debug('[EDITOR] viewFormattedMode開始, 現在のモード:', this.viewMode);

        // 詳細モード由来の装飾要素 (タブ書式帯状 UI) を削除して元の HTML 構造に戻す
        // これを convertEditorToXML 前に行うことで「タブ書式」テキストが XML に取り込まれるのを防ぐ
        if (this.viewMode === 'detailed') {
            this.cleanupDetailModeArtifacts();
        }

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
            // formatted-mode を先に付与
            this.editor.classList.remove('detail-mode', 'xml-mode');
            this.editor.classList.add('formatted-mode');
            await this.renderTADXML(this.tadData, { mode: 'formatted' });
            this.viewMode = 'formatted';
            this.updateWindowConfig({ viewMode: this.viewMode, wordWrap: this.wrapMode });
            this.setStatus('清書モード');
        } else {
            logger.error('[EDITOR] tadDataが空です');
            this.editor.innerHTML = '<p>XMLデータがありません</p>';
        }
    }

    /**
     * 詳細モード
     * 清書モードの表示に指定付箋の旗マーク・制御記号を重ねて表示する。
     * 内部 XML 構造は不変、 ラウンドトリップ可能。
     */
    async viewDetailedMode() {
        // XML モードからの遷移時は <pre> から XML を抽出
        if (this.viewMode === 'xml') {
            const preElement = this.editor.querySelector('pre');
            if (preElement) {
                this.tadData = preElement.textContent;
            } else {
                logger.error('[EDITOR] pre要素が見つかりません');
            }
        } else {
            // 清書 / 詳細 → 詳細 (refresh) の場合は XML 再生成
            this.tadData = await this.convertEditorToXML();
        }

        if (this.tadData) {
            // detail-mode クラスを renderTADXML より先に付与する
            // text-tad-parser.js が editor.classList を見て詳細モード用 HTML 出力を分岐するため
            this.editor.classList.remove('formatted-mode', 'xml-mode');
            this.editor.classList.add('detail-mode');
            await this.renderTADXML(this.tadData, { mode: 'detailed' });
            this.viewMode = 'detailed';
            this.attachDetailFusenClickHandlers();
            this.attachDetailTabFormatDragHandlers();
            this.updateWindowConfig({ viewMode: this.viewMode, wordWrap: this.wrapMode });
            this.setStatus('詳細モード');
        } else {
            this.editor.innerHTML = '<p>XMLデータがありません</p>';
        }
    }

    /**
     * 詳細モード由来の装飾要素 (タブ書式帯状 UI 等) を削除する。
     * 清書モード / 原稿モードへ遷移する際に、 convertEditorToXML より前に呼び出して、
     * 詳細モード時にのみ挿入した装飾テキストが XML に取り込まれないようにする。
     */
    cleanupDetailModeArtifacts() {
        if (!this.editor) return;
        // タブ書式の帯状 UI 要素を削除 (これらは詳細モード時にのみ挿入される視覚要素で、 内部 XML には対応しない)
        // タブ書式ルーラー: マーカーがドラッグで動かされていれば、 段落直前に <tab-format ...> タグを再挿入して値を保持
        const tabFormatBars = this.editor.querySelectorAll('.detail-tab-format');
        tabFormatBars.forEach(el => {
            this._reconstructTabFormatTag(el);
            el.remove();
        });
        // そろえ指定付箋の旗マークを削除する前に、 親段落の style.textAlign が無ければ data-align で補う
        // これにより <text align> タグがシリアライズ時 (段落 style.textAlign 経由) で消えないようにする
        const alignFusens = this.editor.querySelectorAll('.detail-align');
        alignFusens.forEach(el => {
            const dataAlign = el.dataset.align;
            const para = el.closest('p, div');
            if (para && dataAlign && (!para.style || !para.style.textAlign)) {
                para.style.textAlign = dataAlign;
            }
            el.remove();
        });
    }

    /**
     * 詳細モードのルーラー要素を、 シリアライズ可能な隠し span に置換する。
     * これにより清書/原稿モードへ遷移した後の convertEditorToXML が
     * 編集後の最新値で <tab-format ... /> タグを復元できる。
     * (text-xml-serializer.js は .hidden-tab-format[data-tab-attrs] を見て XML タグを出力する)
     */
    _reconstructTabFormatTag(rulerEl) {
        if (!rulerEl) return;
        const raw = rulerEl.dataset.tabAttrs || '';
        if (!raw) return;
        const hidden = document.createElement('span');
        hidden.className = 'hidden-tab-format';
        hidden.dataset.tabAttrs = raw;
        hidden.style.display = 'none';
        if (rulerEl.parentNode) {
            rulerEl.parentNode.insertBefore(hidden, rulerEl);
        }
    }

    /**
     * 詳細モード時、 タブ書式ルーラーの各マーカーをドラッグで動かせるようにする。
     * - 文頭位置 (F) / 行頭位置 (L) / 行末位置 (J) / タブ位置 (▼) はドラッグで横移動
     * - 基準位置 (絶/相) はクリックで切替
     * ドラッグ完了時、 ルーラーの data-tab-attrs を再計算し isModified を立てる
     */
    attachDetailTabFormatDragHandlers() {
        if (!this.editor) return;
        const rulers = this.editor.querySelectorAll('.detail-tab-format');
        rulers.forEach(ruler => {
            if (ruler.dataset.dragHandlersAttached === 'true') return;
            ruler.dataset.dragHandlersAttached = 'true';
            // 単位は文書共通固定 (14pt × 1.333) → 段落フォントに依存しない
            const unitPx = window.CHAR_UNIT_PX;
            // 初期表示時にルーラーの値 (data-x) で段落 CSS を強制再計算
            // タブ書式付箋を持つ段落から後続継承段落へ tab-size / margin / line-height 等を伝播する
            // (text-indent は `<indent/>` ありの段落で保護されているので字下げは壊れない)
            this._updateTabFormatAttrs(ruler);
            const markers = ruler.querySelectorAll('.detail-tab-marker');
            markers.forEach(marker => {
                marker.addEventListener('mousedown', (e) => this._onTabMarkerDragStart(e, ruler, marker, unitPx));
            });
            const origin = ruler.querySelector('.detail-tab-origin');
            if (origin) {
                origin.addEventListener('click', (e) => {
                    if (this.viewMode !== 'detailed') return;
                    e.preventDefault();
                    e.stopPropagation();
                    const cur = parseInt(origin.dataset.origin, 10) || 0;
                    const next = cur === 0 ? 1 : 0;
                    origin.dataset.origin = String(next);
                    origin.textContent = next === 0 ? '|' : '>';
                    origin.title = next === 0 ? '基準位置: 絶対 (用紙左端)' : '基準位置: 相対 (直前の行頭)';
                    this._updateTabFormatAttrs(ruler);
                    this.isModified = true;
                });
            }
            // ルーラーバーのマーカー以外をクリック → 段落間隔ポップアップ
            const bar = ruler.querySelector('.detail-tab-format-bar');
            if (bar) {
                bar.addEventListener('click', (e) => {
                    if (this.viewMode !== 'detailed') return;
                    // マーカーや原点記号のクリックは無視 (それぞれのハンドラで処理)
                    if (e.target.closest('.detail-tab-marker') || e.target.closest('.detail-tab-origin')) return;
                    e.preventDefault();
                    e.stopPropagation();
                    this._showParagraphGapDialog(ruler, e);
                });
            }
        });
    }

    /**
     * 段落間隔 (pargap) 変更ポップアップ
     * ルーラーの近接位置に小さなパネルを表示し、 リストから選択するとそのまま反映
     */
    _showParagraphGapDialog(ruler, clickEvent) {
        // 既存ポップアップを閉じる
        this._closeParagraphGapPopup();

        const currentPargap = String(ruler.dataset.tabPargap || '0.75');
        const options = [
            { value: '0.125', label: '1/8 行あき' },
            { value: '0.25',  label: '1/4 行あき' },
            { value: '0.375', label: '3/8 行あき' },
            { value: '0.5',   label: '1/2 行あき' },
            { value: '0.625', label: '5/8 行あき' },
            { value: '0.75',  label: '3/4 行あき (標準)' },
            { value: '0.875', label: '7/8 行あき' },
            { value: '1.0',   label: '1 行あき' },
            { value: '1.25',  label: '1.25 行あき' },
            { value: '1.5',   label: '1.5 行あき' },
            { value: '1.75',  label: '1.75 行あき' },
            { value: '2.0',   label: '2 行あき' }
        ];
        const normalizedCurrent = options.find(o => parseFloat(o.value) === parseFloat(currentPargap))?.value || '0.75';

        // ポップアップ DOM 作成 (絶対配置で ruler の真下に表示)
        const popup = document.createElement('div');
        popup.className = 'detail-tab-pargap-popup';
        popup.contentEditable = 'false';
        const rulerRect = ruler.getBoundingClientRect();
        const editorRect = this.editor.getBoundingClientRect();
        // クリック位置の X、 ruler の下に Y
        const clickX = clickEvent ? clickEvent.clientX : (rulerRect.left + 40);
        const left = clickX - editorRect.left + this.editor.scrollLeft;
        const top = rulerRect.bottom - editorRect.top + this.editor.scrollTop + 4;
        popup.style.position = 'absolute';
        popup.style.left = left + 'px';
        popup.style.top = top + 'px';
        popup.style.zIndex = '10000';

        // タイトル + リスト項目
        let html = '<div class="detail-tab-pargap-popup-title">段落間隔</div>';
        for (const opt of options) {
            const selected = opt.value === normalizedCurrent ? ' selected' : '';
            html += `<button type="button" class="detail-tab-pargap-popup-item${selected}" data-pargap-value="${opt.value}">${opt.label}</button>`;
        }
        popup.innerHTML = html;

        // 項目クリックハンドラ
        popup.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
        popup.addEventListener('click', (e) => {
            const item = e.target.closest('.detail-tab-pargap-popup-item');
            if (!item) return;
            e.preventDefault();
            e.stopPropagation();
            const selected = item.dataset.pargapValue;
            ruler.dataset.tabPargap = selected;
            this._updateTabFormatAttrs(ruler);
            this.isModified = true;
            this._closeParagraphGapPopup();
        });

        this.editor.appendChild(popup);
        this._paragraphGapPopup = popup;

        // 外部クリックで閉じる
        setTimeout(() => {
            this._paragraphGapPopupOutsideHandler = (ev) => {
                if (popup.contains(ev.target)) return;
                this._closeParagraphGapPopup();
            };
            document.addEventListener('mousedown', this._paragraphGapPopupOutsideHandler);
        }, 0);
    }

    _closeParagraphGapPopup() {
        if (this._paragraphGapPopup) {
            this._paragraphGapPopup.remove();
            this._paragraphGapPopup = null;
        }
        if (this._paragraphGapPopupOutsideHandler) {
            document.removeEventListener('mousedown', this._paragraphGapPopupOutsideHandler);
            this._paragraphGapPopupOutsideHandler = null;
        }
    }

    _onTabMarkerDragStart(e, ruler, marker, unitPx) {
        if (this.viewMode !== 'detailed') return;
        e.preventDefault();
        e.stopPropagation();
        marker.classList.add('detail-tab-marker-dragging');

        const isLHead = marker.classList.contains('detail-tab-marker-lhead');
        const isLEnd = marker.classList.contains('detail-tab-marker-lend');
        const startMouseX = e.clientX;
        const startDataX = parseFloat(marker.dataset.x) || 0;

        const onMove = (ev) => {
            const dx = ev.clientX - startMouseX;
            // J マーカー: マウスが右へ → 右マージン縮小 → data-x (right) 減少 → ルーラ拡大
            // L/F/タブ: マウスが右へ → data-x 増加
            let newDataX = isLEnd ? (startDataX - dx / unitPx) : (startDataX + dx / unitPx);
            newDataX = Math.max(0, Math.round(newDataX));
            marker.dataset.x = String(newDataX);
            // L マーカーは var(--ml-px) のみで配置 (CSS variable 連動)、 J マーカーは var(--mr-px)
            // F マーカーとタブマーカーは段落 content 内の offset を ml に加算した位置に表示
            if (!isLHead && !isLEnd) {
                marker.style.left = 'calc(var(--ml-px, 0px) + ' + (newDataX * unitPx) + 'px)';
            }
            // 段落 CSS と data-tab-attrs を即時更新 (ルーラ幅も自動変化)
            this._updateTabFormatAttrs(ruler);
        };
        const onUp = (ev) => {
            marker.classList.remove('detail-tab-marker-dragging');
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            this.isModified = true;
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }

    /**
     * ルーラー内の現在のマーカー位置から data-tab-attrs を再構築する。
     * 同時に段落本体の CSS (margin-left/right/text-indent/tab-size) も即時更新して
     * ユーザーの編集が描画に反映されるようにする。
     */
    _updateTabFormatAttrs(ruler) {
        if (!ruler) return;
        const fhead = ruler.querySelector('.detail-tab-marker-fhead');
        const lhead = ruler.querySelector('.detail-tab-marker-lhead');
        const lend = ruler.querySelector('.detail-tab-marker-lend');
        const tabs = ruler.querySelectorAll('.detail-tab-marker-tab');
        const origin = ruler.querySelector('.detail-tab-origin');

        // ruler 内 data-x は文字幅単位、 XML 出力は hunit 単位 (BTRON 仕様)
        // ここで文字幅 → hunit 変換して data-tab-attrs に格納する
        const indent = parseFloat(fhead && fhead.dataset.x) || 0;  // 文字幅
        const left = parseFloat(lhead && lhead.dataset.x) || 0;    // 文字幅
        const right = parseFloat(lend && lend.dataset.x) || 0;     // 文字幅
        const R = origin ? (parseInt(origin.dataset.origin, 10) || 0) : 0;

        const tabVals = [];  // 文字幅 (符号付き: 負値 = decimal align)
        tabs.forEach(t => {
            const x = parseFloat(t.dataset.x) || 0;
            const da = t.classList.contains('detail-tab-marker-tab-decimal');
            tabVals.push(da ? -x : x);
        });

        // ドラッグでは変更されない P / height / pargap は ruler の data-* に保持された初期値を引き継ぐ
        const tabP = ruler.dataset.tabP !== undefined ? ruler.dataset.tabP : '0';
        const tabHeight = ruler.dataset.tabHeight !== undefined ? ruler.dataset.tabHeight : '0';
        const tabPargap = ruler.dataset.tabPargap !== undefined ? ruler.dataset.tabPargap : '0.75';

        // ↓ マーカーが見つからない (DOM 構築途中など) 場合は既存の dataset.tabAttrs を破壊しない
        // これにより詳細→清書→詳細 ラウンドトリップで tabs 値が誤って空になるのを防止
        if (tabVals.length === 0 && tabs.length === 0 && ruler.dataset.tabAttrs) {
            // 既存値を尊重 — マーカー集合が取れていない異常状態では何もしない
            return;
        }

        // 文字幅 → hunit 変換 (BTRON xtad 出力用)
        const indentHunit = this._charWidthToHunit(indent);
        const leftHunit = this._charWidthToHunit(left);
        const rightHunit = this._charWidthToHunit(right);
        const tabsHunit = tabVals.map(v => {
            const sign = v < 0 ? -1 : 1;
            return sign * this._charWidthToHunit(Math.abs(v));
        });

        const newAttrs = 'R="' + R + '" P="' + tabP + '" height="' + tabHeight + '" pargap="' + tabPargap + '" left="' + leftHunit + '" right="' + rightHunit + '" indent="' + indentHunit + '" ntabs="' + tabVals.length + '" tabs="' + tabsHunit.join(',') + '"';
        ruler.dataset.tabAttrs = newAttrs;
        // 段落の data-tab-format JSON も同期更新する (シリアライザ L107-124 の差分判定 = カスケード継承段落への
        // 余分な <tab-format> 出力防止のため、 ruler 値と段落 JSON を常に一致させる必要がある)
        // 注意: parser 由来の data-tab-format は {R, P, height, pargap, left, right, indent, ntabs, tabs (絶対値), tabsDecimalAlign} の構造で、
        //       同じ形式で書き戻さないと parser 由来の継承段落 (前後) と JSON 文字列が一致せず、 差分判定で重複出力される
        const _para = ruler.closest('p, div');
        // parser の data-tab-format JSON は hunit ベース (parser の _parseTabFormatAttrs と整合)
        const tabFormatJson = {
            R: R,
            P: parseInt(tabP) || 0,
            height: tabHeight,
            pargap: tabPargap,
            left: leftHunit,
            right: rightHunit,
            indent: indentHunit,
            ntabs: tabVals.length,
            tabs: tabsHunit.map(v => Math.abs(v)),
            tabsDecimalAlign: tabsHunit.map(v => v < 0)
        };
        const tabFormatJsonStr = JSON.stringify(tabFormatJson);
        if (_para) {
            // v2: シリアライザは ruler/hidden span を SSOT とするため、 段落 data-tab-format JSON は CSS 計算用としてのみ保持
            // (data-tab-format-explicit フラグは v2 で撤回)
            _para.setAttribute('data-tab-format', tabFormatJsonStr);
        }

        // ルーラの CSS variable を更新 (ルーラ幅・各マーカー位置が連動)
        // ruler 内は文字幅単位なので CHAR_UNIT_PX で px 換算 (フォントサイズ非依存)
        ruler.style.setProperty('--ml-px', (left * window.CHAR_UNIT_PX) + 'px');
        ruler.style.setProperty('--mr-px', (right * window.CHAR_UNIT_PX) + 'px');
        ruler.style.setProperty('--indent-px', (indent * window.CHAR_UNIT_PX) + 'px');

        // 段落本体の CSS を即時更新
        // BTRON 仕様: タブ書式の効果は「次のタブ書式付箋が現れるまで」継続するため、
        // ルーラーがある段落を含め、 後続の段落のうち次のルーラー(または隠し span)を持たないものへ
        // 同じ CSS を適用する
        const paragraph = ruler.closest('p, div');
        if (paragraph) {
            // 段落 CSS は hunit ベースで計算 (parser の text-tad-parser.js Line 1186 と整合)
            // BTRON 仕様: left/right/indent/tabs[i] は hunit 単位、 px 変換は hunitToPx = DPI / |docScale.hunit|
            const hunitToPx = Math.abs(window.DPI / ((this.docScale && this.docScale.hunit) || -120));
            // pargap を段落の margin-top/bottom に反映 (フォントサイズ × pargap)
            const pargapValueNum = parseFloat(tabPargap);
            const applyCss = (p) => {
                p.style.marginLeft = (leftHunit * hunitToPx) + 'px';
                p.style.marginRight = (rightHunit * hunitToPx) + 'px';
                // <indent/> anchor がある段落は text-indent を上書きしない
                // (パーサが anchor 前のテキスト幅で text-indent: -padding-left を設定済み、 上書きで字下げが消えるのを防止)
                if (!p.querySelector('.indent-anchor')) {
                    p.style.textIndent = (indentHunit * hunitToPx) + 'px';
                }
                if (tabsHunit.length > 0) {
                    const tabIntervalPx = Math.abs(tabsHunit[0]) * hunitToPx;
                    if (tabIntervalPx > 0) {
                        p.style.tabSize = tabIntervalPx + 'px';
                        p.style.MozTabSize = tabIntervalPx + 'px';
                    }
                }
                // pargap → 段落間隔 (margin-top/bottom) を即時更新
                if (!isNaN(pargapValueNum)) {
                    // 段落内の最大フォントサイズを取得 (pt 単位、 default 14pt)
                    let fontSizePt = 14;
                    const fontEls = p.querySelectorAll('font[size]');
                    fontEls.forEach(f => {
                        const s = parseFloat(f.getAttribute('size'));
                        if (!isNaN(s) && s > fontSizePt) fontSizePt = s;
                    });
                    const fontSizePx = fontSizePt * 1.333;
                    const pargapPx = pargapValueNum * fontSizePx;
                    p.style.marginTop = pargapPx + 'px';
                    p.style.marginBottom = pargapPx + 'px';
                }
            };
            applyCss(paragraph);
            // 後続の段落へ継承効果を反映
            // v2: 打ち切り条件は元実装に戻す ─「ruler/隠し span を持つ段落」 のみで break
            // (シリアライザは ruler 由来のみ出力するため、 explicit フラグ判定は不要)
            // BTRON 後勝ち継承の境界 = 次の ruler を持つ段落 (= 次の <tab-format> 実在段落)
            let next = paragraph.nextElementSibling;
            while (next) {
                if (next.querySelector && next.querySelector('.detail-tab-format, .hidden-tab-format')) break;
                if (next.tagName === 'P' || next.tagName === 'DIV') {
                    applyCss(next);
                    // 継承段落の data-tab-format JSON も同期 (CSS 計算と整合させるため。 シリアライザは見ない)
                    next.setAttribute('data-tab-format', tabFormatJsonStr);
                }
                next = next.nextElementSibling;
            }
        }
    }

    /**
     * 詳細モード時、 旗マーク (指定付箋) をクリックすると属性内容をポップアップで表示する
     */
    attachDetailFusenClickHandlers() {
        if (!this.editor) return;
        const fusens = this.editor.querySelectorAll('.docmemo, .page-number, .docoverlay, .fixed-space, .detail-tab-format, .detail-align, span[style*="letter-spacing"]');
        fusens.forEach(el => {
            if (el.dataset.detailHandlerAttached === 'true') return;
            el.dataset.detailHandlerAttached = 'true';
            // タブ書式ルーラーは内部のマーカー操作 (シングルクリック=ドラッグ開始) と
            // 属性ポップアップ表示を区別するため、 ダブルクリックでポップアップを出す
            const triggerEvent = el.classList.contains('detail-tab-format') ? 'dblclick' : 'click';
            el.addEventListener(triggerEvent, async (e) => {
                if (this.viewMode !== 'detailed') return;
                e.preventDefault();
                e.stopPropagation();
                this.editor.querySelectorAll('.detail-selected').forEach(s => s.classList.remove('detail-selected'));
                el.classList.add('detail-selected');
                let info = '';
                if (el.classList.contains('docmemo')) {
                    info = '文章メモ\n内容: ' + (el.dataset.memo || '(なし)');
                } else if (el.classList.contains('page-number')) {
                    info = 'ページ番号\nstep: ' + (el.dataset.step || '') + '\nnum: ' + (el.dataset.num || '');
                } else if (el.classList.contains('docoverlay')) {
                    const attrs = Array.from(el.attributes)
                        .filter(a => a.name.startsWith('data-') && a.name !== 'data-detail-handler-attached')
                        .map(a => a.name.substring(5) + ': ' + a.value).join('\n');
                    info = '用紙オーバーレイ\n' + (attrs || '(属性なし)');
                } else if (el.classList.contains('fixed-space')) {
                    info = '固定幅空白\n幅: ' + (el.dataset.width || '(指定なし)');
                } else if (el.classList.contains('detail-tab-format')) {
                    // タブ書式指定付箋
                    const raw = el.dataset.tabAttrs || '';
                    const decoded = raw.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
                    info = 'タブ書式指定付箋\n' + (decoded || '(属性なし)');
                } else if (el.classList.contains('detail-align')) {
                    // そろえ指定付箋
                    const alignVal = el.dataset.align || '';
                    const alignLabels = {
                        'left': '行頭そろえ (左そろえ)',
                        'center': '中央そろえ',
                        'right': '行末そろえ (右そろえ)',
                        'justify': '両端そろえ'
                    };
                    info = 'そろえ指定付箋\n' + (alignLabels[alignVal] || alignVal || '(未指定)');
                } else if (el.tagName === 'SPAN' && el.style && el.style.letterSpacing) {
                    // 文字間隔指定付箋
                    // CSS style 属性 (letter-spacing) で直接保存
                    const value = el.style.letterSpacing;
                    const labels = {
                        '0em': '文字間隔なし',
                        '0.0625em': '1/16字あき',
                        '0.125em': '1/8字あき',
                        '0.25em': '1/4字あき',
                        '0.375em': '3/8字あき',
                        '0.5em': '1/2字あき',
                        '0.75em': '3/4字あき'
                    };
                    info = '文字間隔指定付箋\n値: ' + (labels[value] || value);
                }
                try {
                    await this.showMessageDialog(info, [{ label: 'OK', value: 'ok' }], 0);
                } catch (err) {
                    logger.error('[EDITOR] 旗マークポップアップエラー:', err);
                }
            });
        });
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
        const baseFontSize = window.convertPtToPx(DEFAULT_FONT_SIZE);

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
                previousNode.style.fontSize === `${DEFAULT_FONT_SIZE}pt` &&
                /^[\t]+$/.test(previousNode.textContent)) {

                // 既存のタブspanに追加
                previousNode.textContent += '\t';

                // カーソルをタブspanの後ろに移動
                range.setStartAfter(previousNode);
                range.setEndAfter(previousNode);
            } else {
                // 新しいタブspanを作成
                const tabSpan = document.createElement('span');
                tabSpan.style.fontSize = `${DEFAULT_FONT_SIZE}pt`;
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
     * 字下げ anchor をカーソル位置に挿入 (行頭移動指定付箋)
     * BTRON <indent/> 仕様: タグの位置までの描画幅が 2 行目以降の左端位置になる
     * - DOM 上はゼロ幅・編集不可の span (.indent-anchor) として保持
     * - シリアライザが anchor → <indent/> として復元
     * - パーサが anchor 前のテキスト/タブ/タブ書式の描画幅を実測して padding-left/text-indent 設定
     * - 詳細モードでは IndentMarkRenderer が anchor の位置にマークを表示
     */
    insertIndentAnchor() {
        const selection = window.getSelection();
        if (selection.rangeCount === 0) return;

        const range = selection.getRangeAt(0);

        // BTRON 仕様: 段落内に <indent/> は 1 個のみ
        // カーソル位置の段落を特定して既存 anchor を全削除してから新規挿入する
        let paragraph = range.startContainer;
        if (paragraph.nodeType === Node.TEXT_NODE) {
            paragraph = paragraph.parentNode;
        }
        while (paragraph && paragraph.nodeName !== 'P' && paragraph !== this.editor) {
            paragraph = paragraph.parentNode;
        }
        if (paragraph && paragraph.nodeName === 'P') {
            const existingAnchors = paragraph.querySelectorAll('.indent-anchor');
            existingAnchors.forEach(el => el.remove());
        }

        // deleteContents の前に selection をエディタの現在位置で更新
        // (anchor 削除で range が無効化される場合の対策)
        const currentRange = selection.rangeCount > 0 ? selection.getRangeAt(0) : range;
        currentRange.deleteContents();

        const anchor = document.createElement('span');
        anchor.className = 'indent-anchor';
        anchor.setAttribute('contenteditable', 'false');

        currentRange.insertNode(anchor);

        currentRange.setStartAfter(anchor);
        currentRange.setEndAfter(anchor);
        selection.removeAllRanges();
        selection.addRange(currentRange);

        this.isModified = true;
        const inputEvent = new Event('input', { bubbles: true, cancelable: true });
        this.editor.dispatchEvent(inputEvent);

        // 挿入直後に字下げ効果を表示へ反映 (anchor 実位置に padding-left を収束させる)
        if (this._realignIndentAnchors) {
            this._realignIndentAnchors();
        }

        this.setStatus('字下げを挿入しました');
        logger.debug('[EDITOR] 字下げ anchor を挿入 (既存削除後)');
    }

    /**
     * 再表示
     */
    refresh() {
        if (this.viewMode === 'xml') {
            this.viewXMLMode();
        } else if (this.viewMode === 'detailed') {
            this.viewDetailedMode();
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
        const newWrap = !this.wrapMode;
        this.applyWordWrapConfig({ wordWrap: newWrap }, { applyWidth: false, paragraphUpdateDelay: 0 });
        const statusMsg = this.wrapMode ? 'ウインドウ幅で折り返し: ON' : 'ウインドウ幅で折り返し: OFF';
        this.setStatus(statusMsg);
        this.updateWindowConfig({ wordWrap: this.wrapMode, viewMode: this.viewMode });
        // wrapMode 切替時、 editor 幅 (用紙幅 or ウィンドウ幅) が変わるためタブ書式ルーラとマーカー位置を再計算する
        // 詳細モード/原稿モードは renderTADXML 経路で editor.style.width も用紙幅に再設定される (parser L916)
        if (this.viewMode === 'detailed' || this.viewMode === 'formatted') {
            this.refresh();
        }
        setTimeout(() => this.updateContentHeight(), window.UI_UPDATE_DELAY_MS);
    }

    /**
     * windowConfig.wordWrap に基づき editor の折り返し設定を適用する共通メソッド。
     * editor の whiteSpace / wordWrap / (条件付きで width) を更新し、
     * 既存段落要素のインラインスタイルも同期する。
     * @param {Object} windowConfig - JSON metadata の window 設定 (wordWrap, width 等)
     * @param {Object} [options]
     * @param {boolean} [options.applyWidth=false] - true のとき wordWrap=true かつ paperWidth なしの場合に editor.style.width を windowConfig.width に設定
     * @param {number} [options.paragraphUpdateDelay=0] - 段落要素のインラインスタイル更新までの delay ms (0=即時)
     * @returns {boolean} 適用後の wrapMode
     */
    applyWordWrapConfig(windowConfig, options = {}) {
        if (!windowConfig) return this.wrapMode;
        const applyWidth = options.applyWidth === true;
        const paragraphUpdateDelay = typeof options.paragraphUpdateDelay === 'number' ? options.paragraphUpdateDelay : 0;

        const wordWrap = windowConfig.wordWrap !== undefined ? windowConfig.wordWrap : true;
        this.wrapMode = wordWrap;

        // ウインドウ幅で折り返し ON の場合、 paperWidth より windowConfig.width を優先
        // (tab-format の left/right による段落 margin は段落単位で別途適用される)
        if (this.wrapMode) {
            if (applyWidth && windowConfig.width) {
                // windowConfig.width が明示されていればそれを設定
                const wpx = windowConfig.width + 'px';
                this.editor.style.width = wpx;
                this.editor.style.minWidth = wpx;
                this.editor.style.maxWidth = wpx;
            } else {
                // wrapMode=true で width 未指定の場合 (toggleWrap で ON にしたケース等)、
                // 過去に paper-based で設定された editor.style.width をクリアして
                // 親要素 (.editor-container) いっぱい広がるようにする
                if (this.editor.style.width || this.editor.style.maxWidth || this.editor.style.minWidth) {
                    this.editor.style.width = '';
                    this.editor.style.minWidth = '';
                    this.editor.style.maxWidth = '';
                }
            }
        }
        // wrapMode=false の場合は paper-based 折り返しが parser L890 で適用される

        if (this.wrapMode) {
            this.editor.style.whiteSpace = 'pre-wrap';
            this.editor.style.wordWrap = 'break-word';
        } else {
            this.editor.style.whiteSpace = 'pre';
            this.editor.style.wordWrap = 'normal';
        }

        const updateParagraphs = () => {
            const paragraphs = this.editor.querySelectorAll('p');
            paragraphs.forEach(p => {
                p.style.whiteSpace = this.wrapMode ? 'pre-wrap' : 'pre';
            });
        };
        if (paragraphUpdateDelay > 0) {
            setTimeout(updateParagraphs, paragraphUpdateDelay);
        } else {
            updateParagraphs();
        }

        // 用紙幅折り返しを即時反映 (wrapMode=false + paperWidth + paperMargin がある場合のみ)
        this._applyPaperWidthToEditor();

        return this.wrapMode;
    }

    /**
     * 用紙幅 (paperWidth − paperMargin 左右余白) を editor.style.width に適用する共通メソッド。
     * BTRON 仕様準拠: 「ウインドウ幅で折り返し OFF + paperMargin あり」 で本文レイアウト領域マージンに合わせて
     * editor 幅を絞り込み、 用紙幅で折り返しさせる。
     * wrapMode=true (ウインドウ幅で折り返し) の場合は editor.style.width をクリアして親要素いっぱい広げる。
     * XML モード (this.viewMode === 'xml') では editor 幅を変更しない (原稿モードは直接 XML 編集のため)。
     *
     * 呼出元:
     * - toggleWrap() / applyWordWrapConfig() (即時反映)
     * - renderTADXML (parser 経由、 初回描画時) ← Phase γ で重複ロジック削除済、 ここから呼出
     */
    _applyPaperWidthToEditor() {
        if (!this.editor) return;
        // XML モードは編集対象が <pre> なので editor 幅を変更しない
        if (this.viewMode === 'xml') return;

        // wrapMode=true (ウインドウ幅で折り返し) の場合、 paper-based の width を解除して親要素に追従させる
        if (this.wrapMode === true) {
            if (this.editor.style.width || this.editor.style.maxWidth || this.editor.style.minWidth) {
                this.editor.style.width = '';
                this.editor.style.minWidth = '';
                this.editor.style.maxWidth = '';
            }
            return;
        }

        // wrapMode=false + paperWidth + paperMargin + docScale がある場合のみ用紙幅で折り返し
        if (!this.paperWidth || !this.paperMargin || !this.docScale) return;

        const binding = this.paperSize ? (this.paperSize.binding || 0) : 0;
        const imposition = this.paperSize ? (this.paperSize.imposition || 0) : 0;
        const effLeft = typeof this.paperMargin.getEffectiveLeft === 'function'
            ? this.paperMargin.getEffectiveLeft(binding, imposition, 1)
            : (this.paperMargin.left || 0);
        const effRight = typeof this.paperMargin.getEffectiveRight === 'function'
            ? this.paperMargin.getEffectiveRight(binding, imposition, 1)
            : (this.paperMargin.right || 0);
        const cu = this.paperWidth - effLeft - effRight;
        if (cu <= 0) return;

        const h = Number(this.docScale.hunit) || 0;
        const f = h === 0 ? 1 : (h < 0 ? 96 / Math.abs(h) : h);
        const cpx = Math.ceil(cu * f);
        const cpxStr = cpx + 'px';
        this.editor.style.width = cpxStr;
        this.editor.style.minWidth = cpxStr;
        this.editor.style.maxWidth = cpxStr;
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
                    chsz: DEFAULT_FONT_SIZE,
                    frcol: DEFAULT_FRCOL,
                    chcol: DEFAULT_CHCOL,
                    tbcol: DEFAULT_TBCOL,
                    bgcol: DEFAULT_BGCOL,
                    pictdisp: 'true',
                    namedisp: 'true',
                    framedisp: 'true'
                };

                // 仮身要素を作成
                const vobjElement = this.virtualObjectRenderer.createInlineElement(virtualObject, {
                    loadIconCallback: (realId) => this.iconManager ? this.iconManager.loadIconWithRetry(realId) : Promise.resolve(null)
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
            // 直前または直後の段落から CSS を継承 (タブ書式・字下げ・行揃え等を維持)
            const refP = (element.previousElementSibling && element.previousElementSibling.tagName === 'P')
                ? element.previousElementSibling
                : (element.nextElementSibling && element.nextElementSibling.tagName === 'P')
                    ? element.nextElementSibling
                    : null;
            if (refP) this.inheritParagraphStyle(refP, p);
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
            size: String(DEFAULT_FONT_SIZE),
            color: DEFAULT_CHCOL,
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

                // xmlTAD標準形式で出力（href/left/top/right/bottom属性）
                xmlParts.push(`<image lineType="0" lineWidth="0" l_pat="0" f_pat="0" angle="0" rotation="0" flipH="false" flipV="false" left="0" top="0" right="${displayWidth}" bottom="${displayHeight}" href="__IMAGE_${imageFiles.length - 1}__"/>`);
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

        // 黒色（rgb(0, 0, 0)）以外の場合のみ hex 形式で返す
        // (カラーピッカーが hex 形式 #RRGGBB を要求するため)
        if (color && color !== 'rgb(0, 0, 0)') {
            return this.rgbToHex(color);
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
                        tabSpan.style.fontSize = `${DEFAULT_FONT_SIZE}pt`;
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
                    if (node.style.fontSize === `${DEFAULT_FONT_SIZE}pt`) {
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
                    node.style.fontSize = `${DEFAULT_FONT_SIZE}pt`;
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
    updateParagraphLineHeight(updateAll = false) {
        let paragraphs;

        if (updateAll) {
            // 全段落を対象（ペースト後など）
            paragraphs = Array.from(this.editor.querySelectorAll('p'));
        } else {
            // 選択範囲内の段落のみ対象（通常の編集時）
            const selection = window.getSelection();
            if (!selection.rangeCount) return;
            const range = selection.getRangeAt(0);

            const paragraphSet = new Set();

            // 開始位置の段落を取得
            let startParagraph = range.startContainer;
            while (startParagraph && startParagraph.nodeName !== 'P' && startParagraph !== this.editor) {
                startParagraph = startParagraph.parentElement;
            }
            if (startParagraph && startParagraph.nodeName === 'P') {
                paragraphSet.add(startParagraph);
            }

            // 終了位置の段落を取得
            let endParagraph = range.endContainer;
            while (endParagraph && endParagraph.nodeName !== 'P' && endParagraph !== this.editor) {
                endParagraph = endParagraph.parentElement;
            }
            if (endParagraph && endParagraph.nodeName === 'P') {
                paragraphSet.add(endParagraph);
            }

            // 選択範囲内の段落をすべて取得
            const allParagraphs = Array.from(this.editor.querySelectorAll('p'));
            const startIndex = allParagraphs.indexOf(startParagraph);
            const endIndex = allParagraphs.indexOf(endParagraph);
            if (startIndex !== -1 && endIndex !== -1) {
                for (let i = startIndex; i <= endIndex; i++) {
                    paragraphSet.add(allParagraphs[i]);
                }
            }

            paragraphs = Array.from(paragraphSet);
        }

        // 各段落について更新
        paragraphs.forEach(paragraph => {
            this._updateSingleParagraphLineHeight(paragraph);
        });
    }

    /**
     * 単一段落のline-heightとfont-sizeを更新
     * @param {HTMLElement} paragraph - 対象の段落要素
     */
    _updateSingleParagraphLineHeight(paragraph) {
        if (!paragraph || paragraph.nodeName !== 'P') return;

        // 段落内のすべてのフォントサイズを取得
        // line-height計算用（仮身含む全要素）とXML保存用（テキスト要素のみ）を分離
        let maxFontSizeForLineHeight = 14; // line-height計算用（仮身含む）
        let maxFontSizeForText = 14;       // XML保存用（テキスト要素のみ）

        const allElements = paragraph.querySelectorAll('font, span');
        allElements.forEach(el => {
            if (el.style.fontSize) {
                const rawSize = parseFloat(el.style.fontSize);
                if (!isNaN(rawSize)) {
                    // px単位の場合はpt単位に変換（1pt = 4/3px）
                    const sizePt = el.style.fontSize.includes('px') ? window.convertPxToPt(rawSize) : rawSize;

                    // line-height計算用は全要素を含む
                    if (sizePt > maxFontSizeForLineHeight) {
                        maxFontSizeForLineHeight = sizePt;
                    }

                    // XML保存用は仮身要素を除外（chszは仮身表示用であり段落のテキストフォントサイズとは無関係）
                    const isVirtualObject = (el.classList && el.classList.contains('virtual-object')) ||
                                            (el.closest && el.closest('.virtual-object'));
                    if (!isVirtualObject && sizePt > maxFontSizeForText) {
                        maxFontSizeForText = sizePt;
                    }
                }
            }
        });

        // tab-formatからline-height比率を取得
        let lineHeightRatio = 1.5; // デフォルト
        const tabFormatAttr = paragraph.getAttribute('data-tab-format');
        if (tabFormatAttr) {
            try {
                const tabFormat = JSON.parse(tabFormatAttr);
                const heightVal = parseFloat(tabFormat.height);
                if (!isNaN(heightVal) && heightVal > 0) {
                    lineHeightRatio = 1 + heightVal; // ギャップ率→総合比率
                }
            } catch (e) { /* ignore parse error */ }
        }

        // line-heightを設定（pt→px変換: ×4/3）
        // ※仮身を含む全要素の最大フォントサイズを使用（段落の行高さに仮身サイズが影響するため）
        const lineHeight = window.convertPtToPx(maxFontSizeForLineHeight) * lineHeightRatio;
        paragraph.style.lineHeight = `${lineHeight}px`;

        // 段落レベルのfont-sizeを更新（XML保存時にextractFontSize()が正しい値を返すように）
        // ※テキスト要素のみの最大フォントサイズを使用（仮身のchszは段落のテキストフォントサイズとは無関係）
        paragraph.style.fontSize = `${maxFontSizeForText}pt`;
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
            fontSizePt = window.convertPxToPt(fontSizePt);
        }
        if (Math.abs(fontSizePt - DEFAULT_FONT_SIZE) > 0.5) return true;

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
            fontSizePt = window.convertPxToPt(fontSizePt);
        }
        if (Math.abs(fontSizePt - DEFAULT_FONT_SIZE) > 0.5) {
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
    /**
     * 文字間隔を適用
     * @param {string} value - 文字間隔値（em単位、例: '0.125'）
     */
    applyCharSpacing(value) {
        const selection = window.getSelection();
        if (!selection.rangeCount) return;

        const range = selection.getRangeAt(0);
        const emValue = parseFloat(value);

        if (range.collapsed) {
            // 選択範囲なし（カーソルのみ）: letter-spacing付きspanを挿入
            const span = document.createElement('span');
            if (emValue > 0) {
                span.style.letterSpacing = `${value}em`;
            }
            span.appendChild(document.createTextNode('\u200B'));
            range.insertNode(span);

            // カーソルをspan内に配置
            const newRange = document.createRange();
            newRange.setStart(span.firstChild, 1);
            newRange.collapse(true);
            selection.removeAllRanges();
            selection.addRange(newRange);
        } else {
            // 選択範囲あり: 選択範囲をspanで囲む
            const content = range.extractContents();
            const span = document.createElement('span');
            if (emValue > 0) {
                span.style.letterSpacing = `${value}em`;
            }
            span.appendChild(content);
            range.insertNode(span);

            // 選択範囲をspan全体に設定
            const newRange = document.createRange();
            newRange.selectNodeContents(span);
            selection.removeAllRanges();
            selection.addRange(newRange);
        }

        this.isModified = true;

        // input イベントを発火
        const inputEvent = new Event('input', { bubbles: true, cancelable: true });
        this.editor.dispatchEvent(inputEvent);

        // ステータス表示
        const labels = {
            '0': '文字間隔なし',
            '0.0625': '1/16字あき',
            '0.125': '1/8字あき',
            '0.25': '1/4字あき',
            '0.375': '3/8字あき',
            '0.5': '1/2字あき',
            '0.75': '3/4字あき'
        };
        this.setStatus(`文字間隔: ${labels[value] || value}`);
    }

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
        const color = await this.showInputDialog('文字色を入力してください（例: #ff0000, #000000）', this.rgbToHex(document.queryCommandValue('foreColor')) || DEFAULT_CHCOL, 20, { colorPicker: true });
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
        // テキストは設定しない (詳細モードでは CSS の P 囲み記号のみ表示)

        const selection = window.getSelection();
        if (selection.rangeCount === 0) return;

        const range = selection.getRangeAt(0);

        // カーソル位置の親段落 (p 要素) を探す
        let pNode = range.startContainer;
        if (pNode.nodeType === Node.TEXT_NODE) pNode = pNode.parentNode;
        while (pNode && pNode !== this.editor && pNode.nodeName !== 'P') {
            pNode = pNode.parentNode;
        }

        if (pNode && pNode.nodeName === 'P' && pNode.parentNode === this.editor) {
            // 段落内にカーソルがある場合は段落の直後 (= editor 直下) に改ページを配置
            // シリアライザは editor 直下の .page-break のみ <pagebreak/> として出力するため
            this.editor.insertBefore(pageBreak, pNode.nextSibling);
        } else {
            // 段落外なら通常通り挿入位置に
            range.insertNode(pageBreak);
        }

        this.setStatus('改ページを挿入しました');
        this.isModified = true;
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

    destroy() {
        // MutationObserverの切断
        if (this.mutationObserver) {
            this.mutationObserver.disconnect();
            this.mutationObserver = null;
        }
        // タイマーのクリア
        if (this.updateHeightTimer) {
            clearTimeout(this.updateHeightTimer);
            this.updateHeightTimer = null;
        }
        // メモリ解放: DOM参照・データのクリア
        this.selectedImage = null;
        this.selectedFigureSegment = null;
        this.figureSegmentClipboard = null;
        this.imageClipboard = null;
        this.virtualObjectClipboard = null;
        this.draggingImage = null;
        this.draggingVirtualObject = null;
        this.draggingVirtualObjectData = null;
        this.contextMenuSelectedImage = null;
        this.contextMenuVirtualObject = null;
        this.recentFonts = [];
        this.systemFonts = [];
        this.editor = null;
        if (this.dblClickDragState && this.dblClickDragState.rafId) {
            cancelAnimationFrame(this.dblClickDragState.rafId);
            this.dblClickDragState.rafId = null;
        }
        // ダブルクリック+ドラッグ用のグローバルイベントリスナーを解除
        if (this._dblClickDragMouseMoveHandler) {
            document.removeEventListener('mousemove', this._dblClickDragMouseMoveHandler);
            this._dblClickDragMouseMoveHandler = null;
        }
        if (this._dblClickDragMouseUpHandler) {
            document.removeEventListener('mouseup', this._dblClickDragMouseUpHandler);
            this._dblClickDragMouseUpHandler = null;
        }
        this.dblClickDragState = null;
        super.destroy();
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
        const elements = this.editor.querySelectorAll('img[data-img-no]');
        elements.forEach(el => {
            const imgNo = parseInt(el.getAttribute('data-img-no'));
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

        // 図形セグメントのiframeを初期化
        this.initFigureSegmentIframes();
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
        img.style.outline = `2px solid ${PREVIEW_BORDER_COLOR}`;
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
        handle.style.backgroundColor = `${PREVIEW_BORDER_COLOR}`;
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
            indicator.style.backgroundColor = `${PREVIEW_BORDER_COLOR}`;
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

        if (globalClipboard && globalClipboard.type === 'tad-xml' && globalClipboard.xml) {
            // 仮身を含むXMLフラグメントがある場合（右クリックコピー等）
            await this.pasteTadXmlFragment(globalClipboard.xml, globalClipboard.text);
        } else if (globalClipboard && globalClipboard.link_id) {
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
            this.insertPlainText(globalClipboard.text);
            this.setStatus('テキストをクリップボードから貼り付けました');
        } else if (globalClipboard && globalClipboard.type === 'figure-segment') {
            // 図形セグメント（グラフ等）はCanvas描画で貼り付け（xmlTadデータ保持）
            await this.insertFigureSegment(globalClipboard.xmlTad, globalClipboard.sourceRealId);
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
            this.insertPlainText(globalClipboard.text);
            this.setStatus('テキストをクリップボードから移動しました');
            // グローバルクリップボードをクリア（移動なので）
            this.setClipboard(null);
        } else if (globalClipboard && globalClipboard.type === 'figure-segment') {
            // 図形セグメント（グラフ等）はCanvas描画で貼り付け（xmlTadデータ保持）
            await this.insertFigureSegment(globalClipboard.xmlTad, globalClipboard.sourceRealId);
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
        console.log('[EDITOR:DEBUG] copyTextToClipboard 呼び出し');
        const selection = window.getSelection();
        // 現在の選択テキスト、または保存済みの選択テキストを使用
        // （メニュークリック時にフォーカスが外れて選択が消える場合の対策）
        const selectedText = selection.toString() || this.lastSelectedText;

        if (selectedText) {
            // selection.toString()は<p>境界で\n\nを返すため、\nに正規化
            const normalizedText = selectedText.replace(/\n\n/g, '\n');

            // 選択範囲に仮身(virtual-object)を含むか確認
            // 含む場合はグローバルクリップボードにXMLとして保存（仮身情報を保持するため）
            let xmlContent = null;
            if (selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                const container = range.cloneContents();
                if (container.querySelector('.virtual-object')) {
                    const tempDiv = document.createElement('div');
                    tempDiv.appendChild(container);
                    // 段落ごとに個別処理してXML生成（複数段落対応 + fontSize明示付与）
                    xmlContent = this.buildCopyXmlFromContainer(tempDiv, selection);
                }
            }

            if (xmlContent) {
                // 仮身を含む場合: XMLをグローバルクリップボードに保存（type: 'tad-xml'）
                console.log('[EDITOR:DEBUG] copyTextToClipboard XMLを保存:', xmlContent);
                this.setClipboard({
                    type: 'tad-xml',
                    xml: xmlContent,
                    text: normalizedText
                });
            } else {
                // 通常テキスト: グローバルクリップボードにテキストとして保存
                this.setTextClipboard(normalizedText);
            }

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
        console.log('[EDITOR:DEBUG] cutTextToClipboard 呼び出し');
        const selection = window.getSelection();
        // 現在の選択テキスト、または保存済みの選択テキストを使用
        const selectedText = selection.toString() || this.lastSelectedText;

        if (selectedText) {
            // selection.toString()は<p>境界で\n\nを返すため、\nに正規化
            const normalizedText = selectedText.replace(/\n\n/g, '\n');

            // 選択範囲に仮身(virtual-object)を含むか確認
            // 含む場合はグローバルクリップボードにXMLとして保存（仮身情報を保持するため）
            let xmlContent = null;
            if (selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                const container = range.cloneContents();
                if (container.querySelector('.virtual-object')) {
                    const tempDiv = document.createElement('div');
                    tempDiv.appendChild(container);
                    // 段落ごとに個別処理してXML生成（複数段落対応 + fontSize明示付与）
                    xmlContent = this.buildCopyXmlFromContainer(tempDiv, selection);
                }
            }

            if (xmlContent) {
                // 仮身を含む場合: XMLをグローバルクリップボードに保存（type: 'tad-xml'）
                console.log('[EDITOR:DEBUG] cutTextToClipboard XMLを保存:', xmlContent);
                this.setClipboard({
                    type: 'tad-xml',
                    xml: xmlContent,
                    text: normalizedText
                });
            } else {
                // 通常テキスト: グローバルクリップボードにテキストとして保存
                this.setTextClipboard(normalizedText);
            }

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
     * プレーンテキストをHTMLに変換してエディタに挿入
     * \n\n（改段落）は段落区切り（</p><p>）に、\n（改行）は<br>に変換する
     * @param {string} text - 挿入するテキスト
     */
    insertPlainText(text) {
        if (!text) return;
        const normalized = normalizePasteText(text);

        // カーソル位置の段落から全 CSS / data-tab-format を新段落に継承
        // (タブ書式・字下げ・行揃え・禁則指定・行間隔をペースト後も維持するため)
        let paragraphStyle = '';
        let tabFormatJsonAttr = '';
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            let currentP = selection.getRangeAt(0).startContainer;
            while (currentP && currentP.nodeName !== 'P' && currentP !== this.editor) {
                currentP = currentP.parentElement;
            }
            if (currentP && currentP.nodeName === 'P') {
                // 一時段落に共通ヘルパー経由で継承させ、 結果を文字列化して挿入用 HTML に埋め込む
                const tempP = document.createElement('p');
                this.inheritParagraphStyle(currentP, tempP);
                paragraphStyle = (tempP.getAttribute('style') || '').replace(/"/g, '&quot;');
                const tf = tempP.getAttribute('data-tab-format');
                if (tf) tabFormatJsonAttr = ` data-tab-format='${tf.replace(/'/g, '&#39;')}'`;
            }
        }

        // \n\nで段落分割、各段落内の\nを<br>に変換
        // ペースト由来の改行はユーザー意図 → data-user-br でマーキング (詳細モードで ↵ 表示)
        const paragraphs = normalized.split('\n\n');
        const htmlParts = paragraphs.map(para => {
            return para.split('\n').map(line => escapeHtml(line)).join('<br data-user-br="1">');
        });

        if (htmlParts.length === 1) {
            // 単一段落（改段落なし）: <br>のみで結合
            document.execCommand('insertHTML', false, htmlParts[0]);
        } else {
            // 複数段落: </p><p>で段落を区切る (style と data-tab-format を引き継ぐ)
            const styleAttr = paragraphStyle ? ` style="${paragraphStyle}"` : '';
            const html = htmlParts.join(`</p><p${styleAttr}${tabFormatJsonAttr}>`);
            document.execCommand('insertHTML', false, html);
        }
    }

    /**
     * システムクリップボードからテキストをペースト（Electron IPC経由）
     */
    async pasteTextFromClipboard() {
        try {
            const text = await this.getSystemClipboardText();
            if (text) {
                this.insertPlainText(text);
                this.updateParagraphLineHeight(true); // 全段落のline-heightを更新
                this.setStatus('クリップボードから貼り付けました');
            } else {
                this.setStatus('クリップボードにデータがありません');
            }
        } catch (error) {
            this.setStatus('貼り付けに失敗しました');
        }
    }

    /**
     * 図形セグメントをiframe（figure-editor埋め込み）で貼り付け
     * xmlTadデータをdata属性に保持し、figure-editorで描画を委譲する
     * @param {string} xmlTad - 図形のxmlTadデータ
     * @param {string} [sourceRealId] - コピー元の実身ID（pixelmap等の画像ファイル参照解決用）
     */
    async insertFigureSegment(xmlTad, sourceRealId) {
        try {
            // xmlTadからfigView寸法を取得
            const parser = new DOMParser();
            const doc = parser.parseFromString(xmlTad, 'text/xml');
            const figView = doc.querySelector('figView');
            if (!figView) {
                this.setStatus('図形データの解析に失敗しました');
                return;
            }

            // <figure>が実際の図形描画要素を含むか検証
            // <document>のみの<figure>（テキストボックスのみ）はテキストとして貼り付ける
            const figure = doc.querySelector('figure');
            if (figure) {
                const hasDrawingElements = figure.querySelector('rect, ellipse, polyline, group, image, pixelmap');
                if (!hasDrawingElements) {
                    this._insertDocumentOnlyFigureAsText(figure);
                    return;
                }
            }
            const width = parseInt(figView.getAttribute('right')) - parseInt(figView.getAttribute('left'));
            const height = parseInt(figView.getAttribute('bottom')) - parseInt(figView.getAttribute('top'));

            // figure-segmentコンテナを作成
            const container = this.createFigureSegmentElement(xmlTad, width, height, sourceRealId);

            // カーソル位置に挿入
            const selection = window.getSelection();
            if (selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                range.deleteContents();
                range.insertNode(container);
                range.setStartAfter(container);
                range.setEndAfter(container);
                selection.removeAllRanges();
                selection.addRange(range);
            } else {
                this.editor.appendChild(container);
            }

            // iframe初期化（load-dataメッセージ送信）
            this.initFigureSegmentIframes();

            this.updateContentHeight();
            this.isModified = true;
            this.setStatus('図形セグメントを貼り付けました');
        } catch (error) {
            this.setStatus('図形セグメントの貼り付けに失敗しました');
        }
    }

    /**
     * <document>のみの<figure>からテキスト内容を抽出してカーソル位置に貼り付ける
     * @param {Element} figure - <figure>要素（DOMParserで解析済み）
     */
    _insertDocumentOnlyFigureAsText(figure) {
        const docElements = figure.querySelectorAll('document');
        if (docElements.length === 0) return;

        // 全<document>からテキストノードと<br/>を抽出
        const fragment = document.createDocumentFragment();
        docElements.forEach((docElement, index) => {
            // 2つ目以降の<document>の前に改行を挿入
            if (index > 0 && fragment.childNodes.length > 0) {
                fragment.appendChild(document.createElement('br'));
            }
            for (const child of docElement.childNodes) {
                if (child.nodeType === Node.TEXT_NODE) {
                    const text = child.textContent.trim();
                    if (text) {
                        fragment.appendChild(document.createTextNode(text));
                    }
                } else if (child.nodeType === Node.ELEMENT_NODE) {
                    const tagName = child.tagName.toLowerCase();
                    if (tagName === 'br') {
                        fragment.appendChild(document.createElement('br'));
                    }
                    // figView, figDraw, figScale, docView, docDraw, docScale, text, font等のメタデータはスキップ
                }
            }
        });

        if (fragment.childNodes.length === 0) return;

        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            range.deleteContents();
            range.insertNode(fragment);
            range.collapse(false);
            selection.removeAllRanges();
            selection.addRange(range);
        } else {
            this.editor.appendChild(fragment);
        }

        this.isModified = true;
        this.setStatus('テキストを貼り付けました');
    }

    /**
     * figure-segmentコンテナ要素を作成（div + iframe）
     * figure-editorを埋め込みモードで読み込み、図形描画を委譲する
     * @param {string} xmlTad - 図形のxmlTadデータ
     * @param {number} width - 表示幅
     * @param {number} height - 表示高さ
     * @param {string} [sourceRealId] - コピー元の実身ID（pixelmap等の画像ファイル参照解決用）
     * @returns {HTMLElement} figure-segmentコンテナ
     */
    createFigureSegmentElement(xmlTad, width, height, sourceRealId) {
        const container = document.createElement('div');
        container.className = 'figure-segment';
        container.contentEditable = 'false';
        container.style.display = 'inline-block';
        container.style.verticalAlign = 'middle';
        container.style.margin = '4px';
        container.style.width = width + 'px';
        container.style.height = height + 'px';

        const iframe = document.createElement('iframe');
        iframe.src = '../../plugins/basic-figure-editor/index.html?embedded=true';
        iframe.style.width = width + 'px';
        iframe.style.height = height + 'px';
        iframe.style.border = 'none';
        iframe.style.pointerEvents = 'none';
        container.appendChild(iframe);

        // xmlTadをbase64エンコードしてdata属性に保持
        const encoded = btoa(unescape(encodeURIComponent(xmlTad)));
        container.setAttribute('data-figure-xmltad', encoded);

        // コピー元の実身IDを保持（埋め込みfigure-editorでの画像ファイル参照解決用）
        if (sourceRealId) {
            container.setAttribute('data-source-real-id', sourceRealId);
        }

        return container;
    }

    /**
     * 図形セグメントのiframeを初期化（load-dataメッセージ送信）
     * 各iframeにfigure-editorのxmlTadデータを送信する
     */
    initFigureSegmentIframes() {
        const segments = this.editor.querySelectorAll('.figure-segment[data-figure-xmltad]');
        for (const container of segments) {
            const iframe = container.querySelector('iframe');
            if (iframe && !iframe.dataset.initialized) {
                iframe.addEventListener('load', () => {
                    const encoded = container.getAttribute('data-figure-xmltad');
                    if (encoded) {
                        const xmlTad = decodeURIComponent(escape(atob(encoded)));
                        const sourceRealId = container.getAttribute('data-source-real-id') || '';
                        iframe.contentWindow.postMessage({
                            type: 'load-data',
                            realId: sourceRealId,
                            realObject: { xtad: xmlTad },
                            readonly: true,
                            noScrollbar: true
                        }, '*');
                    }
                });
                iframe.dataset.initialized = 'true';
            }
        }
    }

    // 図形描画はfigure-editor（iframe埋め込み）に委譲するため、
    // renderFigureOnCanvas, renderFigureChildren, renderFigureRect,
    // renderFigureEllipse, renderFigurePolyline, renderFigureDocument は削除済み

    /**
     * 図形セグメントをコピー
     * @param {HTMLElement} container - figure-segmentコンテナ
     */
    async copyFigureSegment(container) {
        const figureXmlTadBase64 = container.getAttribute('data-figure-xmltad');
        if (!figureXmlTadBase64) return;

        // base64デコード
        const xmlTad = decodeURIComponent(escape(atob(figureXmlTadBase64)));

        // グローバルクリップボードにfigure-segmentとして設定
        this.setFigureSegmentClipboard(xmlTad);

        // ローカルfigureSegmentClipboardにも保持（ウィンドウ内ペースト用）
        const iframe = container.querySelector('iframe');
        this.figureSegmentClipboard = {
            xmlTad: xmlTad,
            width: iframe ? parseInt(iframe.style.width) || 200 : 200,
            height: iframe ? parseInt(iframe.style.height) || 200 : 200,
            sourceRealId: container.getAttribute('data-source-real-id') || ''
        };
    }

    /**
     * 図形セグメントの選択
     * @param {HTMLElement} container - figure-segmentコンテナ
     */
    selectFigureSegment(container) {
        this.deselectFigureSegment();
        this.deselectImage();
        this.selectedFigureSegment = container;
        container.style.outline = '2px solid #0078d4';
        container.style.outlineOffset = '2px';
    }

    /**
     * 図形セグメントの選択解除
     */
    deselectFigureSegment() {
        if (this.selectedFigureSegment) {
            this.selectedFigureSegment.style.outline = '';
            this.selectedFigureSegment.style.outlineOffset = '';
            this.selectedFigureSegment = null;
        }
    }

    /**
     * ローカルクリップボードから図形セグメントを貼り付け
     */
    async pasteFigureSegment() {
        if (!this.figureSegmentClipboard) return;
        await this.insertFigureSegment(this.figureSegmentClipboard.xmlTad, this.figureSegmentClipboard.sourceRealId);
    }

    /**
     * システムクリップボードからテキストを移動（貼り付け後クリア）
     */
    async pasteMoveTextFromClipboard() {
        try {
            const text = await this.getSystemClipboardText();
            if (text) {
                this.insertPlainText(text);
                this.updateParagraphLineHeight(true); // 全段落のline-heightを更新
                // システムクリップボードをクリア
                try { await navigator.clipboard.writeText(''); } catch (e) { /* ignore */ }
                this.setStatus('クリップボードから移動しました');
            } else {
                this.setStatus('クリップボードにデータがありません');
            }
        } catch (error) {
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
    // 仮身処理系メソッドは text-virtual-object.js に移動

    openTrashRealObjects() {
        window.RealObjectSystem.openTrashRealObjects(this);
    }

    /**
     * 仮身ネットワークウィンドウを開く
     */
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
            if (wId === windowId || (wId && wId.windowId === windowId)) {
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

        // 用紙サイズ選択肢を生成 (BTRON GUI に近づけて 「用紙: 縦」 「用紙: 横」 の両方向を列挙)
        const paperOptions = this.getPaperSizeOptions();
        const currentSizeName = this.paperSize.getSizeName() || 'CUSTOM';
        // 現在の用紙が縦向き (width <= length) か横向きかを判定
        const curIsPortrait = this.paperSize.widthMm <= this.paperSize.lengthMm;
        const currentOrientedKey = (currentSizeName === 'CUSTOM') ? 'CUSTOM' : `${currentSizeName}_${curIsPortrait ? 'P' : 'L'}`;

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
            // 縦/横の両バリエーションを追加
            const baseW = Math.min(opt.widthMm, opt.lengthMm);   // 短辺
            const baseL = Math.max(opt.widthMm, opt.lengthMm);   // 長辺
            const portraitKey = `${opt.key}_P`;
            const landscapeKey = `${opt.key}_L`;
            const selectedP = portraitKey === currentOrientedKey ? 'selected' : '';
            const selectedL = landscapeKey === currentOrientedKey ? 'selected' : '';
            paperOptionsHtml += `<option value="${portraitKey}" data-w="${baseW}" data-l="${baseL}" ${selectedP}>${opt.label}: 縦</option>`;
            paperOptionsHtml += `<option value="${landscapeKey}" data-w="${baseL}" data-l="${baseW}" ${selectedL}>${opt.label}: 横</option>`;
        });
        paperOptionsHtml += '<option disabled>──────────</option>';
        paperOptionsHtml += `<option value="CUSTOM" ${currentOrientedKey === 'CUSTOM' ? 'selected' : ''}>カスタム</option>`;

        // 現在の値（0.01mm精度で丸めて誤差蓄積を軽減）
        const curWidth = Math.round(this.paperSize.widthMm * 100) / 100;
        const curHeight = Math.round(this.paperSize.lengthMm * 100) / 100;
        // BTRON GUI 仕様準拠: 「余白」 は本文レイアウト領域マージン = paperMargin (docmargin) から読む
        // (paper 自身の top/left/right/bottom はオーバーレイ領域マージンで、 別途ヘッダ/フッタ画面で管理)
        const marginTopPt = this.paperMargin ? this.paperMargin.top : 0;
        const marginBottomPt = this.paperMargin ? this.paperMargin.bottom : 0;
        const marginLeftPt = this.paperMargin ? this.paperMargin.left : 0;
        const marginRightPt = this.paperMargin ? this.paperMargin.right : 0;
        const curTopMm = Math.round(window.pointsToMm(marginTopPt) * 100) / 100;
        const curBottomMm = Math.round(window.pointsToMm(marginBottomPt) * 100) / 100;
        const curLeftMm = Math.round(window.pointsToMm(marginLeftPt) * 100) / 100;
        const curRightMm = Math.round(window.pointsToMm(marginRightPt) * 100) / 100;
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
                    height: 100px;
                    padding: 2px 4px;
                    border: 1px inset #c0c0c0;
                    font-size: 11px;
                    background: #ffffff;
                }
                .paper-setup-dialog .paper-row-with-list {
                    display: flex;
                    align-items: flex-start;
                    gap: 8px;
                    margin-bottom: 4px;
                }
                .paper-setup-dialog .paper-dimensions {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                    padding-top: 2px;
                }
                .paper-setup-dialog .paper-dim-row {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                }
                .paper-setup-dialog .paper-dim-row label { width: 28px; text-align: right; }
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
                <div class="paper-row-with-list">
                    <span class="form-label" style="padding-top:2px;">用紙:</span>
                    <select id="paperSizeSelect" class="form-select" size="6">
                        ${paperOptionsHtml}
                    </select>
                    <div class="paper-dimensions">
                        <div class="paper-dim-row">
                            <label>縦:</label>
                            <input type="number" id="paperHeight" class="form-input" value="${curHeight}" min="10" max="2000" step="0.1">
                            <span class="form-unit">mm</span>
                        </div>
                        <div class="paper-dim-row">
                            <label>横:</label>
                            <input type="number" id="paperWidth" class="form-input" value="${curWidth}" min="10" max="2000" step="0.1">
                            <span class="form-unit">mm</span>
                        </div>
                    </div>
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

                    // 用紙サイズ選択時、 選択された option の data-w / data-l から寸法を反映 (縦/横バリエーション対応)
                    paperSelect.addEventListener('change', function() {
                        const opt = this.options[this.selectedIndex];
                        if (opt && opt.dataset && opt.dataset.w && opt.dataset.l) {
                            widthInput.value = opt.dataset.w;
                            heightInput.value = opt.dataset.l;
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
            title: 'レイアウト用紙設定',
            dialogHtml: dialogHtml,
            buttons: [
                { label: '取消', value: 'cancel' },
                { label: 'ヘッダ/フッタ', value: 'headerFooter' },
                { label: '標準設定', value: 'default' },
                { label: '設定', value: 'ok' }
            ],
            defaultButton: 3,
            width: 480
        });

        if (!result) {
            return false;
        }

        // 「ヘッダ/フッタ」 ボタン押下時はサブダイアログに遷移し、 戻り次第用紙設定ダイアログを再表示 (BTRON GUI 同等の挙動)
        if (result.button === 'headerFooter') {
            await this.showHeaderFooterSetup();
            // 再帰呼出で用紙設定ダイアログを再表示 (現在の paperSize/paperMargin 値で開く)
            return await this.showPageSetup();
        }

        // カーソル位置の段落を判定 (BTRON 仕様準拠の挿入位置決定用)
        const cursorParagraph = this._getCursorParagraph();
        const allParagraphs = this.editor ? this.editor.querySelectorAll('p') : [];
        const isFirstParagraph = !cursorParagraph || allParagraphs.length === 0 || cursorParagraph === allParagraphs[0];

        if (result.button === 'default') {
            // 標準設定（A4 + BTRON 標準余白）にリセット
            // 標準設定は常に文書全体の設定として扱う (= 文章開始セグメント直後の <paper>/<docmargin> を書き換え)
            this.paperSize.resetToDefault();
            this.paperWidth = this.paperSize.width;
            this.paperHeight = this.paperSize.length;
            // BTRON GUI 仕様準拠: paperMargin (docmargin) も標準値にリセット (BTRON 標準: 上 20mm / 下 20mm / 左 20mm / 右 10mm)
            if (!this.paperMargin) {
                this.paperMargin = new window.PaperMargin();
            }
            this.paperMargin.top = window.mmToPoints(20);
            this.paperMargin.bottom = window.mmToPoints(20);
            this.paperMargin.left = window.mmToPoints(20);
            this.paperMargin.right = window.mmToPoints(10);
            this.isModified = true;
            this.setStatus('用紙設定を標準（A4）にリセットしました');
            // 即時反映
            this._applyPaperWidthAndRefresh();
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

            // BTRON 仕様準拠の挿入位置決定:
            //   isFirstParagraph=true (カーソルが 1 段落目 or 文章開始セグメント直後): 文書冒頭の <paper>/<docmargin> を書き換え
            //   isFirstParagraph=false (中間段落): カーソル段落の直前に hidden-paper-change span を挿入し、 シリアライザで改ページ + <paper> + <docmargin> を出力
            if (isFirstParagraph) {
                // 文書全体の用紙設定を更新 (= 文章開始セグメント直後の <paper>/<docmargin> を書き換え)
                this.paperSize.widthMm = width;
                this.paperSize.lengthMm = height;
                this.paperSize.imposition = imposition;
                if (!this.paperMargin) {
                    this.paperMargin = new window.PaperMargin();
                }
                this.paperMargin.top = window.mmToPoints(marginTop);
                this.paperMargin.bottom = window.mmToPoints(marginBottom);
                this.paperMargin.left = window.mmToPoints(marginLeft);
                this.paperMargin.right = window.mmToPoints(marginRight);
                // ポイント単位でも更新
                this.paperWidth = this.paperSize.width;
                this.paperHeight = this.paperSize.length;
            } else {
                // 中間段落: カーソル段落の直前に hidden-paper-change span を挿入
                // シリアライザはこの span を見て、 段落の前に改ページ + <paper> + <docmargin> を出力する (BTRON 仕様 p.81 「用紙指定変更は改ページの直後を推奨」)
                const newPaperWidthPt = window.mmToPoints(width);
                const newPaperLengthPt = window.mmToPoints(height);
                const newMarginTopPt = window.mmToPoints(marginTop);
                const newMarginBottomPt = window.mmToPoints(marginBottom);
                const newMarginLeftPt = window.mmToPoints(marginLeft);
                const newMarginRightPt = window.mmToPoints(marginRight);
                // 同じ段落の直前に既存の hidden-paper-change があれば置換 (重複挿入防止)
                const prev = cursorParagraph.previousElementSibling;
                let hidden;
                if (prev && prev.classList && prev.classList.contains('hidden-paper-change')) {
                    hidden = prev;
                } else {
                    hidden = document.createElement('span');
                    hidden.className = 'hidden-paper-change';
                    hidden.style.display = 'none';
                    cursorParagraph.parentNode.insertBefore(hidden, cursorParagraph);
                }
                hidden.dataset.paperAttrs = `length="${newPaperLengthPt}" width="${newPaperWidthPt}" imposition="${imposition}"`;
                hidden.dataset.docmarginAttrs = `top="${newMarginTopPt}" bottom="${newMarginBottomPt}" left="${newMarginLeftPt}" right="${newMarginRightPt}"`;
            }

            this.isModified = true;
            this.setStatus(`用紙設定を ${width}×${height}mm に更新しました${isFirstParagraph ? '' : ' (中間段落挿入)'}`);
            // 即時反映
            this._applyPaperWidthAndRefresh();
            return true;
        }

        return false;
    }

    /**
     * カーソル位置の段落 (<p>) を返す。 範囲選択時は startContainer の段落を返す。 段落が見つからない場合は null。
     */
    _getCursorParagraph() {
        if (!this.editor) return null;
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return null;
        let node = selection.getRangeAt(0).startContainer;
        // editor 内のノードでなければ無効
        if (!this.editor.contains(node)) return null;
        while (node && node !== this.editor && node.nodeName !== 'P') {
            node = node.parentNode;
        }
        return (node && node.nodeName === 'P') ? node : null;
    }

    /**
     * 用紙設定変更後の即時反映ヘルパー: editor 幅再計算 + 詳細/清書モード時の段落 CSS 再描画。
     */
    _applyPaperWidthAndRefresh() {
        // editor.style.width を新しい paperWidth - paperMargin に即時更新 (toggleWrap と同様)
        if (typeof this._applyPaperWidthToEditor === 'function') {
            this._applyPaperWidthToEditor();
        }
        // 詳細モード/清書モードでは tab-format ルーラや段落 margin の再計算のため refresh
        if (this.viewMode === 'detailed' || this.viewMode === 'formatted') {
            if (typeof this.refresh === 'function') {
                this.refresh();
            }
        }
        // 高さ更新
        if (typeof this.updateContentHeight === 'function') {
            setTimeout(() => this.updateContentHeight(), window.UI_UPDATE_DELAY_MS || 0);
        }
    }

    /**
     * ヘッダ/フッタ設定ダイアログ (BTRON GUI のヘッダ/フッタ画面を再現)
     * showPageSetup から「ヘッダ/フッタ」 ボタンで遷移する。
     * - ヘッダ: 左端/中央/右端 のテキスト + 高さ (mm)
     * - フッタ: 左端/中央/右端 のテキスト + 高さ (mm) + 開始ページ番号
     * 値は this.paperHeaderFooter に保持される (xtad への保存は将来対応: 用紙オーバーレイ付箋 2.0.3 + ページ番号付箋 2.0.6)
     * @returns {boolean} 設定された場合 true、 キャンセル時 false
     */
    async showHeaderFooterSetup() {
        // 既存値読込 (lazy init)
        if (!this.paperHeaderFooter) {
            this.paperHeaderFooter = {
                headerLeft: '', headerCenter: '', headerRight: '', headerHeightMm: 0,
                footerLeft: '', footerCenter: '', footerRight: '', footerHeightMm: 0,
                pageStartNum: 1
            };
        }
        const hf = this.paperHeaderFooter;
        const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        const dialogHtml = `
            <style>
                #dialog-input-field { display: none !important; }
                #input-dialog-message:has(.header-footer-dialog) { margin-bottom: 2px; padding: 2px; }
                #input-dialog:has(.header-footer-dialog) { padding: 4px; }
                #input-dialog:has(.header-footer-dialog) .dialog-buttons { padding: 2px; margin-top: 0px; }
                .header-footer-dialog { font-family: sans-serif; font-size: 11px; padding: 4px; min-width: 380px; }
                .header-footer-dialog .hf-section {
                    border: 1px solid #808080;
                    padding: 6px 8px;
                    margin-bottom: 6px;
                    background: #dedede;
                    display: grid;
                    grid-template-columns: auto 1fr;
                    column-gap: 6px;
                    row-gap: 3px;
                    align-items: center;
                }
                .header-footer-dialog .hf-section-label {
                    grid-column: 1;
                    grid-row: span 4;
                    writing-mode: vertical-rl;
                    text-orientation: upright;
                    font-weight: bold;
                    width: 18px;
                    text-align: center;
                    letter-spacing: 4px;
                }
                .header-footer-dialog .hf-row { display: flex; align-items: center; gap: 4px; }
                .header-footer-dialog .hf-row label { width: 48px; }
                .header-footer-dialog .hf-row input[type="text"] {
                    flex: 1;
                    padding: 2px 4px;
                    border: 1px inset #c0c0c0;
                    font-size: 11px;
                    background: #ffffff;
                }
                .header-footer-dialog .hf-row input[type="number"] {
                    width: 60px;
                    padding: 2px 4px;
                    border: 1px inset #c0c0c0;
                    font-size: 11px;
                    background: #ffffff;
                    text-align: right;
                }
                .header-footer-dialog .hf-row .unit { margin-left: 2px; color: #444; }
                .header-footer-dialog .hf-footer-meta { display: flex; align-items: center; gap: 8px; }
            </style>
            <div class="header-footer-dialog">
                <div class="hf-section">
                    <div class="hf-section-label">ヘッダ</div>
                    <div class="hf-row"><label>左端:</label><input type="text" name="headerLeft" value="${esc(hf.headerLeft)}"></div>
                    <div class="hf-row"><label>中央:</label><input type="text" name="headerCenter" value="${esc(hf.headerCenter)}"></div>
                    <div class="hf-row"><label>右端:</label><input type="text" name="headerRight" value="${esc(hf.headerRight)}"></div>
                    <div class="hf-row"><label>高さ:</label><input type="number" name="headerHeight" value="${Number(hf.headerHeightMm) || 0}" min="0" max="100" step="1"><span class="unit">mm</span></div>
                </div>
                <div class="hf-section">
                    <div class="hf-section-label">フッタ</div>
                    <div class="hf-row"><label>左端:</label><input type="text" name="footerLeft" value="${esc(hf.footerLeft)}"></div>
                    <div class="hf-row"><label>中央:</label><input type="text" name="footerCenter" value="${esc(hf.footerCenter)}"></div>
                    <div class="hf-row"><label>右端:</label><input type="text" name="footerRight" value="${esc(hf.footerRight)}"></div>
                    <div class="hf-row hf-footer-meta">
                        <label>高さ:</label><input type="number" name="footerHeight" value="${Number(hf.footerHeightMm) || 0}" min="0" max="100" step="1"><span class="unit">mm</span>
                        <label style="margin-left:12px;width:auto;">開始ページ番号:</label><input type="number" name="pageStartNum" value="${Number(hf.pageStartNum) || 1}" min="1" step="1" style="width:50px;">
                    </div>
                </div>
            </div>
        `;

        const result = await this.showCustomDialog({
            title: 'ヘッダ/フッタ',
            dialogHtml: dialogHtml,
            buttons: [
                { label: '取消', value: 'cancel' },
                { label: '設定', value: 'ok' }
            ],
            defaultButton: 1,
            width: 420
        });

        if (!result || result.button !== 'ok') {
            return false;
        }

        const formData = result.formData || {};
        this.paperHeaderFooter = {
            headerLeft: formData.headerLeft || '',
            headerCenter: formData.headerCenter || '',
            headerRight: formData.headerRight || '',
            headerHeightMm: parseFloat(formData.headerHeight) || 0,
            footerLeft: formData.footerLeft || '',
            footerCenter: formData.footerCenter || '',
            footerRight: formData.footerRight || '',
            footerHeightMm: parseFloat(formData.footerHeight) || 0,
            pageStartNum: parseInt(formData.pageStartNum) || 1
        };
        this.isModified = true;
        this.setStatus('ヘッダ/フッタを更新しました');
        return true;
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
