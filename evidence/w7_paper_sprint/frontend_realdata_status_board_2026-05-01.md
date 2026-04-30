# Frontend Real-Data Status Board — 2026-05-01

Owner: Codex
Cadence: Codex update every 30 minutes during overnight run. Elva lane may update every 20 minutes.
Primary goal: make production UI meaningful, sourced, and operational.

## Current State

- Auth cookie/domain: DONE.
- Sidebar logout: DONE.
- API health: PASS after deployment.
- Company 2330 with authenticated cookie: PASS.
- Production no-silent-mock policy: IN PROGRESS; B10/B11 wrapper-level production fallback fixed in Codex cycle 02:48.
- Market Intel/news lane: IN PROGRESS; company detail panel [05] now binds TWSE announcements through the shared API client.
- Full mock/placeholder removal: OPEN.

## Path Locks

**Jim D1 production path handed off to Codex at 2026-05-01 01:42 Taipei, main/origin main = e231201.**

Codex active ownership (post-handoff):

- `apps/web/app/**`
- `apps/web/components/**`
- `apps/web/lib/**`
- `apps/web/app/globals.css`

**Local Jim branch `jim/w7-d-ui-deplumbing-2026-04-30 @ ab8cfe8` is NOT merged and is path-locked pending Elva disposition.**

Elva disposition (2026-05-01 01:42 Taipei): **DEPRECATED / SUPERSEDED**.
- Branch is not main ancestor; merging would delete 13,022 lines including `secret_inventory.md`, `services/market-agent/**`, migrations 0017-0019, W5/W6/W7 evidence — all landed via newer PRs.
- The "deplumb decoratives" intent appears already covered by `d6e907b feat(ui): deplumb decoratives + fix companies 3470 symbols (#28)` already on main.
- **Codex: 不擋你，可以動 `apps/web/**`，這條 branch 不會被 merge。** 若 Pete 後續審出有 Codex 應參考的 deplumb 細節，會單獨開小 PR 補。

Elva/Jason/Bruce should mark active conflicts here before editing same files.

Active backend lanes (Jason scope, Codex 不踩):
- `apps/api/src/paper/**`, `apps/api/src/risk/**`, `apps/api/src/broker/**`
- `apps/api/src/audit/**`, `apps/api/src/worker/**`
- `packages/db/migrations/**`

## Backend Ready

Bruce 4-state harness v1 DONE @ 2026-05-01 02:00 Taipei → evidence/w7_paper_sprint/bruce_4state_harness_v1_2026-05-01.md

Known usable endpoints:

- `GET /api/v1/session`
- `GET /api/v1/companies`
- `GET /api/v1/companies/:id`
- `GET /api/v1/companies/:id/ohlcv`
- `GET /api/v1/companies/:id/financials`
- `GET /api/v1/companies/:id/chips`
- `GET /api/v1/companies/:id/announcements?days=30`
- `GET /api/v1/briefs`
- `GET /api/v1/reviews`
- `GET /api/v1/content-drafts`
- `GET /api/v1/ops/snapshot`
- `GET /api/v1/ops/trends`
- `GET /api/v1/event-history`
- `GET /api/v1/audit-logs`
- `GET /api/v1/audit-logs/summary`

Jason 5-contract first draft DONE @ 2026-05-01 ~01:58 Taipei → `evidence/w7_paper_sprint/jason_backend_contracts_2026-05-01.md`
- Contract 1 (Paper Orders preview/submit/status/cancel): READY
- Contract 2 (Portfolio positions/fills/summary): BLOCKED owner=Jason ETA=Day 4-5
- Contract 3 (Watchlist): BLOCKED owner=Jason ETA=Day 4-5
- Contract 4 (Strategy ideas/runs READY; promote-to-order): BLOCKED owner=Jason ETA=Day 5-6
- Contract 5 (KGI bidask/tick): BLOCKED owner=Operator+Jason (gateway dep); WS not implemented

Needs confirmation from Elva/Jason:

- Paper order preview/submit production contract
- Portfolio positions / fills freshness contract
- Watchlist source of truth
- Strategy idea to order handoff contract
- KGI readonly bidask/tick availability

## No-Fake UI Inventory

Initial high-risk surfaces:

- `/briefs`: DONE in Codex cycle 01:54; now binds `GET /api/v1/briefs` and renders LIVE / EMPTY / BLOCKED.
- `/reviews`: DONE in Codex cycle 01:56; now binds `GET /api/v1/reviews` as read-only ledger and marks action queue BLOCKED.
- `/drafts` and `/admin/content-drafts`: DONE in Codex cycle 02:00; now bind `GET /api/v1/content-drafts` and remove local-only audit/action mocks.
- `/quote`: DONE in Codex cycle 02:04; now binds `GET /api/v1/market-data/effective-quotes` and blocks K-line/depth/ticks instead of rendering deterministic mock market data.
- `/companies/[symbol]`: source/tick/derivatives mock feed removed in Codex cycle 01:49; remaining company-detail mock risk is `toCompanyDetailView` fallback fields.
- `DerivativesPanel`: BLOCKED until production endpoint contract exists.
- `TickStreamPanel`: BLOCKED until KGI readonly bid/ask + tick contract exists.
- `/m/kill`: says no backend in mock.
- `radar-api.ts` and `radar-uncovered.ts`: API failure can fall back to mock.

## Overnight Log

### 2026-05-01 01:15 Taipei

Completed:

- Confirmed operator intent: Codex owns frontend real-data + Market Intel/news lane.
- Created Elva handoff and shared board.
- Defined stop-line: no silent production mock.

Next:

- Convert the inventory into code-level tasks.
- Start with production fetch wrappers and company Market Intel because TWSE announcements endpoint already exists.

Files touched:

- `evidence/w7_paper_sprint/frontend_realdata_elva_handoff_2026-05-01.md`
- `evidence/w7_paper_sprint/frontend_realdata_status_board_2026-05-01.md`

### 2026-05-01 01:49 Taipei

Completed:

- Updated heartbeat automation to keep this live thread waking every 30 minutes.
- Bound company detail Market Intel panel [05] to `GET /api/v1/companies/:id/announcements?days=30` through `apps/web/lib/api.ts`.
- Converted Market Intel visible states to LOADING / LIVE / EMPTY / BLOCKED with source and updated timestamp.
- Removed no-op behavior from announcement rows: rows without body text render as static data, not inert buttons.
- Removed deterministic derivatives and tick-stream rows from the company page. Panels [08] and [09] now render BLOCKED with owner/blocker instead of synthetic data.
- Replaced source card data on `/companies/[symbol]` with live-derived source status from company master, OHLCV, TWSE announcements, and blocked KGI ticks.

Files:

- `apps/web/lib/api.ts`
- `apps/web/app/companies/[symbol]/page.tsx`
- `apps/web/app/companies/[symbol]/AnnouncementsPanel.tsx`
- `apps/web/app/companies/[symbol]/DerivativesPanel.tsx`
- `apps/web/app/companies/[symbol]/TickStreamPanel.tsx`
- `apps/web/app/globals.css`

Endpoints:

- `GET /api/v1/companies`
- `GET /api/v1/companies/:id/ohlcv?interval=1d`
- `GET /api/v1/companies/:id/announcements?days=30`

Tests:

- PASS `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- PASS `pnpm.cmd --filter @iuf-trading-room/web build`

Blockers:

- Need Jason canonical contracts for derivatives exposure and KGI readonly tick/bidask before panels [08]/[09] can move from BLOCKED to LIVE.

### 2026-05-01 01:54 Taipei

Completed:

- Converted `/briefs` from `mockBrief` to production `GET /api/v1/briefs`.
- The page now renders latest DailyBrief sections from DB when LIVE, a real zero-row EMPTY state, or a BLOCKED state with owner/detail when the API fails.
- Removed fake market metrics / fake theme heat / fake ideas from the brief page because no production contract was backing those fields.

Files:

- `apps/web/app/briefs/page.tsx`
- `apps/web/app/globals.css`
- `evidence/w7_paper_sprint/frontend_realdata_status_board_2026-05-01.md`

Endpoints:

- `GET /api/v1/briefs`

Tests:

- PASS `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- PASS `pnpm.cmd --filter @iuf-trading-room/web build`

### 2026-05-01 01:56 Taipei

Completed:

- Converted `/reviews` from local `mockReviewQueue` / `mockReviewLog` state to production `GET /api/v1/reviews`.
- The page now renders a read-only review ledger when LIVE, a real zero-row EMPTY state, or a BLOCKED state when API fetch fails.
- Removed local-only ACCEPT / REJECT buttons. The action queue now renders BLOCKED until Jason/Elva provide a production accept/reject contract.

Files:

- `apps/web/app/reviews/page.tsx`
- `apps/web/app/globals.css`
- `evidence/w7_paper_sprint/frontend_realdata_status_board_2026-05-01.md`

Endpoints:

- `GET /api/v1/reviews`

Tests:

- PASS `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- PASS `pnpm.cmd --filter @iuf-trading-room/web build`

### 2026-05-01 02:00 Taipei

Completed:

- Converted `/drafts`, `/admin/content-drafts`, and `/admin/content-drafts/[id]` from local `mockDrafts` / `mockDraftAudit` to production `GET /api/v1/content-drafts`.
- Added shared content draft view helpers for payload title/body/status rendering.
- Removed local-only approve/reject/reassign action simulation from the detail page. Persisted actions now render BLOCKED until a deliberate UI mutation slice is scheduled.
- Kept role/permission behavior on the API side: 401/403 surfaces as BLOCKED with owner/detail instead of fake draft data.

Files:

- `apps/web/app/drafts/page.tsx`
- `apps/web/app/admin/content-drafts/page.tsx`
- `apps/web/app/admin/content-drafts/[id]/page.tsx`
- `apps/web/app/admin/content-drafts/[id]/ContentDraftDetailClient.tsx` (deleted)
- `apps/web/lib/content-draft-view.ts`
- `apps/web/app/globals.css`
- `evidence/w7_paper_sprint/frontend_realdata_status_board_2026-05-01.md`

Endpoints:

- `GET /api/v1/content-drafts`

Tests:

- PASS `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- PASS `pnpm.cmd --filter @iuf-trading-room/web build`

### 2026-05-01 02:04 Taipei

Completed:

- Converted `/quote` from client-side `fallbackQuote`, `mockBidAsk`, and `mockTicks` to server-rendered `GET /api/v1/market-data/effective-quotes`.
- Removed deterministic bid/ask ladder, generated tick tape, and mock-kbar chart from the quote page.
- K-line, bid/ask depth, and tick tape now render BLOCKED until production bars/depth/tick contracts are deliberately wired.

Files:

- `apps/web/app/quote/page.tsx`
- `apps/web/app/globals.css`
- `evidence/w7_paper_sprint/frontend_realdata_status_board_2026-05-01.md`

Endpoints:

- `GET /api/v1/market-data/effective-quotes`

Tests:

- PASS `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- PASS `pnpm.cmd --filter @iuf-trading-room/web build`

Deploy:

- PASS Railway web deployment `3261ca7a-09dd-4af7-b6d7-72dfaff5a982` reached SUCCESS at 02:06 Taipei.

### 2026-05-01 02:48 Taipei

Completed:

- Fixed B10: `radar-uncovered.ts` no longer converts production API failure / invalid shape / missing API base into mock success. Dev/build mock fallback is preserved only outside production runtime.
- Fixed B11: `use-readonly-quote.ts` no longer falls back to mock bid/ask or ticks in production. KGI endpoint failure now returns `endpointUnavailable=true` with empty data.
- Updated `BidAskLadder`, `TickTape`, and `FreshnessBadge` so unavailable KGI depth/ticks render BLOCKED / NO DATA and hide synthetic rows instead of showing deterministic ladders/tapes.
- Tightened `radar-api.ts` missing-base and `api.company()` failure behavior so production fails closed rather than returning mock companies.

Files:

- `apps/web/lib/radar-uncovered.ts`
- `apps/web/lib/use-readonly-quote.ts`
- `apps/web/lib/radar-api.ts`
- `apps/web/components/chart/BidAskLadder.tsx`
- `apps/web/components/chart/TickTape.tsx`
- `apps/web/components/chart/FreshnessBadge.tsx`
- `evidence/w7_paper_sprint/frontend_realdata_status_board_2026-05-01.md`

Endpoints:

- `GET /api/v1/kgi/quote/bidask?symbol=...` remains BLOCKED when unavailable.
- `GET /api/v1/kgi/quote/ticks?symbol=...` remains BLOCKED when unavailable.
- Existing `radarUncoveredApi.*` endpoints now fail closed in production when backend data is unavailable.

Tests:

- PASS `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- PASS `pnpm.cmd --filter @iuf-trading-room/web build`

Blockers:

- KGI bidask/tick stays B3 BLOCKED pending Operator + Jason gateway/WS contract.
- Remaining mock audit moves next to `/m/kill`, `radar-api.ts` force-mock hard-line surfaces, and dashboard/plans portfolio pages.

## Elva Notes

### 2026-05-01 01:42 Taipei — Operator final ACK + Elva 20min cycle started

Operator (楊董) final ACK 全部 6 條（Jim D1 handoff A / contract 由 Jason 寫 B / Codex hybrid PR 流程 C / Elva cycle OK / 跑到 07:00 Taipei A / Bruce 立刻 4-state harness A）.

**Elva 20min cycle protocol**（每輪固定 6 段）:
- t+0~5：讀 board / git log / evidence INDEX / Codex 上一輪 commit
- t+5~8：評估 Codex diff + blocker，確認沒踩 stop-line
- t+8~12：派工 — backend→Jason / verify→Bruce / migration→Mike / review→Pete
- t+12~15：更新 board 4 區（Backend Ready / Path Locks / Elva Notes / Blockers）
- t+15~18：許可範圍內 review/merge PR；重大事件 memory writeback
- t+18~20：schedule next wakeup
- 每輪驗：Codex 是否把 visible UI 標 LIVE/EMPTY/BLOCKED/HIDDEN；有無 fake mock 回流

**Merge 權限規則**（Elva 自主，無需 operator）:
- non-destructive PR + CI 全綠 + Pete review PASS（or Elva 明確記 why bypass）
- 不碰 stop-line / secrets / destructive migration / live submit
- production rollback path 清楚

**叫醒 operator 條件**:
- Yellow: production down / agent 跨 stop-line / destructive ACK / Railway secret 需求 / live submit 風險 / 0020 promote / auth 失效
- Red: 真實下單風險 / secret 外洩 / 全站不可用 / DB destructive 已發生
- 一般 UI blocker / shape 不明 / mock cleanup → 寫 board 繼續推，不叫

### Cycle 0 (01:42) — 派工已發
- Jason → `evidence/w7_paper_sprint/jason_5_backend_contracts_workorder_2026-05-01.md`
- Bruce → `evidence/w7_paper_sprint/bruce_4state_harness_workorder_2026-05-01.md`
- Pete → `evidence/w7_paper_sprint/pete_codex_pr_review_standby_2026-05-01.md`
- Mike → 0020 migration audit lane（不變）
- Jim → halted on new frontend scope（deprecated branch dispositioned 上方）

### Cycle 2 (02:34) — Codex 安靜期 / Bruce sweep 未自動續跑
- Read board / `git fetch origin main` → no new commits since `bc8e94d` (Elva Cycle 1 board update at 02:11)。Codex 最近 commit 仍是 `e0f92df` @ 02:06。Codex ~30 min 無動作 — 可能在做大改 or 暫停。
- 開啟 PR list（`gh pr list --state open`）：只有 PR #39（Jason 0020 dedup destructive migration DRAFT，Mike lane，尚未 ready）。**無 Codex mid/large PR**。
- Bruce 02:30 sweep **未觸發** — Bruce agent v1 交付後已 terminate，30-min cadence 是 promise 不是 auto-loop；目前無 new code 須驗，先 hold；Codex 下波 commit 落地時再 dispatch Bruce regression sweep。
- B10/B11 仍 OPEN — 只 1 cycle，未達 ">2 cycles 升級 prompt" 門檻；繼續觀察。
- Stop-line scan **PASS** — 無新 commit。
- Dispatch: 無。Yellow/Red: 無。

### Cycle 1 (02:11) — 觀察期
- Read board / `git log -20` / Jason output / Bruce output. Codex commits 6 condensed ones: `8abfc13 / f463069 / 3fa0feb / 11c2b9a / b64a875 / e0f92df`，全在 `apps/web/**` lane，stop-line scan **PASS**.
- Jason 5-contract 完成（Contract 1+4-read READY；Contract 2/3/4-promote/5 BLOCKED with ETA Day 4-5/5-6）→ Backend Ready 已附 link。
- Bruce harness v1 完成 + 第一輪 sweep 寫了 B5~B11 七項 FAIL → cross-check 後 B5~B9 已被 Codex 同期 cycle 修掉，標 RESOLVED；B10/B11 wrapper-level fallback 仍 OPEN，HIGH priority，等 Codex 下輪 cycle 接走。
- 無 mid/large PR → Pete 持續 standby。
- 無 dispatch this cycle — 4 lanes 自走。
- Yellow/Red zone: 無觸發。

## Blockers

- **B1**: Jason 5 條 backend contract 未交（owner: Jason / due: cycle 1 = 02:00 Taipei first draft / **status: RESOLVED @ ~01:58**）
- **B2**: Bruce 4-state harness spec 未交（owner: Bruce / due: cycle 1 = 02:00 first version / **status: RESOLVED @ 02:00**）
- **B3**: KGI bidask/tick readonly endpoint — write-side `libCGCrypt.so` blocked；read-side BLOCKED per Jason Contract 5（gateway operator dep + WS not impl）；Codex 標 BLOCKED owner="Operator + Jason"
- **B4**: Pete standby — Codex 至今 cycle (01:49 → 02:04) 全部 direct-commit `fix(web)`，無 mid/large PR，Pete 仍 standby
- **B5~B9**: [Rule 5] mock-in-production page-level violations — **status: RESOLVED @ Cycle 1 verify (Elva 02:11)**. Codex commits f463069/3fa0feb/11c2b9a/b64a875/8abfc13 已將 briefs/reviews/drafts/admin-content-drafts/quote 全部從 mock 直賦轉成 LIVE/EMPTY/BLOCKED API 綁定；`ContentDraftDetailClient.tsx` 已刪除（per cycle 02:00 board entry）；mock constants 仍存於 `lib/radar-uncovered.ts` 但 page-level 直接 import 已消失。
- **B10**: [Rule 7] `apps/web/lib/radar-uncovered.ts` production fallback guard — **RESOLVED @ Codex 02:48**. `getMaybe`/`postMaybe` and direct dev-only helpers now fail closed in production; dev/build mock fallback remains allowed.
- **B11**: [Rule 7] `apps/web/lib/use-readonly-quote.ts` quote fallback — **RESOLVED @ Codex 02:48**. Production failures now render BLOCKED/NO DATA with `endpointUnavailable=true`; `BidAskLadder` and `TickTape` no longer draw synthetic rows when KGI read endpoints are unavailable.

Backend ready 將隨 Jason contract 落地逐條補入上方 `Backend Ready` 區.
