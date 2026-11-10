// 回歸類的演算法：多元線性回歸、多項式回歸。純函式，不碰 DOM，不用亂數。
(function () {
  'use strict';
  var ML = (typeof window !== 'undefined') ? window.ML : require('./base.js');

  // 多元線性回歸。X: n×p（原始單位），y: 長度 n。
  // coef / intercept：原始單位。X 的某欄每多 1，y 平均變動 coef[j]。
  // stdCoef：先把每欄標準化（減平均、除標準差）再 ols。意思是某欄每多一個標準差，y 平均變動多少。用來比誰影響大。
  ML.multiFit = function (X, y) {
    if (!X.length || !X[0].length) throw new Error('沒有可用的原因欄位。');
    var raw = ML.ols(X, y);
    var S = ML.standardize(X);
    var sc = ML.ols(S.Z, y);
    return { intercept: raw.intercept, coef: raw.coef, stdCoef: sc.coef, mean: S.mean, std: S.std };
  };

  // 多項式回歸。x: 長度 n，y: 長度 n，degree: 1 到 6。
  // 先用訓練 x 的平均與標準差標準化（z），再放入 z、z²、…、z^degree，用 ols 配出曲線。
  ML.polyFit = function (x, y, degree) {
    var d = Math.round(degree), mu = ML.mean(x), sd = ML.std(x) || 1;
    if (!(d >= 1)) throw new Error('曲線的次方至少要是 1。');
    var feats = function (xs) {
      return xs.map(function (v) {
        var z = (v - mu) / sd, row = [], p = 1;
        for (var k = 1; k <= d; k++) { p *= z; row.push(p); }
        return row;
      });
    };
    var m = ML.ols(feats(x), y);
    return {
      predict: function (xs) { return ML.predictLinear(m, feats(xs)); },
      degree: d, coef: m.coef, intercept: m.intercept, mean: mu, std: sd
    };
  };

  if (typeof module !== 'undefined') module.exports = ML;
})();
