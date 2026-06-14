/**
 * マイクロスクリプトプラグイン
 *
 * BTRON互換マイクロスクリプト実行環境。
 * 図形TAD(basic-figure-editor互換形式)を読み込み、 グループから役者セグメントを抽出、
 * 貼り込まれた SCRIPT: 仮身を MessageBus 経由で読み込んで台本として実行する。
 */
const logger = window.getLogger ? window.getLogger('MicroScript') : { debug: console.log, info: console.log, warn: console.warn, error: console.error };

class MicroScriptPlugin extends window.PluginBase {
    constructor() {
        super('MicroScript');
        this.runtime = null;
        this.stage = null;
        this.figure = null;
        this.scriptSource = '';
        this.scriptLoader = null;
        this.realIdBase = null;
        this.figureXml = null;
        this.init();
    }

    init() {
        this.initializeCommonComponents('[MS]');
        this.setupMessageBusHandlers();
        this.setupContextMenu();
        logger.debug('[MS] プラグイン準備完了');
    }

    setupMessageBusHandlers() {
        this.setupCommonMessageBusHandlers();

        // WMOVE 後にホストから作業領域左上のデスクトップ座標を受け取り $WDX/$WDY に反映する
        this.messageBus.on('window-geometry', (data) => {
            if (this.stage && data) {
                if (typeof data.wdx === 'number') this.stage.wdx = data.wdx;
                if (typeof data.wdy === 'number') this.stage.wdy = data.wdy;
            }
        });

        this.messageBus.on('init', async (data) => {
            logger.debug('[MS] init received');
            this.onInit(data);

            if (data.fileData && data.fileData.realId) {
                const realId = data.fileData.realId;
                this.realIdBase = realId.replace(/_\d+\.xtad$/, '');
            }

            // ウィンドウ背景色は実身の管理用セグメントJSON (実行機能付箋由来の backgroundColor) を優先し、
            // 無ければ仮身の背景色 (bgcol) を採用する
            this.windowBgColor = (data.fileData && data.fileData.windowConfig && data.fileData.windowConfig.backgroundColor)
                || (data.fileData && data.fileData.bgcol)
                || '#ffffff';

            this.messageBus.send('set-scrollbar-visible', { visible: false });

            try {
                const messageId = this.generateMessageId('get-data-folder');
                this.messageBus.send('get-data-folder', { messageId });
                const response = await this.messageBus.waitFor('data-folder-response', 3000,
                    (d) => d.messageId === messageId);
                if (response && response.dataFolder) {
                    this.dataFolder = response.dataFolder;
                    console.log('[MS] dataFolder:', this.dataFolder);
                }
            } catch (e) {
                console.log('[MS] dataFolder取得失敗:', e.message);
            }

            this.figureXml = data.fileData ? data.fileData.xmlData : null;
            await this.bootRuntime();
        });
    }

    getMenuDefinition() {
        const menus = [
            { label: 'マイクロスクリプト', submenu: [
                { label: '再起動', action: 'restart' },
                { label: '停止', action: 'stop' },
                { label: 'ソース表示', action: 'show-source' },
                { separator: true },
                { label: '閉じる', action: 'close' }
            ]}
        ];
        // スクリプトの MENU イベント手続きを [操作] メニューとして動的に追加 (最大8個)
        const items = (this.runtime && this.runtime.menuItems) || [];
        if (items.length > 0) {
            const submenu = [];
            for (let i = 0; i < items.length; i++) {
                let label = String(items[i].label || '');
                let shortcut = null;
                // メニュー文字列の先頭 @文字 は命令キー割当 (例 "@A実行" → ショートカット A)
                if (label.charAt(0) === '@' && label.length >= 2) {
                    shortcut = label.charAt(1).toUpperCase();
                    label = label.substring(2);
                }
                const def = { label: label || ('項目' + (i + 1)), action: 'ms-menu-' + i };
                if (shortcut) def.shortcut = 'Ctrl+' + shortcut;
                submenu.push(def);
            }
            menus.push({ label: '操作', submenu: submenu });
        }
        return menus;
    }

    executeMenuAction(action) {
        // スクリプト定義メニュー項目 (ms-menu-N) の起動
        if (typeof action === 'string' && action.indexOf('ms-menu-') === 0) {
            const idx = parseInt(action.substring('ms-menu-'.length), 10);
            if (this.runtime && this.runtime.invokeMenuItem) this.runtime.invokeMenuItem(idx);
            return;
        }
        switch (action) {
            case 'restart': this.restart(); break;
            case 'stop': this.stopRuntime(); break;
            case 'show-source': this.showSource(); break;
            case 'close': this.messageBus.send('close-window'); break;
        }
    }

    async bootRuntime() {
        const canvasEl = document.getElementById('stage');
        const messageEl = document.getElementById('message-area');
        if (!canvasEl) {
            console.log('[MS] canvas要素が見つからない');
            return;
        }

        this.stopRuntime();

        const self = this;
        this.stage = new window.CanvasStage(canvasEl, messageEl, {
            backgroundColor: this.windowBgColor,
            dataFolder: this.dataFolder,
            notifyHost: function (action, payload) {
                self.handleHostAction(action, payload);
            },
            loadRealObject: function (path) {
                const realId = self.resolveRealIdFromPath(path);
                return self.loadRealObjectData(realId);
            },
            saveRealObject: function (path, data) {
                const realId = self.resolveRealIdFromPath(path);
                return self.saveRealObjectData(realId, data);
            },
            listVirtualObjects: function (path) {
                return self.requestListVirtualObjects(path);
            },
            resolveImagePath: function (src) {
                return self.getImageFilePath(src);
            }
        });
        this.runtime = new window.MSRuntime.Runtime({ stage: this.stage });
        // $SV (仮身ごとの不揮発変数) の保存キー隔離に実身 ID を使う
        this.runtime.realId = this.realIdBase;
        this.scriptLoader = new window.ScriptLoader(this);

        console.log('[MS] bootRuntime start. figureXml length:', this.figureXml ? this.figureXml.length : 0);

        if (!this.figureXml) {
            this.showErrorDialog('図形データが空です。 基本図形編集で舞台と役者を作成してください。');
            return;
        }

        this.figure = window.FigureTadReader.parse(this.figureXml, { backgroundColor: this.windowBgColor });
        // 作業領域 (figView) を stage に渡し、 MOVE ではみ出した図形を作業領域でクリップ (白帯対策)
        if (this.stage) this.stage.figView = this.figure.figView;
        console.log('[MS] FigureTadReader: groups=', this.figure.groups.length, 'segments=', this.figure.segments.length, 'links=', this.figure.links.length);
        if (this.figure.error) {
            console.log('[MS] FigureTadReader error:', this.figure.error);
            this.showErrorDialog('[図形TADエラー] ' + this.figure.error);
            return;
        }
        if (this.figure.segments.length === 0 && this.figure.groups.length > 0) {
            for (let gi = 0; gi < this.figure.groups.length; gi++) {
                const g = this.figure.groups[gi];
                const texts = g.children.filter(function (c) { return c.kind === 'text'; }).map(function (c) { return JSON.stringify(c.text); });
                console.log('[MS] group[' + gi + '] text shapes:', texts.join(' / '));
            }
        }

        for (const shape of this.figure.shapes) {
            if (shape.kind === 'group') continue;
            if (shape.kind === 'link') continue;
            this.stage.addBackgroundShape(shape);
        }

        for (const segDef of this.figure.segments) {
            for (const child of segDef.group.children) {
                if (child.kind === 'image' && child.src && !child._resolvedSrc) {
                    try {
                        const filePath = await this.getImageFilePath(child.src);
                        if (filePath) {
                            child._resolvedSrc = filePath;
                            console.log('[MS] image resolved:', child.src, '->', filePath);
                        } else {
                            console.log('[MS] image path null:', child.src);
                        }
                    } catch (e) {
                        console.log('[MS] image path error:', child.src, e.message);
                    }
                }
            }
            // セグメント内の初期テキスト (ボックス等の数値入力欄の初期値) と初期文字色を抽出
            let initText = '';
            let initTextColor = null;
            for (const ch of segDef.group.children) {
                if (ch.kind === 'text' && ch !== segDef.labelShape && ch.text) {
                    initText = ch.text;
                    if (ch.textColor) initTextColor = ch.textColor;
                    break;
                }
            }
            const seg = new window.MSRuntime.Segment({
                name: segDef.name,
                x: segDef.baseX,
                y: segDef.baseY,
                w: segDef.width,
                h: segDef.height,
                shapes: segDef.group.children,
                labelShape: segDef.labelShape,
                text: initText,
                initTextColor: initTextColor,
                labelOffsetX: segDef.labelOffsetX,
                labelOffsetY: segDef.labelOffsetY
            });
            this.runtime.registerSegment(seg);
        }

        // 数値欄役者 (Nn) の初期値を $SV[n-1] に同期 (簡単な表の例等。 PROLOGUE が $SV を読む設計のため)。
        // 数値化できる初期値を持つ役者のみ対象。 localStorage 保存値があれば presetSV 内で永続値を優先
        for (const segDef of this.figure.segments) {
            const m = /^N(\d+)$/.exec(segDef.name);
            if (!m) continue;
            const seg = this.stage.segments.get(segDef.name);
            if (!seg) continue;
            const v = this.runtime.getSegState(seg, 'V');
            if (typeof v === 'number' && Number.isFinite(v) && v !== -2147483648) {
                this.runtime.presetSV(parseInt(m[1], 10) - 1, v);
            }
        }

        this.stage.render();

        if (this.figure.segments.length === 0) {
            this.showErrorDialog('役者セグメントが見つかりません。 グループに「@名前」 文字枠を含めてください。');
        }

        let scriptResult;
        try {
            scriptResult = await this.scriptLoader.loadScripts(this.figure.links);
        } catch (e) {
            this.showErrorDialog('[SCRIPT読み込みエラー] ' + e.message);
            return;
        }

        // FOPEN/FREAD/FWRITE で「リンク名」 (例: "入力") を指定された場合に実身IDへ解決するマップ
        // ScriptLoader が取得済みの name 情報を再利用する (二重 loadRealObjectData を回避)
        this.runtime._linkNameToRealId = scriptResult.nameMap || {};
        console.log('[MS] link name map:', this.runtime._linkNameToRealId);

        if (scriptResult.errors.length > 0) {
            // 複数の読み込みエラーは1つのダイアログに集約 (多重ポップアップ防止)
            const errMsg = scriptResult.errors
                .map(err => '[SCRIPT読み込みエラー] ' + err.linkRef + ': ' + err.error)
                .join('\n');
            this.showErrorDialog(errMsg);
        }
        if (scriptResult.notFound.length > 0) {
            for (const ref of scriptResult.notFound) {
                this.stage.message('[警告] 仮身が見つかりません: ' + ref + '\n');
            }
        }

        if (scriptResult.subFigures && scriptResult.subFigures.length > 0) {
            console.log('[MS] sub figures:', scriptResult.subFigures.length);
            for (const sub of scriptResult.subFigures) {
                try {
                    const subFigure = window.FigureTadReader.parse(sub.xtad, { backgroundColor: this.windowBgColor });
                    if (subFigure.error) {
                        console.log('[MS] sub figure parse error:', sub.name, subFigure.error);
                        continue;
                    }
                    console.log('[MS]   sub', sub.name, 'segments=', subFigure.segments.length);
                    for (const subSeg of subFigure.segments) {
                        for (const child of subSeg.group.children) {
                            if (child.kind === 'image' && child.src && !child._resolvedSrc) {
                                try {
                                    const filePath = await this.getImageFilePath(child.src);
                                    if (filePath) child._resolvedSrc = filePath;
                                } catch (e) {}
                            }
                        }
                        if (this.stage.segments.has(subSeg.name)) {
                            console.log('[MS]     duplicate seg name skipped:', subSeg.name);
                            continue;
                        }
                        const seg = new window.MSRuntime.Segment({
                            name: subSeg.name,
                            x: subSeg.baseX,
                            y: subSeg.baseY,
                            w: subSeg.width,
                            h: subSeg.height,
                            shapes: subSeg.group.children,
                            labelShape: subSeg.labelShape,
                            labelOffsetX: subSeg.labelOffsetX,
                            labelOffsetY: subSeg.labelOffsetY
                        });
                        this.runtime.registerSegment(seg);
                        console.log('[MS]     register sub seg:', subSeg.name, 'x=', subSeg.baseX, 'y=', subSeg.baseY, 'w=', subSeg.width, 'h=', subSeg.height);
                    }
                } catch (e) {
                    console.log('[MS] sub figure error:', sub.name, e.message);
                }
            }
        }

        if (scriptResult.sources.length === 0) {
            this.showErrorDialog('SCRIPT: で始まる文章実身(台本)が貼り込まれていません。 図形に SCRIPT:〜 仮身を貼り込んでください。');
            this.stage.message('検出された仮身リンク数: ' + (this.figure.links ? this.figure.links.length : 0) + '\n');
            if (this.figure.links) {
                for (const lnk of this.figure.links) {
                    this.stage.message('  linkRef=' + lnk.linkRef + ' linkId=' + lnk.linkId + '\n');
                }
            }
            return;
        }

        this.scriptSource = scriptResult.sources.join('\n');
        const scriptNames = scriptResult.names.join(', ');
        console.log('[MS] 台本: ' + scriptNames + ', source length=' + this.scriptSource.length);
        this.setStatus('台本読み込み: ' + scriptNames + ' (' + scriptResult.sources.length + '個)');

        let tokens;
        try {
            tokens = window.MSLexer.tokenize(this.scriptSource);
            console.log('[MS] tokens count:', tokens.length);
        } catch (e) {
            console.log('[MS] lexer error:', e.message);
            this.showErrorDialog('[字句エラー] ' + e.message);
            return;
        }

        let ast;
        try {
            ast = window.MSParser.parse(tokens);
            console.log('[MS] AST procedures:', ast.procedures.length, 'globals:', ast.globals.length, 'segmentDecls:', ast.segmentDecls.length);
            for (const p of ast.procedures) {
                // [MS] proc 一覧ログ抑制(起動時に手続き数ぶん出るため)
            }
        } catch (e) {
            console.log('[MS] parser error:', e.message);
            this.showErrorDialog('[構文エラー] ' + e.message);
            return;
        }

        try {
            this.runtime.loadProgram(ast);
            this.runtime.onFinish = () => {
                console.log('[MS] FINISH: closing window');
                this.messageBus.send('close-window');
            };
            console.log('[MS] loadProgram done. segments registered=', this.stage.segments.size);
            this.runtime.start();
            console.log('[MS] runtime.start() called');
            setTimeout(() => {
                if (!this.stage) return;
                this.stage.segments.forEach((seg) => {
                    // [MS] seg 一覧ログ抑制(起動時にセグメント数ぶん出るため)
                });
                console.log('[MS] canvas size:', this.stage.canvas.clientWidth, 'x', this.stage.canvas.clientHeight);
            }, 1000);
        } catch (e) {
            console.log('[MS] runtime start error:', e.message, e.stack);
            this.showErrorDialog('[起動エラー] ' + e.message);
        }
    }

    stopRuntime() {
        if (this.runtime) {
            // このスクリプトが setgnm したグローバル名を共有ストアから削除してから停止
            if (this.runtime._cleanupGnm) this.runtime._cleanupGnm();
            this.runtime.terminate();
            this.runtime = null;
        }
        if (this.stage) {
            this.stage.destroy();
            this.stage = null;
        }
    }

    async restart() {
        try {
            const realObject = await this.loadRealObjectData(this.realIdBase);
            if (realObject && realObject.records && realObject.records[0]) {
                this.figureXml = realObject.records[0].xtad || realObject.records[0].data || this.figureXml;
            }
        } catch (e) {
            logger.warn('[MS] 再読み込み失敗、 直前のソースで再起動:', e.message);
        }
        await this.bootRuntime();
    }

    showSource() {
        if (!this.stage) return;
        this.stage.message('===== スクリプトソース =====\n');
        this.stage.message(this.scriptSource + '\n');
        this.stage.message('==============================\n');
    }

    /**
     * スクリプトエラーを BTRON エラーパネル風ダイアログで表示する
     * (メッセージ + 下中央に確認ボタン1つ)。 表示中の同一メッセージは抑制して多重ポップアップを防ぐ
     */
    showErrorDialog(message) {
        if (this._errorDialogShowing === message) return;
        this._errorDialogShowing = message;
        this.showMessageDialog(message, [{ label: '確認', value: 'ok' }], 0)
            .finally(() => {
                if (this._errorDialogShowing === message) this._errorDialogShowing = null;
            });
    }

    /**
     * ホスト連携アクション (WSIZE/WMOVE/VOPEN 等)
     */
    handleHostAction(action, payload) {
        console.log('[MS] host action:', action, payload);
        switch (action) {
            case 'script-error':
                this.showErrorDialog(payload.message);
                return;
            case 'resize-window':
                this.messageBus.send('resize-window', { windowId: this.windowId, width: payload.width, height: payload.height });
                return;
            case 'move-window':
                this.messageBus.send('move-window', { windowId: this.windowId, x: payload.x, y: payload.y });
                return;
            case 'save-window-geometry':
                this.messageBus.send('save-window-geometry', { windowId: this.windowId });
                return;
            case 'fullscreen-window':
                this.messageBus.send('toggle-fullscreen', { windowId: this.windowId });
                return;
            case 'vopen':
                this._vopenTarget(payload.target);
                return;
            case 'vclose':
                this._vcloseTarget(payload.target);
                return;
        }
    }

    /**
     * VOPEN: 仮身名 (実身名) を図形内の仮身から実身 ID に解決し、
     * マイクロスクリプト実行ウィンドウ (子ウィンドウ) として開く
     */
    async _vopenTarget(target) {
        if (!target) {
            this.setStatus('VOPEN: 自身の仮身は省略時未対応');
            return;
        }
        const realId = await this._resolveLinkRealId(target);
        if (!realId) {
            this.setStatus('VOPEN: 仮身が見つかりません: ' + target);
            return;
        }
        const messageId = this.generateMessageId('ms-vopen');
        // データフォルダの実身を指定プラグインで開く正規メッセージ
        // ('open-virtual-object' は BPK タブ表示用で raw データ前提のため使わない)
        this.messageBus.send('open-virtual-object-real', {
            virtualObj: { link_id: realId + '_0.xtad' },
            pluginId: 'microscript',
            messageId: messageId
        });
        // VCLOSE (引数なし = 全閉じ) 用に開いたウィンドウ ID を記録
        if (!this._vopenedChildren) this._vopenedChildren = new Map();
        try {
            const r = await this.messageBus.waitFor('window-opened', 5000, (d) => d.messageId === messageId);
            if (r && r.windowId) this._vopenedChildren.set(realId, r.windowId);
        } catch (e) {
            console.log('[MS] VOPEN window-opened 待機タイムアウト:', target);
        }
    }

    /**
     * VCLOSE: 対象指定時はその仮身の子ウィンドウを、 省略時は VOPEN で開いた全子ウィンドウを閉じる
     */
    async _vcloseTarget(target) {
        if (!this._vopenedChildren) this._vopenedChildren = new Map();
        if (target) {
            const realId = await this._resolveLinkRealId(target);
            const windowId = realId ? this._vopenedChildren.get(realId) : null;
            if (windowId) {
                this.messageBus.send('close-window', { windowId: windowId });
                this._vopenedChildren.delete(realId);
            }
            return;
        }
        // 引数なし: VOPEN で開いた子ウィンドウをすべて閉じる
        this._vopenedChildren.forEach((windowId) => {
            this.messageBus.send('close-window', { windowId: windowId });
        });
        this._vopenedChildren.clear();
    }

    /**
     * 仮身名 (リンク先実身の名前) → 実身 ID の解決。
     * UUID 形式ならそのまま、 それ以外は図形内の仮身 (link) のリンク先実身名と照合する
     */
    async _resolveLinkRealId(target) {
        const t = String(target);
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(t)) {
            return t.replace(/_\d+\.xtad$/i, '');
        }
        const links = (this.figure && this.figure.links) || [];
        for (const lk of links) {
            const rid = (lk.linkRef || '').replace(/_\d+\.xtad$/i, '');
            if (!rid) continue;
            try {
                const ro = await this.loadRealObjectData(rid);
                // 実身名は metadata.name に入る (load-real-object の戻り形式)。
                // スクリプト側の名前はレクサー正規化済みのため、 実身名も同じ正規化で比較する
                let name = ro && ((ro.metadata && ro.metadata.name) || ro.name);
                if (name && window.MSLexer && window.MSLexer.normalize) name = window.MSLexer.normalize(name);
                if (name === t) return rid;
            } catch (e) {
                /* 読めない仮身はスキップ */
            }
        }
        return null;
    }

    resolveRealIdFromPath(path) {
        // パス名が "/SYS/...." 形式ならそのまま、 そうでなければ実身名検索
        return path;
    }

    async saveRealObjectData(realId, data) {
        const messageId = this.generateMessageId('save-real-object');
        // ホストの期待形式は { realId, realObject } (FWRITE の永続化経路)
        this.messageBus.send('save-real-object', { realId: realId, realObject: data, messageId: messageId });
        try {
            await this.messageBus.waitFor('real-object-saved', 5000, (d) => d.messageId === messageId);
        } catch (e) {
            console.log('[MS] save-real-object timeout:', e.message);
        }
    }

    async requestListVirtualObjects(path) {
        const messageId = this.generateMessageId('list-virtual-objects');
        this.messageBus.send('list-virtual-objects', { realId: path, messageId: messageId });
        try {
            const r = await this.messageBus.waitFor('virtual-objects-listed', 5000, (d) => d.messageId === messageId);
            return r && r.names ? r.names : [];
        } catch (e) {
            return [];
        }
    }
}

window.microscriptPlugin = new MicroScriptPlugin();
