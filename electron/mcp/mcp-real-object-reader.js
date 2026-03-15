/**
 * MCP用 実身/仮身データ読み取りモジュール (CJS)
 *
 * js/real-object-system.js の読み取り機能をCJS形式で再実装。
 * MCPサーバからの利用に特化した軽量版。
 */

const fs = require('fs');
const path = require('path');
const { getLogger } = require('../logger.cjs');

const logger = getLogger('McpReader');

class RealObjectReader {
    /**
     * @param {string} dataFolder - 実身データフォルダのパス
     */
    constructor(dataFolder) {
        this.dataFolder = dataFolder;
        logger.info(`RealObjectReader 初期化: ${dataFolder}`);
    }

    /**
     * 全実身のメタデータ一覧を取得
     * @returns {Promise<Array>} メタデータ配列
     */
    async getAllMetadata() {
        const files = await fs.promises.readdir(this.dataFolder);
        const jsonFiles = files.filter(f => f.endsWith('.json'));

        const metadataList = await Promise.all(
            jsonFiles.map(async (jsonFile) => {
                try {
                    const filePath = path.join(this.dataFolder, jsonFile);
                    const content = await fs.promises.readFile(filePath, 'utf-8');
                    const metadata = JSON.parse(content);
                    metadata.realId = jsonFile.replace('.json', '');
                    return metadata;
                } catch (err) {
                    logger.warn(`メタデータ読み込みエラー: ${jsonFile}`, err.message);
                    return null;
                }
            })
        );

        return metadataList.filter(m => m !== null && m.name !== undefined);
    }

    /**
     * 指定実身のメタデータとレコードを読み込み
     * @param {string} realId - 実身ID
     * @returns {Promise<{metadata: Object, records: Array}>}
     */
    async loadRealObject(realId) {
        // メタデータ読み込み
        const jsonPath = path.join(this.dataFolder, `${realId}.json`);
        if (!fs.existsSync(jsonPath)) {
            throw new Error(`実身が見つかりません: ${realId}`);
        }
        const content = await fs.promises.readFile(jsonPath, 'utf-8');
        const metadata = JSON.parse(content);
        metadata.realId = realId;

        // レコード数の決定
        let recordCount = metadata.recordCount || 0;
        if (recordCount === 0) {
            // ファイルシステムから実際の数を検索
            for (let i = 0; i < 1000; i++) {
                const xtadPath = path.join(this.dataFolder, `${realId}_${i}.xtad`);
                if (fs.existsSync(xtadPath)) {
                    recordCount = i + 1;
                } else {
                    break;
                }
            }
        }

        // XTADレコード読み込み
        const records = [];
        for (let i = 0; i < recordCount; i++) {
            try {
                const xtadPath = path.join(this.dataFolder, `${realId}_${i}.xtad`);
                const xtad = await fs.promises.readFile(xtadPath, 'utf-8');
                records.push({ recordNo: i, xtad });
            } catch (err) {
                logger.warn(`XTADレコード読み込みエラー: ${realId}_${i}.xtad`, err.message);
            }
        }

        return { metadata, records };
    }

    /**
     * XTADコンテンツからプレーンテキストを抽出
     * @param {string} xtadXml - XTAD XML文字列
     * @returns {string} プレーンテキスト
     */
    extractPlainText(xtadXml) {
        if (!xtadXml) return '';
        // XMLタグを除去し、テキストコンテンツを抽出
        // <link ... /> 自己閉じタグ内のテキストは除外
        let text = xtadXml
            .replace(/<link[^>]*\/>/g, '')           // 自己閉じlinkタグ除去
            .replace(/<link[^>]*>([^<]*)<\/link>/g, '[$1]')  // linkタグ内テキストを[仮身名]形式で保持
            .replace(/<[^>]+>/g, '')                  // 残りのタグ除去
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
            .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
        // 連続空白を整理
        text = text.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
        return text;
    }

    /**
     * XTADから仮身（link要素）一覧を抽出
     * @param {string} xtadXml - XTAD XML文字列
     * @returns {Array<{linkId: string, targetRealId: string, displayName: string}>}
     */
    extractLinks(xtadXml) {
        if (!xtadXml) return [];
        const links = [];
        // 自己閉じlinkタグ
        const selfClosingRegex = /<link[^>]*\sid="([^"]+)"[^>]*\/>/g;
        let match;
        while ((match = selfClosingRegex.exec(xtadXml)) !== null) {
            const linkId = match[1];
            links.push({
                linkId,
                targetRealId: RealObjectReader.extractRealId(linkId),
                displayName: ''
            });
        }
        // 開閉タグ形式のlinkタグ
        const openCloseRegex = /<link[^>]*\sid="([^"]+)"[^>]*>([^<]*)<\/link>/g;
        while ((match = openCloseRegex.exec(xtadXml)) !== null) {
            const linkId = match[1];
            links.push({
                linkId,
                targetRealId: RealObjectReader.extractRealId(linkId),
                displayName: match[2] || ''
            });
        }
        return links;
    }

    /**
     * 孤立実身（refCount === 0）を検出
     * @returns {Promise<Array>} 孤立実身のメタデータ配列
     */
    async getUnreferencedRealObjects() {
        const allMetadata = await this.getAllMetadata();
        return allMetadata.filter(m => (m.refCount || 0) === 0);
    }

    /**
     * 仮身リンクを再帰的に追跡してグラフを構築
     * @param {string} realId - 起点実身ID
     * @param {number} maxDepth - 最大探索深度
     * @returns {Promise<{nodes: Array, edges: Array}>}
     */
    async traceLinkGraph(realId, maxDepth = 3) {
        const nodes = [];
        const edges = [];
        const visited = new Set();

        const traverse = async (currentRealId, depth) => {
            if (depth > maxDepth || visited.has(currentRealId)) return;
            visited.add(currentRealId);

            try {
                const { metadata, records } = await this.loadRealObject(currentRealId);
                nodes.push({ realId: currentRealId, name: metadata.name || '(名称なし)' });

                for (const record of records) {
                    const links = this.extractLinks(record.xtad);
                    for (const link of links) {
                        edges.push({
                            from: currentRealId,
                            to: link.targetRealId,
                            recordNo: record.recordNo
                        });
                        await traverse(link.targetRealId, depth + 1);
                    }
                }
            } catch (err) {
                // 参照先の実身が存在しない場合はスキップ
                nodes.push({ realId: currentRealId, name: '(読み込みエラー)' });
            }
        };

        await traverse(realId, 0);
        return { nodes, edges };
    }

    /**
     * 実身を名前・内容で検索
     * @param {string} query - 検索クエリ
     * @param {string} field - 検索対象フィールド ("name" | "content" | "all")
     * @returns {Promise<Array>}
     */
    async searchRealObjects(query, field = 'all') {
        const allMetadata = await this.getAllMetadata();
        const results = [];
        const queryLower = query.toLowerCase();

        for (const metadata of allMetadata) {
            // 名前検索
            if ((field === 'name' || field === 'all') && metadata.name) {
                if (metadata.name.toLowerCase().includes(queryLower)) {
                    results.push({
                        realId: metadata.realId,
                        name: metadata.name,
                        matchField: 'name',
                        matchSnippet: metadata.name
                    });
                    continue;
                }
            }

            // 内容検索
            if (field === 'content' || field === 'all') {
                try {
                    const { records } = await this.loadRealObject(metadata.realId);
                    for (const record of records) {
                        const plainText = this.extractPlainText(record.xtad);
                        const idx = plainText.toLowerCase().indexOf(queryLower);
                        if (idx >= 0) {
                            const start = Math.max(0, idx - 30);
                            const end = Math.min(plainText.length, idx + query.length + 30);
                            results.push({
                                realId: metadata.realId,
                                name: metadata.name,
                                matchField: 'content',
                                matchSnippet: plainText.substring(start, end)
                            });
                            break;
                        }
                    }
                } catch (err) {
                    // 読み込みエラーは無視
                }
            }
        }

        return results;
    }

    /**
     * linkIdからrealIdを抽出
     * @param {string} linkId - リンクID
     * @returns {string} 実身ID
     */
    static extractRealId(linkId) {
        if (!linkId) return '';
        let realId = linkId.replace(/\.(xtad|json)$/, '');
        realId = realId.replace(/_\d+$/, '');
        return realId;
    }
}

module.exports = { RealObjectReader };
