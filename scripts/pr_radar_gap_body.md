## Summary

Closes the 5 force-MOCK gaps in PR #21 (`feat/radar-fullsite-cutover`) that prevented live backend calls from RADAR.
See `evidence/path_b_w2a_20260426/pr21_api_gap.md` for the full gap audit.

---

## Items from pr21_api_gap.md (verbatim)

1. **`POST /api/v1/paper/orders/preview`** — same body schema as `/api/v1/paper/orders`, returns `OrderPreview` (size/price/fees breakdown, no side-effects). Pure calculation, no DB write.
2. **`GET /api/v1/strategy/runs/:id/ideas`** — returns `Idea[]` filtered by run.
3. **`GET /api/v1/ops/activity`** — returns `ActivityEvent[]` (recent system activity feed).
4. **Schema reconciliation** for `BriefBundle` / `ReviewBundle` / `WeeklyPlan` — backend has `/api/v1/briefs` + `/api/v1/reviews` but bundle shapes differ from RADAR consumer. Either:
   - Add thin adapter routes `/api/v1/plans/{brief,review,weekly}` that wrap the existing handlers and reshape to the RADAR-expected envelope, OR
   - Update RADAR types to match existing shapes and adjust callers.
   Pick whichever is less invasive — your call. Document the choice in the PR.
5. **Kill-switch body adapter** — backend is `POST /api/v1/risk/kill-switch` with `killSwitchInputSchema` body; RADAR sends `{ mode }`. Either:
   - Add `POST /api/v1/portfolio/kill-mode` thin adapter route that translates `{ mode }` → `killSwitchInputSchema` and calls `setKillSwitchState`, OR
   - Refactor `radar-api.killMode()` to call the existing route with the schema-shaped body.
   **HARD LINE**: this PR MUST NOT toggle the kill-switch state in any test, fixture, or migration. The route handler ARMS preserved.

---

## Implementation Decisions

### Item 1 — `POST /api/v1/paper/orders/preview`
Accepts `paperOrderCreateInputSchema` body (same as `POST /api/v1/paper/orders`). Translates
paper fields → `OrderCreateInput` then calls `previewOrder()` from `broker/trading-service.ts`
(commit:false — no idempotency registration, no Order row created). Returns `SubmitOrderResult`
envelope `{ data: { order: null, riskCheck, quoteGate, blocked } }`.

### Item 2 — `GET /api/v1/strategy/runs/:id/ideas`
Loads the persisted run via `getStrategyRunById()` and returns `run.items` (already typed as
`StrategyIdea[]`). No re-computation. Returns 404 if run not found.

### Item 3 — `GET /api/v1/ops/activity`
Thin adapter over `listAuditLogEntries()`. Maps each `AuditEntry` to `ActivityEvent`:
- `id` / `ts` (createdAt) / `source: "api"` (all audit entries are API-layer)
- `severity`: `5xx → ERROR`, `4xx → WARN`, rest `→ INFO`
- `event`: `"{method}.{path-without-prefix}"` slug

### Item 4 — Schema reconciliation (`BriefBundle` / `ReviewBundle` / `WeeklyPlan`)
**Decision: Option A — add thin adapter routes `/api/v1/plans/{brief,review,weekly}`.**

Rationale: `BriefBundle` requires composing briefs + ideas + positions + risk-limits into a
single envelope — a non-trivial assembly. Changing RADAR types to match raw DB rows would
require updating every consumer page. The adapter routes return the RADAR-expected envelope
shape with empty composite arrays (`topThemes`, `ideasOpen`, `watchlist`, `riskTodayLimits`),
plus `_raw` (the latest brief row) so consumers can access source data. Full composition is
a follow-up. This unblocks RADAR from force-MOCK immediately.

### Item 5 — Kill-switch body adapter
**Decision: Option A — add `POST /api/v1/portfolio/kill-mode` thin adapter.**

RADAR `KillMode` → backend `killSwitchStateSchema.mode` mapping:
| RADAR | Backend |
|---|---|
| `ARMED` | `trading` |
| `SAFE` | `halted` |
| `PEEK` | `paper_only` |
| `FROZEN` | `liquidate_only` |

HARD LINE maintained: no test or fixture calls this adapter; the handler only translates bodies
and calls `setKillSwitchState`. Kill-switch state machine in `risk-engine.ts` is untouched.

---

## Files Changed

- `apps/api/src/server.ts` — 5 new routes added before `serve()` block
- `tests/ci.test.ts` — 5 new unit tests for items 1, 2, 3 (items 4/5 are structural/mapping)

---

## Hard Lines Preserved

- `/order/create` permanent 409: NOT touched
- Kill-switch backend state machine: NOT changed
- No KGI gateway code touched
- No live broker code touched
- No DB migration added

---

## Test Plan

- [ ] `pnpm -w typecheck` — no new errors
- [ ] `pnpm --filter @iuf-trading-room/api test` — all tests pass (was 112, now 117)
- [ ] Bruce verifies: `GET /api/v1/strategy/runs/:id/ideas` returns 200 with `{ data: [] }` for a valid run
- [ ] Bruce verifies: `POST /api/v1/paper/orders/preview` returns 200 with `{ data: { order: null, ... } }`
- [ ] Bruce verifies: `GET /api/v1/ops/activity` returns 200 with `{ data: [] }` in memory mode
- [ ] Bruce verifies: RADAR `ideasByRun`, `opsActivity`, `previewOrder`, `brief`, `review`, `weeklyPlan`, `killMode` are unMOCKed after radar-api.ts update (separate RADAR PR)

---

## Next Steps (not in this PR)

- RADAR `radar-api.ts` update: remove `mockOnly()` wrappers for the 5 items and wire live fetch calls
- Full `BriefBundle` composition (assemble from briefs + strategy ideas + positions)
- `WeeklyPlan` persistence (currently returns empty stub)

---

Generated: 2026-04-29 by Jason (backend-strategy lane)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
