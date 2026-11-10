// 資料準備核對：用 tests/prep_expected.py（pandas 獨立重算＋手寫對照表）的結果，逐項比對 src/algos/prep.js。
// 用法：node tests/prep.test.js   （有 FAIL 會以 exit code 1 結束）
'use strict';
var ML = require('../src/algos/prep.js');
var P = ML.prep;
var E = require('./prep_expected.json');
var TXN = require('../data/fixture_txn_messy.json').txn;
var TOL = 0.005;
var MAP = { date: '交易日期', customer: '會員編號', amount: '實收金額', order: '交易編號' };

var sections = [], cur = null;
function begin(title) { cur = { title: title, pass: 0, fail: 0 }; sections.push(cur); console.log('\n== ' + title); }
// 一項一行；bulk=true 時通過的項目不逐行印，只計數（每位顧客、每期那種大量項目）
function check(ok, label, detail, bulk) {
  if (ok) cur.pass++; else cur.fail++;
  if (!ok) console.log('FAIL  ' + label + (detail ? '   ' + detail : ''));
  else if (!bulk) console.log('PASS  ' + label);
}
function near(got, want) { return typeof got === 'number' && typeof want === 'number' && Math.abs(got - want) <= TOL; }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// ---------- 1. num ----------
begin('num（金額，' + E.num.length + ' 項）');
E.num.forEach(function (pair) {
  var inp = pair[0], want = pair[1], got = P.num(inp);
  var ok = want === null ? isNaN(got) : (!isNaN(got) && Math.abs(got - want) < 1e-12);
  check(ok, 'num(' + JSON.stringify(inp) + ') = ' + (want === null ? 'NaN' : want), 'got=' + got);
});

// ---------- 2. parseDate ----------
begin('parseDate（日期，' + E.parseDate.length + ' 項，含應為 NaN 的）');
E.parseDate.forEach(function (pair) {
  var inp = pair[0], want = pair[1], n = P.parseDate(inp);
  var iso = isNaN(n) ? null : P.dayToISO(n);
  check(iso === want, 'parseDate(' + JSON.stringify(inp) + ') = ' + want, 'got=' + iso);
});

// ---------- 3. profile ----------
begin('profile（示範交易明細，每欄 7 個欄位）');
var prof = P.profile(TXN);
E.profile.forEach(function (want) {
  var got = prof.filter(function (p) { return p.col === want.col; })[0] || {};
  var bad = ['kind', 'n', 'missing', 'unique', 'idLike', 'sample'].filter(function (k) {
    return !same(got[k], want[k]);
  });
  check(bad.length === 0, want.col + '：kind=' + want.kind + ' n=' + want.n + ' missing=' + want.missing +
    ' unique=' + want.unique + ' idLike=' + want.idLike, bad.length ? '不一致欄位：' + bad.join(',') + ' got=' + JSON.stringify(got) : '');
});

// ---------- 4. guessMapping ----------
begin('guessMapping');
var guess = P.guessMapping(prof);
['date', 'customer', 'amount', 'order'].forEach(function (k) {
  check(guess[k] === MAP[k], k + ' = ' + MAP[k], 'got=' + guess[k]);
});

// ---------- 5. txnToCustomer ----------
begin('txnToCustomer（顧客彙總）');
var cres = P.txnToCustomer(TXN.rows, guess);
var cr = cres.report, ce = E.customer.report;
['total', 'used', 'badDate', 'badAmount', 'nonPositive', 'noCustomer', 'customers', 'firstDate', 'lastDate', 'asOf'].forEach(function (k) {
  check(same(cr[k], ce[k]), 'report.' + k + ' = ' + JSON.stringify(ce[k]), 'got=' + JSON.stringify(cr[k]));
});
check(cr.total === cr.used + cr.badDate + cr.badAmount + cr.nonPositive + cr.noCustomer,
  'report.total = 各類加總', 'total=' + cr.total);
check(cres.table.rows.length === E.customer.rows.length, '顧客數 = ' + E.customer.rows.length,
  'got=' + cres.table.rows.length);
var badC = 0, firstBad = '';
E.customer.rows.forEach(function (w, i) {
  var g = cres.table.rows[i] || {};
  var ok = g['顧客'] === w['顧客'] && g['最近購買天數'] === w['最近購買天數'] && g['購買次數'] === w['購買次數'] &&
    near(g['平均客單'], w['平均客單']) && near(g['累積金額'], w['累積金額']);
  if (!ok) { badC++; if (!firstBad) firstBad = w['顧客'] + ' got=' + JSON.stringify(g) + ' want=' + JSON.stringify(w); }
});
check(badC === 0, '每位顧客的 最近購買天數／購買次數／平均客單／累積金額（' + E.customer.rows.length + ' 位 × 4 欄）全部一致',
  badC ? badC + ' 位不一致，例：' + firstBad : '');

// ---------- 6. txnToSeries ----------
begin('txnToSeries（month／week／day × dropPartial 真／假）');
var sr = P.txnToSeries(TXN.rows, guess, { period: 'month' }).report;
['total', 'used', 'badDate', 'badAmount', 'nonPositive', 'noCustomer'].forEach(function (k) {
  check(sr[k] === E.series_report[k], 'series report.' + k + ' = ' + E.series_report[k], 'got=' + sr[k]);
});
['month', 'week', 'day'].forEach(function (period) {
  [true, false].forEach(function (drop) {
    var key = period + (drop ? '_drop' : '_keep'), want = E.series[key];
    var res = P.txnToSeries(TXN.rows, guess, { period: period, dropPartial: drop });
    var rows = res.table.rows, rp = res.report;
    check(same(rows.map(function (r) { return r['期別']; }), want.labels),
      key + '：期別標籤序列一致（' + want.labels.length + ' 期）',
      'got=' + JSON.stringify(rows.map(function (r) { return r['期別']; }).slice(0, 4)) + '…');
    var badRev = 0, badCnt = 0, fr = '';
    want.labels.forEach(function (_, i) {
      if (!rows[i] || !near(rows[i]['營收'], want.rev[i])) { badRev++; if (!fr) fr = 'rev@' + i; }
      if (!rows[i] || rows[i]['交易筆數'] !== want.cnt[i]) { badCnt++; if (!fr) fr = 'cnt@' + i; }
    });
    check(badRev === 0, key + '：每期營收一致', badRev + ' 期不一致 ' + fr, true);
    check(badCnt === 0, key + '：每期交易筆數一致', badCnt + ' 期不一致 ' + fr, true);
    check(rp.periods === want.periods, key + '：periods = ' + want.periods, 'got=' + rp.periods);
    check(rp.filledZero === want.filledZero, key + '：filledZero = ' + want.filledZero, 'got=' + rp.filledZero);
    check(same(rp.droppedPartial, want.droppedPartial), key + '：droppedPartial = ' + JSON.stringify(want.droppedPartial),
      'got=' + JSON.stringify(rp.droppedPartial));
  });
});

// ---------- 7. txnToLabeled ----------
begin('txnToLabeled（有答案的顧客表）');
[90, 60].forEach(function (W) {
  var want = E.labeled['w' + W];
  var res = P.txnToLabeled(TXN.rows, guess, { windowDays: W });
  var rp = res.report;
  check(rp.cutoff === want.cutoff, 'windowDays=' + W + '：cutoff = ' + want.cutoff, 'got=' + rp.cutoff);
  check(rp.customers === want.customers, 'windowDays=' + W + '：顧客數 = ' + want.customers, 'got=' + rp.customers);
  check(rp.positives === want.positives, 'windowDays=' + W + '：positives = ' + want.positives, 'got=' + rp.positives);
  check(rp.windowDays === W, 'windowDays=' + W + '：report.windowDays 一致', 'got=' + rp.windowDays);
  var bad = 0, fb = '';
  want.rows.forEach(function (w, i) {
    var g = res.table.rows[i] || {};
    var ok = g['顧客'] === w['顧客'] && g['最近購買天數'] === w['最近購買天數'] && g['購買次數'] === w['購買次數'] &&
      near(g['平均客單'], w['平均客單']) && g['之後回購'] === w['之後回購'];
    if (!ok) { bad++; if (!fb) fb = w['顧客'] + ' got=' + JSON.stringify(g) + ' want=' + JSON.stringify(w); }
  });
  check(res.table.rows.length === want.rows.length, 'windowDays=' + W + '：列數一致', 'got=' + res.table.rows.length);
  check(bad === 0, 'windowDays=' + W + '：每位顧客的 3 個特徵、平均客單、標籤全部一致（' + want.rows.length + ' 位）',
    bad ? bad + ' 位不一致，例：' + fb : '');
});

// ---------- 8. 同一訂單拆成多列（相異訂單數） ----------
begin('相異訂單數（手寫小資料）');
// 訂單 O1 拆成兩列；A 有 O1、O2；B 只有 O3（拆成兩列）
var OR = [
  { '日期': '2026/1/5', '會員': 'A', '金額': '100', '單號': 'O1' },
  { '日期': '2026/1/5', '會員': 'A', '金額': '200', '單號': 'O1' },
  { '日期': '2026/1/6', '會員': 'A', '金額': '300', '單號': 'O2' },
  { '日期': '2026/1/6', '會員': 'B', '金額': '50', '單號': 'O3' },
  { '日期': '2026/1/7', '會員': 'B', '金額': '50', '單號': 'O3' }
];
var OM = { date: '日期', customer: '會員', amount: '金額', order: '單號' };
var OM0 = { date: '日期', customer: '會員', amount: '金額' };
var oc = P.txnToCustomer(OR, OM).table.rows;
var A = oc.filter(function (r) { return r['顧客'] === 'A'; })[0], B = oc.filter(function (r) { return r['顧客'] === 'B'; })[0];
check(A && A['購買次數'] === 2 && near(A['累積金額'], 600) && near(A['平均客單'], 300) && A['最近購買天數'] === 1,
  '有訂單號：A 購買次數 2（O1 拆兩列只算一次）、累積 600、客單 300、最近 1 天', JSON.stringify(A));
check(B && B['購買次數'] === 1 && near(B['累積金額'], 100) && near(B['平均客單'], 100) && B['最近購買天數'] === 0,
  '有訂單號：B 購買次數 1、累積 100、客單 100、最近 0 天', JSON.stringify(B));
var oc0 = P.txnToCustomer(OR, OM0).table.rows;
var A0 = oc0.filter(function (r) { return r['顧客'] === 'A'; })[0];
check(A0 && A0['購買次數'] === 3 && near(A0['平均客單'], 200), '沒有訂單號欄：A 購買次數算列數 3、客單 200', JSON.stringify(A0));
var os = P.txnToSeries(OR, OM, { period: 'day' }).table.rows;
check(same(os.map(function (r) { return r['交易筆數']; }), [1, 2, 1]) &&
  same(os.map(function (r) { return r['營收']; }), [300, 350, 50]),
  '有訂單號的日序列：每日筆數 [1,2,1]、營收 [300,350,50]', JSON.stringify(os));

// ---------- 9. 錯誤情況 ----------
begin('錯誤情況');
var threw1 = false, msg1 = '';
try { P.txnToCustomer([{ '日期': '2026/1/5', '會員': 'A', '金額': '-100' }, { '日期': '2026/1/6', '會員': 'B', '金額': '-50' }], OM); }
catch (e) { threw1 = true; msg1 = e.message; }
check(threw1, '全部金額都是負數時丟錯誤', msg1);
var lastD = P.parseDate('2026-10-20');
var threw2 = false, msg2 = '';
try { P.txnToLabeled(TXN.rows, guess, { windowDays: 90, cutoff: lastD - 10 }); }
catch (e) { threw2 = true; msg2 = e.message; }
check(threw2, '觀察期不夠長時 txnToLabeled 丟錯誤', msg2);

// ---------- 10. 界定範圍（applyScope）：fixture，pandas 對照 ----------
var SCOPE_RULES = {
  in_store: [{ col: '門市', op: 'in', values: ['林口店', '士林店'] }],
  date_range: [{ col: '交易日期', op: 'dateRange', from: '2025-06-01', to: '2026-03-31' }],
  num_range: [{ col: '實收金額', op: 'numRange', min: 1000, max: 3000 }],
  combined_store_date_num: [
    { col: '門市', op: 'in', values: ['林口店', '士林店'] },
    { col: '交易日期', op: 'dateRange', from: '2025-06-01', to: '2026-03-31' },
    { col: '實收金額', op: 'numRange', min: 1000, max: 3000 }
  ],
  combined_num_date_store: [
    { col: '實收金額', op: 'numRange', min: 1000, max: 3000 },
    { col: '交易日期', op: 'dateRange', from: '2025-06-01', to: '2026-03-31' },
    { col: '門市', op: 'in', values: ['林口店', '士林店'] }
  ]
};
begin('界定範圍 applyScope（fixture_txn_messy，對 pandas，' + Object.keys(SCOPE_RULES).length + ' 組規則）');
Object.keys(SCOPE_RULES).forEach(function (name) {
  var want = E.scope[name], rules = SCOPE_RULES[name];
  var got = P.applyScope(TXN.rows, rules);
  check(got.out === want.out, name + '：排除列數 = ' + want.out, 'got=' + got.out);
  check(got.rows.length === want.kept, name + '：留下列數 = ' + want.kept, 'got=' + got.rows.length);
  check(got.out + got.rows.length === TXN.rows.length, name + '：留下＋排除 = 原始列數');
  check(same(got.perRule, want.perRule), name + '：perRule = ' + JSON.stringify(want.perRule), 'got=' + JSON.stringify(got.perRule));
  check(got.perRule.reduce(function (a, b) { return a + b; }, 0) === got.out, name + '：perRule 加總 = out');
  // 留下的列再交給 txnToCustomer，歸類結果要和 pandas 一致（badDate、badAmount 這兩類一定要留下來算）
  var rp = P.txnToCustomer(got.rows, guess).report, wr = want.report;
  ['total', 'used', 'badDate', 'badAmount', 'nonPositive', 'noCustomer'].forEach(function (k) {
    check(rp[k] === wr[k], name + '：留下的列 report.' + k + ' = ' + wr[k], 'got=' + rp[k]);
  });
  check(rp.badDate === wr.badDate && wr.badDate >= 0, name + '：日期看不懂的列有留下（report.badDate 與 pandas 相同）');
});
// 留下的原物件、原順序
var keepStore = P.applyScope(TXN.rows, SCOPE_RULES.in_store).rows;
check(keepStore[0] === TXN.rows.filter(function (r) { return ['林口店', '士林店'].indexOf(r['門市']) >= 0; })[0],
  '留下的列是原物件、順序不變');
var noRules = P.applyScope(TXN.rows, null);
check(noRules.rows.length === TXN.rows.length && noRules.out === 0 && noRules.perRule.length === 0 && noRules.rows[0] === TXN.rows[0],
  'rules 為 null：全部留下、out=0、原物件');
var threwCol = false, msgCol = '';
try { P.applyScope(TXN.rows, [{ col: '不存在的欄', op: 'in', values: ['x'] }]); }
catch (e) { threwCol = true; msgCol = e.message; }
check(threwCol && msgCol.indexOf('不在這份資料裡') >= 0, 'col 不存在時丟白話錯誤', msgCol);

// ---------- 11. 驗收數字：示範明細 demo_txn（8,000 列，channel in [store]） ----------
// 期望值在 test.js 內另外寫死一次，和 pandas 的結果（E.acceptance）雙重核對。
var DEMO_RAW = require('../data/demo_txn.json').txn;
var DEMO_ROWS = DEMO_RAW.aoa.map(function (r) {
  var o = {}; DEMO_RAW.cols.forEach(function (c, j) { o[c] = r[j]; }); return o;
});
var HARD = { total: 8000, out: 507, kept: 7493, nonPositive: 114, noCustomer: 1704, used: 5675, badDate: 0, series_used: 7379 };
begin('驗收數字：示範明細（寫死的值 ＋ pandas 對照）');
check(DEMO_ROWS.length === HARD.total, '示範明細共 ' + HARD.total + ' 列', 'got=' + DEMO_ROWS.length);
var acc = P.applyScope(DEMO_ROWS, [{ col: 'channel', op: 'in', values: ['store'] }]);
check(acc.out === HARD.out, '規則 channel in [store]：排除 ' + HARD.out + ' 列', 'got=' + acc.out);
check(acc.rows.length === HARD.kept, '規則 channel in [store]：留下 ' + HARD.kept + ' 列', 'got=' + acc.rows.length);
check(acc.out === E.acceptance.rule_out && acc.rows.length === E.acceptance.kept, '排除與留下列數與 pandas 相同');
var accCust = P.txnToCustomer(acc.rows, { date: 'txn_datetime', customer: 'member_id', amount: 'total_amount' }).report;
check(accCust.nonPositive === HARD.nonPositive, '金額 ≤ 0：' + HARD.nonPositive + ' 列', 'got=' + accCust.nonPositive);
check(accCust.noCustomer === HARD.noCustomer, '沒有顧客編號：' + HARD.noCustomer + ' 列', 'got=' + accCust.noCustomer);
check(accCust.used === HARD.used, '用來計算（txnToCustomer）：' + HARD.used + ' 列', 'got=' + accCust.used);
check(accCust.badDate === HARD.badDate, '日期看不懂：' + HARD.badDate + ' 列', 'got=' + accCust.badDate);
var accSer = P.txnToSeries(acc.rows, { date: 'txn_datetime', amount: 'total_amount' }, { period: 'month' }).report;
check(accSer.used === HARD.series_used, '用來計算（txnToSeries，月）：' + HARD.series_used + ' 列', 'got=' + accSer.used);
check(HARD.total === HARD.out + HARD.used + HARD.nonPositive + HARD.noCustomer,
  '等式：8,000 ＝ 507 ＋ 5,675 ＋ 114 ＋ 1,704（寫死的值）');
check(accCust.total === HARD.kept && HARD.total === acc.out + accCust.used + accCust.nonPositive + accCust.noCustomer + accCust.badDate + accCust.badAmount,
  '等式（JS 實算）：原始 ＝ 不在範圍 ＋ 各類歸類');
check(accCust.nonPositive === E.acceptance.nonPositive && accCust.noCustomer === E.acceptance.noCustomer &&
  accCust.used === E.acceptance.used && accCust.badDate === E.acceptance.badDate && accSer.used === E.acceptance.series_used,
  '驗收數字與 pandas（prep_expected.json）完全相同');

// ---------- 總結 ----------
var tp = 0, tf = 0;
console.log('\n== 總計');
sections.forEach(function (s) {
  tp += s.pass; tf += s.fail;
  console.log((s.fail ? 'FAIL ' : 'PASS ') + s.title + '：PASS ' + s.pass + '、FAIL ' + s.fail);
});
console.log('\n合計 PASS ' + tp + '、FAIL ' + tf);
process.exit(tf ? 1 : 0);
