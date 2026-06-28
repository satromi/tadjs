# TADjs

ダウンロード： [TADjs Desktop Ver0.43](https://github.com/satromi/tadjs/releases/tag/Ver0.43 "TADjs Desktop Ver0.43 Release")

satromi@gmai.com

## 紹介

BTRONはファイルシステムから実身/仮身という形でハイパーテキストを活用でき、さらにTADというデータフォーマットを用いることで文章/画像といったデータを混在できるように統一できるようにしたのが特徴です。

TADjsはBTRONユーザが継続的に実身/仮身、TADを活用していくために、ブラウザ上でBTRONの特徴である実身仮身構造を再現して、BTRONの文章/画像ファイルであるTADの表示・編集が可能なツールを目指しています。

## 使い方（今のところの）

お使いのコンピュータのどこかのフォルダにファイル（index.html, tad.js, lh5.js, ./lib/encoding.min.js）を配置してください。

ブラウザでindex.htmlを開いて「ファイル選択」ボタンを押下してTADファイルを選択すると、TAD文章/画像ファイルが表示できます。

※TADファイルを描画領域にドラッグアンドドロップしても同様に動作します。

書庫形式で複数TADファイルが圧縮されている場合、タブ切り替えで複数のTADを表示できます。表示領域上部の「Tab N」ボタンを押下してください。

タブ一覧がページの横幅で収まらない場合、スクロールボタンが左右に表示されます。また、タブボタンをドラッグするとスクロールできます。

※デフォルト表示は（Tab 1）

書庫形式である実身内に仮身セグメントがある場合、仮身をクリックするとリンク先の実身に飛ぶことができます。

## Windows版インストール方法

インストールは、どこかのフォルダにtadjs_desktop.zipを解凍してください。
起動前に、解凍フォルダ"019ab620-1e6a-7d17-9598-bccfe61293e0_0.xtad”をエディタで開いて、
data_folder "C:\tadjs-desktop\data"のようにtadjs_desktopを解凍したフォルダ配下にあるdataフォルダを指定してください。
使うには、解凍したフォルダ直下にあるtadjs_desktop.exeを起動してください。

## Windows版アップデート方法

アップデートされる場合は、\dataフォルダと"019ab620-1e6a-7d17-9598-bccfe61293e0_0.xtad”をどこかに待避して、インストールフォルダに新バージョンを解凍してください。
その後、インストールフォルダに\dataフォルダと"019ab620-1e6a-7d17-9598-bccfe61293e0_0.xtad”を戻してください。

## Linux版インストール方法

### 前提条件

日本語フォントおよびElectron実行に必要なライブラリを事前にインストールしてください。

#### Ubuntu/Debian系の場合

```bash
sudo apt install -y fonts-noto-cjk libasound2 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libgbm1 libgtk-3-0 libnss3 libxcomposite1 libxdamage1 libxrandr2 libxss1 libxtst6
```

#### Fedora/RHEL系の場合

```bash
sudo dnf install -y google-noto-sans-cjk-fonts alsa-lib atk at-spi2-atk cups-libs libdrm mesa-libgbm gtk3 nss libXcomposite libXdamage libXrandr libXScrnSaver libXtst
```

### インストール手順

1. `tadjs_desktop.tar.gz`を任意のフォルダに解凍してください

```bash
tar xzf tadjs_desktop.tar.gz
```

1. 解凍されたフォルダに移動し、実行ファイルに実行権限を付与してください

```bash
cd "TADjs Desktop-linux-x64"
chmod +x tadjs_desktop
```

1. `tadjs_desktop`を起動してください

```bash
./tadjs_desktop
```

> **Note:** Linux版はデータフォルダが相対パス（`./data/`）で設定済みのため、Windows版のようなxtadファイルの編集は不要です。

### WSL（Windows Subsystem for Linux）で使用する場合

WSLではGUI表示のためにWSLg（Windows 11標準搭載）が必要です。
WSL1をお使いの場合はWSL2へのアップグレードが必要です。

## Linux版アップデート方法

アップデートされる場合は、`/data`フォルダをどこかに待避して、インストールフォルダに新バージョンを解凍してください。
その後、インストールフォルダに`/data`フォルダを戻してください。

> **Note:** Linux版は`019ab620-1e6a-7d17-9598-bccfe61293e0_0.xtad`の待避は不要です（相対パス設定のため）。

## 更新履歴

### Ver0.44

- 書庫解凍プラグインの機能を修正しました。
  - TRONコード変換での面指の定不具合を修正
  - マイクロスクリプト実身の変換を修正
- マイクロスクリプトプラグインの機能を修正しました。
  - 表示位置ずれを修正
  - グループ化されているパーツの表示の不具合を修正

### Ver0.43

- 書庫解凍プラグインの機能を修正しました。
  - 一部実身での変換エラーを修正
- マイクロスクリプトプラグインの機能を修正しました。
  - 表示位置ずれを修正
- ファイル取込プラグインの機能を修正しました。
  - ファイルを取り込めない不具合を修正
- 諸々の機能を修正しました。
  - 実身新規配置時にアイコン非表示になる不具合を修正

### 以前の更新

[CHANGELOG.md](CHANGELOG.md) を参照

## 【既知のバグ】TADjs（TADjs Desktopではなく）

- 全般
  - 特になし
- 文章TAD
  - 文字描写のベースラインが上側指定になっているので行中でフォントサイズを変えると上に表示される
- 画像TAD
  - 線種定義セグメントの線種の再現度が低い

## TADjs未対応セグメント

- 共通
  - 機能付箋セグメント
  - 設定付箋セグメント（Unofficial TAD Guide Bookにて非推奨）
- 文章TAD
  - コラム指定付箋（暫定対応）
  - 枠あけ指定付箋（暫定対応）
  - ページ番号指定付箋（変換のみ、描画処理無し）
  - 充填行指定付箋（暫定対応）
  - 行間隔指定付箋（のベースライン対応）
  - 行揃え指定付箋（のうち、両端揃え、均等揃え）
  - フィールド書式指定付箋（暫定対応）
  - 文字方向指定付箋（xmlTAD側のみ対応）
  - フォント指定付箋（簡易的に対応）
  - 文字拡大/縮小指定付箋（暫定対応）
  - 文字間隔指定付箋（のうちカーニング）
  - 文字回転指定付箋（Unofficial TAD Guide Bookにて非推奨）
  - 文字基準位置移動付箋（Unofficial TAD Guide Bookにて非推奨）
  - 充填文字指定付箋（暫定対応）
  - 文字罫線指定付箋（Unofficial TAD Guide Bookにて非推奨）
  - 結合開始指定付箋（暫定対応）
  - 結合終了指定付箋（暫定対応）
  - 文字割付開始指定付箋
  - 文字割付終了指定付箋
  - 行頭禁則指定付箋（一部不具合）
  - 行末禁則指定付箋（一部不具合）
  - 文章アプリケーション指定付箋
- 図形TAD
  - 図形要素セグメント全般で直接描画（0:STORE）以外は非対応（Unofficial TAD Guide Bookにて0:STORE以外は非推奨）
  - 線種定義セグメント（の長さが正しくない）
  - マクロ定義開始セグメント（Unofficial TAD Guide Bookによると実装例なし）
  - マクロ定義終了セグメント（Unofficial TAD Guide Bookによると実装例なし）
  - マクロ参照セグメント
  - 座標変換セグメント（xmlTAD側のみ対応）
  - 図形アプリケーション指定付箋

## サンプル文章について

BTRON Clubで報告した内容を共有しています。

TADjs by satromi is licensed under the Apache License, Version2.0
