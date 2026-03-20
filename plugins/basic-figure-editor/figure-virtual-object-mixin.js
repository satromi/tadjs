/**
 * FigureVirtualObjectMixin - 仮身（Virtual Object）関連機能
 *
 * 仮身の配置・表示・操作・リサイズ・展開・折りたたみ・
 * ドラッグ＆ドロップ・複製・削除・属性変更・続柄設定などを担当するMixin。
 *
 * 提供メソッド:
 * - insertVirtualObject(x, y, virtualObject, dragData) - 仮身を配置
 * - addVirtualObjectFromRealId(realId, name, dropPosition, applist) - 原紙箱から仮身を追加
 * - closeVirtualObject() - 仮身の実身を閉じる
 * - executeVirtualObjectWithPlugin(pluginId) - 指定プラグインで実身を開く
 * - openRealObjectWithDefaultApp() - デフォルトアプリで実身を開く
 * - applyVirtualObjectAttributes(attrs) - 仮身に属性を適用
 * - changeVirtualObjectAttributes() - 仮身属性変更ダイアログを表示
 * - setRelationship() - 続柄設定
 * - saveVirtualObjectRelationshipToXml(virtualObj) - 仮身の続柄をXMLに保存
 * - onRelationshipUpdated(virtualObj, result) - 続柄更新後の再描画
 * - getAllVirtualObjects() - プラグイン内の全仮身を取得
 * - updateVirtualObjectDisplay(item) - 仮身の表示を更新
 * - expandVirtualObject(vobjElement, shape, options) - 開いた仮身の展開
 * - getDefaultOpenPlugin(virtualObject) - defaultOpenプラグインを取得
 * - updateExpandedVirtualObjectSize(shape, width, height) - 開いた仮身のサイズを更新
 * - collapseVirtualObject(shape) - 仮身を通常表示に戻す
 * - preloadVirtualObjectIcons() - すべての仮身のアイコンを事前読み込み
 * - renderVirtualObjectsAsElements() - 仮身をDOM要素として描画
 * - renderVirtualObjectElement(shape) - 個別の仮身をDOM要素として描画
 * - makeVirtualObjectResizable(vobjElement, shape) - 仮身要素をリサイズ可能にする
 * - openVirtualObject(shape) - 仮身を開く
 * - handleDoubleClickDragDuplicate(shape, targetX, targetY) - ダブルクリック+ドラッグによる実身複製
 * - onDeleteSourceVirtualObject(data) - 元の仮身オブジェクトを削除するフック
 * - loadVirtualObjectMetadata(virtualObj) - 仮身のメタデータ（applist等）をJSONファイルから読み込む
 * - onCrossWindowDropSuccess(data) - cross-window-drop-success処理完了後のフック
 */

const logger = window.getLogger('BasicFigureEditor');

export const FigureVirtualObjectMixin = (Base) => class extends Base {

    async insertVirtualObject(x, y, virtualObject, dragData = null) {
        logger.debug('[FIGURE EDITOR] 仮身を配置:', virtualObject.link_name, 'at', x, y);
        // dragDataがある場合はそのmodeを優先、なければローカル状態を使用
        const effectiveMode = dragData?.mode || this.virtualObjectDragState.dragMode;
        // 同一ウィンドウ判定: isDraggingVirtualObjectShapeまたはdragDataのsourceWindowId
        const isSameWindowDrag = this.isDraggingVirtualObjectShape ||
            (dragData && dragData.sourceWindowId === this.windowId);
        logger.debug('[FIGURE EDITOR] ドラッグ状態チェック: isDraggingVirtualObjectShape=', this.isDraggingVirtualObjectShape, 'draggingVirtualObjectShape=', this.draggingVirtualObjectShape ? this.draggingVirtualObjectShape.virtualObject.link_name : 'null', 'effectiveMode=', effectiveMode, 'isSameWindowDrag=', isSameWindowDrag);

        // 同じウィンドウ内での移動かチェック
        // draggingVirtualObjectShapeがnullでも、link_idから既存shapeを探して移動処理を行う
        let oldShape = this.draggingVirtualObjectShape;
        if (isSameWindowDrag && !oldShape && virtualObject.link_id) {
            // link_idから既存のshapeを探す
            oldShape = this.shapes.find(s =>
                s.type === 'vobj' &&
                s.virtualObject &&
                s.virtualObject.link_id === virtualObject.link_id
            );
            if (oldShape) {
                logger.debug('[FIGURE EDITOR] draggingVirtualObjectShapeがnull、link_idから既存shapeを発見:', virtualObject.link_name);
            }
        }

        if (isSameWindowDrag && oldShape) {
            logger.debug('[FIGURE EDITOR] 同じウィンドウ内での仮身ドラッグを検出（モード:', effectiveMode, '）');

            // 移動モードの場合のみ移動、コピーモード（左クリック+右クリック）では仮身コピーを作成
            const shouldMove = effectiveMode === 'move';

            // 移動モードの場合、既存のshapeの座標のみ更新（新しいshapeは作成しない）
            if (shouldMove) {
                logger.debug('[FIGURE EDITOR] 移動モード（shouldMove=true）: 既存shapeの座標を更新');

                // Undo用に状態を保存
                this.saveStateForUndo();

                // 幅と高さは既存のshapeから取得（サイズを保持）
                const width = oldShape.endX - oldShape.startX;
                const height = oldShape.endY - oldShape.startY;
                logger.debug('[FIGURE EDITOR] 既存のshapeサイズを使用: width=', width, 'height=', height);

                // 既存のshapeの座標を更新
                oldShape.startX = x;
                oldShape.startY = y;
                oldShape.endX = x + width;
                oldShape.endY = y + height;

                // 接続されている線の端点を更新
                const connections = this.getConnectedLines(oldShape);
                if (connections.length > 0) {
                    logger.debug('[FIGURE EDITOR] 接続線を', connections.length, '本検出、端点を更新');

                    connections.forEach(conn => {
                        // コネクタポイントを取得
                        const connectorPoints = this.getConnectorPoints(oldShape);
                        const connectorPoint = connectorPoints.find(p => p.index === conn.connectorIndex);

                        if (connectorPoint) {
                            // 線の端点座標を更新
                            if (conn.endpoint === 'start') {
                                conn.line.startX = connectorPoint.x;
                                conn.line.startY = connectorPoint.y;
                                logger.debug('[FIGURE EDITOR] 線の始点を更新:', connectorPoint.x, connectorPoint.y);
                            } else {
                                conn.line.endX = connectorPoint.x;
                                conn.line.endY = connectorPoint.y;
                                logger.debug('[FIGURE EDITOR] 線の終点を更新:', connectorPoint.x, connectorPoint.y);
                            }
                        }
                    });
                }

                // cross-window-drop-successで削除されないようにフラグをクリア
                this.isDraggingVirtualObjectShape = false;
                this.draggingVirtualObjectShape = null;

                this.isModified = true;
                this.setStatus(`仮身「${virtualObject.link_name}」を移動しました`);
                // resizeCanvas()がredraw()を呼ぶので、ここでは呼ばない
                this.resizeCanvas();
                return;
            }
        }

        // 通常の仮身配置（新規追加、またはコピーモード）
        // Undo用に状態を保存
        this.saveStateForUndo();

        // 幅と高さを決定（virtualObjectに含まれていればそれを使用、なければデフォルト値を計算）
        let width, height;

        if (virtualObject.width && virtualObject.heightPx) {
            // リサイズされた値がある場合はそれを使用
            width = virtualObject.width;
            height = virtualObject.heightPx;
        } else {
            // デフォルト値を計算
            const chsz = virtualObject.chsz || DEFAULT_FONT_SIZE;
            const chszPx = window.convertPtToPx(chsz);
            const lineHeight = DEFAULT_LINE_HEIGHT;
            const textHeight = Math.ceil(chszPx * lineHeight);
            width = 100;
            height = textHeight + VOBJ_PADDING_VERTICAL; // 閉じた仮身の高さ
        }

        // 仮身を図形として追加
        const voShape = {
            type: 'vobj',
            startX: x,
            startY: y,
            endX: x + width,
            endY: y + height,
            virtualObject: virtualObject,
            strokeColor: virtualObject.frcol || DEFAULT_FRCOL,
            textColor: virtualObject.chcol || DEFAULT_FRCOL,
            fillColor: virtualObject.tbcol || DEFAULT_BGCOL,
            lineWidth: 1,
            originalHeight: height,  // 元の高さを保存
            zIndex: this.getNextZIndex()
        };

        this.shapes.push(voShape);

        // refCount+1が必要なケース:
        // 1. コピーモードでのドロップ
        // 2. ペースト操作（dragDataなし、ドラッグ中でない）
        // 注: 移動モードのクロスウィンドウドロップはソース側でdeleteVirtualObjectShapesを使用し、
        //     refCountは変更しない（移動は参照の移動であり、増減ではない）
        const shouldIncrementRefCount = effectiveMode === 'copy' ||
            (!dragData && !this.isDraggingVirtualObjectShape);
        if (shouldIncrementRefCount) {
            this.requestCopyVirtualObject(virtualObject.link_id);
        }

        this.isModified = true;
        this.setStatus(`仮身「${virtualObject.link_name}」を配置しました`);
        // resizeCanvas()がredraw()を呼ぶので、ここでは呼ばない
        this.resizeCanvas();
    }

    addVirtualObjectFromRealId(realId, name, dropPosition, applist) {
        logger.debug('[FIGURE EDITOR] 原紙箱から仮身を追加:', name, 'at', dropPosition);

        // メニュー文字サイズを取得（ユーザ環境設定から）
        const menuFontSize = localStorage.getItem('menu-font-size') || '14';
        const chsz = parseFloat(menuFontSize);

        // デフォルト値で仮身オブジェクトを作成
        const virtualObj = {
            vobjid: UuidV7Generator.generate(),
            link_id: realId,
            link_name: name,
            width: 150,
            heightPx: DEFAULT_VOBJ_HEIGHT,
            chsz: chsz,  // メニュー文字サイズを使用
            frcol: DEFAULT_FRCOL,
            chcol: DEFAULT_CHCOL,
            tbcol: DEFAULT_TBCOL,
            bgcol: DEFAULT_BGCOL,
            dlen: 0,
            scrollx: 0,
            scrolly: 0,
            zoomratio: 1.0,
            pictdisp: 'true',  // ピクトグラムを表示
            namedisp: 'true',  // 名称を表示
            applist: applist || {}
        };

        // ドロップ位置に仮身を配置
        this.insertVirtualObject(dropPosition.x, dropPosition.y, virtualObj);
        logger.debug('[FIGURE EDITOR] 原紙箱から仮身追加完了');
    }

    closeVirtualObject() {
        // 選択された図形の中から仮身を探す
        const virtualObjectShape = this.selectedShapes.find(shape => shape.type === 'vobj');

        if (!virtualObjectShape || !virtualObjectShape.virtualObject) {
            this.setStatus('仮身が選択されていません');
            logger.warn('[FIGURE EDITOR] 選択中の仮身がありません');
            return;
        }

        const vobj = virtualObjectShape.virtualObject;
        // extractRealIdを使用して一貫したキー形式にする
        const realId = window.RealObjectSystem.extractRealId(vobj.link_id);

        // 開いているかチェック
        if (!this.openedRealObjects.has(realId)) {
            this.setStatus('実身は開いていません');
            logger.debug('[FIGURE EDITOR] 実身は開いていません:', realId);
            return;
        }

        const windowId = this.openedRealObjects.get(realId);
        logger.debug('[FIGURE EDITOR] 実身ウィンドウを閉じます:', windowId, 'realId:', realId);

        // 親ウィンドウにウィンドウクローズを要求
        if (this.messageBus) {
            this.messageBus.send('close-window', {
                windowId: windowId
            });
        }

        // 追跡から削除（window-closedイベントでも削除されるが、ここでも削除）
        this.openedRealObjects.delete(realId);
        this.setStatus('実身を閉じました');
    }

    /**
     * 選択された仮身の実身を指定されたプラグインで開く
     * 仮身一覧プラグインから完全コピー
     * @param {string} pluginId - 開くプラグインのID
     */
    async executeVirtualObjectWithPlugin(pluginId) {
        // 選択中の仮身図形を取得
        const virtualObjectShape = this.selectedShapes.find(s => s.type === 'vobj');
        if (!virtualObjectShape || !virtualObjectShape.virtualObject) {
            logger.warn('[FIGURE EDITOR] 仮身が選択されていません');
            return;
        }

        const selectedVirtualObject = virtualObjectShape.virtualObject;
        // extractRealIdを使用してcontextMenuVirtualObject.realIdと一致させる
        const realId = window.RealObjectSystem.extractRealId(selectedVirtualObject.link_id);
        logger.debug('[FIGURE EDITOR] 仮身の実身を開く:', realId, 'プラグイン:', pluginId);

        // ウィンドウが開いた通知を受け取るハンドラー
        const messageId = `open-${realId}-${Date.now()}`;
        // 親ウィンドウ(tadjs-desktop.js)に実身を開くよう要求
        if (this.messageBus) {
            this.messageBus.send('open-virtual-object-real', {
                virtualObj: selectedVirtualObject,
                pluginId: pluginId,
                messageId: messageId
            });

            try {
                const result = await this.messageBus.waitFor('window-opened', window.LONG_OPERATION_TIMEOUT_MS, (data) => {
                    return data.messageId === messageId;
                });

                if (result.success && result.windowId) {
                    // 開いたウィンドウを追跡
                    this.openedRealObjects.set(realId, result.windowId);
                    logger.debug('[FIGURE EDITOR] ウィンドウが開きました:', result.windowId, 'realId:', realId);

                    // ウィンドウのアイコンを設定
                    // realIdから_0.xtadなどのサフィックスを除去して基本実身IDを取得（共通メソッドを使用）
                    const baseRealId = window.RealObjectSystem.extractRealId(realId);
                    const iconPath = `${baseRealId}.ico`;
                    if (this.messageBus) {
                        this.messageBus.send('set-window-icon', {
                            windowId: result.windowId,
                            iconPath: iconPath
                        });
                        logger.debug('[FIGURE EDITOR] ウィンドウアイコン設定要求:', result.windowId, iconPath);
                    }
                }
            } catch (error) {
                logger.error('[FIGURE EDITOR] ウィンドウ開起エラー:', error);
            }
        }
    }

    /**
     * 選択中の仮身が指し示す実身をデフォルトアプリで開く
     * 仮身一覧プラグインから完全コピー
     */
    openRealObjectWithDefaultApp() {
        // 選択中の仮身図形を取得
        const virtualObjectShape = this.selectedShapes.find(s => s.type === 'vobj');
        if (!virtualObjectShape || !virtualObjectShape.virtualObject) {
            logger.warn('[FIGURE EDITOR] 選択中の仮身がありません');
            return;
        }

        const selectedVirtualObject = virtualObjectShape.virtualObject;

        const applist = selectedVirtualObject.applist;
        if (!applist || typeof applist !== 'object') {
            logger.warn('[FIGURE EDITOR] applistが存在しません');
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
            logger.warn('[FIGURE EDITOR] 開くためのプラグインが見つかりません');
            return;
        }

        // 実身を開く
        this.executeVirtualObjectWithPlugin(defaultPluginId);

        // 開いた実身を追跡
        const realId = selectedVirtualObject.link_id;
        // windowIdは親ウィンドウから通知される想定
        logger.debug('[FIGURE EDITOR] 実身を開く:', realId, 'with', defaultPluginId);
    }

    /**
     * 仮身に属性を適用
     * @param {Object} attrs - 適用する属性値
     */
    applyVirtualObjectAttributes(attrs) {
        // contextMenuVirtualObjectから仮身情報を取得
        if (!this.contextMenuVirtualObject || !this.contextMenuVirtualObject.virtualObj) {
            logger.warn('[FIGURE EDITOR] 仮身が見つかりません');
            return;
        }

        const vobj = this.contextMenuVirtualObject.virtualObj;
        // shapeを探す（contextMenuVirtualObject.shapeまたはshapes配列から）
        const shape = this.contextMenuVirtualObject.shape
            || this.shapes.find(s => s.type === 'vobj' && s.virtualObject === vobj);

        if (!shape) {
            logger.warn('[FIGURE EDITOR] 仮身図形が見つかりません');
            return;
        }

        // PluginBaseの共通メソッドで属性を適用
        this._applyVobjAttrs(vobj, attrs);

        // 修正フラグを立てる
        this.isModified = true;

        // 既存のDOM要素を削除して強制再作成（属性を反映させるため）
        if (shape.vobjElement && shape.vobjElement.parentNode) {
            shape.vobjElement.remove();
            shape.vobjElement = null;
        }

        // Canvas再描画
        this.redraw();

        // 仮身DOM要素を再生成して表示を更新
        this.renderVirtualObjectsAsElements();

        this.setStatus('仮身属性を変更しました');
    }

    /**
     * 仮身属性変更ダイアログを表示
     */
    async changeVirtualObjectAttributes() {
        // contextMenuVirtualObjectが設定されていない場合は選択中の図形から設定
        if (!this.contextMenuVirtualObject) {
            const virtualObjectShape = this.selectedShapes.find(s => s.type === 'vobj');
            if (!virtualObjectShape || !virtualObjectShape.virtualObject) {
                this.setStatus('仮身が選択されていません');
                return;
            }
            const vobj = virtualObjectShape.virtualObject;
            const realId = window.RealObjectSystem.extractRealId(vobj.link_id);
            this.contextMenuVirtualObject = {
                virtualObj: vobj,
                element: virtualObjectShape.vobjElement,
                realId: realId,
                shape: virtualObjectShape
            };
        }

        await window.RealObjectSystem.changeVirtualObjectAttributes(this);
    }

    /**
     * 続柄設定（changeVirtualObjectAttributesパターン踏襲）
     */
    async setRelationship() {
        // contextMenuVirtualObjectが設定されていない場合は選択中の図形から設定
        if (!this.contextMenuVirtualObject) {
            const virtualObjectShape = this.selectedShapes.find(s => s.type === 'vobj');
            if (!virtualObjectShape || !virtualObjectShape.virtualObject) {
                this.setStatus('仮身が選択されていません');
                return { success: false };
            }
            const vobj = virtualObjectShape.virtualObject;
            const realId = window.RealObjectSystem.extractRealId(vobj.link_id);
            this.contextMenuVirtualObject = {
                virtualObj: vobj,
                element: virtualObjectShape.vobjElement,
                realId: realId,
                shape: virtualObjectShape
            };
        }

        // 親クラスのsetRelationship()を呼び出す（metadata更新とフック呼び出しを含む）
        return await super.setRelationship();
    }

    /**
     * 仮身の続柄をXMLに保存（PluginBaseフックオーバーライド）
     * basic-figure-editorはsaveFile()でXML全体を再構築するため、saveFile()を呼ぶ
     * @param {Object} virtualObj - 更新された仮身オブジェクト
     * @returns {Promise<void>}
     */
    async saveVirtualObjectRelationshipToXml(virtualObj) {
        if (virtualObj && virtualObj.link_id) {
            await this.saveFile();
        }
    }

    /**
     * 続柄更新後の再描画（PluginBaseフック）
     */
    onRelationshipUpdated(virtualObj, result) {
        // contextMenuVirtualObjectからshapeを取得
        const shape = this.contextMenuVirtualObject?.shape
            || this.shapes.find(s => s.type === 'vobj' && s.virtualObject === virtualObj);

        if (shape && shape.vobjElement) {
            // 既存のDOM要素を削除して強制再作成
            if (shape.vobjElement.parentNode) {
                shape.vobjElement.remove();
            }
            shape.vobjElement = null;
        }

        // Canvas再描画と仮身DOM要素の再生成
        this.redraw();
        this.isModified = true;
    }

    /**
     * プラグイン内の全仮身を取得（PluginBaseオーバーライド）
     * @returns {Array<Object>} 仮身情報の配列
     */
    getAllVirtualObjects() {
        return this.shapes
            .filter(shape => shape.type === 'vobj' && shape.virtualObject)
            .map(shape => ({
                virtualObj: shape.virtualObject,
                shape: shape,
                element: shape.vobjElement
            }));
    }

    /**
     * 仮身の表示を更新（PluginBaseオーバーライド）
     * @param {Object} item - getAllVirtualObjectsで返された仮身情報
     */
    async updateVirtualObjectDisplay(item) {
        const { shape } = item;
        if (!shape) return;

        // DOM要素を削除して強制再作成
        if (shape.vobjElement) {
            if (shape.vobjElement.parentNode) {
                shape.vobjElement.remove();
            }
            shape.vobjElement = null;
        }

        // 仮身要素を再作成（vobjElement = nullなので新規作成される）
        this.renderVirtualObjectsAsElements();
        this.redraw();
    }

    async expandVirtualObject(vobjElement, shape, options = {}) {
        const virtualObject = shape.virtualObject;
        logger.debug('[FIGURE EDITOR] 開いた仮身の展開開始:', virtualObject.link_name);

        // 展開フラグを設定（renderVirtualObjectsAsElementsによる中断を防ぐ）
        this.isExpandingVirtualObject = true;

        try {
            // 実身IDを取得
            const linkId = virtualObject.link_id;
            logger.debug('[FIGURE EDITOR] linkId:', linkId);
            // 実身IDを抽出（共通メソッドを使用）
            const realId = window.RealObjectSystem.extractRealId(linkId);
            logger.debug('[FIGURE EDITOR] 抽出されたrealId:', realId);
            logger.debug('[FIGURE EDITOR] レコード番号削除後（最終的な実身ID）:', realId);

            // 1. defaultOpenプラグインを取得
            const defaultOpenPlugin = this.getDefaultOpenPlugin(virtualObject);
            if (!defaultOpenPlugin) {
                logger.warn('[FIGURE EDITOR] defaultOpenプラグインが見つかりません');
                return null;
            }
            logger.debug('[FIGURE EDITOR] defaultOpenプラグイン:', defaultOpenPlugin);

            // 2. 実身データを読み込む
            const realObjectData = await this.loadRealObjectData(realId);
            if (!realObjectData) {
                logger.warn('[FIGURE EDITOR] 実身データの読み込みに失敗しました, realId:', realId);
                return null;
            }
            logger.debug('[FIGURE EDITOR] 実身データ読み込み完了:', realObjectData);

            // 3. コンテンツ領域を取得
            const contentArea = vobjElement.querySelector('.virtual-object-content-area');
            if (!contentArea) {
                logger.error('[FIGURE EDITOR] コンテンツ領域が見つかりません');
                return null;
            }

            // コンテンツ領域のスクロールバーを非表示（noScrollbarオプション対応）
            if (options.noScrollbar !== false) {
                contentArea.style.overflow = 'hidden';
            }

            // コンテンツ領域自体のドラッグも無効化
            contentArea.style.pointerEvents = 'none';
            contentArea.style.userSelect = 'none';
            contentArea.setAttribute('draggable', 'false');

            // 仮身の色属性を取得
            const bgcol = virtualObject.bgcol || DEFAULT_BGCOL;

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
            iframe.style.pointerEvents = 'none'; // 開いた仮身内の操作を無効化（図形編集上では表示のみ）
            iframe.style.webkitUserDrag = 'none'; // Webkitブラウザでのドラッグを無効化
            iframe.setAttribute('draggable', 'false'); // iframe自体のドラッグを無効化
            iframe.src = `../../plugins/${defaultOpenPlugin}/index.html`;

            // iframeロード後にデータを送信（load-virtual-objectメッセージ形式）
            iframe.addEventListener('load', () => {
                logger.debug('[FIGURE EDITOR] iframe読み込み完了、プラグインにload-virtual-objectメッセージ送信');
                iframe.contentWindow.postMessage({
                    type: 'load-virtual-object',
                    virtualObj: virtualObject,
                    realObject: realObjectData,
                    bgcol: bgcol,
                    readonly: options.readonly !== false,
                    noScrollbar: options.noScrollbar !== false,
                    scrollPos: { x: virtualObject.scrollx || 0, y: virtualObject.scrolly || 0 },
                    zoomratio: virtualObject.zoomratio || 1.0
                }, '*');
                logger.debug('[FIGURE EDITOR] 開いた仮身表示にデータを送信:', { virtualObject, realObjectData, bgcol, readonly: options.readonly !== false, noScrollbar: options.noScrollbar !== false });
            });

            contentArea.appendChild(iframe);
            logger.debug('[FIGURE EDITOR] iframe追加完了');

            // shapeにiframeへの参照を保存
            shape.expandedElement = iframe;

            return iframe;
        } catch (error) {
            logger.error('[FIGURE EDITOR] expandVirtualObject エラー:', error);
            return null;
        } finally {
            // 展開フラグをリセット
            this.isExpandingVirtualObject = false;
        }
    }

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
        // デフォルトは基本文章編集
        return 'basic-text-editor';
    }


    /**
     * 開いた仮身のサイズを更新
     */
    updateExpandedVirtualObjectSize(shape, width, height) {
        if (!shape.expanded || !shape.vobjElement) {
            return;
        }

        // DOM要素全体のサイズを更新（論理座標を物理座標に変換）
        const expandSize = this.logicalToPhysical(width, height);
        shape.vobjElement.style.width = `${expandSize.x}px`;
        shape.vobjElement.style.height = `${expandSize.y}px`;

        // 内部のiframeもVirtualObjectRendererによって自動的にリサイズされる
    }

    /**
     * 仮身を通常表示に戻す
     */
    collapseVirtualObject(shape) {
        if (!shape.expanded) {
            return;
        }

        shape.expanded = false;
        logger.debug('[FIGURE EDITOR] 仮身を通常表示に戻す:', shape.virtualObject.link_name);

        // コンテンツ領域内のiframeを削除
        if (shape.vobjElement) {
            const contentArea = shape.vobjElement.querySelector('.virtual-object-content-area');
            if (contentArea) {
                contentArea.innerHTML = ''; // すべての子要素（iframe）を削除
            }
        }

        delete shape.expandedElement;
    }

    /**
     * すべての仮身のアイコンを事前読み込み
     * アイコンデータをthis.iconDataオブジェクトに格納し、DOM要素作成時に使用
     */
    async preloadVirtualObjectIcons() {
        // iconDataは PluginBase で初期化済み、ここでクリア
        this.iconData = {};

        if (!this.virtualObjectRenderer) {
            return;
        }

        // 仮身図形から実身IDを抽出（グループ内を含む全仮身）
        const virtualObjectShapes = this.collectAllVirtualObjectShapes().filter(shape => shape.virtualObject.link_id);
        const realIds = virtualObjectShapes.map(shape =>
            this.extractRealId(shape.virtualObject.link_id)
        );

        // PluginBase共通メソッドでアイコン一括読み込み
        await this.loadAndStoreIcons(realIds);

        // VirtualObjectRendererのキャッシュにも格納（Canvas描画時に使用）
        for (const realId of Object.keys(this.iconData)) {
            await this.virtualObjectRenderer.loadIconToCache(realId, this.iconData[realId]);
        }
    }

    /**
     * 仮身をDOM要素として描画
     */
    renderVirtualObjectsAsElements() {
        // リサイズ中は何もしない（DOM要素の削除・再作成を避ける）
        if (this.isResizingVirtualObject) {
            return;
        }

        // 再作成中は何もしない（タイマーベースの再作成を中断しない）
        if (this.isRecreatingVirtualObject) {
            return;
        }

        // 展開中は何もしない（展開操作を中断しない）
        if (this.isExpandingVirtualObject) {
            return;
        }

        // Canvas要素のz-indexを0に設定
        // 背景化図形（z-index < 0）はCanvasより背面、通常図形（z-index > 0）はCanvasより前面
        this.canvas.style.zIndex = '0';

        // 仮身図形をフィルタ
        const virtualObjectShapes = this.shapes.filter(shape =>
            shape.type === 'vobj' && shape.virtualObject
        );

        // 現在有効な仮身のlink_idセットを作成
        const validLinkIds = new Set(virtualObjectShapes.map(shape => shape.virtualObject.link_id));

        // 既存のDOM要素のうち、対応するshapeがないものだけを削除
        const existingElements = document.querySelectorAll('.virtual-object-element');
        existingElements.forEach(el => {
            const linkId = el.dataset.linkId;
            if (!linkId || !validLinkIds.has(linkId)) {
                logger.debug('[FIGURE EDITOR] 不要な仮身DOM要素を削除:', linkId);
                el.remove();
            }
        });

        // 各仮身図形をDOM要素として作成または更新
        virtualObjectShapes.forEach(shape => {
            // 既にDOM要素が存在し、親ノードにも接続されている場合は、位置とサイズのみ更新
            if (shape.vobjElement && shape.vobjElement.parentNode) {
                logger.debug('[FIGURE EDITOR] 既存の仮身DOM要素を再利用:', shape.virtualObject.link_name, 'vobjElement:', !!shape.vobjElement, 'parentNode:', !!shape.vobjElement.parentNode);
                const width = shape.endX - shape.startX;
                const height = shape.endY - shape.startY;
                // DOM要素はbox-sizing: border-boxなので、border込みの高さを設定する
                // shape座標のheight（endY - startY）はborderを含まないTAD保存値
                const domHeight = height + VOBJ_BORDER_WIDTH;

                // 位置、サイズ、z-indexが変わっている場合は更新（論理座標を物理座標に変換）
                const updPos = this.logicalToPhysical(shape.startX, shape.startY);
                const updSize = this.logicalToPhysical(width, domHeight);
                const currentLeft = parseInt(shape.vobjElement.style.left) || 0;
                const currentTop = parseInt(shape.vobjElement.style.top) || 0;
                const currentWidth = parseInt(shape.vobjElement.style.width) || 0;
                const currentHeight = parseInt(shape.vobjElement.style.height) || 0;
                const currentZIndex = parseInt(shape.vobjElement.style.zIndex) || 0;
                const newZIndex = shape.zIndex !== null && shape.zIndex !== undefined ? shape.zIndex : 0;

                if (currentLeft !== Math.round(updPos.x) || currentTop !== Math.round(updPos.y) ||
                    currentWidth !== Math.round(updSize.x) || currentHeight !== Math.round(updSize.y) || currentZIndex !== newZIndex) {
                    shape.vobjElement.style.left = updPos.x + 'px';
                    shape.vobjElement.style.top = updPos.y + 'px';
                    shape.vobjElement.style.width = updSize.x + 'px';
                    shape.vobjElement.style.height = updSize.y + 'px';
                    shape.vobjElement.style.zIndex = String(newZIndex);
                }

                // 仮身名が変更されている場合、DOM要素の名前テキストを更新
                const nameSpan = shape.vobjElement.querySelector('.virtual-object-name');
                if (nameSpan && nameSpan.textContent !== shape.virtualObject.link_name) {
                    nameSpan.textContent = shape.virtualObject.link_name;
                }
            } else {
                // DOM要素が存在しない場合のみ新規作成
                logger.debug('[FIGURE EDITOR] 新しい仮身DOM要素を作成:', shape.virtualObject.link_name, 'vobjElement:', !!shape.vobjElement, 'parentNode:', shape.vobjElement ? !!shape.vobjElement.parentNode : 'N/A');
                this.renderVirtualObjectElement(shape);
            }
        });
    }

    /**
     * 個別の仮身をDOM要素として描画
     */
    renderVirtualObjectElement(shape) {
        logger.debug('[FIGURE EDITOR] ★ renderVirtualObjectElement 開始:', shape.virtualObject?.link_name);

        if (!this.virtualObjectRenderer) {
            logger.warn('[FIGURE EDITOR] VirtualObjectRenderer not available');
            return;
        }

        const virtualObject = shape.virtualObject;
        const width = shape.endX - shape.startX;
        const height = shape.endY - shape.startY;

        // VirtualObjectRendererが判定できるように座標情報を設定
        const virtualObjectWithPos = {
            ...virtualObject,
            vobjtop: shape.startY,
            vobjbottom: shape.endY,
            vobjleft: shape.startX,
            vobjright: shape.endX,
            width: width
        };

        // 開いた仮身と閉じた仮身を判定
        const isOpenVirtualObj = this.virtualObjectRenderer.isOpenedVirtualObject(virtualObjectWithPos);

        logger.debug('[FIGURE EDITOR] 仮身判定:', virtualObject.link_name, '高さ:', height, '開いた仮身:', isOpenVirtualObj);

        // VirtualObjectRendererを使用してDOM要素を作成
        // アイコンは事前読み込み済みのiconDataを使用、フォールバックでloadIconCallbackを使用
        const vobjElement = this.virtualObjectRenderer.createBlockElement(virtualObjectWithPos, {
            iconData: this.iconData || {},
            loadIconCallback: (realId) => this.iconManager ? this.iconManager.loadIcon(realId) : Promise.resolve(null)
        });

        if (!vobjElement) {
            logger.warn('[FIGURE EDITOR] Failed to create virtual object element');
            return;
        }

        // クラスを追加
        vobjElement.classList.add('virtual-object-element');

        // 位置とサイズを設定（論理座標を物理座標に変換）
        // DOM要素はbox-sizing: border-boxなので、border込みの高さを設定する
        // shape座標のheight（endY - startY）はborderを含まないTAD保存値
        const vobjPos = this.logicalToPhysical(shape.startX, shape.startY);
        const vobjSize = this.logicalToPhysical(width, height + VOBJ_BORDER_WIDTH);
        vobjElement.style.position = 'absolute';
        vobjElement.style.left = vobjPos.x + 'px';
        vobjElement.style.top = vobjPos.y + 'px';
        vobjElement.style.width = vobjSize.x + 'px';
        vobjElement.style.height = vobjSize.y + 'px';
        vobjElement.style.cursor = 'move';
        // z-indexをshapeのzIndexプロパティから設定
        // Canvasのz-indexは0なので、負の値はCanvasより背面、正の値は前面になる
        const zIndex = shape.zIndex !== null && shape.zIndex !== undefined ? shape.zIndex : 1;
        vobjElement.style.zIndex = String(zIndex);

        // draggable属性をtrueに設定（クロスウィンドウドラッグ用）
        vobjElement.setAttribute('draggable', 'true');
        logger.debug('[FIGURE EDITOR] vobjElement初期化: draggable=true, link_name=' + virtualObject.link_name);

        // 仮身要素自体のテキスト選択を無効化（文字部分のドラッグ時の問題を防止）
        vobjElement.style.userSelect = 'none';
        vobjElement.style.webkitUserSelect = 'none';
        // pointer-eventsを明示的にautoに設定（dragend後のリセットを確実にする）
        vobjElement.style.pointerEvents = 'auto';

        // selectstartイベントを防止してテキスト選択ドラッグを完全に無効化
        vobjElement.addEventListener('selectstart', (e) => {
            e.preventDefault();
        });

        // CRITICAL: 仮身内部の全要素のドラッグを無効化（画像ドラッグとの競合を防ぐ）
        const allInnerElements = vobjElement.querySelectorAll('*');
        allInnerElements.forEach(el => {
            // 全ての内部要素のドラッグを無効化
            el.setAttribute('draggable', 'false');
            // pointer-eventsをnoneに設定して、内部要素が直接イベントを受け取らないようにする
            el.style.pointerEvents = 'none';
            // 全ての内部要素のテキスト選択を無効化（文字部分のドラッグ時の問題を防止）
            el.style.userSelect = 'none';
            el.style.webkitUserSelect = 'none';
            // 全ての内部要素のwebkitUserDragを無効化（テキスト/画像ドラッグ防止）
            el.style.webkitUserDrag = 'none';
        });
        logger.debug('[FIGURE EDITOR] 仮身内部要素のドラッグを無効化:', allInnerElements.length, '個の要素');

        // データ属性を設定（shape特定用）
        vobjElement.dataset.shapeId = this.shapes.indexOf(shape);
        vobjElement.dataset.linkId = virtualObject.link_id;

        // 既存のvobjElementがあれば削除（親ノードに接続されている場合）
        if (shape.vobjElement) {
            // イベントリスナーのクリーンアップ
            if (shape.vobjElement._cleanupMouseHandlers) {
                shape.vobjElement._cleanupMouseHandlers();
            }

            // mousedownハンドラーの削除
            if (shape.vobjElement._mousedownHandler) {
                shape.vobjElement.removeEventListener('mousedown', shape.vobjElement._mousedownHandler);
                shape.vobjElement._mousedownHandler = null;
            }

            // dragstartハンドラーの削除
            if (shape.vobjElement._dragstartHandler) {
                shape.vobjElement.removeEventListener('dragstart', shape.vobjElement._dragstartHandler);
                shape.vobjElement._dragstartHandler = null;
            }

            // dragendハンドラーの削除
            if (shape.vobjElement._dragendHandler) {
                shape.vobjElement.removeEventListener('dragend', shape.vobjElement._dragendHandler);
                shape.vobjElement._dragendHandler = null;
            }

            // contextmenuハンドラーの削除
            if (shape.vobjElement._contextmenuHandler) {
                shape.vobjElement.removeEventListener('contextmenu', shape.vobjElement._contextmenuHandler);
                shape.vobjElement._contextmenuHandler = null;
            }

            // この仮身がドラッグ中の場合、ドラッグ状態をクリア
            if (this.draggingVirtualObjectShape === shape) {
                this.draggingVirtualObjectShape = null;
                this.isDraggingVirtualObjectShape = false;
                this.draggingVirtualObjectOffsetX = 0;
                this.draggingVirtualObjectOffsetY = 0;

                // ドラッグタイムアウトをクリア
                if (this.virtualObjectDragTimeout) {
                    clearTimeout(this.virtualObjectDragTimeout);
                    this.virtualObjectDragTimeout = null;
                }
            }

            // DOM要素を削除
            if (shape.vobjElement.parentNode) {
                shape.vobjElement.parentNode.removeChild(shape.vobjElement);
            }
            // 参照をクリア
            shape.vobjElement = null;
        }

        // 既存の展開済みiframeは保持（展開状態を維持）
        // shape.expanded と shape.expandedElement はそのまま保持

        // shapeにDOM要素への参照を保存
        shape.vobjElement = vobjElement;

        // mousedownイベント（ドラッグの準備）
        // 重複登録を防ぐため、既存のハンドラーをクリーンアップ
        if (vobjElement._mousedownHandler) {
            vobjElement.removeEventListener('mousedown', vobjElement._mousedownHandler);
            vobjElement._mousedownHandler = null;
        }

        // 新しいハンドラーを定義
        const mousedownHandler = (e) => {
            logger.debug('[FIGURE EDITOR] vobjElement mousedown: button=' + e.button + ', draggable=' + vobjElement.getAttribute('draggable'));

            // ドラッグクールダウン中は処理をスキップ
            if (this.dragCooldown) {
                logger.debug('[FIGURE EDITOR] ドラッグクールダウン中のため処理をスキップ');
                return;
            }

            // ダブルクリック検出ロジック（読み取り専用モードでも実行）
            const now = Date.now();
            const timeSinceLastClick = now - this.dblClickDragState.lastClickTime;
            const isSameShape = this.dblClickDragState.lastClickedShape === shape;

            // 前回のクリックから300ms以内かつ同じ仮身の場合、ダブルクリック候補（左クリックのみ）
            if (timeSinceLastClick < 300 && isSameShape && e.button === 0) {
                logger.debug('[FIGURE EDITOR] ダブルクリック候補を検出:', virtualObject.link_name);
                this.setDoubleClickDragCandidate(vobjElement, e);  // 共通メソッド使用
                // プラグイン固有のプロパティ設定
                this.dblClickDragState.dblClickedShape = shape;

                // 一時的にdraggableをfalseにして、ブラウザの自動ドラッグを防ぐ
                // これにより、mouseupイベントが確実に発火する
                vobjElement.setAttribute('draggable', 'false');
                logger.debug('[FIGURE EDITOR] draggable=false に設定（ダブルクリック候補）');
            } else {
                // 通常のクリック：時刻と図形を記録（全てのボタンで記録）

                // 前回のダブルクリック候補要素のdraggableをtrueに戻す
                if (this.dblClickDragState.dblClickedElement) {
                    this.dblClickDragState.dblClickedElement.setAttribute('draggable', 'true');
                }

                this.resetDoubleClickTimer();  // 共通メソッド使用
                // プラグイン固有のプロパティ設定
                this.dblClickDragState.lastClickedShape = shape;
            }

            // 読み取り専用モードの場合は、ドラッグとリサイズを無効化（ダブルクリックは許可）
            if (this.readonly) {
                // ダブルクリック検出は上で実行済みなので、ここではreturnのみ
                return;
            }

            // イベントの伝播を止めて、canvas のイベントと競合しないようにする
            e.stopPropagation();
            // e.preventDefault() を削除（dblclickイベントを許可するため）

            // 仮身図形を選択（selectツールの場合のみ）
            if (this.currentTool === 'select') {
                const isAlreadySelected = this.selectedShapes.includes(shape);

                // 左クリックの場合のみ選択処理を実行
                if (e.button === 0) {
                    if (e.shiftKey) {
                        // Shiftキー: トグル選択
                        if (isAlreadySelected) {
                            // 選択解除
                            const index = this.selectedShapes.indexOf(shape);
                            this.selectedShapes.splice(index, 1);
                        } else {
                            // 追加選択
                            this.selectedShapes.push(shape);
                        }
                    } else {
                        // 通常クリック: 他の選択を解除してこの図形のみ選択
                        this.selectedShapes = [shape];
                    }
                    this.redraw();
                    logger.debug('[FIGURE EDITOR] 仮身を選択:', virtualObject.link_name, '選択数:', this.selectedShapes.length);
                } else if (e.button === 2) {
                    // 右クリックの場合、未選択の仮身のみ選択（複数選択を維持するため）
                    if (!isAlreadySelected) {
                        this.selectedShapes = [shape];
                        this.redraw();
                        logger.debug('[FIGURE EDITOR] 右クリックで未選択の仮身を選択:', virtualObject.link_name);
                    }
                }
            }

            // 左クリックのみドラッグ処理、右クリックと中クリックはここで終了（コンテキストメニュー用）
            if (e.button !== 0) {
                return;
            }

            // dragModeはinitializeVirtualObjectDragStart()で設定

            // リサイズエリアのチェック（リサイズエリア内ではドラッグしない）
            const rect = vobjElement.getBoundingClientRect();
            const isRightEdge = e.clientX > rect.right - 10 && e.clientX <= rect.right + 10;
            const isBottomEdge = e.clientY > rect.bottom - 10 && e.clientY <= rect.bottom + 10;
            if (isRightEdge || isBottomEdge) {
                // リサイズエリア内なので、ドラッグ処理はスキップ
                return;
            }

            // 仮身内の相対位置を記録（offsetX/Yは要素内の相対位置）
            const offsetX = e.clientX - rect.left;
            const offsetY = e.clientY - rect.top;

            // ドラッグの準備（マウス移動検出用）
            this.isDraggingVirtualObjectShape = false;
            this.draggingVirtualObjectShape = shape;
            this.draggingVirtualObjectElement = vobjElement;
            this.draggingVirtualObjectOffsetX = offsetX;
            this.draggingVirtualObjectOffsetY = offsetY;
            vobjElement._dragStartX = e.clientX;
            vobjElement._dragStartY = e.clientY;
            vobjElement._dragStarted = false;

            // マウス移動を監視してドラッグを開始
            const mousemoveHandler = (moveEvent) => {
                // ダブルクリック+ドラッグ中は通常のドラッグ処理をスキップ（グローバルハンドラーで処理）
                if (this.dblClickDragState.isDblClickDragCandidate || this.dblClickDragState.isDblClickDrag) {
                    return;
                }

                const dx = Math.abs(moveEvent.clientX - vobjElement._dragStartX);
                const dy = Math.abs(moveEvent.clientY - vobjElement._dragStartY);

                // 5px以上動いたらドラッグ開始マーク
                if (!vobjElement._dragStarted && (dx > 5 || dy > 5)) {
                    vobjElement._dragStarted = true;
                    // hasMovedはPluginBaseで管理
                }
            };

            // クリーンアップ関数（mouseup/dragstart/dragendから呼び出し）
            const cleanupHandlers = () => {
                logger.debug('[FIGURE EDITOR] クリーンアップ: ハンドラ削除、状態リセット');
                document.removeEventListener('mousemove', mousemoveHandler);
                document.removeEventListener('mouseup', mouseupHandler);
                if (vobjElement._handlerTimeout) {
                    clearTimeout(vobjElement._handlerTimeout);
                    vobjElement._handlerTimeout = null;
                }
                vobjElement._dragStarted = false;
                // hasMovedはPluginBaseで管理
                vobjElement._cleanupMouseHandlers = null; // 参照をクリア
            };

            const mouseupHandler = (upEvent) => {
                logger.debug('[FIGURE EDITOR] 要素レベルmouseup: button=' + upEvent.button + ', _dragStarted=' + vobjElement._dragStarted);

                // 左+右同時押しのコピーモード検出はdragstartで行うため、ここでは常にクリーンアップを実行
                logger.debug('[FIGURE EDITOR] 要素レベルmouseup: ハンドラ削除、状態リセット');
                cleanupHandlers();

                // ダブルクリック検出とドラッグ処理はdocument-levelのmouseupハンドラで処理される
            };

            // ハンドラを登録
            document.addEventListener('mousemove', mousemoveHandler);
            document.addEventListener('mouseup', mouseupHandler);

            // クリーンアップ関数を要素に保存（dragstart/dragendから呼び出せるように）
            vobjElement._cleanupMouseHandlers = cleanupHandlers;

            // フェイルセーフ: 5秒後に強制的にクリーンアップ（dragstartでmouseupが発火しない場合の対策）
            vobjElement._handlerTimeout = setTimeout(() => {
                logger.debug('[FIGURE EDITOR] タイムアウト: 強制的にハンドラをクリーンアップ');
                cleanupHandlers();
            }, 5000);

            logger.debug('[FIGURE EDITOR] mousedown/mousemove/mouseupイベントリスナーを登録:', virtualObject.link_name);
        };

        // 重複登録を防ぐため、既存のハンドラーをクリーンアップ
        if (vobjElement._mousedownHandler) {
            vobjElement.removeEventListener('mousedown', vobjElement._mousedownHandler);
            vobjElement._mousedownHandler = null;
        }

        // ハンドラーを登録して参照を保存
        vobjElement.addEventListener('mousedown', mousedownHandler);
        vobjElement._mousedownHandler = mousedownHandler;

        // dragstartイベント
        // 重複登録を防ぐため、既存のハンドラーをクリーンアップ
        if (vobjElement._dragstartHandler) {
            vobjElement.removeEventListener('dragstart', vobjElement._dragstartHandler);
            vobjElement._dragstartHandler = null;
        }

        // 新しいハンドラーを定義
        const dragstartHandler = (e) => {
            logger.debug('[FIGURE EDITOR] dragstart: buttons=' + e.buttons + ', isDblClickDragCandidate=' + this.dblClickDragState.isDblClickDragCandidate + ', isDblClickDrag=' + this.dblClickDragState.isDblClickDrag);

            // mousedownで登録したハンドラをクリーンアップ（dragstartが発火するとmouseupが発火しないため）
            if (vobjElement._cleanupMouseHandlers) {
                logger.debug('[FIGURE EDITOR] dragstart: mousedownハンドラをクリーンアップ');
                vobjElement._cleanupMouseHandlers();
            }

            // ダブルクリック+ドラッグ候補またはダブルクリック+ドラッグ中の場合は通常のドラッグを抑制
            if (this.dblClickDragState.isDblClickDragCandidate || this.dblClickDragState.isDblClickDrag) {
                logger.debug('[FIGURE EDITOR] ダブルクリック+ドラッグ検出、通常のドラッグを抑制');
                e.preventDefault();
                return;
            }

            // mousedownで準備ができているかチェック
            if (!this.draggingVirtualObjectShape || this.draggingVirtualObjectShape !== shape) {
                e.preventDefault();
                return;
            }

            // PluginBase共通メソッドでドラッグ状態を初期化
            this.initializeVirtualObjectDragStart(e);

            // 選択中の仮身を取得（複数選択ドラッグのサポート）
            const selectedVirtualObjectShapes = this.selectedShapes.filter(s => s.type === 'vobj');

            // ドラッグ中の仮身が選択されていない場合は、その仮身のみをドラッグ
            const shapesToDrag = selectedVirtualObjectShapes.includes(shape)
                ? selectedVirtualObjectShapes
                : [shape];

            logger.debug('[FIGURE EDITOR] ドラッグ開始: ', shapesToDrag.length, '個の仮身');

            // 各仮身のドラッグデータを準備
            const virtualObjects = shapesToDrag.map(s => {
                const vo = s.virtualObject;
                return {
                    link_id: vo.link_id,
                    link_name: vo.link_name,
                    width: vo.width || s.width,
                    heightPx: vo.heightPx || s.height,
                    chsz: vo.chsz || DEFAULT_FONT_SIZE,
                    frcol: vo.frcol || DEFAULT_FRCOL,
                    chcol: vo.chcol || DEFAULT_FRCOL,
                    tbcol: vo.tbcol || DEFAULT_BGCOL,
                    bgcol: vo.bgcol || DEFAULT_BGCOL,
                    dlen: vo.dlen || 0,
                    applist: vo.applist || {},
                    offsetX: (s === shape) ? (this.draggingVirtualObjectOffsetX || 0) : 0,
                    offsetY: (s === shape) ? (this.draggingVirtualObjectOffsetY || 0) : 0
                };
            });

            // PluginBase共通メソッドでdragDataを設定
            // ダブルクリック+ドラッグ（実身複製）判定を追加
            const isDuplicateDrag = this.dblClickDragState.isDblClickDragCandidate || this.dblClickDragState.isDblClickDrag;
            this.setVirtualObjectDragData(e, virtualObjects, 'basic-figure-editor', isDuplicateDrag);

            // フラグを設定
            this.isDraggingVirtualObjectShape = true;
            this.draggingVirtualObjectShape = shape;
            // isDraggingはinitializeVirtualObjectDragStart()で設定済み

            // 半透明にする
            vobjElement.style.opacity = '0.5';
        };

        // ハンドラーを登録して参照を保存
        vobjElement.addEventListener('dragstart', dragstartHandler);
        vobjElement._dragstartHandler = dragstartHandler;

        // mouseupイベント（ドラッグキャンセル、draggableを無効化）
        // 重複登録を防ぐため、既存のハンドラーをクリーンアップ
        if (vobjElement._mouseupHandler) {
            vobjElement.removeEventListener('mouseup', vobjElement._mouseupHandler);
            vobjElement._mouseupHandler = null;
        }

        // 新しいハンドラーを定義
        const mouseupHandler = (_e) => {
            // タイムアウトをクリア（draggable有効化をキャンセル）
            if (vobjElement._draggableTimeout) {
                clearTimeout(vobjElement._draggableTimeout);
                vobjElement._draggableTimeout = null;
            }

            // draggableをtrueに戻す（ダブルクリック+ドラッグ後の状態復元）
            vobjElement.setAttribute('draggable', 'true');

            // ドラッグフラグをリセット（ただし、ドラッグ中の場合はクリアしない）
            // dragstartの後、mouseupが発火してもドラッグは続行されるため
            if (!this.isDraggingVirtualObjectShape) {
                this.draggingVirtualObjectShape = null;
            }
        };

        // ハンドラーを登録して参照を保存
        vobjElement.addEventListener('mouseup', mouseupHandler);
        vobjElement._mouseupHandler = mouseupHandler;

        // dragendイベント
        // 重複登録を防ぐため、既存のハンドラーをクリーンアップ
        if (vobjElement._dragendHandler) {
            vobjElement.removeEventListener('dragend', vobjElement._dragendHandler);
            vobjElement._dragendHandler = null;
        }

        // 新しいハンドラーを定義
        const dragendHandler = () => {
            // mousedownで登録したハンドラをクリーンアップ（バックアップとして）
            if (vobjElement._cleanupMouseHandlers) {
                logger.debug('[FIGURE EDITOR] dragend: mousedownハンドラをクリーンアップ（バックアップ）');
                vobjElement._cleanupMouseHandlers();
            }

            // 透明度を戻す
            vobjElement.style.opacity = '1.0';

            // pointer-eventsを一時的に無効化（dragend直後のクリック防止）
            vobjElement.style.pointerEvents = 'none';

            // 100ms後にpointer-eventsとdraggableを復元（次のドラッグを可能にする）
            setTimeout(() => {
                vobjElement.style.pointerEvents = 'auto';
                vobjElement.setAttribute('draggable', 'true');
                logger.debug('[FIGURE EDITOR] dragend後のpointer-eventsとdraggableを復元');
            }, 100);

            // ドラッグクールダウンを設定（連続ドラッグ防止）
            this.dragCooldown = true;
            if (this.dragCooldownTimeout) {
                clearTimeout(this.dragCooldownTimeout);
            }
            this.dragCooldownTimeout = setTimeout(() => {
                this.dragCooldown = false;
                logger.debug('[FIGURE EDITOR] ドラッグクールダウン解除');
            }, 200);

            // PluginBase共通メソッドでドラッグ状態をクリーンアップ
            this.cleanupVirtualObjectDragState();

            // ダブルクリックドラッグ状態もクリーンアップ（意図しない複製を防止）
            this.cleanupDblClickDragState();
            this.dblClickDragState.lastClickedShape = null;

            // タイムアウトを設定（2秒以内にcross-window-drop-successが来なければリセット）
            if (this.virtualObjectDragTimeout) {
                clearTimeout(this.virtualObjectDragTimeout);
            }

            this.virtualObjectDragTimeout = setTimeout(() => {
                this.isDraggingVirtualObjectShape = false;
                this.draggingVirtualObjectShape = null;
                this.virtualObjectDragTimeout = null;
            }, 2000);
        };

        // ハンドラーを登録して参照を保存
        vobjElement.addEventListener('dragend', dragendHandler);
        vobjElement._dragendHandler = dragendHandler;

        // 右クリックで仮身を選択してコンテキストメニューを表示
        // 重複登録を防ぐため、既存のハンドラーをクリーンアップ
        if (vobjElement._contextmenuHandler) {
            vobjElement.removeEventListener('contextmenu', vobjElement._contextmenuHandler);
            vobjElement._contextmenuHandler = null;
        }

        // 新しいハンドラーを定義
        const contextmenuHandler = (e) => {
            e.preventDefault();
            e.stopPropagation();

            // ダブルクリック+ドラッグ状態をクリア（コンテキストメニュー表示時は通常操作を優先）
            if (this.dblClickDragState.dblClickedElement) {
                this.dblClickDragState.dblClickedElement.setAttribute('draggable', 'true');
            }
            // 共通メソッドでクリーンアップ
            this.cleanupDblClickDragState();
            // プラグイン固有のクリーンアップ
            this.dblClickDragState.lastClickTime = 0; // ダブルクリック検出をリセット
            this.dblClickDragState.lastClickedShape = null;
            this.dblClickDragState.dblClickedShape = null;
            // プレビュー要素を削除
            if (this.dblClickDragState.previewElement) {
                this.dblClickDragState.previewElement.remove();
                this.dblClickDragState.previewElement = null;
            }

            // 仮身図形を選択（まだ選択されていない場合）
            if (this.currentTool === 'select') {
                if (!this.selectedShapes.includes(shape)) {
                    this.selectedShapes = [shape];
                    this.redraw();
                    logger.debug('[FIGURE EDITOR] 右クリックで仮身を選択:', virtualObject.link_name);
                }

                // 実身IDを抽出（共通メソッドを使用）
                const realId = window.RealObjectSystem.extractRealId(virtualObject.link_id);

                // 右クリックされた仮身の情報を保存（メニュー生成時に使用）
                this.contextMenuVirtualObject = {
                    element: vobjElement,
                    realId: realId,
                    virtualObj: virtualObject
                };
                logger.debug('[FIGURE EDITOR] contextMenuVirtualObject設定完了:', this.contextMenuVirtualObject);

                // 親ウィンドウにコンテキストメニュー要求を送信（共通メソッドを使用）
                this.showContextMenuAtEvent(e);
            }
        };

        // 重複登録を防ぐため、既存のハンドラーをクリーンアップ
        if (vobjElement._contextmenuHandler) {
            vobjElement.removeEventListener('contextmenu', vobjElement._contextmenuHandler);
            vobjElement._contextmenuHandler = null;
        }

        // ハンドラーを登録して参照を保存
        vobjElement.addEventListener('contextmenu', contextmenuHandler);
        vobjElement._contextmenuHandler = contextmenuHandler;

        // リサイズ機能を追加
        this.makeVirtualObjectResizable(vobjElement, shape);

        // エディタコンテナに追加
        const container = document.querySelector('.editor-container');
        if (container) {
            container.appendChild(vobjElement);
        } else {
            document.body.appendChild(vobjElement);
        }
        logger.debug('[FIGURE EDITOR] ★ renderVirtualObjectElement 完了、DOMに追加:', virtualObject.link_name);

        // 開いた仮身の場合、展開処理を実行（まだ展開されていない場合のみ）
        // 展開試行済み（expanded）またはエラー発生済み（expandError）の場合はスキップ
        if (isOpenVirtualObj && !shape.expanded && !shape.expandError) {
            logger.debug('[FIGURE EDITOR] 開いた仮身を展開:', virtualObject.link_name);
            // 無限ループを防ぐため、先にフラグを設定
            shape.expanded = true;
            // DOMに追加された後に非同期で展開
            setTimeout(() => {
                this.expandVirtualObject(vobjElement, shape, {
                    readonly: true,
                    noScrollbar: true,
                    bgcol: virtualObject.bgcol
                }).catch(err => {
                    logger.error('[FIGURE EDITOR] 仮身展開エラー:', err);
                    // エラー時はエラーフラグを設定（無限ループ防止のためフラグはリセットしない）
                    shape.expandError = true;
                });
            }, 0);
        }
    }

    /**
     * 仮身要素をリサイズ可能にする
     * @param {HTMLElement} vobjElement - 仮身のDOM要素
     * @param {Object} shape - 仮身のshapeオブジェクト
     */
    makeVirtualObjectResizable(vobjElement, shape) {
        const obj = shape.virtualObject;

        // 重複登録を防ぐため、既存のリサイズハンドラーをクリーンアップ
        if (vobjElement._resizeMousemoveHandler) {
            vobjElement.removeEventListener('mousemove', vobjElement._resizeMousemoveHandler);
            vobjElement._resizeMousemoveHandler = null;
        }
        if (vobjElement._resizeMouseleaveHandler) {
            vobjElement.removeEventListener('mouseleave', vobjElement._resizeMouseleaveHandler);
            vobjElement._resizeMouseleaveHandler = null;
        }
        if (vobjElement._resizeMousedownHandler) {
            vobjElement.removeEventListener('mousedown', vobjElement._resizeMousedownHandler);
            vobjElement._resizeMousedownHandler = null;
        }

        // マウス移動でカーソルを変更（リサイズエリアの表示）
        const mousemoveHandler = (e) => {
            // リサイズ中は何もしない
            if (this.isResizingVirtualObject) {
                return;
            }

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
                vobjElement.style.cursor = 'move'; // 通常: 移動カーソル
            }
        };

        // マウスが仮身から離れたらカーソルを元に戻す
        const mouseleaveHandler = () => {
            if (!this.isResizingVirtualObject) {
                vobjElement.style.cursor = 'move';
            }
        };

        // マウスダウンでリサイズ開始
        const mousedownHandler = (e) => {
            // 読み取り専用モードの場合はリサイズを無効化
            if (this.readonly) {
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

            // 左クリックのみ処理
            if (e.button !== 0) {
                return;
            }

            // リサイズ中は新しいリサイズを開始しない
            if (this.isResizingVirtualObject) {
                logger.debug('[FIGURE EDITOR] リサイズ中のため、新しいリサイズを無視');
                return;
            }

            e.preventDefault();
            e.stopPropagation();

            // draggableタイムアウトをクリア（ドラッグとリサイズの競合を防ぐ）
            if (vobjElement._draggableTimeout) {
                clearTimeout(vobjElement._draggableTimeout);
                vobjElement._draggableTimeout = null;
            }

            // draggableを無効化
            vobjElement.setAttribute('draggable', 'false');

            // リサイズ開始フラグを設定
            this.isResizingVirtualObject = true;

            // リサイズモード開始
            const startX = e.clientX;
            const startY = e.clientY;
            const startWidth = rect.width;
            const startHeight = rect.height;
            const minWidth = 50;

            // VirtualObjectRendererのユーティリティメソッドを使用して最小高さを計算
            // 注: getMinClosedHeight/getMinOpenHeightはborderなしのTAD保存値を返す
            // プレビュー枠はDOM要素と同じborder込みの値を使う必要がある
            const chsz = Math.round(obj.chsz || DEFAULT_FONT_SIZE);
            const minClosedHeight = this.virtualObjectRenderer.getMinClosedHeight(chsz) + VOBJ_BORDER_WIDTH;
            const minOpenHeight = this.virtualObjectRenderer.getMinOpenHeight(chsz) + VOBJ_BORDER_WIDTH;

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

            logger.debug('[FIGURE EDITOR] 仮身リサイズ開始:', obj.link_name, 'startWidth:', startWidth, 'startHeight:', startHeight, 'currentHeight:', currentHeight, 'hasContentArea:', hasContentArea, 'chsz:', chsz, 'minClosedHeight:', minClosedHeight, 'minOpenHeight:', minOpenHeight);

            // リサイズプレビュー枠を作成
            const previewBox = document.createElement('div');
            previewBox.style.position = 'fixed'; // キャンバス外でも表示されるようにfixedを使用
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
                        // 閾値未満の場合は、閉じた仮身の高さに固定
                        currentHeight = minClosedHeight;
                    } else {
                        // 閾値以上の場合は、開いた仮身の高さとして自由に変更可能
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
                vobjElement.style.cursor = 'move';

                // 最終的なサイズを取得（プレビュー枠のサイズは物理ピクセル、論理座標に変換）
                const finalPhysWidth = Math.round(currentWidth);
                const finalPhysHeight = Math.round(currentHeight);
                const finalLogical = this.physicalToLogical(finalPhysWidth, finalPhysHeight);
                const finalWidth = Math.round(finalLogical.x);
                const finalHeight = Math.round(finalLogical.y);

                // shapeのサイズを更新
                // 注: DOM要素の高さ（finalHeight）はborderを含む（box-sizing: border-box）
                // TADファイルのheight属性はborderを含まない値を保存する
                const heightForSave = finalHeight - VOBJ_BORDER_WIDTH;
                shape.endX = shape.startX + finalWidth;
                shape.endY = shape.startY + heightForSave;

                // 仮身オブジェクトのサイズを更新
                obj.width = finalWidth;
                obj.heightPx = heightForSave;

                logger.debug('[FIGURE EDITOR] 仮身リサイズ終了:', obj.link_name, 'newWidth:', finalWidth, 'newHeight:', finalHeight);

                // 開いた仮身と閉じた仮身の判定が変わったかチェック
                // VirtualObjectRendererのユーティリティメソッドを使用
                const chsz_resize = Math.round(obj.chsz || DEFAULT_FONT_SIZE);
                const minClosedHeight_resize = this.virtualObjectRenderer.getMinClosedHeight(chsz_resize);
                const wasOpen = hasContentArea; // DOMベースの判定を使用
                // VirtualObjectRendererと同じ閾値を使用: height > minClosedHeight
                const isNowOpen = finalHeight > minClosedHeight_resize;

                if (wasOpen !== isNowOpen) {
                    // 判定が変わった場合は、少し待ってから仮身要素を再作成
                    logger.debug('[FIGURE EDITOR] 開いた仮身/閉じた仮身の判定が変わりました。少し待ってから再作成します。');

                    // 既存のタイマーをクリア（連続したリサイズで最後の一回だけ実行）
                    if (this.recreateVirtualObjectTimer) {
                        clearTimeout(this.recreateVirtualObjectTimer);
                    }

                    // 展開状態をリセット（エラーフラグも含む）
                    shape.expanded = false;
                    shape.expandedElement = null;
                    shape.expandError = false;

                    // 再作成フラグを設定（renderVirtualObjectsAsElementsによる中断を防ぐ）
                    this.isRecreatingVirtualObject = true;

                    // 遅延して再作成（150ms後）
                    this.recreateVirtualObjectTimer = setTimeout(() => {
                        logger.debug('[FIGURE EDITOR] 仮身を再作成します。');

                        // 要素がまだDOMに存在するかチェック
                        if (!vobjElement.parentNode) {
                            logger.warn('[FIGURE EDITOR] 再作成対象の仮身要素がDOMから削除されています');
                            this.recreateVirtualObjectTimer = null;
                            this.isRecreatingVirtualObject = false;
                            return;
                        }

                        // 仮身要素を再描画
                        this.renderVirtualObjectElement(shape);

                        this.recreateVirtualObjectTimer = null;
                        this.isRecreatingVirtualObject = false;
                    }, 150);
                } else {
                    // 判定が変わらない場合は、DOM要素のサイズだけ更新（論理座標を物理座標に変換）
                    const finalSize = this.logicalToPhysical(finalWidth, finalHeight);
                    vobjElement.style.width = `${finalSize.x}px`;
                    vobjElement.style.height = `${finalSize.y}px`;
                }

                // draggableを再び有効化（リサイズ開始時に無効化したため）
                vobjElement.setAttribute('draggable', 'true');

                // リサイズ終了フラグをリセット
                this.isResizingVirtualObject = false;
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        };

        // ハンドラを登録して参照を保存
        vobjElement.addEventListener('mousemove', mousemoveHandler);
        vobjElement._resizeMousemoveHandler = mousemoveHandler;

        vobjElement.addEventListener('mouseleave', mouseleaveHandler);
        vobjElement._resizeMouseleaveHandler = mouseleaveHandler;

        vobjElement.addEventListener('mousedown', mousedownHandler);
        vobjElement._resizeMousedownHandler = mousedownHandler;
    }

    /**
     * 仮身を開く（defaultOpenプラグインで開く）
     */
    openVirtualObject(shape) {
        const virtualObject = shape.virtualObject;
        logger.debug('[FIGURE EDITOR] Opening virtual object:', virtualObject.link_name);

        // 親ウィンドウにメッセージを送信して開く
        // link_idとlink_nameを個別に送る（仮身一覧形式）
        if (this.messageBus) {
            this.messageBus.send('open-virtual-object', {
                linkId: virtualObject.link_id,
                linkName: virtualObject.link_name
            });
        }
    }

    /**
     * ダブルクリック+ドラッグによる実身複製処理
     * @param {Object} shape - 元の仮身図形
     * @param {number} targetX - ドロップ先のX座標
     * @param {number} targetY - ドロップ先のY座標
     */
    async handleDoubleClickDragDuplicate(shape, targetX, targetY) {
        const virtualObject = shape.virtualObject;
        if (!virtualObject || !virtualObject.link_id) {
            logger.error('[FIGURE EDITOR] 複製対象の仮身が不正です');
            return;
        }

        const realId = virtualObject.link_id;
        logger.debug('[FIGURE EDITOR] ダブルクリック+ドラッグによる実身複製:', realId, 'ドロップ位置:', targetX, targetY);

        // 元の仮身のサイズと属性を保存
        const width = virtualObject.width || (shape.endX - shape.startX) || 100;
        const height = virtualObject.heightPx || (shape.endY - shape.startY) || 32;
        const chsz = virtualObject.chsz || DEFAULT_FONT_SIZE;
        const frcol = virtualObject.frcol || DEFAULT_FRCOL;
        const chcol = virtualObject.chcol || DEFAULT_FRCOL;
        const tbcol = virtualObject.tbcol || DEFAULT_BGCOL;
        const bgcol = virtualObject.bgcol || DEFAULT_BGCOL;
        const dlen = virtualObject.dlen || 0;
        const applist = virtualObject.applist || {};

        // 先にダイアログで名前を入力してもらう
        const defaultName = (virtualObject.link_name || '実身') + 'のコピー';
        const newName = await this.showInputDialog(
            '新しい実身の名称を入力してください',
            defaultName,
            30
        );

        // キャンセルされた場合は何もしない（showInputDialogはキャンセル時にnullを返す）
        if (!newName) {
            logger.debug('[FIGURE EDITOR] 実身複製がキャンセルされました');
            return;
        }

        // メッセージIDを生成
        const messageId = this.generateMessageId('duplicate');

        // MessageBus経由で実身複製を要求（名前を含める）
        this.messageBus.send('duplicate-real-object', {
            realId: realId,
            messageId: messageId,
            newName: newName
        });

        try {
            // レスポンスを待つ（タイムアウト5秒）
            const result = await this.messageBus.waitFor('real-object-duplicated', window.DEFAULT_TIMEOUT_MS, (data) => {
                return data.messageId === messageId;
            });

            if (result.cancelled) {
                logger.debug('[FIGURE EDITOR] 実身複製がキャンセルされました');
            } else if (result.success) {
                // 複製成功: 新しい実身IDで仮身を作成
                const newRealId = result.newRealId;
                const newName = result.newName;
                logger.debug('[FIGURE EDITOR] 実身複製成功:', realId, '->', newRealId, '名前:', newName);

                // 新しい仮身図形を作成（ドロップ位置に配置）
                const newShape = {
                    type: 'vobj',
                    startX: targetX,
                    startY: targetY,
                    endX: targetX + width,
                    endY: targetY + height,
                    virtualObject: {
                        link_id: newRealId,
                        link_name: newName,
                        width: width,
                        heightPx: height,
                        chsz: chsz,
                        frcol: frcol,
                        chcol: chcol,
                        tbcol: tbcol,
                        bgcol: bgcol,
                        dlen: dlen,
                        applist: applist
                    },
                    zIndex: this.getNextZIndex()
                };

                // 図形リストに追加
                this.shapes.push(newShape);

                // 新しい仮身を選択状態にする
                this.selectedShapes = [newShape];

                // 再描画
                this.redraw();

                // 変更フラグを立てる
                this.isModified = true;
                this.hasUnsavedChanges = true;
            } else {
                logger.error('[FIGURE EDITOR] 実身複製失敗:', result.error);
            }
        } catch (error) {
            logger.error('[FIGURE EDITOR] 実身複製エラー:', error);
        }
    }

    /**
     * 元の仮身オブジェクトを削除するフック（PluginBase共通機能）
     * cross-window-drop-successでmoveモード時に呼ばれる
     */
    onDeleteSourceVirtualObject(data) {
        // このメソッドはドラッグ元で呼ばれるので、sourceWindowId === this.windowIdは常にtrue
        // クロスウィンドウドロップの場合のみ削除処理を行う（targetWindowIdが存在し、自分と異なる場合）
        if (data.targetWindowId && data.targetWindowId === this.windowId) {
            // ターゲットウィンドウで呼ばれた場合はスキップ（通常はありえない）
            logger.debug('[FIGURE EDITOR] ターゲットウィンドウでの呼び出し: 処理をスキップ');
            return;
        }

        if (!this.isDraggingVirtualObjectShape || !this.draggingVirtualObjectShape) {
            logger.debug('[FIGURE EDITOR] ドラッグ中の仮身がない: 処理をスキップ');
            return;
        }

        const shape = this.draggingVirtualObjectShape;
        logger.debug(`[FIGURE EDITOR] 移動モード: 仮身を削除:`, shape.virtualObject.link_name);

        // タイムアウトをキャンセル
        if (this.virtualObjectDragTimeout) {
            clearTimeout(this.virtualObjectDragTimeout);
            this.virtualObjectDragTimeout = null;
        }

        // 選択中の仮身を取得
        const selectedVirtualObjectShapes = this.selectedShapes.filter(s => s.type === 'vobj');
        const shapesToDelete = selectedVirtualObjectShapes.includes(shape)
            ? selectedVirtualObjectShapes
            : [shape];

        logger.debug('[FIGURE EDITOR] 移動モード: ', shapesToDelete.length, '個の仮身を削除');

        // 共通メソッドで仮身を削除
        this.deleteVirtualObjectShapes(shapesToDelete);
    }

    /**
     * cross-window-drop-success処理完了後のフック（PluginBase共通機能）
     * ドラッグ状態のクリーンアップ後に呼ばれる
     */
    onCrossWindowDropSuccess(data) {
        // フラグをリセット
        this.isDraggingVirtualObjectShape = false;
        this.draggingVirtualObjectShape = null;

        // ドラッグモードはcleanupVirtualObjectDragState()で既にリセット済み
    }

    /**
     * 仮身のメタデータ（applist等）をJSONファイルから読み込む
     * @param {Object} virtualObj - 仮身オブジェクト
     */
    async loadVirtualObjectMetadata(virtualObj) {
        try {
            // 実身IDを抽出してJSONファイル名を生成（共通メソッドを使用）
            const baseFileId = window.RealObjectSystem.extractRealId(virtualObj.link_id);
            const jsonFileName = window.RealObjectSystem.getRealObjectJsonFileName(baseFileId);
            logger.debug('[FIGURE EDITOR] メタデータ読み込み試行:', virtualObj.link_id, 'JSONファイル:', jsonFileName);

            // 親ウィンドウのfileObjectsからJSONファイルを取得
            if (window.parent && window.parent.tadjsDesktop && window.parent.tadjsDesktop.fileObjects) {
                const jsonFile = window.parent.tadjsDesktop.fileObjects[jsonFileName];
                logger.debug('[FIGURE EDITOR] fileObjectsから検索:', jsonFileName, 'found:', !!jsonFile);

                if (jsonFile) {
                    const jsonText = await jsonFile.text();
                    const jsonData = JSON.parse(jsonText);

                    // applistはオブジェクト形式 { "plugin-id": { "name": "プラグイン名" }, ... }
                    virtualObj.applist = jsonData.applist || {};
                    virtualObj.metadata = jsonData;
                    virtualObj.updateDate = jsonData.updateDate; // 更新日時を保存
                    // 実身名とlink_nameの同期: JSON.nameが存在し異なる場合はJSON.nameを優先
                    if (jsonData.name && virtualObj.link_name !== jsonData.name) {
                        virtualObj.link_name = jsonData.name;
                    }
                    logger.debug('[FIGURE EDITOR] メタデータ読み込み成功:', virtualObj.link_id, virtualObj.applist);
                } else {
                    // JSONファイルが見つからない場合、Electron環境なら親ウィンドウ経由で読み込み
                    logger.debug('[FIGURE EDITOR] fileObjectsに見つからない、親ウィンドウ経由で試行:', jsonFileName);

                    try {
                        const jsonFile = await this.loadDataFileFromParent(jsonFileName);
                        const jsonText = await jsonFile.text();
                        const jsonData = JSON.parse(jsonText);
                        virtualObj.applist = jsonData.applist || {};
                        virtualObj.metadata = jsonData;
                        virtualObj.updateDate = jsonData.updateDate; // 更新日時を保存
                        // 実身名とlink_nameの同期: JSON.nameが存在し異なる場合はJSON.nameを優先
                        if (jsonData.name && virtualObj.link_name !== jsonData.name) {
                            virtualObj.link_name = jsonData.name;
                        }
                        logger.debug('[FIGURE EDITOR] メタデータ読み込み成功（親ウィンドウ経由）:', jsonFileName, virtualObj.applist);
                    } catch (parentError) {
                        logger.debug('[FIGURE EDITOR] 親ウィンドウ経由で失敗、HTTP fetchにフォールバック:', parentError.message);

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
                            logger.debug('[FIGURE EDITOR] Fetch URL試行:', jsonUrl);
                            const response = await fetch(jsonUrl);

                            if (response.ok) {
                                const jsonData = await response.json();
                                virtualObj.applist = jsonData.applist || {};
                                virtualObj.metadata = jsonData;
                                virtualObj.updateDate = jsonData.updateDate; // 更新日時を保存
                                // 実身名とlink_nameの同期: JSON.nameが存在し異なる場合はJSON.nameを優先
                                if (jsonData.name && virtualObj.link_name !== jsonData.name) {
                                    virtualObj.link_name = jsonData.name;
                                }
                                logger.debug('[FIGURE EDITOR] メタデータ読み込み成功（HTTP）:', jsonUrl, virtualObj.applist);
                                found = true;
                                break;
                            }
                        }

                        if (!found) {
                            logger.debug('[FIGURE EDITOR] JSONファイルなし（すべてのパスで404）:', virtualObj.link_id);
                            virtualObj.applist = {};
                        }
                    }
                }
            } else {
                // 親ウィンドウのfileObjectsにアクセスできない場合（親ウィンドウ経由で読み込み）
                logger.debug('[FIGURE EDITOR] 親ウィンドウのfileObjectsにアクセスできない、親ウィンドウ経由で読み込み');

                try {
                    const jsonFile = await this.loadDataFileFromParent(jsonFileName);
                    const jsonText = await jsonFile.text();
                    const jsonData = JSON.parse(jsonText);
                    virtualObj.applist = jsonData.applist || {};
                    virtualObj.metadata = jsonData;
                    virtualObj.updateDate = jsonData.updateDate; // 更新日時を保存
                    // 実身名とlink_nameの同期: JSON.nameが存在し異なる場合はJSON.nameを優先
                    if (jsonData.name && virtualObj.link_name !== jsonData.name) {
                        virtualObj.link_name = jsonData.name;
                    }
                    logger.debug('[FIGURE EDITOR] メタデータ読み込み成功（親ウィンドウ経由）:', jsonFileName, virtualObj.applist);
                } catch (error) {
                    logger.debug('[FIGURE EDITOR] メタデータ読み込み失敗:', virtualObj.link_id, error.message);
                    virtualObj.applist = {};
                }
            }
        } catch (error) {
            logger.debug('[FIGURE EDITOR] メタデータ読み込みエラー:', virtualObj.link_id, error);
            virtualObj.applist = {};
        }
    }
};
