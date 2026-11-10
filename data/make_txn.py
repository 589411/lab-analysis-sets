# 產生模擬交易明細（全為虛構）。固定 seed，重跑結果一致。輸出：data/fixture_txn_messy.json
# 格式：{"txn": {"name", "cols", "rows": [{欄名: 字串}]}}，所有值都是字串（模擬企業匯出的 CSV）。
import json, pathlib, datetime as dt
import numpy as np

SEED = 20261110
TARGET_ROWS = 2500          # 400 KB 上限下的列數上限（物件式 rows，每列約 150 bytes），見回報
N_MEMBERS = 600
WALKIN_SHARE = 0.18         # 會員編號空白（散客）的比例
ROC_SHARE = 0.06            # 民國年寫法
REFUND_SHARE = 0.025        # 負數（退貨）
N_FREE = 4                  # 金額寫「免費」
GARBAGE = ['待補', '2025/13/40', '2025/02/30', '未確認', '0000/00/00']
START = dt.date(2025, 1, 3)
END = dt.date(2026, 10, 20)
STORES = ['士林店', '林口店', '桃園店']
PAYS = ['現金', '信用卡', '行動支付', '電子票證']
PAY_P = [0.42, 0.30, 0.22, 0.06]
SEASON = {1: .95, 2: .90, 3: .95, 4: .97, 5: 1.00, 6: .98,
          7: .99, 8: 1.00, 9: .99, 10: 1.08, 11: 1.18, 12: 1.25}
COLS = ['交易編號', '交易日期', '會員編號', '門市', '付款方式', '實收金額']
MAX_BYTES = 400_000
OUT = pathlib.Path(__file__).resolve().parent / 'fixture_txn_messy.json'

rng = np.random.default_rng(SEED)
days = [START + dt.timedelta(i) for i in range((END - START).days + 1)]
ND = len(days)
inten = np.array([SEASON[d.month] for d in days]) * (1 + 0.25 * np.arange(ND) / ND)  # 季節 × 緩慢成長

# ---- 會員：每人有自己的購買頻率與客單水準 ----
join = np.where(rng.random(N_MEMBERS) < 0.35, 0, rng.integers(1, ND - 60, N_MEMBERS))
kind = rng.choice(4, N_MEMBERS, p=[0.30, 0.40, 0.25, 0.05])  # 0 只來一次 1 偶爾 2 常客 3 超常客
rate = np.zeros(N_MEMBERS)
for k, (lo, hi) in {1: (1 / 200, 1 / 90), 2: (1 / 50, 1 / 25), 3: (1 / 16, 1 / 9)}.items():
    m = kind == k
    rate[m] = rng.uniform(lo, hi, m.sum())
level = np.exp(rng.normal(np.log(830), 0.42, N_MEMBERS))  # 每位會員的客單中位數
home = rng.integers(0, 3, N_MEMBERS)
active = np.arange(ND)[None, :] >= join[:, None]
regular = kind > 0

n_once = int((kind == 0).sum())
target_regular = TARGET_ROWS * (1 - WALKIN_SHARE) - n_once


def expected(mult):
    p = np.minimum(0.9, rate[:, None] * mult * inten[None, :]) * active
    return p[regular].sum()


lo, hi = 0.01, 50.0
for _ in range(60):  # 二分搜尋全域倍率，讓會員列數落在目標
    mid = (lo + hi) / 2
    lo, hi = (mid, hi) if expected(mid) < target_regular else (lo, mid)
mult = (lo + hi) / 2
P = np.minimum(0.9, rate[:, None] * mult * inten[None, :]) * active
hit = rng.random(P.shape) < P


def draw_in_window(i):
    w = inten * active[i]
    return int(rng.choice(ND, p=w / w.sum()))


purch = []  # (day, member)
for i in range(N_MEMBERS):
    if kind[i] == 0:
        purch.append((draw_in_window(i), i))
    else:
        ds = np.flatnonzero(hit[i])
        if len(ds) == 0:
            ds = [draw_in_window(i)]  # 每位會員至少來一次
        for t in ds:
            purch.append((int(t), i))

M = len(purch)
W = int(round(M / (1 - WALKIN_SHARE))) - M  # 散客列數，使散客約占 18%


def amount(median):
    x = median * np.exp(rng.normal(0, 0.28))
    return max(30, int(round(x / 10)) * 10)


rows = []
for t, i in purch:
    store = int(home[i]) if rng.random() < 0.7 else int(rng.integers(3))
    rows.append({'day': t, 'mem': i, 'amt': amount(level[i]), 'store': store,
                 'pay': int(rng.choice(4, p=PAY_P))})
w_days = rng.choice(ND, size=W, p=inten / inten.sum())
for t in w_days:
    rows.append({'day': int(t), 'mem': -1, 'amt': amount(760),
                 'store': int(rng.integers(3)), 'pay': int(rng.choice(4, p=PAY_P))})


def ensure_endpoint(day):
    """保證 day 當天有一筆乾淨、正常的會員交易，讓期間剛好是 START 到 END。回傳該列索引。"""
    idx = [k for k, r in enumerate(rows) if r['day'] == day and r['mem'] >= 0]
    if idx:
        return idx[0]
    cand = [k for k, r in enumerate(rows) if r['mem'] >= 0]
    k = int(rng.choice(cand))
    rows[k]['day'] = day
    return k


protected = {ensure_endpoint(0), ensure_endpoint(ND - 1)}
tie = rng.random(len(rows))
order = sorted(range(len(rows)), key=lambda k: (rows[k]['day'], tie[k]))
rows = [rows[k] for k in order]
protected = {order.index(k) for k in protected}  # 重新排序後的索引

N = len(rows)
perm = [k for k in rng.permutation(N) if k not in protected]
garb_ids = set(perm[:len(GARBAGE)])
rest = [k for k in perm if k not in garb_ids]
n_ref = int(round(REFUND_SHARE * N))
n_roc = int(round(ROC_SHARE * N))
refund_ids = set(rest[:n_ref])
free_ids = set(rest[n_ref:n_ref + N_FREE])
roc_ids = set(rest[n_ref + N_FREE:n_ref + N_FREE + n_roc])

member_no = rng.permutation(N_MEMBERS) + 1


def fmt(x):
    return f"{x:,}" if x >= 1000 else str(x)


out_rows = []
for k, r in enumerate(rows):
    d = days[r['day']]
    if k in garb_ids:
        date_s = GARBAGE[sorted(garb_ids).index(k)]
    elif k in roc_ids:
        date_s = f"{d.year - 1911}/{d.month:02d}/{d.day:02d}"
    else:
        date_s = f"{d.year}/{d.month}/{d.day}"
    if k in free_ids:
        amt_s = '免費'
    elif k in refund_ids:
        amt_s = '-' + fmt(r['amt'])
    else:
        amt_s = fmt(r['amt'])
    mem_s = f"M{member_no[r['mem']]:04d}" if r['mem'] >= 0 else ''
    out_rows.append({
        '交易編號': f"T{k + 1:06d}",
        '交易日期': date_s,
        '會員編號': mem_s,
        '門市': STORES[r['store']],
        '付款方式': PAYS[r['pay']],
        '實收金額': amt_s,
    })

doc = {'txn': {'name': '交易明細（模擬）', 'cols': COLS, 'rows': out_rows}}
text = json.dumps(doc, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
assert len(text) <= MAX_BYTES, f'檔案 {len(text)} bytes 超過 {MAX_BYTES}'
OUT.write_bytes(text)

# ---- 統計（給回報用）----
mem_rows = [r for r in out_rows if r['會員編號']]
amts = [r['實收金額'] for r in out_rows]
print('rows', N, 'members_with_rows', len({r['會員編號'] for r in mem_rows}))
print('walkin share', round(1 - len(mem_rows) / N, 4))
print('roc share', round(sum('/' in r['交易日期'] and int(r['交易日期'].split('/')[0]) < 1000 for r in out_rows) / N, 4))
print('comma share', round(sum(',' in a for a in amts) / N, 4))
print('refund', sum(a.startswith('-') for a in amts), 'free', sum(a == '免費' for a in amts), 'garbage', len(garb_ids))
print('days', days[0], days[-1], 'months', len({(d.year, d.month) for d in days}))
print('bytes', len(text))
