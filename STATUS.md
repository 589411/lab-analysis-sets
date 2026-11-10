# STATUS — lab-analysis-sets（數據分析套餐圖鑑 v3）

更新：2026-11-10

## 現況（已上線）
- https://sets.launchdock.app 回 200，HTTPS 強制已開（憑證 approved，到 2027-02-08），http 會 301 轉址。
- Pages：`main` 根目錄，build 為 built。DNS：Cloudflare `sets` CNAME → `589411.github.io`（DNS only）。
- 驗收：照交接腳本實跑，12 張卡、4 張「先從這個開始」；示範明細＋channel 去掉 online → `原始 8,000 ＝ 不在這次範圍 507 ＋ 用來計算 5,675 ＋ 金額 ≤ 0 114 ＋ 散客 1,704`，整理成 1,056 位顧客，無錯誤框。
- lab 卡片已上架（`launchdock-lab` main，`lab.launchdock.app` 與 `/en/` 皆有，封面與兩個按鈕連結正常，分支 `lab/analysis-sets` 已刪）。
- 本機 node 測試：prep／regress／cluster／forecast 全過；classify 結束碼 1（K 近鄰對 sklearn 4 項不一致，已知，別為了過關去改）。
- zip 內的 `.gitignore` 沒複製到，現行是重寫的簡版（`__pycache__/ *.pyc .DS_Store node_modules/`）。

## 下一個具體動作
1. **補測**（雲端做不到）：Excel 上傳（SheetJS 從 cdnjs 載入，沒真的跑過）、真實剪貼簿三個按鈕、Safari／Edge／手機、資料準備面板深色模式。壞的列出重現步驟回報 Joseph，不用急著修。
2. 待 Joseph 決定：卡片是否 `pinned`／`qr`；卡片文字是否改成問題導向（目前沿用 v1 文案，內容仍正確）；repo 名與子網域是否沿用（已照文件上線）。

## 注意
- 改內容要改 `src/` 再跑 `python3 build.py`，不要手改 `index.html`。
- GitHub 憑證卡住時：cname 清空再設回；連續觸發建置會互相取消、狀態暫時顯示 errored，別疊加操作，等一個 run 跑完。
