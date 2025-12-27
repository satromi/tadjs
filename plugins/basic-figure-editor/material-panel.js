/**
 * 画材選択パネル
 * basic-figure-editor の子パネルウィンドウとして動作
 * 親ウィンドウとのメッセージ通信で状態を同期
 */
class MaterialPanel {
    constructor() {
        this.parentWindowId = null;
        this.currentTool = 'pencil';
        this.brushSize = 5;
        this.currentColor = '#000000';

        this.setupMessageHandler();
        this.setupEventListeners();
        this.setupWindowDrag();
    }

    setupMessageHandler() {
        window.addEventListener('message', (event) => {
            const data = event.data;
            if (!data || !data.type) return;

            switch (data.type) {
                case 'init-child-panel':
                    this.handleInit(data);
                    break;
                case 'update-material-state':
                    this.handleUpdateState(data);
                    break;
            }
        });
    }

    handleInit(data) {
        this.parentWindowId = data.parentWindowId;

        if (data.initData) {
            if (data.initData.currentTool) {
                this.currentTool = data.initData.currentTool;
            }
            if (data.initData.brushSize) {
                this.brushSize = data.initData.brushSize;
            }
            if (data.initData.currentColor) {
                this.currentColor = data.initData.currentColor;
            }
        }

        this.updateUI();
    }

    handleUpdateState(data) {
        if (data.currentTool !== undefined) {
            this.currentTool = data.currentTool;
        }
        if (data.brushSize !== undefined) {
            this.brushSize = data.brushSize;
        }
        if (data.currentColor !== undefined) {
            this.currentColor = data.currentColor;
        }
        this.updateUI();
    }

    setupEventListeners() {
        // 画材ツールボタンのクリックイベント
        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tool = btn.dataset.materialTool;
                this.selectTool(tool);
            });
        });

        // ブラシサイズスライダー
        const brushSizeSlider = document.getElementById('brushSizeSlider');
        const brushSizeValue = document.getElementById('brushSizeValue');
        if (brushSizeSlider) {
            brushSizeSlider.addEventListener('input', () => {
                const size = parseInt(brushSizeSlider.value, 10);
                if (size >= 1 && size <= 20) {
                    this.brushSize = size;
                    // px表示を更新
                    if (brushSizeValue) {
                        brushSizeValue.textContent = size + 'px';
                    }
                    this.sendToParent('material-brush-size-changed', {
                        brushSize: this.brushSize
                    });
                }
            });
        }

        // 色選択
        const colorPicker = document.getElementById('colorPicker');
        if (colorPicker) {
            colorPicker.addEventListener('input', () => {
                this.currentColor = colorPicker.value;
                this.sendToParent('material-color-changed', {
                    color: this.currentColor
                });
            });
        }
    }

    selectTool(tool) {
        this.currentTool = tool;
        this.updateUI();

        this.sendToParent('material-tool-selected', {
            tool: tool
        });
    }

    updateUI() {
        // ツールボタンのアクティブ状態を更新
        document.querySelectorAll('.tool-btn').forEach(btn => {
            if (btn.dataset.materialTool === this.currentTool) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        // ブラシサイズスライダーを更新
        const brushSizeSlider = document.getElementById('brushSizeSlider');
        if (brushSizeSlider) {
            brushSizeSlider.value = this.brushSize;
        }

        // px表示を更新
        const brushSizeValue = document.getElementById('brushSizeValue');
        if (brushSizeValue) {
            brushSizeValue.textContent = this.brushSize + 'px';
        }

        // 色選択を更新
        const colorPicker = document.getElementById('colorPicker');
        if (colorPicker) {
            colorPicker.value = this.currentColor;
        }
    }

    sendToParent(type, data = {}) {
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: type,
                fromMaterialPanel: true,
                ...data
            }, '*');
        }
    }

    setupWindowDrag() {
        document.body.addEventListener('mousedown', (e) => {
            // ボタン、スライダー、カラーピッカー上でのクリックは除外
            if (e.target.closest('button') ||
                e.target.closest('input[type="range"]') ||
                e.target.closest('input[type="color"]') ||
                e.target.closest('.size-value')) {
                return;
            }

            // 親ウィンドウにドラッグ開始を通知
            this.sendToParent('start-drag-child-panel', {
                clientX: e.clientX,
                clientY: e.clientY
            });

            e.preventDefault();
        });
    }
}

// パネルを初期化
const materialPanel = new MaterialPanel();
