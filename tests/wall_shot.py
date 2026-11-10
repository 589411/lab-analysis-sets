# 圖鑑牆與套餐頁的截圖和驗證。先執行：OUT=wall python3 build.py
# 用法：python3 tests/wall_shot.py   → 截圖到 shots/，印出每項 PASS/FAIL；有 FAIL 就以非零代碼結束。
import pathlib, sys
from playwright.sync_api import sync_playwright

R = pathlib.Path(__file__).resolve().parent.parent
SHOTS = R / 'shots'
SHOTS.mkdir(exist_ok=True)
WALL = (R / 'dist' / 'wall.html').as_uri()

# 對照表：id → (主標 ask, 標籤 start｜adv｜空字串)
EXPECT = {
    'linear':   ('多投入一點，成果多多少？', 'start'),
    'multi':    ('哪個原因影響最大？', ''),
    'poly':     ('做到多少剛剛好？', 'adv'),
    'kmeans':   ('我的顧客有哪幾種？', 'start'),
    'hier':     ('顧客該分成幾種？', 'adv'),
    'dbscan':   ('誰和大家都不一樣？', 'adv'),
    'logit':    ('誰最可能再回來買？', 'start'),
    'tree':     ('怎麼用幾條規則判斷？', ''),
    'knn':      ('和他相像的人後來怎麼做？', 'adv'),
    'baseline': ('預測至少要多準才算數？', ''),
    'holt':     ('照最近的走勢會到哪裡？', ''),
    'season':   ('下個月大概會賣多少？', 'start'),
}
TAG_TEXT = {'start': '先從這個開始', 'adv': '進階'}


# 圖鑑牆的縮圖只在進入視窗時才畫，整頁截圖前先從上捲到下再回到頂端
def warm(pg):
    h = pg.evaluate('document.documentElement.scrollHeight')
    for y in range(0, h + 400, 300):
        pg.evaluate('window.scrollTo(0, %d)' % y); pg.wait_for_timeout(120)
    pg.evaluate('window.scrollTo(0, 0)'); pg.wait_for_timeout(600)

results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print('PASS' if ok else 'FAIL', '-', name, detail)

errs = []   # 整次執行收到的頁面錯誤與 console error

CARDS_JS = """() => [...document.querySelectorAll('.sec')].map(sec => [...sec.querySelectorAll('a.cardlink')].map(a => {
  const cv = a.querySelector('canvas').getBoundingClientRect();
  return {
    id: a.getAttribute('href').slice(1),
    ask: (a.querySelector('.ask') || {}).textContent || '',
    tags: [...a.querySelectorAll('.tag')].map(t => ({
      text: t.textContent,
      size: parseFloat(getComputedStyle(t).fontSize),
      r: t.getBoundingClientRect(),
    })),
    cv: { l: cv.left, t: cv.top, r: cv.right, b: cv.bottom },
  };
}))"""

with sync_playwright() as p:
    b = p.chromium.launch()

    def new_page(width, height, dsf=2, dark=False):
        ctx = b.new_context(viewport={'width': width, 'height': height}, device_scale_factor=dsf)
        pg = ctx.new_page()
        pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
        pg.on('console', lambda m: errs.append('console: ' + m.text) if m.type == 'error' else None)
        if dark:
            pg.emulate_media(color_scheme='dark')
        return pg

    # ---------- 圖鑑牆（390 寬）----------
    pg = new_page(390, 844)
    pg.goto(WALL)
    pg.wait_for_selector('.sec')
    pg.wait_for_timeout(1500)
    cards = pg.evaluate(CARDS_JS)
    flat = [c for sec in cards for c in sec]

    h1 = pg.inner_text('h1')
    check('標題文字', h1.replace('\n', ' ').strip() == '12 個經營問題，選一個放進你的資料', '(%s)' % h1)
    check('卡片共 12 張', len(flat) == 12, '(%d)' % len(flat))
    check('四區各 3 張', [len(s) for s in cards] == [3, 3, 3, 3], '(%s)' % [len(s) for s in cards])

    ids_seen = [c['id'] for c in flat]
    check('12 張卡都對得上對照表的 id', sorted(ids_seen) == sorted(EXPECT.keys()), '(%s)' % sorted(set(ids_seen) ^ set(EXPECT.keys())))

    n_start = sum(1 for c in flat if any(t['text'] == TAG_TEXT['start'] for t in c['tags']))
    n_adv = sum(1 for c in flat if any(t['text'] == TAG_TEXT['adv'] for t in c['tags']))
    check('「先從這個開始」標籤剛好 4 張', n_start == 4, '(%d)' % n_start)
    check('「進階」標籤剛好 4 張', n_adv == 4, '(%d)' % n_adv)

    bad_ask = [(c['id'], c['ask'], EXPECT[c['id']][0]) for c in flat if c['id'] in EXPECT and c['ask'] != EXPECT[c['id']][0]]
    check('每張卡的主標等於對照表', not bad_ask, '' if not bad_ask else str(bad_ask))

    bad_tag = []
    for c in flat:
        want = EXPECT[c['id']][1]
        got = [t['text'] for t in c['tags']]
        exp = [TAG_TEXT[want]] if want else []
        if got != exp:
            bad_tag.append((c['id'], got, exp))
    check('每張卡的標籤與對照表一致', not bad_tag, '' if not bad_tag else str(bad_tag))

    rank_bad = []
    for si, sec in enumerate(cards):
        ranks = [0 if EXPECT[c['id']][1] == 'start' else 2 if EXPECT[c['id']][1] == 'adv' else 1 for c in sec]
        if ranks != sorted(ranks):
            rank_bad.append((si, ranks))
    check('每區順序：起手在前、進階在後', not rank_bad, '' if not rank_bad else str(rank_bad))

    first_ok = all(EXPECT[sec[0]['id']][1] == 'start' for sec in cards)
    check('每區第一張是起手卡', first_ok, '(%s)' % [sec[0]['id'] for sec in cards])

    tag_small = [(c['id'], t['size']) for c in flat for t in c['tags'] if t['size'] < 10]
    check('標籤字級至少 10px', not tag_small, '' if not tag_small else str(tag_small))

    out_cv = []
    for c in flat:
        for t in c['tags']:
            r, cv = t['r'], c['cv']
            if r['left'] < cv['l'] - 0.5 or r['top'] < cv['t'] - 0.5 or r['right'] > cv['r'] + 0.5 or r['bottom'] > cv['b'] + 0.5:
                out_cv.append(c['id'])
    check('標籤都落在縮圖框內', not out_cv, '' if not out_cv else str(out_cv))

    sw = pg.evaluate('document.documentElement.scrollWidth')
    check('390px 寬時無水平溢出', sw <= 390, '(scrollWidth=%s)' % sw)

    warm(pg)
    pg.screenshot(path=str(SHOTS / 'wall_phone.png'), full_page=True)
    pg.close()

    # ---------- 圖鑑牆（1280 寬）----------
    pg = new_page(1280, 900, dsf=1)
    pg.goto(WALL)
    pg.wait_for_selector('.sec')
    pg.wait_for_timeout(1500)
    warm(pg)
    pg.screenshot(path=str(SHOTS / 'wall_desktop.png'), full_page=True)
    pg.close()

    # ---------- 圖鑑牆（390 寬，深色）----------
    pg = new_page(390, 844, dark=True)
    pg.goto(WALL)
    pg.wait_for_selector('.sec')
    pg.wait_for_timeout(1500)
    warm(pg)
    pg.screenshot(path=str(SHOTS / 'wall_dark.png'), full_page=True)
    pg.close()

    # ---------- 套餐頁截圖（390 寬，只截上方 900px）----------
    for sid in ['kmeans', 'season']:
        pg = new_page(390, 844)
        pg.goto(WALL + '#' + sid)
        pg.wait_for_selector('.panel')
        pg.wait_for_timeout(2600)
        pg.screenshot(path=str(SHOTS / ('page_%s.png' % sid)), clip={'x': 0, 'y': 0, 'width': 390, 'height': 900})
        pg.close()

    # ---------- 既有檢查：#linear #multi #tree #holt 不報錯 ----------
    for sid in ['linear', 'multi', 'tree', 'holt']:
        pg = new_page(390, 844, dsf=1)
        before = len(errs)
        pg.goto(WALL + '#' + sid)
        pg.wait_for_selector('.panel')
        pg.wait_for_timeout(2600)
        n_err = pg.evaluate("document.querySelectorAll('.err').length")
        check('#%s 沒有 .err' % sid, n_err == 0, '(%d)' % n_err)
        pg.close()

    # ---------- 錯誤 ----------
    check('整次執行沒有 pageerror 與 console error', not errs, '' if not errs else str(errs[:6]))

    b.close()

print('---')
print('%d / %d PASS' % (sum(results), len(results)))
sys.exit(0 if all(results) else 1)
