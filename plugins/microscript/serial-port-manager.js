/**
 * マイクロスクリプト シリアル通信マネージャ (Web Serial API)
 *
 * 仕様: 超漢字マニュアル 09-04-14 / microscript-plugin-spec.md 14.5.7
 * BTRON の RS 系命令 (RSINIT/RSPUTC/RSPUT/RSPUTN/RSWAIT/RSGETN/RSGET/RSGETC/RSCNTL) を
 * navigator.serial で実現する。 ms-runtime から呼ばれる。
 *
 * ポート選択: Web Serial の requestPort() はユーザージェスチャ必須のため、 「シリアルポート割り当て」
 * メニュー → iframe 内オーバーレイのボタン(実ジェスチャ) で requestPort()。 select-serial-port は
 * Electron main が IPC でこの renderer に委譲し、 オーバーレイで一覧→選択する。
 * スクリプトの RSINIT 〈番号〉 は getPorts()[番号] を開く(ジェスチャ不要)。
 */
(function (global) {
    'use strict';

    let ipcRenderer = null;
    try { ipcRenderer = require('electron').ipcRenderer; } catch (e) { /* 非Electron環境 */ }

    const BAUD_LIST = [75, 150, 300, 600, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200];
    const RX_BUF_MAX = 512; // 入力バッファ 512 バイト (仕様)

    // モード CFPSD(10進5桁) → Web Serial SerialOptions。 0/未指定 = 00018 (8N1, フロー無)
    function parseMode(modeVal) {
        let m = (modeVal == null || (modeVal | 0) === 0) ? 18 : (modeVal | 0);
        const D = m % 10; m = Math.floor(m / 10);
        const S = m % 10; m = Math.floor(m / 10);
        const P = m % 10; m = Math.floor(m / 10);
        const F = m % 10; m = Math.floor(m / 10);
        const C = m % 10;
        let dataBits = (D === 7) ? 7 : 8;
        if (D === 5 || D === 6) console.warn('[Serial] データ長 ' + D + 'bit は Web Serial 非対応 → 8bit で近似');
        const stopBits = (S === 2) ? 2 : 1;
        const parity = (P === 1) ? 'odd' : (P === 2) ? 'even' : 'none';
        let flowControl = (F === 1 || F === 3) ? 'hardware' : 'none';
        if (F === 2 || F === 4 || F === 5) console.warn('[Serial] フロー制御 ' + F + ' は Web Serial 非対応 → none で近似');
        return { dataBits: dataBits, stopBits: stopBits, parity: parity, flowControl: flowControl, csControl: C };
    }

    function SerialPortManager() {
        this.entries = {};        // port番号 → { port, writer, reading, buf: number[] }
        this._overlay = null;
        // ポート選択は subframe→main の ipcRenderer.invoke で行う (main→subframe push は届かないため):
        //   requestPort() → main の select-serial-port が pending を保持 → invoke('ms-serial-pending') で取得
        //   → 一覧表示・選択 → invoke('ms-serial-choose', portId) で確定
    }

    SerialPortManager.prototype.isAvailable = function () {
        return !!(global.navigator && global.navigator.serial);
    };

    // ===== RSINIT =====
    SerialPortManager.prototype.init = async function (portNum, modeVal, baudVal) {
        if (!this.isAvailable()) { console.warn('[Serial] Web Serial API 非対応環境'); return 16; }
        portNum = portNum | 0;
        let ports;
        try { ports = await navigator.serial.getPorts(); } catch (e) { return 16; }
        const port = ports[portNum];
        if (!port) {
            console.warn('[Serial] ポート番号 ' + portNum + ' は未割当。 [マイクロスクリプト]→[シリアルポート割り当て] で許可してください');
            return 16;
        }
        await this._closeEntry(portNum);
        const mode = parseMode(modeVal);
        let baud = (baudVal && BAUD_LIST.indexOf(baudVal | 0) >= 0) ? (baudVal | 0) : 9600;
        try {
            await port.open({
                baudRate: baud, dataBits: mode.dataBits, stopBits: mode.stopBits,
                parity: mode.parity, flowControl: mode.flowControl, bufferSize: 4096
            });
        } catch (e) { console.warn('[Serial] ポート open 失敗:', e.message); return 16; }
        const entry = { port: port, writer: null, reading: true, buf: [] };
        try { entry.writer = port.writable.getWriter(); } catch (e) { /* writable 無し */ }
        this.entries[portNum] = entry;
        this._startReadLoop(portNum, entry);
        console.log('[Serial] ポート' + portNum + ' 初期化: ' + baud + 'bps ' + mode.dataBits + JSON.stringify(mode.parity).charAt(1).toUpperCase() + mode.stopBits);
        return 0;
    };

    SerialPortManager.prototype._startReadLoop = async function (portNum, entry) {
        try {
            while (entry.reading && entry.port.readable) {
                const reader = entry.port.readable.getReader();
                entry.reader = reader;
                try {
                    while (entry.reading) {
                        const r = await reader.read();
                        if (r.done) break;
                        const v = r.value;
                        if (v) {
                            for (let i = 0; i < v.length; i++) {
                                entry.buf.push(v[i]);
                                if (entry.buf.length > RX_BUF_MAX) entry.buf.shift();
                            }
                        }
                    }
                } catch (e) { break; } finally { try { reader.releaseLock(); } catch (_) {} }
            }
        } catch (e) { /* readable 喪失 */ }
    };

    // ===== RSPUTC/RSPUT (clearInput=true) / RSPUTN (clearInput=false) =====
    SerialPortManager.prototype.send = async function (portNum, bytes, clearInput) {
        const e = this.entries[portNum | 0];
        if (!e || !e.writer) return 16;
        if (clearInput) e.buf.length = 0;
        try { await e.writer.write(new Uint8Array(bytes)); } catch (err) { console.warn('[Serial] 送信失敗:', err.message); return 16; }
        return 0;
    };

    // ===== RSWAIT 用: 入力バッファに seq(バイト列) が含まれるか =====
    SerialPortManager.prototype.bufferContains = function (portNum, seq) {
        const e = this.entries[portNum | 0];
        if (!e || !seq || !seq.length) return false;
        const b = e.buf;
        for (let i = 0; i + seq.length <= b.length; i++) {
            let ok = true;
            for (let j = 0; j < seq.length; j++) { if (b[i + j] !== seq[j]) { ok = false; break; } }
            if (ok) return true;
        }
        return false;
    };

    // ===== RSGETN/RSGET (clear=false) / RSGETC (clear=true) =====
    // 戻り: { cnt, data:[] }。 仕様の「512超で最新512のみ」は環状バッファで近似済み(cnt=保持数)
    SerialPortManager.prototype.receive = function (portNum, clear) {
        const e = this.entries[portNum | 0];
        if (!e) return { cnt: 0, data: [] };
        const data = e.buf.slice(0);
        const cnt = data.length;
        if (clear) e.buf.length = 0;
        return { cnt: cnt, data: data };
    };

    // ===== RSCNTL func0=回線状態 / func1-19=ブレーク =====
    SerialPortManager.prototype.control = async function (portNum, func) {
        const e = this.entries[portNum | 0];
        if (!e) return { err: 16, status: 0 };
        if (func === 0) {
            try {
                const s = await e.port.getSignals();
                let st = 0;
                if (s.ringIndicator) st |= 0x1;       // CI  bit0
                if (s.clearToSend) st |= 0x2;         // CS  bit1
                if (s.dataCarrierDetect) st |= 0x4;   // CD  bit2
                if (s.dataSetReady) st |= 0x8;        // DSR bit3
                return { err: 0, status: st };
            } catch (err) { return { err: 16, status: 0 }; }
        } else if (func >= 1 && func <= 19) {
            try {
                await e.port.setSignals({ break: true });
                await new Promise(function (r) { setTimeout(r, func * 100); });
                await e.port.setSignals({ break: false });
                return { err: 0, status: 0 };
            } catch (err) { return { err: 16, status: 0 }; }
        }
        return { err: 16, status: 0 };
    };

    SerialPortManager.prototype._closeEntry = async function (portNum) {
        const e = this.entries[portNum | 0];
        if (!e) return;
        e.reading = false;
        try { if (e.reader) await e.reader.cancel(); } catch (_) {}
        try { if (e.writer) { e.writer.releaseLock(); } } catch (_) {}
        try { await e.port.close(); } catch (_) {}
        delete this.entries[portNum | 0];
    };

    SerialPortManager.prototype.closeAll = async function () {
        const keys = Object.keys(this.entries);
        for (let i = 0; i < keys.length; i++) await this._closeEntry(keys[i]);
    };

    // ===== ポート割り当てオーバーレイ (iframe 内 DOM = 実ジェスチャ源) =====
    // ポート割り当てUIを表示。 Promise を返し、 オーバーレイが閉じられた(割当 or スキップ)時に解決する。
    // opts.startup=true で「起動時にこの台本はシリアルを使う」旨の案内文に切替。
    SerialPortManager.prototype.showGrantUI = function (opts) {
        const self = this;
        if (!this.isAvailable()) {
            this._toast('この環境は Web Serial API に対応していません。');
            return Promise.resolve();
        }
        return new Promise(function (resolve) { self._buildOverlay(opts || {}, resolve); });
    };

    SerialPortManager.prototype._buildOverlay = function (opts, onClose) {
        const self = this;
        this._destroyOverlay();
        this._overlayResolve = onClose || null;
        const ov = document.createElement('div');
        ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;font-family:sans-serif;';
        const box = document.createElement('div');
        box.style.cssText = 'background:#dedede;border:1px solid #808080;min-width:360px;max-width:80%;max-height:80%;overflow:auto;padding:16px;box-shadow:0 2px 12px rgba(0,0,0,0.4);';
        const introMsg = (opts && opts.startup)
            ? 'この台本はシリアルポートを使用します。 使用するポートを割り当ててください。 (割り当てない場合は「閉じる」で続行)'
            : 'ボタンを押して接続するシリアルポートを選択・許可してください。';
        box.innerHTML = '<div style="font-weight:bold;margin-bottom:10px;">シリアルポート割り当て</div>'
            + '<div id="ms-serial-msg" style="font-size:13px;margin-bottom:12px;">' + introMsg + '</div>';
        const selBtn = document.createElement('button');
        selBtn.textContent = 'ポートを選択して許可';
        selBtn.style.cssText = 'padding:6px 14px;margin-right:8px;background:#c0c0c0;border:1px solid #808080;cursor:pointer;';
        selBtn.onclick = function () {
            // ユーザージェスチャ内で requestPort。 promise は main が choose を返すまで解決しない。
            self._setMsg('ポートを問い合わせ中...');
            const reqPromise = navigator.serial.requestPort().catch(function (err) {
                self._setMsg('ポートが選択されませんでした (' + (err && err.message ? err.message : 'cancel') + ')');
                return null;
            });
            // select-serial-port 発火を待って一覧を取得・表示 (main 側 pending を invoke でポーリング)
            self._waitPendingList().then(function (portList) {
                if (portList) self._renderPortList(portList);
            });
            reqPromise.then(function (port) {
                if (port) {
                    self._refreshGrantedList();
                    self._setMsg('割り当てが完了しました。 RSINIT で下記の「番号」を指定してください。');
                }
            });
        };
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '閉じる';
        closeBtn.style.cssText = 'padding:6px 14px;background:#c0c0c0;border:1px solid #808080;cursor:pointer;';
        closeBtn.onclick = function () { self._destroyOverlay(); };
        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'margin-top:12px;';
        btnRow.appendChild(selBtn); btnRow.appendChild(closeBtn);
        const listDiv = document.createElement('div');
        listDiv.id = 'ms-serial-granted';
        listDiv.style.cssText = 'margin-top:12px;font-size:12px;';
        box.appendChild(btnRow);
        box.appendChild(listDiv);
        ov.appendChild(box);
        document.body.appendChild(ov);
        this._overlay = ov;
        this._refreshGrantedList();
    };

    // select-serial-port 発火を待ち、 main が保持する pending ポート一覧を取得 (subframe→main invoke)
    SerialPortManager.prototype._waitPendingList = async function () {
        if (!ipcRenderer) return null;
        for (let i = 0; i < 100; i++) { // 最大 ~5秒ポーリング
            let list = null;
            try { list = await ipcRenderer.invoke('ms-serial-pending'); } catch (_) {}
            if (list) return list;
            await new Promise(function (r) { setTimeout(r, 50); });
        }
        return null;
    };

    // ポート一覧をオーバーレイに表示し、 選択を main へ返す (invoke('ms-serial-choose'))
    SerialPortManager.prototype._renderPortList = function (portList) {
        if (!this._overlay) return;
        const self = this;
        const listDiv = this._overlay.querySelector('#ms-serial-granted');
        if (!listDiv) return;
        this._setMsg('接続するポートを選んでください:');
        listDiv.innerHTML = '';
        if (!portList.length) {
            listDiv.textContent = '利用可能なシリアルポートがありません。';
            if (ipcRenderer) ipcRenderer.invoke('ms-serial-choose', '');
            return;
        }
        portList.forEach(function (p) {
            const item = document.createElement('div');
            item.textContent = (p.displayName || p.portName || p.portId) + (p.vendorId ? ('  [' + p.vendorId + ':' + p.productId + ']') : '');
            item.style.cssText = 'padding:6px 8px;margin:3px 0;background:#fff;border:1px solid #808080;cursor:pointer;';
            item.onclick = function () {
                if (ipcRenderer) ipcRenderer.invoke('ms-serial-choose', p.portId);
                self._setMsg('許可処理中...');
                listDiv.innerHTML = '';
            };
            listDiv.appendChild(item);
        });
    };

    SerialPortManager.prototype._refreshGrantedList = async function () {
        if (!this._overlay) return;
        const listDiv = this._overlay.querySelector('#ms-serial-granted');
        if (!listDiv) return;
        let ports = [];
        try { ports = await navigator.serial.getPorts(); } catch (_) {}
        if (!ports.length) { listDiv.innerHTML = '<i>許可済みポートなし</i>'; return; }
        let html = '<div style="font-weight:bold;margin-bottom:4px;">許可済みポート (RSINIT の番号):</div>';
        ports.forEach(function (p, i) {
            let info = '';
            try { const inf = p.getInfo(); if (inf && inf.usbVendorId != null) info = '  USB ' + inf.usbVendorId + ':' + inf.usbProductId; } catch (_) {}
            html += '<div>番号 ' + i + info + '</div>';
        });
        listDiv.innerHTML = html;
    };

    SerialPortManager.prototype._setMsg = function (t) {
        if (!this._overlay) return;
        const m = this._overlay.querySelector('#ms-serial-msg');
        if (m) m.textContent = t;
    };

    SerialPortManager.prototype._destroyOverlay = function () {
        if (this._overlay && this._overlay.parentNode) this._overlay.parentNode.removeChild(this._overlay);
        this._overlay = null;
        const resolve = this._overlayResolve;
        this._overlayResolve = null;
        if (resolve) resolve();
    };

    SerialPortManager.prototype._toast = function (t) {
        try { alert(t); } catch (_) { console.warn('[Serial] ' + t); }
    };

    global.SerialPortManager = SerialPortManager;
})(typeof window !== 'undefined' ? window : globalThis);
