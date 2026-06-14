/**
 * マイクロスクリプト 構文解析器
 *
 * 字句解析結果のトークン列から AST を生成する。
 * BTRON公式仕様(09-04-02～09-04-08)準拠の文の集合を扱う。
 */
(function (global) {
    'use strict';

    const KEYWORDS = new Set([
        'VERSION', 'DEFINE', 'VARIABLE', 'LOCAL', 'SEGMENT', 'SCRIPT', 'COMMENT',
        'PROLOGUE', 'EPILOGUE', 'ACTION', 'MACTION', 'FUNC', 'END',
        'IF', 'ELSEIF', 'ELSE', 'ENDIF',
        'SWITCH', 'CASE', 'DEFAULT', 'ENDCASE',
        'REPEAT', 'ENDREPEAT', 'WHILE', 'ENDWHILE',
        'BREAK', 'CONTINUE',
        'SET', 'SETSEG', 'COPYSEG',
        'CALL', 'EXECUTE', 'EXIT', 'FINISH', 'TERMINATE', 'SUSPEND', 'SLEEP', 'WAIT',
        'SCENE', 'APPEAR', 'DISAPPEAR', 'MOVE', 'BEEP',
        'WSIZE', 'WMOVE', 'WSAVE', 'FULLWIND', 'UPDATE',
        'MESG', 'TEXT', 'INPUT', 'KINPUT',
        'VOPEN', 'VCLOSE', 'VWAIT',
        'PRESS', 'CLICK', 'DCLICK', 'QPRESS', 'MENU', 'KEY',
        'DUP',
        'EVENT',
        'FOPEN', 'FCLOSE', 'FREAD', 'FWRITE',
        'PROCESS', 'PWAIT', 'MSEND', 'MRECV',
        'DOPEN', 'DCLOSE', 'DREAD', 'DWRITE',
        'RSINIT', 'RSPUTC', 'RSPUT', 'RSPUTN', 'RSWAIT',
        'RSGETN', 'RSGET', 'RSGETC', 'RSCNTL',
        'KEYD', 'KEYU', 'KEYC', 'BUTD', 'BUTU', 'BUTC'
    ]);

    function isKeyword(name) {
        return KEYWORDS.has(name.toUpperCase());
    }

    const BLOCK_BOUNDARY_KEYWORDS = new Set([
        'END', 'ELSEIF', 'ELSE', 'ENDIF',
        'CASE', 'DEFAULT', 'ENDCASE',
        'ENDREPEAT', 'ENDWHILE',
        'PROLOGUE', 'EPILOGUE', 'ACTION', 'MACTION', 'FUNC',
        'VERSION', 'DEFINE', 'VARIABLE', 'SEGMENT', 'SCRIPT', 'LOCAL', 'COMMENT',
        'DEBUG', 'LOG',
        'PRESS', 'CLICK', 'DCLICK', 'QPRESS', 'MENU', 'KEY',
        'BREAK', 'CONTINUE'
    ]);

    function isBlockBoundary(name) {
        return BLOCK_BOUNDARY_KEYWORDS.has(name.toUpperCase());
    }

    function MSParseError(message, token) {
        const line = token ? token.line : '?';
        const e = new Error('構文エラー(' + line + '行): ' + message);
        e.name = 'MSParseError';
        e.line = token ? token.line : 0;
        return e;
    }

    function Parser(tokens) {
        this.tokens = tokens;
        this.pos = 0;
    }

    /**
     * DEFINE マクロ (文字列置換) をトークン列上で展開する。
     * 複数トークンの本体 (例: DEFINE NUM N1,N2,N3,N4) を IDENT 位置に差し込む。 連鎖展開は16段まで
     */
    Parser.prototype._expandMacros = function (idx) {
        if (this._noExpand || !this.macros) return;
        let guard = 0;
        while (guard++ < 16) {
            const t = this.tokens[idx];
            if (!t || t.type !== 'IDENT') return;
            const body = this.macros[t.value];
            if (!body) return;
            const line = t.line;
            // spaced(直前の空白有無)を保持する。 これは単項/二項マイナス判別と
            // 関数呼び出し f(x) / 空白区切り "f (x)" の判別に使われるため、 展開で失うと
            // "swid TOGGLE"(=swid －1) のようなマクロ経由の負数リテラル引数が誤って減算/関数化する。
            // 先頭クローンは元マクロ名トークンの spaced を継承し、 後続は body 由来の spaced を使う。
            const clones = body.map(function (bt, k) {
                return { type: bt.type, value: bt.value, chars: bt.chars, line: line, spaced: k === 0 ? t.spaced : bt.spaced };
            });
            this.tokens.splice.apply(this.tokens, [idx, 1].concat(clones));
        }
    };
    Parser.prototype.peek = function (offset) {
        const idx = this.pos + (offset || 0);
        this._expandMacros(idx);
        return this.tokens[idx];
    };
    Parser.prototype.next = function () {
        this._expandMacros(this.pos);
        return this.tokens[this.pos++];
    };
    Parser.prototype.expect = function (type, value) {
        const t = this.peek();
        if (t.type !== type || (value !== undefined && t.value !== value)) {
            throw MSParseError('期待: ' + type + (value !== undefined ? ' ' + value : '') + ', 実際: ' + t.type + ' ' + JSON.stringify(t.value), t);
        }
        return this.next();
    };
    Parser.prototype.checkKW = function (kw) {
        const t = this.peek();
        return t.type === 'IDENT' && t.value.toUpperCase() === kw;
    };
    Parser.prototype.eatKW = function (kw) {
        if (this.checkKW(kw)) { this.next(); return true; }
        return false;
    };
    Parser.prototype.skipNL = function () {
        while (this.peek().type === 'NL') this.next();
    };
    Parser.prototype.expectNL = function () {
        const t = this.peek();
        if (t.type !== 'NL' && t.type !== 'EOF') {
            throw MSParseError('文末(改段落)が必要: ' + JSON.stringify(t.value), t);
        }
        if (t.type === 'NL') this.next();
    };

    Parser.prototype.parseProgram = function () {
        const prog = {
            type: 'Program',
            version: 0,
            macros: {},
            globals: [],
            segmentDecls: [],
            procedures: []
        };
        // peek/next でのマクロ展開用にマクロ表を参照可能にする (DEFINE は出現以降に適用)
        this.macros = prog.macros;
        this.skipNL();

        if (this.checkKW('VERSION')) {
            this.next();
            const v = this.expect('INT');
            prog.version = v.value;
            this.expectNL();
            this.skipNL();
        }

        while (this.peek().type !== 'EOF') {
            const t = this.peek();
            if (t.type === 'NL') { this.next(); continue; }
            if (t.type !== 'IDENT') {
                throw MSParseError('宣言または手続き定義が必要: ' + JSON.stringify(t.value), t);
            }
            const kw = t.value.toUpperCase();
            if (kw === 'DEFINE') { this.parseDefine(prog); continue; }
            if (kw === 'VARIABLE') { this.parseVarDecl(prog.globals); this.expectNL(); continue; }
            if (kw === 'SEGMENT') { this.parseSegmentDecl(prog.segmentDecls); this.expectNL(); continue; }
            if (kw === 'SCRIPT') { this.parseScriptDecl(); this.expectNL(); continue; }
            if (kw === 'COMMENT') { this.skipComment(); continue; }
            if (kw === 'DEBUG') {
                // DEBUG レベル: 0 = 実行時エラーは不正値返却のみ、 1 以上 = エラーパネル表示
                this.next();
                const lv = this.peek();
                if (lv.type === 'INT') { prog.debugLevel = lv.value; this.next(); }
                this.skipComment();
                continue;
            }
            if (kw === 'LOG') { this.skipComment(); continue; }
            if (kw === 'PROLOGUE' || kw === 'EPILOGUE') { this.parseSpecialProc(prog, kw); continue; }
            if (kw === 'ACTION' || kw === 'MACTION' || kw === 'FUNC') {
                this.parseHandler(prog, kw);
                continue;
            }
            throw MSParseError('未対応のトップレベル要素: ' + t.value, t);
        }
        return prog;
    };

    Parser.prototype.skipComment = function () {
        while (this.peek().type !== 'NL' && this.peek().type !== 'EOF') this.next();
        if (this.peek().type === 'NL') this.next();
    };

    Parser.prototype.parseDefine = function (prog) {
        // 定義行ではマクロ展開を抑止する (名前の再定義・本体トークンの収集を素のまま行う)
        this._noExpand = true;
        try {
            this.next();
            const nameTok = this.expect('IDENT');
            const body = [];
            // 本体は改段落 NL まで収集。 ';'(複文区切り) の NL は本体に含める (TEXTOUT 等の複文マクロ)
            while (this.peek().type !== 'EOF') {
                const pk = this.peek();
                if (pk.type === 'NL' && pk.value !== ';') break;
                body.push(this.next());
            }
            prog.macros[nameTok.value] = body;
            if (this.peek().type === 'NL') this.next();
        } finally {
            this._noExpand = false;
        }
    };

    Parser.prototype.parseVarDecl = function (target) {
        this.next();
        while (true) {
            const name = this.expect('IDENT').value;
            let varType = 'G';
            let size = 1;
            let shareWith = null;
            let shareOffset = 0;
            if (this.peek().type === 'OP' && this.peek().value === ':') {
                this.next();
                const tTok = this.expect('IDENT');
                const t = tTok.value.toUpperCase();
                if (['B', 'C', 'I', 'F', 'S', 'G'].indexOf(t) < 0) {
                    throw MSParseError('未知の型: ' + tTok.value, tTok);
                }
                varType = t;
            }
            if (this.peek().type === 'OP' && this.peek().value === '[') {
                this.next();
                const sz = this.parseExpr();
                this.expect('OP', ']');
                size = sz;
            }
            if (this.peek().type === 'OP' && this.peek().value === '=') {
                this.next();
                const otherTok = this.expect('IDENT');
                shareWith = otherTok.value;
                if (this.peek().type === 'OP' && this.peek().value === '[') {
                    this.next();
                    shareOffset = this.parseExpr();
                    this.expect('OP', ']');
                }
            }
            target.push({ name: name, varType: varType, size: size, shareWith: shareWith, shareOffset: shareOffset });
            if (this.peek().type === 'OP' && this.peek().value === ',') { this.next(); continue; }
            if (this.peek().type === 'IDENT' && !isKeyword(this.peek().value)) continue;
            break;
        }
    };

    Parser.prototype.parseSegmentDecl = function (target) {
        this.next();
        while (true) {
            const name = this.expect('IDENT').value;
            let size = 1;
            if (this.peek().type === 'OP' && this.peek().value === '[') {
                this.next();
                const sz = this.parseExpr();
                this.expect('OP', ']');
                size = sz;
            }
            target.push({ name: name, size: size });
            if (this.peek().type === 'OP' && this.peek().value === ',') { this.next(); continue; }
            if (this.peek().type === 'IDENT' && !isKeyword(this.peek().value)) continue;
            break;
        }
    };

    Parser.prototype.parseScriptDecl = function () {
        this.next();
        while (true) {
            this.expect('IDENT');
            if (this.peek().type === 'OP' && this.peek().value === ',') { this.next(); continue; }
            if (this.peek().type === 'IDENT' && !isKeyword(this.peek().value)) continue;
            break;
        }
    };

    Parser.prototype.parseParamList = function () {
        const params = [];
        if (this.peek().type !== 'OP' || this.peek().value !== '(') return params;
        this.next();
        if (this.peek().type === 'OP' && this.peek().value === ')') {
            this.next();
            return params;
        }
        while (true) {
            const name = this.expect('IDENT').value;
            let varType = 'G';
            let size = 1;
            if (this.peek().type === 'OP' && this.peek().value === ':') {
                this.next();
                const t = this.expect('IDENT').value.toUpperCase();
                varType = t;
            }
            if (this.peek().type === 'OP' && this.peek().value === '[') {
                this.next();
                if (this.peek().type === 'OP' && this.peek().value === ']') {
                    // 可変長配列引数 (例: Dist:S[]) — 呼出元の配列をそのまま参照渡しで受ける。 サイズは呼出時に決まる
                    size = 0;
                } else {
                    size = this.parseExpr();
                }
                this.expect('OP', ']');
            }
            params.push({ name: name, varType: varType, size: size });
            if (this.peek().type === 'OP' && this.peek().value === ',') { this.next(); continue; }
            break;
        }
        this.expect('OP', ')');
        return params;
    };

    Parser.prototype.parseSpecialProc = function (prog, kw) {
        this.next();
        this.expectNL();
        const body = this.parseBlock(['END']);
        this.expect('IDENT');
        this.expectNL();
        prog.procedures.push({ type: kw === 'PROLOGUE' ? 'Prologue' : 'Epilogue', body: body });
    };

    Parser.prototype.parseHandler = function (prog, kw) {
        this.next();
        const name = this.expect('IDENT').value;
        const params = this.parseParamList();

        let event = null;
        if (this.peek().type === 'IDENT') {
            const evtTok = this.peek();
            const evtKw = evtTok.value.toUpperCase();
            const eventNames = ['PRESS', 'CLICK', 'DCLICK', 'QPRESS', 'MENU', 'KEY'];
            if (eventNames.indexOf(evtKw) >= 0) {
                this.next();
                event = { kind: evtKw, targets: [], menu: null };
                if (evtKw === 'MENU') {
                    const tok = this.peek();
                    if (tok.type === 'STRING') {
                        this.next();
                        event.menu = tok.value;
                    }
                } else if (evtKw === 'KEY') {
                    /* no targets */
                } else {
                    // 対象セグメントは文末まで続く。 イベント名等のキーワードと同名のセグメント
                    // (例: PRESS KEY) も対象として受け入れる
                    while (this.peek().type === 'IDENT') {
                        event.targets.push(this.expect('IDENT').value);
                        if (this.peek().type === 'OP' && this.peek().value === ',') this.next();
                    }
                }
            }
        }
        this.expectNL();
        const body = this.parseBlock(['END']);
        this.expect('IDENT');
        this.expectNL();

        const type = kw === 'ACTION' ? 'Action' : (kw === 'MACTION' ? 'MAction' : 'Func');
        prog.procedures.push({ type: type, name: name, params: params, event: event, body: body });
    };

    Parser.prototype.parseBlock = function (endKeywords) {
        const stmts = [];
        while (true) {
            const t = this.peek();
            if (t.type === 'EOF') {
                throw MSParseError('予期しないファイル終端、 ブロック終端 ' + endKeywords.join('/') + ' が必要', t);
            }
            if (t.type === 'NL') { this.next(); continue; }
            if (t.type === 'IDENT') {
                const kw = t.value.toUpperCase();
                if (endKeywords.indexOf(kw) >= 0) return stmts;
            }
            const stmt = this.parseStatement();
            if (stmt) stmts.push(stmt);
        }
    };

    Parser.prototype.parseStatement = function () {
        const t = this.peek();
        if (t.type !== 'IDENT' && t.type !== 'SYSVAR') {
            throw MSParseError('文の先頭は識別子: ' + JSON.stringify(t.value), t);
        }

        if (t.type === 'IDENT') {
            const kw = t.value.toUpperCase();
            switch (kw) {
                case 'LOCAL': return this.parseLocal();
                case 'DEFINE': {
                    // 手続き本体内のローカルマクロ定義 (照明等)。 this.macros に登録し文としては無視
                    this.parseDefine({ macros: this.macros });
                    return null;
                }
                case 'COMMENT': this.skipComment(); return null;
                case 'DEBUG': this.skipComment(); return null;
                case 'LOG': { const node = this.parseMesg(); node.type = 'Log'; return node; }
                case 'IF': return this.parseIf();
                case 'WHILE': return this.parseWhile();
                case 'REPEAT': return this.parseRepeat();
                case 'SWITCH': return this.parseSwitch();
                case 'BREAK': return this.parseBreakLike('Break');
                case 'CONTINUE': this.next(); this.expectNL(); return { type: 'Continue', line: t.line };
                case 'SET': return this.parseSet(true);
                case 'EXIT': return this.parseExit();
                case 'CALL': return this.parseCall();
                case 'EXECUTE': return this.parseExecute();
                case 'FINISH': this.next(); this.expectNL(); return { type: 'Finish', line: t.line };
                case 'TERMINATE': return this.parseTerminate();
                case 'SUSPEND': return this.parseSuspend();
                case 'SLEEP': return this.parseSingleExprCmd('Sleep');
                case 'WAIT': return this.parseWait();
                case 'SCENE': return this.parseDisplayCmd('Scene', true);
                case 'APPEAR': return this.parseDisplayCmd('Appear', false);
                case 'DISAPPEAR': return this.parseDisplayCmd('Disappear', false);
                case 'MOVE': return this.parseMove();
                case 'BEEP': return this.parseBeep();
                case 'WSIZE': return this.parseTwoExprCmd('WSize');
                case 'WMOVE': return this.parseTwoExprCmd('WMove');
                case 'WSAVE': this.next(); this.expectNL(); return { type: 'WSave', line: t.line };
                case 'FULLWIND': this.next(); this.expectNL(); return { type: 'FullWind', line: t.line };
                case 'UPDATE': return this.parseSingleExprCmd('Update');
                case 'MESG': return this.parseMesg();
                case 'TEXT': return this.parseTextCmd();
                case 'INPUT': return this.parseInputCmd('Input');
                case 'KINPUT': return this.parseInputCmd('KInput');
                case 'VOPEN': return this.parseVCmd('VOpen');
                case 'VCLOSE': return this.parseVCmd('VClose');
                case 'VWAIT': return this.parseVCmd('VWait');
                case 'SETSEG': return this.parseSetSeg();
                case 'COPYSEG': return this.parseCopySeg();
                case 'EVENT': return this.parseEventCmd();
                case 'FOPEN': return this.parseGenericCmd('FOpen');
                case 'FCLOSE': return this.parseGenericCmd('FClose');
                case 'FREAD': return this.parseFreadWrite('FRead');
                case 'FWRITE': return this.parseFreadWrite('FWrite');
                case 'PROCESS': return this.parseGenericCmd('Process');
                case 'PWAIT': return this.parseGenericCmd('PWait');
                case 'MSEND': return this.parseGenericCmd('MSend');
                case 'MRECV': return this.parseGenericCmd('MRecv');
                case 'DOPEN': return this.parseGenericCmd('DOpen');
                case 'DCLOSE': return this.parseGenericCmd('DClose');
                case 'DREAD': return this.parseGenericCmd('DRead');
                case 'DWRITE': return this.parseGenericCmd('DWrite');
                case 'RSINIT': return this.parseGenericCmd('RsInit');
                case 'RSPUTC': return this.parseGenericCmd('RsPutc');
                case 'RSPUT': return this.parseGenericCmd('RsPutc');
                case 'RSPUTN': return this.parseGenericCmd('RsPutn');
                case 'RSWAIT': return this.parseGenericCmd('RsWait');
                case 'RSGETN': return this.parseGenericCmd('RsGetn');
                case 'RSGET': return this.parseGenericCmd('RsGetn');
                case 'RSGETC': return this.parseGenericCmd('RsGetc');
                case 'RSCNTL': return this.parseGenericCmd('RsCntl');
            }
        }
        return this.parseSet(false);
    };

    /**
     * 汎用コマンド: 〈引数式〉…【:〈タイムアウト式〉】
     * FOPEN/FCLOSE/PROCESS/PWAIT/MSEND/MRECV/DOPEN系/RS系 で共用。
     */
    Parser.prototype.parseGenericCmd = function (type) {
        this.next();
        const args = [];
        while (this.peek().type !== 'NL' && this.peek().type !== 'EOF') {
            if (this.peek().type === 'OP' && this.peek().value === ':') break;
            args.push(this.parseExpr());
            if (this.peek().type === 'OP' && this.peek().value === ',') { this.next(); continue; }
            const nx = this.peek();
            if (nx.type === 'IDENT' && !isBlockBoundary(nx.value)) continue;
            break;
        }
        let timeout = null;
        if (this.peek().type === 'OP' && this.peek().value === ':') {
            this.next();
            timeout = this.parseExpr();
        }
        this.expectNL();
        return { type: type, args: args, timeout: timeout };
    };

    /**
     * FREAD/FWRITE: 〈実身〉,〈レコード〉,〈オフセット〉,〈サイズ〉,〈配列変数〉【,〈レコードサイズ変数〉】
     * 配列変数とサイズ変数は LValue (代入先) として扱う必要がある。
     */
    Parser.prototype.parseFreadWrite = function (type) {
        this.next();
        const args = [];
        while (this.peek().type !== 'NL' && this.peek().type !== 'EOF') {
            if (this.peek().type === 'OP' && this.peek().value === ':') break;
            args.push(this.parseExpr());
            if (this.peek().type === 'OP' && this.peek().value === ',') { this.next(); continue; }
            break;
        }
        this.expectNL();
        return { type: type, args: args };
    };

    /**
     * EVENT 〈種別〉【,〈文字コード〉】【,〈状態〉】【:〈X〉,〈Y〉】
     */
    Parser.prototype.parseEventCmd = function () {
        this.next();
        const kindTok = this.expect('IDENT');
        const kind = kindTok.value.toUpperCase();
        const args = [];
        while (this.peek().type === 'OP' && this.peek().value === ',') {
            this.next();
            args.push(this.parseExpr());
        }
        let x = null, y = null;
        if (this.peek().type === 'OP' && this.peek().value === ':') {
            this.next();
            x = this.parseExpr();
            if (this.peek().type === 'OP' && this.peek().value === ',') {
                this.next();
                y = this.parseExpr();
            }
        }
        this.expectNL();
        return { type: 'Event', kind: kind, args: args, x: x, y: y };
    };

    Parser.prototype.parseLocal = function () {
        this.next();
        const decls = [];
        while (true) {
            const name = this.expect('IDENT').value;
            let varType = 'G';
            let size = 1;
            if (this.peek().type === 'OP' && this.peek().value === ':') {
                this.next();
                varType = this.expect('IDENT').value.toUpperCase();
            }
            if (this.peek().type === 'OP' && this.peek().value === '[') {
                this.next();
                size = this.parseExpr();
                this.expect('OP', ']');
            }
            decls.push({ name: name, varType: varType, size: size });
            if (this.peek().type === 'OP' && this.peek().value === ',') { this.next(); continue; }
            if (this.peek().type === 'IDENT' && !isKeyword(this.peek().value)) continue;
            break;
        }
        this.expectNL();
        return { type: 'Local', decls: decls };
    };

    Parser.prototype.parseSet = function (sawSetKW) {
        if (sawSetKW) this.next();
        const target = this.parseLValue();
        if (sawSetKW) {
            // SET キーワード有り: = は省略可能 (照明等の公式サンプルが採用する空白区切り記法)。
            // 例: SET selid ret / SET ＿v＿nvol 0
            if (this.peek().type === 'OP' && this.peek().value === '=') this.next();
        } else {
            // SET 無し (式行 a=b): = 必須 (裸の式行・手続き名単独行を代入と誤認しないため)
            this.expect('OP', '=');
        }
        const exprs = [this.parseExpr()];
        while (this.peek().type === 'OP' && this.peek().value === ',') {
            this.next();
            exprs.push(this.parseExpr());
        }
        this.expectNL();
        return { type: 'Set', target: target, values: exprs };
    };

    Parser.prototype.parseLValue = function () {
        const t = this.next();
        if (t.type === 'IDENT') {
            let index = null;
            let isSlice = false;
            let sliceStart = null;
            let sliceLen = null;
            if (this.peek().type === 'OP' && this.peek().value === '[') {
                this.next();
                if (this.peek().type === 'OP' && this.peek().value === ':') {
                    this.next();
                    isSlice = true;
                    if (!(this.peek().type === 'OP' && this.peek().value === ']')) {
                        sliceLen = this.parseSubExpr();
                    }
                } else {
                    const first = this.parseSubExpr();
                    if (this.peek().type === 'OP' && this.peek().value === ':') {
                        this.next();
                        isSlice = true;
                        sliceStart = first;
                        if (!(this.peek().type === 'OP' && this.peek().value === ']')) {
                            sliceLen = this.parseSubExpr();
                        }
                    } else {
                        index = first;
                    }
                }
                this.expect('OP', ']');
            }
            if (this.peek().type === 'OP' && this.peek().value === '.') {
                this.next();
                const stateName = this.expect('IDENT').value;
                return { kind: 'segstate', name: t.value, index: index, stateName: stateName };
            }
            return { kind: 'var', name: t.value, index: index, isSlice: isSlice, sliceStart: sliceStart, sliceLen: sliceLen };
        }
        if (t.type === 'SYSVAR') {
            let index = null;
            if (this.peek().type === 'OP' && this.peek().value === '[') {
                this.next();
                index = this.parseSubExpr();
                this.expect('OP', ']');
            }
            return { kind: 'sysvar', name: t.value, index: index };
        }
        throw MSParseError('代入先が不正: ' + JSON.stringify(t.value), t);
    };

    Parser.prototype.parseIf = function () {
        this.next();
        const cond = this.parseExpr();
        this.expectNL();
        const thenBody = this.parseBlock(['ELSEIF', 'ELSE', 'ENDIF']);
        const branches = [{ cond: cond, body: thenBody }];
        let elseBody = null;
        while (this.checkKW('ELSEIF')) {
            this.next();
            const c2 = this.parseExpr();
            this.expectNL();
            const b2 = this.parseBlock(['ELSEIF', 'ELSE', 'ENDIF']);
            branches.push({ cond: c2, body: b2 });
        }
        if (this.checkKW('ELSE')) {
            this.next();
            this.expectNL();
            elseBody = this.parseBlock(['ENDIF']);
        }
        this.expect('IDENT');
        this.expectNL();
        return { type: 'If', branches: branches, elseBody: elseBody };
    };

    Parser.prototype.parseWhile = function () {
        this.next();
        const cond = this.parseExpr();
        this.expectNL();
        const body = this.parseBlock(['ENDWHILE']);
        this.expect('IDENT');
        this.expectNL();
        return { type: 'While', cond: cond, body: body };
    };

    Parser.prototype.parseRepeat = function () {
        this.next();
        let count = null;
        if (this.peek().type !== 'NL') count = this.parseExpr();
        this.expectNL();
        const body = this.parseBlock(['ENDREPEAT']);
        this.expect('IDENT');
        this.expectNL();
        return { type: 'Repeat', count: count, body: body };
    };

    Parser.prototype.parseSwitch = function () {
        this.next();
        const expr = this.parseExpr();
        this.expectNL();
        this.skipNL();
        const cases = [];
        let defaultBody = null;
        while (true) {
            if (this.checkKW('CASE')) {
                this.next();
                const v = this.parseExpr();
                this.expectNL();
                const body = this.parseBlock(['CASE', 'DEFAULT', 'ENDCASE']);
                cases.push({ value: v, body: body });
                continue;
            }
            if (this.checkKW('DEFAULT')) {
                this.next();
                this.expectNL();
                defaultBody = this.parseBlock(['ENDCASE']);
                continue;
            }
            break;
        }
        this.expect('IDENT');
        this.expectNL();
        return { type: 'Switch', expr: expr, cases: cases, defaultBody: defaultBody };
    };

    Parser.prototype.parseBreakLike = function (type) {
        this.next();
        const targets = [];
        while (this.peek().type === 'IDENT' || this.peek().type === 'SYSVAR') {
            targets.push(this.parseExpr());
            if (this.peek().type === 'OP' && this.peek().value === ',') { this.next(); continue; }
            break;
        }
        this.expectNL();
        return { type: type, targets: targets };
    };

    Parser.prototype.parseExit = function () {
        this.next();
        let expr = null;
        if (this.peek().type !== 'NL' && this.peek().type !== 'EOF') {
            expr = this.parseExpr();
        }
        this.expectNL();
        return { type: 'Exit', expr: expr };
    };

    // 次トークンが式の開始になり得るか (空白区切り引数/座標の継続判定に使う)
    Parser.prototype._isExprStart = function () {
        const t = this.peek();
        if (t.type === 'INT' || t.type === 'FLOAT' || t.type === 'STRING' || t.type === 'SYSVAR') return true;
        if (t.type === 'IDENT' && !isBlockBoundary(t.value)) return true;
        if (t.type === 'OP' && (t.value === '(' || t.value === '-' || t.value === '!' || t.value === '~')) return true;
        return false;
    };

    // 括弧なし空白区切りの引数リスト (CALL 手続き名 引数... / BTRON正式仕様)
    Parser.prototype._parseBareArgList = function () {
        const _am = this._argMode; this._argMode = true; // 引数リスト: 空白区切りの負数リテラルを別引数とみなす
        const args = [];
        let afterComma = false;
        while (true) {
            const t = this.peek();
            if (t.type === 'NL' || t.type === 'EOF') break;
            if (t.type === 'OP' && (t.value === ':' || t.value === ';')) break;
            // ブロック境界キーワード(END/ENDIF等)は引数に取らない。 ただしリスト先頭・',' 直後は同名セグメント等として受理
            if (t.type === 'IDENT' && isBlockBoundary(t.value) && args.length > 0 && !afterComma) break;
            args.push(this.parseExpr());
            afterComma = false;
            if (this.peek().type === 'OP' && this.peek().value === ',') { this.next(); afterComma = true; continue; }
            const nx = this.peek();
            if (nx.type === 'IDENT' && !isBlockBoundary(nx.value)) continue;
            if (nx.type === 'INT' || nx.type === 'FLOAT' || nx.type === 'STRING' || nx.type === 'SYSVAR') continue;
            if (nx.type === 'OP' && (nx.value === '(' || nx.value === '-' || nx.value === '!' || nx.value === '~')) continue;
            break;
        }
        this._argMode = _am;
        return args;
    };

    Parser.prototype.parseCall = function () {
        this.next();
        const name = this.expect('IDENT').value;
        // 配列要素のシンボル変数 (例 CALL ＿t＿func[＿t＿active]) も手続き指定に使える
        let nameIndex = null;
        if (this.peek().type === 'OP' && this.peek().value === '[') {
            this.next();
            nameIndex = this.parseExpr();
            this.expect('OP', ']');
        }
        let args;
        if (this.peek().type === 'OP' && this.peek().value === '(') {
            // CALL 名(a,b) の括弧引数か、 CALL 名 (式)%... の括弧式第1引数かを後続トークンで判別。
            // 括弧を引数リストとして試し、 閉じ括弧の後が文末/区切りなら括弧引数、 続きがあれば
            // 括弧式が第1引数なので巻き戻して空白区切りで読む (照明: CALL 名 (式)%＿t＿ntxt)
            const savePos = this.pos;
            const tryArgs = this.parseOptionalArgList();
            const nx = this.peek();
            if (nx.type === 'NL' || nx.type === 'EOF' || (nx.type === 'OP' && (nx.value === ':' || nx.value === ';'))) {
                args = tryArgs;
            } else {
                this.pos = savePos;
                args = this._parseBareArgList();
            }
        } else {
            // 括弧なし空白区切り引数 (BTRON正式仕様 CALL 手続き名 引数...)
            args = this._parseBareArgList();
        }
        this.expectNL();
        return { type: 'Call', name: name, nameIndex: nameIndex, args: args };
    };

    Parser.prototype.parseExecute = function () {
        this.next();
        const handlers = [];
        while (true) {
            const name = this.expect('IDENT').value;
            // 配列要素のシンボル変数 (例 EXECUTE ＿v＿func[＿pid]) も手続き指定に使える
            let nameIndex = null;
            if (this.peek().type === 'OP' && this.peek().value === '[') {
                this.next();
                nameIndex = this.parseExpr();
                this.expect('OP', ']');
            }
            let args = null;
            const nxt = this.peek();
            if (nxt.type === 'OP' && nxt.value === ',') {
                handlers.push({ name: name, nameIndex: nameIndex, args: null });
                this.next();
                continue;
            }
            if (nxt.type === 'OP' && nxt.value === '(') {
                args = this.parseOptionalArgList();
            }
            handlers.push({ name: name, nameIndex: nameIndex, args: args });
            break;
        }
        let retVar = null;
        if (this.peek().type === 'OP' && this.peek().value === ':') {
            this.next();
            retVar = this.expect('IDENT').value;
        }
        this.expectNL();
        return { type: 'Execute', handlers: handlers, retVar: retVar };
    };

    Parser.prototype.parseTerminate = function () {
        return this.parseBreakLike('Terminate');
    };

    Parser.prototype.parseSuspend = function () {
        this.next();
        const targets = [];
        while (this.peek().type === 'IDENT' || this.peek().type === 'SYSVAR') {
            targets.push(this.parseExpr());
            if (this.peek().type === 'OP' && this.peek().value === ',') { this.next(); continue; }
            break;
        }
        let timeout = null;
        if (this.peek().type === 'OP' && this.peek().value === ':') {
            this.next();
            timeout = this.parseExpr();
        }
        this.expectNL();
        return { type: 'Suspend', targets: targets, timeout: timeout };
    };

    Parser.prototype.parseSingleExprCmd = function (type) {
        this.next();
        const e = this.parseExpr();
        this.expectNL();
        return { type: type, expr: e };
    };

    Parser.prototype.parseTwoExprCmd = function (type) {
        this.next();
        const a = this.parseExpr();
        if (this.peek().type === 'OP' && this.peek().value === ',') this.next();
        const b = this.parseExpr();
        this.expectNL();
        return { type: type, a: a, b: b };
    };

    Parser.prototype.parseWait = function () {
        this.next();
        const cond = this.parseExpr();
        let timeout = null;
        if (this.peek().type === 'OP' && this.peek().value === ':') {
            this.next();
            timeout = this.parseExpr();
        }
        this.expectNL();
        return { type: 'Wait', cond: cond, timeout: timeout };
    };

    Parser.prototype._parseSegArgList = function () {
        const _am = this._argMode; this._argMode = true;
        const segs = [];
        let afterComma = false;
        while (true) {
            const t = this.peek();
            if (t.type === 'NL' || t.type === 'EOF') break;
            if (t.type === 'OP' && (t.value === ':' || t.value === ';')) break;
            // キーワードと同名のセグメント (例: KEY) も、 リスト先頭および ',' 直後では引数として受け入れる
            // (境界判定は空白区切りの継続のみに適用する)
            if (t.type === 'IDENT' && isBlockBoundary(t.value) && segs.length > 0 && !afterComma) break;
            segs.push(this.parseExpr());
            afterComma = false;
            if (this.peek().type === 'OP' && this.peek().value === ',') { this.next(); afterComma = true; continue; }
            const nx = this.peek();
            if (nx.type === 'IDENT' && !isBlockBoundary(nx.value)) continue;
            break;
        }
        this._argMode = _am;
        return segs;
    };

    Parser.prototype.parseDisplayCmd = function (type, allowEmpty) {
        this.next();
        if (allowEmpty && (this.peek().type === 'NL' || this.peek().type === 'EOF')) {
            // 文末が ';' の場合は遅延表示 (UPDATE 0 と組み合わせたフレーム制御用)
            const deferredEmpty = this.peek().type === 'NL' && this.peek().value === ';';
            this.expectNL();
            return { type: type, segs: [], effect: null, steps: null, deferred: deferredEmpty };
        }
        const segs = this._parseSegArgList();
        let effect = null;
        let steps = null;
        if (this.peek().type === 'OP' && this.peek().value === ':') {
            this.next();
            effect = this.expect('IDENT').value.toUpperCase();
            steps = this.parseExpr();
        }
        // 文末が ';' の場合は遅延表示 (visibility のみ更新し描画は次の表示文まで持ち越す)
        const deferred = this.peek().type === 'NL' && this.peek().value === ';';
        this.expectNL();
        return { type: type, segs: segs, effect: effect, steps: steps, deferred: deferred };
    };

    Parser.prototype.parseMove = function () {
        const _am = this._argMode; this._argMode = true;
        this.next();
        const segs = this._parseSegArgList();
        let x = null, y = null;
        let baseSeg = null;
        let dup = false;
        if (this.peek().type === 'OP' && this.peek().value === ':') {
            this.next();
            if (this.peek().type === 'NL' || this.peek().type === 'EOF') {
            } else if (this.checkKW('DUP')) {
                this.next();
                dup = true;
            } else {
                x = this.parseExpr();
                if (this.peek().type === 'OP' && this.peek().value === ',') {
                    this.next();
                    y = this.parseExpr();
                } else if (this._isExprStart() && !(this.peek().type === 'OP' && this.peek().value === '@')) {
                    // 空白区切りの y 座標 (BTRON 公式サンプル: MOVE seg: x y @)
                    y = this.parseExpr();
                }
                // 基準セグメント: ',' 区切り or 空白区切り (BTRON 公式サンプルは空白区切りあり)
                if (this.peek().type === 'OP' && this.peek().value === ',') {
                    this.next();
                }
                if (this.peek().type === 'OP' && this.peek().value === '@') {
                    this.next();
                    baseSeg = '@';
                } else if (this.peek().type === 'IDENT' && !isBlockBoundary(this.peek().value) && !this.checkKW('DUP')) {
                    baseSeg = this.parseExpr();
                }
                if (this.peek().type === 'OP' && this.peek().value === ':') {
                    this.next();
                    if (this.checkKW('DUP')) { this.next(); dup = true; }
                }
                // DUP 修飾子は ':' なしで末尾に書ける場合もある
                if (this.checkKW('DUP')) { this.next(); dup = true; }
            }
        }
        // 文末が ';' の場合は遅延表示 (移動のみ反映し描画は持ち越す)
        const deferred = this.peek().type === 'NL' && this.peek().value === ';';
        this.expectNL();
        this._argMode = _am;
        return { type: 'Move', segs: segs, x: x, y: y, baseSeg: baseSeg, dup: dup, deferred: deferred };
    };

    Parser.prototype.parseBeep = function () {
        this.next();
        let freq = null, dur = null;
        if (this.peek().type !== 'NL' && this.peek().type !== 'EOF') {
            freq = this.parseExpr();
            if (this.peek().type === 'OP' && this.peek().value === ',') {
                this.next();
                dur = this.parseExpr();
            }
        }
        this.expectNL();
        return { type: 'Beep', freq: freq, dur: dur };
    };

    Parser.prototype.parseMesg = function () {
        this.next();
        // MESG "書式" 引数... は空白区切りも ',' 区切りも許す (照明等の公式サンプルは空白区切り)
        const args = this._parseBareArgList();
        this.expectNL();
        return { type: 'Mesg', args: args };
    };

    Parser.prototype.parseTextCmd = function () {
        this.next();
        // セグメント指定は配列要素 (B[box]) やシンボル変数も受け付けるため式としてパースする
        const seg = this.parseExpr();
        // 書式・引数は ',' 区切りでも空白区切りでも許す (照明等は空白区切り: TEXT seg "%02d" $ARG[7])
        if (this.peek().type === 'OP' && this.peek().value === ',') this.next();
        const args = this._parseBareArgList();
        this.expectNL();
        return { type: 'TextCmd', seg: seg, args: args };
    };

    Parser.prototype.parseInputCmd = function (type) {
        this.next();
        let seg = null, x = null, y = null;
        if (this.peek().type === 'IDENT' && !isKeyword(this.peek().value)) {
            // セグメント指定は配列要素 (B[box]) やシンボル変数も受け付けるため式としてパースする
            seg = this.parseExpr();
            // カーソル初期位置: 正書式はコロン区切り 「セグメント:X:Y」。 旧来のカンマ区切りも後方互換で許容
            const sepIsColon = this.peek().type === 'OP' && this.peek().value === ':';
            const sepIsComma = this.peek().type === 'OP' && this.peek().value === ',';
            if (sepIsColon || sepIsComma) {
                this.next();
                x = this.parseExpr();
                if (this.peek().type === 'OP' && (this.peek().value === ':' || this.peek().value === ',')) {
                    this.next();
                    y = this.parseExpr();
                }
            }
        }
        this.expectNL();
        return { type: type, seg: seg, x: x, y: y };
    };

    Parser.prototype.parseVCmd = function (type) {
        this.next();
        const targets = [];
        let timeout = null;
        while (this.peek().type === 'IDENT' || this.peek().type === 'STRING') {
            if (this.peek().type === 'STRING') {
                targets.push({ kind: 'string', value: this.next().value });
            } else {
                if (isKeyword(this.peek().value)) break;
                targets.push({ kind: 'name', value: this.expect('IDENT').value });
            }
            if (this.peek().type === 'OP' && this.peek().value === ',') { this.next(); continue; }
            break;
        }
        if (this.peek().type === 'OP' && this.peek().value === ':') {
            this.next();
            timeout = this.parseExpr();
        }
        this.expectNL();
        return { type: type, targets: targets, timeout: timeout };
    };

    Parser.prototype.parseSetSeg = function () {
        this.next();
        const dst = this.expect('IDENT').value;
        // 配列要素対応: dst[index]
        let dstIndex = null;
        if (this.peek().type === 'OP' && this.peek().value === '[') {
            this.next();
            dstIndex = this.parseExpr();
            this.expect('OP', ']');
        }
        this.expect('OP', '=');
        const src = this.parseExpr();
        this.expectNL();
        return { type: 'SetSeg', dst: dst, dstIndex: dstIndex, src: src };
    };

    Parser.prototype.parseCopySeg = function () {
        this.next();
        const dst = this.expect('IDENT').value;
        let dstIndex = null;
        if (this.peek().type === 'OP' && this.peek().value === '[') {
            this.next();
            dstIndex = this.parseExpr();
            this.expect('OP', ']');
        }
        this.expect('OP', '=');
        const srcs = [this.parseExpr()];
        while (this.peek().type === 'OP' && this.peek().value === ',') {
            this.next();
            srcs.push(this.parseExpr());
        }
        this.expectNL();
        return { type: 'CopySeg', dst: dst, dstIndex: dstIndex, srcs: srcs };
    };

    Parser.prototype.parseOptionalArgList = function () {
        if (!(this.peek().type === 'OP' && this.peek().value === '(')) return [];
        this.next();
        const args = [];
        if (this.peek().type === 'OP' && this.peek().value === ')') {
            this.next();
            return args;
        }
        args.push(this.parseExpr());
        while (this.peek().type === 'OP' && this.peek().value === ',') {
            this.next();
            args.push(this.parseExpr());
        }
        this.expect('OP', ')');
        return args;
    };

    const BIN_PRECEDENCE = {
        '||': 1,
        '&&': 2,
        '|': 3,
        '^': 4,
        '&': 5,
        '=': 6, '==': 6, '!=': 6,
        '<': 7, '<=': 7, '>': 7, '>=': 7,
        '+': 8, '-': 8,
        '<<': 9, '>>': 9,
        '*': 10, '/': 10, '%': 10
    };

    Parser.prototype.parseExpr = function () {
        return this.parseBinaryExpr(0);
    };
    // 添字 [..] やグループ (..) の内側は「計算式」なので、 引数リストの単項符号化(_argMode)を一時的に無効化する
    Parser.prototype.parseSubExpr = function () {
        const s = this._argMode; this._argMode = false;
        try { return this.parseExpr(); } finally { this._argMode = s; }
    };

    Parser.prototype.parseBinaryExpr = function (minPrec) {
        let lhs = this.parseUnary();
        while (true) {
            const t = this.peek();
            if (t.type !== 'OP') break;
            const prec = BIN_PRECEDENCE[t.value];
            if (prec === undefined || prec < minPrec) break;
            // 空白区切り引数中の負数リテラル (例: "swid TOGGLE"→"swid －1", "seg dx －17") のみ、
            // 二項減算でなく「次の引数の単項符号」とみなす。 誤検出を避けるため次の3条件すべてを満たす場合に限定:
            //   (1) 演算子が '-' (負数のみ。 '+' は常に二項加算とする)
            //   (2) 演算子の前に空白がある (spaced)
            //   (3) 演算子の直後に空白なしで「数値リテラル」(INT/FLOAT)が密着している
            // これにより通常の計算式 (a + b, a - b, a ＋b, a -b 等、 変数オペランド) は二項のまま壊さない。
            if (this._argMode && t.value === '-' && t.spaced) {
                const nx = this.peek(1);
                if (nx && nx.spaced === false && (nx.type === 'INT' || nx.type === 'FLOAT')) break;
            }
            this.next();
            const rhs = this.parseBinaryExpr(prec + 1);
            lhs = { type: 'Binary', op: t.value, left: lhs, right: rhs };
        }
        return lhs;
    };

    Parser.prototype.parseUnary = function () {
        const t = this.peek();
        if (t.type === 'OP' && (t.value === '-' || t.value === '!' || t.value === '~' || t.value === '+')) {
            this.next();
            const operand = this.parseUnary();
            return { type: 'Unary', op: t.value, operand: operand };
        }
        return this.parsePrimary();
    };

    Parser.prototype.parsePrimary = function () {
        const t = this.peek();
        if (t.type === 'INT') { this.next(); return { type: 'Int', value: t.value }; }
        if (t.type === 'FLOAT') { this.next(); return { type: 'Float', value: t.value }; }
        if (t.type === 'STRING') { this.next(); return { type: 'String', chars: t.value }; }
        if (t.type === 'SYSVAR') {
            this.next();
            let index = null;
            if (this.peek().type === 'OP' && this.peek().value === '[') {
                this.next();
                index = this.parseSubExpr();
                this.expect('OP', ']');
            }
            return { type: 'SysVar', name: t.value, index: index };
        }
        if (t.type === 'OP' && t.value === '(') {
            this.next();
            const e = this.parseSubExpr();
            this.expect('OP', ')');
            return e;
        }
        if (t.type === 'IDENT') {
            this.next();
            // 関数呼び出しは '(' が空白を挟まず識別子に密着している場合のみ。
            // 空白付きの "off0 （－17）" は関数呼び出しではなく、 別個の引数 (off0 と (-17)) として扱う。
            if (this.peek().type === 'OP' && this.peek().value === '(' && !this.peek().spaced) {
                this.next();
                const args = [];
                if (!(this.peek().type === 'OP' && this.peek().value === ')')) {
                    args.push(this.parseExpr());
                    while (this.peek().type === 'OP' && this.peek().value === ',') {
                        this.next();
                        args.push(this.parseExpr());
                    }
                }
                this.expect('OP', ')');
                return { type: 'Call', name: t.value, args: args };
            }
            let index = null;
            let isSlice = false;
            let sliceStart = null;
            let sliceLen = null;
            if (this.peek().type === 'OP' && this.peek().value === '[') {
                this.next();
                if (this.peek().type === 'OP' && this.peek().value === ':') {
                    this.next();
                    isSlice = true;
                    if (!(this.peek().type === 'OP' && this.peek().value === ']')) {
                        sliceLen = this.parseSubExpr();
                    }
                } else {
                    const first = this.parseSubExpr();
                    if (this.peek().type === 'OP' && this.peek().value === ':') {
                        this.next();
                        isSlice = true;
                        sliceStart = first;
                        if (!(this.peek().type === 'OP' && this.peek().value === ']')) {
                            sliceLen = this.parseSubExpr();
                        }
                    } else {
                        index = first;
                    }
                }
                this.expect('OP', ']');
            }
            let stateName = null;
            let stateIndex = null, stateIsSlice = false, stateSliceStart = null, stateSliceLen = null;
            if (this.peek().type === 'OP' && this.peek().value === '.') {
                this.next();
                stateName = this.expect('IDENT').value;
                // 状態名の後の添字/部分配列: 仕様書「文字セグメント.TX[要素数]」/「.TX[:]」(例 TX.TX[:])
                if (this.peek().type === 'OP' && this.peek().value === '[') {
                    this.next();
                    if (this.peek().type === 'OP' && this.peek().value === ':') {
                        this.next();
                        stateIsSlice = true;
                        if (!(this.peek().type === 'OP' && this.peek().value === ']')) stateSliceLen = this.parseSubExpr();
                    } else {
                        const sfirst = this.parseSubExpr();
                        if (this.peek().type === 'OP' && this.peek().value === ':') {
                            this.next();
                            stateIsSlice = true;
                            stateSliceStart = sfirst;
                            if (!(this.peek().type === 'OP' && this.peek().value === ']')) stateSliceLen = this.parseSubExpr();
                        } else {
                            stateIndex = sfirst;
                        }
                    }
                    this.expect('OP', ']');
                }
            }
            return { type: 'Name', name: t.value, index: index, isSlice: isSlice, sliceStart: sliceStart, sliceLen: sliceLen, stateName: stateName, stateIndex: stateIndex, stateIsSlice: stateIsSlice, stateSliceStart: stateSliceStart, stateSliceLen: stateSliceLen };
        }
        throw MSParseError('式が必要: ' + JSON.stringify(t.value), t);
    };

    function parse(tokens) {
        const p = new Parser(tokens);
        return p.parseProgram();
    }

    function parseExprTokens(tokens) {
        const seq = tokens.slice();
        if (!seq.length || seq[seq.length - 1].type !== 'EOF') {
            seq.push({ type: 'EOF', value: null, line: 0 });
        }
        const p = new Parser(seq);
        return p.parseExpr();
    }

    global.MSParser = { parse: parse, parseExprTokens: parseExprTokens, isKeyword: isKeyword, Parser: Parser };
})(typeof window !== 'undefined' ? window : globalThis);
