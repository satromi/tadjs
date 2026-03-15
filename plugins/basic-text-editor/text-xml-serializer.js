/**
 * 基本文章編集プラグイン - XML生成・保存系Mixin
convertEditorToXML, extractTADXMLFromElement等
 * @module TextXmlSerializerMixin
 */
const logger = window.getLogger('BasicTextEditor');

export const TextXmlSerializerMixin = (Base) => class extends Base {
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

            // 前の段落のタブ書式を追跡（差分出力用）
            let prevTabFormatState = null;

            for (const child of editorChildren) {
                // 段落要素の処理
                if (child.nodeType === Node.ELEMENT_NODE && child.nodeName.toLowerCase() === 'p') {
                    const p = child;
                    xmlParts.push('<p>\r\n');

                    // <tab-format/>タグを出力（前段落と異なる場合のみ）
                    const currentTabFormat = this.extractTabFormat(p);
                    if (currentTabFormat) {
                        const hasChanged = !prevTabFormatState ||
                            JSON.stringify(currentTabFormat) !== JSON.stringify(prevTabFormatState);
                        if (hasChanged) {
                            let tfAttrs = `R="${currentTabFormat.R}" P="${currentTabFormat.P}"`;
                            tfAttrs += ` height="${currentTabFormat.height}" pargap="${currentTabFormat.pargap}"`;
                            tfAttrs += ` left="${currentTabFormat.left}" right="${currentTabFormat.right}"`;
                            tfAttrs += ` indent="${currentTabFormat.indent}"`;
                            tfAttrs += ` ntabs="${currentTabFormat.ntabs}"`;
                            if (currentTabFormat.tabs && currentTabFormat.tabs.length > 0) {
                                tfAttrs += ` tabs="${currentTabFormat.tabs.join(',')}"`;
                            }
                            xmlParts.push(`<tab-format ${tfAttrs}/>`);
                        }
                        prevTabFormatState = { ...currentTabFormat };
                    }

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
                // 段落外の図形セグメント要素を処理（新しい段落として出力）
                else if (child.nodeType === Node.ELEMENT_NODE &&
                         child.classList &&
                         child.classList.contains('figure-segment')) {
                    xmlParts.push('<p>\r\n');
                    // figure-segment単体をラッパーで包んで処理
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
    extractTADXMLFromElement(element, xmlParts, fontState = { size: String(DEFAULT_FONT_SIZE), color: DEFAULT_CHCOL, face: '' }, effectiveColor = null) {
        // xmlPartsが配列でない場合（古い呼び出し方）は、配列を作成して戻り値を返す
        // 古いスタイル: extractTADXMLFromElement(element, fontState, effectiveColor)
        // 新しいスタイル: extractTADXMLFromElement(element, xmlPartsArray, fontState, effectiveColor)
        const isOldStyle = !Array.isArray(xmlParts);
        if (isOldStyle) {
            // 古いスタイルでは: xmlParts=fontState, fontState=effectiveColor
            const oldEffectiveColor = fontState;  // 3rd param was effectiveColor
            fontState = xmlParts || { size: String(DEFAULT_FONT_SIZE), color: DEFAULT_CHCOL, face: '' };
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
            } else if (node.nodeType === Node.ELEMENT_NODE && node.classList && node.classList.contains('figure-segment')) {
                // div.figure-segment要素をインライン<figure>として出力
                const figureXmlTadBase64 = node.getAttribute('data-figure-xmltad');
                if (figureXmlTadBase64) {
                    const figureXmlTad = decodeURIComponent(escape(atob(figureXmlTadBase64)));
                    // <tad>ラッパーを除去し、<figure>...</figure>のみ出力
                    const figureMatch = /<figure[^>]*>[\s\S]*<\/figure>/i.exec(figureXmlTad);
                    if (figureMatch) {
                        xml += figureMatch[0];
                    }
                }
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

                // xmlTAD標準形式で出力（href/left/top/right/bottom属性）
                let imageXml = `<image lineType="0" lineWidth="0" l_pat="0" f_pat="0" angle="0" rotation="0" flipH="false" flipV="false" left="0" top="0" right="${displayWidth}" bottom="${displayHeight}" href="${this.escapeXml(savedFileName)}"`;

                imageXml += '/>';
                xml += imageXml;
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
                    // 黒色（DEFAULT_CHCOL）はデフォルト色なので出力不要
                    if (color && color !== DEFAULT_CHCOL && color !== fontState.color) {
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
                                    const isDefaultBlack = hexColor === DEFAULT_CHCOL;
                                    // ブラウザデフォルト黒色で有効色が非黒色の場合は状態を更新しない
                                    if (!(isDefaultBlack && effectiveColor && effectiveColor !== DEFAULT_CHCOL)) {
                                        newState.color = hexColor;
                                    }
                                }
                                if (style.fontFamily) {
                                    newState.face = style.fontFamily;
                                }
                                if (style.letterSpacing) {
                                    newState.space = style.letterSpacing.replace('em', '');
                                }

                                // 子要素を処理（空要素でも子要素がある可能性）
                                xml += this.extractTADXMLFromElement(node, newState, effectiveColor);

                                // fontStateを更新（呼び出し元に反映）
                                fontState.color = newState.color;
                                fontState.size = newState.size;
                                fontState.face = newState.face;
                                fontState.space = newState.space;
                            } else {
                                // テキストを含むspan要素の通常処理
                                // 新しい状態を作成
                                const newState = { ...fontState };

                                // フォントタグを追跡（ペアタグ用）
                                let colorTagOpened = false;
                                let sizeTagOpened = false;
                                let faceTagOpened = false;
                                let spaceTagOpened = false;

                                // スタイル開始
                                // 色・サイズ・フェイス・文字間隔すべてペアタグ方式: <font ...>content</font>
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
                                if (style.letterSpacing) {
                                    // em単位からBTRON値を取得
                                    const spaceValue = style.letterSpacing.replace('em', '');
                                    const currentSpace = fontState.space || '0';
                                    if (spaceValue !== currentSpace) {
                                        xml += `<font space="${spaceValue}">`;
                                        spaceTagOpened = true;
                                    }
                                    newState.space = spaceValue;
                                }

                                // 子要素を再帰的に処理（新しいフォント状態を渡す）
                                xml += this.extractTADXMLFromElement(node, newState, effectiveColor);

                                // ペアタグを閉じる（開いた順の逆順で閉じる）
                                if (spaceTagOpened) {
                                    xml += '</font>';
                                }
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
                                if (!spaceTagOpened) {
                                    fontState.space = newState.space;
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
     * <p>要素からタブ書式情報を抽出
     * @param {HTMLElement} p - 段落要素
     * @returns {Object|null} タブ書式オブジェクト、または未設定ならnull
     */
    extractTabFormat(p) {
        const tabFormatAttr = p.getAttribute('data-tab-format');
        if (!tabFormatAttr) return null;
        try {
            return JSON.parse(tabFormatAttr);
        } catch (e) {
            return null;
        }
    }

    /**
     * タブ書式設定ダイアログを表示
     * @param {Object|null} existingTabFormat - 既存のタブ書式（編集時）、またはnull（新規）
     * @returns {Promise<Object|null>} 設定されたタブ書式オブジェクト、またはnull（キャンセル）
     */
    async showTabFormatDialog(existingTabFormat) {
        const tf = existingTabFormat || {
            R: 0, P: 0, height: '0', pargap: '0.75',
            left: 0, right: 0, indent: 0, ntabs: 0, tabs: []
        };

        const tabInterval = (tf.tabs && tf.tabs.length > 0) ? tf.tabs[0] : 0;

        const dialogHtml = `
            <style>
                #dialog-input-field {
                    display: none !important;
                }
                #input-dialog-message:has(.tab-format-dialog) {
                    margin-bottom: 2px;
                    padding: 2px;
                }
                #input-dialog:has(.tab-format-dialog) {
                    padding: 4px;
                }
                #input-dialog:has(.tab-format-dialog) .dialog-buttons {
                    padding: 2px;
                    margin-top: 0px;
                }
                .tab-format-dialog {
                    font-family: sans-serif;
                    font-size: 11px;
                    padding: 0;
                }
                .tab-format-dialog .form-row {
                    display: flex;
                    align-items: center;
                    margin-bottom: 3px;
                }
                .tab-format-dialog .form-row:last-child {
                    margin-bottom: 0;
                }
                .tab-format-dialog .form-label {
                    width: 70px;
                    font-weight: normal;
                }
                .tab-format-dialog .form-input {
                    width: 70px;
                    padding: 2px 4px;
                    border: 1px inset #c0c0c0;
                    font-size: 11px;
                }
                .tab-format-dialog .form-unit {
                    margin-left: 4px;
                    color: #666;
                    font-size: 10px;
                }
                .tab-format-dialog .form-hint {
                    color: #888;
                    font-size: 10px;
                    margin-left: 4px;
                }
                .tab-format-dialog .form-separator {
                    border-top: 1px solid #c0c0c0;
                    margin: 4px 0;
                }
            </style>
            <div class="tab-format-dialog">
                <div class="form-row">
                    <label class="form-label">左マージン:</label>
                    <input type="number" class="form-input" id="tfLeft" value="${tf.left}" data-form-id="tfLeft">
                    <span class="form-hint">2行目以降</span>
                </div>
                <div class="form-row">
                    <label class="form-label">右マージン:</label>
                    <input type="number" class="form-input" id="tfRight" value="${tf.right}" data-form-id="tfRight">
                    <span class="form-hint">TAD単位</span>
                </div>
                <div class="form-row">
                    <label class="form-label">字下げ:</label>
                    <input type="number" class="form-input" id="tfIndent" value="${tf.indent}" data-form-id="tfIndent">
                    <span class="form-hint">1行目</span>
                </div>
                <div class="form-separator"></div>
                <div class="form-row">
                    <label class="form-label">行間:</label>
                    <input type="number" class="form-input" id="tfHeight" value="${tf.height}" step="0.25" data-form-id="tfHeight">
                    <span class="form-hint">0=標準(1.5倍)</span>
                </div>
                <div class="form-row">
                    <label class="form-label">段落間隔:</label>
                    <input type="number" class="form-input" id="tfPargap" value="${tf.pargap}" step="0.25" data-form-id="tfPargap">
                    <span class="form-hint">倍率</span>
                </div>
                <div class="form-separator"></div>
                <div class="form-row">
                    <label class="form-label">タブ間隔:</label>
                    <input type="number" class="form-input" id="tfTabInterval" value="${tabInterval}" data-form-id="tfTabInterval">
                    <span class="form-hint">0=指定なし</span>
                </div>
            </div>
        `;

        const result = await this.showCustomDialog({
            title: 'タブ書式設定',
            dialogHtml: dialogHtml,
            buttons: [
                { label: '取消', value: 'cancel' },
                { label: '設定', value: 'ok' }
            ],
            defaultButton: 1,
            width: 300
        });

        if (!result || result.button !== 'ok') {
            return null;
        }

        const formData = result.formData || {};
        const left = parseInt(formData.tfLeft) || 0;
        const right = parseInt(formData.tfRight) || 0;
        const indent = parseInt(formData.tfIndent) || 0;
        const height = formData.tfHeight || '0';
        const pargap = formData.tfPargap || '0.75';
        const tabIntervalValue = parseInt(formData.tfTabInterval) || 0;

        const tabs = tabIntervalValue > 0 ? [tabIntervalValue] : [];
        const ntabs = tabs.length;

        return {
            R: tf.R || 0,
            P: tf.P || 0,
            height: height,
            pargap: pargap,
            left: left,
            right: right,
            indent: indent,
            ntabs: ntabs,
            tabs: tabs
        };
    }

    /**
     * 段落要素にタブ書式のCSSスタイルを適用
     * @param {HTMLElement} paragraph - 対象の<p>要素
     * @param {Object} tabFormatState - タブ書式オブジェクト
     */
    applyTabFormatToParagraph(paragraph, tabFormatState) {
        // data-tab-format属性を設定
        paragraph.setAttribute('data-tab-format', JSON.stringify(tabFormatState));

        // TAD単位→px変換
        const hunit = (this.docScale && this.docScale.hunit) ? this.docScale.hunit : -120;
        const tadUnitToPx = Math.abs(96 / hunit);

        // margin-left
        if (tabFormatState.left !== 0) {
            paragraph.style.marginLeft = `${tabFormatState.left * tadUnitToPx}px`;
        } else {
            paragraph.style.marginLeft = '';
        }
        // margin-right
        if (tabFormatState.right !== 0) {
            paragraph.style.marginRight = `${tabFormatState.right * tadUnitToPx}px`;
        } else {
            paragraph.style.marginRight = '';
        }
        // text-indent
        if (tabFormatState.indent !== 0) {
            paragraph.style.textIndent = `${tabFormatState.indent * tadUnitToPx}px`;
        } else {
            paragraph.style.textIndent = '';
        }
        // pargap（段落間隔）
        const pargapValue = parseFloat(tabFormatState.pargap);
        const maxFontSize = this.calculateMaxFontSizeInContent(paragraph, 14);
        if (!isNaN(pargapValue) && tabFormatState.pargap !== '0.75') {
            const pargapPx = pargapValue * maxFontSize;
            paragraph.style.margin = `${pargapPx}px 0`;
        } else {
            paragraph.style.margin = '0.5em 0';
        }
        // tab-size
        if (tabFormatState.tabs && tabFormatState.tabs.length > 0) {
            const tabInterval = tabFormatState.tabs[0] * tadUnitToPx;
            if (tabInterval > 0) {
                paragraph.style.tabSize = `${tabInterval}px`;
                paragraph.style.MozTabSize = `${tabInterval}px`;
            }
        } else {
            paragraph.style.tabSize = '';
            paragraph.style.MozTabSize = '';
        }
        // line-height
        const heightValue = parseFloat(tabFormatState.height);
        const lineHeight = (heightValue > 0) ? heightValue * maxFontSize : maxFontSize * 1.5;
        paragraph.style.lineHeight = `${lineHeight}px`;
    }

    /**
     * 新規タブ書式をカーソル位置の段落に適用し、後続段落にもカスケード適用
     */
    async applyNewTabFormat() {
        const selection = window.getSelection();
        if (selection.rangeCount === 0) return;

        const range = selection.getRangeAt(0);

        // 範囲選択の有無を判定（B-1: 範囲選択時の処理分岐用）
        const hasSelection = !range.collapsed;

        // カーソル位置の段落要素を取得
        let paragraph = range.startContainer;
        while (paragraph && paragraph.nodeName !== 'P') {
            paragraph = paragraph.parentNode;
        }
        if (!paragraph || paragraph.nodeName !== 'P') {
            this.setStatus('段落が見つかりません');
            return;
        }

        // 範囲選択時の処理（B-1）
        if (hasSelection) {
            // 選択範囲の終了段落を取得
            let endParagraph = range.endContainer;
            while (endParagraph && endParagraph.nodeName !== 'P') {
                endParagraph = endParagraph.parentNode;
            }
            if (!endParagraph || endParagraph.nodeName !== 'P') {
                endParagraph = paragraph;
            }

            // 選択範囲の開始段落の既存タブ書式を取得
            const oldTabFormat = this.extractTabFormat(paragraph);

            // ダイアログ表示
            const newTabFormat = await this.showTabFormatDialog(oldTabFormat);
            if (!newTabFormat) return;

            // 選択範囲の開始段落から終了段落までにタブ書式を適用
            let p = paragraph;
            while (p) {
                if (p.nodeName === 'P') {
                    this.applyTabFormatToParagraph(p, newTabFormat);
                }
                if (p === endParagraph) break;
                p = p.nextElementSibling;
            }

            // 終了段落の次の段落に元のタブ書式を復元（元の書式がある場合）
            if (oldTabFormat) {
                const nextP = endParagraph.nextElementSibling;
                if (nextP && nextP.nodeName === 'P') {
                    // 次の段落が元のタブ書式を継承していた場合のみ復元不要
                    // （既に元の書式を持っている）
                    const nextTabFormat = this.extractTabFormat(nextP);
                    const nextJson = nextTabFormat ? JSON.stringify(nextTabFormat) : null;
                    const oldJson = JSON.stringify(oldTabFormat);
                    if (nextJson !== oldJson) {
                        // 異なる書式を持つ → 元の書式を復元する段落を挿入しない
                        // （既に異なるタブ書式セクションが始まっている）
                    }
                    // 同じ書式 → 既にそのままで正しい
                }
            }

            this.isModified = true;
            this.setStatus('タブ書式を設定しました');
            return;
        }

        // 以下、カーソル位置（範囲選択なし）の処理

        // カーソルが段落の先頭にあるかチェック
        const beforeRange = document.createRange();
        beforeRange.setStart(paragraph, 0);
        beforeRange.setEnd(range.startContainer, range.startOffset);
        const beforeText = beforeRange.toString().replace(/\u200B/g, '');
        const isAtStart = beforeText.length === 0;

        // 既存のタブ書式を取得（カスケード比較用）
        const oldTabFormat = this.extractTabFormat(paragraph);
        const oldTabFormatJson = oldTabFormat ? JSON.stringify(oldTabFormat) : null;

        // ダイアログ表示
        const newTabFormat = await this.showTabFormatDialog(oldTabFormat);
        if (!newTabFormat) return;  // キャンセル

        if (!isAtStart) {
            // カーソルが段落途中の場合: 改段落してから新しい段落にタブ書式を適用（A-1）
            this.suppressMutationObserverCount++;

            // カーソル位置で段落を分割
            const afterRange = range.cloneRange();
            afterRange.setEndAfter(paragraph.lastChild || paragraph);
            const afterContent = afterRange.extractContents();

            // 新しい段落を作成
            const newP = document.createElement('p');
            const afterText = afterContent.textContent.replace(/\u200B/g, '').trim();
            if (afterText === '') {
                // 分割後の内容が空（段落末尾にカーソルがあった場合）
                newP.innerHTML = '<br>';
            } else {
                newP.appendChild(afterContent);
                this.removeEmptySpans(newP);
            }

            // 元の段落が空になった場合の処理
            if (paragraph.childNodes.length === 0) {
                paragraph.innerHTML = '<br>';
            }

            // 新しい段落を挿入
            if (paragraph.nextSibling) {
                paragraph.parentNode.insertBefore(newP, paragraph.nextSibling);
            } else {
                paragraph.parentNode.appendChild(newP);
            }

            // line-height設定
            const newPFontSize = this.calculateMaxFontSizeInContent(newP, 14);
            const lineHeight = this.calculateLineHeight(newPFontSize);
            newP.style.lineHeight = `${lineHeight}px`;

            // 新しい段落にタブ書式を適用
            this.applyTabFormatToParagraph(newP, newTabFormat);

            // カーソルを新しい段落の先頭に移動
            const newRange = document.createRange();
            if (newP.firstChild) {
                if (newP.firstChild.nodeType === Node.TEXT_NODE) {
                    newRange.setStart(newP.firstChild, 0);
                } else {
                    newRange.setStartBefore(newP.firstChild);
                }
            } else {
                newRange.setStart(newP, 0);
            }
            newRange.collapse(true);
            selection.removeAllRanges();
            selection.addRange(newRange);

            // MutationObserver再開
            setTimeout(() => {
                this.suppressMutationObserverCount--;
                this.updateContentHeight();
            }, 0);

            // カスケード対象をnewPから開始
            paragraph = newP;
        } else {
            // カーソルが段落先頭の場合: 現在の段落にタブ書式を適用
            this.applyTabFormatToParagraph(paragraph, newTabFormat);
        }

        // 後続段落へのカスケード適用
        // 次のタブ書式指定付箋（異なるdata-tab-format）を持つ段落まで適用
        if (oldTabFormatJson) {
            let sibling = paragraph.nextElementSibling;
            while (sibling) {
                if (sibling.nodeName !== 'P') {
                    sibling = sibling.nextElementSibling;
                    continue;
                }
                const siblingTabFormat = this.extractTabFormat(sibling);
                const siblingJson = siblingTabFormat ? JSON.stringify(siblingTabFormat) : null;
                // 旧タブ書式と一致する段落（継承していた）→ 新しい値に更新
                if (siblingJson === oldTabFormatJson) {
                    this.applyTabFormatToParagraph(sibling, newTabFormat);
                    sibling = sibling.nextElementSibling;
                } else {
                    // 異なるタブ書式を持つ段落 → カスケード停止
                    break;
                }
            }
        }

        this.isModified = true;
        this.setStatus('タブ書式を設定しました');
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
                    chsz: DEFAULT_FONT_SIZE,
                    frcol: DEFAULT_BGCOL,
                    chcol: DEFAULT_CHCOL,
                    tbcol: DEFAULT_TBCOL,
                    bgcol: DEFAULT_BGCOL,
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
};
