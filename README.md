# pptx-viewer

**English** · [中文](README.zh-Hant.md) · [日本語](README.ja.md)

A single-page web app to **view PowerPoint presentations (`.pptx` / `.ppsx`) in the browser**. It renders with [PPTXjs](https://github.com/meshesha/PPTXjs) (**vendored** into the repo) — each slide is laid out as HTML, scaled to fit the width, with a slide-number navigator. Backed by a lightweight Express server for upload / list / clear.

- 🖼️ **Slide rendering** — PPTXjs converts each slide to HTML; the controller wraps every slide in a frame and `transform: scale()`s it to fit the container, re-scaling on resize
- 🔢 **Slide navigator** — a fixed left-side numbered rail with smooth-scroll + scroll-spy highlighting; slide count in the toolbar
- 📥 **Drag & drop upload** — drop a presentation anywhere on the page; **same name overwrites**
- 🔗 **Deep links** — open any file with `?pptx=<path>` (relative to the viewer, or an allow-listed absolute path); shareable & back/forward aware. Robust query parsing keeps `+` from turning into spaces
- 🌗 **Light / Dark** toggle (saved in localStorage) — the **shell** (toolbar, stage, navigator) follows the theme; **slides keep their authored appearance** (a slide deck is its own design — recoloring it would break it)
- 🌐 **Multilingual UI** — 繁體中文 / English / 日本語 (default 繁體中文, saved in localStorage). Slide content is data and is **never translated**
- 🛡️ **Path safety** — blocks `..`, backslashes, `javascript:` / `file:` schemes, protocol-relative `//`, and non-allow-listed absolute paths
- 🗂️ File-list sidebar, download the original file, empty folder
- ⏳ **Resilient parse** — PPTXjs has no completion event, so a MutationObserver detects the first slide, with an idle/total timeout and a friendly hint for Google-Slides exports

> The app's own front-end libraries (jQuery, Materialize, Lodash, Material Icons) load from CDN. The PPTXjs engine (with d3 / nv.d3 / JSZip) is **vendored** under `public/apps/pptx-viewer/vendor/` for reproducibility (no unpinned upstream) — see the bundled-license note in [LICENSE](./LICENSE). `npm install` only pulls the backend dependencies.

## Quick start

Requires Node.js 18+.

```bash
npm install
npm start
# open http://localhost:3000/apps/pptx-viewer/
```

Set `PORT` to change the port: `PORT=8080 npm start`.

## Directory structure

```
pptx-viewer/
├── app.js                          # Standalone Express server (static + 2 APIs)
├── package.json
├── routes/
│   ├── upload.js                   # POST /api/upload?folder=pptx-viewer (multer, multi-file, overwrite)
│   └── pptx-viewer.js              # GET /files, POST /clear
└── public/
    ├── apps/pptx-viewer/           # Front end (served at /apps/pptx-viewer/)
    │   ├── index.html              # Structure only
    │   ├── pptx-viewer.css         # Theme tokens (shell) + page styles
    │   ├── pptx-viewer.js          # Controller (glue): theme / i18n / upload / PPTXjs render + scale + nav
    │   ├── pptx-viewer-lib.js      # PptxViewerLib: query parse / path safety / server I/O (pure, no DOM)
    │   ├── vendor/                 # Vendored PPTXjs engine (js/ + css/) + LICENSE.PPTXjs
    │   ├── materialize-dark.css    # Shared family asset (Materialize dark)
    │   ├── side-tool.css           # Right-side floating toolbar
    │   ├── thinking-dot.css        # Shared loading-dot utility
    │   ├── i18n.js                 # i18n engine
    │   └── locales/{zh-Hant,en,ja}.js
    └── upload/pptx-viewer/         # Uploaded presentations (contents are git-ignored; one sample shipped)
```

## API

| Method / Path | Description |
|---|---|
| `POST /api/upload?folder=pptx-viewer` | Upload (form field `myFiles`, multi-file; keeps the original name when `folder` is set → overwrites) |
| `GET /api/pptx-viewer/files` | List visible files in `public/upload/pptx-viewer/` (newest first) |
| `POST /api/pptx-viewer/clear` | Delete all visible files in that folder (keeps the folder & hidden files) |

Static read: `/upload/pptx-viewer/<name>`. All API responses use the `{ ok }` envelope.

`GET /api/pptx-viewer/files` returns:

```jsonc
{
  "ok": true,
  "files": [
    { "name": "string", "size": 0, "mtime": 0 }   // mtime = epoch ms; sorted newest → oldest
  ]
}
```

## Core library (`PptxViewerLib`)

Pure logic, no DOM — embeddable on its own. The actual `.pptx → HTML` rendering is done by PPTXjs (`$el.pptxToHtml()`), which writes to the DOM, so that call (plus completion-detection, scaling, and the navigator) lives in the controller — not the library.

Helpers: `parseQuery` (robust `?pptx=`), `isSafeLink`, `isUploadable` (`.pptx`/`.ppsx`), `basename`, `encodePath`, `fileUrl`, `checkFile`, `listFiles`, `uploadFile`, `clearFolder`, `formatSize`, `timestamp`.

## Notes

- The front end calls APIs with **absolute paths** (`/api/...`, `/upload/...`), so it must be served from the **site root** by this project's Node server. **Not GitHub-Pages-compatible** (static hosting can't run the upload / list / clear APIs).
- PPTXjs is a best-effort renderer; complex effects, some charts, and decks **exported from Google Slides** may render imperfectly or fail — re-saving the file in PowerPoint / LibreOffice usually fixes it.
- This app belongs to the **nodeapp WebApp family**; shared conventions live in [nodeapp-webapp-family](https://github.com/scottgfhong310/nodeapp-webapp-family).

## License

[MIT](./LICENSE) © 2026 [Scott G.F. Hong](https://github.com/scottgfhong310)

The bundled PPTXjs engine and its dependencies retain their own licenses — see [LICENSE](./LICENSE) and `public/apps/pptx-viewer/vendor/`.
