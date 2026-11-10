# 用法：python3 shot.py <dist 檔名，例 index 或 cluster> [套餐id ...]  → 截圖到 shots/，並印出頁面錯誤
import sys, pathlib
from playwright.sync_api import sync_playwright
R = pathlib.Path(__file__).parent; (R/'shots').mkdir(exist_ok=True)
name = sys.argv[1] if len(sys.argv)>1 else 'index'
ids = sys.argv[2:] or ['']
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    for i in ids:
        pg.goto((R/'dist'/(name+'.html')).as_uri() + ('#' + i if i else ''))
        pg.reload(); pg.wait_for_timeout(2800)
        pg.screenshot(path=str(R/'shots'/((i or 'wall') + '.png')), full_page=True)
        e = pg.query_selector('.err')
        print(i or 'wall', 'ERR:' + e.inner_text() if e else 'ok')
    print('page errors:', errs[:8])
    b.close()
