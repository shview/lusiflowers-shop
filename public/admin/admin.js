// 后台管理逻辑：登录 / 商品 CRUD / 图片上传 / 分类 / 站点设置
(function () {
  'use strict';

  var state = { categories: [], products: [], settings: {} };
  var dragRow = null;

  // 价格展示格式化（与前台同规则）：纯数字加 ¥，"a-b" 展开为 ¥a - ¥b，其他原样
  function formatPrice(raw) {
    var s = String(raw || '').trim();
    if (!s) return '';
    var num = s.replace(/[¥￥,\s]/g, '');
    if (/^\d+(\.\d+)?$/.test(num)) return '¥' + num;
    var m = num.match(/^(\d+(?:\.\d+)?)\s*[-~]\s*(\d+(?:\.\d+)?)$/);
    if (m) return '¥' + m[1] + ' - ¥' + m[2];
    return s;
  }

  // ── 复制链接 / 最近编辑 / 批量选择 ──
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy') ? resolve() : reject(new Error('复制失败')); } catch (e) { reject(e); }
      ta.remove();
    });
  }

  var recentIds = [];
  try { recentIds = JSON.parse(localStorage.getItem('recent_products') || '[]'); } catch (e) { recentIds = []; }

  function pushRecent(id) {
    recentIds = [{ id: id, ts: Date.now() }].concat(recentIds.filter(function (r) { return r.id !== id; })).slice(0, 5);
    try { localStorage.setItem('recent_products', JSON.stringify(recentIds)); } catch (e) { /* 忽略 */ }
    renderRecent();
  }

  function renderRecent() {
    var bar = $('#recent-bar');
    if (!bar) return;
    var chips = $('#recent-chips');
    chips.textContent = '';
    var list = recentIds.map(function (r) {
      return state.products.find(function (p) { return p.id === r.id; });
    }).filter(Boolean);
    bar.hidden = list.length === 0;
    list.forEach(function (p) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'recent-chip';
      chip.textContent = p.name;
      chip.addEventListener('click', function () { openProductModal(p); });
      chips.appendChild(chip);
    });
  }

  var batchSel = new Set();
  function updateBatchBar() {
    var bar = $('#batch-bar');
    bar.hidden = batchSel.size === 0;
    $('#batch-count').textContent = '已选 ' + batchSel.size + ' 项';
    var sel = $('#batch-cat');
    var cur = sel.value;
    sel.textContent = '';
    var opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '批量改分类为…';
    sel.appendChild(opt);
    state.categories.forEach(function (c) {
      var o = document.createElement('option');
      o.value = c.id;
      o.textContent = c.name;
      sel.appendChild(o);
    });
    if (cur) sel.value = cur;
  }

  function batchRun(fn) {
    var ids = Array.from(batchSel);
    if (!ids.length) return;
    Promise.all(ids.map(fn))
      .then(function () { toast('批量操作完成'); batchSel.clear(); loadAll(); })
      .catch(function (err) { toast(err.message, true); loadAll(); });
  }

  function bindBatchUI() {
  $('#batch-show').addEventListener('click', function () { batchRun(function (id) { return api('PUT', '/api/products/' + id, { visible: true }); }); });
  $('#batch-hide').addEventListener('click', function () { batchRun(function (id) { return api('PUT', '/api/products/' + id, { visible: false }); }); });
  $('#batch-cat-apply').addEventListener('click', function () {
    var cat = $('#batch-cat').value;
    if (!cat) { toast('先选择目标分类'); return; }
    batchRun(function (id) { return api('PUT', '/api/products/' + id, { category_id: Number(cat) }); });
  });
  $('#batch-del').addEventListener('click', function () {
    var n = batchSel.size;
    if (!n || !confirm('删除选中的 ' + n + ' 个商品？删除后无法逐个撤销（批量场景请确认清楚）。')) return;
    batchRun(function (id) { return api('DELETE', '/api/products/' + id); });
  });
  $('#batch-clear').addEventListener('click', function () {
    batchSel.clear();
    document.querySelectorAll('#product-list .prow').forEach(function (r) {
      var cb = r.querySelector('.prow-check'); if (cb) cb.checked = false;
    });
    updateBatchBar();
  });

  }

  // ── 删除撤销（30 秒窗口）──
  var undoTimers = {};
  function deleteWithUndo(p) {
    var undoOn = state.settings.undo_on !== '0';
    if (!undoOn) {
      if (!confirm('确定删除商品「' + p.name + '」吗？此操作不可恢复。')) return;
      api('DELETE', '/api/products/' + p.id)
        .then(function () { toast('已删除'); loadAll(); })
        .catch(function (err) { toast(err.message, true); });
      return;
    }
    if (!confirm('确定删除商品「' + p.name + '」吗？30 秒内可撤销。')) return;
    var wasVisible = !!p.visible;
    api('DELETE', '/api/products/' + p.id).then(function () {
      var snapshot = {
        id: p.id, name: p.name, category_id: p.category_id, price: p.price,
        description: p.description, image_url: p.image_url, link: p.link,
        sort: p.sort, visible: wasVisible, sold_out: !!p.sold_out,
      };
      loadAll();
      startUndoWindow(snapshot);
    }).catch(function (err) { toast(err.message, true); });
  }

  function startUndoWindow(snapshot) {
    if (undoTimers[snapshot.id]) clearTimeout(undoTimers[snapshot.id]);
    var left = 30;
    var box = $('#undo-toast'), txt = $('#undo-text');
    box.hidden = false;
    txt.textContent = '「' + snapshot.name + '」已删除（' + left + 's）';
    var tick = setInterval(function () {
      left--;
      if (left <= 0) { clearInterval(tick); box.hidden = true; return; }
      txt.textContent = '「' + snapshot.name + '」已删除（' + left + 's）';
    }, 1000);
    undoTimers[snapshot.id] = setTimeout(function () {
      clearInterval(tick);
      box.hidden = true;
      delete undoTimers[snapshot.id];
    }, 30000);
    $('#undo-btn').onclick = function () {
      clearInterval(tick);
      clearTimeout(undoTimers[snapshot.id]);
      delete undoTimers[snapshot.id];
      box.hidden = true;
      api('POST', '/api/products', snapshot).then(function () {
        toast('已撤销删除');
        loadAll();
      }).catch(function (err) {
        toast('撤销失败：' + err.message, true);
      });
    };
  }

  // ── 浏览报表 ──
  function loadReport() {
    api('GET', '/api/report').then(renderReport).catch(function () {});
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderReport(r) {
    var card = $('#report-card');
    if (!card) return;
    var hasViews = (r.top || []).some(function (t) { return t.views > 0; });
    var hasTrend = (r.trend || []).length > 0;
    card.hidden = !hasViews && !hasTrend;
    if (card.hidden) return;

    var byDay = {};
    (r.trend || []).forEach(function (t) { byDay[t.day] = t.v; });
    var days = [], vals = [];
    for (var i = 6; i >= 0; i--) {
      var d = new Date(Date.now() - i * 86400000);
      var key = d.toISOString().slice(0, 10);
      days.push(key.slice(5));
      vals.push(byDay[key] || 0);
    }
    var max = Math.max.apply(null, vals.concat([1]));

    var h = '<div class="report-title">浏览统计</div><div class="report-top">';
    (r.top || []).forEach(function (t, i) {
      h += '<div class="report-row"><span class="report-rank">' + (i + 1) + '</span>'
        + '<span class="report-name">' + escapeHtml(t.name) + '</span>'
        + '<span class="report-views">' + t.views + ' 次</span></div>';
    });
    h += '</div><div class="report-trend">';
    vals.forEach(function (v, i) {
      h += '<div class="report-col"><div class="report-bar" style="height:' + Math.max(2, Math.round(v / max * 46)) + 'px" title="' + v + ' 次"></div>'
        + '<div class="report-day">' + days[i] + '</div></div>';
    });
    h += '</div>';
    card.innerHTML = h;
  }

  // 清除所有拖拽指示线
  function clearDragHints() {
    document.querySelectorAll('#product-list .prow').forEach(function (r) {
      r.style.borderTop = '';
      r.style.borderBottom = '';
    });
  }

  // 容器级兜底：行间隙/列表边缘的拖放与拖拽结束，任何情况下都清理指示线；
  // 并实现触屏长按拖动排序（HTML5 DnD 在移动端不可用）
  function bindListDragFallback() {
    var list = $('#product-list');
    if (!list || list.dataset.dragBound) return;
    list.dataset.dragBound = '1';
    list.addEventListener('dragover', function (e) { e.preventDefault(); });
    list.addEventListener('drop', function (e) { e.preventDefault(); clearDragHints(); });
    list.addEventListener('dragend', function () { clearDragHints(); });

    var touch = { active: false, row: null, target: null, before: false, startX: 0, startY: 0, timer: null };

    function rowAt(x, y) {
      var el = document.elementFromPoint(x, y);
      return el && el.closest ? el.closest('#product-list .prow') : null;
    }

    list.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return;
      var t = e.touches[0];
      var row = rowAt(t.clientX, t.clientY);
      if (!row) return;
      touch.startX = t.clientX;
      touch.startY = t.clientY;
      touch.row = row;
      touch.target = null;
      touch.timer = setTimeout(function () {
        touch.active = true;
        row.classList.add('dragging');
        if (navigator.vibrate) { try { navigator.vibrate(20); } catch (err) { /* 忽略 */ } }
      }, 280);
    }, { passive: true });

    list.addEventListener('touchmove', function (e) {
      if (!touch.active) {
        // 未进入拖拽模式先滑动 → 视为滚动，取消长按计时
        var t = e.touches[0];
        if (Math.abs(t.clientY - touch.startY) > 10 || Math.abs(t.clientX - touch.startX) > 10) {
          clearTimeout(touch.timer);
        }
        return;
      }
      e.preventDefault(); // 拖拽中阻止页面滚动
      var t = e.touches[0];
      var row = rowAt(t.clientX, t.clientY);
      clearDragHints();
      touch.target = null;
      if (row && row !== touch.row) {
        var rect = row.getBoundingClientRect();
        touch.before = t.clientY < rect.top + rect.height / 2;
        touch.target = row;
        if (touch.before) row.style.borderTop = '2px solid var(--accent)';
        else row.style.borderBottom = '2px solid var(--accent)';
      }
    }, { passive: false });

    function touchFinish() {
      clearTimeout(touch.timer);
      if (!touch.active) return;
      touch.active = false;
      var dragId = touch.row ? Number(touch.row.dataset.id) : 0;
      if (touch.row) touch.row.classList.remove('dragging');
      clearDragHints();
      if (touch.target && dragId && touch.target !== touch.row) {
        saveOrderFromDom(dragId, Number(touch.target.dataset.id), touch.before);
      }
      touch.row = null;
      touch.target = null;
    }

    list.addEventListener('touchend', touchFinish);
    list.addEventListener('touchcancel', touchFinish);
  }

  // 按 DOM 顺序重写全部商品的 sort（拖拽排序保存）——基于全局顺序，筛选状态下也正确
  function saveOrderFromDom(dragId, targetId, before) {
    var ids = state.products.map(function (p) { return p.id; }); // 当前全局顺序
    var from = ids.indexOf(dragId);
    if (from === -1) return;
    ids.splice(from, 1);
    var to = ids.indexOf(targetId);
    if (to === -1) { loadAll(); return; }
    ids.splice(before ? to : to + 1, 0, dragId);

    var jobs = [];
    ids.forEach(function (id, i) {
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
      ['products', 'categories', 'images', 'settings'].forEach(function (name) {
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
      renderImagesPane();
      renderRecent();
      loadReport();
      api('GET', '/api/images/orphans').then(updateImgStats).catch(function () {});
    }).catch(function (err) { toast(err.message, true); });
  }

  // ── 商品列表 ───────────────────────────
  var adminCatFilter = 'all';
  var adminKw = '';

  $('#admin-kw').addEventListener('input', function () {
    adminKw = this.value.trim().toLowerCase();
    renderProductList();
  });

  function fillCategoryFilter() {
    var sel = $('#admin-cat-filter');
    if (!sel) return;
    var current = adminCatFilter;
    sel.textContent = '';
    var optAll = document.createElement('option');
    optAll.value = 'all';
    optAll.textContent = '全部分类';
    sel.appendChild(optAll);
    state.categories.forEach(function (c) {
      var opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      sel.appendChild(opt);
    });
    // 保留当前选择（选项仍在时）
    sel.value = current;
    if (sel.value !== String(current)) { adminCatFilter = 'all'; sel.value = 'all'; }
  }

  $('#admin-cat-filter').addEventListener('change', function () {
    adminCatFilter = this.value;
    renderProductList();
  });

  function renderProductList() {
    var box = $('#product-list');
    box.textContent = '';
    bindListDragFallback();
    fillCategoryFilter();

    var products = state.products;
    if (adminCatFilter !== 'all') {
      products = products.filter(function (p) { return String(p.category_id) === String(adminCatFilter); });
    }
    if (adminKw) {
      products = products.filter(function (p) {
        var hay = (p.name || '') + '\n' + (p.description || '') + '\n' + (p.price || '');
        return hay.toLowerCase().indexOf(adminKw) !== -1;
      });
    }

    if (!products.length) {
      var empty = document.createElement('div');
      empty.className = 'loading';
      empty.textContent = adminKw ? '没有匹配的商品'
        : (adminCatFilter === 'all'
          ? '还没有商品，点击右上角「新增商品」添加第一个吧'
          : '该分类下还没有商品');
      box.appendChild(empty);
      return;
    }

    products.forEach(function (p) {
      var row = document.createElement('div');
      row.className = 'prow';

      var check = document.createElement('input');
      check.type = 'checkbox';
      check.className = 'prow-check';
      check.checked = batchSel.has(p.id);
      check.title = '批量选择';
      check.addEventListener('click', function (e) { e.stopPropagation(); });
      check.addEventListener('change', function () {
        if (check.checked) batchSel.add(p.id); else batchSel.delete(p.id);
        updateBatchBar();
      });
      row.appendChild(check);

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
      meta.textContent = catName + (p.price ? ' · ' + formatPrice(p.price) : '') + ' · 排序 ' + p.sort
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
      opBtn('复制链接', function () {
        copyText(location.origin + '/p/' + p.id)
          .then(function () { toast('链接已复制：/p/' + p.id); })
          .catch(function () { toast('复制失败', true); });
      });
      opBtn('删除', function () { deleteWithUndo(p); });

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
        saveOrderFromDom(Number(dragRow.dataset.id), Number(row.dataset.id), before);
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
    sessionUploads = [];
    modalSnapshot = currentFormSnapshot();
    if (p) pushRecent(p.id);
    maybeRestoreDraft(p);
    $('#product-modal').hidden = false;
  }


  // ── 草稿箱 ─────────────────────────────
  function draftKey(p) { return p ? 'draft_edit_' + p.id : 'draft_new'; }

  function saveDraft() {
    var data = {
      name: $('#f-name').value,
      cat: $('#f-category').value,
      price: readPriceForm(),
      desc: $('#f-description').value,
      link: $('#f-link').value,
      img: $('#f-image-url').value,
      sort: $('#f-sort').value,
      vis: $('#f-visible').checked,
      so: $('#f-soldout').checked,
    };
    var key = draftKey($('#f-id').value ? { id: Number($('#f-id').value) } : null);
    try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) { /* 忽略 */ }
  }

  var draftTimer = null;
  document.addEventListener('input', function (e) {
    if (!e.target.closest || !e.target.closest('#product-form')) return;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 500);
  });
  document.addEventListener('change', function (e) {
    if (!e.target.closest || !e.target.closest('#product-form')) return;
    saveDraft();
  });

  function applyDraft(d) {
    $('#f-name').value = d.name || '';
    fillPriceForm(d.price || '');
    $('#f-category').value = d.cat || '';
    $('#f-description').value = d.desc || '';
    $('#f-link').value = d.link || '';
    $('#f-image-url').value = d.img || '';
    $('#f-sort').value = d.sort || '0';
    $('#f-visible').checked = d.vis !== false;
    $('#f-soldout').checked = !!d.so;
    updateImagePreview();
    resetDescEditor();
  }

  function clearDraft(p) {
    try { localStorage.removeItem(draftKey(p)); } catch (e) { /* 忽略 */ }
  }

  function maybeRestoreDraft(p) {
    var raw = null;
    try { raw = localStorage.getItem(draftKey(p)); } catch (e) { return; }
    if (!raw) return;
    var d;
    try { d = JSON.parse(raw); } catch (e) { clearDraft(p); return; }
    if (!d) return;
    if (confirm('检测到未保存的草稿，恢复吗？\n（选「取消」则丢弃草稿）')) {
      applyDraft(d);
      toast('草稿已恢复');
    } else {
      clearDraft(p);
    }
  }

  // ── 未保存提醒：关闭前比对表单快照 ────
  var modalSnapshot = '';
  var sessionUploads = []; // 本次弹窗会话上传的展示图 key

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

  // 回收本次会话上传且未被引用的图片（服务端二次校验引用，他商品在用会保留）
  function recycleSessionUploads() {
    if (!sessionUploads.length) return;
    var keys = sessionUploads.slice();
    sessionUploads = [];
    api('POST', '/api/images/orphans', { keys: keys })
      .then(function (r) { if (r.deleted > 0) toast('已自动清理 ' + r.deleted + ' 张未使用的图片'); })
      .catch(function (err) { console.error('回收失败', err); });
  }

  function closeProductModal(force) {
    if (!force && currentFormSnapshot() !== modalSnapshot) {
      if (!confirm('有未保存的修改，确定关闭吗？\n草稿与刚上传但未使用的图片将被清理。')) return;
      clearDraft($('#f-id').value ? { id: Number($('#f-id').value) } : null);
    }
    if (!force) recycleSessionUploads();
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
      clearDraft(id ? { id: Number(id) } : null);
      // 本次会话上传、但最终未出现在表单里的图片（如换过主图）自动回收
      var used = [payload.image_url].concat(
        (payload.description.match(/!\[[^\]]*\]\(([^)\s]+)\)/g) || []).map(function (m) {
          return (m.match(/\(([^)\s]+)\)$/)[1]);
        })
      );
      var unused = sessionUploads.filter(function (key) {
        return used.indexOf('/api/img/' + key) === -1;
      });
      if (unused.length) {
        api('POST', '/api/images/orphans', { keys: unused })
          .then(function (r) { if (r.deleted > 0) toast('已回收 ' + r.deleted + ' 张未使用图片'); })
          .catch(function () {});
      }
      sessionUploads = [];
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

    // 缩略图：展示图缩到 400px（GIF 跳过；本身就是小图时直接用展示图）
    var thumbBlob = null;
    if (/^image\/(jpeg|png|webp|avif)$/.test(displayFile.type)) {
      try {
        thumbBlob = await compressImage(displayFile, 400);
        if (!thumbBlob && displayFile.size <= 300 * 1024) thumbBlob = displayFile;
      } catch (e) { thumbBlob = null; }
    }

    var withThumb = function (form) {
      if (thumbBlob) {
        form.append('thumb', thumbBlob instanceof File
          ? thumbBlob
          : new File([thumbBlob], 't.jpg', { type: 'image/jpeg' }));
      }
      return form;
    };

    if (wmOn && /^image\/(jpeg|png|webp|avif)$/.test(displayFile.type)) {
      try {
        var blob = await compositeWatermark(displayFile, text);
        if (blob) {
          var form = new FormData();
          form.append('file', new File([blob], 'wm.jpg', { type: 'image/jpeg' }));
          // 原图：水印开启时始终另存完整原图（含未压缩版本）
          form.append('orig', file, file.name || 'orig');
          return api('POST', '/api/upload', withThumb(form), true);
        }
      } catch (e) {
        console.error('水印合成失败，回退原图上传', e);
      }
    }

    var form = new FormData();
    form.append('file', displayFile);
    return api('POST', '/api/upload', withThumb(form), true);
  }

  // 若光标处于某个 ![...](...) / [...](...) 记号内部，返回该记号结束后的安全插入位置
  function safeInsertPos(value, pos) {
    function insideToken(openIdx, markerLen) {
      if (openIdx === -1) return -1;
      var close = value.indexOf(')', openIdx);
      // 记号未闭合时不调整（无法判定边界，维持原位）
      if (close === -1) return -1;
      if (pos > openIdx && pos <= close) return close + 1;
      return -1;
    }
    // 图片记号 ![...](...)
    var imgOpen = value.lastIndexOf('![', pos);
    var r = insideToken(imgOpen, 2);
    if (r !== -1) return r;
    // 普通链接 [...](...)（跳过属于图片的 '['）
    var linkOpen = value.lastIndexOf('[', pos);
    if (linkOpen > 0 && value.charAt(linkOpen - 1) === '!') linkOpen = -1;
    r = insideToken(linkOpen, 1);
    if (r !== -1) return r;
    return pos;
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
      // 光标落在已有图片/链接 Markdown 记号内部时，插入点移到该记号之后，避免破坏语法
      start = safeInsertPos(ta.value, start);
      end = Math.max(end, start);
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
          if (data.key) sessionUploads.push(data.key);
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
      if (data.key) sessionUploads.push(data.key);
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

  // 通用拖拽放置区绑定
  function bindDropZone(el, onFile) {
    if (!el) return;
    ['dragenter', 'dragover'].forEach(function (ev) {
      el.addEventListener(ev, function (e) {
        e.preventDefault();
        e.stopPropagation();
        el.classList.add('dragover');
      });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      el.addEventListener(ev, function (e) {
        e.preventDefault();
        e.stopPropagation();
        el.classList.remove('dragover');
      });
    });
    el.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files.length) onFile(e.dataTransfer.files[0]);
    });
  }

  // 三个上传区都支持拖拽：商品主图 / 网站图标 / 联系二维码
  bindDropZone($('#main-image-row'), uploadMainImage);
  bindDropZone($('#favicon-row'), function (file) {
    if (!file || !/^image\//.test(file.type)) return;
    uploadRaw(file).then(function (data) {
      faviconPending = data.url;
      updateFaviconPreview(data.url);
      toast('图标已上传，记得点「保存设置」生效');
    }).catch(function (err) { toast(err.message, true); });
  });
  bindDropZone($('#contact-qr-row'), function (file) {
    if (!file || !/^image\//.test(file.type)) return;
    uploadRaw(file).then(function (data) {
      contactQrPending = data.url;
      updateContactQrPreview(data.url);
      toast('二维码已上传，记得点「保存设置」生效');
    }).catch(function (err) { toast(err.message, true); });
  });

  $('#btn-remove-image').addEventListener('click', function () {
    $('#f-image-url').value = '';
    $('#f-image-file').value = '';
    updateImagePreview();
  });

  // ── 分类管理 ───────────────────────────
  var catKw = '';
  var catExpanded = new Set();

  $('#cat-kw').addEventListener('input', function () {
    catKw = this.value.trim().toLowerCase();
    renderCategoryList();
  });

  function renderCategoryList() {
    var box = $('#cat-list');
    box.textContent = '';

    var cats = state.categories;
    if (catKw) {
      cats = cats.filter(function (c) {
        return String(c.name || '').toLowerCase().indexOf(catKw) !== -1;
      });
    }

    if (!cats.length) {
      var empty = document.createElement('div');
      empty.className = 'loading';
      empty.textContent = catKw ? '没有匹配的分类' : '还没有分类';
      box.appendChild(empty);
      return;
    }

    cats.forEach(function (c) {
      var prods = state.products.filter(function (p) {
        return String(p.category_id) === String(c.id);
      });

      var wrap = document.createElement('div');
      wrap.className = 'cat-item';

      var row = document.createElement('div');
      row.className = 'crow';

      var main = document.createElement('div');
      main.className = 'crow-main';
      main.textContent = c.name + '（' + prods.length + ' 个商品）';
      row.appendChild(main);

      // 展开/收起
      var expBtn = document.createElement('button');
      expBtn.type = 'button';
      expBtn.className = 'btn btn-sm';
      expBtn.textContent = catExpanded.has(c.id) ? '▾ 收起' : '▸ 展开';
      expBtn.addEventListener('click', function () {
        if (catExpanded.has(c.id)) catExpanded.delete(c.id);
        else catExpanded.add(c.id);
        renderCategoryList();
      });
      row.appendChild(expBtn);

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
        if (!confirm('确定删除分类「' + c.name + '」吗？分类下的 ' + prods.length + ' 个商品会变为"未分类"，不会被删除。')) return;
        api('DELETE', '/api/categories/' + c.id)
          .then(function () { toast('已删除'); loadAll(); })
          .catch(function (err) { toast(err.message, true); });
      });
      row.appendChild(delBtn);

      wrap.appendChild(row);

      // 展开面板：类内商品清单，点击直接进编辑
      if (catExpanded.has(c.id)) {
        var panel = document.createElement('div');
        panel.className = 'cat-prod-panel';
        if (!prods.length) {
          var em = document.createElement('div');
          em.className = 'cat-prod-empty';
          em.textContent = '该分类下暂无商品';
          panel.appendChild(em);
        }
        prods.forEach(function (p) {
          var pr = document.createElement('button');
          pr.type = 'button';
          pr.className = 'cat-prod-row';
          var tags = [];
          if (p.price) tags.push(formatPrice(p.price));
          tags.push('浏览 ' + (p.views || 0));
          if (!p.visible) tags.push('已隐藏');
          if (p.sold_out) tags.push('缺货');
          pr.textContent = p.name + ' · ' + tags.join(' · ');
          pr.title = '编辑「' + p.name + '」';
          pr.addEventListener('click', function () { openProductModal(p); });
          panel.appendChild(pr);
        });
        wrap.appendChild(panel);
      }

      box.appendChild(wrap);
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
    $('#set-undo').checked = settings.undo_on !== '0';
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

  // 原图直传（图标/二维码等不加水印的图片）
  function uploadRaw(file) {
    var form = new FormData();
    form.append('file', file);
    return api('POST', '/api/upload', form, true);
  }

  function updateFaviconPreview(url) {
    $('#favicon-preview').src = url || '/favicon.svg';
  }

  $('#btn-favicon-upload').addEventListener('click', function () { $('#favicon-file').click(); });

  $('#favicon-file').addEventListener('change', function () {
    var file = this.files[0];
    this.value = '';
    if (!file || !/^image\//.test(file.type)) return;
    uploadRaw(file).then(function (data) {
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
    uploadRaw(file).then(function (data) {
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
      undo_on: $('#set-undo').checked ? '1' : '0',
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
      state.settings.undo_on = $('#set-undo').checked ? '1' : '0';
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


  // ── 图片管理：筛选 + 分组浏览 + 放大 + 原图下载 + 删除引用 ──
  var imgKw = '';
  var imgCat = 'all';

  function fileNameFromUrl(url) {
    var m = String(url || '').match(/images\/([A-Za-z0-9._-]+)$/);
    return m ? m[1] : null;
  }

  function escapeReg(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // 管理端灯箱
  function adminLightbox(src) {
    var lb = $('#admin-lb');
    $('#admin-lb-img').src = src;
    lb.hidden = false;
  }
  $('#admin-lb').addEventListener('click', function () { this.hidden = true; });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') $('#admin-lb').hidden = true;
  });

  // 删除引用：从商品主图/描述（或站点设置）移除；若无其他引用则连文件一起删
  function removeImageRef(it, product, field) {
    var key = it.key; // images/<name>
    var url = '/api/img/' + key;
    var msg = product
      ? '从「' + product.name + '」移除这张图片？\n若没有其他商品/设置在使用它，文件将一并删除。'
      : '移除站点' + (field === 'favicon_url' ? '图标' : '联系二维码') + '？\n若没有其他地方在使用它，文件将一并删除。';
    if (!confirm(msg)) return;

    var done = function () {
      // 服务端复核引用，无引用则删文件（含原图/缩略图）
      api('POST', '/api/images/orphans', { keys: [key] })
        .then(function (r) {
          toast(r.deleted > 0 ? '已移除引用并删除文件' : '已移除引用（文件仍被其他地方使用）');
          loadAll();
        })
        .catch(function (err) { toast(err.message, true); loadAll(); });
    };

    if (product) {
      var payload = {};
      if (product.image_url && fileNameFromUrl(product.image_url) === it.name) payload.image_url = '';
      var desc = String(product.description || '');
      var re = new RegExp('\\n*!\\[[^\\]]*\\]\\(' + escapeReg(url) + '\\)', 'g');
      var nd = desc.replace(re, '');
      if (nd !== desc) payload.description = nd;
      if (payload.image_url === undefined && payload.description === undefined) {
        toast('该图未在此商品中引用');
        return;
      }
      api('PUT', '/api/products/' + product.id, payload).then(done)
        .catch(function (err) { toast(err.message, true); });
    } else {
      var body = {};
      body[field] = '';
      // 设置 PUT 自带旧图回收逻辑（无引用时删文件），无需再调 orphans
      api('PUT', '/api/settings', body)
        .then(function () {
          toast('已移除并回收');
          loadAll();
        })
        .catch(function (err) { toast(err.message, true); });
    }
  }

  function fillImgCatSelect() {
    var sel = $('#img-cat');
    var cur = imgCat;
    sel.textContent = '';
    var optAll = document.createElement('option');
    optAll.value = 'all';
    optAll.textContent = '全部分类';
    sel.appendChild(optAll);
    state.categories.forEach(function (c) {
      var opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      sel.appendChild(opt);
    });
    sel.value = String(cur);
    if (sel.value !== String(cur)) { imgCat = 'all'; sel.value = 'all'; }
  }

  function renderImagesPane() {
    fillImgCatSelect();
    var box = $('#image-groups');
    box.textContent = '';

    var kw = imgKw.toLowerCase();
    var groups = [];
    state.products.forEach(function (p) {
      if (imgCat !== 'all' && String(p.category_id) !== String(imgCat)) return;
      if (kw && ((p.name || '') + '\n' + (p.description || '')).toLowerCase().indexOf(kw) === -1) return;

      var imgs = [];
      var seen = {};
      var push = function (url) {
        var name = fileNameFromUrl(url);
        if (!name || seen[name]) return;
        seen[name] = 1;
        imgs.push({ key: 'images/' + name, url: url, name: name });
      };
      push(p.image_url);
      var md = String(p.description || '').match(/!\[[^\]]*\]\([^)\s]+\)/g) || [];
      md.forEach(function (m2) {
        var u = m2.match(/\(([^)\s]+)\)$/);
        if (u) push(u[1]);
      });
      if (imgs.length) groups.push({ title: p.name, product: p, imgs: imgs });
    });

    // 站点图标 / 二维码组（仅在无筛选时显示）
    if (imgCat === 'all' && !imgKw) {
      var sImgs = [];
      var sSeen = {};
      [['favicon_url', state.settings.favicon_url], ['contact_img', state.settings.contact_img]].forEach(function (pair) {
        var name = fileNameFromUrl(pair[1]);
        if (name && !sSeen[name]) {
          sSeen[name] = 1;
          sImgs.push({ key: 'images/' + name, url: pair[1], name: name, field: pair[0] });
        }
      });
      if (sImgs.length) groups.push({ title: '站点图标 / 联系二维码', product: null, imgs: sImgs });
    }

    if (!groups.length) {
      var empty = document.createElement('div');
      empty.className = 'loading';
      empty.textContent = imgKw || imgCat !== 'all' ? '没有匹配的图片' : '还没有图片，去商品管理上传吧';
      box.appendChild(empty);
      return;
    }

    groups.forEach(function (g) {
      var head = document.createElement('div');
      head.className = 'img-group-title';
      head.textContent = g.title + '（' + g.imgs.length + ' 张）';
      box.appendChild(head);

      var grid = document.createElement('div');
      grid.className = 'orphan-grid img-mgr-grid';
      g.imgs.forEach(function (it) {
        var cell = document.createElement('div');
        cell.className = 'orphan-cell';

        // 缩略图（无则回退大图），点击放大
        var img = document.createElement('img');
        var full = new URL(it.url, location.href).href;
        img.src = full.replace(/\/images\/([^/?#]+)$/, '/thumb/$1');
        img.onerror = function () { if (img.getAttribute('src') !== full) img.src = full; };
        img.alt = it.name;
        img.loading = 'lazy';
        img.style.cursor = 'zoom-in';
        img.addEventListener('click', function (e) { e.stopPropagation(); adminLightbox(full); });
        cell.appendChild(img);

        var name = document.createElement('div');
        name.className = 'orphan-name';
        name.textContent = it.name;
        cell.appendChild(name);

        var ops = document.createElement('div');
        ops.className = 'img-cell-ops';

        var del = document.createElement('button');
        del.type = 'button';
        del.className = 'btn btn-sm btn-danger-ghost';
        del.textContent = '删除';
        del.addEventListener('click', function (e) { e.stopPropagation(); removeImageRef(it, g.product, it.field); });
        ops.appendChild(del);

        var dl = document.createElement('a');
        dl.className = 'btn btn-sm';
        dl.textContent = '下载原图';
        dl.href = '/api/orig/' + it.name;
        ops.appendChild(dl);

        cell.appendChild(ops);
        grid.appendChild(cell);
      });
      box.appendChild(grid);
    });
  }

  $('#img-kw').addEventListener('input', function () {
    imgKw = this.value.trim();
    renderImagesPane();
  });
  $('#img-cat').addEventListener('change', function () {
    imgCat = this.value;
    renderImagesPane();
  });

  function updateImgStats(r) {
    var el = $('#img-stats');
    if (!el) return;
    var mb = function (b) { return b == null ? '' : (b / 1048576).toFixed(1) + 'MB'; };
    el.textContent = '展示图 ' + r.images_total + ' 张·' + mb(r.images_bytes) + '（被引用 ' + r.referenced + '）· '
      + '原图 ' + (r.orig_total != null ? r.orig_total : '—') + ' 张·' + mb(r.orig_bytes)
      + ' · 缩略图·' + mb(r.thumb_bytes)
      + ' · 未引用 ' + r.orphan_images_total + ' 张'
      + (r.legacy_note ? '；' + r.legacy_note : '');
  }

  // ── 孤儿图片扫描与清理（缩略图列表 + 单删/全删）──
  var orphanItems = []; // [{key, url, name}]
  var legacyOrphanKeys = []; // 旧格式残留原图 key
  var lastScanCleanText = '';
  var lastLegacyNote = '';

  function renderOrphanGrid() {
    var grid = $('#orphan-grid');
    grid.textContent = '';
    orphanItems.forEach(function (it) {
      var cell = document.createElement('div');
      cell.className = 'orphan-cell' + (it.selected ? ' selected' : '');

      var check = document.createElement('input');
      check.type = 'checkbox';
      check.className = 'orphan-check';
      check.checked = !!it.selected;
      check.addEventListener('click', function (e) { e.stopPropagation(); });
      check.addEventListener('change', function () {
        it.selected = check.checked;
        cell.classList.toggle('selected', it.selected);
        updateOrphanButtons();
      });
      cell.appendChild(check);

      var img = document.createElement('img');
      img.src = it.url;
      img.alt = it.name;
      img.loading = 'lazy';
      cell.appendChild(img);

      var name = document.createElement('div');
      name.className = 'orphan-name';
      name.textContent = it.name;
      cell.appendChild(name);

      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn btn-sm btn-danger-ghost';
      del.textContent = '删除';
      del.addEventListener('click', function (e) {
        e.stopPropagation();
        if (!confirm('删除这张未引用图片？\n' + it.key)) return;
        api('DELETE', '/api/images/orphans', { keys: [it.key, it.key.replace(/^images\//, 'orig/')] })
          .then(function () {
            orphanItems = orphanItems.filter(function (x) { return x.key !== it.key; });
            cell.remove();
            updateOrphanSummary();
            updateOrphanButtons();
            toast('已删除');
          })
          .catch(function (err) { toast(err.message, true); });
      });
      cell.appendChild(del);

      // 点卡片任意处切换选中（按钮/复选框除外）
      cell.addEventListener('click', function () {
        it.selected = !it.selected;
        check.checked = it.selected;
        cell.classList.toggle('selected', it.selected);
        updateOrphanButtons();
      });

      grid.appendChild(cell);
    });
    updateOrphanButtons();
  }

  function updateOrphanButtons() {
    var selCount = orphanItems.filter(function (x) { return x.selected; }).length;
    var has = orphanItems.length > 0;
    $('#btn-orphan-selall').hidden = !has;
    $('#btn-orphan-delsel').hidden = !has;
    $('#btn-orphan-delsel').textContent = '删除选中 (' + selCount + ')';
    $('#btn-orphan-selall').textContent = selCount === orphanItems.length && has ? '全不选' : '全选';
  }

  $('#btn-orphan-selall').addEventListener('click', function () {
    var target = !orphanItems.every(function (x) { return x.selected; });
    orphanItems.forEach(function (x) { x.selected = target; });
    renderOrphanGrid();
  });

  $('#btn-orphan-delsel').addEventListener('click', function () {
    var sel = orphanItems.filter(function (x) { return x.selected; });
    if (!sel.length) { toast('先点选要删除的图片'); return; }
    if (!confirm('删除选中的 ' + sel.length + ' 张未引用图片？此操作不可恢复。')) return;
    var keys = [];
    sel.forEach(function (it) {
      keys.push(it.key);
      keys.push(it.key.replace(/^images\//, 'orig/'));
    });
    api('DELETE', '/api/images/orphans', { keys: keys }).then(function (r) {
      orphanItems = orphanItems.filter(function (x) { return !x.selected; });
      renderOrphanGrid();
      updateOrphanSummary();
      toast('已删除 ' + r.deleted + ' 个文件');
    }).catch(function (err) { toast(err.message, true); });
  });

  function renderLegacyList() {
    var box = $('#orphan-legacy-list');
    box.textContent = '';
    legacyOrphanKeys.forEach(function (key) {
      var row = document.createElement('div');
      row.className = 'orphan-legacy-row';
      var tag = document.createElement('span');
      tag.textContent = '原图';
      var k = document.createElement('span');
      k.className = 'key';
      k.textContent = key;
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn btn-sm btn-danger-ghost';
      del.textContent = '删除';
      del.addEventListener('click', function () {
        if (!confirm('删除这个旧格式原图？\n' + key)) return;
        api('DELETE', '/api/images/orphans', { keys: [key] }).then(function () {
          legacyOrphanKeys = legacyOrphanKeys.filter(function (x) { return x !== key; });
          row.remove();
          updateOrphanSummary();
          toast('已删除');
        }).catch(function (err) { toast(err.message, true); });
      });
      row.appendChild(tag); row.appendChild(k); row.appendChild(del);
      box.appendChild(row);
    });
  }

  function updateOrphanSummary() {
    var out = $('#orphans-result');
    $('#btn-clean-orphans').hidden = orphanItems.length === 0;
    updateOrphanButtons();
    if (!orphanItems.length) {
      out.textContent = lastScanCleanText || '✓ 没有未引用的展示图';
      return;
    }
    out.textContent = '未引用展示图 ' + orphanItems.length + ' 张（删除时同名原图一并清理）'
      + (legacyOrphanKeys.length ? '；旧格式残留原图 ' + legacyOrphanKeys.length + ' 个' : '')
      + (lastLegacyNote ? '；' + lastLegacyNote : '');
  }

  $('#btn-scan-orphans').addEventListener('click', function () {
    var out = $('#orphans-result');
    out.textContent = '扫描中..';
    $('#btn-clean-orphans').hidden = true;
    api('GET', '/api/images/orphans').then(function (r) {
      orphanItems = (r.orphan_images || []).map(function (key) {
        return { key: key, url: '/api/img/' + key, name: key.slice('images/'.length), selected: false };
      });
      lastScanCleanText = '展示图 ' + r.images_total + ' 张，被引用 ' + r.referenced + ' 张；✓ 没有未引用的展示图';
      lastLegacyNote = r.legacy_note || '';
      legacyOrphanKeys = (r.legacy_orphan_origs || []).slice();
      renderOrphanGrid();
      renderLegacyList();
      updateOrphanSummary();
      updateImgStats(r);
    }).catch(function (err) { out.textContent = '扫描失败：' + err.message; });
  });

  $('#btn-clean-orphans').addEventListener('click', function () {
    if (!orphanItems.length) return;
    if (!confirm('确定清理全部 ' + orphanItems.length + ' 张未引用图片吗？此操作不可恢复（在售/隐藏商品的图片不受影响）。')) return;
    var out = $('#orphans-result');
    out.textContent = '清理中..';
    var keys = [];
    orphanItems.forEach(function (it) {
      keys.push(it.key);
      keys.push(it.key.replace(/^images\//, 'orig/'));
    });
    keys = keys.concat(legacyOrphanKeys);
    api('DELETE', '/api/images/orphans', { keys: keys }).then(function (r) {
      orphanItems = [];
      legacyOrphanKeys = [];
      renderOrphanGrid();
      renderLegacyList();
      out.textContent = '已清理 ' + r.deleted + ' 个文件';
      $('#btn-clean-orphans').hidden = true;
    }).catch(function (err) { out.textContent = '清理失败：' + err.message; });
  });


  bindBatchUI();

  // ── 启动：探测会话 ─────────────────────
  fetch('/api/login', { method: 'GET' })
    .then(function (res) { res.ok ? showAdmin() : showLogin(); })
    .catch(showLogin);
})();
