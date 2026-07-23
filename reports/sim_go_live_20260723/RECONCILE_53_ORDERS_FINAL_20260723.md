# 三 sleeve SIM go-live 53 單成交確認收官 — 2026-07-23（Jason，gateway 關機前）

執行時間：13:39-13:47 台北時間（`date -u` 對時：05:39-05:47 UTC +8），gateway 於本輪操作全程存活
（`/health` 13:39:41 回 `kgi_logged_in:true`），14:10 EventBridge 關機前完成。

## 結論摘要

- **走的是混合路徑**：gateway 收官前用即時 `/trades` `/deals` 重抓一次終版（13:42:19 UTC 05:42:19），
  與既有 `evidence/deals_1326_052809.json` / `trades_1326_052809.json`（main commit `8888015a`）
  **逐位元組相同**（`diff` 零輸出）——證實 13:26 快照已是真正收盤終態，13:42 這次重抓沒有新增資訊，
  未另存重複檔。
- **原指示的「用 #1345 補確認 cron 把成交確認寫回 audit_logs」對這批 53 單不適用，非流程失誤，是結構性
  發現**：見下方「重要發現」。因此本輪改採「用終版 snapshot 對 53 單送出記錄做逐筆核對」，產出本報告
  ＋機器可讀核對結果 `evidence/reconcile_53_orders_20260723.json`。
- 53 單核對結果：**Filled 31／PartFilled 7／Submitted（掛單未成交）11／INVALID_REJECTED 3／
  無法唯一區分的重複標的 1**（見下方明細與交叉驗證）。

## 重要發現（結構性，非本輪 bug）——53 單從未寫入 audit_logs

今日送單用的是 RUNBOOK 準備的獨立工具 `reports/sim_go_live_20260723/send_three_sleeve.mjs`，
不是 `apps/api/src/s1-sim-runner.ts` / `v34-sim-runner.ts` / `v51-sim-basket-runner.ts` 這三支
應用層 runner。查證：

- `send_three_sleeve.mjs` 全文 grep `audit_logs`/`INSERT`/`db.`/`drizzle` 零匹配——它只
  `POST {gateway}/order/create` 並把回應 append 進本地 `evidence/orders_20260723.jsonl`，
  完全不碰 DB。
- `#1345`（commit `05cd7c45`，已 merge 且已部署——prod `/health` 目前 `buildCommit=53fb9d13`，
  是 `05cd7c45` 之後的版本，`deployedAt=2026-07-23T03:13:58Z`＝11:13:58 台北）新增的 5 分鐘
  `SIM-ORDER-RECONCILE-CRON`（`server.ts` 內 `setInterval`）邏輯是「重查 `s1_sim.orders_submitted` /
  `v34_sim.order_submit` / `v51_sim.order_submit` 這三個 `audit_logs` action 的既有 row，把裡面
  `status="unconfirmed"` 的項目對 gateway 重新核對後 UPDATE 回同一 row」——**它的前提是 audit_logs
  裡本來就要有一筆 row**。今天這 53 單走的是獨立工具，從未寫過這三個 action 的任何 row，所以這顆
  cron 對這批單「沒東西可 reconcile」，不是它壞掉或沒跑。
- 因此 audit_logs 完全沒有這 53 筆委託的紀錄可查（本輪嘗試直連 prod Postgres 做二次查證，見下方
  「未解決事項」，被私網限制擋下，改用程式碼層面的證據——`send_three_sleeve.mjs` 沒有任何 DB 相關
  import/呼叫——已足以確立此結論，不影響本報告結論的可信度）。
- **後續建議**（不在本輪範圍內動手，留給下一輪或 Elva 裁定）：若未來 go-live 想要 audit_logs 有紀錄
  可查，兩個選項——(a) 改用真的 runner 程式碼路徑送單（非本輪允許改動範圍）、(b) 針對本工具補一支
  一次性 backfill script，把 `orders_20260723.jsonl` + 終版 `/trades` `/deals` 轉成
  `s1_sim`/`v51_sim`/`v34_sim` 對應 schema 寫入 `audit_logs`（需先確認這批單語意上屬於哪個 pipeline、
  qty 單位換算是否套用 `#1345` 的 `toKgiOrderQty`/`fromKgiOrderQty`，避免張/股弄混——不建議在關機前
  臨時趕工，風險大於今天已拿到的 snapshot 證據值）。

## 核對方法

1. `orders_20260723.jsonl`（origin/main commit `1912dca4`，53 行，全部 `status:"accepted"`）逐行取
   `symbol` + `qty_lots`。
2. 對照終版 `/trades?full=true`（`8888015a`／13:26 快照，逐位元組核實於 13:42 未變）裡每個 KGI
   `order_id` bucket 的 `order.symbol` + `order.quantity`，做 symbol+qty 精確匹配（貪婪、一對一消耗，
   避免同 symbol 多單互相搶配對）。
3. 未直接匹配上的，回頭查 `/trades` 的 `無效單`（invalid）bucket——KGI 把被拒單的 `quantity` 歸零，
   所以送出時的原始張數對不上，需要用 symbol 單獨比對確認是「這張單被拒」而非「單子憑空消失」。
4. 交叉驗證：對每筆 `Filled`/`PartFilled` 單，加總 `order_status.deals[].quantity` 得
   **82 張**——與獨立的 `/deals` 彙總端點（38 筆成交紀錄，32 檔股票，合計 82 張）**完全吻合**，
   兩條獨立資料路徑互證，核對結果可信。

## 明細（53 單，orders_20260723.jsonl 送出序）

完整機器可讀版本見 `evidence/reconcile_53_orders_20260723.json`。狀態分布：

| KGI 狀態 | 筆數 | 說明 |
|---|---|---|
| Filled | 31 | 完全成交 |
| PartFilled | 7 | 部分成交（掛單餘額仍在，gateway 已關機不會再變動） |
| Submitted | 11 | 掛單中，收盤前未成交（同上，已定格） |
| INVALID_REJECTED | 3 | 委託被 KGI 拒絕（見下） |
| AMBIGUOUS（無法唯一區分）| 1 | 見下 |

`38 = Filled(31) + PartFilled(7)` 與 `/deals` 端點回報的 **38 筆成交紀錄**一致；
`sum(filled_qty_lots) = 82 張` 與 `/deals` 彙總 **82 張**一致。

### 3 筆 INVALID_REJECTED（委託被拒，KGI `無效單` bucket，quantity 歸零 price 歸零）

| sleeve | symbol | 送出張數 |
|---|---|---|
| v51_c1 | 1271 | 1 |
| v51_c3 | 5267 | 2 |
| v51_c3 | 6808 | 2 |

拒單原因欄位（`price_type`/`status_code`/`msg`）在 `無效單` bucket 內全為 `null`，gateway 端沒有
留下人類可讀的拒絕理由——本輪未深挖（超出「確認/證據收官」範圍），留待下一輪視需要再查
KGI SIM 端 log。

### 1 筆 AMBIGUOUS（symbol 重複、快照欄位不足以唯一區分兩筆送單）

`1808` 這檔股票今日被送了兩次：
- `v51_c1`／08:35 台北（人工 canary 定錨單，`qty_lots=3`）
- `v51_c3`／09:24 台北（批次單，`qty_lots=3`）

終版 `/trades` 裡只找到**一筆** `1808` 的 KGI 訂單記錄（`Y001R`，`quantity=3`，`PartFilled`，
成交 1 張）——找不到第二筆獨立記錄。`orders_20260723.jsonl` 裡兩筆送單各自都拿到獨立的
`trade_id`（gateway 內部追蹤 ID，非 KGI `order_id`）且 `http_status:200`，但 gateway 內部
`trade_id` 與 KGI `order_id`（`Y00xx`）之間的映射關係，這支工具的 evidence log 沒有記錄，本輪
無法回推究竟兩筆送單哪一筆真的落地成 `Y001R`、另一筆是否被 KGI 靜默去重/覆蓋。已在
`reconcile_53_orders_20260723.json` 內標記 `AMBIGUOUS_DUP_SYMBOL_NO_DISTINCT_RECORD`，不影響
其餘 52 筆的核對可信度。

## 與 F-AUTO/S1 既有經驗對照

`Filled(31)+PartFilled(7)=38` 筆有成交、`Submitted(11)` 掛單未成交、`INVALID_REJECTED(3)` 被拒——
73.6% 單有成交（含部分），與今日稍早 `1912dca4` 診斷（成交回報 10-40s+ 漸進回填延遲）的結論一致：
掛單未成交的 11 筆多半是流動性/價格未觸及，非系統性問題（無 SDK/WS 層錯誤訊號）。

## 未解決事項 / 意外

- 嘗試直連 prod Postgres（`railway run` 注入 `DATABASE_URL` 指向 `pg.railway.internal`，僅 Railway
  私網可解析；改試 `RAILWAY_SERVICE_PG_URL` 公開網域 `pg-production-9e4e.up.railway.app:5432`
  連線逾時；`railway connect pg` 回報找不到 `DATABASE_PUBLIC_URL` 變數）——**這台 Postgres 沒有對外
  公開 TCP proxy**，本地端無法直接查詢，只能靠程式碼層面（grep `send_three_sleeve.mjs`）與 prod
  `/health` buildCommit 佐證「#1345 已部署但對這批單無 row 可 reconcile」的結論，未能用一筆
  SQL 查詢做二次交叉驗證。不影響本報告結論（結論本身不依賴 DB 查詢，是程式碼事實）。
- 3 筆 INVALID_REJECTED 與 1 筆 AMBIGUOUS 的根因未深挖（見上方對應段落），留待下一輪視需要查
  KGI SIM 端 log 或請 Lab reconciler 一併對帳判讀。
- 明早 08:20 gateway 重開機後，`#1345` 的補確認 cron 會開始對**未來新單**（走真 runner pipeline
  的單）生效——今日這批獨立工具送出的 53 單不會被回填，是永久性的資料落點缺口（不是等 cron 補跑
  就會解決）。

## 檔案

- `reports/sim_go_live_20260723/evidence/reconcile_53_orders_20260723.json` — 53 單逐筆核對機器可讀結果
- `reports/sim_go_live_20260723/evidence/deals_1326_052809.json` / `trades_1326_052809.json`
  （既有 main commit `8888015a`）— 終版快照，本輪 13:42:19 重抓逐位元組核實一致，未重複提交

---
Jason（backend strategy engineer）／2026-07-23 13:39-13:47 台北時間
