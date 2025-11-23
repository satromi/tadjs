/**
 * ファイルインポート管理クラス
 * 外部ファイルを実身オブジェクトとして登録する機能を提供
 */
class FileImportManager {
    /**
     * コンストラクタ
     * @param {Object} tadjs TADjsアプリケーションのインスタンス
     */
    constructor(tadjs) {
        this.tadjs = tadjs;
    }

    /**
     * インポートされたファイルから実身オブジェクトを作成
     * @param {File} file - インポートされたファイル
     * @returns {Promise<{realId: string, name: string, applist: object}|null>} 作成された実身の情報、またはnull（エラー時）
     */
    async createRealObjectFromImportedFile(file) {
        console.log('[FileImportManager] createRealObjectFromImportedFile開始:', file.name);

        // ファイル拡張子を取得して小文字化
        const fileExt = file.name.split('.').pop().toLowerCase();
        console.log('[FileImportManager] ファイル拡張子:', fileExt);

        // 拡張子に応じて使用する原紙を決定
        let pluginId;
        let baseFileId;

        if (fileExt === 'bpk') {
            // BPKファイル → unpack-file プラグイン
            pluginId = 'unpack-file';
            baseFileId = '0199eb7d-6e78-79fb-fe14-1865d0a23d0f';
        } else {
            // その他のファイル → existing-data-exec プラグイン
            pluginId = 'existing-data-exec';
            baseFileId = '019a4a5c-7e2f-4b8a-9d3c-1f6e8a9b2c4d';
        }

        // 実身名はファイル名から拡張子を除いたものを使用
        const newName = file.name.replace(/\.[^.]+$/, ''); // 拡張子を除いた名前
        console.log('[FileImportManager] 新しい実身名:', newName);

        // 新しい実身IDを生成
        const newRealId = typeof generateUUIDv7 === 'function' ? generateUUIDv7() : this.tadjs.generateRealFileIdSet(1).fileId;
        console.log('[FileImportManager] 新しい実身ID:', newRealId);

        // 原紙のJSONとXTADを読み込む
        let basefileJson = null;
        let basefileXtad = null;
        let basefileIcoName = null;

        try {
            // JSONファイルのパスを構築
            const basefileJsonName = `${baseFileId}.json`;
            const basefileXtadName = `${baseFileId}_0.xtad`;
            basefileIcoName = `${baseFileId}.ico`;

            const jsonPath = `plugins/${pluginId}/${basefileJsonName}`;
            const xtadPath = `plugins/${pluginId}/${basefileXtadName}`;

            // JSONファイルを読み込む
            const jsonResponse = await fetch(jsonPath);
            if (jsonResponse.ok) {
                basefileJson = await jsonResponse.json();
                console.log('[FileImportManager] 原紙 JSON読み込み完了:', basefileJson);
            } else {
                console.error('[FileImportManager] 原紙 JSON読み込み失敗');
                return null;
            }

            // XTADファイルを読み込む
            const xtadResponse = await fetch(xtadPath);
            if (xtadResponse.ok) {
                basefileXtad = await xtadResponse.text();
                console.log('[FileImportManager] 原紙 XTAD読み込み完了');
            } else {
                console.error('[FileImportManager] 原紙 XTAD読み込み失敗');
                return null;
            }
        } catch (error) {
            console.error('[FileImportManager] 原紙読み込みエラー:', error);
            return null;
        }

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

        // 新しい実身のXTADを作成
        let newRealXtad = basefileXtad.replace(
            /filename="[^"]*"/,
            `filename="${newName}"`
        );

        // existing-data-exec の場合、document内のテキストを拡張子に置き換える
        if (pluginId === 'existing-data-exec') {
            // <p>...</p> の内容を拡張子に置き換える
            newRealXtad = newRealXtad.replace(
                /(<p>\s*)[^<]*(\s*<\/p>)/,
                `$1${fileExt}$2`
            );
            console.log('[FileImportManager] existing-data-exec用にxtadを更新: 拡張子=', fileExt);
        }

        // RealObjectSystemに実身を登録
        if (this.tadjs.realObjectSystem) {
            try {
                const metadata = {
                    realId: newRealId,
                    realName: newName,
                    recordCount: 1,
                    refCount: 1,
                    createdAt: new Date().toISOString(),
                    modifiedAt: new Date().toISOString()
                };

                const realObject = {
                    metadata: metadata,
                    records: [{ xtad: newRealXtad, images: [] }]
                };

                await this.tadjs.realObjectSystem.saveRealObject(newRealId, realObject);
                console.log('[FileImportManager] 実身をRealObjectSystemに保存:', newRealId, newName);
            } catch (error) {
                console.error('[FileImportManager] 実身保存エラー:', error);
            }
        }

        // JSONとXTADファイルを保存
        const jsonFileName = window.RealObjectSystem.getRealObjectJsonFileName(newRealId);
        const xtadFileName = `${newRealId}_0.xtad`;

        const jsonSaved = await this.tadjs.saveDataFile(jsonFileName, JSON.stringify(newRealJson, null, 2));
        const xtadSaved = await this.tadjs.saveDataFile(xtadFileName, newRealXtad);

        if (jsonSaved && xtadSaved) {
            console.log('[FileImportManager] 新しい実身をファイルシステムに保存しました:', jsonFileName, xtadFileName);
        } else {
            console.warn('[FileImportManager] ファイルシステムへの保存に失敗しました');
            return null;
        }

        // アイコンファイルをコピー
        if (this.tadjs.isElectronEnv && basefileIcoName) {
            try {
                const baseIconPath = `plugins/${pluginId}/${basefileIcoName}`;
                const iconResponse = await fetch(baseIconPath);
                if (iconResponse.ok) {
                    const iconData = await iconResponse.arrayBuffer();
                    const newIconFileName = `${newRealId}.ico`;
                    const iconSaved = await this.tadjs.saveDataFile(newIconFileName, iconData);
                    if (iconSaved) {
                        console.log('[FileImportManager] アイコンファイルをコピーしました:', newIconFileName);
                    }
                }
            } catch (error) {
                console.warn('[FileImportManager] アイコンファイルコピー中のエラー:', error.message);
            }
        }

        // インポートされたファイルをコピーして実身IDを使ったファイル名で保存
        // 元のファイルは削除しない
        const newFileName = `${newRealId}.${fileExt}`;
        try {
            // ファイルをメモリに保存（元の名前で）
            this.tadjs.fileObjects[file.name] = file;

            // ディスクにコピー（実身IDを使った新しい名前で）
            const arrayBuffer = await file.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            await this.tadjs.saveDataFile(newFileName, uint8Array);
            console.log('[FileImportManager] インポートファイルをコピー:', file.name, '->', newFileName);

            // メモリ上でも新しい名前で参照できるようにする（元の名前も残す）
            this.tadjs.fileObjects[newFileName] = file;
        } catch (error) {
            console.error('[FileImportManager] ファイルコピーエラー:', error);
            return null;
        }

        console.log('[FileImportManager] 実身オブジェクト作成完了:', newRealId, newName);
        return {
            realId: newRealId,
            name: newName,
            applist: newRealJson.applist || {}
        };
    }

    /**
     * ドロップされたファイルを処理
     * @param {FileList} files - ドロップされたファイルリスト
     */
    async handleFilesDrop(files) {
        this.tadjs.setStatusMessage(`${files.length}個のファイルを受け取りました`);

        console.log('[FileImportManager] handleFilesDrop - files:', files.length);

        // アクティブなウィンドウを取得
        const activeWindow = document.querySelector('.window.active');
        console.log('[FileImportManager] activeWindow:', activeWindow ? activeWindow.id : 'null');

        // アクティブなウィンドウの情報を取得（windows Mapから）
        let pluginId = null;
        if (activeWindow) {
            const windowInfo = this.tadjs.windows.get(activeWindow.id);
            if (windowInfo && windowInfo.pluginId) {
                pluginId = windowInfo.pluginId;
            }
        }
        console.log('[FileImportManager] pluginId:', pluginId);

        // アクティブなウィンドウがプラグインウィンドウかチェック
        if (activeWindow && pluginId) {
            console.log('[FileImportManager] アクティブなプラグインウィンドウ:', pluginId);

            // 仮身一覧プラグインの場合は、仮身として追加
            if (pluginId === 'virtual-object-list') {
                const iframe = activeWindow.querySelector('iframe');
                console.log('[FileImportManager] iframe:', iframe ? 'found' : 'null', 'contentWindow:', iframe && iframe.contentWindow ? 'found' : 'null');

                if (iframe && iframe.contentWindow) {
                    // ファイルをインポート
                    await this.handleFilesImport(files, iframe);
                    return; // 処理完了
                }
            } else {
                // その他のプラグインウィンドウの場合は、各ファイルを開く
                files.forEach((file) => {
                    console.log('[FileImportManager] プラグインウィンドウでファイルを開く:', file.name);
                    this.tadjs.openTADFile(file);
                });
                return; // 処理完了
            }
        }

        // アクティブなウィンドウがない、またはプラグインウィンドウでない場合
        {
            console.log('[FileImportManager] アクティブなウィンドウがない、またはプラグインウィンドウでない');

            // デフォルトウィンドウの場合は、ファイルアイコンを追加
            // file-iconsコンテナが存在するかチェック
            const fileIconsContainer = document.getElementById('file-icons');
            console.log('[FileImportManager] file-iconsコンテナ:', fileIconsContainer ? 'found' : 'null');

            if (fileIconsContainer) {
                // file-iconsコンテナが存在する場合は、ファイルアイコンを追加
                console.log('[FileImportManager] file-iconsコンテナにファイルアイコンを追加');
                files.forEach((file, index) => {
                    this.tadjs.addFileIcon(file, index);
                });
            } else {
                // file-iconsコンテナが存在しない場合、仮身一覧プラグインのウィンドウを探す
                // windows Mapから仮身一覧プラグインのウィンドウを探す
                let virtualObjectListWindow = null;
                for (const [windowId, windowInfo] of this.tadjs.windows.entries()) {
                    if (windowInfo.pluginId === 'virtual-object-list') {
                        virtualObjectListWindow = document.getElementById(windowId);
                        break;
                    }
                }
                console.log('[FileImportManager] 仮身一覧プラグインのウィンドウ:', virtualObjectListWindow ? virtualObjectListWindow.id : 'null');

                if (virtualObjectListWindow) {
                    // 仮身一覧プラグインがあれば、そこに追加
                    const iframe = virtualObjectListWindow.querySelector('iframe');
                    console.log('[FileImportManager] 仮身一覧プラグインのiframe:', iframe ? 'found' : 'null');

                    if (iframe && iframe.contentWindow) {
                        console.log('[FileImportManager] 仮身一覧プラグインに追加（フォールバック）');
                        // ファイルをインポート
                        await this.handleFilesImport(files, iframe);
                    }
                } else {
                    // どちらもない場合は、警告を出す（ファイルは開かない）
                    console.warn('[FileImportManager] 初期ウィンドウも仮身一覧プラグインもありません。ファイルを配置できません。');
                }
            }
        }
    }

    /**
     * 複数ファイルを処理して仮身一覧プラグインに追加
     * @param {Array<File>} files - インポートするファイルの配列
     * @param {HTMLIFrameElement} iframe - 仮身一覧プラグインのiframe
     */
    async handleFilesImport(files, iframe) {
        console.log('[FileImportManager] handleFilesImport開始:', files.length, 'files');

        // 各ファイルを処理（非同期処理を順番に実行）
        for (const file of files) {
            console.log('[FileImportManager] ファイルを処理:', file.name);

            // インポートファイルから実身オブジェクトを作成
            const realObjectInfo = await this.createRealObjectFromImportedFile(file);

            // エラーが発生した場合はスキップ
            if (!realObjectInfo) {
                console.log('[FileImportManager] ファイルのインポートに失敗しました:', file.name);
                this.tadjs.setStatusMessage(`ファイルのインポートに失敗: ${file.name}`);
                continue;
            }

            // プラグインに仮身追加メッセージを送信
            const windowId = this.tadjs.parentMessageBus.getWindowIdFromIframe(iframe);
            if (windowId) {
                this.tadjs.parentMessageBus.sendToWindow(windowId, 'add-virtual-object-from-base', {
                    realId: realObjectInfo.realId,
                    name: realObjectInfo.name,
                    applist: realObjectInfo.applist
                });
            } else {
                // フォールバック: windowIdが見つからない場合は旧方式
                iframe.contentWindow.postMessage({
                    type: 'add-virtual-object-from-base',
                    realId: realObjectInfo.realId,
                    name: realObjectInfo.name,
                    applist: realObjectInfo.applist
                }, '*');
            }

            this.tadjs.setStatusMessage(`実身「${realObjectInfo.name}」を作成しました`);
        }

        console.log('[FileImportManager] handleFilesImport完了');
    }
}

// グローバル変数としてエクスポート
window.FileImportManager = FileImportManager;
