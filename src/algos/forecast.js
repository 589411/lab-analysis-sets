// 預測（時間序列）共用函式。純函式：不碰 DOM、不用亂數。
(function () {
  'use strict';
  var ML = (typeof window !== 'undefined') ? window.ML : require('./base.js');

  // 季節天真法：預測值＝一個季節長度以前的實際值，從訓練資料尾端往回取。
  // 第 h 期（h 從 0 起算）取 train[n - m + (h % m)]。訓練資料不足一個季節長度時，全部改用最後一個值。
  ML.seasonalNaive = function (train, H, m) {
    var n = train.length, out = [], h;
    if (!n) throw new Error('沒有訓練資料可以預測。');
    for (h = 0; h < H; h++) out.push(n < m ? train[n - 1] : train[n - m + (h % m)]);
    return out;
  };

  // 移動平均：預測值＝訓練資料最後 w 期的平均，H 期都相同。
  ML.movingAverageForecast = function (train, H, w) {
    var n = train.length, k = Math.min(w, n), out = [], h;
    if (!n) throw new Error('沒有訓練資料可以預測。');
    var avg = ML.mean(train.slice(n - k));
    for (h = 0; h < H; h++) out.push(avg);
    return out;
  };

  // 霍爾特指數平滑（有趨勢、沒有季節）。依序從 y[0] 起更新，fitted[t] 是更新前的一步預測。
  // 第 h 期預測 = level + h * trend（h 從 1 起算）。
  ML.holt = function (y, alpha, beta, H) {
    var n = y.length, level = y[0], trend = y[1] - y[0], fitted = [], t, prev, oldLevel;
    if (n < 2) throw new Error('指數平滑至少需要 2 期資料。');
    for (t = 0; t < n; t++) {
      prev = level + trend;
      fitted.push(prev);
      oldLevel = level;
      level = alpha * y[t] + (1 - alpha) * prev;
      trend = beta * (level - oldLevel) + (1 - beta) * trend;
    }
    var forecast = [];
    for (var h = 1; h <= H; h++) forecast.push(level + h * trend);
    return { fitted: fitted, forecast: forecast, level: level, trend: trend };
  };

  // 趨勢加季節：y = 截距 + 斜率 × t + 季節效果（位置 t % m）。位置 0 當基準。
  // seasonal[i]：各位置的效果減去 m 個效果的平均（位置 0 原始效果是 0）。
  ML.trendSeason = function (y, m, H) {
    var n = y.length, X = [], t, k, h;
    if (n < m + 2) throw new Error('至少需要一個完整循環再多幾期的資料（訓練資料至少 ' + (m + 2) + ' 期，目前只有 ' + n + ' 期）。');
    for (t = 0; t < n; t++) {
      var row = [t];
      for (k = 1; k < m; k++) row.push(t % m === k ? 1 : 0);
      X.push(row);
    }
    var model = ML.ols(X, y);
    var fitted = ML.predictLinear(model, X);
    var slope = model.coef[0];
    var eff = [0];
    for (k = 1; k < m; k++) eff.push(model.coef[k]);
    var mu = ML.mean(eff), seasonal = eff.map(function (e) { return e - mu; });
    var forecast = [];
    for (h = 0; h < H; h++) { var tt = n + h; forecast.push(model.intercept + slope * tt + eff[tt % m]); }
    return { fitted: fitted, forecast: forecast, slope: slope, seasonal: seasonal };
  };

  if (typeof module !== 'undefined') module.exports = ML;
})();
