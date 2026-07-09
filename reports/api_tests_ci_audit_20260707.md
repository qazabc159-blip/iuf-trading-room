# API 測試併入 CI 稽核 — 2026-07-07

**2026-07-09 追蹤更新**：本檔列出的 3 個「待修（mock/漂移）」檔（finmind-client / market-ingest / finmind-full-ingest）已修復並掛入根 `pnpm test`。詳見文末「2026-07-09 追蹤：3 檔待修已解決」一節。

**背景**：7/4 PR-A（#1162）照出假綠燈 — 根 `pnpm test` 原本只跑 `tests/` 下 4 檔 + PR-A 新增的 2 個 auth 檔（共 6 檔）。`apps/api/src/**/*.test.ts` 底下有 72 個測試檔（不含已掛的 2 個 auth 檔）**從沒進 CI**，等於「明明有測試卻沒在守」。

**本 PR 目標**：把「能安全獨立、記憶體模式（無 Postgres / 無外部服務）跑且綠」的那批啟用，分批穩掛，不貪多炸 CI 時間或引入 flaky。不改任何被測程式碼；不碰 broker 鎖檔。

---

## 方法

1. 盤點 `apps/api/src` 下全部 `*.test.ts`（74 檔，扣掉已掛的 `auth/require-min-role.test.ts`＋`auth/role-matrix.test.ts` = **72 候選檔**）。
2. 每檔以 CI 同款指令逐檔獨立實跑（`node --import ./tests/setup-test-env.mjs --import tsx --test <file>`，30s timeout，**不設 DATABASE_URL = 記憶體模式**），記錄綠/紅/超時＋耗時。
3. 只把「獨立綠且非明顯慢（node 自報 duration < ~3.5s）」的掛進根 `test` script。
4. 掛之前跑「既有 6 檔 + 新掛批」的**合併單一 `node --test` 呼叫**兩次，確認無跨檔干擾、無 flaky、可重現。
5. 需 DB / 外部服務 / 明顯慢 / 目前紅的，**不掛**，列於下方＋原因＋後續處理。

---

## 結果總覽

| 項目 | Before | After |
|---|---|---|
| 根 `pnpm test` 掛入檔數 | 6 | **70**（6 + 新掛 64） |
| 測試總數（tests） | 1017 | **1548** |
| pass / fail / skipped | 1017 / 0 / 0 | **1540 / 0 / 8** |
| 本機耗時（wall） | ~16s | **~26–30s** |

- typecheck：**綠**（未動任何 TS 程式碼）。
- W6 No-Real-Order Audit：**6/6 PASS**。
- 8 個 skipped 全為測試檔內建 `test.skip()` 的優雅自跳（需 DB 或需 coverage 資料檔，環境不具備時乾淨跳過，不會紅 CI）— 這正是要的安全行為。

**掛進去 64 檔 / 排除 8 檔。**

---

## 掛進去的 64 檔

全部記憶體模式獨立綠、node 自報耗時多在 2s 內（最慢 discover 3.35s）、合併兩跑 0 fail 可重現。清單見 `package.json` 的 `test` script（本 PR diff）。分佈：

- `apps/api/src/__tests__/` 44 檔
- `apps/api/src/data-sources/`（含 `__tests__/`）4 檔
- `apps/api/src/jobs/` 4 檔
- `apps/api/src/`（根層）11 檔：brain/react-loop、companies-ohlcv、companies-ticker-resolution、domain/trading/paper-ledger-db、market-data-*、notification-feed、openalice-*、recommendation-store、tools/market-data-tools、weekly-review
- 其中 `strategy-runs-db.test.ts`、`discover.test.ts`、`tw-coverage-loader.test.ts`、`recommendation-store.test.ts` 內含 `test.skip()` 針對 DB / coverage 資料的子測試 → 有資料/DB 的環境會跑，無則乾淨跳過。

---

## 排除的 8 檔（不掛）＋原因＋後續

| 檔 | 分類 | 觀察到的失敗/原因 | 後續處理 |
|---|---|---|---|
| `__tests__/paper-e2e-order-unit.test.ts` | **需 live API** | `PAPER_E2E_BASE_URL not set. Aborting.` — 名為 unit 實為 e2e，需要跑起來的 API 端點（+DB）。 | 歸到 e2e/整合線，另設 job 帶 `PAPER_E2E_BASE_URL` + DB 才跑；不進純單元 gate。 |
| `__tests__/idempotency-race.test.ts` | **需 DB** | `T05-D ... expected 5 persisted, got 0` — 記憶體模式下 persistence 為 no-op。 | 待有 Postgres 的 CI job（`DATABASE_URL` + `PERSISTENCE_MODE=database`）再掛。 |
| `__tests__/paper-executor.test.ts` | **需 DB** | `G3: listOrders ... 0 !== 1` — 訂單未落地。 | 同上，DB job。 |
| `__tests__/strategy-ideas.test.ts` | **需 DB** | `S1: ... ledger must contain the order`（driveOrder 未持久化）。 | 同上，DB job。 |
| `data-sources/finmind-client.test.ts` | ~~待修（mock 漂移）~~ **已修復 2026-07-09** | `T9 ... 1 !== 2`、`T10 ... 0 !== 2` — fetch mock 呼叫次數/回退路徑期望與現行 client 行為對不上。 | 已掛入根 `pnpm test`。見文末追蹤節。 |
| `market-ingest.test.ts` | ~~待修（Redis mock）~~ **已修復 2026-07-09** | `T-new-2/3: setEx should have been called ... 0 !== 2`、`cached should be false` — Redis mock 未被觸發/逾時路徑期望漂移。 | 已掛入根 `pnpm test`。見文末追蹤節。 |
| `__tests__/finmind-full-ingest.test.ts` | ~~待修（測試漂移）~~ **已修復 2026-07-09** | `FI5: ... must return 11 dataset status rows`，實際 `12 !== 11` — dataset registry 已成長到 12，測試硬編 11 過期。 | 已掛入根 `pnpm test`。見文末追蹤節。 |
| `__tests__/twse-market-overview.test.ts` | **綠但慢** | 獨立綠，但 node 自報 ~10s（client 內部真 `setTimeout` retry backoff；fetch 已全 mock，非網路、非 flaky）。 | 本批為守 CI 時間先不掛；後續可在測試注入 fake timer / 縮短 backoff 後補掛（不動 client 生產路徑）。 |

**分類統計**：需 DB 3 檔、需 live API 1 檔、待修（mock/漂移，已於 2026-07-09 修復並補掛）3 檔、綠但慢 1 檔。

---

## 驗收證據

- `pnpm test`（經更新後 script 實跑）：`tests 1548 / pass 1540 / fail 0 / skipped 8`，EXIT 0，wall ~30s。
- 合併指令兩次獨立跑結果一致（1548/1540/0/8）→ 無 flaky、無跨檔干擾。
- `pnpm typecheck`：15/15 綠。
- `python scripts/audit/w6_no_real_order_audit.py`：6/6 PASS。

## 未處理 / 假設

- 未新增「DB 模式 CI job」— 需 DB 的 4 檔（含 paper-e2e）留待該 job 落地後補掛，屬另一 PR 範圍。
- twse-market-overview 綠可掛，純為壓 CI 時間本批先擱置。

---

## 2026-07-09 追蹤：3 檔待修已解決（#1183 follow-up，分支 `fix/drift-tests-20260709`）

三檔逐一確認皆為**測試自身過期，非被測程式碼 bug**；只動測試檔＋根 `package.json` test script＋本報告，未動任何 `apps/api/src` 下的非測試檔。

### 1. `data-sources/finmind-client.test.ts`（T9/T10 — 1≠2 / 0≠2）

根因：`finmind-client.ts` 的 4xx circuit breaker（`_circuitOpenUntilMs` 等）是**module-level 單例**，測試檔從未呼叫它自己匯出的 `_resetFinMindStats()`（該函式的 doc comment 明寫「Reset counters — used in tests」）。結果：
- T9 自身：mock 對 `TaiwanStockPriceAdj` 回 400（權限不足）→ 依現行 client 行為，任何 4xx 會立刻開啟 process-local 斷路器並在**同一次呼叫內**擋掉緊接著要打的 `TaiwanStockPrice` fallback fetch — 這是 client docstring 明寫的設計意圖（entitlement-tier 4xx 就是斷路器要防的情境之一），不是 bug。所以 fetchCallCount 停在 1、bars 為空，是現行真實行為。
- T10 受害：T9 開啟的斷路器（cooldown 30 分鐘）未重置就流到 T10，擋掉 T10 自己完全無關的 KBar fetch，導致 0≠2。

修法：
- import 並在 `beforeEach()` 呼叫 `_resetFinMindStats()`，讓每個 test 從乾淨的斷路器狀態開始（解決 T10 的跨測試污染）。
- 重寫 T9 的斷言以反映現行行為：`fetchCallCount===1`、`bars.length===0`，並把測試名稱/註解改為說明斷路器搶在 fallback 前面觸發，而非原本「驗證 fallback 有效」的過期假設。
- 附帶發現（環境雜訊，非程式碼問題）：本機 shell profile 有匯出真實 `FINMIND_API_TOKEN`，會讓 T3（「no token → 不打 fetch」）在本機 flake；CI 沒有這個殘留env var，用 `env -u FINMIND_API_TOKEN -u FINMIND_TOKEN` 跑測試可重現 CI 的乾淨狀態，11/11 綠、跑 3 次穩定。

### 2. `market-ingest.test.ts`（T-new-2/3 — Redis mock 未觸發）

根因：`market-ingest.ts` 的 `getRedisClient()` 在 `process.env.REDIS_URL` 未設定時**提早 return null**，這個 early-return 在檢查注入的 `_redisClient`（`_setRedisClientForTest()` 的注入目標）**之前**執行。CI/本機都不設 REDIS_URL（純記憶體模式），所以測試呼叫 `_setRedisClientForTest(mockRedis)` 完全沒有作用 — client 端的 test-only escape hatch 形同虛設。

修法（僅測試檔佈線，未動 `market-ingest.ts`）：新增 `setMockRedisClient()` helper，讓每次呼叫 `_setRedisClientForTest()` 時同步切換一個 dummy `REDIS_URL`：
- 注入 client 時 → 順便設一個假 `REDIS_URL`（安全：注入的 fake client `isReady=true`，會讓 `getRedisClient()` 在檢查 ready 狀態時就 return，不會真的打網路連線）。
- 注入 null（模擬斷線）時 → 順便刪掉 `REDIS_URL`，讓 `getRedisClient()` 走真正的 early-return null 分支，一樣不打真網路。
- 每個 test 用 `try/finally` 呼叫 `setMockRedisClient(null)` 清乾淨；檔案層再加 `after()` 兜底恢復原始 `REDIS_URL`，避免污染同一 `node --test` 進程裡的其他 69+ 個測試檔。
- 原本的斷言數字（T-new-2 期望 2 次 setEx、T-new-3 期望 `cached:false`）本身沒錯，佈線通了之後直接綠，未改動它們。
- 12/12 綠、跑 3 次穩定（T-new-3 因真的觸發 500ms Promise.race timeout，耗時多了約 500ms，仍遠低於「慢測試」門檻）。

### 3. `__tests__/finmind-full-ingest.test.ts`（FI5 — 12≠11）

根因：`finmind-full-ingest.ts` 有兩個不同範疇的 dataset 清單 —
- `DATASET_REGISTRY`（11 個 sponsor-tier fundamentals/chip/news dataset，`runFullIngest()` 用）
- `queryAllDatasetStatus()` 額外**多回傳 1 筆** `TaiwanStockPriceAdj` / `companies_ohlcv`（OHLCV 走另一條獨立 ingest pipeline，不屬於「11 dataset 批次」但仍在這個狀態查詢裡一起回報）

`queryAllDatasetStatus()` 回傳 `[ohlcvRow, ...otherRows]` = 1 + 11 = 12 筆，這是現行正確產品行為，FI2（驗證 `runFullIngest` 恰好 11 個 dataset）跟這裡沒有衝突。FI5 的硬編 `11` 是過期斷言。

修法：FI5 斷言與說明改為 12，並在測試裡加註解說明 12 = 11 + OHLCV row 的來源，避免下次又被誤讀成漂移。7/7 綠、跑 3 次穩定。

### 驗收證據（2026-07-09）

- 三檔各自獨立跑（`env -u FINMIND_API_TOKEN -u FINMIND_TOKEN node --import ./tests/setup-test-env.mjs --import tsx --test <file>`）：finmind-client 11/11、market-ingest 12/12、finmind-full-ingest 7/7，各自重跑 3 次一致、無 flaky。
- 三檔掛入根 `package.json` `test` script（按現有字母序插入對應目錄區段）。
- 全量 `pnpm test`：`tests 1578 / pass 1570 / fail 0 / skipped 8`，EXIT 0，重跑 2 次結果一致（相對 #1183 基線 1548/1540/0/8，剛好 +30 = 三檔新增測試數 11+12+7）。
- `pnpm typecheck`（`turbo run typecheck`）：15/15 綠，`@iuf-trading-room/api:typecheck` 為 cache miss 真跑過。
- `python scripts/audit/w6_no_real_order_audit.py`：6/6 PASS。
- 過程中發現並修正一個環境問題（非本次任務範圍但擋了驗收）：本 worktree 起手沒有 `node_modules`，且 `pnpm run build:packages` 不含 `@iuf-trading-room/integrations` 套件，導致 `tests/ci.test.ts`／`apps/api/src/auth/role-matrix.test.ts` 在全量跑時因 `Cannot find module '.../integrations/dist/index.js'` 而 ECONNREFUSED 失敗（server 起不來）。已跑 `pnpm install` ＋ `npx turbo run build --filter=@iuf-trading-room/integrations` 補齊，這兩檔隨後獨立/全量皆綠，與本次 3 檔漂移修復無關，純屬 worktree 初始化缺步驟。

### 未處理 / 假設（本次）

- 未發現任何被測程式碼 bug；`finmind-client.ts` 的斷路器搶佔 fallback、`market-ingest.ts` 的 `getRedisClient()` early-return 順序、`finmind-full-ingest.ts` 的 11 vs 12 dataset 範疇差異，皆視為現行既有設計，僅測試檔跟上。
- `market-ingest.test.ts` 新增的 `setMockRedisClient()` 佈線方式（跟隨環境變數切換）較 hacky，但未動生產程式碼；若之後有人想讓 `_setRedisClientForTest()` 本身在生產碼裡更好測（例如讓 test-only 注入不依賴 `REDIS_URL`），屬於另一個「改善測試性」的獨立 ticket，非本次授權範圍。
