# 數據分析套餐圖鑑：實作規格（給執行的 agent）

## 這是什麼
一個單頁網站。首頁是「套餐圖鑑牆」（4 類 × 3 張卡片），點卡片進到套餐頁。
套餐＝固定流程（清資料 → 建模型 → 檢查 → 白話結論），使用者只要放資料、確認欄位、拖滑桿。
對象：非技術的中小企業老闆與第一線人員。文字用台灣繁體中文、白話、短句。不用 emoji，不用破折號。

## 你不能改的檔案
`src/core.js`、`src/algos/base.js`、`src/style.css`、`build.py`、`shot.py`、`data/*`、`src/sets/10_regress_simple.js`。
需要它們改動時，不要自己改，寫在回報裡。只能新增／修改指派給你的檔案。

## 先讀這三個檔
1. `src/sets/10_regress_simple.js`：完整範例套餐，照它的結構寫。
2. `src/algos/base.js`：共用數學工具（ML.rng, mean, std, standardize, splitIdx, take, dist2, solve, ols, predictLinear, r2, rmse, mae, mape, pearson）。
3. `src/core.js` 裡的 `App.plot` 與 `U`（fmt, pct, ease, seg, clamp, extent, ticks, short）。

## 演算法檔 `src/algos/<類別>.js`
```js
(function () {
  'use strict';
  var ML = (typeof window !== 'undefined') ? window.ML : require('./base.js');
  ML.xxx = function (...) { ... };          // 純函式：不碰 DOM、不用 Math.random（要亂數用 ML.rng(seed)）
  if (typeof module !== 'undefined') module.exports = ML;
})();
```
不可使用任何外部函式庫。結果必須可重現（同輸入同輸出）。

## 套餐檔 `src/sets/<編號>_<類別>.js`
一個 IIFE，裡面對每個套餐呼叫一次 `App.register({...})`。欄位：
- `id`（英數小寫）、`cat`（regress｜cluster｜classify｜forecast）、`zh`、`en`（小寫英文名）
- `blurb`：卡片上的一行，格式「做什麼。用在哪」，20 字內
- `question`：使用者想回答的業務問題，一句白話
- `demo`：示範資料 key（daily｜members｜repurchase｜monthly）
- `pipeline`：3 到 5 個步驟短語，說明這個套餐自動做了什麼
- `roles`：`{key,label,type:'num'|'bin'|'label',multi?,min?,max?,guess:[示範資料欄名],prefer?,tip?}`
  - core 會自動刪掉選用欄位有空值的列，並顯示對帳。`bin` 欄位會被轉成 0/1，原本的兩個值在 `ctx.labels[key]`＝[代表0的值, 代表1的值]。
- `params`：`{key,label,type:'range',min,max,step,value,fmt?,tip?}` 或 `{type:'select',options:[{value,label}],value}`（select 的值是字串）
- `minRows`、`verified`（一句話：哪些數字已用哪個 Python 套件核對）
- `run(ctx)`：ctx = `{rows, n, cols, params, labels, col(name), X(names), ML, U, isDemo}`，回傳：
  - `note`（選填，補充對帳，例如訓練/考題列數）
  - `metrics`：最多 4 個 `{label,value(字串),hint}`
  - `charts`：1 到 2 張 `{title, ratio, draw(g,w,h,t), caption?}`。t 從 0 到 1 是進場動畫，t=1 是完成畫面。拖滑桿時 core 只會用 t=1 呼叫。
  - `reading`（一句結論）、`caution`（一句別過度解讀：樣本數、因果、資料範圍）、`action`（本週對誰做哪件事）
  - `table`：`{title, head:[], rows:[[]]}`（可複製貼到 Excel）
  - 出錯時 `throw new Error('白話說明哪裡不對、怎麼修')`
- `thumb(g,w,h,t)`：卡片縮圖動畫，t 在 0→1 循環（5 秒一輪）。畫面很小（寬約 110–330px），只畫形狀，不寫字。用 `ML.rng(固定seed)` 產生假資料點，每一格都重畫。要一眼看出這個方法在做什麼。

## 共同規則
- 訓練／考題切法一律用 `ML.splitIdx(n)`（索引 i%5===4 當考題），在刪掉空值之後切。
- 需要標準化就用 `ML.standardize`；考題要用訓練資料的 mean/std。
- 畫面上寫的規則＝實際計算的規則。門檻、切點不可說一套算一套。
- 顏色只用 `App.colors[i]` 與 `App.theme()`（ink, muted, line, accent, card, bg, good, warn, bad），深色模式才會正常。
- 圖上的文字要在畫布內，不可互相重疊；手機寬度約 330px 也要看得清楚。
- 數字顯示用 `U.fmt`／`U.pct`。
- 使用者可能上傳自己的資料：欄位數、列數、數值範圍都不一定，不可寫死示範資料的欄名或數值。資料不夠或不適用時丟出白話錯誤。

## 核對（必做，不一致不算完成）
1. `tests/<類別>_expected.py`：讀 `data/demo.json`，用和 JS 完全相同的清理與切法，以 scikit-learn／scipy／statsmodels 算出期望值，寫到 `tests/<類別>_expected.json`。
   清理：選用欄位值為 "" 的列刪掉。
2. `tests/<類別>.test.js`：`require('../src/algos/<類別>.js')`，用同樣資料呼叫你的 ML 函式，逐項和期望值比，印出每一項 PASS/FAIL 與差距，有 FAIL 時 `process.exit(1)`。
3. `python3 build.py <類別>` 組出 `dist/<類別>.html`（只含你這一類），再 `python3 shot.py <類別> <id1> <id2> <id3>` 截圖到 `shots/<id>.png`，並用 Read 工具親眼看每張圖：有沒有報錯、圖表有沒有畫出來、字有沒有重疊或超出。也截一次首頁（`python3 shot.py <類別>`）看縮圖。
4. 不可為了讓測試過而放寬容許誤差或改掉期望值；對不上就找原因，找不到就在回報裡如實寫。

## 回報格式（簡短）
- 完成的檔案
- 每項核對的 PASS/FAIL 與實際差距
- 沒做到、沒核對、或和規格不同的地方（如實寫）
- 需要 core/base 配合修改的地方
