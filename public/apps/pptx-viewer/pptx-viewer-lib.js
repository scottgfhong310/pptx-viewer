/**
 * PptxViewerLib — pptx-viewer 前端核心 library（可嵌入式、純邏輯、不碰 DOM）
 *
 * 把「query string 解析」「路徑安全檢查 / 逐段編碼」「與伺服器溝通」抽成一支 library；
 * index.html / pptx-viewer.js 只負責 DOM（呼叫 PPTXjs 渲染、縮放、導覽、事件、toast）。
 *
 * 設計重點：
 *   - 真正的「.pptx → HTML 投影片」由 vendored PPTXjs（jQuery plugin `$el.pptxToHtml()`）完成，
 *     它**直接寫 DOM**，因此渲染呼叫留在控制器 pptx-viewer.js；本 lib 只裝純邏輯。
 *   - 開檔來源有二：①側欄清單（上傳進來的檔）②網址深連結 ?pptx=<路徑>。
 *     深連結沿用原型的穩健解析：避開 URLSearchParams 把 '+' 變空白。
 *
 * 後端對應：
 *   - 上傳： POST /api/upload?folder=pptx-viewer   （form 欄位 myFiles，多檔）
 *   - 列表： GET  /api/pptx-viewer/files
 *   - 清空： POST /api/pptx-viewer/clear
 *   - 靜態讀檔： /upload/pptx-viewer/<name>
 *
 * 依賴：無（原生 fetch / URL / location）。建議與 jQuery / Materialize / Lodash / PPTXjs 一起載入。
 *
 * Public API：
 *   PptxViewerLib.FOLDER                    → 'pptx-viewer'
 *   PptxViewerLib.ALLOWED_ABSOLUTE_PREFIXES → string[]
 *   PptxViewerLib.escapeHtml(s)             → string
 *   PptxViewerLib.parseQuery(search)        → { pptx?:string, ... }  穩健解析 ?pptx=
 *   PptxViewerLib.isSafeLink(link)          → boolean
 *   PptxViewerLib.isUploadable(name)        → boolean   .pptx / .ppsx
 *   PptxViewerLib.basename(link)            → string
 *   PptxViewerLib.encodePath(link)          → string    逐段 encodeURIComponent，保留 '/'
 *   PptxViewerLib.fileUrl(name)             → string    /upload/pptx-viewer/<name>（原始、未編碼）
 *   PptxViewerLib.checkFile(link)           → Promise<true>   GET 確認檔案存在（否則 reject）
 *   PptxViewerLib.uploadFile(file)          → Promise<resp>
 *   PptxViewerLib.listFiles()               → Promise<Array<{name,size,mtime}>>
 *   PptxViewerLib.clearFolder()             → Promise<{ok,removed}>
 *   PptxViewerLib.timestamp(date)           → 'yyyyMMddHHmmss'
 *   PptxViewerLib.formatSize(bytes)         → 'xx KB'
 */
(function (window) {
  'use strict';

  var FOLDER = 'pptx-viewer';
  var UPLOAD_API = '/api/upload?folder=' + FOLDER;
  var FILES_API = '/api/pptx-viewer/files';
  var CLEAR_API = '/api/pptx-viewer/clear';
  var STATIC_BASE = '/upload/' + FOLDER + '/';

  var ALLOWED_ABSOLUTE_PREFIXES = [
    STATIC_BASE   // '/upload/pptx-viewer/' — 上傳進來的檔
  ];

  // 可上傳 / 可檢視的副檔名（OOXML 簡報；ppsx 為放映檔，PPTXjs 同樣可讀）
  var UPLOADABLE_RE = /\.(pptx|ppsx)$/i;

  function pad2(n) { return ('0' + n).slice(-2); }

  function bust(url) {
    return url + (url.indexOf('?') >= 0 ? '&' : '?') + '_=' + Date.now();
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // 穩健解析 query string（取代 URLSearchParams：它會把 '+' 變空白）。
  function parseQuery(search) {
    var out = {};
    var s = String(search || '');
    if (s.charAt(0) === '?') s = s.slice(1);
    if (!s) return out;
    s.split('&').forEach(function (pair) {
      if (!pair) return;
      var i = pair.indexOf('=');
      var k = i === -1 ? pair : pair.slice(0, i);
      var val = i === -1 ? '' : pair.slice(i + 1);
      try { out[decodeURIComponent(k)] = decodeURIComponent(val); }
      catch (e) { out[k] = val; }
    });
    return out;
  }

  // 路徑安全：擋穿越（..）、反斜線、任意 scheme、protocol-relative（//）；
  // 絕對路徑須命中允許清單，相對路徑（相對 viewer 目錄）一律放行。
  function isSafeLink(link) {
    if (!link || typeof link !== 'string') return false;
    if (link.indexOf('..') !== -1) return false;
    if (link.charAt(0) === '\\') return false;
    if (/^[a-z][a-z0-9+.-]*:/i.test(link)) return false;
    if (link.indexOf('//') === 0) return false;
    if (link.charAt(0) === '/') {
      return ALLOWED_ABSOLUTE_PREFIXES.some(function (p) { return link.indexOf(p) === 0; });
    }
    return true;
  }

  function isUploadable(name) {
    return UPLOADABLE_RE.test(String(name || ''));
  }

  function basename(link) {
    var seg = String(link || '').split('?')[0].split('/').pop();
    try { seg = decodeURIComponent(seg); } catch (e) {}
    return seg || String(link || '');
  }

  // 逐段 encodeURIComponent，保留 '/'——只對「原始（解碼後）」路徑用。
  function encodePath(link) {
    return String(link || '').split('/').map(encodeURIComponent).join('/');
  }

  function fileUrl(name) {
    return STATIC_BASE + name;
  }

  var PptxViewerLib = {

    FOLDER: FOLDER,
    ALLOWED_ABSOLUTE_PREFIXES: ALLOWED_ABSOLUTE_PREFIXES,

    escapeHtml: escapeHtml,
    parseQuery: parseQuery,
    isSafeLink: isSafeLink,
    isUploadable: isUploadable,
    basename: basename,
    encodePath: encodePath,
    fileUrl: fileUrl,

    /** 先 GET 確認檔案存在（PPTXjs 內部錯誤訊息不直觀，先擋一層給清楚的 404）。 */
    checkFile: function (link) {
      return fetch(encodePath(link), { method: 'GET', cache: 'no-store' })
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return true;
        });
    },

    /** 上傳單一檔案到 /upload/pptx-viewer（同名覆寫）。回傳伺服器 JSON；失敗 reject。 */
    uploadFile: function (file) {
      var fd = new FormData();
      fd.append('myFiles', file);
      return fetch(UPLOAD_API, { method: 'POST', body: fd })
        .then(function (r) { return r.json().catch(function () { return null; }); })
        .then(function (resp) {
          if (!resp || !resp.ok) throw new Error((resp && resp.error) || '上傳失敗');
          return resp;
        });
    },

    /** 列出資料夾內檔案（依修改時間新→舊） */
    listFiles: function () {
      return fetch(bust(FILES_API), { cache: 'no-store' })
        .then(function (r) {
          if (!r.ok) throw new Error('列表載入失敗 (' + r.status + ')');
          return r.json();
        })
        .then(function (d) { return (d && d.files) || []; });
    },

    /** 清空資料夾下所有可見檔案 */
    clearFolder: function () {
      return fetch(CLEAR_API, { method: 'POST' })
        .then(function (r) { return r.json().catch(function () { return null; }); })
        .then(function (d) {
          if (!d || !d.ok) throw new Error((d && d.error) || '清空失敗');
          return d;
        });
    },

    /** 本地時間 yyyyMMddHHmmss */
    timestamp: function (date) {
      var d = date || new Date();
      return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) +
        pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
    },

    /** 人類可讀的檔案大小 */
    formatSize: function (bytes) {
      bytes = Number(bytes) || 0;
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    }
  };

  window.PptxViewerLib = PptxViewerLib;
})(window);
