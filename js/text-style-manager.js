/**
 * js/text-style-manager.js
 * テキストスタイル状態管理クラス
 * xmlTADの<font>/<text>タグの効果を段落間で維持するために使用
 * plugin-base.js から分離
 */

import {
    DEFAULT_FONT_SIZE,
    DEFAULT_FONT_STYLE,
    DEFAULT_FONT_WEIGHT,
    DEFAULT_FONT_STRETCH,
    DEFAULT_LETTER_SPACING,
    DEFAULT_CHCOL
} from './util.js';

export class TextStyleStateManager {
    /** デフォルト値定義（一箇所で管理） */
    static DEFAULTS = {
        size: String(DEFAULT_FONT_SIZE),
        color: DEFAULT_CHCOL,
        face: '',
        style: DEFAULT_FONT_STYLE,
        weight: DEFAULT_FONT_WEIGHT,
        stretch: DEFAULT_FONT_STRETCH,
        direction: '0',          // 文字送り方向 (0:横, 1:縦)
        kerning: '0',            // カーニング (0:無効, 1:有効)
        pattern: '0',            // 文字送りパターン
        space: DEFAULT_LETTER_SPACING,  // 文字間隔
        align: 'left',
        lineHeight: '1',         // 行の高さ
        textDirection: '0',      // テキスト方向 (0:横書き, 1:縦書き)
        hRatio: '1/1',           // 文字高さ拡大率 (RATIO 型 A/B)
        wRatio: '1/1'            // 文字幅拡大率 (RATIO 型 A/B)
    };

    constructor() {
        this.reset();
    }

    /**
     * 状態をデフォルト値にリセット
     */
    reset() {
        const d = TextStyleStateManager.DEFAULTS;
        this.size = d.size;
        this.color = d.color;
        this.face = d.face;
        this.style = d.style;
        this.weight = d.weight;
        this.stretch = d.stretch;
        this.direction = d.direction;
        this.kerning = d.kerning;
        this.pattern = d.pattern;
        this.space = d.space;
        this.align = d.align;
        this.lineHeight = d.lineHeight;
        this.textDirection = d.textDirection;
        this.hRatio = d.hRatio;
        this.wRatio = d.wRatio;
    }

    /**
     * 属性を更新
     * @param {string} attr - 属性名
     * @param {string} value - 値（空文字列はデフォルトにリセット）
     */
    update(attr, value) {
        if (value === '' || value === null || value === undefined) {
            this[attr] = TextStyleStateManager.DEFAULTS[attr];
        } else {
            this[attr] = value;
        }
    }

    /**
     * <font>タグから属性を更新
     * @param {Object} attrs - 属性オブジェクト { size, color, face, style, weight, stretch, direction, kerning, pattern, space }
     */
    updateFromFontTag(attrs) {
        if (attrs.size !== undefined) this.update('size', attrs.size);
        if (attrs.color !== undefined) this.update('color', attrs.color);
        if (attrs.face !== undefined) this.update('face', attrs.face);
        if (attrs.style !== undefined) this.update('style', attrs.style);
        if (attrs.weight !== undefined) this.update('weight', attrs.weight);
        if (attrs.stretch !== undefined) this.update('stretch', attrs.stretch);
        if (attrs.direction !== undefined) this.update('direction', attrs.direction);
        if (attrs.kerning !== undefined) this.update('kerning', attrs.kerning);
        if (attrs.pattern !== undefined) this.update('pattern', attrs.pattern);
        if (attrs.space !== undefined) this.update('space', attrs.space);
        if (attrs.hRatio !== undefined) this.update('hRatio', attrs.hRatio);
        if (attrs.wRatio !== undefined) this.update('wRatio', attrs.wRatio);
    }

    /**
     * <text>タグから属性を更新
     * @param {Object} attrs - 属性オブジェクト { align, 'line-height', direction }
     */
    updateFromTextTag(attrs) {
        if (attrs.align !== undefined) this.update('align', attrs.align);
        if (attrs['line-height'] !== undefined) this.update('lineHeight', attrs['line-height']);
        if (attrs.direction !== undefined) this.update('textDirection', attrs.direction);
    }

    _parseRatio(ratioStr) {
        if (!ratioStr || typeof ratioStr !== 'string') return 1.0;
        const m = ratioStr.match(/^(\d+)\/(\d+)$/);
        if (!m) return 1.0;
        const a = parseInt(m[1], 10);
        const b = parseInt(m[2], 10);
        if (b === 0) return 1.0;
        return a / b;
    }

    /**
     * 現在のフォント状態をCSSスタイル文字列として取得
     * デフォルト値と異なる属性のみ出力
     * @returns {string} CSSスタイル文字列
     */
    toCssStyle() {
        const d = TextStyleStateManager.DEFAULTS;
        let style = '';
        const hScale = this._parseRatio(this.hRatio);
        if (this.size !== d.size || hScale !== 1.0) {
            style += `font-size: ${parseFloat(this.size) * hScale}pt;`;
        }
        if (this.color !== d.color) style += `color: ${this.color};`;
        if (this.face) style += `font-family: ${this.face};`;
        if (this.style !== d.style) style += `font-style: ${this.style};`;
        if (this.weight !== d.weight) style += `font-weight: ${this.weight};`;
        if (this.stretch !== d.stretch) style += `font-stretch: ${this.stretch};`;
        if (this.space !== d.space) style += `letter-spacing: ${this.space}em;`;
        const wScale = this._parseRatio(this.wRatio);
        if (wScale !== 1.0) style += `font-stretch: ${Math.round(wScale * 100)}%;`;
        return style;
    }

    /**
     * 現在のテキスト揃えをCSSスタイル文字列として取得
     * @returns {string} CSSスタイル文字列
     */
    toAlignCssStyle() {
        if (this.align !== 'left') {
            return `text-align: ${this.align};`;
        }
        return '';
    }

    /**
     * デフォルト以外のスタイルがあるか確認
     * @returns {boolean} デフォルト以外のスタイルがあればtrue
     */
    hasNonDefaultStyle() {
        const d = TextStyleStateManager.DEFAULTS;
        return this.size !== d.size ||
               this.color !== d.color ||
               this.face !== d.face ||
               this.style !== d.style ||
               this.weight !== d.weight ||
               this.stretch !== d.stretch ||
               this.space !== d.space ||
               this.hRatio !== d.hRatio ||
               this.wRatio !== d.wRatio;
    }

    /**
     * 現在の状態のコピーを作成
     * @returns {TextStyleStateManager} コピー
     */
    clone() {
        const copy = new TextStyleStateManager();
        copy.size = this.size;
        copy.color = this.color;
        copy.face = this.face;
        copy.style = this.style;
        copy.weight = this.weight;
        copy.stretch = this.stretch;
        copy.direction = this.direction;
        copy.kerning = this.kerning;
        copy.pattern = this.pattern;
        copy.space = this.space;
        copy.align = this.align;
        copy.lineHeight = this.lineHeight;
        copy.textDirection = this.textDirection;
        copy.hRatio = this.hRatio;
        copy.wRatio = this.wRatio;
        return copy;
    }
}
