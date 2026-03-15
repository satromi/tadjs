/**
 * ContextMenuManager - コンテキストメニュー管理クラス
 * TADjs Desktopのコンテキストメニュー表示・操作を担当
 * @module ContextMenuManager
 */

import { getLogger } from './logger.js';
import { MENU_FETCH_TIMEOUT_MS, CONTEXT_MENU_FLAG_CLEAR_MS } from './util.js';

const logger = getLogger('ContextMenuManager');

/** 表示モード定数 */
const DISPLAY_MODE = {
    MANUSCRIPT: '0',  // 原稿モード
    DETAIL: '2',      // 詳細モード
    FAIR_COPY: '3'    // 清書モード
};

/** コンテキストメニューアクション定数 */
const MENU_ACTION = {
    OPEN: 'open',
    OPEN_VOBJ: 'open-vobj',
    VOBJ_PROPERTIES: 'vobj-properties',
    PROPERTIES: 'properties',
    CLOSE: 'close',
    MINIMIZE: 'minimize',
    TOGGLE_PAPER_MODE: 'toggle-paper-mode',
    SET_DISPLAY_MODE: 'set-display-mode',
    TOGGLE_WRAP: 'toggle-wrap-at-window-width',
    LAUNCH_ACCESSORY: 'launch-accessory',
    WINDOW_PROPERTIES: 'window-properties',
    PLUGIN_ACTION: 'plugin-action'
};

export class ContextMenuManager {
    /**
     * @param {Object} options - 初期化オプション
     * @param {Object} options.parentMessageBus - メッセージバス
     * @param {Function} options.getWindows - windows Mapを取得する関数
     * @param {Function} options.closeWindow - ウィンドウクローズ関数
     * @param {Function} options.setStatusMessage - ステータスメッセージ設定関数
     * @param {Function} options.openVirtualObject - 仮身を開く関数
     * @param {Function} options.showVirtualObjectProperties - 仮身プロパティ表示関数
     * @param {Function} options.showFileProperties - ファイルプロパティ表示関数
     * @param {Function} options.togglePaperMode - 用紙モードトグル関数
     * @param {Function} options.setDisplayMode - 表示モード設定関数
     * @param {Function} options.toggleWrapAtWindowWidth - ウィンドウ幅折り返しトグル関数
     * @param {Function} options.showWindowProperties - ウィンドウプロパティ表示関数
     * @param {Function} options.launchPluginForFile - プラグイン起動関数
     * @param {Function} options.openTADFile - TADファイルを開く関数
     * @param {Function} options.getFileObjects - fileObjectsを取得する関数
     * @param {Function} options.getActiveWindow - アクティブウィンドウIDを取得する関数
     */
    constructor(options = {}) {
        this.parentMessageBus = options.parentMessageBus;
        this.getWindows = options.getWindows;
        this.closeWindow = options.closeWindow;
        this.setStatusMessage = options.setStatusMessage;
        this.openVirtualObject = options.openVirtualObject;
        this.showVirtualObjectProperties = options.showVirtualObjectProperties;
        this.showFileProperties = options.showFileProperties;
        this.togglePaperMode = options.togglePaperMode;
        this.setDisplayMode = options.setDisplayMode;
        this.toggleWrapAtWindowWidth = options.toggleWrapAtWindowWidth;
        this.showWindowProperties = options.showWindowProperties;
        this.launchPluginForFile = options.launchPluginForFile;
        this.openTADFile = options.openTADFile;
        this.getFileObjects = options.getFileObjects;
        this.getActiveWindow = options.getActiveWindow;

        this.contextMenu = null;
        this.justOpenedContextMenu = false;

        logger.debug('ContextMenuManager initialized');
    }

    /**
     * イベントリスナーを設定
     */
    setupEventListeners() {
        // contextmenuイベント
        document.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.justOpenedContextMenu = true;
            setTimeout(() => {
                this.justOpenedContextMenu = false;
            }, CONTEXT_MENU_FLAG_CLEAR_MS);
            this.showContextMenu(e.pageX, e.pageY, e.target);
        });

        // クリックイベント - コンテキストメニュー外をクリックしたら閉じる
        document.addEventListener('click', (e) => {
            if (this.justOpenedContextMenu) {
                return;
            }
            if (!e.target.closest('.context-menu')) {
                this.hideContextMenu();
            }
        });

        // Escapeキーでメニューを閉じる
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hideContextMenu();
            }
        });

        logger.debug('Event listeners initialized');
    }

    /**
     * MessageBusのハンドラーを登録
     */
    setupMessageBusHandlers() {
        if (!this.parentMessageBus) return;

        // context-menu-request: コンテキストメニュー表示
        this.parentMessageBus.on('context-menu-request', (data, event) => {
            logger.debug('[ContextMenuManager] context-menu-request受信:', data);
            const target = event.source.frameElement;
            if (!target) {
                logger.warn('[ContextMenuManager] target frameElementが見つかりません');
                return;
            }

            // カスタムメニュー項目が指定されている場合（子パネルウインドウ等）
            if (data.menuItems && Array.isArray(data.menuItems)) {
                const windowElement = target.closest('.window');
                const windowId = windowElement ? windowElement.id : null;
                const items = [];

                // 共通項目（閉じる）
                if (windowId) {
                    items.push(...this.generateCommonWindowMenuItems(windowId));
                    items.push({ separator: true });
                }

                // カスタムメニュー項目を「編集」サブメニューとして追加
                const submenuItems = [];
                data.menuItems.forEach(item => {
                    if (item.separator) {
                        submenuItems.push({ separator: true });
                    } else {
                        submenuItems.push({
                            text: item.text,
                            action: `child-panel-${item.action}`,
                            data: { windowId }
                        });
                    }
                });
                if (submenuItems.length > 0) {
                    items.push({
                        text: '編集',
                        submenu: submenuItems
                    });
                }

                // 「小物」タイプのプラグインをサブメニューとして追加
                this._appendAccessorySubmenu(items);

                this.createContextMenu(items, data.x, data.y);
                return;
            }

            this.showContextMenu(data.x, data.y, target);
        });

        // close-context-menu: コンテキストメニューを閉じる
        this.parentMessageBus.on('close-context-menu', (_data) => {
            this.hideContextMenu();
        });

        logger.debug('MessageBus handlers registered');
    }

    /**
     * コンテキストメニューを表示
     * @param {number} x - X座標
     * @param {number} y - Y座標
     * @param {HTMLElement} target - ターゲット要素
     */
    async showContextMenu(x, y, target) {
        logger.debug('[ContextMenuManager] showContextMenu呼び出し, target:', target);
        const menuItems = await this.generateContextMenuItems(target);
        logger.debug('[ContextMenuManager] 生成されたメニュー項目:', menuItems);
        this.createContextMenu(menuItems, x, y);
    }

    /**
     * コンテキストメニュー項目を生成
     * @param {HTMLElement} target - ターゲット要素
     * @returns {Promise<Array>} メニュー項目の配列
     */
    async generateContextMenuItems(target) {
        const items = [];
        const windows = this.getWindows();

        // ウインドウ要素を特定（デスクトップの場合はアクティブウインドウにフォールバック）
        let windowElement = target.closest('.window');
        if (!windowElement) {
            const activeWindowId = this.getActiveWindow();
            if (activeWindowId) {
                windowElement = document.getElementById(activeWindowId);
            }
        }

        if (windowElement) {
            const windowId = windowElement.id;
            const windowInfo = windows.get(windowId);

            // TADウィンドウかどうかを判定
            if (windowInfo && windowInfo.canvasId) {
                const canvasId = windowInfo.canvasId;
                const paperModeEnabled = windowElement.dataset.paperMode === 'true';
                const displayMode = windowElement.dataset.displayMode || DISPLAY_MODE.FAIR_COPY;
                const wrapAtWindowWidth = windowElement.dataset.wrapAtWindowWidth !== 'false';

                // 共通メニュー項目を追加
                items.push(...this.generateCommonWindowMenuItems(windowId));
                items.push({ separator: true });

                // TADウィンドウ固有のメニュー
                items.push(
                    { text: displayMode === DISPLAY_MODE.MANUSCRIPT ? '✓ 1: 原稿モード' : '1: 原稿モード', action: MENU_ACTION.SET_DISPLAY_MODE, data: { windowId, canvasId, mode: DISPLAY_MODE.MANUSCRIPT } },
                    { text: displayMode === DISPLAY_MODE.DETAIL ? '✓ 2: 詳細モード' : '2: 詳細モード', action: MENU_ACTION.SET_DISPLAY_MODE, data: { windowId, canvasId, mode: DISPLAY_MODE.DETAIL } },
                    { text: displayMode === DISPLAY_MODE.FAIR_COPY ? '✓ 3: 清書モード' : '3: 清書モード', action: MENU_ACTION.SET_DISPLAY_MODE, data: { windowId, canvasId, mode: DISPLAY_MODE.FAIR_COPY } },
                    { text: wrapAtWindowWidth ? '✓ ウインドウ幅で折り返し' : 'ウインドウ幅で折り返し', action: MENU_ACTION.TOGGLE_WRAP, data: { windowId, canvasId } },
                    { separator: true },
                    { text: paperModeEnabled ? '✓ 用紙モード' : '用紙モード', action: MENU_ACTION.TOGGLE_PAPER_MODE, data: { windowId, canvasId } },
                    { separator: true },
                    { text: 'プロパティ', action: MENU_ACTION.WINDOW_PROPERTIES }
                );
            } else {
                // プラグインウィンドウ、iframeウィンドウ、または子パネルウィンドウかどうかを確認
                const iframe = windowElement.querySelector('iframe[data-plugin-id]') ||
                               windowElement.querySelector('iframe[data-iframe-src]') ||
                               windowElement.querySelector('iframe');
                if (iframe && iframe.contentWindow) {
                    // 共通メニュー項目を追加
                    items.push(...this.generateCommonWindowMenuItems(windowId));

                    // プラグインからメニュー定義を取得
                    try {
                        const pluginMenuItems = await this.getPluginMenuDefinition(iframe, windowId);
                        if (pluginMenuItems.length > 0) {
                            items.push({ separator: true });
                            items.push(...pluginMenuItems);
                        }
                    } catch (error) {
                        logger.error('[ContextMenuManager] プラグインメニュー取得エラー:', error);
                        // フォールバック: 基本メニューのみ
                    }

                    // 「小物」タイプのプラグインをサブメニューとして追加
                    this._appendAccessorySubmenu(items);
                } else {
                    // 通常ウィンドウのメニュー（初期ウィンドウなど）
                    // 選択中のファイルがあるかチェック
                    const selectedFileIcon = windowElement.querySelector('.file-icon.selected');
                    const fileName = selectedFileIcon ? selectedFileIcon.dataset.fileName : null;

                    items.push(
                        { text: '閉じる', action: MENU_ACTION.CLOSE, shortcut: 'Ctrl+E' },
                        { text: '最小化', action: MENU_ACTION.MINIMIZE }
                    );

                    // 「小物」タイプのプラグインをサブメニューとして追加
                    this._appendAccessorySubmenu(items);

                    // ファイルが選択されている場合、「実行」メニューを追加
                    if (window.pluginManager && fileName) {
                        const pluginMenus = window.pluginManager.getContextMenuForFile(fileName);
                        if (pluginMenus.length > 0) {
                            const executeSubmenu = pluginMenus.map(menu => ({
                                text: menu.label,
                                action: MENU_ACTION.PLUGIN_ACTION,
                                data: { pluginId: menu.pluginId, fileName: fileName }
                            }));

                            items.push(
                                { separator: true },
                                {
                                    text: '実行',
                                    submenu: executeSubmenu
                                }
                            );
                        }
                    }
                }
            }
        } else {
            // デスクトップのメニュー
            // 「小物」タイプのプラグインをサブメニューとして追加
            this._appendAccessorySubmenu(items, { addSeparator: false });
        }

        return items;
    }

    /**
     * 共通のウィンドウメニュー項目を生成
     * @param {string} windowId - ウィンドウID
     * @returns {Array} メニュー項目の配列
     */
    generateCommonWindowMenuItems(windowId) {
        return [
            { text: '閉じる', action: MENU_ACTION.CLOSE, shortcut: 'Ctrl+E', data: { windowId } }
        ];
    }

    /**
     * コンテキストメニューを作成・表示
     * @param {Array<Object>} items - メニュー項目の配列
     * @param {number} x - メニューのX座標
     * @param {number} y - メニューのY座標
     */
    createContextMenu(items, x, y) {
        logger.debug('[ContextMenuManager] createContextMenu呼び出し, items:', items, 'x:', x, 'y:', y);
        // 既存のメニューを削除
        this.hideContextMenu();

        const menu = document.createElement('div');
        menu.className = 'context-menu';
        menu.id = 'dynamic-context-menu';

        this.renderMenuItems(menu, items);

        // 画面端での位置調整
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';
        menu.style.display = 'block';

        document.body.appendChild(menu);

        // 画面からはみ出る場合の調整
        const rect = menu.getBoundingClientRect();
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;

        if (rect.right > windowWidth) {
            menu.style.left = (x - rect.width) + 'px';
        }
        if (rect.bottom > windowHeight) {
            menu.style.top = (y - rect.height) + 'px';
        }
    }

    /**
     * メニュー項目をレンダリング
     * @param {HTMLElement} container - メニュー項目を追加するコンテナ要素
     * @param {Array<Object>} items - メニュー項目の配列
     */
    renderMenuItems(container, items) {
        items.forEach(item => {
            if (item.separator) {
                const separator = document.createElement('div');
                separator.className = 'menu-separator';
                container.appendChild(separator);
            } else if (item.submenu) {
                // サブメニューがある場合
                const menuItem = document.createElement('div');
                menuItem.className = 'menu-item has-submenu';

                const textSpan = document.createElement('span');
                textSpan.className = 'menu-text';
                textSpan.textContent = item.text;
                menuItem.appendChild(textSpan);

                const arrow = document.createElement('span');
                arrow.className = 'menu-arrow';
                arrow.textContent = '▶';
                menuItem.appendChild(arrow);

                // サブメニューコンテナ
                const submenu = document.createElement('div');
                submenu.className = 'context-submenu';
                this.renderMenuItems(submenu, item.submenu);
                menuItem.appendChild(submenu);

                // マウスオーバー時にサブメニューの位置を調整
                menuItem.addEventListener('mouseenter', () => {
                    this.adjustSubmenuPosition(submenu);
                });

                container.appendChild(menuItem);
            } else {
                const menuItem = document.createElement('div');
                menuItem.className = 'menu-item';
                menuItem.dataset.action = item.action;

                // XSS対策: DOM APIを使用して安全に設定
                if (item.shortcut) {
                    const textSpan = document.createElement('span');
                    textSpan.className = 'menu-text';
                    textSpan.textContent = item.text;

                    const shortcutSpan = document.createElement('span');
                    shortcutSpan.className = 'menu-shortcut';
                    shortcutSpan.textContent = item.shortcut;

                    menuItem.appendChild(textSpan);
                    menuItem.appendChild(shortcutSpan);
                } else {
                    menuItem.textContent = item.text;
                }

                menuItem.onclick = () => {
                    this.handleMenuAction(item.action, item.data);
                    this.hideContextMenu();
                };

                container.appendChild(menuItem);
            }
        });
    }

    /**
     * サブメニューの位置を画面内に収まるように調整
     * @param {HTMLElement} submenu - 調整するサブメニュー要素
     */
    adjustSubmenuPosition(submenu) {
        // サブメニューを一時的に表示して位置を測定
        submenu.style.display = 'block';

        const rect = submenu.getBoundingClientRect();
        const windowHeight = window.innerHeight;
        const windowWidth = window.innerWidth;

        // 右側にはみ出る場合は左側に表示
        if (rect.right > windowWidth) {
            submenu.style.left = 'auto';
            submenu.style.right = '100%';
        } else {
            submenu.style.left = '100%';
            submenu.style.right = 'auto';
        }

        // 下側にはみ出る場合は上に調整
        if (rect.bottom > windowHeight) {
            const overflow = rect.bottom - windowHeight;
            const currentTop = parseInt(submenu.style.top || '-2') || -2;
            submenu.style.top = (currentTop - overflow - 10) + 'px';
        }

        // 上側にはみ出る場合は下に調整
        if (rect.top < 0) {
            const overflow = -rect.top;
            const currentTop = parseInt(submenu.style.top || '-2') || -2;
            submenu.style.top = (currentTop + overflow + 10) + 'px';
        }

        // 表示状態をCSSのホバーに任せる（一時的な表示を解除）
        submenu.style.display = '';
    }

    /**
     * コンテキストメニューを非表示にする
     */
    hideContextMenu() {
        logger.debug('[ContextMenuManager] hideContextMenu呼び出し');
        const staticMenu = document.getElementById('context-menu');
        const dynamicMenu = document.getElementById('dynamic-context-menu');

        if (staticMenu) {
            logger.debug('[ContextMenuManager] 静的メニューを非表示');
            staticMenu.style.display = 'none';
        }
        if (dynamicMenu) {
            logger.debug('[ContextMenuManager] 動的メニューを削除');
            dynamicMenu.remove();
        }
    }

    /**
     * メニューアクションを処理
     * @param {string} action - 実行するアクション名
     * @param {*} data - アクションに渡すデータ
     */
    handleMenuAction(action, data) {
        const selectedIcon = document.querySelector('.file-icon.selected');
        const fileObjects = this.getFileObjects();

        switch (action) {
            case MENU_ACTION.OPEN:
                if (selectedIcon) {
                    const filename = selectedIcon.dataset.filename;
                    // ファイルオブジェクトを再取得（保存されている場合）
                    if (fileObjects && fileObjects[filename]) {
                        this.openTADFile(fileObjects[filename]);
                    } else {
                        this.setStatusMessage(`エラー: ${filename} のデータが見つかりません`);
                    }
                }
                break;

            case MENU_ACTION.OPEN_VOBJ:
                if (data) {
                    this.openVirtualObject(data);
                }
                break;

            case MENU_ACTION.VOBJ_PROPERTIES:
                if (data) {
                    this.showVirtualObjectProperties(data);
                }
                break;

            case MENU_ACTION.PROPERTIES:
                if (selectedIcon) {
                    const filename = selectedIcon.dataset.filename;
                    this.showFileProperties(filename);
                }
                break;

            case MENU_ACTION.CLOSE:
                if (data && data.windowId) {
                    this.closeWindow(data.windowId);
                } else {
                    const activeWindow = this.getActiveWindow();
                    if (activeWindow) {
                        this.closeWindow(activeWindow);
                    }
                }
                break;

            case MENU_ACTION.MINIMIZE:
                if (data && data.windowId) {
                    // 将来的に実装
                    this.setStatusMessage('最小化機能は未実装です');
                } else {
                    this.setStatusMessage('最小化機能は未実装です');
                }
                break;

            case MENU_ACTION.TOGGLE_PAPER_MODE:
                if (data && data.windowId && data.canvasId) {
                    this.togglePaperMode(data.windowId, data.canvasId);
                }
                break;

            case MENU_ACTION.SET_DISPLAY_MODE:
                if (data && data.windowId && data.canvasId && data.mode) {
                    this.setDisplayMode(data.windowId, data.canvasId, data.mode);
                }
                break;

            case MENU_ACTION.TOGGLE_WRAP:
                if (data && data.windowId && data.canvasId) {
                    this.toggleWrapAtWindowWidth(data.windowId, data.canvasId);
                }
                break;

            case MENU_ACTION.LAUNCH_ACCESSORY:
                if (data && data.pluginId && window.pluginManager) {
                    window.pluginManager.launchPlugin(data.pluginId);
                }
                break;

            case MENU_ACTION.WINDOW_PROPERTIES:
                const activeWindow = this.getActiveWindow();
                if (activeWindow) {
                    this.showWindowProperties(activeWindow);
                }
                break;

            case MENU_ACTION.PLUGIN_ACTION:
                if (data && data.pluginId && data.fileName) {
                    this.launchPluginForFile(data.pluginId, data.fileName);
                }
                break;

            // プラグインアクション（基本文章編集）
            default:
                if (action && action.startsWith('child-panel-')) {
                    this.handleChildPanelAction(action, data);
                } else if (action && action.startsWith('plugin-')) {
                    this.handlePluginAction(action, data);
                }
                break;
        }
    }

    /**
     * プラグインアクションを処理
     * @param {string} action - 実行するアクション名
     * @param {Object} data - アクションに渡すデータ
     */
    handlePluginAction(action, data) {
        if (!data || !data.windowId) return;

        const windowElement = document.getElementById(data.windowId);
        if (!windowElement) return;

        const iframe = windowElement.querySelector('iframe[data-plugin-id]') ||
                       windowElement.querySelector('iframe');
        if (!iframe || !iframe.contentWindow) return;

        // アクション名から "plugin-" プレフィックスを除去
        const pluginAction = action.replace('plugin-', '');

        // iframeにメッセージを送信
        this.parentMessageBus.sendToWindow(data.windowId, 'menu-action', {
            action: pluginAction
        });

        logger.debug('[ContextMenuManager] プラグインアクション送信:', pluginAction);
    }

    /**
     * 子パネルウインドウのアクションを処理
     * @param {string} action - 実行するアクション名（child-panel-プレフィックス付き）
     * @param {Object} data - アクションに渡すデータ
     */
    handleChildPanelAction(action, data) {
        if (!data || !data.windowId) return;

        // アクション名から "child-panel-" プレフィックスを除去
        const panelAction = action.replace('child-panel-', '');

        // 子パネルウインドウにメッセージを送信
        this.parentMessageBus.sendToWindow(data.windowId, 'menu-action', {
            action: panelAction
        });
    }

    /**
     * プラグインからメニュー定義を取得
     * @param {HTMLIFrameElement} iframe - プラグインのiframe要素
     * @param {string} windowId - ウィンドウID
     * @returns {Promise<Array>} メニュー項目の配列
     */
    getPluginMenuDefinition(iframe, windowId) {
        return new Promise((resolve, reject) => {
            const messageId = `menu-request-${Date.now()}`;
            logger.debug('[ContextMenuManager] プラグインメニュー定義を要求:', messageId);
            const timeout = setTimeout(() => {
                logger.error('[ContextMenuManager] プラグインメニュー取得タイムアウト:', messageId);
                window.removeEventListener('message', handler);
                reject(new Error('プラグインメニュー取得タイムアウト'));
            }, MENU_FETCH_TIMEOUT_MS);

            const handler = (event) => {
                if (event.data && event.data.type === 'menu-definition-response' && event.data.messageId === messageId) {
                    logger.debug('[ContextMenuManager] menu-definition-response受信:', event.data);
                    clearTimeout(timeout);
                    window.removeEventListener('message', handler);

                    // プラグインのメニュー定義をパースして、windowIdをdataに追加
                    const menuItems = this.parsePluginMenuDefinition(event.data.menuDefinition, windowId);
                    logger.debug('[ContextMenuManager] パース後のメニュー項目:', menuItems);
                    resolve(menuItems);
                }
            };

            window.addEventListener('message', handler);

            // プラグインにメニュー定義を要求
            this.parentMessageBus.sendToWindow(windowId, 'get-menu-definition', {
                messageId: messageId
            });
        });
    }

    /**
     * プラグインのメニュー定義をパースして、actionにplugin-プレフィックスとwindowIdを追加
     */
    parsePluginMenuDefinition(menuDef, windowId) {
        if (!Array.isArray(menuDef)) return [];

        return menuDef.map(item => {
            if (item.separator) {
                return { separator: true };
            }

            const parsed = {
                text: item.label || item.text
            };

            if (item.shortcut) {
                parsed.shortcut = item.shortcut;
            }

            if (item.submenu) {
                parsed.submenu = this.parsePluginMenuDefinition(item.submenu, windowId);
            } else if (item.action) {
                // actionにplugin-プレフィックスを追加
                parsed.action = `plugin-${item.action}`;
                parsed.data = { windowId };
            }

            return parsed;
        });
    }

    /**
     * アクセサリプラグインのサブメニュー項目を生成してitemsに追加
     * @param {Array} items - メニュー項目配列
     * @param {Object} [options] - オプション
     * @param {boolean} [options.addSeparator=true] - セパレータを追加するか
     * @private
     */
    _appendAccessorySubmenu(items, options = {}) {
        const { addSeparator = true } = options;
        if (!window.pluginManager) return;

        const accessoryPlugins = window.pluginManager.getAccessoryPlugins();
        if (accessoryPlugins.length === 0) return;

        const accessorySubmenu = accessoryPlugins.map(plugin => ({
            text: plugin.name,
            action: MENU_ACTION.LAUNCH_ACCESSORY,
            data: { pluginId: plugin.id }
        }));

        if (addSeparator) {
            items.push({ separator: true });
        }
        items.push({ text: '小物', submenu: accessorySubmenu });
    }
}
