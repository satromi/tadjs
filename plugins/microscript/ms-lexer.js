/**
 * マイクロスクリプト 字句解析器
 *
 * BTRON公式仕様(超漢字V取扱説明書 09-03-01～09-03-03)に準拠したトークナイザ。
 * 全角記号の正規化、 連続実行(;)、 行継続(\)、 コメント(#)を扱う。
 *
 * トークン種別:
 *   IDENT   識別子(変数名・セグメント名・手続き名・命令キーワード等)
 *   INT     整数値(10進・16進)
 *   FLOAT   浮動小数値
 *   CHAR    文字定数('X')
 *   STRING  文字列定数("...")
 *   SYSVAR  システム変数($XXX)
 *   OP      演算子・区切り記号
 *   NL      改段落(文の終端)
 *   EOF     終端
 */
(function (global) {
    'use strict';

    // 全角 ASCII ブロック (U+FF01〜FF5E) は normalize() で機械的に半角化するため、
    // ここには「ブロック外の異体字・互換記号」 のみを定義する
    const FULL_HALF_MAP = {
        '‐': '-', '−': '-', '×': '*', '÷': '/',
        '≧': '>=', '≦': '<=', '≠': '!=', '〈': '<', '〉': '>',
        '￣': '~', '〜': '~',
        '”': '"', '“': '"', '゛': '"', '″': '"', '’': "'", '‘': "'",
        '￥': '\\',
        '　': ' '
    };

    function normalize(src) {
        let out = '';
        for (let i = 0; i < src.length; i++) {
            const c = src[i];
            if (FULL_HALF_MAP[c] !== undefined) {
                out += FULL_HALF_MAP[c];
                continue;
            }
            const code = c.charCodeAt(0);
            // 全角英数字・記号 (！〜～) を対応する半角 ASCII に正規化
            // (仕様上、 スクリプトの記号・数字・キーワードは全角でも記述できる)
            if (code >= 0xFF01 && code <= 0xFF5E) {
                out += String.fromCharCode(code - 0xFEE0);
                continue;
            }
            out += c;
        }
        return out;
    }

    const TWO_CHAR_OPS = ['>=', '<=', '==', '!=', '&&', '||', '<<', '>>'];
    const ONE_CHAR_OPS = '+-*/%&|^~<>=!,;:()[].@';

    function isDigit(c) { return c >= '0' && c <= '9'; }
    function isHexDigit(c) {
        return isDigit(c) || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
    }
    function isAlpha(c) {
        if (c === '_') return true;
        const code = c.charCodeAt(0);
        if ((code >= 0x41 && code <= 0x5A) || (code >= 0x61 && code <= 0x7A)) return true;
        if (code >= 0x80) return true;
        return false;
    }
    function isIdentStart(c) { return isAlpha(c); }
    function isIdentCont(c) { return isAlpha(c) || isDigit(c); }

    function tokenize(rawSrc) {
        const src = normalize(rawSrc);
        const tokens = [];
        let i = 0;
        let line = 1;
        const len = src.length;
        let lineHadToken = false;

        function emit(type, value, extra) {
            const t = { type: type, value: value, line: line };
            if (extra) Object.assign(t, extra);
            tokens.push(t);
            lineHadToken = true;
        }

        while (i < len) {
            const c = src[i];

            if (c === '\r') { i++; continue; }
            if (c === '\n') {
                if (lineHadToken) emit('NL', '\n');
                line++;
                lineHadToken = false;
                i++;
                continue;
            }

            if (c === ' ' || c === '\t') { i++; continue; }

            if (c === '#') {
                while (i < len && src[i] !== '\n') i++;
                continue;
            }

            if (c === '\\' && i + 1 < len && (src[i + 1] === '\n' || src[i + 1] === '\r')) {
                i++;
                while (i < len && (src[i] === '\r' || src[i] === '\n')) {
                    if (src[i] === '\n') line++;
                    i++;
                }
                continue;
            }

            if (c === ';') {
                emit('NL', ';');
                i++;
                continue;
            }

            if (c === '$') {
                let j = i + 1;
                while (j < len && isIdentCont(src[j])) j++;
                if (j === i + 1) {
                    throw new MSLexError('不正なシステム変数記法', line);
                }
                emit('SYSVAR', src.slice(i + 1, j));
                i = j;
                continue;
            }

            if (isDigit(c)) {
                let j = i;
                let isFloat = false;
                let isHex = false;
                if (c === '0' && i + 1 < len && (src[i + 1] === 'x' || src[i + 1] === 'X')) {
                    isHex = true;
                    j = i + 2;
                    while (j < len && isHexDigit(src[j])) j++;
                    const text = src.slice(i + 2, j);
                    if (text.length === 0) throw new MSLexError('16進数の桁がありません', line);
                    emit('INT', parseInt(text, 16));
                    i = j;
                    continue;
                }
                while (j < len && isDigit(src[j])) j++;
                if (j < len && src[j] === '.') {
                    isFloat = true;
                    j++;
                    while (j < len && isDigit(src[j])) j++;
                }
                if (j < len && (src[j] === 'e' || src[j] === 'E')) {
                    isFloat = true;
                    j++;
                    if (j < len && (src[j] === '+' || src[j] === '-')) j++;
                    while (j < len && isDigit(src[j])) j++;
                }
                const text = src.slice(i, j);
                if (isFloat) emit('FLOAT', parseFloat(text));
                else emit('INT', parseInt(text, 10));
                i = j;
                continue;
            }

            if (c === "'") {
                const startLine = line;
                let j = i + 1;
                let codepoint = 0;
                let count = 0;
                while (j < len && src[j] !== "'") {
                    let ch;
                    if (src[j] === '\\' && j + 1 < len) {
                        const e = src[j + 1];
                        const escMap = { 'n': 0x000A, 'r': 0x000D, 't': 0x0009, 'b': 0x0008, '0': 0x0000 };
                        if (escMap.hasOwnProperty(e)) {
                            codepoint = escMap[e];
                        } else {
                            codepoint = e.charCodeAt(0);
                        }
                        j += 2;
                        count++;
                    } else if (src[j] === '\n') {
                        throw new MSLexError('文字定数が閉じていません', startLine);
                    } else {
                        codepoint = src.charCodeAt(j);
                        j++;
                        count++;
                    }
                    if (count > 1) break;
                }
                if (j >= len || src[j] !== "'") {
                    if (count === 0) {
                        emit('INT', 0);
                        i = j + (src[j] === "'" ? 1 : 0);
                        continue;
                    }
                    throw new MSLexError('文字定数が閉じていません', startLine);
                }
                emit('INT', count === 0 ? 0 : codepoint);
                i = j + 1;
                continue;
            }

            if (c === '"') {
                const startLine = line;
                let j = i + 1;
                const chars = [];
                while (j < len && src[j] !== '"') {
                    if (src[j] === '\\' && j + 1 < len) {
                        const e = src[j + 1];
                        const escMap = { 'n': 0x000A, 'r': 0x000D, 't': 0x0009, 'b': 0x0008, '0': 0x0000 };
                        if (escMap.hasOwnProperty(e)) {
                            chars.push(escMap[e]);
                        } else {
                            chars.push(e.charCodeAt(0));
                        }
                        j += 2;
                    } else if (src[j] === '\n') {
                        throw new MSLexError('文字列定数が閉じていません', startLine);
                    } else {
                        chars.push(src.charCodeAt(j));
                        j++;
                    }
                }
                if (j >= len) throw new MSLexError('文字列定数が閉じていません', startLine);
                emit('STRING', chars);
                i = j + 1;
                continue;
            }

            const two = src.substr(i, 2);
            if (TWO_CHAR_OPS.indexOf(two) >= 0) {
                emit('OP', two);
                i += 2;
                continue;
            }

            if (ONE_CHAR_OPS.indexOf(c) >= 0) {
                emit('OP', c);
                i++;
                continue;
            }

            if (isIdentStart(c)) {
                let j = i + 1;
                while (j < len && isIdentCont(src[j])) j++;
                let name = src.slice(i, j);
                // BTRON仕様 09-03-03: 名前は先頭12文字で識別 (13文字目以降は無視して同一視)
                if (name.length > 12) name = name.slice(0, 12);
                emit('IDENT', name);
                i = j;
                continue;
            }

            throw new MSLexError('予期しない文字: ' + JSON.stringify(c), line);
        }

        if (lineHadToken) emit('NL', '\n');
        emit('EOF', null);
        return tokens;
    }

    function MSLexError(message, line) {
        const e = new Error('字句エラー(' + line + '行): ' + message);
        e.name = 'MSLexError';
        e.line = line;
        return e;
    }

    global.MSLexer = { tokenize: tokenize, normalize: normalize };
})(typeof window !== 'undefined' ? window : globalThis);
