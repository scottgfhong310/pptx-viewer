# pptx-viewer

[English](README.md) · [中文](README.zh-Hant.md) · **日本語**

**PowerPoint プレゼン（`.pptx` / `.ppsx`）をブラウザで表示**する単一ページ Web アプリ。[PPTXjs](https://github.com/meshesha/PPTXjs)（リポジトリに **vendored**）で描画します——各スライドを HTML に組み、幅に合わせて拡縮し、スライド番号ナビを備えます。バックエンドは軽量な Express（アップロード / 一覧 / クリア）。

- 🖼️ **スライド描画** — PPTXjs が各スライドを HTML 化；コントローラが各スライドをフレームで包み `transform: scale()` でコンテナ幅に合わせ、リサイズ時に再計算
- 🔢 **スライドナビ** — 左側固定の番号レール（スムーズスクロール + scroll-spy ハイライト）；ツールバーに枚数表示
- 📥 **ドラッグ＆ドロップ** — プレゼンをページ上にドロップ；**同名は上書き**
- 🔗 **ディープリンク** — `?pptx=<パス>` で任意のファイルを開く（ビューア相対、または許可リストの絶対パス）；共有可・戻る／進む対応。堅牢なクエリ解析で `+` が空白に化けません
- 🌗 **ライト / ダーク**切替（localStorage 保存）——**外殻**（ツールバー・ステージ・ナビ）はテーマに追従；**スライドは作者の見た目を維持**（スライドは自前のデザインなので、暗く塗り替えると崩れます）
- 🌐 **多言語 UI** — 繁體中文 / English / 日本語（既定は繁體中文、localStorage 保存）。スライドの内容はデータであり**翻訳されません**
- 🛡️ **パス安全性** — `..`・バックスラッシュ・`javascript:` / `file:` スキーム・protocol-relative `//`・許可リスト外の絶対パスを遮断
- 🗂️ ファイル一覧サイドバー、元ファイルをダウンロード、フォルダを空にする
- ⏳ **堅牢な解析** — PPTXjs に完了イベントが無いため、MutationObserver で最初のスライドを検出し、アイドル/総時間のタイムアウトと Google スライド書き出し向けのヒントを用意

> 本アプリ自体のフロントエンドライブラリ（jQuery、Materialize、Lodash、Material Icons）は CDN から読み込みます。PPTXjs エンジン（d3 / nv.d3 / JSZip 込み）は再現性のため（未ピンの上流を避けるため）`public/apps/pptx-viewer/vendor/` に **vendored** しています——[LICENSE](./LICENSE) の bundled 表記を参照。`npm install` はバックエンド依存のみを取得します。

## クイックスタート

Node.js 18+ が必要です。

```bash
npm install
npm start
# http://localhost:3000/apps/pptx-viewer/ を開く
```

ポート変更は `PORT`：`PORT=8080 npm start`。

## ディレクトリ構成

```
pptx-viewer/
├── app.js                          # スタンドアロン Express サーバ（static + API 2 本）
├── package.json
├── routes/
│   ├── upload.js                   # POST /api/upload?folder=pptx-viewer（multer・複数・上書き）
│   └── pptx-viewer.js              # GET /files、POST /clear
└── public/
    ├── apps/pptx-viewer/           # フロントエンド（/apps/pptx-viewer/ で配信）
    │   ├── index.html              # 構造のみ
    │   ├── pptx-viewer.css         # テーマ token（外殻）+ ページスタイル
    │   ├── pptx-viewer.js          # コントローラ（グルー）：テーマ / i18n / アップロード / PPTXjs 描画 + 拡縮 + ナビ
    │   ├── pptx-viewer-lib.js      # PptxViewerLib：クエリ解析 / パス安全性 / サーバ通信（純ロジック・DOM 非依存）
    │   ├── vendor/                 # vendored PPTXjs エンジン（js/ + css/）+ LICENSE.PPTXjs
    │   ├── materialize-dark.css    # ファミリー共有アセット（Materialize ダーク）
    │   ├── side-tool.css           # 右側フローティングツールバー
    │   ├── thinking-dot.css        # 共有ローディングドット utility
    │   ├── i18n.js                 # i18n エンジン
    │   └── locales/{zh-Hant,en,ja}.js
    └── upload/pptx-viewer/         # アップロードされたプレゼン（内容は git 管理外；サンプルを 1 つ同梱）
```

## API

| Method / Path | 説明 |
|---|---|
| `POST /api/upload?folder=pptx-viewer` | アップロード（form フィールド `myFiles`・複数；`folder` 指定時は元の名前を保持 → 上書き）|
| `GET /api/pptx-viewer/files` | `public/upload/pptx-viewer/` 内の可視ファイルを一覧（新しい順）|
| `POST /api/pptx-viewer/clear` | そのフォルダ内の可視ファイルをすべて削除（フォルダと隠しファイルは保持）|

静的読み取り：`/upload/pptx-viewer/<name>`。すべての API は `{ ok }` エンベロープ。

`GET /api/pptx-viewer/files` の戻り値：

```jsonc
{
  "ok": true,
  "files": [
    { "name": "string", "size": 0, "mtime": 0 }   // mtime = epoch ms；新→旧でソート
  ]
}
```

## コアライブラリ（`PptxViewerLib`）

純ロジック・DOM 非依存で単体組み込み可能。実際の「`.pptx → HTML`」描画は PPTXjs（`$el.pptxToHtml()`）が行い DOM に書き込むため、その呼び出し（完了検出・拡縮・ナビ込み）はライブラリではなくコントローラ側にあります。

ヘルパ：`parseQuery`（堅牢な `?pptx=`）、`isSafeLink`、`isUploadable`（`.pptx`/`.ppsx`）、`basename`、`encodePath`、`fileUrl`、`checkFile`、`listFiles`、`uploadFile`、`clearFolder`、`formatSize`、`timestamp`。

## 備考

- フロントエンドは API を**絶対パス**（`/api/...`、`/upload/...`）で呼ぶため、本プロジェクトの Node サーバが**サイトルート**から配信する必要があります。**GitHub Pages 非対応**（静的ホスティングではアップロード / 一覧 / クリア API を実行できません）。
- PPTXjs はベストエフォートのレンダラです。複雑な効果・一部のチャート・**Google スライドから書き出した**デックは不完全になる/失敗することがあります——PowerPoint / LibreOffice で保存し直すと多くは解決します。
- 本アプリは **nodeapp WebApp ファミリー**に属します。共通規約は [nodeapp-webapp-family](https://github.com/scottgfhong310/nodeapp-webapp-family) を参照。

## ライセンス

[MIT](./LICENSE) © 2026 [Scott G.F. Hong](https://github.com/scottgfhong310)

同梱の PPTXjs エンジンとその依存はそれぞれのライセンスを保持します——[LICENSE](./LICENSE) と `public/apps/pptx-viewer/vendor/` を参照。
