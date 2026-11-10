// 分群演算法核對：和 tests/cluster_expected.json（scikit-learn / scipy）逐項比。
// 執行：node tests/cluster.test.js
'use strict';
var fs = require('fs'), path = require('path');
var ML = require('../src/algos/cluster.js');
var E = JSON.parse(fs.readFileSync(path.join(__dirname, 'cluster_expected.json'), 'utf8'));
var demo = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'demo.json'), 'utf8'));

var COLS = ['最近購買天數', '購買次數', '平均客單'];
var rows = demo.members.rows.filter(function (r) {
  return COLS.every(function (c) { return String(r[c]).trim() !== ''; });
});
var X = rows.map(function (r) { return COLS.map(function (c) { return Number(r[c]); }); });
var Z = ML.standardize(X).Z;

// 調整蘭德指數（ARI），自己實作
function comb2(x) { return x * (x - 1) / 2; }
function ari(a, b) {
  var n = a.length, ca = {}, cb = {}, cab = {}, i;
  for (i = 0; i < n; i++) {
    ca[a[i]] = (ca[a[i]] || 0) + 1;
    cb[b[i]] = (cb[b[i]] || 0) + 1;
    var key = a[i] + '|' + b[i];
    cab[key] = (cab[key] || 0) + 1;
  }
  var idx = 0, sa = 0, sb = 0, k;
  for (k in cab) idx += comb2(cab[k]);
  for (k in ca) sa += comb2(ca[k]);
  for (k in cb) sb += comb2(cb[k]);
  var expected = sa * sb / comb2(n), maxIdx = (sa + sb) / 2;
  if (maxIdx === expected) return 1;
  return (idx - expected) / (maxIdx - expected);
}

var fails = 0, total = 0;
function check(name, ok, detail) {
  total++;
  if (!ok) fails++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + '  ' + detail);
}

console.log('資料列數 n = ' + Z.length + '（期望檔 n = ' + E.n + '）');
check('列數相同', Z.length === E.n, 'JS ' + Z.length + ' / 期望 ' + E.n);

// 1. K-means：慣性相對差 ≤ 0.5%，labels 的 ARI ≥ 0.95
[2, 3, 4, 5, 6].forEach(function (k) {
  var km = ML.kmeans(Z, k, { seed: 42, nInit: 10, maxIter: 100 });
  var ex = E.kmeans[String(k)];
  var rel = Math.abs(km.inertia - ex.inertia) / ex.inertia;
  check('kmeans k=' + k + ' 慣性', rel <= 0.005, 'JS ' + km.inertia.toFixed(6) + ' / sklearn ' + ex.inertia.toFixed(6) + ' 相對差 ' + (rel * 100).toExponential(3) + '%（容許 0.5%）');
  var a = ari(km.labels, ex.labels);
  check('kmeans k=' + k + ' 分群 ARI', a >= 0.95, 'ARI ' + a.toFixed(4) + '（容許 ≥ 0.95）');
});

// 2. 輪廓係數：同一組 labels，絕對差 ≤ 1e-9
var sil = ML.silhouette(Z, E.silhouette.labels);
var sd = Math.abs(sil - E.silhouette.score);
check('silhouette (k=4)', sd <= 1e-9, 'JS ' + sil.toFixed(12) + ' / sklearn ' + E.silhouette.score.toFixed(12) + ' 絕對差 ' + sd.toExponential(3) + '（容許 1e-9）');

// 3. 階層式（Ward）：合併距離排序後逐一比，相對差 ≤ 1e-6；切割 ARI = 1
var merges = ML.hclust(Z);
var jsD = merges.map(function (m) { return m.dist; }).sort(function (x, y) { return x - y; });
var exD = E.hclust.dists_sorted;
var maxRel = 0, worst = -1;
for (var i = 0; i < exD.length; i++) {
  var r = Math.abs(jsD[i] - exD[i]) / Math.max(Math.abs(exD[i]), 1e-300);
  if (r > maxRel) { maxRel = r; worst = i; }
}
check('hclust 合併距離（' + exD.length + ' 筆）', jsD.length === exD.length && maxRel <= 1e-6, '最大相對差 ' + maxRel.toExponential(3) + '（容許 1e-6）' + (worst >= 0 ? ' 位置 ' + worst : ''));
[2, 3, 4, 5, 6].forEach(function (k) {
  var lab = ML.cutTree(merges, Z.length, k);
  var a = ari(lab, E.hclust[String(k)]);
  check('hclust 切成 k=' + k + ' 群 ARI', a === 1 || Math.abs(a - 1) < 1e-12, 'ARI ' + a.toFixed(6) + '（需要 = 1）');
});

// 4. DBSCAN：群數相同、雜訊點集合完全相同、core 點的分群 ARI = 1
Object.keys(E.dbscan).forEach(function (key) {
  var ex = E.dbscan[key];
  var lab = ML.dbscan(Z, ex.eps, ex.min_samples);
  var distinct = {};
  lab.forEach(function (l) { if (l >= 0) distinct[l] = 1; });
  var nc = Object.keys(distinct).length;
  check('dbscan ' + key + ' 群數', nc === ex.n_clusters, 'JS ' + nc + ' / sklearn ' + ex.n_clusters);
  var jsNoise = [], i2;
  for (i2 = 0; i2 < lab.length; i2++) if (lab[i2] === -1) jsNoise.push(i2);
  var sameNoise = jsNoise.length === ex.noise.length && jsNoise.every(function (v, j) { return v === ex.noise[j]; });
  check('dbscan ' + key + ' 雜訊點集合', sameNoise, 'JS ' + jsNoise.length + ' 位 / sklearn ' + ex.noise.length + ' 位');
  var coreLab = ex.core_sample_indices.map(function (i3) { return lab[i3]; });
  var coreExp = ex.core_sample_indices.map(function (i3) { return ex.labels[i3]; });
  var a2 = ari(coreLab, coreExp);
  check('dbscan ' + key + ' core 點 ARI', Math.abs(a2 - 1) < 1e-12, 'ARI ' + a2.toFixed(6) + '（需要 = 1）');
});

console.log('\n' + (total - fails) + ' / ' + total + ' 通過' + (fails ? '，' + fails + ' 項 FAIL' : ''));
if (fails) process.exit(1);
