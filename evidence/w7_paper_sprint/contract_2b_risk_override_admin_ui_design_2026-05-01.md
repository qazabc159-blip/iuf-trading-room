# Contract 2b — 4-Layer Risk Override Admin UI Design (P1-4)

**Author:** Elva (orchestrator)
**Date:** 2026-05-01 18:23 TST
**Sprint:** W7 paper sprint, day 2 of 4 (5/1 → 5/4 09:00 TWSE open)
**Lane:** Codex frontend (apps/web/admin) + Jason backend (1 mutation route + audit log)
**Hard rule:** 4-state UI (LIVE / EMPTY / BLOCKED / HIDDEN). Mutations are **audit-logged, change-stamped, and never silent**.
**Linked:** Contract 2 (P1-1 portfolio + risk badge readout — already implemented commit `13ca56a`)
**Pattern:** Admin form on `/admin/risk-limits` — read current limit row from `risk-store` → operator edits → POST diff → audit log row → response surfaces new value with `effectiveAt`. No optimistic UI. No silent fallback.

---

## §1 Purpose & necessity

After Contract 2 landed (`13ca56a`), the dashboard now shows the **read-side** of 4-layer risk: `account / strategy / symbol / session` cells with status, current value, limit, top contributor.

But the **write-side** is still SQL-shell only — operator who needs to adjust an account-level NTD cap, or whitelist a new symbol, has to either:
1. Run `UPDATE risk_limits SET value=X WHERE layer='account' AND key='ntd_exposure'` against the production DB (high-risk, no audit trail in the app)
2. Restart the gateway with new env vars (ten-minute downtime, not viable during market)
3. Wait for code change + deploy (an hour, not viable)

This blocks institutional-grade operation. Operator cannot show, in the demo, "I'm raising the NTD cap from 1.0M to 1.5M for this strategy because today's volatility profile changed" — because that gesture requires a deploy or DB shell.

**Contract 2b puts that gesture on screen.** It is the missing complement to Contract 2.

---

## §2 Non-goals (W7 scope only)

- **No** automated limit-tuning (e.g. "raise cap automatically if drawdown < 0.5% for 5 days") — that's W9+.
- **No** cross-workspace limit propagation — single workspace per UI session.
- **No** kill-switch toggle from this UI — kill-switch has its own dedicated control flow (Contract 1 territory).
- **No** approval workflow / multi-sig for limit changes — single-operator workspace; audit log is the trail. Multi-approver is W10.
- **No** mobile UI — desktop terminal only, viewport >= 1280px.
- **No** schema-level layer addition — the four layers `account / strategy / symbol / session` are fixed for now. Adding a fifth layer is a separate spec.

---

## §3 Domain entities

### 3.1 `RiskLimitRow` (existing; this design only reads + updates)

```ts
type RiskLimitRow = {
  id: string;
  workspaceId: string;
  layer: "account" | "strategy" | "symbol" | "session";
  key: string;                       // e.g. "ntd_exposure", "lot_count", "tag:trend_v3", "session:morning"
  value: number;
  unit: "ntd" | "lots" | "ratio" | "count";
  status: "active" | "disabled";
  // bookkeeping
  updatedAt: string;
  updatedByUserId: string | null;
  reason: string | null;             // free-text "why this limit"
};
```

### 3.2 `RiskLimitOverrideAuditRow` (new table)

```ts
type RiskLimitOverrideAuditRow = {
  id: string;                        // uuid
  workspaceId: string;
  riskLimitId: string;               // FK → risk_limits.id
  layer: "account" | "strategy" | "symbol" | "session";
  key: string;
  oldValue: number;
  newValue: number;
  unit: "ntd" | "lots" | "ratio" | "count";
  oldStatus: "active" | "disabled";
  newStatus: "active" | "disabled";
  reason: string;                    // REQUIRED — operator must justify
  changedByUserId: string;
  changedAt: string;
  // optional context
  tradingSessionLabel: string | null;  // e.g. "morning_2026-05-04"
};
```

This is the **audit trail**. Every mutation lands here, immutable. We do not allow editing or deleting rows in this table from the app.

### 3.3 `RiskLimitOverrideDiff` (request body)

```ts
type RiskLimitOverrideDiff = {
  riskLimitId: string;
  newValue: number;          // operator can set same value as old to no-op (rejected by backend)
  newStatus?: "active" | "disabled";   // optional flip
  reason: string;            // REQUIRED, min 10 chars
};
```

### 3.4 `AdminPanelState`

```ts
type AdminPanelState =
  | { state: "LIVE"; limits: RiskLimitRow[]; recentAudits: RiskLimitOverrideAuditRow[]; updatedAt: string; source: string }
  | { state: "BLOCKED"; updatedAt: string; source: string; reason: string };
```

Same envelope pattern as Contract 2 / 3.

---

## §4 Backend routes (Jason lane)

### 4.1 `GET /api/admin/risk-limits`

**Auth:** existing admin middleware. Required role: `admin` (operator). Reject `viewer`, `analyst`.
**Returns:** `AdminPanelState` payload — all limit rows for the workspace + last 25 audit log entries (ordered desc).
**Failure:**
- DB unavailable → 503, frontend wrapper flips to BLOCKED
- Role insufficient → 403, frontend wrapper flips to BLOCKED with reason "INSUFFICIENT_ROLE"

### 4.2 `PATCH /api/admin/risk-limits/:id`

**Auth:** admin only.
**Body:** `RiskLimitOverrideDiff`.
**Validation (server-side, returns 4xx with reason):**
- `reason.length >= 10` (REQUIRED) — else 400 `REASON_TOO_SHORT`
- `newValue >= 0` and finite — else 400 `INVALID_VALUE`
- `newValue !== oldValue` if `newStatus` also unchanged — else 400 `NOOP_DIFF`
- For NTD layer: `newValue` must be in [0, 100_000_000] — else 400 `OUT_OF_BOUNDS_NTD`
- For lots layer: `newValue` must be in [0, 10_000] — else 400 `OUT_OF_BOUNDS_LOTS`
- Atomic transaction: write `risk_limits` UPDATE + insert `risk_limit_override_audit` + bump `risk-store` in-memory cache
- If kill-switch ENGAGED → 423 `LOCKED` (limits frozen during halt)

**Returns:** updated `RiskLimitRow` + new audit row.

**Side effects:**
- `risk-store` cache invalidated synchronously
- All currently-open dashboard tabs hooked into `/api/portfolio/overview` will see updated limit on next 5s poll
- No restart, no deploy

### 4.3 `GET /api/admin/risk-limits/:id/audit`

**Auth:** admin or analyst.
**Returns:** full audit history for that limit row, paginated 50/page.

### 4.4 Migration `0023_risk_limit_override_audit.sql`

```sql
CREATE TABLE IF NOT EXISTS risk_limit_override_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  risk_limit_id UUID NOT NULL,
  layer TEXT NOT NULL CHECK (layer IN ('account','strategy','symbol','session')),
  key TEXT NOT NULL,
  old_value NUMERIC NOT NULL,
  new_value NUMERIC NOT NULL,
  unit TEXT NOT NULL CHECK (unit IN ('ntd','lots','ratio','count')),
  old_status TEXT NOT NULL CHECK (old_status IN ('active','disabled')),
  new_status TEXT NOT NULL CHECK (new_status IN ('active','disabled')),
  reason TEXT NOT NULL CHECK (length(reason) >= 10),
  changed_by_user_id UUID NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  trading_session_label TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_workspace_changed_at ON risk_limit_override_audit (workspace_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_risk_limit_id ON risk_limit_override_audit (risk_limit_id, changed_at DESC);
```

Idempotent. No DOWN script needed (audit log is append-only — DOWN would mean dropping the table, which loses audit trail. Operator must use a separate migration if remove is ever needed, with explicit data-loss approval).

---

## §5 Frontend components (Codex lane, apps/web/admin)

### 5.1 New file: `apps/web/app/admin/risk-limits/page.tsx`

Server component. Fetches `GET /api/admin/risk-limits` → returns `AdminPanelState`. Renders `<RiskLimitAdminSurface>`.

### 5.2 New file: `apps/web/components/admin/RiskLimitAdminSurface.tsx`

Same envelope pattern as Contract 2's `RiskSurface.tsx`:

```tsx
export type AdminPanelState =
  | { state: "LIVE"; limits: RiskLimitRow[]; recentAudits: RiskLimitOverrideAuditRow[]; updatedAt: string; source: string }
  | { state: "BLOCKED"; updatedAt: string; source: string; reason: string };

export function RiskLimitAdminSurface({ result }: { result: AdminPanelState }) {
  if (result.state === "BLOCKED") return <BlockedBanner reason={result.reason} ... />;
  return (
    <div>
      <SourceLine source={result.source} updatedAt={result.updatedAt} />
      <LimitGrid limits={result.limits} />
      <AuditTrail audits={result.recentAudits} />
    </div>
  );
}
```

### 5.3 New file: `apps/web/components/admin/LimitGrid.tsx`

Grid layout, 4 columns (one per layer). Each layer card lists its keys + values + status indicator + edit button.

Edit click → opens inline `<LimitEditModal>` (no navigation away — keeps context).

### 5.4 New file: `apps/web/components/admin/LimitEditModal.tsx`

Modal with:
- Read-only section: layer / key / current value / current status / current reason
- Editable: new value (number input), new status (active/disabled toggle), reason (textarea, min 10 chars, char counter)
- "Preview impact" section (read-only): if newValue is changed, show **what utilization % would be** with the new limit applied to current exposure (live computation — same formula as Contract 2 risk-store evaluator)
- Buttons: CANCEL / APPLY OVERRIDE

APPLY click → fires `PATCH /api/admin/risk-limits/:id` → on success: modal closes, surface refreshes, audit trail shows new row at top. On failure: modal stays open with red banner showing the API error code (`REASON_TOO_SHORT`, `OUT_OF_BOUNDS_NTD`, etc.).

### 5.5 New file: `apps/web/components/admin/AuditTrail.tsx`

Vertical list of last 25 audit rows. Each row shows:
- timestamp (zh-TW format)
- who changed (userId → username lookup)
- layer / key
- old → new (with delta arrow)
- reason (truncated to 60 chars, full text on hover)
- "VIEW HISTORY" link → `/admin/risk-limits/:id/audit`

### 5.6 Edits: `apps/web/lib/api.ts`

Add types: `RiskLimitRow`, `RiskLimitOverrideAuditRow`, `RiskLimitOverrideDiff`, `AdminPanelState`. Add fetch helpers: `getAdminRiskLimits()`, `patchAdminRiskLimit(id, diff)`.

---

## §6 4-state hard rule matrix

| Surface | LIVE | EMPTY | BLOCKED | HIDDEN |
|---|---|---|---|---|
| `RiskLimitAdminSurface` | route 200, limits[] populated | n/a (workspace always has at least 1 layer with default limits) | role insufficient / DB fail / kill-switch ENGAGED (read OK but edits locked separately) | viewport < 1280px |
| `LimitEditModal` after APPLY | new audit row written | n/a | API 4xx with explicit error code | n/a |
| `AuditTrail` | rows[] populated | rows.length===0 → "No overrides recorded yet" | route 200 but DB query timed out | n/a |

**Hard:** if PATCH returns 423 LOCKED (kill-switch ENGAGED), modal stays open with banner "Risk limit edits frozen — kill-switch is engaged. Resolve kill-switch first."

**Hard:** the LimitGrid display itself does NOT lock during kill-switch — operator can still **see** what limits are in effect; only edits are blocked.

---

## §7 Visual design (mirrors Contract 2 palette)

- Header: `RISK LIMIT OVERRIDE / admin / source: risk-store@v1 / updated 18:23:14`
- Layer cards: monospace, gold-bright header bars per layer (account/strategy/symbol/session)
- Edit button: small `[EDIT]` link in cell corner, red-on-hover
- Modal: dark overlay, modal box with CRT-style border (`var(--exec-rule-strong)`)
- Apply button: amber when valid input, grey when invalid, red on submit error
- Audit trail: ASCII delta arrows: `1,000,000 → 1,500,000 NT$` (no fancy icons)

---

## §8 Hard-line matrix (12 rules)

| # | Rule | Pass criterion |
|---|---|---|
| 1 | Zero silent mock | grep `apps/web/components/admin/` for `mock\|fake\|sample` → 0 hits |
| 2 | Stop-line clean | grep `broker\.submit\|live\.submit\|kgi-broker\|/order/create` → 0 hits |
| 3 | All 4 states explicit | `RiskLimitAdminSurface` switch covers LIVE/BLOCKED, modal covers success/error explicit |
| 4 | Reason field REQUIRED + min 10 chars | server-side validation tested by Bruce harness |
| 5 | Audit row inserted on every successful PATCH | tested by inspecting `risk_limit_override_audit` count after PATCH |
| 6 | Audit row immutable | no UPDATE/DELETE route exposed for `risk_limit_override_audit` |
| 7 | Kill-switch ENGAGED → edits return 423 | tested with kill ENGAGED → PATCH → expect 423 |
| 8 | NTD bounds enforced | PATCH with newValue=200_000_000 → 400 OUT_OF_BOUNDS_NTD |
| 9 | Lots bounds enforced | PATCH with newValue=20_000 → 400 OUT_OF_BOUNDS_LOTS |
| 10 | Role insufficient → 403 | viewer role test |
| 11 | Migration is idempotent | run twice → no error |
| 12 | risk-store cache invalidated synchronously | dashboard `/api/portfolio/overview` reflects new limit within 1 poll cycle (5s) |

All 12 expected PASS at design time.

---

## §9 LOC + time estimate

| File | LOC | Owner |
|---|---|---|
| `apps/api/migrations/0023_risk_limit_override_audit.sql` | ~30 | Jason |
| `apps/api/routes/admin/risk-limits.ts` (GET + PATCH + audit GET) | ~220 | Jason |
| `apps/api/lib/risk-store.ts` `applyOverride()` extension | ~80 | Jason |
| `apps/web/app/admin/risk-limits/page.tsx` | ~50 | Codex |
| `apps/web/components/admin/RiskLimitAdminSurface.tsx` | ~90 | Codex |
| `apps/web/components/admin/LimitGrid.tsx` | ~140 | Codex |
| `apps/web/components/admin/LimitEditModal.tsx` | ~200 | Codex |
| `apps/web/components/admin/AuditTrail.tsx` | ~110 | Codex |
| `apps/web/lib/api.ts` types + helpers | ~80 | Codex |
| Bruce harness verify (12 hard-lines) | ~100 | Bruce |
| Mike migration audit | ~30 | Mike |
| **Total** | **~1130 LOC** | |

**Time estimate:** Jason 6h (route + migration + store + tests) + Codex 12h (5 components + integration + visual polish) + Bruce 3h + Mike 30min = **~22h e2e**.

**Sequence:** W8 D2-D4 (5/6 → 5/8). NOT on the W7 demo path — deferred to W8 explicitly. The 5/4 demo can show the read-side (Contract 2 already shipped) and verbally describe "limits are currently DB-shell-only — admin UI lands W8 D2-D4". This is honest and matches the institutional-grade story.

---

## §10 Open questions for 楊董 (7)

1. **Q1 — Audit retention:** keep audit rows forever, or rotate after 1 year? (Default: forever — audit trails are gold for institutional review.)
2. **Q2 — Reason char min:** 10 OK? Or longer (50 = forces real justification)? (Default: 10 — 50 might frustrate fast operator workflow.)
3. **Q3 — NTD upper bound:** 100M NT$ OK as ceiling? (Default: yes — exceeds any realistic single-account size by 10x.)
4. **Q4 — Lots upper bound:** 10,000 lots OK? (Default: yes — single-symbol 10k lots ≈ 5,000 round lots ≈ massive position. Reasonable hard cap.)
5. **Q5 — Approval workflow:** single-operator W7-W8, OR add 2-person approval for any change > 50% of current value? (Default: single-operator now; flag 2-person for W10.)
6. **Q6 — Kill-switch ENGAGED edits:** lock all edits (current design), OR allow tightening (lower limit) but block loosening? (Default: lock all — simpler safety story for the demo.)
7. **Q7 — Trading session label:** auto-derive from current TST clock, or operator types? (Default: auto-derive — `morning_YYYY-MM-DD`, `afternoon_YYYY-MM-DD`, `overnight_YYYY-MM-DD`.)

---

## §11 Sequencing relative to 5/4 demo

This contract is **explicitly NOT on the demo path**. The 5/4 demo shows Contract 2 read-side. Contract 2b admin UI is a W8 deliverable.

| Date | Task | Owner |
|---|---|---|
| 5/2 Sat | (idle — focus stays on demo readiness Contracts 2/3/4) | — |
| 5/3 Sun | (idle) | — |
| 5/4 Mon | Demo, then read-side feedback captured | — |
| 5/5 Tue | Jason migration + GET route DRAFT PR | Jason |
| 5/6 Wed | Jason PATCH route + risk-store extension | Jason |
| 5/7 Thu | Codex 5 components | Codex |
| 5/8 Fri | Bruce harness + Mike migration audit + merge | Bruce + Mike |

If Contract 4 (P1-3) is not yet implementation-complete by 5/4, this contract slides further right.

---

## §12 Cross-references

- Contract 2 (read-side, implemented `13ca56a`): `evidence/w7_paper_sprint/contract_2_portfolio_4layer_risk_ui_design_2026-05-01.md`
- Contract 3 (watchlist, implemented `cbadbb9`): `evidence/w7_paper_sprint/contract_3_watchlist_ui_design_2026-05-01.md`
- Contract 4 (idea→paper promote, in-progress `1d9f50f`): `evidence/w7_paper_sprint/contract_4_idea_to_order_promote_design_2026-05-01.md`
- Demo runbook: `evidence/w7_paper_sprint/paper_e2e_live_demo_runbook_2026-05-04.md`
- Idempotency verify: `evidence/w7_paper_sprint/paper_e2e_idempotency_verify_checklist_2026-05-04.md`
- Contingency: `evidence/w7_paper_sprint/paper_e2e_demo_contingency_plan_2026-05-04.md`

---

**Status:** DRAFT v1. Mike will need to audit migration when Jason DRAFT PR opens. 7 open Q with defaults applied. Not on W7 demo path — W8 deliverable.
