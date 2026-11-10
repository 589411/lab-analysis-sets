# 「資料準備」規格（先讀 SPEC.md，再讀這份）

企業的原始資料通常是「交易明細」（一列一筆交易），但套餐要的是整理好的「標準表」。
這一層負責：看懂日期與數字 → 猜欄位 → 彙總成標準表 → 交出對帳報告。全部在瀏覽器內執行。

## 套餐需要哪種表（set.needs，已寫在各套餐）
| needs | 標準表 | 欄位（順序固定） |
|---|---|---|
| customer | 顧客彙總，一位顧客一列 | 顧客, 最近購買天數, 購買次數, 平均客單, 累積金額 |
| labeled | 有答案的顧客表 | 顧客, 最近購買天數, 購買次數, 平均客單, 之後回購 |
| series | 時間序列，一期一列 | 期別, 營收, 交易筆數 |
| wide | 任何表都可以，不需要資料準備 | |

表的格式一律是 `{name, cols:[欄名], rows:[{欄名: 值}]}`。原始表的值都是字串；標準表的數字欄是 number。

## 演算法 API：`src/algos/prep.js`，全部掛在 `ML.prep`
檔案樣式同 SPEC.md 的演算法檔（IIFE、Node 可 require、純函式）。

- `num(v)` → number 或 NaN。去掉千分位逗號（半形、全形）、空白、`$`、`NT`、`元`；結尾 `%` 去掉；括號負數 `(1,200)` → -1200；空字串 → NaN。
- `parseDate(v)` → 整數「日序」（自 1970-01-01 起算的天數，UTC）或 NaN。只取日期、忽略時間。要支援：
  `2026-01-05`、`2026/1/5`、`2026.1.5`、`20260105`、`2026-01-05 13:22:00`、`2026-01-05T13:22:00`、`2026年1月5日`、
  民國年 `115/01/05`、`115.1.5`、`115-01-05`、`民國115年1月5日`、七碼 `1150105`（年份 1–199 一律當民國年，加 1911）、
  `1/5/2026`（月/日/年；四碼年在最後時用這個順序）。
  月 1–12、日要是該月實際存在的日子，否則 NaN。純數字且不是 7 或 8 碼 → NaN（不猜 Excel 序號）。
- `dayToISO(n)` → `'YYYY-MM-DD'`。
- `profile(table)` → 每欄 `{col, kind, n, missing, unique, idLike, sample}`。
  kind：非空值中 ≥80% 能 parseDate → `'date'`；否則 ≥80% 能 num → `'number'`；否則 `'text'`。（先判日期）
  `unique`＝非空相異值個數；`idLike`＝unique ≥ 非空數的 95% 且非空數 ≥ 20；`sample`＝前 3 個非空值。
- `guessMapping(profile)` → `{date, customer, amount, order}`，值是欄名或 null。規則（依序，欄名比對不分大小寫）：
  - date：kind 是 date 的欄中，欄名含「日期、時間、date、time、day」者優先，否則第一個 date 欄。
  - amount：kind 是 number 的欄中，欄名含「實收、總額、總計、金額、營收、銷售額、小計、amount、total、revenue、sales、price」者，依這個清單的先後取第一個命中；沒有就 null（不亂猜）。
  - customer：欄名含「會員、顧客、客戶、客編、member、customer、cust、client、user」者取第一個；沒有就 null。
  - order：欄名含「訂單、單號、交易編號、發票、order、txn、invoice、receipt」者取第一個；沒有就 null。不可和 customer 同欄。
- 三個轉換函式，共同輸入 `(rows, map, opt)`，`map = {date, customer, amount, order?}`（欄名）。
  **每一列只會被歸到一類，依這個順序判斷**：`badDate`（日期看不懂）→ `badAmount`（金額不是數字）→ `nonPositive`（金額 ≤ 0，視為退貨或贈品）→ `noCustomer`（顧客欄空白，只有 customer／labeled 才判）→ `used`。
  report 一定有 `{total, used, badDate, badAmount, nonPositive, noCustomer, firstDate, lastDate}`（日期是 ISO 字串，取自 used 的列），且 `total = used + badDate + badAmount + nonPositive + noCustomer`。used 為 0 時丟白話錯誤。
  - `txnToCustomer(rows, map, opt)`：`opt.asOf`（日序，預設＝used 列的最後一天）。每位顧客：最近購買天數＝asOf − 該顧客最後購買日；購買次數＝used 列數（有 map.order 時改算相異訂單數）；累積金額＝金額加總；平均客單＝累積金額／購買次數。依顧客字串由小到大排序。回傳 `{table, report}`，report 另加 `customers`、`asOf`。
  - `txnToSeries(rows, map, opt)`：`opt.period` 'month'｜'week'｜'day'（預設 month），`opt.dropPartial`（預設 true）。期別標籤：month＝`YYYY-MM`；week＝該週星期一的 ISO 日期；day＝ISO 日期。從第一期到最後一期中間沒有交易的期要補 0。dropPartial 時：第一期若 firstDate 不是該期第一天就丟掉；最後一期若 lastDate 不是該期最後一天就丟掉（day 不丟）。report 另加 `periods`、`filledZero`（補 0 的期數）、`droppedPartial`（被丟掉的期別標籤陣列）。營收＝金額加總，交易筆數＝used 列數（有 order 時算相異訂單數）。丟完少於 2 期時丟白話錯誤。
  - `txnToLabeled(rows, map, opt)`：`opt.windowDays`（預設 90），`opt.cutoff`（日序，預設＝lastDate − windowDays）。特徵只用日期 ≤ cutoff 的 used 列（定義同 txnToCustomer，asOf＝cutoff）；之後回購＝該顧客在 cutoff < 日期 ≤ cutoff+windowDays 有任一 used 列則 1，否則 0。cutoff 之前沒有交易的顧客不列入。lastDate < cutoff+windowDays 時丟白話錯誤（觀察期不夠長）。report 另加 `customers`、`cutoff`（ISO）、`windowDays`、`positives`。
  金額加總後四捨五入到小數 2 位再存；平均客單同。

## 介面 API：`src/prep_ui.js`（＋樣式 `src/prep.css`）
`App.prep = { mount(box, ctx) }`。core 在使用者資料進來時呼叫，`ctx = {set, raw, onTable(table), onError(err)}`。
- `ctx.onTable(table)`：把要拿去分析的表交回去（可以呼叫很多次，每次設定改變就重新交）。
- 介面內容與行為見執行者的任務說明。

## 界定範圍（2026-11-10 新增）
「不在這次題目裡的資料」和「壞掉的資料」是兩件事，要分開算、分開寫。例：只看實體門市、不看網路商店。

- `ML.prep.applyScope(rows, rules)` → `{rows: 留下的列（原物件、原順序）, out: 被排除的列數, perRule: [每條規則排除的列數]}`。
  rules 是陣列，全部都要符合才留下（AND）；一列被多條規則排除時，只記在陣列中最前面那條。rules 為空或 null 時全部留下。
  - `{col, op:'in', values:[字串]}`：該欄去頭尾空白後的字串在 values 裡才留下。空白值用空字串 `''` 表示。
  - `{col, op:'dateRange', from, to}`：from、to 是 ISO 日期字串或 null（不設限），含頭含尾。日期看不懂的列**留下**（之後會被算進「日期看不懂」，不可以在這裡默默消失）。
  - `{col, op:'numRange', min, max}`：數字或 null，含頭含尾。不是數字的列**留下**。
  - col 不存在於資料時丟白話錯誤。
- 介面先 applyScope，再把留下的列交給三個轉換函式（或在「已經整理好」模式直接交出去）。對帳等式變成：
  `原始 N ＝ 不在這次範圍 x ＋ 用來計算 a ＋ 日期看不懂 b ＋ …`。
- 對應設定 JSON 多一個 `scope: [rules]`。
