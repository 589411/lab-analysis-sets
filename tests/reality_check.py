# 真實使用者視角測試：用 Playwright 操作 dist/frozen.html（只測這個檔），資料來自 sunlit-retail-sim（唯讀）。
# 用法：python3 tests/reality_check.py   （不會 build，不修改 src/ data/ 或既有 tests/）
# 產出：shots/rc_*.png（截圖）、/tmp/rc_log.json（原始紀錄，不在專案內）、終端機上的 PASS/FAIL 列表。
import json, pathlib, re, time, datetime as dt, traceback
import pandas as pd
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

R = pathlib.Path(__file__).resolve().parent.parent
DIST = R / 'dist' / 'frozen.html'
SHOTS = R / 'shots'
SHOTS.mkdir(exist_ok=True)
DATA = pathlib.Path('/home/claude/sunlit-retail-sim/data')
TMP = pathlib.Path('/tmp/rc_inputs')
TMP.mkdir(parents=True, exist_ok=True)
LOG_PATH = pathlib.Path('/tmp/rc_log.json')

TX = DATA / 'transactions.csv'
MEM = DATA / 'members.csv'
ITEMS = DATA / 'txn_items.csv'
PROD = DATA / 'products.csv'
STORES = DATA / 'stores.csv'
REVIEWS = DATA / 'reviews.csv'

LOG = []
CHECKS = []
CLIP_JS = """
(function(){ try { Object.defineProperty(navigator,'clipboard',{configurable:true,value:{
  writeText:function(t){ window.__clip=String(t); return Promise.resolve(); },
  readText:function(){ return Promise.resolve(window.__clip||''); } }}); } catch(e){} })();
"""

SNAP_JS = r"""() => {
  const t = e => (e ? (e.innerText || e.textContent || '') : '').replace(/\s+/g, ' ').trim();
  const q = s => Array.from(document.querySelectorAll(s));
  const seg = q('.seg').map(s => ({label: s.getAttribute('aria-label'),
    pressed: Array.from(s.querySelectorAll('button[aria-pressed="true"]')).map(t)}));
  const prepSel = ['prep-date','prep-customer','prep-amount','prep-order','prep-period','prep-drop','prep-window'].map(id => {
    const e = document.getElementById(id); if (!e) return null;
    return {id: id, value: e.type === 'checkbox' ? String(e.checked) : e.value,
            text: e.tagName === 'SELECT' ? t(e.options[e.selectedIndex]) : ''};
  }).filter(Boolean);
  const roles = q('select[id^="role-"]').map(e => ({id: e.id, value: e.value}))
    .concat(q('input[id^="role-"]:checked').map(e => ({id: e.id, checked: t(e.closest('label'))})));
  const params = q('input[id^="p-"], select[id^="p-"]').map(e => ({id: e.id, value: e.value,
    label: t(document.querySelector('label[for="' + e.id + '"]'))}));
  return {
    title: document.title, seg: seg, prepSel: prepSel, roles: roles, params: params,
    prepHints: q('.prep .hint, .prep-res .hint, .prep-warn, .prep-res > p').map(t),
    recon: q('.recon').map(e => ({text: t(e), total: e.getAttribute('data-total'), sum: e.getAttribute('data-sum')})),
    dataHint: q('p.hint').map(t).filter(x => x.indexOf('目前分析用的表') === 0),
    errs: q('.err').map(t),
    notice: q('.prep .hint').map(t).filter(x => x.indexOf('已套用') >= 0),
    metrics: q('.metric').map(t),
    say: q('.say p').map(t),
    tblTitles: q('.tblbar span').map(t),
    chartTitles: q('.chart .ct span').map(t)
  };
}"""

# ---------------- 期望值（pandas，全部 8,000 列、不篩選） ----------------
def pdate(s):
    m = re.match(r'^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})', str(s).strip())
    return dt.date(int(m[1]), int(m[2]), int(m[3])) if m else None

def load_tx(path=TX, n=None):
    df = pd.read_csv(path, encoding='utf-8-sig', dtype=str, keep_default_na=False)
    if n is not None:
        df = df.iloc[:n]
    df['d'] = df.txn_datetime.map(pdate)
    df['a'] = df.total_amount.astype(float)
    df['m'] = df.member_id.str.strip()
    return df

def exp_customers(df):
    u = df[(df.a > 0) & (df.m != '')]
    asof = u.d.max()
    rows = []
    for m, g in u.groupby('m'):
        n = len(g); s = round(g.a.sum(), 2)
        rows.append([m, (asof - g.d.max()).days, n, round(s / n, 2), s])
    return sorted(rows, key=lambda r: r[0])

def exp_labeled(df, W):
    u = df[(df.a > 0) & (df.m != '')]
    cutoff = u.d.max() - dt.timedelta(days=W)
    feat = u[u.d <= cutoff]
    back = set(u[(u.d > cutoff) & (u.d <= cutoff + dt.timedelta(days=W))].m)
    rows = []
    for m, g in feat.groupby('m'):
        n = len(g); s = round(g.a.sum(), 2)
        rows.append([m, (cutoff - g.d.max()).days, n, round(s / n, 2), 1 if m in back else 0])
    rows = sorted(rows, key=lambda r: r[0])
    return {'rows': rows, 'cutoff': cutoff.isoformat(), 'pos': sum(r[4] for r in rows), 'n': len(rows)}

def period_start(d, period):
    if period == 'month': return dt.date(d.year, d.month, 1)
    if period == 'week': return d - dt.timedelta(days=d.weekday())
    return d

def period_end(s, period):
    if period == 'month':
        ny, nm = (s.year + (1 if s.month == 12 else 0), 1 if s.month == 12 else s.month + 1)
        return dt.date(ny, nm, 1) - dt.timedelta(days=1)
    if period == 'week': return s + dt.timedelta(days=6)
    return s

def next_start(s, period):
    if period == 'month': return period_end(s, 'month') + dt.timedelta(days=1)
    if period == 'week': return s + dt.timedelta(days=7)
    return s + dt.timedelta(days=1)

def exp_series(df, period, drop=True):
    p = df[df.a > 0].copy()
    first, last = p.d.min(), p.d.max()
    s0, s1 = period_start(first, period), period_start(last, period)
    starts, s = [], s0
    while s <= s1:
        starts.append(s); s = next_start(s, period)
    kept = list(starts); dropped = []
    if drop and first != s0 and len(kept) > 1:
        dropped.append(kept.pop(0))
    if drop and last != period_end(s1, period) and len(kept) > 1:
        dropped.append(kept.pop())
    p['ps'] = p.d.map(lambda d: period_start(d, period))
    agg = p.groupby('ps').agg(rev=('a', 'sum'), n=('txn_id', 'nunique'))
    rows, filled = [], 0
    for s in kept:
        if s in agg.index:
            rows.append([s.strftime('%Y-%m') if period == 'month' else s.isoformat(), round(float(agg.loc[s, 'rev']), 2), int(agg.loc[s, 'n'])])
        else:
            filled += 1
            rows.append([s.strftime('%Y-%m') if period == 'month' else s.isoformat(), 0, 0])
    return {'rows': rows, 'dropped': [(d.strftime('%Y-%m') if period == 'month' else d.isoformat()) for d in dropped],
            'filled': filled, 'first': first.isoformat(), 'last': last.isoformat(), 'total_rev': round(p.a.sum(), 2)}

EXP = {}
def build_expectations():
    df = load_tx()
    EXP['df'] = df
    EXP['cust'] = exp_customers(df)
    EXP['lab90'] = exp_labeled(df, 90)
    EXP['lab180'] = exp_labeled(df, 180)
    EXP['month'] = exp_series(df, 'month')
    EXP['week'] = exp_series(df, 'week')
    EXP['day'] = exp_series(df, 'day')
    u = df[df.a > 0]
    EXP['recon'] = {
        'total': len(df), 'nonpos': int((df.a <= 0).sum()),
        'pos': len(u), 'pos_nomember': int((u.m == '').sum()),
        'pos_member': int((u.m != '').sum()), 'customers': len(EXP['cust']),
        'months': u.d.map(lambda d: (d.year, d.month)).nunique(),
        'store_pos_walkin': int(((u.channel == 'store') & (u.m == '')).sum()),
        'online_rows': int((df.channel == 'online').sum()),
    }
    # 迴歸用：total_amount 與 discount_amount 的相關（只為了判斷畫面的結論有沒有依據）
    import numpy as np
    x = df.total_amount.astype(float).values; y = df.discount_amount.astype(float).values
    EXP['corr_total_disc'] = float(np.corrcoef(x, y)[0, 1])
    EXP['pos_disc_zero'] = int((df.discount_amount.astype(float) == 0).sum())

# ---------------- 比對工具 ----------------
def check(name, ok, detail=''):
    CHECKS.append({'name': name, 'ok': bool(ok), 'detail': str(detail)})
    print(('PASS' if ok else 'FAIL'), '-', name, '|', str(detail)[:300], flush=True)

def tsv_rows(txt):
    lines = [l for l in txt.split('\n') if l != '']
    return lines[0].split('\t'), [l.split('\t') for l in lines[1:]]

def near(a, b, tol=0.011):
    try:
        return abs(float(a) - float(b)) <= tol
    except Exception:
        return False

def cmp_table(txt, cols, rows):
    if not txt:
        return False, '沒有複製到表格'
    head, got = tsv_rows(txt)
    if head != cols:
        return False, '欄位不同：%s' % head
    if len(got) != len(rows):
        return False, '列數 %d，期望 %d' % (len(got), len(rows))
    bad = []
    for i, (g, e) in enumerate(zip(got, rows)):
        for j, (a, b) in enumerate(zip(g, e)):
            ok = (a == b) if isinstance(b, str) else near(a, b)
            if not ok:
                bad.append('第%d列 %s：畫面 %s / 期望 %s' % (i + 1, cols[j], a, b)); break
        if len(bad) >= 3: break
    if bad:
        return False, '不一致：' + '；'.join(bad)
    return True, '%d 列全部一致' % len(rows)

def ps(snap):
    return {x['id']: x for x in snap.get('prepSel', [])}

def pressed(snap, label):
    for s in snap.get('seg', []):
        if s['label'] == label:
            return s['pressed']
    return []

def recon_first(snap):
    for r in snap.get('recon', []):
        if r.get('total') is not None:
            return r
    return None

# ---------------- 瀏覽器操作 ----------------
MARK_JS = "() => document.querySelectorAll('.say,.err').forEach(e=>e.setAttribute('data-old','1'))"
DONE_JS = "() => !!document.querySelector('.say:not([data-old]), .err:not([data-old])')"

def act(pg, fn, timeout_s=120):
    pg.evaluate(MARK_JS)
    t0 = time.time()
    fn()
    try:
        pg.wait_for_function(DONE_JS, timeout=timeout_s * 1000, polling=200)
        ok = True
    except PWTimeout:
        ok = False
    return round(time.time() - t0, 2), ok

def snapshot(pg, errs, start):
    d = pg.evaluate(SNAP_JS)
    d['pageerrors'] = errs[start:]
    return d

def open_page(ctx, sid):
    pg = ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
    pg.on('console', lambda m: errs.append('console.error: ' + m.text) if m.type == 'error' else None)
    pg.goto(DIST.as_uri() + '#' + sid)
    pg.wait_for_selector('.panel')
    pg.wait_for_timeout(300)
    return pg, errs

def new_ctx(browser):
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=1)
    ctx.add_init_script(CLIP_JS)
    return ctx

def clip(pg):
    pg.evaluate("() => { window.__clip = null; }")
    try:
        pg.get_by_role('button', name='複製整理後的表', exact=True).click()
        pg.wait_for_timeout(150)
        return pg.evaluate("() => window.__clip || ''")
    except Exception as e:
        return ''

def log(step, sid, file, ms, ok, snap, errs_extra=None, shot=None, note=''):
    rec = {'step': step, 'set': sid, 'file': file, 'elapsed_s': ms, 'finished': ok,
           'note': note, 'snap': snap, 'shot': shot}
    LOG.append(rec)
    say = snap.get('say', []) if snap else []
    rc = recon_first(snap) if snap else None
    print('--- [%s] set=%s file=%s elapsed=%ss finished=%s' % (step, sid, file, ms, ok), flush=True)
    if rc: print('    recon:', rc['text'][:200], flush=True)
    for s in say[:3]: print('    say:', s[:200], flush=True)
    for e in (snap or {}).get('errs', []): print('    ERR:', e[:200], flush=True)
    for e in (snap or {}).get('pageerrors', []): print('    PAGEERR:', e[:200], flush=True)
    return rec

def upload(pg, errs, path, step, sid, shot, timeout_s=240, note=''):
    pg.get_by_role('button', name='上傳檔案', exact=True).click()
    pg.wait_for_selector('#f-file')
    start = len(errs)
    ms, ok = act(pg, lambda: pg.set_input_files('#f-file', str(path)), timeout_s)
    pg.wait_for_timeout(2700)
    snap = snapshot(pg, errs, start)
    if shot:
        pg.screenshot(path=str(SHOTS / shot), full_page=True)
    return log(step, sid, path.name, ms, ok, snap, shot=shot, note=note)

def paste(pg, errs, text, step, sid, shot, timeout_s=240):
    pg.get_by_role('button', name='貼上', exact=True).click()
    pg.wait_for_selector('#f-paste')
    pg.fill('#f-paste', text)
    start = len(errs)
    ms, ok = act(pg, lambda: pg.get_by_role('button', name='使用這份資料', exact=True).click(), timeout_s)
    pg.wait_for_timeout(2700)
    snap = snapshot(pg, errs, start)
    if shot:
        pg.screenshot(path=str(SHOTS / shot), full_page=True)
    return log(step, sid, '貼上(%d 字元)' % len(text), ms, ok, snap, shot=shot)

def set_mode(pg, label):
    pg.get_by_role('button', name=label, exact=True).click()
    pg.wait_for_timeout(200)

# ---------------- 測試步驟 ----------------
def step1_txn_sets(browser, pages):
    SETS = [('kmeans', 'customer'), ('hier', 'customer'), ('dbscan', 'customer'),
            ('logit', 'labeled'), ('tree', 'labeled'), ('knn', 'labeled'),
            ('baseline', 'series'), ('holt', 'series'), ('season', 'series')]
    for sid, needs in SETS:
        try:
            ctx = new_ctx(browser)
            pg, errs = open_page(ctx, sid)
            rec = upload(pg, errs, TX, '1-分群分類預測', sid, 'rc_%s_tx.png' % sid,
                         timeout_s=240 if sid in ('hier', 'dbscan', 'knn') else 120)
            s = rec['snap']
            p = ps(s)
            check('[%s] 自動猜欄位：日期=txn_datetime' % sid, p.get('prep-date', {}).get('value') == 'txn_datetime', p.get('prep-date'))
            check('[%s] 自動猜欄位：金額=total_amount' % sid, p.get('prep-amount', {}).get('value') == 'total_amount', p.get('prep-amount'))
            check('[%s] 自動猜欄位：訂單=txn_id' % sid, p.get('prep-order', {}).get('value') == 'txn_id', p.get('prep-order'))
            if needs != 'series':
                check('[%s] 自動猜欄位：顧客=member_id' % sid, p.get('prep-customer', {}).get('value') == 'member_id', p.get('prep-customer'))
            check('[%s] 自動進入「是交易明細」模式' % sid, '是交易明細，幫我彙總' in pressed(s, '資料準備方式'), pressed(s, '資料準備方式'))
            rc = recon_first(s)
            check('[%s] 對帳總列數 8,000' % sid, rc and rc['total'] == '8000', rc and (rc['total'], rc['sum']))
            check('[%s] 對帳等式兩邊相等' % sid, rc and rc['total'] == rc['sum'], rc and (rc['total'], rc['sum']))
            r = EXP['recon']
            if needs == 'series':
                want = ['用來計算 %s' % format(r['pos'], ','), '金額 ≤ 0（退貨或贈品） %d' % r['nonpos']]
            else:
                want = ['用來計算 %s' % format(r['pos_member'], ','), '沒有顧客編號（散客） %s' % format(r['pos_nomember'], ','),
                        '金額 ≤ 0（退貨或贈品） %d' % r['nonpos']]
            txt = rc['text'] if rc else ''
            check('[%s] 對帳各項數字' % sid, all(w in txt for w in want), '期望含 %s；畫面：%s' % (want, txt[:200]))
            # 整理後的表逐列比對
            tsv = clip(pg)
            if needs == 'customer':
                ok, d = cmp_table(tsv, ['顧客', '最近購買天數', '購買次數', '平均客單', '累積金額'], EXP['cust'])
            elif needs == 'labeled':
                ok, d = cmp_table(tsv, ['顧客', '最近購買天數', '購買次數', '平均客單', '之後回購'], EXP['lab90']['rows'])
            else:
                exp_rows = EXP['month']['rows']
                ok, d = cmp_table(tsv, ['期別', '營收', '交易筆數'], exp_rows)
            check('[%s] 整理後的表與 pandas 逐列比對' % sid, ok, d)
            hint = ' '.join(s.get('prepHints', []))
            if needs == 'customer':
                check('[%s] 顧客數 1,200' % sid, '整理成 1,200 位顧客' in hint, hint[:160])
            if needs == 'labeled':
                want_h = '整理成 %s 位顧客，其中 %s 位在之後 90 天內再買。' % (format(EXP['lab90']['n'], ','), format(EXP['lab90']['pos'], ','))
                check('[%s] 有答案的顧客表人數與回購人數' % sid, want_h in hint, '期望「%s」；畫面 %s' % (want_h, hint[:200]))
            if needs == 'series':
                check('[%s] 月數 18' % sid, '整理成 18 個月' in hint, hint[:200])
            check('[%s] 沒有紅色錯誤框' % sid, not s['errs'], s['errs'])
            check('[%s] 沒有 pageerror 或 console error' % sid, not s['pageerrors'], s['pageerrors'][:3])
            pages[sid] = (ctx, pg, errs)
        except Exception as e:
            check('[%s] 步驟執行' % sid, False, traceback.format_exc()[-400:])

def step2_regress(browser):
    for sid in ('linear', 'multi', 'poly'):
        try:
            ctx = new_ctx(browser)
            pg, errs = open_page(ctx, sid)
            rec = upload(pg, errs, TX, '2-回歸', sid, 'rc_%s_tx.png' % sid)
            s = rec['snap']
            check('[%s] 沒有紅色錯誤框' % sid, not s['errs'], s['errs'])
            check('[%s] 沒有 pageerror' % sid, not s['pageerrors'], s['pageerrors'][:3])
            ctx.close()
        except Exception:
            check('[%s] 步驟執行' % sid, False, traceback.format_exc()[-400:])

def step3_members(browser):
    for sid in ('kmeans', 'logit'):
        try:
            ctx = new_ctx(browser)
            pg, errs = open_page(ctx, sid)
            rec = upload(pg, errs, MEM, '3-members', sid, 'rc_members_%s.png' % sid)
            s = rec['snap']
            check('[members %s] 資料準備預設為「已經整理好」' % sid, pressed(s, '資料準備方式') == ['已經整理好'], pressed(s, '資料準備方式'))
            check('[members %s] 沒有紅色錯誤框' % sid, not s['errs'], s['errs'])
            ctx.close()
        except Exception:
            check('[members %s] 步驟執行' % sid, False, traceback.format_exc()[-400:])

def step4_items(browser):
    for sid in ('kmeans', 'season'):
        try:
            ctx = new_ctx(browser)
            pg, errs = open_page(ctx, sid)
            rec = upload(pg, errs, ITEMS, '4-items', sid, 'rc_items_%s.png' % sid)
            s = rec['snap']
            check('[items %s] 未自動視為交易明細' % sid, '是交易明細，幫我彙總' not in pressed(s, '資料準備方式'), pressed(s, '資料準備方式'))
            # 使用者若改選「交易明細」：這份資料沒有日期欄與顧客欄，看看會發生什麼
            pg.get_by_role('button', name='是交易明細，幫我彙總', exact=True).click()
            pg.wait_for_timeout(500)
            s2 = snapshot(pg, errs, 0)
            pg.screenshot(path=str(SHOTS / ('rc_items_%s_forced.png' % sid)), full_page=True)
            LOG.append({'step': '4-items-forced', 'set': sid, 'snap': s2, 'shot': 'rc_items_%s_forced.png' % sid})
            print('--- [4-items-forced] set=%s hints=%s' % (sid, s2.get('prepHints', [])[:4]), flush=True)
            ctx.close()
        except Exception:
            check('[items %s] 步驟執行' % sid, False, traceback.format_exc()[-400:])

def step5_unfit(browser):
    cases = [('linear', PROD, 'products'), ('kmeans', STORES, 'stores'), ('season', REVIEWS, 'reviews')]
    for sid, path, nm in cases:
        try:
            ctx = new_ctx(browser)
            pg, errs = open_page(ctx, sid)
            rec = upload(pg, errs, path, '5-unfit', sid, 'rc_unfit_%s_%s.png' % (nm, sid), timeout_s=60)
            s = rec['snap']
            check('[%s→%s] 有給白話錯誤或結果（不是程式例外）' % (nm, sid), (not s['pageerrors']), s['errs'] or s['say'][:1] or s['pageerrors'][:1])
            ctx.close()
        except Exception:
            check('[%s→%s] 步驟執行' % (nm, sid), False, traceback.format_exc()[-400:])

def step6_big5(browser):
    raw = TX.read_bytes().decode('utf-8-sig')
    plain = TMP / 'transactions_big5.csv'
    plain.write_bytes(raw.encode('big5'))
    zh_head = {'txn_id': '訂單編號', 'txn_datetime': '交易時間', 'store_id': '門市代號', 'member_id': '會員編號',
               'channel': '通路', 'payment_method': '付款方式', 'total_amount': '實收金額',
               'discount_amount': '折扣金額', 'campaign_id': '活動代號', 'is_return': '是否退貨'}
    lines = raw.splitlines()
    head = lines[0].split(',')
    zh = ','.join(zh_head.get(h, h) for h in head) + '\n' + '\n'.join(lines[1:]) + '\n'
    zhf = TMP / 'transactions_big5_zh.csv'
    zhf.write_bytes(zh.encode('cp950'))
    try:
        ctx = new_ctx(browser)
        pg, errs = open_page(ctx, 'kmeans')
        rec = upload(pg, errs, plain, '6-big5', 'kmeans', 'rc_big5_plain_kmeans.png')
        s = rec['snap']
        tsv = clip(pg)
        ok, d = cmp_table(tsv, ['顧客', '最近購買天數', '購買次數', '平均客單', '累積金額'], EXP['cust'])
        check('[Big5 純轉檔] 讀進來，結果與 UTF-8 逐列一致', ok and not s['errs'], d)
        ctx.close()
        ctx = new_ctx(browser)
        pg, errs = open_page(ctx, 'kmeans')
        rec = upload(pg, errs, zhf, '6-big5', 'kmeans', 'rc_big5_zh_kmeans.png')
        s = rec['snap']
        p = ps(s)
        check('[Big5 中文欄名] 自動猜：日期/顧客/金額/訂單', (p.get('prep-date', {}).get('value'), p.get('prep-customer', {}).get('value'),
              p.get('prep-amount', {}).get('value'), p.get('prep-order', {}).get('value')) == ('交易時間', '會員編號', '實收金額', '訂單編號'), [p.get(k, {}).get('value') for k in ('prep-date', 'prep-customer', 'prep-amount', 'prep-order')])
        tsv = clip(pg)
        ok, d = cmp_table(tsv, ['顧客', '最近購買天數', '購買次數', '平均客單', '累積金額'], EXP['cust'])
        check('[Big5 中文欄名] 整理後的表與 pandas 逐列比對', ok, d)
        ctx.close()
    except Exception:
        check('[Big5] 步驟執行', False, traceback.format_exc()[-400:])

def step7_paste(browser, pages):
    raw = TX.read_text(encoding='utf-8-sig')
    assert '"' not in raw
    lines = raw.splitlines()
    tsv300 = '\n'.join(l.replace(',', '\t') for l in lines[:301])
    try:
        ctx = new_ctx(browser)
        pg, errs = open_page(ctx, 'season')
        rec = paste(pg, errs, tsv300, '7-paste300', 'season', 'rc_paste300_season.png')
        s = rec['snap']
        exp = exp_series(EXP['df'].iloc[:300].reset_index(drop=True), 'month')
        n_kept = len(exp['rows'])
        det = 'pandas：期間 %s 到 %s，月的期數 %d，丟掉 %s' % (exp['first'], exp['last'], n_kept, exp['dropped'])
        if n_kept < 2:
            check('[貼上前300列] 月的期數不足時給出白話說明（pandas：丟掉不完整月後剩 0 期）', any('只剩 0 期' in e for e in s['errs']), s['errs'] + [det])
        else:
            check('[貼上前300列] 月的結果與 pandas 一致', not s['errs'], det)
        check('[貼上前300列] 沒有程式例外', not s['pageerrors'], s['pageerrors'][:3])
        pages['paste'] = (ctx, pg, errs)
    except Exception:
        check('[貼上300] 步驟執行', False, traceback.format_exc()[-400:])

def step8_period_window(browser, pages):
    # 8a：完整資料的 season 切週、切日
    try:
        ctx, pg, errs = pages['season']
        for per, lab in (('week', '週'), ('day', '日')):
            ms, ok = act(pg, lambda: pg.select_option('#prep-period', per), 240)
            pg.wait_for_timeout(2700)
            s = snapshot(pg, errs, 0)
            pg.screenshot(path=str(SHOTS / ('rc_season_%s.png' % per)), full_page=True)
            LOG.append({'step': '8-period-' + per, 'set': 'season', 'elapsed_s': ms, 'finished': ok, 'snap': s,
                        'shot': 'rc_season_%s.png' % per})
            print('--- [8-period %s] elapsed=%ss finished=%s' % (per, ms, ok), flush=True)
            print('    hints:', [h for h in s['prepHints'] if '整理成' in h or '丟掉' in h or '補了' in h][:2], flush=True)
            print('    errs:', s['errs'], flush=True)
            if s['say']: print('    say:', s['say'][0][:200], flush=True)
            exp = EXP[per]
            tsv = clip(pg)
            okc, d = cmp_table(tsv, ['期別', '營收', '交易筆數'], exp['rows'])
            check('[season %s] 整理後的表與 pandas 逐列比對' % per, okc, d + '；pandas 丟掉 ' + str(exp['dropped']))
            check('[season %s] 切換後有出結果（耗時 %s 秒）' % (per, ms), ok and not s['errs'], s['errs'] or '')
    except Exception:
        check('[season 切週/日] 步驟執行', False, traceback.format_exc()[-400:])
    # 8b：logit 把窗口拉到 180
    try:
        ctx, pg, errs = pages['logit']
        ms, ok = act(pg, lambda: pg.evaluate("() => { const e=document.getElementById('prep-window'); e.value='180'; e.dispatchEvent(new Event('input',{bubbles:true})); }"), 60)
        pg.wait_for_timeout(2700)
        s = snapshot(pg, errs, 0)
        pg.screenshot(path=str(SHOTS / 'rc_logit_w180.png'), full_page=True)
        LOG.append({'step': '8-logit-180', 'set': 'logit', 'elapsed_s': ms, 'finished': ok, 'snap': s, 'shot': 'rc_logit_w180.png'})
        print('--- [8-logit-180] finished=%s' % ok, flush=True)
        print('    prepSel:', [x for x in s['prepSel'] if x['id'] == 'prep-window'], flush=True)
        print('    hints:', [h for h in s['prepHints'] if '切點' in h or '整理成' in h][:2], flush=True)
        print('    say:', s['say'][:1], flush=True)
        tsv = clip(pg)
        exp = EXP['lab180']
        okc, d = cmp_table(tsv, ['顧客', '最近購買天數', '購買次數', '平均客單', '之後回購'], exp['rows'])
        check('[logit 180天] 整理後的表與 pandas 逐列比對（切點 %s）' % exp['cutoff'], okc, d)
    except Exception:
        check('[logit 180] 步驟執行', False, traceback.format_exc()[-400:])

def own_tests(browser):
    # 自己想的操作 1：kmeans 上傳後改選「已經整理好」，把原始交易明細直接當顧客表
    try:
        ctx = new_ctx(browser)
        pg, errs = open_page(ctx, 'kmeans')
        upload(pg, errs, TX, '10-own', 'kmeans', None)
        ms, ok = act(pg, lambda: pg.get_by_role('button', name='已經整理好', exact=True).click(), 60)
        pg.wait_for_timeout(2700)
        s = snapshot(pg, errs, 0)
        pg.screenshot(path=str(SHOTS / 'rc_own_kmeans_ready_on_raw.png'), full_page=True)
        LOG.append({'step': '10-own-ready-on-raw', 'set': 'kmeans', 'snap': s, 'shot': 'rc_own_kmeans_ready_on_raw.png'})
        print('--- [10-own ready-on-raw] mode=%s recon=%s say=%s' % (pressed(s, '資料準備方式'), (recon_first(s) or {}).get('text', '')[:120], s['say'][:1]), flush=True)
        ctx.close()
    except Exception:
        check('[自己的操作1] 步驟執行', False, traceback.format_exc()[-400:])
    # 自己想的操作 2：金額欄改成 discount_amount，再重新開頁上傳，看有沒有記住設定
    try:
        ctx = new_ctx(browser)
        pg, errs = open_page(ctx, 'kmeans')
        upload(pg, errs, TX, '10-own', 'kmeans', None)
        ms, ok = act(pg, lambda: pg.select_option('#prep-amount', 'discount_amount'), 120)
        pg.wait_for_timeout(2700)
        s = snapshot(pg, errs, 0)
        pg.screenshot(path=str(SHOTS / 'rc_own_amount_discount.png'), full_page=True)
        LOG.append({'step': '10-own-amount-discount', 'set': 'kmeans', 'elapsed_s': ms, 'snap': s, 'shot': 'rc_own_amount_discount.png'})
        print('--- [10-own amount=discount] recon=%s' % (recon_first(s) or {}).get('text', '')[:200], flush=True)
        check('[自己的操作2] 金額欄=discount_amount 時，零折扣列是否被標成「退貨或贈品」',
              '金額 ≤ 0（退貨或贈品） %s' % format(EXP['pos_disc_zero'], ',') in (recon_first(s) or {}).get('text', ''),
              (recon_first(s) or {}).get('text', '')[:200] + ' | pandas：零折扣列 %d' % EXP['pos_disc_zero'])
        # 重新開頁、同一個瀏覽器情境再上傳一次
        pg2, errs2 = open_page(ctx, 'kmeans')
        rec = upload(pg2, errs2, TX, '10-own-reopen', 'kmeans', 'rc_own_reopen_amount.png')
        s2 = rec['snap']
        p2 = ps(s2)
        check('[自己的操作2] 重開後是否沿用 discount_amount 設定（有提示）', bool(s2['notice']) and p2.get('prep-amount', {}).get('value') == 'discount_amount',
              '提示=%s；金額欄=%s' % (s2['notice'], p2.get('prep-amount', {}).get('value')))
        ctx.close()
    except Exception:
        check('[自己的操作2] 步驟執行', False, traceback.format_exc()[-400:])
    # 自己想的操作 3：貼上 10 列（含標題）到 kmeans，看小樣本的錯誤訊息
    try:
        ctx = new_ctx(browser)
        pg, errs = open_page(ctx, 'kmeans')
        raw = TX.read_text(encoding='utf-8-sig').splitlines()[:11]
        rec = paste(pg, errs, '\n'.join(l.replace(',', '\t') for l in raw), '10-own-paste10', 'kmeans', 'rc_own_paste10_kmeans.png')
        check('[自己的操作3] 10 列的錯誤訊息是白話的', bool(rec['snap']['errs']) or bool(rec['snap']['say']), (rec['snap']['errs'] or rec['snap']['say'][:1]))
        ctx.close()
    except Exception:
        check('[自己的操作3] 步驟執行', False, traceback.format_exc()[-400:])
    # 自己想的操作 4：顧客欄誤選成 txn_id（每列一個單號），看工具會不會擋
    try:
        ctx = new_ctx(browser)
        pg, errs = open_page(ctx, 'kmeans')
        upload(pg, errs, TX, '10-own', 'kmeans', None)
        ms, ok = act(pg, lambda: pg.select_option('#prep-customer', 'txn_id'), 120)
        pg.wait_for_timeout(2700)
        s = snapshot(pg, errs, 0)
        pg.screenshot(path=str(SHOTS / 'rc_own_customer_txnid.png'), full_page=True)
        LOG.append({'step': '10-own-customer-txnid', 'set': 'kmeans', 'snap': s, 'shot': 'rc_own_customer_txnid.png'})
        print('--- [10-own customer=txn_id] hints=%s' % [h for h in s['prepHints'] if '整理成' in h], flush=True)
        ctx.close()
    except Exception:
        check('[自己的操作4] 步驟執行', False, traceback.format_exc()[-400:])

def main():
    build_expectations()
    print('EXP recon:', EXP['recon'], flush=True)
    print('EXP customers:', len(EXP['cust']), 'labeled90:', EXP['lab90']['n'], EXP['lab90']['pos'], EXP['lab90']['cutoff'],
          'labeled180:', EXP['lab180']['n'], EXP['lab180']['pos'], EXP['lab180']['cutoff'], flush=True)
    print('EXP month:', len(EXP['month']['rows']), 'dropped', EXP['month']['dropped'], '| week:', len(EXP['week']['rows']), EXP['week']['dropped'],
          '| day:', len(EXP['day']['rows']), flush=True)
    print('EXP corr(total_amount, discount_amount)=%.4f' % EXP['corr_total_disc'], flush=True)
    pages = {}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        step1_txn_sets(browser, pages)
        step2_regress(browser)
        step3_members(browser)
        step4_items(browser)
        step5_unfit(browser)
        step6_big5(browser)
        step7_paste(browser, pages)
        step8_period_window(browser, pages)
        own_tests(browser)
        browser.close()
    summary = {'expect': {k: v for k, v in EXP.items() if k != 'df'}, 'checks': CHECKS}
    LOG_PATH.write_text(json.dumps({'log': LOG, 'summary': summary}, ensure_ascii=False, indent=1, default=str))
    n_ok = sum(1 for c in CHECKS if c['ok'])
    print('CHECKS: %d PASS / %d FAIL' % (n_ok, len(CHECKS) - n_ok), flush=True)
    print('log ->', LOG_PATH, flush=True)

if __name__ == '__main__':
    main()
