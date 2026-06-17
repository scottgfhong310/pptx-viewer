# pptx-viewer — 設計文件

> 開發者面向的設計與實作參考。使用說明見 [README](./README.md)；快速定位 / canon 重點見 [CLAUDE.md](./CLAUDE.md)；
> 家族共同規範見 [nodeapp-webapp-family](https://github.com/scottgfhong310/nodeapp-webapp-family)（`DESIGN_GUIDELINES.md` / `WORKFLOW.md` / `PLAYBOOK.md`）。
> 本 app 屬「**viewer 類**」家族成員，與 `html-/docx-/xlsx-viewer` 共用同一套骨架（見 §6 與家族 §4.7）。

---

## 1. 定位與目標

在瀏覽器內**檢視 PowerPoint 簡報（`.pptx` / `.ppsx`）**：以 **vendored PPTXjs** 把每張投影片排成 HTML、縮放貼齊容器寬，並提供投影片數字導覽。
零打包；薄後端；核心純邏輯抽 lib。**本支是四支 viewer 中最棘手的**——引擎重、挑檔、無完成事件，且需 vendoring（見 §5）。

## 2. 架構與資料流

```
使用者
  │  拖拉 / 點選 / ?pptx=<路徑> / 側欄點擊
  ▼
pptx-viewer.js（控制器，碰 DOM）
  │  loadAndShow(link)
  ├─ PptxViewerLib.isSafeLink(link)            // 路徑安全（純）
  ├─ PptxViewerLib.checkFile(link)             // 先 GET 確認存在（給清楚 404）
  ▼
$('#pv-container').pptxToHtml({ pptxFileUrl })  // vendored PPTXjs：寫 DOM、無完成事件
  │  （MutationObserver 等第一張 .slide；idle/總時逾時；攔 console.error）
  ▼
wrapAndScaleSlides()  // 每張 .slide 包 .slide-frame + transform:scale 貼齊寬
buildSlideNav()       // 左側數字導覽 + scroll-spy
```

- **依賴載入順序**：jQuery → Materialize → Lodash → `vendor/js/{jszip,filereader,d3,nv.d3,pptxjs,divs2slides,jquery.fullscreen}` → `pptx-viewer-lib.js` → `i18n.js` → `locales/*` → `pptx-viewer.js`；CSS：`vendor/css/{pptxjs,nv.d3.min}.css` 在 `pptx-viewer.css` **之前**（讓本頁覆寫勝出）。
- revealjs **不需要**（只在 `slideMode:true` 用；本支 `slideMode:false` 滾動顯示）。

## 3. 後端（Express）

與家族一致：`app.js`、`routes/upload.js`（共用最小版）、`routes/pptx-viewer.js`（`/files`、`/clear`）。

| Method / Path | 說明 | 回應 |
|---|---|---|
| `POST /api/upload?folder=pptx-viewer` | 上傳（多檔、覆寫）| `{ ok, ... }` |
| `GET /api/pptx-viewer/files` | 列出 `public/upload/pptx-viewer/` | `{ ok, files:[{name,size,mtime}] }` |
| `POST /api/pptx-viewer/clear` | 清空該資料夾 | `{ ok, removed }` |

## 4. 前端

### 4.1 `index.html`（純結構）
- 防閃爍開機腳本（`localStorage('pptx-viewer-theme')||'dark'`）。
- 結構：側欄、空狀態、`#pv-doc`（toolbar：icon + 檔名 + `#pv-doc-count` 張數 meta；`#pv-container`：PPTXjs 輸出）、`#pv-slide-nav`（左側導覽）、loading、drop-overlay、`#file-picker`（accept `.pptx,.ppsx`）、side-tools。

### 4.2 `pptx-viewer.css`（主題 token + 樣式）
- 家族標準 token（**只供外殼**）+ `--mz-*` 映射 + `--stage`（已載入時整頁的「舞台」底色）。
- `.slide-frame` 恆白（`background:#fff`）+ `--slide-shadow`；`.pptx-wrapper .slide` `transform-origin:top left`；覆寫 PPTXjs 的 inline height（`#all_slides_warpper{height:auto!important}`）。
- 左側 `#pv-slide-nav`（fixed、垂直置中、數字 pill、active 用 `--accent`）；`#pv-container.has-nav` 留左側留白。
- `@media print`：隱藏外殼、`page-break-inside:avoid`。

### 4.3 `vendor/`（vendored PPTXjs 引擎）
- `js/`：`jszip.min.js`、`filereader.js`、`d3.min.js`、`nv.d3.min.js`、`pptxjs.js`、`divs2slides.js`、`jquery.fullscreen-min.js`；`css/`：`pptxjs.css`、`nv.d3.min.css`；外加 `LICENSE.PPTXjs`。
- 來源：`meshesha/PPTXjs`（provenance commit `1a9260b`）。§9.1 bundled 聲明在根 `LICENSE`。

### 4.4 `pptx-viewer-lib.js`（核心 library，`window.PptxViewerLib`，純邏輯、不碰 DOM）
PPTXjs 直接寫 DOM → **渲染不進 lib**。lib 只裝：`parseQuery(?pptx=)`、`isSafeLink`、`isUploadable`（`/\.(pptx|ppsx)$/i`）、`basename`、`encodePath`、`fileUrl`、`checkFile`（先 GET 確認存在）、`listFiles`/`uploadFile`/`clearFolder`、`formatSize`/`timestamp`/`escapeHtml`。

### 4.5 `pptx-viewer.js`（控制器，碰 DOM）— 本支重點在此
- **`renderPptx(url)`**：PPTXjs 沒有 promise/callback 完成事件，故用一套韌性 glue：
  - `MutationObserver` 觀察 `#pv-container`，**第一次出現 `.slide`** 即視為成功 → `finish()`（量張數、`wrapAndScaleSlides`、`buildSlideNav`、`hideLoading`）。
  - `scheduleIdle()`：安靜超過 `IDLE_LIMIT`（30s）或總計超過 `MAX_TOTAL`（3min）且仍無 slide → 逾時 toast。
  - 覆寫 `console.error`：沒有 slide 時把 PPTXjs 的錯誤轉成「解析失敗」toast（含 Google Slides 匯出提示）。
  - `elapsedTimer`：每秒更新 loading 文字的經過秒數。
- **`teardownRender()`**：切檔 / 清空 / 完成都呼叫——`disconnect` observer 與 ResizeObserver、清 timers、`off('.pptxView')` 具名 handler、**還原被覆寫的 `console.error`**。避免跨檔累積。
- **`wrapAndScaleSlides()`**：每張 `.slide` 包進 `.slide-frame`，`transform:scale()` 貼齊容器寬（PPTXjs 原生 1280×720）；多次延遲重算 + `ResizeObserver` + `resize.pptxView`。
- **`buildSlideNav()`**：左側數字導覽（右側被家族 side-tools 佔用）+ 平滑捲動 + scroll-spy。**顯示用 `style.display='block'`（不可用 `''`，會落回 CSS `none`——家族 §5 坑）。**
- 其餘同家族：清單 / 上傳 / 清空 / 拖拉 / i18n / `?pptx=` 深連結 / `#setting-download` 下載側鍵（§4.7）。

## 5. 關鍵設計決策（與理由 / 替代方案）

1. **引擎：PPTXjs。** 瀏覽器端零打包能渲染 pptx 的實際選項極少；PPTXjs 是唯一務實解（原型已採）。代價是重（含 d3/nv.d3）且挑檔。
2. **vendored（非 CDN）。** 上游只在 `jsdelivr-gh` 預設分支發佈（**未鎖版本**），對發佈 repo 太脆。改 vendoring → 自給自足、可重現；附 §9.1 bundled 聲明 + provenance commit。替代：pin commit 的 CDN（較輕但仍依賴外部）。
3. **渲染留控制器 + 韌性 glue。** PPTXjs 寫 DOM 且無完成事件（§6）；必須自建完成偵測與逾時，並嚴格 teardown。
4. **只有外殼跟主題；投影片維持作者原貌。** 簡報本身就是一套設計（自帶背景/配色/圖片），硬轉深會破壞排版 → `.slide-frame` 恆白 + `--stage` 舞台底色。**這與 docx 紙張 / xlsx 表格「跟主題」的決議不同，因內容性質不同。**
5. **導覽放左側。** 右側已是家族 side-tools，數字導覽改置左側避免衝突。
6. **白名單 pptx/ppsx。** 皆 OOXML 簡報；舊版二進位 `.ppt` PPTXjs 不支援故不收。
7. **下載走側鍵**（家族 §4.7）。

## 6. lib / 控制器邊界（家族 §4.7）

pptx-viewer 落在「**引擎直接寫 DOM**」這側（同 docx-viewer）：`checkFile` 等純邏輯在 lib，`pptxToHtml` + 完成偵測 + 縮放 + 導覽全在控制器。與「引擎回純資料、連組字串都進 lib」的 `xlsx-viewer` 形成對比。

## 7. 主題 / i18n / 安全

- **主題**：CSS 變數 light/dark（**只外殼**），預設 dark；防閃爍；Materialize 深色交給共用 `materialize-dark.css`。
- **i18n**：引擎 + locales×3，預設 `zh-Hant`；`meta.slides {n}`、`toast.parseFail`/`parseTimeout`（含 Google Slides 提示）；**投影片內容是 data，永不翻譯**。
- **安全**：上傳白名單（picker + `isUploadable`）；`isSafeLink`；後端操作目標寫死、`{ok}` 信封、5mb 上限、`confirm`。注意：PPTXjs 渲染進本頁 light DOM（非 sandbox）——**只檢視信任來源的簡報**。

## 8. 已知限制與取捨

- **PPTXjs 盡力而為**：複雜效果、部分圖表、**Google Slides 匯出**的檔可能渲染不完美或失敗——提示使用者用 PowerPoint / LibreOffice 另存再試。
- **載入較慢**：引擎重 + 大檔解析慢；故有經過秒數與逾時設計。
- **非 sandbox**：見 §7 信任邊界。
- **vendoring 維護**：上游更新需手動重抓並更新 provenance commit。

## 9. 參考

- 家族規範：`DESIGN_GUIDELINES.md`（§4.1 拆分、§4.7 viewer 引擎與 lib 邊界、§5 視覺、§6 i18n、§8 安全、§9.1 bundled LICENSE）。
- 流程：`WORKFLOW.md`、`PLAYBOOK.md`（§5 `display=''` 坑）。
- 上游：[PPTXjs](https://github.com/meshesha/PPTXjs)（+ d3 / nv.d3 / JSZip，各自授權見根 `LICENSE` 與 `vendor/`）。
