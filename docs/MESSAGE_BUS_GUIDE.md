# MessageBus 使用ガイドライン

> **注意**: このドキュメントの内容は [プラグイン開発ガイド](PLUGIN_DEVELOPMENT_GUIDE.md) に統合されました。
> 新規開発者は統合版ドキュメントを参照してください。
> 本ファイルは後方互換性のため保持されています。

---

## 概要

MessageBusは、TADjs Desktopのプラグインと親ウィンドウ間のメッセージング を統一的に管理するためのクラスです。

## 目的

- **一貫性**: すべてのプラグインで統一されたメッセージング API
- **信頼性**: タイムアウト処理、エラーハンドリングの自動化
- **保守性**: レガシーな手動イベントリスナー管理を不要に
- **デバッグ性**: デバッグモードで全メッセージを追跡可能

## 基本的な使い方

### 1. MessageBusの初期化

```javascript
// プラグインのコンストラクタ
constructor() {
    this.messageBus = null;
    if (window.MessageBus) {
        this.messageBus = new window.MessageBus({
            debug: false,  // デバッグモード（trueでログ出力）
            pluginName: 'YourPluginName'
        });
        this.messageBus.start();
    }
}

// 初期化時にハンドラを登録
init() {
    if (this.messageBus) {
        this.setupMessageBusHandlers();
    }
}
```

### 2. メッセージハンドラの登録

```javascript
/**
 * Phase 2: MessageBusのみで動作
 */
setupMessageBusHandlers() {
    // 初期化メッセージ
    this.messageBus.on('init', (data) => {
        console.log('[Plugin] init受信', data);
        this.loadFile(data.fileData);
    });

    // ウィンドウ移動
    this.messageBus.on('window-moved', (data) => {
        this.updateWindowConfig({
            pos: data.pos,
            width: data.width,
            height: data.height
        });
    });

    // メニューアクション
    this.messageBus.on('menu-action', (data) => {
        this.executeMenuAction(data.action);
    });
}
```

## 主要なAPIメソッド

### `on(messageType, handler)`

メッセージハンドラを登録します。

```javascript
this.messageBus.on('message-type', (data, event) => {
    // data: メッセージデータ
    // event: 元のMessageEvent（通常は不要）
});
```

### `off(messageType)`

ハンドラを削除します。

```javascript
this.messageBus.off('message-type');
```

### `send(type, data)`

親ウィンドウにメッセージを送信します。

```javascript
this.messageBus.send('save-file', {
    fileId: this.fileId,
    content: this.getContent()
});
```

### `sendWithCallback(type, data, callback, timeout)`

コールバック付きでメッセージを送信します（**推奨**）。

```javascript
this.messageBus.sendWithCallback('show-input-dialog', {
    message: '名前を入力してください',
    defaultValue: ''
}, (result) => {
    if (result.error) {
        console.warn('Dialog error:', result.error);
        return;
    }
    console.log('入力値:', result.value);
}, 5000); // タイムアウト5秒（デフォルト）
```

#### エラーハンドリング

タイムアウト時やエラー時、`result.error`が設定されます:

```javascript
this.messageBus.sendWithCallback('request', data, (result) => {
    if (result.error === 'timeout') {
        console.warn('タイムアウト:', result.messageId);
        // タイムアウト時の処理
        return;
    }
    // 正常なレスポンス処理
});
```

### `waitFor(messageType, timeout)`

Promise ベースでメッセージを待ちます（**推奨**）。

```javascript
async function loadData() {
    const messageId = `load-${Date.now()}`;
    this.messageBus.send('load-request', { messageId });

    try {
        const result = await this.messageBus.waitFor('load-response-' + messageId, 5000);
        console.log('データ受信:', result);
        return result.data;
    } catch (error) {
        console.error('読み込み失敗:', error);
        return null;
    }
}
```

## 使用パターン

### パターン1: ダイアログ表示（sendWithCallback）

```javascript
showInputDialog(message, defaultValue = '') {
    return new Promise((resolve) => {
        this.messageBus.sendWithCallback('show-input-dialog', {
            message: message,
            defaultValue: defaultValue
        }, (result) => {
            if (result.error) {
                resolve(null);
                return;
            }
            resolve(result.value);
        });
    });
}
```

### パターン2: データ取得（waitFor）

```javascript
async loadRealObject(realId) {
    const messageId = `load-real-${Date.now()}`;
    this.messageBus.send('load-real-object-data', {
        messageId: messageId,
        realId: realId
    });

    try {
        const result = await this.messageBus.waitFor('real-object-loaded-' + messageId, 5000);
        return result.realObject;
    } catch (error) {
        console.error('Failed to load real object:', error);
        throw error;
    }
}
```

### パターン3: イベント通知（send のみ）

```javascript
notifyChange() {
    this.messageBus.send('file-modified', {
        fileId: this.fileId,
        isModified: true
    });
}
```

## ベストプラクティス

### ✅ 推奨事項

1. **MessageBusのみを使用**
   - `window.addEventListener('message')`は使用しない
   - `window.parent.postMessage()`の直接呼び出しを避ける

2. **エラーハンドリングを必ず実装**
   ```javascript
   // ✅ Good
   this.messageBus.sendWithCallback('request', data, (result) => {
       if (result.error) {
           handleError(result.error);
           return;
       }
       handleSuccess(result);
   });

   // ❌ Bad
   this.messageBus.sendWithCallback('request', data, (result) => {
       handleSuccess(result); // エラーチェックなし
   });
   ```

3. **適切なタイムアウト設定**
   - デフォルト: 5000ms
   - 時間のかかる処理: 30000ms
   - ユーザーインタラクション待ち: 0 (無制限)

4. **messageIdの一意性を保証**
   ```javascript
   const messageId = `${prefix}-${Date.now()}-${Math.random()}`;
   ```

### ❌ アンチパターン

1. **dialogCallbacksの使用**
   ```javascript
   // ❌ Bad: レガシーな手動管理
   this.dialogCallbacks = {};
   this.dialogCallbacks[messageId] = callback;

   // ✅ Good: MessageBusに任せる
   this.messageBus.sendWithCallback('dialog', data, callback);
   ```

2. **一時的なイベントリスナー**
   ```javascript
   // ❌ Bad
   const handler = (e) => { ... };
   window.addEventListener('message', handler);
   // リスナーの削除忘れのリスク

   // ✅ Good
   await this.messageBus.waitFor('response', 5000);
   ```

3. **タイムアウト処理の欠如**
   ```javascript
   // ❌ Bad: タイムアウトなし
   return new Promise((resolve) => {
       window.addEventListener('message', handler);
       // 永遠に待ち続ける可能性
   });

   // ✅ Good
   await this.messageBus.waitFor('response', 5000);
   // 自動的に5秒後にエラー
   ```

## デバッグ

### デバッグモードの有効化

```javascript
this.messageBus = new window.MessageBus({
    debug: true,  // すべてのメッセージをログ出力
    pluginName: 'PluginName'
});
```

### ログ出力例

```
[MessageBus:PluginName] Sent message: init {"fileData":{...}}
[MessageBus:PluginName] Received message: window-moved {"pos":[10,20],...}
[MessageBus:PluginName] Callback executed for: dialog_123_1234567890
```

## 移行ガイド

### レガシーコードからの移行

#### Before（レガシー）
```javascript
showDialog(message) {
    return new Promise((resolve) => {
        const messageId = `dialog-${Date.now()}`;

        // 手動コールバック管理
        this.dialogCallbacks[messageId] = (result) => {
            resolve(result.value);
        };

        // 直接postMessage
        window.parent.postMessage({
            type: 'show-dialog',
            messageId: messageId,
            message: message
        }, '*');

        // 手動タイムアウト処理
        setTimeout(() => {
            if (this.dialogCallbacks[messageId]) {
                delete this.dialogCallbacks[messageId];
                resolve(null);
            }
        }, 5000);
    });
}
```

#### After（MessageBus）
```javascript
showDialog(message) {
    return new Promise((resolve) => {
        this.messageBus.sendWithCallback('show-dialog', {
            message: message
        }, (result) => {
            resolve(result.error ? null : result.value);
        }); // タイムアウト処理は自動
    });
}
```

## 参考実装

### 理想的な実装例
[plugins/tadjs-view/app.js](../plugins/tadjs-view/app.js) - クリーンな Phase 2 実装

### 移行済みプラグイン
- ✅ basic-text-editor - 完全移行
- ✅ tadjs-view - 完全移行
- ✅ virtual-object-list - 完全移行
- ✅ basic-figure-editor - 完全移行
- ✅ base-file-manager - 完全移行

### 未移行プラグイン（移行推奨）
- ⚠️ system-config
- ⚠️ user-config
- ⚠️ trash-real-objects
- ⚠️ unpack-file
- ⚠️ existing-data-exec
- ⚠️ url-link-exec

## まとめ

MessageBusを使用することで:
- ✅ コードが簡潔になる
- ✅ エラーハンドリングが自動化される
- ✅ タイムアウト処理が統一される
- ✅ デバッグが容易になる
- ✅ 保守性が向上する

新規プラグインは必ずMessageBusを使用してください。既存プラグインも段階的に移行を推奨します。
