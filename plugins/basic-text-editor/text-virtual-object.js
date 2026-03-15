/**
 * 基本文章編集プラグイン - 仮身処理系Mixin
expandVirtualObject, collapseVirtualObject等
 * @module TextVirtualObjectMixin
 */
const logger = window.getLogger('BasicTextEditor');

export const TextVirtualObjectMixin = (Base) => class extends Base {
    async expandVirtualObject(vo, width, height) {
        // 既に展開済みの場合はサイズだけ更新
        if (vo.classList.contains('expanded')) {
            const iframe = vo.querySelector('.virtual-object-content');
            if (iframe) {
                const titleBar = vo.querySelector('.virtual-object-titlebar');
                const chsz = parseFloat(vo.dataset.linkChsz) || DEFAULT_FONT_SIZE;
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

            let defaultOpen = this.getDefaultOpenFromAppList(appListData);
            if (!defaultOpen) {
                // appListの最初のプラグインをfallbackとして使用
                const pluginIds = Object.keys(appListData);
                if (pluginIds.length > 0) {
                    defaultOpen = pluginIds[0];
                    logger.warn('[EDITOR] defaultOpen未設定のためfallback使用:', defaultOpen, { realId, appListData });
                } else {
                    logger.warn('[EDITOR] appListが空です:', { realId, linkName: vo.dataset.linkName });
                    vo.classList.remove('expanded');
                    this.setStatus(`仮身のデフォルト起動アプリが設定されていません: ${realId}`);
                    return;
                }
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
            const frcol = vo.dataset.linkFrcol || DEFAULT_FRCOL;
            const chcol = vo.dataset.linkChcol || DEFAULT_CHCOL;
            const tbcol = vo.dataset.linkTbcol || DEFAULT_TBCOL;
            const bgcol = vo.dataset.linkBgcol || DEFAULT_BGCOL;
            const chsz = parseFloat(vo.dataset.linkChsz) || DEFAULT_FONT_SIZE;

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
        const frcol = vo.dataset.linkFrcol || DEFAULT_FRCOL;
        const chcol = vo.dataset.linkChcol || DEFAULT_CHCOL;
        const tbcol = vo.dataset.linkTbcol || DEFAULT_TBCOL;
        const chsz = parseFloat(vo.dataset.linkChsz) || DEFAULT_FONT_SIZE;
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

        const frcol = element.dataset.linkFrcol || vobj.frcol || DEFAULT_FRCOL;
        const chcol = element.dataset.linkChcol || vobj.chcol || DEFAULT_CHCOL;
        const tbcol = element.dataset.linkTbcol || vobj.tbcol || DEFAULT_TBCOL;
        const bgcol = element.dataset.linkBgcol || vobj.bgcol || DEFAULT_BGCOL;
        const chsz = element.dataset.linkChsz ? parseFloat(element.dataset.linkChsz) : (parseFloat(vobj.chsz) || DEFAULT_FONT_SIZE);

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
            vobjbottom: parseInt(element.dataset.linkVobjbottom) || vobj.vobjbottom || DEFAULT_VOBJ_HEIGHT,
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
                    heightPx: originalVobj.heightPx || DEFAULT_VOBJ_HEIGHT,
                    chsz: originalVobj.chsz || DEFAULT_FONT_SIZE,
                    frcol: originalVobj.frcol || DEFAULT_FRCOL,
                    chcol: originalVobj.chcol || DEFAULT_CHCOL,
                    tbcol: originalVobj.tbcol || DEFAULT_TBCOL,
                    bgcol: originalVobj.bgcol || DEFAULT_BGCOL,
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
                    heightPx: virtualObj.heightPx || DEFAULT_VOBJ_HEIGHT,
                    chsz: virtualObj.chsz || DEFAULT_FONT_SIZE,
                    frcol: virtualObj.frcol || DEFAULT_FRCOL,
                    chcol: virtualObj.chcol || DEFAULT_CHCOL,
                    tbcol: virtualObj.tbcol || DEFAULT_TBCOL,
                    bgcol: virtualObj.bgcol || DEFAULT_BGCOL,
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
};
