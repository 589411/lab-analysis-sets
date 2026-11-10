# 把 src/ 組成單一 HTML：dist/index.html
import glob, json, pathlib, sys
ONLY = sys.argv[1] if len(sys.argv)>1 else ''   # 例：python3 build.py cluster → 只組 cluster 的檔案，輸出 dist/cluster.html
R = pathlib.Path(__file__).parent; (R/'dist').mkdir(exist_ok=True)
css = (R/'src/style.css').read_text() + ''.join(pathlib.Path(q).read_text() for q in sorted(glob.glob(str(R/'src/*.css'))) if not q.endswith('style.css'))
algos = [R/'src/algos/base.js'] + [pathlib.Path(p) for p in sorted(glob.glob(str(R/'src/algos/*.js'))) if not p.endswith('base.js') and ONLY in pathlib.Path(p).name]
sets = [pathlib.Path(p) for p in sorted(glob.glob(str(R/'src/sets/*.js'))) if ONLY in pathlib.Path(p).name]
_d = json.loads((R/'data/demo.json').read_text())
for q in sorted(glob.glob(str(R/'data/demo_*.json'))): _d.update(json.loads(pathlib.Path(q).read_text()))
demo = json.dumps(_d, ensure_ascii=False, separators=(',',':'))
extra = ''.join(pathlib.Path(q).read_text() + '\n' for q in sorted(glob.glob(str(R/'src/*.js'))) if not q.endswith('core.js'))
js = '\n'.join(p.read_text() for p in algos) + '\n' + (R/'src/core.js').read_text() + '\n' + extra + 'window.DEMO=' + demo + ';\n' + '\n'.join(p.read_text() for p in sets) + '\nApp.start();\n'
assert '</script' not in js.lower()
html = f'''<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>數據分析套餐圖鑑</title>
<style>
{css}
</style>
</head>
<body>
<main class="wrap" id="app"></main>
<script>
{js}
</script>
</body>
</html>
'''
import os
OUT = os.environ.get('OUT','')   # 例：OUT=b python3 build.py → 只寫 dist/b.html，不動根目錄 index.html（多人同時開發時用）
(R/'dist'/((OUT or ONLY or 'index')+'.html')).write_text(html)
if not ONLY and not OUT: (R/'index.html').write_text(html)   # GitHub Pages 讀根目錄的 index.html
print('built', len(html)//1024, 'KB;', len(sets), 'set files')
