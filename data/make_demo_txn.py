# 內建「示範明細」：藍鴨生活（原日晴生活，教學用虛構品牌）北部版的交易檔，原樣搬入，只多併一欄門市名稱。
# 來源：sunlit-retail-sim 的 data/transactions.csv 與 north-edition/out/data/stores.csv。數值不改。
# 用法：python3 data/make_demo_txn.py <sunlit-retail-sim 路徑>
import sys, json, pandas as pd, pathlib
src = pathlib.Path(sys.argv[1])
t = pd.read_csv(src/'data/transactions.csv', dtype=str, keep_default_na=False, encoding='utf-8-sig')
s = pd.read_csv(src/'north-edition/out/data/stores.csv', dtype=str, keep_default_na=False, encoding='utf-8-sig')
t.insert(3, 'store_name', t.store_id.map(dict(zip(s.store_id, s.name))))
assert len(t) == 8000 and t.store_name.notna().all()
out = {"txn": {"name": "藍鴨生活交易明細（虛構品牌，模擬）", "cols": list(t.columns), "aoa": t.values.tolist()}}
p = pathlib.Path(__file__).parent/'demo_txn.json'
p.write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')))
print(len(t), 'rows', p.stat().st_size//1024, 'KB')
