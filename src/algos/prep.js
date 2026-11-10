// 資料準備：看懂日期與數字、猜欄位、彙總成標準表、交出對帳報告。純函式，不碰 DOM，不用亂數。
(function () {
  'use strict';
  var ML = (typeof window !== 'undefined') ? window.ML : require('./base.js');
  ML.prep = ML.prep || {};
  var P = ML.prep;
  var DAY = 86400000;

  // 全形數字 ０–９ 轉半形
  function fixDigits(s) {
    return s.replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
  }
  function str(v) { return (v === null || v === undefined) ? '' : String(v).trim(); }
  // 四捨五入到小數 2 位（半進位）。用數字的十進位字串來移位，避免 1.005 這類浮點誤差。
  function round2(x) {
    var s = String(x);
    if (s.indexOf('e') >= 0) return Math.round(x * 100) / 100;
    return Number(Math.round(Number(s + 'e2')) + 'e-2');
  }

  // 金額：去掉空白、NT$、元、千分位逗號（半形全形）、結尾 %；括號為負數。不能解讀的回 NaN。
  P.num = function (v) {
    if (v === null || v === undefined) return NaN;
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    var s = fixDigits(String(v)).replace(/\s/g, '');
    s = s.replace(/NT/gi, '').replace(/\$/g, '').replace(/元/g, '').replace(/[,，]/g, '');
    s = s.replace(/[%％]$/, '');
    var neg = false, m = /^[(（](.*)[)）]$/.exec(s);
    if (m) { neg = true; s = m[1]; }
    if (!/^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)$/.test(s)) return NaN;
    if (neg && /^[+-]/.test(s)) return NaN;
    var x = Number(s);
    return neg ? -x : x;
  };

  // 年份記號：3 位數 1–199 為民國年（加 1911）；4 位數要 ≥1000 才是西元年。其他回 NaN。
  function yearTok(t) {
    var v = Number(t);
    if (t.length === 3) return (v >= 1 && v <= 199) ? v + 1911 : NaN;
    if (t.length === 4) return v >= 1000 ? v : NaN;
    return NaN;
  }
  // 年月日 → 日序（UTC）。不存在的日子（2/30、13 月）回 NaN。
  function ymd(y, m, d) {
    if (!(y >= 1000 && m >= 1 && m <= 12 && d >= 1)) return NaN;
    var dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    if (d > dim) return NaN;
    return Date.UTC(y, m - 1, d) / DAY;
  }

  P.parseDate = function (v) {
    if (v === null || v === undefined) return NaN;
    var s = fixDigits(String(v)).trim();
    s = s.replace(/(\s+|T)\d{1,2}:\d{1,2}(:\d{1,2}(\.\d+)?)?$/, '').trim();  // 忽略時間
    var m;
    if ((m = /^民國\s*([0-9]{1,3})\s*年\s*([0-9]{1,2})\s*月\s*([0-9]{1,2})\s*日$/.exec(s))) {
      var ry = Number(m[1]);
      return (ry >= 1 && ry <= 199) ? ymd(ry + 1911, +m[2], +m[3]) : NaN;
    }
    if ((m = /^([0-9]{3,4})\s*年\s*([0-9]{1,2})\s*月\s*([0-9]{1,2})\s*日$/.exec(s))) {
      return ymd(yearTok(m[1]), +m[2], +m[3]);
    }
    if ((m = /^([0-9]{3,4})([-\/.])([0-9]{1,2})\2([0-9]{1,2})$/.exec(s))) {   // 年-月-日
      return ymd(yearTok(m[1]), +m[3], +m[4]);
    }
    if ((m = /^([0-9]{1,2})([-\/.])([0-9]{1,2})\2([0-9]{4})$/.exec(s))) {     // 月/日/年（四碼年在最後）
      return ymd(yearTok(m[4]), +m[1], +m[3]);
    }
    if (/^[0-9]+$/.test(s)) {
      if (s.length === 8) return ymd(Number(s.slice(0, 4)), Number(s.slice(4, 6)), Number(s.slice(6, 8)));
      if (s.length === 7) return ymd(yearTok(s.slice(0, 3)), Number(s.slice(3, 5)), Number(s.slice(5, 7)));
    }
    return NaN;
  };

  P.dayToISO = function (n) {
    if (!isFinite(n)) return '';
    return new Date(n * DAY).toISOString().slice(0, 10);
  };

  // 界定範圍：依規則篩掉不在這次題目裡的列。規則之間是 AND；同一列被多條排除時，只記在陣列中最前面那條。
  // 回傳 {rows（留下的原物件、原順序）, out（排除列數）, perRule（每條排除列數）}。
  // 日期看不懂、數字看不懂的列一律留下，交給後面的轉換函式去歸類（不在這裡默默消失）。
  function scopeTest(rule, rows) {
    var col = rule && rule.col;
    if (typeof col !== 'string' || !col) throw new Error('界定範圍的規則缺少欄位名稱。');
    if (rows.length && !Object.prototype.hasOwnProperty.call(rows[0], col)) {
      throw new Error('界定範圍用的欄位「' + col + '」不在這份資料裡，請重新選擇。');
    }
    function blank(v) { return v === null || v === undefined || v === ''; }
    if (rule.op === 'in') {
      var set = new Set((rule.values || []).map(function (v) { return str(v); }));
      return function (row) { return set.has(str(row[col])); };
    }
    if (rule.op === 'dateRange') {
      var from = blank(rule.from) ? null : P.parseDate(rule.from);
      var to = blank(rule.to) ? null : P.parseDate(rule.to);
      if (!blank(rule.from) && isNaN(from)) throw new Error('界定範圍的起日「' + rule.from + '」看不懂，請用 YYYY-MM-DD。');
      if (!blank(rule.to) && isNaN(to)) throw new Error('界定範圍的迄日「' + rule.to + '」看不懂，請用 YYYY-MM-DD。');
      return function (row) {
        var d = P.parseDate(row[col]);
        if (isNaN(d)) return true;  // 日期看不懂：留下，之後算進「日期看不懂」
        return !((from !== null && d < from) || (to !== null && d > to));
      };
    }
    if (rule.op === 'numRange') {
      var min = blank(rule.min) ? null : Number(rule.min);
      var max = blank(rule.max) ? null : Number(rule.max);
      if ((min !== null && !isFinite(min)) || (max !== null && !isFinite(max))) {
        throw new Error('界定範圍的數字上下限要是數字。');
      }
      return function (row) {
        var x = P.num(row[col]);
        if (isNaN(x)) return true;  // 不是數字：留下，之後算進「金額不是數字」
        return !((min !== null && x < min) || (max !== null && x > max));
      };
    }
    throw new Error('界定範圍的規則種類「' + rule.op + '」不認得。');
  }

  P.applyScope = function (rows, rules) {
    rules = rules || [];
    var tests = rules.map(function (r) { return scopeTest(r, rows); });
    var perRule = rules.map(function () { return 0; }), keep = [], out = 0;
    rows.forEach(function (row) {
      for (var i = 0; i < tests.length; i++) {
        if (!tests[i](row)) { perRule[i]++; out++; return; }
      }
      keep.push(row);
    });
    return { rows: keep, out: out, perRule: perRule };
  };

  // 每欄的概況。n＝總列數，missing＝空白列數，unique＝非空相異值，sample＝前 3 個非空值。
  P.profile = function (table) {
    var rows = table.rows, n = rows.length;
    return table.cols.map(function (col) {
      var vals = [], seen = new Set(), i;
      for (i = 0; i < n; i++) {
        var s = str(rows[i][col]);
        if (s === '') continue;
        vals.push(s);
        seen.add(s);
      }
      var L = vals.length, nd = 0, nn = 0;
      for (i = 0; i < L; i++) {
        if (!isNaN(P.parseDate(vals[i]))) nd++;
        if (!isNaN(P.num(vals[i]))) nn++;
      }
      var kind = 'text';
      if (L && nd * 5 >= L * 4) kind = 'date';
      else if (L && nn * 5 >= L * 4) kind = 'number';
      var uniq = seen.size;
      return {
        col: col, kind: kind, n: n, missing: n - L, unique: uniq,
        idLike: L >= 20 && uniq * 100 >= L * 95,
        sample: vals.slice(0, 3)
      };
    });
  };

  function has(name, words) {
    var l = String(name).toLowerCase();
    return words.some(function (w) { return l.indexOf(w) >= 0; });
  }
  // 猜欄位：date／amount／customer／order，猜不到就是 null。
  P.guessMapping = function (prof) {
    function find(pred) {
      for (var i = 0; i < prof.length; i++) if (pred(prof[i])) return prof[i].col;
      return null;
    }
    var map = { date: null, customer: null, amount: null, order: null };
    var DATE_W = ['日期', '時間', 'date', 'time', 'day'];
    var AMT_W = ['實收', '總額', '總計', '金額', '營收', '銷售額', '小計', 'amount', 'total', 'revenue', 'sales', 'price'];
    var CUST_W = ['會員', '顧客', '客戶', '客編', 'member', 'customer', 'cust', 'client', 'user'];
    var ORDER_W = ['訂單', '單號', '交易編號', '發票', 'order', 'txn', 'invoice', 'receipt'];

    map.date = find(function (p) { return p.kind === 'date' && has(p.col, DATE_W); }) ||
               find(function (p) { return p.kind === 'date'; });
    for (var k = 0; k < AMT_W.length && !map.amount; k++) {
      var w = AMT_W[k];
      map.amount = find(function (p) { return p.kind === 'number' && has(p.col, [w]); });
    }
    map.customer = find(function (p) { return has(p.col, CUST_W); });
    map.order = find(function (p) { return p.kind !== 'date' && p.col !== map.customer && p.col !== map.date && p.col !== map.amount && has(p.col, ORDER_W); });
    return map;
  };

  // 共用：逐列歸類（依固定順序：日期 → 金額 → 非正 → 顧客空白 → 有效）。
  function classify(rows, map, needCustomer) {
    var r = { total: rows.length, used: 0, badDate: 0, badAmount: 0, nonPositive: 0, noCustomer: 0 };
    var used = [];
    rows.forEach(function (row, idx) {
      var d = P.parseDate(row[map.date]);
      if (isNaN(d)) { r.badDate++; return; }
      var a = P.num(row[map.amount]);
      if (isNaN(a)) { r.badAmount++; return; }
      if (a <= 0) { r.nonPositive++; return; }
      var c = needCustomer ? str(row[map.customer]) : '';
      if (needCustomer && c === '') { r.noCustomer++; return; }
      var o = map.order ? str(row[map.order]) : '';
      used.push({ d: d, a: a, c: c, o: o !== '' ? o : '#' + idx });  // 沒有訂單號的列各算一筆
    });
    r.used = used.length;
    if (!used.length) {
      throw new Error('沒有任何可用的交易列。請確認「日期」「金額」欄位選對了；全部金額都是負數（退貨）也會被排除。');
    }
    var first = Infinity, last = -Infinity;
    used.forEach(function (u) { if (u.d < first) first = u.d; if (u.d > last) last = u.d; });
    r.firstDate = P.dayToISO(first);
    r.lastDate = P.dayToISO(last);
    return { report: r, used: used, firstD: first, lastD: last };
  }

  function sortedKeys(m) { return Array.from(m.keys()).sort(); }

  // 顧客彙總：一位顧客一列。
  P.txnToCustomer = function (rows, map, opt) {
    opt = opt || {};
    if (!map.customer) throw new Error('這份表需要「會員」欄位（顧客編號），請在欄位對應中指定。');
    var c = classify(rows, map, true);
    var asOf = opt.asOf != null ? opt.asOf : c.lastD;
    var g = new Map();
    c.used.forEach(function (u) {
      var x = g.get(u.c);
      if (!x) { x = { last: -Infinity, keys: new Set(), sum: 0 }; g.set(u.c, x); }
      if (u.d > x.last) x.last = u.d;
      x.keys.add(u.o);
      x.sum += u.a;
    });
    var out = sortedKeys(g).map(function (k) {
      var x = g.get(k), cnt = x.keys.size;
      return {
        '顧客': k, '最近購買天數': asOf - x.last, '購買次數': cnt,
        '平均客單': round2(x.sum / cnt), '累積金額': round2(x.sum)
      };
    });
    var report = c.report;
    report.customers = out.length;
    report.asOf = P.dayToISO(asOf);
    return {
      table: { name: '顧客彙總', cols: ['顧客', '最近購買天數', '購買次數', '平均客單', '累積金額'], rows: out },
      report: report
    };
  };

  // 時間序列：一期一列。
  P.txnToSeries = function (rows, map, opt) {
    opt = opt || {};
    var period = opt.period || 'month';
    if (['month', 'week', 'day'].indexOf(period) < 0) throw new Error('期別只能是 month、week 或 day。');
    var dropPartial = opt.dropPartial !== false;
    var c = classify(rows, map, false);

    function monthIdx(d) { var t = new Date(d * DAY); return t.getUTCFullYear() * 12 + t.getUTCMonth(); }
    function monthStart(k) { return ymd(Math.floor(k / 12), (k % 12) + 1, 1); }
    function monthEnd(k) { var y = Math.floor(k / 12), m = (k % 12) + 1; return ymd(y, m, new Date(Date.UTC(y, m, 0)).getUTCDate()); }
    var keyOf, startOf, endOf, label, step;
    if (period === 'month') {
      keyOf = monthIdx; startOf = monthStart; endOf = monthEnd; step = 1;
      label = function (k) { var y = Math.floor(k / 12), m = (k % 12) + 1; return y + '-' + (m < 10 ? '0' : '') + m; };
    } else if (period === 'week') {
      keyOf = function (d) { return d - ((((d + 3) % 7) + 7) % 7); };  // 星期一
      startOf = function (k) { return k; }; endOf = function (k) { return k + 6; }; step = 7;
      label = P.dayToISO;
    } else {
      keyOf = function (d) { return d; }; startOf = keyOf; endOf = keyOf; step = 1;
      label = P.dayToISO;
    }

    var kFirst = keyOf(c.firstD), kLast = keyOf(c.lastD), keys = [], k;
    for (k = kFirst; k <= kLast; k += step) keys.push(k);

    var agg = new Map();
    c.used.forEach(function (u) {
      var key = keyOf(u.d), x = agg.get(key);
      if (!x) { x = { sum: 0, keys: new Set() }; agg.set(key, x); }
      x.sum += u.a;
      x.keys.add(u.o);
    });

    var dropFirst = dropPartial && c.firstD !== startOf(kFirst);
    var dropLast = dropPartial && c.lastD !== endOf(kLast);
    var dropped = [], kept = [];
    keys.forEach(function (key, i) {
      if ((dropFirst && i === 0) || (dropLast && i === keys.length - 1)) dropped.push(key);
      else kept.push(key);
    });
    if (kept.length < 2) throw new Error('扣掉不完整的期別後，只剩 ' + kept.length + ' 期，無法做時間序列。請提供至少跨兩個完整期別的資料。');

    var filled = 0;
    var out = kept.map(function (key) {
      var x = agg.get(key);
      if (!x) filled++;
      return { '期別': label(key), '營收': x ? round2(x.sum) : 0, '交易筆數': x ? x.keys.size : 0 };
    });
    var report = c.report;
    report.periods = out.length;
    report.filledZero = filled;
    report.droppedPartial = dropped.map(label);
    return {
      table: { name: '期別彙總', cols: ['期別', '營收', '交易筆數'], rows: out },
      report: report
    };
  };

  // 有答案的顧客表：用截止日以前的行為，預測截止日之後 windowDays 天內會不會回來。
  P.txnToLabeled = function (rows, map, opt) {
    opt = opt || {};
    if (!map.customer) throw new Error('這份表需要「會員」欄位（顧客編號），請在欄位對應中指定。');
    var W = opt.windowDays != null ? opt.windowDays : 90;
    var c = classify(rows, map, true);
    var cutoff = opt.cutoff != null ? opt.cutoff : c.lastD - W;
    if (c.lastD < cutoff + W) {
      throw new Error('觀察期不夠長：資料只到 ' + P.dayToISO(c.lastD) + '，要看截止日後 ' + W + ' 天，需要資料到 ' +
        P.dayToISO(cutoff + W) + '。請把截止日提前，或把觀察天數縮短。');
    }
    var feat = new Map(), back = new Set();
    c.used.forEach(function (u) {
      if (u.d <= cutoff) {
        var x = feat.get(u.c);
        if (!x) { x = { last: -Infinity, keys: new Set(), sum: 0 }; feat.set(u.c, x); }
        if (u.d > x.last) x.last = u.d;
        x.keys.add(u.o);
        x.sum += u.a;
      } else if (u.d <= cutoff + W) {
        back.add(u.c);
      }
    });
    var out = sortedKeys(feat).map(function (k) {
      var x = feat.get(k), cnt = x.keys.size;
      return {
        '顧客': k, '最近購買天數': cutoff - x.last, '購買次數': cnt,
        '平均客單': round2(x.sum / cnt), '之後回購': back.has(k) ? 1 : 0
      };
    });
    if (!out.length) throw new Error('截止日（' + P.dayToISO(cutoff) + '）之前沒有可用的顧客交易，請檢查截止日或資料期間。');
    var report = c.report;
    report.customers = out.length;
    report.cutoff = P.dayToISO(cutoff);
    report.windowDays = W;
    report.positives = out.filter(function (r) { return r['之後回購'] === 1; }).length;
    return {
      table: { name: '有答案的顧客表', cols: ['顧客', '最近購買天數', '購買次數', '平均客單', '之後回購'], rows: out },
      report: report
    };
  };

  if (typeof module !== 'undefined') module.exports = ML;
})();
