/**
 * パターンユーティリティ（共通モジュール）
 *
 * BTRON 128デフォルトパターン定義とパターン描画ユーティリティを提供。
 * basic-figure-editor、basic-calc-editor 等で共通利用。
 *
 * パターンID値域（TAD仕様準拠）:
 *   0 = 透明（パターンデータなし、変更不可）
 *   1-127 = パターンID（デフォルトパターンまたはカスタムパターン）
 *
 * l_pat値域:
 *   0 = パターンなし（strokeColor直接使用）
 *   1-127 = 線描画にパターンIDを使用
 *
 * f_pat値域:
 *   0 = 透明（塗りなし）
 *   1-127 = 塗りにパターンIDを使用
 *
 * @module js/pattern-utils
 */

/**
 * BTRON 128デフォルトパターン定義
 * データソース: BTRON公式画像 (fig0508.png) から抽出
 *
 * パターン構成:
 *   - ID 0: 透明（TAD仕様: パターン0は透明、変更不可）
 *   - ID 1: 黒ベタ
 *   - ID 2-127: ソリッドカラーまたはテクスチャパターン
 *
 * パターンデータ形式:
 *   - transparent: { id, type: 'transparent' }
 *   - solid: { id, type: 'solid', color: '#xxxxxx' }
 *   - pattern: { id, type: 'pattern', data: [16個の16bit整数（行マスク）] }
 */
export const DEFAULT_PATTERNS = [
    { id: 0, type: 'transparent' },
    { id: 1, type: 'solid', color: '#000000' },
    { id: 2, type: 'pattern', data: [34952, 0, 8738, 0, 34952, 0, 8738, 0, 34952, 0, 8738, 0, 34952, 0, 8738, 0] },
    { id: 3, type: 'pattern', data: [0, 0, 8224, 0, 0, 0, 514, 0, 0, 0, 8224, 0, 0, 0, 514, 0] },
    { id: 4, type: 'solid', color: '#ffffcc' },
    { id: 5, type: 'solid', color: '#33ff99' },
    { id: 6, type: 'solid', color: '#00ff00' },
    { id: 7, type: 'solid', color: '#336600' },
    { id: 8, type: 'solid', color: '#3366ff' },
    { id: 9, type: 'solid', color: '#0000ff' },
    { id: 10, type: 'solid', color: '#9966cc' },
    { id: 11, type: 'solid', color: '#9966ff' },
    { id: 12, type: 'solid', color: '#ee0000' },
    { id: 13, type: 'solid', color: '#ff0033' },
    { id: 14, type: 'solid', color: '#996633' },
    { id: 15, type: 'solid', color: '#eeeeee' },
    { id: 16, type: 'solid', color: '#00009f' },
    { id: 17, type: 'solid', color: '#dfdfdf' },
    { id: 18, type: 'pattern', data: [43690, 0, 21845, 0, 43690, 0, 21845, 0, 43690, 0, 21845, 0, 43690, 0, 21845, 0] },
    { id: 19, type: 'pattern', data: [0, 26214, 0, 0, 0, 26214, 0, 0, 0, 26214, 0, 0, 0, 26214, 0, 0] },
    { id: 20, type: 'solid', color: '#ffff66' },
    { id: 21, type: 'solid', color: '#66ff99' },
    { id: 22, type: 'solid', color: '#00dd00' },
    { id: 23, type: 'solid', color: '#339999' },
    { id: 24, type: 'solid', color: '#0099ff' },
    { id: 25, type: 'solid', color: '#0000ee' },
    { id: 26, type: 'solid', color: '#996699' },
    { id: 27, type: 'solid', color: '#9900ff' },
    { id: 28, type: 'solid', color: '#dd0000' },
    { id: 29, type: 'solid', color: '#ff3399' },
    { id: 30, type: 'solid', color: '#cc6633' },
    { id: 31, type: 'solid', color: '#dfdfdf' },
    { id: 32, type: 'solid', color: '#00ef00' },
    { id: 33, type: 'solid', color: '#7f9fff' },
    { id: 34, type: 'pattern', data: [43690, 21845, 43690, 21845, 43690, 21845, 43690, 21845, 43690, 21845, 43690, 21845, 43690, 21845, 43690, 21845] },
    { id: 35, type: 'pattern', data: [34952, 49344, 24672, 12336, 4369, 771, 1542, 3084, 34952, 49344, 24672, 12336, 4369, 771, 1542, 3084] },
    { id: 36, type: 'solid', color: '#ffff33' },
    { id: 37, type: 'solid', color: '#00ff99' },
    { id: 38, type: 'solid', color: '#00cc00' },
    { id: 39, type: 'solid', color: '#00cccc' },
    { id: 40, type: 'solid', color: '#3399ff' },
    { id: 41, type: 'solid', color: '#0000dd' },
    { id: 42, type: 'solid', color: '#cc99cc' },
    { id: 43, type: 'solid', color: '#9900cc' },
    { id: 44, type: 'solid', color: '#cc0000' },
    { id: 45, type: 'solid', color: '#ff33ff' },
    { id: 46, type: 'solid', color: '#ff6600' },
    { id: 47, type: 'solid', color: '#bbbbbb' },
    { id: 48, type: 'solid', color: '#00efef' },
    { id: 49, type: 'solid', color: '#ccff99' },
    { id: 50, type: 'pattern', data: [21845, 65535, 43690, 65535, 21845, 65535, 43690, 65535, 21845, 65535, 43690, 65535, 21845, 65535, 43690, 65535] },
    { id: 51, type: 'pattern', data: [32382, 32382, 24672, 24672, 6168, 6168, 63993, 63993, 32382, 32382, 24672, 24672, 6168, 6168, 63993, 63993] },
    { id: 52, type: 'solid', color: '#ffff00' },
    { id: 53, type: 'solid', color: '#00ff66' },
    { id: 54, type: 'solid', color: '#00bb00' },
    { id: 55, type: 'solid', color: '#66cccc' },
    { id: 56, type: 'solid', color: '#33ccff' },
    { id: 57, type: 'solid', color: '#0000cc' },
    { id: 58, type: 'solid', color: '#cc99ff' },
    { id: 59, type: 'solid', color: '#990099' },
    { id: 60, type: 'solid', color: '#bb0000' },
    { id: 61, type: 'solid', color: '#ff66cc' },
    { id: 62, type: 'solid', color: '#ff6699' },
    { id: 63, type: 'solid', color: '#999999' },
    { id: 64, type: 'solid', color: '#ff0000' },
    { id: 65, type: 'solid', color: '#cfffff' },
    { id: 66, type: 'pattern', data: [4369, 8738, 17476, 34952, 4369, 8738, 17476, 34952, 4369, 8738, 17476, 34952, 4369, 8738, 17476, 34952] },
    { id: 67, type: 'pattern', data: [514, 1285, 34952, 20560, 8224, 20560, 34952, 1285, 514, 1285, 34952, 20560, 8224, 20560, 34952, 1285] },
    { id: 68, type: 'solid', color: '#ccff99' },
    { id: 69, type: 'solid', color: '#cccc33' },
    { id: 70, type: 'solid', color: '#00aa00' },
    { id: 71, type: 'solid', color: '#00cc99' },
    { id: 72, type: 'solid', color: '#66ccff' },
    { id: 73, type: 'solid', color: '#0000bb' },
    { id: 74, type: 'solid', color: '#ccccff' },
    { id: 75, type: 'solid', color: '#cc0099' },
    { id: 76, type: 'solid', color: '#aa0000' },
    { id: 77, type: 'solid', color: '#ff99cc' },
    { id: 78, type: 'solid', color: '#ff9999' },
    { id: 79, type: 'solid', color: '#777777' },
    { id: 80, type: 'solid', color: '#ef00ff' },
    { id: 81, type: 'solid', color: '#ff6f6f' },
    { id: 82, type: 'pattern', data: [32896, 16448, 8224, 4112, 2056, 1028, 514, 257, 32896, 16448, 8224, 4112, 2056, 1028, 514, 257] },
    { id: 83, type: 'pattern', data: [4104, 2064, 1056, 35409, 20874, 8196, 4104, 2064, 2064, 4104, 8196, 20874, 35409, 1056, 2064, 4104] },
    { id: 84, type: 'solid', color: '#ccff66' },
    { id: 85, type: 'solid', color: '#cccc66' },
    { id: 86, type: 'solid', color: '#008800' },
    { id: 87, type: 'solid', color: '#66cc99' },
    { id: 88, type: 'solid', color: '#33ffff' },
    { id: 89, type: 'solid', color: '#0000aa' },
    { id: 90, type: 'solid', color: '#cc66cc' },
    { id: 91, type: 'solid', color: '#cc33cc' },
    { id: 92, type: 'solid', color: '#990000' },
    { id: 93, type: 'solid', color: '#ffccff' },
    { id: 94, type: 'solid', color: '#ff9966' },
    { id: 95, type: 'solid', color: '#555555' },
    { id: 96, type: 'solid', color: '#dfdf00' },
    { id: 97, type: 'solid', color: '#ef8fff' },
    { id: 98, type: 'pattern', data: [0, 0, 65535, 65535, 0, 0, 65535, 65535, 0, 0, 65535, 65535, 0, 0, 65535, 65535] },
    { id: 99, type: 'pattern', data: [65023, 65023, 65023, 65023, 65023, 65023, 65023, 0, 65534, 65534, 65534, 65534, 65534, 65534, 65534, 0] },
    { id: 100, type: 'solid', color: '#ccff33' },
    { id: 101, type: 'solid', color: '#cccc99' },
    { id: 102, type: 'solid', color: '#006600' },
    { id: 103, type: 'solid', color: '#00ffcc' },
    { id: 104, type: 'solid', color: '#66ffff' },
    { id: 105, type: 'solid', color: '#000088' },
    { id: 106, type: 'solid', color: '#cc6699' },
    { id: 107, type: 'solid', color: '#cc00ff' },
    { id: 108, type: 'solid', color: '#770000' },
    { id: 109, type: 'solid', color: '#ffcccc' },
    { id: 110, type: 'solid', color: '#ffcc66' },
    { id: 111, type: 'solid', color: '#444444' },
    { id: 112, type: 'solid', color: '#888888' },
    { id: 113, type: 'solid', color: '#efff9f' },
    { id: 114, type: 'pattern', data: [8738, 8738, 8738, 8738, 8738, 8738, 8738, 8738, 8738, 8738, 8738, 8738, 8738, 8738, 8738, 8738] },
    { id: 115, type: 'pattern', data: [65535, 49153, 49153, 40961, 36865, 36865, 34817, 33793, 33793, 33281, 33025, 33025, 32897, 32897, 32833, 32801] },
    { id: 116, type: 'solid', color: '#ccff00' },
    { id: 117, type: 'solid', color: '#999933' },
    { id: 118, type: 'solid', color: '#004400' },
    { id: 119, type: 'solid', color: '#99ffcc' },
    { id: 120, type: 'solid', color: '#99ffff' },
    { id: 121, type: 'solid', color: '#000066' },
    { id: 122, type: 'solid', color: '#993366' },
    { id: 123, type: 'solid', color: '#cc66ff' },
    { id: 124, type: 'solid', color: '#550000' },
    { id: 125, type: 'solid', color: '#cc9999' },
    { id: 126, type: 'solid', color: '#cc9900' },
    { id: 127, type: 'solid', color: '#222222' }
];

// DEFAULT_PATTERNSのテクスチャパターンにpixelColorsを生成（TADバイナリ形式との構造的一貫性）
(function initializeDefaultPatternPixelColors() {
    for (const pat of DEFAULT_PATTERNS) {
        if (pat.type === 'pattern' && pat.data && !pat.pixelColors) {
            const pixelColors = [];
            for (let row = 0; row < 16; row++) {
                const rowData = [];
                const mask = pat.data[row] || 0;
                for (let col = 0; col < 16; col++) {
                    rowData.push((mask & (1 << (15 - col))) ? '#000000' : null);
                }
                pixelColors.push(rowData);
            }
            pat.pixelColors = pixelColors;
            pat.width = 16;
            pat.height = 16;
        }
    }
})();

/**
 * パターン定義からCanvasを生成（可変サイズ対応）
 * @param {number[]} rowMasks - 16bit整数の行マスク配列（pixelColorsがある場合はフォールバック用）
 * @param {string} fgColor - 前景色（ビット1の色）
 * @param {string} bgColor - 背景色（ビット0の色、'transparent'で透明）
 * @param {string[][]|null} [pixelColors] - 各ドットの個別色（2D配列、null=rowMasks+fgColor使用）
 * @returns {HTMLCanvasElement} パターンキャンバス
 */
export function createPatternCanvas(rowMasks, fgColor, bgColor, pixelColors) {
    // pixelColorsがある場合はそのサイズを使用、なければ16×16
    const w = (pixelColors && pixelColors[0]) ? pixelColors[0].length : 16;
    const h = pixelColors ? pixelColors.length : 16;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const pctx = canvas.getContext('2d');

    if (bgColor && bgColor !== 'transparent') {
        pctx.fillStyle = bgColor;
        pctx.fillRect(0, 0, w, h);
    }

    if (pixelColors) {
        // pixelColorsから直接描画（可変サイズ対応）
        for (let row = 0; row < h; row++) {
            const rowData = pixelColors[row];
            if (!rowData) continue;
            for (let col = 0; col < w; col++) {
                const color = rowData[col];
                if (color !== null && color !== undefined) {
                    pctx.fillStyle = color;
                    pctx.fillRect(col, row, 1, 1);
                }
            }
        }
    } else if (rowMasks) {
        // rowMasks + fgColorで描画（DEFAULT_PATTERNS用、16×16固定）
        for (let row = 0; row < Math.min(rowMasks.length, 16); row++) {
            const mask = rowMasks[row];
            for (let col = 0; col < 16; col++) {
                if (mask & (1 << (15 - col))) {
                    pctx.fillStyle = fgColor;
                    pctx.fillRect(col, row, 1, 1);
                }
            }
        }
    }
    return canvas;
}

/**
 * パターンIDからCanvasPatternを生成
 * @param {CanvasRenderingContext2D} ctx - 描画コンテキスト
 * @param {number} patternId - パターンID (1-127、カスタムは128+)
 * @param {string} fillColor - 図形の塗りつぶし色（ソリッドパターンやテクスチャの前景色に使用）
 * @param {Object} [customPatterns] - カスタムパターンテーブル（IDをキー）
 * @returns {CanvasPattern|string|null} CanvasPattern、色文字列、またはnull
 */
export function createFillPattern(ctx, patternId, fillColor, customPatterns) {
    if (patternId < 1 || patternId > 127) {
        // カスタムパターン（128+）はcustomPatternsから取得
        if (patternId >= 128 && customPatterns && customPatterns[patternId]) {
            const customPat = customPatterns[patternId];
            if (customPat.type === 'solid') return customPat.color;
            if (customPat.type === 'pattern') {
                const patCanvas = createPatternCanvas(customPat.data, fillColor, 'transparent', customPat.pixelColors);
                return ctx.createPattern(patCanvas, 'repeat');
            }
        }
        return null;
    }

    // カスタムパターンが優先
    const customPat = customPatterns && customPatterns[patternId];
    const patDef = customPat || DEFAULT_PATTERNS[patternId];
    if (!patDef) return null;

    if (patDef.type === 'transparent') {
        return null;
    }

    if (patDef.type === 'solid') {
        // ソリッドカラーパターン: 色をそのまま返す
        return patDef.color;
    }

    if (patDef.type === 'pattern') {
        // テクスチャパターン: CanvasPatternを生成
        // 前景色 = fillColor（図形の塗り色）、背景色 = 透明
        // pixelColorsがある場合は各ドットの個別色を使用
        const patCanvas = createPatternCanvas(patDef.data, fillColor, 'transparent', patDef.pixelColors);
        return ctx.createPattern(patCanvas, 'repeat');
    }

    return null;
}

/**
 * パターン定義からプレビュー用キャンバスを生成（パターン選択グリッド用）
 * @param {Object} patDef - パターン定義 { type, color?, data? }
 * @param {number} size - プレビューサイズ（px）
 * @param {string} [fgColor='#000000'] - テクスチャの前景色
 * @returns {HTMLCanvasElement} プレビューキャンバス
 */
export function createPatternPreviewCanvas(patDef, size, fgColor) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const pctx = canvas.getContext('2d');

    if (patDef.type === 'transparent') {
        // 透明パターン: 白背景のまま（または特別な表示）
        pctx.fillStyle = '#ffffff';
        pctx.fillRect(0, 0, size, size);
    } else if (patDef.type === 'solid') {
        pctx.fillStyle = patDef.color;
        pctx.fillRect(0, 0, size, size);
    } else if (patDef.type === 'pattern') {
        // 背景を白にしてからパターンを描画
        pctx.fillStyle = '#ffffff';
        pctx.fillRect(0, 0, size, size);
        // pixelColorsがある場合は各ドットの個別色を使用
        const patCanvas = createPatternCanvas(patDef.data, fgColor || '#000000', 'transparent', patDef.pixelColors);
        const pattern = pctx.createPattern(patCanvas, 'repeat');
        pctx.fillStyle = pattern;
        pctx.fillRect(0, 0, size, size);
    }

    return canvas;
}

/**
 * TADパラメータからパターンのpixelColors配列を構築
 * @param {number} width - パターン横幅
 * @param {number} height - パターン縦幅
 * @param {number} ncol - 前景色の個数
 * @param {string} fgcolorsStr - カンマ区切りの前景色リスト
 * @param {string} bgcolorStr - 背景色
 * @param {string} masksStr - カンマ区切りのマスクIDリスト
 * @param {Object} customMasks - マスク定義テーブル（IDをキー）
 * @returns {string[][]|null} 2D色配列（null=透明）
 */
export function buildPatternFromTadParams(width, height, ncol, fgcolorsStr, bgcolorStr, masksStr, customMasks) {
    const fgcolors = fgcolorsStr.split(',');
    const maskIds = masksStr.split(',').map(Number);

    // Initialize with bgcolor
    const bgColor = (bgcolorStr === 'transparent' || !bgcolorStr) ? null : bgcolorStr;
    const pixelColors = Array(height).fill(null).map(() =>
        Array(width).fill(bgColor)
    );

    // Apply each fgcol/mask layer sequentially
    for (let layer = 0; layer < ncol; layer++) {
        const color = fgcolors[layer];
        const maskId = maskIds[layer];
        if (maskId === undefined) continue;

        const maskData = customMasks[maskId];
        if (!maskData || !maskData.wordValues) continue;

        const isTransparent = (color === 'transparent' || !color);
        const wordsPerRow = Math.ceil(maskData.width / 16);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                // Pattern and mask sizes are independent (tiling)
                const maskX = x % maskData.width;
                const maskY = y % maskData.height;
                // Extract bit from 16-bit word array
                const wordIdx = maskY * wordsPerRow + Math.floor(maskX / 16);
                const bitPos = 15 - (maskX % 16); // MSB-first
                const maskValue = wordIdx < maskData.wordValues.length ? (maskData.wordValues[wordIdx] >> bitPos) & 1 : 0;

                if (isTransparent) {
                    // Transparent: place transparency where mask bit=0
                    if (maskValue === 0) {
                        pixelColors[y][x] = null;
                    }
                } else {
                    // Normal color: place color where mask bit=1
                    if (maskValue !== 0) {
                        pixelColors[y][x] = color;
                    }
                }
            }
        }
    }

    return pixelColors;
}

/**
 * ソリッドカラーに対応するデフォルトパターンIDを検索
 * @param {string} color - 検索する色（#rrggbb形式）
 * @returns {number} パターンID（見つからない場合は0）
 */
export function findSolidColorPatternId(color) {
    if (!color || color === 'transparent') return 0;
    const lowerColor = color.toLowerCase();
    for (let i = 1; i < DEFAULT_PATTERNS.length; i++) {
        const pat = DEFAULT_PATTERNS[i];
        if (pat.type === 'solid' && pat.color.toLowerCase() === lowerColor) return i;
    }
    return 0;
}

/**
 * パターンIDから色文字列を解決する（HTML/SVG描画用の簡易版）
 * Canvas描画不要の場面（PluginBaseのrender系メソッド等）で使用。
 * ソリッドカラーパターンはそのまま色を返し、テクスチャパターンは前景色で近似する。
 * @param {number} patternId - パターンID（0=未指定）
 * @param {Object} [customPatterns={}] - カスタムパターン定義（ID→{type,color,fgcolors}）
 * @returns {string|null} 色文字列（#rrggbb形式）またはnull（解決不能時）
 */
export function resolvePatternColor(patternId, customPatterns = {}) {
    if (patternId === 0) return null;
    // カスタムパターン優先（ID 128+等）
    if (customPatterns && customPatterns[patternId]) {
        const pat = customPatterns[patternId];
        if (pat.type === 'solid') return pat.color;
        if (pat.fgcolors) return pat.fgcolors.split(',')[0];
        return null;
    }
    // デフォルトパターン（ID 1-127）
    if (patternId >= 1 && patternId < DEFAULT_PATTERNS.length) {
        const pat = DEFAULT_PATTERNS[patternId];
        if (pat.type === 'solid') return pat.color;
        if (pat.type === 'transparent') return 'transparent';
    }
    return null;
}
