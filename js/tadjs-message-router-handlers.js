/**
 * TADjsDesktop メッセージルーターハンドラーメソッド
 * tadjs-desktop.js から抽出したMessageRouter関連ハンドラー群
 * registerMessageRouterHandlers() および各 handleXxx() メソッド
 */

const logger = window.getLogger('TADjs');

/**
 * メッセージルーターハンドラーメソッドを定義するミキシンクラス
 * @private
 */
class MessageRouterHandlersMixin {
    // ========================================
    // MessageRouter ハンドラーメソッド (Phase 2)
    // ========================================

    /**
     * show-message-dialog ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleShowMessageDialog(data, event) {
        await this.showDialogAndRespond(
            'message',
            data,
            'message-dialog-response',
            event
        );
    }

    /**
     * show-input-dialog ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleShowInputDialog(data, event) {
        logger.info('[TADjs] handleShowInputDialog called:', {
            messageId: data.messageId,
            message: data.message,
            sourceWindowId: data.sourceWindowId,
            hasEventSource: !!event.source
        });
        await this.showDialogAndRespond(
            'input',
            data,
            'input-dialog-response',
            event
        );
        logger.info('[TADjs] handleShowInputDialog completed');
    }

    /**
     * show-custom-dialog ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleShowCustomDialog(data, event) {
        await this.showDialogAndRespond(
            'custom',
            data,
            'custom-dialog-response',
            event
        );
    }

    /**
     * show-save-confirm-dialog ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleShowSaveConfirmDialog(data, event) {
        await this.showDialogAndRespond(
            'message',
            { ...data, defaultButton: 2 }, // デフォルトは「保存」ボタン
            'message-dialog-response',
            event
        );
    }

    /**
     * MessageRouter ハンドラーを登録
     * Phase 2: ダイアログ系から段階的移行
     */
    registerMessageRouterHandlers() {
        if (!this.messageRouter) {
            logger.warn('[TADjs] MessageRouterが初期化されていません - ハンドラー登録をスキップ');
            return;
        }

        // ダイアログ系ハンドラー登録
        this.messageRouter.register(
            'show-message-dialog',
            this.handleShowMessageDialog.bind(this),
            { autoResponse: false } // 手動レスポンス（ハンドラー内で送信）
        );

        this.messageRouter.register(
            'show-input-dialog',
            this.handleShowInputDialog.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'show-custom-dialog',
            this.handleShowCustomDialog.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'show-save-confirm-dialog',
            this.handleShowSaveConfirmDialog.bind(this),
            { autoResponse: false }
        );

        logger.info('[TADjs] Phase 2: ダイアログ系ハンドラー登録完了 (4件)');

        // Phase 3: ファイル・データ操作系ハンドラー登録
        this.messageRouter.register(
            'open-folder-dialog',
            this.handleOpenFolderDialog.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'check-folder-access',
            this.handleCheckFolderAccess.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'get-data-folder',
            this.handleGetDataFolder.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'get-plugin-list',
            this.handleGetPluginList.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'get-mcp-config',
            this.handleGetMcpConfig.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'set-mcp-config',
            this.handleSetMcpConfig.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'start-mcp-server',
            this.handleStartMcpServer.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'stop-mcp-server',
            this.handleStopMcpServer.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'get-mcp-server-status',
            this.handleGetMcpServerStatus.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'get-image-file-path',
            this.handleGetImageFilePath.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'get-window-list',
            this.handleGetWindowList.bind(this),
            { autoResponse: false }
        );

        logger.info('[TADjs] Phase 3: ファイル・データ操作系ハンドラー登録完了 (6件)');

        // Phase 4 Batch 1: 単方向メッセージハンドラー登録
        this.messageRouter.register(
            'content-size-changed',
            this.handleContentSizeChanged.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'set-window-icon',
            this.handleSetWindowIcon.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'window-close-response',
            this.handleWindowCloseResponse.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'update-scrollbars',
            this.handleUpdateScrollbars.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'set-clipboard',
            this.handleSetClipboard.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'update-window-config',
            this.handleUpdateWindowConfigRouter.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'update-panel-position',
            this.handleUpdatePanelPositionRouter.bind(this),
            { autoResponse: false }
        );

        logger.info('[TADjs] Phase 4 Batch 1: 単方向メッセージハンドラー登録完了 (7件)');

        // Phase 4 Batch 2: ファイル・データ取得系ハンドラー登録
        this.messageRouter.register(
            'get-file-data',
            this.handleGetFileData.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'save-image-file',
            this.handleSaveImageFile.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'load-image-file',
            this.handleLoadImageFile.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'list-image-files',
            this.handleListImageFiles.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'read-xtad-text',
            this.handleReadXtadText.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'read-icon-file',
            this.handleReadIconFile.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'cache-cloud-icons',
            this.handleCacheCloudIcons.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'download-cloud-to-local',
            this.handleDownloadCloudToLocal.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'get-clipboard',
            this.handleGetClipboard.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'get-text-clipboard',
            this.handleGetTextClipboard.bind(this),
            { autoResponse: false }
        );

        logger.info('[TADjs] Phase 4 Batch 2: ファイル・データ取得系ハンドラー登録完了 (8件)');

        // Phase 4 Batch 3: 実身/仮身操作系ハンドラー登録
        this.messageRouter.register(
            'rename-real-object',
            this.handleRenameRealObjectRouter.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'duplicate-real-object',
            this.handleDuplicateRealObjectRouter.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'save-as-new-real-object',
            this.handleSaveAsNewRealObjectRouter.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'virtualize-selection',
            this.handleVirtualizeSelection.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'change-virtual-object-attributes',
            this.handleChangeVirtualObjectAttributesRouter.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'set-relationship',
            this.handleSetRelationshipRouter.bind(this),
            { autoResponse: false }
        );

        logger.info('[TADjs] Phase 4 Batch 3: 実身/仮身操作系ハンドラー登録完了 (6件)');

        // Phase 4 Batch 4: オブジェクトを開く系ハンドラー登録
        this.messageRouter.register(
            'open-virtual-object',
            this.handleOpenVirtualObject.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'open-virtual-object-real',
            this.handleOpenVirtualObjectReal.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'open-tad-link',
            this.handleOpenTadLink.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'open-external-file',
            this.handleOpenExternalFile.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'open-url-external',
            this.handleOpenUrlExternal.bind(this),
            { autoResponse: false }
        );

        logger.info('[TADjs] Phase 4 Batch 4: オブジェクトを開く系ハンドラー登録完了 (5件)');

        // Phase 4 Batch 5: ドラッグ&ドロップ系 + その他ハンドラー登録 (13件)
        this.messageRouter.register(
            'archive-drop-detected',
            this.handleArchiveDropDetected.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'archive-drop-handled',
            this.handleArchiveDropHandled.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'base-file-drop-request',
            this.handleBaseFileDropRequest.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'insert-root-virtual-object',
            this.handleInsertRootVirtualObject.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'root-virtual-object-inserted',
            this.handleRootVirtualObjectInserted.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'archive-files-generated',
            this.handleArchiveFilesGeneratedRouter.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'url-drop-request',
            this.handleUrlDropRequest.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'trash-real-object-drop-request',
            this.handleTrashRealObjectDropRequest.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'notify-cross-window-drop',
            this.handleNotifyCrossWindowDrop.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'cross-window-drop-success',
            this.handleCrossWindowDropSuccess.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'files-dropped-on-plugin',
            this.handleFilesDroppedOnPlugin.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'image-dropped-on-plugin',
            this.handleImageDroppedOnPlugin.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'set-data-folder',
            this.handleSetDataFolderRouter.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'request-base-plugins',
            this.handleRequestBasePlugins.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'load-data-file-request',
            this.handleLoadDataFileRequest.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'get-system-fonts',
            this.handleGetSystemFonts.bind(this),
            { autoResponse: false }
        );

        // basic-playerプラグイン用メディアドロップオーバーレイ
        this.messageRouter.register(
            'show-media-drop-overlay',
            this.handleShowMediaDropOverlay.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'hide-media-drop-overlay',
            this.handleHideMediaDropOverlay.bind(this),
            { autoResponse: false }
        );

        logger.info('[TADjs] Phase 4 Batch 5: ドラッグ&ドロップ系+その他ハンドラー登録完了 (15件)');

        // Phase 4 Batch 6: 道具パネル系 + 特殊フラグ系ハンドラー登録 (6件)
        this.messageRouter.register(
            'open-tool-panel-window',
            this.handleOpenToolPanelWindow.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'show-tool-panel-popup',
            this.handleShowToolPanelPopup.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'hide-tool-panel-popup',
            this.handleHideToolPanelPopup.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'start-drag-tool-panel',
            this.handleStartDragToolPanel.bind(this),
            { autoResponse: false }
        );

        // 特殊フラグ系はカスタムルーティングが必要なため、個別処理を維持
        logger.info('[TADjs] Phase 4 Batch 6: 道具パネル系ハンドラー登録完了 (4件)');
        logger.info('[TADjs] 特殊フラグ系 (fromEditor, fromToolPanel) は個別処理を維持');

        // 子パネルウィンドウ系ハンドラー登録
        this.messageRouter.register(
            'open-child-panel-window',
            this.handleOpenChildPanelWindow.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'send-to-child-panel',
            this.handleSendToChildPanel.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'start-drag-child-panel',
            this.handleStartDragChildPanel.bind(this),
            { autoResponse: false }
        );

        logger.info('[TADjs] 子パネルウィンドウ系ハンドラー登録完了 (3件)');

        // 検索/置換ウィンドウ系ハンドラー登録
        this.messageRouter.register(
            'open-find-replace-window',
            this.handleOpenFindReplaceWindow.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'find-next',
            this.handleFindNext.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'replace-next',
            this.handleReplaceNext.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'replace-all',
            this.handleReplaceAll.bind(this),
            { autoResponse: false }
        );

        logger.info('[TADjs] 検索/置換ウィンドウ系ハンドラー登録完了 (4件)');

        // 基本表計算用 検索/置換ウィンドウ系ハンドラー登録
        this.messageRouter.register(
            'open-calc-find-replace-window',
            this.handleOpenCalcFindReplaceWindow.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'calc-find-next',
            this.handleCalcFindNext.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'calc-replace-next',
            this.handleCalcReplaceNext.bind(this),
            { autoResponse: false }
        );

        this.messageRouter.register(
            'calc-replace-all',
            this.handleCalcReplaceAll.bind(this),
            { autoResponse: false }
        );

        logger.info('[TADjs] 基本表計算用 検索/置換ウィンドウ系ハンドラー登録完了 (4件)');
    }

    // ========================================
    // MessageRouter ハンドラーメソッド (Phase 3)
    // ========================================

    /**
     * open-folder-dialog ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleOpenFolderDialog(data, event) {
        try {
            if (window.electronAPI && window.electronAPI.openFolderDialog) {
                const result = await window.electronAPI.openFolderDialog();
                this.respondSuccess(event.source, 'folder-dialog-response', {
                    folderPath: result ? result.folderPath : null
                }, data.messageId);
            } else {
                logger.error('[TADjs] electronAPI.openFolderDialogが利用できません');
                this.respondError(event.source, 'folder-dialog-response',
                    new Error('Electron APIが利用できません'), data.messageId);
            }
        } catch (error) {
            logger.error('[TADjs] フォルダ選択ダイアログエラー:', error);
            this.respondError(event.source, 'folder-dialog-response', error, data.messageId);
        }
    }

    /**
     * check-folder-access ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleCheckFolderAccess(data, event) {
        logger.info('[TADjs] check-folder-access受信:', data.folderPath);

        if (data.folderPath) {
            const result = this.checkFolderAccess(data.folderPath);
            this.respondSuccess(event.source, 'folder-access-checked', {
                success: result.success,
                error: result.error
            }, data.messageId);
        } else {
            this.respondSuccess(event.source, 'folder-access-checked', {
                success: false,
                error: 'フォルダパスが指定されていません'
            }, data.messageId);
        }
    }

    /**
     * get-data-folder ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleGetDataFolder(data, event) {
        logger.info('[TADjs] get-data-folder受信');
        this.respondSuccess(event.source, 'data-folder-response', {
            dataFolder: this._basePath
        }, data.messageId);
    }

    /**
     * get-plugin-list ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleGetPluginList(data, event) {
        const plugins = this.getPluginListInfo();
        this.respondSuccess(event.source, 'plugin-list-response', {
            plugins: plugins
        }, data.messageId);
    }

    /**
     * get-mcp-config ハンドラー
     * MCP設定を取得して返す
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleGetMcpConfig(data, event) {
        try {
            const result = await window.electronAPI.getMcpConfig();
            this.respondSuccess(event.source, 'mcp-config-response', {
                config: result.config
            }, data.messageId);
        } catch (err) {
            logger.error('[TADjs] MCP設定取得エラー:', err);
            this.respondSuccess(event.source, 'mcp-config-response', {
                config: { enabled: false }
            }, data.messageId);
        }
    }

    /**
     * set-mcp-config ハンドラー
     * MCP設定を保存する
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleSetMcpConfig(data, event) {
        try {
            const result = await window.electronAPI.setMcpConfig(data.config);
            this.respondSuccess(event.source, 'mcp-config-saved', {
                success: result.success
            }, data.messageId);
        } catch (err) {
            logger.error('[TADjs] MCP設定保存エラー:', err);
            this.respondSuccess(event.source, 'mcp-config-saved', {
                success: false, error: err.message
            }, data.messageId);
        }
    }

    /**
     * start-mcp-server ハンドラー
     * MCPサーバを子プロセスとして起動
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleStartMcpServer(data, event) {
        try {
            const result = await window.electronAPI.startMcpServer();
            this.respondSuccess(event.source, 'mcp-server-started', {
                success: result.success,
                error: result.error,
                pid: result.pid,
                exePath: result.exePath,
                args: result.args
            }, data.messageId);
        } catch (err) {
            logger.error('[TADjs] MCPサーバ起動エラー:', err);
            this.respondSuccess(event.source, 'mcp-server-started', {
                success: false, error: err.message
            }, data.messageId);
        }
    }

    /**
     * stop-mcp-server ハンドラー
     * MCPサーバ子プロセスを停止
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleStopMcpServer(data, event) {
        try {
            const result = await window.electronAPI.stopMcpServer();
            this.respondSuccess(event.source, 'mcp-server-stopped', {
                success: result.success,
                error: result.error
            }, data.messageId);
        } catch (err) {
            logger.error('[TADjs] MCPサーバ停止エラー:', err);
            this.respondSuccess(event.source, 'mcp-server-stopped', {
                success: false, error: err.message
            }, data.messageId);
        }
    }

    /**
     * get-mcp-server-status ハンドラー
     * MCPサーバの稼働状態を取得
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleGetMcpServerStatus(data, event) {
        try {
            const result = await window.electronAPI.getMcpServerStatus();
            this.respondSuccess(event.source, 'mcp-server-status-response', {
                running: result.running
            }, data.messageId);
        } catch (err) {
            logger.error('[TADjs] MCPサーバ状態取得エラー:', err);
            this.respondSuccess(event.source, 'mcp-server-status-response', {
                running: false
            }, data.messageId);
        }
    }

    /**
     * get-window-list ハンドラー
     * 開いているウィンドウの一覧を返す
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleGetWindowList(data, event) {
        const windowList = [];
        this.windows.forEach((win, id) => {
            const iframe = win.element.querySelector('iframe[data-plugin-id]');
            windowList.push({
                windowId: id,
                title: win.title,
                isActive: id === this.activeWindow,
                pluginId: iframe ? iframe.dataset.pluginId : null,
                isMaximized: win.isMaximized || false
            });
        });
        this.respondSuccess(event.source, 'window-list-response', {
            windows: windowList
        }, data.messageId);
    }

    /**
     * get-image-file-path ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleGetImageFilePath(data, event) {
        const filePath = this.getImageFilePath(data.fileName);
        this.respondSuccess(event.source, 'image-file-path-response', {
            fileName: data.fileName,
            filePath: filePath
        }, data.messageId);
    }

    // ========================================
    // MessageRouter ハンドラーメソッド (Phase 4 Batch 1)
    // ========================================

    /**
     * content-size-changed ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleContentSizeChanged(data, event) {
        this.updatePluginContentSize(event.source, data.height, data.width);
    }

    /**
     * set-window-icon ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleSetWindowIcon(data, event) {
        logger.debug('[TADjs] ウィンドウアイコン設定要求:', data.windowId, data.iconPath);
        this.setWindowIcon(data.windowId, data.iconPath);
    }

    /**
     * window-close-response ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleWindowCloseResponse(data, event) {
        if (this.closeConfirmCallbacks && this.closeConfirmCallbacks[data.windowId]) {
            this.closeConfirmCallbacks[data.windowId](data.allowClose);
            delete this.closeConfirmCallbacks[data.windowId];
        }
    }

    /**
     * update-scrollbars ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleUpdateScrollbars(data, event) {
        const iframe = event.source ? event.source.frameElement : null;

        if (iframe) {
            const windowElement = iframe.closest('.window');

            if (windowElement) {
                const content = windowElement.querySelector('.window-content');
                const vScrollbar = windowElement.querySelector('.custom-scrollbar-vertical');
                const hScrollbar = windowElement.querySelector('.custom-scrollbar-horizontal');

                if (content && vScrollbar) {
                    this.forceUpdateScrollbarForPlugin(iframe, content, vScrollbar, 'vertical');
                }
                if (content && hScrollbar) {
                    this.forceUpdateScrollbarForPlugin(iframe, content, hScrollbar, 'horizontal');
                }
            }
        }
    }

    /**
     * set-clipboard ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleSetClipboard(data, event) {
        this.clipboard = data.clipboardData;
        logger.info('[TADjs] クリップボードを設定:', this.clipboard?.type || this.clipboard?.link_name);
    }

    /**
     * update-window-config MessageRouterハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleUpdateWindowConfigRouter(data, event) {
        // 既存のhandleUpdateWindowConfigメソッドを呼び出し
        // 既存メソッドがeventオブジェクト全体を期待しているため、そのまま渡す
        await this.handleUpdateWindowConfig(event).catch(err => {
            logger.error('[TADjs] ウィンドウ設定更新エラー:', err);
        });
    }

    /**
     * update-panel-position MessageRouterハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleUpdatePanelPositionRouter(data, event) {
        // 既存のhandleUpdatePanelPositionメソッドを呼び出し
        // 既存メソッドがeventオブジェクト全体を期待しているため、そのまま渡す
        await this.handleUpdatePanelPosition(event).catch(err => {
            logger.error('[TADjs] 道具パネル位置更新エラー:', err);
        });
    }

    // ========================================
    // MessageRouter ハンドラーメソッド (Phase 4 Batch 2)
    // ========================================

    /**
     * get-file-data ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleGetFileData(data, event) {
        logger.info('[TADjs] ファイルデータ取得要求:', data.fileName);
        const file = this.fileObjects[data.fileName];
        if (file) {
            try {
                const uint8Array = await this.getFileAsUint8Array(file);
                if (event.source) {
                    this.parentMessageBus.respondTo(event.source, 'file-data', {
                        fileName: data.fileName,
                        arrayBuffer: uint8Array.buffer
                    });
                }
            } catch (error) {
                logger.error('[TADjs] ファイルデータ取得エラー:', error);
            }
        } else {
            logger.error('[TADjs] ファイルが見つかりません:', data.fileName);
        }
    }

    /**
     * save-image-file ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleSaveImageFile(data, event) {
        logger.info('[TADjs] 画像ファイル保存要求:', data.fileName);

        let success = false;
        try {
            let imageData = data.imageData;

            // base64データの場合はデコード
            if (data.isBase64 && typeof imageData === 'string') {
                const binaryString = atob(imageData);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                imageData = bytes;
            }

            success = await this.saveImageFile(data.fileName, imageData);
        } catch (error) {
            logger.error('[TADjs] 画像ファイル保存エラー:', error);
        }

        // レスポンスを返す（messageIdがある場合のみ）
        if (event.source && data.messageId) {
            this.parentMessageBus.respondTo(event.source, 'save-image-result', {
                messageId: data.messageId,
                success: success,
                fileName: data.fileName
            });
        }
    }

    /**
     * list-image-files ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleListImageFiles(data, event) {
        // listMediaFilesを使用して全メディアファイルを取得（音声/動画も含む）
        const mediaFiles = await this.realObjectSystem.listMediaFiles(data.realId, data.recordNo);

        // 後方互換性のため、imageNoプロパティも追加
        const files = mediaFiles.map(f => ({
            fileName: f.fileName,
            imageNo: f.resourceNo,  // 後方互換のエイリアス
            resourceNo: f.resourceNo,
            ext: f.ext
        }));

        if (event.source && data.messageId) {
            this.parentMessageBus.respondTo(event.source, 'list-image-files-result', {
                messageId: data.messageId,
                realId: data.realId,
                recordNo: data.recordNo,
                files: files
            });
        }
    }

    /**
     * save-calc-image-file ハンドラー（基本表計算プラグイン用）
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleSaveCalcImageFile(event) {
        const data = event.data;
        logger.info('[TADjs] 表計算用画像ファイル保存要求:', data.fileName);

        let success = false;
        try {
            // base64からUint8Arrayに変換
            const base64 = data.data;
            const binaryString = atob(base64);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }

            success = await this.saveImageFile(data.fileName, bytes);
        } catch (error) {
            logger.error('[TADjs] 表計算用画像ファイル保存エラー:', error);
        }

        // レスポンスを返す（save-image-result型で返す）
        if (event.source && data.messageId) {
            this.parentMessageBus.respondTo(event.source, 'save-image-result', {
                messageId: data.messageId,
                success: success,
                fileName: data.fileName
            });
        }
    }

    /**
     * delete-image-file ハンドラー（画像ファイル削除）
     * @param {MessageEvent} event - メッセージイベント（汎用ハンドラーからはeventのみ渡される）
     * @returns {Promise<void>}
     */
    async handleDeleteImageFile(event) {
        // 汎用ハンドラーからはeventのみが渡されるため、event.dataからデータを取得
        const data = event.data || event;
        const fileName = data.fileName;
        logger.info('[TADjs] 画像ファイル削除要求:', fileName);

        let success = false;
        try {
            if (window.electronAPI && window.electronAPI.deleteFile) {
                const basePath = this.getDataBasePath();
                const filePath = this.realObjectSystem.path.join(basePath, fileName);

                // ファイルが存在するか確認
                if (this.realObjectSystem.fs.existsSync(filePath)) {
                    const result = await window.electronAPI.deleteFile(filePath);
                    success = result.success;
                    if (success) {
                        logger.info('[TADjs] 画像ファイル削除成功:', filePath);
                    } else {
                        logger.error('[TADjs] 画像ファイル削除失敗:', result.error);
                    }
                } else {
                    logger.warn('[TADjs] 削除対象の画像ファイルが存在しません:', filePath);
                    success = true; // ファイルがなければ削除成功とみなす
                }
            } else {
                logger.warn('[TADjs] electronAPI.deleteFile が利用できません（ブラウザモード）');
            }
        } catch (error) {
            logger.error('[TADjs] 画像ファイル削除エラー:', error);
        }

        // レスポンスを返す
        if (event.source && data.messageId) {
            this.parentMessageBus.respondTo(event.source, 'delete-image-result', {
                messageId: data.messageId,
                success: success,
                fileName: fileName
            });
        }
    }

    /**
     * メディアドロップオーバーレイを削除
     */
    removeMediaDropOverlay() {
        const overlay = document.getElementById('media-drop-overlay');
        if (overlay) {
            overlay.remove();
        }
    }

    /**
     * プラグインからのオーバーレイ表示要求を処理
     * @param {Object} event - メッセージイベント
     */
    handleShowMediaDropOverlay(event) {
        const data = event.data || event;
        const windowId = data.windowId;

        logger.debug('[TADjs] show-media-drop-overlay受信:', windowId);

        if (!windowId) return;

        const targetWindow = document.getElementById(windowId);
        if (!targetWindow) return;

        // プラグインIDを確認（parentMessageBus.childrenから取得）
        const childInfo = this.parentMessageBus?.children?.get(windowId);
        if (!childInfo || childInfo.pluginId !== 'basic-player') return;

        const iframe = targetWindow.querySelector('iframe');
        if (!iframe) return;

        const iframeRect = iframe.getBoundingClientRect();

        // 既存のオーバーレイがあれば削除
        this.removeMediaDropOverlay();

        // オーバーレイを作成
        const overlay = document.createElement('div');
        overlay.id = 'media-drop-overlay';
        overlay.style.cssText = `
            position: fixed;
            background-color: rgba(74, 144, 217, 0.1);
            outline: 3px dashed #4a90d9;
            outline-offset: -3px;
            pointer-events: auto;
            z-index: 999999;
            display: flex;
            align-items: center;
            justify-content: center;
            left: ${iframeRect.left}px;
            top: ${iframeRect.top}px;
            width: ${iframeRect.width}px;
            height: ${iframeRect.height}px;
        `;
        overlay.dataset.windowId = windowId;

        // ドロップメッセージ
        const message = document.createElement('div');
        message.style.cssText = `
            color: #4a90d9;
            font-size: 18px;
            font-weight: bold;
            text-align: center;
            pointer-events: none;
        `;
        message.textContent = 'ファイルをドロップしてメディアを追加';
        overlay.appendChild(message);

        // ドロップイベントを設定
        overlay.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'copy';
        });

        overlay.addEventListener('drop', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            const files = Array.from(e.dataTransfer.files);
            const overlayWindowId = overlay.dataset.windowId;
            const winInfo = this.windows.get(overlayWindowId);

            logger.info('[TADjs] オーバーレイでドロップ検出:', files.length, '個, windowId:', overlayWindowId);

            if (files.length > 0 && winInfo) {
                await this.handleMediaFilesDropToPlayer(files, overlayWindowId, winInfo);
            }

            this.removeMediaDropOverlay();
        });

        overlay.addEventListener('dragleave', (e) => {
            // オーバーレイ外に出た場合のみ削除
            const rect = overlay.getBoundingClientRect();
            if (e.clientX < rect.left || e.clientX > rect.right ||
                e.clientY < rect.top || e.clientY > rect.bottom) {
                this.removeMediaDropOverlay();
            }
        });

        document.body.appendChild(overlay);
        logger.debug('[TADjs] メディアドロップオーバーレイ表示:', windowId);
    }

    /**
     * プラグインからのオーバーレイ非表示要求を処理
     * @param {Object} event - メッセージイベント
     */
    handleHideMediaDropOverlay(event) {
        const data = event.data || event;
        logger.debug('[TADjs] hide-media-drop-overlay受信:', data.windowId);
        this.removeMediaDropOverlay();
    }

    /**
     * basic-playerプラグインへのメディアファイルドロップを処理
     * @param {Array<File>} files - ドロップされたファイル
     * @param {string} windowId - ウィンドウID
     * @param {Object} windowInfo - ウィンドウ情報
     */
    async handleMediaFilesDropToPlayer(files, windowId, windowInfo) {
        logger.info('[TADjs] メディアファイルドロップ処理開始:', files.length, '個');

        // 対応するメディア拡張子
        const videoExtensions = ['mp4', 'webm', 'mov', 'avi', 'mkv'];
        const audioExtensions = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'opus'];

        // 実身IDを取得（parentMessageBus.childrenから取得）
        const childInfo = this.parentMessageBus.children?.get(windowId);
        const realId = childInfo?.realId;
        if (!realId) {
            logger.error('[TADjs] 実身IDが取得できません windowId:', windowId, 'childInfo:', childInfo);
            return;
        }

        // ベースIDを取得（_数字.xtadを除去）
        const baseId = realId.replace(/_\d+\.xtad$/i, '');

        // メディアファイルをフィルタリング
        const mediaFiles = [];
        for (const file of files) {
            const ext = file.name.split('.').pop().toLowerCase();
            let mediaType = null;
            if (videoExtensions.includes(ext)) {
                mediaType = 'video';
            } else if (audioExtensions.includes(ext)) {
                mediaType = 'audio';
            }
            if (mediaType) {
                mediaFiles.push({ file, ext, mediaType });
            }
        }

        if (mediaFiles.length === 0) {
            logger.warn('[TADjs] 対応するメディアファイルがありません');
            return;
        }

        // 各メディアファイルを処理
        const addedMedia = [];
        for (const { file, ext, mediaType } of mediaFiles) {
            // webUtils.getPathForFile()でファイルパスを取得（Electron 23以降対応）
            let filePath = null;
            try {
                filePath = webUtils.getPathForFile(file);
            } catch (e) {
                // フォールバック: 古いElectronの場合はfile.pathを使用
                filePath = file.path;
            }

            if (!filePath) {
                logger.warn('[TADjs] ファイルパスが取得できません:', file.name);
                continue;
            }

            try {
                // 次のリソース番号を取得（全メディアファイル対象）
                const existingFiles = await this.realObjectSystem.listMediaFiles(baseId, 0);
                let nextNo = 0;
                if (existingFiles && existingFiles.length > 0) {
                    const maxNo = Math.max(...existingFiles.map(f => f.resourceNo || 0));
                    nextNo = maxNo + 1;
                }

                // 保存ファイル名を生成
                const saveFileName = `${baseId}_0_${nextNo}.${ext}`;

                // ファイルをコピー
                const basePath = this.getDataBasePath();
                const destPath = this.realObjectSystem.path.join(basePath, saveFileName);
                this.realObjectSystem.fs.copyFileSync(filePath, destPath);

                logger.info('[TADjs] メディアファイルコピー成功:', saveFileName);

                // 音声ファイルの場合、ID3タグを抽出
                let id3Tags = { title: null, artist: null, album: null, trackNumber: null };
                if (mediaType === 'audio' && typeof jsmediatags !== 'undefined') {
                    try {
                        // ファイルをArrayBufferに変換してBlobとして渡す（Electron環境対応）
                        let arrayBuffer;
                        if (file.arrayBuffer) {
                            arrayBuffer = await file.arrayBuffer();
                        } else if (filePath && this.realObjectSystem && this.realObjectSystem.fs) {
                            const buffer = this.realObjectSystem.fs.readFileSync(filePath);
                            arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
                        }

                        if (arrayBuffer) {
                            // ID3タグ文字列のエンコーディング修正用ヘルパー
                            const fixEncoding = (str) => {
                                if (!str) return str;
                                // 既に正常な日本語文字が含まれていれば変換不要
                                if (/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(str)) return str;
                                // Latin-1範囲の文字があるか確認
                                let hasHighBytes = false;
                                for (let i = 0; i < str.length; i++) {
                                    if (str.charCodeAt(i) >= 0x80 && str.charCodeAt(i) <= 0xFF) {
                                        hasHighBytes = true;
                                        break;
                                    }
                                }
                                if (!hasHighBytes || typeof Encoding === 'undefined') return str;
                                try {
                                    const bytes = [];
                                    for (let i = 0; i < str.length; i++) bytes.push(str.charCodeAt(i) & 0xFF);
                                    const detected = Encoding.detect(bytes);
                                    if (detected && detected !== 'ASCII' && detected !== 'UNICODE') {
                                        const unicodeArray = Encoding.convert(bytes, { to: 'UNICODE', from: detected });
                                        return Encoding.codeToString(unicodeArray);
                                    }
                                } catch (e) { /* 変換失敗時は元の文字列 */ }
                                return str;
                            };

                            id3Tags = await new Promise((resolve) => {
                                jsmediatags.read(new Blob([arrayBuffer]), {
                                    onSuccess: (tag) => {
                                        const tags = tag.tags || {};
                                        let trackNumber = null;
                                        if (tags.track) {
                                            const trackStr = String(tags.track);
                                            const trackMatch = trackStr.match(/^(\d+)/);
                                            if (trackMatch) {
                                                trackNumber = parseInt(trackMatch[1], 10);
                                            }
                                        }
                                        resolve({
                                            title: fixEncoding(tags.title) || null,
                                            artist: fixEncoding(tags.artist) || null,
                                            album: fixEncoding(tags.album) || null,
                                            trackNumber: trackNumber
                                        });
                                    },
                                    onError: () => {
                                        resolve({ title: null, artist: null, album: null, trackNumber: null });
                                    }
                                });
                            });
                        }
                    } catch (e) {
                        logger.warn('[TADjs] ID3タグ抽出エラー:', e);
                    }
                }

                addedMedia.push({
                    fileName: saveFileName,
                    mediaType: mediaType,
                    format: ext,
                    id3Tags: id3Tags
                });
            } catch (error) {
                logger.error('[TADjs] メディアファイルコピーエラー:', error);
            }
        }

        // プラグインに追加されたメディア情報を送信
        if (addedMedia.length > 0 && windowId) {
            this.parentMessageBus.sendToWindow(windowId, 'media-files-added', {
                mediaFiles: addedMedia
            });
            logger.info('[TADjs] メディア追加通知を送信:', addedMedia.length, '個');
        }
    }

    /**
     * copy-file-to-data ハンドラー
     * ソースファイルをデータフォルダにコピー
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleCopyFileToData(event) {
        const data = event.data || event;
        const { sourcePath, destFileName, messageId } = data;
        logger.info('[TADjs] ファイルコピー要求:', sourcePath, '->', destFileName);

        let success = false;
        try {
            if (this.realObjectSystem && this.realObjectSystem.fs) {
                const basePath = this.getDataBasePath();
                const destPath = this.realObjectSystem.path.join(basePath, destFileName);

                // ソースファイルが存在するか確認
                if (this.realObjectSystem.fs.existsSync(sourcePath)) {
                    // ファイルをコピー
                    this.realObjectSystem.fs.copyFileSync(sourcePath, destPath);
                    success = true;
                    logger.info('[TADjs] ファイルコピー成功:', destPath);
                } else {
                    logger.error('[TADjs] ソースファイルが存在しません:', sourcePath);
                }
            } else {
                logger.warn('[TADjs] ファイルシステムが利用できません');
            }
        } catch (error) {
            logger.error('[TADjs] ファイルコピーエラー:', error);
        }

        // レスポンスを返す
        if (event.source && messageId) {
            this.parentMessageBus.respondTo(event.source, 'copy-file-result', {
                messageId: messageId,
                success: success,
                destFileName: destFileName
            });
        }
    }

    /**
     * get-real-object-info ハンドラー（仮身ネットワーク用）
     * 実身のメタデータを取得
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleGetRealObjectInfo(event) {
        // 汎用ハンドラからはeventのみが渡される
        const data = event.data || {};
        const realId = data.realId;
        logger.info('[TADjs] 実身情報取得要求:', realId);

        let success = false;
        let info = null;

        try {
            // JSONファイルから実身情報を読み込み
            const basePath = this.getDataBasePath();
            const jsonPath = this.realObjectSystem.path.join(basePath, `${realId}.json`);

            if (this.realObjectSystem.fs.existsSync(jsonPath)) {
                const jsonContent = this.realObjectSystem.fs.readFileSync(jsonPath, 'utf-8');
                const metadata = JSON.parse(jsonContent);
                info = {
                    realId: realId,
                    name: metadata.name || '無題',
                    type: metadata.type || 'unknown',
                    updateDate: metadata.updateDate,
                    applist: metadata.applist || {},
                    filePath: jsonPath  // ファイルパスを追加
                };
                success = true;
            } else {
                logger.warn('[TADjs] 実身のJSONファイルが見つかりません:', jsonPath);
            }
        } catch (error) {
            logger.error('[TADjs] 実身情報取得エラー:', error);
        }

        // レスポンスを返す
        if (event.source) {
            this.parentMessageBus.respondTo(event.source, 'real-object-info-response', {
                messageId: data.messageId,
                success: success,
                info: info
            });
        }
    }

    /**
     * get-virtual-objects-from-real ハンドラー（仮身ネットワーク用）
     * 実身のXTADから仮身リストを取得
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleGetVirtualObjectsFromReal(event) {
        // 汎用ハンドラからはeventのみが渡される
        const data = event.data || {};
        const realId = data.realId;
        logger.info('[TADjs] 仮身リスト取得要求:', realId);

        let success = false;
        let virtualObjects = [];

        try {
            // XTADファイルを読み込み
            const basePath = this.getDataBasePath();
            const xtadPath = this.realObjectSystem.path.join(basePath, `${realId}_0.xtad`);

            if (this.realObjectSystem.fs.existsSync(xtadPath)) {
                let xtadContent = this.realObjectSystem.fs.readFileSync(xtadPath, 'utf-8');
                logger.info('[TADjs] XTADファイル読み込み:', xtadPath, 'サイズ:', xtadContent.length);

                // 重複属性を削除（applist属性が2回出現する問題への対応）
                // link要素内で2番目以降のapplist属性を削除
                xtadContent = xtadContent.replace(/<link([^>]*)>/g, (match, attrs) => {
                    let firstApplist = true;
                    const cleanedAttrs = attrs.replace(/\sapplist="[^"]*"/g, (attrMatch) => {
                        if (firstApplist) {
                            firstApplist = false;
                            return attrMatch;
                        }
                        return ''; // 2番目以降は削除
                    });
                    return '<link' + cleanedAttrs + '>';
                });

                // DOMParserでXMLを解析
                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(xtadContent, 'text/xml');

                // パースエラーをチェック
                const parseError = xmlDoc.querySelector('parsererror');
                if (parseError) {
                    logger.error('[TADjs] XMLパースエラー:', parseError.textContent);
                } else {
                    // <link>要素を取得
                    const linkElements = xmlDoc.getElementsByTagName('link');
                    logger.info('[TADjs] link要素数:', linkElements.length);

                    for (const link of linkElements) {
                        const linkId = link.getAttribute('id') || '';

                        // link_idから実身IDを抽出してJSONから実身名を取得
                        let linkName = link.getAttribute('name') || link.textContent.trim() || '';
                        if (!linkName) {
                            // JSONファイルから実身名を取得（共通メソッドを使用）
                            const childRealId = window.RealObjectSystem.extractRealId(linkId);
                            if (childRealId) {
                                try {
                                    const jsonPath = this.realObjectSystem.path.join(basePath, `${childRealId}.json`);
                                    if (this.realObjectSystem.fs.existsSync(jsonPath)) {
                                        const jsonContent = this.realObjectSystem.fs.readFileSync(jsonPath, 'utf-8');
                                        const metadata = JSON.parse(jsonContent);
                                        linkName = metadata.name || '無題';
                                    } else {
                                        linkName = '無題';
                                    }
                                } catch (jsonError) {
                                    logger.warn('[TADjs] 実身名取得エラー:', childRealId, jsonError.message);
                                    linkName = '無題';
                                }
                            } else {
                                linkName = '無題';
                            }
                        }

                        const vobj = {
                            link_id: linkId,
                            link_name: linkName,
                            frcol: link.getAttribute('frcol') || '#000000',
                            tbcol: link.getAttribute('tbcol') || '#ffffff',
                            chcol: link.getAttribute('chcol') || '#000000',
                            chsz: parseInt(link.getAttribute('chsz')) || DEFAULT_FONT_SIZE
                        };
                        virtualObjects.push(vobj);
                    }
                    success = true;
                    logger.info('[TADjs] 仮身リスト取得成功:', virtualObjects.length, '件');
                }
            } else {
                logger.warn('[TADjs] XTADファイルが見つかりません:', xtadPath);
            }
        } catch (error) {
            logger.error('[TADjs] 仮身リスト取得エラー:', error);
        }

        // レスポンスを返す
        if (event.source) {
            this.parentMessageBus.respondTo(event.source, 'virtual-objects-response', {
                messageId: data.messageId,
                success: success,
                virtualObjects: virtualObjects
            });
        }
    }

    /**
     * load-xtad-content ハンドラー（仮身ネットワーク用）
     * 実身のXTADコンテンツを取得
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleLoadXtadContent(event) {
        const data = event.data || {};
        const realId = data.realId;

        let success = false;
        let content = null;

        try {
            // XTADファイルを読み込み
            const basePath = this.getDataBasePath();
            const xtadPath = this.realObjectSystem.path.join(basePath, `${realId}_0.xtad`);

            if (this.realObjectSystem.fs.existsSync(xtadPath)) {
                content = this.realObjectSystem.fs.readFileSync(xtadPath, 'utf-8');
                success = true;
            }
        } catch (error) {
            logger.error('[TADjs] XTADコンテンツ読み込みエラー:', error);
        }

        // レスポンスを返す
        if (event.source) {
            this.parentMessageBus.respondTo(event.source, 'xtad-content-response', {
                messageId: data.messageId,
                success: success,
                content: content
            });
        }
    }

    /**
     * search-real-objects ハンドラー（実身/仮身検索用）
     * 実身名検索、全文検索、日付検索を実行
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleSearchRealObjects(event) {
        const data = event.data || {};
        logger.info('[TADjs] 実身/仮身検索要求:', data);

        let success = false;
        let results = [];
        let error = null;

        try {
            if (data.searchType === 'string') {
                results = await this.searchRealObjectsByString(data, event.source);
                success = true;
            } else if (data.searchType === 'date') {
                results = await this.searchRealObjectsByDate(data, event.source);
                success = true;
            } else {
                error = '不明な検索タイプです';
            }
        } catch (err) {
            logger.error('[TADjs] 実身/仮身検索エラー:', err);
            error = err.message;
        }

        // レスポンスを返す
        if (event.source) {
            this.parentMessageBus.respondTo(event.source, 'search-real-objects-response', {
                messageId: data.messageId,
                success: success,
                results: results,
                searchParams: data,
                error: error
            });
        }
    }

    /**
     * 検索中断ハンドラ
     */
    handleAbortSearch() {
        logger.info('[TADjs] 検索中断要求');
        this.searchAborted = true;
    }

    /**
     * 文字列による実身検索
     * @param {Object} params - 検索パラメータ
     * @param {Object} eventSource - 進捗報告用のイベントソース（オプション）
     * @returns {Promise<Array>} 検索結果
     */
    async searchRealObjectsByString(params, eventSource = null) {
        const { searchText, searchTarget, useRegex } = params;
        const results = [];

        // 重複スキップ用Set（本文検索以外で使用）
        const processedRealIds = new Set();

        // 検索中断フラグをリセット
        this.searchAborted = false;

        // 全実身のメタデータを取得
        const allMetadata = await this.realObjectSystem.getAllMetadata();
        let processedCount = 0;

        // 検索パターンを作成
        let searchPattern;
        if (useRegex) {
            try {
                searchPattern = new RegExp(searchText, 'i');
            } catch (e) {
                throw new Error('正規表現の構文が正しくありません');
            }
        }

        for (const metadata of allMetadata) {
            // 中断チェック
            if (this.searchAborted) {
                logger.info('[TADjs] 文字列検索が中断されました');
                break;
            }

            // 重複チェック（本文検索以外の場合のみ）
            // 検索対象が content または all の場合は全文検索が必要なためスキップしない
            if (searchTarget !== 'content' && searchTarget !== 'all') {
                if (processedRealIds.has(metadata.realId)) {
                    processedCount++;
                    continue;
                }
            }

            processedCount++;
            let matchType = null;
            let matchedText = null;
            let nameMatched = false;
            let relationshipMatched = false;
            let contentMatched = false;

            // 実身名検索
            if (searchTarget === 'name' || searchTarget === 'all') {
                const name = metadata.name || '';
                if (useRegex) {
                    if (searchPattern.test(name)) {
                        nameMatched = true;
                    }
                } else {
                    if (name.toLowerCase().includes(searchText.toLowerCase())) {
                        nameMatched = true;
                    }
                }
            }

            // 続柄検索（JSON metadata + link要素のrelationship属性）
            if (searchTarget === 'relationship' || searchTarget === 'all') {
                // JSON metadataの続柄を検索
                const relationships = metadata.relationship || [];
                for (const rel of relationships) {
                    if (useRegex) {
                        if (searchPattern.test(rel)) {
                            relationshipMatched = true;
                            break;
                        }
                    } else {
                        if (rel.toLowerCase().includes(searchText.toLowerCase())) {
                            relationshipMatched = true;
                            break;
                        }
                    }
                }

                // link要素のrelationship属性も検索
                if (!relationshipMatched) {
                    const linkRelationships = await this.extractLinkRelationshipsFromRealObject(metadata.realId);
                    for (const rel of linkRelationships) {
                        if (useRegex) {
                            if (searchPattern.test(rel)) {
                                relationshipMatched = true;
                                break;
                            }
                        } else {
                            if (rel.toLowerCase().includes(searchText.toLowerCase())) {
                                relationshipMatched = true;
                                break;
                            }
                        }
                    }
                }
            }

            // 本文検索
            if (searchTarget === 'content' || searchTarget === 'all') {
                const textContent = await this.extractTextFromRealObject(metadata.realId);
                if (textContent) {
                    if (useRegex) {
                        const match = searchPattern.exec(textContent);
                        if (match) {
                            contentMatched = true;
                            // マッチ箇所の前後を含むテキストを抽出
                            const start = Math.max(0, match.index - 20);
                            const end = Math.min(textContent.length, match.index + match[0].length + 20);
                            matchedText = textContent.substring(start, end);
                        }
                    } else {
                        const lowerContent = textContent.toLowerCase();
                        const lowerSearch = searchText.toLowerCase();
                        const index = lowerContent.indexOf(lowerSearch);
                        if (index >= 0) {
                            contentMatched = true;
                            // マッチ箇所の前後を含むテキストを抽出
                            const start = Math.max(0, index - 20);
                            const end = Math.min(textContent.length, index + searchText.length + 20);
                            matchedText = textContent.substring(start, end);
                        }
                    }
                }
            }

            // マッチタイプを決定（複合表示形式: name+relationship+content）
            const matchTypes = [];
            if (nameMatched) matchTypes.push('name');
            if (relationshipMatched) matchTypes.push('relationship');
            if (contentMatched) matchTypes.push('content');
            if (matchTypes.length > 0) {
                matchType = matchTypes.join('+');
            }

            if (matchType) {
                // 処理済みとしてマーク（重複防止用）
                processedRealIds.add(metadata.realId);

                // 仮身属性を抽出（色、サイズなど）
                const vobjAttrs = await this.extractVobjAttributesFromRealObject(metadata.realId);

                results.push({
                    realId: metadata.realId,
                    name: metadata.name || '無題',
                    link_id: `${metadata.realId}_0.xtad`,
                    matchType: matchType,
                    matchedText: matchedText,
                    makeDate: metadata.makeDate,
                    updateDate: metadata.updateDate,
                    accessDate: metadata.accessDate,
                    // VirtualObjectRenderer用の仮身属性（XTADから抽出した値を含める）
                    virtualObject: {
                        link_id: `${metadata.realId}_0.xtad`,
                        link_name: metadata.name || '無題',
                        ...(vobjAttrs || {})
                    }
                });
            }

            // 進捗報告（10件ごと）
            if (eventSource && processedCount % 10 === 0) {
                this.parentMessageBus.respondTo(eventSource, 'search-real-objects-progress', {
                    totalCount: processedCount,
                    matchCount: results.length
                });
            }
        }

        // 最終進捗報告
        if (eventSource) {
            this.parentMessageBus.respondTo(eventSource, 'search-real-objects-progress', {
                totalCount: processedCount,
                matchCount: results.length
            });
        }

        logger.info('[TADjs] 文字列検索結果:', results.length, '件');
        return results;
    }

    /**
     * 日付による実身検索（文字列+日付複合検索対応）
     * @param {Object} params - 検索パラメータ
     * @param {Object} eventSource - 進捗報告用のイベントソース（オプション）
     * @returns {Promise<Array>} 検索結果
     */
    async searchRealObjectsByDate(params, eventSource = null) {
        const { searchText, searchTarget, useRegex, dateFrom, dateTo, dateTarget } = params;
        const results = [];

        // 重複スキップ用Set（本文検索以外で使用）
        const processedRealIds = new Set();

        // 検索中断フラグをリセット
        this.searchAborted = false;

        // 全実身のメタデータを取得
        const allMetadata = await this.realObjectSystem.getAllMetadata();
        let processedCount = 0;

        // 日付の変換（datetime-local形式）
        const fromDateTime = dateFrom ? new Date(dateFrom).getTime() : null;
        const toDateTime = dateTo ? new Date(dateTo).getTime() : null;

        // 文字列検索パターンを作成
        let searchPattern = null;
        if (searchText) {
            if (useRegex) {
                try {
                    searchPattern = new RegExp(searchText, 'i');
                } catch (e) {
                    throw new Error('正規表現の構文が正しくありません');
                }
            }
        }

        // 検索対象を決定（デフォルトは全て）
        const effectiveSearchTarget = searchTarget || 'all';

        for (const metadata of allMetadata) {
            // 中断チェック
            if (this.searchAborted) {
                logger.info('[TADjs] 日付検索が中断されました');
                break;
            }

            // 重複チェック（本文検索以外の場合のみ）
            // 検索対象が content または all の場合は全文検索が必要なためスキップしない
            if (effectiveSearchTarget !== 'content' && effectiveSearchTarget !== 'all') {
                if (processedRealIds.has(metadata.realId)) {
                    processedCount++;
                    continue;
                }
            }

            processedCount++;
            let dateMatched = false;
            let stringMatched = false;
            let matchedText = null;
            let matchType = null;
            let nameMatched = false;
            let relationshipMatched = false;
            let contentMatched = false;

            // 日付フィルタリング（FROM/TOが指定されている場合のみ）
            if (fromDateTime !== null || toDateTime !== null) {
                const dateValue = metadata[dateTarget];
                if (dateValue) {
                    const dateTime = new Date(dateValue).getTime();
                    if (!isNaN(dateTime)) {
                        // FROM/TO両方: 範囲指定
                        // FROMのみ: 以降
                        // TOのみ: 以前
                        const afterFrom = fromDateTime === null || dateTime >= fromDateTime;
                        const beforeTo = toDateTime === null || dateTime <= toDateTime;
                        dateMatched = afterFrom && beforeTo;
                    }
                }
            } else {
                // 日付指定なしの場合は全て一致扱い
                dateMatched = true;
            }

            // 日付が一致しない場合はスキップ
            if (!dateMatched) {
                // 進捗報告
                if (eventSource && processedCount % 10 === 0) {
                    this.parentMessageBus.respondTo(eventSource, 'search-real-objects-progress', {
                        totalCount: processedCount,
                        matchCount: results.length
                    });
                }
                continue;
            }

            // 文字列検索（searchTextが指定されている場合）
            if (searchText) {
                // 実身名検索
                if (effectiveSearchTarget === 'name' || effectiveSearchTarget === 'all') {
                    const name = metadata.name || '';
                    if (useRegex) {
                        if (searchPattern.test(name)) {
                            nameMatched = true;
                        }
                    } else {
                        if (name.toLowerCase().includes(searchText.toLowerCase())) {
                            nameMatched = true;
                        }
                    }
                }

                // 続柄検索（JSON metadata + link要素のrelationship属性）
                if (effectiveSearchTarget === 'relationship' || effectiveSearchTarget === 'all') {
                    // JSON metadataの続柄を検索
                    const relationships = metadata.relationship || [];
                    for (const rel of relationships) {
                        if (useRegex) {
                            if (searchPattern.test(rel)) {
                                relationshipMatched = true;
                                break;
                            }
                        } else {
                            if (rel.toLowerCase().includes(searchText.toLowerCase())) {
                                relationshipMatched = true;
                                break;
                            }
                        }
                    }

                    // link要素のrelationship属性も検索
                    if (!relationshipMatched) {
                        const linkRelationships = await this.extractLinkRelationshipsFromRealObject(metadata.realId);
                        for (const rel of linkRelationships) {
                            if (useRegex) {
                                if (searchPattern.test(rel)) {
                                    relationshipMatched = true;
                                    break;
                                }
                            } else {
                                if (rel.toLowerCase().includes(searchText.toLowerCase())) {
                                    relationshipMatched = true;
                                    break;
                                }
                            }
                        }
                    }
                }

                // 本文検索
                if (effectiveSearchTarget === 'content' || effectiveSearchTarget === 'all') {
                    const textContent = await this.extractTextFromRealObject(metadata.realId);
                    if (textContent) {
                        if (useRegex) {
                            const match = searchPattern.exec(textContent);
                            if (match) {
                                contentMatched = true;
                                const start = Math.max(0, match.index - 20);
                                const end = Math.min(textContent.length, match.index + match[0].length + 20);
                                matchedText = textContent.substring(start, end);
                            }
                        } else {
                            const lowerContent = textContent.toLowerCase();
                            const lowerSearch = searchText.toLowerCase();
                            const index = lowerContent.indexOf(lowerSearch);
                            if (index >= 0) {
                                contentMatched = true;
                                const start = Math.max(0, index - 20);
                                const end = Math.min(textContent.length, index + searchText.length + 20);
                                matchedText = textContent.substring(start, end);
                            }
                        }
                    }
                }

                // 文字列一致を判定
                stringMatched = nameMatched || relationshipMatched || contentMatched;

                // マッチタイプを決定（複合表示形式: name+relationship+content）
                const matchTypes = [];
                if (nameMatched) matchTypes.push('name');
                if (relationshipMatched) matchTypes.push('relationship');
                if (contentMatched) matchTypes.push('content');
                if (matchTypes.length > 0) {
                    matchType = matchTypes.join('+');
                }
            } else {
                // 文字列指定なしの場合は一致扱い
                stringMatched = true;
                matchType = 'date';
            }

            // 日付と文字列の両方が一致した場合に結果に追加
            if (dateMatched && stringMatched) {
                // 処理済みとしてマーク（重複防止用）
                processedRealIds.add(metadata.realId);

                // 仮身属性を抽出（色、サイズなど）
                const vobjAttrs = await this.extractVobjAttributesFromRealObject(metadata.realId);

                results.push({
                    realId: metadata.realId,
                    name: metadata.name || '無題',
                    link_id: `${metadata.realId}_0.xtad`,
                    matchType: matchType,
                    matchedText: matchedText,
                    makeDate: metadata.makeDate,
                    updateDate: metadata.updateDate,
                    accessDate: metadata.accessDate,
                    // VirtualObjectRenderer用の仮身属性（XTADから抽出した値を含める）
                    virtualObject: {
                        link_id: `${metadata.realId}_0.xtad`,
                        link_name: metadata.name || '無題',
                        ...(vobjAttrs || {})
                    }
                });
            }

            // 進捗報告（10件ごと）
            if (eventSource && processedCount % 10 === 0) {
                this.parentMessageBus.respondTo(eventSource, 'search-real-objects-progress', {
                    totalCount: processedCount,
                    matchCount: results.length
                });
            }
        }

        // 最終進捗報告
        if (eventSource) {
            this.parentMessageBus.respondTo(eventSource, 'search-real-objects-progress', {
                totalCount: processedCount,
                matchCount: results.length
            });
        }

        logger.info('[TADjs] 日付検索結果:', results.length, '件');
        return results;
    }

    /**
     * 実身からテキスト内容を抽出（全文検索用）
     * @param {string} realId - 実身ID
     * @returns {Promise<string|null>} テキスト内容
     */
    async extractTextFromRealObject(realId) {
        try {
            const basePath = this.getDataBasePath();

            // 全レコードのXTADファイルからテキストを抽出
            let allText = '';
            let recordNo = 0;

            while (true) {
                const xtadPath = this.realObjectSystem.path.join(basePath, `${realId}_${recordNo}.xtad`);
                if (!this.realObjectSystem.fs.existsSync(xtadPath)) {
                    break;
                }

                const xtadContent = this.realObjectSystem.fs.readFileSync(xtadPath, 'utf-8');
                const textContent = this.extractTextFromXTADContent(xtadContent);
                if (textContent) {
                    allText += textContent + '\n';
                }
                recordNo++;
            }

            return allText.trim() || null;
        } catch (error) {
            logger.warn('[TADjs] テキスト抽出エラー:', realId, error);
            return null;
        }
    }

    /**
     * XTAD XMLコンテンツからテキスト部分を抽出
     * @param {string} xtadContent - XTAD XML文字列
     * @returns {string} 抽出されたテキスト
     */
    extractTextFromXTADContent(xtadContent) {
        try {
            // DOMParserでXMLを解析
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xtadContent, 'text/xml');

            // パースエラーをチェック
            const parseError = xmlDoc.querySelector('parsererror');
            if (parseError) {
                return '';
            }

            // テキストノードを再帰的に収集
            const textParts = [];
            const collectText = (node) => {
                if (node.nodeType === Node.TEXT_NODE) {
                    const text = node.textContent.trim();
                    if (text) {
                        textParts.push(text);
                    }
                } else if (node.nodeType === Node.ELEMENT_NODE) {
                    // link要素のname属性も含める
                    if (node.tagName === 'link') {
                        const linkName = node.getAttribute('name');
                        if (linkName) {
                            textParts.push(linkName);
                        }
                    }
                    // 子ノードを再帰処理
                    for (const child of node.childNodes) {
                        collectText(child);
                    }
                }
            };

            collectText(xmlDoc.documentElement);
            return textParts.join(' ');
        } catch (error) {
            logger.warn('[TADjs] XTAD テキスト抽出エラー:', error);
            return '';
        }
    }

    /**
     * 実身からlink要素のrelationship属性を抽出（続柄検索用）
     * @param {string} realId - 実身ID
     * @returns {Promise<string[]>} 続柄タグの配列
     */
    async extractLinkRelationshipsFromRealObject(realId) {
        try {
            const basePath = this.getDataBasePath();
            const allRelationships = [];
            let recordNo = 0;

            while (true) {
                const xtadPath = this.realObjectSystem.path.join(basePath, `${realId}_${recordNo}.xtad`);
                if (!this.realObjectSystem.fs.existsSync(xtadPath)) {
                    break;
                }

                const xtadContent = this.realObjectSystem.fs.readFileSync(xtadPath, 'utf-8');
                const relationships = this.extractLinkRelationshipsFromXTADContent(xtadContent);
                allRelationships.push(...relationships);
                recordNo++;
            }

            return allRelationships;
        } catch (error) {
            logger.warn('[TADjs] link続柄抽出エラー:', realId, error);
            return [];
        }
    }

    /**
     * XTAD XMLコンテンツからlink要素のrelationship属性を抽出
     * @param {string} xtadContent - XTAD XML文字列
     * @returns {string[]} 続柄タグの配列
     */
    extractLinkRelationshipsFromXTADContent(xtadContent) {
        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xtadContent, 'text/xml');

            const parseError = xmlDoc.querySelector('parsererror');
            if (parseError) {
                return [];
            }

            const relationships = [];
            const linkElements = xmlDoc.getElementsByTagName('link');

            for (let i = 0; i < linkElements.length; i++) {
                const link = linkElements[i];
                const relationshipAttr = link.getAttribute('relationship');
                if (relationshipAttr && relationshipAttr.trim()) {
                    // スペース区切りで分割して配列に追加
                    const tags = relationshipAttr.split(/\s+/).filter(s => s.trim() !== '');
                    relationships.push(...tags);
                }
            }

            return relationships;
        } catch (error) {
            return [];
        }
    }

    /**
     * 実身から仮身属性（色、サイズなど）を抽出
     * @param {string} realId - 実身ID
     * @returns {Promise<Object|null>} 仮身属性オブジェクト
     */
    async extractVobjAttributesFromRealObject(realId) {
        try {
            const basePath = this.getDataBasePath();
            const xtadPath = this.realObjectSystem.path.join(basePath, `${realId}_0.xtad`);

            if (!this.realObjectSystem.fs.existsSync(xtadPath)) {
                return null;
            }

            const xtadContent = this.realObjectSystem.fs.readFileSync(xtadPath, 'utf-8');
            return this.extractVobjAttributesFromXTADContent(xtadContent);
        } catch (error) {
            logger.warn('[TADjs] 仮身属性抽出エラー:', realId, error);
            return null;
        }
    }

    /**
     * XTAD XMLコンテンツから最初のlink要素の仮身属性を抽出
     * @param {string} xtadContent - XTAD XML文字列
     * @returns {Object|null} 仮身属性（chcol, tbcol, frcol, bgcol, chsz等）
     */
    extractVobjAttributesFromXTADContent(xtadContent) {
        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xtadContent, 'text/xml');

            const parseError = xmlDoc.querySelector('parsererror');
            if (parseError) {
                return null;
            }

            // 最初のlink要素を取得
            const linkElement = xmlDoc.querySelector('link');
            if (!linkElement) {
                return null;
            }

            // 仮身属性を抽出
            return {
                chcol: linkElement.getAttribute('chcol') || undefined,
                tbcol: linkElement.getAttribute('tbcol') || undefined,
                frcol: linkElement.getAttribute('frcol') || undefined,
                bgcol: linkElement.getAttribute('bgcol') || undefined,
                chsz: linkElement.getAttribute('chsz') || undefined,
                pictdisp: linkElement.getAttribute('pictdisp') || undefined,
                namedisp: linkElement.getAttribute('namedisp') || undefined,
                roledisp: linkElement.getAttribute('roledisp') || undefined,
                typedisp: linkElement.getAttribute('typedisp') || undefined,
                updatedisp: linkElement.getAttribute('updatedisp') || undefined,
                framedisp: linkElement.getAttribute('framedisp') || undefined
            };
        } catch (error) {
            logger.warn('[TADjs] XTAD 仮身属性抽出エラー:', error);
            return null;
        }
    }

    /**
     * load-image-file ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleLoadImageFile(data, event) {
        logger.info('[TADjs] 画像ファイル読み込み要求:', data.fileName);
        await this.loadImageFile(data.fileName, data.messageId, event.source);
    }

    /**
     * read-xtad-text ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleReadXtadText(data, event) {
        logger.info('[TADjs] read-xtad-text受信:', data.realId);
        try {
            const result = await this.readXtadText(data.realId);

            if (event.source) {
                this.parentMessageBus.respondTo(event.source, 'xtad-text-loaded', {
                    realId: data.realId,
                    success: result.success,
                    text: result.text,
                    error: result.error
                });
            }
        } catch (error) {
            logger.error('[TADjs] xtadテキストを読み取るエラー:', error);
            if (event.source) {
                this.parentMessageBus.respondTo(event.source, 'xtad-text-loaded', {
                    realId: data.realId,
                    success: false,
                    error: error.message
                });
            }
        }
    }

    /**
     * read-icon-file ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleReadIconFile(data, event) {
        logger.debug('[TADjs] read-icon-file受信:', data.realId);
        try {
            const result = await this.readIconFile(data.realId);

            if (event.source) {
                this.parentMessageBus.respondTo(event.source, 'icon-file-loaded', {
                    messageId: data.messageId,
                    realId: data.realId,
                    success: result.success,
                    filePath: result.filePath,
                    error: result.error
                });
            }
        } catch (error) {
            logger.error('[TADjs] アイコンファイルパス取得エラー:', error);
            if (event.source) {
                this.parentMessageBus.respondTo(event.source, 'icon-file-loaded', {
                    messageId: data.messageId,
                    realId: data.realId,
                    success: false,
                    error: error.message
                });
            }
        }
    }

    /**
     * cache-cloud-icons ハンドラー
     * クラウドからアイコンファイルをダウンロードしてローカルにキャッシュする
     * @param {Object} data - { tenantId, realIds, messageId }
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleCacheCloudIcons(data, event) {
        const { tenantId, realIds, messageId } = data;
        logger.debug('[TADjs] cache-cloud-icons受信:', tenantId, realIds?.length, '件');

        let cachedCount = 0;
        try {
            if (tenantId && realIds && realIds.length > 0 && window.cloudAPI) {
                const promises = realIds.map(async (realId) => {
                    try {
                        const result = await window.cloudAPI.downloadFile(tenantId, realId, `${realId}.ico`);
                        if (result.success && result.data) {
                            const bytes = new Uint8Array(result.data);
                            if (await this.saveDataFile(`${realId}.ico`, bytes)) {
                                cachedCount++;
                            }
                        }
                    } catch (e) {
                        // 個別のアイコンダウンロード失敗は無視
                    }
                });
                await Promise.all(promises);
            }
        } catch (error) {
            logger.error('[TADjs] クラウドアイコンキャッシュエラー:', error);
        }

        logger.debug('[TADjs] クラウドアイコンキャッシュ完了:', cachedCount, '件');

        if (event.source) {
            this.parentMessageBus.respondTo(event.source, 'cloud-icons-cached', {
                messageId,
                cachedCount
            });
        }
    }

    /**
     * download-cloud-to-local ハンドラー
     * プラグインからのリクエストでクラウド実身をローカルにダウンロード保存する
     * @param {Object} data - { tenantId, realId, messageId }
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleDownloadCloudToLocal(data, event) {
        const { tenantId, realId, messageId } = data;
        let success = false;
        try {
            success = await this.downloadCloudRealObjectToLocal(tenantId, realId);
        } catch (error) {
            // エラーはdownloadCloudRealObjectToLocal内でログ済み
        }
        if (event.source) {
            this.parentMessageBus.respondTo(event.source, 'download-cloud-to-local-response', {
                messageId: messageId,
                success: success
            });
        }
    }

    /**
     * get-clipboard ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleGetClipboard(data, event) {
        if (event.source) {
            this.parentMessageBus.respondTo(event.source, 'clipboard-data', {
                messageId: data.messageId,
                windowId: data.windowId,
                clipboardData: this.clipboard
            });
        }
        logger.info('[TADjs] クリップボードを取得:', this.clipboard?.type || this.clipboard?.link_name);
    }

    /**
     * get-text-clipboard ハンドラー（テキストクリップボード取得）
     * プラグインからのテキストクリップボード取得要求に応答
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleGetTextClipboard(data, event) {
        try {
            // Electron APIからテキストクリップボードを取得
            const text = await window.electronAPI.clipboardReadText();
            if (event.source) {
                this.parentMessageBus.respondTo(event.source, 'text-clipboard-data', {
                    messageId: data.messageId,
                    windowId: data.windowId,
                    text: text
                });
            }
            logger.debug('[TADjs] テキストクリップボードを取得:', text?.substring(0, 50));
        } catch (err) {
            logger.error('[TADjs] テキストクリップボード取得エラー:', err.message);
            if (event.source) {
                this.parentMessageBus.respondTo(event.source, 'text-clipboard-data', {
                    messageId: data.messageId,
                    windowId: data.windowId,
                    text: null,
                    error: err.message
                });
            }
        }
    }

    // ========================================
    // MessageRouter ハンドラーメソッド (Phase 4 Batch 3)
    // ========================================

    /**
     * rename-real-object MessageRouterハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleRenameRealObjectRouter(data, event) {
        // 既存のhandleRenameRealObjectメソッドを呼び出し
        await this.handleRenameRealObject(event).catch(err => {
            logger.error('[TADjs] 実身名変更エラー:', err);
        });
    }

    /**
     * duplicate-real-object MessageRouterハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleDuplicateRealObjectRouter(data, event) {
        if (!this.realObjectSystem) {
            logger.error('[TADjs] 実身仮身システムが初期化されていません');
            return;
        }

        const source = event?.source;
        logger.info('[TADjs] duplicate-real-objectメッセージ受信:', {
            messageId: data.messageId,
            realId: data.realId,
            newName: data.newName,
            hasSource: !!source
        });

        if (!source) {
            logger.error('[TADjs] sourceが取得できませんでした');
            return;
        }

        const { realId: fullRealId, messageId } = data;

        // 実身IDを抽出（_0.xtad を除去）
        let realId = fullRealId;
        if (realId.match(/_\d+\.xtad$/i)) {
            realId = realId.replace(/_\d+\.xtad$/i, '');
        }

        try {
            let newName = data.newName;

            // newNameがメッセージに含まれていない場合のみダイアログを表示（後方互換性）
            if (!newName) {
                // 元の実身のメタデータを取得
                const sourceRealObject = await this.realObjectSystem.loadRealObject(realId);
                const defaultName = (sourceRealObject.metadata.name || '実身') + 'のコピー';

                // 名前入力ダイアログを表示
                const result = await this.showInputDialog(
                    '新しい実身の名称を入力してください',
                    defaultName,
                    30,
                    [
                        { label: '取消', value: 'cancel' },
                        { label: '設定', value: 'ok' }
                    ],
                    1
                );

                // キャンセルされた場合
                if (result.button === 'cancel' || !result.value) {
                    logger.info('[TADjs] 実身複製がキャンセルされました');
                    this.parentMessageBus.respondTo(source, 'real-object-duplicated', {
                        messageId: messageId,
                        success: false,
                        cancelled: true
                    });
                    return;
                }

                newName = result.value;
            }

            // RealObjectSystemの実身コピー機能を使用（再帰的コピー）
            const newRealId = await this.realObjectSystem.copyRealObject(realId);

            // 新しい実身のメタデータを取得
            const newRealObject = await this.realObjectSystem.loadRealObject(newRealId);

            // 名前を更新
            newRealObject.metadata.name = newName;
            await this.realObjectSystem.saveRealObject(newRealId, newRealObject);

            // JSONファイルにもrefCountを書き込む
            await this.updateJsonFileRefCount(newRealId);

            // 成功を通知
            this.parentMessageBus.respondTo(source, 'real-object-duplicated', {
                messageId: messageId,
                success: true,
                newRealId: newRealId,
                newName: newName
            });

            logger.info('[TADjs] 実身複製完了:', realId, '->', newRealId, '名前:', newName);
            this.setStatusMessage(`実身を複製しました: ${newName}`);
        } catch (error) {
            logger.error('[TADjs] 実身複製エラー:', error);
            this.parentMessageBus.respondTo(source, 'real-object-duplicated', {
                messageId: messageId,
                success: false,
                error: error.message
            });
        }
    }

    /**
     * save-as-new-real-object MessageRouterハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleSaveAsNewRealObjectRouter(data, event) {
        // 既存のhandleSaveAsNewRealObjectメソッドを呼び出し（Phase 2形式: data, event）
        await this.handleSaveAsNewRealObject(data, event).catch(err => {
            logger.error('[TADjs] 新たな実身に保存エラー:', err);
        });
    }

    /**
     * change-virtual-object-attributes MessageRouterハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleChangeVirtualObjectAttributesRouter(data, event) {
        // 既存のhandleChangeVirtualObjectAttributesメソッドを呼び出し（Phase 2形式: data, event）
        await this.handleChangeVirtualObjectAttributes(data, event).catch(err => {
            logger.error('[TADjs] 仮身属性変更エラー:', err);
        });
    }

    /**
     * set-relationship MessageRouterハンドラー
     * 実身の続柄（relationship）とlink要素のrelationship属性を設定する
     * [タグ]形式は実身JSON用、それ以外はlink属性用
     * @param {Object} data - メッセージデータ { realId, linkId, currentLinkRelationship, messageId }
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleSetRelationshipRouter(data, event) {
        if (!this.realObjectSystem) {
            logger.error('[TADjs] 実身仮身システムが初期化されていません');
            return;
        }

        const source = event?.source;
        if (!source) {
            logger.error('[TADjs] sourceが取得できませんでした');
            return;
        }

        const { realId: fullRealId, linkId, currentLinkRelationship, messageId } = data;

        // 実身IDを抽出（_0.xtad を除去）
        let realId = fullRealId;
        if (realId && realId.match(/_\d+\.xtad$/i)) {
            realId = realId.replace(/_\d+\.xtad$/i, '');
        }

        try {
            // 現在の続柄を取得
            const realObject = await this.realObjectSystem.loadRealObject(realId);
            const currentJsonRelationship = realObject.metadata.relationship || [];
            const currentLinkRel = currentLinkRelationship || [];

            // 表示用テキストを生成（JSON用は[タグ]形式、link用はそのまま）
            const jsonPart = currentJsonRelationship.map(t => `[${t}]`).join(' ');
            const linkPart = currentLinkRel.join(' ');
            const currentText = [jsonPart, linkPart].filter(t => t).join(' ');

            // 入力ダイアログを表示
            const result = await this.showInputDialog(
                '続柄（リレーションタグ名）を入力してください\n[タグ]形式は実身用、それ以外は仮身用（半角スペース区切りで複数設定可）',
                currentText,
                50,
                [
                    { label: '取消', value: 'cancel' },
                    { label: '設定', value: 'ok' }
                ],
                1
            );

            // キャンセルされた場合
            if (result.button === 'cancel' || result.value === null) {
                this.parentMessageBus.respondTo(source, 'relationship-set', {
                    messageId: messageId,
                    success: false,
                    cancelled: true
                });
                return;
            }

            // 入力をパースしてJSON用とlink用に分離
            const parsed = this.parseRelationshipInput(result.value);
            const newJsonRelationship = parsed.jsonRelationship;
            const newLinkRelationship = parsed.linkRelationship;

            // JSONファイルを直接更新（実身の続柄）
            const jsonPath = this.path.join(this.realObjectSystem._basePath, `${realId}.json`);
            const jsonContent = JSON.parse(this.fs.readFileSync(jsonPath, 'utf-8'));
            jsonContent.relationship = newJsonRelationship;
            jsonContent.updateDate = new Date().toISOString();
            this.fs.writeFileSync(jsonPath, JSON.stringify(jsonContent, null, 2));

            // 成功を通知（link属性の更新はプラグイン側で行う）
            this.parentMessageBus.respondTo(source, 'relationship-set', {
                messageId: messageId,
                success: true,
                relationship: newJsonRelationship,
                linkRelationship: newLinkRelationship
            });

            // 表示用テキストを生成
            const displayJsonPart = newJsonRelationship.map(t => `[${t}]`).join(' ');
            const displayLinkPart = newLinkRelationship.join(' ');
            const relationshipText = [displayJsonPart, displayLinkPart].filter(t => t).join(' ') || '（なし）';
            logger.info('[TADjs] 続柄設定完了:', realId, relationshipText);
            this.setStatusMessage(`続柄を設定しました: ${relationshipText}`);
        } catch (error) {
            logger.error('[TADjs] 続柄設定エラー:', error);
            this.parentMessageBus.respondTo(source, 'relationship-set', {
                messageId: messageId,
                success: false,
                error: error.message
            });
        }
    }

    /**
     * 続柄入力文字列をパースしてJSON用とlink属性用に分離
     * [タグ] 形式は実身JSON用、それ以外はlink属性用
     * @param {string} input - 入力文字列（例: "[親1] [親2] 子1 子2"）
     * @returns {{jsonRelationship: string[], linkRelationship: string[]}}
     */
    parseRelationshipInput(input) {
        if (!input || typeof input !== 'string') {
            return { jsonRelationship: [], linkRelationship: [] };
        }

        const jsonRelationship = [];
        const linkRelationship = [];

        // [タグ] 形式を抽出（括弧内にスペースがあっても1つのタグとして扱う）
        const bracketPattern = /\[([^\]]+)\]/g;
        let match;
        let lastIndex = 0;
        const remainingParts = [];

        // 入力文字列を走査
        while ((match = bracketPattern.exec(input)) !== null) {
            // 括弧の前のテキストを保存
            if (match.index > lastIndex) {
                remainingParts.push(input.substring(lastIndex, match.index));
            }
            // 括弧内のタグをJSON用に追加
            const tag = match[1].trim();
            if (tag) {
                jsonRelationship.push(tag);
            }
            lastIndex = match.index + match[0].length;
        }

        // 残りのテキストを保存
        if (lastIndex < input.length) {
            remainingParts.push(input.substring(lastIndex));
        }

        // 残りのテキストをスペース区切りでlink属性用に分割
        const remainingText = remainingParts.join('').trim();
        if (remainingText) {
            const tags = remainingText.split(/\s+/).filter(s => s.trim() !== '');
            linkRelationship.push(...tags);
        }

        return { jsonRelationship, linkRelationship };
    }

    // ========================================
    // MessageRouter ハンドラーメソッド (Phase 4 Batch 4)
    // ========================================

    /**
     * open-virtual-object ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleOpenVirtualObject(data, event) {
        logger.info('[TADjs] 仮身を開く要求:', data);
        // cloudContext: メッセージに含まれていなければ送信元ウィンドウから継承
        let cloudContext = data.cloudContext || null;
        if (!cloudContext && data.sourceWindowId) {
            cloudContext = this._windowCloudContexts.get(data.sourceWindowId) || null;
        }
        this.openVirtualObject(data.linkId, data.linkName, cloudContext);
    }

    /**
     * open-virtual-object-real ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleOpenVirtualObjectReal(data, event) {
        logger.debug('[TADjs] 仮身の実身を開く要求:', data);
        // cloudContext: メッセージに含まれていなければ送信元ウィンドウから継承
        let cloudContext = data.cloudContext || null;
        if (!cloudContext && data.sourceWindowId) {
            cloudContext = this._windowCloudContexts.get(data.sourceWindowId) || null;
        }
        this.openVirtualObjectReal(data.virtualObj, data.pluginId, data.messageId, event.source, cloudContext);
    }

    /**
     * open-tad-link ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleOpenTadLink(data, event) {
        logger.info('[TADjs] TADリンクを開く要求:', data.linkData);
        const linkData = data.linkData;
        const linkRecordList = data.linkRecordList;  // 親ウィンドウから受け取ったlinkRecordList
        if (linkData && linkData.data) {
            // Uint8Arrayに変換
            const tadData = new Uint8Array(linkData.data);

            // tadjs-viewプラグインで開く
            if (window.pluginManager) {
                const plugin = window.pluginManager.getPlugin('tadjs-view');
                if (plugin) {
                    // fileDataを作成
                    const fileData = {
                        fileName: linkData.title + '.tad',
                        rawData: tadData,
                        displayName: linkData.title,
                        fileId: null,
                        realId: null,
                        originalLinkId: linkData.linkId,  // createTADWindowと同様にoriginalLinkIdを渡す
                        linkRecordList: linkRecordList,   // BPK全体のlinkRecordListを渡す
                        tadRecordDataArray: data.tadRecordDataArray || []  // tadRecordDataArrayも渡す
                    };

                    logger.info('[TADjs] tadjs-viewプラグインでリンクを開く:', fileData);
                    logger.info('[TADjs] Passing linkRecordList with', linkRecordList ? linkRecordList.length : 0, 'files');
                    await window.pluginManager.createPluginWindow(plugin, fileData);
                } else {
                    logger.error('[TADjs] tadjs-viewプラグインが見つかりません');
                }
            } else {
                logger.error('[TADjs] プラグインマネージャーが初期化されていません');
            }
        }
    }

    /**
     * open-external-file ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleOpenExternalFile(data, event) {
        logger.info('[TADjs] open-external-file受信:', data.realId, data.extension);
        try {
            const result = await this.openExternalFile(data.realId, data.extension);

            if (event.source) {
                this.parentMessageBus.respondTo(event.source, 'external-file-opened', {
                    realId: data.realId,
                    extension: data.extension,
                    success: result.success,
                    error: result.error
                });
            }
        } catch (error) {
            logger.error('[TADjs] 外部ファイルを開くエラー:', error);
            if (event.source) {
                this.parentMessageBus.respondTo(event.source, 'external-file-opened', {
                    realId: data.realId,
                    extension: data.extension,
                    success: false,
                    error: error.message
                });
            }
        }
    }

    /**
     * open-url-external ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleOpenUrlExternal(data, event) {
        logger.info('[TADjs] open-url-external受信:', data.url);
        try {
            const result = await this.openUrlExternal(data.url);

            if (event.source) {
                this.parentMessageBus.respondTo(event.source, 'url-opened', {
                    url: data.url,
                    success: result.success,
                    error: result.error
                });
            }
        } catch (error) {
            logger.error('[TADjs] URLを開くエラー:', error);
            if (event.source) {
                this.parentMessageBus.respondTo(event.source, 'url-opened', {
                    url: data.url,
                    success: false,
                    error: error.message
                });
            }
        }
    }

    // ========================================
    // MessageRouter ハンドラーメソッド (Phase 4 Batch 5)
    // ========================================

    /**
     * archive-drop-detected ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleArchiveDropDetected(data, event) {
        logger.info('[TADjs] ドロップ通知転送（virtual-object-list → unpack-file）');
        // 特定のウィンドウ内のunpack-fileプラグインのみにメッセージを転送
        // sourceWindowIdをdragDataに追加（unpack-fileがルート配置時に使用）
        const dragDataWithSource = {
            ...data.dragData,
            sourceWindowId: data.sourceWindowId  // virtual-object-listのウィンドウID
        };
        this.forwardMessageToPluginInWindow(data.targetWindowId, 'unpack-file', {
            type: 'archive-drop-detected',
            dropPosition: data.dropPosition,
            dragData: dragDataWithSource
        });
    }

    /**
     * archive-drop-handled ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleArchiveDropHandled(data, event) {
        logger.info('[TADjs] アーカイブドロップ処理完了通知、元のウィンドウID:', data.sourceWindowId);
        if (data.sourceWindowId) {
            this.forwardMessageToWindow(data.sourceWindowId, {
                type: 'cross-window-drop-completed',
                mode: 'copy' // アーカイブドロップはコピー扱い
            });
        }
    }

    /**
     * base-file-drop-request ハンドラー
     * プラグインからの原紙ドロップ要求を処理
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleBaseFileDropRequest(data, event) {
        logger.info('[TADjs] base-file-drop-request受信:', data.dragData?.type);
        // 擬似メッセージイベントを作成（handleBaseFileDropが期待する形式）
        const pseudoMessageEvent = {
            source: event.source,
            data: {
                dropPosition: data.dropPosition,
                clientX: data.clientX,
                clientY: data.clientY
            }
        };
        await this.handleBaseFileDrop(data.dragData, pseudoMessageEvent);
    }

    /**
     * insert-root-virtual-object ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleInsertRootVirtualObject(data, event) {
        logger.info('[TADjs] ルート実身配置要求転送（unpack-file → virtual-object-list）');
        // 特定のウィンドウ内のvirtual-object-listプラグインのみにメッセージを転送
        this.forwardMessageToPluginInWindow(data.targetWindowId, 'virtual-object-list', {
            type: 'insert-root-virtual-object',
            rootFileData: data.rootFileData,
            x: data.x,
            y: data.y,
            sourceWindowId: data.sourceWindowId
        });
    }

    /**
     * root-virtual-object-inserted ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleRootVirtualObjectInserted(data, event) {
        logger.info('[TADjs] ルート実身配置完了通知転送（virtual-object-list → unpack-file）');
        // 特定のウィンドウ内のunpack-fileプラグインのみにメッセージを転送
        this.forwardMessageToPluginInWindow(data.targetWindowId, 'unpack-file', {
            type: 'root-virtual-object-inserted',
            success: data.success
        });
    }

    /**
     * archive-files-generated ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleArchiveFilesGeneratedRouter(data, event) {
        const filesCount = data.files ? data.files.length : 0;
        const imagesCount = data.images ? data.images.length : 0;
        const chunkInfo = data.chunkInfo || { index: 0, total: 1, isLast: true };
        logger.info(`[TADjs] 実身ファイルセットチャンク受信 (${chunkInfo.index + 1}/${chunkInfo.total}):`, filesCount, '個のファイル、', imagesCount, '個の画像');
        await this.handleArchiveFilesGenerated(data.files, data.images);
    }

    /**
     * url-drop-request ハンドラー
     * プラグインからのURLドロップ要求を処理
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleUrlDropRequest(data, event) {
        logger.info('[TADjs] url-drop-request受信:', data.url);
        const { url, dropX, dropY, windowId } = data;

        // 対象のiframeを取得（childrenから検索）
        let iframe = null;
        for (const [_id, childInfo] of this.parentMessageBus.children.entries()) {
            if (childInfo.windowId === windowId) {
                iframe = childInfo.iframe;
                break;
            }
        }

        // handleUrlDropを呼び出し
        await this.handleUrlDrop(url, iframe, dropX, dropY);
    }

    /**
     * trash-real-object-drop-request ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleTrashRealObjectDropRequest(data, event) {
        logger.info('[TADjs] trash-real-object-drop-request受信:', data);
        this.handleTrashRealObjectDrop(data.dragData, event);
    }

    /**
     * notify-cross-window-drop ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleNotifyCrossWindowDrop(data, event) {
        logger.info('[TADjs] notify-cross-window-drop受信:', data);
        this.notifySourceWindowOfCrossWindowDropInProgress(data);
    }

    /**
     * cross-window-drop-success ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleCrossWindowDropSuccess(data, event) {
        logger.info('[TADjs] cross-window-drop-success受信:', data);
        this.notifySourceWindowOfCrossWindowDrop(data);
    }

    /**
     * files-dropped-on-plugin ハンドラー
     * プラグインにドロップされたファイルを処理
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleFilesDroppedOnPlugin(data, event) {
        logger.info('[TADjs] files-dropped-on-plugin受信:', data.files?.length, '個のファイル');

        const { files, windowId, targetCell } = data;

        if (!files || files.length === 0) {
            logger.warn('[TADjs] ドロップされたファイルがありません');
            return;
        }

        // ターゲットウィンドウのiframeを取得
        const windowElement = document.getElementById(windowId);
        if (!windowElement) {
            logger.warn('[TADjs] ターゲットウィンドウが見つかりません:', windowId);
            return;
        }

        const iframe = windowElement.querySelector('iframe');
        if (!iframe || !iframe.contentWindow) {
            logger.warn('[TADjs] iframeが見つかりません');
            return;
        }

        // ファイルデータからFileオブジェクトを再構築
        // 複数ファイルの場合、横方向に並べて配置
        let fileIndex = 0;
        for (const fileInfo of files) {
            try {
                if (!fileInfo.data) {
                    logger.warn('[TADjs] ファイルデータがありません:', fileInfo.name);
                    continue;
                }

                // Base64からバイナリデータに変換
                const binary = atob(fileInfo.data);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) {
                    bytes[i] = binary.charCodeAt(i);
                }

                // Fileオブジェクトを作成
                const blob = new Blob([bytes], { type: fileInfo.type || 'application/octet-stream' });
                const file = new File([blob], fileInfo.name, { type: fileInfo.type });

                // FileImportManagerを使用して実身を作成
                if (this.fileImportManager) {
                    const realObjectInfo = await this.fileImportManager.createRealObjectFromImportedFile(file);

                    if (realObjectInfo) {
                        // 各ファイルのセル位置を計算（横方向に並べる）
                        const currentTargetCell = targetCell ? {
                            col: targetCell.col + fileIndex,
                            row: targetCell.row
                        } : null;

                        // プラグインに仮身追加メッセージを送信
                        this.parentMessageBus.sendToWindow(windowId, 'add-virtual-object-from-base', {
                            realId: realObjectInfo.realId,
                            name: realObjectInfo.name,
                            dropPosition: { x: data.clientX, y: data.clientY },
                            targetCell: currentTargetCell,
                            applist: realObjectInfo.applist
                        });
                        this.setStatusMessage(`実身「${realObjectInfo.name}」を作成しました`);
                        fileIndex++;
                    }
                }
            } catch (error) {
                logger.error('[TADjs] ファイル処理エラー:', fileInfo.name, error);
            }
        }
    }

    /**
     * image-dropped-on-plugin ハンドラー
     * プラグインにドロップされた画像を処理（基本文章編集からのドラッグ）
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleImageDroppedOnPlugin(data, event) {
        logger.info('[TADjs] image-dropped-on-plugin受信:', data.dragData?.imageInfo?.savedFilename);

        const { dragData, windowId, clientX, clientY } = data;

        if (!dragData || !dragData.imageInfo) {
            logger.warn('[TADjs] 画像情報がありません');
            return;
        }

        const imageInfo = dragData.imageInfo;
        const savedFilename = imageInfo.savedFilename;

        if (!savedFilename) {
            logger.warn('[TADjs] 画像ファイル名がありません');
            return;
        }

        try {
            // 画像ファイルを読み込む
            let imageData = null;

            if (this.isElectronEnv) {
                const fs = require('fs');
                const path = require('path');

                // データフォルダから画像を読み込む
                const imagePath = path.join(this.getDataBasePath(), savedFilename);

                if (fs.existsSync(imagePath)) {
                    const buffer = fs.readFileSync(imagePath);
                    imageData = buffer;
                    logger.debug('[TADjs] 画像ファイル読み込み成功:', imagePath);
                } else {
                    logger.warn('[TADjs] 画像ファイルが見つかりません:', imagePath);
                    this.setStatusMessage('画像ファイルが見つかりません');
                    return;
                }
            }

            if (!imageData) {
                logger.warn('[TADjs] 画像データを取得できませんでした');
                return;
            }

            // 基本図形編集プラグインの原紙を使用して新しい実身を作成
            const baseFileId = '019a0000-0000-0000-0000-000000000003';  // basic-figure-editor原紙
            const pluginId = 'basic-figure-editor';

            // 新しい実身名
            const newName = savedFilename.replace(/\.[^.]+$/, '');  // 拡張子を除去

            // 新しい実身IDを生成
            const newRealId = typeof generateUUIDv7 === 'function' ? generateUUIDv7() : this.generateRealFileIdSet(1).fileId;

            // 原紙のJSONを読み込む
            const jsonPath = `plugins/${pluginId}/${baseFileId}.json`;
            const jsonResponse = await fetch(jsonPath);
            if (!jsonResponse.ok) {
                logger.error('[TADjs] 原紙JSON読み込み失敗');
                return;
            }
            const basefileJson = await jsonResponse.json();

            // 新しい実身のJSONを作成
            const currentDateTime = new Date().toISOString();
            const newRealJson = {
                ...basefileJson,
                name: newName,
                makeDate: currentDateTime,
                updateDate: currentDateTime,
                accessDate: currentDateTime,
                refCount: 1
            };

            // 画像を含むXTADを作成
            const imageWidth = imageInfo.width || 200;
            const imageHeight = imageInfo.height || 200;
            const newImageFilename = `${newRealId}_0_0.png`;

            const newRealXtad = `<?xml version="1.0" encoding="UTF-8"?>
<tad version="0.2">
<header filename="${newName}"/>
<document>
<figure>
<shape type="image" x="10" y="10" width="${imageWidth}" height="${imageHeight}" savedFilename="${newImageFilename}"/>
</figure>
</document>
</tad>`;

            // ファイルを保存
            const jsonFileName = window.RealObjectSystem.getRealObjectJsonFileName(newRealId);
            const xtadFileName = `${newRealId}_0.xtad`;

            await this.saveDataFile(jsonFileName, JSON.stringify(newRealJson, null, 2));
            await this.saveDataFile(xtadFileName, newRealXtad);
            await this.saveDataFile(newImageFilename, imageData);

            // アイコンをコピー
            try {
                const baseIconPath = `plugins/${pluginId}/${baseFileId}.ico`;
                const iconResponse = await fetch(baseIconPath);
                if (iconResponse.ok) {
                    const iconData = await iconResponse.arrayBuffer();
                    await this.saveDataFile(`${newRealId}.ico`, new Uint8Array(iconData));
                }
            } catch (error) {
                logger.warn('[TADjs] アイコンコピーエラー:', error.message);
            }

            logger.info('[TADjs] 画像から実身を作成しました:', newRealId, newName);

            // プラグインに仮身追加メッセージを送信
            this.parentMessageBus.sendToWindow(windowId, 'add-virtual-object-from-base', {
                realId: newRealId,
                name: newName,
                dropPosition: { x: clientX, y: clientY },
                applist: newRealJson.applist || {}
            });

            this.setStatusMessage(`実身「${newName}」を作成しました`);

        } catch (error) {
            logger.error('[TADjs] 画像処理エラー:', error);
            this.setStatusMessage('画像の処理に失敗しました');
        }
    }

    /**
     * set-data-folder ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleSetDataFolderRouter(data, event) {
        logger.info('[TADjs] set-data-folder受信:', data.dataFolder);
        await this.handleSetDataFolder(data, event);
    }

    /**
     * request-base-plugins ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleRequestBasePlugins(data, event) {
        const basePlugins = window.pluginManager ? window.pluginManager.getBasePlugins() : [];
        if (event.source) {
            this.parentMessageBus.respondTo(event.source, 'base-plugins-response', {
                plugins: basePlugins
            });
        } else {
            logger.warn('[TADjs] e.sourceが存在しません');
        }
    }

    /**
     * load-data-file-request ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleLoadDataFileRequest(data, event) {
        try {
            const fileData = await this.loadDataFileAsFile(data.fileName);
            const responseData = {
                type: 'load-data-file-response',
                messageId: data.messageId,
                fileName: data.fileName,
                success: !!fileData,
                data: fileData || null,
                error: fileData ? null : 'ファイルが見つかりません'
            };

            // sourceWindowIdがある場合、DOMから直接iframeを探して送信（registerChild前でも動作）
            if (data.sourceWindowId) {
                const sent = this.sendResponseToWindowById(data.sourceWindowId, responseData);
                if (!sent && event.source) {
                    // DOMで見つからない場合、event.sourceにフォールバック
                    logger.info('[TADjs] DOM送信失敗、event.sourceにフォールバック');
                    event.source.postMessage(responseData, '*');
                }
            } else if (event.source) {
                // sourceWindowIdがない場合、event.sourceを使用
                event.source.postMessage(responseData, '*');
            } else {
                logger.warn('[TADjs] load-data-file-request: 送信先がありません');
            }
        } catch (error) {
            logger.error('[TADjs] データファイル読み込みエラー:', error);
            const errorResponseData = {
                type: 'load-data-file-response',
                messageId: data.messageId,
                fileName: data.fileName,
                success: false,
                error: error.message
            };
            if (data.sourceWindowId) {
                const sent = this.sendResponseToWindowById(data.sourceWindowId, errorResponseData);
                if (!sent && event.source) {
                    event.source.postMessage(errorResponseData, '*');
                }
            } else if (event.source) {
                event.source.postMessage(errorResponseData, '*');
            }
        }
    }

    /**
     * windowIdからDOMでiframeを探して直接メッセージを送信
     * @param {string} windowId - ウィンドウID
     * @param {Object} message - 送信するメッセージ
     * @returns {boolean} 送信成功したらtrue
     */
    // sendResponseToWindowById は js/tadjs-response-utils.js に移動済み

    /**
     * get-system-fonts ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleGetSystemFonts(data, event) {
        logger.info('[TADjs] get-system-fonts受信 messageId:', data.messageId);
        logger.info('[TADjs] Electron環境:', this.isElectronEnv);

        // Electron環境の場合、IPCでメインプロセスに問い合わせ
        if (this.isElectronEnv && typeof require !== 'undefined') {
            logger.info('[TADjs] IPCでメインプロセスに問い合わせ開始');
            const { ipcRenderer } = require('electron');

            ipcRenderer.invoke('get-system-fonts').then(result => {
                logger.info('[TADjs] IPCから応答受信 success:', result.success, 'fonts:', result.fonts ? result.fonts.length : 0);

                if (result.success && result.fonts) {
                    logger.info('[TADjs] 受信したフォント数:', result.fonts.length);
                }

                logger.info('[TADjs] プラグインに応答を送信 messageId:', data.messageId);
                if (event.source) {
                    this.parentMessageBus.respondTo(event.source, 'system-fonts-response', {
                        messageId: data.messageId,
                        fonts: result.success ? result.fonts : []
                    });
                    logger.info('[TADjs] MessageBus送信完了');
                }
            }).catch(error => {
                logger.error('[TADjs] IPC呼び出しエラー:', error);
                if (event.source) {
                    this.parentMessageBus.respondTo(event.source, 'system-fonts-response', {
                        messageId: data.messageId,
                        fonts: []
                    });
                }
            });
        } else {
            // ブラウザ環境の場合は空配列を返す
            logger.info('[TADjs] ブラウザ環境のため、システムフォント一覧は取得できません');
            if (event.source) {
                this.parentMessageBus.respondTo(event.source, 'system-fonts-response', {
                    messageId: data.messageId,
                    fonts: []
                });
            }
        }
    }

    // ========================================
    // MessageRouter ハンドラーメソッド (Phase 4 Batch 6)
    // ========================================

    /**
     * open-tool-panel-window ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleOpenToolPanelWindow(data, event) {
        logger.info('[TADjs] 道具パネルウィンドウを開く:', data.pluginId);
        // e.sourceからiframe要素を取得
        const pluginIframe = event.source ? event.source.frameElement : null;
        this.openToolPanelWindow(data.pluginId, data.settings, pluginIframe, data.panelpos, data.panelsize);
    }

    /**
     * show-tool-panel-popup ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleShowToolPanelPopup(data, event) {
        this.showToolPanelPopup(data, event.source);
    }

    /**
     * hide-tool-panel-popup ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleHideToolPanelPopup(data, event) {
        this.hideToolPanelPopup();
    }

    /**
     * start-drag-tool-panel ハンドラー（fromToolPanel内で処理）
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleStartDragToolPanel(data, event) {
        if (event.source && event.source.frameElement) {
            const toolPanelIframe = event.source.frameElement;
            const toolPanelWindow = toolPanelIframe.closest('.window');

            if (toolPanelWindow) {
                this.startToolPanelDrag(toolPanelWindow, data.clientX, data.clientY);
            }
        }
    }

    // ========================================
    // 子パネルウィンドウ関連
    // ========================================

    /**
     * open-child-panel-window ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleOpenChildPanelWindow(data, event) {
        const { panelType, parentWindowId, pluginId, options, messageId } = data;

        // パネルURLを構築
        const panelUrl = `plugins/${pluginId}/${options.panelUrl}`;
        const content = `<iframe src="${panelUrl}" style="width: 100%; height: 100%; border: none;"></iframe>`;

        // 親ウィンドウの位置を取得（位置が指定されていない場合）
        let x = options.x;
        let y = options.y;
        if (x === undefined || y === undefined) {
            const parentWindow = document.getElementById(parentWindowId);
            if (parentWindow) {
                const rect = parentWindow.getBoundingClientRect();
                x = x ?? rect.right + 10;
                y = y ?? rect.top;
            } else {
                x = x ?? 100;
                y = y ?? 100;
            }
        }

        // ウィンドウ作成
        const windowId = this.createWindow(options.title, content, {
            width: options.width,
            height: options.height,
            x: x,
            y: y,
            resizable: options.resizable !== false,
            maximizable: false,
            minimizable: false,
            closable: true,
            alwaysOnTop: true,
            scrollable: false,
            frame: options.noTitleBar ? false : true,
            cssClass: 'child-panel-window'
        });

        // 子パネル関連を保存
        this.childPanelRelations[windowId] = {
            parentWindowId,
            pluginId,
            panelType
        };

        // MessageBusに登録して初期化
        setTimeout(() => {
            const windowElement = document.getElementById(windowId);
            if (windowElement) {
                const iframe = windowElement.querySelector('iframe');
                if (iframe) {
                    this.parentMessageBus.registerChild(windowId, iframe, {
                        windowId: windowId,
                        pluginId: pluginId
                    });

                    // 初期化メッセージ送信
                    this.parentMessageBus.sendToWindow(windowId, 'init-child-panel', {
                        windowId: windowId,
                        parentWindowId: parentWindowId,
                        panelType: panelType,
                        initData: options.initData
                    });
                }
            }
        }, 100);

        // 作成完了を通知
        this.parentMessageBus.sendToWindow(parentWindowId, 'child-panel-window-created', {
            messageId,
            windowId,
            panelType
        });
    }

    /**
     * send-to-child-panel ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleSendToChildPanel(data, event) {
        const { targetWindowId, type, data: messageData } = data;
        if (targetWindowId) {
            this.parentMessageBus.sendToWindow(targetWindowId, type, messageData);
        }
    }

    /**
     * start-drag-child-panel ハンドラー
     * 子パネルウィンドウのドラッグ開始
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleStartDragChildPanel(data, event) {
        if (event.source && event.source.frameElement) {
            const childPanelIframe = event.source.frameElement;
            const childPanelWindow = childPanelIframe.closest('.window');

            if (childPanelWindow) {
                // iframe内の座標を親ウィンドウの座標に変換
                const iframeRect = childPanelIframe.getBoundingClientRect();
                const parentClientX = iframeRect.left + data.clientX;
                const parentClientY = iframeRect.top + data.clientY;

                // 既存のウィンドウドラッグ機能を利用
                this.startWindowDrag(childPanelWindow, {
                    clientX: parentClientX,
                    clientY: parentClientY
                });
            }
        }
    }

    // ========================================
    // 検索/置換ウィンドウ関連
    // ========================================

    /**
     * open-find-replace-window ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleOpenFindReplaceWindow(data, event) {
        logger.info('[TADjs] 検索/置換ウィンドウを開く');

        const pluginIframe = event.source ? event.source.frameElement : null;
        if (!pluginIframe) {
            logger.warn('[TADjs] プラグインのiframeが見つかりません');
            return;
        }

        const editorWindowId = this.parentMessageBus.getWindowIdFromIframe(pluginIframe);
        if (!editorWindowId) {
            logger.warn('[TADjs] エディタのwindowIdが見つかりません');
            return;
        }

        // エディタウィンドウの位置を取得
        const editorWindow = document.getElementById(editorWindowId);
        if (!editorWindow) {
            logger.warn('[TADjs] エディタウィンドウ要素が見つかりません');
            return;
        }

        const editorRect = editorWindow.getBoundingClientRect();

        // 検索/置換ウィンドウのコンテンツ
        const pluginPath = 'plugins/basic-text-editor/find-replace.html';
        const content = `<iframe src="${pluginPath}" style="width: 100%; height: 100%; border: none;"></iframe>`;

        // ウィンドウ位置: エディタの右上付近
        const windowWidth = 350;
        const windowHeight = 110;
        const pos = {
            x: editorRect.right - windowWidth - 20,
            y: editorRect.top + 30
        };

        const windowId = this.createWindow('検索/置換', content, {
            width: windowWidth,
            height: windowHeight,
            x: pos.x,
            y: pos.y,
            resizable: false,
            maximizable: false,
            closable: true,
            alwaysOnTop: true,
            cssClass: 'find-replace-window',
            scrollable: false,
            iconData: data.iconData || null
        });

        // 検索/置換ウィンドウとエディタの関連付けを保存
        if (!this.findReplaceRelations) {
            this.findReplaceRelations = {};
        }
        this.findReplaceRelations[windowId] = {
            editorWindowId: editorWindowId,
            editorIframe: pluginIframe
        };

        // 検索/置換ウィンドウに初期設定を送信
        setTimeout(() => {
            const windowElement = document.getElementById(windowId);
            if (windowElement) {
                const iframe = windowElement.querySelector('iframe');
                if (iframe && iframe.contentWindow) {
                    // MessageBusにiframeを登録
                    this.parentMessageBus.registerChild(windowId, iframe, {
                        windowId: windowId,
                        pluginId: 'basic-text-editor-find-replace'
                    });

                    this.parentMessageBus.sendToWindow(windowId, 'init-find-replace', {
                        editorWindowId: editorWindowId,
                        initialSearchText: data.initialSearchText || ''
                    });
                }
            }

            // エディタに検索/置換ウィンドウが開いたことを通知
            this.parentMessageBus.sendToWindow(editorWindowId, 'find-replace-window-created', {
                windowId: windowId
            });
        }, 100);

        logger.info('[TADjs] 検索/置換ウィンドウ作成:', windowId);
    }

    /**
     * find-next ハンドラー - 検索/置換ウィンドウからエディタへ転送
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleFindNext(data, event) {
        const relation = this.getFindReplaceRelation(event.source);
        if (relation) {
            this.parentMessageBus.sendToWindow(relation.editorWindowId, 'find-next-request', {
                searchText: data.searchText,
                isRegex: data.isRegex
            });
        }
    }

    /**
     * replace-next ハンドラー - 検索/置換ウィンドウからエディタへ転送
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleReplaceNext(data, event) {
        const relation = this.getFindReplaceRelation(event.source);
        if (relation) {
            this.parentMessageBus.sendToWindow(relation.editorWindowId, 'replace-next-request', {
                searchText: data.searchText,
                replaceText: data.replaceText,
                isRegex: data.isRegex
            });
        }
    }

    /**
     * replace-all ハンドラー - 検索/置換ウィンドウからエディタへ転送
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleReplaceAll(data, event) {
        const relation = this.getFindReplaceRelation(event.source);
        if (relation) {
            this.parentMessageBus.sendToWindow(relation.editorWindowId, 'replace-all-request', {
                searchText: data.searchText,
                replaceText: data.replaceText,
                isRegex: data.isRegex
            });
        }
    }

    /**
     * 検索/置換ウィンドウの関連情報を取得
     * @param {Window} source - 検索/置換ウィンドウのcontentWindow
     * @returns {Object|null} 関連情報 {editorWindowId, editorIframe}
     */
    getFindReplaceRelation(source) {
        if (!source || !source.frameElement || !this.findReplaceRelations) {
            return null;
        }

        const findReplaceFrame = source.frameElement;
        const findReplaceWindowElement = findReplaceFrame.closest('.window');
        if (!findReplaceWindowElement) {
            return null;
        }

        const findReplaceWindowId = findReplaceWindowElement.id;
        return this.findReplaceRelations[findReplaceWindowId] || null;
    }

    // ========================================
    // 基本表計算用 検索/置換ウィンドウ
    // ========================================

    /**
     * open-calc-find-replace-window ハンドラー
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleOpenCalcFindReplaceWindow(data, event) {
        logger.info('[TADjs] 基本表計算 検索/置換ウィンドウを開く');

        const pluginIframe = event.source ? event.source.frameElement : null;
        if (!pluginIframe) {
            logger.warn('[TADjs] プラグインのiframeが見つかりません');
            return;
        }

        const editorWindowId = this.parentMessageBus.getWindowIdFromIframe(pluginIframe);
        if (!editorWindowId) {
            logger.warn('[TADjs] エディタのwindowIdが見つかりません');
            return;
        }

        // エディタウィンドウの位置を取得
        const editorWindow = document.getElementById(editorWindowId);
        if (!editorWindow) {
            logger.warn('[TADjs] エディタウィンドウ要素が見つかりません');
            return;
        }

        const editorRect = editorWindow.getBoundingClientRect();

        // 検索/置換ウィンドウのコンテンツ
        const pluginPath = 'plugins/basic-calc-editor/find-replace.html';
        const content = `<iframe src="${pluginPath}" style="width: 100%; height: 100%; border: none;"></iframe>`;

        // ウィンドウ位置: エディタの右上付近
        const windowWidth = 350;
        const windowHeight = 110;
        const pos = {
            x: editorRect.right - windowWidth - 20,
            y: editorRect.top + 30
        };

        const windowId = this.createWindow('検索/置換', content, {
            width: windowWidth,
            height: windowHeight,
            x: pos.x,
            y: pos.y,
            resizable: false,
            maximizable: false,
            closable: true,
            alwaysOnTop: true,
            cssClass: 'find-replace-window',
            scrollable: false
        });

        // 検索/置換ウィンドウとエディタの関連付けを保存
        if (!this.calcFindReplaceRelations) {
            this.calcFindReplaceRelations = {};
        }
        this.calcFindReplaceRelations[windowId] = {
            editorWindowId: editorWindowId,
            editorIframe: pluginIframe
        };

        // 検索/置換ウィンドウに初期設定を送信
        setTimeout(() => {
            const windowElement = document.getElementById(windowId);
            if (windowElement) {
                const iframe = windowElement.querySelector('iframe');
                if (iframe && iframe.contentWindow) {
                    // MessageBusにiframeを登録
                    this.parentMessageBus.registerChild(windowId, iframe, {
                        windowId: windowId,
                        pluginId: 'basic-calc-editor-find-replace'
                    });

                    this.parentMessageBus.sendToWindow(windowId, 'init-find-replace', {
                        editorWindowId: editorWindowId,
                        initialSearchText: data.initialSearchText || ''
                    });
                }
            }

            // エディタに検索/置換ウィンドウが開いたことを通知
            this.parentMessageBus.sendToWindow(editorWindowId, 'find-replace-window-created', {
                windowId: windowId
            });
        }, 100);

        logger.info('[TADjs] 基本表計算 検索/置換ウィンドウ作成:', windowId);
    }

    /**
     * calc-find-next ハンドラー - 検索/置換ウィンドウからエディタへ転送
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleCalcFindNext(data, event) {
        const relation = this.getCalcFindReplaceRelation(event.source);
        if (relation) {
            this.parentMessageBus.sendToWindow(relation.editorWindowId, 'calc-find-next-request', {
                searchText: data.searchText,
                isRegex: data.isRegex
            });
        }
    }

    /**
     * calc-replace-next ハンドラー - 検索/置換ウィンドウからエディタへ転送
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleCalcReplaceNext(data, event) {
        const relation = this.getCalcFindReplaceRelation(event.source);
        if (relation) {
            this.parentMessageBus.sendToWindow(relation.editorWindowId, 'calc-replace-next-request', {
                searchText: data.searchText,
                replaceText: data.replaceText,
                isRegex: data.isRegex
            });
        }
    }

    /**
     * calc-replace-all ハンドラー - 検索/置換ウィンドウからエディタへ転送
     * @param {Object} data - メッセージデータ
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<void>}
     */
    async handleCalcReplaceAll(data, event) {
        const relation = this.getCalcFindReplaceRelation(event.source);
        if (relation) {
            this.parentMessageBus.sendToWindow(relation.editorWindowId, 'calc-replace-all-request', {
                searchText: data.searchText,
                replaceText: data.replaceText,
                isRegex: data.isRegex
            });
        }
    }

    /**
     * 基本表計算 検索/置換ウィンドウの関連情報を取得
     * @param {Window} source - 検索/置換ウィンドウのcontentWindow
     * @returns {Object|null} 関連情報 {editorWindowId, editorIframe}
     */
    getCalcFindReplaceRelation(source) {
        if (!source || !source.frameElement || !this.calcFindReplaceRelations) {
            return null;
        }

        const findReplaceFrame = source.frameElement;
        const findReplaceWindowElement = findReplaceFrame.closest('.window');
        if (!findReplaceWindowElement) {
            return null;
        }

        const findReplaceWindowId = findReplaceWindowElement.id;
        return this.calcFindReplaceRelations[findReplaceWindowId] || null;
    }

    // ========================================
    // TADデータ管理
    // ========================================

}

/**
 * TADjsDesktopクラスにメッセージルーターハンドラーメソッドを追加
 * @param {Function} TADjsDesktop - TADjsDesktopクラス
 */
export function applyMessageRouterHandlerMethods(TADjsDesktop) {
    const mixinProto = MessageRouterHandlersMixin.prototype;
    for (const name of Object.getOwnPropertyNames(mixinProto)) {
        if (name !== 'constructor') {
            TADjsDesktop.prototype[name] = mixinProto[name];
        }
    }
}
