/**
 * 仮身一覧ビューアプラグイン
 * @module VirtualObjectList
 * @extends PluginBase
 * @license MIT
 * @author satromi
 * @version 1.0.0
 */
const logger = window.getLogger('VirtualObjectList');

class VirtualObjectListApp extends window.PluginBase {
    constructor() {
        // 基底クラスのコンストラクタを呼び出し
        super('VirtualObjectList');

        this.fileData = null;
        this.xmlData = null;
        this.tadData = null;
        // this.realId は基底クラスで定義済み
        this.virtualObjects = [];
        this.selectedVirtualObjects = new Set(); // 選択中の仮身（複数選択対応）
        this.clipboard = null; // クリップボード（仮身データ）
        this.isFullscreen = false; // 全画面表示フラグ

        // this.windowId は基底クラスで定義済み（親ウィンドウからinitメッセージで設定される）

        // 仮身ドラッグのプラグイン固有状態管理
        // 共通状態（isDragging, hasMoved, dragMode, startX/Y, isRightButtonPressed）は
        // PluginBaseのvirtualObjectDragStateで管理
        this.vobjDragState = {
            currentObject: null,         // ドラッグ中の仮身オブジェクト
            currentElement: null,        // ドラッグ中のDOM要素
            vobjIndex: null,             // ドラッグ中の仮身のインデックス（一意識別用）
            initialLeft: 0,              // ドラッグ開始時の要素left位置
            initialTop: 0,               // ドラッグ開始時の要素top位置
            isMouseInThisWindow: true,   // マウスがこのウィンドウ内にいるか（dragoverで更新）
            lastMouseOverWindowId: null, // ドラッグ中に最後にマウスがあったウィンドウID
            dropClientX: 0,              // ドロップ位置X（同一ウィンドウ内ドロップ用）
            dropClientY: 0,              // ドロップ位置Y（同一ウィンドウ内ドロップ用）
            selectedObjects: null,       // ドラッグ中の選択仮身配列（finishDrag用）
            currentDeltaX: 0,            // 現在のドラッグ移動量X
            currentDeltaY: 0             // 現在のドラッグ移動量Y
        };

        // ダブルクリック+ドラッグ（実身複製）用の状態管理
        // PluginBaseで共通プロパティ（lastClickTime, isDblClickDragCandidate, isDblClickDrag, dblClickedElement, startX, startY）を初期化済み
        // プラグイン固有のプロパティのみ追加
        this.dblClickDragState.lastClickedObject = null;  // 最後にクリックされたオブジェクト
        this.dblClickDragState.dblClickedObject = null;   // ダブルクリックされたオブジェクト

        // リサイズ状態管理
        this.isResizing = false;
        this.recreateVirtualObjectTimer = null; // 仮身再作成の遅延タイマー

        // iframe再有効化タイマー
        this.iframeReenableTimeout = null;

        // コンテキストメニューを閉じた直後かどうかのフラグ
        this.justClosedContextMenu = false;

        // MessageBusはPluginBaseで初期化済み
        // 以下は開いた仮身（子iframe）との通信用の追加設定
        this.childMessageBus = null;
        this.iconRequestMap = new Map(); // messageId -> source のマッピング（リレー用）
        this.imagePathRequestMap = new Map(); // messageId -> source のマッピング（画像パスリレー用）
        this.expandedIframes = new Set(); // 開いた仮身のiframeを管理（アイコンリレー用）

        // 開いた仮身（子iframe）との通信用（親モード）のMessageBusを追加初期化
        if (window.MessageBus) {
            this.childMessageBus = new window.MessageBus({
                debug: this.debug,
                pluginName: 'VirtualObjectList-Child',
                mode: 'parent'
            });
            this.childMessageBus.start();
            logger.debug('[VirtualObjectList] Child MessageBus initialized');
        }

        // クロスウィンドウドロップ処理の共通化
        this.setupCrossWindowDropSuccessHandler();

        this.init();
    }

    init() {
        // 共通コンポーネントの初期化
        this.initializeCommonComponents('[VirtualObjectList]');

        // パフォーマンス最適化関数の初期化
        if (window.throttleRAF && window.throttle) {
            logger.debug('[VirtualObjectList] Performance optimization initialized');
        }

        logger.debug('[VirtualObjectList] 初期化開始');

        // MessageBusのハンドラを登録
        if (this.messageBus) {
            this.setupMessageBusHandlers();
        }

        // ウィンドウアクティベーション
        this.setupWindowActivation();

        // スクロール通知初期化（MessageBus経由で親ウィンドウにスクロール状態を通知）
        this.initScrollNotification();

        // 右クリックメニュー
        this.setupContextMenu();

        // ドラッグ&ドロップ機能
        this.setupDragAndDrop();

        // キーボードショートカット
        this.setupKeyboardShortcuts();

        // 仮身ドラッグ用の右ボタンハンドラーを設定（PluginBase共通機能）
        this.setupVirtualObjectRightButtonHandlers();

        // グローバルなマウスイベントハンドラー（ドラッグ用）
        this.setupGlobalMouseHandlers();

        // グローバルなdragoverイベントリスナー（マウスがウィンドウ内にいるかを追跡）
        document.addEventListener('dragover', (e) => {
            // dragoverが発火している = マウスがこのウィンドウ内にいる
            this.vobjDragState.isMouseInThisWindow = true;
        });
    }

    /**
     * ドラッグ&ドロップ機能を設定
     */
    setupDragAndDrop() {
        const listElement = document.getElementById('virtualList');
        if (!listElement) return;

        // ドラッグオーバー
        listElement.addEventListener('dragover', (e) => {
            e.preventDefault();

            // effectAllowedに基づいてdropEffectを設定
            // effectAllowedが'move'の場合は'move'、'copy'の場合は'copy'を使用
            const effectAllowed = e.dataTransfer.effectAllowed;
            if (effectAllowed === 'move') {
                e.dataTransfer.dropEffect = 'move';
            } else if (effectAllowed === 'copy') {
                e.dataTransfer.dropEffect = 'copy';
            } else {
                // デフォルトはcopy
                e.dataTransfer.dropEffect = 'copy';
            }

            listElement.style.backgroundColor = '#e8f4f8';

            // ドラッグ先のウィンドウを判定：別ウィンドウからのドラッグの場合のみ、このウィンドウで仮身を表示
            // このウィンドウがドラッグ元でない場合（別ウィンドウからドラッグされている）、仮身を表示する
            if (!this.virtualObjectDragState.isDragging) {
                // 別のウィンドウからドラッグされている場合
                // ドラッグ元のcurrentElementを表示する必要があるが、別ウィンドウの要素なのでアクセスできない
                // そのため、何もしない（ブラウザのデフォルトのドラッグイメージが表示される）
            }
            // このウィンドウがドラッグ元の場合は、drag イベントで処理される
        });

        // ドラッグリーブ
        listElement.addEventListener('dragleave', (e) => {
            e.preventDefault();
            listElement.style.backgroundColor = '';
        });

        // ドロップ
        listElement.addEventListener('drop', (e) => {
            e.preventDefault();
            listElement.style.backgroundColor = '';

            try {
                // 外部ファイルドロップをチェック（Windowsからのドラッグなど）
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    const files = Array.from(e.dataTransfer.files);
                    logger.info('[VirtualObjectList] 外部ファイルドロップ検出:', files.length, '個のファイル');

                    // ファイル内容を読み込んでBase64で送信（iframeではfile.pathが利用不可のため）
                    this.readAndSendFiles(files, e.clientX, e.clientY);
                    return;
                }

                // PluginBase共通メソッドでdragDataをパース
                const dragData = this.parseDragData(e.dataTransfer);
                if (dragData) {
                    if ((dragData.type === 'base-file-copy' || dragData.type === 'user-base-file-copy') && dragData.source === 'base-file-manager') {
                        // 原紙管理からのコピー（システム原紙またはユーザ原紙）
                        this.handleBaseFileDrop(dragData, e.clientX, e.clientY);
                        return;
                    } else if (dragData.type === 'trash-real-object-restore' && dragData.source === 'trash-real-objects') {
                        // 屑実身操作からの復元 - 親ウィンドウに処理を委譲
                        logger.debug('[VirtualObjectList] 屑実身操作からのドロップを親ウィンドウに委譲');
                        this.messageBus.send('trash-real-object-drop-request', {
                            dragData: dragData,
                            clientX: e.clientX,
                            clientY: e.clientY
                        });
                        return;
                    } else if (dragData.type === 'archive-file-extract' && dragData.source === 'unpack-file') {
                        // 書庫解凍からのファイル抽出
                        this.insertArchiveFileAsVirtualObject(dragData, e.clientX, e.clientY);
                        return;
                    } else if (dragData.type === 'virtual-object-drag') {
                        // 仮身のドラッグ（仮身一覧または基本文章編集プラグインから）
                        const virtualObjects = dragData.virtualObjects || [dragData.virtualObject];
                        logger.debug('[VirtualObjectList] 仮身ドロップ受信:', virtualObjects.length, '個');

                        const isCrossWindow = dragData.sourceWindowId !== this.windowId;
                        if (isCrossWindow) {
                            logger.debug('[VirtualObjectList] クロスウィンドウドロップ検知');
                            this.messageBus.send('notify-cross-window-drop', {
                                sourceWindowId: dragData.sourceWindowId,
                                targetWindowId: this.windowId
                            });
                            this.insertVirtualObjectFromDrag(dragData, e.clientX, e.clientY);
                            dragData.targetWindowId = this.windowId;
                            this.notifyCrossWindowDropSuccess(dragData, virtualObjects);
                        } else {
                            logger.debug('[VirtualObjectList] 同じウィンドウ内でのドロップ');
                            this.vobjDragState.dropClientX = e.clientX;
                            this.vobjDragState.dropClientY = e.clientY;
                            this.virtualObjectDragState.hasMoved = true;
                        }
                        return;
                    } else if (dragData.type === 'image-drag') {
                        // 画像のドラッグ（基本文章編集プラグインから）
                        logger.info('[VirtualObjectList] 画像ドロップ受信:', dragData.imageInfo?.savedFilename);

                        // 親ウィンドウに画像から実身を作成するよう依頼
                        this.messageBus.send('image-dropped-on-plugin', {
                            dragData: dragData,
                            clientX: e.clientX,
                            clientY: e.clientY,
                            windowId: this.windowId
                        });
                        return;
                    }
                }
            } catch (error) {
                logger.error('[VirtualObjectList] ドロップ処理エラー:', error);
            }
        });
    }

    /**
     * 原紙ファイルを仮身として挿入
     */
    insertBaseFileAsVirtualObject(baseFile, clientX, clientY) {
        logger.debug('[VirtualObjectList] 原紙ファイル挿入:', baseFile.displayName);

        // ドロップ位置を計算
        const listElement = document.getElementById('virtualList');
        const canvas = listElement.querySelector('.virtual-canvas');

        if (!canvas) {
            logger.warn('[VirtualObjectList] キャンバスが見つかりません');
            return;
        }

        const rect = canvas.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;

        // 仮身オブジェクトを作成
        const virtualObj = {
            link_id: baseFile.pluginId,
            link_name: baseFile.displayName,
            vobjleft: Math.max(0, x - 75), // 中央に配置
            vobjtop: Math.max(0, y - 15),
            vobjright: Math.max(0, x + 75),
            vobjbottom: Math.max(0, y + 15),
            width: 150,
            heightPx: 30,
            chsz: 14,
            frcol: '#000000',
            chcol: '#000000',
            tbcol: '#ffffff',
            bgcol: '#ffffff',
            dlen: 0
        };

        // 仮身リストに追加
        this.virtualObjects.push(virtualObj);

        // xmlTADに追加
        this.addVirtualObjectToXml(virtualObj);

        // 再描画
        this.renderVirtualObjects();

        logger.debug('[VirtualObjectList] 原紙ファイル挿入完了');
    }

    /**
     * ドロップされたファイルを読み込んで親ウィンドウに送信
     * @param {File[]} files - ファイル配列
     * @param {number} clientX - ドロップ位置X
     * @param {number} clientY - ドロップ位置Y
     */
    async readAndSendFiles(files, clientX, clientY) {
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
                logger.error('[VirtualObjectList] ファイル読み込みエラー:', file.name, error);
            }
        }

        if (fileDataList.length > 0) {
            this.messageBus.send('files-dropped-on-plugin', {
                files: fileDataList,
                clientX: clientX,
                clientY: clientY,
                windowId: this.windowId
            });
        }
    }

    /**
     * unpack-fileから書庫ファイルがドロップされた時の処理
     * ドロップ位置情報のみをunpack-fileに返す（確認ダイアログはunpack-fileが表示）
     */
    async insertArchiveFileAsVirtualObject(dragData, clientX, clientY) {
        logger.debug('[VirtualObjectList] 書庫ファイルドロップ検出:', dragData.file.name);

        // ドロップ位置を計算
        const listElement = document.getElementById('virtualList');
        const canvas = listElement.querySelector('.virtual-canvas');

        if (!canvas) {
            logger.warn('[VirtualObjectList] キャンバスが見つかりません');
            return;
        }

        const rect = canvas.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;

        // ドロップ位置情報をunpack-fileに通知（確認ダイアログはunpack-fileが表示）
        this.messageBus.send('archive-drop-detected', {
            dropPosition: { x, y },
            dragData: dragData,
            targetWindowId: dragData.windowId,  // unpack-fileのウィンドウIDを使用
            sourceWindowId: this.windowId  // 送信元（virtual-object-list）のウィンドウID
        });
    }

    /**
     * ドラッグ&ドロップされた仮身を挿入
     * @param {Object} dragData - ドラッグデータ
     * @param {number} clientX - ドロップ位置X
     * @param {number} clientY - ドロップ位置Y
     */
    insertVirtualObjectFromDrag(dragData, clientX, clientY) {
        const virtualObjects = dragData.virtualObjects || [dragData.virtualObject];
        logger.debug('[VirtualObjectList] 仮身ドロップ受信:', virtualObjects.length, '個', 'モード:', dragData.mode, 'ソースウィンドウID:', dragData.sourceWindowId, '現在のウィンドウID:', this.windowId);

        // 同じウィンドウ内からのドラッグの場合、既にmouseupイベントで位置更新済み
        // 重複して<link>を追加しないようにする
        const isSameWindow = dragData.sourceWindowId === this.windowId;
        if (dragData.mode === 'move' && isSameWindow) {
            logger.debug('[VirtualObjectList] 同じウィンドウ内の移動モード: mouseupイベントで既に処理済みのためスキップ');
            return;
        }

        // コピーモード、または別ウィンドウからの移動モードの場合は新しい仮身を追加
        logger.debug('[VirtualObjectList] 新しい仮身を挿入:', isSameWindow ? 'コピーモード' : '別ウィンドウからの移動/コピー');

        // ドロップ位置を計算
        const listElement = document.getElementById('virtualList');
        const canvas = listElement.querySelector('.virtual-canvas');

        if (!canvas) {
            logger.warn('[VirtualObjectList] キャンバスが見つかりません');
            return;
        }

        const rect = canvas.getBoundingClientRect();
        const baseX = clientX - rect.left;
        const baseY = clientY - rect.top;

        // 複数の仮身を順番に挿入
        virtualObjects.forEach((virtualObjectData, index) => {
            // デバッグ: 受信した仮身データをログ出力
            logger.debug('[VirtualObjectList] 受信した仮身データ:', {
                link_name: virtualObjectData.link_name,
                tbcol: virtualObjectData.tbcol,
                frcol: virtualObjectData.frcol,
                chcol: virtualObjectData.chcol,
                bgcol: virtualObjectData.bgcol,
                chsz: virtualObjectData.chsz,
                width: virtualObjectData.width,
                heightPx: virtualObjectData.heightPx
            });

            // 相対位置オフセットを使用（元の空間的な関係を保持）
            const offsetX = virtualObjectData.offsetX || 0;
            const offsetY = virtualObjectData.offsetY || 0;
            const x = baseX + offsetX;
            const y = baseY + offsetY;

            // widthとheightPxを取得または計算
            let width = virtualObjectData.width;
            let heightPx = virtualObjectData.heightPx;

            // widthまたはheightPxが無い場合は、vobjleft/right/top/bottomから計算
            if (!width || !heightPx) {
                const vobjleft = parseInt(virtualObjectData.link_vobjleft) || 0;
                const vobjright = parseInt(virtualObjectData.link_vobjright) || 0;
                const vobjtop = parseInt(virtualObjectData.link_vobjtop) || 0;
                const vobjbottom = parseInt(virtualObjectData.link_vobjbottom) || 0;

                width = width || (vobjright - vobjleft) || 150; // デフォルト150px
                heightPx = heightPx || (vobjbottom - vobjtop) || 31; // デフォルト31px（閉じた仮身の標準高さ）
            }

            // 仮身オブジェクトを作成
            const virtualObj = {
                link_id: virtualObjectData.link_id,
                link_name: virtualObjectData.link_name,
                vobjleft: Math.max(0, x - (width / 2)),
                vobjtop: Math.max(0, y - (heightPx / 2)),
                vobjright: Math.max(0, x + (width / 2)),
                vobjbottom: Math.max(0, y + (heightPx / 2)),
                width: width,
                heightPx: heightPx,
                chsz: virtualObjectData.chsz,
                frcol: virtualObjectData.frcol,
                chcol: virtualObjectData.chcol,
                tbcol: virtualObjectData.tbcol,
                bgcol: virtualObjectData.bgcol,
                dlen: virtualObjectData.dlen,
                applist: virtualObjectData.applist || {},
                // 表示属性もコピー
                pictdisp: virtualObjectData.pictdisp || 'true',
                namedisp: virtualObjectData.namedisp || 'true',
                roledisp: virtualObjectData.roledisp || 'false',
                typedisp: virtualObjectData.typedisp || 'false',
                updatedisp: virtualObjectData.updatedisp || 'false',
                framedisp: virtualObjectData.framedisp || 'true',
                autoopen: virtualObjectData.autoopen || 'false',
                // 新しく作成された仮身なので、元の位置は現在の位置と同じ
                originalLeft: Math.max(0, x - (virtualObjectData.width / 2)),
                originalTop: Math.max(0, y - (virtualObjectData.heightPx / 2)),
                originalRight: Math.max(0, x + (virtualObjectData.width / 2)),
                originalBottom: Math.max(0, y + (virtualObjectData.heightPx / 2))
            };

            // デバッグ: 作成された仮身オブジェクトをログ出力
            logger.debug('[VirtualObjectList] 作成された仮身オブジェクト:', {
                link_name: virtualObj.link_name,
                tbcol: virtualObj.tbcol,
                frcol: virtualObj.frcol,
                chcol: virtualObj.chcol,
                bgcol: virtualObj.bgcol,
                chsz: virtualObj.chsz,
                width: virtualObj.width,
                heightPx: virtualObj.heightPx
            });

            // 仮身リストに追加
            this.virtualObjects.push(virtualObj);

            // xmlTADに追加
            this.addVirtualObjectToXml(virtualObj);

            // コピーモードの場合はrefCount+1
            if (dragData.mode === 'copy') {
                this.requestCopyVirtualObject(virtualObj.link_id);
            }
        });

        // 再描画
        this.renderVirtualObjects();

        // キャンバスサイズとスクロールバーを更新
        this.updateCanvasSize();

        // XMLデータの変更を実身ファイルに保存
        this.saveToFile();

        logger.debug('[VirtualObjectList] 仮身挿入完了');
    }

    /**
     * unpack-fileからルート実身配置要求を受け取る
     * @param {Object} rootFileData - ルート実身のデータ
     * @param {number} x - 配置位置X
     * @param {number} y - 配置位置Y
     * @param {string} sourceWindowId - 送信元（unpack-file）のウィンドウID
     */
    insertRootVirtualObject(rootFileData, x, y, sourceWindowId) {
        logger.debug('[VirtualObjectList] ルート実身を配置:', rootFileData.name);
        logger.debug('[VirtualObjectList] rootFileData.applist:', rootFileData.applist);

        // 仮身オブジェクトを作成
        const virtualObj = {
            link_id: rootFileData.fileId,
            link_name: rootFileData.name,
            vobjleft: Math.max(0, x - 75),
            vobjtop: Math.max(0, y - 15),
            vobjright: Math.max(0, x + 75),
            vobjbottom: Math.max(0, y + 15),
            width: 150,
            heightPx: 30,
            chsz: 14,
            frcol: '#000000',
            chcol: '#000000',
            tbcol: '#ffffff',
            bgcol: '#ffffff',
            dlen: 0,
            applist: rootFileData.applist || {},  // applist情報を設定
            // 新しく作成された仮身なので、元の位置は現在の位置と同じ
            originalLeft: Math.max(0, x - 75),
            originalTop: Math.max(0, y - 15),
            originalRight: Math.max(0, x + 75),
            originalBottom: Math.max(0, y + 15)
        };

        // 仮身リストに追加
        this.virtualObjects.push(virtualObj);

        // xmlTADに追加
        this.addVirtualObjectToXml(virtualObj);

        // 再描画
        this.renderVirtualObjects();

        logger.debug('[VirtualObjectList] ルート実身配置完了');

        // unpack-fileに配置完了を通知
        this.messageBus.send('root-virtual-object-inserted', {
            success: true,
            targetWindowId: sourceWindowId  // unpack-fileのウィンドウIDを指定
        });
    }

    /**
     * 原紙箱から実身IDと名前を受け取って仮身を追加
     * @param {string} realId - 実身ID
     * @param {string} name - 実身名
     * @param {Object} dropPosition - ドロップ位置 {x, y}
     * @param {Object} applist - アプリケーションリスト
     */
    addVirtualObjectFromRealId(realId, name, dropPosition, applist) {
        logger.debug('[VirtualObjectList] 実身IDから仮身を追加:', realId, name, dropPosition, 'applist:', applist);

        // ドロップ位置を計算
        let x = 100;
        let y = 100 + (this.virtualObjects.length * 40);

        if (dropPosition) {
            // dropPositionはiframe内のクライアント座標なので、キャンバス座標に変換
            const listElement = document.getElementById('virtualList');
            const canvas = listElement ? listElement.querySelector('.virtual-canvas') : null;

            if (canvas) {
                const rect = canvas.getBoundingClientRect();
                x = dropPosition.x - rect.left;
                y = dropPosition.y - rect.top;
                logger.debug('[VirtualObjectList] ドロップ位置をキャンバス座標に変換:', {clientX: dropPosition.x, clientY: dropPosition.y, canvasX: x, canvasY: y});
            } else {
                logger.warn('[VirtualObjectList] キャンバスが見つかりません、デフォルト位置を使用');
            }
        }

        // 仮身オブジェクトを作成（ドロップ位置に配置）
        const virtualObj = {
            link_id: `${realId}_0.xtad`,
            link_name: name,
            vobjleft: Math.max(0, x - 75), // 中央に配置
            vobjtop: Math.max(0, y - 15),
            vobjright: Math.max(0, x + 75),
            vobjbottom: Math.max(0, y + 15),
            width: 150,
            heightPx: 30,
            chsz: 14,
            frcol: '#000000',
            chcol: '#000000',
            tbcol: '#ffffff',
            bgcol: '#ffffff',
            dlen: 0,
            applist: applist || {},  // 親ウィンドウから渡されたapplist情報を使用
            // 新しく作成された仮身なので、元の位置は現在の位置と同じ
            originalLeft: Math.max(0, x - 75),
            originalTop: Math.max(0, y - 15),
            originalRight: Math.max(0, x + 75),
            originalBottom: Math.max(0, y + 15)
        };

        // 仮身リストに追加
        this.virtualObjects.push(virtualObj);

        // xmlTADに追加
        this.addVirtualObjectToXml(virtualObj);

        // 再描画
        this.renderVirtualObjects();
    }

    // showMessageDialog() は基底クラス PluginBase で定義

    /**
     * MessageBusのハンドラを登録
     * 親ウィンドウからのメッセージを受信して処理
     */
    setupMessageBusHandlers() {
        // init メッセージ
        this.messageBus.on('init', async (data) => {
            logger.debug('[VirtualObjectList] [MessageBus] init受信', data);

            // 共通初期化処理（windowId設定、スクロール状態送信）
            this.onInit(data);
            logger.debug('[VirtualObjectList] [MessageBus] windowId更新:', this.windowId);

            this.fileData = data.fileData;
            const realIdValue = this.fileData ? (this.fileData.realId || this.fileData.fileId) : null;

            // _0.xtad などの拡張子を除去
            if (realIdValue) {
                this.realId = realIdValue.replace(/_\d+\.xtad$/i, '');
            } else {
                this.realId = null;
            }
            logger.debug('[VirtualObjectList] [MessageBus] this.realId設定完了:', this.realId);

            // 全画面表示状態を復元
            if (this.fileData && this.fileData.isFullscreen !== undefined) {
                this.isFullscreen = this.fileData.isFullscreen;
                logger.debug('[VirtualObjectList] [MessageBus] 全画面表示状態を復元:', this.isFullscreen);
            }

            // XMLデータを取得
            if (this.fileData.xmlData) {
                this.xmlData = this.fileData.xmlData;
                this.tadData = this.fileData.xmlData;
                await this.parseVirtualObjects();
                this.renderVirtualObjects();
            }

            // 背景色を適用
            if (this.fileData && this.fileData.windowConfig && this.fileData.windowConfig.backgroundColor) {
                const bgColor = this.fileData.windowConfig.backgroundColor;
                const canvas = document.querySelector('.virtual-canvas');
                if (canvas) {
                    canvas.style.background = bgColor;
                    logger.debug('[VirtualObjectList] [MessageBus] 背景色を適用 (初期化時):', bgColor);
                }
            }

            // スクロール位置を復元（DOM更新完了を待つ）
            if (this.fileData && this.fileData.windowConfig && this.fileData.windowConfig.scrollPos) {
                setTimeout(() => {
                    this.setScrollPosition(this.fileData.windowConfig.scrollPos);
                }, 100);
            }

            // キーボードショートカットが動作するようにbodyにフォーカスを設定
            setTimeout(() => {
                document.body.focus();
                logger.debug('[VirtualObjectList] [MessageBus] bodyにフォーカスを設定');
            }, 100);
        });

        // 共通MessageBusハンドラを登録（PluginBaseで定義）
        // window-moved, window-resized-end, window-maximize-toggled,
        // menu-action, get-menu-definition, window-close-request
        this.setupCommonMessageBusHandlers();

        // input-dialog-response メッセージ（MessageBusが自動処理）
        this.messageBus.on('input-dialog-response', (data) => {
            logger.debug('[VirtualObjectList] [MessageBus] input-dialog-response受信:', data.messageId);
            // sendWithCallback使用時は自動的にコールバックが実行される
        });

        // message-dialog-response メッセージ（MessageBusが自動処理）
        this.messageBus.on('message-dialog-response', (data) => {
            logger.debug('[VirtualObjectList] [MessageBus] message-dialog-response受信:', data.messageId);
            // sendWithCallback使用時は自動的にコールバックが実行される
        });

        // window-closed メッセージ
        this.messageBus.on('window-closed', (data) => {
            logger.debug('[VirtualObjectList] [MessageBus] window-closed受信');
            this.handleWindowClosed(data.windowId, data.fileData);
        });

        // custom-dialog-response メッセージ（MessageBusが自動処理）
        this.messageBus.on('custom-dialog-response', (data) => {
            logger.debug('[VirtualObjectList] [MessageBus] custom-dialog-response受信:', data.messageId);
            // sendWithCallback使用時は自動的にコールバックが実行される
        });

        // load-virtual-object メッセージ
        this.messageBus.on('load-virtual-object', async (data) => {
            logger.debug('[VirtualObjectList] [MessageBus] load-virtual-object受信', data);

            // readonlyモードの設定（開いた仮身表示用）
            if (data.readonly === true) {
                this.isReadonly = true;
                document.body.classList.add('readonly-mode');
                logger.debug('[VirtualObjectList] [MessageBus] 読み取り専用モードを適用');
            }

            // スクロールバー非表示モードの設定（開いた仮身表示用）
            if (data.noScrollbar === true) {
                this.noScrollbar = true;
                document.body.style.overflow = 'hidden';
                const pluginContent = document.querySelector('.plugin-content');
                if (pluginContent) {
                    pluginContent.style.overflow = 'hidden';
                }
                const viewerContainer = document.querySelector('.viewer-container');
                if (viewerContainer) {
                    viewerContainer.style.overflow = 'hidden';
                }
                logger.debug('[VirtualObjectList] [MessageBus] スクロールバー非表示モードを適用');
            }

            // realObjectからXMLデータを取得
            if (data.realObject && data.realObject.records && data.realObject.records.length > 0) {
                const firstRecord = data.realObject.records[0];
                this.xmlData = firstRecord.xtad || firstRecord.data;
                this.tadData = this.xmlData;

                // 背景色を設定
                if (data.bgcol) {
                    this.bgcol = data.bgcol;
                }

                // XMLデータを解析して仮身をレンダリング
                await this.parseVirtualObjects();
                this.renderVirtualObjects();
            }
        });

        // load-data メッセージ
        this.messageBus.on('load-data', async (data) => {
            logger.debug('[VirtualObjectList] [MessageBus] load-data受信:', data);

            // readonlyモードの設定
            if (data.readonly === true) {
                this.isReadonly = true;
                document.body.classList.add('readonly-mode');
                logger.debug('[VirtualObjectList] [MessageBus] 読み取り専用モードを適用');
            }

            // スクロールバー非表示モードの設定
            if (data.noScrollbar === true) {
                this.noScrollbar = true;
                document.body.style.overflow = 'hidden';
                const pluginContent = document.querySelector('.plugin-content');
                if (pluginContent) {
                    pluginContent.style.overflow = 'hidden';
                }
                const viewerContainer = document.querySelector('.viewer-container');
                if (viewerContainer) {
                    viewerContainer.style.overflow = 'hidden';
                }
                logger.debug('[VirtualObjectList] [MessageBus] スクロールバー非表示モードを適用');
            }

            // 背景色の設定
            if (data.bgcol) {
                this.bgcol = data.bgcol;
            }

            // realObjectからXMLデータを取得
            if (data.realObject && data.realObject.records && data.realObject.records.length > 0) {
                const firstRecord = data.realObject.records[0];
                this.xmlData = firstRecord.xtad || firstRecord.data;
                this.tadData = this.xmlData;

                // XMLデータを解析して仮身をレンダリング
                await this.parseVirtualObjects();
                this.renderVirtualObjects();

                // 背景色を適用
                this.applyBackgroundColor();
            }
        });

        // add-virtual-object メッセージ
        this.messageBus.on('add-virtual-object', async (data) => {
            logger.debug('[VirtualObjectList] [MessageBus] 仮身追加要求受信:', data.file);
            await this.addVirtualObjectFromFile(data.file);
        });

        // insert-root-virtual-object メッセージ
        this.messageBus.on('insert-root-virtual-object', (data) => {
            logger.debug('[VirtualObjectList] [MessageBus] ルート実身配置要求受信:', data.rootFileData);
            this.insertRootVirtualObject(data.rootFileData, data.x, data.y, data.sourceWindowId);
        });

        // add-virtual-object-from-base メッセージ
        this.messageBus.on('add-virtual-object-from-base', (data) => {
            logger.debug('[VirtualObjectList] [MessageBus] 原紙箱から仮身追加:', data.realId, data.name);
            this.addVirtualObjectFromRealId(data.realId, data.name, data.dropPosition, data.applist);
        });

        // add-virtual-object-from-trash メッセージ
        this.messageBus.on('add-virtual-object-from-trash', (data) => {
            logger.debug('[VirtualObjectList] [MessageBus] 屑実身操作から仮身追加:', data.realId, data.name);
            this.addVirtualObjectFromRealId(data.realId, data.name, data.dropPosition, data.applist);
        });

        // window-resized メッセージ
        this.messageBus.on('window-resized', (data) => {
            logger.debug('[VirtualObjectList] [MessageBus] window-resized受信');
            this.updateCanvasSize();
        });

        // parent-drag-position メッセージ
        this.messageBus.on('parent-drag-position', (data) => {
            this.handleParentDragPosition(data);
        });

        // cross-window-drop-in-progress メッセージ（dragendより前に受信する）
        this.messageBus.on('cross-window-drop-in-progress', (data) => {
            logger.debug('[VirtualObjectList] [MessageBus] cross-window-drop-in-progress受信:', data.targetWindowId);
            // dragend時にfinishDrag()をスキップするためのフラグ
            this.lastDropWasCrossWindow = true;
        });

        // cross-window-drop-success メッセージハンドラはPluginBaseの共通機能に移行
        // onDeleteSourceVirtualObject()フックで仮身削除処理を実装

        // parent-drop-event メッセージ
        this.messageBus.on('parent-drop-event', (data) => {
            logger.debug('[VirtualObjectList] [MessageBus] parent-drop-event受信:', data);
            // ドロップイベントを処理（setupDropZone内のdropイベントと同等の処理）
            if (data.dragData) {
                // canvas要素を取得
                const canvas = document.querySelector('.virtual-canvas');
                if (!canvas) {
                    logger.error('[VirtualObjectList] Canvas element not found');
                    return;
                }

                const dropEvent = new CustomEvent('drop', {
                    bubbles: true,
                    cancelable: true
                });
                // clientXとclientYを設定
                Object.defineProperty(dropEvent, 'clientX', { value: data.clientX, writable: false });
                Object.defineProperty(dropEvent, 'clientY', { value: data.clientY, writable: false });
                // dataTransferオブジェクトをエミュレート
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
                // canvas要素にdropイベントをディスパッチ
                canvas.dispatchEvent(dropEvent);
            }
        });

        // ========================================
        // アイコン読み込みリレー機能（二段階メッセージング）
        // ========================================
        // 子iframe（開いた仮身）からread-icon-fileを受け取り、親ウィンドウに転送
        window.addEventListener('message', (e) => {
            if (e.data && e.data.type === 'read-icon-file') {
                const { realId, messageId } = e.data;
                logger.debug('[VirtualObjectList] 子からread-icon-file受信、親に転送:', realId, messageId);

                // 送信元のiframeを特定（e.sourceが無効な場合の対策）
                // expandedIframesからcontentWindowが一致するiframeを検索
                let sourceIframe = null;
                for (const iframe of this.expandedIframes) {
                    if (iframe.contentWindow === e.source) {
                        sourceIframe = iframe;
                        break;
                    }
                }

                // iframeが見つかった場合はiframe要素を保存、見つからない場合はe.sourceをフォールバック
                this.iconRequestMap.set(messageId, sourceIframe || e.source);

                // 親ウィンドウに転送
                this.messageBus.send('read-icon-file', {
                    realId: realId,
                    messageId: messageId
                });
            }
        });

        // 親ウィンドウからicon-file-loadedを受け取り、元の子iframeに返す
        this.messageBus.on('icon-file-loaded', (data) => {
            const { messageId } = data;
            const source = this.iconRequestMap.get(messageId);

            if (source) {
                logger.debug('[VirtualObjectList] 親からicon-file-loaded受信、子に転送:', messageId);
                // 元の子iframeにレスポンスを返す
                try {
                    // sourceがiframe要素の場合はcontentWindowを使用、Windowオブジェクトの場合は直接使用
                    const targetWindow = source.contentWindow || source;
                    if (targetWindow && typeof targetWindow.postMessage === 'function') {
                        targetWindow.postMessage({
                            type: 'icon-file-loaded',
                            ...data
                        }, '*');
                    } else {
                        logger.warn('[VirtualObjectList] 転送先windowが無効:', messageId);
                    }
                } catch (error) {
                    logger.error('[VirtualObjectList] 子へのicon-file-loaded転送エラー:', error);
                }

                // マップから削除（メモリリーク防止）
                this.iconRequestMap.delete(messageId);
            }
        });

        // ========================================
        // 画像ファイルパスリレー機能（二段階メッセージング）
        // ========================================
        // 子iframe（開いた仮身）からdelete-image-fileを受け取り、親ウィンドウに転送
        window.addEventListener('message', (e) => {
            if (e.data && e.data.type === 'delete-image-file') {
                const { fileName } = e.data;
                logger.debug('[VirtualObjectList] 子からdelete-image-file受信、親に転送:', fileName);

                // 親ウィンドウに転送（レスポンス不要）
                this.messageBus.send('delete-image-file', {
                    fileName: fileName
                });
            }
        });

        // 子iframe（開いた仮身）からget-image-file-pathを受け取り、親ウィンドウに転送
        window.addEventListener('message', (e) => {
            if (e.data && e.data.type === 'get-image-file-path') {
                const { fileName, messageId } = e.data;
                logger.debug('[VirtualObjectList] 子からget-image-file-path受信、親に転送:', fileName, messageId);

                // 送信元のiframeを特定（e.sourceが無効な場合の対策）
                let sourceIframe = null;
                for (const iframe of this.expandedIframes) {
                    if (iframe.contentWindow === e.source) {
                        sourceIframe = iframe;
                        break;
                    }
                }

                // iframeが見つかった場合はiframe要素を保存、見つからない場合はe.sourceをフォールバック
                this.imagePathRequestMap.set(messageId, sourceIframe || e.source);

                // 親ウィンドウに転送
                this.messageBus.send('get-image-file-path', {
                    fileName: fileName,
                    messageId: messageId
                });
            }
        });

        // 親ウィンドウからimage-file-path-responseを受け取り、元の子iframeに返す
        this.messageBus.on('image-file-path-response', (data) => {
            const { messageId } = data;
            const source = this.imagePathRequestMap.get(messageId);

            if (source) {
                logger.debug('[VirtualObjectList] 親からimage-file-path-response受信、子に転送:', messageId);
                // 元の子iframeにレスポンスを返す
                try {
                    // sourceがiframe要素の場合はcontentWindowを使用、Windowオブジェクトの場合は直接使用
                    const targetWindow = source.contentWindow || source;
                    if (targetWindow && typeof targetWindow.postMessage === 'function') {
                        targetWindow.postMessage({
                            type: 'image-file-path-response',
                            ...data
                        }, '*');
                    } else {
                        logger.warn('[VirtualObjectList] 転送先windowが無効:', messageId);
                    }
                } catch (error) {
                    logger.error('[VirtualObjectList] 子へのimage-file-path-response転送エラー:', error);
                }

                // マップから削除（メモリリーク防止）
                this.imagePathRequestMap.delete(messageId);
            }
        });

        logger.debug('[VirtualObjectList] MessageBusハンドラ登録完了');
    }

    /**
     * 親ウィンドウからドラッグ位置情報を受信し、位置を更新
     * @param {Object} data - { isOverThisWindow, currentMouseOverWindowId, clientX, clientY, relativeX, relativeY }
     */
    handleParentDragPosition(data) {
        // 現在マウスがあるウィンドウIDを記録（dragendで使用）
        // 注: nullでない場合のみ更新（マウスがウィンドウ間を移動中でnullになることがあるため）
        if (data.currentMouseOverWindowId !== undefined && data.currentMouseOverWindowId !== null) {
            // ウィンドウIDが変化した場合のみログ出力
            if (this.vobjDragState.lastMouseOverWindowId !== data.currentMouseOverWindowId) {
                logger.debug('[VirtualObjectList] ドラッグ先ウィンドウ変更:', this.vobjDragState.lastMouseOverWindowId, '->', data.currentMouseOverWindowId, '(thisWindowId:', this.windowId + ')');
            }
            this.vobjDragState.lastMouseOverWindowId = data.currentMouseOverWindowId;
        }

        // ドラッグ中でない、または移動していない場合はスキップ
        if (!this.virtualObjectDragState.isDragging || !this.virtualObjectDragState.hasMoved) return;
        if (!this.vobjDragState.currentElement) return;

        // クロスウィンドウドラッグかどうかを判定
        const isCrossWindowDrag = (
            this.vobjDragState.lastMouseOverWindowId !== null &&
            this.vobjDragState.lastMouseOverWindowId !== this.windowId
        );

        // 親ウィンドウから通知された isOverThisWindow フラグに基づいて表示/非表示を制御
        if (data.isOverThisWindow) {
            // クロスウィンドウドラッグの場合は、parent-drag-positionの座標で位置を更新
            if (isCrossWindowDrag && data.relativeX !== undefined && data.relativeY !== undefined) {
                // relativeX/Yは親ウィンドウから通知されたこのウィンドウ内での相対座標
                const deltaX = data.relativeX - this.virtualObjectDragState.startX;
                const deltaY = data.relativeY - this.virtualObjectDragState.startY;

                if (this.vobjDragState.selectedObjects && this.vobjDragState.selectedObjectsInitialPositions) {
                    this.vobjDragState.selectedObjects.forEach((item, index) => {
                        const initialPos = this.vobjDragState.selectedObjectsInitialPositions[index];
                        const newLeft = initialPos.left + deltaX;
                        const newTop = initialPos.top + deltaY;

                        // data-vobj-indexを使って特定の仮身要素を取得
                        const element = document.querySelector(`[data-vobj-index="${item.vobjIndex}"]`);
                        if (element) {
                            element.style.left = newLeft + 'px';
                            element.style.top = newTop + 'px';
                            element.style.visibility = 'visible';
                        }
                    });
                } else {
                    const newLeft = this.vobjDragState.initialLeft + deltaX;
                    const newTop = this.vobjDragState.initialTop + deltaY;
                    this.vobjDragState.currentElement.style.left = newLeft + 'px';
                    this.vobjDragState.currentElement.style.top = newTop + 'px';
                    this.vobjDragState.currentElement.style.visibility = 'visible';
                }
            } else {
                // 同じウィンドウ内のドラッグの場合は、visibility の制御のみ
                if (this.vobjDragState.selectedObjects) {
                    this.vobjDragState.selectedObjects.forEach((item) => {
                        // data-vobj-indexを使って特定の仮身要素を取得
                        const element = document.querySelector(`[data-vobj-index="${item.vobjIndex}"]`);
                        if (element) {
                            element.style.visibility = 'visible';
                        }
                    });
                } else {
                    this.vobjDragState.currentElement.style.visibility = 'visible';
                }
            }
        } else {
            // このウィンドウの上にマウスがない場合
            // コピーモードの場合は元の仮身を表示したまま、移動モードの場合のみ非表示
            if (this.virtualObjectDragState.dragMode === 'copy') {
                // コピーモードの場合は元の仮身を表示したまま
                if (this.vobjDragState.selectedObjects && this.vobjDragState.selectedObjectsInitialPositions) {
                    // 複数選択: 全ての選択仮身を元の位置で表示
                    this.vobjDragState.selectedObjects.forEach((item, index) => {
                        const initialPos = this.vobjDragState.selectedObjectsInitialPositions[index];
                        // data-vobj-indexを使って特定の仮身要素を取得
                        const element = document.querySelector(`[data-vobj-index="${item.vobjIndex}"]`);
                        if (element) {
                            element.style.left = initialPos.left + 'px';
                            element.style.top = initialPos.top + 'px';
                            element.style.visibility = 'visible';
                        }
                    });
                } else {
                    // 単一選択: 元の動作
                    this.vobjDragState.currentElement.style.left = this.vobjDragState.initialLeft + 'px';
                    this.vobjDragState.currentElement.style.top = this.vobjDragState.initialTop + 'px';
                    this.vobjDragState.currentElement.style.visibility = 'visible';
                }
            } else {
                // 移動モードの場合は非表示
                if (this.vobjDragState.selectedObjects) {
                    // 複数選択: 全ての選択仮身を非表示
                    this.vobjDragState.selectedObjects.forEach((item) => {
                        // data-vobj-indexを使って特定の仮身要素を取得
                        const element = document.querySelector(`[data-vobj-index="${item.vobjIndex}"]`);
                        if (element) {
                            element.style.visibility = 'hidden';
                        }
                    });
                } else {
                    // 単一選択: 元の動作
                    this.vobjDragState.currentElement.style.visibility = 'hidden';
                }
            }
        }
    }

    /**
     * メニュー定義を動的に生成
     * 選択された仮身のappList情報を元に「実行」メニューを作成
     */
    async getMenuDefinition() {
        const selectedVirtualObject = this.getSelectedVirtualObject();
        logger.debug('[VirtualObjectList] getMenuDefinition呼び出し, 選択中の仮身:', selectedVirtualObject ? selectedVirtualObject.link_name : 'なし');

        // 読み取り専用モードの場合は、表示系メニューのみ表示
        const menuDefinition = this.isReadonly ? [
            {
                text: '表示',
                submenu: [
                    { text: '全画面表示', action: 'toggle-fullscreen', shortcut: 'Ctrl+L' },
                    { text: '再表示', action: 'refresh' }
                ]
            }
        ] : [
            {
                text: '保存',
                submenu: [
                    { text: '元の実身に保存', action: 'save', shortcut: 'Ctrl+S' },
                    { text: '新たな実身に保存', action: 'save-as-new' }
                ]
            },
            {
                text: '表示',
                submenu: [
                    { text: '全画面表示', action: 'toggle-fullscreen', shortcut: 'Ctrl+L' },
                    { text: '再表示', action: 'refresh' },
                    { text: '背景色変更', action: 'change-bg-color' }
                ]
            },
            {
                text: '編集',
                submenu: [
                    { text: '取消', action: 'undo' },
                    { text: 'クリップボードへコピー', action: 'copy', shortcut: 'Ctrl+C' },
                    { text: 'クリップボードからコピー', action: 'paste', shortcut: 'Ctrl+V' },
                    { text: 'クリップボードへ移動', action: 'cut', shortcut: 'Ctrl+X' },
                    { text: 'クリップボードから移動', action: 'redo', shortcut: 'Ctrl+Z' },
                    { separator: true },
                    { text: '削除', action: 'delete', shortcut: 'Delete' },
                    { separator: true },
                    { text: 'いちばん前へ移動', action: 'front', shortcut: 'Ctrl+F' },
                    { text: 'いちばん後ろへ移動', action: 'back', shortcut: 'Ctrl+R' },
                    { separator: true },
                    { text: '整頓', action: 'arrange-virtual-objects', shortcut: 'Ctrl+D', disabled: this.selectedVirtualObjects.size === 0 }
                ]
            },
            {
                text: '保護',
                submenu: [
                    { text: '固定化', action: 'protect-fix', disabled: this.selectedVirtualObjects.size === 0 },
                    { text: '固定解除', action: 'unprotect-fix', disabled: this.selectedVirtualObjects.size === 0 },
                    { text: '背景化', action: 'protect-background', disabled: this.selectedVirtualObjects.size === 0 },
                    { text: '背景解除', action: 'unprotect-background', disabled: this.selectedVirtualObjects.size === 0 }
                ]
            }
        ];

        // 仮身が選択されている場合は「仮身操作」メニューを追加（読み取り専用モードでは非表示）
        logger.debug('[VirtualObjectList] getMenuDefinition: selectedVirtualObject:', selectedVirtualObject);
        if (selectedVirtualObject && !this.isReadonly) {
            try {
                // 実身IDを抽出（共通メソッドを使用）
                const realId = window.RealObjectSystem.extractRealId(selectedVirtualObject.link_id);

                logger.debug('[VirtualObjectList] getMenuDefinition: 仮身が選択されています realId:', realId);

                // 仮身操作メニュー
                const isOpened = this.openedRealObjects.has(realId);

                const virtualObjSubmenu = [
                    { text: '開く', action: 'open-real-object', disabled: isOpened },
                    { text: '閉じる', action: 'close-real-object', disabled: !isOpened },
                    { separator: true },
                    { text: '属性変更', action: 'change-virtual-object-attributes' },
                    { text: '続柄設定', action: 'set-relationship' }
                ];

                menuDefinition.push({
                    text: '仮身操作',
                    submenu: virtualObjSubmenu
                });

                // 実身操作メニュー
                const realObjSubmenu = [
                    { text: '実身名変更', action: 'rename-real-object' },
                    { text: '実身複製', action: 'duplicate-real-object' },
                    { text: '管理情報', action: 'open-realobject-config' },
                    { text: '仮身ネットワーク', action: 'open-virtual-object-network' },
                    { text: '実身/仮身検索', action: 'open-real-object-search' }
                ];

                menuDefinition.push({
                    text: '実身操作',
                    submenu: realObjSubmenu
                });

                // 屑実身操作メニュー
                menuDefinition.push({
                    text: '屑実身操作',
                    action: 'open-trash-real-objects'
                });

                // 実行メニュー（基本文章編集プラグインと同じパターン）
                const applistData = await this.getAppListData(realId);
                logger.debug('[VirtualObjectList] getMenuDefinition: applistData:', applistData);
                if (applistData && Object.keys(applistData).length > 0) {
                    const executeSubmenu = [];
                    for (const [pluginId, appInfo] of Object.entries(applistData)) {
                        logger.debug('[VirtualObjectList] getMenuDefinition: 実行メニュー項目追加:', pluginId, appInfo);
                        executeSubmenu.push({
                            text: appInfo.name || pluginId,
                            action: `execute-with-${pluginId}`
                        });
                    }

                    menuDefinition.push({
                        text: '実行',
                        submenu: executeSubmenu
                    });
                    logger.debug('[VirtualObjectList] getMenuDefinition: 実行メニュー追加完了 項目数:', executeSubmenu.length);
                } else {
                    logger.warn('[VirtualObjectList] getMenuDefinition: applistDataが空またはnull');
                }
            } catch (error) {
                logger.error('[VirtualObjectList] applist取得エラー:', error);
            }
        } else {
            logger.debug('[VirtualObjectList] getMenuDefinition: 仮身が選択されていません');
        }

        return menuDefinition;
    }

    /**
     * プラグインがtadjs-desktop.jsに登録されているか確認
     */
    isPluginRegistered(pluginId) {
        // 親ウィンドウのpluginManagerに問い合わせる
        if (window.parent && window.parent.pluginManager) {
            return window.parent.pluginManager.plugins.has(pluginId);
        }
        return false;
    }

    /**
     * メニューアクション実行（PluginBase共通ハンドラから呼ばれる）
     * handleMenuAction()へのエイリアス
     * @param {string} action - アクション名
     * @param {Object} additionalData - 追加データ（このプラグインでは未使用）
     */
    executeMenuAction(action, additionalData) {
        this.handleMenuAction(action);
    }

    handleMenuAction(action) {
        // 「実行」メニューの処理（execute-with-で始まるアクション）
        if (action.startsWith('execute-with-')) {
            const pluginId = action.replace('execute-with-', '');
            this.executeVirtualObjectWithPlugin(pluginId);
            return;
        }

        switch (action) {
            case 'save':
                this.saveToFile();
                break;
            case 'save-as-new':
                this.saveAsNewRealObject();
                break;
            case 'toggle-fullscreen':
                this.toggleFullscreen();
                break;
            case 'refresh':
                this.refresh();
                break;
            case 'change-bg-color':
                logger.debug('[VirtualObjectList] 背景色変更メニュー選択');
                this.changeBgColor().catch(err => {
                    logger.error('[VirtualObjectList] 背景色変更エラー:', err);
                });
                break;
            case 'copy':
                this.copySelectedVirtualObject();
                break;
            case 'paste':
                this.pasteVirtualObject();
                break;
            case 'cut':
                this.cutSelectedVirtualObject();
                break;
            case 'delete':
                this.deleteSelectedVirtualObject();
                break;
            case 'front':
                this.moveSelectedVirtualObjectToFront();
                break;
            case 'back':
                this.moveSelectedVirtualObjectToBack();
                break;
            case 'arrange-virtual-objects':
                this.showArrangeDialog();
                break;
            case 'protect-fix':
                this.applyProtection('fixed');
                break;
            case 'unprotect-fix':
                this.removeProtection('fixed');
                break;
            case 'protect-background':
                this.applyProtection('background');
                break;
            case 'unprotect-background':
                this.removeProtection('background');
                break;
            case 'undo':
                // TODO: Undo機能
                logger.debug('[VirtualObjectList] Undo未実装');
                break;
            case 'redo':
                // TODO: Redo機能
                logger.debug('[VirtualObjectList] Redo未実装');
                break;
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
            case 'rename-real-object':
                this.renameRealObject();
                break;
            case 'duplicate-real-object':
                this.duplicateRealObject();
                break;
            case 'open-realobject-config':
                this.openRealObjectConfig();
                break;
            case 'open-trash-real-objects':
                this.openTrashRealObjects();
                break;
            case 'open-virtual-object-network':
                this.openVirtualObjectNetwork();
                break;
            case 'open-real-object-search':
                this.openRealObjectSearch();
                break;
        }
    }

    /**
     * 選択された仮身の実身を指定されたプラグインで開く
     */
    async executeVirtualObjectWithPlugin(pluginId) {
        const selectedVirtualObject = this.getSelectedVirtualObject();
        if (!selectedVirtualObject) {
            logger.warn('[VirtualObjectList] 仮身が選択されていません');
            return;
        }

        // extractRealIdを使用してcloseRealObject()のキー形式と一致させる
        const realId = window.RealObjectSystem.extractRealId(selectedVirtualObject.link_id);
        logger.debug('[VirtualObjectList] 仮身の実身を開く:', realId, 'プラグイン:', pluginId);

        const messageId = `open-${realId}-${Date.now()}`;

        // MessageBusでopen-virtual-object-realを送信
        this.messageBus.send('open-virtual-object-real', {
            virtualObj: selectedVirtualObject,
            pluginId: pluginId,
            messageId: messageId
        });

        try {
            // ウィンドウが開いた通知を待つ（タイムアウト30秒）
            const result = await this.messageBus.waitFor('window-opened', window.LONG_OPERATION_TIMEOUT_MS, (data) => {
                return data.messageId === messageId;
            });

            if (result.success && result.windowId) {
                // 開いたウィンドウを追跡
                this.openedRealObjects.set(realId, result.windowId);
                logger.debug('[VirtualObjectList] ウィンドウが開きました:', result.windowId, 'realId:', realId);

                // ウィンドウのアイコンを設定
                // realIdから_0.xtadなどのサフィックスを除去して基本実身IDを取得（共通メソッドを使用）
                const baseRealId = window.RealObjectSystem.extractRealId(realId);
                const iconPath = `${baseRealId}.ico`;
                    this.messageBus.send('set-window-icon', {
                    windowId: result.windowId,
                    iconPath: iconPath
                });
                logger.debug('[VirtualObjectList] ウィンドウアイコン設定要求:', result.windowId, iconPath);
            }
        } catch (error) {
            logger.error('[VirtualObjectList] ウィンドウを開く処理でエラー:', error);
        }
    }

    /**
     * 選択中の仮身を最前面に移動
     */
    moveSelectedVirtualObjectToFront() {
        const selectedVirtualObject = this.getSelectedVirtualObject();
        if (!selectedVirtualObject) {
            logger.warn('[VirtualObjectList] 選択中の仮身がありません');
            return;
        }

        // 背景化された仮身は最前面に移動不可（通常仮身の上にはいけない）
        if (selectedVirtualObject.isBackground) {
            logger.debug('[VirtualObjectList] 背景化されているため最前面に移動できません');
            return;
        }

        logger.debug('[VirtualObjectList] 仮身を最前面に移動:', selectedVirtualObject.link_name);

        // 並び替え前に各仮身の現在のXMLインデックスを保存
        for (let i = 0; i < this.virtualObjects.length; i++) {
            this.virtualObjects[i]._xmlIndex = i;
        }

        // 配列から選択中の仮身を削除して末尾に追加（最前面 = 配列の末尾）
        // 配列変更時は選択状態を保持
        this.preserveSelection(() => {
            const index = this.virtualObjects.indexOf(selectedVirtualObject);
            if (index !== -1) {
                this.virtualObjects.splice(index, 1);
                this.virtualObjects.push(selectedVirtualObject);
            }
        });

        // XMLの順序を更新
        this.reorderVirtualObjectsInXml();

        // 再描画
        this.renderVirtualObjects();

        // 保存通知
        this.notifyXmlDataChanged();

        logger.debug('[VirtualObjectList] 仮身を最前面に移動完了');
    }

    /**
     * 選択中の仮身を最背面に移動
     */
    moveSelectedVirtualObjectToBack() {
        const selectedVirtualObject = this.getSelectedVirtualObject();
        if (!selectedVirtualObject) {
            logger.warn('[VirtualObjectList] 選択中の仮身がありません');
            return;
        }

        // 固定化された仮身は移動可能、背景化された仮身は移動不可
        if (selectedVirtualObject.isBackground) {
            logger.debug('[VirtualObjectList] 背景化されているため移動できません');
            return;
        }

        logger.debug('[VirtualObjectList] 仮身を最背面に移動:', selectedVirtualObject.link_name);

        // 並び替え前に各仮身の現在のXMLインデックスを保存
        for (let i = 0; i < this.virtualObjects.length; i++) {
            this.virtualObjects[i]._xmlIndex = i;
        }

        // 背景化された仮身と通常の仮身を分離
        const backgroundObjects = this.virtualObjects.filter(obj => obj.isBackground);
        const normalObjects = this.virtualObjects.filter(obj => !obj.isBackground);

        // 選択された仮身を通常の仮身から除外
        const otherNormalObjects = normalObjects.filter(obj => obj !== selectedVirtualObject);

        // 並び順：背景化された仮身、選択された仮身、その他の通常の仮身
        // 配列変更時は選択状態を保持
        this.preserveSelection(() => {
            this.virtualObjects = [...backgroundObjects, selectedVirtualObject, ...otherNormalObjects];
        });

        // XMLの順序を更新
        this.reorderVirtualObjectsInXml();

        // 再描画
        this.renderVirtualObjects();

        // 保存通知
        this.notifyXmlDataChanged();

        logger.debug('[VirtualObjectList] 仮身を背景化仮身の直後に移動完了');
    }

    /**
     * ファイルから仮身を追加
     * @param {Object} file - ファイル情報
     */
    async addVirtualObjectFromFile(file) {
        try {
            // ファイル名から拡張子を除いたIDを生成
            const fileId = file.name.replace(/\.(tad|TAD|xtad|XTAD|bpk|BPK)$/, '');

            // 新しい仮身オブジェクトを作成（適当な位置に配置）
            const newVirtualObject = {
                link_id: file.name,
                link_name: fileId,
                vobjleft: 100,
                vobjtop: 100, // 既存の仮身の下に配置
                vobjright: 250,
                vobjbottom: 130,
                width: 100,
                heightPx: 50,
                chsz: 16,           // デフォルトフォントサイズ
                frcol: '#000000',   // デフォルト枠色
                chcol: '#000000',   // デフォルト文字色
                tbcol: '#ffffff',   // デフォルト背景色
                bgcol: '#ffffff',   // デフォルト開いた仮身の背景色
                applist: {}, // メタデータは後で読み込み
                metadata: null
            };

            // BPK/TADファイルかどうかを判定
            const isBPK = /\.(bpk|BPK)$/.test(file.name);
            const isTAD = /\.(tad|TAD)$/.test(file.name);

            // BPK/TADファイル以外はメタデータを読み込み
            if (!isBPK && !isTAD) {
                await this.loadVirtualObjectMetadata(newVirtualObject);
            }

            // JSONファイルが無い場合（bpk/tadファイル）、デフォルトでtadjs-viewを設定
            if (!newVirtualObject.applist || Object.keys(newVirtualObject.applist).length === 0) {
                // BPKファイルの場合はunpack-fileも追加
                if (isBPK) {
                    newVirtualObject.applist = {
                        'tadjs-view': {
                            'name': 'TADjs表示'
                        },
                        'unpack-file': {
                            'name': '書庫解凍',
                            'defaultOpen': true
                        }
                    };
                } else {
                    newVirtualObject.applist = {
                        'tadjs-view': {
                            'name': 'TADjs表示',
                            'defaultOpen': true
                        }
                    };
                }
                logger.debug('[VirtualObjectList] デフォルトapplist設定:', newVirtualObject.applist);
            }

            // 仮身リストに追加
            this.virtualObjects.push(newVirtualObject);

            // 再描画
            this.renderVirtualObjects();

            logger.debug('[VirtualObjectList] 仮身を追加しました:', file.name);
        } catch (error) {
            logger.error('[VirtualObjectList] 仮身追加エラー:', error);
        }
    }

    /**
     * ファイルに保存（ダウンロード）
     */
    saveToFile() {
        if (!this.xmlData) {
            logger.warn('[VirtualObjectList] 保存するデータがありません');
            return;
        }

        // 親ウィンドウに保存を通知
        this.notifyXmlDataChanged();
        logger.debug('[VirtualObjectList] ファイル保存を実行');
    }

    /**
     * 新たな実身に保存（非再帰的コピー）
     */
    async saveAsNewRealObject() {
        logger.debug('[VirtualObjectList] saveAsNewRealObject - realId:', this.realId);

        if (!this.xmlData) {
            logger.warn('[VirtualObjectList] 保存するデータがありません');
            return;
        }

        // 選択されている仮身が1つであることを確認
        if (this.selectedVirtualObjects.size !== 1) {
            logger.warn('[VirtualObjectList] 仮身を1つ選択してください');
            return;
        }

        // 選択されている仮身のvobjIndexを取得
        const selectedVobjIndex = Array.from(this.selectedVirtualObjects)[0];
        logger.debug('[VirtualObjectList] 選択されているvobjIndex:', selectedVobjIndex);

        // virtualObjects配列から実際のオブジェクトを取得
        const selectedVobj = this.virtualObjects[selectedVobjIndex];
        if (!selectedVobj) {
            logger.error('[VirtualObjectList] 選択されている仮身が見つかりません:', selectedVobjIndex);
            return;
        }
        logger.debug('[VirtualObjectList] 選択されている仮身オブジェクト:', selectedVobj);

        // まず現在のデータを保存
        this.notifyXmlDataChanged();

        // 親ウィンドウに新たな実身への保存を要求
        const messageId = this.generateMessageId('save-as-new');

        // MessageBusでsave-as-new-real-objectを送信
        this.messageBus.send('save-as-new-real-object', {
            realId: this.realId,
            messageId: messageId
        });

        try {
            // レスポンスを待つ（ユーザー入力を待つのでタイムアウト無効）
            const result = await this.messageBus.waitFor('save-as-new-real-object-completed', 0, (data) => {
                return data.messageId === messageId;
            });

            if (result.cancelled) {
                logger.debug('[VirtualObjectList] 新たな実身への保存がキャンセルされました');
            } else if (result.success) {
                logger.debug('[VirtualObjectList] 新たな実身への保存成功:', result.newRealId, '名前:', result.newName);

                // 新しい仮身を元の仮身の下に配置
                const newVirtualObj = {
                    link_id: result.newRealId,
                    link_name: result.newName,
                    vobjleft: selectedVobj.vobjleft,
                    vobjtop: selectedVobj.vobjbottom + 10, // 元の仮身の下に配置
                    vobjright: selectedVobj.vobjright,
                    vobjbottom: selectedVobj.vobjbottom + 10 + (selectedVobj.vobjbottom - selectedVobj.vobjtop),
                    width: selectedVobj.width,
                    heightPx: selectedVobj.heightPx,
                    chsz: selectedVobj.chsz || 14,
                    frcol: selectedVobj.frcol || '#000000',
                    chcol: selectedVobj.chcol || '#000000',
                    tbcol: selectedVobj.tbcol || '#ffffff',
                    bgcol: selectedVobj.bgcol || '#ffffff',
                    dlen: selectedVobj.dlen || 0,
                    applist: selectedVobj.applist || {},
                    // 表示属性もコピー
                    pictdisp: selectedVobj.pictdisp || 'true',
                    namedisp: selectedVobj.namedisp || 'true',
                    roledisp: selectedVobj.roledisp || 'false',
                    typedisp: selectedVobj.typedisp || 'false',
                    updatedisp: selectedVobj.updatedisp || 'false',
                    framedisp: selectedVobj.framedisp || 'true',
                    autoopen: selectedVobj.autoopen || 'false'
                };

                // XMLに仮身を追加（addVirtualObjectToXmlが自動保存する）
                this.addVirtualObjectToXml(newVirtualObj);

                // 仮身リストに追加
                this.virtualObjects.push(newVirtualObj);

                // 再描画
                this.renderVirtualObjects();
            } else {
                logger.error('[VirtualObjectList] 新たな実身への保存失敗:', result.error);
            }
        } catch (error) {
            logger.error('[VirtualObjectList] 新たな実身への保存エラー:', error);
        }
    }

    // requestCloseWindow() は基底クラス PluginBase で定義

    /**
     * 選択中の仮身をコピー
     */
    copySelectedVirtualObject() {
        const selectedVirtualObject = this.getSelectedVirtualObject();
        if (!selectedVirtualObject) {
            logger.warn('[VirtualObjectList] 選択中の仮身がありません');
            return;
        }

        // クリップボードに仮身データをコピー（実身IDを保持）
        const clipboardData = JSON.parse(JSON.stringify(selectedVirtualObject));

        // 親ウィンドウのグローバルクリップボードに設定
        this.messageBus.send('set-clipboard', {
            clipboardData: clipboardData
        });

        logger.debug('[VirtualObjectList] 仮身をクリップボードにコピー:', clipboardData.link_name, 'realId:', clipboardData.link_id);
    }

    /**
     * 選択中の仮身をカット
     */
    cutSelectedVirtualObject() {
        const selectedVirtualObject = this.getSelectedVirtualObject();
        if (!selectedVirtualObject) {
            logger.warn('[VirtualObjectList] 選択中の仮身がありません');
            return;
        }

        // クリップボードにコピー
        const clipboardData = JSON.parse(JSON.stringify(selectedVirtualObject));

        // 親ウィンドウのグローバルクリップボードに設定
        this.messageBus.send('set-clipboard', {
            clipboardData: clipboardData
        });

        // 元の仮身を削除
        const index = this.virtualObjects.findIndex(obj => obj === selectedVirtualObject);
        if (index !== -1) {
            this.virtualObjects.splice(index, 1);
            this.selectedVirtualObjects.clear();
            this.renderVirtualObjects();

            // refCount-1（カット = ドキュメントから参照が削除される）
            this.requestDeleteVirtualObject(selectedVirtualObject.link_id);
        }
    }

    /**
     * クリップボードから仮身をペースト
     */
    async pasteVirtualObject() {
        // 親ウィンドウからクリップボードを取得
        const clipboard = await this.getClipboard();

        if (!clipboard) {
            logger.warn('[VirtualObjectList] クリップボードが空です');
            return;
        }

        // 新しい仮身オブジェクトを作成（位置を少しずらす）
        const newVirtualObj = JSON.parse(JSON.stringify(clipboard));
        newVirtualObj.vobjleft += 20;
        newVirtualObj.vobjtop += 20;
        newVirtualObj.vobjright += 20;
        newVirtualObj.vobjbottom += 20;

        // 実身IDはそのまま使用（仮身の複製なので実身は共有）
        const realId = newVirtualObj.link_id;

        // 仮身リストに追加
        this.virtualObjects.push(newVirtualObj);

        // xmlTADに追加
        this.addVirtualObjectToXml(newVirtualObj);

        // 再描画
        this.renderVirtualObjects();

        // 親ウィンドウに仮身コピーを通知してrefCountを+1
        this.requestCopyVirtualObject(realId);

        logger.debug('[VirtualObjectList] 仮身をペースト:', newVirtualObj.link_name, 'realId:', realId);
    }

    // getClipboard() は基底クラス PluginBase で定義

    /**
     * 選択中の仮身を削除
     */
    deleteSelectedVirtualObject() {
        const selectedVirtualObject = this.getSelectedVirtualObject();
        if (!selectedVirtualObject) {
            logger.warn('[VirtualObjectList] 選択中の仮身がありません');
            return;
        }

        // 保護チェック：固定化または背景化されている場合は削除を無効化
        if (selectedVirtualObject.isFixed || selectedVirtualObject.isBackground) {
            logger.debug('[VirtualObjectList] 保護されているため削除できません:', selectedVirtualObject.link_name,
                selectedVirtualObject.isFixed ? '固定化' : '', selectedVirtualObject.isBackground ? '背景化' : '');
            return;
        }

        const realId = selectedVirtualObject.link_id;
        const linkName = selectedVirtualObject.link_name;

        // 仮身リストから削除（XML削除前にインデックスを取得）
        const index = this.virtualObjects.findIndex(obj => obj === selectedVirtualObject);

        // xmlTADから削除（配列から削除する前にインデックスを渡す）
        this.removeVirtualObjectFromXml(selectedVirtualObject, index);

        // 配列から削除
        if (index !== -1) {
            this.virtualObjects.splice(index, 1);
        }

        // 選択解除
        this.selectedVirtualObjects.clear();

        // 再描画
        this.renderVirtualObjects();

        // 親ウィンドウに仮身削除を通知してrefCount-1
        this.requestDeleteVirtualObject(realId);

        logger.debug('[VirtualObjectList] 仮身を削除:', linkName, 'realId:', realId);
    }

    /**
     * 実身のappList情報を取得（共通メソッドのラッパー）
     */
    // getAppListData() は基底クラス PluginBase で定義

    /**
     * 選択中の仮身が指し示す実身の名前を変更
     */
    async renameRealObject() {
        const selectedVirtualObject = this.getSelectedVirtualObject();
        if (!selectedVirtualObject) {
            logger.warn('[VirtualObjectList] 選択中の仮身がありません');
            return;
        }

        // 実身IDを抽出（共通メソッドを使用）
        const realId = window.RealObjectSystem.extractRealId(selectedVirtualObject.link_id);

        // 共通メソッド用にcontextMenuVirtualObjectを一時設定
        this.contextMenuVirtualObject = {
            element: null,
            realId: realId,
            virtualObj: selectedVirtualObject
        };

        const result = await window.RealObjectSystem.renameRealObject(this);

        // 仮身一覧プラグイン特有の処理: メモリ内の仮身オブジェクトを更新
        if (result.success) {
            // virtualObjects内の該当仮身を更新
            if (this.virtualObjects) {
                for (const vo of this.virtualObjects) {
                    if (vo.link_id === selectedVirtualObject.link_id) {
                        vo.link_name = result.newName;
                        logger.debug('[VirtualObjectList] virtualObjects内の仮身名を更新:', vo.link_id, '->', result.newName);
                    }
                }
            }

            // DOM上の表示名を更新（再描画せずに直接更新）
            const vobjElements = document.querySelectorAll('.virtual-object, .virtual-object-closed, .virtual-object-opened');
            vobjElements.forEach(element => {
                if (element.getAttribute('data-link-id') === selectedVirtualObject.link_id) {
                    const nameSpan = element.querySelector('.virtual-object-name');
                    if (nameSpan) {
                        nameSpan.textContent = result.newName;
                        logger.debug('[VirtualObjectList] DOM上の仮身名を更新:', selectedVirtualObject.link_id, '->', result.newName);
                    }
                }
            });

            // XMLデータを保存
            this.saveToFile();
        }

        // contextMenuVirtualObjectをクリア
        this.contextMenuVirtualObject = null;
    }

    /**
     * 選択中の仮身が指し示す実身を複製
     */
    async duplicateRealObject() {
        const selectedVirtualObject = this.getSelectedVirtualObject();
        if (!selectedVirtualObject) {
            logger.warn('[VirtualObjectList] 選択中の仮身がありません');
            return;
        }

        // 実身IDを抽出（共通メソッドを使用）
        const realId = window.RealObjectSystem.extractRealId(selectedVirtualObject.link_id);

        // 共通メソッド用にcontextMenuVirtualObjectを一時設定
        this.contextMenuVirtualObject = {
            element: null,
            realId: realId,
            virtualObj: selectedVirtualObject
        };

        // 親ウィンドウに実身複製を要求（共通メソッドを使用）
        if (window.parent && window.parent !== window) {
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
                    // 仮身一覧プラグイン特有の処理: 複製した実身の仮身を元の仮身の下に追加
                    const newVirtualObj = {
                        link_id: result.newRealId,
                        link_name: result.newName,
                        vobjleft: selectedVirtualObject.vobjleft + 20,
                        vobjtop: selectedVirtualObject.vobjtop + 30,
                        vobjright: selectedVirtualObject.vobjright + 20,
                        vobjbottom: selectedVirtualObject.vobjbottom + 30,
                        width: selectedVirtualObject.width,
                        heightPx: selectedVirtualObject.heightPx,
                        chsz: selectedVirtualObject.chsz,
                        frcol: selectedVirtualObject.frcol,
                        chcol: selectedVirtualObject.chcol,
                        tbcol: selectedVirtualObject.tbcol,
                        bgcol: selectedVirtualObject.bgcol,
                        dlen: selectedVirtualObject.dlen,
                        applist: selectedVirtualObject.applist || {},
                        // 表示属性もコピー
                        pictdisp: selectedVirtualObject.pictdisp || 'true',
                        namedisp: selectedVirtualObject.namedisp || 'true',
                        roledisp: selectedVirtualObject.roledisp || 'false',
                        typedisp: selectedVirtualObject.typedisp || 'false',
                        updatedisp: selectedVirtualObject.updatedisp || 'false',
                        framedisp: selectedVirtualObject.framedisp || 'true',
                        autoopen: selectedVirtualObject.autoopen || 'false'
                    };

                    // 仮身リストに追加
                    this.virtualObjects.push(newVirtualObj);

                    // xmlTADに追加
                    this.addVirtualObjectToXml(newVirtualObj);

                    // 再描画
                    this.renderVirtualObjects();

                    this.setStatus(`実身を複製しました: ${result.newName}`);
                }
            } catch (error) {
                logger.error('[VirtualObjectList] 実身複製エラー:', error);
                this.setStatus('実身の複製に失敗しました');
            }
        }

        // contextMenuVirtualObjectをクリア
        this.contextMenuVirtualObject = null;
    }

    /**
     * 管理情報ウィンドウを開く
     */
    openRealObjectConfig() {
        const selectedVirtualObject = this.getSelectedVirtualObject();
        if (!selectedVirtualObject) {
            this.setStatus('仮身を選択してください');
            return;
        }

        // 実身IDを抽出
        const realId = window.RealObjectSystem.extractRealId(selectedVirtualObject.link_id);

        // 共通メソッド用にcontextMenuVirtualObjectを一時設定
        this.contextMenuVirtualObject = {
            element: null,
            realId: realId,
            virtualObj: selectedVirtualObject
        };

        // 管理情報ウィンドウを開く
        window.RealObjectSystem.openRealObjectConfig(this, realId);

        // contextMenuVirtualObjectをクリア
        this.contextMenuVirtualObject = null;
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
        const selectedVirtualObject = this.getSelectedVirtualObject();
        if (!selectedVirtualObject) {
            logger.warn('[VirtualObjectList] 仮身が選択されていません');
            this.setStatus('仮身を選択してください');
            return;
        }

        // link_idから実身IDを抽出
        const realId = window.RealObjectSystem.extractRealId(selectedVirtualObject.link_id);
        if (!realId) {
            logger.warn('[VirtualObjectList] 実身IDが取得できません');
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
     * ダブルクリック+ドラッグによる実身複製処理
     * @param {number} dropX - ドラッグ終了位置のX座標（キャンバス座標系）
     * @param {number} dropY - ドラッグ終了位置のY座標（キャンバス座標系）
     */
    async handleDoubleClickDragDuplicate(dropX, dropY) {
        const obj = this.dblClickDragState.dblClickedObject;
        if (!obj || !obj.link_id) {
            logger.error('[VirtualObjectList] 複製対象の仮身が不正です');
            return;
        }

        const realId = obj.link_id;
        logger.debug('[VirtualObjectList] ダブルクリック+ドラッグによる実身複製:', realId, 'ドロップ位置:', dropX, dropY);

        // 元の仮身のサイズと属性を保存
        const width = obj.width || (obj.vobjright - obj.vobjleft) || 100;
        const height = obj.heightPx || (obj.vobjbottom - obj.vobjtop) || 32;
        const chsz = obj.chsz || 14;
        const frcol = obj.frcol || '#000000';
        const chcol = obj.chcol || '#000000';
        const tbcol = obj.tbcol || '#ffffff';
        const bgcol = obj.bgcol || '#ffffff';
        const dlen = obj.dlen || 0;
        const applist = obj.applist || {};
        // 表示属性も保存
        const pictdisp = obj.pictdisp || 'true';
        const namedisp = obj.namedisp || 'true';
        const roledisp = obj.roledisp || 'false';
        const typedisp = obj.typedisp || 'false';
        const updatedisp = obj.updatedisp || 'false';
        const framedisp = obj.framedisp || 'true';
        const autoopen = obj.autoopen || 'false';

        // メッセージIDを生成
        const messageId = this.generateMessageId('duplicate');

        // MessageBusでduplicate-real-objectを送信
        this.messageBus.send('duplicate-real-object', {
            realId: realId,
            messageId: messageId
        });

        try {
            // レスポンスを待つ（ユーザー入力を待つのでタイムアウト無効）
            const result = await this.messageBus.waitFor('real-object-duplicated', 0, (data) => {
                return data.messageId === messageId;
            });

            if (result.cancelled) {
                logger.debug('[VirtualObjectList] 実身複製がキャンセルされました');
            } else if (result.success) {
                // 複製成功: 新しい実身IDで仮身を作成
                const newRealId = result.newRealId;
                const newName = result.newName;
                logger.debug('[VirtualObjectList] 実身複製成功:', realId, '->', newRealId, '名前:', newName);

                // 新しい仮身オブジェクトを作成（ドラッグ終了位置に配置）
                const newVirtualObj = {
                    link_id: newRealId,
                    link_name: newName,
                    vobjleft: Math.round(dropX),
                    vobjtop: Math.round(dropY),
                    vobjright: Math.round(dropX + width),
                    vobjbottom: Math.round(dropY + height),
                    width: width,
                    heightPx: height,
                    chsz: chsz,
                    frcol: frcol,
                    chcol: chcol,
                    tbcol: tbcol,
                    bgcol: bgcol,
                    dlen: dlen,
                    applist: applist,
                    // 表示属性もコピー
                    pictdisp: pictdisp,
                    namedisp: namedisp,
                    roledisp: roledisp,
                    typedisp: typedisp,
                    updatedisp: updatedisp,
                    framedisp: framedisp,
                    autoopen: autoopen,
                    originalLeft: Math.round(dropX),
                    originalTop: Math.round(dropY),
                    originalRight: Math.round(dropX + width),
                    originalBottom: Math.round(dropY + height)
                };

                // 仮身リストに追加
                this.virtualObjects.push(newVirtualObj);

                // xmlTADに追加
                this.addVirtualObjectToXml(newVirtualObj);

                // 再描画
                this.renderVirtualObjects();
            } else {
                logger.error('[VirtualObjectList] 実身複製失敗:', result.error);
            }
        } catch (error) {
            logger.error('[VirtualObjectList] 実身複製エラー:', error);
        }
    }

    /**
     * 選択中の仮身が指し示す実身をデフォルトアプリで開く
     */
    openRealObjectWithDefaultApp() {
        const selectedVirtualObject = this.getSelectedVirtualObject();
        if (!selectedVirtualObject) {
            logger.warn('[VirtualObjectList] 選択中の仮身がありません');
            return;
        }

        const applist = selectedVirtualObject.applist;
        if (!applist || typeof applist !== 'object') {
            logger.warn('[VirtualObjectList] applistが存在しません');
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
            logger.warn('[VirtualObjectList] 開くためのプラグインが見つかりません');
            return;
        }

        // 実身を開く
        this.executeVirtualObjectWithPlugin(defaultPluginId);

        // 開いた実身を追跡
        const realId = selectedVirtualObject.link_id;
        // windowIdは親ウィンドウから通知される想定
        logger.debug('[VirtualObjectList] 実身を開く:', realId, 'with', defaultPluginId);
    }

    /**
     * 選択中の仮身が指し示す開いている実身を閉じる
     */
    closeRealObject() {
        const selectedVirtualObject = this.getSelectedVirtualObject();
        if (!selectedVirtualObject) {
            logger.warn('[VirtualObjectList] 選択中の仮身がありません');
            return;
        }

        // 実身IDを抽出（共通メソッドを使用）
        const realId = window.RealObjectSystem.extractRealId(selectedVirtualObject.link_id);

        // 共通メソッド用にcontextMenuVirtualObjectを一時設定
        this.contextMenuVirtualObject = {
            element: null,
            realId: realId,
            virtualObj: selectedVirtualObject
        };

        window.RealObjectSystem.closeRealObject(this);

        // contextMenuVirtualObjectをクリア
        this.contextMenuVirtualObject = null;

        // 追跡からの削除はwindow-closedメッセージで行う
    }

    /**
     * クローズ要求ハンドラ（オーバーライド）
     * 仮身一覧プラグインはクローズ前に自動保存を実行
     */
    async handleCloseRequest(windowId) {
        // クローズ前に自動保存を実行
        this.notifyXmlDataChanged();

        // 親クラスの処理を呼び出し（スクロール位置保存含む）
        return super.handleCloseRequest(windowId);
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
                logger.debug('[VirtualObjectList] 実身の追跡を削除:', realId);
            }
        }

        // windowIdで検索して削除
        for (const [realId, wId] of this.openedRealObjects.entries()) {
            if (wId === windowId) {
                this.openedRealObjects.delete(realId);
                logger.debug('[VirtualObjectList] windowIdから実身の追跡を削除:', realId, windowId);
                break;
            }
        }
    }

    /**
     * 仮身属性変更ダイアログを表示
     */
    async changeVirtualObjectAttributes() {
        const selectedVirtualObject = this.getSelectedVirtualObject();
        if (!selectedVirtualObject) {
            logger.warn('[VirtualObjectList] 選択中の仮身がありません');
            return;
        }

        // 実身IDを抽出（共通メソッドを使用）
        const realId = window.RealObjectSystem.extractRealId(selectedVirtualObject.link_id);

        // 共通メソッド用にcontextMenuVirtualObjectを一時設定
        // RealObjectSystemはgetVirtualObjectCurrentAttrsを使用するため、elementは不要
        this.contextMenuVirtualObject = {
            element: null,
            realId: realId,
            virtualObj: selectedVirtualObject
        };

        await window.RealObjectSystem.changeVirtualObjectAttributes(this);

        // contextMenuVirtualObjectをクリア
        this.contextMenuVirtualObject = null;
    }

    /**
     * 続柄設定ダイアログを表示
     */
    async setRelationship() {
        const selectedVirtualObject = this.getSelectedVirtualObject();
        if (!selectedVirtualObject) {
            logger.warn('[VirtualObjectList] 選択中の仮身がありません');
            return { success: false };
        }

        // 実身IDを抽出（共通メソッドを使用）
        const realId = window.RealObjectSystem.extractRealId(selectedVirtualObject.link_id);

        // 共通メソッド用にcontextMenuVirtualObjectを一時設定
        this.contextMenuVirtualObject = {
            element: null,
            realId: realId,
            virtualObj: selectedVirtualObject
        };

        // 親クラスのsetRelationship()を呼び出す（metadata更新とフック呼び出しを含む）
        const result = await super.setRelationship();

        // contextMenuVirtualObjectをクリア
        this.contextMenuVirtualObject = null;

        return result;
    }

    /**
     * 続柄更新後の再描画（PluginBaseフック）
     */
    onRelationshipUpdated(virtualObj, result) {
        this.renderVirtualObjects();
    }

    /**
     * ステータスメッセージを設定
     */
    setStatus(message) {
        logger.debug('[VirtualObjectList] Status:', message);
        // 親ウィンドウにステータスメッセージを送信（PluginBaseの共通実装を呼び出し）
        super.setStatus(message);
    }

    /**
     * 仮身に属性を適用
     * @param {Object} attrs - 適用する属性値
     */
    applyVirtualObjectAttributes(attrs) {
        // contextMenuVirtualObjectまたは選択中の仮身を使用
        const vobj = this.contextMenuVirtualObject?.virtualObj || this.getSelectedVirtualObject();
        if (!vobj) return;

        // vobjIndexを取得（querySelector用）
        const vobjIndex = this.virtualObjects.indexOf(vobj);

        // chsz変更前の値を保存（サイズ調整用）
        const oldChsz = parseInt(vobj.chsz) || 14;

        // PluginBaseの共通メソッドで属性を適用し、変更を取得
        const changes = this._applyVobjAttrs(vobj, attrs);

        // 変更がない場合は早期リターン
        if (!this._hasVobjAttrChanges(changes)) {
            logger.debug('[VirtualObjectList] 属性に変更がないため処理をスキップ');
            return;
        }

        // 変更をログ出力
        for (const [key, change] of Object.entries(changes)) {
            logger.debug(`[VirtualObjectList] ${key}変更:`, change.old, '->', change.new);
        }

        const chszChanged = this._isVobjAttrChanged(changes, 'chsz');
        const pictdispChanged = this._isVobjAttrChanged(changes, 'pictdisp');

        // 文字サイズ変更時のサイズ調整
        if (chszChanged) {
            const newChsz = parseInt(vobj.chsz);

            // DOMから実際の仮身要素を取得し、コンテンツエリアの有無で開閉状態を判定
            const vobjElement = document.querySelector(`[data-vobj-index="${vobjIndex}"]`);
            const hasContentArea = vobjElement ?
                (vobjElement.querySelector('.virtual-object-content-area') !== null ||
                 vobjElement.querySelector('.virtual-object-content-iframe') !== null) : false;

            // 現在のサイズを取得
            const vobjHeight = vobj.vobjbottom - vobj.vobjtop;
            const vobjWidth = vobj.vobjright - vobj.vobjleft;

            logger.debug('[VirtualObjectList] chsz変更:', {
                oldChsz,
                newChsz,
                vobjHeight,
                hasContentArea
            });

            if (!hasContentArea) {
                // 閉じた仮身の場合、高さを新しいchszに合わせて調整
                // chszはポイント（pt）なのでピクセル（px）に変換
                const lineHeight = 1.2;
                const newChszPx = window.convertPtToPx(newChsz);
                const textHeight = Math.ceil(newChszPx * lineHeight);
                const newHeight = textHeight + 8;
                vobj.vobjbottom = vobj.vobjtop + newHeight;
                logger.debug('[VirtualObjectList] 閉じた仮身の高さを調整:', vobjHeight, '->', newHeight, `(${newChsz}pt = ${newChszPx}px)`);
            } else {
                // 開いた仮身の場合、chszに比例して高さを調整
                const lineHeight = 1.2;
                const newChszPx = window.convertPtToPx(newChsz);
                const textHeight = Math.ceil(newChszPx * lineHeight);
                const newMinOpenHeight = textHeight + 30;
                const heightRatio = newChsz / oldChsz;
                const adjustedHeight = Math.max(newMinOpenHeight, Math.round(vobjHeight * heightRatio));
                vobj.vobjbottom = vobj.vobjtop + adjustedHeight;
                logger.debug('[VirtualObjectList] 開いた仮身の高さを比例調整:', vobjHeight, '->', adjustedHeight, 'ratio:', heightRatio);
            }

            // 幅も文字サイズに応じて調整(最小幅を確保)
            const newChszPx = window.convertPtToPx(newChsz);
            const minWidth = Math.max(50, newChszPx * 6); // chszPxの6倍を最小幅とする
            if (vobjWidth < minWidth) {
                vobj.vobjright = vobj.vobjleft + minWidth;
                logger.debug('[VirtualObjectList] 最小幅を確保:', vobjWidth, '->', minWidth);
            }
        }

        // pictdisp変更時の高さ調整（chszが変更されていない場合のみ）
        if (pictdispChanged && !chszChanged) {
            const vobjElement = document.querySelector(`[data-vobj-index="${vobjIndex}"]`);
            const hasContentArea = vobjElement ?
                (vobjElement.querySelector('.virtual-object-content-area') !== null ||
                 vobjElement.querySelector('.virtual-object-content-iframe') !== null) : false;

            if (!hasContentArea) {
                // 閉じた仮身の場合、アイコン表示/非表示に関わらず高さは一定
                // chszはポイント（pt）なのでピクセル（px）に変換
                const currentHeight = vobj.vobjbottom - vobj.vobjtop;
                const chsz = parseInt(vobj.chsz) || 14;
                const lineHeight = 1.2;
                const chszPx = window.convertPtToPx(chsz);
                const textHeight = Math.ceil(chszPx * lineHeight);
                const newHeight = textHeight + 8;

                // 高さが既に正しい場合はスキップ
                if (currentHeight !== newHeight) {
                    vobj.vobjbottom = vobj.vobjtop + newHeight;
                    logger.debug('[VirtualObjectList] pictdisp変更による高さ調整:', currentHeight, '->', newHeight);
                }
            }
        }

        // xmlTADを更新
        this.updateVirtualObjectInXml(vobj);

        // openedプロパティをクリア（高さベースの判定を使用するため）
        delete vobj.opened;

        // 開いた仮身の場合の処理
        const vobjElement = document.querySelector(`[data-vobj-index="${vobjIndex}"]`);
        const iframe = vobjElement ? vobjElement.querySelector('.virtual-object-content-iframe') : null;

        if (vobjElement && iframe) {
            logger.debug('[VirtualObjectList] 開いた仮身の属性を更新:', vobj.link_name);

            // 背景色のみの変更の場合は、iframeに直接通知して再描画を回避
            const bgcolChanged = attrs.bgcol !== undefined;
            const onlyBgcolChanged = bgcolChanged &&
                Object.keys(attrs).filter(key => attrs[key] !== undefined).length === 1;

            if (onlyBgcolChanged) {
                // 背景色のみ変更の場合、iframeに通知
                if (iframe.contentWindow) {
                    iframe.contentWindow.postMessage({
                        type: 'update-background-color',
                        bgcol: vobj.bgcol
                    }, '*');
                    logger.debug('[VirtualObjectList] 開いた仮身のiframeに背景色変更を通知:', vobj.bgcol);
                }
            } else {
                // その他の属性変更がある場合は、再描画
                this.renderVirtualObjects();
            }
        } else {
            // 開いていない仮身の場合は通常の再描画
            this.renderVirtualObjects();
        }

        logger.debug('[VirtualObjectList] 仮身属性を適用:', attrs);
    }

    /**
     * 整頓ダイアログを表示
     */
    async showArrangeDialog() {
        if (this.selectedVirtualObjects.size === 0) {
            logger.warn('[VirtualObjectList] 選択中の仮身がありません');
            return;
        }

        const selectedCount = this.selectedVirtualObjects.size;
        const isMultiple = selectedCount > 1;

        // 無効状態のクラス
        const disabledClass = !isMultiple ? 'disabled' : '';
        const disabledAttr = !isMultiple ? 'disabled' : '';

        // ダイアログのHTML要素を作成（3段組レイアウト、縦並び、カスタムラジオボタン）
        const dialogHtml = `
<div class="arrange-dialog" style="font-size:11px">
    <div style="margin:0 0 8px 0;padding:0">選択: ${selectedCount}個</div>
    <div style="display:flex;gap:12px;margin:0;padding:0">
        <!-- 第1列: 横、縦、段組数 -->
        <div style="flex:1;display:flex;flex-direction:column;gap:8px">
            <div style="display:flex;align-items:flex-start;gap:4px">
                <span style="font-weight:bold;min-width:40px">横</span>
                <div class="radio-group-vertical">
                    <label class="radio-label ${disabledClass}">
                        <input type="radio" name="horizontal" value="left" ${disabledAttr}>
                        <span class="radio-indicator"></span>
                        <span>左揃え</span>
                    </label>
                    <label class="radio-label ${disabledClass}">
                        <input type="radio" name="horizontal" value="right" ${disabledAttr}>
                        <span class="radio-indicator"></span>
                        <span>右揃え</span>
                    </label>
                    <label class="radio-label">
                        <input type="radio" name="horizontal" value="none" checked>
                        <span class="radio-indicator"></span>
                        <span>なし</span>
                    </label>
                </div>
            </div>
            <div style="display:flex;align-items:flex-start;gap:4px">
                <span style="font-weight:bold;min-width:40px">縦</span>
                <div class="radio-group-vertical">
                    <label class="radio-label ${disabledClass}">
                        <input type="radio" name="vertical" value="compact" ${disabledAttr}>
                        <span class="radio-indicator"></span>
                        <span>詰める</span>
                    </label>
                    <label class="radio-label ${disabledClass}">
                        <input type="radio" name="vertical" value="align" ${disabledAttr}>
                        <span class="radio-indicator"></span>
                        <span>上揃え</span>
                    </label>
                    <label class="radio-label">
                        <input type="radio" name="vertical" value="none" checked>
                        <span class="radio-indicator"></span>
                        <span>なし</span>
                    </label>
                </div>
            </div>
            <div style="display:flex;align-items:center;gap:4px">
                <span style="font-weight:bold;min-width:40px">段組数</span>
                <input type="number" id="columnCount" min="1" value="1" style="width:40px;font-size:11px" ${disabledAttr}>
            </div>
        </div>
        <!-- 第2列: 段組、幅調整 -->
        <div style="flex:1;display:flex;flex-direction:column;gap:8px">
            <div style="display:flex;align-items:flex-start;gap:4px">
                <span style="font-weight:bold;min-width:40px">段組</span>
                <div class="radio-group-vertical">
                    <label class="radio-label ${disabledClass}">
                        <input type="radio" name="column" value="single" ${disabledAttr}>
                        <span class="radio-indicator"></span>
                        <span>1段</span>
                    </label>
                    <label class="radio-label ${disabledClass}">
                        <input type="radio" name="column" value="multi-horizontal" ${disabledAttr}>
                        <span class="radio-indicator"></span>
                        <span>左右</span>
                    </label>
                    <label class="radio-label ${disabledClass}">
                        <input type="radio" name="column" value="multi-vertical" ${disabledAttr}>
                        <span class="radio-indicator"></span>
                        <span>上下</span>
                    </label>
                    <label class="radio-label">
                        <input type="radio" name="column" value="none" checked>
                        <span class="radio-indicator"></span>
                        <span>なし</span>
                    </label>
                </div>
            </div>
            <div style="display:flex;align-items:flex-start;gap:4px">
                <span style="font-weight:bold;min-width:40px">幅調整</span>
                <div class="radio-group-vertical">
                    <label class="radio-label">
                        <input type="radio" name="length" value="first">
                        <span class="radio-indicator"></span>
                        <span>最初</span>
                    </label>
                    <label class="radio-label">
                        <input type="radio" name="length" value="full">
                        <span class="radio-indicator"></span>
                        <span>全項目</span>
                    </label>
                    <label class="radio-label">
                        <input type="radio" name="length" value="icon-name">
                        <span class="radio-indicator"></span>
                        <span>名前まで</span>
                    </label>
                    <label class="radio-label">
                        <input type="radio" name="length" value="with-relation">
                        <span class="radio-indicator"></span>
                        <span>続柄まで</span>
                    </label>
                    <label class="radio-label">
                        <input type="radio" name="length" value="without-date">
                        <span class="radio-indicator"></span>
                        <span>日付除く</span>
                    </label>
                    <label class="radio-label">
                        <input type="radio" name="length" value="none" checked>
                        <span class="radio-indicator"></span>
                        <span>なし</span>
                    </label>
                </div>
            </div>
        </div>
        <!-- 第3列: 整列順、順序 -->
        <div style="flex:1;display:flex;flex-direction:column;gap:8px">
            <div style="display:flex;align-items:flex-start;gap:4px">
                <span style="font-weight:bold;min-width:40px">整列順</span>
                <div class="radio-group-vertical">
                    <label class="radio-label ${disabledClass}">
                        <input type="radio" name="sortBy" value="name" ${disabledAttr}>
                        <span class="radio-indicator"></span>
                        <span>名前</span>
                    </label>
                    <label class="radio-label ${disabledClass}">
                        <input type="radio" name="sortBy" value="created" ${disabledAttr}>
                        <span class="radio-indicator"></span>
                        <span>作成日</span>
                    </label>
                    <label class="radio-label ${disabledClass}">
                        <input type="radio" name="sortBy" value="updated" ${disabledAttr}>
                        <span class="radio-indicator"></span>
                        <span>更新日</span>
                    </label>
                    <label class="radio-label ${disabledClass}">
                        <input type="radio" name="sortBy" value="size" ${disabledAttr}>
                        <span class="radio-indicator"></span>
                        <span>サイズ</span>
                    </label>
                    <label class="radio-label">
                        <input type="radio" name="sortBy" value="none" checked>
                        <span class="radio-indicator"></span>
                        <span>なし</span>
                    </label>
                </div>
            </div>
            <div style="display:flex;align-items:flex-start;gap:4px">
                <span style="font-weight:bold;min-width:40px">順序</span>
                <div class="radio-group-vertical">
                    <label class="radio-label ${disabledClass}">
                        <input type="radio" name="sortOrder" value="asc" checked ${disabledAttr}>
                        <span class="radio-indicator"></span>
                        <span>昇順</span>
                    </label>
                    <label class="radio-label ${disabledClass}">
                        <input type="radio" name="sortOrder" value="desc" ${disabledAttr}>
                        <span class="radio-indicator"></span>
                        <span>降順</span>
                    </label>
                </div>
            </div>
        </div>
    </div>
</div>`;

        return new Promise((resolve) => {
            this.messageBus.sendWithCallback('show-custom-dialog', {
                title: '整頓',
                dialogHtml: dialogHtml,
                buttons: [
                    { label: 'キャンセル', value: 'cancel' },
                    { label: 'OK', value: 'ok' }
                ],
                defaultButton: 1,
                inputs: {
                    text: 'columnCount'
                },
                radios: {
                    horizontal: 'horizontal',
                    vertical: 'vertical',
                    column: 'column',
                    length: 'length',
                    sortBy: 'sortBy',
                    sortOrder: 'sortOrder'
                }
            }, (result) => {
                logger.debug('[VirtualObjectList] 整頓ダイアログコールバック実行:', result);

                // Dialog result is wrapped in result.result
                const dialogResult = result.result || result;

                if (dialogResult.error) {
                    logger.warn('[VirtualObjectList] Arrange dialog error:', dialogResult.error);
                    resolve(null);
                    return;
                }

                if (dialogResult.button === 'ok') {
                    logger.debug('[VirtualObjectList] OKボタンが押されました');

                    // フォームの値を取得
                    const horizontal = (dialogResult.radios && dialogResult.radios.horizontal) || 'none';
                    const vertical = (dialogResult.radios && dialogResult.radios.vertical) || 'none';
                    const column = (dialogResult.radios && dialogResult.radios.column) || 'none';
                    const length = (dialogResult.radios && dialogResult.radios.length) || 'none';
                    const sortBy = (dialogResult.radios && dialogResult.radios.sortBy) || 'none';
                    const sortOrder = (dialogResult.radios && dialogResult.radios.sortOrder) || 'asc';
                    const columnCount = parseInt((dialogResult.inputs && dialogResult.inputs.columnCount) || '1') || 1;

                    logger.debug('[VirtualObjectList] 整頓設定:', {
                        horizontal, vertical, column, columnCount,
                        length, sortBy, sortOrder
                    });

                    // 整頓処理を実行
                    this.arrangeVirtualObjects({
                        horizontal, vertical, column, columnCount,
                        length, sortBy, sortOrder
                    });
                } else {
                    logger.debug('[VirtualObjectList] OKボタンが押されませんでした。button:', dialogResult.button);
                }

                resolve(result);
            }, 300000); // タイムアウト5分（ユーザー操作待ち）
        });
    }

    /**
     * 仮身を整頓する
     */
    arrangeVirtualObjects(options) {
        // selectedVirtualObjectsはvobjIndexのSetなので、vobjIndexから仮身オブジェクトを取得
        const selectedObjects = Array.from(this.selectedVirtualObjects).map(vobjIndex => {
            return this.virtualObjects[vobjIndex];
        }).filter(v => v !== undefined);
        if (selectedObjects.length === 0) return;

        logger.debug('[VirtualObjectList] 整頓開始:', options, '選択数:', selectedObjects.length);

        // ソート前の座標範囲を記録（整頓の基準位置として使用）
        const topmost = Math.min(...selectedObjects.map(o => o.vobjtop));
        const leftmost = Math.min(...selectedObjects.map(o => o.vobjleft));
        const rightmost = Math.max(...selectedObjects.map(o => o.vobjright));
        const baseCoords = { top: topmost, left: leftmost, right: rightmost };

        logger.debug('[VirtualObjectList] 整頓基準座標:', baseCoords);

        // 先頭の仮身（最初に選択されたもの）- 長さ調整の参照用
        const firstObj = selectedObjects[0];

        // ソート処理（複数選択時のみ）
        if (selectedObjects.length > 1 && options.sortBy !== 'none') {
            this.sortVirtualObjects(selectedObjects, options.sortBy, options.sortOrder);
        }

        // 長さ調整
        if (options.length !== 'none') {
            this.adjustVirtualObjectLength(selectedObjects, options.length, firstObj);
        }

        // 段組・配置処理（複数選択時のみ）
        if (selectedObjects.length > 1) {
            // 整列順が指定されている場合、段組が'none'なら自動的に'single'を適用
            let effectiveColumn = options.column;
            if (options.sortBy !== 'none' && options.column === 'none' &&
                options.horizontal === 'none' && options.vertical === 'none') {
                effectiveColumn = 'single';
                logger.debug('[VirtualObjectList] 整列順が指定されたため、自動的に1段組を適用します');
            }

            if (effectiveColumn === 'single') {
                // 1段組: 上から下に縦に並べる
                this.arrangeSingleColumn(selectedObjects, baseCoords, options);
            } else if (effectiveColumn === 'multi-horizontal') {
                // 複数段組（左右配置）
                this.arrangeMultiColumnHorizontal(selectedObjects, baseCoords, options);
            } else if (effectiveColumn === 'multi-vertical') {
                // 複数段組（上下配置）
                this.arrangeMultiColumnVertical(selectedObjects, baseCoords, options);
            } else {
                // 段組指定なしの場合、横・縦の調整のみ
                this.adjustHorizontalVertical(selectedObjects, baseCoords, options);
            }
        }

        // 再描画
        this.renderVirtualObjects();

        // 整頓後の位置をXMLに保存
        selectedObjects.forEach(obj => {
            this.updateVirtualObjectInXml(obj);
        });

        logger.debug('[VirtualObjectList] 整頓完了（位置保存済み）');
    }

    /**
     * 仮身をソート
     */
    sortVirtualObjects(objects, sortBy, sortOrder) {
        objects.sort((a, b) => {
            let compare = 0;

            switch (sortBy) {
                case 'name':
                    compare = (a.link_name || '').localeCompare(b.link_name || '');
                    break;
                case 'created':
                    const aCreated = a.metadata?.makeDate || '';
                    const bCreated = b.metadata?.makeDate || '';
                    compare = aCreated.localeCompare(bCreated);
                    break;
                case 'updated':
                    const aUpdated = a.metadata?.updateDate || '';
                    const bUpdated = b.metadata?.updateDate || '';
                    compare = aUpdated.localeCompare(bUpdated);
                    break;
                case 'size':
                    const aSize = a.metadata?.size || 0;
                    const bSize = b.metadata?.size || 0;
                    compare = aSize - bSize;
                    break;
            }

            // 降順の場合は反転
            if (sortOrder === 'desc') {
                compare = -compare;
            }

            return compare;
        });
    }

    /**
     * 仮身の長さを調整
     */
    adjustVirtualObjectLength(objects, lengthType, firstObj) {
        // 文字列幅を計算するためのCanvas
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        objects.forEach(obj => {
            let targetWidth;

            if (lengthType === 'first') {
                // 先頭の仮身の横幅に揃える
                targetWidth = firstObj.vobjright - firstObj.vobjleft;
            } else {
                // 表示内容に基づいて幅を計算
                targetWidth = this.calculateRequiredWidth(obj, lengthType, ctx);
            }

            // 各仮身の横幅を調整
            const currentWidth = obj.vobjright - obj.vobjleft;
            const diff = targetWidth - currentWidth;
            obj.vobjright += diff;
            obj.width = targetWidth; // width プロパティも更新
        });
    }

    /**
     * 表示項目に応じて必要な幅を計算
     */
    calculateRequiredWidth(obj, lengthType, ctx) {
        const chszPx = (obj.chsz || 14) * 96 / 72; // ポイントをピクセルに変換
        ctx.font = `${chszPx}px sans-serif`;

        // パディングとギャップ
        const paddingLeft = 10;
        const paddingRight = 10;
        const gap = 4;

        // 1. ピクトグラム（アイコン）の幅
        const iconSize = Math.round(chszPx * 1.0);
        let totalWidth = paddingLeft + iconSize + gap;

        // 2. 名前の幅
        const nameWidth = ctx.measureText(obj.link_name || '').width;
        totalWidth += nameWidth;

        if (lengthType === 'icon-name') {
            // ピクトグラムと名前まで
            return totalWidth + paddingRight;
        }

        // 3. 続柄の幅
        if (obj.metadata && obj.metadata.relationship && obj.metadata.relationship.length > 0) {
            const relationshipText = ' : ' + obj.metadata.relationship.join(' ');
            const relationshipWidth = ctx.measureText(relationshipText).width;
            totalWidth += relationshipWidth;
        }

        if (lengthType === 'with-relation') {
            // ピクトグラム、名前、続柄まで
            return totalWidth + paddingRight;
        }

        // 4. タイプの幅
        if (obj.applist) {
            for (const [, config] of Object.entries(obj.applist)) {
                if (config && config.defaultOpen === true && config.name) {
                    const typeText = ' (' + config.name + ')';
                    const typeWidth = ctx.measureText(typeText).width;
                    totalWidth += typeWidth;
                    break;
                }
            }
        }

        if (lengthType === 'without-date') {
            // ピクトグラム、名前、続柄、タイプまで（日付を除く）
            return totalWidth + paddingRight;
        }

        // 5. 日付の幅
        if (lengthType === 'full' && obj.metadata && obj.metadata.updateDate) {
            const dateText = ' YYYY/MM/DD HH:MM:SS'; // 固定長なので固定文字列で計算
            const dateWidth = ctx.measureText(dateText).width;
            totalWidth += dateWidth;
        }

        return totalWidth + paddingRight;
    }

    /**
     * 保護状態を適用
     * @param {string} protectionType - 保護タイプ（'fixed': 固定化, 'background': 背景化）
     */
    applyProtection(protectionType) {
        if (this.selectedVirtualObjects.size === 0) {
            logger.warn('[VirtualObjectList] 選択中の仮身がありません');
            return;
        }

        // 選択中の仮身を取得
        const selectedObjects = Array.from(this.selectedVirtualObjects).map(vobjIndex => {
            return this.virtualObjects[vobjIndex];
        }).filter(v => v !== undefined);

        logger.debug('[VirtualObjectList] 保護適用:', protectionType, selectedObjects.length, '個の仮身');

        // 各仮身に保護状態を適用
        selectedObjects.forEach(obj => {
            if (protectionType === 'fixed') {
                obj.isFixed = true;
            } else if (protectionType === 'background') {
                obj.isBackground = true;
            }
            this.updateVirtualObjectInXml(obj);
        });

        // 背景化の場合、z-indexを最小に設定して最背面に移動
        if (protectionType === 'background') {
            this.moveSelectedVirtualObjectsToBackground();
        }

        // 再描画
        this.renderVirtualObjects();
        logger.debug('[VirtualObjectList] 保護適用完了:', protectionType);

        // コンテキストメニューを閉じた直後のドラッグを防ぐ
        this.justClosedContextMenu = true;
        setTimeout(() => {
            this.justClosedContextMenu = false;
        }, 300);
    }

    /**
     * 保護状態を解除
     * @param {string} protectionType - 保護タイプ（'fixed': 固定化, 'background': 背景化）
     */
    removeProtection(protectionType) {
        if (this.selectedVirtualObjects.size === 0) {
            logger.warn('[VirtualObjectList] 選択中の仮身がありません');
            return;
        }

        // 選択中の仮身を取得
        const selectedObjects = Array.from(this.selectedVirtualObjects).map(vobjIndex => {
            return this.virtualObjects[vobjIndex];
        }).filter(v => v !== undefined);

        logger.debug('[VirtualObjectList] 保護解除:', protectionType, selectedObjects.length, '個の仮身');

        // 各仮身の保護状態を解除（該当する保護タイプのみ）
        selectedObjects.forEach(obj => {
            if (protectionType === 'fixed') {
                obj.isFixed = false;
            } else if (protectionType === 'background') {
                obj.isBackground = false;
            }
            this.updateVirtualObjectInXml(obj);
        });

        // 再描画
        this.renderVirtualObjects();
        logger.debug('[VirtualObjectList] 保護解除完了:', protectionType);

        // コンテキストメニューを閉じた直後のドラッグを防ぐ
        this.justClosedContextMenu = true;
        setTimeout(() => {
            this.justClosedContextMenu = false;
        }, 300);
    }

    /**
     * 選択中の仮身を背景（最背面）に移動
     */
    moveSelectedVirtualObjectsToBackground() {
        if (this.selectedVirtualObjects.size === 0) {
            logger.warn('[VirtualObjectList] 選択中の仮身がありません');
            return;
        }

        // 選択中の仮身を取得
        const selectedObjects = Array.from(this.selectedVirtualObjects).map(vobjIndex => {
            return this.virtualObjects[vobjIndex];
        }).filter(v => v !== undefined);

        // 選択されていない仮身
        const unselectedObjects = this.virtualObjects.filter((obj, index) =>
            !this.selectedVirtualObjects.has(index)
        );

        // 選択された仮身を最背面に、その他を前面に（相対的な順序は保持）
        // 配列変更時は選択状態を保持
        this.preserveSelection(() => {
            this.virtualObjects = [...selectedObjects, ...unselectedObjects];
        });

        logger.debug('[VirtualObjectList] 仮身を背景に移動:', selectedObjects.length, '個');
    }

    /**
     * 1段組配置
     */
    arrangeSingleColumn(objects, baseCoords, options) {
        let currentTop = baseCoords.top;
        const spacing = options.vertical === 'compact' ? 5 : 10;

        objects.forEach(obj => {
            const height = obj.vobjbottom - obj.vobjtop;
            const width = obj.vobjright - obj.vobjleft;

            // 横位置の調整
            if (options.horizontal === 'left') {
                obj.vobjleft = baseCoords.left;
                obj.vobjright = obj.vobjleft + width;
            } else if (options.horizontal === 'right') {
                obj.vobjright = baseCoords.right;
                obj.vobjleft = obj.vobjright - width;
            } else {
                // 横位置指定なしの場合は左揃え（デフォルト）
                obj.vobjleft = baseCoords.left;
                obj.vobjright = obj.vobjleft + width;
            }

            // 縦位置の調整
            obj.vobjtop = currentTop;
            obj.vobjbottom = currentTop + height;

            currentTop = obj.vobjbottom + spacing;
        });
    }

    /**
     * 複数段組配置（左右配置）
     */
    arrangeMultiColumnHorizontal(objects, baseCoords, options) {
        const columnCount = options.columnCount || 2;
        const spacing = options.vertical === 'compact' ? 5 : 10;
        const horizontalSpacing = 10;

        // 第1パス: 各列の最大幅を計算
        const colMaxWidths = new Array(columnCount).fill(0);
        objects.forEach((obj, index) => {
            const width = obj.vobjright - obj.vobjleft;
            const col = index % columnCount;
            if (width > colMaxWidths[col]) {
                colMaxWidths[col] = width;
            }
        });

        // 列の左位置を事前に計算
        const colLefts = [baseCoords.left];
        for (let i = 1; i < columnCount; i++) {
            // 前の列の左位置 + 前の列の最大幅 + 水平スペース
            colLefts[i] = colLefts[i - 1] + colMaxWidths[i - 1] + horizontalSpacing;
        }

        logger.debug('[VirtualObjectList] 列の最大幅:', colMaxWidths);
        logger.debug('[VirtualObjectList] 列の左位置:', colLefts);

        // 第2パス: 固定された列位置に基づいて配置
        let currentRow = 0;
        let currentCol = 0;
        let rowTops = [baseCoords.top];

        objects.forEach((obj, index) => {
            const height = obj.vobjbottom - obj.vobjtop;
            const width = obj.vobjright - obj.vobjleft;

            // 配置
            obj.vobjleft = colLefts[currentCol];
            obj.vobjright = obj.vobjleft + width;
            obj.vobjtop = rowTops[currentRow];
            obj.vobjbottom = obj.vobjtop + height;

            logger.debug(`[VirtualObjectList] 整頓[${index}] ${obj.link_name}: 行${currentRow}, 列${currentCol}, left=${obj.vobjleft}, right=${obj.vobjright}`);

            currentCol++;
            if (currentCol >= columnCount) {
                // 次の行へ
                currentCol = 0;
                currentRow++;
                // 現在の行の最大の高さを計算
                const rowObjects = objects.slice(Math.max(0, index - columnCount + 1), index + 1);
                const maxBottom = Math.max(...rowObjects.map(o => o.vobjbottom));
                rowTops[currentRow] = maxBottom + spacing;
            }
        });
    }

    /**
     * 複数段組配置（上下配置）
     */
    arrangeMultiColumnVertical(objects, baseCoords, options) {
        const columnCount = options.columnCount || 2;
        const spacing = options.vertical === 'compact' ? 5 : 10;
        const horizontalSpacing = 10;

        // 各列の要素数を計算
        const itemsPerColumn = Math.ceil(objects.length / columnCount);

        // 第1パス: 各列の最大幅を計算
        const colMaxWidths = new Array(columnCount).fill(0);
        objects.forEach((obj, index) => {
            const width = obj.vobjright - obj.vobjleft;
            const col = Math.floor(index / itemsPerColumn);
            if (width > colMaxWidths[col]) {
                colMaxWidths[col] = width;
            }
        });

        // 列の左位置を事前に計算
        const colLefts = [baseCoords.left];
        for (let i = 1; i < columnCount; i++) {
            // 前の列の左位置 + 前の列の最大幅 + 水平スペース
            colLefts[i] = colLefts[i - 1] + colMaxWidths[i - 1] + horizontalSpacing;
        }

        logger.debug('[VirtualObjectList] 列の最大幅:', colMaxWidths);
        logger.debug('[VirtualObjectList] 列の左位置:', colLefts);

        // 第2パス: 固定された列位置に基づいて配置
        objects.forEach((obj, index) => {
            const height = obj.vobjbottom - obj.vobjtop;
            const width = obj.vobjright - obj.vobjleft;

            const currentCol = Math.floor(index / itemsPerColumn);
            const currentRow = index % itemsPerColumn;

            // 配置
            obj.vobjleft = colLefts[currentCol];
            obj.vobjright = obj.vobjleft + width;

            if (currentRow === 0) {
                obj.vobjtop = baseCoords.top;
            } else {
                const prevObj = objects[index - 1];
                obj.vobjtop = prevObj.vobjbottom + spacing;
            }
            obj.vobjbottom = obj.vobjtop + height;

            logger.debug(`[VirtualObjectList] 整頓[${index}] ${obj.link_name}: 行${currentRow}, 列${currentCol}, left=${obj.vobjleft}, right=${obj.vobjright}`);
        });
    }

    /**
     * 横・縦のみ調整（段組指定なし）
     */
    adjustHorizontalVertical(objects, baseCoords, options) {
        if (options.horizontal === 'none' && options.vertical === 'none') {
            return;
        }

        // Y座標でソート（上から順に処理）
        const sortedObjects = [...objects].sort((a, b) => a.vobjtop - b.vobjtop);

        let prevObj = null;
        sortedObjects.forEach(obj => {
            const width = obj.vobjright - obj.vobjleft;
            const height = obj.vobjbottom - obj.vobjtop;

            // 横位置の調整
            if (options.horizontal === 'left') {
                obj.vobjleft = baseCoords.left;
                obj.vobjright = obj.vobjleft + width;
            } else if (options.horizontal === 'right') {
                obj.vobjright = baseCoords.right;
                obj.vobjleft = obj.vobjright - width;
            }

            // 縦位置の調整
            if (prevObj && options.vertical !== 'none') {
                let spacing;
                if (options.vertical === 'compact') {
                    spacing = 5;
                } else if (options.vertical === 'align') {
                    spacing = 10;
                }
                obj.vobjtop = prevObj.vobjbottom + spacing;
                obj.vobjbottom = obj.vobjtop + height;
            }

            prevObj = obj;
        });
    }

    /**
     * xmlTADに仮身を追加
     * @param {Object} virtualObj - 追加する仮身オブジェクト
     */
    addVirtualObjectToXml(virtualObj) {
        if (!this.xmlData) {
            logger.warn('[VirtualObjectList] xmlDataがありません');
            return;
        }

        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(this.xmlData, 'text/xml');

            // 新しい<link>要素を作成
            const linkElement = xmlDoc.createElement('link');
            linkElement.setAttribute('id', virtualObj.link_id);
            linkElement.setAttribute('vobjleft', virtualObj.vobjleft.toString());
            linkElement.setAttribute('vobjtop', virtualObj.vobjtop.toString());
            linkElement.setAttribute('vobjright', virtualObj.vobjright.toString());
            linkElement.setAttribute('vobjbottom', virtualObj.vobjbottom.toString());
            linkElement.setAttribute('height', (virtualObj.heightPx || 30).toString());
            linkElement.setAttribute('chsz', (virtualObj.chsz || 14).toString());
            linkElement.setAttribute('frcol', virtualObj.frcol || '#000000');
            linkElement.setAttribute('chcol', virtualObj.chcol || '#000000');
            linkElement.setAttribute('tbcol', virtualObj.tbcol || '#ffffff');
            linkElement.setAttribute('bgcol', virtualObj.bgcol || '#ffffff');
            linkElement.setAttribute('dlen', (virtualObj.dlen || 0).toString());
            linkElement.textContent = virtualObj.link_name || '';

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
            // 保護状態（固定化と背景化は独立）
            if (virtualObj.isFixed) {
                linkElement.setAttribute('fixed', 'true');
            }
            if (virtualObj.isBackground) {
                linkElement.setAttribute('background', 'true');
            }

            // <figure>要素を探して、その中に追加
            const figureElement = xmlDoc.getElementsByTagName('figure')[0];
            if (figureElement) {
                figureElement.appendChild(linkElement);
                logger.debug('[VirtualObjectList] <figure>要素内に仮身を追加');
            } else {
                // <figure>がない場合はルート要素に追加
                const rootElement = xmlDoc.documentElement;
                rootElement.appendChild(linkElement);
                logger.debug('[VirtualObjectList] <figure>がないためルート要素に仮身を追加');
            }

            // XMLを文字列に戻す
            const serializer = new XMLSerializer();
            this.xmlData = serializer.serializeToString(xmlDoc);

            logger.debug('[VirtualObjectList] xmlTADに仮身を追加:', virtualObj.link_id);

            // 自動保存
            this.notifyXmlDataChanged();

        } catch (error) {
            logger.error('[VirtualObjectList] xmlTAD追加エラー:', error);
        }
    }

    /**
     * xmlTADから仮身を削除
     * @param {Object} virtualObj - 削除する仮身オブジェクト
     * @param {number} [xmlIndex] - XML内での位置（省略時は配列から計算）
     */
    removeVirtualObjectFromXml(virtualObj, xmlIndex) {
        if (!this.xmlData) {
            logger.warn('[VirtualObjectList] xmlDataがありません');
            return;
        }

        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(this.xmlData, 'text/xml');

            // 配列内のインデックスでXML要素を特定（配列とXMLの順序は同期している前提）
            const linkElements = xmlDoc.getElementsByTagName('link');

            // xmlIndexが指定されていない場合は配列から計算
            if (xmlIndex === undefined) {
                xmlIndex = this.virtualObjects.indexOf(virtualObj);
            }

            if (xmlIndex >= 0 && xmlIndex < linkElements.length) {
                const linkElement = linkElements[xmlIndex];
                linkElement.parentNode.removeChild(linkElement);
                logger.debug('[VirtualObjectList] <link>要素を削除: index=', xmlIndex, 'link_id=', virtualObj.link_id);
            } else {
                logger.warn('[VirtualObjectList] 削除対象のインデックスが無効:', xmlIndex);
            }

            // XMLを文字列に戻す
            const serializer = new XMLSerializer();
            this.xmlData = serializer.serializeToString(xmlDoc);

            logger.debug('[VirtualObjectList] xmlTADから仮身を削除:', virtualObj.link_id);

            // 自動保存
            this.notifyXmlDataChanged();

        } catch (error) {
            logger.error('[VirtualObjectList] xmlTAD削除エラー:', error);
        }
    }

    /**
     * xmlTAD内の仮身を更新
     * @param {Object} virtualObj - 更新する仮身オブジェクト
     */
    updateVirtualObjectInXml(virtualObj) {
        if (!this.xmlData) {
            logger.warn('[VirtualObjectList] xmlDataがありません');
            return;
        }

        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(this.xmlData, 'text/xml');

            // 配列内のインデックスでXML要素を特定（配列とXMLの順序は同期している前提）
            const linkElements = xmlDoc.getElementsByTagName('link');
            const xmlIndex = this.virtualObjects.indexOf(virtualObj);

            if (xmlIndex >= 0 && xmlIndex < linkElements.length) {
                const linkElement = linkElements[xmlIndex];

                // 属性を更新
                linkElement.setAttribute('vobjleft', virtualObj.vobjleft.toString());
                linkElement.setAttribute('vobjtop', virtualObj.vobjtop.toString());
                linkElement.setAttribute('vobjright', virtualObj.vobjright.toString());
                linkElement.setAttribute('vobjbottom', virtualObj.vobjbottom.toString());
                linkElement.setAttribute('height', (virtualObj.heightPx || 30).toString());
                linkElement.setAttribute('chsz', (virtualObj.chsz || 14).toString());
                linkElement.setAttribute('frcol', virtualObj.frcol || '#000000');
                linkElement.setAttribute('chcol', virtualObj.chcol || '#000000');
                linkElement.setAttribute('tbcol', virtualObj.tbcol || '#ffffff');
                linkElement.setAttribute('bgcol', virtualObj.bgcol || '#ffffff');
                linkElement.setAttribute('dlen', (virtualObj.dlen || 0).toString());

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
                // 保護状態（固定化と背景化は独立）
                if (virtualObj.isFixed) {
                    linkElement.setAttribute('fixed', 'true');
                } else {
                    linkElement.removeAttribute('fixed');
                }
                if (virtualObj.isBackground) {
                    linkElement.setAttribute('background', 'true');
                } else {
                    linkElement.removeAttribute('background');
                }

                linkElement.textContent = virtualObj.link_name || '';
                logger.debug('[VirtualObjectList] <link>要素を更新: index=', xmlIndex, 'link_id=', virtualObj.link_id);

                // 元の位置情報を更新（次回の移動時に正しく識別できるように）
                virtualObj.originalLeft = virtualObj.vobjleft;
                virtualObj.originalTop = virtualObj.vobjtop;
                virtualObj.originalRight = virtualObj.vobjright;
                virtualObj.originalBottom = virtualObj.vobjbottom;
            } else {
                logger.warn('[VirtualObjectList] 更新対象のインデックスが無効:', xmlIndex);
            }

            // XMLを文字列に戻す
            const serializer = new XMLSerializer();
            this.xmlData = serializer.serializeToString(xmlDoc);

            logger.debug('[VirtualObjectList] xmlTADの仮身を更新:', virtualObj.link_id);

            // 自動保存
            this.notifyXmlDataChanged();

        } catch (error) {
            logger.error('[VirtualObjectList] xmlTAD更新エラー:', error);
        }
    }

    /**
     * xmlTAD内の<link>要素の順序をthis.virtualObjects配列の順序に合わせて並び替え
     * 表示順（z-index）を保存するために使用
     *
     * 注意: この関数は配列の並び替え後に呼び出され、各virtualObjの_xmlIndexプロパティを使用して
     * 並び替え前のXML内のインデックスを特定します。_xmlIndexがない場合はlink_idで検索します。
     */
    reorderVirtualObjectsInXml() {
        if (!this.xmlData) {
            logger.warn('[VirtualObjectList] xmlDataがありません');
            return;
        }

        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(this.xmlData, 'text/xml');

            // <figure>要素またはルート要素を取得
            const figureElement = xmlDoc.getElementsByTagName('figure')[0];
            const parentElement = figureElement || xmlDoc.documentElement;

            // 現在の<link>要素をすべて取得して配列に保存
            const linkElements = xmlDoc.getElementsByTagName('link');
            const linkArray = [];
            for (let i = 0; i < linkElements.length; i++) {
                linkArray.push(linkElements[i].cloneNode(true));
            }

            // すべてのlink要素を削除
            for (let i = linkElements.length - 1; i >= 0; i--) {
                linkElements[i].parentNode.removeChild(linkElements[i]);
            }

            // this.virtualObjects配列の順序に従って<link>要素を再追加
            // 使用済みフラグで同じlink_idの要素を区別
            const usedIndices = new Set();

            for (const virtualObj of this.virtualObjects) {
                // _xmlIndexがあればそれを使用、なければlink_idで検索
                let linkElement = null;

                if (virtualObj._xmlIndex !== undefined && virtualObj._xmlIndex < linkArray.length && !usedIndices.has(virtualObj._xmlIndex)) {
                    linkElement = linkArray[virtualObj._xmlIndex];
                    usedIndices.add(virtualObj._xmlIndex);
                } else {
                    // link_idで検索（同じlink_idが複数ある場合は未使用のものを探す）
                    for (let i = 0; i < linkArray.length; i++) {
                        if (!usedIndices.has(i) && linkArray[i].getAttribute('id') === virtualObj.link_id) {
                            linkElement = linkArray[i];
                            usedIndices.add(i);
                            break;
                        }
                    }
                }

                if (linkElement) {
                    parentElement.appendChild(linkElement);
                }
            }

            // XMLを文字列に戻す
            const serializer = new XMLSerializer();
            this.xmlData = serializer.serializeToString(xmlDoc);

            // _xmlIndexをリセット（次回の並び替えのため、現在の配列順がXML順になる）
            for (let i = 0; i < this.virtualObjects.length; i++) {
                delete this.virtualObjects[i]._xmlIndex;
            }

            logger.debug('[VirtualObjectList] xmlTADの仮身順序を更新');

        } catch (error) {
            logger.error('[VirtualObjectList] xmlTAD順序更新エラー:', error);
        }
    }

    // requestCopyVirtualObject() と requestDeleteVirtualObject() は
    // PluginBase共通メソッドに移行済み

    setupContextMenu() {
        // 右クリックメニューを開いた直後かどうかのフラグ
        this.justOpenedContextMenu = false;
        // 範囲選択が完了した直後かどうかのフラグ（クリックイベントによる選択解除を防ぐ）
        this.justCompletedRangeSelection = false;

        document.addEventListener('contextmenu', (e) => {
            e.preventDefault();

            // ドラッグ中は右クリックメニューを表示しない（コピーモード用の右ボタン操作として使用）
            if (this.virtualObjectDragState.isDragging) {
                logger.debug('[VirtualObjectList] ドラッグ中のため右クリックメニューを抑制');
                return;
            }

            // 右クリックメニューを開いたことを記録
            this.justOpenedContextMenu = true;
            setTimeout(() => {
                this.justOpenedContextMenu = false;
            }, 100);

            // コンテキストメニュー要求（共通メソッドを使用）
            this.showContextMenuAtEvent(e);
        });

        document.addEventListener('click', () => {
            // 右クリックメニューを開いた直後は無視
            if (this.justOpenedContextMenu) {
                return;
            }

            // 範囲選択終了直後は無視（範囲選択で選択した仮身がクリアされるのを防ぐ）
            if (this.justCompletedRangeSelection) {
                return;
            }

            this.messageBus.send('close-context-menu');

            // 仮身以外の領域をクリックしたら選択解除
            // 仮身をクリックした場合は e.stopPropagation() により伝播しないため、ここには来ない
            if (!this.isReadonly && this.selectedVirtualObjects.size > 0) {
                // 選択中の全ての仮身のアウトラインを解除
                const allVirtualObjects = document.querySelectorAll('.virtual-object');
                allVirtualObjects.forEach(el => {
                    el.style.outline = '';
                });
                this.selectedVirtualObjects.clear();
            }
        });
    }

    setupWindowActivation() {
        document.addEventListener('mousedown', () => {
            this.messageBus.send('activate-window');

            // キーボードショートカットが動作するようにbodyにフォーカスを設定
            document.body.focus();
        });
    }

    /**
     * キーボードショートカットを設定
     */
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ctrl+L: 全画面表示
            if (e.ctrlKey && e.key === 'l') {
                e.preventDefault();
                this.toggleFullscreen();
            }
            // Ctrl+S: 保存
            else if (e.ctrlKey && e.key === 's') {
                e.preventDefault();
                this.saveToFile();
            }
            // Ctrl+E: ウィンドウを閉じる
            else if (e.ctrlKey && e.key === 'e') {
                e.preventDefault();
                this.requestCloseWindow();
            }
            // Ctrl+O: 選択中の仮身をdefaultOpenアプリで開く
            else if (e.ctrlKey && e.key === 'o') {
                e.preventDefault();
                this.openRealObjectWithDefaultApp();
            }
            // Ctrl+D: 整頓
            else if (e.ctrlKey && e.key === 'd') {
                e.preventDefault();
                if (this.selectedVirtualObjects.size > 0) {
                    this.showArrangeDialog();
                }
            }
            // Delete: 選択中の仮身を削除
            else if (e.key === 'Delete') {
                e.preventDefault();
                this.deleteSelectedVirtualObject();
            }
        });
    }

    /**
     * グローバルマウスイベントハンドラーを設定（ドラッグ用）
     */
    setupGlobalMouseHandlers() {
        // ドラッグ用のmousemoveハンドラ
        const handleDragMouseMove = (e) => {
            // 範囲選択中の更新処理
            if (this.rangeSelectionState.isActive) {
                const canvas = this.rangeSelectionState.container;
                if (canvas) {
                    const rect = canvas.getBoundingClientRect();
                    // getBoundingClientRect()はスクロール位置を考慮済みなのでscroll offsetは不要
                    const x = e.clientX - rect.left;
                    const y = e.clientY - rect.top;
                    this.updateRangeSelection(x, y);
                }
                return; // 範囲選択中は他の処理をスキップ
            }

            // ダブルクリック+ドラッグ候補の検出
            // 共通メソッドでドラッグ開始判定
            if (this.shouldStartDblClickDrag(e)) {
                logger.debug('[VirtualObjectList] ダブルクリック+ドラッグを確定（ドラッグ完了待ち）:', this.dblClickDragState.dblClickedObject.link_name);

                // 青い選択枠のプレビュー要素を作成（プラグイン固有）
                const obj = this.dblClickDragState.dblClickedObject;
                const width = obj.width || (obj.vobjright - obj.vobjleft) || 100;
                const height = obj.heightPx || (obj.vobjbottom - obj.vobjtop) || 32;

                const preview = document.createElement('div');
                preview.className = 'dblclick-drag-preview';
                preview.style.position = 'absolute';
                preview.style.border = '2px solid #0078d4';
                preview.style.backgroundColor = 'rgba(0, 120, 212, 0.1)';
                preview.style.pointerEvents = 'none';
                preview.style.zIndex = '10000';
                preview.style.width = width + 'px';
                preview.style.height = height + 'px';
                preview.style.left = obj.vobjleft + 'px';
                preview.style.top = obj.vobjtop + 'px';

                const canvas = document.querySelector('.virtual-canvas');
                if (canvas) {
                    canvas.appendChild(preview);
                }
                return;
            }

            // ダブルクリック+ドラッグ中のプレビュー位置更新
            if (this.dblClickDragState.isDblClickDrag) {
                const preview = document.querySelector('.dblclick-drag-preview');
                if (preview) {
                    const canvas = document.querySelector('.virtual-canvas');
                    if (canvas) {
                        const rect = canvas.getBoundingClientRect();
                        const canvasX = e.clientX - rect.left + canvas.scrollLeft;
                        const canvasY = e.clientY - rect.top + canvas.scrollTop;
                        preview.style.left = canvasX + 'px';
                        preview.style.top = canvasY + 'px';
                    }
                }
                return;
            }

            if (!this.virtualObjectDragState.isDragging) return;

            const deltaX = e.clientX - this.virtualObjectDragState.startX;
            const deltaY = e.clientY - this.virtualObjectDragState.startY;

            // 5px以上移動したらドラッグとみなす
            if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
                if (!this.virtualObjectDragState.hasMoved) {
                    logger.debug('[VirtualObjectList] mousemove: 移動検知 delta:', deltaX, deltaY);
                }
                this.virtualObjectDragState.hasMoved = true;
            }

            if (this.virtualObjectDragState.hasMoved && this.vobjDragState.currentElement) {
                const newLeft = this.vobjDragState.initialLeft + deltaX;
                const newTop = this.vobjDragState.initialTop + deltaY;

                this.vobjDragState.currentElement.style.left = newLeft + 'px';
                this.vobjDragState.currentElement.style.top = newTop + 'px';
            }
        };

        // スロットル版のmousemoveハンドラ（60FPS制限）
        const throttledDragMouseMove = window.throttleRAF ? window.throttleRAF(handleDragMouseMove) : handleDragMouseMove;

        // document全体でのmousedown（iframe上のクリックも検出するため）
        document.addEventListener('mousedown', (e) => {
            // 右ボタン処理はPluginBaseのsetupVirtualObjectRightButtonHandlers()で処理

            // 仮身要素内でのmousedownを検出
            const vobjElement = e.target.closest('.virtual-object');
            if (vobjElement) {
                // 仮身要素内でmousedownされたら、即座に全iframeを無効化
                // これにより、iframe上でもドラッグを開始できる
                this.setIframesPointerEvents(false);
                logger.debug('[VirtualObjectList] document mousedown: iframeを無効化（仮身要素内）');

                // 短時間後に、ドラッグが始まらなかった場合はiframeを再有効化
                // （単なるクリックの場合）
                if (this.iframeReenableTimeout) {
                    clearTimeout(this.iframeReenableTimeout);
                }
                this.iframeReenableTimeout = setTimeout(() => {
                    if (!this.virtualObjectDragState.isDragging && !this.virtualObjectDragState.hasMoved) {
                        // 開いた仮身のiframeは常に無効化されたままにするため、再有効化しない
                        // this.setIframesPointerEvents(true);
                        logger.debug('[VirtualObjectList] タイムアウト: ドラッグなし（iframe再有効化はスキップ）');
                    }
                }, 200);
            } else if (e.button === 0 && !this.dblClickDragState.isDblClickDragCandidate) {
                // 仮身要素以外で左ボタンが押された場合、範囲選択を開始
                // （ダブルクリック+ドラッグ候補でない場合のみ）
                const canvas = document.querySelector('.virtual-canvas');
                if (canvas && canvas.contains(e.target)) {
                    const rect = canvas.getBoundingClientRect();
                    // getBoundingClientRect()はスクロール位置を考慮済みなのでscroll offsetは不要
                    const x = e.clientX - rect.left;
                    const y = e.clientY - rect.top;
                    this.startRangeSelection(canvas, x, y);
                }
            }
        }, { capture: true });

        // document全体でのmousemove
        document.addEventListener('mousemove', throttledDragMouseMove);

        // document全体でのmouseup
        document.addEventListener('mouseup', (e) => {
            logger.debug('[VirtualObjectList] mouseup検知 isDragging:', this.virtualObjectDragState.isDragging, 'hasMoved:', this.virtualObjectDragState.hasMoved, 'button:', e.button);

            // 範囲選択終了処理
            if (this.rangeSelectionState.isActive) {
                const bounds = this.getRangeSelectionBounds();
                // 範囲選択座標はビューポート相対なので、キャンバス座標に変換（スクロールオフセット加算）
                const canvas = this.rangeSelectionState.container;
                if (canvas) {
                    bounds.left += canvas.scrollLeft;
                    bounds.right += canvas.scrollLeft;
                    bounds.top += canvas.scrollTop;
                    bounds.bottom += canvas.scrollTop;
                }
                const selectedIndices = this.getVirtualObjectsInRect(bounds);
                logger.debug('[VirtualObjectList] 範囲選択終了:', selectedIndices.length, '個の仮身を選択');

                // Shiftキーでトグル選択、それ以外は新規選択
                if (!e.shiftKey) {
                    // 既存の選択を解除
                    this.selectedVirtualObjects.clear();
                    const allVobjElements = document.querySelectorAll('.virtual-object');
                    allVobjElements.forEach(el => {
                        el.style.outline = '';
                    });
                }

                // 範囲内の仮身を選択
                selectedIndices.forEach(index => {
                    if (e.shiftKey && this.selectedVirtualObjects.has(index)) {
                        this.selectedVirtualObjects.delete(index);
                    } else {
                        this.selectedVirtualObjects.add(index);
                    }
                });

                // 選択表示を更新
                this.updateSelectionDisplay();

                this.endRangeSelection();

                // 範囲選択終了フラグを設定（クリックイベントによる選択解除を防ぐ）
                this.justCompletedRangeSelection = true;
                setTimeout(() => {
                    this.justCompletedRangeSelection = false;
                }, 100);

                return; // 範囲選択終了後は他の処理をスキップ
            }

            // ダブルクリック+ドラッグのプレビュー要素を削除
            const preview = document.querySelector('.dblclick-drag-preview');
            if (preview) {
                preview.remove();
            }

            // ダブルクリック+ドラッグ完了時に実身複製処理を実行
            if (this.dblClickDragState.isDblClickDrag) {
                logger.debug('[VirtualObjectList] ダブルクリック+ドラッグ完了、実身複製処理を開始');

                // ドラッグ終了位置を記録（キャンバス座標系）
                const canvas = document.querySelector('.virtual-canvas');
                if (canvas) {
                    const rect = canvas.getBoundingClientRect();
                    const dropX = e.clientX - rect.left + canvas.scrollLeft;
                    const dropY = e.clientY - rect.top + canvas.scrollTop;

                    // 実身複製処理を実行（ドラッグ終了位置を渡す）
                    this.handleDoubleClickDragDuplicate(dropX, dropY);
                }

                // 状態をクリア（共通メソッド使用）
                this.cleanupDblClickDragState();
                // プラグイン固有のクリーンアップ
                this.dblClickDragState.dblClickedObject = null;
            }
            // ダブルクリック候補でドラッグしなかった場合、仮身を開く
            else if (this.dblClickDragState.isDblClickDragCandidate) {
                logger.debug('[VirtualObjectList] ダブルクリック検出、仮身を開く');

                const obj = this.dblClickDragState.dblClickedObject;
                const vobj = this.dblClickDragState.dblClickedElement;

                if (obj && vobj && !this.isReadonly) {
                    // 開いた仮身（expandedクラスがある）の場合は、defaultOpenプラグインで実身を起動
                    if (vobj.classList.contains('expanded')) {
                        logger.debug('[VirtualObjectList] 開いた仮身をdefaultOpenで起動:', obj.link_name);

                        // applistからdefaultOpenプラグインを取得
                        const applist = obj.applist || {};
                        let defaultOpenPlugin = null;

                        for (const [pluginId, config] of Object.entries(applist)) {
                            if (config.defaultOpen === true) {
                                defaultOpenPlugin = pluginId;
                                break;
                            }
                        }

                        if (defaultOpenPlugin) {
                            logger.debug('[VirtualObjectList] defaultOpenプラグイン:', defaultOpenPlugin);

                                            this.messageBus.send('open-virtual-object-real', {
                                virtualObj: obj,
                                pluginId: defaultOpenPlugin
                            });
                        } else {
                            logger.warn('[VirtualObjectList] defaultOpenプラグインが見つかりません');
                        }
                    } else {
                        // 閉じた仮身の場合は、既存の動作（別ウィンドウで開く）
                        this.openVirtualObject(obj);
                    }
                }

                // 状態をクリア（共通メソッド使用）
                this.cleanupDblClickDragState();
                // プラグイン固有のクリーンアップ
                this.dblClickDragState.dblClickedObject = null;
            }

            // タイムアウトをクリア
            if (this.iframeReenableTimeout) {
                clearTimeout(this.iframeReenableTimeout);
                this.iframeReenableTimeout = null;
            }

            // 右ボタン処理はPluginBaseのsetupVirtualObjectRightButtonHandlers()で処理

            if (this.virtualObjectDragState.isDragging) {
                if (this.virtualObjectDragState.hasMoved) {
                    // 移動があった場合は位置を確定
                    logger.debug('[VirtualObjectList] mouseup: ドラッグ完了、finishDrag()呼び出し');
                    this.finishDrag();
                } else {
                    // 移動がなかった場合は状態をリセット
                    logger.debug('[VirtualObjectList] mouseup: 移動なし、状態リセット');
                    this.virtualObjectDragState.isDragging = false;
                    this.vobjDragState.currentObject = null;
                    this.vobjDragState.currentElement = null;
                    this.vobjDragState.vobjIndex = null;
                    // isRightButtonPressedはPluginBaseで管理
                    // 開いた仮身のiframeは常に無効化されたままにするため、再有効化しない
                    // this.setIframesPointerEvents(true);
                }
            }
        });
    }

    /**
     * ドラッグ完了処理（位置の確定、仮身のコピー/移動）
     */
    finishDrag() {
        if (!this.virtualObjectDragState.isDragging) return;

        // クロスウィンドウドロップの場合は仮身を削除（moveモードの場合のみ）
        if (this.lastDropWasCrossWindow) {
            logger.debug('[VirtualObjectList] クロスウィンドウドロップ検知');
            this.lastDropWasCrossWindow = false; // フラグをリセット

            if (this.virtualObjectDragState.dragMode === 'move' && this.vobjDragState.selectedObjects) {
                logger.debug('[VirtualObjectList] moveモード: 元ウィンドウから仮身を削除', this.vobjDragState.selectedObjects.length, '個');

                // selectedObjectsのvobjIndexを降順にソート（後ろから削除するため）
                const sortedIndexes = this.vobjDragState.selectedObjects
                    .map(item => item.vobjIndex)
                    .sort((a, b) => b - a);

                sortedIndexes.forEach(vobjIndex => {
                    const vobj = this.virtualObjects[vobjIndex];
                    if (vobj) {
                        logger.debug('[VirtualObjectList] 仮身を削除:', vobj.link_name, 'vobjIndex:', vobjIndex);
                        // XMLから削除（配列から削除する前にインデックスを渡す）
                        this.removeVirtualObjectFromXml(vobj, vobjIndex);
                        // 配列から削除
                        this.virtualObjects.splice(vobjIndex, 1);
                    }
                });

                this.renderVirtualObjects();
                this.saveToFile();
            } else if (this.virtualObjectDragState.dragMode === 'copy') {
                logger.debug('[VirtualObjectList] copyモード: 元ウィンドウの仮身は保持');
            }

            // ドラッグ状態をリセット
            this.virtualObjectDragState.isDragging = false;
            this.virtualObjectDragState.hasMoved = false;
            this.vobjDragState.currentObject = null;
            this.vobjDragState.currentElement = null;
            this.vobjDragState.vobjIndex = null;
            this.vobjDragState.selectedObjects = null;
            this.vobjDragState.selectedObjectsInitialPositions = null;
            this.virtualObjectDragState.dragMode = null;
            this.vobjDragState.dropClientX = undefined;
            this.vobjDragState.dropClientY = undefined;
            this.vobjDragState.lastMouseOverWindowId = null;
            return;
        }

        logger.debug('[VirtualObjectList] ドラッグ終了:', this.vobjDragState.currentObject?.link_name, 'モード:', this.virtualObjectDragState.dragMode, '選択数:', this.vobjDragState.selectedObjects?.length || 1);

        if (this.virtualObjectDragState.hasMoved && this.vobjDragState.currentObject && this.vobjDragState.currentElement) {
            const obj = this.vobjDragState.currentObject;
            const vobjElement = this.vobjDragState.currentElement;

            // ドラッグで移動した場合
            let deltaX, deltaY;

            // dropイベントで座標が保存されている場合はそれを使用
            if (this.vobjDragState.dropClientX !== undefined && this.vobjDragState.dropClientY !== undefined) {
                deltaX = this.vobjDragState.dropClientX - this.virtualObjectDragState.startX;
                deltaY = this.vobjDragState.dropClientY - this.virtualObjectDragState.startY;
                logger.debug('[VirtualObjectList] dropイベントの座標を使用:',
                    'drop:', this.vobjDragState.dropClientX, this.vobjDragState.dropClientY,
                    'delta:', deltaX, deltaY);
            } else {
                // dragイベントで更新された style.left/top を使用（従来の方法）
                const newLeft = parseInt(vobjElement.style.left);
                const newTop = parseInt(vobjElement.style.top);
                deltaX = newLeft - this.vobjDragState.initialLeft;
                deltaY = newTop - this.vobjDragState.initialTop;
                logger.debug('[VirtualObjectList] style.left/topを使用:', newLeft, newTop, 'delta:', deltaX, deltaY);
            }

            // 複数選択時は全ての選択仮身を移動、それ以外は単一の仮身を移動
            const objectsToMove = this.vobjDragState.selectedObjects
                ? this.vobjDragState.selectedObjects.map(item => item.obj)
                : [obj];

            if (this.virtualObjectDragState.dragMode === 'copy') {
                // コピーモード: 元の仮身を元の位置に戻し、新しい仮身を作成
                logger.debug('[VirtualObjectList] コピーモード: 元の仮身を復元し、新しい仮身を作成 (対象:', objectsToMove.length, '個)');

                objectsToMove.forEach((sourceObj, index) => {
                    // 元のサイズを保持
                    const width = sourceObj.width || (sourceObj.vobjright - sourceObj.vobjleft);
                    const height = sourceObj.heightPx || (sourceObj.vobjbottom - sourceObj.vobjtop);

                    // 移動量を適用
                    const initialLeft = this.vobjDragState.selectedObjectsInitialPositions?.[index]?.left || sourceObj.vobjleft;
                    const initialTop = this.vobjDragState.selectedObjectsInitialPositions?.[index]?.top || sourceObj.vobjtop;
                    const newLeft = initialLeft + deltaX;
                    const newTop = initialTop + deltaY;

                    // 新しい仮身オブジェクトを作成
                    const newObj = {
                        link_id: sourceObj.link_id,
                        link_name: sourceObj.link_name,
                        vobjleft: newLeft,
                        vobjtop: newTop,
                        vobjright: newLeft + width,
                        vobjbottom: newTop + height,
                        width: width,
                        heightPx: height,
                        chsz: sourceObj.chsz || 14,
                        frcol: sourceObj.frcol || '#000000',
                        chcol: sourceObj.chcol || '#000000',
                        tbcol: sourceObj.tbcol || '#ffffff',
                        bgcol: sourceObj.bgcol || '#ffffff',
                        dlen: sourceObj.dlen || 0,
                        applist: sourceObj.applist || {},
                        // 表示属性もコピー
                        pictdisp: sourceObj.pictdisp || 'true',
                        namedisp: sourceObj.namedisp || 'true',
                        roledisp: sourceObj.roledisp || 'false',
                        typedisp: sourceObj.typedisp || 'false',
                        updatedisp: sourceObj.updatedisp || 'false',
                        framedisp: sourceObj.framedisp || 'true',
                        autoopen: sourceObj.autoopen || 'false',
                        originalLeft: newLeft,
                        originalTop: newTop,
                        originalRight: newLeft + width,
                        originalBottom: newTop + height
                    };

                    // 仮身リストに追加
                    this.virtualObjects.push(newObj);

                    // xmlTADに追加
                    this.addVirtualObjectToXml(newObj);

                    // refCountを増やす
                    this.requestCopyVirtualObject(sourceObj.link_id);
                });

                // 再描画
                this.renderVirtualObjects();

            } else {
                // 移動モード: 位置を更新
                logger.debug('[VirtualObjectList] 移動モード: 仮身を移動 (対象:', objectsToMove.length, '個)');

                objectsToMove.forEach((targetObj, index) => {
                    // 元のサイズを保持
                    const width = targetObj.width || (targetObj.vobjright - targetObj.vobjleft);
                    const height = targetObj.heightPx || (targetObj.vobjbottom - targetObj.vobjtop);

                    // 移動量を適用
                    const initialLeft = this.vobjDragState.selectedObjectsInitialPositions?.[index]?.left || targetObj.vobjleft;
                    const initialTop = this.vobjDragState.selectedObjectsInitialPositions?.[index]?.top || targetObj.vobjtop;
                    const newLeft = initialLeft + deltaX;
                    const newTop = initialTop + deltaY;

                    targetObj.vobjleft = newLeft;
                    targetObj.vobjtop = newTop;
                    targetObj.vobjright = newLeft + width;
                    targetObj.vobjbottom = newTop + height;

                    logger.debug('[VirtualObjectList] 移動:', targetObj.link_name, {
                        left: targetObj.vobjleft,
                        top: targetObj.vobjtop,
                        delta: { x: deltaX, y: deltaY }
                    });

                    // xmlTADを更新
                    this.updateVirtualObjectPosition(targetObj);
                });

                // 仮身の表示を再描画（元のウィンドウに戻った場合も確実に表示）
                this.renderVirtualObjects();
            }

            // キャンバスサイズを更新
            this.updateCanvasSize();
        }

        // ドラッグ状態をリセット（dragModeも忘れずに）
        this.virtualObjectDragState.isDragging = false;
        this.virtualObjectDragState.hasMoved = false;
        this.vobjDragState.currentObject = null;
        this.vobjDragState.currentElement = null;
        this.vobjDragState.vobjIndex = null;
        this.vobjDragState.selectedObjects = null;
        this.vobjDragState.selectedObjectsInitialPositions = null;
        this.vobjDragState.dropClientX = undefined;
        this.vobjDragState.dropClientY = undefined;
        this.virtualObjectDragState.dragMode = 'move'; // デフォルトに戻す
        // isRightButtonPressedはPluginBaseで管理

        // スクロールを再有効化（念のため）
        const pluginContent = document.querySelector('.plugin-content');
        if (pluginContent && pluginContent.style.overflow === 'hidden') {
            pluginContent.style.overflow = 'auto';
            logger.debug('[VirtualObjectList] finishDrag: スクロールを再有効化');
        }

        // 開いた仮身のiframeは常に無効化されたままにするため、再有効化しない
        // this.setIframesPointerEvents(true);
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
        logger.debug('[VirtualObjectList] iframeのpointer-events:', enabled ? '有効化' : '無効化', 'iframe数:', iframes.length);
    }

    /**
     * 全画面表示切り替え
     */
    toggleFullscreen() {
        if (this.messageBus) {
            this.messageBus.send('toggle-maximize');

            this.isFullscreen = !this.isFullscreen;
            logger.debug('[VirtualObjectList] 全画面表示:', this.isFullscreen ? 'ON' : 'OFF');

            // 実身管理用セグメントのfullscreenフラグを更新
            if (this.realId) {
                    this.messageBus.send('update-fullscreen-state', {
                    fileId: this.realId,
                    isFullscreen: this.isFullscreen
                });
                logger.debug('[VirtualObjectList] 全画面表示状態更新を親ウィンドウに通知:', this.realId, this.isFullscreen);
            }
        }
    }

    /**
     * 再表示（画面を再描画）
     */
    refresh() {
        this.renderVirtualObjects();
        this.applyBackgroundColor();
        logger.debug('[VirtualObjectList] 再表示しました');
    }

    /**
     * 背景色を適用
     * @param {string} [color] - 適用する背景色（省略時はthis.bgcolまたはwindowConfigから取得）
     */
    applyBackgroundColor(color) {
        // 引数がなければ既存の方式でbgColorを取得
        const bgColor = color || this.bgcol || (this.fileData && this.fileData.windowConfig && this.fileData.windowConfig.backgroundColor);

        if (bgColor) {
            // PluginBase互換: changeBgColorで現在色を取得するため
            this.bgColor = bgColor;
            // DOM要素が生成されるまで待機
            setTimeout(() => {
                // 開いた仮身として表示される場合は、body全体に背景色を適用
                if (this.bgcol) {
                    document.body.style.backgroundColor = bgColor;
                    const pluginContent = document.querySelector('.plugin-content');
                    if (pluginContent) {
                        pluginContent.style.backgroundColor = bgColor;
                    }
                }

                // 通常のウィンドウ表示の場合は、canvasに背景色を適用
                const canvas = document.querySelector('.virtual-canvas');
                if (canvas) {
                    canvas.style.background = bgColor;
                }
            }, 100);
        }
    }

    /**
     * TADファイルをXMLに変換（基本文章編集から移植）
     */
    async parseTADToXML(rawData) {
        if (window.parent && typeof window.parent.parseTADToXML === 'function') {
            try {
                const uint8Array = rawData instanceof Uint8Array ? rawData : new Uint8Array(rawData);
                const xmlResult = await window.parent.parseTADToXML(uint8Array, 0);
                logger.debug('[VirtualObjectList] XML変換完了:', xmlResult ? xmlResult.substring(0, 100) : 'null');
                return xmlResult;
            } catch (error) {
                logger.error('[VirtualObjectList] TAD→XML変換エラー:', error);
                return null;
            }
        }
        logger.warn('[VirtualObjectList] parseTADToXML関数が見つかりません');
        return null;
    }

    /**
     * TAD XMLから段落要素を抽出（基本文章編集から移植）
     */
    parseTextElements(tadXML) {
        logger.debug('[VirtualObjectList] parseTextElements開始');
        const textElements = [];

        const docMatch = /<document>([\s\S]*?)<\/document>/i.exec(tadXML);
        if (!docMatch) {
            logger.warn('[VirtualObjectList] <document>タグが見つかりません');
            return textElements;
        }

        const docContent = docMatch[1];
        const paragraphRegex = /<p>([\s\S]*?)<\/p>/gi;
        let pMatch;

        while ((pMatch = paragraphRegex.exec(docContent)) !== null) {
            const paragraphContent = pMatch[1];

            const fontColorMatch = /<font\s+color="([^"]*)"\s*\/>/i.exec(paragraphContent);
            const fontColor = fontColorMatch ? fontColorMatch[1] : '';

            const fontSizeMatch = /<font\s+size="([^"]*)"\s*\/>/i.exec(paragraphContent);
            const fontSize = fontSizeMatch ? fontSizeMatch[1] : '14';

            const fontFaceMatch = /<font\s+face="([^"]*)"\s*\/>/i.exec(paragraphContent);
            const fontFamily = fontFaceMatch ? fontFaceMatch[1] : '';

            const textAlignMatch = /<text\s+align="([^"]*)"\s*\/>/i.exec(paragraphContent);
            const textAlign = textAlignMatch ? textAlignMatch[1] : 'left';

            const htmlContent = this.convertDecorationTagsToHTML(paragraphContent);

            const plainText = paragraphContent
                .replace(/\r\n/g, '')
                .replace(/\r/g, '')
                .replace(/<text[^>]*>/gi, '')
                .replace(/<\/text>/gi, '')
                .replace(/<font[^>]*\/>/gi, '')
                .replace(/<font[^>]*>/gi, '')
                .replace(/<\/font>/gi, '')
                .replace(/<br\s*\/?>/gi, '\n')
                .replace(/<[^>]+>/g, '')
                .trim();

            if (plainText) {
                textElements.push({
                    fontSize: fontSize,
                    fontFamily: fontFamily,
                    fontColor: fontColor,
                    textAlign: textAlign,
                    content: plainText,
                    htmlContent: htmlContent,
                    rawXML: paragraphContent
                });
            } else {
                textElements.push({
                    fontSize: '14',
                    fontFamily: '',
                    fontColor: '',
                    textAlign: textAlign,
                    content: '',
                    rawXML: paragraphContent
                });
            }
        }

        logger.debug('[VirtualObjectList] parseTextElements完了, 要素数:', textElements.length);
        return textElements;
    }

    /**
     * TAD XML文字修飾タグをHTMLに変換（基本文章編集から移植）
     */
    convertDecorationTagsToHTML(content) {
        let html = content;

        // XMLの改行文字を削除（タグの外側の改行のみ）
        html = html.replace(/\n/g, '').replace(/\r/g, '');

        // <font>タグを処理（自己閉じタグのペア形式を処理）
        let result = '';
        let pos = 0;
        const fontRegex = /<font\s+(size|color|face)="([^"]*)"\s*\/>/g;
        let match;
        const stack = [];

        while ((match = fontRegex.exec(html)) !== null) {
            result += html.substring(pos, match.index);

            const attr = match[1];
            const value = match[2];

            if (value === '') {
                // 終了タグ
                for (let i = stack.length - 1; i >= 0; i--) {
                    if (stack[i].attr === attr) {
                        result += '</span>';
                        stack.splice(i, 1);
                        break;
                    }
                }
            } else {
                // 開始タグ
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

        result += html.substring(pos);
        html = result;

        // 各種修飾タグの変換
        html = html.replace(/<underline>(.*?)<\/underline>/gi, '<u>$1</u>');
        html = html.replace(/<overline>(.*?)<\/overline>/gi, '<span style="text-decoration: overline;">$1</span>');
        html = html.replace(/<strikethrough>(.*?)<\/strikethrough>/gi, '<s>$1</s>');
        html = html.replace(/<bold>(.*?)<\/bold>/gi, '<b>$1</b>');
        html = html.replace(/<italic>(.*?)<\/italic>/gi, '<i>$1</i>');
        html = html.replace(/<superscript>(.*?)<\/superscript>/gi, '<sup>$1</sup>');
        html = html.replace(/<subscript>(.*?)<\/subscript>/gi, '<sub>$1</sub>');
        html = html.replace(/<bagchar>(.*?)<\/bagchar>/gi, '<span style="-webkit-text-stroke: 1px currentColor; paint-order: stroke fill;">$1</span>');
        html = html.replace(/<box>(.*?)<\/box>/gi, '<span style="border: 1px solid currentColor; padding: 0 2px;">$1</span>');
        html = html.replace(/<invert>(.*?)<\/invert>/gi, '<span style="background-color: currentColor; color: #ffffff; padding: 0 2px;">$1</span>');
        html = html.replace(/<mesh>(.*?)<\/mesh>/gi, '<span style="background-image: repeating-linear-gradient(45deg, transparent, transparent 2px, #00000019 2px, #00000019 4px);">$1</span>');
        html = html.replace(/<noprint>(.*?)<\/noprint>/gi, '<span style="opacity: 0.3;" data-noprint="true">$1</span>');

        // rubyタグ
        html = html.replace(/<ruby\s+position="([01])"\s+text="([^"]*)"\s*>(.*?)<\/ruby>/gi, (match, position, rubyText, baseText) => {
            if (position === '0') {
                return `<ruby>${baseText}<rt>${rubyText}</rt></ruby>`;
            } else {
                return `<ruby>${baseText}<rtc style="ruby-position: under;">${rubyText}</rtc></ruby>`;
            }
        });

        html = html.replace(/<br\s*\/>/gi, '<br>');

        return html;
    }

    /**
     * 仮身の内容をHTML形式で描画（基本文章編集のrenderTADXMLから移植）
     */
    renderVirtualObjectContent(xmlContent) {
        if (!xmlContent) {
            return '';
        }

        try {
            // <document>...</document>を抽出
            const docMatch = /<document>([\s\S]*?)<\/document>/i.exec(xmlContent);
            if (!docMatch) {
                return xmlContent;
            }

            const docContent = docMatch[1];

            // <p>タグで段落に分割
            const paragraphRegex = /<p>([\s\S]*?)<\/p>/gi;
            let htmlContent = '';
            let pMatch;

            while ((pMatch = paragraphRegex.exec(docContent)) !== null) {
                let paragraphContent = pMatch[1].trim();
                let style = 'margin: 0.5em 0;';

                // フォントサイズ
                const fontSizeMatch = /<font\s+size="([^"]*)"\s*\/>/i.exec(paragraphContent);
                if (fontSizeMatch) {
                    style += `font-size: ${fontSizeMatch[1]}pt;`;
                    paragraphContent = paragraphContent.replace(/<font\s+size="[^"]*"\s*\/>/i, '');
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

                // <text>タグを削除
                paragraphContent = paragraphContent.replace(/<text[^>]*\/>/gi, '');
                paragraphContent = paragraphContent.replace(/<text[^>]*>/gi, '').replace(/<\/text>/gi, '');

                // タグ間の余分な空白・改行を正規化
                paragraphContent = paragraphContent.replace(/>\s+</g, '><');

                // インライン修飾タグをHTMLに変換
                paragraphContent = this.convertDecorationTagsToHTML(paragraphContent);

                // 空の段落
                if (!paragraphContent.trim()) {
                    htmlContent += `<p style="${style}">&nbsp;</p>`;
                } else {
                    htmlContent += `<p style="${style}">${paragraphContent}</p>`;
                }
            }

            return htmlContent || xmlContent;
        } catch (error) {
            logger.error('[VirtualObjectList] HTML変換エラー:', error);
            return xmlContent;
        }
    }

    /**
     * エディタの内容をTAD XMLに変換（基本文章編集から移植）
     */
    convertEditorToXML(editorElement) {
        logger.debug('[VirtualObjectList] convertEditorToXML開始');

        const xmlParts = ['<tad version="1.0" encoding="UTF-8">\r\n'];
        xmlParts.push('<document>\r\n');

        // エディタの各段落（<p>タグ）を処理
        const paragraphs = editorElement.querySelectorAll('p');
        logger.debug('[VirtualObjectList] 段落数:', paragraphs.length);

        if (paragraphs.length === 0) {
            // 段落がない場合、エディタ全体を1つの段落として扱う
            xmlParts.push('<p>\r\n');
            this.extractTADXMLFromElement(editorElement, xmlParts);
            xmlParts.push('\r\n</p>\r\n');
        } else {
            paragraphs.forEach((p) => {
                xmlParts.push('<p>\r\n');

                // 段落のスタイルを解析してタグに変換
                const fontSize = this.extractFontSize(p);
                const fontFamily = this.extractFontFamily(p);
                const color = this.extractColor(p);
                const textAlign = this.extractTextAlign(p);

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

                // 段落の内容を取得
                this.extractTADXMLFromElement(p, xmlParts);

                xmlParts.push('\r\n</p>\r\n');
            });
        }

        xmlParts.push('</document>\r\n');
        xmlParts.push('</tad>');

        const xml = xmlParts.join('');
        logger.debug('[VirtualObjectList] convertEditorToXML完了, XML長さ:', xml.length);
        return xml;
    }

    /**
     * 要素からTAD XMLタグを抽出（基本文章編集から移植）
     */
    extractTADXMLFromElement(element, xmlParts, fontState = { size: '14', color: '#000000', face: '' }) {
        // 後方互換性サポート: 第2引数が配列でない場合は旧形式の呼び出し
        const isOldStyle = !Array.isArray(xmlParts);
        if (isOldStyle) {
            fontState = xmlParts || { size: '14', color: '#000000', face: '' };
            xmlParts = [];
        }

        let xml = '';
        const nodes = element.childNodes;

        nodes.forEach(node => {
            if (node.nodeType === 3) { // Node.TEXT_NODE
                xml += this.escapeXml(node.textContent);
            } else if (node.nodeName === 'BR') {
                xml += '<br/>\r\n';
            } else if (node.nodeType === 1) { // Node.ELEMENT_NODE
                const nodeName = node.nodeName.toLowerCase();

                // TAD XMLタグはそのまま出力
                if (['underline', 'overline', 'strikethrough', 'bagchar', 'box', 'invert', 'mesh', 'noprint', 'ruby'].includes(nodeName)) {
                    xml += `<${nodeName}`;

                    if (nodeName === 'ruby') {
                        const position = node.getAttribute('position') || '0';
                        const text = node.getAttribute('text') || '';
                        xml += ` position="${position}" text="${this.escapeXml(text)}"`;
                    }

                    xml += '>';
                    xml += this.extractTADXMLFromElement(node, xmlParts, fontState);
                    xml += `</${nodeName}>`;
                }
                else if (nodeName === 'font') {
                    const color = this.rgbToHex(node.color || node.style.color);
                    const sizeAttr = node.size || this.extractFontSize(node);
                    const face = node.face || this.extractFontFamily(node);

                    const prevState = { ...fontState };
                    const newState = { ...fontState };

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

                    xml += this.extractTADXMLFromElement(node, xmlParts, newState);

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
                    xml += this.extractTADXMLFromElement(node, xmlParts, fontState);
                    xml += '</bold>';
                }
                else if (nodeName === 'i' || nodeName === 'em') {
                    xml += '<italic>';
                    xml += this.extractTADXMLFromElement(node, xmlParts, fontState);
                    xml += '</italic>';
                }
                else if (nodeName === 'u') {
                    xml += '<underline>';
                    xml += this.extractTADXMLFromElement(node, xmlParts, fontState);
                    xml += '</underline>';
                }
                else if (nodeName === 'sup') {
                    xml += '<superscript>';
                    xml += this.extractTADXMLFromElement(node, xmlParts, fontState);
                    xml += '</superscript>';
                }
                else if (nodeName === 'sub') {
                    xml += '<subscript>';
                    xml += this.extractTADXMLFromElement(node, xmlParts, fontState);
                    xml += '</subscript>';
                }
                else if (nodeName === 'span') {
                    const style = node.style;
                    const prevState = { ...fontState };
                    const newState = { ...fontState };

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

                    xml += this.extractTADXMLFromElement(node, xmlParts, newState);

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
                else {
                    xml += this.extractTADXMLFromElement(node, xmlParts, fontState);
                }
            }
        });

        // 配列に追加
        if (xml) {
            xmlParts.push(xml);
        }

        // 旧形式の呼び出しの場合は文字列を返す
        if (isOldStyle) {
            return xmlParts.join('');
        }
    }

    // escapeXml は PluginBase に移動済み

    /**
     * RGB形式を#rrggbb形式に変換（基本文章編集から移植）
     */
    rgbToHex(color) {
        if (!color) return '';

        if (color.startsWith('#')) {
            return color;
        }

        // 共通ユーティリティ関数を使用
        return window.rgbToHex ? window.rgbToHex(color) : color;
    }

    /**
     * フォントサイズを抽出（基本文章編集から移植）
     */
    extractFontSize(element) {
        const style = element.style.fontSize;
        if (style) {
            return style.replace('pt', '');
        }
        return null;
    }

    /**
     * フォントファミリーを抽出（基本文章編集から移植）
     */
    extractFontFamily(element) {
        const style = element.style.fontFamily;
        if (style) {
            return style.replace(/['"]/g, '');
        }
        return null;
    }

    /**
     * 色を抽出（基本文章編集から移植）
     */
    extractColor(element) {
        const style = element.style.color;
        if (style) {
            return style;
        }
        return null;
    }

    /**
     * テキスト配置を抽出（基本文章編集から移植）
     */
    extractTextAlign(element) {
        const style = element.style.textAlign;
        if (style) {
            return style;
        }
        return 'left';
    }

    async parseVirtualObjects() {
        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(this.xmlData, 'text/xml');

            // すべての<link>要素を取得（仮身として表示）
            const linkElements = xmlDoc.getElementsByTagName('link');

            this.virtualObjects = [];

            for (const link of linkElements) {
                const virtualObj = this.parseLinkElement(link);
                if (virtualObj) {
                    // 仮身のlink_idに対応するJSONファイルを読み込んでapplist情報を取得
                    await this.loadVirtualObjectMetadata(virtualObj);
                    this.virtualObjects.push(virtualObj);
                }
            }

            logger.debug('[VirtualObjectList] 仮身数:', this.virtualObjects.length);

            // autoopen属性がtrueの仮身を自動的に開く
            await this.autoOpenVirtualObjects();
        } catch (error) {
            logger.error('[VirtualObjectList] XML解析エラー:', error);
        }
    }

    /**
     * 親ウィンドウにファイル読み込みを依頼
     */
    async loadDataFileFromParent(fileName) {
        const messageId = this.generateMessageId('load');

        // MessageBusでload-data-file-requestを送信
        this.messageBus.send('load-data-file-request', {
            messageId: messageId,
            fileName: fileName
        });

        try {
            // レスポンスを待つ（5秒タイムアウト）
            const result = await this.messageBus.waitFor('load-data-file-response', window.DEFAULT_TIMEOUT_MS, (data) => {
                return data.messageId === messageId;
            });

            if (result.success) {
                return result.data;
            } else {
                throw new Error(result.error || 'ファイル読み込み失敗');
            }
        } catch (error) {
            logger.error('[VirtualObjectList] ファイル読み込みエラー:', error);
            throw error;
        }
    }

    /**
     * 仮身のメタデータ（applist等）をJSONファイルから読み込む
     * @param {Object} virtualObj - 仮身オブジェクト
     */
    async loadVirtualObjectMetadata(virtualObj) {
        try {
            // link_idがundefinedまたは空の場合はスキップ
            if (!virtualObj.link_id || virtualObj.link_id === '') {
                logger.warn('[VirtualObjectList] link_idが未設定、メタデータ読み込みをスキップ:', virtualObj);
                virtualObj.applist = {};
                return;
            }

            // 実身IDを抽出してJSONファイル名を生成（共通メソッドを使用）
            const baseFileId = window.RealObjectSystem.extractRealId(virtualObj.link_id);
            const jsonFileName = window.RealObjectSystem.getRealObjectJsonFileName(baseFileId);
            logger.debug('[VirtualObjectList] メタデータ読み込み試行:', virtualObj.link_id, 'JSONファイル:', jsonFileName);

            // 親ウィンドウのfileObjectsからJSONファイルを取得
            if (window.parent && window.parent.tadjsDesktop && window.parent.tadjsDesktop.fileObjects) {
                const jsonFile = window.parent.tadjsDesktop.fileObjects[jsonFileName];
                logger.debug('[VirtualObjectList] fileObjectsから検索:', jsonFileName, 'found:', !!jsonFile);

                if (jsonFile) {
                    const jsonText = await jsonFile.text();
                    const jsonData = JSON.parse(jsonText);

                    // applistはオブジェクト形式 { "plugin-id": { "name": "プラグイン名" }, ... }
                    virtualObj.applist = jsonData.applist || {};
                    virtualObj.metadata = jsonData;
                    virtualObj.updateDate = jsonData.updateDate; // 更新日時を保存
                    logger.debug('[VirtualObjectList] メタデータ読み込み成功:', virtualObj.link_id, virtualObj.applist);
                } else {
                    // JSONファイルが見つからない場合、Electron環境なら親ウィンドウ経由で読み込み
                    logger.debug('[VirtualObjectList] fileObjectsに見つからない、親ウィンドウ経由で試行:', jsonFileName);

                    try {
                        const jsonFile = await this.loadDataFileFromParent(jsonFileName);
                        const jsonText = await jsonFile.text();
                        const jsonData = JSON.parse(jsonText);
                        virtualObj.applist = jsonData.applist || {};
                        virtualObj.metadata = jsonData;
                        virtualObj.updateDate = jsonData.updateDate; // 更新日時を保存
                        logger.debug('[VirtualObjectList] メタデータ読み込み成功（親ウィンドウ経由）:', jsonFileName, virtualObj.applist);
                    } catch (parentError) {
                        logger.debug('[VirtualObjectList] 親ウィンドウ経由で失敗、HTTP fetchにフォールバック:', parentError.message);

                        // HTTP fetchにフォールバック
                        const urlsToTry = [
                            `../../${jsonFileName}`,  // resources/app/
                            `../basic-text-editor/${jsonFileName}`,
                            `../unpack-file/${jsonFileName}`,
                            `../virtual-object-list/${jsonFileName}`,
                            `../base-file-manager/${jsonFileName}`,
                            `../system-config/${jsonFileName}`,
                            `../user-config/${jsonFileName}`,
                            `../tadjs-view/${jsonFileName}`
                        ];

                        let found = false;
                        for (const jsonUrl of urlsToTry) {
                            logger.debug('[VirtualObjectList] Fetch URL試行:', jsonUrl);
                            const response = await fetch(jsonUrl);

                            if (response.ok) {
                                const jsonData = await response.json();
                                virtualObj.applist = jsonData.applist || {};
                                virtualObj.metadata = jsonData;
                                virtualObj.updateDate = jsonData.updateDate; // 更新日時を保存
                                logger.debug('[VirtualObjectList] メタデータ読み込み成功（HTTP）:', jsonUrl, virtualObj.applist);
                                found = true;
                                break;
                            }
                        }

                        if (!found) {
                            logger.debug('[VirtualObjectList] JSONファイルなし（すべてのパスで404）:', virtualObj.link_id);
                            virtualObj.applist = {};
                        }
                    }
                }
            } else {
                // 親ウィンドウのfileObjectsにアクセスできない場合（親ウィンドウ経由で読み込み）
                logger.debug('[VirtualObjectList] 親ウィンドウのfileObjectsにアクセスできない、親ウィンドウ経由で読み込み');

                try {
                    const jsonFile = await this.loadDataFileFromParent(jsonFileName);
                    const jsonText = await jsonFile.text();
                    const jsonData = JSON.parse(jsonText);
                    virtualObj.applist = jsonData.applist || {};
                    virtualObj.metadata = jsonData;
                    virtualObj.updateDate = jsonData.updateDate; // 更新日時を保存
                    logger.debug('[VirtualObjectList] メタデータ読み込み成功（親ウィンドウ経由）:', jsonFileName, virtualObj.applist);
                } catch (error) {
                    logger.debug('[VirtualObjectList] メタデータ読み込み失敗:', virtualObj.link_id, error.message);
                    virtualObj.applist = {};
                }
            }
        } catch (error) {
            logger.debug('[VirtualObjectList] メタデータ読み込みエラー:', virtualObj.link_id, error);
            virtualObj.applist = {};
        }
    }

    /**
     * <link>要素から仮身情報を解析
     * PluginBase共通メソッドを使用し、プラグイン固有属性を追加
     */
    parseLinkElement(linkElement) {
        // PluginBase共通メソッドを呼び出し
        const baseObj = super.parseLinkElement(linkElement);
        if (!baseObj) return null;

        try {
            // プラグイン固有属性を追加
            return {
                ...baseObj,
                // 元の位置を保存（ドラッグ操作用）
                originalLeft: baseObj.vobjleft,
                originalTop: baseObj.vobjtop,
                originalRight: baseObj.vobjright,
                originalBottom: baseObj.vobjbottom,
                // 保護状態（固定化と背景化は独立して設定可能）
                isFixed: linkElement.getAttribute('fixed') === 'true',
                isBackground: linkElement.getAttribute('background') === 'true'
            };
        } catch (error) {
            logger.error('[VirtualObjectList] リンク要素解析エラー:', error);
            return null;
        }
    }

    parseVirtualObjectSegment(segment) {
        try {
            const obj = {
                id: segment.getAttribute('id') || '',
                x: parseInt(segment.getAttribute('x')) || 0,
                y: parseInt(segment.getAttribute('y')) || 0,
                width: parseInt(segment.getAttribute('width')) || 0,
                height: parseInt(segment.getAttribute('height')) || 0,
                name: '',
                type: '',
                dataLength: 0,
                data: null,
                segment: segment
            };

            // 仮身データを取得
            const dataElement = segment.querySelector('virtual-data, link-data');
            if (dataElement) {
                const xmlContent = dataElement.textContent.trim();
                obj.data = xmlContent;
                obj.dataLength = xmlContent.length;

                // XML内容をHTML形式に変換
                obj.htmlContent = this.renderVirtualObjectContent(xmlContent);

                // 仮身名を推測（最初の段落から）
                const nameMatch = /<p>(.*?)<\/p>/i.exec(xmlContent);
                if (nameMatch) {
                    const firstPara = nameMatch[1].replace(/<[^>]+>/g, '').trim();
                    obj.name = firstPara.substring(0, 50);
                }
            }

            // セグメント内のtype属性があれば取得
            const typeAttr = segment.getAttribute('virtual-type') || segment.getAttribute('link-type');
            if (typeAttr) {
                obj.type = typeAttr;
            } else {
                obj.type = segment.querySelector('virtual-data') ? '仮身' : 'リンク';
            }

            return obj;
        } catch (error) {
            logger.error('[VirtualObjectList] 仮身セグメント解析エラー:', error);
            return null;
        }
    }

    renderVirtualObjects() {
        const listElement = document.getElementById('virtualList');
        if (!listElement) return;

        // スクロール位置を保存（DOM再構築で失われるため）
        const pluginContentForScroll = document.querySelector('.plugin-content');
        const savedScrollLeft = pluginContentForScroll ? pluginContentForScroll.scrollLeft : 0;
        const savedScrollTop = pluginContentForScroll ? pluginContentForScroll.scrollTop : 0;

        // 現在展開されている（iframeを持つ）仮身を記録
        const expandedVirtualObjects = new Set();
        const existingVirtualObjects = listElement.querySelectorAll('.virtual-object-opened');
        existingVirtualObjects.forEach(vobj => {
            // iframeを持つ仮身だけを記録
            const iframe = vobj.querySelector('iframe');
            if (iframe) {
                const linkId = vobj.getAttribute('data-link-id');
                if (linkId) {
                    expandedVirtualObjects.add(linkId);
                    logger.debug('[VirtualObjectList] 展開中の仮身を記録:', linkId);
                }
            }
        });

        listElement.innerHTML = '';

        // 仮身の最大の右端・下端位置を計算
        let maxRight = 0;
        let maxBottom = 0;

        this.virtualObjects.forEach((obj) => {
            const right = obj.vobjright || (obj.vobjleft + (obj.width || 100));
            const bottom = obj.vobjbottom || (obj.vobjtop + (obj.heightPx || 100));

            maxRight = Math.max(maxRight, right);
            maxBottom = Math.max(maxBottom, bottom);
        });

        // 実際のコンテンツサイズにマージンを追加し、小さな最小値を設定
        maxRight = Math.max(maxRight + 50, 300);  // 最小300px
        maxBottom = Math.max(maxBottom + 50, 200); // 最小200px

        // 仮身を配置するためのキャンバスを作成
        const canvas = document.createElement('div');
        canvas.className = 'virtual-canvas';
        canvas.style.position = 'relative';

        // ウィンドウサイズを取得
        const pluginContent = document.querySelector('.plugin-content');
        const windowWidth = pluginContent ? pluginContent.clientWidth : 300;
        const windowHeight = pluginContent ? pluginContent.clientHeight : 200;

        // コンテンツサイズとウィンドウサイズの大きい方を採用
        const finalWidth = Math.max(maxRight, windowWidth);
        const finalHeight = Math.max(maxBottom, windowHeight);

        canvas.style.width = finalWidth + 'px';   // 動的に幅を設定
        canvas.style.height = finalHeight + 'px'; // 動的に高さを設定
        // 背景色はapplyBackgroundColor()で設定
        canvas.style.border = '1px solid #808080';

        // 図形要素の描画（Phase 2対応）
        // xmlDataにfigure要素が含まれている場合は描画
        if (this.xmlData) {
            try {
                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(this.xmlData, 'text/xml');
                const result = this.renderFigureElements(xmlDoc, canvas);
                if (result.elementCount > 0) {
                    logger.debug('[VirtualObjectList] 図形要素を描画:', result.elementCount, '個');
                }
            } catch (figureError) {
                logger.error('[VirtualObjectList] 図形描画エラー:', figureError);
            }
        }

        // z-index管理：背景化された仮身と通常の仮身を分離
        const backgroundObjects = this.virtualObjects.filter(obj => obj.isBackground);
        const normalObjects = this.virtualObjects.filter(obj => !obj.isBackground);

        // 背景化された仮身を先にレンダリング（z-index 1-999）
        // その後、通常の仮身をレンダリング（z-index 1000以降）
        const allObjectsInOrder = [...backgroundObjects, ...normalObjects];

        allObjectsInOrder.forEach((obj, index) => {
            // 開いた仮身と閉じた仮身を判定するための計算
            const vobjHeight = obj.vobjbottom - obj.vobjtop;
            const chsz = Math.round(obj.chsz || 14); // 浮動小数点誤差を防ぐ
            const lineHeight = 1.2;
            const chszPx = window.convertPtToPx(chsz);
            const textHeight = Math.ceil(chszPx * lineHeight);
            const iconSize = window.convertPtToPx(chsz);
            const contentHeight = Math.max(iconSize, textHeight);
            const titleHeight = contentHeight + 8; // 閉じた仮身の正しい高さ
            const minOpenHeight = textHeight + 28; // タイトルバー + 区切り線 + コンテンツ最小
            const isOpenVirtualObj = vobjHeight >= minOpenHeight;

            // 閉じた仮身の場合、サイズを正しい値に調整
            if (!isOpenVirtualObj) {
                obj.vobjbottom = obj.vobjtop + titleHeight;
                logger.debug('[VirtualObjectList] 閉じた仮身のサイズ調整:', obj.link_name, '高さ:', titleHeight);
            }

            // virtualObjects配列内での元のインデックスを取得（一意のID代わりに使用）
            const vobjIndex = this.virtualObjects.indexOf(obj);
            const vobjElement = this.createVirtualObjectElement(obj, vobjIndex);

            // z-indexを設定：背景化は1～、通常は1000～
            if (obj.isBackground) {
                vobjElement.style.zIndex = index + 1; // 1から開始
            } else {
                vobjElement.style.zIndex = 1000 + index - backgroundObjects.length;
            }

            canvas.appendChild(vobjElement);

            if (isOpenVirtualObj) {
                // 初回起動時またはrefresh時に開いた仮身を展開
                if (!expandedVirtualObjects.has(obj.link_id)) {
                    logger.debug('[VirtualObjectList] 開いた仮身を自動展開:', obj.link_name);
                } else {
                    logger.debug('[VirtualObjectList] 仮身を再展開:', obj.link_name);
                }
                // 非同期で展開（DOMに追加された後に実行）
                setTimeout(() => {
                    this.expandVirtualObject(vobjElement, obj, {
                        readonly: true,
                        noScrollbar: true,
                        bgcol: obj.bgcol
                    }).catch(err => {
                        logger.error('[VirtualObjectList] 展開エラー:', err);
                    });
                }, 0);
            }
        });

        listElement.appendChild(canvas);

        // スクロールバー更新を通知（MessageBus経由）
        this.notifyScrollChange();

        // 背景色を適用
        this.applyBackgroundColor();

        // 選択状態を復元（DOM再構築後にビジュアルが失われるため）
        if (this.selectedVirtualObjects.size > 0) {
            this.selectedVirtualObjects.forEach(vobjIndex => {
                const vobjElement = canvas.querySelector(`[data-vobj-index="${vobjIndex}"]`);
                if (vobjElement) {
                    vobjElement.style.outline = '2px solid #007bff';
                }
            });
            logger.debug('[VirtualObjectList] 選択状態を復元:', this.selectedVirtualObjects.size, '個');
        }

        // スクロール位置を復元（キャンバスサイズが縮小した場合は最大値に制限）
        if (pluginContentForScroll) {
            const maxScrollLeft = Math.max(0, pluginContentForScroll.scrollWidth - pluginContentForScroll.clientWidth);
            const maxScrollTop = Math.max(0, pluginContentForScroll.scrollHeight - pluginContentForScroll.clientHeight);
            pluginContentForScroll.scrollLeft = Math.min(savedScrollLeft, maxScrollLeft);
            pluginContentForScroll.scrollTop = Math.min(savedScrollTop, maxScrollTop);
        }
    }

    /**
     * 仮身要素を作成（VirtualObjectRendererを使用）
     * @param {Object} obj - 仮身オブジェクト
     * @param {number} vobjIndex - virtualObjects配列内でのインデックス
     * @returns {HTMLElement} - 仮身要素
     */
    createVirtualObjectElement(obj, vobjIndex) {
        // VirtualObjectRendererを使用して仮身要素を作成
        if (!this.virtualObjectRenderer) {
            logger.error('[VirtualObjectList] VirtualObjectRenderer が初期化されていません');
            return document.createElement('div');
        }

        // loadIconCallbackオプションでアイコン読み込み機能を提供
        const options = {
            loadIconCallback: (realId) => this.iconManager.loadIcon(realId),
            vobjIndex: vobjIndex  // 一意のインデックスを渡す
        };

        const vobj = this.virtualObjectRenderer.createBlockElement(obj, options);

        // イベントリスナーを追加
        this.attachVirtualObjectEventListeners(vobj, obj);

        return vobj;
    }

    /**
     * 仮身要素にイベントリスナーを追加
     * @param {HTMLElement} vobj - 仮身要素
     * @param {Object} obj - 仮身オブジェクト
     */
    attachVirtualObjectEventListeners(vobj, obj) {
        // 仮身全体のクリックで選択
        vobj.addEventListener('click', (e) => {
            // 仮身をクリックした場合は必ずイベント伝播を止める
            e.stopPropagation();

            // 読み取り専用モードの場合は選択を無効化
            if (this.isReadonly) {
                return;
            }

            // mousedownで既に選択処理が行われた場合はスキップ（Shift+クリックのトグル重複を防ぐ）
            if (this.justSelectedInMouseDown) {
                this.justSelectedInMouseDown = false;
                return;
            }

            this.selectVirtualObject(obj, vobj, e);
        });

        // ダブルクリックはmouseupで判定するため、dblclickイベントは使用しない

        // 位置変更機能（ドラッグ）を追加
        this.makeVirtualObjectDraggable(vobj, obj);

        // サイズ変更機能（リサイズ）を追加
        this.makeVirtualObjectResizable(vobj, obj);
    }

    /**
     * 閉じた仮身を作成（tad.jsの7856-7884行を参考）
     * @param {Object} obj - 仮身オブジェクト
     * @returns {HTMLElement} - 閉じた仮身要素
     */
    createClosedVirtualObject(obj) {
        const vobj = document.createElement('div');
        vobj.className = 'virtual-object virtual-object-closed';
        vobj.setAttribute('data-link-name', obj.link_name); // 仮身識別用の属性
        vobj.setAttribute('data-link-id', obj.link_id); // 仮身の一意識別子
        vobj.style.position = 'absolute';
        vobj.style.left = obj.vobjleft + 'px';
        vobj.style.top = obj.vobjtop + 'px';
        vobj.style.width = obj.width + 'px';
        vobj.style.height = (obj.vobjbottom - obj.vobjtop) + 'px';
        vobj.style.boxSizing = 'border-box';
        vobj.style.cursor = 'pointer';

        // 表示項目の設定を取得
        const showName = obj.namedisp !== 'false'; // デフォルトは表示
        const showUpdate = obj.updatedisp === 'true'; // デフォルトは非表示
        const showFrame = obj.framedisp !== 'false'; // デフォルトは表示
        const showPict = obj.pictdisp !== 'false'; // デフォルトは表示
        const showRole = obj.roledisp === 'true'; // デフォルトは非表示
        const showType = obj.typedisp === 'true'; // デフォルトは非表示

        // いずれかの表示項目がある場合のみタイトルエリアを表示
        const showTitleArea = showPict || showName || showRole || showType || showUpdate;

        // デバッグログ: 表示フラグの状態を確認
        logger.debug('[TADjs] 閉仮身表示フラグ:', obj.link_id);
        logger.debug('  - フラグ値:', JSON.stringify({
            pictdisp: obj.pictdisp,
            namedisp: obj.namedisp,
            roledisp: obj.roledisp,
            typedisp: obj.typedisp,
            updatedisp: obj.updatedisp,
            framedisp: obj.framedisp
        }));
        logger.debug('  - 計算結果:', JSON.stringify({
            showPict, showName, showRole, showType, showUpdate, showFrame, showTitleArea
        }));
        logger.debug('  - データ:', JSON.stringify({
            hasMetadata: !!obj.metadata,
            hasUpdateDate: !!(obj.metadata && obj.metadata.updateDate),
            hasRelationship: !!(obj.metadata && obj.metadata.relationship),
            hasApplist: !!obj.applist,
            link_name: obj.link_name
        }));

        // タイトル部分（左上の領域）
        const titleArea = document.createElement('div');
        titleArea.style.position = 'absolute';
        titleArea.style.left = '0';
        titleArea.style.top = '0';
        titleArea.style.right = '0'; // 全幅
        // chszはポイント（pt）なのでピクセル（px）に変換
        const lineHeight = 1.2;
        const chszPx = window.convertPtToPx(obj.chsz);
        const textHeight = Math.ceil(chszPx * lineHeight);
        // アイコンサイズも計算（テキストとアイコンの両方を表示する場合に必要）
        const iconSize = window.convertPtToPx ? window.convertPtToPx(obj.chsz) : Math.round(obj.chsz * 1.333);
        // アイコンとテキストの高い方を使用
        const contentHeight = Math.max(iconSize, textHeight);
        const titleHeight = contentHeight + 8;
        logger.debug('[TADjs] 閉仮身タイトル高さ計算:', obj.link_name, {
            chsz: obj.chsz,
            chszPx,
            iconSize,
            textHeight,
            contentHeight,
            titleHeight,
            vobjHeight: (obj.vobjbottom - obj.vobjtop)
        });
        titleArea.style.height = titleHeight + 'px'; // コンテンツ高さ + パディング(上下各4px)
        titleArea.style.backgroundColor = obj.tbcol;

        // 仮身枠の表示/非表示
        if (showFrame) {
            titleArea.style.borderLeft = `1px solid ${obj.frcol}`;
            titleArea.style.borderTop = `1px solid ${obj.frcol}`;
            titleArea.style.borderRight = `1px solid ${obj.frcol}`;
        }

        titleArea.style.display = showTitleArea ? 'flex' : 'none';
        titleArea.style.alignItems = 'center';
        titleArea.style.paddingTop = '4px'; // 上下パディングを増やして中央寄せを改善
        titleArea.style.paddingBottom = '4px';
        titleArea.style.paddingLeft = '4px';
        titleArea.style.paddingRight = '4px';
        titleArea.style.gap = '4px';
        titleArea.style.overflow = 'visible'; // アイコンとテキストが切れないように
        titleArea.style.zIndex = '1'; // mainAreaの上に表示

        // ピクトグラム（アイコン）
        if (showPict) {
            const iconImg = document.createElement('img');
            iconImg.className = 'virtual-object-icon';
            // 既に計算済みのiconSizeを使用
            iconImg.style.width = iconSize + 'px';
            iconImg.style.height = iconSize + 'px';
            iconImg.style.objectFit = 'contain';
            iconImg.style.flexShrink = '0'; // アイコンは縮小しない
            iconImg.setAttribute('data-element-type', 'icon'); // オーバーフロー判定用

            // link_idから実身IDを抽出（_0.xtadなどを削除）
            const realId = obj.link_id.replace(/_\d+\.xtad$/i, '');

            // アイコンを非同期で読み込む
            logger.debug('[TADjs] アイコン読み込み開始:', realId, 'showPict:', showPict);
            this.iconManager.loadIcon(realId).then(iconData => {
                logger.debug('[TADjs] アイコン読み込みPromiseコールバック実行:', realId, 'データあり:', !!iconData);
                if (iconData) {
                    iconImg.src = `data:image/x-icon;base64,${iconData}`;
                    logger.debug('[TADjs] アイコンimg.src設定完了:', realId, 'データ長:', iconData.length);
                } else {
                    // デフォルトアイコン（空の画像または絵文字）
                    iconImg.style.display = 'none';
                    logger.debug('[TADjs] アイコンデータなし、非表示に設定:', realId);
                }
            }).catch(error => {
                logger.error('[TADjs] アイコン読み込みエラー:', realId, error);
                iconImg.style.display = 'none';
            });

            titleArea.appendChild(iconImg);
        }

        // タイトルテキスト部分
        const titleTextSpan = document.createElement('span');
        titleTextSpan.className = 'virtual-object-title';
        titleTextSpan.style.color = obj.chcol;
        titleTextSpan.style.fontSize = chszPx + 'px';  // 既に計算されたピクセル値を使用
        titleTextSpan.style.whiteSpace = 'nowrap';
        titleTextSpan.style.overflow = 'hidden';
        titleTextSpan.style.textOverflow = 'ellipsis';
        titleTextSpan.style.lineHeight = '1.2';
        titleTextSpan.style.flex = '1';
        titleTextSpan.style.textDecoration = 'none'; // アンダーラインを防止

        // 名称
        if (showName) {
            const nameSpan = document.createElement('span');
            nameSpan.className = 'virtual-object-name'; // DOM更新用のクラスを追加
            nameSpan.textContent = obj.link_name;
            nameSpan.style.textDecoration = 'none'; // アンダーラインを防止
            nameSpan.setAttribute('data-element-type', 'name');
            titleTextSpan.appendChild(nameSpan);
        }

        // 続柄（relationship配列をスペース区切りで表示）
        if (showRole && obj.metadata && obj.metadata.relationship && obj.metadata.relationship.length > 0) {
            const relationshipText = obj.metadata.relationship.join(' ');
            const relationshipSpan = document.createElement('span');
            relationshipSpan.textContent = ' : ' + relationshipText;
            relationshipSpan.setAttribute('data-element-type', 'relationship');
            titleTextSpan.appendChild(relationshipSpan);
        }

        // タイプ（applistから取得）
        if (showType && obj.applist) {
            // defaultOpenプラグインの名前を取得
            let typeName = '';
            for (const [, config] of Object.entries(obj.applist)) {
                if (config && config.defaultOpen === true && config.name) {
                    typeName = config.name;
                    break;
                }
            }

            if (typeName) {
                const typeSpan = document.createElement('span');
                typeSpan.textContent = ' (' + typeName + ')';
                typeSpan.setAttribute('data-element-type', 'type');
                titleTextSpan.appendChild(typeSpan);
            }
        }

        // 更新日時
        if (showUpdate && obj.metadata && obj.metadata.updateDate) {
            const updateDate = new Date(obj.metadata.updateDate);
            const dateStr = updateDate.getFullYear() + '/' +
                          String(updateDate.getMonth() + 1).padStart(2, '0') + '/' +
                          String(updateDate.getDate()).padStart(2, '0') + ' ' +
                          String(updateDate.getHours()).padStart(2, '0') + ':' +
                          String(updateDate.getMinutes()).padStart(2, '0') + ':' +
                          String(updateDate.getSeconds()).padStart(2, '0');
            const updateSpan = document.createElement('span');
            updateSpan.textContent = ' ' + dateStr;
            updateSpan.setAttribute('data-element-type', 'update');
            titleTextSpan.appendChild(updateSpan);
        }

        titleArea.appendChild(titleTextSpan);
        vobj.appendChild(titleArea);

        // メイン領域（タイトル下の本体部分）
        const mainArea = document.createElement('div');
        mainArea.style.position = 'absolute';
        mainArea.style.left = '0';
        mainArea.style.top = showTitleArea ? titleHeight + 'px' : '0'; // titleAreaの高さと一致させる
        mainArea.style.right = '0';
        mainArea.style.bottom = '0';
        mainArea.style.backgroundColor = obj.tbcol;
        mainArea.style.zIndex = '0'; // titleAreaの下に表示
        logger.debug('[TADjs] 閉仮身mainArea配置:', obj.link_name, {
            top: mainArea.style.top,
            zIndex: mainArea.style.zIndex
        });

        // 仮身枠の表示/非表示
        if (showFrame) {
            mainArea.style.border = `1px solid ${obj.frcol}`;
            if (showTitleArea) {
                mainArea.style.borderTop = 'none'; // タイトル領域と繋がっている場合は上の境界線は不要
            }
        }

        vobj.appendChild(mainArea);

        // 仮身全体のクリックで選択
        vobj.addEventListener('click', (e) => {
            // 仮身をクリックした場合は必ずイベント伝播を止める
            e.stopPropagation();

            // 読み取り専用モードの場合は選択を無効化
            if (this.isReadonly) {
                return;
            }

            // mousedownで既に選択処理が行われた場合はスキップ（Shift+クリックのトグル重複を防ぐ）
            if (this.justSelectedInMouseDown) {
                this.justSelectedInMouseDown = false;
                return;
            }

            this.selectVirtualObject(obj, vobj, e);
        });

        // ダブルクリックはmouseupで判定するため、dblclickイベントは使用しない

        // 位置変更機能（ドラッグ）を追加
        this.makeVirtualObjectDraggable(vobj, obj);

        // サイズ変更機能（リサイズ）を追加
        this.makeVirtualObjectResizable(vobj, obj);

        return vobj;
    }

    /**
     * 仮身を選択状態にする
     * @param {Object} obj - 選択する仮身オブジェクト
     * @param {HTMLElement} element - 仮身のDOM要素
     * @param {Event} event - クリックイベント（Shiftキー判定用）
     */
    selectVirtualObject(obj, element, event) {
        // 背景化された仮身も選択可能（背景解除するため）
        // ドラッグとリサイズは別途無効化されている

        const isShiftKey = event && event.shiftKey;
        const vobjIndex = this.virtualObjects.indexOf(obj);

        if (vobjIndex === -1) {
            logger.warn('[VirtualObjectList] 仮身がvirtualObjects配列に見つかりません:', obj.link_name);
            return;
        }

        if (isShiftKey) {
            // Shift+クリック: 複数選択のトグル
            if (this.selectedVirtualObjects.has(vobjIndex)) {
                // 既に選択されている場合は解除
                this.selectedVirtualObjects.delete(vobjIndex);
                element.style.outline = '';
                logger.debug('[VirtualObjectList] 仮身の選択を解除:', obj.link_name, 'vobjIndex:', vobjIndex);
            } else {
                // 選択されていない場合は追加
                this.selectedVirtualObjects.add(vobjIndex);
                element.style.outline = '2px solid #007bff';
                logger.debug('[VirtualObjectList] 仮身を選択（複数選択）:', obj.link_name, 'vobjIndex:', vobjIndex);
            }
        } else {
            // 通常クリック: 単一選択
            // 以前の選択を全て解除
            const allVirtualObjects = document.querySelectorAll('.virtual-object');
            allVirtualObjects.forEach(el => {
                el.style.outline = '';
            });
            this.selectedVirtualObjects.clear();

            // 新しい選択
            this.selectedVirtualObjects.add(vobjIndex);
            element.style.outline = '2px solid #007bff';

            logger.debug('[VirtualObjectList] 仮身を選択:', obj.link_name, 'vobjIndex:', vobjIndex);
        }
    }

    /**
     * 選択中の仮身を取得（複数選択時は最初の仮身）
     * @returns {Object|null} 選択中の仮身オブジェクト
     */
    getSelectedVirtualObject() {
        if (this.selectedVirtualObjects.size === 0) {
            return null;
        }
        // Setから最初のvobjIndexを取得し、仮身オブジェクトを返す
        const firstVobjIndex = Array.from(this.selectedVirtualObjects)[0];
        return this.virtualObjects[firstVobjIndex] || null;
    }

    /**
     * 指定した矩形範囲内にある仮身のインデックスを取得
     * @param {Object} bounds - 矩形範囲 { left, top, right, bottom }
     * @returns {Array<number>} 範囲内の仮身インデックス配列
     */
    getVirtualObjectsInRect(bounds) {
        const indices = [];
        this.virtualObjects.forEach((obj, index) => {
            const objLeft = obj.vobjleft;
            const objTop = obj.vobjtop;
            const objRight = obj.vobjright;
            const objBottom = obj.vobjbottom;

            // 矩形の交差判定（部分的に含まれていればtrue）
            const intersects = !(objRight < bounds.left ||
                                 objLeft > bounds.right ||
                                 objBottom < bounds.top ||
                                 objTop > bounds.bottom);

            if (intersects) {
                indices.push(index);
            }
        });
        return indices;
    }

    /**
     * 選択表示を更新
     * selectedVirtualObjectsの状態に基づいてDOM要素のアウトラインを更新
     */
    updateSelectionDisplay() {
        // 全ての仮身要素のアウトラインをクリア
        const allVobjElements = document.querySelectorAll('.virtual-object');
        allVobjElements.forEach(el => {
            el.style.outline = '';
        });

        // 選択中の仮身にアウトラインを設定
        this.selectedVirtualObjects.forEach(vobjIndex => {
            const obj = this.virtualObjects[vobjIndex];
            if (obj) {
                // data-vobj-index属性で要素を検索
                const element = document.querySelector(`.virtual-object[data-vobj-index="${vobjIndex}"]`);
                if (element) {
                    element.style.outline = '2px solid #000080';
                }
            }
        });
    }

    /**
     * virtualObjects配列の変更時に選択状態を保持するヘルパーメソッド
     * @param {Function} operation - 配列を変更する操作（関数）
     */
    preserveSelection(operation) {
        // 変更前: 選択中のvobjIndexから対応するlink_idリストを保存
        const selectedLinkIds = Array.from(this.selectedVirtualObjects).map(vobjIndex => {
            return this.virtualObjects[vobjIndex]?.link_id;
        }).filter(id => id);

        // 配列操作を実行
        operation();

        // 変更後: link_idから新しいvobjIndexを再計算
        this.selectedVirtualObjects.clear();
        selectedLinkIds.forEach(linkId => {
            const newIndex = this.virtualObjects.findIndex(v => v.link_id === linkId);
            if (newIndex !== -1) {
                this.selectedVirtualObjects.add(newIndex);
            }
        });

        logger.debug('[VirtualObjectList] 選択状態を保持:', this.selectedVirtualObjects.size, '個の仮身');
    }

    /**
     * 開いた仮身に実身の内容を表示
     * defaultOpenプラグインに描画を依頼する
     *
     * @param {HTMLElement} vobjElement - 開いた仮身のDOM要素
     * @param {Object} virtualObject - 仮身オブジェクト
     * @param {Object} options - オプション
     * @returns {Promise<HTMLIFrameElement>} コンテンツiframe
     */
    async expandVirtualObject(vobjElement, virtualObject, options = {}) {
        logger.debug('[VirtualObjectList] 開いた仮身の展開開始:', virtualObject.link_name);

        try {
            // 実身IDを取得
            const linkId = virtualObject.link_id;
            logger.debug('[VirtualObjectList] linkId:', linkId);
            // 実身IDを抽出（共通メソッドを使用）
            const realId = window.RealObjectSystem.extractRealId(linkId);
            logger.debug('[VirtualObjectList] 抽出されたrealId:', realId);
            logger.debug('[VirtualObjectList] レコード番号削除後（最終的な実身ID）:', realId);

            // 1. defaultOpenプラグインを取得
            const defaultOpenPlugin = this.getDefaultOpenPlugin(virtualObject);
            if (!defaultOpenPlugin) {
                logger.warn('[VirtualObjectList] defaultOpenプラグインが見つかりません');
                return null;
            }
            logger.debug('[VirtualObjectList] defaultOpenプラグイン:', defaultOpenPlugin);

            // 2. 実身データを読み込む
            const realObjectData = await this.loadRealObjectData(realId);
            if (!realObjectData) {
                logger.warn('[VirtualObjectList] 実身データの読み込みに失敗しました, realId:', realId);
                return null;
            }
            logger.debug('[VirtualObjectList] 実身データ読み込み完了:', realObjectData);

            // await後にvobjElementがまだDOMに接続されているか確認
            if (!vobjElement.isConnected) {
                logger.warn('[VirtualObjectList] 展開処理中に仮身要素がDOMから削除されました:', virtualObject.link_name);
                return null;
            }

            // 3. コンテンツ領域を取得
            const contentArea = vobjElement.querySelector('.virtual-object-content-area');
            if (!contentArea) {
                logger.error('[VirtualObjectList] コンテンツ領域が見つかりません');
                return null;
            }

            // コンテンツ領域のスクロールバーを非表示（noScrollbarオプション対応）
            if (options.noScrollbar !== false) {
                contentArea.style.overflow = 'hidden';
            }

            // 仮身の色属性を取得
            const bgcol = virtualObject.bgcol || '#ffffff';

            // 4. プラグインをiframeで読み込む（プラグインが描画する）
            const iframe = document.createElement('iframe');
            iframe.className = 'virtual-object-content';
            iframe.style.width = '100%';
            iframe.style.height = '100%';
            iframe.style.border = 'none';
            iframe.style.overflow = 'hidden';
            iframe.style.padding = '0';
            iframe.style.backgroundColor = bgcol;
            iframe.style.userSelect = 'none';
            iframe.style.pointerEvents = 'none'; // 開いた仮身内の操作を無効化（仮身一覧上では表示のみ）

            // src設定（loadイベントより前に設定）
            iframe.src = `../../plugins/${defaultOpenPlugin}/index.html`;

            // iframeロード後にデータを送信（load-virtual-objectメッセージ形式）
            iframe.addEventListener('load', () => {
                logger.debug('[VirtualObjectList] iframe読み込み完了、プラグインにload-virtual-objectメッセージ送信');
                iframe.contentWindow.postMessage({
                    type: 'load-virtual-object',
                    virtualObj: virtualObject,
                    realObject: realObjectData,
                    bgcol: bgcol,
                    readonly: options.readonly !== false,
                    noScrollbar: options.noScrollbar !== false
                }, '*');
                logger.debug('[VirtualObjectList] 開いた仮身表示にデータを送信:', { virtualObject, realObjectData, bgcol, readonly: options.readonly !== false, noScrollbar: options.noScrollbar !== false });
            });

            contentArea.appendChild(iframe);
            logger.debug('[VirtualObjectList] iframe追加完了');

            // アイコンリレー用にiframeを登録
            this.expandedIframes.add(iframe);

            return iframe;
        } catch (error) {
            logger.error('[VirtualObjectList] expandVirtualObject エラー:', error);
            return null;
        }
    }

    // loadRealObjectData() は基底クラス PluginBase で定義

    /**
     * defaultOpenプラグインを取得
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
        return null;
    }

    openVirtualObject(obj) {
        logger.debug('[VirtualObjectList] 仮身を開く:', obj.link_name, obj.link_id);

        // 親ウィンドウにメッセージを送信して仮身リンク先を開く
        this.messageBus.send('open-virtual-object', {
            linkId: obj.link_id,
            linkName: obj.link_name
        });
    }

    /**
     * 仮身要素をドラッグ可能にする（位置変更機能）
     * @param {HTMLElement} vobjElement - 仮身のDOM要素
     * @param {Object} obj - 仮身オブジェクト
     */
    makeVirtualObjectDraggable(vobjElement, obj) {
        // draggable属性を設定（クロスウィンドウドラッグ用）
        vobjElement.setAttribute('draggable', 'true');

        // ドラッグ開始（HTML5 Drag&Drop）
        vobjElement.addEventListener('dragstart', (e) => {
            // mousedownで準備したドラッグ状態を確認
            if (!this.vobjDragState.currentObject) {
                logger.warn('[VirtualObjectList] dragstart: ドラッグ準備ができていません');
                e.preventDefault();
                return;
            }

            // PluginBase共通メソッドでドラッグ状態を初期化
            this.initializeVirtualObjectDragStart(e);

            // 別ウィンドウへのドロップフラグをリセット
            this.lastDropWasCrossWindow = false;
            // ドラッグ開始時は自分のウィンドウにマウスがあるので、自分のwindowIdに初期化
            this.vobjDragState.lastMouseOverWindowId = this.windowId;
            // マウスは常に自分のウィンドウ内で開始
            this.vobjDragState.isMouseInThisWindow = true;

            // ドラッグ中はスクロールを無効化
            const pluginContent = document.querySelector('.plugin-content');
            if (pluginContent) {
                pluginContent.style.overflow = 'hidden';
                logger.debug('[VirtualObjectList] ドラッグ中: スクロールを無効化');
            }

            // ドラッグ中はすべてのiframeのpointer-eventsを無効化            this.disableIframePointerEvents();

            logger.debug('[VirtualObjectList] dragstart: HTML5ドラッグ開始', obj.link_name);
            logger.debug('[VirtualObjectList] ドラッグ開始:', obj.link_name, 'モード:', this.virtualObjectDragState.dragMode);

            // 複数選択時は全ての仮身データを含める
            let virtualObjects = [];
            if (this.vobjDragState.selectedObjects && this.vobjDragState.selectedObjects.length > 0) {
                // 複数選択時: 選択されたすべての仮身
                // ドラッグされた仮身（obj）を基準とした相対位置を計算
                virtualObjects = this.vobjDragState.selectedObjects.map(item => {
                    const vobj = item.obj;
                    return {
                        link_id: vobj.link_id,
                        link_name: vobj.link_name,
                        width: vobj.width || 150,
                        heightPx: vobj.heightPx || 30,
                        chsz: vobj.chsz || 14,
                        frcol: vobj.frcol || '#000000',
                        chcol: vobj.chcol || '#000000',
                        tbcol: vobj.tbcol || '#ffffff',
                        bgcol: vobj.bgcol || '#ffffff',
                        dlen: vobj.dlen || 0,
                        applist: vobj.applist || {},
                        // 元の絶対位置（同じlink_idの仮身を区別するため）
                        originalVobjLeft: vobj.vobjleft,
                        originalVobjTop: vobj.vobjtop,
                        // ドラッグされた仮身からの相対位置オフセット
                        offsetX: vobj.vobjleft - obj.vobjleft,
                        offsetY: vobj.vobjtop - obj.vobjtop
                    };
                });
                logger.debug('[VirtualObjectList] 複数選択ドラッグ:', virtualObjects.length, '個の仮身');
            } else {
                // 単一選択時: ドラッグした仮身のみ
                virtualObjects = [{
                    link_id: obj.link_id,
                    link_name: obj.link_name,
                    width: obj.width || 150,
                    heightPx: obj.heightPx || 30,
                    chsz: obj.chsz || 14,
                    frcol: obj.frcol || '#000000',
                    chcol: obj.chcol || '#000000',
                    tbcol: obj.tbcol || '#ffffff',
                    bgcol: obj.bgcol || '#ffffff',
                    dlen: obj.dlen || 0,
                    applist: obj.applist || {},
                    // 単一選択時のオフセットは0
                    offsetX: 0,
                    offsetY: 0
                }];
            }

            // PluginBase共通メソッドでdragDataを設定
            const isDuplicateDrag = this.dblClickDragState.isDblClickDragCandidate || this.dblClickDragState.isDblClickDrag;
            this.setVirtualObjectDragData(e, virtualObjects, 'virtual-object-list', isDuplicateDrag);
            // カスタムタイプとしてウィンドウIDを設定（dragoverで読み取れる）
            e.dataTransfer.setData('application/x-vobj-window-id', this.windowId);

            // 半透明にする
            vobjElement.style.opacity = '0.5';
        });

        // ドラッグ中の位置更新（HTML5 Drag&Drop）
        // 注: 実際の位置更新は親ウィンドウからのpostMessageで行う
        vobjElement.addEventListener('drag', (e) => {
            // drag中はmousemoveが発火しないため、ここで位置を更新
            // currentObjectが設定されていればドラッグ準備完了とみなす
            if (!this.vobjDragState.currentObject) {
                return;
            }

            // e.clientX/Yが0の場合はスキップ（ドラッグ終了時に0,0が送られる）
            if (e.clientX === 0 && e.clientY === 0) {
                return;
            }

            // 同じウィンドウ内のドラッグの場合のみ位置を更新
            // クロスウィンドウドラッグの場合はparent-drag-positionで位置を更新
            const isSameWindowDrag = (this.vobjDragState.lastMouseOverWindowId === this.windowId);

            if (!isSameWindowDrag) {
                return;
            }

            // PluginBase共通メソッドで移動検出
            const moved = this.detectVirtualObjectDragMove(e);
            if (moved && !this.virtualObjectDragState.hasMoved) {
                logger.debug('[VirtualObjectList] drag: 移動を検知 (hasMoved = true)');
            }

            const deltaX = e.clientX - this.virtualObjectDragState.startX;
            const deltaY = e.clientY - this.virtualObjectDragState.startY;

            // 複数選択時は全ての選択仮身を視覚的に移動
            if (this.vobjDragState.selectedObjects && this.vobjDragState.selectedObjectsInitialPositions) {
                this.vobjDragState.selectedObjects.forEach((item, index) => {
                    const initialPos = this.vobjDragState.selectedObjectsInitialPositions[index];
                    const newLeft = initialPos.left + deltaX;
                    const newTop = initialPos.top + deltaY;

                    // data-vobj-indexを使って特定の仮身要素を取得
                    const element = document.querySelector(`[data-vobj-index="${item.vobjIndex}"]`);
                    if (element) {
                        element.style.left = newLeft + 'px';
                        element.style.top = newTop + 'px';
                    }
                });
            }

            // 親ウィンドウに現在のマウス位置を保存（handleParentDragPositionで使用）
            this.vobjDragState.currentDeltaX = deltaX;
            this.vobjDragState.currentDeltaY = deltaY;

            // 親ウィンドウにドラッグ位置を通知（iframe座標を親座標系に変換）
            // ただし、マウスがこのウィンドウ内にいる場合のみ
            const iframe = window.frameElement;
            if (iframe && this.vobjDragState.isMouseInThisWindow) {
                const rect = iframe.getBoundingClientRect();
                const parentX = rect.left + e.clientX;
                const parentY = rect.top + e.clientY;
                this.messageBus.send('child-drag-position', {
                    windowId: this.windowId,
                    clientX: parentX,
                    clientY: parentY
                });
            }

            // 次のdragoverイベントまでフラグをfalseにリセット
            // マウスがウィンドウ内にいる場合、dragover→dragの順で発火するため、
            // dragイベント処理中はisMouseInThisWindowがtrueのまま
            // マウスがウィンドウ外に出た場合、dragoverが発火しないため、falseのまま
            this.vobjDragState.isMouseInThisWindow = false;
        });

        // ドラッグ終了
        vobjElement.addEventListener('dragend', (e) => {
            vobjElement.style.opacity = '1';
            vobjElement.style.visibility = 'visible'; // 表示状態をリセット

            // ドラッグ終了時にスクロールを再有効化
            const pluginContent = document.querySelector('.plugin-content');
            if (pluginContent) {
                pluginContent.style.overflow = 'auto';
                logger.debug('[VirtualObjectList] ドラッグ終了: スクロールを再有効化');
            }

            // ドラッグ終了時にすべてのiframeのpointer-eventsを再有効化            this.enableIframePointerEvents();

            logger.debug('[VirtualObjectList] ========== dragend開始 ==========');
            logger.debug('[VirtualObjectList] dragend: オブジェクト:', obj.link_name);
            logger.debug('[VirtualObjectList] dragend: dropEffect:', e.dataTransfer.dropEffect);

            // dropEffect === 'none'の場合のみ処理（ドロップ失敗）
            // それ以外（'move'または'copy'）の場合は、dropイベントで既に処理済み
            if (e.dataTransfer.dropEffect === 'none') {
                // ドロップ失敗（キャンセル）: 元の位置に戻す
                logger.debug('[VirtualObjectList] ドロップキャンセル: 元の位置に戻す');

                // 複数選択時はすべての選択仮身を元の位置に戻す
                if (this.vobjDragState.selectedObjects && this.vobjDragState.selectedObjectsInitialPositions) {
                    this.vobjDragState.selectedObjects.forEach((item, index) => {
                        const initialPos = this.vobjDragState.selectedObjectsInitialPositions[index];
                        // data-vobj-indexを使って特定の仮身要素を取得
                        const element = document.querySelector(`[data-vobj-index="${item.vobjIndex}"]`);
                        if (element) {
                            element.style.left = initialPos.left + 'px';
                            element.style.top = initialPos.top + 'px';
                            element.style.visibility = 'visible';
                        }
                    });
                    logger.debug('[VirtualObjectList] ドロップキャンセル: 複数仮身を元の位置に戻しました:', this.vobjDragState.selectedObjects.length, '個');
                } else {
                    vobjElement.style.left = this.vobjDragState.initialLeft + 'px';
                    vobjElement.style.top = this.vobjDragState.initialTop + 'px';
                    vobjElement.style.visibility = 'visible';
                }

                // PluginBase共通メソッドでドラッグ状態をクリーンアップ
                this.cleanupVirtualObjectDragState();

                // ダブルクリックドラッグ状態もクリーンアップ（意図しない複製を防止）
                this.cleanupDblClickDragState();
                this.dblClickDragState.lastClickedShape = null;

                // プラグイン固有のステートをクリア
                this.vobjDragState.currentObject = null;
                this.vobjDragState.currentElement = null;
                this.vobjDragState.vobjIndex = null;
                this.vobjDragState.selectedObjects = null;
                this.vobjDragState.selectedObjectsInitialPositions = null;
                this.vobjDragState.dropClientX = undefined;
                this.vobjDragState.dropClientY = undefined;
                this.vobjDragState.lastMouseOverWindowId = null;
            } else {
                // drop成功（dropイベントで処理済み）
                // 50ms待ってから finishDrag() を実行（cross-window-drop-in-progress メッセージを受信する時間を確保）
                logger.debug('[VirtualObjectList] drop成功: 50ms待機してからfinishDrag()実行');
                setTimeout(() => {
                    if (this.lastDropWasCrossWindow) {
                        logger.debug('[VirtualObjectList] クロスウィンドウドロップ検知: finishDrag()をスキップ');
                        // PluginBase共通メソッドでドラッグ状態をクリーンアップ
                        this.cleanupVirtualObjectDragState();

                        // ダブルクリックドラッグ状態もクリーンアップ（意図しない複製を防止）
                        this.cleanupDblClickDragState();
                        this.dblClickDragState.lastClickedShape = null;

                        // プラグイン固有のステートをクリア
                        this.vobjDragState.currentObject = null;
                        this.vobjDragState.currentElement = null;
                        this.vobjDragState.vobjIndex = null;
                        this.vobjDragState.selectedObjects = null;
                        this.vobjDragState.selectedObjectsInitialPositions = null;
                        this.virtualObjectDragState.dragMode = null;
                        this.vobjDragState.dropClientX = undefined;
                        this.vobjDragState.dropClientY = undefined;
                        this.vobjDragState.lastMouseOverWindowId = null;
                        // フラグをリセット
                        this.lastDropWasCrossWindow = false;
                    } else {
                        // 同じウィンドウ内の移動
                        logger.debug('[VirtualObjectList] 同じウィンドウ内のドロップ: finishDrag()を実行');
                        this.finishDrag();
                    }
                }, 50);
            }
        });

        // 右クリックでコピーモードに切り替え
        vobjElement.addEventListener('contextmenu', (e) => {
            // 右クリックメニューは表示させたいので、ドラッグモードの切り替えのみ行う
            // ここでは何もしない（setupContextMenuで処理）
        });

        // マウスダウン時にモードを設定してドラッグ開始
        // capturing phaseで登録することで、iframe上のmousedownも確実にキャプチャ
        vobjElement.addEventListener('mousedown', (e) => {
            // ダブルクリック+ドラッグ判定
            const now = Date.now();
            const timeSinceLastClick = now - this.dblClickDragState.lastClickTime;
            const isSameObject = this.dblClickDragState.lastClickedObject === obj;

            // 前回のクリックから300ms以内かつ同じオブジェクトの場合、ダブルクリック+ドラッグ候補
            if (timeSinceLastClick < 300 && isSameObject && e.button === 0) {
                logger.debug('[VirtualObjectList] ダブルクリック+ドラッグ候補を検出:', obj.link_name);
                this.setDoubleClickDragCandidate(vobjElement, e);  // 共通メソッド使用
                // プラグイン固有のプロパティ設定
                this.dblClickDragState.dblClickedObject = obj;
            } else {
                // 通常のクリック：時刻とオブジェクトを記録
                this.resetDoubleClickTimer();  // 共通メソッド使用
                // プラグイン固有のプロパティ設定
                this.dblClickDragState.lastClickedObject = obj;
            }

            // コンテキストメニューを閉じた直後はドラッグを無効化
            if (this.justClosedContextMenu) {
                logger.debug('[VirtualObjectList] コンテキストメニュー直後のためドラッグをスキップ');
                return;
            }

            // 読み取り専用モードの場合はドラッグを無効化
            if (this.isReadonly) {
                return;
            }

            // 保護チェック：固定化または背景化されている場合はドラッグを無効化
            if (obj.isFixed || obj.isBackground) {
                logger.debug('[VirtualObjectList] 保護されているため移動できません:', obj.link_name,
                    obj.isFixed ? '固定化' : '', obj.isBackground ? '背景化' : '');
                return;
            }

            // リサイズエリア（枠の内側10pxから外側10pxまで）かどうかをチェック
            const rect = vobjElement.getBoundingClientRect();
            const isRightEdge = e.clientX > rect.right - 10 && e.clientX <= rect.right + 10;
            const isBottomEdge = e.clientY > rect.bottom - 10 && e.clientY <= rect.bottom + 10;

            // リサイズエリアの場合はドラッグ処理をスキップ
            if (isRightEdge || isBottomEdge) {
                return;
            }

            // 左クリックのみ処理、右クリックと中クリックは無視（右クリックはコンテキストメニュー用）
            if (e.button !== 0) {
                return;
            }

            // mousedown時点で即座に全iframeを無効化（iframe上でもドラッグ開始可能に）
            this.setIframesPointerEvents(false);
            logger.debug('[VirtualObjectList] mousedown: iframeを無効化（ドラッグ準備）');

            // ドラッグ準備（dragstartの前提条件を設定）
            this.vobjDragState.currentObject = obj;
            this.vobjDragState.currentElement = vobjElement;
            this.vobjDragState.vobjIndex = parseInt(vobjElement.getAttribute('data-vobj-index')); // 一意のインデックスを保存
            this.vobjDragState.initialLeft = obj.vobjleft;
            this.vobjDragState.initialTop = obj.vobjtop;
            // 詳細な初期化（dragMode, hasMoved, isDragging, startX/Y）はdragstartで実行

            // ドラッグした仮身が選択されている場合、選択中の全仮身を記録
            const draggedVobjIndex = this.virtualObjects.indexOf(obj);
            if (this.selectedVirtualObjects.has(draggedVobjIndex)) {
                this.vobjDragState.selectedObjects = Array.from(this.selectedVirtualObjects).map(vobjIndex => {
                    const vobj = this.virtualObjects[vobjIndex];
                    if (vobj) {
                        return {
                            obj: vobj,
                            vobjIndex: vobjIndex
                        };
                    }
                    return null;
                }).filter(v => v !== null);

                this.vobjDragState.selectedObjectsInitialPositions = this.vobjDragState.selectedObjects.map(v => ({
                    left: v.obj.vobjleft,
                    top: v.obj.vobjtop
                }));

                logger.debug('[VirtualObjectList] mousedown: 複数選択ドラッグ準備完了', this.vobjDragState.selectedObjects.length, '個の仮身');
            } else {
                // ドラッグする仮身が未選択の場合、まず選択状態にする
                logger.debug('[VirtualObjectList] mousedown: 未選択の仮身をドラッグ開始 → まず選択');
                this.selectVirtualObject(obj, vobjElement, e);

                // mousedownで選択した直後にclickイベントが発火するのを防ぐフラグ
                this.justSelectedInMouseDown = true;

                // 選択後、複数選択ドラッグと同じロジックで処理（選択枠もプレビュー移動するため）
                this.vobjDragState.selectedObjects = Array.from(this.selectedVirtualObjects).map(vobjIndex => {
                    const vobj = this.virtualObjects[vobjIndex];
                    if (vobj) {
                        return {
                            obj: vobj,
                            vobjIndex: vobjIndex
                        };
                    }
                    return null;
                }).filter(v => v !== null);

                this.vobjDragState.selectedObjectsInitialPositions = this.vobjDragState.selectedObjects.map(v => ({
                    left: v.obj.vobjleft,
                    top: v.obj.vobjtop
                }));

                logger.debug('[VirtualObjectList] mousedown: ドラッグ準備完了 isDragging=true 選択数:', this.vobjDragState.selectedObjects.length, obj.link_name);
            }
        }, { capture: true });
    }

    /**
     * 仮身要素をリサイズ可能にする
     * @param {HTMLElement} vobjElement - 仮身のDOM要素
     * @param {Object} obj - 仮身オブジェクト
     */
    makeVirtualObjectResizable(vobjElement, obj) {
        // マウス移動でカーソルを変更（リサイズエリアの表示）
        vobjElement.addEventListener('mousemove', (e) => {
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
            vobjElement.style.cursor = 'pointer';
        });

        // マウスダウンでリサイズ開始
        vobjElement.addEventListener('mousedown', (e) => {
            // 読み取り専用モードの場合はリサイズを無効化
            if (this.isReadonly) {
                return;
            }

            // 保護チェック：固定化または背景化されている場合はリサイズを無効化
            if (obj.isFixed || obj.isBackground) {
                logger.debug('[VirtualObjectList] 保護されているためリサイズできません:', obj.link_name,
                    obj.isFixed ? '固定化' : '', obj.isBackground ? '背景化' : '');
                return;
            }

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
                logger.debug('[VirtualObjectList] リサイズ中のため、新しいリサイズを無視');
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

            // chszベースの最小高さを計算
            const chsz = Math.round(obj.chsz || 14); // 浮動小数点誤差を防ぐ
            const lineHeight = 1.2;
            const chszPx = window.convertPtToPx(chsz);
            const textHeight = Math.ceil(chszPx * lineHeight);
            const minClosedHeight = textHeight + 8; // 閉じた仮身の最小高さ = タイトルエリアの高さ
            const minOpenHeight = textHeight + 30; // 開いた仮身の最小高さ（閾値）= タイトルバー(textHeight+8) + 区切り線(2) + コンテンツ最小(20)

            // DOMから実際のコンテンツエリアの有無で開閉状態を判定
            const hasContentArea = vobjElement.querySelector('.virtual-object-content-area') !== null ||
                                  vobjElement.querySelector('.virtual-object-content-iframe') !== null;

            // リサイズ中は閉じた仮身の最小高さまで小さくできるようにする
            const minHeight = minClosedHeight;

            // 初期高さを閾値に基づいて設定
            let currentWidth = startWidth;
            let currentHeight;
            if (startHeight < minOpenHeight) {
                // 閾値未満の場合は、閉じた仮身の高さ
                currentHeight = minClosedHeight;
            } else {
                // 閾値以上の場合は、現在の高さ
                currentHeight = startHeight;
            }

            logger.debug('[VirtualObjectList] 仮身リサイズ開始:', obj.link_name, 'startWidth:', startWidth, 'startHeight:', startHeight, 'currentHeight:', currentHeight, 'hasContentArea:', hasContentArea, 'chsz:', chsz, 'minClosedHeight:', minClosedHeight, 'minOpenHeight:', minOpenHeight);

            // リサイズプレビュー枠を作成
            const previewBox = document.createElement('div');
            previewBox.style.position = 'fixed'; // キャンバス外でも表示されるようにfixedを使用

            // 既に取得済みのrectを使用（3827行目で宣言済み）
            previewBox.style.left = `${rect.left}px`;
            previewBox.style.top = `${rect.top}px`;
            previewBox.style.width = `${currentWidth}px`;
            previewBox.style.height = `${currentHeight}px`;
            previewBox.style.border = '2px dashed rgba(0, 123, 255, 0.8)';
            previewBox.style.backgroundColor = 'rgba(0, 123, 255, 0.1)';
            previewBox.style.pointerEvents = 'none';
            previewBox.style.zIndex = '999999'; // さらに高いz-indexを使用
            previewBox.style.boxSizing = 'border-box';

            // document.bodyに直接追加（iframe上でも表示される）
            document.body.appendChild(previewBox);

            // 開いた仮身内のiframeのpointer-eventsを無効化（リサイズ中にマウスイベントを親に伝播させる）
            const iframe = vobjElement.querySelector('iframe');
            if (iframe) {
                iframe.style.pointerEvents = 'none';
            }

            let lastMoveEvent = null; // 最後のマウス移動イベントを保存

            const onMouseMove = (moveEvent) => {
                lastMoveEvent = moveEvent; // 最後のイベントを保存

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
                        // 閾値未満の場合は、閉じた仮身の高さに固定
                        currentHeight = minClosedHeight;
                    } else {
                        // 閾値以上の場合は、開いた仮身の高さとして自由に変更可能
                        currentHeight = newHeight;
                    }

                    previewBox.style.height = `${currentHeight}px`;
                }
            };

            // スロットルなしでプレビュー枠を更新（リアルタイム）
            const throttledMouseMove = onMouseMove;

            const onMouseUp = () => {
                document.removeEventListener('mousemove', throttledMouseMove);
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

                // 最終的なサイズを取得（プレビュー枠のサイズを使用）
                const finalWidth = Math.round(currentWidth);
                const finalHeight = Math.round(currentHeight);

                // 実際の要素のサイズを更新
                vobjElement.style.width = `${finalWidth}px`;
                vobjElement.style.height = `${finalHeight}px`;

                // 元のサイズを保存（幅のみ使用）
                const oldWidth = obj.width;

                // 仮身オブジェクトのサイズを更新
                obj.width = finalWidth;
                obj.heightPx = finalHeight;
                obj.vobjright = obj.vobjleft + finalWidth;
                obj.vobjbottom = obj.vobjtop + finalHeight;

                logger.debug('[VirtualObjectList] 仮身リサイズ終了:', obj.link_name, 'newWidth:', finalWidth, 'newHeight:', finalHeight);

                // XMLを更新
                this.updateVirtualObjectInXml(obj);

                // 開いた仮身と閉じた仮身の判定が変わったかチェック
                const chsz_resize = Math.round(obj.chsz || 14); // 浮動小数点誤差を防ぐ
                const lineHeight_resize = 1.2;
                const chszPx_resize = window.convertPtToPx(chsz_resize);
                const textHeight_resize = Math.ceil(chszPx_resize * lineHeight_resize);
                const minClosedHeight_resize = textHeight_resize + 8; // 閉じた仮身の高さ
                const minOpenHeight_resize = textHeight_resize + 30; // タイトルバー(textHeight+8) + 区切り線(2) + コンテンツ最小(20)
                const wasOpen = hasContentArea; // DOMベースの判定を使用
                const isNowOpen = finalHeight >= minOpenHeight_resize;

                if (wasOpen !== isNowOpen) {
                    // 判定が変わった場合は、少し待ってから仮身要素を再作成
                    logger.debug('[VirtualObjectList] 開いた仮身/閉じた仮身の判定が変わりました。少し待ってから再作成します。');

                    // 既存のタイマーをクリア（連続したリサイズで最後の一回だけ実行）
                    if (this.recreateVirtualObjectTimer) {
                        clearTimeout(this.recreateVirtualObjectTimer);
                    }

                    // 新しく開いた状態になった場合、opened プロパティを明示的に設定
                    if (isNowOpen) {
                        obj.opened = true;
                    } else {
                        // 閉じた仮身に変わる場合は、高さを閉じた仮身の高さに設定
                        obj.opened = false;
                        obj.heightPx = minClosedHeight_resize;
                        obj.vobjbottom = obj.vobjtop + minClosedHeight_resize;
                        vobjElement.style.height = `${minClosedHeight_resize}px`;
                        logger.debug('[VirtualObjectList] 閉じた仮身に変更、高さを調整:', minClosedHeight_resize);
                        // XMLを再更新
                        this.updateVirtualObjectInXml(obj);
                    }

                    // 遅延して再作成（150ms後）
                    // 要素への参照をクロージャでキャプチャ
                    const elementToReplace = vobjElement;
                    this.recreateVirtualObjectTimer = setTimeout(() => {
                        logger.debug('[VirtualObjectList] 仮身を再作成します。');

                        // 要素がまだDOMに存在するかチェック
                        if (!elementToReplace.parentNode) {
                            logger.warn('[VirtualObjectList] 再作成対象の仮身要素がDOMから削除されています');
                            this.recreateVirtualObjectTimer = null;
                            return;
                        }

                        // 既存のiframeを保存（再利用のため）
                        const existingIframe = elementToReplace.querySelector('iframe');

                        const newElement = this.createVirtualObjectElement(obj);
                        elementToReplace.replaceWith(newElement);

                        // 新しく開いた状態になった場合、コンテンツを展開
                        if (isNowOpen) {
                            // 既存のiframeがあれば再利用
                            if (existingIframe && existingIframe.contentWindow) {
                                logger.debug('[VirtualObjectList] 既存のiframeを再利用します:', obj.link_name);
                                const contentArea = newElement.querySelector('.virtual-object-content-area');
                                if (contentArea) {
                                    contentArea.appendChild(existingIframe);
                                    logger.debug('[VirtualObjectList] iframeを新しい要素に移動しました');
                                } else {
                                    logger.warn('[VirtualObjectList] コンテンツエリアが見つかりません、通常展開します');
                                    this.expandVirtualObject(newElement, obj, {
                                        readonly: true,
                                        noScrollbar: true,
                                        bgcol: obj.bgcol
                                    }).catch(err => {
                                        logger.error('[VirtualObjectList] 展開エラー:', err);
                                    });
                                }
                            } else {
                                // 既存のiframeがない場合は新規展開
                                logger.debug('[VirtualObjectList] 新規展開します:', obj.link_name);
                                this.expandVirtualObject(newElement, obj, {
                                    readonly: true,
                                    noScrollbar: true,
                                    bgcol: obj.bgcol
                                }).catch(err => {
                                    logger.error('[VirtualObjectList] 展開エラー:', err);
                                });
                            }
                        }

                        this.recreateVirtualObjectTimer = null;
                    }, 150);
                }

                // キャンバスサイズを更新
                this.updateCanvasSize();

                // ウィンドウのリサイズハンドルを再有効化
                    this.messageBus.send('enable-window-resize');

                // リサイズ終了フラグをリセット
                this.isResizing = false;

                // 開いた仮身のiframeは常に無効化されたままにするため、再有効化しない
                // this.setIframesPointerEvents(true);
            };

            document.addEventListener('mousemove', throttledMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    }

    /**
     * 仮身位置の変更をxmlTADに反映
     * @param {Object} obj - 仮身オブジェクト
     */
    updateVirtualObjectPosition(obj) {
        if (!this.xmlData) {
            logger.warn('[VirtualObjectList] xmlDataがありません');
            return;
        }

        try {
            // XMLDocumentとして解析
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(this.xmlData, 'text/xml');

            // 対象の<link>要素を検索
            // 同じlink_idを持つ仮身が複数ある場合、元の位置情報で識別
            const links = xmlDoc.querySelectorAll('link');
            let targetLink = null;

            for (const link of links) {
                const linkId = link.getAttribute('id');
                const linkLeft = parseInt(link.getAttribute('vobjleft')) || 0;
                const linkTop = parseInt(link.getAttribute('vobjtop')) || 0;
                const linkRight = parseInt(link.getAttribute('vobjright')) || 0;
                const linkBottom = parseInt(link.getAttribute('vobjbottom')) || 0;

                // link_idと元の位置が一致する<link>を検索
                if (linkId === obj.link_id &&
                    linkLeft === obj.originalLeft &&
                    linkTop === obj.originalTop &&
                    linkRight === obj.originalRight &&
                    linkBottom === obj.originalBottom) {
                    targetLink = link;
                    logger.debug('[VirtualObjectList] link要素を発見:', obj.link_id, '元の位置:', obj.originalLeft, obj.originalTop);
                    break;
                }
            }

            if (!targetLink) {
                logger.warn('[VirtualObjectList] link要素が見つかりません:', obj.link_id, '元の位置:', obj.originalLeft, obj.originalTop);
                return;
            }

            // 座標属性を更新
            targetLink.setAttribute('vobjleft', obj.vobjleft.toString());
            targetLink.setAttribute('vobjtop', obj.vobjtop.toString());
            targetLink.setAttribute('vobjright', obj.vobjright.toString());
            targetLink.setAttribute('vobjbottom', obj.vobjbottom.toString());

            // 元の位置情報を更新（次回の移動時に正しく識別できるように）
            obj.originalLeft = obj.vobjleft;
            obj.originalTop = obj.vobjtop;
            obj.originalRight = obj.vobjright;
            obj.originalBottom = obj.vobjbottom;

            // XMLを文字列に戻す
            const serializer = new XMLSerializer();
            this.xmlData = serializer.serializeToString(xmlDoc);

            logger.debug('[VirtualObjectList] xmlTAD更新完了:', obj.link_id, '新しい位置:', obj.vobjleft, obj.vobjtop);

            // 自動保存
            this.notifyXmlDataChanged();

            // スクロールバー更新を通知（MessageBus経由）
            this.notifyScrollChange();

        } catch (error) {
            logger.error('[VirtualObjectList] xmlTAD更新エラー:', error);
        }
    }

    /**
     * キャンバスサイズを仮身の位置に合わせて更新
     */
    updateCanvasSize() {
        const canvas = document.querySelector('.virtual-canvas');
        if (!canvas) {
            logger.warn('[VirtualObjectList] キャンバス要素が見つかりません');
            return;
        }

        // 全ての仮身の最大位置を計算（virtualObjects配列から）
        let maxRight = 0;
        let maxBottom = 0;

        logger.debug('[VirtualObjectList] 仮身数:', this.virtualObjects.length);

        this.virtualObjects.forEach((obj, index) => {
            const right = obj.vobjright || (obj.vobjleft + (obj.width || 100));
            const bottom = obj.vobjbottom || (obj.vobjtop + (obj.heightPx || 100));

            logger.debug(`[VirtualObjectList] 仮身${index} (${obj.link_name}): left=${obj.vobjleft}, top=${obj.vobjtop}, right=${right}, bottom=${bottom}`);

            maxRight = Math.max(maxRight, right);
            maxBottom = Math.max(maxBottom, bottom);
        });

        // マージンを追加
        maxRight += 50;
        maxBottom += 50;

        // .plugin-contentの現在のサイズ（ウィンドウの表示域）を取得
        const pluginContent = document.querySelector('.plugin-content');
        const windowWidth = pluginContent ? pluginContent.clientWidth : 300;
        const windowHeight = pluginContent ? pluginContent.clientHeight : 200;

        // コンテンツサイズとウィンドウサイズの大きい方を採用
        const finalWidth = Math.max(maxRight, windowWidth, 300);  // 最小300px
        const finalHeight = Math.max(maxBottom, windowHeight, 200); // 最小200px

        // キャンバスのwidthとheightを設定（灰色の領域を防ぐ）
        canvas.style.width = finalWidth + 'px';
        canvas.style.height = finalHeight + 'px';

        logger.debug('[VirtualObjectList] キャンバスサイズ更新:', finalWidth, 'x', finalHeight, '(コンテンツ:', maxRight, 'x', maxBottom, ', ウィンドウ:', windowWidth, 'x', windowHeight, ')');

        // スクロールバー更新を通知（MessageBus経由）
        this.notifyScrollChange();
    }

    /**
     * 全画面表示オフ時にキャンバスサイズを縮小（必要に応じて）
     * コンテンツがウィンドウサイズより小さければ、ウィンドウサイズに合わせる
     */
    shrinkCanvasIfNeeded() {
        const canvas = document.querySelector('.virtual-canvas');
        if (!canvas) {
            logger.warn('[VirtualObjectList] キャンバス要素が見つかりません');
            return;
        }

        // 全ての仮身の最大位置を計算
        let maxRight = 0;
        let maxBottom = 0;

        this.virtualObjects.forEach((obj) => {
            const right = obj.vobjright || (obj.vobjleft + (obj.width || 100));
            const bottom = obj.vobjbottom || (obj.vobjtop + (obj.heightPx || 100));

            maxRight = Math.max(maxRight, right);
            maxBottom = Math.max(maxBottom, bottom);
        });

        // マージンを追加
        maxRight += 50;
        maxBottom += 50;

        // .plugin-contentの現在のサイズ（ウィンドウの表示域）を取得
        const pluginContent = document.querySelector('.plugin-content');
        const windowWidth = pluginContent ? pluginContent.clientWidth : 300;
        const windowHeight = pluginContent ? pluginContent.clientHeight : 200;

        logger.debug('[VirtualObjectList] shrinkCanvasIfNeeded - コンテンツ:', maxRight, 'x', maxBottom, ', ウィンドウ:', windowWidth, 'x', windowHeight);

        // コンテンツがウィンドウより小さければウィンドウサイズに縮小、大きければコンテンツサイズを維持
        const finalWidth = Math.max(maxRight, windowWidth);
        const finalHeight = Math.max(maxBottom, windowHeight);

        // キャンバスのwidthとheightを設定
        canvas.style.width = finalWidth + 'px';
        canvas.style.height = finalHeight + 'px';

        logger.debug('[VirtualObjectList] キャンバスサイズ調整完了:', finalWidth, 'x', finalHeight);

        // スクロールバー更新を通知（MessageBus経由）
        this.notifyScrollChange();
    }

    /**
     * autoopen属性がtrueの仮身を自動的に開く
     */
    async autoOpenVirtualObjects() {
        logger.debug('[VirtualObjectList] 自動起動処理開始, 仮身数:', this.virtualObjects.length);

        for (const virtualObj of this.virtualObjects) {
            if (virtualObj.autoopen === 'true') {
                logger.debug('[VirtualObjectList] 自動起動する仮身:', virtualObj.link_id);

                try {
                    // applistを確認
                    const applist = virtualObj.applist;
                    if (!applist || typeof applist !== 'object') {
                        logger.warn('[VirtualObjectList] applistが存在しません:', virtualObj.link_id);
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
                        logger.warn('[VirtualObjectList] 開くためのプラグインが見つかりません:', virtualObj.link_id);
                        continue;
                    }

                    logger.debug('[VirtualObjectList] プラグインを決定:', defaultPluginId);

                    // 選択中の仮身を一時的に設定
                    const previousSelection = new Set(this.selectedVirtualObjects);
                    this.selectedVirtualObjects.clear();
                    const vobjIndex = this.virtualObjects.indexOf(virtualObj);
                    this.selectedVirtualObjects.add(vobjIndex);

                    logger.debug('[VirtualObjectList] 仮身を開く処理を開始:', virtualObj.link_id);

                    // 実身を開く
                    await this.executeVirtualObjectWithPlugin(defaultPluginId);

                    // 選択を元に戻す
                    this.selectedVirtualObjects = previousSelection;

                    logger.debug('[VirtualObjectList] 自動起動完了:', virtualObj.link_id, 'with', defaultPluginId);
                } catch (error) {
                    logger.error('[VirtualObjectList] 自動起動エラー:', virtualObj.link_id, error);
                    // エラーが発生しても次の仮身の起動を続行
                }
            }
        }

        logger.debug('[VirtualObjectList] 自動起動処理完了');
    }

    /**
     * xmlTADの変更を親ウィンドウに通知してファイル保存を促す
     */
    notifyXmlDataChanged() {
        // 自動保存時にスクロール位置も保存
        this.saveScrollPosition();

        this.messageBus.send('xml-data-changed', {
            fileId: this.realId,
            xmlData: this.xmlData
        });

        logger.debug('[VirtualObjectList] xmlTAD変更を通知, realId:', this.realId);
    }

    // updateWindowConfig() は基底クラス PluginBase で定義

    /**
     * デバッグログ出力（デバッグモード時のみ）
     */
    log(...args) {
        if (this.debug) {
            logger.debug('[VirtualObjectList]', ...args);
        }
    }

    /**
     * エラーログ出力（常に出力）
     */
    error(...args) {
        logger.error('[VirtualObjectList]', ...args);
    }

    /**
     * 警告ログ出力（常に出力）
     */
    warn(...args) {
        logger.warn('[VirtualObjectList]', ...args);
    }

    // ========================================
    // PluginBase フックメソッド実装
    // ========================================

    /**
     * ドラッグモード変更時のフック（PluginBaseから呼び出される）
     * @param {string} newMode - 新しいドラッグモード ('move' | 'copy')
     */
    onDragModeChanged(newMode) {
        logger.debug('[VirtualObjectList] ドラッグモード変更:', newMode);
        // virtual-object-listでは特別な処理は不要
    }

    /**
     * クロスウィンドウドロップ成功時に元の仮身を削除（PluginBaseから呼び出される）
     * @param {Object} data - ドロップデータ
     */
    onDeleteSourceVirtualObject(data) {
        logger.debug('[VirtualObjectList] [Hook] onDeleteSourceVirtualObject:', data);

        if (data.virtualObjects) {
            logger.debug('[VirtualObjectList] クロスウィンドウmove: 元ウィンドウから仮身を削除', data.virtualObjects.length, '個');

            data.virtualObjects.forEach(vobj => {
                let index = -1;

                // originalVobjLeft/Topがある場合は、位置情報も使って厳密に特定
                if (vobj.originalVobjLeft !== undefined && vobj.originalVobjTop !== undefined) {
                    index = this.virtualObjects.findIndex(v =>
                        v.link_id === vobj.link_id &&
                        v.vobjleft === vobj.originalVobjLeft &&
                        v.vobjtop === vobj.originalVobjTop
                    );
                    logger.debug('[VirtualObjectList] 位置情報を使って検索:', vobj.link_name, '位置:', vobj.originalVobjLeft, vobj.originalVobjTop, 'index:', index);
                } else {
                    // originalVobjLeft/Topがない場合（基本文章編集プラグインなどから）は、link_idのみで検索
                    // 同じlink_idの仮身が複数ある場合は最初の一つを削除
                    index = this.virtualObjects.findIndex(v => v.link_id === vobj.link_id);
                    logger.debug('[VirtualObjectList] link_idのみで検索:', vobj.link_name, 'index:', index);
                }

                if (index !== -1) {
                    logger.debug('[VirtualObjectList] 仮身を削除:', vobj.link_name, 'index:', index);
                    // XMLから削除（配列から削除する前にインデックスを渡す）
                    this.removeVirtualObjectFromXml(vobj, index);
                    // 配列から削除
                    this.virtualObjects.splice(index, 1);
                } else {
                    logger.warn('[VirtualObjectList] 削除対象の仮身が見つかりません:', vobj.link_name);
                }
            });

            this.renderVirtualObjects();
            this.saveToFile();
        }
    }

    /**
     * クロスウィンドウドロップ成功後のクリーンアップ（PluginBaseから呼び出される）
     * @param {Object} data - ドロップデータ
     */
    onCrossWindowDropSuccess(data) {
        logger.debug('[VirtualObjectList] [Hook] onCrossWindowDropSuccess:', data);

        // ドラッグモードはcleanupVirtualObjectDragState()で既にリセット済み
        // isRightButtonPressedはPluginBaseで管理
    }

}



// DOMContentLoaded後に初期化
document.addEventListener('DOMContentLoaded', () => {
    window.virtualObjectListApp = new VirtualObjectListApp();

    // ウインドウリサイズ時にキャンバスサイズを更新
    window.addEventListener('resize', () => {
        if (window.virtualObjectListApp) {
            window.virtualObjectListApp.updateCanvasSize();
        }
    });

    // マウスホイールでのスクロールを処理
    const pluginContent = document.querySelector('.plugin-content');
    if (pluginContent) {
        pluginContent.addEventListener('wheel', (e) => {
            logger.debug('[VirtualObjectList] wheel イベント:', e.deltaX, e.deltaY, e.shiftKey);

            // 明示的にスクロール位置を更新
            if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
                // 横スクロール（Shift+ホイールまたは横ホイール）
                pluginContent.scrollLeft += e.deltaX || e.deltaY;
            } else {
                // 縦スクロール
                pluginContent.scrollTop += e.deltaY;
            }

            e.preventDefault();
        });
    }
});
