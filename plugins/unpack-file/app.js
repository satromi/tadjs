/**
 * 書庫解凍プラグイン
 * BPK書庫ファイルを解凍し、実身を仮身形式で表示
 * ドラッグで実身をtadjs-desktopに渡す
 */
const logger = window.getLogger('UnpackFile');

class UnpackFileManager {
    constructor() {
        this.archiveFiles = [];
        this.fileIdMap = new Map(); // f_id -> UUID mapping
        this.rawData = null;
        this.fileName = null; // BPKファイル名を保存
        this.realId = null; // 実身ID

        // MessageBus Phase 2: MessageBusのみを使用
        this.messageBus = null;
        if (window.MessageBus) {
            this.messageBus = new window.MessageBus({
                debug: false,
                pluginName: 'UnpackFile'
            });
            this.messageBus.start();
        }

        this.init();
    }

    init() {
        logger.info('[UnpackFile] 初期化開始');

        // MessageBus Phase 2: MessageBusのハンドラを設定
        if (this.messageBus) {
            this.setupMessageBusHandlers();
        }

        // ウィンドウアクティベーション
        this.setupWindowActivation();

        // 右クリックメニュー
        this.setupContextMenu();
    }

    /**
     * MessageBus Phase 2: MessageBusのハンドラを設定
     */
    setupMessageBusHandlers() {
        // 初期化メッセージ
        this.messageBus.on('init', async (data) => {
            logger.info('[UnpackFile] init受信', data);
            logger.info('[UnpackFile] data.fileData:', data.fileData);
            logger.info('[UnpackFile] data.fileData keys:', data.fileData ? Object.keys(data.fileData) : 'null');

            // ウィンドウIDを保存
            this.windowId = data.windowId;
            logger.info('[UnpackFile] windowId:', this.windowId);

            if (data.fileData) {
                this.rawData = data.fileData.rawData;
                this.fileName = data.fileData.fileName || data.fileData.displayName || 'archive';

                // realIdを保存（拡張子を除去）
                let rawId = data.fileData.realId || data.fileData.fileId;
                this.realId = rawId ? rawId.replace(/_\d+\.xtad$/, '') : null;

                logger.info('[UnpackFile] this.rawData設定:', this.rawData ? `存在（長さ: ${this.rawData.length}）` : 'null');
                logger.info('[UnpackFile] fileName設定:', this.fileName);
                logger.info('[UnpackFile] realId設定:', this.realId, '(元:', rawId, ')');

                // BPKファイルのヘッダーのみ読み込み（解凍は行わない）
                this.loadArchiveHeader(this.rawData, this.fileName);
            }
        });

        // ウィンドウ移動
        this.messageBus.on('window-moved', (data) => {
            this.updateWindowConfig({
                pos: data.pos,
                width: data.width,
                height: data.height
            });
        });

        // ウィンドウリサイズ
        this.messageBus.on('window-resized-end', (data) => {
            this.updateWindowConfig({
                pos: data.pos,
                width: data.width,
                height: data.height
            });
        });

        // 全画面表示切り替え
        this.messageBus.on('window-maximize-toggled', (data) => {
            this.updateWindowConfig({
                pos: data.pos,
                width: data.width,
                height: data.height,
                maximize: data.maximize
            });
        });

        // メニュー定義要求
        this.messageBus.on('get-menu-definition', (data) => {
            this.messageBus.send('menu-definition-response', {
                messageId: data.messageId,
                menuDefinition: [
                    {
                        text: '編集',
                        submenu: [
                            { text: '再読込', action: 'reload' }
                        ]
                    }
                ]
            });
        });

        // メニューアクション
        this.messageBus.on('menu-action', (data) => {
            this.handleMenuAction(data.action);
        });

        // アーカイブドロップ検出
        this.messageBus.on('archive-drop-detected', async (data) => {
            logger.info('[UnpackFile] ドロップ検出通知受信');
            await this.handleArchiveDrop(data.dropPosition, data.dragData);
        });

        // ルート実身配置完了
        this.messageBus.on('root-virtual-object-inserted', async (data) => {
            logger.info('[UnpackFile] ルート実身配置完了通知受信');
            await this.handleRootInsertionComplete();
        });
    }

    handleMenuAction(action) {
        switch (action) {
            case 'reload':
                if (this.rawData) {
                    this.extractArchive(this.rawData);
                }
                break;
        }
    }

    setupContextMenu() {
        document.addEventListener('contextmenu', (e) => {
            e.preventDefault();

            const rect = window.frameElement.getBoundingClientRect();

            // MessageBus Phase 2: messageBus.send()を使用
            this.messageBus.send('context-menu-request', {
                x: rect.left + e.clientX,
                y: rect.top + e.clientY
            });
        });

        document.addEventListener('click', () => {
            // MessageBus Phase 2: messageBus.send()を使用
            this.messageBus.send('close-context-menu');
        });
    }

    setupWindowActivation() {
        document.addEventListener('mousedown', () => {
            // MessageBus Phase 2: messageBus.send()を使用
            this.messageBus.send('activate-window');
        });
    }

    /**
     * UUID v7を生成（tadjs-desktop.jsから移植）
     */
    generateUUIDv7() {
        const timestamp = Date.now();
        const randomBytes = new Uint8Array(10);

        if (typeof window !== 'undefined' && window.crypto) {
            window.crypto.getRandomValues(randomBytes);
        } else if (typeof globalThis !== 'undefined' && globalThis.crypto) {
            globalThis.crypto.getRandomValues(randomBytes);
        } else {
            for (let i = 0; i < randomBytes.length; i++) {
                randomBytes[i] = Math.floor(Math.random() * 256);
            }
        }

        const timestampHex = timestamp.toString(16).padStart(12, '0');
        const randomHex = Array.from(randomBytes)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');

        const timeLow = timestampHex;
        const timeHiAndVersion = '7' + randomHex.substring(0, 3);
        const clockSeqByte = parseInt(randomHex.substring(3, 5), 16);
        const clockSeqHi = ((clockSeqByte & 0x3F) | 0x80).toString(16).padStart(2, '0');
        const clockSeqLow = randomHex.substring(5, 7);
        const node = randomHex.substring(7, 19);

        return `${timeLow.substring(0, 8)}-${timeLow.substring(8, 12)}-${timeHiAndVersion}-${clockSeqHi}${clockSeqLow}-${node}`;
    }

    /**
     * BPKファイルのヘッダー情報のみを読み込み（解凍は行わない）
     * @param {Uint8Array} rawData - BPKファイルの生データ
     * @param {string} fileName - BPKファイル名
     */
    async loadArchiveHeader(rawData, fileName) {
        logger.info('[UnpackFile] 書庫ヘッダー読み込み開始（解凍は実施しない）');

        try {
            // ファイル名から拡張子を除いたベース名を取得
            let baseName = fileName;
            if (fileName) {
                // .bpk または .BPK を削除
                baseName = fileName.replace(/\.(bpk|BPK)$/i, '');
            }

            logger.info('[UnpackFile] ルート実身名:', baseName);

            const rootFile = {
                fileId: this.generateUUIDv7(),
                name: baseName,
                isRoot: true
            };

            this.archiveFiles = [rootFile];

            // ルート実身の仮身を表示
            this.renderRootVirtualObject();

        } catch (error) {
            logger.error('[UnpackFile] ヘッダー読み込みエラー:', error);
        }
    }

    /**
     * BPKファイルを解凍（ドラッグ時に呼び出される）
     */
    async extractArchive(rawData) {
        logger.info('[UnpackFile] 書庫解凍開始');

        try {
            // unpack.jsの解凍処理を呼び出し
            // forceXmlDumpEnabledを有効化してXML生成を強制
            window.forceXmlDumpEnabled = true;

            // tadRawArrayを呼び出して解凍
            if (typeof window.tadRawArray === 'function') {
                // Uint8Arrayに変換
                const uint8Array = new Uint8Array(rawData);

                // BPK解凍を実行（unpack.jsがprocessExtractedFilesを自動的に呼ぶ）
                window.tadRawArray(uint8Array);

                // unpack.jsから結果を取得
                this.getExtractedFilesFromUnpackJS();

                // 仮身一覧を表示
                this.renderArchiveFiles();
            } else {
                logger.error('[UnpackFile] tadRawArray関数が見つかりません');
            }

        } catch (error) {
            logger.error('[UnpackFile] 書庫解凍エラー:', error);
        }
    }

    /**
     * unpack.jsから解凍結果を取得
     */
    getExtractedFilesFromUnpackJS() {
        logger.info('[UnpackFile] unpack.jsから解凍結果を取得');

        // unpack.jsから実身情報を取得
        if (typeof window.getArchiveFiles === 'function') {
            this.archiveFiles = window.getArchiveFiles();
            logger.info(`[UnpackFile] ${this.archiveFiles.length}個の実身を取得`);
        } else {
            logger.error('[UnpackFile] getArchiveFiles関数が見つかりません');
            this.archiveFiles = [];
        }

        // unpack.jsから実身IDマップを取得
        if (typeof window.getRealIdMap === 'function') {
            this.fileIdMap = window.getRealIdMap();
            logger.info(`[UnpackFile] 実身IDマップを取得:`, this.fileIdMap.size, '個');
        } else {
            logger.error('[UnpackFile] getRealIdMap関数が見つかりません');
            this.fileIdMap = new Map();
        }
    }

    /**
     * 実身ファイルセットを生成してtadjs-desktopに送信
     */
    async generateAndSendRealFiles() {
        logger.info('[UnpackFile] 実身ファイルセット生成開始');

        try {
            const generatedFiles = [];

            // 各実身についてファイルセットを生成
            for (let i = 0; i < this.archiveFiles.length; i++) {
                const file = this.archiveFiles[i];
                const realName = file.name || `file_${i}`;
                const nrec = file.nrec || 1;
                const recordXmls = file.recordXmls || [];
                const calcRecordTypes = file.calcRecordTypes || [];

                logger.info(`[UnpackFile] 実身 ${i + 1}/${this.archiveFiles.length}: ${realName} (レコード数: ${nrec})`);

                // 現在の日時を取得
                const now = new Date().toISOString();

                // applistをレコードタイプに応じて設定（配列内に1が含まれるかで判定）
                const isCalcTad = Array.isArray(calcRecordTypes) && calcRecordTypes.includes(1);
                if (isCalcTad) {
                    logger.info(`[UnpackFile] 実身 ${i + 1}: 基本表計算形式TADとして処理`);
                }

                // JSONデータを生成（実身管理用セグメント構造）
                const jsonData = {
                    name: realName,
                    linktype: false,
                    makeDate: now,
                    updateDate: now,
                    accessDate: now,
                    periodDate: null,
                    refCount: 1,
                    editable: true,
                    readable: true,
                    maker: "satromi",
                    window: {
                        pos: { x: 100, y: 100 },
                        width: 600,
                        height: 400,
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
                        backgroundColor: "#ffffff"
                    },
                    applist: isCalcTad ? {
                        "basic-text-editor": { name: "基本文章編集", defaultOpen: false },
                        "basic-calc-editor": { name: "基本表計算", defaultOpen: true },
                        "virtual-object-list": { name: "仮身一覧", defaultOpen: false }
                    } : {
                        "basic-text-editor": { name: "基本文章編集", defaultOpen: true },
                        "basic-figure-editor": { name: "基本図形編集", defaultOpen: false },
                        "virtual-object-list": { name: "仮身一覧", defaultOpen: false }
                    }
                };

                // 各レコードについてファイルエントリを生成
                let xtadIndex = 0;  // 生成されたXTADファイルの連番
                for (let recNo = 0; recNo < recordXmls.length; recNo++) {
                    const xtadContent = recordXmls[recNo] || '';

                    // 空のXTADデータ(type=0, type=8のレコード)はスキップ
                    if (xtadContent.length === 0) {
                        logger.info(`[UnpackFile] レコード ${recNo}: スキップ（XML不要なレコード）`);
                        continue;
                    }

                    logger.info(`[UnpackFile] レコード ${recNo}: ${file.fileId}_${xtadIndex}.xtad (長さ: ${xtadContent.length} 文字)`);

                    // 生成したファイル情報を保存
                    generatedFiles.push({
                        fileId: file.fileId,
                        recordNo: xtadIndex,  // 連番を使用
                        name: realName,
                        jsonData: jsonData,  // 同じ実身の全レコードで同じJSON
                        xtadData: xtadContent
                    });

                    xtadIndex++;  // 連番をインクリメント
                }
            }

            logger.info('[UnpackFile] 実身ファイルセット生成完了:', generatedFiles.length, '個のファイルエントリ');

            // unpack.jsから生成された画像を取得
            let generatedImages = [];
            if (typeof window.getGeneratedImages === 'function') {
                generatedImages = window.getGeneratedImages();
                logger.info(`[UnpackFile] ${generatedImages.length}個の画像を取得`);
            }

            // データを分割して送信（postMessageのサイズ制限対策）
            const CHUNK_SIZE = 10; // 一度に10個ずつ送信

            for (let i = 0; i < generatedFiles.length; i += CHUNK_SIZE) {
                const chunk = generatedFiles.slice(i, i + CHUNK_SIZE);
                const isLastChunk = (i + CHUNK_SIZE >= generatedFiles.length);

                // 画像は最後のチャンクでのみ送信
                const imagesToSend = isLastChunk ? generatedImages : [];

                // MessageBus Phase 2: messageBus.send()を使用
                this.messageBus.send('archive-files-generated', {
                    files: chunk,
                    images: imagesToSend,
                    chunkInfo: {
                        index: i / CHUNK_SIZE,
                        total: Math.ceil(generatedFiles.length / CHUNK_SIZE),
                        isLast: isLastChunk
                    }
                });
                logger.info(`[UnpackFile] チャンク ${i / CHUNK_SIZE + 1}/${Math.ceil(generatedFiles.length / CHUNK_SIZE)} を送信（${chunk.length}個のファイル、${imagesToSend.length}個の画像）`);

                // 次のチャンクを送る前に少し待機（処理の負荷を軽減）
                if (!isLastChunk) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }

            logger.info('[UnpackFile] すべてのファイル情報送信完了');

        } catch (error) {
            logger.error('[UnpackFile] 実身ファイルセット生成エラー:', error);
        }
    }

    /**
     * virtual-object-listからドロップ通知を受け取った際の処理
     * 確認ダイアログを表示→解凍→ルート実身配置要求の流れを実行
     */
    async handleArchiveDrop(dropPosition, dragData) {
        logger.info('[UnpackFile] ドロップ処理開始');

        // ドロップ位置とdragDataを保存
        this.pendingDropPosition = dropPosition;
        this.pendingDragData = dragData;

        // MessageBus Phase 2: messageBus.send()を使用
        // 元のvirtual-object-listウィンドウに「このドラッグはunpack-fileで処理された」ことを通知
        this.messageBus.send('archive-drop-handled', {
            sourceWindowId: dragData.sourceWindowId
        });

        // 確認ダイアログのメッセージを構築
        const fileName = dragData.file.name || 'アーカイブ';
        const fileCount = dragData.allFiles ? dragData.allFiles.length : 1;

        let totalBytes = 0;
        if (dragData.allFiles) {
            dragData.allFiles.forEach(f => {
                if (f.xmlData) {
                    totalBytes += f.xmlData.length;
                }
            });
        }
        const sizeStr = totalBytes > 0 ? `${Math.round(totalBytes / 1024)} KB` : '不明';

        const message = `ルート実身名：${fileName}\n実身の総数：${fileCount}\n実身の総容量：${sizeStr}`;

        // 確認ダイアログを表示
        const result = await this.showMessageDialog(
            message,
            [
                { label: '取消', value: 'cancel' },
                { label: '開始', value: 'start' }
            ],
            1 // デフォルトは「開始」ボタン
        );

        if (result === 'start') {
            logger.info('[UnpackFile] 解凍開始');
            // 解凍処理を実行
            const rawDataArray = dragData.rawData ? new Uint8Array(dragData.rawData) : this.rawData;
            await this.extractArchive(rawDataArray);

            // 解凍完了後、ルート実身配置要求を送信
            await this.requestRootInsertion();
        } else {
            logger.info('[UnpackFile] 解凍キャンセル');
        }
    }

    /**
     * MessageBus Phase 2: メッセージダイアログを表示
     * MessageBus.sendWithCallback()を使用
     */
    async showMessageDialog(message, buttons, defaultButton = 0) {
        return new Promise((resolve) => {
            this.messageBus.sendWithCallback('show-message-dialog', {
                message: message,
                buttons: buttons,
                defaultButton: defaultButton
            }, (result) => {
                if (result.error) {
                    logger.warn('[UnpackFile] Message dialog error:', result.error);
                    resolve(null);
                    return;
                }
                resolve(result.result);
            });
        });
    }

    /**
     * ルート実身配置要求をvirtual-object-listに送信
     */
    async requestRootInsertion() {
        logger.info('[UnpackFile] ルート実身配置要求を送信');

        if (this.archiveFiles.length === 0) {
            logger.error('[UnpackFile] 解凍されたファイルがありません');
            return;
        }

        // ルート実身（最初のファイル）の情報を取得
        const rootFile = this.archiveFiles[0];

        // applist情報を準備（標準的な実身管理用セグメント構造と同じ）
        // calcRecordTypesは配列なので、1が含まれるかで判定
        const rootCalcTypes = rootFile.calcRecordTypes || [];
        const isRootCalcTad = Array.isArray(rootCalcTypes) && rootCalcTypes.includes(1);
        let applist = {};
        if (isRootCalcTad) {
            applist = {
                "basic-text-editor": {
                    name: "基本文章編集",
                    defaultOpen: false
                },
                "basic-calc-editor": {
                    name: "基本表計算",
                    defaultOpen: true
                },"virtual-object-list": {
                    name: "仮身一覧",
                    defaultOpen: false
                }
            };
        } else {
            applist = {
                "virtual-object-list": {
                    name: "仮身一覧",
                    defaultOpen: true
                },
                "basic-text-editor": {
                    name: "基本文章編集",
                    defaultOpen: false
                },
                "basic-figure-editor": {
                    name: "基本図形編集",
                    defaultOpen: false
                }
            }
        }

        

        // MessageBus Phase 2: messageBus.send()を使用
        // virtual-object-listにルート実身配置を要求
        this.messageBus.send('insert-root-virtual-object', {
            rootFileData: {
                fileId: rootFile.fileId,
                name: rootFile.name,
                applist: applist  // applist情報を追加
            },
            x: this.pendingDropPosition.x,
            y: this.pendingDropPosition.y,
            targetWindowId: this.pendingDragData.sourceWindowId,  // ドロップ元のvirtual-object-listウィンドウID
            sourceWindowId: this.windowId  // 送信元（unpack-file）のウィンドウID
        });
    }

    /**
     * ルート実身配置完了後、tadjs-desktopに全実身ファイルセット情報を送信
     */
    async handleRootInsertionComplete() {
        logger.info('[UnpackFile] ルート実身配置完了、ファイルセット情報を送信');

        // 全実身ファイルセット情報をtadjs-desktopに送信
        await this.generateAndSendRealFiles();
    }

    /**
     * ルート実身の仮身を表示（初期表示時）
     */
    renderRootVirtualObject() {
        const listElement = document.getElementById('archiveFileList');
        if (!listElement) return;

        listElement.innerHTML = '';

        if (this.archiveFiles.length === 0) {
            const emptyMessage = document.createElement('div');
            emptyMessage.className = 'empty-message';
            emptyMessage.textContent = '書庫ファイルが見つかりません';
            listElement.appendChild(emptyMessage);
            return;
        }

        // ルート実身のみを仮身として表示
        const rootFile = this.archiveFiles[0];
        const vobjElement = this.createVirtualObject(rootFile, 0);
        listElement.appendChild(vobjElement);

        logger.info(`[UnpackFile] ルート実身の仮身を表示: ${rootFile.name}`);
    }

    /**
     * 書庫内の実身を仮身形式で表示
     */
    renderArchiveFiles() {
        const listElement = document.getElementById('archiveFileList');
        if (!listElement) return;

        listElement.innerHTML = '';

        if (this.archiveFiles.length === 0) {
            const emptyMessage = document.createElement('div');
            emptyMessage.className = 'empty-message';
            emptyMessage.textContent = '書庫ファイルが見つかりません';
            listElement.appendChild(emptyMessage);
            return;
        }

        // 各実身を仮身として表示
        this.archiveFiles.forEach((file, index) => {
            const vobjElement = this.createVirtualObject(file, index);
            listElement.appendChild(vobjElement);
        });

        logger.info(`[UnpackFile] ${this.archiveFiles.length}個の実身を表示`);
    }

    /**
     * 仮身要素を作成
     */
    createVirtualObject(file, index) {
        const vobj = document.createElement('div');
        vobj.className = 'archive-file-vobj';
        vobj.dataset.index = index;
        vobj.draggable = true;

        // 仮身枠
        vobj.style.border = '1px solid #000000';
        vobj.style.backgroundColor = '#ffffff';
        vobj.style.padding = '6px 12px';
        vobj.style.margin = '8px 0';
        vobj.style.cursor = 'move';
        vobj.style.display = 'inline-block';
        vobj.style.minWidth = '200px';
        vobj.style.textAlign = 'center';

        // タイトル
        const title = document.createElement('span');
        title.className = 'archive-file-title';
        title.textContent = file.name;
        title.style.fontSize = '14px';
        title.style.color = '#000000';

        vobj.appendChild(title);

        // ドラッグ開始イベント
        vobj.addEventListener('dragstart', (e) => {
            this.handleDragStart(e, file, index);
        });

        // ドラッグ終了イベント
        vobj.addEventListener('dragend', (e) => {
            this.handleDragEnd(e);
        });

        return vobj;
    }

    /**
     * ドラッグ開始処理
     */
    async handleDragStart(event, file, index) {
        logger.info('[UnpackFile] ドラッグ開始:', file.name);
        logger.info('[UnpackFile] ドラッグ開始時のファイル情報:', file);

        // ドラッグデータを設定（ルート実身も含む）
        const dragData = {
            type: 'archive-file-extract',
            source: 'unpack-file',
            windowId: this.windowId, // unpack-fileのウィンドウIDを追加
            file: {
                fileId: file.fileId,
                f_id: file.f_id,
                name: file.name,
                recordIndex: file.recordIndex,
                xmlData: file.xmlData // XMLデータを追加
            },
            fileIdMap: Array.from(this.fileIdMap.entries()), // Map to Array for JSON
            allFiles: this.archiveFiles, // 全ファイル情報を追加
            rawData: this.rawData ? Array.from(this.rawData) : null // rawDataを配列として追加（JSON化のため）
        };

        logger.info('[UnpackFile] this.rawData:', this.rawData ? `存在（長さ: ${this.rawData.length}）` : 'null');

        logger.info('[UnpackFile] ドラッグデータ:', dragData);
        logger.info('[UnpackFile] ドラッグデータのxmlData:', dragData.file.xmlData ? `存在（長さ: ${dragData.file.xmlData.length}）` : 'null');

        event.dataTransfer.setData('text/plain', JSON.stringify(dragData));
        event.dataTransfer.effectAllowed = 'copy';

        // ドラッグ中のスタイル
        event.target.style.opacity = '0.5';
    }

    /**
     * ドラッグ終了処理
     */
    handleDragEnd(event) {
        logger.info('[UnpackFile] ドラッグ終了');

        // スタイルを元に戻す
        event.target.style.opacity = '1';
    }

    /**
     * ウィンドウ設定（位置・サイズ・最大化状態）を更新
     * @param {Object} windowConfig - { pos: {x, y}, width, height, maximize }
     */
    updateWindowConfig(windowConfig) {
        if (this.realId) {
            // MessageBus Phase 2: messageBus.send()を使用
            this.messageBus.send('update-window-config', {
                fileId: this.realId,
                windowConfig: windowConfig
            });

            logger.info('[UnpackFile] ウィンドウ設定を更新:', windowConfig);
        }
    }
}

// DOMContentLoaded後に初期化
document.addEventListener('DOMContentLoaded', () => {
    window.unpackFileManager = new UnpackFileManager();
});
