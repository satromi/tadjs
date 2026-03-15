/**
 * パターン定義（グローバル変数登録用ラッパー）
 *
 * 実体は js/pattern-utils.js に移動済み。
 * このファイルは既存の非モジュールスクリプトとしての読み込みを維持するため、
 * グローバル変数への登録を行う。
 *
 * 注意: index.html で type="module" に変更する必要がある。
 */
import { DEFAULT_PATTERNS, createPatternCanvas, createFillPattern, createPatternPreviewCanvas, buildPatternFromTadParams, findSolidColorPatternId, resolvePatternColor } from '../../js/pattern-utils.js';

window.DEFAULT_PATTERNS = DEFAULT_PATTERNS;
window.createPatternCanvas = createPatternCanvas;
window.createFillPattern = createFillPattern;
window.createPatternPreviewCanvas = createPatternPreviewCanvas;
window.buildPatternFromTadParams = buildPatternFromTadParams;
window.findSolidColorPatternId = findSolidColorPatternId;
window.resolvePatternColor = resolvePatternColor;
