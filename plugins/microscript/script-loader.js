/**
 * SCRIPT: 仮身ローダ
 *
 * 図形TAD内の <link> 群から、 参照先実身が「SCRIPT:〜」 で始まる文章実身のみを
 * MessageBus経由で読み込み、 奥から手前の順に最大32個まで連結する。
 */
(function (global) {
    'use strict';

    const MAX_SCRIPTS = 32;

    function ScriptLoader(plugin) {
        this.plugin = plugin;
    }

    /**
     * @param links - figure-tad-reader.parse() の links 配列
     * @returns {Promise<{ sources, names, errors, notFound }>}
     */
    ScriptLoader.prototype.loadScripts = async function (links) {
        const result = { sources: [], names: [], errors: [], notFound: [], skipped: [], subFigures: [], nameMap: {} };
        if (!links || links.length === 0) {
            console.log('[MS-SL] links is empty');
            return result;
        }
        console.log('[MS-SL] loadScripts start, links count:', links.length);

        for (let i = 0; i < links.length && result.sources.length < MAX_SCRIPTS; i++) {
            const link = links[i];
            console.log('[MS-SL] link[' + i + ']: linkRef=' + link.linkRef + ', linkId=' + link.linkId);
            if (!link.linkRef) {
                console.log('[MS-SL]   skip: linkRef empty');
                continue;
            }
            let realObject = null;
            try {
                realObject = await this.plugin.loadRealObjectData(link.linkRef);
            } catch (e) {
                console.log('[MS-SL]   error: ' + e.message);
                result.errors.push({ linkRef: link.linkRef, error: e.message });
                continue;
            }
            if (!realObject) {
                console.log('[MS-SL]   realObject is null');
                result.notFound.push(link.linkRef);
                continue;
            }
            const j = realObject.json || (realObject.metadata) || null;
            const name = (j && j.name) || '';
            console.log('[MS-SL]   name:', JSON.stringify(name));
            // ランタイムが FOPEN/FREAD で 「実身名」 指定する場合の解決用マップ (例: "入力" -> realId)
            if (name) {
                if (result.nameMap[name] && result.nameMap[name] !== link.linkRef) {
                    console.warn('[MS-SL] 同名リンクが複数あります (後勝ちで上書き):', name);
                }
                result.nameMap[name] = link.linkRef;
            }
            const xtad = realObject.records && realObject.records[0]
                ? (realObject.records[0].xtad || realObject.records[0].data || '')
                : '';

            // 実身名の全角 (ＳＣＲＩＰＴ 等) も判定できるよう正規化してから照合
            const normName = (window.MSLexer && window.MSLexer.normalize) ? window.MSLexer.normalize(name || '') : (name || '');
            if (/^SCRIPT/i.test(normName)) {
                console.log('[MS-SL]   xtad length:', xtad.length);
                const source = this.extractTextFromXtad(xtad);
                console.log('[MS-SL]   extracted source length:', source.length);
                if (source) {
                    result.sources.push(source);
                    result.names.push(name);
                }
                continue;
            }

            if (/^[@＠]{2}\+?/.test(name)) {
                console.log('[MS-SL]   sub figure (@@/@@+):', name, 'xtad length:', xtad.length);
                result.subFigures.push({ realId: link.linkRef, name: name, xtad: xtad });
                continue;
            }

            console.log('[MS-SL]   skip: name not SCRIPT/sub-figure');
            result.skipped.push({ linkRef: link.linkRef, name: name });
        }
        console.log('[MS-SL] loadScripts done. sources:', result.sources.length, 'subFigures:', result.subFigures.length, 'errors:', result.errors.length, 'notFound:', result.notFound.length, 'skipped:', result.skipped.length);
        return result;
    };

    const META_TAGS = new Set([
        'paper', 'docmargin', 'tab-format', 'docview', 'docdraw', 'docscale',
        'figview', 'figdraw', 'figscale', 'font', 'text', 'pattern', 'mask',
        'underline', 'strikethrough', 'realtime', 'realdata', 'realgroup',
        'interpolate', 'unitsystem'
    ]);

    ScriptLoader.prototype.extractTextFromXtad = function (xmlData) {
        if (!xmlData) return '';
        try {
            const doc = new DOMParser().parseFromString(xmlData, 'text/xml');
            const parserError = doc.querySelector('parsererror');
            if (parserError) return '';
            const document = doc.querySelector('document');
            if (!document) return '';
            const paragraphs = Array.from(document.querySelectorAll('p'));
            const lines = paragraphs.map(function (p) {
                const raw = extractTextFromElement(p);
                return raw.replace(/\r/g, '').replace(/\n+/g, ' ').replace(/\s+$/g, '');
            });
            return lines.join('\n');
        } catch (e) {
            return '';
        }
    };

    function extractTextFromElement(elem) {
        let s = '';
        elem.childNodes.forEach((node) => {
            if (node.nodeType === Node.TEXT_NODE) {
                s += node.textContent;
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                const tag = node.tagName.toLowerCase();
                if (tag === 'link') return;
                if (tag === 'br') { s += '\n'; return; }
                if (META_TAGS.has(tag)) return;
                s += extractTextFromElement(node);
            }
        });
        return s;
    }

    global.ScriptLoader = ScriptLoader;
})(typeof window !== 'undefined' ? window : globalThis);
