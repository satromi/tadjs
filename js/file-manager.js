/**
 * FileManager - ファイル操作管理クラス
 * TADjs Desktopのファイル読み込み・保存を担当
 */

import { getLogger } from './logger.js';

const logger = getLogger('FileManager');

export class FileManager {
    /**
     * @param {Object} options - 初期化オプション
     * @param {boolean} options.isElectronEnv - Electron環境かどうか
     * @param {string} options.basePath - ベースパス
     * @param {Object} options.fs - Node.js fsモジュール (Electron環境のみ)
     * @param {Object} options.path - Node.js pathモジュール (Electron環境のみ)
     * @param {Object} options.process - Node.js processオブジェクト (Electron環境のみ)
     */
    constructor(options = {}) {
        this.isElectronEnv = options.isElectronEnv || false;
        this.basePath = options.basePath || '';
        this.fs = options.fs;
        this.path = options.path;
        this.process = options.process;

        logger.debug('FileManager initialized', { isElectronEnv: this.isElectronEnv, basePath: this.basePath });
    }

    /**
     * ベースパスを取得
     * @returns {string} ベースパス
     */
    getDataBasePath() {
        return this.basePath;
    }

    /**
     * ベースパスを設定
     * @param {string} basePath - 新しいベースパス
     */
    setDataBasePath(basePath) {
        this.basePath = basePath;
        logger.info('[FileManager] ベースパス設定:', basePath);
    }

    /**
     * 画像ファイルの絶対パスを取得
     * @param {string} fileName - ファイル名
     * @returns {string} 絶対パス
     */
    getImageFilePath(fileName) {
        if (this.isElectronEnv) {
            if (!this.basePath) {
                logger.error('[FileManager] basePath が設定されていません！fileName:', fileName);
                return fileName; // フォールバック
            }
            const fullPath = this.path.join(this.basePath, fileName);
            logger.debug('[FileManager] getImageFilePath:', fileName, '->', fullPath);
            return fullPath;
        }
        return fileName;
    }

    /**
     * データファイルを読み込む
     * @param {string} basePath - ベースパス
     * @param {string} fileName - ファイル名
     * @returns {Promise<{success: boolean, data?: string, error?: string}>}
     */
    async loadDataFile(basePath, fileName) {
        // Electron環境の場合
        if (this.isElectronEnv) {
            const filePath = this.path.join(basePath, fileName);

            try {
                logger.debug('[FileManager] ファイルを読み込み:', filePath);

                if (!this.fs.existsSync(filePath)) {
                    return {
                        success: false,
                        error: `ファイルが見つかりません: ${filePath}`
                    };
                }

                const data = this.fs.readFileSync(filePath, 'utf8');
                return { success: true, data };
            } catch (error) {
                return {
                    success: false,
                    error: `ファイル読み込みエラー: ${error.message}`
                };
            }
        }

        // ブラウザ環境の場合: HTTP fetch
        try {
            const url = `/${fileName}`;
            const response = await fetch(url);

            if (response.ok) {
                const data = await response.text();
                return { success: true, data };
            } else {
                return {
                    success: false,
                    error: `HTTP ${response.status}: ${response.statusText}`
                };
            }
        } catch (error) {
            return {
                success: false,
                error: `Fetch エラー: ${error.message}`
            };
        }
    }

    /**
     * データファイルをFileオブジェクトとして読み込む
     * @param {string} fileName - ファイル名
     * @returns {Promise<File|null>} Fileオブジェクト、見つからない場合null
     */
    async loadDataFileAsFile(fileName) {
        // Electron環境の場合
        if (this.isElectronEnv) {
            const basePath = this.basePath;

            // exe置き場フォルダから探す
            let filePath = this.path.join(basePath, fileName);

            if (this.fs.existsSync(filePath)) {
                logger.debug('[FileManager] ファイルを読み込み:', filePath);
                const buffer = this.fs.readFileSync(filePath);
                const blob = new Blob([buffer]);
                return new File([blob], fileName, { type: 'application/octet-stream' });
            }

            // resources/appから探す
            if (this.process.resourcesPath) {
                filePath = this.path.join(this.process.resourcesPath, 'app', fileName);
                if (this.fs.existsSync(filePath)) {
                    logger.debug('[FileManager] ファイルを読み込み:', filePath);
                    const buffer = this.fs.readFileSync(filePath);
                    const blob = new Blob([buffer]);
                    return new File([blob], fileName, { type: 'application/octet-stream' });
                }
            }

            logger.error('[FileManager] ファイルが見つかりません:', fileName);
            return null;
        }

        // ブラウザ環境の場合: HTTP fetch
        try {
            const url = `/${fileName}`;
            const response = await fetch(url);

            if (response.ok) {
                const blob = await response.blob();
                return new File([blob], fileName, { type: 'application/octet-stream' });
            } else {
                logger.error('[FileManager] HTTP fetch失敗:', response.status, response.statusText);
                return null;
            }
        } catch (error) {
            logger.error('[FileManager] Fetch エラー:', error);
            return null;
        }
    }

    /**
     * 外部ファイルをOSのデフォルトアプリで開く
     * @param {string} realId - 実身ID
     * @param {string} extension - ファイル拡張子
     * @returns {Promise<{success: boolean, error?: string}>} 結果
     */
    async openExternalFile(realId, extension) {
        // Electron環境の場合のみ動作
        if (this.isElectronEnv) {
            const { shell } = require('electron');
            const basePath = this.basePath;

            // 実身ID + 拡張子でファイル名を構築
            const fileName = `${realId}.${extension}`;
            let filePath = this.path.join(basePath, fileName);

            logger.debug('[FileManager] 外部ファイルを探します:', fileName);

            if (this.fs.existsSync(filePath)) {
                logger.debug('[FileManager] 外部ファイルを開きます:', filePath);
                try {
                    const result = await shell.openPath(filePath);
                    if (result) {
                        // 空文字列以外が返された場合はエラー
                        logger.error('[FileManager] ファイルを開けませんでした:', result);
                        return { success: false, error: result };
                    }
                    logger.debug('[FileManager] 外部ファイルを開きました:', filePath);
                    return { success: true };
                } catch (error) {
                    logger.error('[FileManager] ファイルを開くエラー:', error);
                    return { success: false, error: error.message };
                }
            }

            logger.error('[FileManager] ファイルが見つかりません:', fileName);
            return { success: false, error: `ファイルが見つかりません: ${fileName}` };
        }

        // ブラウザ環境では動作しない
        logger.warn('[FileManager] 外部ファイルを開く機能はElectron環境でのみ動作します');
        return { success: false, error: 'Electron環境でのみ動作します' };
    }

    /**
     * xtadファイルからテキストを読み取る
     * @param {string} realId - 実身ID
     * @returns {Promise<{success: boolean, text?: string, error?: string}>} 結果
     */
    async readXtadText(realId) {
        // Electron環境の場合のみ動作
        if (this.isElectronEnv) {
            const basePath = this.basePath;

            // xtadファイルのパスを構築
            // realIdが既に_0.xtadで終わっている場合はそのまま使用
            let xtadPath;
            if (realId.endsWith('_0.xtad') || realId.endsWith('.xtad')) {
                xtadPath = this.path.join(basePath, realId);
            } else {
                xtadPath = this.path.join(basePath, `${realId}_0.xtad`);
            }

            if (!this.fs.existsSync(xtadPath)) {
                logger.error('[FileManager] xtadファイルが見つかりません:', xtadPath);
                return { success: false, error: 'xtadファイルが見つかりません' };
            }

            try {
                logger.debug('[FileManager] xtadファイルを読み込みます:', xtadPath);
                const xmlContent = this.fs.readFileSync(xtadPath, 'utf-8');

                // XMLからテキストを抽出
                // 1. <text>タグの内容を取得
                let text = '';
                const textMatch = xmlContent.match(/<text>([\s\S]*?)<\/text>/);
                if (textMatch) {
                    text = textMatch[1].trim();
                } else {
                    // 2. <document>タグ内の<p>タグからテキストを抽出
                    const documentMatch = xmlContent.match(/<document>([\s\S]*?)<\/document>/);
                    if (documentMatch) {
                        const documentContent = documentMatch[1];
                        // すべての<p>タグからテキストを抽出
                        const pMatches = documentContent.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g);
                        const lines = [];
                        for (const match of pMatches) {
                            // HTMLタグを除去してテキストのみを抽出
                            let lineText = match[1]
                                .replace(/<br\s*\/?>/gi, '')
                                .replace(/<[^>]+>/g, '')
                                .trim();
                            if (lineText) {
                                lines.push(lineText);
                            }
                        }
                        text = lines.join('\n');
                    }
                }

                logger.debug('[FileManager] xtadテキストを読み取りました:', text.substring(0, 100));
                return { success: true, text: text };
            } catch (error) {
                logger.error('[FileManager] xtadファイルを読み込むエラー:', error);
                return { success: false, error: error.message };
            }
        }

        // ブラウザ環境では動作しない
        logger.warn('[FileManager] xtadファイルを読み込む機能はElectron環境でのみ動作します');
        return { success: false, error: 'Electron環境でのみ動作します' };
    }

    /**
     * URLをブラウザで開く
     * @param {string} url - 開くURL
     * @returns {Promise<{success: boolean, error?: string}>} 結果
     */
    async openUrlExternal(url) {
        // Electron環境の場合のみ動作
        if (this.isElectronEnv) {
            const { shell } = require('electron');

            try {
                logger.debug('[FileManager] URLを開きます:', url);
                await shell.openExternal(url);
                logger.debug('[FileManager] URLを開きました:', url);
                return { success: true };
            } catch (error) {
                logger.error('[FileManager] URLを開くエラー:', error);
                return { success: false, error: error.message };
            }
        }

        // ブラウザ環境では動作しない
        logger.warn('[FileManager] URLを開く機能はElectron環境でのみ動作します');
        return { success: false, error: 'Electron環境でのみ動作します' };
    }

    /**
     * フォルダへのアクセス権限を検証
     * @param {string} folderPath - 検証するフォルダのパス
     * @returns {{success: boolean, error?: string}} 検証結果
     */
    checkFolderAccess(folderPath) {
        try {
            // フォルダが存在するかチェック
            if (!this.fs.existsSync(folderPath)) {
                // 存在しない場合は作成を試みる
                try {
                    this.fs.mkdirSync(folderPath, { recursive: true });
                    logger.debug('[FileManager] データフォルダを作成:', folderPath);
                } catch (createError) {
                    return {
                        success: false,
                        error: `フォルダを作成できません: ${createError.message}`
                    };
                }
            }

            // 読み取り権限のチェック
            try {
                this.fs.accessSync(folderPath, this.fs.constants.R_OK);
            } catch (error) {
                return {
                    success: false,
                    error: 'フォルダに読み取り権限がありません'
                };
            }

            // 書き込み権限のチェック
            try {
                this.fs.accessSync(folderPath, this.fs.constants.W_OK);
            } catch (error) {
                return {
                    success: false,
                    error: 'フォルダに書き込み権限がありません'
                };
            }

            // テストファイルの書き込み/削除で実際の権限を確認
            const testFilePath = this.path.join(folderPath, `.tadjs-access-test-${Date.now()}`);
            try {
                this.fs.writeFileSync(testFilePath, 'test', 'utf-8');
                this.fs.unlinkSync(testFilePath);
            } catch (error) {
                return {
                    success: false,
                    error: `フォルダへの書き込みテストに失敗: ${error.message}`
                };
            }

            return { success: true };
        } catch (error) {
            return {
                success: false,
                error: `フォルダアクセスチェックに失敗: ${error.message}`
            };
        }
    }

    /**
     * アイコンファイルのパスを取得する
     * @param {string} realId - 実身ID
     * @returns {Promise<{success: boolean, filePath?: string, error?: string}>} アイコンファイルのパス
     */
    async readIconFile(realId) {
        // Electron環境の場合のみ動作
        if (this.isElectronEnv) {
            const basePath = this.basePath;
            const iconPath = this.path.join(basePath, `${realId}.ico`);

            try {
                // アイコンファイルが存在するかチェック
                if (!this.fs.existsSync(iconPath)) {
                    logger.debug('[FileManager] アイコンファイルが見つかりません:', iconPath);
                    return { success: false, error: 'Icon file not found' };
                }

                return { success: true, filePath: iconPath };
            } catch (error) {
                logger.error('[FileManager] アイコンファイルパス取得エラー:', error);
                return { success: false, error: error.message };
            }
        }

        // ブラウザ環境では動作しない
        logger.warn('[FileManager] アイコンファイル読み込み機能はElectron環境でのみ動作します');
        return { success: false, error: 'Electron環境でのみ動作します' };
    }

    /**
     * データファイルを保存する
     * @param {string} fileName - ファイル名
     * @param {string|ArrayBuffer|Uint8Array} data - 保存するデータ
     * @returns {Promise<boolean>} 成功した場合true
     */
    async saveDataFile(fileName, data) {
        // Electron環境の場合
        if (this.isElectronEnv) {
            const basePath = this.basePath;
            const filePath = this.path.join(basePath, fileName);

            try {
                logger.debug('[FileManager] ファイルを保存:', filePath);

                // データをBufferに変換
                let buffer;
                if (typeof data === 'string') {
                    buffer = Buffer.from(data, 'utf8');
                } else if (data instanceof Uint8Array) {
                    buffer = Buffer.from(data);
                } else if (data instanceof ArrayBuffer) {
                    buffer = Buffer.from(new Uint8Array(data));
                } else {
                    buffer = Buffer.from(data);
                }

                this.fs.writeFileSync(filePath, buffer);
                logger.debug('[FileManager] ファイル保存成功:', filePath);
                return true;
            } catch (error) {
                logger.error('[FileManager] ファイル保存エラー:', error);
                return false;
            }
        }

        // ブラウザ環境では保存不可
        logger.warn('[FileManager] ブラウザ環境ではファイル保存はサポートされていません');
        return false;
    }
}
