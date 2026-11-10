// 預測套餐核對：拿 tests/forecast_expected.json（由 forecast_expected.py 產生）逐項比對。
// 用法：node tests/forecast.test.js
'use strict';
var path = require('path');
var ML = require(path.join(__dirname, '..', 'src', 'algos', 'forecast.js'));
var exp = require(path.join(__dirname, 'forecast_expected.json'));
var demo = require(path.join(__dirname, '..', 'data', 'demo.json'));

var rows = demo.monthly.rows;
var y = rows.map(function (r) { return Number(r['營收']); });
var n = y.length, H = n < 24 ? Math.max(3, Math.floor(n / 4)) : 6;
var train = y.slice(0, n - H), test = y.slice(n - H);

var fails = 0, checks = 0;
function relDiff(a, b) { return Math.abs(a - b) / Math.max(Math.abs(b), 1e-300); }
function check(name, got, want, tol) {
  checks++;
  var worst = 0;
  if (Array.isArray(want)) {
    if (got.length !== want.length) { console.log('FAIL', name, '長度不同', got.length, want.length); fails++; return; }
    for (var i = 0; i < want.length; i++) worst = Math.max(worst, relDiff(got[i], want[i]));
  } else {
    worst = relDiff(got, want);
  }
  var ok = worst <= tol;
  if (!ok) fails++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + '  最大相對差 ' + worst.toExponential(2) + '（容許 ' + tol + '）');
}

console.log('資料：monthly 營收，n=' + n + '，H=' + H + '，訓練 ' + train.length + ' 期');
check('n 與訓練期數', [n, train.length], [exp.n, exp.ntrain], 0);

// 1) 季節天真法與移動平均
var sn = ML.seasonalNaive(train, H, 12);
check('季節天真法 m=12 的 6 個預測值', sn, exp.seasonal_naive_m12.forecast_train_backtest, 1e-12);
check('季節天真法 m=12 的考題 MAPE', ML.mape(test, sn), exp.seasonal_naive_m12.mape_test, 1e-12);
check('季節天真法 m=12 的未來預測（全部 n 期）', ML.seasonalNaive(y, H, 12), exp.seasonal_naive_m12.forecast_future, 1e-12);

var ma = ML.movingAverageForecast(train, H, 3);
check('移動平均 w=3 的 6 個預測值', ma, exp.moving_average_w3.forecast_train_backtest, 1e-12);
check('移動平均 w=3 的考題 MAPE', ML.mape(test, ma), exp.moving_average_w3.mape_test, 1e-12);

// 2) 霍爾特指數平滑：預測值與擬合值
[[0.3, 0.1], [0.8, 0.2]].forEach(function (ab) {
  var key = 'a' + ab[0] + '_b' + ab[1], e = exp.holt[key];
  var r = ML.holt(train, ab[0], ab[1], H);
  check('指數平滑 ' + key + ' 的 6 個預測值', r.forecast, e.forecast_train_backtest, 1e-8);
  check('指數平滑 ' + key + ' 的擬合值（30 期）', r.fitted, e.fitted_train, 1e-8);
  check('指數平滑 ' + key + ' 的考題 MAPE', ML.mape(test, r.forecast), e.mape_test, 1e-8);
  check('指數平滑 ' + key + ' 的未來預測（全部 n 期）', ML.holt(y, ab[0], ab[1], H).forecast, e.forecast_future_full, 1e-8);
});

// 3) 趨勢加季節（對照 scikit-learn LinearRegression，相同設計矩陣）
var ts = ML.trendSeason(train, 12, H), e3 = exp.trend_season_m12;
check('趨勢加季節 m=12 的 6 個預測值', ts.forecast, e3.forecast_train_backtest, 1e-8);
check('趨勢加季節 m=12 的斜率 slope', ts.slope, e3.slope, 1e-8);
check('趨勢加季節 m=12 的考題 MAPE', ML.mape(test, ts.forecast), e3.mape_test, 1e-8);
check('趨勢加季節 m=12 的全部資料斜率', ML.trendSeason(y, 12, H).slope, e3.slope_full, 1e-8);
check('趨勢加季節 m=12 的未來預測（全部 n 期）', ML.trendSeason(y, 12, H).forecast, e3.forecast_future_full, 1e-8);

console.log('\n共 ' + checks + ' 項，FAIL ' + fails + ' 項');
if (fails) process.exit(1);
