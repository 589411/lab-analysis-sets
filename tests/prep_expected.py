# 資料準備的期望值：用 pandas（groupby、to_period、reindex）獨立重算，不照抄 JS 的寫法。
# 日期解析用這裡自己寫的小函式；它的正確性由一張手寫對照表把關（答案是人工寫的，不是算出來的）。
# 輸出：tests/prep_expected.json
import json, math, re, pathlib, datetime as dt
from decimal import Decimal, ROUND_HALF_UP
import numpy as np
import pandas as pd

R = pathlib.Path(__file__).resolve().parent.parent
RAW = json.loads((R / 'data' / 'fixture_txn_messy.json').read_text(encoding='utf-8'))['txn']
EPOCH = dt.date(1970, 1, 1)
NAN = float('nan')

# ---------- 手寫對照表 ----------
# 金額：(輸入, 正確答案；None＝NaN)
NUM_TABLE = [
    ('1,280', 1280), ('1，280', 1280), ('  1,280  ', 1280), ('NT$1,280', 1280),
    ('1,280元', 1280), ('$3,500', 3500), ('-1,280', -1280), ('(1,200)', -1200),
    ('（1,200）', -1200), ('12%', 12), ('', None), ('免費', None), ('待補', None),
    ('0', 0), ('3.5', 3.5), ('2,500.75', 2500.75), ('1e3', None), ('-', None),
    ('1 000', 1000), ('NT 1,000元', 1000),
]
# 日期：(輸入, 正確的 ISO 日期；None＝NaN)
DATE_TABLE = [
    ('2026-01-05', '2026-01-05'), ('2026/1/5', '2026-01-05'), ('2026.1.5', '2026-01-05'),
    ('20260105', '2026-01-05'), ('2026-01-05 13:22:00', '2026-01-05'),
    ('2026-01-05T13:22:00', '2026-01-05'), ('2026年1月5日', '2026-01-05'),
    ('115/01/05', '2026-01-05'), ('115.1.5', '2026-01-05'), ('115-01-05', '2026-01-05'),
    ('民國115年1月5日', '2026-01-05'), ('1150105', '2026-01-05'), ('1/5/2026', '2026-01-05'),
    ('12/31/2025', '2025-12-31'), ('2025/3/7', '2025-03-07'), ('114/03/07', '2025-03-07'),
    ('2024/02/29', '2024-02-29'), ('2025/1/3 08:00', '2025-01-03'),
    ('1140307', '2025-03-07'), ('民國114年3月7日', '2025-03-07'),
    ('2025年12月31日 23:59', '2025-12-31'), ('２０２５/１/３', '2025-01-03'),
    ('2026-01-05 ', '2026-01-05'),
    # 應為 NaN
    ('2025/02/29', None), ('2025/02/30', None), ('2025/13/01', None), ('2025/13/40', None),
    ('待補', None), ('', None), ('12345', None), ('1150230', None), ('26/01/05', None),
    ('0', None), ('12345678', None), ('20251301', None), ('2025-00-10', None), ('1/5/115', None),
]


# ---------- 獨立的 Python 解析函式 ----------
def fix_digits(s):
    return ''.join(chr(ord(c) - 0xFEE0) if '０' <= c <= '９' else c for c in s)


def p_num(v):
    if v is None:
        return None
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return float(v) if math.isfinite(v) else None
    s = fix_digits(str(v))
    s = re.sub(r'\s', '', s)
    s = re.sub(r'NT', '', s, flags=re.I).replace('$', '').replace('元', '')
    s = re.sub(r'[,，]', '', s)
    s = re.sub(r'[%％]$', '', s)
    neg = False
    m = re.fullmatch(r'[(（](.*)[)）]', s)
    if m:
        neg, s = True, m.group(1)
    if not re.fullmatch(r'[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)', s):
        return None
    if neg and s[:1] in ('+', '-'):
        return None
    x = float(s)
    return -x if neg else x


def p_date(v):
    """回傳 datetime.date 或 None。"""
    if v is None:
        return None
    s = fix_digits(str(v)).strip()
    s = re.sub(r'(\s+|T)\d{1,2}:\d{1,2}(:\d{1,2}(\.\d+)?)?$', '', s).strip()

    def year_of(tok):
        n = int(tok)
        if len(tok) == 3:
            return n + 1911 if 1 <= n <= 199 else None
        if len(tok) == 4:
            return n if n >= 1000 else None
        return None

    def mk(y, mo, d):
        if y is None:
            return None
        try:
            return dt.date(y, mo, d)
        except ValueError:
            return None

    m = re.fullmatch(r'民國\s*([0-9]{1,3})\s*年\s*([0-9]{1,2})\s*月\s*([0-9]{1,2})\s*日', s)
    if m:
        y = int(m.group(1))
        return mk(y + 1911 if 1 <= y <= 199 else None, int(m.group(2)), int(m.group(3)))
    m = re.fullmatch(r'([0-9]{3,4})\s*年\s*([0-9]{1,2})\s*月\s*([0-9]{1,2})\s*日', s)
    if m:
        return mk(year_of(m.group(1)), int(m.group(2)), int(m.group(3)))
    m = re.fullmatch(r'([0-9]{3,4})([-/.])([0-9]{1,2})\2([0-9]{1,2})', s)
    if m:
        return mk(year_of(m.group(1)), int(m.group(3)), int(m.group(4)))
    m = re.fullmatch(r'([0-9]{1,2})([-/.])([0-9]{1,2})\2([0-9]{4})', s)
    if m:
        return mk(year_of(m.group(4)), int(m.group(1)), int(m.group(3)))
    if re.fullmatch(r'[0-9]+', s):
        if len(s) == 8:
            y = int(s[:4])
            return mk(y if y >= 1000 else None, int(s[4:6]), int(s[6:8]))
        if len(s) == 7:
            return mk(year_of(s[:3]), int(s[3:5]), int(s[5:7]))
    return None


def to_serial(d):
    return (d - EPOCH).days


def half_up(x):
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return None
    return float(Decimal(repr(float(x))).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP))


# ---------- 先驗證解析函式本身 ----------
bad = []
for inp, want in NUM_TABLE:
    got = p_num(inp)
    if (want is None and got is not None) or (want is not None and (got is None or abs(got - want) > 1e-12)):
        bad.append(('num', inp, want, got))
for inp, want in DATE_TABLE:
    got = p_date(inp)
    got_s = got.isoformat() if got else None
    if got_s != want:
        bad.append(('date', inp, want, got_s))
if bad:
    for b in bad:
        print('解析函式與手寫對照表不符：', b)
    raise SystemExit(1)
print(f'手寫對照表：金額 {len(NUM_TABLE)} 項、日期 {len(DATE_TABLE)} 項（其中 NaN {sum(1 for _, w in DATE_TABLE if w is None)} 項），Python 解析函式全部一致。')

# ---------- 用 pandas 算示範資料 ----------
COLS = RAW['cols']
df = pd.DataFrame(RAW['rows'], columns=COLS).fillna('')
df['d'] = [p_date(v) for v in df['交易日期']]
df['sd'] = [float(to_serial(d)) if d else np.nan for d in df['d']]
df['amt'] = [p_num(v) if p_num(v) is not None else np.nan for v in df['實收金額']]
df['cust'] = df['會員編號'].astype(str).str.strip()
df['ord'] = df['交易編號'].astype(str).str.strip()

bd = df['sd'].isna()
ba = ~bd & df['amt'].isna()
npos = ~bd & ~ba & (df['amt'] <= 0)
nocust = ~bd & ~ba & ~npos & (df['cust'] == '')
used_cust = ~bd & ~ba & ~npos & ~nocust     # 顧客類（customer／labeled）
used_series = ~bd & ~ba & ~npos             # 時間序列不看顧客

counts_base = {
    'total': len(df), 'badDate': int(bd.sum()), 'badAmount': int(ba.sum()),
    'nonPositive': int(npos.sum()),
}


def iso(serial):
    return (EPOCH + dt.timedelta(days=int(serial))).isoformat()


# 顧客彙總
u = df[used_cust]
g = u.groupby('cust')
cust_last = g['sd'].max()
cust_cnt = g['ord'].nunique()
cust_sum = g['amt'].sum()
as_of = float(u['sd'].max())
cust_rows = []
for c in sorted(cust_last.index):
    cnt = int(cust_cnt[c])
    cust_rows.append({
        '顧客': c, '最近購買天數': int(as_of - cust_last[c]), '購買次數': cnt,
        '平均客單': half_up(cust_sum[c] / cnt), '累積金額': half_up(cust_sum[c]),
    })
cust_report = dict(counts_base, used=int(used_cust.sum()), noCustomer=int(nocust.sum()),
                   customers=len(cust_rows), firstDate=iso(u['sd'].min()), lastDate=iso(as_of),
                   asOf=iso(as_of))
assert cust_report['total'] == cust_report['used'] + cust_report['badDate'] + cust_report['badAmount'] \
    + cust_report['nonPositive'] + cust_report['noCustomer']

# 時間序列
series_out = {}
su = df[used_series].copy()
su['date'] = pd.to_datetime([EPOCH + dt.timedelta(days=int(x)) for x in su['sd']])
for period, freq in [('month', 'M'), ('week', 'W-SUN'), ('day', 'D')]:
    per = su['date'].dt.to_period(freq)
    agg = su.groupby(per).agg(rev=('amt', 'sum'), cnt=('ord', 'nunique'))
    full = pd.period_range(per.min(), per.max(), freq=freq)
    agg = agg.reindex(full, fill_value=0)
    first_day = su['date'].min().date()
    last_day = su['date'].max().date()
    for drop in (True, False):
        keep = agg
        dropped = []
        if drop:
            if first_day != full[0].start_time.date():
                dropped.append(full[0])
            if last_day != full[-1].end_time.date():
                dropped.append(full[-1])
            keep = agg.drop(index=dropped)
        labels = [p.strftime('%Y-%m') if freq == 'M' else p.start_time.strftime('%Y-%m-%d')
                  for p in keep.index]
        series_out[f'{period}_{"drop" if drop else "keep"}'] = {
            'labels': labels,
            'rev': [half_up(x) for x in keep['rev']],
            'cnt': [int(x) for x in keep['cnt']],
            'periods': len(labels),
            'filledZero': int((keep['cnt'] == 0).sum()),
            'droppedPartial': [(p.strftime('%Y-%m') if freq == 'M' else p.start_time.strftime('%Y-%m-%d'))
                               for p in dropped],
        }
series_report = dict(counts_base, used=int(used_series.sum()), noCustomer=0)

# 有答案的顧客表
lab_used = u  # 同顧客類的有效列
lastd = float(lab_used['sd'].max())
lab_out = {}
for W in (90, 60):
    cutoff = lastd - W
    assert lastd >= cutoff + W
    feats = lab_used[lab_used['sd'] <= cutoff]
    fg = feats.groupby('cust')
    f_last, f_cnt, f_sum = fg['sd'].max(), fg['ord'].nunique(), fg['amt'].sum()
    back = set(lab_used[(lab_used['sd'] > cutoff) & (lab_used['sd'] <= cutoff + W)]['cust'])
    rows = []
    for c in sorted(f_last.index):
        cnt = int(f_cnt[c])
        rows.append({'顧客': c, '最近購買天數': int(cutoff - f_last[c]), '購買次數': cnt,
                     '平均客單': half_up(f_sum[c] / cnt), '之後回購': 1 if c in back else 0})
    lab_out[f'w{W}'] = {
        'rows': rows, 'cutoff': iso(cutoff), 'windowDays': W,
        'positives': sum(r['之後回購'] for r in rows), 'customers': len(rows),
    }

# ---------- 界定範圍（pandas 用遮罩獨立算，不照抄 JS 的逐列迴圈） ----------
# 規則用 AND；同一列被多條排除只記在最前面那條，所以 perRule 依規則順序逐步算。
dts = df['d'].map(lambda x: pd.Timestamp(x) if x is not None else pd.NaT)
amt_all = df['amt'].astype(float)
store_all = df['門市'].astype(str).str.strip()
SC_STORES = ['林口店', '士林店']
SC_LO, SC_HI = pd.Timestamp(dt.date(2025, 6, 1)), pd.Timestamp(dt.date(2026, 3, 31))
SC_MIN, SC_MAX = 1000.0, 3000.0

m_store = store_all.isin(SC_STORES).to_numpy()
m_date = (dts.isna() | ((dts >= SC_LO) & (dts <= SC_HI))).to_numpy()
m_num = (amt_all.isna() | ((amt_all >= SC_MIN) & (amt_all <= SC_MAX))).to_numpy()


def per_rule(masks):
    alive = np.ones(len(df), dtype=bool)
    per = []
    for m in masks:
        per.append(int((alive & ~m).sum()))
        alive = alive & m
    return per, int(alive.sum()), int((~alive).sum())


def report_counts(mask, needs_customer=True):
    """留下的列依 badDate → badAmount → nonPositive → noCustomer → used 歸類（同 SPEC_PREP 的順序）。"""
    bd_all = dts.isna().to_numpy()
    ba_all = amt_all.isna().to_numpy()
    np_all = (amt_all <= 0).to_numpy()
    nc_all = (df['cust'] == '').to_numpy()
    m = np.asarray(mask, dtype=bool)
    bd = int((bd_all & m).sum())
    ba = int((~bd_all & ba_all & m).sum())
    npos = int((~bd_all & ~ba_all & np_all & m).sum())
    nc = int((~bd_all & ~ba_all & ~np_all & nc_all & m).sum()) if needs_customer else 0
    used = int(m.sum()) - bd - ba - npos - nc
    return {'total': int(m.sum()), 'badDate': bd, 'badAmount': ba, 'nonPositive': npos,
            'noCustomer': nc, 'used': used}


SCOPE_CASES = {
    'in_store': [m_store],
    'date_range': [m_date],
    'num_range': [m_num],
    'combined_store_date_num': [m_store, m_date, m_num],
    'combined_num_date_store': [m_num, m_date, m_store],
}
scope_out = {}
for name, masks in SCOPE_CASES.items():
    per, kept_n, out_n = per_rule(masks)
    kept_mask = masks[0].copy()
    for mm in masks[1:]:
        kept_mask = kept_mask & mm
    scope_out[name] = {'out': out_n, 'perRule': per, 'kept': kept_n,
                       'report': report_counts(kept_mask)}
    assert out_n + kept_n == len(df)
    assert sum(per) == out_n

# ---------- 驗收數字：示範明細 demo_txn（8,000 列，pandas 獨立重算） ----------
DEMO_RAW = json.loads((R / 'data' / 'demo_txn.json').read_text(encoding='utf-8'))['txn']
dd = pd.DataFrame(DEMO_RAW['aoa'], columns=DEMO_RAW['cols']).fillna('')
dd_dates = [p_date(v) for v in dd['txn_datetime']]
dd_ts = pd.Series([pd.Timestamp(x) if x is not None else pd.NaT for x in dd_dates])
dd_amt = pd.Series([p_num(v) if p_num(v) is not None else np.nan for v in dd['total_amount']]).astype(float)
dd_store = dd['channel'].astype(str).str.strip()
dd_cust = dd['member_id'].astype(str).str.strip()
m_channel = dd_store.isin(['store']).to_numpy()
rule_out = int((~m_channel).sum())
kept_channel = int(m_channel.sum())
bd_d = dd_ts.isna().to_numpy()
ba_d = dd_amt.isna().to_numpy()
np_d = (dd_amt <= 0).to_numpy()
nc_d = (dd_cust == '').to_numpy()
k = m_channel
acc_bad_date = int((bd_d & k).sum())
acc_bad_amt = int((~bd_d & ba_d & k).sum())
acc_npos = int((~bd_d & ~ba_d & np_d & k).sum())
acc_nc = int((~bd_d & ~ba_d & ~np_d & nc_d & k).sum())
acc_used = kept_channel - acc_bad_date - acc_bad_amt - acc_npos - acc_nc
acc_series_used = kept_channel - acc_bad_date - acc_bad_amt - acc_npos   # 時間序列不看顧客
assert len(dd) == 8000
assert len(dd) == rule_out + acc_used + acc_npos + acc_nc, '驗收等式不成立'
ACCEPT = {'total': len(dd), 'rule_out': rule_out, 'kept': kept_channel,
          'nonPositive': acc_npos, 'noCustomer': acc_nc, 'used': acc_used,
          'badDate': acc_bad_date, 'badAmount': acc_bad_amt, 'series_used': acc_series_used}
print('驗收數字（pandas）：', ACCEPT)

# ---------- 寫出 ----------
expected = {
    'scope': scope_out,
    'acceptance': ACCEPT,
    'num': [[a, b] for a, b in NUM_TABLE],
    'parseDate': [[a, b] for a, b in DATE_TABLE],
    'profile': [],
    'customer': {'report': cust_report, 'rows': cust_rows},
    'series': series_out,
    'series_report': series_report,
    'labeled': lab_out,
}
for col in COLS:
    raw = df[col]
    vals = [str(v).strip() for v in raw if str(v).strip() != '']
    L = len(vals)
    nd = sum(p_date(v) is not None for v in vals)
    nn = sum(p_num(v) is not None for v in vals)
    if L == 0:
        kind = 'text'
    elif nd * 5 >= L * 4:
        kind = 'date'
    elif nn * 5 >= L * 4:
        kind = 'number'
    else:
        kind = 'text'
    uniq = len(set(vals))
    expected['profile'].append({
        'col': col, 'kind': kind, 'n': len(raw), 'missing': len(raw) - L, 'unique': uniq,
        'idLike': L >= 20 and uniq * 100 >= L * 95, 'sample': vals[:3],
    })

out = R / 'tests' / 'prep_expected.json'
out.write_text(json.dumps(expected, ensure_ascii=False, indent=1), encoding='utf-8')
print('寫出', out)
print('顧客類：', cust_report)
print('時間序列（月，丟不完整期）：', {k: series_out['month_drop'][k] for k in ('periods', 'filledZero', 'droppedPartial')})
print('有答案表：', {k: {kk: v[kk] for kk in ('cutoff', 'customers', 'positives')} for k, v in lab_out.items()})
