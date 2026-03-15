/**
 * Tier 3: 変換・ユーティリティ系 MCP Tools
 *
 * TAD/BPK変換やテキストエクスポートを提供する3つのTools。
 */

const { z } = require('zod');
const fs = require('fs');
const path = require('path');
const { RealObjectReader } = require('../mcp-real-object-reader');
const { getLogger } = require('../../logger.cjs');

const logger = getLogger('McpConvertTools');

/**
 * 変換・ユーティリティ系Toolsをサーバに登録
 * @param {import('@modelcontextprotocol/sdk/server').McpServer} server
 * @param {string} dataFolder
 */
function registerConvertTools(server, dataFolder) {
    const reader = new RealObjectReader(dataFolder);

    // 1. export_as_text - 実身の内容をプレーンテキストとしてエクスポート
    server.tool(
        'export_as_text',
        '指定した実身の全レコードをプレーンテキストとしてエクスポートします。',
        { realId: z.string().describe('実身ID (UUID形式)') },
        async ({ realId }) => {
            try {
                const { metadata, records } = await reader.loadRealObject(realId);
                const texts = records.map(r => reader.extractPlainText(r.xtad));
                const fullText = texts.join('\n\n--- レコード区切り ---\n\n');
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            realId,
                            name: metadata.name || '',
                            recordCount: records.length,
                            plainText: fullText
                        }, null, 2)
                    }]
                };
            } catch (err) {
                logger.error('export_as_text エラー:', err);
                return { content: [{ type: 'text', text: `エラー: ${err.message}` }], isError: true };
            }
        }
    );

    // 2. extract_bpk - BPK書庫の内容一覧
    server.tool(
        'extract_bpk',
        'BPK書庫ファイルの内容一覧を取得します。LH5圧縮されたアーカイブの中身を表示します。',
        { bpkPath: z.string().describe('BPKファイルのパス') },
        async ({ bpkPath }) => {
            try {
                const resolvedPath = path.resolve(bpkPath);
                if (!fs.existsSync(resolvedPath)) {
                    return {
                        content: [{ type: 'text', text: `ファイルが見つかりません: ${resolvedPath}` }],
                        isError: true
                    };
                }

                const rawData = await fs.promises.readFile(resolvedPath);

                // LH5ヘッダーを解析してエントリ一覧を取得
                const entries = parseBpkHeaders(rawData);

                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            path: resolvedPath,
                            fileSize: rawData.length,
                            entryCount: entries.length,
                            entries
                        }, null, 2)
                    }]
                };
            } catch (err) {
                logger.error('extract_bpk エラー:', err);
                return { content: [{ type: 'text', text: `エラー: ${err.message}` }], isError: true };
            }
        }
    );

    // 3. convert_tad_to_xtad - バイナリTAD→XTAD変換
    server.tool(
        'convert_tad_to_xtad',
        'バイナリTADデータをXTAD (XML形式) に変換します。base64エンコードされたTADデータを受け取ります。',
        { tadData: z.string().describe('base64エンコードされたTADバイナリデータ') },
        async ({ tadData }) => {
            try {
                const rawData = Buffer.from(tadData, 'base64');
                const xtadXml = await convertTadToXtad(rawData, dataFolder);
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            inputSize: rawData.length,
                            xtadXml
                        }, null, 2)
                    }]
                };
            } catch (err) {
                logger.error('convert_tad_to_xtad エラー:', err);
                return { content: [{ type: 'text', text: `エラー: ${err.message}` }], isError: true };
            }
        }
    );

    logger.info(`変換・ユーティリティ系Tools 3個を登録完了`);
}

/**
 * BPKファイルのヘッダーを解析してエントリ一覧を取得
 * LH5形式のヘッダー構造を直接パース
 * @param {Buffer} rawData - BPKファイルのバイナリデータ
 * @returns {Array}
 */
function parseBpkHeaders(rawData) {
    const entries = [];
    let offset = 0;

    while (offset < rawData.length) {
        // ヘッダーサイズ (1バイト目)
        const headerSize = rawData[offset];
        if (headerSize === 0) break;

        // チェックサム (2バイト目)
        // const checksum = rawData[offset + 1];

        // 圧縮メソッド (3-7バイト目, 5バイト: "-lh5-" 等)
        const method = rawData.slice(offset + 2, offset + 7).toString('ascii');

        // 圧縮後サイズ (7-11バイト目, 4バイトLE)
        const compressedSize = rawData.readUInt32LE(offset + 7);

        // 元サイズ (11-15バイト目, 4バイトLE)
        const originalSize = rawData.readUInt32LE(offset + 11);

        // ファイル名の長さ (22バイト目)
        const nameLength = rawData[offset + 21];

        // ファイル名 (23バイト目から)
        const filename = rawData.slice(offset + 22, offset + 22 + nameLength).toString('ascii');

        entries.push({
            filename,
            compressedSize,
            originalSize,
            method: method.replace(/-/g, '')
        });

        // 次のエントリへ（ヘッダー + 2バイト + 圧縮データ）
        offset += headerSize + 2 + compressedSize;
    }

    return entries;
}

/**
 * バイナリTADをXTADに変換する
 * plugins/unpack-file/unpack.js の parseTADToXML を利用
 * @param {Buffer} rawData - TADバイナリデータ
 * @param {string} dataFolder - データフォルダパス
 * @returns {Promise<string>} XTAD XML文字列
 */
async function convertTadToXtad(rawData, dataFolder) {
    // unpack.jsのwindow/document依存をスタブで解消
    const globalBackup = {
        window: global.window,
        document: global.document
    };

    try {
        // 最小限のwindow/documentスタブ
        global.window = global.window || {};
        global.window.getLogger = () => logger;
        global.window.CHAR_BIT = 8;
        global.window.UCHAR_MAX = 255;
        global.window.currentPageNumber = 1;
        global.window.activeOverlays = [];
        global.window.figureActiveOverlays = [];
        global.window.paperOverlays = {};
        global.window.figurePaperOverlays = {};
        global.window.currentRawData = null;
        global.window.canvas = { id: 'canvas-0' };
        global.window.linkRecordList = [];
        global.window.originalLinkId = undefined;

        global.document = global.document || {};
        global.document.getElementById = () => null;
        global.document.createElement = (tag) => {
            if (tag === 'canvas') {
                return { getContext: () => null, width: 0, height: 0 };
            }
            return {};
        };

        // encoding.jsの読み込み（TRON文字コード変換）
        const encodingPath = path.join(dataFolder, '..', 'encoding.js');
        if (fs.existsSync(encodingPath)) {
            try {
                require(encodingPath);
            } catch (_) {
                // encoding.jsが読み込めなくても続行
            }
        }

        // unpack.jsを読み込み
        const unpackPath = path.join(dataFolder, '..', 'plugins', 'unpack-file', 'unpack.js');
        if (!fs.existsSync(unpackPath)) {
            throw new Error('unpack.jsが見つかりません。TAD→XTAD変換にはunpack.jsが必要です。');
        }

        // unpack.jsはグローバルスコープに関数をエクスポートするため、requireで読み込む
        // 注: 既にrequire済みの場合はキャッシュが使われる
        require(unpackPath);

        if (typeof global.window.parseTADToXML !== 'function') {
            throw new Error('parseTADToXML関数が利用できません');
        }

        const rawArray = new Uint8Array(rawData);
        const result = await global.window.parseTADToXML(rawArray, 0);
        return result || '';
    } finally {
        // グローバルスコープを復元
        if (globalBackup.window === undefined) {
            delete global.window;
        } else {
            global.window = globalBackup.window;
        }
        if (globalBackup.document === undefined) {
            delete global.document;
        } else {
            global.document = globalBackup.document;
        }
    }
}

module.exports = { registerConvertTools };
