# API 測試併入 CI 稽核 — 2026-07-07

**2026-07-09 追蹤更新**：本檔列出的 3 個「待修（mock/漂移）」檔（finmind-client / market-ingest / finmind-full-ingest）已修復並掛入根 `pnpm test`。詳見文末「2026-07-09 追蹤：3 檔待修已解決」一節。

**2026-07-09 二次追蹤更新**：#1186 新增 `db-tests` CI job（真 Postgres）後，原本標「需 DB」的 3 檔（idempotency-race / paper-executor / strategy-ideas）在真 DB 下逐一驗證仍全紅——根因非缺 Postgres，而是兩個既有測試漂移（legacy ledger import 錯位 + 過期硬編價斷言）。三檔已修復，`pnpm run test:db`（真 Postgres 本地重現）33/33 綠。詳見文末「2026-07-09 追蹤：DB-mode 3 檔已解決」一節。

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
| `__tests__/idempotency-race.test.ts` | ~~需 DB~~ **已修復 2026-07-09** | `T05-D ... expected 5 persisted, got 0` — 記憶體模式下 persistence 為 no-op。 | db-tests job（#1186）下已綠，見文末「2026-07-09 追蹤：DB-mode 3 檔已解決」一節。 |
| `__tests__/paper-executor.test.ts` | ~~需 DB~~ **已修復 2026-07-09** | `G3: listOrders ... 0 !== 1` — 訂單未落地。 | 同上，db-tests job 下已綠。 |
| `__tests__/strategy-ideas.test.ts` | ~~需 DB~~ **已修復 2026-07-09** | `S1: ... ledger must contain the order`（driveOrder 未持久化）。 | 同上，db-tests job 下已綠。 |
| `data-sources/finmind-client.test.ts` | ~~待修（mock 漂移）~~ **已修復 2026-07-09** | `T9 ... 1 !== 2`、`T10 ... 0 !== 2` — fetch mock 呼叫次數/回退路徑期望與現行 client 行為對不上。 | 已掛入根 `pnpm test`。見文末追蹤節。 |
| `market-ingest.test.ts` | ~~待修（Redis mock）~~ **已修復 2026-07-09** | `T-new-2/3: setEx should have been called ... 0 !== 2`、`cached should be false` — Redis mock 未被觸發/逾時路徑期望漂移。 | 已掛入根 `pnpm test`。見文末追蹤節。 |
| `__tests__/finmind-full-ingest.test.ts` | ~~待修（測試漂移）~~ **已修復 2026-07-09** | `FI5: ... must return 11 dataset status rows`，實際 `12 !== 11` — dataset registry 已成長到 12，測試硬編 11 過期。 | 已掛入根 `pnpm test`。見文末追蹤節。 |
| `__tests__/twse-market-overview.test.ts` | **綠但慢** | 獨立綠，但 node 自報 ~10s（client 內部真 `setTimeout` retry backoff；fetch 已全 mock，非網路、非 flaky）。 | 本批為守 CI 時間先不掛；後續可在測試注入 fake timer / 縮短 backoff 後補掛（不動 client 生產路徑）。 |

**分類統計**：需 DB 3 檔（已於 2026-07-09 在 db-tests job 下修復並驗綠，見文末）、需 live API 1 檔、待修（mock/漂移，已於 2026-07-09 修復並補掛）3 檔、綠但慢 1 檔。

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

---

## 2026-07-09 追蹤：DB-mode 3 檔已解決（#1186 follow-up，分支 `fix/db-tests-ledger-drift-jason-20260709`）

背景：#1186 新增 `db-tests` CI job（真 `postgres:16-alpine` service container + `pnpm run migrate` + `pnpm run test:db`）後，Bruce 本地重現真 DB 環境驗證，發現 `idempotency-race.test.ts` / `paper-executor.test.ts` / `strategy-ideas.test.ts` 三檔即使拿到真 Postgres 仍全紅（33 tests / pass 22 / fail 11）。逐一 root-cause 後確認**兩者皆為測試漂移，非被測程式碼 bug**，只動三個測試檔，未動任何 `apps/api/src` 下的非測試檔。

### 根因 1（3 檔共同，佔 7/11 失敗）：讀了從未被寫入的 legacy ledger

三檔都從 `domain/trading/paper-ledger.js`（純記憶體 Map，W6 Day 1 產物）import `listOrders` / `getOrder` / `_clearLedger` 來驗證持久化結果。但 `order-driver.ts` 的 `driveOrder()` 自 **W8 2026-05-05** 起已改寫進 `domain/trading/paper-ledger-db.js`（DB 模式走 drizzle + Postgres，記憶體模式走內部 `mapAdapter()`）。兩個模組完全不共用儲存 —— 測試讀的 Map 從未被 `driveOrder` 寫過，讀回永遠是空/undefined。這與有沒有 Postgres 無關：即使拿到真 DB，讀的仍是錯的模組。

檢查發現，production 程式碼中 `paper-ledger.js` 唯二的 2 處 import 只是**型別**（`paper-ledger-db.ts`／`paper-executor.ts` 各自 `import type { SimulatedFill }`），沒有任何 runtime 呼叫其 CRUD 函式——這些函式在 production 已是死碼，僅 3 個測試檔還在用。

修法：`idempotency-race.test.ts`／`strategy-ideas.test.ts` 全面改讀 `paper-ledger-db.js` 的 `listOrders`/`getOrder`（改為 `await`）。`paper-executor.test.ts` 混合保留——section E/F/G1/G2/G4-G7 直接呼叫 legacy `upsertOrder`/`getOrder` 等（不經 `driveOrder`，測試 legacy CRUD 本身，本來就會過），只有透過 `driveOrder()` 驗證持久化結果的 D4 和 G3 改讀 `paper-ledger-db.js`（別名 `getOrderDb`/`listOrdersDb`，避免與同檔案既有 legacy import 撞名）。

**測試隔離注意**：`paper_orders.idempotency_key` 有全域 UNIQUE 約束（migration 0015/0021），且真 Postgres 是持久的（不像記憶體模式每個測試進程重來）。`idempotency-race.test.ts` 原本用固定字串 idempotencyKey + 固定 `TEST_USER_ID`，同一支測試檔案重跑第二次會撞到自己上一輪留下的 row。改為每個 test 用 `randomUUID()` 產生的 userId + idempotencyKey 後綴，讓 `listOrders(userId)` 的結果天然隔離，不需要（也做不到——`paper-ledger-db.js` 沒有 `_clearLedger` 這種 test helper）手動清表。CI 的 `db-tests` job 每次都是全新 postgres service container，這個隔離主要是為了本機重複驗證安全；即便如此，本地同一顆容器連續兩輪皆綠（無 flaky）。

### 根因 2（`paper-executor.test.ts` 專屬，佔 4/11 失敗：A2/A3/E2/F1）：斷言已刻意移除的硬編價 fallback

`paper-executor.ts` 檔頭 HARD LINE 註解明寫：market 單無 `intent.price` 時，優先查 `companies_ohlcv` 真實收盤價，查不到就 **REJECTED（`no_price_available`）**——「never fill at a hardcoded fake price (was 100.0)」。測試從未 seed 任何 OHLCV row，所以現行行為必然是 REJECTED，但：
- A2/A3 直接斷言「FILLED at fallback 100.0」——過期斷言，測試現行行為改為斷言 REJECTED + reason 含 `no_price_available`。
- E2（cancelOrder on FILLED intent）/ F1（driveOrder on non-PENDING intent throws）用不帶價格的 market 單當「先讓它 FILLED 再測下一步」的前置動作，兩者測試意圖都不是價格 fallback——改為給 intent 一個顯式價格（150.0）讓它照舊 FILLED，不改測試想驗證的行為本身。

此根因與 DB 有無無關：記憶體模式下 `getDb()` 回 null，同樣查不到價、同樣 REJECTED，只是 #1186 的 db-tests job 才第一次真的把這 3 檔跑起來而暴露。

### 驗收證據（2026-07-09）

- 本地 `docker run postgres:16-alpine`（`POSTGRES_USER=iuf POSTGRES_PASSWORD=iuf POSTGRES_DB=iuf_ci_test`，對齊 #1186 `db-tests` job 的 service 設定）+ `pnpm run migrate`（0001→0050 全過）+ `pnpm run test:db`：**`tests 33 / pass 33 / fail 0`**，EXIT 0，重跑 2 次結果一致（無 flaky）。
- 修復前基線（同一顆容器）：`tests 33 / pass 22 / fail 11`，與 #1186 PR body 的本地重現結果一致，確認根因判斷無誤後才動手。
- memory-mode `pnpm test`（`env -u DATABASE_URL -u PERSISTENCE_MODE -u FINMIND_API_TOKEN -u FINMIND_TOKEN`）：`tests 1588 / pass 1580 / fail 0 / skipped 8`，EXIT 0——與修復前基線一致（這 3 個檔本來就不在根 `pnpm test` 的檔案清單裡，只在 #1186 新增的 `test:db` 清單），確認未影響既有 CI。
- `pnpm typecheck`（`turbo run typecheck`）：15/15 綠，`@iuf-trading-room/api:typecheck` 為 cache miss 真跑過。
- `python scripts/audit/w6_no_real_order_audit.py`：6/6 PASS。
- `git diff --stat .github/workflows/ci-security.yml`：空（未改動鎖檔）。

### 未處理 / 假設（本次）

- `paper-executor.test.ts` 的 section G（G1/G2/G4-G7）仍測試 legacy `paper-ledger.js` 的 CRUD 本身（不經 `driveOrder`）——這些函式在 production 已是死碼（只剩型別被引用），但這些測試本身沒有壞（本來就綠），視為現況範圍外的既有設計，未動；若之後要清理 legacy 模組本身（非測試檔），屬於另一個獨立 ticket，非本次授權範圍。
- #1186 的 `db-tests` job 目前是 non-blocking（未進 branch protection required checks）；本次三檔修復後可考慮 flip 成 required，但該項是 GitHub repo 設定變更，不在本次 file scope 內，留給 Elva/楊董決定時機。
- PR 為 DRAFT，依派工要求會跟 #1186 一起收（不單獨 merge）。
