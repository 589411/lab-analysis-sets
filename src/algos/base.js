// 共用數學工具。瀏覽器掛在 window.ML，Node 掛在 module.exports。
(function () {
  'use strict';
  var ML = (typeof window !== 'undefined') ? (window.ML = window.ML || {}) : module.exports;

  // 可重現的亂數（mulberry32）。同一個 seed 永遠得到同一串數字。
  ML.rng = function (seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  ML.sum = function (a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s; };
  ML.mean = function (a) { return a.length ? ML.sum(a) / a.length : NaN; };
  // 母體標準差（除以 n），與 scikit-learn StandardScaler 相同
  ML.std = function (a) {
    var m = ML.mean(a), s = 0;
    for (var i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m);
    return Math.sqrt(s / a.length);
  };
  ML.median = function (a) {
    var b = a.slice().sort(function (x, y) { return x - y; }), n = b.length;
    return n ? (n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2) : NaN;
  };
  ML.column = function (X, j) { return X.map(function (r) { return r[j]; }); };
  // 標準化：每欄減平均、除以標準差。標準差為 0 的欄位除以 1。
  ML.standardize = function (X, mean, std) {
    var p = X[0].length, j;
    if (!mean) { mean = []; std = []; for (j = 0; j < p; j++) { var c = ML.column(X, j); mean.push(ML.mean(c)); std.push(ML.std(c) || 1); } }
    var Z = X.map(function (r) { return r.map(function (v, k) { return (v - mean[k]) / std[k]; }); });
    return { Z: Z, mean: mean, std: std };
  };
  // 固定切法：每 5 列的第 5 列（索引 i % 5 === 4）當測試，其餘訓練。任何工具都能重現。
  ML.splitIdx = function (n) {
    var train = [], test = [];
    for (var i = 0; i < n; i++) (i % 5 === 4 ? test : train).push(i);
    return { train: train, test: test };
  };
  ML.take = function (a, idx) { return idx.map(function (i) { return a[i]; }); };
  ML.dist2 = function (a, b) { var s = 0; for (var i = 0; i < a.length; i++) { var d = a[i] - b[i]; s += d * d; } return s; };
  // 解線性方程組 A x = b（高斯消去、部分選主元）。A 會被複製，不改原陣列。
  ML.solve = function (A, b) {
    var n = A.length, M = A.map(function (r, i) { return r.concat([b[i]]); }), i, j, k;
    for (i = 0; i < n; i++) {
      var p = i;
      for (j = i + 1; j < n; j++) if (Math.abs(M[j][i]) > Math.abs(M[p][i])) p = j;
      if (Math.abs(M[p][i]) < 1e-12) throw new Error('欄位之間幾乎完全相關（或某欄全部相同），無法計算。請拿掉重複的欄位。');
      var t = M[i]; M[i] = M[p]; M[p] = t;
      for (j = i + 1; j < n; j++) {
        var f = M[j][i] / M[i][i];
        for (k = i; k <= n; k++) M[j][k] -= f * M[i][k];
      }
    }
    var x = new Array(n);
    for (i = n - 1; i >= 0; i--) {
      var s = M[i][n];
      for (j = i + 1; j < n; j++) s -= M[i][j] * x[j];
      x[i] = s / M[i][i];
    }
    return x;
  };
  // 最小平方法（含截距）。X: n×p 矩陣，y: 長度 n。回傳 {intercept, coef[]}
  ML.ols = function (X, y) {
    var n = X.length, p = X[0].length, q = p + 1, i, j, k;
    var A = [], b = [];
    for (j = 0; j < q; j++) { A.push(new Array(q).fill(0)); b.push(0); }
    for (i = 0; i < n; i++) {
      var r = [1].concat(X[i]);
      for (j = 0; j < q; j++) { b[j] += r[j] * y[i]; for (k = 0; k < q; k++) A[j][k] += r[j] * r[k]; }
    }
    var w = ML.solve(A, b);
    return { intercept: w[0], coef: w.slice(1) };
  };
  ML.predictLinear = function (model, X) {
    return X.map(function (r) { var s = model.intercept; for (var j = 0; j < r.length; j++) s += model.coef[j] * r[j]; return s; });
  };
  ML.r2 = function (y, yhat) {
    var m = ML.mean(y), ssr = 0, sst = 0;
    for (var i = 0; i < y.length; i++) { ssr += (y[i] - yhat[i]) * (y[i] - yhat[i]); sst += (y[i] - m) * (y[i] - m); }
    return sst === 0 ? NaN : 1 - ssr / sst;
  };
  ML.rmse = function (y, yhat) { var s = 0; for (var i = 0; i < y.length; i++) s += (y[i] - yhat[i]) * (y[i] - yhat[i]); return Math.sqrt(s / y.length); };
  ML.mae = function (y, yhat) { var s = 0; for (var i = 0; i < y.length; i++) s += Math.abs(y[i] - yhat[i]); return s / y.length; };
  // 平均絕對百分比誤差（回傳比例，0.1 = 10%）。實際值為 0 的點略過。
  ML.mape = function (y, yhat) { var s = 0, c = 0; for (var i = 0; i < y.length; i++) if (y[i] !== 0) { s += Math.abs((y[i] - yhat[i]) / y[i]); c++; } return c ? s / c : NaN; };
  ML.pearson = function (a, b) {
    var ma = ML.mean(a), mb = ML.mean(b), sab = 0, saa = 0, sbb = 0;
    for (var i = 0; i < a.length; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) * (a[i] - ma); sbb += (b[i] - mb) * (b[i] - mb); }
    return sab / Math.sqrt(saa * sbb);
  };
  // 簡單線性回歸：一個 x 預測 y
  ML.simpleLinear = function (x, y) {
    var m = ML.ols(x.map(function (v) { return [v]; }), y);
    return { intercept: m.intercept, slope: m.coef[0] };
  };
})();
