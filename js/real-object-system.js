import {
    DEFAULT_TIMEOUT_MS,
    LONG_OPERATION_TIMEOUT_MS,
    LOAD_DATA_FILE_TIMEOUT_MS,
    DEFAULT_FRCOL,
    DEFAULT_CHCOL,
    DEFAULT_TBCOL,
    DEFAULT_BGCOL,
    DEFAULT_FONT_SIZE
} from './util.js';
import { getLogger } from './logger.js';

const logger = getLogger('RealObjectSystem');

/**
 * 実身仮身システム - ファイル直接アクセス版
 * IndexedDBを使わず、ファイルシステムから直接読み書き
 */
export class RealObjectSystem {
    constructor(dataFolder = null) {
        logger.info('初期化（ファイル直接アクセスモード）');

        // Electron環境チェック（コンストラクタで1回だけ）
        this.isElectronEnv = typeof require !== 'undefined' && typeof process !== 'undefined' && process.versions && process.versions.electron;

        if (!this.isElectronEnv) {
            logger.warn('Electron環境ではありません。一部の機能は使用できません。');
            this.fs = null;
            this.path = null;
            this.crypto = null;
            this.process = null;
            this._basePath = '.';
            return;
        }

        // 依存関係を事前に解決（require呼び出しは1回だけ）
        this.fs = require('fs');
        this.path = require('path');
        this.crypto = require('crypto');
        this.process = require('process');

        // データフォルダが指定されている場合はそれを使用、なければ計算
        if (dataFolder) {
            this._basePath = dataFolder;
            logger.info(`データフォルダを使用: ${this._basePath}`);
        } else {
            this._basePath = this._calculateBasePath();
            logger.info(`basePath（デフォルト）: ${this._basePath}`);
        }
    }

    /**
     * ベースパスを計算（private）
     */
    _calculateBasePath() {
        if (this.process.resourcesPath) {
            // パッケージ化されている場合
            return this.path.dirname(this.process.execPath);
        } else {
            // 開発時
            return this.path.dirname(require.main.filename);
        }
    }

    /**
     * データファイルのベースパスを取得
     */
    getDataBasePath() {
        return this._basePath;
    }

    /**
     * 実身の読み込み（ファイルから直接）
     * @param {string} realId 実身ID
     * @returns {Promise<Object>} { metadata, records: [{ xtad, images: [] }, ...] }
     */
    async loadRealObject(realId) {
        if (!this.isElectronEnv) {
            throw new Error('ファイルシステムアクセスにはElectron環境が必要です');
        }

        const basePath = this._basePath;

        logger.debug(`実身読み込み: ${realId}`);

        // メタデータ読み込み
        const jsonPath = this.path.join(basePath, `${realId}.json`);
        logger.debug(`basePath: ${basePath}`);
        logger.debug(`jsonPath: ${jsonPath}`);

        if (!this.fs.existsSync(jsonPath)) {
            throw new Error(`実身が見つかりません: ${realId}`);
        }

        const jsonContent = this.fs.readFileSync(jsonPath, 'utf-8');
        logger.debug(`JSON内容: ${jsonContent.substring(0, 200)}`);

        const metadata = JSON.parse(jsonContent);
        logger.debug(`パース後のmetadata:`, JSON.stringify(metadata, null, 2).substring(0, 300));
        metadata.realId = realId;

        // recordCount が存在しない場合は、実際にファイルを確認してカウント
        if (metadata.recordCount === undefined || metadata.recordCount === null) {
            logger.debug(`recordCount未定義、ファイルシステムから検索します`);
            let count = 0;
            while (true) {
                const xtadPath = this.path.join(basePath, `${realId}_${count}.xtad`);
                if (this.fs.existsSync(xtadPath)) {
                    count++;
                } else {
                    break;
                }
            }
            metadata.recordCount = count;
            logger.debug(`検出されたレコード数: ${count}`);
        }

        logger.debug(`メタデータ読み込み: name=${metadata.name}, recordCount=${metadata.recordCount}`);

        // レコード読み込み
        const records = [];
        for (let recordNo = 0; recordNo < metadata.recordCount; recordNo++) {
            const xtadPath = this.path.join(basePath, `${realId}_${recordNo}.xtad`);

            if (this.fs.existsSync(xtadPath)) {
                // UTF-8文字列として読み込み
                const xtad = this.fs.readFileSync(xtadPath, 'utf-8');

                // バイナリとしても読み込み（プラグインがrawDataを必要とする場合）
                const rawBuffer = this.fs.readFileSync(xtadPath);
                const rawData = Array.from(rawBuffer);

                records.push({
                    xtad: xtad,           // UTF-8文字列
                    rawData: rawData,     // バイト配列
                    images: []
                });
                logger.debug(`レコード読み込み: ${realId}_${recordNo}.xtad (${xtad.length}文字, ${rawData.length}バイト)`);
            } else {
                logger.warn(`レコードファイルが見つかりません: ${xtadPath}`);
            }
        }

        logger.debug(`実身読み込み完了: ${realId} (${records.length}レコード)`);
        return { metadata, records };
    }

    /**
     * 実身の保存（ファイルに直接）
     * @param {string} realId 実身ID
     * @param {Object} realObject { metadata, records }
     */
    async saveRealObject(realId, realObject) {
        if (!this.isElectronEnv) {
            throw new Error('ファイルシステムアクセスにはElectron環境が必要です');
        }

        const basePath = this._basePath;

        logger.debug(`実身保存: ${realId}`);

        // メタデータ保存
        const jsonPath = this.path.join(basePath, `${realId}.json`);
        const metadata = { ...realObject.metadata };
        metadata.realId = realId;
        metadata.recordCount = realObject.records.length;

        this.fs.writeFileSync(jsonPath, JSON.stringify(metadata, null, 2), 'utf-8');
        logger.debug(`メタデータ保存: ${jsonPath}`);

        // レコード保存
        realObject.records.forEach((record, index) => {
            if (record.xtad) {
                const xtadPath = this.path.join(basePath, `${realId}_${index}.xtad`);
                this.fs.writeFileSync(xtadPath, record.xtad, 'utf-8');
                logger.debug(`レコード保存: ${xtadPath}`);
            }
        });

        logger.debug(`実身保存完了: ${realId}`);
    }

    /**
     * 実身の新規作成
     * @param {string} realName 実身名
     * @param {string} initialXtad 初期XTADデータ
     * @param {Object} applist アプリケーションリスト（オプション）
     * @param {Object} windowConfig ウィンドウ設定（オプション）
     * @returns {Promise<string>} 新しい実身ID
     */
    async createRealObject(realName, initialXtad, applist = null, windowConfig = null) {
        if (!this.isElectronEnv) {
            throw new Error('ファイルシステムアクセスにはElectron環境が必要です');
        }

        logger.debug(`実身新規作成: ${realName}`);

        // 新しいUUIDを生成
        const newRealId = this.generateUUIDv7();
        logger.debug(`新しい実身ID: ${newRealId}`);

        // メタデータを作成
        const now = new Date().toISOString();
        const metadata = {
            realId: newRealId,
            name: realName,
            refCount: 1,
            recordCount: 1,
            makeDate: now,
            updateDate: now,
            accessDate: now
        };

        // applistが指定されている場合は追加
        if (applist) {
            metadata.applist = applist;
        }

        // windowConfigが指定されている場合は追加
        if (windowConfig) {
            metadata.window = windowConfig;
        }

        // レコードを作成
        const records = [{
            xtad: initialXtad,
            images: []
        }];

        // 実身として保存
        const newRealObject = {
            metadata: metadata,
            records: records
        };

        await this.saveRealObject(newRealId, newRealObject);

        // デフォルトアイコンを生成
        this.generateDefaultIcon(newRealId);

        logger.debug(`実身新規作成完了: ${newRealId}`);
        return newRealId;
    }

    /**
     * 実身のコピー（再帰的コピー）
     * @param {string} sourceRealId コピー元の実身ID
     * @param {Map} idMap IDマッピング（再帰呼び出し用、省略可）
     * @returns {Promise<string>} 新しい実身ID
     */
    async copyRealObject(sourceRealId, idMap = null) {
        if (!this.isElectronEnv) {
            throw new Error('ファイルシステムアクセスにはElectron環境が必要です');
        }

        // 初回呼び出しの場合、idMapを作成
        const isRootCall = !idMap;
        if (!idMap) {
            idMap = new Map();
        }

        // 既にコピー済みの場合は、新しいIDを返す
        if (idMap.has(sourceRealId)) {
            logger.debug(`既にコピー済み: ${sourceRealId} -> ${idMap.get(sourceRealId)}`);
            return idMap.get(sourceRealId);
        }

        logger.debug(`実身コピー: ${sourceRealId}`);

        // 元の実身を読み込む
        const sourceRealObject = await this.loadRealObject(sourceRealId);

        // 新しいUUIDを生成
        const newRealId = this.generateUUIDv7();
        logger.debug(`新しい実身ID: ${newRealId}`);

        // IDマッピングに登録（循環参照対策）
        idMap.set(sourceRealId, newRealId);

        // レコードをコピーして、参照実身も再帰的にコピー
        const newRecords = [];
        for (const record of sourceRealObject.records) {
            const newRecord = { ...record };

            if (record.xtad) {
                // XTADから仮身（<link>要素）を抽出
                const linkRegex = /<link[^>]*\sid="([^"]+)"[^>]*>/g;
                let match;
                let updatedXtad = record.xtad;
                const referencedIds = new Set();

                while ((match = linkRegex.exec(record.xtad)) !== null) {
                    const linkId = match[1];
                    // link_idから実身IDを抽出（_0.xtad を除去）
                    const refRealId = linkId.replace(/_\d+\.xtad$/i, '');
                    if (refRealId && !referencedIds.has(refRealId)) {
                        referencedIds.add(refRealId);
                    }
                }

                // 参照している実身を再帰的にコピー
                for (const refRealId of referencedIds) {
                    try {
                        const newRefRealId = await this.copyRealObject(refRealId, idMap);
                        logger.debug(`参照実身をコピー: ${refRealId} -> ${newRefRealId}`);

                        // XTADのlink_idを新しいIDに置き換え
                        const oldLinkIdPattern = new RegExp(refRealId.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g');
                        updatedXtad = updatedXtad.replace(oldLinkIdPattern, newRefRealId);
                    } catch (error) {
                        logger.warn(`参照実身のコピーに失敗（スキップ）: ${refRealId}`, error);
                    }
                }

                newRecord.xtad = updatedXtad;
            }

            newRecords.push(newRecord);
        }

        // メタデータをコピーして更新
        const newMetadata = { ...sourceRealObject.metadata };
        newMetadata.realId = newRealId;
        newMetadata.name = (sourceRealObject.metadata.name || '') + (isRootCall ? 'のコピー' : '');
        // 新規実身は作成時点で必ず1つのvobjから参照されるため、refCount = 1 で開始
        newMetadata.refCount = 1;
        newMetadata.makeDate = new Date().toISOString();
        newMetadata.updateDate = new Date().toISOString();
        newMetadata.accessDate = new Date().toISOString();

        // 新しい実身として保存
        const newRealObject = {
            metadata: newMetadata,
            records: newRecords
        };

        await this.saveRealObject(newRealId, newRealObject);

        // icoファイルもコピー（存在する場合のみ）
        // 再帰的にコピーされた実身のアイコンファイルもコピーする
        const basePath = this._basePath;
        const sourceIcoPath = this.path.join(basePath, `${sourceRealId}.ico`);
        const newIcoPath = this.path.join(basePath, `${newRealId}.ico`);

        logger.debug(`icoファイルコピー試行:`, {
            isRootCall: isRootCall,
            sourceRealId: sourceRealId,
            newRealId: newRealId,
            basePath: basePath,
            sourceIcoPath: sourceIcoPath,
            newIcoPath: newIcoPath,
            sourceExists: this.fs.existsSync(sourceIcoPath)
        });

        if (this.fs.existsSync(sourceIcoPath)) {
            try {
                this.fs.copyFileSync(sourceIcoPath, newIcoPath);
                const copySuccess = this.fs.existsSync(newIcoPath);
                logger.debug(`icoファイルコピー成功: ${sourceRealId}.ico -> ${newRealId}.ico`, {
                    copySuccess: copySuccess,
                    newIcoPath: newIcoPath
                });
            } catch (error) {
                logger.error(`icoファイルのコピーに失敗:`, error);
            }
        } else {
            logger.debug(`元のicoファイルが存在しません: ${sourceIcoPath}`);
        }

        // ピクセルマップのPNG画像ファイルもコピー（存在する場合のみ）
        // 基本図形編集プラグインで使用されるピクセルマップ画像
        // ファイル名パターン: realId_0_0.png, realId_0_1.png など
        try {
            const files = this.fs.readdirSync(basePath);
            const pngPattern = new RegExp(`^${sourceRealId.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}_\\d+_\\d+\\.png$`);

            for (const file of files) {
                if (pngPattern.test(file)) {
                    const sourcePngPath = this.path.join(basePath, file);
                    const newPngFile = file.replace(sourceRealId, newRealId);
                    const newPngPath = this.path.join(basePath, newPngFile);

                    try {
                        this.fs.copyFileSync(sourcePngPath, newPngPath);
                        logger.debug(`PNGファイルコピー成功: ${file} -> ${newPngFile}`);
                    } catch (error) {
                        logger.error(`PNGファイルのコピーに失敗: ${file}`, error);
                    }
                }
            }
        } catch (error) {
            logger.debug(`PNGファイルの検索中にエラー:`, error);
        }

        logger.debug(`実身コピー完了: ${sourceRealId} -> ${newRealId}`);
        return newRealId;
    }

    /**
     * 実身の非再帰的コピー（参照実身は複製せず、仮身のみコピー）
     * @param {string} sourceRealId コピー元の実身ID
     * @param {string} newName 新しい実身の名前
     * @returns {Promise<string>} 新しい実身ID
     */
    async copyRealObjectNonRecursive(sourceRealId, newName) {
        if (!this.isElectronEnv) {
            throw new Error('ファイルシステムアクセスにはElectron環境が必要です');
        }

        logger.debug(`実身非再帰的コピー: ${sourceRealId}, 新しい名前: ${newName}`);

        // 元の実身を読み込む
        const sourceRealObject = await this.loadRealObject(sourceRealId);

        // 新しいUUIDを生成
        const newRealId = this.generateUUIDv7();
        logger.debug(`新しい実身ID: ${newRealId}`);

        // レコードをコピー（参照実身は複製しない）
        const newRecords = [];
        for (const record of sourceRealObject.records) {
            const newRecord = { ...record };
            // XTADはそのままコピー（仮身のlink_idは変更しない）
            newRecords.push(newRecord);
        }

        // メタデータをコピーして更新
        const newMetadata = { ...sourceRealObject.metadata };
        newMetadata.realId = newRealId;
        newMetadata.name = newName;
        // 新規実身は作成時点で必ず1つのvobjから参照されるため、refCount = 1 で開始
        newMetadata.refCount = 1;
        // リネーム（別名保存）時は元のmakeDateを維持
        newMetadata.updateDate = new Date().toISOString();
        newMetadata.accessDate = new Date().toISOString();

        // 新しい実身として保存
        const newRealObject = {
            metadata: newMetadata,
            records: newRecords
        };

        await this.saveRealObject(newRealId, newRealObject);

        // icoファイルもコピー（存在する場合のみ）
        const basePath = this._basePath;
        const sourceIcoPath = this.path.join(basePath, `${sourceRealId}.ico`);
        const newIcoPath = this.path.join(basePath, `${newRealId}.ico`);

        logger.debug(`非再帰的コピー: icoファイルコピー試行:`, {
            sourceRealId: sourceRealId,
            newRealId: newRealId,
            basePath: basePath,
            sourceIcoPath: sourceIcoPath,
            newIcoPath: newIcoPath,
            sourceExists: this.fs.existsSync(sourceIcoPath)
        });

        if (this.fs.existsSync(sourceIcoPath)) {
            try {
                this.fs.copyFileSync(sourceIcoPath, newIcoPath);
                const copySuccess = this.fs.existsSync(newIcoPath);
                logger.debug(`非再帰的コピー: icoファイルコピー成功: ${sourceRealId}.ico -> ${newRealId}.ico`, {
                    copySuccess: copySuccess,
                    newIcoPath: newIcoPath
                });
            } catch (error) {
                logger.error(`非再帰的コピー: icoファイルのコピーに失敗:`, error);
            }
        } else {
            logger.warn(`非再帰的コピー: 元のicoファイルが存在しません: ${sourceIcoPath}`);
        }

        logger.debug(`実身非再帰的コピー完了: ${sourceRealId} -> ${newRealId}`);
        return newRealId;
    }

    /**
     * UUID v7を生成
     * @returns {string} UUID v7文字列
     */
    generateUUIDv7() {
        const timestamp = Date.now();
        const randomBytes = this.crypto.randomBytes(10);

        // タイムスタンプ（48ビット）
        const timestampHex = timestamp.toString(16).padStart(12, '0');
        const timeLow = timestampHex.substring(0, 8);
        const timeMid = timestampHex.substring(8, 12);

        // バージョン7とランダムデータ
        const timeHiAndVersion = (0x7000 | (randomBytes[0] << 8 | randomBytes[1]) & 0x0fff).toString(16).padStart(4, '0');
        const clockSeqAndVariant = (0x8000 | (randomBytes[2] << 8 | randomBytes[3]) & 0x3fff).toString(16).padStart(4, '0');
        const node = randomBytes.slice(4, 10).toString('hex');

        return `${timeLow}-${timeMid}-${timeHiAndVersion}-${clockSeqAndVariant}-${node}`;
    }

    /**
     * 仮身の削除（参照カウントを減らす）
     * @param {string} realId 実身ID
     */
    async deleteVirtualObject(realId) {
        if (!this.isElectronEnv) {
            throw new Error('ファイルシステムアクセスにはElectron環境が必要です');
        }

        const basePath = this._basePath;

        logger.debug(`仮身削除（refCount-1）: ${realId}`);

        // メタデータ読み込み
        const jsonPath = this.path.join(basePath, `${realId}.json`);
        if (!this.fs.existsSync(jsonPath)) {
            logger.warn(`メタデータが見つかりません: ${realId}`);
            return;
        }

        const metadata = JSON.parse(this.fs.readFileSync(jsonPath, 'utf-8'));

        // refCountを-1（0未満にはしない）
        const currentRefCount = metadata.refCount || 0;
        metadata.refCount = Math.max(0, currentRefCount - 1);

        // メタデータを保存
        this.fs.writeFileSync(jsonPath, JSON.stringify(metadata, null, 2), 'utf-8');
        logger.debug(`参照カウント更新: ${realId} ${currentRefCount} -> ${metadata.refCount}`);
    }

    /**
     * 実身の削除（ファイルを直接削除）
     * @param {string} realId 実身ID
     */
    async deleteRealObject(realId) {
        if (!this.isElectronEnv) {
            throw new Error('ファイルシステムアクセスにはElectron環境が必要です');
        }

        const basePath = this._basePath;

        logger.debug(`実身削除: ${realId}`);

        // メタデータ削除
        const jsonPath = this.path.join(basePath, `${realId}.json`);
        if (this.fs.existsSync(jsonPath)) {
            this.fs.unlinkSync(jsonPath);
            logger.debug(`メタデータ削除: ${jsonPath}`);
        }

        // レコード削除（すべてのレコードファイルを探して削除）
        let recordNo = 0;
        while (true) {
            const xtadPath = this.path.join(basePath, `${realId}_${recordNo}.xtad`);
            if (this.fs.existsSync(xtadPath)) {
                this.fs.unlinkSync(xtadPath);
                logger.debug(`レコード削除: ${xtadPath}`);
                recordNo++;
            } else {
                break;
            }
        }

        // アイコンファイル削除
        const icoPath = this.path.join(basePath, `${realId}.ico`);
        if (this.fs.existsSync(icoPath)) {
            this.fs.unlinkSync(icoPath);
            logger.debug(`アイコン削除: ${icoPath}`);
        }

        // PNG画像ファイル削除（realId_recordNo_imgNo.png パターン）
        try {
            const files = this.fs.readdirSync(basePath);
            const pngPattern = new RegExp(`^${realId.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}_\\d+_\\d+\\.png$`);
            let pngDeleteCount = 0;

            for (const file of files) {
                if (pngPattern.test(file)) {
                    const pngPath = this.path.join(basePath, file);
                    try {
                        this.fs.unlinkSync(pngPath);
                        logger.debug(`PNG画像削除: ${pngPath}`);
                        pngDeleteCount++;
                    } catch (error) {
                        logger.error(`PNG画像削除失敗: ${file}`, error);
                    }
                }
            }
            if (pngDeleteCount > 0) {
                logger.debug(`PNG画像ファイル ${pngDeleteCount} 個を削除`);
            }
        } catch (error) {
            logger.debug(`PNG画像ファイルの検索中にエラー:`, error);
        }

        logger.debug(`実身削除完了: ${realId} (${recordNo}レコード)`);
    }

    /**
     * 実身の参照カウント更新
     * （ファイルシステム版ではメタデータを読み込んで更新）
     * @param {string} realId 実身ID
     * @param {number} refCount 新しい参照カウント
     */
    async updateRefCount(realId, refCount) {
        if (!this.isElectronEnv) {
            throw new Error('ファイルシステムアクセスにはElectron環境が必要です');
        }

        const basePath = this._basePath;

        const jsonPath = this.path.join(basePath, `${realId}.json`);
        if (!this.fs.existsSync(jsonPath)) {
            logger.warn(`メタデータが見つかりません: ${realId}`);
            return;
        }

        const metadata = JSON.parse(this.fs.readFileSync(jsonPath, 'utf-8'));
        metadata.refCount = refCount;

        this.fs.writeFileSync(jsonPath, JSON.stringify(metadata, null, 2), 'utf-8');
        logger.debug(`参照カウント更新: ${realId} -> ${refCount}`);
    }

    /**
     * 仮身をコピー（参照カウントを増やす）
     * @param {string} realId - 実身ID
     */
    async copyVirtualObject(realId) {
        if (!this.isElectronEnv) {
            throw new Error('ファイルシステムアクセスにはElectron環境が必要です');
        }

        const basePath = this._basePath;
        const jsonPath = this.path.join(basePath, `${realId}.json`);

        if (!this.fs.existsSync(jsonPath)) {
            throw new Error(`メタデータが見つかりません: ${realId}`);
        }

        const metadata = JSON.parse(this.fs.readFileSync(jsonPath, 'utf-8'));
        const currentRefCount = metadata.refCount || 0;
        const newRefCount = currentRefCount + 1;

        await this.updateRefCount(realId, newRefCount);
        logger.debug(`仮身コピー完了: ${realId} (refCount: ${currentRefCount} -> ${newRefCount})`);
    }

    /**
     * 参照カウントを1増やす（copyVirtualObjectのエイリアス）
     * @param {string} realId - 実身ID
     */
    async incrementRefCount(realId) {
        await this.copyVirtualObject(realId);
    }

    /**
     * すべての実身のメタデータを取得
     * @returns {Promise<Array>} メタデータの配列
     */
    async getAllMetadata() {
        if (!this.isElectronEnv) {
            throw new Error('ファイルシステムアクセスにはElectron環境が必要です');
        }

        const basePath = this._basePath;

        const files = this.fs.readdirSync(basePath);
        const jsonFiles = files.filter(f => f.endsWith('.json'));

        const metadataList = [];
        for (const jsonFile of jsonFiles) {
            try {
                const jsonPath = this.path.join(basePath, jsonFile);
                const metadata = JSON.parse(this.fs.readFileSync(jsonPath, 'utf-8'));
                metadata.realId = jsonFile.replace('.json', '');

                // 実身のメタデータであることを確認（name フィールドが存在する）
                if (metadata.name !== undefined) {
                    metadataList.push(metadata);
                } else {
                    logger.debug(`実身ではないJSONファイルをスキップ: ${jsonFile}`);
                }
            } catch (error) {
                logger.warn(`メタデータ読み込みエラー: ${jsonFile}`, error);
            }
        }

        logger.debug(`メタデータ一覧取得: ${metadataList.length}件`);
        return metadataList;
    }

    /**
     * 参照カウントが0の実身一覧を取得
     * @returns {Promise<Array>} 参照カウント0の実身のメタデータ配列
     */
    async getUnreferencedRealObjects() {
        logger.debug('参照カウント0の実身一覧取得開始');

        const allMetadata = await this.getAllMetadata();
        const unreferencedObjects = allMetadata.filter(metadata => {
            const refCount = metadata.refCount || 0;
            return refCount === 0;
        });

        logger.debug(`参照カウント0の実身: ${unreferencedObjects.length}件 / 全${allMetadata.length}件`);
        return unreferencedObjects;
    }

    /**
     * 実身の物理削除（deleteRealObjectのエイリアス）
     * @param {string} realId 実身ID
     */
    async physicalDeleteRealObject(realId) {
        return await this.deleteRealObject(realId);
    }

    /**
     * link_idから実身IDを抽出
     * @param {string} linkId link_id（例: "019a6c96-e262-7dfd-a3bc-1e85d495d60d_0.xtad"）
     * @returns {string} 実身ID（例: "019a6c96-e262-7dfd-a3bc-1e85d495d60d"）
     */
    static extractRealId(linkId) {
        if (!linkId) {
            logger.warn('extractRealId: linkIdが空です');
            return '';
        }
        // .xtadまたは.jsonの拡張子を削除
        let realId = linkId.replace(/\.(xtad|json)$/, '');
        // 末尾の_数字を削除（仮身のインデックス）
        realId = realId.replace(/_\d+$/, '');
        return realId;
    }

    /**
     * 実身IDから管理用JSONファイル名を生成
     * @param {string} realId 実身ID
     * @returns {string} JSONファイル名（例: "019a6c96-e262-7dfd-a3bc-1e85d495d60d.json"）
     */
    static getRealObjectJsonFileName(realId) {
        if (!realId) {
            logger.warn('getRealObjectJsonFileName: realIdが空です');
            return '';
        }
        return `${realId}.json`;
    }

    /**
     * applistデータを取得（プラグイン共通）
     * @param {Object} plugin プラグインインスタンス（messageBusを持つ）
     * @param {string} realId 実身ID
     * @returns {Promise<Object|null>} applistデータ
     */
    static async getAppListData(plugin, realId) {
        try {
            logger.debug('getAppListData開始 realId:', realId);
            const jsonFileName = this.getRealObjectJsonFileName(realId);
            logger.debug('JSONファイル名:', jsonFileName);

            // 親ウィンドウ経由でファイルを読み込む（仮身一覧プラグインと同じ方法）
            const messageId = `load-json-${Date.now()}-${Math.random()}`;

            // 親ウィンドウにファイル読み込みを要求
            plugin.messageBus.send('load-data-file-request', {
                fileName: jsonFileName,
                messageId: messageId
            });

            logger.debug('親ウィンドウにファイル読み込み要求送信:', jsonFileName);

            try {
                // レスポンスを待つ（10秒タイムアウト）
                const result = await plugin.messageBus.waitFor('load-data-file-response', LOAD_DATA_FILE_TIMEOUT_MS, (data) => {
                    return data.messageId === messageId;
                });

                if (result.success) {
                    logger.debug('JSONファイル読み込み成功（親ウィンドウ経由）:', jsonFileName);

                    // dataフィールド（Fileオブジェクト）またはcontentフィールド（テキスト）に対応
                    let jsonText;
                    if (result.data && result.data instanceof File) {
                        logger.debug('Fileオブジェクトをテキストとして読み込み');
                        jsonText = await result.data.text();
                    } else if (result.content) {
                        jsonText = result.content;
                    } else {
                        logger.error('レスポンスにdataまたはcontentフィールドがありません');
                        return null;
                    }

                    const jsonData = JSON.parse(jsonText);
                    logger.debug('JSONパース成功 keys:', Object.keys(jsonData));

                    // applistセクションを返す（小文字）
                    if (jsonData.applist) {
                        logger.debug('applist found:', Object.keys(jsonData.applist));
                        return jsonData.applist;
                    } else {
                        logger.warn('applistが設定されていません jsonData:', jsonData);
                        return null;
                    }
                } else {
                    logger.error('JSONファイル読み込み失敗:', result.error);
                    return null;
                }
            } catch (error) {
                logger.error('JSONファイル読み込みタイムアウトまたはエラー:', jsonFileName, error);
                return null;
            }
        } catch (error) {
            logger.error('appList取得エラー:', error);
            return null;
        }
    }

    /**
     * 実身ウィンドウを閉じる（プラグイン共通）
     * @param {Object} plugin プラグインインスタンス（messageBus、contextMenuVirtualObject、openedRealObjects、setStatusを持つ）
     */
    static closeRealObject(plugin) {
        if (!plugin.contextMenuVirtualObject) {
            logger.warn('選択中の仮身がありません');
            return;
        }

        const realId = plugin.contextMenuVirtualObject.realId;
        const windowId = plugin.openedRealObjects.get(realId);

        if (!windowId) {
            logger.warn('実身が開いていません:', realId);
            plugin.setStatus('実身が開いていません');
            return;
        }

        // 親ウィンドウにウィンドウを閉じるよう要求
        plugin.messageBus.send('close-window', {
            windowId: windowId
        });

        logger.debug('ウィンドウを閉じる要求:', windowId);
        plugin.setStatus('実身を閉じました');
    }

    /**
     * 仮身オブジェクトから現在の属性値を構築（共通ヘルパー）
     * @param {Object} vobj 仮身オブジェクト
     * @returns {Object} 現在の属性値（boolean/string/number形式）
     */
    static buildCurrentAttrsFromVobj(vobj) {
        return {
            pictdisp: vobj.pictdisp !== 'false',  // デフォルトtrue
            namedisp: vobj.namedisp !== 'false',  // デフォルトtrue
            roledisp: vobj.roledisp === 'true',   // デフォルトfalse
            typedisp: vobj.typedisp === 'true',   // デフォルトfalse
            updatedisp: vobj.updatedisp === 'true',  // デフォルトfalse
            framedisp: vobj.framedisp !== 'false',  // デフォルトtrue
            frcol: vobj.frcol || DEFAULT_FRCOL,
            chcol: vobj.chcol || DEFAULT_CHCOL,
            tbcol: vobj.tbcol || DEFAULT_TBCOL,
            bgcol: vobj.bgcol || DEFAULT_BGCOL,
            autoopen: vobj.autoopen === 'true',
            chsz: parseFloat(vobj.chsz) || DEFAULT_FONT_SIZE
        };
    }

    /**
     * 文字サイズから倍率ラベルを計算（共通ヘルパー）
     * @param {number} chsz 文字サイズ（ポイント）
     * @returns {string} 倍率ラベル（'標準', '2倍' など）
     */
    static calculateSelectedRatio(chsz) {
        const baseFontSize = DEFAULT_FONT_SIZE;
        const ratio = chsz / baseFontSize;
        const ratioMap = {
            '1/2倍': 0.5,
            '3/4倍': 0.75,
            '標準': 1.0,
            '3/2倍': 1.5,
            '2倍': 2.0,
            '3倍': 3.0,
            '4倍': 4.0
        };

        for (const [label, value] of Object.entries(ratioMap)) {
            if (Math.abs(ratio - value) < 0.01) {
                return label;
            }
        }
        return '標準';
    }

    /**
     * 仮身属性変更ダイアログを表示（プラグイン共通）
     * @param {Object} plugin プラグインインスタンス（messageBus、contextMenuVirtualObject、applyVirtualObjectAttributesメソッドを持つ）
     *
     * プラグインは以下のメソッドをオプションで実装可能:
     * - getVirtualObjectCurrentAttrs(vobj, element): 現在の属性値を取得（element.dataset対応などカスタマイズ用）
     * - applyVirtualObjectAttributes(attrs): 属性を適用（シグネチャは自由）
     */
    static async changeVirtualObjectAttributes(plugin) {
        if (!plugin.contextMenuVirtualObject || !plugin.contextMenuVirtualObject.virtualObj) {
            logger.warn('選択中の仮身がありません');
            return;
        }

        const vobj = plugin.contextMenuVirtualObject.virtualObj;
        const element = plugin.contextMenuVirtualObject.element;

        // 現在の属性値を取得
        // プラグインがgetVirtualObjectCurrentAttrsを実装している場合はそれを使用
        // そうでなければvobjから直接構築
        const currentAttrs = (typeof plugin.getVirtualObjectCurrentAttrs === 'function')
            ? plugin.getVirtualObjectCurrentAttrs(vobj, element)
            : this.buildCurrentAttrsFromVobj(vobj);

        // 文字サイズの倍率を計算
        const selectedRatio = this.calculateSelectedRatio(currentAttrs.chsz);

        // 親ウィンドウにダイアログ表示を要求
        const messageId = `change-vobj-attrs-${Date.now()}-${Math.random()}`;

        plugin.messageBus.send('change-virtual-object-attributes', {
            virtualObject: vobj,
            currentAttributes: currentAttrs,
            selectedRatio: selectedRatio,
            messageId: messageId
        });

        try {
            // レスポンスを待つ（ユーザー入力を待つのでタイムアウト無効）
            const result = await plugin.messageBus.waitFor('virtual-object-attributes-changed', 0, (data) => {
                return data.messageId === messageId;
            });

            if (result.success && result.attributes) {
                // プラグイン固有のapplyVirtualObjectAttributesメソッドを呼び出す
                plugin.applyVirtualObjectAttributes(result.attributes);
            }
        } catch (error) {
            logger.error('仮身属性変更エラー:', error);
        }
    }

    /**
     * 実身名を変更（プラグイン共通）
     * @param {Object} plugin プラグインインスタンス（messageBus、contextMenuVirtualObject、setStatus、isModifiedを持つ）
     */
    static async renameRealObject(plugin) {
        if (!plugin.contextMenuVirtualObject || !plugin.contextMenuVirtualObject.virtualObj) {
            logger.warn('選択中の仮身がありません');
            return { success: false };
        }

        const realId = plugin.contextMenuVirtualObject.realId;
        const virtualObj = plugin.contextMenuVirtualObject.virtualObj;
        const currentName = virtualObj.link_name;

        // 親ウィンドウにダイアログ表示を要求
        const messageId = `rename-real-${Date.now()}-${Math.random()}`;

        plugin.messageBus.send('rename-real-object', {
            realId: realId,
            currentName: currentName,
            messageId: messageId
        });

        logger.debug('実身名変更要求:', realId, currentName);

        try {
            // レスポンスを待つ（ユーザー入力を待つのでタイムアウト無効）
            const result = await plugin.messageBus.waitFor('real-object-renamed', 0, (data) => {
                return data.messageId === messageId;
            });

            if (result.success) {
                // 仮身の表示名を更新（DOM要素を更新）
                if (plugin.contextMenuVirtualObject.element) {
                    const element = plugin.contextMenuVirtualObject.element;
                    element.textContent = result.newName;
                    element.dataset.linkName = result.newName;
                }
                logger.debug('実身名変更成功:', realId, result.newName);
                plugin.setStatus(`実身名を「${result.newName}」に変更しました`);
                plugin.isModified = true;

                // 結果を返す
                return { success: true, newName: result.newName, realId: realId };
            }

            return { success: false };
        } catch (error) {
            logger.error('実身名変更エラー:', error);
            return { success: false, error: error };
        }
    }

    /**
     * 続柄設定（プラグイン共通）
     * 実身のrelationship配列とlink要素のrelationship属性を設定する
     * @param {Object} plugin プラグインインスタンス（messageBus、contextMenuVirtualObject、setStatus、generateMessageIdを持つ）
     * @returns {Promise<Object>} { success: boolean, relationship?: string[], linkRelationship?: string[], cancelled?: boolean }
     */
    static async setRelationship(plugin) {
        if (!plugin.contextMenuVirtualObject || !plugin.contextMenuVirtualObject.virtualObj) {
            logger.warn('選択中の仮身がありません');
            return { success: false };
        }

        const virtualObj = plugin.contextMenuVirtualObject.virtualObj;
        const realId = plugin.contextMenuVirtualObject.realId;
        const linkId = virtualObj.link_id || '';
        const currentLinkRelationship = virtualObj.linkRelationship || [];
        const messageId = plugin.generateMessageId('set-relationship');

        plugin.messageBus.send('set-relationship', {
            realId: realId,
            linkId: linkId,
            currentLinkRelationship: currentLinkRelationship,
            messageId: messageId
        });

        try {
            // レスポンスを待つ（ユーザー入力を待つのでタイムアウト無効）
            const result = await plugin.messageBus.waitFor('relationship-set', 0, (data) => {
                return data.messageId === messageId;
            });

            if (result.success) {
                // 表示用テキストを生成（JSON用は[タグ]形式）
                const jsonText = (result.relationship || []).map(t => `[${t}]`).join(' ');
                const linkText = (result.linkRelationship || []).join(' ');
                const displayText = [jsonText, linkText].filter(t => t).join(' ') || '（なし）';
                plugin.setStatus(`続柄を設定しました: ${displayText}`);
                return {
                    success: true,
                    relationship: result.relationship || [],
                    linkRelationship: result.linkRelationship || []
                };
            }

            if (result.cancelled) {
                return { success: false, cancelled: true };
            }

            return { success: false };
        } catch (error) {
            logger.error('続柄設定エラー:', error);
            return { success: false, error: error };
        }
    }

    /**
     * 実身を複製（プラグイン共通）
     * @param {Object} plugin プラグインインスタンス（messageBus、contextMenuVirtualObject、setStatusを持つ）
     * @returns {Promise<Object>} 複製結果 { success: boolean, newRealId?: string, newName?: string, error?: string }
     */
    static async duplicateRealObject(plugin) {
        if (!plugin.contextMenuVirtualObject || !plugin.contextMenuVirtualObject.virtualObj) {
            logger.warn('選択中の仮身がありません');
            return { success: false, error: '選択中の仮身がありません' };
        }

        const realId = plugin.contextMenuVirtualObject.realId;

        // 親ウィンドウに実身複製を要求
        const messageId = `duplicate-real-${Date.now()}-${Math.random()}`;

        plugin.messageBus.send('duplicate-real-object', {
            realId: realId,
            messageId: messageId
        });

        logger.debug('実身複製要求:', realId);

        try {
            // レスポンスを待つ（ユーザー入力を待つのでタイムアウト無効）
            const result = await plugin.messageBus.waitFor('real-object-duplicated', 0, (data) => {
                return data.messageId === messageId;
            });

            if (result.success) {
                logger.debug('実身複製成功:', realId, '->', result.newRealId);
                plugin.setStatus(`実身を複製しました: ${result.newName}`);
                return result;
            }
            return { success: false, cancelled: result.cancelled };
        } catch (error) {
            logger.error('実身複製エラー:', error);
            plugin.setStatus('実身の複製に失敗しました');
            return { success: false, error: error.message };
        }
    }

    /**
     * 屑実身操作ウィンドウを開く（プラグイン共通）
     * @param {Object} plugin プラグインインスタンス（setStatusを持つ）
     */
    static openTrashRealObjects(plugin) {
        if (window.parent && window.parent !== window && window.parent.pluginManager) {
            try {
                window.parent.pluginManager.launchPlugin('trash-real-objects', null);
                logger.debug('屑実身操作ウィンドウ起動');
                plugin.setStatus('屑実身操作ウィンドウを起動しました');
            } catch (error) {
                logger.error('屑実身操作ウィンドウ起動エラー:', error);
                plugin.setStatus('屑実身操作ウィンドウの起動に失敗しました');
            }
        }
    }

    /**
     * 仮身ネットワークウィンドウを開く（プラグイン共通）
     * @param {Object} plugin プラグインインスタンス（setStatusを持つ）
     * @param {string} startRealId 起点となる実身ID
     */
    static openVirtualObjectNetwork(plugin, startRealId) {
        if (window.parent && window.parent !== window && window.parent.pluginManager) {
            try {
                const fileData = {
                    startRealId: startRealId
                };
                window.parent.pluginManager.launchPlugin('virtual-object-network', fileData);
                logger.debug('仮身ネットワークウィンドウ起動:', startRealId);
                plugin.setStatus('仮身ネットワークウィンドウを起動しました');
            } catch (error) {
                logger.error('仮身ネットワークウィンドウ起動エラー:', error);
                plugin.setStatus('仮身ネットワークウィンドウの起動に失敗しました');
            }
        }
    }

    /**
     * 実身/仮身検索ウィンドウを開く（プラグイン共通）
     * @param {Object} plugin プラグインインスタンス（setStatusを持つ）
     */
    static openRealObjectSearch(plugin) {
        if (window.parent && window.parent !== window && window.parent.pluginManager) {
            try {
                window.parent.pluginManager.launchPlugin('real-object-search', null);
                logger.debug('実身/仮身検索ウィンドウ起動');
                plugin.setStatus('実身/仮身検索ウィンドウを起動しました');
            } catch (error) {
                logger.error('実身/仮身検索ウィンドウ起動エラー:', error);
                plugin.setStatus('実身/仮身検索ウィンドウの起動に失敗しました');
            }
        }
    }

    /**
     * 管理情報ウィンドウを開く（プラグイン共通）
     * @param {Object} plugin プラグインインスタンス（setStatusを持つ）
     * @param {string} realId 対象の実身ID
     */
    static openRealObjectConfig(plugin, realId) {
        if (window.parent && window.parent !== window && window.parent.pluginManager) {
            try {
                const fileData = {
                    realId: realId
                };
                window.parent.pluginManager.launchPlugin('realobject-config', fileData);
                logger.debug('管理情報ウィンドウ起動:', realId);
                plugin.setStatus('管理情報ウィンドウを起動しました');
            } catch (error) {
                logger.error('管理情報ウィンドウ起動エラー:', error);
                plugin.setStatus('管理情報ウィンドウの起動に失敗しました');
            }
        }
    }

    /**
     * デフォルトアイコンファイルを生成
     * @param {string} realId 実身ID
     * @returns {boolean} 成功/失敗
     */
    generateDefaultIcon(realId) {
        if (!this.isElectronEnv) {
            logger.warn('デフォルトアイコン生成: Electron環境が必要です');
            return false;
        }

        try {
            const basePath = this._basePath;
            const icoPath = this.path.join(basePath, `${realId}.ico`);

            // 16x16 32bit ICOファイル（文書アイコン風）
            const icoData = this._createMinimalIcon();

            this.fs.writeFileSync(icoPath, Buffer.from(icoData));
            logger.debug(`デフォルトアイコン生成: ${icoPath}`);
            return true;
        } catch (error) {
            logger.error('デフォルトアイコン生成エラー:', error);
            return false;
        }
    }

    /**
     * 最小構成のICOデータを作成（16x16 32bit）
     * 文書アイコン風のデザイン
     * @returns {Array} ICOバイナリデータ
     * @private
     */
    _createMinimalIcon() {
        const width = 16;
        const height = 16;
        const bitsPerPixel = 32;
        const pixelDataSize = width * height * 4;
        const bmpHeaderSize = 40;
        const imageDataSize = bmpHeaderSize + pixelDataSize;
        const imageOffset = 6 + 16; // ICOヘッダー(6) + ディレクトリ(16)

        // ICOヘッダー (6バイト)
        const header = [
            0x00, 0x00,  // Reserved
            0x01, 0x00,  // Type (1 = ICO)
            0x01, 0x00   // Number of images
        ];

        // ディレクトリエントリ (16バイト)
        const directory = [
            width,                    // Width
            height,                   // Height
            0,                        // Color palette
            0,                        // Reserved
            0x01, 0x00,               // Color planes
            bitsPerPixel, 0x00,       // Bits per pixel
            imageDataSize & 0xFF,
            (imageDataSize >> 8) & 0xFF,
            (imageDataSize >> 16) & 0xFF,
            (imageDataSize >> 24) & 0xFF,
            imageOffset & 0xFF,
            (imageOffset >> 8) & 0xFF,
            (imageOffset >> 16) & 0xFF,
            (imageOffset >> 24) & 0xFF
        ];

        // BITMAPINFOHEADER (40バイト)
        const bmpHeader = [
            bmpHeaderSize, 0, 0, 0,   // Header size
            width, 0, 0, 0,           // Width
            height * 2, 0, 0, 0,      // Height (x2 for ICO)
            0x01, 0x00,               // Planes
            bitsPerPixel, 0x00,       // Bit count
            0, 0, 0, 0,               // Compression
            0, 0, 0, 0,               // Image size
            0, 0, 0, 0,               // X pixels/meter
            0, 0, 0, 0,               // Y pixels/meter
            0, 0, 0, 0,               // Colors used
            0, 0, 0, 0                // Important colors
        ];

        // ピクセルデータ (16x16 BGRA, bottom-up)
        const pixels = [];
        for (let y = height - 1; y >= 0; y--) {
            for (let x = 0; x < width; x++) {
                let b = 0xF0, g = 0xF0, r = 0xF0, a = 0xFF;

                // 外枠（濃いグレー）
                if (x === 0 || x === 15 || y === 0 || y === 15) {
                    b = 0x60; g = 0x60; r = 0x60;
                }
                // 内部の罫線（文書の行を表現、青色）
                else if (y >= 3 && y <= 12 && x >= 2 && x <= 13) {
                    if (y === 4 || y === 7 || y === 10) {
                        b = 0x80; g = 0x00; r = 0x00;
                    }
                }

                pixels.push(b, g, r, a);
            }
        }

        return [...header, ...directory, ...bmpHeader, ...pixels];
    }

    /**
     * プラグインの原紙アイコンをコピー
     * @param {string} realId 実身ID
     * @param {string} pluginId プラグインID
     * @param {string} templateIcoName 原紙アイコンファイル名
     * @returns {boolean} 成功/失敗
     */
    copyTemplateIcon(realId, pluginId, templateIcoName) {
        if (!this.isElectronEnv) {
            logger.warn('原紙アイコンコピー: Electron環境が必要です');
            return false;
        }

        try {
            // プラグインディレクトリからアイコンファイルのパスを構築
            const basePath = this._basePath;

            // pluginsディレクトリを取得
            // 開発時: basePath = project/data, plugins = project/plugins
            // パッケージ時: plugins = resources/app/plugins
            let pluginsPath;
            if (this.process.resourcesPath) {
                // パッケージ化されている場合（resources/app/plugins）
                pluginsPath = this.path.join(this.process.resourcesPath, 'app', 'plugins');
            } else {
                // 開発時（basePathの親ディレクトリにplugins）
                pluginsPath = this.path.join(this.path.dirname(basePath), 'plugins');
            }

            const sourceIcoPath = this.path.join(pluginsPath, pluginId, templateIcoName);
            const destIcoPath = this.path.join(basePath, `${realId}.ico`);

            // ソースファイルが存在するか確認
            if (!this.fs.existsSync(sourceIcoPath)) {
                logger.warn(`原紙アイコンが見つかりません: ${sourceIcoPath}`);
                return false;
            }

            // コピー実行
            this.fs.copyFileSync(sourceIcoPath, destIcoPath);
            logger.debug(`原紙アイコンコピー: ${sourceIcoPath} -> ${destIcoPath}`);
            return true;
        } catch (error) {
            logger.error('原紙アイコンコピーエラー:', error);
            return false;
        }
    }

    /**
     * 画像ファイルを保存
     * @param {string} fileName ファイル名
     * @param {Array|Uint8Array} imageDataArray 画像データ
     * @returns {boolean} 成功/失敗
     *
     */
    saveImageFile(fileName, imageDataArray) {
        if (!this.isElectronEnv) {
            logger.error('画像ファイル保存エラー: Electron環境が必要です');
            return false;
        }

        try {
            // データフォルダに保存
            const basePath = this.getDataBasePath();
            const filePath = this.path.join(basePath, fileName);

            // Uint8Arrayに変換して保存
            const buffer = Buffer.from(imageDataArray);
            this.fs.writeFileSync(filePath, buffer);

            logger.debug('画像ファイル保存成功:', filePath);
            return true;
        } catch (error) {
            logger.error('画像ファイル保存エラー:', error);
            return false;
        }
    }

    /**
     * 指定パターンに一致する画像ファイル一覧を取得
     * @param {string} realId - 実身ID
     * @param {number} recordNo - レコード番号
     * @returns {Array<{fileName: string, imageNo: number}>} ファイル一覧
     */
    listImageFiles(realId, recordNo) {
        if (!this.isElectronEnv) {
            logger.error('画像ファイル一覧取得エラー: Electron環境が必要です');
            return [];
        }

        try {
            const basePath = this.getDataBasePath();
            const files = this.fs.readdirSync(basePath);

            // パターン: realId_recordNo_imageNo.png
            const escapedRealId = realId.replace(/[-]/g, '\\-');
            const pattern = new RegExp(`^${escapedRealId}_${recordNo}_(\\d+)\\.png$`);

            const result = [];
            for (const file of files) {
                const match = file.match(pattern);
                if (match) {
                    result.push({
                        fileName: file,
                        imageNo: parseInt(match[1], 10)
                    });
                }
            }

            return result;
        } catch (error) {
            logger.error('画像ファイル一覧取得エラー:', error);
            return [];
        }
    }

    /**
     * 画像ファイルを読み込み（postMessage経由でレスポンス）
     * @param {string} fileName ファイル名
     * @param {string} messageId メッセージID
     * @param {Window} source レスポンス送信先
     */
    loadImageFile(fileName, messageId, source) {
        if (!this.isElectronEnv) {
            source.postMessage({
                type: 'load-image-response',
                messageId: messageId,
                success: false,
                error: 'Electron environment required'
            }, '*');
            return;
        }

        try {
            // データフォルダから読み込み
            const basePath = this.getDataBasePath();
            const filePath = this.path.join(basePath, fileName);

            logger.debug('画像ファイル読み込み:', filePath);

            // ファイルが存在するかチェック
            if (!this.fs.existsSync(filePath)) {
                logger.error('画像ファイルが見つかりません:', filePath);
                source.postMessage({
                    type: 'load-image-response',
                    messageId: messageId,
                    success: false,
                    error: 'File not found'
                }, '*');
                return;
            }

            // ファイルを読み込み
            const buffer = this.fs.readFileSync(filePath);
            const imageData = Array.from(buffer);

            // MIMEタイプを推測
            const ext = this.path.extname(fileName).toLowerCase();
            let mimeType = 'image/png';
            if (ext === '.jpg' || ext === '.jpeg') {
                mimeType = 'image/jpeg';
            } else if (ext === '.gif') {
                mimeType = 'image/gif';
            } else if (ext === '.bmp') {
                mimeType = 'image/bmp';
            }

            source.postMessage({
                type: 'load-image-response',
                messageId: messageId,
                success: true,
                imageData: imageData,
                mimeType: mimeType
            }, '*');

            logger.debug('画像ファイル読み込み成功:', filePath, '(', buffer.length, 'bytes)');
        } catch (error) {
            logger.error('画像ファイル読み込みエラー:', error);
            source.postMessage({
                type: 'load-image-response',
                messageId: messageId,
                success: false,
                error: error.message
            }, '*');
        }
    }
}
