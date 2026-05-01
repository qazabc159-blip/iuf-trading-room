# Session Layer Risk Schema Design — 4th Risk Layer

**Date**: 2026-05-01 13:55 Taipei (W7 paper sprint Day 2, 勞動節休市)
**Author**: Elva
**Scope**: Design-only (no code changes). Implementation gated on 楊董 ACK.
**Status**: DRAFT — review against existing 3-layer risk in `apps/api/src/risk-engine.ts` + persist via `risk-store.ts`.

---

## 0. Why this matters now

P1-5 in the institutional roadmap was wrong: risk persistence is **already** file-backed (`apps/api/src/risk-store.ts:1-64`, atomic tmp→rename, `RAILWAY_VOLUME_MOUNT_PATH ?? "/data"`, `hydrateRiskEngine(state)` rehydrates 4 stores on boot). Memory entry will be corrected.

The real gap is the **4th layer** the architecture promised but never implemented: **Session layer**. Today the risk engine has 3 layers operational:

| Layer | Source | State |
|---|---|---|
| 1. Account | `RiskLimit` (`riskLimitsStore`) | LIVE + persisted |
| 2. Strategy | `StrategyRiskLimit` (`strategyRiskLimitsStore`) | LIVE + persisted |
| 3. Symbol | `SymbolRiskLimit` (`symbolRiskLimitsStore`) | LIVE + persisted |
| **4. Session** | **(missing)** | **NOT IMPLEMENTED** |

Institutional-grade risk requires intra-day session-level circuit breakers — independent of account/strategy/symbol caps — to enforce: open-to-close gross exposure, daily loss circuit breaker, intraday order-rate ceilings that reset at session close.

Without it: an operator can pile multiple strategies into the same window, each individually under cap, and exceed the desk's intra-day risk envelope.

---

## 1. Layer-4 contract surface

### 1.1 New entity: `SessionRiskLimit`

```typescript
// packages/contracts/src/risk.ts (new addition)
export interface SessionRiskLimit {
  id: string;                          // uuid
  workspaceSlug: string;               // tenant scope
  accountId: string;                   // typically "paper-default"
  sessionDate: string;                 // YYYY-MM-DD (Taipei calendar day)
  // — caps —
  maxIntradayGrossExposureNtd: number; // sum |notional| of FILLED+ACCEPTED at any point
  maxIntradayRealizedLossNtd: number;  // circuit breaker on realized P&L (negative)
  maxIntradayUnrealizedLossNtd: number;// circuit breaker on unrealized (mark-to-quote)
  maxOrdersPerSession: number;         // total order intents accepted today
  maxFillsPerSession: number;          // total filled orders today
  // — soft thresholds (warn but allow) —
  warnGrossExposureNtd: number;
  warnRealizedLossNtd: number;
  // — flags —
  haltOnBreach: boolean;               // if true, breach → kill_switch session-scoped
  resetAtMarketOpen: boolean;          // default true; counters reset at 09:00 Taipei
  // — provenance —
  createdAt: string;                   // ISO
  updatedAt: string;
  updatedBy: string;                   // userId
  reason: string;                      // free-text justification
}

export interface SessionRiskCounters {
  // Live counters — recomputed from ledger on boot, then incremented in-memory.
  workspaceSlug: string;
  accountId: string;
  sessionDate: string;
  grossExposureNtd: number;
  realizedPnlNtd: number;              // negative when loss
  unrealizedPnlNtd: number;            // mark-to-quote
  ordersAccepted: number;
  ordersFilled: number;
  lastUpdatedAt: string;
}
```

### 1.2 New guard kinds (extend `RiskGuardKind`)

```typescript
type RiskGuardKind =
  | ...existing...
  | "session_gross_exposure"           // exceeds maxIntradayGrossExposureNtd
  | "session_realized_loss"            // realized P&L below -maxIntradayRealizedLossNtd
  | "session_unrealized_loss"          // unrealized below threshold
  | "session_order_count"              // ordersAccepted >= maxOrdersPerSession
  | "session_fill_count"               // ordersFilled >= maxFillsPerSession
  | "session_halted";                  // haltOnBreach already triggered
```

All 6 added to `OVERRIDE_BLOCKED_GUARDS` in `risk-engine.ts:35-44` — non-overridable like kill_switch (institutional desk doesn't let traders override their own session caps mid-day).

### 1.3 Effective-limit precedence

Existing code resolves `EffectiveRiskLimit` by stacking account → strategy → symbol; session is a **parallel** check, not a stacked replacement. Order flow:

```
  computeRiskCheck(input):
    1. evaluate account guards   → if BLOCKED: layer="account"
    2. evaluate strategy guards  → if BLOCKED: layer="strategy"
    3. evaluate symbol guards    → if BLOCKED: layer="symbol"
    4. evaluate session guards   → if BLOCKED: layer="session"   # NEW
    5. aggregate → RiskCheckResult
```

Session can BLOCK even when 1-3 ALLOW (e.g. account cap NTD 500K not breached, strategy NTD 300K not breached, symbol NTD 100K not breached, but session cumulative gross already at NTD 800K).

---

## 2. Persistence layout

### 2.1 Extend `RiskStoreState`

```typescript
// apps/api/src/risk-store.ts
export interface RiskStoreState {
  limits: Record<string, RiskLimit>;
  killSwitch: Record<string, KillSwitchState>;
  strategyLimits: Record<string, StrategyRiskLimit>;
  symbolLimits: Record<string, SymbolRiskLimit>;
  sessionLimits: Record<string, SessionRiskLimit>;     // NEW
  // counters NOT persisted — recomputed from ledger on boot
}
```

Counters derive from `paper_orders` + `paper_fills` ledger filtered by `sessionDate = today (Taipei)`. Boot path:

```
  loadRiskStore() → { limits, killSwitch, strategyLimits, symbolLimits, sessionLimits }
  hydrateRiskEngine(state) → also rehydrates sessionLimits
  recomputeSessionCounters(workspace, accountId, today) → SessionRiskCounters
    SELECT SUM(notional), COUNT(*), SUM(realized_pnl)
      FROM paper_orders
     WHERE workspace=? AND account=? AND DATE(created_at AT TIME ZONE 'Asia/Taipei')=?
       AND status IN ('FILLED','ACCEPTED')
```

### 2.2 Counter cache invalidation

Counters live in a new in-memory `Map<workspace:account:date, SessionRiskCounters>`. Updated on:

- `submitOrder()` → increments `ordersAccepted`
- `executePaperOrder()` → on FILLED status, updates `grossExposureNtd` and `ordersFilled`
- `cancelOrder()` → on prev FILLED + now CANCELLED, decrements gross
- `quoteTickHandler()` → updates `unrealizedPnlNtd` mark-to-quote (throttled to 5s)
- **Daily rollover at 09:00 Taipei** → reset all counters to 0; previous day archived to `paper_session_summary` table.

---

## 3. Migration: `0021_session_risk.sql`

```sql
-- 0021_session_risk.sql
CREATE TABLE session_risk_limits (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_slug                  TEXT NOT NULL,
  account_id                      TEXT NOT NULL,
  session_date                    DATE NOT NULL,
  max_intraday_gross_exposure_ntd NUMERIC(18,2) NOT NULL,
  max_intraday_realized_loss_ntd  NUMERIC(18,2) NOT NULL,
  max_intraday_unrealized_loss_ntd NUMERIC(18,2) NOT NULL,
  max_orders_per_session          INT NOT NULL,
  max_fills_per_session           INT NOT NULL,
  warn_gross_exposure_ntd         NUMERIC(18,2) NOT NULL,
  warn_realized_loss_ntd          NUMERIC(18,2) NOT NULL,
  halt_on_breach                  BOOLEAN NOT NULL DEFAULT TRUE,
  reset_at_market_open            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by                      UUID NOT NULL REFERENCES users(id),
  reason                          TEXT NOT NULL,
  CONSTRAINT uq_session_limit UNIQUE (workspace_slug, account_id, session_date)
);

CREATE INDEX idx_session_risk_workspace_account
  ON session_risk_limits (workspace_slug, account_id);

CREATE INDEX idx_session_risk_date
  ON session_risk_limits (session_date DESC);

-- archive of daily counter snapshots (post-rollover)
CREATE TABLE paper_session_summary (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_slug  TEXT NOT NULL,
  account_id      TEXT NOT NULL,
  session_date    DATE NOT NULL,
  gross_exposure_peak_ntd  NUMERIC(18,2) NOT NULL,
  realized_pnl_eod_ntd     NUMERIC(18,2) NOT NULL,
  orders_accepted_total    INT NOT NULL,
  orders_filled_total      INT NOT NULL,
  breach_count             INT NOT NULL DEFAULT 0,
  last_breach_kind         TEXT,
  archived_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_session_summary UNIQUE (workspace_slug, account_id, session_date)
);

CREATE INDEX idx_session_summary_workspace_date
  ON paper_session_summary (workspace_slug, session_date DESC);
```

`down.sql` drops both tables (paper-only, no broker linkage, safe to roll back).

---

## 4. Routes (extend `apps/api/src/server.ts`)

```
GET    /api/v1/risk/session-limits?accountId=&date=YYYY-MM-DD
POST   /api/v1/risk/session-limits        # upsert (Owner/Admin only)
GET    /api/v1/risk/session-counters?accountId=&date=YYYY-MM-DD
GET    /api/v1/risk/session-summary?accountId=&from=&to=
```

All Read routes also surface `effectiveLimit.sourceLayer === "session"` when session is the binding constraint, mirroring existing 3-layer convention.

---

## 5. Defaults (paper-default account)

Conservative defaults for the paper sprint (W7-W8):

| Field | Default |
|---|---|
| `maxIntradayGrossExposureNtd` | 2,000,000 (NT$2M, ~10% of NT$20M paper equity) |
| `maxIntradayRealizedLossNtd` | 100,000 (NT$100K, ~0.5%) |
| `maxIntradayUnrealizedLossNtd` | 200,000 (NT$200K, ~1%) |
| `maxOrdersPerSession` | 50 |
| `maxFillsPerSession` | 30 |
| `warnGrossExposureNtd` | 1,500,000 |
| `warnRealizedLossNtd` | 60,000 |
| `haltOnBreach` | true |
| `resetAtMarketOpen` | true |

Defaults seeded by migration; operator can tune via `POST /risk/session-limits`.

---

## 6. Frontend surface (Codex Contract — NOT this work order)

When implemented, frontend should render under `/portfolio` Risk panel:

- Session-layer badge: 0/50 orders, 0/30 fills, 0% / NT$2M gross
- Progress bars colored: green <60%, amber 60-80% (warn threshold), red >80% (binding)
- Session reset countdown: "resets at 09:00 Taipei (in HHh MMm)"
- BLOCKED state when binding: "Session gross exposure cap reached — submit blocked until reset or operator raises limit"

This frontend is part of P1-1 Portfolio Contract 2 (Jason ETA Day 4-5), not Session-layer scope.

---

## 7. Acceptance criteria (when implemented)

1. `pnpm typecheck` PASS for `packages/contracts` + `apps/api`
2. Migration `0021_session_risk` applies clean + `down.sql` rolls back clean
3. Risk engine boot path: hydrate sessionLimits + recompute counters from ledger
4. Order submission path: 4-layer check (account → strategy → symbol → session) all wired
5. `OVERRIDE_BLOCKED_GUARDS` includes 6 new session guards
6. Daily rollover at 09:00 Taipei: counters → archive table, counters reset to 0
7. Routes: GET session-limits / POST session-limits / GET session-counters / GET session-summary
8. Bruce regression: 4-state harness on all 4 routes + idempotency (rapid-double-cap-hit returns same effective layer)
9. Stop-line scan: 0 broker writes; session enforcement is paper-only

---

## 8. Effort estimate

| Lane | Owner | Files | LOC | Hours |
|---|---|---|---|---|
| Contracts | Jason | `packages/contracts/src/risk.ts` | ~80 | 1.5 |
| Migration | Jason | `0021_session_risk.{up,down}.sql` | ~70 | 1 |
| Engine | Jason | `apps/api/src/risk-engine.ts` (extend) | ~250 | 4 |
| Persistence | Jason | `apps/api/src/risk-store.ts` (extend) | ~50 | 1 |
| Routes | Jason | `apps/api/src/server.ts` (extend) | ~120 | 2 |
| Counter recompute | Jason | new `apps/api/src/session-counters.ts` | ~150 | 2 |
| Daily rollover scheduler | Jason | new `apps/api/src/session-scheduler.ts` | ~80 | 2 |
| Tests (unit + integration) | Jason | `apps/api/src/__tests__/session-risk.test.ts` | ~300 | 3 |
| Mike audit | Mike | migration desk review | — | 1 |
| Pete review | Pete | PR desk review | — | 1.5 |
| Bruce regression | Bruce | 4-state harness | — | 1 |

**Total**: ~1100 LOC, ~20 engineering hours. Fits within W8 sprint window post-Contract 2/3/4/5 unblock.

---

## 9. Stop-lines (when implementing)

1. **No live broker linkage**: session enforcement is paper-only, mirroring all other layers
2. **No silent counter drift**: counter recompute on boot from ledger truth, not last-known cache
3. **No timezone bug**: `sessionDate` is Taipei-local (`Asia/Taipei`), not UTC; rollover at 09:00 Taipei not 00:00 UTC
4. **No counter mutation outside engine**: only `risk-engine.ts` mutates session counters; routes are read-only
5. **No skipping migration audit**: Mike must approve `0021` before merge (per W6 rule)
6. **No bypass via guard override**: 6 new session guards added to `OVERRIDE_BLOCKED_GUARDS` (non-overridable)
7. **No prod schedule**: cron registration NOT auto-pushed; operator triggers daily rollover scheduler manually for first 3 sessions, then automate

---

## 10. References

- Existing 3-layer code: `apps/api/src/risk-engine.ts:1-80` + `apps/api/src/risk-store.ts:1-64`
- Persistence pattern: `risk-store.ts` atomic tmp→rename via `RAILWAY_VOLUME_MOUNT_PATH`
- 4-layer roadmap promise: `evidence/w7_paper_sprint/institutional_grade_roadmap_2026-05-01.md` §1 row 2
- W6 paper sprint stop-lines: `feedback_w6_paper_sprint_rules.md`

---

**Drafted in Block 1 of 68h sprint (5/1 12:33 → 5/4 09:00). Implementation gated by 楊董 ACK + Jason availability + Contract 2/3 unblock (since Portfolio frontend would consume session-counters).**
