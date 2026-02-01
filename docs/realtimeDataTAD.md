# xmlTAD仕様書 別冊／実時間制御xmlTAD

## 1. 概要

### 1.1 実時間TADとは

実時間TAD（Realtime TAD）は、TAD仕様に時間の概念を取り込むための拡張仕様です。音楽演奏、アニメーション、マルチメディアプレゼンテーションなど、時間軸に沿ってイベントを制御する必要があるデータを記述します。

本仕様は、BTRONの「TAD詳細仕様書 別冊／実時間制御」（1989年、坂村健）に基づき、xmlTAD形式でのXML表現を定義するものです。

### 1.2 実時間データの特徴

実時間データは以下の性質を持ちます：

1. **μ秒精度の時間処理** - マイクロ秒単位での正確なタイミング制御
2. **並列処理** - 複数のデバイスを同時に制御（並列グループ）
3. **直列処理** - イベントの順次実行（直列グループ）
4. **補間機能** - イベント間のスムーズな遷移

### 1.3 応用例

| 応用分野 | データ構成 |
|---------|----------|
| 音楽演奏 | 実時間制御セグメント + 音セグメント |
| アニメーション | 実時間制御セグメント + 図形描画セグメント |
| 字幕・テロップ | 実時間制御セグメント + 文字コード |
| マルチメディア | 実時間制御セグメント + 音 + 図形 + 文字 |

### 1.4 文書タイプ

xmlTADでは実時間データ用の新しい文書タイプを定義します：

| タイプ | ルート子要素 | 用途 |
|--------|------------|------|
| 実時間TAD | `<realtime>` | 実時間制御データ |

### 1.5 文書構造のバリエーション

実時間TADは以下の3つの構造パターンで使用できます：

| パターン | 構造 | 用途 |
|---------|------|------|
| 実時間TAD単体 | `<tad><realtime>...</realtime></tad>` | 音楽演奏、純粋なアニメーション |
| 文章TAD配下 | `<tad><document><realtime>...</realtime></document></tad>` | スライド、テロップ付き映像 |
| 図形TAD配下 | `<tad><figure><realtime>...</realtime></figure></tad>` | 図形アニメーション |

#### ルートが`<realtime>`の場合の描画要素配置

`<realtime>`がルートの場合でも、タイトル文字やタイトル画像を配置できます。その場合、`<realtime>`の直下に`<figure>`を配置し、その中で描画位置を指定します。

**タイトル文字を配置する場合**:

図形TAD内の`<document>`（テキストボックス）を使用し、`<docView>`, `<docDraw>`, `<docScale>`, `<text>`で位置とスタイルを指定します。

```xml
<tad version="1.0" encoding="UTF-8">
<realtime autoplay="true">
<!-- タイトル文字用の図形セグメント（テキストボックス） -->
<figure>
<figView top="0" left="0" right="1920" bottom="1080"/>
<figDraw top="0" left="0" right="1920" bottom="1080"/>
<figScale hunit="-72" vunit="-72"/>
<document>
<docView viewleft="100" viewtop="50" viewright="700" viewbottom="100"/>
<docDraw drawleft="100" drawtop="50" drawright="700" drawbottom="100"/>
<docScale hunit="-72" vunit="-72"/>
<text lang="0" bpat="0" zIndex="100"/>
<font size="24"/>
<font face="sans-serif"/>
<font color="#FFFFFF"/>
<text align="center"/>
プレゼンテーションタイトル
</document>
</figure>

<!-- 実時間データ本体 -->
<realData>
<!-- ... -->
</realData>
</realtime>
</tad>
```

**タイトル画像を配置する場合**:

```xml
<tad version="1.0" encoding="UTF-8">
<realtime autoplay="true">
<!-- タイトル画像用の図形セグメント -->
<figure>
<figView top="0" left="0" right="1920" bottom="1080"/>
<figDraw top="0" left="0" right="1920" bottom="1080"/>
<figScale hunit="-72" vunit="-72"/>
<image href="{realId}_0_0.png"
left="100" top="50" right="500" bottom="200"
lineType="0" lineWidth="0" zIndex="100"/>
</figure>

<!-- 実時間データ本体 -->
<realData>
<!-- ... -->
</realData>
</realtime>
</tad>
```

**タイトル画像とテキストを並列配置する場合**:

`<figure>`と`<document>`を`<realtime>`直下に並列配置し、それぞれ独立したレイアウト位置を持たせることもできます。これにより、入れ子構造を避けてシンプルな構成になります。

```xml
<tad version="1.0" encoding="UTF-8">
<realtime autoplay="true">
<!-- タイトル画像（画面上部） -->
<figure>
<figView top="0" left="0" right="1920" bottom="300"/>
<figDraw top="0" left="0" right="1920" bottom="300"/>
<figScale hunit="-72" vunit="-72"/>
<image href="{realId}_0_0.png"
left="660" top="50" right="1260" bottom="250"
lineType="0" lineWidth="0" zIndex="100"/>
</figure>

<!-- タイトルテキスト（画面中央） -->
<document>
<docView viewleft="100" viewtop="350" viewright="1820" viewbottom="450"/>
<docDraw drawleft="100" drawtop="350" drawright="1820" drawbottom="450"/>
<docScale hunit="-72" vunit="-72"/>
<text lang="0" bpat="0" zIndex="90"/>
<font size="36"/>
<font face="sans-serif"/>
<font color="#FFFFFF"/>
<text align="center"/>
プレゼンテーションタイトル
</document>

<!-- サブタイトルテキスト（画面下部） -->
<document>
<docView viewleft="200" viewtop="500" viewright="1720" viewbottom="550"/>
<docDraw drawleft="200" drawtop="500" drawright="1720" drawbottom="550"/>
<docScale hunit="-72" vunit="-72"/>
<text lang="0" bpat="0" zIndex="90"/>
<font size="20"/>
<font color="#AAAAAA"/>
<text align="center"/>
～ サブタイトル ～
</document>

<!-- 実時間データ本体 -->
<realData>
<!-- ... -->
</realData>
</realtime>
</tad>
```

この構成では：

- `<figure>`: 画面上部（top=0〜300）にロゴ画像を配置
- `<document>` 1つ目: 画面中央（top=350〜450）にメインタイトルを配置
- `<document>` 2つ目: 画面下部（top=500〜550）にサブタイトルを配置

それぞれの要素が独立した描画領域を持ち、入れ子にならないためレイアウト管理がシンプルになります。

#### 文章TADがルートの場合の画像・図形配置

文章TADがルートで、その中に`<realtime>`を含み、さらにアニメーション対象の画像や図形を配置する場合は、`<realtime>`内に`<figure>`を配置します。

```xml
<tad version="1.0" encoding="UTF-8">
<document>
<paper type="doc" length="1080" width="1920"/>
<docmargin top="50" bottom="50" left="50" right="50"/>
<!-- 通常のテキストコンテンツ -->
<p>
<font size="16"/>
<font color="#000000"/>
スライド本文のテキスト
</p>

<!-- 実時間制御セクション -->
<realtime autoplay="false">
<!-- アニメーション対象の図形・画像 -->
<figure>
<figView top="0" left="0" right="800" bottom="600"/>
<figDraw top="0" left="0" right="800" bottom="600"/>
<figScale hunit="-72" vunit="-72"/>
<image id="logo" href="{realId}_0_1.png"
left="300" top="200" right="500" bottom="400"
lineType="0" lineWidth="0" zIndex="10"/>
</figure>

<!-- 実時間データ本体 -->
<realData>
<stream number="1">
<deviceName>display:</deviceName>
</stream>

<!-- 画像のフェードインアニメーション -->
<realGroup type="parallel" stream="1">
<timeDelta value="0"/>
<interpolate function="linear" divisions="30">
<imageControl ref="logo" command="setAlpha" value="0.0"/>
<imageControl ref="logo" command="setAlpha" value="1.0"/>
</interpolate>
</realGroup>
</realData>
</realtime>
</document>
</tad>
```

---

## 2. xmlTAD基本構造

### 2.1 ルート要素

```xml
<tad version="1.0" encoding="UTF-8">
<realtime autoplay="true" preload="auto">
<realData autoplay="true" startDelay="0">
<!-- ストリーム定義 -->
<stream number="1">
<deviceName>inst:Piano</deviceName>
</stream>
<!-- イベントグループ、時間設定等 -->
</realData>
</realtime>
</tad>
```

#### `<realtime>` 要素の属性

| 属性 | 説明 | デフォルト値 |
|------|------|-------------|
| autoplay | 文書読み込み時に自動再生を開始するか | "false" |
| preload | プリロード設定 | "metadata" |
| loop | 全体をループ再生するか | "false" |

**preload属性値**:

| 値 | 説明 |
|----|------|
| none | プリロードしない |
| metadata | メタデータのみ読み込む |
| auto | 全データをプリロード |

#### `<realData>` 要素の属性

| 属性 | 説明 | デフォルト値 |
|------|------|-------------|
| autoplay | このブロックを自動再生するか（親の設定を継承可） | "inherit" |
| startDelay | 再生開始までの遅延時間（単位系依存） | "0" |
| loop | このブロックをループ再生するか | "false" |
| loopCount | ループ回数（0=無限） | "0" |

### 2.2 セグメントID対応表

| セグメントタイプ | バイナリID | xmlTAD要素 |
|----------------|-----------|-----------|
| 実時間制御セグメント | 0xD0～0xDF | 各種制御要素 |
| グループセグメント | TS_RGRP (0xD0) | `<realGroup type="parallel\|serial">` |
| 時間設定セグメント | TS_RTIME (0xD1) | `<timeDelta>`, `<timeAbsolute>` |
| 分岐/繰り返しセグメント | TS_BRLP (0xD2) | `<label>`, `<jump>`, `<if>`, `<while>`, `<assign>`, `<random>` |
| 補間セグメント | TS_RGRD (0xD3) | `<interpolate>` |
| 実時間データ開始 | TS_REAL (0xEA) | `<realData>` 開始タグ |
| 実時間データ終了 | TS_REALEND (0xEB) | `</realData>` 終了タグ |
| 単位系設定付箋 | TS_SUNIT (0xEC) | `<unitSystem>` |
| 音セグメント | 0x90～0x9F | `<note>`, `<midi>`, `<pcm>` |
| メディアセグメント | TS_MEDIA (0xA0) | `<audio>`, `<video>`, `<image>` |
| メディア制御セグメント | TS_MCTL (0xB0) | `<audioControl>`, `<videoControl>`, `<imageControl>` |
| テキスト制御セグメント（TADjs拡張） | - | `<textControl>` |
| 図形制御セグメント（TADjs拡張） | - | `<shapeControl>` |

---

## 3. 実時間データコンテナ

### 3.1 `<realData>` - 実時間データコンテナ

`<realData>`要素は実時間データの開始と終了を包含するコンテナです。バイナリTADのTS_REAL (0xEA) とTS_REALEND (0xEB) に対応します。

```xml
<realData>
<!-- ストリーム定義 -->
<stream number="1">
<streamData><!-- ストリーム固有データ（Base64） --></streamData>
<deviceName>inst:Piano</deviceName>
<deviceParams>ch1,Init data</deviceParams>
</stream>
<stream number="2">
<deviceName>inst:Guitar</deviceName>
<deviceParams>ch2,Init data</deviceParams>
</stream>
<stream number="3">
<deviceName>MIDI0:</deviceName>
<deviceParams>ch3,Init data</deviceParams>
</stream>

<!-- イベントグループ、時間設定等 -->
<realGroup type="parallel" stream="1">
<!-- ... -->
</realGroup>
</realData>
```

### 3.2 `<stream>` - ストリーム定義

| 属性/子要素 | 説明 |
|-----------|------|
| number | ストリーム番号（1から開始） |
| `<streamData>` | ストリーム固有データ（バイナリはBase64エンコード） |
| `<deviceName>` | デバイス名（"inst:Piano", "MIDI0:" など） |
| `<deviceParams>` | デバイス依存パラメータ |

### 3.3 デバイス名の形式

```
デバイス名 ::= デバイスタイプ ":" パラメータ

例：
  inst:Piano        -- 楽器名指定
  MIDI0:           -- MIDIポート0
  MIDI1:           -- MIDIポート1
  Sound:           -- 内部音源
  synthX:param0=xxx,param1=yyy  -- シンセサイザー詳細指定
```

### 3.4 複数の実時間データブロック

一つの`<realtime>`文書内に複数の`<realData>`ブロックを含めることができます：

```xml
<realtime>
<realData>
<!-- 第1楽章 -->
</realData>
<realData>
<!-- 第2楽章 -->
</realData>
</realtime>
```

---

## 4. イベントグループセグメント

### 4.1 概要

イベントグループは複数のイベントをまとめて制御するための構造です。

| type属性値 | 説明 | 時間の振る舞い |
|------------|------|-------------|
| parallel | 同時に開始（並列グループ） | グループ内の時間経過は外部に影響しない |
| serial | 順番に実行（直列グループ） | グループ内の時間経過が外部の時間に影響 |

### 4.2 `<realGroup>` - イベントグループ

```xml
<!-- 並列グループ -->
<realGroup type="parallel" stream="1">
<!-- イベント列 -->
<timeDelta value="0"/>
<note pitch="C4" velocity="100" duration="480"/>
<timeDelta value="480"/>
<note pitch="E4" velocity="100" duration="480"/>
</realGroup>

<!-- 直列グループ -->
<realGroup type="serial" stream="2">
<!-- イベント列A -->
<timeDelta value="0"/>
<note pitch="G4" velocity="80" duration="960"/>
</realGroup>
<realGroup type="serial" stream="2">
<!-- イベント列B（Aの終了後に開始） -->
<timeDelta value="0"/>
<note pitch="A4" velocity="80" duration="960"/>
</realGroup>
```

| 属性 | 説明 | 値 |
|------|------|-----|
| type | グループタイプ | "parallel", "serial" |
| stream | ストリーム番号（-1で上位グループのストリームを継承） | 整数 |

**並列グループ（type="parallel"）のセマンティクス**: 
連続した並列グループは同時に起動される。グループ内の時間経過はグループ外の次のイベント発生時刻に影響しない。

**直列グループ（type="serial"）のセマンティクス**: 
直列グループはグループ内の時間経過がそのまま外部の次のイベント発生時刻を決定する。連続した直列グループは順番に起動される。

### 4.3 ネストしたイベントグループ

イベントグループは互いに入れ子にすることができます：

```xml
<realGroup type="parallel" stream="1">
<eventArray id="A0">
<!-- イベント列 -->
</eventArray>
<realGroup type="parallel" stream="2">
<eventArray id="B0">
<!-- イベント列 -->
</eventArray>
<realGroup type="parallel" stream="3">
<eventArray id="C">
<!-- イベント列 -->
</eventArray>
</realGroup>
<eventArray id="B1">
<!-- イベント列 -->
</eventArray>
</realGroup>
<eventArray id="A1">
<!-- イベント列 -->
</eventArray>
</realGroup>
<realGroup type="serial" stream="4">
<eventArray id="D">
<!-- イベント列 -->
</eventArray>
</realGroup>
<realGroup type="serial" stream="5">
<eventArray id="E">
<!-- イベント列 -->
</eventArray>
</realGroup>
```

### 4.4 `<eventArray>` - イベント列（オプション）

グループ内のイベント列に名前を付けて参照可能にする補助要素：

```xml
<eventArray id="intro">
<timeDelta value="0"/>
<note pitch="C4" velocity="100" duration="480"/>
<!-- ... -->
</eventArray>
```

| 属性 | 説明 |
|------|------|
| id | イベント列の識別子 |

---

## 5. 時間設定セグメント

### 5.1 概要

イベントとイベントの間の時間間隔を指定します。時間設定を行わない限り、イベントの発生時刻は先に進みません。

### 5.2 `<timeDelta>` - 時間送り付箋（相対時間）

```xml
<timeDelta value="480" unit="tick"/>
```

| 属性 | 説明 | 値の例 |
|------|------|--------|
| value | 時間間隔値 | "480", "1000" |
| unit | 時間単位（省略時は単位系設定に従う） | "tick", "ms", "us" |

**セマンティクス**: 直前のイベントから指定時間経過後に次のイベントを発生させる。

### 5.3 `<timeAbsolute>` - 時間経過付箋（絶対時間）

```xml
<timeAbsolute value="1920" unit="tick"/>
```

| 属性 | 説明 | 値の例 |
|------|------|--------|
| value | 絶対時間値（グループ開始からの経過時間） | "1920", "5000" |
| unit | 時間単位（省略時は単位系設定に従う） | "tick", "ms", "us" |

**セマンティクス**: 最も内側のグループ開始セグメントからの経過時間を表す。前の時刻に戻るような指定は無視される。

### 5.4 時間指定の使い分け

```xml
<!-- 相対時間による記述 -->
<realGroup type="parallel" stream="1">
<timeDelta value="0"/>
<note pitch="C4" duration="480"/>     <!-- t=0 -->
<timeDelta value="480"/>
<note pitch="D4" duration="480"/>     <!-- t=480 -->
<timeDelta value="480"/>
<note pitch="E4" duration="480"/>     <!-- t=960 -->
</realGroup>

<!-- 絶対時間による記述（同等） -->
<realGroup type="parallel" stream="1">
<timeAbsolute value="0"/>
<note pitch="C4" duration="480"/>     <!-- t=0 -->
<timeAbsolute value="480"/>
<note pitch="D4" duration="480"/>     <!-- t=480 -->
<timeAbsolute value="960"/>
<note pitch="E4" duration="480"/>     <!-- t=960 -->
</realGroup>
```

---

## 6. 分岐／繰り返しセグメント

### 6.1 概要

実時間データの分岐・繰り返しを記述するための付箋です。

| 機能 | 説明 |
|------|------|
| 変数 | 条件判断のための変数と値の設定 |
| 式評価 | 16ビット整数の算術演算、比較演算、論理演算（逆ポーランド記法） |
| IF-ELSEIF-ENDIF | 分岐構造 |
| WHILE | 繰り返し構造 |

### 6.2 式（Expression）の構文

式は逆ポーランド方式（RPN）で記述します：

```xml
<expr>
    <const value="10"/>
    <var id="0x0001"/>
    <op type="add"/>
    <const value="5"/>
    <op type="gt"/>
</expr>
```

上記は中置記法で `(10 + var[1]) > 5` を表します。

#### 式の要素

| 要素 | 属性 | 説明 |
|------|------|------|
| `<const>` | value | 定数値（WORD） |
| `<var>` | id | 変数番号（0x0001～0x3FFF: ユーザ変数、0x4000～0x7FFF: システム変数） |
| `<op>` | type | 演算子タイプ |

#### 演算子タイプ

**算術演算**:

| type | 演算 | バイナリコード |
|------|------|-------------|
| add | 加算 (+) | 0x8000 |
| sub | 減算 (-) | 0x8001 |
| mul | 乗算 (*) | 0x8002 |
| div | 除算 (/) | 0x8003 |
| mod | 剰余 (mod) | 0x8004 |

**比較演算**:

| type | 演算 | バイナリコード |
|------|------|-------------|
| lt | 小なり (<) | 0x8010 |
| gt | 大なり (>) | 0x8011 |
| le | 以下 (<=) | 0x8012 |
| ge | 以上 (>=) | 0x8013 |
| eq | 等しい (==) | 0x8014 |
| ne | 等しくない (!=) | 0x8015 |

**論理演算**:

| type | 演算 | バイナリコード |
|------|------|-------------|
| and | 論理積 (&&) | 0x8020 |
| or | 論理和 (\|\|) | 0x8021 |
| not | 論理否定 (NOT) | 0x8030 |
| neg | 符号反転 (NEG) | 0x8031 |

**ゼロ比較（単項演算子）**:

| type | 演算 | バイナリコード |
|------|------|-------------|
| lt0 | < 0 | 0x8040 |
| gt0 | > 0 | 0x8041 |
| le0 | <= 0 | 0x8042 |
| ge0 | >= 0 | 0x8043 |
| eq0 | == 0 | 0x8044 |
| ne0 | != 0 | 0x8045 |

**スタック操作**:

| type | 演算 | バイナリコード |
|------|------|-------------|
| dup | スタックトップを複製 | 0x8050 |
| swap | トップとセカンドを交換 | 0x8051 |
| pick | N番目の値をコピー | 0x8052 |

### 6.3 `<label>` - ラベル付箋

```xml
<label id="1" name="intro"/>
```

| 属性 | 説明 |
|------|------|
| id | ラベル番号（イベントグループのネスト内でユニーク） |
| name | ラベル名（オプション） |

### 6.4 `<jump>` - ジャンプ付箋

```xml
<jump target="1"/>
<jump target="start"/>  <!-- 特殊値: イベントグループの開始 -->
<jump target="end"/>    <!-- 特殊値: イベントグループの終了 -->
```

| 属性 | 説明 |
|------|------|
| target | ジャンプ先ラベル番号、"start"（0xFFFE）、"end"（0xFFFF） |

### 6.5 `<if>` - IF分岐

```xml
<if>
    <expr>
        <var id="0x0001"/>
        <const value="10"/>
        <op type="gt"/>
    </expr>
    <then>
        <!-- 条件が真の場合のイベント列 -->
    </then>
    <elseif>
        <expr>
            <var id="0x0001"/>
            <const value="5"/>
            <op type="gt"/>
        </expr>
        <then>
            <!-- 2番目の条件が真の場合のイベント列 -->
        </then>
    </elseif>
    <else>
        <!-- すべての条件が偽の場合のイベント列 -->
    </else>
</if>
```

**簡略形式**（式を省略した場合は常に真）:

```xml
<if>
    <then>
        <!-- 常に実行 -->
    </then>
</if>
```

### 6.6 `<while>` - 繰り返し

```xml
<while>
    <expr>
        <var id="0x0001"/>
        <const value="0"/>
        <op type="gt"/>
    </expr>
    <do>
        <!-- 繰り返し本体 -->
        <assign var="0x0001">
            <expr>
                <var id="0x0001"/>
                <const value="1"/>
                <op type="sub"/>
            </expr>
        </assign>
    </do>
    <endExpr>
        <!-- 終了条件式（省略時は常に真でループ継続） -->
    </endExpr>
</while>
```

| 子要素 | 説明 |
|-------|------|
| `<expr>` | ループ開始条件（省略時は常に真） |
| `<do>` | ループ本体 |
| `<endExpr>` | ループ終了時の継続条件（省略時は常に真でループ先頭へ） |

### 6.7 `<assign>` - 変数代入付箋

```xml
<assign var="0x0001">
    <expr>
        <const value="100"/>
    </expr>
</assign>
```

| 属性 | 説明 |
|------|------|
| var | 代入先変数番号（ユーザ変数のみ: 0x0001～0x3FFF） |

**注**: 変数のスコープは同一実時間データ内（実時間データ開始セグメントと終了セグメントで囲まれた範囲）です。

### 6.8 `<random>` - ランダム選択

`<random>`要素は子要素からランダムに1つを選択して実行します。プレイリストのシャッフル再生などに使用します。

```xml
<random exclude="last">
<audio id="track1" href="{realId}_0_0.mp3" trigger="manual"/>
<audio id="track2" href="{realId}_0_1.mp3" trigger="manual"/>
<audio id="track3" href="{realId}_0_2.mp3" trigger="manual"/>
</random>
```

| 属性 | 説明 | デフォルト値 |
|------|------|-------------|
| exclude | 選択から除外する要素 | "none" |

**exclude属性値**:

| 値 | 説明 |
|----|------|
| none | 除外なし（全要素から選択） |
| last | 直前に選択された要素を除外（同じ曲の連続再生を防ぐ） |

**セマンティクス**:
- `<random>`内の子要素からランダムに1つを選択
- 選択された要素のみが実行される（他の要素はスキップ）
- `<while>`と組み合わせることでシャッフル再生を実現
- 子要素には`<audio>`, `<video>`, `<realGroup>`などを含められる

**使用例**（シャッフル再生）:

```xml
<while>
<!-- 無限ループ（停止は外部制御） -->
<do>
<random exclude="last">
<audio id="track1" href="{realId}_0_0.mp3"
    autoplay="true" onended="jump:loop_end"/>
<audio id="track2" href="{realId}_0_1.mp3"
    autoplay="true" onended="jump:loop_end"/>
<audio id="track3" href="{realId}_0_2.mp3"
    autoplay="true" onended="jump:loop_end"/>
</random>
<label id="loop_end"/>
</do>
</while>
```

---

## 7. 補間セグメント

### 7.1 概要

いくつかの物理量からなるデータの集合を組として、複数のデータ間を任意の分割数で補間し、新たにデータを生成します。

### 7.2 補間の用途

| 用途 | 説明 |
|------|------|
| アニメーション | 図形の位置を補間してスムーズな動き |
| 音楽 | 音の高さ・強さを補間してポルタメント/クレッシェンド |
| 直線補間 | 点Aと点Bの間に中間点を生成 |

### 7.3 `<interpolate>` - 補間

```xml
<interpolate function="linear" divisions="3">
<!-- 補間対象のプリミティブなセグメント -->
<note pitch="C4" velocity="80" duration="120"/>
<note pitch="G4" velocity="100" duration="120"/>
</interpolate>
```

| 属性 | 説明 | 値 |
|------|------|-----|
| function | 補間関数 | "linear" (0), "spline" (1) |
| divisions | 分割数 | 正整数 |

**セマンティクス**: 
- 補間付箋で囲まれるデータは最もプリミティブなセグメントである必要がある
- 図形データでは直線セグメント、音データではノートセグメント
- グループ化したセグメントを補間対象とすることはできない
- 同種類のセグメント間のみ補間可能（例：図形同士、音同士）

### 7.4 補間の例

```xml
<!-- 音の補間（3分割） -->
<interpolate function="linear" divisions="3">
<note pitch="60" velocity="80" duration="120"/>  <!-- C4 -->
<note pitch="72" velocity="100" duration="120"/> <!-- C5 -->
</interpolate>

<!-- 実行結果イメージ -->
<!--
  元イベント P (C4, vel=80)
  補間生成   X (pitch=63, vel=85)
  補間生成   Y (pitch=66, vel=90)  
  補間生成   Z (pitch=69, vel=95)
  元イベント Q (C5, vel=100)
-->
```

### 7.5 補間終了

divisions="0" で補間区間を明示的に終了：

```xml
<interpolate function="linear" divisions="3">
<note pitch="60" velocity="80" duration="120"/>
<note pitch="72" velocity="100" duration="120"/>
</interpolate>
<interpolate divisions="0"/>  <!-- 補間終了 -->
```

---

## 8. 単位系設定セグメント

### 8.1 概要

TADセグメント内の物理量を表すフィールドには単位の情報が必要です。実時間データでは特に「時間」の単位が重要となります。

### 8.2 SI単位系

基本単位ID（0～8）：

| ID | 物理量 | 単位 | 記号 |
|----|--------|------|------|
| 0 | 長さ | メートル | m |
| 1 | 質量 | キログラム | kg |
| 2 | 時間 | 秒 | s |
| 3 | 電流 | アンペア | A |
| 4 | 温度 | ケルビン | K |
| 5 | 物質量 | モル | mol |
| 6 | 光度 | カンデラ | cd |
| 7 | 平面角 | ラジアン | rad |
| 8 | 立体角 | ステラジアン | sr |

### 8.3 `<unitSystem>` - 単位系設定

```xml
<unitSystem id="9">
<primaryUnit>
<dimension>s</dimension>
<derivation ratio="72/60" sexp="-1"/>  <!-- 四分音符 = 72/60秒 -->
</primaryUnit>
<auxiliaryUnit number="0" name="四分音符" derivation="1"/>
<auxiliaryUnit number="1" name="8分音符" derivation="1/2"/>
<auxiliaryUnit number="2" name="16分音符" derivation="1/4"/>
<auxiliaryUnit number="3" name="全音符" derivation="4"/>
<auxiliaryUnit number="4" name="2分音符" derivation="2"/>
</unitSystem>
```

| 子要素 | 説明 |
|-------|------|
| `<primaryUnit>` | 主単位の定義 |
| `<auxiliaryUnit>` | 補助単位の定義 |

#### `<primaryUnit>` 属性

| 属性/子要素 | 説明 |
|-----------|------|
| `<dimension>` | ディメンション（SI単位の組み合わせ） |
| `<derivation>` | SI単位系からの導出式 |
| ratio | 有理数比（A/B形式） |
| sexp | 秒の指数 |

### 8.4 `<unitSpec>` - 単位指定付箋

```xml
<unitSpec unitId="9" unitNumber="0"/>
```

| 属性 | 説明 |
|------|------|
| unitId | 単位系ID |
| unitNumber | 補助単位番号 |

**セマンティクス**: 指定されたディメンションに対する有効な単位を設定。この付箋以降、新たな単位指定が行われるまで有効。

### 8.5 `<unitSpecTemp>` - 一時単位指定付箋

```xml
<unitSpecTemp unitId="9" unitNumber="1"/>
<note pitch="60" duration="2"/>  <!-- この音符のみ8分音符単位 -->
```

| 属性 | 説明 |
|------|------|
| unitId | 単位系ID |
| unitNumber | 補助単位番号 |

**セマンティクス**: 直後の一つの付箋にのみ有効な単位を指定。連続する場合は次の付箋に有効。

### 8.6 `<unitScale>` - 単位縮尺付箋

```xml
<unitScale bunitId="2" texp="0" ratio="1/1000"/>
```

| 属性 | 説明 |
|------|------|
| bunitId | 基本単位ID（0:長さ, 1:質量, 2:時間, ...） |
| texp | 10のべき乗数 |
| ratio | 単位縮尺比（A/B形式） |

**音楽での応用**: テンポ変更（時間軸の縮尺）に使用。

```xml
<!-- テンポを2倍に（時間を1/2に縮尺） -->
<unitScale bunitId="2" texp="0" ratio="1/2"/>
```

### 8.7 `<absoluteUnitCoeff>` - 絶対単位係数設定付箋

四分音符のような特殊な単位のSI単位系からの係数を再設定：

```xml
<absoluteUnitCoeff unitId="9" ratioSI="60/120"/>
```

| 属性 | 説明 |
|------|------|
| unitId | 単位系ID |
| ratioSI | SI単位系からの縮尺比 |

---

## 9. メディアセグメントとの連携

### 9.1 メディアセグメントの種類

| セグメントタイプ | ID範囲 | xmlTAD要素 | 用途 |
|----------------|--------|-----------|------|
| 音セグメント | 0x90～0x9F | 各種音要素 | MIDI音源制御 |
| PCMセグメント | - | `<pcm>` | 波形データ埋め込み |
| 音声ファイル | - | `<audio>` | 外部音声ファイル参照 |
| 映像ファイル | - | `<video>` | 外部映像ファイル参照 |

### 9.1.1 埋め込みリソースのファイル命名規則

メディアファイル（音声、映像、画像）を実身に埋め込む場合、以下の命名規則に従います：

```
{realId}_{recordNo}_{resourceNo}.{ext}
```

| 要素 | 説明 | 例 |
|------|------|-----|
| realId | 実身のUUID | `019aaa4e-de25-72ad-8518-ab392b7ea301` |
| recordNo | レコード番号（xtadは0） | `0` |
| resourceNo | リソース連番（0から開始） | `0`, `1`, `2`... |
| ext | ファイル拡張子 | `mp4`, `mp3`, `png` |

**命名例**:
```
019aaa4e-de25-72ad-8518-ab392b7ea301_0_0.mp4   # 最初のリソース（映像）
019aaa4e-de25-72ad-8518-ab392b7ea301_0_1.mp3   # 2番目のリソース（音声）
019aaa4e-de25-72ad-8518-ab392b7ea301_0_2.png   # 3番目のリソース（画像）
019aaa4e-de25-72ad-8518-ab392b7ea301_0_3.wav   # 4番目のリソース（音声）
```

**重要事項**:
- リソース連番は拡張子に関係なく順に増加する
- 同一実身内で画像・音声・映像が混在していても連番は一貫して続く
- この命名規則はxmlTAD-specification.mdの`<image>`要素と共通

### 9.2 `<note>` - ノート（音符）

```xml
<note pitch="60" velocity="100" duration="480" channel="1"/>
```

| 属性 | 説明 | 値の例 |
|------|------|--------|
| pitch | 音高（MIDIノート番号または音名） | "60", "C4" |
| velocity | ベロシティ | "0"～"127" |
| duration | 音の長さ | "480" |
| channel | MIDIチャンネル（オプション） | "1"～"16" |

### 9.3 `<midi>` - MIDIメッセージ

```xml
<midi>
<message status="90" data1="60" data2="64"/>  <!-- Note On -->
<message status="B0" data1="07" data2="7F"/>  <!-- Control Change: Volume -->
</midi>
```

MIDIセグメントは原則的にMIDIメッセージをそのまま記録します。一つの`<midi>`要素に羅列されたメッセージは全て同一時刻のイベントとして処理されます。

### 9.4 `<pcm>` - PCMデータ

```xml
<pcm format="wav" sampleRate="44100" channels="2" bits="16">
<data encoding="base64">
<!-- Base64エンコードされたPCMデータ -->
</data>
</pcm>
```

または外部ファイル参照：

```xml
<pcm format="wav" href="{realId}_0_0.wav"/>
```

### 9.5 `<audio>` - 音声ファイル参照

外部音声ファイルを参照し、再生制御パラメータを指定します。

```xml
<audio id="bgm1" href="{realId}_0_0.mp3" format="mp3"
    sampleRate="44100" channels="2" bitDepth="16"
    autoplay="false" preload="auto"
    volume="0.8" pan="0.0" playbackRate="1.0"
    startTime="0" duration="0"
    loop="true" loopStart="1000" loopEnd="60000"
    fadeIn="500" fadeOut="1000"/>
```

#### 識別・参照属性

| 属性 | 説明 | デフォルト値 |
|------|------|-------------|
| id | 音声要素の識別子（制御時に参照） | - |
| href | 音声ファイルパス（必須） | - |
| format | ファイル形式 | 拡張子から推定 |

#### メタデータ属性（情報用）

| 属性 | 説明 | デフォルト値 |
|------|------|-------------|
| sampleRate | サンプリングレート（Hz） | - |
| channels | チャンネル数（1=モノラル, 2=ステレオ） | - |
| bitDepth | ビット深度（8, 16, 24, 32） | - |
| totalDuration | ファイル全体の長さ（単位系依存） | - |

#### トラック情報属性（プレイリスト用）

| 属性 | 説明 | デフォルト値 |
|------|------|-------------|
| title | トラックタイトル（UI表示用） | - |
| artist | アーティスト名 | - |
| album | アルバム名 | - |
| trackNumber | トラック番号 | - |

#### 自動再生・プリロード属性

| 属性 | 説明 | デフォルト値 |
|------|------|-------------|
| autoplay | イベント発生時に自動再生開始するか | "true" |
| preload | プリロード設定（none, metadata, auto） | "auto" |
| trigger | 再生開始トリガー | "time" |

**trigger属性値**:

| 値 | 説明 |
|----|------|
| time | 時間イベント（timeDelta/timeAbsolute）で再生開始（デフォルト） |
| manual | `<audioControl command="play">`で明示的に開始 |
| load | ファイル読み込み完了時に即座に開始 |

#### 再生制御属性

| 属性 | 説明 | デフォルト値 |
|------|------|-------------|
| volume | 音量（0.0～1.0） | "1.0" |
| pan | パン（-1.0:左 ～ 1.0:右） | "0.0" |
| playbackRate | 再生速度（1.0=等速） | "1.0" |
| startTime | ファイル内の再生開始位置（単位系依存） | "0" |
| duration | 再生長さ（0=最後まで） | "0" |
| loop | ループ再生するか | "false" |
| loopStart | ループ開始位置 | "0" |
| loopEnd | ループ終了位置（0=最後） | "0" |
| fadeIn | フェードイン時間 | "0" |
| fadeOut | フェードアウト時間 | "0" |

#### 再生完了時アクション属性

| 属性 | 説明 | デフォルト値 |
|------|------|-------------|
| onended | 再生完了時に実行するアクション | - |

**onended属性の構文**:

```
onended ::= action ":" target
action  ::= "play" | "stop" | "pause" | "next" | "jump"
target  ::= id | "first" | "last" | "next" | "random"
```

**アクション一覧**:

| アクション | 説明 | 例 |
|-----------|------|-----|
| `play:id` | 指定IDのメディアを再生開始 | `play:track2` |
| `play:next` | 次のメディア要素を再生 | `play:next` |
| `play:first` | 最初のメディア要素を再生 | `play:first` |
| `play:random` | ランダムに選択して再生 | `play:random` |
| `stop` | 再生停止 | `stop` |
| `jump:label` | 指定ラベルにジャンプ | `jump:intro` |

**注**: `onended`属性は再生完了時のアクションを明示的に指定します。`<while>`と組み合わせることでリピート再生を、`<random>`と組み合わせることでシャッフル再生を実現できます。

**対応フォーマット（推奨）**:

| format値 | 説明 |
|----------|------|
| wav | WAVEファイル（非圧縮PCM） |
| mp3 | MP3ファイル |
| ogg | Ogg Vorbisファイル |
| flac | FLACファイル（可逆圧縮） |
| aac | AACファイル |
| opus | Opusファイル |

**使用例**:

```xml
<!-- BGM再生（ループあり、フェードイン付き） -->
<realGroup type="parallel" stream="1">
<timeDelta value="0"/>
<audio id="bgm" href="{realId}_0_0.mp3" volume="0.6" loop="true" fadeIn="2000"/>
</realGroup>

<!-- 効果音再生（特定区間のみ） -->
<realGroup type="parallel" stream="2">
<timeDelta value="480"/>
<audio href="{realId}_0_1.wav" volume="1.0" startTime="100" duration="500"/>
</realGroup>

<!-- 手動再生制御の例（trigger="manual"） -->
<realGroup type="parallel" stream="1">
<timeDelta value="0"/>
<!-- 読み込みのみ行い、再生は開始しない -->
<audio id="voice" href="{realId}_0_2.mp3"
    autoplay="false" trigger="manual" preload="auto"/>
</realGroup>

<!-- 条件分岐後に手動で再生開始 -->
<realGroup type="parallel" stream="1">
<timeDelta value="5000"/>
<audioControl ref="voice" command="play"/>
</realGroup>
```

### 9.6 `<video>` - 映像ファイル参照

外部映像ファイルを参照し、配置・再生制御パラメータを指定します。画像要素`<image>`と同様の配置属性に加え、動画特有の再生制御属性を持ちます。

```xml
<video id="main_video" href="{realId}_0_0.mp4" format="mp4"
    lineType="0" lineWidth="0" l_pat="0" f_pat="0"
    left="0" top="0" right="640" bottom="480"
    angle="0" rotation="0" flipH="false" flipV="false"
    alpha="1.0" zIndex="10"
    width="1920" height="1080" frameRate="30"
    autoplay="true" preload="auto" trigger="time" poster="{realId}_0_1.jpg"
    volume="0.8" playbackRate="1.0"
    startTime="0" duration="0"
    loop="false" loopStart="0" loopEnd="0"
    muted="false" audioTrack="0"/>
```

#### 識別・参照属性

| 属性 | 説明 | デフォルト値 |
|------|------|-------------|
| id | 映像要素の識別子（制御時に参照） | - |
| href | 映像ファイルパス（必須） | - |
| format | ファイル形式 | 拡張子から推定 |

#### 配置属性（`<image>`と共通）

| 属性 | 説明 | デフォルト値 |
|------|------|-------------|
| left | 表示領域の左端座標 | "0" |
| top | 表示領域の上端座標 | "0" |
| right | 表示領域の右端座標 | - |
| bottom | 表示領域の下端座標 | - |
| zIndex | 重ね合わせ順序 | "0" |
| rotation | 回転角度（度） | "0" |
| angle | 傾斜角度（度） | "0" |
| flipH | 水平反転 | "false" |
| flipV | 垂直反転 | "false" |
| alpha | 不透明度（0.0～1.0） | "1.0" |

#### 境界線属性（`<image>`と共通）

| 属性 | 説明 | デフォルト値 |
|------|------|-------------|
| lineType | 線種（0=なし, 1=実線, 2=破線...） | "0" |
| lineWidth | 線幅（ピクセル） | "0" |
| l_pat | 線パターン | "0" |
| f_pat | 塗りパターン | "0" |

#### メタデータ属性（情報用）

| 属性 | 説明 | デフォルト値 |
|------|------|-------------|
| width | 元映像の幅（ピクセル） | - |
| height | 元映像の高さ（ピクセル） | - |
| frameRate | フレームレート（fps） | - |
| totalDuration | ファイル全体の長さ（単位系依存） | - |
| videoCodec | 映像コーデック（情報用） | - |
| audioCodec | 音声コーデック（情報用） | - |

#### トラック情報属性（プレイリスト用）

| 属性 | 説明 | デフォルト値 |
|------|------|-------------|
| title | トラックタイトル（UI表示用） | - |
| artist | アーティスト名/制作者 | - |
| album | アルバム名/シリーズ名 | - |
| trackNumber | トラック番号 | - |

#### 自動再生・プリロード属性

| 属性 | 説明 | デフォルト値 |
|------|------|-------------|
| autoplay | イベント発生時に自動再生開始するか | "true" |
| preload | プリロード設定（none, metadata, auto） | "auto" |
| trigger | 再生開始トリガー | "time" |
| poster | 再生前に表示するサムネイル画像のパス | - |

**trigger属性値**:

| 値 | 説明 |
|----|------|
| time | 時間イベント（timeDelta/timeAbsolute）で再生開始（デフォルト） |
| manual | `<videoControl command="play">`で明示的に開始 |
| load | ファイル読み込み完了時に即座に開始 |
| visible | 表示領域が可視になった時に開始 |

#### 再生制御属性

| 属性 | 説明 | デフォルト値 |
|------|------|-------------|
| volume | 音声音量（0.0～1.0） | "1.0" |
| playbackRate | 再生速度（1.0=等速） | "1.0" |
| startTime | ファイル内の再生開始位置 | "0" |
| duration | 再生長さ（0=最後まで） | "0" |
| loop | ループ再生するか | "false" |
| loopStart | ループ開始位置 | "0" |
| loopEnd | ループ終了位置（0=最後） | "0" |
| muted | 音声をミュートするか | "false" |
| audioTrack | 音声トラック番号（複数トラック時） | "0" |

#### 再生完了時アクション属性

| 属性 | 説明 | デフォルト値 |
|------|------|-------------|
| onended | 再生完了時に実行するアクション | - |

`onended`属性の構文は`<audio>`要素と同一です。詳細は「9.5 `<audio>` - 音声ファイル参照」の「再生完了時アクション属性」を参照してください。

**対応フォーマット（推奨）**:

| format値 | 説明 |
|----------|------|
| mp4 | MP4ファイル（H.264/H.265） |
| webm | WebMファイル（VP8/VP9/AV1） |
| mov | QuickTimeファイル |
| avi | AVIファイル |
| mkv | Matroskaファイル |

**使用例**:

```xml
<!-- 背景動画（ループ、音声ミュート） -->
<realGroup type="parallel" stream="1">
<timeDelta value="0"/>
<video id="bg" href="{realId}_0_0.mp4"
    left="0" top="0" right="1920" bottom="1080"
    loop="true" muted="true" zIndex="0"/>
</realGroup>

<!-- オーバーレイ動画（半透明、回転、境界線付き） -->
<realGroup type="parallel" stream="2">
<timeDelta value="960"/>
<video id="effect1" href="{realId}_0_1.webm"
    lineType="1" lineWidth="2"
    left="100" top="100" right="300" bottom="300"
    alpha="0.7" rotation="45" zIndex="10"/>
</realGroup>
```

### 9.7 `<image>` - 静止画参照（実時間制御での使用）

図形TADで定義された`<image>`要素を実時間制御内で使用する場合：

```xml
<image href="{realId}_0_0.png"
    left="100" top="200" right="200" bottom="300"
    rotation="0" flipH="false" flipV="false"
    alpha="1.0" zIndex="5"/>
```

実時間制御内では、`<interpolate>`と組み合わせてアニメーション効果を実現できます：

```xml
<!-- 画像の移動アニメーション -->
<interpolate function="linear" divisions="30">
<image href="{realId}_0_0.png"
    left="0" top="100" right="50" bottom="150" zIndex="1"/>
<image href="{realId}_0_0.png"
    left="400" top="100" right="450" bottom="150" zIndex="1"/>
</interpolate>

<!-- 画像のフェードイン -->
<interpolate function="linear" divisions="20">
<image href="{realId}_0_1.png"
    left="100" top="50" right="500" bottom="150"
    alpha="0.0" zIndex="10"/>
<image href="{realId}_0_1.png"
    left="100" top="50" right="500" bottom="150"
    alpha="1.0" zIndex="10"/>
</interpolate>
```

### 9.8 `<audioControl>` - 音声制御コマンド

再生中の音声を動的に制御します。`id`属性で対象の`<audio>`要素を指定します。

```xml
<audioControl ref="bgm1" command="setVolume" value="0.5"/>
<audioControl ref="bgm1" command="setPan" value="-0.5"/>
<audioControl ref="bgm1" command="setPlaybackRate" value="1.2"/>
<audioControl ref="bgm1" command="pause"/>
<audioControl ref="bgm1" command="resume"/>
<audioControl ref="bgm1" command="stop"/>
<audioControl ref="bgm1" command="seek" value="30000"/>
```

| 属性 | 説明 |
|------|------|
| ref | 制御対象の`<audio>`要素のid（必須） |
| command | 制御コマンド（必須） |
| value | コマンドパラメータ（コマンドによる） |
| duration | 変化にかける時間（補間用） |

**コマンド一覧**:

| command値 | 説明 | value |
|-----------|------|-------|
| play | 再生開始（trigger="manual"時に使用） | - |
| setVolume | 音量変更 | 0.0～1.0 |
| setPan | パン変更 | -1.0～1.0 |
| setPlaybackRate | 再生速度変更 | 0.1～4.0 |
| pause | 一時停止 | - |
| resume | 再開 | - |
| stop | 停止 | - |
| seek | シーク | 再生位置（単位系依存） |
| fadeIn | フェードイン開始 | フェード時間 |
| fadeOut | フェードアウト開始 | フェード時間 |

**使用例**:

```xml
<!-- BGM開始 -->
<realGroup type="parallel" stream="1">
<timeDelta value="0"/>
<audio id="bgm" href="{realId}_0_0.mp3" volume="0.8" loop="true"/>
</realGroup>

<!-- 5秒後にボリュームを徐々に下げる -->
<realGroup type="parallel" stream="1">
<timeDelta value="5000"/>
<audioControl ref="bgm" command="setVolume" value="0.3" duration="2000"/>
</realGroup>

<!-- 10秒後にフェードアウトして停止 -->
<realGroup type="parallel" stream="1">
<timeDelta value="10000"/>
<audioControl ref="bgm" command="fadeOut" value="3000"/>
</realGroup>
```

### 9.9 `<videoControl>` - 映像制御コマンド

再生中の映像を動的に制御します。`id`属性で対象の`<video>`要素を指定します。

```xml
<videoControl ref="main_video" command="setVolume" value="0.5"/>
<videoControl ref="main_video" command="setAlpha" value="0.7"/>
<videoControl ref="main_video" command="setPosition" left="100" top="100" right="500" bottom="400"/>
<videoControl ref="main_video" command="pause"/>
<videoControl ref="main_video" command="resume"/>
<videoControl ref="main_video" command="stop"/>
<videoControl ref="main_video" command="seek" value="15000"/>
```

| 属性 | 説明 |
|------|------|
| ref | 制御対象の`<video>`要素のid（必須） |
| command | 制御コマンド（必須） |
| value | コマンドパラメータ（コマンドによる） |
| duration | 変化にかける時間（補間用） |
| left, top, right, bottom | 位置指定（setPosition用） |

**コマンド一覧**:

| command値 | 説明 | value/属性 |
|-----------|------|------------|
| play | 再生開始（trigger="manual"時に使用） | - |
| setVolume | 音声音量変更 | 0.0～1.0 |
| setAlpha | 不透明度変更 | 0.0～1.0 |
| setPlaybackRate | 再生速度変更 | 0.1～4.0 |
| setPosition | 位置変更 | left, top, right, bottom |
| setRotation | 回転角度変更 | 角度（度） |
| setZIndex | 重ね順変更 | 整数 |
| pause | 一時停止 | - |
| resume | 再開 | - |
| stop | 停止 | - |
| seek | シーク | 再生位置（単位系依存） |
| mute | ミュート | - |
| unmute | ミュート解除 | - |
| hide | 非表示 | - |
| show | 表示 | - |

**使用例**:

```xml
<!-- 動画開始 -->
<realGroup type="parallel" stream="2">
<timeDelta value="0"/>
<video id="clip1" href="{realId}_0_0.mp4"
    left="0" top="0" right="1920" bottom="1080" zIndex="1"/>
</realGroup>

<!-- 3秒後に動画を縮小移動（補間付き） -->
<realGroup type="parallel" stream="2">
<timeDelta value="3000"/>
<videoControl ref="clip1" command="setPosition"
    left="50" top="50" right="450" bottom="300" duration="1000"/>
</realGroup>

<!-- 5秒後にフェードアウト -->
<realGroup type="parallel" stream="2">
<timeDelta value="5000"/>
<videoControl ref="clip1" command="setAlpha" value="0.0" duration="500"/>
</realGroup>
```

### 9.10 `<imageControl>` - 画像制御コマンド

表示中の画像を動的に制御します。`<interpolate>`の代替として、命令的な制御が可能です。

```xml
<imageControl ref="sprite1" command="setPosition" left="200" top="150" right="300" bottom="250"/>
<imageControl ref="sprite1" command="setAlpha" value="0.5"/>
<imageControl ref="sprite1" command="setRotation" value="90"/>
<imageControl ref="sprite1" command="hide"/>
<imageControl ref="sprite1" command="show"/>
```

| 属性 | 説明 |
|------|------|
| ref | 制御対象の`<image>`要素のid（必須） |
| command | 制御コマンド（必須） |
| value | コマンドパラメータ（コマンドによる） |
| duration | 変化にかける時間（補間用） |

**コマンド一覧**:

| command値 | 説明 | value/属性 |
|-----------|------|------------|
| setAlpha | 不透明度変更 | 0.0～1.0 |
| setPosition | 位置変更 | left, top, right, bottom |
| setRotation | 回転角度変更 | 角度（度） |
| setZIndex | 重ね順変更 | 整数 |
| hide | 非表示 | - |
| show | 表示 | - |
| replace | 画像差し替え | href属性で新しい画像指定 |

### 9.11 `<textControl>` - テキスト制御コマンド（TADjs拡張）

> **注**: この要素はTADjs独自の拡張仕様です。

表示中のテキスト要素（`<document>`内の`<text>`要素）を動的に制御します。

```xml
<textControl ref="mainTitle" command="setAlpha" value="0.5"/>
<textControl ref="mainTitle" command="setScale" value="1.5"/>
<textControl ref="mainTitle" command="setRotation" value="45"/>
<textControl ref="mainTitle" command="hide"/>
<textControl ref="mainTitle" command="show"/>
```

| 属性 | 説明 |
|------|------|
| ref | 制御対象の`<text>`要素のid（必須） |
| command | 制御コマンド（必須） |
| value | コマンドパラメータ（コマンドによる） |
| duration | 変化にかける時間（補間用） |

**コマンド一覧**:

| command値 | 説明 | value/属性 |
|-----------|------|------------|
| setAlpha | 不透明度変更 | 0.0～1.0 |
| setScale | 拡大縮小 | スケール値（1.0が等倍） |
| setRotation | 回転角度変更 | 角度（度） |
| setPositionX | X座標変更 | ピクセル値 |
| setPositionY | Y座標変更 | ピクセル値 |
| hide | 非表示 | - |
| show | 表示 | - |

**interpolateとの組み合わせ**:

```xml
<interpolate function="linear" divisions="30">
<textControl ref="mainTitle" command="setAlpha" value="0.0"/>
<textControl ref="mainTitle" command="setAlpha" value="1.0"/>
</interpolate>
```

### 9.12 `<shapeControl>` - 図形制御コマンド（TADjs拡張）

> **注**: この要素はTADjs独自の拡張仕様です。

表示中の図形要素（`<figure>`内の`<rect>`, `<ellipse>`, `<line>`等）を動的に制御します。

```xml
<shapeControl ref="box1" command="setAlpha" value="0.5"/>
<shapeControl ref="box1" command="setScale" value="2.0"/>
<shapeControl ref="box1" command="setRotation" value="90"/>
<shapeControl ref="box1" command="hide"/>
<shapeControl ref="box1" command="show"/>
```

| 属性 | 説明 |
|------|------|
| ref | 制御対象の図形要素のid（必須） |
| command | 制御コマンド（必須） |
| value | コマンドパラメータ（コマンドによる） |
| duration | 変化にかける時間（補間用） |

**コマンド一覧**:

| command値 | 説明 | value/属性 |
|-----------|------|------------|
| setAlpha | 不透明度変更 | 0.0～1.0 |
| setScale | 拡大縮小 | スケール値（1.0が等倍） |
| setRotation | 回転角度変更 | 角度（度） |
| setPositionX | X座標変更 | ピクセル値 |
| setPositionY | Y座標変更 | ピクセル値 |
| hide | 非表示 | - |
| show | 表示 | - |

**interpolateとの組み合わせ**:

```xml
<interpolate function="easeInOut" divisions="20">
<shapeControl ref="box1" command="setScale" value="1.0"/>
<shapeControl ref="box1" command="setScale" value="2.0"/>
</interpolate>
```

### 9.13 `<wait>` - イベント待機（TADjs拡張）

> **注**: この要素はTADjs独自の拡張仕様です。

`<wait>`要素は、メディアの終了やユーザー操作などのイベントを待機します。`<timeDelta>`による時間ベースの制御とは異なり、イベントドリブンな制御を可能にします。

```xml
<wait ref="video1" event="ended"/>
<wait ref="bgm" event="timeupdate" time="30000"/>
<wait event="click" target="button1"/>
<wait event="any" refs="track1,track2,track3"/>
```

| 属性 | 説明 | デフォルト値 |
|------|------|-------------|
| ref | 待機対象のメディア/要素のid | - |
| refs | 複数のメディア/要素のid（カンマ区切り） | - |
| event | 待機するイベントタイプ（必須） | - |
| time | 時間ベースのイベント時に指定する時刻（単位系依存） | - |
| target | ユーザー入力イベントの対象要素 | - |
| timeout | タイムアウト時間（0=無制限） | "0" |

**event属性値（メディア関連）**:

| event値 | 説明 |
|---------|------|
| ended | 再生終了 |
| pause | 一時停止 |
| playing | 再生開始 |
| timeupdate | 指定時刻到達（time属性と併用） |
| canplay | 再生可能状態 |
| loaded | 読み込み完了 |

**event属性値（ユーザー入力）**:

| event値 | 説明 |
|---------|------|
| click | クリック/タップ |
| dblclick | ダブルクリック |
| keydown | キー押下 |
| keyup | キー解放 |

**event属性値（複合条件）**:

| event値 | 説明 |
|---------|------|
| any | refs内のいずれかのメディアがendedになったら継続 |
| all | refs内のすべてのメディアがendedになったら継続 |

**使用例**:

```xml
<!-- 動画終了を待ってから次のアクションを実行 -->
<realGroup type="serial" stream="1">
    <timeDelta value="0"/>
    <video id="intro" href="{realId}_0_0.mp4" autoplay="true"/>
    <wait ref="intro" event="ended"/>
    <timeDelta value="0"/>
    <video id="main" href="{realId}_0_1.mp4" autoplay="true"/>
</realGroup>

<!-- クリックを待ってから再生開始 -->
<realGroup type="serial" stream="1">
    <timeDelta value="0"/>
    <wait event="click"/>
    <audioControl ref="bgm" command="play"/>
</realGroup>

<!-- 複数トラックのいずれかが終了したら次へ -->
<realGroup type="serial" stream="1">
    <random exclude="last">
        <audio id="t1" href="{realId}_0_0.mp3" autoplay="true"/>
        <audio id="t2" href="{realId}_0_1.mp3" autoplay="true"/>
        <audio id="t3" href="{realId}_0_2.mp3" autoplay="true"/>
    </random>
    <wait event="any" refs="t1,t2,t3"/>
    <jump target="loop_start"/>
</realGroup>
```

### 9.14 `<keyframes>` - キーフレームアニメーション（TADjs拡張）

> **注**: この要素はTADjs独自の拡張仕様です。

`<keyframes>`要素は、複数のキーフレームを定義して柔軟なアニメーションを実現します。`<interpolate>`が2点間の補間であるのに対し、`<keyframes>`は複数の中間点を経由するアニメーションが可能です。

```xml
<keyframes ref="sprite1" property="left" duration="3000" function="easeInOut">
    <keyframe offset="0%" value="0"/>
    <keyframe offset="25%" value="200"/>
    <keyframe offset="50%" value="150"/>
    <keyframe offset="100%" value="400"/>
</keyframes>
```

#### `<keyframes>` 要素の属性

| 属性 | 説明 | デフォルト値 |
|------|------|-------------|
| ref | アニメーション対象の要素id（必須） | - |
| property | アニメーションするプロパティ（必須） | - |
| duration | アニメーション全体の時間（単位系依存、必須） | - |
| function | デフォルトの補間関数 | "linear" |
| iterations | 繰り返し回数（0=無限） | "1" |
| direction | 再生方向 | "normal" |
| fill | 終了後の状態 | "forwards" |

**property属性値**:

| property値 | 説明 |
|------------|------|
| left | X座標 |
| top | Y座標 |
| right | 右端X座標 |
| bottom | 下端Y座標 |
| alpha | 不透明度 |
| scale | 拡大率 |
| scaleX | 水平拡大率 |
| scaleY | 垂直拡大率 |
| rotation | 回転角度（度） |
| volume | 音量（audio/video用） |

**direction属性値**:

| direction値 | 説明 |
|-------------|------|
| normal | 順方向再生 |
| reverse | 逆方向再生 |
| alternate | 往復再生 |
| alternate-reverse | 逆方向から往復再生 |

**fill属性値**:

| fill値 | 説明 |
|--------|------|
| none | アニメーション終了後、元の状態に戻る |
| forwards | 最終キーフレームの状態を維持 |
| backwards | 開始前に最初のキーフレームの状態を適用 |
| both | forwards + backwards |

#### `<keyframe>` 子要素の属性

| 属性 | 説明 | デフォルト値 |
|------|------|-------------|
| offset | アニメーション内での位置（0%～100%、または0.0～1.0） | - |
| value | その時点でのプロパティ値（必須） | - |
| function | このキーフレームへの補間関数 | 親のfunction |

**function属性値**:

| function値 | 説明 |
|------------|------|
| linear | 線形補間 |
| easeIn | 加速（開始が遅い） |
| easeOut | 減速（終了が遅い） |
| easeInOut | 加速→減速 |
| step-start | ステップ開始（即座に変化） |
| step-end | ステップ終了（最後に変化） |
| cubic-bezier(x1,y1,x2,y2) | ベジェ曲線による補間 |

**使用例**:

```xml
<!-- バウンドアニメーション -->
<keyframes ref="ball" property="top" duration="1000" function="easeOut" iterations="0" direction="alternate">
    <keyframe offset="0%" value="0"/>
    <keyframe offset="100%" value="300" function="easeIn"/>
</keyframes>

<!-- 複雑なパス移動（複数プロパティ） -->
<realGroup type="parallel" stream="1">
    <timeDelta value="0"/>
    <keyframes ref="icon" property="left" duration="2000">
        <keyframe offset="0%" value="100"/>
        <keyframe offset="33%" value="300"/>
        <keyframe offset="66%" value="200"/>
        <keyframe offset="100%" value="400"/>
    </keyframes>
    <keyframes ref="icon" property="top" duration="2000">
        <keyframe offset="0%" value="100"/>
        <keyframe offset="50%" value="300"/>
        <keyframe offset="100%" value="100"/>
    </keyframes>
    <keyframes ref="icon" property="alpha" duration="2000">
        <keyframe offset="0%" value="0"/>
        <keyframe offset="20%" value="1"/>
        <keyframe offset="80%" value="1"/>
        <keyframe offset="100%" value="0"/>
    </keyframes>
</realGroup>

<!-- ベジェ曲線による滑らかなフェードイン -->
<keyframes ref="title" property="alpha" duration="500">
    <keyframe offset="0%" value="0"/>
    <keyframe offset="100%" value="1" function="cubic-bezier(0.4,0,0.2,1)"/>
</keyframes>
```

### 9.15 `<trigger>` - 入力トリガー（TADjs拡張）

> **注**: この要素はTADjs独自の拡張仕様です。

`<trigger>`要素は、ユーザー入力やシステムイベントに応じてアクションを実行します。宣言的なイベントハンドリングを可能にします。

```xml
<trigger event="click" target="playButton">
    <audioControl ref="bgm" command="play"/>
</trigger>
```

| 属性 | 説明 | デフォルト値 |
|------|------|-------------|
| event | トリガーとなるイベントタイプ（必須） | - |
| target | イベント対象の要素id（省略時は全体） | - |
| key | keydown/keyup時のキーコード | - |
| once | 一度だけ発火するか | "false" |
| enabled | トリガーが有効か | "true" |
| id | トリガー自体のid（後から制御用） | - |

**event属性値**:

| event値 | 説明 |
|---------|------|
| click | クリック/タップ |
| dblclick | ダブルクリック |
| mouseenter | マウスオーバー開始 |
| mouseleave | マウスオーバー終了 |
| keydown | キー押下 |
| keyup | キー解放 |
| swipeleft | 左スワイプ |
| swiperight | 右スワイプ |
| swipeup | 上スワイプ |
| swipedown | 下スワイプ |
| resize | ウィンドウリサイズ |
| visibility | 表示状態変更 |

**key属性値**（keydown/keyup時）:

| key値 | 説明 |
|-------|------|
| Space | スペースキー |
| Enter | Enterキー |
| Escape | Escapeキー |
| ArrowLeft | 左矢印 |
| ArrowRight | 右矢印 |
| ArrowUp | 上矢印 |
| ArrowDown | 下矢印 |
| a-z, 0-9 | 各文字キー |

**使用例**:

```xml
<!-- クリックで再生/一時停止をトグル -->
<trigger event="click" target="video1">
    <if>
        <expr>
            <var id="0x0001"/>
            <op type="eq0"/>
        </expr>
        <then>
            <videoControl ref="video1" command="pause"/>
            <assign var="0x0001"><expr><const value="1"/></expr></assign>
        </then>
        <else>
            <videoControl ref="video1" command="play"/>
            <assign var="0x0001"><expr><const value="0"/></expr></assign>
        </else>
    </if>
</trigger>

<!-- スペースキーで次のスライドへ -->
<trigger event="keydown" key="Space" once="false">
    <jump target="next_slide"/>
</trigger>

<!-- 矢印キーでナビゲーション -->
<trigger event="keydown" key="ArrowRight">
    <jump target="next_slide"/>
</trigger>
<trigger event="keydown" key="ArrowLeft">
    <jump target="prev_slide"/>
</trigger>

<!-- マウスオーバーでハイライト -->
<trigger event="mouseenter" target="menuItem1">
    <shapeControl ref="menuItem1" command="setAlpha" value="1.0"/>
</trigger>
<trigger event="mouseleave" target="menuItem1">
    <shapeControl ref="menuItem1" command="setAlpha" value="0.7"/>
</trigger>

<!-- スワイプでスライド切り替え -->
<trigger event="swipeleft">
    <jump target="next_slide"/>
</trigger>
<trigger event="swiperight">
    <jump target="prev_slide"/>
</trigger>
```

#### `<triggerControl>` - トリガー制御コマンド

実行中にトリガーの有効/無効を切り替えます。

```xml
<triggerControl ref="swipe_trigger" command="disable"/>
<triggerControl ref="swipe_trigger" command="enable"/>
```

| 属性 | 説明 |
|------|------|
| ref | 対象トリガーのid |
| command | enable, disable |

### 9.16 `<onerror>` / `<fallback>` - エラーハンドリング（TADjs拡張）

> **注**: この要素はTADjs独自の拡張仕様です。

メディア読み込み失敗やタイムアウトに対応するためのエラーハンドリング機構です。

#### `<fallback>` - 代替リソース

メディア要素の子要素として、読み込み失敗時の代替リソースを指定します。

```xml
<video id="main" href="{realId}_0_0.mp4" format="mp4">
    <fallback href="{realId}_0_0_low.mp4" format="mp4"/>
    <fallback href="{realId}_0_0.webm" format="webm"/>
</video>
```

| 属性 | 説明 |
|------|------|
| href | 代替リソースのパス（必須） |
| format | ファイル形式 |
| condition | 適用条件（省略時はエラー時） |

**condition属性値**:

| condition値 | 説明 |
|-------------|------|
| error | 読み込みエラー時（デフォルト） |
| timeout | タイムアウト時 |
| slow | 低速接続検出時 |
| unsupported | フォーマット非対応時 |

#### `<onerror>` - エラーハンドラ

メディア要素の子要素として、エラー発生時のアクションを定義します。

```xml
<audio id="bgm" href="{realId}_0_0.mp3">
    <onerror>
        <imageControl ref="error_icon" command="show"/>
        <jump target="error_label"/>
    </onerror>
</audio>
```

| 属性 | 説明 | デフォルト値 |
|------|------|-------------|
| type | 対象エラータイプ（カンマ区切りで複数可） | "all" |
| retry | リトライ回数 | "0" |
| retryDelay | リトライ間隔（単位系依存） | "1000" |

**type属性値**:

| type値 | 説明 |
|--------|------|
| all | すべてのエラー |
| network | ネットワークエラー |
| decode | デコードエラー |
| notfound | ファイル未発見 |
| timeout | タイムアウト |
| aborted | 中断 |

**使用例**:

```xml
<!-- 代替リソースとエラーハンドラの組み合わせ -->
<video id="main_video" href="{realId}_0_0.mp4" format="mp4"
       timeout="10000" preload="auto">
    <!-- 高画質が失敗したら低画質へ -->
    <fallback href="{realId}_0_0_720p.mp4" format="mp4" condition="slow"/>
    <fallback href="{realId}_0_0_480p.mp4" format="mp4" condition="error"/>
    <!-- すべての代替も失敗した場合 -->
    <onerror retry="2" retryDelay="2000">
        <imageControl ref="error_placeholder" command="show"/>
        <textControl ref="error_message" command="show"/>
    </onerror>
</video>

<!-- 音声ファイルの段階的フォールバック -->
<audio id="bgm" href="{realId}_0_0.flac" format="flac">
    <fallback href="{realId}_0_0.mp3" format="mp3" condition="unsupported"/>
    <fallback href="{realId}_0_0.ogg" format="ogg" condition="unsupported"/>
    <onerror type="notfound,network">
        <assign var="0x0010"><expr><const value="1"/></expr></assign>
        <jump target="no_audio_mode"/>
    </onerror>
</audio>
```

#### グローバルエラーハンドラ

`<realData>`の子要素として、全体のデフォルトエラーハンドラを定義できます。

```xml
<realData>
    <onerror type="network">
        <imageControl ref="network_error" command="show"/>
        <audioControl ref="all" command="pause"/>
    </onerror>

    <!-- 通常のメディア定義 -->
    <audio id="bgm" href="..."/>
    <video id="main" href="..."/>
</realData>
```

### 9.17 `<groupControl>` - グループ制御（TADjs拡張）

> **注**: この要素はTADjs独自の拡張仕様です。

`<groupControl>`要素は、id属性を持つ`<realGroup>`を後から動的に制御します。

```xml
<!-- グループ定義 -->
<realGroup id="intro_animation" type="parallel" stream="1">
    <!-- アニメーション内容 -->
</realGroup>

<!-- 後から制御 -->
<groupControl ref="intro_animation" command="pause"/>
<groupControl ref="intro_animation" command="resume"/>
```

| 属性 | 説明 |
|------|------|
| ref | 制御対象の`<realGroup>`のid（必須） |
| command | 制御コマンド（必須） |
| value | コマンドパラメータ |
| duration | 変化にかける時間 |

**command属性値**:

| command値 | 説明 | value |
|-----------|------|-------|
| play | グループ内のイベント実行を開始 | - |
| pause | グループ内のイベント実行を一時停止 | - |
| resume | グループ内のイベント実行を再開 | - |
| stop | グループ内のイベント実行を停止（先頭に戻る） | - |
| restart | グループを最初から再実行 | - |
| setSpeed | グループ内の時間経過速度を変更 | 速度倍率（1.0=等速） |
| seek | グループ内の特定時刻へジャンプ | 時刻（単位系依存） |
| reverse | グループの再生方向を反転 | - |

**使用例**:

```xml
<!-- 名前付きグループの定義 -->
<realGroup id="background_animation" type="parallel" stream="1">
    <timeDelta value="0"/>
    <interpolate function="linear" divisions="100">
        <imageControl ref="bg1" command="setAlpha" value="1.0"/>
        <imageControl ref="bg1" command="setAlpha" value="0.0"/>
    </interpolate>
</realGroup>

<realGroup id="title_animation" type="parallel" stream="1">
    <timeDelta value="0"/>
    <keyframes ref="title" property="alpha" duration="2000">
        <keyframe offset="0%" value="0"/>
        <keyframe offset="100%" value="1"/>
    </keyframes>
</realGroup>

<!-- ユーザー操作で制御 -->
<trigger event="keydown" key="Escape">
    <groupControl ref="background_animation" command="pause"/>
    <groupControl ref="title_animation" command="pause"/>
</trigger>

<trigger event="keydown" key="Space">
    <groupControl ref="background_animation" command="resume"/>
    <groupControl ref="title_animation" command="resume"/>
</trigger>

<!-- 再生速度の動的変更 -->
<trigger event="keydown" key="ArrowUp">
    <groupControl ref="background_animation" command="setSpeed" value="2.0"/>
</trigger>

<trigger event="keydown" key="ArrowDown">
    <groupControl ref="background_animation" command="setSpeed" value="0.5"/>
</trigger>

<!-- 条件付きでグループ再開 -->
<if>
    <expr>
        <var id="0x0001"/>
        <const value="5"/>
        <op type="gt"/>
    </expr>
    <then>
        <groupControl ref="bonus_animation" command="play"/>
    </then>
</if>
```

### 9.18 メディア同期の例

音声・映像・画像を同期させた複合メディア再生：

```xml
<realData>
<stream number="1">
<deviceName>audio:</deviceName>
</stream>
<stream number="2">
<deviceName>display:</deviceName>
</stream>

<!-- BGM開始 -->
<realGroup type="parallel" stream="1">
<timeDelta value="0"/>
<audio id="bgm" href="{realId}_0_0.mp3"
    format="mp3" sampleRate="44100" channels="2"
    volume="0.5" loop="true" fadeIn="1000"/>
</realGroup>

<!-- 背景動画 -->
<realGroup type="parallel" stream="2">
<timeDelta value="0"/>
<video id="bg_video" href="{realId}_0_1.mp4"
    format="mp4" width="1920" height="1080" frameRate="30"
    left="0" top="0" right="1920" bottom="1080"
    loop="true" muted="true" zIndex="0"/>
</realGroup>

<!-- タイトル画像フェードイン（1秒後） -->
<realGroup type="parallel" stream="2">
<timeDelta value="1000"/>
<interpolate function="linear" divisions="20">
<image id="title" href="{realId}_0_2.png"
    left="560" top="200" right="1360" bottom="400"
    alpha="0.0" zIndex="10"/>
<image id="title" href="{realId}_0_2.png"
    left="560" top="200" right="1360" bottom="400"
    alpha="1.0" zIndex="10"/>
</interpolate>
</realGroup>

<!-- 効果音（3秒後） -->
<realGroup type="parallel" stream="1">
<timeDelta value="3000"/>
<audio id="se_chime" href="{realId}_0_3.wav" volume="0.8"/>
</realGroup>

<!-- BGM音量を下げる（5秒後） -->
<realGroup type="parallel" stream="1">
<timeDelta value="5000"/>
<audioControl ref="bgm" command="setVolume" value="0.2" duration="1000"/>
</realGroup>

<!-- 背景動画をフェードアウト（10秒後） -->
<realGroup type="parallel" stream="2">
<timeDelta value="10000"/>
<videoControl ref="bg_video" command="setAlpha" value="0.0" duration="2000"/>
</realGroup>

<!-- BGMフェードアウトして停止（12秒後） -->
<realGroup type="parallel" stream="1">
<timeDelta value="12000"/>
<audioControl ref="bgm" command="fadeOut" value="3000"/>
</realGroup>
</realData>
```

---

## 10. 完全な使用例

### 10.1 単純な演奏データ

```xml
<tad version="1.0" encoding="UTF-8">
<realtime>
<realData>
<!-- ストリーム定義 -->
<stream number="1">
<deviceName>inst:Piano</deviceName>
</stream>

<!-- 単位系設定（四分音符=480tick） -->
<unitSystem id="9">
<primaryUnit>
<dimension>s</dimension>
<derivation ratio="1/2" sexp="-1"/>
</primaryUnit>
<auxiliaryUnit number="0" name="tick" derivation="1/480"/>
</unitSystem>
<unitSpec unitId="9" unitNumber="0"/>

<!-- メロディ -->
<realGroup type="parallel" stream="1">
<timeDelta value="0"/>
<note pitch="C4" velocity="100" duration="480"/>
<timeDelta value="480"/>
<note pitch="D4" velocity="100" duration="480"/>
<timeDelta value="480"/>
<note pitch="E4" velocity="100" duration="480"/>
<timeDelta value="480"/>
<note pitch="F4" velocity="100" duration="480"/>
<timeDelta value="480"/>
<note pitch="G4" velocity="100" duration="960"/>
</realGroup>
</realData>
</realtime>
</tad>
```

### 10.2 複数パートの演奏

```xml
<tad version="1.0" encoding="UTF-8">
<realtime>
<realData>
<!-- ストリーム定義 -->
<stream number="1">
<deviceName>inst:Piano</deviceName>
<deviceParams>ch1</deviceParams>
</stream>
<stream number="2">
<deviceName>inst:Bass</deviceName>
<deviceParams>ch2</deviceParams>
</stream>
<stream number="3">
<deviceName>inst:Drums</deviceName>
<deviceParams>ch10</deviceParams>
</stream>

<!-- メロディパート -->
<realGroup type="parallel" stream="1">
<timeDelta value="0"/>
<note pitch="C5" velocity="100" duration="480"/>
<timeDelta value="480"/>
<note pitch="E5" velocity="100" duration="480"/>
<timeDelta value="480"/>
<note pitch="G5" velocity="100" duration="960"/>
</realGroup>

<!-- ベースパート（並列実行） -->
<realGroup type="parallel" stream="2">
<timeDelta value="0"/>
<note pitch="C3" velocity="80" duration="960"/>
<timeDelta value="960"/>
<note pitch="G2" velocity="80" duration="960"/>
</realGroup>

<!-- ドラムパート（並列実行） -->
<realGroup type="parallel" stream="3">
<timeDelta value="0"/>
<note pitch="36" velocity="100" duration="120"/>  <!-- Kick -->
<timeDelta value="480"/>
<note pitch="38" velocity="100" duration="120"/>  <!-- Snare -->
<timeDelta value="480"/>
<note pitch="36" velocity="100" duration="120"/>  <!-- Kick -->
<timeDelta value="480"/>
<note pitch="38" velocity="100" duration="120"/>  <!-- Snare -->
</realGroup>
</realData>
</realtime>
</tad>
```

### 10.3 繰り返しとテンポ変更

```xml
<tad version="1.0" encoding="UTF-8">
<realtime>
<realData>
<!-- ストリーム定義 -->
<stream number="1">
<deviceName>inst:Piano</deviceName>
</stream>

<!-- 繰り返しカウンタを初期化 -->
<assign var="0x0001">
<expr><const value="4"/></expr>
</assign>

<!-- 4回繰り返し -->
<while>
<expr>
<var id="0x0001"/>
<op type="gt0"/>
</expr>
<do>
<realGroup type="parallel" stream="1">
<timeDelta value="0"/>
<note pitch="C4" velocity="100" duration="240"/>
<timeDelta value="240"/>
<note pitch="E4" velocity="100" duration="240"/>
<timeDelta value="240"/>
<note pitch="G4" velocity="100" duration="240"/>
<timeDelta value="240"/>
<note pitch="C5" velocity="100" duration="240"/>
</realGroup>

<!-- カウンタをデクリメント -->
<assign var="0x0001">
<expr>
<var id="0x0001"/>
<const value="1"/>
<op type="sub"/>
</expr>
</assign>

<!-- 2回目以降はテンポアップ -->
<if>
<expr>
<var id="0x0001"/>
<const value="2"/>
<op type="lt"/>
</expr>
<then>
<unitScale bunitId="2" texp="0" ratio="3/4"/>
</then>
</if>
</do>
</while>
</realData>
</realtime>
</tad>
```

### 10.4 アニメーションとの同期

```xml
<tad version="1.0" encoding="UTF-8">
<realtime>
<realData>
<!-- ストリーム定義 -->
<stream number="1">
<deviceName>inst:Piano</deviceName>
</stream>
<stream number="2">
<deviceName>display:</deviceName>
</stream>
<!-- 音楽と図形を同期 -->
<realGroup type="parallel" stream="1">
<timeDelta value="0"/>
<note pitch="C4" velocity="100" duration="960"/>
</realGroup>
<realGroup type="parallel" stream="2">
<timeDelta value="0"/>
<!-- 補間で図形をスムーズに移動 -->
<interpolate function="linear" divisions="10">
<figureRef id="ball" x="0" y="100"/>
<figureRef id="ball" x="400" y="100"/>
</interpolate>
</realGroup>
</realData>
</realtime>
</tad>
```

### 10.5 音声プレイリスト（順次再生）

複数の音声ファイルを順次再生するプレイリスト形式の例です。`onended`属性でチェーンを構成し、`<while>`でリピートを実現します。

```xml
<tad version="1.0" encoding="UTF-8">
<realtime autoplay="false" preload="metadata" loop="false">
<realData autoplay="inherit" startDelay="0">
<stream number="1">
<deviceName>audio:</deviceName>
</stream>
<!-- 全体リピートのためのwhileループ -->
<while>
<do>
<!-- track1 → track2 → track3 の順に再生 -->
<audio id="track1" href="{realId}_0_0.mp3" format="mp3" title="Morning Glory" artist="Oasis" album="(What's the Story) Morning Glory?" trackNumber="1" autoplay="true" onended="play:track2"/>
<audio id="track2" href="{realId}_0_1.mp3" format="mp3" title="Wonderwall" artist="Oasis" album="(What's the Story) Morning Glory?" trackNumber="2" trigger="manual" onended="play:track3"/>
<audio id="track3" href="{realId}_0_2.mp3" format="mp3" title="Don't Look Back in Anger" artist="Oasis" album="(What's the Story) Morning Glory?" trackNumber="3" trigger="manual" onended="jump:loop_end"/>
<label id="loop_end"/>
</do>
</while>
</realData>
</realtime>
</tad>
```

**動作説明**:
- 最初のトラックのみ`autoplay="true"`で自動開始
- `onended="play:trackN"`で次のトラックを再生
- 最後のトラックは`onended="jump:loop_end"`でループ終了点にジャンプ
- `<while>`で囲むことで全体リピートを実現（リピートなしの場合は`<while>`を削除）

### 10.6 シャッフル再生（random + while方式）

`<random>`と`<while>`を組み合わせてシャッフル再生を実現する例です。

```xml
<tad version="1.0" encoding="UTF-8">
<realtime autoplay="false" preload="metadata" loop="false">
<realData autoplay="inherit" startDelay="0">
<stream number="1">
<deviceName>audio:</deviceName>
</stream>
<!-- シャッフルリピート再生 -->
<while>
<do>
<!-- ランダムに1曲選択して再生 -->
<random exclude="last">
<audio id="track1" href="{realId}_0_0.mp3" title="Morning Glory" artist="Oasis" autoplay="true" onended="jump:loop_end"/>
<audio id="track2" href="{realId}_0_1.mp3" title="Wonderwall" artist="Oasis" autoplay="true" onended="jump:loop_end"/>
<audio id="track3" href="{realId}_0_2.mp3" title="Don't Look Back in Anger" artist="Oasis" autoplay="true" onended="jump:loop_end"/>
</random>
<label id="loop_end"/>
</do>
</while>
</realData>
</realtime>
</tad>
```

**動作説明**:
- `<random exclude="last">`でランダムに1曲選択（直前の曲は除外）
- 各トラックは`autoplay="true"`で選択時に即再生
- `onended="jump:loop_end"`で再生完了後にループ終了点へ
- `<while>`で繰り返し、次のランダム選択へ

### 10.7 スライドプラグイン：アニメーション付きスライド

図形TADをベースにしたスライドで、タイトル・本文テキストボックスと画像を配置し、順次フェードイン・スライドインするアニメーションの例です。

```xml
<tad version="1.0" encoding="UTF-8">
<realtime autoplay="true">
<!-- スライド全体の図形セグメント -->
<figure>
<figView top="0" left="0" right="1920" bottom="1080"/>
<figDraw top="0" left="0" right="1920" bottom="1080"/>
<figScale hunit="-72" vunit="-72"/>
<!-- 背景矩形 -->
<rect lineType="0" lineWidth="0" f_pat="1" left="0" top="0" right="1920" bottom="1080" fillColor="#1a1a2e" zIndex="0"/>
<!-- スライドタイトル（テキストボックス） -->
<document>
<docView viewleft="100" viewtop="80" viewright="1820" viewbottom="150"/>
<docDraw drawleft="100" drawtop="80" drawright="1820" drawbottom="150"/>
<docScale hunit="-72" vunit="-72"/>
<text id="title" lang="0" bpat="0" zIndex="90"/>
<font size="48"/>
<font face="sans-serif"/>
<font color="#FFFFFF"/>
実時間TADの活用例
</document>
<!-- 本文テキスト1 -->
<document>
<docView viewleft="150" viewtop="250" viewright="900" viewbottom="300"/>
<docDraw drawleft="150" drawtop="250" drawright="900" drawbottom="300"/>
<docScale hunit="-72" vunit="-72"/>
<text id="body1" lang="0" bpat="0" zIndex="80"/>
<font size="24"/>
<font color="#CCCCCC"/>
・マルチメディアプレゼンテーション
</document>
<!-- 本文テキスト2 -->
<document>
<docView viewleft="150" viewtop="320" viewright="900" viewbottom="370"/>
<docDraw drawleft="150" drawtop="320" drawright="900" drawbottom="370"/>
<docScale hunit="-72" vunit="-72"/>
<text id="body2" lang="0" bpat="0" zIndex="80"/>
<font size="24"/>
<font color="#CCCCCC"/>
・インタラクティブな教材
</document>
<!-- 本文テキスト3 -->
<document>
<docView viewleft="150" viewtop="390" viewright="900" viewbottom="440"/>
<docDraw drawleft="150" drawtop="390" drawright="900" drawbottom="440"/>
<docScale hunit="-72" vunit="-72"/>
<text id="body3" lang="0" bpat="0" zIndex="80"/>
<font size="24"/>
<font color="#CCCCCC"/>
・動的なデータビジュアライゼーション
</document>
<!-- 図解画像（初期状態で透明） -->
<image id="diagram" href="{realId}_0_0.png" left="1000" top="250" right="1800" bottom="750" lineType="0" lineWidth="0" zIndex="10"/>
<!-- アイコン画像（初期状態で画面外） -->
<image id="icon1" href="{realId}_0_1.png" left="-100" top="300" right="0" bottom="400" lineType="0" lineWidth="0" zIndex="5"/>
</figure>
<realData>
<stream number="1">
<deviceName>display:</deviceName>
</stream>
<!-- 単位系設定（ミリ秒） -->
<unitSystem id="10">
<primaryUnit>
<dimension>s</dimension>
<derivation ratio="1/1000" sexp="-1"/>
</primaryUnit>
<auxiliaryUnit number="0" name="ms" derivation="1"/>
</unitSystem>
<unitSpec unitId="10" unitNumber="0"/>
<!-- 図解画像のフェードイン（1500ms〜） -->
<realGroup type="parallel" stream="1">
<timeDelta value="1500"/>
<interpolate function="linear" divisions="30">
<imageControl ref="diagram" command="setAlpha" value="0.0"/>
<imageControl ref="diagram" command="setAlpha" value="1.0"/>
</interpolate>
</realGroup>
<!-- アイコンのスライドイン（2000ms〜） -->
<realGroup type="parallel" stream="1">
<timeDelta value="500"/>
<interpolate function="spline" divisions="30">
<imageControl ref="icon1" command="setPosition" left="-100" top="300" right="0" bottom="400"/>
<imageControl ref="icon1" command="setPosition" left="50" top="300" right="150" bottom="400"/>
</interpolate>
</realGroup>
</realData>
</realtime>
</tad>
```

**動作説明**:

- `<realtime>`がルートで、`<figure>`内にスライド全体をレイアウト
- 背景は`<rect>`で塗りつぶし、テキストは`<document>`（テキストボックス）で配置
- `<imageControl>`で画像のフェードイン・スライドインアニメーションを実行
- テキストボックスのアニメーションは将来拡張として検討（現時点では静的表示）

### 10.8 スライドプラグイン：動画再生付きプレゼンテーション

スライドに動画を埋め込み、自動再生とオーバーレイ制御を行う例です。

```xml
<tad version="1.0" encoding="UTF-8">
<realtime autoplay="true" preload="auto">
<!-- スライド全体の図形セグメント -->
<figure>
<figView top="0" left="0" right="1920" bottom="1080"/>
<figDraw top="0" left="0" right="1920" bottom="1080"/>
<figScale hunit="-72" vunit="-72"/>
<!-- 背景矩形 -->
<rect lineType="0" lineWidth="0" f_pat="1" left="0" top="0" right="1920" bottom="1080" fillColor="#0f0f23" zIndex="0"/>
<!-- スライドタイトル（テキストボックス） -->
<document>
<docView viewleft="100" viewtop="50" viewright="1820" viewbottom="120"/>
<docDraw drawleft="100" drawtop="50" drawright="1820" drawbottom="120"/>
<docScale hunit="-72" vunit="-72"/>
<text lang="0" bpat="0" zIndex="90"/>
<font size="36"/>
<font face="sans-serif"/>
<font color="#FFFFFF"/>
製品デモンストレーション
</document>
<!-- 説明テキスト（テキストボックス） -->
<document>
<docView viewleft="100" viewtop="750" viewright="1820" viewbottom="850"/>
<docDraw drawleft="100" drawtop="750" drawright="1820" drawbottom="850"/>
<docScale hunit="-72" vunit="-72"/>
<text lang="0" bpat="0" zIndex="90"/>
<font size="20"/>
<font color="#AAAAAA"/>
動画が自動再生されます。クリックで一時停止/再開できます。
</document>
<!-- ロゴオーバーレイ（右下に常時表示） -->
<image id="logo_overlay" href="{realId}_0_1.png" left="1700" top="650" right="1850" bottom="720" lineType="0" lineWidth="0" zIndex="100"/>
</figure>
<realData>
<stream number="1">
<deviceName>display:</deviceName>
</stream>
<stream number="2">
<deviceName>audio:</deviceName>
</stream>
<!-- 単位系設定（ミリ秒） -->
<unitSystem id="10">
<primaryUnit>
<dimension>s</dimension>
<derivation ratio="1/1000" sexp="-1"/>
</primaryUnit>
<auxiliaryUnit number="0" name="ms" derivation="1"/>
</unitSystem>
<unitSpec unitId="10" unitNumber="0"/>
<!-- メイン動画（中央に配置、自動再生） -->
<realGroup type="parallel" stream="1">
<timeDelta value="0"/>
<video id="demo_video" href="{realId}_0_0.mp4" format="mp4" left="160" top="140" right="1760" bottom="700" lineType="0" lineWidth="0" width="1920" height="1080" frameRate="30" autoplay="true" trigger="time" volume="0.8" playbackRate="1.0" loop="false" muted="false" zIndex="10" poster="{realId}_0_2.jpg" onended="jump:video_end"/>
</realGroup>
<!-- 動画の10秒地点でロゴをフェードアウト -->
<realGroup type="parallel" stream="1">
<timeDelta value="10000"/>
<interpolate function="linear" divisions="20">
<imageControl ref="logo_overlay" command="setAlpha" value="0.7"/>
<imageControl ref="logo_overlay" command="setAlpha" value="0.3"/>
</interpolate>
</realGroup>
<!-- 動画終了ラベル -->
<label id="video_end"/>
<!-- ロゴを再表示 -->
<realGroup type="parallel" stream="1">
<timeDelta value="0"/>
<imageControl ref="logo_overlay" command="setAlpha" value="0.7"/>
</realGroup>
</realData>
</realtime>
</tad>
```

**動作説明**:

- `<realtime>`がルートで、`<figure>`内にスライド全体をレイアウト
- `<video>`要素で動画を中央配置、`poster`属性でサムネイル画像を指定
- `onended="jump:video_end"`で動画終了時にラベルにジャンプ
- `<imageControl>`でロゴオーバーレイを動画再生中にフェードアウト

### 10.9 スライドプラグイン：複数動画の連続再生

複数の動画クリップを順次再生し、トランジション効果を加えた例です。

```xml
<tad version="1.0" encoding="UTF-8">
<realtime autoplay="true" preload="auto">
<!-- タイトル画像 -->
<figure>
<figView top="0" left="0" right="1920" bottom="1080"/>
<figDraw top="0" left="0" right="1920" bottom="1080"/>
<figScale hunit="-72" vunit="-72"/>
<image id="title_card" href="{realId}_0_3.png" left="0" top="0" right="1920" bottom="1080" lineType="0" lineWidth="0" zIndex="50"/>
</figure>
<realData>
<stream number="1">
<deviceName>display:</deviceName>
</stream>
<stream number="2">
<deviceName>audio:</deviceName>
</stream>
<!-- 単位系設定（ミリ秒） -->
<unitSystem id="10">
<primaryUnit>
<dimension>s</dimension>
<derivation ratio="1/1000" sexp="-1"/>
</primaryUnit>
<auxiliaryUnit number="0" name="ms" derivation="1"/>
</unitSystem>
<unitSpec unitId="10" unitNumber="0"/>
<!-- タイトルカードを3秒表示後フェードアウト -->
<realGroup type="parallel" stream="1">
<timeDelta value="3000"/>
<interpolate function="linear" divisions="30">
<imageControl ref="title_card" command="setAlpha" value="1.0"/>
<imageControl ref="title_card" command="setAlpha" value="0.0"/>
</interpolate>
</realGroup>
<!-- 動画1（イントロ） -->
<realGroup type="parallel" stream="1">
<timeDelta value="1000"/>
<video id="clip1" href="{realId}_0_0.mp4" format="mp4" left="0" top="0" right="1920" bottom="1080" lineType="0" lineWidth="0" autoplay="true" trigger="time" volume="1.0" loop="false" zIndex="10" onended="jump:clip1_end"/>
</realGroup>
<label id="clip1_end"/>
<!-- 動画1終了後、フェードアウトしながら動画2を開始 -->
<realGroup type="parallel" stream="1">
<timeDelta value="0"/>
<!-- 動画1をフェードアウト -->
<interpolate function="linear" divisions="15">
<videoControl ref="clip1" command="setAlpha" value="1.0"/>
<videoControl ref="clip1" command="setAlpha" value="0.0"/>
</interpolate>
</realGroup>
<!-- 動画2（メインコンテンツ） -->
<realGroup type="parallel" stream="1">
<timeDelta value="0"/>
<video id="clip2" href="{realId}_0_1.mp4" format="mp4" left="0" top="0" right="1920" bottom="1080" lineType="0" lineWidth="0" autoplay="true" trigger="time" volume="1.0" loop="false" zIndex="5" onended="jump:clip2_end"/>
</realGroup>
<!-- 動画2をフェードイン -->
<realGroup type="parallel" stream="1">
<timeDelta value="0"/>
<interpolate function="linear" divisions="15">
<videoControl ref="clip2" command="setAlpha" value="0.0"/>
<videoControl ref="clip2" command="setAlpha" value="1.0"/>
</interpolate>
</realGroup>
<label id="clip2_end"/>
<!-- 動画2終了後、動画3へ -->
<realGroup type="parallel" stream="1">
<timeDelta value="0"/>
<videoControl ref="clip2" command="setAlpha" value="0.0"/>
</realGroup>
<!-- 動画3（エンディング） -->
<realGroup type="parallel" stream="1">
<timeDelta value="0"/>
<video id="clip3" href="{realId}_0_2.mp4" format="mp4" left="0" top="0" right="1920" bottom="1080" lineType="0" lineWidth="0" autoplay="true" trigger="time" volume="1.0" loop="false" zIndex="10" onended="jump:all_end"/>
</realGroup>
<label id="all_end"/>
<!-- 全動画終了後、タイトルカードを再表示 -->
<realGroup type="parallel" stream="1">
<timeDelta value="0"/>
<imageControl ref="title_card" command="setAlpha" value="1.0"/>
</realGroup>
</realData>
</realtime>
</tad>
```

**動作説明**:

- `<realtime>`がルートで、`<figure>`（`<figView>`, `<figDraw>`, `<figScale>`付き）にタイトル画像を配置
- 3つの動画クリップを`onended`でチェーン接続
- クリップ間でクロスフェードトランジションを実現
- 全動画終了後にタイトルカードを再表示

---

## 11. バイナリとの対応表

### 11.1 セグメントID一覧

| カテゴリ | セグメントID | 名称 | xmlTAD要素 |
|---------|------------|------|-----------|
| 実時間制御 | 0xD0 | TS_RGRP | `<realGroup type="parallel\|serial">` |
| 実時間制御 | 0xD1 | TS_RTIME | `<timeDelta>`, `<timeAbsolute>` |
| 実時間制御 | 0xD2 | TS_BRLP | `<label>`, `<jump>`, `<if>`, `<while>`, `<assign>`, `<random>` |
| 実時間制御 | 0xD3 | TS_RGRD | `<interpolate>` |
| 管理 | 0xEA | TS_REAL | `<realData>` 開始タグ |
| 管理 | 0xEB | TS_REALEND | `</realData>` 終了タグ |
| 管理 | 0xEC | TS_SUNIT | `<unitSystem>`, `<unitSpec>`, `<unitScale>` |
| 音 | 0x90～0x9F | TS_SND | `<note>`, `<midi>`, `<pcm>` |
| メディア（拡張） | 0xA0～0xAF | TS_MEDIA | `<audio>`, `<video>`, `<image>` |
| メディア制御（拡張） | 0xB0～0xBF | TS_MCTL | `<audioControl>`, `<videoControl>`, `<imageControl>`, `<textControl>`, `<shapeControl>`, `<groupControl>`, `<triggerControl>` |
| イベント待機（TADjs拡張） | 0xC0 | TS_WAIT | `<wait>` |
| アニメーション（TADjs拡張） | 0xC1 | TS_ANIM | `<keyframes>`, `<keyframe>` |
| 入力トリガー（TADjs拡張） | 0xC2 | TS_TRIG | `<trigger>` |
| エラー処理（TADjs拡張） | 0xC3 | TS_ERR | `<onerror>`, `<fallback>` |

### 11.2 SUBID対応表

#### TS_RGRP (0xD0)

| SUBID | 名称 | xmlTAD要素 |
|-------|------|-----------|
| 0 | 並列グループ開始 | `<realGroup type="parallel">` 開始タグ |
| 1 | 並列グループ終了 | `</realGroup>` 終了タグ |
| 2 | 直列グループ開始 | `<realGroup type="serial">` 開始タグ |
| 3 | 直列グループ終了 | `</realGroup>` 終了タグ |

#### TS_RTIME (0xD1)

| SUBID | 名称 | xmlTAD要素 |
|-------|------|-----------|
| 0 | 時間送り付箋 | `<timeDelta>` |
| 1 | 時間経過付箋 | `<timeAbsolute>` |

#### TS_BRLP (0xD2)

| SUBID | 名称 | xmlTAD要素 |
|-------|------|-----------|
| 0 | ラベル付箋 | `<label>` |
| 1 | ジャンプ付箋 | `<jump>` |
| 2 | IF付箋 | `<if>` |
| 3 | ELSEIF付箋 | `<elseif>` |
| 4 | ENDIF付箋 | `</if>` |
| 5 | 繰り返し開始付箋 | `<while>` |
| 6 | 繰り返し終了付箋 | `</while>` |
| 7 | 変数代入付箋 | `<assign>` |
| 8 | ランダム選択開始 | `<random>` |
| 9 | ランダム選択終了 | `</random>` |

#### TS_RGRD (0xD3)

| SUBID | 名称 | xmlTAD要素 |
|-------|------|-----------|
| 0 | 補間開始 | `<interpolate>` 開始タグ |
| 1 | 補間数指定・終了 | divisions属性、`</interpolate>` |

#### TS_SUNIT (0xEC)

| SUBID | 名称 | xmlTAD要素 |
|-------|------|-----------|
| 0 | 単位指定付箋 | `<unitSpec>` |
| 1 | 一時単位指定付箋 | `<unitSpecTemp>` |
| 2 | 単位系テーブル設定付箋 | `<unitSystem>` |
| 3 | 単位縮尺付箋 | `<unitScale>` |
| 4 | 絶対単位係数設定付箋 | `<absoluteUnitCoeff>` |

#### TS_MEDIA (0xA0)（xmlTAD拡張）

| SUBID | 名称 | xmlTAD要素 |
|-------|------|-----------|
| 0 | 音声ファイル参照 | `<audio>` |
| 1 | 映像ファイル参照 | `<video>` |
| 2 | 静止画参照 | `<image>` |

#### TS_MCTL (0xB0)（xmlTAD拡張）

| SUBID | 名称 | xmlTAD要素 |
|-------|------|-----------|
| 0 | 音声制御 | `<audioControl>` |
| 1 | 映像制御 | `<videoControl>` |
| 2 | 画像制御 | `<imageControl>` |
| 3 | テキスト制御 | `<textControl>` |
| 4 | 図形制御 | `<shapeControl>` |
| 5 | グループ制御 | `<groupControl>` |
| 6 | トリガー制御 | `<triggerControl>` |

#### TS_WAIT (0xC0)（TADjs拡張）

| SUBID | 名称 | xmlTAD要素 |
|-------|------|-----------|
| 0 | イベント待機 | `<wait>` |

#### TS_ANIM (0xC1)（TADjs拡張）

| SUBID | 名称 | xmlTAD要素 |
|-------|------|-----------|
| 0 | キーフレームアニメーション開始 | `<keyframes>` 開始タグ |
| 1 | キーフレームアニメーション終了 | `</keyframes>` 終了タグ |
| 2 | キーフレーム定義 | `<keyframe>` |

#### TS_TRIG (0xC2)（TADjs拡張）

| SUBID | 名称 | xmlTAD要素 |
|-------|------|-----------|
| 0 | 入力トリガー開始 | `<trigger>` 開始タグ |
| 1 | 入力トリガー終了 | `</trigger>` 終了タグ |

#### TS_ERR (0xC3)（TADjs拡張）

| SUBID | 名称 | xmlTAD要素 |
|-------|------|-----------|
| 0 | エラーハンドラ開始 | `<onerror>` 開始タグ |
| 1 | エラーハンドラ終了 | `</onerror>` 終了タグ |
| 2 | フォールバックリソース | `<fallback>` |

---

## 12. 実装上の考慮事項

### 12.1 パーサー実装

実時間TADのパーサーは以下の点に注意が必要です：

1. **ネスト構造の管理** - イベントグループは深くネストする可能性がある
2. **変数スコープ** - 変数は実時間データ全体で有効
3. **時間計算** - 相対時間と絶対時間の両方を正確に処理
4. **ストリーム管理** - 複数ストリームの並列処理

### 12.2 プレイヤー実装

実時間データのプレイヤーは以下の要件を満たす必要があります：

1. **タイミング精度** - 音楽演奏では5ms以下、BGMでも20ms以下の精度
2. **並列処理** - 複数イベントグループの同時実行
3. **デバイスドライバ** - 各種出力デバイスへの対応
4. **補間処理** - リアルタイムでのイベント生成

### 12.3 データ互換性

- バイナリTADからxmlTADへの変換は可逆的であるべき
- 単位系情報は正確に保持する
- ストリーム固有データはBase64エンコードで保存

---

## 13. 参考資料

- BTRON TAD詳細仕様書 別冊／実時間制御（坂村健, 1989年2月）
- TADの音楽への応用（曽根卓朗, ヤマハ株式会社, 1988年8月）
- 音楽TADについて（曽根卓朗, ヤマハ株式会社, 1990年4月）
- xmlTAD仕様書 (xmlTAD-specification.md)

---

## 14. 更新履歴

| 日付 | 版 | 内容 |
|------|-----|------|
| 2025-12-31 | 1.0 | 初版作成 |
| 2025-12-31 | 1.1 | `<parallelGroup>`/`<serialGroup>`を`<realGroup type="parallel\|serial">`に統一 |
| 2025-12-31 | 1.2 | `<realtimeStart>`/`<realtimeEnd/>`を`<realData>`コンテナに統一 |
| 2026-01-16 | 1.3 | `<audio>`, `<video>`要素を拡張（メタデータ属性、id属性追加） |
| 2026-01-16 | 1.4 | メディア制御要素追加: `<audioControl>`, `<videoControl>`, `<imageControl>` |
| 2026-01-16 | 1.5 | 自動再生対応: `<realtime>`, `<realData>`, `<audio>`, `<video>`にautoplay/preload/trigger属性追加 |
| 2026-01-22 | 1.6 | プレイリスト機能追加: `<audio>/<video>`にトラック情報属性（title/artist/album/trackNumber）とonended属性追加 |
| 2026-01-24 | 1.7 | `<random>`セグメント追加（シャッフル再生用）、`<realData>`のcontinuous/shuffle/repeat属性を削除し`<while>`+`<random>`+`onended`による制御に変更 |
| 2026-01-25 | 1.8 | 文書構造のバリエーション追加（1.5節）、ルート`<realtime>`での`<document>`/`<figure>`配置説明、スライドプラグイン用例追加（10.7〜10.9節） |
| 2026-01-25 | 1.9 | TADjs拡張: `<textControl>`, `<shapeControl>`要素を追加（9.11〜9.12節） |
| 2026-01-28 | 2.0 | TADjs拡張: 高度な制御機能追加（9.13〜9.17節）- `<wait>`イベント待機、`<keyframes>`キーフレームアニメーション、`<trigger>`入力トリガー、`<onerror>`/`<fallback>`エラーハンドリング、`<groupControl>`グループ制御 |

