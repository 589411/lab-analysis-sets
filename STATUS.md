# STATUS — lab-analysis-sets（數據分析套餐圖鑑 v3）

更新：2026-11-10

## 現況
- 網站（純前端單檔 `index.html`）已推上 `589411/lab-analysis-sets`（公開，`main`）。
- GitHub Pages 已啟用，自訂網域 `sets.launchdock.app` 已設，狀態 building，**HTTPS 尚未開**。
- 本機 node 測試：prep／regress／cluster／forecast 全過；classify 結束碼 1（K 近鄰對 sklearn 4 項不一致，已知狀態，不要為了過關去改）。
- 交接文件的 zip 內有 `.nojekyll`、`.gitignore`，手動複製時漏掉；`.nojekyll` 已補，`.gitignore` 是重寫的簡版（`__pycache__/ *.pyc .DS_Store node_modules/`），與原版未比對。

## 卡在哪
**DNS 還沒加**：`sets.launchdock.app` 沒有解析紀錄。
- wrangler OAuth 只有 `zone:read`，寫不了 DNS。
- 能寫 DNS 的是 Keychain 的 `cloudflare-api-token`，但 Claude Code auto mode 擋讀 Keychain（「憑證探索」），要 Joseph 用 `!` 自己跑，或自己在 dashboard 加。
- Claude in Chrome 開 dash.cloudflare.com 是未登入狀態，需 Joseph 先登入（帳號 589411）。

## 下一個具體動作
1. Joseph 加 DNS：`launchdock.app` zone → `sets` CNAME → `589411.github.io`，**DNS only（灰雲）**。
2. 憑證簽發：`gh api -X PUT repos/589411/lab-analysis-sets/pages -F https_enforced=true`；若 404「certificate does not exist yet」且建置已 built，就 cname 清空再設回 `sets.launchdock.app`（可能要 Joseph 用 `!` 執行）。
3. 驗收：`curl -sI https://sets.launchdock.app` 回 200；瀏覽器照交接文件 2-C 腳本走，對帳數字 507／5,675／114／1,704。
4. **網站 200 之後**才合併 `launchdock-lab` 的 `origin/lab/analysis-sets`（順序不能反），跑 validate／build、push main、刪分支、更新 lab 的 STATUS.md。
5. 補測：Excel 上傳、真實剪貼簿、Safari／Edge／手機。

## 待 Joseph 決定
repo 名與子網域是否沿用；卡片是否 `pinned`／`qr`；卡片文字是否改成問題導向。
