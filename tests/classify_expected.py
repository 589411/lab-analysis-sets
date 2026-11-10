# 分類套餐的期望值：用 scikit-learn 算，和 JS 演算法比對。
# 資料：data/demo.json 的 repurchase。清理：選用欄位為 "" 的列刪掉（此資料沒有空值）。
# 切法：i % 5 == 4 的列為考題，其餘為訓練（與 ML.splitIdx 相同）。
import json, pathlib, sys
import numpy as np
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.tree import DecisionTreeClassifier
from sklearn.neighbors import KNeighborsClassifier
from sklearn.metrics import roc_auc_score, confusion_matrix

R = pathlib.Path(__file__).resolve().parent.parent
data = json.loads((R / 'data' / 'demo.json').read_text(encoding='utf-8'))['repurchase']
rows = [r for r in data['rows'] if all(str(r[c]).strip() != '' for c in data['cols'])]
n = len(rows)
train = [i for i in range(n) if i % 5 != 4]
test = [i for i in range(n) if i % 5 == 4]

FEAT4 = ['最近購買天數', '購買次數', '平均客單', '用過折價券']
FEAT2 = ['最近購買天數', '購買次數']
Y = '之後回購'

def mat(idx, cols):
    return np.array([[float(rows[i][c]) for c in cols] for i in idx], dtype=float)

ytr = np.array([int(rows[i][Y]) for i in train])
yte = np.array([int(rows[i][Y]) for i in test])
out = {'n': n, 'n_train': len(train), 'n_test': len(test)}

# 1) 邏輯迴歸（標準化後，不加正則）
Xtr, Xte = mat(train, FEAT4), mat(test, FEAT4)
sc = StandardScaler().fit(Xtr)
lr = LogisticRegression(penalty=None, tol=1e-10, max_iter=2000).fit(sc.transform(Xtr), ytr)
proba = lr.predict_proba(sc.transform(Xte))[:, 1]
tn, fp, fn, tp = confusion_matrix(yte, lr.predict(sc.transform(Xte)), labels=[0, 1]).ravel()
out['logit'] = {
    'features': FEAT4,
    'intercept': float(lr.intercept_[0]),
    'coef': [float(v) for v in lr.coef_[0]],
    'test_proba': [float(v) for v in proba],
    'auc': float(roc_auc_score(yte, proba)),
    'confusion_0_5': {'tp': int(tp), 'fp': int(fp), 'tn': int(tn), 'fn': int(fn)},
}

# 2) 決策樹（gini, min_samples_leaf=5, 原始單位）
out['tree'] = {'features': FEAT4, 'depths': {}}
for d in range(1, 5):
    t = DecisionTreeClassifier(criterion='gini', max_depth=d, min_samples_leaf=5, random_state=0).fit(Xtr, ytr)
    tr_ = t.tree_
    out['tree']['depths'][str(d)] = {
        'root_feature': int(tr_.feature[0]),
        'root_threshold': float(tr_.threshold[0]),
        'train_acc': float(t.score(Xtr, ytr)),
        'test_acc': float(t.score(Xte, yte)),
        'test_pred': [int(v) for v in t.predict(Xte)],
        'leaves': int(t.get_n_leaves()),
    }

# 3) K 近鄰（標準化後，brute）
X2tr, X2te = mat(train, FEAT2), mat(test, FEAT2)
sc2 = StandardScaler().fit(X2tr)
Ztr2, Zte2 = sc2.transform(X2tr), sc2.transform(X2te)
out['knn'] = {'features': FEAT2, 'k': {}}
for k in (1, 7, 15):
    kn = KNeighborsClassifier(n_neighbors=k, algorithm='brute').fit(Ztr2, ytr)
    out['knn']['k'][str(k)] = {
        'test_pred': [int(v) for v in kn.predict(Zte2)],
        'test_proba': [float(v) for v in kn.predict_proba(Zte2)[:, 1]],
        'test_acc': float(kn.score(Zte2, yte)),
    }
# 額外參考：精確暴力法 + 規格的並列規則（距離相同時索引小的優先）。
# 標準化用和 JS 相同的逐項算法，避免浮點誤差改變「並列」判斷。
# 用途：分開「並列規則不同」與「演算法錯誤」。sklearn 的並列順序不同，所以不能拿來當唯一標準。
def manual_std(col_train):
    m = 0.0
    for v in col_train: m += v
    m = m / len(col_train)
    ss = 0.0
    for v in col_train: ss += (v - m) * (v - m)
    s = (ss / len(col_train)) ** 0.5
    return m, (s if s != 0 else 1.0)
mu_sd = [manual_std(X2tr[:, j]) for j in range(2)]
def z(M):
    return [[(r[j] - mu_sd[j][0]) / mu_sd[j][1] for j in range(2)] for r in M]
Ztr_m, Zte_m = z(X2tr), z(X2te)
out['knn']['exact_tie_index'] = {}
for k in (1, 7, 15):
    pr = []
    for q in Zte_m:
        dd = sorted((sum((a - b) * (a - b) for a, b in zip(Ztr_m[i], q)), i) for i in range(len(Ztr_m)))
        pr.append(sum(int(ytr[i]) for _, i in dd[:k]) / k)
    out['knn']['exact_tie_index'][str(k)] = {'test_proba': pr, 'test_pred': [1 if p > 0.5 else 0 for p in pr]}
out['knn']['k_grid_acc'] = {}
for k in range(1, 26, 2):
    kn = KNeighborsClassifier(n_neighbors=k, algorithm='brute').fit(Ztr2, ytr)
    out['knn']['k_grid_acc'][str(k)] = float(kn.score(Zte2, yte))
majority = 1 if ytr.sum() * 2 >= len(ytr) else 0   # 與 JS 相同：訓練資料多數類，平手取 1
out['knn']['baseline_test_acc'] = float(np.mean(yte == majority))

(R / 'tests' / 'classify_expected.json').write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
print('wrote tests/classify_expected.json', 'train', len(train), 'test', len(test))
print('logit test acc', float(np.mean((proba >= 0.5) == yte)), 'auc', out['logit']['auc'])
print('tree test acc', {d: round(v['test_acc'], 4) for d, v in out['tree']['depths'].items()})
print('knn k grid', {k: round(v, 4) for k, v in out['knn']['k_grid_acc'].items()})
print('knn baseline', out['knn']['baseline_test_acc'])
