# Jason Work Order — 5 Backend Contracts for Codex Frontend Real-Data Lane

Issued: 2026-05-01 01:42 Taipei
Owner: Jason
Audience: Codex (frontend consumer), Bruce (verify), Pete (review)
Coordination doc: `evidence/w7_paper_sprint/frontend_realdata_status_board_2026-05-01.md`

## Context

Codex 從今晚起接管 frontend real-data conversion。Hard rule：production UI 不准 silent mock；每個 visible panel 必須是 LIVE / EMPTY / BLOCKED / HIDDEN。

Codex 必須照後端 canonical contract 綁，**不能自己猜後端語意**。所以你寫的這 5 條 contract = Codex 後續所有 frontend binding 的 source of truth。

沒有 contract 的 surface，Codex 只能標 BLOCKED 或 HIDDEN。

## Output Location

寫到：`evidence/w7_paper_sprint/jason_backend_contracts_2026-05-01.md`

完成後在 board `Backend Ready` 區附 link + 一行 summary（每條一行，含 status：READY / DRAFT / BLOCKED）。

## 必填欄位（每條 contract 都要）

每條至少 10 欄：

1. **Route** — full path（e.g. `GET /api/v1/paper/orders/preview`）
2. **Method** — GET / POST / PATCH / DELETE
3. **Auth requirement** — cookie / role / workspace scope
4. **Request shape** — body / query / headers schema（用 TS 介面或 zod 形式）
5. **Success response shape** — 完整 envelope + nested fields
6. **EMPTY behavior** — 真查 0 row 時回什麼（status code、shape、reason field）
7. **BLOCKED behavior** — feature 不可用時回什麼（status code、`blocker` + `owner` field）
8. **Freshness / source** — data origin（DB / FinMind / TWSE / KGI gateway / synthetic）+ TTL / updatedAt 出處
9. **Owner** — code owner（Jason / Athena / Operator）
10. **Ready status** — READY（live now）/ DRAFT（scaffold ok, no impl）/ BLOCKED（external dep）
11. **Frontend binding note** — Codex 應該怎麼用（panel 名 / 4-state 對應 / 顯示哪些 field）

## 5 條 Contract 清單

### 1. Paper Order Preview / Submit

Sub-routes 全寫：
- `POST /api/v1/paper/orders/preview` — 預覽（不入帳，回 risk-gate verdict + estimated fill）
- `POST /api/v1/paper/orders` — submit 真寫 paper ledger
- `GET /api/v1/paper/orders/:id` — 單筆狀態
- `GET /api/v1/paper/orders` — 列表（支援 status filter）
- `DELETE /api/v1/paper/orders/:id` — cancel

特別注意：
- Risk-gate 4 layer 跑哪幾層在 preview vs submit 必須明確
- 每個 status transition（NEW → ACCEPTED → FILLED / REJECTED / CANCELLED）對應的 response shape
- Codex 需要知道：button enable/disable 條件、preview 顯示哪些 verdict field、submit 失敗時的 error envelope

### 2. Portfolio Positions / Fills Freshness

- `GET /api/v1/portfolio/positions` — 當前 paper position（per ticker，含 qty / avg_cost / unrealized_pnl）
- `GET /api/v1/portfolio/fills` — fill history（時間倒序，支援 since 參數）
- `GET /api/v1/portfolio/summary` — 總覽（total_value / cash / pnl_today / pnl_total）

特別注意：
- **Freshness contract**：每個 row 必須有 `updatedAt`（ISO8601 with timezone）+ `source`（"paper_ledger" / "kgi_position_readonly"）
- Codex 用 freshness 判斷是否 LIVE；超過 X 秒老化要標 EMPTY 或 BLOCKED（X 你決定，建議 30s）
- KGI live position（read-only）若可取得，標 source="kgi_readonly"，否則只回 paper

### 3. Watchlist Source of Truth

目前 prod 是否已有 watchlist endpoint？檢查 `apps/api/src/server.ts` `/api/v1/watchlist*`。

若有：
- `GET /api/v1/watchlist` — 列表
- `POST /api/v1/watchlist` — add ticker
- `DELETE /api/v1/watchlist/:ticker` — remove
- 是 per-user 還是 per-workspace？

若沒有：
- 標 BLOCKED owner=Jason ETA=Day 4-5
- Codex 暫時把 Watchlist 頁標 BLOCKED 或 HIDDEN
- 不要讓 Codex mock 一個假 watchlist

### 4. Strategy Idea → Order Handoff

Quant Lab Athena 那邊 strategy publish bundle 落到 TR 後，怎麼變成 paper order？這條 contract 影響 dashboard / RADAR / paper panel 三處。

- `POST /api/v1/ideas` — 接收 Lab bundle ingest
- `GET /api/v1/ideas` — 列當前 active ideas
- `GET /api/v1/ideas/:id` — 單筆詳情（含 signal / target_qty / risk metadata）
- `POST /api/v1/ideas/:id/promote-to-order` — 從 idea 產 OrderIntent（走 risk gate）
- `GET /api/v1/ideas/:id/runs` — backtest run results（如有）

特別注意：
- IUF_SHARED_CONTRACTS bridge schema 是 single source of truth，contract 要 reference 那邊的 schema 版本
- 若 ingest endpoint 還沒 wire（Athena 那邊 publish bundle 也還沒成形），標 DRAFT，frontend 可以做空 list 的 EMPTY 狀態（reason="no published ideas"）

### 5. KGI Readonly Bidask / Tick Availability

這條最關鍵。Codex 看到 quote / TickStream / bidask panel 全部要照這條判斷標 LIVE 還 BLOCKED。

- `GET /api/v1/quote/:ticker/bidask` — 當前 bid/ask + size（read-only，從 Market Agent 推來的 snapshot）
- `GET /api/v1/quote/:ticker/ticks` — 最近 N 筆 tick（read-only）
- WebSocket（如有）：`/ws/quote/:ticker`

特別注意：
- KGI write-side（order submit）卡 `libCGCrypt.so` BLOCKED — 這條是 quote / read-side
- Market Agent outbound push（W7 P2）skeleton 是否 wire 通？
- 若 Market Agent 未上線：標 BLOCKED owner=Operator(Market Agent Host)
- 若有 Redis snapshot fallback：寫明 stale 多久內算 LIVE
- 若完全沒接：Codex 把 quote / tick / bidask 全標 BLOCKED reason="KGI quote feed not wired" owner="Operator + Jason"

## 交付節奏

- **First draft**: cycle 1 = 2026-05-01 02:00 Taipei（18min 內）— 至少 5 條 route 列表 + Ready status，shape 可粗
- **Full contract**: cycle 3 = 2026-05-01 03:00 Taipei — 10 欄全填
- **Codex binding 開始**: full contract 落地後 Codex 才能照綁

中間若你發現某條根本沒 backend impl，立刻標 BLOCKED + owner，不要拖。Codex 可以照 BLOCKED 走，不能照空猜。

## Stop-lines（你不准動）

- 不要在這 5 條 contract 內順便 enable live submit
- 不要動 `apps/api/src/broker/**` write-side
- 不要動 migration 0020 promote 0021 等
- 不要 expose 任何 KGI account/person_id/broker_id raw value（all `<REDACTED:*>`）

## 派工人 ACK

Jason，照辦，每輪 cycle 我會在 board 看你進度。完成 first draft 在 board 寫一行：
`Jason 5-contract first draft DONE @ <time> → <evidence file path>`

—— Elva
