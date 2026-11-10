// 分類套餐的演算法：邏輯迴歸（牛頓法）、決策樹（CART, gini）、K 近鄰、混淆矩陣、AUC。
(function () {
  'use strict';
  var ML = (typeof window !== 'undefined') ? window.ML : require('./base.js');

  function sigmoid(z) { return 1 / (1 + Math.exp(-z)); }

  // 混淆矩陣。yTrue、yPred 都是 0/1 陣列。
  ML.confusion = function (yTrue, yPred) {
    var c = { tp: 0, fp: 0, tn: 0, fn: 0 };
    for (var i = 0; i < yTrue.length; i++) {
      if (yTrue[i] === 1) { if (yPred[i] === 1) c.tp++; else c.fn++; }
      else if (yPred[i] === 1) c.fp++;
      else c.tn++;
    }
    return c;
  };

  // AUC：排名法（Mann-Whitney），同分的點取平均名次。沒有兩種結果時回傳 NaN。
  ML.auc = function (yTrue, score) {
    var n = yTrue.length, idx = [], i, j, k;
    for (i = 0; i < n; i++) idx.push(i);
    idx.sort(function (a, b) { return (score[a] - score[b]) || (a - b); });
    var rank = new Array(n);
    for (i = 0; i < n;) {
      j = i;
      while (j + 1 < n && score[idx[j + 1]] === score[idx[i]]) j++;
      var avg = (i + 1 + j + 1) / 2;          // 名次 i+1 到 j+1 的平均
      for (k = i; k <= j; k++) rank[idx[k]] = avg;
      i = j + 1;
    }
    var npos = 0, nneg = 0, sp = 0;
    for (i = 0; i < n; i++) { if (yTrue[i] === 1) { npos++; sp += rank[i]; } else nneg++; }
    if (!npos || !nneg) return NaN;
    return (sp - npos * (npos + 1) / 2) / (npos * nneg);
  };

  // 邏輯迴歸：牛頓法（IRLS），不加正則。Z 應已標準化（不含截距欄）。
  // 回傳 {intercept, coef[], iter}。係數絕對值超過 30 視為完全分離。
  ML.logistic = function (Z, y, opt) {
    opt = opt || {};
    var maxIter = opt.maxIter || 50, n = Z.length, p = n ? Z[0].length : 0, q = p + 1;
    var w = new Array(q).fill(0), it, i, j, k, iter = 0;
    for (it = 0; it < maxIter; it++) {
      var g = new Array(q).fill(0), H = [];
      for (j = 0; j < q; j++) H.push(new Array(q).fill(0));
      for (i = 0; i < n; i++) {
        var r = [1].concat(Z[i]), eta = 0;
        for (j = 0; j < q; j++) eta += w[j] * r[j];
        var pr = sigmoid(eta), wt = pr * (1 - pr), res = y[i] - pr;
        for (j = 0; j < q; j++) {
          g[j] += r[j] * res;
          for (k = 0; k < q; k++) H[j][k] += wt * r[j] * r[k];
        }
      }
      for (j = 0; j < q; j++) H[j][j] += 1e-10;
      var d = ML.solve(H, g), maxd = 0;
      for (j = 0; j < q; j++) { w[j] += d[j]; maxd = Math.max(maxd, Math.abs(d[j])); }
      iter = it + 1;
      if (maxd < 1e-10) break;
    }
    var coef = w.slice(1);
    var bad = coef.some(function (v) { return !isFinite(v) || Math.abs(v) > 30; });
    if (bad) throw new Error('這些欄位可以把兩種結果完全分開，通常代表欄位裡藏了答案。請拿掉和要預測的結果直接相關的欄位。');
    return { intercept: w[0], coef: coef, iter: iter };
  };

  ML.logisticProba = function (model, Z) {
    return Z.map(function (r) {
      var e = model.intercept;
      for (var j = 0; j < r.length; j++) e += model.coef[j] * r[j];
      return sigmoid(e);
    });
  };

  // 決策樹（CART, gini）。X 用原始單位，y 為 0/1。
  // 節點：{n, pos, pred}；內節點多 {feature, threshold, left, right}；葉節點沒有 feature。
  ML.tree = function (X, y, opt) {
    opt = opt || {};
    var maxDepth = opt.maxDepth == null ? 3 : opt.maxDepth, minLeaf = opt.minLeaf || 5;
    var p = X.length ? X[0].length : 0, all = [], i;
    for (i = 0; i < X.length; i++) all.push(i);

    function build(idx, depth) {
      var n = idx.length, pos = 0, f, k, m;
      for (m = 0; m < n; m++) pos += y[idx[m]];
      var node = { n: n, pos: pos, pred: pos * 2 >= n ? 1 : 0 };
      if (depth >= maxDepth || pos === 0 || pos === n || n < 2 * minLeaf) return node;
      var best = null;
      for (f = 0; f < p; f++) {
        var order = idx.slice().sort(function (a, b) { return (X[a][f] - X[b][f]) || (a - b); });
        var nL = 0, posL = 0;
        for (k = 0; k < n - 1; k++) {
          var cur = order[k];
          nL++; posL += y[cur];
          var v = X[cur][f], vn = X[order[k + 1]][f];
          if (v === vn) continue;
          var nR = n - nL;
          if (nL < minLeaf || nR < minLeaf) continue;
          var posR = pos - posL, pl = posL / nL, pr = posR / nR;
          var score = (nL * 2 * pl * (1 - pl) + nR * 2 * pr * (1 - pr)) / n;   // 加權 gini
          if (!best || score < best.score) best = { feature: f, threshold: (v + vn) / 2, score: score };
        }
      }
      if (!best) return node;
      var L = [], R = [];
      idx.forEach(function (ii) { if (X[ii][best.feature] <= best.threshold) L.push(ii); else R.push(ii); });
      node.feature = best.feature;
      node.threshold = best.threshold;
      node.left = build(L, depth + 1);
      node.right = build(R, depth + 1);
      return node;
    }
    return build(all, 0);
  };

  ML.treePredict = function (root, X) {
    return X.map(function (r) {
      var nd = root;
      while (nd.left) nd = r[nd.feature] <= nd.threshold ? nd.left : nd.right;
      return nd.pred;
    });
  };

  // 每個葉子一條規則：conds 是從根到葉的條件（字串陣列），n、pos、ratio 用的是訓練資料。
  ML.treeRules = function (root, names) {
    var out = [];
    function num(x) { return String(Math.round(x * 100) / 100); }
    (function walk(nd, conds) {
      if (!nd.left) { out.push({ conds: conds, n: nd.n, pos: nd.pos, ratio: nd.pos / nd.n, pred: nd.pred }); return; }
      var nm = names[nd.feature];
      walk(nd.left, conds.concat([nm + ' ≤ ' + num(nd.threshold)]));
      walk(nd.right, conds.concat([nm + ' > ' + num(nd.threshold)]));
    })(root, []);
    return out;
  };

  // K 近鄰：回傳最近 k 個訓練點的索引（距離相同時索引小的優先）。
  ML.knnNeighbors = function (Zt, q, k) {
    var d = Zt.map(function (r, i) { return { i: i, d: ML.dist2(r, q) }; });
    d.sort(function (a, b) { return (a.d - b.d) || (a.i - b.i); });
    return d.slice(0, k).map(function (o) { return o.i; });
  };

  // K 近鄰：回傳每個考題「是 1」的比例（最近 k 個鄰居中 y=1 的比例）。
  ML.knnProba = function (Zt, yt, Zq, k) {
    return Zq.map(function (q) {
      var nb = ML.knnNeighbors(Zt, q, k), s = 0;
      for (var j = 0; j < nb.length; j++) s += yt[nb[j]];
      return s / k;
    });
  };

  if (typeof module !== 'undefined') module.exports = ML;
})();
