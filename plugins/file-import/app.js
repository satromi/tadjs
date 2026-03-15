/**
 * ファイル取込プラグイン
 * 外部ファイルを実身として取り込むためのプラグイン
 *
 * @module FileImport
 * @extends PluginBase
 * @license MIT
 * @author satromi
 * @version 1.0.0
 */
const logger = window.getLogger('FileImport');

class FileImportApp extends window.PluginBase {
    constructor() {
        super('FileImport');
        logger.info('[FileImport] 初期化開始');

        this.selectedFiles = [];
        // this.windowId は PluginBase で定義済み

        // MessageBusはPluginBaseで初期化済み
        if (this.messageBus) {
            this.setupMessageBusHandlers();
        }

        // DOM要素の取得
        this.dropZone = document.getElementById('drop-zone');
        this.selectButton = document.getElementById('select-button');
        this.fileInput = document.getElementById('file-input');
        this.fileList = document.getElementById('file-list');
        this.fileItems = document.getElementById('file-items');
        this.importButton = document.getElementById('import-button');
        this.cancelButton = document.getElementById('cancel-button');

        // イベントリスナーの設定
        this.setupEventListeners();

        // 右クリックメニュー（PluginBase共通）
        this.setupContextMenu();

        // ウィンドウアクティベーション（PluginBase共通）
        this.setupWindowActivation();

        logger.info('[FileImport] 初期化完了');
    }

    /**
     * MessageBusハンドラを設定
     */
    setupMessageBusHandlers() {
        // 共通ハンドラを登録
        this.setupCommonMessageBusHandlers();

        // 初期化メッセージ
        this.messageBus.on('init', (data) => {
            logger.info('[FileImport] init受信', data);
            // 共通初期化処理（windowId設定、スクロール状態送信）
            this.onInit(data);
        });

        // ファイル取り込み完了メッセージ
        this.messageBus.on('files-imported', (data) => {
            logger.info('[FileImport] files-imported受信', data);
            if (data.success) {
                // 成功したらウィンドウを閉じる
                this.closeWindow();
            } else {
                logger.error('[FileImport] ファイル取り込みに失敗しました:', data.error);
                // エラーメッセージを表示（簡易実装）
                alert('ファイル取り込みに失敗しました: ' + (data.error || '不明なエラー'));
            }
        });
    }

    /**
     * メニュー定義（空）
     */
    getMenuDefinition() {
        return [];
    }

    /**
     * メニューアクション（なし）
     */
    executeMenuAction(action) {
        // ファイル取込プラグインはメニューアクションなし
    }

    /**
     * イベントリスナーを設定
     */
    setupEventListeners() {
        // ファイル選択ボタン
        this.selectButton.addEventListener('click', (e) => {
            e.stopPropagation();
            this.fileInput.click();
        });

        // ドロップゾーンクリック
        this.dropZone.addEventListener('click', () => {
            this.fileInput.click();
        });

        // ファイル入力変更
        this.fileInput.addEventListener('change', (e) => {
            this.handleFilesSelected(e.target.files);
        });

        // ドラッグ&ドロップ
        this.dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.dropZone.classList.add('drag-over');
        });

        this.dropZone.addEventListener('dragleave', () => {
            this.dropZone.classList.remove('drag-over');
        });

        this.dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            this.dropZone.classList.remove('drag-over');
            this.handleFilesSelected(e.dataTransfer.files);
        });

        // 取り込みボタン
        this.importButton.addEventListener('click', () => {
            this.importFiles();
        });

        // キャンセルボタン
        this.cancelButton.addEventListener('click', () => {
            this.closeWindow();
        });
    }

    /**
     * ファイルが選択された時の処理
     * @param {FileList} files - 選択されたファイル
     */
    handleFilesSelected(files) {
        logger.info('[FileImport] ファイル選択:', files.length, '個');

        // FileListを配列に変換して追加
        const filesArray = Array.from(files);
        this.selectedFiles.push(...filesArray);

        // ファイルリストを更新
        this.updateFileList();
    }

    /**
     * ファイルリストを更新
     */
    updateFileList() {
        // ファイルリストが空の場合は非表示
        if (this.selectedFiles.length === 0) {
            this.fileList.style.display = 'none';
            this.importButton.disabled = true;
            return;
        }

        // ファイルリストを表示
        this.fileList.style.display = 'block';
        this.importButton.disabled = false;

        // ファイルアイテムをクリア
        this.fileItems.innerHTML = '';

        // 各ファイルを表示
        this.selectedFiles.forEach((file, index) => {
            const item = this.createFileItem(file, index);
            this.fileItems.appendChild(item);
        });
    }

    /**
     * ファイルアイテムのDOM要素を作成
     * @param {File} file - ファイル
     * @param {number} index - インデックス
     * @returns {HTMLElement} ファイルアイテム要素
     */
    createFileItem(file, index) {
        const item = document.createElement('div');
        item.className = 'file-item';

        // アイコン
        const icon = document.createElement('div');
        icon.className = 'file-item-icon';
        icon.textContent = this.getFileIcon(file.name);

        // 情報
        const info = document.createElement('div');
        info.className = 'file-item-info';

        const name = document.createElement('div');
        name.className = 'file-item-name';
        name.textContent = file.name;

        const size = document.createElement('div');
        size.className = 'file-item-size';
        size.textContent = this.formatFileSize(file.size);

        info.appendChild(name);
        info.appendChild(size);

        // 削除ボタン
        const removeButton = document.createElement('button');
        removeButton.className = 'file-item-remove';
        removeButton.textContent = '削除';
        removeButton.addEventListener('click', () => {
            this.removeFile(index);
        });

        item.appendChild(icon);
        item.appendChild(info);
        item.appendChild(removeButton);

        return item;
    }

    /**
     * ファイル拡張子からアイコンを取得
     * @param {string} fileName - ファイル名
     * @returns {string} アイコン絵文字
     */
    getFileIcon(fileName) {
        const ext = fileName.split('.').pop().toLowerCase();

        // BPK/bpkファイル
        if (ext === 'bpk') {
            return '📦';
        }

        // 画像ファイル
        if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp'].includes(ext)) {
            return '🖼️';
        }

        // テキストファイル
        if (['txt', 'md', 'log'].includes(ext)) {
            return '📄';
        }

        // PDFファイル
        if (ext === 'pdf') {
            return '📕';
        }

        // 音声ファイル
        if (['mp3', 'wav', 'ogg', 'flac'].includes(ext)) {
            return '🎵';
        }

        // 動画ファイル
        if (['mp4', 'avi', 'mov', 'mkv', 'webm'].includes(ext)) {
            return '🎬';
        }

        // アーカイブファイル
        if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
            return '🗜️';
        }

        // その他
        return '📎';
    }

    /**
     * ファイルサイズをフォーマット
     * @param {number} bytes - バイト数
     * @returns {string} フォーマットされたサイズ
     */
    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';

        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));

        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }

    /**
     * ファイルを削除
     * @param {number} index - ファイルのインデックス
     */
    removeFile(index) {
        this.selectedFiles.splice(index, 1);
        this.updateFileList();
    }

    /**
     * ファイルを取り込み
     */
    async importFiles() {
        if (this.selectedFiles.length === 0) {
            logger.warn('[FileImport] ファイルが選択されていません');
            return;
        }

        logger.info('[FileImport] ファイルを取り込みます:', this.selectedFiles.length, '個');

        // 親ウィンドウにファイルを送信
        // File オブジェクトはpostMessageでシリアライズできないため、
        // Electron環境ではwebUtils.getPathForFile()でファイルパスを取得して送信する
        // （D&Dと同じ方式: 受信側でfsから非同期読み込み）
        if (this.messageBus) {
            const fileInfos = [];

            // Electron環境ではwebUtilsでファイルパスを取得（Electron 23+対応）
            let webUtils = null;
            try {
                webUtils = require('electron').webUtils;
            } catch (e) {
                // Web環境ではrequireが使えない
            }

            for (const file of this.selectedFiles) {
                try {
                    // webUtils.getPathForFile()でファイルパスを取得（D&Dと同じ方式）
                    let filePath = null;
                    if (webUtils) {
                        try {
                            filePath = webUtils.getPathForFile(file);
                        } catch (e) {
                            filePath = file.path || null;
                        }
                    } else {
                        filePath = file.path || null;
                    }

                    const fileInfo = {
                        name: file.name,
                        size: file.size,
                        type: file.type,
                        path: filePath,
                        lastModified: file.lastModified
                    };

                    // パスが取得できない場合のみBase64エンコード（Web環境フォールバック）
                    if (!filePath) {
                        const arrayBuffer = await file.arrayBuffer();
                        const uint8Array = new Uint8Array(arrayBuffer);
                        let binary = '';
                        const len = uint8Array.byteLength;
                        for (let i = 0; i < len; i++) {
                            binary += String.fromCharCode(uint8Array[i]);
                        }
                        fileInfo.base64Data = btoa(binary);
                    }

                    fileInfos.push(fileInfo);
                } catch (error) {
                    logger.error('[FileImport] ファイル読み込みエラー:', file.name, error);
                }
            }

            logger.info('[FileImport] ファイル情報を送信:', fileInfos.length, '個');

            this.messageBus.send('import-files', {
                files: fileInfos,
                windowId: this.windowId
            });
        }
    }

    /**
     * ウィンドウを閉じる
     */
    closeWindow() {
        logger.info('[FileImport] ウィンドウを閉じます');

        if (this.messageBus) {
            this.messageBus.send('close-window', {
                windowId: this.windowId
            });
        }
    }
}

// DOMContentLoaded後に初期化
document.addEventListener('DOMContentLoaded', () => {
    window.fileImportApp = new FileImportApp();
});
