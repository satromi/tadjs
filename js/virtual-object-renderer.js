import {
    convertPtToPx,
    DEFAULT_FRCOL,
    DEFAULT_CHCOL,
    DEFAULT_TBCOL,
    DEFAULT_BGCOL,
    DEFAULT_FONT_SIZE,
    DEFAULT_FONT_FAMILY,
    DEFAULT_FONT_STYLE,
    DEFAULT_FONT_WEIGHT,
    DEFAULT_LINE_HEIGHT,
    DEFAULT_VOBJ_HEIGHT,
    VOBJ_PADDING_VERTICAL,
    VOBJ_TITLEBAR_PADDING_VERTICAL,
    VOBJ_BORDER_WIDTH,
    VOBJ_MIN_OPEN_HEIGHT_OFFSET
} from './util.js';
import { getLogger } from './logger.js';

const logger = getLogger('VirtualObjectRenderer');

/**
 * VirtualObjectRenderer
 * 仮身の描画を統一的に扱うクラス
 * DOM要素とCanvas描画の両方に対応
 *
 * Canvas 描画 API (drawClosedVirtualObjectToCanvas / drawOpenedVirtualObjectToCanvas 等)
 * を呼び出す側は、High-DPI 対応として ctx に対し以下の base transform を適用済みであること:
 *   ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
 * その上で論理 px 座標を渡せば、バッキングストア解像度で物理画素レベルでくっきり描画される。
 * フォントサイズは convertPtToPx() で pt → px (96 DPI) に変換済の値を内部で使用する。
 */
export class VirtualObjectRenderer {
    constructor(options = {}) {
        // デフォルトスタイル設定
        this.defaultStyles = {
            tbcol: DEFAULT_TBCOL,  // タイトル背景色
            frcol: DEFAULT_FRCOL,  // 枠線色
            chcol: DEFAULT_CHCOL,  // 文字色
            bgcol: DEFAULT_BGCOL,  // 背景色
            chsz: DEFAULT_FONT_SIZE // 文字サイズ(pt)
        };

        // オプションでデフォルトスタイルを上書き
        Object.assign(this.defaultStyles, options.defaultStyles || {});

        // Canvas描画用のアイコンキャッシュ (realId -> HTMLImageElement)
        this.iconImageCache = new Map();
    }

    /**
     * 仮身オブジェクトから必要な色・サイズ情報を取得
     * @param {Object} virtualObject - 仮身オブジェクト
     * @param {Object} [options] - オプション (zoomLevel など)
     * @returns {Object} スタイル情報
     */
    getStyles(virtualObject, options = {}) {
        const zoomLevel = options.zoomLevel || 1;
        const chszPt = parseFloat(virtualObject.chsz) || this.defaultStyles.chsz;
        return {
            tbcol: virtualObject.tbcol || this.defaultStyles.tbcol,
            frcol: virtualObject.frcol || this.defaultStyles.frcol,
            chcol: virtualObject.chcol || this.defaultStyles.chcol,
            bgcol: virtualObject.bgcol || this.defaultStyles.bgcol,
            chsz: chszPt,  // ポイント値（後方互換性のため保持）
            chszPx: convertPtToPx(chszPt) * zoomLevel,  // ピクセル値 × zoom (DOM 描画用)
            zoomLevel: zoomLevel
        };
    }

    /**
     * 閉じた仮身の natural-height (chsz から導出する canonical な高さ、logical 単位、zoom 非依存)
     * = max(iconSize, ceil(chszPx * lineHeight)) + VOBJ_BORDER_WIDTH
     * Parser/Serializer/bbox 計算から参照される基準値。padding は含まない。
     * @param {number} chszPt - 文字サイズ (pt)
     * @returns {number} natural-height (logical px)
     */
    getNaturalClosedVobjHeight(chszPt) {
        const chsz = parseFloat(chszPt) || this.defaultStyles.chsz;
        const chszPx = convertPtToPx(chsz);
        const iconSize = Math.round(chszPx);
        const textHeight = Math.ceil(chszPx * DEFAULT_LINE_HEIGHT);
        const contentHeight = Math.max(iconSize, textHeight);
        return contentHeight + VOBJ_BORDER_WIDTH;
    }

    /**
     * 仮身のサイズを計算
     * @param {Object} virtualObject - 仮身オブジェクト
     * @param {string} mode - 'closed' | 'opened'
     * @returns {Object} { width, height }
     */
    calculateSize(virtualObject, mode = 'closed') {
        const styles = this.getStyles(virtualObject);
        const padding = VOBJ_PADDING_VERTICAL;  // 上下左右のパディング
        const border = VOBJ_BORDER_WIDTH;   // 枠線の太さ

        if (mode === 'closed') {
            // 閉じた仮身のデフォルトサイズ
            const width = virtualObject.width || 100;
            const height = styles.chszPx + padding + border;
            return { width, height };
        } else if (mode === 'opened') {
            // 開いた仮身のサイズ
            const width = virtualObject.width || 200;
            const height = virtualObject.heightPx || 150;
            return { width, height };
        }

        return { width: 100, height: DEFAULT_VOBJ_HEIGHT };
    }

    /**
     * アイコンをキャッシュに読み込む（Canvas描画用）
     * @param {string} realId - 実身ID
     * @param {string} base64Data - base64エンコードされたアイコンデータ
     * @returns {Promise<HTMLImageElement>} 読み込まれたImage要素
     */
    loadIconToCache(realId, base64Data) {
        return new Promise((resolve, reject) => {
            // すでにキャッシュにある場合はそれを返す
            if (this.iconImageCache.has(realId)) {
                resolve(this.iconImageCache.get(realId));
                return;
            }

            // 新しいImage要素を作成
            const img = new Image();
            img.onload = () => {
                this.iconImageCache.set(realId, img);
                resolve(img);
            };
            img.onerror = (error) => {
                logger.error('[VirtualObjectRenderer] アイコン読み込みエラー:', realId, error);
                reject(error);
            };
            img.src = `data:image/x-icon;base64,${base64Data}`;
        });
    }

    /**
     * キャッシュからアイコンを取得
     * @param {string} realId - 実身ID
     * @returns {HTMLImageElement|null} キャッシュされたImage要素、なければnull
     */
    getCachedIcon(realId) {
        return this.iconImageCache.get(realId) || null;
    }

    /**
     * アイコン画像要素にソースを設定する共通処理
     * @param {HTMLImageElement} iconImg - アイコン画像要素
     * @param {string} realId - 実身ID
     * @param {Object} options - オプション（iconData, iconBasePath, loadIconCallback）
     */
    _setupIconImage(iconImg, realId, options) {
        if (options.iconData && options.iconData[realId]) {
            iconImg.src = `data:image/x-icon;base64,${options.iconData[realId]}`;
        } else if (options.iconBasePath !== undefined) {
            iconImg.src = `${options.iconBasePath}${realId}.ico`;
        } else if (options.loadIconCallback && typeof options.loadIconCallback === 'function') {
            options.loadIconCallback(realId).then(iconData => {
                if (iconData) {
                    iconImg.src = `data:image/x-icon;base64,${iconData}`;
                }
            }).catch(error => {
                logger.error('[VirtualObjectRenderer] アイコン読み込みエラー:', realId, error);
            });
        }
    }

    /**
     * DOM要素として仮身を作成（基本文章編集用 - インライン表示）
     * @param {Object} virtualObject - 仮身オブジェクト
     * @param {Object} options - オプション
     *   - loadIconCallback: (realId) => Promise<base64Data> アイコン読み込みコールバック
     * @returns {HTMLElement} 仮身要素
     */
    createInlineElement(virtualObject, options = {}) {
        const styles = this.getStyles(virtualObject);
        const vo = document.createElement('span');

        vo.className = 'virtual-object';
        vo.contentEditable = 'false';
        vo.setAttribute('unselectable', 'on');

        // data属性を設定
        this.attachDataAttributes(vo, virtualObject, options.vobjIndex);

        // インラインスタイルを適用
        Object.assign(vo.style, {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            padding: '4px 8px',
            margin: '0 2px',
            background: styles.tbcol,
            border: `1px solid ${styles.frcol}`,
            color: styles.chcol,
            fontSize: `${styles.chszPx}px`,
            lineHeight: '1.2',
            verticalAlign: 'middle',
            cursor: 'pointer',
            userSelect: 'none',
            WebkitUserSelect: 'none',
            MozUserSelect: 'none',
            msUserSelect: 'none',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: '100%',
            boxSizing: 'border-box',
            // 親要素からの文字修飾継承をリセット（仮身は常に通常表示）
            fontStyle: DEFAULT_FONT_STYLE,
            fontWeight: DEFAULT_FONT_WEIGHT,
            textDecoration: 'none',
            WebkitTextStroke: '0'
        });

        // 表示設定
        const showPict = virtualObject.pictdisp !== 'false';
        const showName = virtualObject.namedisp !== 'false';
        const showRole = virtualObject.roledisp === 'true';
        const showType = virtualObject.typedisp === 'true';
        const showUpdate = virtualObject.updatedisp === 'true';

        // ピクトグラム（アイコン）用のスペース確保
        if (showPict) {
            const iconImg = document.createElement('img');
            iconImg.className = 'virtual-object-icon';
            // ポイント値をピクセル値に変換してアイコンサイズを設定
            const iconSize = convertPtToPx(virtualObject.chsz);
            iconImg.style.width = iconSize + 'px';
            iconImg.style.height = iconSize + 'px';
            iconImg.style.objectFit = 'contain';
            iconImg.style.flexShrink = '0';
            // アイコンが読み込めない場合でもスペースを確保するため、透明な背景を設定
            iconImg.style.backgroundColor = 'transparent';

            // link_idから実身IDを抽出
            const realId = virtualObject.link_id.replace(/_\d+\.xtad$/i, '');

            // アイコンを読み込む
            this._setupIconImage(iconImg, realId, options);

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
            nameSpan.style.fontFamily = DEFAULT_FONT_FAMILY;  // 親要素のfont継承を無視してデフォルトフォントを使用
            nameSpan.textContent = virtualObject.link_name || '無題';
            textSpan.appendChild(nameSpan);
        }

        // 続柄（JSON metadataの続柄 + link要素のrelationship属性）
        if (showRole) {
            const jsonRelationship = (virtualObject.metadata && virtualObject.metadata.relationship) || [];
            const linkRelationship = virtualObject.linkRelationship || [];

            if (jsonRelationship.length > 0 || linkRelationship.length > 0) {
                // JSON用は[タグ]形式、link用はそのまま表示
                const parts = [];
                for (const tag of jsonRelationship) {
                    parts.push(`[${tag}]`);
                }
                parts.push(...linkRelationship);

                const relationshipText = parts.join(' ');
                const relationshipSpan = document.createElement('span');
                relationshipSpan.textContent = ' : ' + relationshipText;
                textSpan.appendChild(relationshipSpan);
            }
        }

        // タイプ
        if (showType && virtualObject.applist) {
            let typeName = '';
            for (const [, config] of Object.entries(virtualObject.applist)) {
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
        if (showUpdate && virtualObject.updateDate) {
            const updateDate = new Date(virtualObject.updateDate);
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

        return vo;
    }

    /**
     * DOM要素として仮身を作成（仮身一覧用 - ブロック表示）
     * @param {Object} virtualObject - 仮身オブジェクト
     * @param {Object} options - オプション
     * @returns {HTMLElement} 仮身要素
     */
    createBlockElement(virtualObject, options = {}) {
        const styles = this.getStyles(virtualObject);
        const isOpened = this.isOpenedVirtualObject(virtualObject);

        if (isOpened) {
            return this.createOpenedBlockElement(virtualObject, options);
        } else {
            return this.createClosedBlockElement(virtualObject, options);
        }
    }

    /**
     * 閉じた仮身のブロック要素を作成
     * @param {Object} virtualObject - 仮身オブジェクト
     * @param {Object} options - オプション
     *   - loadIconCallback: (realId) => Promise<base64Data> アイコン読み込みコールバック
     * @returns {HTMLElement} 閉じた仮身要素
     */
    createClosedBlockElement(virtualObject, options = {}) {
        const styles = this.getStyles(virtualObject, options);
        const zoomLevel = options.zoomLevel || 1;
        const vobj = document.createElement('div');

        // 論理単位で計算してから最後にまとめて zoomLevel をかけることで、
        // 内部サイズと外枠サイズの丸め誤差をなくす
        const chszPxLogical = styles.chszPx / zoomLevel; // = convertPtToPx(chsz) (zoom なし)
        const lineHeight = DEFAULT_LINE_HEIGHT;
        const textHeightLogical = Math.ceil(chszPxLogical * lineHeight);
        const iconSizeLogical = Math.round(chszPxLogical * 1.0);
        const contentHeightLogical = Math.max(iconSizeLogical, textHeightLogical);
        // 閉じた仮身の最小高さは BTRON 慣習通り content + padding (border 抜き) で計算
        const minClosedHeightLogical = contentHeightLogical + VOBJ_PADDING_VERTICAL;
        const tadHeightLogical = (virtualObject.vobjbottom || DEFAULT_VOBJ_HEIGHT) - (virtualObject.vobjtop || 0);
        const actualHeightLogical = Math.max(minClosedHeightLogical, tadHeightLogical);

        // ここで zoomLevel (= mixin から渡された effectiveScale = figScale * zoom) を一括適用
        const textHeight = textHeightLogical * zoomLevel;
        const iconSize = iconSizeLogical * zoomLevel;
        const contentHeight = contentHeightLogical * zoomLevel;
        const borderWidth = VOBJ_BORDER_WIDTH * zoomLevel;
        const paddingVertical = VOBJ_PADDING_VERTICAL * zoomLevel;
        const horizontalPadding = 4 * zoomLevel;
        const gapSize = 4 * zoomLevel;
        const actualHeight = actualHeightLogical * zoomLevel;

        vobj.className = 'virtual-object virtual-object-closed';
        vobj.style.position = 'absolute';
        vobj.style.left = (virtualObject.vobjleft || 0) + 'px';
        vobj.style.top = (virtualObject.vobjtop || 0) + 'px';
        vobj.style.width = ((virtualObject.width || 100) * zoomLevel) + 'px';
        vobj.style.height = actualHeight + 'px';
        vobj.style.boxSizing = 'border-box';
        vobj.style.cursor = 'pointer';
        // zoom 適用済みであることを記録 (mixin の zoom 変化検知用)
        vobj.dataset.zoomAtRender = String(zoomLevel);

        // 表示設定
        const showPict = virtualObject.pictdisp !== 'false';
        const showName = virtualObject.namedisp !== 'false';
        const showRole = virtualObject.roledisp === 'true';
        const showType = virtualObject.typedisp === 'true';
        const showUpdate = virtualObject.updatedisp === 'true';
        const showFrame = virtualObject.framedisp !== 'false';

        // 全ての表示属性がオフかどうかを判定
        const showTitleArea = showPict || showName || showRole || showType || showUpdate;

        // タイトル領域の高さは vobj 全体と同じ (= actualHeight)
        // 旧コード: contentHeight + paddingVertical + borderWidth = 33 だが、
        // vobj.style.height (= actualHeight = max(content+padding, tadHeight) = 31) に揃える
        const titleHeight = actualHeight;
        // border 1 辺分 (zoom 反映)
        const borderSide = borderWidth / 2; // VOBJ_BORDER_WIDTH=2 なので 1px 相当 × zoom
        const verticalPadHalf = paddingVertical / 2; // VOBJ_PADDING_VERTICAL=8 なので 4px 相当 × zoom

        // タイトル領域
        const titleArea = document.createElement('div');
        titleArea.style.position = 'absolute';
        titleArea.style.left = '0';
        titleArea.style.top = '0';
        titleArea.style.right = '0';
        titleArea.style.height = titleHeight + 'px'; // 明示的に高さを設定（border除く）
        titleArea.style.boxSizing = 'border-box'; // border を height に含める
        titleArea.style.backgroundColor = styles.tbcol;

        // 仮身枠の表示/非表示 (border 幅は zoom 反映)
        if (showFrame) {
            titleArea.style.borderLeft = `${borderSide}px solid ${styles.frcol}`;
            titleArea.style.borderTop = `${borderSide}px solid ${styles.frcol}`;
            titleArea.style.borderRight = `${borderSide}px solid ${styles.frcol}`;
            titleArea.style.borderBottom = `${borderSide}px solid ${styles.frcol}`;
        }

        titleArea.style.display = showTitleArea ? 'flex' : 'none';
        titleArea.style.alignItems = 'center';
        titleArea.style.paddingTop = verticalPadHalf + 'px';
        titleArea.style.paddingBottom = verticalPadHalf + 'px';
        titleArea.style.paddingLeft = horizontalPadding + 'px';
        titleArea.style.paddingRight = horizontalPadding + 'px';
        titleArea.style.gap = gapSize + 'px';
        titleArea.style.overflow = 'visible'; // アイコンとテキストが切れないように
        titleArea.style.zIndex = '1'; // mainAreaの上に表示

        // ピクトグラム（アイコン）用のスペース確保
        if (showPict) {
            const iconImg = document.createElement('img');
            iconImg.className = 'virtual-object-icon';
            iconImg.style.width = iconSize + 'px';
            iconImg.style.height = iconSize + 'px';
            iconImg.style.objectFit = 'contain';
            iconImg.style.flexShrink = '0'; // アイコンは縮小しない
            // アイコンが読み込めない場合でもスペースを確保するため、透明な背景を設定
            iconImg.style.backgroundColor = 'transparent';
            iconImg.setAttribute('data-element-type', 'icon'); // オーバーフロー判定用

            // link_idから実身IDを抽出（_0.xtadなどを削除）
            const realId = virtualObject.link_id.replace(/_\d+\.xtad$/i, '');

            // アイコンを読み込む
            this._setupIconImage(iconImg, realId, options);

            titleArea.appendChild(iconImg);
        }

        // タイトルテキスト部分
        const titleTextSpan = document.createElement('span');
        titleTextSpan.className = 'virtual-object-title';
        titleTextSpan.style.color = virtualObject.chcol;
        titleTextSpan.style.fontSize = styles.chszPx + 'px';
        titleTextSpan.style.whiteSpace = 'nowrap';
        titleTextSpan.style.overflow = 'hidden';
        titleTextSpan.style.textOverflow = 'ellipsis';
        titleTextSpan.style.lineHeight = String(DEFAULT_LINE_HEIGHT);
        titleTextSpan.style.flex = '1';
        titleTextSpan.style.textDecoration = 'none'; // アンダーラインを防止

        // 名称
        if (showName) {
            const nameSpan = document.createElement('span');
            nameSpan.className = 'virtual-object-name'; // DOM更新用のクラスを追加
            nameSpan.style.fontFamily = DEFAULT_FONT_FAMILY;  // 親要素のfont継承を無視してデフォルトフォントを使用
            nameSpan.textContent = virtualObject.link_name;
            nameSpan.style.textDecoration = 'none'; // アンダーラインを防止
            nameSpan.setAttribute('data-element-type', 'name');
            titleTextSpan.appendChild(nameSpan);
        }

        // 続柄（JSON metadataの続柄 + link要素のrelationship属性）
        if (showRole) {
            const jsonRelationship = (virtualObject.metadata && virtualObject.metadata.relationship) || [];
            const linkRelationship = virtualObject.linkRelationship || [];

            if (jsonRelationship.length > 0 || linkRelationship.length > 0) {
                // JSON用は[タグ]形式、link用はそのまま表示
                const parts = [];
                for (const tag of jsonRelationship) {
                    parts.push(`[${tag}]`);
                }
                parts.push(...linkRelationship);

                const relationshipText = parts.join(' ');
                const relationshipSpan = document.createElement('span');
                relationshipSpan.textContent = ' : ' + relationshipText;
                relationshipSpan.setAttribute('data-element-type', 'relationship');
                titleTextSpan.appendChild(relationshipSpan);
            }
        }

        // タイプ（applistから取得）
        if (showType && virtualObject.applist) {
            // defaultOpenプラグインの名前を取得
            let typeName = '';
            for (const [, config] of Object.entries(virtualObject.applist)) {
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
        if (showUpdate && virtualObject.updateDate) {
            const updateDate = new Date(virtualObject.updateDate);
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

        // メイン領域（閉じた仮身には不要だが、互換性のため残す）
        const mainArea = document.createElement('div');
        mainArea.style.position = 'absolute';
        mainArea.style.left = '0';
        mainArea.style.top = showTitleArea ? titleHeight + 'px' : '0'; // titleAreaの高さと一致させる
        mainArea.style.right = '0';
        mainArea.style.bottom = '0';
        mainArea.style.boxSizing = 'border-box'; // border を height に含める
        mainArea.style.backgroundColor = styles.tbcol;
        mainArea.style.zIndex = '0'; // titleAreaの下に表示

        // 閉じた仮身の場合、mainAreaは表示領域がほとんどないため
        // titleAreaのborderBottomとmainAreaのborderが重なって太く見えるのを防ぐため
        // 閉じた仮身ではmainAreaにborderを設定しない
        // （titleAreaのborderBottomで十分）
        if (showFrame && !showTitleArea) {
            // titleAreaが表示されない場合のみmainAreaにborderを設定 (zoom 反映)
            mainArea.style.border = `${borderSide}px solid ${styles.frcol}`;
        }

        vobj.appendChild(mainArea);

        // data属性を設定
        this.attachDataAttributes(vobj, virtualObject, options.vobjIndex);

        return vobj;
    }

    /**
     * 開いた仮身のブロック要素を作成
     * @param {Object} virtualObject - 仮身オブジェクト
     * @param {Object} options - オプション
     * @returns {HTMLElement} 開いた仮身要素
     */
    createOpenedBlockElement(virtualObject, options = {}) {
        const styles = this.getStyles(virtualObject, options);
        const zoomLevel = options.zoomLevel || 1;
        const vobj = document.createElement('div');

        vobj.className = 'virtual-object virtual-object-opened';
        // 背景化された仮身にはクラスを追加（ホバー表示を無効化するため）
        if (virtualObject.isBackground) {
            vobj.className += ' background-protected';
        }
        vobj.style.position = 'absolute';
        vobj.style.left = (virtualObject.vobjleft || 0) + 'px';
        vobj.style.top = (virtualObject.vobjtop || 0) + 'px';
        // 開いた仮身のサイズも zoom 反映 (mixin が override する場合は上書きされる)
        vobj.style.width = ((virtualObject.width || 200) * zoomLevel) + 'px';
        vobj.style.height = (((virtualObject.vobjbottom || 150) - (virtualObject.vobjtop || 0)) * zoomLevel) + 'px';
        vobj.style.boxSizing = 'border-box';
        vobj.style.cursor = 'pointer';
        // zoom 適用済みであることを記録 (mixin の zoom 変化検知用)
        vobj.dataset.zoomAtRender = String(zoomLevel);

        // 表示設定を取得
        const showFrame = virtualObject.framedisp !== 'false';
        const showPict = virtualObject.pictdisp !== 'false';
        const showName = virtualObject.namedisp !== 'false';
        const showRole = virtualObject.roledisp === 'true';
        const showType = virtualObject.typedisp === 'true';
        const showUpdate = virtualObject.updatedisp === 'true';

        // デバッグログ: 開いた仮身の表示設定を確認
        logger.debug('[VirtualObjectRenderer] 開いた仮身の表示設定:', {
            link_id: virtualObject.link_id,
            link_name: virtualObject.link_name,
            pictdisp: virtualObject.pictdisp,
            namedisp: virtualObject.namedisp,
            roledisp: virtualObject.roledisp,
            typedisp: virtualObject.typedisp,
            updatedisp: virtualObject.updatedisp,
            showPict,
            showName,
            showRole,
            showType,
            showUpdate
        });

        // 全ての表示属性がオフかどうかを判定
        const showTitleBar = showPict || showName || showRole || showType || showUpdate;

        // 外枠 (zoom 反映)
        const borderSideOpen = (VOBJ_BORDER_WIDTH / 2) * zoomLevel; // 1px × zoom
        if (showFrame) {
            vobj.style.border = `${borderSideOpen}px solid ${styles.frcol}`;
        }

        // タイトルバーの高さを計算 (zoom 反映)
        const lineHeight = DEFAULT_LINE_HEIGHT;
        const textHeight = Math.ceil(styles.chszPx * lineHeight);
        const iconSize = Math.round(styles.chszPx * 1.0);
        const contentHeight = Math.max(iconSize, textHeight);
        const paddingVerticalOpen = VOBJ_PADDING_VERTICAL * zoomLevel;  // 開いた仮身は padding 維持
        const titleBarBorderBottom = borderSideOpen; // 1px × zoom
        const titleBarHeight = contentHeight + paddingVerticalOpen + titleBarBorderBottom;
        const titleBarPadH = 8 * zoomLevel;
        const titleBarPadV = 4 * zoomLevel;
        const titleBarGap = 4 * zoomLevel;
        let contentTop = 0;

        if (showTitleBar) {
            const titleBar = document.createElement('div');
            titleBar.className = 'virtual-object-titlebar';
            titleBar.style.position = 'absolute';
            titleBar.style.top = '0';
            titleBar.style.left = '0';
            titleBar.style.right = '0';
            titleBar.style.height = titleBarHeight + 'px';
            titleBar.style.backgroundColor = styles.tbcol;
            // タイトルバー下部境界線 (zoom 反映)
            if (showFrame) {
                titleBar.style.borderBottom = `${titleBarBorderBottom}px solid ${styles.frcol}`;
            }
            titleBar.style.display = 'flex';
            titleBar.style.alignItems = 'center';
            titleBar.style.paddingTop = titleBarPadV + 'px';
            titleBar.style.paddingBottom = titleBarPadV + 'px';
            titleBar.style.paddingLeft = titleBarPadH + 'px';
            titleBar.style.paddingRight = titleBarPadH + 'px';
            titleBar.style.gap = titleBarGap + 'px';
            titleBar.style.boxSizing = 'border-box';
            titleBar.style.overflow = 'hidden';
            titleBar.style.whiteSpace = 'nowrap';

            // ピクトグラム（アイコン）用のスペース確保
            if (showPict) {
                logger.debug('[VirtualObjectRenderer] 開いた仮身のアイコン作成開始:', virtualObject.link_id);
                const iconImg = document.createElement('img');
                iconImg.className = 'virtual-object-icon';
                const iconSize = Math.round(styles.chszPx * 1.0);
                iconImg.style.width = iconSize + 'px';
                iconImg.style.height = iconSize + 'px';
                iconImg.style.objectFit = 'contain';
                iconImg.style.flexShrink = '0'; // アイコンは縮小しない
                // アイコンが読み込めない場合でもスペースを確保するため、透明な背景を設定
                iconImg.style.backgroundColor = 'transparent';

                // link_idから実身IDを抽出（_0.xtadなどを削除）
                const realId = virtualObject.link_id.replace(/_\d+\.xtad$/i, '');
                logger.debug('[VirtualObjectRenderer] 実身ID抽出:', realId, 'iconBasePathあり:', !!(options.iconBasePath), 'loadIconCallbackあり:', !!(options.loadIconCallback));

                // アイコンを読み込む
                this._setupIconImage(iconImg, realId, options);

                titleBar.appendChild(iconImg);
            }

            // タイトルテキスト部分
            const titleTextSpan = document.createElement('span');
            titleTextSpan.style.color = styles.chcol;
            titleTextSpan.style.fontSize = styles.chszPx + 'px';
            titleTextSpan.style.fontWeight = DEFAULT_FONT_WEIGHT;
            titleTextSpan.style.lineHeight = String(DEFAULT_LINE_HEIGHT);
            titleTextSpan.style.whiteSpace = 'nowrap';
            titleTextSpan.style.overflow = 'hidden';
            titleTextSpan.style.textOverflow = 'ellipsis';
            titleTextSpan.style.flex = '1';

            // 名称
            if (showName) {
                const nameSpan = document.createElement('span');
                nameSpan.className = 'virtual-object-name'; // DOM更新用のクラスを追加
                nameSpan.style.fontFamily = DEFAULT_FONT_FAMILY;  // 親要素のfont継承を無視してデフォルトフォントを使用
                nameSpan.textContent = virtualObject.link_name || '無題';
                titleTextSpan.appendChild(nameSpan);
            }

            // 続柄（JSON metadataの続柄 + link要素のrelationship属性）
            if (showRole) {
                const jsonRelationship = (virtualObject.metadata && virtualObject.metadata.relationship) || [];
                const linkRelationship = virtualObject.linkRelationship || [];

                if (jsonRelationship.length > 0 || linkRelationship.length > 0) {
                    // JSON用は[タグ]形式、link用はそのまま表示
                    const parts = [];
                    for (const tag of jsonRelationship) {
                        parts.push(`[${tag}]`);
                    }
                    parts.push(...linkRelationship);

                    const relationshipText = parts.join(' ');
                    const relationshipSpan = document.createElement('span');
                    relationshipSpan.textContent = ' : ' + relationshipText;
                    titleTextSpan.appendChild(relationshipSpan);
                }
            }

            // タイプ（applistから取得）
            if (showType && virtualObject.applist) {
                let typeName = '';
                for (const [, config] of Object.entries(virtualObject.applist)) {
                    if (config && config.defaultOpen === true && config.name) {
                        typeName = config.name;
                        break;
                    }
                }

                if (typeName) {
                    const typeSpan = document.createElement('span');
                    typeSpan.textContent = ' (' + typeName + ')';
                    titleTextSpan.appendChild(typeSpan);
                }
            }

            // 更新日時
            if (showUpdate && virtualObject.updateDate) {
                const updateDate = new Date(virtualObject.updateDate);
                const dateStr = updateDate.getFullYear() + '/' +
                              String(updateDate.getMonth() + 1).padStart(2, '0') + '/' +
                              String(updateDate.getDate()).padStart(2, '0') + ' ' +
                              String(updateDate.getHours()).padStart(2, '0') + ':' +
                              String(updateDate.getMinutes()).padStart(2, '0') + ':' +
                              String(updateDate.getSeconds()).padStart(2, '0');
                const updateSpan = document.createElement('span');
                updateSpan.textContent = ' ' + dateStr;
                titleTextSpan.appendChild(updateSpan);
            }

            titleBar.appendChild(titleTextSpan);
            vobj.appendChild(titleBar);

            contentTop = titleBarHeight;
        }

        // コンテンツ領域（プレースホルダー）
        const contentArea = document.createElement('div');
        contentArea.className = 'virtual-object-content-area';
        contentArea.style.position = 'absolute';

        // 枠が非表示の場合は余白を大きくして選択しやすくする
        // text-virtual-object.jsと同じ配置（枠表示時はmargin=0でtitleBarの直下にiframe配置）
        const margin = showFrame ? 0 : 10;
        contentArea.style.top = (contentTop + margin) + 'px';
        contentArea.style.left = margin + 'px';
        contentArea.style.right = margin + 'px';
        contentArea.style.bottom = margin + 'px';

        contentArea.style.backgroundColor = styles.bgcol;
        contentArea.style.overflow = 'hidden';
        contentArea.style.boxSizing = 'border-box';

        vobj.appendChild(contentArea);

        // data属性を設定
        this.attachDataAttributes(vobj, virtualObject, options.vobjIndex);

        return vobj;
    }

    /**
     * Canvasに仮身を描画（基本図形編集用）
     * @param {CanvasRenderingContext2D} ctx - Canvas context
     * @param {Object} virtualObject - 仮身オブジェクト
     * @param {number} x - 開始X座標
     * @param {number} y - 開始Y座標
     * @param {number} width - 幅
     * @param {number} height - 高さ
     * @param {Object} options - オプション
     */
    drawToCanvas(ctx, virtualObject, x, y, width, height, options = {}) {
        const styles = this.getStyles(virtualObject);
        const isOpened = this.isOpenedVirtualObject(virtualObject);

        // 表示設定
        const showName = virtualObject.namedisp !== 'false';
        const showUpdate = virtualObject.updatedisp === 'true';
        const showFrame = virtualObject.framedisp !== 'false';
        const showPict = virtualObject.pictdisp !== 'false';
        const showRole = virtualObject.roledisp === 'true';
        const showType = virtualObject.typedisp === 'true';

        if (isOpened) {
            this.drawOpenedVirtualObjectToCanvas(ctx, virtualObject, x, y, width, height, {
                showName,
                showUpdate,
                showFrame,
                showPict,
                showRole,
                showType
            });
        } else {
            this.drawClosedVirtualObjectToCanvas(ctx, virtualObject, x, y, width, height, {
                showName,
                showUpdate,
                showFrame,
                showPict
            });
        }
    }

    /**
     * Canvasに閉じた仮身を描画
     * @param {CanvasRenderingContext2D} ctx - Canvas context
     * @param {Object} virtualObject - 仮身オブジェクト
     * @param {number} x - 開始X座標
     * @param {number} y - 開始Y座標
     * @param {number} width - 幅
     * @param {number} height - 高さ
     * @param {Object} options - 表示オプション
     */
    drawClosedVirtualObjectToCanvas(ctx, virtualObject, x, y, width, height, options = {}) {
        const styles = this.getStyles(virtualObject);
        const { showName = true, showUpdate = false, showFrame = true, showPict = false } = options;

        // タイトルエリアの高さを計算（アイコンサイズはchszPxと同じ1.0倍）
        const lineHeight = DEFAULT_LINE_HEIGHT;
        const iconSize = showPict ? Math.round(styles.chszPx * 1.0) : 0;
        const textHeight = Math.ceil(styles.chszPx * lineHeight);  // テキストの実際の高さ
        const titleHeight = textHeight + VOBJ_PADDING_VERTICAL;  // パディングを含めた高さ
        const paddingX = 4;

        // 全ての表示属性がオフかどうかを判定
        const showTitleArea = showPict || showName || showUpdate;

        // タイトルエリア背景
        if (showTitleArea) {
            ctx.fillStyle = styles.tbcol;
            ctx.fillRect(x, y, width, titleHeight);

            // 現在のX座標（アイコンとテキストの配置用）
            let currentX = x + paddingX;

            // ピクトグラム（アイコン）用のスペース確保
            if (showPict) {
                const realId = virtualObject.link_id.replace(/_\d+\.xtad$/i, '');
                const iconImg = this.getCachedIcon(realId);

                if (iconImg) {
                    const iconY = y + (titleHeight - iconSize) / 2; // 中央配置
                    try {
                        ctx.drawImage(iconImg, currentX, iconY, iconSize, iconSize);
                    } catch (error) {
                        logger.error('[VirtualObjectRenderer] アイコン描画エラー:', realId, error);
                    }
                }
                // アイコンがあってもなくてもスペースを確保
                currentX += iconSize + 4; // アイコンの幅 + 間隔
            }

            // タイトルテキスト
            if (showName) {
                let titleText = virtualObject.link_name || '無題';
                if (showUpdate && virtualObject.updateDate) {
                    const updateDate = new Date(virtualObject.updateDate);
                    const dateStr = updateDate.getFullYear() + '/' +
                                  String(updateDate.getMonth() + 1).padStart(2, '0') + '/' +
                                  String(updateDate.getDate()).padStart(2, '0') + ' ' +
                                  String(updateDate.getHours()).padStart(2, '0') + ':' +
                                  String(updateDate.getMinutes()).padStart(2, '0') + ':' +
                                  String(updateDate.getSeconds()).padStart(2, '0');
                    titleText += ' ' + dateStr;
                }

                ctx.fillStyle = styles.chcol;
                ctx.font = `${styles.chszPx}px sans-serif`;
                ctx.textBaseline = 'middle';

                // テキストを枠内に収める
                let displayText = titleText;
                const maxWidth = x + width - currentX - paddingX; // アイコン分を考慮
                let textWidth = ctx.measureText(displayText).width;

                while (textWidth > maxWidth && displayText.length > 0) {
                    displayText = displayText.slice(0, -1);
                    textWidth = ctx.measureText(displayText + '...').width;
                }
                if (displayText !== titleText) {
                    displayText += '...';
                }

                ctx.fillText(displayText, currentX, y + titleHeight / 2);
            }
        }

        // メイン領域背景
        const mainTop = showTitleArea ? y + titleHeight : y;
        const mainHeight = showTitleArea ? height - titleHeight : height;
        ctx.fillStyle = styles.tbcol;
        ctx.fillRect(x, mainTop, width, mainHeight);

        // 枠線
        if (showFrame) {
            ctx.strokeStyle = styles.frcol;
            ctx.lineWidth = 1;
            ctx.strokeRect(x, y, width, height);
        }
    }

    /**
     * Canvasに開いた仮身を描画
     * @param {CanvasRenderingContext2D} ctx - Canvas context
     * @param {Object} virtualObject - 仮身オブジェクト
     * @param {number} x - 開始X座標
     * @param {number} y - 開始Y座標
     * @param {number} width - 幅
     * @param {number} height - 高さ
     * @param {Object} options - 表示オプション
     */
    drawOpenedVirtualObjectToCanvas(ctx, virtualObject, x, y, width, height, options = {}) {
        const styles = this.getStyles(virtualObject);
        const { showFrame = true, showName = true, showUpdate = false, showPict = false, showRole = false, showType = false } = options;

        // 全ての表示属性がオフかどうかを判定
        const showTitleBar = showPict || showName || showRole || showType || showUpdate;

        // タイトルバーの高さを計算（アイコンサイズはchszPxと同じ1.0倍）
        const lineHeight = DEFAULT_LINE_HEIGHT;
        const iconSize = showPict ? Math.round(styles.chszPx * 1.0) : 0;
        const textHeight = Math.ceil(styles.chszPx * lineHeight);  // テキストの実際の高さ
        const titleBarHeight = textHeight + 16;  // パディングを含めた高さ
        const paddingX = 8;

        // 全体枠（2px）
        if (showFrame) {
            ctx.strokeStyle = styles.frcol;
            ctx.lineWidth = 2;
            ctx.strokeRect(x, y, width, height);
        }

        let contentTop = y;

        if (showTitleBar) {
            // タイトルバー背景
            ctx.fillStyle = styles.tbcol;
            ctx.fillRect(x, y, width, titleBarHeight);

            // タイトルバー下部境界線
            if (showFrame) {
                ctx.strokeStyle = styles.frcol;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(x, y + titleBarHeight);
                ctx.lineTo(x + width, y + titleBarHeight);
                ctx.stroke();
            }

            // 現在のX座標（アイコンとテキストの配置用）
            let currentX = x + paddingX;

            // ピクトグラム（アイコン）用のスペース確保
            if (showPict) {
                const realId = virtualObject.link_id.replace(/_\d+\.xtad$/i, '');
                const iconImg = this.getCachedIcon(realId);

                if (iconImg) {
                    const iconY = y + (titleBarHeight - iconSize) / 2; // 中央配置
                    try {
                        ctx.drawImage(iconImg, currentX, iconY, iconSize, iconSize);
                    } catch (error) {
                        logger.error('[VirtualObjectRenderer] アイコン描画エラー:', realId, error);
                    }
                }
                // アイコンがあってもなくてもスペースを確保
                currentX += iconSize + 4; // アイコンの幅 + 間隔
            }

            // タイトルテキスト
            let titleText = '';

            // 名称
            if (showName) {
                titleText = virtualObject.link_name || '無題';
            }

            // 更新日時
            if (showUpdate && virtualObject.updateDate) {
                const updateDate = new Date(virtualObject.updateDate);
                const dateStr = updateDate.getFullYear() + '/' +
                              String(updateDate.getMonth() + 1).padStart(2, '0') + '/' +
                              String(updateDate.getDate()).padStart(2, '0') + ' ' +
                              String(updateDate.getHours()).padStart(2, '0') + ':' +
                              String(updateDate.getMinutes()).padStart(2, '0') + ':' +
                              String(updateDate.getSeconds()).padStart(2, '0');
                if (titleText) {
                    titleText += ' ' + dateStr;
                } else {
                    titleText = dateStr;
                }
            }

            if (titleText) {
                ctx.fillStyle = styles.chcol;
                ctx.font = `bold ${styles.chszPx}px sans-serif`;
                ctx.textBaseline = 'middle';

                // テキストを枠内に収める
                let displayText = titleText;
                const maxWidth = x + width - currentX - paddingX; // アイコン分を考慮
                let textWidth = ctx.measureText(displayText).width;

                while (textWidth > maxWidth && displayText.length > 0) {
                    displayText = displayText.slice(0, -1);
                    textWidth = ctx.measureText(displayText + '...').width;
                }
                if (displayText !== titleText) {
                    displayText += '...';
                }

                ctx.fillText(displayText, currentX, y + titleBarHeight / 2);
            }

            contentTop = y + titleBarHeight;
        }

        // コンテンツ領域背景
        ctx.fillStyle = styles.bgcol;
        ctx.fillRect(x, contentTop, width, y + height - contentTop);
    }

    /**
     * 仮身が開いた状態かどうかを判定
     * @param {Object} virtualObject - 仮身オブジェクト
     * @returns {boolean} 開いた仮身ならtrue
     */
    isOpenedVirtualObject(virtualObject) {
        // 明示的なopenedプロパティがあればそれを優先
        if (virtualObject.opened !== undefined) {
            return virtualObject.opened === true;
        }

        // 座標ベースの判定（TADファイルから読み込んだ場合）
        // 注意: vobjtop=0 は最上位の仮身として有効な値なので、falsy 判定ではなく undefined/null 判定を行う
        if (virtualObject.vobjbottom == null || virtualObject.vobjtop == null) {
            return false;
        }

        const vobjHeight = virtualObject.vobjbottom - virtualObject.vobjtop;
        const chsz = parseFloat(virtualObject.chsz) || DEFAULT_FONT_SIZE;

        // 開いた仮身の最小高さ (minClosedHeight + VOBJ_MIN_OPEN_HEIGHT_OFFSET) 以上なら開いた仮身と判定
        // 偶発的に少しだけ大きくしてしまった (minClosedHeight + 10 程度) は閉じた仮身扱いとする
        const minOpenHeight = this.getMinOpenHeight(chsz);
        return vobjHeight >= minOpenHeight;
    }

    /**
     * 閉じた仮身の最小高さを計算
     * @param {number} chsz - 文字サイズ（ポイント）
     * @returns {number} 最小高さ（ピクセル）
     */
    getMinClosedHeight(chsz = DEFAULT_FONT_SIZE) {
        const chszPx = convertPtToPx(parseFloat(chsz) || DEFAULT_FONT_SIZE);
        const textHeight = Math.ceil(chszPx * DEFAULT_LINE_HEIGHT);
        const iconSize = Math.round(chszPx * 1.0);
        const contentHeight = Math.max(iconSize, textHeight);
        const paddingVertical = VOBJ_PADDING_VERTICAL; // 上下の padding: 4px + 4px
        // 注: TADファイルのheight属性はborderを含まない高さを表す
        // DOM要素はbox-sizing: border-boxでborderを含むが、保存値は含まない
        return contentHeight + paddingVertical;
    }

    /**
     * 開いた仮身の最小高さを計算（リサイズ用閾値）
     * 仮身枠 (タイトルバー = 閉じた仮身の高さ) + コンテンツエリア最小 (VOBJ_MIN_OPEN_HEIGHT_OFFSET)
     * 仮身枠の直下に枠線が来てしまう状態を防ぐため
     * @param {number} chsz - 文字サイズ（ポイント）
     * @returns {number} 最小高さ（ピクセル）
     */
    getMinOpenHeight(chsz = DEFAULT_FONT_SIZE) {
        return this.getMinClosedHeight(chsz) + VOBJ_MIN_OPEN_HEIGHT_OFFSET;
    }

    /**
     * DOM要素にdata属性を設定
     * @param {HTMLElement} element - DOM要素
     * @param {Object} virtualObject - 仮身オブジェクト
     */
    attachDataAttributes(element, virtualObject, vobjIndex) {
        // IMPORTANT: data属性名を dataset 形式（data-link-id → dataset.linkId）と
        // 後方互換性のある形式（data-tbcol → dataset.tbcol）の両方で設定

        // リンク基本情報
        element.setAttribute('data-link-id', virtualObject.link_id || '');
        element.setAttribute('data-link-name', virtualObject.link_name || '');

        // 色属性（両方の形式で設定）
        const tbcol = virtualObject.tbcol || this.defaultStyles.tbcol;
        const frcol = virtualObject.frcol || this.defaultStyles.frcol;
        const chcol = virtualObject.chcol || this.defaultStyles.chcol;
        const bgcol = virtualObject.bgcol || this.defaultStyles.bgcol;

        element.setAttribute('data-link-tbcol', tbcol);
        element.setAttribute('data-link-frcol', frcol);
        element.setAttribute('data-link-chcol', chcol);
        element.setAttribute('data-link-bgcol', bgcol);

        // 後方互換性のため、data-*形式も設定（dataset.tbcolでアクセス可能）
        element.setAttribute('data-tbcol', tbcol);
        element.setAttribute('data-frcol', frcol);
        element.setAttribute('data-chcol', chcol);
        element.setAttribute('data-bgcol', bgcol);

        // 一意のインデックスを設定（複数の仮身が同じlink_idを持つ場合に識別するため）
        if (vobjIndex !== undefined && vobjIndex !== null) {
            element.setAttribute('data-vobj-index', vobjIndex);
        }

        // レイアウト属性を設定（両方の形式で）
        if (virtualObject.width !== undefined) {
            element.setAttribute('data-link-width', virtualObject.width);
            element.setAttribute('data-width', virtualObject.width);
        }
        if (virtualObject.heightPx !== undefined) {
            element.setAttribute('data-link-heightpx', virtualObject.heightPx);
            element.setAttribute('data-heightpx', virtualObject.heightPx);
        }
        if (virtualObject.dlen !== undefined) {
            element.setAttribute('data-link-dlen', virtualObject.dlen);
            element.setAttribute('data-dlen', virtualObject.dlen);
        }

        if (virtualObject.chsz) {
            element.setAttribute('data-link-chsz', virtualObject.chsz);
            element.setAttribute('data-chsz', virtualObject.chsz);
        }

        // 座標属性を設定（両方の形式で）
        if (virtualObject.vobjleft !== undefined) {
            element.setAttribute('data-link-vobjleft', virtualObject.vobjleft);
        }
        if (virtualObject.vobjtop !== undefined) {
            element.setAttribute('data-link-vobjtop', virtualObject.vobjtop);
        }
        if (virtualObject.vobjright !== undefined) {
            element.setAttribute('data-link-vobjright', virtualObject.vobjright);
        }
        if (virtualObject.vobjbottom !== undefined) {
            element.setAttribute('data-link-vobjbottom', virtualObject.vobjbottom);
        }

        if (virtualObject.applist) {
            element.setAttribute('data-applist', JSON.stringify(virtualObject.applist));
        }

        // 表示属性を設定（両方の形式で）
        if (virtualObject.framedisp !== undefined) {
            element.setAttribute('data-link-framedisp', virtualObject.framedisp);
            element.setAttribute('data-framedisp', virtualObject.framedisp);
        }
        if (virtualObject.namedisp !== undefined) {
            element.setAttribute('data-link-namedisp', virtualObject.namedisp);
            element.setAttribute('data-namedisp', virtualObject.namedisp);
        }
        if (virtualObject.pictdisp !== undefined) {
            element.setAttribute('data-link-pictdisp', virtualObject.pictdisp);
            element.setAttribute('data-pictdisp', virtualObject.pictdisp);
        }
        if (virtualObject.roledisp !== undefined) {
            element.setAttribute('data-link-roledisp', virtualObject.roledisp);
            element.setAttribute('data-roledisp', virtualObject.roledisp);
        }
        if (virtualObject.typedisp !== undefined) {
            element.setAttribute('data-link-typedisp', virtualObject.typedisp);
            element.setAttribute('data-typedisp', virtualObject.typedisp);
        }
        if (virtualObject.updatedisp !== undefined) {
            element.setAttribute('data-link-updatedisp', virtualObject.updatedisp);
            element.setAttribute('data-updatedisp', virtualObject.updatedisp);
        }
        if (virtualObject.autoopen !== undefined) {
            element.setAttribute('data-autoopen', virtualObject.autoopen);
        }
        if (virtualObject.vobjid !== undefined) {
            element.setAttribute('data-link-vobjid', virtualObject.vobjid);
        }
        if (virtualObject.scrollx !== undefined) {
            element.setAttribute('data-link-scrollx', virtualObject.scrollx);
        }
        if (virtualObject.scrolly !== undefined) {
            element.setAttribute('data-link-scrolly', virtualObject.scrolly);
        }
        if (virtualObject.zoomratio !== undefined) {
            element.setAttribute('data-link-zoomratio', virtualObject.zoomratio);
        }
    }
}

// グローバルスコープにもエクスポート（レガシー対応）
if (typeof window !== 'undefined') {
    window.VirtualObjectRenderer = VirtualObjectRenderer;
}
