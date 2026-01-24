const logger = window.getLogger('FileImportManager');

/**
 * ファイルインポート管理クラス
 * 外部ファイルを実身オブジェクトとして登録する機能を提供
 * @class
 * 
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
     * 動画ファイル拡張子かどうかをチェック
     * @param {string} ext - 拡張子（小文字）
     * @returns {boolean}
     */
    isVideoExtension(ext) {
        const videoExtensions = ['mp4', 'm4v', 'webm', 'ogv', 'mov'];
        return videoExtensions.includes(ext);
    }

    /**
     * 音声ファイル拡張子かどうかをチェック
     * @param {string} ext - 拡張子（小文字）
     * @returns {boolean}
     */
    isAudioExtension(ext) {
        const audioExtensions = ['mp3', 'wav', 'aac', 'm4a', 'ogg', 'oga', 'flac'];
        return audioExtensions.includes(ext);
    }

    /**
     * ID3タグ文字列のエンコーディングを修正
     * Latin-1として読み込まれた日本語テキストをShift_JISとして再解釈
     * @param {string} str - 文字列
     * @returns {string} 修正後の文字列
     */
    _fixId3TagEncoding(str) {
        if (!str) return str;

        // 既に正常なUTF-8/ASCII文字列かチェック
        // 日本語文字（ひらがな、カタカナ、漢字）が含まれていれば正常
        if (/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(str)) {
            return str;
        }

        // Latin-1として誤解釈された可能性がある場合（0x80-0xFF範囲の文字が多い）
        let hasHighBytes = false;
        for (let i = 0; i < str.length; i++) {
            const code = str.charCodeAt(i);
            if (code >= 0x80 && code <= 0xFF) {
                hasHighBytes = true;
                break;
            }
        }

        if (!hasHighBytes) {
            return str; // ASCII文字のみなので変換不要
        }

        // Encodingライブラリが利用可能か確認
        if (typeof Encoding === 'undefined') {
            return str;
        }

        try {
            // Latin-1文字列をバイト配列に変換
            const bytes = [];
            for (let i = 0; i < str.length; i++) {
                bytes.push(str.charCodeAt(i) & 0xFF);
            }

            // エンコーディングを検出してUnicodeに変換
            const detected = Encoding.detect(bytes);
            if (detected && detected !== 'ASCII' && detected !== 'UNICODE') {
                const unicodeArray = Encoding.convert(bytes, {
                    to: 'UNICODE',
                    from: detected
                });
                return Encoding.codeToString(unicodeArray);
            }
        } catch (e) {
            // 変換失敗時は元の文字列を返す
        }

        return str;
    }

    /**
     * 音声ファイルからID3タグを抽出
     * @param {File|Object} file - 音声ファイル（Fileオブジェクトまたはbase64Dataを持つオブジェクト）
     * @returns {Promise<{title: string|null, artist: string|null, album: string|null, trackNumber: number|null}>}
     */
    async _extractId3Tags(file) {
        const nullResult = { title: null, artist: null, album: null, trackNumber: null };

        // jsmediatagsがグローバルに存在しない場合はnull値を返す
        if (typeof jsmediatags === 'undefined') {
            return nullResult;
        }

        try {
            // ファイルをArrayBufferに変換（複数のソースに対応）
            let arrayBuffer;

            if (file.base64Data) {
                // base64Dataを持つオブジェクト（ファイル取込プラグインから）
                const base64 = file.base64Data.includes(',')
                    ? file.base64Data.split(',')[1]
                    : file.base64Data;
                const binaryString = atob(base64);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                arrayBuffer = bytes.buffer;
            } else if (typeof file.arrayBuffer === 'function') {
                // Fileオブジェクト（ドラッグ＆ドロップから）
                arrayBuffer = await file.arrayBuffer();
            } else if (file.path && this.tadjs.isElectronEnv) {
                // Electron環境でpathがある場合はfsで読み込み
                const fs = require('fs');
                const buffer = fs.readFileSync(file.path);
                arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
            } else {
                return nullResult;
            }

            return new Promise((resolve) => {
                jsmediatags.read(new Blob([arrayBuffer]), {
                    onSuccess: (tag) => {
                        const tags = tag.tags || {};
                        let trackNumber = null;
                        if (tags.track) {
                            // trackは"1/10"形式の場合があるため数値部分を抽出
                            const trackStr = String(tags.track);
                            const trackMatch = trackStr.match(/^(\d+)/);
                            if (trackMatch) {
                                trackNumber = parseInt(trackMatch[1], 10);
                            }
                        }
                        // エンコーディング修正を適用
                        resolve({
                            title: this._fixId3TagEncoding(tags.title) || null,
                            artist: this._fixId3TagEncoding(tags.artist) || null,
                            album: this._fixId3TagEncoding(tags.album) || null,
                            trackNumber: trackNumber
                        });
                    },
                    onError: () => {
                        resolve(nullResult);
                    }
                });
            });
        } catch (error) {
            logger.warn('ID3タグ抽出エラー:', error);
            return nullResult;
        }
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

        // 動画ファイルの場合は専用処理
        if (this.isVideoExtension(fileExt)) {
            return await this.createVideoRealObject(file, fileExt);
        }

        // 音声ファイルの場合は専用処理
        if (this.isAudioExtension(fileExt)) {
            return await this.createAudioRealObject(file, fileExt);
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
<image lineType="0" lineWidth="1" l_pat="0" f_pat="1" angle="0" rotation="0" flipH="false" flipV="false" left="10" top="10" right="${imageWidth + 10}" bottom="${imageHeight + 10}" href="${imageFileName}" />
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
     * 動画ファイルから実身オブジェクトを作成（basic-player用）
     * @param {File} file - 動画ファイル
     * @param {string} fileExt - ファイル拡張子
     * @returns {Promise<{realId: string, name: string, applist: object}|null>}
     */
    async createVideoRealObject(file, fileExt) {
        logger.info('createVideoRealObject開始:', file.name);

        // basic-playerプラグインの原紙情報
        const pluginId = 'basic-player';
        const baseFileId = '019bc56c-5692-774c-84fe-7911f25adabf';

        // 実身名はファイル名から拡張子を除いたものを使用
        const newName = file.name.replace(/\.[^.]+$/, '');
        logger.debug('新しい実身名:', newName);

        // 新しい実身IDを生成
        const newRealId = typeof generateUUIDv7 === 'function' ? generateUUIDv7() : this.tadjs.generateRealFileIdSet(1).fileId;
        logger.debug('新しい実身ID:', newRealId);

        // 原紙のJSONとXTADを読み込む
        let basefileJson = null;
        let basefileXtad = null;
        const basefileIcoName = `${baseFileId}.ico`;

        try {
            const jsonPath = `plugins/${pluginId}/${baseFileId}.json`;
            const xtadPath = `plugins/${pluginId}/${baseFileId}_0.xtad`;

            // JSONファイルを読み込む
            const jsonResponse = await fetch(jsonPath);
            if (jsonResponse.ok) {
                basefileJson = await jsonResponse.json();
                logger.debug('原紙 JSON読み込み完了');
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

        // basic-player用のJSON作成
        const currentDateTime = new Date().toISOString();
        const newRealJson = {
            ...basefileJson,
            name: newName,
            makeDate: currentDateTime,
            updateDate: currentDateTime,
            accessDate: currentDateTime,
            refCount: 1
        };

        // 動画ファイル名（basic-playerの形式: realId_0_resourceNo.ext）
        const mediaFileName = `${newRealId}_0_0.${fileExt}`;

        // 原紙XTADをパースしてvideo要素を追加
        const parser = new DOMParser();
        const doc = parser.parseFromString(basefileXtad, 'text/xml');

        // realData要素を取得
        let realDataEl = doc.querySelector('realData');
        if (!realDataEl) {
            // realData要素がない場合は作成
            let realtimeEl = doc.querySelector('realtime');
            if (!realtimeEl) {
                const tadEl = doc.querySelector('tad');
                if (!tadEl) {
                    logger.error('tad要素が見つかりません');
                    return null;
                }
                realtimeEl = doc.createElement('realtime');
                realtimeEl.setAttribute('autoplay', 'false');
                realtimeEl.setAttribute('preload', 'metadata');
                realtimeEl.setAttribute('loop', 'false');
                tadEl.appendChild(realtimeEl);
            }
            realDataEl = doc.createElement('realData');
            realDataEl.setAttribute('autoplay', 'inherit');
            realDataEl.setAttribute('startDelay', '0');
            realtimeEl.appendChild(realDataEl);
        }

        // video要素を作成して追加
        const mediaId = `video-${Date.now()}`;
        const videoEl = doc.createElement('video');
        videoEl.setAttribute('id', mediaId);
        videoEl.setAttribute('href', mediaFileName);
        videoEl.setAttribute('format', fileExt);
        videoEl.setAttribute('autoplay', 'false');
        videoEl.setAttribute('preload', 'auto');
        videoEl.setAttribute('left', '0');
        videoEl.setAttribute('top', '0');
        videoEl.setAttribute('right', '0');
        videoEl.setAttribute('bottom', '0');
        videoEl.setAttribute('volume', '1.0');
        videoEl.setAttribute('playbackRate', '1.0');
        realDataEl.appendChild(videoEl);

        // XMLをシリアライズ
        const serializer = new XMLSerializer();
        let newRealXtad = serializer.serializeToString(doc);
        // <?xml...?>宣言を削除（xmlTAD仕様では不要）
        newRealXtad = newRealXtad.replace(/<\?xml[^?]*\?>\s*/g, '');

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
                    records: [{ xtad: newRealXtad, images: [mediaFileName] }]
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
            logger.info('動画実身をファイルシステムに保存:', jsonFileName, xtadFileName);
        } else {
            logger.warn('ファイルシステムへの保存に失敗');
            return null;
        }

        // アイコンファイルをコピー（basic-playerのアイコンを使用）
        if (this.tadjs.isElectronEnv) {
            try {
                const baseIconPath = `plugins/${pluginId}/${basefileIcoName}`;
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

        // 動画ファイルを保存
        try {
            let uint8Array;

            if (file.base64Data) {
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

            await this.tadjs.saveDataFile(mediaFileName, uint8Array);
        } catch (error) {
            logger.error('動画ファイル保存エラー:', error);
            return null;
        }

        logger.info('動画実身オブジェクト作成完了:', newRealId, newName);
        return {
            realId: newRealId,
            name: newName,
            applist: newRealJson.applist || {}
        };
    }

    /**
     * 音声ファイルから実身オブジェクトを作成（basic-player用）
     * @param {File} file - 音声ファイル
     * @param {string} fileExt - ファイル拡張子
     * @returns {Promise<{realId: string, name: string, applist: object}|null>}
     */
    async createAudioRealObject(file, fileExt) {
        logger.info('createAudioRealObject開始:', file.name);

        // basic-playerプラグインの原紙情報
        const pluginId = 'basic-player';
        const baseFileId = '019bc56c-5692-774c-84fe-7911f25adabf';

        // 実身名はファイル名から拡張子を除いたものを使用
        const newName = file.name.replace(/\.[^.]+$/, '');
        logger.debug('新しい実身名:', newName);

        // 新しい実身IDを生成
        const newRealId = typeof generateUUIDv7 === 'function' ? generateUUIDv7() : this.tadjs.generateRealFileIdSet(1).fileId;
        logger.debug('新しい実身ID:', newRealId);

        // 原紙のJSONとXTADを読み込む
        let basefileJson = null;
        let basefileXtad = null;
        const basefileIcoName = `${baseFileId}.ico`;

        try {
            const jsonPath = `plugins/${pluginId}/${baseFileId}.json`;
            const xtadPath = `plugins/${pluginId}/${baseFileId}_0.xtad`;

            // JSONファイルを読み込む
            const jsonResponse = await fetch(jsonPath);
            if (jsonResponse.ok) {
                basefileJson = await jsonResponse.json();
                logger.debug('原紙 JSON読み込み完了');
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

        // basic-player用のJSON作成
        const currentDateTime = new Date().toISOString();
        const newRealJson = {
            ...basefileJson,
            name: newName,
            makeDate: currentDateTime,
            updateDate: currentDateTime,
            accessDate: currentDateTime,
            refCount: 1
        };

        // 音声ファイル名（basic-playerの形式: realId_0_resourceNo.ext）
        const mediaFileName = `${newRealId}_0_0.${fileExt}`;

        // ID3タグを抽出
        const id3Tags = await this._extractId3Tags(file);

        // 原紙XTADをパースしてaudio要素を追加
        const parser = new DOMParser();
        const doc = parser.parseFromString(basefileXtad, 'text/xml');

        // realData要素を取得
        let realDataEl = doc.querySelector('realData');
        if (!realDataEl) {
            // realData要素がない場合は作成
            let realtimeEl = doc.querySelector('realtime');
            if (!realtimeEl) {
                const tadEl = doc.querySelector('tad');
                if (!tadEl) {
                    logger.error('tad要素が見つかりません');
                    return null;
                }
                realtimeEl = doc.createElement('realtime');
                realtimeEl.setAttribute('autoplay', 'false');
                realtimeEl.setAttribute('preload', 'metadata');
                realtimeEl.setAttribute('loop', 'false');
                tadEl.appendChild(realtimeEl);
            }
            realDataEl = doc.createElement('realData');
            realDataEl.setAttribute('autoplay', 'inherit');
            realDataEl.setAttribute('startDelay', '0');
            realtimeEl.appendChild(realDataEl);
        }

        // audio要素を作成して追加
        const mediaId = `audio-${Date.now()}`;
        const audioEl = doc.createElement('audio');
        audioEl.setAttribute('id', mediaId);
        audioEl.setAttribute('href', mediaFileName);
        audioEl.setAttribute('format', fileExt);
        audioEl.setAttribute('autoplay', 'false');
        audioEl.setAttribute('preload', 'auto');
        audioEl.setAttribute('volume', '1.0');
        audioEl.setAttribute('pan', '0.0');
        audioEl.setAttribute('playbackRate', '1.0');
        // ID3タグから取得したトラック情報属性を設定
        if (id3Tags.title) {
            audioEl.setAttribute('title', id3Tags.title);
        }
        if (id3Tags.artist) {
            audioEl.setAttribute('artist', id3Tags.artist);
        }
        if (id3Tags.album) {
            audioEl.setAttribute('album', id3Tags.album);
        }
        if (id3Tags.trackNumber !== null) {
            audioEl.setAttribute('trackNumber', String(id3Tags.trackNumber));
        }
        realDataEl.appendChild(audioEl);

        // XMLをシリアライズ
        const serializer = new XMLSerializer();
        let newRealXtad = serializer.serializeToString(doc);
        // <?xml...?>宣言を削除（xmlTAD仕様では不要）
        newRealXtad = newRealXtad.replace(/<\?xml[^?]*\?>\s*/g, '');

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
                    records: [{ xtad: newRealXtad, images: [mediaFileName] }]
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
            logger.info('音声実身をファイルシステムに保存:', jsonFileName, xtadFileName);
        } else {
            logger.warn('ファイルシステムへの保存に失敗');
            return null;
        }

        // アイコンファイルをコピー（basic-playerのアイコンを使用）
        if (this.tadjs.isElectronEnv) {
            try {
                const baseIconPath = `plugins/${pluginId}/${basefileIcoName}`;
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

        // 音声ファイルを保存
        try {
            let uint8Array;

            if (file.base64Data) {
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

            await this.tadjs.saveDataFile(mediaFileName, uint8Array);
        } catch (error) {
            logger.error('音声ファイル保存エラー:', error);
            return null;
        }

        logger.info('音声実身オブジェクト作成完了:', newRealId, newName);
        return {
            realId: newRealId,
            name: newName,
            applist: newRealJson.applist || {}
        };
    }

    /**
     * 複数メディアファイルからプレイリスト実身を作成
     * @param {Array<File>} mediaFiles - メディアファイルの配列
     * @returns {Promise<{realId: string, name: string, applist: object}|null>}
     */
    async createPlaylistRealObject(mediaFiles) {
        logger.info('createPlaylistRealObject開始:', mediaFiles.length, 'files');

        // basic-playerプラグインの原紙情報
        const pluginId = 'basic-player';
        const baseFileId = '019bc56c-5692-774c-84fe-7911f25adabf';

        // 実身名を決定（アルバム名があればそれを使用、なければ最初のファイル名）
        const firstFile = mediaFiles[0];
        let newName = firstFile.name.replace(/\.[^.]+$/, '');

        // 最初のファイルが音声ファイルの場合、ID3タグからアルバム名を取得
        const firstFileExt = firstFile.name.split('.').pop().toLowerCase();
        if (this.isAudioExtension(firstFileExt)) {
            const firstId3Tags = await this._extractId3Tags(firstFile);
            if (firstId3Tags.album) {
                newName = firstId3Tags.album;
                logger.debug('アルバム名を実身名として使用:', newName);
            }
        }
        logger.debug('新しい実身名:', newName);

        // 新しい実身IDを生成
        const newRealId = typeof generateUUIDv7 === 'function' ? generateUUIDv7() : this.tadjs.generateRealFileIdSet(1).fileId;
        logger.debug('新しい実身ID:', newRealId);

        // 原紙のJSONとXTADを読み込む
        let basefileJson = null;
        let basefileXtad = null;
        const basefileIcoName = `${baseFileId}.ico`;

        try {
            const jsonPath = `plugins/${pluginId}/${baseFileId}.json`;
            const xtadPath = `plugins/${pluginId}/${baseFileId}_0.xtad`;

            const jsonResponse = await fetch(jsonPath);
            if (jsonResponse.ok) {
                basefileJson = await jsonResponse.json();
                logger.debug('原紙 JSON読み込み完了');
            } else {
                logger.error('原紙 JSON読み込み失敗');
                return null;
            }

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

        // basic-player用のJSON作成
        const currentDateTime = new Date().toISOString();
        const newRealJson = {
            ...basefileJson,
            name: newName,
            makeDate: currentDateTime,
            updateDate: currentDateTime,
            accessDate: currentDateTime,
            refCount: 1
        };

        // 原紙XTADをパースしてメディア要素を追加
        const parser = new DOMParser();
        const doc = parser.parseFromString(basefileXtad, 'text/xml');

        // realData要素を取得
        let realDataEl = doc.querySelector('realData');
        if (!realDataEl) {
            let realtimeEl = doc.querySelector('realtime');
            if (!realtimeEl) {
                const tadEl = doc.querySelector('tad');
                if (!tadEl) {
                    logger.error('tad要素が見つかりません');
                    return null;
                }
                realtimeEl = doc.createElement('realtime');
                realtimeEl.setAttribute('autoplay', 'false');
                realtimeEl.setAttribute('preload', 'metadata');
                realtimeEl.setAttribute('loop', 'false');
                tadEl.appendChild(realtimeEl);
            }
            realDataEl = doc.createElement('realData');
            realDataEl.setAttribute('autoplay', 'inherit');
            realDataEl.setAttribute('startDelay', '0');
            realtimeEl.appendChild(realDataEl);
        }

        // 各メディアファイルを処理
        const mediaIds = [];
        const mediaFileNames = [];

        for (let i = 0; i < mediaFiles.length; i++) {
            const file = mediaFiles[i];
            const fileExt = file.name.split('.').pop().toLowerCase();
            const mediaType = this.isVideoExtension(fileExt) ? 'video' : 'audio';
            const mediaFileName = `${newRealId}_0_${i}.${fileExt}`;
            const mediaId = `${mediaType}-${Date.now()}-${i}`;

            // 音声ファイルの場合、ID3タグを抽出
            let id3Tags = { title: null, artist: null, album: null, trackNumber: null };
            if (mediaType === 'audio') {
                id3Tags = await this._extractId3Tags(file);
            }

            // メディア要素を作成
            const mediaEl = doc.createElement(mediaType);
            mediaEl.setAttribute('id', mediaId);
            mediaEl.setAttribute('href', mediaFileName);
            mediaEl.setAttribute('format', fileExt);
            mediaEl.setAttribute('preload', 'auto');

            if (i === 0) {
                mediaEl.setAttribute('autoplay', 'false');
            } else {
                mediaEl.setAttribute('trigger', 'manual');
            }

            if (mediaType === 'video') {
                mediaEl.setAttribute('left', '0');
                mediaEl.setAttribute('top', '0');
                mediaEl.setAttribute('right', '0');
                mediaEl.setAttribute('bottom', '0');
            }

            mediaEl.setAttribute('volume', '1.0');
            if (mediaType === 'audio') {
                mediaEl.setAttribute('pan', '0.0');
            }
            mediaEl.setAttribute('playbackRate', '1.0');

            // ID3タグから取得したトラック情報属性を設定
            if (id3Tags.title) {
                mediaEl.setAttribute('title', id3Tags.title);
            }
            if (id3Tags.artist) {
                mediaEl.setAttribute('artist', id3Tags.artist);
            }
            if (id3Tags.album) {
                mediaEl.setAttribute('album', id3Tags.album);
            }
            if (id3Tags.trackNumber !== null) {
                mediaEl.setAttribute('trackNumber', String(id3Tags.trackNumber));
            }

            realDataEl.appendChild(mediaEl);
            mediaIds.push(mediaId);
            mediaFileNames.push(mediaFileName);
        }

        // onended属性を設定（連鎖再生）
        const mediaElements = realDataEl.querySelectorAll('audio, video');
        for (let i = 0; i < mediaElements.length - 1; i++) {
            mediaElements[i].setAttribute('onended', `play:${mediaIds[i + 1]}`);
        }

        // XMLをシリアライズ
        const serializer = new XMLSerializer();
        let newRealXtad = serializer.serializeToString(doc);
        newRealXtad = newRealXtad.replace(/<\?xml[^?]*\?>\s*/g, '');

        // XML整形（各要素を改行で区切る）
        newRealXtad = this._formatXtadOutput(newRealXtad);

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
                    records: [{ xtad: newRealXtad, images: mediaFileNames }]
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
            logger.info('プレイリスト実身をファイルシステムに保存:', jsonFileName, xtadFileName);
        } else {
            logger.warn('ファイルシステムへの保存に失敗');
            return null;
        }

        // アイコンファイルをコピー
        if (this.tadjs.isElectronEnv) {
            try {
                const baseIconPath = `plugins/${pluginId}/${basefileIcoName}`;
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

        // 各メディアファイルを保存
        for (let i = 0; i < mediaFiles.length; i++) {
            const file = mediaFiles[i];
            const mediaFileName = mediaFileNames[i];

            try {
                let uint8Array;

                if (file.base64Data) {
                    const binary = atob(file.base64Data);
                    const len = binary.length;
                    uint8Array = new Uint8Array(len);
                    for (let j = 0; j < len; j++) {
                        uint8Array[j] = binary.charCodeAt(j);
                    }
                } else if (file.path && this.tadjs.isElectronEnv) {
                    const fs = require('fs');
                    const buffer = fs.readFileSync(file.path);
                    uint8Array = new Uint8Array(buffer);
                } else if (typeof file.arrayBuffer === 'function') {
                    const arrayBuffer = await file.arrayBuffer();
                    uint8Array = new Uint8Array(arrayBuffer);
                } else {
                    logger.warn('ファイル内容を取得できません:', file.name);
                    continue;
                }

                await this.tadjs.saveDataFile(mediaFileName, uint8Array);
                logger.debug('メディアファイル保存:', mediaFileName);
            } catch (error) {
                logger.error('メディアファイル保存エラー:', file.name, error);
                return null;
            }
        }

        logger.info('プレイリスト実身オブジェクト作成完了:', newRealId, newName, mediaFiles.length, 'files');
        return {
            realId: newRealId,
            name: newName,
            applist: newRealJson.applist || {}
        };
    }

    /**
     * xmlTAD出力を整形（改行のみ、インデントなし）
     * @param {string} xml - 整形前のXML文字列
     * @returns {string} 整形後のXML文字列
     */
    _formatXtadOutput(xml) {
        return xml
            // 開始タグの後に改行
            .replace(/(<(tad|realtime|realData)[^>]*>)(?![\r\n])/g, '$1\n')
            // 終了タグの前に改行
            .replace(/([^\r\n])(<\/(tad|realtime|realData)>)/g, '$1\n$2')
            // 終了タグの後に改行
            .replace(/(<\/(tad|realtime|realData)>)(?![\r\n])/g, '$1\n')
            // stream開始タグの後に改行
            .replace(/(<stream[^>]*>)(?![\r\n])/g, '$1\n')
            // stream終了タグの前後に改行
            .replace(/([^\r\n])(<\/stream>)/g, '$1\n$2')
            .replace(/(<\/stream>)(?![\r\n])/g, '$1\n')
            // audio/video要素を個別の行に
            .replace(/(<(audio|video)[^>]*\/>)/g, '\n$1')
            // 連続する改行を1つに
            .replace(/\n{2,}/g, '\n')
            // 先頭・末尾の改行を削除
            .replace(/^\n+/, '')
            .replace(/\n+$/, '');
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

        // 全てがメディアファイル（動画/音声）かチェック
        const allMedia = files.every(file => {
            const ext = file.name.split('.').pop().toLowerCase();
            return this.isVideoExtension(ext) || this.isAudioExtension(ext);
        });

        // 複数ファイルかつ全てメディアの場合、プレイリスト実身として作成
        if (files.length > 1 && allMedia) {
            logger.info('複数メディアファイルをプレイリスト実身として作成');
            const realObjectInfo = await this.createPlaylistRealObject(files);
            if (realObjectInfo) {
                // プラグインに仮身追加メッセージを送信（1回のみ）
                const windowId = this.tadjs.parentMessageBus.getWindowIdFromIframe(iframe);
                if (windowId) {
                    this.tadjs.parentMessageBus.sendToWindow(windowId, 'add-virtual-object-from-base', {
                        realId: realObjectInfo.realId,
                        name: realObjectInfo.name,
                        applist: realObjectInfo.applist
                    });
                } else {
                    iframe.contentWindow.postMessage({
                        type: 'add-virtual-object-from-base',
                        realId: realObjectInfo.realId,
                        name: realObjectInfo.name,
                        applist: realObjectInfo.applist
                    }, '*');
                }
                this.tadjs.setStatusMessage(`プレイリスト実身「${realObjectInfo.name}」を作成しました（${files.length}ファイル）`);
            } else {
                logger.warn('プレイリスト実身の作成に失敗しました');
                this.tadjs.setStatusMessage('プレイリスト実身の作成に失敗しました');
            }
            logger.info('handleFilesImport完了');
            return;
        }

        // 従来通りの個別処理
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
