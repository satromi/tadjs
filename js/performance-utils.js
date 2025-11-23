/**
 * TADjs Desktopパフォーマンス最適化ユーティリティ
 *
 * スロットル、デバウンス、requestAnimationFrameベースの最適化関数を提供
 */

/**
 * デバウンス: 最後の呼び出しから指定時間後に1回だけ実行
 *
 * 使用例: 検索ボックスの入力、ウィンドウリサイズ、ファイル保存
 *
 * @param {Function} func - 実行する関数
 * @param {number} delay - 遅延時間（ミリ秒）
 * @returns {Function} - デバウンスされた関数
 */
export function debounce(func, delay) {
    let timeoutId;

    const debounced = function(...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
            func.apply(this, args);
        }, delay);
    };

    // 強制実行メソッド（ウィンドウクローズ時など）
    debounced.flush = function() {
        clearTimeout(timeoutId);
        if (func) {
            func.call(this);
        }
    };

    // キャンセルメソッド
    debounced.cancel = function() {
        clearTimeout(timeoutId);
    };

    return debounced;
}

/**
 * スロットル: 指定時間内に最大1回だけ実行
 *
 * 使用例: スクロールイベント、マウス移動、描画処理
 *
 * @param {Function} func - 実行する関数
 * @param {number} delay - 最小間隔（ミリ秒）
 * @returns {Function} - スロットルされた関数
 */
export function throttle(func, delay) {
    let lastCall = 0;
    let timeoutId;

    const throttled = function(...args) {
        const now = Date.now();
        const timeSinceLastCall = now - lastCall;

        if (timeSinceLastCall >= delay) {
            // 即座に実行
            lastCall = now;
            func.apply(this, args);
        } else {
            // 次の実行をスケジュール
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
                lastCall = Date.now();
                func.apply(this, args);
            }, delay - timeSinceLastCall);
        }
    };

    // 即座に実行メソッド（mouseup時など）
    throttled.immediate = function(...args) {
        clearTimeout(timeoutId);
        lastCall = Date.now();
        func.apply(this, args);
    };

    return throttled;
}

/**
 * requestAnimationFrame ベースのスロットル（60FPS制限）
 *
 * 使用例: Canvas描画、アニメーション、ビジュアル更新
 *
 * @param {Function} func - 実行する関数
 * @returns {Function} - スロットルされた関数
 */
export function throttleRAF(func) {
    let rafId;
    let pending = false;
    let lastArgs = null;
    let lastContext = null;

    const throttled = function(...args) {
        // 最新の引数とコンテキストを保存
        lastArgs = args;
        lastContext = this;

        if (!pending) {
            pending = true;
            rafId = requestAnimationFrame(() => {
                // 最新の引数とコンテキストで実行
                func.apply(lastContext, lastArgs);
                pending = false;
                lastArgs = null;
                lastContext = null;
            });
        }
    };

    throttled.cancel = function() {
        if (rafId) {
            cancelAnimationFrame(rafId);
        }
        pending = false;
        lastArgs = null;
        lastContext = null;
    };

    throttled.immediate = function(...args) {
        throttled.cancel();
        func.apply(this, args);
    };

    return throttled;
}

// グローバルスコープにもエクスポート（非ES6モジュール環境用）
if (typeof window !== 'undefined') {
    window.debounce = debounce;
    window.throttle = throttle;
    window.throttleRAF = throttleRAF;
}
