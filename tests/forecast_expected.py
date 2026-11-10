# 預測套餐的期望值：讀 data/demo.json 的 monthly，用 numpy／statsmodels／scikit-learn 獨立算出來，寫到 tests/forecast_expected.json。
# 清理：選用欄位為空的列刪掉（monthly 沒有空值）。切法：最後 H=6 期是考題，其餘是訓練。
import json, pathlib
import numpy as np
from statsmodels.tsa.holtwinters import Holt
from sklearn.linear_model import LinearRegression

R = pathlib.Path(__file__).resolve().parent.parent
d = json.loads((R / 'data' / 'demo.json').read_text(encoding='utf-8'))['monthly']
rows = [r for r in d['rows'] if all(str(r[c]).strip() != '' for c in d['cols'])]
y = np.array([float(r['營收']) for r in rows])
n = len(y)
H = 6 if n >= 24 else max(3, n // 4)
train, test = y[:n - H], y[n - H:]
ntr = len(train)

def mape(a, p):
    return float(np.mean(np.abs((a - p) / a)))

out = {'n': n, 'H': H, 'ntrain': ntr}

# 1) 季節天真法（m=12）：第 h 期（從 0 起）＝ train[ntr - m + h % m]
m = 12
sn = np.array([train[ntr - m + (h % m)] for h in range(H)])
out['seasonal_naive_m12'] = {'forecast_train_backtest': sn.tolist(), 'mape_test': mape(test, sn)}
# 未來預測（用全部 n 期）
sn_full = np.array([y[n - m + (h % m)] for h in range(H)])
out['seasonal_naive_m12']['forecast_future'] = sn_full.tolist()

# 2) 移動平均（w=3）：訓練最後 3 期平均，H 期都相同
ma = np.full(H, train[-3:].mean())
out['moving_average_w3'] = {'forecast_train_backtest': ma.tolist(), 'mape_test': mape(test, ma)}
out['moving_average_w3']['forecast_future'] = np.full(H, y[-3:].mean()).tolist()

# 3) 霍爾特（known 初始值：level0 = y[0]，trend0 = y[1] - y[0]），(alpha, beta) = (0.3, 0.1) 與 (0.8, 0.2)
out['holt'] = {}
for a, b in [(0.3, 0.1), (0.8, 0.2)]:
    key = f'a{a}_b{b}'
    res = Holt(train, initialization_method='known', initial_level=float(train[0]),
               initial_trend=float(train[1] - train[0])).fit(smoothing_level=a, smoothing_trend=b, optimized=False)
    fc = res.forecast(H)
    fit = res.fittedvalues
    full = Holt(y, initialization_method='known', initial_level=float(y[0]),
                initial_trend=float(y[1] - y[0])).fit(smoothing_level=a, smoothing_trend=b, optimized=False)
    out['holt'][key] = {'forecast_train_backtest': np.asarray(fc).tolist(),
                        'fitted_train': np.asarray(fit).tolist(),
                        'forecast_future_full': np.asarray(full.forecast(H)).tolist(),
                        'mape_test': mape(test, np.asarray(fc))}

# 4) 趨勢加季節（m=12）：設計矩陣 [t, 位置 1..11 的虛擬變數]，位置 0 當基準
def design(idx):
    X = []
    for t in idx:
        row = [t] + [1.0 if (t % m) == k else 0.0 for k in range(1, m)]
        X.append(row)
    return np.array(X, dtype=float)

lr = LinearRegression().fit(design(range(ntr)), train)
fc_ts = lr.predict(design(range(ntr, ntr + H)))
lr_full = LinearRegression().fit(design(range(n)), y)
out['trend_season_m12'] = {
    'slope': float(lr.coef_[0]),
    'forecast_train_backtest': fc_ts.tolist(),
    'mape_test': mape(test, fc_ts),
    'slope_full': float(lr_full.coef_[0]),
    'forecast_future_full': lr_full.predict(design(range(n, n + H))).tolist(),
}

(R / 'tests' / 'forecast_expected.json').write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
print('n=%d H=%d train=%d' % (n, H, ntr))
print('seasonal naive MAPE', out['seasonal_naive_m12']['mape_test'])
print('moving average MAPE', out['moving_average_w3']['mape_test'])
print('holt(0.3,0.1) MAPE', out['holt']['a0.3_b0.1']['mape_test'], ' holt(0.8,0.2) MAPE', out['holt']['a0.8_b0.2']['mape_test'])
print('trend+season MAPE', out['trend_season_m12']['mape_test'], 'slope', out['trend_season_m12']['slope'])
