// 資料準備面板：把交易明細整理成套餐要的標準表。演算法在 src/algos/prep.js（ML.prep）。
(function () {
  'use strict';
  var App = window.App, h = App.h, U = App.U;

  var NEEDS_HINT = {
    customer: '這個套餐要一位顧客一列',
    labeled: '這個套餐要一位顧客一列，而且要有『之後有沒有再買』的答案',
    series: '這個套餐要一期一列（例如每月營收）'
  };
  var TABLE_NAME = {
    customer: '交易明細 → 顧客彙總',
    labeled: '交易明細 → 有答案的顧客表',
    series: '交易明細 → 每期營收'
  };
  var FIELD_NAME = { date: '日期', customer: '顧客', amount: '金額', order: '訂單編號' };
  var UNIT = { month: '個月', week: '週', day: '天' };
  var PERIODS = [['month', '月'], ['week', '週'], ['day', '日']];
  var WIN_MIN = 30, WIN_MAX = 180, WIN_STEP = 30;
  var DEF_OPT = { period: 'month', dropPartial: true, windowDays: 90 };
  var SCOPE_MAX = 3, SCOPE_QUICK = 4, SCOPE_QUICK_MAX_UNIQ = 12, SCOPE_OTHER_MAX_UNIQ = 30;
  var DROP_HINT = '目前有勾「丟掉頭尾不完整的期」，資料若不滿兩個完整的期，可以取消勾選，或把「一期多長」改短。';
  // 欄名像編號（不分大小寫）：這類欄位若重複很多，表可能不是一列一位顧客或一期一列
  var ID_RE = /id|編號|代號|會員|顧客|客戶|member|customer|cust|txn|order|單號/i;

  function txt(v) { return v == null ? '' : String(v).trim(); }
  function put(el, c) {
    if (c == null || c === false) return el;
    if (Array.isArray(c)) { c.forEach(function (x) { put(el, x); }); return el; }
    el.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
    return el;
  }
  // localStorage 不能用時（隱私模式、被禁用）就當作沒有存過
  function lsGet(k) { try { var s = window.localStorage.getItem(k); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
  function lsDel(k) { try { window.localStorage.removeItem(k); } catch (e) { } }
  function storeKey(cols, needs) { return 'prep:' + cols.slice().sort().join('|') + ':' + needs; }
  function isoOf(v) {
    if (v == null) return '未知';
    return typeof v === 'number' ? window.ML.prep.dayToISO(v) : String(v);
  }
  function sampleOf(rows, col) {
    for (var i = 0; i < rows.length; i++) {
      var v = txt(rows[i][col]);
      if (v) return v.length > 18 ? v.slice(0, 18) + '…' : v;
    }
    return '沒有資料';
  }
  function tsvOf(t) {
    return [t.cols.join('\t')].concat(t.rows.map(function (row) {
      return t.cols.map(function (c) { return String(row[c]); }).join('\t');
    })).join('\n');
  }
  function doCopy(text, btn, label, okMsg) {
    function done(ok) {
      btn.textContent = ok ? okMsg : '複製失敗，請手動選取';
      setTimeout(function () { btn.textContent = label; }, 2200);
    }
    try { navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); }); }
    catch (e) { done(false); }
  }
  function mergeOpt(o) {
    o = o || {};
    return {
      period: o.period || DEF_OPT.period,
      dropPartial: o.dropPartial == null ? DEF_OPT.dropPartial : !!o.dropPartial,
      windowDays: o.windowDays || DEF_OPT.windowDays
    };
  }

  // 猜欄位後的修正：訂單欄不能和其他欄是同一欄（例如 order_date 同時符合「訂單」與「日期」）
  function cleanGuess(g) {
    var out = { date: g.date || null, customer: g.customer || null, amount: g.amount || null, order: g.order || null };
    ['customer', 'amount', 'date'].forEach(function (k) { if (out.order && out.order === out[k]) out.order = null; });
    return out;
  }

  // 像交易明細：猜得到日期，且（顧客欄有重複值，或是 series 只要有金額欄）
  function looksTxn(raw, g, needs) {
    if (!g.date) return false;
    if (needs === 'series') return !!g.amount;
    if (!g.customer) return false;
    var seen = {}, dup = false;
    raw.rows.forEach(function (r) {
      var v = txt(r[g.customer]);
      if (!v) return;
      if (seen[v]) dup = true;
      seen[v] = true;
    });
    return dup;
  }

  // 第一個像編號的 text 欄，相異值超過 30 種（30 種以內當成門市、通路這類分類欄）且少於列數的一半；沒有就 null
  function dupIdCol(raw, prof) {
    var N = raw.rows.length;
    for (var i = 0; i < prof.length; i++) {
      var p = prof[i];
      if (p.kind === 'text' && ID_RE.test(p.col) && p.unique > 30 && p.unique < N / 2) return { col: p.col, n: N, unique: p.unique };
    }
    return null;
  }
  // 「已經整理好」模式：每一列被當成什麼
  function readyLead(needs, n) {
    if (needs === 'series') return '每一列會被當成一期，共 ' + U.fmt(n) + ' 列，而且要由舊到新排好。如果一期有很多列，請改選「是交易明細，幫我彙總」。';
    if (needs === 'labeled') return '每一列會被當成一位顧客，共 ' + U.fmt(n) + ' 列，而且表裡要有一欄是「事後才知道的結果」（例如後來有沒有再買）。';
    return '每一列會被當成一位顧客，共 ' + U.fmt(n) + ' 列。如果同一位顧客在表裡有很多列，請改選「是交易明細，幫我彙總」。';
  }

  // ---------- 界定範圍：規則的讀寫與檢查 ----------
  function blankNull(v) { return v === null || v === undefined || v === ''; }
  // 規則存進設定 JSON 時的樣子（和 ML.prep.applyScope 的規則格式相同）
  function ruleCopy(r) {
    if (r.op === 'in') return { col: r.col, op: 'in', values: r.values.slice() };
    if (r.op === 'dateRange') return { col: r.col, op: 'dateRange', from: r.from || null, to: r.to || null };
    return { col: r.col, op: 'numRange', min: blankNull(r.min) ? null : r.min, max: blankNull(r.max) ? null : r.max };
  }
  // 貼上或儲存的規則：有任何一處不合格就丟白話錯誤，整份設定都不套用
  function parseRule(r, raw) {
    var P = window.ML.prep;
    if (!r || typeof r !== 'object' || typeof r.col !== 'string') {
      throw new Error('設定裡的界定範圍格式不對，整份設定都沒有套用。');
    }
    if (raw.cols.indexOf(r.col) < 0) {
      throw new Error('設定裡的界定範圍用到「' + r.col + '」欄，但這份資料裡找不到這個欄位。整份設定都沒有套用。');
    }
    if (r.op === 'in') {
      if (!Array.isArray(r.values)) throw new Error('設定裡「' + r.col + '」的勾選值格式不對，整份設定都沒有套用。');
      return { col: r.col, op: 'in', values: r.values.map(txt) };
    }
    if (r.op === 'dateRange') {
      var fix = function (v, what) {
        if (blankNull(v)) return null;
        var d = P.parseDate(v);
        if (isNaN(d)) throw new Error('設定裡的「' + what + '」日期「' + v + '」看不懂，整份設定都沒有套用。');
        return P.dayToISO(d);
      };
      return { col: r.col, op: 'dateRange', from: fix(r.from, '起'), to: fix(r.to, '迄') };
    }
    if (r.op === 'numRange') {
      var num = function (v, what) {
        if (blankNull(v)) return null;
        var x = Number(v);
        if (!isFinite(x)) throw new Error('設定裡的「' + what + '」數字「' + v + '」不是數字，整份設定都沒有套用。');
        return x;
      };
      return { col: r.col, op: 'numRange', min: num(r.min, '最小'), max: num(r.max, '最大') };
    }
    throw new Error('設定裡的界定範圍種類「' + r.op + '」不認得，整份設定都沒有套用。');
  }
  // 規則有問題（不能套用）時回傳白話說明，沒有問題回傳 null
  function scopeProblem(r) {
    if (r.op === 'in' && r.values.length === 0) return '全部取消了，這條沒有套用。至少勾一個值。';
    if (r.op === 'dateRange' && r.from && r.to && r.from > r.to) return '起日比迄日晚，這條沒有套用。';
    if (r.op === 'numRange' && !blankNull(r.min) && !blankNull(r.max) && r.min > r.max) return '最小比最大還大，這條沒有套用。';
    return null;
  }

  // 解析貼上或儲存的對應設定；任何一處不合格就丟白話錯誤，不回傳一半的設定
  function parseCfg(cfg, raw, needs) {
    if (!cfg || typeof cfg !== 'object' || cfg.kind !== 'txn' || !cfg.map) {
      throw new Error('這段文字不是對應設定。請用「複製對應設定」複製，再貼到這裡。');
    }
    if (cfg.needs !== needs) {
      throw new Error('這份設定是給另一種格式用的（' + (cfg.needs || '不明') + '），這個套餐要的格式不同。');
    }
    var map = {}, required = needs === 'series' ? ['date', 'amount'] : ['date', 'customer', 'amount'];
    ['date', 'customer', 'amount', 'order'].forEach(function (k) {
      var v = cfg.map[k];
      if (k === 'customer' && needs === 'series') { map[k] = null; return; }
      if (v == null || v === '') {
        if (required.indexOf(k) >= 0) throw new Error('設定裡的「' + FIELD_NAME[k] + '欄」是空的，請重新複製一份設定。');
        map[k] = null; return;
      }
      if (raw.cols.indexOf(v) < 0) {
        throw new Error('設定裡的「' + FIELD_NAME[k] + '欄」指到「' + v + '」，但這份資料裡找不到這個欄位。請確認是不是同一份資料的設定。');
      }
      map[k] = v;
    });
    var o = cfg.opt || {}, opt = {};
    if (needs === 'series') {
      if (o.period != null && ['month', 'week', 'day'].indexOf(o.period) < 0) throw new Error('設定裡的「一期多長」只能是月、週、日。');
      opt = mergeOpt(o);
    } else if (needs === 'labeled') {
      var w = o.windowDays == null ? DEF_OPT.windowDays : Number(o.windowDays);
      if (!(w >= WIN_MIN && w <= WIN_MAX && w % WIN_STEP === 0)) {
        throw new Error('設定裡的「之後幾天內再買」要是 30 到 180 之間、30 的倍數。');
      }
      opt = { windowDays: w };
    }
    var scope = [];
    if (cfg.scope != null) {
      if (!Array.isArray(cfg.scope)) throw new Error('設定裡的「界定範圍」格式不對，整份設定都沒有套用。');
      if (cfg.scope.length > SCOPE_MAX) throw new Error('界定範圍最多 ' + SCOPE_MAX + ' 條，設定裡有 ' + cfg.scope.length + ' 條。');
      scope = cfg.scope.map(function (r) { return parseRule(r, raw); });
    }
    return { map: map, opt: opt, scope: scope };
  }

  function mount(box, ctx) {
    var set = ctx.set, raw = ctx.raw, needs = set.needs, P = window.ML.prep;
    var prof = P.profile(raw);
    var guess = cleanGuess(P.guessMapping(prof));
    var stored = null, storedCfg = lsGet(storeKey(raw.cols, needs));
    if (storedCfg) { try { stored = parseCfg(storedCfg, raw, needs); } catch (e) { stored = null; } }

    var state = {
      mode: (stored || looksTxn(raw, guess, needs)) ? 'txn' : 'ready',
      map: stored ? stored.map : Object.assign({}, guess),
      opt: mergeOpt(stored ? stored.opt : {}),
      scope: stored ? stored.scope : [],
      notice: null, storedNotice: !!stored,
      // 只有使用者改過設定（或套用了上次的設定）才記住這次的設定；自動猜的結果不記
      dirty: !!stored,
      pasteOpen: false, pasteText: '', cfgErr: null
    };
    var noticeEl = null, resBox = null, tipEl = null, copyB = null, scopeBox = null, noteBox = null;
    var pendingFocus = null, countCache = {}, spanCache = {};

    // 面板交不出表時呼叫 ctx.onError，core 會清掉舊的表與結果，避免上一份資料的結論留在畫面上
    function reportErr(msg) { if (ctx.onError) ctx.onError(new Error(msg)); }
    function failPanel(panelMsg, coreMsg) {
      put(resBox, h('div', { class: 'err', role: 'alert' }, panelMsg));
      reportErr(coreMsg);
    }

    // 某欄每一種值的筆數（空白值是 ''），依筆數由多到少
    function valueCounts(col) {
      if (countCache[col]) return countCache[col];
      var m = new Map();
      raw.rows.forEach(function (r) { var v = txt(r[col]); m.set(v, (m.get(v) || 0) + 1); });
      var list = Array.from(m.entries()).map(function (e) { return { v: e[0], n: e[1] }; });
      list.sort(function (a, b) { return b.n - a.n || (a.v < b.v ? -1 : a.v > b.v ? 1 : 0); });
      return (countCache[col] = list);
    }
    // 某欄能看懂的最小與最大（date 是日序，number 是數字）；沒有就 null
    function spanOf(col, kind) {
      var key = col + '|' + kind;
      if (spanCache[key] !== undefined) return spanCache[key];
      var lo = null, hi = null;
      raw.rows.forEach(function (r) {
        var v = txt(r[col]);
        if (v === '') return;
        var x = kind === 'date' ? P.parseDate(v) : P.num(v);
        if (isNaN(x)) return;
        if (lo === null || x < lo) lo = x;
        if (hi === null || x > hi) hi = x;
      });
      return (spanCache[key] = lo === null ? null : { lo: lo, hi: hi });
    }
    function kindOf(col) {
      for (var i = 0; i < prof.length; i++) if (prof[i].col === col) return prof[i].kind;
      return 'text';
    }

    // 依目前規則套用界定範圍；有問題的規則不套用（它的說明會顯示在卡片上）
    function runScope() {
      var applied = [];
      state.scope.forEach(function (r, i) { if (!scopeProblem(r)) applied.push({ i: i, rule: r }); });
      var res;
      try { res = P.applyScope(raw.rows, applied.map(function (a) { return a.rule; })); }
      catch (e) { return { err: (e && e.message) || String(e), applied: applied, rows: null, out: 0, per: {} }; }
      var per = {};
      applied.forEach(function (a, k) { per[a.i] = res.perRule[k]; });
      return { err: null, applied: applied, rows: res.rows, out: res.out, per: per };
    }

    function cfgOf() {
      var o = {};
      if (needs === 'series') o = { period: state.opt.period, dropPartial: !!state.opt.dropPartial };
      else if (needs === 'labeled') o = { windowDays: state.opt.windowDays };
      return {
        kind: 'txn', needs: needs,
        map: {
          date: state.map.date || null,
          customer: needs === 'series' ? null : (state.map.customer || null),
          amount: state.map.amount || null,
          order: state.map.order || null
        },
        opt: o,
        scope: state.scope.map(ruleCopy)
      };
    }

    // 「交易明細」模式：轉換後的警告（金額、顧客、期數選得對不對）
    function pickWarnings(rep, n, sc) {
      var out = [], denom = raw.rows.length - sc.out;
      if (denom > 0 && rep.nonPositive > denom * 0.3) {
        out.push('有 ' + Math.round(rep.nonPositive / denom * 100) + '% 的列金額 ≤ 0，金額欄可能選錯了。目前選的是「' + state.map.amount + '」。');
      }
      if (needs !== 'series' && rep.used >= 50 && n > rep.used * 0.9) {
        out.push('幾乎每一筆交易都是不同的顧客（' + U.fmt(rep.used) + ' 筆交易、' + U.fmt(n) + ' 位顧客），顧客欄可能選到交易編號了。目前選的是「' + state.map.customer + '」。');
      }
      if (needs === 'series' && n < 24) {
        var p = state.opt.period;
        out.push('只有 ' + U.fmt(n) + ' 期。預測類的套餐期數越少越不可靠' +
          (p === 'day' ? '。' : '；' + (p === 'month' ? '可以把「一期多長」改成週' : '可以把「一期多長」改成日') + '，看看趨勢是否一致。'));
      }
      return out;
    }

    // 對帳區與結果說明（只在「交易明細」模式）
    function renderReport(r, sc) {
      var rep = r.report, t = r.table, n = t.rows.length, rawTotal = raw.rows.length, sum = 0;
      var items = [];
      if (sc.out) items.push(['不在這次範圍', sc.out]);
      items.push(['用來計算', rep.used], ['日期看不懂', rep.badDate], ['金額不是數字', rep.badAmount],
        ['金額 ≤ 0（退貨、贈品或 0 元）', rep.nonPositive], ['沒有顧客編號（散客）', rep.noCustomer]);
      var shown = items.filter(function (it) { sum += it[1] || 0; return it[0] === '用來計算' || it[1]; });
      var kids = ['原始 ', h('b', {}, U.fmt(rawTotal)), ' 列 ＝ '];
      shown.forEach(function (it, i) {
        if (i) kids.push(' ＋ ');
        kids.push(it[0] + ' ', h('b', {}, U.fmt(it[1])));
      });
      if (sum !== rawTotal) kids.push(h('span', { class: 'prep-warn' }, '（加總對不上，請回報這個問題）'));
      put(resBox, h('p', { class: 'recon', 'data-total': String(rawTotal), 'data-sum': String(sum) }, kids));
      pickWarnings(rep, n, sc).forEach(function (w) {
        put(resBox, h('div', { class: 'prep-note', role: 'note' }, w));
      });

      put(resBox, h('p', { class: 'hint' }, '資料期間：' + txt(rep.firstDate) + ' 到 ' + txt(rep.lastDate) + '。'));
      var outTxt;
      if (needs === 'series') {
        var dr = rep.droppedPartial || [], dropText;
        if (!state.opt.dropPartial) dropText = '，頭尾不完整的期有保留';
        else dropText = dr.length ? '，丟掉頭尾不完整的 ' + dr.join('、') : '，沒有丟掉頭尾不完整的期';
        outTxt = '整理成 ' + U.fmt(n) + ' ' + UNIT[state.opt.period] + '，補了 ' + U.fmt(rep.filledZero || 0) + ' 期' + dropText + '。';
      } else if (needs === 'labeled') {
        outTxt = '整理成 ' + U.fmt(n) + ' 位顧客，其中 ' + U.fmt(rep.positives || 0) + ' 位在之後 ' + state.opt.windowDays + ' 天內再買。';
      } else {
        outTxt = '整理成 ' + U.fmt(n) + ' 位顧客。';
      }
      put(resBox, h('p', { class: 'hint' }, outTxt));
      if (needs === 'series') put(resBox, h('p', { class: 'hint' }, '散客的交易有算進營收。'));

      if (tipEl) {
        if (needs === 'customer') tipEl.textContent = '最近購買天數從資料的最後一天（' + isoOf(rep.asOf) + '）往回算。';
        else if (needs === 'labeled') tipEl.textContent = '切點日期：' + isoOf(rep.cutoff) + '。切點以前的交易算特徵，切點之後 ' + state.opt.windowDays + ' 天內的購買算答案。';
      }

      var cb = null;
      cb = h('button', { class: 'btn', type: 'button', onclick: function () {
        doCopy(tsvOf(t), cb, '複製整理後的表', '已複製，可貼到 Excel');
      } }, '複製整理後的表');
      var head = h('tr', {}, t.cols.map(function (c) { return h('th', {}, c); }));
      var body = t.rows.slice(0, 20).map(function (row) {
        return h('tr', {}, t.cols.map(function (c) { return h('td', {}, String(row[c])); }));
      });
      var table = h('table', {}, h('thead', {}, head), h('tbody', {}, body));
      var scroll = h('div', { class: 'tbl', style: 'margin-top:6px;max-height:320px;overflow:auto' }, table);
      var prev = h('details', { class: 'prep-prev' }, h('summary', {}, '看整理後的表（前 20 列）'), scroll);
      put(resBox, h('div', { class: 'prep-row' }, prev, cb));
    }

    // 「交易明細」模式：先界定範圍，再轉換；成功才交給 ctx.onTable，失敗只在面板內顯示，並呼叫 ctx.onError 清掉舊結果
    function convert(sc) {
      resBox.innerHTML = '';
      if (tipEl) tipEl.textContent = '';
      if (sc.err) return failPanel(sc.err, '資料準備沒有成功：' + sc.err);
      var m = state.map, need = needs !== 'series';
      if (!m.date || !m.amount || (need && !m.customer)) {
        var miss = '日期欄、' + (need ? '顧客欄、' : '') + '金額欄';
        put(resBox, h('p', { class: 'hint' }, '請先選好' + miss + '。'));
        return reportErr('資料準備還沒完成：請先在上面選好' + miss + '。');
      }
      if (!sc.rows.length) {
        var none = '界定範圍把資料全部排除了，沒有列可以整理。請移除或放寬界定範圍。';
        return failPanel(none, '資料準備沒有成功：' + none);
      }
      var map = { date: m.date, customer: need ? m.customer : null, amount: m.amount, order: m.order || null };
      var fn, opt = {};
      if (needs === 'series') { fn = P.txnToSeries; opt = { period: state.opt.period, dropPartial: !!state.opt.dropPartial }; }
      else if (needs === 'labeled') { fn = P.txnToLabeled; opt = { windowDays: state.opt.windowDays }; }
      else fn = P.txnToCustomer;
      var r;
      try { r = fn(sc.rows, map, opt); }
      catch (e) {
        var msg = (e && e.message) || String(e);
        // 丟掉頭尾不完整的期之後只剩不到兩期（訊息是「扣掉不完整的期別後，只剩 N 期」）：補充說明怎麼改
        if (needs === 'series' && opt.dropPartial && /只剩 \d+ 期/.test(msg)) msg += ' ' + DROP_HINT;
        return failPanel(msg, '資料準備沒有成功：' + msg);
      }
      r.table.name = TABLE_NAME[needs] || r.table.name;
      if (state.dirty) lsSet(storeKey(raw.cols, needs), cfgOf());
      renderReport(r, sc);
      ctx.onTable(r.table);
    }

    // 「已經整理好」模式：有界定範圍就交出篩選後的原表，並說明原始列數怎麼分；同時說明每一列被當成什麼
    function readyNote(n) {
      var lines = [readyLead(needs, n)];
      var d = dupIdCol(raw, prof);
      if (d) lines.push('欄位「' + d.col + '」有重複的值（' + U.fmt(d.n) + ' 列裡只有 ' + U.fmt(d.unique) + ' 種），這份表可能不是' + (needs === 'series' ? '一期一列' : '一列一位顧客') + '。');
      return h('div', { class: 'prep-note', role: 'note' }, lines.map(function (t) { return h('p', {}, t); }));
    }
    function showReady(sc) {
      resBox.innerHTML = '';
      if (noteBox) { noteBox.innerHTML = ''; put(noteBox, readyNote(sc.rows ? sc.rows.length : raw.rows.length)); }
      if (sc.err) return failPanel(sc.err, '資料準備沒有成功：' + sc.err);
      if (!sc.applied.length) { ctx.onTable(raw); return; }
      var rawTotal = raw.rows.length, sum = sc.rows.length + sc.out;
      var parts = [];
      if (sc.out) parts.push(['不在這次範圍', sc.out]);
      parts.push(['拿去分析', sc.rows.length]);
      var kids = ['原始 ', h('b', {}, U.fmt(rawTotal)), ' 列 ＝ '];
      parts.forEach(function (p, i) {
        if (i) kids.push(' ＋ ');
        kids.push(p[0] + ' ', h('b', {}, U.fmt(p[1])));
      });
      if (sum !== rawTotal) kids.push(h('span', { class: 'prep-warn' }, '（加總對不上，請回報這個問題）'));
      put(resBox, h('p', { class: 'recon', 'data-total': String(rawTotal), 'data-sum': String(sum) }, kids));
      ctx.onTable({ name: raw.name, cols: raw.cols, rows: sc.rows });
    }

    // 規則或對應改變：先重算界定範圍，再重畫範圍區與結果，並重新交表
    function refresh() {
      var sc = runScope();
      drawScope(sc);
      if (state.mode === 'txn') convert(sc); else showReady(sc);
    }

    function changed(focusId) {
      state.notice = null; state.storedNotice = false; state.cfgErr = null; state.dirty = true;
      if (noticeEl) { noticeEl.remove(); noticeEl = null; }
      pendingFocus = focusId || null;
      refresh();
    }

    // 套用上次設定時的摘要（日期、顧客、金額；series 沒有顧客欄）
    function mapSummary() {
      var parts = ['日期：' + (state.map.date || '未選')];
      if (needs !== 'series') parts.push('顧客：' + (state.map.customer || '未選'));
      parts.push('金額：' + (state.map.amount || '未選'));
      return parts.join('、');
    }
    // 不要用上次的設定：刪掉存的那筆，改回系統自動猜的結果並重算（重算後先不記住，直到使用者再改設定）
    function resetStored() {
      lsDel(storeKey(raw.cols, needs));
      state.map = Object.assign({}, guess);
      state.opt = mergeOpt({});
      state.scope = [];
      state.mode = looksTxn(raw, guess, needs) ? 'txn' : 'ready';
      state.notice = null; state.storedNotice = false; state.cfgErr = null; state.dirty = false;
      draw();
    }

    function mapField(key, id, label, required) {
      var cur = state.map[key], warn = null, opts = [];
      opts.push(h('option', { value: '', selected: !cur }, required ? '請選擇' : '不使用'));
      raw.cols.forEach(function (c) {
        opts.push(h('option', { value: c, selected: cur === c }, c + '（例：' + sampleOf(raw.rows, c) + '）'));
      });
      if (required && !cur) warn = h('div', { class: 'prep-warn' }, '猜不到，請手動選');
      var sel = h('select', { id: id, onchange: function (ev) {
        state.map[key] = ev.target.value || null;
        if (warn) warn.hidden = true;
        changed();
      } }, opts);
      return h('div', { class: 'field' }, h('label', { for: id }, label), sel, warn);
    }

    function applyPaste() {
      var cfg;
      try { cfg = JSON.parse(state.pasteText); }
      catch (e) { state.cfgErr = '這段文字看不懂，格式好像壞掉了。請重新複製一次對應設定。'; draw(); return; }
      var r;
      try { r = parseCfg(cfg, raw, needs); }
      catch (e) { state.cfgErr = e.message; draw(); return; }
      state.map = r.map; state.opt = mergeOpt(r.opt); state.scope = r.scope;
      state.notice = '已套用貼上的對應設定'; state.storedNotice = false; state.dirty = true;
      state.pasteOpen = false; state.pasteText = ''; state.cfgErr = null;
      draw();
    }

    // ---------- 界定範圍區 ----------
    function addRule(col, kind) {
      if (state.scope.length >= SCOPE_MAX) return;
      var rule;
      if (kind === 'date') rule = { col: col, op: 'dateRange', from: null, to: null };
      else if (kind === 'number') rule = { col: col, op: 'numRange', min: null, max: null };
      else rule = { col: col, op: 'in', values: valueCounts(col).map(function (c) { return c.v; }) };
      state.scope.push(rule);
      changed();
    }

    function ruleCard(r, i, sc) {
      var pid = 'prep-scope-' + i, title, body, prob = scopeProblem(r), n = sc.per[i];
      if (r.op === 'in') {
        title = r.col + '：只留下勾選的值';
        body = h('div', { class: 'checks' }, valueCounts(r.col).map(function (c, j) {
          var cid = pid + '-v' + j, on = r.values.indexOf(c.v) >= 0;
          return h('label', { for: cid }, h('input', { type: 'checkbox', id: cid, checked: on, onchange: function (ev) {
            if (ev.target.checked) { if (r.values.indexOf(c.v) < 0) r.values.push(c.v); }
            else r.values = r.values.filter(function (x) { return x !== c.v; });
            changed(cid);
          } }), (c.v === '' ? '（空白）' : c.v) + '：' + U.fmt(c.n) + ' 列');
        }));
      } else if (r.op === 'dateRange') {
        title = r.col + '：日期範圍';
        var sp = spanOf(r.col, 'date');
        body = h('div', {},
          h('div', { class: 'prep-scope-pair' },
            h('div', { class: 'field' }, h('label', { for: pid + '-from' }, '起'),
              h('input', { type: 'date', id: pid + '-from', value: r.from || '', onchange: function (ev) { r.from = ev.target.value || null; changed(pid + '-from'); } })),
            h('div', { class: 'field' }, h('label', { for: pid + '-to' }, '迄'),
              h('input', { type: 'date', id: pid + '-to', value: r.to || '', onchange: function (ev) { r.to = ev.target.value || null; changed(pid + '-to'); } }))),
          h('div', { class: 'tip' }, sp ? '這欄最早 ' + P.dayToISO(sp.lo) + '，最晚 ' + P.dayToISO(sp.hi) + '。空白就是不設限。' : '這欄沒有看得懂的日期，這條不會排除任何列。'));
      } else {
        title = r.col + '：數字範圍';
        var spn = spanOf(r.col, 'number');
        body = h('div', {},
          h('div', { class: 'prep-scope-pair' },
            h('div', { class: 'field' }, h('label', { for: pid + '-min' }, '最小'),
              h('input', { type: 'number', id: pid + '-min', value: blankNull(r.min) ? '' : r.min, onchange: function (ev) { r.min = ev.target.value === '' ? null : Number(ev.target.value); changed(pid + '-min'); } })),
            h('div', { class: 'field' }, h('label', { for: pid + '-max' }, '最大'),
              h('input', { type: 'number', id: pid + '-max', value: blankNull(r.max) ? '' : r.max, onchange: function (ev) { r.max = ev.target.value === '' ? null : Number(ev.target.value); changed(pid + '-max'); } }))),
          h('div', { class: 'tip' }, spn ? '這欄的數字從 ' + U.fmt(spn.lo) + ' 到 ' + U.fmt(spn.hi) + '。空白就是不設限。' : '這欄沒有看得懂的數字，這條不會排除任何列。'));
      }
      var foot = prob ? h('p', { class: 'prep-warn' }, prob)
        : (n === undefined ? null : h('p', { class: 'hint' }, '這條排除了 ' + U.fmt(n) + ' 列。'));
      return h('div', { class: 'prep-scope-card', id: 'prep-scope-card-' + i },
        h('div', { class: 'prep-scope-top' }, h('b', {}, title),
          h('button', { class: 'btn', type: 'button', id: pid + '-remove', 'aria-label': '移除這條界定範圍：' + r.col, onclick: function () {
            state.scope.splice(i, 1); changed();
          } }, '移除')),
        body, foot);
    }

    function drawScope(sc) {
      scopeBox.innerHTML = '';
      var rules = state.scope, full = rules.length >= SCOPE_MAX;
      var quick = prof.filter(function (p) { return p.kind === 'text' && p.unique >= 2 && p.unique <= SCOPE_QUICK_MAX_UNIQ; })
        .sort(function (a, b) { return a.unique - b.unique; }).slice(0, SCOPE_QUICK);
      var others = prof.filter(function (p) {
        return (p.kind === 'text' && p.unique <= SCOPE_OTHER_MAX_UNIQ) || p.kind === 'date' || p.kind === 'number';
      });
      var sel = h('select', { id: 'prep-scope-col', disabled: full },
        [h('option', { value: '' }, '請選欄位')],
        others.map(function (p) {
          var k = p.kind === 'date' ? '日期' : p.kind === 'number' ? '數字' : p.unique + ' 種';
          return h('option', { value: p.col }, p.col + '（' + k + '）');
        }));
      var kids = [
        h('div', { class: 'prep-scope-h' }, '界定範圍（選填）'),
        h('p', { class: 'hint' }, '不在範圍的資料沒有壞，只是不在這次的題目裡。'),
        sc.err ? h('div', { class: 'err', role: 'alert' }, sc.err) : null,
        h('div', { class: 'field' }, h('div', { class: 'lb' }, '快速加入'),
          quick.length
            ? h('div', { class: 'prep-chips' }, quick.map(function (p, i) {
                return h('button', { class: 'btn', type: 'button', id: 'prep-scope-quick-' + i, disabled: full,
                  onclick: function () { addRule(p.col, 'text'); } }, p.col + '（' + p.unique + ' 種）');
              }))
            : h('p', { class: 'hint' }, '沒有適合的欄位可以快速加入。')),
        h('div', { class: 'field' }, h('label', { for: 'prep-scope-col' }, '用其他欄位篩選'),
          h('div', { class: 'prep-row' }, sel,
            h('button', { class: 'btn', type: 'button', id: 'prep-scope-add', disabled: full, onclick: function () {
              var col = sel.value;
              if (col) addRule(col, kindOf(col));
            } }, '加入')))
      ];
      if (full) kids.push(h('p', { class: 'hint' }, '最多 ' + SCOPE_MAX + ' 條。要加新的，請先移除一條。'));
      if (!rules.length) kids.push(h('p', { class: 'hint' }, '目前沒有界定範圍，全部資料都用。'));
      rules.forEach(function (r, i) { kids.push(ruleCard(r, i, sc)); });
      put(scopeBox, kids);
      if (pendingFocus) {
        var el = document.getElementById(pendingFocus);
        if (el && el.focus) el.focus();
        pendingFocus = null;
      }
    }

    // ---------- 主體 ----------
    function drawTxn(wrap) {
      noticeEl = null;
      if (state.storedNotice) {
        noticeEl = h('div', { class: 'prep-note', role: 'status' }, [
          h('p', {}, '已套用你上次對這種格式的設定（' + mapSummary() + '）。'),
          h('button', { class: 'btn', type: 'button', id: 'prep-cfg-reset', onclick: resetStored }, '不要用上次的設定')
        ]);
        put(wrap, noticeEl);
      } else if (state.notice) { noticeEl = h('p', { class: 'hint' }, state.notice); put(wrap, noticeEl); }
      put(wrap, [
        mapField('date', 'prep-date', '日期欄', true),
        needs === 'series' ? null : mapField('customer', 'prep-customer', '顧客欄', true),
        mapField('amount', 'prep-amount', '金額欄', true),
        mapField('order', 'prep-order', '訂單編號（同一張單拆成多列時才需要）', false)
      ]);
      if (needs === 'series') {
        put(wrap, [
          h('div', { class: 'field' }, h('label', { for: 'prep-period' }, '一期多長'),
            h('select', { id: 'prep-period', onchange: function (ev) { state.opt.period = ev.target.value; changed(); } },
              PERIODS.map(function (p) { return h('option', { value: p[0], selected: state.opt.period === p[0] }, p[1]); }))),
          h('div', { class: 'field checks' }, h('label', {},
            h('input', { type: 'checkbox', id: 'prep-drop', checked: !!state.opt.dropPartial, onchange: function (ev) {
              state.opt.dropPartial = ev.target.checked; changed();
            } }), '丟掉頭尾不完整的期'))
        ]);
      } else if (needs === 'labeled') {
        var wOut = h('output', { for: 'prep-window' }, state.opt.windowDays + ' 天');
        put(wrap, h('div', { class: 'field' }, h('label', { for: 'prep-window' }, '之後幾天內再買算回購', wOut),
          h('input', { type: 'range', id: 'prep-window', min: WIN_MIN, max: WIN_MAX, step: WIN_STEP, value: state.opt.windowDays, oninput: function (ev) {
            state.opt.windowDays = Number(ev.target.value);
            wOut.textContent = state.opt.windowDays + ' 天';
            changed();
          } })));
      }
      tipEl = h('div', { class: 'tip' });
      if (needs !== 'series') put(wrap, tipEl);

      copyB = h('button', { class: 'btn', type: 'button', onclick: function () {
        doCopy(JSON.stringify(cfgOf()), copyB, '複製對應設定', '已複製對應設定');
      } }, '複製對應設定');
      var pasteB = h('button', { class: 'btn', type: 'button', 'aria-expanded': String(!!state.pasteOpen), onclick: function () {
        state.pasteOpen = !state.pasteOpen; state.cfgErr = null; draw();
      } }, '貼上對應設定');
      put(wrap, h('div', { class: 'prep-row' }, copyB, pasteB));
      if (state.pasteOpen) {
        put(wrap, h('div', { class: 'field' },
          h('textarea', { id: 'prep-cfg', 'aria-label': '貼上的對應設定', oninput: function (ev) { state.pasteText = ev.target.value; } }, state.pasteText),
          h('button', { class: 'btn prep-apply', type: 'button', onclick: applyPaste }, '套用'),
          state.cfgErr ? h('div', { class: 'err', role: 'alert' }, state.cfgErr) : null));
      }
      resBox = h('div', { class: 'prep-res' });
      put(wrap, resBox);
    }

    function draw() {
      box.innerHTML = '';
      noticeEl = null; tipEl = null; copyB = null; noteBox = null;
      var wrap = h('div', { class: 'prep' });
      scopeBox = h('div', { class: 'prep-scope' });
      var head = [
        h('div', { class: 'prep-h' }, '資料準備'),
        h('div', { class: 'seg', role: 'group', 'aria-label': '資料準備方式' },
          h('button', { type: 'button', 'aria-pressed': String(state.mode === 'ready'), onclick: function () { setMode('ready'); } }, '已經整理好'),
          h('button', { type: 'button', 'aria-pressed': String(state.mode === 'txn'), onclick: function () { setMode('txn'); } }, '是交易明細，幫我彙總')),
        h('p', { class: 'hint' }, NEEDS_HINT[needs] || '')
      ];
      if (state.mode === 'ready') { noteBox = h('div', { class: 'prep-readynote' }); head.push(noteBox); }
      head.push(scopeBox);
      put(wrap, head);
      if (state.mode === 'ready') {
        put(wrap, h('p', { class: 'hint' }, '請在下一步確認欄位。'));
        resBox = h('div', { class: 'prep-res' });
        put(wrap, resBox);
      } else {
        var tx = h('div', { class: 'prep-txn' }); put(wrap, tx); drawTxn(tx);
      }
      put(box, wrap);
      refresh();
    }

    function setMode(m) {
      if (state.mode === m) return;
      state.mode = m; state.cfgErr = null; state.pasteOpen = false; state.dirty = true;
      draw();
    }

    draw();
  }

  App.prep = { mount: mount };
})();
