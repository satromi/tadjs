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

/**
 * 実身仮身システム - ファイル直接アクセス版
 * IndexedDBを使わず、ファイルシステムから直接読み書き
 */
export class RealObjectSystem {
    constructor() {
        console.log('[RealObjectSystem] 初期化（ファイル直接アクセスモード）');

        // Electron環境チェック（コンストラクタで1回だけ）
        this.isElectronEnv = typeof require !== 'undefined' && typeof process !== 'undefined' && process.versions && process.versions.electron;

        if (!this.isElectronEnv) {
            console.warn('[RealObjectSystem] Electron環境ではありません。一部の機能は使用できません。');
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

        // ベースパスをキャッシュ
        this._basePath = this._calculateBasePath();

        console.log(`[RealObjectSystem] basePath: ${this._basePath}`);
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

        console.log(`[RealObjectSystem] 実身読み込み: ${realId}`);

        // メタデータ読み込み
        const jsonPath = this.path.join(basePath, `${realId}.json`);
        console.log(`[RealObjectSystem] basePath: ${basePath}`);
        console.log(`[RealObjectSystem] jsonPath: ${jsonPath}`);

        if (!this.fs.existsSync(jsonPath)) {
            throw new Error(`実身が見つかりません: ${realId}`);
        }

        const jsonContent = this.fs.readFileSync(jsonPath, 'utf-8');
        console.log(`[RealObjectSystem] JSON内容: ${jsonContent.substring(0, 200)}`);

        const metadata = JSON.parse(jsonContent);
        console.log(`[RealObjectSystem] パース後のmetadata:`, JSON.stringify(metadata, null, 2).substring(0, 300));
        metadata.realId = realId;

        // recordCount が存在しない場合は、実際にファイルを確認してカウント
        if (metadata.recordCount === undefined || metadata.recordCount === null) {
            console.log(`[RealObjectSystem] recordCount未定義、ファイルシステムから検索します`);
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
            console.log(`[RealObjectSystem] 検出されたレコード数: ${count}`);
        }

        console.log(`[RealObjectSystem] メタデータ読み込み: name=${metadata.name || metadata.realName}, recordCount=${metadata.recordCount}`);

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
                console.log(`[RealObjectSystem] レコード読み込み: ${realId}_${recordNo}.xtad (${xtad.length}文字, ${rawData.length}バイト)`);
            } else {
                console.warn(`[RealObjectSystem] レコードファイルが見つかりません: ${xtadPath}`);
            }
        }

        console.log(`[RealObjectSystem] 実身読み込み完了: ${realId} (${records.length}レコード)`);
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

        console.log(`[RealObjectSystem] 実身保存: ${realId}`);

        // メタデータ保存
        const jsonPath = this.path.join(basePath, `${realId}.json`);
        const metadata = { ...realObject.metadata };
        metadata.realId = realId;
        metadata.recordCount = realObject.records.length;

        this.fs.writeFileSync(jsonPath, JSON.stringify(metadata, null, 2), 'utf-8');
        console.log(`[RealObjectSystem] メタデータ保存: ${jsonPath}`);

        // レコード保存
        realObject.records.forEach((record, index) => {
            if (record.xtad) {
                const xtadPath = this.path.join(basePath, `${realId}_${index}.xtad`);
                this.fs.writeFileSync(xtadPath, record.xtad, 'utf-8');
                console.log(`[RealObjectSystem] レコード保存: ${xtadPath}`);
            }
        });

        console.log(`[RealObjectSystem] 実身保存完了: ${realId}`);
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
            console.log(`[RealObjectSystem] 既にコピー済み: ${sourceRealId} -> ${idMap.get(sourceRealId)}`);
            return idMap.get(sourceRealId);
        }

        console.log(`[RealObjectSystem] 実身コピー: ${sourceRealId}`);

        // 元の実身を読み込む
        const sourceRealObject = await this.loadRealObject(sourceRealId);

        // 新しいUUIDを生成
        const newRealId = this.generateUUIDv7();
        console.log(`[RealObjectSystem] 新しい実身ID: ${newRealId}`);

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
                        console.log(`[RealObjectSystem] 参照実身をコピー: ${refRealId} -> ${newRefRealId}`);

                        // XTADのlink_idを新しいIDに置き換え
                        const oldLinkIdPattern = new RegExp(refRealId.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g');
                        updatedXtad = updatedXtad.replace(oldLinkIdPattern, newRefRealId);
                    } catch (error) {
                        console.warn(`[RealObjectSystem] 参照実身のコピーに失敗（スキップ）: ${refRealId}`, error);
                    }
                }

                newRecord.xtad = updatedXtad;
            }

            newRecords.push(newRecord);
        }

        // メタデータをコピーして更新
        const newMetadata = { ...sourceRealObject.metadata };
        newMetadata.realId = newRealId;
        newMetadata.realName = sourceRealObject.metadata.realName + (isRootCall ? 'のコピー' : '');
        newMetadata.refCount = 0;
        newMetadata.createDate = new Date().toISOString();
        newMetadata.updateDate = new Date().toISOString();
        newMetadata.accessDate = new Date().toISOString();

        // 新しい実身として保存
        const newRealObject = {
            metadata: newMetadata,
            records: newRecords
        };

        await this.saveRealObject(newRealId, newRealObject);

        // icoファイルもコピー（存在する場合のみ）
        if (isRootCall) {
            const basePath = this._basePath;
            const sourceIcoPath = this.path.join(basePath, `${sourceRealId}.ico`);
            const newIcoPath = this.path.join(basePath, `${newRealId}.ico`);

            if (this.fs.existsSync(sourceIcoPath)) {
                try {
                    this.fs.copyFileSync(sourceIcoPath, newIcoPath);
                    console.log(`[RealObjectSystem] icoファイルコピー: ${sourceRealId}.ico -> ${newRealId}.ico`);
                } catch (error) {
                    console.warn(`[RealObjectSystem] icoファイルのコピーに失敗:`, error);
                }
            } else {
                console.log(`[RealObjectSystem] icoファイルが存在しないためスキップ: ${sourceIcoPath}`);
            }
        }

        console.log(`[RealObjectSystem] 実身コピー完了: ${sourceRealId} -> ${newRealId}`);
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

        console.log(`[RealObjectSystem] 実身非再帰的コピー: ${sourceRealId}, 新しい名前: ${newName}`);

        // 元の実身を読み込む
        const sourceRealObject = await this.loadRealObject(sourceRealId);

        // 新しいUUIDを生成
        const newRealId = this.generateUUIDv7();
        console.log(`[RealObjectSystem] 新しい実身ID: ${newRealId}`);

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
        newMetadata.realName = newName;
        newMetadata.refCount = 0;
        newMetadata.createDate = new Date().toISOString();
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

        if (this.fs.existsSync(sourceIcoPath)) {
            try {
                this.fs.copyFileSync(sourceIcoPath, newIcoPath);
                console.log(`[RealObjectSystem] icoファイルコピー: ${sourceRealId}.ico -> ${newRealId}.ico`);
            } catch (error) {
                console.warn(`[RealObjectSystem] icoファイルのコピーに失敗:`, error);
            }
        }

        console.log(`[RealObjectSystem] 実身非再帰的コピー完了: ${sourceRealId} -> ${newRealId}`);
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

        console.log(`[RealObjectSystem] 仮身削除（refCount-1）: ${realId}`);

        // メタデータ読み込み
        const jsonPath = this.path.join(basePath, `${realId}.json`);
        if (!this.fs.existsSync(jsonPath)) {
            console.warn(`[RealObjectSystem] メタデータが見つかりません: ${realId}`);
            return;
        }

        const metadata = JSON.parse(this.fs.readFileSync(jsonPath, 'utf-8'));

        // refCountを-1（0未満にはしない）
        const currentRefCount = metadata.refCount || 0;
        metadata.refCount = Math.max(0, currentRefCount - 1);

        // メタデータを保存
        this.fs.writeFileSync(jsonPath, JSON.stringify(metadata, null, 2), 'utf-8');
        console.log(`[RealObjectSystem] 参照カウント更新: ${realId} ${currentRefCount} -> ${metadata.refCount}`);
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

        console.log(`[RealObjectSystem] 実身削除: ${realId}`);

        // メタデータ削除
        const jsonPath = this.path.join(basePath, `${realId}.json`);
        if (this.fs.existsSync(jsonPath)) {
            this.fs.unlinkSync(jsonPath);
            console.log(`[RealObjectSystem] メタデータ削除: ${jsonPath}`);
        }

        // レコード削除（すべてのレコードファイルを探して削除）
        let recordNo = 0;
        while (true) {
            const xtadPath = this.path.join(basePath, `${realId}_${recordNo}.xtad`);
            if (this.fs.existsSync(xtadPath)) {
                this.fs.unlinkSync(xtadPath);
                console.log(`[RealObjectSystem] レコード削除: ${xtadPath}`);
                recordNo++;
            } else {
                break;
            }
        }

        // アイコンファイル削除
        const icoPath = this.path.join(basePath, `${realId}.ico`);
        if (this.fs.existsSync(icoPath)) {
            this.fs.unlinkSync(icoPath);
            console.log(`[RealObjectSystem] アイコン削除: ${icoPath}`);
        }

        console.log(`[RealObjectSystem] 実身削除完了: ${realId} (${recordNo}レコード)`);
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
            console.warn(`[RealObjectSystem] メタデータが見つかりません: ${realId}`);
            return;
        }

        const metadata = JSON.parse(this.fs.readFileSync(jsonPath, 'utf-8'));
        metadata.refCount = refCount;

        this.fs.writeFileSync(jsonPath, JSON.stringify(metadata, null, 2), 'utf-8');
        console.log(`[RealObjectSystem] 参照カウント更新: ${realId} -> ${refCount}`);
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
        console.log(`[RealObjectSystem] 仮身コピー完了: ${realId} (refCount: ${currentRefCount} -> ${newRefCount})`);
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
                    console.warn(`[RealObjectSystem] 実身ではないJSONファイルをスキップ: ${jsonFile}`);
                }
            } catch (error) {
                console.warn(`[RealObjectSystem] メタデータ読み込みエラー: ${jsonFile}`, error);
            }
        }

        console.log(`[RealObjectSystem] メタデータ一覧取得: ${metadataList.length}件`);
        return metadataList;
    }

    /**
     * 参照カウントが0の実身一覧を取得
     * @returns {Promise<Array>} 参照カウント0の実身のメタデータ配列
     */
    async getUnreferencedRealObjects() {
        console.log('[RealObjectSystem] 参照カウント0の実身一覧取得開始');

        const allMetadata = await this.getAllMetadata();
        const unreferencedObjects = allMetadata.filter(metadata => {
            const refCount = metadata.refCount || 0;
            return refCount === 0;
        });

        console.log(`[RealObjectSystem] 参照カウント0の実身: ${unreferencedObjects.length}件 / 全${allMetadata.length}件`);
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
            console.warn('[RealObjectSystem] extractRealId: linkIdが空です');
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
            console.warn('[RealObjectSystem] getRealObjectJsonFileName: realIdが空です');
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
            console.log('[RealObjectSystem] getAppListData開始 realId:', realId);
            const jsonFileName = this.getRealObjectJsonFileName(realId);
            console.log('[RealObjectSystem] JSONファイル名:', jsonFileName);

            // 親ウィンドウ経由でファイルを読み込む（仮身一覧プラグインと同じ方法）
            const messageId = `load-json-${Date.now()}-${Math.random()}`;

            // 親ウィンドウにファイル読み込みを要求
            plugin.messageBus.send('load-data-file-request', {
                fileName: jsonFileName,
                messageId: messageId
            });

            console.log('[RealObjectSystem] 親ウィンドウにファイル読み込み要求送信:', jsonFileName);

            try {
                // レスポンスを待つ（10秒タイムアウト）
                const result = await plugin.messageBus.waitFor('load-data-file-response', LOAD_DATA_FILE_TIMEOUT_MS, (data) => {
                    return data.messageId === messageId;
                });

                if (result.success) {
                    console.log('[RealObjectSystem] JSONファイル読み込み成功（親ウィンドウ経由）:', jsonFileName);

                    // dataフィールド（Fileオブジェクト）またはcontentフィールド（テキスト）に対応
                    let jsonText;
                    if (result.data && result.data instanceof File) {
                        console.log('[RealObjectSystem] Fileオブジェクトをテキストとして読み込み');
                        jsonText = await result.data.text();
                    } else if (result.content) {
                        jsonText = result.content;
                    } else {
                        console.error('[RealObjectSystem] レスポンスにdataまたはcontentフィールドがありません');
                        return null;
                    }

                    const jsonData = JSON.parse(jsonText);
                    console.log('[RealObjectSystem] JSONパース成功 keys:', Object.keys(jsonData));

                    // applistセクションを返す（小文字）
                    if (jsonData.applist) {
                        console.log('[RealObjectSystem] applist found:', Object.keys(jsonData.applist));
                        return jsonData.applist;
                    } else {
                        console.warn('[RealObjectSystem] applistが設定されていません jsonData:', jsonData);
                        return null;
                    }
                } else {
                    console.error('[RealObjectSystem] JSONファイル読み込み失敗:', result.error);
                    return null;
                }
            } catch (error) {
                console.error('[RealObjectSystem] JSONファイル読み込みタイムアウトまたはエラー:', jsonFileName, error);
                return null;
            }
        } catch (error) {
            console.error('[RealObjectSystem] appList取得エラー:', error);
            return null;
        }
    }

    /**
     * 実身ウィンドウを閉じる（プラグイン共通）
     * @param {Object} plugin プラグインインスタンス（messageBus、contextMenuVirtualObject、openedRealObjects、setStatusを持つ）
     */
    static closeRealObject(plugin) {
        if (!plugin.contextMenuVirtualObject) {
            console.warn('[RealObjectSystem] 選択中の仮身がありません');
            return;
        }

        const realId = plugin.contextMenuVirtualObject.realId;
        const windowId = plugin.openedRealObjects.get(realId);

        if (!windowId) {
            console.warn('[RealObjectSystem] 実身が開いていません:', realId);
            plugin.setStatus('実身が開いていません');
            return;
        }

        // 親ウィンドウにウィンドウを閉じるよう要求
        plugin.messageBus.send('close-window', {
            windowId: windowId
        });

        console.log('[RealObjectSystem] ウィンドウを閉じる要求:', windowId);
        plugin.setStatus('実身を閉じました');
    }

    /**
     * 仮身属性変更ダイアログを表示（プラグイン共通）
     * @param {Object} plugin プラグインインスタンス（messageBus、contextMenuVirtualObject、applyVirtualObjectAttributesメソッドを持つ）
     */
    static async changeVirtualObjectAttributes(plugin) {
        if (!plugin.contextMenuVirtualObject || !plugin.contextMenuVirtualObject.virtualObj) {
            console.warn('[RealObjectSystem] 選択中の仮身がありません');
            return;
        }

        const vobj = plugin.contextMenuVirtualObject.virtualObj;
        const element = plugin.contextMenuVirtualObject.element;

        // 現在の属性値を取得（elementのdatasetから最新の値を読み取る）
        const pictdisp = element.dataset.linkPictdisp !== undefined ? element.dataset.linkPictdisp : (vobj.pictdisp || 'true');
        const namedisp = element.dataset.linkNamedisp !== undefined ? element.dataset.linkNamedisp : (vobj.namedisp || 'true');
        const roledisp = element.dataset.linkRoledisp !== undefined ? element.dataset.linkRoledisp : (vobj.roledisp || 'false');
        const typedisp = element.dataset.linkTypedisp !== undefined ? element.dataset.linkTypedisp : (vobj.typedisp || 'false');
        const updatedisp = element.dataset.linkUpdatedisp !== undefined ? element.dataset.linkUpdatedisp : (vobj.updatedisp || 'false');
        const framedisp = element.dataset.linkFramedisp !== undefined ? element.dataset.linkFramedisp : (vobj.framedisp || 'true');
        const frcol = element.dataset.linkFrcol || vobj.frcol || DEFAULT_FRCOL;
        const chcol = element.dataset.linkChcol || vobj.chcol || DEFAULT_CHCOL;
        const tbcol = element.dataset.linkTbcol || vobj.tbcol || DEFAULT_TBCOL;
        const bgcol = element.dataset.linkBgcol || vobj.bgcol || DEFAULT_BGCOL;
        const autoopen = element.dataset.linkAutoopen !== undefined ? element.dataset.linkAutoopen : (vobj.autoopen || 'false');
        const chsz = element.dataset.linkChsz ? parseFloat(element.dataset.linkChsz) : (parseFloat(vobj.chsz) || 14);

        console.log('[RealObjectSystem] 仮身属性ダイアログ用に現在の属性を取得:', {
            pictdisp, namedisp, roledisp, typedisp, updatedisp, framedisp,
            frcol, chcol, tbcol, bgcol, autoopen, chsz
        });

        const currentAttrs = {
            pictdisp: pictdisp !== 'false',  // デフォルトtrue
            namedisp: namedisp !== 'false',  // デフォルトtrue
            roledisp: roledisp === 'true',   // デフォルトfalse
            typedisp: typedisp === 'true',   // デフォルトfalse
            updatedisp: updatedisp === 'true',  // デフォルトfalse
            framedisp: framedisp !== 'false',  // デフォルトtrue
            frcol: frcol,
            chcol: chcol,
            tbcol: tbcol,
            bgcol: bgcol,
            autoopen: autoopen === 'true',
            chsz: chsz
        };

        // 文字サイズの倍率を計算
        const baseFontSize = DEFAULT_FONT_SIZE;
        const ratio = currentAttrs.chsz / baseFontSize;
        let selectedRatio = '標準';
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
                selectedRatio = label;
                break;
            }
        }

        // 親ウィンドウにダイアログ表示を要求
        const messageId = `change-vobj-attrs-${Date.now()}-${Math.random()}`;

        plugin.messageBus.send('change-virtual-object-attributes', {
            virtualObject: vobj,
            currentAttributes: currentAttrs,
            selectedRatio: selectedRatio,
            messageId: messageId
        });

        console.log('[RealObjectSystem] 仮身属性変更ダイアログ要求');

        try {
            // レスポンスを待つ（タイムアウト30秒、ユーザー操作待ち）
            const result = await plugin.messageBus.waitFor('virtual-object-attributes-changed', LONG_OPERATION_TIMEOUT_MS, (data) => {
                return data.messageId === messageId;
            });

            if (result.success && result.attributes) {
                // プラグイン固有のapplyVirtualObjectAttributesメソッドを呼び出す
                plugin.applyVirtualObjectAttributes(result.attributes, vobj, element);
            }
        } catch (error) {
            console.error('[RealObjectSystem] 仮身属性変更エラー:', error);
        }
    }

    /**
     * 実身名を変更（プラグイン共通）
     * @param {Object} plugin プラグインインスタンス（messageBus、contextMenuVirtualObject、setStatus、isModifiedを持つ）
     */
    static async renameRealObject(plugin) {
        if (!plugin.contextMenuVirtualObject || !plugin.contextMenuVirtualObject.virtualObj) {
            console.warn('[RealObjectSystem] 選択中の仮身がありません');
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

        console.log('[RealObjectSystem] 実身名変更要求:', realId, currentName);

        try {
            // レスポンスを待つ（タイムアウト30秒、ユーザー操作待ち）
            const result = await plugin.messageBus.waitFor('real-object-renamed', LONG_OPERATION_TIMEOUT_MS, (data) => {
                return data.messageId === messageId;
            });

            if (result.success) {
                // 仮身の表示名を更新（DOM要素を更新）
                if (plugin.contextMenuVirtualObject.element) {
                    const element = plugin.contextMenuVirtualObject.element;
                    element.textContent = result.newName;
                    element.dataset.linkName = result.newName;
                }
                console.log('[RealObjectSystem] 実身名変更成功:', realId, result.newName);
                plugin.setStatus(`実身名を「${result.newName}」に変更しました`);
                plugin.isModified = true;

                // 結果を返す
                return { success: true, newName: result.newName, realId: realId };
            }

            return { success: false };
        } catch (error) {
            console.error('[RealObjectSystem] 実身名変更エラー:', error);
            return { success: false, error: error };
        }
    }

    /**
     * 実身を複製（プラグイン共通）
     * @param {Object} plugin プラグインインスタンス（messageBus、contextMenuVirtualObject、setStatusを持つ）
     */
    static async duplicateRealObject(plugin) {
        if (!plugin.contextMenuVirtualObject || !plugin.contextMenuVirtualObject.virtualObj) {
            console.warn('[RealObjectSystem] 選択中の仮身がありません');
            return;
        }

        const realId = plugin.contextMenuVirtualObject.realId;

        // 親ウィンドウに実身複製を要求
        const messageId = `duplicate-real-${Date.now()}-${Math.random()}`;

        plugin.messageBus.send('duplicate-real-object', {
            realId: realId,
            messageId: messageId
        });

        console.log('[RealObjectSystem] 実身複製要求:', realId);

        try {
            // レスポンスを待つ（デフォルトタイムアウト5秒）
            const result = await plugin.messageBus.waitFor('real-object-duplicated', DEFAULT_TIMEOUT_MS, (data) => {
                return data.messageId === messageId;
            });

            if (result.success) {
                console.log('[RealObjectSystem] 実身複製成功:', realId, '->', result.newRealId);
                plugin.setStatus(`実身を複製しました: ${result.newName}`);
            }
        } catch (error) {
            console.error('[RealObjectSystem] 実身複製エラー:', error);
            plugin.setStatus('実身の複製に失敗しました');
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
                console.log('[RealObjectSystem] 屑実身操作ウィンドウ起動');
                plugin.setStatus('屑実身操作ウィンドウを起動しました');
            } catch (error) {
                console.error('[RealObjectSystem] 屑実身操作ウィンドウ起動エラー:', error);
                plugin.setStatus('屑実身操作ウィンドウの起動に失敗しました');
            }
        }
    }
}
