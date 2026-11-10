# 資料準備：截圖與腳本驗證。用法：python3 tests/prep_shot.py（會先跑 OUT=... build.py，只寫 dist/<OUT>.html）
# 截圖到 shots/，印出每項 PASS/FAIL；有任何 FAIL 或頁面錯誤就以非零代碼結束。
import json, os, pathlib, re, subprocess, sys
from playwright.sync_api import sync_playwright

R = pathlib.Path(__file__).resolve().parent.parent
SHOTS = R / 'shots'
OUT = os.environ.get('OUT', 'scope')
DIST = R / 'dist' / (OUT + '.html')
SHOTS.mkdir(exist_ok=True)

# 手寫的英文欄名交易明細（民國年日期、8 位顧客、一列負數做退貨）
TXN = [
    ('115/01/03', 'C001', '1200'), ('115/01/03', 'C002', '850'), ('115/01/04', 'C003', '2300'),
    ('115/01/05', 'C001', '640'), ('115/01/06', 'C004', '1500'), ('115/01/08', 'C005', '990'),
    ('115/01/09', 'C002', '760'), ('115/01/10', 'C006', '3100'), ('115/01/11', 'C003', '450'),
    ('115/01/12', 'C007', '1280'), ('115/01/14', 'C001', '880'), ('115/01/15', 'C008', '520'),
    ('115/01/17', 'C004', '1750'), ('115/01/18', 'C005', '610'), ('115/01/19', 'C002', '940'),
    ('115/01/21', 'C006', '2200'), ('115/01/22', 'C001', '1100'), ('115/01/24', 'C003', '780'),
    ('115/01/25', 'C007', '330'), ('115/01/26', 'C008', '1450'), ('115/02/01', 'C004', '1020'),
    ('115/02/02', 'C002', '880'), ('115/02/03', 'C005', '2600'), ('115/02/04', 'C001', '510'),
    ('115/02/05', 'C006', '1390'), ('115/02/07', 'C003', '670'), ('115/02/08', 'C008', '940'),
    ('115/02/09', 'C007', '1820'), ('115/02/10', 'C001', '-150'), ('115/02/11', 'C004', '1230'),
    ('115/02/12', 'C002', '790'), ('115/02/14', 'C005', '1560'), ('115/02/15', 'C006', '420'),
    ('115/02/16', 'C003', '1100'), ('115/02/17', 'C008', '880'), ('115/02/18', 'C001', '960'),
    ('115/02/19', 'C007', '1340'), ('115/02/21', 'C004', '710'), ('115/02/22', 'C002', '2050'),
    ('115/02/23', 'C005', '590'), ('115/02/24', 'C006', '1180'), ('115/02/25', 'C008', '1600'),
    ('115/02/26', 'C003', '930'), ('115/02/27', 'C007', '1020'), ('115/02/28', 'C001', '1450'),
]
PASTE_TSV = 'order_date\tcust_id\ttotal\n' + '\n'.join('\t'.join(r) for r in TXN)

# 示範明細（data/demo_txn.json，8,000 列）的驗收數字：課程文件定好的，必須完全相同
ACC = {'total': '8,000', 'out': '507', 'used_customer': '5,675', 'nonpos': '114', 'nocust': '1,704',
       'used_series': '7,379'}

CLIP_INIT = """
  (function(){ try { Object.defineProperty(navigator,'clipboard',{configurable:true,value:{
    writeText:function(t){ window.__clip=String(t); return Promise.resolve(); },
    readText:function(){ return Promise.resolve(window.__clip||''); } }}); } catch(e){} })();
"""

results = []
def norm(s):
    # 去掉複製按鈕的暫時文字，只比結果本身
    return s.replace('已複製，可貼到 Excel', '').replace('複製整理後的表', '')

def check(name, ok, detail=''):
    results.append(bool(ok))
    print('PASS' if ok else 'FAIL', '-', name, detail)

# 建置：一律用 OUT，只寫 dist/<OUT>.html，不動根目錄 index.html 或別人的產物
subprocess.run([sys.executable, 'build.py'], cwd=str(R), check=True, env=dict(os.environ, OUT=OUT))

def recon_ok(pg, name):
    el = pg.query_selector('.prep-res .recon')
    if not el:
        check(name + ' 對帳等式', False, '找不到對帳區')
        return
    t, s = el.get_attribute('data-total'), el.get_attribute('data-sum')
    check(name + ' 對帳等式兩邊相等', t is not None and t == s, '(total=%s, sum=%s)' % (t, s))

def recon_text(pg):
    el = pg.query_selector('.prep-res .recon')
    return el.inner_text() if el else ''

with sync_playwright() as p:
    b = p.chromium.launch()
    contexts = []
    ERRS_ALL = []

    def new_page():
        # 每個情境一個獨立的 context，localStorage 不互相影響
        c = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
        c.add_init_script(CLIP_INIT)
        contexts.append(c)
        pg = c.new_page()
        pg.set_default_timeout(180000)  # 交易明細在「已經整理好」時會跑很久的分析，給足時間
        errs = []
        pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
        pg.on('console', lambda m: errs.append('console: ' + m.text) if m.type == 'error' else None)
        ERRS_ALL.append(errs)
        return pg, errs

    def open_set(pg, sid):
        pg.goto(DIST.as_uri() + '#' + sid)
        pg.wait_for_selector('.panel')
        pg.wait_for_timeout(300)

    def click_demo(pg):
        pg.get_by_role('button', name='示範明細', exact=True).click()
        pg.wait_for_timeout(1500)

    def no_errors(pg, errs, name):
        check(name + ' 沒有頁面錯誤或 console error', not errs, '' if not errs else str(errs[:3]))

    def add_quick(pg, col_prefix):
        btn = pg.locator('.prep-chips button', has_text=col_prefix).first
        btn.click(); pg.wait_for_timeout(600)

    def uncheck_value(pg, value):
        pg.locator('.prep-scope-card label', has_text=value).first.locator('input[type=checkbox]').uncheck()
        pg.wait_for_timeout(700)

    # ---------- 原有的檢查（示範明細已換成藍鴨生活交易檔，數字改從畫面讀） ----------
    # 1. kmeans 示範明細
    pg, errs = new_page(); open_set(pg, 'kmeans'); click_demo(pg)
    pg.screenshot(path=str(SHOTS / 'prep_kmeans.png'), full_page=True)
    recon_ok(pg, 'kmeans')
    check('kmeans 結果區有指標', len(pg.query_selector_all('.metric')) > 0)
    check('kmeans 沒有錯誤訊息', pg.query_selector('.err') is None)
    no_errors(pg, errs, 'kmeans')
    pg.close()

    # 2. logit
    pg, errs = new_page(); open_set(pg, 'logit'); click_demo(pg)
    pg.screenshot(path=str(SHOTS / 'prep_logit.png'), full_page=True)
    recon_ok(pg, 'logit')
    check('logit 有切點日期提示', pg.query_selector('.prep-txn .tip') is not None and '切點日期' in pg.inner_text('.prep-txn .tip'))
    no_errors(pg, errs, 'logit')
    pg.close()

    # 3. season
    pg, errs = new_page(); open_set(pg, 'season'); click_demo(pg)
    pg.screenshot(path=str(SHOTS / 'prep_season.png'), full_page=True)
    recon_ok(pg, 'season')
    no_errors(pg, errs, 'season')
    pg.close()

    # 4. baseline 改成週
    pg, errs = new_page(); open_set(pg, 'baseline'); click_demo(pg)
    pg.select_option('#prep-period', 'week'); pg.wait_for_timeout(1000)
    pg.screenshot(path=str(SHOTS / 'prep_baseline_week.png'), full_page=True)
    recon_ok(pg, 'baseline 週')
    check('baseline 週：期別單位顯示為週', '週' in pg.inner_text('.prep-res'))
    no_errors(pg, errs, 'baseline 週')
    pg.close()

    # 5. 貼上英文欄名的 TSV
    pg, errs = new_page(); open_set(pg, 'kmeans')
    pg.get_by_role('button', name='貼上', exact=True).click()
    pg.fill('#f-paste', PASTE_TSV)
    pg.get_by_role('button', name='使用這份資料', exact=True).click()
    pg.wait_for_timeout(1500)
    check('英文欄名猜到日期欄', pg.input_value('#prep-date') == 'order_date', pg.input_value('#prep-date'))
    check('英文欄名猜到顧客欄', pg.input_value('#prep-customer') == 'cust_id', pg.input_value('#prep-customer'))
    check('英文欄名猜到金額欄', pg.input_value('#prep-amount') == 'total', pg.input_value('#prep-amount'))
    check('訂單欄不誤猜日期欄（預設不使用）', pg.input_value('#prep-order') == '', pg.input_value('#prep-order'))
    check('貼上資料轉換成功', pg.query_selector('.prep-res .recon') is not None)
    pg.screenshot(path=str(SHOTS / 'prep_paste.png'), full_page=True)
    recon_ok(pg, '貼上')
    no_errors(pg, errs, '貼上')
    pg.close()

    # 6. 示範明細後切到「已經整理好」
    pg, errs = new_page(); open_set(pg, 'kmeans'); click_demo(pg)
    pg.get_by_role('button', name='已經整理好', exact=True).click()
    pg.wait_for_timeout(1500)
    pg.screenshot(path=str(SHOTS / 'prep_clean.png'), full_page=True)
    check('整理好模式：出現結果或白話錯誤（非程式例外）',
          pg.query_selector('.metric') is not None or pg.query_selector('.err') is not None)
    no_errors(pg, errs, '整理好模式')
    pg.close()

    # ---------- 新增：界定範圍 ----------
    # A. scope_kmeans：示範明細 → 快速加入 channel → 取消勾選 online；對帳從畫面文字驗證；再做複製／貼回／移除／重新載入
    pg, errs = new_page(); open_set(pg, 'kmeans'); click_demo(pg)
    add_quick(pg, 'channel')
    uncheck_value(pg, 'online')
    txt = recon_text(pg)
    check('scope_kmeans 原始 8,000 列', ('原始 ' + ACC['total'] + ' 列') in txt, txt[:80])
    check('scope_kmeans 不在這次範圍 507', re.search(r'不在這次範圍\s*' + ACC['out'] + r'(?!\d)', txt) is not None, txt)
    check('scope_kmeans 用來計算 5,675', re.search(r'用來計算\s*' + ACC['used_customer'] + r'(?!\d)', txt) is not None, txt)
    check('scope_kmeans 金額 ≤ 0 是 114', re.search(r'金額 ≤ 0（退貨、贈品或 0 元）[^0-9]*' + ACC['nonpos'] + r'(?!\d)', txt) is not None, txt)
    check('scope_kmeans 沒有顧客編號 1,704', re.search(r'沒有顧客編號[^0-9]*' + ACC['nocust'] + r'(?!\d)', txt) is not None, txt)
    recon_ok(pg, 'scope_kmeans')
    foot = pg.inner_text('.prep-scope-card').replace('\n', ' ')
    check('scope_kmeans 卡片下方顯示「這條排除了 507 列」', '這條排除了 507 列' in foot, foot[-30:])
    check('scope_kmeans 規則面板已列出 channel 規則', pg.query_selector('#prep-scope-0-v0') is not None)
    pg.screenshot(path=str(SHOTS / 'scope_kmeans.png'), full_page=True)
    check('scope_kmeans 手機寬度不橫向溢出',
          pg.evaluate('document.documentElement.scrollWidth') <= 390,
          str(pg.evaluate('document.documentElement.scrollWidth')))
    rec_before = norm(recon_text(pg))

    # 複製對應設定：JSON 內含 scope
    pg.get_by_role('button', name='複製對應設定', exact=True).click(); pg.wait_for_timeout(200)
    cfg_text = pg.evaluate('window.__clip')
    try:
        cfg = json.loads(cfg_text)
    except Exception as e:
        cfg = {}
        check('複製的設定是 JSON', False, str(e))
    check('複製的設定含 scope（channel in [store]）',
          cfg.get('scope') == [{'col': 'channel', 'op': 'in', 'values': ['store']}], str(cfg.get('scope')))

    # 移除界定範圍 → 結果回到全部資料；再貼回 → 結果不變
    pg.click('#prep-scope-0-remove'); pg.wait_for_timeout(700)
    check('移除後不再有「不在這次範圍」', '不在這次範圍' not in recon_text(pg))
    pg.get_by_role('button', name='貼上對應設定', exact=True).click()
    pg.fill('#prep-cfg', cfg_text)
    pg.get_by_role('button', name='套用', exact=True).click(); pg.wait_for_timeout(1200)
    check('貼回設定後顯示已套用', '已套用貼上的對應設定' in pg.inner_text('.prep-txn'))
    check('貼回設定後結果不變', norm(recon_text(pg)) == rec_before, norm(recon_text(pg))[:80])

    # 壞設定：scope 裡的欄位不存在 → 白話說明，整份都不套用
    bad = dict(cfg); bad['scope'] = [{'col': '不存在的欄', 'op': 'in', 'values': ['x']}]
    pg.get_by_role('button', name='貼上對應設定', exact=True).click()
    pg.fill('#prep-cfg', json.dumps(bad, ensure_ascii=False))
    pg.get_by_role('button', name='套用', exact=True).click(); pg.wait_for_timeout(1000)
    err = pg.query_selector('.prep-txn .err')
    check('壞的 scope：白話說明且整份不套用', err is not None and '整份設定都沒有套用' in err.inner_text(),
          err.inner_text()[:60] if err else '')
    check('壞的 scope：結果沒有改變', norm(recon_text(pg)) == rec_before)
    no_errors(pg, errs, 'scope_kmeans 設定流程')

    # 重新載入：自動套用上次設定，scope 還在
    pg.reload(); pg.wait_for_selector('.panel'); pg.wait_for_timeout(300)
    click_demo(pg)
    check('重新載入後出現「已套用你上次對這種格式的設定」',
          '已套用你上次對這種格式的設定' in pg.inner_text('.prep-txn'))
    check('重新載入後 scope 還在（online 仍未勾選）',
          pg.query_selector('#prep-scope-0-v1') is not None and not pg.is_checked('#prep-scope-0-v1'))
    check('重新載入後結果仍排除 507 列', re.search(r'不在這次範圍\s*507(?!\d)', recon_text(pg)) is not None)
    no_errors(pg, errs, 'scope_kmeans 重新載入')
    pg.close()

    # B. scope_season：示範明細 → 只留 store
    pg, errs = new_page(); open_set(pg, 'season'); click_demo(pg)
    add_quick(pg, 'channel')
    uncheck_value(pg, 'online')
    txt = recon_text(pg)
    check('scope_season 不在這次範圍 507', re.search(r'不在這次範圍\s*' + ACC['out'] + r'(?!\d)', txt) is not None, txt)
    check('scope_season 用來計算 7,379', re.search(r'用來計算\s*' + ACC['used_series'] + r'(?!\d)', txt) is not None, txt)
    check('scope_season 原始 8,000 列', ('原始 ' + ACC['total'] + ' 列') in txt, txt[:80])
    recon_ok(pg, 'scope_season')
    pg.screenshot(path=str(SHOTS / 'scope_season.png'), full_page=True)
    no_errors(pg, errs, 'scope_season')
    pg.close()

    # C. scope_date：#logit → 示範明細 → 加 txn_datetime 日期範圍（迄 2026-03-31）
    pg, errs = new_page(); open_set(pg, 'logit'); click_demo(pg)
    pg.select_option('#prep-scope-col', 'txn_datetime')
    pg.click('#prep-scope-add'); pg.wait_for_timeout(700)
    pg.fill('#prep-scope-0-to', '2026-03-31')
    pg.dispatch_event('#prep-scope-0-to', 'change'); pg.wait_for_timeout(1500)
    el = pg.query_selector('.prep-res .recon')
    er = pg.query_selector('.prep-res .err') or pg.query_selector('.prep-txn .err')
    check('scope_date 有結果或白話錯誤（非程式例外）', (el is not None) or (er is not None),
          (el.inner_text()[:60] if el else (er.inner_text()[:60] if er else '')))
    if er is not None:
        check('scope_date 錯誤是白話文字', '例外' not in er.inner_text() and len(er.inner_text()) > 5, er.inner_text()[:60])
    if el is not None:
        check('scope_date 對帳等式成立', el.get_attribute('data-total') == el.get_attribute('data-sum'))
    pg.screenshot(path=str(SHOTS / 'scope_date.png'), full_page=True)
    no_errors(pg, errs, 'scope_date')
    pg.close()

    # D. scope_tidy：#kmeans → 示範明細 → 已經整理好 → 加 channel 規則
    pg, errs = new_page(); open_set(pg, 'kmeans'); click_demo(pg)
    pg.get_by_role('button', name='已經整理好', exact=True).click(); pg.wait_for_timeout(800)
    add_quick(pg, 'channel')
    uncheck_value(pg, 'online')
    txt = recon_text(pg)
    check('scope_tidy 顯示「原始 8,000 列 ＝ …」', ('原始 ' + ACC['total'] + ' 列') in txt, txt[:80])
    check('scope_tidy 不在這次範圍 507', re.search(r'不在這次範圍\s*' + ACC['out'] + r'(?!\d)', txt) is not None, txt)
    check('scope_tidy 拿去分析 7,493', re.search(r'拿去分析\s*7,493(?!\d)', txt) is not None, txt)
    pg.screenshot(path=str(SHOTS / 'scope_tidy.png'), full_page=True)
    no_errors(pg, errs, 'scope_tidy')
    pg.close()

    # E. 上限與空白：3 條滿了停用新增入口；全部取消顯示提示且不套用
    pg, errs = new_page(); open_set(pg, 'kmeans'); click_demo(pg)
    add_quick(pg, 'channel'); add_quick(pg, 'is_return'); add_quick(pg, 'payment_method')
    check('滿 3 條時新增入口停用', pg.is_disabled('#prep-scope-add') and pg.is_disabled('#prep-scope-col'))
    check('滿 3 條時快速加入也停用', all(el.is_disabled() for el in pg.locator('.prep-chips button').all()))
    check('滿 3 條時有說明', '最多 3 條' in pg.inner_text('.prep-scope'))
    pg.locator('.prep-scope-card', has_text='channel').first.locator('input[type=checkbox]').first.uncheck()
    pg.locator('.prep-scope-card', has_text='channel').first.locator('input[type=checkbox]').last.uncheck()
    pg.wait_for_timeout(700)
    check('全部取消時顯示提示且不套用', '全部取消了，這條沒有套用' in pg.inner_text('.prep-scope'))
    no_errors(pg, errs, 'scope 上限與空白')
    pg.close()

    # F. 手機寬：示範明細的界定範圍區不橫向溢出
    pg, errs = new_page(); open_set(pg, 'season'); click_demo(pg)
    add_quick(pg, 'channel')
    pg.wait_for_timeout(300)
    check('手機寬 390px 不橫向溢出（season 加規則後）', pg.evaluate('document.documentElement.scrollWidth') <= 390,
          str(pg.evaluate('document.documentElement.scrollWidth')))
    pg.close()

    # ---------- 資料準備修正（reality_check 第 1 到 6、10 項）：情境 a 到 h ----------
    DATA = pathlib.Path('/home/claude/sunlit-retail-sim/data')  # 唯讀，只用來上傳
    import csv

    def upload(pg, name):
        pg.get_by_role('button', name='上傳檔案', exact=True).click()
        pg.set_input_files('#f-file', str(DATA / name))
        pg.wait_for_selector('.prep', timeout=180000)
        pg.wait_for_timeout(800)

    def panel_text(pg):
        return pg.inner_text('.prep-res') if pg.query_selector('.prep-res') else ''

    def core_errs(pg):
        # 結果區的錯誤（不含資料準備面板內的）
        return pg.evaluate("[...document.querySelectorAll('.err')].filter(e => !e.closest('.prep')).map(e => e.textContent)")

    def scroll_ok(pg):
        return pg.evaluate('document.documentElement.scrollWidth') <= 390

    def note_text(pg):
        return ' | '.join(e.inner_text() for e in pg.query_selector_all('.prep-note'))

    # a. txn_items.csv → #kmeans：預設已經整理好，說明每一列；改選交易明細後結果區清空
    pg, errs = new_page(); open_set(pg, 'kmeans'); upload(pg, 'txn_items.csv')
    nt = note_text(pg)
    check('fix_a 預設是「已經整理好」（沒有日期欄下拉）', pg.query_selector('#prep-date') is None)
    check('fix_a 說明列出 24,786 列', '每一列會被當成一位顧客，共 24,786 列' in nt, nt[:90])
    check('fix_a 重複編號提示（txn_id）', '欄位「txn_id」有重複的值' in nt and '可能不是一列一位顧客' in nt, nt[-100:])
    check('fix_a 手機寬不溢出', scroll_ok(pg), str(pg.evaluate('document.documentElement.scrollWidth')))
    pg.screenshot(path=str(SHOTS / 'fix_a_ready_note.png'), full_page=True)
    pg.get_by_role('button', name='是交易明細，幫我彙總', exact=True).click(); pg.wait_for_timeout(1500)
    check('fix_a 改選交易明細後結果區沒有分群結論（沒有 .metrics）', pg.query_selector('.metrics') is None)
    ce = core_errs(pg)
    check('fix_a 結果區顯示「資料準備還沒完成」', any(t.startswith('資料準備還沒完成') for t in ce), str(ce)[:120])
    check('fix_a 面板內照舊提示必選欄位', '請先選好日期欄、顧客欄、金額欄' in panel_text(pg))
    check('fix_a 手機寬不溢出（交易明細模式）', scroll_ok(pg))
    pg.screenshot(path=str(SHOTS / 'fix_a_forced.png'), full_page=True)
    pg.close()

    # b. 示範結果 → 貼上 transactions.csv 前 301 行（含標題）→ 失敗時結果區不殘留示範結論
    with open(DATA / 'transactions.csv', encoding='utf-8-sig', newline='') as f:
        PASTE301 = '\n'.join('\t'.join(r) for r in list(csv.reader(f))[:301])
    pg, errs = new_page(); open_set(pg, 'season'); click_demo(pg)
    had = pg.query_selector('.metrics') is not None
    check('fix_b 先有示範結果', had)
    pg.get_by_role('button', name='貼上', exact=True).click()
    pg.fill('#f-paste', PASTE301)
    pg.get_by_role('button', name='使用這份資料', exact=True).click(); pg.wait_for_timeout(1500)
    check('fix_b 失敗後結果區沒有 .metrics（示範結論已清掉）', pg.query_selector('.metrics') is None)
    body = pg.inner_text('.panel')
    check('fix_b 畫面沒有示範資料的「36 期」或「每期平均成長」', '資料只有 36 期' not in body and '每期平均成長' not in body)
    pe = pg.query_selector('.prep-txn .err')
    pe_t = pe.inner_text() if pe else ''
    check('fix_b 面板錯誤是原訊息（扣掉不完整的期別後，只剩 0 期）', pe_t.startswith('扣掉不完整的期別後，只剩 0 期'), pe_t[:60])
    check('fix_b 面板錯誤含第 3 項補充（取消勾選、一期多長）', '取消勾選' in pe_t and '一期多長' in pe_t, pe_t[-60:])
    ce = core_errs(pg)
    check('fix_b 結果區也顯示「資料準備沒有成功」與補充', any(t.startswith('資料準備沒有成功') and '取消勾選' in t for t in ce), str(ce)[:120])
    check('fix_b 手機寬不溢出', scroll_ok(pg))
    pg.screenshot(path=str(SHOTS / 'fix_b_paste_fail.png'), full_page=True)
    pg.close()

    # c. transactions.csv → #kmeans，金額欄改成 discount_amount → 金額欄可能選錯了
    pg, errs = new_page(); open_set(pg, 'kmeans'); upload(pg, 'transactions.csv')
    pg.select_option('#prep-amount', 'discount_amount'); pg.wait_for_timeout(1200)
    pt = panel_text(pg)
    check('fix_c 出現「金額欄可能選錯了」', '金額欄可能選錯了' in pt, pt[:0])
    check('fix_c 說明含目前選的是 discount_amount', '目前選的是「discount_amount」' in pt)
    check('fix_c 對帳文字改成「退貨、贈品或 0 元」', '金額 ≤ 0（退貨、贈品或 0 元）' in recon_text(pg), recon_text(pg)[:120])
    recon_ok(pg, 'fix_c')
    check('fix_c 手機寬不溢出', scroll_ok(pg))
    pg.screenshot(path=str(SHOTS / 'fix_c_amount_warn.png'), full_page=True)
    pg.close()

    # d. transactions.csv → #kmeans，顧客欄改成 txn_id → 顧客欄可能選到交易編號了
    pg, errs = new_page(); open_set(pg, 'kmeans'); upload(pg, 'transactions.csv')
    pg.select_option('#prep-customer', 'txn_id'); pg.wait_for_timeout(1200)
    pt = panel_text(pg)
    check('fix_d 出現「顧客欄可能選到交易編號了」', '顧客欄可能選到交易編號了' in pt)
    check('fix_d 說明含目前選的是 txn_id', '目前選的是「txn_id」' in pt)
    check('fix_d 手機寬不溢出', scroll_ok(pg))
    pg.screenshot(path=str(SHOTS / 'fix_d_customer_warn.png'), full_page=True)
    pg.close()

    # e. transactions.csv → #season：只有 18 期
    pg, errs = new_page(); open_set(pg, 'season'); upload(pg, 'transactions.csv')
    pt = panel_text(pg)
    check('fix_e 出現「只有 18 期」', '只有 18 期' in pt, pt[:0])
    check('fix_e 建議改成週', '可以把「一期多長」改成週' in pt)
    check('fix_e 手機寬不溢出', scroll_ok(pg))
    pg.screenshot(path=str(SHOTS / 'fix_e_season18.png'), full_page=True)
    pg.close()

    # f. 自動套用上次設定：看得見、能取消
    pg, errs = new_page(); open_set(pg, 'kmeans'); upload(pg, 'transactions.csv')
    base = norm(recon_text(pg))
    pg.select_option('#prep-amount', 'discount_amount'); pg.wait_for_timeout(1200)
    pg.reload(); pg.wait_for_selector('.panel', timeout=180000); pg.wait_for_timeout(300)
    upload(pg, 'transactions.csv')
    nt = note_text(pg)
    check('fix_f 上次設定區塊出現', '已套用你上次對這種格式的設定' in nt, nt[:90])
    check('fix_f 區塊列出金額欄是 discount_amount', '金額：discount_amount' in nt)
    check('fix_f 金額欄實際是 discount_amount', pg.input_value('#prep-amount') == 'discount_amount')
    pg.screenshot(path=str(SHOTS / 'fix_f_notice.png'), full_page=True)
    pg.click('#prep-cfg-reset'); pg.wait_for_timeout(1200)
    check('fix_f 按下後金額欄回到 total_amount', pg.input_value('#prep-amount') == 'total_amount', pg.input_value('#prep-amount'))
    check('fix_f 按下後上次設定區塊消失', '已套用你上次對這種格式的設定' not in note_text(pg))
    check('fix_f 按下後對帳數字恢復', norm(recon_text(pg)) == base, norm(recon_text(pg))[:100])
    check('fix_f 按下後沒有殘留的金額警告', '金額欄可能選錯了' not in panel_text(pg))
    pg.reload(); pg.wait_for_selector('.panel', timeout=180000); pg.wait_for_timeout(300)
    upload(pg, 'transactions.csv')
    check('fix_f 取消後重新載入不再出現上次設定區塊', '已套用你上次對這種格式的設定' not in note_text(pg))
    pg.screenshot(path=str(SHOTS / 'fix_f_reset.png'), full_page=True)
    check('fix_f 手機寬不溢出', scroll_ok(pg))
    pg.close()

    # g. members.csv → #logit（已經整理好）：說明每一列是事後才知道結果的顧客
    pg, errs = new_page(); open_set(pg, 'logit'); upload(pg, 'members.csv')
    nt = note_text(pg)
    check('fix_g 出現 labeled 說明（共 1,200 列、事後才知道的結果）',
          '每一列會被當成一位顧客，共 1,200 列，而且表裡要有一欄是「事後才知道的結果」' in nt, nt[:120])
    check('fix_g 手機寬不溢出', scroll_ok(pg))
    pg.screenshot(path=str(SHOTS / 'fix_g_labeled_note.png'), full_page=True)
    pg.close()

    # h. 全程沒有 pageerror 或 console error（含上面所有情境）
    all_e = [x for lst in ERRS_ALL for x in lst]
    check('fix_h 全部情境沒有 pageerror 或 console error', not all_e, str(all_e[:3]))

    b.close()

print('\n%d/%d 項通過' % (sum(results), len(results)))
sys.exit(0 if all(results) else 1)
