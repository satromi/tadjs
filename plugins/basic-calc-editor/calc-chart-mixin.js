/**
 * 基本表計算エディタ - グラフ（チャート）関連Mixin
 * 初期化、描画、イベント処理、コピー/ペースト、XTAD生成/読み込み
 * @module CalcChartMixin
 */
const logger = window.getLogger('CalcEditor');

export const CalcChartMixin = (Base) => class extends Base {

    /**
     * グラフ描画用Canvasを初期化
     */
    initChartCanvas() {
        this.chartCanvas = document.getElementById('chart-canvas');
        if (!this.chartCanvas) {
            return;
        }
        this.chartCtx = this.chartCanvas.getContext('2d');

        // grid-bodyのサイズに合わせる
        const gridBody = document.getElementById('grid-body');
        if (gridBody) {
            const updateCanvasSize = () => {
                const rect = gridBody.getBoundingClientRect();
                this.chartCanvas.width = rect.width;
                this.chartCanvas.height = rect.height;
                this.chartCanvas.style.width = `${rect.width}px`;
                this.chartCanvas.style.height = `${rect.height}px`;
                // 既存のグラフを再描画
                this.drawCharts();
            };

            // 初期サイズ設定
            updateCanvasSize();

            // リサイズ時にサイズを更新
            const resizeObserver = new ResizeObserver(() => {
                updateCanvasSize();
            });
            resizeObserver.observe(gridBody);
        }

        // グラフCanvasのイベントリスナー設定
        this.setupChartCanvasEvents();

        // グラフCanvasのpointer-events動的制御を設定
        this.setupChartPointerEventsControl();
    }

    /**
     * グラフCanvas用イベントリスナーを設定
     */
    setupChartCanvasEvents() {
        if (!this.chartCanvas) return;

        // マウスダウン: グラフ選択・ドラッグ開始（左クリックのみ）
        this.chartCanvas.addEventListener('mousedown', (e) => {
            // 右クリックは無視（contextmenuイベントで処理）
            if (e.button !== 0) return;
            // grid-body基準の座標に統一（スクロール考慮）
            const coords = this.getChartCoordinates(e);
            this.handleChartMouseDown(coords.x, coords.y, e);
        });

        // 右クリック: コンテキストメニュー表示
        this.chartCanvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            // grid-body基準の座標に統一（スクロール考慮）
            const coords = this.getChartCoordinates(e);
            // クリック位置のグラフを選択（セル選択を解除）
            const chart = this.getChartAt(coords.x, coords.y);
            if (chart) {
                this.selectChart(chart);
            }
            // 親にコンテキストメニューを要求（座標変換あり）
            this.showContextMenu(e.clientX, e.clientY);
        });

        // マウス移動: グラフドラッグ・リサイズ
        this.chartCanvas.addEventListener('mousemove', (e) => {
            // grid-body基準の座標に統一（スクロール考慮）
            const coords = this.getChartCoordinates(e);
            this.handleChartMouseMove(coords.x, coords.y, e);
        });

        // マウスアップ: ドラッグ・リサイズ終了
        this.chartCanvas.addEventListener('mouseup', (e) => {
            this.handleChartMouseUp(e);
        });

        // マウスリーブ: ドラッグ・リサイズ終了
        this.chartCanvas.addEventListener('mouseleave', (e) => {
            this.handleChartMouseUp(e);
        });

        // キーダウン: Delete キーでグラフ削除
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Delete' && this.selectedChart) {
                this.deleteSelectedChart();
            }
        });
    }

    /**
     * グラフCanvasのpointer-eventsを動的に制御するmousemoveハンドラを設定
     * グラフ上にマウスがある時のみpointer-events: autoに切り替え
     */
    setupChartPointerEventsControl() {
        const grid = document.getElementById('spreadsheet-grid');
        if (!grid || !this.chartCanvas) return;

        grid.addEventListener('mousemove', (e) => {
            // ドラッグ・リサイズ中は常にauto
            if (this.isDraggingChart || this.isResizingChart) {
                this.chartCanvas.style.pointerEvents = 'auto';
                return;
            }

            // グラフがなければnoneのまま
            if (this.charts.length === 0) {
                this.chartCanvas.style.pointerEvents = 'none';
                return;
            }

            // マウス位置を計算（スクロール考慮）
            const gridBody = document.getElementById('grid-body');
            const gridRect = gridBody.getBoundingClientRect();
            const scrollContainer = document.querySelector('.plugin-content');
            const scrollLeft = scrollContainer ? scrollContainer.scrollLeft : 0;
            const scrollTop = scrollContainer ? scrollContainer.scrollTop : 0;

            const x = e.clientX - gridRect.left + scrollLeft;
            const y = e.clientY - gridRect.top + scrollTop;

            // グラフ上にあるかチェック
            const chart = this.getChartAt(x, y);
            if (chart) {
                this.chartCanvas.style.pointerEvents = 'auto';
            } else {
                this.chartCanvas.style.pointerEvents = 'none';
            }
        });
    }

    /**
     * グラフマウスダウン処理
     */
    handleChartMouseDown(x, y, e) {
        // 選択中のグラフがある場合、リサイズハンドルをチェック
        if (this.selectedChart) {
            const handle = this.getResizeHandleAt(x, y, this.selectedChart);
            if (handle) {
                this.isResizingChart = true;
                this.resizeHandle = handle;
                e.preventDefault();
                return;
            }
        }

        // クリック位置のグラフを検索
        const chart = this.getChartAt(x, y);
        if (chart) {
            // グラフを選択（セル選択を解除）
            this.selectChart(chart);
            this.isDraggingChart = true;
            this.chartDragOffset = {
                x: x - chart.x,
                y: y - chart.y
            };
            e.preventDefault();
        } else {
            // グラフ外クリックで選択解除
            if (this.selectedChart) {
                this.deselectChart();
            }
        }
    }

    /**
     * グラフマウス移動処理
     */
    handleChartMouseMove(x, y, e) {
        if (this.isDraggingChart && this.selectedChart) {
            // ドラッグ中: グラフ位置を更新
            this.selectedChart.x = x - this.chartDragOffset.x;
            this.selectedChart.y = y - this.chartDragOffset.y;
            this.drawCharts();
            this.isModified = true;
        } else if (this.isResizingChart && this.selectedChart) {
            // リサイズ中: グラフサイズを更新
            const minSize = 50;
            const newWidth = Math.max(minSize, x - this.selectedChart.x);
            const newHeight = Math.max(minSize, y - this.selectedChart.y);
            this.selectedChart.width = newWidth;
            this.selectedChart.height = newHeight;
            this.drawCharts();
            this.isModified = true;
        } else {
            // カーソル形状の更新
            this.updateChartCursor(x, y);
        }
    }

    /**
     * グラフマウスアップ処理
     */
    handleChartMouseUp(e) {
        this.isDraggingChart = false;
        this.isResizingChart = false;
        this.chartDragOffset = null;
        this.resizeHandle = null;
    }

    /**
     * マウスイベントからグラフ座標（grid-body基準、スクロール考慮）を取得
     * @param {MouseEvent} e - マウスイベント
     * @returns {{x: number, y: number}} グラフ座標
     */
    getChartCoordinates(e) {
        const gridBody = document.getElementById('grid-body');
        const gridRect = gridBody.getBoundingClientRect();
        const scrollContainer = document.querySelector('.plugin-content');
        const scrollLeft = scrollContainer ? scrollContainer.scrollLeft : 0;
        const scrollTop = scrollContainer ? scrollContainer.scrollTop : 0;
        return {
            x: e.clientX - gridRect.left + scrollLeft,
            y: e.clientY - gridRect.top + scrollTop
        };
    }

    /**
     * 指定座標にあるグラフを取得
     */
    getChartAt(x, y) {
        // 後に追加されたグラフを優先（逆順検索）
        for (let i = this.charts.length - 1; i >= 0; i--) {
            const chart = this.charts[i];
            if (x >= chart.x && x <= chart.x + chart.width &&
                y >= chart.y && y <= chart.y + chart.height) {
                return chart;
            }
        }
        return null;
    }

    /**
     * リサイズハンドル（右下）をチェック
     */
    getResizeHandleAt(x, y, chart) {
        const handleSize = 8;
        const handleX = chart.x + chart.width - handleSize;
        const handleY = chart.y + chart.height - handleSize;
        if (x >= handleX && x <= handleX + handleSize * 2 &&
            y >= handleY && y <= handleY + handleSize * 2) {
            return 'se'; // 右下ハンドル
        }
        return null;
    }

    /**
     * グラフカーソル形状を更新
     */
    updateChartCursor(x, y) {
        if (!this.chartCanvas) return;

        // 選択中のグラフのリサイズハンドルをチェック
        if (this.selectedChart) {
            const handle = this.getResizeHandleAt(x, y, this.selectedChart);
            if (handle) {
                this.chartCanvas.style.cursor = 'se-resize';
                return;
            }
        }

        // グラフ上にカーソルがあるかチェック
        const chart = this.getChartAt(x, y);
        if (chart) {
            this.chartCanvas.style.cursor = 'move';
        } else {
            this.chartCanvas.style.cursor = 'default';
        }
    }

    /**
     * 選択中のグラフを削除
     */
    deleteSelectedChart() {
        if (!this.selectedChart) return;

        const index = this.charts.indexOf(this.selectedChart);
        if (index !== -1) {
            this.charts.splice(index, 1);
            this.selectedChart = null;
            this.drawCharts();
            this.isModified = true;
        }
    }

    /**
     * グラフ選択を解除
     */
    deselectChart() {
        if (!this.selectedChart) {
            return;
        }

        this.selectedChart = null;
        this.drawCharts();
    }

    /**
     * グラフを選択し、セル選択を解除
     * @param {Object} chart - 選択するグラフ
     */
    selectChart(chart) {
        if (!chart) return;

        // セル選択を解除
        this.clearSelection();
        this.selectedCell = null;
        this.selectionRange = null;

        // グラフを選択
        this.selectedChart = chart;
        this.drawCharts();
    }

    /**
     * 再描画（用紙枠とグラフを再描画）
     */
    redraw() {
        this.drawCharts();
    }

    /**
     * 全グラフを描画
     */
    drawCharts() {
        if (!this.chartCtx || !this.chartCanvas) return;

        // キャンバスをクリア
        this.chartCtx.clearRect(0, 0, this.chartCanvas.width, this.chartCanvas.height);

        // 用紙枠を描画（グラフの下に描画）
        this.drawPaperFrame();

        // 各グラフを描画
        for (const chart of this.charts) {
            this.drawChart(chart);
        }

        // 選択枠を描画
        if (this.selectedChart) {
            this.drawChartSelection(this.selectedChart);
        }
    }

    /**
     * 用紙枠（ページ境界線）を描画
     */
    drawPaperFrame() {
        if (!this.paperFrameVisible) return;
        if (!this.chartCtx || !this.chartCanvas) return;

        // PaperSizeが未初期化なら初期化
        if (!this.paperSize) {
            this.initPaperSize();
        }

        const ctx = this.chartCtx;

        // mm → px 変換（96dpi）
        const mmToPx = (mm) => mm * 96 / 25.4;

        // 用紙サイズ（px）- 余白を除いた印刷可能領域
        const paperWidthPx = mmToPx(this.paperSize.widthMm - this.paperSize.leftMm - this.paperSize.rightMm);
        const paperHeightPx = mmToPx(this.paperSize.lengthMm - this.paperSize.topMm - this.paperSize.bottomMm);

        // グリッド全体のサイズを計算
        const totalWidth = this.getTotalColumnWidth();
        const totalHeight = this.getTotalRowHeight();

        // スクロールオフセット
        const grid = document.getElementById('spreadsheet-grid');
        const scrollX = grid ? grid.scrollLeft : 0;
        const scrollY = grid ? grid.scrollTop : 0;

        // ページ数計算
        const numPagesX = Math.ceil(totalWidth / paperWidthPx) + 1;
        const numPagesY = Math.ceil(totalHeight / paperHeightPx) + 1;

        // 描画設定
        ctx.save();
        ctx.strokeStyle = GRAY_COLOR;
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 4]);

        // 垂直ページ境界線
        for (let i = 1; i < numPagesX; i++) {
            const x = this.rowHeaderWidth + paperWidthPx * i - scrollX;
            if (x > 0 && x < this.chartCanvas.width) {
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, this.chartCanvas.height);
                ctx.stroke();
            }
        }

        // 水平ページ境界線
        for (let i = 1; i < numPagesY; i++) {
            const y = this.colHeaderHeight + paperHeightPx * i - scrollY;
            if (y > 0 && y < this.chartCanvas.height) {
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(this.chartCanvas.width, y);
                ctx.stroke();
            }
        }

        ctx.restore();
    }

    /**
     * グリッド全体の列幅合計を取得
     */
    getTotalColumnWidth() {
        let total = 0;
        for (let col = 1; col <= this.currentMaxCol; col++) {
            total += this.getColumnWidth(col);
        }
        return total;
    }

    /**
     * グリッド全体の行高合計を取得
     */
    getTotalRowHeight() {
        let total = 0;
        for (let row = 1; row <= this.currentMaxRow; row++) {
            total += this.getRowHeight(row);
        }
        return total;
    }

    /**
     * 個別のグラフを描画
     */
    drawChart(chart) {
        if (chart.chartType === 'clustered-bar') {
            this.drawClusteredBarChart(chart);
        } else if (chart.chartType === 'stacked-bar') {
            this.drawStackedBarChart(chart);
        } else if (chart.chartType === 'line') {
            this.drawLineChart(chart);
        } else if (chart.chartType === 'stacked-line') {
            this.drawStackedLineChart(chart);
        }
    }

    /**
     * 集合縦棒グラフを描画
     * XTADから読み込んだelements配列がある場合はそれを使用、
     * ない場合はdataから計算して描画
     */
    drawClusteredBarChart(chart) {
        const ctx = this.chartCtx;
        const { x, y, width, height, data, elements } = chart;

        // 背景を白で塗りつぶし
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x, y, width, height);

        // 枠線
        ctx.strokeStyle = GRAY_COLOR;
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, width, height);

        // XTADから読み込んだ要素がある場合はそれを使用
        if (elements && elements.length > 0) {
            this.drawChartElements(chart);
            return;
        }

        // 以下は新規グラフ作成時（elementsがない場合）の処理
        if (!data || !data.labels || data.labels.length === 0) {
            ctx.fillStyle = GRAY_COLOR;
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('データなし', x + width / 2, y + height / 2);
            return;
        }

        const padding = 30;
        const chartArea = {
            x: x + padding,
            y: y + padding,
            width: width - padding * 2,
            height: height - padding * 2
        };

        // 最大値を計算
        let maxValue = 0;
        for (const series of data.series) {
            for (const value of series.values) {
                if (value > maxValue) maxValue = value;
            }
        }
        if (maxValue === 0) maxValue = 1;

        // バーの描画
        const numLabels = data.labels.length;
        const numSeries = data.series.length;
        const groupWidth = chartArea.width / numLabels;
        const barWidth = (groupWidth * 0.8) / numSeries;
        const barGap = groupWidth * 0.1;

        for (let labelIdx = 0; labelIdx < numLabels; labelIdx++) {
            for (let seriesIdx = 0; seriesIdx < numSeries; seriesIdx++) {
                const value = data.series[seriesIdx].values[labelIdx] || 0;
                const barHeight = (value / maxValue) * chartArea.height;
                const barX = chartArea.x + groupWidth * labelIdx + barGap + barWidth * seriesIdx;
                const barY = chartArea.y + chartArea.height - barHeight;

                ctx.fillStyle = this.chartColors[seriesIdx % this.chartColors.length];
                ctx.fillRect(barX, barY, barWidth, barHeight);
            }
        }

        // X軸ラベル
        ctx.fillStyle = '#000000';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        for (let i = 0; i < numLabels; i++) {
            const labelX = chartArea.x + groupWidth * i + groupWidth / 2;
            const labelY = chartArea.y + chartArea.height + 15;
            ctx.fillText(data.labels[i], labelX, labelY);
        }
    }

    /**
     * 積上縦棒グラフを描画
     * 各ラベル内で系列の値を縦に積み上げる
     */
    drawStackedBarChart(chart) {
        const ctx = this.chartCtx;
        const { x, y, width, height, data, elements } = chart;

        // 背景を白で塗りつぶし
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x, y, width, height);

        // 枠線
        ctx.strokeStyle = GRAY_COLOR;
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, width, height);

        // XTADから読み込んだ要素がある場合はそれを使用
        if (elements && elements.length > 0) {
            this.drawChartElements(chart);
            return;
        }

        // 以下は新規グラフ作成時（elementsがない場合）の処理
        if (!data || !data.labels || data.labels.length === 0) {
            ctx.fillStyle = GRAY_COLOR;
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('データなし', x + width / 2, y + height / 2);
            return;
        }

        const padding = 30;
        const chartArea = {
            x: x + padding,
            y: y + padding,
            width: width - padding * 2,
            height: height - padding * 2
        };

        // 各ラベルの積上げ合計の最大値を計算
        let maxTotal = 0;
        const numLabels = data.labels.length;
        const numSeries = data.series.length;

        for (let labelIdx = 0; labelIdx < numLabels; labelIdx++) {
            let total = 0;
            for (let seriesIdx = 0; seriesIdx < numSeries; seriesIdx++) {
                total += data.series[seriesIdx].values[labelIdx] || 0;
            }
            if (total > maxTotal) maxTotal = total;
        }
        if (maxTotal === 0) maxTotal = 1;

        // バーの描画パラメータ
        const groupWidth = chartArea.width / numLabels;
        const barWidth = groupWidth * 0.6;
        const barX_offset = (groupWidth - barWidth) / 2;

        // 各ラベルで積み上げバーを描画
        for (let labelIdx = 0; labelIdx < numLabels; labelIdx++) {
            const barX = chartArea.x + groupWidth * labelIdx + barX_offset;
            let currentY = chartArea.y + chartArea.height; // 底から開始

            for (let seriesIdx = 0; seriesIdx < numSeries; seriesIdx++) {
                const value = data.series[seriesIdx].values[labelIdx] || 0;
                const segmentHeight = (value / maxTotal) * chartArea.height;
                currentY -= segmentHeight;

                ctx.fillStyle = this.chartColors[seriesIdx % this.chartColors.length];
                ctx.fillRect(barX, currentY, barWidth, segmentHeight);
            }
        }

        // X軸ラベル
        ctx.fillStyle = '#000000';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        for (let i = 0; i < numLabels; i++) {
            const labelX = chartArea.x + groupWidth * i + groupWidth / 2;
            const labelY = chartArea.y + chartArea.height + 15;
            ctx.fillText(data.labels[i], labelX, labelY);
        }
    }

    /**
     * 折れ線グラフを描画
     */
    drawLineChart(chart) {
        const ctx = this.chartCtx;
        const { x, y, width, height, data, elements } = chart;

        // 背景を白で塗りつぶし
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x, y, width, height);

        // 枠線
        ctx.strokeStyle = GRAY_COLOR;
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, width, height);

        // XTADから読み込んだ要素がある場合はそれを使用
        if (elements && elements.length > 0) {
            this.drawChartElements(chart);
            return;
        }

        // 以下は新規グラフ作成時（elementsがない場合）の処理
        if (!data || !data.labels || data.labels.length === 0) {
            ctx.fillStyle = GRAY_COLOR;
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('データなし', x + width / 2, y + height / 2);
            return;
        }

        const padding = 30;
        const chartArea = {
            x: x + padding,
            y: y + padding,
            width: width - padding * 2,
            height: height - padding * 2
        };

        // 最大値を計算
        let maxValue = 0;
        for (const series of data.series) {
            for (const value of series.values) {
                if (value > maxValue) maxValue = value;
            }
        }
        if (maxValue === 0) maxValue = 1;

        const numLabels = data.labels.length;
        const numSeries = data.series.length;
        const pointSpacing = chartArea.width / (numLabels > 1 ? numLabels - 1 : 1);

        // 各系列の折れ線を描画
        for (let seriesIdx = 0; seriesIdx < numSeries; seriesIdx++) {
            const color = this.chartColors[seriesIdx % this.chartColors.length];
            const points = [];

            // ポイントを計算
            for (let labelIdx = 0; labelIdx < numLabels; labelIdx++) {
                const value = data.series[seriesIdx].values[labelIdx] || 0;
                const pointX = chartArea.x + (numLabels > 1 ? pointSpacing * labelIdx : chartArea.width / 2);
                const pointY = chartArea.y + chartArea.height - (value / maxValue) * chartArea.height;
                points.push({ x: pointX, y: pointY });
            }

            // 線を描画
            if (points.length > 1) {
                ctx.beginPath();
                ctx.strokeStyle = color;
                ctx.lineWidth = 2;
                ctx.moveTo(points[0].x, points[0].y);
                for (let i = 1; i < points.length; i++) {
                    ctx.lineTo(points[i].x, points[i].y);
                }
                ctx.stroke();
            }

            // データ点を描画
            ctx.fillStyle = color;
            for (const point of points) {
                ctx.beginPath();
                ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // X軸ラベル
        ctx.fillStyle = '#000000';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        for (let i = 0; i < numLabels; i++) {
            const labelX = chartArea.x + (numLabels > 1 ? pointSpacing * i : chartArea.width / 2);
            const labelY = chartArea.y + chartArea.height + 15;
            ctx.fillText(data.labels[i], labelX, labelY);
        }
    }

    /**
     * 積上折線グラフを描画
     * 各系列の値を累積して折れ線を描画
     */
    drawStackedLineChart(chart) {
        const ctx = this.chartCtx;
        const { x, y, width, height, data, elements } = chart;

        // 背景を白で塗りつぶし
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x, y, width, height);

        // 枠線
        ctx.strokeStyle = GRAY_COLOR;
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, width, height);

        // XTADから読み込んだ要素がある場合はそれを使用
        if (elements && elements.length > 0) {
            this.drawChartElements(chart);
            return;
        }

        // 以下は新規グラフ作成時（elementsがない場合）の処理
        if (!data || !data.labels || data.labels.length === 0) {
            ctx.fillStyle = GRAY_COLOR;
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('データなし', x + width / 2, y + height / 2);
            return;
        }

        const padding = 30;
        const chartArea = {
            x: x + padding,
            y: y + padding,
            width: width - padding * 2,
            height: height - padding * 2
        };

        const numLabels = data.labels.length;
        const numSeries = data.series.length;

        // 各ラベルでの累積最大値を計算
        let maxTotal = 0;
        for (let labelIdx = 0; labelIdx < numLabels; labelIdx++) {
            let total = 0;
            for (let seriesIdx = 0; seriesIdx < numSeries; seriesIdx++) {
                total += data.series[seriesIdx].values[labelIdx] || 0;
            }
            if (total > maxTotal) maxTotal = total;
        }
        if (maxTotal === 0) maxTotal = 1;

        const pointSpacing = chartArea.width / (numLabels > 1 ? numLabels - 1 : 1);

        // 各系列の累積値を追跡
        const cumulativeValues = new Array(numLabels).fill(0);

        // 各系列の折れ線を描画（累積）
        for (let seriesIdx = 0; seriesIdx < numSeries; seriesIdx++) {
            const color = this.chartColors[seriesIdx % this.chartColors.length];
            const points = [];

            // ポイントを計算（累積値で計算）
            for (let labelIdx = 0; labelIdx < numLabels; labelIdx++) {
                const value = data.series[seriesIdx].values[labelIdx] || 0;
                cumulativeValues[labelIdx] += value;
                const currentCumulative = cumulativeValues[labelIdx];

                const pointX = chartArea.x + (numLabels > 1 ? pointSpacing * labelIdx : chartArea.width / 2);
                const pointY = chartArea.y + chartArea.height - (currentCumulative / maxTotal) * chartArea.height;
                points.push({ x: pointX, y: pointY });
            }

            // 線を描画
            if (points.length > 1) {
                ctx.beginPath();
                ctx.strokeStyle = color;
                ctx.lineWidth = 2;
                ctx.moveTo(points[0].x, points[0].y);
                for (let i = 1; i < points.length; i++) {
                    ctx.lineTo(points[i].x, points[i].y);
                }
                ctx.stroke();
            }

            // データ点を描画
            ctx.fillStyle = color;
            for (const point of points) {
                ctx.beginPath();
                ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // X軸ラベル
        ctx.fillStyle = '#000000';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        for (let i = 0; i < numLabels; i++) {
            const labelX = chartArea.x + (numLabels > 1 ? pointSpacing * i : chartArea.width / 2);
            const labelY = chartArea.y + chartArea.height + 15;
            ctx.fillText(data.labels[i], labelX, labelY);
        }
    }

    /**
     * XTADから読み込んだ要素を描画（rect, text, polyline, circle）
     */
    drawChartElements(chart) {
        const ctx = this.chartCtx;
        const { x, y, elements } = chart;

        if (!elements) return;

        // zIndex順に描画（ソート済み）
        for (const elem of elements) {
            if (elem.type === 'rect') {
                // 矩形描画
                ctx.fillStyle = elem.fillC || GRAY_COLOR;
                ctx.fillRect(x + elem.x, y + elem.y, elem.w, elem.h);
                if (elem.bdC) {
                    ctx.strokeStyle = elem.bdC;
                    ctx.lineWidth = 1;
                    ctx.strokeRect(x + elem.x, y + elem.y, elem.w, elem.h);
                }
            } else if (elem.type === 'text') {
                // テキスト描画
                ctx.fillStyle = elem.color || DEFAULT_FRCOL;
                ctx.font = `${elem.fontSize || 10}px ${elem.fontFace || 'sans-serif'}`;
                ctx.textAlign = elem.align || 'left';
                ctx.textBaseline = 'top';

                // テキストのX座標をalignに応じて調整
                let textX = x + elem.x;
                if (elem.align === 'center') {
                    textX = x + elem.x + elem.w / 2;
                } else if (elem.align === 'right') {
                    textX = x + elem.x + elem.w;
                }

                ctx.fillText(elem.text, textX, y + elem.y);
            } else if (elem.type === 'polyline') {
                // 折れ線描画
                if (elem.points && elem.points.length > 0) {
                    ctx.beginPath();
                    ctx.strokeStyle = elem.stroke || DEFAULT_FRCOL;
                    ctx.lineWidth = elem.strokeWidth || 2;
                    ctx.moveTo(x + elem.points[0].x, y + elem.points[0].y);
                    for (let i = 1; i < elem.points.length; i++) {
                        ctx.lineTo(x + elem.points[i].x, y + elem.points[i].y);
                    }
                    ctx.stroke();
                }
            } else if (elem.type === 'circle') {
                // 円描画
                ctx.beginPath();
                ctx.fillStyle = elem.fillC || DEFAULT_FRCOL;
                ctx.arc(x + elem.cx, y + elem.cy, elem.r, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    /**
     * グラフ選択枠を描画
     */
    drawChartSelection(chart) {
        const ctx = this.chartCtx;
        const { x, y, width, height } = chart;

        // 選択枠
        ctx.strokeStyle = '#0066cc';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 3]);
        ctx.strokeRect(x - 1, y - 1, width + 2, height + 2);
        ctx.setLineDash([]);

        // リサイズハンドル（右下）
        const handleSize = 8;
        ctx.fillStyle = '#0066cc';
        ctx.fillRect(x + width - handleSize, y + height - handleSize, handleSize, handleSize);
    }

    /**
     * グラフを挿入
     * @param {string} chartType - グラフタイプ（'clustered-bar'など）
     */
    insertChart(chartType) {
        // 選択範囲からデータを取得
        const dataRange = this.getSelectedRange();

        // セル未選択の場合はキャンセル
        if (!dataRange) {
            return;
        }

        const chartData = this.getChartDataFromRange(dataRange);

        // データがない場合（系列が0、またはラベルがすべて空）はキャンセル
        if (chartData.series.length === 0 ||
            chartData.labels.every(label => label === '')) {
            return;
        }

        // グラフの初期位置（選択範囲の右下、または固定位置）
        let chartX = 50;
        let chartY = 50;
        if (dataRange) {
            // 選択範囲の右に配置
            const endCell = document.querySelector(
                `.cell[data-row="${dataRange.startRow}"][data-col="${dataRange.endCol}"]`
            );
            if (endCell) {
                const rect = endCell.getBoundingClientRect();
                const gridBody = document.getElementById('grid-body');
                const gridRect = gridBody.getBoundingClientRect();
                chartX = rect.right - gridRect.left + 20;
                chartY = rect.top - gridRect.top;
            }
        }

        // 新しいグラフオブジェクトを作成
        const chart = {
            id: `chart_${Date.now()}`,
            chartType: chartType,
            x: chartX,
            y: chartY,
            width: 200,
            height: 200,
            dataRange: dataRange ? `${this.colToLetter(dataRange.startCol)}${dataRange.startRow}:${this.colToLetter(dataRange.endCol)}${dataRange.endRow}` : null,
            data: chartData
        };

        // グラフ配列に追加
        this.charts.push(chart);

        // 選択状態にする（セル選択を解除）
        this.selectChart(chart);

        // 変更フラグを立てる
        this.isModified = true;
    }

    /**
     * 選択範囲を取得
     * @returns {Object|null} 選択範囲 { startRow, startCol, endRow, endCol } or null
     */
    getSelectedRange() {
        // selectedCellがなければnullを返す
        if (!this.selectedCell) return null;

        // selectedCellは { col, row } オブジェクト
        const startRow = this.selectedCell.row;
        const startCol = this.selectedCell.col;

        // 値が無効な場合
        if (startRow === undefined || startCol === undefined ||
            isNaN(startRow) || isNaN(startCol)) {
            return null;
        }

        // 範囲選択がある場合
        if (this.selectionRange) {
            return {
                startRow: this.selectionRange.startRow,
                startCol: this.selectionRange.startCol,
                endRow: this.selectionRange.endRow,
                endCol: this.selectionRange.endCol
            };
        }

        // 単一セル選択
        return {
            startRow: startRow,
            startCol: startCol,
            endRow: startRow,
            endCol: startCol
        };
    }

    /**
     * 選択範囲からグラフデータを取得
     * @param {Object} range - 選択範囲 { startRow, startCol, endRow, endCol }
     * @returns {Object} グラフデータ { labels: string[], series: { name: string, values: number[] }[] }
     */
    getChartDataFromRange(range) {
        if (!range) {
            return { labels: [], series: [] };
        }

        const labels = [];
        const series = [];

        // 1列目をラベル、2列目以降を系列として扱う
        for (let row = range.startRow; row <= range.endRow; row++) {
            const labelKey = `${range.startCol},${row}`;
            const labelValue = this.cells.get(labelKey);
            labels.push(labelValue?.displayValue || labelValue?.value || '');
        }

        // 2列目以降を系列として追加
        for (let col = range.startCol + 1; col <= range.endCol; col++) {
            const seriesData = {
                name: this.colToLetter(col),
                values: []
            };

            for (let row = range.startRow; row <= range.endRow; row++) {
                const cellKey = this.getCellKey(col, row);
                const cellValue = this.cells.get(cellKey);
                const numValue = parseFloat(cellValue?.displayValue || cellValue?.value || 0);
                seriesData.values.push(isNaN(numValue) ? 0 : numValue);
            }

            series.push(seriesData);
        }

        return { labels, series };
    }

    // ========== コピー・ペースト系 ==========

    /**
     * 選択中のグラフをクリップボードにコピー
     * グラフをCanvas領域から画像として取得し、システムクリップボードとTADjs内部クリップボードに設定
     */
    async copyChart() {
        if (!this.selectedChart) {
            this.setStatus('グラフが選択されていません');
            return;
        }

        const chart = this.selectedChart;

        // 1. グラフ領域を一時Canvasに描画
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = chart.width;
        tempCanvas.height = chart.height;
        const tempCtx = tempCanvas.getContext('2d');

        // 2. 現在のchartCanvasからグラフ領域を切り出し
        tempCtx.drawImage(
            this.chartCanvas,
            chart.x, chart.y, chart.width, chart.height,  // ソース
            0, 0, chart.width, chart.height               // 出力先
        );

        // 3. DataURLに変換
        const dataUrl = tempCanvas.toDataURL('image/png');

        // 4. システムクリップボードに画像として書き込み（外部アプリへの貼り付け用）
        try {
            const blob = await new Promise((resolve) => {
                tempCanvas.toBlob(resolve, 'image/png');
            });
            if (blob) {
                await navigator.clipboard.write([
                    new ClipboardItem({ 'image/png': blob })
                ]);
            }
        } catch (e) {
            // システムクリップボードへの書き込み失敗は無視（セキュリティ制限等）
        }

        // 5. グラフをxmlTAD形式の図形セグメントに変換してグローバルクリップボードに設定
        const xmlTad = this.convertChartToXmlTad(chart);
        this.setFigureSegmentClipboard(xmlTad, {
            width: chart.width,
            height: chart.height
        });

        // 6. ローカルクリップボードにもグラフデータを保存（同一ウィンドウ内貼り付け用）
        this.clipboard = {
            type: 'chart',
            data: JSON.parse(JSON.stringify(chart))
        };

        this.setStatus('グラフをコピーしました');
    }

    /**
     * クリップボードからグラフを貼り付け
     * @returns {boolean} 貼り付けに成功したかどうか
     */
    pasteChart() {
        if (!this.clipboard || this.clipboard.type !== 'chart') {
            return false;
        }

        const chartData = JSON.parse(JSON.stringify(this.clipboard.data));

        // 座標をオフセット（20ピクセルずらして重ならないようにする）
        chartData.x += 20;
        chartData.y += 20;

        // 新しいグラフとして追加
        this.charts.push(chartData);

        // グラフを再描画
        this.drawCharts();

        // 選択状態に設定
        this.selectedChart = chartData;
        this.clearSelection();

        // クリップボードの座標も更新（連続ペースト用）
        this.clipboard.data.x += 20;
        this.clipboard.data.y += 20;

        this.isModified = true;
        this.setStatus('グラフを貼り付けました');
        return true;
    }

    /**
     * グラフを図形グループ構造に変換（コピー用）
     * @param {Object} chart - グラフオブジェクト
     * @returns {Object} 図形グループオブジェクト
     */
    convertChartToGroup(chart) {
        const shapes = [];

        // グラフ種別に応じて描画要素を生成
        if (chart.elements && chart.elements.length > 0) {
            // XTADから読み込んだ要素を使用
            for (const elem of chart.elements) {
                const shape = this.convertElementToShape(elem, chart.x, chart.y);
                if (shape) shapes.push(shape);
            }
        } else if (chart.data && chart.data.labels && chart.data.labels.length > 0) {
            // データから描画要素を生成
            shapes.push(...this.generateChartShapesForCopy(chart));
        }

        // グループオブジェクトを作成
        return {
            type: 'group',
            shapes: shapes,
            startX: chart.x,
            startY: chart.y,
            endX: chart.x + chart.width,
            endY: chart.y + chart.height,
            // グラフメタデータも保持
            chartMeta: {
                chartType: chart.chartType,
                dataRange: chart.dataRange
            }
        };
    }

    /**
     * グラフを図形セグメントxmlTADに変換
     * @param {Object} chart - グラフオブジェクト
     * @returns {string} xmlTAD文字列
     */
    convertChartToXmlTad(chart) {
        const group = this.convertChartToGroup(chart);
        const shapes = group.shapes || [];
        const width = chart.width;
        const height = chart.height;

        const xmlParts = ['<tad version="1.0" encoding="UTF-8">\r\n'];
        xmlParts.push('<figure>\r\n');
        xmlParts.push(`<figView top="0" left="0" right="${width}" bottom="${height}"/>\r\n`);
        xmlParts.push(`<figDraw top="0" left="0" right="${width}" bottom="${height}"/>\r\n`);
        xmlParts.push('<figScale hunit="-72" vunit="-72"/>\r\n');

        // mask/pattern定義を出力（ラウンドトリップ保全）
        if ((chart.masks && chart.masks.length > 0) || (chart.patterns && chart.patterns.length > 0)) {
            xmlParts.push('<patterns>\r\n');
            if (chart.masks) {
                for (const m of chart.masks) {
                    xmlParts.push(`<mask id="${m.id}" type="${m.type}" width="${m.width}" height="${m.height}" data="${m.data}" />\r\n`);
                }
            }
            if (chart.patterns) {
                for (const p of chart.patterns) {
                    xmlParts.push(`<pattern id="${p.id}" type="${p.type}" width="${p.width}" height="${p.height}" ncol="${p.ncol}" fgcolors="${p.fgcolors}" bgcolor="${p.bgcolor}" masks="${p.masks}" />\r\n`);
                }
            }
            xmlParts.push('</patterns>\r\n');
        }

        // グラフ全体を<group>で囲み、figure-editorでグループとして扱えるようにする
        xmlParts.push(`<group left="0" top="0" right="${width}" bottom="${height}">\r\n`);
        for (const shape of shapes) {
            this.shapeToXmlTadElement(shape, chart.x, chart.y, xmlParts);
        }
        xmlParts.push('</group>\r\n');

        xmlParts.push('</figure>\r\n');
        xmlParts.push('</tad>');
        return xmlParts.join('');
    }

    /**
     * 内部図形オブジェクトをxmlTAD要素文字列に変換
     * @param {Object} shape - 図形オブジェクト
     * @param {number} originX - グラフ原点X（座標オフセット除去用）
     * @param {number} originY - グラフ原点Y（座標オフセット除去用）
     * @param {Array} xmlParts - 出力配列
     */
    shapeToXmlTadElement(shape, originX, originY, xmlParts) {
        const lineType = shape.lineType || 0;
        const lineWidth = shape.lineWidth || 0;
        const zIndex = shape.zIndex || 0;

        // l_pat/f_patを算出（TAD仕様準拠: 0=透明/なし, 1-127=パターンID）
        const l_pat = shape.linePatternId || 0;
        const f_pat = shape.fillPatternId || 0;

        if (shape.type === 'rect') {
            const left = Math.round(shape.startX - originX);
            const top = Math.round(shape.startY - originY);
            const right = Math.round(shape.endX - originX);
            const bottom = Math.round(shape.endY - originY);
            xmlParts.push(`<rect lineType="${lineType}" lineWidth="${lineWidth}" l_pat="${l_pat}" f_pat="${f_pat}" angle="0" left="${left}" top="${top}" right="${right}" bottom="${bottom}" zIndex="${zIndex}"/>\r\n`);
        } else if (shape.type === 'ellipse') {
            const cx = Math.round(((shape.startX + shape.endX) / 2) - originX);
            const cy = Math.round(((shape.startY + shape.endY) / 2) - originY);
            const rx = Math.round(Math.abs(shape.endX - shape.startX) / 2);
            const ry = Math.round(Math.abs(shape.endY - shape.startY) / 2);
            xmlParts.push(`<ellipse lineType="${lineType}" lineWidth="${lineWidth}" l_pat="${l_pat}" f_pat="${f_pat}" angle="0" cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" zIndex="${zIndex}"/>\r\n`);
        } else if (shape.type === 'document') {
            const left = Math.round(shape.startX - originX);
            const top = Math.round(shape.startY - originY);
            const right = Math.round(shape.endX - originX);
            const bottom = Math.round(shape.endY - originY);
            const fontSize = shape.fontSize || 10;
            const fontFace = shape.fontFamily || 'sans-serif';
            const textColor = shape.textColor || '#000000';
            const textAlign = shape.textAlign || 'left';
            const content = this.escapeXml(shape.content || '');
            // figure-editorのparseDocumentElementが期待する形式で出力
            xmlParts.push(`<document>\r\n`);
            xmlParts.push(`<docView viewleft="${left}" viewtop="${top}" viewright="${right}" viewbottom="${bottom}"/>\r\n`);
            xmlParts.push(`<docDraw drawleft="${left}" drawtop="${top}" drawright="${right}" drawbottom="${bottom}"/>\r\n`);
            xmlParts.push('<docScale hunit="-72" vunit="-72"/>\r\n');
            xmlParts.push(`<text lang="0" bpat="0" zIndex="${zIndex}"/>\r\n`);
            xmlParts.push(`<font size="${fontSize}"/>\r\n`);
            xmlParts.push(`<font face="${fontFace}"/>\r\n`);
            xmlParts.push(`<font color="${textColor}"/>\r\n`);
            if (textAlign !== 'left') {
                xmlParts.push(`<text align="${textAlign}"/>\r\n`);
            }
            xmlParts.push(`${content}\r\n`);
            xmlParts.push('</document>\r\n');
        } else if (shape.type === 'polyline') {
            if (shape.points && shape.points.length >= 2) {
                const pointsStr = shape.points.map(p =>
                    `${Math.round(p.x - originX)},${Math.round(p.y - originY)}`
                ).join(' ');
                xmlParts.push(`<polyline lineType="${lineType}" lineWidth="${shape.lineWidth || 2}" l_pat="${l_pat}" f_pat="${f_pat}" points="${pointsStr}" zIndex="${zIndex}"/>\r\n`);
            }
        }
    }

    /**
     * グラフ要素を図形オブジェクトに変換
     * @param {Object} elem - グラフ要素
     * @param {number} offsetX - X座標オフセット
     * @param {number} offsetY - Y座標オフセット
     * @returns {Object|null} 図形オブジェクト
     */
    convertElementToShape(elem, offsetX, offsetY) {
        if (elem.type === 'rect') {
            const fillColor = elem.fillC || 'transparent';
            const hasBorder = !!elem.bdC;
            const l_pat = parseInt(elem.l_pat) || 0;
            const f_pat = parseInt(elem.f_pat) || 0;
            return {
                type: 'rect',
                startX: offsetX + elem.x,
                startY: offsetY + elem.y,
                endX: offsetX + elem.x + elem.w,
                endY: offsetY + elem.y + elem.h,
                fillColor: fillColor,
                strokeColor: elem.bdC || fillColor,
                lineWidth: hasBorder ? 1 : 0,
                linePatternId: l_pat,
                fillPatternId: f_pat,
                zIndex: elem.zIndex || 0
            };
        } else if (elem.type === 'text') {
            const fontSize = elem.fontSize || 10;
            const fontFace = elem.fontFace || 'sans-serif';
            return {
                type: 'document',
                startX: offsetX + elem.x,
                startY: offsetY + elem.y,
                endX: offsetX + elem.x + (elem.w || 100),
                endY: offsetY + elem.y + (elem.h || 20),
                content: elem.text || '',
                fontSize: fontSize,
                fontFamily: fontFace,
                textColor: elem.color || DEFAULT_FRCOL,
                textAlign: elem.align || 'center',  // 元の align を引き継ぐ（デフォルトは center）
                fillColor: 'transparent',
                strokeColor: 'transparent',
                lineWidth: 0,
                decorations: { bold: false, italic: false, underline: false, strikethrough: false },
                zIndex: elem.zIndex || 0
            };
        } else if (elem.type === 'polyline') {
            // 折れ線 - polylineタイプのまま変換
            if (!elem.points || elem.points.length < 2) return null;
            const offsetPoints = elem.points.map(p => ({
                x: offsetX + p.x,
                y: offsetY + p.y
            }));
            const l_pat = parseInt(elem.l_pat) || 0;
            return {
                type: 'polyline',
                points: offsetPoints,
                strokeColor: elem.stroke || DEFAULT_FRCOL,
                lineWidth: elem.strokeWidth || 2,
                linePatternId: l_pat,
                zIndex: elem.zIndex || 0
            };
        } else if (elem.type === 'circle') {
            // 円（データポイント） - ellipseタイプに変換
            const r = elem.r || 4;
            const color = elem.fillC || elem.fill || DEFAULT_FRCOL;
            const l_pat = parseInt(elem.l_pat) || 0;
            const f_pat = parseInt(elem.f_pat) || 0;
            return {
                type: 'ellipse',
                startX: offsetX + elem.cx - r,
                startY: offsetY + elem.cy - r,
                endX: offsetX + elem.cx + r,
                endY: offsetY + elem.cy + r,
                fillColor: color,
                strokeColor: color,
                lineWidth: 0,
                linePatternId: l_pat,
                fillPatternId: f_pat,
                zIndex: elem.zIndex || 0
            };
        }
        return null;
    }

    /**
     * グラフデータから図形配列を生成（コピー用）
     * @param {Object} chart - グラフオブジェクト
     * @returns {Array} 図形配列
     */
    generateChartShapesForCopy(chart) {
        const shapes = [];
        const { x, y, width, height, chartType } = chart;

        // 背景
        shapes.push({
            type: 'rect',
            startX: x,
            startY: y,
            endX: x + width,
            endY: y + height,
            fillColor: DEFAULT_BGCOL,
            strokeColor: GRAY_COLOR,
            fillPatternId: typeof findSolidColorPatternId === 'function' ? findSolidColorPatternId(DEFAULT_BGCOL) : 0,
            linePatternId: typeof findSolidColorPatternId === 'function' ? findSolidColorPatternId(GRAY_COLOR) : 0,
            strokeWidth: 1,
            zIndex: 0
        });

        // グラフ種別に応じた描画要素を生成
        if (chartType === 'clustered-bar' || chartType === 'stacked-bar') {
            shapes.push(...this.generateBarShapesForCopy(chart));
        } else if (chartType === 'line' || chartType === 'stacked-line') {
            shapes.push(...this.generateLineShapesForCopy(chart));
        }

        return shapes;
    }

    /**
     * 棒グラフの図形配列を生成（コピー用）
     * @param {Object} chart - グラフオブジェクト
     * @returns {Array} 図形配列
     */
    generateBarShapesForCopy(chart) {
        const shapes = [];
        const { x, y, width, height, chartType, data } = chart;
        const padding = 30;

        if (!data || !data.labels || !data.series) return shapes;

        const chartArea = {
            x: padding,
            y: padding,
            width: width - padding * 2,
            height: height - padding * 2
        };

        // 最大値を計算
        let maxValue = 0;
        if (chartType === 'stacked-bar') {
            for (let i = 0; i < data.labels.length; i++) {
                let sum = 0;
                for (const series of data.series) {
                    sum += series.values[i] || 0;
                }
                if (sum > maxValue) maxValue = sum;
            }
        } else {
            for (const series of data.series) {
                for (const value of series.values) {
                    if (value > maxValue) maxValue = value;
                }
            }
        }
        if (maxValue === 0) maxValue = 1;

        const numLabels = data.labels.length;
        const numSeries = data.series.length;
        const groupWidth = chartArea.width / numLabels;

        let zIndex = 100;

        if (chartType === 'stacked-bar') {
            // 積み上げ棒グラフ
            const barWidth = groupWidth * 0.6;
            for (let labelIdx = 0; labelIdx < numLabels; labelIdx++) {
                let yOffset = 0;
                for (let seriesIdx = 0; seriesIdx < numSeries; seriesIdx++) {
                    const value = data.series[seriesIdx].values[labelIdx] || 0;
                    const barHeight = (value / maxValue) * chartArea.height;
                    const barX = x + chartArea.x + groupWidth * labelIdx + (groupWidth - barWidth) / 2;
                    const barY = y + chartArea.y + chartArea.height - yOffset - barHeight;
                    const fillColor = this.chartColors[seriesIdx % this.chartColors.length];

                    shapes.push({
                        type: 'rect',
                        startX: barX,
                        startY: barY,
                        endX: barX + barWidth,
                        endY: barY + barHeight,
                        fillColor: fillColor,
                        strokeColor: fillColor,
                        fillPatternId: typeof findSolidColorPatternId === 'function' ? findSolidColorPatternId(fillColor) : 0,
                        linePatternId: typeof findSolidColorPatternId === 'function' ? findSolidColorPatternId(fillColor) : 0,
                        lineWidth: 0,
                        zIndex: zIndex--
                    });

                    yOffset += barHeight;
                }
            }
        } else {
            // 集合縦棒グラフ
            const barWidth = (groupWidth * 0.8) / numSeries;
            const barGap = groupWidth * 0.1;
            for (let labelIdx = 0; labelIdx < numLabels; labelIdx++) {
                for (let seriesIdx = 0; seriesIdx < numSeries; seriesIdx++) {
                    const value = data.series[seriesIdx].values[labelIdx] || 0;
                    const barHeight = (value / maxValue) * chartArea.height;
                    const barX = x + chartArea.x + groupWidth * labelIdx + barGap + barWidth * seriesIdx;
                    const barY = y + chartArea.y + chartArea.height - barHeight;
                    const fillColor = this.chartColors[seriesIdx % this.chartColors.length];

                    shapes.push({
                        type: 'rect',
                        startX: barX,
                        startY: barY,
                        endX: barX + barWidth,
                        endY: barY + barHeight,
                        fillColor: fillColor,
                        strokeColor: fillColor,
                        fillPatternId: typeof findSolidColorPatternId === 'function' ? findSolidColorPatternId(fillColor) : 0,
                        linePatternId: typeof findSolidColorPatternId === 'function' ? findSolidColorPatternId(fillColor) : 0,
                        lineWidth: 0,
                        zIndex: zIndex--
                    });
                }
            }
        }

        // X軸ラベル（document形式で生成）
        const labelY = y + chartArea.y + chartArea.height + 5;
        for (let labelIdx = 0; labelIdx < numLabels; labelIdx++) {
            const labelX = x + chartArea.x + groupWidth * labelIdx + groupWidth / 2;  // 中央座標
            const labelWidth = groupWidth;
            shapes.push({
                type: 'document',
                startX: labelX - labelWidth / 2,
                startY: labelY,
                endX: labelX + labelWidth / 2,
                endY: labelY + 15,
                content: data.labels[labelIdx] || '',
                fontSize: 10,
                fontFamily: 'sans-serif',
                textColor: DEFAULT_CHCOL,
                textAlign: 'center',  // 中央揃えを指定
                fillColor: 'transparent',
                strokeColor: 'transparent',
                lineWidth: 0,
                decorations: { bold: false, italic: false, underline: false, strikethrough: false },
                zIndex: 0
            });
        }

        return shapes;
    }

    /**
     * 折れ線グラフの図形配列を生成（コピー用）
     * @param {Object} chart - グラフオブジェクト
     * @returns {Array} 図形配列
     */
    generateLineShapesForCopy(chart) {
        const shapes = [];
        const { x, y, width, height, chartType, data } = chart;
        const padding = 30;

        if (!data || !data.labels || !data.series) return shapes;

        const chartArea = {
            x: padding,
            y: padding,
            width: width - padding * 2,
            height: height - padding * 2
        };

        // 最大値を計算
        let maxValue = 0;
        if (chartType === 'stacked-line') {
            for (let i = 0; i < data.labels.length; i++) {
                let sum = 0;
                for (const series of data.series) {
                    sum += series.values[i] || 0;
                }
                if (sum > maxValue) maxValue = sum;
            }
        } else {
            for (const series of data.series) {
                for (const value of series.values) {
                    if (value > maxValue) maxValue = value;
                }
            }
        }
        if (maxValue === 0) maxValue = 1;

        const numLabels = data.labels.length;
        const numSeries = data.series.length;
        const stepX = chartArea.width / (numLabels - 1 || 1);

        let zIndex = 200;  // 折れ線用の開始zIndex

        // 折れ線（polyline）を生成
        for (let seriesIdx = 0; seriesIdx < numSeries; seriesIdx++) {
            const strokeColor = this.chartColors[seriesIdx % this.chartColors.length];
            let cumulativeValues = new Array(numLabels).fill(0);

            if (chartType === 'stacked-line' && seriesIdx > 0) {
                for (let i = 0; i < seriesIdx; i++) {
                    for (let j = 0; j < numLabels; j++) {
                        cumulativeValues[j] += data.series[i].values[j] || 0;
                    }
                }
            }

            // ポイント座標を計算
            const points = [];
            for (let labelIdx = 0; labelIdx < numLabels; labelIdx++) {
                const value = data.series[seriesIdx].values[labelIdx] || 0;
                const totalValue = chartType === 'stacked-line' ? cumulativeValues[labelIdx] + value : value;
                const pointX = x + chartArea.x + stepX * labelIdx;
                const pointY = y + chartArea.y + chartArea.height - (totalValue / maxValue) * chartArea.height;
                points.push({ x: pointX, y: pointY });
            }

            // polylineとして1つのシェイプを生成
            if (points.length >= 2) {
                shapes.push({
                    type: 'polyline',
                    points: points,
                    strokeColor: strokeColor,
                    linePatternId: typeof findSolidColorPatternId === 'function' ? findSolidColorPatternId(strokeColor) : 0,
                    lineWidth: 2,
                    zIndex: zIndex--
                });
            }
        }

        zIndex = 100;  // データポイント用のzIndex

        // データポイント（小さな円）
        for (let seriesIdx = 0; seriesIdx < numSeries; seriesIdx++) {
            const fillColor = this.chartColors[seriesIdx % this.chartColors.length];
            let cumulativeValues = new Array(numLabels).fill(0);

            if (chartType === 'stacked-line' && seriesIdx > 0) {
                for (let i = 0; i < seriesIdx; i++) {
                    for (let j = 0; j < numLabels; j++) {
                        cumulativeValues[j] += data.series[i].values[j] || 0;
                    }
                }
            }

            for (let labelIdx = 0; labelIdx < numLabels; labelIdx++) {
                const value = data.series[seriesIdx].values[labelIdx] || 0;
                const totalValue = chartType === 'stacked-line' ? cumulativeValues[labelIdx] + value : value;
                const pointX = x + chartArea.x + stepX * labelIdx;
                const pointY = y + chartArea.y + chartArea.height - (totalValue / maxValue) * chartArea.height;
                const pointSize = 4;

                shapes.push({
                    type: 'ellipse',
                    startX: pointX - pointSize / 2,
                    startY: pointY - pointSize / 2,
                    endX: pointX + pointSize / 2,
                    endY: pointY + pointSize / 2,
                    fillColor: fillColor,
                    strokeColor: fillColor,
                    fillPatternId: typeof findSolidColorPatternId === 'function' ? findSolidColorPatternId(fillColor) : 0,
                    linePatternId: typeof findSolidColorPatternId === 'function' ? findSolidColorPatternId(fillColor) : 0,
                    lineWidth: 0,
                    zIndex: zIndex--
                });
            }
        }

        // X軸ラベル（document形式で生成）
        const labelY = y + chartArea.y + chartArea.height + 5;
        for (let labelIdx = 0; labelIdx < numLabels; labelIdx++) {
            const labelX = x + chartArea.x + stepX * labelIdx;  // 中央座標
            const labelWidth = stepX;
            shapes.push({
                type: 'document',
                startX: labelX - labelWidth / 2,
                startY: labelY,
                endX: labelX + labelWidth / 2,
                endY: labelY + 15,
                content: data.labels[labelIdx] || '',
                fontSize: 10,
                fontFamily: 'sans-serif',
                textColor: DEFAULT_CHCOL,
                textAlign: 'center',  // 中央揃えを指定
                fillColor: 'transparent',
                strokeColor: 'transparent',
                lineWidth: 0,
                decorations: { bold: false, italic: false, underline: false, strikethrough: false },
                zIndex: 0
            });
        }

        return shapes;
    }

    // ========== XTAD生成系 ==========

    /**
     * ソリッドカラーに対応するパターンIDを取得（デフォルト or カスタム生成）
     * @param {string} color - 色（#rrggbb形式）
     * @param {Object} colorPatternMap - 色→パターンIDのマップ（累積更新）
     * @param {Array} generatedPatterns - 自動生成されたパターン定義の配列（累積更新）
     * @returns {number} パターンID
     */
    getChartFillPatternId(color, colorPatternMap, generatedPatterns) {
        if (!color || color === 'transparent') return 0;
        // 既にマッピング済みならそれを返す
        if (colorPatternMap[color] !== undefined) return colorPatternMap[color];
        // DEFAULT_PATTERNSから検索
        if (typeof findSolidColorPatternId === 'function') {
            const defaultId = findSolidColorPatternId(color);
            if (defaultId > 0) {
                colorPatternMap[color] = defaultId;
                return defaultId;
            }
        }
        // 見つからない場合: カスタムパターンとして生成（ID 128+）
        let nextId = 128;
        const usedIds = new Set(generatedPatterns.map(p => p.id));
        while (usedIds.has(nextId)) nextId++;
        generatedPatterns.push({
            id: nextId, type: 0, width: 4, height: 4,
            ncol: 1, fgcolors: color, bgcolor: 'transparent', masks: '7'
        });
        colorPatternMap[color] = nextId;
        return nextId;
    }

    generateChartXtad(chart) {
        const { x, y, width, height, chartType, dataRange, data } = chart;

        // 1. groupタグ（絶対座標）
        const left = Math.round(x);
        const top = Math.round(y);
        const right = Math.round(x + width);
        const bottom = Math.round(y + height);

        let xtad = `<group left="${left}" top="${top}" right="${right}" bottom="${bottom}">\n`;

        // 2. calcタグ（グラフメタデータ）
        xtad += `<calc chartType="${chartType}"`;
        if (dataRange) {
            xtad += ` dataRange="${dataRange}"`;
        }
        xtad += `>\n`;

        // 3. figureタグ（描画要素のコンテナ）
        xtad += '<figure>\n';

        // figView, figDraw（グループ内相対座標: 0,0からwidth,height）
        xtad += `<figView top="0" left="0" right="${Math.round(width)}" bottom="${Math.round(height)}"/>\n`;
        xtad += `<figDraw top="0" left="0" right="${Math.round(width)}" bottom="${Math.round(height)}"/>\n`;
        xtad += '<figScale hunit="-72" vunit="-72"/>\n';

        // グラフ描画で使用する色のパターンID事前構築
        const colorPatternMap = {};
        const generatedPatterns = [];

        // 背景色（#ffffff）のパターンID
        const bgPatternId = this.getChartFillPatternId('#ffffff', colorPatternMap, generatedPatterns);

        // グラフ内で使用する色のパターンIDを事前取得
        if (data && data.series) {
            for (let i = 0; i < data.series.length; i++) {
                const color = this.chartColors[i % this.chartColors.length];
                this.getChartFillPatternId(color, colorPatternMap, generatedPatterns);
            }
        }

        // mask/pattern定義を出力（ラウンドトリップ保全 + 自動生成分）
        const hasMasks = chart.masks && chart.masks.length > 0;
        const hasPatterns = (chart.patterns && chart.patterns.length > 0) || generatedPatterns.length > 0;
        if (hasMasks || hasPatterns) {
            xtad += '<patterns>\n';
            if (chart.masks) {
                for (const m of chart.masks) {
                    xtad += `<mask id="${m.id}" type="${m.type}" width="${m.width}" height="${m.height}" data="${m.data}" />\n`;
                }
            }
            if (chart.patterns) {
                for (const p of chart.patterns) {
                    xtad += `<pattern id="${p.id}" type="${p.type}" width="${p.width}" height="${p.height}" ncol="${p.ncol}" fgcolors="${p.fgcolors}" bgcolor="${p.bgcolor}" masks="${p.masks}" />\n`;
                }
            }
            for (const p of generatedPatterns) {
                xtad += `<pattern id="${p.id}" type="${p.type}" width="${p.width}" height="${p.height}" ncol="${p.ncol}" fgcolors="${p.fgcolors}" bgcolor="${p.bgcolor}" masks="${p.masks}" />\n`;
            }
            xtad += '</patterns>\n';
        }

        // 背景rect
        xtad += `<rect round="0" lineType="0" lineWidth="1" l_pat="0" f_pat="${bgPatternId}" angle="0" `;
        xtad += `left="0" top="0" right="${Math.round(width)}" bottom="${Math.round(height)}" `;
        xtad += `zIndex="0"/>\n`;

        // グラフ種別に応じた描画要素を生成
        if (data && data.labels && data.labels.length > 0) {
            if (chartType === 'clustered-bar') {
                xtad += this.generateClusteredBarChartElements(width, height, data, colorPatternMap);
            } else if (chartType === 'stacked-bar') {
                xtad += this.generateStackedBarChartElements(width, height, data, colorPatternMap);
            } else if (chartType === 'line') {
                xtad += this.generateLineChartElements(width, height, data, colorPatternMap);
            } else if (chartType === 'stacked-line') {
                xtad += this.generateStackedLineChartElements(width, height, data, colorPatternMap);
            }
        }

        xtad += '</figure>\n';
        xtad += '</calc>\n';
        xtad += '</group>\n';

        return xtad;
    }

    /**
     * 集合縦棒グラフの描画要素（rect, text）をXTAD形式で生成
     * drawClusteredBarChartと同じロジックで座標を計算
     */
    generateClusteredBarChartElements(width, height, data, colorPatternMap) {
        let xtad = '';
        const padding = 30;

        const chartArea = {
            x: padding,
            y: padding,
            width: width - padding * 2,
            height: height - padding * 2
        };

        // 最大値を計算
        let maxValue = 0;
        for (const series of data.series) {
            for (const value of series.values) {
                if (value > maxValue) maxValue = value;
            }
        }
        if (maxValue === 0) maxValue = 1;

        // バーの描画パラメータ
        const numLabels = data.labels.length;
        const numSeries = data.series.length;
        const groupWidth = chartArea.width / numLabels;
        const barWidth = (groupWidth * 0.8) / numSeries;
        const barGap = groupWidth * 0.1;

        let zIndex = 100;

        // 各バーのrect要素を生成
        for (let labelIdx = 0; labelIdx < numLabels; labelIdx++) {
            for (let seriesIdx = 0; seriesIdx < numSeries; seriesIdx++) {
                const value = data.series[seriesIdx].values[labelIdx] || 0;
                const barHeight = (value / maxValue) * chartArea.height;
                const barX = chartArea.x + groupWidth * labelIdx + barGap + barWidth * seriesIdx;
                const barY = chartArea.y + chartArea.height - barHeight;
                const fillColor = this.chartColors[seriesIdx % this.chartColors.length];
                const f_pat = (colorPatternMap && colorPatternMap[fillColor] !== undefined) ? colorPatternMap[fillColor] : 0;

                const rectRight = Math.round(barX + barWidth);
                const rectBottom = Math.round(barY + barHeight);
                xtad += `<rect round="0" lineType="0" lineWidth="0" l_pat="0" f_pat="${f_pat}" angle="0" `;
                xtad += `left="${Math.round(barX)}" top="${Math.round(barY)}" `;
                xtad += `right="${rectRight}" bottom="${rectBottom}" `;
                xtad += `zIndex="${zIndex--}"/>\n`;
            }
        }

        // X軸ラベル（各ラベルをdocument/textとして出力）
        const labelY = chartArea.y + chartArea.height + 5;
        for (let labelIdx = 0; labelIdx < numLabels; labelIdx++) {
            const labelX = chartArea.x + groupWidth * labelIdx + groupWidth / 2;
            const labelText = this.escapeXml(data.labels[labelIdx] || '');
            const labelWidth = groupWidth;

            const left = Math.round(labelX - labelWidth / 2);
            const top = Math.round(labelY);
            const right = left + Math.round(labelWidth);
            const bottom = top + 15;
            const currentZIndex = zIndex--;
            xtad += '<document>\n';
            xtad += this.generateDocViewDrawScale(left, top, right, bottom);
            xtad += this.generateTextElement({ zIndex: currentZIndex });
            xtad += '<font size="10"/>\n';
            xtad += '<font face="sans-serif"/>\n';
            xtad += '<font color="#000000"/>\n';
            xtad += '<text align="center"/>\n';
            xtad += `${labelText}\n`;
            xtad += '</document>\n';
        }

        return xtad;
    }

    /**
     * 積上縦棒グラフの描画要素（rect, text）をXTAD形式で生成
     * 各ラベル内で系列の値を縦に積み上げる
     */
    generateStackedBarChartElements(width, height, data, colorPatternMap) {
        let xtad = '';
        const padding = 30;

        const chartArea = {
            x: padding,
            y: padding,
            width: width - padding * 2,
            height: height - padding * 2
        };

        // 各ラベルの積上げ合計の最大値を計算
        let maxTotal = 0;
        const numLabels = data.labels.length;
        const numSeries = data.series.length;

        for (let labelIdx = 0; labelIdx < numLabels; labelIdx++) {
            let total = 0;
            for (let seriesIdx = 0; seriesIdx < numSeries; seriesIdx++) {
                total += data.series[seriesIdx].values[labelIdx] || 0;
            }
            if (total > maxTotal) maxTotal = total;
        }
        if (maxTotal === 0) maxTotal = 1;

        // バーの描画パラメータ
        const groupWidth = chartArea.width / numLabels;
        const barWidth = groupWidth * 0.6;
        const barX_offset = (groupWidth - barWidth) / 2;

        let zIndex = 100;

        // 各ラベルで積み上げバーを生成
        for (let labelIdx = 0; labelIdx < numLabels; labelIdx++) {
            const barX = chartArea.x + groupWidth * labelIdx + barX_offset;
            let currentY = chartArea.y + chartArea.height; // 底から開始

            for (let seriesIdx = 0; seriesIdx < numSeries; seriesIdx++) {
                const value = data.series[seriesIdx].values[labelIdx] || 0;
                const segmentHeight = (value / maxTotal) * chartArea.height;
                currentY -= segmentHeight;
                const fillColor = this.chartColors[seriesIdx % this.chartColors.length];
                const f_pat = (colorPatternMap && colorPatternMap[fillColor] !== undefined) ? colorPatternMap[fillColor] : 0;

                const rectRight = Math.round(barX + barWidth);
                const rectBottom = Math.round(currentY + segmentHeight);
                xtad += `<rect round="0" lineType="0" lineWidth="0" l_pat="0" f_pat="${f_pat}" angle="0" `;
                xtad += `left="${Math.round(barX)}" top="${Math.round(currentY)}" `;
                xtad += `right="${rectRight}" bottom="${rectBottom}" `;
                xtad += `zIndex="${zIndex--}"/>\n`;
            }
        }

        // X軸ラベル
        const labelY = chartArea.y + chartArea.height + 5;
        for (let labelIdx = 0; labelIdx < numLabels; labelIdx++) {
            const labelX = chartArea.x + groupWidth * labelIdx + groupWidth / 2;
            const labelText = this.escapeXml(data.labels[labelIdx] || '');
            const labelWidth = groupWidth;

            const left = Math.round(labelX - labelWidth / 2);
            const top = Math.round(labelY);
            const right = left + Math.round(labelWidth);
            const bottom = top + 15;
            const currentZIndex = zIndex--;
            xtad += '<document>\n';
            xtad += this.generateDocViewDrawScale(left, top, right, bottom);
            xtad += this.generateTextElement({ zIndex: currentZIndex });
            xtad += '<font size="10"/>\n';
            xtad += '<font face="sans-serif"/>\n';
            xtad += '<font color="#000000"/>\n';
            xtad += '<text align="center"/>\n';
            xtad += `${labelText}\n`;
            xtad += '</document>\n';
        }

        return xtad;
    }

    /**
     * 折れ線グラフの描画要素（polyline, circle, text）をXTAD形式で生成
     */
    generateLineChartElements(width, height, data, colorPatternMap) {
        let xtad = '';
        const padding = 30;

        const chartArea = {
            x: padding,
            y: padding,
            width: width - padding * 2,
            height: height - padding * 2
        };

        // 最大値を計算
        let maxValue = 0;
        for (const series of data.series) {
            for (const value of series.values) {
                if (value > maxValue) maxValue = value;
            }
        }
        if (maxValue === 0) maxValue = 1;

        const numLabels = data.labels.length;
        const numSeries = data.series.length;
        const pointSpacing = chartArea.width / (numLabels > 1 ? numLabels - 1 : 1);

        let zIndex = 100;

        // 各系列の折れ線とデータ点を生成
        for (let seriesIdx = 0; seriesIdx < numSeries; seriesIdx++) {
            const color = this.chartColors[seriesIdx % this.chartColors.length];
            const colorPatId = (colorPatternMap && colorPatternMap[color] !== undefined) ? colorPatternMap[color] : 0;
            const points = [];

            // ポイントを計算
            for (let labelIdx = 0; labelIdx < numLabels; labelIdx++) {
                const value = data.series[seriesIdx].values[labelIdx] || 0;
                const pointX = chartArea.x + (numLabels > 1 ? pointSpacing * labelIdx : chartArea.width / 2);
                const pointY = chartArea.y + chartArea.height - (value / maxValue) * chartArea.height;
                points.push({ x: Math.round(pointX), y: Math.round(pointY) });
            }

            // polyline要素を生成（l_patで線色を指定）
            if (points.length > 1) {
                const pointsStr = points.map(p => `${p.x},${p.y}`).join(' ');
                xtad += `<polyline lineType="0" lineWidth="2" l_pat="${colorPatId}" f_pat="0" points="${pointsStr}" zIndex="${zIndex--}"/>\n`;
            }

            // ellipse要素を生成（各データ点、f_patで塗り色を指定）
            for (const point of points) {
                xtad += `<ellipse lineType="0" lineWidth="0" l_pat="0" f_pat="${colorPatId}" angle="0" cx="${point.x}" cy="${point.y}" rx="4" ry="4" zIndex="${zIndex--}"/>\n`;
            }
        }

        // X軸ラベル
        const labelY = chartArea.y + chartArea.height + 5;
        for (let labelIdx = 0; labelIdx < numLabels; labelIdx++) {
            const labelX = chartArea.x + (numLabels > 1 ? pointSpacing * labelIdx : chartArea.width / 2);
            const labelText = this.escapeXml(data.labels[labelIdx] || '');
            const labelWidth = pointSpacing > 0 ? pointSpacing : chartArea.width;

            const left = Math.round(labelX - labelWidth / 2);
            const top = Math.round(labelY);
            const right = left + Math.round(labelWidth);
            const bottom = top + 15;
            const currentZIndex = zIndex--;
            xtad += '<document>\n';
            xtad += this.generateDocViewDrawScale(left, top, right, bottom);
            xtad += this.generateTextElement({ zIndex: currentZIndex });
            xtad += '<font size="10"/>\n';
            xtad += '<font face="sans-serif"/>\n';
            xtad += '<font color="#000000"/>\n';
            xtad += '<text align="center"/>\n';
            xtad += `${labelText}\n`;
            xtad += '</document>\n';
        }

        return xtad;
    }

    /**
     * 積上折線グラフの描画要素（polyline, circle, text）をXTAD形式で生成
     * 各系列の値を累積して折れ線を描画
     */
    generateStackedLineChartElements(width, height, data, colorPatternMap) {
        let xtad = '';
        const padding = 30;

        const chartArea = {
            x: padding,
            y: padding,
            width: width - padding * 2,
            height: height - padding * 2
        };

        const numLabels = data.labels.length;
        const numSeries = data.series.length;

        // 各ラベルでの累積最大値を計算
        let maxTotal = 0;
        for (let labelIdx = 0; labelIdx < numLabels; labelIdx++) {
            let total = 0;
            for (let seriesIdx = 0; seriesIdx < numSeries; seriesIdx++) {
                total += data.series[seriesIdx].values[labelIdx] || 0;
            }
            if (total > maxTotal) maxTotal = total;
        }
        if (maxTotal === 0) maxTotal = 1;

        const pointSpacing = chartArea.width / (numLabels > 1 ? numLabels - 1 : 1);

        let zIndex = 100;

        // 各系列の累積値を追跡
        const cumulativeValues = new Array(numLabels).fill(0);

        // 各系列の折れ線とデータ点を生成（累積）
        for (let seriesIdx = 0; seriesIdx < numSeries; seriesIdx++) {
            const color = this.chartColors[seriesIdx % this.chartColors.length];
            const colorPatId = (colorPatternMap && colorPatternMap[color] !== undefined) ? colorPatternMap[color] : 0;
            const points = [];

            // ポイントを計算（累積値で計算）
            for (let labelIdx = 0; labelIdx < numLabels; labelIdx++) {
                const value = data.series[seriesIdx].values[labelIdx] || 0;
                cumulativeValues[labelIdx] += value;
                const currentCumulative = cumulativeValues[labelIdx];

                const pointX = chartArea.x + (numLabels > 1 ? pointSpacing * labelIdx : chartArea.width / 2);
                const pointY = chartArea.y + chartArea.height - (currentCumulative / maxTotal) * chartArea.height;
                points.push({ x: Math.round(pointX), y: Math.round(pointY) });
            }

            // polyline要素を生成（l_patで線色を指定）
            if (points.length > 1) {
                const pointsStr = points.map(p => `${p.x},${p.y}`).join(' ');
                xtad += `<polyline lineType="0" lineWidth="2" l_pat="${colorPatId}" f_pat="0" points="${pointsStr}" zIndex="${zIndex--}"/>\n`;
            }

            // ellipse要素を生成（各データ点、f_patで塗り色を指定）
            for (const point of points) {
                xtad += `<ellipse lineType="0" lineWidth="0" l_pat="0" f_pat="${colorPatId}" angle="0" cx="${point.x}" cy="${point.y}" rx="4" ry="4" zIndex="${zIndex--}"/>\n`;
            }
        }

        // X軸ラベル
        const labelY = chartArea.y + chartArea.height + 5;
        for (let labelIdx = 0; labelIdx < numLabels; labelIdx++) {
            const labelX = chartArea.x + (numLabels > 1 ? pointSpacing * labelIdx : chartArea.width / 2);
            const labelText = this.escapeXml(data.labels[labelIdx] || '');
            const labelWidth = pointSpacing > 0 ? pointSpacing : chartArea.width;

            const left = Math.round(labelX - labelWidth / 2);
            const top = Math.round(labelY);
            const right = left + Math.round(labelWidth);
            const bottom = top + 15;
            const currentZIndex = zIndex--;
            xtad += '<document>\n';
            xtad += this.generateDocViewDrawScale(left, top, right, bottom);
            xtad += this.generateTextElement({ zIndex: currentZIndex });
            xtad += '<font size="10"/>\n';
            xtad += '<font face="sans-serif"/>\n';
            xtad += '<font color="#000000"/>\n';
            xtad += '<text align="center"/>\n';
            xtad += `${labelText}\n`;
            xtad += '</document>\n';
        }

        return xtad;
    }

    // ========== XTAD読み込み系 ==========

    /**
     * XTADからグラフを読み込む
     * @param {string} xtadData - XTADデータ
     */
    loadChartsFromXtad(xtadData) {
        // <group><calc><figure>...</figure></calc></group> 形式
        const groupPattern = /<group\s+([^>]*)>([\s\S]*?)<\/group>/g;
        let groupMatch;

        while ((groupMatch = groupPattern.exec(xtadData)) !== null) {
            const groupAttrs = groupMatch[1];
            const groupContent = groupMatch[2];

            // <calc>タグを検索（囲みタグ形式）
            const calcMatch = /<calc\s+chartType="([^"]+)"(?:\s+dataRange="([^"]+)")?[^>]*>([\s\S]*?)<\/calc>/i.exec(groupContent);
            if (!calcMatch) {
                // <calc>がない場合は通常のグループ（グラフではない）
                continue;
            }

            // groupの位置属性を取得
            const leftMatch = /left="([^"]+)"/.exec(groupAttrs);
            const topMatch = /top="([^"]+)"/.exec(groupAttrs);
            const rightMatch = /right="([^"]+)"/.exec(groupAttrs);
            const bottomMatch = /bottom="([^"]+)"/.exec(groupAttrs);

            if (!leftMatch || !topMatch || !rightMatch || !bottomMatch) continue;

            const x = parseFloat(leftMatch[1]);
            const y = parseFloat(topMatch[1]);
            const width = parseFloat(rightMatch[1]) - x;
            const height = parseFloat(bottomMatch[1]) - y;

            const chartType = calcMatch[1];
            const dataRange = calcMatch[2] || null;
            const calcContent = calcMatch[3];

            // dataRangeからデータを取得
            let chartData = { labels: [], series: [] };
            if (dataRange) {
                const range = this.parseDataRange(dataRange);
                if (range) {
                    chartData = this.getChartDataFromRange(range);
                }
            }

            // <figure>内の図形要素をパース
            const figureMatch = /<figure>([\s\S]*?)<\/figure>/i.exec(calcContent);
            const figureContent = figureMatch ? figureMatch[1] : '';

            // mask/pattern定義を先にパース（要素パースでf_pat/l_pat解決に使用）
            const maskPatternData = figureContent ? this.parseChartMaskPatterns(figureContent) : { masks: [], patterns: [] };
            // 配列→dict変換（resolvePatternColor互換形式）
            const customPatterns = {};
            for (const pat of maskPatternData.patterns) {
                customPatterns[pat.id] = pat;
            }
            const elements = figureContent ? this.parseChartElements(figureContent, customPatterns) : [];

            // グラフオブジェクトを作成
            const chart = {
                id: `chart_${Date.now()}_${this.charts.length}`,
                chartType: chartType,
                x: x,
                y: y,
                width: width,
                height: height,
                dataRange: dataRange,
                data: chartData,
                elements: elements,
                masks: maskPatternData.masks,
                patterns: maskPatternData.patterns
            };

            this.charts.push(chart);
        }

        // グラフを描画
        if (this.charts.length > 0) {
            this.drawCharts();
        }
    }

    /**
     * figure内の描画要素（rect, document/text）をパース
     * @param {string} innerContent - figureタグ内のコンテンツ
     * @returns {Array} 描画要素の配列
     */
    parseChartElements(innerContent, customPatterns = {}) {
        const elements = [];

        // ヘルパー: タグから属性を抽出
        const getAttr = (tag, name) => {
            const match = new RegExp(`${name}="([^"]*)"`, 'i').exec(tag);
            return match ? match[1] : null;
        };

        // <rect> 要素をパース（正式形式のみ対応）
        const rectPattern = /<rect\s+[^>]+\/>/g;
        let rectMatch;
        while ((rectMatch = rectPattern.exec(innerContent)) !== null) {
            const tag = rectMatch[0];

            // 正式形式（left/top/right/bottom）
            const left = getAttr(tag, 'left');
            const top = getAttr(tag, 'top');
            const right = getAttr(tag, 'right');
            const bottom = getAttr(tag, 'bottom');

            if (left !== null && top !== null && right !== null && bottom !== null) {
                const f_pat = parseInt(getAttr(tag, 'f_pat')) || 0;
                const l_pat = parseInt(getAttr(tag, 'l_pat')) || 0;
                // f_pat/l_patからresolvePatternColorで色を解決（figure-editorと共通パターン）
                const fillC = (f_pat >= 1 && typeof resolvePatternColor === 'function')
                    ? (resolvePatternColor(f_pat, customPatterns) || getAttr(tag, 'fillColor') || GRAY_COLOR)
                    : (getAttr(tag, 'fillColor') || GRAY_COLOR);
                const bdC = (l_pat >= 1 && typeof resolvePatternColor === 'function')
                    ? (resolvePatternColor(l_pat, customPatterns) || getAttr(tag, 'strokeColor'))
                    : getAttr(tag, 'strokeColor');
                elements.push({
                    type: 'rect',
                    x: parseFloat(left),
                    y: parseFloat(top),
                    w: parseFloat(right) - parseFloat(left),
                    h: parseFloat(bottom) - parseFloat(top),
                    bdC: bdC,
                    fillC: fillC,
                    l_pat: l_pat,
                    f_pat: f_pat,
                    zIndex: parseInt(getAttr(tag, 'zIndex')) || 0
                });
            }
        }

        // <document><docView>...</document> 要素をパース（標準形式）
        const docPattern = /<document>([\s\S]*?)<\/document>/g;
        let docMatch;
        while ((docMatch = docPattern.exec(innerContent)) !== null) {
            const docContent = docMatch[1];

            // <docView> タグを抽出（標準形式）
            const docViewMatch = /<docView\s+[^>]+\/>/.exec(docContent);
            let tx, ty, tw, th;

            if (docViewMatch) {
                // 標準形式: docViewから座標を取得
                const docViewTag = docViewMatch[0];
                const viewleft = getAttr(docViewTag, 'viewleft');
                const viewtop = getAttr(docViewTag, 'viewtop');
                const viewright = getAttr(docViewTag, 'viewright');
                const viewbottom = getAttr(docViewTag, 'viewbottom');

                if (viewleft === null || viewtop === null) continue;

                tx = parseFloat(viewleft);
                ty = parseFloat(viewtop);
                tw = viewright !== null ? parseFloat(viewright) - tx : 100;
                th = viewbottom !== null ? parseFloat(viewbottom) - ty : 15;
            } else {
                // docViewがない場合はスキップ
                continue;
            }

            // <text> タグからzIndexを取得
            const textTagMatch = /<text\s+[^>]+\/>/.exec(docContent);
            let zIndex = 0;
            if (textTagMatch) {
                zIndex = parseInt(getAttr(textTagMatch[0], 'zIndex')) || 0;
            }

            // 複数の<font>タグを解析
            const fontPattern = /<font\s+[^>]+\/>/g;
            let fontMatch;
            let fontSize = 10;
            let fontFace = 'sans-serif';
            let color = DEFAULT_CHCOL;
            while ((fontMatch = fontPattern.exec(docContent)) !== null) {
                const fontTag = fontMatch[0];
                const sizeAttr = getAttr(fontTag, 'size');
                const faceAttr = getAttr(fontTag, 'face');
                const colorAttr = getAttr(fontTag, 'color');
                if (sizeAttr !== null) fontSize = parseInt(sizeAttr) || 10;
                if (faceAttr !== null) fontFace = faceAttr;
                if (colorAttr !== null) color = colorAttr;
            }

            // <text align="..."/>を解析
            let textAlign = 'center';  // デフォルト
            const textAlignPattern = /<text\s+align="([^"]+)"[^>]*\/>/;
            const textAlignMatch = textAlignPattern.exec(docContent);
            if (textAlignMatch) {
                textAlign = textAlignMatch[1];
            }

            // テキスト内容を抽出（docView、docDraw、docScale、text、fontタグ以外）
            let textContent = docContent
                .replace(/<docView[^>]*\/>/g, '')
                .replace(/<docDraw[^>]*\/>/g, '')
                .replace(/<docScale[^>]*\/>/g, '')
                .replace(/<text[^>]*\/>/g, '')
                .replace(/<font[^>]*\/>/g, '')
                .trim();
            textContent = this.unescapeXml(textContent);

            elements.push({
                type: 'text',
                x: tx,
                y: ty,
                w: tw,
                h: th,
                align: textAlign,
                zIndex: zIndex,
                fontSize: fontSize,
                fontFace: fontFace,
                color: color,
                text: textContent
            });
        }

        // <polyline> 要素をパース（折れ線グラフ用）
        const polylinePattern = /<polyline\s+[^>]+\/>/g;
        let polylineMatch;
        while ((polylineMatch = polylinePattern.exec(innerContent)) !== null) {
            const tag = polylineMatch[0];
            const pointsStr = getAttr(tag, 'points');

            if (pointsStr) {
                // "x1,y1 x2,y2 ..." 形式をパース
                const points = pointsStr.split(' ').map(p => {
                    const [x, y] = p.split(',');
                    return { x: parseFloat(x), y: parseFloat(y) };
                }).filter(p => !isNaN(p.x) && !isNaN(p.y));

                if (points.length > 0) {
                    const l_pat = parseInt(getAttr(tag, 'l_pat')) || 0;
                    // l_patからresolvePatternColorで線色を解決
                    const strokeColor = (l_pat >= 1 && typeof resolvePatternColor === 'function')
                        ? (resolvePatternColor(l_pat, customPatterns) || getAttr(tag, 'strokeColor') || DEFAULT_FRCOL)
                        : (getAttr(tag, 'strokeColor') || DEFAULT_FRCOL);
                    // lineWidth形式を優先、l_atr形式もサポート（後方互換性）
                    let strokeWidth = 1;
                    if (getAttr(tag, 'lineWidth') !== null) {
                        strokeWidth = parseInt(getAttr(tag, 'lineWidth')) || 1;
                    } else {
                        const l_atr = parseInt(getAttr(tag, 'l_atr')) || 1;
                        strokeWidth = l_atr & 0xFF;  // 下位8ビットが線幅
                    }

                    elements.push({
                        type: 'polyline',
                        points: points,
                        stroke: strokeColor,
                        strokeWidth: strokeWidth,
                        l_pat: l_pat,
                        f_pat: parseInt(getAttr(tag, 'f_pat')) || 0,
                        zIndex: parseInt(getAttr(tag, 'zIndex')) || 0
                    });
                }
            }
        }

        // <ellipse> 要素をパース（折れ線グラフのデータ点用、円はrx=ryで表現）
        const ellipsePattern = /<ellipse\s+[^>]+\/>/g;
        let ellipseMatch;
        while ((ellipseMatch = ellipsePattern.exec(innerContent)) !== null) {
            const tag = ellipseMatch[0];
            const cx = getAttr(tag, 'cx');
            const cy = getAttr(tag, 'cy');
            const rx = getAttr(tag, 'rx');
            const ry = getAttr(tag, 'ry');

            if (cx !== null && cy !== null && rx !== null) {
                const f_pat = parseInt(getAttr(tag, 'f_pat')) || 0;
                // f_patからresolvePatternColorで塗り色を解決
                const fillColor = (f_pat >= 1 && typeof resolvePatternColor === 'function')
                    ? (resolvePatternColor(f_pat, customPatterns) || getAttr(tag, 'fillColor') || DEFAULT_FRCOL)
                    : (getAttr(tag, 'fillColor') || DEFAULT_FRCOL);

                elements.push({
                    type: 'circle',
                    cx: parseFloat(cx),
                    cy: parseFloat(cy),
                    r: parseFloat(rx),  // rx=ryの円としてrxを半径に使用
                    fillC: fillColor,
                    l_pat: parseInt(getAttr(tag, 'l_pat')) || 0,
                    f_pat: f_pat,
                    zIndex: parseInt(getAttr(tag, 'zIndex')) || 0
                });
            }
        }

        // zIndex順にソート（小さい順 - 背景から前景へ描画するため）
        elements.sort((a, b) => a.zIndex - b.zIndex);

        return elements;
    }

    /**
     * figure内のmask/pattern定義をパース（ラウンドトリップ保全用）
     * @param {string} innerContent - figureタグ内のコンテンツ
     * @returns {Object} { masks: Array, patterns: Array }
     */
    parseChartMaskPatterns(innerContent) {
        const masks = [];
        const patterns = [];

        const getAttr = (tag, name) => {
            const match = new RegExp(`${name}="([^"]*)"`, 'i').exec(tag);
            return match ? match[1] : null;
        };

        // <mask> 要素をパース
        const maskPattern = /<mask\s+[^>]+\/>/g;
        let maskMatch;
        while ((maskMatch = maskPattern.exec(innerContent)) !== null) {
            const tag = maskMatch[0];
            const id = getAttr(tag, 'id');
            const type = getAttr(tag, 'type');
            const width = getAttr(tag, 'width');
            const height = getAttr(tag, 'height');
            const data = getAttr(tag, 'data');
            if (id !== null && data !== null) {
                masks.push({ id: parseInt(id), type: parseInt(type) || 0, width: parseInt(width) || 4, height: parseInt(height) || 4, data: data });
            }
        }

        // <pattern> 要素をパース
        const patternRegex = /<pattern\s+[^>]+\/>/g;
        let patternMatch;
        while ((patternMatch = patternRegex.exec(innerContent)) !== null) {
            const tag = patternMatch[0];
            const id = getAttr(tag, 'id');
            const type = getAttr(tag, 'type');
            const width = getAttr(tag, 'width');
            const height = getAttr(tag, 'height');
            const ncol = getAttr(tag, 'ncol');
            const fgcolors = getAttr(tag, 'fgcolors');
            const bgcolor = getAttr(tag, 'bgcolor');
            const patMasks = getAttr(tag, 'masks');
            if (id !== null) {
                patterns.push({ id: parseInt(id), type: parseInt(type) || 0, width: parseInt(width) || 4, height: parseInt(height) || 4, ncol: ncol, fgcolors: fgcolors || '', bgcolor: bgcolor || '', masks: patMasks || '' });
            }
        }

        return { masks, patterns };
    }

    /**
     * データ範囲文字列をパース
     * @param {string} rangeStr - 範囲文字列 (例: "A1:C5")
     * @returns {Object|null} { startRow, startCol, endRow, endCol }
     */
    parseDataRange(rangeStr) {
        const match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i.exec(rangeStr);
        if (!match) return null;

        return {
            startCol: this.letterToCol(match[1]),
            startRow: parseInt(match[2]),
            endCol: this.letterToCol(match[3]),
            endRow: parseInt(match[4])
        };
    }

    /**
     * 指定セルを参照しているグラフを更新
     * @param {number} col - 列番号
     * @param {number} row - 行番号
     */
    updateChartsForCell(col, row) {
        if (this.charts.length === 0) return;

        let needsRedraw = false;

        for (const chart of this.charts) {
            if (!chart.dataRange) continue;

            const range = this.parseDataRange(chart.dataRange);
            if (!range) continue;

            // セルがグラフの参照範囲内かチェック
            if (col >= range.startCol && col <= range.endCol &&
                row >= range.startRow && row <= range.endRow) {
                // データを再計算
                chart.data = this.getChartDataFromRange(range);
                // キャッシュされた描画要素をクリア（再計算を強制）
                chart.elements = [];
                needsRedraw = true;
            }
        }

        if (needsRedraw) {
            this.drawCharts();
        }
    }

    /**
     * 指定範囲を参照しているグラフを更新
     * @param {Object} range - { startCol, startRow, endCol, endRow }
     */
    updateChartsForRange(range) {
        if (this.charts.length === 0) return;

        let needsRedraw = false;

        for (const chart of this.charts) {
            if (!chart.dataRange) continue;

            const chartRange = this.parseDataRange(chart.dataRange);
            if (!chartRange) continue;

            // 範囲が重なっているかチェック
            if (this.rangesOverlap(range, chartRange)) {
                chart.data = this.getChartDataFromRange(chartRange);
                chart.elements = [];
                needsRedraw = true;
            }
        }

        if (needsRedraw) {
            this.drawCharts();
        }
    }

    /**
     * 2つの範囲が重なっているかチェック
     * @param {Object} range1 - { startCol, startRow, endCol, endRow }
     * @param {Object} range2 - { startCol, startRow, endCol, endRow }
     * @returns {boolean} 重なっている場合true
     */
    rangesOverlap(range1, range2) {
        return !(range1.endCol < range2.startCol ||
                 range1.startCol > range2.endCol ||
                 range1.endRow < range2.startRow ||
                 range1.startRow > range2.endRow);
    }
};
