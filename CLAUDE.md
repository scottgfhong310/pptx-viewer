# pptx-viewer — Session context

在瀏覽器內**檢視 PowerPoint 簡報（`.pptx`/`.ppsx`）**的單頁 WebApp：以 **vendored PPTXjs** 渲染，每張投影片排成 HTML、縮放貼齊、左側數字導覽。輕量 Express 後端（上傳 / 列表 / 清空）。由 `xlsx-viewer` 起手式複製改名而來（Path A，xlsx ← docx ← html-viewer ← markdown-reader），共用家族 canon（主題 / i18n / 四件式 / side-tool）。

本 app 屬於 **nodeapp WebApp 家族**；共同規範與流程在
<https://github.com/scottgfhong310/nodeapp-webapp-family>（`DESIGN_GUIDELINES.md` 規範、`WORKFLOW.md` 流程、`PLAYBOOK.md` 逐步劇本）。**改動前請先讀那幾份，照其中 canon 做。**

**設計細節（架構 / 逐模組 / 決策 / 限制）見 [DESIGN.md](./DESIGN.md)。**

## 結構

```
app.js                              # Express 入口：port 3000；/ → 302 /apps/pptx-viewer/
routes/upload.js                    # POST /api/upload?folder=pptx-viewer（家族共用最小版：權威版＝ nodeapp-webapp-family/routes-upload.js，byte-identical；含檔名消毒 sanitizeUploadName，§3.4）
routes/pptx-viewer.js               # GET /files、POST /clear
public/apps/pptx-viewer/            # 前端（服務於 /apps/pptx-viewer/）
├─ index.html · pptx-viewer.css · pptx-viewer.js · pptx-viewer-lib.js
├─ vendor/                          # vendored PPTXjs 引擎（js/ + css/）+ LICENSE.PPTXjs
├─ materialize-dark.css · side-tool.{css,js} · thinking-dot.css   # thinking-dot.css＝共用載入點 utility（權威＝獨立 repo thinking-dot；載入點預設 2026-07-19 隨權威統一 14px→27px/2.1s）
├─ i18n.js · locales/{zh-Hant,en,ja}.js
public/upload/pptx-viewer/          # 上傳的簡報（內容不進版控；附一個 .pptx sample）
scripts/make-icons.py               # viewer 六支共用的 icon 產生器（六份 byte-identical）
scripts/sync-copies.sh              # viewer 六支共用的回灌腳本（同上；不碰 upload.js／public/upload/）
public/apps/pptx-viewer/icons/              # App icon：母版 SVG 深/淺＋favicon(.ico/.svg)＋PNG 16–512＋manifest

```

## 執行 / 驗證

```bash
npm install && node app.js          # → http://localhost:3000/apps/pptx-viewer/
```

## App icon（viewer 六支共用模板）

```bash
python3 scripts/make-icons.py       # 重產整套 icon（SVG／PNG／.ico／manifest）
```

`docx-viewer`／`html-viewer`／`pptx-viewer`／`xlsx-viewer`／`rare-glyph`／`svg-style`
**共用同一支產生器**（六份 byte-identical，照家族 A 類共用件慣例；改一份要六份一起同步，
`md5` 應為單一 hash）。它靠**自己所在的 repo 目錄名**決定產哪一支，所以六份不必各自改參數。

**共用的是 tile 系統，不是圖案**：同樣的圓角方塊、同樣的「紙」與同樣的 accent
（`#90caf9`——六支的 `--accent` 本來就相同），一眼是一套；差異只在裡面那枚純幾何標記。
本 app 是 **16:9 實心區塊＋導覽條（投影片）**。

- **刻意不用副檔名字樣**（`.docx` 這種）：六支裡 `rare-glyph`／`svg-style` 根本不是文件檢視器，
  套上去會說謊。純幾何也省掉字型依賴（光柵化時不必內嵌字型）。
- ⚠️ **PyMuPDF 兩個限制**（家族其他 icon 也踩過）：① **不渲染 `linearGradient`**，會整片退成黑色
  → 母版一律純色底；② **以 SVG 宣告的 `width`/`height` 為渲染基準、不是 `viewBox`**
  → 倍率要用「目標 ÷ 實際 page 寬」反推。
- **產出要排出來看**：`html-viewer` 第一版的角括號尖端朝內，讀起來是一個 ✕ 而不是 `< >`——
  九個 PNG 都產出、尺寸都對，光看檔案清單完全發現不了。

### 回灌 InProgress

```bash
bash scripts/sync-copies.sh
```

同樣是 **viewer 六支共用、byte-identical 的一份**（靠 repo 目錄名認自己是誰）。
**兩個絕對不覆蓋的東西**：`routes/upload.js`（InProgress 是加強版，往回蓋會弄壞孵化器上
所有 app 的上傳——腳本只搬 `routes/<app>.js`，並在偵測到兩邊變成一樣時出聲）、
`public/upload/`（使用者實際上傳的檔案，從不觸碰）。`app.js` 同理不同步。
共用件一律**只驗不抓**，不一致時明講去哪個 repo 同步、回非 0。

## 本 app 的 canon 重點

- **渲染引擎是 vendored PPTXjs**（`meshesha/PPTXjs`，jQuery plugin `$el.pptxToHtml()`）：**vendored 進 `vendor/`**（不吃未鎖版的 jsdelivr gh CDN，確保可重現；§9.1 bundled 聲明在 `LICENSE` + `vendor/LICENSE.PPTXjs`，provenance commit `1a9260b`）。鏈：`vendor/js/{jszip,filereader,d3,nv.d3,pptxjs,divs2slides,jquery.fullscreen}` + `vendor/css/{pptxjs,nv.d3.min}.css`（pptxjs.css 在本頁 CSS 之前載入以便覆寫）。revealjs **不需要**（只在 slideMode 用；我們 `slideMode:false`）。
- **lib 邊界（同 docx：引擎寫 DOM → 渲染留控制器）**：PPTXjs `pptxToHtml` **直接寫 DOM 且無完成事件**，故渲染呼叫 + 完成偵測 + 縮放 + 導覽都在控制器，**不進 lib**。`pptx-viewer-lib.js`（`window.PptxViewerLib`，純邏輯、不碰 DOM）只裝：`parseQuery(?pptx=)`、`isSafeLink`、`isUploadable(.pptx/.ppsx)`、`basename`、`encodePath`、`fileUrl`、`checkFile`（先 GET 確認存在）、`listFiles`/`uploadFile`/`clearFolder`、`formatSize`/`timestamp`。
- **控制器** `pptx-viewer.js`（碰 DOM）：
  - `renderPptx(url)`：PPTXjs 無 promise → **MutationObserver** 等第一張 `.slide`、`scheduleIdle`（30s 無變動 / 3min 上限逾時 → toast）、覆寫 `console.error` 攔解析失敗、elapsed 秒數更新 loading 文字。完成 / 切檔 / 清空都呼叫 `teardownRender()` 清掉 observer / ResizeObserver / timers / 具名 window handler、還原 `console.error`（避免累積）。
  - `wrapAndScaleSlides()`：每張 `.slide` 包進 `.slide-frame`，`transform:scale()` 貼齊容器寬（PPTXjs 原生 1280×720），ResizeObserver + `resize.pptxView` 重算。
  - `buildSlideNav()`：**左側**固定數字導覽（右側被家族 side-tools 佔用）+ 平滑捲動 + scroll-spy。**顯示要設 `style.display='block'`，不能用 `''`（會落回 CSS display:none，家族 §5 坑）。**
  - `?pptx=` 深連結（`pushState`/`popstate`）。
- **主題（只有外殼！）**：CSS 變數 light/dark，**預設 dark**（`localStorage('pptx-viewer-theme')||'dark'`）；防閃爍開機腳本同時 toggle `dark-mode`/`light-mode` class。**投影片是作者設計的視覺，不跟主題變深**——只有外殼（toolbar / `--stage` 底色 / 導覽 / 空狀態）跟主題；`.slide-frame` 恆白。切主題只翻 `data-theme`、不重新渲染。列印 `@media print` 隱藏外殼、投影片 `page-break-inside:avoid`。
- **i18n**：`i18n.js` + `locales/*.js`，`data-i18n`，預設 `zh-Hant`；`meta.slides {n}`、`toast.parseFail`/`parseTimeout`（含 Google Slides 匯出提示）。投影片內容是 **data，永不翻譯**。
- **side-tool**：`#setting-menu`/`#setting-download`（下載原始檔，只在開檔時顯示、臨時 `<a download>` + check 回饋、href 經 `encodePath`）/`#setting-clear`/`#setting-mode`/`#setting-lang`；〔正統〕flex `.side-tools`，**chrome 墊底**（§5.5 排列順序，2026-07-26 收斂）。**下載走側鍵、toolbar 不放操作鍵**（家族 §4.7）。
- **安全**：上傳白名單 `.pptx`/`.ppsx`（picker accept + 前端 `isUploadable` 再驗）；後端操作目標寫死、`{ ok }` 信封；危險操作 `confirm()`。jQuery 3.7.1，後端不依賴 lodash。
- **限制**：PPTXjs 盡力而為；複雜效果 / 部分圖表 / Google Slides 匯出檔可能不完美或失敗（提示使用者用 PowerPoint 另存）。
- **InProgress 鏡像**：同名前端（含 `vendor/`）回灌到 `InProgress/public/apps/pptx-viewer/`，route 掛在 InProgress 的 `/api/pptx-viewer`；上傳沿用 InProgress 共用 `/api/upload?folder=pptx-viewer`（雙鍵 `{ ok, success }`，前端查 `resp.ok`）。
- **preview**：`GitHub/.claude/launch.json` 有一筆 `pptx-viewer`（`node pptx-viewer/app.js`，port 3000）。
