# 報價鏈全通道擋單 P1 — Root-Cause Diagnosis v1

診斷者：Jason（唯讀，未改任何產品碼）｜依據：Bruce 7/10 §6 驗收報告 + 原始碼 grep/read + prod 即時 curl（SEED_OWNER）
時間：2026-07-10 09:5x TST（curl 驗證時仍在 08:55-14:35 clock window 內）

## 1. 斷點圖（誰餵誰）

```
quoteProviders[kgi|tradingview|paper|manual]  ←── in-memory Map + file JSONL (market-data-store.ts)
                                                    【與 quote_last_close DB 表完全無關，兩套獨立系統】
  kgi         ← 從無任何 ingest 呼叫（結構性缺口，非今日事故）
  tradingview ← 只有 TradingView webhook 主動打才有（外部依賴，現況零）
  paper       ← 只有 Admin 手動 POST /market-data/paper-quotes（結構性缺口，從無 cron/broker-fill 自動餵）
  manual      ← 唯一有自動 cron 餵的來源：
                 _runTwseMisQuoteCron（45s，08:55-14:35 clock window，僅認 msg.d===今天）
                 _runTwseEodCron（10min，clock window 外，僅認 tradingDateIso 解析成功）
                 MIS-FULL-UNIVERSE-SWEEP（10s/slice，同樣需 msg.d===今天）

readiness="ready"（→ safe=true）的唯一數學解 [market-data.ts:2551-2560]：
  freshnessStatus==="fresh" AND !synthetic AND selectedSource==="kgi"
  → manual/paper/tradingview 三源無論多新鮮，readiness 恆為 "degraded"，
    safe 恆為 false（= usable && readiness==="ready"）。這是設計行為，非資料新鮮度 bug。
```

## 2. 各腿證據

**腿 A — KGI 桶結構性從無寫入（獨立於今日事故，恆定存在）**
- `apps/api/src/market-data.ts` 的 4 個 `quoteProviders`（1979-1984 行）全走 `buildCachedProvider` → `listCachedProviderQuotes`（只讀 in-memory cache）。
- 寫入端只有 3 個：`upsertManualQuotes`／`upsertPaperQuotes`／`ingestTradingViewQuote`（2162-2212 行）。
- 全 repo grep `sourceOverride:\s*"kgi"` / `source:\s*"kgi"` 於 `apps/api/src`：**0 個命中**（唯一命中是 OHLCV kbar 的字面值，跟這條 quote gate 無關）。
- `kgi-subscription-manager.ts` 有自己一套 `kgi_tick` 快取（給 heatmap/LiveTickStreamPanel 用），**與這裡的 `quoteProviders.kgi` 完全是兩套系統，中間沒有橋接**。
- 結論：**即使 KGI SIM quote-auth 修好，"kgi" 這個 bucket 現在也不會有任何資料**——因為根本沒有程式碼把 gateway tick 寫進 `quoteProviders.kgi`。這是本次診斷最關鍵的新發現。

**腿 B — KGI_QUOTE_AUTH_UNAVAILABLE 觸發條件（6/2 舊病，7/10 現場複驗仍在）**
- `services/kgi-gateway/kgi_quote.py:47-84` `_resolve_stock_quote()`：登入物件沒有 `api.Quote`，退回檢查 `api._ObjOrder._URL.token`——若也沒有，直接 raise `KGI_QUOTE_AUTH_UNAVAILABLE: login succeeded but market-data token/Quote is unavailable`（66 行）。即 KGI SIM 帳號的登入 session 拿到交易權杖但沒拿到行情訂閱權杖，這是 SDK/券商端帳號權限問題，非本 repo 邏輯 bug。
- 6/2 報告 `evidence/w7_paper_sprint/CODEX_KGI_SIM_DAILY_SMOKE_AUDIT_FALLBACK_2026-06-02.md` 只留一句「after-hours 曾出現 KGI_QUOTE_AUTH_UNAVAILABLE，待盤中重測」——**沒有 root-cause，只是待辦**，7/10 盤中重測（見下）證實**盤中一樣是 unavailable**，代表這不是「盤後假象」，是持續性帳號/SDK 缺口。
- 現場複驗（`GET /api/v1/kgi/status`，09:55:57 TST，owner session）：
  `"kgi_logged_in":true,"quote_connected":false,"gateway_quote_auth":{"available":false,"state":"unavailable","errorCode":"KGI_QUOTE_AUTH_UNAVAILABLE","subscribedTickCount":0}`
- 5/13 楊董裁定 `feedback_main_page_twse_openapi_decouple_kgi_2026_05_13.md` 明確只把**首頁大盤/熱力圖/漲跌家數**解耦到 TWSE OpenAPI，「個股深度 quote / 委託簿」條文寫死「唯一可信即時 source = KGI gateway」——**這條解耦從設計上就沒有、也不打算覆蓋下單用的報價閘門**，是刻意保留、不是遺漏。

**腿 C — quote_last_close 假說：不成立，兩套系統無關**
- 全 repo grep `quote_last_close`：只出現在 `sim-ledger-backfill.ts` / `server.ts`(EOD cron 寫入) / `s1-sim-runner.ts` / `quote-last-close-store.ts`，**`market-data.ts`／`risk-engine.ts` 完全不讀這張表**。
- `quote_last_close` 是 F-AUTO 帳本/S1 EOD mark-to-market 專用的 DB 兜底表，與這裡的 `paper.safe`/`execution.safe`（走 in-memory + file JSONL 的 `quoteProviders`）是**两条完全独立的管线**。
- 另一位 Jason 正在修的 `_runTwseEodCron` tradingDateIso 解析器（server.ts ~18472-18480），只影响该 cron 写入 `quote_last_close` 那一段（`if (db3 && tradingDateIso)`，18516 行）；**同一个 cron 呼叫 `upsertManualQuotes`（18434-18507 行）完全不依赖 tradingDateIso 解析成功**（`ts = tradingDateIso || new Date().toISOString()`，18480 行，解析失败也会退回 now() 照样写 manual 桶）。
- **結論：假說不成立**——`decision-summary` 的 `paper.safe=0/10` 與 quote_last_close 斷寫無因果關係，是兩個獨立問題，不要合併修。

**意外發現（非任務假說內，7/10 現場 curl 證實）：今天可能不是交易日**
- 09:55-09:56 TST 三個獨立 TWSE 官方端點（MIS 個股 2330、MIS 大盤 t00/o00、OpenAPI STOCK_DAY_ALL / MI_5MINS_HIST）**全部回傳最新資料日期 = 2026-07-09**，而非今天 2026-07-10（五）。`sysDate=20260710` 但 `d`/`Date`欄位卡在 07-09，且指數收盤時間戳為 13:33（昨日收盤時刻）。
- 這與 `_runTwseMisQuoteCron` 的 `isTodayMisTradeDate()` 過濾邏輯（只認 `msg.d===今天`）交互作用：**若今天真的不是交易日，manual 桶今天全天不會有任何新資料被注入**（cron 每 45s 跑一次但每次都被日期過濾器全數濾掉），而 `_runTwseEodCron` 又因為 clock 判斷「現在在 08:55-14:35 window 內」而整天不觸發——兩個 cron 在非交易日的 clock-window 之間出現雙重空窗，**這兩個 cron 都只認 Taipei HH:MM，不查台股交易日曆**。
- 我在 09:55 對 prod 重打 `decision-summary?symbols=2330`：回傳 `total:0, items:[]`（連 degraded 都沒有，比 Bruce 09:2x 記錄的「manual 有選到、degraded」更差）。這個落差**未查證**成因（可能是 Bruce 測試當下 file-persisted 快取還殘留 7/9 資料尚未清空，或兩次測試間有 deploy 重啟清空了 in-memory cache）；建議下一個確認是交易日的盤中窗口重新對照一次，才能排除「今天非交易日」對 Bruce 讀數的干擾。
- 若今天確實非交易日（颱風假等未列入固定行事曆的臨時休市，見 `feedback_tw_market_calendar_check.md` 第 21 行「颱風假」類別），Bruce 報告的「盤中」定性可能需要修正措辭，但**不影響腿 A／腿 B 兩個結構性缺口本身**（那兩個缺口在任何一個真正的交易日都會重現，因為 kgi 桶從無寫入是永久性的，跟今天是不是交易日無關）。

## 3. 修復優先序（閘門本身不放寬，只討論怎麼讓 kgi 這條真即時源打通）

1. **P0 — 對外協調（非工程）**：確認 KGI SIM 帳號/API 是否真的具備行情訂閱權限（`KGI_QUOTE_AUTH_UNAVAILABLE` 是 SDK 层面「登入物件沒有市場資料 token」），需要跟 KGI 對帳號權限，或檢查 kgisuperpy SDK 版本/登入流程是否遺漏行情 handshake 步驟。這條不解，後面全部白做。
2. **P1 — 新建橋接（market-data.ts + kgi-subscription-manager.ts，非我 lane）**：即使腿 A 解了，也要新增一個 `ingestKgiQuote()`（比照 `ingestTradingViewQuote` 的寫法）把 kgi-subscription-manager 收到的即時 tick 寫進 `quoteProviders.kgi` 桶。**目前完全不存在，是本次診斷最大的新發現**，建議獨立立項，不要跟 P0 綁在一起估時間。
3. **P2 — cron 交易日感知（server.ts，非我 lane）**：`_runTwseMisQuoteCron` / `_runTwseEodCron` 的 window 判斷只看 Taipei HH:MM，沒有查交易日曆 → 非交易日整天雙重空窗。建議接一個輕量交易日 gate（可用 MIS 回傳的 `d` 欄位跟今天比對，邏輯已經有雛形，只是沒有把「今天可能整天沒交易」這個狀態 surface 出來給 owner 看，純粹靜默 no-op）。
4. **不建議**：不要為了讓 safe=1 而放寬 readiness 判定（synthetic/non-live 源永遠不能是 "ready"）——這條是產品鐵律，需要楊董 ACK 才能動。

## 4. 建議派工切法

- P0 交楊董/對外窗口（券商帳號層級，非 code）。
- P1（新 kgi ingest 橋接）與 P2（cron 交易日 gate）都在 `market-data.ts`/`server.ts` 的 market-data 區塊，屬於 market-data lane（Jason 目前 forbidden file），需要 Elva 明確核准擴權後才能派。兩者可以同一個 PR 一起做（同檔案同區塊），但建議先做 P1（結構性缺口，任何交易日都有效）、P2 當 P1 的隨手驗證副產品（同一輪測會用到）。
