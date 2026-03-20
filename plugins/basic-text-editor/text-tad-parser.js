/**
 * 基本文章編集プラグイン - TADパース・レンダリング系Mixin
parseTADToXML, renderTADXML等
 * @module TextTadParserMixin
 */
const logger = window.getLogger('BasicTextEditor');

export const TextTadParserMixin = (Base) => class extends Base {
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

            // vobjid属性がない場合は自動生成（BTRON仕様: 仮身の一意識別子）
            if (!attrMap.vobjid) {
                attrMap.vobjid = UuidV7Generator.generate();
            }
            // scrollx/scrolly/zoomratio属性のデフォルト値（BTRON仕様: 仮身毎のスクロール位置・表示倍率）
            if (!attrMap.scrollx) attrMap.scrollx = '0';
            if (!attrMap.scrolly) attrMap.scrolly = '0';
            if (!attrMap.zoomratio) attrMap.zoomratio = '1';

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
                    heightPx: attrMap.height ? parseInt(attrMap.height) : DEFAULT_VOBJ_HEIGHT,
                    frcol: attrMap.frcol || DEFAULT_FRCOL,
                    chcol: attrMap.chcol || DEFAULT_CHCOL,
                    tbcol: attrMap.tbcol || DEFAULT_TBCOL,
                    bgcol: attrMap.bgcol || DEFAULT_BGCOL,
                    chsz: attrMap.chsz ? parseFloat(attrMap.chsz) : DEFAULT_FONT_SIZE,
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
                const frcol = attrMap.frcol || DEFAULT_FRCOL;
                const chcol = attrMap.chcol || DEFAULT_CHCOL;
                const tbcol = attrMap.tbcol || DEFAULT_TBCOL;
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

        // <image>タグを<img>タグに変換（旧TAD形式: src/width/height/planes/pixbits属性）
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

        // <image>タグを<img>タグに変換（XTAD標準形式: href/left/top/right/bottom属性）
        // 書庫解凍時に生成される形式に対応
        // 属性の順序に依存しない柔軟なパターン
        html = html.replace(/<image\s+([^>]*href="[^"]*"[^>]*)\/>/gi,
            (match, attrs) => {
                // 各属性を抽出（属性の順序に依存しない）
                const leftMatch = attrs.match(/left="([^"]*)"/);
                const topMatch = attrs.match(/top="([^"]*)"/);
                const rightMatch = attrs.match(/right="([^"]*)"/);
                const bottomMatch = attrs.match(/bottom="([^"]*)"/);
                const hrefMatch = attrs.match(/href="([^"]*)"/);

                // 旧形式（src/width/height）の場合はスキップ
                if (!hrefMatch || attrs.includes('src=')) {
                    return match;
                }

                const left = leftMatch ? parseInt(leftMatch[1], 10) : 0;
                const top = topMatch ? parseInt(topMatch[1], 10) : 0;
                const right = rightMatch ? parseInt(rightMatch[1], 10) : 0;
                const bottom = bottomMatch ? parseInt(bottomMatch[1], 10) : 0;
                const href = hrefMatch[1];

                // left/top/right/bottomからwidth/heightを計算
                const width = right - left;
                const height = bottom - top;

                // 画像は loadImagesFromParent() で正しいパスを設定するため、
                // 初期srcは常に空にする（ブラウザの即時読み込みを防止）
                let imagePath = '';

                // data: URL の場合のみ直接設定
                if (href.startsWith('data:')) {
                    imagePath = href;
                }

                // data-img-noを抽出（ファイル名から）
                const imgNoMatch = href.match(/_(\d+)\./);
                const imgNo = imgNoMatch ? imgNoMatch[1] : '0';

                // XTAD形式にはplanes/pixbitsがないため、デフォルト値を使用
                return `<img src="${imagePath}" data-saved-filename="${href}" data-planes="1" data-pixbits="24" data-img-no="${imgNo}" data-needs-load="true" style="width: ${width}px; height: ${height}px; display: inline-block; vertical-align: middle; margin: 4px;">`;
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
        const fontRegex = /<font\s+(size|color|face|space)="([^"]*)"\s*\/?>|<\/font>/gi;
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
            // XMLをパースしてrealtime要素を検出
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(tadXML, 'text/xml');

            // パースエラーチェック
            const parseError = xmlDoc.querySelector('parsererror');
            if (parseError) {
                this.editor.innerHTML = '<p>XMLパースエラー</p>';
                return;
            }

            // <realtime>要素を検出した場合は専用処理
            const realtimeEl = xmlDoc.querySelector('realtime');
            if (realtimeEl) {
                await this.renderRealtimeContent(realtimeEl, xmlDoc);
                return;
            }

            // インライン<figure>ブロックを事前抽出（ネストされた<document>問題の回避）
            // <figure>内のテキストボックスが<document>を含むため、
            // 先に<figure>を除去しないと外側の<document>正規表現が誤マッチする
            const figureBlocks = [];
            tadXML = tadXML.replace(/<figure[^>]*>[\s\S]*?<\/figure>/gi, (match) => {
                const index = figureBlocks.length;
                figureBlocks.push(match);
                return `__FIGURE_PLACEHOLDER_${index}__`;
            });

            // <document>...</document>を抽出（<figure>除去済みなので安全）
            const docMatch = /<document[^>]*>([\s\S]*?)<\/document>/i.exec(tadXML);
            if (!docMatch) {
                // <figure>ブロックがある場合はiframe埋め込みで表示
                if (figureBlocks.length > 0) {
                    logger.info('[EDITOR] <document>なし、<figure>をiframe埋め込みで表示');
                    let figureHtml = '';
                    figureBlocks.forEach((figureXml, index) => {
                        const tmpParser = new DOMParser();
                        const tmpDoc = tmpParser.parseFromString(`<tad>${figureXml}</tad>`, 'text/xml');
                        const figView = tmpDoc.querySelector('figView');
                        const fWidth = figView ? (parseInt(figView.getAttribute('right')) - parseInt(figView.getAttribute('left'))) : 800;
                        const fHeight = figView ? (parseInt(figView.getAttribute('bottom')) - parseInt(figView.getAttribute('top'))) : 600;
                        // figView座標が小さい場合、CSS transformで表示をスケールアップ
                        const minDisplayWidth = 600;
                        const scale = (fWidth < minDisplayWidth) ? (minDisplayWidth / fWidth) : 1;
                        const displayWidth = Math.round(fWidth * scale);
                        const displayHeight = Math.round(fHeight * scale);
                        const encoded = btoa(unescape(encodeURIComponent(figureXml)));
                        const sourceRealId = this.realId || '';
                        figureHtml +=
                            `<div class="figure-segment" contenteditable="false" data-figure-xmltad="${encoded}" ` +
                            `data-source-real-id="${sourceRealId}" ` +
                            `style="display: block; margin: 0; width: ${displayWidth}px; height: ${displayHeight}px; overflow: hidden;">` +
                            `<iframe src="../../plugins/basic-figure-editor/index.html?embedded=true" ` +
                            `style="width: ${fWidth}px; height: ${fHeight}px; border: none; ` +
                            `transform: scale(${scale}); transform-origin: top left;"></iframe></div>`;
                    });
                    // 図形セグメントの後に編集可能な文章セグメントを追加
                    figureHtml += '<document><p></p></document>';
                    this.editor.innerHTML = figureHtml;
                    this.initFigureSegmentIframes();
                    this.viewMode = 'formatted';
                    return;
                }
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

            // タブ書式状態を段落ループの外で初期化（段落間継承用）
            const tabFormatState = {
                R: 0, P: 0, height: '0', pargap: '0.75',
                left: 0, right: 0, indent: 0, ntabs: 0, tabs: []
            };

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

                // <tab-format/>タグを抽出（タブ書式指定付箋）
                const tabFormatMatch = /<tab-format\s+([^>]*)\/>/i.exec(paragraphContent);
                if (tabFormatMatch) {
                    const attrs = tabFormatMatch[1];
                    const rMatch = /R="([^"]*)"/.exec(attrs);
                    const pMatch = /P="([^"]*)"/.exec(attrs);
                    const heightMatch = /height="([^"]*)"/.exec(attrs);
                    const pargapMatch = /pargap="([^"]*)"/.exec(attrs);
                    const leftMatch = /left="([^"]*)"/.exec(attrs);
                    const rightMatch = /right="([^"]*)"/.exec(attrs);
                    const tfIndentMatch = /indent="([^"]*)"/.exec(attrs);
                    const ntabsMatch = /ntabs="([^"]*)"/.exec(attrs);
                    const tabsMatch = /tabs="([^"]*)"/.exec(attrs);

                    tabFormatState.R = rMatch ? parseInt(rMatch[1]) : 0;
                    tabFormatState.P = pMatch ? parseInt(pMatch[1]) : 0;
                    tabFormatState.height = heightMatch ? heightMatch[1] : '0';
                    tabFormatState.pargap = pargapMatch ? pargapMatch[1] : '0.75';
                    tabFormatState.left = leftMatch ? parseInt(leftMatch[1]) : 0;
                    tabFormatState.right = rightMatch ? parseInt(rightMatch[1]) : 0;
                    tabFormatState.indent = tfIndentMatch ? parseInt(tfIndentMatch[1]) : 0;
                    const ntabsValue = ntabsMatch ? parseInt(ntabsMatch[1]) : 0;
                    tabFormatState.ntabs = ntabsValue;
                    if (ntabsValue > 0 && tabsMatch && tabsMatch[1]) {
                        tabFormatState.tabs = tabsMatch[1].split(',').map(Number);
                    } else if (ntabsValue === 0) {
                        tabFormatState.tabs = [];
                    }
                    // ntabs < 0: 直前のタブストップを継承（tabFormatState.tabsを変更しない）

                    paragraphContent = paragraphContent.replace(/<tab-format\s+[^>]*\/>/gi, '');
                }

                // タブ書式のCSS適用
                const tadUnitToPx = Math.abs(96 / this.docScale.hunit);
                if (tabFormatState.left !== 0) {
                    style += `margin-left: ${tabFormatState.left * tadUnitToPx}px;`;
                }
                if (tabFormatState.right !== 0) {
                    style += `margin-right: ${tabFormatState.right * tadUnitToPx}px;`;
                }
                if (tabFormatState.indent !== 0) {
                    style += `text-indent: ${tabFormatState.indent * tadUnitToPx}px;`;
                }
                // pargap（段落間隔）: デフォルト値(0.75)以外の場合にCSS上書き
                const pargapValue = parseFloat(tabFormatState.pargap);
                if (!isNaN(pargapValue) && tabFormatState.pargap !== '0.75') {
                    const pargapPx = pargapValue * maxFontSize;
                    style = style.replace('margin: 0.5em 0;', `margin: ${pargapPx}px 0;`);
                }
                // カスタムタブストップ
                if (tabFormatState.tabs.length > 0) {
                    const tabInterval = tabFormatState.tabs[0] * tadUnitToPx;
                    if (tabInterval > 0) {
                        style += `tab-size: ${tabInterval}px; -moz-tab-size: ${tabInterval}px;`;
                    }
                }

                // テキスト配置
                const textAlignMatch = /<text\s+align="([^"]*)"\s*\/>/i.exec(paragraphContent);
                if (textAlignMatch) {
                    style += `text-align: ${textAlignMatch[1]};`;
                    paragraphContent = paragraphContent.replace(/<text\s+align="[^"]*"\s*\/>/gi, '');
                }

                // <text line-height="..."/>タグを処理（行間隔の総合比率を更新）
                const textLineHeightMatch = /<text\s+line-height="([^"]*)"[^>]*\/>/i.exec(paragraphContent);
                if (textLineHeightMatch) {
                    const totalRatio = parseFloat(textLineHeightMatch[1]);
                    if (!isNaN(totalRatio) && totalRatio > 0) {
                        tabFormatState.height = String(totalRatio - 1); // 総合比率→ギャップ率
                    }
                    paragraphContent = paragraphContent.replace(/<text\s+line-height="[^"]*"[^>]*\/>/gi, '');
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

                // インライン<font>タグをHTMLに変換（textStyleStateを渡して段落間で状態を引き継ぎ）
                paragraphContent = await this.convertDecorationTagsToHTML(paragraphContent, textStyleState);

                // line-heightを最大フォントサイズに基づいて設定
                // heightはギャップ率（例: 0.75）、総合比率は 1 + height（例: 1.75）
                // maxFontSizeはpt単位のためpx変換（×4/3）が必要
                const heightValue = parseFloat(tabFormatState.height);
                const lineHeight = (heightValue > 0) ? (1 + heightValue) * window.convertPtToPx(maxFontSize) : window.convertPtToPx(maxFontSize) * 1.5;
                style += `line-height: ${lineHeight}px;`;

                // 空の段落（XMLソースの整形による改行のみの段落）はスキップ
                if (paragraphContent.trim()) {
                    const tabFormatJson = JSON.stringify(tabFormatState);
                    htmlContent += `<p style="${style}" data-tab-format='${tabFormatJson}'>${paragraphContent}</p>`;
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

                // <tab-format/>タグを抽出（タブ書式指定付箋）
                const tabFormatMatchR = /<tab-format\s+([^>]*)\/>/i.exec(paragraphContent);
                if (tabFormatMatchR) {
                    const attrs = tabFormatMatchR[1];
                    const rMatch = /R="([^"]*)"/.exec(attrs);
                    const pMatch = /P="([^"]*)"/.exec(attrs);
                    const heightMatch = /height="([^"]*)"/.exec(attrs);
                    const pargapMatch = /pargap="([^"]*)"/.exec(attrs);
                    const leftMatch = /left="([^"]*)"/.exec(attrs);
                    const rightMatch = /right="([^"]*)"/.exec(attrs);
                    const tfIndentMatch = /indent="([^"]*)"/.exec(attrs);
                    const ntabsMatch = /ntabs="([^"]*)"/.exec(attrs);
                    const tabsMatch = /tabs="([^"]*)"/.exec(attrs);

                    tabFormatState.R = rMatch ? parseInt(rMatch[1]) : 0;
                    tabFormatState.P = pMatch ? parseInt(pMatch[1]) : 0;
                    tabFormatState.height = heightMatch ? heightMatch[1] : '0';
                    tabFormatState.pargap = pargapMatch ? pargapMatch[1] : '0.75';
                    tabFormatState.left = leftMatch ? parseInt(leftMatch[1]) : 0;
                    tabFormatState.right = rightMatch ? parseInt(rightMatch[1]) : 0;
                    tabFormatState.indent = tfIndentMatch ? parseInt(tfIndentMatch[1]) : 0;
                    const ntabsValueR = ntabsMatch ? parseInt(ntabsMatch[1]) : 0;
                    tabFormatState.ntabs = ntabsValueR;
                    if (ntabsValueR > 0 && tabsMatch && tabsMatch[1]) {
                        tabFormatState.tabs = tabsMatch[1].split(',').map(Number);
                    } else if (ntabsValueR === 0) {
                        tabFormatState.tabs = [];
                    }

                    paragraphContent = paragraphContent.replace(/<tab-format\s+[^>]*\/>/gi, '');
                }

                // タブ書式のCSS適用
                const tadUnitToPxR = Math.abs(96 / this.docScale.hunit);
                if (tabFormatState.left !== 0) {
                    style += `margin-left: ${tabFormatState.left * tadUnitToPxR}px;`;
                }
                if (tabFormatState.right !== 0) {
                    style += `margin-right: ${tabFormatState.right * tadUnitToPxR}px;`;
                }
                if (tabFormatState.indent !== 0) {
                    style += `text-indent: ${tabFormatState.indent * tadUnitToPxR}px;`;
                }
                const pargapValueR = parseFloat(tabFormatState.pargap);
                if (!isNaN(pargapValueR) && tabFormatState.pargap !== '0.75') {
                    const pargapPxR = pargapValueR * maxFontSize;
                    style = style.replace('margin: 0.5em 0;', `margin: ${pargapPxR}px 0;`);
                }
                if (tabFormatState.tabs.length > 0) {
                    const tabIntervalR = tabFormatState.tabs[0] * tadUnitToPxR;
                    if (tabIntervalR > 0) {
                        style += `tab-size: ${tabIntervalR}px; -moz-tab-size: ${tabIntervalR}px;`;
                    }
                }

                // テキスト配置
                const textAlignMatch = /<text\s+align="([^"]*)"\s*\/>/i.exec(paragraphContent);
                if (textAlignMatch) {
                    style += `text-align: ${textAlignMatch[1]};`;
                    paragraphContent = paragraphContent.replace(/<text\s+align="[^"]*"\s*\/>/gi, '');
                }

                // <text line-height="..."/>タグを処理（行間隔の総合比率を更新）
                const textLineHeightMatchR = /<text\s+line-height="([^"]*)"[^>]*\/>/i.exec(paragraphContent);
                if (textLineHeightMatchR) {
                    const totalRatioR = parseFloat(textLineHeightMatchR[1]);
                    if (!isNaN(totalRatioR) && totalRatioR > 0) {
                        tabFormatState.height = String(totalRatioR - 1); // 総合比率→ギャップ率
                    }
                    paragraphContent = paragraphContent.replace(/<text\s+line-height="[^"]*"[^>]*\/>/gi, '');
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
                // heightはギャップ率（例: 0.75）、総合比率は 1 + height（例: 1.75）
                const heightValueR = parseFloat(tabFormatState.height);
                const lineHeight = (heightValueR > 0) ? (1 + heightValueR) * window.convertPtToPx(maxFontSize) : window.convertPtToPx(maxFontSize) * 1.5;
                style += `line-height: ${lineHeight}px;`;

                // 空の段落（XMLソースの整形による改行のみの段落）はスキップ
                if (paragraphContent.trim()) {
                    const tabFormatJsonR = JSON.stringify(tabFormatState);
                    htmlContent += `<p style="${style}" data-tab-format='${tabFormatJsonR}'>${paragraphContent}</p>`;
                }
            }

            // プレースホルダをdiv.figure-segment + iframeに置換
            figureBlocks.forEach((figureXml, index) => {
                const tmpParser = new DOMParser();
                const tmpDoc = tmpParser.parseFromString(`<tad>${figureXml}</tad>`, 'text/xml');

                // <figure>が実際の図形描画要素を含むか検証
                // <document>のみの<figure>（テキストボックスのみ）はテキストとして展開
                const figure = tmpDoc.querySelector('figure');
                const hasDrawingElements = figure && figure.querySelector('rect, ellipse, polyline, group, image');
                if (!hasDrawingElements) {
                    const docEls = figure ? figure.querySelectorAll('document') : [];
                    let textHtml = '';
                    docEls.forEach((docEl, docIndex) => {
                        // 2つ目以降の<document>の前に改行を挿入
                        if (docIndex > 0 && textHtml.length > 0) {
                            textHtml += '<br/>';
                        }
                        for (const child of docEl.childNodes) {
                            if (child.nodeType === Node.TEXT_NODE) {
                                const text = child.textContent.trim();
                                if (text) textHtml += text;
                            } else if (child.nodeType === Node.ELEMENT_NODE && child.tagName.toLowerCase() === 'br') {
                                textHtml += '<br/>';
                            }
                        }
                    });
                    htmlContent = htmlContent.replace(`__FIGURE_PLACEHOLDER_${index}__`, textHtml);
                    return;
                }

                const figView = tmpDoc.querySelector('figView');
                const fWidth = figView ? (parseInt(figView.getAttribute('right')) - parseInt(figView.getAttribute('left'))) : 200;
                const fHeight = figView ? (parseInt(figView.getAttribute('bottom')) - parseInt(figView.getAttribute('top'))) : 200;
                const encoded = btoa(unescape(encodeURIComponent(figureXml)));
                htmlContent = htmlContent.replace(`__FIGURE_PLACEHOLDER_${index}__`,
                    `<div class="figure-segment" contenteditable="false" data-figure-xmltad="${encoded}" style="display: inline-block; vertical-align: middle; margin: 4px; width: ${fWidth}px; height: ${fHeight}px;">` +
                    `<iframe src="../../plugins/basic-figure-editor/index.html?embedded=true" style="width: ${fWidth}px; height: ${fHeight}px; border: none; pointer-events: none;"></iframe></div>`
                );
            });

            if (htmlContent) {
                this.editor.innerHTML = htmlContent;

                // 仮身要素にイベントハンドラを追加
                this.setupVirtualObjectEventHandlers();

                // 画像を読み込んで表示
                this.loadImagesFromParent();

                // 図形セグメントのiframeを初期化
                this.initFigureSegmentIframes();

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
     * <realtime>コンテンツをレンダリング
     * <realtime>内の<figure>要素をPluginBase.renderFigureElements()で描画
     * @param {Element} realtimeEl - realtime要素
     * @param {Document} xmlDoc - XMLドキュメント
     */
    async renderRealtimeContent(realtimeEl, xmlDoc) {
        // エディタをクリア
        this.editor.innerHTML = '';

        // <figure>要素を処理
        const figureEl = realtimeEl.querySelector('figure');
        if (figureEl) {
            // figViewからサイズを取得
            const figView = figureEl.querySelector('figView');
            let figWidth = 800, figHeight = 600;
            if (figView) {
                figWidth = parseFloat(figView.getAttribute('right')) || 800;
                figHeight = parseFloat(figView.getAttribute('bottom')) || 600;
            }

            // エディタのサイズを設定
            this.editor.style.width = `${figWidth}px`;
            this.editor.style.height = `${figHeight}px`;
            this.editor.style.position = 'relative';
            this.editor.style.overflow = 'hidden';

            // PluginBaseのrenderFigureElementsを使用して図形を描画
            // realtimeEl自体をxmlDocとして渡す（figure要素を含む）
            const tempDoc = document.implementation.createDocument(null, 'root', null);
            const importedFigure = tempDoc.importNode(figureEl, true);
            tempDoc.documentElement.appendChild(importedFigure);

            const result = this.renderFigureElements(tempDoc, this.editor);
        }

        // ビューモードを清書モードに設定
        this.viewMode = 'formatted';
    }

    /**
     * 仮身要素にイベントハンドラを設定
     */
};
