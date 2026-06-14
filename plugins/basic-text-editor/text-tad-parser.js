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
        const fontRegex = /<font\s+(size|color|face|space|hRatio|wRatio|style|weight|stretch|stretchscale|direction|kerning|pattern)="([^"]*)"\s*\/?>|<\/font>/gi;
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
                let attr = match[1].toLowerCase();
                if (attr === 'hratio') attr = 'hRatio';
                else if (attr === 'wratio') attr = 'wRatio';
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

        // <combchar>タグ -> 結合文字 (改行禁止 + inline-block)
        html = html.replace(/<combchar>([\s\S]*?)<\/combchar>/gi, '<span class="combchar" style="white-space: nowrap; display: inline-block;">$1</span>');

        // <char-layout>タグ -> 文字割付け
        html = html.replace(/<char-layout\s+kind="(\d+)"\s+width="([^"]*)"\s*>([\s\S]*?)<\/char-layout>/gi, (m, kind, widthStr, content) => this._buildCharLayoutSpan(kind, widthStr, content));

        // <fill-char str="..."/>タグ -> 充塡文字 (行末余白を埋める)
        html = html.replace(/<fill-char\s+str="([^"]*)"\s*\/>/gi, (m, str) => {
            return `<span class="fill-char" data-fill-str="${str}" style="flex-grow:1; display:inline-block; min-width:1ch;"></span>`;
        });

        // <fixed-space width="..."/>タグ -> 固定幅空白
        html = html.replace(/<fixed-space\s+width="([^"]*)"\s*\/>/gi, (m, w) => this._buildFixedSpaceSpan(w));

        // <bouten side="..." kind="...">対象</bouten> -> 傍点 (text-emphasis)
        html = html.replace(/<bouten\s+side="(upper|lower)"\s+kind="(\d+)"\s*>([\s\S]*?)<\/bouten>/gi, (m, side, kind, content) => this._buildBoutenSpan(side, kind, content));
        // 旧タグ互換: <botenUpper>/<botenLower> も受け付ける
        html = html.replace(/<botenUpper>([\s\S]*?)<\/botenUpper>/gi, (m, c) => this._buildBoutenSpan('upper', '0', c));
        html = html.replace(/<botenLower>([\s\S]*?)<\/botenLower>/gi, (m, c) => this._buildBoutenSpan('lower', '0', c));

        // <page-number step="..." num="..."/> -> ページ番号変数 span
        html = html.replace(/<page-number\s+step="([^"]*)"\s+num="([^"]*)"\s*\/>/gi, (m, step, num) => this._buildPageNumberSpan(step, num));

        // <docmemo text="..."/> -> 文章メモ span (表示は薄字、 保存時に復元)
        html = html.replace(/<docmemo\s+text="([^"]*)"\s*\/>/gi, (m, t) => this._buildDocmemoSpan(t));

        // <docoverlay ... /> -> 用紙オーバーレイ (FFA0 SubID 0x03/0x04)
        html = html.replace(/<docoverlay\s+([^>]*?)\/>/gi, (m, attrs) => this._buildDocoverlaySpan(attrs));

        // <paper-overlay-define N P>...</paper-overlay-define> -> 用紙オーバーレイ定義付箋
        // 中身は文章 TAD データのためそのまま編集 UI には反映せず、 Base64 で hidden span に退避してラウンドトリップ保証
        html = html.replace(/<paper-overlay-define\s+([^>]*)>([\s\S]*?)<\/paper-overlay-define>/gi,
            (m, attrs, content) => this._buildPaperOverlayDefinePreservedSpan(attrs, content));

        // <field-format ...><field .../>...</field-format> -> フィールド書式 (FFA1 SubID 0x03)
        html = html.replace(/<field-format\s+([^>]*?)>([\s\S]*?)<\/field-format>/gi, (m, attrs, inner) => this._buildFieldFormatBlock(attrs, inner));

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

        // <br/> を HTML <br> に正規化
        // xmlTAD で明示された <br/> は「ユーザー意図の段落内改行」 なので data-user-br マーキング
        // (parser が空段落表示用に追加する補助 br と区別するため → 装飾オーバーレイ/シリアライザの判定で使用)
        html = html.replace(/<br\s*\/>/gi, '<br data-user-br="1">');

        return html;
    }

    /**
     * TAD XMLから段落要素を抽出
     * <text>タグはレイアウト情報なので無視し、<document>内の<p>タグから直接テキストを抽出
     * BTRON仕様準拠: 多重ネスト <document> / <figure> を DOMParser で堅牢に処理
     */
    async parseTextElements(tadXML) {
        logger.debug('[EDITOR] parseTextElements開始');
        const textElements = [];

        // DOMParser で堅牢にパース（多重ネスト <document> / <figure> 対応）
        const parser = new DOMParser();
        let xmlDoc;
        try {
            // tad ルート要素がない場合に備えてラップ
            const wrapped = /^\s*<\?xml/i.test(tadXML) || /^\s*<tad/i.test(tadXML)
                ? tadXML
                : `<root>${tadXML}</root>`;
            xmlDoc = parser.parseFromString(wrapped, 'text/xml');
        } catch (e) {
            logger.warn('[EDITOR] XML パース失敗:', e);
            return textElements;
        }

        // ルート document を取得（最も外側の document を優先）
        // - tad > document の場合は tad 直下の document を取る
        // - figure 内の文字枠用 document はスキップする (figure 内は事前除外不要)
        let docElem = null;
        const tadElem = xmlDoc.querySelector('tad');
        if (tadElem) {
            // tad の直下の document を探す（figure 配下ではない）
            for (const child of Array.from(tadElem.children)) {
                if (child.tagName.toLowerCase() === 'document') {
                    docElem = child;
                    break;
                }
            }
        }
        if (!docElem) {
            // tad なしの場合は documentElement の直接の子を見る (figure 配下の document を拾わないため)
            const root = xmlDoc.documentElement;
            if (root) {
                for (const child of Array.from(root.children)) {
                    if (child.tagName.toLowerCase() === 'document') {
                        docElem = child;
                        break;
                    }
                }
            }
            if (!docElem) {
                // それでも見つからない場合のみ全体検索 (フォールバック)
                docElem = xmlDoc.querySelector('document');
            }
        }

        if (!docElem) {
            logger.warn('[EDITOR] <document>タグが見つかりません');
            return textElements;
        }

        // 直下の <p> タグを取得（ネストされた document 配下の <p> は除外）
        const paragraphs = [];
        for (const child of Array.from(docElem.children)) {
            if (child.tagName.toLowerCase() === 'p') {
                paragraphs.push(child);
            }
        }

        let paragraphCount = 0;
        for (const pElem of paragraphs) {
            // serializer で内部 XML を取得 (子要素含む)
            const paragraphContent = pElem.innerHTML;
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
     * 段落のタブ書式 CSS 文字列を構築 (margin-left/right, text-indent, pargap, page-break, tab-size)
     * 各段落で同じロジックが必要なため共通化
     * @param {Object} tabFormatState - 段落の有効なタブ書式 state
     * @param {number} tadUnitToPx - hunit → px 変換係数
     * @param {number} maxFontSize - 段落内の最大フォントサイズ (pargap 計算用)
     * @param {string} baseStyle - 既存スタイル文字列 (margin: 0.5em 0 等を含む)
     * @returns {string} タブ書式 CSS を追加したスタイル文字列
     */
    _buildTabFormatCss(tabFormatState, tadUnitToPx, maxFontSize, baseStyle) {
        let style = baseStyle;
        if (tabFormatState.left !== 0) {
            style += `margin-left: ${tabFormatState.left * tadUnitToPx}px;`;
        }
        if (tabFormatState.right !== 0) {
            style += `margin-right: ${tabFormatState.right * tadUnitToPx}px;`;
        }
        if (tabFormatState.indent !== 0) {
            style += `text-indent: ${tabFormatState.indent * tadUnitToPx}px;`;
        }
        const pargapStr = tabFormatState.pargap;
        const isPargapAbs = typeof pargapStr === 'string' && pargapStr.startsWith('abs:');
        const pargapValue = parseFloat(isPargapAbs ? pargapStr.slice(4) : pargapStr);
        if (!isNaN(pargapValue) && pargapStr !== '0.75') {
            const vunitToPx = Math.abs(window.DPI / this.docScale.vunit);
            const pargapPx = isPargapAbs ? (pargapValue * vunitToPx) : (pargapValue * maxFontSize);
            style = style.replace('margin: 0.5em 0;', `margin: ${pargapPx}px 0;`);
        }
        if (tabFormatState.P === 1) {
            style += `break-after: avoid-page;`;
        } else if (tabFormatState.P === 2) {
            style += `break-inside: avoid;`;
        }
        if (tabFormatState.tabs && tabFormatState.tabs.length > 0) {
            const tabInterval = tabFormatState.tabs[0] * tadUnitToPx;
            if (tabInterval > 0) {
                style += `tab-size: ${tabInterval}px; -moz-tab-size: ${tabInterval}px;`;
            }
        }
        return style;
    }

    /**
     * 段落 paragraphContent 内の <indent/> を処理 (BTRON 仕様: 段落内 1 個のみ)
     * 字下げ位置の anchor span に置換し、 padding-left/text-indent CSS を style に追加する
     * Phase D: タブ書式 indent との合成式で text-indent を構築 (1 行目 = タブ書式 indent、 2 行目以降 = padding-left)
     * @param {string} paragraphContent - パース中の段落 HTML 文字列
     * @param {string} style - 既存スタイル文字列
     * @param {Object} tabFormatState - 段落の有効なタブ書式 state (text-indent 合成用)
     * @param {number} tadUnitToPx - hunit → px 変換係数
     * @returns {Promise<{paragraphContent: string, style: string}>}
     */
    async _processIndentTag(paragraphContent, style, tabFormatState, tadUnitToPx) {
        const indentMatch = /<indent\s*\/>/i.exec(paragraphContent);
        if (!indentMatch) {
            return { paragraphContent, style };
        }
        const tagPosition = indentMatch.index;
        const beforeTag = paragraphContent.substring(0, tagPosition);
        const afterTag = paragraphContent.substring(tagPosition + indentMatch[0].length);

        const indentPx = await this.calculateTextWidthBeforeIndent(beforeTag, style);

        if (indentPx > 0) {
            // Phase D: タブ書式 indent と <indent/> の合成
            // 1 行目開始位置 = padding-left + text-indent = (タブ書式 indent)
            // 2 行目以降開始位置 = padding-left = (<indent/> 由来の幅)
            // → padding-left = M、 text-indent = T - M
            const tabIndentPx = (tabFormatState && tabFormatState.indent !== 0)
                ? tabFormatState.indent * tadUnitToPx
                : 0;
            const effectiveTextIndent = tabIndentPx - indentPx;
            style += `padding-left: ${indentPx}px; text-indent: ${effectiveTextIndent}px;`;
        }

        // 後続の <indent/> を全削除 (BTRON 仕様: 段落内 1 個のみ)
        const cleanedAfterTag = afterTag.replace(/<indent\s*\/>/gi, '');
        paragraphContent = beforeTag
            + '<span class="indent-anchor" contenteditable="false"></span>'
            + cleanedAfterTag;

        return { paragraphContent, style };
    }

    /**
     * 字下げ anchor 段落の padding-left を anchor の実表示位置に揃える
     * CSS のタブストップはコンテンツ端 (padding の内側) を基準に計算されるため、
     * 任意の padding-left を与えると 1 行目のタブ到達位置がずれ、 段落ごとにタブグリッドもバラバラになる。
     * そこで「padding なしの素のレイアウト」 で anchor 位置 A を実測して padding-left = A を採用する。
     * A は素のタブグリッド (タブ幅の整数倍) 上にあるため、 適用後もグリッド基準が変わらず
     * 1 行目のタブ到達位置は素のレイアウトのまま不変 (= 段落間でタブ位置が揃う) で、
     * 2 行目以降だけが A から始まる (数学的に固定点)。 タブなし段落も 1 行目が不変なので同式で成立
     */
    _realignIndentAnchors() {
        if (!this.editor) return;
        const paragraphs = this.editor.querySelectorAll('p');
        paragraphs.forEach((p) => {
            const anchor = p.querySelector('.indent-anchor');
            if (!anchor) return;
            if (anchor.getClientRects().length === 0) return; // 非表示 (測定不能)
            // タブ書式由来の indent (1 行目開始位置) を inline style から逆算: text-indent = tabIndent - padding
            const tabIndentPx = (parseFloat(p.style.textIndent) || 0) + (parseFloat(p.style.paddingLeft) || 0);
            // anchor の見た目位置 (段落 padding ボックス左端基準、 ズーム補正済みレイアウト px)
            const measure = () => {
                const pRect = p.getBoundingClientRect();
                const aRect = anchor.getBoundingClientRect();
                if (pRect.width === 0 || p.offsetWidth === 0) return NaN;
                const scale = pRect.width / p.offsetWidth; // transform scale 補正
                return (aRect.left - pRect.left) / (scale || 1) - p.clientLeft;
            };
            // 1) padding なしの素のレイアウトで目標位置 A を実測
            p.style.paddingLeft = '';
            p.style.textIndent = tabIndentPx !== 0 ? `${tabIndentPx}px` : '';
            let target = measure();
            if (!isFinite(target) || target <= 0) return; // 行頭 anchor 等は字下げ効果なし (素の状態を維持)
            // 2) padding-left = A を適用 (グリッド整合の固定点)
            p.style.paddingLeft = `${target}px`;
            p.style.textIndent = `${tabIndentPx - target}px`;
            // 3) ブラウザのタブストップ実装差で anchor が動いた場合のみ追加収束 (通常は不動で 1 回目に終了)
            for (let i = 0; i < 3; i++) {
                const anchorX = measure();
                if (!isFinite(anchorX) || Math.abs(anchorX - target) < 0.5) break;
                target = anchorX;
                if (target <= 0) {
                    p.style.paddingLeft = '';
                    p.style.textIndent = tabIndentPx !== 0 ? `${tabIndentPx}px` : '';
                    break;
                }
                p.style.paddingLeft = `${target}px`;
                p.style.textIndent = `${tabIndentPx - target}px`;
            }
        });
    }

    /**
     * tadXMLをエディタに描画（TAD XMLタグをそのまま使用）
     * @param {string} tadXML - TAD XML文字列
     * @param {object} options - { returnHtml: true でeditor.innerHTML上書きせずHTML文字列を返却 }
     * @returns {Promise<string|undefined>} returnHtml:trueのときHTML文字列
     */
    // 閉じタグが欠落した不正XMLを、 未閉じタグを末尾(</tad>の手前)に逆順で補って整形式にする。
    // 文章中インライン図形の後に </p>/</document> が出力されない生成側のネスト管理漏れを表示側で救済する。
    _balanceTags(xml) {
        // XML 1.0 で禁止された制御文字(FF=U+000C 等。 タブ \t・改行 \n・復帰 \r は許可)を除去する。
        // テキストノード中の不正文字は DOMParser を parsererror にするが、 閉じタグ補完では直らないためここで除く
        xml = xml.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
        // 自己終端(空要素)タグの集合。 font/text は閉じタグを持つペアタグ(<font ...>...</font>)が正規出力のため
        // 含めない。 含めると </font>/</text> の lastIndexOf 探索が他要素の stack を誤って切り詰める。
        // <font .../> のような /> 終端の自己終端形式は selfTerm の endsWith('/') 判定で別途カバーする
        const selfClose = new Set(['br', 'tab', 'paper', 'docmargin', 'docscale', 'docoverlay', 'tab-format', 'figview', 'figdraw', 'figscale', 'pattern', 'mask', 'rect', 'line', 'polygon', 'ellipse', 'link', 'docview', 'docdraw', 'image', 'frame-open']);
        const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g;
        let m, stack = [];
        while ((m = re.exec(xml))) {
            const closing = m[1] === '/';
            const tag = m[2].toLowerCase();
            // ルート要素 tad は stack 管理外。 </tad> が stack 途中(document/p が未閉じ)で来ると
            // lastIndexOf('tad') が stack 全体をクリアして未閉じを取りこぼすため、 tad は走査対象から除外し、
            // 残った未閉じ(document/p)を </tad> の手前に補完する
            if (tag === 'tad') continue;
            const selfTerm = m[3].trim().endsWith('/') || selfClose.has(tag);
            if (closing) {
                const idx = stack.lastIndexOf(tag);
                if (idx >= 0) stack.length = idx;
            } else if (!selfTerm) {
                stack.push(tag);
            }
        }
        if (stack.length === 0) return xml;
        let closeTags = '';
        for (let i = stack.length - 1; i >= 0; i--) {
            closeTags += '</' + stack[i] + '>';
        }
        if (!closeTags) return xml;
        const tadEnd = xml.lastIndexOf('</tad>');
        return (tadEnd >= 0) ? (xml.slice(0, tadEnd) + closeTags + xml.slice(tadEnd)) : (xml + closeTags);
    }

    async renderTADXML(tadXML, options = {}) {
        const returnHtml = options.returnHtml === true;

        if (!tadXML) {
            if (!returnHtml) this.editor.innerHTML = '<p>XMLデータの解析に失敗しました</p>';
            return returnHtml ? '' : undefined;
        }

        try {
            // 不正XML(閉じタグ欠落)を末尾補完して整形式にする (文章中インライン図形後の </p>/</document> 欠落等)
            tadXML = this._balanceTags(tadXML);
            // XMLをパースしてrealtime要素を検出
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(tadXML, 'text/xml');

            // パースエラーチェック
            const parseError = xmlDoc.querySelector('parsererror');
            if (parseError) {
                if (!returnHtml) this.editor.innerHTML = '<p>XMLパースエラー</p>';
                return returnHtml ? '' : undefined;
            }

            // <realtime>要素を検出した場合は専用処理
            // (returnHtmlモードでは非対応: realtimeコンテンツを含むコピペは想定しない)
            const realtimeEl = xmlDoc.querySelector('realtime');
            if (realtimeEl) {
                if (!returnHtml) {
                    await this.renderRealtimeContent(realtimeEl, xmlDoc);
                }
                return returnHtml ? '' : undefined;
            }

            // インライン<figure>ブロックを事前抽出（ネストされた<figure>/<document>問題の回避）
            // BTRON仕様準拠: 入れ子の <figure> はバランス取りで正しく抽出する。
            // 単純な非貪欲正規表現では <figure>...<figure>...</figure>...</figure> の外側が
            // 最初の </figure> で終端されてしまうため、深さカウンタで対応する。
            const figureBlocks = [];
            {
                const reFigStart = /<figure(?:\s[^>]*)?>/gi;
                const reFigEnd = /<\/figure\s*>/gi;
                let result = '';
                let i = 0;
                while (i < tadXML.length) {
                    reFigStart.lastIndex = i;
                    const startMatch = reFigStart.exec(tadXML);
                    if (!startMatch) { result += tadXML.substring(i); break; }
                    result += tadXML.substring(i, startMatch.index);
                    // バランス取り: 開始タグを 1 として終了タグを探す
                    let depth = 1;
                    let pos = startMatch.index + startMatch[0].length;
                    while (depth > 0) {
                        reFigStart.lastIndex = pos;
                        reFigEnd.lastIndex = pos;
                        const nextStart = reFigStart.exec(tadXML);
                        const nextEnd = reFigEnd.exec(tadXML);
                        if (!nextEnd) { depth = -1; break; }
                        if (nextStart && nextStart.index < nextEnd.index) {
                            depth++;
                            pos = nextStart.index + nextStart[0].length;
                        } else {
                            depth--;
                            pos = nextEnd.index + nextEnd[0].length;
                            if (depth === 0) break;
                        }
                    }
                    if (depth < 0) {
                        // バランスが取れなかった場合は開始タグだけ保持して進める
                        result += startMatch[0];
                        i = startMatch.index + startMatch[0].length;
                        continue;
                    }
                    const block = tadXML.substring(startMatch.index, pos);
                    const idx = figureBlocks.length;
                    figureBlocks.push(block);
                    result += `__FIGURE_PLACEHOLDER_${idx}__`;
                    i = pos;
                }
                tadXML = result;
            }

            const frameOpenMap = {};

            tadXML = this._extractFrameOpens(tadXML, frameOpenMap);

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
                        const figScaleElem = tmpDoc.querySelector('figScale');
                        let scaleX = 1, scaleY = 1;
                        const CANVAS_DPI = 96;
                        if (figScaleElem) {
                            const hunit = parseFloat(figScaleElem.getAttribute('hunit')) || 0;
                            const vunit = parseFloat(figScaleElem.getAttribute('vunit')) || 0;
                            scaleX = hunit === 0 ? 1 : (hunit < 0 ? CANVAS_DPI / Math.abs(hunit) : hunit);
                            scaleY = vunit === 0 ? 1 : (vunit < 0 ? CANVAS_DPI / Math.abs(vunit) : vunit);
                        }
                        const fWidthUnits = figView ? (parseInt(figView.getAttribute('right')) - parseInt(figView.getAttribute('left'))) : 800;
                        const fHeightUnits = figView ? (parseInt(figView.getAttribute('bottom')) - parseInt(figView.getAttribute('top'))) : 600;
                        // figScale を適用してピクセル単位に変換 (basic-figure-editor の getFigScalePixelFactor と整合)
                        const fWidth = Math.ceil(fWidthUnits * scaleX);
                        const fHeight = Math.ceil(fHeightUnits * scaleY);
                        const displayWidth = fWidth;
                        const displayHeight = fHeight;
                        const encoded = btoa(unescape(encodeURIComponent(figureXml)));
                        const sourceRealId = this.realId || '';
                        figureHtml +=
                            `<div class="figure-segment" contenteditable="false" data-figure-xmltad="${encoded}" ` +
                            `data-source-real-id="${sourceRealId}" ` +
                            `style="display: block; margin: 0; width: ${displayWidth}px; height: ${displayHeight}px; overflow: hidden;">` +
                            `<iframe src="../../plugins/basic-figure-editor/index.html?embedded=true" ` +
                            `style="width: ${fWidth}px; height: ${fHeight}px; border: none;"></iframe></div>`;
                    });
                    // 図形セグメントの後に編集可能な文章セグメントを追加
                    figureHtml += '<document><p></p></document>';
                    if (!returnHtml) {
                        this.editor.innerHTML = figureHtml;
                        this.initFigureSegmentIframes();
                    }
                    return returnHtml ? figureHtml : undefined;
                }
                logger.warn('[EDITOR] <document>タグが見つかりません');
                if (!returnHtml) this.editor.innerHTML = '<p>Document要素が見つかりません</p>';
                return returnHtml ? '' : undefined;
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
            // Phase ζ-4: 最初の <paper> のみ paperSize に書き込み (= 文書冒頭の用紙指定付箋)。
            //   2 番目以降の <paper> は中間挿入として扱い、 elementRegex ループ内で hidden-paper-change span として復元する。
            const paperElements = xmlDoc.querySelectorAll('paper');
            if (paperElements.length > 0) {
                this.parsePaperElement(paperElements[0]);
                // paperSizeからpaperWidth/paperHeightを同期
                if (this.paperSize) {
                    this.paperWidth = this.paperSize.width;
                    this.paperHeight = this.paperSize.length;
                }
                logger.debug(`[EDITOR] 用紙設定をロード: ${this.paperSize ? window.pointsToMm(this.paperWidth).toFixed(0) : 210}×${this.paperSize ? window.pointsToMm(this.paperHeight).toFixed(0) : 297}mm (文書冒頭の <paper>${paperElements.length > 1 ? `、 中間 ${paperElements.length - 1} 個は hidden span として復元予定` : ''})`);
            }
            // 注意: <paper>要素がない場合はpaperSizeをnullのままにする
            // （条件付き保存で<paper>/<docmargin>を出力しないため）

            // <docmargin>要素をパース（余白設定）
            // 仕様: 値 0xffff (65535) は「直前のマージン指定を継承」を意味する
            const docmarginElements = xmlDoc.querySelectorAll('docmargin');
            if (docmarginElements.length > 0) {
                const docmargin = docmarginElements[0];
                if (!this.paperMargin) {
                    this.paperMargin = new window.PaperMargin();
                }
                const parseMarginAttr = (attrName, currentValue) => {
                    const raw = docmargin.getAttribute(attrName);
                    if (raw === null) return currentValue;
                    const num = parseFloat(raw);
                    if (isNaN(num)) return currentValue;
                    return num === 65535 ? currentValue : num;
                };
                this.paperMargin.top = parseMarginAttr('top', this.paperMargin.top || 0);
                this.paperMargin.bottom = parseMarginAttr('bottom', this.paperMargin.bottom || 0);
                this.paperMargin.left = parseMarginAttr('left', this.paperMargin.left || 0);
                this.paperMargin.right = parseMarginAttr('right', this.paperMargin.right || 0);
                logger.debug(`[EDITOR] 余白設定をロード: top=${this.paperMargin.top}, bottom=${this.paperMargin.bottom}, left=${this.paperMargin.left}, right=${this.paperMargin.right}`);
            } else if (this.paperSize && (this.paperSize.top || this.paperSize.bottom || this.paperSize.left || this.paperSize.right)) {
                // BTRON GUI 仕様準拠の旧データ移行 (W-0c):
                // <docmargin> が無く、 paper の余白属性 (top/left/right/bottom) のみがある古い xtad の場合、
                // paper の余白属性を paperMargin (本文レイアウト領域マージン) にコピーする。
                // (旧 UI で paper.top/left/right/bottom に本文マージンが書かれていたケースを救済)
                this.paperMargin = new window.PaperMargin();
                this.paperMargin.top = this.paperSize.top || 0;
                this.paperMargin.bottom = this.paperSize.bottom || 0;
                this.paperMargin.left = this.paperSize.left || 0;
                this.paperMargin.right = this.paperSize.right || 0;
                logger.debug(`[EDITOR] docmargin 無し → paper 余白属性から paperMargin を救済: top=${this.paperMargin.top}, bottom=${this.paperMargin.bottom}, left=${this.paperMargin.left}, right=${this.paperMargin.right}`);
            }

            // 文字方向指定付箋 (BTRON 2.1.4 FFA1 SubID 0x04) 由来の direction を editor に適用
            // txdir: 0=左横書き, 1=右横書き, 2=縦書き
            if (!returnHtml && this.editor) {
                const textDirEl = xmlDoc.querySelector('text[direction]');
                if (textDirEl) {
                    const txdir = parseInt(textDirEl.getAttribute('direction') || '0', 10);
                    this.textDirection = txdir;
                    if (txdir === 1) {
                        this.editor.style.direction = 'rtl';
                        this.editor.style.writingMode = '';
                    } else if (txdir === 2) {
                        this.editor.style.writingMode = 'vertical-rl';
                        this.editor.style.direction = '';
                    } else {
                        this.editor.style.writingMode = '';
                        this.editor.style.direction = '';
                    }
                }
            }

            // 用紙指定 + マージン指定に基づくエディタ折り返し幅 (BTRON GUI 仕様準拠)
            // editor.js の _applyPaperWidthToEditor() に共通化済。 ここからは呼出のみ。
            // 仕様準拠: paperMargin の left/right は ノド/小口 を意味し、 paperSize の binding/imposition によって反転する。
            // wrapMode=true (ウインドウ幅で折り返し ON) の場合や XML モードでは内部で早期 return される。
            if (!returnHtml && typeof this._applyPaperWidthToEditor === 'function') {
                this._applyPaperWidthToEditor();
            }

            this._applyColumnSetting(xmlDoc, returnHtml);

            // ページ追跡を初期化（条件付き改ページ用）
            if (!returnHtml) {
                this.initPageTracker();
            }

            // テキストスタイル状態を段落ループの外で初期化（段落間引き継ぎ用）
            const textStyleState = new window.TextStyleStateManager();

            // タブ書式状態を段落ループの外で初期化（段落間継承用）
            const tabFormatState = {
                R: 0, P: 0, height: '0', pargap: '0.75',
                left: 0, right: 0, indent: 0, ntabs: 0, tabs: []
            };

            // 行揃え状態を段落ループの外で初期化 (BTRON 2.1.1: 次の <text align> まで継承)
            let currentTextAlign = 'left';

            // 行間隔状態を段落ループの外で初期化 (BTRON 2.1.0: 次の <text line-height> まで継承)
            let currentLineHeight = null;  // null = 未設定 (アプリケーションデフォルト)

            // 行頭/行末禁則状態を段落ループの外で初期化 (BTRON 2.4.8/2.4.9: 次の同種付箋まで継承)
            // 値は { kind: 'KL' 形式の 16 進数文字列、 ch: 禁則対象文字列 } の形
            let currentLineHeadKinsoku = null;
            let currentLineTailKinsoku = null;

            // <p>タグと<pagebreak>タグ、 中間の <paper>/<docmargin>/<column> を順番に処理
            // 捕獲グループ: [1]=<p> 内容, [2]=<pagebreak> 属性, [3]=<paper> 属性, [4]=<docmargin> 属性, [5]=<column> 属性
            // <pagebreak/> (属性なし) は無条件改ページ
            // 注意: 改ページコード 0x0c (\f) は XML 1.0 で無効なので xmlTAD では <pagebreak/> で表現する
            const elementRegex = /<p>([\s\S]*?)<\/p>|<pagebreak\s+([^>]*)\/>|<pagebreak\s*\/>|<fill-line\s*\/>|<paper\s+([^>]*?)\/>|<docmargin\s+([^>]*?)\/>|<column\s+([^>]*?)\/>/gi;
            const fillLineHandler = (m) => (!m[1] && !m[2] && !m[3] && !m[4] && !m[5] && !/^<pagebreak\s*\/>$/i.test(m[0])) ? this._emitFillLineSpacer() : null;
            let htmlContent = '';
            let elementMatch;
            let paragraphCount = 0;
            let lastIndex = 0;

            // Phase ζ-4: 中間 <paper>/<docmargin> を hidden-paper-change span として後続段落の直前に挿入するための状態
            let paperParsedCount = 0;       // <paper> 出現回数 (1 = 文書冒頭、 2 以降 = 中間挿入)
            let docmarginParsedCount = 0;   // <docmargin> 出現回数 (同上)
            let pendingPaperAttrs = null;   // 次の <p> の前に挿入する <paper> 属性
            let pendingDocmarginAttrs = null; // 次の <p> の前に挿入する <docmargin> 属性

            // Phase 2 H4: 中間 <column> を hidden-column-change span として後続段落の直前に挿入するための状態
            // 1 番目の <column> は既存の querySelectorAll('column') 経由で editor.style.columnCount に反映される (描画)
            // 2 番目以降は hidden span として退避し、 ラウンドトリップでの保存・再読込整合性を保つ
            let columnParsedCount = 0;
            let pendingColumnAttrs = null;

            while ((elementMatch = elementRegex.exec(docContent)) !== null) {
                // 属性なし <pagebreak/> (= 無条件改ページ、 BTRON 0x0c 相当、 paper/docmargin 直前マーカー):
                //   parser では無視。 シリアライザが必要時 (hidden-paper-change span 出力時) に必ず再出力するためラウンドトリップ整合性は保たれる。
                if (elementMatch[2] === undefined && /^<pagebreak\s*\/>$/i.test(elementMatch[0])) {
                    lastIndex = elementRegex.lastIndex;
                    continue;
                }
                // <paper> 検出 (中間用紙指定付箋を hidden-paper-change span として復元)
                if (elementMatch[3] !== undefined) {
                    paperParsedCount++;
                    if (paperParsedCount > 1) {
                        // 2 番目以降の <paper> は中間挿入として保持し、 次の <p> の前に hidden-paper-change span を生成
                        pendingPaperAttrs = elementMatch[3];
                    }
                    lastIndex = elementRegex.lastIndex;
                    continue;
                }
                // <docmargin> 検出 (中間マージン指定付箋を hidden-paper-change span として復元)
                if (elementMatch[4] !== undefined) {
                    docmarginParsedCount++;
                    if (docmarginParsedCount > 1) {
                        pendingDocmarginAttrs = elementMatch[4];
                    }
                    lastIndex = elementRegex.lastIndex;
                    continue;
                }
                // <column> 検出 (中間コラム指定付箋を hidden-column-change span として復元、 BTRON 2.0.2)
                // 1 番目の <column> は既存処理 (parseColumn) で editor.style.columnCount に反映、 ここではスキップ
                // 2 番目以降は pending として次の <p> の直前に hidden span 化する
                if (elementMatch[5] !== undefined) {
                    columnParsedCount++;
                    if (columnParsedCount > 1) {
                        pendingColumnAttrs = elementMatch[5];
                    }
                    lastIndex = elementRegex.lastIndex;
                    continue;
                }
                const fr = fillLineHandler(elementMatch);
                if (fr) {
                    htmlContent += fr;
                    lastIndex = elementRegex.lastIndex;
                    continue;
                }
                // <pagebreak>要素の処理
                if (elementMatch[2] !== undefined) {
                    // <pagebreak>要素を処理
                    const attrString = elementMatch[2];
                    const condMatch = /cond="(\d+)"/.exec(attrString);
                    const remainMatch = /remain="(\d+)"/.exec(attrString);

                    const cond = condMatch ? parseInt(condMatch[1], 10) : 0;
                    const remain = remainMatch ? parseInt(remainMatch[1], 10) : 0;

                    // cond=0 && remain=0 は無条件改ページ (シリアライザのデフォルト出力)
                    // → page-break クラスで復元し、 常に表示されるようにする
                    if (cond === 0 && remain === 0) {
                        let pageBreakClasses = 'page-break';
                        if (this.paperFrameVisible) {
                            pageBreakClasses += ' page-break-visible';
                        }
                        this.pageTracker.currentPage++;
                        this.pageTracker.remainingHeight = this.pageTracker.pageHeight;
                        htmlContent += `<div class="${pageBreakClasses}"></div>`;
                        lastIndex = elementRegex.lastIndex;
                        continue;
                    }

                    // それ以外は条件付き改ページとして処理
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
                // 段落内に複数ある場合は BTRON 仕様 (後勝ち) で最後の <tab-format> の値を tabFormatState に反映する
                const _tabFormatAll = [...paragraphContent.matchAll(/<tab-format\s+([^>]*)\/>/gi)];
                const tabFormatMatch = _tabFormatAll.length > 0 ? _tabFormatAll[_tabFormatAll.length - 1] : null;
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
                    const tabsMatch = /\btabs="([^"]*)"/.exec(attrs);

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
                        const tabRaw = tabsMatch[1].split(',').map(Number);
                        // tabs<0 は小数点揃えタブ。 絶対値を位置として使い、 decimalAlign フラグを別配列に保持
                        tabFormatState.tabs = tabRaw.map(n => Math.abs(n));
                        tabFormatState.tabsDecimalAlign = tabRaw.map(n => n < 0);
                    } else if (ntabsValue === 0) {
                        tabFormatState.tabs = [];
                        tabFormatState.tabsDecimalAlign = [];
                    }
                    // ntabs < 0: 直前のタブストップを継承（tabFormatState.tabsを変更しない）

                    // 詳細モード時はタブ書式指定付箋をルーラー UI で表示する (段落内に複数あれば複数描画)
                    // 通常モード (清書 / 原稿) ではタグを削除し、 段落 CSS に吸収させる
                    // 段落 CSS には tabFormatState (最後の <tab-format>) の値を適用する (BTRON 後勝ち継承)
                    const isDetailedMode = this.editor && this.editor.classList && this.editor.classList.contains('detail-mode');
                    // ruler 表示用の単位: 1 文字幅 (CHAR_UNIT_PX) で段落フォントに依存しない
                    // (ユーザー入力 / ruler ドラッグの単位は文字幅で統一、 ファイル保存値は hunit に変換)
                    paragraphContent = this._replaceTabFormatTagsWithRuler(paragraphContent, window.CHAR_UNIT_PX, isDetailedMode);
                }

                // タブ書式のCSS適用 (BTRON 仕様: tabs[i] / left / right / indent は docScale.hunit ベース)
                // ruler 表示の文字幅単位とは分離 — ユーザー入力は文字幅、 ファイル保存は hunit
                const tadUnitToPx = Math.abs(window.DPI / this.docScale.hunit);
                style = this._buildTabFormatCss(tabFormatState, tadUnitToPx, maxFontSize, style);

                // テキスト配置 (BTRON 2.1.1: 出現行から次の行揃え指定付箋まで継続)
                // state を BTRON 後勝ち (段落内に複数あれば最後の値) で更新
                const textAlignAllMatches = [...paragraphContent.matchAll(/<text\s+align="([^"]*)"\s*\/>/gi)];
                if (textAlignAllMatches.length > 0) {
                    currentTextAlign = textAlignAllMatches[textAlignAllMatches.length - 1][1];
                    // 詳細モード時は旗マーク (detail-align span)、 通常モードはタグ削除して state に吸収
                    const isDetailedModeAlign = this.editor && this.editor.classList && this.editor.classList.contains('detail-mode');
                    if (isDetailedModeAlign) {
                        paragraphContent = paragraphContent.replace(/<text\s+align="([^"]*)"\s*\/>/gi, (m, v) => {
                            return '<span class="detail-align" data-align="' + v + '" contenteditable="false"></span>';
                        });
                    } else {
                        paragraphContent = paragraphContent.replace(/<text\s+align="[^"]*"\s*\/>/gi, '');
                    }
                }
                // 現在の text-align を段落 CSS に常に適用 (= BTRON 後勝ち継承の自然な表現)
                if (currentTextAlign && currentTextAlign !== 'left' && currentTextAlign !== '0') {
                    style += `text-align: ${currentTextAlign};`;
                }

                // <text line-height="..."/> タグ (BTRON 2.1.0): 次の行間隔指定付箋まで継続
                // BTRON 後勝ち (段落内に複数あれば最後の値) で state を更新
                const textLineHeightAllMatches = [...paragraphContent.matchAll(/<text\s+line-height="([^"]*)"[^>]*\/>/gi)];
                if (textLineHeightAllMatches.length > 0) {
                    let totalRatio = parseFloat(textLineHeightAllMatches[textLineHeightAllMatches.length - 1][1]);
                    // px 値が倍率欄に混入した異常データ (例 38.061) を浄化。 行間倍率の実用上限は約3
                    if (!isNaN(totalRatio) && totalRatio > 10) totalRatio = 1.5;
                    if (!isNaN(totalRatio) && totalRatio > 0) {
                        currentLineHeight = totalRatio;
                        tabFormatState.height = String(totalRatio - 1); // 総合比率→ギャップ率
                    }
                    paragraphContent = paragraphContent.replace(/<text\s+line-height="[^"]*"[^>]*\/>/gi, '');
                }
                // <tab-format> 経由で tabFormatState.height が 0 にリセットされていた場合は currentLineHeight から復元
                if (currentLineHeight !== null && tabFormatState.height === '0') {
                    tabFormatState.height = String(currentLineHeight - 1);
                }

                // 行頭禁則指定付箋 (BTRON 2.4.8): 出現行から次の同種付箋まで継続
                const lineHeadKinsokuResult = this._processLineKinsoku(paragraphContent, 'line-head-kinsoku', currentLineHeadKinsoku);
                paragraphContent = lineHeadKinsokuResult.content;
                currentLineHeadKinsoku = lineHeadKinsokuResult.state;
                // 行末禁則指定付箋 (BTRON 2.4.9)
                const lineTailKinsokuResult = this._processLineKinsoku(paragraphContent, 'line-tail-kinsoku', currentLineTailKinsoku);
                paragraphContent = lineTailKinsokuResult.content;
                currentLineTailKinsoku = lineTailKinsokuResult.state;
                // 段落 CSS に kinsoku の line-break/word-break を反映
                style += this._buildKinsokuCss(currentLineHeadKinsoku, currentLineTailKinsoku);

                // <indent/>タグを処理 (BTRON 仕様: 段落内 1 個のみ、 タブ書式 indent との合成式で text-indent を構築)
                ({ paragraphContent, style } = await this._processIndentTag(paragraphContent, style, tabFormatState, tadUnitToPx));

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
                // SCALE型 abs: プレフィックスは絶対モード (座標系単位)
                const heightStr = tabFormatState.height;
                const isHeightAbs = typeof heightStr === 'string' && heightStr.startsWith('abs:');
                const heightValue = parseFloat(isHeightAbs ? heightStr.slice(4) : heightStr);
                const vunitToPxH = Math.abs(window.DPI / this.docScale.vunit);
                let lineHeight;
                if (isHeightAbs && heightValue > 0) {
                    lineHeight = heightValue * vunitToPxH;
                } else if (heightValue > 0) {
                    lineHeight = (1 + heightValue) * window.convertPtToPx(maxFontSize);
                } else {
                    lineHeight = window.convertPtToPx(maxFontSize) * 1.5;
                }
                style += `line-height: ${lineHeight}px;`;

                // xmlTAD 仕様: 改段落 = <p>...</p>、 空段落 = <p></p>
                // 空段落も「ユーザーが意図して入れた改段落」 として保持する (ブラウザ表示用に <br> を補助挿入)
                // 補助 br は装飾オーバーレイ / シリアライザの _isParagraphFillerBr で判定され、 装飾されず XML 出力もされない
                {
                    const tabFormatJson = JSON.stringify(tabFormatState);
                    // Phase ζ-4: 中間 <paper>/<docmargin> が pending にあれば、 段落 HTML の直前に hidden-paper-change span を挿入
                    let paperChangePrefix = '';
                    if (pendingPaperAttrs !== null || pendingDocmarginAttrs !== null) {
                        const safePaperAttrs = (pendingPaperAttrs || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                        const safeDocmarginAttrs = (pendingDocmarginAttrs || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                        paperChangePrefix = `<span class="hidden-paper-change" data-paper-attrs="${safePaperAttrs}" data-docmargin-attrs="${safeDocmarginAttrs}" style="display:none"></span>`;
                        pendingPaperAttrs = null;
                        pendingDocmarginAttrs = null;
                    }
                    // Phase 2 H4: 中間 <column> が pending にあれば hidden-column-change span を挿入 (BTRON 2.0.2)
                    let columnChangePrefix = '';
                    if (pendingColumnAttrs !== null) {
                        const safeColumnAttrs = pendingColumnAttrs.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                        columnChangePrefix = `<span class="hidden-column-change" data-column-attrs="${safeColumnAttrs}" style="display:none"></span>`;
                        pendingColumnAttrs = null;
                    }
                    // 空段落は表示確保用に補助 br を入れる (data-filler でマーキング → 装飾/シリアライズ対象外)
                    const innerContent = paragraphContent.trim() ? paragraphContent : '<br data-filler="1">';
                    htmlContent += paperChangePrefix + columnChangePrefix + `<p style="${style}" data-tab-format='${tabFormatJson}'>${innerContent}</p>`;
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
                // 通常経路 (L1062-1063) と同じく BTRON 後勝ち仕様で全件マッチを取得し、 最後の値を tabFormatState に反映する
                const _tabFormatAllR = [...paragraphContent.matchAll(/<tab-format\s+([^>]*)\/>/gi)];
                const tabFormatMatchR = _tabFormatAllR.length > 0 ? _tabFormatAllR[_tabFormatAllR.length - 1] : null;
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
                    const tabsMatch = /\btabs="([^"]*)"/.exec(attrs);

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
                        const tabRawR = tabsMatch[1].split(',').map(Number);
                        tabFormatState.tabs = tabRawR.map(n => Math.abs(n));
                        tabFormatState.tabsDecimalAlign = tabRawR.map(n => n < 0);
                    } else if (ntabsValueR === 0) {
                        tabFormatState.tabs = [];
                        tabFormatState.tabsDecimalAlign = [];
                    }

                    // Phase 3-B: 通常経路と同じ共通関数を呼ぶ (重複コード除去)
                    const isDetailedModeR = this.editor && this.editor.classList && this.editor.classList.contains('detail-mode');
                    // BTRON タブ書式の単位は「文字幅」 で統一 (文書共通の固定値)
                    const charUnitPxR = window.CHAR_UNIT_PX;
                    paragraphContent = this._replaceTabFormatTagsWithRuler(paragraphContent, charUnitPxR, isDetailedModeR);
                }

                // タブ書式のCSS適用 (1 単位 = 1 文字幅 px、 文書共通の固定値)
                const tadUnitToPxR = window.CHAR_UNIT_PX;
                style = this._buildTabFormatCss(tabFormatState, tadUnitToPxR, maxFontSize, style);

                // テキスト配置
                const textAlignMatch = /<text\s+align="([^"]*)"\s*\/>/i.exec(paragraphContent);
                if (textAlignMatch) {
                    style += `text-align: ${textAlignMatch[1]};`;
                    // 詳細モード時はそろえ指定付箋を旗マーク化
                    const isDetailedModeAlignR = this.editor && this.editor.classList && this.editor.classList.contains('detail-mode');
                    if (isDetailedModeAlignR) {
                        paragraphContent = paragraphContent.replace(/<text\s+align="([^"]*)"\s*\/>/gi, (m, v) => {
                            return '<span class="detail-align" data-align="' + v + '" contenteditable="false"></span>';
                        });
                    } else {
                        paragraphContent = paragraphContent.replace(/<text\s+align="[^"]*"\s*\/>/gi, '');
                    }
                }

                // <text line-height="..."/> タグ (BTRON 2.1.0): 次の行間隔指定付箋まで継続 (残段落経路)
                const textLineHeightAllMatchesR = [...paragraphContent.matchAll(/<text\s+line-height="([^"]*)"[^>]*\/>/gi)];
                if (textLineHeightAllMatchesR.length > 0) {
                    let totalRatioR = parseFloat(textLineHeightAllMatchesR[textLineHeightAllMatchesR.length - 1][1]);
                    // px 値が倍率欄に混入した異常データ (例 38.061) を浄化。 行間倍率の実用上限は約3
                    if (!isNaN(totalRatioR) && totalRatioR > 10) totalRatioR = 1.5;
                    if (!isNaN(totalRatioR) && totalRatioR > 0) {
                        currentLineHeight = totalRatioR;
                        tabFormatState.height = String(totalRatioR - 1); // 総合比率→ギャップ率
                    }
                    paragraphContent = paragraphContent.replace(/<text\s+line-height="[^"]*"[^>]*\/>/gi, '');
                }
                // <tab-format> 経由で tabFormatState.height が 0 にリセットされていた場合は currentLineHeight から復元
                if (currentLineHeight !== null && tabFormatState.height === '0') {
                    tabFormatState.height = String(currentLineHeight - 1);
                }

                // 行頭禁則指定付箋 (BTRON 2.4.8): 出現行から次の同種付箋まで継続
                const lineHeadKinsokuResult = this._processLineKinsoku(paragraphContent, 'line-head-kinsoku', currentLineHeadKinsoku);
                paragraphContent = lineHeadKinsokuResult.content;
                currentLineHeadKinsoku = lineHeadKinsokuResult.state;
                // 行末禁則指定付箋 (BTRON 2.4.9)
                const lineTailKinsokuResult = this._processLineKinsoku(paragraphContent, 'line-tail-kinsoku', currentLineTailKinsoku);
                paragraphContent = lineTailKinsokuResult.content;
                currentLineTailKinsoku = lineTailKinsokuResult.state;
                // 段落 CSS に kinsoku の line-break/word-break を反映
                style += this._buildKinsokuCss(currentLineHeadKinsoku, currentLineTailKinsoku);

                // <indent/>タグを処理 (BTRON 仕様: 段落内 1 個のみ、 タブ書式 indent との合成式で text-indent を構築)
                // 継承段落パスは tadUnitToPxR (文字幅単位) を使用
                ({ paragraphContent, style } = await this._processIndentTag(paragraphContent, style, tabFormatState, tadUnitToPxR));

                // その他の<text>タグを削除
                paragraphContent = paragraphContent.replace(/<text[^>]*\/>/gi, '');
                paragraphContent = paragraphContent.replace(/<text[^>]*>/gi, '').replace(/<\/text>/gi, '');

                // タグ間の余分な空白・改行を正規化
                paragraphContent = paragraphContent.replace(/>\s+</g, '><');

                // インライン<font>タグをHTMLに変換（textStyleStateを渡して段落間で状態を引き継ぐ）
                paragraphContent = await this.convertDecorationTagsToHTML(paragraphContent, textStyleState);

                // line-heightを最大フォントサイズに基づいて設定
                // heightはギャップ率（例: 0.75）、総合比率は 1 + height（例: 1.75）
                // SCALE型 abs: プレフィックスは絶対モード
                const heightStrR = tabFormatState.height;
                const isHeightAbsR = typeof heightStrR === 'string' && heightStrR.startsWith('abs:');
                const heightValueR = parseFloat(isHeightAbsR ? heightStrR.slice(4) : heightStrR);
                const vunitToPxHR = Math.abs(window.DPI / this.docScale.vunit);
                let lineHeight;
                if (isHeightAbsR && heightValueR > 0) {
                    lineHeight = heightValueR * vunitToPxHR;
                } else if (heightValueR > 0) {
                    lineHeight = (1 + heightValueR) * window.convertPtToPx(maxFontSize);
                } else {
                    lineHeight = window.convertPtToPx(maxFontSize) * 1.5;
                }
                style += `line-height: ${lineHeight}px;`;

                // 空の段落（XMLソースの整形による改行のみの段落）はスキップ
                // v2: data-tab-format-explicit 属性は撤回 (通常経路と同じ理由)
                if (paragraphContent.trim()) {
                    const tabFormatJsonR = JSON.stringify(tabFormatState);
                    // Phase ζ-4: 残り段落でも pending paper/docmargin があれば hidden-paper-change span を挿入
                    let paperChangePrefix = '';
                    if (pendingPaperAttrs !== null || pendingDocmarginAttrs !== null) {
                        const safePaperAttrs = (pendingPaperAttrs || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                        const safeDocmarginAttrs = (pendingDocmarginAttrs || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                        paperChangePrefix = `<span class="hidden-paper-change" data-paper-attrs="${safePaperAttrs}" data-docmargin-attrs="${safeDocmarginAttrs}" style="display:none"></span>`;
                        pendingPaperAttrs = null;
                        pendingDocmarginAttrs = null;
                    }
                    htmlContent += paperChangePrefix + `<p style="${style}" data-tab-format='${tabFormatJsonR}'>${paragraphContent}</p>`;
                }
            }

            // プレースホルダをdiv.figure-segment + iframeに置換
            figureBlocks.forEach((figureXml, index) => {
                const tmpParser = new DOMParser();
                const tmpDoc = tmpParser.parseFromString(`<tad>${figureXml}</tad>`, 'text/xml');

                // <figure>が実際の図形描画要素を含むか検証
                // <document>のみの<figure>（テキストボックスのみ）はテキストとして展開
                // 注: TS_TRANSFORM など座標情報を持つ全ての描画要素を網羅すること
                const figure = tmpDoc.querySelector('figure');
                const hasDrawingElements = figure && figure.querySelector(
                    'rect, ellipse, polyline, polygon, line, arc, chord, elliptical_arc, curve, spline, group, image, pixelmap, marker, transform'
                );
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
                const figScaleElem = tmpDoc.querySelector('figScale');
                let scaleX = 1, scaleY = 1;
                const CANVAS_DPI = 96;
                if (figScaleElem) {
                    const hunit = parseFloat(figScaleElem.getAttribute('hunit')) || 0;
                    const vunit = parseFloat(figScaleElem.getAttribute('vunit')) || 0;
                    scaleX = hunit === 0 ? 1 : (hunit < 0 ? CANVAS_DPI / Math.abs(hunit) : hunit);
                    scaleY = vunit === 0 ? 1 : (vunit < 0 ? CANVAS_DPI / Math.abs(vunit) : vunit);
                }
                const fWidthUnits = figView ? (parseInt(figView.getAttribute('right')) - parseInt(figView.getAttribute('left'))) : 200;
                const fHeightUnits = figView ? (parseInt(figView.getAttribute('bottom')) - parseInt(figView.getAttribute('top'))) : 200;
                // figScale を適用してピクセル単位に変換
                const fWidth = Math.ceil(fWidthUnits * scaleX);
                const fHeight = Math.ceil(fHeightUnits * scaleY);
                const encoded = btoa(unescape(encodeURIComponent(figureXml)));
                const frameInfo = frameOpenMap[index];
                const defaultStyle = `display: block; margin: 4px 0; width: ${fWidth}px; height: ${fHeight}px;`;
                const containerStyle = frameInfo ? this._buildFrameOpenStyle(frameInfo, fWidth, fHeight) : defaultStyle;
                const frameInfoAttr = frameInfo ? ` data-frame-info='${JSON.stringify(frameInfo)}'` : '';
                htmlContent = htmlContent.replace(`__FIGURE_PLACEHOLDER_${index}__`,
                    `<div class="figure-segment" contenteditable="false" data-figure-xmltad="${encoded}"${frameInfoAttr} style="${containerStyle}">` +
                    `<iframe src="../../plugins/basic-figure-editor/index.html?embedded=true" style="width: ${fWidth}px; height: ${fHeight}px; border: none; pointer-events: none;"></iframe></div>`
                );
            });

            // returnHtmlモードではHTMLを返して終了（editor.innerHTML書き換え・後処理はスキップ）
            if (returnHtml) {
                return htmlContent || '';
            }

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
                this.editor.innerHTML = '<p><br data-filler="1"></p>';
            }

            // タブ書式 tab-size を editor 全体に設定 (CSS 継承で全段落にカスケード反映)
            // BTRON 仕様: タブ書式付箋は「次の付箋まで継続適用」 → 個別段落の inline style が空でも継承段落が同じタブ幅になるよう CSS 継承を活用
            // 段落個別の inline style.tabSize は引き続き出力 (個別タブ書式付箋の段落で優先される)
            if (tabFormatState.tabs && tabFormatState.tabs.length > 0) {
                const finalUnitToPx = Math.abs(window.DPI / this.docScale.hunit);
                const finalTabSize = tabFormatState.tabs[0] * finalUnitToPx;
                if (finalTabSize > 0) {
                    this.editor.style.tabSize = finalTabSize + 'px';
                    this.editor.style.MozTabSize = finalTabSize + 'px';
                }
            } else {
                this.editor.style.tabSize = '';
                this.editor.style.MozTabSize = '';
            }

            // 詳細モード装飾オーバーレイの再アタッチ + 再構築
            if (this._refreshDecorationOverlay) {
                this._refreshDecorationOverlay();
            }

            // 字下げ anchor 段落: padding 適用後のタブストップ移動を実測で補正 (タブ含有段落の位置ずれ対策)
            if (!returnHtml) {
                this._realignIndentAnchors();
            }

            // セーフティ検証: XML 内 <link> 数と DOM 内 virtual-object 数を比較 (累積データ消失の早期検知)
            if (!returnHtml) {
                const xmlLinkCount = (tadXML.match(/<link\s/g) || []).length;
                const domLinkCount = this.editor.querySelectorAll('.virtual-object').length;
                const domLinksWithoutId = this.editor.querySelectorAll('.virtual-object:not([data-link-id])').length;
                if (xmlLinkCount !== domLinkCount) {
                    logger.error(`[EDITOR] ★警告: renderTADXML 後の link 数不一致: XML <link>=${xmlLinkCount}, DOM virtual-object=${domLinkCount} (linkId欠落=${domLinksWithoutId})`);
                } else if (xmlLinkCount > 0) {
                    logger.debug(`[EDITOR] renderTADXML 完了: link 数 OK (XML=${xmlLinkCount}, DOM=${domLinkCount}, linkId欠落=${domLinksWithoutId})`);
                }
            }

            // viewMode は呼出側 (loadFile / viewDetailedMode / viewXMLMode / viewFormattedMode) が責務として制御するため、 ここでは上書きしない
        } catch (error) {
            logger.error('[EDITOR] XML描画エラー:', error);
            if (returnHtml) {
                return '';
            }
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

        // viewMode は呼出側が責務として制御するため、 ここでは上書きしない
    }

    _emitFillLineSpacer() {
        return '<div class="fl-spacer" style="min-height:1em;"></div>';
    }

    _buildCharLayoutSpan(kind, widthStr, content) {
        const kindNum = parseInt(kind, 10);
        const alignMap = ['left', 'right', 'center', 'justify', 'justify'];
        const align = alignMap[kindNum] || 'left';
        const alignLast = (kindNum === 3 || kindNum === 4) ? 'text-align-last: justify;' : '';
        let widthCss = '';
        if (widthStr.startsWith('abs:')) {
            const n = parseFloat(widthStr.slice(4));
            const h = Number((this.docScale && this.docScale.hunit) || 0);
            const f = h === 0 ? 1 : (h < 0 ? 96 / Math.abs(h) : h);
            widthCss = 'width: ' + Math.ceil(n * f) + 'px;';
        } else {
            const m2 = widthStr.match(/^(\d+)\/(\d+)$/);
            if (m2) {
                const b = parseInt(m2[2], 10);
                const ratio = b === 0 ? 1 : parseInt(m2[1], 10) / b;
                widthCss = 'width: ' + ratio + 'em;';
            }
        }
        return '<span class="char-layout" data-kind="' + kind + '" data-width="' + widthStr + '" style="display: inline-block; text-align: ' + align + '; ' + alignLast + ' ' + widthCss + '">' + content + '</span>';
    }

    _buildFixedSpaceSpan(widthStr) {
        let widthCss = 'width: 1em;';
        if (widthStr.startsWith('abs:')) {
            const n = parseFloat(widthStr.slice(4));
            const h = Number((this.docScale && this.docScale.hunit) || 0);
            const f = h === 0 ? 1 : (h < 0 ? 96 / Math.abs(h) : h);
            widthCss = 'width: ' + Math.ceil(n * f) + 'px;';
        } else {
            const m2 = widthStr.match(/^(\d+)\/(\d+)$/);
            if (m2) {
                const b = parseInt(m2[2], 10);
                const ratio = b === 0 ? 1 : parseInt(m2[1], 10) / b;
                widthCss = 'width: ' + ratio + 'em;';
            }
        }
        return '<span class="fixed-space" data-width="' + widthStr + '" style="display: inline-block; ' + widthCss + '">&#8203;</span>';
    }

    _buildBoutenSpan(side, kind, content) {
        const kindNum = parseInt(kind, 10);
        const styleMap = ['dot', 'sesame', 'circle', 'triangle'];
        const emStyle = styleMap[kindNum] || 'dot';
        const pos = side === 'lower' ? 'under' : 'over';
        const css = 'text-emphasis-style: filled ' + emStyle + '; text-emphasis-position: ' + pos + '; -webkit-text-emphasis-style: filled ' + emStyle + '; -webkit-text-emphasis-position: ' + pos + ';';
        return '<span class="bouten" data-bouten-side="' + side + '" data-bouten-kind="' + kind + '" style="' + css + '">' + content + '</span>';
    }

    _buildPageNumberSpan(step, num) {
        const numStr = String(num).replace(/[<>&"']/g, '');
        const stepStr = String(step).replace(/[<>&"']/g, '');
        return '<span class="page-number" data-step="' + stepStr + '" data-num="' + numStr + '" style="display: inline-block;">' + numStr + '</span>';
    }

    _buildDocmemoSpan(text) {
        return '<span class="docmemo" data-memo="' + text + '" style="color: #888; font-style: italic;" title="文章メモ">' + text + '</span>';
    }

    /**
     * Phase 3-B: 通常段落と残り段落で重複していた <tab-format> → ルーラー HTML 置換ロジックの共通関数。
     * v2 修正: isDetailedMode=false でもタグを「削除」 ではなく「hidden-tab-format span に変換」 する。
     *   理由: シリアライザは v2 で ruler/hidden-tab-format span を SSOT とする設計。
     *         清書モードで <tab-format> を削除すると、 シリアライズ時に <tab-format> 情報が失われラウンドトリップ不成立。
     *         hidden span として DOM 上に保持することで、 「清書モードで開く → そのまま保存」 でも情報が維持される。
     * isDetailedMode=true なら各 <tab-format> ごとに個別 state でルーラー UI を挿入する (BTRON 後勝ち継承で複数 ruler 個別化)。
     */
    _replaceTabFormatTagsWithRuler(paragraphContent, tadUnitToPx, isDetailedMode) {
        if (isDetailedMode) {
            return paragraphContent.replace(/<tab-format\s+([^>]*)\/>/gi, (m, ta) => {
                const localState = this._parseTabFormatAttrs(ta);
                return this._buildDetailTabFormatRuler(localState, tadUnitToPx, ta);
            });
        }
        // 清書/原稿モード: <tab-format> を非表示 span として段落に保持 (ラウンドトリップ用)
        return paragraphContent.replace(/<tab-format\s+([^>]*)\/>/gi, (m, ta) => {
            const safeAttrs = String(ta || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            return `<span class="hidden-tab-format" data-tab-attrs="${safeAttrs}" style="display:none"></span>`;
        });
    }

    _buildDocoverlaySpan(attrs) {
        // 用紙オーバーレイ (FFA0 SubID 0x03/0x04) - 編集表示はせず data 属性で属性を保持し保存時に復元
        const escaped = String(attrs || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        return '<span class="doc-overlay" data-overlay-attrs="' + escaped + '" style="display:none;"></span>';
    }

    /**
     * 用紙オーバーレイ定義付箋 (FFA0 SubID 0x03) のラウンドトリップ用 hidden span を生成
     * 中身の文章 TAD データは Base64 でエンコードして data-content-b64 属性に退避
     */
    _buildPaperOverlayDefinePreservedSpan(attrs, content) {
        // Base64 で UTF-8 安全なエンコード
        let base64Content = '';
        try {
            base64Content = btoa(unescape(encodeURIComponent(content || '')));
        } catch (e) {
            base64Content = '';
        }
        const safeAttrs = String(attrs || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        return '<span class="paper-overlay-define-preserved" data-attrs="' + safeAttrs + '" data-content-b64="' + base64Content + '" style="display:none;"></span>';
    }

    /**
     * 行頭/行末禁則指定付箋 (BTRON 2.4.8/2.4.9) を段落から抽出し、 hidden span に置き換える
     * @param {string} paragraphContent - 段落の生 XML 内容
     * @param {string} tagName - 'line-head-kinsoku' または 'line-tail-kinsoku'
     * @param {Object|null} currentState - 現在の継承 state ({ kind, ch } または null)
     * @returns {{ content: string, state: Object|null }} 更新後の段落内容と継承 state
     */
    _processLineKinsoku(paragraphContent, tagName, currentState) {
        const regex = new RegExp(`<${tagName}\\s+([^>]*)/>`, 'gi');
        const matches = [...paragraphContent.matchAll(regex)];
        if (matches.length === 0) {
            return { content: paragraphContent, state: currentState };
        }
        // BTRON 後勝ち: 段落内に複数あれば最後の値を採用
        const lastAttrs = matches[matches.length - 1][1];
        const kindMatch = /kind="([^"]*)"/.exec(lastAttrs);
        const chMatch = /ch="([^"]*)"/.exec(lastAttrs);
        const newState = {
            kind: kindMatch ? kindMatch[1] : '0x10',
            ch: chMatch ? chMatch[1] : ''
        };
        // hidden span に置き換え (ラウンドトリップ用 SSOT)
        const className = (tagName === 'line-head-kinsoku') ? 'hidden-line-head-kinsoku' : 'hidden-line-tail-kinsoku';
        const safeAttrs = String(lastAttrs || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const replacement = `<span class="${className}" data-attrs="${safeAttrs}" style="display:none"></span>`;
        // 段落内のすべての <line-head-kinsoku>/<line-tail-kinsoku> を一括削除し、 段落先頭に hidden span を 1 つ挿入
        const content = paragraphContent.replace(regex, '');
        return { content: replacement + content, state: newState };
    }

    /**
     * 行頭/行末禁則 state から CSS (line-break / word-break) を生成
     * BTRON 仕様の追い出し/追い込み/ぶら下がりは構造的に困難なため簡易近似
     */
    _buildKinsokuCss(headState, tailState) {
        let css = '';
        // 行頭禁則の K (上位 4 bit) を取り出す
        const getK = (state) => {
            if (!state || !state.kind) return null;
            const num = parseInt(state.kind, 16);
            if (isNaN(num)) return null;
            return (num >> 4) & 0xF;
        };
        const headK = getK(headState);
        const tailK = getK(tailState);
        // K=0 禁則なし、 K=1 追い出し (標準)、 K=2 追い込み (緩い)、 K=3 ぶら下がり (厳格)、 K=15 アプリ依存
        if (headK === 0 && tailK === 0) {
            css += 'line-break: anywhere;';
        } else if (headK === 2 || tailK === 2) {
            css += 'line-break: loose;';
        } else if (headK === 1 || tailK === 1 || headK === 3 || tailK === 3) {
            css += 'line-break: strict;word-break: keep-all;';
        }
        return css;
    }

    /**
     * 詳細モード時のタブ書式指定付箋を、 ルーラー (定規) 風 UI として HTML 化する。
     * 文頭位置 / 行頭位置 / 行末位置 / タブ位置 / 基準位置 切替 / 段落間隔 のマーカーを配置し、
     * 数値メモリ (5, 10, 15... TAD 単位) を背景表示する。
     * 各マーカーは絶対配置 (left: px) で配置し、 後段 editor.js でドラッグ可能化される。
     */
    /**
     * <tab-format> タグの属性文字列を個別のオブジェクトにパースする
     * 同じ段落内に複数の <tab-format> がある時、 各 ruler を「自分の」 値で描画するために使用
     */
    // 文字幅単位 ↔ hunit 単位 変換
    // - 文字幅 (1 cw = CHAR_UNIT_PX): ユーザー入力 / ruler 表示の単位
    // - hunit (1 hu = DPI / |docScale.hunit| px): BTRON xtad ファイル / CSS 計算の単位
    _charWidthToHunit(cw) {
        if (!cw) return 0;
        const hunit = (this.docScale && this.docScale.hunit) || -120;
        const hunitToPx = Math.abs(window.DPI / hunit);
        return Math.round(cw * window.CHAR_UNIT_PX / hunitToPx);
    }

    _hunitToCharWidth(hu) {
        if (!hu) return 0;
        const hunit = (this.docScale && this.docScale.hunit) || -120;
        const hunitToPx = Math.abs(window.DPI / hunit);
        return hu * hunitToPx / window.CHAR_UNIT_PX;
    }

    _parseTabFormatAttrs(attrs) {
        const rMatch = /R="([^"]*)"/.exec(attrs);
        const pMatch = /P="([^"]*)"/.exec(attrs);
        const heightMatch = /height="([^"]*)"/.exec(attrs);
        const pargapMatch = /pargap="([^"]*)"/.exec(attrs);
        const leftMatch = /left="([^"]*)"/.exec(attrs);
        const rightMatch = /right="([^"]*)"/.exec(attrs);
        const indentMatch = /indent="([^"]*)"/.exec(attrs);
        const ntabsMatch = /ntabs="([^"]*)"/.exec(attrs);
        // \b で単語境界を明示しないと「ntabs」 の末尾「tabs」 にも誤マッチして「tabs="1"」 を返してしまう
        const tabsMatch = /\btabs="([^"]*)"/.exec(attrs);
        const state = {
            R: rMatch ? parseInt(rMatch[1]) || 0 : 0,
            P: pMatch ? parseInt(pMatch[1]) || 0 : 0,
            height: heightMatch ? heightMatch[1] : '0',
            pargap: pargapMatch ? pargapMatch[1] : '0.75',
            left: leftMatch ? parseInt(leftMatch[1]) || 0 : 0,
            right: rightMatch ? parseInt(rightMatch[1]) || 0 : 0,
            indent: indentMatch ? parseInt(indentMatch[1]) || 0 : 0,
            ntabs: ntabsMatch ? parseInt(ntabsMatch[1]) || 0 : 0,
            tabs: [],
            tabsDecimalAlign: []
        };
        if (state.ntabs > 0 && tabsMatch && tabsMatch[1]) {
            const tabRaw = tabsMatch[1].split(',').map(Number);
            state.tabs = tabRaw.map(n => Math.abs(n));
            state.tabsDecimalAlign = tabRaw.map(n => n < 0);
        }
        return state;
    }

    _buildDetailTabFormatRuler(state, tadUnitToPx, rawAttrs) {
        const safeAttrs = String(rawAttrs || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        // state.left/right/indent/tabs は hunit 単位 (XML から直接読み込んだまま)
        // ruler 表示は文字幅単位なので、 ここで hunit → 文字幅に変換して data-x に格納
        // (data-tab-attrs の rawAttrs は hunit のまま保持される → ラウンドトリップ整合)
        const indent = this._hunitToCharWidth(Number(state.indent) || 0);
        const left = this._hunitToCharWidth(Number(state.left) || 0);
        const right = this._hunitToCharWidth(Number(state.right) || 0);
        const R = Number(state.R) || 0;
        const tabsHunit = Array.isArray(state.tabs) ? state.tabs : [];
        const tabs = tabsHunit.map(t => this._hunitToCharWidth(t));
        const tabsDA = Array.isArray(state.tabsDecimalAlign) ? state.tabsDecimalAlign : [];
        // ドラッグで更新されない属性 (P / height / pargap) はルーラの data-* に控えておき、
        // _updateTabFormatAttrs が data-tab-attrs を再構築する時にこれらをマージする
        const tabP = state.P !== undefined && state.P !== null ? state.P : 0;
        const tabHeight = state.height !== undefined && state.height !== null ? String(state.height) : '0';
        const tabPargap = state.pargap !== undefined && state.pargap !== null ? String(state.pargap) : '0.75';

        const px = (v) => Math.round(Number(v) * tadUnitToPx);
        const parts = [];

        // ルーラーは <span> を使う ( <p> 内の block 要素は HTML パーサが段落を強制的に閉じてしまうため)
        // span に display:block を CSS で適用しても、 HTML 構造上は段落内に残るので closest('p') が機能する
        // CSS variable に段落の margin/indent (px) を渡してルーラ幅を container 全体まで延長し、 マーカー位置を計算
        const mlPx = px(left);
        const mrPx = px(right);
        const indentPx = px(indent);
        const rulerStyle = '--ml-px: ' + mlPx + 'px; --mr-px: ' + mrPx + 'px; --indent-px: ' + indentPx + 'px;';
        const safeHeight = String(tabHeight).replace(/"/g, '&quot;');
        const safePargap = String(tabPargap).replace(/"/g, '&quot;');
        parts.push('<span class="detail-tab-format" data-tab-attrs="' + safeAttrs + '" data-tab-p="' + tabP + '" data-tab-height="' + safeHeight + '" data-tab-pargap="' + safePargap + '" data-unit-px="' + tadUnitToPx + '" style="' + rulerStyle + '" contenteditable="false">');
        parts.push('<span class="detail-tab-format-bar">');

        // 基準位置切替 (絶対 / 相対) - マニュアル風シンボル
        const originSym = R === 0 ? '|' : '>';
        parts.push('<span class="detail-tab-origin" data-origin="' + R + '" title="基準位置 (絶対=用紙左端 / 相対=直前の行頭)">' + originSym + '</span>');

        // メモリ (背景目盛り): 細線 1 単位毎、 太線 5 単位毎
        // 起点をマーカーと揃えるため --ml-px 分左にオフセット
        parts.push('<span class="detail-tab-format-scale" style="--unit-px: ' + tadUnitToPx + 'px;"></span>');

        // 数値ラベル: ↓ マーカーと完全に同じ unitPx (tadUnitToPx) と --ml-px で配置
        // ↓ マーカー位置 = calc(--ml-px + 4*unitPx) → ラベル「5」 = calc(--ml-px + 5*unitPx)
        // 差 = 1 unit = 細線 1 本ぶん。 これで「↓ = 線4本目、 5 ラベル = 線5本目」 が成立
        const approxMaxUnit = Math.max(50, Math.ceil(left + right + (tabs.length > 0 ? Math.max(...tabs) : 0) + 50));
        const numbersParts = ['<span class="detail-tab-format-numbers">'];
        for (let n = 5; n <= approxMaxUnit; n += 5) {
            const nPx = Math.round(n * tadUnitToPx);
            numbersParts.push('<span class="detail-tab-number" style="left: calc(var(--ml-px, 0px) + ' + nPx + 'px);">' + n + '</span>');
        }
        numbersParts.push('</span>');
        parts.push(numbersParts.join(''));

        // SVG シンボル定義 (BTRON マニュアル準拠の見た目)
        // 文頭位置: 左に旗竿 + 上に横棒 + 中央に右向き塗りつぶし直角三角形
        const svgFhead = '<svg viewBox="0 0 14 18" width="14" height="18" style="display:block;pointer-events:none"><line x1="3" y1="2" x2="3" y2="16" stroke="currentColor" stroke-width="2" stroke-linecap="square"/><line x1="3" y1="2" x2="12" y2="2" stroke="currentColor" stroke-width="2" stroke-linecap="square"/><polygon points="3,7 3,13 12,10" fill="currentColor"/></svg>';
        // 行頭位置: 左に旗竿 + 右上に塗りつぶし直角三角形 (旗が右へ展開)
        const svgLhead = '<svg viewBox="0 0 14 18" width="14" height="18" style="display:block;pointer-events:none"><line x1="3" y1="2" x2="3" y2="16" stroke="currentColor" stroke-width="2" stroke-linecap="square"/><polygon points="3,2 3,9 12,2" fill="currentColor"/></svg>';
        // 行末位置: 右に旗竿 + 左上に塗りつぶし直角三角形 (旗が左へ展開)
        const svgLend = '<svg viewBox="0 0 14 18" width="14" height="18" style="display:block;pointer-events:none"><line x1="11" y1="2" x2="11" y2="16" stroke="currentColor" stroke-width="2" stroke-linecap="square"/><polygon points="11,2 11,9 2,2" fill="currentColor"/></svg>';

        // ルーラは container 全体に延長されているため、 マーカーは「ルーラ左端 + ml + offset」の位置に配置する
        // F (文頭): ml + indent
        parts.push('<span class="detail-tab-marker detail-tab-marker-fhead" data-kind="fhead" data-x="' + indent + '" style="left: calc(var(--ml-px, 0px) + ' + indentPx + 'px);" title="文頭位置">' + svgFhead + '</span>');

        // L (行頭): ml
        parts.push('<span class="detail-tab-marker detail-tab-marker-lhead" data-kind="lhead" data-x="' + left + '" style="left: var(--ml-px, 0px);" title="行頭位置">' + svgLhead + '</span>');

        // J (行末): mr (右からの距離)
        parts.push('<span class="detail-tab-marker detail-tab-marker-lend" data-kind="lend" data-x="' + right + '" style="right: var(--mr-px, 0px); left: auto;" title="行末位置">' + svgLend + '</span>');

        // タブ位置 (▼): ml + tabs[i]
        for (let i = 0; i < tabs.length; i++) {
            const tx = tabs[i];
            const txPx = px(tx);
            const da = tabsDA[i] ? ' detail-tab-marker-tab-decimal' : '';
            parts.push('<span class="detail-tab-marker detail-tab-marker-tab' + da + '" data-kind="tab" data-idx="' + i + '" data-x="' + tx + '" style="left: calc(var(--ml-px, 0px) + ' + txPx + 'px);" title="タブ位置">' + (tabsDA[i] ? '.' : '↓') + '</span>');
        }

        parts.push('</span>');
        parts.push('</span>');
        return parts.join('');
    }

    _buildFieldFormatBlock(attrs, inner) {
        // フィールド書式 (FFA1 SubID 0x03) - 表形式の簡易表示、 attrs/inner を data 属性で保持
        const escapedAttrs = String(attrs || '').replace(/"/g, '&quot;');
        const fields = [];
        const reField = /<field\s+([^>]*?)\/>/gi;
        let m;
        while ((m = reField.exec(inner)) !== null) {
            const fieldAttrs = String(m[1] || '').replace(/"/g, '&quot;');
            fields.push('<span class="field" data-field-attrs="' + fieldAttrs + '" style="display: inline-block; border: 1px dotted #888; padding: 0 4px; min-width: 2em;">&nbsp;</span>');
        }
        return '<div class="field-format" data-format-attrs="' + escapedAttrs + '" style="display: inline-flex; gap: 0; margin: 0.2em 0; border: 1px solid #ccc;">' + fields.join('') + '</div>';
    }

    _applyColumnSetting(xmlDoc, returnHtml) {
        if (returnHtml || !this.editor) return;
        const cols = xmlDoc.querySelectorAll('column');
        if (cols.length === 0) return;
        const col = cols[0];
        const columnCount = parseInt(col.getAttribute('column') || '0', 10);
        if (columnCount < 2) return;
        const colsp = parseFloat(col.getAttribute('colsp') || '0');
        const balance = col.getAttribute('balance') || '0';
        const h = Number((this.docScale && this.docScale.hunit) || 0);
        const f = h === 0 ? 1 : (h < 0 ? 96 / Math.abs(h) : h);
        const colspPx = Math.ceil(colsp * f);
        this.editor.style.columnCount = String(columnCount);
        this.editor.style.columnGap = `${colspPx}px`;
        this.editor.style.columnFill = balance === '1' ? 'balance' : 'auto';
        const lineWidth = parseInt(col.getAttribute('lineWidth') || '0', 10);
        if (lineWidth > 0) this.editor.style.columnRule = `${lineWidth}px solid #000`;
    }

    _extractFrameOpens(xml, mapOut) {
        const re = /<frame-open([^>]*)\/>\s*__FIGURE_PLACEHOLDER_(\d+)__/gi;
        return xml.replace(re, (m, attrs, idxStr) => {
            const idx = parseInt(idxStr, 10);
            mapOut[idx] = this._parseFrameOpenAttrs(attrs);
            return `__FIGURE_PLACEHOLDER_${idxStr}__`;
        });
    }

    _parseFrameOpenAttrs(attrs) {
        const result = {};
        const names = ['abs','halign','valign','page','wrap','top','left','bottom','right'];
        for (const name of names) {
            const ar = attrs.match(new RegExp(name + '="(-?\\d+)"'));
            result[name] = ar ? parseInt(ar[1], 10) : 0;
        }
        return result;
    }

    _buildFrameOpenStyle(frameInfo, fallbackW, fallbackH) {
        const hu = this.docScale && this.docScale.hunit ? Number(this.docScale.hunit) : -72;
        const vu = this.docScale && this.docScale.vunit ? Number(this.docScale.vunit) : -72;
        const hToPx = hu === 0 ? 1 : (hu < 0 ? 96 / Math.abs(hu) : 1 / hu);
        const vToPx = vu === 0 ? 1 : (vu < 0 ? 96 / Math.abs(vu) : 1 / vu);
        const fw = Math.ceil((frameInfo.right - frameInfo.left + 1) * hToPx);
        const fh = Math.ceil((frameInfo.bottom - frameInfo.top + 1) * vToPx);
        if (frameInfo.abs === 1) {
            const px = Math.ceil(frameInfo.left * hToPx);
            const py = Math.ceil(frameInfo.top * vToPx);
            return `position: absolute; left: ${px}px; top: ${py}px; width: ${fw}px; height: ${fh}px; overflow: hidden;`;
        }
        let floatDir = 'none', marginRule = '0.5em auto';
        if (frameInfo.valign === 1) { floatDir = 'left'; marginRule = '0 1em 0.5em 0'; }
        else if (frameInfo.valign === 3) { floatDir = 'right'; marginRule = '0 0 0.5em 1em'; }
        let extra = '';
        if (frameInfo.wrap === 1) { floatDir = 'none'; extra += ' clear: both;'; }
        if (frameInfo.page === 1) { extra += ' break-inside: avoid; break-before: avoid-page;'; }
        return `float: ${floatDir}; margin: ${marginRule}; width: ${fw}px; height: ${fh}px; overflow: hidden; display: block;${extra}`;
    }

    /**
     * 仮身要素にイベントハンドラを設定
     */
};
