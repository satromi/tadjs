/**
 * UUID v7生成のテストスクリプト
 */

// tadjs-desktop.jsのgenerateUUIDv7メソッドを抽出して実行
function generateUUIDv7() {
    // 現在時刻のミリ秒タイムスタンプ（48ビット）
    const timestamp = Date.now();

    // 暗号学的に安全な乱数を生成（80ビット）
    const randomBytes = new Uint8Array(10);
    // ブラウザ環境とNode.js環境の両方に対応
    if (typeof window !== 'undefined' && window.crypto) {
        window.crypto.getRandomValues(randomBytes);
    } else if (typeof globalThis !== 'undefined' && globalThis.crypto) {
        globalThis.crypto.getRandomValues(randomBytes);
    } else {
        // フォールバック: Math.randomを使用（非推奨だが互換性のため）
        for (let i = 0; i < randomBytes.length; i++) {
            randomBytes[i] = Math.floor(Math.random() * 256);
        }
    }

    // UUID v7の構造:
    // - 48ビット: Unix タイムスタンプ（ミリ秒）
    // - 4ビット: バージョン（0111 = 7）
    // - 12ビット: ランダムA
    // - 2ビット: バリアント（10）
    // - 62ビット: ランダムB

    // タイムスタンプを16進数文字列に変換（12桁）
    const timestampHex = timestamp.toString(16).padStart(12, '0');

    // ランダムバイトを16進数に変換
    const randomHex = Array.from(randomBytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

    // UUID v7フォーマットに組み立て
    // time_high (32ビット) + time_mid (16ビット)
    const timeLow = timestampHex;

    // time_hi_and_version: ランダム12ビット + バージョン4ビット(0111)
    const timeHiAndVersion = '7' + randomHex.substring(0, 3);

    // clock_seq_hi_and_reserved: バリアント2ビット(10) + ランダム6ビット
    const clockSeqByte = parseInt(randomHex.substring(3, 5), 16);
    const clockSeqHi = ((clockSeqByte & 0x3F) | 0x80).toString(16).padStart(2, '0');

    // clock_seq_low: ランダム8ビット
    const clockSeqLow = randomHex.substring(5, 7);

    // node: ランダム48ビット
    const node = randomHex.substring(7, 19);

    // 8-4-4-4-12フォーマットで結合
    return `${timeLow.substring(0, 8)}-${timeLow.substring(8, 12)}-${timeHiAndVersion}-${clockSeqHi}${clockSeqLow}-${node}`;
}

console.log('=== UUID v7生成テスト ===\n');

// 10個のUUID v7を生成
console.log('10個のUUID v7を生成:\n');
for (let i = 1; i <= 10; i++) {
    const uuid = generateUUIDv7();
    console.log(`${i.toString().padStart(2, ' ')}. ${uuid}`);

    // バージョンとバリアントを検証
    const versionChar = uuid.charAt(14);
    const variantChar = uuid.charAt(19);
    const variantBits = parseInt(variantChar, 16);

    if (versionChar !== '7') {
        console.log(`   ⚠️  バージョンエラー: ${versionChar} (期待値: 7)`);
    }
    if ((variantBits & 0xC) !== 0x8) {
        console.log(`   ⚠️  バリアントエラー: ${variantChar} (期待値: 8-b)`);
    }
}

console.log('\n=== タイムスタンプ順序テスト ===\n');

// タイムスタンプ順序を検証
const uuids = [];
for (let i = 0; i < 5; i++) {
    const uuid = generateUUIDv7();
    const timestamp = parseInt(uuid.substring(0, 8) + uuid.substring(9, 13), 16);
    uuids.push({ uuid, timestamp });
    console.log(`${uuid} -> タイムスタンプ: ${timestamp} (${new Date(timestamp).toISOString()})`);

    // 少し待機して時系列を確認
    const start = Date.now();
    while (Date.now() - start < 10) { }
}

console.log('\n=== フォーマット検証 ===\n');

const testUuid = generateUUIDv7();
console.log(`サンプルUUID: ${testUuid}`);
console.log(`長さ: ${testUuid.length} (期待値: 36)`);
console.log(`形式: ${testUuid.match(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i) ? '✓ 正しい' : '✗ 不正'}`);

// 各セクションを分解
const parts = testUuid.split('-');
console.log(`\nセクション分解:`);
console.log(`  time_low:            ${parts[0]} (8桁)`);
console.log(`  time_mid:            ${parts[1]} (4桁)`);
console.log(`  time_hi_and_version: ${parts[2]} (4桁, 先頭=7)`);
console.log(`  clock_seq:           ${parts[3]} (4桁, 先頭=8-b)`);
console.log(`  node:                ${parts[4]} (12桁)`);

console.log('\n完了!');
