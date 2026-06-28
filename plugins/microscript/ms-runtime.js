/**
 * マイクロスクリプト ランタイム
 *
 * AST を協調的に実行する評価器、 セグメント・変数スコープ・ビルトイン関数を提供。
 * 舞台描画は CanvasStage が担当し、 本クラスは描画依頼のみを行う。
 * BTRON公式仕様(09-04-02～09-04-08, 09-04-16)に準拠。
 */
(function (global) {
    'use strict';

    const INVALID = -2147483648;
    function isInvalid(v) { return v === INVALID; }

    function codepointsToString(arr) {
        let s = '';
        for (let i = 0; i < arr.length; i++) {
            const c = arr[i];
            if (c === 0) break;
            s += String.fromCharCode(c);
        }
        return s;
    }
    function stringToCodepoints(s) {
        const arr = [];
        for (let i = 0; i < s.length; i++) arr.push(s.charCodeAt(i));
        arr.push(0);
        return arr;
    }

    function MSRuntimeError(message) {
        const e = new Error('実行時エラー: ' + message);
        e.name = 'MSRuntimeError';
        return e;
    }

    function FlowSignal(kind, value) {
        this.kind = kind;
        this.value = value;
    }

    // 変数の最大要素数 (BTRON仕様 09-03-03: 大域 1,048,576 / 局所 4,096)
    const MAX_GLOBAL_ARRAY = 1048576;
    const MAX_LOCAL_ARRAY = 4096;

    /**
     * BTRON仕様 09-03-03: 変数型ごとの値域に丸める
     * B (バイト型): 0〜255、 C (文字型): 0〜65535
     * I/F は JS の数値制約上そのまま (1.0 と 1 が区別できないため切り捨ては導入しない)
     * 数値以外 (セグメント名文字列等) は対象外
     */
    function coerceTyped(v, val) {
        if (typeof val !== 'number') return val;
        switch (v.varType) {
            case 'B': return Math.trunc(val) & 0xFF;
            case 'C': return Math.trunc(val) & 0xFFFF;
            default: return val;
        }
    }

    // 型1要素のバイト幅 (B=1, C=2, I/F/G=4)
    function _msTypeBytes(vt) { return vt === 'B' ? 1 : vt === 'C' ? 2 : 4; }
    // 共有 ArrayBuffer 上の typed view を生成 (バイト単位の記憶域共有用)
    function _msTypedView(buf, vt, byteOff, count) {
        if (vt === 'B') return new Uint8Array(buf, byteOff, count);
        if (vt === 'C') return new Uint16Array(buf, byteOff, count);
        if (vt === 'F') return new Float32Array(buf, byteOff, count);
        return new Int32Array(buf, byteOff, count); // I / G
    }

    function createVariable(decl, opts) {
        opts = opts || {};
        let sz = decl.size != null ? decl.size : 1;
        // BTRON仕様 09-03-03: 配列上限は大域 1,048,576 / 局所 4,096。 超過・不正値は丸める
        const cap = opts.isLocal ? MAX_LOCAL_ARRAY : MAX_GLOBAL_ARRAY;
        if (!Number.isFinite(sz)) sz = 1;
        sz = Math.trunc(sz);
        if (sz < 1) sz = 1;
        if (sz > cap) {
            console.warn('[MS-RT] 変数サイズが上限超過のため丸めます:', decl.name, sz, '->', cap);
            sz = cap;
        }
        const v = {
            name: decl.name,
            varType: decl.varType || 'G',
            size: sz,
            data: null,
            isScalar: false
        };
        if (sz <= 1 && !opts.forceArray) {
            v.isScalar = true;
            v.data = [0];
        } else {
            v.data = new Array(sz).fill(0);
        }
        return v;
    }

    function Scope(parent) {
        this.parent = parent;
        this.vars = new Map();
    }
    Scope.prototype.declare = function (decl, opts) {
        if (this.vars.has(decl.name)) return this.vars.get(decl.name);
        const v = createVariable(decl, opts);
        // BTRON仕様 09-03-03: 配列共有 (VARIABLE X:C[50]=A) は A と記憶域を共有する。
        // JS では要素単位の参照共有で実現 (異種型のバイト単位共有は未対応 = 制限事項)
        if (decl.shareWith) {
            const shared = this.lookup(decl.shareWith);
            if (shared) {
                const off = (decl.shareOffset | 0) || 0;
                const baseBytes = _msTypeBytes(shared.varType);
                const myBytes = _msTypeBytes(v.varType);
                if (baseBytes === myBytes) {
                    // 同型: 従来通り要素単位で共有 (offset 付きは Proxy で添字加算)
                    v.data = off ? new Proxy(shared.data, {
                        get: function (t, p) { const i = +p; return Number.isInteger(i) ? t[i + off] : t[p]; },
                        set: function (t, p, val) { const i = +p; if (Number.isInteger(i)) { t[i + off] = val; } else { t[p] = val; } return true; }
                    }) : shared.data;
                    v.isScalar = shared.isScalar;
                } else {
                    // 異種型 (例: col:B[4]=pixel:I[1]): バイト単位で記憶域を共有する。
                    // 共有 ArrayBuffer を作り、 基底と共有側を各々の型の typed view にする。
                    // これにより col[0..2] へバイト書き込み後 pixel[0] が結合整数(0xRRGGBB)として読める。
                    try {
                        if (!shared._buffer) {
                            const buf = new ArrayBuffer(shared.size * baseBytes);
                            const baseView = _msTypedView(buf, shared.varType, 0, shared.size);
                            for (let i = 0; i < shared.size; i++) baseView[i] = shared.data[i] || 0;
                            shared._buffer = buf;
                            shared.data = baseView;
                        }
                        const byteOff = off * baseBytes;
                        const avail = Math.floor((shared._buffer.byteLength - byteOff) / myBytes);
                        const cnt = Math.max(1, Math.min(v.size, avail));
                        v.data = _msTypedView(shared._buffer, v.varType, byteOff, cnt);
                        v._buffer = shared._buffer;
                        v.isScalar = false;
                    } catch (e) {
                        console.warn('[MS-RT] バイト共有に失敗、要素共有にフォールバック:', decl.name, e.message);
                        v.data = shared.data;
                        v.isScalar = shared.isScalar;
                    }
                }
            } else {
                console.warn('[MS-RT] 配列共有先が未定義:', decl.name, '=', decl.shareWith);
            }
        }
        this.vars.set(decl.name, v);
        return v;
    };
    Scope.prototype.bind = function (name, variable) {
        this.vars.set(name, variable);
    };
    Scope.prototype.lookup = function (name) {
        let s = this;
        while (s) {
            if (s.vars.has(name)) return s.vars.get(name);
            s = s.parent;
        }
        return null;
    };

    /**
     * セグメント = グループに対応する論理単位
     * shapes は groupの子figureプリミティブ配列 (Canvas で描画される)
     */
    function Segment(opts) {
        this.name = opts.name;
        this.x = opts.x || 0;
        this.y = opts.y || 0;
        this.x0 = this.x;
        this.y0 = this.y;
        // home: 作成位置(MOVE 座標省略時の復帰先)。 SCENE では追従させず、 .X0/.Y0(x0/y0)のみシフトさせる
        this.home_x = this.x;
        this.home_y = this.y;
        this.w = opts.w || 0;
        this.h = opts.h || 0;
        this.shapes = opts.shapes || [];
        this.visible = false;
        this.pid = -1;
        this._z = 0;
        this.text = opts.text || '';
        this.tfcol = -1;
        this.tbcol = 0xffffff;
        this.tstyl = 0;
        this.tsize = opts.tsize || 14;
        this.tcgap = 0;
        this.tlgap = 0;
        this.tfont = stringToCodepoints('');
        this.tx = stringToCodepoints(this.text);
        this.savedVars = new Array(50).fill(0);
        // textOverride は TEXT 命令で全体上書き時のみ true。 初期テキストは内部 text shape で描画される
        this.textOverride = false;
        this.labelShape = opts.labelShape || null;
        // 図形由来の初期文字色 (TEXT/.TX 上書き描画時、 .TFCOL 未設定なら描画に使うフォールバック色)
        this._initTextColor = opts.initTextColor || null;
        // 論理原点(ラベル込み左上)と描画原点(可視左上)の差。 SCENE/MOVE の固定オフセット補正に使う
        this.labelOffsetX = opts.labelOffsetX || 0;
        this.labelOffsetY = opts.labelOffsetY || 0;
    }

    function Runtime(opts) {
        this.stage = opts.stage;
        this.program = null;
        this.globalScope = new Scope(null);
        this.sharedVars = new Array(50).fill(0);
        // $SV (保存変数) 枠。 getSysVar/setSysVar は遅延初期化ガードを持つが、 presetSV は
        // loadProgram より前 (最初の $SV 操作) に呼ばれ得るため、 構築時に初期化しておく。
        this.savedVars = new Array(50).fill(0);
        this.macros = {};
        this.procedures = new Map();
        this.threads = new Set();
        this.nextThreadId = 1;
        this.finished = false;
        this.startTime = Date.now();
        this.systmEpoch = Date.UTC(1985, 0, 1) / 1000;
        this.lastErr = 0;
    }

    Runtime.prototype.loadProgram = function (prog) {
        this.program = prog;
        this.macros = prog.macros || {};
        for (let i = 0; i < prog.globals.length; i++) {
            const g = prog.globals[i];
            const sizeVal = this.evalConst(g.size);
            const decl = { name: g.name, varType: g.varType, size: sizeVal, shareWith: g.shareWith, shareOffset: g.shareWith ? (this.evalConst(g.shareOffset) | 0) : 0 };
            this.globalScope.declare(decl, { forceArray: sizeVal > 1 });
        }
        // SEGMENT 宣言 (可変セグメント) を globalScope に「シンボル型変数」として登録
        for (let i = 0; i < (prog.segmentDecls || []).length; i++) {
            const s = prog.segmentDecls[i];
            const sizeVal = Math.max(1, Math.min(500, this.evalConst(s.size)));
            const decl = { name: s.name, varType: 'S', size: sizeVal };
            const v = this.globalScope.declare(decl, { forceArray: sizeVal > 1 });
            v.isSegRef = true;
            // 初期値は 0 (= 空セグメント参照)
            if (sizeVal > 1) {
                // 配列宣言は SEGMENT a[3] ≡ SEGMENT a0,a1,a2 + シンボル配列 a (a[i]=ai)。
                // 要素ごとの可変セグメント変数 (名前+添字) も宣言し、 配列要素にその名前を事前に結び付ける
                for (let k = 0; k < sizeVal; k++) {
                    const elemName = s.name + k;
                    const ev = this.globalScope.declare({ name: elemName, varType: 'S', size: 1 });
                    ev.isSegRef = true;
                    ev.data[0] = elemName;
                    v.data[k] = elemName;
                }
            }
        }
        const self = this;
        (prog.procedures || []).forEach(function (proc) {
            if (proc.name) self.procedures.set(proc.name, proc);
        });
        // プログラム再ロード時に旧 proc オブジェクトをキーにした実行中カウントを破棄
        // (残存すると ACTION 単一実行判定が旧参照を見て機能しない)
        this._procRunCount = new Map();
        // segref 配列への同名セグメント分配(カード表[k]=?NN)用の出現順 consume カウンタを初期化
        this._segConsume = {};
    };

    Runtime.prototype.evalConst = function (node) {
        if (typeof node === 'number') return node;
        if (!node) return 1;
        if (node.type === 'Int' || node.type === 'Float') return node.value;
        if (node.type === 'Name') {
            if (this.macros && this.macros[node.name]) {
                const body = this.macros[node.name];
                if (body.length === 1 && (body[0].type === 'INT' || body[0].type === 'FLOAT')) {
                    return body[0].value;
                }
            }
            return 1;
        }
        if (node.type === 'Unary') {
            const v = this.evalConst(node.operand);
            if (node.op === '-') return -v;
            if (node.op === '~') return ~v;
            if (node.op === '!') return this.truthy(v) ? 0 : 1;
            return v;
        }
        if (node.type === 'Binary') {
            const l = this.evalConst(node.left);
            const r = this.evalConst(node.right);
            switch (node.op) {
                case '+': return l + r;
                case '-': return l - r;
                case '*': return l * r;
                case '/': return r === 0 ? 0 : Math.trunc(l / r);
                case '%': return r === 0 ? 0 : l - Math.trunc(l / r) * r;
                // 仕様: ビット演算・シフトは浮動小数を整数に切り捨ててから演算(evalBinary と同一規則)
                case '&': return (l | 0) & (r | 0);
                case '|': return (l | 0) | (r | 0);
                case '^': return (l | 0) ^ (r | 0);
                case '<<': return (l | 0) << (r | 0);
                case '>>': return (l | 0) >> (r | 0);
            }
        }
        return 1;
    };

    Runtime.prototype.registerSegment = function (seg) {
        this.stage.registerSegment(seg);
        this.globalScope.bind(seg.name, {
            name: seg.name, varType: 'S', size: 1,
            data: [seg.name], isScalar: true, isSegRef: true
        });
    };

    Runtime.prototype.start = function () {
        const self = this;
        this._bindEventHandlers();
        const proc = (this.program.procedures || []).find(function (p) { return p.type === 'Prologue'; });
        if (proc) {
            this.spawnThread(proc, null, []).catch(function (e) {
                self._reportError('[PROLOGUE エラー] ' + e.message);
            });
        }
    };

    /**
     * スクリプトエラーをホスト (app.js) に通知して BTRON エラーパネル風ダイアログを表示させる。
     * notifyHost 未設定時はメッセージエリアにフォールバック
     */
    // [操作] メニューで選択されたスクリプト定義メニュー項目の手続きを起動する
    Runtime.prototype.invokeMenuItem = function (index) {
        const item = this.menuItems && this.menuItems[index];
        if (!item) return;
        const self = this;
        this.spawnThread(item.proc, null, []).catch(function (e) {
            self._reportError('[' + item.proc.name + ' エラー] ' + e.message);
        });
    };

    Runtime.prototype._reportError = function (message) {
        // DEBUG 0 指定 or DEBUG 文なし (仕様: 未指定=レベル0) はエラーパネルを出さず
        // 不正値返却 + メッセージエリア表示のみ。 DEBUG 1 以上でエラーパネルを表示する
        const lv = (this.program && this.program.debugLevel != null) ? this.program.debugLevel : 0;
        if (lv < 1) {
            this.stage.message(message + '\n');
            return;
        }
        if (this.stage.notifyHost) {
            this.stage.notifyHost('script-error', { message: message });
        } else {
            this.stage.message(message + '\n');
        }
    };

    Runtime.prototype._bindEventHandlers = function () {
        const self = this;
        // MENU イベント手続き: [操作] メニュー項目として収集する (最大8個、 ホストがメニュー化)
        this.menuItems = [];
        (this.program.procedures || []).forEach(function (proc) {
            if (!proc.event) return;
            const kind = proc.event.kind;
            if (kind === 'MENU') {
                if (self.menuItems.length < 8 && proc.event.menu != null) {
                    self.menuItems.push({ label: Array.isArray(proc.event.menu) ? codepointsToString(proc.event.menu) : String(proc.event.menu), proc: proc });
                }
                return;
            }
            if (kind === 'KEY') {
                self.stage.keyHandlers.push(function (kc, mk) {
                    self.spawnThread(proc, null, [kc, mk]).catch(function (e) {
                        self._reportError('[' + proc.name + ' エラー] ' + e.message);
                    });
                });
                return;
            }
            const targets = proc.event.targets || [];
            const targetMap = {
                CLICK: self.stage.clickHandlers,
                PRESS: self.stage.pressHandlers,
                DCLICK: self.stage.dclickHandlers,
                QPRESS: self.stage.qpressHandlers
            }[kind];
            if (!targetMap) return;
            // BTRON仕様: ACTION 第2引数「番号」 = 発火セグメントが targets リスト内で何番目か (0始まり)
            // (例: PRESS カップ0,カップ1,カップ2 → カップ1 押下で 番号=1)
            // 同名セグメント共存: targets に同名が複数あるとき(ソリティアの ?01..?13×4=52枚)、 各出現を
            // 出現順 occ で別インスタンスに束縛する。 ハンドラは「インスタンスの一意キー _key」で登録し、
            // 押下した具体インスタンスだけが正しい index(=カード番号)で起動する(衝突発火しない)。
            const occCounter = {};
            targets.forEach(function (segName, targetIndex) {
                const occ = occCounter[segName] || 0;
                occCounter[segName] = occ + 1;
                const inst = self.stage.getSegmentByOcc ? self.stage.getSegmentByOcc(segName, occ) : self.stage.segments.get(segName);
                const key = inst ? inst._key : segName;
                const handler = function (seg, num, x, y) {
                    // 第1引数は seg._key(occ込み一意キー)を渡す。 seg.name(裸名)だと同名カード
                    // (?01..?13×4)を MOVE/COPYSEG する際 segments.get(name)→occ0 に化け、 赤カードの
                    // ドラッグ中ゴーストが黒スペードになる(COPYSEG カード移動枠＝s)。 occ0 は _key==name。
                    self.spawnThread(proc, null, [seg ? seg._key : null, targetIndex, x, y]).catch(function (e) {
                        console.log('[MS-RT] spawn error:', proc.name, e.message);
                        self._reportError('[' + proc.name + ' エラー] ' + e.message);
                    });
                };
                if (!targetMap.has(key)) targetMap.set(key, []);
                targetMap.get(key).push(handler);
            });
        });
    };

    Runtime.prototype.terminate = function () {
        this.finished = true;
        this.threads.forEach(function (t) { t.terminated = true; });
    };

    Runtime.prototype.spawnThread = async function (proc, parentScope, argValues) {
        // BTRON仕様 09-04-03: ACTION は単一実行 (同一手続きが実行中なら再起動しない)。
        // MACTION は多重実行可能、 FUNC/PROLOGUE/EPILOGUE は対象外
        if (!this._procRunCount) this._procRunCount = new Map();
        if (proc.type === 'Action' && (this._procRunCount.get(proc) || 0) > 0) {
            this._lastSpawnedId = INVALID;
            return;
        }
        const id = this.nextThreadId++;
        // EXECUTE :変数 (手続き番号取得) 用。 async 関数は最初の await まで同期実行されるため、
        // 呼び出し直後に _lastSpawnedId を読めば起動したスレッドの番号が得られる
        this._lastSpawnedId = id;
        const thread = { id: id, name: proc.name || proc.type, proc: proc, terminated: false };
        this.threads.add(thread);
        this._procRunCount.set(proc, (this._procRunCount.get(proc) || 0) + 1);
        const scope = new Scope(this.globalScope);
        scope._args = argValues || []; // $ARG[n] 用 (params 無し手続きの引数参照)
        if (proc.params) {
            for (let i = 0; i < proc.params.length; i++) {
                const p = proc.params[i];
                const variable = scope.declare(p, { forceArray: p.size > 1, isLocal: true });
                if (i < argValues.length) variable.data[0] = argValues[i];
            }
        }
        try {
            await this.execBlock(proc.body, scope, thread);
        } catch (sig) {
            if (sig instanceof FlowSignal) {
                /* EXIT 等は正常終了扱い */
            } else {
                throw sig;
            }
        } finally {
            this.threads.delete(thread);
            this._procRunCount.set(proc, Math.max(0, (this._procRunCount.get(proc) || 1) - 1));
        }
    };

    Runtime.prototype.execBlock = async function (stmts, scope, thread) {
        for (let i = 0; i < stmts.length; i++) {
            if (thread.terminated || this.finished) return;
            await this.execStmt(stmts[i], scope, thread);
        }
    };

    Runtime.prototype.execStmt = async function (stmt, scope, thread) {
        switch (stmt.type) {
            case 'Local': return this.stmtLocal(stmt, scope);
            case 'Set': return this.stmtSet(stmt, scope, thread);
            case 'If': return this.stmtIf(stmt, scope, thread);
            case 'While': return this.stmtWhile(stmt, scope, thread);
            case 'Repeat': return this.stmtRepeat(stmt, scope, thread);
            case 'Switch': return this.stmtSwitch(stmt, scope, thread);
            case 'Break': {
                // BTRON仕様 09-04-05: BREAK 手続き名… は指定手続きの SLEEP/WAIT/VWAIT を解除する
                // (自分のループは抜けない)。 引数なしは自分のループ/待機を抜ける
                if (stmt.targets && stmt.targets.length > 0) {
                    for (const t of stmt.targets) {
                        const name = await this.resolveProcName(t, scope, thread);
                        this.threads.forEach(function (th) {
                            if (th.name === name) th._breakSignal = true;
                        });
                    }
                    return;
                }
                throw new FlowSignal('break');
            }
            case 'Continue': throw new FlowSignal('continue');
            case 'Exit': throw new FlowSignal('exit', stmt.expr ? await this.evalExpr(stmt.expr, scope, thread) : 0);
            case 'Call': return this.stmtCall(stmt, scope, thread);
            case 'Execute': return this.stmtExecute(stmt, scope, thread);
            case 'Finish': {
                console.log('[MS-RT] FINISH');
                this.finished = true;
                this.threads.forEach(function (t) { t.terminated = true; });
                const epilogue = (this.program.procedures || []).find(function (p) { return p.type === 'Epilogue'; });
                const self = this;
                (async function () {
                    if (epilogue) {
                        try {
                            const tmpThread = { id: -1, name: 'EPILOGUE', terminated: false };
                            const scope2 = new Scope(self.globalScope);
                            await self.execBlock(epilogue.body, scope2, tmpThread);
                        } catch (e) {
                            if (!(e instanceof FlowSignal)) console.log('[MS-RT] EPILOGUE error:', e.message);
                        }
                    }
                    // このスクリプトが setgnm したグローバル名を共有ストアから削除
                    self._cleanupGnm();
                    if (typeof self.onFinish === 'function') self.onFinish();
                })();
                return;
            }
            case 'Sleep': return this.stmtSleep(stmt, scope, thread);
            case 'Wait': return this.stmtWait(stmt, scope, thread);
            case 'Mesg': return this.stmtMesg(stmt, scope, thread);
            case 'Log': return this.stmtLog(stmt, scope, thread);
            case 'TextCmd': return this.stmtText(stmt, scope, thread);
            case 'Scene': return this.stmtScene(stmt, scope, thread);
            case 'Appear': return this.stmtAppear(stmt, scope, thread);
            case 'Disappear': return this.stmtDisappear(stmt, scope, thread);
            case 'Move': return this.stmtMove(stmt, scope, thread);
            case 'Beep': return this.stmtBeep(stmt, scope, thread);
            case 'WSize': return this.stmtWSize(stmt, scope, thread);
            case 'WMove': return this.stmtWMove(stmt, scope, thread);
            case 'WSave': return this.stmtWSave(stmt);
            case 'FullWind': return this.stmtFullWind(stmt);
            case 'Update': return this.stmtUpdate(stmt, scope, thread);
            case 'Input': return this.stmtInput(stmt, scope, thread);
            case 'KInput': return this.stmtKInput(stmt, scope, thread);
            case 'VOpen': return this.stmtVOpen(stmt, scope, thread);
            case 'VClose': return this.stmtVClose(stmt, scope, thread);
            case 'VWait': return this.stmtVWait(stmt, scope, thread);
            case 'SetSeg': return this.stmtSetSeg(stmt, scope, thread);
            case 'CopySeg': return this.stmtCopySeg(stmt, scope, thread);
            case 'Terminate': return this.stmtTerminate(stmt, scope, thread);
            case 'Suspend': return this.stmtSuspend(stmt, scope, thread);
            case 'Event': return this.stmtEvent(stmt, scope, thread);
            case 'FOpen': return this.stmtFOpen(stmt, scope, thread);
            case 'FClose': return this.stmtFClose(stmt, scope, thread);
            case 'FRead': return this.stmtFRead(stmt, scope, thread);
            case 'FWrite': return this.stmtFWrite(stmt, scope, thread);
            case 'Process': return this.stmtProcess(stmt, scope, thread);
            case 'PWait': return this.stmtPWait(stmt, scope, thread);
            case 'MSend': return this.stmtMSend(stmt, scope, thread);
            case 'MRecv': return this.stmtMRecv(stmt, scope, thread);
            case 'DOpen': case 'DClose': case 'DRead': case 'DWrite':
                return this.stmtHWNoop(stmt);
            case 'RsInit': return this.stmtRsInit(stmt, scope, thread);
            case 'RsPutc': return this.stmtRsPut(stmt, scope, thread, true);  // RSPUTC/RSPUT: 入力バッファクリア
            case 'RsPutn': return this.stmtRsPut(stmt, scope, thread, false); // RSPUTN: 入力バッファ保持
            case 'RsWait': return this.stmtRsWait(stmt, scope, thread);
            case 'RsGetn': return this.stmtRsGet(stmt, scope, thread, false); // RSGETN/RSGET: 保持
            case 'RsGetc': return this.stmtRsGet(stmt, scope, thread, true);  // RSGETC: クリア
            case 'RsCntl': return this.stmtRsCntl(stmt, scope, thread);
        }
    };

    Runtime.prototype.stmtLocal = async function (stmt, scope) {
        for (let i = 0; i < stmt.decls.length; i++) {
            const d = stmt.decls[i];
            const size = typeof d.size === 'object' ? await this.evalExpr(d.size, scope, null) : d.size;
            const shareOffset = d.shareWith ? ((typeof d.shareOffset === 'object' ? await this.evalExpr(d.shareOffset, scope, null) : (d.shareOffset || 0)) | 0) : 0;
            scope.declare({ name: d.name, varType: d.varType, size: size, shareWith: d.shareWith, shareOffset: shareOffset }, { forceArray: size > 1, isLocal: true });
        }
    };

    Runtime.prototype.stmtSet = async function (stmt, scope, thread) {
        const values = [];
        for (let i = 0; i < stmt.values.length; i++) values.push(await this.evalExpr(stmt.values[i], scope, thread));
        await this.assignTarget(stmt.target, values, scope, thread);
    };

    Runtime.prototype.assignTarget = async function (target, values, scope, thread) {
        if (target.kind === 'sysvar') {
            this.setSysVar(target.name, target.index ? await this.evalExpr(target.index, scope, thread) : null, values[0], scope, thread);
            return;
        }
        if (target.kind === 'segstate') {
            let seg = this.stage.segments.get(target.name);
            if (!seg) {
                const v = scope.lookup(target.name);
                if (v) {
                    const segName = v.data[0];
                    if (typeof segName === 'string') seg = this.stage.segments.get(segName);
                }
            }
            if (seg) this.setSegState(seg, target.stateName, values[0]);
            return;
        }
        const v = scope.lookup(target.name);
        if (!v) throw MSRuntimeError('未定義の変数: ' + target.name);
        if (target.isSlice) {
            const start = (target.sliceStart != null ? await this.evalExpr(target.sliceStart, scope, thread) : 0) | 0;
            const len = (target.sliceLen != null ? await this.evalExpr(target.sliceLen, scope, thread) : (v.size - start)) | 0;
            // 複数値・並び(juxtaposition)連結に対応: 配列値は要素を展開して平坦化し、 スライスへ順に詰める。
            // 例: buff[i:n] = 文字色[:]　半角[:]　書式T.TX[:] (3配列を連結)。
            // 単一配列の spread / コンマ区切りscalar も同じ結果になり後方互換。
            let vals = [];
            for (let k = 0; k < values.length; k++) {
                if (Array.isArray(values[k])) {
                    for (let m = 0; m < values[k].length; m++) vals.push(values[k][m]);
                } else {
                    vals.push(values[k]);
                }
            }
            for (let i = 0; i < len; i++) {
                const idx = start + i;
                if (idx < 0 || idx >= v.size) break;
                const src = i < vals.length ? vals[i] : vals[vals.length - 1];
                v.data[idx] = coerceTyped(v, src);
            }
            return;
        }
        if (target.index != null) {
            // BTRON仕様: 配列インデックスは整数。 不正な index は何もしない
            const idx = (await this.evalExpr(target.index, scope, thread)) | 0;
            if (idx >= 0 && idx < v.size) {
                let val = values[0];
                // segref 配列要素に同名(複数インスタンス)セグメントを代入するとき、 出現順 consume で
                // 別インスタンスに分配し一意キーを格納する(カード表[k]=?NN を52枚へ正しく割当)。
                // イベント対象の occ と同順のため index k と カード表[k] が同一インスタンスに整合する。
                if ((v.isSegRef || v.varType === 'S') && typeof val === 'string' && this.stage.segmentsByName) {
                    const list = this.stage.segmentsByName.get(val);
                    if (list && list.length > 1) {
                        if (!this._segConsume) this._segConsume = {};
                        const occ = this._segConsume[val] || 0;
                        this._segConsume[val] = occ + 1;
                        val = (list[occ] || list[list.length - 1])._key;
                    }
                }
                v.data[idx] = coerceTyped(v, val);
            }
            return;
        }
        v.data[0] = coerceTyped(v, values[0]);
    };

    Runtime.prototype.stmtIf = async function (stmt, scope, thread) {
        for (let i = 0; i < stmt.branches.length; i++) {
            if (this.truthy(await this.evalExpr(stmt.branches[i].cond, scope, thread))) {
                await this.execBlock(stmt.branches[i].body, scope, thread);
                return;
            }
        }
        if (stmt.elseBody) await this.execBlock(stmt.elseBody, scope, thread);
    };

    Runtime.prototype.stmtWhile = async function (stmt, scope, thread) {
        while (!thread.terminated && !this.finished) {
            if (!this.truthy(await this.evalExpr(stmt.cond, scope, thread))) break;
            // yield をループ先頭(条件評価後)に置き、 CONTINUE 経路でも必ず通るようにしてフリーズを防ぐ。
            await new Promise(function (resolve) { setTimeout(resolve, 0); });
            try {
                await this.execBlock(stmt.body, scope, thread);
            } catch (sig) {
                if (sig instanceof FlowSignal) {
                    if (sig.kind === 'break') break;
                    if (sig.kind === 'continue') continue;
                }
                throw sig;
            }
        }
    };

    Runtime.prototype.stmtRepeat = async function (stmt, scope, thread) {
        const count = stmt.count != null ? await this.evalExpr(stmt.count, scope, thread) : -1;
        if (!thread._cnt) thread._cnt = { value: 0 };
        const prevCnt = thread._cnt.value;
        thread._cnt.value = 0;
        try {
            // $CNT を唯一の真実源(SSOT)とし、 スクリプトからの SET $CNT=N がループ制御に反映されるようにする
            while (!thread.terminated && !this.finished) {
                if (count >= 0 && thread._cnt.value >= count) break;
                // 無限ループ時もブラウザ UI を生かすため一定間隔 (256回毎) で macrotask へ yield。
                // ループ先頭に置くことで CONTINUE 経路 (py==ty 等で毎回 CONTINUE するドラッグループ) でも
                // 必ず通り、 yield 抜けによるフリーズを防ぐ。
                if ((thread._cnt.value & 0xff) === 0) await new Promise(function (r) { setTimeout(r, 0); });
                try {
                    await this.execBlock(stmt.body, scope, thread);
                } catch (sig) {
                    if (sig instanceof FlowSignal) {
                        if (sig.kind === 'break') break;
                        if (sig.kind === 'continue') { thread._cnt.value++; continue; }
                    }
                    throw sig;
                }
                thread._cnt.value++;
            }
        } finally {
            thread._cnt.value = prevCnt;
        }
    };

    Runtime.prototype.stmtSwitch = async function (stmt, scope, thread) {
        const base = await this.evalExpr(stmt.expr, scope, thread);
        let matched = false;
        try {
            for (let i = 0; i < stmt.cases.length; i++) {
                if (!matched && await this.evalExpr(stmt.cases[i].value, scope, thread) === base) matched = true;
                if (matched) {
                    try {
                        await this.execBlock(stmt.cases[i].body, scope, thread);
                    } catch (sig) {
                        if (sig instanceof FlowSignal && sig.kind === 'break') return;
                        throw sig;
                    }
                }
            }
            if (stmt.defaultBody) { // 仕様: マッチしたCASEからBREAKせず落ちた場合もDEFAULTを実行(fall-through)。BREAK時は上で return 済み
                try {
                    await this.execBlock(stmt.defaultBody, scope, thread);
                } catch (sig) {
                    if (sig instanceof FlowSignal && sig.kind === 'break') return;
                    throw sig;
                }
            }
        } catch (sig) {
            if (sig instanceof FlowSignal && sig.kind === 'break') return;
            throw sig;
        }
    };

    Runtime.prototype.stmtCall = async function (stmt, scope, thread) {
        let procName = stmt.name;
        // 配列要素のシンボル変数 (例 CALL ＿t＿func[＿t＿active]) は要素を評価して手続き名を取得
        if (stmt.nameIndex != null) {
            const hv = scope.lookup(stmt.name) || this.globalScope.lookup(stmt.name);
            const ix = (await this.evalExpr(stmt.nameIndex, scope, thread)) | 0;
            if (hv && hv.data && typeof hv.data[ix] === 'string') procName = hv.data[ix];
        }
        let proc = this.procedures.get(procName);
        if (!proc) {
            // S型変数に手続き名が格納されている場合 (シンボル変数経由の呼び出し) を解決
            const hv = scope.lookup(procName) || this.globalScope.lookup(procName);
            if (hv && hv.data && typeof hv.data[0] === 'string') proc = this.procedures.get(hv.data[0]);
        }
        if (!proc) throw MSRuntimeError('未定義の手続き: ' + procName);
        // [MS-RT] CALL ログは冗長なため抑制(手続き呼び出し毎に大量化するため)
        const args = [];
        const argVars = []; // 配列引数の参照渡し用 (添字なしの配列変数)
        for (let i = 0; i < stmt.args.length; i++) {
            const an = stmt.args[i];
            let av = null;
            if (an && an.type === 'Name' && an.index == null && !an.isSlice && !an.stateName) {
                const vv = scope.lookup(an.name);
                if (vv && vv.data && vv.size > 1) av = vv;
            }
            argVars.push(av);
            args.push(av ? av.data[0] : await this.evalExpr(an, scope, thread));
        }
        const callScope = new Scope(this.globalScope);
        callScope._args = args; // $ARG[n] 用 (params 無し手続きの引数参照)
        if (proc.params) {
            for (let i = 0; i < proc.params.length; i++) {
                const p = proc.params[i];
                if ((p.size === 0 || p.size > 1) && argVars[i]) {
                    // 配列引数 (Dist:S[] や固定長): 呼出元配列を参照渡し(複製しない、 変更は呼出元へ反映)
                    const variable = callScope.declare(p, { forceArray: true });
                    variable.data = argVars[i].data;
                    variable.size = argVars[i].size;
                    variable.isScalar = false;
                } else {
                    const variable = callScope.declare(p, { forceArray: p.size > 1 });
                    if (i < args.length) variable.data[0] = args[i];
                }
            }
        }
        try {
            await this.execBlock(proc.body, callScope, thread);
        } catch (sig) {
            if (sig instanceof FlowSignal && sig.kind === 'exit') return sig.value;
            throw sig;
        }
        return 0;
    };

    Runtime.prototype.stmtExecute = async function (stmt, scope, thread) {
        const self = this;
        let lastId = INVALID;
        for (let i = 0; i < stmt.handlers.length; i++) {
            const h = stmt.handlers[i];
            let procName = h.name;
            // 配列要素のシンボル変数 (例 EXECUTE ＿v＿func[＿pid]) は要素を評価して手続き名を取得
            if (h.nameIndex != null) {
                const hv = scope.lookup(h.name) || self.globalScope.lookup(h.name);
                const ix = (await self.evalExpr(h.nameIndex, scope, thread)) | 0;
                if (hv && hv.data && typeof hv.data[ix] === 'string') procName = hv.data[ix];
            }
            let proc = self.procedures.get(procName);
            if (!proc) {
                // BTRON: S型変数に手続き名が格納されている場合 (例: 対応手続き=処理A画面処理) を解決
                const hv = scope.lookup(procName) || self.globalScope.lookup(procName);
                if (hv && hv.data && typeof hv.data[0] === 'string') {
                    proc = self.procedures.get(hv.data[0]);
                }
            }
            if (!proc) continue;
            const args = [];
            const hargs = h.args || [];
            for (let j = 0; j < hargs.length; j++) args.push(await self.evalExpr(hargs[j], scope, thread));
            // 注意: EXECUTE は「並行起動」 のため await してはいけない (await すると手続きの完了まで
            // 待ってしまい仕様違反)。 spawnThread は async だが最初の await (execBlock) より前に
            // _lastSpawnedId を同期設定するため、 直後の読取で起動スレッドの番号が確定的に得られる
            self.spawnThread(proc, null, args).catch(function (e) {
                self._reportError('[' + h.name + ' エラー] ' + e.message);
            });
            lastId = self._lastSpawnedId;
        }
        // BTRON仕様 09-04-05: EXECUTE …:変数 で起動した手続き番号を変数に取得
        if (stmt.retVar) {
            const v = scope.lookup(stmt.retVar) || this.globalScope.lookup(stmt.retVar);
            if (v) v.data[0] = lastId;
        }
    };

    Runtime.prototype.stmtSleep = async function (stmt, scope, thread) {
        let ms = await this.evalExpr(stmt.expr, scope, thread);
        // BTRON仕様 09-04-05: 時間は 0〜86,400,000 ms
        if (!Number.isFinite(ms)) ms = 0;
        ms = Math.max(0, Math.min(ms, 86400000));
        // BREAK 手続き名 / TERMINATE で解除できるようチャンク待機で監視する
        const start = Date.now();
        thread._waiting = true;
        try {
            while (!thread.terminated && !this.finished) {
                // $ERR: 時間経過=0 / BREAK 解除=2
                if (thread._breakSignal) { thread._breakSignal = false; this.lastErr = 2; return; }
                const remain = ms - (Date.now() - start);
                if (remain <= 0) { this.lastErr = 0; return; }
                await new Promise(function (r) { setTimeout(r, Math.min(50, remain)); });
            }
        } finally {
            thread._waiting = false;
        }
    };

    Runtime.prototype.stmtWait = async function (stmt, scope, thread) {
        const timeoutSec = stmt.timeout ? await this.evalExpr(stmt.timeout, scope, thread) : -1;
        const start = Date.now();
        thread._waiting = true;
        try {
            while (!thread.terminated && !this.finished) {
                // $ERR: 条件成立=0 / タイムアウト=1 / BREAK 解除=2
                if (this.truthy(await this.evalExpr(stmt.cond, scope, thread))) { this.lastErr = 0; return; }
                // BREAK 手続き名 による待機解除 (BTRON仕様 09-04-05)
                if (thread._breakSignal) { thread._breakSignal = false; this.lastErr = 2; return; }
                if (timeoutSec === 0) { this.lastErr = 1; return; }
                if (timeoutSec > 0 && (Date.now() - start) >= timeoutSec * 1000) {
                    this.lastErr = 1;
                    return;
                }
                await new Promise(function (resolve) { setTimeout(resolve, 50); });
            }
        } finally {
            thread._waiting = false;
        }
    };

    // LOG: 書式文字列をコンソールに出力する (デバッグ用)
    Runtime.prototype.stmtLog = async function (stmt, scope, thread) {
        if (!stmt.args || stmt.args.length === 0) return;
        const fmt = await this.evalExpr(stmt.args[0], scope, thread);
        const rest = [];
        for (let i = 1; i < stmt.args.length; i++) rest.push(await this.evalExpr(stmt.args[i], scope, thread));
        console.log('[MS-LOG] ' + this.formatString(fmt, rest));
    };

    Runtime.prototype.stmtMesg = async function (stmt, scope, thread) {
        if (stmt.args.length === 0) {
            this.stage.clearMessage();
            return;
        }
        const fmt = await this.evalExpr(stmt.args[0], scope, thread);
        const rest = [];
        for (let i = 1; i < stmt.args.length; i++) rest.push(await this.evalExpr(stmt.args[i], scope, thread));
        this.stage.message(this.formatString(fmt, rest) + '\n');
    };

    Runtime.prototype.stmtText = async function (stmt, scope, thread) {
        // セグメント指定 (式: 名前/シンボル変数/配列要素) を解決
        const segName = await this.resolveSegName(stmt.seg, scope, thread);
        const seg = segName ? this.stage.segments.get(segName) : null;
        if (!seg) throw MSRuntimeError('未定義のセグメント: ' + (segName || (stmt.seg && stmt.seg.name) || stmt.seg));
        if (stmt.args.length === 0) {
            seg.text = '';
        } else {
            const fmt = await this.evalExpr(stmt.args[0], scope, thread);
            const rest = [];
            for (let i = 1; i < stmt.args.length; i++) rest.push(await this.evalExpr(stmt.args[i], scope, thread));
            seg.text = this.formatString(fmt, rest);
        }
        if (seg.shapes) {
            for (const s of seg.shapes) {
                if (s.kind === 'text') s._hidden = true;
            }
        }
        seg.tx = stringToCodepoints(seg.text);
        seg.textOverride = true;
        this.stage.applyText(seg);
    };

    Runtime.prototype.stmtScene = async function (stmt, scope, thread) {
        this.stage.segments.forEach(function (seg) { seg.visible = false; });
        if (!stmt.segs || stmt.segs.length === 0) {
            if (!stmt.deferred) this.stage.render();
            return;
        }
        const segs = [];
        for (let i = 0; i < stmt.segs.length; i++) {
            const name = await this.resolveSegName(stmt.segs[i], scope, thread);
            if (name) {
                const s = this.stage.segments.get(name);
                if (s) segs.push(s);
            }
        }
        // 論理原点(ラベル込みグループ左上 = x0 + labelOffset)で最小を求めて左上へ寄せる。
        // 痩せ再計算で描画原点(x0)が可視左上にずれても、 シーン全体の配置基準は論理原点に統一する
        let minX = Infinity, minY = Infinity;
        segs.forEach(function (s) {
            // 配置基準は home(作成位置)。 SCENE で x0 を更新しても二重シフトしないよう home を基準にする
            const hx = (s.home_x != null ? s.home_x : s.x0);
            const hy = (s.home_y != null ? s.home_y : s.y0);
            const lx = hx + (s.labelOffsetX || 0);
            const ly = hy + (s.labelOffsetY || 0);
            if (lx < minX) minX = lx;
            if (ly < minY) minY = ly;
        });
        if (!isFinite(minX)) minX = 0;
        if (!isFinite(minY)) minY = 0;
        segs.forEach(function (s) {
            const hx = (s.home_x != null ? s.home_x : s.x0);
            const hy = (s.home_y != null ? s.home_y : s.y0);
            s.x = hx - minX;
            s.y = hy - minY;
            // SCENE では .X0/.Y0(x0/y0)も配置後の元位置に追従させる(home は不変)
            s.x0 = s.x;
            s.y0 = s.y;
        });
        for (let i = 0; i < segs.length; i++) this.stage.bringToFront(segs[i]);
        // 文末 ';' (遅延表示): visibility のみ更新し、 描画は次の表示文までまとめる
        if (stmt.deferred) {
            for (let i = 0; i < segs.length; i++) segs[i].visible = true;
            return;
        }
        if (stmt.effect && this.stage.runSceneTransition) {
            const stepVal = stmt.steps ? await this.evalExpr(stmt.steps, scope, thread) : 10;
            const self = this;
            await new Promise(function (resolve) {
                self.stage.runSceneTransition(segs, stmt.effect, stepVal, resolve);
            });
        } else {
            for (let i = 0; i < segs.length; i++) segs[i].visible = true;
            this.stage.render();
        }
    };

    Runtime.prototype.stmtAppear = async function (stmt, scope, thread) {
        const segs = [];
        for (let i = 0; i < stmt.segs.length; i++) {
            const name = await this.resolveSegName(stmt.segs[i], scope, thread);
            if (!name) continue;
            const seg = this.stage.segments.get(name);
            if (!seg) continue;
            if (!seg.visible) {
                this.stage.bringToFront(seg);
                segs.push(seg);
            }
        }
        // 文末 ';' (遅延表示): visibility のみ更新し、 描画は次の表示文までまとめる
        if (stmt.deferred) {
            segs.forEach(function (s) { s.visible = true; });
            return;
        }
        if (stmt.effect && this.stage.runSceneTransition && segs.length > 0) {
            const stepVal = stmt.steps ? await this.evalExpr(stmt.steps, scope, thread) : 10;
            const self = this;
            await new Promise(function (resolve) {
                self.stage.runSceneTransition(segs, stmt.effect, stepVal, resolve);
            });
        } else {
            segs.forEach(function (s) { s.visible = true; });
            this.stage.render();
        }
    };

    Runtime.prototype.stmtDisappear = async function (stmt, scope, thread) {
        const segs = [];
        for (let i = 0; i < stmt.segs.length; i++) {
            const name = await this.resolveSegName(stmt.segs[i], scope, thread);
            if (!name) continue;
            const seg = this.stage.segments.get(name);
            if (!seg) continue;
            if (seg.visible) segs.push(seg);
        }
        // 文末 ';' (遅延表示): visibility のみ更新し、 描画は次の表示文までまとめる
        if (stmt.deferred) {
            segs.forEach(function (s) { s.visible = false; });
            return;
        }
        // BTRON仕様 09-04-06: DISAPPEAR も効果指定可能 (APPEAR の逆方向遷移)
        if (stmt.effect && this.stage.runSceneTransition && segs.length > 0) {
            const stepVal = stmt.steps ? await this.evalExpr(stmt.steps, scope, thread) : 10;
            const self = this;
            await new Promise(function (resolve) {
                self.stage.runSceneTransition(segs, stmt.effect, stepVal, resolve, { hide: true });
            });
        } else {
            segs.forEach(function (s) { s.visible = false; });
            this.stage.render();
        }
    };

    Runtime.prototype.stmtMove = async function (stmt, scope, thread) {
        const dx = stmt.x != null ? await this.evalExpr(stmt.x, scope, thread) : null;
        const dy = stmt.y != null ? await this.evalExpr(stmt.y, scope, thread) : null;
        let baseName = null;
        if (stmt.baseSeg && stmt.baseSeg !== '@') {
            baseName = await this.resolveSegName(stmt.baseSeg, scope, thread);
        }
        for (let i = 0; i < stmt.segs.length; i++) {
            const name = await this.resolveSegName(stmt.segs[i], scope, thread);
            if (!name) continue;
            const seg = this.stage.segments.get(name);
            if (!seg) continue;
            // 座標省略: 元位置 (x0/y0) に戻し、 DUP で作った複製はすべて削除する
            if (dx === null && dy === null) {
                // 仕様: 座標省略は作成位置(home, SCENE非追従)へ戻す
                seg.x = (seg.home_x != null ? seg.home_x : seg.x0);
                seg.y = (seg.home_y != null ? seg.home_y : seg.y0);
                const dupPrefix = name + '_dup';
                const toRemove = [];
                this.stage.segments.forEach(function (s, key) {
                    if (typeof key === 'string' && key.indexOf(dupPrefix) === 0) toRemove.push(key);
                });
                for (let k = 0; k < toRemove.length; k++) this.stage.segments.delete(toRemove[k]);
                continue;
            }
            // 移動先座標を算出
            let tx, ty;
            if (stmt.baseSeg === '@') {
                // @ 基準: ウィンドウ作業エリア基準の絶対位置
                tx = dx; ty = dy;
            } else if (baseName) {
                // base(choice)の可視左上 + dx,dy。 xofs/yofs は図形エディタで可視左上基準に実測された固定値のため
                // labelOffset 補正は行わない。 SCENE 側の論理原点シフトで base.x は既にシーン座標へ整合済み
                const base = this.stage.segments.get(baseName);
                tx = base ? base.x + (dx || 0) : seg.x;
                ty = base ? base.y + (dy || 0) : seg.y;
            } else {
                // 基準省略: 現在位置からの相対増分 (BTRONサンプル慣用、 累積される)
                tx = seg.x + (dx || 0); ty = seg.y + (dy || 0);
            }
            if (stmt.dup) {
                // :DUP は複製を移動先に置き、 原本はその場に残す (BTRON仕様)。 文字/仮身セグメントは複製不可
                const hasLink = (seg.shapes || []).some(function (s) { return s.kind === 'link'; });
                const isTextSeg = (seg.shapes || []).length > 0 && seg.shapes.every(function (s) { return s.kind === 'text'; });
                if (hasLink || isTextSeg) continue;
                this._dupCount = (this._dupCount || 0);
                if (this._dupCount < 16380) {
                    const dupName = name + '_dup' + (++this._dupCount);
                    const dup = new Segment({
                        name: dupName, x: tx, y: ty, w: seg.w, h: seg.h,
                        shapes: seg.shapes, tsize: seg.tsize,
                        labelOffsetX: seg.labelOffsetX, labelOffsetY: seg.labelOffsetY
                    });
                    dup.visible = true;
                    this.stage.registerSegment(dup);
                }
                // 原本 seg は動かさない (複製が移動先に行く)
            } else {
                seg.x = tx; seg.y = ty;
            }
        }
        // 文末 ';' (遅延表示): 位置のみ更新し、 描画は次の表示文までまとめる
        if (!stmt.deferred) this.stage.render();
    };

    // 鳴っている音を即座に無音化する (BTRON BEEP は単一チャンネル: 新しい音や停止指示が前の音を止める)。
    // osc.stop() は生成時に dur 後の停止を予約済みのため、 2 回呼ぶと InvalidStateError になり即時停止
    // できない。 gain を即 0 にして無音化し、 osc は予約時刻に自然終了して onended でリソース解放される
    Runtime.prototype._stopAllBeep = function (ctx) {
        if (this._beepNodes) {
            const ct = ctx.currentTime;
            this._beepNodes.forEach(function (n) {
                try {
                    if (n._gainNode) {
                        n._gainNode.gain.cancelScheduledValues(ct);
                        n._gainNode.gain.setValueAtTime(0, ct);
                    }
                } catch (e2) { /* 切断済み等は無視 */ }
            });
            this._beepNodes = [];
        }
    };

    Runtime.prototype.stmtBeep = async function (stmt, scope, thread) {
        try {
            const ctx = this._audioCtx || (this._audioCtx = new (window.AudioContext || window.webkitAudioContext)());
            const freq = stmt.freq ? await this.evalExpr(stmt.freq, scope, thread) : 1000;
            const dur = stmt.dur ? await this.evalExpr(stmt.dur, scope, thread) : 200;
            // 新しい音 (freq≠0) を鳴らす前、 または停止指示 (freq===0) では、 現在鳴っている音を必ず止める。
            // 例: 鍵盤を離すと sound(0)→BEEP 5,2000 (freq≠0) が発行されるが、 先に前の音を止めるので
            // 押下中だけ鳴る (BTRON BEEP の単一チャンネル挙動)
            this._stopAllBeep(ctx);
            if (freq === 0) {
                return;
            }
            if (freq < 0) {
                // 負値: メロディ番号。 時間式は繰り返し回数 (システム登録メロディの簡易近似)
                this._playMelody(ctx, -freq, Math.max(1, dur | 0));
                return;
            }
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.frequency.value = freq;
            osc.type = 'sine';
            osc.connect(gain);
            gain.connect(ctx.destination);
            gain.gain.value = 0.2;
            osc.start();
            osc.stop(ctx.currentTime + dur / 1000);
            osc._gainNode = gain; // BEEP 0 / 次の音による即時無音化に使用
            if (!this._beepNodes) this._beepNodes = [];
            this._beepNodes.push(osc);
            const self = this;
            // 再生完了後にノードを切断 (多数の BEEP 実行によるノード蓄積防止)
            osc.onended = function () {
                try { osc.disconnect(); gain.disconnect(); } catch (e2) { /* 切断済みは無視 */ }
                if (self._beepNodes) {
                    const idx = self._beepNodes.indexOf(osc);
                    if (idx >= 0) self._beepNodes.splice(idx, 1);
                }
            };
        } catch (e) {
            /* WebAudio未対応環境は無視 */
        }
    };

    // メロディ音 (BEEP 負値)。 番号ごとの音階列を簡易定義し、 指定回数繰り返す
    Runtime.prototype._playMelody = function (ctx, melodyNo, repeat) {
        const MELODIES = [
            [523, 659, 784],           // 1: 上昇 (ド・ミ・ソ)
            [784, 659, 523],           // 2: 下降 (ソ・ミ・ド)
            [523, 784, 523, 784],      // 3: 交互
            [659, 659, 659],           // 4: 同音連打
            [523, 587, 659, 698, 784]  // 5: 音階
        ];
        const notes = MELODIES[((melodyNo - 1) % MELODIES.length + MELODIES.length) % MELODIES.length];
        const noteDur = 0.12;
        if (!this._beepNodes) this._beepNodes = [];
        const self = this;
        let t = ctx.currentTime;
        for (let r = 0; r < Math.min(repeat, 16); r++) {
            for (let n = 0; n < notes.length; n++) {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.frequency.value = notes[n];
                osc.type = 'square';
                osc.connect(gain);
                gain.connect(ctx.destination);
                gain.gain.value = 0.15;
                osc.start(t);
                osc.stop(t + noteDur);
                osc._gainNode = gain; // BEEP 0 による即時無音化に使用
                this._beepNodes.push(osc);
                osc.onended = function () {
                    try { osc.disconnect(); gain.disconnect(); } catch (e2) {}
                    const idx = self._beepNodes.indexOf(osc);
                    if (idx >= 0) self._beepNodes.splice(idx, 1);
                };
                t += noteDur + 0.02;
            }
            t += 0.1;
        }
    };

    Runtime.prototype.truthy = function (v) {
        if (typeof v === 'number') return v !== 0;
        if (Array.isArray(v)) return v.length > 0 && v[0] !== 0;
        return !!v;
    };

    Runtime.prototype.evalExpr = async function (node, scope, thread) {
        if (!node) return 0;
        switch (node.type) {
            case 'Int': return node.value;
            case 'Float': return node.value;
            case 'String': { const c = node.chars.slice(); c.push(0); return c; } // 文字列は末尾に自動的に0(ヌル終端)が付く
            case 'Unary': {
                const v = await this.evalExpr(node.operand, scope, thread);
                if (node.op === '-') return -v;
                if (node.op === '+') return +v;
                if (node.op === '!') return this.truthy(v) ? 0 : 1;
                if (node.op === '~') return ~v;
                return v;
            }
            case 'Binary': return await this.evalBinary(node, scope, thread);
            case 'SysVar': return this.getSysVar(node.name, node.index ? await this.evalExpr(node.index, scope, thread) : null, thread, scope);
            case 'Call': return await this.callBuiltin(node, scope, thread);
            case 'Name': return await this.evalName(node, scope, thread);
        }
        return 0;
    };

    // 式が浮動小数型かを宣言型/リテラル/関数から判定する (除算の整数/浮動判定に使用)。
    // BTRON仕様: Float 変数や浮動小数リテラル(π 等)・三角関数が絡む除算は、 実行時の値が
    // たまたま整数(例: Float L に整数 50 が入っている)でも浮動小数除算とする。
    // 値ベース(Number.isInteger)判定だけだと L/max=50/100 が整数除算され 0 になる不具合を防ぐ。
    Runtime.prototype._exprIsFloat = function (node, scope) {
        if (!node) return false;
        switch (node.type) {
            case 'Float': return true;
            case 'Int': return false;
            case 'Name': {
                const v = scope ? scope.lookup(node.name) : null;
                return !!(v && v.varType === 'F');
            }
            case 'Unary': return this._exprIsFloat(node.operand, scope);
            case 'Binary': return this._exprIsFloat(node.left, scope) || this._exprIsFloat(node.right, scope);
            case 'Call': {
                const fn = (node.name || '').toLowerCase();
                return fn === 'sin' || fn === 'cos' || fn === 'tan' || fn === 'atan'
                    || fn === 'asin' || fn === 'acos' || fn === 'sqrt' || fn === 'exp' || fn === 'log';
            }
        }
        return false;
    };

    Runtime.prototype.evalBinary = async function (node, scope, thread) {
        const op = node.op;
        if (op === '&&') {
            if (!this.truthy(await this.evalExpr(node.left, scope, thread))) return 0;
            return this.truthy(await this.evalExpr(node.right, scope, thread)) ? 1 : 0;
        }
        if (op === '||') {
            if (this.truthy(await this.evalExpr(node.left, scope, thread))) return 1;
            return this.truthy(await this.evalExpr(node.right, scope, thread)) ? 1 : 0;
        }
        const l = await this.evalExpr(node.left, scope, thread);
        const r = await this.evalExpr(node.right, scope, thread);
        // 不正値の伝播 (BTRON仕様: 式の計算時に異常があれば結果も不正値)
        if (typeof l === 'number' && typeof r === 'number' && (isInvalid(l) || isInvalid(r))) {
            // 比較・論理演算は不正値判定を許容するため除外
            if (op !== '=' && op !== '==' && op !== '!=' && op !== '&&' && op !== '||') return INVALID;
        }
        switch (op) {
            case '+': return l + r;
            case '-': return l - r;
            case '*': return l * r;
            case '/':
                if (r === 0) return l >= 0 ? 2147483647 : -2147483648;
                // BTRON仕様: 両辺が整数なら整数除算 (切り捨て)、 いずれか浮動小数なら浮動小数除算。
                // 宣言型/リテラルから浮動小数が絡むかを判定する。 Float 変数(L 等)に整数値が入って
                // いても浮動小数除算とする (値ベース判定のみだと L/max が整数除算され 0 になる)。
                if (this._exprIsFloat(node.left, scope) || this._exprIsFloat(node.right, scope)) return l / r;
                return (Number.isInteger(l) && Number.isInteger(r)) ? Math.trunc(l / r) : l / r;
            case '%': {
                // BTRON仕様: % は浮動小数値を整数に切り捨ててから剰余
                const li = Math.trunc(l), ri = Math.trunc(r);
                if (ri === 0) return li >= 0 ? 2147483647 : -2147483648;
                return li - Math.trunc(li / ri) * ri;
            }
            case '<': return l < r ? 1 : 0;
            case '<=': return l <= r ? 1 : 0;
            case '>': return l > r ? 1 : 0;
            case '>=': return l >= r ? 1 : 0;
            case '=':
            case '==': return l === r ? 1 : 0;
            case '!=': return l !== r ? 1 : 0;
            case '&': return (l | 0) & (r | 0);
            case '|': return (l | 0) | (r | 0);
            case '^': return (l | 0) ^ (r | 0);
            case '<<': return (l | 0) << (r | 0);
            case '>>': return (l | 0) >> (r | 0);
        }
        return 0;
    };

    Runtime.prototype.evalName = async function (node, scope, thread) {
        if (node.stateName) {
            let seg = this.stage.segments.get(node.name);
            if (!seg) {
                const v = scope.lookup(node.name);
                if (v) {
                    let idx = 0;
                    if (node.index != null) {
                        // BTRON仕様: インデックスは整数 (浮動小数は切り捨て)
                        idx = (await this.evalExpr(node.index, scope, thread)) | 0;
                    }
                    const segName = v.data[idx];
                    if (typeof segName === 'string') {
                        seg = this.stage.segments.get(segName);
                    }
                }
            }
            if (seg) {
                const sv = this.getSegState(seg, node.stateName);
                // 状態名の後の添字/部分配列 (.TX[:] / .TX[i]) を配列結果に適用 (仕様書 .TX[要素数])
                if (Array.isArray(sv)) {
                    if (node.stateIsSlice) {
                        const st = (node.stateSliceStart != null ? await this.evalExpr(node.stateSliceStart, scope, thread) : 0) | 0;
                        const ln = (node.stateSliceLen != null ? await this.evalExpr(node.stateSliceLen, scope, thread) : (sv.length - st)) | 0;
                        return sv.slice(st, st + ln);
                    }
                    if (node.stateIndex != null) {
                        const ix = (await this.evalExpr(node.stateIndex, scope, thread)) | 0;
                        return (ix < 0 || ix >= sv.length) ? INVALID : sv[ix];
                    }
                }
                return sv;
            }
            // BTRON仕様 09-03-03: 手続き名.S は手続き状態 (0:停止 1:実行中 2:待機)
            if (node.stateName.toUpperCase() === 'S' && this.procedures.has(node.name)) {
                let state = 0;
                this.threads.forEach(function (th) {
                    if (th.name === node.name && !th.terminated) {
                        state = th._waiting ? 2 : (state === 2 ? 2 : 1);
                    }
                });
                return state;
            }
            return 0;
        }
        if (this.stage.segments.has(node.name) && node.index == null && !node.isSlice) {
            return node.name;
        }
        // 配列セグメント要素: カップ[$CNT] 等 (状態名なし) → セグメント名文字列
        if (node.index != null) {
            const v0 = scope.lookup(node.name);
            if (v0 && (v0.isSegRef || v0.varType === 'S')) {
                const idx = (await this.evalExpr(node.index, scope, thread)) | 0;
                const segName = v0.data[idx];
                if (typeof segName === 'string') return segName;
            }
        }
        const v = scope.lookup(node.name);
        if (!v) {
            if (this.macros && this.macros[node.name]) {
                const body = this.macros[node.name];
                // 単一の INT/FLOAT は高速パス
                if (body.length === 1) {
                    if (body[0].type === 'INT' || body[0].type === 'FLOAT') return body[0].value;
                    if (body[0].type === 'IDENT') {
                        // 別名 (識別子マクロ) は再帰評価
                        return await this.evalExpr({ type: 'Name', name: body[0].value }, scope, thread);
                    }
                }
                // 複雑な式マクロ: トークン列を AST に再パースして評価
                try {
                    if (window.MSParser && window.MSParser.parseExprTokens) {
                        const expr = window.MSParser.parseExprTokens(body);
                        return await this.evalExpr(expr, scope, thread);
                    }
                } catch (e) {
                    console.log('[MS-RT] マクロ式評価エラー:', node.name, e.message);
                }
                return 0;
            }
            return node.name;
        }
        if (node.isSlice) {
            const start = (node.sliceStart != null ? await this.evalExpr(node.sliceStart, scope, thread) : 0) | 0;
            const len = (node.sliceLen != null ? await this.evalExpr(node.sliceLen, scope, thread) : (v.size - start)) | 0;
            // typed array(バイト共有)でもプレーン配列を返す (連結代入の Array.isArray 判定等に揃える)
            return Array.prototype.slice.call(v.data, start, start + len);
        }
        if (node.index != null) {
            // BTRON仕様: 配列インデックスは整数。 浮動小数は切り捨て。 不正なインデックスは不正値を返す
            const idx = (await this.evalExpr(node.index, scope, thread)) | 0;
            if (idx < 0 || idx >= v.size) return INVALID;
            const val = v.data[idx];
            return (val === undefined || val === null) ? 0 : val;
        }
        return v.data[0];
    };

    Runtime.prototype.resolveSegName = async function (expr, scope, thread) {
        if (typeof expr === 'string') return expr;
        const v = await this.evalExpr(expr, scope, thread);
        if (typeof v === 'string') return v;
        if (Array.isArray(v)) return codepointsToString(v);
        return null;
    };

    /**
     * BREAK/TERMINATE 等の対象手続き名を解決する
     * (識別子はそのまま手続き名、 それ以外は評価して文字列化)
     */
    Runtime.prototype.resolveProcName = async function (expr, scope, thread) {
        if (typeof expr === 'string') return expr;
        if (expr && expr.type === 'Name' && expr.index == null && !expr.stateName) return expr.name;
        const v = await this.evalExpr(expr, scope, thread);
        if (typeof v === 'string') return v;
        if (Array.isArray(v)) return codepointsToString(v);
        return null;
    };

    Runtime.prototype.setSegState = function (seg, stateName, value) {
        const u = stateName.toUpperCase();
        switch (u) {
            // --- 設定可能な状態名 (仕様: 参照・設定可能) ---
            case 'TFCOL': seg.tfcol = value; this.stage.render(); return;
            // 背景色は初期値 (白) のままでは塗らず、 明示的に設定されたときのみ描画する
            case 'TBCOL': seg.tbcol = value; seg._tbcolSet = true; this.stage.render(); return;
            case 'TSTYL': seg.tstyl = value; this.stage.render(); return;
            case 'TSIZE': seg.tsize = (value === 0) ? 16 : value; this.stage.render(); return; // 仕様: 0は標準16ドット
            case 'TCGAP': seg.tcgap = value; this.stage.render(); return;
            case 'TLGAP': seg.tlgap = value; this.stage.render(); return;
            case 'TFONT':
                if (Array.isArray(value)) seg.tfont = value.slice();
                return;
            // --- 参照のみ (仕様: 設定不可) ---
            // .X/.Y/.X0/.Y0 は MOVE文、 .S は SCENE/APPEAR/DISAPPEAR、 .TX/.V は TEXT文 で変更する。
            // 状態名への代入は仕様で不可のため no-op (安全に無視)。
            case 'S':
            case 'X':
            case 'Y':
            case 'X0':
            case 'Y0':
            case 'V':
            case 'PID':
            case 'TX':
            case 'TL':
            case 'W':
            case 'H':
                return;
        }
    };

    Runtime.prototype.getSegState = function (seg, stateName) {
        switch (stateName.toUpperCase()) {
            case 'S': return seg.visible ? 1 : 0;
            case 'PID': return seg.pid;
            case 'X': return seg.x;
            case 'Y': return seg.y;
            case 'X0': return seg.x0;
            case 'Y0': return seg.y0;
            case 'W': return seg.w;
            case 'H': return seg.h;
            case 'V': {
                // 全角数字の入力も数値化できるよう正規化してから解釈する
                let vText = codepointsToString(seg.tx);
                if (global.MSLexer && global.MSLexer.normalize) vText = global.MSLexer.normalize(vText);
                const n = parseFloat(vText);
                return isNaN(n) ? 0 : n; // 仕様: 数値解釈不可なら0(INVALIDでない)
            }
            case 'TL': return codepointsToString(seg.tx).length;
            case 'TX': return seg.tx.slice();
            case 'TFCOL': return seg.tfcol;
            case 'TBCOL': return seg.tbcol;
            case 'TSTYL': return seg.tstyl;
            case 'TSIZE': return seg.tsize;
            case 'TCGAP': return seg.tcgap;
            case 'TLGAP': return seg.tlgap;
            case 'TFONT': return seg.tfont.slice();
        }
        return 0;
    };

    // $SV は「仮身ごとに」不揮発保存するため、 実身 ID をキーに含めて隔離する
    Runtime.prototype._svKey = function () {
        return 'ms_sv_' + (this.realId || 'default');
    };
    Runtime.prototype._loadSV = function () {
        if (this._svLoaded) return;
        this._svLoaded = true;
        try {
            if (typeof localStorage !== 'undefined') {
                const stored = localStorage.getItem(this._svKey());
                if (stored) {
                    this._svHadStored = true; // 保存値あり = 2回目以降 (figure 初期値で上書きしない)
                    const arr = JSON.parse(stored);
                    if (Array.isArray(arr)) for (let i = 0; i < 50 && i < arr.length; i++) this.savedVars[i] = arr[i] | 0;
                }
            }
        } catch (e) {}
    };
    // figure の数値欄初期値を $SV に反映する (初回のみ)。 localStorage に保存値があれば
    // 永続値 (前回入力値) を優先し上書きしない
    Runtime.prototype.presetSV = function (index, value) {
        this._loadSV();
        if (this._svHadStored) return;
        if (index >= 0 && index < 50) this.savedVars[index] = value | 0;
    };
    Runtime.prototype._storeSV = function () {
        try {
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem(this._svKey(), JSON.stringify(this.savedVars));
            }
        } catch (e) {}
    };

    // $GV はシステム全体 (全マイクロスクリプトウィンドウ) で共有する。
    // 同期 API のまま共有するため localStorage を共有ストアとし、 短い間隔でキャッシュを更新する
    Runtime.prototype._loadGV = function () {
        const now = Date.now();
        if (this._gvLoadedAt && (now - this._gvLoadedAt) < 50) return;
        this._gvLoadedAt = now;
        try {
            if (typeof localStorage !== 'undefined') {
                const stored = localStorage.getItem('ms_gv');
                if (stored) {
                    const arr = JSON.parse(stored);
                    if (Array.isArray(arr)) for (let i = 0; i < 50 && i < arr.length; i++) this.sharedVars[i] = arr[i] | 0;
                }
            }
        } catch (e) {}
    };
    Runtime.prototype._storeGV = function () {
        try {
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem('ms_gv', JSON.stringify(this.sharedVars));
            }
        } catch (e) {}
    };

    Runtime.prototype.getSysVar = function (name, index, thread, scope) {
        const u = name.toUpperCase();
        if (!this.savedVars) this.savedVars = new Array(50).fill(0);
        switch (u) {
            case 'ERR': return this.lastErr;
            case 'PID': return this._pid || (this._pid = (Math.floor(Math.random() * 0x7FFFFF) | 1));
            case 'PPID': return this._ppid || (this._ppid = 1);
            case 'WID': return this._wid || (this._wid = (Math.floor(Math.random() * 0x7FFFFF) | 1));
            case 'TID': return thread ? thread.id : 0;
            case 'PDX': return this.stage.pdx || 0;
            case 'PDY': return this.stage.pdy || 0;
            case 'KSTAT': { const v = this.stage.kstat || 0; this.stage.kstat = 0; return v; } // 仕様: 最初の参照のみ有効、2回目以降は0(参照で消費)
            case 'PDB': return this.stage.pdb || 0;
            case 'KEY': { const v = this.stage.lastKey || 0; this.stage.lastKey = 0; return v; } // 仕様: 最初の参照のみ有効、2回目以降は0(参照で消費)
            case 'METAKEY': return this.stage.metaKey || 0;
            case 'ARG': {
                // 現在の手続きの引数 (params 無し手続きが $ARG[n] で引数を受ける。 照明等の汎用部品)。
                // スコープチェーンを辿り最も近い手続きスコープの引数配列を参照する
                let s = scope;
                while (s) {
                    if (s._args) { const i = index | 0; return (i >= 0 && i < s._args.length) ? s._args[i] : 0; }
                    s = s.parent;
                }
                return 0;
            }
            // BTRON仕様: $DATE の年は「西暦 - 1900」 (スクリプト側で 1900+年 として西暦に戻す)
            case 'DATE': { const d = new Date(); return (d.getFullYear() - 1900) * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }
            case 'TIME': { const d = new Date(); return d.getHours() * 10000 + d.getMinutes() * 100 + d.getSeconds(); }
            case 'MSEC': return Date.now() - this.startTime;
            case 'SYSTM': return Math.floor(Date.now() / 1000) - this.systmEpoch;
            case 'WDW': return this.stage.canvas ? this.stage.canvas.clientWidth : 0;
            case 'WDH': return this.stage.canvas ? this.stage.canvas.clientHeight : 0;
            case 'WDX': return this.stage.wdx || 0;
            case 'WDY': return this.stage.wdy || 0;
            case 'WACT': return (this.stage.wact != null) ? this.stage.wact : 1;
            case 'SCRW': return window.screen.width;
            case 'SCRH': return window.screen.height;
            case 'RAND': return Math.floor(Math.random() * 65536);
            case 'VERS': return 0x2106; // 仕様準拠: マイクロスクリプト バージョン 2.106
            case 'CPULOAD': return 0;
            case 'CNT': return (thread && thread._cnt) ? thread._cnt.value : 0;
            case 'GV': { const gi = index | 0; if (gi < 0 || gi >= 50) return INVALID; this._loadGV(); return this.sharedVars[gi] || 0; }
            case 'SV': { const si = index | 0; if (si < 0 || si >= 50) return INVALID; this._loadSV(); return this.savedVars[si] || 0; }
            case 'PDS': return this.stage.pds || 0;
            case 'KMODE': return this._kmode || 0;
            case 'DSKINS': return (this._dskins == null) ? 1 : this._dskins;
            case 'PWID': return 0;
            case 'MMASK': return this._mmask || 0;
            case 'RSCNT': return this._rsCnt || 0;  // 直近 RSGETN/RSGETC でコピーした受信バイト数
            case 'RS': {                              // $RS[n]: 受信バッファのバイト
                const i = index | 0;
                return (this._rsData && i >= 0 && i < this._rsData.length) ? this._rsData[i] : 0;
            }
        }
        return 0;
    };

    Runtime.prototype.setSysVar = function (name, index, value, scope, thread) {
        const u = name.toUpperCase();
        if (!this.savedVars) this.savedVars = new Array(50).fill(0);
        switch (u) {
            case 'CNT': if (thread && thread._cnt) thread._cnt.value = value | 0; return; // 仕様: REPEAT 内で $CNT に代入するとカウンタを変更できる
            case 'GV': { const gi = index | 0; if (gi < 0 || gi >= 50) return; this._loadGV(); this.sharedVars[gi] = value | 0; this._storeGV(); return; }
            case 'SV': { const si = index | 0; if (si < 0 || si >= 50) return; this._loadSV(); this.savedVars[si] = value | 0; this._storeSV(); return; }
            case 'ARG': {
                // $ARG[n] への書き込み: 照明等の部品は DEFINE 名 $ARG[n] でテンポラリ変数として使う。
                // スコープチェーンを遡り最も近い _args 配列の index に書き込む (範囲外は伸長、 文字列も許容)
                let s = scope;
                while (s && !s._args) s = s.parent;
                if (s && s._args) {
                    const i = index | 0;
                    if (i >= 0) { while (s._args.length <= i) s._args.push(0); s._args[i] = value; }
                }
                return;
            }
            case 'PDS':
                this.stage.pds = value | 0;
                if (this.stage.setCursorShape) this.stage.setCursorShape(value | 0);
                return;
            case 'KMODE': this._kmode = value | 0; return;
            case 'PWID': return; // 仕様外。 $PPID(親プロセスID)は参照のみで設定不可のため no-op
            case 'MMASK': this._mmask = value | 0; return;
            case 'DSKINS': this._dskins = value | 0; return;
        }
    };

    Runtime.prototype.callBuiltin = async function (node, scope, thread) {
        const name = node.name;
        const args = [];
        for (let i = 0; i < node.args.length; i++) args.push(await this.evalExpr(node.args[i], scope, thread));
        const lower = name.toLowerCase();
        switch (lower) {
            case 'valid': return isInvalid(args[0]) ? 0 : 1;
            case 'number': return typeof args[0] === 'number' ? 1 : 0;
            case 'sin': return Math.sin(args[0]);
            case 'cos': return Math.cos(args[0]);
            case 'tan': return Math.tan(args[0]);
            case 'asin': if (args[0] < -1 || args[0] > 1) return 0; return Math.asin(args[0]);
            case 'acos': if (args[0] < -1 || args[0] > 1) return 0; return Math.acos(args[0]);
            case 'atan': return Math.atan(args[0]);
            case 'sqrt': if (args[0] < 0) return 0; return Math.sqrt(args[0]);
            case 'exp': return Math.exp(args[0]);
            case 'log': if (args[0] === 0) return -1e300; if (args[0] < 0) return INVALID; return Math.log(args[0]);
            case 'log10': if (args[0] === 0) return -1e300; if (args[0] < 0) return INVALID; return Math.log10(args[0]);
            case 'floor': return Math.floor(args[0]);
            case 'ceil': return Math.ceil(args[0]);
            case 'round': return (args[0] < 0 ? -1 : 1) * Math.round(Math.abs(args[0])); // BTRON: -0.5→-1.0 (絶対値で四捨五入)
            case 'fabs': return Math.abs(args[0]);
            case 'pow': {
                // BTRON仕様: 〈数値1〉=0 で 〈数値2〉≦0、 または 〈数値1〉<0 で 〈数値2〉が整数でないとき 0.0
                const a = args[0], b = args[1];
                if (a === 0 && b <= 0) return 0;
                if (a < 0 && !Number.isInteger(b)) return 0;
                return Math.pow(a, b);
            }
            case 'max': return Math.max(args[0], args[1]);
            case 'min': return Math.min(args[0], args[1]);
            // 配列操作
            case 'asrch': return this._fnAsrch(node, scope, thread, args);
            case 'acmp': return this._fnAcmp(node, scope, thread, args);
            case 'acopy': return this._fnAcopy(node, scope, thread, args);
            case 'slen': return this._fnSlen(node, scope, thread, args);
            case 'scmp': return this._fnScmp(node, scope, thread, args);
            // 文字列変換
            case 'strnum': return this._fnStrnum(node, scope, thread, args);
            case 'sconv': return this._fnSconv(node, scope, thread, args);
            case 'srconv': return this._fnSrconv(node, scope, thread, args);
            // 画像
            case 'newimgseg': return await this._fnNewImgSeg(args);
            // 実身
            case 'filelist': return await this._fnFilelist(node, scope, thread, args);
            // システム名
            case 'getgnm': return this._fnGetgnm(args);
            case 'setgnm': return this._fnSetgnm(args);
            case 'delgnm': return this._fnDelgnm(args);
            // 時刻
            case 'tmdate': return await this._fnTmdate(node, scope, thread, args);
            case 'datetm': return await this._fnDatetm(node, scope, thread, args);
        }
        if (this.procedures.has(name)) {
            const proc = this.procedures.get(name);
            const callScope = new Scope(this.globalScope);
            if (proc.params) {
                for (let i = 0; i < proc.params.length; i++) {
                    const p = proc.params[i];
                    let av = null;
                    const an = node.args[i];
                    if (an && an.type === 'Name' && an.index == null && !an.isSlice && !an.stateName) {
                        const vv = scope.lookup(an.name);
                        if (vv && vv.data && vv.size > 1) av = vv;
                    }
                    if ((p.size === 0 || p.size > 1) && av) {
                        // 配列引数: 呼出元配列を参照渡し(複製しない、 変更は呼出元へ反映)
                        const variable = callScope.declare(p, { forceArray: true });
                        variable.data = av.data; variable.size = av.size; variable.isScalar = false;
                    } else {
                        const variable = callScope.declare(p, { forceArray: p.size > 1 });
                        if (i < args.length) variable.data[0] = args[i];
                    }
                }
            }
            try {
                await this.execBlock(proc.body, callScope, thread);
            } catch (sig) {
                if (sig instanceof FlowSignal && sig.kind === 'exit') return sig.value;
                throw sig;
            }
            return 0;
        }
        return 0;
    };

    // ========================================
    // 配列操作関数
    // ========================================
    Runtime.prototype._resolveVarFromNode = function (argNode, scope) {
        if (!argNode || argNode.type !== 'Name') return null;
        const v = scope.lookup(argNode.name);
        return v || null;
    };
    Runtime.prototype._fnAsrch = function (node, scope, thread, args) {
        const v = this._resolveVarFromNode(node.args[0], scope);
        if (!v) return INVALID;
        const start = args[1] | 0;
        const value = args[2];
        let len = args[3] | 0;
        if (len === 0) len = v.size - start;
        const step = len < 0 ? -1 : 1;
        const cnt = Math.abs(len);
        for (let i = 0; i < cnt; i++) {
            const idx = start + i * step;
            if (idx < 0 || idx >= v.size) break;
            if (v.data[idx] === value) return idx;
        }
        return INVALID;
    };
    Runtime.prototype._fnAcmp = function (node, scope, thread, args) {
        const v1 = this._resolveVarFromNode(node.args[0], scope);
        const v2 = this._resolveVarFromNode(node.args[2], scope);
        if (!v1 || !v2) return INVALID;
        const s1 = args[1] | 0, s2 = args[3] | 0, len = args[4] | 0;
        // 実比較数 = min(長さ式(>0時), 配列1の残り, 配列2の残り)。 長さ式=0 は「短い方の最後まで」
        const remain = Math.min(v1.size - s1, v2.size - s2);
        const effLen = Math.max(0, len > 0 ? Math.min(len, remain) : remain);
        for (let i = 0; i < effLen; i++) {
            const a = v1.data[s1 + i] || 0;
            const b = v2.data[s2 + i] || 0;
            if (a > b) return 1;
            if (a < b) return -1;
        }
        return 0;
    };
    Runtime.prototype._fnAcopy = function (node, scope, thread, args) {
        const v1 = this._resolveVarFromNode(node.args[0], scope);
        const v2 = this._resolveVarFromNode(node.args[2], scope);
        if (!v1 || !v2) return 0;
        const s1 = args[1] | 0, s2 = args[3] | 0, len = args[4] | 0;
        // 実代入数 = min(長さ式(>0時), 配列1の残り, 配列2の残り)。 長さ式=0 は「短い方の最後まで」
        const remain = Math.min(v1.size - s1, v2.size - s2);
        const effLen = Math.max(0, len > 0 ? Math.min(len, remain) : remain);
        let count = 0;
        for (let i = 0; i < effLen; i++) {
            v1.data[s1 + i] = v2.data[s2 + i] || 0;
            count++;
        }
        return count;
    };
    Runtime.prototype._fnSlen = function (node, scope, thread, args) {
        const v = this._resolveVarFromNode(node.args[0], scope);
        if (!v) {
            // 文字列リテラル等を直接渡された場合
            const a = args[0];
            if (Array.isArray(a)) {
                for (let i = 0; i < a.length; i++) if (a[i] === 0) return i;
                return INVALID;
            }
            return INVALID;
        }
        for (let i = 0; i < v.size; i++) if ((v.data[i] || 0) === 0) return i;
        return INVALID;
    };
    Runtime.prototype._fnScmp = function (node, scope, thread, args) {
        const v1 = this._resolveVarFromNode(node.args[0], scope);
        const v2 = this._resolveVarFromNode(node.args[2], scope);
        if (!v1 || !v2) return INVALID;
        const s1 = args[1] | 0, s2 = args[3] | 0, len = args[4] | 0;
        // 長さ式=0 は 0 終端 (または短い方の末尾) まで比較
        const remain = Math.min(v1.size - s1, v2.size - s2);
        const effLen = Math.max(0, len > 0 ? Math.min(len, remain) : remain);
        for (let i = 0; i < effLen; i++) {
            const a = v1.data[s1 + i] || 0;
            const b = v2.data[s2 + i] || 0;
            if (a === 0 && b === 0) return 0;
            if (a > b) return 1;
            if (a < b) return -1;
        }
        return 0;
    };
    Runtime.prototype._fnStrnum = function (node, scope, thread, args) {
        const v = this._resolveVarFromNode(node.args[0], scope);
        if (!v) return 0;
        const start = args[1] | 0;
        const formatCode = args[2];
        const endVarNode = node.args[3];
        let str = '';
        // 変換対象は最大 128 文字
        const strnumEnd = Math.min(v.size, start + 128);
        for (let i = start; i < strnumEnd; i++) {
            const c = v.data[i] || 0;
            if (c === 0) break;
            str += String.fromCharCode(c);
        }
        // 全角数字・記号の入力 (INPUT 経由等) も解釈できるよう正規化する
        if (global.MSLexer && global.MSLexer.normalize) str = global.MSLexer.normalize(str);
        let endPos = start + str.length;
        let result = 0;
        if (str.startsWith('0x') || str.startsWith('0X')) {
            const m = str.match(/^0x[0-9A-Fa-f]+/i);
            if (m) { result = parseInt(m[0], 16); endPos = start + m[0].length; }
        } else if (formatCode === 0x64 /* 'd' */) {
            const m = str.match(/^-?\d+/); if (m) { result = parseInt(m[0], 10); endPos = start + m[0].length; }
        } else if (formatCode === 0x78 /* 'x' */ || formatCode === 0x58 /* 'X' */) {
            const m = str.match(/^[0-9A-Fa-f]+/); if (m) { result = parseInt(m[0], 16); endPos = start + m[0].length; }
        } else if (formatCode === 0x66 /* 'f' */) {
            const m = str.match(/^-?\d+(\.\d+)?([eE][+-]?\d+)?/); if (m) { result = parseFloat(m[0]); endPos = start + m[0].length; }
        } else {
            const m = str.match(/^-?\d+(\.\d+)?/); if (m) { result = parseFloat(m[0]); endPos = start + m[0].length; }
        }
        if (endVarNode) {
            const ev = this._resolveVarFromNode(endVarNode, scope);
            if (ev) ev.data[0] = endPos;
        }
        return result;
    };
    Runtime.prototype._fnSconv = function (node, scope, thread, args) {
        // 外部文字コード (シフトJIS / EUC) → 内部文字コードへの正規変換。
        // 文字式: 's' = ASCII/半角カナ/シフトJIS、 'e' = ASCII/EUC
        const v1 = this._resolveVarFromNode(node.args[0], scope);
        const v2 = this._resolveVarFromNode(node.args[2], scope);
        if (!v1 || !v2) return 0;
        const s1 = args[1] | 0, s2 = args[3] | 0;
        let len = args[4] | 0;
        if (len <= 0) len = v2.size - s2; // 長さ0は最後まで
        const fmtCode = args[5];
        const fmt = (typeof fmtCode === 'number') ? String.fromCharCode(fmtCode) : String(fmtCode || 's');
        const isEuc = (fmt === 'e' || fmt === 'E');
        const bytes = [];
        for (let i = 0; i < len && (s2 + i) < v2.size; i++) {
            const b = v2.data[s2 + i] | 0;
            if (b === 0) break;
            bytes.push(b & 0xFF);
        }
        let str = '';
        try {
            const dec = new TextDecoder(isEuc ? 'euc-jp' : 'shift_jis');
            str = dec.decode(new Uint8Array(bytes));
        } catch (e) {
            return INVALID;
        }
        let j = 0;
        for (const ch of str) {
            if (s1 + j >= v1.size) break;
            v1.data[s1 + j++] = ch.codePointAt(0);
        }
        if (s1 + j < v1.size) v1.data[s1 + j] = 0;
        return j;
    };
    Runtime.prototype._fnSrconv = function (node, scope, thread, args) {
        // 内部文字コード → 外部文字コード (シフトJIS / EUC) への正規変換。
        // 文字式: 'S' = 全角シフトJIS、 's' = ASCII+シフトJIS、 'k' = ASCII+半角カナ+シフトJIS、
        //         'E' = 全角EUC、 'e' = ASCII+EUC。 改行は SJIS 系 CR+LF / EUC 系 LF
        const v1 = this._resolveVarFromNode(node.args[0], scope);
        const v2 = this._resolveVarFromNode(node.args[2], scope);
        if (!v1 || !v2) return 0;
        const s1 = args[1] | 0, s2 = args[3] | 0;
        let len = args[4] | 0;
        if (len <= 0) len = v2.size - s2; // 長さ0は最後まで
        const fmtCode = args[5];
        const fmt = (typeof fmtCode === 'number') ? String.fromCharCode(fmtCode) : String(fmtCode || 's');
        const isEuc = (fmt === 'E' || fmt === 'e');
        let str = '';
        for (let i = 0; i < len && (s2 + i) < v2.size; i++) {
            const c = v2.data[s2 + i] | 0;
            if (c === 0) break;
            str += String.fromCharCode(c);
        }
        str = str.replace(/\r\n|\r|\n/g, isEuc ? '\n' : '\r\n');
        let bytes = null;
        try {
            if (typeof window !== 'undefined' && window.Encoding) {
                let src = str;
                if (fmt === 'S' && window.Encoding.toZenkakuCase) src = window.Encoding.toZenkakuCase(src);
                if (fmt === 'E' && window.Encoding.toZenkakuCase) src = window.Encoding.toZenkakuCase(src);
                if (fmt === 'k' && window.Encoding.toHankanaCase) src = window.Encoding.toHankanaCase(src);
                bytes = window.Encoding.convert(window.Encoding.stringToCode(src), { to: isEuc ? 'EUCJP' : 'SJIS', from: 'UNICODE' });
            }
        } catch (e) { bytes = null; }
        if (!bytes) {
            // encoding ライブラリ未ロード時のフォールバック (ASCII 以外は '?')
            bytes = [];
            for (let i = 0; i < str.length; i++) {
                const c = str.charCodeAt(i);
                bytes.push(c < 0x80 ? c : 0x3F);
            }
        }
        let j = 0;
        for (let i = 0; i < bytes.length; i++) {
            if (s1 + j >= v1.size) break;
            v1.data[s1 + j++] = bytes[i] & 0xFF;
        }
        return j;
    };

    // ========================================
    // 画像セグメント動的生成 (newimgseg)
    // ========================================
    Runtime.prototype._fnNewImgSeg = async function (args) {
        const path = this._toStr(args[0]);
        const x = args[1] | 0;
        const y = args[2] | 0;
        this._imgSegCounter = (this._imgSegCounter || 0) + 1;
        const name = '__img_' + this._imgSegCounter;
        let resolvedSrc = path;
        if (this.stage.resolveImagePath) {
            try { resolvedSrc = await this.stage.resolveImagePath(path); } catch (e) {}
        }
        const shape = {
            kind: 'image',
            left: 0, top: 0, right: 100, bottom: 100,
            src: path, _resolvedSrc: resolvedSrc
        };
        const seg = new Segment({ name: name, x: x, y: y, w: 100, h: 100, shapes: [shape] });
        this.registerSegment(seg);
        return name;
    };

    // ========================================
    // filelist (実身一覧)
    // ========================================
    Runtime.prototype._fnFilelist = async function (node, scope, thread, args) {
        const path = this._toStr(args[0]);
        const dstNode = node.args[1];
        const order = args[2] | 0;
        const dst = dstNode ? await this._evalLValue(dstNode, scope, thread) : null;
        if (!dst) return INVALID;
        if (!this.stage.listVirtualObjects) return 0;
        try {
            const names = await this.stage.listVirtualObjects(path);
            const slice = names.slice(order, order + 100);
            let pos = dst.start;
            for (const n of slice) {
                for (let i = 0; i < n.length; i++) {
                    if (pos >= dst.variable.size) break;
                    dst.variable.data[pos++] = n.charCodeAt(i);
                }
                if (pos < dst.variable.size) dst.variable.data[pos++] = 0;
            }
            return slice.length;
        } catch (e) { return INVALID; }
    };

    // ========================================
    // グローバル名 (getgnm/setgnm/delgnm)
    // ========================================
    // グローバル名データはスクリプト間 (全マイクロスクリプトウィンドウ) で共有する。
    // $GV と同じく localStorage を共有ストアとし、 短い間隔でキャッシュを更新する
    Runtime.prototype._gnm = function () {
        const now = Date.now();
        if (!this._gnmMap) this._gnmMap = {};
        if (!this._gnmLoadedAt || (now - this._gnmLoadedAt) >= 50) {
            this._gnmLoadedAt = now;
            try {
                if (typeof localStorage !== 'undefined') {
                    const stored = localStorage.getItem('ms_gnm');
                    this._gnmMap = stored ? (JSON.parse(stored) || {}) : {};
                }
            } catch (e) {}
        }
        return this._gnmMap;
    };
    Runtime.prototype._storeGnm = function (map) {
        try {
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem('ms_gnm', JSON.stringify(map));
            }
        } catch (e) {}
    };
    Runtime.prototype._fnGetgnm = function (args) {
        const key = this._toStr(args[0]);
        const map = this._gnm();
        if (!Object.prototype.hasOwnProperty.call(map, key)) return INVALID;
        return map[key];
    };
    Runtime.prototype._fnSetgnm = function (args) {
        const key = this._toStr(args[0]);
        const map = this._gnm();
        map[key] = args[1];
        this._storeGnm(map);
        // このスクリプトが生成したキーはスクリプト終了時に自動削除する
        if (!this._gnmOwned) this._gnmOwned = new Set();
        this._gnmOwned.add(key);
        return 0;
    };
    Runtime.prototype._fnDelgnm = function (args) {
        const key = this._toStr(args[0]);
        const map = this._gnm();
        if (!Object.prototype.hasOwnProperty.call(map, key)) return INVALID;
        delete map[key];
        this._storeGnm(map);
        if (this._gnmOwned) this._gnmOwned.delete(key);
        return 0;
    };
    // スクリプト終了時: このスクリプトが setgnm したキーを共有ストアから削除する
    Runtime.prototype._cleanupGnm = function () {
        if (!this._gnmOwned || this._gnmOwned.size === 0) return;
        const map = this._gnm();
        let changed = false;
        this._gnmOwned.forEach(function (key) {
            if (Object.prototype.hasOwnProperty.call(map, key)) { delete map[key]; changed = true; }
        });
        if (changed) this._storeGnm(map);
        this._gnmOwned.clear();
    };

    // ========================================
    // 時刻関数 (tmdate/datetm)
    // ========================================
    Runtime.prototype._fnTmdate = async function (node, scope, thread, args) {
        const dst = await this._evalLValue(node.args[0], scope, thread);
        if (!dst || dst.variable.size < 9) return INVALID;
        const systm = args[1] | 0;
        let d;
        if (systm === 0) d = new Date();
        else d = new Date((systm + this.systmEpoch) * 1000);
        const off = dst.start;
        const data = dst.variable.data;
        data[off + 0] = d.getFullYear();
        data[off + 1] = d.getMonth() + 1;
        data[off + 2] = d.getDate();
        data[off + 3] = d.getHours();
        data[off + 4] = d.getMinutes();
        data[off + 5] = d.getSeconds();
        // 週番号 (簡易: 年内通算 / 7 + 1)
        const yearStart = new Date(d.getFullYear(), 0, 1);
        const dayOfYear = Math.floor((d - yearStart) / 86400000) + 1;
        data[off + 6] = Math.floor((dayOfYear - 1) / 7) + 1;
        data[off + 7] = d.getDay(); // 0:日曜
        data[off + 8] = dayOfYear;
        return 0;
    };
    Runtime.prototype._fnDatetm = async function (node, scope, thread, args) {
        const src = await this._evalLValue(node.args[0], scope, thread);
        if (!src || src.variable.size < 6) return INVALID;
        const off = src.start;
        const data = src.variable.data;
        try {
            const d = new Date(data[off + 0], (data[off + 1] | 0) - 1, data[off + 2],
                data[off + 3], data[off + 4], data[off + 5]);
            const t = Math.floor(d.getTime() / 1000) - this.systmEpoch;
            return t;
        } catch (e) { return INVALID; }
    };

    // ========================================
    // 文字列・型変換ユーティリティ
    // ========================================
    Runtime.prototype._toStr = function (v) {
        if (typeof v === 'string') return v;
        if (Array.isArray(v)) return codepointsToString(v);
        return String(v);
    };

    Runtime.prototype._evalLValue = async function (node, scope, thread) {
        // 配列変数を参照するための簡易ヘルパ。 node が Name の場合に variable と start を返す
        if (!node || node.type !== 'Name') return null;
        const v = scope.lookup(node.name);
        if (!v) return null;
        let start = 0;
        if (node.isSlice && node.sliceStart != null) {
            // 式 (動的) も評価。 BTRON仕様: インデックスは整数
            start = (await this.evalExpr(node.sliceStart, scope, thread)) | 0;
        } else if (node.index != null) {
            start = (await this.evalExpr(node.index, scope, thread)) | 0;
        }
        return { variable: v, start: start };
    };

    // ========================================
    // Window / Update
    // ========================================
    Runtime.prototype.stmtWSize = async function (stmt, scope, thread) {
        const w = await this.evalExpr(stmt.a, scope, thread);
        const h = await this.evalExpr(stmt.b, scope, thread);
        if (this.stage.notifyHost) this.stage.notifyHost('resize-window', { width: w, height: h });
    };
    Runtime.prototype.stmtWMove = async function (stmt, scope, thread) {
        const x = await this.evalExpr(stmt.a, scope, thread);
        const y = await this.evalExpr(stmt.b, scope, thread);
        if (this.stage.notifyHost) this.stage.notifyHost('move-window', { x: x, y: y });
    };
    Runtime.prototype.stmtWSave = function () {
        if (this.stage.notifyHost) this.stage.notifyHost('save-window-geometry', {});
    };
    Runtime.prototype.stmtFullWind = function () {
        if (this.stage.notifyHost) this.stage.notifyHost('fullscreen-window', {});
    };
    Runtime.prototype.stmtUpdate = async function (stmt, scope, thread) {
        const v = await this.evalExpr(stmt.expr, scope, thread);
        if (this.stage.setUpdateEnabled) this.stage.setUpdateEnabled(v !== 0);
    };

    // ========================================
    // INPUT / KINPUT (キーボード入力)
    // ========================================
    Runtime.prototype.stmtInput = async function (stmt, scope, thread) {
        return this._doInput(stmt, false, scope, thread);
    };
    Runtime.prototype.stmtKInput = async function (stmt, scope, thread) {
        return this._doInput(stmt, true, scope, thread);
    };
    Runtime.prototype._doInput = async function (stmt, kanji, scope, thread) {
        // 引数なしの INPUT/KINPUT は入力状態の解除 (現在のバッファを確定)
        if (!stmt.seg) {
            if (this.stage.endInput) this.stage.endInput();
            return;
        }
        // セグメント指定 (式: 名前/シンボル変数/配列要素) を解決
        const segName = await this.resolveSegName(stmt.seg, scope, thread);
        const seg = segName ? this.stage.segments.get(segName) : null;
        if (!seg) return;
        // BTRON仕様 09-04-07: INPUT/KINPUT の X,Y はカーソル初期位置 (セグメント相対)
        const ix = stmt.x != null ? await this.evalExpr(stmt.x, scope, thread) : null;
        const iy = stmt.y != null ? await this.evalExpr(stmt.y, scope, thread) : null;
        // 入力状態にしたら完了を待たずに次の文へ進む (解除は改行確定または引数なし INPUT)
        if (this.stage.beginInput) {
            this.stage.beginInput(seg, kanji, null, ix, iy);
        }
    };

    // ========================================
    // 仮身操作 (VOPEN/VCLOSE/VWAIT)
    // ========================================
    Runtime.prototype.stmtVOpen = async function (stmt, scope, thread) {
        const targets = stmt.targets || [];
        if (targets.length === 0) {
            if (this.stage.notifyHost) this.stage.notifyHost('vopen', { target: null });
            return;
        }
        for (const t of targets) {
            // 配列要素 仮身[index] の場合は評価して仮身名を解決 (APPEAR 等と同じ resolveSegName 経路)
            const target = (t.index != null)
                ? await this.resolveSegName({ type: 'Name', name: t.value, index: t.index }, scope, thread)
                : t.value;
            if (this.stage.notifyHost) this.stage.notifyHost('vopen', { target: target });
        }
    };
    Runtime.prototype.stmtVClose = async function (stmt, scope, thread) {
        const targets = stmt.targets || [];
        if (targets.length === 0) {
            if (this.stage.notifyHost) this.stage.notifyHost('vclose', { target: null });
            return;
        }
        for (const t of targets) {
            // 配列要素 仮身[index] の場合は評価して仮身名を解決
            const target = (t.index != null)
                ? await this.resolveSegName({ type: 'Name', name: t.value, index: t.index }, scope, thread)
                : t.value;
            if (this.stage.notifyHost) this.stage.notifyHost('vclose', { target: target });
        }
    };
    Runtime.prototype.stmtVWait = async function (stmt, scope, thread) {
        const timeoutSec = stmt.timeout ? await this.evalExpr(stmt.timeout, scope, thread) : -1;
        if (timeoutSec === 0) { this.lastErr = 0; return; }
        if (timeoutSec > 0) {
            // BREAK 手続き名 で解除できるようチャンク待機
            const start = Date.now();
            thread._waiting = true;
            try {
                while (!thread.terminated && !this.finished) {
                    // $ERR: BREAK 解除=2 / タイムアウト=1 (待機文で統一)
                    if (thread._breakSignal) { thread._breakSignal = false; this.lastErr = 2; return; }
                    if ((Date.now() - start) >= timeoutSec * 1000) { this.lastErr = 1; return; }
                    await new Promise(r => setTimeout(r, 50));
                }
            } finally {
                thread._waiting = false;
            }
            return;
        }
        this.lastErr = 0;
    };

    // ========================================
    // SETSEG / COPYSEG
    // ========================================
    Runtime.prototype._resolveSegmentForAssign = async function (dstName, dstIndex, scope, thread) {
        // SETSEG/COPYSEG の左辺セグメントを取得
        // 直接 stage.segments.get、 配列変数経由、 のいずれかで解決
        let target = this.stage.segments.get(dstName);
        if (target) return { seg: target, varSlot: null };
        const v = scope.lookup(dstName);
        if (!v) return null;
        const idx = dstIndex != null ? (await this.evalExpr(dstIndex, scope, thread)) | 0 : 0;
        const segName = v.data[idx];
        if (typeof segName === 'string' && this.stage.segments.has(segName)) {
            return { seg: this.stage.segments.get(segName), varSlot: { variable: v, idx: idx } };
        }
        // 新規動的セグメント。 BTRON 仕様: 配列セグメント要素は「配列名+インデックス」 で参照可能
        // (例: カップ[0] と カップ0 は同じ) なのでこの命名で登録する。
        // SEGMENT 配列宣言で名前が事前割当済みの場合はその名前で登録する (X0 と X[0] が同一セグメントになる)
        let dynName = (typeof segName === 'string' && segName) ? segName : dstName + idx;
        if (this.stage.segments.has(dynName)) {
            let suffix = 1;
            while (this.stage.segments.has(dynName + '_' + suffix)) suffix++;
            dynName = dynName + '_' + suffix;
        }
        const seg = new Segment({ name: dynName, x: 0, y: 0, w: 0, h: 0, shapes: [] });
        this.stage.registerSegment(seg);
        v.data[idx] = dynName;
        return { seg: seg, varSlot: { variable: v, idx: idx } };
    };

    Runtime.prototype.stmtSetSeg = async function (stmt, scope, thread) {
        const target = await this._resolveSegmentForAssign(stmt.dst, stmt.dstIndex, scope, thread);
        if (!target) return;
        const dst = target.seg;
        const srcName = await this.resolveSegName(stmt.src, scope, thread);
        const src = this.stage.segments.get(srcName);
        if (!src) {
            // 空セグメント代入 (例: SETSEG コイン=ヌルセグメント で未定義の場合)
            dst.shapes = [];
            dst.text = '';
            dst.tx = stringToCodepoints('');
            dst.w = 0;
            dst.h = 0;
            dst._sharedFrom = null; // 共有関係を解除
            this.stage.render();
            return;
        }
        dst.shapes = src.shapes;
        dst.text = src.text;
        dst.tx = src.tx.slice();
        dst.w = src.w;
        dst.h = src.h;
        // BTRON仕様 09-04-04: SETSEG は可変セグメントの「表示位置を変えず」 内容(形状)のみ差し替える。
        // 位置に関わる属性(x/y, x0/y0, home, labelOffset)は「配置を決めた初回 SETSEG」の値だけを継承し、
        // 2回目以降(フレーム差替)では更新しない。 更新すると、 領域に配置した動的セグメントへフレーム
        // (別座標のスプライト)を差し替えた際に home/labelOffset がフレーム座標へ化け、 SCENE(home基準
        // 整列)や座標省略MOVEが配置位置でなくフレーム位置を基準にして表示がズレる(アニメ位置ズレの真因)。
        // 例: SETSEG アニメA=アニメA領域(初回=配置確定) → SETSEG アニメA=アニメA0(以降=形状のみ差替)。
        if (!dst._positioned) {
            dst.x = src.x;
            dst.y = src.y;
            dst.x0 = src.x0;
            dst.y0 = src.y0;
            dst.home_x = (src.home_x != null ? src.home_x : src.x0);
            dst.home_y = (src.home_y != null ? src.home_y : src.y0);
            dst.labelOffsetX = src.labelOffsetX;
            dst.labelOffsetY = src.labelOffsetY;
            dst._positioned = true;
        }
        dst._sharedFrom = srcName;
        this.stage.render();
    };
    Runtime.prototype.stmtCopySeg = async function (stmt, scope, thread) {
        const target = await this._resolveSegmentForAssign(stmt.dst, stmt.dstIndex, scope, thread);
        if (!target) return;
        const dst = target.seg;
        const allShapes = [];
        let totalW = 0, totalH = 0;
        let firstSrc = null;
        for (const expr of stmt.srcs) {
            const srcName = await this.resolveSegName(expr, scope, thread);
            const src = this.stage.segments.get(srcName);
            if (!src) continue;
            if (!firstSrc) firstSrc = src;
            for (const s of src.shapes) {
                const copy = {};
                for (const k in s) {
                    if (k === '_img' || k === '_resolvedSrc' || k.charAt(0) === '_') continue;
                    copy[k] = s[k];
                }
                allShapes.push(copy);
            }
            totalW = Math.max(totalW, src.w);
            totalH = Math.max(totalH, src.h);
        }
        dst.shapes = allShapes;
        dst.w = totalW;
        dst.h = totalH;
        // SETSEG と同様: 先頭ソースの 元位置(x0/y0)・labelOffset を継承(毎回)、現在位置(x/y)は初回のみ。
        // 座標省略 MOVE の復帰先(x0/y0)が 0 のままだと原点に飛ぶため必須。
        if (firstSrc) {
            if (!dst._positioned) {
                dst.x = firstSrc.x;
                dst.y = firstSrc.y;
                dst._positioned = true;
            }
            dst.x0 = firstSrc.x0;
            dst.y0 = firstSrc.y0;
            dst.home_x = (firstSrc.home_x != null ? firstSrc.home_x : firstSrc.x0);
            dst.home_y = (firstSrc.home_y != null ? firstSrc.home_y : firstSrc.y0);
            dst.labelOffsetX = firstSrc.labelOffsetX;
            dst.labelOffsetY = firstSrc.labelOffsetY;
        }
        this.stage.render();
    };

    // ========================================
    // TERMINATE / SUSPEND
    // ========================================
    Runtime.prototype.stmtTerminate = async function (stmt, scope, thread) {
        if (!stmt.targets || stmt.targets.length === 0) {
            this.threads.forEach(function (t) { if (t !== thread) t.terminated = true; });
            return;
        }
        for (const target of stmt.targets) {
            const value = await this.evalExpr(target, scope, thread);
            const self = this;
            this.threads.forEach(function (t) {
                if (t.id === value || t.name === value || t.name === self._toStr(value)) t.terminated = true;
            });
        }
    };
    Runtime.prototype.stmtSuspend = async function (stmt, scope, thread) {
        const timeoutSec = stmt.timeout ? await this.evalExpr(stmt.timeout, scope, thread) : -1;
        const self = this;
        let targets = [];
        if (!stmt.targets || stmt.targets.length === 0) {
            this.threads.forEach(function (t) { if (t !== thread) targets.push(t); });
        } else {
            for (const target of stmt.targets) {
                const v = await this.evalExpr(target, scope, thread);
                this.threads.forEach(function (t) {
                    if (t.id === v || t.name === v || t.name === self._toStr(v)) targets.push(t);
                });
            }
        }
        const start = Date.now();
        thread._waiting = true;
        try {
            while (!thread.terminated && !this.finished) {
                // SUSPEND の $ERR は仕様で他の待機文と異なる: 終了=0 / BREAK解除=1 / タイムアウト=2
                const alive = targets.filter(function (t) { return !t.terminated && self.threads.has(t); });
                if (alive.length === 0) { this.lastErr = 0; return; }
                if (thread._breakSignal) { thread._breakSignal = false; this.lastErr = 1; return; }
                if (timeoutSec === 0) { this.lastErr = 2; return; }
                if (timeoutSec > 0 && (Date.now() - start) >= timeoutSec * 1000) { this.lastErr = 2; return; }
                await new Promise(function (r) { setTimeout(r, 50); });
            }
        } finally {
            thread._waiting = false;
        }
    };

    // ========================================
    // EVENT (合成イベント発火)
    // ========================================
    Runtime.prototype.stmtEvent = async function (stmt, scope, thread) {
        const charCode = stmt.args[0] ? await this.evalExpr(stmt.args[0], scope, thread) : 0;
        const state = stmt.args[1] ? await this.evalExpr(stmt.args[1], scope, thread) : 0;
        const x = stmt.x != null ? await this.evalExpr(stmt.x, scope, thread) : null;
        const y = stmt.y != null ? await this.evalExpr(stmt.y, scope, thread) : null;
        if (this.stage.injectEvent) this.stage.injectEvent(stmt.kind, charCode, state, x, y);
    };

    // ========================================
    // FILE I/O (MessageBus 経由)
    // ========================================
    Runtime.prototype._getFileCache = function () {
        if (!this._fileCache) this._fileCache = new Map();
        return this._fileCache;
    };
    /**
     * 仮身名/セグメント名 → 実身 ID の解決
     * 例: "入力" (figure TAD のリンク名) → "019ea708-b76a-7e77-..."
     */
    Runtime.prototype._resolveRealIdPath = function (path) {
        if (this._linkNameToRealId && Object.prototype.hasOwnProperty.call(this._linkNameToRealId, path)) {
            return this._linkNameToRealId[path];
        }
        return path;
    };

    /**
     * FOPEN/FREAD/FWRITE 対象パスの安全性検証 (パストラバーサル防止)
     * 許可: 既知リンク名の解決結果 (UUID 実身ID) や realId_N.xtad 形式
     * 拒否: 親ディレクトリ参照・パス区切りを含む文字列
     */
    Runtime.prototype._isSafeRealPath = function (path) {
        if (typeof path !== 'string' || path.length === 0) return false;
        if (path.indexOf('..') !== -1) return false;
        if (path.indexOf('/') !== -1 || path.indexOf('\\') !== -1) return false;
        return true;
    };
    // FOPEN/FREAD/FWRITE/FCLOSE の実身名引数を解決する。
    // バーレ(添字・スライス・状態名なし)のC配列変数は、先頭要素(数値)ではなく文字列全体として扱う。
    // 例: 出力対象実身[:]="SCRIPT" の後 FOPEN 出力対象実身 → "SCRIPT" (従来は 'S'=83 になっていた)。
    Runtime.prototype._evalPathArg = async function (expr, scope, thread) {
        if (expr && expr.type === 'Name' && expr.index == null && !expr.isSlice && !expr.stateName) {
            const isSeg = this.stage.segments && this.stage.segments.has(expr.name);
            const isMacro = this.macros && this.macros[expr.name];
            if (!isSeg && !isMacro) {
                const v = scope.lookup(expr.name);
                if (v && v.data) {
                    const len = (v.size != null ? v.size : v.data.length);
                    if (len > 1) return this._toStr(Array.prototype.slice.call(v.data, 0, len));
                }
            }
        }
        return this._toStr(await this.evalExpr(expr, scope, thread));
    };
    Runtime.prototype.stmtFOpen = async function (stmt, scope, thread) {
        const rawPath = stmt.args[0] ? await this._evalPathArg(stmt.args[0], scope, thread) : '';
        const path = this._resolveRealIdPath(rawPath);
        if (!this._isSafeRealPath(path)) { this.lastErr = 17; return; }
        const mode = stmt.args[1] ? this._toStr(await this.evalExpr(stmt.args[1], scope, thread)) : 'U';
        if (!this.stage.loadRealObject) { this.lastErr = 32; return; }
        try {
            const data = await this.stage.loadRealObject(path);
            this._getFileCache().set(path, { data: data, mode: mode });
            this.lastErr = 0;
        } catch (e) {
            console.log('[MS-RT] FOPEN failed:', rawPath, '->', path, e.message);
            this.lastErr = 32;
        }
    };
    Runtime.prototype.stmtFClose = async function (stmt, scope, thread) {
        const rawPath = stmt.args[0] ? await this._evalPathArg(stmt.args[0], scope, thread) : '';
        const path = this._resolveRealIdPath(rawPath);
        this._getFileCache().delete(path);
        this.lastErr = 0;
    };
    Runtime.prototype._ensureFOpened = async function (path) {
        const realPath = this._resolveRealIdPath(path);
        const cache = this._getFileCache();
        // キャッシュ済みパスは登録時に検証済みのため、 ヒット時は検証をスキップ (FREAD ループの高速化)
        if (cache.has(realPath)) return cache.get(realPath);
        if (!this._isSafeRealPath(realPath)) throw new Error('不正なパス指定: ' + path);
        if (!this.stage.loadRealObject) throw new Error('loadRealObject 未対応');
        const data = await this.stage.loadRealObject(realPath);
        // TADjs Desktop は実身を xtad (XML) で保存しているが、 BTRON マイクロスクリプトは
        // 生のバイナリ TAD を読む前提なので、 ホスト側のヘルパーで TAD バイナリ風に変換する
        if (data && data.records) {
            for (const rec of data.records) {
                const original = rec.data || rec.xtad || '';
                if (typeof original === 'string' && /<tad\b/.test(original)) {
                    rec.data = this._xtadToTadBinary(original);
                }
            }
        }
        cache.set(realPath, { data: data, mode: 'U' });
        return cache.get(realPath);
    };

    /**
     * xtad XML → TAD バイナリ風文字列 (1 char = 1 byte で UH リトルエンディアン格納)
     * BTRON サンプル「プレゼンテーション」 等の「実身読み込み」 関数が読み出せる形式に変換するヘルパー。
     * 各 <p> 本文を改ページ 0x0c で区切り、 TS_TEXT(0xffe1) / TS_TEXTEND(0xffe2) で囲む。
     */
    Runtime.prototype._xtadToTadBinary = function (xtad) {
        const paragraphs = [];
        const reP = /<p[^>]*>([\s\S]*?)<\/p>/g;
        let m;
        while ((m = reP.exec(xtad)) !== null) {
            const inner = m[1]
                .replace(/<br\s*\/?>/g, '\n')
                .replace(/<[^>]+>/g, '')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&amp;/g, '&')
                .replace(/&quot;/g, '"')
                .replace(/&#(\d+);/g, function (_, n) {
                    // UH (16ビット) に収まらない数値参照は除去 (fromCharCode の暗黙切り詰め防止)
                    const code = parseInt(n, 10);
                    return (code >= 0 && code <= 0xFFFF) ? String.fromCharCode(code) : '';
                });
            paragraphs.push(inner);
        }
        // 空段落 (paragraphs に "" が含まれる場合) は段落区切りに含めない。
        const nonEmpty = paragraphs.filter(function (p) { return p.length > 0; });
        // 元データに改ページ (0x0c = FF) が含まれている場合は、 それが BTRON 本来のページ区切りなので
        // 段落を単純連結する。 含まれない場合のみ各段落を1ページとみなして 0x0c で結合する。
        // (両方やると 0x0c が二重になり空ページが挟まって「次」 ボタンの2度押しが必要になる)
        const hasFormFeed = nonEmpty.some(function (p) { return p.indexOf('\x0c') !== -1; });
        const text = hasFormFeed ? nonEmpty.join('') : nonEmpty.join('\x0c');
        console.log('[MS-RT] xtad converted to TAD binary: hasFF=' + hasFormFeed + ', pages=' + ((text.match(/\x0c/g) || []).length + 1) + ', textLen=' + text.length);
        let buf = '';
        function writeUH(v) {
            buf += String.fromCharCode(v & 0xff) + String.fromCharCode((v >> 8) & 0xff);
        }
        writeUH(0xffe1); // TS_TEXT 開始セグメント
        writeUH(0);      // セグメント長 0 (制御セグメント)
        for (let i = 0; i < text.length; i++) {
            writeUH(text.charCodeAt(i));
        }
        writeUH(0xffe2); // TS_TEXTEND 終了セグメント
        writeUH(0);
        return buf;
    };
    Runtime.prototype.stmtFRead = async function (stmt, scope, thread) {
        if (stmt.args.length < 5) { this.lastErr = 17; return; }
        const rawPath = await this._evalPathArg(stmt.args[0], scope, thread);
        const path = this._resolveRealIdPath(rawPath);
        let recNo = await this.evalExpr(stmt.args[1], scope, thread);
        let offset = await this.evalExpr(stmt.args[2], scope, thread);
        let size = await this.evalExpr(stmt.args[3], scope, thread);
        // 引数バリデーション: 数値・非負・整数のみ許可 (不正時はパラメータエラー)
        if (!Number.isFinite(recNo) || !Number.isFinite(offset) || !Number.isFinite(size)) { this.lastErr = 17; return; }
        recNo = Math.trunc(recNo); offset = Math.trunc(offset); size = Math.trunc(size);
        if (recNo < 0 || offset < 0 || size < 0) { this.lastErr = 17; return; }
        const dstNode = stmt.args[4];
        let recSizeNode = stmt.args[5];
        let cache;
        try {
            cache = await this._ensureFOpened(path);
        } catch (e) {
            this.lastErr = 32;
            return;
        }
        const records = (cache.data && cache.data.records) || [];
        // 存在しないレコード番号はエラー (レコード走査ループが $ERR で終了できるように)
        if (recNo >= records.length) { this.lastErr = 17; return; }
        const rec = records[recNo] || { data: '' };
        const dataStr = typeof rec.data === 'string' ? rec.data : (rec.xtad || '');
        const recBytes = dataStr.length;
        const actual = Math.max(0, Math.min(size, recBytes - offset));
        if (actual > 0 && dstNode) {
            const dst = await this._evalLValue(dstNode, scope, thread);
            if (dst) {
                // BTRON TAD バイナリは UH (16ビット、 リトルエンディアン) 単位、
                // バッファは C 配列 (Char = TRONコード = 16ビット) で 2バイト/要素
                const bytesPerElem = 2;
                for (let i = 0; i + bytesPerElem <= actual; i += bytesPerElem) {
                    const elemIdx = dst.start + (i / bytesPerElem);
                    if (elemIdx >= dst.variable.size) break;
                    const lo = dataStr.charCodeAt(offset + i) & 0xff;
                    const hi = dataStr.charCodeAt(offset + i + 1) & 0xff;
                    dst.variable.data[elemIdx] = (hi << 8) | lo;
                }
            }
        }
        if (recSizeNode) {
            // BTRON仕様 09-04-09: 「大きさ」 = レコードの実際の大きさ (全体のサイズ)
            const rs = await this._evalLValue(recSizeNode, scope, thread);
            if (rs) rs.variable.data[rs.start] = recBytes;
        }
        this.lastErr = 0;
    };
    Runtime.prototype.stmtFWrite = async function (stmt, scope, thread) {
        if (stmt.args.length < 5) { this.lastErr = 17; return; }
        const rawPath = await this._evalPathArg(stmt.args[0], scope, thread);
        const path = this._resolveRealIdPath(rawPath);
        let recNo = await this.evalExpr(stmt.args[1], scope, thread);
        let offset = await this.evalExpr(stmt.args[2], scope, thread);
        let size = await this.evalExpr(stmt.args[3], scope, thread);
        // 引数バリデーション: offset は -1 (レコード切り詰め) のみ負値を許可
        if (!Number.isFinite(recNo) || !Number.isFinite(offset) || !Number.isFinite(size)) { this.lastErr = 17; return; }
        recNo = Math.trunc(recNo); offset = Math.trunc(offset); size = Math.trunc(size);
        if (recNo < 0 || size < 0 || (offset < 0 && offset !== -1)) { this.lastErr = 17; return; }
        // レコード番号上限 (巨大値指定による配列膨張 = メモリ DoS 防止)
        const MAX_RECORDS = 4096;
        if (recNo >= MAX_RECORDS) { this.lastErr = 17; return; }
        const srcNode = stmt.args[4];
        let recSizeNode = stmt.args[5];
        let cache;
        try {
            cache = await this._ensureFOpened(path);
        } catch (e) { this.lastErr = 32; return; }
        // BTRON仕様 09-04-11: R 系モード (R/RX/Rx) は読込専用のため書込はエラー
        if (cache.mode && /^R/i.test(cache.mode)) { this.lastErr = 17; return; }
        const records = (cache.data && cache.data.records) || [];
        // 仕様: 飛び番レコード(既存件数より先)への書込は不可。 新規(末尾に1件追加)は offset=0 必須、
        // 既存レコードは offset<=レコードサイズ。 違反は $ERR:32。 無条件 NUL パディングは廃止。
        const origLen = records.length;
        if (recNo > origLen) { this.lastErr = 32; return; }
        const isAppend = (recNo === origLen);
        while (records.length <= recNo) records.push({ data: '' });
        const rec = records[recNo];
        let dataStr = typeof rec.data === 'string' ? rec.data : (rec.xtad || '');
        if (offset === -1) {
            dataStr = dataStr.substring(0, size);
        } else {
            if (isAppend) {
                if (offset !== 0) { this.lastErr = 32; return; }
            } else if (offset > dataStr.length) {
                this.lastErr = 32; return;
            }
            const src = await this._evalLValue(srcNode, scope, thread);
            if (src) {
                let bytes = '';
                for (let i = 0; i < size; i++) {
                    if (src.start + i >= src.variable.size) break;
                    bytes += String.fromCharCode(src.variable.data[src.start + i] & 0xFFFF);
                }
                dataStr = dataStr.substring(0, offset) + bytes + dataStr.substring(offset + size);
            }
        }
        rec.data = dataStr;
        cache.data.records = records;
        if (this.stage.saveRealObject) {
            try { await this.stage.saveRealObject(path, cache.data); } catch (e) { this.lastErr = 32; return; }
        }
        if (recSizeNode) {
            const rs = await this._evalLValue(recSizeNode, scope, thread);
            if (rs) rs.variable.data[rs.start] = dataStr.length;
        }
        this.lastErr = 0;
    };

    // ========================================
    // プロセス / メッセージ通信 (noop + ログ)
    // ========================================
    Runtime.prototype.stmtProcess = async function (stmt, scope, thread) {
        console.warn('[MS-RT] PROCESS は未サポート (noop):', stmt);
        this.lastErr = 48;
    };
    Runtime.prototype.stmtPWait = async function (stmt, scope, thread) {
        console.warn('[MS-RT] PWAIT は未サポート (noop):', stmt);
        this.lastErr = 48;
    };
    // アプリ間通信: localStorage を共有メッセージキューとして全マイクロスクリプトウィンドウ間で実装。
    // サイズはバイト数でなく要素数として扱う近似 (本ランタイムの配列は要素単位のため)
    Runtime.prototype._msgQueueLoad = function () {
        try {
            const s = (typeof localStorage !== 'undefined') ? localStorage.getItem('ms_msgq') : null;
            const q = s ? JSON.parse(s) : [];
            return Array.isArray(q) ? q : [];
        } catch (e) { return []; }
    };
    Runtime.prototype._msgQueueStore = function (q) {
        try { if (typeof localStorage !== 'undefined') localStorage.setItem('ms_msgq', JSON.stringify(q)); } catch (e) {}
    };
    // 仕様: メッセージ/通信のサイズはバイト数。 型ごとのバイト幅 (B=1, C=2, I/F/W/G=4)
    Runtime.prototype._typeBytes = function (vt) {
        return vt === 'B' ? 1 : vt === 'C' ? 2 : 4;
    };
    Runtime.prototype.stmtMSend = async function (stmt, scope, thread) {
        // MSEND プロセスID式, タイプ式, サイズ式, メッセージ本体
        const args = stmt.args || [];
        if (args.length < 4) { this.lastErr = 48; return; }
        const pid = (await this.evalExpr(args[0], scope, thread)) | 0;
        const type = (await this.evalExpr(args[1], scope, thread)) | 0;
        const size = (await this.evalExpr(args[2], scope, thread)) | 0;
        if (type < 0 || type > 7 || size < 0 || size > 4095) { this.lastErr = 48; return; }
        if (size === 0) { this.lastErr = 0; return; } // サイズ0は送信しない
        const src = this._resolveVarFromNode(args[3], scope);
        if (!src) { this.lastErr = 48; return; }
        // 仕様: size はバイト数。 型バイト幅で要素数に変換して本体を取り出し、 バイト長も保存する。
        const eb = this._typeBytes(src.varType);
        const nElems = Math.max(0, Math.floor(size / eb));
        const body = [];
        for (let i = 0; i < Math.min(nElems, src.size); i++) body.push(src.data[i] | 0);
        const q = this._msgQueueLoad();
        q.push({ to: pid, from: this._pid || 0, type: type, body: body, byteLen: size, t: Date.now() });
        if (q.length > 256) q.splice(0, q.length - 256); // キュー暴走防止
        this._msgQueueStore(q);
        this.lastErr = 0;
    };
    Runtime.prototype.stmtMRecv = async function (stmt, scope, thread) {
        // MRECV マスク式, プロセスID変数, タイプ変数, サイズ変数, メッセージ本体 [,タイムアウト式]
        const args = stmt.args || [];
        if (args.length < 5) { this.lastErr = 48; return; }
        const mask = (await this.evalExpr(args[0], scope, thread)) | 0;
        const pidVar = this._resolveVarFromNode(args[1], scope);
        const typeVar = this._resolveVarFromNode(args[2], scope);
        const sizeVar = this._resolveVarFromNode(args[3], scope);
        const bodyVar = this._resolveVarFromNode(args[4], scope);
        let timeoutSec = -1;
        if (stmt.timeout) timeoutSec = await this.evalExpr(stmt.timeout, scope, thread);
        else if (args.length >= 6) timeoutSec = await this.evalExpr(args[5], scope, thread);
        // $MMASK で受信対象に設定されていないタイプは受信できない
        const effMask = mask & (this._mmask || 0);
        const myPid = this._pid || 0;
        const start = Date.now();
        thread._waiting = true;
        try {
            while (!thread.terminated && !this.finished) {
                const q = this._msgQueueLoad();
                let found = -1;
                for (let i = 0; i < q.length; i++) {
                    const m = q[i];
                    if ((m.to === myPid || m.to === 0) && (effMask & (1 << (m.type | 0)))) { found = i; break; }
                }
                if (found >= 0) {
                    const m = q.splice(found, 1)[0];
                    this._msgQueueStore(q);
                    // 自プロセスからのメッセージは送信元 0
                    if (pidVar) pidVar.data[0] = (m.from === myPid) ? 0 : m.from;
                    if (typeVar) typeVar.data[0] = m.type | 0;
                    if (sizeVar) sizeVar.data[0] = (typeof m.byteLen === 'number') ? m.byteLen : m.body.length; // 仕様: サイズはバイト数
                    if (bodyVar) {
                        const n = Math.min(m.body.length, bodyVar.size);
                        for (let i = 0; i < n; i++) bodyVar.data[i] = m.body[i] | 0;
                    }
                    this.lastErr = 0;
                    return;
                }
                // $ERR: 受信=0 / タイムアウト=1 / BREAK 解除=2
                if (thread._breakSignal) { thread._breakSignal = false; this.lastErr = 2; return; }
                if (timeoutSec === 0) { this.lastErr = 1; return; }
                if (timeoutSec > 0 && (Date.now() - start) >= timeoutSec * 1000) { this.lastErr = 1; return; }
                await new Promise(function (r) { setTimeout(r, 50); });
            }
        } finally {
            thread._waiting = false;
        }
    };

    // ========================================
    // HW依存 (デバイス/シリアル) は noop
    // ========================================
    Runtime.prototype.stmtHWNoop = function (stmt) {
        console.warn('[MS-RT] ' + stmt.type + ' は HW 依存のため未対応 (noop)');
        this.lastErr = 16;
    };

    // ========================================
    // シリアルポート (RS 系: 09-04-14) — Web Serial API 経由 (serialManager)
    // ========================================
    // データ式列 → バイト配列。 数値は下位8bit、 文字列は各文字コードの下位8bit、 配列は各要素下位8bit
    Runtime.prototype._rsArgsToBytes = async function (argNodes, startIdx, scope, thread) {
        const bytes = [];
        for (let i = startIdx; i < argNodes.length; i++) {
            const v = await this.evalExpr(argNodes[i], scope, thread);
            if (typeof v === 'string') {
                for (let k = 0; k < v.length; k++) bytes.push(v.charCodeAt(k) & 0xFF);
            } else if (Array.isArray(v)) {
                for (let k = 0; k < v.length; k++) bytes.push((v[k] | 0) & 0xFF);
            } else {
                bytes.push((v | 0) & 0xFF);
            }
        }
        return bytes;
    };

    Runtime.prototype.stmtRsInit = async function (stmt, scope, thread) {
        if (!this.serialManager) { this.lastErr = 16; return; }
        const a = stmt.args || [];
        const port = a.length > 0 ? (await this.evalExpr(a[0], scope, thread) | 0) : 0;
        const mode = a.length > 1 ? (await this.evalExpr(a[1], scope, thread) | 0) : 0;
        const baud = a.length > 2 ? (await this.evalExpr(a[2], scope, thread) | 0) : 0;
        this.lastErr = await this.serialManager.init(port, mode, baud);
    };

    Runtime.prototype.stmtRsPut = async function (stmt, scope, thread, clearInput) {
        if (!this.serialManager) { this.lastErr = 16; return; }
        const a = stmt.args || [];
        const port = a.length > 0 ? (await this.evalExpr(a[0], scope, thread) | 0) : 0;
        const bytes = await this._rsArgsToBytes(a, 1, scope, thread);
        this.lastErr = await this.serialManager.send(port, bytes, clearInput);
    };

    Runtime.prototype.stmtRsWait = async function (stmt, scope, thread) {
        if (!this.serialManager) { this.lastErr = 16; return; }
        const a = stmt.args || [];
        const port = a.length > 0 ? (await this.evalExpr(a[0], scope, thread) | 0) : 0;
        const seq = await this._rsArgsToBytes(a, 1, scope, thread);
        if (seq.length === 0) { this.lastErr = 0; return; }
        const timeoutSec = stmt.timeout != null ? await this.evalExpr(stmt.timeout, scope, thread) : -1;
        const start = Date.now();
        // SLEEP/WAIT と同形の非同期待ち。 $ERR: 受信=0 / タイムアウト=1 / BREAK 解除=2
        while (true) {
            if (thread.terminated) return;
            if (this.serialManager.bufferContains(port, seq)) { this.lastErr = 0; return; }
            if (thread._breakSignal) { thread._breakSignal = false; this.lastErr = 2; return; }
            if (timeoutSec === 0) { this.lastErr = 1; return; }
            if (timeoutSec > 0 && (Date.now() - start) >= timeoutSec * 1000) { this.lastErr = 1; return; }
            await new Promise(function (r) { setTimeout(r, 20); });
        }
    };

    Runtime.prototype.stmtRsGet = async function (stmt, scope, thread, clear) {
        if (!this.serialManager) { this.lastErr = 16; this._rsData = []; this._rsCnt = 0; return; }
        const a = stmt.args || [];
        const port = a.length > 0 ? (await this.evalExpr(a[0], scope, thread) | 0) : 0;
        const res = this.serialManager.receive(port, clear);
        this._rsData = res.data;   // $RS[n] が参照
        this._rsCnt = res.cnt;     // $RSCNT が参照
        this.lastErr = 0;
    };

    Runtime.prototype.stmtRsCntl = async function (stmt, scope, thread) {
        if (!this.serialManager) { this.lastErr = 16; return; }
        const a = stmt.args || [];
        const port = a.length > 0 ? (await this.evalExpr(a[0], scope, thread) | 0) : 0;
        const func = a.length > 1 ? (await this.evalExpr(a[1], scope, thread) | 0) : 0;
        const res = await this.serialManager.control(port, func);
        this.lastErr = res.err;
        // func0: 回線状態を変数へ格納 (bit0=CI,1=CS,2=CD,3=DSR)
        if (func === 0 && a.length > 2) {
            const v = this._resolveVarFromNode(a[2], scope);
            if (v && v.data) v.data[0] = res.status;
        }
    };

    // ========================================
    // formatString
    // ========================================
    Runtime.prototype.formatString = function (fmt, args) {
        let fmtStr;
        if (Array.isArray(fmt)) fmtStr = codepointsToString(fmt);
        else if (typeof fmt === 'string') fmtStr = fmt;
        else fmtStr = String(fmt);
        // 図形由来 (.TX 等) の書式文字列はレクサーを通らないため、 全角 ％ 等をここで正規化する
        if (global.MSLexer && global.MSLexer.normalize) fmtStr = global.MSLexer.normalize(fmtStr);
        let out = '';
        let ai = 0;
        let i = 0;
        while (i < fmtStr.length) {
            const c = fmtStr[i];
            if (c === '%' && i + 1 < fmtStr.length) {
                let j = i + 1;
                let leftAlign = false;
                let width = 0;
                let zeroPad = false;
                let precision = -1;
                if (fmtStr[j] === '-') { leftAlign = true; j++; }
                if (fmtStr[j] === '0') { zeroPad = true; j++; }
                while (fmtStr[j] >= '0' && fmtStr[j] <= '9') { width = width * 10 + (fmtStr.charCodeAt(j) - 48); j++; }
                if (fmtStr[j] === '.') {
                    j++; precision = 0;
                    while (fmtStr[j] >= '0' && fmtStr[j] <= '9') { precision = precision * 10 + (fmtStr.charCodeAt(j) - 48); j++; }
                }
                const spec = fmtStr[j];
                if (spec === '%') { out += '%'; i = j + 1; continue; }
                if (spec === 'n') { out += '\n'; i = j + 1; continue; }
                const a = args[ai++];
                let s = '';
                if (spec === 'd') s = String(Math.trunc(a));
                else if (spec === 'x') s = (Math.trunc(a) >>> 0).toString(16);
                else if (spec === 'X') s = (Math.trunc(a) >>> 0).toString(16).toUpperCase();
                else if (spec === 'f') s = (precision >= 0 ? a.toFixed(precision) : a.toFixed(6));
                else if (spec === 'e') s = (precision >= 0 ? a.toExponential(precision) : a.toExponential(6)).replace(/e([+-])(\d)$/, 'e$10$2'); // 指数2桁(C準拠)
                else if (spec === 'E') s = (precision >= 0 ? a.toExponential(precision) : a.toExponential(6)).toUpperCase().replace(/E([+-])(\d)$/, 'E$10$2');
                else if (spec === 'g' || spec === 'G') {
                    // %e/%f 自動切替: |値| < 0.0001 または整数部が桁数 (省略時6) に入り切らない場合は指数形式
                    const p = precision >= 0 ? Math.max(1, precision) : 6;
                    const av = Math.abs(a);
                    const intDigits = (av >= 1) ? Math.floor(Math.log10(av)) + 1 : 1;
                    let g;
                    if (a !== 0 && isFinite(a) && (av < 0.0001 || intDigits > p)) {
                        g = a.toExponential(Math.max(0, p - 1));
                        // 仮数部の末尾 0 は省き、 指数は 2 桁に揃える (例 9.00000e-5 → 9e-05)
                        g = g.replace(/\.?0+e/, 'e').replace(/e([+-])(\d)$/, 'e$10$2');
                    } else {
                        g = Number(a).toPrecision(p);
                        if (g.indexOf('e') < 0 && g.indexOf('.') >= 0) g = g.replace(/\.?0+$/, '');
                    }
                    s = (spec === 'G') ? g.toUpperCase() : g;
                }
                else if (spec === 's') {
                    let str = Array.isArray(a) ? codepointsToString(a) : String(a);
                    if (precision >= 0 && str.length > precision) str = str.substr(0, precision);
                    s = str;
                }
                else if (spec === 'c') s = String.fromCharCode(a | 0);
                else { i++; continue; }
                if (width > s.length) {
                    const pad = (zeroPad && (spec === 'd' || spec === 'x' || spec === 'X')) ? '0' : ' ';
                    if (leftAlign) s = s + ' '.repeat(width - s.length);
                    else s = pad.repeat(width - s.length) + s;
                }
                out += s;
                i = j + 1;
                continue;
            }
            if (c === '\\' && i + 1 < fmtStr.length && fmtStr[i + 1] === 'n') {
                out += '\n'; i += 2; continue;
            }
            out += c;
            i++;
        }
        return out;
    };

    global.MSRuntime = {
        Runtime: Runtime,
        Segment: Segment,
        codepointsToString: codepointsToString,
        stringToCodepoints: stringToCodepoints
    };
})(typeof window !== 'undefined' ? window : globalThis);
