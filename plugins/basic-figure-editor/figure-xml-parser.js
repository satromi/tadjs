/**
 * 基本図形編集プラグイン - XMLパース系Mixin
 * loadFile, parseXmlTadData, 各種parseXxxElement等
 * @module FigureXmlParserMixin
 */
const logger = window.getLogger('BasicFigureEditor');

export const FigureXmlParserMixin = (Base) => class extends Base {
    async loadFile(fileData) {
        try {
            logger.debug('[FIGURE EDITOR] ファイル読み込み:', fileData);

            this.currentFile = fileData;

            // XMLデータを解析して図形を読み込む
            if (fileData.xmlData) {
                await this.parseXmlTadData(fileData.xmlData);
            } else {
                // 新規ファイルの場合は空のキャンバス
                this.shapes = [];
                this.redraw();
            }

            this.originalContent = JSON.stringify(this.shapes);
            this.isModified = false;

            // スクロールバー更新を通知
            this.resizeCanvas();

        } catch (error) {
            logger.error('[FIGURE EDITOR] ファイル読み込みエラー:', error);
        }
    }

    /**
     * 不正なXMLを修正する
     * - 閉じられていない<p>タグを検出して</p>を挿入
     * @param {string} xmlData - XMLデータ
     * @returns {string} 修正されたXMLデータ
     */
    fixMalformedXml(xmlData) {
        let fixed = xmlData;

        // <p>タグが閉じられていないケースを修正
        // パターン: <p>...（</p>がないまま）</document> または </figure> または </tad>
        // 改行を含む複数行のケースに対応
        fixed = fixed.replace(/<p>([^<]*(?:<(?!\/p>|\/document>|\/figure>|\/tad>)[^<]*)*?)(\s*<\/document>)/g, '<p>$1</p>$2');
        fixed = fixed.replace(/<p>([^<]*(?:<(?!\/p>|\/document>|\/figure>|\/tad>)[^<]*)*?)(\s*<\/figure>)/g, '<p>$1</p>$2');
        fixed = fixed.replace(/<p>([^<]*(?:<(?!\/p>|\/document>|\/figure>|\/tad>)[^<]*)*?)(\s*<\/tad>)/g, '<p>$1</p>$2');

        return fixed;
    }

    async parseXmlTadData(xmlData) {
        // XMLから図形情報を抽出
        this.log('XML解析:', xmlData);

        try {
            // XMLパース前に不正なタグを修正
            const fixedXmlData = this.fixMalformedXml(xmlData);

            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(fixedXmlData, 'text/xml');

            // パースエラーチェック
            const parserError = xmlDoc.querySelector('parsererror');
            if (parserError) {
                logger.error('[FIGURE EDITOR] XML解析エラー:', parserError.textContent);
                this.shapes = [];
                this.redraw();
                return;
            }

            // 用紙サイズを取得（<paper>要素を優先、フォールバックで<papersize>も対応）
            const paperElements = xmlDoc.querySelectorAll('paper');
            if (paperElements.length > 0) {
                // <paper>要素があれば解析（PluginBase共通メソッド使用）
                paperElements.forEach(paper => {
                    this.parsePaperElement(paper);
                });
                // paperSize から paperWidth/paperHeight を同期
                if (this.paperSize) {
                    this.paperWidth = this.paperSize.widthMm;
                    this.paperHeight = this.paperSize.lengthMm;
                }
            } else {
                // 旧形式の<papersize>要素（互換性維持）
                const papersize = xmlDoc.querySelector('papersize');
                if (papersize) {
                    this.paperWidth = parseFloat(papersize.getAttribute('width')) || 210;
                    this.paperHeight = parseFloat(papersize.getAttribute('height')) || 297;
                    // PaperSizeインスタンスも初期化
                    this.initPaperSize();
                    this.paperSize.widthMm = this.paperWidth;
                    this.paperSize.lengthMm = this.paperHeight;
                }
            }

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
            }

            // 図形セグメント全体を取得
            const figureElem = xmlDoc.querySelector('figure');
            if (!figureElem) {
                logger.debug('[FIGURE EDITOR] 図形セグメントが見つかりません');
                this.shapes = [];
                this.redraw();
                return;
            }

            // 図形要素を解析
            this.shapes = [];

            // figScaleデフォルト初期化（UNITS型: -72 = 72DPI）
            this.figScale = { hunit: -72, vunit: -72 };

            // figView/figDraw/figScale要素から設定情報を読み込む
            const figViewElem = figureElem.querySelector('figView');
            const figDrawElem = figureElem.querySelector('figDraw');
            const figScaleElem = figureElem.querySelector('figScale');

            if (figViewElem) {
                // 表示領域を読み込み（今後のキャンバスサイズ設定に使用可能）
                this.figView = {
                    top: parseFloat(figViewElem.getAttribute('top')) || 0,
                    left: parseFloat(figViewElem.getAttribute('left')) || 0,
                    right: parseFloat(figViewElem.getAttribute('right')) || this.canvas.width,
                    bottom: parseFloat(figViewElem.getAttribute('bottom')) || this.canvas.height
                };
            }
            if (figDrawElem) {
                // 描画領域を読み込み
                this.figDraw = {
                    top: parseFloat(figDrawElem.getAttribute('top')) || 0,
                    left: parseFloat(figDrawElem.getAttribute('left')) || 0,
                    right: parseFloat(figDrawElem.getAttribute('right')) || this.canvas.width,
                    bottom: parseFloat(figDrawElem.getAttribute('bottom')) || this.canvas.height
                };
            }
            if (figScaleElem) {
                // スケール設定を読み込み（PluginBase共通メソッド使用）
                this.figScale = this.parseDocScaleElement(figScaleElem);
            }

            // 座標変換状態を保持
            let pendingTransform = null;

            // figure要素の子要素を順番に処理（text+documentの組み合わせを認識するため）
            const children = Array.from(figureElem.children);
            for (let i = 0; i < children.length; i++) {
                const elem = children[i];
                const tagName = elem.tagName.toLowerCase();

                // transform要素を検出
                if (tagName === 'transform') {
                    pendingTransform = {
                        dh: parseFloat(elem.getAttribute('dh')) || 0,
                        dv: parseFloat(elem.getAttribute('dv')) || 0,
                        hangle: parseFloat(elem.getAttribute('hangle')) || 0,
                        vangle: parseFloat(elem.getAttribute('vangle')) || 0
                    };
                    continue;  // 次の要素へ
                }

                // figView/figDraw/figScale要素は上で処理済みなのでスキップ
                if (tagName === 'figview' || tagName === 'figdraw' || tagName === 'figscale') {
                    continue;
                }

                // 図形要素をパース
                let shape = null;
                if (tagName === 'line') {
                    shape = this.parseLineElement(elem);
                } else if (tagName === 'rect') {
                    shape = this.parseRectElement(elem);
                } else if (tagName === 'ellipse') {
                    shape = this.parseEllipseElement(elem);
                } else if (tagName === 'text') {
                    // 次の要素がdocumentか確認（文字枠の場合）
                    const nextElem = i + 1 < children.length ? children[i + 1] : null;
                    if (nextElem && nextElem.tagName.toLowerCase() === 'document') {
                        // 文字枠として解析
                        shape = this.parseDocumentElement(elem, nextElem);
                        i++; // documentもスキップ
                    } else {
                        // 通常のtext要素として解析（互換性のため）
                        shape = this.parseTextElement(elem);
                    }
                } else if (tagName === 'polyline') {
                    shape = this.parsePolylineElement(elem);
                } else if (tagName === 'spline') {
                    shape = this.parseSplineElement(elem);
                } else if (tagName === 'curve') {
                    shape = this.parseCurveElement(elem);
                } else if (tagName === 'polygon') {
                    shape = this.parsePolygonElement(elem);
                } else if (tagName === 'link') {
                    shape = this.parseLinkElement(elem);
                } else if (tagName === 'arc') {
                    shape = this.parseArcElement(elem);
                } else if (tagName === 'chord') {
                    shape = this.parseChordElement(elem);
                } else if (tagName === 'elliptical_arc') {
                    shape = this.parseEllipticalArcElement(elem);
                } else if (tagName === 'image') {
                    shape = this.parseImageElement(elem);
                } else if (tagName === 'pixelmap') {
                    shape = this.parsePixelmapElement(elem);
                } else if (tagName === 'group') {
                    shape = this.parseGroupElement(elem);
                } else if (tagName === 'markerdefine') {
                    this.parseMarkerDefineElement(elem);
                } else if (tagName === 'marker') {
                    shape = this.parseMarkerElement(elem);
                } else if (tagName === 'document') {
                    // document内にtext要素がある場合は文字枠として処理（新形式）
                    const textElem = elem.querySelector('text');
                    if (textElem) {
                        shape = this.parseDocumentElement(textElem, elem);
                    }
                    // textなしのdocumentは無視（既に処理済み、またはスタンドアロン）
                } else if (tagName === 'patterns') {
                    // カスタムパターンセクション読込（<patterns>ラッパー形式）
                    this.parsePatternsElement(elem);
                } else if (tagName === 'mask') {
                    // インラインマスク定義（<figure>直下の<mask>要素）
                    this.parseSingleMaskElement(elem);
                } else if (tagName === 'pattern') {
                    // インラインパターン定義（<figure>直下の<pattern>要素）
                    this.parseSinglePatternElement(elem);
                }

                // 座標変換を適用
                if (shape && pendingTransform) {
                    this.applyTransformToShape(shape, pendingTransform);
                    pendingTransform = null;  // リセット
                }

                if (shape) {
                    this.shapes.push(shape);
                }
            }

            // z-indexの自動採番とソート
            this.normalizeAndSortShapesByZIndex();

            logger.debug('[FIGURE EDITOR] 図形を読み込みました:', this.shapes.length, '個');

            // 仮身のメタデータ（applist等）を読み込み（グループ内を含む全仮身）
            const virtualObjectShapes = this.collectAllVirtualObjectShapes();
            logger.debug('[FIGURE EDITOR] 仮身のメタデータを読み込み中:', virtualObjectShapes.length, '個');
            for (const shape of virtualObjectShapes) {
                await this.loadVirtualObjectMetadata(shape.virtualObject);
            }
            logger.debug('[FIGURE EDITOR] 仮身のメタデータ読み込み完了');

            // 仮身のアイコンを事前読み込み
            await this.preloadVirtualObjectIcons();

            this.redraw();

            // autoopen属性がtrueの仮身を自動的に開く
            await this.autoOpenVirtualObjects();

        } catch (error) {
            logger.error('[FIGURE EDITOR] XML解析エラー:', error);
            this.shapes = [];
            this.redraw();
        }
    }

    /**
     * autoopen属性がtrueの仮身を自動的に開く
     */
    async autoOpenVirtualObjects() {
        // グループ内を含む全仮身を対象
        const virtualObjectShapes = this.collectAllVirtualObjectShapes();

        for (const shape of virtualObjectShapes) {
            const vobj = shape.virtualObject;
            if (vobj.autoopen === 'true') {
                try {
                    // applistを確認
                    const applist = vobj.applist;
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

                    // 実身を開く
                    if (this.messageBus) {
                        this.messageBus.send('open-virtual-object-real', {
                            virtualObj: vobj,
                            pluginId: defaultPluginId
                        });
                    }
                } catch (error) {
                    logger.error('[FIGURE EDITOR] 自動起動エラー:', vobj.link_id, error);
                    // エラーが発生しても次の仮身の起動を続行
                }
            }
        }
    }

    /**
     * グループ内を含む全ての仮身図形を再帰的に収集
     * @param {Array} shapes - 検索対象の図形配列（省略時はthis.shapes）
     * @returns {Array} 仮身図形の配列
     */
    collectAllVirtualObjectShapes(shapes = null) {
        const targetShapes = shapes || this.shapes;
        const result = [];

        for (const shape of targetShapes) {
            if (shape.type === 'vobj' && shape.virtualObject) {
                result.push(shape);
            } else if (shape.type === 'group' && shape.children && shape.children.length > 0) {
                // グループ内を再帰的に検索
                const nestedVobjs = this.collectAllVirtualObjectShapes(shape.children);
                result.push(...nestedVobjs);
            }
        }

        return result;
    }

    /**
     * 図形に座標変換を適用
     * @param {Object} shape 図形オブジェクト
     * @param {Object} transform 変換パラメータ {dh, dv, hangle, vangle}
     */
    applyTransformToShape(shape, transform) {
        switch (shape.type) {
            case 'line':
            case 'rect':
            case 'ellipse':
            case 'roundRect':
                // 開始点・終了点を変換
                const start = this.applyCoordinateTransform(shape.startX, shape.startY, transform);
                const end = this.applyCoordinateTransform(shape.endX, shape.endY, transform);
                shape.startX = start.x;
                shape.startY = start.y;
                shape.endX = end.x;
                shape.endY = end.y;
                break;

            case 'polygon':
            case 'polyline':
            case 'spline':
            case 'curve':
                // 頂点配列を変換
                if (shape.points) {
                    shape.points = this.applyCoordinateTransformToPoints(shape.points, transform);
                }
                break;

            case 'arc':
            case 'chord':
            case 'elliptical_arc':
                // 中心点と境界を変換
                if (shape.centerX !== undefined && shape.centerY !== undefined) {
                    const center = this.applyCoordinateTransform(shape.centerX, shape.centerY, transform);
                    shape.centerX = center.x;
                    shape.centerY = center.y;
                }
                // 境界も変換
                if (shape.startX !== undefined) {
                    const s = this.applyCoordinateTransform(shape.startX, shape.startY, transform);
                    const e = this.applyCoordinateTransform(shape.endX, shape.endY, transform);
                    shape.startX = s.x;
                    shape.startY = s.y;
                    shape.endX = e.x;
                    shape.endY = e.y;
                }
                break;

            case 'text':
            case 'document':
            case 'image':
            case 'pixelmap':
            case 'vobj':
                // 矩形領域を変換
                if (shape.startX !== undefined) {
                    const topLeft = this.applyCoordinateTransform(shape.startX, shape.startY, transform);
                    const bottomRight = this.applyCoordinateTransform(shape.endX, shape.endY, transform);
                    shape.startX = topLeft.x;
                    shape.startY = topLeft.y;
                    shape.endX = bottomRight.x;
                    shape.endY = bottomRight.y;
                }
                break;

            case 'group':
                // グループ内の各図形に再帰適用
                if (shape.shapes) {
                    shape.shapes.forEach(s => this.applyTransformToShape(s, transform));
                }
                break;
        }

        // 回転がある場合は角度も更新（既存のangle属性がある場合）
        if (transform.hangle && transform.hangle !== 0) {
            shape.angle = (shape.angle || 0) + transform.hangle;
        }
    }

    // === XMLパース共通ヘルパー ===

    /**
     * 要素から線種・線幅を取得する共通処理
     * @param {Element} elem - XML要素
     * @returns {{ lineType: number, lineWidth: number }}
     */
    _parseLineTypeAndWidth(elem) {
        const lineTypeAttr = elem.getAttribute('lineType');
        const lineWidthAttr = elem.getAttribute('lineWidth');
        if (lineTypeAttr !== null && lineWidthAttr !== null) {
            return {
                lineType: parseInt(lineTypeAttr) || 0,
                lineWidth: parseInt(lineWidthAttr) || 1
            };
        }
        const l_atr = parseInt(elem.getAttribute('l_atr')) || 1;
        const parsed = this.parseLineAttribute(l_atr);
        return {
            lineType: parsed.lineType,
            lineWidth: parsed.lineWidth || 1
        };
    }

    /**
     * 要素からパターンIDと色を解決する共通処理
     * @param {Element} elem - XML要素
     * @param {object} options - オプション
     * @param {boolean} options.fillEnabled - 塗りの有無（デフォルト: f_pat >= 1 で判定）
     * @returns {{ l_pat, linePatternId, f_pat, fillPatternId, fillEnabled, strokeColor, fillColor }}
     */
    _parsePatternAndColors(elem, options = {}) {
        const l_pat = parseInt(elem.getAttribute('l_pat')) || 0;
        const f_pat = parseInt(elem.getAttribute('f_pat')) || 0;
        const strokeColor = (l_pat >= 1 && typeof resolvePatternColor === 'function')
            ? (resolvePatternColor(l_pat, this.customPatterns) || DEFAULT_FRCOL)
            : DEFAULT_FRCOL;
        const fillColor = (f_pat >= 1 && typeof resolvePatternColor === 'function')
            ? (resolvePatternColor(f_pat, this.customPatterns) || DEFAULT_BGCOL)
            : DEFAULT_BGCOL;
        const fillEnabled = options.fillEnabled !== undefined ? options.fillEnabled : f_pat >= 1;
        return {
            l_pat, linePatternId: l_pat,
            f_pat, fillPatternId: f_pat,
            fillEnabled, strokeColor, fillColor
        };
    }

    /**
     * 接続情報をパースする共通処理
     * @param {Element} elem - XML要素
     * @returns {{ startConnection, endConnection, connPat, lineConnectionType }}
     */
    _parseConnectionInfo(elem) {
        const conn_pat = parseInt(elem.getAttribute('conn_pat')) || 0;
        const lineConnectionType = elem.getAttribute('lineConnectionType') || 'straight';

        const parseConn = (attrName) => {
            const val = elem.getAttribute(attrName) || '';
            if (!val) return null;
            const parts = val.split(',');
            if (parts.length !== 2) return null;
            return { shapeId: parseInt(parts[0]), connectorIndex: parseInt(parts[1]) };
        };

        return {
            startConnection: parseConn('start_conn'),
            endConnection: parseConn('end_conn'),
            connPat: conn_pat,
            lineConnectionType
        };
    }

    /**
     * zIndex属性を取得する共通処理
     * @param {Element} elem - XML要素
     * @returns {number|null}
     */
    _parseZIndex(elem) {
        const zIndex = elem.getAttribute('zIndex');
        return zIndex !== null ? parseInt(zIndex) : null;
    }

    parseLineElement(elem) {
        // tad.js形式: <line l_atr="..." points="x1,y1 x2,y2">
        const pointsStr = elem.getAttribute('points');
        let startX = 0, startY = 0, endX = 0, endY = 0;

        if (pointsStr) {
            const pairs = pointsStr.trim().split(/\s+/);
            if (pairs.length >= 2) {
                const start = pairs[0].split(',').map(parseFloat);
                const end = pairs[1].split(',').map(parseFloat);
                if (start.length >= 2) { startX = start[0]; startY = start[1]; }
                if (end.length >= 2) { endX = end[0]; endY = end[1]; }
            }
        }

        const { lineType, lineWidth } = this._parseLineTypeAndWidth(elem);
        const { linePatternId, strokeColor } = this._parsePatternAndColors(elem, { fillEnabled: false });
        const connInfo = this._parseConnectionInfo(elem);

        // 矢印情報を取得
        const start_arrow = parseInt(elem.getAttribute('start_arrow')) || 0;
        const end_arrow = parseInt(elem.getAttribute('end_arrow')) || 0;
        const arrow_type = elem.getAttribute('arrow_type') || 'simple';

        const lineShape = {
            type: 'line',
            startX, startY, endX, endY,
            strokeColor,
            fillColor: 'transparent',
            lineWidth, lineType, linePatternId,
            fillEnabled: false,
            connPat: connInfo.connPat,
            lineConnectionType: connInfo.lineConnectionType,
            start_arrow, end_arrow, arrow_type,
            zIndex: this._parseZIndex(elem)
        };

        if (connInfo.startConnection) lineShape.startConnection = connInfo.startConnection;
        if (connInfo.endConnection) lineShape.endConnection = connInfo.endConnection;

        return lineShape;
    }

    parseRectElement(elem) {
        // tad.js形式: <rect round="0/1" l_atr="..." l_pat="..." f_pat="..." angle="..." left="..." top="..." right="..." bottom="...">
        const left = parseFloat(elem.getAttribute('left')) || 0;
        const top = parseFloat(elem.getAttribute('top')) || 0;
        const right = parseFloat(elem.getAttribute('right')) || 0;
        const bottom = parseFloat(elem.getAttribute('bottom')) || 0;
        const round = parseInt(elem.getAttribute('round')) || 0;
        const angle = parseFloat(elem.getAttribute('angle')) || 0;
        const rotation = parseFloat(elem.getAttribute('rotation')) || 0;

        const { lineType, lineWidth } = this._parseLineTypeAndWidth(elem);
        const { linePatternId, fillPatternId, fillEnabled, strokeColor, fillColor } = this._parsePatternAndColors(elem);

        // 文字枠の判定（新形式：属性としてfontSizeを持つ、または旧形式：documentを持つ）
        const hasFontSize = elem.hasAttribute('fontSize');
        const documentElem = elem.querySelector('document');

        if (hasFontSize || documentElem) {
            // 文字枠として解析
            let content = '';
            let fontSize = 16;
            let fontFamily = 'sans-serif';
            let textColor = '#000000';
            const decorations = {
                bold: false,
                italic: false,
                underline: false,
                strikethrough: false
            };

            if (hasFontSize) {
                // 新形式：属性から取得
                fontSize = parseInt(elem.getAttribute('fontSize')) || 16;
                fontFamily = elem.getAttribute('fontFamily') || 'sans-serif';
                textColor = elem.getAttribute('textColor') || DEFAULT_FRCOL;

                const decoration = elem.getAttribute('decoration') || '';
                decorations.bold = decoration.includes('B');
                decorations.italic = decoration.includes('I');
                decorations.underline = decoration.includes('U');
                decorations.strikethrough = decoration.includes('S');

                // テキスト内容を取得（BRタグを改行に変換）
                content = elem.innerHTML
                    .replace(/<br\s*\/?>/gi, '\n')
                    .replace(/<[^>]*>/g, '') // その他のタグを除去
                    .trim();
            } else if (documentElem) {
                // 標準形式：document内にtext要素とfont要素がある
                // font要素からフォント情報を取得
                const fontElems = documentElem.querySelectorAll('font');
                fontElems.forEach(fontElem => {
                    if (fontElem.hasAttribute('size')) {
                        fontSize = parseInt(fontElem.getAttribute('size')) || 16;
                    }
                    if (fontElem.hasAttribute('face')) {
                        fontFamily = fontElem.getAttribute('face') || 'sans-serif';
                    }
                    if (fontElem.hasAttribute('color')) {
                        textColor = fontElem.getAttribute('color') || DEFAULT_FRCOL;
                    }
                });

                // 文字修飾の取得
                if (documentElem.querySelector('underline')) {
                    decorations.underline = true;
                }
                if (documentElem.querySelector('strikethrough')) {
                    decorations.strikethrough = true;
                }

                // テキスト内容を取得（font、text要素を除外し、br要素を改行に変換）
                const docClone = documentElem.cloneNode(true);
                // font、text要素を削除
                docClone.querySelectorAll('font, text').forEach(el => el.remove());
                // underline、strikethrough要素の中身を取り出す
                docClone.querySelectorAll('underline, strikethrough').forEach(el => {
                    const parent = el.parentNode;
                    while (el.firstChild) {
                        parent.insertBefore(el.firstChild, el);
                    }
                    parent.removeChild(el);
                });
                // br要素を改行に変換
                content = docClone.innerHTML
                    .replace(/<br\s*\/?>/gi, '\n')
                    .replace(/<[^>]*>/g, '') // その他のタグを除去
                    .replace(/\r\n/g, '\n')  // \r\nを\nに正規化
                    .replace(/\r/g, '\n')    // \rを\nに正規化
                    .trim();
            }

            return {
                type: 'document',
                startX: left,
                startY: top,
                endX: right,
                endY: bottom,
                content: content,
                fontSize: fontSize,
                fontFamily: fontFamily,
                textColor: textColor,
                fillColor: 'transparent',
                strokeColor: 'transparent',
                lineWidth: 0,
                decorations: decorations
            };
        }

        // 通常の長方形
        // cornerRadius属性があれば使用、なければroundフラグから推定（後方互換性）
        const cornerRadius = elem.hasAttribute('cornerRadius')
            ? parseFloat(elem.getAttribute('cornerRadius'))
            : (round > 0 ? 5 : 0);

        return {
            type: round > 0 ? 'roundRect' : 'rect',
            startX: left,
            startY: top,
            endX: right,
            endY: bottom,
            strokeColor: strokeColor,
            fillColor: fillColor,
            lineWidth: lineWidth,
            lineType: lineType,
            linePatternId: linePatternId,
            fillEnabled: fillEnabled,
            fillPatternId: fillPatternId,
            cornerRadius: cornerRadius,
            angle: angle,
            rotation: rotation,
            zIndex: this._parseZIndex(elem)
        };
    }

    parseEllipseElement(elem) {
        // tad.js形式: <ellipse l_atr="..." l_pat="..." f_pat="..." angle="..." cx="..." cy="..." rx="..." ry="...">
        const cx = parseFloat(elem.getAttribute('cx')) || 0;
        const cy = parseFloat(elem.getAttribute('cy')) || 0;
        const rx = parseFloat(elem.getAttribute('rx')) || 0;
        const ry = parseFloat(elem.getAttribute('ry')) || 0;
        const angle = parseFloat(elem.getAttribute('angle')) || 0;
        const rotation = parseFloat(elem.getAttribute('rotation')) || 0;

        const { lineType, lineWidth } = this._parseLineTypeAndWidth(elem);
        const { linePatternId, fillPatternId, fillEnabled, strokeColor, fillColor } = this._parsePatternAndColors(elem);

        return {
            type: 'ellipse',
            startX: cx - rx,
            startY: cy - ry,
            endX: cx + rx,
            endY: cy + ry,
            strokeColor: strokeColor,
            fillColor: fillColor,
            lineWidth: lineWidth,
            lineType: lineType,
            linePatternId: linePatternId,
            fillEnabled: fillEnabled,
            fillPatternId: fillPatternId,
            angle: angle,
            rotation: rotation,
            zIndex: this._parseZIndex(elem)
        };
    }

    parseTextElement(elem) {
        // テキスト要素
        // z-index属性を取得
        const zIndex = elem.getAttribute('zIndex');

        return {
            type: 'text',
            startX: parseFloat(elem.getAttribute('x')) || 0,
            startY: parseFloat(elem.getAttribute('y')) || 0,
            text: elem.textContent || '',
            fontSize: elem.getAttribute('size') || '16px sans-serif',
            strokeColor: elem.getAttribute('color') || DEFAULT_FRCOL,
            fillColor: 'transparent',
            lineWidth: 1,
            zIndex: zIndex !== null ? parseInt(zIndex) : null  // z-index
        };
    }

    parseDocumentElement(textElem, documentElem) {
        // text要素とdocument要素を組み合わせて文字枠を構築
        // 位置情報を取得（新形式: docView要素、旧形式: text要素の属性）
        let viewLeft = 0, viewTop = 0, viewRight = 100, viewBottom = 100;

        // 新形式: document内のdocView要素から位置情報を取得
        const docViewElem = documentElem ? documentElem.querySelector('docView') : null;
        if (docViewElem) {
            viewLeft = parseFloat(docViewElem.getAttribute('viewleft')) || 0;
            viewTop = parseFloat(docViewElem.getAttribute('viewtop')) || 0;
            viewRight = parseFloat(docViewElem.getAttribute('viewright')) || 100;
            viewBottom = parseFloat(docViewElem.getAttribute('viewbottom')) || 100;
        } else if (textElem) {
            // 旧形式: text要素の属性から位置情報を取得（後方互換性）
            viewLeft = parseFloat(textElem.getAttribute('viewleft')) || 0;
            viewTop = parseFloat(textElem.getAttribute('viewtop')) || 0;
            viewRight = parseFloat(textElem.getAttribute('viewright')) || 100;
            viewBottom = parseFloat(textElem.getAttribute('viewbottom')) || 100;
        }

        // document要素から文字情報を取得
        let content = '';
        let fontSize = 16;
        let fontFamily = 'sans-serif';
        let textColor = '#000000';
        let textAlign = 'left';  // デフォルトは左揃え
        const decorations = {
            bold: false,
            italic: false,
            underline: false,
            strikethrough: false
        };

        if (documentElem) {
            // document要素の子要素を解析
            let currentText = '';
            const processNode = (node) => {
                if (node.nodeType === Node.TEXT_NODE) {
                    // XMLのフォーマット用の改行（\r\n, \r, \n）は削除
                    const text = node.textContent.replace(/\r\n/g, '').replace(/\r/g, '').replace(/\n/g, '');
                    if (text.trim() !== '') {
                        currentText += text;
                    }
                } else if (node.nodeType === Node.ELEMENT_NODE) {
                    const tagName = node.tagName.toLowerCase();

                    // docView/docDraw要素は設定情報のためスキップ
                    if (tagName === 'docview' || tagName === 'docdraw') {
                        return;
                    }

                    // docScale要素から設定情報を読み込み
                    if (tagName === 'docscale') {
                        this.docScale = this.parseDocScaleElement(node);
                        return;
                    }

                    if (tagName === 'text') {
                        // text要素にalign属性がある場合は取得
                        if (node.hasAttribute('align')) {
                            textAlign = node.getAttribute('align') || 'left';
                        }
                        // viewleft等がある場合は位置情報のみなのでスキップ
                        return;
                    } else if (tagName === 'font') {
                        // フォント設定
                        if (node.hasAttribute('size')) {
                            fontSize = parseInt(node.getAttribute('size')) || 16;
                        }
                        if (node.hasAttribute('face')) {
                            fontFamily = node.getAttribute('face') || 'sans-serif';
                        }
                        if (node.hasAttribute('color')) {
                            textColor = node.getAttribute('color') || DEFAULT_FRCOL;
                        }
                    } else if (tagName === 'br') {
                        // 改行
                        currentText += '\n';
                    } else if (tagName === 'underline') {
                        decorations.underline = true;
                        // 子要素を処理
                        for (let child of node.childNodes) {
                            processNode(child);
                        }
                        return; // 子要素は処理済み
                    } else if (tagName === 'strikethrough') {
                        decorations.strikethrough = true;
                        // 子要素を処理
                        for (let child of node.childNodes) {
                            processNode(child);
                        }
                        return; // 子要素は処理済み
                    }

                    // その他の要素の子要素を処理
                    for (let child of node.childNodes) {
                        processNode(child);
                    }
                }
            };

            for (let child of documentElem.childNodes) {
                processNode(child);
            }

            content = currentText.trim();
        }

        // z-index属性を取得
        const zIndex = textElem.getAttribute('zIndex');

        return {
            type: 'document',
            startX: viewLeft,
            startY: viewTop,
            endX: viewRight,
            endY: viewBottom,
            content: content,
            fontSize: fontSize,
            fontFamily: fontFamily,
            textColor: textColor,
            textAlign: textAlign,  // テキスト配置
            fillColor: 'transparent',
            strokeColor: 'transparent',
            lineWidth: 0,
            decorations: decorations,
            zIndex: zIndex !== null ? parseInt(zIndex) : null  // z-index
        };
    }

    parsePolylineElement(elem) {
        // tad.js形式: <polyline l_atr="..." l_pat="..." points="x1,y1 x2,y2 ...">
        const pointsStr = elem.getAttribute('points');
        const points = [];

        if (pointsStr) {
            const pairs = pointsStr.trim().split(/\s+/);
            pairs.forEach(pair => {
                const coords = pair.split(',').map(parseFloat);
                if (coords.length >= 2) {
                    points.push({ x: coords[0], y: coords[1] });
                }
            });
        }

        const { lineType, lineWidth } = this._parseLineTypeAndWidth(elem);
        const { linePatternId, strokeColor } = this._parsePatternAndColors(elem, { fillEnabled: false });

        // 回転属性を取得
        const rotation = parseFloat(elem.getAttribute('rotation')) || 0;

        return {
            type: 'polyline',
            points: points,
            strokeColor: strokeColor,
            fillColor: 'transparent',
            lineWidth: lineWidth,
            lineType: lineType,
            linePatternId: linePatternId,
            fillEnabled: false,
            rotation: rotation,
            zIndex: this._parseZIndex(elem)
        };
    }

    parseSplineElement(elem) {
        // スプライン曲線 (curveと同じ形式)
        const pointsStr = elem.getAttribute('points');
        const points = [];

        if (pointsStr) {
            const pairs = pointsStr.trim().split(/\s+/);
            pairs.forEach(pair => {
                const coords = pair.split(',').map(parseFloat);
                if (coords.length >= 2) {
                    points.push({ x: coords[0], y: coords[1] });
                }
            });
        }

        const { lineType, lineWidth } = this._parseLineTypeAndWidth(elem);
        const { linePatternId, strokeColor } = this._parsePatternAndColors(elem, { fillEnabled: false });

        // 回転属性を取得
        const rotation = parseFloat(elem.getAttribute('rotation')) || 0;

        return {
            type: 'curve',
            path: points,
            strokeColor: strokeColor,
            fillColor: 'transparent',
            lineWidth: lineWidth,
            lineType: lineType,
            linePatternId: linePatternId,
            fillEnabled: false,
            rotation: rotation
        };
    }

    parseCurveElement(elem) {
        // tad.js形式: <curve l_atr="..." l_pat="..." f_pat="..." fillColor="..." strokeColor="..." points="x1,y1 x2,y2 ...">
        const pointsStr = elem.getAttribute('points');
        const points = [];

        if (pointsStr) {
            const pairs = pointsStr.trim().split(/\s+/);
            pairs.forEach(pair => {
                const coords = pair.split(',').map(parseFloat);
                if (coords.length >= 2) {
                    points.push({ x: coords[0], y: coords[1] });
                }
            });
        }

        const { lineType, lineWidth } = this._parseLineTypeAndWidth(elem);
        const { linePatternId, fillPatternId, fillEnabled, strokeColor, fillColor } = this._parsePatternAndColors(elem);

        // 回転属性を取得
        const curveRotation = parseFloat(elem.getAttribute('rotation')) || 0;

        return {
            type: 'curve',
            path: points,
            strokeColor: strokeColor,
            fillColor: fillEnabled ? fillColor : 'transparent',
            lineWidth: lineWidth,
            lineType: lineType,
            linePatternId: linePatternId,
            fillEnabled: fillEnabled,
            fillPatternId: fillPatternId,
            rotation: curveRotation,
            zIndex: this._parseZIndex(elem)
        };
    }

    parsePolygonElement(elem) {
        // tad.js形式: <polygon l_atr="..." l_pat="..." f_pat="..." fillColor="..." strokeColor="..." points="x1,y1 x2,y2 ...">
        const pointsStr = elem.getAttribute('points');
        const points = [];

        if (pointsStr) {
            const pairs = pointsStr.trim().split(/\s+/);
            pairs.forEach(pair => {
                const coords = pair.split(',').map(parseFloat);
                if (coords.length >= 2) {
                    points.push({ x: coords[0], y: coords[1] });
                }
            });
        }

        const { lineType, lineWidth } = this._parseLineTypeAndWidth(elem);
        const { linePatternId, fillPatternId, fillEnabled, strokeColor, fillColor } = this._parsePatternAndColors(elem);

        // cornerRadius属性があれば使用、なければ0（後方互換性）
        const cornerRadius = elem.hasAttribute('cornerRadius')
            ? parseFloat(elem.getAttribute('cornerRadius'))
            : 0;

        // 回転属性を取得
        const polygonRotation = parseFloat(elem.getAttribute('rotation')) || 0;

        return {
            type: 'polygon',
            points: points,
            strokeColor: strokeColor,
            fillColor: fillColor,
            lineWidth: lineWidth,
            lineType: lineType,
            linePatternId: linePatternId,
            fillEnabled: fillEnabled,
            fillPatternId: fillPatternId,
            cornerRadius: cornerRadius,
            rotation: polygonRotation,
            zIndex: this._parseZIndex(elem)
        };
    }

    parseLinkElement(elem) {
        // tad.js形式: <link id="..." vobjleft="..." vobjtop="..." vobjright="..." vobjbottom="..." frcol="..." chcol="..." tbcol="...">
        const left = parseFloat(elem.getAttribute('vobjleft')) || 0;
        const top = parseFloat(elem.getAttribute('vobjtop')) || 0;
        const right = parseFloat(elem.getAttribute('vobjright')) || 0;
        const bottom = parseFloat(elem.getAttribute('vobjbottom')) || 0;
        const chsz = parseFloat(elem.getAttribute('chsz')) || DEFAULT_FONT_SIZE;

        // originalHeightを計算（chszはポイント値なのでピクセルに変換）
        const chszPx = window.convertPtToPx(chsz);
        const lineHeight = DEFAULT_LINE_HEIGHT;
        const textHeight = Math.ceil(chszPx * lineHeight);
        const originalHeight = textHeight + VOBJ_PADDING_VERTICAL; // 閉じた仮身の高さ

        // z-index属性を取得
        const zIndex = elem.getAttribute('zIndex');

        return {
            type: 'vobj',
            startX: left,
            startY: top,
            endX: right,
            endY: bottom,
            virtualObject: {
                vobjid: elem.getAttribute('vobjid') || UuidV7Generator.generate(),
                link_id: elem.getAttribute('id') || '',
                link_name: elem.textContent || '仮身',
                chsz: chsz,
                frcol: elem.getAttribute('frcol') || DEFAULT_FRCOL,
                chcol: elem.getAttribute('chcol') || DEFAULT_FRCOL,
                tbcol: elem.getAttribute('tbcol') || DEFAULT_BGCOL,
                bgcol: elem.getAttribute('bgcol') || DEFAULT_BGCOL,
                pictdisp: elem.getAttribute('pictdisp') || 'true',  // ピクトグラム表示
                namedisp: elem.getAttribute('namedisp') || 'true',  // 名称表示
                roledisp: elem.getAttribute('roledisp') || 'false',
                typedisp: elem.getAttribute('typedisp') || 'false',
                updatedisp: elem.getAttribute('updatedisp') || 'false',
                framedisp: elem.getAttribute('framedisp') || 'true',
                autoopen: elem.getAttribute('autoopen') || 'false',
                // スクロール位置・表示倍率（仮身毎に管理、BTRON仕様準拠）
                scrollx: parseFloat(elem.getAttribute('scrollx')) || 0,
                scrolly: parseFloat(elem.getAttribute('scrolly')) || 0,
                zoomratio: parseFloat(elem.getAttribute('zoomratio')) || 1.0,
                // 仮身固有の続柄（link要素のrelationship属性）
                linkRelationship: elem.getAttribute('relationship') ? elem.getAttribute('relationship').split(/\s+/).filter(t => t) : []
            },
            strokeColor: elem.getAttribute('frcol') || DEFAULT_FRCOL,
            textColor: elem.getAttribute('chcol') || DEFAULT_FRCOL,
            fillColor: elem.getAttribute('tbcol') || DEFAULT_BGCOL,
            lineWidth: 1,
            originalHeight: originalHeight,
            locked: elem.getAttribute('fixed') === 'true',  // 固定化
            isBackground: elem.getAttribute('background') === 'true',  // 背景化
            zIndex: zIndex !== null ? parseInt(zIndex) : null  // z-index
        };
    }

    parseImageElement(elem) {
        // 画像セグメント: <image l_atr="..." l_pat="..." f_pat="..." angle="..." left="..." top="..." right="..." bottom="..." href="..." />
        const left = parseFloat(elem.getAttribute('left')) || 0;
        const top = parseFloat(elem.getAttribute('top')) || 0;
        const right = parseFloat(elem.getAttribute('right')) || 100;
        const bottom = parseFloat(elem.getAttribute('bottom')) || 100;
        const href = elem.getAttribute('href') || '';

        const { lineType, lineWidth } = this._parseLineTypeAndWidth(elem);
        const { linePatternId, fillPatternId, fillEnabled, strokeColor, fillColor } = this._parsePatternAndColors(elem);

        // 画像番号を抽出
        let imgNo = 0;
        const match = href.match(/_(\d+)\.png$/);
        if (match) {
            imgNo = parseInt(match[1]);
        }

        // 画像要素を作成
        const img = new Image();
        // 画像ファイルのパスを生成
        if (href) {
            // 親ウィンドウから画像ファイルの絶対パスを取得
            this.getImageFilePath(href).then(filePath => {
                logger.debug('[FIGURE EDITOR] 画像パス取得成功:', href, '->', filePath);
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
                // 画像読み込み完了時に再描画
                img.onload = () => {
                    logger.debug('[FIGURE EDITOR] 画像読み込み完了:', href);
                    this.redraw();
                };
                img.onerror = () => {
                    logger.error('[FIGURE EDITOR] 画像読み込みエラー:', href, filePath);
                };
            }).catch(error => {
                logger.error('[FIGURE EDITOR] 画像パス取得エラー:', href, error);
            });
        }

        return {
            type: 'image',
            startX: left,
            startY: top,
            endX: right,
            endY: bottom,
            imageElement: img,
            fileName: href,
            imgNo: imgNo,
            lineWidth: lineWidth,
            lineType: lineType,
            linePatternId: linePatternId,
            strokeColor: strokeColor,
            fillEnabled: fillEnabled,
            fillPatternId: fillPatternId,
            fillColor: fillColor,
            angle: parseFloat(elem.getAttribute('angle')) || 0,
            rotation: parseFloat(elem.getAttribute('rotation')) || 0,
            flipH: elem.getAttribute('flipH') === 'true',
            flipV: elem.getAttribute('flipV') === 'true',
            zIndex: this._parseZIndex(elem)
        };
    }

    parsePixelmapElement(elem) {
        // ピクセルマップセグメント: <pixelmap left="..." top="..." right="..." bottom="..." bgcolor="..." href="..." />
        const left = parseFloat(elem.getAttribute('left')) || 0;
        const top = parseFloat(elem.getAttribute('top')) || 0;
        const right = parseFloat(elem.getAttribute('right')) || 100;
        const bottom = parseFloat(elem.getAttribute('bottom')) || 100;
        const backgroundColor = elem.getAttribute('bgcolor') || DEFAULT_BGCOL;
        const href = elem.getAttribute('href') || '';

        // ピクセルマップ番号を抽出
        let pixelmapNo = 0;
        const match = href.match(/_(\d+)\.png$/);
        if (match) {
            pixelmapNo = parseInt(match[1]);
        }

        const shape = {
            type: 'pixelmap',
            startX: left,
            startY: top,
            endX: right,
            endY: bottom,
            backgroundColor: backgroundColor,
            imageData: null,
            pixelmapNo: pixelmapNo,
            fileName: href,
            rotation: parseFloat(elem.getAttribute('rotation')) || 0,
            flipH: elem.getAttribute('flipH') === 'true',
            flipV: elem.getAttribute('flipV') === 'true'
        };

        // href属性がある場合、画像ファイルからImageDataを復元
        if (href) {
            // 親ウィンドウから画像ファイルの絶対パスを取得
            this.getImageFilePath(href).then(filePath => {
                logger.debug('[FIGURE EDITOR] ピクセルマップ画像パス取得成功:', href, '->', filePath);
                const img = new Image();
                img.onload = () => {
                    logger.debug('[FIGURE EDITOR] ピクセルマップ画像読み込み完了:', href);
                    const width = Math.abs(right - left);
                    const height = Math.abs(bottom - top);
                    const tempCanvas = document.createElement('canvas');
                    tempCanvas.width = width;
                    tempCanvas.height = height;
                    const tempCtx = tempCanvas.getContext('2d');
                    tempCtx.drawImage(img, 0, 0, width, height);
                    shape.imageData = tempCtx.getImageData(0, 0, width, height);
                    this.redraw();
                };
                img.onerror = (error) => {
                    logger.error('[FIGURE EDITOR] ピクセルマップ画像読み込みエラー:', href, error);
                };
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
            }).catch(error => {
                logger.error('[FIGURE EDITOR] ピクセルマップ画像パス取得エラー:', href, error);
            });
        }

        return shape;
    }

    parseMarkerDefineElement(elem) {
        const type = parseInt(elem.getAttribute('type')) || 0;
        const id = parseInt(elem.getAttribute('id')) || 0;
        const size = parseInt(elem.getAttribute('size')) || 16;
        const fgCol = elem.getAttribute('fgcol') || elem.getAttribute('fgCol') || '#000000';
        const maskAttr = elem.getAttribute('mask');

        const markerDef = { id, type, size, fgCol };

        if (id <= 4) {
            const shapeNames = ['dot', 'plus', 'star', 'circle', 'cross'];
            markerDef.shape = shapeNames[id];
        } else if (maskAttr !== null) {
            markerDef.mask = parseInt(maskAttr);
        }

        this.markerDefinitions.set(id, markerDef);
    }

    parsePatternsElement(elem) {
        // <patterns>ラッパー内の子要素を個別パースメソッドに委譲
        const maskElems = elem.querySelectorAll('mask');
        maskElems.forEach(maskElem => this.parseSingleMaskElement(maskElem));
        const patternElems = elem.querySelectorAll('pattern');
        patternElems.forEach(patElem => this.parseSinglePatternElement(patElem));
    }

    /**
     * デフォルトマスク定義（TAD仕様 ID 0-13）をcustomMasksに登録
     * js/util.jsのDEFAULT_MASK_DEFINITIONSを参照
     * xtadファイルで同じIDが定義されている場合はparseSingleMaskElementで上書きされる
     */
    initializeDefaultMasks() {
        if (typeof DEFAULT_MASK_DEFINITIONS === 'undefined') return;
        for (const def of DEFAULT_MASK_DEFINITIONS) {
            this.customMasks[def.id] = {
                id: def.id, type: 0,
                width: def.width, height: def.height,
                wordValues: def.wordValues.slice()
            };
        }
    }

    parseSingleMaskElement(maskElem) {
        try {
            const maskId = parseInt(maskElem.getAttribute('id'));
            const maskType = parseInt(maskElem.getAttribute('type')) || 0;
            const maskWidth = parseInt(maskElem.getAttribute('width'));
            const maskHeight = parseInt(maskElem.getAttribute('height'));
            const maskDataStr = maskElem.getAttribute('data');
            if (maskId >= 0 && maskWidth > 0 && maskHeight > 0 && maskDataStr) {
                // 16bitワード値のカンマ区切り16進数形式
                const wordValues = maskDataStr.split(',').map(v => parseInt(v, 16));
                this.customMasks[maskId] = {
                    id: maskId, type: maskType,
                    width: maskWidth, height: maskHeight,
                    wordValues: wordValues
                };
            }
        } catch (e) {
            // マスクのパースエラーは無視
        }
    }

    parseSinglePatternElement(patElem) {
        const id = parseInt(patElem.getAttribute('id'));
        if (id < 1) return;
        try {
            const width = parseInt(patElem.getAttribute('width')) || 16;
            const height = parseInt(patElem.getAttribute('height')) || 16;
            let pixelColors = null;

            // pixelcolors属性がある場合はそこからデコード（後方互換）
            const pixelColorsStr = patElem.getAttribute('pixelcolors');
            if (pixelColorsStr) {
                const colorsJson = decodeURIComponent(escape(atob(pixelColorsStr)));
                pixelColors = JSON.parse(colorsJson);
            }

            // TAD構造メタデータを保存
            const ncolStr = patElem.getAttribute('ncol');
            const ncol = ncolStr ? parseInt(ncolStr) : 0;
            const fgcolorsStr = patElem.getAttribute('fgcolors') || '';
            const bgcolorStr = patElem.getAttribute('bgcolor') || '';
            const masksStr = patElem.getAttribute('masks') || '';

            // ID 128+のソリッドカラーパターン（ncol=1, 単色）は簡易登録
            if (id >= 128 && ncol === 1 && fgcolorsStr && !masksStr) {
                this.customPatterns[id] = {
                    id: id,
                    type: 'solid',
                    color: fgcolorsStr,
                    width: width,
                    height: height,
                    ncol: ncol,
                    fgcolors: fgcolorsStr,
                    bgcolor: bgcolorStr,
                    masks: masksStr
                };
                return;
            }

            // pixelcolorsがなくncol等のTADパラメータがある場合、マスクからパターンを再構築
            if (!pixelColors && ncol > 0 && masksStr) {
                pixelColors = buildPatternFromTadParams(width, height, ncol, fgcolorsStr, bgcolorStr, masksStr, this.customMasks);
            }

            if (!pixelColors) return;

            // pixelColorsから16bit行マスクを生成（描画互換用）
            const rowMasks = [];
            const rows = Math.min(pixelColors.length, 16);
            for (let r = 0; r < 16; r++) {
                let mask = 0;
                if (r < rows) {
                    const row = pixelColors[r];
                    const cols = Math.min(row ? row.length : 0, 16);
                    for (let c = 0; c < cols; c++) {
                        if (row[c] !== null && row[c] !== undefined) {
                            mask |= (1 << (15 - c));
                        }
                    }
                }
                rowMasks.push(mask);
            }

            this.customPatterns[id] = {
                id: id,
                type: 'pattern',
                data: rowMasks,
                pixelColors: pixelColors,
                width: width,
                height: height
            };

            // TAD構造メタデータを保存
            if (ncol > 0) {
                this.customPatterns[id].ncol = ncol;
                this.customPatterns[id].fgcolors = fgcolorsStr;
                this.customPatterns[id].bgcolor = bgcolorStr;
                this.customPatterns[id].masks = masksStr;
            }
        } catch (e) {
            // パースエラーは無視
        }
    }

    /**
     * pixelColors（2D色配列）からTADパラメータ（ncol, fgcolors, bgcolor, masks）を生成
     * パターンエディタで新規作成されたパターンをTAD仕様形式に変換する
     */
    pixelColorsToTadParams(pixelColors, width, height) {
        // ユニーク色を抽出（nullは透明として除外）
        const colorSet = new Set();
        for (let y = 0; y < height; y++) {
            const row = pixelColors[y];
            if (!row) continue;
            for (let x = 0; x < width; x++) {
                if (row[x] !== null && row[x] !== undefined) {
                    colorSet.add(row[x]);
                }
            }
        }
        const uniqueColors = Array.from(colorSet);

        // 背景色は透明、各色を前景色として扱う
        const ncol = uniqueColors.length || 1;
        const fgcolors = uniqueColors.length > 0 ? uniqueColors.join(',') : '#000000';
        const bgcolor = 'transparent';
        const wordsPerRow = Math.ceil(width / 16);

        // 各色に対応するマスクを生成
        // マスクIDは128以上の未使用IDを動的に割り当て
        const maskDefs = [];
        const maskIdList = [];
        let nextMaskId = 128; // カスタムマスク用に128以降を使用

        // 既存マスクIDと衝突しないよう確認
        while (this.customMasks[nextMaskId]) {
            nextMaskId++;
        }

        for (let colorIdx = 0; colorIdx < uniqueColors.length; colorIdx++) {
            const targetColor = uniqueColors[colorIdx];
            const maskId = nextMaskId++;
            const wordValues = [];

            for (let y = 0; y < height; y++) {
                for (let w = 0; w < wordsPerRow; w++) {
                    let word = 0;
                    for (let bit = 0; bit < 16; bit++) {
                        const x = w * 16 + bit;
                        if (x >= width) break;
                        const row = pixelColors[y];
                        if (row && row[x] === targetColor) {
                            word |= (1 << (15 - bit));
                        }
                    }
                    wordValues.push(word);
                }
            }

            maskDefs.push({ id: maskId, wordValues: wordValues });
            maskIdList.push(maskId);
        }

        // 色が0個の場合（全透明パターン）
        if (uniqueColors.length === 0) {
            const emptyWordValues = new Array(wordsPerRow * height).fill(0);
            const maskId = nextMaskId;
            maskDefs.push({ id: maskId, wordValues: emptyWordValues });
            maskIdList.push(maskId);
        }

        return {
            ncol: ncol,
            fgcolors: fgcolors,
            bgcolor: bgcolor,
            masks: maskIdList.join(','),
            maskDefs: maskDefs
        };
    }

    parseMarkerElement(elem) {
        const mode = parseInt(elem.getAttribute('mode')) || 0;
        const markerId = parseInt(elem.getAttribute('markerid') || elem.getAttribute('markerId')) || 0;
        const pointsStr = elem.getAttribute('points') || '';
        const zIndexAttr = elem.getAttribute('zindex') || elem.getAttribute('zIndex');

        const points = [];
        if (pointsStr) {
            const pairs = pointsStr.trim().split(/\s+/);
            pairs.forEach(pair => {
                const coords = pair.split(',').map(parseFloat);
                if (coords.length >= 2) {
                    points.push({ x: coords[0], y: coords[1] });
                }
            });
        }

        const markerDef = this.markerDefinitions.get(markerId);

        return {
            type: 'marker',
            markerId: markerId,
            mode: mode,
            points: points,
            strokeColor: markerDef ? markerDef.fgCol : '#000000',
            fillColor: 'transparent',
            lineWidth: 1,
            fillEnabled: false,
            zIndex: zIndexAttr !== null ? parseInt(zIndexAttr) : null
        };
    }

    drawMarker(x, y, markerDef) {
        const half = Math.floor(markerDef.size / 2);
        this.ctx.save();
        this.ctx.strokeStyle = markerDef.fgCol;
        this.ctx.fillStyle = markerDef.fgCol;
        this.ctx.lineWidth = 1;

        if (markerDef.shape) {
            switch (markerDef.shape) {
                case 'dot':
                    this.ctx.fillRect(x, y, 1, 1);
                    break;
                case 'plus':
                    this.ctx.beginPath();
                    this.ctx.moveTo(x - half, y);
                    this.ctx.lineTo(x + half, y);
                    this.ctx.moveTo(x, y - half);
                    this.ctx.lineTo(x, y + half);
                    this.ctx.stroke();
                    break;
                case 'star':
                    this.ctx.beginPath();
                    this.ctx.moveTo(x, y - half);
                    this.ctx.lineTo(x, y + half);
                    this.ctx.moveTo(x - half, y + half);
                    this.ctx.lineTo(x + half, y - half);
                    this.ctx.moveTo(x - half, y - half);
                    this.ctx.lineTo(x + half, y + half);
                    this.ctx.stroke();
                    break;
                case 'circle':
                    this.ctx.beginPath();
                    this.ctx.arc(x, y, half, 0, 2 * Math.PI);
                    this.ctx.stroke();
                    break;
                case 'cross':
                    this.ctx.beginPath();
                    this.ctx.moveTo(x - half, y - half);
                    this.ctx.lineTo(x + half, y + half);
                    this.ctx.moveTo(x + half, y - half);
                    this.ctx.lineTo(x - half, y + half);
                    this.ctx.stroke();
                    break;
            }
        } else if (markerDef.mask !== undefined) {
            // カスタムマーカーの簡易表示（菱形で代替）
            this.ctx.beginPath();
            this.ctx.moveTo(x, y - half);
            this.ctx.lineTo(x + half, y);
            this.ctx.lineTo(x, y + half);
            this.ctx.lineTo(x - half, y);
            this.ctx.closePath();
            this.ctx.fill();
        }

        this.ctx.restore();
    }

    parseGroupElement(elem) {
        // グループセグメント: <group left="..." top="..." right="..." bottom="...">子図形...</group>
        const left = parseFloat(elem.getAttribute('left')) || 0;
        const top = parseFloat(elem.getAttribute('top')) || 0;
        const right = parseFloat(elem.getAttribute('right')) || 100;
        const bottom = parseFloat(elem.getAttribute('bottom')) || 100;

        // 子図形を解析
        const childShapes = [];
        const children = elem.children;
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            const tagName = child.tagName.toLowerCase();

            // 子図形を再帰的に解析
            if (tagName === 'line') {
                childShapes.push(this.parseLineElement(child));
            } else if (tagName === 'rect') {
                childShapes.push(this.parseRectElement(child));
            } else if (tagName === 'ellipse') {
                childShapes.push(this.parseEllipseElement(child));
            } else if (tagName === 'polyline') {
                childShapes.push(this.parsePolylineElement(child));
            } else if (tagName === 'spline') {
                childShapes.push(this.parseSplineElement(child));
            } else if (tagName === 'curve') {
                childShapes.push(this.parseCurveElement(child));
            } else if (tagName === 'polygon') {
                childShapes.push(this.parsePolygonElement(child));
            } else if (tagName === 'link') {
                childShapes.push(this.parseLinkElement(child));
            } else if (tagName === 'arc') {
                childShapes.push(this.parseArcElement(child));
            } else if (tagName === 'chord') {
                childShapes.push(this.parseChordElement(child));
            } else if (tagName === 'elliptical_arc') {
                childShapes.push(this.parseEllipticalArcElement(child));
            } else if (tagName === 'image') {
                childShapes.push(this.parseImageElement(child));
            } else if (tagName === 'pixelmap') {
                childShapes.push(this.parsePixelmapElement(child));
            } else if (tagName === 'markerdefine') {
                this.parseMarkerDefineElement(child);
            } else if (tagName === 'marker') {
                childShapes.push(this.parseMarkerElement(child));
            } else if (tagName === 'group') {
                // ネストされたグループを再帰的に解析
                childShapes.push(this.parseGroupElement(child));
            } else if (tagName === 'text') {
                // 次の要素がdocumentか確認（文字枠の場合）
                const nextChild = i + 1 < children.length ? children[i + 1] : null;
                if (nextChild && nextChild.tagName.toLowerCase() === 'document') {
                    // 文字枠として解析
                    childShapes.push(this.parseDocumentElement(child, nextChild));
                    i++; // documentもスキップ
                } else {
                    // 通常のtext要素として解析
                    childShapes.push(this.parseTextElement(child));
                }
            } else if (tagName === 'document') {
                // document内にtext要素がある場合は文字枠として処理（新形式）
                const textElem = child.querySelector('text');
                if (textElem) {
                    childShapes.push(this.parseDocumentElement(textElem, child));
                }
                // textなしのdocumentは無視
            }
        }

        return {
            type: 'group',
            shapes: childShapes,
            startX: left,
            startY: top,
            endX: right,
            endY: bottom,
            strokeColor: '#000000',
            fillColor: 'transparent',
            lineWidth: 1
        };
    }

    parseArcElement(elem) {
        // tad.js形式: <arc l_atr="..." l_pat="..." f_pat="..." angle="..." cx="..." cy="..." rx="..." ry="..." startX="..." startY="..." endX="..." endY="..." startAngle="..." endAngle="...">
        const centerX = parseFloat(elem.getAttribute('cx')) || 0;
        const centerY = parseFloat(elem.getAttribute('cy')) || 0;
        const radiusX = parseFloat(elem.getAttribute('rx')) || 0;
        const radiusY = parseFloat(elem.getAttribute('ry')) || 0;
        // startX/endXがXMLに存在しない場合はcx/cy/rx/ryから計算
        let startX, startY, endX, endY;
        if (elem.getAttribute('startX') !== null) {
            startX = parseFloat(elem.getAttribute('startX')) || 0;
            startY = parseFloat(elem.getAttribute('startY')) || 0;
            endX = parseFloat(elem.getAttribute('endX')) || 0;
            endY = parseFloat(elem.getAttribute('endY')) || 0;
        } else {
            startX = centerX - radiusX;
            startY = centerY - radiusY;
            endX = centerX + radiusX;
            endY = centerY + radiusY;
        }
        const startAngle = parseFloat(elem.getAttribute('startAngle')) || 0;
        const endAngle = parseFloat(elem.getAttribute('endAngle')) || 0;
        const angle = parseFloat(elem.getAttribute('angle')) || 0;

        const { lineType, lineWidth } = this._parseLineTypeAndWidth(elem);
        const { linePatternId, fillPatternId, fillEnabled, strokeColor, fillColor } = this._parsePatternAndColors(elem);

        return {
            type: 'arc',
            centerX: centerX,
            centerY: centerY,
            radiusX: radiusX,
            radiusY: radiusY,
            startX: startX,
            startY: startY,
            endX: endX,
            endY: endY,
            startAngle: startAngle,
            endAngle: endAngle,
            angle: angle,
            strokeColor: strokeColor,
            fillColor: fillColor,
            lineWidth: lineWidth,
            lineType: lineType,
            linePatternId: linePatternId,
            fillEnabled: fillEnabled,
            fillPatternId: fillPatternId,
            zIndex: this._parseZIndex(elem)
        };
    }

    parseChordElement(elem) {
        // tad.js形式: <chord l_atr="..." l_pat="..." f_pat="..." angle="..." fillColor="..." strokeColor="..." cx="..." cy="..." rx="..." ry="..." startX="..." startY="..." endX="..." endY="..." startAngle="..." endAngle="...">
        const centerX = parseFloat(elem.getAttribute('cx')) || 0;
        const centerY = parseFloat(elem.getAttribute('cy')) || 0;
        const radiusX = parseFloat(elem.getAttribute('rx')) || 0;
        const radiusY = parseFloat(elem.getAttribute('ry')) || 0;
        // startX/endXがXMLに存在しない場合はcx/cy/rx/ryから計算
        let startX, startY, endX, endY;
        if (elem.getAttribute('startX') !== null) {
            startX = parseFloat(elem.getAttribute('startX')) || 0;
            startY = parseFloat(elem.getAttribute('startY')) || 0;
            endX = parseFloat(elem.getAttribute('endX')) || 0;
            endY = parseFloat(elem.getAttribute('endY')) || 0;
        } else {
            startX = centerX - radiusX;
            startY = centerY - radiusY;
            endX = centerX + radiusX;
            endY = centerY + radiusY;
        }
        const startAngle = parseFloat(elem.getAttribute('startAngle')) || 0;
        const endAngle = parseFloat(elem.getAttribute('endAngle')) || 0;
        const angle = parseFloat(elem.getAttribute('angle')) || 0;

        const { lineType, lineWidth } = this._parseLineTypeAndWidth(elem);
        const { linePatternId, fillPatternId, fillEnabled, strokeColor, fillColor } = this._parsePatternAndColors(elem);

        return {
            type: 'chord',
            centerX: centerX,
            centerY: centerY,
            radiusX: radiusX,
            radiusY: radiusY,
            startX: startX,
            startY: startY,
            endX: endX,
            endY: endY,
            startAngle: startAngle,
            endAngle: endAngle,
            angle: angle,
            strokeColor: strokeColor,
            fillColor: fillColor,
            lineWidth: lineWidth,
            lineType: lineType,
            linePatternId: linePatternId,
            fillEnabled: fillEnabled,
            fillPatternId: fillPatternId,
            zIndex: this._parseZIndex(elem)
        };
    }

    parseEllipticalArcElement(elem) {
        // tad.js形式: <elliptical_arc l_atr="..." l_pat="..." angle="..." cx="..." cy="..." rx="..." ry="..." startX="..." startY="..." endX="..." endY="..." startAngle="..." endAngle="...">
        const centerX = parseFloat(elem.getAttribute('cx')) || 0;
        const centerY = parseFloat(elem.getAttribute('cy')) || 0;
        const radiusX = parseFloat(elem.getAttribute('rx')) || 0;
        const radiusY = parseFloat(elem.getAttribute('ry')) || 0;
        // startX/endXがXMLに存在しない場合はcx/cy/rx/ryから計算
        let startX, startY, endX, endY;
        if (elem.getAttribute('startX') !== null) {
            startX = parseFloat(elem.getAttribute('startX')) || 0;
            startY = parseFloat(elem.getAttribute('startY')) || 0;
            endX = parseFloat(elem.getAttribute('endX')) || 0;
            endY = parseFloat(elem.getAttribute('endY')) || 0;
        } else {
            startX = centerX - radiusX;
            startY = centerY - radiusY;
            endX = centerX + radiusX;
            endY = centerY + radiusY;
        }
        const startAngle = parseFloat(elem.getAttribute('startAngle')) || 0;
        const endAngle = parseFloat(elem.getAttribute('endAngle')) || 0;
        const angle = parseFloat(elem.getAttribute('angle')) || 0;

        const { lineType, lineWidth } = this._parseLineTypeAndWidth(elem);
        const { linePatternId, strokeColor } = this._parsePatternAndColors(elem, { fillEnabled: false });

        return {
            type: 'elliptical_arc',
            centerX: centerX,
            centerY: centerY,
            radiusX: radiusX,
            radiusY: radiusY,
            startX: startX,
            startY: startY,
            endX: endX,
            endY: endY,
            startAngle: startAngle,
            endAngle: endAngle,
            angle: angle,
            strokeColor: strokeColor,
            fillColor: 'transparent',
            lineWidth: lineWidth,
            lineType: lineType,
            linePatternId: linePatternId,
            fillEnabled: false,
            zIndex: this._parseZIndex(elem)
        };
    }
};
