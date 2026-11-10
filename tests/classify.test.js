// 分類演算法核對：和 tests/classify_expected.json（scikit-learn 算出）逐項比對。
// 執行：node tests/classify.test.js   有 FAIL 時結束碼為 1。
'use strict';
var ML = require('../src/algos/classify.js');
var expected = require('./classify_expected.json');
var demo = require('../data/demo.json').repurchase;

var fails = 0;
function check(name, actual, limit, expectOK) {
  var ok = expectOK !== undefined ? expectOK : Math.abs(actual) <= limit;
  if (!ok) fails++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + '：差距 ' + (typeof actual === 'number' ? actual.toExponential(3) : actual) + (limit !== undefined ? '（容許 ' + limit + '）' : ''));
}

// 和套餐一樣的切法與清理（repurchase 沒有空值）
var cols4 = ['最近購買天數', '購買次數', '平均客單', '用過折價券'];
var cols2 = ['最近購買天數', '購買次數'];
var rows = demo.rows.filter(function (r) {
  return demo.cols.every(function (c) { return String(r[c]).trim() !== ''; });
});
var sp = ML.splitIdx(rows.length);
function X(cols, idx) { return idx.map(function (i) { return cols.map(function (c) { return Number(rows[i][c]); }); }); }
function Y(idx) { return idx.map(function (i) { return Number(rows[i]['之後回購']); }); }
var Xtr4 = X(cols4, sp.train), Xte4 = X(cols4, sp.test), ytr = Y(sp.train), yte = Y(sp.test);

console.log('== 1. 邏輯迴歸（標準化後，不加正則）==');
var E = expected.logit;
var st = ML.standardize(Xtr4);
var Zte = ML.standardize(Xte4, st.mean, st.std).Z;
var m = ML.logistic(st.Z, ytr, { maxIter: 50 });
var coefDiff = Math.max.apply(null, m.coef.map(function (v, j) { return Math.abs(v - E.coef[j]); }));
check('係數（4 個欄位）最大絕對差', coefDiff, 1e-4);
check('截距絕對差', Math.abs(m.intercept - E.intercept), 1e-4);
console.log('      迭代次數 ' + m.iter);
var pte = ML.logisticProba(m, Zte);
var probDiff = Math.max.apply(null, pte.map(function (v, i) { return Math.abs(v - E.test_proba[i]); }));
check('考題機率最大絕對差', probDiff, 1e-4);
var aucSk = ML.auc(yte, E.test_proba);
check('AUC（同一組 sklearn 機率）與 roc_auc_score 絕對差', Math.abs(aucSk - E.auc), 1e-9);
check('AUC（JS 自己算的機率）與 roc_auc_score 絕對差', Math.abs(ML.auc(yte, pte) - E.auc), 1e-4);
var cm = ML.confusion(yte, pte.map(function (p) { return p >= 0.5 ? 1 : 0; }));
var cmE = E.confusion_0_5;
check('門檻 0.5 混淆矩陣與 sklearn 完全相同', 0, undefined,
  cm.tp === cmE.tp && cm.fp === cmE.fp && cm.tn === cmE.tn && cm.fn === cmE.fn);
console.log('      JS ' + JSON.stringify(cm) + ' / sklearn ' + JSON.stringify(cmE));

console.log('== 2. 決策樹（gini, min_leaf=5, 原始單位）==');
var mismatchAll = {};
[1, 2, 3, 4].forEach(function (d) {
  var D = expected.tree.depths[String(d)];
  var t = ML.tree(Xtr4, ytr, { maxDepth: d, minLeaf: 5 });
  console.log('-- 深度 ' + d);
  check('根節點欄位相同（JS ' + t.feature + '，sklearn ' + D.root_feature + '）', 0, undefined, t.feature === D.root_feature);
  check('根節點切點絕對差', Math.abs(t.threshold - D.root_threshold), 1e-9);
  var trAcc = ML.treePredict(t, Xtr4).filter(function (p, i) { return p === ytr[i]; }).length / ytr.length;
  var teP = ML.treePredict(t, Xte4);
  var teAcc = teP.filter(function (p, i) { return p === yte[i]; }).length / yte.length;
  check('訓練準確率絕對差', Math.abs(trAcc - D.train_acc), 0.005);
  check('考題準確率絕對差', Math.abs(teAcc - D.test_acc), 0.03);
  var diffs = teP.filter(function (p, i) { return p !== D.test_pred[i]; }).length;
  mismatchAll[d] = diffs;
  console.log('      考題預測與 sklearn 不同的筆數：' + diffs + '（參考，僅 d=1、d=2 要求為 0）');
  if (d <= 2) check('深度 ' + d + ' 考題預測與 sklearn 完全相同（不同筆數）', diffs, undefined, diffs === 0);
});

console.log('== 3. K 近鄰（標準化後，歐氏距離）==');
var Xtr2 = X(cols2, sp.train), Xte2 = X(cols2, sp.test);
var st2 = ML.standardize(Xtr2);
var Zte2 = ML.standardize(Xte2, st2.mean, st2.std).Z;
[1, 7, 15].forEach(function (k) {
  var E2 = expected.knn.k[String(k)];
  var pr = ML.knnProba(st2.Z, ytr, Zte2, k);
  var pred = pr.map(function (p) { return p > 0.5 ? 1 : 0; });
  var diffs = pred.filter(function (p, i) { return p !== E2.test_pred[i]; }).length;
  console.log('-- k = ' + k);
  check('考題預測不同的筆數（容許 1 筆）', diffs, undefined, diffs <= 1);
  if (k === 7) {
    var maxP = Math.max.apply(null, pr.map(function (p, i) { return Math.abs(p - E2.test_proba[i]); }));
    check('考題機率最大絕對差', maxP, 1 / 7 + 1e-9);
    var same = pr.filter(function (p, i) { return Math.abs(p - E2.test_proba[i]) < 1e-9; }).length / pr.length;
    check('機率完全相同的比例（至少 97%）', same, undefined, same >= 0.97);
  }
});
// 額外核對：精確暴力法 + 規格的並列規則（距離相同時索引小的優先）。
// 與 sklearn 的差異若只出現在並列點，代表是「並列順序」不同，不是演算法錯誤。
[1, 7, 15].forEach(function (k) {
  var EX = expected.knn.exact_tie_index[String(k)];
  var pr2 = ML.knnProba(st2.Z, ytr, Zte2, k);
  var pdiff = Math.max.apply(null, pr2.map(function (p, i) { return Math.abs(p - EX.test_proba[i]); }));
  check('[並列規則核對] k=' + k + ' 機率最大絕對差（精確暴力法）', pdiff, 1e-9);
});
var curve = [];
for (var kk = 1; kk <= 25; kk += 2) {
  var pk = ML.knnProba(st2.Z, ytr, Zte2, kk);
  var acc = pk.filter(function (p, i) { return (p > 0.5 ? 1 : 0) === yte[i]; }).length / yte.length;
  var accE = expected.knn.k_grid_acc[String(kk)];
  curve.push(Math.abs(acc - accE));
}
check('k=1..25 考題準確率曲線最大絕對差', Math.max.apply(null, curve), 0.02);
var majority = ytr.reduce(function (a, b) { return a + b; }, 0) * 2 >= ytr.length ? 1 : 0;
var base = yte.filter(function (v) { return v === majority; }).length / yte.length;
check('基準（全部猜多數）絕對差', Math.abs(base - expected.knn.baseline_test_acc), 1e-12);

console.log(fails ? ('\n有 ' + fails + ' 項 FAIL') : '\n全部 PASS');
if (fails) process.exit(1);
