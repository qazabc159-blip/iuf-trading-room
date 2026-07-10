# 報價鏈全通道擋單 P1 — KGI Ingest Bridge + Calendar Gate 實作報告

Author: Jason | Branch: `feat/kgi-quote-bridge-calendar-gate-jason-20260710`
依據：`reports/quote_chain_outage_20260710/DIAGNOSIS_v1.md`（另一 Jason 唯讀診斷分身，worktree `agent-aad3182db76a8dbd7`）
Cross-lane approval：Elva 本輪核准擴大 lane 至 `market-data.ts`/`market-data-store.ts`/`kgi-subscription-manager.ts`/`server.ts`（cron 區塊）

## 1. 任務 1 — kgi ingest 橋接

**問題**：`quoteProviders.kgi`（風控報價閘門讀的 in-memory bucket）全 repo 零生產寫入端；readiness="ready" 數學上只有 `selectedSource==="kgi"` 才成立，故即使 KGI 行情 auth 修好，該桶依然是空的。

**修法（純 additive，未動 readiness 判定式、未動其他 bucket）**：
1. `market-data.ts` 新增 `upsertKgiQuotes()`（鏡射既有 `upsertPaperQuotes` pattern，`sourceOverride:"kgi"`）— 正式的 `quoteProviders.kgi` 寫入入口。
2. `kgi-subscription-manager.ts` 的 `fetchKgiLatestTick()` 加上 `export`（純 visibility 變更，無邏輯改動）— 讓 server.ts 的新 cron 可以直接呼叫既有 tick 拉取邏輯。
3. `server.ts`（cron 區塊）新增 `KGI-QUOTE-INGEST-CRON`：交易時段（08:55–14:35 TST 平日）每 60 秒對 `CORE_SYMBOLS + STRATEGY_SYMBOLS`（19 檔恆常訂閱權值股，訊號密度最高的子集，非全 40 檔展示用 heatmap universe）拉 KGI tick，過濾出有效價後呼叫 `upsertKgiQuotes()`。Fail-open try/catch，不拋錯。

**Live 驗證前置**：KGI SIM 行情 auth 現在壞著（`KGI_QUOTE_AUTH_UNAVAILABLE` — 帳號/SDK 層缺口，非本 repo bug），故此 cron 目前每次都會拉到 null tick，等同 no-op。**尚未也無法在本輪對 prod 做 live 驗證**，需先由楊董/對外窗口確認 KGI SIM 帳號行情訂閱權限後才能驗到真 tick 流入。

**單元測試（誠實替代 live 驗證）**：
- `KGI-BRIDGE-1`：`upsertKgiQuotes` 注入模擬 tick → `quoteProviders.kgi` 確實有值，且 `manual` 桶不受影響（證明真的走 sourceOverride，不是巧合）
- `KGI-BRIDGE-2`：注入新鮮模擬 tick → `getEffectiveMarketQuotes()`（既有、未改動的 readiness 公式）回傳 `readiness:"ready"`、`liveUsable:true`、`synthetic:false`、`selectedSource:"kgi"`
- `KGI-CRON-1`：source-regex 確認 server.ts 真的呼叫 `fetchKgiLatestTick` + `upsertKgiQuotes`，且 `kgi-subscription-manager.ts` 確實 export 了 `fetchKgiLatestTick`/`CORE_SYMBOLS`/`STRATEGY_SYMBOLS`

## 2. 任務 2 — cron 交易日曆 gate

**問題**：`_runTwseMisQuoteCron`/`_runTwseEodCron` 只認 Taipei HH:MM + 平日，不查實際交易日曆；7/10 颱風休市當天三個官方端點全卡在 7/9 日期，兩個 cron 整天空轉。

**設計決策（實作方式判斷，已在程式碼註解中說明）**：兩個 gate 都選擇「零新依賴的既有訊號式判法」，拒絕新呼叫 TWSE OpenAPI holidaySchedule 端點（會增加新的外部依賴/延遲）：

- **`_isMisFeedNonTradingDaySignal`**（MIS cron）：MIS 是即時盤中 feed，一旦開盤自己的 `d` 欄位就該立刻反映「今天」；若還卡在前一交易日，是可靠的非交易日訊號（不像 STOCK_DAY_ALL 本來就要等收盤後才更新，用它判斷會在每個交易日早上都誤判）。每個 tick 獨立判斷、不留狀態（self-healing）：某一次 45 秒 tick 誤判也只影響那一次，下一次會重新檢查。只在第一個 batch 檢查，命中就跳過剩餘 batch + 尾段 index 抓取。
- **`_isTwseEodCronTradeDateAlreadyPersisted`**（EOD cron）：STOCK_DAY_ALL 自己的交易日期只有在真的有新一個交易日收盤資料發布時才會前進；用「跟上次成功持久化的日期比對」取代真的判斷日曆，在任何真交易日都不會誤殺（新日期一定會放行），且**不影響新鮮度**——因為 `ts`（注入用的 timestamp）本來就是 `tradingDateIso` 本身，不是 wall-clock 時間，重複注入同一天的資料本來就不會刷新 `ageMs`，所以跳過重複注入對 readiness 沒有任何副作用。

兩者皆 fail-open：訊號不明確（空字串/null）一律不 gate，照舊跑。

**測試**：
- `MIS-CALENDAR-GATE-1`/`EOD-CALENDAR-GATE-1`：純函式單元測試，涵蓋「同日不擋」「跨日擋」「訊號缺失 fail-open」
- `MIS-CALENDAR-GATE-2`/`EOD-CALENDAR-GATE-2`：source-regex 確認兩個 cron 真的呼叫對應 gate function，且 EOD cron 在成功路徑會更新 `_twseEodCronLastPersistedTradeDate`

## 3. 驗證結果

- `pnpm run build:packages`：綠（5/5 cache hit）
- `pnpm --filter @iuf-trading-room/api run typecheck`：綠（0 errors）
- `pnpm --filter @iuf-trading-room/api run build`：綠
- `pnpm test`：1608 tests，1598 pass / 2 fail / 8 skipped。**2 個失敗**是本機 shell 環境 `FINMIND_TOKEN`/`FINMIND_API_TOKEN` 環境變數洩漏造成的既有已知問題（`apps/api/src/data-sources/finmind-client.test.ts` T3/T11），與本次改動的檔案完全無關（同樣問題在先前多輪 PR 報告中已記錄過，非本輪引入）。新增的 7 個測試（KGI-BRIDGE-1/2、KGI-CRON-1、MIS-CALENDAR-GATE-1/2、EOD-CALENDAR-GATE-1/2）全綠。
- `pnpm smoke`：綠（1/1 checks pass）

## 4. Lane 邊界

僅修改本輪 Elva 核准擴大範圍內的 4 個檔案：`apps/api/src/market-data.ts`、`apps/api/src/kgi-subscription-manager.ts`、`apps/api/src/server.ts`（僅 cron 區塊：import list 加一行 + 2 個 cron 函式內插入 gate + 新增一個 cron block + 2 個 module-level 匯出 pure function + 收板 log 一行）、`tests/ci.test.ts`（新增測試，未改動既有測試）。

**未觸碰**：readiness 判定式（`market-data.ts:2551-2560` 原封不動）、其他 quoteProviders bucket（manual/paper/tradingview 邏輯零變更）、`packages/contracts/src/marketData.ts`（`quoteSourceSchema` 已含 "kgi"，無需改 contracts）、`risk-engine.ts`、`broker/*`、真金鎖檔。

## 5. 已知限制 / 誠實揭露

1. **P1 live 未驗**：KGI SIM 行情 auth 目前壞著，此 cron 在 prod 部署後仍會是 no-op（拉到的 tick 全是 null），直到帳號權限修復為止。這是預期中的限制，非本次實作的 bug。
2. **P2 EOD gate 的資料修正邊界情況**：若 STOCK_DAY_ALL 在同一交易日內對同一天的收盤價做事後修正（極罕見），dedup gate 會延遲到下一個交易日才撿到新值。這是刻意的 fail-open 取捨（詳見程式碼註解），影響面小且從未在本 repo 觀察到這種情況。
3. **KGI ingest cron 的追蹤宇宙範圍**：目前只涵蓋 `CORE_SYMBOLS + STRATEGY_SYMBOLS`（19 檔恆常訂閱），未涵蓋動態 `HOLDINGS`/`WATCHLIST` tier 或完整 40 檔 heatmap 展示宇宙。若之後需要對持倉/watchlist 個股也有 kgi 即時報價，需要另外擴充（跟隨 `syncHoldings`/`syncWatchlist` 的訂閱狀態），本輪未做（避免過度擴張任務範圍）。
