// 前台逻辑：拉取设置/分类/商品并渲染
(function () {
  'use strict';

  var state = { categories: [], products: [], activeCategory: 'all' };

  var $ = function (sel) { return document.querySelector(sel); };

  function fetchJSON(url) {
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }

  // 把纯文本中的 URL 转成链接（基于 textContent，天然防注入）
  function renderAnnouncement(container, text) {
    container.textContent = '';
    var parts = String(text || '').split(/(https?:\/\/[^\s\u4e00-\u9fa5]+)/g);
    parts.forEach(function (part) {
      if (/^https?:\/\//.test(part)) {
        var a = document.createElement('a');
        a.href = part;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = part;
        container.appendChild(a);
      } else if (part) {
        container.appendChild(document.createTextNode(part));
      }
    });
  }

  function renderSettings(settings) {
    var name = settings.site_name || '商品展示';
    document.title = name;
    $('#site-name').textContent = name;
    $('#footer-site-name').textContent = name;
    if (settings.announcement && settings.announcement.trim()) {
      $('#announcement').hidden = false;
      renderAnnouncement($('#announcement-body'), settings.announcement);
    }
  }

  function renderTabs() {
    var tabs = $('#tabs');
    tabs.textContent = '';
    var list = [{ id: 'all', name: '全部' }].concat(state.categories);
    list.forEach(function (cat) {
      var el = document.createElement('button');
      el.type = 'button';
      el.className = 'tab' + (state.activeCategory === String(cat.id) ? ' active' : '');
      el.textContent = cat.name;
      el.addEventListener('click', function () {
        state.activeCategory = String(cat.id);
        renderTabs();
        renderProducts();
      });
      tabs.appendChild(el);
    });
  }

  function renderProducts() {
    var box = $('#products');
    box.textContent = '';

    var categoryId = state.activeCategory;
    var matched = state.products.filter(function (p) {
      return categoryId === 'all' || String(p.category_id) === categoryId;
    });
    // 缺货商品排到该视图最后
    var list = matched.filter(function (p) { return !p.sold_out; })
      .concat(matched.filter(function (p) { return !!p.sold_out; }));

    if (!list.length) {
      var empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = '这里还没有商品';
      box.appendChild(empty);
      return;
    }

    var tpl = $('#tpl-product');
    list.forEach(function (p) {
      var node = tpl.content.cloneNode(true);
      var card = node.querySelector('.product-card');
      if (p.sold_out) {
        card.classList.add('sold-out');
        node.querySelector('.soldout-tag').hidden = false;
      }
      var link = node.querySelector('.product-link');
      if (p.link) {
        link.href = p.link;
      } else {
        // 无跳转链接时去掉锚点行为，保留内部结构（缩略图等）
        link.removeAttribute('href');
        link.removeAttribute('target');
      }
      // 单击打开详情弹窗；Ctrl/Cmd+点击保留原链接新标签页行为
      link.addEventListener('click', function (e) {
        if (e.metaKey || e.ctrlKey) return;
        e.preventDefault();
        openDetail(p);
      });

      var img = node.querySelector('img');
      if (p.image_url) {
        img.src = p.image_url;
        img.alt = p.name;
      } else {
        img.remove();
        node.querySelector('.product-noimg').hidden = false;
      }

      node.querySelector('.product-name').textContent = p.name || '';
      // 卡片简介用纯文本摘要（Markdown 中的图片/标记不进卡片）
      node.querySelector('.product-desc').textContent = window.MD
        ? MD.excerpt(p.description, 80)
        : String(p.description || '');
      node.querySelector('.product-price').textContent = p.price || '';
      if (!p.description) node.querySelector('.product-desc').textContent = '';
      box.appendChild(node);
    });
  }

  // ── 商品详情弹窗 ───────────────────────
  function openDetail(p) {
    var img = $('#detail-img');
    var noimg = $('#detail-noimg');
    if (p.image_url) {
      img.src = p.image_url;
      img.alt = p.name || '';
      img.hidden = false;
      noimg.hidden = true;
    } else {
      img.removeAttribute('src');
      img.hidden = true;
      noimg.hidden = false;
    }

    $('#detail-name').textContent = p.name || '';
    $('#detail-soldout').hidden = !p.sold_out;
    $('#detail-price').textContent = p.price || '';
    $('#detail-desc').innerHTML = window.MD ? MD.render(p.description) : '';

    var linkBtn = $('#detail-link');
    if (p.link) {
      linkBtn.href = p.link;
      linkBtn.hidden = false;
    } else {
      linkBtn.removeAttribute('href');
      linkBtn.hidden = true;
    }

    $('#detail-modal').hidden = false;
    document.documentElement.style.overflow = 'hidden';
  }

  function closeDetail() {
    $('#detail-modal').hidden = true;
    document.documentElement.style.overflow = '';
  }

  $('#detail-close').addEventListener('click', closeDetail);
  $('#detail-modal').addEventListener('click', function (e) {
    if (e.target === this) closeDetail();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !$('#detail-modal').hidden) closeDetail();
  });

  // ── 主题切换（自动 → 亮 → 暗 循环）────
  var themeBtn = $('#theme-toggle');
  var THEME_ORDER = ['auto', 'light', 'dark'];
  var THEME_META = { auto: ['🌓', '跟随系统'], light: ['☀️', '亮色'], dark: ['🌙', '暗色'] };

  function currentTheme() {
    try { return localStorage.getItem('theme') || 'auto'; } catch (e) { return 'auto'; }
  }

  function applyTheme(t) {
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
    var meta = THEME_META[t] || THEME_META.auto;
    themeBtn.textContent = meta[0];
    themeBtn.title = '主题：' + meta[1] + '（点击切换）';
  }

  themeBtn.addEventListener('click', function () {
    var next = THEME_ORDER[(THEME_ORDER.indexOf(currentTheme()) + 1) % 3];
    try { localStorage.setItem('theme', next); } catch (e) { /* 忽略 */ }
    applyTheme(next);
  });
  applyTheme(currentTheme());

  function load() {
    Promise.all([
      fetchJSON('/api/settings'),
      fetchJSON('/api/categories'),
      fetchJSON('/api/products'),
    ]).then(function (results) {
      renderSettings(results[0].settings || {});
      state.categories = results[1].categories || [];
      state.products = results[2].products || [];
      renderTabs();
      renderProducts();
    }).catch(function (err) {
      console.error(err);
      var box = $('#products');
      box.textContent = '';
      var el = document.createElement('div');
      el.className = 'empty';
      el.textContent = '加载失败：' + (err && err.message ? err.message : '未知错误');
      box.appendChild(el);
    });
  }

  $('#year').textContent = new Date().getFullYear();
  load();
})();
