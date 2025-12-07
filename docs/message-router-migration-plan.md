# MessageRouter リファクタリング実装計画

## 📋 現状分析

### 発見事項
1. **既存のルーター機構が存在** (1805-1840行)
   - `this.messageHandlers` というマップベースのハンドラー登録機構がすでに実装済み
   - 汎用フォールバックとして動作している
   - この機構を拡張・改善する方向で進めるべき

2. **処理されているメッセージタイプ: 全45種類**

### メッセージタイプ完全リスト

#### A. ファイル・データ操作系 (14種類)
1. `get-file-data` - ファイルデータ取得
2. `save-image-file` - 画像ファイル保存
3. `load-image-file` - 画像ファイル読み込み
4. `get-image-file-path` - 画像ファイルパス取得
5. `load-data-file-request` - データファイル読み込み
6. `read-xtad-text` - xtadテキスト読み取り
7. `read-icon-file` - アイコンファイル読み込み
8. `open-external-file` - 外部ファイルを開く
9. `open-url-external` - URL外部で開く
10. `get-data-folder` - データフォルダ取得
11. `set-data-folder` - データフォルダ設定
12. `open-folder-dialog` - フォルダ選択ダイアログ
13. `check-folder-access` - フォルダアクセス検証
14. `archive-files-generated` - アーカイブファイル生成完了

#### B. 仮身・実身操作系 (8種類)
15. `open-virtual-object` - 仮身を開く
16. `open-virtual-object-real` - 仮身の実身を開く
17. `open-tad-link` - TADリンクを開く
18. `rename-real-object` - 実身名変更
19. `duplicate-real-object` - 実身複製
20. `save-as-new-real-object` - 新規実身として保存
21. `change-virtual-object-attributes` - 仮身属性変更
22. `request-base-plugins` - 原紙プラグイン取得

#### C. ドラッグ&ドロップ系 (7種類)
23. `archive-drop-detected` - アーカイブドロップ検出
24. `archive-drop-handled` - アーカイブドロップ処理完了
25. `insert-root-virtual-object` - ルート実身配置
26. `root-virtual-object-inserted` - ルート実身配置完了
27. `base-file-drop-request` - 原紙ファイルドロップ
28. `trash-real-object-drop-request` - ごみ箱実身ドロップ
29. `notify-cross-window-drop` - クロスウィンドウドロップ通知
30. `cross-window-drop-success` - クロスウィンドウドロップ成功

#### D. UI・ダイアログ系 (6種類)
31. `show-input-dialog` - 入力ダイアログ表示
32. `show-message-dialog` - メッセージダイアログ表示
33. `show-custom-dialog` - カスタムダイアログ表示
34. `show-save-confirm-dialog` - 保存確認ダイアログ表示
35. `get-system-fonts` - システムフォント一覧取得
36. `get-plugin-list` - プラグインリスト取得

#### E. ウィンドウ管理系 (7種類)
37. `content-size-changed` - コンテンツサイズ変更
38. `set-window-icon` - ウィンドウアイコン設定
39. `window-close-response` - ウィンドウクローズ応答
40. `update-scrollbars` - スクロールバー更新
41. `update-window-config` - ウィンドウ設定更新
42. `update-panel-position` - パネル位置更新

#### F. クリップボード系 (2種類)
43. `set-clipboard` - クリップボード設定
44. `get-clipboard` - クリップボード取得

#### G. 道具パネル系 (4種類)
45. `open-tool-panel-window` - 道具パネルウィンドウを開く
46. `show-tool-panel-popup` - 道具パネルポップアップ表示
47. `hide-tool-panel-popup` - 道具パネルポップアップ非表示
48. `start-drag-tool-panel` - 道具パネルドラッグ開始

#### H. 特殊フラグ系 (2種類)
49. `fromEditor` - エディタからのメッセージ（中継用）
50. `fromToolPanel` - 道具パネルからのメッセージ（中継用）

---

## 🎯 リファクタリング戦略

### 戦略A: 既存機構の拡張（推奨）

**理由**:
- すでに汎用ハンドラー機構が実装されている (1805-1840行)
- ゼロから作るより、既存を改善する方がリスクが低い
- 段階的移行が容易

**アプローチ**:
1. 既存の`messageHandlers`機構を独立したクラスに抽出
2. 現在のif-else地獄を段階的にハンドラー登録方式に移行
3. 旧コードと新コードを並行稼働

### 戦略B: 完全新規実装

**理由**:
- より洗練された設計が可能
- レガシーコードに引きずられない

**問題点**:
- 既存機構との二重管理になる
- 移行コストが高い
- **推奨しない**

---

## 📐 詳細設計: MessageRouter v2

### Phase 1: 基盤クラスの実装

#### 1.1 MessageRouter クラス

```javascript
/**
 * メッセージルーター
 * postMessageイベントを適切なハンドラーに振り分ける
 */
class MessageRouter {
    constructor(tadjs) {
        this.tadjs = tadjs;
        this.handlers = new Map();
        this.logger = window.getLogger('MessageRouter');

        // 既存のmessageHandlersとの互換性を保持
        this.legacyHandlers = tadjs.messageHandlers || {};
    }

    /**
     * ハンドラーを登録
     * @param {string} messageType - メッセージタイプ
     * @param {Function} handler - ハンドラー関数 async (data, event) => result
     * @param {Object} options - オプション
     * @param {boolean} options.autoResponse - 自動レスポンス送信
     * @param {string} options.responseType - レスポンスメッセージタイプ（デフォルト: messageType + '-response'）
     */
    register(messageType, handler, options = {}) {
        const config = {
            handler,
            autoResponse: options.autoResponse !== undefined ? options.autoResponse : true,
            responseType: options.responseType || `${messageType}-response`,
            ...options
        };

        this.handlers.set(messageType, config);
        this.logger.debug(`Handler registered: ${messageType}`);
    }

    /**
     * 複数のハンドラーを一括登録
     * @param {Object} handlerMap - { messageType: handler } のマップ
     */
    registerBatch(handlerMap) {
        for (const [messageType, config] of Object.entries(handlerMap)) {
            if (typeof config === 'function') {
                this.register(messageType, config);
            } else {
                this.register(messageType, config.handler, config);
            }
        }
    }

    /**
     * メッセージをルーティング
     * @param {MessageEvent} event - メッセージイベント
     * @returns {Promise<boolean>} - ハンドリングされたかどうか
     */
    async route(event) {
        const data = event.data;
        if (!data || !data.type) {
            return false;
        }

        const messageType = data.type;
        const config = this.handlers.get(messageType);

        if (!config) {
            // 新規ハンドラーが見つからない場合、レガシーハンドラーを確認
            if (this.legacyHandlers[messageType]) {
                this.logger.debug(`Using legacy handler: ${messageType}`);
                return false; // レガシーシステムに処理を任せる
            }
            return false;
        }

        try {
            this.logger.debug(`Routing: ${messageType}`);

            // ハンドラー実行
            const result = await config.handler(data, event);

            // 自動レスポンス送信
            if (config.autoResponse && event.source) {
                this.tadjs.parentMessageBus.respondTo(
                    event.source,
                    config.responseType,
                    {
                        messageId: data.messageId,
                        success: true,
                        result: result
                    }
                );
            }

            return true; // 処理完了
        } catch (error) {
            this.logger.error(`Handler error for ${messageType}:`, error);

            // エラーレスポンス送信
            if (config.autoResponse && event.source) {
                this.tadjs.parentMessageBus.respondTo(
                    event.source,
                    config.responseType,
                    {
                        messageId: data.messageId,
                        success: false,
                        error: error.message
                    }
                );
            }

            return true; // エラーでも処理済みとする
        }
    }
}
```

#### 1.2 ヘルパーメソッド追加

```javascript
/**
 * TADjsDesktop クラスに追加するヘルパーメソッド
 */

/**
 * レスポンス送信ヘルパー
 */
respond(source, responseType, data, messageId = null) {
    if (!source) {
        logger.error(`[TADjs] Cannot send ${responseType}: source is null`);
        return false;
    }

    const responseData = messageId
        ? { messageId, ...data }
        : data;

    try {
        this.parentMessageBus.respondTo(source, responseType, responseData);
        return true;
    } catch (error) {
        logger.error(`[TADjs] Failed to send ${responseType}:`, error);
        return false;
    }
}

/**
 * エラーレスポンスヘルパー
 */
respondError(source, responseType, error, messageId = null) {
    return this.respond(source, responseType, {
        success: false,
        error: error.message || error
    }, messageId);
}

/**
 * 成功レスポンスヘルパー
 */
respondSuccess(source, responseType, data = {}, messageId = null) {
    return this.respond(source, responseType, {
        success: true,
        ...data
    }, messageId);
}

/**
 * ダイアログ表示とレスポンス統合ヘルパー
 */
async showDialogAndRespond(dialogType, params, responseType, event) {
    try {
        let result;

        switch (dialogType) {
            case 'message':
                result = await this.showMessageDialog(
                    params.message,
                    params.buttons,
                    params.defaultButton || 0
                );
                break;
            case 'input':
                result = await this.showInputDialog(
                    params.message,
                    params.defaultValue || '',
                    params.inputWidth || 30,
                    params.buttons,
                    params.defaultButton || 0
                );
                break;
            case 'custom':
                result = await this.showCustomDialog(
                    params.dialogHtml,
                    params.buttons,
                    params.defaultButton || 0,
                    params.inputs || {}
                );
                break;
        }

        this.respondSuccess(event.source, responseType, { result }, params.messageId);
    } catch (error) {
        this.respondError(event.source, responseType, error, params.messageId);
    }
}
```

---

## 🚀 段階的移行計画

### Phase 1: 基盤構築 (1日)

#### Step 1.1: MessageRouterクラス実装
- **ファイル**: `js/message-router.js` (新規作成)
- **内容**: MessageRouterクラスの実装
- **リスク**: 極低（新規ファイル、既存コードに影響なし）

#### Step 1.2: ヘルパーメソッド追加
- **ファイル**: `tadjs-desktop.js`
- **挿入位置**: 7500行目付近（ダイアログメソッドの後）
- **追加メソッド**: `respond()`, `respondError()`, `respondSuccess()`, `showDialogAndRespond()`
- **リスク**: 極低（新規メソッド、既存コードに影響なし）

#### Step 1.3: MessageRouter初期化
- **ファイル**: `tadjs-desktop.js`
- **変更箇所**: `constructor()` (27-113行)
- **追加コード**:
```javascript
// MessageRouter初期化（Phase 2移行用）
this.messageRouter = new window.MessageRouter(this);
```
- **リスク**: 極低（インスタンス作成のみ）

### Phase 2: 簡単なメッセージから移行 (2-3日)

#### 優先度: グループD (UI・ダイアログ系) - 最も単純

**移行対象**:
1. `show-message-dialog` (1537-1550行)
2. `show-input-dialog` (1521-1536行)
3. `show-custom-dialog` (1551-1580行)
4. `show-save-confirm-dialog` (1581-1594行)

**手順**:

##### Step 2.1: ハンドラーメソッド実装

**ファイル**: `tadjs-desktop.js`
**挿入位置**: 新規メソッドとして7600行目付近に追加

```javascript
// ========================================
// MessageRouter ハンドラーメソッド
// ========================================

/**
 * show-message-dialog ハンドラー
 */
async handleShowMessageDialog(data, event) {
    return await this.showDialogAndRespond(
        'message',
        data,
        'message-dialog-response',
        event
    );
}

/**
 * show-input-dialog ハンドラー
 */
async handleShowInputDialog(data, event) {
    return await this.showDialogAndRespond(
        'input',
        data,
        'input-dialog-response',
        event
    );
}

/**
 * show-custom-dialog ハンドラー
 */
async handleShowCustomDialog(data, event) {
    // カスタムダイアログは特殊処理が必要
    try {
        const result = await this.showCustomDialog(
            data.dialogHtml,
            data.buttons,
            data.defaultButton || 0,
            { ...(data.inputs || {}), radios: data.radios }
        );

        // selectedFontIndex の抽出
        let selectedFontIndex = null;
        if (result.dialogElement) {
            const selectedElement = result.dialogElement.querySelector('.font-list-item.selected');
            if (selectedElement) {
                selectedFontIndex = parseInt(selectedElement.getAttribute('data-index'));
            }
        }

        const { dialogElement, ...resultWithoutElement } = result;

        this.respondSuccess(event.source, 'custom-dialog-response', {
            result: {
                ...resultWithoutElement,
                selectedFontIndex: selectedFontIndex
            }
        }, data.messageId);
    } catch (error) {
        this.respondError(event.source, 'custom-dialog-response', error, data.messageId);
    }
}

/**
 * show-save-confirm-dialog ハンドラー
 */
async handleShowSaveConfirmDialog(data, event) {
    return await this.showDialogAndRespond(
        'message',
        { ...data, defaultButton: 2 },
        'message-dialog-response',
        event
    );
}
```

##### Step 2.2: ハンドラー登録

**ファイル**: `tadjs-desktop.js`
**変更箇所**: `init()` メソッド (118-142行)
**追加コード**:

```javascript
async init() {
    this.setupEventListeners();
    this.setupStatusBar();
    this.setupDropZone();

    this.loadSavedBackground();
    this.applyUserConfig();
    this.setupParentMessageBusHandlers();

    await this.initRealObjectSystem();

    this.fileImportManager = new window.FileImportManager(this);
    logger.info('[TADjs] FileImportManager初期化完了');

    // ===== Phase 2: MessageRouter ハンドラー登録 =====
    this.registerMessageRouterHandlers();

    this.createInitialWindow();

    logger.info('TADjs Desktop Environment initialized');
}

/**
 * MessageRouter ハンドラーを登録
 * Phase 2: ダイアログ系から段階的移行
 */
registerMessageRouterHandlers() {
    // ダイアログ系ハンドラー登録
    this.messageRouter.register('show-message-dialog',
        this.handleShowMessageDialog.bind(this),
        { autoResponse: false } // 手動レスポンス
    );

    this.messageRouter.register('show-input-dialog',
        this.handleShowInputDialog.bind(this),
        { autoResponse: false }
    );

    this.messageRouter.register('show-custom-dialog',
        this.handleShowCustomDialog.bind(this),
        { autoResponse: false }
    );

    this.messageRouter.register('show-save-confirm-dialog',
        this.handleShowSaveConfirmDialog.bind(this),
        { autoResponse: false }
    );

    logger.info('[TADjs] Phase 2: ダイアログ系ハンドラー登録完了 (4件)');
}
```

##### Step 2.3: setupEventListeners()を修正

**ファイル**: `tadjs-desktop.js`
**変更箇所**: `setupEventListeners()` 内のpostMessageハンドラー (1134-1841行)

**修正方針**:
```javascript
window.addEventListener('message', async (e) => {
    // ===== Phase 2: MessageRouter優先処理 =====
    const handled = await this.messageRouter.route(e);
    if (handled) {
        return; // MessageRouterで処理された場合は終了
    }

    // ===== 既存のif-elseチェーン =====
    if (e.data && e.data.type === 'content-size-changed') {
        // ...
    } else if (e.data && e.data.type === 'show-message-dialog') {
        // ⚠️ このブロックは削除予定（現在はMessageRouterに移行済み）
        // 暫定的にコメントアウトして動作確認
        /*
        this.showMessageDialog(...).then(result => {
            ...
        });
        */
    }
    // ... 他のメッセージタイプ
});
```

##### Step 2.4: 改造箇所チェックリスト

**新規追加ファイル**:
- [ ] `js/message-router.js` - MessageRouterクラス

**tadjs-desktop.js 変更箇所**:
- [ ] constructor (27-113行) - MessageRouter初期化追加
- [ ] init() (118-142行) - registerMessageRouterHandlers()呼び出し追加
- [ ] 7500行目付近 - ヘルパーメソッド4つ追加
- [ ] 7600行目付近 - ダイアログハンドラー4つ追加
- [ ] 7700行目付近 - registerMessageRouterHandlers()メソッド追加
- [ ] setupEventListeners() (1071-1842行) - MessageRouter.route()呼び出し追加
- [ ] 1537-1550行 - show-message-dialog ブロックコメントアウト
- [ ] 1521-1536行 - show-input-dialog ブロックコメントアウト
- [ ] 1551-1580行 - show-custom-dialog ブロックコメントアウト
- [ ] 1581-1594行 - show-save-confirm-dialog ブロックコメントアウト

**index.html 変更箇所**:
- [ ] MessageRouterスクリプトのインポート追加

##### Step 2.5: テスト項目

- [ ] メッセージダイアログ表示
- [ ] 入力ダイアログ表示
- [ ] カスタムダイアログ表示（フォント選択）
- [ ] 保存確認ダイアログ表示
- [ ] ダイアログからのレスポンス受信
- [ ] エラーケース（source=null）

---

### Phase 3: 中程度の複雑さのメッセージ移行 (3-4日)

#### 優先度: グループA (ファイル・データ操作系) の一部

**移行対象** (簡単な順):
1. `open-folder-dialog` (1389-1419行)
2. `check-folder-access` (1420-1440行)
3. `get-data-folder` (1441-1449行)
4. `get-plugin-list` (1513-1520行)
5. `get-image-file-path` (1174-1183行)

**手順**: Phase 2 と同様

---

### Phase 4: 複雑なメッセージ移行 (5-7日)

#### 優先度: 残りすべて

**移行対象**:
- グループA残り（ファイル操作）
- グループB（仮身・実身操作）
- グループC（ドラッグ&ドロップ）
- グループE（ウィンドウ管理）
- グループF（クリップボード）
- グループG（道具パネル）
- グループH（特殊フラグ）

---

### Phase 5: 旧コード削除とクリーンアップ (1日)

**作業内容**:
1. コメントアウトしたif-elseブロックを完全削除
2. 不要になったレガシーコード削除
3. 統合テスト実施

---

## 📝 実装チェックリスト（Phase 1 & 2）

### Phase 1: 基盤構築

#### ファイル作成
- [ ] `js/message-router.js` 作成
  - [ ] MessageRouterクラス実装
  - [ ] register()メソッド
  - [ ] registerBatch()メソッド
  - [ ] route()メソッド

#### ヘルパーメソッド追加
- [ ] `tadjs-desktop.js` 7500行目付近に追加
  - [ ] respond()
  - [ ] respondError()
  - [ ] respondSuccess()
  - [ ] showDialogAndRespond()

#### MessageRouter初期化
- [ ] `tadjs-desktop.js` constructor に追加
  - [ ] MessageRouter インスタンス作成

#### スクリプトロード
- [ ] `index.html` に `<script>` タグ追加

### Phase 2: ダイアログ系移行

#### ハンドラーメソッド実装
- [ ] `tadjs-desktop.js` 7600行目付近に追加
  - [ ] handleShowMessageDialog()
  - [ ] handleShowInputDialog()
  - [ ] handleShowCustomDialog()
  - [ ] handleShowSaveConfirmDialog()

#### ハンドラー登録メソッド
- [ ] `tadjs-desktop.js` 7700行目付近に追加
  - [ ] registerMessageRouterHandlers()

#### init()修正
- [ ] registerMessageRouterHandlers() 呼び出し追加

#### setupEventListeners()修正
- [ ] MessageRouter.route() 呼び出し追加（先頭）
- [ ] 既存ブロックをコメントアウト
  - [ ] show-message-dialog (1537-1550行)
  - [ ] show-input-dialog (1521-1536行)
  - [ ] show-custom-dialog (1551-1580行)
  - [ ] show-save-confirm-dialog (1581-1594行)

#### テスト実施
- [ ] 全ダイアログタイプの動作確認
- [ ] エラーケースの確認
- [ ] レスポンス受信の確認

---

## ⚠️ リスク管理

### 高リスク箇所
1. **setupEventListeners()の巨大さ**
   - 600行以上のメソッド
   - 慎重な編集が必要

2. **カスタムダイアログの特殊処理**
   - selectedFontIndexの抽出ロジック
   - dialogElement除去ロジック

### リスク軽減策
1. **段階的コメントアウト**
   - 削除せずコメントアウトで移行
   - 問題発生時に即座にロールバック可能

2. **並行稼働期間**
   - 新旧両方のコードを一定期間並行稼働
   - 十分なテスト後に旧コード削除

3. **Gitコミット戦略**
   - Phase単位で細かくコミット
   - 各ステップごとにコミット

---

## 📊 期待される効果

### コード行数削減
- **現状**: setupEventListeners() 約700行
- **移行後**: 約100行 + ハンドラーメソッド群（各10-30行）
- **削減率**: 約70%

### 可読性向上
- 各メッセージタイプが独立したメソッドに
- 責務が明確化
- テストが容易に

### 保守性向上
- 新しいメッセージタイプの追加が簡単
- エラーハンドリングの統一
- デバッグが容易

---

## 次のアクション

ユーザーの承認を得て、Phase 1 から実装開始する準備が整いました。

**質問**:
1. Phase 1 の実装を開始してよろしいですか？
2. 特に慎重に進めるべき箇所はありますか？
3. テスト方法について追加の要件はありますか？
