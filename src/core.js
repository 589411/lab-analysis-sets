// 核心框架：圖鑑牆、套餐頁（資料→欄位→參數→結果）、畫圖工具。套餐本身寫在 src/sets/*.js。
(function () {
  'use strict';
  var ML = window.ML;
  function h(tag, attrs) {
    var e = document.createElement(tag), k;
    attrs = attrs || {};
    for (k in attrs) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (var i = 2; i < arguments.length; i++) add(e, arguments[i]);
    return e;
  }
  function add(e, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { add(e, x); }); return; }
    e.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  }

  var U = {
    num: function (v) {
      if (typeof v === 'number') return v;
      if (v == null) return NaN;
      var s = String(v).trim().replace(/[,，$＄\s]/g, '').replace(/^NT/i, '');
      if (s === '') return NaN;
      var pct = /%$/.test(s); if (pct) s = s.slice(0, -1);
      var n = Number(s);
      return isFinite(n) ? n : NaN;
    },
    // 數字顯示：大數加千分位，小數自動取位
    fmt: function (n, d) {
      if (n == null || !isFinite(n)) return '—';
      var a = Math.abs(n);
      if (d == null) d = a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : 3;
      return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: d });
    },
    pct: function (p, d) { return isFinite(p) ? (p * 100).toFixed(d == null ? 1 : d) + '%' : '—'; },
    ease: function (t) { t = Math.max(0, Math.min(1, t)); return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
    clamp: function (v, a, b) { return Math.max(a, Math.min(b, v)); },
    // 把動畫進度 t 切成一段：seg(t, 0.2, 0.6) 在 0.2 之前是 0、0.6 之後是 1
    seg: function (t, a, b) { return U.clamp((t - a) / (b - a), 0, 1); },
    extent: function (a, padRatio) {
      var lo = Infinity, hi = -Infinity;
      for (var i = 0; i < a.length; i++) { if (a[i] < lo) lo = a[i]; if (a[i] > hi) hi = a[i]; }
      if (lo === hi) { lo -= 1; hi += 1; }
      var p = (hi - lo) * (padRatio == null ? .06 : padRatio);
      return [lo - p, hi + p];
    },
    ticks: function (lo, hi, n) {
      var span = hi - lo, step = Math.pow(10, Math.floor(Math.log10(span / (n || 5)))), err = span / (n || 5) / step;
      if (err >= 7.5) step *= 10; else if (err >= 3.5) step *= 5; else if (err >= 1.5) step *= 2;
      var out = [], v = Math.ceil(lo / step) * step;
      for (; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
      return out;
    },
    short: function (v) {
      var a = Math.abs(v);
      if (a >= 1e8) return +(v / 1e8).toFixed(1) + '億';
      if (a >= 1e4) return +(v / 1e4).toFixed(1) + '萬';
      return String(+v.toFixed(a < 10 ? 2 : 0));
    },
    parseCSV: function (text) {
      text = (text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text).replace(/\r\n?/g, '\n');
      var first = text.split('\n')[0] || '';
      var delim = (first.split('\t').length > first.split(',').length) ? '\t' : ',';
      var rows = [], row = [], cur = '', q = false, i, c;
      for (i = 0; i < text.length; i++) {
        c = text[i];
        if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
        else if (c === '"') q = true;
        else if (c === delim) { row.push(cur); cur = ''; }
        else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
        else cur += c;
      }
      if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
      rows = rows.filter(function (r) { return r.some(function (v) { return String(v).trim() !== ''; }); });
      if (rows.length < 2) throw new Error('讀不到資料。第一列要是欄位名稱，第二列起是資料。');
      return U.fromAOA(rows);
    },
    // 二維陣列（第一列是欄名）→ {cols, rows}
    fromAOA: function (rows) {
      rows = rows.filter(function (r) { return r.some(function (v) { return String(v == null ? '' : v).trim() !== ''; }); });
      if (rows.length < 2) throw new Error('讀不到資料。第一列要是欄位名稱，第二列起是資料。');
      var seen = {};
      var cols = rows[0].map(function (s, j) { s = String(s == null ? '' : s).trim() || ('欄' + (j + 1)); while (seen[s]) s += '_2'; seen[s] = 1; return s; });
      return { cols: cols, rows: rows.slice(1).map(function (r) { var o = {}; cols.forEach(function (cn, j) { o[cn] = r[j] == null ? '' : String(r[j]).trim(); }); return o; }) };
    },
    loadScript: function (src) {
      return new Promise(function (ok, bad) { var e = document.createElement('script'); e.src = src; e.onload = ok; e.onerror = function () { bad(new Error('load')); }; document.head.appendChild(e); });
    }
  };

  var App = window.App = { sets: [], U: U, h: h };
  App.cats = [
    { id: 'regress', zh: '什麼會影響結果', sub: '回歸' },
    { id: 'cluster', zh: '我的顧客是誰', sub: '分群' },
    { id: 'classify', zh: '誰會、誰不會', sub: '分類' },
    { id: 'forecast', zh: '接下來會是多少', sub: '預測' }
  ];
  App.colors = ['#2f6fe0', '#e07a2b', '#17976a', '#b8419a', '#7a5cd6', '#c2982a', '#3d9db3', '#8a9099'];
  App.register = function (set) { App.sets.push(set); };
  var themeCache = null;
  App.theme = function () {
    if (themeCache) return themeCache;
    var cs = getComputedStyle(document.documentElement), g = function (n) { return cs.getPropertyValue(n).trim(); };
    themeCache = { bg: g('--bg'), card: g('--card'), ink: g('--ink'), muted: g('--muted'), line: g('--line'), accent: g('--accent'), soft: g('--accent-soft'), good: g('--good'), warn: g('--warn'), bad: g('--bad'), thumb: g('--thumb') };
    return themeCache;
  };
  function resetTheme() { themeCache = null; if (App._redraw) App._redraw(); }
  if (window.matchMedia) { try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', resetTheme); } catch (e) { } }
  new MutationObserver(resetTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 畫圖工具：先給資料範圍，回傳座標換算與常用圖形
  App.plot = function (g, w, h_, o) {
    o = o || {};
    var T = App.theme(), small = !!o.bare;
    var pad = o.pad || (small ? { l: 6, r: 6, t: 6, b: 6 } : { l: 52, r: 14, t: o.ylabel ? 24 : 12, b: o.xlabel ? 40 : 26 });
    var P = { x0: pad.l, x1: w - pad.r, y0: h_ - pad.b, y1: pad.t, xmin: o.xmin, xmax: o.xmax, ymin: o.ymin, ymax: o.ymax };
    P.sx = function (v) { return P.x0 + (v - P.xmin) / (P.xmax - P.xmin) * (P.x1 - P.x0); };
    P.sy = function (v) { return P.y0 - (v - P.ymin) / (P.ymax - P.ymin) * (P.y0 - P.y1); };
    P.ix = function (px) { return P.xmin + (px - P.x0) / (P.x1 - P.x0) * (P.xmax - P.xmin); };
    P.iy = function (py) { return P.ymin + (P.y0 - py) / (P.y0 - P.y1) * (P.ymax - P.ymin); };
    P.axes = function () {
      g.save(); g.font = '11px ' + 'system-ui, sans-serif'; g.lineWidth = 1;
      var yt = U.ticks(P.ymin, P.ymax, 5), xt = o.xcats ? [] : U.ticks(P.xmin, P.xmax, Math.max(3, Math.floor(w / 110)));
      g.strokeStyle = T.line; g.fillStyle = T.muted;
      g.textAlign = 'right'; g.textBaseline = 'middle';
      yt.forEach(function (v) { var y = P.sy(v); g.beginPath(); g.moveTo(P.x0, y); g.lineTo(P.x1, y); g.stroke(); g.fillText(o.yfmt ? o.yfmt(v) : U.short(v), P.x0 - 6, y); });
      g.textAlign = 'center'; g.textBaseline = 'top';
      xt.forEach(function (v) { g.fillText(o.xfmt ? o.xfmt(v) : U.short(v), P.sx(v), P.y0 + 5); });
      if (o.xcats) {
        var maxLen = Math.max.apply(null, o.xcats.map(function (c) { return String(c).length; }));
        var step = Math.ceil(o.xcats.length / Math.max(2, Math.floor((P.x1 - P.x0) / (maxLen * 7 + 14))));
        o.xcats.forEach(function (c, i) { if (i % step === 0) g.fillText(c, P.sx(i), P.y0 + 5); });
      }
      g.strokeStyle = T.muted; g.beginPath(); g.moveTo(P.x0, P.y1); g.lineTo(P.x0, P.y0); g.lineTo(P.x1, P.y0); g.stroke();
      g.fillStyle = T.ink; g.font = '12px system-ui, sans-serif';
      if (o.xlabel) { g.textAlign = 'center'; g.textBaseline = 'bottom'; g.fillText(o.xlabel, (P.x0 + P.x1) / 2, h_ - 4); }
      if (o.ylabel) { g.textAlign = 'left'; g.textBaseline = 'top'; g.fillText(o.ylabel, 4, 0); }
      g.restore();
    };
    P.dots = function (xs, ys, s) {
      s = s || {}; g.save(); g.globalAlpha = s.alpha == null ? .75 : s.alpha;
      for (var i = 0; i < xs.length; i++) {
        g.fillStyle = typeof s.color === 'function' ? s.color(i) : (s.color || App.colors[0]);
        g.beginPath(); g.arc(P.sx(xs[i]), P.sy(ys[i]), typeof s.r === 'function' ? s.r(i) : (s.r || 3.2), 0, 6.2832); g.fill();
      }
      g.restore();
    };
    // frac：只畫前面這個比例（做「線慢慢畫出來」的動畫）
    P.line = function (xs, ys, s) {
      s = s || {}; var n = xs.length, m = Math.max(2, Math.round(n * (s.frac == null ? 1 : s.frac)));
      if (n < 2 || (s.frac != null && s.frac <= 0)) return;
      g.save(); g.strokeStyle = s.color || App.colors[0]; g.lineWidth = s.width || 2; g.lineJoin = 'round';
      if (s.dash) g.setLineDash(s.dash);
      if (s.alpha != null) g.globalAlpha = s.alpha;
      g.beginPath();
      for (var i = 0; i < Math.min(n, m); i++) { var x = P.sx(xs[i]), y = P.sy(ys[i]); if (i) g.lineTo(x, y); else g.moveTo(x, y); }
      g.stroke(); g.restore();
    };
    P.vline = function (x, s) { s = s || {}; g.save(); g.strokeStyle = s.color || T.muted; g.lineWidth = s.width || 1; g.setLineDash(s.dash || [4, 4]); g.beginPath(); g.moveTo(P.sx(x), P.y0); g.lineTo(P.sx(x), P.y1); g.stroke(); g.restore(); };
    P.hline = function (y, s) { s = s || {}; g.save(); g.strokeStyle = s.color || T.muted; g.lineWidth = s.width || 1; g.setLineDash(s.dash || [4, 4]); g.beginPath(); g.moveTo(P.x0, P.sy(y)); g.lineTo(P.x1, P.sy(y)); g.stroke(); g.restore(); };
    P.text = function (x, y, str, s) { s = s || {}; g.save(); g.fillStyle = s.color || T.ink; g.font = (s.bold ? '700 ' : '') + (s.size || 12) + 'px system-ui, sans-serif'; g.textAlign = s.align || 'left'; g.textBaseline = s.base || 'middle'; g.fillText(str, P.sx(x) + (s.dx || 0), P.sy(y) + (s.dy || 0)); g.restore(); };
    // 圖例：items = [{label,color,dash?}]，畫在圖內右上角
    P.legend = function (items) {
      g.save(); g.font = '11.5px system-ui, sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'left';
      var x = P.x1 - 6, y = P.y1 + 8;
      items.forEach(function (it, i) {
        var tw = g.measureText(it.label).width, yy = y + i * 16, xx = x - tw;
        g.fillStyle = T.card; g.globalAlpha = .8; g.fillRect(xx - 20, yy - 8, tw + 24, 16); g.globalAlpha = 1;
        g.fillStyle = it.color; g.strokeStyle = it.color; g.lineWidth = 2;
        if (it.line) { g.setLineDash(it.dash || []); g.beginPath(); g.moveTo(xx - 18, yy); g.lineTo(xx - 5, yy); g.stroke(); g.setLineDash([]); }
        else { g.beginPath(); g.arc(xx - 11, yy, 4, 0, 6.2832); g.fill(); }
        g.fillStyle = T.ink; g.fillText(it.label, xx, yy);
      });
      g.restore();
    };
    return P;
  };

  function fitCanvas(cv, ratio) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2), w = cv.clientWidth || 300, hh = Math.round(w * ratio);
    cv.style.height = hh + 'px';
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hh * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr); }
    var g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, hh);
    return { g: g, w: w, h: hh };
  }

  // ---------- 圖鑑牆 ----------
  var root, raf = 0, thumbs = [];
  function wall() {
    cancelAnimationFrame(raf); thumbs = []; App._redraw = null;
    document.title = '數據分析套餐圖鑑';
    root.innerHTML = '';
    var n = App.sets.length;
    add(root, [
      h('h1', { html: '<b>' + n + '</b> 個經營問題，選一個放進你的資料' }),
      h('p', { class: 'lede' }, '先選你想回答的問題，不用先懂方法。每個套餐已經把「清資料 → 建模型 → 檢查 → 白話結論」配好，選一個、放進你的表格就能看結果。'),
      h('span', { class: 'proto' }, '教學原型：上線前需另行驗證')
    ]);
    App.cats.forEach(function (c, ci) {
      // 區內順序：起手的排最前，進階的排最後，其餘維持註冊順序
      function rank(s) { return s.starter ? 0 : s.advanced ? 2 : 1; }
      var list = App.sets.filter(function (s) { return s.cat === c.id; })
        .map(function (s, i) { return { s: s, i: i }; })
        .sort(function (a, b) { return rank(a.s) - rank(b.s) || a.i - b.i; })
        .map(function (o) { return o.s; });
      if (!list.length) return;
      var grid = h('div', { class: 'grid' });
      list.forEach(function (s) {
        var cv = h('canvas', { 'aria-hidden': 'true' });
        thumbs.push({ cv: cv, set: s });
        var tags = [];
        if (s.starter) tags.push(h('span', { class: 'tag tag-start' }, '先從這個開始'));
        if (s.advanced) tags.push(h('span', { class: 'tag tag-adv' }, '進階'));
        add(grid, h('a', { class: 'cardlink', href: '#' + s.id },
          h('div', { class: 'thumb' }, cv, tags),
          h('div', { class: 'ask' }, s.ask || s.zh),
          h('div', { class: 'nm' }, s.zh + ' · ' + s.en),
          h('div', { class: 'bl' }, s.blurb)));
      });
      add(root, h('section', { class: 'sec' },
        h('h2', { class: 'sec-h' }, h('span', { class: 'no' }, ci + 1), c.zh, h('small', {}, c.sub)), grid));
    });
    add(root, h('footer', {}, '示範資料全部是模擬的，不是任何真實店家的數字。你上傳或貼上的資料只在這台裝置的瀏覽器裡計算，不會送到任何伺服器。'));
    var t0 = performance.now();
    function frame(now) {
      var t = reduced ? .72 : ((now - t0) % 5000) / 5000;
      thumbs.forEach(function (th) {
        var r = th.cv.getBoundingClientRect();
        if (r.bottom < 0 || r.top > innerHeight) return;
        var c = fitCanvas(th.cv, 9 / 16);
        try { th.set.thumb(c.g, c.w, c.h, t); } catch (e) { }
      });
      if (!reduced) raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    App._redraw = function () { if (reduced) requestAnimationFrame(frame); };
    window.scrollTo(0, 0);
  }

  // ---------- 套餐頁 ----------
  function colKinds(table) {
    var k = {};
    table.cols.forEach(function (c) {
      var vals = table.rows.map(function (r) { return r[c]; }).filter(function (v) { return String(v).trim() !== ''; });
      var nums = vals.filter(function (v) { return !isNaN(U.num(v)); }).length;
      var uniq = {}; vals.forEach(function (v) { uniq[v] = 1; });
      var nu = Object.keys(uniq).length;
      k[c] = { num: vals.length > 0 && nums / vals.length >= .8, uniq: nu, idLike: nu === vals.length && /編號|代號|id|序/i.test(c) };
    });
    return k;
  }
  function dateLike(table, c) {
    var vals = table.rows.map(function (r) { return String(r[c]).trim(); }).filter(function (v) { return v !== ''; });
    if (!vals.length) return false;
    var k = vals.filter(function (v) { return /\d{2,4}\s*[-\/.年]\s*\d{1,2}/.test(v); }).length;
    return k / vals.length >= .8;
  }
  // 回傳這個角色（單選或複選）的欄位名稱陣列
  function roleCols(set, st, r) { return r.multi ? st.roles[r.key] : [st.roles[r.key]]; }
  function binWarn(c) { return '這一欄是系統猜的。請確認「' + c + '」真的是你想預測的結果，而且它的值是事後才知道的。'; }
  // 複選欄位選太少：分清楚是「這份表數字欄根本不夠」還是「只是沒勾」
  function multiMsg(set, st, r) {
    var kinds = colKinds(st.table), M = r.min || 1;
    var numAll = st.table.cols.filter(function (c) { return kinds[c].num && !kinds[c].idLike; });
    if (!numAll.length) return '這份資料沒有數字欄，這個套餐無法使用它。';
    var others = {};
    set.roles.forEach(function (o) { if (o !== r) roleCols(set, st, o).forEach(function (c) { others[c] = 1; }); });
    var resultNum = set.roles.filter(function (o) { return o !== r && o.type === 'num' && !o.multi; }).length;
    var avail = numAll.filter(function (c) { return !others[c]; });
    if (avail.length < M + resultNum) {
      return resultNum ? '這份資料只有 ' + numAll.length + ' 個數字欄，這個套餐需要至少 ' + M + ' 個原因欄再加 1 個結果欄。'
        : '這份資料只有 ' + numAll.length + ' 個數字欄，這個套餐至少需要 ' + M + ' 個數字欄。';
    }
    return '「' + r.label + '」至少要選 ' + M + ' 個欄位。';
  }
  function guessRoles(set, table, isDemo) {
    var kinds = colKinds(table), used = {}, out = {};
    var numCols = table.cols.filter(function (c) { return kinds[c].num && !kinds[c].idLike; });
    // 先放目標欄位（單選），再放其餘
    var order = set.roles.slice().sort(function (a, b) { return (a.multi ? 1 : 0) - (b.multi ? 1 : 0); });
    order.forEach(function (r) {
      var g = (r.guess || []).filter(function (c) { return table.cols.indexOf(c) >= 0; });
      if (g.length && (isDemo || !r.multi || g.length >= (r.min || 1))) { out[r.key] = r.multi ? g : g[0]; g.forEach(function (c) { used[c] = 1; }); return; }
      var pool;
      if (r.type === 'label') {
        pool = table.cols.filter(function (c) { return !kinds[c].num; }).concat(table.cols);
        // 時間欄：長得像日期的欄位排前面（例如 review_date 會排在 review_id 前面）
        if (r.unique) pool = pool.filter(function (c) { return dateLike(table, c); }).concat(pool.filter(function (c) { return !dateLike(table, c); }));
      }
      else if (r.type === 'bin') pool = table.cols.filter(function (c) { return kinds[c].uniq === 2; }).reverse();
      else pool = (r.prefer === 'last' ? numCols.slice().reverse() : numCols);
      pool = pool.filter(function (c) { return !used[c]; });
      if (r.multi) { var pick = pool.slice(0, r.max || 3); out[r.key] = pick; pick.forEach(function (c) { used[c] = 1; }); }
      else { out[r.key] = pool[0] || table.cols[0]; used[out[r.key]] = 1; }
    });
    return out;
  }
  function prepare(set, st) {
    var table = st.table, labels = {}, excluded = 0, rows = [], status = [];
    var bins = {};
    set.roles.forEach(function (r) {
      if (r.type !== 'bin') return;
      var c = st.roles[r.key], uniq = {};
      table.rows.forEach(function (row) { var v = String(row[c]).trim(); if (v !== '') uniq[v] = 1; });
      var keys = Object.keys(uniq).sort(function (a, b) { var x = U.num(a), y = U.num(b); return (isNaN(x) || isNaN(y)) ? (a < b ? -1 : 1) : x - y; });
      if (keys.length !== 2) throw new Error('「' + r.label + '」需要剛好兩種值（例如 0/1、有/沒有）。欄位「' + c + '」目前有 ' + keys.length + ' 種值。');
      bins[c] = keys; labels[r.key] = keys;
    });
    table.rows.forEach(function (row) {
      var o = {}, ok = true;
      set.roles.forEach(function (r) {
        var names = r.multi ? st.roles[r.key] : [st.roles[r.key]];
        names.forEach(function (c) {
          var raw = row[c];
          if (r.type === 'label') { o[c] = String(raw); if (String(raw).trim() === '') ok = false; }
          else if (r.type === 'bin') { var s = String(raw).trim(); if (s === '') ok = false; else o[c] = bins[c].indexOf(s); }
          else { var v = U.num(raw); if (isNaN(v)) ok = false; o[c] = v; }
        });
      });
      status.push(ok); if (ok) rows.push(o); else excluded++;
    });
    // 時間欄不可重複：一期一列
    set.roles.forEach(function (r) {
      if (!r.unique) return;
      var c = st.roles[r.key], cnt = {}, best = '', bestN = 0;
      rows.forEach(function (o) { var v = String(o[c]).trim(); cnt[v] = (cnt[v] || 0) + 1; if (cnt[v] > bestN) { bestN = cnt[v]; best = v; } });
      if (bestN > 1) throw new Error('時間欄「' + c + '」有重複的值（例如「' + best + '」出現 ' + bestN + ' 次），這份資料看起來不是一期一列。如果它是交易明細，請在上面的資料準備選「是交易明細，幫我彙總」。');
    });
    // 納入的列裡，數字欄要有變化，二元欄要有兩種值
    set.roles.forEach(function (r) {
      if (r.type !== 'num' && r.type !== 'bin') return;
      roleCols(set, { roles: st.roles }, r).forEach(function (c) {
        if (!rows.length) return;
        var lo = Infinity, hi = -Infinity;
        rows.forEach(function (o) { var v = o[c]; if (v < lo) lo = v; if (v > hi) hi = v; });
        if (lo !== hi) return;
        if (r.type === 'num') throw new Error('欄位「' + c + '」的值全部一樣（都是 ' + U.fmt(lo) + '），沒有變化就沒有東西可以分析。請換一個欄位。');
        throw new Error('欄位「' + c + '」在納入的列中只剩一種值（都是「' + bins[c][lo] + '」），沒有兩種結果就無法預測。請換一個欄位。');
      });
    });
    return { rows: rows, labels: labels, excluded: excluded, status: status };
  }

  function page(set) {
    cancelAnimationFrame(raf); thumbs = [];
    document.title = (set.ask || set.zh) + '｜數據分析套餐圖鑑';
    var demo = window.DEMO[set.demo];
    var st = { src: 'demo', table: demo, roles: guessRoles(set, demo, true), params: {} };
    (set.params || []).forEach(function (p) { st.params[p.key] = p.value; });
    var res = h('div', {}), dataBox = h('div', {}), roleBox = h('div', {}), paramBox = h('div', {});
    var animStart = 0, last = null, timer = 0;

    var prepBox = h('div', {}), hintP = h('p', { class: 'hint' });
    function setHint() { hintP.textContent = '目前分析用的表：' + (st.table.name || '') + '，' + st.table.rows.length + ' 列 × ' + st.table.cols.length + ' 欄'; }
    function useTable(t, src) { st.table = t; st.src = src; st.roles = guessRoles(set, t, src === 'demo'); setHint(); drawRoles(); run(true); }
    // 使用者的原始表進來：需要彙總的套餐先交給「資料準備」，其餘直接用
    // 資料準備還交不出表（欄位沒選齊、轉換失敗）：清掉舊的表、欄位與結果，避免上一份資料的結論留在畫面上
    function notReady(e) {
      st.table = { name: '', cols: [], rows: [] }; st.src = 'user'; st.roles = {};
      hintP.textContent = '目前沒有可分析的表。請先完成上面的資料準備。';
      roleBox.innerHTML = ''; add(roleBox, h('p', { class: 'hint' }, '資料準備完成後，這裡會列出欄位。'));
      showErr(e);
    }
    function offerRaw(raw) {
      prepBox.innerHTML = '';
      if (App.prep && set.needs && set.needs !== 'wide') {
        try { App.prep.mount(prepBox, { set: set, raw: raw, onTable: function (t) { useTable(t, 'user'); }, onError: notReady }); } catch (e) { showErr(e); }
      } else useTable(raw, 'user');
    }
    function readFile(f) {
      var isX = /\.xlsx?$/i.test(f.name);
      f.arrayBuffer().then(function (buf) {
        if (isX) {
          var go = function () { var wb = window.XLSX.read(buf, { type: 'array' }), ws = wb.Sheets[wb.SheetNames[0]]; var t = U.fromAOA(window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' })); t.name = f.name + '（第一張工作表）'; offerRaw(t); };
          return (window.XLSX ? Promise.resolve() : U.loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js')).then(go, function () { throw new Error('讀 Excel 需要連網下載一個元件，這台裝置現在載不到。請把檔案另存成 CSV，或改用「貼上」。'); });
        }
        var txt = new TextDecoder('utf-8').decode(buf);
        if (txt.indexOf(String.fromCharCode(0xFFFD)) >= 0) { try { txt = new TextDecoder('big5').decode(buf); } catch (e) { } }
        var t = U.parseCSV(txt); t.name = f.name; offerRaw(t);
      }).catch(showErr);
    }
    function drawData() {
      dataBox.innerHTML = '';
      var mode = st.mode || 'demo', modes = [['demo', '示範資料']];
      if (window.DEMO.txn && App.prep && set.needs && set.needs !== 'wide') modes.push(['demotxn', '示範明細']);
      modes.push(['file', '上傳檔案'], ['paste', '貼上']);
      add(dataBox, h('div', { class: 'seg', role: 'group', 'aria-label': '資料來源' }, modes.map(function (x) {
        return h('button', { type: 'button', 'aria-pressed': String(mode === x[0]), onclick: function () {
          st.mode = x[0]; drawData();
          if (x[0] === 'demo') useTable(demo, 'demo'); else if (x[0] === 'demotxn') offerRaw(window.DEMO.txn);
        } }, x[1]);
      })));
      prepBox.innerHTML = '';
      if (mode === 'file') {
        add(dataBox, h('div', { class: 'field' }, h('input', { type: 'file', id: 'f-file', accept: '.csv,.tsv,.txt,.xlsx,.xls', 'aria-label': '選擇檔案', onchange: function (ev) { if (ev.target.files[0]) readFile(ev.target.files[0]); } }),
          h('div', { class: 'tip' }, '支援 CSV（UTF-8 或 Big5）與 Excel。讀 Excel 會連網下載一個讀檔元件，檔案內容不會上傳。')));
      } else if (mode === 'paste') {
        var ta = h('textarea', { id: 'f-paste', 'aria-label': '貼上表格', placeholder: '從 Excel 或 Google 試算表選取範圍（含標題列）複製，貼在這裡' });
        add(dataBox, h('div', { class: 'field' }, ta, h('button', { class: 'btn', type: 'button', style: 'margin-top:6px', onclick: function () {
          try { var t = U.parseCSV(ta.value); t.name = '貼上的資料'; offerRaw(t); } catch (e) { showErr(e); }
        } }, '使用這份資料')));
      } else if (mode === 'demotxn') {
        add(dataBox, h('p', { class: 'hint' }, '這是一份模擬的交易明細（一列一筆交易），用來示範怎麼把明細整理成這個套餐需要的表。'));
      }
      add(dataBox, [prepBox, hintP]); setHint();
    }
    function drawRoles() {
      roleBox.innerHTML = '';
      set.roles.forEach(function (r) {
        var f = h('div', { class: 'field' }), id = 'role-' + r.key;
        if (r.multi) {
          add(f, h('div', { class: 'lb' }, r.label));
          add(f, h('div', { class: 'checks' }, st.table.cols.map(function (c, i) {
            return h('label', {}, h('input', { type: 'checkbox', id: id + '-' + i, checked: st.roles[r.key].indexOf(c) >= 0, onchange: function (ev) {
              var cur = st.roles[r.key].filter(function (x) { return x !== c; });
              if (ev.target.checked) cur.push(c);
              st.roles[r.key] = st.table.cols.filter(function (x) { return cur.indexOf(x) >= 0; });
              run(false);
            } }), c);
          })));
        } else {
          // 使用者資料的二元欄是系統猜的，下拉下方提醒；改選後文字跟著變
          var warnEl = (r.type === 'bin' && st.src !== 'demo') ? h('div', { class: 'tip', style: 'color:var(--warn)' }, binWarn(st.roles[r.key])) : null;
          add(f, h('label', { for: id }, r.label));
          add(f, h('select', { id: id, onchange: function (ev) { st.roles[r.key] = ev.target.value; if (warnEl) warnEl.textContent = binWarn(st.roles[r.key]); run(false); } },
            st.table.cols.map(function (c) { return h('option', { value: c, selected: st.roles[r.key] === c }, c); })));
          if (warnEl) add(f, warnEl);
        }
        if (r.tip) add(f, h('div', { class: 'tip' }, r.tip));
        if (set.needs === 'wide' && r.key === 'y' && st.src !== 'demo') add(f, h('div', { class: 'tip', style: 'color:var(--warn)' }, '原因和結果是系統猜的，請確認這個組合有意義。'));
        add(roleBox, f);
      });
      add(roleBox, h('p', { class: 'hint' }, '欄位是自動猜的，請確認有沒有選對。'));
    }
    function drawParams() {
      paramBox.innerHTML = '';
      (set.params || []).forEach(function (p) {
        var id = 'p-' + p.key, out = h('output', { for: id }, p.fmt ? p.fmt(st.params[p.key]) : st.params[p.key]);
        var input;
        if (p.type === 'select') {
          input = h('select', { id: id, onchange: function (ev) { st.params[p.key] = ev.target.value; run(false); } },
            p.options.map(function (o) { return h('option', { value: o.value, selected: String(o.value) === String(st.params[p.key]) }, o.label); }));
          out = null;
        } else {
          input = h('input', { type: 'range', id: id, min: p.min, max: p.max, step: p.step || 1, value: st.params[p.key], oninput: function (ev) {
            st.params[p.key] = Number(ev.target.value); out.textContent = p.fmt ? p.fmt(st.params[p.key]) : st.params[p.key];
            clearTimeout(timer); timer = setTimeout(function () { run(false); }, 40);
          } });
        }
        add(paramBox, h('div', { class: 'field' }, h('label', { for: id }, p.label, out), input, p.tip ? h('div', { class: 'tip' }, p.tip) : null));
      });
      if (!(set.params || []).length) add(paramBox, h('p', { class: 'hint' }, '這個套餐沒有需要調的參數。'));
    }
    // 原始資料（前 60 列），標出納入或排除
    function rawBlock(prep) {
      var usedCols = []; set.roles.forEach(function (r) { roleCols(set, st, r).forEach(function (c) { if (usedCols.indexOf(c) < 0) usedCols.push(c); }); });
      return h('details', { class: 'raw', style: 'margin-top:12px' }, h('summary', {}, '看原始資料（前 60 列，標出哪些列被排除）'),
        h('div', { class: 'tbl', style: 'margin-top:6px' }, h('table', {},
          h('thead', {}, h('tr', {}, h('th', {}, '列'), usedCols.map(function (c) { return h('th', {}, c); }), h('th', {}, '狀態'))),
          h('tbody', {}, st.table.rows.slice(0, 60).map(function (row, i) {
            return h('tr', { class: prep.status[i] ? '' : 'ex' }, h('td', {}, i + 1), usedCols.map(function (c) { return h('td', {}, row[c] === '' ? '（空）' : row[c]); }), h('td', {}, prep.status[i] ? '納入' : '排除'));
          })))));
    }
    // prep 有值時，showRaw 的錯誤會一併列出原始資料，讓「展開下方的原始資料檢查」找得到
    function showErr(e, prep) {
      res.innerHTML = ''; add(res, h('div', { class: 'err', role: 'alert' }, (e && e.message) || String(e)));
      if (prep && e && e.showRaw) add(res, rawBlock(prep));
      last = null;
    }

    function run(animate) {
      var prep, out;
      try {
        set.roles.forEach(function (r) { if (r.multi && st.roles[r.key].length < (r.min || 1)) throw new Error(multiMsg(set, st, r)); });
        prep = prepare(set, st);
        var need = set.minRows || 12;
        if (prep.rows.length < need) {
          var short = new Error('可用的資料只有 ' + prep.rows.length + ' 列，這個套餐至少需要 ' + need + ' 列。' +
            (prep.excluded > 0 ? '有 ' + prep.excluded + ' 列因為空值或不是數字被排除，可以展開下方的原始資料檢查。' : '資料本身太少，請放更多資料進來。'));
          short.showRaw = prep.excluded > 0;
          throw short;
        }
        // 列數太多時平均抽樣（瀏覽器裡太慢的套餐才設 maxRows）
        var use = prep.rows, cap = set.maxRows;
        prep.sampled = null;
        if (cap && use.length > cap) {
          var N0 = use.length, picked = [], i;
          for (i = 0; i < cap; i++) picked.push(use[Math.floor(i * N0 / cap)]);
          use = picked; prep.sampled = { n: N0, m: cap };
        }
        var ctx = {
          rows: use, n: use.length, cols: st.roles, params: st.params, labels: prep.labels,
          col: function (name) { return use.map(function (r) { return r[name]; }); },
          X: function (names) { return use.map(function (r) { return names.map(function (c) { return r[c]; }); }); },
          ML: ML, U: U, isDemo: st.src === 'demo'
        };
        out = set.run(ctx);
      } catch (e) { showErr(e, prep); return; }
      last = out; render(prep, out, animate);
    }
    function render(prep, out, animate) {
      res.innerHTML = '';
      var total = st.table.rows.length;
      var samp = prep.sampled ? '<br>資料共 ' + U.fmt(prep.sampled.n) + ' 列，這個套餐在瀏覽器裡最多算 ' + U.fmt(prep.sampled.m) + ' 列，已平均抽出 ' + U.fmt(prep.sampled.m) + ' 列來算。' : '';
      add(res, h('p', { class: 'recon', html: '對帳：總列數 <b>' + U.fmt(total) + '</b> ＝ 納入 <b>' + U.fmt(prep.rows.length) + '</b> ＋ 排除 <b>' + U.fmt(prep.excluded) + '</b>（選用的欄位有空值或不是數字）' + samp + (out.note ? '<br>' + out.note : '') }));
      if (out.metrics && out.metrics.length) add(res, h('div', { class: 'metrics' }, out.metrics.map(function (m) {
        return h('div', { class: 'metric' }, h('div', { class: 'k' }, m.label), h('div', { class: 'v' }, m.value), m.hint ? h('div', { class: 'h' }, m.hint) : null);
      })));
      var canv = [];
      (out.charts || []).forEach(function (c, i) {
        var cv = h('canvas', { role: 'img', 'aria-label': c.title });
        canv.push({ cv: cv, c: c });
        add(res, h('div', { class: 'chart' },
          h('div', { class: 'ct' }, h('span', {}, c.title), i === 0 && !reduced ? h('button', { class: 'btn', type: 'button', onclick: function () { play(); } }, '重播動畫') : null), cv,
          c.caption ? h('p', { class: 'hint' }, c.caption) : null));
      });
      var say = h('div', { class: 'say' });
      if (out.reading) add(say, h('p', { class: 'read' }, h('b', {}, '白話結論'), out.reading));
      if (out.caution) add(say, h('p', { class: 'caut' }, h('b', {}, '別過度解讀'), out.caution));
      if (out.action) add(say, h('p', { class: 'act' }, h('b', {}, '本週可以做的一件事'), out.action));
      add(res, say);
      if (out.table) {
        var copyBtn = h('button', { class: 'btn', type: 'button', onclick: function () {
          var tsv = [out.table.head.join('\t')].concat(out.table.rows.map(function (r) { return r.join('\t'); })).join('\n');
          var done = function (ok) { copyBtn.textContent = ok ? '已複製，可貼到 Excel' : '複製失敗，請手動選取表格'; setTimeout(function () { copyBtn.textContent = '複製結果表'; }, 2200); };
          try { navigator.clipboard.writeText(tsv).then(function () { done(true); }, function () { done(false); }); } catch (e) { done(false); }
        } }, '複製結果表');
        add(res, h('div', { class: 'tblbar' }, h('span', {}, out.table.title || '結果表'), copyBtn));
        add(res, h('div', { class: 'tbl', style: 'max-height:320px;overflow:auto' }, h('table', {},
          h('thead', {}, h('tr', {}, out.table.head.map(function (x) { return h('th', {}, x); }))),
          h('tbody', {}, out.table.rows.map(function (r) { return h('tr', {}, r.map(function (x) { return h('td', {}, x); })); })))));
      }
      add(res, rawBlock(prep));

      function paint(t) { canv.forEach(function (x) { var f = fitCanvas(x.cv, x.c.ratio || .62); try { x.c.draw(f.g, f.w, f.h, t); } catch (e) { f.g.fillStyle = App.theme().bad; f.g.fillText('畫圖時發生錯誤：' + e.message, 10, 20); } }); }
      function play() {
        cancelAnimationFrame(raf);
        if (reduced) { paint(1); return; }
        animStart = performance.now();
        (function loop(now) { var t = Math.min(1, ((now || performance.now()) - animStart) / 2200); paint(t); if (t < 1) raf = requestAnimationFrame(loop); })();
      }
      App._redraw = function () { paint(1); };
      if (animate) play(); else { cancelAnimationFrame(raf); paint(1); }
    }

    root.innerHTML = '';
    add(root, [
      h('a', { class: 'back', href: '#' }, '← 回到套餐圖鑑'),
      h('h1', {}, set.ask || set.zh),
      h('p', { class: 'meth' }, set.zh + ' · ' + set.en),
      h('p', { class: 'q' }, set.question),
      h('ul', { class: 'chips', 'aria-label': '這個套餐自動做的步驟' }, h('li', { class: 'cap' }, '套餐內容'), set.pipeline.map(function (s) { return h('li', {}, s); })),
      h('div', { class: 'cols' },
        h('div', {},
          h('div', { class: 'panel' }, h('h2', {}, h('span', { class: 'st' }, '1'), '放資料'), dataBox),
          h('div', { class: 'panel' }, h('h2', {}, h('span', { class: 'st' }, '2'), '確認欄位'), roleBox),
          h('div', { class: 'panel' }, h('h2', {}, h('span', { class: 'st' }, '3'), '調參數'), paramBox)),
        h('div', { class: 'panel' }, h('h2', {}, h('span', { class: 'st' }, '4'), '看結果'), res)),
      h('footer', {}, '教學原型：上線前需另行驗證。' + (set.verified || '') + ' 資料只在這台裝置的瀏覽器裡計算。')
    ]);
    drawData(); drawRoles(); drawParams(); run(true);
    window.scrollTo(0, 0);
  }

  var rz = 0;
  window.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(function () { if (App._redraw) App._redraw(); }, 120); });
  function route() {
    var id = location.hash.replace(/^#/, ''), set = App.sets.filter(function (s) { return s.id === id; })[0];
    if (set) page(set); else wall();
  }
  App.start = function () {
    // 內建資料若用精簡格式（cols + aoa）存，啟動時展開成一列一個物件
    Object.keys(window.DEMO).forEach(function (k) { var d = window.DEMO[k]; if (d.aoa) { d.rows = d.aoa.map(function (r) { var o = {}; d.cols.forEach(function (c, j) { o[c] = r[j]; }); return o; }); delete d.aoa; } });
    root = document.getElementById('app');
    var order = App.cats.map(function (c) { return c.id; });
    App.sets.sort(function (a, b) { return order.indexOf(a.cat) - order.indexOf(b.cat); });
    window.addEventListener('hashchange', route); route();
  };
})();
