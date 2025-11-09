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
}
