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
    var list = state.products.filter(function (p) {
      return categoryId === 'all' || String(p.category_id) === categoryId;
    });

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
      var link = node.querySelector('.product-link');
      if (p.link) {
        link.href = p.link;
      } else {
        // 无跳转链接时降级为普通容器，避免 javascript:void(0) 锚点
        var div = document.createElement('div');
        div.className = 'product-link';
        link.replaceWith(div);
        link = div;
      }

      var img = node.querySelector('img');
      if (p.image_url) {
        img.src = p.image_url;
        img.alt = p.name;
      } else {
        img.remove();
        node.querySelector('.product-noimg').hidden = false;
      }

      node.querySelector('.product-name').textContent = p.name || '';
      node.querySelector('.product-desc').textContent = p.description || '';
      node.querySelector('.product-price').textContent = p.price || '';
      if (!p.link) node.querySelector('.product-buy').textContent = '';
      box.appendChild(node);
    });
  }

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
      el.textContent = '加载失败，请刷新重试';
      box.appendChild(el);
    });
  }

  $('#year').textContent = new Date().getFullYear();
  load();
})();
