# xmlTAD仕様書

## 1. 概要

### 1.1 xmlTADとは

xmlTADは、BTRONの標準データフォーマットであるTAD (Text And Draw) をXML形式で表現したものです。TADjs Desktopでは、実身データの内容を`{realId}_0.xtad`ファイルとして保存します。

### 1.2 フォーマットルール

**インデント**: タグの入れ子構造でもインデントは入れません（スペース・タブと誤認防止）。ただし、`<document>`要素内のテキストコンテンツの前後にある空白は維持されます。

### 1.3 ファイル構成

実身は以下の3ファイルで構成されます：

| ファイル | 形式 | 用途 |
|----------|------|------|
| `{realId}.json` | JSON | 実身メタデータ（名称、アプリリストなど） |
| `{realId}_0.xtad` | XML | 実身の内容（xmlTADデータ） |
| `{realId}.ico` | ICO | アイコン画像（オプション） |

### 1.4 メタデータJSON（{realId}.json）の構造

実身メタデータJSONは、実身の管理情報を格納します。以下に全フィールドを示します。

**トップレベルフィールド**:

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `name` | string | 実身の表示名称 |
| `relationship` | array | 実身の続柄タグ配列。`[タグ]`で入力→実身用（括弧除去して保存、例: `["会議", "重要"]`）。`タグ`で入力→仮身用（link要素側に保存） |
| `linktype` | boolean | リンク実身フラグ |
| `makeDate` | string | 作成日時（ISO 8601形式） |
| `updateDate` | string | 更新日時（メタデータまたはXTAD変更時に自動更新） |
| `accessDate` | string | アクセス日時 |
| `periodDate` | string\|null | 期限日（未設定時`null`） |
| `refCount` | number | 参照カウント（この実身を指す仮身の数） |
| `recordCount` | number | レコード数（`_0.xtad`, `_1.xtad`...のファイル数） |
| `editable` | boolean | 編集可能フラグ |
| `deletable` | boolean | 削除可能フラグ（デフォルト: `true`）。`false`の場合、屑実身操作での物理削除が禁止される。実身管理プラグインで変更可能 |
| `readable` | boolean | 読み込み可能フラグ |
| `maker` | string | 作成者/最終更新者名 |
| `window` | object | ウィンドウ設定（位置、サイズ、各種フラグ） |
| `applist` | object | 起動可能プラグイン一覧 |

**windowオブジェクト**:

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `pos` | object | ウィンドウ位置（`{x, y}`） |
| `width` / `height` | number | ウィンドウサイズ（ピクセル） |
| `minWidth` / `minHeight` | number | リサイズ時の最小サイズ |
| `resizable` | boolean | リサイズ可能フラグ |
| `scrollable` | boolean | スクロールバー表示フラグ |
| `maximize` | boolean | 最大化状態フラグ |
| `maximizable` / `minimizable` / `closable` | boolean | ウィンドウボタンの表示制御 |
| `alwaysOnTop` | boolean | 常に最前面フラグ |
| `wordWrap` | boolean | テキスト折り返し設定 |
| `skipTaskbar` | boolean | タスクバー非表示フラグ |
| `frame` | boolean | ウィンドウフレーム表示 |
| `transparent` | boolean | 背景透明化フラグ |
| `backgroundColor` | string | 背景色（16進カラーコード） |
| `panel` | boolean | 道具パネル表示フラグ（オプション） |
| `panelpos` | object | 道具パネル位置（`{x, y}`、オプション） |
| `scrollPos` | object | スクロール位置（`{x, y}`、ランタイム保存用） |

**applistオブジェクト**:

キーがプラグインID、値が `{name: string, defaultOpen: boolean}` の構造です。`defaultOpen: true`のプラグインが仮身ダブルクリック時にデフォルトで起動します。

> 各フィールドのデフォルト値や詳細な使用方法は、[PLUGIN_DEVELOPMENT_GUIDE.md](PLUGIN_DEVELOPMENT_GUIDE.md) の11.2章を参照してください。

---

## 2. xmlTAD基本構造

### 2.1 ルート要素

```xml
<tad version="1.0" encoding="UTF-8" filename="実身名">
    <!-- document または figure -->
</tad>
```

| 属性 | 必須 | 説明 |
|------|------|------|
| version | ○ | バージョン（"1.0" または "02.00"） |
| encoding | ○ | 文字エンコーディング（"UTF-8"） |
| filename | △ | 実身名（省略可能） |

### 2.2 文書タイプ

xmlTADには3種類の文書タイプがあります：

| タイプ | ルート子要素 | 用途 | 対応プラグイン |
|--------|------------|------|--------------|
| 文章TAD | `<document>` | テキスト文書 | basic-text-editor, basic-calc-editor |
| 図形TAD | `<figure>` | 図形・画像 | basic-figure-editor, virtual-object-list |
| 実時間TAD | `<realtime>` | 音楽・アニメーション・マルチメディア | （未実装） |

> **注**: 実時間TADの詳細仕様は [realtimeDataTAD.md](./realtimeDataTAD.md) を参照してください。

---

## 3. 文章TAD（document）

### 3.1 基本構造

```xml
<tad version="1.0" encoding="UTF-8">
<document>
<paper type="doc" length="1403" width="992" ... />
<docmargin top="94" bottom="94" left="94" right="47" />
<p>段落内容</p>
<p>段落内容</p>
</document>
</tad>
```

### 3.2 用紙設定要素

#### `<paper>` - 用紙サイズ

```xml
<paper type="doc" length="1403" width="992" binding="0" imposition="0" top="94" bottom="94" left="94" right="47" />
```

| 属性 | 説明 | 単位 |
|------|------|------|
| type | 文書タイプ（"doc"） | - |
| length | 用紙の長さ | ポイント |
| width | 用紙の幅 | ポイント |
| binding | 綴じ方向 | - |
| imposition | 面付け | - |
| top/bottom/left/right | マージン | ポイント |

#### `<docmargin>` - 文書マージン

```xml
<docmargin top="94" bottom="94" left="94" right="47" />
```

### 3.3 段落要素

#### `<p>` - 段落

```xml
<p>
<font size="14"/>
テキスト内容
<br/>
改行後のテキスト
</p>
```

### 3.4 テキスト書式要素

#### `<font>` - フォント設定

**サイズ・色（ペアタグ - 推奨形式）**:
```xml
<font size="21">大きいテキスト</font>
<font color="#51aefb">青いテキスト</font>
<font color="#ff0000"><font size="28">赤くて大きいテキスト</font></font>
```

**フェイス・その他（自己閉じタグ）**:
```xml
<font face="sans-serif"/>
<font style="normal" weight="400" stretch="normal" stretchscale="1.0"/>
<font direction="horizontal" kerning="0" pattern="0" space="0"/>
```

**サイズ・色（自己閉じタグ - 後方互換）**:
```xml
<font size="14"/>テキスト
<font color="#51aefb"/>青いテキスト<font color=""/>
```

> **注意**: サイズ・色の自己閉じタグ形式は後方互換性のために読み込みをサポートしますが、
> 保存時はペアタグ形式で出力されます。ペアタグ形式はスコープが明確で、
> HTMLとの相互変換時に冗長なタグが生成されにくいという利点があります。

| 属性 | 説明 | 値の例 | タグ形式 |
|------|------|--------|---------|
| size | フォントサイズ | "14", "28" | ペアタグ |
| face | フォントファミリー | "sans-serif", "monospace" | 自己閉じ |
| color | 文字色 | "#000000", "#51aefb" | ペアタグ |
| style | フォントスタイル | "normal", "italic" | 自己閉じ |
| weight | フォントウェイト | "400", "700" | 自己閉じ |
| stretch | フォント幅 | "normal", "condensed" | 自己閉じ |
| stretchscale | 幅スケール | "1.0" | 自己閉じ |
| direction | 文字送り方向 | "0" (横), "1" (縦) | 自己閉じ |
| kerning | カーニング | "0", "1" | 自己閉じ |
| pattern | スペースパターン | "0", "1" | 自己閉じ |
| space | 文字間隔 | "0", "10" | 自己閉じ |

#### `<text>` - テキスト属性（文章TAD内）

```xml
<text line-height="24"/>
<text align="center"/>
<text direction="0"/>
```

| 属性 | 説明 | 値の例 |
|------|------|--------|
| line-height | 行間ピッチ | "24" |
| align | 揃え | "left", "center", "right", "justify", "justify-all" |
| direction | テキスト方向 | "0" (横書き), "1" (縦書き) |

#### 文字装飾要素

**基本装飾（開始/終了タグ）**:

| 要素 | 説明 | エイリアス |
|------|------|-----------|
| `<bold>` | 太字 | `<strong>` |
| `<italic>` | 斜体 | `<i>` |
| `<underline>` | 下線 | - |
| `<overline>` | 上線 | - |
| `<strikethrough>` | 取り消し線 | `<strike>` |
| `<box>` | 囲み | - |
| `<invert>` | 反転 | - |
| `<mesh>` | 網掛け | - |
| `<background>` | 背景色 | - |
| `<noprint>` | 印刷しない | - |

**表計算での使用例**:

```xml
<calcPos cell="A1"/><bold>セル内容</bold><tab/>
<calcPos cell="B1"/><italic><underline>装飾付きテキスト</underline></italic><tab/>
```

#### `<bagchar>` - 袋文字

```xml
<bagchar>特殊文字</bagchar>
```

TRON文字コードの袋文字（外字・特殊文字）を含む場合に使用。

#### `<br/>` - 改行

```xml
テキスト<br/>
改行後のテキスト
```

#### `<tab/>` - タブ

```xml
テキスト<tab/>タブ後のテキスト
```

#### `<indent/>` - 字下げ

```xml
<indent/>字下げされたテキスト
```

### 3.5 特殊テキスト要素

#### `<ruby>` - ルビ（振り仮名）

```xml
<ruby position="top" text="ふりがな">漢字</ruby>
```

| 属性 | 説明 | 値の例 |
|------|------|--------|
| position | ルビ位置 | "top", "bottom" |
| text | ルビテキスト | "ふりがな" |

#### `<attend>` - 添え字（上付き/下付き）

```xml
<attend type="0" position="0" unit="0" targetPosition="0" baseline="0">下付き文字</attend>
```

| 属性 | 説明 | 値 |
|------|------|-----|
| type | 種類 | 0: 下付き, 1: 上付き |
| position | 位置 | 0: 前置, 1: 後置 |
| unit | 単位指定 | 0: 文字列単位, 1: 文字単位 |
| targetPosition | 対象位置 | 0: 右, 1: 左 |
| baseline | ベースライン位置 | 0-4 |

#### `<fixedSpace>` - 固定幅スペース

```xml
<fixedSpace width="0010"/>
```

| 属性 | 説明 |
|------|------|
| width | 幅（16進数） |

#### `<widthspace>` - 幅指定スペース

```xml
<widthspace scale="100"/>
```

| 属性 | 説明 |
|------|------|
| scale | スケール値 |

#### `<tcode/>` - TRONコード面切替

```xml
<tcode mask="FF"/>
```

TRONコードの面切替（文字セット切替）を示すタグ。`mask`属性で切替対象の面を指定する。

### 3.6 文書制御要素

#### `<pagebreak>` - 改ページ

```xml
<pagebreak cond="0" remain="0" />
```

| 属性 | 説明 |
|------|------|
| cond | 改ページ条件 0,1,2 |
| remain | 残り行数 |

#### `<docoverlay>` - 文書オーバーレイ

```xml
<docoverlay data="768, 65440, 2, ..." />
<docoverlay active="1, 2, 3" />
```

| 属性 | 説明 |
|------|------|
| data | オーバーレイデータ（カンマ区切りの数値リスト） |
| active | アクティブなオーバーレイ番号リスト |

**注意**: `<docoverlay="..."/>`のような属性名のない形式は不正です。必ず`data`または`active`属性を使用してください。

#### `<docmemo>` - 文書メモ

```xml
<docmemo text="メモテキスト" />
```

### 3.7 表計算固有要素

#### `<calcPos>` - セル位置マーカー

```xml
<p>
<calcPos cell="A1"/>	<calcPos cell="B1"/>	<calcPos cell="C1"/>
</p>
```

| 属性 | 説明 |
|------|------|
| cell | セル位置（"A1", "B2"など） |

#### `<calcCell>` - セル属性

```xml
<calcCell format="number" decimals="2" align="right"/>
```

| 属性 | 説明 |
|------|------|
| format | セル書式 |
| decimals | 小数点以下桁数 |
| align | 揃え |

---

## 4. 図形TAD（figure）

### 4.1 基本構造

```xml
<tad version="1.0" encoding="UTF-8">
<figure>
    <figView top="0" left="0" right="800" bottom="600"/>
    <figDraw top="0" left="0" right="800" bottom="600"/>
    <figScale hunit="-72" vunit="-72"/>
    <!-- 図形要素、仮身、画像など -->
</figure>
</tad>
```

### 4.2 図形領域設定要素

#### `<figView>` - 表示領域

```xml
<figView top="0" left="0" right="800" bottom="600"/>
```

| 属性 | 説明 |
|------|------|
| top/left/right/bottom | 表示領域の境界座標 |

#### `<figDraw>` - 描画領域

```xml
<figDraw top="0" left="0" right="800" bottom="600"/>
```

#### `<figScale>` - スケール設定

```xml
<figScale hunit="-72" vunit="-72"/>
```

| 属性 | 説明 |
|------|------|
| hunit | 水平方向のスケール単位（UNITS型） |
| vunit | 垂直方向のスケール単位（UNITS型） |

**UNITS型の仕様（16bit符号付き整数）**:

| 値の範囲 | 意味 | 例 |
|---------|------|-----|
| 正の値 | 1cmあたりのドット数 | 4 = 4dots/cm |
| 負の値 | 1inchあたりのドット数（の負数） | -72 = 72DPI, -120 = 120DPI |
| 0 | 外側の座標系を継承 | - |

**典型的な値**:
- `-72`: 72DPI（1ポイント = 1ドット）
- `-120`: 120DPI（高解像度）
- `-300`: 300DPI（印刷品質）

### 4.3 図形要素

#### 共通属性

全ての図形要素で使用される共通属性：

| 属性 | 説明 | 値の例 |
|------|------|--------|
| lineType | 線種（0:実線, 1:破線, 2:点線, 3:一点鎖線, 4:二点鎖線, 5:長破線） | "0", "1", "2" |
| lineWidth | 線幅（0:線なし, 1以上:ピクセル数） | "0", "1", "2" |
| l_pat | 線パターン（互換用、lineType推奨） | "0" |
| f_pat | 塗りつぶしパターン | "0" |
| angle | 傾斜角度 | "0" |
| zIndex | 重なり順序 | "1", "100" |

**注意**: 旧形式の`l_atr`属性は非推奨です。読み込み時は後方互換性のためサポートしますが、保存時は`lineType`と`lineWidth`を使用します。

**lineType（線種）の詳細**:

線の描画パターンを指定します。Canvas APIの`setLineDash()`に渡すパターン配列として定義されています。

| 値 | 名称 | パターン配列 | 表示イメージ |
|----|------|-------------|-------------|
| 0 | 実線（Solid） | [] | ────────── |
| 1 | 破線（Dashed） | [6, 3] | ── ── ── ── |
| 2 | 点線（Dotted） | [2, 2] | ・・・・・・・・ |
| 3 | 一点鎖線（Dash-Dot） | [8, 3, 2, 3] | ──・──・──・ |
| 4 | 二点鎖線（Dash-Dot-Dot） | [8, 3, 2, 3, 2, 3] | ──・・──・・ |
| 5 | 長破線（Long Dash） | [12, 4] | ─── ─── ─── |

パターン配列の数値は[線の長さ, 間隔, 線の長さ, 間隔, ...]を表します。

**lineWidth（線幅）の詳細**:

線の太さをピクセル単位で指定します。

| 値 | 意味 |
|----|------|
| 0 | 線なし（枠線を描画しない） |
| 1 | 1ピクセル幅 |
| 2以上 | 指定したピクセル幅 |

**旧形式（l_atr）との関係**:

旧TAD形式では`l_atr`という16ビット値で線属性を表現していました:
- 上位8ビット: lineType（線種）
- 下位8ビット: lineWidth（線幅）

```
l_atr = (lineType << 8) | lineWidth

例: l_atr="257" → lineType=1, lineWidth=1 （1ピクセル幅の破線）
例: l_atr="1"   → lineType=0, lineWidth=1 （1ピクセル幅の実線）
例: l_atr="0"   → lineType=0, lineWidth=0 （線なし）
```

読み込み時は後方互換性のため`l_atr`もサポートしますが、保存時は`lineType`と`lineWidth`を個別に出力します。

#### `<rect>` - 矩形

```xml
<!-- 通常矩形 -->
<rect round="0" lineType="0" lineWidth="1" l_pat="0" f_pat="0" angle="0"
      left="10" top="10" right="110" bottom="60"
      strokeColor="#000000" fillColor="#ffffff" zIndex="1"/>

<!-- 角丸矩形 -->
<rect round="1" lineType="0" lineWidth="1" l_pat="0" f_pat="0" angle="0"
      figRH="10" figRV="10"
      left="10" top="10" right="110" bottom="60"
      strokeColor="#000000" fillColor="#ffffff" zIndex="2"/>
```

| 属性 | 説明 |
|------|------|
| round | 角丸フラグ（0:通常, 1:角丸） |
| lineType | 線種（0:実線, 1:破線, ...） |
| lineWidth | 線幅（ピクセル） |
| l_pat | 線パターン（0:実線, 1:破線, ...） |
| f_pat | 塗りパターン（0:塗りなし, 1:塗りあり） |
| angle | 回転角度（楕円傾斜用） |
| rotation | 図形回転角度（度数法、Canvas回転ラッパーによる描画回転） |
| left/top/right/bottom | 境界座標 |
| figRH, figRV | 角丸の水平/垂直半径（round=1時） |
| strokeColor | 線色 |
| fillColor | 塗りつぶし色 |
| zIndex | 重なり順序 |

#### `<ellipse>` - 楕円

```xml
<ellipse lineType="0" lineWidth="1" l_pat="0" f_pat="1" angle="0"
         cx="100" cy="100" rx="80" ry="50"
         strokeColor="#000000" fillColor="#ffffff" zIndex="1"/>
```

| 属性 | 説明 |
| ---- | ---- |
| lineType | 線種（共通属性参照） |
| lineWidth | 線幅（共通属性参照） |
| cx, cy | 中心座標 |
| rx, ry | X方向/Y方向の半径 |
| rotation | 図形回転角度（度数法、Canvas回転ラッパーによる描画回転） |
| strokeColor | 線色 |
| fillColor | 塗りつぶし色 |

**注意**: 円を描画する場合は`rx`と`ry`を同じ値に設定します。

#### `<arc>` - 円弧

```xml
<arc lineType="0" lineWidth="1" l_pat="0" f_pat="0" angle="0"
     cx="100" cy="100" rx="50" ry="50"
     startX="150" startY="100" endX="100" endY="50"
     startAngle="0" endAngle="90"
     start_arrow="0" end_arrow="1" arrow_type="simple" zIndex="1"/>
```

| 属性 | 説明 |
|------|------|
| lineType | 線種（共通属性参照） |
| lineWidth | 線幅（共通属性参照） |
| cx, cy | 中心座標 |
| rx, ry | X方向/Y方向の半径 |
| startX, startY | 始点座標 |
| endX, endY | 終点座標 |
| startAngle, endAngle | 開始/終了角度（度） |
| start_arrow, end_arrow | 始点/終点の矢印 |

#### `<chord>` - 弦（円弧と直線の閉領域）

```xml
<chord lineType="0" lineWidth="1" l_pat="0" f_pat="0" angle="0"
       cx="100" cy="100" rx="50" ry="50"
       startX="150" startY="100" endX="100" endY="50"
       startAngle="0" endAngle="90"
       start_arrow="0" end_arrow="0" arrow_type="simple" zIndex="1"/>
```

| 属性 | 説明 |
|------|------|
| lineType | 線種（共通属性参照） |
| lineWidth | 線幅（共通属性参照） |
| cx, cy | 中心座標 |
| rx, ry | X方向/Y方向の半径 |
| startX, startY | 始点座標 |
| endX, endY | 終点座標 |
| startAngle, endAngle | 開始/終了角度（度） |
| f_pat | 塗りパターン（0:塗りなし, 1:塗りあり） |
| fillColor | 塗りつぶし色 |

#### `<elliptical_arc>` - 楕円弧

```xml
<elliptical_arc lineType="0" lineWidth="1" l_pat="0" angle="0"
                cx="100" cy="100" rx="80" ry="50"
                startX="180" startY="100" endX="100" endY="50"
                startAngle="0" endAngle="1.57"
                start_arrow="0" end_arrow="1" arrow_type="simple" zIndex="1"/>
```

| 属性 | 説明 |
|------|------|
| lineType | 線種（共通属性参照） |
| lineWidth | 線幅（共通属性参照） |
| cx, cy | 中心座標 |
| rx, ry | X方向/Y方向の半径 |
| startX, startY | 始点座標 |
| endX, endY | 終点座標 |
| startAngle, endAngle | 開始/終了角度（ラジアン） |
| start_arrow, end_arrow | 始点/終点の矢印 |

#### `<line>` - 線（直線・折れ線）

```xml
<line lineType="0" lineWidth="1" l_pat="0" f_pat="0"
      start_arrow="0" end_arrow="1" arrow_type="simple"
      points="103,96 358,248" zIndex="3"/>

<!-- 接続線（図形間接続用） -->
<line lineType="0" lineWidth="1" l_pat="0" f_pat="0" strokeColor="#000000"
      start_arrow="0" end_arrow="1" arrow_type="filled"
      conn_pat="3" start_conn="0,4" end_conn="1,0"
      lineConnectionType="curve" points="103,96 358,248" zIndex="3"/>
```

| 属性 | 説明 |
|------|------|
| lineType | 線種（共通属性参照） |
| lineWidth | 線幅（共通属性参照） |
| points | 座標点のリスト（"x1,y1 x2,y2 ..."） |
| start_arrow, end_arrow | 始点/終点の矢印（0:なし, 1:あり） |
| arrow_type | 矢印タイプ（"simple", "filled"） |
| conn_pat | 接続パターン |
| start_conn, end_conn | 接続情報 |
| lineConnectionType | 線の種類（"straight", "curve"） |
| strokeColor | 線の色 |

#### `<polygon>` - 多角形

```xml
<polygon lineType="0" lineWidth="1" l_pat="0" f_pat="0"
         points="0,0 100,0 100,100 0,100" zIndex="1"/>
```

| 属性 | 説明 |
|------|------|
| lineType | 線種（共通属性参照） |
| lineWidth | 線幅（共通属性参照） |
| points | 頂点座標のリスト |
| f_pat | 塗りパターン（0:塗りなし, 1:塗りあり） |
| rotation | 図形回転角度（度数法） |
| fillColor | 塗りつぶし色 |
| strokeColor | 線色 |

#### `<polyline>` - 折れ線

```xml
<polyline lineType="0" lineWidth="1" l_pat="0" round="0"
          start_arrow="0" end_arrow="0"
          strokeColor="#000000"
          points="0,0 50,50 100,0" zIndex="1"/>
```

| 属性 | 説明 |
| ---- | ---- |
| lineType | 線種（共通属性参照） |
| lineWidth | 線幅（共通属性参照） |
| round | 角の丸め |
| rotation | 図形回転角度（度数法） |
| strokeColor | 線色 |
| points | 座標点のリスト |
| start_arrow, end_arrow | 始点/終点の矢印 |

#### `<curve>` - 曲線（スプライン/ベジェ）

```xml
<curve lineType="0" lineWidth="1" l_pat="0" f_pat="0"
       type="bezier" closed="0"
       start_arrow="0" end_arrow="0" arrow_type="simple"
       points="0,0 50,100 100,100 150,0" zIndex="1"/>
```

| 属性 | 説明 |
|------|------|
| lineType | 線種（共通属性参照） |
| lineWidth | 線幅（共通属性参照） |
| type | 曲線タイプ（"bezier", "spline"） |
| closed | 閉曲線フラグ（"0":開, "1":閉） |
| points | 制御点座標のリスト |
| rotation | 図形回転角度（度数法） |
| start_arrow, end_arrow | 始点/終点の矢印 |
| strokeColor | 線色 |

### 4.4 テキストボックス（図形内document）

図形TAD内にテキストを配置する場合、`<document>`要素をネストします：

```xml
<figure>
<document>
<docView viewleft="175" viewtop="65" viewright="471" viewbottom="126"/>
<docDraw drawleft="175" drawtop="65" drawright="471" drawbottom="126"/>
<docScale hunit="-72" vunit="-72"/>
<text lang="0" bpat="0" zIndex="4"/>
<font size="16"/>
<font face="sans-serif"/>
<font color="#000000"/>
<text align="center"/>
テキスト内容<br/>
2行目
</document>
</figure>
```

#### `<docView>` - 文書表示領域

```xml
<docView viewleft="175" viewtop="65" viewright="471" viewbottom="126"/>
```

| 属性 | 説明 |
|------|------|
| viewleft/viewtop/viewright/viewbottom | 表示領域の境界座標 |

#### `<docDraw>` - 文書描画領域

```xml
<docDraw drawleft="175" drawtop="65" drawright="471" drawbottom="126"/>
```

| 属性 | 説明 |
|------|------|
| drawleft/drawtop/drawright/drawbottom | 描画領域の境界座標 |

#### `<docScale>` - 文書スケール設定

```xml
<docScale hunit="-72" vunit="-72"/>
```

| 属性 | 説明 |
|------|------|
| hunit | 水平方向のスケール単位（UNITS型） |
| vunit | 垂直方向のスケール単位（UNITS型） |

**UNITS型の仕様（16bit符号付き整数）**:

| 値の範囲 | 意味 | 例 |
|---------|------|-----|
| 正の値 | 1cmあたりのドット数 | 4 = 4dots/cm |
| 負の値 | 1inchあたりのドット数（の負数） | -72 = 72DPI, -120 = 120DPI |
| 0 | 外側の座標系を継承 | - |

#### `<text>` - テキスト領域（図形内）

`<document>`要素内で使用し、`<docView>`/`<docDraw>`/`<docScale>`と併用します。

```xml
<document>
<docView viewleft="100" viewtop="50" viewright="300" viewbottom="80"/>
<docDraw drawleft="100" drawtop="50" drawright="300" drawbottom="80"/>
<docScale hunit="-72" vunit="-72"/>
<text lang="0" bpat="0" zIndex="4"/>
<font size="16" color="#000000"/>
テキスト内容
</document>
```

| 属性   | 説明                   |
|--------|------------------------|
| lang   | 言語コード（0=日本語） |
| bpat   | 背景パターン（0=透明） |
| zIndex | 重なり順序             |

**注意**: 位置・サイズは`<docView>`で指定します。`<text>`の`x`, `y`, `w`, `h`属性は使用しません。

### 4.5 画像要素

#### `<image>` - 画像

**標準形式**:

```xml
<image lineType="0" lineWidth="1" l_pat="0" f_pat="0" angle="0" rotation="0" flipH="false" flipV="false" left="37" top="187" right="175" bottom="325" href="019aaa4e-de25-72ad-8518-ab392b7ea301_0_0.png" zIndex="5"/>
```

**インライン図形セグメント**（文章セグメント内に埋め込まれた図形セグメント）:

文章セグメント（`<document>`）内に`<figure>`要素を直接インラインで配置できる。表示時はbasic-figure-editorが埋め込みモードで描画を担当する。

```xml
<document>
<p>
テキスト内容...
<figure>
<figView top="0" left="0" right="400" bottom="300"/>
<figDraw top="0" left="0" right="400" bottom="300"/>
<figScale hunit="-72" vunit="-72"/>
<group left="0" top="0" right="400" bottom="300">
<rect .../>
<polyline ... points="10,50 60,30 110,70 160,20"/>
</group>
</figure>
続きのテキスト...
</p>
</document>
```

`<figure>`要素の構造は「4. 図形TAD（figure）」と同一。文章セグメント内に複数の`<figure>`を含むことが可能。
| left/top/right/bottom | 画像の境界座標 |
| lineType | 線種（0:実線, 1:破線, ...） |
| lineWidth | 線幅（0:なし, 1以上:ピクセル数） |
| l_pat | 線パターン |
| f_pat | 塗りつぶしパターン |
| angle | 傾斜角度 |
| rotation | 回転角度 |
| flipH/flipV | 水平/垂直反転 |

### 4.6 グループ要素

#### `<group>` - 図形グループ

```xml
<group id="group1">
<rect ... />
<ellipse ... />
<line ... />
</group>
```

| 属性 | 説明 |
|------|------|
| id | グループID（省略可能） |

複数の図形要素をグループ化し、一括操作を可能にします。

### 4.7 変換要素

#### `<transform>` - 座標変換

```xml
<transform dh="10" dv="20" hangle="45" vangle="30" />
```

| 属性 | 説明 |
|------|------|
| dh | 水平移動量 |
| dv | 垂直移動量 |
| hangle | 回転角度（度） |
| vangle | 傾斜角度（度） |

図形要素に適用される座標変換を定義します。

### 4.8 図形制御要素

#### `<figoverlay>` - 図形オーバーレイ

```xml
<figoverlay number="1" even="true" odd="true" overlayData="1,2,3" />
<figoverlay active="1, 2, 3" />
```

| 属性 | 説明 |
|------|------|
| number | オーバーレイ番号 |
| even | 偶数ページに適用 |
| odd | 奇数ページに適用 |
| overlayData | オーバーレイデータ |
| active | アクティブなオーバーレイリスト |

#### `<figmemo>` - 図形メモ

```xml
<figmemo text="メモテキスト" />
```

### 4.9 特殊要素

#### `<binary>` - バイナリデータ

TADバイナリ形式をBase64エンコードして埋め込む場合に使用：

```xml
<tad version="0121" encoding="UTF-8">
<binary type="0x1234" subtype="0x5678" size="1024" encoding="base64">
Base64エンコードされたデータ...
</binary>
</tad>
```

| 属性 | 説明 |
|------|------|
| type | データタイプ（16進数） |
| subtype | サブタイプ（16進数） |
| size | データサイズ |
| encoding | エンコーディング（"base64"） |

---

## 5. 仮身（link）要素

### 5.1 基本構造

仮身は`<link>`要素で表現され、文章TAD・図形TADの両方で使用されます。

```xml
<link id="019a6c9b-e67e-7a35-a461-0d199550e4cf_0.xtad" name="実身/仮身" tbcol="#e1f2f9" frcol="#000000" chcol="#000000" bgcol="#ffffff" width="150" heightpx="30" dlen="0" chsz="14" framedisp="true" namedisp="true" pictdisp="true" roledisp="false" typedisp="false" updatedisp="false" autoopen="false" applist="{}" relationship="">表示名</link>
```

> **`relationship`属性**: 仮身固有の続柄を設定する属性です（詳細は5.2「仮身固有の続柄属性」参照）。続柄設定ダイアログで`タグ`形式（括弧なし）で入力した値がスペース区切りで保存されます。`[タグ]`形式で入力した値は実身JSON側に保存されます。

### 5.2 仮身属性一覧

#### 識別属性

| 属性 | 必須 | 説明 |
|------|------|------|
| id | ○ | 参照先実身のID（{realId}_0.xtad形式またはrealId形式） |
| name | △ | 仮身名（省略時はテキストノードが使用される） |

#### 位置・サイズ属性（図形TAD用）

| 属性 | 説明 | 単位 |
|------|------|------|
| vobjleft | 左端X座標 | ピクセル |
| vobjtop | 上端Y座標 | ピクセル |
| vobjright | 右端X座標 | ピクセル |
| vobjbottom | 下端Y座標 | ピクセル |
| height | 高さ | ピクセル |

#### 位置・サイズ属性（文章TAD用）

| 属性 | 説明 | 単位 |
|------|------|------|
| width | 幅 | ピクセル |
| heightpx | 高さ | ピクセル |

#### 表示色属性

| 属性 | 説明 | 値の例 |
|------|------|--------|
| tbcol | 背景色（タブ色） | "#e1f2f9" |
| frcol | 枠色 | "#000000" |
| chcol | 文字色 | "#000000" |
| bgcol | 背景色 | "#ffffff" |

#### 文字属性

| 属性 | 説明 |
|------|------|
| chsz | 文字サイズ |
| dlen | データ長（参考値） |

#### 表示フラグ属性

| 属性 | 説明 | デフォルト |
|------|------|-----------|
| framedisp | 枠を表示 | true |
| namedisp | 名前を表示 | true |
| pictdisp | アイコンを表示 | true |
| roledisp | 役割を表示 | false |
| typedisp | 種別を表示 | false |
| updatedisp | 更新状態を表示 | false |

#### 動作属性

| 属性 | 説明 | デフォルト |
|------|------|-----------|
| autoopen | 自動で開く | false |
| fixed | 位置固定 | false |
| applist | 起動可能アプリリスト | "{}" |

#### 仮身固有の続柄属性

| 属性 | 説明 | デフォルト |
|------|------|-----------|
| relationship | 仮身固有の続柄（スペース区切りで複数可） | "" |

**続柄の二重管理について**:
- **実身JSON（`{realId}.json`）の`relationship`配列**: 実身に紐づく続柄。続柄設定ダイアログで`[タグ]`形式で入力すると実身用として括弧を除去しタグ名のみ保存される（例: 入力`[会議]` → 保存`"会議"`）。
- **link要素の`relationship`属性**: 仮身（link）に固有の続柄。続柄設定ダイアログで`タグ`形式（`[]`なし）で入力された値が保存される。

**表示ルール**:
- `roledisp="true"`の場合、両方の続柄を連結表示
- 実身JSONの続柄は`[タグ]`形式で表示
- link要素の続柄はそのまま表示
- 例: JSON `["会議"]` + link `"議事録 資料"` → 表示 `[会議] 議事録 資料`

**検索対応**:
- 続柄検索時、実身JSONとlink要素のrelationship属性の両方が検索対象

#### レイヤー属性（図形TAD用）

| 属性 | 説明 |
|------|------|
| zIndex | 重なり順序 |

---

## 6. プラグイン別xmlTAD使用状況

### 6.1 basic-text-editor（基本文章編集）

**文書タイプ**: document

**使用要素**:
- `<document>`, `<p>`, `<font>`, `<bold>`, `<italic>`, `<underline>`, `<strike>`
- `<br/>`, `<link>`, `<paper>`, `<docmargin>`

**XML処理**:
- パース: `DOMParser` (editor.js:2589)
- シリアライズ: `XMLSerializer` (editor.js:9324)
- 仮身更新: `updateVirtualObjectInXml()` メソッド

### 6.2 basic-figure-editor（基本図形編集）

**文書タイプ**: figure

**使用要素**:
- `<figure>`, `<figView>`, `<figDraw>`, `<figScale>`
- `<rect>`, `<ellipse>`, `<line>`, `<polygon>`, `<polyline>`
- `<image>`, `<document>`（テキストボックス）, `<link>`

**注意**: 円は`<ellipse>`でrx=ryとして表現します。独立した`<circle>`要素は使用しません。

**XML処理**:
- パース: `DOMParser` (editor.js:4671)

### 6.3 basic-calc-editor（基本表計算）

**文書タイプ**: document

**使用要素**:
- `<document>`, `<p>`, `<calcPos>`, `<paper>`, `<docmargin>`

**XML処理**:
- パース: `DOMParser` (editor.js:5567, 5583)

### 6.4 virtual-object-list（仮身一覧）

**文書タイプ**: figure

**使用要素**:
- `<figure>`, `<link>`

**XML処理**:
- パース: `DOMParser` (app.js:3232, 3319, 3363, 3460, 4615, 6253)
- シリアライズ: `XMLSerializer` (app.js:3294, 3339, 3433, 3507, 6298)
- 仮身追加: `addVirtualObjectToXml()`
- 仮身削除: `removeVirtualObjectFromXml()`
- 仮身更新: `updateVirtualObjectInXml()`
- 仮身並べ替え: `reorderVirtualObjectsInXml()`

### 6.5 base-file-manager（原紙箱）

**文書タイプ**: figure

**使用要素**:
- `<figure>`, `<link>`

**XML処理**:
- パース: `DOMParser` (app.js:298)

### 6.6 tadjs-view（TAD表示）

**文書タイプ**: document/figure（両対応）

**XML処理**:
- TADバイナリからxmlTADへの変換: `tad.js`

---

## 7. PluginBase共通化検討

### 7.1 現状の問題点

各プラグインで以下の処理が重複実装されています：

1. **XMLパース処理**
   - `new DOMParser()` + `parseFromString()` の呼び出し
   - パースエラーチェック

2. **XMLシリアライズ処理**
   - `new XMLSerializer()` + `serializeToString()` の呼び出し

3. **link要素の操作**
   - `<link>`要素の検索
   - 属性の読み取り・設定
   - 要素の追加・削除

### 7.2 共通化候補メソッド

#### XMLパース/シリアライズ

> **注意**: 以下の`parseXmlTad`、`serializeXmlTad`はPluginBaseの共通メソッドとしては未実装です。各プラグインがDOMParser/XMLSerializerを直接使用しています。参考実装として記載します。

```javascript
// 参考実装（PluginBase未実装 - 各プラグインが直接使用）

/**
 * xmlTADをパースしてDOMを返す
 * @param {string} xmlData - xmlTAD文字列
 * @returns {{success: boolean, doc?: Document, error?: string}}
 */
parseXmlTad(xmlData) {
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlData, 'text/xml');

        // パースエラーチェック
        const parseError = doc.querySelector('parsererror');
        if (parseError) {
            return { success: false, error: parseError.textContent };
        }

        return { success: true, doc };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * DOMをxmlTAD文字列に変換
 * @param {Document} doc - XMLドキュメント
 * @returns {string}
 */
serializeXmlTad(doc) {
    const serializer = new XMLSerializer();
    return serializer.serializeToString(doc);
}
```

#### link要素パース（PluginBase実装済み）

以下は`js/plugin-base.js`に実装されている実コードです。

```javascript
// js/plugin-base.js より（実装済み）
class PluginBase {
    /**
     * link要素から仮身オブジェクトを生成
     * @param {Element} linkElement - link要素
     * @returns {Object|null} 仮身オブジェクト
     */
    parseLinkElement(linkElement) {
        if (!linkElement) return null;

        try {
            const vobjleft = parseInt(linkElement.getAttribute('vobjleft')) || 0;
            const vobjtop = parseInt(linkElement.getAttribute('vobjtop')) || 0;
            const vobjright = parseInt(linkElement.getAttribute('vobjright')) || 0;
            const vobjbottom = parseInt(linkElement.getAttribute('vobjbottom')) || 0;

            return {
                // 識別属性
                link_id: linkElement.getAttribute('id') || '',
                link_name: linkElement.textContent?.trim() || '',
                // 座標属性
                vobjleft: vobjleft,
                vobjtop: vobjtop,
                vobjright: vobjright,
                vobjbottom: vobjbottom,
                width: vobjright - vobjleft,
                heightPx: vobjbottom - vobjtop,
                height: parseInt(linkElement.getAttribute('height')) || 0,
                // スタイル属性
                chsz: parseInt(linkElement.getAttribute('chsz')) || DEFAULT_FONT_SIZE,
                frcol: linkElement.getAttribute('frcol') || DEFAULT_FRCOL,
                chcol: linkElement.getAttribute('chcol') || DEFAULT_CHCOL,
                tbcol: linkElement.getAttribute('tbcol') || DEFAULT_TBCOL,
                bgcol: linkElement.getAttribute('bgcol') || DEFAULT_BGCOL,
                dlen: parseInt(linkElement.getAttribute('dlen')) || 0,
                // 表示属性（文字列として保持）
                pictdisp: linkElement.getAttribute('pictdisp') || 'true',
                namedisp: linkElement.getAttribute('namedisp') || 'true',
                roledisp: linkElement.getAttribute('roledisp') || 'false',
                typedisp: linkElement.getAttribute('typedisp') || 'false',
                updatedisp: linkElement.getAttribute('updatedisp') || 'false',
                framedisp: linkElement.getAttribute('framedisp') || 'true',
                autoopen: linkElement.getAttribute('autoopen') || 'false',
                // 仮身固有の続柄（link要素のrelationship属性）
                linkRelationship: this.parseLinkRelationship(linkElement)
            };
        } catch (error) {
            return null;
        }
    }

    /**
     * link要素のrelationship属性をパース
     * @param {Element} linkElement - link要素
     * @returns {string[]} 続柄タグ配列
     */
    parseLinkRelationship(linkElement) {
        if (!linkElement) return [];
        const relationshipAttr = linkElement.getAttribute('relationship');
        if (!relationshipAttr || relationshipAttr.trim() === '') {
            return [];
        }
        return relationshipAttr.split(/\s+/).filter(s => s.trim() !== '');
    }
}
```

> **実コードとの差異に注意**:
> - プロパティ名は`name`ではなく`link_name`（textContentから取得）
> - 表示フラグ（`framedisp`等）はbooleanではなく文字列`'true'`/`'false'`で保持
> - デフォルト値はハードコードではなく`js/util.js`のDEFAULT_*定数を使用
> - `width`, `heightPx`は座標から自動計算
> - `dlen`, `roledisp`, `typedisp`, `updatedisp`が追加で含まれる

#### link要素書き込み（参考実装）

> **注意**: 以下の`getLinkElements`、`setLinkElementAttributes`、`addLinkElement`、`removeLinkElement`はPluginBaseの共通メソッドとしては未実装です。link要素の書き込みは各プラグインが個別に実装しています。参考実装として記載します。

```javascript
// 参考実装（PluginBase未実装 - 各プラグインが個別に実装）

/**
 * xmlTAD内のlink要素を取得
 * @param {Document} doc - XMLドキュメント
 * @param {string} [linkId] - 特定のlinkIdを指定（省略時は全件）
 * @returns {Element[]}
 */
getLinkElements(doc, linkId = null) {
    const links = Array.from(doc.getElementsByTagName('link'));
    if (linkId) {
        return links.filter(link => link.getAttribute('id') === linkId);
    }
    return links;
}

/**
 * 仮身オブジェクトからlink要素の属性を設定
 * @param {Element} linkElement - link要素
 * @param {Object} virtualObj - 仮身オブジェクト
 */
setLinkElementAttributes(linkElement, virtualObj) {
    if (virtualObj.link_id) linkElement.setAttribute('id', virtualObj.link_id);
    if (virtualObj.link_name) linkElement.setAttribute('name', virtualObj.link_name);
    if (virtualObj.vobjleft !== undefined) linkElement.setAttribute('vobjleft', virtualObj.vobjleft);
    if (virtualObj.vobjtop !== undefined) linkElement.setAttribute('vobjtop', virtualObj.vobjtop);
    if (virtualObj.vobjright !== undefined) linkElement.setAttribute('vobjright', virtualObj.vobjright);
    if (virtualObj.vobjbottom !== undefined) linkElement.setAttribute('vobjbottom', virtualObj.vobjbottom);
    if (virtualObj.tbcol) linkElement.setAttribute('tbcol', virtualObj.tbcol);
    if (virtualObj.frcol) linkElement.setAttribute('frcol', virtualObj.frcol);
    if (virtualObj.chcol) linkElement.setAttribute('chcol', virtualObj.chcol);
    if (virtualObj.bgcol) linkElement.setAttribute('bgcol', virtualObj.bgcol);
    if (virtualObj.chsz) linkElement.setAttribute('chsz', virtualObj.chsz);
    if (virtualObj.dlen !== undefined) linkElement.setAttribute('dlen', virtualObj.dlen);
    linkElement.setAttribute('framedisp', virtualObj.framedisp || 'true');
    linkElement.setAttribute('namedisp', virtualObj.namedisp || 'true');
    linkElement.setAttribute('pictdisp', virtualObj.pictdisp || 'true');
    linkElement.setAttribute('roledisp', virtualObj.roledisp || 'false');
    linkElement.setAttribute('typedisp', virtualObj.typedisp || 'false');
    linkElement.setAttribute('updatedisp', virtualObj.updatedisp || 'false');
    linkElement.setAttribute('autoopen', virtualObj.autoopen || 'false');
    // 仮身固有の続柄
    if (virtualObj.linkRelationship && virtualObj.linkRelationship.length > 0) {
        linkElement.setAttribute('relationship', virtualObj.linkRelationship.join(' '));
    }
}

/**
 * xmlTADに新しいlink要素を追加
 * @param {Document} doc - XMLドキュメント
 * @param {Object} virtualObj - 仮身オブジェクト
 * @param {string} parentTagName - 親要素名（'figure' または 'document'）
 * @returns {Element} 追加したlink要素
 */
addLinkElement(doc, virtualObj, parentTagName = 'figure') {
    const parent = doc.querySelector(parentTagName);
    if (!parent) return null;

    const linkElement = doc.createElement('link');
    this.setLinkElementAttributes(linkElement, virtualObj);
    linkElement.textContent = virtualObj.link_name || '';
    parent.appendChild(linkElement);
    return linkElement;
}

/**
 * xmlTADからlink要素を削除
 * @param {Document} doc - XMLドキュメント
 * @param {string} linkId - 削除するlinkのID
 * @returns {boolean} 成功時true
 */
removeLinkElement(doc, linkId) {
    const links = this.getLinkElements(doc, linkId);
    if (links.length === 0) return false;

    links[0].parentNode.removeChild(links[0]);
    return true;
}
```

### 7.3 MessageBusメッセージ拡張検討

現在のMessageBusメッセージに加え、xmlTAD操作用のメッセージを検討：

| メッセージ | 方向 | 用途 |
|-----------|------|------|
| `parse-xmltad-request` | プラグイン → 親 | xmlTADパース要求 |
| `parse-xmltad-response` | 親 → プラグイン | パース結果返却 |
| `update-link-in-xmltad` | プラグイン → 親 | link要素更新 |
| `add-link-to-xmltad` | プラグイン → 親 | link要素追加 |
| `remove-link-from-xmltad` | プラグイン → 親 | link要素削除 |

**注**: PluginBase内でDOMParser/XMLSerializerを使用できるため、MessageBus経由でのパース処理は不要。link要素の操作もPluginBase内で完結可能。

---

## 8. 実装計画

### 8.1 フェーズ1: PluginBase拡張

**対象ファイル**: `js/plugin-base.js`

**追加メソッド**:
1. `parseXmlTad(xmlData)` - XMLパース
2. `serializeXmlTad(doc)` - XMLシリアライズ
3. `getLinkElements(doc, linkId)` - link要素取得
4. `parseLinkElement(linkElement)` - link要素パース（linkRelationship含む）
5. `parseLinkRelationship(linkElement)` - relationship属性パース
6. `setLinkElementAttributes(linkElement, virtualObj)` - link属性設定（relationship含む）
7. `addLinkElement(doc, virtualObj, parentTagName)` - link追加
8. `removeLinkElement(doc, linkId)` - link削除

**改造箇所リスト**:
| No | ファイル | 行番号 | 内容 |
|----|---------|--------|------|
| 1 | js/plugin-base.js | 末尾 | 上記メソッド追加 |

### 8.2 フェーズ2: virtual-object-list リファクタリング

**対象ファイル**: `plugins/virtual-object-list/app.js`

**改造箇所リスト**:
| No | 行番号 | 現在の実装 | 変更後 |
|----|--------|-----------|--------|
| 1 | 3232 | `new DOMParser()` | `this.parseXmlTad()` |
| 2 | 3294 | `new XMLSerializer()` | `this.serializeXmlTad()` |
| 3 | 3319 | `new DOMParser()` | `this.parseXmlTad()` |
| 4 | 3339 | `new XMLSerializer()` | `this.serializeXmlTad()` |
| 5 | 3363 | `new DOMParser()` | `this.parseXmlTad()` |
| 6 | 3433 | `new XMLSerializer()` | `this.serializeXmlTad()` |
| 7 | 3460 | `new DOMParser()` | `this.parseXmlTad()` |
| 8 | 3507 | `new XMLSerializer()` | `this.serializeXmlTad()` |
| 9 | 4615 | `new DOMParser()` | `this.parseXmlTad()` |
| 10 | 6253 | `new DOMParser()` | `this.parseXmlTad()` |
| 11 | 6298 | `new XMLSerializer()` | `this.serializeXmlTad()` |

### 8.3 フェーズ3: basic-text-editor リファクタリング

**対象ファイル**: `plugins/basic-text-editor/editor.js`

**改造箇所リスト**:
| No | 行番号 | 現在の実装 | 変更後 |
|----|--------|-----------|--------|
| 1 | 2589 | `new DOMParser()` | `this.parseXmlTad()` |
| 2 | 9270 | `new DOMParser()` | `this.parseXmlTad()` |
| 3 | 9324 | `new XMLSerializer()` | `this.serializeXmlTad()` |

### 8.4 フェーズ4: basic-figure-editor リファクタリング

**対象ファイル**: `plugins/basic-figure-editor/editor.js`

**改造箇所リスト**:
| No | 行番号 | 現在の実装 | 変更後 |
|----|--------|-----------|--------|
| 1 | 4671 | `new DOMParser()` | `this.parseXmlTad()` |

### 8.5 フェーズ5: basic-calc-editor リファクタリング

**対象ファイル**: `plugins/basic-calc-editor/editor.js`

**改造箇所リスト**:
| No | 行番号 | 現在の実装 | 変更後 |
|----|--------|-----------|--------|
| 1 | 5567 | `new DOMParser()` | `this.parseXmlTad()` |
| 2 | 5583 | `new DOMParser()` | `this.parseXmlTad()` |

### 8.6 フェーズ6: base-file-manager リファクタリング

**対象ファイル**: `plugins/base-file-manager/app.js`

**改造箇所リスト**:
| No | 行番号 | 現在の実装 | 変更後 |
|----|--------|-----------|--------|
| 1 | 298 | `new DOMParser()` | `this.parseXmlTad()` |

### 8.7 動作確認項目

各フェーズ完了後の確認項目：

1. **パース処理**
   - 正常なxmlTADがパースできること
   - 不正なXMLでエラーが返ること

2. **シリアライズ処理**
   - DOMが正しくXML文字列に変換されること
   - 日本語が文字化けしないこと

3. **link要素操作**
   - 仮身の追加・削除・更新が正しく動作すること
   - 仮身一覧でのドラッグ＆ドロップが動作すること

4. **既存機能への影響**
   - 各プラグインでの文書表示が正常なこと
   - 保存・読み込みが正常なこと

---

## 9. リスク分析

### 9.1 技術的リスク

| リスク | 影響度 | 発生確率 | 対策 |
|--------|--------|---------|------|
| パースエラーハンドリングの差異 | 中 | 低 | 既存のエラーハンドリングを維持 |
| シリアライズ時の属性順序変化 | 低 | 中 | 機能には影響なし、許容 |
| 特殊文字のエスケープ差異 | 中 | 低 | テストケースで検証 |

### 9.2 互換性リスク

| リスク | 影響度 | 発生確率 | 対策 |
|--------|--------|---------|------|
| 既存xtadファイルの読み込み失敗 | 高 | 低 | 既存ファイルでの回帰テスト |
| プラグイン固有処理との競合 | 中 | 低 | 段階的リファクタリング |

### 9.3 工数リスク

| リスク | 影響度 | 発生確率 | 対策 |
|--------|--------|---------|------|
| 想定外の依存関係 | 中 | 中 | 事前の影響調査を徹底 |
| テスト工数の増大 | 中 | 中 | 自動テスト導入検討 |

---

## 10. 参考資料

- [BTRON TAD仕様](http://www.personal-media.co.jp/book/tron/tronware_62.html)
- [realtimeDataTAD.md](./realtimeDataTAD.md) - 実時間制御xmlTAD仕様書（音楽・アニメーション・マルチメディア）
- [PLUGIN_DEVELOPMENT_GUIDE.md](./PLUGIN_DEVELOPMENT_GUIDE.md)
- [CLAUDE.md](../CLAUDE.md) - PluginBase共通化思想

---

## 11. 更新履歴

| 日付 | 版 | 内容 |
|------|-----|------|
| 2026-02-05 | 2.0 | 文章セグメント内のインライン`<figure>`要素対応（図形セグメントを直接埋め込み） |
| 2026-01-17 | 1.9 | 実時間TAD（`<realtime>`）を文書タイプに追加、realtimeDataTAD.mdへのリンクを追加 |
| 2025-12-31 | 1.0 | 初版作成 |
| 2025-12-31 | 1.1 | unpack.js/tad.jsから網羅的にタグを追加 |
| 2025-12-31 | 1.2 | xmlTAD出力形式を統一（figView/figDraw/figScale、docView/docDraw/docScale、image形式） |
| 2025-12-31 | 1.3 | 表計算の文字装飾タグを開始/終了形式に統一 |
| 2025-12-31 | 1.4 | figScale/docScaleのUNITS型仕様を明確化 |
| 2026-01-01 | 1.5 | l_atr属性を廃止し、lineType/lineWidth属性に分離 |
| 2026-01-04 | 1.6 | フォーマットルール（タグ内改行禁止）を追加 |
| 2026-01-04 | 1.7 | `<docoverlay>`のdata属性追加、段落タグ出力修正 |
| 2026-01-11 | 1.8 | 段落line-height計算修正、ペアタグフォントサイズ検出対応 |

### 1.5での変更内容

**l_atr属性の分離**:
- 旧形式の`l_atr`（16bit値: 上位8bit=線種、下位8bit=線幅）を非推奨化
- 新形式として`lineType`（線種）と`lineWidth`（線幅）の2属性に分離
- 全図形要素（rect, ellipse, line, polygon, polyline, curve, arc, chord, elliptical_arc, image）に適用
- 読み込み時は後方互換性のため`l_atr`もサポート

**対応ファイル**:
- `js/plugin-base.js`: `parseLineAttribute()`、`getLinePatternForType()`メソッド追加
- `plugins/unpack-file/unpack.js`: 11箇所の図形出力を`lineType`/`lineWidth`形式に変更
- `plugins/basic-figure-editor/editor.js`: 11箇所の読み込み、12箇所の保存を新形式に対応
- `docs/xmlTAD-specification.md`: 仕様書を新形式に更新

**lineType（線種）の定義**:
- 0: 実線 []
- 1: 破線 [6, 3]
- 2: 点線 [2, 2]
- 3: 一点鎖線 [8, 3, 2, 3]
- 4: 二点鎖線 [8, 3, 2, 3, 2, 3]
- 5: 長破線 [12, 4]

### 1.4での変更内容

**UNITS型仕様の明確化**:
- `<figScale>`および`<docScale>`の`hunit`/`vunit`属性はUNITS型（16bit符号付き整数）
- 負の値: DPI指定（例: -72 = 72DPI）
- 正の値: dots/cm指定
- 0: 外側の座標系を継承

**対応ファイル**:
- `plugins/basic-figure-editor/editor.js`: figScale読み書きをUNITS型に修正、parseDocScaleElement()使用
- `docs/xmlTAD-specification.md`: figScale属性の仕様説明を追加

### 1.3での変更内容

**表計算の文字装飾タグ統一**:
- `<bold/>`, `<italic/>`, `<underline/>`, `<mesh/>`, `<invert/>`を自己終了タグから開始/終了タグ形式に変更
- 例: `<bold/>セル内容` → `<bold>セル内容</bold>`

**対応ファイル**:
- `plugins/unpack-file/unpack.js`: 文字装飾タグ生成を開始/終了形式に変更、セル終了時に終了タグを出力
- `plugins/basic-calc-editor/editor.js`: 自己終了タグ変換処理を削除

### 1.2での変更内容

**形式統一**:
- `<figure>`要素: `<figView/>`, `<figDraw/>`, `<figScale/>`形式で出力
- 図形内`<document>`要素: `<docView/>`, `<docDraw/>`, `<docScale/>`, `<text/>`形式で出力
- `<image>`要素: `left/top/right/bottom/href`属性形式で出力

**対応ファイル**:
- `plugins/unpack-file/unpack.js`: figure/document/image出力形式を統一
- `plugins/tadjs-view/tad.js`: document出力形式を統一
- `plugins/basic-figure-editor/editor.js`: figView/figDraw/figScale読み込み対応、docView/docDraw/docScale読み書き対応

### 1.1での追加内容

**文章TAD追加要素**:
- `<font>` 拡張属性（style, weight, stretch, direction, kerning, pattern, space）
- `<text>` 属性（line-height, align, direction）
- 文字装飾（`<overline>`, `<box>`, `<invert>`, `<mesh>`, `<background>`, `<noprint>`）
- `<strong>`, `<i>` エイリアス
- `<bagchar>`, `<tab/>`, `<indent/>`
- `<ruby>`, `<attend>`（ルビ、添え字）
- `<fixedSpace/>`, `<widthspace/>`
- `<tcode>` TRONコードブロック
- `<pagebreak/>`, `<docoverlay/>`, `<docmemo/>`
- `<calcCell/>` 表計算セル属性

**図形TAD追加要素**:
- `<figure>` 詳細属性
- `<arc>`, `<chord>`, `<elliptical_arc>` 円弧系図形
- `<curve>` スプライン/ベジェ曲線
- `<group>` 図形グループ
- `<transform>` 座標変換
- `<figoverlay/>`, `<figmemo/>`
- `<binary>` バイナリデータ埋め込み
- 図形共通属性の整理

### 1.6での変更内容

**フォーマットルールの追加**:

- 「1.2 フォーマットルール」セクションを追加
- タグ内改行禁止ルールを明記
- タグ間改行とインデントのルールを明記

**対応ファイル**:

- `plugins/base-calendar/app.js`: `buildCalendarXml()`, `rebuildCalendarXmlWithVirtualObjects()`のrect/linkタグを1行化

### 1.7での変更内容

**`<docoverlay>`要素の修正**:

- `data`属性を追加（オーバーレイデータ用）
- 不正な形式`<docoverlay="..."/>`を正しい形式`<docoverlay data="..."/>`に修正
- 属性名のない形式は不正である旨を仕様書に明記

**段落タグ出力の修正**:

- `tsTextStart()`で`<p>`開始タグを出力するように修正
- 従来は`isParagraphOpen`フラグのみ設定し、タグ出力が欠落していた

**フォールバック処理の追加**:

- `basic-text-editor`で不正なxtad（`<p>`タグなし）に対する耐性を追加
- 既存の不正なxtadファイルも正しく表示可能に

**対応ファイル**:

- `plugins/unpack-file/unpack.js`: `tsTextStart()`, 文書オーバーレイ処理
- `plugins/basic-text-editor/editor.js`: `renderTADXML()`

### 1.8での変更内容

**段落line-height計算の修正**:

- 新段落作成時のline-height計算ロジックを修正
- 空の段落: デフォルトサイズ（14pt）基準のline-height（21px）
- コンテンツを含む段落: そのコンテンツの最大フォントサイズ基準

**フォントサイズ検出の拡張**:

- XMLロード時のフォントサイズ検出をペアタグ形式にも対応
- 自己閉じタグ形式: `<font size="18"/>`
- ペアタグ形式: `<font size="18">...</font>`

**PluginBase共通化**:

- `calculateMaxFontSizeInContent()`: DOM要素内の最大フォントサイズを計算
- `calculateMaxFontSizeFromXml()`: XMLコンテンツから最大フォントサイズを計算
- `calculateLineHeight()`: フォントサイズからline-heightを計算

**対応ファイル**:

- `js/plugin-base.js`: 3つの共通メソッド追加
- `plugins/basic-text-editor/editor.js`: Enter処理とXMLロード処理を修正
