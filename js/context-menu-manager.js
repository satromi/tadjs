/**
 * ContextMenuManager - コンテキストメニュー管理クラス
 * TADjs Desktopのコンテキストメニュー表示・操作を担当
 * @module ContextMenuManager
 */

import { getLogger } from './logger.js';
import { MENU_FETCH_TIMEOUT_MS, CONTEXT_MENU_FLAG_CLEAR_MS } from './util.js';

const logger = getLogger('ContextMenuManager');

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
     * @param {Function} options.showWindowList - ウィンドウ一覧表示関数
     * @param {Function} options.clearDesktop - デスクトップクリア関数
     * @param {Function} options.showSystemInfo - システム情報表示関数
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
        this.showWindowList = options.showWindowList;
        this.clearDesktop = options.clearDesktop;
        this.showSystemInfo = options.showSystemInfo;
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
            logger.info('[ContextMenuManager] context-menu-request受信:', data);
            const target = event.source.frameElement;
            if (!target) {
                logger.warn('[ContextMenuManager] target frameElementが見つかりません');
                return;
            }
            this.showContextMenu(data.x, data.y, target);
        });

        // close-context-menu: コンテキストメニューを閉じる
        this.parentMessageBus.on('close-context-menu', (_data) => {
            if (this.contextMenu) {
                this.contextMenu.style.display = 'none';
            }
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
        logger.info('[ContextMenuManager] showContextMenu呼び出し, target:', target);
        const menuItems = await this.generateContextMenuItems(target);
        logger.info('[ContextMenuManager] 生成されたメニュー項目:', menuItems);
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

        if (target.closest('.window')) {
            const windowElement = target.closest('.window');
            const windowId = windowElement.id;
            const windowInfo = windows.get(windowId);

            // TADウィンドウかどうかを判定
            if (windowInfo && windowInfo.canvasId) {
                const canvasId = windowInfo.canvasId;
                const paperModeEnabled = windowElement.dataset.paperMode === 'true';
                const displayMode = windowElement.dataset.displayMode || '3';
                const wrapAtWindowWidth = windowElement.dataset.wrapAtWindowWidth !== 'false';

                // 共通メニュー項目を追加
                items.push(...this.generateCommonWindowMenuItems(windowId));
                items.push({ separator: true });

                // TADウィンドウ固有のメニュー
                items.push(
                    { text: displayMode === '0' ? '✓ 1: 原稿モード' : '1: 原稿モード', action: 'set-display-mode', data: { windowId, canvasId, mode: '0' } },
                    { text: displayMode === '2' ? '✓ 2: 詳細モード' : '2: 詳細モード', action: 'set-display-mode', data: { windowId, canvasId, mode: '2' } },
                    { text: displayMode === '3' ? '✓ 3: 清書モード' : '3: 清書モード', action: 'set-display-mode', data: { windowId, canvasId, mode: '3' } },
                    { text: wrapAtWindowWidth ? '✓ ウインドウ幅で折り返し' : 'ウインドウ幅で折り返し', action: 'toggle-wrap-at-window-width', data: { windowId, canvasId } },
                    { separator: true },
                    { text: paperModeEnabled ? '✓ 用紙モード' : '用紙モード', action: 'toggle-paper-mode', data: { windowId, canvasId } },
                    { separator: true },
                    { text: 'プロパティ', action: 'window-properties' }
                );
            } else {
                // プラグインウィンドウかどうかを確認
                const iframe = windowElement.querySelector('iframe[data-plugin-id]');
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
                    if (window.pluginManager) {
                        const accessoryPlugins = window.pluginManager.getAccessoryPlugins();
                        if (accessoryPlugins.length > 0) {
                            const accessorySubmenu = accessoryPlugins.map(plugin => ({
                                text: plugin.name,
                                action: 'launch-accessory',
                                data: { pluginId: plugin.id }
                            }));

                            items.push({ separator: true });
                            items.push({
                                text: '小物',
                                submenu: accessorySubmenu
                            });
                        }
                    }
                } else {
                    // 通常ウィンドウのメニュー（初期ウィンドウなど）
                    // 選択中のファイルがあるかチェック
                    const selectedFileIcon = windowElement.querySelector('.file-icon.selected');
                    const fileName = selectedFileIcon ? selectedFileIcon.dataset.fileName : null;

                    items.push(
                        { text: '閉じる', action: 'close', shortcut: 'Ctrl+E' },
                        { text: '最小化', action: 'minimize' }
                    );

                    // 「小物」タイプのプラグインをサブメニューとして追加
                    if (window.pluginManager) {
                        const accessoryPlugins = window.pluginManager.getAccessoryPlugins();
                        if (accessoryPlugins.length > 0) {
                            const accessorySubmenu = accessoryPlugins.map(plugin => ({
                                text: plugin.name,
                                action: 'launch-accessory',
                                data: { pluginId: plugin.id }
                            }));

                            items.push(
                                { separator: true },
                                {
                                    text: '小物',
                                    submenu: accessorySubmenu
                                }
                            );
                        }
                    }

                    // ファイルが選択されている場合、「実行」メニューを追加
                    if (window.pluginManager && fileName) {
                        const pluginMenus = window.pluginManager.getContextMenuForFile(fileName);
                        if (pluginMenus.length > 0) {
                            const executeSubmenu = pluginMenus.map(menu => ({
                                text: menu.label,
                                action: 'plugin-action',
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
            items.push(
                { text: 'ウインドウ一覧', action: 'window-list' },
                { text: 'デスクトップをクリア', action: 'clear-desktop' },
                { separator: true }
            );

            // 「小物」タイプのプラグインをサブメニューとして追加
            if (window.pluginManager) {
                const accessoryPlugins = window.pluginManager.getAccessoryPlugins();
                logger.info('[ContextMenuManager] 小物プラグイン取得:', accessoryPlugins.length, '個');
                if (accessoryPlugins.length > 0) {
                    const accessorySubmenu = accessoryPlugins.map(plugin => ({
                        text: plugin.name,
                        action: 'launch-accessory',
                        data: { pluginId: plugin.id }
                    }));

                    items.push({
                        text: '小物',
                        submenu: accessorySubmenu
                    });

                    items.push({ separator: true });
                } else {
                    logger.warn('[ContextMenuManager] 小物プラグインが見つかりません');
                }
            } else {
                logger.warn('[ContextMenuManager] プラグインマネージャーが見つかりません');
            }

            items.push(
                { text: 'システム情報', action: 'system-info' }
            );
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
            { text: '閉じる', action: 'close', shortcut: 'Ctrl+E', data: { windowId } }
        ];
    }

    /**
     * コンテキストメニューを作成・表示
     * @param {Array<Object>} items - メニュー項目の配列
     * @param {number} x - メニューのX座標
     * @param {number} y - メニューのY座標
     */
    createContextMenu(items, x, y) {
        logger.info('[ContextMenuManager] createContextMenu呼び出し, items:', items, 'x:', x, 'y:', y);
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
        logger.info('[ContextMenuManager] hideContextMenu呼び出し');
        const staticMenu = document.getElementById('context-menu');
        const dynamicMenu = document.getElementById('dynamic-context-menu');

        if (staticMenu) {
            logger.info('[ContextMenuManager] 静的メニューを非表示');
            staticMenu.style.display = 'none';
        }
        if (dynamicMenu) {
            logger.info('[ContextMenuManager] 動的メニューを削除');
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
            case 'open':
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

            case 'open-vobj':
                if (data) {
                    this.openVirtualObject(data);
                }
                break;

            case 'vobj-properties':
                if (data) {
                    this.showVirtualObjectProperties(data);
                }
                break;

            case 'properties':
                if (selectedIcon) {
                    const filename = selectedIcon.dataset.filename;
                    this.showFileProperties(filename);
                }
                break;

            case 'close':
                if (data && data.windowId) {
                    this.closeWindow(data.windowId);
                } else {
                    const activeWindow = this.getActiveWindow();
                    if (activeWindow) {
                        this.closeWindow(activeWindow);
                    }
                }
                break;

            case 'minimize':
                if (data && data.windowId) {
                    // 将来的に実装
                    this.setStatusMessage('最小化機能は未実装です');
                } else {
                    this.setStatusMessage('最小化機能は未実装です');
                }
                break;

            case 'toggle-paper-mode':
                if (data && data.windowId && data.canvasId) {
                    this.togglePaperMode(data.windowId, data.canvasId);
                }
                break;

            case 'set-display-mode':
                if (data && data.windowId && data.canvasId && data.mode) {
                    this.setDisplayMode(data.windowId, data.canvasId, data.mode);
                }
                break;

            case 'toggle-wrap-at-window-width':
                if (data && data.windowId && data.canvasId) {
                    this.toggleWrapAtWindowWidth(data.windowId, data.canvasId);
                }
                break;

            case 'window-list':
                this.showWindowList();
                break;

            case 'clear-desktop':
                this.clearDesktop();
                break;

            case 'launch-accessory':
                if (data && data.pluginId && window.pluginManager) {
                    window.pluginManager.launchPlugin(data.pluginId);
                }
                break;

            case 'system-info':
                this.showSystemInfo();
                break;

            case 'window-properties':
                const activeWindow = this.getActiveWindow();
                if (activeWindow) {
                    this.showWindowProperties(activeWindow);
                }
                break;

            case 'plugin-action':
                if (data && data.pluginId && data.fileName) {
                    this.launchPluginForFile(data.pluginId, data.fileName);
                }
                break;

            // プラグインアクション（基本文章編集）
            default:
                if (action.startsWith('plugin-')) {
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

        const iframe = windowElement.querySelector('iframe[data-plugin-id]');
        if (!iframe || !iframe.contentWindow) return;

        // アクション名から "plugin-" プレフィックスを除去
        const pluginAction = action.replace('plugin-', '');

        // iframeにメッセージを送信
        this.parentMessageBus.sendToWindow(data.windowId, 'menu-action', {
            action: pluginAction
        });

        logger.info('[ContextMenuManager] プラグインアクション送信:', pluginAction);
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
            logger.info('[ContextMenuManager] プラグインメニュー定義を要求:', messageId);
            const timeout = setTimeout(() => {
                logger.error('[ContextMenuManager] プラグインメニュー取得タイムアウト:', messageId);
                window.removeEventListener('message', handler);
                reject(new Error('プラグインメニュー取得タイムアウト'));
            }, MENU_FETCH_TIMEOUT_MS);

            const handler = (event) => {
                if (event.data && event.data.type === 'menu-definition-response' && event.data.messageId === messageId) {
                    logger.info('[ContextMenuManager] menu-definition-response受信:', event.data);
                    clearTimeout(timeout);
                    window.removeEventListener('message', handler);

                    // プラグインのメニュー定義をパースして、windowIdをdataに追加
                    const menuItems = this.parsePluginMenuDefinition(event.data.menuDefinition, windowId);
                    logger.info('[ContextMenuManager] パース後のメニュー項目:', menuItems);
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
}
