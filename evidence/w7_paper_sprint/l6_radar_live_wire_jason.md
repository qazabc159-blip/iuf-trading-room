# W7 L6 — RADAR Live-Wire Bundle (F1+F2+F3+F4)

**Author**: Jason (backend-strategy lane)
**Date**: 2026-04-30
**Branch**: `feat/w7-l6-radar-live-wire`
**Base**: `main` (`7a473ec`)
**PR**: feat(w7-l6): radar live-wire bundle (F1+F2+F3+F4)

---

## Files Changed

| File | Change |
|------|--------|
| `apps/api/src/server.ts` | F2: fixed BriefBundle compose, ActivityEvent.summary, ReviewBundle/WeeklyPlan types; F3: added /api/v1/reviews/log |
| `apps/web/lib/radar-api.ts` | F1: replaced 7 mockOnly() calls with real fetch; 1 (killMode) kept mockOnly per hard line |
| `apps/web/lib/radar-uncovered.ts` | F3: reviewLog() now calls /api/v1/reviews/log instead of /api/v1/openalice/jobs |
| `apps/api/src/__tests__/radar-live-wire.test.ts` | NEW: 8 unit tests for T1-T8 |
| `apps/web/components/content-drafts-queue.tsx` | F4: DELETED (0 importers confirmed) |

---

## F1 — radar-api.ts mockOnly() Replacements

**Root cause**: 7 of 8 `mockOnly()` call sites in `api` object had real backend routes added by PR #22 or earlier, but `radar-api.ts` was not updated to wire them. Frontend remained on permanent mock mode.

**Fix**: Replaced `mockOnly<T>(fallback)` with `get<T>(path, fallback)` for each:

| Method | Old path | New path | Notes |
|--------|----------|----------|-------|
| `company(s)` | mockOnly | `GET /api/v1/companies` + client-side filter by symbol | No :symbol endpoint — fetch all, find by symbol |
| `ideasByRun(id)` | mockOnly | `GET /api/v1/strategy/runs/:id/ideas` | Added PR #22 Item 2 |
| `opsActivity()` | mockOnly | `GET /api/v1/ops/activity` | Added PR #22 Item 3 |
| `brief()` | mockOnly | `GET /api/v1/plans/brief` | Added PR #22 Item 4, composed W7 L6 |
| `review()` | mockOnly | `GET /api/v1/plans/review` | Added PR #22 Item 4 |
| `weeklyPlan()` | mockOnly | `GET /api/v1/plans/weekly` | Added PR #22 Item 4 |
| `previewOrder(t)` | mockOnly | `POST /api/v1/paper/orders/preview` | Added PR #22 Item 1 |
| `killMode(mode)` | **KEPT mockOnly** | — | HARD LINE: kill-switch ARMED state machine must not be toggled from UI |

**Fallback semantics preserved**: All use `get<T>(path, fallback)` where fetch failure falls back to mock in dev, throws in prod (IS_PROD=true). The `killMode` exception is intentional per hard line audit.

---

## F2a — BriefBundle Compose

**Root cause**: `apps/api/src/server.ts` `/api/v1/plans/brief` returned `market: string` (wrong type — should be `MarketState` object) and empty `unknown[]` arrays for all other fields.

**Fix**:
1. `market: MarketState` — `composeTaiwanMarketState()` function derives from UTC wall-clock + 8h offset. Session boundary math: pre-open 08:30, open 09:00, midday 13:30, post-close 13:35+.
2. `topThemes: Theme[]` — calls `repo.listThemes()`, maps `BackendTheme → RADAR Theme`. Lifecycle→lockState: Discovery=WATCH, Validation=TRACK, Expansion/Crowded=LOCKED, Distribution=STALE. Heat proxy: `100 - priority*18`. Pulse = `Array(7).fill(heat)`.
3. `ideasOpen: Idea[]` — calls `getStrategyIdeas(limit=10)`, maps `StrategyIdea → RADAR Idea`. Direction: bullish=LONG, bearish=SHORT, neutral=EXIT. Quality: score≥66→HIGH, ≥33→MED, else LOW. themeCode from `idea.topThemes[0]?.name`.
4. `watchlist: WatchlistItem[]` — empty typed `[]` (no backing table).
5. `riskTodayLimits: RiskLimit[]` — calls `getRiskLimitState(accountId="paper-default")`, maps 3 key limits: MAX·TRADE %, MAX·SYMBOL %, MAX·GROSS %.

All fields match `radar-types.ts BriefBundle` exactly. Parallel fetch via `Promise.all([listThemes, getStrategyIdeas, getRiskLimitState])`.

---

## F2b — ActivityEvent.summary

**Root cause**: `ops/activity` handler returned `actor` and `detail` fields which are not in `radar-types.ts ActivityEvent`. Missing required `summary: string` field.

**Fix**: Removed `actor`/`detail`, added `summary` derived as `"${role ?? 'system'} ${METHOD} ${path}".trim()`. Truncated to ≤140 chars with `...`.

---

## F2c — ReviewBundle / WeeklyPlan Typed Arrays

**Root cause**: `trades: unknown[]`, `signalsSummary: unknown[]`, `themeRotation: unknown[]`, `strategyTweaks: unknown[]` — untyped arrays that would fail Zod parse.

**Fix**: Replaced with explicit TypeScript typed empty arrays matching `radar-types.ts` shapes exactly.

---

## F3 — GET /api/v1/reviews/log

**Root cause**: `radarUncoveredApi.reviewLog()` called `/api/v1/openalice/jobs` which returns OpenAlice job objects (completely wrong shape). Graceful fallback to `mockReviewLog` hid the issue.

**Fix**:
- Added `GET /api/v1/reviews/log` route in `server.ts`.
- Sources from `listAuditLogEntries()` (no new table needed).
- Maps: `id`, `ts=createdAt`, `reviewer=role??system`, `action=status<400?"ACCEPT":"REJECT"`, `itemId=entityId`.
- Returns `{ data: ReviewLogItem[] }` — exact `radar-types.ts` shape.
- Updated `radar-uncovered.ts` to call `/api/v1/reviews/log` instead of `/api/v1/openalice/jobs`.

---

## F4 — content-drafts-queue.tsx Deletion

**Root cause**: Component was an orphan — replaced by RADAR inline components. Zero importers confirmed by grep across monorepo.

**Grep result**: 0 hits for `content-drafts-queue` in any `.ts`, `.tsx`, `.js` source file. Only mentions in evidence docs and a stale worktree.

**Fix**: Deleted `apps/web/components/content-drafts-queue.tsx`.

---

## Tests (T1-T8)

File: `apps/api/src/__tests__/radar-live-wire.test.ts`

| Test | Coverage |
|------|----------|
| T1 | `composeTaiwanMarketState()` has all required MarketState keys |
| T2 | state is one of 4 valid session strings |
| T3 | countdownSec is non-negative finite number |
| T4 | `backendThemeToRadar` lifecycle→lockState mapping |
| T5 | heat proxy: priority 1 → heat ≥ 50 |
| T6 | pulse is array of exactly 7 numbers |
| T7 | ActivityEvent.summary non-empty, actor/detail absent |
| T8 | ReviewLogItem shape: id/ts/reviewer/action/itemId all present and typed |

Run: `node --test --import tsx/esm apps/api/src/__tests__/radar-live-wire.test.ts`

---

## Hard Line Audit

| Hard Line | Status |
|-----------|--------|
| /order/create 409 not touched | PASS — no order-create changes |
| kill-switch ARMED state machine not touched | PASS — killMode kept mockOnly |
| no KGI SDK import in apps/api | PASS — no KGI imports added |
| all paper / read-only (F2 plans handlers no mutation) | PASS — handlers are GET only |
| no migration 0017 | PASS — no migrations touched |
| no secret_inventory.md / Cat-D 13 files | PASS — not touched |

---

## Follow-up Notes

1. `watchlist` remains empty `[]` — no backing table. If 楊董 wants watchlist data, needs new DB table + migration.
2. `futuresNight` and `usMarket.last` return `0` (stale stubs) — real values require KGI quote feed or market-data integration for futures/US indices.
3. `killMode` remains `mockOnly` — operator-gate review needed before wiring to real kill-switch.
4. `company(s)` fetches ALL companies then filters client-side — acceptable for now (small dataset), but would benefit from backend `?symbol=` query param in future.
5. `previewOrder` backend returns `SubmitOrderResult` not `OrderPreview` — shape mismatch. In dev, frontend gets backend shape. Full mapping adapter tracked as follow-up.
