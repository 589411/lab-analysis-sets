# 數據分析套餐圖鑑

12 個經營問題（背後是回歸、分群、分類、預測共 12 個方法），做成固定流程的「套餐」：選問題、放資料、確認欄位、調參數、看結果。
純 JavaScript，沒有後端；資料只在瀏覽器裡計算。

**教學原型：上線前需另行驗證。** 示範資料全部是模擬的。

- 網站：https://sets.launchdock.app
- 卡片牆：https://lab.launchdock.app

## 結構
- `index.html`：建置產物（單一檔案），GitHub Pages 直接發佈這個檔
- `src/algos/`：演算法（純函式）　`src/sets/`：12 個套餐　`src/core.js`：框架與畫圖
- `data/`：示範資料與產生腳本（固定 seed）
- `tests/`：用 scikit-learn／scipy／statsmodels 算期望值，再用 Node 比對 JS 結果
- `SPEC.md`：新增套餐的規格

## 指令
```bash
python3 build.py                       # 重建 index.html
python3 tests/cluster_expected.py && node tests/cluster.test.js   # 其他類別同理
```

## 資料準備（交易明細 → 標準表）
分群、分類、預測的套餐可以直接吃交易明細：自動猜日期、顧客、金額欄，彙總成顧客表、有答案的顧客表或時間序列，並列出對帳。
看得懂民國年、千分位、退貨負數；欄位對應可複製成設定檔重複使用。規格見 `SPEC_PREP.md`，與 pandas 的核對在 `tests/prep*`（140 項一致）。
頁面不載入外部字型；只有讀 Excel 時會連網下載 SheetJS，CSV 與貼上可完全離線。

## 界定範圍與防呆
- 資料準備可加最多 3 條範圍條件（只留某些門市／通路、日期區間、數字區間）。「不在這次範圍」和「壞掉的資料」在對帳裡分開列。
- 內建「示範明細」是藍鴨生活（教學用虛構品牌）的 8,000 筆模擬交易。只留 `channel=store` 時對帳為 8,000 ＝ 507 ＋ 5,675 ＋ 114 ＋ 1,704，與課程文件的驗收數字相同（`tests/prep.test.js` 內有寫死檢查）。重產：`python3 data/make_demo_txn.py <sunlit-retail-sim 路徑>`。
- `tests/reality_check.md`：用藍鴨生活各張表撞出來的問題清單（針對加防呆之前的版本）；`tests/guard_shot.py`、`tests/prep_shot.py` 是對應修正的檢查。
- 資料太多時自動平均抽樣（kmeans／dbscan 2,000、階層式 600、K 近鄰 3,000），對帳會寫明。

## 核對狀態（2026-11-10）
- 回歸、分群、預測：與 Python 套件全部一致。
- 分類：邏輯迴歸、決策樹一致。K 近鄰對 scikit-learn 有 4 項不一致（80 筆考題差 2 到 3 筆，都在距離並列的點），
  對獨立的 Python 暴力法一致。`node tests/classify.test.js` 因此結束碼為 1，屬已知狀態。
- 只在 Chromium 手機寬度看過。Excel 上傳的程式已寫，但沒有實測（測試環境連不到 cdnjs）。
