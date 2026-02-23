/**
 * キーボードレイアウト描画エンジン
 * KLE互換JSON形式のキーボードレイアウトをDOM描画する
 */
class KeyboardRenderer {
    constructor(container) {
        this.container = container;
        this.keys = [];
        this.keyElements = {};
        this.keyUnit = 46;
        this.keyGap = 2;
        this.kanaMapping = null;
        this.totalWidth = 0;
        this.totalHeight = 0;
    }

    /**
     * KLE互換JSONをパースしてキーオブジェクト配列を生成
     * KLE回転プロパティ（r, rx, ry）をサポート
     */
    parseLayout(layoutData) {
        this.keys = [];
        const layout = layoutData.layout || layoutData;

        let currentX = 0;
        let currentY = 0;
        let currentR = 0;
        let currentRX = 0;
        let currentRY = 0;

        for (let rowIndex = 0; rowIndex < layout.length; rowIndex++) {
            const row = layout[rowIndex];
            if (!Array.isArray(row)) continue;

            currentX = currentRX;
            let currentProps = {};

            for (let i = 0; i < row.length; i++) {
                const item = row[i];

                if (typeof item === 'object' && !Array.isArray(item)) {
                    if (item.rx !== undefined || item.ry !== undefined) {
                        if (item.rx !== undefined) currentRX = item.rx;
                        if (item.ry !== undefined) currentRY = item.ry;
                        currentX = currentRX;
                        currentY = currentRY;
                    }
                    if (item.r !== undefined) currentR = item.r;
                    if (item.x !== undefined) currentX += item.x;
                    if (item.y !== undefined) currentY += item.y;
                    if (item.w !== undefined) currentProps.w = item.w;
                    if (item.h !== undefined) currentProps.h = item.h;
                    if (item.id !== undefined) currentProps.id = item.id;
                } else if (typeof item === 'string') {
                    const w = currentProps.w || 1;
                    const h = currentProps.h || 1;
                    const id = currentProps.id || null;

                    const labels = item.split('\n');

                    var absX, absY;
                    if (currentR !== 0) {
                        var localCX = currentX + w / 2;
                        var localCY = currentY + h / 2;
                        var rad = currentR * Math.PI / 180;
                        var dx = localCX - currentRX;
                        var dy = localCY - currentRY;
                        var rotCX = currentRX + dx * Math.cos(rad) - dy * Math.sin(rad);
                        var rotCY = currentRY + dx * Math.sin(rad) + dy * Math.cos(rad);
                        absX = rotCX - w / 2;
                        absY = rotCY - h / 2;
                    } else {
                        absX = currentX;
                        absY = currentY;
                    }

                    const key = {
                        id: id,
                        label: labels[labels.length > 1 ? 1 : 0] || '',
                        shiftLabel: labels.length > 1 ? labels[0] : '',
                        x: absX,
                        y: absY,
                        w: w,
                        h: h,
                        r: currentR,
                        row: rowIndex,
                        element: null
                    };

                    this.keys.push(key);
                    currentX += w;

                    currentProps = {};
                }
            }
            currentY += 1;
        }

        this._calculateBounds();
        return this.keys;
    }

    /**
     * キーボード全体のサイズを計算（回転対応）
     */
    _calculateBounds() {
        if (this.keys.length === 0) {
            this.totalWidth = 0;
            this.totalHeight = 0;
            return;
        }

        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        for (const key of this.keys) {
            if (key.r) {
                var cx = key.x + key.w / 2;
                var cy = key.y + key.h / 2;
                var hw = key.w / 2;
                var hh = key.h / 2;
                var rad = Math.abs(key.r) * Math.PI / 180;
                var rotHW = hw * Math.cos(rad) + hh * Math.sin(rad);
                var rotHH = hw * Math.sin(rad) + hh * Math.cos(rad);
                if (cx - rotHW < minX) minX = cx - rotHW;
                if (cx + rotHW > maxX) maxX = cx + rotHW;
                if (cy - rotHH < minY) minY = cy - rotHH;
                if (cy + rotHH > maxY) maxY = cy + rotHH;
            } else {
                if (key.x < minX) minX = key.x;
                if (key.x + key.w > maxX) maxX = key.x + key.w;
                if (key.y < minY) minY = key.y;
                if (key.y + key.h > maxY) maxY = key.y + key.h;
            }
        }

        for (const key of this.keys) {
            key.x -= minX;
            key.y -= minY;
        }

        this.totalWidth = maxX - minX;
        this.totalHeight = maxY - minY;
    }

    /**
     * かな入力配列データを設定
     */
    setKanaMapping(kanaMapping) {
        this.kanaMapping = kanaMapping;
    }

    /**
     * キーボードをDOM描画
     */
    render() {
        this.container.innerHTML = '';
        this.keyElements = {};

        const unit = this.keyUnit + this.keyGap;
        const pixelWidth = this.totalWidth * unit;
        const pixelHeight = this.totalHeight * unit;

        this.container.style.width = pixelWidth + 'px';
        this.container.style.height = pixelHeight + 'px';

        for (const key of this.keys) {
            const el = document.createElement('div');
            el.className = 'key';
            el.style.left = (key.x * unit) + 'px';
            el.style.top = (key.y * unit) + 'px';
            el.style.width = (key.w * unit - this.keyGap) + 'px';
            el.style.height = (key.h * unit - this.keyGap) + 'px';

            if (key.r) {
                el.style.transform = 'rotate(' + key.r + 'deg)';
                el.style.transformOrigin = 'center center';
            }

            if (key.id) {
                el.dataset.keyId = key.id;
            }

            const kana = this._getKanaForKey(key.id);
            if (kana) {
                if (kana.normal) {
                    const kanaLabel = document.createElement('div');
                    kanaLabel.className = 'kana-label';
                    kanaLabel.textContent = kana.normal;
                    el.appendChild(kanaLabel);
                }

                if (kana.leftShift || kana.rightShift) {
                    const subLabels = document.createElement('div');
                    subLabels.className = 'kana-sub-labels';

                    if (kana.leftShift) {
                        const leftSpan = document.createElement('span');
                        leftSpan.className = 'left-shift-char';
                        leftSpan.textContent = kana.leftShift;
                        subLabels.appendChild(leftSpan);
                    }
                    if (kana.rightShift) {
                        const rightSpan = document.createElement('span');
                        rightSpan.className = 'right-shift-char';
                        rightSpan.textContent = kana.rightShift;
                        subLabels.appendChild(rightSpan);
                    }
                    el.appendChild(subLabels);
                }

                if (!kana.normal && key.label) {
                    const keyLabel = document.createElement('div');
                    keyLabel.className = 'key-label';
                    keyLabel.textContent = key.label;
                    el.appendChild(keyLabel);
                }
            } else {
                const keyLabel = document.createElement('div');
                keyLabel.className = 'key-label';
                keyLabel.textContent = key.label;
                el.appendChild(keyLabel);
            }

            this.container.appendChild(el);
            key.element = el;

            if (key.id) {
                this.keyElements[key.id] = el;
            }
        }

        this._fitToContainer();
    }

    /**
     * コンテナにフィットするようスケール調整
     */
    _fitToContainer() {
        const parent = this.container.parentElement;
        if (!parent) return;

        const parentWidth = parent.clientWidth - 16;
        const parentHeight = parent.clientHeight - 16;
        const unit = this.keyUnit + this.keyGap;
        const kbWidth = this.totalWidth * unit;
        const kbHeight = this.totalHeight * unit;

        const scaleX = parentWidth / kbWidth;
        const scaleY = parentHeight / kbHeight;
        const scale = Math.min(scaleX, scaleY, 1.0);

        this.container.style.transform = 'scale(' + scale + ')';
        this.container.style.transformOrigin = 'top left';

        const scaledWidth = kbWidth * scale;
        const scaledHeight = kbHeight * scale;
        const offsetX = (parentWidth - scaledWidth) / 2;
        const offsetY = (parentHeight - scaledHeight) / 2;
        this.container.style.marginLeft = Math.max(0, offsetX) + 'px';
        this.container.style.marginTop = Math.max(0, offsetY) + 'px';
    }

    /**
     * キーIDに対応するかな文字情報を返す
     */
    _getKanaForKey(keyId) {
        if (!this.kanaMapping || !keyId) return null;
        const mapping = this.kanaMapping.mapping || this.kanaMapping;
        return mapping[keyId] || null;
    }

    /**
     * 全キーのハイライトをクリア
     */
    clearHighlights() {
        for (const key of this.keys) {
            if (key.element) {
                key.element.classList.remove(
                    'next-1', 'next-2', 'next-3', 'next-4',
                    'shift-required', 'correct-flash', 'wrong-flash'
                );
            }
        }
    }

    /**
     * 次に打つべきキーをハイライト表示
     * @param {Array} nextKeys - [{keyCode, shiftType},...] 先読みキー配列
     */
    highlightNextKeys(nextKeys) {
        this.clearHighlights();

        var highlightedKeys = {};

        for (var i = 0; i < nextKeys.length && i < 4; i++) {
            var keyInfo = nextKeys[i];
            if (!keyInfo) continue;

            if (keyInfo.isCombo && keyInfo.keys) {
                // コンボ: 全キーを同じ優先度でハイライト
                for (var ci = 0; ci < keyInfo.keys.length; ci++) {
                    var comboKeyCode = keyInfo.keys[ci];
                    var comboEl = this.keyElements[comboKeyCode];
                    if (comboEl && !highlightedKeys[comboKeyCode]) {
                        comboEl.classList.add('next-' + (i + 1));
                        highlightedKeys[comboKeyCode] = true;
                    }
                }
            } else {
                // 単一キー
                var el = this.keyElements[keyInfo.keyCode];
                if (el && !highlightedKeys[keyInfo.keyCode]) {
                    el.classList.add('next-' + (i + 1));
                    highlightedKeys[keyInfo.keyCode] = true;
                }

                if (keyInfo.shiftType === 'left') {
                    var shiftEl = this.keyElements['ShiftLeft'];
                    if (shiftEl && i === 0) {
                        shiftEl.classList.add('shift-required');
                    }
                } else if (keyInfo.shiftType === 'right') {
                    var shiftEl2 = this.keyElements['ShiftRight'];
                    if (shiftEl2 && i === 0) {
                        shiftEl2.classList.add('shift-required');
                    }
                }
            }
        }
    }

    /**
     * 正解フラッシュ表示
     */
    showCorrectFlash(keyCode) {
        if (Array.isArray(keyCode)) {
            for (var i = 0; i < keyCode.length; i++) {
                var comboEl = this.keyElements[keyCode[i]];
                if (comboEl) {
                    comboEl.classList.add('correct-flash');
                    (function(el) {
                        setTimeout(function() { el.classList.remove('correct-flash'); }, 200);
                    })(comboEl);
                }
            }
        } else {
            var el = this.keyElements[keyCode];
            if (!el) return;
            el.classList.add('correct-flash');
            setTimeout(function() { el.classList.remove('correct-flash'); }, 200);
        }
    }

    /**
     * 誤入力フラッシュ表示
     */
    showWrongFlash(keyCode) {
        const el = this.keyElements[keyCode];
        if (!el) return;
        el.classList.add('wrong-flash');
        setTimeout(function() { el.classList.remove('wrong-flash'); }, 300);
    }

    /**
     * キー押下状態表示
     */
    setKeyPressed(keyCode, pressed) {
        const el = this.keyElements[keyCode];
        if (!el) return;
        if (pressed) {
            el.classList.add('pressed');
        } else {
            el.classList.remove('pressed');
        }
    }

    /**
     * キーIDから物理座標を取得（移動距離計算用）
     */
    getKeyPosition(keyCode) {
        for (const key of this.keys) {
            if (key.id === keyCode) {
                return {
                    x: key.x + key.w / 2,
                    y: key.y + key.h / 2
                };
            }
        }
        return null;
    }

    /**
     * ウィンドウリサイズ時に再フィット
     */
    onResize() {
        this._fitToContainer();
    }
}
