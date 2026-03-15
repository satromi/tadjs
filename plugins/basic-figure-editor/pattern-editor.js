/**
 * パターン編集パネル
 * basic-figure-editor の子パネルウィンドウとして動作
 * 16×16ドットのパターン編集機能を提供
 */
class PatternEditor {
    constructor() {
        this.parentWindowId = null;
        this.currentPatternId = 0;

        // 16×16 パターンデータ（行マスク配列）
        // data[row] = 16bit整数、ビットが1=前景色、0=背景色
        this.patternData = new Array(16).fill(0);
        this.loadedData = null; // 読込パターンのバックアップ（入替用）
        this.undoData = null; // Undo用バックアップ

        // 編集ツール
        this.currentTool = 'pencil'; // 'pencil', 'rect', 'fill'

        // 描画色（カラーピッカーで変更）
        this.selectedColor = '#000000';
        // 各ドットの色を個別保持（null=背景色、'#rrggbb'=描画色）
        this.pixelColors = this.createEmptyPixelColors();

        // カスタムパターン（editor.jsのcustomPatternsのローカルコピー）
        this.localCustomPatterns = {};

        // 吸い取り（スポイト）モード
        this.eyedropperMode = false;

        // 矩形ツール用ドラッグ状態
        this.rectStart = null;
        this.isDrawing = false;

        // 編集グリッド
        this.editCanvas = document.getElementById('editCanvas');
        this.editCtx = this.editCanvas.getContext('2d');
        this.CELL_SIZE = 12; // 各ドットの表示サイズ

        // プレビューキャンバス
        this.previewCanvas = document.getElementById('previewCanvas');
        this.previewCtx = this.previewCanvas.getContext('2d');

        this.setupMessageHandler();
        this.setupColorPalette();
        this.setupEyedropper();
        this.setupEventListeners();
        this.redrawAll();
    }

    setupMessageHandler() {
        window.addEventListener('message', (event) => {
            const data = event.data;
            if (!data || !data.type) return;

            switch (data.type) {
                case 'init-child-panel':
                    this.handleInit(data);
                    break;
                case 'update-pattern-data':
                    this.handleUpdatePattern(data);
                    break;
                case 'patterns-updated':
                    // 親からパターンテーブル更新通知
                    if (data.patternId !== undefined && data.patternData) {
                        this.localCustomPatterns[data.patternId] = {
                            id: data.patternId,
                            type: 'pattern',
                            data: data.patternData,
                            pixelColors: data.pixelColors || null
                        };
                    }
                    break;
                case 'menu-action':
                    this.handleMenuAction(data.action);
                    break;
                case 'get-menu-definition':
                    // ContextMenuManagerからのメニュー定義要求に応答
                    window.parent.postMessage({
                        type: 'menu-definition-response',
                        messageId: data.messageId,
                        menuDefinition: [
                            {
                                label: '編集',
                                submenu: [
                                    { label: '復旧', action: 'undo' },
                                    { label: '全消去', action: 'clear-all' },
                                    { label: '全塗り', action: 'fill-all' },
                                    { label: '反転', action: 'invert' }
                                ]
                            }
                        ]
                    }, '*');
                    break;
            }
        });
    }

    handleInit(data) {
        this.parentWindowId = data.parentWindowId;

        if (data.initData) {
            if (data.initData.currentPatternId !== undefined) {
                this.currentPatternId = data.initData.currentPatternId;
            }
            if (data.initData.patternData) {
                this.patternData = data.initData.patternData.slice();
            } else if (this.currentPatternId >= 2 && typeof DEFAULT_PATTERNS !== 'undefined') {
                // デフォルトパターンから読込
                const patDef = DEFAULT_PATTERNS[this.currentPatternId];
                if (patDef && patDef.type === 'pattern') {
                    this.patternData = patDef.data.slice();
                }
            }
        }

        // カスタムパターンを受信
        if (data.initData && data.initData.customPatterns) {
            this.localCustomPatterns = data.initData.customPatterns;
        }

        // initDataにpixelColorsがあればそれを使用（可変サイズは16×16に展開）、なければビットマスクから初期化
        if (data.initData && data.initData.pixelColors) {
            this.pixelColors = this.expandPixelColorsTo16x16(data.initData.pixelColors);
            // pixelColorsからrowMasksを再生成
            this.patternData = this.generateRowMasksFromPixelColors(this.pixelColors);
        } else {
            this.initPixelColorsFromData('#000000');
        }
        this.loadedData = this.patternData.slice();
        this.loadedPixelColors = this.pixelColors.map(row => row.slice());
        this.undoData = this.patternData.slice();
        this.undoPixelColors = this.pixelColors.map(row => row.slice());
        this.redrawAll();
    }

    handleUpdatePattern(data) {
        if (data.patternData) {
            this.patternData = data.patternData.slice();
            this.initPixelColorsFromData('#000000');
            this.loadedData = this.patternData.slice();
            this.loadedPixelColors = this.pixelColors.map(row => row.slice());
            this.undoData = this.patternData.slice();
            this.undoPixelColors = this.pixelColors.map(row => row.slice());
            this.redrawAll();
        }
        if (data.patternId !== undefined) {
            this.currentPatternId = data.patternId;
        }
    }

    setupColorPalette() {
        const paletteDiv = document.getElementById('colorPalette');
        if (!paletteDiv) return;
        paletteDiv.innerHTML = '';

        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.id = 'patternColorPicker';
        colorInput.value = this.selectedColor;
        colorInput.style.cssText = 'width: 24px; height: 24px; padding: 0; border: 1px solid #999; cursor: pointer;';
        colorInput.title = 'クリックで色変更';
        colorInput.addEventListener('input', (e) => {
            this.selectedColor = e.target.value;
            this.updateSelectedColorSwatch();
        });

        paletteDiv.appendChild(colorInput);
        this.updateSelectedColorSwatch();
    }

    setupEyedropper() {
        // スポイトはツールボタン（data-tool="eyedropper"）として統合済み
        // ツールボタンのクリックハンドラで currentTool が設定される
    }

    updateEyedropperUI() {
        // グリッドカーソル変更
        const container = this.editCanvas.parentElement;
        if (container) {
            container.style.cursor = this.currentTool === 'eyedropper' ? 'copy' : 'crosshair';
        }
    }

    updateSelectedColorSwatch() {
        // 色見本は削除済み（スポイトボタンに置換）
    }

    setupEventListeners() {
        // 編集グリッドのマウスイベント
        this.editCanvas.addEventListener('mousedown', (e) => this.onEditMouseDown(e));
        this.editCanvas.addEventListener('mousemove', (e) => this.onEditMouseMove(e));
        this.editCanvas.addEventListener('mouseup', (e) => this.onEditMouseUp(e));
        this.editCanvas.addEventListener('mouseleave', () => { this.isDrawing = false; });

        // 右クリックメニュー（親ウインドウのContextMenuManager経由で表示）
        document.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.requestContextMenu(e.clientX, e.clientY);
        });

        // ツールボタン
        document.querySelectorAll('.editor-tool-btn[data-tool]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.currentTool = btn.dataset.tool;
                document.querySelectorAll('.editor-tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.updateEyedropperUI();
            });
        });

        // アクションボタン
        document.querySelectorAll('.editor-tool-btn[data-action]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.executeAction(btn.dataset.action);
            });
        });

        // 読込・入替・復旧ボタン
        const loadBtn = document.getElementById('loadBtn');
        if (loadBtn) {
            loadBtn.addEventListener('click', () => this.showLoadDialog());
        }

        const replaceBtn = document.getElementById('replaceBtn');
        if (replaceBtn) {
            replaceBtn.addEventListener('click', () => this.replacePattern());
        }

        const undoBtn = document.getElementById('undoBtn');
        if (undoBtn) {
            undoBtn.addEventListener('click', () => this.undoPattern());
        }
    }

    // --- 編集グリッド操作 ---

    getGridPos(e) {
        const rect = this.editCanvas.getBoundingClientRect();
        const x = Math.floor((e.clientX - rect.left) / this.CELL_SIZE);
        const y = Math.floor((e.clientY - rect.top) / this.CELL_SIZE);
        return { x: Math.max(0, Math.min(15, x)), y: Math.max(0, Math.min(15, y)) };
    }

    onEditMouseDown(e) {
        if (e.button !== 0) return; // 左クリックのみ
        const pos = this.getGridPos(e);

        // スポイトツール: クリックした箇所の色を吸い取り
        if (this.currentTool === 'eyedropper') {
            const pixelColor = this.pixelColors[pos.y][pos.x];
            if (pixelColor) {
                this.selectedColor = pixelColor;
                // カラーピッカーの値も同期
                const colorInput = document.getElementById('patternColorPicker');
                if (colorInput) colorInput.value = pixelColor;
            }
            return;
        }

        this.isDrawing = true;
        // 白色選択時はビット0（消去）、それ以外はビット1（描画）
        const isErase = (this.selectedColor === '#ffffff');

        if (this.currentTool === 'pencil') {
            this.saveUndo();
            this.setPixel(pos.x, pos.y, !isErase, isErase ? null : this.selectedColor);
            this.redrawAll();
        } else if (this.currentTool === 'rect') {
            this.rectStart = pos;
        } else if (this.currentTool === 'fill') {
            this.saveUndo();
            this.floodFill(pos.x, pos.y, !isErase, isErase ? null : this.selectedColor);
            this.redrawAll();
        }
    }

    onEditMouseMove(e) {
        if (!this.isDrawing) return;
        const pos = this.getGridPos(e);
        const isErase = (this.selectedColor === '#ffffff');

        if (this.currentTool === 'pencil') {
            this.setPixel(pos.x, pos.y, !isErase, isErase ? null : this.selectedColor);
            this.redrawAll();
        } else if (this.currentTool === 'rect' && this.rectStart) {
            this.redrawAll();
            this.drawRectPreview(this.rectStart, pos);
        }
    }

    onEditMouseUp(e) {
        if (!this.isDrawing) return;
        const pos = this.getGridPos(e);
        const isErase = (this.selectedColor === '#ffffff');

        if (this.currentTool === 'rect' && this.rectStart) {
            this.saveUndo();
            this.fillRect(this.rectStart, pos, !isErase, isErase ? null : this.selectedColor);
            this.rectStart = null;
            this.redrawAll();
        }

        this.isDrawing = false;
    }

    // --- ピクセル操作 ---

    getPixel(x, y) {
        if (x < 0 || x > 15 || y < 0 || y > 15) return false;
        return (this.patternData[y] & (1 << (15 - x))) !== 0;
    }

    setPixel(x, y, value, color) {
        if (x < 0 || x > 15 || y < 0 || y > 15) return;
        if (value) {
            this.patternData[y] |= (1 << (15 - x));
            this.pixelColors[y][x] = color || this.selectedColor;
        } else {
            this.patternData[y] &= ~(1 << (15 - x));
            this.pixelColors[y][x] = null;
        }
    }

    fillRect(start, end, value, color) {
        const x1 = Math.min(start.x, end.x);
        const y1 = Math.min(start.y, end.y);
        const x2 = Math.max(start.x, end.x);
        const y2 = Math.max(start.y, end.y);

        for (let y = y1; y <= y2; y++) {
            for (let x = x1; x <= x2; x++) {
                this.setPixel(x, y, value, color);
            }
        }
    }

    floodFill(startX, startY, fillValue, color) {
        const targetValue = this.getPixel(startX, startY);
        if (targetValue === fillValue) return;

        const stack = [{ x: startX, y: startY }];
        const visited = new Set();

        while (stack.length > 0) {
            const { x, y } = stack.pop();
            const key = `${x},${y}`;
            if (visited.has(key)) continue;
            if (x < 0 || x > 15 || y < 0 || y > 15) continue;
            if (this.getPixel(x, y) !== targetValue) continue;

            visited.add(key);
            this.setPixel(x, y, fillValue, color);

            stack.push({ x: x + 1, y: y });
            stack.push({ x: x - 1, y: y });
            stack.push({ x: x, y: y + 1 });
            stack.push({ x: x, y: y - 1 });
        }
    }

    // --- 変形操作 ---

    executeAction(action) {
        this.saveUndo();
        const newData = new Array(16).fill(0);
        const newPixelColors = this.createEmptyPixelColors();

        switch (action) {
            case 'move-left':
                for (let y = 0; y < 16; y++) {
                    newData[y] = ((this.patternData[y] << 1) | (this.patternData[y] >>> 15)) & 0xFFFF;
                    for (let x = 0; x < 16; x++) {
                        newPixelColors[y][x] = this.pixelColors[y][(x + 1) % 16];
                    }
                }
                break;
            case 'move-right':
                for (let y = 0; y < 16; y++) {
                    newData[y] = ((this.patternData[y] >>> 1) | ((this.patternData[y] & 1) << 15)) & 0xFFFF;
                    for (let x = 0; x < 16; x++) {
                        newPixelColors[y][x] = this.pixelColors[y][(x + 15) % 16];
                    }
                }
                break;
            case 'move-up':
                for (let y = 0; y < 16; y++) {
                    newData[y] = this.patternData[(y + 1) % 16];
                    newPixelColors[y] = this.pixelColors[(y + 1) % 16].slice();
                }
                break;
            case 'move-down':
                for (let y = 0; y < 16; y++) {
                    newData[y] = this.patternData[(y + 15) % 16];
                    newPixelColors[y] = this.pixelColors[(y + 15) % 16].slice();
                }
                break;
            case 'rotate-cw':
                for (let y = 0; y < 16; y++) {
                    for (let x = 0; x < 16; x++) {
                        if (this.patternData[15 - x] & (1 << (15 - y))) {
                            newData[y] |= (1 << (15 - x));
                        }
                        newPixelColors[y][x] = this.pixelColors[15 - x][y];
                    }
                }
                break;
            case 'rotate-ccw':
                for (let y = 0; y < 16; y++) {
                    for (let x = 0; x < 16; x++) {
                        if (this.patternData[x] & (1 << y)) {
                            newData[y] |= (1 << (15 - x));
                        }
                        newPixelColors[y][x] = this.pixelColors[x][15 - y];
                    }
                }
                break;
            case 'flip-h':
                for (let y = 0; y < 16; y++) {
                    let reversed = 0;
                    for (let x = 0; x < 16; x++) {
                        if (this.patternData[y] & (1 << x)) {
                            reversed |= (1 << (15 - x));
                        }
                        newPixelColors[y][x] = this.pixelColors[y][15 - x];
                    }
                    newData[y] = reversed;
                }
                break;
            case 'flip-v':
                for (let y = 0; y < 16; y++) {
                    newData[y] = this.patternData[15 - y];
                    newPixelColors[y] = this.pixelColors[15 - y].slice();
                }
                break;
            default:
                return;
        }

        this.patternData = newData;
        this.pixelColors = newPixelColors;
        this.redrawAll();
    }

    // --- Undo ---

    saveUndo() {
        this.undoData = this.patternData.slice();
        this.undoPixelColors = this.pixelColors.map(row => row.slice());
    }

    undoPattern() {
        if (this.undoData) {
            const tempData = this.patternData.slice();
            const tempColors = this.pixelColors.map(row => row.slice());
            this.patternData = this.undoData.slice();
            this.pixelColors = this.undoPixelColors
                ? this.undoPixelColors.map(row => row.slice())
                : this.createEmptyPixelColors();
            this.undoData = tempData;
            this.undoPixelColors = tempColors;
            this.redrawAll();
        }
    }

    // --- 読込・入替 ---

    showLoadDialog() {
        // パターン一覧をモーダル的に表示
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.3); z-index: 100; display: flex; align-items: center; justify-content: center;';

        const dialog = document.createElement('div');
        dialog.style.cssText = 'background: #dedede; border: 2px outset #c0c0c0; padding: 8px;';

        const title = document.createElement('div');
        title.textContent = 'パターン読込';
        title.style.cssText = 'font-weight: bold; margin-bottom: 4px; font-size: 11px;';
        dialog.appendChild(title);

        const grid = document.createElement('div');
        grid.className = 'pattern-load-grid';

        if (typeof DEFAULT_PATTERNS !== 'undefined') {
            for (let i = 0; i < DEFAULT_PATTERNS.length; i++) {
                // カスタムパターンがあれば上書き
                const customPat = this.localCustomPatterns && this.localCustomPatterns[i];
                const pat = customPat || DEFAULT_PATTERNS[i];
                const cell = document.createElement('div');
                cell.className = 'pattern-load-cell';
                cell.title = `パターン ${i}`;

                if (pat.type === 'solid') {
                    cell.style.background = pat.color;
                } else if (pat.type === 'pattern') {
                    const canvas = createPatternPreviewCanvas(pat, 16, '#000000');
                    cell.style.background = `url(${canvas.toDataURL()})`;
                    cell.style.backgroundSize = '16px 16px';
                }

                cell.addEventListener('click', () => {
                    if (pat.type === 'pattern') {
                        this.saveUndo();
                        // カスタムパターンにpixelColorsがあればそれを使用（可変サイズは16×16に展開）
                        if (pat.pixelColors) {
                            this.pixelColors = this.expandPixelColorsTo16x16(pat.pixelColors);
                            this.patternData = this.generateRowMasksFromPixelColors(this.pixelColors);
                        } else {
                            this.patternData = pat.data ? pat.data.slice() : new Array(16).fill(0);
                            this.initPixelColorsFromData('#000000');
                        }
                        this.loadedData = this.patternData.slice();
                        this.loadedPixelColors = this.pixelColors.map(row => row.slice());
                        this.currentPatternId = i;
                        this.redrawAll();
                    } else if (pat.type === 'solid') {
                        // ソリッドパターンは全面塗りつぶし
                        this.saveUndo();
                        this.patternData = new Array(16).fill(65535);
                        this.initPixelColorsFromData('#000000');
                        this.loadedData = this.patternData.slice();
                        this.loadedPixelColors = this.pixelColors.map(row => row.slice());
                        this.currentPatternId = i;
                        this.redrawAll();
                    }
                    document.body.removeChild(overlay);
                });

                grid.appendChild(cell);
            }
        }

        dialog.appendChild(grid);

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '閉じる';
        closeBtn.className = 'action-btn';
        closeBtn.style.marginTop = '4px';
        closeBtn.addEventListener('click', () => {
            document.body.removeChild(overlay);
        });
        dialog.appendChild(closeBtn);

        overlay.appendChild(dialog);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                document.body.removeChild(overlay);
            }
        });
        document.body.appendChild(overlay);
    }

    replacePattern() {
        // 現在の編集パターンを親のパターンテーブルに適用
        this.saveUndo();
        const currentData = this.patternData.slice();
        const currentColors = this.pixelColors.map(row => row.slice());

        // loadedDataを現在のデータに更新（次回の復旧基準）
        this.loadedData = currentData;
        this.loadedPixelColors = currentColors;

        // カスタムパターンをローカルにも即時更新（読込ダイアログに反映するため）
        const effectiveId = this.currentPatternId < 2 ? 2 : Math.min(this.currentPatternId, 127);
        this.localCustomPatterns[effectiveId] = {
            id: effectiveId,
            type: 'pattern',
            data: currentData,
            pixelColors: currentColors
        };

        // 現在のパターンを親エディタに通知
        this.sendToParent('pattern-replaced', {
            id: this.currentPatternId,
            data: currentData,
            pixelColors: currentColors
        });
    }

    // --- 描画 ---

    redrawAll() {
        this.drawEditGrid();
        this.drawPreview();
    }

    drawEditGrid() {
        const ctx = this.editCtx;
        const s = this.CELL_SIZE;

        ctx.clearRect(0, 0, this.editCanvas.width, this.editCanvas.height);

        // ドットを描画（各ドットの個別色を使用）
        for (let y = 0; y < 16; y++) {
            for (let x = 0; x < 16; x++) {
                const isSet = this.getPixel(x, y);
                ctx.fillStyle = isSet ? (this.pixelColors[y][x] || '#000000') : '#ffffff';
                ctx.fillRect(x * s, y * s, s, s);
            }
        }

        // グリッド線を描画（1回のstrokeでまとめて描画）
        ctx.strokeStyle = '#c0c0c0';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        for (let i = 0; i <= 16; i++) {
            ctx.moveTo(i * s, 0);
            ctx.lineTo(i * s, 16 * s);
            ctx.moveTo(0, i * s);
            ctx.lineTo(16 * s, i * s);
        }
        ctx.stroke();
    }

    drawPreview() {
        const ctx = this.previewCtx;
        ctx.clearRect(0, 0, 32, 32);

        // 背景色で塗りつぶし（固定白）
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 32, 32);

        // パターンを16×16タイルとして2×2にタイリング（各ドットの個別色を使用）
        for (let ty = 0; ty < 2; ty++) {
            for (let tx = 0; tx < 2; tx++) {
                for (let y = 0; y < 16; y++) {
                    for (let x = 0; x < 16; x++) {
                        if (this.getPixel(x, y)) {
                            ctx.fillStyle = this.pixelColors[y][x] || '#000000';
                            ctx.fillRect(tx * 16 + x, ty * 16 + y, 1, 1);
                        }
                    }
                }
            }
        }
    }

    drawRectPreview(start, end) {
        const ctx = this.editCtx;
        const s = this.CELL_SIZE;
        const x1 = Math.min(start.x, end.x);
        const y1 = Math.min(start.y, end.y);
        const x2 = Math.max(start.x, end.x);
        const y2 = Math.max(start.y, end.y);

        ctx.strokeStyle = '#0078d7';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.strokeRect(x1 * s, y1 * s, (x2 - x1 + 1) * s, (y2 - y1 + 1) * s);
        ctx.setLineDash([]);
    }

    // --- pixelColors ヘルパー ---

    createEmptyPixelColors() {
        return Array.from({ length: 16 }, () => Array(16).fill(null));
    }

    /**
     * 可変サイズのpixelColorsを16×16にタイル展開する
     * @param {string[][]} pixelColors - 可変サイズの2D色配列
     * @returns {string[][]} 16×16にタイル展開された2D色配列
     */
    expandPixelColorsTo16x16(pixelColors) {
        if (!pixelColors || pixelColors.length === 0) return this.createEmptyPixelColors();
        const srcH = pixelColors.length;
        const srcW = (pixelColors[0] && pixelColors[0].length) || 0;
        if (srcW === 0) return this.createEmptyPixelColors();
        if (srcH === 16 && srcW === 16) return pixelColors.map(row => row.slice());
        const result = this.createEmptyPixelColors();
        for (let y = 0; y < 16; y++) {
            for (let x = 0; x < 16; x++) {
                result[y][x] = pixelColors[y % srcH][x % srcW];
            }
        }
        return result;
    }

    /**
     * pixelColorsからrowMasks(16bit整数配列)を生成
     * @param {string[][]} pixelColors - 16×16の色配列
     * @returns {number[]} 16個の16bit整数
     */
    generateRowMasksFromPixelColors(pixelColors) {
        const masks = new Array(16).fill(0);
        for (let y = 0; y < 16; y++) {
            for (let x = 0; x < 16; x++) {
                if (pixelColors[y] && pixelColors[y][x] !== null && pixelColors[y][x] !== undefined) {
                    masks[y] |= (1 << (15 - x));
                }
            }
        }
        return masks;
    }

    initPixelColorsFromData(color) {
        this.pixelColors = this.createEmptyPixelColors();
        for (let y = 0; y < 16; y++) {
            for (let x = 0; x < 16; x++) {
                if (this.getPixel(x, y)) {
                    this.pixelColors[y][x] = color || '#000000';
                }
            }
        }
    }

    // --- 右クリックメニュー（親ウインドウのContextMenuManager経由） ---

    requestContextMenu(x, y) {
        // iframe座標を親ウインドウ座標に変換
        const rect = window.frameElement ? window.frameElement.getBoundingClientRect() : { left: 0, top: 0 };
        const parentX = rect.left + x;
        const parentY = rect.top + y;

        // カスタムメニュー項目を指定してコンテキストメニューを要求
        window.parent.postMessage({
            type: 'context-menu-request',
            x: parentX,
            y: parentY,
            menuItems: [
                { text: '復旧', action: 'undo' },
                { text: '全消去', action: 'clear-all' },
                { text: '全塗り', action: 'fill-all' },
                { text: '反転', action: 'invert' }
            ]
        }, '*');
    }

    handleMenuAction(action) {
        switch (action) {
            case 'undo':
                this.undoPattern();
                break;
            case 'clear-all':
                this.saveUndo();
                this.patternData = new Array(16).fill(0);
                this.pixelColors = this.createEmptyPixelColors();
                this.redrawAll();
                break;
            case 'fill-all':
                this.saveUndo();
                this.patternData = new Array(16).fill(65535);
                this.initPixelColorsFromData(this.selectedColor);
                this.redrawAll();
                break;
            case 'invert':
                this.saveUndo();
                this.patternData = this.patternData.map(v => (~v) & 0xFFFF);
                this.redrawAll();
                break;
        }
    }

    // --- 通信 ---

    sendToParent(type, data = {}) {
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: type,
                fromPatternEditor: true,
                parentWindowId: this.parentWindowId,
                ...data
            }, '*');
        }
    }

}

// パネルを初期化
const patternEditor = new PatternEditor();
