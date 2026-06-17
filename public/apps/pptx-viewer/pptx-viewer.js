/**
 * pptx-viewer — 頁面控制器（glue）
 *
 * DOM 行為：主題切換、i18n、開檔（?pptx= 或側欄清單）、上傳 / 拖拉 / 清空，
 * 呼叫 vendored PPTXjs 把 .pptx 渲染成投影片、縮放貼齊、建左側投影片導覽。
 * query 解析、路徑安全 / 編碼、伺服器溝通在 pptx-viewer-lib.js；
 * i18n 引擎在 i18n.js，語言字典在 locales/<code>.js。
 *
 * 依賴（皆於 index.html 先載入）：jQuery / Materialize / Lodash / PPTXjs(vendor)
 *   / PptxViewerLib / I18n（+ locales）。
 *
 * 註：PPTXjs（$el.pptxToHtml）**直接寫 DOM 且無完成事件**，故渲染呼叫 + 完成偵測（MutationObserver）
 *     + 縮放 + 導覽都留在這裡（非 lib）。投影片是作者設計的視覺，**不跟主題變深**——只有外殼跟主題。
 */

(function () {
  'use strict';

  var L = window.PptxViewerLib;
  var THEME_KEY = 'pptx-viewer-theme';

  var emptyState = document.getElementById('empty-state');
  var docBox = document.getElementById('pv-doc');
  var container = document.getElementById('pv-container');
  var $container = window.jQuery ? jQuery(container) : null;
  var docName = document.getElementById('pv-doc-name');
  var docCount = document.getElementById('pv-doc-count');
  var downloadBtn = document.getElementById('setting-download');
  var slideNav = document.getElementById('pv-slide-nav');
  var sideNav = document.getElementById('side-nav');
  var dropOverlay = document.getElementById('drop-overlay');
  var filePicker = document.getElementById('file-picker');

  var state = {
    theme: 'dark',
    current: null,
    name: '',
    files: []
  };

  // 渲染期間的資源（切檔 / 清空時要清掉，避免 observer / timer / handler 累積）
  var rt = { observer: null, ro: null, elapsedTimer: null, idleTimer: null, origConsoleError: null };

  var IDLE_LIMIT = 30000;    // 30s 無 DOM 變動 → 視為卡住
  var MAX_TOTAL = 180000;    // 3 分鐘上限

  /* ---------- 主題（只有外殼跟主題；投影片維持作者原貌） ---------- */

  function applyTheme(theme) {
    theme = theme === 'light' ? 'light' : 'dark';
    state.theme = theme;
    var r = document.documentElement;
    r.setAttribute('data-theme', theme);
    r.classList.toggle('dark-mode', theme === 'dark');
    r.classList.toggle('light-mode', theme === 'light');
    var icon = document.querySelector('#setting-mode i');
    if (icon) icon.textContent = theme === 'dark' ? 'dark_mode' : 'light_mode';
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
  }

  function toggleTheme() {
    applyTheme(state.theme === 'dark' ? 'light' : 'dark');
  }

  /* ---------- 顯示切換 ---------- */

  function showDoc(show) {
    docBox.style.display = show ? 'block' : 'none';
    emptyState.style.display = show ? 'none' : '';
    document.body.classList.toggle('is-empty', !show);
    // 下載側鍵只在有開檔時出現（.side-tool 預設 flex）
    if (downloadBtn) downloadBtn.style.display = show ? 'flex' : 'none';
  }

  // 「已執行」微回饋：icon 暫時變 check 800ms（家族 §5.5）
  function setIconDone(el) {
    var i = el && el.querySelector('i');
    if (!i) return;
    var orig = i.textContent;
    i.textContent = 'check';
    setTimeout(function () { i.textContent = orig; }, 800);
  }

  // 下載目前開啟的原始檔（逐段編碼 href + 原檔名 download）
  function downloadCurrent() {
    if (!state.current) return;
    var a = document.createElement('a');
    a.href = L.encodePath(state.current);
    a.download = state.name || L.basename(state.current);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setIconDone(downloadBtn);
  }

  /* ---------- loading 動畫（含經過秒數） ---------- */
  var loadingTimer = null;
  function showLoading() {
    clearTimeout(loadingTimer);
    loadingTimer = setTimeout(function () {
      var el = document.getElementById('loading');
      if (el) el.classList.add('show');
    }, 180);
  }
  function hideLoading() {
    clearTimeout(loadingTimer);
    var el = document.getElementById('loading');
    if (el) el.classList.remove('show');
    setLoadingText('');
  }
  function setLoadingText(extra) {
    var t = document.querySelector('#loading .loading-text');
    if (t) t.textContent = I18n.t('loading') + (extra || '');
  }

  /* ---------- 清理上一次渲染 ---------- */

  function teardownRender() {
    if (rt.observer) { rt.observer.disconnect(); rt.observer = null; }
    if (rt.ro) { rt.ro.disconnect(); rt.ro = null; }
    if (rt.elapsedTimer) { clearInterval(rt.elapsedTimer); rt.elapsedTimer = null; }
    if (rt.idleTimer) { clearTimeout(rt.idleTimer); rt.idleTimer = null; }
    if (rt.origConsoleError) { console.error = rt.origConsoleError; rt.origConsoleError = null; }
    $(window).off('.pptxView');
    slideNav.innerHTML = '';
    slideNav.style.display = 'none';
    container.classList.remove('has-nav');
  }

  function clearOutput() {
    teardownRender();
    container.innerHTML = '';
    docCount.textContent = '';
  }

  /* ---------- PPTXjs 渲染（無完成事件 → MutationObserver + idle timeout） ---------- */

  function failParse(msg) {
    teardownRender();
    hideLoading();
    M.toast({ html: I18n.t('toast.parseFail', { m: msg || '' }), classes: 'red', displayLength: 6000 });
    showDoc(false);
  }

  function renderPptx(fileUrl) {
    teardownRender();
    $container.empty().addClass('pptx-wrapper');

    var startTime = Date.now();
    var lastMutationAt = Date.now();
    var done = false;

    function finish() {
      if (done) return;
      done = true;
      if (rt.idleTimer) { clearTimeout(rt.idleTimer); rt.idleTimer = null; }
      if (rt.elapsedTimer) { clearInterval(rt.elapsedTimer); rt.elapsedTimer = null; }
      if (rt.origConsoleError) { console.error = rt.origConsoleError; rt.origConsoleError = null; }
      if (rt.observer) { rt.observer.disconnect(); rt.observer = null; }
      wrapAndScaleSlides();
      buildSlideNav();
      hideLoading();
    }

    // 經過秒數
    rt.elapsedTimer = setInterval(function () {
      var sec = Math.round((Date.now() - startTime) / 1000);
      setLoadingText(' (' + sec + 's)');
    }, 1000);

    // idle 檢查：安靜超過 IDLE_LIMIT 或總計超過 MAX_TOTAL 且還沒有 slide → 逾時
    function scheduleIdle() {
      rt.idleTimer = setTimeout(function () {
        if (done) return;
        if (container.querySelectorAll('.slide').length > 0) return;
        var idle = Date.now() - lastMutationAt;
        var total = Date.now() - startTime;
        if (idle >= IDLE_LIMIT || total >= MAX_TOTAL) {
          teardownRender();
          hideLoading();
          M.toast({ html: I18n.t('toast.parseTimeout', { s: Math.round(idle / 1000) }), classes: 'red', displayLength: 6000 });
          showDoc(false);
        } else {
          scheduleIdle();
        }
      }, 5000);
    }

    // 第一次出現 .slide → 完成
    rt.observer = new MutationObserver(function () {
      lastMutationAt = Date.now();
      var slides = container.querySelectorAll('.slide');
      if (slides.length > 0) {
        docCount.textContent = I18n.t('meta.slides', { n: slides.length });
        // 等下一個 tick 讓 PPTXjs 把每張 slide 的圖層也插入完
        setTimeout(finish, 60);
      }
    });
    rt.observer.observe(container, { childList: true, subtree: true });
    scheduleIdle();

    // PPTXjs 解析失敗多半只走 console.error → 覆寫攔截（沒有 slide 時才視為失敗）
    rt.origConsoleError = console.error;
    console.error = function () {
      rt.origConsoleError.apply(console, arguments);
      if (done) return;
      if (container.querySelectorAll('.slide').length > 0) return;
      var msg = Array.prototype.slice.call(arguments).map(function (a) {
        return (a && a.message) ? a.message : String(a);
      }).join(' ');
      failParse(msg);
    };

    try {
      $container.pptxToHtml({
        pptxFileUrl: fileUrl,
        slidesScale: '100%',
        slideMode: false,        // false = 滾動顯示全部投影片
        keyBoardShortCut: false
      });
    } catch (err) {
      failParse((err && err.message) || String(err));
    }
  }

  // 把每張 .slide 包進 .slide-frame，frame 尺寸跟容器寬，slide 用 transform:scale() 縮放維持比例
  function wrapAndScaleSlides() {
    var $slides = $container.find('.slide');
    $slides.each(function (i) {
      var $slide = $(this);
      if ($slide.parent().hasClass('slide-frame')) return;
      $slide.wrap('<div class="slide-frame" id="pv-slide-' + (i + 1) + '"></div>');
    });

    function applyScale() {
      var wrapperWidth = $container.width() - 24;
      $container.find('.slide-frame').each(function () {
        var $frame = $(this);
        var $slide = $frame.children('.slide').first();
        var slideW = parseFloat($slide.css('width')) || 1280;
        var slideH = parseFloat($slide.css('height')) || 720;
        var scale = Math.min(1, wrapperWidth / slideW);
        $slide.css('transform', 'scale(' + scale + ')');
        $frame.css({ width: (slideW * scale) + 'px', height: (slideH * scale) + 'px' });
      });
    }

    applyScale();
    [0, 100, 300, 800].forEach(function (d) { setTimeout(applyScale, d); });

    if (typeof ResizeObserver !== 'undefined') {
      rt.ro = new ResizeObserver(function () { applyScale(); });
      rt.ro.observe(container);
    }
    var resizeTimer;
    $(window).on('resize.pptxView', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(applyScale, 80);
    });
  }

  // 左側投影片數字導覽（固定、垂直置中；scroll-spy 高亮）
  function buildSlideNav() {
    var $frames = $container.find('.slide-frame');
    if (!$frames.length) return;
    var html = '';
    $frames.each(function (i) {
      var id = this.id || ('pv-slide-' + (i + 1));
      html += '<li><a href="#' + id + '" data-slide="' + (i + 1) + '">' + (i + 1) + '</a></li>';
    });
    slideNav.innerHTML = html;
    slideNav.style.display = 'block';   // 明確值；設 '' 會落回 CSS 的 display:none（家族 §5 坑）
    container.classList.add('has-nav');

    $(slideNav).off('click', 'a').on('click', 'a', function (e) {
      e.preventDefault();
      var target = document.querySelector($(this).attr('href'));
      if (!target) return;
      var top = target.getBoundingClientRect().top + window.pageYOffset - 16;
      window.scrollTo({ top: top, behavior: 'smooth' });
    });

    var $links = $(slideNav).find('a');
    function setActive(n) {
      $links.removeClass('active');
      $links.filter('[data-slide="' + n + '"]').addClass('active');
    }
    function updateActive() {
      var docHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
      var canScroll = docHeight > window.innerHeight + 4;
      if (canScroll && (window.scrollY + window.innerHeight) >= (docHeight - 4)) {
        setActive($frames.length); return;
      }
      var threshold = 24, bestNum = 1, bestTop = -Infinity;
      $frames.each(function (i) {
        var t = this.getBoundingClientRect().top;
        if (t <= threshold && t > bestTop) { bestTop = t; bestNum = i + 1; }
      });
      setActive(bestNum);
    }
    var rafId = null;
    $(window).on('scroll.pptxView resize.pptxView', function () {
      if (rafId) return;
      rafId = requestAnimationFrame(function () { rafId = null; updateActive(); });
    });
    updateActive();
  }

  /* ---------- 開檔 ---------- */

  function loadAndShow(link, displayName) {
    if (!L.isSafeLink(link)) {
      state.current = null; state.name = '';
      M.toast({ html: I18n.t('toast.badLink'), classes: 'red' });
      showDoc(false);
      return Promise.resolve();
    }
    if (!($container && $.fn && $.fn.pptxToHtml)) {
      M.toast({ html: I18n.t('toast.engineMissing'), classes: 'red' });
      return Promise.resolve();
    }
    state.current = link;
    state.name = displayName || L.basename(link);
    document.title = state.name + ' | ' + I18n.t('title.suffix');
    docName.textContent = state.name;
    docName.title = state.name;
    docCount.textContent = '';
    markActive(link);
    showDoc(true);
    showLoading();
    clearOutput();
    return L.checkFile(link)
      .then(function () { renderPptx(L.encodePath(link)); })
      .catch(function (err) {
        clearOutput();
        hideLoading();
        M.toast({ html: I18n.t('toast.loadFail', { n: state.name, m: err.message }), classes: 'red' });
        showDoc(false);
      });
  }

  function navigate(link, displayName) {
    try {
      history.pushState({ link: link }, '', '?pptx=' + encodeURIComponent(link));
    } catch (e) {}
    loadAndShow(link, displayName);
  }

  /* ---------- 檔案清單 ---------- */

  function markActive(link) {
    $('#side-nav li').removeClass('active');
    if (!link) return;
    var esc = window.CSS && CSS.escape ? CSS.escape(link) : link;
    $('#side-nav li[data-link="' + esc + '"]').addClass('active');
  }

  function renderSideNav(files) {
    if (!files.length) {
      sideNav.innerHTML = '<li><a style="color:var(--muted)!important;">' + I18n.t('side.noFiles') + '</a></li>';
      return;
    }
    sideNav.innerHTML = files.map(function (f) {
      var link = L.fileUrl(f.name);
      return '<li data-link="' + _.escape(link) + '">' +
        '<a href="#!" class="file-item" data-name="' + _.escape(f.name) + '">' +
        '<i class="material-icons">slideshow</i>' +
        '<span style="flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + _.escape(f.name) + '</span>' +
        '<span class="file-meta">' + L.formatSize(f.size) + '</span>' +
        '</a></li>';
    }).join('');
    markActive(state.current);
  }

  function refreshFiles(selectName, autoOpen) {
    return L.listFiles().then(function (files) {
      state.files = files;
      renderSideNav(files);
      if (selectName) {
        var hit = files.filter(function (f) { return f.name === selectName; })[0];
        if (hit) return navigate(L.fileUrl(hit.name), hit.name);
      }
      if (autoOpen && !state.current && files.length) {
        return loadAndShow(L.fileUrl(files[0].name), files[0].name);
      }
    }).catch(function (err) {
      M.toast({ html: I18n.t('toast.listFail', { m: err.message }), classes: 'red' });
    });
  }

  /* ---------- 上傳 ---------- */

  function uploadFiles(fileList) {
    var arr = Array.prototype.slice.call(fileList).filter(function (f) { return L.isUploadable(f.name); });
    if (!arr.length) {
      M.toast({ html: I18n.t('toast.notPptx'), classes: 'orange' });
      return;
    }
    var lastName = null;
    var chain = Promise.resolve();
    arr.forEach(function (file) {
      chain = chain.then(function () {
        return L.uploadFile(file).then(function () {
          lastName = file.name;
          M.toast({ html: I18n.t('toast.uploaded', { n: file.name }), classes: 'green' });
        }).catch(function (err) {
          M.toast({ html: I18n.t('toast.uploadFail', { n: file.name, m: err.message }), classes: 'red' });
        });
      });
    });
    chain.then(function () { return refreshFiles(lastName); });
  }

  /* ---------- 清空 ---------- */

  function clearFolder() {
    if (!confirm(I18n.t('confirm.clear'))) return;
    L.clearFolder().then(function (d) {
      M.toast({ html: I18n.t('toast.cleared', { n: d.removed || 0 }), classes: 'teal' });
      state.current = null; state.name = '';
      clearOutput();
      try { history.replaceState({}, '', './'); } catch (e) {}
      showDoc(false);
      document.title = I18n.t('title.suffix');
      return refreshFiles();
    }).catch(function (err) {
      M.toast({ html: I18n.t('toast.clearFail', { m: err.message }), classes: 'red' });
    });
  }

  /* ---------- 全頁拖拉 ---------- */

  function hasFiles(e) {
    var dt = e.dataTransfer;
    if (!dt || !dt.types) return false;
    for (var i = 0; i < dt.types.length; i++) if (dt.types[i] === 'Files') return true;
    return false;
  }

  function bindDragDrop() {
    var depth = 0;
    window.addEventListener('dragenter', function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault(); depth++; dropOverlay.classList.add('show');
    });
    window.addEventListener('dragover', function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
    });
    window.addEventListener('dragleave', function (e) {
      if (!hasFiles(e)) return;
      depth--; if (depth <= 0) { depth = 0; dropOverlay.classList.remove('show'); }
    });
    window.addEventListener('drop', function (e) {
      e.preventDefault(); depth = 0; dropOverlay.classList.remove('show');
      var dt = e.dataTransfer;
      if (dt && dt.files && dt.files.length) uploadFiles(dt.files);
    });
  }

  /* ---------- 語系（i18n） ---------- */

  function cycleLang() {
    var langs = I18n.langs;
    var i = langs.indexOf(I18n.lang);
    I18n.set(langs[(i + 1) % langs.length]);
    M.toast({ html: I18n.name(I18n.lang) });
  }

  function onLangChanged() {
    renderSideNav(state.files);
    document.title = state.current
      ? (state.name + ' | ' + I18n.t('title.suffix'))
      : I18n.t('title.suffix');
    // 投影片張數文字隨語系（投影片內容是 data，不重新渲染）
    if (state.current) {
      var n = $container ? $container.find('.slide').length : 0;
      if (n) docCount.textContent = I18n.t('meta.slides', { n: n });
    }
  }

  /* ---------- 事件繫結 ---------- */

  function deepLink() {
    return L.parseQuery(location.search).pptx || '';
  }

  function bindEvents() {
    $(document).on('click', '#side-nav a.file-item', function (e) {
      e.preventDefault();
      var name = String($(this).data('name'));
      navigate(L.fileUrl(name), name);
      var inst = M.Sidenav.getInstance(document.getElementById('slide-out'));
      if (inst && inst.isOpen) inst.close();
    });

    emptyState.addEventListener('click', function () { filePicker.click(); });
    filePicker.addEventListener('change', function (e) {
      if (e.target.files && e.target.files.length) uploadFiles(e.target.files);
      filePicker.value = '';
    });

    document.getElementById('setting-menu').addEventListener('click', function () {
      var inst = M.Sidenav.getInstance(document.getElementById('slide-out'));
      if (inst) inst.open();
    });
    document.getElementById('setting-mode').addEventListener('click', toggleTheme);
    document.getElementById('setting-lang').addEventListener('click', cycleLang);
    document.getElementById('setting-download').addEventListener('click', downloadCurrent);
    document.getElementById('setting-clear').addEventListener('click', clearFolder);

    window.addEventListener('popstate', function () {
      var link = deepLink();
      if (link) { loadAndShow(link); }
      else { state.current = null; state.name = ''; clearOutput(); showDoc(false); document.title = I18n.t('title.suffix'); markActive(null); }
    });
  }

  /* ---------- 初始化 ---------- */

  document.addEventListener('DOMContentLoaded', function () {
    M.Sidenav.init(document.querySelectorAll('.sidenav'), {
      edge: 'right',
      onOpenStart: function () { document.body.classList.add('sidenav-open'); },
      onCloseEnd: function () { document.body.classList.remove('sidenav-open'); }
    });

    var saved = 'dark';
    try { saved = localStorage.getItem(THEME_KEY) || 'dark'; } catch (e) {}
    applyTheme(saved === 'light' ? 'light' : 'dark');

    I18n.apply(document);
    document.addEventListener('i18n:changed', onLangChanged);
    document.title = I18n.t('title.suffix');

    bindEvents();
    bindDragDrop();

    var param = deepLink();
    if (param) {
      loadAndShow(param);
      refreshFiles(null, false);
    } else {
      refreshFiles(null, true);
    }
  });
})();
