// 分群演算法：K-means、階層式分群（Ward）、DBSCAN，外加輪廓係數與群編號整理。純函式，不碰 DOM。
(function () {
  'use strict';
  var ML = (typeof window !== 'undefined') ? window.ML : require('./base.js');

  function d2(a, b) { return ML.dist2(a, b); }

  // 每群的平均位置與人數
  function meansOf(Z, labels, k) {
    var p = Z[0].length, C = [], cnt = [], i, j, c;
    for (c = 0; c < k; c++) { C.push(new Array(p).fill(0)); cnt.push(0); }
    for (i = 0; i < Z.length; i++) { c = labels[i]; cnt[c]++; for (j = 0; j < p; j++) C[c][j] += Z[i][j]; }
    for (c = 0; c < k; c++) if (cnt[c]) for (j = 0; j < p; j++) C[c][j] /= cnt[c];
    return { C: C, cnt: cnt };
  }

  // 每點歸到最近的中心。回傳這一輪有沒有人換群。
  function assign(Z, C, labels) {
    var changed = false, i, c, best, bd, dd;
    for (i = 0; i < Z.length; i++) {
      best = 0; bd = Infinity;
      for (c = 0; c < C.length; c++) { dd = d2(Z[i], C[c]); if (dd < bd) { bd = dd; best = c; } }
      if (labels[i] !== best) { labels[i] = best; changed = true; }
    }
    return changed;
  }

  // k-means++ 起始中心：下一個中心以「離現有中心距離平方」為機率抽樣
  function seedPP(Z, k, rnd) {
    var n = Z.length, C = [], d = new Array(n), i, r, acc, total, pick, last;
    C.push(Z[Math.floor(rnd() * n)].slice());
    for (i = 0; i < n; i++) d[i] = d2(Z[i], C[0]);
    while (C.length < k) {
      total = ML.sum(d);
      if (total <= 0) {
        pick = Math.floor(rnd() * n);
      } else {
        r = rnd() * total; acc = 0; pick = n - 1;
        for (i = 0; i < n; i++) { acc += d[i]; if (acc >= r) { pick = i; break; } }
      }
      C.push(Z[pick].slice());
      last = C[C.length - 1];
      for (i = 0; i < n; i++) { var dd = d2(Z[i], last); if (dd < d[i]) d[i] = dd; }
    }
    return C;
  }

  // 空群時，挪到離自己中心最遠的點（該點所在的群至少有 2 人）
  function farthest(Z, labels, C) {
    var best = -1, bd = -1, i, dd;
    for (i = 0; i < Z.length; i++) {
      dd = d2(Z[i], C[labels[i]]);
      if (dd > bd) { bd = dd; best = i; }
    }
    return Z[best < 0 ? 0 : best].slice();
  }

  function kmeansOnce(Z, k, rnd, maxIter) {
    var C = seedPP(Z, k, rnd), labels = new Array(Z.length).fill(-1), it, c, m, fin, inertia, i;
    for (it = 0; it < maxIter; it++) {
      if (!assign(Z, C, labels)) break;
      m = meansOf(Z, labels, k);
      for (c = 0; c < k; c++) C[c] = m.cnt[c] ? m.C[c] : farthest(Z, labels, C);
    }
    fin = meansOf(Z, labels, k);
    inertia = 0;
    for (i = 0; i < Z.length; i++) inertia += d2(Z[i], fin.C[labels[i]]);
    return { labels: labels, centers: fin.C, inertia: inertia };
  }

  // K-means：k-means++ 起始，跑 nInit 次取慣性（inertia）最小的結果。同 seed 結果必定相同。
  ML.kmeans = function (Z, k, opt) {
    opt = opt || {};
    var seed = opt.seed == null ? 42 : opt.seed, nInit = opt.nInit || 10, maxIter = opt.maxIter || 100;
    if (!(k >= 1) || Z.length < k) throw new Error('資料列數比要分的群數還少，請把群數調小。');
    var rnd = ML.rng(seed), best = null, i, r;
    for (i = 0; i < nInit; i++) {
      r = kmeansOnce(Z, k, rnd, maxIter);
      if (!best || r.inertia < best.inertia) best = r;
    }
    return best;
  };

  // 平均輪廓係數。只有 1 群時回傳 0；某點所在的群只有它一個人時，該點記 0。
  ML.silhouette = function (Z, labels) {
    var n = Z.length, groups = {}, keys, i, j, q, s = 0;
    for (i = 0; i < n; i++) { (groups[labels[i]] = groups[labels[i]] || []).push(i); }
    keys = Object.keys(groups);
    if (keys.length < 2) return 0;
    var dist = function (a, b) { return Math.sqrt(d2(Z[a], Z[b])); };
    for (i = 0; i < n; i++) {
      var own = groups[labels[i]], a = 0, b = Infinity;
      if (own.length < 2) continue;
      for (j = 0; j < own.length; j++) a += dist(i, own[j]);
      a /= (own.length - 1);
      for (q = 0; q < keys.length; q++) {
        if (keys[q] === String(labels[i])) continue;
        var g = groups[keys[q]], t = 0;
        for (j = 0; j < g.length; j++) t += dist(i, g[j]);
        t /= g.length;
        if (t < b) b = t;
      }
      var mx = Math.max(a, b);
      s += mx > 0 ? (b - a) / mx : 0;
    }
    return s / n;
  };

  // 階層式分群（Ward）。用平方歐氏距離矩陣＋Lance-Williams 更新。
  // 回傳 n-1 筆合併：{a, b, dist, size}。編號同 scipy linkage：原始點 0..n-1，第 i 次合併的新群是 n+i。
  // dist 與 scipy 的 'ward' 相同（歐氏距離尺度）：平方距離的更新值開根號。
  ML.hclust = function (Z) {
    var n = Z.length, i, j, a, b, step, D = [], size = [], id = [], active = [], merges = [];
    if (n > 600) throw new Error('這個方法資料太多會很慢，請先抽樣到 600 列以內');
    if (n < 2) throw new Error('至少要 2 列資料才能分群。');
    for (i = 0; i < n; i++) { D.push(new Array(n).fill(0)); size.push(1); id.push(i); active.push(i); }
    for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) { var v = d2(Z[i], Z[j]); D[i][j] = v; D[j][i] = v; }
    for (step = 0; step < n - 1; step++) {
      var bp = -1, bq = -1, bv = Infinity;
      for (a = 0; a < active.length; a++) {
        for (b = a + 1; b < active.length; b++) {
          var p = active[a], q = active[b];
          if (D[p][q] < bv) { bv = D[p][q]; bp = p; bq = q; }
        }
      }
      var ni = size[bp], nj = size[bq], ida = id[bp], idb = id[bq];
      merges.push({ a: Math.min(ida, idb), b: Math.max(ida, idb), dist: Math.sqrt(bv), size: ni + nj });
      for (a = 0; a < active.length; a++) {
        var k = active[a];
        if (k === bp || k === bq) continue;
        var nk = size[k], nv = ((ni + nk) * D[bp][k] + (nj + nk) * D[bq][k] - nk * bv) / (ni + nj + nk);
        D[bp][k] = nv; D[k][bp] = nv;
      }
      size[bp] = ni + nj; id[bp] = n + step;
      active.splice(active.indexOf(bq), 1);
    }
    return merges;
  };

  // 在切成 k 群的地方切開樹狀圖，回傳每個點的群號（0..k-1）
  ML.cutTree = function (merges, n, k) {
    if (!(k >= 1 && k <= n)) throw new Error('切的群數要在 1 到資料列數之間。');
    var parent = [], i, s, m, out = [], lab = {}, nxt = 0;
    for (i = 0; i < n + merges.length; i++) parent.push(i);
    var find = function (x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    for (s = 0; s < n - k; s++) {
      m = merges[s];
      parent[find(m.a)] = n + s;
      parent[find(m.b)] = n + s;
    }
    for (i = 0; i < n; i++) {
      var r = find(i);
      if (!(r in lab)) lab[r] = nxt++;
      out.push(lab[r]);
    }
    return out;
  };

  // DBSCAN：與 scikit-learn 相同定義（鄰居包含自己，距離 ≤ eps 才算鄰居）。雜訊為 -1。
  ML.dbscan = function (Z, eps, minPts) {
    var n = Z.length, i, core = new Array(n), labels = new Array(n).fill(-1), c = -1;
    var nb = function (p) {
      var out = [], j;
      for (j = 0; j < n; j++) if (Math.sqrt(d2(Z[p], Z[j])) <= eps) out.push(j);
      return out;
    };
    for (i = 0; i < n; i++) core[i] = nb(i).length >= minPts;
    for (i = 0; i < n; i++) {
      if (labels[i] !== -1 || !core[i]) continue;
      c++;
      labels[i] = c;
      var stack = [i];
      while (stack.length) {
        var p = stack.pop(), N = nb(p), q;
        for (q = 0; q < N.length; q++) {
          var o = N[q];
          if (labels[o] === -1) {
            labels[o] = c;
            if (core[o]) stack.push(o);
          }
        }
      }
    }
    return labels;
  };

  // 群編號依人數由多到少重排成 0,1,2…（人數相同時依第一次出現的順序）。雜訊 -1 保留。
  // 回傳 {labels: 新編號, sizes: 每個新群號的人數}
  ML.relabelBySize = function (labels) {
    var cnt = {}, order = [], i;
    for (i = 0; i < labels.length; i++) {
      var l = labels[i];
      if (l < 0) continue;
      if (!(l in cnt)) { cnt[l] = 0; order.push(l); }
      cnt[l]++;
    }
    var rank = order.map(function (l, idx) { return { l: l, idx: idx, c: cnt[l] }; })
      .sort(function (x, y) { return (y.c - x.c) || (x.idx - y.idx); });
    var map = {}, sizes = [];
    rank.forEach(function (o, r) { map[o.l] = r; sizes.push(o.c); });
    return { labels: labels.map(function (l) { return l < 0 ? -1 : map[l]; }), sizes: sizes };
  };

  if (typeof module !== 'undefined') module.exports = ML;
})();
