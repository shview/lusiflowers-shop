// 后台管理逻辑：登录 / 商品 CRUD / 图片上传 / 分类 / 站点设置
(function () {
  'use strict';

  var state = { categories: [], products: [], settings: {} };
  var dragRow = null;

  // 清除所有拖拽指示线
  function clearDragHints() {
    document.querySelectorAll('#product-list .prow').forEach(function (r) {
      r.style.borderTop = '';
      r.style.borderBottom = '';
    });
  }

  // 容器级兜底：行间隙/列表边缘的拖放与拖拽结束，任何情况下都清理指示线
  function bindListDragFallback() {
    var list = $('#product-list');
    if (!list || list.dataset.dragBound) return;
    list.dataset.dragBound = '1';
    list.addEventListener('dragover', function (e) { e.preventDefault(); });
    list.addEventListener('drop', function (e) { e.preventDefault(); clearDragHints(); });
    list.addEventListener('dragend', function () { clearDragHints(); });
  }

  // 按 DOM 顺序重写全部商品的 sort（拖拽排序保存）
  function saveOrderFromDom() {
    var rows = document.querySelectorAll('#product-list .prow');
    var jobs = [];
    rows.forEach(function (r, i) {
      var id = Number(r.dataset.id);
      var old = state.products.find(function (p) { return p.id === id; });
      if (old && old.sort !== i) jobs.push(api('PUT', '/api/products/' + id, { sort: i }));
    });
    if (!jobs.length) return;
    Promise.all(jobs)
      .then(function () { toast('顺序已保存'); loadAll(); })
      .catch(function (err) { toast(err.message, true); loadAll(); });
  }

  var $ = function (sel) { return document.querySelector(sel); };

  // ── 工具 ──────────────────────────────
  function api(method, url, body, isForm) {
    var opts = { method: method, headers: {} };
    if (body !== undefined) {
      if (isForm) {
        opts.body = body; // FormData，浏览器自动带 boundary
      } else {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
      }
    }
    return fetch(url, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.status === 401) {
          // 会话过期，回到登录页
          showLogin();
          throw new Error(data.error || '请先登录');
        }
        if (!res.ok) throw new Error(data.error || '操作失败（HTTP ' + res.status + '）');
        return data;
      });
    });
  }

  var toastTimer = null;
  function toast(msg, isError) {
    var el = $('#toast');
    el.textContent = msg;
    el.className = 'toast' + (isError ? ' toast-error' : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2500);
  }

  function esc(s) {
    return String(s == null ? '' : s);
  }

  // ── 视图切换 ───────────────────────────
  function showLogin() {
    $('#view-admin').hidden = true;
    $('#view-login').hidden = false;
    $('#login-password').value = '';
    $('#login-error').textContent = '';
  }

  function showAdmin() {
    $('#view-login').hidden = true;
    $('#view-admin').hidden = false;
    loadAll();
  }

  // ── 登录 ──────────────────────────────
  $('#login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = $('#login-btn');
    btn.disabled = true;
    btn.textContent = '登录中..';
    api('POST', '/api/login', { password: $('#login-password').value })
      .then(showAdmin)
      .catch(function (err) { $('#login-error').textContent = err.message; })
      .finally(function () { btn.disabled = false; btn.textContent = '登 录'; });
  });

  $('#btn-logout').addEventListener('click', function () {
    api('POST', '/api/logout').then(showLogin).catch(function () {});
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

  // ── 子标签切换 ─────────────────────────
  document.querySelectorAll('.subtab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.subtab').forEach(function (t) { t.classList.remove('active'); });
      tab.classList.add('active');
      ['products', 'categories', 'settings'].forEach(function (name) {
        $('#pane-' + name).hidden = name !== tab.dataset.pane;
      });
    });
  });

  // ── 数据加载 ───────────────────────────
  function loadAll() {
    Promise.all([
      api('GET', '/api/categories'),
      api('GET', '/api/products?all=1'),
      api('GET', '/api/settings'),
    ]).then(function (r) {
      state.categories = r[0].categories || [];
      state.products = r[1].products || [];
      state.settings = r[2].settings || {};
      renderProductList();
      renderCategoryList();
      fillSettingsForm(state.settings);
    }).catch(function (err) { toast(err.message, true); });
  }

  // ── 商品列表 ───────────────────────────
  function renderProductList() {
    var box = $('#product-list');
    box.textContent = '';
    bindListDragFallback();

    if (!state.products.length) {
      var empty = document.createElement('div');
      empty.className = 'loading';
      empty.textContent = '还没有商品，点击右上角「新增商品」添加第一个吧';
      box.appendChild(empty);
      return;
    }

    state.products.forEach(function (p) {
      var row = document.createElement('div');
      row.className = 'prow';

      var thumb = document.createElement('div');
      thumb.className = 'prow-thumb';
      if (p.image_url) {
        var img = document.createElement('img');
        img.className = 'prow-thumb';
        if (p.sold_out) img.classList.add('soldout-thumb');
        img.src = p.image_url;
        img.alt = '';
        thumb = img;
      } else {
        thumb.textContent = '无图';
      }
      row.appendChild(thumb);

      var main = document.createElement('div');
      main.className = 'prow-main';
      var name = document.createElement('div');
      name.className = 'prow-name';
      name.textContent = p.name;
      if (!p.visible) {
        var badge = document.createElement('span');
        badge.className = 'prow-badge hidden-badge';
        badge.textContent = '已隐藏';
        name.appendChild(badge);
      }
      if (p.sold_out) {
        var soBadge = document.createElement('span');
        soBadge.className = 'prow-badge soldout-badge';
        soBadge.textContent = '缺货';
        name.appendChild(soBadge);
      }
      var meta = document.createElement('div');
      meta.className = 'prow-meta';
      var catName = p.category_name || '未分类';
      meta.textContent = catName + (p.price ? ' · ' + p.price : '') + ' · 排序 ' + p.sort
        + ' · 浏览 ' + (p.views || 0);
      row.draggable = true;
      row.dataset.id = p.id;
      main.appendChild(name);
      main.appendChild(meta);
      row.appendChild(main);

      var ops = document.createElement('div');
      ops.className = 'prow-ops';

      function opBtn(text, fn) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn btn-sm';
        b.textContent = text;
        b.addEventListener('click', fn);
        ops.appendChild(b);
      }

      opBtn('上移', function () { moveProduct(p, -1); });
      opBtn('下移', function () { moveProduct(p, 1); });
      opBtn(p.visible ? '隐藏' : '显示', function () {
        api('PUT', '/api/products/' + p.id, { visible: !p.visible })
          .then(loadAll)
          .catch(function (err) { toast(err.message, true); });
      });
      opBtn(p.sold_out ? '恢复有货' : '标记缺货', function () {
        api('PUT', '/api/products/' + p.id, { sold_out: !p.sold_out })
          .then(loadAll)
          .catch(function (err) { toast(err.message, true); });
      });
      opBtn('复制', function () {
        api('POST', '/api/products', {
          name: p.name + '（副本）',
          category_id: p.category_id,
          price: p.price,
          description: p.description,
          image_url: p.image_url,
          link: p.link,
          sort: p.sort,
          visible: false,
          sold_out: false,
        }).then(function () {
          toast('已复制为「' + p.name + '（副本）」，默认隐藏，编辑后显示');
          loadAll();
        }).catch(function (err) { toast(err.message, true); });
      });
      opBtn('编辑', function () { openProductModal(p); });
      opBtn('删除', function () {
        if (!confirm('确定删除商品「' + p.name + '」吗？此操作不可恢复。')) return;
        api('DELETE', '/api/products/' + p.id)
          .then(function () { toast('已删除'); loadAll(); })
          .catch(function (err) { toast(err.message, true); });
      });

      row.appendChild(ops);

      // 拖拽排序：拖到目标行上/下半区决定插前/插后，松手按新顺序重写 sort
      row.addEventListener('dragstart', function (e) {
        dragRow = row;
        row.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', p.id); } catch (err) { /* IE 兼容 */ }
      });
      row.addEventListener('dragend', function () {
        row.classList.remove('dragging');
        clearDragHints(); // 兜底：拖拽取消/拖回原位/拖到列表外都清理指示线
      });
      row.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        var rect = row.getBoundingClientRect();
        var before = e.clientY < rect.top + rect.height / 2;
        clearDragHints();
        if (before) row.style.borderTop = '2px solid var(--accent)';
        else row.style.borderBottom = '2px solid var(--accent)';
      });
      row.addEventListener('drop', function (e) {
        e.preventDefault();
        var hadHint = row.style.borderTop || row.style.borderBottom;
        clearDragHints();
        if (!dragRow || dragRow === row || !hadHint) return;
        var rect = row.getBoundingClientRect();
        var before = e.clientY < rect.top + rect.height / 2;
        box.insertBefore(dragRow, before ? row : row.nextSibling);
        saveOrderFromDom();
      });

      box.appendChild(row);
    });
  }

  function moveProduct(p, dir) {
    // 与相邻商品交换 sort 值；若相同则先铺开
    var sorted = state.products.slice().sort(function (a, b) { return a.sort - b.sort || b.id - a.id; });
    var idx = sorted.findIndex(function (x) { return x.id === p.id; });
    var other = sorted[idx + dir];
    if (!other) { toast(dir < 0 ? '已经是最前面了' : '已经是最后面了'); return; }

    var ps = p.sort, os = other.sort;
    var jobs;
    if (ps === os) {
      // sort 值相同：先按当前顺序重新铺开编号，再交换
      sorted.forEach(function (item, i) { item.sort = i; });
      ps = p.sort; os = sorted[idx + dir].sort;
      jobs = sorted.map(function (item) {
        return api('PUT', '/api/products/' + item.id, { sort: item.sort });
      });
    } else {
      p.sort = os; other.sort = ps;
      jobs = [
        api('PUT', '/api/products/' + p.id, { sort: p.sort }),
        api('PUT', '/api/products/' + other.id, { sort: other.sort }),
      ];
    }
    Promise.all(jobs).then(loadAll).catch(function (err) { toast(err.message, true); });
  }

  // ── 商品弹窗 ───────────────────────────
  // ── 价格三模式（单价 / 区间 / 自定义文字）──
  function setPriceMode(mode) {
    document.querySelectorAll('input[name="price-mode"]').forEach(function (r) {
      r.checked = r.value === mode;
    });
  }

  function fillPriceForm(raw) {
    var s = String(raw || '').trim();
    $('#f-price-num').value = '';
    $('#f-price-min').value = '';
    $('#f-price-max').value = '';
    $('#f-price-text').value = '';

    var num = s.replace(/[¥￥,\s]/g, '');
    var range = num.match(/^(\d+(?:\.\d+)?)\s*[-~]\s*(\d+(?:\.\d+)?)$/);
    if (range) {
      setPriceMode('range');
      $('#f-price-min').value = range[1];
      $('#f-price-max').value = range[2];
    } else if (s && /^\d+(\.\d+)?$/.test(num)) {
      setPriceMode('single');
      $('#f-price-num').value = num;
    } else if (s) {
      setPriceMode('custom');
      $('#f-price-text').value = s;
    } else {
      setPriceMode('single');
    }
  }

  function readPriceForm() {
    var mode = 'single';
    document.querySelectorAll('input[name="price-mode"]').forEach(function (r) {
      if (r.checked) mode = r.value;
    });
    var digits = function (v) { return String(v || '').replace(/[^\d.]/g, ''); };

    if (mode === 'range') {
      var min = digits($('#f-price-min').value);
      var max = digits($('#f-price-max').value);
      if (min && max) return min + '-' + max;
      return min || max || '';
    }
    if (mode === 'custom') return $('#f-price-text').value.trim();
    return digits($('#f-price-num').value);
  }

  function fillCategorySelect(select, selectedId) {
    select.textContent = '';
    var optNone = document.createElement('option');
    optNone.value = '';
    optNone.textContent = '（未分类）';
    select.appendChild(optNone);
    state.categories.forEach(function (c) {
      var opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      if (String(c.id) === String(selectedId)) opt.selected = true;
      select.appendChild(opt);
    });
  }

  function updateImagePreview() {
    var url = $('#f-image-url').value;
    var box = $('#f-image-preview');
    if (url) {
      box.style.backgroundImage = 'url("' + url + '")';
      box.textContent = '';
    } else {
      box.style.backgroundImage = 'none';
      box.textContent = '无图片';
    }
  }

  function openProductModal(p) {
    $('#modal-title').textContent = p ? '编辑商品' : '新增商品';
    $('#f-id').value = p ? p.id : '';
    $('#f-name').value = p ? esc(p.name) : '';
    fillCategorySelect($('#f-category'), p ? p.category_id : '');
    fillPriceForm(p ? p.price : '');
    $('#f-description').value = p ? esc(p.description) : '';
    $('#f-link').value = p ? esc(p.link) : '';
    $('#f-image-url').value = p ? esc(p.image_url) : '';
    $('#f-sort').value = p ? p.sort : (state.products.length ? 0 : 0);
    $('#f-visible').checked = p ? !!p.visible : true;
    $('#f-soldout').checked = p ? !!p.sold_out : false;
    $('#upload-hint').textContent = '支持 JPG/PNG/GIF/WebP，10MB 以内';
    updateImagePreview();
    resetDescEditor();
    modalSnapshot = currentFormSnapshot();
    $('#product-modal').hidden = false;
  }

  // ── 未保存提醒：关闭前比对表单快照 ────
  var modalSnapshot = '';

  function currentFormSnapshot() {
    return JSON.stringify({
      name: $('#f-name').value,
      cat: $('#f-category').value,
      price: readPriceForm(),
      desc: $('#f-description').value,
      link: $('#f-link').value,
      img: $('#f-image-url').value,
      sort: $('#f-sort').value,
      vis: $('#f-visible').checked,
      so: $('#f-soldout').checked,
    });
  }

  function closeProductModal(force) {
    if (!force && currentFormSnapshot() !== modalSnapshot) {
      if (!confirm('有未保存的修改，确定关闭吗？')) return;
    }
    $('#product-modal').hidden = true;
  }

  $('#btn-new-product').addEventListener('click', function () { openProductModal(null); });
  $('#modal-close').addEventListener('click', closeProductModal);
  $('#modal-cancel').addEventListener('click', closeProductModal);
  $('#product-modal').addEventListener('click', function (e) {
    if (e.target === this) closeProductModal();
  });

  $('#modal-save').addEventListener('click', function () {
    var id = $('#f-id').value;
    var payload = {
      name: $('#f-name').value.trim(),
      category_id: $('#f-category').value || null,
      price: readPriceForm(),
      description: $('#f-description').value.trim(),
      link: $('#f-link').value.trim(),
      image_url: $('#f-image-url').value,
      sort: Number($('#f-sort').value) || 0,
      visible: $('#f-visible').checked,
      sold_out: $('#f-soldout').checked,
    };
    if (!payload.name) { toast('请填写商品名称', true); return; }

    var req = id
      ? api('PUT', '/api/products/' + id, payload)
      : api('POST', '/api/products', payload);

    req.then(function () {
      toast('已保存');
      modalSnapshot = currentFormSnapshot(); // 保存成功后再关，不触发提醒
      closeProductModal(true);
      loadAll();
    }).catch(function (err) { toast(err.message, true); });
  });

  // ── 富文本(HTML) → Markdown 转换（粘贴用）──
  function htmlToMarkdown(html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');

    function inlineNodes(parent) {
      var out = '';
      parent.childNodes.forEach(function (ch) {
        if (ch.nodeType === 3) { out += ch.textContent; return; }
        if (ch.nodeType !== 1) return;
        var tag = ch.tagName.toLowerCase();
        if (tag === 'br') out += '\n';
        else if (tag === 'strong' || tag === 'b') out += '**' + inlineNodes(ch).trim() + '**';
        else if (tag === 'em' || tag === 'i') out += '*' + inlineNodes(ch).trim() + '*';
        else if (tag === 'del' || tag === 's') out += '~~' + inlineNodes(ch).trim() + '~~';
        else if (tag === 'code') out += '`' + ch.textContent + '`';
        else if (tag === 'a') out += '[' + inlineNodes(ch).trim() + '](' + (ch.getAttribute('href') || '') + ')';
        else if (tag === 'img') out += '![' + (ch.getAttribute('alt') || '') + '](' + (ch.getAttribute('src') || '') + ')';
        else out += inlineNodes(ch);
      });
      return out;
    }

    var blocks = [];
    doc.body.childNodes.forEach(function (node) {
      if (node.nodeType === 3) {
        var t = node.textContent.trim();
        if (t) blocks.push(t);
        return;
      }
      if (node.nodeType !== 1) return;
      var tag = node.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) {
        blocks.push('#'.repeat(Number(tag[1])) + ' ' + inlineNodes(node).trim());
      } else if (tag === 'p') {
        var txt = inlineNodes(node).trim();
        if (txt) blocks.push(txt);
      } else if (tag === 'ul' || tag === 'ol') {
        var items = [];
        node.querySelectorAll(':scope > li').forEach(function (li, i) {
          items.push((tag === 'ol' ? (i + 1) + '. ' : '- ') + inlineNodes(li).trim());
        });
        blocks.push(items.join('\n'));
      } else if (tag === 'blockquote') {
        var q = inlineNodes(node).trim();
        if (q) blocks.push('> ' + q);
      } else if (tag === 'pre') {
        blocks.push('```\n' + node.textContent.replace(/\n+$/, '') + '\n```');
      } else if (tag === 'hr') {
        blocks.push('---');
      } else if (tag === 'br') {
        // 跳过
      } else {
        var rest = inlineNodes(node).trim();
        if (rest) blocks.push(rest);
      }
    });

    return blocks.join('\n\n').replace(/\n{3,}/g, '\n\n').replace(/ {2,}/g, ' ').trim();
  }

  // 判断剪贴板 HTML 是否含可转换的富元素（纯包装 div 之类不拦默认粘贴）
  htmlToMarkdown.looksRich = function (html) {
    return /<(img|a\b|b\b|strong|i\b|em|h[1-6]\b|ul\b|ol\b|blockquote|pre)\b/i.test(html);
  };

  // ── 图片上传统一入口（按设置决定压缩与水印）──
  // 流程：原图 → [压缩到 1500px]（展示用）→ [烧入站名水印] → 上传展示图 +（可选）原图另存
  function compositeWatermark(file, text) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var c = document.createElement('canvas');
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          var ctx = c.getContext('2d');
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, c.width, c.height); // JPEG 无透明通道，铺白底
          ctx.drawImage(img, 0, 0);

          var fs = Math.max(18, Math.round(Math.max(c.width, c.height) / 18));
          ctx.font = fs + 'px sans-serif';
          ctx.fillStyle = 'rgba(255,255,255,0.30)';
          ctx.strokeStyle = 'rgba(0,0,0,0.12)';
          ctx.lineWidth = 1;
          ctx.rotate(-24 * Math.PI / 180);
          var stepX = fs * 6.5, stepY = fs * 3.4;
          for (var y = -c.height; y < c.height * 2; y += stepY) {
            for (var x = -c.width; x < c.width * 2; x += stepX) {
              ctx.fillText(text, x, y);
              ctx.strokeText(text, x, y);
            }
          }
          URL.revokeObjectURL(url);
          c.toBlob(function (blob) {
            resolve(blob && blob.size ? blob : null);
          }, 'image/jpeg', 0.92);
        } catch (e) { reject(e); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('图片读取失败')); };
      img.src = url;
    });
  }

  function compressImage(file, maxDim) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.naturalWidth, h = img.naturalHeight;
          var m = Math.max(w, h);
          if (m <= maxDim) { URL.revokeObjectURL(url); resolve(null); return; } // 无需压缩
          var scale = maxDim / m;
          var c = document.createElement('canvas');
          c.width = Math.round(w * scale);
          c.height = Math.round(h * scale);
          var ctx = c.getContext('2d');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, c.width, c.height);
          URL.revokeObjectURL(url);
          c.toBlob(function (blob) {
            resolve(blob && blob.size ? blob : null);
          }, 'image/jpeg', 0.9);
        } catch (e) { reject(e); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('图片读取失败')); };
      img.src = url;
    });
  }

  async function uploadImage(file) {
    var wmOn = state.settings.watermark_on !== '0';
    var cpOn = state.settings.compress_on === '1';
    var text = (state.settings.site_name || '').trim() || 'lusiflowers';
    var displayFile = file;

    // 自动压图：大图缩到 1500px 内（仅影响展示图，原图另存不受影响）
    if (cpOn && /^image\/(jpeg|png|webp|avif)$/.test(file.type)) {
      try {
        var compressed = await compressImage(file, 1500);
        if (compressed) {
          displayFile = new File([compressed], 'c.jpg', { type: 'image/jpeg' });
        }
      } catch (e) {
        console.error('压缩失败，使用原图', e);
      }
    }

    if (wmOn && /^image\/(jpeg|png|webp|avif)$/.test(displayFile.type)) {
      try {
        var blob = await compositeWatermark(displayFile, text);
        if (blob) {
          var form = new FormData();
          form.append('file', new File([blob], 'wm.jpg', { type: 'image/jpeg' }));
          // 原图：水印开启时始终另存完整原图（含未压缩版本）
          form.append('orig', file, file.name || 'orig');
          return api('POST', '/api/upload', form, true);
        }
      } catch (e) {
        console.error('水印合成失败，回退原图上传', e);
      }
    }

    var form = new FormData();
    form.append('file', displayFile);
    return api('POST', '/api/upload', form, true);
  }

  // ── Markdown 描述编辑器 ───────────────
  var descEditor = {
    textarea: null,
    hint: null,

    init: function () {
      var ta = $('#f-description');
      var editor = $('#md-editor');
      this.textarea = ta;
      this.hint = $('#desc-upload-hint');

      // 工具栏
      editor.querySelectorAll('.md-btn').forEach(function (btn) {
        btn.addEventListener('click', function () { descEditor.toolbar(btn.dataset.cmd); });
      });

      // 图片按钮 → 文件选择
      $('[data-cmd="image"]') && $('#f-desc-image-file').addEventListener('change', function () {
        descEditor.uploadFiles(this.files);
        this.value = '';
      });

      // 实时预览
      ta.addEventListener('input', function () { descEditor.renderPreview(); });

      // 拖拽上传
      ['dragenter', 'dragover'].forEach(function (ev) {
        editor.addEventListener(ev, function (e) {
          e.preventDefault();
          e.stopPropagation();
          editor.classList.add('dragover');
        });
      });
      ['dragleave', 'drop'].forEach(function (ev) {
        editor.addEventListener(ev, function (e) {
          e.preventDefault();
          e.stopPropagation();
          editor.classList.remove('dragover');
        });
      });
      editor.addEventListener('drop', function (e) {
        if (e.dataTransfer && e.dataTransfer.files.length) {
          descEditor.uploadFiles(e.dataTransfer.files);
        }
      });

      // 粘贴：图片文件 → 上传；富文本(HTML) → 转 Markdown；纯文本 → 原样
      ta.addEventListener('paste', function (e) {
        var cd = e.clipboardData;
        if (!cd) return;

        var files = [];
        var items = cd.items || [];
        for (var i = 0; i < items.length; i++) {
          if (items[i].kind === 'file' && /^image\//.test(items[i].type)) {
            var f = items[i].getAsFile();
            if (f) files.push(f);
          }
        }
        if (files.length) {
          e.preventDefault();
          descEditor.uploadFiles(files);
          return;
        }

        var html = cd.getData && cd.getData('text/html');
        if (html && htmlToMarkdown.looksRich(html)) {
          var md = htmlToMarkdown(html);
          if (md && md.trim()) {
            e.preventDefault();
            descEditor.insertAtCursor(md);
          }
        }
        // 纯文本（含 Markdown 源码）走浏览器默认行为
      });
    },

    // 在光标处插入文本
    insertAtCursor: function (text) {
      var ta = this.textarea;
      var start = ta.selectionStart, end = ta.selectionEnd;
      ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
      var pos = start + text.length;
      ta.focus();
      ta.setSelectionRange(pos, pos);
      this.renderPreview();
    },

    wrapSelection: function (before, after, placeholder) {
      var ta = this.textarea;
      var start = ta.selectionStart, end = ta.selectionEnd;
      var sel = ta.value.slice(start, end) || placeholder;
      ta.value = ta.value.slice(0, start) + before + sel + after + ta.value.slice(end);
      ta.focus();
      ta.setSelectionRange(start + before.length, start + before.length + sel.length);
      this.renderPreview();
    },

    linePrefix: function (prefix) {
      var ta = this.textarea;
      var start = ta.value.lastIndexOf('\n', ta.selectionStart - 1) + 1;
      var end = ta.value.indexOf('\n', ta.selectionEnd);
      if (end === -1) end = ta.value.length;
      var block = ta.value.slice(start, end) || '文字';
      var lines = block.split('\n').map(function (l) { return prefix + l; });
      ta.value = ta.value.slice(0, start) + lines.join('\n') + ta.value.slice(end);
      ta.focus();
      ta.setSelectionRange(start, start + lines.join('\n').length);
      this.renderPreview();
    },

    toolbar: function (cmd) {
      if (cmd === 'bold') this.wrapSelection('**', '**', '加粗文字');
      else if (cmd === 'italic') this.wrapSelection('*', '*', '斜体文字');
      else if (cmd === 'h') this.linePrefix('## ');
      else if (cmd === 'ul') this.linePrefix('- ');
      else if (cmd === 'link') this.wrapSelection('[', '](https://)', '链接文字');
      else if (cmd === 'image') $('#f-desc-image-file').click();
    },

    uploadFiles: function (fileList) {
      var files = Array.prototype.slice.call(fileList || []).filter(function (f) {
        return /^image\//.test(f.type);
      });
      if (!files.length) return;
      var hint = this.hint;
      var total = files.length;
      var done = 0;
      hint.textContent = total > 1
        ? '批量上传中 0/' + total + ' ..'
        : '上传中，请稍候..';

      var that = this;
      var queue = files.slice();
      (function next() {
        if (!queue.length) {
          hint.textContent = total > 1 ? '全部 ' + total + ' 张上传完成' : '上传完成';
          setTimeout(function () { if (/上传完成/.test(hint.textContent)) hint.textContent = ''; }, 2500);
          return;
        }
        var file = queue.shift();
        uploadImage(file).then(function (data) {
          that.insertAtCursor('\n\n![图片](' + data.url + ')\n\n');
          done++;
          if (total > 1) hint.textContent = '批量上传中 ' + done + '/' + total + ' ..';
          next();
        }).catch(function (err) {
          hint.textContent = '上传失败：' + err.message;
        });
      })();
    },

    renderPreview: function () {
      var wrap = $('#md-preview-wrap');
      if (wrap.hidden) return;
      $('#md-preview').innerHTML = window.MD ? MD.render(this.textarea.value) : '';
    }
  };

  $('#btn-toggle-preview').addEventListener('click', function () {
    var wrap = $('#md-preview-wrap');
    wrap.hidden = !wrap.hidden;
    this.textContent = wrap.hidden ? '预览' : '关闭预览';
    if (!wrap.hidden) descEditor.renderPreview();
  });

  descEditor.init();

  // 打开弹窗时重置预览状态
  function resetDescEditor() {
    $('#md-preview-wrap').hidden = true;
    $('#btn-toggle-preview').textContent = '预览';
    $('#desc-upload-hint').textContent = '';
  }

  // ── 图片上传（主图：按钮选择 + 拖拽到预览框）──
  function uploadMainImage(file) {
    if (!file || !/^image\//.test(file.type)) return;
    var hint = $('#upload-hint');
    hint.textContent = '上传中，请稍候..';

    uploadImage(file).then(function (data) {
      $('#f-image-url').value = data.url;
      updateImagePreview();
      hint.textContent = '上传成功';
      setTimeout(function () { if (hint.textContent === '上传成功') hint.textContent = ''; }, 2500);
    }).catch(function (err) {
      hint.textContent = '上传失败：' + err.message;
    });
  }

  $('#btn-upload').addEventListener('click', function () { $('#f-image-file').click(); });

  $('#f-image-file').addEventListener('change', function () {
    uploadMainImage(this.files[0]);
    this.value = '';
  });

  // 拖拽上传：整个预览行作为放置区
  (function () {
    var zone = document.querySelector('.upload-row');
    if (!zone) return;
    ['dragenter', 'dragover'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.add('dragover');
      });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.remove('dragover');
      });
    });
    zone.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files.length) {
        uploadMainImage(e.dataTransfer.files[0]);
      }
    });
  })();

  $('#btn-remove-image').addEventListener('click', function () {
    $('#f-image-url').value = '';
    $('#f-image-file').value = '';
    updateImagePreview();
  });

  // ── 分类管理 ───────────────────────────
  function renderCategoryList() {
    var box = $('#cat-list');
    box.textContent = '';

    if (!state.categories.length) {
      var empty = document.createElement('div');
      empty.className = 'loading';
      empty.textContent = '还没有分类';
      box.appendChild(empty);
      return;
    }

    state.categories.forEach(function (c) {
      var count = state.products.filter(function (p) { return String(p.category_id) === String(c.id); }).length;
      var row = document.createElement('div');
      row.className = 'crow';

      var main = document.createElement('div');
      main.className = 'crow-main';
      main.textContent = c.name + '（' + count + ' 个商品）';
      row.appendChild(main);

      var renameBtn = document.createElement('button');
      renameBtn.type = 'button';
      renameBtn.className = 'btn btn-sm';
      renameBtn.textContent = '重命名';
      renameBtn.addEventListener('click', function () {
        var name = prompt('新的分类名称：', c.name);
        if (!name || !name.trim() || name.trim() === c.name) return;
        api('PUT', '/api/categories/' + c.id, { name: name.trim() })
          .then(function () { toast('已重命名'); loadAll(); })
          .catch(function (err) { toast(err.message, true); });
      });
      row.appendChild(renameBtn);

      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn btn-sm btn-danger-ghost';
      delBtn.textContent = '删除';
      delBtn.addEventListener('click', function () {
        if (!confirm('确定删除分类「' + c.name + '」吗？分类下的 ' + count + ' 个商品会变为"未分类"，不会被删除。')) return;
        api('DELETE', '/api/categories/' + c.id)
          .then(function () { toast('已删除'); loadAll(); })
          .catch(function (err) { toast(err.message, true); });
      });
      row.appendChild(delBtn);

      box.appendChild(row);
    });
  }

  $('#cat-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = $('#cat-name');
    var name = input.value.trim();
    if (!name) return;
    api('POST', '/api/categories', { name: name })
      .then(function () { toast('已添加'); input.value = ''; loadAll(); })
      .catch(function (err) { toast(err.message, true); });
  });

  // ── 站点设置 ───────────────────────────
  // 访问码展示（来自登录后 /api/settings 的 _view 字段）
  function updateViewCodeInfo(settings) {
    var el = $('#view-code-info');
    var v = settings && settings._view;
    if (!v || !v.code) { el.textContent = '当前访问码：—（填写基础口令并保存后生成）'; return; }
    var h = Number(settings.view_pw_hours) || 0;
    var txt = '当前访问码：' + v.code + '（发给访客即可，区分大小写）';
    if (v.next_rotate_at) {
      var mins = Math.max(1, Math.round((v.next_rotate_at - Date.now()) / 60000));
      txt += '，' + (mins >= 60 ? Math.round(mins / 60) + ' 小时' : mins + ' 分钟') + '后自动更换';
    } else {
      txt += '，固定不变';
    }
    el.textContent = txt;
  }

  $('#set-view-hours').addEventListener('change', function () {
    // 轮换周期变化后访问码即时变化，保存后更新展示
    var base = $('#set-view-password').value.trim();
    if (!base) return;
  });

  function fillSettingsForm(settings) {
    $('#set-site-name').value = settings.site_name || '';
    $('#set-home-title').value = settings.home_title || '';
    $('#set-announcement').value = settings.announcement || '';
    $('#set-watermark').checked = settings.watermark_on !== '0';
    $('#set-compress').checked = settings.compress_on === '1';
    $('#set-og').checked = settings.og_on === '1';
    $('#set-contact-on').checked = settings.contact_on === '1';
    $('#set-contact-text').value = settings.contact_text || '';
    $('#set-contact-link').value = settings.contact_link || '';
    contactQrPending = null;
    updateContactQrPreview(settings.contact_img || '');
    $('#set-view-protect').checked = settings.view_protect === '1';
    $('#set-view-password').value = settings.view_password || '';
    $('#set-view-hours').value = String(settings.view_pw_hours || '0');
    updateViewCodeInfo(settings);
    faviconPending = null;
    updateFaviconPreview(settings.favicon_url || '');
  }

  // ── 网站图标上传（不加水印，直接原图存储）──
  var faviconPending = null; // null=未改动；''=恢复默认；其他=新图标 URL

  function updateFaviconPreview(url) {
    $('#favicon-preview').src = url || '/favicon.svg';
  }

  $('#btn-favicon-upload').addEventListener('click', function () { $('#favicon-file').click(); });

  $('#favicon-file').addEventListener('change', function () {
    var file = this.files[0];
    this.value = '';
    if (!file || !/^image\//.test(file.type)) return;
    var form = new FormData();
    form.append('file', file);
    api('POST', '/api/upload', form, true).then(function (data) {
      faviconPending = data.url;
      updateFaviconPreview(data.url);
      toast('图标已上传，记得点「保存设置」生效');
    }).catch(function (err) { toast(err.message, true); });
  });

  $('#btn-favicon-reset').addEventListener('click', function () {
    faviconPending = '';
    updateFaviconPreview('');
    toast('将恢复默认图标，记得点「保存设置」生效');
  });

  // ── 联系浮窗二维码上传（不加水印）──────
  var contactQrPending = null; // null=未改动；''=清除；其他=新图 URL

  function updateContactQrPreview(url) {
    var img = $('#contact-qr-preview');
    if (url) { img.src = url; img.hidden = false; }
    else { img.removeAttribute('src'); img.hidden = true; }
  }

  $('#btn-contact-qr').addEventListener('click', function () { $('#contact-qr-file').click(); });

  $('#contact-qr-file').addEventListener('change', function () {
    var file = this.files[0];
    this.value = '';
    if (!file || !/^image\//.test(file.type)) return;
    var form = new FormData();
    form.append('file', file);
    api('POST', '/api/upload', form, true).then(function (data) {
      contactQrPending = data.url;
      updateContactQrPreview(data.url);
      toast('二维码已上传，记得点「保存设置」生效');
    }).catch(function (err) { toast(err.message, true); });
  });

  $('#btn-contact-qr-clear').addEventListener('click', function () {
    contactQrPending = '';
    updateContactQrPreview('');
    toast('已清除二维码，记得点「保存设置」生效');
  });

  $('#settings-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var faviconUrl = faviconPending !== null ? faviconPending : (state.settings.favicon_url || '');
    api('PUT', '/api/settings', {
      site_name: $('#set-site-name').value.trim(),
      home_title: $('#set-home-title').value.trim(),
      favicon_url: faviconUrl,
      announcement: $('#set-announcement').value,
      watermark_on: $('#set-watermark').checked ? '1' : '0',
      compress_on: $('#set-compress').checked ? '1' : '0',
      og_on: $('#set-og').checked ? '1' : '0',
      view_protect: $('#set-view-protect').checked ? '1' : '0',
      view_password: $('#set-view-password').value.trim(),
      view_pw_hours: String($('#set-view-hours').value || '0'),
      contact_on: $('#set-contact-on').checked ? '1' : '0',
      contact_img: contactQrPending !== null ? contactQrPending : (state.settings.contact_img || ''),
      contact_text: $('#set-contact-text').value.trim(),
      contact_link: $('#set-contact-link').value.trim(),
    }).then(function () {
      // 同步到本会话状态，立即影响后续上传
      state.settings.watermark_on = $('#set-watermark').checked ? '1' : '0';
      state.settings.compress_on = $('#set-compress').checked ? '1' : '0';
      state.settings.site_name = $('#set-site-name').value.trim();
      state.settings.home_title = $('#set-home-title').value.trim();
      state.settings.favicon_url = faviconUrl;
      faviconPending = null;
      contactQrPending = null;
      // 重新拉取以显示最新访问码
      api('GET', '/api/settings').then(function (r) {
        state.settings = r.settings || state.settings;
        updateViewCodeInfo(state.settings);
      }).catch(function () {});
      $('#settings-hint').textContent = '已保存 ✓';
      setTimeout(function () { $('#settings-hint').textContent = ''; }, 2500);
    }).catch(function (err) { toast(err.message, true); });
  });

  // ── 数据导出 ───────────────────────────
  $('#btn-export').addEventListener('click', function () {
    fetch('/api/export').then(function (res) {
      if (!res.ok) throw new Error('导出失败（HTTP ' + res.status + '）');
      return res.json();
    }).then(function (data) {
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      var d = new Date();
      var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
      a.href = URL.createObjectURL(blob);
      a.download = 'shop-backup-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate())
        + '-' + pad(d.getHours()) + pad(d.getMinutes()) + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast('已导出');
    }).catch(function (err) { toast(err.message, true); });
  });

  // ── 启动：探测会话 ─────────────────────
  fetch('/api/login', { method: 'GET' })
    .then(function (res) { res.ok ? showAdmin() : showLogin(); })
    .catch(showLogin);
})();
