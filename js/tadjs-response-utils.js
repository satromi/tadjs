/**
 * TADjsDesktop レスポンス/ログユーティリティメソッド
 * tadjs-desktop.js から抽出した共通ヘルパーメソッド群
 */

const logger = window.getLogger('TADjs');

/**
 * TADjsDesktopクラスにレスポンス/ログユーティリティメソッドを追加
 * @param {Function} TADjsDesktop - TADjsDesktopクラス
 */
export function applyResponseUtilsMethods(TADjsDesktop) {
    Object.assign(TADjsDesktop.prototype, {

        /**
         * レスポンスを送信
         * @param {Window} source - イベントソース
         * @param {string} responseType - レスポンスメッセージタイプ
         * @param {Object} data - レスポンスデータ
         * @param {string} messageId - メッセージID（オプション）
         * @param {string} sourceWindowId - 送信元のwindowId（オプション）
         * @returns {boolean} 送信成功したか
         */
        respond(source, responseType, data, messageId = null, sourceWindowId = null) {
            if (!source && !sourceWindowId) {
                logger.error(`[TADjs] Cannot send ${responseType}: source and sourceWindowId are both null`);
                return false;
            }

            const responseData = messageId
                ? { messageId, ...data }
                : data;

            try {
                this.parentMessageBus.respondTo(source, responseType, responseData, sourceWindowId);
                return true;
            } catch (error) {
                logger.error(`[TADjs] Failed to send ${responseType}:`, error);
                return false;
            }
        },

        /**
         * エラーレスポンスヘルパー
         * @param {Window} source - イベントソース
         * @param {string} responseType - レスポンスメッセージタイプ
         * @param {Error|string} error - エラーオブジェクトまたはメッセージ
         * @param {string} messageId - メッセージID（オプション）
         * @param {string} sourceWindowId - 送信元のwindowId（オプション）
         * @returns {boolean} 送信成功したか
         */
        respondError(source, responseType, error, messageId = null, sourceWindowId = null) {
            return this.respond(source, responseType, {
                success: false,
                error: error.message || error
            }, messageId, sourceWindowId);
        },

        /**
         * 成功レスポンスヘルパー
         * @param {Window} source - イベントソース
         * @param {string} responseType - レスポンスメッセージタイプ
         * @param {Object} data - レスポンスデータ
         * @param {string} messageId - メッセージID（オプション）
         * @param {string} sourceWindowId - 送信元のwindowId（オプション）
         * @returns {boolean} 送信成功したか
         */
        respondSuccess(source, responseType, data = {}, messageId = null, sourceWindowId = null) {
            return this.respond(source, responseType, {
                success: true,
                ...data
            }, messageId, sourceWindowId);
        },

        /**
         * 安全にレスポンスを送信（event全体から自動抽出）
         * @param {Object} event - メッセージイベント
         * @param {string} responseType - レスポンスタイプ
         * @param {Object} data - レスポンスデータ
         * @returns {boolean} 送信成功したか
         */
        safeRespondTo(event, responseType, data) {
            if (!event || !event.source) {
                logger.warn(`[TADjs] sourceが存在しないためレスポンス送信をスキップ: ${responseType}`);
                return false;
            }

            const messageId = event.data?.messageId;
            return this.respond(event.source, responseType, data, messageId);
        },

        /**
         * 操作成功レスポンスを送信（success: true付き）
         * @param {Object} event - メッセージイベント
         * @param {string} responseType - レスポンスタイプ
         * @param {Object} result - 結果データ
         * @returns {boolean} 送信成功したか
         */
        respondOperationSuccess(event, responseType, result = {}) {
            return this.safeRespondTo(event, responseType, {
                success: true,
                ...result
            });
        },

        /**
         * 操作エラーレスポンスを送信（success: false付き）
         * @param {Object} event - メッセージイベント
         * @param {string} responseType - レスポンスタイプ
         * @param {Error|string} error - エラー
         * @returns {boolean} 送信成功したか
         */
        respondOperationError(event, responseType, error) {
            return this.safeRespondTo(event, responseType, {
                success: false,
                error: error.message || error
            });
        },

        /**
         * 操作情報ログ（操作名付き）
         * @param {string} operation - 操作名
         * @param {string} message - ログメッセージ
         * @param {any} data - 追加データ（オプション）
         */
        logInfo(operation, message, data = null) {
            logger.logOperation(operation, message, data);
        },

        /**
         * 操作エラーログ（操作名付き）
         * @param {string} operation - 操作名
         * @param {Error|string} error - エラー
         * @param {any} context - コンテキスト情報（オプション）
         */
        logError(operation, error, context = null) {
            logger.logOperationError(operation, error, context);
        },

        /**
         * 操作警告ログ（操作名付き）
         * @param {string} operation - 操作名
         * @param {string} message - 警告メッセージ
         * @param {any} data - 追加データ（オプション）
         */
        logWarn(operation, message, data = null) {
            logger.logOperationWarn(operation, message, data);
        },

        /**
         * ウィンドウIDを安全に取得
         * @param {HTMLElement|HTMLIFrameElement|Window} source - ソース要素またはウィンドウ
         * @param {boolean} throwOnMissing - 見つからない場合にエラーをスローするか
         * @returns {string|null} ウィンドウID
         */
        getWindowIdSafely(source, throwOnMissing = false) {
            let windowId = null;

            if (!source) {
                this.logWarn('ウィンドウID取得', 'sourceがnullです');
                if (throwOnMissing) {
                    throw new Error('sourceがnullです');
                }
                return null;
            }

            // HTMLElementでdataset.windowIdを持つ場合
            if (source instanceof HTMLElement && source.dataset?.windowId) {
                windowId = source.dataset.windowId;
            }
            // HTMLIFrameElementの場合
            else if (source instanceof HTMLIFrameElement) {
                windowId = this.parentMessageBus.getWindowIdFromIframe(source);
            }
            // Windowオブジェクトの場合
            else if (source.contentWindow) {
                windowId = this.parentMessageBus.getWindowIdFromSource(source.contentWindow);
            }
            // Windowオブジェクト直接の場合
            else if (typeof source === 'object' && source.postMessage) {
                windowId = this.parentMessageBus.getWindowIdFromSource(source);
            }

            if (!windowId) {
                this.logWarn('ウィンドウID取得', 'windowIdが見つかりませんでした');
                if (throwOnMissing) {
                    throw new Error('windowIdが見つかりませんでした');
                }
            }

            return windowId;
        },

        /**
         * ウィンドウにメッセージを安全に送信
         * @param {string|HTMLElement|HTMLIFrameElement|Window} windowIdOrSource - windowIDまたはソース要素
         * @param {string} messageType - メッセージタイプ
         * @param {Object} data - メッセージデータ
         * @returns {boolean} 送信成功したか
         */
        sendToWindowSafely(windowIdOrSource, messageType, data) {
            const windowId = typeof windowIdOrSource === 'string'
                ? windowIdOrSource
                : this.getWindowIdSafely(windowIdOrSource);

            if (windowId) {
                this.parentMessageBus.sendToWindow(windowId, messageType, data);
                return true;
            }

            this.logWarn('ウィンドウメッセージ送信', `windowIdが取得できず、${messageType}メッセージを送信できませんでした`);
            return false;
        },

        /**
         * RealObjectSystem操作の統一ラッパー
         * @param {MessageEvent} event - メッセージイベント
         * @param {string} operationName - 操作名（ログ用）
         * @param {Function} operation - 実行する操作関数 async (realObjectSystem, data) => result
         * @param {string} successType - 成功時のレスポンスタイプ
         * @param {Object} options - オプション
         * @returns {Promise<any>} 操作結果
         */
        async executeRealObjectOperation(event, operationName, operation, successType, options = {}) {
            const {
                errorType = 'real-object-error',
                requireRealObjectSystem = true,
                postProcess = null
            } = options;

            // realObjectSystemの初期化チェック
            if (requireRealObjectSystem && !this.realObjectSystem) {
                const errorMsg = '実身仮身システムが初期化されていません';
                this.logError(operationName, errorMsg);
                this.respondOperationError(event, errorType, errorMsg);
                return;
            }

            try {
                // 操作実行
                let result = await operation(this.realObjectSystem, event.data);

                // 追加処理（オプション）
                if (postProcess) {
                    result = await postProcess(result, event);
                }

                // 成功レスポンス送信
                this.respondOperationSuccess(event, successType, result);
                this.logInfo(operationName, '完了', result);

                return result;
            } catch (error) {
                // エラーログとレスポンス送信
                this.logError(operationName, error);
                this.respondOperationError(event, errorType, error);
                throw error;
            }
        },

        /**
         * ダイアログ表示とレスポンス統合ヘルパー
         * @param {string} dialogType - ダイアログタイプ ('message', 'input', 'custom')
         * @param {Object} params - ダイアログパラメータ
         * @param {string} responseType - レスポンスメッセージタイプ
         * @param {MessageEvent} event - メッセージイベント
         * @returns {Promise<void>}
         */
        async showDialogAndRespond(dialogType, params, responseType, event) {
            logger.info('[TADjs] showDialogAndRespond called:', {
                dialogType,
                responseType,
                messageId: params.messageId,
                sourceWindowId: params.sourceWindowId,
                hasDialogManager: !!this.dialogManager
            });

            // sourceWindowIdを取得（event.sourceからwindowIdを解決できない場合のフォールバック）
            const sourceWindowId = params.sourceWindowId || null;

            try {
                let result;

                switch (dialogType) {
                    case 'message':
                        result = await this.showMessageDialog(
                            params.message,
                            params.buttons,
                            params.defaultButton || 0
                        );
                        break;
                    case 'input':
                        logger.info('[TADjs] Showing input dialog:', params.message);
                        result = await this.showInputDialog(
                            params.message,
                            params.defaultValue || '',
                            params.inputWidth || 30,
                            params.buttons,
                            params.defaultButton || 0,
                            {
                                colorPicker: params.colorPicker || false,
                                checkbox: params.checkbox || null
                            }
                        );
                        logger.info('[TADjs] Input dialog result:', result);
                        break;
                    case 'custom':
                        logger.info('[TADjs] Custom dialog showing:', { title: params.title, hasHtml: !!params.dialogHtml, buttonCount: params.buttons?.length, width: params.width });
                        result = await this.showCustomDialog(
                            params.dialogHtml,
                            params.buttons,
                            params.defaultButton || 0,
                            { ...(params.inputs || {}), radios: params.radios },
                            { width: params.width, title: params.title }
                        );

                        // カスタムダイアログの特殊処理
                        // selectedItemIndex の抽出（汎用化）
                        let selectedItemIndex = null;
                        if (result.dialogElement) {
                            // .dialog-listbox-item.selected を検索（標準クラス）
                            let selectedElement = result.dialogElement.querySelector('.dialog-listbox-item.selected');

                            // 後方互換性: .font-list-item.selected も検索
                            if (!selectedElement) {
                                selectedElement = result.dialogElement.querySelector('.font-list-item.selected');
                            }

                            if (selectedElement) {
                                selectedItemIndex = parseInt(selectedElement.getAttribute('data-index'));
                            }
                        }

                        // dialogElement は postMessage で送信できないため除外
                        const { dialogElement, ...resultWithoutElement } = result;

                        logger.info('[TADjs] Custom dialog response:', { button: resultWithoutElement.button, hasFormData: !!resultWithoutElement.formData, hasRadios: !!resultWithoutElement.radios, formDataKeys: resultWithoutElement.formData ? Object.keys(resultWithoutElement.formData) : [] });

                        // selectedItemIndex を結果に追加（後方互換性のためselectedFontIndexも維持）
                        this.respondSuccess(event.source, responseType, {
                            result: {
                                ...resultWithoutElement,
                                selectedItemIndex: selectedItemIndex,
                                selectedFontIndex: selectedItemIndex  // 後方互換性
                            }
                        }, params.messageId, sourceWindowId);
                        return; // 早期リターン

                    default:
                        throw new Error(`Unknown dialog type: ${dialogType}`);
                }

                logger.info('[TADjs] Sending dialog response:', {
                    responseType,
                    messageId: params.messageId,
                    sourceWindowId,
                    hasResult: !!result
                });
                this.respondSuccess(event.source, responseType, { result }, params.messageId, sourceWindowId);
                logger.info('[TADjs] Dialog response sent successfully');
            } catch (error) {
                logger.error(`[TADjs] Dialog error (${dialogType}):`, error);
                this.respondError(event.source, responseType, error, params.messageId, sourceWindowId);
            }
        },

        /**
         * ウィンドウIDに基づいてレスポンスを送信
         * @param {string} windowId - 送信先ウィンドウID
         * @param {Object} message - メッセージデータ
         * @returns {boolean} 送信成功したか
         */
        sendResponseToWindowById(windowId, message) {
            logger.debug('[TADjs] sendResponseToWindowById: 開始', windowId, 'messageId:', message.messageId);
            const windowElement = document.querySelector(`.window[data-window-id="${windowId}"]`);
            if (!windowElement) {
                logger.warn('[TADjs] sendResponseToWindowById: ウィンドウが見つかりません:', windowId);
                return false;
            }
            const iframe = windowElement.querySelector('iframe[data-plugin-id]');
            if (!iframe) {
                logger.warn('[TADjs] sendResponseToWindowById: iframe要素が見つかりません:', windowId);
                return false;
            }
            if (!iframe.contentWindow) {
                logger.warn('[TADjs] sendResponseToWindowById: iframe.contentWindowがnull:', windowId, 'iframeId:', iframe.id, 'src:', iframe.src);
                return false;
            }
            try {
                iframe.contentWindow.postMessage(message, '*');
                return true;
            } catch (error) {
                logger.error('[TADjs] sendResponseToWindowById: 送信エラー:', error, 'windowId:', windowId);
                return false;
            }
        }

    });
}
