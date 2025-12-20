const logger = window.getLogger('FileImportManager');

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
     * 画像ファイル拡張子かどうかをチェック
     * @param {string} ext - 拡張子（小文字）
     * @returns {boolean}
     */
    isImageExtension(ext) {
        const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'ico', 'svg'];
        return imageExtensions.includes(ext);
    }

    /**
     * インポートされたファイルから実身オブジェクトを作成
     * @param {File} file - インポートされたファイル
     * @returns {Promise<{realId: string, name: string, applist: object}|null>} 作成された実身の情報、またはnull（エラー時）
     */
    async createRealObjectFromImportedFile(file) {
        logger.info('createRealObjectFromImportedFile開始:', file.name);

        // ファイル拡張子を取得して小文字化
        const fileExt = file.name.split('.').pop().toLowerCase();
        logger.debug('ファイル拡張子:', fileExt);

        // 画像ファイルの場合は専用処理
        if (this.isImageExtension(fileExt)) {
            return await this.createImageRealObject(file, fileExt);
        }

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
        logger.debug('新しい実身名:', newName);

        // 新しい実身IDを生成
        const newRealId = typeof generateUUIDv7 === 'function' ? generateUUIDv7() : this.tadjs.generateRealFileIdSet(1).fileId;
        logger.debug('新しい実身ID:', newRealId);

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
                logger.debug('原紙 JSON読み込み完了:', basefileJson);
            } else {
                logger.error('原紙 JSON読み込み失敗');
                return null;
            }

            // XTADファイルを読み込む
            const xtadResponse = await fetch(xtadPath);
            if (xtadResponse.ok) {
                basefileXtad = await xtadResponse.text();
                logger.debug('原紙 XTAD読み込み完了');
            } else {
                logger.error('原紙 XTAD読み込み失敗');
                return null;
            }
        } catch (error) {
            logger.error('原紙読み込みエラー:', error);
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
            logger.debug('existing-data-exec用にxtadを更新: 拡張子=', fileExt);
        }

        // RealObjectSystemに実身を登録
        if (this.tadjs.realObjectSystem) {
            try {
                const metadata = {
                    realId: newRealId,
                    name: newName,
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
                logger.debug('実身をRealObjectSystemに保存:', newRealId, newName);
            } catch (error) {
                logger.error('実身保存エラー:', error);
            }
        }

        // JSONとXTADファイルを保存
        const jsonFileName = window.RealObjectSystem.getRealObjectJsonFileName(newRealId);
        const xtadFileName = `${newRealId}_0.xtad`;

        const jsonSaved = await this.tadjs.saveDataFile(jsonFileName, JSON.stringify(newRealJson, null, 2));
        const xtadSaved = await this.tadjs.saveDataFile(xtadFileName, newRealXtad);

        if (jsonSaved && xtadSaved) {
            logger.info('新しい実身をファイルシステムに保存しました:', jsonFileName, xtadFileName);
        } else {
            logger.warn('ファイルシステムへの保存に失敗しました');
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
                        logger.debug('アイコンファイルをコピーしました:', newIconFileName);
                    }
                }
            } catch (error) {
                logger.warn('アイコンファイルコピー中のエラー:', error.message);
            }
        }

        // インポートされたファイルをコピーして実身IDを使ったファイル名で保存
        // 元のファイルは削除しない
        const newFileName = `${newRealId}.${fileExt}`;
        try {
            // ファイルをメモリに保存（元の名前で）
            this.tadjs.fileObjects[file.name] = file;

            // ディスクにコピー（実身IDを使った新しい名前で）
            let uint8Array;

            if (file.base64Data) {
                // Base64エンコードされたデータが送信された場合（プラグインからの場合）
                const binary = atob(file.base64Data);
                const len = binary.length;
                uint8Array = new Uint8Array(len);
                for (let i = 0; i < len; i++) {
                    uint8Array[i] = binary.charCodeAt(i);
                }
            } else if (file.path && this.tadjs.isElectronEnv) {
                // Electron環境でファイルパスが利用可能な場合、fsで読み込む
                const fs = require('fs');
                const buffer = fs.readFileSync(file.path);
                uint8Array = new Uint8Array(buffer);
            } else if (typeof file.arrayBuffer === 'function') {
                // File オブジェクトの場合、arrayBuffer()で読み込む
                const arrayBuffer = await file.arrayBuffer();
                uint8Array = new Uint8Array(arrayBuffer);
            } else {
                // ファイル内容を取得できない場合はスキップ（参照のみ作成済み）
                logger.warn('ファイル内容を取得できません。参照のみ作成:', file.name);
                return {
                    realId: newRealId,
                    name: newName,
                    applist: newRealJson.applist || {}
                };
            }

            await this.tadjs.saveDataFile(newFileName, uint8Array);

            // メモリ上でも新しい名前で参照できるようにする（元の名前も残す）
            this.tadjs.fileObjects[newFileName] = file;
        } catch (error) {
            logger.error('ファイルコピーエラー:', error);
            return null;
        }

        logger.info('実身オブジェクト作成完了:', newRealId, newName);
        return {
            realId: newRealId,
            name: newName,
            applist: newRealJson.applist || {}
        };
    }

    /**
     * 画像ファイルから実身オブジェクトを作成（basic-figure-editor用）
     * @param {File} file - 画像ファイル
     * @param {string} fileExt - ファイル拡張子
     * @returns {Promise<{realId: string, name: string, applist: object}|null>}
     */
    async createImageRealObject(file, fileExt) {
        logger.info('createImageRealObject開始:', file.name);

        // 実身名はファイル名から拡張子を除いたものを使用
        const newName = file.name.replace(/\.[^.]+$/, '');
        logger.debug('新しい実身名:', newName);

        // 新しい実身IDを生成
        const newRealId = typeof generateUUIDv7 === 'function' ? generateUUIDv7() : this.tadjs.generateRealFileIdSet(1).fileId;
        logger.debug('新しい実身ID:', newRealId);

        // 画像をロードしてサイズを取得
        let imageWidth = 400;
        let imageHeight = 300;

        try {
            const imageSize = await this.getImageDimensions(file);
            imageWidth = imageSize.width;
            imageHeight = imageSize.height;
            logger.debug('画像サイズ:', imageWidth, 'x', imageHeight);
        } catch (error) {
            logger.warn('画像サイズ取得失敗、デフォルト値を使用:', error.message);
        }

        // basic-figure-editor用のJSON作成
        const currentDateTime = new Date().toISOString();
        const newRealJson = {
            name: newName,
            makeDate: currentDateTime,
            updateDate: currentDateTime,
            accessDate: currentDateTime,
            periodDate: null,
            refCount: 1,
            editable: true,
            readable: true,
            maker: 'TRON User',
            window: {
                pos: { x: 100, y: 100 },
                panel: true,
                panelpos: { x: 100, y: 90 },
                width: Math.min(imageWidth + 50, 1200),
                height: Math.min(imageHeight + 80, 900),
                minWidth: 200,
                minHeight: 200,
                resizable: true,
                scrollable: true,
                maximize: false,
                maximizable: true,
                minimizable: true,
                closable: true,
                alwaysOnTop: false,
                skipTaskbar: false,
                frame: true,
                transparent: false,
                backgroundColor: '#ffffff'
            },
            applist: {
                'basic-figure-editor': {
                    name: newName,
                    defaultOpen: true
                },
                'basic-text-editor': {
                    name: '基本文章編集',
                    defaultOpen: false
                }
            }
        };

        // 画像ファイル名（basic-figure-editorの形式: realId_0_imgNo.ext）
        const imageFileName = `${newRealId}_0_0.${fileExt}`;

        // basic-figure-editor用のXTAD作成（画像シェイプを含む）
        const newRealXtad = `<tad version="1.0" encoding="UTF-8">
<figure>
<image l_atr="1" l_pat="0" f_pat="1" angle="0" rotation="0" flipH="false" flipV="false" left="10" top="10" right="${imageWidth + 10}" bottom="${imageHeight + 10}" href="${imageFileName}" />
</figure>
</tad>`;

        // RealObjectSystemに実身を登録
        if (this.tadjs.realObjectSystem) {
            try {
                const metadata = {
                    realId: newRealId,
                    name: newName,
                    recordCount: 1,
                    refCount: 1,
                    createdAt: currentDateTime,
                    modifiedAt: currentDateTime
                };

                const realObject = {
                    metadata: metadata,
                    records: [{ xtad: newRealXtad, images: [imageFileName] }]
                };

                await this.tadjs.realObjectSystem.saveRealObject(newRealId, realObject);
                logger.debug('実身をRealObjectSystemに保存:', newRealId, newName);
            } catch (error) {
                logger.error('実身保存エラー:', error);
            }
        }

        // JSONとXTADファイルを保存
        const jsonFileName = window.RealObjectSystem.getRealObjectJsonFileName(newRealId);
        const xtadFileName = `${newRealId}_0.xtad`;

        const jsonSaved = await this.tadjs.saveDataFile(jsonFileName, JSON.stringify(newRealJson, null, 2));
        const xtadSaved = await this.tadjs.saveDataFile(xtadFileName, newRealXtad);

        if (jsonSaved && xtadSaved) {
            logger.info('画像実身をファイルシステムに保存:', jsonFileName, xtadFileName);
        } else {
            logger.warn('ファイルシステムへの保存に失敗');
            return null;
        }

        // アイコンファイルをコピー（basic-figure-editorのアイコンを使用）
        if (this.tadjs.isElectronEnv) {
            try {
                const baseIconPath = 'plugins/basic-figure-editor/019a0f91-066f-706f-93da-ffe8150d6207.ico';
                const iconResponse = await fetch(baseIconPath);
                if (iconResponse.ok) {
                    const iconData = await iconResponse.arrayBuffer();
                    const newIconFileName = `${newRealId}.ico`;
                    await this.tadjs.saveDataFile(newIconFileName, iconData);
                    logger.debug('アイコンファイルをコピー:', newIconFileName);
                }
            } catch (error) {
                logger.warn('アイコンファイルコピー中のエラー:', error.message);
            }
        }

        // 画像ファイルを保存
        try {
            let uint8Array;

            if (file.base64Data) {
                // Base64エンコードされたデータが送信された場合（プラグインからの場合）
                const binary = atob(file.base64Data);
                const len = binary.length;
                uint8Array = new Uint8Array(len);
                for (let i = 0; i < len; i++) {
                    uint8Array[i] = binary.charCodeAt(i);
                }
            } else if (file.path && this.tadjs.isElectronEnv) {
                const fs = require('fs');
                const buffer = fs.readFileSync(file.path);
                uint8Array = new Uint8Array(buffer);
            } else if (typeof file.arrayBuffer === 'function') {
                const arrayBuffer = await file.arrayBuffer();
                uint8Array = new Uint8Array(arrayBuffer);
            } else {
                logger.warn('ファイル内容を取得できません');
                return {
                    realId: newRealId,
                    name: newName,
                    applist: newRealJson.applist || {}
                };
            }

            await this.tadjs.saveDataFile(imageFileName, uint8Array);
        } catch (error) {
            logger.error('画像ファイル保存エラー:', error);
            return null;
        }

        logger.info('画像実身オブジェクト作成完了:', newRealId, newName);
        return {
            realId: newRealId,
            name: newName,
            applist: newRealJson.applist || {}
        };
    }

    /**
     * 画像のサイズを取得
     * @param {File|Object} file - 画像ファイルまたはBase64データを含むオブジェクト
     * @returns {Promise<{width: number, height: number}>}
     */
    getImageDimensions(file) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            let url;
            let isDataUrl = false;

            if (file.base64Data) {
                // Base64データからData URLを作成
                const mimeType = file.type || 'image/png';
                url = `data:${mimeType};base64,${file.base64Data}`;
                isDataUrl = true;
            } else if (typeof file === 'object' && file.name) {
                // Fileオブジェクトの場合
                url = URL.createObjectURL(file);
            } else {
                reject(new Error('Invalid file object'));
                return;
            }

            img.onload = () => {
                if (!isDataUrl) {
                    URL.revokeObjectURL(url);
                }
                resolve({ width: img.width, height: img.height });
            };

            img.onerror = () => {
                if (!isDataUrl) {
                    URL.revokeObjectURL(url);
                }
                reject(new Error('画像読み込みエラー'));
            };

            img.src = url;
        });
    }

    /**
     * ドロップされたファイルを処理
     * @param {FileList} files - ドロップされたファイルリスト
     */
    async handleFilesDrop(files) {
        this.tadjs.setStatusMessage(`${files.length}個のファイルを受け取りました`);

        logger.info('handleFilesDrop - files:', files.length);

        // アクティブなウィンドウを取得
        const activeWindow = document.querySelector('.window.active');
        logger.debug('activeWindow:', activeWindow ? activeWindow.id : 'null');

        // アクティブなウィンドウの情報を取得（windows Mapから）
        let pluginId = null;
        if (activeWindow) {
            const windowInfo = this.tadjs.windows.get(activeWindow.id);
            if (windowInfo && windowInfo.pluginId) {
                pluginId = windowInfo.pluginId;
            }
        }
        logger.debug('pluginId:', pluginId);

        // アクティブなウィンドウがプラグインウィンドウかチェック
        if (activeWindow && pluginId) {
            logger.debug('アクティブなプラグインウィンドウ:', pluginId);

            // 仮身一覧プラグインの場合は、仮身として追加
            if (pluginId === 'virtual-object-list') {
                const iframe = activeWindow.querySelector('iframe');
                logger.debug('iframe:', iframe ? 'found' : 'null', 'contentWindow:', iframe && iframe.contentWindow ? 'found' : 'null');

                if (iframe && iframe.contentWindow) {
                    // ファイルをインポート
                    await this.handleFilesImport(files, iframe);
                    return; // 処理完了
                }
            } else {
                // その他のプラグインウィンドウの場合は、各ファイルを開く
                files.forEach((file) => {
                    logger.debug('プラグインウィンドウでファイルを開く:', file.name);
                    this.tadjs.openTADFile(file);
                });
                return; // 処理完了
            }
        }

        // アクティブなウィンドウがない、またはプラグインウィンドウでない場合
        {
            logger.debug('アクティブなウィンドウがない、またはプラグインウィンドウでない');

            // デフォルトウィンドウの場合は、ファイルアイコンを追加
            // file-iconsコンテナが存在するかチェック
            const fileIconsContainer = document.getElementById('file-icons');
            logger.debug('file-iconsコンテナ:', fileIconsContainer ? 'found' : 'null');

            if (fileIconsContainer) {
                // file-iconsコンテナが存在する場合は、ファイルアイコンを追加
                logger.debug('file-iconsコンテナにファイルアイコンを追加');
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
                logger.debug('仮身一覧プラグインのウィンドウ:', virtualObjectListWindow ? virtualObjectListWindow.id : 'null');

                if (virtualObjectListWindow) {
                    // 仮身一覧プラグインがあれば、そこに追加
                    const iframe = virtualObjectListWindow.querySelector('iframe');
                    logger.debug('仮身一覧プラグインのiframe:', iframe ? 'found' : 'null');

                    if (iframe && iframe.contentWindow) {
                        logger.debug('仮身一覧プラグインに追加（フォールバック）');
                        // ファイルをインポート
                        await this.handleFilesImport(files, iframe);
                    }
                } else {
                    // どちらもない場合は、警告を出す（ファイルは開かない）
                    logger.warn('初期ウィンドウも仮身一覧プラグインもありません。ファイルを配置できません。');
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
        logger.info('handleFilesImport開始:', files.length, 'files');

        // 各ファイルを処理（非同期処理を順番に実行）
        for (const file of files) {
            logger.debug('ファイルを処理:', file.name);

            // インポートファイルから実身オブジェクトを作成
            const realObjectInfo = await this.createRealObjectFromImportedFile(file);

            // エラーが発生した場合はスキップ
            if (!realObjectInfo) {
                logger.warn('ファイルのインポートに失敗しました:', file.name);
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

        logger.info('handleFilesImport完了');
    }
}

// グローバル変数としてエクスポート
window.FileImportManager = FileImportManager;

// ES6モジュールとしてもエクスポート
export { FileImportManager };
