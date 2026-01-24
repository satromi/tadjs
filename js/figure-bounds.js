/**
 * 図形要素の境界計算ユーティリティ
 * XTAD内の全座標要素から境界ボックス（バウンディングボックス）を計算
 */

import { getLogger } from './logger.js';

const logger = getLogger('FigureBounds');

/**
 * XTAD XMLから全コンテンツの境界を計算
 * @param {string} xmlData - XTAD XML文字列
 * @returns {Object} { left, top, right, bottom, width, height }
 */
export function calculateFigureContentBounds(xmlData) {
    if (!xmlData) {
        return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    }

    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlData, 'text/xml');

    // パースエラーチェック
    const parseError = xmlDoc.querySelector('parsererror');
    if (parseError) {
        logger.warn('[FigureBounds] XMLパースエラー');
        return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    }

    let minLeft = Infinity;
    let minTop = Infinity;
    let maxRight = 0;
    let maxBottom = 0;

    // 境界更新ヘルパー
    function updateBounds(left, top, right, bottom) {
        if (left < minLeft) minLeft = left;
        if (top < minTop) minTop = top;
        if (right > maxRight) maxRight = right;
        if (bottom > maxBottom) maxBottom = bottom;
    }

    // 1. <link> 要素（仮身）
    xmlDoc.querySelectorAll('link').forEach(el => {
        const left = parseFloat(el.getAttribute('vobjleft')) || 0;
        const top = parseFloat(el.getAttribute('vobjtop')) || 0;
        const right = parseFloat(el.getAttribute('vobjright')) || 0;
        const bottom = parseFloat(el.getAttribute('vobjbottom')) || 0;
        if (right > 0 || bottom > 0) {
            updateBounds(left, top, right, bottom);
        }
    });

    // 2. <rect> 要素（矩形）
    xmlDoc.querySelectorAll('rect').forEach(el => {
        const left = parseFloat(el.getAttribute('left')) || 0;
        const top = parseFloat(el.getAttribute('top')) || 0;
        const right = parseFloat(el.getAttribute('right')) || 0;
        const bottom = parseFloat(el.getAttribute('bottom')) || 0;
        if (right > 0 || bottom > 0) {
            updateBounds(left, top, right, bottom);
        }
    });

    // 3. <line> 要素（線）
    xmlDoc.querySelectorAll('line').forEach(el => {
        // points属性がある場合はそれを使用
        const points = el.getAttribute('points');
        if (points) {
            parseLinePoints(points).forEach(([x, y]) => {
                updateBounds(x, y, x, y);
            });
        } else {
            // left/top/right/bottom属性
            const left = parseFloat(el.getAttribute('left')) || 0;
            const top = parseFloat(el.getAttribute('top')) || 0;
            const right = parseFloat(el.getAttribute('right')) || 0;
            const bottom = parseFloat(el.getAttribute('bottom')) || 0;
            if (right > 0 || bottom > 0) {
                updateBounds(left, top, right, bottom);
            }
        }
    });

    // 4. <document> 要素（テキストボックス）
    xmlDoc.querySelectorAll('document').forEach(docEl => {
        const docView = docEl.querySelector('docView');
        if (docView) {
            const left = parseFloat(docView.getAttribute('viewleft')) || 0;
            const top = parseFloat(docView.getAttribute('viewtop')) || 0;
            const right = parseFloat(docView.getAttribute('viewright')) || 0;
            const bottom = parseFloat(docView.getAttribute('viewbottom')) || 0;
            if (right > 0 || bottom > 0) {
                updateBounds(left, top, right, bottom);
            }
        }
    });

    // 5. <image> 要素（画像）
    xmlDoc.querySelectorAll('image').forEach(el => {
        const left = parseFloat(el.getAttribute('left')) || 0;
        const top = parseFloat(el.getAttribute('top')) || 0;
        const right = parseFloat(el.getAttribute('right')) || 0;
        const bottom = parseFloat(el.getAttribute('bottom')) || 0;
        if (right > 0 || bottom > 0) {
            updateBounds(left, top, right, bottom);
        }
    });

    // 6. <ellipse> 要素（楕円）
    xmlDoc.querySelectorAll('ellipse').forEach(el => {
        const left = parseFloat(el.getAttribute('left')) || 0;
        const top = parseFloat(el.getAttribute('top')) || 0;
        const right = parseFloat(el.getAttribute('right')) || 0;
        const bottom = parseFloat(el.getAttribute('bottom')) || 0;
        if (right > 0 || bottom > 0) {
            updateBounds(left, top, right, bottom);
        }
    });

    // 7. <polygon> 要素（多角形）
    xmlDoc.querySelectorAll('polygon').forEach(el => {
        const points = el.getAttribute('points');
        if (points) {
            parseLinePoints(points).forEach(([x, y]) => {
                updateBounds(x, y, x, y);
            });
        }
    });

    // 8. <polyline> 要素（折れ線）
    xmlDoc.querySelectorAll('polyline').forEach(el => {
        const points = el.getAttribute('points');
        if (points) {
            parseLinePoints(points).forEach(([x, y]) => {
                updateBounds(x, y, x, y);
            });
        }
    });

    // コンテンツがない場合
    if (minLeft === Infinity) {
        logger.debug('[FigureBounds] コンテンツなし');
        return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    }

    const result = {
        left: minLeft,
        top: minTop,
        right: maxRight,
        bottom: maxBottom,
        width: maxRight - minLeft,
        height: maxBottom - minTop
    };

    logger.debug('[FigureBounds] 境界計算結果:', result);
    return result;
}

/**
 * line要素のpoints属性をパース
 * @param {string} pointsStr - "x1,y1 x2,y2 ..." 形式の文字列
 * @returns {Array<[number, number]>} 座標配列
 */
function parseLinePoints(pointsStr) {
    const points = [];
    const pairs = pointsStr.trim().split(/\s+/);
    for (const pair of pairs) {
        const [x, y] = pair.split(',').map(parseFloat);
        if (!isNaN(x) && !isNaN(y)) {
            points.push([x, y]);
        }
    }
    return points;
}

/**
 * figView/figDrawを実際のコンテンツ範囲に更新
 * @param {string} xmlData - XTAD XML文字列
 * @param {number} margin - マージン（デフォルト: 10）
 * @returns {string} 更新されたXTAD XML文字列
 */
export function updateFigViewToContentBounds(xmlData, margin = 10) {
    if (!xmlData) return xmlData;

    const bounds = calculateFigureContentBounds(xmlData);
    if (bounds.width === 0 && bounds.height === 0) {
        return xmlData; // コンテンツがない場合は変更しない
    }

    const newRight = Math.ceil(bounds.right + margin);
    const newBottom = Math.ceil(bounds.bottom + margin);

    // figView/figDrawを更新
    let updated = xmlData;
    updated = updated.replace(
        /<figView[^>]*\/>/,
        `<figView top="0" left="0" right="${newRight}" bottom="${newBottom}"/>`
    );
    updated = updated.replace(
        /<figDraw[^>]*\/>/,
        `<figDraw top="0" left="0" right="${newRight}" bottom="${newBottom}"/>`
    );

    logger.debug('[FigureBounds] figView/figDraw更新:', newRight, 'x', newBottom);
    return updated;
}
