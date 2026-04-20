# Strategy Autopilot — Phase 2 Plan (2026-04-21)

> Author: Jason (backend-strategy lane)
> Status: Plan only — zero code, zero commit
> Requires: Elva review + 楊董approval before any Phase 2 code starts
> Prerequisite: Phase 1 commit `0c81f3e` merged + CI green

---

## Executive Summary

Phase 1 shipped `POST /api/v1/strategy/runs/:id/execute` with dryRun/live paths, sidePolicy filtering, fixed_pct sizing, and kill-switch integration. 73 CI tests green. Phase 2 addresses the two known deviations from the original plan and extends the autopilot surface to cover real-world Taiwan market constraints.

**The single recommended Phase 2 first-round scope: (a) TWSE/TPEX lotSize real-ization.** It is the highest user-value item with the lowest cross-lane risk, directly unblocking real Taiwan equity trading. Session layer true-ization is second priority but has higher effort and requires a product decision about UI exposure. Real-submit gating and policy expansion are valuable but can follow.

---

## A. Phase 1 Deviation Audit

### A1. Phase 1 Plan vs. Reality

| Item | Plan Said | Reality | Impact |
|------|-----------|---------|--------|
| `lotSize` | Derive from market, TWSE = 1000 | Hardcoded `lotSize = 1` in `deriveQuantity` call | TWSE orders produce 1-share quantities instead of 1-lot (1000 shares). Non-blocking for paper market `"OTHER"` but wrong for real TWSE tickers |
| Session layer | "Phase 2 4-layer risk: session ✅" in team_memory | No persistent store, no CRUD, no auto-engage. `evaluateRiskCheck` never populates `sessionOverride` | Session guards never fire in production. Kill-switch (account layer) is the live safety net |
| `sizeMode: "equal_weight"` | Listed in enum, future use | Schema exports it but engine ignores it — `executeStrategyRun` only reads `sizePct` regardless of `sizeMode` | equal_weight behavior is a no-op; must not be advertised as active in UI |
| Test count | "2–3 deterministic autopilot tests" | 2 shipped (dryRun shape + kill-switch halts); 4 more added in overnight hardening | Green; over-delivered |
| Smoke entry | 1 autopilot smoke | Delivered | Green |

### A2. Carry-Forward Items for Phase 2

1. **TWSE lotSize = 1000** — must be addressed before any live TWSE paper trading
2. **Session layer stub** — must be clarified as "stub" in all documentation; true-ization is a separate phase
3. **`equal_weight` sizeMode** — either implement or remove from schema enum

---

## B. Phase 2 Scope Candidates

### B1. Candidate (a): TWSE/TPEX/US lotSize Table

**Description**: Replace the hardcoded `lotSize = 1` in `deriveQuantity` with a market-to-lotSize lookup. Add a `getLotSize(market: string): number` pure function. Update `executeStrategyRun` to pass correct lot size based on idea's `market` field.

**Priority**: HIGH — directly enables real Taiwan equity autopilot
**Effort**: Small (0.3–0.5 rounds). Pure function, no schema change, no new endpoints.
**Risk**: Low. Change is isolated to `strategy-engine.ts`. No contracts change. No frontend impact.
**User value**: HIGH. A TWSE position at price 50 TWD with equity 100,000 TWD:
  - Current (lotSize=1): quantity = floor(1000 / 50) = 20 shares → wrong (below 1 lot)
  - After (lotSize=1000): quantity = floor(1000 / 50) = 0 lots → blocked as quantity_zero (safe); with larger equity, produces correct lot-aligned quantity
  
**Rollback**: Revert the `getLotSize` function and `lotSize` argument in `deriveQuantity` call. No migration needed (pure function, no DB).

**Change set:**

| File | Change |
|------|--------|
| `apps/api/src/strategy-engine.ts` | Add `getLotSize(market)` pure function; update `deriveQuantity` call to pass `lotSize: getLotSize(idea.market)` |
| `tests/ci.test.ts` | Add 2 tests: TWSE lot rounding (quantity floors to lot multiple) + US lot=1 pass-through |

**lotSize table (initial):**

| Market | lotSize | Source |
|--------|---------|--------|
| `"TWSE"` | 1000 | TWSE exchange rule |
| `"TPEX"` | 1000 | TPEX (same rule as TWSE) |
| `"NASDAQ"` | 1 | US equities: fractional allowed at broker level |
| `"NYSE"` | 1 | US equities |
| `"OTHER"` | 1 | Default fallback |
| `""` or unknown | 1 | Safe default |

---

### B2. Candidate (b): Session Layer True-ization

**Description**: Implement a persistent session risk layer. A "session" represents a bounded trading period (e.g., "Morning session 09:00–12:00") with its own risk limits that stack on top of account/strategy/symbol limits. Requires:
1. A `sessions` store with file-backed persistence (like `risk-engine.ts` pattern)
2. CRUD API endpoints: `GET /api/v1/risk/sessions`, `POST /api/v1/risk/sessions`, `DELETE /api/v1/risk/sessions/:id`
3. `evaluateRiskCheck` to auto-populate `sessionOverride` from the active session store
4. Auto-engage: determine "current active session" from time range

**Priority**: MEDIUM — correctness gap but not blocking immediate autopilot use
**Effort**: Large (1–1.5 rounds). New persistent store, new CRUD routes, time-range logic, auto-engage wiring.
**Risk**: MEDIUM. Touches `risk-engine.ts` (not Jason's lane). Requires Elva to open risk lane. Time-range logic needs careful handling for timezone (Taiwan CST vs UTC).
**User value**: MEDIUM. Adds intraday loss cap per session (e.g., "stop trading if morning session down 2%"). Currently this protection is absent.

**Rollback**: Delete session store file. Remove routes from `server.ts`. Revert `evaluateRiskCheck` change. All additive — no migration.

**Change set:**

| File | Change | Lane |
|------|--------|------|
| `apps/api/src/risk-engine.ts` | Add session store, `upsertSessionRiskLimit`, `getActiveSession`, auto-engage in `evaluateRiskCheck` | RISK LANE — needs Elva approval |
| `packages/contracts/src/risk.ts` | Add `sessionRiskLimitSchema`, `sessionRiskLimitInputSchema` | RISK LANE |
| `apps/api/src/server.ts` | Add session CRUD routes | Shared |
| `tests/ci.test.ts` | Add session layer tests | Jason lane |

**Cross-lane warning**: Modifying `risk-engine.ts` and `risk.ts` is outside Jason's lane. Elva must explicitly open the risk lane for this scope.

---

### B3. Candidate (c): Real Submit Path — Two-Step Confirm Gate

**Description**: Add a UI-facing two-step flow so `dryRun: false` is never reachable from a single button press. The preflight call (dryRun: true) must complete first and show the user a preflight summary; a second explicit confirm call (dryRun: false) then proceeds. This is a backend contract + frontend coordination change.

**Priority**: MEDIUM-HIGH — user safety. A single misclick on `dryRun: false` would submit real (paper) orders.
**Effort**: Small-medium (0.3 rounds backend; frontend effort is separate Jim lane).
**Risk**: Low on backend (no schema break needed — can be a new optional `confirmToken` field). Medium on frontend coordination.
**User value**: HIGH for safety UX. Prevents accidental live submission.

**Proposed mechanism**: 
1. Backend adds optional `confirmToken?: string` to `autopilotExecuteInputSchema`
2. If `dryRun: false` and no `confirmToken`, route rejects with 400 `"confirm_token_required"` + preflight summary
3. If `dryRun: false` and valid `confirmToken` (short-lived HMAC, 60-second TTL), proceed
4. Frontend: first call gets 400 + preflight, shows confirm modal, second call includes token

**Rollback**: Remove `confirmToken` field from contract. Route falls back to current behavior. No DB.

**Change set:**

| File | Change | Lane |
|------|--------|------|
| `packages/contracts/src/strategy.ts` | Add optional `confirmToken?: string` to `autopilotExecuteInputSchema` | Jason lane |
| `apps/api/src/strategy-engine.ts` | Add `generateConfirmToken()` / `validateConfirmToken()` helpers | Jason lane |
| `apps/api/src/server.ts` | Add token validation logic in execute route | Jason lane |
| `apps/web/lib/api.ts` | Add confirm-token flow | JIM LANE |

**Note**: Adding `confirmToken` is additive and optional — no breaking change to existing contract shape.

---

### B4. Candidate (d): Autopilot Policy Expansion

**Description**: Implement additional behaviors in `executeStrategyRun`:
1. `stop_on_error` policy: if any symbol errors, abort remaining candidates
2. `skip_on_cap` policy: if a symbol is already position-capped (risk block = `max_per_trade`), silently skip rather than count as blocked
3. `sizeMode: "equal_weight"`: divide a fixed budget equally across N eligible ideas
4. More granular `blockedReason` values: distinguish `risk_max_per_trade` vs `risk_concentration` vs `kill_switch`

**Priority**: LOW-MEDIUM — refinement, not blocking
**Effort**: Small-medium (0.5 rounds). All changes confined to `strategy-engine.ts`.
**Risk**: Low. Pure behavior changes, no schema break (blockedReason is a string, not enum).
**User value**: MEDIUM. `equal_weight` is in the contract enum already; shipping it as a no-op is misleading.

**Rollback**: Revert `strategy-engine.ts` changes. No DB, no schema break.

**Change set:**

| File | Change |
|------|--------|
| `apps/api/src/strategy-engine.ts` | Implement equal_weight sizing, stop_on_error logic, skip_on_cap logic |
| `packages/contracts/src/strategy.ts` | Add `stopOnError?: boolean`, `skipOnCap?: boolean` to `autopilotExecuteInputSchema` |
| `tests/ci.test.ts` | Add policy expansion tests |

---

## C. Cross-Lane Impact Analysis

| Scope | Contracts change | Frontend impact | Bruce verify sequence | Risk lane |
|-------|-----------------|-----------------|----------------------|-----------|
| (a) lotSize | No | None — same API surface | Add TWSE lot-size smoke test | No |
| (b) Session layer | Yes — `risk.ts` | Possible: session config UI | Add session CRUD verify | YES — must open |
| (c) Confirm gate | Yes — `strategy.ts` optional field | YES — Jim must add confirm modal | Add confirm-token flow verify | No |
| (d) Policy expansion | Minor — `strategy.ts` optional fields | Minor — expose new options in execute panel | Add policy tests | No |

---

## D. Rollback Table

| Scope | Revert method | Data loss risk |
|-------|---------------|----------------|
| (a) lotSize | Revert 2–3 lines in `strategy-engine.ts` | None |
| (b) Session layer | Delete `runtime-data/risk/sessions.json`, revert code | Session config data lost (acceptable — it's a new store) |
| (c) Confirm gate | Remove `confirmToken` field, revert route logic | None |
| (d) Policy expansion | Revert `strategy-engine.ts` | None |

---

## E. Phase 2 First-Round Recommendation

**Recommended first round: Candidate (a) — TWSE/TPEX lotSize real-ization.**

### Reasoning

1. **Highest immediate correctness value** — Any attempt to paper-trade a real TWSE ticker (e.g., 2330 TSMC, 2454 MediaTek) with the current `lotSize=1` produces a 1-share order, which is below the minimum exchange lot and would be rejected by a real broker. This is a correctness bug, not a cosmetic gap.

2. **Lowest cross-lane risk** — The change is 100% inside Jason's lane (`strategy-engine.ts` + tests only). No contracts change, no frontend change, no risk-lane open needed.

3. **Quick to ship** — Estimated 0.3–0.5 rounds: 1 pure function, 1 call-site change, 2–3 tests. Bruce verify: 1 smoke entry update.

4. **Unblocks Bruce Wave 2 TWSE test** — Bruce can verify TWSE autopilot behavior (expected: quantity_zero block if equity too small, OR correct lot-aligned quantity) before real market data is wired.

5. **Does not require 楊董 approval gate** — Pure backend refinement within existing autopilot scope. No new destructive surfaces, no schema break.

### Trade-offs accepted

- Session layer stub remains unfixed. Kill-switch remains the only intraday safety net. Acceptable for Phase 2 paper-only context.
- `equal_weight` sizeMode remains a no-op in the engine (enum value exists but behavior not implemented). Should be addressed in a follow-on (candidate d) or removed from the schema enum before UI exposes it.
- Confirm gate (candidate c) is deferred. The current UX risk is acceptable because dryRun=false is not yet exposed in the frontend — Jim's Phase 1 frontend only calls dryRun=true. Gate should be added before Jim wires the "confirm execute" button.

### Suggested second round

After (a), the recommended sequence is: **(c) confirm gate** before Jim ships the execute button, then **(d) policy expansion** (specifically equal_weight) to honor the exported enum, then **(b) session layer** as a standalone risk-lane round with Elva present.

---

## F. Forbidden Items (Hardcoded Out of Scope)

The following will NOT be part of Phase 2 regardless of request:

- **KGI adapter** — Not Jason's lane. Elva must explicitly assign a broker-lane agent.
- **Execution core rewrite** — `trading-service.ts`, `paper-broker.ts`, `execution-gate.ts` work correctly. No rewrite.
- **Scheduler / cron / event loop** — Auto-trigger autopilot is Phase 3+ and requires `StrategyConfig.autoTrade` product decision and session-layer hardening first.
- **AI/ML sizing** — Out of scope until the core lot-size and session layers are stable.
- **Real money broker** — Gated behind 楊董 explicit authorization regardless of phase.

---

## G. Files Expected to Change Per Scope

### (a) lotSize — Expected file changes

| File | Nature | Lines est. |
|------|--------|-----------|
| `apps/api/src/strategy-engine.ts` | +`getLotSize()` pure function; update `deriveQuantity` call site | +15–25 |
| `tests/ci.test.ts` | +TWSE lot-rounding test + US lot pass-through test | +80–120 |

### (b) Session layer — Expected file changes (risk lane required)

| File | Nature | Lines est. |
|------|--------|-----------|
| `apps/api/src/risk-engine.ts` | +session store + CRUD functions + auto-engage in evaluateRiskCheck | +150–200 |
| `packages/contracts/src/risk.ts` | +session schemas + types | +40–60 |
| `apps/api/src/server.ts` | +session CRUD routes | +40–60 |
| `tests/ci.test.ts` | +session layer tests | +100–150 |

### (c) Confirm gate — Expected file changes

| File | Nature | Lines est. |
|------|--------|-----------|
| `packages/contracts/src/strategy.ts` | +optional `confirmToken` field | +5–10 |
| `apps/api/src/strategy-engine.ts` | +token generate/validate helpers | +30–40 |
| `apps/api/src/server.ts` | +token gate in execute route | +20–30 |
| `tests/ci.test.ts` | +confirm-token tests | +60–80 |

### (d) Policy expansion — Expected file changes

| File | Nature | Lines est. |
|------|--------|-----------|
| `packages/contracts/src/strategy.ts` | +optional policy fields | +10–20 |
| `apps/api/src/strategy-engine.ts` | +equal_weight sizing + stop_on_error + skip_on_cap | +50–80 |
| `tests/ci.test.ts` | +policy tests | +100–150 |

---

## H. Risk Register

| Risk | Likelihood | Severity | Mitigation |
|------|-----------|----------|------------|
| TWSE lot-size logic produces wrong lot count for fractional-lot brokers | Low | Medium | lotSize table is a pure lookup; add regression test for boundary cases |
| Session layer auto-engage fires during wrong time window (timezone bug) | Medium | High | Use UTC internally; convert to CST only at display layer; add test for midnight crossover |
| Confirm token replay attack (same token used twice) | Medium | Low | Track used tokens in-memory set with TTL eviction; acceptable for paper-only scope |
| equal_weight divides by zero if eligible list is empty | High | Low | Guard already exists: `if (eligible.length === 0)` early return |
| TWSE lot change not reflected in `getLotSize` | Low | Low | Table is a constants file; add comment linking to TSE spec |

---

## I. Dependency Map

```
Phase 2 Scope  →  Depends on
─────────────────────────────────
(a) lotSize    →  Phase 1 shipped ✅ (no deps)
(c) gate       →  Phase 1 shipped ✅ + Jim frontend planning ✅
(d) policy     →  Phase 1 shipped ✅
(b) session    →  Phase 1 shipped ✅ + Elva opens risk lane
```

None of the Phase 2 scopes depend on each other. They can be executed in any order.

---

## J. Bruce Verify Sequence (by scope)

### (a) lotSize verify
1. Start API locally
2. Create a company with `market: "TWSE"`, add bullish signal, add quote at price 100
3. POST execute with `sizePct: 1.0` (equity 100_000 → 1000 TWD budget → 10 lots expected at price 100)
4. Assert `quantity` in result is a multiple of 1000
5. Create a company at price 999_999 → assert `blockedReason: "quantity_zero"` (correct floor behavior)

### (c) gate verify
1. POST execute with `dryRun: false` and no `confirmToken` → expect 400 + `confirm_token_required`
2. Parse token from response, POST again with token → expect normal execute response
3. POST again with same token (replay) → expect 400 + `token_expired_or_used`
4. POST with expired token (>60s old) → expect 400 + `token_expired_or_used`

### (d) policy verify
1. POST execute with `sizeMode: "equal_weight"` → verify quantities sum to budget / N (not fixed_pct)
2. POST execute with `stopOnError: true`, second symbol throws → verify only first symbol processed
3. POST execute with `skipOnCap: true`, risk blocks with `max_per_trade` → verify not in blocked[]

---

*End of Phase 2 Plan — 楊董 review required before code starts.*
