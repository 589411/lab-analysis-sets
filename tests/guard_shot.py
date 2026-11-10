# 「核心框架與套餐」防護檢查（真實樣貌資料）。先執行：OUT=guard python3 build.py
# 用法：python3 tests/guard_shot.py   → 逐項印 PASS/FAIL，截圖到 shots/guard_*.png；有 FAIL 就以非零代碼結束。
import json, pathlib, sys, time
from playwright.sync_api import sync_playwright

R = pathlib.Path(__file__).resolve().parent.parent
SHOTS = R / 'shots'; SHOTS.mkdir(exist_ok=True)
PAGE = (R / 'dist' / 'guard.html').as_uri()
DATA = pathlib.Path('/home/claude/sunlit-retail-sim/data')   # 唯讀
TMP = pathlib.Path('/tmp/guard_inputs'); TMP.mkdir(exist_ok=True)

results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print('PASS' if ok else 'FAIL', '-', name)
    if detail: print('      ' + detail.replace('\n', '\n      '))

def open_page(pw_browser, hash_id):
    pg = pw_browser.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
    pg.errs = []
    pg.on('pageerror', lambda e: pg.errs.append('pageerror: ' + str(e)))
    pg.on('console', lambda m: pg.errs.append('console: ' + m.text) if m.type == 'error' else None)
    pg.goto(PAGE + '#' + hash_id)
    pg.wait_for_timeout(600)
    return pg

RESULT_JS = """() => {
  const e = document.querySelector('#app .err');
  // 只認套餐結果的對帳行（開頭是「對帳：總列數」）；資料準備面板的對帳行開頭不同
  const rc = [...document.querySelectorAll('#app .recon')].find(x => x.innerText.startsWith('對帳：總列數'));
  return { err: e ? e.innerText : null, recon: rc ? rc.innerText : null };
}"""

def wait_outcome(pg, prev_recon, timeout_ms=20000):
    """等到結果出現：紅框（err）或新的對帳行。回傳 (kind, text, 秒數)。"""
    t0 = time.perf_counter()
    while (time.perf_counter() - t0) * 1000 < timeout_ms:
        r = pg.evaluate(RESULT_JS)
        if r['err'] is not None:
            return 'err', r['err'], time.perf_counter() - t0
        if r['recon'] and r['recon'] != prev_recon:
            return 'ok', r['recon'], time.perf_counter() - t0
        pg.wait_for_timeout(50)
    return 'timeout', None, time.perf_counter() - t0

def upload(pg, path):
    pg.get_by_role('button', name='上傳檔案').click()
    pg.wait_for_timeout(150)
    prev = pg.evaluate(RESULT_JS)['recon']
    t0 = time.perf_counter()
    pg.set_input_files('#f-file', str(path))
    return prev, t0

def body_text(pg, sel):
    loc = pg.locator(sel)
    return '\n'.join(loc.all_inner_texts())

def shot(pg, name):
    pg.wait_for_timeout(2600)   # 等動畫跑完
    pg.screenshot(path=str(SHOTS / ('guard_' + name + '.png')), full_page=True)

with sync_playwright() as p:
    b = p.chromium.launch()

    # a. reviews.csv → #season：時間欄重複的白話錯誤，結果區沒有結論
    pg = open_page(b, 'season')
    prev, _ = upload(pg, DATA / 'reviews.csv')
    kind, text, _s = wait_outcome(pg, prev)
    no_result = pg.locator('#app .metrics, #app .say, #app .recon').count() == 0
    shot(pg, 'a_reviews_season')
    ok = kind == 'err' and '時間欄' in (text or '') and '有重複的值' in (text or '') and no_result
    check('a reviews.csv → #season：時間欄重複錯誤、無結果', ok, '實際：' + str(kind) + ' ' + (text or '') + ' ｜ 結果區無結論=' + str(no_result))
    print('      errors:', pg.errs[:4]) if pg.errs else None
    pg.close()

    # b. txn_items.csv → #kmeans：10 秒內出結果或白話訊息；有結果則對帳行要有「已平均抽出 2,000 列」
    pg = open_page(b, 'kmeans')
    prev, _ = upload(pg, DATA / 'txn_items.csv')
    kind, text, secs = wait_outcome(pg, prev, 60000)
    shot(pg, 'b_items_kmeans')
    ok = (kind == 'err' or (kind == 'ok' and '已平均抽出 2,000 列' in text)) and secs <= 10
    check('b txn_items.csv → #kmeans：10 秒內有結果或白話訊息', ok, '實際：%s，%.2f 秒 ｜ %s' % (kind, secs, (text or '').replace('\n', ' / ')[:200]))
    pg.close()

    # c. transactions.csv → #hier（預設彙總約 1,200 位顧客）：有結果、抽 600 列、無紅框，量秒數
    pg = open_page(b, 'hier')
    prev, _ = upload(pg, DATA / 'transactions.csv')
    kind, text, secs = wait_outcome(pg, prev, 60000)
    shot(pg, 'c_txn_hier')
    has_err = pg.locator('#app .err').count() > 0
    ok = kind == 'ok' and '已平均抽出 600 列' in text and not has_err
    check('c transactions.csv → #hier：有結果、已平均抽出 600 列、無紅框', ok, '實際：%s，花了 %.2f 秒（上傳到對帳行出現）｜ %s' % (kind, secs, (text or '').replace('\n', ' / ')[:200]))
    print('      hier 600 列計算秒數: %.2f' % secs)
    pg.close()

    # d. products.csv → #linear：若自動選到值全部相同的欄，要有第 3 項錯誤，而不是一段「—」的結論
    pg = open_page(b, 'linear')
    prev, _ = upload(pg, DATA / 'products.csv')
    kind, text, _s = wait_outcome(pg, prev)
    shot(pg, 'd_products_linear')
    sel = pg.evaluate("() => ['role-x','role-y'].map(id => { const e = document.getElementById(id); return e ? e.value : null; })")
    metrics = body_text(pg, '#app .metrics')
    say = body_text(pg, '#app .say')
    dash = '—' in (metrics + say)
    # 自動選到的欄位在全體資料上不是常數，所以第 3 項（全體一樣）不會觸發；
    # 考題那一段全都一樣時由 #linear 的 R² 防護給白話錯誤。兩種白話錯誤都算過，但不可以有「—」結論。
    if kind == 'err':
        ok = ('值全部一樣' in (text or '') or '全都一樣' in (text or '')) and not dash
    else:
        ok = not dash
    check('d products.csv → #linear：全部一樣錯誤或沒有「—」結論', ok, '自動選的欄：%s；實際：%s ｜ %s ｜ 含「—」=%s' % (sel, kind, (text or '').replace('\n', ' / ')[:200] if kind != 'ok' else metrics.replace('\n', ' / ')[:200] + ' || ' + say.replace('\n', ' / ')[:300], dash))
    pg.close()

    # e. transactions.csv → #multi：錯誤訊息要說數字欄不夠（這份檔只有 2 個數字欄）
    pg = open_page(b, 'multi')
    prev, _ = upload(pg, DATA / 'transactions.csv')
    kind, text, _s = wait_outcome(pg, prev)
    shot(pg, 'e_txn_multi')
    ok = kind == 'err' and '只有 2 個數字欄' in (text or '')
    check('e transactions.csv → #multi：數字欄不夠的說明', ok, '實際：%s ｜ %s' % (kind, text))
    pg.close()

    # f. stores.csv → #kmeans：說明數字欄不夠或沒有數字欄
    pg = open_page(b, 'kmeans')
    prev, _ = upload(pg, DATA / 'stores.csv')
    kind, text, _s = wait_outcome(pg, prev)
    shot(pg, 'f_stores_kmeans')
    ok = kind == 'err' and ('數字欄' in (text or ''))
    check('f stores.csv → #kmeans：數字欄不夠或沒有數字欄', ok, '實際：%s ｜ %s' % (kind, text))
    pg.close()

    # g. transactions.csv → #season（預設月）：18 期能出結果，沒有紅框
    pg = open_page(b, 'season')
    prev, _ = upload(pg, DATA / 'transactions.csv')
    kind, text, _s = wait_outcome(pg, prev)
    shot(pg, 'g_txn_season_month')
    has_err = pg.locator('#app .err').count() > 0
    caut = body_text(pg, '#app .caut')
    ok = kind == 'ok' and not has_err and '18 期' in caut
    check('g transactions.csv → #season（月）：18 期有結果、無紅框、有期數提醒', ok, '實際：%s ｜ 別過度解讀：%s ｜ 對帳：%s' % (kind, caut.replace('\n', ' '), (text or '').replace('\n', ' / ')[:160]))
    pg.close()

    # h. members.csv → #logit：下拉下方出現二元欄提醒
    pg = open_page(b, 'logit')
    prev, _ = upload(pg, DATA / 'members.csv')
    wait_outcome(pg, prev)
    warn = body_text(pg, '#app .tip')
    shot(pg, 'h_members_logit')
    ok = '這一欄是系統猜的' in warn
    lines = [l for l in warn.split('\n') if '系統猜' in l]
    check('h members.csv → #logit：二元欄下拉下方的提醒', ok, '實際：' + (lines[0] if lines else '（沒有）'))
    pg.close()

    # i. 貼上只有 10 列的小表 → #linear：「資料本身太少」那一種
    pg = open_page(b, 'linear')
    pg.get_by_role('button', name='貼上').click()
    pg.wait_for_timeout(150)
    csv = '廣告費,營收\n' + '\n'.join('%d,%d' % (i + 1, (i + 1) * 10 + (i % 3)) for i in range(10))
    pg.fill('#f-paste', csv)
    pg.get_by_role('button', name='使用這份資料').click()
    kind, text, _s = wait_outcome(pg, None)
    shot(pg, 'i_paste10_linear')
    ok = kind == 'err' and '資料本身太少' in (text or '') and '可用的資料只有 10 列' in (text or '')
    check('i 貼上 10 列 → #linear：資料本身太少', ok, '實際：%s ｜ %s' % (kind, text))
    pg.close()

    # j. 示範資料回歸：沒有 .err、沒有 pageerror／console error；抽樣那句不應出現在示範資料上
    ids = ['linear', 'multi', 'poly', 'kmeans', 'hier', 'dbscan', 'logit', 'tree', 'knn', 'baseline', 'holt', 'season']
    sampled_ids = {'kmeans', 'hier', 'dbscan', 'knn'}
    bad = []
    for i in ids:
        pg = open_page(b, i)
        pg.wait_for_timeout(1500)
        kind, text, _s = wait_outcome(pg, None, 5000)
        e = pg.locator('#app .err').count()
        if e: bad.append(i + ': 有紅框')
        if pg.errs: bad.append(i + ': ' + '; '.join(pg.errs[:3]))
        if kind != 'ok': bad.append(i + ': 沒有對帳行')
        if i in sampled_ids and '已平均抽出' in (text or ''): bad.append(i + ': 示範資料出現抽樣句')
        if i == 'season' or i == 'linear':
            shot(pg, 'j_' + i)
        pg.close()
    check('j 示範資料 12 個套餐：無紅框、無 pageerror／console error、抽樣句不出現', not bad, '問題：' + ('; '.join(bad) if bad else '無'))

    b.close()

print('共 %d 項，PASS %d，FAIL %d' % (len(results), sum(results), len(results) - sum(results)))
sys.exit(0 if all(results) else 1)
