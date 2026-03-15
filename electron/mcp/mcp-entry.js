/**
 * MCP サーバ独立エントリーポイント
 *
 * 外部プロセス（Claude Desktop / Claude Code）から起動する場合に使用。
 * ELECTRON_RUN_AS_NODE=1 環境変数でElectron exeをNode.jsモードで動作させ、
 * このスクリプトを直接実行する。
 *
 * 使用例:
 *   ELECTRON_RUN_AS_NODE=1 tadjs_desktop.exe electron/mcp/mcp-entry.js
 *
 * Claude Desktop / Claude Code 設定例:
 *   {
 *     "mcpServers": {
 *       "tadjs": {
 *         "command": "C:\\path\\to\\TADjs Desktop-win32-x64\\tadjs_desktop.exe",
 *         "args": ["C:\\path\\to\\TADjs Desktop-win32-x64\\resources\\app\\electron\\mcp\\mcp-entry.js"],
 *         "env": {
 *           "ELECTRON_RUN_AS_NODE": "1",
 *           "TADJS_MCP_DATA_FOLDER": "C:\\path\\to\\TADjs Desktop-win32-x64\\data"
 *         }
 *       }
 *     }
 *   }
 */

const path = require('path');

// console.logがstdoutに出力されるとMCPプロトコルが壊れるためstderrにリダイレクト
const originalConsoleLog = console.log;
console.log = (...args) => console.error('[MCP]', ...args);

console.error('[MCP-Entry] 起動 PID=' + process.pid);

// dataFolderの決定
// 優先順位: 環境変数 > コマンドライン引数 > デフォルト（exeと同階層のdata/）
let dataFolder;

const dataFolderArg = process.argv.indexOf('--data-folder');
if (process.env.TADJS_MCP_DATA_FOLDER) {
    dataFolder = process.env.TADJS_MCP_DATA_FOLDER;
} else if (dataFolderArg >= 0 && process.argv[dataFolderArg + 1]) {
    dataFolder = process.argv[dataFolderArg + 1];
} else {
    // デフォルト: エントリーポイントから2階層上（resources/app/）のdata/
    // パッケージ構造: resources/app/electron/mcp/mcp-entry.js
    //                 resources/app/data/
    dataFolder = path.join(__dirname, '..', '..', 'data');
}

console.error('[MCP-Entry] dataFolder=' + dataFolder);

// MCPサーバ起動
const { startMcpServer } = require('./mcp-server');

startMcpServer(dataFolder)
    .then(() => {
        console.error('[MCP-Entry] サーバ稼働中');
    })
    .catch((err) => {
        console.error('[MCP-Entry] 起動エラー:', err.stack || err);
        process.exit(1);
    });

// プロセス終了ハンドラ
process.on('uncaughtException', (err) => {
    console.error('[MCP-Entry] uncaughtException:', err.stack || err);
});
process.on('unhandledRejection', (reason) => {
    console.error('[MCP-Entry] unhandledRejection:', reason);
});
