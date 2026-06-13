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

#### `<paper>` - 用紙指定付箋(用紙サイズ + 綴じ・面付け)

TAD 文章データをレイアウトする用紙の大きさと、オーバーレイ領域を指定する。文章開始セグメントの後、マージン指定付箋より前に最低一つ必要。図形 TAD に埋め込まれた文章 TAD の中では「通常」無視される。

```xml
<paper type="doc" length="1403" width="992" binding="0" imposition="0" top="94" bottom="94" left="94" right="47" />
```

| 属性 | 説明 | 単位 |
|------|------|------|
| type | 文書タイプ（"doc"） | - |
| length | 用紙の縦方向サイズ | docScale.vunit の座標系単位 |
| width | 用紙の横方向サイズ | docScale.hunit の座標系単位 |
| binding | 綴じ方向(D): 0=左綴じ、1=右綴じ | - |
| imposition | 面付け(P): 0=1面付け、1=2面付け(見開き) | - |
| top/bottom | 版面の上下端から本文領域までのマージン | docScale.vunit の座標系単位 |
| left/right | ノド/小口から本文領域までのマージン | docScale.hunit の座標系単位 |

**左右マージンの意味:**

- `left` = ノド(綴じ側)、`right` = 小口(開き側)
- 絶対方向ではなく綴じ方向に対する相対方向で指定する
- `binding=1`(右綴じ)で物理的な左右が入れ替わる
- `imposition=1`(見開き)かつ偶数ページでも入れ替わる
- 両条件同時成立は二重反転(=反転なし)
- 実装は [paper-size.js](../js/paper-size.js)

#### `<docmargin>` - マージン指定付箋(本文レイアウト領域)

文章データをレイアウトする「本文レイアウト領域」を確保する。文章開始セグメントの後、最初の可視セグメントの前に最低一つ必要。

```xml
<docmargin top="94" bottom="94" left="94" right="47" />
```

| 属性 | 説明 | 単位 |
|------|------|------|
| top/bottom | 版面の上下端から本文領域までのマージン | docScale.vunit の座標系単位 |
| left/right | ノド/小口から本文領域までのマージン | docScale.hunit の座標系単位 |

**特殊値:**

- 値 `65535`(0xffff)は「**直前のマージン指定を継承**」を意味する(属性ごと適用可)

**左右反転:**

- `<paper>` の `binding` / `imposition` に従って left/right の物理位置が入れ替わる
- 詳細は `<paper>` の節を参照

#### `<column>` - コラム指定付箋(段組)

本文レイアウト領域の段組(コラム数・段間マージン・段間罫線)を指定する。図形TADでは無視される。

```xml
<column column="2" balance="0" colsp="20" />
<column column="2" balance="1" colsp="20" colline="3" linenum="0" lineDensity="0" lineWidth="2" lineType="0" colline2="0" linenum2="0" lineDensity2="0" lineWidth2="0" lineType2="0" />
```

| 属性 | 説明 |
| ------ | ------ |
| column | コラム(段)数 (CCCC = ATTR bit0-3、 0-15、 0/1 は段組みなし) |
| balance | 均等化指定 (K = ATTR bit7、 0:順にレイアウト、 1:各段均等) |
| colsp | 段間マージン(座標系単位) |
| colline | 段間罫線の生値(4bit、 下位 UB の DIWW) |
| linenum | 罫線本数(0:1本、1:2本) |
| lineDensity | 罫線濃度(0:100%、1:50%) |
| lineWidth | 罫線幅(0:なし、1:細、2:中、3:太) |
| lineType | 罫線種(0:実線、1:破線、 2:点線、 3:一点鎖線、 4:二点鎖線、 5:長破線、 6:波線) |
| colline2/linenum2/lineDensity2/lineWidth2/lineType2 | 上位 UB の DIWWKKKK 構造 |

ATTR バイト配置: Kxxx CCCC (bit7=K 均等化指定、 bit0-3=コラム数)

basic-text-editor の CSS 反映: column-count = column、 column-gap = colsp(px換算)、 column-fill = balance(1:balance、 0:auto)、 column-rule = lineWidth + lineType の近似

#### `<page-number>` - ページ番号指定付箋

出現ページのページ番号と、以降のページ番号の増加量を指定する。TAD では「ページ数」(先頭1始まりの連続ユニーク値)と「ページ番号」(ラベル、非連続・重複可)を別個に扱う。図形TADでは無視される。

```xml
<page-number step="1" num="1" />
```

| 属性 | 説明 |
| ------ | ------ |
| step | ページ番号の増加量(符号付き8bit, -128〜+127, 推奨 ≧ 0) |
| num | 出現ページのページ番号(UH, 非負) |

注意:

- step < 0 のとき、ページ番号が 0 や負になる挙動は仕様未定義。step ≧ 0 推奨。
- 同一ドキュメント内に同一ページ番号のページが複数登場し得る(エディタは想定要)。

#### `<fill-line>` - 充填行指定付箋

ページ末端の余白をページ内のこの付箋の数に応じて等分配置する付箋。付箋の数で比率を調整する。図形TADでは無視される。

```xml
<fill-line />
```

属性なし(ATTR は BTRON 仕様で未使用、 保存時は常に 0 を出力)。

特徴:

- 改行を伴う付箋であり、 行の区切りとなる
- ページ内に余白が生じない場合、 この付箋による行間隔の増加は 0
- 同一ページに複数の付箋がある場合、 余白は付箋数で等分される

制限事項(BTRON 仕様準拠):

- 枠あけ指定付箋、 コラム指定付箋、 文字方向指定付箋、 フィールド書式指定付箋の中では機能せず、 単なる改行と同等に扱う
- 処理可能な条件は、 ページが単一の書記領域で構成され、 コラムなし、 枠なし、 フィールド外であること

basic-text-editor の実装:

- `<div class="fl-spacer" style="min-height: 1em;"></div>` として描画
- 連続スクロールエディタでは厳密な「ページ末端余白の等分配置」 は実装困難なため、 最小高さ 1em の改行として表示
- 保存時には `<div class="fl-spacer">` から `<fill-line />` として復元

#### `<frame-open>` - 枠あけ指定付箋

ページ内に area で指定された大きさの矩形枠を確保し、ページをレイアウトする付箋。この付箋の直後の図形セグメントを、枠の中央に配置する。本文は枠の左右に回り込む(K=0通常時)。図形TAD内では「通常」無視される。

```xml
<frame-open abs="0" halign="2" valign="2" page="0" wrap="0" top="0" left="0" bottom="99" right="99" />
```

| 属性 | 値 | 説明 |
| ---- | ---- | ---- |
| abs | 0/1 | A: 0=H/V による位置属性指定、1=area の位置を絶対指定 |
| halign | 0-3 | H: 縦方向枠位置(0=任意、1=上端、2=中央、3=下端)。abs=1 では無視 |
| valign | 0-3 | V: 横方向枠位置(0=任意、1=左端、2=中央、3=右端)。abs=1 では無視 |
| page | 0/1 | P: 0=以降ページで条件成立場所、1=同一ページ強制(非推奨) |
| wrap | 0/1 | K: 0=通常枠(本文回り込み)、1=一行扱い(非推奨) |
| top | int | area.top (docScale.vunit 座標系単位) |
| left | int | area.left (docScale.hunit 座標系単位) |
| bottom | int | area.bottom (half-open property 補正済、TAD 生バイナリ値 -1) |
| right | int | area.right (half-open property 補正済、TAD 生バイナリ値 -1) |

ATTR ビット配置(TADバイナリ): `APKxHHVV`(bit7=A、bit6=P、bit5=K、bit4=予約、bit3-2=H、bit1-0=V)

area の解釈:

- abs=0 のとき: area からは枠の **大きさだけ** が使われ、位置は H/V で決定
- abs=1 のとき: area の位置(top/left)がそのまま使われ、H/V は無視
- bottom/right は xmlTAD では half-open property 補正済(BTRON 生バイナリ値より -1)

枠と図形の関係:

- 枠より大きい図形は枠の大きさが描画域となり、はみ出した部分はクリップされる
- 拡大縮小は行われない
- 直後の図形セグメントが対象

非推奨指定の扱い:

- K=1(一行扱い枠): float なしの block 配置にフォールバック
- P=1(同一ページ強制): break-inside: avoid 等で近似
- H=0/V=0(任意): 中央配置として表示

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

#### `<field-format>` - フィールド書式指定付箋 (SegID FFA1 SubID 0x03)

段落をフィールド (小間) で区切る表組み風書式。

```xml
<field-format R="0" P="0" height="0" pargap="0.75" line="0" nfld="3">
  <field fld="0"   left="0" right="0" margin="0" f_attr="0" />
  <field fld="100" left="0" right="0" margin="0" f_attr="0" />
  <field fld="200" left="0" right="0" margin="0" f_attr="0" />
</field-format>
```

| 属性 (field-format) | 説明 |
| --- | --- |
| R | 基準位置 (0=絶対、 1=相対) |
| P | ページ拘束 (0=なし、 1=次段落と同ページ、 2=次タブ書式まで同ページ) |
| height | SCALE 型、 段落間隔 (前段落との) |
| pargap | SCALE 型、 段落間隔 (後段落との) |
| line | 罫線属性 (UH、 上位/下位バイト DIWW KKKK DIWW KKKK) |
| nfld | フィールド数 |

| 属性 (field) | 説明 |
| --- | --- |
| fld | フィールド開始位置 (UH) |
| left | フィールド内行頭マージン (UH) |
| right | フィールド内行末マージン (UH) |
| margin | A=0,3 でインデント、 A=5 で小数点揃え位置 (UH) |
| f_attr | HxWW KKKK xxxx xAAA (H=底辺罫線、 W/K=フィールド左罫線、 A=揃え) |

basic-text-editor: `<div class="field-format" data-format-attrs>` + 各 `<span class="field" data-field-attrs>` でラウンドトリップ保存。

#### `<text direction>` - 文字方向 (FFA1 SubID 0x04)

```xml
<text direction="0"/>  <!-- 左横書き -->
<text direction="1"/>  <!-- 右横書き -->
<text direction="2"/>  <!-- 縦書き -->
```

basic-text-editor: `editor.style.direction = 'rtl'` (1) または `editor.style.writingMode = 'vertical-rl'` (2) で実現。 保存時に元の `<text direction>` で出力。

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
| hRatio | 文字高さ拡大率 (RATIO 型 A/B) | "2/1", "3/2" | ペアタグ |
| wRatio | 文字幅拡大率 (RATIO 型 A/B) | "2/1", "3/2" | ペアタグ |

`<font hRatio wRatio>` 詳細 (BTRON 文字拡大／縮小指定付箋 SubID 0x03):

- BTRON 仕様の RATIO 型 (16bit、 AAAA AAAA BBBB BBBB) を分数文字列 "A/B" として保持
- B=0 のときは比率 1 (=デフォルト) として扱われる
- h_ratio (= hRatio) は文字高さ、 w_ratio (= wRatio) は文字幅の拡大／縮小率
- 直前の文字サイズ指定の結果に適用される
- 拡大／縮小指定とは連鎖しない (累積効果なし)
- 紙面に対する絶対方向、 文字方向指定付箋の影響なし
- ATTR は未使用 (読み捨て、 保存時は 0)

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
| `<combchar>` | 結合文字 (改行禁止グループ) | - |
| `<char-layout kind width>` | 文字割付け開始/終了指定付箋 (SegID FFA4 SubID 0x02/0x03) | - |
| `<bouten side kind>` | 傍点 (圏点) 開始/終了指定付箋 (SegID FFA5 SubID 0x08-0x0B) | - |
| `<fixed-space width />` | 固定幅空白指定付箋 (SegID FFA3 SubID 0x00、 自己閉じタグ) | - |
| `<page-number step num />` | ページ番号指定付箋 (SegID FFA0 SubID 0x06、 自己閉じタグ) | - |
| `<docmemo text />` | 文章メモ指定付箋 (SegID FFAE、 自己閉じタグ) | - |
| `<font style weight stretch direction kerning pattern>` | フォント属性指定付箋 (SegID FFA2 SubID 0x01) の追加属性、 編集後ラウンドトリップ対応 | - |

`<char-layout kind width>` 詳細:

- kind: 0=左揃え、 1=右揃え、 2=中央揃え、 3=両端揃え、 4=均等揃え
- width: SCALE 型 (abs:N で絶対値 docScale 単位、 A/B で比率指定)

```xml
<char-layout kind="2" width="abs:300">中央揃えテキスト</char-layout>
```
| `<fill-char str>` | 充塡文字指定付箋 (SegID FFA3 SubID 0x01、 行末余白を文字列の繰り返しで埋める、 自己閉じタグ) | - |

`<fill-char str>` 詳細:

- BTRON 仕様: 行末の余白を行内の充塡文字付箋の数で均等に割り振り、 指定文字列の繰り返しで埋める
- str 属性は TRON コード列、 一文字単位で扱われる (例: `<fill-char str="." />` でドット繰り返し)
- ATTR は未使用 (読み捨て、 保存時は 0)
- basic-text-editor: `<span class="fill-char" data-fill-str="...">` で `flex-grow:1` の伸縮セパレーター、 CSS `::after` で文字繰り返し表示
- 行揃え指定付箋に優越するか仕様書に記述なし (BTRON 仕様)
- ジャスティフィケーションのセパレータとしての使用は非推奨

```xml
<fill-char str="." />
```

`<bouten side kind>` 詳細:

- side: "upper" (上 (右) 傍点)、 "lower" (下 (左) 傍点)
- kind: 0=中黒、 1=読点、 2-7=予約、 8=アプリケーション依存
- basic-text-editor: CSS `text-emphasis-style` / `text-emphasis-position` で実現

```xml
<bouten side="upper" kind="0">強調文字</bouten>
```

`<fixed-space width />` 詳細:

- width: SCALE 型 (abs:N で絶対値、 A/B で比率指定、 基準値は文字サイズ)
- 一文字扱い、 行末越えで次行頭に追い出し
- basic-text-editor: `<span class="fixed-space" data-width>` で `display: inline-block` 幅指定

```xml
<fixed-space width="abs:100" />
<fixed-space width="2/1" />
```

`<page-number step num />` 詳細:

- step: ページ番号の増加量 (-128〜+127)
- num: 当該ページのページ番号
- basic-text-editor: `<span class="page-number" data-step data-num>` で num 値を表示

```xml
<page-number step="1" num="5" />
```

`<docmemo text />` 詳細:

- 任意のメタデータをドキュメントに埋め込む
- text 属性は TRON コード列、 編集中は灰色斜体で表示
- basic-text-editor: data-memo でラウンドトリップ保存

```xml
<docmemo text="メモ内容" />
```

`<font style|weight|stretch|stretchscale|direction|kerning|pattern>` 詳細 (フォント属性指定付箋 SegID FFA2 SubID 0x01):

- style: 0=正体、 1-3=水平斜体、 5-7=垂直斜体 → CSS font-style
- weight: 0=中字、 1=極細、 2=細字、 4=中太、 5=太字、 6=極太、 7=超太 → CSS font-weight
- stretch: 0=通常、 1-3=圧縮、 5-7=幅広 → CSS font-stretch
- stretchscale: 文字幅倍率 (data 属性で保持)
- direction: 0=横書き、 1=縦書き → CSS writing-mode
- kerning: 0=なし、 1=あり → CSS font-kerning
- pattern: 線種 (data 属性で保持のみ)
- basic-text-editor: data-font-* で保持し、 保存時に font ペアタグの属性として再出力

```xml
<font weight="5"><font style="1">太字斜体テキスト</font></font>
```

`<combchar>` 詳細:

- BTRON 仕様の「結合文字開始指定付箋」 (SegID FFF3、 SubID 0x00) と「結合文字終了指定付箋」 (SubID 0x01) のペアを XML のペアタグとして表現
- 結合対象文字列は途中で改行されない (基本テキスト編集では `white-space: nowrap; display: inline-block` で実現)
- 行末を越える場合は、 結合対象文字列の直前で改行し、 次行の行頭から表示
- ATTR は未使用 (読み捨て、 保存時は 0)
- 結合対象文字列が行全長よりも長い場合の描画は保証されない (仕様準拠)
- ネストされた文章セグメントでは結合終了指定付箋が複数存在し得る (BTRON 仕様)

```xml
<combchar>結合文字列</combchar>
```

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

#### `<tab-format/>` - タブ書式指定付箋

段落の行高さ、段落間隔、行頭・行末マージン、字下げ、タブストップ位置を指定する。

```xml
<tab-format R="0" P="0" height="0.75" pargap="0.75" left="0" right="0" indent="0" ntabs="3" tabs="100,200,300"/>
```

| 属性 | 説明 | 値の例 |
|------|------|--------|
| R | 基準位置指定（0:絶対, 1:相対） | "0" |
| P | ページ拘束（0:なし, 1:次段落1行目まで同ページ, 2:次付箋まで全段落同ページ） | "0" |
| height | 前段落との間隔(SCALE型、比率/絶対) | "0.75", "abs:150" |
| pargap | 後続段落との間隔(SCALE型、比率/絶対) | "0.75", "abs:200" |
| left | 行頭マージン(座標系単位、signed) | "0", "50" |
| right | 行末マージン(座標系単位、signed) | "0", "30" |
| indent | 字下げ(座標系単位、signed、負値可) | "0", "20", "-10" |
| ntabs | タブストップ数(負値は直前の付箋から継承、0でも行頭タブストップは存在) | "3", "-1", "0" |
| tabs | タブストップ位置(signed 16bit、コラム行頭端起点) | "100,200,300", "100,-200" |

**SCALE型(height / pargap):**

- 比率モード: `"0.75"` のような **小数 or 整数**(基準値 = 段落を構成する全行の行間隔基準値の最大値)
- 絶対モード: `"abs:150"` のように **abs: プレフィックス付き**(座標系単位の絶対値)
- 元の binary TAD では MSB=1 が絶対モード、MSB=0 が比率モード。xmlTAD では abs: プレフィックスで明示

**tabs(タブストップ):**

- 値は signed 16bit、コラム行頭端を起点とした座標系単位での位置
- 行頭マージンを反映した位置に常に暗黙のタブストップが存在(ntabs=0 でも有効)
- 行末を越えた指定は無視するが、値の保持を推奨
- **負値の場合は「小数点揃えタブ」**: 絶対値の位置で小数点揃え(現仕様では小数点グリフ判定不能のため、実装ではマーカーのみ保持)

**ページ拘束(P)の動作:**

- P=1: 当該段落と次段落の1行目までを同一ページにレイアウト
- P=2: 当該付箋から次のタブ書式指定/フィールド書式指定までの全段落を同一ページにレイアウト
- レイアウト不能時は改ページ。それでも収まらない場合は拘束を解除して次ページ先頭から
- 実装では P=1 に `break-after: avoid-page`、P=2 に `break-inside: avoid` を適用(印刷プレビュー時のみ有効)

#### `<indent/>` - 字下げ

```xml
<indent/>字下げされたテキスト
```

#### `<line-head-kinsoku/>` - 行頭禁則指定付箋 (SegID FFA4 SubID 0x08)

行頭禁則の対象文字と処理方法を指定する。 出現した行から次の `<line-head-kinsoku/>` の直前の行までを対象とする (後勝ち継承)。

```xml
<line-head-kinsoku kind="0x10" ch="、。」）"/>
```

| 属性 | 説明 | 値の例 |
|------|------|--------|
| kind | 禁則方式 K (上位 4 bit) + 禁則レベル L (下位 4 bit) を 1 バイト 16 進文字列で指定 | "0x10" (K=1 追い出し / L=0 一重) |
| ch | 禁則対象文字 (省略時はアプリ既定) | "、。」）" |

**kind の K (禁則方式)**:

- 0: 禁則なし (CSS `line-break: anywhere`)
- 1: 追い出し禁則 (前の行末文字を行頭に取り込む、 BTRON 標準動作、 CSS `line-break: strict; word-break: keep-all`)
- 2: 追い込み禁則 (禁則文字を前行行末に追い込む、 CSS `line-break: loose`)
- 3: ぶら下がり禁則 (禁則文字を前行末の禁則文字領域に配置、 CSS `line-break: strict`)
- 4〜14: 予約
- 15: アプリケーション依存 (CSS `line-break: auto`)

**kind の L (禁則レベル)**:

- 0: 一重禁則 (最初の 1 文字のみ処理)
- 1: 多重禁則 (連続する禁則文字すべて処理)

**実装注意**: BTRON 仕様の追い出し/追い込み/ぶら下がりの精密制御は HTML/CSS 構造上困難なため、 basic-text-editor では K の値に応じた CSS `line-break`/`word-break` の簡易近似で対応。 `ch` 属性は data-attrs に退避し、 ラウンドトリップで保持。

#### `<line-tail-kinsoku/>` - 行末禁則指定付箋 (SegID FFA4 SubID 0x09)

行末禁則の対象文字と処理方法を指定する。 `<line-head-kinsoku/>` と同形式 (kind/ch 属性)、 効果範囲も「出現行から次の同種付箋の直前行まで」 と同様。

```xml
<line-tail-kinsoku kind="0x10" ch="（「『"/>
```

属性仕様・kind ビット定義は `<line-head-kinsoku/>` と同じ。

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

**basic-text-editor 対応**: 編集モードでは非表示 `<span class="doc-overlay" data-overlay-attrs="…" style="display:none">` として保持し、 保存時に元の `<docoverlay …/>` 形式へ復元してラウンドトリップ可能。

#### `<paper-overlay-define>` - 用紙オーバーレイ定義付箋 (SegID FFA0 SubID 0x03)

用紙オーバーレイの内容を文章 TAD データとして定義する。 同一オーバーレイ番号で再定義されるまで有効。 `<docoverlay>` (用紙オーバーレイ指定付箋) でこの定義を適用する。

```xml
<paper-overlay-define N="0" P="0">
  <p><text align="center"/>ヘッダタイトル</p>
</paper-overlay-define>
```

| 属性 | 説明 |
|------|------|
| N | オーバーレイ番号 (0-15) |
| P | 適用ページ条件 (0=共通、 1=奇数のみ、 2=偶数のみ、 3=予約) |

**子要素**: 文章 TAD データ (`<p>` 段落、 `<figure>` 図形等を含む)。 文章開始セグメント/文章終了セグメントは省略する。

**basic-text-editor 対応**: 中身は編集 UI には反映せず、 非表示 `<span class="paper-overlay-define-preserved" data-attrs="…" data-content-b64="(Base64)" style="display:none">` として保持し、 保存時に元の `<paper-overlay-define …>…</paper-overlay-define>` 形式へ復元してラウンドトリップ可能。 オーバーレイの**描画は未対応** (印刷プレビュー機能の充実とともに将来課題)。

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
| l_pat | 線カラーパターンID（0:パターンなし、1-127:パターンID） | "0" |
| f_pat | 塗りつぶしパターン（0:透明（塗りなし）、1-127:パターンID） | "0" |
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
<rect round="0" lineType="0" lineWidth="1" l_pat="0" f_pat="0" angle="0" left="10" top="10" right="110" bottom="60" zIndex="1"/>

<!-- 角丸矩形 -->
<rect round="1" lineType="0" lineWidth="1" l_pat="0" f_pat="0" angle="0" figRH="10" figRV="10" left="10" top="10" right="110" bottom="60" zIndex="2"/>
```

| 属性 | 説明 |
|------|------|
| round | 角丸フラグ（0:通常, 1:角丸） |
| lineType | 線種（0:実線, 1:破線, ...） |
| lineWidth | 線幅（ピクセル） |
| l_pat | 線カラーパターンID（0:パターンなし、2-127:パターンID） |
| f_pat | 塗りカラーパターンID（0:ソリッド塗り、1:塗りなし、2-127:パターンID） |
| angle | 回転角度（楕円傾斜用） |
| rotation | 図形回転角度（度数法、Canvas回転ラッパーによる描画回転） |
| left/top/right/bottom | 境界座標 |
| figRH, figRV | 角丸めの**水平/垂直直径** (round=1 時、 rh/rv 直径)。 値が異なる場合は非対称角丸めだが、 現状描画は (figRH+figRV)/4 を半径とする対称 fallback |
| cornerRadius | (旧形式互換) 角丸め半径 (= (figRH+figRV)/4)。 新規保存は figRH/figRV を併記 |
| zIndex | 重なり順序 |

#### `<ellipse>` - 楕円

```xml
<ellipse lineType="0" lineWidth="1" l_pat="0" f_pat="1" angle="0" cx="100" cy="100" rx="80" ry="50" zIndex="1"/>
```

| 属性 | 説明 |
| ---- | ---- |
| lineType | 線種（共通属性参照） |
| lineWidth | 線幅（共通属性参照） |
| cx, cy | 中心座標 |
| rx, ry | X方向/Y方向の半径 |
| rotation | 図形回転角度（度数法、Canvas回転ラッパーによる描画回転） |

**注意**: 円を描画する場合は`rx`と`ry`を同じ値に設定します。

#### `<arc>` - 扇形 (SubID 0x03)

「扇形」 と呼ばれる **閉じた図形** (円弧と中心を結ぶ閉領域)。 タグ名 `<arc>` は xmlTAD 上の互換名 (= Pie の意)。 **楕円弧 (開いた図形)** は別タグ `<elliptical_arc>` (SubID 0x07) で表す。

```xml
<arc lineType="0" lineWidth="1" l_pat="0" f_pat="0" angle="0" cx="100" cy="100" rx="50" ry="50" startX="150" startY="100" endX="100" endY="50" startAngle="0" endAngle="90" start_arrow="0" end_arrow="1" arrow_type="simple" zIndex="1"/>
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
| start_arrow, end_arrow | 始点/終点の矢印 (※ 閉じた図形のため `<figmodifier>` 「矢印は開いた図形のみ」 制約上は無効。 互換のため属性は保持) |

#### `<chord>` - 弦（円弧と直線の閉領域）

```xml
<chord lineType="0" lineWidth="1" l_pat="0" f_pat="0" angle="0" cx="100" cy="100" rx="50" ry="50" startX="150" startY="100" endX="100" endY="50" startAngle="0" endAngle="90" start_arrow="0" end_arrow="0" arrow_type="simple" zIndex="1"/>
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
| f_pat | 塗りパターン（0:ソリッド塗り, 1:塗りなし, 2-127:パターンID） |

#### `<elliptical_arc>` - 楕円弧 (SubID 0x07)

楕円弧 (**開いた図形**)。 `<arc>` (扇形 / SubID 0x03、 閉じた図形) とは別タグなので区別すること。 開いた図形のため `<figmodifier>` 矢印修飾の対象。

```xml
<elliptical_arc lineType="0" lineWidth="1" l_pat="0" angle="0" cx="100" cy="100" rx="80" ry="50" startX="180" startY="100" endX="100" endY="50" startAngle="0" endAngle="1.57" start_arrow="0" end_arrow="1" arrow_type="simple" zIndex="1"/>
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
| start_arrow, end_arrow | 始点/終点の矢印 (開いた図形のため `<figmodifier>` 適用可) |

#### `<line>` - 線（直線・折れ線）

```xml
<line lineType="0" lineWidth="1" l_pat="0" f_pat="0" start_arrow="0" end_arrow="1" arrow_type="simple" points="103,96 358,248" zIndex="3"/>

<!-- 接続線（図形間接続用） -->
<line lineType="0" lineWidth="1" l_pat="0" f_pat="0" start_arrow="0" end_arrow="1" arrow_type="filled" conn_pat="3" start_conn="0,4" end_conn="1,0" lineConnectionType="curve" points="103,96 358,248" zIndex="3"/>
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

#### `<polygon>` - 多角形

```xml
<polygon lineType="0" lineWidth="1" l_pat="0" f_pat="0" points="0,0 100,0 100,100 0,100" zIndex="1"/>
```

| 属性 | 説明 |
|------|------|
| lineType | 線種（共通属性参照） |
| lineWidth | 線幅（共通属性参照） |
| points | 頂点座標のリスト |
| f_pat | 塗りパターン（0:ソリッド塗り, 1:塗りなし, 2-127:パターンID） |
| rotation | 図形回転角度（度数法） |

#### `<polyline>` - 折れ線

```xml
<polyline lineType="0" lineWidth="1" l_pat="0" round="0" start_arrow="0" end_arrow="0" points="0,0 50,50 100,0" zIndex="1"/>
```

| 属性 | 説明 |
| ---- | ---- |
| lineType | 線種（共通属性参照） |
| lineWidth | 線幅（共通属性参照） |
| round | 角の丸め |
| rotation | 図形回転角度（度数法） |
| points | 座標点のリスト |
| start_arrow, end_arrow | 始点/終点の矢印 |

#### `<curve>` - 曲線（スプライン/ベジェ）

```xml
<curve lineType="0" lineWidth="1" l_pat="0" f_pat="0" type="bezier" closed="0" start_arrow="0" end_arrow="0" arrow_type="simple" points="0,0 50,100 100,100 150,0" zIndex="1"/>
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

#### `<freefig>` - 任意図形セグメント

任意図形セグメント (SegID FFB0、 SubID 0x0B)。 Y 座標 1 ドットごとに水平区間 `bx+h[2k]..bx+h[2k+1]-1` を描画する自由形状を表現する。

```xml
<freefig mode="0" f_pat="0" sy="0" nr="100" bx="0" nh="4" h="10,50,15,55" zIndex="1" />
```

| 属性 | 説明 |
|------|------|
| mode | 描画モード (0=STORE 推奨、 0 以外はカラー環境依存) |
| f_pat | 塗り潰しパターン ID (パターン定義セグメント参照) |
| sy | 描画領域 Y 座標 |
| nr | 描画領域の高さ (ドット) |
| bx | 描画領域 X 座標 (符号付き) |
| nh | h[] 配列の要素数 (通常は偶数) |
| h | 水平座標のカンマ区切り配列 |
| zIndex | 描画順序 |

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
| l_pat | 線カラーパターンID（0:パターンなし、2-127:パターンID） |
| f_pat | 塗りカラーパターンID（0:ソリッド、1:塗りなし、2-127:パターンID） |
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

### 4.9 マーカー要素

#### `<markerDefine>` - マーカー定義

マーカーの形状・サイズ・色を定義します。ID 0-4は組み込みマーカー（JIS X 9051-84準拠）で、デフォルトでサイズ16ピクセル・黒色です。

```xml
<markerDefine type="0" id="0" size="16" fgCol="#000000" />
<markerDefine type="0" id="5" size="24" fgCol="#ff0000" mask="3" />
```

| 属性 | 説明 |
|------|------|
| type | マーカータイプ（0: 直接描画） |
| id | マーカーID（0-4: 組み込み、5以上: カスタム） |
| size | マーカーサイズ（ピクセル） |
| fgCol | 前景色 |
| mask | マスク定義ID（ID 5以上で使用、maskDefineを参照） |

**組み込みマーカーID**:

| ID | 形状名 | 説明 |
|----|--------|------|
| 0 | dot | 点（1x1ピクセル） |
| 1 | plus | 十字（水平線+垂直線） |
| 2 | star | 星形（垂直線+2本の対角線、すべて中心を通る） |
| 3 | circle | 円 |
| 4 | cross | ×字（2本の対角線） |

#### `<marker>` - マーカー列

指定した座標点にマーカーを描画します。

```xml
<marker mode="0" markerId="0" points="100,200 150,250 200,300" zIndex="5" />
```

| 属性 | 説明 |
|------|------|
| mode | 描画モード（0: 直接描画。0以外はXMLに保存するが描画は0として扱う） |
| markerId | 使用するマーカー定義のID |
| points | 座標点リスト（"x1,y1 x2,y2 ..." 形式） |
| zIndex | 描画順序（省略可能） |

### 4.10 パターン定義

#### パターン・マスク定義の配置

`<mask>`と`<pattern>`要素は`<figure>`要素内に配置し、カラーパターンとマスク定義を格納します。
l_pat/f_pat属性で参照されるパターンID 1〜127のカラーパターンを定義します。

**配置形式**: 以下の2形式をサポートします（読み込み時は両方を認識）。

**形式1: インライン配置（TADバイナリ変換時の出力形式）**

TADバイナリの出現順を保持し、`<figure>`直下に図形要素と混在して配置します。
マスク/パターン定義は、それを参照する図形要素より前に出現する必要があります。

```xml
<figure>
<mask id="14" type="0" width="8" height="8" data="00c0,00c0,0000,0000,0000,0000,00c0,00c0" />
<pattern id="2" width="4" height="4" ncol="2" fgcolors="#ff0000,#00ff00" bgcolor="#ffffff" masks="7,4" />
<!-- 図形要素（上記のマスク/パターンを参照可能） ... -->
</figure>
```

**形式2: `<patterns>`ラッパー配置（図形エディタ保存時の出力形式）**

`<figDraw>`/`<figScale>`直後（図形要素より前）にまとめて配置します。
図形要素がマスク/パターンを参照する前に定義が解釈されるようにするためです。

```xml
<figure>
<figView ... />
<figDraw ... />
<figScale ... />
<patterns>
<mask id="14" type="0" width="8" height="8" data="00c0,00c0,0000,0000,0000,0000,00c0,00c0" />
<pattern id="2" width="4" height="4" ncol="2" fgcolors="#ff0000,#00ff00" bgcolor="#ffffff" masks="7,4" />
</patterns>
<!-- 図形要素（上記のマスク/パターンを参照可能） ... -->
</figure>
```

**ID上書きルール**: 同じマスクID/パターンIDが複数回出現した場合、後の定義が前の定義を上書きします（TADバイナリの逐次解釈に準拠）。

#### `<mask>` - マスクデータ定義

マスクIDは0以上の任意の値。ID 1-13はデフォルト定義があり、同じIDを指定すると上書きする。

| 属性 | 型 | 説明 |
|------|---|------|
| id | number | マスクID（≥0） |
| type | number | マスク形式（現状 0:ビットマップのみ） |
| width | number | マスク横幅（>0、ピクセル） |
| height | number | マスク縦幅（>0、ピクセル） |
| data | string | カンマ区切りの16ビットワード値（4桁16進数） |

**マスクdata形式**:

- 1ビットで1セルを表現（1:描画、0:描画しない）
- MSBが左端ピクセルに対応
- 1行あたり `ceil(width / 16)` 個の16ビットワード（16ビット境界でアラインメント）
- 各ワードは4桁の16進数（例: `00c0`, `ffff`, `0000`）で表記
- ワード間はカンマ区切り
- 合計 `ceil(width / 16) × height` 個のワード値

#### `<pattern>` - カラーパターン定義

| 属性 | 型 | 必須 | 説明 |
|------|---|------|------|
| id | number | ◯ | パターンID（1-127、カスタムは128+） |
| width | number | ◯ | パターン横幅（ピクセル） |
| height | number | ◯ | パターン縦幅（ピクセル） |
| ncol | number | ◯ | 前景色の個数 |
| fgcolors | string | ◯ | カンマ区切りの前景色リスト（`#rrggbb`または`transparent`） |
| bgcolor | string | ◯ | 背景色（`#rrggbb`または`transparent`） |
| masks | string | ◯ | カンマ区切りのマスクIDリスト（ncol個） |

**TADパターン定義セグメント準拠**:

- TADバイナリのCOLORPATTERN構造をそのままXML属性に対応させた形式
- 描画時はマスク定義（`<mask>`）を参照し、TAD仕様の描画順序に従ってピクセル色を再構築する

**描画順序**:

1. `bgcolor`で全面を塗りつぶし（`transparent`の場合は透明）
2. `fgcolors[0]`と`masks[0]`の組み合わせで前景色を配置（マスクビット=1の位置）
3. `fgcolors[1]`と`masks[1]`で追加の前景色を配置
4. 以降同様にncol分繰り返し

**透明色**:

- `transparent`キーワードで透明を指定
- 背景色が`transparent`: 塗りつぶしなし
- 前景色が`transparent`: マスクビット=0の位置に透明色を配置

**デフォルトパターン**:

- ID 0: 透明（TAD仕様: パターン0は透明、変更不可）— パターンデータなし
- ID 1: 黒ベタ
- ID 2-127: BTRON標準パターン — `<patterns>`に保存がなければデフォルト値を使用
- ID 128+: カスタムパターン — `<patterns>`に定義が必要

### 4.11 特殊要素

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
<link vobjid="019cf500-1234-7abc-8def-111111111111" id="019a6c9b-e67e-7a35-a461-0d199550e4cf_0.xtad" name="実身/仮身" tbcol="#e1f2f9" frcol="#000000" chcol="#000000" bgcol="#ffffff" width="150" heightpx="30" dlen="0" chsz="14" framedisp="true" namedisp="true" pictdisp="true" roledisp="false" typedisp="false" updatedisp="false" autoopen="false" scrollx="0" scrolly="0" zoomratio="1" applist="{}" relationship="">表示名</link>
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

#### 仮身固有ID属性

| 属性 | 説明 | デフォルト |
|------|------|-----------|
| vobjid | 仮身の一意識別子（UUID v7）。パース時にない場合は自動生成 | 自動生成 |

#### スクロール位置・表示倍率属性（BTRON仕様準拠）

BTRON仕様では、開いた仮身の表示位置（スクロール位置）と表示倍率は仮身毎に管理される。
同じ実身を参照する複数の仮身が、それぞれ異なる表示位置を持つことができる。

| 属性 | 説明 | デフォルト |
|------|------|-----------|
| scrollx | 水平スクロール位置（ピクセル） | 0 |
| scrolly | 垂直スクロール位置（ピクセル） | 0 |
| zoomratio | 表示倍率 | 1.0 |

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

## 11. 未実装の付箋(TODO)

本章は BTRON TAD 仕様に存在し、本実装で付箋として認識されているが現状未実装の付箋一覧。各項目には実装時の提案 XML タグ名を併記する。

### 11.1 未実装 TODO リスト

実装着手時にチェックを付与し、 対応する xmlTAD タグ仕様を11.2節に追記する。

凡例: `[ ]` = 未着手 / `[x]` = 対応済み or サポート対象外

- [x] **TODO-1: 枠あけ指定付箋** - `<frame-open>` (実装済み、3.2節参照)
- [x] **TODO-2: ページ番号指定付箋** - `<page-number step num>` (実装済み、 3.2節参照)
- [x] **TODO-3: 充填行指定付箋** - `<fill-line />` (実装済み、3.2節参照)
- [x] **TODO-4: フィールド書式指定付箋** - `<field-format>` (実装済み、3.3節参照)
- [x] **TODO-5: 文字拡大／縮小指定付箋** - `<font hRatio wRatio>` 属性 (実装済み、3.4節参照)
- [ ] **TODO-6: 文字回転指定付箋** - `<font rotation>` 属性 (実装非推奨、 仕様記載のみ 11.2.3)
- [x] **TODO-7: 充填文字指定付箋** - `<fill-char str>` (実装済み、3.4節参照)
- [x] **TODO-8: 文字罫線指定付箋** - サポート対象外
- [x] **TODO-9: 文字割付け開始/終了指定付箋** - `<char-layout kind width>` (実装済み、3.4節参照)
- [x] **TODO-10: 図形修飾セグメント** - `<figmodifier arrow>` (実装済み、 4.7 節参照)

> **注意:** 上記の提案 XML タグ名・属性は実装時の暫定案。実装時に本仕様書を改訂して正式採用する。

### 11.2 各付箋の仕様(BTRON TAD 仕様準拠の概要)

#### 11.2.1 `<page-number>` - ページ番号指定付箋(未実装)

ページ番号の表示形式・開始番号を指定する。

提案 XML 例:

```xml
<page-number start="1" format="arabic" position="bottom-center" />
```

| 属性 | 説明 |
| --- | --- |
| start | 開始ページ番号 |
| format | 表示形式(arabic / roman / kanji 等) |
| position | 表示位置 |

#### 11.2.2 文字回転指定付箋(仕様書は実装非推奨)

文字の回転角度を指定する。 仕様上「回転軸の規定なし」「回転後配置の規定なし」 として実装非推奨と明記されており、 本実装でも保留。

提案 XML 例:

```xml
<font rotation="90" />
```

| 属性 | 説明 |
| --- | --- |
| rotation | 回転角度(度数法、時計回り正) |

#### 11.2.3 文字基準位置移動付箋(仕様書は実装非推奨)

仕様上「+方向/-方向の意味について仕様間の記述が矛盾」 として実装非推奨と明記されており、 本実装でも保留。

提案 XML 例 (実装時の参考):

```xml
<font baseline="abs:5" direction="0" />
```

| 属性 | 説明 |
| --- | --- |
| baseline | ベースラインの移動量 (SCALE 型) |
| direction | 0=行戻し方向、 1=行送り方向 |

#### 11.2.4 名前指定変数参照付箋(設定付箋未実装のため保留)

変数参照指定付箋は「設定付箋 (FF19) で変数を定義してから参照する」 構造だが、 設定付箋自体が仕様書記載のみで実装根拠なし。 設定付箋が実装されるまで本付箋も保留。

#### 11.2.5 文章アプリケーション指定付箋(任意バイナリ、 拡張機構として将来検討)

文章アプリケーション指定付箋はサードパーティのバイナリペイロードを文章 TAD 中に埋め込む仕組み。 任意フォーマットのためジェネリック実装が困難。 将来的に拡張機構として検討。

#### 11.2.6 文字罫線指定付箋(サポート対象外)

文字の上下左右に罫線を引く付箋。日本語縦書き組版での欄外注などで使用。本実装ではサポートしない方針。

#### 11.2.5 `<figmodifier>` - 図形修飾セグメント (SubID 0x00)

直後の図形要素セグメントの始点/終点に矢印を付加する修飾セグメント。

**制約 (BTRON 仕様)**: 直後セグメントが **開いた図形** の場合のみ有効。

- 適用可: `<line>` / `<polyline>` / `<elliptical_arc>` / `<curve closed="0">`
- 適用不可 (BTRON 仕様上無効): `<rect>` / `<ellipse>` / `<arc>` / `<chord>` / `<polygon>` / `<curve closed="1">`
- basic-figure-editor parser は閉じた図形に紐付いた `<figmodifier>` を検出時 console.warn を出力し、 矢印を描画しない (xmlTAD ラウンドトリップは元の閉じた図形のみ保持、 figmodifier は無視)

```xml
<figmodifier arrow="0x01" />
<line points="0,0 100,100" />
```

| 属性 | 説明 |
| --- | --- |
| arrow | 矢印属性ビット (ATTR の生値、 上位 4 bit:予約、 bit1=E (終点)、 bit0=S (始点)) |

---

## 12. 更新履歴

| 日付 | 版 | 内容 |
|------|-----|------|
| 2025-12-31 | 1.0 | 初版作成 |
| 2025-12-31 | 1.1 | unpack.js/tad.jsから網羅的にタグを追加 |
| 2025-12-31 | 1.2 | xmlTAD出力形式を統一（figView/figDraw/figScale、docView/docDraw/docScale、image形式） |
| 2025-12-31 | 1.3 | 表計算の文字装飾タグを開始/終了形式に統一 |
| 2025-12-31 | 1.4 | figScale/docScaleのUNITS型仕様を明確化 |
| 2026-01-01 | 1.5 | l_atr属性を廃止し、lineType/lineWidth属性に分離 |
| 2026-01-04 | 1.6 | フォーマットルール（タグ内改行禁止）を追加 |
| 2026-01-04 | 1.7 | `<docoverlay>`のdata属性追加、段落タグ出力修正 |
| 2026-01-11 | 1.8 | 段落line-height計算修正、ペアタグフォントサイズ検出対応 |
| 2026-01-17 | 1.9 | 実時間TAD（`<realtime>`）を文書タイプに追加、realtimeDataTAD.mdへのリンクを追加 |
| 2026-02-05 | 2.0 | 文章セグメント内のインライン`<figure>`要素対応（図形セグメントを直接埋め込み） |
| 2026-02-23 | 2.1 | `<tab-format/>`タグ追加（タブ書式指定付箋対応） |
| 2026-03-01 | 2.2 | `<markerDefine>`/`<marker>`タグ追加（マーカー定義・マーカー列セグメント対応） |
| 2026-03-02 | 2.3 | `<patterns>`タグ追加（カスタム塗りパターン定義）、f_pat属性拡張（0:ソリッド、1:なし、2-127:パターンID） |
| 2026-03-04 | 2.4 | `<patterns>`形式改訂、`<pattern>`要素を TAD バイナリ COLORPATTERN 構造に準拠 |
| 2026-03-04 | 2.5 | `<mask>`/`<pattern>`のインライン配置形式追加、`<patterns>`ラッパーとの両形式読み込み対応 |
| 2026-03-04 | 2.6 | `<mask>` data 形式を 16bit hex ワード値カンマ区切りに変更、`<pattern>` pixelcolors 廃止、`l_pat` を線カラーパターン ID として明確化 |
| 2026-05-24 | 2.7 | `<paper>` `<docmargin>` のノド/小口概念・binding/imposition による左右反転を明文化、`<docmargin>` に 0xffff(65535)継承値を追加、`<tab-format>` height/pargap の SCALE 絶対モードと tabs<0(小数点揃え) を仕様化、用紙系単位を docScale 基準に統一 |
| 2026-05-24 | 2.8 | `<column>`(コラム指定付箋)を追加、章「11. 未実装の付箋(TODO)」を新設、章「11. 更新履歴」を「12. 更新履歴」にリナンバリング、不要な半角空白を全削除 |
| 2026-05-24 | 2.9 | `<page-number>`(ページ番号指定付箋)を 3.2 用紙設定要素に追加 (step/num 属性、 unpack.js に tsPageNumberFusen を実装)、 TODO-2 を完了マーク |
| 2026-05-25 | 2.10 | `<frame-open>`(枠あけ指定付箋、SubID 0x05)を 3.2 用紙設定要素に追加、unpack.js/tad.js に tsFrameOpenFusen を実装、旧 `<frame-aside>` 誤記を削除、TODO-1 を完了マーク |
| 2026-05-25 | 2.11 | `<font hRatio wRatio>`(文字拡大／縮小指定付箋、SubID 0x03)を 3.4 テキスト書式要素に追加、unpack.js/tad.js に tsFontScaleSetFusen を実装、 旧 11.2.4 を削除し後続繰り上げ、TODO-5 を完了マーク |
| 2026-05-25 | 2.12 | `<column>`(SubID 0x02)に balance/colline2 等を追加、 unpack.js/tad.js を ATTR=Kxxx CCCC で正しくパース、 basic-text-editor で CSS column-count 等を反映 |
| 2026-05-25 | 2.13 | `<fill-line />`(充填行指定付箋、 SubID 0x08)を 3.2 用紙設定要素に追加、 unpack.js に tsFillLineSetFusen を新規実装、 tad.js の dispatcher を新関数に切り替え、 basic-text-editor で `<div class="fl-spacer">` として min-height: 1em で描画、 旧 11.2.2 (誤った char 属性提案) を削除し後続繰り上げ、 TODO-3 を完了マーク |
| 2026-05-25 | 2.14 | `<combchar>` (結合文字開始/終了指定付箋、 SegID FFF3 SubID 0x00/0x01) を 3.4 文字装飾要素に追加、 unpack.js/tad.js の空関数を実装、 basic-text-editor で span.combchar として描画 |
| 2026-05-25 | 2.15 | `<fill-char str="..." />` (充塡文字指定付箋、 SegID FFA3 SubID 0x01) を 3.4 文字装飾要素に追加、 unpack.js に tsFillCharSetFusen を新規実装、 tad.js の既存 tsFillCharFusen に XML 出力追加と複数文字対応、 basic-text-editor で span.fill-char (flex-grow + ::after) として描画、 旧 11.2.4 を削除し後続繰り上げ、 TODO-7 を完了マーク |
| 2026-05-25 | 2.16 | `<freefig>` (任意図形セグメント、 SegID FFB0 SubID 0x0B) を 4.3 図形要素に追加、 unpack.js/tad.js に tsFigFreefigDraw を新規実装、 basic-figure-editor の figure-xml-parser.js に parseFreefigElement を追加、 editor.js に Canvas fillRect 描画ロジックを追加、 figure-xml-serializer.js で <freefig> 出力対応 |
| 2026-05-28 | 2.17 | `<char-layout kind width>` (文字割付け、 SegID FFA4 SubID 0x02/0x03) を 3.4 に追加、 旧 11.2.5 を削除、 TODO-9 を完了マーク |
| 2026-05-29 | 2.18 | Phase 1: bouten, fixed-space, page-number editor support, docmemo editor support, font extra attrs (style/weight/stretch/stretchscale/direction/kerning/pattern) round-trip |
| 2026-05-30 | 2.19 | Phase 2: <field-format> (FFA1 SubID 0x03) full impl, <text direction> 3-valued (0/1/2) impl with editor CSS writing-mode/direction, <docoverlay> editor round-trip; Phase 3 spec-only entries added to 11.2 (font rotation, font baseline, varref, docappl) |
| 2026-05-30 | 2.20 | Figure TAD Phase 1: figpagenumber (FFB5 SubID 0x06) impl, figmodifier (FFB4 SubID 0x00) xmlBuffer output release (TODO-10 complete), figoverlay/figpagenumber/figmemo round-trip preserve in basic-figure-editor, figmodifier/transform per-shape round-trip preserve |
| 2026-06-03 | 2.21 | Figure TAD Phase 1-2: 図形要素 12 種 (rect/ellipse/line/polyline/curve/polygon/arc/chord/elliptical_arc/freefig/marker) に mode 属性 (描画モード ATTR) のラウンドトリップ追加、 `<rect>` に figRH/figRV 個別属性出力 (非対称角丸めラウンドトリップ、 rh/rv 準拠)、 `<arc>` を「扇形」、 `<elliptical_arc>` を「楕円弧」 に命名整理 (タグ名互換維持)、 `<figmodifier>` 仕様セクションを正式化し「開いた図形のみ適用」 制約を明記、 basic-figure-editor parser で閉じた図形に対する figmodifier を console.warn してスキップ |
| 2026-06-03 | 2.22 | Text TAD 継承付箋 Phase 1-3: `<text align>`、 `<text line-height>` に「次の同種付箋まで継続」 state 継承パターン (parser + serializer 差分判定) を実装、 文字書式系 (color/font/size 等) の段落外要素跨ぎリセット問題を修正、 中間段落の `<column>` を hidden-column-change span に退避してラウンドトリップ保証、 `<line-head-kinsoku>` / `<line-tail-kinsoku>` を新規実装 (hidden span SSOT + CSS line-break/word-break 簡易近似) |
| 2026-06-03 | 2.23 | Text TAD 継承付箋 Phase 4: `<paper-overlay-define>` (用紙オーバーレイ定義付箋) を新規実装。 中身の文章 TAD データを Base64 エンコードして `paper-overlay-define-preserved` hidden span に退避することでラウンドトリップ保証。 オーバーレイの描画は未対応 (印刷プレビュー機能の充実とともに将来課題)。 親文書「次の同種付箋まで継続」 シリーズの継承仕様準拠が本フェーズで完結 |

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
- `<bagchar>`, `<tab/>`, `<tab-format/>`, `<indent/>`
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
