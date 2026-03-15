/**
 * TADjsDesktop ドロップハンドラーメソッド
 * tadjs-desktop.js から抽出したドラッグ＆ドロップ関連メソッド群
 */

const logger = window.getLogger('TADjs');

/**
 * ドロップハンドラーメソッドを定義するミキシンクラス
 * @private
 */
class DropHandlerMixin {
    /**
     * ファイルのドラッグ&ドロップゾーンを設定
     */
    setupDropZone() {
        // 初期ウインドウ作成後にドロップゾーンを設定
        setTimeout(() => {
            const dropZone = document.getElementById('file-drop-zone');
            const desktop = document.getElementById('desktop');

            if (!dropZone) {
                logger.debug('[TADjs] Drop zone not found - デフォルトウィンドウは仮身一覧プラグインです');
                return;
            }
            
            // より広い範囲でドロップを受け付ける
            const setupDropEvents = (element) => {
                element.addEventListener('dragenter', (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropZone.classList.add('drop-zone-active');
                logger.debug('Drag enter detected');
            });
            
            element.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = 'copy';
                dropZone.classList.add('drop-zone-hover');
                return false;
            });

            element.addEventListener('dragleave', (e) => {
                e.preventDefault();
                e.stopPropagation();
                // 要素の外に出た場合のみクラスを削除
                const rect = element.getBoundingClientRect();
                const x = e.clientX;
                const y = e.clientY;
                
                if (x <= rect.left || x >= rect.right || y <= rect.top || y >= rect.bottom) {
                    dropZone.classList.remove('drop-zone-hover');
                    dropZone.classList.remove('drop-zone-active');
                }
            });

            element.addEventListener('drop', (e) => {
                e.preventDefault();
                if (dropZone) {
                    dropZone.classList.remove('drop-zone-hover');
                    dropZone.classList.remove('drop-zone-active');
                }

                logger.debug('[TADjs] Drop event on element:', element.id, e.dataTransfer);

                // 原紙箱からのドラッグデータをチェック
                const textData = e.dataTransfer.getData('text/plain');
                if (textData) {
                    try {
                        const dragData = JSON.parse(textData);

                        // 仮身ドラッグの場合は、documentのdropハンドラーに処理を委譲
                        if (dragData.type === 'virtual-object-drag') {
                            logger.debug('[TADjs] 仮身ドラッグを検出、documentハンドラーに委譲');
                            return; // stopPropagation()を呼ばずにreturn
                        }

                        if (dragData.type === 'base-file-copy' || dragData.type === 'user-base-file-copy') {
                            logger.debug('[TADjs] 原紙箱からのドロップ:', dragData);
                            e.stopPropagation();
                            this.handleBaseFileDrop(dragData, e);
                            return false;
                        }
                    } catch (_err) {
                        // JSONパースエラー - 通常のテキストとして扱う
                    }
                }

                const files = Array.from(e.dataTransfer.files);
                if (files.length > 0) {
                    logger.debug(`Dropped ${files.length} files:`, files);
                    e.stopPropagation();
                    this.handleFilesDrop(files);
                    return false;
                }

                // URLドロップをチェック（ブラウザからのURLドラッグ）
                const uriList = e.dataTransfer.getData('text/uri-list');
                const plainText = e.dataTransfer.getData('text/plain');

                let droppedUrl = null;
                if (uriList) {
                    const urls = uriList.split('\n')
                        .map(line => line.trim())
                        .filter(line => line && !line.startsWith('#'));
                    if (urls.length > 0) {
                        droppedUrl = urls[0];
                    }
                } else if (plainText && /^https?:\/\/.+/i.test(plainText.trim())) {
                    droppedUrl = plainText.trim();
                }

                if (droppedUrl) {
                    // desktopへのドロップはデフォルト位置（100, 100）を使用
                    this.handleUrlDrop(droppedUrl, null, 100, 100);
                    e.stopPropagation();
                    return false;
                }

                logger.debug('No files or URL in drop event');
                return false;
            });
        };

            // ドロップゾーンとデスクトップ全体でイベントを設定
            setupDropEvents(dropZone);
            setupDropEvents(desktop);
            
            // ドキュメント全体でもドラッグイベントをキャンセル（ブラウザのデフォルト動作を防ぐ）
            // dragenterとdragoverでdropEffectを設定しないと外部からのドロップが受け付けられない
            document.addEventListener('dragenter', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                return false;
            });

            document.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                return false;
            });

            // ドラッグがドキュメント外に出た時にオーバーレイを削除
            document.addEventListener('dragleave', (e) => {
                // ドキュメント外に出たかチェック
                if (e.clientX <= 0 || e.clientY <= 0 ||
                    e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
                    this.removeMediaDropOverlay();
                }
            });

            document.addEventListener('drop', (e) => {
                // ドロップ位置のウィンドウとiframeを取得
                const dropX = e.clientX;
                const dropY = e.clientY;

                // ドロップ位置にあるウィンドウを見つける
                const windows = Array.from(document.querySelectorAll('.window')).reverse(); // z-indexの高い順
                let targetWindow = null;

                for (const win of windows) {
                    const rect = win.getBoundingClientRect();
                    if (dropX >= rect.left && dropX <= rect.right &&
                        dropY >= rect.top && dropY <= rect.bottom) {
                        targetWindow = win;
                        break;
                    }
                }

                // ターゲットウィンドウ内のiframeを取得
                if (targetWindow) {
                    const iframe = targetWindow.querySelector('iframe');
                    if (iframe && iframe.contentWindow) {
                        logger.debug('[TADjs] iframe上でのドロップを検出、iframeにデータを転送:', targetWindow.id);

                        // iframeの座標系に変換（URLドロップでも使用するため先に計算）
                        const iframeRect = iframe.getBoundingClientRect();
                        const iframeX = dropX - iframeRect.left;
                        const iframeY = dropY - iframeRect.top;
                        const windowId = this.parentMessageBus.getWindowIdFromIframe(iframe);

                        // ドロップデータを取得
                        const textData = e.dataTransfer.getData('text/plain');

                        // iframeにpostMessageでドロップイベントを転送
                        if (textData) {
                            try {
                                const dragData = JSON.parse(textData);

                                // 原紙箱からのドロップの場合は handleBaseFileDrop() で処理
                                if (dragData.type === 'base-file-copy' || dragData.type === 'user-base-file-copy') {
                                    // 擬似メッセージイベントを作成（handleBaseFileDropが期待する形式）
                                    const pseudoMessageEvent = {
                                        source: iframe.contentWindow,
                                        data: {
                                            dropPosition: { x: iframeX, y: iframeY },
                                            clientX: iframeX,
                                            clientY: iframeY
                                        }
                                    };
                                    this.handleBaseFileDrop(dragData, pseudoMessageEvent);
                                    e.preventDefault();
                                    return false;
                                }

                                // iframe内のドロップイベントとして転送
                                if (windowId) {
                                    this.parentMessageBus.sendToWindow(windowId, 'parent-drop-event', {
                                        dragData: dragData,
                                        clientX: iframeX,
                                        clientY: iframeY
                                    });
                                } else {
                                    logger.warn('[TADjs] windowIdが見つかりませんでした。ドロップイベントを転送できません。');
                                }

                                logger.debug('[TADjs] iframeにドロップイベントを転送完了');

                                // クロスウィンドウドロップの場合、元のウィンドウに成功メッセージを送信
                                if (dragData.sourceWindowId && dragData.sourceWindowId !== windowId) {
                                    logger.debug('[TADjs] クロスウィンドウドロップ検出: source=', dragData.sourceWindowId, 'target=', windowId);
                                    this.parentMessageBus.sendToWindow(dragData.sourceWindowId, 'cross-window-drop-success', {
                                        targetWindowId: windowId
                                    });
                                    logger.debug('[TADjs] cross-window-drop-successメッセージを送信:', dragData.sourceWindowId);
                                }

                                e.preventDefault();
                                return false;
                            } catch (err) {
                                logger.debug('[TADjs] ドロップデータのJSON解析失敗、URLドロップをチェック');
                            }
                        }

                        // URLドロップをチェック（ブラウザからのURLドラッグ）
                        const uriList = e.dataTransfer.getData('text/uri-list');
                        const plainText = e.dataTransfer.getData('text/plain');

                        // URLを抽出（text/uri-listを優先）
                        let droppedUrl = null;
                        if (uriList) {
                            // text/uri-listは改行区切り、#で始まる行はコメント
                            const urls = uriList.split('\n')
                                .map(line => line.trim())
                                .filter(line => line && !line.startsWith('#'));
                            if (urls.length > 0) {
                                droppedUrl = urls[0]; // 最初のURLを使用
                            }
                        } else if (plainText && /^https?:\/\/.+/i.test(plainText.trim())) {
                            droppedUrl = plainText.trim();
                        }

                        if (droppedUrl) {
                            logger.debug('[TADjs] URLドロップ検出:', droppedUrl);
                            this.handleUrlDrop(droppedUrl, iframe, iframeX, iframeY);
                            e.preventDefault();
                            return false;
                        }

                        // 外部ファイルドロップをチェック（Windowsからのドラッグなど）
                        const files = Array.from(e.dataTransfer.files);
                        if (files.length > 0) {
                            logger.debug('[TADjs] 外部ファイルドロップ検出:', files.length, '個のファイル');

                            // プラグインIDを取得（parentMessageBus.childrenから取得）
                            const childInfo = windowId ? this.parentMessageBus?.children?.get(windowId) : null;
                            const pluginId = childInfo ? childInfo.pluginId : null;
                            logger.debug('[TADjs] ドロップ先プラグイン:', pluginId);

                            // basic-playerプラグインの場合はメディアファイル専用処理
                            if (pluginId === 'basic-player') {
                                this.handleMediaFilesDropToPlayer(files, windowId, windowInfo).then(() => {
                                    logger.debug('[TADjs] メディアファイルドロップ処理完了');
                                }).catch(err => {
                                    logger.error('[TADjs] メディアファイルドロップエラー:', err);
                                });
                            } else if (this.fileImportManager) {
                                // FileImportManagerを使用してファイルを処理
                                this.fileImportManager.handleFilesImport(files, iframe).then(() => {
                                    logger.debug('[TADjs] 外部ファイルインポート完了');
                                }).catch(err => {
                                    logger.error('[TADjs] 外部ファイルインポートエラー:', err);
                                });
                            }

                            e.preventDefault();
                            return false;
                        }
                    }
                }

                // iframe以外、またはJSON解析失敗の場合はデフォルト動作を防ぐ
                e.preventDefault();
                return false;
            });
        }, window.UI_UPDATE_DELAY_MS); // 100ms後に実行
    }

    
    /**
     * ドロップされたファイルを処理
     * @param {FileList} files - ドロップされたファイルリスト
     */
    async handleFilesDrop(files) {
        // FileImportManagerに処理を委譲
        await this.fileImportManager.handleFilesDrop(files);
    }

    /**
     * 原紙箱からドロップされた原紙ファイルを処理
     * @param {Object} dragData - ドラッグデータ
     * @param {MessageEvent} messageEvent - メッセージイベント（e.sourceとe.dataを含む）
     */
    async handleBaseFileDrop(dragData, messageEvent) {
        logger.debug('[TADjs] handleBaseFileDrop開始:', dragData);

        // 原紙箱からのドロップでない場合は処理しない
        if (dragData.type !== 'base-file-copy' && dragData.type !== 'user-base-file-copy') {
            logger.debug('[TADjs] handleBaseFileDrop: 原紙箱からのドロップではないためスキップ');
            return;
        }

        // ドロップ元のiframeを取得
        const dropTargetWindow = messageEvent ? messageEvent.source : null;
        // dropPositionがメッセージに含まれている場合はそれを使用、なければclientX/Yから作成
        const dropPosition = messageEvent && messageEvent.data
            ? (messageEvent.data.dropPosition || { x: messageEvent.data.clientX, y: messageEvent.data.clientY })
            : null;
        // targetCellがメッセージに含まれている場合はそれを使用（表計算プラグイン用）
        const targetCell = messageEvent && messageEvent.data ? messageEvent.data.targetCell : null;
        logger.debug('[TADjs] ドロップ先ウィンドウ:', dropTargetWindow ? 'あり' : 'なし', 'ドロップ位置:', dropPosition, 'ターゲットセル:', targetCell);

        // ユーザ原紙の場合は実身を複製して新規作成（システム原紙と同様）
        if (dragData.type === 'user-base-file-copy') {
            const baseFile = dragData.baseFile;
            const sourceRealId = baseFile.realId;
            const displayName = baseFile.displayName;

            // 実身名を入力するダイアログを表示
            const result = await this.showInputDialog(
                '新しい実身の名称を入力してください',
                displayName,
                30,
                [
                    { label: '取消', value: 'cancel' },
                    { label: '設定', value: 'ok' }
                ],
                1 // デフォルトは「設定」ボタン
            );

            logger.debug('[TADjs] ユーザ原紙ダイアログ結果:', result);

            // 取消の場合は何もしない
            if (result.button === 'cancel' || !result.value) {
                logger.debug('[TADjs] ユーザ原紙作成キャンセル');
                return;
            }

            const newName = result.value;
            logger.debug('[TADjs] ユーザ原紙から新しい実身名:', newName);

            // 元の実身を読み込む
            if (!this.realObjectSystem) {
                logger.error('[TADjs] RealObjectSystemが初期化されていません');
                this.setStatusMessage('実身システムが初期化されていません');
                return;
            }

            let sourceRealObject;
            try {
                sourceRealObject = await this.realObjectSystem.loadRealObject(sourceRealId);
                logger.debug('[TADjs] 元の実身読み込み完了:', sourceRealId);
            } catch (error) {
                logger.error('[TADjs] 元の実身読み込みエラー:', error);
                this.setStatusMessage('元の実身の読み込みに失敗しました');
                return;
            }

            // 新しい実身IDを生成
            const newRealId = typeof generateUUIDv7 === 'function' ? generateUUIDv7() : this.generateRealFileIdSet(1).fileId;
            logger.debug('[TADjs] ユーザ原紙から新しい実身ID:', newRealId);

            // 新しいメタデータを作成
            const currentDateTime = new Date().toISOString();
            const newMetadata = {
                ...sourceRealObject.metadata,
                realId: newRealId,
                name: newName,
                makeDate: currentDateTime,
                updateDate: currentDateTime,
                accessDate: currentDateTime,
                refCount: 1,
                maker: this.currentUser || 'TRON User'
            };

            // XTADレコードをコピー（filename属性を更新）
            const newRecords = sourceRealObject.records.map(record => {
                let newXtad = record.xtad;
                if (newXtad) {
                    newXtad = newXtad.replace(/filename="[^"]*"/, `filename="${newName}"`);
                }
                return { xtad: newXtad, images: record.images || [] };
            });

            // RealObjectSystemに保存
            try {
                await this.realObjectSystem.saveRealObject(newRealId, {
                    metadata: newMetadata,
                    records: newRecords
                });
                logger.debug('[TADjs] 新しい実身をRealObjectSystemに保存:', newRealId);
            } catch (error) {
                logger.error('[TADjs] 実身保存エラー:', error);
                this.setStatusMessage('実身の保存に失敗しました');
                return;
            }

            // JSONファイルも保存
            const jsonFileName = window.RealObjectSystem.getRealObjectJsonFileName(newRealId);
            const jsonSaved = await this.saveDataFile(jsonFileName, JSON.stringify(newMetadata, null, 2));
            if (jsonSaved) {
                logger.debug('[TADjs] JSONファイル保存成功:', jsonFileName);
            } else {
                logger.warn('[TADjs] JSONファイル保存失敗:', jsonFileName);
            }

            // アイコンファイルをコピー（存在する場合）
            if (this.isElectronEnv) {
                try {
                    const basePath = this.realObjectSystem.getDataBasePath();
                    const fs = require('fs');
                    const path = require('path');
                    const sourceIcoPath = path.join(basePath, `${sourceRealId}.ico`);
                    const newIcoPath = path.join(basePath, `${newRealId}.ico`);

                    if (fs.existsSync(sourceIcoPath)) {
                        fs.copyFileSync(sourceIcoPath, newIcoPath);
                        logger.debug('[TADjs] アイコンファイルコピー成功:', sourceRealId, '->', newRealId);
                    } else {
                        logger.debug('[TADjs] 元のアイコンファイルが存在しません:', sourceIcoPath);
                    }
                } catch (error) {
                    logger.warn('[TADjs] アイコンファイルコピーエラー:', error.message);
                }

                // PNG画像ファイルをコピー（ピクセルマップ用、存在する場合）
                try {
                    const basePath = this.realObjectSystem.getDataBasePath();
                    const fs = require('fs');
                    const path = require('path');
                    const files = fs.readdirSync(basePath);
                    const pngPattern = new RegExp(`^${sourceRealId.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}_\\d+_\\d+\\.png$`);

                    for (const file of files) {
                        if (pngPattern.test(file)) {
                            const sourcePngPath = path.join(basePath, file);
                            const newPngFile = file.replace(sourceRealId, newRealId);
                            const newPngPath = path.join(basePath, newPngFile);

                            try {
                                fs.copyFileSync(sourcePngPath, newPngPath);
                                logger.debug('[TADjs] PNGファイルコピー成功:', file, '->', newPngFile);
                            } catch (error) {
                                logger.warn('[TADjs] PNGファイルコピーエラー:', file, error.message);
                            }
                        }
                    }
                } catch (error) {
                    logger.warn('[TADjs] PNG検索エラー:', error.message);
                }

                // 追加レコード情報ファイルをコピー（_N_M.json形式、存在する場合）
                try {
                    const basePath = this.realObjectSystem.getDataBasePath();
                    const fs = require('fs');
                    const path = require('path');
                    const files = fs.readdirSync(basePath);
                    const jsonPattern = new RegExp(`^${sourceRealId.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}_\\d+_\\d+\\.json$`);

                    for (const file of files) {
                        if (jsonPattern.test(file)) {
                            const sourceJsonPath = path.join(basePath, file);
                            const newJsonFile = file.replace(sourceRealId, newRealId);
                            const newJsonPath = path.join(basePath, newJsonFile);

                            try {
                                fs.copyFileSync(sourceJsonPath, newJsonPath);
                                logger.debug('[TADjs] 追加レコードJSONコピー成功:', file, '->', newJsonFile);
                            } catch (error) {
                                logger.warn('[TADjs] 追加レコードJSONコピーエラー:', file, error.message);
                            }
                        }
                    }
                } catch (error) {
                    logger.warn('[TADjs] 追加レコードJSON検索エラー:', error.message);
                }
            }

            logger.debug('[TADjs] ユーザ原紙から新しい実身を作成しました:', newRealId, newName);

            // ドロップ先のウィンドウに仮身を追加
            if (dropTargetWindow) {
                const windowId = this.parentMessageBus.getWindowIdFromSource(dropTargetWindow);
                if (windowId) {
                    this.parentMessageBus.sendToWindow(windowId, 'add-virtual-object-from-base', {
                        realId: newRealId,
                        name: newName,
                        dropPosition: dropPosition,
                        targetCell: targetCell,
                        applist: newMetadata.applist || {},
                        linkAttributes: baseFile.linkAttributes || null  // 仮身属性を追加
                    });
                    logger.debug('[TADjs] ユーザ原紙からドロップ先に仮身を追加:', newRealId, newName, dropPosition, 'targetCell:', targetCell);
                } else {
                    logger.warn('[TADjs] windowIdが見つかりませんでした。仮身を追加できません。');
                }
            } else {
                logger.warn('[TADjs] ドロップ先ウィンドウが不明です');
            }

            this.setStatusMessage(`実身「${newName}」を作成しました`);
            return;
        }

        // システム原紙の場合は新規実身を作成

        // 実身名を入力するダイアログを表示
        const result = await this.showInputDialog(
            '新しい実身の名称を入力してください',
            dragData.baseFile.displayName,
            30,
            [
                { label: '取消', value: 'cancel' },
                { label: '設定', value: 'ok' }
            ],
            1 // デフォルトは「設定」ボタン
        );

        logger.debug('[TADjs] ダイアログ結果:', result);

        // 取消の場合は何もしない
        if (result.button === 'cancel' || !result.value) {
            logger.debug('[TADjs] キャンセルされました');
            return;
        }

        const newName = result.value;
        logger.debug('[TADjs] 新しい実身名:', newName);

        // 新しい実身IDを生成（tad.jsのgenerateUUIDv7を使用）
        const newRealId = typeof generateUUIDv7 === 'function' ? generateUUIDv7() : this.generateRealFileIdSet(1).fileId;
        logger.debug('[TADjs] 新しい実身ID:', newRealId);

        // basefileの情報を取得
        const baseFile = dragData.baseFile;
        const pluginId = baseFile.pluginId;

        // basefileのJSONとXTADを読み込む
        let basefileJson = null;
        let basefileXtad = null;
        let basefileJsonName = null;  // basefileのJSONファイル名を保存
        let basefileIcoName = null;   // basefileのICOファイル名を保存

        try {
            // JSONファイルのパスを構築
            if (typeof baseFile.basefile === 'object') {
                basefileJsonName = baseFile.basefile.json;
                basefileIcoName = baseFile.basefile.ico;  // icoファイル名を取得
            } else {
                // basefileが文字列の場合、_0.xtadを削除して.jsonを追加
                // 例: "0199eb7d-6e78-79fb-fe14-1865d0a23d0f_0.xtad" -> "0199eb7d-6e78-79fb-fe14-1865d0a23d0f.json"
                basefileJsonName = baseFile.basefile.replace(/_\d+\.xtad$/i, '.json');
                basefileIcoName = baseFile.basefile.replace(/_\d+\.xtad$/i, '.ico');  // icoファイル名も推測
            }
            const jsonPath = `plugins/${pluginId}/${basefileJsonName}`;

            // JSONファイルを読み込む（ネットワークエラー時はフォールバック）
            try {
                const jsonResponse = await fetch(jsonPath);
                if (jsonResponse.ok) {
                    basefileJson = await jsonResponse.json();
                    logger.debug('[TADjs] basefile JSON読み込み完了:', basefileJson);
                } else {
                    // JSONがない場合は空のオブジェクトを作成
                    basefileJson = {
                        name: newName,
                        applist: []
                    };
                    logger.debug('[TADjs] basefile JSONがないため、新規作成');
                }
            } catch (fetchError) {
                // ネットワークエラー時のフォールバック
                logger.warn('[TADjs] basefile JSON読み込みエラー、フォールバック使用:', fetchError);
                basefileJson = {
                    name: newName,
                    applist: []
                };
            }

            // XTADファイルのパスを構築
            const xtadFileName = typeof baseFile.basefile === 'object'
                ? baseFile.basefile.xmltad
                : baseFile.basefile;
            const xtadPath = `plugins/${pluginId}/${xtadFileName}`;

            // XTADファイルを読み込む
            const xtadResponse = await fetch(xtadPath);
            if (xtadResponse.ok) {
                basefileXtad = await xtadResponse.text();
                logger.debug('[TADjs] basefile XTAD読み込み完了');
            } else {
                logger.error('[TADjs] basefile XTAD読み込み失敗');
                return;
            }

        } catch (error) {
            logger.error('[TADjs] basefile読み込みエラー:', error);
            return;
        }

        // 新しい実身のJSONを作成（nameとrefCountを更新）
        const currentDateTime = new Date().toISOString();
        const newRealJson = {
            ...basefileJson,
            name: newName,
            makeDate: currentDateTime,     // 作成日時
            updateDate: currentDateTime,   // 更新日時
            accessDate: currentDateTime,   // アクセス日時
            refCount: 1,  // 新規作成時は1
            maker: this.currentUser || 'TRON User'  // 使用者名を設定
        };

        // 新しい実身のXTADを作成（filename属性を更新）
        const newRealXtad = basefileXtad.replace(
            /filename="[^"]*"/,
            `filename="${newName}"`
        );

        // RealObjectSystemに実身を登録（ファイルに直接保存）
        if (this.realObjectSystem) {
            try {
                const metadata = {
                    realId: newRealId,
                    name: newName,
                    recordCount: basefileJson.recordCount || 1,
                    refCount: 1,  // 新規作成時は1
                    createdAt: new Date().toISOString(),
                    modifiedAt: new Date().toISOString()
                };

                const realObject = {
                    metadata: metadata,
                    records: [{ xtad: newRealXtad, images: [] }]
                };

                await this.realObjectSystem.saveRealObject(newRealId, realObject);

                logger.debug('[TADjs] 実身をファイルに保存:', newRealId, newName);
            } catch (error) {
                logger.error('[TADjs] 実身保存エラー:', error);
            }
        }

        // Electron環境の場合のファイル保存は既にrealObjectSystemが行っているので不要
        const jsonFileName = window.RealObjectSystem.getRealObjectJsonFileName(newRealId);
        const xtadFileName = `${newRealId}_0.xtad`;

        const jsonSaved = await this.saveDataFile(jsonFileName, JSON.stringify(newRealJson, null, 2));
        const xtadSaved = await this.saveDataFile(xtadFileName, newRealXtad);

        if (jsonSaved && xtadSaved) {
            logger.debug('[TADjs] 新しい実身をファイルシステムに保存しました:', jsonFileName, xtadFileName);
        } else {
            logger.warn('[TADjs] ファイルシステムへの保存に失敗しました');
        }

        // アイコンファイル（.ico）をコピー
        if (this.isElectronEnv) {
            try {
                // basefileIcoNameが指定されている場合のみコピー
                if (basefileIcoName) {
                    const baseIconPath = `plugins/${pluginId}/${basefileIcoName}`;

                    // アイコンファイルが存在するかチェック
                    const iconResponse = await fetch(baseIconPath);
                    if (iconResponse.ok) {
                        const iconData = await iconResponse.arrayBuffer();
                        const newIconFileName = `${newRealId}.ico`;
                        const iconSaved = await this.saveDataFile(newIconFileName, iconData);
                        if (iconSaved) {
                            logger.debug('[TADjs] アイコンファイルをコピーしました:', baseIconPath, '->', newIconFileName);
                        } else {
                            logger.warn('[TADjs] アイコンファイルのコピーに失敗しました:', newIconFileName);
                        }
                    } else {
                        logger.debug('[TADjs] basefileにアイコンファイルが存在しません:', baseIconPath);
                    }
                } else {
                    logger.debug('[TADjs] basefileにicoファイルが指定されていません');
                }
            } catch (error) {
                logger.warn('[TADjs] アイコンファイルコピー中のエラー:', error.message);
            }
        }

        // 追加レコード情報ファイルをコピー（_N_M.json形式、recordCountに基づく）
        if (this.isElectronEnv && basefileJson.recordCount > 1) {
            try {
                const fs = require('fs');
                const path = require('path');
                const baseRealId = basefileJsonName.replace('.json', '');
                const pluginDir = path.join(this._programBasePath, 'plugins', pluginId);
                const files = fs.readdirSync(pluginDir);
                const jsonPattern = new RegExp(`^${baseRealId.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}_\\d+_\\d+\\.json$`);
                for (const file of files) {
                    if (jsonPattern.test(file)) {
                        const srcPath = path.join(pluginDir, file);
                        const content = fs.readFileSync(srcPath, 'utf-8');
                        const newFileName = file.replace(baseRealId, newRealId);
                        const saved = await this.saveDataFile(newFileName, content);
                        if (saved) {
                            logger.debug('[TADjs] 追加レコードファイルをコピー:', file, '->', newFileName);
                        }
                    }
                }
            } catch (error) {
                logger.warn('[TADjs] 追加レコードファイルのコピー中にエラー:', error.message);
            }
        }

        logger.debug('[TADjs] 新しい実身を保存しました:', newRealId, newName);

        // ドロップ先のウィンドウに仮身を追加
        if (dropTargetWindow) {
            const windowId = this.parentMessageBus.getWindowIdFromSource(dropTargetWindow);
            if (windowId) {
                this.parentMessageBus.sendToWindow(windowId, 'add-virtual-object-from-base', {
                    realId: newRealId,
                    name: newName,
                    dropPosition: dropPosition,
                    targetCell: targetCell,
                    applist: newRealJson.applist || {}
                });
                logger.debug('[TADjs] ドロップ先に仮身を追加:', newRealId, newName, dropPosition, 'targetCell:', targetCell, 'applist:', newRealJson.applist);
            } else {
                logger.warn('[TADjs] windowIdが見つかりませんでした。仮身を追加できません。');
            }
        } else {
            logger.warn('[TADjs] ドロップ先ウィンドウが不明です');
        }

        this.setStatusMessage(`実身「${newName}」を作成しました`);
    }

    /**
     * URLドロップを処理
     * URL原紙を使って新規実身を作成し、ドロップ先に仮身を追加
     * @param {string} url - ドロップされたURL
     * @param {HTMLIFrameElement} targetIframe - ドロップ先のiframe
     * @param {number} dropX - ドロップ位置X（iframe内座標）
     * @param {number} dropY - ドロップ位置Y（iframe内座標）
     */
    async handleUrlDrop(url, targetIframe, dropX, dropY) {
        logger.debug('[TADjs] handleUrlDrop開始:', url);

        // URLからデフォルトの実身名を生成（ホスト名を使用）
        let defaultName = 'URL仮身';
        try {
            const urlObj = new URL(url);
            defaultName = urlObj.hostname || 'URL仮身';
        } catch (e) {
            // URL解析エラーの場合はデフォルト名を使用
        }

        // 実身名を入力するダイアログを表示
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

        if (result.button === 'cancel' || !result.value) {
            logger.debug('[TADjs] URLドロップキャンセル');
            return;
        }

        const newName = result.value;
        logger.debug('[TADjs] URL実身名:', newName);

        // 新しい実身IDを生成
        const newRealId = typeof generateUUIDv7 === 'function'
            ? generateUUIDv7()
            : this.generateRealFileIdSet(1).fileId;
        logger.debug('[TADjs] URL実身ID:', newRealId);

        // xtadを生成（URLを段落で囲む）
        const xtadContent = `<tad version="1.0" encoding="UTF-8" filename="${newName}">
<document>
<p>
${url}
</p>
</document>
</tad>
`;

        // メタデータを生成（URL原紙のapplistを使用）
        const currentDateTime = new Date().toISOString();
        const newMetadata = {
            name: newName,
            relationship: [],
            linktype: false,
            makeDate: currentDateTime,
            updateDate: currentDateTime,
            accessDate: currentDateTime,
            periodDate: null,
            refCount: 1,
            recordCount: 1,
            editable: true,
            deletable: true,
            readable: true,
            maker: this.currentUser || 'TRON User',
            window: {
                pos: { x: 100, y: 100 },
                width: 400,
                height: 200,
                minWidth: 200,
                minHeight: 200,
                resizable: true,
                scrollable: true
            },
            applist: {
                'url-link-exec': { name: 'URL仮身', defaultOpen: true },
                'basic-text-editor': { name: '基本文章編集', defaultOpen: false }
            }
        };

        // RealObjectSystemに保存
        try {
            await this.realObjectSystem.saveRealObject(newRealId, {
                metadata: newMetadata,
                records: [{ xtad: xtadContent, images: [] }]
            });
            logger.debug('[TADjs] URL実身保存完了:', newRealId);
        } catch (error) {
            logger.error('[TADjs] URL実身保存エラー:', error);
            this.setStatusMessage('URL実身の保存に失敗しました');
            return;
        }

        // JSONファイルも保存
        const jsonFileName = window.RealObjectSystem.getRealObjectJsonFileName(newRealId);
        await this.saveDataFile(jsonFileName, JSON.stringify(newMetadata, null, 2));

        // XTADファイルも保存
        const xtadFileName = `${newRealId}_0.xtad`;
        await this.saveDataFile(xtadFileName, xtadContent);

        // アイコンファイルをコピー（URL原紙のアイコン）
        const URL_BASE_FILE_REAL_ID = '019a4a5c-8888-4b8a-9d3c-1f6e8a9b2c4d';
        if (this.isElectronEnv) {
            try {
                const basePath = this.realObjectSystem.getDataBasePath();
                const fs = require('fs');
                const path = require('path');
                const sourceIcoPath = path.join(basePath, `${URL_BASE_FILE_REAL_ID}.ico`);
                const newIcoPath = path.join(basePath, `${newRealId}.ico`);

                if (fs.existsSync(sourceIcoPath)) {
                    fs.copyFileSync(sourceIcoPath, newIcoPath);
                    logger.debug('[TADjs] URLアイコンコピー成功');
                } else {
                    // プラグインディレクトリからアイコンをコピー
                    const pluginIcoPath = path.join(__dirname, 'plugins', 'url-link-exec', `${URL_BASE_FILE_REAL_ID}.ico`);
                    if (fs.existsSync(pluginIcoPath)) {
                        fs.copyFileSync(pluginIcoPath, newIcoPath);
                        logger.debug('[TADjs] URLアイコン（プラグインから）コピー成功');
                    }
                }
            } catch (error) {
                logger.warn('[TADjs] URLアイコンコピーエラー:', error.message);
            }
        }

        // ドロップ先のウィンドウに仮身を追加
        if (targetIframe && targetIframe.contentWindow) {
            const windowId = this.parentMessageBus.getWindowIdFromIframe(targetIframe);
            if (windowId) {
                this.parentMessageBus.sendToWindow(windowId, 'add-virtual-object-from-base', {
                    realId: newRealId,
                    name: newName,
                    dropPosition: { x: dropX, y: dropY },
                    applist: newMetadata.applist
                });
                logger.debug('[TADjs] URL仮身追加:', newRealId, newName);
            } else {
                logger.warn('[TADjs] windowIdが見つかりませんでした。URL仮身を追加できません。');
            }
        } else {
            logger.warn('[TADjs] ドロップ先iframeが不明です');
        }

        this.setStatusMessage(`URL実身「${newName}」を作成しました`);
    }

    /**
     * 屑実身操作からドロップされた実身を復元
     * @param {Object} dragData - ドラッグデータ
     * @param {MessageEvent} messageEvent - メッセージイベント
     */
    async handleTrashRealObjectDrop(dragData, messageEvent) {
        logger.debug('[TADjs] handleTrashRealObjectDrop開始:', dragData);

        // 屑実身操作からのドロップでない場合は処理しない
        if (dragData.type !== 'trash-real-object-restore') {
            logger.debug('[TADjs] handleTrashRealObjectDrop: 屑実身操作からのドロップではないためスキップ');
            return;
        }

        // ドロップ元のiframeを取得
        const dropTargetWindow = messageEvent ? messageEvent.source : null;
        const dropPosition = messageEvent && messageEvent.data
            ? (messageEvent.data.dropPosition || { x: messageEvent.data.clientX, y: messageEvent.data.clientY })
            : null;
        logger.debug('[TADjs] ドロップ先ウィンドウ:', dropTargetWindow ? 'あり' : 'なし', 'ドロップ位置:', dropPosition);

        const realObject = dragData.realObject;
        const realId = realObject.realId;
        const name = realObject.name;

        logger.debug('[TADjs] 屑実身を復元:', realId, name);

        // RealObjectSystemから実身を読み込む
        if (!this.realObjectSystem) {
            logger.error('[TADjs] RealObjectSystemが初期化されていません');
            return;
        }

        try {
            // 実身を読み込む
            const loadedRealObject = await this.realObjectSystem.loadRealObject(realId);
            logger.debug('[TADjs] 実身読み込み完了:', realId);

            // 参照カウントを増やす
            const currentRefCount = loadedRealObject.metadata.refCount || 0;
            const newRefCount = currentRefCount + 1;

            // メタデータを更新
            const jsonFileName = window.RealObjectSystem.getRealObjectJsonFileName(realId);
            const metadata = loadedRealObject.metadata;
            metadata.refCount = newRefCount;
            metadata.accessDate = new Date().toISOString();

            // ファイルに保存
            await this.saveDataFile(jsonFileName, JSON.stringify(metadata, null, 2));
            logger.debug('[TADjs] 参照カウント更新:', realId, currentRefCount, '->', newRefCount);

            // ドロップ先のウィンドウに仮身を追加
            if (dropTargetWindow) {
                const windowId = this.parentMessageBus.getWindowIdFromSource(dropTargetWindow);
                if (windowId) {
                    this.parentMessageBus.sendToWindow(windowId, 'add-virtual-object-from-trash', {
                        realId: realId,
                        name: name,
                        dropPosition: dropPosition,
                        applist: metadata.applist || {}
                    });
                    logger.debug('[TADjs] ドロップ先に仮身を追加:', realId, name, dropPosition);
                } else {
                    logger.warn('[TADjs] windowIdが見つかりませんでした。仮身を追加できません。');
                }
            } else {
                logger.warn('[TADjs] ドロップ先ウィンドウが不明です');
            }

            this.setStatusMessage(`実身「${name}」を復元しました`);
        } catch (error) {
            logger.error('[TADjs] 屑実身復元エラー:', error);
            this.setStatusMessage(`実身「${name}」の復元に失敗しました`);
        }
    }

    /**
     * クロスウィンドウドロップ進行中を元のウィンドウに即座通知（dragendより前）
     * @param {Object} data - ドロップデータ
     */
    notifySourceWindowOfCrossWindowDropInProgress(data) {
        logger.debug('[TADjs] クロスウィンドウドロップ進行中通知:', data.sourceWindowId);

        // 特定のウィンドウ（sourceWindowId）だけに即座通知
        this.parentMessageBus.sendToWindow(data.sourceWindowId, 'cross-window-drop-in-progress', {
            targetWindowId: data.targetWindowId
        });
    }

    /**
     * クロスウィンドウドロップ成功を元のウィンドウに通知
     * @param {Object} data - ドロップデータ
     */
    notifySourceWindowOfCrossWindowDrop(data) {
        logger.debug('[TADjs] クロスウィンドウドロップ通知:', data.sourceWindowId);

        // 特定のウィンドウ（sourceWindowId）だけに通知
        this.parentMessageBus.sendToWindow(data.sourceWindowId, 'cross-window-drop-success', {
            mode: data.mode,
            source: data.source,
            sourceWindowId: data.sourceWindowId,
            targetWindowId: data.targetWindowId,
            virtualObjects: data.virtualObjects
        });
    }
}

/**
 * TADjsDesktopクラスにドロップハンドラーメソッドを追加
 * @param {Function} TADjsDesktop - TADjsDesktopクラス
 */
export function applyDropHandlerMethods(TADjsDesktop) {
    const mixinProto = DropHandlerMixin.prototype;
    for (const name of Object.getOwnPropertyNames(mixinProto)) {
        if (name !== 'constructor') {
            TADjsDesktop.prototype[name] = mixinProto[name];
        }
    }
}
