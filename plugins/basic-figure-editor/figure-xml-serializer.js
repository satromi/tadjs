/**
 * 基本図形編集プラグイン - XML保存系Mixin
 * saveFile, convertToXmlTad, shapeToXML等
 * @module FigureXmlSerializerMixin
 */
const logger = window.getLogger('BasicFigureEditor');

export const FigureXmlSerializerMixin = (Base) => class extends Base {
    async saveFile() {
        // 保存時にスクロール位置も保存
        this.saveScrollPosition();

        try {
            logger.debug('[FIGURE EDITOR] 保存処理開始, realId:', this.realId);

            if (!this.realId) {
                logger.warn('[FIGURE EDITOR] realIdが未設定のため保存をスキップ');
                this.setStatus('保存に失敗しました（realId未設定）');
                return;
            }

            // 図形データをXMLに変換（画像保存完了を待機）
            const xmlData = await this.convertToXmlTad();

            // 親ウィンドウにXMLデータを送信
            if (this.messageBus) {
                this.messageBus.send('xml-data-changed', {
                    xmlData: xmlData,
                    fileId: this.realId
                });
            }

            this.originalContent = JSON.stringify(this.shapes);
            this.isModified = false;
            this.setStatus('保存しました');

        } catch (error) {
            logger.error('[FIGURE EDITOR] 保存エラー:', error);
            this.setStatus('保存に失敗しました');
        }
    }

    async saveAsNewRealObject() {
        if (!this.realId && !this.realId) {
            logger.warn('[FIGURE EDITOR] 保存するデータがありません');
            this.setStatus('保存するデータがありません');
            return;
        }

        // realIdが未設定の場合はfileIdを使用
        const realIdToUse = this.realId || this.realId;
        logger.debug('[FIGURE EDITOR] saveAsNewRealObject - realId:', this.realId, 'fileId:', this.realId, '使用:', realIdToUse);

        try {
            // まず現在のデータを保存（画像保存完了を待機）
            const xmlData = await this.convertToXmlTad();
            if (this.messageBus) {
                this.messageBus.send('xml-data-changed', {
                    xmlData: xmlData,
                    fileId: this.realId
                });
            }

            this.originalContent = JSON.stringify(this.shapes);
            this.isModified = false;

            // 選択されている仮身を取得
            const selectedVobjShape = this.selectedShapes.find(shape => shape.type === 'vobj');
            if (!selectedVobjShape) {
                logger.warn('[FIGURE EDITOR] 仮身が選択されていません');
                this.setStatus('仮身を選択してください');
                return;
            }

            // 親ウィンドウに新たな実身への保存を要求
            const messageId = this.generateMessageId('save-as-new');

            // 親ウィンドウに保存を要求
            if (this.messageBus) {
                this.messageBus.send('save-as-new-real-object', {
                    realId: realIdToUse,
                    messageId: messageId
                });
            }

            this.setStatus('新しい実身への保存を準備中...');

            // レスポンスを待つ（ユーザー入力を待つのでタイムアウト無効）
            const result = await this.messageBus.waitFor('save-as-new-real-object-completed', 0, (data) => {
                return data.messageId === messageId;
            });

            if (result.cancelled) {
                this.setStatus('保存がキャンセルされました');
            } else if (result.success) {
                this.setStatus('新しい実身に保存しました: ' + result.newName);
                logger.debug('[FIGURE EDITOR] 新しい実身に保存成功:', result.newRealId);

                // 元の仮身の属性をコピーして新しい仮身を作成
                const originalVobj = selectedVobjShape.virtualObject;
                const newVirtualObject = {
                    link_id: `${result.newRealId}_0.xtad`,
                    link_name: result.newName,
                    chsz: originalVobj.chsz || DEFAULT_FONT_SIZE,
                    frcol: originalVobj.frcol || DEFAULT_FRCOL,
                    chcol: originalVobj.chcol || DEFAULT_FRCOL,
                    tbcol: originalVobj.tbcol || DEFAULT_BGCOL,
                    bgcol: originalVobj.bgcol || DEFAULT_BGCOL,
                    pictdisp: originalVobj.pictdisp || 'true',
                    namedisp: originalVobj.namedisp || 'true',
                    roledisp: originalVobj.roledisp || 'false',
                    framedisp: originalVobj.framedisp || 'true',
                    typedisp: originalVobj.typedisp || 'false',
                    updatedisp: originalVobj.updatedisp || 'false',
                    dlen: originalVobj.dlen || 0,
                    applist: originalVobj.applist || {}
                };

                // 元の仮身の下に配置（10px下）
                const chszPx = (newVirtualObject.chsz || DEFAULT_FONT_SIZE) * (96 / 72);
                const lineHeight = 1.2;
                const textHeight = Math.ceil(chszPx * lineHeight);
                const newHeight = textHeight + 8;

                const newVobjShape = {
                    type: 'vobj',
                    startX: selectedVobjShape.startX,
                    startY: selectedVobjShape.endY + 10,
                    endX: selectedVobjShape.endX,
                    endY: selectedVobjShape.endY + 10 + newHeight,
                    virtualObject: newVirtualObject,
                    strokeColor: newVirtualObject.frcol,
                    textColor: newVirtualObject.chcol,
                    fillColor: newVirtualObject.tbcol,
                    lineWidth: 1,
                    originalHeight: newHeight,
                    zIndex: this.getNextZIndex()
                };

                // 図形に追加
                this.shapes.push(newVobjShape);

                // アイコンを事前読み込み
                const realId = this.extractRealId(result.newRealId);
                this.iconManager.loadIcon(realId).then(iconData => {
                    if (iconData && this.virtualObjectRenderer) {
                        this.virtualObjectRenderer.loadIconToCache(realId, iconData);
                    }
                    // 再描画
                    this.redraw();
                });

                // XMLデータを更新（画像保存完了を待機）
                const updatedXmlData = await this.convertToXmlTad();
                if (this.messageBus) {
                    this.messageBus.send('xml-data-changed', {
                        xmlData: updatedXmlData,
                        fileId: this.realId
                    });
                }

                this.originalContent = JSON.stringify(this.shapes);
                this.isModified = false;
            } else {
                this.setStatus('新しい実身への保存に失敗しました');
                logger.error('[FIGURE EDITOR] 新しい実身への保存失敗');
            }

        } catch (error) {
            logger.error('[FIGURE EDITOR] 新しい実身への保存エラー:', error);
            this.setStatus('新しい実身への保存に失敗しました');
        }
    }

    /**
     * 指定図形をxmlTAD文字列に変換（クリップボード用）
     * @param {Array} shapes - 変換対象の図形配列
     * @returns {string|null} xmlTAD文字列
     */
    async convertSelectedShapesToXmlTad(shapes) {
        if (!shapes || shapes.length === 0) return null;

        // バウンディングボックスを計算
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const shape of shapes) {
            if (shape.startX !== undefined) {
                minX = Math.min(minX, Math.min(shape.startX, shape.endX));
                minY = Math.min(minY, Math.min(shape.startY, shape.endY));
                maxX = Math.max(maxX, Math.max(shape.startX, shape.endX));
                maxY = Math.max(maxY, Math.max(shape.startY, shape.endY));
            }
            if (shape.points) {
                for (const p of shape.points) {
                    minX = Math.min(minX, p.x);
                    minY = Math.min(minY, p.y);
                    maxX = Math.max(maxX, p.x);
                    maxY = Math.max(maxY, p.y);
                }
            }
        }

        const figLeft = minX === Infinity ? 0 : Math.floor(minX);
        const figTop = minY === Infinity ? 0 : Math.floor(minY);
        const figRight = maxX === -Infinity ? 800 : Math.ceil(maxX);
        const figBottom = maxY === -Infinity ? 600 : Math.ceil(maxY);

        const xmlParts = ['<tad version="1.0" encoding="UTF-8">\r\n'];
        const savePromises = [];
        xmlParts.push('<figure>\r\n');
        xmlParts.push(`<figView top="${figTop}" left="${figLeft}" right="${figRight}" bottom="${figBottom}"/>\r\n`);
        xmlParts.push(`<figDraw top="${figTop}" left="${figLeft}" right="${figRight}" bottom="${figBottom}"/>\r\n`);
        xmlParts.push('<figScale hunit="-72" vunit="-72"/>\r\n');

        // マーカー定義を出力
        for (const [id, mdef] of this.markerDefinitions) {
            let xml = `<markerDefine type="${mdef.type}" id="${mdef.id}" size="${mdef.size}" fgCol="${mdef.fgCol}"`;
            if (mdef.mask !== undefined) {
                xml += ` mask="${mdef.mask}"`;
            }
            xml += ` />\r\n`;
            xmlParts.push(xml);
        }

        for (let index = 0; index < shapes.length; index++) {
            await this.shapeToXML(shapes[index], index, xmlParts, savePromises);
        }

        xmlParts.push('</figure>\r\n');
        xmlParts.push('</tad>');

        if (savePromises.length > 0) {
            await Promise.all(savePromises);
        }

        return xmlParts.join('');
    }

    async convertToXmlTad() {
        // 図形データをTAD XML形式に変換（配列を使用して高速化）
        const xmlParts = ['<tad version="1.0" encoding="UTF-8">\r\n'];
        const savePromises = [];

        // 用紙設定が設定されている場合のみ<paper>要素を出力
        if (this.paperSize) {
            xmlParts.push(this.paperSize.toXmlString() + '\r\n');
        }

        // 用紙設定が設定されている場合、または既存のマージン設定がある場合のみ<docmargin>要素を出力
        if (this.paperMargin || this.paperSize) {
            const margin = this.paperMargin || new window.PaperMargin();
            xmlParts.push(`<docmargin top="${margin.top}" bottom="${margin.bottom}" left="${margin.left}" right="${margin.right}" />\r\n`);
        }

        // 図形セグメント開始
        if (this.shapes.length > 0) {
            xmlParts.push('<figure>\r\n');
            xmlParts.push(`<figView top="0" left="0" right="${this.canvas.width}" bottom="${this.canvas.height}"/>\r\n`);
            xmlParts.push(`<figDraw top="0" left="0" right="${this.canvas.width}" bottom="${this.canvas.height}"/>\r\n`);
            // figScale出力（UNITS型: デフォルト-72 = 72DPI）
            const figScaleHunit = this.figScale?.hunit ?? -72;
            const figScaleVunit = this.figScale?.vunit ?? -72;
            xmlParts.push(`<figScale hunit="${figScaleHunit}" vunit="${figScaleVunit}"/>\r\n`);

            // 全shapeのパターンIDを事前解決（<patterns>セクション出力前に必要なパターンを確定させる）
            const usedCustomPatternIds = new Set();
            for (const shape of this.shapes) {
                // strokeColor → linePatternId の事前解決
                if (!(shape.linePatternId >= 1)) {
                    const strokeCol = shape.strokeColor || DEFAULT_FRCOL;
                    if (strokeCol.toLowerCase() === '#000000' || strokeCol.toLowerCase() === DEFAULT_FRCOL.toLowerCase()) {
                        shape.linePatternId = 1;
                    } else {
                        shape.linePatternId = this.getOrCreateSolidColorPattern(strokeCol);
                    }
                }
                if (shape.linePatternId >= 128) usedCustomPatternIds.add(shape.linePatternId);
                // fillColor → fillPatternId の事前解決
                const fillEnabled = shape.fillEnabled !== undefined ? shape.fillEnabled : true;
                if (!(shape.fillPatternId >= 1) && fillEnabled) {
                    shape.fillPatternId = this.getOrCreateSolidColorPattern(shape.fillColor || DEFAULT_BGCOL);
                }
                if (shape.fillPatternId >= 128) usedCustomPatternIds.add(shape.fillPatternId);
            }

            // 未使用カスタムパターンを除去し、IDを128から詰め直す
            const oldCustomIds = Object.keys(this.customPatterns).map(Number).filter(id => id >= 128).sort((a, b) => a - b);
            const patternIdMapping = {};
            let nextPatId = 128;
            const compactedPatterns = {};
            // ID 128未満のパターンはそのまま保持
            for (const [id, pat] of Object.entries(this.customPatterns)) {
                if (Number(id) < 128) compactedPatterns[Number(id)] = pat;
            }
            for (const oldId of oldCustomIds) {
                if (!usedCustomPatternIds.has(oldId)) continue;
                patternIdMapping[oldId] = nextPatId;
                compactedPatterns[nextPatId] = { ...this.customPatterns[oldId], id: nextPatId };
                nextPatId++;
            }
            this.customPatterns = compactedPatterns;
            // shapeのパターンIDを新IDに更新
            for (const shape of this.shapes) {
                if (shape.linePatternId >= 128 && patternIdMapping[shape.linePatternId] !== undefined) {
                    shape.linePatternId = patternIdMapping[shape.linePatternId];
                }
                if (shape.fillPatternId >= 128 && patternIdMapping[shape.fillPatternId] !== undefined) {
                    shape.fillPatternId = patternIdMapping[shape.fillPatternId];
                }
            }

            // カスタムパターン・マスクセクション出力（figScale直後、図形要素より前に配置）
            const customMaskIds = Object.keys(this.customMasks).map(Number).sort((a, b) => a - b);
            const customPatternIds = Object.keys(this.customPatterns).map(Number).sort((a, b) => a - b);
            if (customMaskIds.length > 0 || customPatternIds.length > 0) {
                xmlParts.push('<patterns>\r\n');
                // カスタムマスク定義を出力（16bitワード値スペース区切り）
                for (const maskId of customMaskIds) {
                    const m = this.customMasks[maskId];
                    if (m && m.wordValues) {
                        const hexData = m.wordValues.map(v => v.toString(16).padStart(4, '0'));
                        xmlParts.push(`<mask id="${m.id}" type="${m.type}" width="${m.width}" height="${m.height}" data="${hexData.join(',')}" />\r\n`);
                    }
                }
                // カラーパターン定義を出力（TADパラメータ形式）
                for (const patId of customPatternIds) {
                    const pat = this.customPatterns[patId];
                    if (!pat) continue;
                    const w = pat.width || 16;
                    const h = pat.height || 16;
                    if (pat.ncol !== undefined) {
                        // TADパラメータがある場合はそのまま出力
                        xmlParts.push(`<pattern id="${patId}" type="0" width="${w}" height="${h}" ncol="${pat.ncol}" fgcolors="${pat.fgcolors || ''}" bgcolor="${pat.bgcolor || ''}" masks="${pat.masks || ''}" />\r\n`);
                    } else if (pat.pixelColors) {
                        // パターンエディタで新規作成されたパターン（TADパラメータなし）
                        // pixelColorsからTADパラメータを生成
                        const tadParams = this.pixelColorsToTadParams(pat.pixelColors, w, h);
                        xmlParts.push(`<pattern id="${patId}" type="0" width="${w}" height="${h}" ncol="${tadParams.ncol}" fgcolors="${tadParams.fgcolors}" bgcolor="${tadParams.bgcolor}" masks="${tadParams.masks}" />\r\n`);
                        // 生成されたマスク定義も出力
                        for (const maskDef of tadParams.maskDefs) {
                            const hexData = maskDef.wordValues.map(v => v.toString(16).padStart(4, '0'));
                            xmlParts.push(`<mask id="${maskDef.id}" type="0" width="${w}" height="${h}" data="${hexData.join(',')}" />\r\n`);
                        }
                    }
                }
                xmlParts.push('</patterns>\r\n');
            }

            // マーカー定義を出力
            for (const [id, mdef] of this.markerDefinitions) {
                let xml = `<markerDefine type="${mdef.type}" id="${mdef.id}" size="${mdef.size}" fgCol="${mdef.fgCol}"`;
                if (mdef.mask !== undefined) {
                    xml += ` mask="${mdef.mask}"`;
                }
                xml += ` />\r\n`;
                xmlParts.push(xml);
            }

            // 各図形を追加
            for (let index = 0; index < this.shapes.length; index++) {
                await this.shapeToXML(this.shapes[index], index, xmlParts, savePromises);
            }

            xmlParts.push('</figure>\r\n');
        }

        xmlParts.push('</tad>');

        // 全画像保存の完了を待つ
        if (savePromises.length > 0) {
            await Promise.all(savePromises);
        }

        return xmlParts.join('');
    }

    getOrCreateSolidColorPattern(color) {
        if (!color || color === 'transparent') return 0;
        // DEFAULT_PATTERNSからソリッドカラーパターンを検索
        if (typeof findSolidColorPatternId === 'function') {
            const defaultId = findSolidColorPatternId(color);
            if (defaultId > 0) return defaultId;
        }
        // customPatternsから検索
        for (const [id, pat] of Object.entries(this.customPatterns)) {
            if (pat.type === 'solid' && pat.color && pat.color.toLowerCase() === color.toLowerCase()) return parseInt(id);
        }
        // 見つからない場合: カスタムパターンとして生成
        let nextId = 128;
        while (this.customPatterns[nextId]) nextId++;
        this.customPatterns[nextId] = {
            id: nextId,
            type: 'solid',
            color: color,
            ncol: 1,
            fgcolors: color,
            bgcolor: 'transparent',
            masks: ''
        };
        return nextId;
    }

    async shapeToXML(shape, index, xmlParts, savePromises = null) {
        // 図形の線種・線幅（TAD仕様: 上位8bit=線種、下位8bit=線幅）
        const lineType = shape.lineType || 0;
        const lineWidth = shape.lineWidth || 1;
        // 線カラーパターン: strokeColorをl_patに変換
        let l_pat;
        if (shape.linePatternId >= 1) {
            l_pat = shape.linePatternId;
        } else {
            const strokeCol = shape.strokeColor || DEFAULT_FRCOL;
            if (strokeCol.toLowerCase() === '#000000' || strokeCol.toLowerCase() === DEFAULT_FRCOL.toLowerCase()) {
                l_pat = 1; // 黒ソリッド = パターンID 1
            } else {
                l_pat = this.getOrCreateSolidColorPattern(strokeCol);
            }
        }
        // 塗りパターン: 0=透明, 1+=パターンID
        const fillEnabled = shape.fillEnabled !== undefined ? shape.fillEnabled : true;
        let f_pat;
        if (shape.fillPatternId >= 1) {
            f_pat = shape.fillPatternId;
        } else if (fillEnabled) {
            // ソリッド塗り → 対応するパターンIDを取得/生成
            f_pat = this.getOrCreateSolidColorPattern(shape.fillColor || DEFAULT_BGCOL);
        } else {
            f_pat = 0; // 透明
        }
        // 角度
        const angle = shape.angle || 0;

        switch (shape.type) {
            case 'line':
                // tad.js形式: <line l_atr="..." l_pat="..." f_pat="0" strokeColor="..." start_arrow="0" end_arrow="0" conn_pat="..." start_conn="..." end_conn="..." points="x1,y1 x2,y2" />
                const linePoints = `${shape.startX},${shape.startY} ${shape.endX},${shape.endY}`;
                // 接続状態を計算: 0=両端接続無し, 1=開始点のみ接続, 2=終端点のみ接続, 3=両端接続
                let conn_pat = 0;
                let start_conn = '';
                let end_conn = '';

                if (shape.startConnection && shape.endConnection) {
                    conn_pat = 3;
                } else if (shape.startConnection) {
                    conn_pat = 1;
                } else if (shape.endConnection) {
                    conn_pat = 2;
                }

                // 開始点の接続情報を保存 (format: "shapeId,connectorIndex")
                if (shape.startConnection) {
                    start_conn = `${shape.startConnection.shapeId},${shape.startConnection.connectorIndex}`;
                }

                // 終端点の接続情報を保存 (format: "shapeId,connectorIndex")
                if (shape.endConnection) {
                    end_conn = `${shape.endConnection.shapeId},${shape.endConnection.connectorIndex}`;
                }

                // 接続形状を保存 (straight, elbow, curve)
                const lineConnectionType = shape.lineConnectionType || 'straight';

                // 矢印情報を取得
                const start_arrow = shape.start_arrow || 0;
                const end_arrow = shape.end_arrow || 0;
                const arrow_type = shape.arrow_type || 'simple';

                // z-index属性を追加
                const zIndexAttr = shape.zIndex !== undefined && shape.zIndex !== null ? ` zIndex="${shape.zIndex}"` : '';
                xmlParts.push(`<line lineType="${lineType}" lineWidth="${lineWidth}" l_pat="${l_pat}" f_pat="0" start_arrow="${start_arrow}" end_arrow="${end_arrow}" arrow_type="${arrow_type}" conn_pat="${conn_pat}" start_conn="${start_conn}" end_conn="${end_conn}" lineConnectionType="${lineConnectionType}" points="${linePoints}"${zIndexAttr} />\r\n`);
                break;

            case 'rect':
            case 'roundRect':
                // tad.js形式: <rect round="0/1" cornerRadius="..." l_atr="..." l_pat="..." f_pat="..." angle="..." fillColor="..." strokeColor="..." left="..." top="..." right="..." bottom="..." />
                const round = shape.cornerRadius && shape.cornerRadius > 0 ? 1 : 0;
                const cornerRadius = shape.cornerRadius || 0;
                const rectZIndexAttr = shape.zIndex !== undefined && shape.zIndex !== null ? ` zIndex="${shape.zIndex}"` : '';
                const rectRotation = shape.rotation || 0;
                xmlParts.push(`<rect round="${round}" cornerRadius="${cornerRadius}" lineType="${lineType}" lineWidth="${lineWidth}" l_pat="${l_pat}" f_pat="${f_pat}" angle="${angle}" rotation="${rectRotation}" left="${shape.startX}" top="${shape.startY}" right="${shape.endX}" bottom="${shape.endY}"${rectZIndexAttr} />\r\n`);
                break;

            case 'ellipse':
                const cx = (shape.startX + shape.endX) / 2;
                const cy = (shape.startY + shape.endY) / 2;
                const rx = Math.abs(shape.endX - shape.startX) / 2;
                const ry = Math.abs(shape.endY - shape.startY) / 2;
                // tad.js形式: <ellipse l_atr="..." l_pat="..." f_pat="..." angle="..." fillColor="..." strokeColor="..." cx="..." cy="..." rx="..." ry="..." />
                const ellipseZIndexAttr = shape.zIndex !== undefined && shape.zIndex !== null ? ` zIndex="${shape.zIndex}"` : '';
                const ellipseRotation = shape.rotation || 0;
                xmlParts.push(`<ellipse lineType="${lineType}" lineWidth="${lineWidth}" l_pat="${l_pat}" f_pat="${f_pat}" angle="${angle}" rotation="${ellipseRotation}" cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"${ellipseZIndexAttr} />\r\n`);
                break;

            case 'text':
                // テキストは文章セグメントとして出力（document形式）
                {
                    const textContent = this.escapeXml(shape.text);
                    // フォントサイズを抽出（例: "16px sans-serif" → 16）
                    const fontSizeMatch = String(shape.fontSize).match(/(\d+)/);
                    const fontSize = fontSizeMatch ? parseInt(fontSizeMatch[1]) : 16;
                    // テキスト幅を推定（文字数 × フォントサイズ × 0.6）
                    const estimatedWidth = Math.max((textContent.length || 1) * fontSize * 0.6, 50);
                    const estimatedHeight = fontSize * 1.5;

                    const left = Math.round(shape.startX);
                    const top = Math.round(shape.startY);
                    const right = Math.round(shape.startX + estimatedWidth);
                    const bottom = Math.round(shape.startY + estimatedHeight);

                    xmlParts.push('<document>\r\n');
                    xmlParts.push(this.generateDocViewDrawScale(left, top, right, bottom));
                    xmlParts.push(this.generateTextElement({ zIndex: shape.zIndex }));
                    xmlParts.push(`<font size="${fontSize}"/>\r\n`);
                    xmlParts.push(`<font color="${shape.strokeColor || DEFAULT_FRCOL}"/>\r\n`);
                    xmlParts.push(`${textContent}\r\n`);
                    xmlParts.push('</document>\r\n');
                }
                break;

            case 'pencil':
            case 'brush':
                // 折れ線として出力 (tad.js形式: <polyline l_atr="..." l_pat="..." strokeColor="..." round="0" start_arrow="0" end_arrow="0" points="x1,y1 x2,y2 ..." />)
                if (shape.path && shape.path.length > 0) {
                    const polylinePoints = shape.path.map(p => `${p.x},${p.y}`).join(' ');
                    const polylineZIndexAttr = shape.zIndex !== undefined && shape.zIndex !== null ? ` zIndex="${shape.zIndex}"` : '';
                    const pencilRotation = shape.rotation || 0;
                    xmlParts.push(`<polyline lineType="${lineType}" lineWidth="${lineWidth}" l_pat="${l_pat}" round="0" start_arrow="0" end_arrow="0" rotation="${pencilRotation}" points="${polylinePoints}"${polylineZIndexAttr} />\r\n`);
                }
                break;

            case 'polyline':
                // 折れ線として出力（グラフからのコピー等）- shape.pointsを使用
                if (shape.points && shape.points.length > 0) {
                    const polylinePointsStr = shape.points.map(p => `${p.x},${p.y}`).join(' ');
                    const polylineZIndexAttr2 = shape.zIndex !== undefined && shape.zIndex !== null ? ` zIndex="${shape.zIndex}"` : '';
                    const polylineRotation = shape.rotation || 0;
                    xmlParts.push(`<polyline lineType="${lineType}" lineWidth="${lineWidth}" l_pat="${l_pat}" round="0" start_arrow="0" end_arrow="0" rotation="${polylineRotation}" points="${polylinePointsStr}"${polylineZIndexAttr2} />\r\n`);
                }
                break;

            case 'curve':
                // スプライン曲線として出力 (tad.js形式: <curve l_atr="..." l_pat="..." f_pat="..." fillColor="..." strokeColor="..." type="..." closed="..." points="x1,y1 x2,y2 ..." />)
                if (shape.path && shape.path.length > 0) {
                    const curvePoints = shape.path.map(p => `${p.x},${p.y}`).join(' ');
                    const curveZIndexAttr = shape.zIndex !== undefined && shape.zIndex !== null ? ` zIndex="${shape.zIndex}"` : '';
                    const curveRotation = shape.rotation || 0;
                    xmlParts.push(`<curve lineType="${lineType}" lineWidth="${lineWidth}" l_pat="${l_pat}" f_pat="${f_pat}" type="0" closed="0" start_arrow="0" end_arrow="0" rotation="${curveRotation}" points="${curvePoints}"${curveZIndexAttr} />\r\n`);
                }
                break;

            case 'polygon':
                // tad.js形式: <polygon l_atr="..." l_pat="..." f_pat="..." cornerRadius="..." fillColor="..." strokeColor="..." points="x1,y1 x2,y2 ..." />
                if (shape.points && shape.points.length > 0) {
                    const polygonPoints = shape.points.map(p => `${p.x},${p.y}`).join(' ');
                    const polygonCornerRadius = shape.cornerRadius || 0;
                    const polygonZIndexAttr = shape.zIndex !== undefined && shape.zIndex !== null ? ` zIndex="${shape.zIndex}"` : '';
                    const polygonRotation = shape.rotation || 0;
                    xmlParts.push(`<polygon lineType="${lineType}" lineWidth="${lineWidth}" l_pat="${l_pat}" f_pat="${f_pat}" cornerRadius="${polygonCornerRadius}" rotation="${polygonRotation}" points="${polygonPoints}"${polygonZIndexAttr} />\r\n`);
                }
                break;

            case 'triangle':
                // 三角形はpolygonとして保存
                const triSaveWidth = shape.endX - shape.startX;
                let triangleSavePoints;

                if (triSaveWidth >= 0) {
                    // 右ドラッグ: 直角が左端（startX位置）
                    triangleSavePoints = `${shape.startX},${shape.startY} ${shape.startX},${shape.endY} ${shape.endX},${shape.endY}`;
                } else {
                    // 左ドラッグ: 直角が右端（startX位置、startXが右側なので）
                    triangleSavePoints = `${shape.startX},${shape.startY} ${shape.startX},${shape.endY} ${shape.endX},${shape.endY}`;
                }

                const triangleZIndexAttr = shape.zIndex !== undefined && shape.zIndex !== null ? ` zIndex="${shape.zIndex}"` : '';
                const triangleRotation = shape.rotation || 0;
                xmlParts.push(`<polygon lineType="${lineType}" lineWidth="${lineWidth}" l_pat="${l_pat}" f_pat="${f_pat}" cornerRadius="0" rotation="${triangleRotation}" points="${triangleSavePoints}"${triangleZIndexAttr} />\r\n`);
                break;

            case 'arc':
            case 'chord':
            case 'elliptical_arc':
                // 中心座標と半径を計算
                const acCenterX = shape.centerX || (shape.startX + shape.endX) / 2;
                const acCenterY = shape.centerY || (shape.startY + shape.endY) / 2;
                const acRadiusX = shape.radiusX || Math.abs(shape.endX - shape.startX) / 2;
                const acRadiusY = shape.radiusY || Math.abs(shape.endY - shape.startY) / 2;
                const acStartAngle = shape.startAngle || 0;
                const acEndAngle = shape.endAngle || 90;
                const arcZIndexAttr = shape.zIndex !== undefined && shape.zIndex !== null ? ` zIndex="${shape.zIndex}"` : '';

                if (shape.type === 'arc') {
                    // 扇形
                    xmlParts.push(`<arc lineType="${lineType}" lineWidth="${lineWidth}" l_pat="${l_pat}" f_pat="${f_pat}" angle="${shape.angle || 0}" cx="${acCenterX}" cy="${acCenterY}" rx="${acRadiusX}" ry="${acRadiusY}" startAngle="${acStartAngle}" endAngle="${acEndAngle}" start_arrow="0" end_arrow="0"${arcZIndexAttr} />\r\n`);
                } else if (shape.type === 'chord') {
                    // 弦
                    xmlParts.push(`<chord lineType="${lineType}" lineWidth="${lineWidth}" l_pat="${l_pat}" f_pat="${f_pat}" angle="${shape.angle || 0}" cx="${acCenterX}" cy="${acCenterY}" rx="${acRadiusX}" ry="${acRadiusY}" startAngle="${acStartAngle}" endAngle="${acEndAngle}" start_arrow="0" end_arrow="0"${arcZIndexAttr} />\r\n`);
                } else {
                    // 楕円弧
                    xmlParts.push(`<elliptical_arc lineType="${lineType}" lineWidth="${lineWidth}" l_pat="${l_pat}" angle="${shape.angle || 0}" cx="${acCenterX}" cy="${acCenterY}" rx="${acRadiusX}" ry="${acRadiusY}" startAngle="${acStartAngle}" endAngle="${acEndAngle}" start_arrow="0" end_arrow="0"${arcZIndexAttr} />\r\n`);
                }
                break;

            case 'vobj':
                // tad.js形式: <link id="..." vobjleft="..." vobjtop="..." vobjright="..." vobjbottom="...">
                if (shape.virtualObject) {
                    const vo = shape.virtualObject;
                    const height = shape.endY - shape.startY;
                    // 保護属性を追加
                    const fixedAttr = shape.locked ? ' fixed="true"' : '';
                    const backgroundAttr = shape.isBackground ? ' background="true"' : '';
                    // z-index属性を追加
                    const zIndexAttr = shape.zIndex !== undefined && shape.zIndex !== null ? ` zIndex="${shape.zIndex}"` : '';
                    // 仮身固有の続柄属性を追加
                    const relationshipAttr = vo.linkRelationship && vo.linkRelationship.length > 0
                        ? ` relationship="${vo.linkRelationship.join(' ')}"`
                        : '';
                    // 自己閉じタグ形式（link_nameはJSONから取得する方式に統一）、dlen=0
                    xmlParts.push(`<link id="${vo.link_id}" vobjleft="${shape.startX}" vobjtop="${shape.startY}" vobjright="${shape.endX}" vobjbottom="${shape.endY}" height="${height}" chsz="${vo.chsz || DEFAULT_FONT_SIZE}" frcol="${vo.frcol || DEFAULT_FRCOL}" chcol="${vo.chcol || DEFAULT_FRCOL}" tbcol="${vo.tbcol || DEFAULT_BGCOL}" bgcol="${vo.bgcol || DEFAULT_BGCOL}" dlen="0" pictdisp="${vo.pictdisp || 'true'}" namedisp="${vo.namedisp || 'true'}" roledisp="${vo.roledisp || 'false'}" typedisp="${vo.typedisp || 'false'}" updatedisp="${vo.updatedisp || 'false'}" framedisp="${vo.framedisp || 'true'}" autoopen="${vo.autoopen || 'false'}"${relationshipAttr}${fixedAttr}${backgroundAttr}${zIndexAttr}/>\r\n`);
                }
                break;

            case 'image':
                // 画像セグメント - tadjs-viewと同じ形式
                if (shape.fileName) {
                    const rotation = shape.rotation || 0;
                    const flipH = shape.flipH ? 'true' : 'false';
                    const flipV = shape.flipV ? 'true' : 'false';
                    // z-index属性を追加
                    const zIndexAttr = shape.zIndex !== undefined && shape.zIndex !== null ? ` zIndex="${shape.zIndex}"` : '';
                    xmlParts.push(`<image lineType="${lineType}" lineWidth="${lineWidth}" l_pat="${l_pat}" f_pat="${f_pat}" angle="${angle}" rotation="${rotation}" flipH="${flipH}" flipV="${flipV}" left="${shape.startX}" top="${shape.startY}" right="${shape.endX}" bottom="${shape.endY}" href="${this.escapeXml(shape.fileName)}"${zIndexAttr} />\r\n`);
                }
                break;

            case 'document':
                // 文字枠 - TAD.js形式に準拠
                // 1. document要素で文章セグメントを開始
                if (shape.content && shape.content.trim() !== '') {
                    xmlParts.push(`<document>\r\n`);

                    // 2. docView/docDraw/docScale/text形式で位置を定義
                    const textboxZIndexAttr = shape.zIndex !== undefined && shape.zIndex !== null ? ` zIndex="${shape.zIndex}"` : '';
                    xmlParts.push(`<docView viewleft="${shape.startX}" viewtop="${shape.startY}" viewright="${shape.endX}" viewbottom="${shape.endY}"/>\r\n`);
                    xmlParts.push(`<docDraw drawleft="${shape.startX}" drawtop="${shape.startY}" drawright="${shape.endX}" drawbottom="${shape.endY}"/>\r\n`);
                    // 文字枠内docScaleは親figScaleの座標系を継承（UNITS型: デフォルト-72 = 72DPI）
                    const docScaleHunit = this.figScale?.hunit ?? -72;
                    const docScaleVunit = this.figScale?.vunit ?? -72;
                    xmlParts.push(`<docScale hunit="${docScaleHunit}" vunit="${docScaleVunit}"/>\r\n`);
                    xmlParts.push(`<text lang="0" bpat="0"${textboxZIndexAttr}/>\r\n`);

                    // 3. フォント設定
                    const fontSize = shape.fontSize || 16;
                    const fontFamily = shape.fontFamily || 'sans-serif';
                    const textColor = shape.textColor || DEFAULT_FRCOL;
                    xmlParts.push(`<font size="${fontSize}"/>\r\n`);
                    xmlParts.push(`<font face="${this.escapeXml(fontFamily)}"/>\r\n`);
                    xmlParts.push(`<font color="${this.escapeXml(textColor)}"/>\r\n`);

                    // 4. テキスト配置（textAlign）
                    const textAlign = shape.textAlign || 'left';
                    if (textAlign !== 'left') {
                        xmlParts.push(`<text align="${textAlign}"/>\r\n`);
                    }

                    // 5. 文字修飾の開始タグ
                    const decorations = shape.decorations || {};
                    if (decorations.underline) {
                        xmlParts.push(`<underline>\r\n`);
                    }
                    if (decorations.strikethrough) {
                        xmlParts.push(`<strikethrough>\r\n`);
                    }

                    // 6. テキスト内容（\r\nは無視し、改行は<br/>、改段落は<p></p>で処理）
                    // \r\nを\nに正規化してから分割
                    const normalizedContent = shape.content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
                    const lines = normalizedContent.split('\n');
                    for (let i = 0; i < lines.length; i++) {
                        if (i > 0) {
                            xmlParts.push(`<br/>\r\n`);
                        }
                        xmlParts.push(this.escapeXml(lines[i]));
                    }

                    // 7. 文字修飾の終了タグ（開始と逆順）
                    if (decorations.strikethrough) {
                        xmlParts.push(`</strikethrough>\r\n`);
                    }
                    if (decorations.underline) {
                        xmlParts.push(`</underline>\r\n`);
                    }

                    // 8. document終了
                    xmlParts.push(`</document>\r\n`);
                }
                break;

            case 'pixelmap':
                // ピクセルマップ - ImageDataをPNGファイルとして保存
                const pixelmapZIndexAttr = shape.zIndex !== undefined && shape.zIndex !== null ? ` zIndex="${shape.zIndex}"` : '';
                if (shape.imageData) {
                    // ピクセルマップ番号を取得または生成
                    if (shape.pixelmapNo === undefined) {
                        shape.pixelmapNo = await this.getNextPixelmapNumber();
                    }

                    // ファイル名を生成: fileId_recordNo_pixelmapNo.png
                    const fileId = this.realId || 'unknown';
                    const recordNo = 0;  // 常に0
                    const pixelmapFileName = `${fileId}_${recordNo}_${shape.pixelmapNo}.png`;

                    // ImageDataをPNGとして保存（Promiseを収集して後で待機）
                    const savePromise = this.savePixelmapImageFile(shape.imageData, pixelmapFileName);
                    if (savePromises) {
                        savePromises.push(savePromise);
                    }

                    const rotation = shape.rotation || 0;
                    const flipH = shape.flipH ? 'true' : 'false';
                    const flipV = shape.flipV ? 'true' : 'false';

                    // pixelmap要素として保存（href属性でファイル名を指定）
                    xmlParts.push(`<pixelmap left="${shape.startX}" top="${shape.startY}" right="${shape.endX}" bottom="${shape.endY}" bgcolor="${shape.backgroundColor || DEFAULT_BGCOL}" rotation="${rotation}" flipH="${flipH}" flipV="${flipV}" href="${this.escapeXml(pixelmapFileName)}"${pixelmapZIndexAttr}/>\r\n`);
                } else {
                    const rotation = shape.rotation || 0;
                    const flipH = shape.flipH ? 'true' : 'false';
                    const flipV = shape.flipV ? 'true' : 'false';

                    // ImageDataがない場合は空のピクセルマップとして保存
                    xmlParts.push(`<pixelmap left="${shape.startX}" top="${shape.startY}" right="${shape.endX}" bottom="${shape.endY}" bgcolor="${shape.backgroundColor || DEFAULT_BGCOL}" rotation="${rotation}" flipH="${flipH}" flipV="${flipV}"${pixelmapZIndexAttr}/>\r\n`);
                }
                break;

            case 'marker':
                if (shape.points && shape.points.length > 0) {
                    const markerPointsStr = shape.points.map(p => `${p.x},${p.y}`).join(' ');
                    const markerZIndexAttr = shape.zIndex !== undefined && shape.zIndex !== null ? ` zIndex="${shape.zIndex}"` : '';
                    xmlParts.push(`<marker mode="${shape.mode || 0}" markerId="${shape.markerId}" points="${markerPointsStr}"${markerZIndexAttr} />\r\n`);
                }
                break;

            case 'group':
                // グループをXMLタグで囲んで保存
                if (shape.shapes) {
                    const groupZIndexAttr = shape.zIndex !== undefined && shape.zIndex !== null ? ` zIndex="${shape.zIndex}"` : '';
                    xmlParts.push(`<group left="${shape.startX}" top="${shape.startY}" right="${shape.endX}" bottom="${shape.endY}"${groupZIndexAttr}>\r\n`);
                    for (let i = 0; i < shape.shapes.length; i++) {
                        await this.shapeToXML(shape.shapes[i], `${index}_${i}`, xmlParts, savePromises);
                    }
                    xmlParts.push(`</group>\r\n`);
                }
                break;
        }
    }

    /**
     * shapes配列のz-indexを正規化してソート
     * - z-indexが未設定のshapeに自動採番
     * - 背景化されたshapeは負の値（-1, -2, ...）
     * - 通常のshape（仮身、画像、線など全て）は正の値（1, 2, 3, ...）
     * - Canvasのz-indexは0なので、負の値はCanvas背面、正の値はCanvas前面
     * - z-indexでソート
     */
    normalizeAndSortShapesByZIndex() {
        // 背景化されたshapeと通常のshapeを分離
        const backgroundShapes = [];
        const normalShapes = [];

        for (const shape of this.shapes) {
            if (shape.isBackground) {
                backgroundShapes.push(shape);
            } else {
                normalShapes.push(shape);
            }
        }

        // 背景化されたshapeに負のz-indexを採番（z-index未設定の場合）
        let backgroundIndex = -1;
        for (const shape of backgroundShapes) {
            if (shape.zIndex === null || shape.zIndex === undefined) {
                shape.zIndex = backgroundIndex--;
            }
        }

        // 通常のshapeに正のz-indexを採番（z-index未設定の場合）
        let normalIndex = 1;
        for (const shape of normalShapes) {
            if (shape.zIndex === null || shape.zIndex === undefined) {
                shape.zIndex = normalIndex++;
            }
        }

        // z-indexでソート（小さい順 = 背面から前面へ）
        this.shapes.sort((a, b) => {
            const aZ = a.zIndex !== null && a.zIndex !== undefined ? a.zIndex : 0;
            const bZ = b.zIndex !== null && b.zIndex !== undefined ? b.zIndex : 0;
            return aZ - bZ;
        });

        logger.debug('[FIGURE EDITOR] z-index正規化完了:', {
            total: this.shapes.length,
            background: backgroundShapes.length,
            normal: normalShapes.length
        });
    }

    /**
     * shapes配列の現在の順序に基づいてz-indexを再採番
     * 配列操作ベースのz-order変更に使用
     * - shapes配列は既にz-indexでソート済みと仮定
     * - 背景化図形: -1, -2, -3, ...（配列前方から）
     * - 通常図形: 1, 2, 3, ...（配列前方から）
     */
    reassignZIndicesFromArrayOrder() {
        let backgroundIndex = -1;
        let normalIndex = 1;

        for (const shape of this.shapes) {
            if (shape.isBackground) {
                shape.zIndex = backgroundIndex--;
            } else {
                shape.zIndex = normalIndex++;
            }
        }
    }

    /**
     * 新規図形追加時に使用する次のz-indexを取得
     * 既存図形の最大z-indexに+1した値を返す
     * @returns {number} 次に使用すべきz-index値
     */
    getNextZIndex() {
        let maxZIndex = 0;
        for (const shape of this.shapes) {
            if (shape.zIndex !== null && shape.zIndex !== undefined && shape.zIndex > maxZIndex) {
                maxZIndex = shape.zIndex;
            }
        }
        return maxZIndex + 1;
    }

    // escapeXml は PluginBase に移動済み
};
