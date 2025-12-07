# プラグイン開発ガイド

BTRON Desktopのプラグイン開発に関する総合ガイドです。

---

## 目次

1. [概要](#1-概要)
2. [基本構造](#2-基本構造)
3. [PluginBaseの使用](#3-pluginbaseの使用)
4. [MessageBus通信](#4-messagebus通信)
5. [仮身/実身操作](#5-仮身実身操作)
6. [ダイアログ表示](#6-ダイアログ表示)
7. [ツールパネル（子ウィンドウ）](#7-ツールパネル子ウィンドウ)
8. [参考実装](#8-参考実装)
9. [トラブルシューティング](#9-トラブルシューティング)

---

## 1. 概要

### 1.1 アーキテクチャ

プラグインは以下の構造で動作します：

```text
┌─────────────────────────────────────────┐
│           親ウィンドウ                    │
│         (tadjs-desktop.js)               │
│                                          │
│  ┌──────────┐  ┌──────────┐             │
│  │ iframe   │  │ iframe   │  ...        │
│  │(Plugin A)│  │(Plugin B)│             │
│  └──────────┘  └──────────┘             │
│                                          │
│       ↑↓ postMessage (MessageBus)        │
└─────────────────────────────────────────┘
```

- プラグインは **iframe内** で動作
- 親ウィンドウとは **postMessage**（MessageBus）で通信
- 共通機能は **PluginBase** クラスを継承して利用

### 1.2 プラグインタイプ

| タイプ | 説明 | 例 |
|-------|------|-----|
| `base` | 原紙タイプ（原紙箱に表示） | basic-text-editor, basic-figure-editor, basic-calc-editor, unpack-file, virtual-object-list |
| `accessory` | 小物タイプ（アクセサリメニューから起動） | system-config, user-config, file-import |
| `utility` | ユーティリティタイプ | trash-real-objects |
| `genko` | 原稿タイプ | tadjs-view |

---

## 2. 基本構造

### 2.1 ディレクトリ構成

```text
plugins/
└── my-plugin/
    ├── plugin.json      # プラグイン設定（必須）
    ├── index.html       # メインHTML（必須）
    ├── app.js           # メインスクリプト
    └── style.css        # スタイル（任意）
```

### 2.2 plugin.json仕様

```json
{
  "id": "my-plugin",
  "name": "マイプラグイン",
  "version": "1.0.0",
  "type": "accessory",
  "description": "プラグインの説明",
  "icon": "🔧",
  "author": "作成者",
  "main": "index.html",
  "needsCloseConfirmation": false,
  "window": {
    "width": 600,
    "height": 400,
    "resizable": true,
    "scrollable": true,
    "openable": true
  },
  "contextMenu": [
    {
      "label": "メニュー項目名",
      "fileTypes": ["tad", "TAD"],
      "action": "open-editor"
    }
  ],
  "permissions": [
    "file-read",
    "file-write"
  ]
}
```

#### 主要プロパティ

| プロパティ | 必須 | 説明 |
|-----------|:----:|------|
| `id` | ○ | プラグイン識別子（フォルダ名と同じ） |
| `name` | ○ | 表示名 |
| `type` | ○ | プラグインタイプ |
| `main` | ○ | エントリーHTMLファイル |
| `needsCloseConfirmation` | - | true: 閉じる時に確認ダイアログ表示 |
| `window.openable` | - | true: 仮身を開いた時にiframe表示可能 |
| `basefile` | - | 原紙ファイルの定義（baseタイプのみ） |

### 2.3 index.html構成

```html
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <title>プラグイン名</title>
    <link rel="stylesheet" href="style.css">
    <!-- 共通ライブラリの読み込み -->
    <script src="../../js/logger.js"></script>
    <script src="../../js/util.js"></script>
    <script src="../../js/message-bus-global.js"></script>
    <script src="../../js/plugin-base-global.js"></script>
</head>
<body>
    <div class="plugin-content">
        <!-- プラグインのコンテンツ -->
    </div>
    <script src="app.js"></script>
</body>
</html>
```

---

## 3. PluginBaseの使用

### 3.1 継承パターン

```javascript
/**
 * マイプラグイン
 * @extends PluginBase
 */
const logger = window.getLogger('MyPlugin');

class MyPlugin extends window.PluginBase {
    constructor() {
        super('MyPlugin');  // プラグイン名を渡す

        // プラグイン固有のプロパティ
        this.isModified = false;
    }

    /**
     * 初期化処理
     */
    async init() {
        // MessageBusの初期化
        this.messageBus = new window.MessageBus({
            pluginName: this.pluginName,
            debug: this.debug
        });
        this.messageBus.start();

        // 共通コンポーネントの初期化
        this.initializeCommonComponents('[MY_PLUGIN]');

        // 共通イベントハンドラの設定
        this.setupWindowActivation();
        this.setupContextMenu();
        this.setupVirtualObjectRightButtonHandlers();

        // MessageBusハンドラの設定
        this.setupMessageBusHandlers();

        // initメッセージを送信して初期化データを受け取る
        this.messageBus.sendWithCallback('init', {}, (data) => {
            this.windowId = data.windowId;
            this.realId = data.realId;
            this.onInitialized(data);
        });
    }
}

// DOMContentLoaded後に初期化
document.addEventListener('DOMContentLoaded', () => {
    window.myPlugin = new MyPlugin();
    window.myPlugin.init();
});
```

### 3.2 初期化フロー

```text
1. constructor()
   └── super('PluginName') を呼び出し

2. init()
   ├── MessageBus初期化・開始
   ├── initializeCommonComponents() - 共通コンポーネント初期化
   ├── setupWindowActivation() - ウィンドウアクティベーション設定
   ├── setupContextMenu() - コンテキストメニュー設定
   ├── setupVirtualObjectRightButtonHandlers() - 仮身ドラッグ設定
   ├── setupMessageBusHandlers() - MessageBusハンドラ登録
   │   └── setupCommonMessageBusHandlers() - 共通ハンドラ登録
   └── 'init' メッセージ送信 → onInitialized() コールバック

3. onInitialized(data)
   └── プラグイン固有の初期化処理
```

### 3.3 共通メソッド一覧

#### ダイアログ表示

| メソッド | 戻り値 | 説明 |
|---------|--------|------|
| `showInputDialog(message, defaultValue, inputWidth)` | `string \| null` | 入力ダイアログ。キャンセル時はnull |
| `showSaveConfirmDialog()` | `'yes' \| 'no' \| 'cancel'` | 保存確認ダイアログ |
| `showMessageDialog(message, buttons, defaultButton)` | `string` | カスタムボタンダイアログ |

#### 仮身/実身操作

| メソッド | 説明 |
|---------|------|
| `loadRealObjectData(realId)` | 実身データを読み込む |
| `duplicateRealObject()` | 選択中の仮身が指す実身を複製 |
| `renameRealObject()` | 選択中の仮身が指す実身の名前を変更 |
| `closeRealObject()` | 選択中の仮身が指す実身を閉じる |
| `extractRealId(linkId)` | linkIdから実身IDを抽出 |
| `requestCopyVirtualObject(linkId)` | 仮身コピー（refCount+1） |
| `requestDeleteVirtualObject(linkId)` | 仮身削除（refCount-1） |

#### ウィンドウ操作

| メソッド | 説明 |
|---------|------|
| `activateWindow()` | ウィンドウをアクティブ化 |
| `toggleMaximize()` | 最大化/復元を切り替え |
| `closeContextMenu()` | コンテキストメニューを閉じる |
| `updateWindowConfig(config)` | ウィンドウ設定を保存 |

#### クリップボード

| メソッド | 説明 |
|---------|------|
| `getClipboard()` | クリップボードデータを取得 |
| `setClipboard(data)` | クリップボードにデータを設定 |

#### 仮身ドラッグ

| メソッド | 説明 |
|---------|------|
| `initializeVirtualObjectDragStart(e)` | ドラッグ開始時の共通処理 |
| `setVirtualObjectDragData(e, virtualObjects, source)` | ドラッグデータを設定 |
| `parseDragData(dataTransfer)` | ドロップ時のデータをパース |
| `notifyCrossWindowDropSuccess(dragData, virtualObjects)` | クロスウィンドウドロップ成功通知 |
| `cleanupVirtualObjectDragState()` | ドラッグ状態をクリーンアップ |

### 3.4 フックメソッド（オーバーライド可能）

```javascript
// コンテキストメニュー表示前の処理
onContextMenu(e) {
    // 選択状態の更新など
}

// ウィンドウリサイズ完了時
onWindowResizedEnd(data) {
    // レイアウト再計算など
}

// ウィンドウ最大化切り替え時
onWindowMaximizeToggled(data) {
    // 表示調整など
}

// クローズ前の保存処理
async onSaveBeforeClose() {
    await this.saveFile();
}

// ドラッグモード変更時（move→copy）
onDragModeChanged(newMode) {
    // カーソル変更など
}

// 移動モードでソースの仮身を削除（必須実装）
onDeleteSourceVirtualObject(data) {
    // 仮身要素を削除
}

// クロスウィンドウドロップ成功後の処理
onCrossWindowDropSuccess(data) {
    // 状態のクリーンアップ
}
```

---

## 4. MessageBus通信

### 4.1 目的

- **一貫性**: すべてのプラグインで統一されたメッセージング API
- **信頼性**: タイムアウト処理、エラーハンドリングの自動化
- **保守性**: 手動イベントリスナー管理を不要に
- **デバッグ性**: デバッグモードで全メッセージを追跡可能

### 4.2 基本API

#### `on(messageType, handler)`

メッセージハンドラを登録します。

```javascript
this.messageBus.on('message-type', (data, event) => {
    // data: メッセージデータ
    // event: 元のMessageEvent（通常は不要）
});
```

#### `off(messageType)`

ハンドラを削除します。

```javascript
this.messageBus.off('message-type');
```

#### `send(type, data)`

親ウィンドウにメッセージを送信します。

```javascript
this.messageBus.send('save-file', {
    fileId: this.fileId,
    content: this.getContent()
});
```

#### `sendWithCallback(type, data, callback, timeout)`

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
}, 30000); // タイムアウト30秒
```

#### `waitFor(messageType, timeout, filter)`

Promiseベースでメッセージを待ちます（**推奨**）。

```javascript
const messageId = `load-${Date.now()}`;
this.messageBus.send('load-request', { messageId });

try {
    const result = await this.messageBus.waitFor('load-response', 5000,
        (data) => data.messageId === messageId  // フィルタ条件
    );
    console.log('データ受信:', result);
} catch (error) {
    console.error('読み込み失敗:', error);
}
```

### 4.3 共通MessageBusハンドラ

`setupCommonMessageBusHandlers()` で以下が自動登録されます：

| メッセージタイプ | 説明 |
|-----------------|------|
| `window-moved` | ウィンドウ移動時の設定更新 |
| `window-resized-end` | リサイズ完了時の設定更新 |
| `window-maximize-toggled` | 最大化切り替え時 |
| `menu-action` | メニューアクション実行 |
| `get-menu-definition` | メニュー定義取得要求 |
| `window-close-request` | クローズ要求 |

### 4.4 メッセージタイプ一覧

#### 送信（プラグイン → 親）

| メッセージタイプ | 用途 |
|-----------------|------|
| `init` | 初期化（windowId, realIdを取得） |
| `xml-data-changed` | XMLデータの変更通知 |
| `close-window` | ウィンドウを閉じる |
| `activate-window` | ウィンドウをアクティブ化 |
| `show-input-dialog` | 入力ダイアログ表示 |
| `show-save-confirm-dialog` | 保存確認ダイアログ表示 |
| `show-message-dialog` | メッセージダイアログ表示 |
| `duplicate-real-object` | 実身を複製 |
| `copy-virtual-object` | 仮身コピー（refCount+1） |
| `delete-virtual-object` | 仮身削除（refCount-1） |
| `cross-window-drop-success` | クロスウィンドウドロップ成功通知 |
| `update-window-config` | ウィンドウ設定を保存 |

#### 受信（親 → プラグイン）

| メッセージタイプ | 用途 |
|-----------------|------|
| `file-data` | ファイルデータの受信 |
| `menu-action` | メニューアクション実行指示 |
| `window-close-request` | クローズ要求 |
| `real-object-duplicated` | 実身複製完了 |
| `clipboard-data` | クリップボードデータ |

### 4.5 ベストプラクティス

#### 推奨事項

1. **MessageBusのみを使用**

   ```javascript
   // ✅ Good
   this.messageBus.on('message', handler);
   this.messageBus.send('request', data);

   // ❌ Bad
   window.addEventListener('message', handler);
   window.parent.postMessage(data, '*');
   ```

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
   ```

3. **messageIdの一意性を保証**

   ```javascript
   const messageId = `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
   ```

4. **適切なタイムアウト設定**

   - デフォルト: 5000ms
   - ダイアログ待ち: 30000ms
   - 時間のかかる処理: 適宜調整

---

## 5. 仮身/実身操作

### 5.1 仮身コピー（左クリック+右クリック+ドラッグ）

仮身をドラッグ中に右クリックを押すと「コピーモード」になります。
コピーモードでは、同じ実身への新しい参照（仮身）が作成されます。

```javascript
// ドラッグ開始時
handleDragStart(e, virtualObject) {
    // 共通の初期化（右ボタン状態を検出）
    this.initializeVirtualObjectDragStart(e);

    // ドラッグデータを設定
    this.setVirtualObjectDragData(e, [virtualObject], 'my-plugin');

    // iframeのpointer-eventsを無効化
    this.disableIframePointerEvents();
}

// ドロップ時
handleDrop(e) {
    const dragData = this.parseDragData(e.dataTransfer);
    if (!dragData) return;

    const effectiveMode = dragData.mode || this.virtualObjectDragState.dragMode;

    // 移動モードの場合のみ元を削除、コピーモードでは仮身コピーを作成
    const shouldMove = effectiveMode === 'move';

    if (!shouldMove) {
        // コピーモード: refCountを増やす
        this.requestCopyVirtualObject(dragData.virtualObject.link_id);
    }

    // 仮身を挿入
    this.insertVirtualObject(dragData.virtualObject);

    // ドロップ成功を通知（移動モードの場合、ソース側で削除処理が走る）
    this.notifyCrossWindowDropSuccess(dragData, dragData.virtualObjects);
}

// ドラッグ終了時
handleDragEnd(e) {
    this.enableIframePointerEvents();
    this.cleanupVirtualObjectDragState();
}
```

### 5.2 実身複製（ダブルクリック+ドラッグ）

仮身をダブルクリックしてからドラッグすると「実身複製」になります。
新しい実身が作成され、その実身への仮身が配置されます。

```javascript
/**
 * ダブルクリック+ドラッグによる実身複製
 *
 * 重要: ダイアログを先に表示してからMessageBusメッセージを送信すること
 *       （タイムアウト防止のため）
 */
async handleDoubleClickDragDuplicate(virtualObject, dropX, dropY) {
    // 重要: ダイアログを先に表示
    const defaultName = virtualObject.link_name + 'のコピー';
    const newName = await this.showInputDialog(
        '新しい実身の名称を入力してください',
        defaultName,
        30
    );

    if (!newName) {
        logger.debug('[MY_PLUGIN] 実身複製がキャンセルされました');
        return;
    }

    // ダイアログ完了後にメッセージを送信
    const sourceRealId = this.extractRealId(virtualObject.link_id);
    const messageId = 'duplicate-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);

    this.messageBus.send('duplicate-real-object', {
        realId: sourceRealId,
        newName: newName,
        messageId: messageId
    });

    try {
        const result = await this.messageBus.waitFor('real-object-duplicated', 10000,
            (data) => data.messageId === messageId);

        if (result.success) {
            const newVirtualObject = {
                ...virtualObject,
                link_id: result.newRealId,
                link_name: result.newName
            };
            this.insertVirtualObject(newVirtualObject, dropX, dropY);
        }
    } catch (error) {
        logger.error('[MY_PLUGIN] 実身複製エラー:', error);
    }
}
```

### 5.3 refCount管理

仮身は実身への参照カウント（refCount）で管理されます。

| 操作 | refCount | メソッド |
|------|:--------:|---------|
| 仮身コピー作成 | +1 | `requestCopyVirtualObject(linkId)` |
| 仮身削除 | -1 | `requestDeleteVirtualObject(linkId)` |
| 移動（クロスウィンドウ） | ±0 | 増減なし |
| 実身複製 | 新規実身 | `duplicate-real-object`メッセージ |

**重要**: 移動モードのクロスウィンドウドロップでは、refCountは変更しません。

### 5.4 クロスウィンドウドロップ

異なるウィンドウ間での仮身ドラッグ&ドロップを処理します。

```javascript
// setupMessageBusHandlers() 内で登録
setupMessageBusHandlers() {
    this.setupCommonMessageBusHandlers();
    this.setupCrossWindowDropSuccessHandler();  // ← これを追加
}

// ソース側でmoveモード時に元オブジェクトを削除（必須実装）
onDeleteSourceVirtualObject(data) {
    const linkId = data.virtualObjectId || data.virtualObjects?.[0]?.link_id;
    if (this.draggingVirtualObject && this.draggingVirtualObject.parentNode) {
        this.draggingVirtualObject.parentNode.removeChild(this.draggingVirtualObject);
    }
    this.draggingVirtualObject = null;
}

// クロスウィンドウドロップ成功後のクリーンアップ
onCrossWindowDropSuccess(data) {
    this.draggingVirtualObject = null;
}
```

---

## 6. ダイアログ表示

### 6.1 入力ダイアログ

```javascript
// 戻り値は文字列またはnull（キャンセル時）
const name = await this.showInputDialog(
    'ファイル名を入力してください',  // メッセージ
    'untitled.txt',                    // デフォルト値
    30                                  // 入力欄の幅（文字数）
);

if (name) {
    this.saveAs(name);
} else {
    logger.debug('キャンセルされました');
}
```

### 6.2 保存確認ダイアログ

```javascript
const result = await this.showSaveConfirmDialog();

switch (result) {
    case 'yes':
        await this.saveFile();
        this.close();
        break;
    case 'no':
        this.close();
        break;
    case 'cancel':
        // 何もしない
        break;
}
```

### 6.3 メッセージダイアログ

```javascript
const result = await this.showMessageDialog(
    '本当に削除しますか？',
    [
        { label: 'キャンセル', value: 'cancel' },
        { label: '削除', value: 'delete' }
    ],
    0  // デフォルトボタンのインデックス
);

if (result === 'delete') {
    this.deleteItem();
}
```

### 6.4 戻り値の注意点

**重要**: `showInputDialog`の戻り値は**文字列**です。オブジェクトではありません。

```javascript
// ❌ 誤った例
const result = await this.showInputDialog('名前', '');
if (result.value) { ... }  // result は文字列なので .value は undefined

// ✅ 正しい例
const name = await this.showInputDialog('名前', '');
if (name) { ... }  // name は文字列または null
```

### 6.5 ダイアログ先行パターン

MessageBusメッセージを送信する前にダイアログを表示することで、タイムアウトを防ぎます。

```javascript
// ❌ 誤った順序（タイムアウトの原因）
this.messageBus.send('duplicate-real-object', { ... });
const name = await this.showInputDialog('名前', '');  // 5秒でタイムアウト

// ✅ 正しい順序
const name = await this.showInputDialog('名前', '');  // ユーザー入力を待つ
if (name) {
    this.messageBus.send('duplicate-real-object', { ... });  // その後にメッセージ送信
}
```

---

## 7. ツールパネル（子ウィンドウ）

### 7.1 概要

ツールパネルは、メインウィンドウとは別の小さなウィンドウとして表示されるUIです。
basic-figure-editorで使用されています。

### 7.2 親側（エディタ）の実装

```javascript
class FigureEditor extends window.PluginBase {
    constructor() {
        super('FigureEditor');
        this.toolPanelWindowId = null;
    }

    setupMessageBusHandlers() {
        this.setupCommonMessageBusHandlers();

        // ツールパネルウィンドウ作成完了
        this.messageBus.on('tool-panel-window-created', (data) => {
            this.toolPanelWindowId = data.windowId;
        });

        // ツールパネルウィンドウ移動
        this.messageBus.on('tool-panel-window-moved', (data) => {
            // ツールパネルの位置を保存
            this.updatePanelPosition(data.pos);
        });

        // ツールパネルからのメッセージ受信
        window.addEventListener('message', (e) => {
            if (e.data?.type === 'tool-selected') {
                this.selectTool(e.data.tool);
            }
        });
    }

    // ツールパネルウィンドウを開く
    openToolPanelWindow() {
        this.messageBus.send('open-tool-panel-window', {
            pluginId: 'basic-figure-editor',
            panelHtml: 'tool-panel.html',
            width: 200,
            height: 400
        });
    }

    // ツールパネルウィンドウを閉じる
    closeToolPanelWindow() {
        if (this.toolPanelWindowId) {
            this.messageBus.send('close-child-window', {
                windowId: this.toolPanelWindowId
            });
            this.toolPanelWindowId = null;
        }
    }

    // ツールパネルの表示/非表示を切り替え
    toggleToolPanel() {
        if (this.toolPanelWindowId) {
            this.closeToolPanelWindow();
        } else {
            this.openToolPanelWindow();
        }
    }
}
```

### 7.3 子側（ツールパネル）の実装

```javascript
// tool-panel.js
class ToolPanel {
    constructor() {
        this.selectedTool = 'select';

        window.addEventListener('message', (event) => {
            if (event.data?.type === 'init-tool-panel') {
                this.init(event.data);
            }
        });
    }

    init(data) {
        // 初期化処理
        this.setupToolButtons();
        this.sendToParent('tool-panel-ready', {});
    }

    sendToParent(type, data) {
        window.parent.postMessage({ type, ...data }, '*');
    }

    setupToolButtons() {
        document.querySelectorAll('.tool-button').forEach(button => {
            button.addEventListener('click', () => {
                const tool = button.dataset.tool;
                this.selectTool(tool);
            });
        });
    }

    selectTool(toolType) {
        this.selectedTool = toolType;

        // 親ウィンドウに通知
        this.sendToParent('tool-selected', {
            tool: toolType
        });

        // UI更新
        document.querySelectorAll('.tool-button').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tool === toolType);
        });
    }
}

const toolPanel = new ToolPanel();
```

### 7.4 親子間通信パターン

| 方向 | メッセージタイプ | 内容 |
|------|-----------------|------|
| 親→子 | `init-tool-panel` | 初期化データ（現在の状態など） |
| 子→親 | `tool-panel-ready` | 準備完了通知 |
| 子→親 | `tool-selected` | ツール選択通知 |
| 子→親 | `show-tool-panel-popup` | ポップアップメニュー表示要求 |
| 子→親 | `start-drag-tool-panel` | ドラッグ開始通知 |

---

## 8. 参考実装

### 8.1 プラグイン別特徴

| プラグイン | 主な特徴 |
|-----------|---------|
| **basic-text-editor** | リッチテキスト編集、仮身挿入、仮身化機能 |
| **basic-figure-editor** | Canvas描画、ツールパネル、図形操作 |
| **basic-calc-editor** | スプレッドシート、セル編集、数式計算 |
| **virtual-object-list** | 仮身一覧表示、ドラッグ&ドロップ |
| **base-file-manager** | 原紙箱、ファイルコピー |

### 8.2 実装パターン別索引

| 実装パターン | 参考プラグイン |
|-------------|---------------|
| シンプルなPluginBase継承 | virtual-object-list, tadjs-view |
| 仮身ドラッグ&ドロップ | basic-text-editor, basic-calc-editor |
| ダブルクリック+ドラッグ（実身複製） | basic-text-editor, basic-figure-editor |
| ツールパネル子ウィンドウ | basic-figure-editor |
| メニュー定義とアクション | 全プラグイン共通 |
| 保存確認ダイアログ | basic-text-editor, basic-figure-editor |

---

## 9. トラブルシューティング

### 9.1 タイムアウトエラー

```text
Callback timeout for messageId: show-input-dialog_xxx (30000ms)
```

**原因**: ダイアログ表示と他のメッセージ送信が競合

**対策**: ダイアログを先に表示し、結果を得てからメッセージを送信

```javascript
// ❌ 誤った順序
this.messageBus.send('duplicate-real-object', { ... });
const name = await this.showInputDialog('名前', '');

// ✅ 正しい順序
const name = await this.showInputDialog('名前', '');
if (name) {
    this.messageBus.send('duplicate-real-object', { ... });
}
```

### 9.2 ダイアログの戻り値エラー

```text
TypeError: Cannot read property 'value' of undefined
```

**原因**: `showInputDialog`の戻り値を誤って解釈

**対策**: 戻り値は直接文字列として使用

```javascript
// ❌ 誤り
const result = await this.showInputDialog('名前', '');
const name = result.value;

// ✅ 正しい
const name = await this.showInputDialog('名前', '');
```

### 9.3 仮身コピーが動作しない

**原因**: `shouldMove`の判定が誤っている

**対策**: コピーモードは`effectiveMode === 'move'`がfalseの場合

```javascript
// ❌ 誤り（isDuplicateDragを含めてしまう）
const shouldMove = (effectiveMode === 'move') || !dragData?.isDuplicateDrag;

// ✅ 正しい
const shouldMove = effectiveMode === 'move';
```

### 9.4 クロスウィンドウドロップで元が消えない

**原因**: `onDeleteSourceVirtualObject`が実装されていない

**対策**: フックメソッドを実装

```javascript
onDeleteSourceVirtualObject(data) {
    const linkId = data.virtualObjectId || data.virtualObjects?.[0]?.link_id;
    // 元の仮身要素を削除
    const element = document.querySelector(`[data-link-id="${linkId}"]`);
    if (element) {
        element.parentNode.removeChild(element);
    }
}
```

### 9.5 デバッグ方法

1. **開発者ツールを開く**: `Ctrl+Shift+I`

2. **MessageBusのデバッグモードを有効化**:

   ```javascript
   this.messageBus = new window.MessageBus({
       debug: true,  // すべてのメッセージをログ出力
       pluginName: 'PluginName'
   });
   ```

3. **ログ出力例**:

   ```text
   [MessageBus:PluginName] Sent message: init {"fileData":{...}}
   [MessageBus:PluginName] Received message: window-moved {"pos":[10,20],...}
   ```

---

## 10. 実身のファイル構成と読み書き

### 10.1 実身ファイルの構成

実身（Real Object）は以下のファイルで構成されます：

| ファイル | 説明 | 必須 |
|---------|------|------|
| `{realId}.json` | メタデータ（名前、参照カウント、ウィンドウ設定等） | ○ |
| `{realId}_0.xtad` | コンテンツデータ（XML TAD形式） | ○ |
| `{realId}_1.xtad` | 追加レコード（複数レコードの場合） | - |
| `{realId}.ico` | アイコンファイル | - |
| `{realId}_0_0.png` | ピクセルマップ画像（図形編集用） | - |

**realId**: UUID v7形式（例: `019a1132-762b-7b02-ba2a-a918a9b37c39`）

### 10.2 メタデータJSON構造

```json
{
  "name": "基本文章編集",
  "linktype": false,
  "makeDate": "2025-11-09T00:00:00Z",
  "updateDate": "2025-11-09T00:00:00Z",
  "accessDate": "2025-11-09T00:00:00Z",
  "periodDate": null,
  "refCount": 1,
  "editable": true,
  "readable": true,
  "maker": "TRON User",
  "window": {
    "pos": { "x": 100, "y": 100 },
    "width": 600,
    "height": 400,
    "minWidth": 200,
    "minHeight": 200,
    "resizable": true,
    "scrollable": true,
    "maximize": false,
    "maximizable": true,
    "minimizable": true,
    "closable": true,
    "alwaysOnTop": false,
    "skipTaskbar": false,
    "frame": true,
    "transparent": false,
    "backgroundColor": "#ffffff"
  },
  "applist": {
    "basic-text-editor": {
      "name": "基本文章編集",
      "defaultOpen": true
    },
    "virtual-object-list": {
      "name": "仮身一覧",
      "defaultOpen": false
    }
  }
}
```

**主要フィールド**:

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `name` | string | 実身名（表示名） |
| `refCount` | number | 参照カウント（仮身の数） |
| `editable` | boolean | 編集可能フラグ |
| `readable` | boolean | 読み取り可能フラグ |
| `makeDate` | string | 作成日時（ISO 8601） |
| `updateDate` | string | 更新日時（ISO 8601） |
| `window` | object | ウィンドウ設定 |
| `applist` | object | 対応アプリケーション一覧 |

### 10.3 XTAD（XML TAD）構造

```xml
<tad version="1.0" encoding="UTF-8">
<document>
<p>
テキスト内容がここに入ります。<br/>
改行は&lt;br/&gt;タグを使用します。
</p>
<p>
<font size="18"/>見出しテキスト
</p>
<p>
<font size="14"/>通常テキストに戻る<br/>
<link id="019a6c9b-e67e-7a35-a461-0d199550e4cf_0.xtad"
      name="実身/仮身"
      tbcol="#e1f2f9"
      frcol="#000000"
      chcol="#000000"
      bgcol="#ffffff"
      width="150"
      heightpx="30"
      chsz="14"
      framedisp="true"
      namedisp="true"
      pictdisp="true"
      roledisp="false"
      typedisp="false"
      updatedisp="false"
      autoopen="false"
      applist="{&quot;basic-text-editor&quot;:{&quot;name&quot;:&quot;基本文章編集&quot;,&quot;defaultOpen&quot;:true}}"></link>
</p>
</document>
</tad>
```

**主要要素**:

| 要素 | 説明 |
|------|------|
| `<tad>` | ルート要素（version, encoding属性） |
| `<document>` | ドキュメントコンテナ |
| `<p>` | 段落 |
| `<br/>` | 改行 |
| `<font>` | フォント設定（size, color属性） |
| `<bold>` | 太字 |
| `<link>` | 仮身（他の実身への参照） |
| `<image>` | 画像（ピクセルマップ） |
| `<figure>` | 図形セグメント |

**`<link>`要素の属性**:

| 属性 | 説明 | デフォルト |
|------|------|-----------|
| `id` | 参照先の実身ID（`{realId}_0.xtad`形式） | 必須 |
| `name` | 表示名 | 必須 |
| `tbcol` | タイトルバー背景色 | `#e1f2f9` |
| `frcol` | 枠線色 | `#000000` |
| `chcol` | 文字色 | `#000000` |
| `bgcol` | 背景色 | `#ffffff` |
| `width` | 幅（ピクセル） | `150` |
| `heightpx` | 高さ（ピクセル） | `30` |
| `chsz` | 文字サイズ | `14` |
| `pictdisp` | アイコン表示 | `true` |
| `namedisp` | 名前表示 | `true` |
| `framedisp` | 枠線表示 | `true` |
| `roledisp` | 役割表示 | `false` |
| `typedisp` | 種類表示 | `false` |
| `updatedisp` | 更新日時表示 | `false` |
| `autoopen` | 自動オープン | `false` |
| `applist` | 対応アプリJSON（エスケープ済み） | `{}` |

### 10.4 プラグインからの実身読み込み

#### 10.4.1 init時の自動読み込み

プラグインは`init`メッセージで実身データを受け取ります：

```javascript
this.messageBus.on('init', (data) => {
    const { fileData, windowId } = data;

    // メタデータ
    const metadata = fileData.metadata;
    const name = metadata.name || metadata.realName;
    const realId = metadata.realId;

    // レコード（XTADコンテンツ）
    const records = fileData.records;
    const xtadContent = records[0]?.xtad;  // 最初のレコード

    // applist
    const applist = fileData.applist || metadata.applist;
});
```

#### 10.4.2 JSONファイルの直接読み込み

```javascript
async loadRealObjectJson(realId) {
    const jsonFileName = `${realId}.json`;
    const messageId = `load-json-${Date.now()}-${Math.random()}`;

    // 読み込み要求
    this.messageBus.send('load-data-file-request', {
        fileName: jsonFileName,
        messageId: messageId
    });

    // レスポンス待機
    const result = await this.messageBus.waitFor(
        'load-data-file-response',
        10000,  // 10秒タイムアウト
        (data) => data.messageId === messageId
    );

    if (result.success) {
        const jsonText = result.content || await result.data.text();
        return JSON.parse(jsonText);
    }
    return null;
}
```

#### 10.4.3 load-real-objectメッセージによる読み込み

```javascript
async loadRealObject(realId) {
    const messageId = `load-real-${Date.now()}-${Math.random()}`;

    this.messageBus.send('load-real-object', {
        realId: realId,
        messageId: messageId
    });

    const result = await this.messageBus.waitFor(
        'real-object-loaded',
        10000,
        (data) => data.messageId === messageId
    );

    if (result.success) {
        // result.realObject = { metadata, records, applist }
        return result.realObject;
    }
    return null;
}
```

### 10.5 プラグインからの実身保存

#### 10.5.1 save-real-objectメッセージ

```javascript
async saveRealObject(realId, realObject) {
    const messageId = `save-real-${Date.now()}-${Math.random()}`;

    this.messageBus.send('save-real-object', {
        realId: realId,
        realObject: {
            metadata: {
                name: realObject.name,
                updateDate: new Date().toISOString(),
                // ... その他のメタデータ
            },
            records: [
                {
                    xtad: realObject.xtadContent,  // XML文字列
                    images: []
                }
            ]
        },
        messageId: messageId
    });

    const result = await this.messageBus.waitFor(
        'real-object-saved',
        10000,
        (data) => data.messageId === messageId
    );

    return result.success;
}
```

#### 10.5.2 xml-data-changedメッセージ（簡易保存）

XTADコンテンツのみを更新する場合：

```javascript
this.messageBus.send('xml-data-changed', {
    fileId: this.currentFileId,
    xmlData: this.generateXtadXml()
});
```

### 10.6 実身の作成

#### 10.6.1 create-real-objectメッセージ

新規実身を作成する場合：

```javascript
async createRealObject(realName, initialXtad) {
    const messageId = `create-real-${Date.now()}-${Math.random()}`;

    this.messageBus.send('create-real-object', {
        realName: realName,       // 実身名
        initialXtad: initialXtad, // 初期XTADコンテンツ
        messageId: messageId
    });

    const result = await this.messageBus.waitFor(
        'real-object-created',
        10000,
        (data) => data.messageId === messageId
    );

    if (result.success) {
        return result.realId;  // 新しい実身ID（UUID v7）
    }
    return null;
}
```

#### 10.6.2 UUID v7の生成と取り扱い

**重要**: 実身ID（UUID v7）は親ウィンドウ側で生成されます。プラグインからは生成しません。

```text
プラグイン                          親ウィンドウ (tadjs-desktop.js)
    |                                        |
    |  create-real-object                    |
    |  { realName, initialXtad }             |
    | -------------------------------------> |
    |                                        | UUID v7を生成
    |                                        | ファイルを作成:
    |                                        |   - {realId}.json
    |                                        |   - {realId}_0.xtad
    |                                        |
    |  real-object-created                   |
    |  { realId, realName, success }         |
    | <------------------------------------- |
    |                                        |
```

**UUID v7の特徴**:

- 時間ベースのソート可能なUUID
- 形式: `019a1132-762b-7b02-ba2a-a918a9b37c39`
- 先頭48ビットがタイムスタンプ（ミリ秒精度）
- 生成は `RealObjectSystem.generateUUIDv7()` で行われる

**プラグインからの利用**:

```javascript
// 実身作成後、レスポンスからrealIdを取得
const result = await this.messageBus.waitFor('real-object-created', ...);

// 取得したrealIdを使って仮身を追加
if (result.success) {
    const newRealId = result.realId;
    const linkId = `${newRealId}_0.xtad`;  // 仮身のlink_id形式

    // 仮身要素を作成
    const linkElement = document.createElement('span');
    linkElement.className = 'virtual-object';
    linkElement.dataset.linkId = linkId;
    linkElement.dataset.linkName = result.realName;
    // ...
}
```

### 10.7 参照カウント管理

#### 10.7.1 仮身コピー（参照カウント+1）

```javascript
this.messageBus.send('copy-virtual-object', {
    realId: realId,
    messageId: messageId
});
// レスポンス: 'virtual-object-copied'
```

#### 10.7.2 仮身削除（参照カウント-1）

```javascript
this.messageBus.send('delete-virtual-object', {
    realId: realId,
    messageId: messageId
});
// レスポンス: 'virtual-object-deleted'
```

#### 10.7.3 実身複製（新しい実身として完全コピー）

```javascript
this.messageBus.send('copy-real-object', {
    sourceRealId: sourceRealId,
    messageId: messageId
});
// レスポンス: 'real-object-copied' { newRealId, newName }
```

### 10.8 画像ファイルの読み書き

ピクセルマップ等の画像ファイルを扱う場合：

#### 10.8.1 画像保存

```javascript
// ファイル名形式: {realId}_{recordNo}_{imgNo}.png
const fileName = `${realId}_0_${imgNo}.png`;

this.messageBus.send('save-image-file', {
    fileName: fileName,
    imageData: Array.from(imageDataUint8Array),
    messageId: messageId
});
```

#### 10.8.2 画像読み込み

```javascript
this.messageBus.send('load-image-file', {
    fileName: fileName,
    messageId: messageId
});

// レスポンス
this.messageBus.on('load-image-response', (data) => {
    if (data.success) {
        const imageData = new Uint8Array(data.imageData);
        const blob = new Blob([imageData], { type: data.mimeType });
        const url = URL.createObjectURL(blob);
        // 画像を表示
    }
});
```

### 10.9 link_idから実身IDを抽出

仮身の`link_id`（例: `019a6c96-e262-7dfd-a3bc-1e85d495d60d_0.xtad`）から実身IDを抽出：

```javascript
function extractRealId(linkId) {
    if (!linkId) return '';
    // .xtadまたは.jsonの拡張子を削除
    let realId = linkId.replace(/\.(xtad|json)$/, '');
    // 末尾の_数字を削除
    realId = realId.replace(/_\d+$/, '');
    return realId;
}

// 使用例
const linkId = '019a6c96-e262-7dfd-a3bc-1e85d495d60d_0.xtad';
const realId = extractRealId(linkId);  // '019a6c96-e262-7dfd-a3bc-1e85d495d60d'
```

### 10.10 RealObjectSystem静的メソッド

`RealObjectSystem`クラスには便利な静的メソッドが用意されています：

```javascript
import { RealObjectSystem } from '../js/real-object-system.js';

// link_idから実身IDを抽出
const realId = RealObjectSystem.extractRealId(linkId);

// 実身IDからJSONファイル名を生成
const jsonFileName = RealObjectSystem.getRealObjectJsonFileName(realId);

// applistデータを取得（プラグインインスタンス経由）
const applist = await RealObjectSystem.getAppListData(this, realId);
```


