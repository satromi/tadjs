# CLAUDE.md - LLM連携プラグイン用指示

このファイルは、TADjs DesktopのLLM連携プラグインと連携してClaude Codeが作業する際のガイドラインです。

## 作業フロー

### 1. バックアップ作成
LLM連携プラグインで開いた実身の `*_0.xtad` を `*_1.xtad` にコピーする。

```bash
# 例: 実身ID が 019c03a3-d901-788e-9aeb-41d258309896 の場合
cp "019c03a3-d901-788e-9aeb-41d258309896_0.xtad" "019c03a3-d901-788e-9aeb-41d258309896_1.xtad"
```

### 2. プロンプト実行
`*_0.xtad` にプロンプト・指示が記載されている場合、その内容をClaudeで実行する。

**プロンプトの検出箇所**:
- `<document>` 内の `<p>` タグ内テキスト
- テキストノード内の指示文
- 複数段落記載ある場合もあるので、複数段落</xtad>まで読む

### 3. 応答結果の記載
Claudeの応答結果を `*_0.xtad` にxmlTAD形式で記載する。

---

## xmlTAD形式の仕様

### 文書タイプ

| タイプ | ルート要素 | 用途 |
|--------|-----------|------|
| 文章 | `<document>` | テキスト主体の文書 |
| 図形 | `<figure>` | 図形・レイアウト主体の文書 |

### 基本構造（文章）
```xml
<tad version="1.0" encoding="UTF-8" filename="ファイル名">
<document>
<docScale hunit="-72" vunit="-72"/>
<text lang="33" bpat="0"/>
<paper imposition="0" binding="0" length="1403" width="992" top="94" bottom="70" left="108" right="85"/>
<docmargin top="94" bottom="118" left="108" right="85"/>
<p>段落テキスト</p>
</document>
</tad>
```

### 基本構造（図形）
```xml
<tad version="1.0" encoding="UTF-8" filename="ファイル名">
<figure>
<figView top="0" left="0" right="400" bottom="200"/>
<figDraw top="0" left="0" right="400" bottom="200"/>
<figScale hunit="-72" vunit="-72"/>
<!-- 図形要素 -->
</figure>
</tad>
```

---

## 編集ルール

### 変更禁止の属性・要素

以下の要素・属性は既存の値を保持し、変更しないこと:

| 要素 | 理由 |
|------|------|
| `<paper>` | 用紙設定 |
| `<docmargin>` | 余白設定 |
| `<docScale>`, `<figScale>` | 座標系設定 |
| `<figView>`, `<figDraw>` | 図形表示領域 |
| `<docView>`, `<docDraw>` | 文書表示領域 |
| `<realtime>`, `<realData>` | アニメーション制御（複雑なため編集非推奨） |

### link要素（仮身）の属性

リンク要素の属性は変更しないこと:

```xml
<link id="実身ID_0.xtad"
      vobjleft="..." vobjtop="..." vobjright="..." vobjbottom="..."  <!-- 位置 -->
      tbcol="..." frcol="..." chcol="..." bgcol="..."                <!-- 色 -->
      namedisp="..." pictdisp="..." framedisp="..."                  <!-- 表示フラグ -->
      zindex="..."                                                    <!-- 重ね順 -->
/>
```

---

## テキスト装飾

### フォント指定
```xml
<p><font size="18">サイズ18のテキスト</font></p>
<p><font face="sans-serif">フォント指定</font></p>
<p><font color="#FF0000">赤色テキスト</font></p>
```

### スタイル
```xml
<p><span style="font-weight:bold">太字</span></p>
<p><span style="font-style:italic">斜体</span></p>
<p><span style="text-decoration:underline">下線</span></p>
```

---

## 図形要素

### 矩形
```xml
<rect id="rect1" left="0" top="0" right="100" bottom="100"
      lineType="1" lineWidth="3" lineColor="#000000"
      f_pat="1" fillColor="#FFFFFF" zIndex="10"/>
```

### 円
```xml
<circle id="circle1" left="0" top="0" right="100" bottom="100"
        lineType="1" lineWidth="3" lineColor="#000000"
        f_pat="1" fillColor="#FFFFFF" zIndex="10"/>
```

### 多角形
```xml
<polygon id="poly1" left="0" top="0" right="100" bottom="100"
         points="50,0 0,100 100,100"
         lineType="1" lineWidth="3" lineColor="#000000"
         f_pat="1" fillColor="#FFFFFF" zIndex="10"/>
```

---

## 注意事項

1. **エンコーディング**: UTF-8を使用
2. **特殊文字エスケープ**: `&lt;`, `&gt;`, `&amp;`, `&quot;`, `&apos;`
3. **コメント**: `<!-- コメント -->` 形式で使用可能
4. **zIndex**: 数値が大きいほど前面に表示
5. **段落分け**: 応答が長い場合は `<p>` タグで適切に段落分けする
6. **最小限の変更**: 元のファイル構造を尊重し、必要最小限の変更にとどめる
7. **既存要素の順序**: 要素の出現順序は変更しない
