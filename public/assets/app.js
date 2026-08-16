// 前台逻辑：设置/分类/商品渲染、详情轮播、灯箱、公告弹窗、主题
(function () {
  'use strict';

  var state = { categories: [], products: [], settings: {}, activeCategory: 'all' };

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
    state.settings = settings || {};
    var name = state.settings.site_name || '商品展示';
    document.title = name;
    $('#site-name').textContent = name;
    $('#footer-site-name').textContent = name;

    var announceBtn = $('#btn-announce');
    var hasAnnouncement = !!(state.settings.announcement && state.settings.announcement.trim());
    announceBtn.hidden = !hasAnnouncement;
    if (hasAnnouncement) renderAnnouncement($('#announce-content'), state.settings.announcement);
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
      link.addEventListener('click', function () { openDetail(p); });

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

  // ── 详情弹窗 + 轮播 ─────────────────────
  var carousel = { images: [], index: 0 };

  function collectImages(p) {
    var urls = [];
    if (p.image_url) urls.push(p.image_url);
    var re = /!\[[^\]]*\]\(([^)\s]+)\)/g;
    var m;
    var desc = String(p.description || '');
    while ((m = re.exec(desc)) !== null) {
      if (urls.indexOf(m[1]) === -1) urls.push(m[1]);
    }
    return urls;
  }

  function renderCarousel() {
    var wrap = $('#carousel');
    var noimg = $('#detail-noimg-wrap');
    if (!carousel.images.length) {
      wrap.hidden = true;
      noimg.hidden = false;
      return;
    }
    wrap.hidden = false;
    noimg.hidden = true;

    $('#carousel-img').src = carousel.images[carousel.index];

    var dots = $('#carousel-dots');
    dots.textContent = '';
    if (carousel.images.length > 1) {
      carousel.images.forEach(function (_, i) {
        var dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'carousel-dot' + (i === carousel.index ? ' active' : '');
        dot.setAttribute('aria-label', '第 ' + (i + 1) + ' 张');
        dot.addEventListener('click', function () {
          carousel.index = i;
          renderCarousel();
        });
        dots.appendChild(dot);
      });
      $('#carousel-counter').textContent = (carousel.index + 1) + ' / ' + carousel.images.length;
      $('#carousel-prev').hidden = false;
      $('#carousel-next').hidden = false;
    } else {
      $('#carousel-counter').textContent = '';
      $('#carousel-prev').hidden = true;
      $('#carousel-next').hidden = true;
    }
  }

  function carouselStep(delta) {
    if (!carousel.images.length) return;
    carousel.index = (carousel.index + delta + carousel.images.length) % carousel.images.length;
    renderCarousel();
  }

  function openDetail(p) {
    carousel.images = collectImages(p);
    carousel.index = 0;
    renderCarousel();

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

  // ── 灯箱（图片放大）─────────────────────
  var lightbox = { images: [], index: 0 };

  function openLightbox(images, index) {
    lightbox.images = images;
    lightbox.index = index;
    $('#lightbox-img').src = images[index];
    $('#lightbox-counter').textContent = images.length > 1 ? (index + 1) + ' / ' + images.length : '';
    $('#lightbox-prev').hidden = images.length <= 1;
    $('#lightbox-next').hidden = images.length <= 1;
    $('#lightbox').hidden = false;
  }

  function closeLightbox() {
    $('#lightbox').hidden = true;
  }

  function lightboxStep(delta) {
    if (!lightbox.images.length) return;
    lightbox.index = (lightbox.index + delta + lightbox.images.length) % lightbox.images.length;
    $('#lightbox-img').src = lightbox.images[lightbox.index];
    $('#lightbox-counter').textContent = (lightbox.index + 1) + ' / ' + lightbox.images.length;
  }

  // ── 水印（站名平铺，SVG 背景）───────────
  function watermarkBg() {
    var name = (state.settings.site_name || '').trim();
    if (!name) return null;
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="260" height="170">' +
      '<text x="130" y="90" fill="rgba(255,255,255,0.16)" font-size="20" ' +
      'font-family="sans-serif" text-anchor="middle" transform="rotate(-24 130 85)">' +
      name.replace(/&/g, '&amp;').replace(/</g, '&lt;') +
      '</text></svg>';
    return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
  }

  function applyWatermarks() {
    var bg = watermarkBg();
    [['#carousel-watermark'], ['#lightbox-watermark']].forEach(function (pair) {
      var el = $(pair[0]);
      if (bg) { el.style.backgroundImage = bg; el.hidden = false; }
      else el.hidden = true;
    });
  }

  // ── 事件绑定 ───────────────────────────
  $('#detail-close').addEventListener('click', closeDetail);
  $('#detail-modal').addEventListener('click', function (e) {
    if (e.target === this) closeDetail();
  });

  $('#carousel-prev').addEventListener('click', function () { carouselStep(-1); });
  $('#carousel-next').addEventListener('click', function () { carouselStep(1); });
  $('#carousel-img').addEventListener('click', function () {
    openLightbox(carousel.images, carousel.index);
  });

  $('#lightbox-close').addEventListener('click', closeLightbox);
  $('#lightbox-prev').addEventListener('click', function () { lightboxStep(-1); });
  $('#lightbox-next').addEventListener('click', function () { lightboxStep(1); });
  $('#lightbox').addEventListener('click', function (e) {
    if (e.target === this) closeLightbox();
  });

  // 描述里的图片点击放大（委托）
  $('#detail-desc').addEventListener('click', function (e) {
    if (e.target && e.target.tagName === 'IMG' && e.target.src) {
      var src = e.target.getAttribute('src');
      var idx = carousel.images.indexOf(src);
      if (idx === -1) {
        carousel.images.push(src);
        idx = carousel.images.length - 1;
      }
      openLightbox(carousel.images, idx);
    }
  });

  // 公告弹窗
  function openAnnounce() {
    $('#announcement-modal').hidden = false;
    document.documentElement.style.overflow = 'hidden';
  }
  function closeAnnounce() {
    $('#announcement-modal').hidden = true;
    document.documentElement.style.overflow = '';
  }
  $('#btn-announce').addEventListener('click', openAnnounce);
  $('#announce-close').addEventListener('click', closeAnnounce);
  $('#announcement-modal').addEventListener('click', function (e) {
    if (e.target === this) closeAnnounce();
  });

  // 键盘：Esc 逐层关闭（灯箱 > 公告/详情），方向键导航
  document.addEventListener('keydown', function (e) {
    var lightboxOpen = !$('#lightbox').hidden;
    if (e.key === 'Escape') {
      if (lightboxOpen) closeLightbox();
      else if (!$('#announcement-modal').hidden) closeAnnounce();
      else if (!$('#detail-modal').hidden) closeDetail();
      return;
    }
    if (lightboxOpen) {
      if (e.key === 'ArrowLeft') lightboxStep(-1);
      if (e.key === 'ArrowRight') lightboxStep(1);
      return;
    }
    if (!$('#detail-modal').hidden && !$('#carousel').hidden) {
      if (e.key === 'ArrowLeft') carouselStep(-1);
      if (e.key === 'ArrowRight') carouselStep(1);
    }
  });

  // 轻量防盗：阻止图片拖拽与图片右键（可被绕过，仅提高门槛）
  document.addEventListener('dragstart', function (e) {
    if (e.target && e.target.tagName === 'IMG') e.preventDefault();
  });
  document.addEventListener('contextmenu', function (e) {
    if (e.target && e.target.tagName === 'IMG' &&
        (e.target.closest('.carousel-stage') || e.target.closest('#lightbox') || e.target.closest('.md-content'))) {
      e.preventDefault();
    }
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
      applyWatermarks();
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
