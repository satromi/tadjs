/**
 * UISettingsManager - UI設定管理クラス
 * ステータスバー、背景、ユーザー設定を管理
 */

import { getLogger } from './logger.js';

const logger = getLogger('UISettingsManager');

export class UISettingsManager {
    /**
     * @param {Object} options - 初期化オプション
     * @param {Object} options.parentMessageBus - メッセージバス
     */
    constructor(options = {}) {
        this.parentMessageBus = options.parentMessageBus;

        // ステータス関連
        this.statusMessageTimer = null;
        this.statusTimeUpdateInterval = null;

        // 使用者名
        this.currentUser = null;

        logger.debug('UISettingsManager initialized');
    }

    /**
     * ステータスバーをセットアップして時刻表示を開始
     */
    setupStatusBar() {
        // 既存タイマーのクリーンアップ（再呼び出し対策）
        if (this._statusSetupTimeout) {
            clearTimeout(this._statusSetupTimeout);
        }
        if (this.statusTimeUpdateInterval) {
            clearInterval(this.statusTimeUpdateInterval);
        }

        // 即座に時刻を更新
        this.updateStatusTime();

        // 次の秒の開始時点に合わせてタイマーを開始
        const now = new Date();
        const msUntilNextSecond = 1000 - now.getMilliseconds();

        // 次の秒の開始時点で最初の更新を行い、その後1秒ごとに更新
        this._statusSetupTimeout = setTimeout(() => {
            this.updateStatusTime();
            this.statusTimeUpdateInterval = setInterval(() => this.updateStatusTime(), window.STATUS_UPDATE_INTERVAL_MS);
        }, msUntilNextSecond);
    }

    /**
     * ステータスバーの時刻表示を更新
     */
    updateStatusTime() {
        const now = new Date();
        const timeString = now.getFullYear() + '/' +
                          String(now.getMonth() + 1).padStart(2, '0') + '/' +
                          String(now.getDate()).padStart(2, '0') + ' ' +
                          String(now.getHours()).padStart(2, '0') + ':' +
                          String(now.getMinutes()).padStart(2, '0') + ':' +
                          String(now.getSeconds()).padStart(2, '0');

        const statusTimeEl = document.getElementById('status-time');
        if (statusTimeEl) statusTimeEl.textContent = timeString;
    }

    /**
     * ステータスメッセージを表示（5秒後に自動消去）
     * @param {string} message - 表示するメッセージ
     */
    setStatusMessage(message) {
        // 既存のタイマーをクリア
        if (this.statusMessageTimer) {
            clearTimeout(this.statusMessageTimer);
            this.statusMessageTimer = null;
        }

        const statusMsgEl = document.getElementById('status-message');
        if (!statusMsgEl) return;
        statusMsgEl.textContent = message;

        // 5秒後に元に戻す
        this.statusMessageTimer = setTimeout(() => {
            statusMsgEl.textContent = 'システム準備完了';
            this.statusMessageTimer = null;
        }, window.STATUS_MESSAGE_DURATION_MS);
    }

    /**
     * 保存された背景設定を読み込んで適用
     */
    loadSavedBackground() {
        const savedBackground = localStorage.getItem('selectedBackground');
        if (savedBackground) {
            this.applyBackgroundToDesktop(savedBackground);
        }
    }

    /**
     * デスクトップに背景を適用
     * @param {string} bgId - 背景のID（'none'の場合は背景なし）
     */
    applyBackgroundToDesktop(bgId) {
        const desktop = document.getElementById('desktop');

        if (bgId === 'none') {
            desktop.style.backgroundImage = 'none';
            desktop.style.backgroundColor = window.DESKTOP_BG_COLOR;
        } else {
            let savedBackgrounds = [];
            try {
                savedBackgrounds = JSON.parse(localStorage.getItem('systemBackgrounds') || '[]');
            } catch (e) {
                logger.warn('systemBackgrounds の JSON パースに失敗:', e);
            }
            const background = savedBackgrounds.find(bg => bg.id === bgId);

            if (background) {
                desktop.style.backgroundImage = `url('${background.data}')`;
                desktop.style.backgroundRepeat = 'no-repeat';
                desktop.style.backgroundSize = 'cover';
                desktop.style.backgroundPosition = 'center';
            }
        }
    }

    /**
     * ユーザー環境設定を適用
     */
    applyUserConfig() {
        // 使用者名を読み込み
        this.currentUser = localStorage.getItem('username') || 'TRON User';
        logger.info('[UISettingsManager] 使用者名を読み込みました:', this.currentUser);

        // タイトル文字サイズ
        const titleFontSize = parseInt(localStorage.getItem('title-font-size') || '14', 10);
        document.documentElement.style.setProperty('--title-font-size', titleFontSize + 'px');
        // タイトルバーの高さをフォントサイズに合わせて調整（フォントサイズ + 余白）
        const titlebarHeight = titleFontSize + 8; // 上下4pxずつの余白
        document.documentElement.style.setProperty('--titlebar-height', titlebarHeight + 'px');

        // スクロールバー幅
        const scrollbarWidth = localStorage.getItem('scrollbar-width') || '12';
        document.documentElement.style.setProperty('--scrollbar-width', scrollbarWidth + 'px');

        // メニュー文字サイズ
        const menuFontSize = localStorage.getItem('menu-font-size') || '14';
        document.documentElement.style.setProperty('--menu-font-size', menuFontSize + 'px');

        // カーソル点滅間隔
        const cursorBlink = localStorage.getItem('cursor-blink') || '800';
        document.documentElement.style.setProperty('--cursor-blink-interval', cursorBlink + 'ms');

        // 選択枠チラつき間隔
        const selectionBlink = localStorage.getItem('selection-blink') || '600';
        document.documentElement.style.setProperty('--selection-blink-interval', selectionBlink + 'ms');

        // メニュー反応時間
        const menuDelay = localStorage.getItem('menu-delay') || '200';
        document.documentElement.style.setProperty('--menu-delay', menuDelay + 'ms');

        // カーソル太さ
        const cursorWidth = localStorage.getItem('cursor-width') || '1';
        document.documentElement.style.setProperty('--cursor-width', cursorWidth + 'px');

        // ポインタ表示サイズ
        const pointerSize = localStorage.getItem('pointer-size') || 'small';
        const cursorSizeMap = { small: '16px', medium: '24px', large: '32px' };
        document.documentElement.style.setProperty('--pointer-size', cursorSizeMap[pointerSize] || '16px');

        // 選択枠太さ
        const selectionWidth = localStorage.getItem('selection-width') || '1';
        document.documentElement.style.setProperty('--selection-width', selectionWidth + 'px');

        logger.info('[UISettingsManager] ユーザ環境設定を適用しました');

        // 全てのプラグインに設定変更を通知
        if (this.parentMessageBus) {
            this.parentMessageBus.broadcast('user-config-updated', {});
        }
    }

    /**
     * 現在の使用者名を取得
     * @returns {string} 使用者名
     */
    getCurrentUser() {
        return this.currentUser || 'TRON User';
    }
}
