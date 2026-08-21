// 前台逻辑：设置/分类/商品渲染、详情轮播、灯箱、公告弹窗、主题
(function () {
  'use strict';

  var state = { categories: [], products: [], settings: {}, activeCategory: 'all', query: '', sort: 'default' };

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
    var displayName = state.settings.site_name || '商品展示';
    var pageTitle = state.settings.home_title || displayName;
    document.title = pageTitle;
    $('#site-name').textContent = displayName;
    $('#footer-site-name').textContent = displayName;

    // 自定义网站图标
    var iconLink = document.querySelector('link[rel="icon"]');
    if (iconLink && state.settings.favicon_url) {
      iconLink.href = new URL(state.settings.favicon_url, location.href).href;
    }

    // 联系浮窗
    var contactOn = state.settings.contact_on === '1' &&
      !!(state.settings.contact_img || state.settings.contact_link || state.settings.contact_text);
    $('#contact-fab').hidden = !contactOn;
    if (contactOn) {
      var qr = $('#contact-qr');
      if (state.settings.contact_img) {
        qr.src = new URL(state.settings.contact_img, location.href).href;
        qr.hidden = false;
      } else { qr.hidden = true; }

      $('#contact-text').textContent = state.settings.contact_text || '';
      var cLink = $('#contact-link');
      if (state.settings.contact_link) {
        cLink.href = state.settings.contact_link;
        cLink.textContent = '点击咨询 →';
        cLink.hidden = false;
      } else { cLink.hidden = true; }
    }

    var announceBtn = $('#btn-announce');
    var hasAnnouncement = !!(state.settings.announcement && state.settings.announcement.trim());
    announceBtn.hidden = !hasAnnouncement;
    if (hasAnnouncement) renderAnnouncement($('#announce-content'), state.settings.announcement);
  }

  function renderTabs() {
    var tabs = $('#tabs');
    tabs.textContent = '';
    var counts = {};
    var total = 0;
    state.products.forEach(function (p) {
      total++;
      var k = String(p.category_id);
      counts[k] = (counts[k] || 0) + 1;
    });

    var list = [{ id: 'all', name: '全部 (' + total + ')' }]
      .concat(state.categories.map(function (c) {
        return { id: c.id, name: c.name + ' (' + (counts[String(c.id)] || 0) + ')' };
      }));
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

  // 价格展示：纯数字自动加 ¥，"88-188" 转 "¥88 - ¥188"，其他文字原样
  function formatPrice(raw) {
    var s = String(raw || '').trim();
    if (!s) return '';
    var num = s.replace(/[¥￥,\s]/g, '');
    if (/^\d+(\.\d+)?$/.test(num)) return '¥' + num;
    var m = num.match(/^(\d+(?:\.\d+)?)\s*[-~]\s*(\d+(?:\.\d+)?)$/);
    if (m) return '¥' + m[1] + ' - ¥' + m[2];
    return s;
  }

  function renderProducts() {
    var box = $('#products');
    box.textContent = '';

    var categoryId = state.activeCategory;
    var matched;

    if (state.query) {
      // 搜索模式：忽略分类，按名称/描述即时过滤全部商品
      var q = state.query.toLowerCase();
      matched = state.products.filter(function (p) {
        var hay = (p.name || '') + '\n' + (p.description || '');
        return hay.toLowerCase().indexOf(q) !== -1;
      });
    } else {
      matched = state.products.filter(function (p) {
        return categoryId === 'all' || String(p.category_id) === categoryId;
      });
    }
    // 缺货商品排到该视图最后（仅默认排序；显式排序模式按所选维度排）
    var list;
    if (state.sort === 'default') {
      list = matched.filter(function (p) { return !p.sold_out; })
        .concat(matched.filter(function (p) { return !!p.sold_out; }));
    } else {
      var priceNum = function (p) {
        var m = String(p.price || '').replace(/[¥￥,\s]/g, '').match(/\d+(\.\d+)?/);
        return m ? parseFloat(m[0]) : null;
      };
      list = matched.slice();
      if (state.sort === 'price_asc') {
        list.sort(function (a, b) {
          var x = priceNum(a), y = priceNum(b);
          if (x === null && y === null) return 0;
          if (x === null) return 1;
          if (y === null) return -1;
          return x - y;
        });
      } else if (state.sort === 'price_desc') {
        list.sort(function (a, b) {
          var x = priceNum(a), y = priceNum(b);
          if (x === null && y === null) return 0;
          if (x === null) return 1;
          if (y === null) return -1;
          return y - x;
        });
      } else if (state.sort === 'newest') {
        list.sort(function (a, b) { return String(b.created_at || '').localeCompare(String(a.created_at || '')); });
      } else if (state.sort === 'oldest') {
        list.sort(function (a, b) { return String(a.created_at || '').localeCompare(String(b.created_at || '')); });
      }
    }

    if (!list.length) {
      var empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = state.query ? '没有找到相关商品' : '这里还没有商品';
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
        // 卡片优先加载缩略图（省流量），无缩略图的存量图自动回退大图
        var full = new URL(p.image_url, location.href).href;
        var thumb = full.replace(/\/images\/([^/?#]+)$/, '/thumb/$1');
        img.dataset.full = full;
        img.onerror = function () {
          if (img.getAttribute('src') !== full) img.src = full;
        };
        img.src = thumb;
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
      node.querySelector('.product-price').textContent = formatPrice(p.price);
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
    // 浏览计数（fire-and-forget，不阻塞展示）
    fetch('/api/products/' + p.id + '/view', { method: 'POST' }).catch(function () {});

    carousel.images = collectImages(p);
    carousel.index = 0;
    renderCarousel();

    $('#detail-name').textContent = p.name || '';
    $('#detail-soldout').hidden = !p.sold_out;
    $('#detail-price').textContent = formatPrice(p.price);
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

  // 水印说明：展示图在上传时已由后台烧入像素水印，前台不再叠加 CSS 水印层

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

  // 公告默认展示：首次访问或公告内容更新后自动弹一次（× 掉即记住，直到下次更新）
  function maybeAutoShowAnnouncement() {
    var content = String(state.settings.announcement || '').trim();
    if (!content) return;
    var sig = String(state.settings.site_name || '') + '|' + content;
    var saved = '';
    try { saved = localStorage.getItem('announce_read') || ''; } catch (e) { /* 忽略 */ }
    if (saved !== sig) {
      openAnnounce();
      try { localStorage.setItem('announce_read', sig); } catch (e) { /* 忽略 */ }
    }
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

  // ── 排序选择 ───────────────────────────
  $('#sort-select').addEventListener('change', function () {
    state.sort = this.value;
    renderProducts();
  });

  // ── 搜索框（点图标展开）─────────────────
  var searchbar = $('#searchbar');
  var searchInput = $('#search-input');

  $('#btn-search').addEventListener('click', function () {
    searchbar.hidden = !searchbar.hidden;
    if (!searchbar.hidden) searchInput.focus();
  });

  searchInput.addEventListener('input', function () {
    state.query = this.value.trim();
    renderProducts();
  });

  $('#search-clear').addEventListener('click', function () {
    searchInput.value = '';
    state.query = '';
    renderProducts();
    searchInput.focus();
  });

  searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      searchInput.value = '';
      state.query = '';
      searchbar.hidden = true;
      renderProducts();
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

  // ── 联系浮窗事件 ───────────────────────
  $('#contact-fab').addEventListener('click', function (e) {
    e.stopPropagation();
    var pop = $('#contact-pop');
    pop.hidden = !pop.hidden;
  });
  $('#contact-close').addEventListener('click', function () {
    $('#contact-pop').hidden = true;
  });
  document.addEventListener('click', function (e) {
    var pop = $('#contact-pop');
    if (pop.hidden) return;
    if (!pop.contains(e.target) && e.target !== $('#contact-fab')) pop.hidden = true;
  });

  // ── 访问密码锁屏 ───────────────────────
  function showViewLock() {
    $('#view-lock').hidden = false;
    $('#view-lock-input').focus();
  }

  $('#view-lock-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var errEl = $('#view-lock-error');
    errEl.textContent = '';
    fetch('/api/view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: $('#view-lock-input').value }),
    }).then(function (res) {
      if (res.ok) { location.reload(); return null; }
      return res.json().then(function (d) { throw new Error(d.error || '访问码不正确'); });
    }).catch(function (err) { errEl.textContent = err.message; });
  });

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
      maybeAutoShowAnnouncement();
    }).catch(function (err) {
      console.error(err);
      // 整站访问密码：数据接口返回 401 时显示锁屏
      if (err && /401/.test(err.message)) { showViewLock(); return; }
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
