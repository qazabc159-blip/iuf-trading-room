# API 測試併入 CI 稽核 — 2026-07-07

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
| `data-sources/finmind-client.test.ts` | **待修（mock 漂移）** | `T9 ... 1 !== 2`、`T10 ... 0 !== 2` — fetch mock 呼叫次數/回退路徑期望與現行 client 行為對不上。 | 需人工比對 client 現況修測試期望（非被測程式碼），修綠後單獨補掛。 |
| `market-ingest.test.ts` | **待修（Redis mock）** | `T-new-2/3: setEx should have been called ... 0 !== 2`、`cached should be false` — Redis mock 未被觸發/逾時路徑期望漂移。 | 需補 Redis mock 佈線或修期望，修綠後補掛。 |
| `__tests__/finmind-full-ingest.test.ts` | **待修（測試漂移）** | `FI5: ... must return 11 dataset status rows`，實際 `12 !== 11` — dataset registry 已成長到 12，測試硬編 11 過期。 | 單行期望更新（11→12，非被測程式碼），修綠後補掛。 |
| `__tests__/twse-market-overview.test.ts` | **綠但慢** | 獨立綠，但 node 自報 ~10s（client 內部真 `setTimeout` retry backoff；fetch 已全 mock，非網路、非 flaky）。 | 本批為守 CI 時間先不掛；後續可在測試注入 fake timer / 縮短 backoff 後補掛（不動 client 生產路徑）。 |

**分類統計**：需 DB 3 檔、需 live API 1 檔、待修（mock/漂移）3 檔、綠但慢 1 檔。

---

## 驗收證據

- `pnpm test`（經更新後 script 實跑）：`tests 1548 / pass 1540 / fail 0 / skipped 8`，EXIT 0，wall ~30s。
- 合併指令兩次獨立跑結果一致（1548/1540/0/8）→ 無 flaky、無跨檔干擾。
- `pnpm typecheck`：15/15 綠。
- `python scripts/audit/w6_no_real_order_audit.py`：6/6 PASS。

## 未處理 / 假設

- 未新增「DB 模式 CI job」— 需 DB 的 4 檔（含 paper-e2e）留待該 job 落地後補掛，屬另一 PR 範圍。
- 3 個「待修」檔（finmind-client / market-ingest / finmind-full-ingest）失敗是測試自身漂移，非被測程式碼 bug；本 PR 不改測試邏輯（守「分批穩」），列為 follow-up。
- twse-market-overview 綠可掛，純為壓 CI 時間本批先擱置。
