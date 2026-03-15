/**
 * 基本図形編集プラグイン - 属性適用系Mixin
 * _applyToSelected, applyXxxToSelected等
 * @module FigurePropertyApplierMixin
 */
export const FigurePropertyApplierMixin = (Base) => class extends Base {
    _applyToSelected(applyFn, statusMessage) {
        if (this.selectedShapes.length === 0) return;
        this.selectedShapes.forEach(applyFn);
        this.redraw();
        this.isModified = true;
        this.setStatus(statusMessage);
    }

    applyFillColorToSelected(color) {
        this._applyToSelected(
            shape => {
                shape.fillColor = color;
                if (typeof findSolidColorPatternId === 'function') {
                    shape.fillPatternId = findSolidColorPatternId(color);
                }
            },
            `塗りつぶし色を変更しました: ${color}`
        );
    }

    applyFillEnabledToSelected(enabled) {
        this._applyToSelected(
            shape => { shape.fillEnabled = enabled; },
            `塗りつぶしを${enabled ? '有効' : '無効'}にしました`
        );
    }

    applyFillPatternToSelected(patternId) {
        this._applyToSelected(
            shape => {
                shape.fillPatternId = patternId;
                if (patternId >= 1) {
                    shape.fillEnabled = true;
                    if (typeof resolvePatternColor === 'function') {
                        const color = resolvePatternColor(patternId, this.customPatterns);
                        if (color) {
                            shape.fillColor = color;
                        }
                    }
                }
            },
            `パターンを変更しました: ID=${patternId}`
        );
    }

    applyStrokeColorToSelected(color) {
        this._applyToSelected(
            shape => {
                shape.strokeColor = color;
                if (typeof findSolidColorPatternId === 'function') {
                    shape.linePatternId = findSolidColorPatternId(color);
                }
            },
            `線色を変更しました: ${color}`
        );
    }

    applyLineWidthToSelected(width) {
        this._applyToSelected(
            shape => { shape.lineWidth = width; },
            `線の太さを変更しました: ${width}px`
        );
    }

    applyLinePatternToSelected(pattern) {
        const typeMapping = { 'solid': 0, 'dashed': 1, 'dotted': 2 };
        const lineType = typeMapping[pattern] || 0;
        const patternName = pattern === 'solid' ? '実線' : pattern === 'dotted' ? '点線' : '破線';
        this._applyToSelected(
            shape => { shape.lineType = lineType; },
            `線種を変更しました: ${patternName}`
        );
    }

    applyLineTypeToSelected(lineType) {
        const typeName = this.getLineTypeName(lineType);
        this._applyToSelected(
            shape => { shape.lineType = lineType; },
            `線種を変更しました: ${typeName}`
        );
    }

    applyLineConnectionTypeToSelected(connectionType) {
        const typeName = connectionType === 'straight' ? '直線' : connectionType === 'elbow' ? 'カギ線' : '曲線';
        this._applyToSelected(
            shape => {
                if (shape.type === 'line') {
                    shape.lineConnectionType = connectionType;
                }
            },
            `接続形状を変更しました: ${typeName}`
        );
    }

    applyCornerRadiusToSelected(radius) {
        this._applyToSelected(
            shape => {
                if (shape.type === 'rect' || shape.type === 'roundRect') {
                    shape.cornerRadius = radius;
                    shape.type = radius > 0 ? 'roundRect' : 'rect';
                }
            },
            `角丸半径を変更しました: ${radius}px`
        );
    }

    applyArrowPositionToSelected(arrowPosition) {
        const positionName = arrowPosition === 'none' ? 'なし' :
                            arrowPosition === 'start' ? '始点のみ' :
                            arrowPosition === 'end' ? '終点のみ' : '両端';
        this._applyToSelected(
            shape => {
                if (shape.type === 'line') {
                    shape.start_arrow = (arrowPosition === 'start' || arrowPosition === 'both') ? 1 : 0;
                    shape.end_arrow = (arrowPosition === 'end' || arrowPosition === 'both') ? 1 : 0;
                }
            },
            `矢印位置を変更しました: ${positionName}`
        );
    }

    applyArrowTypeToSelected(arrowType) {
        const typeName = arrowType === 'simple' ? '線のみ' : '塗りつぶし';
        this._applyToSelected(
            shape => {
                if (shape.type === 'line') {
                    shape.arrow_type = arrowType;
                }
            },
            `矢印種類を変更しました: ${typeName}`
        );
    }

    applyFontSizeToSelected(fontSize) {
        this._applyToSelected(
            shape => { if (shape.type === 'document') shape.fontSize = fontSize; },
            `フォントサイズを変更しました: ${fontSize}px`
        );
    }

    applyFontFamilyToSelected(fontFamily) {
        this._applyToSelected(
            shape => { if (shape.type === 'document') shape.fontFamily = fontFamily; },
            `フォントを変更しました`
        );
    }

    applyTextColorToSelected(textColor) {
        this._applyToSelected(
            shape => { if (shape.type === 'document') shape.textColor = textColor; },
            `文字色を変更しました: ${textColor}`
        );
    }

    applyTextDecorationToSelected(decoration, enabled) {
        this._applyToSelected(
            shape => {
                if (shape.type === 'document' && shape.decorations) {
                    shape.decorations[decoration] = enabled;
                }
            },
            enabled ? `${decoration}を有効にしました` : `${decoration}を無効にしました`
        );
    }
};
