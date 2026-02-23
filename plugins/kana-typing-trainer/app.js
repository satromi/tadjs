/**
 * かな入力練習プラグイン
 * KanaTypingTrainer - PluginBase継承
 *
 * データファイル命名規則:
 *   {realId}_0.xtad      - 問題文XTAD
 *   {realId}_1_N.json     - キーボードレイアウト（N=0,1,2,...）
 *   {realId}_2_N.json     - かな入力配列（N=0,1,2,...）
 *   {realId}_3_N.json     - キーコード変換マップ（N=0,1,2,...）
 */
class KanaTypingTrainer extends PluginBase {
    constructor() {
        super('KanaTypingTrainer');

        this.keyboardRenderer = null;
        this.typingEngine = null;
        this.keyboardLayout = null;
        this.kanaMappingData = null;

        // 複数レイアウト/配列/キーコード変換管理
        this.keyboardLayouts = [];    // [{ name, fileIndex, data }]
        this.kanaMappings = [];       // [{ name, fileIndex, data }]
        this.keycodeTranslations = []; // [{ name, fileIndex, data }]
        this.activeKeyboardLayoutIndex = 0;
        this.activeKanaMappingIndex = 0;
        this.activeKeycodeTranslationIndex = -1; // -1 = なし

        this.leftShiftHeld = false;
        this.rightShiftHeld = false;
        this.heldKeys = new Set();
        this.lookaheadCount = 4;

        this.init();
    }

    init() {
        this.keyboardRenderer = new KeyboardRenderer(
            document.getElementById('keyboard-container')
        );
        this.typingEngine = new TypingEngine();

        if (this.messageBus) {
            this.setupMessageBusHandlers();
        }
        this.setupContextMenu();
        this._setupKeyboardEvents();
        this._setupDragDrop();
        this._setupResize();
    }

    setupMessageBusHandlers() {
        this.setupCommonMessageBusHandlers();

        this.messageBus.on('init', async (data) => {
            this.onInit(data);
            this.fileData = data.fileData;
            const realIdValue = data.fileData ? (data.fileData.realId || data.fileData.fileId) : null;
            if (realIdValue) {
                this.realId = realIdValue.replace(/_\d+\.xtad$/i, '');
            }
            await this._loadAllData();
        });
    }

    // ========================================
    // JSON読み込み・保存ユーティリティ
    // ========================================

    async _loadJsonFile(suffix) {
        const fileName = this.realId + suffix;
        try {
            const blob = await this.loadDataFileFromParent(fileName);
            if (blob) {
                const text = await blob.text();
                return JSON.parse(text);
            }
        } catch (e) {
            // ignore
        }
        return null;
    }

    async _saveJsonFile(suffix, json) {
        const fileName = this.realId + suffix;
        const text = JSON.stringify(json);
        const blob = new Blob([text], { type: 'application/json' });
        await this.saveImageFile(blob, fileName);
    }

    // ========================================
    // データ読み込み
    // ========================================

    async _loadAllData() {
        try {
            // キーボードレイアウトを順番に読み込み（_1_0, _1_1, _1_2, ...）
            for (let i = 0; i < 100; i++) {
                const data = await this._loadJsonFile('_1_' + i + '.json');
                if (!data) break;
                const name = (data.meta && data.meta.name) || 'レイアウト ' + i;
                this.keyboardLayouts.push({ name, fileIndex: i, data });
            }

            // かな入力配列を順番に読み込み（_2_0, _2_1, _2_2, ...）
            for (let i = 0; i < 100; i++) {
                const data = await this._loadJsonFile('_2_' + i + '.json');
                if (!data) break;
                const name = (data.meta && data.meta.name) || '配列 ' + i;
                this.kanaMappings.push({ name, fileIndex: i, data });
            }

            // キーコード変換マップを順番に読み込み（_3_0, _3_1, _3_2, ...）
            for (let i = 0; i < 100; i++) {
                const data = await this._loadJsonFile('_3_' + i + '.json');
                if (!data) break;
                const name = (data.meta && data.meta.name) || '変換 ' + i;
                this.keycodeTranslations.push({ name, fileIndex: i, data });
            }

            // キーコード変換はデフォルト「なし」(-1)
            this.activeKeycodeTranslationIndex = -1;

            // レイアウトが無い場合のフォールバック
            if (this.keyboardLayouts.length === 0) {
                const layoutData = this._getDefaultKeyboardLayout();
                await this._saveJsonFile('_1_0.json', layoutData);
                const name = (layoutData.meta && layoutData.meta.name) || '日本語109キー';
                this.keyboardLayouts.push({ name, fileIndex: 0, data: layoutData });
            }

            // 配列が無い場合のフォールバック
            if (this.kanaMappings.length === 0) {
                const mappingData = this._getDefaultKanaMapping();
                await this._saveJsonFile('_2_0.json', mappingData);
                const name = (mappingData.meta && mappingData.meta.name) || 'TRON配列';
                this.kanaMappings.push({ name, fileIndex: 0, data: mappingData });
            }

            // アクティブは常に先頭
            this.activeKeyboardLayoutIndex = 0;
            this.activeKanaMappingIndex = 0;

            // アクティブなレイアウト/配列を適用
            this.keyboardLayout = this.keyboardLayouts[this.activeKeyboardLayoutIndex].data;
            this.kanaMappingData = this.kanaMappings[this.activeKanaMappingIndex].data;
            this.typingEngine.setKanaMapping(this.kanaMappingData);

            this._loadQuestionText();
            this._renderKeyboard();
            this._loadQuestion(0);
            this._updateStatusMessage('Enterキーで練習開始');
        } catch (e) {
            this._updateStatusMessage('データの読み込みに失敗しました');
        }
    }

    /**
     * 問題文XTADの読み込み
     */
    _loadQuestionText() {
        if (this.fileData && this.fileData.xmlData) {
            this.typingEngine.parseQuestions(this.fileData.xmlData);
        } else {
            this.typingEngine.parseQuestions(
                '<tad><document><p>こんにちは</p></document></tad>'
            );
        }
    }

    // ========================================
    // レイアウト/配列切り替え
    // ========================================

    _switchKeyboardLayout(index) {
        if (index < 0 || index >= this.keyboardLayouts.length) return;
        if (index === this.activeKeyboardLayoutIndex) return;

        this.activeKeyboardLayoutIndex = index;
        this.keyboardLayout = this.keyboardLayouts[index].data;
        this._renderKeyboard();
        if (this.typingEngine.isPracticing) {
            this._updateNextKeyHighlights();
        }
        this._updateStatusMessage('キーボードレイアウト: ' + this.keyboardLayouts[index].name);
    }

    _switchKanaMapping(index) {
        if (index < 0 || index >= this.kanaMappings.length) return;
        if (index === this.activeKanaMappingIndex) return;

        this.activeKanaMappingIndex = index;
        this.kanaMappingData = this.kanaMappings[index].data;
        this.typingEngine.setKanaMapping(this.kanaMappingData);
        this._renderKeyboard();
        if (this.typingEngine.isPracticing) {
            this._updateNextKeyHighlights();
        }
        this._updateStatusMessage('かな入力方式: ' + this.kanaMappings[index].name);
    }

    // ========================================
    // キーコード変換
    // ========================================

    _translateKeyCode(code) {
        if (this.activeKeycodeTranslationIndex < 0) return code;
        const trans = this.keycodeTranslations[this.activeKeycodeTranslationIndex];
        if (!trans || !trans.data || !trans.data.keycodeTranslation) return code;
        return trans.data.keycodeTranslation[code] || code;
    }

    _switchKeycodeTranslation(index) {
        if (index === this.activeKeycodeTranslationIndex) return;
        if (index < -1 || index >= this.keycodeTranslations.length) return;

        // 練習中なら停止
        if (this.typingEngine.isPracticing) {
            this._stopPractice();
        }
        this.heldKeys.clear();

        this.activeKeycodeTranslationIndex = index;
        const name = index < 0 ? 'なし' : this.keycodeTranslations[index].name;
        this._updateStatusMessage('キーコード変換: ' + name);
    }

    _getNextFileIndex(items) {
        if (items.length === 0) return 0;
        return Math.max(...items.map(item => item.fileIndex)) + 1;
    }

    // ========================================
    // キーボード描画
    // ========================================

    _renderKeyboard() {
        this.keyboardRenderer.setKanaMapping(this.kanaMappingData);
        this.keyboardRenderer.parseLayout(this.keyboardLayout);
        this.keyboardRenderer.render();
    }

    /**
     * 問題をロードして画面に表示
     */
    _loadQuestion(index) {
        this.typingEngine.loadQuestion(index);
        this._updateQuestionDisplay();
        this._updateInputDisplay();
        this._updateProgressDisplay();
        this.keyboardRenderer.clearHighlights();
    }

    // ========================================
    // キーイベント処理
    // ========================================

    _setupKeyboardEvents() {
        document.addEventListener('keydown', (e) => this._onKeyDown(e));
        document.addEventListener('keyup', (e) => this._onKeyUp(e));
    }

    _onKeyDown(e) {
        const inputCode = this._translateKeyCode(e.code);

        if (inputCode === 'ShiftLeft') {
            this.leftShiftHeld = true;
            this.heldKeys.add(inputCode);
            this.keyboardRenderer.setKeyPressed('ShiftLeft', true);
            return;
        }
        if (inputCode === 'ShiftRight') {
            this.rightShiftHeld = true;
            this.heldKeys.add(inputCode);
            this.keyboardRenderer.setKeyPressed('ShiftRight', true);
            return;
        }

        if (this._isModifierOnly(inputCode)) return;

        e.preventDefault();

        // ショートカット: 変換前のe.codeで判定（ファームウェアDvorakでも正常動作）
        if (e.code === 'KeyL' && e.ctrlKey && !this.typingEngine.isPracticing) {
            this.toggleFullscreen();
            return;
        }

        if (e.code === 'Enter' && !this.typingEngine.isPracticing) {
            this._startPractice();
            return;
        }

        if (e.code === 'Escape') {
            if (this.typingEngine.isPracticing) {
                this._stopPractice();
            }
            return;
        }

        // キー押下表示（練習中・非練習中問わず）
        this.heldKeys.add(inputCode);
        this.keyboardRenderer.setKeyPressed(inputCode, true);

        if (!this.typingEngine.isPracticing) return;

        const result = this.typingEngine.processInput(
            inputCode,
            this.leftShiftHeld,
            this.rightShiftHeld,
            (keyCode) => this.keyboardRenderer.getKeyPosition(keyCode),
            this.heldKeys
        );

        // 部分コンボ（待機中）→ ハイライト更新のみ
        if (result.partial) {
            this._updateStatsDisplay();
            this._updateNextKeyHighlights();
            return;
        }

        if (result.correct) {
            if (result.comboKeys) {
                this.keyboardRenderer.showCorrectFlash(result.comboKeys);
            } else {
                this.keyboardRenderer.showCorrectFlash(inputCode);
            }
            this.isModified = true;
        } else if (result.correct === false && (result.char !== null || result.comboWrong)) {
            this.keyboardRenderer.showWrongFlash(inputCode);
        }

        this._updateInputDisplay();
        this._updateStatsDisplay();
        this._updateNextKeyHighlights();

        if (result.finished) {
            this._onPracticeComplete();
        } else if (result.questionFinished) {
            this._updateQuestionDisplay();
            this._updateInputDisplay();
            this._updateProgressDisplay();
        } else if (result.phraseFinished) {
            this._updateQuestionDisplay();
            this._updateInputDisplay();
        }
    }

    _onKeyUp(e) {
        const inputCode = this._translateKeyCode(e.code);
        this.heldKeys.delete(inputCode);
        if (inputCode === 'ShiftLeft') {
            this.leftShiftHeld = false;
            this.keyboardRenderer.setKeyPressed('ShiftLeft', false);
            return;
        }
        if (inputCode === 'ShiftRight') {
            this.rightShiftHeld = false;
            this.keyboardRenderer.setKeyPressed('ShiftRight', false);
            return;
        }
        this.keyboardRenderer.setKeyPressed(inputCode, false);
    }

    _isModifierOnly(code) {
        return ['ControlLeft', 'ControlRight', 'AltLeft', 'AltRight',
                'MetaLeft', 'MetaRight', 'CapsLock'].includes(code);
    }

    // ========================================
    // 練習制御
    // ========================================

    _startPractice() {
        this.heldKeys.clear();
        this.typingEngine.startPractice();
        this._updateQuestionDisplay();
        this._updateInputDisplay();
        this._updateStatsDisplay();
        this._updateProgressDisplay();
        this._updateNextKeyHighlights();
        this._updateStatusMessage('練習中... (Escで中断)');
    }

    _stopPractice() {
        this.heldKeys.clear();
        this.typingEngine.isPracticing = false;
        this.keyboardRenderer.clearHighlights();
        this._updateStatusMessage('中断しました。Enterキーで再開');
    }

    async _onPracticeComplete() {
        this.keyboardRenderer.clearHighlights();

        const stats = this.typingEngine.getStats();
        const progress = this.typingEngine.getProgress();

        const html = '<div class="result-summary">' +
            '<div class="result-title">全問完了!</div>' +
            '<div>問題数: <span class="result-value">' + progress.total + ' 問</span></div>' +
            '<div>速度: <span class="result-value">' + stats.speed + ' 文字/分</span></div>' +
            '<div>正誤率: <span class="result-value">' + stats.accuracy + '%</span></div>' +
            '<div>左右率: <span class="result-value">' + stats.leftHandCount + ':' + stats.rightHandCount + '</span></div>' +
            '<div>シフト率: <span class="result-value">' + stats.shiftRatio + '%</span></div>' +
            '<div>移動距離: <span class="result-value">' + stats.distance + ' u/字 (総 ' + stats.totalDistance + ' u)</span></div>' +
            '<div>経過時間: <span class="result-value">' + stats.elapsedSeconds + ' 秒</span></div>' +
            '</div>';

        const buttons = [
            { label: '最初からやり直す', value: 'restart' },
            { label: '閉じる', value: 'close' }
        ];

        const result = await this.showCustomDialog({
            title: '結果',
            dialogHtml: html,
            buttons: buttons,
            defaultButton: 0,
            width: 350
        });

        if (result && result.button === 'restart') {
            this._loadQuestion(0);
            this._updateStatusMessage('Enterキーで練習開始');
        } else {
            this._loadQuestion(0);
            this._updateStatusMessage('全問完了。Enterキーで再開');
        }
    }

    // ========================================
    // 画面更新
    // ========================================

    _updateQuestionDisplay() {
        const container = document.getElementById('question-text');
        const state = this.typingEngine.getCurrentState();

        container.innerHTML = '';

        for (let pi = 0; pi < state.phrases.length; pi++) {
            if (pi > 0) {
                const sep = document.createElement('span');
                sep.className = 'phrase-separator';
                sep.textContent = ' ';
                container.appendChild(sep);
            }

            const phraseSpan = document.createElement('span');
            phraseSpan.className = 'phrase';

            if (pi < state.currentPhraseIndex) {
                phraseSpan.classList.add('completed');
            } else if (pi === state.currentPhraseIndex) {
                phraseSpan.classList.add('current');
            } else {
                phraseSpan.classList.add('pending');
            }

            const phrase = state.phrases[pi];
            for (const seg of phrase.segments) {
                if (seg.ruby) {
                    const ruby = document.createElement('ruby');
                    ruby.textContent = seg.display;
                    const rt = document.createElement('rt');
                    rt.textContent = seg.ruby;
                    ruby.appendChild(rt);
                    phraseSpan.appendChild(ruby);
                } else {
                    const span = document.createElement('span');
                    span.textContent = seg.display;
                    phraseSpan.appendChild(span);
                }
            }

            container.appendChild(phraseSpan);
        }
    }

    _updateInputDisplay() {
        const container = document.getElementById('input-display');
        const state = this.typingEngine.getCurrentState();

        container.innerHTML = '';

        if (!state.isPracticing && !state.isCompleted) return;

        const inputText = state.inputChars;
        for (let i = 0; i < inputText.length; i++) {
            const span = document.createElement('span');
            span.className = 'input-char';
            span.textContent = inputText[i];

            if (i < state.currentCharIndex) {
                span.classList.add('correct');
            } else if (i >= state.currentCharIndex && i < state.currentCharIndex + state.expectedLength) {
                span.classList.add('current');
            } else {
                span.classList.add('pending');
            }

            container.appendChild(span);
        }
    }

    _updateNextKeyHighlights() {
        const nextKeys = this.typingEngine.getNextKeys(this.lookaheadCount);
        this.keyboardRenderer.highlightNextKeys(nextKeys);
    }

    _updateStatsDisplay() {
        const stats = this.typingEngine.getStats();

        document.getElementById('stat-speed').textContent = stats.speed + ' 文字/分';
        document.getElementById('stat-accuracy').textContent = stats.accuracy + '%';
        document.getElementById('stat-hand-ratio').textContent =
            stats.leftHandCount + ':' + stats.rightHandCount;
        document.getElementById('stat-shift-ratio').textContent = stats.shiftRatio + '%';
        document.getElementById('stat-distance').textContent = stats.distance + ' u/字';
        document.getElementById('stat-total-distance').textContent = stats.totalDistance + ' u';
    }

    _updateProgressDisplay() {
        const progress = this.typingEngine.getProgress();
        document.getElementById('stat-progress').textContent =
            progress.current + ' / ' + progress.total;
    }

    _updateStatusMessage(message) {
        if (this.messageBus) {
            this.setStatus(message);
        }
    }

    // ========================================
    // 表示メニュー機能
    // ========================================

    _refresh() {
        this._renderKeyboard();
        this._updateQuestionDisplay();
        this._updateInputDisplay();
        this._updateStatsDisplay();
        this._updateProgressDisplay();
        if (this.typingEngine.isPracticing) {
            this._updateNextKeyHighlights();
        }
    }

    applyBackgroundColor(color) {
        this.bgColor = color;
        document.body.style.backgroundColor = color;
        const container = document.getElementById('typing-trainer-container');
        if (container) container.style.backgroundColor = color;
    }

    // ========================================
    // ドラッグ&ドロップ
    // ========================================

    _setupDragDrop() {
        const container = document.getElementById('typing-trainer-container');

        container.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        });

        container.addEventListener('drop', (e) => {
            e.preventDefault();
            this._handleFileDrop(e);
        });
    }

    async _handleFileDrop(e) {
        const files = e.dataTransfer.files;
        if (files.length === 0) return;

        const file = files[0];
        if (!file.name.endsWith('.json')) return;

        try {
            const text = await file.text();
            const json = JSON.parse(text);

            if (json.layout || (json.meta && json.meta.format === 'kle-extended')) {
                // キーボードレイアウト追加
                const nextFileIndex = this._getNextFileIndex(this.keyboardLayouts);
                await this._saveJsonFile('_1_' + nextFileIndex + '.json', json);
                const name = (json.meta && json.meta.name) || file.name.replace('.json', '');
                this.keyboardLayouts.push({ name, fileIndex: nextFileIndex, data: json });
                this.activeKeyboardLayoutIndex = this.keyboardLayouts.length - 1;
                this.keyboardLayout = json;
                this._renderKeyboard();
                if (this.typingEngine.isPracticing) {
                    this._updateNextKeyHighlights();
                }
                this._updateStatusMessage('キーボードレイアウト「' + name + '」を追加しました');
            } else if (json.keycodeTranslation) {
                // キーコード変換マップ追加
                const nextFileIndex = this._getNextFileIndex(this.keycodeTranslations);
                await this._saveJsonFile('_3_' + nextFileIndex + '.json', json);
                const name = (json.meta && json.meta.name) || file.name.replace('.json', '');
                this.keycodeTranslations.push({ name, fileIndex: nextFileIndex, data: json });
                this.activeKeycodeTranslationIndex = this.keycodeTranslations.length - 1;
                if (this.typingEngine.isPracticing) {
                    this._stopPractice();
                }
                this.heldKeys.clear();
                this._updateStatusMessage('キーコード変換「' + name + '」を追加・適用しました');
            } else if (json.mapping) {
                // かな入力配列追加
                const nextFileIndex = this._getNextFileIndex(this.kanaMappings);
                await this._saveJsonFile('_2_' + nextFileIndex + '.json', json);
                const name = (json.meta && json.meta.name) || file.name.replace('.json', '');
                this.kanaMappings.push({ name, fileIndex: nextFileIndex, data: json });
                this.activeKanaMappingIndex = this.kanaMappings.length - 1;
                this.kanaMappingData = json;
                this.typingEngine.setKanaMapping(json);
                this._renderKeyboard();
                if (this.typingEngine.isPracticing) {
                    this._updateNextKeyHighlights();
                }
                this._updateStatusMessage('かな入力方式「' + name + '」を追加しました');
            } else {
                this._updateStatusMessage('不明なJSONファイル形式です');
            }
        } catch (e) {
            this._updateStatusMessage('JSONファイルの読み込みに失敗しました');
        }
    }

    // ========================================
    // リサイズ対応
    // ========================================

    _setupResize() {
        let resizeTimer = null;
        window.addEventListener('resize', () => {
            if (resizeTimer) clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                this.keyboardRenderer.onResize();
            }, 100);
        });
    }

    // ========================================
    // メニュー定義
    // ========================================

    getMenuDefinition() {
        return [
            {
                label: '表示',
                submenu: [
                    { label: '全画面表示オンオフ', action: 'toggle-fullscreen', shortcut: 'Ctrl+L' },
                    { label: '再表示', action: 'refresh' },
                    { label: '背景色変更', action: 'change-bg-color' }
                ]
            },
            {
                label: 'キーボードレイアウト',
                submenu: this._buildKeyboardLayoutMenu()
            },
            {
                label: 'かな入力方式',
                submenu: this._buildKanaMappingMenu()
            },
            {
                label: 'キーコード変換',
                submenu: this._buildKeycodeTranslationMenu()
            },
            {
                label: '練習',
                submenu: [
                    { label: '開始', action: 'start-practice', shortcut: 'Enter' },
                    { label: 'リセット', action: 'reset-practice' },
                    { separator: true },
                    { label: '先読みキー数...', action: 'set-lookahead-count' }
                ]
            }
        ];
    }

    _buildKeyboardLayoutMenu() {
        return this.keyboardLayouts.map((layout, index) => ({
            label: (index === this.activeKeyboardLayoutIndex ? '✓ ' : '') + layout.name,
            action: 'select-keyboard-layout-' + index
        }));
    }

    _buildKanaMappingMenu() {
        return this.kanaMappings.map((mapping, index) => ({
            label: (index === this.activeKanaMappingIndex ? '✓ ' : '') + mapping.name,
            action: 'select-kana-mapping-' + index
        }));
    }

    _buildKeycodeTranslationMenu() {
        const items = [
            {
                label: (this.activeKeycodeTranslationIndex < 0 ? '✓ ' : '') + 'なし',
                action: 'select-keycode-translation--1'
            }
        ];
        for (let i = 0; i < this.keycodeTranslations.length; i++) {
            items.push({
                label: (i === this.activeKeycodeTranslationIndex ? '✓ ' : '') + this.keycodeTranslations[i].name,
                action: 'select-keycode-translation-' + i
            });
        }
        return items;
    }

    executeMenuAction(action) {
        // 表示メニュー
        if (action === 'toggle-fullscreen') {
            this.toggleFullscreen();
            return;
        }
        if (action === 'refresh') {
            this._refresh();
            return;
        }
        if (action === 'change-bg-color') {
            this.changeBgColor();
            return;
        }

        // キーボードレイアウト切り替え
        if (action.startsWith('select-keyboard-layout-')) {
            const index = parseInt(action.replace('select-keyboard-layout-', ''), 10);
            this._switchKeyboardLayout(index);
            return;
        }

        // かな入力方式切り替え
        if (action.startsWith('select-kana-mapping-')) {
            const index = parseInt(action.replace('select-kana-mapping-', ''), 10);
            this._switchKanaMapping(index);
            return;
        }

        // キーコード変換切り替え
        if (action.startsWith('select-keycode-translation-')) {
            const index = parseInt(action.replace('select-keycode-translation-', ''), 10);
            this._switchKeycodeTranslation(index);
            return;
        }

        // 練習メニュー
        switch (action) {
            case 'start-practice':
                if (!this.typingEngine.isPracticing) {
                    this._startPractice();
                }
                break;

            case 'reset-practice':
                this._stopPractice();
                this._loadQuestion(0);
                this._updateStatusMessage('リセットしました。Enterキーで練習開始');
                break;

            case 'set-lookahead-count':
                this._showLookaheadDialog();
                break;
        }
    }

    async _showLookaheadDialog() {
        const result = await this.showInputDialog(
            '先読みキー数（1〜8）',
            String(this.lookaheadCount),
            60
        );
        if (result !== null) {
            const num = parseInt(result, 10);
            if (num >= 1 && num <= 8) {
                this.lookaheadCount = num;
                this._updateNextKeyHighlights();
            }
        }
    }

    // ========================================
    // デフォルトデータ（フォールバック）
    // ========================================

    _getDefaultKeyboardLayout() {
        return {
            meta: { name: '日本語109キー', version: '1.0', format: 'kle-extended' },
            layout: [
                [
                    {"id":"Escape"}, "Esc",
                    {"x":0.5,"id":"F1"}, "F1", {"id":"F2"}, "F2", {"id":"F3"}, "F3", {"id":"F4"}, "F4",
                    {"x":0.5,"id":"F5"}, "F5", {"id":"F6"}, "F6", {"id":"F7"}, "F7", {"id":"F8"}, "F8",
                    {"x":0.5,"id":"F9"}, "F9", {"id":"F10"}, "F10", {"id":"F11"}, "F11", {"id":"F12"}, "F12"
                ],
                [
                    {"y":0.5,"id":"Backquote"}, "半/全",
                    {"id":"Digit1"}, "!\n1", {"id":"Digit2"}, "\"\n2", {"id":"Digit3"}, "#\n3",
                    {"id":"Digit4"}, "$\n4", {"id":"Digit5"}, "%\n5", {"id":"Digit6"}, "&\n6",
                    {"id":"Digit7"}, "'\n7", {"id":"Digit8"}, "(\n8", {"id":"Digit9"}, ")\n9",
                    {"id":"Digit0"}, "\n0", {"id":"Minus"}, "=\n-", {"id":"Equal"}, "~\n^",
                    {"id":"IntlYen"}, "|\n¥", {"id":"Backspace"}, "BS"
                ],
                [
                    {"id":"Tab","w":1.5}, "Tab",
                    {"id":"KeyQ"}, "Q", {"id":"KeyW"}, "W", {"id":"KeyE"}, "E",
                    {"id":"KeyR"}, "R", {"id":"KeyT"}, "T", {"id":"KeyY"}, "Y",
                    {"id":"KeyU"}, "U", {"id":"KeyI"}, "I", {"id":"KeyO"}, "O",
                    {"id":"KeyP"}, "P", {"id":"BracketLeft"}, "@", {"id":"BracketRight"}, "[",
                    {"id":"Enter","x":0.25,"w":1.25,"h":2}, "Enter"
                ],
                [
                    {"id":"CapsLock","w":1.75}, "英数",
                    {"id":"KeyA"}, "A", {"id":"KeyS"}, "S", {"id":"KeyD"}, "D",
                    {"id":"KeyF"}, "F", {"id":"KeyG"}, "G", {"id":"KeyH"}, "H",
                    {"id":"KeyJ"}, "J", {"id":"KeyK"}, "K", {"id":"KeyL"}, "L",
                    {"id":"Semicolon"}, ";", {"id":"Quote"}, ":", {"id":"Backslash"}, "]"
                ],
                [
                    {"id":"ShiftLeft","w":2.25}, "Shift",
                    {"id":"KeyZ"}, "Z", {"id":"KeyX"}, "X", {"id":"KeyC"}, "C",
                    {"id":"KeyV"}, "V", {"id":"KeyB"}, "B", {"id":"KeyN"}, "N",
                    {"id":"KeyM"}, "M", {"id":"Comma"}, ",", {"id":"Period"}, ".",
                    {"id":"Slash"}, "/", {"id":"IntlRo"}, "\\",
                    {"id":"ShiftRight","w":1.75}, "Shift"
                ],
                [
                    {"id":"ControlLeft","w":1.5}, "Ctrl",
                    {"id":"MetaLeft"}, "Win",
                    {"id":"AltLeft","w":1.25}, "Alt",
                    {"id":"NonConvert","w":1.25}, "無変換",
                    {"id":"Space","w":4}, "",
                    {"id":"Convert","w":1.25}, "変換",
                    {"id":"KanaMode","w":1.25}, "かな",
                    {"id":"AltRight"}, "Alt",
                    {"id":"ControlRight","w":1.5}, "Ctrl"
                ]
            ]
        };
    }

    _getDefaultKanaMapping() {
        return {
            meta: { name: 'TRONかな配列 (フォールバック)', version: '1.0' },
            mapping: {
                "KeyQ": {"normal":"ら","leftShift":"ひ","rightShift":"び"},
                "KeyW": {"normal":"る","leftShift":"そ","rightShift":"ぞ"},
                "KeyE": {"normal":"こ","leftShift":"・","rightShift":"ご"},
                "KeyR": {"normal":"は","leftShift":"ゃ","rightShift":"ば"},
                "KeyT": {"normal":"ょ","leftShift":"ほ","rightShift":"ぼ"},
                "KeyY": {"normal":"き","leftShift":"え","rightShift":"ぎ"},
                "KeyU": {"normal":"の","leftShift":"け","rightShift":"げ"},
                "KeyI": {"normal":"く","leftShift":"め","rightShift":"ぐ"},
                "KeyO": {"normal":"あ","leftShift":"む","rightShift":"○"},
                "KeyP": {"normal":"れ","leftShift":"ろ","rightShift":"ゐ"},
                "KeyA": {"normal":"た","leftShift":"ぬ","rightShift":"だ"},
                "KeyS": {"normal":"と","leftShift":"ね","rightShift":"ど"},
                "KeyD": {"normal":"か","leftShift":"ゅ","rightShift":"が"},
                "KeyF": {"normal":"て","leftShift":"よ","rightShift":"で"},
                "KeyG": {"normal":"も","leftShift":"ふ","rightShift":"ぶ"},
                "KeyH": {"normal":"を","leftShift":"お","rightShift":"゛"},
                "KeyJ": {"normal":"い","leftShift":"ち","rightShift":"ぢ"},
                "KeyK": {"normal":"う","leftShift":"ー","rightShift":"ヴ"},
                "KeyL": {"normal":"し","leftShift":"み","rightShift":"じ"},
                "Semicolon": {"normal":"ん","leftShift":"や","rightShift":"ゑ"},
                "Quote": {"normal":"ー"},
                "KeyZ": {"normal":"ま","leftShift":"ぇ","rightShift":"ヵ"},
                "KeyX": {"normal":"り","leftShift":"ぉ","rightShift":"ヶ"},
                "KeyC": {"normal":"に","leftShift":"せ","rightShift":"ぜ"},
                "KeyV": {"normal":"さ","leftShift":"ゆ","rightShift":"ざ"},
                "KeyB": {"normal":"な","leftShift":"へ","rightShift":"べ"},
                "KeyN": {"normal":"す","leftShift":"わ","rightShift":"ず"},
                "KeyM": {"normal":"つ","leftShift":"ぃ","rightShift":"づ"},
                "Comma": {"normal":"、","leftShift":"ぁ","rightShift":"，"},
                "Period": {"normal":"。","leftShift":"゜","rightShift":"．"},
                "Slash": {"normal":"っ","leftShift":"ぅ","rightShift":"ゎ"}
            },
            handAssignment: {
                left: ["KeyQ","KeyW","KeyE","KeyR","KeyT","KeyA","KeyS","KeyD","KeyF","KeyG","KeyZ","KeyX","KeyC","KeyV","KeyB","ShiftLeft"],
                right: ["KeyY","KeyU","KeyI","KeyO","KeyP","KeyH","KeyJ","KeyK","KeyL","Semicolon","Quote","KeyN","KeyM","Comma","Period","Slash","ShiftRight","Space"]
            },
            fingerAssignment: {
                left_pinky: ["KeyQ","KeyA","KeyZ"],
                left_ring: ["KeyW","KeyS","KeyX"],
                left_middle: ["KeyE","KeyD","KeyC"],
                left_index: ["KeyR","KeyT","KeyF","KeyG","KeyV","KeyB"],
                right_index: ["KeyY","KeyU","KeyH","KeyJ","KeyN","KeyM"],
                right_middle: ["KeyI","KeyK","Comma"],
                right_ring: ["KeyO","KeyL","Period"],
                right_pinky: ["KeyP","Semicolon","Quote","Slash"]
            }
        };
    }

}

// プラグインインスタンス生成
const kanaTypingTrainer = new KanaTypingTrainer();
