/**
 * electron/ipc-font.js
 * フォント関連のIPC通信ハンドラおよびユーティリティ関数
 * main.jsから分離
 */

const { ipcMain } = require('electron');
const { getLogger } = require('./logger.cjs');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const fontList = require('font-list');
const fontkit = require('fontkit');

const logger = getLogger('IPC-Font');

// フォントファイルから複数の名前（日本語名、英語名など）を取得
function getFontAllNames(fontPath, debugFontName = null) {
    try {
        const font = fontkit.openSync(fontPath);
        const nameTable = font['name'];

        if (!nameTable || !Array.isArray(nameTable.records)) {
            return null;
        }

        const names = {
            japanese: null,      // 日本語のフルネーム
            english: null,       // 英語のフルネーム
            japaneseFamily: null, // 日本語のファミリー名
            englishFamily: null   // 英語のファミリー名
        };

        // 日本語フルネーム (Windows platform, Japanese, Full Name)
        const jaFullName = nameTable.records.find(r =>
            r.platformID === 3 && r.languageID === 1041 && r.nameID === 4
        );
        if (jaFullName) {
            names.japanese = jaFullName.value;
        }

        // 日本語ファミリー名
        const jaFamily = nameTable.records.find(r =>
            r.platformID === 3 && r.languageID === 1041 && r.nameID === 1
        );
        if (jaFamily) {
            names.japaneseFamily = jaFamily.value;
        }

        // 英語フルネーム (Windows platform, English US, Full Name)
        const enFullName = nameTable.records.find(r =>
            r.platformID === 3 && r.languageID === 0x0409 && r.nameID === 4
        );
        if (enFullName) {
            names.english = enFullName.value;
        }

        // 英語ファミリー名
        const enFamily = nameTable.records.find(r =>
            r.platformID === 3 && r.languageID === 0x0409 && r.nameID === 1
        );
        if (enFamily) {
            names.englishFamily = enFamily.value;
        }

        return names;
    } catch (error) {
        logger.error('フォント名取得エラー:', fontPath, error.message);
        return null;
    }
}


// プラットフォーム別のフォントディレクトリを取得
function getFontDirectories() {
    if (process.platform === 'win32') {
        return [
            'C:\\Windows\\Fonts',
            path.join(process.env.LOCALAPPDATA || '', 'Microsoft\\Windows\\Fonts')
        ];
    } else if (process.platform === 'darwin') {
        return [
            '/Library/Fonts',
            '/System/Library/Fonts',
            '/System/Library/Fonts/Supplemental',
            path.join(process.env.HOME || '', 'Library/Fonts')
        ];
    } else {
        // Linux
        return [
            '/usr/share/fonts',
            '/usr/local/share/fonts',
            path.join(process.env.HOME || '', '.fonts'),
            path.join(process.env.HOME || '', '.local/share/fonts')
        ];
    }
}

// フォント名に対応するファイルパスを検索
function findFontFile(fontName) {
    const fontDirs = getFontDirectories();

    // フォント名から推測される可能性のあるファイル名
    const possibleNames = [
        `${fontName}.ttf`,
        `${fontName}.ttc`,
        `${fontName}.otf`,
        `${fontName.replace(/\s+/g, '')}.ttf`,
        `${fontName.replace(/\s+/g, '')}.ttc`,
        `${fontName.replace(/\s+/g, '')}.otf`,
        `${fontName.replace(/\s+/g, '').toLowerCase()}.ttf`,
        `${fontName.replace(/\s+/g, '').toLowerCase()}.ttc`,
        `${fontName.replace(/\s+/g, '').toLowerCase()}.otf`
    ];

    for (const dir of fontDirs) {
        if (!fs.existsSync(dir)) continue;

        for (const fileName of possibleNames) {
            const fullPath = path.join(dir, fileName);
            if (fs.existsSync(fullPath)) {
                return fullPath;
            }
        }

        // ディレクトリ内を検索してフォント名にマッチするファイルを探す
        try {
            const files = fs.readdirSync(dir);
            // フォント名の最初の単語を取得（より柔軟なマッチングのため）
            const firstWord = fontName.split(/\s+/)[0].toLowerCase();

            for (const file of files) {
                const ext = path.extname(file).toLowerCase();
                if (['.ttf', '.ttc', '.otf'].includes(ext)) {
                    const fileNameLower = file.toLowerCase();
                    const searchName = fontName.toLowerCase().replace(/\s+/g, '');
                    const fileNameNoExt = file.replace(/\.(ttf|ttc|otf)$/i, '').toLowerCase().replace(/[_\-\s]/g, '');

                    // 複数の条件でマッチング
                    if (fileNameLower.includes(searchName) ||
                        searchName.includes(fileNameNoExt) ||
                        fileNameLower.includes(firstWord)) {
                        return path.join(dir, file);
                    }
                }
            }
        } catch (error) {
            // ディレクトリ読み取りエラーは無視
        }
    }

    return null;
}

// PowerShellでDirectWrite APIを使ってフォント情報を取得（Windows専用）
async function getSystemFontsViaDirectWrite() {
    // Windows以外では空配列を返す
    if (process.platform !== 'win32') {
        logger.debug('getSystemFontsViaDirectWrite: Windows以外のプラットフォームではスキップ');
        return [];
    }

    const psScript = `
        Add-Type -AssemblyName PresentationCore

        $fonts = [System.Windows.Media.Fonts]::SystemFontFamilies
        $result = @()

        foreach ($font in $fonts) {
            # 日本語名と英語名を取得
            $japaneseName = $null
            $englishName = $null

            # 日本語名を取得（ja-jp）
            if ($font.FamilyNames.ContainsKey([System.Globalization.CultureInfo]::GetCultureInfo('ja-JP'))) {
                $japaneseName = $font.FamilyNames[[System.Globalization.CultureInfo]::GetCultureInfo('ja-JP')]
            }

            # 英語名を取得（en-us）
            if ($font.FamilyNames.ContainsKey([System.Globalization.CultureInfo]::GetCultureInfo('en-US'))) {
                $englishName = $font.FamilyNames[[System.Globalization.CultureInfo]::GetCultureInfo('en-US')]
            }

            # 不変の名前（システム名）
            $systemName = $font.Source

            # すべての利用可能な名前を取得
            $allNames = @()
            foreach ($key in $font.FamilyNames.Keys) {
                $name = $font.FamilyNames[$key]
                if ($name -and $allNames -notcontains $name) {
                    $allNames += $name
                }
            }

            $result += @{
                systemName = $systemName
                japanese = $japaneseName
                english = $englishName
                allNames = $allNames
            }
        }

        $result | ConvertTo-Json -Compress
    `;

    try {
        logger.debug('PowerShell DirectWrite APIでフォント取得開始');

        const output = execSync(`powershell -Command "${psScript.replace(/"/g, '\\"')}"`, {
            encoding: 'utf8',
            maxBuffer: 20 * 1024 * 1024
        });

        if (!output || output.trim().length === 0) {
            logger.error('PowerShell出力が空です');
            return [];
        }

        const items = JSON.parse(output);
        const itemsArray = Array.isArray(items) ? items : [items];

        logger.debug('DirectWriteから取得:', itemsArray.length, 'フォント');

        return itemsArray;
    } catch (error) {
        logger.error('DirectWriteフォント取得エラー:', error.message);
        return [];
    }
}

/**
 * フォント関連のIPCハンドラを登録
 */
function registerFontIpcHandlers() {
    // IPC通信: システムフォント一覧取得（日本語名付き）
    ipcMain.handle('get-system-fonts', async () => {
        try {
            logger.info('システムフォント一覧を取得中...');

            // font-list ライブラリで取得（日本語名対応済み）
            const fontNames = await fontList.getFonts({ disableQuoting: true });
            logger.debug('font-listから取得:', fontNames.length, 'フォント');

            // フォント情報を整形
            const fonts = fontNames.map(name => ({
                systemName: name,
                displayName: name,
                allNames: [name]
            }));

            logger.info('フォント情報取得完了:', fonts.length);
            return { success: true, fonts: fonts };
        } catch (error) {
            logger.error('システムフォント取得エラー:', error);
            return { success: false, fonts: [], error: error.message };
        }
    });
}

module.exports = {
    getFontAllNames,
    getFontDirectories,
    findFontFile,
    getSystemFontsViaDirectWrite,
    registerFontIpcHandlers
};
