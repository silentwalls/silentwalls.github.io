/* ==========================================================================
   silentwall's blog —— 交互脚本
   1. 深色 / 浅色模式      2. 移动端菜单 & 下拉菜单
   3. 站内搜索（本地索引）  4. 文章目录滚动高亮
   5. 阅读进度条 & 返回顶部  6. 全屏封面（点击 / 下滑进入）
   7. 评论区跟随深浅色
   ========================================================================== */
(function () {
  'use strict';

  var CFG = window.SW_CONFIG || { root: '/', searchUrl: '/search.json' };
  var doc = document;
  var html = doc.documentElement;
  var body = doc.body;

  function $(sel, ctx) { return (ctx || doc).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || doc).querySelectorAll(sel)); }

  /* ---------------------------------------------------------------- 1. 主题 */
  var THEME_KEY = 'sw-theme';

  function applyTheme(theme) {
    html.setAttribute('data-theme', theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* 忽略隐私模式报错 */ }
    var meta = $('meta[name="theme-color"]:not([media])');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0f2b3a' : '#7ccfe7');
    syncComments();
  }

  var toggle = $('#theme-toggle');
  if (toggle) {
    toggle.addEventListener('click', function () {
      applyTheme(html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    });
  }

  /* --------------------------------------------------- 2. 滚动阴影 & 进度条 */
  var navbar = $('#navbar');
  var progress = $('#progress-bar');
  var backTop = $('#back-top');
  var cover = $('#cover');
  var ticking = false;

  function onScroll() {
    var y = window.pageYOffset || html.scrollTop;

    // 首页第一屏：导航栏透明浮在封面上。
    // 封面底部有约 30% 的渐隐区，导航栏进到那一带之前就切回实底，避免白字压在浅色上
    var onCover = !!cover && y + 64 < cover.offsetHeight * 0.7;
    body.classList.toggle('nav-on-cover', onCover);
    body.classList.toggle('cover-scrolled', !!cover && y > 40);

    if (navbar) navbar.classList.toggle('is-stuck', !onCover && y > 6);
    if (backTop) backTop.classList.toggle('show', y > 480);

    if (progress) {
      var max = html.scrollHeight - window.innerHeight;
      progress.style.width = (max > 0 ? Math.min(100, (y / max) * 100) : 0) + '%';
    }
    ticking = false;
  }

  window.addEventListener('scroll', function () {
    if (!ticking) {
      ticking = true;
      window.requestAnimationFrame(onScroll);
    }
  }, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  onScroll();

  if (backTop) {
    backTop.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  /* ------------------------------------------------------- 3. 移动端菜单 */
  var menuBtn = $('#menu-toggle');
  if (menuBtn) {
    menuBtn.addEventListener('click', function () {
      var open = body.classList.toggle('menu-open');
      menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  /* ------------------------------------------------------ 4. 下拉 / 折叠面板 */
  var dropdown = $('#nav-dropdown');
  if (dropdown) {
    var trigger = $('.dropdown-trigger', dropdown);
    trigger.addEventListener('click', function (e) {
      e.preventDefault();
      var open = dropdown.classList.toggle('open');
      trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    doc.addEventListener('click', function (e) {
      if (!dropdown.contains(e.target)) {
        dropdown.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
      }
    });
  }

  $$('.side-group-head').forEach(function (head) {
    function flip() {
      var group = head.closest('.side-group');
      var open = group.classList.toggle('open');
      head.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    head.addEventListener('click', flip);
    head.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); }
    });
  });

  if (window.innerWidth <= 900) {
    var toc = $('#toc-panel');
    if (toc) toc.classList.add('mobile-collapsed');
    var tocHeading = $('.toc-heading', toc || doc);
    if (tocHeading && toc) {
      tocHeading.style.cursor = 'pointer';
      tocHeading.addEventListener('click', function () {
        toc.classList.toggle('mobile-collapsed');
      });
    }
  }

  /* ============================================================= 5. 搜索 */
  var Search = (function () {
    var index = null;
    var pending = null;

    function loadIndex() {
      if (index) return Promise.resolve(index);
      if (!pending) {
        pending = fetch(CFG.searchUrl, { credentials: 'same-origin' })
          .then(function (res) { return res.ok ? res.json() : { items: [] }; })
          .then(function (json) {
            index = (json && json.items) ? json.items : [];
            return index;
          })
          .catch(function () {
            index = [];
            return index;
          });
      }
      return pending;
    }

    function escapeHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function highlight(text, terms) {
      var out = escapeHtml(text);
      terms.forEach(function (term) {
        if (!term) return;
        var safe = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        out = out.replace(new RegExp('(' + safe + ')', 'gi'), '<mark>$1</mark>');
      });
      return out;
    }

    function makeSnippet(text, terms, radius) {
      var lower = text.toLowerCase();
      var at = -1;
      for (var i = 0; i < terms.length; i++) {
        var pos = lower.indexOf(terms[i]);
        if (pos >= 0 && (at < 0 || pos < at)) at = pos;
      }
      if (at < 0) return text.slice(0, radius * 2) + (text.length > radius * 2 ? '…' : '');
      var start = Math.max(0, at - radius);
      var end = Math.min(text.length, at + radius * 2);
      return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
    }

    function scoreItem(item, terms) {
      var title = String(item.title || '').toLowerCase();
      var meta = ((item.categories || []).join(' ') + ' ' + (item.tags || []).join(' ')).toLowerCase();
      var text = String(item.text || '').toLowerCase();
      var score = 0;

      for (var i = 0; i < terms.length; i++) {
        var t = terms[i];
        var inTitle = title.indexOf(t) >= 0;
        var inMeta = meta.indexOf(t) >= 0;
        var inText = text.indexOf(t) >= 0;
        if (!inTitle && !inMeta && !inText) return -1;
        if (inTitle) score += 24;
        if (inMeta) score += 9;
        if (inText) score += 2;
      }
      return score;
    }

    function query(term) {
      var terms = term.toLowerCase().split(/\s+/).filter(Boolean);
      if (!terms.length) return [];
      return index
        .map(function (item) {
          return { item: item, score: scoreItem(item, terms) };
        })
        .filter(function (row) { return row.score >= 0; })
        .sort(function (a, b) { return b.score - a.score; })
        .slice(0, 12);
    }

    function render(container, rows, terms, state) {
      var results = $('[data-search-results]', container);
      if (!results) return;

      if (!rows.length) {
        results.innerHTML = '<div class="search-empty">没有找到和「' + escapeHtml(state.raw) + '」相关的文章，换个关键词试试？</div>';
        state.selected = -1;
        return;
      }

      results.innerHTML = rows.map(function (row, i) {
        var item = row.item;
        var metaBits = [];
        if (item.date) metaBits.push(item.date);
        if (item.minutes) metaBits.push(item.minutes + ' 分钟');
        if (item.words) metaBits.push(item.words + ' 字');
        if (item.categories && item.categories.length) metaBits.push(item.categories.join(' · '));

        return '<a class="search-item" href="' + item.url + '" data-idx="' + i + '">' +
          '<b>' + highlight(item.title, terms) + '</b>' +
          '<p>' + highlight(makeSnippet(String(item.text || ''), terms, 52), terms) + '</p>' +
          '<div class="si-meta">' + escapeHtml(metaBits.join('  ·  ')) + '</div>' +
          '</a>';
      }).join('');

      state.selected = 0;
      var first = results.querySelector('.search-item');
      if (first) first.classList.add('selected');
    }

    function init(container) {
      var input = $('[data-search-input]', container);
      var results = $('[data-search-results]', container);
      if (!input || !results) return null;

      var state = { raw: '', rows: [], selected: -1, terms: [] };
      var timer = null;

      function move(delta) {
        if (!state.rows.length) return;
        var nodes = $$('.search-item', results);
        if (!nodes.length) return;
        state.selected = (state.selected + delta + nodes.length) % nodes.length;
        nodes.forEach(function (n, i) { n.classList.toggle('selected', i === state.selected); });
        var active = nodes[state.selected];
        if (active) active.scrollIntoView({ block: 'nearest' });
      }

      function run() {
        state.raw = input.value.trim();
        if (!state.raw) {
          results.innerHTML = '<div class="search-hint">输入关键词开始搜索<br><kbd>↑</kbd><kbd>↓</kbd> 选择 · <kbd>Enter</kbd> 打开 · <kbd>Esc</kbd> 关闭</div>';
          state.rows = [];
          state.selected = -1;
          return;
        }
        results.innerHTML = '<div class="search-loading">搜索中…</div>';
        loadIndex().then(function () {
          state.terms = state.raw.toLowerCase().split(/\s+/).filter(Boolean);
          state.rows = query(state.raw);
          render(container, state.rows, state.terms, state);
        });
      }

      input.addEventListener('input', function () {
        clearTimeout(timer);
        timer = setTimeout(run, 140);
      });

      input.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
        else if (e.key === 'Enter') {
          var node = $$('.search-item', results)[state.selected < 0 ? 0 : state.selected];
          if (node) { e.preventDefault(); window.location.href = node.getAttribute('href'); }
        }
      });

      results.addEventListener('click', function (e) {
        var link = e.target.closest('.search-item');
        if (link) return; // 交给浏览器跳转
        e.preventDefault();
      });

      return { focus: function () { input.focus(); input.select(); }, reset: function () { input.value = ''; run(); }, reload: run };
    }

    return { init: init, preload: loadIndex };
  })();

  /* ---- 6. 搜索浮层（顶部放大镜 / 侧边栏「搜索」） ---- */
  var modal = $('[data-search-modal]');
  var modalBox = modal ? Search.init(modal) : null;
  var lastFocus = null;

  function openSearch(e) {
    if (e) e.preventDefault();
    if (!modal) return;
    lastFocus = doc.activeElement;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    body.style.overflow = 'hidden';
    if (modalBox) modalBox.focus();
    Search.preload();
  }

  function closeSearch() {
    if (!modal || !modal.classList.contains('open')) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  $$('[data-search-open]').forEach(function (el) {
    el.addEventListener('click', openSearch);
  });

  if (modal) {
    modal.addEventListener('click', function (e) {
      if (e.target === modal || e.target.closest('[data-search-close]')) closeSearch();
    });
  }

  doc.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && String(e.key).toLowerCase() === 'k') {
      e.preventDefault();
      openSearch();
    }
    if (e.key === 'Escape') {
      closeSearch();
      if (dropdown) dropdown.classList.remove('open');
      body.classList.remove('menu-open');
    }
  });

  // 独立搜索页：页面内的搜索框
  var pageSearchBox = $('.page-search [data-search]');
  if (pageSearchBox) {
    var pageBox = Search.init(pageSearchBox);
    if (pageBox) pageBox.focus();
    Search.preload();
  }

  /* ------------------------------------------------------- 7. 目录滚动高亮 */
  var articleBody = $('#article-body');
  var tocLinks = $$('#toc-panel .toc-list a');

  if (articleBody && tocLinks.length) {
    var headings = tocLinks
      .map(function (link) {
        var id = link.getAttribute('href');
        if (!id || id.charAt(0) !== '#') return null;
        var target = doc.getElementById(decodeURIComponent(id.slice(1)));
        return target ? { link: link, el: target } : null;
      })
      .filter(Boolean);

    var spyTicking = false;

    function markActive() {
      var offset = (window.pageYOffset || html.scrollTop) + 120;
      var current = -1;
      for (var i = 0; i < headings.length; i++) {
        if (headings[i].el.offsetTop <= offset) current = i;
      }
      headings.forEach(function (h, i) {
        h.link.classList.toggle('active', i === current);
      });
      spyTicking = false;
    }

    window.addEventListener('scroll', function () {
      if (!spyTicking) {
        spyTicking = true;
        window.requestAnimationFrame(markActive);
      }
    }, { passive: true });

    markActive();

    tocLinks.forEach(function (link) {
      link.addEventListener('click', function (e) {
        var id = link.getAttribute('href');
        if (!id || id.charAt(0) !== '#') return;
        var target = doc.getElementById(decodeURIComponent(id.slice(1)));
        if (!target) return;
        e.preventDefault();
        var top = target.getBoundingClientRect().top + (window.pageYOffset || html.scrollTop) - 90;
        window.scrollTo({ top: top, behavior: 'smooth' });
        history.replaceState(null, '', id);
      });
    });
  }

  /* --------------------------------------------- 8. 站外链接统一新窗口打开 */
  $$('.article-body a[href^="http"]').forEach(function (a) {
    if (a.host !== window.location.host) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    }
  });

  /* ------------------------------------------------ 9. 全屏封面：进入正文 */
  (function () {
    if (!cover) return;
    var content = $('#content');
    if (!content) return;

    var entering = false;

    // 直接停在封面图的最下边缘：屏幕上不再露出封面
    // （正文容器自己有 padding-top，所以内容不会被固定导航栏挡住）
    function enter() {
      if (entering) return;
      entering = true;
      window.scrollTo({ top: cover.offsetHeight, behavior: 'smooth' });
      // 动画期间忽略重复触发，结束后恢复
      setTimeout(function () { entering = false; }, 900);
    }

    // 点击中间的方块（<a href="#content">）→ 平滑滚下去
    var center = $('.cover-center', cover);
    if (center) {
      center.addEventListener('click', function (e) {
        e.preventDefault();
        enter();
      });
    }

    // 点击底部「向下滚动」提示，行为保持一致
    var hint = $('.cover-scroll', cover);
    if (hint) {
      hint.addEventListener('click', function (e) {
        e.preventDefault();
        enter();
      });
    }

    // 在封面上下滑 → 直接进入正文
    cover.addEventListener('wheel', function (e) {
      if (entering) { e.preventDefault(); return; }
      if (e.deltaY > 4 && (window.pageYOffset || html.scrollTop) < 8) {
        e.preventDefault();
        enter();
      }
    }, { passive: false });

    // 手机上向上滑 → 进入正文
    var startY = null;
    cover.addEventListener('touchstart', function (e) {
      startY = e.touches[0] ? e.touches[0].clientY : null;
    }, { passive: true });
    cover.addEventListener('touchend', function (e) {
      if (startY === null) return;
      var endY = e.changedTouches[0] ? e.changedTouches[0].clientY : startY;
      if (startY - endY > 46 && (window.pageYOffset || html.scrollTop) < 8) enter();
      startY = null;
    }, { passive: true });
  })();

  /* ------------------------------------------------ 10. 评论区跟随主题配色 */
  function syncComments() {
    var dark = html.getAttribute('data-theme') === 'dark';

    var giscus = doc.querySelector('iframe.giscus-frame');
    if (giscus && giscus.contentWindow) {
      giscus.contentWindow.postMessage(
        { giscus: { setConfig: { theme: dark ? 'dark' : 'light' } } },
        'https://giscus.app'
      );
    }

    var utterances = doc.querySelector('iframe.utterances-frame');
    if (utterances && utterances.contentWindow) {
      utterances.contentWindow.postMessage(
        { type: 'set-theme', theme: dark ? 'github-dark' : 'github-light' },
        'https://utteranc.es'
      );
    }
  }

  // 评论框是异步注入的，加载完再过几次同步一次配色
  if ($('#comments')) {
    window.addEventListener('load', syncComments);
    [300, 900, 1800, 3000, 5000].forEach(function (t) { setTimeout(syncComments, t); });
  }
})();
