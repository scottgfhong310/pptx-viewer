# pptx-viewer

[English](README.md) · **中文** · [日本語](README.ja.md)

在瀏覽器內**檢視 PowerPoint 簡報（`.pptx` / `.ppsx`）**的單頁 WebApp。以 [PPTXjs](https://github.com/meshesha/PPTXjs)（**vendored** 進 repo）渲染——每張投影片排成 HTML、縮放貼齊寬度，並附投影片數字導覽。後端是輕量 Express（上傳 / 列表 / 清空）。

- 🖼️ **投影片渲染** — PPTXjs 把每張投影片轉成 HTML；控制器把每張包進 frame、用 `transform: scale()` 縮放貼齊容器，視窗變動時重算
- 🔢 **投影片導覽** — 左側固定數字列，平滑捲動 + scroll-spy 高亮；toolbar 顯示張數
- 📥 **拖拉上傳** — 把簡報拖到頁面任意位置；**同名覆寫**
- 🔗 **深連結** — 用 `?pptx=<路徑>` 開任一檔（相對 viewer 目錄，或允許清單內的絕對路徑）；可分享、支援上一頁／下一頁。穩健的 query 解析避免 `+` 被當成空白
- 🌗 **淺色 / 深色** 切換（存 localStorage）——**外殼**（toolbar、舞台、導覽）跟主題；**投影片維持作者原貌**（簡報本身就是一套設計，硬轉深會破壞它）
- 🌐 **三語 UI** — 繁體中文 / English / 日本語（預設繁體中文，存 localStorage）。投影片內容是 data，**永不翻譯**
- 🛡️ **路徑安全** — 擋 `..`、反斜線、`javascript:` / `file:` 協定、protocol-relative `//`，以及非允許清單的絕對路徑
- 🗂️ 檔案清單側欄、下載原始檔、清空資料夾
- ⏳ **韌性解析** — PPTXjs 沒有完成事件，故用 MutationObserver 偵測第一張投影片，搭配 idle/總時間逾時與「Google Slides 匯出請先另存」的友善提示

> 本 app 自己的前端庫（jQuery、Materialize、Lodash、Material Icons）走 CDN。PPTXjs 引擎（含 d3 / nv.d3 / JSZip）**vendored** 在 `public/apps/pptx-viewer/vendor/`，確保可重現（不吃未鎖版的上游）——見 [LICENSE](./LICENSE) 的 bundled 聲明。`npm install` 只裝後端依賴。

## 快速開始

需要 Node.js 18+。

```bash
npm install
npm start
# 開啟 http://localhost:3000/apps/pptx-viewer/
```

以 `PORT` 改 port：`PORT=8080 npm start`。

## 目錄結構

```
pptx-viewer/
├── app.js                          # 獨立 Express 伺服器（static + 兩支 API）
├── package.json
├── routes/
│   ├── upload.js                   # POST /api/upload?folder=pptx-viewer（multer、多檔、覆寫）
│   └── pptx-viewer.js              # GET /files、POST /clear
└── public/
    ├── apps/pptx-viewer/           # 前端（服務於 /apps/pptx-viewer/）
    │   ├── index.html              # 純結構
    │   ├── pptx-viewer.css         # 主題 token（外殼）+ 本頁樣式
    │   ├── pptx-viewer.js          # 控制器（膠水）：主題 / i18n / 上傳 / PPTXjs 渲染 + 縮放 + 導覽
    │   ├── pptx-viewer-lib.js      # PptxViewerLib：query 解析 / 路徑安全 / 伺服器溝通（純邏輯、不碰 DOM）
    │   ├── vendor/                 # vendored PPTXjs 引擎（js/ + css/）+ LICENSE.PPTXjs
    │   ├── materialize-dark.css    # 家族共用資產（Materialize 深色）
    │   ├── side-tool.css           # 右側浮動工具列
    │   ├── thinking-dot.css        # 共用載入點 utility
    │   ├── i18n.js                 # i18n 引擎
    │   └── locales/{zh-Hant,en,ja}.js
    └── upload/pptx-viewer/         # 上傳的簡報（內容不進版控；附一個 sample）
```

## API

| Method / Path | 說明 |
|---|---|
| `POST /api/upload?folder=pptx-viewer` | 上傳（form 欄位 `myFiles`、多檔；指定 `folder` 時保留原檔名 → 覆寫）|
| `GET /api/pptx-viewer/files` | 列出 `public/upload/pptx-viewer/` 下可見檔（新→舊）|
| `POST /api/pptx-viewer/clear` | 刪除該資料夾下所有可見檔（保留資料夾與隱藏檔）|

靜態讀檔：`/upload/pptx-viewer/<name>`。所有 API 一律 `{ ok }` 信封。

`GET /api/pptx-viewer/files` 回傳：

```jsonc
{
  "ok": true,
  "files": [
    { "name": "string", "size": 0, "mtime": 0 }   // mtime = epoch ms；依新→舊排序
  ]
}
```

## 核心 library（`PptxViewerLib`）

純邏輯、不碰 DOM，可獨立嵌入。真正的「`.pptx → HTML`」由 PPTXjs（`$el.pptxToHtml()`）完成，它會寫 DOM，故該呼叫（連同完成偵測、縮放、導覽）留在控制器、不在 library。

工具：`parseQuery`（穩健解析 `?pptx=`）、`isSafeLink`、`isUploadable`（`.pptx`/`.ppsx`）、`basename`、`encodePath`、`fileUrl`、`checkFile`、`listFiles`、`uploadFile`、`clearFolder`、`formatSize`、`timestamp`。

## 備註

- 前端以**絕對路徑**呼叫 API（`/api/...`、`/upload/...`），須由本專案 Node 伺服器從**站台根**提供。**不相容 GitHub Pages**（純靜態託管跑不了上傳 / 列表 / 清空 API）。
- PPTXjs 屬盡力而為的渲染器；複雜效果、部分圖表、以及**從 Google Slides 匯出**的檔案可能渲染不完美或失敗——用 PowerPoint / LibreOffice 重新另存通常即可解決。
- 本 app 屬 **nodeapp WebApp 家族**；共同規範見 [nodeapp-webapp-family](https://github.com/scottgfhong310/nodeapp-webapp-family)。

## 授權

[MIT](./LICENSE) © 2026 [Scott G.F. Hong](https://github.com/scottgfhong310)

bundled 的 PPTXjs 引擎與其相依套件各自保有授權——見 [LICENSE](./LICENSE) 與 `public/apps/pptx-viewer/vendor/`。
