# 回歸類的期望值：用 scikit-learn 依照和 JS 相同的清理與切法算出來，寫到 tests/regress_expected.json
# 清理：只刪「該測試用到的欄位」有空字串的列；切法：第 i 列（清理後）i%5==4 為考題
import json, math, pathlib
import numpy as np
from sklearn.linear_model import LinearRegression
from sklearn.preprocessing import StandardScaler, PolynomialFeatures
from sklearn.metrics import r2_score, mean_squared_error

R = pathlib.Path(__file__).resolve().parent.parent
rows = json.loads((R / 'data' / 'demo.json').read_text(encoding='utf-8'))['daily']['rows']


def clean(cols):
    return [r for r in rows if all(str(r[c]).strip() != '' for c in cols)]


def split(rs):
    tr = [r for i, r in enumerate(rs) if i % 5 != 4]
    te = [r for i, r in enumerate(rs) if i % 5 == 4]
    return tr, te


def col(rs, name):
    return np.array([float(r[name]) for r in rs], dtype=float)


def rmse(y, p):
    return math.sqrt(mean_squared_error(y, p))


out = {}

# 1) 簡單線性回歸：廣告費 -> 營收
rs = clean(['廣告費', '營收'])
tr, te = split(rs)
Xtr, ytr = col(tr, '廣告費').reshape(-1, 1), col(tr, '營收')
Xte, yte = col(te, '廣告費').reshape(-1, 1), col(te, '營收')
lr = LinearRegression().fit(Xtr, ytr)
out['linear'] = {
    'n_train': len(tr), 'n_test': len(te),
    'slope': float(lr.coef_[0]), 'intercept': float(lr.intercept_),
    'r2_train': float(r2_score(ytr, lr.predict(Xtr))),
    'r2_test': float(r2_score(yte, lr.predict(Xte))),
    'rmse_test': float(rmse(yte, lr.predict(Xte))),
}

# 2) 多元線性回歸：廣告費、氣溫、假日 -> 營收
names = ['廣告費', '氣溫', '假日']
rs = clean(names + ['營收'])
tr, te = split(rs)
Xtr = np.column_stack([col(tr, c) for c in names]); ytr = col(tr, '營收')
Xte = np.column_stack([col(te, c) for c in names]); yte = col(te, '營收')
lr = LinearRegression().fit(Xtr, ytr)
sc = StandardScaler().fit(Xtr)
lz = LinearRegression().fit(sc.transform(Xtr), ytr)
pte = lr.predict(Xte)
std = lz.coef_.tolist()
top = names[int(np.argmax(np.abs(np.array(std))))]
out['multi'] = {
    'names': names, 'n_train': len(tr), 'n_test': len(te),
    'coef': lr.coef_.tolist(), 'intercept': float(lr.intercept_),
    'std_coef': std,
    'r2_test': float(r2_score(yte, pte)), 'rmse_test': float(rmse(yte, pte)),
    'top': top,
}

# 3) 多項式回歸：折扣率 -> 毛利，次方 1 到 6
rs = clean(['折扣率', '毛利'])
tr, te = split(rs)
xtr, ytr = col(tr, '折扣率').reshape(-1, 1), col(tr, '毛利')
xte, yte = col(te, '折扣率').reshape(-1, 1), col(te, '毛利')
lo = min(float(r['折扣率']) for r in rs)
hi = max(float(r['折扣率']) for r in rs)
# 和 JS 相同的格式：lo + (hi-lo)*i/99
grid = np.array([[lo + (hi - lo) * i / 99] for i in range(100)])
poly = {'n_train': len(tr), 'n_test': len(te), 'by_degree': {}}
for d in range(1, 7):
    s = StandardScaler().fit(xtr)                       # 只用訓練資料 fit
    pf = PolynomialFeatures(d, include_bias=False)
    Ftr = pf.fit_transform(s.transform(xtr))
    Fte = pf.transform(s.transform(xte))
    Fg = pf.transform(s.transform(grid))
    lr = LinearRegression().fit(Ftr, ytr)
    pte = lr.predict(Fte)
    gy = lr.predict(Fg)
    poly['by_degree'][str(d)] = {
        'pred_test': pte.tolist(),
        'rmse_test': float(rmse(yte, pte)),
        'rmse_train': float(rmse(ytr, lr.predict(Ftr))),
        'r2_test': float(r2_score(yte, pte)),
        'peak_x': float(grid[int(np.argmax(gy)), 0]),   # argmax 取第一個最大值，和 JS 的 > 比較一致
    }
out['poly'] = poly

(R / 'tests' / 'regress_expected.json').write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding='utf-8')
print('寫入 tests/regress_expected.json')
print('linear slope', out['linear']['slope'], 'r2_test', out['linear']['r2_test'])
print('multi top', out['multi']['top'], 'std', out['multi']['std_coef'])
print('poly rmse_test', {k: round(v['rmse_test'], 4) for k, v in poly['by_degree'].items()})
