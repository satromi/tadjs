/**
 * 基本文章編集プラグイン - XML生成・保存系Mixin
convertEditorToXML, extractTADXMLFromElement等
 * @module TextXmlSerializerMixin
 */
const logger = window.getLogger('BasicTextEditor');

export const TextXmlSerializerMixin = (Base) => class extends Base {
    async convertEditorToXML() {
        logger.debug('[EDITOR] convertEditorToXML開始');

        // 保存前に全段落のfont-sizeを最新化
        // （updateParagraphLineHeightが呼ばれていない段落のstyle.fontSizeがnullだと
        //   前段落のサイズを誤って継承してしまうため）
        this.updateParagraphLineHeight(true);

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

        // BTRON GUI 仕様準拠: <docmargin> は paperMargin が実在する場合のみ出力
        // (paperMargin が無い場合に強制出力した「全部 0 の docmargin」 は仕様上「本文が用紙端ギリギリ」 を意味してしまい不適切)
        if (this.paperMargin) {
            xmlParts.push(`<docmargin top="${this.paperMargin.top}" bottom="${this.paperMargin.bottom}" left="${this.paperMargin.left}" right="${this.paperMargin.right}" />\r\n`);
        }

        // 文字方向 (BTRON 2.1.4 FFA1 SubID 0x04): editor の writing-mode/direction から復元
        if (this.editor) {
            const wm = this.editor.style.writingMode || '';
            const dir = this.editor.style.direction || '';
            let txdir = 0;
            if (wm.startsWith('vertical')) txdir = 2;
            else if (dir === 'rtl') txdir = 1;
            else if (this.textDirection !== undefined && this.textDirection !== null) txdir = this.textDirection;
            if (txdir !== 0) {
                xmlParts.push(`<text direction="${txdir}"/>\r\n`);
            }
        }

        // <column>要素を出力（段組み設定がある場合のみ）
        if (this.editor && this.editor.style.columnCount && parseInt(this.editor.style.columnCount, 10) >= 2) {
            const colCount = parseInt(this.editor.style.columnCount, 10);
            const colGapPx = parseFloat(this.editor.style.columnGap || '0');
            const h = Number((this.docScale && this.docScale.hunit) || 0);
            const f = h === 0 ? 1 : (h < 0 ? 96 / Math.abs(h) : h);
            const colsp = f > 0 ? Math.round(colGapPx / f) : 0;
            const balance = this.editor.style.columnFill === 'balance' ? 1 : 0;
            xmlParts.push(`<column column="${colCount}" balance="${balance}" colsp="${colsp}" />\r\n`);
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

            // 前段落の text-align を追跡 (BTRON 2.1.1 継承: 同値なら冗長な <text align> を出力しない)
            let prevTextAlign = 'left';

            // 前段落の line-height を追跡 (BTRON 2.1.0 継承: 同値なら冗長な <text line-height> を出力しない)
            let prevLineHeight = null;

            // 前段落の行頭/行末禁則 attrs 文字列を追跡 (BTRON 2.4.8/2.4.9 継承)
            let prevLineHeadKinsokuAttrs = null;
            let prevLineTailKinsokuAttrs = null;

            // v2: タブ書式付箋のシリアライズは ruler / hidden-tab-format span を SSOT とする。
            // 段落の data-tab-format JSON 由来出力 (旧 L107-160) は完全撤廃。
            // prevTabFormatState による差分判定も撤廃 (個別 ruler が独立に出力されるため不要)

            for (const child of editorChildren) {
                // 中間段落の用紙設定変更マーカー (hidden-paper-change span):
                // BTRON 仕様 p.81「用紙指定変更は改ページの直後を推奨」 準拠で、
                // 2 段落目以降の用紙指定付箋・マージン指定付箋の直前に <pagebreak/> (属性なし = 無条件改ページ) を挿入する。
                // 改ページコード 0x0c (\f) は XML 1.0 で無効な文字なので、 xmlTAD では <pagebreak/> タグで表現する。
                if (child.nodeType === Node.ELEMENT_NODE
                        && child.classList
                        && child.classList.contains('hidden-paper-change')) {
                    const paperAttrs = child.dataset.paperAttrs || '';
                    const docmarginAttrs = child.dataset.docmarginAttrs || '';
                    if (paperAttrs || docmarginAttrs) {
                        xmlParts.push('<pagebreak />\r\n');
                        if (paperAttrs) xmlParts.push(`<paper ${paperAttrs} />\r\n`);
                        if (docmarginAttrs) xmlParts.push(`<docmargin ${docmarginAttrs} />\r\n`);
                    }
                    continue;
                }
                // Phase 2 H4: 中間段落のコラム指定変更マーカー (hidden-column-change span):
                // BTRON 2.0.2 「次のコラム指定付箋まで継続」 仕様準拠でラウンドトリップ保存
                if (child.nodeType === Node.ELEMENT_NODE
                        && child.classList
                        && child.classList.contains('hidden-column-change')) {
                    const columnAttrs = child.dataset.columnAttrs || '';
                    if (columnAttrs) {
                        xmlParts.push(`<column ${columnAttrs} />\r\n`);
                    }
                    continue;
                }
                // Phase 4 M6: 用紙オーバーレイ定義付箋 (paper-overlay-define-preserved span):
                // 中身の文章 TAD データは Base64 から復元してペアタグで再出力
                if (child.nodeType === Node.ELEMENT_NODE
                        && child.classList
                        && child.classList.contains('paper-overlay-define-preserved')) {
                    const attrs = this.unescapeAttrs(child.dataset.attrs || '');
                    const contentB64 = child.dataset.contentB64 || '';
                    let content = '';
                    if (contentB64) {
                        try {
                            content = decodeURIComponent(escape(atob(contentB64)));
                        } catch (e) {
                            content = '';
                        }
                    }
                    xmlParts.push(`<paper-overlay-define ${attrs}>${content}</paper-overlay-define>\r\n`);
                    continue;
                }

                // 段落要素の処理
                if (child.nodeType === Node.ELEMENT_NODE && child.nodeName.toLowerCase() === 'p') {
                    const p = child;
                    xmlParts.push('<p>\r\n');

                    // 段落のスタイルを解析してタグに変換
                    const fontSize = this.extractFontSize(p);
                    const fontFamily = this.extractFontFamily(p);
                    const color = this.extractColor(p);
                    const textAlign = this.extractTextAlign(p);
                    // indentPx 経由の逆算は廃止 (anchor span を <indent/> として直接出力する)

                    // text-align 情報を自己閉じタグとして追加 (BTRON 2.1.1 継承: 前段落と異なる時のみ出力)
                    const normalizedTextAlign = textAlign || 'left';
                    if (normalizedTextAlign !== prevTextAlign) {
                        xmlParts.push(`<text align="${normalizedTextAlign}"/>`);
                        prevTextAlign = normalizedTextAlign;
                    }

                    // line-height 情報を自己閉じタグとして追加 (BTRON 2.1.0 継承: 前段落と異なる時のみ出力)
                    // 仮身だけの段落 (実テキストなし) は行間倍率が無意味で、 読込と保存で基準フォントサイズが
                    // 食い違って毎回増幅する温床になるため line-height を出力しない (仮身の高さは仮身要素が持つ)。
                    // 仮身 span は namedisp の実身名を textContent に持つため、 仮身・制御 span を除いて判定する
                    const pTextProbe = p.cloneNode(true);
                    pTextProbe.querySelectorAll('.virtual-object, .detail-tab-format, .detail-align, .hidden-tab-format, .hidden-paper-change, .hidden-column-change, .hidden-line-head-kinsoku, .hidden-line-tail-kinsoku, .indent-anchor').forEach(el => el.remove());
                    const hasTextForLineHeight = (pTextProbe.textContent || '').trim().length > 0;
                    const currentLineHeightVal = hasTextForLineHeight ? this.extractLineHeight(p) : null;
                    if (currentLineHeightVal !== prevLineHeight) {
                        if (currentLineHeightVal !== null && currentLineHeightVal > 0) {
                            xmlParts.push(`<text line-height="${currentLineHeightVal}"/>`);
                        }
                        prevLineHeight = currentLineHeightVal;
                    }

                    // 行頭/行末禁則指定付箋 (BTRON 2.4.8/2.4.9 継承: 前段落と異なる時のみ出力)
                    const headKinsokuSpan = p.querySelector(':scope > .hidden-line-head-kinsoku');
                    const currentHeadKinsokuAttrs = headKinsokuSpan ? this.unescapeAttrs(headKinsokuSpan.dataset.attrs || '') : null;
                    if (currentHeadKinsokuAttrs !== prevLineHeadKinsokuAttrs) {
                        if (currentHeadKinsokuAttrs) {
                            xmlParts.push(`<line-head-kinsoku ${currentHeadKinsokuAttrs}/>`);
                        }
                        prevLineHeadKinsokuAttrs = currentHeadKinsokuAttrs;
                    }
                    const tailKinsokuSpan = p.querySelector(':scope > .hidden-line-tail-kinsoku');
                    const currentTailKinsokuAttrs = tailKinsokuSpan ? this.unescapeAttrs(tailKinsokuSpan.dataset.attrs || '') : null;
                    if (currentTailKinsokuAttrs !== prevLineTailKinsokuAttrs) {
                        if (currentTailKinsokuAttrs) {
                            xmlParts.push(`<line-tail-kinsoku ${currentTailKinsokuAttrs}/>`);
                        }
                        prevLineTailKinsokuAttrs = currentTailKinsokuAttrs;
                    }

                    // v2: タブ書式付箋のシリアライズは ruler/hidden-tab-format span のみが Single Source of Truth
                    // 段落内に複数の ruler/hidden-tab-format がある場合は出現順に全てを出力する (BTRON 後勝ち継承の境界表現)
                    const tabFormatHolders = p.querySelectorAll('.detail-tab-format, .hidden-tab-format');
                    for (const tabFormatHolder of tabFormatHolders) {
                        const rawAttrs = tabFormatHolder.dataset.tabAttrs || '';
                        if (rawAttrs) {
                            const decoded = rawAttrs.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
                            xmlParts.push('<tab-format ' + decoded + '/>');
                        }
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
                    } else {
                        // 段落のフォントサイズがデフォルト(14)の場合も、paragraphFontState.sizeを
                        // 現段落の実際のサイズに更新する（前段落の非デフォルトサイズが残らないようにする）
                        paragraphFontState.size = effectiveFontSize || '14';
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

                    // anchor span → <indent/> は extractTADXMLFromElement 内で処理済み (paragraphContent に既に含まれる)
                    let finalContent = paragraphContent;

                    // 継承フォントサイズがある場合、ペアタグで囲む
                    // ただし、段落内の全コンテンツが既にfontタグで包まれている場合は二重ラップを防止
                    if (inheritedFontSizeForPairTag) {
                        if (!this.isContentFullyWrappedByFontSize(finalContent)) {
                            finalContent = `<font size="${inheritedFontSizeForPairTag}">${finalContent}</font>`;
                        }
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
                    // BTRON 2.2.x 継承: 段落外要素跨ぎでも前段落のフォント状態 (色・サイズ・フェイス) を維持
                    const tempWrapper = document.createElement('div');
                    tempWrapper.appendChild(child.cloneNode(true));
                    this.extractTADXMLFromElement(tempWrapper, xmlParts, prevParagraphFontState);
                    xmlParts.push('\r\n</p>\r\n');
                }
                // 段落外の図形セグメント要素を処理（新しい段落として出力）
                else if (child.nodeType === Node.ELEMENT_NODE &&
                         child.classList &&
                         child.classList.contains('figure-segment')) {
                    xmlParts.push('<p>\r\n');
                    // figure-segment単体をラッパーで包んで処理
                    // BTRON 2.2.x 継承: 段落外要素跨ぎでもフォント状態を維持
                    const tempWrapper = document.createElement('div');
                    tempWrapper.appendChild(child.cloneNode(true));
                    this.extractTADXMLFromElement(tempWrapper, xmlParts, prevParagraphFontState);
                    xmlParts.push('\r\n</p>\r\n');
                }
                // 充填行指定付箋(fl-spacer)を処理
                else if (child.nodeType === Node.ELEMENT_NODE &&
                         child.classList &&
                         child.classList.contains('fl-spacer')) {
                    xmlParts.push('<fill-line />\r\n');
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
                // 装飾オーバーレイ (詳細モード ¶/↵ 表示用) はシリアライズ対象外
                else if (child.nodeType === Node.ELEMENT_NODE &&
                         child.classList &&
                         child.classList.contains('decoration-overlay')) {
                    // 何も出力しない
                }
                // その他の要素ノード（div等）も段落として処理
                else if (child.nodeType === Node.ELEMENT_NODE &&
                         child.nodeName.toLowerCase() !== 'br') {
                    xmlParts.push('<p>\r\n');
                    // BTRON 2.2.x 継承: 前段落のフォント状態を維持
                    this.extractTADXMLFromElement(child, xmlParts, prevParagraphFontState);
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
     * 空段落表示用の補助 br (ブラウザが <p></p> の高さ確保用に自動挿入する br) かを判定。
     * xmlTAD 仕様: 空段落 = <p></p> なので、 補助 br はシリアライズ対象外。
     */
    // 補助 br (data-filler 属性付き) のみシリアライズ対象外 (空段落 = <p></p> として出力)
    _isParagraphFillerBr(br) {
        return br.hasAttribute && br.hasAttribute('data-filler');
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
                // ブラウザが空段落 (<p></p> は高さ 0) の表示用に自動挿入する補助 br は
                // xmlTAD 仕様上ノイズ (改段落 = <p></p>) なので除外する
                if (!this._isParagraphFillerBr(node)) {
                    xml += '<br/>\r\n';
                }
            } else if (node.nodeType === Node.ELEMENT_NODE && node.classList && node.classList.contains('figure-segment')) {
                // data-frame-info があれば <frame-open> を <figure> の直前に出力
                const frameInfoJson = node.getAttribute('data-frame-info');
                if (frameInfoJson) {
                    try {
                        const fi = JSON.parse(frameInfoJson);
                        xml += `<frame-open abs="${fi.abs}" halign="${fi.halign}" valign="${fi.valign}" page="${fi.page}" wrap="${fi.wrap}" top="${fi.top}" left="${fi.left}" bottom="${fi.bottom}" right="${fi.right}" />\r\n`;
                    } catch (e) {
                        logger.warn('frame-open info parse error:', e);
                    }
                }
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
                    // 詳細モード用の装飾要素 (タブ書式ルーラー / 隠し span / そろえ旗マーク) はスキップ
                    // これらは段落出力レベルで data-tab-attrs / data-align から <tab-format> / <text align> を別途生成するため、
                    // 子要素の SVG やマーカー span を XML 化しない (fontState も変更しない)
                    if (node.classList && (
                        node.classList.contains('detail-tab-format') ||
                        node.classList.contains('hidden-tab-format') ||
                        node.classList.contains('detail-align')
                    )) {
                        // 何も出力しない・状態も変更しない
                    }
                    // タブマーカー（表示用）はタブ文字として出力
                    else if (node.classList && node.classList.contains('tab-marker')) {
                        xml += '\t';
                    }
                    // 字下げ anchor (indent-anchor) → <indent/> として復元 (段落内で最初の 1 個のみ)
                    // BTRON 仕様: 段落内に <indent/> は 1 個のみ。 万一 DOM に複数あれば最初だけ出力し残りは無視
                    else if (node.classList && node.classList.contains('indent-anchor')) {
                        const parentP = node.closest('p');
                        if (parentP && parentP.querySelector('.indent-anchor') === node) {
                            xml += '<indent/>';
                        }
                        // 2 個目以降は何も出力しない
                    }
                    // 結合文字 (combchar) はペアタグで出力
                    else if (node.classList && node.classList.contains('combchar')) {
                        xml += '<combchar>';
                        xml += this.extractTADXMLFromElement(node, fontState, effectiveColor);
                        xml += '</combchar>';
                    }
                    // 文字割付け (char-layout) はペアタグで出力
                    else if (node.classList && node.classList.contains('char-layout')) {
                        const kind = node.getAttribute('data-kind') || '0';
                        const widthStr = node.getAttribute('data-width') || '1/1';
                        xml += '<char-layout kind="' + kind + '" width="' + widthStr + '">';
                        xml += this.extractTADXMLFromElement(node, fontState, effectiveColor);
                        xml += '</char-layout>';
                    }
                    // 充塡文字 (fill-char) は自己閉じタグで出力
                    else if (node.classList && node.classList.contains('fill-char')) {
                        xml += this._serializeFillChar(node);
                    }
                    // 固定幅空白 (fixed-space) は自己閉じタグで出力
                    else if (node.classList && node.classList.contains('fixed-space')) {
                        const wStr = node.getAttribute('data-width') || '1/1';
                        xml += '<fixed-space width="' + wStr + '" />';
                    }
                    // 傍点 (bouten) はペアタグで出力
                    else if (node.classList && node.classList.contains('bouten')) {
                        const side = node.getAttribute('data-bouten-side') || 'upper';
                        const kind = node.getAttribute('data-bouten-kind') || '0';
                        xml += '<bouten side="' + side + '" kind="' + kind + '">';
                        xml += this.extractTADXMLFromElement(node, fontState, effectiveColor);
                        xml += '</bouten>';
                    }
                    // ページ番号 (page-number) は自己閉じタグで出力
                    else if (node.classList && node.classList.contains('page-number')) {
                        const step = node.getAttribute('data-step') || '1';
                        const num = node.getAttribute('data-num') || '1';
                        xml += '<page-number step="' + step + '" num="' + num + '" />';
                    }
                    // 文章メモ (docmemo) は自己閉じタグで出力
                    else if (node.classList && node.classList.contains('docmemo')) {
                        const memoText = (node.getAttribute('data-memo') || node.textContent || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                        xml += '<docmemo text="' + memoText + '" />';
                    }
                    // 用紙オーバーレイ (doc-overlay) は自己閉じタグで復元
                    else if (node.classList && node.classList.contains('doc-overlay')) {
                        const rawAttrs = node.getAttribute('data-overlay-attrs') || '';
                        const decoded = rawAttrs.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
                        xml += '<docoverlay ' + decoded + ' />';
                    }
                    // フィールド書式 (field-format) を復元
                    else if (node.classList && node.classList.contains('field-format')) {
                        const formatAttrs = (node.getAttribute('data-format-attrs') || '').replace(/&quot;/g, '"');
                        let ffXml = '<field-format ' + formatAttrs + '>';
                        const fieldEls = node.querySelectorAll('.field');
                        for (const fe of fieldEls) {
                            const fieldAttrs = (fe.getAttribute('data-field-attrs') || '').replace(/&quot;/g, '"');
                            ffXml += '<field ' + fieldAttrs + ' />';
                        }
                        ffXml += '</field-format>';
                        xml += ffXml;
                    }
                    // 仮身（virtual-object）を<link>タグに変換
                    else if (node.classList && node.classList.contains('virtual-object')) {
                        // 必須属性 (linkId) チェック: 欠落時は link タグ出力を中止し、 警告コメントを残す
                        // データ消失防止のためのセーフティネット (data-link-id を失った virtual-object は元に戻せない)
                        if (!node.dataset.linkId) {
                            const lostName = node.dataset.linkName || node.textContent || '不明';
                            logger.error('[EDITOR] ★警告: virtual-object に linkId がない、 仮身データ消失の可能性:', {
                                name: lostName,
                                textContent: node.textContent,
                                classList: Array.from(node.classList),
                                datasetKeys: Object.keys(node.dataset)
                            });
                            xml += `<!-- LOST LINK: ${this.escapeXml(lostName)} -->`;
                            return;
                        }

                        // すべてのdata-link-*属性を復元（innercontentと閉じた状態の座標属性を除く）
                        const isExpanded = node.classList.contains('expanded');
                        let attrs = '';
                        let innerContent = '';
                        let applistAttr = '';
                        let vobjidAttr = '';
                        let scrollxAttr = '';
                        let scrollyAttr = '';
                        let zoomratioAttr = '';
                        let viewmodeAttr = '';
                        let wordwrapAttr = '';

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
                                // vobjid属性はid属性の直後に出力するため別途保持
                                else if (attrName === 'vobjid') {
                                    vobjidAttr = ` vobjid="${this.escapeXml(attrValue)}"`;
                                }
                                // scrollx/scrolly/zoomratioは末尾に出力するため別途保持
                                else if (attrName === 'scrollx') {
                                    scrollxAttr = ` scrollx="${this.escapeXml(attrValue)}"`;
                                }
                                else if (attrName === 'scrolly') {
                                    scrollyAttr = ` scrolly="${this.escapeXml(attrValue)}"`;
                                }
                                else if (attrName === 'zoomratio') {
                                    zoomratioAttr = ` zoomratio="${this.escapeXml(attrValue)}"`;
                                }
                                else if (attrName === 'viewmode') {
                                    viewmodeAttr = ` viewMode="${this.escapeXml(attrValue)}"`;
                                }
                                else if (attrName === 'wordwrap') {
                                    wordwrapAttr = ` wordWrap="${this.escapeXml(attrValue)}"`;
                                }
                                else {
                                    attrs += ` ${attrName}="${this.escapeXml(attrValue)}"`;
                                }
                            } else if (key === 'applist') {
                                // applist属性を処理
                                applistAttr = ` applist="${this.escapeXml(node.dataset[key])}"`;
                            }
                        }

                        // id属性の直後にvobjidを挿入
                        // attrs内の id="..." の直後に vobjid を挿入
                        if (vobjidAttr) {
                            attrs = attrs.replace(/( id="[^"]*")/, `$1${vobjidAttr}`);
                        }

                        // 自己閉じタグ形式（link_nameはJSONから取得する方式に統一）
                        xml += `<link${attrs}${applistAttr}${scrollxAttr}${scrollyAttr}${zoomratioAttr}${viewmodeAttr}${wordwrapAttr}/>`;
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
                        // 子要素ノードを持つ span をフラット化すると子要素 (字下げ anchor・装飾 span 等) が
                        // textContent に均されて消失するため、 フラット化はテキストとタブだけの span に限定する。
                        // 子要素を持つ span は下の汎用処理 (ペアタグ + 子要素再帰) で処理する
                        const hasElementChild = node.children && node.children.length > 0;
                        if (textContent.includes('\t') && !hasElementChild) {
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

                                    // 子要素 (字下げ anchor 等) を持つ span は連結に取り込まない (スキップで消失するため)
                                    if (nextIs14pt && /^[\t]+$/.test(nextText) && nextSpan.children.length === 0) {
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
                                    const size = this.normalizeFontSizeToPt(endNode.nextSibling.style.fontSize);
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
                                        // セーフティ: virtual-object には _tabProcessed フラグを付けない (誤スキップ防止)
                                        if (skipNode.classList && skipNode.classList.contains('virtual-object')) {
                                            logger.warn('[EDITOR] TAB 処理: virtual-object を _tabProcessed 対象から除外:', skipNode.dataset.linkName);
                                        } else {
                                            skipNode._tabProcessed = true;
                                        }
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
                                    tabFollowSize = this.normalizeFontSizeToPt(node.nextSibling.style.fontSize);
                                } else if (style.fontSize) {
                                    // span自身のフォントサイズ
                                    tabFollowSize = this.normalizeFontSizeToPt(style.fontSize);
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
                                    const size = this.normalizeFontSizeToPt(style.fontSize);
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
                                    const size = this.normalizeFontSizeToPt(style.fontSize);
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
                                let hRatioTagOpened = false;
                                let wRatioTagOpened = false;
                                const hRatioValue = this.getTadStyleFromSpan(node, 'hRatio');
                                const wRatioValue = this.getTadStyleFromSpan(node, 'wRatio');
                                if (hRatioValue) {
                                    xml += `<font hRatio="${hRatioValue}">`;
                                    hRatioTagOpened = true;
                                    newState.hRatio = hRatioValue;
                                }
                                if (wRatioValue) {
                                    xml += `<font wRatio="${wRatioValue}">`;
                                    wRatioTagOpened = true;
                                    newState.wRatio = wRatioValue;
                                }
                                // BTRON FFA2 SubID 0x01 由来のフォント追加属性
                                const fontExtraAttrs = ['style', 'weight', 'stretch', 'stretchscale', 'direction', 'kerning', 'pattern'];
                                const fontExtraOpened = [];
                                for (const _eName of fontExtraAttrs) {
                                    const _eVal = this.getTadStyleFromSpan(node, _eName);
                                    if (_eVal !== null && _eVal !== undefined && _eVal !== '') {
                                        xml += '<font ' + _eName + '="' + _eVal + '">';
                                        fontExtraOpened.push(_eName);
                                    }
                                }

                                // 子要素を再帰的に処理（新しいフォント状態を渡す）
                                xml += this.extractTADXMLFromElement(node, newState, effectiveColor);

                                // ペアタグを閉じる（開いた順の逆順で閉じる）
                                for (let _ei = fontExtraOpened.length - 1; _ei >= 0; _ei--) {
                                    xml += '</font>';
                                }
                                if (wRatioTagOpened) {
                                    xml += '</font>';
                                }
                                if (hRatioTagOpened) {
                                    xml += '</font>';
                                }
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
     * style.fontSizeの値からpt単位の丸めた文字列を取得
     * px単位の場合はpt単位に変換してからroundFontSizeを適用
     * @param {string} fontSizeStr - style.fontSizeの値（例: "14pt", "18.67px"）
     * @returns {string|null} pt単位の丸めた文字列（例: "14"）、またはnull
     */
    normalizeFontSizeToPt(fontSizeStr) {
        if (!fontSizeStr) return null;
        let size = parseFloat(fontSizeStr);
        if (isNaN(size)) return null;
        // px単位の場合はpt単位に変換（1pt = 4/3px → 1px = 3/4pt）
        if (fontSizeStr.includes('px')) {
            size = window.convertPxToPt(size);
        }
        return window.roundFontSize(String(size));
    }

    /**
     * 段落からフォントサイズを抽出
     */
    extractFontSize(element) {
        const style = element.style.fontSize;
        if (style) {
            return this.normalizeFontSizeToPt(style);
        }
        return null;
    }

    /**
     * 段落内のコンテンツが既にfont sizeタグで完全にラップされているかチェック
     * updateParagraphLineHeight()が段落のstyle.fontSizeをmaxFontSizeに設定するため、
     * 段落内の子要素が既に個別のfont sizeタグを持っている場合に段落レベルでの
     * 二重ラップを防止するために使用する
     * @param {string} content - XML文字列
     * @returns {boolean} 全コンテンツがfont sizeタグで包まれている場合true
     */
    isContentFullyWrappedByFontSize(content) {
        // brタグや空白・改行を除去して実質的なコンテンツを取得
        const stripped = content.replace(/<br\s*\/?>/g, '').replace(/\r?\n/g, '').trim();
        if (!stripped) return false;

        // font SIZEタグの外にテキストやlinkがあるかチェック
        // ※font colorやfont faceタグはsizeラッピングとは無関係なのでカウントしない
        // スタックで開始タグの種類（'size' or 'other'）を追跡し、</font>を正しく対応付ける
        const fontStack = [];  // 'size' | 'other'
        let hasContentOutsideFontSize = false;
        let i = 0;
        while (i < stripped.length) {
            if (stripped[i] === '<') {
                const tagEnd = stripped.indexOf('>', i);
                if (tagEnd === -1) break;
                const tag = stripped.substring(i, tagEnd + 1);

                if (tag.match(/^<font\s+size="/)) {
                    fontStack.push('size');
                } else if (tag.match(/^<font\s+(color|face|space)="/)) {
                    fontStack.push('other');
                } else if (tag === '</font>') {
                    fontStack.pop();  // 最後に開かれたfontタグを閉じる
                }
                // 自己閉じタグ（link, brなど）はfontタグの外にあってもコンテンツとは見なさない
                i = tagEnd + 1;
            } else {
                // テキストノード - font sizeタグ内にあるかチェック
                const hasSizeInStack = fontStack.includes('size');
                if (!hasSizeInStack) {
                    // font sizeタグの外にテキストがある
                    hasContentOutsideFontSize = true;
                    break;
                }
                i++;
            }
        }

        return !hasContentOutsideFontSize;
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
     * data 属性に格納された XML attrs 文字列をデコード (parser での &quot; 等エスケープを元に戻す)
     */
    unescapeAttrs(escaped) {
        return String(escaped || '')
            .replace(/&quot;/g, '"')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&');
    }

    /**
     * 段落から line-height を抽出 (BTRON 2.1.0 行間隔指定付箋用)
     * 戻り値: 総合比率 (1.0 = 100%、 1.5 = 150% など) または null
     */
    extractLineHeight(element) {
        const lineHeightStyle = element.style.lineHeight;
        if (!lineHeightStyle) return null;
        // "1.5" / "1.5em" / "21px" などのパターンに対応
        const pxMatch = /([0-9.]+)px/i.exec(lineHeightStyle);
        if (pxMatch) {
            const px = parseFloat(pxMatch[1]);
            const fontSizeStr = this.extractFontSize(element);
            const fontSizePt = parseFloat(fontSizeStr || '14');
            // 14pt ≒ 18.67px (基準: 1pt = 4/3 px)
            const fontSizePx = fontSizePt * 4 / 3;
            if (fontSizePx > 0) {
                const ratio = Math.round((px / fontSizePx) * 1000) / 1000; // 小数 3 桁丸め
                // 読込時の基準フォントサイズと食い違うと倍率が膨らむ (特に仮身だけの段落)。
                // 行間倍率の実用上限は約3。 異常な値は出力しない (デフォルト行間に戻り増幅を断ち切る)
                if (ratio > 10) return null;
                return ratio;
            }
            return null;
        }
        const numericMatch = /^([0-9.]+)(em)?$/i.exec(lineHeightStyle.trim());
        if (numericMatch) {
            const ratio = parseFloat(numericMatch[1]);
            if (ratio > 10) return null;
            return ratio;
        }
        return null;
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

        // タブサイズ: 段落スタイル (paragraphStyle) に tab-size が含まれていればそれを尊重し、
        // 含まれない場合のみフォールバックでデフォルト値 '4' を設定する
        // (タブ書式付箋のタブ幅で正しく実測するため、 ハードコード上書きを廃止)
        if (!paragraphStyle || !/tab-size\s*:/i.test(paragraphStyle)) {
            measureElement.style.tabSize = '4';
            measureElement.style.MozTabSize = '4';
        }

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

        // 詳細モード装飾要素 (ruler / そろえ旗マーク / hidden 系) を DOM 削除
        // これらは absolute or display:none で本来 line-box から外れるが、
        // 一時測定要素に挿入された段階で CSS 適用が不安定になる場合があるため、 確実に削除して幅実測を純粋なテキスト/タブだけに限定する
        measureElement.querySelectorAll('.detail-tab-format, .detail-align, .hidden-tab-format, .hidden-paper-change, .hidden-column-change, .hidden-line-head-kinsoku, .hidden-line-tail-kinsoku, .indent-anchor').forEach(el => el.remove());

        // エディタ内に追加して測定（エディタのすべてのスタイルを継承）
        this.editor.appendChild(measureElement);
        const width = measureElement.getBoundingClientRect().width;
        this.editor.removeChild(measureElement);

        return width;
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
        // 新規タブ書式作成時は行間 (height) を常に '0' で開始する (継承された値ではなく BTRON 標準デフォルト)
        // 既存値 (existingTabFormat) は hunit 単位なので、 表示用に文字幅に変換する
        const tf = existingTabFormat ? {
            ...existingTabFormat,
            height: '0'
        } : {
            R: 0, P: 0, height: '0', pargap: '0.75',
            left: 0, right: 0, indent: 0, ntabs: 0, tabs: []
        };

        // 表示用に hunit → 文字幅変換 (ユーザー入力は文字幅単位、 内部は hunit)
        const leftDisplay = Math.round(this._hunitToCharWidth(tf.left || 0));
        const rightDisplay = Math.round(this._hunitToCharWidth(tf.right || 0));
        const indentDisplay = Math.round(this._hunitToCharWidth(tf.indent || 0));
        // タブ間隔: 既存値があればそれを使用、 なければデフォルト 4 (BTRON 標準の 4 文字幅)
        const tabInterval = (tf.tabs && tf.tabs.length > 0)
            ? Math.round(this._hunitToCharWidth(Math.abs(tf.tabs[0])))
            : 4;

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
                    <input type="number" class="form-input" id="tfLeft" value="${leftDisplay}" min="0" data-form-id="tfLeft">
                    <span class="form-hint">2行目以降</span>
                </div>
                <div class="form-row">
                    <label class="form-label">右マージン:</label>
                    <input type="number" class="form-input" id="tfRight" value="${rightDisplay}" min="0" data-form-id="tfRight">
                    <span class="form-hint">TAD単位</span>
                </div>
                <div class="form-row">
                    <label class="form-label">字下げ:</label>
                    <input type="number" class="form-input" id="tfIndent" value="${indentDisplay}" min="0" data-form-id="tfIndent">
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
                    <input type="number" class="form-input" id="tfTabInterval" value="${tabInterval}" min="0" data-form-id="tfTabInterval">
                    <span class="form-hint">0=指定なし (標準 4)</span>
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
            width: 300,
            // inputs オプションを明示して formData 構築を保証
            inputs: {
                tfLeft: 'tfLeft',
                tfRight: 'tfRight',
                tfIndent: 'tfIndent',
                tfHeight: 'tfHeight',
                tfPargap: 'tfPargap',
                tfTabInterval: 'tfTabInterval'
            }
        });

        if (!result || result.button !== 'ok') {
            return null;
        }

        const formData = result.formData || {};
        // マイナス値は 0 にクランプ (入力値は文字幅単位)
        const leftCw = Math.max(0, parseInt(formData.tfLeft) || 0);
        const rightCw = Math.max(0, parseInt(formData.tfRight) || 0);
        const indentCw = Math.max(0, parseInt(formData.tfIndent) || 0);
        const height = formData.tfHeight || '0';
        const pargap = formData.tfPargap || '0.75';

        // タブ間隔: 厳密にパースし、 不正値の場合は元の表示値 (= 4 デフォルト) を採用 (文字幅単位)
        const rawTabInterval = formData.tfTabInterval;
        const parsedTabInterval = parseInt(rawTabInterval, 10);
        let tabIntervalCw;
        if (Number.isFinite(parsedTabInterval) && parsedTabInterval >= 0) {
            tabIntervalCw = parsedTabInterval;
        } else {
            tabIntervalCw = tabInterval;
        }
        logger.debug('[TabFormat] dialog result: tfTabInterval=', rawTabInterval, '→ tabIntervalCw=', tabIntervalCw);

        // 文字幅 → hunit 変換 (戻り値は hunit 単位 = BTRON xtad 内部表現)
        const left = this._charWidthToHunit(leftCw);
        const right = this._charWidthToHunit(rightCw);
        const indent = this._charWidthToHunit(indentCw);
        const tabs = tabIntervalCw > 0 ? [this._charWidthToHunit(tabIntervalCw)] : [];
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
     * 段落要素のタブ書式 data-tab-format JSON と CSS スタイルを更新 (内部共通処理)
     * v2: ruler/hidden span 挿入は applyTabFormatToParagraph / applyTabFormatToParagraphCascade で行うため、 ここでは扱わない
     * @param {HTMLElement} paragraph - 対象の<p>要素
     * @param {Object} tabFormatState - タブ書式オブジェクト
     */
    _updateParagraphTabFormatState(paragraph, tabFormatState) {
        // data-tab-format属性を設定 (CSS 計算と整合させるため。 シリアライザは見ない: v2 仕様)
        paragraph.setAttribute('data-tab-format', JSON.stringify(tabFormatState));

        // tabFormatState の各値は hunit 単位 (BTRON 仕様)
        // CSS px 計算は hunit × hunitToPx (parser の Line 1184 と整合)
        // 段落間隔 (pargap) 計算には別途 paragraph の maxFontSize が必要なので別変数で保持
        const maxFontSize = this.calculateMaxFontSizeInContent(paragraph, 14);
        const tadUnitToPx = Math.abs(window.DPI / ((this.docScale && this.docScale.hunit) || -120));

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
        // <indent/> anchor がある段落は text-indent を上書きしない
        // (パーサが anchor 由来の text-indent: -padding-left を設定済み、 上書きで字下げが消えるのを防止)
        if (!paragraph.querySelector('.indent-anchor')) {
            if (tabFormatState.indent !== 0) {
                paragraph.style.textIndent = `${tabFormatState.indent * tadUnitToPx}px`;
            } else {
                paragraph.style.textIndent = '';
            }
        }
        // pargap（段落間隔）
        const pargapValue = parseFloat(tabFormatState.pargap);
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
     * tabFormatState から <tab-format> 属性文字列 (rawAttrs 形式) を生成する内部ヘルパー
     * ruler/hidden span の dataset.tabAttrs 用
     */
    _serializeTabFormatAttrs(tabFormatState) {
        const R = tabFormatState.R || 0;
        const P = tabFormatState.P || 0;
        const height = tabFormatState.height !== undefined ? tabFormatState.height : '0';
        const pargap = tabFormatState.pargap !== undefined ? tabFormatState.pargap : '0.75';
        const left = tabFormatState.left || 0;
        const right = tabFormatState.right || 0;
        const indent = tabFormatState.indent || 0;
        const ntabs = tabFormatState.ntabs || 0;
        const tabsArr = Array.isArray(tabFormatState.tabs) ? tabFormatState.tabs : [];
        const tabsDA = Array.isArray(tabFormatState.tabsDecimalAlign) ? tabFormatState.tabsDecimalAlign : [];
        // tabs 配列を XML 属性文字列に変換 (decimalAlign は負値で表現)
        const tabsStr = tabsArr.map((v, i) => (tabsDA[i] ? -Math.abs(v) : Math.abs(v))).join(',');
        return `R="${R}" P="${P}" height="${height}" pargap="${pargap}" left="${left}" right="${right}" indent="${indent}" ntabs="${ntabs}" tabs="${tabsStr}"`;
    }

    /**
     * 段落の既存 ruler / hidden-tab-format span を全て削除する内部ヘルパー
     */
    _removeExistingRulerOrHidden(paragraph) {
        const existing = paragraph.querySelectorAll('.detail-tab-format, .hidden-tab-format');
        existing.forEach(el => el.remove());
    }

    /**
     * 段落要素にタブ書式のCSSスタイルと ruler/hidden span を適用 (v2 SSOT 経路)
     * - 詳細モード (this.viewMode === 'detailed') なら detail-tab-format ruler を段落先頭に挿入
     * - それ以外のモードなら hidden-tab-format span を段落先頭に挿入
     * シリアライザはこの ruler/hidden span から <tab-format> を出力するため、 これで「タブ書式付箋実在」 を表現する
     * @param {HTMLElement} paragraph - 対象の<p>要素
     * @param {Object} tabFormatState - タブ書式オブジェクト
     */
    applyTabFormatToParagraph(paragraph, tabFormatState) {
        // CSS と data-tab-format JSON を更新 (共通処理)
        this._updateParagraphTabFormatState(paragraph, tabFormatState);

        // 既存の ruler / hidden span を削除 (重複防止)
        this._removeExistingRulerOrHidden(paragraph);

        const rawAttrs = this._serializeTabFormatAttrs(tabFormatState);
        const safeAttrs = rawAttrs.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        if (this.viewMode === 'detailed') {
            // 詳細モード: ruler を innerHTML 先頭に挿入 (parser と同じ _buildDetailTabFormatRuler を使う)
            // 単位は文書共通の固定値 (= 14pt × 1.333) で parser と統一
            const tadUnitToPx = window.CHAR_UNIT_PX;
            const rulerHtml = this._buildDetailTabFormatRuler(tabFormatState, tadUnitToPx, rawAttrs);
            paragraph.insertAdjacentHTML('afterbegin', rulerHtml);
        } else {
            // 清書/原稿モード: hidden-tab-format span を挿入 (シリアライザでは出力されるが画面では非表示)
            const hiddenHtml = `<span class="hidden-tab-format" data-tab-attrs="${safeAttrs}" style="display:none"></span>`;
            paragraph.insertAdjacentHTML('afterbegin', hiddenHtml);
        }
    }

    /**
     * 段落要素にタブ書式の CSS と data-tab-format JSON のみ適用する (v2: カスケード継承用)
     * ruler/hidden span は **挿入しない** ため、 シリアライザは <tab-format> を出力しない
     * BTRON 後勝ち継承の表現: 段落 X に書式付箋を置くと、 X 以降の継承段落は CSS だけ書式が反映され、
     * XML 上は X の <tab-format> 1 個だけが効果範囲を表現する
     * @param {HTMLElement} paragraph - 対象の<p>要素
     * @param {Object} tabFormatState - タブ書式オブジェクト
     */
    applyTabFormatToParagraphCascade(paragraph, tabFormatState) {
        // CSS と data-tab-format JSON のみ更新 (ruler/hidden span は挿入しない)
        this._updateParagraphTabFormatState(paragraph, tabFormatState);
        // 既存の ruler/hidden span があれば削除 (カスケード対象段落で書式が変わるため、 古い境界マーカーを除去)
        // ※ ただし この段落自身がカスケード打ち切り境界 (別書式の ruler 持ち) の場合は呼ばれない設計
        //   (applyNewTabFormat 側でカスケード打ち切り判定し、 この段落への適用自体をスキップする)
        // 余分な ruler は v2 仕様で出力源になってしまうため、 ここでは削除しない (呼出側責任)
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

            // v2: 範囲選択 → 開始段落のみ ruler 挿入版を適用、 2 段落目以降〜終了段落までは Cascade 版 (ruler 非挿入)
            // BTRON 後勝ち継承で「開始段落の書式付箋が効果範囲をカバー」 という表現になる
            let p = paragraph;
            let firstApplied = false;
            while (p) {
                if (p.nodeName === 'P') {
                    if (!firstApplied) {
                        this.applyTabFormatToParagraph(p, newTabFormat);
                        firstApplied = true;
                    } else {
                        this.applyTabFormatToParagraphCascade(p, newTabFormat);
                    }
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

            // 元の段落から全 CSS / data-tab-format を継承 (タブ書式以外の text-align・禁則・字下げ等を維持)
            if (this.inheritParagraphStyle) {
                this.inheritParagraphStyle(paragraph, newP);
            }

            // line-height設定 (新規段落のフォントサイズで再計算 — 継承値を上書き)
            const newPFontSize = this.calculateMaxFontSizeInContent(newP, 14);
            const lineHeight = this.calculateLineHeight(newPFontSize);
            newP.style.lineHeight = `${lineHeight}px`;

            // 新しい段落にタブ書式を適用 (タブ書式関連の CSS は新書式値で上書きされる)
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

        // 後続段落へのカスケード適用 (v2: applyTabFormatToParagraphCascade で ruler は挿入しない = BTRON 後勝ち継承の境界表現)
        // 「旧タブ書式 (oldTabFormat) を継承していた段落」 が「ruler/hidden span を持たない」 = 継承段落 という前提で進める
        // カスケード打ち切り条件 1: 段落自身が ruler/hidden span を持つ (= 別書式付箋実在段落、 BTRON 境界)
        // カスケード打ち切り条件 2: data-tab-format JSON が旧書式と異なる (= 別効果範囲に切り替わった既存段落)
        if (oldTabFormatJson) {
            let sibling = paragraph.nextElementSibling;
            while (sibling) {
                if (sibling.nodeName !== 'P') {
                    sibling = sibling.nextElementSibling;
                    continue;
                }
                // 打ち切り条件 1: ruler/hidden span 保有 = 別書式付箋実在段落
                if (sibling.querySelector && sibling.querySelector('.detail-tab-format, .hidden-tab-format')) break;
                const siblingTabFormat = this.extractTabFormat(sibling);
                const siblingJson = siblingTabFormat ? JSON.stringify(siblingTabFormat) : null;
                // 打ち切り条件 2: 旧書式と一致しない data-tab-format JSON
                if (siblingJson !== oldTabFormatJson) break;
                // 継承段落: ruler は挿入せず CSS + JSON のみ更新
                this.applyTabFormatToParagraphCascade(sibling, newTabFormat);
                sibling = sibling.nextElementSibling;
            }
        }

        this.isModified = true;
        this.setStatus('タブ書式を設定しました');

        // v2: 完全往復 (convertEditorToXML → renderTADXML) は撤廃。
        // applyTabFormatToParagraph 内で ruler/hidden span を段落に直接挿入するため、 再描画は不要。
        // 詳細モード中の caret 位置・DOM 安定性が保たれる。
        // ※ ドラッグハンドラの再アタッチが必要なので、 新規挿入された ruler に対してのみ実施。
        if (this.viewMode === 'detailed') {
            this.attachDetailFusenClickHandlers();
            this.attachDetailTabFormatDragHandlers();
        }
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
        // 保存時にスクロール位置、折り返し設定、表示モードも保存
        // viewMode: 3 モード (formatted / detailed / xml)
        this.saveScrollPosition();
        this.updateWindowConfig({ wordWrap: this.wrapMode, viewMode: this.viewMode });

        if (window.parent && window.parent !== window) {
            // セーフティネット (保存前): DOM 内の仮身数を計測
            const domLinkCount = this.editor.querySelectorAll('.virtual-object').length;
            const domLinksWithoutId = this.editor.querySelectorAll('.virtual-object:not([data-link-id])').length;

            // エディタの内容をTAD XML形式に変換
            const xmlContent = await this.convertEditorToXML();

            // セーフティネット (保存後): XML 内の link 数を計測し、 DOM と比較
            const xmlLinkCount = (xmlContent.match(/<link\s/g) || []).length;
            const xmlLostCount = (xmlContent.match(/<!-- LOST LINK:/g) || []).length;
            const expectedLinkCount = domLinkCount - domLinksWithoutId;

            if (xmlLinkCount < expectedLinkCount) {
                // 期待値より link が減っている = データ破壊の可能性、 保存中止
                logger.error(`[EDITOR] ★★警告: link 数不一致、 仮身データ破壊の可能性、 保存を中止: DOM=${domLinkCount} (linkId欠落=${domLinksWithoutId}), XML link=${xmlLinkCount}, LOST=${xmlLostCount}`);
                this.setStatus(`⚠ 仮身データ破壊を検知しました (DOM=${domLinkCount}, XML link=${xmlLinkCount})、 保存を中止しました`);
                return;
            }

            if (domLinksWithoutId > 0 || xmlLostCount > 0) {
                logger.warn(`[EDITOR] ★警告: linkId 欠落の virtual-object が ${domLinksWithoutId} 個、 LOST LINK コメント ${xmlLostCount} 個`);
            }

            // tadDataを更新
            this.tadData = xmlContent;

            this.messageBus.send('xml-data-changed', {
                fileId: this.realId,
                xmlData: xmlContent
            });
            logger.debug(`[EDITOR] xmlTAD変更を通知, realId: ${this.realId}, DOM仮身=${domLinkCount}, XML link=${xmlLinkCount}`);
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

    _serializeFillChar(node) {
        const fillStr = node.getAttribute('data-fill-str') || '';
        const escaped = fillStr.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        return `<fill-char str="${escaped}" />`;
    }

    /**
     * ステータスを設定
     * tadjs-desktop.htmlのステータスバーにメッセージを送信
     */
};
