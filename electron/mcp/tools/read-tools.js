/**
 * Tier 1: 読み取り系 MCP Tools
 *
 * 実身/仮身データベースの読み取り操作を提供する7つのTools。
 */

const { z } = require('zod');
const { RealObjectReader } = require('../mcp-real-object-reader');
const { getLogger } = require('../../logger.cjs');

const logger = getLogger('McpReadTools');

/**
 * 読み取り系Toolsをサーバに登録
 * @param {import('@modelcontextprotocol/sdk/server').McpServer} server
 * @param {string} dataFolder
 */
function registerReadTools(server, dataFolder) {
    const reader = new RealObjectReader(dataFolder);

    // 1. list_real_objects - 全実身のメタデータ一覧
    server.tool(
        'list_real_objects',
        '全実身のメタデータ一覧を取得します。名前、作成日、更新日、参照数等を返します。',
        {},
        async () => {
            try {
                const metadata = await reader.getAllMetadata();
                const summary = metadata.map(m => ({
                    realId: m.realId,
                    name: m.name,
                    refCount: m.refCount || 0,
                    recordCount: m.recordCount || 0,
                    makeDate: m.makeDate || '',
                    updateDate: m.updateDate || ''
                }));
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({ count: summary.length, realObjects: summary }, null, 2)
                    }]
                };
            } catch (err) {
                logger.error('list_real_objects エラー:', err);
                return { content: [{ type: 'text', text: `エラー: ${err.message}` }], isError: true };
            }
        }
    );

    // 2. read_real_object - 実身のメタデータ + XTADコンテンツ取得
    server.tool(
        'read_real_object',
        '指定した実身のメタデータとXTADコンテンツを取得します。',
        { realId: z.string().describe('実身ID (UUID形式)') },
        async ({ realId }) => {
            try {
                const { metadata, records } = await reader.loadRealObject(realId);
                const result = {
                    metadata: {
                        realId: metadata.realId,
                        name: metadata.name,
                        refCount: metadata.refCount || 0,
                        recordCount: metadata.recordCount || 0,
                        makeDate: metadata.makeDate || '',
                        updateDate: metadata.updateDate || '',
                        applist: metadata.applist || {}
                    },
                    records: records.map(r => ({
                        recordNo: r.recordNo,
                        xtadContent: r.xtad,
                        textPreview: reader.extractPlainText(r.xtad).substring(0, 500)
                    }))
                };
                return {
                    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
                };
            } catch (err) {
                logger.error('read_real_object エラー:', err);
                return { content: [{ type: 'text', text: `エラー: ${err.message}` }], isError: true };
            }
        }
    );

    // 3. read_xtad_content - XTAD XML + プレーンテキスト抽出
    server.tool(
        'read_xtad_content',
        '指定した実身のXTADコンテンツを読み取り、XML原文とプレーンテキストを返します。',
        {
            realId: z.string().describe('実身ID (UUID形式)'),
            recordNo: z.number().optional().default(0).describe('レコード番号 (デフォルト: 0)')
        },
        async ({ realId, recordNo }) => {
            try {
                const { records } = await reader.loadRealObject(realId);
                const record = records.find(r => r.recordNo === recordNo);
                if (!record) {
                    return {
                        content: [{ type: 'text', text: `レコード ${recordNo} が見つかりません` }],
                        isError: true
                    };
                }
                const links = reader.extractLinks(record.xtad);
                const result = {
                    realId,
                    recordNo,
                    xtadXml: record.xtad,
                    plainText: reader.extractPlainText(record.xtad),
                    linkCount: links.length
                };
                return {
                    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
                };
            } catch (err) {
                logger.error('read_xtad_content エラー:', err);
                return { content: [{ type: 'text', text: `エラー: ${err.message}` }], isError: true };
            }
        }
    );

    // 4. search_real_objects - 実身名・内容でのテキスト検索
    server.tool(
        'search_real_objects',
        '実身を名前や内容で検索します。',
        {
            query: z.string().describe('検索キーワード'),
            field: z.enum(['name', 'content', 'all']).optional().default('all')
                .describe('検索対象 (name: 名前のみ, content: 内容のみ, all: 両方)')
        },
        async ({ query, field }) => {
            try {
                const results = await reader.searchRealObjects(query, field);
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({ count: results.length, results }, null, 2)
                    }]
                };
            } catch (err) {
                logger.error('search_real_objects エラー:', err);
                return { content: [{ type: 'text', text: `エラー: ${err.message}` }], isError: true };
            }
        }
    );

    // 5. get_virtual_objects - 実身内の仮身（リンク）一覧
    server.tool(
        'get_virtual_objects',
        '指定した実身に含まれる仮身（リンク）の一覧を取得します。',
        { realId: z.string().describe('実身ID (UUID形式)') },
        async ({ realId }) => {
            try {
                const { records } = await reader.loadRealObject(realId);
                const allLinks = [];
                for (const record of records) {
                    const links = reader.extractLinks(record.xtad);
                    for (const link of links) {
                        // 参照先の実身名を取得
                        let targetName = '';
                        try {
                            const target = await reader.loadRealObject(link.targetRealId);
                            targetName = target.metadata.name || '';
                        } catch (_) {
                            targetName = '(存在しない実身)';
                        }
                        allLinks.push({
                            linkId: link.linkId,
                            targetRealId: link.targetRealId,
                            targetName,
                            displayName: link.displayName,
                            recordNo: record.recordNo
                        });
                    }
                }
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({ realId, count: allLinks.length, virtualObjects: allLinks }, null, 2)
                    }]
                };
            } catch (err) {
                logger.error('get_virtual_objects エラー:', err);
                return { content: [{ type: 'text', text: `エラー: ${err.message}` }], isError: true };
            }
        }
    );

    // 6. trace_link_graph - 仮身リンクの再帰追跡グラフ
    server.tool(
        'trace_link_graph',
        '指定した実身から仮身リンクを再帰的に追跡し、依存グラフを返します。',
        {
            realId: z.string().describe('起点の実身ID (UUID形式)'),
            depth: z.number().optional().default(3).describe('最大探索深度 (デフォルト: 3, 最大: 10)')
        },
        async ({ realId, depth }) => {
            try {
                const maxDepth = Math.min(depth, 10);
                const graph = await reader.traceLinkGraph(realId, maxDepth);
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            rootRealId: realId,
                            nodeCount: graph.nodes.length,
                            edgeCount: graph.edges.length,
                            ...graph
                        }, null, 2)
                    }]
                };
            } catch (err) {
                logger.error('trace_link_graph エラー:', err);
                return { content: [{ type: 'text', text: `エラー: ${err.message}` }], isError: true };
            }
        }
    );

    // 7. find_unreferenced - 孤立実身の検出
    server.tool(
        'find_unreferenced',
        '参照カウントが0の孤立実身を検出します。',
        {},
        async () => {
            try {
                const unreferenced = await reader.getUnreferencedRealObjects();
                const summary = unreferenced.map(m => ({
                    realId: m.realId,
                    name: m.name,
                    updateDate: m.updateDate || ''
                }));
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({ count: summary.length, unreferencedObjects: summary }, null, 2)
                    }]
                };
            } catch (err) {
                logger.error('find_unreferenced エラー:', err);
                return { content: [{ type: 'text', text: `エラー: ${err.message}` }], isError: true };
            }
        }
    );

    logger.info(`読み取り系Tools 7個を登録完了`);
}

module.exports = { registerReadTools };
