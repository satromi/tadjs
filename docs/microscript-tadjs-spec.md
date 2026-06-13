# マイクロスクリプト TADjs Desktop 移植版仕様

TADjs Desktop の microscript プラグインが対応している BTRON マイクロスクリプト機能の仕様書。

**準拠仕様**: BTRON 公式マニュアル [09-03〜09-04](https://www.chokanji.com/ckv/manual/) (VERSION 3 相当)

**実行環境**: Electron (Chromium / Node.js) 内 iframe / Canvas 2D / Web Audio / MessageBus

---

## 1. 構文 (準拠)

BTRON 公式仕様 (09-03-01〜03) と同一。

- 文の形式: `〈命令〉 〈引数〉…` (カンマ区切り)
- 行継続: 段落末尾の `\\`
- 連続実行: `;` セパレータ (表示更新も停止)
- コメント: `#` 以降、 空段落は無視
- 一意表現 / 言語指定コード正規化

### 1.1 定数・演算子・式

- 整数 (10進/16進、 32bit)、 浮動小数 (64bit、 ±1e300、 約14桁)
- 文字定数 `'A'`、 文字列定数 `"…"` (文字型配列、 末尾0)
- エスケープ: `\n \r \t \b \0 \<文字>`
- 単項: `- ~ !`
- 二項: `+ - * / % & | ^ << >> < <= > >= == != && ||`
- 不正値: `0x80000000` (`valid()` で判定)
- 書式文字列: `%d %x %X %f %e %E %g %G %s %c %% \n` (幅・小数桁・左寄せ・0埋め対応)

### 1.2 名前・変数

- 名前先頭12文字を識別 (公式と同一、 lexer で切り詰め)
- 変数型: B/C/I/F/S/G
  - **B (0〜255) / C (0〜65535) は代入時に値域へマスク** (公式準拠)
  - I/F は JS の数値制約上、 整数切り捨てを導入しない (1.0 と 1 が区別不能なため。 意図的差異)
- 配列: `A:I[10]` (大域 1,048,576 個、 局所 4,096 個。 超過は丸め + 警告)
- 部分配列: `A[10:5]` `A[5:]` `A[:20]` `A[:]`
- 配列共有: `VARIABLE X:C[50]=A` (要素単位の参照共有。 異種型のバイト単位共有は未対応)
- 変数種類: 局所 (LOCAL)、 大域 (VARIABLE)、 共有 (`$GV[0..49]`)、 保存 (`$SV[0..49]`)

**永続化**:
- `$GV[]` セッション内のみ (アプリ再起動でリセット)
- `$SV[]` localStorage で永続化 (ブラウザの localStorage 共有範囲内)

---

## 2. 命令・関数の対応状況

### 凡例

- ✅ 完全対応 (BTRON仕様準拠)
- 🟢 機能対応 (一部簡略実装)
- 🟡 構文のみ通過 (環境制約により noop + 警告ログ)
- ❌ 未対応 (エラー)

### 2.1 宣言・定義

| 命令 | 対応 | 備考 |
|---|---|---|
| VERSION | ✅ | 1 行目に必須 (version=2/3) |
| DEFINE | ✅ | マクロ定義 |
| VARIABLE | ✅ | 大域変数 |
| LOCAL | ✅ | 局所変数 |
| SEGMENT | ✅ | 可変セグメント宣言 |
| SCRIPT | ✅ | 手続き名事前宣言 (構文通過のみ) |
| COMMENT | ✅ | コメント行 |
| DEBUG | ✅ | デバッグレベル (実質 noop) |
| LOG | ✅ | コンソール出力 (実質 noop) |

### 2.2 手続き

| 命令 | 対応 | 備考 |
|---|---|---|
| PROLOGUE | ✅ | ウィンドウ開始時 1 回実行 |
| EPILOGUE | ✅ | ウィンドウ閉鎖時に実行 |
| ACTION | ✅ | 並列・単一実行 (実行中は再起動しない多重起動防止を実装) |
| MACTION | ✅ | 並列・多重実行 (実行中でも新たに起動) |
| FUNC | ✅ | 逐次関数 (CALL / 式中で使用) |
| 手続き名.S | ✅ | 手続き状態参照 (0:停止 1:実行中 2:待機) |

### 2.3 制御

| 命令 | 対応 | 備考 |
|---|---|---|
| SET | ✅ | (`SET` 省略可) |
| IF/ELSEIF/ELSE/ENDIF | ✅ | |
| WHILE/ENDWHILE | ✅ | |
| REPEAT/ENDREPEAT | ✅ | `$CNT` で回数参照 |
| SWITCH/CASE/DEFAULT/ENDCASE | ✅ | BREAK で抜ける |
| BREAK | ✅ | ループ抜け / `BREAK 手続き名…` で指定手続きの SLEEP/WAIT/VWAIT を解除 |
| CONTINUE | ✅ | |
| EXIT | ✅ | 戻り値指定可 |
| CALL | ✅ | FUNC 逐次呼出 |
| EXECUTE | ✅ | ACTION/MACTION 並列起動、 `:変数` で手続き番号取得 |
| FINISH | ✅ | EPILOGUE 実行後ウィンドウ閉鎖 |
| TERMINATE | ✅ | 指定手続き or 自分以外を終了 |
| SUSPEND | ✅ | 手続き終了待ち + タイムアウト |
| SLEEP | ✅ | ミリ秒 |
| WAIT | ✅ | 条件成立まで + タイムアウト |
| SETSEG | ✅ | 可変セグメントへ参照代入 |
| COPYSEG | ✅ | 複製代入 (複数結合) |

### 2.4 描画・効果

| 命令 | 対応 | 備考 |
|---|---|---|
| SCENE | 🟢 | 効果対応: WIPE_D/U/R/L, SCRL_D/U/R/L, WIPE_V/H/C, STRP_H/V, MOSAIC |
| APPEAR | 🟢 | 効果対応 (SCENE と同じ) |
| DISAPPEAR | 🟢 | 効果対応 (APPEAR の逆方向遷移で徐々に非表示) |
| MOVE | ✅ | DUP 修飾子対応 (複製移動、 最大 16380) |
| BEEP | 🟢 | Web Audio API 利用 |

### 2.5 ウィンドウ

| 命令 | 対応 | 備考 |
|---|---|---|
| WSIZE | 🟢 | MessageBus 経由でウィンドウサイズ変更 |
| WMOVE | 🟢 | MessageBus 経由で位置変更 |
| WSAVE | 🟢 | MessageBus 経由で位置/サイズ保存要求 |
| FULLWIND | 🟢 | MessageBus 経由でフルスクリーン要求 |
| UPDATE | ✅ | 0=描画停止、 非0で再開 |

### 2.6 メッセージ・入力

| 命令 | 対応 | 備考 |
|---|---|---|
| MESG | ✅ | メッセージエリアに表示 (引数省略で消去) |
| TEXT | ✅ | 文字セグメント書換 |
| INPUT | 🟢 | キーボード数字入力 (Enter 確定、 Backspace 削除)。 X,Y カーソル初期位置対応 |
| KINPUT | 🟢 | かな漢字変換入力 (Electron 標準 IME 通過)。 X,Y 対応 |

### 2.7 仮身操作

| 命令 | 対応 | 備考 |
|---|---|---|
| VOPEN | 🟢 | MessageBus 経由で `open-real-object` 要求 |
| VCLOSE | 🟢 | MessageBus 経由で `close-real-object` 要求 |
| VWAIT | 🟢 | タイムアウトのみ実装 (実ウィンドウ閉鎖追跡は未対応) |

### 2.8 実身 I/O

| 命令 | 対応 | 備考 |
|---|---|---|
| FOPEN | 🟢 | `load-real-object` MessageBus 経由で実身データを取得しキャッシュ |
| FCLOSE | 🟢 | キャッシュから削除 |
| FREAD | 🟢 | レコードデータをバイト型配列に読み込み |
| FWRITE | 🟢 | バイト型配列のデータをレコードに書込み + `save-real-object` |

**動作**:
- 〈実身指定〉はパス名 (= 実身 ID/realId) で指定。 仮身セグメント指定は未対応
- レコード番号 0〜N、 オフセット 0〜
- レコードサイズ縮小: offset=-1
- 自動オープン: FRead/FWrite が未オープン時に "U" モードでオープン

### 2.9 イベント

| 命令 | 対応 | 備考 |
|---|---|---|
| EVENT | 🟢 | 種別: KEYD/KEYU/KEYC/BUTD/BUTU/BUTC、 合成イベントを発火 |

### 2.10 プロセス系 (環境制約により noop)

| 命令 | 対応 | $ERR |
|---|---|---|
| PROCESS | 🟡 | 48 |
| PWAIT | 🟡 | 48 |
| MSEND | 🟡 | 48 |
| MRECV | 🟡 | 48 |

Electron セキュリティ上、 任意プロセスの起動は許可されないため、 構文だけ通過。

### 2.11 HW 依存系 (環境制約により noop)

| 命令 | 対応 | $ERR |
|---|---|---|
| DOPEN/DCLOSE/DREAD/DWRITE | 🟡 | 16 |
| RSINIT/RSPUTC/RSPUT/RSPUTN/RSWAIT/RSGETN/RSGET/RSGETC/RSCNTL | 🟡 | 16 |

ブラウザ環境ではシリアル/デバイスへの直接アクセスを制限。 BTRON 公式サンプルでは未使用のため警告ログのみ。

### 2.12 組み込み関数

| 関数 | 対応 | 備考 |
|---|---|---|
| valid(x) | ✅ | 不正値判定 |
| number(x) | ✅ | 数値判定 |
| sin/cos/tan/asin/acos/atan | ✅ | ラジアン |
| sqrt/exp/log/log10 | ✅ | |
| floor/ceil/round/fabs | ✅ | |
| pow(a,b) max(a,b) min(a,b) | ✅ | |
| asrch(v,s,val,len) | 🟢 | 配列検索、 不一致は不正値 |
| acmp(v1,s1,v2,s2,len) | ✅ | -1/0/1 |
| acopy(v1,s1,v2,s2,len) | ✅ | コピー要素数 |
| slen(v) | ✅ | 0 終端まで |
| scmp(v1,s1,v2,s2,len) | ✅ | -1/0/1 |
| strnum(v,s,fmt[,end]) | 🟢 | 'd'/'x'/'X'/'f' 対応、 0x プレフィクス自動認識 |
| sconv(v1,s1,v2,s2,len,code) | 🟢 | SJIS/EUC→TRON 簡易 (ASCII + 2byte 連結) |
| srconv(v1,s1,v2,s2,len,code) | 🟢 | TRON→SJIS/EUC 簡易 |
| newimgseg(path,x,y[,Xi,Yi,Wi,Hi]) | 🟢 | JPEG/PNG/BMP セグメント動的生成 (Xi/Yi/Wi/Hi 未使用) |
| filelist(path,var[,order]) | 🟢 | MessageBus `list-virtual-objects` 経由 (TADjs Desktop ホスト側ハンドラ未実装時は 0 を返す) |
| getgnm/setgnm/delgnm | 🟢 | グローバル名は実行時 Map (永続化なし) |
| tmdate(arr,systm) | ✅ | 年/月/日/時/分/秒/週/曜日/年日 を 9 要素配列に格納 |
| datetm(arr) | ✅ | 6 要素 (年〜秒) → システム時刻 |

### 2.13 システム変数

| 変数 | RW | 対応 | 備考 |
|---|---|---|---|
| $ERR | R | ✅ | エラーコード |
| $PID/$PPID/$WID | R | 🟢 | 起動時に擬似 ID 生成 |
| $TID | R | 🟢 | 0 を返す (将来動的化) |
| $MMASK | RW | 🟢 | MRECV マスク (noop プロセス通信のため実質未使用) |
| $CNT | R | ✅ | REPEAT 内で参照可 |
| $PDX/$PDY | R | ✅ | マウス座標 |
| $KSTAT | R | 🟢 | キー押下時のメタ状態 |
| $PDB | R | ✅ | マウスボタン |
| $PDS | RW | 🟢 | CSS cursor 変更 (0=default/1=pointer/2=move/3=ns-resize/…/14=wait/15=context-menu/-1=none) |
| $KEY | R | ✅ | 最後の文字コード |
| $METAKEY | R | ✅ | 最後のメタ状態 |
| $KMODE | RW | 🟢 | かな漢字確定モード (実装上は記録のみ) |
| $DATE | R | ✅ | (西暦-1900)×10000 + 月×100 + 日 (BTRON仕様。 スクリプト側で 1900+年÷10000 として西暦に戻す) |
| $TIME | R | ✅ | HHMMSS |
| $MSEC | R | ✅ | 起動からの ms |
| $SYSTM | R | ✅ | 1985-01-01 GMT からの秒 |
| $GV[0..49] | RW | ✅ | セッション内共有 |
| $SV[0..49] | RW | ✅ | localStorage 永続化 |
| $RSCNT/$RS[] | R | 🟡 | 常に 0 (RS 命令が noop のため) |
| $WDW/$WDH | R | ✅ | キャンバスサイズ |
| $WDX/$WDY | R | 🟢 | stage に渡された値 (現状 0) |
| $WACT | R | 🟢 | stage に渡された値 (現状 1) |
| $SCRW/$SCRH | R | ✅ | window.screen |
| $RAND | R | ✅ | 0〜65535 |
| $VERS | R | ✅ | VERSION 文の値 |
| $DSKINS | RW | 🟡 | 常に 0 |
| $CPULOAD | R | 🟡 | 常に 0 |
| $PWID | RW | 🟢 | 親ウィンドウ ID (記録のみ) |

### 2.14 セグメント状態 (.state)

| 状態 | RW | 対応 | 備考 |
|---|---|---|---|
| .S | RW | ✅ | 可視性 (公式は R のみ、 移植版は SET も対応) |
| .PID | RW | ✅ | 仮身プロセス ID |
| .X/.Y | RW | ✅ | 座標 |
| .X0/.Y0 | RW | ✅ | 元位置 (公式は R のみ、 移植版は SET も対応) |
| .W/.H | R | ✅ | サイズ |
| .V | RW | ✅ | 数値化文字列 (公式は R、 移植版は SET で `String(value)` で書換) |
| .TL | R | ✅ | 文字数 |
| .TX | RW | ✅ | 文字配列 |
| .TFCOL/.TBCOL | RW | ✅ | 文字色/背景色 (0xRRGGBB) |
| .TSTYL | RW | 🟢 | 文字修飾。 描画反映は下線 (1) のみ。 網掛け/比例ピッチ/階調/縦書きは保持のみ |
| .TSIZE | RW | ✅ | 文字サイズ (px) |
| .TCGAP/.TLGAP | RW | ✅ | 文字/行間隔 |
| .TFONT | RW | ✅ | 書体名 (12文字配列) |

---

## 3. シンボル定数

### 表示効果 (SCENE/APPEAR)

`WIPE_D WIPE_U WIPE_R WIPE_L SCRL_D SCRL_U SCRL_R SCRL_L WIPE_V WIPE_H WIPE_C STRP_H STRP_V MOSAIC`

### イベント種別 (EVENT)

`KEYD KEYU KEYC BUTD BUTU BUTC`

### 型

`B C I F S G`

### FOPEN モード

`"R" "W" "U" "RX" "WX" "UX" "Rx" "Wx" "Ux"` (R 系は読込専用で FWRITE はエラー。 排他 X は未対応)

### イベントハンドラ種別

`PRESS CLICK DCLICK QPRESS MENU KEY`

---

## 4. TADjs Desktop 固有の動作

### 4.1 SCRIPT 仮身の読み込み

- 図形 TAD 内の `<link>` 要素が指す実身を `MessageBus.load-real-object` で取得
- 名前が `SCRIPT〜` または `SCRIPT:〜` で始まる文章実身を台本として連結
- `@@`/`@@+` で始まる仮身はサブ図形として読込、 セグメントを抽出

### 4.2 図形セグメント / 役者の抽出

- `<group>` 要素が役者の単位
- グループ内に `@名前` または `＠名前` 文字枠が含まれていればセグメント名として登録
- 画像 (`<image>`)、 文章 (`<docView>`)、 図形プリミティブを Canvas に描画

### 4.3 イベントハンドリング

| イベント | トリガ |
|---|---|
| PRESS | マウスボタン押下 (mousedown) |
| CLICK | マウスクリック (click) |
| DCLICK | ダブルクリック (dblclick) |
| QPRESS | クイックプレス (現状 click と同じ) |
| MENU | メニュー選択 (現状未配線) |
| KEY | キー押下 |

### 4.4 ステータスバー表示

- `MESG` 命令はマイクロスクリプトウィンドウ内のメッセージエリアに表示
- 「台本読み込み: SCRIPT (1個)」 等のメタ情報は TADjs Desktop の `#status-bar` に `setStatus()` で送信

### 4.5 BTRON 仕様との差異

| 項目 | BTRON | TADjs Desktop |
|---|---|---|
| ピクセル単位 | TRON 座標 | CSS ピクセル (devicePixelRatio 対応) |
| 文字描画 | 内部書体 + フォントクラス | Canvas 2D の `font` (sans-serif フォールバック) |
| 文字コード | TRON (32bit) | UTF-16 (JS 内部) |
| プロセス | TRON プロセス | スレッドオブジェクト (協調的) |
| ウィンドウ | T-Carde + 重ねウィンドウ | Electron BrowserWindow + iframe |
| シリアル/デバイス | TAD 仕様 | 未対応 (noop) |
| シャットダウン | システムシャットダウン | アプリ終了 |

---

## 5. 制限事項 / 注意点

0. **意図的な仕様差異 (JS 環境制約)**:
   - 整数除算 `/`: 整数同士でも常に浮動小数結果 (JS で 1.0 と 1 が区別不能なため。 整数結果が必要なら `floor()` 併用)
   - I 型代入の整数切り捨てなし (同上の理由)
   - 整数オーバーフローの 32bit 折り返しなし
   - FULLWIND は「次回起動時」 ではなく即時フルスクリーン
   - 配列共有は要素単位の参照共有 (異種型のバイト単位共有は未対応)
1. **HW 依存**: シリアル (RS*) / デバイス (D*) / プロセス起動 (PROCESS/PWAIT) は機能しない (構文だけ通過)
2. **VWAIT のウィンドウ閉鎖追跡**: 現状はタイムアウトのみ。 実 BTRON ではプロセス終了通知で確実に検知できる
3. **filelist**: TADjs Desktop ホスト側で `list-virtual-objects` メッセージハンドラが必要 (未実装の場合は空)
4. **getgnm/setgnm/delgnm**: メモリ内 Map (永続化なし)。 BTRON ではシステム名前空間と連携
5. **MMASK**: プロセス間通信が noop のため実質未使用
6. **sconv/srconv**: 完全な BTRON 文字コード変換テーブルではなく、 ASCII + 2byte 連結による簡易実装。 JIS 第 2 水準等は変換できない可能性
7. **配列共有 (VARIABLE A:I[10]=B)**: 共有領域として宣言済み (BTRON 仕様準拠) だが、 異種型の共有は実装上の差異あり
8. **キーイベント**: Electron 標準のキーイベントを使用。 BTRON のメタキーロックの完全再現はしない

---

## 6. サンプルコード

### Hello World

```
VERSION 3
PROLOGUE
SCENE
MESG "Hello, World!"
END
```

### マウスクリックで遷移

```
VERSION 3
VARIABLE 状態:I
PROLOGUE
SCENE 開始画面
SET 状態=0
END
ACTION ボタン押下 PRESS 次へ
IF 状態==0
SCENE 中間画面
SET 状態=1
ELSE
SCENE 終了画面
ENDIF
END
ACTION 終了 PRESS 終了ボタン
FINISH
END
```

### REPEAT と配列

```
VERSION 3
VARIABLE 値:I[10]
PROLOGUE
REPEAT 10
SET 値[$CNT]=$CNT*$CNT
ENDREPEAT
MESG "5^2=%d, 9^2=%d", 値[5], 値[9]
END
```

### FOPEN/FREAD

```
VERSION 3
VARIABLE BUF:B[256]
VARIABLE SZ:I
PROLOGUE
FOPEN "/data/sample.txt", "R"
FREAD "/data/sample.txt", 0, 0, 256, BUF, SZ
MESG "読み込んだサイズ: %d", SZ
FCLOSE "/data/sample.txt"
END
```

### SCENE 効果

```
VERSION 3
PROLOGUE
SCENE 鳥, 花 :WIPE_D 10
SLEEP 2000
SCENE 月, 星 :MOSAIC 15
END
```

---

## 7. 関連ファイル / 設計書

- 実装: [plugins/microscript/](../plugins/microscript/)
  - `app.js` — PluginBase 派生のプラグイン本体
  - `ms-lexer.js` — 字句解析
  - `ms-parser.js` — 構文解析 (AST 生成)
  - `ms-runtime.js` — AST 評価器
  - `canvas-stage.js` — Canvas 2D 描画 + イベントハンドリング
  - `figure-tad-reader.js` — 図形 TAD パーサ
  - `script-loader.js` — `<link>` 経由の SCRIPT 実身ロード
- 設計書: [designlog/microscript-spec-summary.md](../designlog/microscript-spec-summary.md) (公式仕様まとめ)
- 設計書: [designlog/microscript-impl-plan.md](../designlog/microscript-impl-plan.md) (実装計画)
