// 回歸類核對：用和 regress_expected.py 相同的清理與切法，逐項比對 scikit-learn 的期望值。
// 用法：node tests/regress.test.js  （有 FAIL 會以 exit code 1 結束）
'use strict';
var ML = require('../src/algos/regress.js');
var E = require('./regress_expected.json');
var rows = require('../data/demo.json').daily.rows;

var TOL = 1e-8, TOL_POLY = 1e-6;
var count = 0, fails = 0;

function rel(got, want) { return Math.abs(got - want) / Math.max(Math.abs(want), 1e-12); }
function check(name, got, want, tol) {
  count++;
  var r = rel(got, want), ok = isFinite(got) && r <= tol;
  if (!ok) fails++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + '  期望 ' + want + '，實際 ' + got + '，相對誤差 ' + r.toExponential(2));
}
function checkText(name, got, want) {
  count++;
  var ok = got === want;
  if (!ok) fails++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + '  期望 ' + want + '，實際 ' + got);
}
// 只刪「這個測試用到的欄位」有空字串的列
function clean(cols) {
  return rows.filter(function (r) { return cols.every(function (c) { return r[c] !== ''; }); });
}

// 1) 簡單線性回歸（範例套餐的 ML.simpleLinear）：廣告費 -> 營收
(function () {
  console.log('\n[1] 簡單線性回歸：廣告費 -> 營收');
  var rs = clean(['廣告費', '營收']), sp = ML.splitIdx(rs.length);
  var x = rs.map(function (r) { return r['廣告費']; }), y = rs.map(function (r) { return r['營收']; });
  var xtr = ML.take(x, sp.train), ytr = ML.take(y, sp.train), xte = ML.take(x, sp.test), yte = ML.take(y, sp.test);
  var m = ML.simpleLinear(xtr, ytr);
  var pred = function (v) { return m.intercept + m.slope * v; };
  checkText('訓練列數', String(sp.train.length), String(E.linear.n_train));
  checkText('考題列數', String(sp.test.length), String(E.linear.n_test));
  check('斜率', m.slope, E.linear.slope, TOL);
  check('截距', m.intercept, E.linear.intercept, TOL);
  check('訓練 R²', ML.r2(ytr, xtr.map(pred)), E.linear.r2_train, TOL);
  check('考題 R²', ML.r2(yte, xte.map(pred)), E.linear.r2_test, TOL);
  check('考題 RMSE', ML.rmse(yte, xte.map(pred)), E.linear.rmse_test, TOL);
})();

// 2) 多元線性回歸：廣告費、氣溫、假日 -> 營收
(function () {
  console.log('\n[2] 多元線性回歸：廣告費、氣溫、假日 -> 營收');
  var names = ['廣告費', '氣溫', '假日'];
  var rs = clean(names.concat(['營收'])), sp = ML.splitIdx(rs.length);
  var X = rs.map(function (r) { return names.map(function (c) { return r[c]; }); });
  var y = rs.map(function (r) { return r['營收']; });
  var Xtr = ML.take(X, sp.train), ytr = ML.take(y, sp.train), Xte = ML.take(X, sp.test), yte = ML.take(y, sp.test);
  var m = ML.multiFit(Xtr, ytr);
  names.forEach(function (c, j) { check('原始係數 ' + c, m.coef[j], E.multi.coef[j], TOL); });
  check('截距', m.intercept, E.multi.intercept, TOL);
  names.forEach(function (c, j) { check('標準化係數 ' + c, m.stdCoef[j], E.multi.std_coef[j], TOL); });
  var pte = ML.predictLinear(m, Xte);
  check('考題 R²', ML.r2(yte, pte), E.multi.r2_test, TOL);
  check('考題 RMSE', ML.rmse(yte, pte), E.multi.rmse_test, TOL);
  var topIdx = 0;
  m.stdCoef.forEach(function (v, j) { if (Math.abs(v) > Math.abs(m.stdCoef[topIdx])) topIdx = j; });
  checkText('影響最大的欄位', names[topIdx], E.multi.top);
})();

// 3) 多項式回歸：折扣率 -> 毛利，次方 1 到 6
(function () {
  console.log('\n[3] 多項式回歸：折扣率 -> 毛利（次方 1 到 6）');
  var rs = clean(['折扣率', '毛利']), sp = ML.splitIdx(rs.length);
  var x = rs.map(function (r) { return r['折扣率']; }), y = rs.map(function (r) { return r['毛利']; });
  var xtr = ML.take(x, sp.train), ytr = ML.take(y, sp.train), xte = ML.take(x, sp.test), yte = ML.take(y, sp.test);
  var lo = Infinity, hi = -Infinity;
  x.forEach(function (v) { if (v < lo) lo = v; if (v > hi) hi = v; });
  checkText('訓練列數', String(sp.train.length), String(E.poly.n_train));
  checkText('考題列數', String(sp.test.length), String(E.poly.n_test));
  for (var d = 1; d <= 6; d++) {
    var want = E.poly.by_degree[String(d)];
    var fit = ML.polyFit(xtr, ytr, d);
    var pte = fit.predict(xte);
    var worst = 0, worstI = -1;
    pte.forEach(function (p, i) { var r = rel(p, want.pred_test[i]); if (r > worst) { worst = r; worstI = i; } });
    count++;
    var okPts = worst <= TOL_POLY && pte.length === want.pred_test.length;
    if (!okPts) fails++;
    console.log((okPts ? 'PASS' : 'FAIL') + '  次方 ' + d + '：考題 ' + pte.length + ' 點預測值，最大相對誤差 ' + worst.toExponential(2) + '（第 ' + (worstI + 1) + ' 點）');
    check('次方 ' + d + ' 考題 RMSE', ML.rmse(yte, pte), want.rmse_test, TOL_POLY);
    check('次方 ' + d + ' 訓練 RMSE', ML.rmse(ytr, fit.predict(xtr)), want.rmse_train, TOL_POLY);
    check('次方 ' + d + ' 考題 R²', ML.r2(yte, pte), want.r2_test, TOL_POLY);
    // 和 set 內一樣的 100 點網格找最高點
    var gx = [], i, best = 0;
    for (i = 0; i < 100; i++) gx.push(lo + (hi - lo) * i / 99);
    var gy = fit.predict(gx);
    for (i = 1; i < 100; i++) if (gy[i] > gy[best]) best = i;
    check('次方 ' + d + ' 曲線最高點的 X', gx[best], want.peak_x, TOL_POLY);
  }
})();

console.log('\n共 ' + count + ' 項，FAIL ' + fails + ' 項');
if (fails) process.exit(1);
