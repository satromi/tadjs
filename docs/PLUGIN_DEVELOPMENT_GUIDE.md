# プラグイン開発ガイド

BTRON Desktopのプラグイン開発に関する総合ガイドです。

---

## 目次

1. [クイックスタート](#1-クイックスタート)
2. [概要](#2-概要)
3. [基本構造](#3-基本構造)
4. [PluginBaseの使用](#4-pluginbaseの使用)
5. [共通メソッド一覧](#5-共通メソッド一覧)
6. [MessageBus通信](#6-messagebus通信)
7. [仮身/実身操作](#7-仮身実身操作)
8. [ダイアログ表示](#8-ダイアログ表示)
9. [ツールパネル（子ウィンドウ）](#9-ツールパネル子ウィンドウ)
10. [実身のファイル構成と読み書き](#10-実身のファイル構成と読み書き)
11. [参考実装](#11-参考実装)
12. [トラブルシューティング](#12-トラブルシューティング)

---

## 1. クイックスタート

### 1.1 最小構成のプラグイン

**ステップ1**: `plugins/my-plugin/` ディレクトリを作成

**ステップ2**: `plugin.json` を作成

```json
{
  "id": "my-plugin",
  "name": "マイプラグイン",
  "version": "1.0.0",
  "type": "accessory",
  "main": "index.html",
  "window": {
    "width": 600,
    "height": 400
  }
}
```

**ステップ3**: `index.html` を作成

```html
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <title>マイプラグイン</title>
    <script src="../../js/logger.js"></script>
    <script src="../../js/util.js"></script>
    <script src="../../js/message-bus-global.js"></script>
    <script src="../../js/plugin-base-global.js"></script>
</head>
<body>
    <div class="plugin-content">
        <h1>マイプラグイン</h1>
    </div>
    <script src="app.js"></script>
</body>
</html>
```

**ステップ4**: `app.js` を作成

```javascript
const logger = window.getLogger('MyPlugin');

class MyPlugin extends window.PluginBase {
    constructor() {
        super('MyPlugin');
        // MessageBusはPluginBaseで自動初期化される
    }

    async init() {
        // 共通コンポーネント初期化
        this.initializeCommonComponents('[MY_PLUGIN]');

        // 共通イベントハンドラ設定
        this.setupWindowActivation();
        this.setupContextMenu();

        // MessageBusハンドラ設定
        this.setupMessageBusHandlers();
    }

    setupMessageBusHandlers() {
        // 共通ハンドラを登録（必須）
        this.setupCommonMessageBusHandlers();

        // initメッセージでファイルデータを受け取る
        this.messageBus.on('init', (data) => {
            this.windowId = data.windowId;
            this.realId = data.realId;
            this.fileData = data.fileData;
            this.onInitialized(data);
        });
    }

    onInitialized(data) {
        logger.info('プラグイン初期化完了', data);
    }

    // メニュー定義（必須）
    async getMenuDefinition() {
        return [
            { label: 'ファイル', submenu: [
                { label: '閉じる', action: 'close' }
            ]}
        ];
    }

    // メニューアクション実行（必須）
    executeMenuAction(action, additionalData) {
        switch (action) {
            case 'close':
                this.requestCloseWindow();
                break;
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.myPlugin = new MyPlugin();
    window.myPlugin.init();
});
```

### 1.2 開発者が覚えるべき重要ポイント

| ポイント | 説明 |
|---------|------|
| **MessageBusは自動初期化** | `super('PluginName')` 呼び出しで自動的に初期化・開始される |
| **setupCommonMessageBusHandlers()は必須** | ウィンドウ操作やメニュー処理を自動で行う |
| **fileDataプロパティを使用** | `this.fileData`で初期化時のファイルデータにアクセス |
| **isModifiedで編集状態管理** | `this.isModified = true` で保存確認ダイアログ制御 |
| **generateMessageId()でID生成** | MessageBusのrequest/responseペアリングに使用 |

---

## 2. 概要

### 2.1 アーキテクチャ

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

### 2.2 プラグインタイプ

| タイプ | 説明 | 例 |
|-------|------|-----|
| `base` | 原紙タイプ（原紙箱に表示） | basic-text-editor, basic-figure-editor, basic-calc-editor |
| `accessory` | 小物タイプ（アクセサリメニューから起動） | system-config, user-config, file-import |
| `utility` | ユーティリティタイプ | trash-real-objects |
| `genko` | 原稿タイプ | tadjs-view |

---

## 3. 基本構造

### 3.1 ディレクトリ構成

```text
plugins/
└── my-plugin/
    ├── plugin.json      # プラグイン設定（必須）
    ├── index.html       # メインHTML（必須）
    ├── app.js           # メインスクリプト
    └── style.css        # スタイル（任意）
```

### 3.2 plugin.json仕様

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

### 3.3 index.html構成

```html
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <title>プラグイン名</title>
    <link rel="stylesheet" href="style.css">
    <!-- 共通ライブラリの読み込み（順序重要） -->
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

## 4. PluginBaseの使用

### 4.1 継承パターン（推奨）

```javascript
const logger = window.getLogger('MyPlugin');

class MyPlugin extends window.PluginBase {
    constructor() {
        super('MyPlugin');  // MessageBusは自動初期化される

        // プラグイン固有のプロパティ
        // this.isModified は PluginBase で定義済み
        // this.fileData は PluginBase で定義済み
    }

    async init() {
        // 共通コンポーネントの初期化
        this.initializeCommonComponents('[MY_PLUGIN]');

        // 共通イベントハンドラの設定
        this.setupWindowActivation();      // ウィンドウアクティベーション
        this.setupContextMenu();           // コンテキストメニュー
        this.setupVirtualObjectRightButtonHandlers(); // 仮身ドラッグ

        // MessageBusハンドラの設定
        this.setupMessageBusHandlers();
    }

    setupMessageBusHandlers() {
        // 共通ハンドラ登録（必須）
        this.setupCommonMessageBusHandlers();

        // クロスウィンドウドロップ対応（仮身ドラッグ対応時）
        this.setupCrossWindowDropSuccessHandler();

        // initメッセージ
        this.messageBus.on('init', (data) => {
            this.windowId = data.windowId;
            this.realId = data.realId;
            this.fileData = data.fileData;  // PluginBaseのプロパティに保存
            this.onInitialized(data);
        });

        // プラグイン固有のハンドラ
        // ...
    }

    onInitialized(data) {
        // 初期化完了後の処理
        this.loadContent(data.fileData);
    }

    // メニュー定義（必須）
    async getMenuDefinition() {
        return [
            { label: 'ファイル', submenu: [
                { label: '保存', action: 'save', shortcut: 'Ctrl+S' },
                { label: '閉じる', action: 'close' }
            ]}
        ];
    }

    // メニューアクション実行（必須）
    executeMenuAction(action, additionalData) {
        // execute-with-アクション（実行メニュー）の処理
        if (this.handleExecuteWithAction(action)) return;

        switch (action) {
            case 'save':
                this.saveFile();
                break;
            case 'close':
                this.requestCloseWindow();
                break;
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.myPlugin = new MyPlugin();
    window.myPlugin.init();
});
```

### 4.2 初期化フロー

```text
1. constructor()
   └── super('PluginName')
       ├── MessageBus 自動初期化・開始  ← 重要：手動初期化は不要
       ├── isModified = false
       └── fileData = null

2. init()
   ├── initializeCommonComponents() - 共通コンポーネント初期化
   ├── setupWindowActivation() - ウィンドウアクティベーション設定
   ├── setupContextMenu() - コンテキストメニュー設定
   ├── setupVirtualObjectRightButtonHandlers() - 仮身ドラッグ設定
   └── setupMessageBusHandlers()
       ├── setupCommonMessageBusHandlers() - 共通ハンドラ登録
       ├── setupCrossWindowDropSuccessHandler() - ドロップ成功ハンドラ
       └── 'init' ハンドラ登録
           └── plugin-readyシグナル送信

3. 親ウィンドウから 'init' メッセージ受信
   └── onInitialized() コールバック
```

### 4.3 PluginBase共通プロパティ

| プロパティ | 型 | 説明 |
|-----------|-----|------|
| `pluginName` | string | プラグイン名（ログ表示用） |
| `messageBus` | MessageBus | 通信用MessageBusインスタンス（自動初期化） |
| `windowId` | string | ウィンドウID（initで設定） |
| `realId` | string | 実身ID（initで設定） |
| `fileData` | object | ファイルデータ（initハンドラで設定） |
| `bgColor` | string | 背景色（デフォルト: '#ffffff'） |
| `isModified` | boolean | 編集状態フラグ（保存確認ダイアログ制御） |
| `isWindowActive` | boolean | ウィンドウアクティブ状態 |
| `dialogVisible` | boolean | 親ウィンドウのダイアログ表示状態 |
| `virtualObjectRenderer` | object | 仮身レンダラー |
| `iconManager` | object | アイコンキャッシュマネージャー |
| `iconData` | object | アイコンデータキャッシュ `{ realId: base64Data }` |
| `openedRealObjects` | Map | 開いている実身のマップ |

---

## 5. 共通メソッド一覧

PluginBaseが提供する共通メソッドの一覧です。開発者はこれらを活用することで、統一された実装が可能です。

### 5.1 初期化・セットアップ

| メソッド | 説明 |
|---------|------|
| `initializeCommonComponents(logPrefix)` | VirtualObjectRenderer, IconCacheManager初期化 |
| `setupWindowActivation()` | mousedownでウィンドウをアクティブ化 |
| `setupContextMenu()` | 右クリックメニュー設定 |
| `setupVirtualObjectRightButtonHandlers()` | 仮身ドラッグ用右ボタン監視 |
| `setupCommonMessageBusHandlers()` | 共通MessageBusハンドラ登録（**必須**） |
| `setupCrossWindowDropSuccessHandler()` | クロスウィンドウドロップ成功ハンドラ |

### 5.2 ダイアログ表示

| メソッド | 戻り値 | 説明 |
|---------|--------|------|
| `showInputDialog(message, defaultValue, inputWidth, options)` | `string \| null` | 入力ダイアログ。キャンセル時null |
| `showSaveConfirmDialog()` | `'yes' \| 'no' \| 'cancel'` | 保存確認ダイアログ |
| `showMessageDialog(message, buttons, defaultButton)` | `string` | カスタムボタンダイアログ |

**showInputDialogのオプション**:

```javascript
// カラーピッカー付き入力ダイアログ
const result = await this.showInputDialog(
    '背景色を入力してください',
    '#ffffff',
    20,
    { colorPicker: true }
);
```

### 5.3 仮身/実身操作

| メソッド | 戻り値 | 説明 |
|---------|--------|------|
| `loadRealObjectData(realId)` | `Promise<Object>` | 実身データを読み込む |
| `getAppListData(realId)` | `Promise<Object>` | 実身のappListデータを取得 |
| `duplicateRealObject()` | `Promise<Object>` | 選択中の仮身が指す実身を複製 |
| `renameRealObject()` | `Promise<Object>` | 選択中の仮身が指す実身の名前を変更 |
| `closeRealObject()` | void | 選択中の仮身が指す実身を閉じる |
| `changeVirtualObjectAttributes()` | `Promise<void>` | 仮身の属性を変更 |
| `extractRealId(linkId)` | string | linkIdから実身IDを抽出 |
| `requestCopyVirtualObject(linkId)` | void | 仮身コピー（refCount+1） |
| `requestDeleteVirtualObject(linkId)` | void | 仮身削除（refCount-1） |
| `openTrashRealObjects()` | void | ごみ箱実身を開く |

### 5.4 ウィンドウ操作

| メソッド | 説明 |
|---------|------|
| `activateWindow()` | ウィンドウをアクティブ化 |
| `toggleMaximize()` | 最大化/復元を切り替え |
| `toggleFullscreen()` | 全画面表示切り替え（toggleMaximizeのエイリアス） |
| `closeContextMenu()` | コンテキストメニューを閉じる |
| `requestContextMenu(x, y)` | コンテキストメニュー要求を送信 |
| `requestCloseWindow()` | ウィンドウを閉じるリクエスト送信 |
| `updateWindowConfig(config)` | ウィンドウ設定を保存 |
| `sendStatusMessage(message)` | ステータスメッセージを送信 |
| `setStatus(message)` | ステータスメッセージを設定（sendStatusMessageのエイリアス） |

### 5.5 クリップボード

| メソッド | 戻り値 | 説明 |
|---------|--------|------|
| `getClipboard()` | `Promise<any>` | クリップボードデータを取得 |
| `setClipboard(data)` | void | クリップボードにデータを設定 |
| `getGlobalClipboard()` | `Promise<Object\|null>` | グローバルクリップボードから取得 |
| `setTextClipboard(text)` | void | テキストをクリップボードに設定 |
| `setImageClipboard(source, options)` | void | 画像をクリップボードに設定 |
| `imageElementToDataUrl(img, mimeType)` | `string\|null` | 画像要素をDataURLに変換 |
| `imageElementToDataUrlAsync(img, mimeType)` | `Promise<string\|null>` | 非同期でDataURLに変換 |
| `loadImageFromUrl(url, options)` | `Promise<string\|null>` | URLから画像を読み込みDataURL生成 |

### 5.6 仮身ドラッグ

| メソッド | 戻り値 | 説明 |
|---------|--------|------|
| `initializeVirtualObjectDragStart(e)` | `Object` | ドラッグ開始時の共通処理 |
| `setVirtualObjectDragData(e, virtualObjects, source, isDuplicateDrag)` | `Object` | ドラッグデータを設定 |
| `detectVirtualObjectDragMove(e)` | `boolean` | ドラッグ中の移動を検出 |
| `parseDragData(dataTransfer)` | `Object\|null` | ドロップ時のデータをパース |
| `notifyCrossWindowDropSuccess(dragData, virtualObjects)` | void | クロスウィンドウドロップ成功通知 |
| `cleanupVirtualObjectDragState()` | void | ドラッグ状態をクリーンアップ |
| `disableIframePointerEvents()` | void | iframeのpointer-eventsを無効化 |
| `enableIframePointerEvents()` | void | iframeのpointer-eventsを再有効化 |
| `duplicateRealObjectForDrag(virtualObject)` | `Promise<Object>` | ダブルクリックドラッグ時の実身複製 |
| `handleBaseFileDrop(dragData, clientX, clientY, additionalData)` | void | 原紙箱からのドロップ処理 |

### 5.7 ダブルクリック+ドラッグ

| メソッド | 説明 |
|---------|------|
| `setDoubleClickDragCandidate(element, event)` | ダブルクリック+ドラッグ候補を設定 |
| `resetDoubleClickTimer()` | ダブルクリックタイマーをリセット |
| `shouldStartDblClickDrag(event, threshold)` | ドラッグを開始すべきか判定 |
| `cleanupDblClickDragState()` | ダブルクリック+ドラッグ状態をクリーンアップ |

### 5.8 スクロール位置管理

| メソッド | 戻り値 | 説明 |
|---------|--------|------|
| `getScrollPosition()` | `{x, y}\|null` | 現在のスクロール位置を取得 |
| `setScrollPosition(scrollPos)` | void | スクロール位置を設定 |
| `saveScrollPosition()` | void | スクロール位置を保存 |
| `focusWithScrollPreservation(element)` | void | スクロール位置を保持しながらフォーカス |

**カスタムスクロールコンテナ**:

デフォルトでは `.plugin-content` がスクロールコンテナとして使用されます。異なる要素をスクロールコンテナとして使用する場合は、`getScrollPosition()` と `setScrollPosition()` をオーバーライドしてください。

```javascript
// 例: .grid-body をスクロールコンテナとして使用
getScrollPosition() {
    const gridBody = document.querySelector('.grid-body');
    if (gridBody) {
        return { x: gridBody.scrollLeft, y: gridBody.scrollTop };
    }
    return null;
}

setScrollPosition(scrollPos) {
    if (!scrollPos) return;
    const gridBody = document.querySelector('.grid-body');
    if (gridBody) {
        gridBody.scrollLeft = scrollPos.x || 0;
        gridBody.scrollTop = scrollPos.y || 0;
    }
}
```

**ウィンドウスクロールバーとの連動**:

ウィンドウのスクロールバーは以下の優先順位でスクロールコンテナを検出します：

1. `[data-scroll-container="true"]` 属性を持つ要素
2. `.grid-body` 要素
3. `.plugin-content` 要素
4. `body` 要素

### 5.9 画像ファイル操作

| メソッド | 戻り値 | 説明 |
|---------|--------|------|
| `saveImageFile(source, fileName, mimeType)` | `Promise<boolean>` | 画像ファイルを保存 |
| `deleteImageFile(fileName)` | void | 画像ファイルを削除 |
| `savePixelmapImageFile(imageData, fileName)` | `Promise<void>` | ImageDataからPNG保存 |
| `saveImageFromElement(imageElement, fileName)` | `Promise<void>` | 画像要素からPNG保存 |

### 5.10 メニュー関連

| メソッド | 戻り値 | 説明 |
|---------|--------|------|
| `handleExecuteWithAction(action)` | `boolean` | execute-with-アクションを処理 |
| `buildExecuteSubmenu(applistData, labelKey)` | `Array` | 実行サブメニューをapplistから生成 |
| `openVirtualObjectReal(virtualObj, pluginId, messageId)` | void | 仮身の実身を指定プラグインで開く |
| `getContextMenuVirtualObject()` | `Object\|null` | コンテキストメニューで選択中の仮身を取得 |

### 5.11 背景色管理

| メソッド | 戻り値 | 説明 |
|---------|--------|------|
| `changeBgColor()` | `Promise<void>` | 背景色変更ダイアログを表示し、背景色を変更 |
| `applyBackgroundColor(color)` | void | 背景色をUIに適用（サブクラスでオーバーライド） |

**重要**: `applyBackgroundColor()` をオーバーライドする場合、必ず `this.bgColor = color` を先頭で実行してください。

```javascript
// サブクラスでのオーバーライド例
applyBackgroundColor(color) {
    this.bgColor = color;  // 必須: changeBgColor()で現在色を取得するため
    this.editor.style.backgroundColor = color;
    document.body.style.backgroundColor = color;
}
```

### 5.12 アイコン管理

| メソッド | 戻り値 | 説明 |
|---------|--------|------|
| `loadAndStoreIcon(realId)` | `Promise<void>` | アイコンを読み込んでキャッシュに保存 |
| `loadAndStoreIcons(realIds)` | `Promise<void>` | 複数のアイコンを一括読み込み |

```javascript
// アイコン読み込み
await this.loadAndStoreIcon(realId);

// キャッシュからアイコンを取得
const iconBase64 = this.iconData[realId];
if (iconBase64) {
    img.src = `data:image/x-icon;base64,${iconBase64}`;
}
```

### 5.13 ファイル操作

| メソッド | 戻り値 | 説明 |
|---------|--------|------|
| `loadDataFileFromParent(fileName)` | `Promise<Blob>` | 親ウィンドウ経由でデータファイルを読み込む |
| `loadVirtualObjectMetadata(virtualObj)` | `Promise<Object>` | 仮身のメタデータを読み込む |

```javascript
// JSONファイルを読み込む例
const jsonFile = await this.loadDataFileFromParent('realId.json');
const jsonText = await jsonFile.text();
const jsonData = JSON.parse(jsonText);
```

### 5.14 ユーティリティ

| メソッド | 戻り値 | 説明 |
|---------|--------|------|
| `generateMessageId(prefix)` | `string` | ユニークなメッセージIDを生成 |
| `extractRealId(linkId)` | `string` | linkIdから実身IDを抽出 |
| `escapeXml(text)` | `string` | XMLエスケープ |
| `unescapeXml(text)` | `string` | XMLアンエスケープ |
| `log(...args)` | void | ログ出力（プラグイン名付き） |
| `warn(...args)` | void | 警告ログ出力 |
| `error(...args)` | void | エラーログ出力 |

```javascript
// XMLエスケープ/アンエスケープ
const escaped = this.escapeXml('<tag>');   // '&lt;tag&gt;'
const unescaped = this.unescapeXml('&lt;tag&gt;');  // '<tag>'

// 実身ID抽出
const realId = this.extractRealId('019a6c96-e262-7dfd-a3bc-1e85d495d60d_0.xtad');
// => '019a6c96-e262-7dfd-a3bc-1e85d495d60d'
```

### 5.15 フックメソッド（オーバーライド用）

| メソッド | 呼び出しタイミング |
|---------|------------------|
| `onContextMenu(e)` | コンテキストメニュー表示前 |
| `onWindowResizedEnd(data)` | ウィンドウリサイズ完了時 |
| `onWindowMaximizeToggled(data)` | ウィンドウ最大化切り替え時 |
| `onWindowActivated()` | ウィンドウがアクティブになった時 |
| `onWindowDeactivated()` | ウィンドウが非アクティブになった時 |
| `onSaveBeforeClose()` | クローズ前の保存処理 |
| `onDragModeChanged(newMode)` | ドラッグモード変更時（move→copy） |
| `onDeleteSourceVirtualObject(data)` | 移動モードでソースの仮身を削除 |
| `onCrossWindowDropSuccess(data)` | クロスウィンドウドロップ成功後 |
| `getVirtualObjectCurrentAttrs(vobj, element)` | 仮身の現在の属性値を取得 |
| `applyVirtualObjectAttributes(attrs)` | 仮身に属性を適用 |
| `applyBackgroundColor(color)` | 背景色をUIに適用（`this.bgColor`を更新すること） |

### 5.16 仮身属性ヘルパー（内部メソッド）

`applyVirtualObjectAttributes()` フックメソッド内で使用する内部ヘルパーメソッドです。
メソッド名は `_` プレフィックス付きで、サブクラスから直接呼び出して使用します。

| メソッド | 戻り値 | 説明 |
|---------|--------|------|
| `_isValidVobjColor(color)` | `boolean` | カラーコード（#RRGGBB形式）の検証 |
| `_boolToVobjString(value)` | `string` | ブール値を `'true'`/`'false'` 文字列に変換 |
| `_ensureVobjDefaults(vobj, overrides)` | `Object` | 仮身にデフォルト属性値を設定 |
| `_mergeVobjFromDataset(vobj, element)` | `Object` | element.datasetからvobjに属性をマージ |
| `_applyVobjAttrs(vobj, attrs)` | `Object` | 属性を適用し、変更情報を返す |
| `_syncVobjToDataset(element, vobj)` | void | vobjの属性をelement.datasetに同期 |
| `_applyVobjStyles(element, attrs)` | void | 閉じた仮身のスタイル（枠線色、文字色、背景色）を適用 |
| `_hasVobjAttrChanges(changes)` | `boolean` | 変更があったかどうかを判定 |
| `_isVobjAttrChanged(changes, attrName)` | `boolean` | 特定の属性が変更されたかを判定 |

**静的定数**:

| 定数 | 説明 |
| ------ | ------ |
| `PluginBase.VOBJ_COLOR_REGEX` | カラーコード検証用正規表現 `/^#[0-9A-Fa-f]{6}$/` |
| `PluginBase.VOBJ_DEFAULT_ATTRS` | 仮身属性のデフォルト値オブジェクト |
| `PluginBase.VOBJ_DISPLAY_BOOL_ATTRS` | 表示関連ブール属性名の配列 |
| `PluginBase.VOBJ_COLOR_ATTRS` | カラー属性名の配列 `['frcol', 'chcol', 'tbcol', 'bgcol']` |

**使用例**:

```javascript
// applyVirtualObjectAttributes() の実装例
applyVirtualObjectAttributes(attrs) {
    const vobj = this.contextMenuVirtualObject?.virtualObj;
    const element = this.contextMenuVirtualObject?.element;
    if (!vobj) return;

    // datasetから現在値をマージ（DOM要素がある場合）
    if (element) {
        this._mergeVobjFromDataset(vobj, element);
    }

    // 属性を適用し、変更情報を取得
    const changes = this._applyVobjAttrs(vobj, attrs);

    // 変更がなければ早期リターン
    if (!this._hasVobjAttrChanges(changes)) {
        return;
    }

    // 特定の属性変更時の処理
    if (this._isVobjAttrChanged(changes, 'chsz')) {
        // 文字サイズ変更時の処理
    }

    // DOM要素にスタイルを適用（閉じた仮身の場合）
    if (element) {
        this._applyVobjStyles(element, attrs);
        this._syncVobjToDataset(element, vobj);
    }

    this.isModified = true;
}
```

### 5.17 選択位置（カーソル）保存ヘルパー（内部メソッド）

ウィンドウの非アクティブ/アクティブ切り替え時に選択範囲（カーソル位置）を保持するためのヘルパーメソッドです。

| メソッド | 戻り値 | 説明 |
|---------|--------|------|
| `_saveSelection()` | void | 現在の選択範囲を `this.savedSelection` に保存 |
| `_restoreSelection()` | `boolean` | 保存された選択範囲を復元（成功時true） |

**プロパティ**:

| プロパティ | 型 | 説明 |
|-----------|-----|------|
| `savedSelection` | `Object\|null` | 保存された選択範囲情報 |

**使用例**:

```javascript
// ウィンドウ非アクティブ時に選択位置を保存
onWindowDeactivated() {
    this._saveSelection();
    this.saveScrollPosition();
}

// ウィンドウアクティブ時に選択位置を復元
onWindowActivated() {
    const pluginContent = document.querySelector('.plugin-content');
    const savedScrollPos = pluginContent ? {
        x: pluginContent.scrollLeft,
        y: pluginContent.scrollTop
    } : null;

    this.editor.focus();

    if (pluginContent && savedScrollPos) {
        requestAnimationFrame(() => {
            pluginContent.scrollLeft = savedScrollPos.x;
            pluginContent.scrollTop = savedScrollPos.y;
            this._restoreSelection();
        });
    }
}
```

---

## 6. MessageBus通信

### 6.1 概要

MessageBusは、プラグインと親ウィンドウ間の通信を統一的に管理するクラスです。

**重要**: PluginBaseを継承すると、MessageBusは**自動的に初期化**されます。手動で初期化する必要はありません。

```javascript
class MyPlugin extends window.PluginBase {
    constructor() {
        super('MyPlugin');
        // this.messageBus は既に初期化・開始済み
    }
}
```

### 6.2 基本API

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
}, 30000); // タイムアウト30秒（0で無制限）
```

#### `waitFor(messageType, timeout, filter)`

Promiseベースでメッセージを待ちます（**推奨**）。

```javascript
// generateMessageId()でユニークなIDを生成
const messageId = this.generateMessageId('load');

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

### 6.3 共通MessageBusハンドラ

`setupCommonMessageBusHandlers()` で以下が自動登録されます：

| メッセージタイプ | 説明 |
|-----------------|------|
| `window-moved` | ウィンドウ移動時の設定更新 |
| `window-resized-end` | リサイズ完了時の設定更新 + `onWindowResizedEnd()`フック |
| `window-maximize-toggled` | 最大化切り替え時 + `onWindowMaximizeToggled()`フック |
| `menu-action` | メニューアクション実行 → `executeMenuAction()`呼び出し |
| `get-menu-definition` | メニュー定義取得要求 → `getMenuDefinition()`呼び出し |
| `window-close-request` | クローズ要求 → `handleCloseRequest()`呼び出し |
| `parent-dialog-opened` | 親ウィンドウでダイアログが開いた |
| `parent-dialog-closed` | 親ウィンドウでダイアログが閉じた |
| `window-activated` | ウィンドウがアクティブになった + `onWindowActivated()`フック |
| `window-deactivated` | ウィンドウが非アクティブになった + `onWindowDeactivated()`フック |

### 6.4 メッセージタイプ一覧

#### 送信（プラグイン → 親）

| メッセージタイプ | 用途 |
|-----------------|------|
| `activate-window` | ウィンドウをアクティブ化 |
| `close-window` | ウィンドウを閉じる |
| `toggle-maximize` | 最大化/復元切り替え |
| `close-context-menu` | コンテキストメニューを閉じる |
| `context-menu-request` | コンテキストメニュー要求 |
| `xml-data-changed` | XMLデータの変更通知 |
| `show-input-dialog` | 入力ダイアログ表示 |
| `show-save-confirm-dialog` | 保存確認ダイアログ表示 |
| `show-message-dialog` | メッセージダイアログ表示 |
| `load-real-object` | 実身データ読み込み要求 |
| `duplicate-real-object` | 実身を複製 |
| `copy-virtual-object` | 仮身コピー（refCount+1） |
| `delete-virtual-object` | 仮身削除（refCount-1） |
| `cross-window-drop-success` | クロスウィンドウドロップ成功通知 |
| `update-window-config` | ウィンドウ設定を保存 |
| `window-close-response` | クローズ要求への応答 |
| `status-message` | ステータスメッセージ |
| `get-clipboard` | クリップボードデータ取得要求 |
| `set-clipboard` | クリップボードにデータ設定 |
| `save-image-file` | 画像ファイル保存 |
| `delete-image-file` | 画像ファイル削除 |

#### 受信（親 → プラグイン）

| メッセージタイプ | 用途 |
|-----------------|------|
| `init` | 初期化（windowId, realId, fileDataを受け取る） |
| `menu-action` | メニューアクション実行指示 |
| `get-menu-definition` | メニュー定義取得要求 |
| `window-close-request` | クローズ要求 |
| `window-moved` | ウィンドウ移動完了 |
| `window-resized-end` | リサイズ完了 |
| `window-maximize-toggled` | 最大化切り替え完了 |
| `window-activated` | ウィンドウアクティブ化 |
| `window-deactivated` | ウィンドウ非アクティブ化 |
| `real-object-loaded` | 実身データ読み込み完了 |
| `real-object-duplicated` | 実身複製完了 |
| `clipboard-data` | クリップボードデータ |
| `cross-window-drop-success` | クロスウィンドウドロップ成功（ソース側で受信） |

### 6.5 ベストプラクティス

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

2. **generateMessageId()でID生成**

   ```javascript
   // ✅ Good - PluginBaseのメソッドを使用
   const messageId = this.generateMessageId('duplicate');

   // ❌ Bad - 手動でID生成
   const messageId = `${prefix}-${Date.now()}-${Math.random()}`;
   ```

3. **エラーハンドリングを必ず実装**

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

4. **適切なタイムアウト設定**

   - デフォルト: 5000ms
   - ダイアログ待ち: 30000ms または 0（無制限）
   - 時間のかかる処理: 適宜調整

---

## 7. 仮身/実身操作

### 7.1 仮身コピー（左クリック+右クリック+ドラッグ）

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

### 7.2 実身複製（ダブルクリック+ドラッグ）

仮身をダブルクリックしてからドラッグすると「実身複製」になります。

```javascript
async handleDoubleClickDragDuplicate(virtualObject, dropX, dropY) {
    // 重要: ダイアログを先に表示（タイムアウト防止）
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
    const messageId = this.generateMessageId('duplicate');

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

### 7.3 refCount管理

仮身は実身への参照カウント（refCount）で管理されます。

| 操作 | refCount | メソッド |
|------|:--------:|---------|
| 仮身コピー作成 | +1 | `requestCopyVirtualObject(linkId)` |
| 仮身削除 | -1 | `requestDeleteVirtualObject(linkId)` |
| 移動（クロスウィンドウ） | ±0 | 増減なし |
| 実身複製 | 新規実身 | `duplicate-real-object`メッセージ |

**重要**: 移動モードのクロスウィンドウドロップでは、refCountは変更しません。

### 7.4 クロスウィンドウドロップ

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

## 8. ダイアログ表示

### 8.1 入力ダイアログ

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

### 8.2 保存確認ダイアログ

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

### 8.3 メッセージダイアログ

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

### 8.4 戻り値の注意点

**重要**: `showInputDialog`の戻り値は**文字列**です。オブジェクトではありません。

```javascript
// ❌ 誤った例
const result = await this.showInputDialog('名前', '');
if (result.value) { ... }  // result は文字列なので .value は undefined

// ✅ 正しい例
const name = await this.showInputDialog('名前', '');
if (name) { ... }  // name は文字列または null
```

### 8.5 ダイアログ先行パターン

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

## 9. ツールパネル（子ウィンドウ）

### 9.1 概要

ツールパネルは、メインウィンドウとは別の小さなウィンドウとして表示されるUIです。
basic-figure-editorで使用されています。

### 9.2 親側（エディタ）の実装

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

### 9.3 子側（ツールパネル）の実装

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
        this.sendToParent('tool-selected', { tool: toolType });

        // UI更新
        document.querySelectorAll('.tool-button').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tool === toolType);
        });
    }
}

const toolPanel = new ToolPanel();
```

### 9.4 親子間通信パターン

| 方向 | メッセージタイプ | 内容 |
|------|-----------------|------|
| 親→子 | `init-tool-panel` | 初期化データ（現在の状態など） |
| 子→親 | `tool-panel-ready` | 準備完了通知 |
| 子→親 | `tool-selected` | ツール選択通知 |
| 子→親 | `show-tool-panel-popup` | ポップアップメニュー表示要求 |
| 子→親 | `start-drag-tool-panel` | ドラッグ開始通知 |

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

### 10.3 プラグインからの実身読み込み

#### 10.3.1 init時の自動読み込み

プラグインは`init`メッセージで実身データを受け取ります：

```javascript
this.messageBus.on('init', (data) => {
    const { fileData, windowId } = data;

    // PluginBaseのプロパティに保存
    this.fileData = fileData;
    this.windowId = windowId;

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

#### 10.3.2 loadRealObjectDataメソッドによる読み込み

```javascript
// PluginBaseのメソッドを使用
const realObject = await this.loadRealObjectData(realId);
// realObject = { metadata, records, applist }
```

### 10.4 プラグインからの実身保存

#### 10.4.1 xml-data-changedメッセージ（簡易保存）

XTADコンテンツのみを更新する場合：

```javascript
this.messageBus.send('xml-data-changed', {
    fileId: this.realId,
    xmlData: this.generateXtadXml()
});
```

### 10.5 link_idから実身IDを抽出

仮身の`link_id`（例: `019a6c96-e262-7dfd-a3bc-1e85d495d60d_0.xtad`）から実身IDを抽出：

```javascript
// PluginBaseのメソッドを使用
const realId = this.extractRealId(linkId);
// => '019a6c96-e262-7dfd-a3bc-1e85d495d60d'
```

---

## 11. 参考実装

### 11.1 プラグイン別特徴

| プラグイン | 主な特徴 |
|-----------|---------|
| **basic-text-editor** | リッチテキスト編集、仮身挿入、仮身化機能 |
| **basic-figure-editor** | Canvas描画、ツールパネル、図形操作 |
| **basic-calc-editor** | スプレッドシート、セル編集、数式計算 |
| **virtual-object-list** | 仮身一覧表示、ドラッグ&ドロップ |
| **base-file-manager** | 原紙箱、ファイルコピー |

### 11.2 実装パターン別索引

| 実装パターン | 参考プラグイン |
|-------------|---------------|
| シンプルなPluginBase継承 | virtual-object-list, tadjs-view |
| 仮身ドラッグ&ドロップ | basic-text-editor, basic-calc-editor |
| ダブルクリック+ドラッグ（実身複製） | basic-text-editor, basic-figure-editor |
| ツールパネル子ウィンドウ | basic-figure-editor |
| メニュー定義とアクション | 全プラグイン共通 |
| 保存確認ダイアログ | basic-text-editor, basic-figure-editor |

---

## 12. トラブルシューティング

### 12.1 タイムアウトエラー

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

### 12.2 ダイアログの戻り値エラー

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

### 12.3 仮身コピーが動作しない

**原因**: `shouldMove`の判定が誤っている

**対策**: コピーモードは`effectiveMode === 'move'`がfalseの場合

```javascript
// ❌ 誤り（isDuplicateDragを含めてしまう）
const shouldMove = (effectiveMode === 'move') || !dragData?.isDuplicateDrag;

// ✅ 正しい
const shouldMove = effectiveMode === 'move';
```

### 12.4 クロスウィンドウドロップで元が消えない

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

### 12.5 カーソル位置がリセットされる

**原因**: ウィンドウアクティベーション時に`focus()`でスクロール位置がリセットされる

**対策**: `focusWithScrollPreservation()`を使用

```javascript
onWindowActivated() {
    if (this.editor) {
        // スクロール位置を保持しながらフォーカス
        this.focusWithScrollPreservation(this.editor);
    }
}
```

### 12.6 デバッグ方法

1. **開発者ツールを開く**: `Ctrl+Shift+I`

2. **MessageBusのデバッグモードを有効化**:

   ```javascript
   // plugin-base-global.jsを読み込む前に設定
   window.TADjsConfig = { debug: true };
   ```

3. **ログ出力例**:

   ```text
   [MessageBus:PluginName] Sent message: init {"fileData":{...}}
   [MessageBus:PluginName] Received message: window-moved {"pos":[10,20],...}
   ```

---

## 付録: 移行チェックリスト

既存プラグインをPluginBase対応に移行する際のチェックリスト：

- [ ] `extends window.PluginBase` を使用
- [ ] `super('PluginName')` を呼び出し（MessageBus自動初期化）
- [ ] MessageBusの手動初期化コードを削除
- [ ] `setupCommonMessageBusHandlers()` を呼び出し
- [ ] `this.fileData` プロパティを使用
- [ ] `this.isModified` で編集状態を管理
- [ ] `this.generateMessageId(prefix)` でメッセージID生成
- [ ] `getMenuDefinition()` を実装
- [ ] `executeMenuAction(action, additionalData)` を実装
- [ ] 仮身ドラッグ対応: `setupCrossWindowDropSuccessHandler()` を呼び出し
- [ ] 仮身ドラッグ対応: `onDeleteSourceVirtualObject()` を実装
- [ ] 背景色対応: `applyBackgroundColor()` で必ず `this.bgColor = color` を設定

---

## 参考リソース

### ソースファイル

| ファイル | 説明 |
| --------- | ------ |
| `js/plugin-base.js` | **PluginBase クラス（推奨の基底クラス）** |
| `js/plugin-base-global.js` | PluginBaseのグローバル版 |
| `js/message-bus.js` | MessageBus（ウィンドウ間通信） |
| `js/message-bus-global.js` | MessageBusのグローバル版 |
| `js/icon-cache-manager.js` | IconCacheManager（アイコンキャッシュ） |
| `js/virtual-object-renderer.js` | 仮身レンダラー |
| `js/logger.js` | ロガー |
| `js/util.js` | ユーティリティ関数 |
| `tadjs-desktop.js` | メインアプリケーション |

### プラグイン実装例

| プラグイン | パス | 特徴 |
| ----------- | ------ | ------ |
| 基本文章編集 | `plugins/basic-text-editor/` | リッチテキスト編集、仮身挿入 |
| 基本図形編集 | `plugins/basic-figure-editor/` | Canvas描画、ツールパネル |
| 基本表計算 | `plugins/basic-calc-editor/` | スプレッドシート、数式計算 |
| 仮身一覧 | `plugins/virtual-object-list/` | 仮身一覧表示、ドラッグ&ドロップ |
| 原紙箱 | `plugins/base-file-manager/` | 原紙管理 |

### ドキュメント

- `pluginBuildGuide.md` - プラグイン開発の詳細ガイド
