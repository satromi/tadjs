/**
 * TADjsDesktop 実身操作・データ保存メソッド
 * tadjs-desktop.js から抽出した実身CRUD操作、TADデータ保存、ファイル操作関連メソッド群
 */

const logger = window.getLogger('TADjs');

/**
 * 実身操作メソッドを定義するミキシンクラス
 * @private
 */
class RealObjectOpsMixin {
    /**
     * TADデータをcanvasに保存
     * @param {HTMLCanvasElement} canvas - 保存先のcanvas要素
     * @param {Object} tadData - TADデータオブジェクト
     * @param {string} canvasId - canvas要素のID
     */
    saveTadDataToCanvas(canvas, tadData, canvasId) {
        const { linkRecordList, tadRecordDataArray, currentFileIndex } = tadData;
        
        // canvasIdに対応するウィンドウのoriginalLinkIdを取得
        let originalLinkId = null;
        for (const [windowId, windowInfo] of this.windows) {
            //     canvasId: windowInfo.canvasId,
            //     originalLinkId: windowInfo.originalLinkId,
            //     matches: windowInfo.canvasId === canvasId
            // });
            if (windowInfo.canvasId === canvasId) {
                originalLinkId = windowInfo.originalLinkId;
                break;
            }
        }
        
        // グローバル変数からも確認
        const globalOriginalLinkId = window.originalLinkId;

        // グローバル変数を優先（tad.jsで設定された値を使用）
        if (globalOriginalLinkId !== null && globalOriginalLinkId !== undefined) {
            originalLinkId = globalOriginalLinkId;
        }
        
        //     canvasId,
        //     originalLinkId,
        //     currentFileIndex,
        //     linkRecordListLength: linkRecordList ? linkRecordList.length : 0,
        //     tadRecordDataArrayLength: tadRecordDataArray ? tadRecordDataArray.length : 0
        // });
        
        
        // linkRecordListから該当link_idのリンクを取得
        let virtualLinks = [];
        
        if (originalLinkId !== null && originalLinkId !== undefined) {
            // セカンダリウィンドウの場合：link_id - 1のインデックスを使用
            const linkIndex = parseInt(originalLinkId) - 1;

            if (linkRecordList && linkRecordList[linkIndex] && Array.isArray(linkRecordList[linkIndex])) {
                virtualLinks = [...linkRecordList[linkIndex]];
            } else {
                // console.warn(`linkRecordList[${linkIndex}] not found for link_id ${originalLinkId}`);
            }
        } else {
            // メインウィンドウの場合：最初のファイルのリンクレコード

            if (linkRecordList && linkRecordList[0] && Array.isArray(linkRecordList[0])) {
                virtualLinks = [...linkRecordList[0]];
            } else {
                // console.warn('linkRecordList[0] not found');
            }
        }


        // canvasにデータを保存
        canvas.virtualObjectLinks = virtualLinks;
        canvas.tadRecordDataArray = tadRecordDataArray ? [...tadRecordDataArray] : [];
        
        
        // 仮身オブジェクトのイベントを設定
        this.setupVirtualObjectEvents(canvas);

        this.setStatusMessage('TADファイルの描画が完了しました（コールバック経由）');
    }

    /**
     * 実身ファイルIDセットを生成
     * BTRONの実身/仮身モデルに従ったファイル名を生成
     * @param {number} recordCount - レコード数（デフォルト: 1）
     * @returns {Object} ファイルIDセット
     * {
     *   fileId: string,              // UUID v7
     *   jsonFile: string,            // fileid.json
     *   xtadFiles: string[]          // fileid_recordno.xtad の配列
     * }
     */
    generateRealFileIdSet(recordCount = 1) {
        // uuid-v7.jsのgenerateUUIDv7()を使用してファイルIDを生成
        const fileId = generateUUIDv7();

        // JSONファイル名: fileid.json
        const jsonFile = `${fileId}.json`;

        // XTADファイル名の配列: fileid_recordno.xtad
        const xtadFiles = [];
        for (let i = 0; i < recordCount; i++) {
            xtadFiles.push(`${fileId}_${i}.xtad`);
        }

        const fileIdSet = {
            fileId: fileId,
            jsonFile: jsonFile,
            xtadFiles: xtadFiles
        };

        logger.info('[TADjs] 実身ファイルIDセットを生成:', fileIdSet);
        return fileIdSet;
    }

    /**
     * xmlTADをXTADファイルに保存（ブラウザ環境ではダウンロード）
     * @param {string} fileId - ファイルID
     * @param {string} xmlData - 保存するxmlTAD文字列
     */
    async saveXmlDataToFile(fileId, xmlData) {
        try {
            logger.info('[TADjs] xmlTADをファイルに保存開始:', fileId);

            // fileIdから拡張子を除去（既に_0.xtadが含まれている場合に対応）
            let baseFileId = fileId;
            if (baseFileId.endsWith('_0.xtad')) {
                baseFileId = baseFileId.substring(0, baseFileId.length - 7); // '_0.xtad'を除去
            } else if (baseFileId.endsWith('.xtad')) {
                baseFileId = baseFileId.substring(0, baseFileId.length - 5); // '.xtad'を除去
            }

            // ファイル名を構築（recordno 0のXTADファイル）
            const filename = `${baseFileId}_0.xtad`;

            // Electron環境の場合、ファイルシステムに保存
            if (this.isElectronEnv) {
                const saved = await this.saveDataFile(filename, xmlData);
                if (saved) {
                    logger.info('[TADjs] xmlTADファイル保存成功:', filename);

                    // キャッシュをクリアして次回は新しいファイルを読み込む
                    delete this.fileObjects[filename];
                    logger.info('[TADjs] ファイルキャッシュをクリア:', filename);

                    // JSONファイルのupdateDateを更新
                    const jsonFileName = `${baseFileId}.json`;
                    const jsonResult = await this.loadDataFile(this.getDataBasePath(), jsonFileName);
                    if (jsonResult.success && jsonResult.data) {
                        const jsonData = JSON.parse(jsonResult.data);
                        jsonData.updateDate = new Date().toISOString();
                        // 使用者名が設定されている場合はmakerフィールドも更新
                        if (this.currentUser) {
                            jsonData.maker = this.currentUser;
                        }

                        const jsonSaved = await this.saveDataFile(jsonFileName, JSON.stringify(jsonData, null, 2));
                        if (jsonSaved) {
                            logger.info('[TADjs] JSONファイルのupdateDate更新完了:', baseFileId);

                            // JSONファイルのキャッシュもクリア
                            delete this.fileObjects[jsonFileName];
                            logger.info('[TADjs] JSONファイルキャッシュをクリア:', jsonFileName);
                        } else {
                            logger.warn('[TADjs] JSONファイル保存失敗:', jsonFileName);
                        }
                    } else {
                        logger.info('[TADjs] JSONファイルが見つかりません（updateDate更新スキップ）:', jsonFileName);
                    }

                    this.setStatusMessage(`ファイルを保存しました: ${filename}`);
                } else {
                    logger.error('[TADjs] xmlTADファイル保存失敗:', filename);
                    this.setStatusMessage(`ファイル保存エラー: ${filename}`);
                }
            } else {
                // ブラウザ環境の場合、ダウンロード
                const blob = new Blob([xmlData], { type: 'text/xml' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                a.style.display = 'none';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);

                logger.info('[TADjs] xmlTADダウンロード開始:', filename);
                this.setStatusMessage(`ファイルをダウンロード中: ${filename}`);
            }

        } catch (error) {
            logger.error('[TADjs] xmlTAD保存エラー:', error);
            this.setStatusMessage('ファイル保存エラー');
        }
    }

    /**
     * 実身管理用セグメントのbackgroundColorを更新
     * @param {string} fileId - ファイルID
     * @param {string} backgroundColor - 背景色
     */
    async updateBackgroundColor(fileId, backgroundColor) {
        try {
            logger.info('[TADjs] backgroundColor更新開始:', fileId, backgroundColor);

            // fileIdから実身IDを抽出（_0.xtad等の拡張子を除去）
            const realId = fileId.replace(/_\d+\.xtad$/, '');

            // JSONファイル名を構築
            const jsonFilename = `${realId}.json`;

            // Electron環境の場合、ファイルシステムから読み込んで更新
            if (this.isElectronEnv) {
                const dataBasePath = this.getDataBasePath();
                const jsonPath = this.path.join(dataBasePath, jsonFilename);

                // JSONファイルを読み込み
                try {
                    const jsonContent = this.fs.readFileSync(jsonPath, 'utf-8');
                    const metadata = JSON.parse(jsonContent);

                    // backgroundColorを更新（window.backgroundColor）
                    if (!metadata.window) {
                        metadata.window = {};
                    }
                    metadata.window.backgroundColor = backgroundColor;

                    // updateDateを更新
                    metadata.updateDate = new Date().toISOString();
                    // 使用者名が設定されている場合はmakerフィールドも更新
                    if (this.currentUser) {
                        metadata.maker = this.currentUser;
                    }

                    // JSONファイルに保存
                    const saved = await this.saveDataFile(jsonFilename, JSON.stringify(metadata, null, 2));
                    if (saved) {
                        logger.info('[TADjs] backgroundColor更新成功:', jsonFilename);

                        // ファイル直接アクセス版では不要（ファイル保存のみ）
                        logger.info('[TADjs] backgroundColorを更新:', fileId);

                        this.setStatusMessage(`背景色を更新しました: ${backgroundColor}`);
                    } else {
                        logger.error('[TADjs] backgroundColor更新失敗:', jsonFilename);
                        this.setStatusMessage(`背景色更新エラー: ${jsonFilename}`);
                    }
                } catch (readError) {
                    logger.error('[TADjs] JSONファイル読み込みエラー:', jsonFilename, readError);
                    this.setStatusMessage(`JSONファイル読み込みエラー: ${jsonFilename}`);
                }
            }

        } catch (error) {
            logger.error('[TADjs] backgroundColor更新エラー:', error);
            this.setStatusMessage('背景色更新エラー');
        }
    }

    /**
     * 実身管理用セグメントのisFullscreenを更新
     * @param {string} fileId - ファイルID
     * @param {boolean} isFullscreen - 全画面表示フラグ
     */
    async updateFullscreenState(fileId, isFullscreen) {
        try {
            logger.info('[TADjs] isFullscreen更新開始:', fileId, isFullscreen);

            // JSONファイル名を構築
            const jsonFilename = `${fileId}.json`;

            // Electron環境の場合、ファイルシステムから読み込んで更新
            if (this.isElectronEnv) {
                const dataBasePath = this.getDataBasePath();
                const jsonPath = this.path.join(dataBasePath, jsonFilename);

                // JSONファイルを読み込み
                try {
                    const jsonContent = this.fs.readFileSync(jsonPath, 'utf-8');
                    const metadata = JSON.parse(jsonContent);

                    // isFullscreenを更新
                    metadata.isFullscreen = isFullscreen;

                    // metadataにrealIdを設定
                    metadata.realId = fileId;

                    // JSONファイルに保存
                    const saved = await this.saveDataFile(jsonFilename, JSON.stringify(metadata, null, 2));
                    if (saved) {
                        logger.info('[TADjs] isFullscreen更新成功:', jsonFilename);

                        // ファイル直接アクセス版では不要（ファイル保存のみ）
                        logger.info('[TADjs] isFullscreenを更新:', fileId);

                        this.setStatusMessage(`全画面表示状態を更新しました: ${isFullscreen ? 'ON' : 'OFF'}`);
                    } else {
                        logger.error('[TADjs] isFullscreen更新失敗:', jsonFilename);
                        this.setStatusMessage(`全画面表示状態更新エラー: ${jsonFilename}`);
                    }
                } catch (readError) {
                    logger.error('[TADjs] JSONファイル読み込みエラー:', jsonFilename, readError);
                    this.setStatusMessage(`JSONファイル読み込みエラー: ${jsonFilename}`);
                }
            }

        } catch (error) {
            logger.error('[TADjs] isFullscreen更新エラー:', error);
            this.setStatusMessage('全画面表示状態更新エラー');
        }
    }

    /**
     * 実身新規作成ハンドラー
     */
    async handleCreateRealObject(e) {
        return this.executeRealObjectOperation(
            e,
            '実身作成',
            async (realObjectSystem, data) => {
                const { realName, initialXtad, applist, windowConfig } = data;
                const realId = await realObjectSystem.createRealObject(realName, initialXtad, applist, windowConfig);
                return { realId, realName };
            },
            'real-object-created'
        );
    }

    /**
     * 仮身コピーハンドラー
     */
    async handleCopyVirtualObject(e) {
        return this.executeRealObjectOperation(
            e,
            '仮身コピー',
            async (realObjectSystem, data) => {
                const { realId } = data;
                await realObjectSystem.copyVirtualObject(realId);
                return { realId };
            },
            'virtual-object-copied',
            {
                postProcess: async (result, _event) => {
                    // JSONファイルのrefCountも更新
                    await this.updateJsonFileRefCount(result.realId);
                    return result;
                }
            }
        );
    }

    /**
     * 実身コピーハンドラー
     */
    async handleCopyRealObject(e) {
        return this.executeRealObjectOperation(
            e,
            '実身コピー',
            async (realObjectSystem, data) => {
                const { realId } = data;
                const newRealId = await realObjectSystem.copyRealObject(realId);
                return { oldRealId: realId, newRealId };
            },
            'real-object-copied'
        );
    }

    /**
     * 仮身削除ハンドラー
     */
    async handleDeleteVirtualObject(e) {
        return this.executeRealObjectOperation(
            e,
            '仮身削除',
            async (realObjectSystem, data) => {
                const { realId } = data;
                await realObjectSystem.deleteVirtualObject(realId);
                return { realId };
            },
            'virtual-object-deleted',
            {
                postProcess: async (result, _event) => {
                    // JSONファイルのrefCountも更新
                    await this.updateJsonFileRefCount(result.realId);
                    return result;
                }
            }
        );
    }

    /**
     * 実身読み込みハンドラー
     */
    async handleLoadRealObject(e) {
        return this.executeRealObjectOperation(
            e,
            '実身読み込み',
            async (realObjectSystem, data) => {
                const { realId } = data;
                const realObject = await realObjectSystem.loadRealObject(realId);

                // プラグイン（editor.js）互換性のため、トップレベルにもデータを追加
                if (realObject.records && realObject.records.length > 0) {
                    realObject.xtad = realObject.records[0].xtad;
                    realObject.rawData = realObject.records[0].rawData;
                    realObject.xmlData = realObject.records[0].xtad; // virtual-object-list用
                }

                // applistをトップレベルに追加（virtual-object-list用）
                if (realObject.metadata && realObject.metadata.applist) {
                    realObject.applist = realObject.metadata.applist;
                }

                return { realObject };
            },
            'real-object-loaded'
        );
    }

    /**
     * 実身保存ハンドラー
     */
    async handleSaveRealObject(e) {
        return this.executeRealObjectOperation(
            e,
            '実身保存',
            async (realObjectSystem, data) => {
                const { realId, realObject } = data;
                await realObjectSystem.saveRealObject(realId, realObject);
                return { realId };
            },
            'real-object-saved'
        );
    }

    /**
     * 参照カウント0の実身一覧取得ハンドラー
     */
    async handleGetUnreferencedRealObjects(e) {
        return this.executeRealObjectOperation(
            e,
            '参照カウント0の実身一覧取得',
            async (realObjectSystem, _data) => {
                const unreferencedObjects = await realObjectSystem.getUnreferencedRealObjects();
                return { realObjects: unreferencedObjects };
            },
            'unreferenced-real-objects-response'
        );
    }

    /**
     * ファイルシステム再探索ハンドラー
     * （ファイル直接アクセス版では同期不要なので常に成功を返す）
     */
    async handleRescanFilesystem(e) {
        return this.executeRealObjectOperation(
            e,
            'ファイルシステム再探索',
            async (_realObjectSystem, _data) => {
                // ファイル直接アクセスでは同期不要
                // ファイル数をカウントして返す
                let fileCount = 0;
                if (this.isElectronEnv) {
                    const dataBasePath = this._basePath;
                    const files = this.fs.readdirSync(dataBasePath);
                    fileCount = files.filter(f => f.endsWith('.json')).length;
                }
                return { syncCount: fileCount };
            },
            'rescan-filesystem-response',
            {
                requireRealObjectSystem: false,
                errorType: 'rescan-filesystem-response'
            }
        );
    }

    /**
     * 実身物理削除ハンドラー
     */
    async handlePhysicalDeleteRealObject(e) {
        if (!this.realObjectSystem) {
            logger.error('[TADjs] 実身仮身システムが初期化されていません');
            return;
        }

        const { realId, messageId } = e.data;

        try {
            // メタデータを読み込んでdeletableをチェック
            let loadResult;
            try {
                loadResult = await this.realObjectSystem.loadRealObject(realId);
            } catch (loadError) {
                // 既に削除済み（ファイルが存在しない）の場合はsuccessを返す
                if (loadError.message && loadError.message.includes('実身が見つかりません')) {
                    logger.info('[TADjs] 実身は既に削除済み:', realId);
                    if (e.source) {
                        e.source.postMessage({
                            type: 'delete-real-object-response',
                            messageId: messageId,
                            success: true,
                            realId: realId
                        }, '*');
                    }
                    return;
                }
                throw loadError;
            }
            const { metadata } = loadResult;
            if (metadata.deletable === false) {
                // 削除不可の場合はエラーレスポンスを返す
                if (e.source) {
                    e.source.postMessage({
                        type: 'delete-real-object-response',
                        messageId: messageId,
                        success: false,
                        error: 'この実身は「削除不可」に設定されているため削除できません'
                    }, '*');
                }
                return;
            }

            // 実身を削除（屑箱からの削除なのでsafetyCheck有効）
            await this.realObjectSystem.physicalDeleteRealObject(realId, new Set(), true);

            if (e.source) {
                e.source.postMessage({
                    type: 'delete-real-object-response',
                    messageId: messageId,
                    success: true,
                    realId: realId
                }, '*');
            }

            logger.info('[TADjs] 実身物理削除完了:', realId);
        } catch (error) {
            logger.error('[TADjs] 実身物理削除エラー:', error);
            if (e.source) {
                e.source.postMessage({
                    type: 'delete-real-object-response',
                    messageId: messageId,
                    success: false,
                    error: error.message
                }, '*');
            }
        }
    }

    /**
     * 原紙アイコンコピーハンドラー
     * プラグインの原紙アイコンを指定した実身にコピーする
     */
    async handleCopyTemplateIcon(e) {
        if (!this.realObjectSystem) {
            logger.error('[TADjs] 実身仮身システムが初期化されていません');
            return;
        }

        const { realId, pluginId, messageId } = e.data;

        try {
            // プラグイン情報を取得
            const plugin = window.pluginManager && window.pluginManager.plugins.get(pluginId);
            if (!plugin || !plugin.basefile || !plugin.basefile.ico) {
                logger.warn('[TADjs] プラグインまたは原紙アイコンが見つかりません:', pluginId);
                if (e.source) {
                    e.source.postMessage({
                        type: 'template-icon-copied',
                        messageId: messageId,
                        success: false,
                        error: 'プラグインまたは原紙アイコンが見つかりません'
                    }, '*');
                }
                return;
            }

            // 原紙アイコンをコピー
            const success = await this.realObjectSystem.copyTemplateIcon(
                realId,
                pluginId,
                plugin.basefile.ico
            );

            if (e.source) {
                e.source.postMessage({
                    type: 'template-icon-copied',
                    messageId: messageId,
                    success: success,
                    realId: realId,
                    pluginId: pluginId
                }, '*');
            }

            if (success) {
                logger.info('[TADjs] 原紙アイコンコピー完了:', realId, '<-', pluginId);
            }
        } catch (error) {
            logger.error('[TADjs] 原紙アイコンコピーエラー:', error);
            if (e.source) {
                e.source.postMessage({
                    type: 'template-icon-copied',
                    messageId: messageId,
                    success: false,
                    error: error.message
                }, '*');
            }
        }
    }

    /**
     * JSONファイルのrefCountを更新
     * @param {string} realId - 実身ID
     */
    async updateJsonFileRefCount(realId) {
        try {
            // JSONファイル名
            const jsonFileName = `${realId}.json`;

            // 既存のJSONファイルを読み込む
            let jsonData = null;
            try {
                const jsonResult = await this.loadDataFile(this.getDataBasePath(), jsonFileName);
                if (jsonResult.success && jsonResult.data) {
                    jsonData = JSON.parse(jsonResult.data);
                }
            } catch (error) {
                logger.warn('[TADjs] JSONファイル読み込みエラー:', jsonFileName, error);
            }

            // JSONデータが存在する場合のみrefCountを更新
            if (jsonData) {
                // refCountは既にJSONファイルにあるので、realObjectSystemで更新されたものを使用
                const realObject = await this.realObjectSystem.loadRealObject(realId);
                jsonData.refCount = realObject.metadata.refCount;

                // JSONファイルに保存
                await this.saveDataFile(jsonFileName, JSON.stringify(jsonData, null, 2));
                logger.info('[TADjs] JSONファイルのrefCountを更新:', jsonFileName, 'refCount:', realObject.metadata.refCount);
            } else {
                logger.warn('[TADjs] JSONファイルが見つかりません:', jsonFileName);
            }
        } catch (error) {
            logger.error('[TADjs] JSONファイルrefCount更新エラー:', error);
        }
    }

    /**
     * 実身名変更ハンドラー
     */
    async handleRenameRealObject(e) {
        let { realId, currentName, messageId } = e.data;

        // realIdから_0.xtadなどを除去してベースIDのみにする
        realId = realId.replace(/_\d+\.xtad$/i, '');

        try {
            // ダイアログを表示して新しい実身名を入力
            const result = await this.showInputDialog(
                '実身名を入力してください',
                currentName,
                30,
                [
                    { label: '取消', value: 'cancel' },
                    { label: '決定', value: 'ok' }
                ],
                1 // デフォルトは「決定」ボタン
            );

            if (result.button === 'cancel' || !result.value) {
                // キャンセルされた
                if (e.source) {
                    e.source.postMessage({
                        type: 'real-object-renamed',
                        messageId: messageId,
                        success: false
                    }, '*');
                }
                return;
            }

            const newName = result.value;

            // JSONファイルを更新
            const jsonFileName = `${realId}.json`;
            const jsonResult = await this.loadDataFile(this.getDataBasePath(), jsonFileName);
            if (jsonResult.success && jsonResult.data) {
                const jsonData = JSON.parse(jsonResult.data);
                jsonData.name = newName;
                await this.saveDataFile(jsonFileName, JSON.stringify(jsonData, null, 2));
            }

            // XTADファイルを更新（filename属性を変更）
            const escXml = window.escapeXml || ((s) => String(s));
            const xtadFileName = `${realId}_0.xtad`;
            const xtadResult = await this.loadDataFile(this.getDataBasePath(), xtadFileName);
            if (xtadResult.success && xtadResult.data) {
                const newXtadContent = xtadResult.data.replace(
                    /filename="[^"]*"/,
                    `filename="${escXml(newName)}"`
                );
                await this.saveDataFile(xtadFileName, newXtadContent);
                logger.info('[TADjs] XTADファイルのfilename属性を更新:', xtadFileName);
            }

            // この実身を参照しているすべての仮身一覧XTADファイルを更新
            await this.updateLinkNamesInParentXtads(realId, newName);

            // 成功を通知
            if (e.source) {
                e.source.postMessage({
                    type: 'real-object-renamed',
                    messageId: messageId,
                    success: true,
                    newName: newName
                }, '*');
            }

            logger.info('[TADjs] 実身名変更完了:', realId, currentName, '->', newName);
            this.setStatusMessage(`実身名を「${newName}」に変更しました`);
        } catch (error) {
            logger.error('[TADjs] 実身名変更エラー:', error);
            if (e.source) {
                e.source.postMessage({
                    type: 'real-object-renamed',
                    messageId: messageId,
                    success: false,
                    error: error.message
                }, '*');
            }
        }
    }

    /**
     * 実身を参照しているすべての親XTADファイル内のリンク名を更新
     * @param {string} realId - 実身ID
     * @param {string} newName - 新しい実身名
     */
    async updateLinkNamesInParentXtads(realId, newName) {
        try {
            const basePath = this.getDataBasePath();
            const escXml = window.escapeXml || ((s) => String(s));
            const escapedName = escXml(newName);

            // すべてのXTADファイルを検索
            const files = this.fs.readdirSync(basePath);
            const xtadFiles = files.filter(f => f.endsWith('_0.xtad'));

            logger.info('[TADjs] リンク名更新対象XTADファイル数:', xtadFiles.length);

            for (const xtadFile of xtadFiles) {
                const xtadResult = await this.loadDataFile(basePath, xtadFile);
                if (!xtadResult.success || !xtadResult.data) continue;

                const content = xtadResult.data;

                // この実身を参照するlinkタグが存在するか確認（自己閉じタグとペアタグの両方に対応）
                const linkPattern = new RegExp(`<link[^>]*id="${realId}_0\\.xtad"[^>]*(?:\\/>|>([^<]*)</link>)`, 'g');

                if (linkPattern.test(content)) {
                    // 後方互換性のため、旧形式（ペアタグ）のname属性とリンクテキストも更新
                    // 新形式（自己閉じタグ）ではこれらは存在しないため、更新されない
                    let updatedContent = content;

                    // 1. name属性を更新（旧形式の後方互換性）
                    updatedContent = updatedContent.replace(
                        new RegExp(`(<link[^>]*id="${realId}_0\\.xtad"[^>]*name=")[^"]*("[^>]*>)`, 'g'),
                        `$1${escapedName}$2`
                    );

                    // 2. リンクテキストを更新（旧形式の後方互換性）
                    updatedContent = updatedContent.replace(
                        new RegExp(`(<link[^>]*id="${realId}_0\\.xtad"[^>]*>)[^<]*(</link>)`, 'g'),
                        `$1${escapedName}$2`
                    );

                    // ファイルを保存
                    await this.saveDataFile(xtadFile, updatedContent);
                    logger.info('[TADjs] リンク名とname属性を更新:', xtadFile, '->', newName);
                }
            }
        } catch (error) {
            logger.error('[TADjs] リンク名更新エラー:', error);
        }
    }

    /**
     * ファイル取り込みハンドラー
     * file-import プラグインから呼び出される
     * @param {Object} dataOrEvent - イベント（汎用ハンドラー経由）またはデータ
     * @param {Object} event - イベント（関数ハンドラー経由の場合）
     */
    async handleImportFiles(dataOrEvent, event) {
        logger.info('[TADjs] handleImportFiles開始');

        // 汎用ハンドラー経由の場合: dataOrEventはイベントオブジェクト (e)
        // 関数ハンドラー経由の場合: dataOrEventはデータ (e.data), eventはイベント (e)
        const data = dataOrEvent?.data || dataOrEvent;
        const source = dataOrEvent?.source || event?.source;

        const { files, windowId } = data;

        // 応答を送信するヘルパー関数
        const sendResponse = (responseData) => {
            if (windowId) {
                // windowIdが指定されている場合は、そのウィンドウに送信
                this.parentMessageBus.sendToWindow(windowId, 'files-imported', responseData);
            } else if (source) {
                // sourceが利用可能な場合はrespondToを使用
                this.parentMessageBus.respondTo(source, 'files-imported', responseData);
            } else {
                logger.warn('[TADjs] 応答先が見つかりません（windowId, sourceともにnull）');
            }
        };

        if (!files || files.length === 0) {
            logger.warn('[TADjs] ファイルが指定されていません');
            sendResponse({ success: false, error: 'ファイルが指定されていません' });
            return;
        }

        logger.info('[TADjs] ファイルを取り込みます:', files.length, '個');

        try {
            // アクティブな仮身一覧プラグインのiframeを探す
            let virtualObjectListIframe = null;

            // まず、parentMessageBus.childrenから仮身一覧プラグインのウィンドウを探す
            if (this.parentMessageBus?.children) {
                for (const [wId, childInfo] of this.parentMessageBus.children.entries()) {
                    if (childInfo.pluginId === 'virtual-object-list') {
                        const windowElement = document.getElementById(wId);
                        if (windowElement) {
                            virtualObjectListIframe = windowElement.querySelector('iframe');
                            if (virtualObjectListIframe && virtualObjectListIframe.contentWindow) {
                                logger.info('[TADjs] 仮身一覧プラグインのiframeを見つけました:', wId);
                                break;
                            }
                        }
                    }
                }
            }

            // 仮身一覧プラグインが見つからない場合はエラー
            if (!virtualObjectListIframe || !virtualObjectListIframe.contentWindow) {
                logger.error('[TADjs] 仮身一覧プラグインが見つかりません');
                sendResponse({ success: false, error: '仮身一覧プラグインが開かれていません' });
                return;
            }

            // FileImportManagerを使用してファイルをインポート
            if (this.fileImportManager) {
                await this.fileImportManager.handleFilesImport(files, virtualObjectListIframe);

                // 成功を通知
                sendResponse({ success: true });

                logger.info('[TADjs] ファイル取り込み完了');
            } else {
                logger.error('[TADjs] FileImportManagerが初期化されていません');
                sendResponse({ success: false, error: 'FileImportManagerが初期化されていません' });
            }
        } catch (error) {
            logger.error('[TADjs] ファイル取り込みエラー:', error);
            sendResponse({ success: false, error: error.message });
        }
    }

    /**
     * 新たな実身に保存ハンドラー（非再帰的コピー）
     */
    async handleSaveAsNewRealObject(dataOrEvent, event) {
        if (!this.realObjectSystem) {
            logger.error('[TADjs] 実身仮身システムが初期化されていません');
            return;
        }

        // MessageBus Phase 2形式に対応
        const data = dataOrEvent;
        const source = event?.source;
        const { realId: fullRealId, messageId } = data;

        // realIdが未定義の場合はエラー
        if (!fullRealId) {
            logger.error('[TADjs] realIdが未定義です:', data);
            if (source) {
                this.parentMessageBus.respondTo(source, 'save-as-new-real-object-completed', {
                    messageId: messageId,
                    success: false,
                    error: 'realIdが未定義です'
                });
            }
            return;
        }

        // 実身IDを抽出（_0.xtad を除去）
        let realId = fullRealId;
        if (realId.match(/_\d+\.xtad$/i)) {
            realId = realId.replace(/_\d+\.xtad$/i, '');
        }
        logger.info('[TADjs] 実身ID抽出:', realId, 'フルID:', fullRealId);

        try {
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
                1 // デフォルトは「設定」ボタン
            );

            // キャンセルされた場合
            if (result.button === 'cancel' || !result.value) {
                logger.info('[TADjs] 新たな実身に保存がキャンセルされました');
                if (source) {
                    this.parentMessageBus.respondTo(source, 'save-as-new-real-object-completed', {
                        messageId: messageId,
                        success: false,
                        cancelled: true
                    });
                }
                return;
            }

            const newName = result.value;

            // RealObjectSystemの非再帰的実身コピー機能を使用
            const newRealId = await this.realObjectSystem.copyRealObjectNonRecursive(realId, newName);

            // JSONファイルにもrefCountを書き込む
            await this.updateJsonFileRefCount(newRealId);

            // 成功を通知（プラグイン側で仮身追加処理を行う）
            if (source) {
                this.parentMessageBus.respondTo(source, 'save-as-new-real-object-completed', {
                    messageId: messageId,
                    success: true,
                    newRealId: newRealId,
                    newName: newName
                });
            }

            logger.info('[TADjs] 新たな実身に保存完了:', realId, '->', newRealId, '名前:', newName);
            this.setStatusMessage(`新しい実身に保存しました: ${newName}`);
        } catch (error) {
            logger.error('[TADjs] 新たな実身に保存エラー:', error);
            if (source) {
                this.parentMessageBus.respondTo(source, 'save-as-new-real-object-completed', {
                    messageId: messageId,
                    success: false,
                    error: error.message
                });
            }
        }
    }

    /**
     * 選択範囲を仮身化（新しい実身として切り出し）ハンドラー
     */
    async handleVirtualizeSelection(data, event) {
        if (!this.realObjectSystem) {
            logger.error('[TADjs] 実身仮身システムが初期化されていません');
            return;
        }

        const source = event?.source;
        const { messageId, defaultName, xtadContent, imageFiles, sourceRealId } = data;

        try {
            // 名前入力ダイアログを表示
            const result = await this.showInputDialog(
                '新しい実身の名称を入力してください',
                defaultName || '新規実身',
                30,
                [
                    { label: '取消', value: 'cancel' },
                    { label: '設定', value: 'ok' }
                ],
                1
            );

            // キャンセルされた場合
            if (result.button === 'cancel' || !result.value) {
                logger.info('[TADjs] 仮身化がキャンセルされました');
                if (source) {
                    this.parentMessageBus.respondTo(source, 'virtualize-selection-completed', {
                        messageId: messageId,
                        success: false,
                        cancelled: true
                    });
                }
                return;
            }

            const newName = result.value;

            // 新しい実身IDを生成
            const newRealId = generateUUIDv7();
            logger.info('[TADjs] 仮身化: 新実身ID生成:', newRealId);

            // 画像ファイルのコピーとXTAD内参照の置換
            let finalXtad = xtadContent;
            const basePath = this.realObjectSystem._basePath;

            if (imageFiles && imageFiles.length > 0) {
                for (let i = 0; i < imageFiles.length; i++) {
                    const imgInfo = imageFiles[i];
                    const newFilename = `${newRealId}_0_${i}.png`;

                    // 元画像ファイルをコピー
                    const sourceImagePath = this.realObjectSystem.path.join(basePath, imgInfo.originalFilename);
                    const destImagePath = this.realObjectSystem.path.join(basePath, newFilename);

                    if (this.realObjectSystem.fs.existsSync(sourceImagePath)) {
                        try {
                            this.realObjectSystem.fs.copyFileSync(sourceImagePath, destImagePath);
                            logger.debug('[TADjs] 画像ファイルコピー:', imgInfo.originalFilename, '->', newFilename);
                        } catch (copyError) {
                            logger.error('[TADjs] 画像ファイルコピーエラー:', copyError);
                        }
                    }

                    // XTAD内のプレースホルダーを実際のファイル名に置換
                    finalXtad = finalXtad.replace(new RegExp(`__IMAGE_${i}__`, 'g'), newFilename);
                }
            }

            // XTAD全体をラップ
            const wrappedXtad = `<tad version="1.0" encoding="UTF-8">\r\n<document>\r\n<p>\r\n${finalXtad}\r\n</p>\r\n</document>\r\n</tad>`;

            // 新規実身を保存
            const newRealObject = {
                metadata: {
                    realId: newRealId,
                    name: newName,
                    recordCount: 1,
                    refCount: 1,
                    makeDate: new Date().toISOString(),
                    updateDate: new Date().toISOString(),
                    accessDate: new Date().toISOString(),
                    applist: {
                        'basic-text-editor': {
                            name: '基本文章編集',
                            defaultOpen: true
                        }
                    }
                },
                records: [{ xtad: wrappedXtad }]
            };

            await this.realObjectSystem.saveRealObject(newRealId, newRealObject);

            // 基本文章編集プラグインのアイコンをコピー（fs.readFileSyncを使用）
            try {
                // プログラムベースパス（plugins フォルダがある場所）を使用
                const programBasePath = this._programBasePath;
                // plugin.json の basefile.ico を参照
                const baseIconPath = this.path.join(programBasePath, 'plugins/basic-text-editor/019a1132-762b-7b02-ba2a-a918a9b37c39.ico');

                if (this.fs.existsSync(baseIconPath)) {
                    const iconData = this.fs.readFileSync(baseIconPath);
                    const newIconFileName = `${newRealId}.ico`;
                    const iconSaved = await this.saveDataFile(newIconFileName, iconData);
                    if (iconSaved) {
                        logger.info('[TADjs] 仮身化: アイコンファイルコピー完了:', newIconFileName);
                    } else {
                        logger.warn('[TADjs] 仮身化: アイコンファイル保存失敗');
                    }
                } else {
                    logger.warn('[TADjs] 仮身化: アイコンファイルが見つかりません:', baseIconPath);
                }
            } catch (iconError) {
                logger.warn('[TADjs] 仮身化: アイコンファイルコピー失敗:', iconError);
            }

            // JSONファイルにrefCountを書き込む
            await this.updateJsonFileRefCount(newRealId);

            // 成功を通知
            if (source) {
                this.parentMessageBus.respondTo(source, 'virtualize-selection-completed', {
                    messageId: messageId,
                    success: true,
                    newRealId: newRealId,
                    newName: newName
                });
            }

            logger.info('[TADjs] 仮身化完了:', newRealId, '名前:', newName);
            this.setStatusMessage(`仮身化しました: ${newName}`);

        } catch (error) {
            logger.error('[TADjs] 仮身化エラー:', error);
            if (source) {
                this.parentMessageBus.respondTo(source, 'virtualize-selection-completed', {
                    messageId: messageId,
                    success: false,
                    error: error.message
                });
            }
        }
    }

    /**
     * 仮身属性変更ハンドラー
     */
    async handleChangeVirtualObjectAttributes(dataOrEvent, event) {
        // MessageBus Phase 2形式に対応
        const data = dataOrEvent;
        const source = event?.source;
        const { currentAttributes, selectedRatio, messageId } = data;

        try {
            // ダイアログHTML を生成
            const dialogHtml = this.createVirtualObjectAttributesDialogHtml(currentAttributes, selectedRatio);

            // ダイアログを表示
            const result = await this.showCustomDialog(
                dialogHtml,
                [
                    { label: '取消', value: 'cancel' },
                    { label: '決定', value: 'ok' }
                ],
                1 // デフォルトは「決定」ボタン
            );

            if (result.button === 'cancel') {
                // キャンセルされた
                if (source) {
                    this.parentMessageBus.respondTo(source, 'virtual-object-attributes-changed', {
                        messageId: messageId,
                        success: false
                    });
                }
                return;
            }

            // ダイアログから値を取得
            const attributes = this.extractVirtualObjectAttributesFromDialog(result.dialogElement);

            // 成功を通知
            if (source) {
                this.parentMessageBus.respondTo(source, 'virtual-object-attributes-changed', {
                    messageId: messageId,
                    success: true,
                    attributes: attributes
                });
            }

            logger.info('[TADjs] 仮身属性変更完了:', attributes);
        } catch (error) {
            logger.error('[TADjs] 仮身属性変更エラー:', error);
            if (source) {
                this.parentMessageBus.respondTo(source, 'virtual-object-attributes-changed', {
                    messageId: messageId,
                    success: false,
                    error: error.message
                });
            }
        }
    }

    /**
     * 実身JSONファイルのwindowプロパティを更新する共通ヘルパー
     * @param {string} fileId - ファイルID（{realId}_0.xtadの形式またはrealIdそのもの）
     * @param {Function} updateFn - jsonData.windowを受け取り更新する関数
     * @param {string} logLabel - ログ用ラベル
     * @param {*} logData - ログ用データ
     */
    async _updateRealObjectWindowJson(fileId, updateFn, logLabel, logData) {
        try {
            const realId = fileId.replace(/_\d+\.xtad$/, '');
            const jsonFileName = `${realId}.json`;
            const jsonResult = await this.loadDataFile(this.getDataBasePath(), jsonFileName);

            if (jsonResult.success && jsonResult.data) {
                const jsonData = JSON.parse(jsonResult.data);

                if (!jsonData.window) {
                    jsonData.window = {};
                }
                updateFn(jsonData.window);

                jsonData.updateDate = new Date().toISOString();
                if (this.currentUser) {
                    jsonData.maker = this.currentUser;
                }

                if (this.isElectronEnv) {
                    const saved = await this.saveDataFile(jsonFileName, JSON.stringify(jsonData, null, 2));
                    if (saved) {
                        logger.info(`[TADjs] ${logLabel}をJSONファイルに保存:`, realId, logData);
                    } else {
                        logger.error(`[TADjs] ${logLabel}のJSONファイル保存失敗:`, jsonFileName);
                    }
                } else {
                    logger.info('[TADjs] ブラウザ環境のためJSONファイル保存をスキップ:', realId);
                }
            } else {
                logger.warn(`[TADjs] ${logLabel}: JSONファイルが見つかりません:`, jsonFileName);
            }
        } catch (error) {
            logger.error(`[TADjs] ${logLabel}エラー:`, error);
        }
    }

    /**
     * ウィンドウ設定更新ハンドラー
     */
    async handleUpdateWindowConfig(e) {
        const { fileId, windowConfig } = e.data;

        if (!fileId || !windowConfig) {
            logger.error('[TADjs] ウィンドウ設定更新: fileIdまたはwindowConfigが不足');
            return;
        }

        await this._updateRealObjectWindowJson(fileId, (win) => {
            if (windowConfig.pos) win.pos = windowConfig.pos;
            if (windowConfig.width !== undefined) win.width = windowConfig.width;
            if (windowConfig.height !== undefined) win.height = windowConfig.height;
            if (windowConfig.maximize !== undefined) win.maximize = windowConfig.maximize;
            if (windowConfig.panel !== undefined) win.panel = windowConfig.panel;
            if (windowConfig.panelpos) win.panelpos = windowConfig.panelpos;
            if (windowConfig.backgroundColor !== undefined) win.backgroundColor = windowConfig.backgroundColor;
            if (windowConfig.scrollPos) win.scrollPos = windowConfig.scrollPos;
            if (windowConfig.wordWrap !== undefined) win.wordWrap = windowConfig.wordWrap;
            if (windowConfig.zoomratio !== undefined) win.zoomratio = windowConfig.zoomratio;
        }, 'ウィンドウ設定更新', windowConfig);
    }

    /**
     * 道具パネル位置更新ハンドラー
     */
    async handleUpdatePanelPosition(e) {
        const { fileId, panelpos } = e.data;

        if (!fileId || !panelpos) {
            logger.error('[TADjs] 道具パネル位置更新: fileIdまたはpanelposが不足');
            return;
        }

        await this._updateRealObjectWindowJson(fileId, (win) => {
            win.panelpos = panelpos;
        }, '道具パネル位置更新', panelpos);
    }

    /**
     * 仮身属性ダイアログのHTML生成（DialogManagerに委譲）
     * @param {Object} attrs - 仮身属性
     * @param {string} selectedRatio - 選択中の文字サイズ倍率ラベル
     * @returns {string} ダイアログHTML
     */
    createVirtualObjectAttributesDialogHtml(attrs, selectedRatio) {
        if (this.dialogManager) {
            return this.dialogManager.createVirtualObjectAttributesDialogHtml(attrs, selectedRatio);
        }
        logger.warn('[TADjs] DialogManagerが利用できません');
        return '<div>DialogManagerが利用できません</div>';
    }

    /**
     * ダイアログから仮身属性を抽出（DialogManagerに委譲）
     * @param {Element} dialogElement - ダイアログ要素
     * @returns {Object} 仮身属性オブジェクト
     */
    extractVirtualObjectAttributesFromDialog(dialogElement) {
        if (this.dialogManager) {
            return this.dialogManager.extractVirtualObjectAttributesFromDialog(dialogElement);
        }
        logger.warn('[TADjs] DialogManagerが利用できません');
        return {};
    }
}

/**
 * TADjsDesktopクラスに実身操作メソッドを追加
 * @param {Function} TADjsDesktop - TADjsDesktopクラス
 */
export function applyRealObjectOpsMethods(TADjsDesktop) {
    const mixinProto = RealObjectOpsMixin.prototype;
    for (const name of Object.getOwnPropertyNames(mixinProto)) {
        if (name !== 'constructor') {
            TADjsDesktop.prototype[name] = mixinProto[name];
        }
    }
}
