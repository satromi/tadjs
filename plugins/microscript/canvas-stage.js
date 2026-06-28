/**
 * Canvas ベースの舞台 (Stage)
 *
 * セグメントは shapes (図形プリミティブ配列) を持ち、 グループ座標系で記述される。
 * Stage は Canvas 上にセグメント全体を描画し、 マウス/キーボードイベントを Runtime に橋渡しする。
 */
(function (global) {
    'use strict';

    function CanvasStage(canvasEl, messageEl, opts) {
        this.canvas = canvasEl;
        this.ctx = canvasEl.getContext('2d');
        this.messageEl = messageEl;
        this.backgroundShapes = [];
        this.segments = new Map();
        this.dpr = window.devicePixelRatio || 1;
        this.dataFolder = opts && opts.dataFolder ? opts.dataFolder : null;
        this.clickHandlers = new Map();
        this.pressHandlers = new Map();
        this.dclickHandlers = new Map();
        this.qpressHandlers = new Map();
        this.keyHandlers = [];
        this.pdx = 0;
        this.pdy = 0;
        this.pdb = 0;
        this.pds = 0;
        this.lastKey = 0;
        this.metaKey = 0;
        this.kstat = 0;
        this.wdx = 0;
        this.wdy = 0;
        this.wact = 1;
        this._updateEnabled = true;
        this._activeInput = null; /* { seg, kanji, onDone } */
        this._segmentSeq = 0;
        // ウィンドウ背景色 (仮身の背景色を app.js が init から引き渡す)
        this.backgroundColor = (opts && opts.backgroundColor) || '#ffffff';
        // 作業領域 (figView) — MOVE ではみ出した図形をこの矩形でクリップする (app.js が設定)
        this.figView = (opts && opts.figView) || null;
        // ホスト連携用コールバック (app.js が設定)
        this.notifyHost = (opts && opts.notifyHost) || null;
        this.loadRealObject = (opts && opts.loadRealObject) || null;
        this.saveRealObject = (opts && opts.saveRealObject) || null;
        this.listVirtualObjects = (opts && opts.listVirtualObjects) || null;
        this.resolveImagePath = (opts && opts.resolveImagePath) || null;
        this._resizeBound = this._handleResize.bind(this);
        window.addEventListener('resize', this._resizeBound);
        this._resizeCanvas();
        this._setupEvents();
    }

    CanvasStage.prototype.destroy = function () {
        window.removeEventListener('resize', this._resizeBound);
        // _setupEvents で登録した全リスナを解除 (再初期化時のリスナ蓄積・リーク防止)
        if (this._listeners) {
            this._listeners.forEach(function (l) { l[0].removeEventListener(l[1], l[2]); });
            this._listeners = [];
        }
    };

    CanvasStage.prototype._resizeCanvas = function () {
        const rect = this.canvas.getBoundingClientRect();
        const w = Math.max(1, Math.floor(rect.width));
        const h = Math.max(1, Math.floor(rect.height));
        this.canvas.width = Math.floor(w * this.dpr);
        this.canvas.height = Math.floor(h * this.dpr);
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        this.render();
    };

    CanvasStage.prototype._handleResize = function () {
        this._resizeCanvas();
    };

    CanvasStage.prototype._setupEvents = function () {
        const self = this;
        // destroy() で全リスナを解除できるよう [target, type, fn] を記録しながら登録する
        this._listeners = [];
        const listen = function (target, type, fn) {
            target.addEventListener(type, fn);
            self._listeners.push([target, type, fn]);
        };
        const eventCoords = function (e) {
            const r = self.canvas.getBoundingClientRect();
            return { x: e.clientX - r.left, y: e.clientY - r.top };
        };
        listen(this.canvas, 'mousemove', function (e) {
            const c = eventCoords(e);
            self.pdx = c.x; self.pdy = c.y;
        });
        listen(this.canvas, 'mousedown', function (e) {
            // 左ボタンのみスクリプトイベント対象 (右ボタンはコンテキストメニュー用)
            if (e.button !== 0) return;
            const c = eventCoords(e);
            self.pdx = c.x; self.pdy = c.y;
            self.pdb = 1;
            // この相互作用を占有する単一セグメントを決定 (いずれかのポインタハンドラを持つ最前面)。
            // PRESS はそのセグメントの press ハンドラのみ発火する。 PRESS を持たなければ何も発火しない
            // (下層の別セグメントへは漏らさない)。
            const seg = self.hitTestAnyHandler(c.x, c.y);
            if (!seg) return;
            const handlers = self.pressHandlers.get(seg._key) || [];
            // 第2引数 (番号) は runtime 側で ACTION targets の index から決定するため、 ここでは未使用 (0 固定)。
            // 第3/第4引数は仕様(CLICK/PRESS/DCLICK/QPRESS): 発生 X/Y 座標 = ウィンドウ左上(0,0)基準の相対値。
            // (セグメント相対ではない。 ソリティアの掴みオフセット sx=x-カード.X はこの前提)
            handlers.forEach(function (h) { h(seg, 0, c.x, c.y); });
        });
        const onMouseUp = function (e) { if (e.button === 0) self.pdb = 0; };
        listen(this.canvas, 'mouseup', onMouseUp);
        listen(document, 'mouseup', onMouseUp);
        self._pendingClickTimers = {};
        listen(this.canvas, 'click', function (e) {
            const c = eventCoords(e);
            // mousedown と同じ占有セグメントへ CLICK/QPRESS を発火する。 このセグメントが CLICK を
            // 持たなければ何も発火しない(下層 back の 背景がクリックされた 等へは漏らさない)。
            const seg = self.hitTestAnyHandler(c.x, c.y);
            if (!seg) return;
            const fireClick = function () {
                (self.clickHandlers.get(seg._key) || []).forEach(function (h) { h(seg, 0, c.x, c.y); });
                // QPRESS (クイックプレス) は click イベントで代用発火する
                (self.qpressHandlers.get(seg._key) || []).forEach(function (h) { h(seg, 0, c.x, c.y); });
            };
            // 仕様(PRESS⊂CLICK⊂QPRESS⊂DCLICK): 同一セグメントに DCLICK が定義されていると、
            // ダブルクリックでは CLICK でなく DCLICK を起動する。 ブラウザは ダブルクリックで
            // click→click→dblclick を発火するため、 DCLICK 在時は CLICK を短時間遅延し、
            // dblclick が来たらキャンセルする(=DCLICK のみ起動)。DCLICK 不在なら即時発火(従来通り)。
            if (self.dclickHandlers.has(seg._key)) {
                const k = seg._key;
                const arr = self._pendingClickTimers[k] || (self._pendingClickTimers[k] = []);
                const id = setTimeout(function () {
                    const idx = arr.indexOf(id); if (idx >= 0) arr.splice(idx, 1);
                    fireClick();
                }, 300);
                arr.push(id);
            } else {
                fireClick();
            }
        });
        listen(this.canvas, 'dblclick', function (e) {
            const c = eventCoords(e);
            const seg = self.hitTestAnyHandler(c.x, c.y);
            if (!seg || !self.dclickHandlers.has(seg._key)) return;
            // 保留中の CLICK(同セグメント)をキャンセルして DCLICK のみ起動する
            const arr = self._pendingClickTimers[seg._key];
            if (arr) { arr.forEach(function (id) { clearTimeout(id); }); arr.length = 0; }
            (self.dclickHandlers.get(seg._key) || []).forEach(function (h) { h(seg, 0, c.x, c.y); });
        });
        listen(this.canvas, 'keydown', function (e) {
            const kc = e.keyCode || e.which || 0;
            // 論理キーの文字コード対応 (改行/一字消/削除/タブ/カーソルキー等の非印字キー)
            const SPECIAL_KEYS = {
                Enter: 0x0A, Backspace: 0x08, Delete: 0x7F, Tab: 0x09, Escape: 0x1B,
                // BTRON カーソルキーコード: 上256(0x100) 下257(0x101) 右258(0x102) 左259(0x103)
                ArrowUp: 0x100, ArrowDown: 0x101, ArrowLeft: 0x103, ArrowRight: 0x102
            };
            let charCode = (e.key && e.key.length === 1) ? e.key.charCodeAt(0) : 0;
            if (!charCode && e.key && SPECIAL_KEYS[e.key] != null) charCode = SPECIAL_KEYS[e.key];
            // マイクロスクリプトの $KEY は文字を TRON(全角)コードで参照する (例: 4→0x2334, z→0x237A, 空白→0x2121)。
            // 印字可能 ASCII を TRON 全角へ変換する (カーソルキー等の 0x100 以上の特殊コードや制御コードは対象外)。
            if (charCode === 0x20) charCode = 0x2121;
            else if (charCode >= 0x21 && charCode <= 0x7E) charCode = 0x2300 + charCode;
            const mk = (e.shiftKey ? 0x10 : 0) | (e.ctrlKey ? 0x40 : 0) | (e.altKey ? 0x80 : 0);
            self.lastKey = charCode || kc;
            self.metaKey = mk;
            self.kstat = mk;
            // 文字入力中 (_activeInput) は隠し input が IME 込みで処理するため canvas 側では文字を扱わない
            // (通常は input にフォーカスがあり canvas の keydown は発火しないが、 二重入力の保険)
            if (self._activeInput) return;
            self.keyHandlers.forEach(function (h) { h(self.lastKey, mk); });
        });
        this.canvas.setAttribute('tabindex', '0');
        // フォーカス自動取得 (キー入力受信のため)
        listen(this.canvas, 'mousedown', function () { self.canvas.focus(); });
    };

    CanvasStage.prototype.setUpdateEnabled = function (enabled) {
        this._updateEnabled = !!enabled;
        if (enabled) this.render();
    };

    CanvasStage.prototype.setCursorShape = function (shape) {
        const map = {
            0: 'default', 1: 'pointer', 2: 'move', 3: 'ns-resize', 4: 'ew-resize',
            5: 'grabbing', 6: 'ns-resize', 7: 'ew-resize', 8: 'crosshair',
            9: 'ns-resize', 10: 'ew-resize', 11: 'grab', 12: 'ns-resize',
            13: 'ew-resize', 14: 'wait', 15: 'context-menu'
        };
        if (shape === -1) this.canvas.style.cursor = 'none';
        else this.canvas.style.cursor = map[shape] || 'default';
    };

    // IME (かな漢字変換) 対応のため、 canvas に重ねた透明な隠し input を入力対象にする。
    // canvas は IME の編集対象になれず keydown だけでは確定文字列を取得できないため。
    // 文字自体は canvas に描画するので input は透明 (color/caret transparent) にする
    CanvasStage.prototype._ensureInputEl = function () {
        if (this._inputEl) return this._inputEl;
        const el = document.createElement('input');
        el.type = 'text';
        el.setAttribute('autocomplete', 'off');
        el.setAttribute('autocorrect', 'off');
        el.setAttribute('autocapitalize', 'off');
        el.style.position = 'absolute';
        el.style.zIndex = '1000';
        el.style.background = 'transparent';
        el.style.border = 'none';
        el.style.outline = 'none';
        el.style.color = 'transparent';
        el.style.caretColor = 'transparent';
        el.style.padding = '0';
        el.style.margin = '0';
        el.style.left = '-9999px';
        const parent = this.canvas.parentNode || document.body;
        try {
            if (parent && parent.style && getComputedStyle(parent).position === 'static') {
                parent.style.position = 'relative';
            }
        } catch (e) { /* getComputedStyle 不可環境は無視 */ }
        (parent || document.body).appendChild(el);
        const self = this;
        // IME 確定文字列も含め、 input の value 全体を入力バッファとして同期する
        el.addEventListener('input', function () {
            if (!self._activeInput) return;
            self._activeInput.buffer = el.value;
            self._syncInputText(self._activeInput.seg, el.value);
            self.render();
        });
        el.addEventListener('keydown', function (e) {
            if (!self._activeInput) return;
            // IME 変換確定中の Enter は入力確定 (改行) と区別する
            if (e.isComposing) return;
            if (e.key === 'Enter' || e.key === 'Escape') {
                e.preventDefault();
                self.endInput();
                return;
            }
            // タブは入力中でも KEY イベントを発火 (仕様: 文字入力中でも文字キー・一字消・削除以外の
            // キーは KEY イベント対象)。 数値ボックスのタブ移動 (KEY で次欄をアクティブ化) がこの経路で動く。
            // ブラウザの既定フォーカス移動は抑止する
            if (e.key === 'Tab') {
                e.preventDefault();
                const mk = (e.shiftKey ? 0x10 : 0) | (e.ctrlKey ? 0x40 : 0) | (e.altKey ? 0x80 : 0);
                self.lastKey = 0x09; self.metaKey = mk; self.kstat = mk;
                self.keyHandlers.forEach(function (h) { h(0x09, mk); });
                return;
            }
            // 一字消去/カーソル移動/文字入力は input 要素が自然処理し input イベントで反映される
        });
        this._inputEl = el;
        return el;
    };

    CanvasStage.prototype.beginInput = function (seg, kanji, onDone, x, y) {
        // x,y: INPUT/KINPUT のカーソル初期位置 (セグメント相対、 省略可)。
        // 仕様: 座標が省略/負値/セグメント外 のときは既定位置 (INPUT=末尾, KINPUT=先頭) にする。
        let cx = (typeof x === 'number') ? x : null;
        let cy = (typeof y === 'number') ? y : null;
        if (cx != null && (cx < 0 || cx >= (seg.w || 0))) cx = null;
        if (cy != null && (cy < 0 || cy >= (seg.h || 0))) cy = null;
        if (cx == null || cy == null) { cx = null; cy = null; } // どちらか無効なら既定位置
        this._activeInput = { seg: seg, kanji: !!kanji, onDone: onDone, buffer: seg.text || '', x: cx, y: cy };
        const el = this._ensureInputEl();
        // KINPUT(kanji=true) は IME 有効、 INPUT(kanji=false) は IME 抑止 (ローマ字/数字直接入力)
        el.style.imeMode = kanji ? 'active' : 'disabled';
        el.setAttribute('inputmode', 'text');
        // 入力欄を文字描画開始位置に重ねる (IME 変換候補ウィンドウの表示位置の目安)
        const anchor = this._getInputTextAnchor(seg);
        el.style.left = ((anchor && anchor.x != null ? anchor.x : seg.x)) + 'px';
        el.style.top = ((anchor && anchor.y != null ? anchor.y : seg.y)) + 'px';
        el.style.width = Math.max(40, (seg.w || 80)) + 'px';
        el.style.height = ((seg.tsize || 14) + 4) + 'px';
        el.style.font = (seg.tsize || 14) + 'px sans-serif';
        el.value = seg.text || '';
        el.focus();
        try { const _caret = kanji ? 0 : el.value.length; el.setSelectionRange(_caret, _caret); } catch (e2) {} // 仕様: INPUT=末尾, KINPUT(kanji)=先頭
        this.render();
    };

    // 引数なし INPUT/KINPUT: 入力状態を解除して現在のバッファを確定する
    CanvasStage.prototype.endInput = function () {
        const ip = this._activeInput;
        if (!ip) return;
        const finalText = this._inputEl ? this._inputEl.value : ip.buffer;
        this._syncInputText(ip.seg, finalText);
        const done = ip.onDone;
        this._activeInput = null;
        if (this._inputEl) {
            this._inputEl.blur();
            this._inputEl.value = '';
            this._inputEl.style.left = '-9999px';
        }
        try { this.canvas.focus(); } catch (e) {}
        this.render();
        if (done) done();
    };

    CanvasStage.prototype._syncInputText = function (seg, str) {
        seg.text = str;
        const arr = [];
        for (let i = 0; i < str.length; i++) arr.push(str.charCodeAt(i));
        arr.push(0);
        seg.tx = arr;
        // 内部の最初の非ラベル text shape の中身を更新 (描画反映用)
        if (seg.shapes) {
            for (let i = 0; i < seg.shapes.length; i++) {
                const s = seg.shapes[i];
                if (s.kind === 'text' && s !== seg.labelShape) {
                    s.text = str;
                    break;
                }
            }
        }
    };

    CanvasStage.prototype._handleInputKey = function (e, charCode, kc) {
        const ip = this._activeInput;
        if (!ip) return;
        if (kc === 13) {
            // Enter: 確定
            this._syncInputText(ip.seg, ip.buffer);
            const done = ip.onDone;
            this._activeInput = null;
            this.render();
            if (done) done();
            e.preventDefault();
            return;
        }
        if (kc === 8) {
            // Backspace
            ip.buffer = ip.buffer.substring(0, ip.buffer.length - 1);
            e.preventDefault();
        } else if (charCode >= 0x20 && charCode !== 0x7F && !(charCode >= 0x100 && charCode <= 0x103)) {
            // 印字可能文字のみ挿入 (Tab/Delete/カーソルキーの制御コードは除外。 全角・かな等は挿入可)
            ip.buffer += String.fromCharCode(charCode);
            e.preventDefault();
        }
        this._syncInputText(ip.seg, ip.buffer);
        this.render();
    };

    CanvasStage.prototype.injectEvent = function (kind, charCode, state, x, y) {
        // 合成イベント発火
        const self = this;
        if (kind === 'KEYC' || kind === 'KEYD' || kind === 'KEYU') {
            self.lastKey = charCode | 0;
            self.metaKey = state | 0;
            self.keyHandlers.forEach(function (h) { h(charCode | 0, state | 0); });
            return;
        }
        if (kind === 'BUTC' || kind === 'BUTD' || kind === 'BUTU') {
            const tx = (x != null) ? x : self.pdx;
            const ty = (y != null) ? y : self.pdy;
            const seg = self.hitTest(tx, ty);
            if (!seg) return;
            if (kind === 'BUTD' || kind === 'BUTC') {
                const ph = self.pressHandlers.get(seg._key) || [];
                ph.forEach(function (h) { h(seg, 0, tx - seg.x, ty - seg.y); });
            }
            if (kind === 'BUTC') {
                const ch = self.clickHandlers.get(seg._key) || [];
                ch.forEach(function (h) { h(seg, 0, tx - seg.x, ty - seg.y); });
            }
        }
    };

    CanvasStage.prototype.addBackgroundShape = function (shape) {
        this.backgroundShapes.push(shape);
    };

    CanvasStage.prototype.registerSegment = function (seg) {
        seg._z = ++this._segmentSeq;
        // 同名セグメント共存: 図形は同名カード(?01..?13)を4スート分=4インスタンス持つ。 名前キーで
        // 上書きすると39枚消える(赤カード消失・ドラッグ不能の原因)ため、 インスタンス単位で保持する。
        // segments Map のキーは「一意キー _key」(同名の2個目以降は接尾辞付き)。 occ=0 は _key=name の
        // ため既存の segments.get(name) は occ0 を返し後方互換。 segmentsByName で出現順アクセスを提供。
        if (!this.segmentsByName) this.segmentsByName = new Map();
        let list = this.segmentsByName.get(seg.name);
        if (!list) { list = []; this.segmentsByName.set(seg.name, list); }
        const occ = list.length;
        seg._key = (occ === 0) ? seg.name : (seg.name + '' + occ);
        list.push(seg);
        this.segments.set(seg._key, seg);
    };

    // 同名セグメントの occ 番目インスタンスを返す (無ければ occ0、 それも無ければ null)
    CanvasStage.prototype.getSegmentByOcc = function (name, occ) {
        const list = this.segmentsByName ? this.segmentsByName.get(name) : null;
        if (!list || list.length === 0) return this.segments.get(name) || null;
        return list[occ] || list[0];
    };

    // 同名インスタンスの occ 順を「図形の登場順」から「原位置 (x優先,y次) 順」へ整列する。
    // ソリティアのカード ?01..?13×4 は occ=スート(x列)順である前提だが、 図形データの並びが
    // 一部ランク(例 ?12)で崩れ occ とスート列がズレることがある。 occ を空間配置(x列=スート)に
    // 揃えることで、 表示束縛(カード表[i])・イベント index(n)・配置可否(floor(n/13))を整合させる。
    // occ を消費・参照する getSegmentByOcc / stmtSet は同一配列を見るため、 この1回の整列で両者に効く。
    // 全セグメント登録後・start()(イベント束縛/PROLOGUE)前に呼ぶこと(=カード未移動で x が原位置=スート列)。
    CanvasStage.prototype.sortSegmentInstancesByPosition = function () {
        if (!this.segmentsByName) return;
        this.segmentsByName.forEach(function (list) {
            if (list && list.length > 1) {
                list.sort(function (a, b) {
                    if (a.x !== b.x) return a.x - b.x;
                    return a.y - b.y;
                });
            }
        });
    };

    CanvasStage.prototype.applyVisibility = function (seg) {
        this.render();
    };
    CanvasStage.prototype.applyPosition = function (seg) {
        this.render();
    };
    CanvasStage.prototype.applyText = function (seg) {
        this.render();
    };
    CanvasStage.prototype.bringToFront = function (seg) {
        seg._z = ++this._segmentSeq;
    };

    CanvasStage.prototype.hitTest = function (x, y) {
        let best = null;
        let bestZ = -1;
        this.segments.forEach(function (seg) {
            if (!seg.visible) return;
            if (x >= seg.x && x < seg.x + seg.w && y >= seg.y && y < seg.y + seg.h) {
                if (seg._z >= bestZ) { bestZ = seg._z; best = seg; }
            }
        });
        return best;
    };

    // 指定イベントの「ハンドラを持つ」最前面の可視セグメントを返す。 ハンドラの無い最前面セグメント
    // (例: ソリティア確認パネルのボタン枠 sw2U は枠だけでハンドラ無し)は透過し、 下層の
    // ハンドラ持ちセグメント(背景 back の CLICK、 パターンの PRESS 等)へイベントを伝播させる。
    // BTRON: イベントは「そのイベントが定義されたセグメント」で起動する。
    CanvasStage.prototype.hitTestWithHandler = function (x, y, handlerMap) {
        let best = null, bestZ = -1;
        this.segments.forEach(function (seg) {
            if (!seg.visible) return;
            if (seg._z >= bestZ && handlerMap.has(seg._key) &&
                x >= seg.x && x < seg.x + seg.w && y >= seg.y && y < seg.y + seg.h) {
                bestZ = seg._z; best = seg;
            }
        });
        return best;
    };

    // 1つのポインタ相互作用は「いずれかのポインタイベント(PRESS/CLICK/QPRESS/DCLICK)ハンドラを持つ
    // 最前面の可視セグメント」が占有する。 この単一セグメントを返し、 各イベント種別はこのセグメントの
    // 該当ハンドラのみ発火させる(イベント種別ごとに別々の下層セグメントへ漏らさない)。
    // 例: 得点パネルのセレクタ stx01 を押すと、 PRESS は stx01 が占有し、 下層 back の CLICK
    // (背景がクリックされた=カード選択)は発火しない。 ハンドラ無しの枠(sc0U 等)は透過する。
    CanvasStage.prototype.hitTestAnyHandler = function (x, y) {
        const self = this;
        let best = null, bestZ = -1;
        this.segments.forEach(function (seg) {
            if (!seg.visible) return;
            if (seg._z <= bestZ) return;
            if (!(x >= seg.x && x < seg.x + seg.w && y >= seg.y && y < seg.y + seg.h)) return;
            const k = seg._key;
            if (self.pressHandlers.has(k) || self.clickHandlers.has(k) ||
                self.dclickHandlers.has(k) || self.qpressHandlers.has(k)) {
                bestZ = seg._z; best = seg;
            }
        });
        return best;
    };

    CanvasStage.prototype.message = function (text) {
        if (!this.messageEl) return;
        this.messageEl.textContent += text;
        this.messageEl.scrollTop = this.messageEl.scrollHeight;
    };
    CanvasStage.prototype.clearMessage = function () {
        if (this.messageEl) this.messageEl.textContent = '';
    };

    // SETSEG 内容共有: _sharedFrom チェーンを末端まで辿り、 描画に使う最新 shapes を持つセグメントを返す。
    // 例: SETSEG X1=X0 後に SETSEG X0=F2 で X0 の内容を差し替えると、 X1→X0→F2 と辿り X1 も追従する
    CanvasStage.prototype._resolveSharedContent = function (seg) {
        let cur = seg;
        const visited = {};
        while (cur && cur._sharedFrom && !visited[cur.name]) {
            visited[cur.name] = true;
            const next = this.segments.get(cur._sharedFrom);
            if (!next) break;
            cur = next;
        }
        return cur;
    };

    CanvasStage.prototype.render = function () {
        if (this._updateEnabled === false) return;
        const ctx = this.ctx;
        const rect = this.canvas.getBoundingClientRect();
        ctx.save();
        ctx.fillStyle = this.backgroundColor || '#ffffff';
        ctx.fillRect(0, 0, rect.width, rect.height);
        ctx.restore();

        // figView でクリップ (MOVE ではみ出した図形を作業領域内に制限。 figView 無しなら従来通り)
        const _fv = this.figView;
        if (_fv) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(_fv.left, _fv.top, _fv.right - _fv.left, _fv.bottom - _fv.top);
            ctx.clip();
        }

        for (let i = 0; i < this.backgroundShapes.length; i++) {
            this._drawShape(this.backgroundShapes[i], 0, 0);
        }

        const visibles = [];
        this.segments.forEach(function (seg) { if (seg.visible) visibles.push(seg); });
        visibles.sort(function (a, b) { return a._z - b._z; });

        for (let i = 0; i < visibles.length; i++) {
            const seg = visibles[i];
            // SETSEG 内容共有: 共有元の最新 shapes を辿って描画 (X0 差し替えで X1/X2/X3 も同時追従)
            const drawShapes = this._resolveSharedContent(seg).shapes;
            if (!drawShapes) continue;
            // BTRON仕様: セグメントに .TFCOL が設定されていれば、 そのセグメント内の図形テキストの
            // 文字色を tfcol で上書きする (例: 色見本スウォッチ 色表示 は「■」文字の色を色表示.TFCOL で変える)。
            this._curSegTfcol = (typeof seg.tfcol === 'number' && seg.tfcol >= 0) ? seg.tfcol : null;
            for (let j = 0; j < drawShapes.length; j++) {
                this._drawShape(drawShapes[j], seg.x, seg.y);
            }
            this._curSegTfcol = null;
            if (seg.textOverride) {
                this._drawTextOverride(seg);
            }
        }
        if (_fv) ctx.restore();
        // INPUT カーソル: 内部 text shape の実描画位置に追従させる
        if (this._activeInput && this._activeInput.seg) {
            const seg = this._activeInput.seg;
            const blink = (Math.floor(Date.now() / 500) % 2) === 0;
            if (blink) {
                const anchor = this._getInputTextAnchor(seg);
                ctx.save();
                ctx.fillStyle = '#000';
                ctx.font = anchor.fontSize + 'px ' + (anchor.fontFamily || 'sans-serif');
                ctx.textBaseline = 'top';
                const tm = ctx.measureText(seg.text || '');
                const cx = anchor.x + (tm.width || 0);
                ctx.fillRect(cx, anchor.y, 2, anchor.fontSize);
                ctx.restore();
            }
        }
    };

    /**
     * 入力対象セグメント内の「テキスト描画開始位置」 と font 情報を計算
     * ネスト group 内の text shape も再帰探索
     */
    CanvasStage.prototype._getInputTextAnchor = function (seg) {
        // INPUT/KINPUT の X,Y 指定があればカーソル位置をセグメント相対で上書き (BTRON仕様 09-04-07)
        if (this._activeInput && this._activeInput.seg === seg && this._activeInput.x != null) {
            return {
                x: seg.x + this._activeInput.x,
                y: seg.y + (this._activeInput.y != null ? this._activeInput.y : 0),
                fontSize: seg.tsize || 14,
                fontFamily: 'sans-serif'
            };
        }
        function findTextShape(shapes, offX, offY) {
            if (!shapes) return null;
            for (let i = 0; i < shapes.length; i++) {
                const s = shapes[i];
                if (s.kind === 'text' && s !== seg.labelShape) {
                    return {
                        x: offX + (s.left || 0) + 2,
                        y: offY + (s.top || 0) + 2,
                        fontSize: s.fontSize || (seg.tsize || 14),
                        fontFamily: s.fontFamily || 'sans-serif'
                    };
                }
                if (s.kind === 'group' && s.children) {
                    const r = findTextShape(s.children, offX + (s.left || 0), offY + (s.top || 0));
                    if (r) return r;
                }
            }
            return null;
        }
        const r = findTextShape(seg.shapes, seg.x, seg.y);
        if (r) return r;
        return { x: seg.x + 4, y: seg.y + 4, fontSize: seg.tsize || 14, fontFamily: 'sans-serif' };
    };

    /**
     * SCENE 効果 (WIPE 系・SCRL 系・MOSAIC 等) の簡易アニメーション
     * step: ステップ値 (大きいほど遅い)、 onDone: 完了コールバック
     */
    CanvasStage.prototype.runSceneTransition = function (segs, effect, step, onDone, opts) {
        if (!effect || !segs || segs.length === 0) {
            if (onDone) onDone();
            return;
        }
        const self = this;
        // hide: DISAPPEAR 用の逆方向遷移 (表示状態から効果をかけて最終的に非表示)
        const hide = !!(opts && opts.hide);
        const totalFrames = Math.max(1, Math.min(60, step || 10));
        let frame = 0;
        const rect = this.canvas.getBoundingClientRect();
        const w = rect.width, h = rect.height;

        function tick() {
            if (frame > totalFrames) {
                segs.forEach(function (s) { s.visible = !hide; });
                self.render();
                if (onDone) onDone();
                return;
            }
            // hide 時は被覆率を反転 (徐々に隠す)
            const ratio = hide ? 1 - (frame / totalFrames) : (frame / totalFrames);
            self.render();
            const ctx = self.ctx;
            ctx.save();
            ctx.fillStyle = '#ffffff';
            // 効果別マスク
            switch (effect) {
                case 'WIPE_D': ctx.fillRect(0, h * ratio, w, h - h * ratio); break;
                case 'WIPE_U': ctx.fillRect(0, 0, w, h - h * ratio); break;
                case 'WIPE_R': ctx.fillRect(w * ratio, 0, w - w * ratio, h); break;
                case 'WIPE_L': ctx.fillRect(0, 0, w - w * ratio, h); break;
                case 'SCRL_D': ctx.fillRect(0, h * ratio, w, h - h * ratio); break;
                case 'SCRL_U': ctx.fillRect(0, 0, w, h - h * ratio); break;
                case 'SCRL_R': ctx.fillRect(w * ratio, 0, w - w * ratio, h); break;
                case 'SCRL_L': ctx.fillRect(0, 0, w - w * ratio, h); break;
                case 'WIPE_V': {
                    const hh = h * (1 - ratio) / 2;
                    ctx.fillRect(0, 0, w, hh); ctx.fillRect(0, h - hh, w, hh); break;
                }
                case 'WIPE_H': {
                    const ww = w * (1 - ratio) / 2;
                    ctx.fillRect(0, 0, ww, h); ctx.fillRect(w - ww, 0, ww, h); break;
                }
                case 'WIPE_C': {
                    const ww = w * (1 - ratio) / 2;
                    const hh = h * (1 - ratio) / 2;
                    ctx.fillRect(0, 0, w, hh); ctx.fillRect(0, h - hh, w, hh);
                    ctx.fillRect(0, 0, ww, h); ctx.fillRect(w - ww, 0, ww, h); break;
                }
                case 'STRP_H': {
                    const stripes = 8;
                    for (let i = 0; i < stripes; i++) {
                        const sy = (h / stripes) * i;
                        ctx.fillRect(0, sy + (h / stripes) * ratio, w, (h / stripes) * (1 - ratio));
                    }
                    break;
                }
                case 'STRP_V': {
                    const stripes = 8;
                    for (let i = 0; i < stripes; i++) {
                        const sx = (w / stripes) * i;
                        ctx.fillRect(sx + (w / stripes) * ratio, 0, (w / stripes) * (1 - ratio), h);
                    }
                    break;
                }
                case 'MOSAIC': {
                    const cols = 16, rows = 12;
                    const cw = w / cols, ch = h / rows;
                    if (!self._mosaicOrder) {
                        self._mosaicOrder = [];
                        for (let i = 0; i < cols * rows; i++) self._mosaicOrder.push(i);
                        for (let i = self._mosaicOrder.length - 1; i > 0; i--) {
                            const r = Math.floor(Math.random() * (i + 1));
                            const tmp = self._mosaicOrder[i]; self._mosaicOrder[i] = self._mosaicOrder[r]; self._mosaicOrder[r] = tmp;
                        }
                    }
                    const visibleCount = Math.floor(self._mosaicOrder.length * ratio);
                    for (let i = visibleCount; i < self._mosaicOrder.length; i++) {
                        const idx = self._mosaicOrder[i];
                        const cx = (idx % cols) * cw;
                        const cy = Math.floor(idx / cols) * ch;
                        ctx.fillRect(cx, cy, cw, ch);
                    }
                    break;
                }
            }
            ctx.restore();
            frame++;
            requestAnimationFrame(tick);
        }
        // 開始時に対象を可視化
        segs.forEach(function (s) { s.visible = true; });
        requestAnimationFrame(tick);
    };

    CanvasStage.prototype._drawTextOverride = function (seg) {
        const ctx = this.ctx;
        ctx.save();
        const fs = seg.tsize || 14;
        ctx.font = fs + 'px sans-serif';
        ctx.textBaseline = 'top';
        const tx = seg.x + 4, ty = seg.y + 4;
        const text = seg.text || '';
        // .TBCOL: 明示設定された背景色でセグメント領域を塗る (初期値のままは塗らない)
        if (seg._tbcolSet && typeof seg.tbcol === 'number' && seg.tbcol >= 0) {
            ctx.fillStyle = this._colorRGBA(seg.tbcol, '#ffffff');
            ctx.fillRect(seg.x, seg.y, seg.w || 0, seg.h || 0);
        }
        // .TFCOL が明示設定されていればそれを、 未設定 (既定 -1) なら図形由来の初期文字色を使う
        ctx.fillStyle = (typeof seg.tfcol === 'number' && seg.tfcol >= 0)
            ? this._colorRGBA(seg.tfcol, '#000000')
            : (seg._initTextColor || '#000000');
        // セグメント矩形でクリップし、 セグメント幅で折り返して描画する
        ctx.beginPath();
        ctx.rect(seg.x, seg.y, seg.w || 0, seg.h || 0);
        ctx.clip();
        // .TLGAP (行間隔) を行送りに反映して複数行を描画
        const lineGap = (seg.tlgap > 0) ? seg.tlgap : Math.round(fs * 0.5);
        const lineH = fs + lineGap;
        const rawOvLines = text.split('\n');
        const lines = [];
        for (let li = 0; li < rawOvLines.length; li++) {
            const wrapped = this._wrapLine(ctx, rawOvLines[li], (seg.w || 0) - 8);
            for (let wj = 0; wj < wrapped.length; wj++) lines.push(wrapped[wj]);
        }
        // .TCGAP (文字間隔) 指定時は 1 文字ずつ字送りして描画
        const cgap = (seg.tcgap > 0) ? seg.tcgap : 0;
        let maxW = 0;
        for (let li = 0; li < lines.length; li++) {
            const line = lines[li];
            const ly = ty + li * lineH;
            let w;
            if (cgap > 0) {
                let cx = tx;
                for (const ch of line) {
                    ctx.fillText(ch, cx, ly);
                    cx += ctx.measureText(ch).width + cgap;
                }
                w = cx - tx;
            } else {
                ctx.fillText(line, tx, ly);
                w = ctx.measureText(line).width;
            }
            if (w > maxW) maxW = w;
            // .TSTYL bit0 = 下線
            if ((seg.tstyl & 1) && line) {
                ctx.fillRect(tx, ly + fs + 1, w, 1);
            }
        }
        // .TSTYL bit1 = 網掛け (テキスト領域に半透明グレーを重ねる近似。 比例ピッチ/階調/縦書きは未対応)
        if (seg.tstyl & 2) {
            ctx.fillStyle = 'rgba(128,128,128,0.35)';
            ctx.fillRect(tx, ty, maxW, lines.length * lineH);
        }
        ctx.restore();
    };

    CanvasStage.prototype._colorRGBA = function (num, defStr) {
        if (typeof num === 'string') return num;
        if (typeof num !== 'number' || num < 0) return defStr;
        const r = (num >> 16) & 0xff;
        const g = (num >> 8) & 0xff;
        const b = num & 0xff;
        return 'rgb(' + r + ',' + g + ',' + b + ')';
    };

    CanvasStage.prototype._drawShape = function (shape, offX, offY) {
        if (shape._hidden) return;
        const ctx = this.ctx;
        switch (shape.kind) {
            case 'rect': return this._drawRect(shape, offX, offY);
            case 'ellipse': return this._drawEllipse(shape, offX, offY);
            case 'line': return this._drawLine(shape, offX, offY);
            case 'polygon': return this._drawPolygon(shape, offX, offY, true);
            case 'polyline': return this._drawPolygon(shape, offX, offY, false);
            case 'text': return this._drawText(shape, offX, offY);
            case 'image': return this._drawImage(shape, offX, offY);
            case 'link': return this._drawLink(shape, offX, offY);
            case 'group': return this._drawGroup(shape, offX, offY);
        }
    };

    CanvasStage.prototype._drawGroup = function (s, offX, offY) {
        if (!s.children || s.children.length === 0) return;
        // group.left/top は相対座標 (figure-tad-reader が translateShape で相対化済み)
        // children も group 内相対座標
        const newOffX = offX + (s.left || 0);
        const newOffY = offY + (s.top || 0);
        for (let i = 0; i < s.children.length; i++) {
            this._drawShape(s.children[i], newOffX, newOffY);
        }
    };

    // 構築済みパスに塗りを適用する。 パターン (f_pat) があればテクスチャ (CanvasPattern)、
    // 無ければ単色。 basic-figure-editor の drawShape と同じく pattern-utils.js の createFillPattern を使う。
    // アニメーションで毎フレーム再描画されるため、 生成した塗りスタイルはパターン定義 (_patternMap の
    // オブジェクト) にキャッシュし、 同じ f_pat を使う図形・フレーム間で再利用する (createPattern の重複生成を回避)
    CanvasStage.prototype._applyFill = function (s) {
        const ctx = this.ctx;
        if (s.fillPattern && typeof global.createFillPattern === 'function') {
            if (s.fillPattern._fillStyle === undefined) {
                s.fillPattern._fillStyle = global.createFillPattern(ctx, s.fillPattern.id, s.fillColor || s.fillPattern.fg, { [s.fillPattern.id]: s.fillPattern }) || null;
            }
            if (s.fillPattern._fillStyle) { ctx.fillStyle = s.fillPattern._fillStyle; ctx.fill(); return; }
        }
        if (s.fillColor && s.fillColor !== 'transparent') {
            ctx.fillStyle = s.fillColor;
            ctx.fill();
        }
    };

    CanvasStage.prototype._drawRect = function (s, offX, offY) {
        const ctx = this.ctx;
        const x = offX + s.left, y = offY + s.top;
        const w = s.right - s.left, h = s.bottom - s.top;
        const r = Math.max(0, s.cornerRadius || 0);
        ctx.beginPath();
        if (r > 0) {
            const rr = Math.min(r, w / 2, h / 2);
            ctx.moveTo(x + rr, y);
            ctx.lineTo(x + w - rr, y);
            ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
            ctx.lineTo(x + w, y + h - rr);
            ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
            ctx.lineTo(x + rr, y + h);
            ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
            ctx.lineTo(x, y + rr);
            ctx.quadraticCurveTo(x, y, x + rr, y);
        } else {
            ctx.rect(x, y, w, h);
        }
        this._applyFill(s);
        if (s.strokeColor && s.strokeColor !== 'transparent' && (s.lineWidth || 0) > 0) {
            ctx.strokeStyle = s.strokeColor;
            ctx.lineWidth = s.lineWidth;
            ctx.stroke();
        }
    };

    CanvasStage.prototype._drawEllipse = function (s, offX, offY) {
        const ctx = this.ctx;
        const x = offX + s.left, y = offY + s.top;
        const w = s.right - s.left, h = s.bottom - s.top;
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        this._applyFill(s);
        if (s.strokeColor && s.strokeColor !== 'transparent' && (s.lineWidth || 0) > 0) {
            ctx.strokeStyle = s.strokeColor;
            ctx.lineWidth = s.lineWidth;
            ctx.stroke();
        }
    };

    CanvasStage.prototype._drawLine = function (s, offX, offY) {
        const ctx = this.ctx;
        ctx.beginPath();
        ctx.moveTo(offX + s.x1, offY + s.y1);
        ctx.lineTo(offX + s.x2, offY + s.y2);
        if (s.strokeColor && s.strokeColor !== 'transparent') {
            ctx.strokeStyle = s.strokeColor;
            ctx.lineWidth = s.lineWidth || 1;
            ctx.stroke();
        }
    };

    CanvasStage.prototype._drawPolygon = function (s, offX, offY, fill) {
        const ctx = this.ctx;
        if (!s.points || s.points.length === 0) return;
        ctx.beginPath();
        ctx.moveTo(offX + s.points[0][0], offY + s.points[0][1]);
        for (let i = 1; i < s.points.length; i++) {
            ctx.lineTo(offX + s.points[i][0], offY + s.points[i][1]);
        }
        if (fill) {
            ctx.closePath();
            this._applyFill(s);
        }
        if (s.strokeColor && s.strokeColor !== 'transparent') {
            ctx.strokeStyle = s.strokeColor;
            ctx.lineWidth = s.lineWidth || 1;
            ctx.stroke();
        }
    };

    CanvasStage.prototype._drawText = function (s, offX, offY) {
        const ctx = this.ctx;
        const x = offX + s.left;
        const y = offY + s.top;
        const w = s.right - s.left;
        const h = s.bottom - s.top;
        // 背景: bpat 由来のテクスチャ (fillPattern) または単色 (fillColor)
        if (s.fillPattern || (s.fillColor && s.fillColor !== 'transparent')) {
            ctx.beginPath();
            ctx.rect(x, y, w, h);
            this._applyFill(s);
        }
        ctx.save();
        // セグメントに .TFCOL 指定があれば図形テキストの文字色をそれで上書き (色表示スウォッチ等)
        ctx.fillStyle = (this._curSegTfcol != null)
            ? this._colorRGBA(this._curSegTfcol, s.textColor || '#000000')
            : (s.textColor || '#000000');
        const fontSize = s.fontSize || 14;
        ctx.font = fontSize + 'px ' + (s.fontFamily || 'sans-serif');
        ctx.textBaseline = 'top';
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.clip();
        // runs (font の wRatio/hRatio を保持した区間) があれば横倍率を反映して描画する。
        // 半角圧縮 (wRatio=1/2) のスペース等が全角幅化して折り返す不具合を防ぐ。
        if (s.runs && s.runs.length) {
            this._drawTextRuns(ctx, s.runs, x + 2, y + 2, w - 4, fontSize);
            ctx.restore();
            return;
        }
        // 文字枠の幅で折り返して描画する
        const rawLines = (s.text || '').split('\n');
        const lines = [];
        for (let i = 0; i < rawLines.length; i++) {
            const wrapped = this._wrapLine(ctx, rawLines[i], w - 4);
            for (let j = 0; j < wrapped.length; j++) lines.push(wrapped[j]);
        }
        for (let i = 0; i < lines.length; i++) {
            ctx.fillText(lines[i], x + 2, y + 2 + i * (fontSize + 2));
        }
        ctx.restore();
    };

    // run 配列 (各文字に xScale/yScale を持つ) を、 横倍率を字送り・横スケールへ反映して描画する。
    // maxWidth を超える、 または '\n' で改行。 fillStyle/font/clip は呼び出し側設定を流用。
    CanvasStage.prototype._drawTextRuns = function (ctx, runs, ox, oy, maxWidth, fontSize) {
        // 文字 cell 列を構築
        const cells = [];
        for (let i = 0; i < runs.length; i++) {
            const run = runs[i];
            const xs = (run.xScale > 0) ? run.xScale : 1;
            const ys = (run.yScale > 0) ? run.yScale : 1;
            for (const ch of (run.text || '')) {
                if (ch === '\n') { cells.push({ br: true }); continue; }
                cells.push({ ch: ch, xScale: xs, yScale: ys, adv: ctx.measureText(ch).width * xs });
            }
        }
        // 折り返してライン分割
        const lines = [[]];
        let lineW = 0;
        for (let i = 0; i < cells.length; i++) {
            const cell = cells[i];
            if (cell.br) { lines.push([]); lineW = 0; continue; }
            if (lineW > 0 && lineW + cell.adv > maxWidth) { lines.push([]); lineW = 0; }
            lines[lines.length - 1].push(cell);
            lineW += cell.adv;
        }
        // 描画
        const lineH = fontSize + 2;
        for (let li = 0; li < lines.length; li++) {
            const line = lines[li];
            let cx = ox;
            const ly = oy + li * lineH;
            for (let ci = 0; ci < line.length; ci++) {
                const cell = line[ci];
                ctx.save();
                ctx.translate(cx, ly);
                ctx.scale(cell.xScale, cell.yScale);
                ctx.fillText(cell.ch, 0, 0);
                ctx.restore();
                cx += cell.adv;
            }
        }
    };

    // 1 行のテキストを最大幅に収まるよう文字単位で折り返す
    CanvasStage.prototype._wrapLine = function (ctx, text, maxWidth) {
        if (!text || maxWidth <= 4) return [text || ''];
        const out = [];
        let cur = '';
        for (const ch of text) {
            if (cur && ctx.measureText(cur + ch).width > maxWidth) {
                out.push(cur);
                cur = ch;
            } else {
                cur += ch;
            }
        }
        out.push(cur);
        return out;
    };

    CanvasStage.prototype._resolveImgSrc = function (src) {
        if (!src) return '';
        if (/^(https?|file|data|blob):/i.test(src)) return src;
        if (this.dataFolder) {
            const base = this.dataFolder.replace(/\\/g, '/').replace(/\/+$/, '');
            const encodedBase = base.split('/').map(function (seg) {
                return seg.indexOf(':') >= 0 ? seg : encodeURIComponent(seg);
            }).join('/');
            return 'file:///' + encodedBase + '/' + encodeURIComponent(src);
        }
        return src;
    };

    CanvasStage.prototype._drawImage = function (s, offX, offY) {
        const ctx = this.ctx;
        const x = offX + s.left, y = offY + s.top;
        const w = s.right - s.left, h = s.bottom - s.top;
        if (s.src && !s._img) {
            s._img = new Image();
            const self = this;
            s._img.onload = function () {
                console.log('[MS-Stage] image loaded:', s.src, 'natural=', s._img.naturalWidth, 'x', s._img.naturalHeight, 'displayed=', (s.right - s.left), 'x', (s.bottom - s.top));
                self.render();
            };
            s._img.onerror = function () {
                console.log('[MS-Stage] image load failed:', s._img.src);
                s._imgFailed = true; self.render();
            };
            s._img.src = s._resolvedSrc || this._resolveImgSrc(s.src);
        }
        if (s._img && s._img.complete && s._img.naturalWidth > 0) {
            ctx.drawImage(s._img, x, y, w, h);
            return;
        }
        ctx.save();
        ctx.fillStyle = '#f4f4f4';
        ctx.strokeStyle = '#888888';
        ctx.lineWidth = 1;
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
        ctx.restore();
    };

    CanvasStage.prototype._drawLink = function (s, offX, offY) {
        const ctx = this.ctx;
        const x = offX + s.left, y = offY + s.top;
        const w = s.right - s.left, h = s.bottom - s.top;
        ctx.save();
        ctx.strokeStyle = '#0080ff';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 2]);
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
        ctx.fillStyle = '#0080ff';
        ctx.font = '12px sans-serif';
        ctx.textBaseline = 'top';
        ctx.fillText(s.label || s.linkId || 'link', x + 2, y + 2);
        ctx.restore();
    };

    global.CanvasStage = CanvasStage;
})(typeof window !== 'undefined' ? window : globalThis);
