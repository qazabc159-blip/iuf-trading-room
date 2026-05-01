# Frontend Real-Data Status Board — 2026-05-01

Owner: Codex
Cadence: Codex update every 30 minutes during overnight run. Elva lane may update every 20 minutes.
Primary goal: make production UI meaningful, sourced, and operational.

### 2026-05-01 14:51 Taipei — Elva cadence: 68h sprint Block 1 mid-late checkpoint

**Codex burst recap since 13:46 (10 commits, all `apps/web/**`)**:
- `1d3b507` remove fake auth footer version
- `00b9bd3` clean document title metadata
- `7d4729b` make company source status truthful
- `e01cd80` clean ohlcv chart truthfulness wording
- `bcd136b` remove static post-close session label
- `4c577d8` make company master labels readable
- `b52bb26` render command palette state rows as notes
- `ba1cc1b` remove unused decorative widget helpers
- `2408853` remove unused block spark helper
- `a3412da` docs(w7): record frontend smoke and ci status

Aggregate diff (a5a9d3a..2408853): **31 files, +991/-1648 (net -657 LOC)**. Codex now in cleanup phase — retiring fake/decorative widgets that survived the wire-live phase.

**Verification at 14:51 (HEAD `2408853`)**:
- `pnpm typecheck` PASS (clean tsc -p tsconfig.json --noEmit)
- Stop-line grep `apps/web` for `broker.*submit|live.*submit|kgi.*broker|order/create`: 5 hits, all confirmed false positives (UI state machine `submit.status === "live"` + 3 hard-line marker comments + 1 LabClient note "does not enable live submit"). 0 actual broker-write paths.
- 4-state hard rule: still LIVE/EMPTY/BLOCKED/HIDDEN; no fake mock fallback introduced.
- `radar-lab.ts` -230 LOC — earlier Cycle 8 B12 working tree finally committed by Codex with the production fail-closed pattern intact.

**Working tree** (still NOT my lane to touch):
- `.gitignore` modified, unstaged (Codex still has it on its plate)
- All previously `D` files now committed (no longer in working tree)

**Block 1 status (5/1 12:33 → 24:00, ~9h remaining)**:
| Lane | Owner | Status |
|---|---|---|
| A — Codex Contract 1 + cleanup | Codex | LIVE-pushing ~24 commits/hour, cleanup phase, no slowdown |
| B — Elva session-layer schema | Elva | DONE (`session_layer_risk_schema_design_2026-05-01.md` committed `a5a9d3a`) |
| C — Bruce regression | Bruce | Bash dead, static audit DONE @ 22363e4 |
| D — Jason 0020 v2 | Jason | OFFLINE |

**Yellow / Red events**: 0 / 0. No stop-line violation. No live broker write. No 0020 promote. No Codex working-tree pickup. No secret rotation.

**Pivot note**: Block 1 original B-lane scope (risk persist + session schema + OpenAlice 100-co batch design) is now (a) DONE for risk persist correction, (b) DONE for session schema, (c) NOT STARTED for OpenAlice batch design. Will pick up OpenAlice 100-co batch design next cycle.

**Next 60min (15:51 cadence)**:
1. Write OpenAlice 100-company exposure batch design doc (P1-11)
2. Update `evidence/w7_paper_sprint/INDEX.md` (if exists, else create) with today's docs
3. Verify any new Codex commits stop-line clean
4. Standby for Jason / 0020 v2 trigger

---

### 2026-05-01 13:46 Taipei — Elva cadence: 68h sprint Block 1 mid-checkpoint

**Trigger**: 60min cadence on (12:33 dispatch + 13:33 plan checkpoint + 13:46 Codex burst verification fold-in).

**Codex burst recap (12:42 → 13:38, ~14 commits to main)**:
- `54a6041` Contract 1 paper orders wiring (PaperOrderPanel +584/-220, OrderTicket +878/-214, new `paper-orders-api.ts` +193, lib/api +38)
- `17b8049` dashboard live; `5d615b5` ideas live; `2c9baba` strategy runs live; `399ecd6` signals/themes live; `2e86f95` theme detail live
- `2dafaae` plans live; `5bfe76d` ops live; `a893309` mobile live; `8ce3e46` portfolio live (full kill-switch real reads + paper risk surface)
- `40d2267` retire remaining radar-api consumers; `b2b17cc` portfolio placeholder type drop; `8bd2e98` retire legacy radar mock layer; `211c1c7` dormant quote mock widgets removed

**Verification at 13:42 (HEAD `8bd2e98`)**:
- `pnpm typecheck` PASS (clean tsc -p tsconfig.json --noEmit)
- `pnpm build` PASS (full Next.js bundle, /portfolio 5.96kB, all routes compiled)
- Stop-line grep `apps/web/lib/paper-orders-api.ts`: 0 matches mock|placeholder|TODO|FIXME|fake
- Stop-line grep `apps/web/**` live submit patterns: only legitimate hard-line markers (`// HARD LINE: never import KGI SDK or call broker live submit path.`, "Submit remains paper-only and creates no broker/live order")
- 4-state hard rule: every wired endpoint shows source + updatedAt + LIVE/EMPTY/BLOCKED branch (per Codex's own per-cycle log)

**Working tree note (NOT my lane to touch)**:
- 18 `D` (deleted, unstaged) component files — `RadarCandlestickChart.tsx`, `RadarDataStateBadge.tsx`, `boot-sequence.tsx`, etc. — Codex still mid-burst retiring legacy mock components.
- `.gitignore` modified, unstaged.
- Will NOT pick up Codex working tree (Codex is active; B12 lesson learned).

**Bruce backend Contract 1-5 audit** (committed `22363e4` on Bruce's behalf — Bash dead 9th session):
- C1 Paper Orders = READY (5 routes, idempotency 409 PASS, gate ARMED, 0 KGI calls)
- C2 Portfolio = BLOCKED (routes absent — Jason ETA Day 4-5)
- C3 Watchlist = BLOCKED (routes absent — Jason ETA Day 4-5)
- C4 Strategy idea→order = PARTIAL (4a-4d READY, 4e promote-to-order no impl)
- C5 KGI Bidask = PARTIAL (read at server.ts:2556/2617, gateway ops BLOCKED, 5c WS not implemented)

**Stale memory correction (P1-5 risk persist gap is INVALID)**:
- `apps/api/src/risk-store.ts:1-64` already file-backed via `RAILWAY_VOLUME_MOUNT_PATH ?? "/data"` + atomic tmp→rename + `hydrateRiskEngine(state)` on boot rehydrates 4 stores (limits, killSwitch, strategyLimits, symbolLimits).
- Memory + roadmap claim "P1-5 in-memory only" was wrong. Will correct in `institutional_grade_roadmap_2026-05-01.md` next push and update relevant memory entries.

**Block 1 lane status (5/1 12:33 → 24:00, ~10h remaining)**:
| Lane | Owner | Status |
|---|---|---|
| A — Codex Contract 1 wiring | Codex | LIVE-pushing (14 commits, still mid-burst) |
| B — Elva risk persist + session schema design | Elva self | RESCOPED — risk persist already done; pivot to Session layer schema (P1-6) only |
| C — Bruce regression sweep | Bruce | Bash dead, static audit DONE; static-only path until tooling fixed |
| D — Jason 0020 v2 standby | Jason | OFFLINE (Mike + Pete templates ready) |

**Yellow / Red events**: 0 / 0. No stop-line violation. No live broker write. No 0020 promote. No secret rotation. No Codex working-tree pickup.

**Next 60min (14:46 cadence)**:
1. Update institutional_grade_roadmap §3 P1-5 → mark CORRECTION (already done) + bump P1-6 Session layer to P1-5 priority
2. Write Session layer schema design doc (4th risk layer: open-to-close 限額 + 當日緊急停損)
3. Verify 0 stop-line violations in latest Codex commits (post `211c1c7`)
4. Standby for Jason / Pete review trigger

---

### 2026-05-01 13:38 Taipei - Codex cycle: legacy RADAR mock layer retired
- Now: Removed the unused legacy RADAR client/components that kept placeholder schemas and mock datasets alive in `apps/web`. Company detail adapter no longer invents market cap, score, FII, intraday, or quote values; missing non-contracted fields now render EMPTY/BLOCKED instead of generated numbers.
- Files: deleted `apps/web/lib/radar-api.ts`, `apps/web/lib/radar-mocks.ts`, `apps/web/lib/radar-types.ts`, `apps/web/components/Chart.tsx`, unused `apps/web/components/research/*`, and unused legacy portfolio client/table/override widgets. Updated `apps/web/lib/company-adapter.ts`, `apps/web/app/companies/[symbol]/page.tsx`, and `CompanyHeroBar.tsx`.
- Endpoints: no new backend writes. Company detail still uses `GET /api/v1/companies`, `GET /api/v1/companies/:id/ohlcv`, `GET /api/v1/companies/:id/announcements`, plus existing client panels for financials/chips where available.
- Behavior: OHLCV rows with `source=mock` are filtered before chart/quote rendering. Quote badge now says EMPTY when no production bar exists. Company KPIs that do not have real contracted data show `--` or BLOCKED, not deterministic fallback values.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; exact scan for `radar-types`, `radar-api`, `radar-mocks`, old research imports, and old portfolio widgets returns zero rows.
- Blockers: broader scan still finds other mock-named files/components (`mock-kbar`, `kgi-quote-mock`, blocked quote/chart panels). These need separate treatment: either bind to real quote/K-line endpoints or keep HIDDEN/BLOCKED.

### 2026-05-01 13:29 Taipei - Codex cycle: production portfolio no longer depends on placeholder `radar-types`
- Now: Removed `@/lib/radar-types` from the active `/portfolio` page, kill-switch control, paper order ticket, and idea handoff path. Kept the paper ticket read/write behavior bounded to existing paper-order endpoints; live broker submit remains untouched.
- Files: `apps/web/app/portfolio/page.tsx`; `apps/web/components/portfolio/KillSwitch.tsx`; `apps/web/components/portfolio/OrderTicket.tsx`; `apps/web/lib/radar-handoff.ts`; `apps/web/components/SendToTicketButton.tsx`.
- Endpoints: unchanged from prior portfolio work: paper-order preview/submit/status/list/cancel through `paper-orders-api.ts`, plus real risk/kill-switch reads from `/api/v1/risk/*`.
- Behavior: `KillMode` is now a portfolio UI type instead of a placeholder schema type. Idea handoff stores only the minimal live/paper-ticket payload (`symbol`, `side`, `rationale`, `themeCode`, `emittedAt`) and accepts real strategy idea shapes without importing the old mock domain model.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: residual `@/lib/radar-types` imports remain only in legacy shared/research components and unused old portfolio client/table widgets. Next cycle can either retire unused legacy components or migrate them to contract types.

### 2026-05-01 13:24 Taipei - Codex cycle: final visible `radar-api` adapter consumers removed
- Now: Removed the remaining visible `@/lib/radar-api` consumers from the global data-source badge, root command palette, and execution timeline component. `apps/web` no longer imports the old mock adapter anywhere.
- Files: `apps/web/components/DataSourceBadge.tsx`; `apps/web/components/CommandPalette.tsx`; `apps/web/components/portfolio/ExecutionTimeline.tsx`.
- Endpoints: `GET /api/v1/session`; `GET /api/v1/themes`; `GET /api/v1/companies`; `GET /api/v1/strategy/ideas?decisionMode=paper&includeBlocked=true&sort=score`; `GET /api/v1/strategy/runs?decisionMode=paper&sort=created_at`; `GET /api/v1/trading/events`; `GET /api/v1/trading/stream`.
- Behavior: badge now reports LIVE or BLOCKED from the real session endpoint, never MOCK. Command palette lazy-loads real themes/companies/ideas/runs and renders BLOCKED/EMPTY when backend data is unavailable. Execution timeline reads paper-default execution events and uses the real stream helper with polling fallback; no mock event stream remains.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; exact `@/lib/radar-api` scan under `apps/web` returns zero rows; `git diff --check` PASS for changed files.
- Blockers: old `apps/web/lib/radar-types.ts` placeholder types still have residual imports in legacy shared components; no `radar-api` mock adapter imports remain. Next cycle should retire or replace those placeholder-type consumers without touching backend, broker, migrations, or secrets.

### 2026-05-01 13:15 Taipei - Codex cycle: `/portfolio` real paper trading surface DONE
- Now: Converted `apps/web/app/portfolio/page.tsx` from legacy `@/lib/radar-api` mock-shaped `PortfolioClient` inputs into a server-side production paper trading/risk surface. Page-level `@/lib/radar-api` imports under `apps/web/app/**` are now zero.
- Files: `apps/web/app/portfolio/page.tsx`.
- Endpoints: `GET /api/v1/trading/balance`; `GET /api/v1/trading/positions`; `GET /api/v1/trading/orders`; `GET /api/v1/trading/events`; `GET /api/v1/risk/limits`; `GET /api/v1/risk/strategy-limits`; `GET /api/v1/risk/symbol-limits`; `GET /api/v1/risk/kill-switch`, all scoped to `accountId=paper-default`.
- Behavior: page renders LIVE / EMPTY / BLOCKED with source + updatedAt; keeps the already-wired Paper Order Ticket; reads real kill-switch state; shows real paper balance/positions/orders/events/risk limits. Kill-switch writes remain disabled; live broker submit remains out of scope.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; `Get-ChildItem apps/web/app -Recurse -Include *.tsx | Select-String '@/lib/radar-api'` returns zero rows.
- Blockers: no remaining page-level `radar-api` usage. Residual cleanup can move to unused legacy client/components/libs later, but production pages are no longer importing the mock adapter.

### 2026-05-01 13:12 Taipei - Codex cycle: mobile `/m` + `/m/kill` real read paths DONE
- Now: Converted `apps/web/app/m/page.tsx` from legacy `@/lib/radar-api` mock mobile brief to real briefs/themes/strategy ideas/market overview/kill-switch data. Converted `apps/web/app/m/kill/page.tsx` from mock session kill mode to real kill-switch read endpoint.
- Files: `apps/web/app/m/page.tsx`; `apps/web/app/m/kill/page.tsx`.
- Endpoints: `GET /api/v1/briefs`; `GET /api/v1/themes`; `GET /api/v1/strategy/ideas?decisionMode=paper&includeBlocked=true&sort=score`; `GET /api/v1/market-data/overview`; `GET /api/v1/risk/kill-switch?accountId=paper-default`.
- Behavior: mobile brief renders LIVE / EMPTY / BLOCKED and no longer shows mock countdown/events/heat/watchlist. Mobile kill switch reads real state but all mode buttons remain disabled; write path stays BLOCKED pending backend governance, audit, risk regression, and operator approval.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: none for mobile read paths. Next: diff check + commit/push; then assess `/portfolio` separately because its client still uses legacy `radar-types` and needs a narrower adapter or backend readiness.

### 2026-05-01 13:08 Taipei - Codex cycle: `/ops` real ops snapshot DONE
- Now: Converted `apps/web/app/ops/page.tsx` from legacy `@/lib/radar-api` mock API probes/jobs/audit to production ops snapshot data.
- Files: `apps/web/app/ops/page.tsx`.
- Endpoint: `GET /api/v1/ops/snapshot?auditHours=24&recentLimit=12`.
- Behavior: page renders LIVE / EMPTY / BLOCKED with source + updatedAt. Removed fake endpoint latency/error-rate rows and fake worker jobs; now shows workspace stats, OpenAlice observability/queue, latest rows, audit summary, and recent audit rows from the ops snapshot payload.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: none for ops snapshot read path. Next: diff check + commit/push; continue `/m` and `/portfolio` legacy `radar-api` cleanup.

### 2026-05-01 13:06 Taipei - Codex cycle: `/plans` real planning surface DONE
- Now: Converted `apps/web/app/plans/page.tsx` from legacy `@/lib/radar-api` mock brief/review/weekly/risk/events into a read-only production planning board.
- Files: `apps/web/app/plans/page.tsx`.
- Endpoints: `GET /api/v1/plans`; `GET /api/v1/companies`; `GET /api/v1/themes`; `GET /api/v1/signals`; `GET /api/v1/briefs`; `GET /api/v1/reviews`; `GET /api/v1/strategy/ideas?decisionMode=paper&includeBlocked=true&sort=score`.
- Behavior: page renders LIVE / EMPTY / BLOCKED with source + updatedAt. Removed unsupported mock weekly rotation, mock PnL, fake risk snapshot, fake execution events, and fake order action. Planning page is explicitly read-only; order controls stay in approved paper-order UI only.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: none for read-only plan board. Next: diff check + commit/push; then continue `/ops`, `/m`, `/portfolio` legacy `radar-api` cleanup.

### 2026-05-01 13:03 Taipei - Codex cycle: `/themes/[short]` real detail DONE
- Now: Converted `apps/web/app/themes/[short]/page.tsx` from legacy `@/lib/radar-api` mock detail to a real theme detail view using theme slug lookup plus DB-backed companies/signals and strategy ideas filtered by theme id.
- Files: `apps/web/app/themes/[short]/page.tsx`.
- Endpoints: `GET /api/v1/themes`; `GET /api/v1/companies`; `GET /api/v1/signals?themeId=:id`; `GET /api/v1/strategy/ideas?themeId=:id&decisionMode=paper&includeBlocked=true&sort=score`.
- Behavior: page renders LIVE / EMPTY / BLOCKED with source + updatedAt. Removed mock heat/pulse/member metrics and fake order action; company/idea rows link only to company detail.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: none for theme detail read path. Next: diff check + commit/push; continue legacy `radar-api` cleanup on `/plans`, `/ops`, `/m`, `/portfolio`.

### 2026-05-01 13:01 Taipei - Codex cycle: `/signals` + `/themes` real endpoints DONE
- Now: Converted `apps/web/app/signals/page.tsx` from legacy `@/lib/radar-api` signal mocks to real `getSignals()` with theme/company id mapping from real theme/company endpoints. Converted `apps/web/app/themes/page.tsx` from heat/pulse mock ladder to real `getThemes()` rows.
- Files: `apps/web/app/signals/page.tsx`; `apps/web/app/themes/page.tsx`.
- Endpoints: `GET /api/v1/signals`; `GET /api/v1/themes`; `GET /api/v1/companies`.
- Behavior: both pages render explicit LIVE / EMPTY / BLOCKED states with source + updatedAt. Theme list removed unsupported heat/pulse/mock momentum values and displays only DB-backed priority, marketState, lifecycle, core/observation pool counts, thesis, and updatedAt.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: `/themes/[short]` still legacy radar-api and must be converted before theme drilldown is fully truthful. Next: diff check + commit/push; then wire `/themes/[short]`.

### 2026-05-01 12:58 Taipei - Codex cycle: `/runs` real strategy endpoints DONE
- Now: Converted `apps/web/app/runs/page.tsx` and `apps/web/app/runs/[id]/page.tsx` from legacy `@/lib/radar-api` mock-shaped run data to production strategy run endpoints.
- Files: `apps/web/app/runs/page.tsx`; `apps/web/app/runs/[id]/page.tsx`.
- Endpoints: `GET /api/v1/strategy/runs?decisionMode=paper&sort=created_at`; `GET /api/v1/strategy/runs/:id`.
- Behavior: run list/detail now render explicit LIVE / EMPTY / BLOCKED states with source + updatedAt; detail page removed fake `/portfolio` ORDER action and exposes company detail links only. Execute/order controls remain hidden until backend and risk gates approve them.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; `git diff --check -- apps/web/app/runs/page.tsx apps/web/app/runs/[id]/page.tsx` PASS.
- Blockers: none for run read paths. Next: commit/push this scoped change; continue legacy `radar-api` cleanup on signals/themes/plans/mobile/ops as safe.

### 2026-05-01 12:53 Taipei - Codex cycle: `/ideas` real strategy endpoint DONE
- Now: Converted `apps/web/app/ideas/page.tsx` from legacy `@/lib/radar-api` mock-shaped ideas to `getStrategyIdeas({ decisionMode: "paper", includeBlocked: true, limit: 30, sort: "score" })`.
- Files: `apps/web/app/ideas/page.tsx`.
- Endpoint: `GET /api/v1/strategy/ideas?decisionMode=paper&includeBlocked=true&sort=score`.
- Behavior: page now renders explicit LIVE / EMPTY / BLOCKED states with source + updatedAt; removed fake `/portfolio` order action and replaced row action with read-only company detail link. Strategy idea -> order handoff remains BLOCKED until Contract 4 promote route is approved.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; `git diff --check -- apps/web/app/ideas/page.tsx evidence/w7_paper_sprint/frontend_realdata_status_board_2026-05-01.md` PASS.
- Blockers: none for `/ideas` read path. Next: commit/push this scoped change; continue to `/runs` legacy radar-api cleanup.

## Current State

- Auth cookie/domain: DONE.
- Sidebar logout: DONE.
- API health: PASS after deployment.
- Company 2330 with authenticated cookie: PASS.
- Production no-silent-mock policy: IN PROGRESS; B10/B11 wrapper-level production fallback fixed in Codex cycle 02:48, B12 Quant Lab fallback fixed in Codex cycle 03:40, kill-switch mock writes removed in Codex catch-up cycle 12:10.
- Market Intel/news lane: IN PROGRESS; company detail panel [05] now binds TWSE announcements through the shared API client.
- Build-time mock static HTML risk: MITIGATED in Codex catch-up cycle 12:30; legacy `radar-api` pages now force dynamic request-time render.
- Paper Orders Contract 1 frontend wiring: DONE in Codex catch-up cycle 12:41; portfolio order ticket and company-side panel now call real paper preview/submit/status/list/cancel endpoints through `paper-orders-api.ts`.
- Dashboard real-data conversion + Market Intel/news column: DONE in Codex catch-up cycle 12:49; `/` now uses real market-data overview, themes, strategy ideas/runs, signals, and TWSE material announcements.
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

Bruce Cycle 3 regression sweep DONE @ 2026-05-01 ~02:54 Taipei → B10 RESOLVED / B11 RESOLVED / B12 NEW (radar-lab.ts no IS_PROD guard, /lab + /lab/[bundleId] pages affected, owner=Codex)

Codex B12 fix landed @ 2026-05-01 ~03:40 Taipei: Quant Lab frontend now fails closed in production and renders BLOCKED/EMPTY instead of mock bundles when lab API routes are unavailable.

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
- `GET /api/v1/market-data/overview`
- `POST /api/v1/paper/orders/preview`
- `POST /api/v1/paper/orders`
- `GET /api/v1/paper/orders`
- `GET /api/v1/paper/orders/:id`
- `POST /api/v1/paper/orders/:id/cancel`

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
- `/lab` and `/lab/[bundleId]`: DONE in Codex cycle 03:40; `radar-lab.ts` now fails closed in production and pages render BLOCKED/EMPTY instead of mock Quant Lab bundles when the lab API is unavailable.
- `/companies/duplicates`: DONE in Codex catch-up cycle 12:20; page now binds `GET /api/v1/companies/duplicates` and renders LIVE/EMPTY/BLOCKED, with merge/ignore actions hidden until migration audit + backup ACK.
- `/companies/[symbol]`: source/tick/derivatives mock feed removed in Codex cycle 01:49; remaining company-detail mock risk is `toCompanyDetailView` fallback fields.
- `DerivativesPanel`: BLOCKED until production endpoint contract exists.
- `TickStreamPanel`: BLOCKED until KGI readonly bid/ask + tick contract exists.
- `/m/kill` and portfolio KillSwitch: DONE in Codex catch-up cycle 12:10; frontend mock kill-mode toggles removed, current mode is read-only, all writes render BLOCKED pending backend governance/audit/risk approval.
- Portfolio `OrderTicket` and `/companies/[symbol]` `PaperOrderPanel`: DONE in Codex catch-up cycle 12:41; no longer use mock-shaped `radar-api.previewOrder/submitOrder`, show LIVE/EMPTY/BLOCKED ledger states, and use fresh idempotency keys for submit.
- `/` dashboard: DONE in Codex catch-up cycle 12:49; removed hardcoded TAIEX/TPEX/turnover/breadth/ops/heat-map cards and added a TWSE Market Intel/news column sourced from company announcement endpoints.
- `radar-api.ts` GET surfaces and `radar-uncovered.ts`: API failure can still fall back to mock on remaining legacy pages; order POST fallback has been removed from `radar-api.ts`.

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

### 2026-05-01 03:40 Taipei

Completed:

- Fixed B12: `radar-lab.ts` no longer converts production API failure / invalid shape / missing API base into mock Quant Lab bundle success. Dev/build mock fallback is preserved only outside production runtime.
- `/lab` now renders LIVE only from `GET /api/v1/lab/bundles`, EMPTY on a real zero-row result, or BLOCKED when the Quant Lab API contract is unavailable.
- `/lab/[bundleId]` now renders a BLOCKED detail page when `GET /api/v1/lab/bundles/:bundleId` is unavailable, instead of serving a mock bundle.
- Lab approve/reject actions only mutate local UI state after a successful `POST /api/v1/lab/bundles/:bundleId/action`; errors surface as BLOCKED action feedback.
- Push-to-portfolio remains disabled with an explicit blocker until Athena + Jason define the strategy-bundle-to-paper-order handoff. No broker order, no live submit, and no migration 0020 behavior changed.

Files:

- `apps/web/lib/radar-lab.ts`
- `apps/web/app/lab/page.tsx`
- `apps/web/app/lab/LabClient.tsx`
- `apps/web/app/lab/[bundleId]/page.tsx`
- `apps/web/app/lab/[bundleId]/LabBundleDetailClient.tsx`
- `evidence/w7_paper_sprint/frontend_realdata_status_board_2026-05-01.md`

Endpoints:

- `GET /api/v1/lab/bundles` remains BLOCKED until Athena + Jason publish the backend route/contract.
- `GET /api/v1/lab/bundles/:bundleId` remains BLOCKED until Athena + Jason publish the backend route/contract.
- `POST /api/v1/lab/bundles/:bundleId/action` fails closed in production when unavailable.

Tests:

- PASS `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- PASS `pnpm.cmd --filter @iuf-trading-room/web build`

Blockers:

- New backend blocker B13: Quant Lab bundle API contract/routes are not implemented yet; owner Athena + Jason. Frontend is truthful and ready to bind once routes exist.

### 2026-05-01 12:10 Taipei

Completed:

- Removed fake kill-switch writes from `/m/kill`. The mobile kill page now reads current session kill mode when available, renders all mode changes as BLOCKED, and documents owner/blocker instead of simulating a mode transition.
- Removed local mock mode changes from the portfolio `KillSwitch` component. It is now a read-only 4-state display with all write controls disabled and explained.
- Hardened `api.killMode()` so mock-only kill-mode fallback cannot be used in production runtime.
- No backend kill-route wiring was added. No live submit, no migration 0020, no broker path, no Railway secret touched.

Files:

- `apps/web/app/m/kill/page.tsx`
- `apps/web/components/portfolio/KillSwitch.tsx`
- `apps/web/lib/radar-api.ts`
- `evidence/w7_paper_sprint/frontend_realdata_status_board_2026-05-01.md`

Endpoints:

- `GET /api/v1/session` is used only to show the current kill mode on `/m/kill`.
- Kill-switch write path remains BLOCKED until Jason + Bruce provide approved backend governance, audit log, 4-layer risk regression, and operator approval.

Tests:

- PASS `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- PASS `pnpm.cmd --filter @iuf-trading-room/web build`

Blockers:

- B14: Kill-switch write governance remains BLOCKED, owner Jason + Bruce. Frontend is now truthful and read-only.

### 2026-05-01 12:20 Taipei

Completed:

- Converted `/companies/duplicates` from client-side `mockDuplicatePairs` to real `GET /api/v1/companies/duplicates`.
- The page now renders LIVE duplicate groups from DB, EMPTY when the API returns zero groups, or BLOCKED when the duplicate report API is unavailable.
- Removed local-only merge / not-duplicate / ignore buttons. The page now shows read-only duplicate groups and explicitly blocks write actions until governance is approved.
- No destructive merge route was wired. No migration 0020 promotion, no backup-affecting action, no DB write, no Railway secret touched.

Files:

- `apps/web/app/companies/duplicates/page.tsx`
- `evidence/w7_paper_sprint/frontend_realdata_status_board_2026-05-01.md`

Endpoints:

- `GET /api/v1/companies/duplicates`

Tests:

- PASS `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- PASS `pnpm.cmd --filter @iuf-trading-room/web build`

Blockers:

- B15: Duplicate merge / ignore write actions remain BLOCKED, owner Mike + Jason + Pete. Required: migration audit, backup ACK, merge contract, and desk review.

### 2026-05-01 12:30 Taipei

Completed:

- Mitigated the highest build-time mock risk: pages that still use legacy `apps/web/lib/radar-api.ts` now opt into request-time rendering with `export const dynamic = "force-dynamic"`.
- Removed `generateStaticParams()` from `/themes/[short]` so theme detail pages do not call the legacy API client at build time and bake fallback data into static HTML.
- Confirmed production build output changed the affected routes from static `○` to dynamic `ƒ`.

Files:

- `apps/web/app/page.tsx`
- `apps/web/app/ideas/page.tsx`
- `apps/web/app/runs/page.tsx`
- `apps/web/app/runs/[id]/page.tsx`
- `apps/web/app/signals/page.tsx`
- `apps/web/app/themes/page.tsx`
- `apps/web/app/themes/[short]/page.tsx`
- `apps/web/app/plans/page.tsx`
- `apps/web/app/m/page.tsx`
- `apps/web/app/m/kill/page.tsx`
- `apps/web/app/portfolio/page.tsx`
- `apps/web/app/ops/page.tsx`
- `evidence/w7_paper_sprint/frontend_realdata_status_board_2026-05-01.md`

Endpoints:

- Existing legacy `radar-api` GET endpoints are now evaluated at request time instead of build time.

Tests:

- PASS `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- PASS `pnpm.cmd --filter @iuf-trading-room/web build`
- Build route check: `/`, `/ideas`, `/runs`, `/runs/[id]`, `/signals`, `/themes`, `/themes/[short]`, `/plans`, `/m`, `/m/kill`, `/ops`, `/portfolio` are `ƒ Dynamic`.

Blockers:

- B16: Several legacy `radar-api` pages still need component-level LIVE/EMPTY/BLOCKED polish, but they no longer ship build-time mock HTML.

### 2026-05-01 12:41 Taipei

Completed:

- Wired Contract 1 Paper Orders into the frontend with a dedicated no-mock API client.
- Portfolio `OrderTicket` now uses real paper order preview, submit, status polling, list, and cancel endpoints with LIVE / EMPTY / BLOCKED states.
- Company detail `PaperOrderPanel` now shares the same real paper endpoint path and shows symbol-scoped paper ledger rows instead of treating submit as an isolated local acknowledgement.
- Removed legacy mock-shaped paper order POST methods from `radar-api.ts`; order submit/preview now use the Contract 1 payload (`idempotencyKey`, `symbol`, `side`, `orderType`, `qty`, `price`) instead of RADAR mock ticket shape.
- Live broker submit remains untouched. No KGI SDK import, no `/order/create`, no migration 0020, no Railway secrets.

Files:

- `apps/web/lib/paper-orders-api.ts`
- `apps/web/lib/api.ts`
- `apps/web/lib/radar-api.ts`
- `apps/web/components/portfolio/OrderTicket.tsx`
- `apps/web/app/companies/[symbol]/PaperOrderPanel.tsx`
- `evidence/w7_paper_sprint/frontend_realdata_status_board_2026-05-01.md`

Endpoints:

- `POST /api/v1/paper/orders/preview`
- `POST /api/v1/paper/orders`
- `GET /api/v1/paper/orders/:id`
- `GET /api/v1/paper/orders`
- `POST /api/v1/paper/orders/:id/cancel`

Tests:

- PASS `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- PASS `pnpm.cmd --filter @iuf-trading-room/web build`
- PASS `git diff --check -- apps/web/lib/paper-orders-api.ts apps/web/lib/api.ts apps/web/lib/radar-api.ts apps/web/components/portfolio/OrderTicket.tsx apps/web/app/companies/[symbol]/PaperOrderPanel.tsx`

Blockers:

- Paper ledger remains backend in-memory until Jason completes persistence/freshness work. Frontend labels this as real paper endpoint state, not live broker state.
- Contract 2/3/4-promote/5 remain BLOCKED per Jason contract board.

### 2026-05-01 12:49 Taipei

Completed:

- Converted `/` from the legacy `radar-api` mock-shaped dashboard into a real-data dashboard.
- Removed hardcoded market cards for TAIEX/TPEX/turnover/breadth/risk budget, static ops health rows, and decorative heat-map points.
- Added `GET /api/v1/market-data/overview` to the shared API client and uses it for quote counts, freshness, providers, paper-usable counts, top gainers/losers, and most-active symbols.
- Dashboard themes now come from `GET /api/v1/themes`, ideas from `GET /api/v1/strategy/ideas?decisionMode=paper`, runs from `GET /api/v1/strategy/runs`, and signals from `GET /api/v1/signals`.
- Added Market Intel/news column: selects active/idea-linked companies and aggregates `GET /api/v1/companies/:id/announcements?days=14` TWSE material announcements.
- Every dashboard panel now renders LIVE / EMPTY / BLOCKED with source and updated time instead of silently filling with mock rows.

Files:

- `apps/web/app/page.tsx`
- `apps/web/lib/api.ts`
- `evidence/w7_paper_sprint/frontend_realdata_status_board_2026-05-01.md`

Endpoints:

- `GET /api/v1/market-data/overview`
- `GET /api/v1/themes`
- `GET /api/v1/companies`
- `GET /api/v1/strategy/ideas?decisionMode=paper`
- `GET /api/v1/strategy/runs`
- `GET /api/v1/signals`
- `GET /api/v1/companies/:id/announcements?days=14`

Tests:

- PASS `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- PASS `pnpm.cmd --filter @iuf-trading-room/web build`
- PASS `git diff --check -- apps/web/app/page.tsx apps/web/lib/api.ts`

Blockers:

- Market Intel is limited to company-linked TWSE material announcements until Jason exposes a global news endpoint or broader market-news source.

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

### Cycle 14 (06:38) — FINAL；Codex 185min idle；ready for operator handover at 07:00
- `git fetch origin main`：HEAD `7711a38` (Cycle 13 commit) — 與本地一致，無新 commit。
- `git status apps/web/`：5 files unchanged，mtime: `radar-lab.ts` 03:29:53 / `LabClient.tsx` 03:33:55（185min idle since latest touch）。
- 無新 PR；PR #39 (Jason 0020) 仍 DRAFT，未 promote。
- Codex 整夜未響應 Cycle 8 checkpoint hint；working tree 5 files diff 已在 closeout doc + handoff 完整 carry-over，白班可接手（Option 1 接手 / Option 2 等 Codex）。
- Stop-line scan **PASS** — no broker write / no migration / no secrets / no live submit / no KGI SDK touch / no fake mock。
- 不主動接手 Codex WIP（保留 lane 邊界）；不夜跑 Bruce regression（沒新 code，低價值）。
- **總結**：14 × 20min cycles + closeout，5h18min（01:42 → 07:00），8 src commits + 13 governance commits = 21 commits on main，**0 destructive merges、0 stop-line violations、0 force-pushes、0 secret rotations、0 PR merges、0 Yellow events、0 Red events**。
- 最終交付：(a) `elva_morning_closeout_2026-05-01.md` — 5 sections + appendix（white-shift quick-start dual-path）; (b) `session_handoff.md`（user memory dir）— 開頭已 prepend overnight closeout 章節; (c) 本 board — Cycle 0 → Cycle 14 完整 log。
- ~07:00 Taipei operator-facing summary 將於下一輪 turn 直接以文字回應 楊董，不再 schedule wakeup。

### Cycle 13 (06:18) — Closeout polish DONE + handoff section prepended；Codex 165min idle；T-40min
- `git fetch origin main`：no new commit since `1f978da` (Cycle 12 closeout draft commit)。
- `git status`：5 files unchanged（Codex WIP），mtime latest 03:33（165min idle）。
- **Closeout doc polish pass DONE** → `elva_morning_closeout_2026-05-01.md` 5 處編修：(1) header `13 cycles` → `14 × 20min cycles + closeout`; (2) B12 mtime range `03:14-03:33` → `03:29-03:34`（依實 mtime evidence）; (3) idle duration 145min → 165min; (4) governance commits 補 Cycle 12 `1f978da` + Cycles 13-14 占位，total 20 commits; (5) Yellow/Red section 補 `B10/B11 fix 633d00e 是 safety net；B12 是 polish-not-hotfix`; appendix 替換為 white-shift quick-start 雙路徑（Option 1 接手 Codex WIP、Option 2 等 Codex commit）。
- **`git log --oneline -30 origin/main` cross-check**：closeout 引用的 8 src commit hash + 12 governance commit hash 全部對得上，無錯置。
- **`session_handoff.md` 同步**：在 user memory dir `C:\Users\User\.claude\projects\C--Users-User\memory\handoff\session_handoff.md` 開頭 prepend 新章節「2026-05-01 dawn — Overnight Codex frontend real-data lane closeout (Cycles 0-14)」，one-line state + white-shift 第一動作清單 + open PR + stop-line status + board pointer。注意：handoff 在 user memory dir，不在 git repo，無 commit footprint。
- Stop-line scan **PASS** — 無新 diff，no broker write / no migration / no secrets / no live submit。
- 無新 PR。PR #39 (Jason 0020) 仍 DRAFT。
- Codex 整夜 idle ~165min；Cycle 8 checkpoint hint 仍無響應。closeout 已將 B12 carry-over 寫得很完整，白班可接手。
- Yellow/Red: **0 / 0**。
- Cycle 14 finalize plan：(a) memory writeback (`elva_memory.md` overnight learnings 加一筆) (b) 最終 board entry (c) 準備 ~07:00 operator-facing 文字回應（merged commits + carry-over + production smoke + next 3 priorities + Yellow/Red 0/0）。

### Cycle 12 (05:58) — Closeout draft DONE；Codex 145min idle；T-60min
- `git fetch origin main`：no new commit since `95dfaf4` (Cycle 11 board commit)。
- `git status`：5 files unchanged，mtime 03:33（145min idle）。
- **Closeout draft DONE** → `evidence/w7_paper_sprint/elva_morning_closeout_2026-05-01.md` (5 sections + appendix, ~120 lines)，引 commit hash + 完整 B12 fix pattern + carry-over instruction。
- Stop-line **PASS**。無新 PR。Yellow/Red 無觸發。
- Cycle 13 polish pass：cross-check 引用 hash 正確、white-shift 順序合理、handoff/session_handoff.md 是否需同步更新。
- Cycle 14 finalize：commit closeout doc、最終 board entry、~07:00 operator-facing summary 文字回應。

### Cycle 11 (05:38) — Codex 125min idle，silent wait；morning closeout T-80min
- `git fetch origin main`：no new commit since `aecbc22` (Cycle 10 board commit)。
- `git status`：5 files unchanged，mtime latest 03:33（125min idle）。
- 持續 silent wait。stop-line **PASS**。無新 PR。Yellow/Red 無觸發。
- **Closeout outline draft**（Cycle 12-13 polish, ~07:00 deliver）:
  1. Merged commits overnight: `633d00e` (Codex B10/B11 production fail-closed) + 11 board commits (Cycles 1-10) — 0 destructive merges, 0 stop-line violations.
  2. Remaining blockers: **B12 carry-over** (Codex WIP 5 files uncommitted, source-fix pattern verified, instructions on board); Jason contracts 2-5 still BLOCKED ETA Day 4-6; KGI WS (Operator+Jason); PR #39 0020 destructive DRAFT awaiting 楊董 ACK.
  3. Production smoke: `633d00e` deploy stable since 02:48; no incident overnight; Bruce v1 4-state harness + Cycle 3 cumulative regression sweep PASS.
  4. Next 3 priorities for white-shift: (a) Codex B12 checkpoint commit + Bruce post-merge regression, (b) Jason 5-contract production wiring (esp. Contract 1 Paper Orders ready), (c) PR #39 0020 destructive ACK decision (楊董 → Mike audit → Pete review → squash).
  5. Yellow/Red overnight: 0 / 0 — protocol clean.

### Cycle 10 (05:18) — Codex 105min idle，silent wait 持續；morning closeout T-100min
- `git fetch origin main`：no new commit since `d6cb476` (Cycle 9 board commit)。
- `git status`：同一 5 files，同一 mtime（latest 03:33）；105min 沒 touch。
- 持續 silent wait — 無 prod risk、無 stop-line 跨界、無 yellow/red 觸發。
- Stop-line scan **PASS** — 無新 diff。
- 無新 PR；PR #39 (Jason 0020) DRAFT。
- **Morning closeout 預備**：T-100min。若 Codex 整夜不動，B12 carry-over 會包含：
  - source-level fix instruction（已在 board B12 行）
  - Codex working tree 5 files diff（白班可 git diff 看到完整 patch）
  - Bruce v1 4-state harness + cumulative regression sweep evidence
  - Jason 5 contracts draft（pending production wiring）
- Yellow/Red: 無觸發。

### Cycle 9 (04:58) — Codex 85min idle，hint 未響應；繼續等待（無 prod risk）
- `git fetch origin main`：no new commit since `29e9705` (Cycle 8 board commit)。
- `git status`：同一 5 files、同一 mtime（latest 03:33）；85min 沒 touch。
- **Cycle 8 checkpoint hint 未被響應**：3 選項都沒走（沒 commit / 沒 PR / 沒 board heartbeat）。
- 評估：依 Cycle 9 rule，**繼續 silent 等候**，不主動觸碰 Codex working tree、不升級 operator。idle 是節奏問題不是 production risk；Codex `633d00e` 已部署 production，B12 fix 是 polish 不是 hotfix。
- 不重派 Bruce production smoke：last deploy `633d00e` ~130min 前 stable，沒新 code → re-verify 同 surface 低價值；Bruce cycles 留給 Codex 真的 commit 時用。
- Stop-line scan **PASS** — 無新 diff。
- 無新 PR；PR #39 (Jason 0020) DRAFT 等楊董 ACK。
- Yellow/Red: 無觸發。
- 觀察期延續到 morning closeout (~07:00 Taipei)。若 Codex 整夜不動，morning closeout 會把 B12 列為 carry-over，附完整 fix instruction（已在 board）讓白班接手。

### Cycle 8 (04:38) — Codex idle 65min，**checkpoint hint** 上板（非 escalation）
- `git fetch origin main`：no new commit since `6d1cfc2` (Cycle 7 board commit)。
- `git status`：同一 5 files、同一 mtime（latest 03:33）；65min 沒 touch。
- **Threshold 觸發**：64-65min ≥ 60min → board checkpoint hint。
- **HINT TO CODEX**（如果你下輪讀 board）：B12 working tree fix 已 65min 未 commit。建議三選一：
  1. **Checkpoint commit** — 即使還沒完工，把目前 source-level 改動先 commit（fix(web): wip B12 production fallback for radar-lab + lab pages），typecheck 過就先 push，後續 polish 再追加 commit
  2. **Open DRAFT PR** — branch 出去開 DRAFT，CI 跑起來，Pete 可以 standby；Elva 不會 merge DRAFT
  3. **Heartbeat note** — 在 board 寫 Codex 30min heartbeat（"B12 still in progress, ETA HH:MM, blocker=…"），讓 Elva 知道 lane 沒卡死
  以上沒選，Cycle 9 (~04:58) Elva 會 default 維持等候，不主動觸碰你 working tree。
- Stop-line scan **PASS** — 無新 diff。
- 無新 PR；PR #39 (Jason 0020) DRAFT 等楊董 ACK。
- 沒新 src commit → Bruce 不重派；沒新 PR → Pete standby；Jason 5 contracts 無變動。
- Yellow/Red: 無觸發（idle 是節奏問題，非 prod risk）。

### Cycle 7 (04:18) — Codex idle 45min，B12 working tree 不變
- `git fetch origin main`：no new commit since `9b73b91` (Cycle 6 board commit)；Codex `633d00e` 已 90min 沒新 src commit。
- `git status`：同樣 5 files modified，無新增/減少，無新 untracked apps/web 檔。
- **mtime 不變**：radar-lab.ts 03:29、lab/page.tsx 03:30、`[bundleId]/page.tsx` 03:31、`[bundleId]/LabBundleDetailClient.tsx` 03:31、LabClient.tsx 03:33。Codex 從 03:33 之後 ~45min 沒 touch 工作檔。
- 評估：45min < 60min escalation threshold，**不放 board hint**。可能在跑 typecheck / build / 寫 PR body / 切換到別 surface 思考。
- Stop-line scan **PASS** — 無新 diff。
- 無新 PR；PR #39 Jason 0020 destructive DRAFT 不在 cycle scope。
- 無 Bruce 重派（沒新 commit 可驗）；無 Pete dispatch（沒新 PR）；Jason 5 contracts 無變動。
- Yellow/Red: 無觸發。
- Cycle 8 (~04:38) 重評：若 mtime 仍 03:33 = 65min idle → board 加 checkpoint hint（依然不叫 operator，這只是進度節奏問題不是 prod risk）。

### Cycle 6 (03:58) — Codex 仍在 active edit B12，working tree mtime 03:33（剛 25min 前）
- `git fetch origin main`：no new commit since `3e16c14` (Cycle 5 board commit)；Codex `633d00e` 之後仍無新 src commit。
- `git status`：同一 5 files 仍 modified（radar-lab.ts / lab/page.tsx / LabClient.tsx / [bundleId]/page.tsx / [bundleId]/LabBundleDetailClient.tsx）。
- **mtime 證據 Codex 仍活躍**：`radar-lab.ts` 03:29、`lab/page.tsx` 03:30、`LabClient.tsx` 03:33。距離 cycle 開頭只 25min，**不是 stuck**，是 mid/large scope（+247/-110、5 files）正常編輯時間。
- Bonus check：`apps/web/lib/radar-api.ts` 已有 `IS_PROD` guard（line 45/68/98/119/149/166），不在 B12 fix scope。
- Stop-line scan **PASS** — diff 全在 `apps/web/{app,lib}/**` Codex lane。
- No new PR；唯一 open PR #39 是 Jason `jason/0020-dedup-companies-unique-2026-04-30` DRAFT（destructive，等楊董 ACK，不是這 cycle scope）。
- Bruce regression sweep 不重派（沒有新 commit；上次 sweep `a23e9c9a0ad8585b7` 已涵蓋 B12 source-pattern instructions）。
- Jason backend contract 5 條無變動，沒有新 BLOCKED 升級。
- Yellow/Red: 無觸發。

### Cycle 5 (03:38) — Codex B12 fix in-flight (uncommitted local WIP)
- `git fetch origin main`：no new commit since `633d00e` @ 02:48 (Elva commits 之後是 board update only).
- **`git status` 發現 Codex 已有 uncommitted local edits**: `apps/web/app/lab/LabClient.tsx`, `apps/web/app/lab/[bundleId]/LabBundleDetailClient.tsx`, `apps/web/app/lab/[bundleId]/page.tsx`, `apps/web/app/lab/page.tsx`, `apps/web/lib/radar-lab.ts`（5 files, +247/-110）。
- **Source-level verify**: `apps/web/lib/radar-lab.ts` 已加 `const IS_PROD = process.env.NODE_ENV === "production"` (line 3) + `shouldAllowMockFallback()` helper (line 46-47) + production throw at lines 60/73/78/86/100。Pattern 與 `radar-uncovered.ts` 對齊。**B12 source-level fix in working tree but not yet committed**。
- Stop-line scan **PASS** — diff 全在 `apps/web/{app,lib}/**` Codex lane。
- Elva 不動 Codex working tree（lane 分界）；等 Codex 自己 commit。
- 無 mid/large PR → Pete standby。
- Yellow/Red: 無觸發。

### Cycle 4 (03:17) — Bruce sweep consumed / B12 OPEN HIGH waiting on Codex
- Read board / `git fetch origin main`. **No new Codex commit** since `633d00e` @ 02:48 — Codex 安靜 ~30 min（1.5 cycle）。
- Bruce regression sweep（agent `a23e9c9a0ad8585b7`）completed @ ~02:54 — B10/B11 二次 verify RESOLVED；B12 NEW / HIGH / `apps/web/lib/radar-lab.ts` 沒 `IS_PROD` guard，`/lab` + `/lab/[bundleId]` 直接 import `radarLabApi.*` → production API failure 會 silent serve mock bundle。Bruce 已寫完整 fix-pattern instruction 到 board B12 行。
- Stop-line scan **PASS** — 無新 commit。
- B12 是 Codex lane 內，不主動 dispatch，等 Codex 下一輪 heartbeat 接手；若 Cycle 5 (~03:37) 仍未動作 = 2+ cycles，再 escalate board hint。
- 無 mid/large PR → Pete standby。
- Yellow/Red: 無觸發。

### Cycle 3 (02:55) — Codex B10/B11 fix landed + Bruce regression dispatched
- Read board / `git fetch origin main`. New commit: `633d00e fix(web): fail closed on production quote mocks` — Codex 02:48 cycle.
- **B10/B11 source-level verify (Elva 02:55)**: `apps/web/lib/radar-uncovered.ts` 加 `IS_PROD` guard + `shouldAllowMockFallback()` → production catch path 改 throw `productionFallbackError`；`apps/web/lib/use-readonly-quote.ts` `IS_PROD` guard 加在 line 142/173，production path 設 `endpointUnavailable: true` + `error` 不再 fallback `mockBidAsk`/`mockTicks`。修法看起來正確 — **本輪 Elva source-level mark RESOLVED；待 Bruce regression sweep 二次確認**。
- Stop-line scan **PASS** — `633d00e` 只動 `apps/web/lib/**`，全在 Codex lane。
- **Dispatch**: Bruce regression sweep（Cycle 3）— 跑 sweep A-E + 二次 verify B10/B11；output 寫到 board `Backend Ready` + 任何新 FAIL 寫 B12+。
- 無 mid/large PR → Pete 持續 standby。
- Yellow/Red: 無觸發。

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

- **B12 CURRENT STATUS**: [Rule 7] `apps/web/lib/radar-lab.ts` production fallback guard is **RESOLVED @ Codex 03:40**. This supersedes the older OPEN line below from Elva Cycle 4-5. `getMaybe`/`postMaybe` now use production fail-closed behavior matching `radar-uncovered.ts`; `/lab` and `/lab/[bundleId]` render BLOCKED/EMPTY instead of mock bundles when lab API routes are unavailable.
- **B13**: Quant Lab bundle API contract/routes ??**OPEN / BLOCKED / owner: Athena + Jason**. Frontend expects `GET /api/v1/lab/bundles`, `GET /api/v1/lab/bundles/:bundleId`, and `POST /api/v1/lab/bundles/:bundleId/action`; until implemented, production UI shows BLOCKED and push-to-portfolio remains disabled.
- **B14**: Kill-switch write governance ??**OPEN / BLOCKED / owner: Jason + Bruce**. `/m/kill` and portfolio KillSwitch no longer simulate mode changes; frontend requires approved backend governance route, audit log, 4-layer risk regression, and operator approval before any write control is re-enabled.
- **B15**: Duplicate merge / ignore write actions ??**OPEN / BLOCKED / owner: Mike + Jason + Pete**. `/companies/duplicates` now reads real duplicate groups but hides destructive/local-only actions until migration audit, backup ACK, merge contract, and desk review are complete.
- **B16**: Legacy `radar-api` page-level 4-state polish ??**OPEN / owner: Codex**. Build-time mock static HTML risk is mitigated by force-dynamic routes; remaining work is per-page catch/empty rendering for dashboard, ideas, runs, signals, themes, plans, ops, mobile brief, and portfolio.

- **B1**: Jason 5 條 backend contract 未交（owner: Jason / due: cycle 1 = 02:00 Taipei first draft / **status: RESOLVED @ ~01:58**）
- **B2**: Bruce 4-state harness spec 未交（owner: Bruce / due: cycle 1 = 02:00 first version / **status: RESOLVED @ 02:00**）
- **B3**: KGI bidask/tick readonly endpoint — write-side `libCGCrypt.so` blocked；read-side BLOCKED per Jason Contract 5（gateway operator dep + WS not impl）；Codex 標 BLOCKED owner="Operator + Jason"
- **B4**: Pete standby — Codex 至今 cycle (01:49 → 02:04) 全部 direct-commit `fix(web)`，無 mid/large PR，Pete 仍 standby
- **B5~B9**: [Rule 5] mock-in-production page-level violations — **status: RESOLVED @ Cycle 1 verify (Elva 02:11)**. Codex commits f463069/3fa0feb/11c2b9a/b64a875/8abfc13 已將 briefs/reviews/drafts/admin-content-drafts/quote 全部從 mock 直賦轉成 LIVE/EMPTY/BLOCKED API 綁定；`ContentDraftDetailClient.tsx` 已刪除（per cycle 02:00 board entry）；mock constants 仍存於 `lib/radar-uncovered.ts` 但 page-level 直接 import 已消失。
- **B10**: [Rule 7] `apps/web/lib/radar-uncovered.ts` production fallback guard — **RESOLVED @ Codex 02:48 / verified by Bruce Cycle 3 @ ~02:54**. `getMaybe`/`postMaybe` now guarded by `shouldAllowMockFallback()` which returns `false` in production; `devOnlyValue()` rejects in production; all catch paths throw in prod instead of returning fallback. No app-level callers of `radarUncoveredApi.*` found in `apps/web/app/**` (zero matches Sweep A).
- **B11**: [Rule 7] `apps/web/lib/use-readonly-quote.ts` quote fallback — **RESOLVED @ Codex 02:48 / verified by Bruce Cycle 3 @ ~02:54**. `!API_BASE` branch and catch branch both set `endpointUnavailable: true` + empty data in production instead of returning `mockBidAsk`/`mockTicks`. `BidAskLadder` and `TickTape` confirmed to gate on `endpointUnavailable` before drawing any synthetic rows.
- **B12**: [Rule 7] `apps/web/lib/radar-lab.ts` production fallback guard — **OPEN / HIGH / owner: Codex**. `getMaybe` line 44-45 returns fallback unconditionally when `!API_BASE` (no IS_PROD check). Catch block at lines 55-57 also returns fallback unconditionally. No `IS_PROD` or `NODE_ENV` variable declared anywhere in file. Pages `/lab` and `/lab/[bundleId]` consume `radarLabApi.bundles()` / `radarLabApi.bundle()` / `radarLabApi.bundleAction()` directly — these will silently serve mock bundle data in production on any API failure. Fix required: add `IS_PROD = process.env.NODE_ENV === "production"` and guard identical to `radar-uncovered.ts` `shouldAllowMockFallback()` pattern.

Backend ready 將隨 Jason contract 落地逐條補入上方 `Backend Ready` 區.
### Codex cycle (2026-05-01 13:43 Taipei) - dormant quote mock layer removed
- Files changed: deleted unused `apps/web/components/chart/*`, `apps/web/components/kgi-quote-panel.tsx`, `apps/web/components/kgi-broker-status.tsx`, `apps/web/lib/mock-kbar.ts`, `apps/web/lib/kbar-adapter.ts`, `apps/web/lib/kgi-quote-mock.ts`, `apps/web/lib/kgi-quote-types.ts`, `apps/web/lib/use-readonly-quote.ts`, and `apps/web/lib/radar-uncovered.ts`; updated `apps/web/app/quote/page.tsx` K-line BLOCKED reason.
- Endpoints / data behavior: no endpoint contract changed. `/quote` keeps real `getEffectiveQuotes` for LIVE/EMPTY/BLOCKED and explicitly blocks K-line, bid/ask depth, and tick tape until promoted production contracts exist.
- Behavior change: dormant synthetic K-line, bid/ask, tick tape, KGI quote panel, broker-status demo, and radar-uncovered fallback utilities are no longer present in the web bundle. No visible UI can import those old mock paths by accident.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; exact mock import scan for `mock-kbar`, `kbar-adapter`, `kgi-quote-mock`, `kgi-quote-types`, `use-readonly-quote`, `radar-uncovered`, `components/chart`, `kgi-quote-panel`, and `kgi-broker-status` returned 0.
- Blockers: production K-line/bidask/tick remains BLOCKED pending Jason/Operator real read contracts. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 13:46 Taipei) - unused legacy UI shells removed
- Files changed: deleted unused legacy client components `app-shell`, `boot-sequence`, `ticker-tape`, old CRUD boards, `openalice-ops`, `RightInspector`, dormant RADAR candlestick widgets, stale KPI strip, and KGI position placeholder.
- Endpoints / data behavior: no active route changed. Exact import scan confirmed no visible page imports these files; active routes continue using `PageFrame`, `RadarWidgets`, portfolio widgets, company detail panels, and real API clients.
- Behavior change: removes dormant deterministic spark/radar mock UI, old local-only forms, old placeholder broker/position widgets, and unused shell chrome that could be accidentally reintroduced as production UI.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; exact import scan for the deleted component names returned 0.
- Blockers: none introduced. Stop-lines respected: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 13:51 Taipei) - company fundamentals wired to real FinMind routes
- Files changed: rewrote `apps/web/app/companies/[symbol]/FinancialsPanel.tsx` and `ChipsPanel.tsx`; added typed client functions in `apps/web/lib/api.ts`; added table styles in `apps/web/app/globals.css`.
- Endpoints / data behavior: Financials now calls the actual backend contracts: `GET /api/v1/companies/:id/financials?limit=8`, `GET /api/v1/companies/:id/revenue?limit=12`, and `GET /api/v1/companies/:id/dividend?years=5`. Flows now calls `GET /api/v1/companies/:id/chips?days=30`. The old wrong monthly/dividend calls to `/financials?period=M|DIV` are gone.
- Behavior change: company fundamentals and flows now use LIVE/EMPTY/BLOCKED states with source and updatedAt. No localhost-only panel fetcher, no vague placeholder copy, no tab that implies data from the wrong endpoint.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; scan for `/financials?period=M`, `/financials?period=DIV`, and panel-local `NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001"` returned 0 in these panels.
- Blockers: FinMind data freshness depends on API-side `FINMIND_API_TOKEN` and backend route health. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 13:54 Taipei) - dev preview and duplicate command UI removed
- Files changed: deleted unused lowercase `apps/web/components/command-palette.tsx`, unused `Pulse.tsx`, private `_dev/empty-state-preview`, and unused empty-state preview components.
- Endpoints / data behavior: no active route changed. The active command palette remains `apps/web/components/CommandPalette.tsx`, which reads real pages/themes/companies/ideas/runs. The deleted preview components were not imported by production pages.
- Behavior change: removes duplicate UI code and dev-only preview surfaces that could drift from the 4-state production contract.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; exact import scan for deleted names returned 0.
- Blockers: none introduced. Stop-lines respected: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 13:55 Taipei) - Quant Lab dev mock bundles removed
- Files changed: rewrote `apps/web/lib/radar-lab.ts` to remove embedded lab bundle mock data and all dev mock fallback helpers.
- Endpoints / data behavior: `/lab` and `/lab/[bundleId]` now require real `GET /api/v1/lab/bundles`, `GET /api/v1/lab/bundles/:bundleId`, and `POST /api/v1/lab/bundles/:bundleId/action` responses. Missing API base, non-2xx, or invalid shape throws into the existing BLOCKED/EMPTY UI instead of returning sample bundles.
- Behavior change: no fake Quant Lab backtest/equity/promotion memo data remains in the web client. Lab pages stay useful as real intake surfaces and honest blockers.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; scan for `mockLabBundles`, `dev mock fallback`, and `shouldAllowMockFallback` returned 0.
- Blockers: real lab bundle API remains owner Athena + Jason. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 13:59 Taipei) - Market Intel route made real
- Files changed: added `apps/web/app/market-intel/page.tsx`; rewrote `apps/web/components/Sidebar.tsx` labels and added INTEL navigation.
- Endpoints / data behavior: `/market-intel` aggregates real `GET /api/v1/companies`, `GET /api/v1/strategy/ideas?decisionMode=paper`, and `GET /api/v1/companies/:id/announcements?days=30`. It prioritizes companies from current paper strategy ideas, then fills from the company universe.
- Behavior change: the existing Command Palette `/market-intel` route now resolves to a real page. Sidebar includes the same page. Feed rows link back to company detail and render LIVE/EMPTY/BLOCKED with source, updatedAt, failures, and selected ticker universe.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; build route table includes `/market-intel`.
- Blockers: news freshness depends on TWSE announcement route health and authenticated company universe. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 14:03 Taipei) - production API base fails closed
- Files changed: hardened `apps/web/lib/api.ts`, `apps/web/lib/auth-client.ts`, and `apps/web/lib/paper-orders-api.ts`.
- Endpoints / data behavior: production no longer silently defaults frontend API clients to `http://localhost:3001` when `NEXT_PUBLIC_API_BASE_URL` is missing. Shared data requests throw a clear API base configuration error, auth returns `api_base_unconfigured`, and paper order preview/submit/cancel returns a blocked `PAPER_ORDER_API_BASE_UNCONFIGURED` error instead of touching a wrong host.
- Behavior change: missing production API configuration is now BLOCKED, not fake-empty or localhost leakage. The dev fallback remains available only outside production.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; scan for the old unconditional `NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001"` pattern returned 0.
- Blockers: production deploy still requires `NEXT_PUBLIC_API_BASE_URL` set by environment. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 14:13 Taipei) - company detail diagnostics made readable
- Files changed: cleaned user-visible mojibake in `apps/web/app/companies/[symbol]/page.tsx` and `error.tsx`.
- Endpoints / data behavior: no endpoint contract changed. `/companies/:symbol` still uses real `GET /api/v1/companies` plus company OHLCV and keeps missing/failed data in BLOCKED or not-found states.
- Behavior change: API failure, ticker not found, back navigation, company header, and company error boundary now render readable diagnostics instead of corrupted text. This makes Bruce/Elva production smoke actionable when auth, workspace, API base, or backend errors occur.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; company page mojibake scan only returned legitimate nullish-coalescing code and industry dictionary Chinese strings.
- Blockers: none introduced. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 14:20 Taipei) - idea-to-ticket anchor repaired
- Files changed: added the missing `order-ticket` anchor wrapper in `apps/web/app/portfolio/page.tsx`.
- Endpoints / data behavior: no API contract changed. `SendToTicketButton` already writes a real local handoff and routes to `/portfolio#order-ticket`; the portfolio page now exposes that target around the real paper order ticket.
- Behavior change: clicking PAPER TICKET from an idea now lands on the actual paper order panel instead of only loading the portfolio page top. This preserves the paper-only Contract 1 flow without touching broker/live submit.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; hash-link scan confirms `/portfolio#order-ticket` has a matching `id="order-ticket"` target.
- Blockers: paper submit remains gated by preview/risk/quote endpoint responses. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 14:27 Taipei) - Market Intel category mapping tightened
- Files changed: updated `apps/web/app/market-intel/page.tsx` category badge mapping.
- Endpoints / data behavior: no endpoint contract changed. `/market-intel` still reads real company universe, paper ideas, and TWSE announcement endpoints.
- Behavior change: important-news rows now classify dividend, financial/revenue, and material-announcement categories with maintainable keyword sets instead of brittle legacy category fragments. Unknown categories remain neutral badges and are not invented.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; Market Intel mojibake scan returned 0.
- Blockers: TWSE announcement freshness remains API/data-source dependent. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 14:33 Taipei) - global frame fake run metadata removed
- Files changed: rewrote `apps/web/components/PageFrame.tsx` header metadata.
- Endpoints / data behavior: no endpoint contract changed. Shared page chrome no longer displays a hard-coded run id, scan timer, or stale fixed clock.
- Behavior change: all pages now show actual Taipei date/time plus `SESSION / REAL-DATA`; exec pages are labelled `EXEC LAYER / PAPER`. This removes decorative status text that looked operational but was not backed by real state.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; scan for `RUN-2026`, `T-06S`, `14:32:08`, and old live glyph text returned 0.
- Blockers: none introduced. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 14:39 Taipei) - sidebar labels and status wording cleaned
- Files changed: updated `apps/web/components/Sidebar.tsx`.
- Endpoints / data behavior: no endpoint contract changed. Sidebar remains navigation-only and does not claim live health state.
- Behavior change: nav subtitles are readable, INTEL stays visible, and the old static `PAPER ARMED` / `REV RADAR-0.8` wording is replaced by conservative `PAPER MODE / RISK GATED` and `Frontend / real-data lane`.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; sidebar scan for corrupted text fragments and stale RADAR/PAPER ARMED labels returned 0.
- Blockers: real kill-switch state remains visible on `/portfolio` and `/m/kill`, not in static sidebar chrome. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 14:44 Taipei) - frame timestamp wording clarified
- Files changed: refined `apps/web/components/PageFrame.tsx` metadata labels.
- Endpoints / data behavior: no endpoint contract changed. Shared chrome now labels the timestamp as `RENDERED` and separately shows read/paper mode, avoiding the impression of a live ticking clock on statically rendered routes.
- Behavior change: global frame metadata remains truthful on both dynamic and static pages: it reports render/build time, real-data session policy, and route mode.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web build` PASS; sequential `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS. Earlier parallel typecheck failed only because `.next/types` was being regenerated during build; rerun after build passed.
- Blockers: CI for `f272cb3` still in progress as of this cycle; previous CI/deploy runs green. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 14:50 Taipei) - auth footer fake version removed
- Files changed: updated `apps/web/app/login/page.tsx`.
- Endpoints / data behavior: no auth contract changed. Login still calls the real auth API and fails closed through `api_base_unconfigured` if the production API base is missing.
- Behavior change: the login footer no longer displays the static `RADAR-0.8` version-like label. It now describes the real auth session surface.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web build` PASS; sequential `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; scan for `RADAR-0.8`, old fake run id, and old scan timer in auth pages returned 0.
- Blockers: none introduced. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 15:00 Taipei) - local production smoke and CI closeout
- Files changed: evidence board only.
- Endpoints / data behavior: started latest web production build on local port 3002 for smoke, then stopped it. Used a fake local `iuf_session` cookie only to pass middleware and verify route rendering; no API secrets or live order endpoints touched.
- Behavior check: `/login`, `/market-intel`, `/portfolio`, `/quote?symbol=2330`, `/companies/2330`, and `/lab` all returned HTTP 200. With no local `NEXT_PUBLIC_API_BASE_URL`, `/market-intel` rendered honest BLOCKED state (`NEXT_PUBLIC_API_BASE_URL is not configured`) instead of fake news rows.
- Tests: local `pnpm.cmd --filter @iuf-trading-room/web build` PASS; sequential typecheck PASS before smoke. GitHub Actions: latest `1d3b507` CI success and Railway deploy success; preceding `1e48c98` CI/deploy success; older superseded deploy run cancelled by newer deploy, not a failure.
- Blockers: production data freshness still depends on Railway env and backend route health. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 15:07 Taipei) - document title cleaned
- Files changed: updated `apps/web/app/layout.tsx`.
- Endpoints / data behavior: no endpoint contract changed.
- Behavior change: browser title now uses `IUF Trading Room`; the old decorative separator is removed from metadata and the next/font comment is plain ASCII.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web build` PASS; sequential `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; layout scan for old separator/title fragments returned 0.
- Blockers: none introduced. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 15:15 Taipei) - company source status no longer overclaims Market Intel
- Files changed: updated `apps/web/app/companies/[symbol]/page.tsx`, `SourceStatusCard.tsx`, and `AnnouncementsPanel.tsx`.
- Endpoints / data behavior: no endpoint contract changed. Company detail still fetches company master/OHLCV server-side and announcements panel fetches `GET /api/v1/companies/:id/announcements?days=30` client-side.
- Behavior change: Source Status no longer marks Market Intel as LIVE just because the panel is mounted. It now marks that row STALE/panel-level and points users to panel [05], where the actual announcement request reports LIVE/EMPTY/BLOCKED. The source card title and detail separators were also made readable.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; company detail mojibake scan returned 0.
- Blockers: true announcement health remains owned by the TWSE announcement endpoint. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 15:20 Taipei) - OHLCV chart scan noise removed
- Files changed: updated `apps/web/app/companies/[symbol]/OhlcvCandlestickChart.tsx`.
- Endpoints / data behavior: no endpoint contract changed. Company page still filters out `source === "mock"` before chart rendering.
- Behavior change: removed stale mock/comment wording and old decorative separators from the OHLCV chart source badge helpers so automated truthfulness scans only flag the intentional server-side mock filter.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: none introduced. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 15:25 Taipei) - static post-close session label removed
- Files changed: updated `apps/web/components/PageFrame.tsx`.
- Endpoints / data behavior: no endpoint contract changed.
- Behavior change: non-exec page chrome no longer hard-codes `SESSION / POST-CLOSE`; it now reports `SESSION / REAL-DATA`, while exec pages remain `EXEC LAYER / PAPER`.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; scan for `POST-CLOSE`, old fake run id, old scan timer, and old static clock returned 0.
- Blockers: none introduced. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 15:32 Taipei) - company master panel labels made readable
- Files changed: rewrote `apps/web/app/companies/[symbol]/CompanyInfoPanel.tsx` labels and cleaned `CompanyHeroBar.tsx` quote metadata.
- Endpoints / data behavior: no endpoint contract changed. Company detail still uses real company master rows and real OHLCV-derived quote data only.
- Behavior change: company page [01] no longer renders corrupted label text; it now shows readable COMPANY MASTER, TICKER, MARKET, COUNTRY, CHAIN POSITION, exposure, validation, source, VOL, AS OF, and EMPTY states.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: none introduced. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 15:40 Taipei) - command palette state rows no longer pretend to be actions
- Files changed: updated `apps/web/components/CommandPalette.tsx`.
- Endpoints / data behavior: no endpoint contract changed. Palette still probes real themes, companies, paper ideas, and strategy runs.
- Behavior change: BLOCKED/EMPTY palette status rows now render as `role="note"` information rows instead of disabled buttons. Real navigation rows remain buttons and continue to route to actual pages.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: none introduced. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 15:48 Taipei) - unused decorative widget helpers removed
- Files changed: updated `apps/web/components/RadarWidgets.tsx`.
- Endpoints / data behavior: no endpoint contract changed.
- Behavior change: removed unused Sparkline/Pill/TimeText exports from the shared metric helper, leaving only the real-data metric strip helpers currently imported by production pages. This reduces dead decorative UI that could be mistaken for wired data later.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; import scan found no remaining Sparkline/Pill/TimeText consumers.
- Blockers: none introduced. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 15:55 Taipei) - unused block spark helper deleted
- Files changed: deleted `apps/web/lib/block-spark.ts`.
- Endpoints / data behavior: no endpoint contract changed.
- Behavior change: removed an unreferenced legacy sparkline helper with corrupted text/block glyphs. No visible route behavior changes; this prevents a dead decorative chart helper from being reintroduced into production data surfaces.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; import scan for `blockSpark` / `block-spark` returned 0.
- Blockers: none introduced. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 16:02 Taipei) - draft/review LIVE panels include freshness
- Files changed: updated `apps/web/app/admin/content-drafts/[id]/page.tsx`, `apps/web/app/admin/content-drafts/page.tsx`, `apps/web/app/drafts/page.tsx`, and `apps/web/app/reviews/page.tsx`.
- Endpoints / data behavior: no endpoint contract changed. Draft and review pages still read `GET /api/v1/content-drafts` and `GET /api/v1/reviews`.
- Behavior change: LIVE draft/review panels now show both source and Updated time, satisfying the 4-state rule for source + freshness instead of only showing row counts.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: none introduced. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 16:08 Taipei) - company paper order panel source text tightened
- Files changed: updated `apps/web/app/companies/[symbol]/PaperOrderPanel.tsx`.
- Endpoints / data behavior: no endpoint contract changed. The panel still calls paper-order preview/submit/ledger endpoints only and never broker/live routes.
- Behavior change: removed decorative middle-dot separators from the company paper-order source/ledger labels and made the source bar explicitly name the paper order ledger. This keeps Contract 1 visible as paper-only operational state, not styling text.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; scan for middle-dot/garbled separator in this panel returned 0.
- Blockers: none introduced. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 16:16 Taipei) - paper ledger zero rows classify as EMPTY
- Files changed: updated `apps/web/app/companies/[symbol]/PaperOrderPanel.tsx` and `apps/web/components/portfolio/OrderTicket.tsx`.
- Endpoints / data behavior: no endpoint contract changed. Both surfaces still read/preview/submit paper orders only through Contract 1 endpoints; no broker/live route is touched.
- Behavior change: paper order ledger headers now show EMPTY when the real ledger request succeeds with zero rows, instead of showing LIVE beside an empty ledger. Portfolio ticket handoff/TIF/preview labels also use plain ASCII separators.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS; scan for middle-dot/garbled separators in both paper order surfaces returned 0.
- Blockers: none introduced. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 15:04 Taipei) - dashboard market overview strip shows source freshness
- Files changed: updated `apps/web/app/page.tsx`.
- Endpoints / data behavior: no endpoint contract changed. Top dashboard metrics still derive from `GET /api/v1/market-data/overview`.
- Behavior change: dashboard market overview quote strip now renders the shared source/updatedAt line before LIVE/EMPTY/BLOCKED cards, so LIVE metric cards no longer stand alone without freshness/source evidence.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: none introduced. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 15:08 Taipei) - dashboard Market Intel shows partial coverage honestly
- Files changed: updated `apps/web/app/page.tsx`.
- Endpoints / data behavior: no endpoint contract changed. Dashboard Market Intel still fans out to `GET /api/v1/companies/:id/announcements?days=14` for selected company ids.
- Behavior change: if some announcement calls fail but others succeed, the dashboard now marks the source line as partial coverage. If successful calls return zero rows while some calls failed, EMPTY now says coverage is partial instead of claiming TWSE returned zero rows for the full selected set.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: none introduced. Announcement endpoint availability still belongs to Jason/Elva. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 15:10 Taipei) - Market Intel page exposes partial coverage and freshness
- Files changed: updated `apps/web/app/market-intel/page.tsx`.
- Endpoints / data behavior: no endpoint contract changed. The page still reads `GET /api/v1/companies`, optional strategy ideas, and selected company announcement calls through `GET /api/v1/companies/:id/announcements?days=30`.
- Behavior change: the standalone Market Intel page now shows Updated time in the source block. LIVE feeds with partial announcement-call failures display a visible PARTIAL note, and EMPTY state no longer claims full selected-universe zero news when some selected company calls failed.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: none introduced. Announcement endpoint availability still belongs to Jason/Elva. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 15:12 Taipei) - companies page removes static catalog count
- Files changed: updated `apps/web/app/companies/page.tsx`.
- Endpoints / data behavior: no endpoint contract changed. Companies page still reads `GET /api/v1/companies` client-side and derives KPI counts from the returned rows.
- Behavior change: removed the hard-coded `3470 symbols` text from page chrome and loading state. The visible count now comes only from the real API response.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: none introduced. PR #39 migration 0020 remains blocked by Mike/Pete P0 and was not touched. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 15:13 Taipei) - companies registry gets explicit 4-state source line
- Files changed: updated `apps/web/app/companies/page.tsx`.
- Endpoints / data behavior: no endpoint contract changed. Companies registry still reads `GET /api/v1/companies` client-side; the client-side ticker dedup remains visible as a temporary defensive banner until Jason replaces PR #39 migration 0020 with a safe v2.
- Behavior change: company registry now exposes LOADING/LIVE/EMPTY/BLOCKED state, source, updated time, and owner/detail for failed API calls. Empty API results show an EMPTY note instead of silently rendering an empty table.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: none introduced. PR #39 migration 0020 remains blocked by Mike/Pete P0 and was not touched. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 15:15 Taipei) - mobile brief hides non-live metric placeholders
- Files changed: updated `apps/web/app/m/page.tsx`.
- Endpoints / data behavior: no endpoint contract changed. Mobile brief still reads briefs, themes, paper ideas, market overview, and kill-switch state through existing read endpoints.
- Behavior change: `/m` no longer renders zero-valued market metrics when the combined mobile source is BLOCKED/EMPTY or when the market overview payload is absent. Theme and paper idea sections now render explicit EMPTY cards instead of blank sections.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: none introduced. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 15:16 Taipei) - dashboard market overview freshness uses API generatedAt
- Files changed: updated `apps/web/app/page.tsx`.
- Endpoints / data behavior: no endpoint contract changed. Dashboard still reads `GET /api/v1/market-data/overview`.
- Behavior change: when the market overview is LIVE and includes `generatedAt`, dashboard source freshness now uses the API payload timestamp instead of the SSR render/request time.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: none introduced. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 15:18 Taipei) - draft/review EMPTY and BLOCKED states include query freshness
- Files changed: updated `apps/web/app/briefs/page.tsx`, `apps/web/app/drafts/page.tsx`, `apps/web/app/reviews/page.tsx`, `apps/web/app/admin/content-drafts/page.tsx`, and `apps/web/app/admin/content-drafts/[id]/page.tsx`.
- Endpoints / data behavior: no endpoint contract changed. These pages still read `GET /api/v1/briefs`, `GET /api/v1/content-drafts`, and `GET /api/v1/reviews`.
- Behavior change: EMPTY/BLOCKED state panels now show the query timestamp beside source and reason, matching the LIVE panels' source/freshness behavior.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: none introduced. No stop-line touched: no broker write, no migration 0020, no Railway secrets, no live submit, no destructive DB action.
### Codex cycle (2026-05-01 15:21 Taipei) - portfolio fails closed when kill-switch state is unavailable
- Files changed: updated `apps/web/app/portfolio/page.tsx`.
- Endpoints / data behavior: no endpoint contract changed. Portfolio still reads paper trading, risk, and kill-switch endpoints for `paper-default`.
- Behavior change: missing backend kill-switch state now maps to `FROZEN` instead of `PEEK`, so the paper ticket fails closed when the portfolio snapshot is BLOCKED. Downstream positions/risk/orders/events panels show BLOCKED notes instead of `0 ROWS` when the snapshot is unavailable.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: none introduced. This remains paper-only UI; no live broker submit, migration 0020, Railway secrets, or destructive DB action touched.
### Codex cycle (2026-05-01 15:24 Taipei) - plans dependent panels no longer turn BLOCKED into EMPTY
- Files changed: updated `apps/web/app/plans/page.tsx`.
- Endpoints / data behavior: no endpoint contract changed. Plans still reads production plans plus briefs/reviews/signals/themes/companies and paper strategy ideas.
- Behavior change: when the combined plans context source is BLOCKED/EMPTY, dependent idea, brief, review, and signal panels now show BLOCKED instead of rendering emptyData as `0 ROWS` or EMPTY. True EMPTY notes are only shown after the source is LIVE.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: none introduced. No broker write, migration 0020, Railway secrets, live submit, or destructive DB action touched.
### Codex cycle (2026-05-01 15:26 Taipei) - portfolio top kill card reflects fail-closed state
- Files changed: updated `apps/web/app/portfolio/page.tsx`.
- Endpoints / data behavior: no endpoint contract changed.
- Behavior change: when no backend kill-switch payload is available, the top portfolio KILL card now shows `FROZEN` instead of `--`, matching the fail-closed order ticket and kill-switch panel behavior.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: none introduced. No broker write, migration 0020, Railway secrets, live submit, or destructive DB action touched.
### Codex cycle (2026-05-01 15:58 Taipei) - ops snapshot no longer renders blocked data as zero
- Files changed: updated `apps/web/app/ops/page.tsx`.
- Endpoints / data behavior: no endpoint contract changed. Ops still reads `GET /api/v1/ops/snapshot?auditHours=24&recentLimit=12`.
- Behavior change: when the ops snapshot is BLOCKED, KPI cells now show `--` instead of fake zero counts, and OpenAlice/latest/audit panels show BLOCKED notes rather than EMPTY or `0 ROWS`.
- Tests: `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS; `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- Blockers: none introduced. No broker write, migration 0020, Railway secrets, live submit, or destructive DB action touched.
