/**
 * 用紙サイズ・マージン定義
 * @module js/paper-size
 */

// 用紙サイズ定数定義（width/length: ポイント、widthMm/lengthMm: ミリメートル、72dpi基準）
export const PAPER_SIZES = {
    // A判シリーズ（ISO 216）
    A0: { width: 2384, length: 3370, widthMm: 841, lengthMm: 1189, name: 'A0' },
    A1: { width: 1684, length: 2384, widthMm: 594, lengthMm: 841, name: 'A1' },
    A2: { width: 1191, length: 1684, widthMm: 420, lengthMm: 594, name: 'A2' },
    A3: { width: 842, length: 1191, widthMm: 297, lengthMm: 420, name: 'A3' },
    A4: { width: 595, length: 842, widthMm: 210, lengthMm: 297, name: 'A4' },
    A5: { width: 420, length: 595, widthMm: 148, lengthMm: 210, name: 'A5' },
    A6: { width: 298, length: 420, widthMm: 105, lengthMm: 148, name: 'A6' },
    A7: { width: 210, length: 298, widthMm: 74, lengthMm: 105, name: 'A7' },
    A8: { width: 148, length: 210, widthMm: 52, lengthMm: 74, name: 'A8' },

    // B判シリーズ（JIS B）
    B0: { width: 2920, length: 4127, widthMm: 1030, lengthMm: 1456, name: 'B0' },
    B1: { width: 2064, length: 2920, widthMm: 728, lengthMm: 1030, name: 'B1' },
    B2: { width: 1460, length: 2064, widthMm: 515, lengthMm: 728, name: 'B2' },
    B3: { width: 1032, length: 1460, widthMm: 364, lengthMm: 515, name: 'B3' },
    B4: { width: 729, length: 1032, widthMm: 257, lengthMm: 364, name: 'B4' },
    B5: { width: 516, length: 729, widthMm: 182, lengthMm: 257, name: 'B5' },
    B6: { width: 363, length: 516, widthMm: 128, lengthMm: 182, name: 'B6' },
    B7: { width: 258, length: 363, widthMm: 91, lengthMm: 128, name: 'B7' },
    B8: { width: 181, length: 258, widthMm: 64, lengthMm: 91, name: 'B8' },

    // その他の主要な用紙サイズ
    LETTER: { width: 612, length: 792, widthMm: 215.9, lengthMm: 279.4, name: 'Letter' },
    LEGAL: { width: 612, length: 1008, widthMm: 215.9, lengthMm: 355.6, name: 'Legal' },
    TABLOID: { width: 792, length: 1224, widthMm: 279.4, lengthMm: 431.8, name: 'Tabloid' },
    LEDGER: { width: 1224, length: 792, widthMm: 431.8, lengthMm: 279.4, name: 'Ledger' },
    EXECUTIVE: { width: 522, length: 756, widthMm: 184.2, lengthMm: 266.7, name: 'Executive' },
    POSTCARD: { width: 283, length: 420, widthMm: 100, lengthMm: 148, name: 'はがき' },
    POSTCARD_REPLY: { width: 283, length: 567, widthMm: 100, lengthMm: 200, name: '往復はがき' },
    NAGAGATA3: { width: 340, length: 666, widthMm: 120, lengthMm: 235, name: '長形3号' },
    KAKUGATA2: { width: 680, length: 941, widthMm: 240, lengthMm: 332, name: '角形2号' }
};

/**
 * 用紙サイズクラス
 */
export class PaperSize {
    constructor() {
        this.binding = 0;      // 綴じ方向 0:左綴じ, 1:右綴じ
        this.imposition = 0;   // 面付け指定 0:片面, 1:見開き
        this.length = 842;     // 用紙長さ（ポイント）デフォルトA4
        this.width = 595;      // 用紙幅（ポイント）デフォルトA4
        this.top = 57;         // 上オーバーレイ余白（約20mm）
        this.bottom = 57;      // 下オーバーレイ余白
        this.left = 57;        // 左余白（ノド側）
        this.right = 57;       // 右余白（小口側）
    }

    /**
     * 幅をmmで取得
     * @returns {number} 幅（mm）
     */
    get widthMm() {
        return pointsToMm(this.width);
    }

    /**
     * 幅をmmで設定
     * @param {number} mm - 幅（mm）
     */
    set widthMm(mm) {
        this.width = mmToPoints(mm);
    }

    /**
     * 長さをmmで取得
     * @returns {number} 長さ（mm）
     */
    get lengthMm() {
        return pointsToMm(this.length);
    }

    /**
     * 長さをmmで設定
     * @param {number} mm - 長さ（mm）
     */
    set lengthMm(mm) {
        this.length = mmToPoints(mm);
    }

    /**
     * 上余白をmmで取得
     * @returns {number} 上余白（mm）
     */
    get topMm() {
        return pointsToMm(this.top);
    }

    /**
     * 上余白をmmで設定
     * @param {number} mm - 上余白（mm）
     */
    set topMm(mm) {
        this.top = mmToPoints(mm);
    }

    /**
     * 下余白をmmで取得
     * @returns {number} 下余白（mm）
     */
    get bottomMm() {
        return pointsToMm(this.bottom);
    }

    /**
     * 下余白をmmで設定
     * @param {number} mm - 下余白（mm）
     */
    set bottomMm(mm) {
        this.bottom = mmToPoints(mm);
    }

    /**
     * 左余白をmmで取得
     * @returns {number} 左余白（mm）
     */
    get leftMm() {
        return pointsToMm(this.left);
    }

    /**
     * 左余白をmmで設定
     * @param {number} mm - 左余白（mm）
     */
    set leftMm(mm) {
        this.left = mmToPoints(mm);
    }

    /**
     * 右余白をmmで取得
     * @returns {number} 右余白（mm）
     */
    get rightMm() {
        return pointsToMm(this.right);
    }

    /**
     * 右余白をmmで設定
     * @param {number} mm - 右余白（mm）
     */
    set rightMm(mm) {
        this.right = mmToPoints(mm);
    }

    /**
     * XML<paper>要素から設定を読み込む
     * @param {Element} element - paper要素
     */
    parseFromElement(element) {
        if (element.hasAttribute('binding')) {
            this.binding = parseInt(element.getAttribute('binding')) || 0;
        }
        if (element.hasAttribute('imposition')) {
            this.imposition = parseInt(element.getAttribute('imposition')) || 0;
        }
        if (element.hasAttribute('length')) {
            this.length = parseFloat(element.getAttribute('length')) || 842;
        }
        if (element.hasAttribute('width')) {
            this.width = parseFloat(element.getAttribute('width')) || 595;
        }
        if (element.hasAttribute('top')) {
            this.top = parseFloat(element.getAttribute('top')) || 0;
        }
        if (element.hasAttribute('bottom')) {
            this.bottom = parseFloat(element.getAttribute('bottom')) || 0;
        }
        if (element.hasAttribute('left')) {
            this.left = parseFloat(element.getAttribute('left')) || 0;
        }
        if (element.hasAttribute('right')) {
            this.right = parseFloat(element.getAttribute('right')) || 0;
        }
    }

    /**
     * XML<paper>要素として出力
     * @returns {string} XML文字列
     */
    toXmlString() {
        return `<paper imposition="${this.imposition}" binding="${this.binding}" ` +
               `length="${Math.round(this.length)}" width="${Math.round(this.width)}" ` +
               `top="${Math.round(this.top)}" bottom="${Math.round(this.bottom)}" ` +
               `left="${Math.round(this.left)}" right="${Math.round(this.right)}" />`;
    }

    /**
     * 用紙サイズ名を推定
     * @returns {string|null} 用紙サイズ名またはnull（カスタム）
     */
    getSizeName() {
        const tolerance = 2; // 許容誤差（ポイント）
        for (const [key, size] of Object.entries(PAPER_SIZES)) {
            if (Math.abs(this.width - size.width) <= tolerance &&
                Math.abs(this.length - size.length) <= tolerance) {
                return key;
            }
        }
        return null;
    }

    /**
     * 用紙サイズ名から設定
     * @param {string} name - 用紙サイズ名（'A4', 'B5'等）
     * @returns {boolean} 設定成功したか
     */
    setFromSizeName(name) {
        const size = getPaperSizeByName(name);
        if (size) {
            this.width = size.width;
            this.length = size.length;
            return true;
        }
        return false;
    }

    /**
     * A4・標準余白にリセット
     */
    resetToDefault() {
        this.binding = 0;
        this.imposition = 0;
        this.width = PAPER_SIZES.A4.width;
        this.length = PAPER_SIZES.A4.length;
        this.top = 57;    // 約20mm
        this.bottom = 57;
        this.left = 57;
        this.right = 57;
    }
}

/**
 * 用紙マージンクラス
 */
export class PaperMargin {
    constructor() {
        this.top = 0;      // 上余白
        this.bottom = 0;   // 下余白
        this.left = 0;     // 左余白
        this.right = 0;    // 右余白
    }

    /**
     * XML<paper>要素からマージン設定を読み込む
     * @param {Element} element - paper要素（margintop等の属性を持つ）
     */
    parseFromElement(element) {
        if (element.hasAttribute('margintop')) {
            this.top = parseFloat(element.getAttribute('margintop')) || 0;
            this.bottom = parseFloat(element.getAttribute('marginbottom')) || 0;
            this.left = parseFloat(element.getAttribute('marginleft')) || 0;
            this.right = parseFloat(element.getAttribute('marginright')) || 0;
        }
    }
}

/**
 * ポイントをmmに変換（72dpi基準）
 * @param {number} points - ポイント値
 * @returns {number} mm値
 */
export function pointsToMm(points) {
    return points * 25.4 / 72;
}

/**
 * mmをポイントに変換（72dpi基準）
 * @param {number} mm - mm値
 * @returns {number} ポイント値
 */
export function mmToPoints(mm) {
    return mm * 72 / 25.4;
}

/**
 * 用紙サイズ名からサイズ定義を取得
 * @param {string} name - 用紙サイズ名（'A4', 'B5'等）
 * @returns {Object|null} サイズ定義オブジェクト
 */
export function getPaperSizeByName(name) {
    if (!name) return null;
    return PAPER_SIZES[name.toUpperCase()] || null;
}

/**
 * 用紙サイズ選択肢リストを取得
 * @returns {Array} [{key, name, widthMm, lengthMm}, ...]
 */
export function getPaperSizeOptions() {
    const options = [];

    // A判
    ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8'].forEach(key => {
        const size = PAPER_SIZES[key];
        options.push({
            key,
            name: size.name,
            widthMm: size.widthMm,
            lengthMm: size.lengthMm,
            label: `${size.name} (${size.widthMm}×${size.lengthMm}mm)`
        });
    });

    // B判
    ['B0', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8'].forEach(key => {
        const size = PAPER_SIZES[key];
        options.push({
            key,
            name: size.name,
            widthMm: size.widthMm,
            lengthMm: size.lengthMm,
            label: `${size.name} (${size.widthMm}×${size.lengthMm}mm)`
        });
    });

    // その他
    ['LETTER', 'LEGAL', 'POSTCARD'].forEach(key => {
        const size = PAPER_SIZES[key];
        options.push({
            key,
            name: size.name,
            widthMm: size.widthMm,
            lengthMm: size.lengthMm,
            label: `${size.name} (${size.widthMm}×${size.lengthMm}mm)`
        });
    });

    return options;
}
