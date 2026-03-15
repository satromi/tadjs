/**
 * TADjs Desktop MCPサーバ
 *
 * Electron内蔵型MCPサーバ。stdioトランスポートで動作し、
 * 実身/仮身データベースへの読み取りアクセスを提供する。
 */

// Electron packaged環境では package.json exports "./*" パターンが正しく解決されないため、
// exportsをバイパスして絶対パスでCJSファイルを直接requireする
const path = require('path');
const fs = require('fs');
const sdkCjsDir = path.join(__dirname, '..', '..', 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'cjs');
const { McpServer } = require(path.join(sdkCjsDir, 'server', 'mcp.js'));
const { StdioServerTransport } = require(path.join(sdkCjsDir, 'server', 'stdio.js'));
const { getLogger } = require('../logger.cjs');
const { registerReadTools } = require('./tools/read-tools');
const { registerConvertTools } = require('./tools/convert-tools');

const logger = getLogger('McpServer');

/**
 * MCPサーバを起動する
 * @param {string} dataFolder - 実身データフォルダのパス
 */
async function startMcpServer(dataFolder) {
    console.error('[MCP-Server] startMcpServer() 開始 dataFolder=' + dataFolder);

    const server = new McpServer({
        name: 'tadjs-desktop',
        version: '1.0.0'
    });

    // Tools登録
    registerReadTools(server, dataFolder);
    console.error('[MCP-Server] ReadTools 登録完了');
    registerConvertTools(server, dataFolder);
    console.error('[MCP-Server] ConvertTools 登録完了');

    // Electron/Chromiumはprocess.stdinのパイプ入力を正しく処理しないため、
    // fs.createReadStreamでfd 0から直接読み取るストリームを作成してバイパスする
    const stdinStream = fs.createReadStream(null, { fd: 0 });
    const transport = new StdioServerTransport(stdinStream, process.stdout);

    transport.onerror = (error) => {
        console.error('[MCP-Server] transport error:', error.message || error);
    };

    await server.connect(transport);
    console.error('[MCP-Server] server.connect(transport) 完了 - stdio待受中');

    server.server.onerror = (error) => {
        console.error('[MCP-Server] server error:', error.message || error);
    };
}

module.exports = { startMcpServer };
