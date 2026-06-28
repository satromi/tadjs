/**
 * 図形TAD 読み込みパーサ (microscript専用、 描画用途のみ)
 *
 * basic-figure-editor の figure-xml-parser.js を参考に、 描画とセグメント検出に必要な
 * 最小限の要素 (group, rect, ellipse, line, polygon, polyline, text, image, link) を独立実装。
 * 編集機能は持たない。 basic-figure-editor のコードには触らない。
 *
 * BTRON公式仕様 09-01-06 に従いセグメント検出:
 *   グループ直下に先頭が「@」 の文字枠を含む場合、 当該グループはセグメントとなる。
 *   セグメント名 = 「@」 を除いた部分、 先頭 12 文字が識別子。
 */
(function (global) {
    'use strict';

    // パターンID → パターン定義の解決テーブル (parse 開始時に構築、 各 parse 関数で共有)
    // basic-figure-editor の customPatterns と同形式。 テクスチャ描画用に pixelColors を保持する
    let _patternMap = {};
    // マスクID → マスク定義 (テクスチャ生成用)
    let _maskMap = {};

    // マスク定義を構築 (BTRON標準マスク DEFAULT_MASK_DEFINITIONS + xtad 内 <mask> 定義で上書き)
    function buildMaskMap(figure) {
        _maskMap = {};
        if (typeof global.DEFAULT_MASK_DEFINITIONS !== 'undefined') {
            global.DEFAULT_MASK_DEFINITIONS.forEach(function (def) {
                _maskMap[def.id] = {
                    id: def.id, type: 0,
                    width: def.width, height: def.height,
                    wordValues: def.wordValues.slice()
                };
            });
        }
        const maskElems = figure.querySelectorAll('mask');
        maskElems.forEach(function (m) {
            const maskId = parseInt(m.getAttribute('id'));
            const maskWidth = parseInt(m.getAttribute('width'));
            const maskHeight = parseInt(m.getAttribute('height'));
            const maskDataStr = m.getAttribute('data');
            if (!isNaN(maskId) && maskId >= 0 && maskWidth > 0 && maskHeight > 0 && maskDataStr) {
                _maskMap[maskId] = {
                    id: maskId, type: parseInt(m.getAttribute('type')) || 0,
                    width: maskWidth, height: maskHeight,
                    wordValues: maskDataStr.split(',').map(function (v) { return parseInt(v, 16); })
                };
            }
        });
    }

    function buildPatternMap(figure, bgcolorOverride) {
        _patternMap = {};
        buildMaskMap(figure);
        const pattElems = figure.querySelectorAll('pattern');
        pattElems.forEach(function (p) {
            const id = parseInt(p.getAttribute('id'));
            if (isNaN(id) || id < 1) return;
            const width = parseInt(p.getAttribute('width')) || 16;
            const height = parseInt(p.getAttribute('height')) || 16;
            const ncol = parseInt(p.getAttribute('ncol')) || 0;
            const fgcolorsStr = p.getAttribute('fgcolors') || '';
            let bgcolorStr = p.getAttribute('bgcolor') || '';
            const masksStr = p.getAttribute('masks') || '';
            // 棒グラフのマスクバー等、 不透明な白地パターンを背景色と同化させる (白帯対策)。
            // bgcolor が白(#ffffff) かつ ウィンドウ背景色が白以外のときのみ置換 (白背景図形には無影響)
            if (bgcolorOverride && /^#?ffffff$/i.test(bgcolorStr) && bgcolorOverride.toLowerCase() !== '#ffffff') {
                bgcolorStr = bgcolorOverride;
            }
            const fg = (fgcolorsStr.split(',')[0] || '').trim() || '#000000';
            const bg = bgcolorStr || 'transparent';

            // テクスチャパターン: basic-figure-editor と同じく buildPatternFromTadParams で
            // bgcolor 地 + fgcolors マスクの 2D 色配列 (pixelColors) を生成する
            let pixelColors = null;
            if (ncol > 0 && masksStr && typeof global.buildPatternFromTadParams === 'function') {
                pixelColors = global.buildPatternFromTadParams(width, height, ncol, fgcolorsStr, bgcolorStr, masksStr, _maskMap);
            }

            if (pixelColors) {
                _patternMap[id] = {
                    id: id, type: 'pattern',
                    pixelColors: pixelColors,
                    width: width, height: height,
                    ncol: ncol, fgcolors: fgcolorsStr, bgcolor: bgcolorStr, masks: masksStr,
                    fg: fg, bg: bg
                };
            } else {
                // パラメータ不足は単色パターンとして代表色のみ保持 (fg を採用)
                _patternMap[id] = { id: id, type: 'solid', color: fg, fg: fg, bg: bg };
            }
        });
    }

    /**
     * f_pat (塗りつぶしパターンID) を CSS 色に解決
     */
    function resolveFill(elem, defVal) {
        const fp = elem.getAttribute('f_pat');
        if (fp != null && fp !== '' && _patternMap[fp]) {
            const p = _patternMap[fp];
            // 単色パターン: fgcolors[0] を使う (bg が transparent なら fg のみ)
            // bg がある場合 (例: pattern id=2 fg=#7f9fff bg=#7f7f9f) は混合だが、 簡易的に fg を採用
            return p.fg;
        }
        if (fp === '0') return 'transparent'; // pattern 0 は透明固定
        const direct = elem.getAttribute('fillColor');
        if (direct) return direct;
        return defVal;
    }

    /**
     * l_pat (線パターンID) を CSS 色に解決
     */
    function resolveStroke(elem, defVal) {
        const lp = elem.getAttribute('l_pat');
        if (lp != null && lp !== '' && _patternMap[lp]) {
            return _patternMap[lp].fg;
        }
        if (lp === '0') return 'transparent';
        const direct = elem.getAttribute('strokeColor');
        if (direct) return direct;
        return defVal;
    }

    // f_pat / l_pat からパターン定義オブジェクトを取得 (塗りのテクスチャ描画用)。 無ければ null
    function resolvePatternObj(elem, name) {
        const v = parseInt(elem.getAttribute(name));
        if (isNaN(v) || v < 1) return null;
        return _patternMap[v] || null;
    }

    function attr(elem, name, defVal) {
        if (!elem.hasAttribute(name)) return defVal !== undefined ? defVal : null;
        return elem.getAttribute(name);
    }
    function num(elem, name, defVal) {
        const v = attr(elem, name, null);
        if (v === null) return defVal !== undefined ? defVal : 0;
        const n = parseFloat(v);
        return isNaN(n) ? (defVal !== undefined ? defVal : 0) : n;
    }
    function intAttr(elem, name, defVal) {
        const v = attr(elem, name, null);
        if (v === null) return defVal !== undefined ? defVal : 0;
        const n = parseInt(v, 10);
        return isNaN(n) ? (defVal !== undefined ? defVal : 0) : n;
    }
    function color(elem, name, defVal) {
        const v = attr(elem, name, null);
        if (v === null || v === '') return defVal;
        return v;
    }

    function getTextContent(elem) {
        let s = '';
        elem.childNodes.forEach((node) => {
            if (node.nodeType === Node.TEXT_NODE) {
                s += node.textContent;
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                const tag = node.tagName.toLowerCase();
                if (tag === 'br') s += '\n';
                else s += getTextContent(node);
            }
        });
        return s;
    }

    function parseRect(elem) {
        const left = num(elem, 'left', 0);
        const top = num(elem, 'top', 0);
        const right = num(elem, 'right', 0);
        const bottom = num(elem, 'bottom', 0);
        const hasFontSize = elem.hasAttribute('fontSize') ||
                            elem.hasAttribute('textColor') ||
                            elem.querySelector('document');
        if (hasFontSize) {
            return {
                kind: 'text',
                left: left, top: top, right: right, bottom: bottom,
                text: getTextContent(elem).trim(),
                fontSize: intAttr(elem, 'fontSize', 14),
                fontFamily: attr(elem, 'fontFamily', 'sans-serif'),
                textColor: color(elem, 'textColor', '#000000'),
                fillColor: color(elem, 'fillColor', 'transparent')
            };
        }
        return {
            kind: 'rect',
            left: left, top: top, right: right, bottom: bottom,
            cornerRadius: num(elem, 'cornerRadius', 0),
            fillColor: resolveFill(elem, 'transparent'),
            fillPattern: resolvePatternObj(elem, 'f_pat'),
            strokeColor: resolveStroke(elem, '#000000'),
            lineWidth: num(elem, 'lineWidth', 1)
        };
    }
    function parseEllipse(elem) {
        return {
            kind: 'ellipse',
            left: num(elem, 'frameLeft', num(elem, 'left', 0)),
            top: num(elem, 'frameTop', num(elem, 'top', 0)),
            right: num(elem, 'frameRight', num(elem, 'right', 0)),
            bottom: num(elem, 'frameBottom', num(elem, 'bottom', 0)),
            fillColor: resolveFill(elem, 'transparent'),
            fillPattern: resolvePatternObj(elem, 'f_pat'),
            strokeColor: resolveStroke(elem, '#000000'),
            lineWidth: num(elem, 'lineWidth', 1)
        };
    }
    function parseLine(elem) {
        const pointsStr = attr(elem, 'points', '');
        let x1 = 0, y1 = 0, x2 = 0, y2 = 0;
        if (pointsStr) {
            const pairs = pointsStr.trim().split(/\s+/);
            if (pairs.length >= 2) {
                const a = pairs[0].split(',').map(parseFloat);
                const b = pairs[1].split(',').map(parseFloat);
                if (a.length >= 2) { x1 = a[0]; y1 = a[1]; }
                if (b.length >= 2) { x2 = b[0]; y2 = b[1]; }
            }
        } else {
            x1 = num(elem, 'x1', num(elem, 'left', 0));
            y1 = num(elem, 'y1', num(elem, 'top', 0));
            x2 = num(elem, 'x2', num(elem, 'right', 0));
            y2 = num(elem, 'y2', num(elem, 'bottom', 0));
        }
        return {
            kind: 'line',
            x1: x1, y1: y1, x2: x2, y2: y2,
            strokeColor: resolveStroke(elem, '#000000'),
            lineWidth: num(elem, 'lineWidth', 1)
        };
    }
    function parsePoints(str) {
        if (!str) return [];
        const pairs = str.trim().split(/\s+/);
        return pairs.map((p) => {
            const v = p.split(',').map(parseFloat);
            return [v[0] || 0, v[1] || 0];
        });
    }
    function parsePolygon(elem) {
        return {
            kind: 'polygon',
            points: parsePoints(attr(elem, 'points', '')),
            fillColor: resolveFill(elem, 'transparent'),
            fillPattern: resolvePatternObj(elem, 'f_pat'),
            strokeColor: resolveStroke(elem, '#000000'),
            lineWidth: num(elem, 'lineWidth', 1)
        };
    }
    function parsePolyline(elem) {
        return {
            kind: 'polyline',
            points: parsePoints(attr(elem, 'points', '')),
            strokeColor: resolveStroke(elem, '#000000'),
            lineWidth: num(elem, 'lineWidth', 1)
        };
    }
    function parseText(elem) {
        return {
            kind: 'text',
            left: num(elem, 'left', 0),
            top: num(elem, 'top', 0),
            right: num(elem, 'right', 0),
            bottom: num(elem, 'bottom', 0),
            text: getTextContent(elem).trim(),
            fontSize: intAttr(elem, 'fontSize', 14),
            fontFamily: attr(elem, 'fontFamily', 'sans-serif'),
            textColor: color(elem, 'textColor', '#000000'),
            fillColor: color(elem, 'fillColor', 'transparent')
        };
    }
    function parseImage(elem) {
        return {
            kind: 'image',
            left: num(elem, 'left', 0),
            top: num(elem, 'top', 0),
            right: num(elem, 'right', 0),
            bottom: num(elem, 'bottom', 0),
            src: attr(elem, 'href', '') || attr(elem, 'src', '') || attr(elem, 'data', '') || ''
        };
    }
    function parseLink(elem) {
        // basic-figure-editor 形式: <link id="〈実身ID〉_N.xtad" vobjid="..." vobjleft="..." ...>
        const rawId = attr(elem, 'id', null) || attr(elem, 'link_id', null) || '';
        const realId = rawId.replace(/_\d+\.xtad$/i, '').replace(/\.xtad$/i, '');
        return {
            kind: 'link',
            left: num(elem, 'vobjleft', num(elem, 'left', 0)),
            top: num(elem, 'vobjtop', num(elem, 'top', 0)),
            right: num(elem, 'vobjright', num(elem, 'right', 0)),
            bottom: num(elem, 'vobjbottom', num(elem, 'bottom', 0)),
            linkId: rawId,
            linkRef: realId,
            vobjid: attr(elem, 'vobjid', null) || '',
            chsz: num(elem, 'chsz', 14),
            frcol: color(elem, 'frcol', '#000000'),
            chcol: color(elem, 'chcol', '#000000'),
            tbcol: color(elem, 'tbcol', '#ffffff'),
            bgcol: color(elem, 'bgcol', '#ffffff'),
            label: realId
        };
    }

    // wRatio/hRatio 等の比率指定 ("1/2", "1/1", 数値) を倍率(float)へ変換。不正/未指定は 1
    function parseRatio(v) {
        if (v === null || v === undefined || v === '') return 1;
        const s = String(v).trim();
        if (s.indexOf('/') >= 0) {
            const parts = s.split('/');
            const a = parseFloat(parts[0]);
            const b = parseFloat(parts[1]);
            if (!isNaN(a) && !isNaN(b) && b !== 0) return a / b;
            return 1;
        }
        const n = parseFloat(s);
        return (isNaN(n) || n <= 0) ? 1 : n;
    }

    // <p> 内を順走査し、 font の wRatio/hRatio を状態保持して文字 run 配列を生成する。
    // run = { text, xScale(横倍率=wRatio), yScale(縦倍率=hRatio) }。
    // font の size/color/face 切替は run の倍率には影響させない (wRatio/hRatio 属性が有る時のみ更新)。
    function collectRuns(node, state, runs) {
        node.childNodes.forEach((child) => {
            if (child.nodeType === Node.TEXT_NODE) {
                const txt = child.textContent;
                // 整形用の純ASCII空白 (改行/スペース/タブのみ) は要素間のインデントなので本文扱いしない。
                // 全角スペース(U+3000)等の本文空白は [^\t\n\r ] に該当するため保持される。
                if (txt && /[^\t\n\r ]/.test(txt)) {
                    runs.push({ text: txt, xScale: state.xScale, yScale: state.yScale });
                }
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                const tag = child.tagName.toLowerCase();
                if (tag === 'font') {
                    if (child.hasAttribute('wRatio')) state.xScale = parseRatio(child.getAttribute('wRatio'));
                    if (child.hasAttribute('hRatio')) state.yScale = parseRatio(child.getAttribute('hRatio'));
                } else if (tag === 'br') {
                    runs.push({ text: '\n', xScale: state.xScale, yScale: state.yScale });
                } else if (tag === 'docview' || tag === 'docdraw' || tag === 'docscale' || tag === 'text') {
                    // メタ情報要素 (枠/スケール/段落属性) は本文ではないためスキップ
                } else {
                    collectRuns(child, state, runs);
                }
            }
        });
    }

    function parseDocument(elem) {
        const docView = elem.querySelector('docView');
        const left = docView ? num(docView, 'viewleft', num(docView, 'left', 0)) : 0;
        const top = docView ? num(docView, 'viewtop', num(docView, 'top', 0)) : 0;
        const right = docView ? num(docView, 'viewright', num(docView, 'right', 0)) : 0;
        const bottom = docView ? num(docView, 'viewbottom', num(docView, 'bottom', 0)) : 0;
        const fontEl = elem.querySelector('font[size]');
        let fontSize = 14;
        if (fontEl) {
            const sz = parseFloat(fontEl.getAttribute('size'));
            if (!isNaN(sz) && sz > 0) fontSize = sz * 1.4;
        }
        const fontFaceEl = elem.querySelector('font[face]');
        const fontFamily = fontFaceEl ? (fontFaceEl.getAttribute('face') || 'sans-serif') : 'sans-serif';
        const fontColorEl = elem.querySelector('font[color]');
        const textColor = fontColorEl ? (fontColorEl.getAttribute('color') || '#000000') : '#000000';
        // 背景パターン (<text bpat="N"/>): 入力欄等の塗り背景。 非 0 の bpat (後勝ち) をパターン定義から解決
        let bgPattern = null;
        let bgColor = 'transparent';
        const textEls = elem.querySelectorAll('text');
        for (let i = 0; i < textEls.length; i++) {
            const bp = parseInt(textEls[i].getAttribute('bpat'));
            if (!isNaN(bp) && bp > 0 && _patternMap[bp]) {
                bgPattern = _patternMap[bp];
                bgColor = (bgPattern.bg && bgPattern.bg !== 'transparent') ? bgPattern.bg : bgPattern.fg;
            }
        }
        let paragraphs = Array.from(elem.querySelectorAll('p'));
        // <p> 無しで <document> 直下にテキストを書く保存形式 (basic-figure-editor の旧シリアライザ等)
        // へのフォールバック: document 自身を段落とみなしてテキスト/＠ラベルを抽出する
        // (<p> が無いと paragraphs 空 → text='' → labelName が null → 役者未検出になる)。
        if (paragraphs.length === 0) paragraphs = [elem];
        const lines = paragraphs.map(function (p) {
            const clone = p.cloneNode(true);
            clone.querySelectorAll('docView,docDraw,docScale,text,font').forEach(function (el) { el.remove(); });
            return getTextContent(clone);
        });
        // wRatio/hRatio を区間ごとに保持した run 配列を生成 (font 状態は段落間も継続)。
        // 描画 (_drawText) が runs を優先使用し、半角圧縮等の文字幅を反映する。
        const runs = [];
        const runState = { xScale: 1, yScale: 1 };
        for (let pi = 0; pi < paragraphs.length; pi++) {
            if (pi > 0) runs.push({ text: '\n', xScale: runState.xScale, yScale: runState.yScale });
            collectRuns(paragraphs[pi], runState, runs);
        }
        // runs 先頭/末尾の改行を除去し、 text の .trim() と整合させる。
        // 図形の <tcode/> 直後等にある整形改行が先頭 '\n' として残ると、 _drawTextRuns が
        // それを改行扱いして空の先頭行を作り、 後続文字をクリップ枠(セグメント矩形)の外へ
        // 押し出して不可視化する(得点盤の緑▬ マーカー son0/son1 等)。 改行のみ除去し
        // 水平位置(先頭空白)は変えない。 段落間の改行 run は先頭/末尾以外なので保持される。
        if (runs.length) {
            runs[0].text = runs[0].text.replace(/^[\r\n]+/, '');
            runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/[\r\n]+$/, '');
            while (runs.length && runs[0].text === '') runs.shift();
            while (runs.length && runs[runs.length - 1].text === '') runs.pop();
        }
        return {
            kind: 'text',
            left: left, top: top, right: right, bottom: bottom,
            text: lines.join('\n').trim(),
            runs: runs,
            fontSize: fontSize,
            fontFamily: fontFamily,
            textColor: textColor,
            fillColor: bgColor,
            fillPattern: bgPattern
        };
    }

    function parseShape(elem) {
        const tag = elem.tagName.toLowerCase();
        switch (tag) {
            case 'rect':
            case 'rectangle':
                return parseRect(elem);
            case 'ellipse':
            case 'circle':
                return parseEllipse(elem);
            case 'line':
                return parseLine(elem);
            case 'polygon':
                return parsePolygon(elem);
            case 'polyline':
                return parsePolyline(elem);
            case 'text':
                return parseText(elem);
            case 'image':
            case 'pixelmap':
                return parseImage(elem);
            case 'link':
                return parseLink(elem);
            case 'group':
                return parseGroup(elem);
            case 'document':
                return parseDocument(elem);
        }
        return null;
    }

    /**
     * 子shapeの座標を平行移動 (絶対座標 → グループ相対座標 化に使う)
     * 注: group の場合は left/top のみ移動。 children は parseGroup で既にグループ相対化済みなので
     * ここで再帰 translate すると二重適用となるため触らない。
     */
    function translateShape(shape, dx, dy) {
        if (!shape) return;
        if (shape.left !== undefined) { shape.left += dx; shape.right += dx; }
        if (shape.top !== undefined) { shape.top += dy; shape.bottom += dy; }
        if (shape.x1 !== undefined) { shape.x1 += dx; shape.x2 += dx; shape.y1 += dy; shape.y2 += dy; }
        if (shape.points) {
            for (let i = 0; i < shape.points.length; i++) {
                shape.points[i][0] += dx;
                shape.points[i][1] += dy;
            }
        }
    }

    function shapeBoundingBox(c) {
        if (c.left !== undefined && c.top !== undefined && c.right !== undefined && c.bottom !== undefined) {
            return [c.left, c.top, c.right, c.bottom];
        }
        if (c.x1 !== undefined) {
            return [Math.min(c.x1, c.x2), Math.min(c.y1, c.y2), Math.max(c.x1, c.x2), Math.max(c.y1, c.y2)];
        }
        if (c.points && c.points.length > 0) {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (let i = 0; i < c.points.length; i++) {
                const p = c.points[i];
                if (p[0] < minX) minX = p[0]; if (p[1] < minY) minY = p[1];
                if (p[0] > maxX) maxX = p[0]; if (p[1] > maxY) maxY = p[1];
            }
            return [minX, minY, maxX, maxY];
        }
        return null;
    }

    function parseGroup(elem) {
        const hasL = elem.hasAttribute('left');
        const hasT = elem.hasAttribute('top');
        const hasR = elem.hasAttribute('right');
        const hasB = elem.hasAttribute('bottom');

        const children = [];
        const elemChildren = Array.from(elem.children);
        for (let i = 0; i < elemChildren.length; i++) {
            const c = parseShape(elemChildren[i]);
            if (!c) continue;
            children.push(c);
        }

        let left, top, right, bottom;
        if (hasL && hasT && hasR && hasB) {
            left = num(elem, 'left', 0);
            top = num(elem, 'top', 0);
            right = num(elem, 'right', 0);
            bottom = num(elem, 'bottom', 0);
        } else {
            let minL = Infinity, minT = Infinity, maxR = -Infinity, maxB = -Infinity;
            for (let i = 0; i < children.length; i++) {
                const bb = shapeBoundingBox(children[i]);
                if (!bb) continue;
                if (bb[0] < minL) minL = bb[0];
                if (bb[1] < minT) minT = bb[1];
                if (bb[2] > maxR) maxR = bb[2];
                if (bb[3] > maxB) maxB = bb[3];
            }
            left = isFinite(minL) ? minL : 0;
            top = isFinite(minT) ? minT : 0;
            right = isFinite(maxR) ? maxR : 0;
            bottom = isFinite(maxB) ? maxB : 0;
        }

        for (let i = 0; i < children.length; i++) {
            translateShape(children[i], -left, -top);
        }

        return {
            kind: 'group',
            left: left, top: top, right: right, bottom: bottom,
            zIndex: intAttr(elem, 'zIndex', 0),
            children: children
        };
    }

    /**
     * グループからセグメントを検出
     * 直下の文字枠(kind='text')のうち、 内容が「@」 で始まるものをラベルと判定。
     * BTRON 09-01-06 準拠: 「@」 を省いた部分がセグメント名、 文字枠自体はセグメント識別用で表示しない。
     * @param group - parseGroup で得たオブジェクト
     * @returns { isSegment, segmentName, labelShape, labelIndex }
     */
    // 「@名前」 ラベル文字枠から正規化済みセグメント名を得る。 ラベルでなければ null
    function labelName(child) {
        if (!child || child.kind !== 'text') return null;
        const t = child.text || '';
        if (t.length === 0) return null;
        const first = t.charAt(0);
        if (first !== '@' && first !== '＠') return null;
        // セグメント名はレクサーと同じ正規化 (全角英数字→半角) を通す。
        // スクリプト側の名前はレクサー正規化済みのため、 図形ラベル側も揃えないと照合に失敗する
        let name = t.substr(1).replace(/[\r\n].*/, '');
        if (global.MSLexer && global.MSLexer.normalize) name = global.MSLexer.normalize(name);
        return name.trim().slice(0, 12);
    }

    // 部分木(group 配下の任意の深さ)を走査して @ラベル文字枠を収集する。 detectSegment ケース3
    // (単一セグメント＋装飾を 3 階層以上の容器にまとめた図形)のフォールバック判定に使う。
    // acc.count は部分木全体のラベル総数、 残りのフィールドは最初に見つけた 1 個の位置情報。
    // 役者化時の境界再計算は最外 group の直下子から行うため、 ここでは labelParent (ラベルを直接
    // 含む親グループ)と labelIndex を返し、 collectSegments がそのラベルだけを除去できるようにする。
    function collectLabelsDeep(group, acc) {
        acc = acc || { count: 0, name: null, labelShape: null, labelParent: null, labelIndex: -1 };
        if (!group || !group.children) return acc;
        for (let i = 0; i < group.children.length; i++) {
            const ch = group.children[i];
            const nm = labelName(ch);
            if (nm != null) {
                acc.count++;
                if (!acc.labelShape) {
                    acc.name = nm; acc.labelShape = ch; acc.labelParent = group; acc.labelIndex = i;
                }
            }
            if (ch && ch.kind === 'group' && ch.children) collectLabelsDeep(ch, acc);
        }
        return acc;
    }

    function detectSegment(group) {
        // (1) 直下にラベル文字枠がある通常ケース。 labelParent=group (splice 対象は group.children)
        for (let i = 0; i < group.children.length; i++) {
            const name = labelName(group.children[i]);
            if (name != null) {
                return { isSegment: true, segmentName: name, labelShape: group.children[i], labelParent: group, labelIndex: i };
            }
        }
        // (2) ラベルが直下の子グループ内に入っているネストケース (ソリティアの確認パネル sw0T/sw1T/sw2T
        //     ボタンは「外グループ = {内グループ(枠+@ラベル), 表示文字}」 構造)。 内グループだけを役者に
        //     すると兄弟の表示文字 (取り消し 等) がどの役者にも属さず描画されない。 外グループを役者と
        //     判定し、 ラベルは内グループから除去する。 これにより外グループ配下の全可視シェイプ(枠と文字)
        //     が役者 shapes に含まれ、 _drawGroup の再帰描画でボタン文字も表示される。
        // 安全策: @ラベルを直下に持つ子グループが「ちょうど1個」のときだけ親を役者化する。
        // 複数あるとき(カードパレット ?01..?13 等、 各子が独立した役者)は親を役者化せず、 容器として
        // 再帰検出に委ねる(誤って全カードを1役者に統合しないため)。
        let _found = null, _cnt = 0;
        for (let i = 0; i < group.children.length; i++) {
            const sub = group.children[i];
            if (!sub || sub.kind !== 'group' || !sub.children) continue;
            for (let j = 0; j < sub.children.length; j++) {
                const name = labelName(sub.children[j]);
                if (name != null) {
                    _cnt++;
                    if (!_found) _found = { isSegment: true, segmentName: name, labelShape: sub.children[j], labelParent: sub, labelIndex: j };
                    break; // 子グループ1個につき @ラベルは1個
                }
            }
        }
        if (_cnt === 1 && _found) return _found;
        // (3) フォールバック: ケース(1)(2)が不成立。 部分木全体に @ラベルが「ちょうど1個」だけ
        //     存在するなら、 その(最外)グループを役者化する。 単一セグメント＋装飾(タイトル/見出し)を
        //     セグメント境界の外側で 1 つの容器にまとめた 3 階層以上の図形(ソリティア得点選択盤 card1:
        //     G_f{ G_e{ G_d(枠+@card1), タイトル }, 見出しA, 見出しB })に対応する。 容器 G_f を役者化
        //     することで G_f 直下の見出しも shapes に含まれ、 パネルと一体に表示・移動する。
        //     トップダウン処理のため最外容器が先に成立し再帰は停止する。 ラベルが複数(カードパレット
        //     ?01..?13 や図形ルート)なら容器として再帰検出に委ねるため対象外。
        const deep = collectLabelsDeep(group, null);
        if (deep.count === 1 && deep.labelShape) {
            return { isSegment: true, segmentName: deep.name, labelShape: deep.labelShape, labelParent: deep.labelParent, labelIndex: deep.labelIndex };
        }
        return { isSegment: false, segmentName: null, labelShape: null, labelParent: null, labelIndex: -1 };
    }

    /**
     * 図形TADテキストをパース
     * @param xmlData - <tad><figure>...</figure></tad> 形式の文字列
     * @returns {Object} {
     *   shapes: 全shape (group含む) の配列、
     *   groups: グループのみ抽出、
     *   segments: セグメント検出結果 [{ name, group, labelShape, baseX, baseY, width, height }]、
     *   links: 仮身リンク配列
     * }
     */
    // グループから役者セグメントを再帰的に検出する。
    // 「@名前」ラベル付きグループを役者とし、 その内部は探索を打ち切る。
    // ラベルの無いグループは入れ子の子グループを再帰的に探す
    // (図形全体を入れ子グループ化した舞台で役者が深くネストするケースに対応)。
    function collectSegments(shape, result, offX, offY) {
        // offX/offY: 祖先グループの絶対オフセット累積。 parseGroup は子を「親グループ相対」へ平行移動
        // するため、 入れ子セグメント(card0 等のパネル)の left/top は親相対値になっている。 ここで
        // 祖先の left/top を足し戻さないと、 深くネストしたセグメントが原点(0,0)付近に誤配置される
        // (ソリティアの模様選択盤=card0 が y0=0 になり、 パネル中身がパネル外へ飛ぶ不具合の真因)。
        // トップレベル呼び出しは offX/offY=0 のため既存の非ネストセグメントには影響しない。
        offX = offX || 0; offY = offY || 0;
        const det = detectSegment(shape);
        if (det.isSegment) {
            // ラベルは labelParent (通常は shape 自身、 ネストケースでは内側の子グループ) から除去する
            if (det.labelIndex >= 0 && det.labelParent && det.labelParent.children) {
                det.labelParent.children.splice(det.labelIndex, 1);
            }
            // セグメント境界は「@名前」 ラベル文字枠を除いた可視シェイプのみで再計算する。
            // ラベルを含めると .W/.H がラベル分膨らみ、 原点がずれて MOVE 後の描画位置もずれる。
            let visL = Infinity, visT = Infinity, visR = -Infinity, visB = -Infinity;
            for (let j = 0; j < shape.children.length; j++) {
                const bb = shapeBoundingBox(shape.children[j]);
                if (!bb) continue;
                if (bb[0] < visL) visL = bb[0];
                if (bb[1] < visT) visT = bb[1];
                if (bb[2] > visR) visR = bb[2];
                if (bb[3] > visB) visB = bb[3];
            }
            let labelOffX = 0, labelOffY = 0;
            if (isFinite(visL) && isFinite(visT) && isFinite(visR) && isFinite(visB)) {
                for (let j = 0; j < shape.children.length; j++) {
                    translateShape(shape.children[j], -visL, -visT);
                }
                if (det.labelShape) translateShape(det.labelShape, -visL, -visT);
                shape.left = shape.left + visL;
                shape.top = shape.top + visT;
                shape.right = shape.left + (visR - visL);
                shape.bottom = shape.top + (visB - visT);
                // 論理原点(ラベル込み左上)と描画原点(可視左上)の差。 SCENE/MOVE の固定オフセット補正に使う
                labelOffX = -visL; labelOffY = -visT;
            }
            result.segments.push({
                name: det.segmentName,
                group: shape,
                labelShape: det.labelShape,
                baseX: offX + shape.left,
                baseY: offY + shape.top,
                labelOffsetX: labelOffX,
                labelOffsetY: labelOffY,
                width: Math.max(shape.right - shape.left, 1),
                height: Math.max(shape.bottom - shape.top, 1)
            });
            return;
        }
        // ラベル無しグループ: 入れ子の子グループを再帰探索。 子は親相対座標なので、 このグループの
        // left/top を累積オフセットに足して渡す(子セグメントの絶対位置を復元するため)。
        for (let j = 0; j < shape.children.length; j++) {
            const ch = shape.children[j];
            if (ch && ch.kind === 'group') collectSegments(ch, result, offX + shape.left, offY + shape.top);
        }
    }

    function parse(xmlData, options) {
        const result = { shapes: [], groups: [], segments: [], links: [], figView: null, error: null };
        if (!xmlData) return result;
        // XML 1.0 で禁止された制御文字(ESC=U+001B, FF=U+000C 等。 タブ \t・改行 \n・復帰 \r は許可)を除去。
        // テキストノード中の不正文字は DOMParser を parsererror にするため、 パース前に除く
        xmlData = xmlData.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
        let doc;
        try {
            doc = new DOMParser().parseFromString(xmlData, 'text/xml');
        } catch (e) {
            result.error = '図形TADのパース失敗: ' + e.message;
            return result;
        }
        const parserError = doc.querySelector('parsererror');
        if (parserError) {
            result.error = '図形TADのXML構文エラー: ' + parserError.textContent;
            return result;
        }
        const figure = doc.querySelector('figure');
        if (!figure) {
            result.error = '<figure> 要素が見つかりません';
            return result;
        }
        // パターンID → 色 の辞書を構築 (f_pat/l_pat 解決に使用)。 背景色を渡しマスクバー白地を同化
        buildPatternMap(figure, options && options.backgroundColor);
        // figView (作業領域) を取得 — MOVE ではみ出した図形を作業領域でクリップするのに使う
        const fvEl = figure.querySelector('figView');
        if (fvEl) {
            result.figView = { left: num(fvEl, 'left', 0), top: num(fvEl, 'top', 0), right: num(fvEl, 'right', 0), bottom: num(fvEl, 'bottom', 0) };
        }
        const children = Array.from(figure.children);
        for (let i = 0; i < children.length; i++) {
            const shape = parseShape(children[i]);
            if (!shape) continue;
            result.shapes.push(shape);
            if (shape.kind === 'group') {
                result.groups.push(shape);
                collectSegments(shape, result);
            } else if (shape.kind === 'link') {
                result.links.push(shape);
            }
        }
        return result;
    }

    global.FigureTadReader = { parse: parse, detectSegment: detectSegment };
})(typeof window !== 'undefined' ? window : globalThis);
