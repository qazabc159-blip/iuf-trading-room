# Pete Follow-up Letter to Jason — PR #296 Post-Merge Suggestions
# Date: 2026-05-08
# Re: `paper-four-layer-risk-gate.ts` (merged to main)
# Original review: evidence/w7_paper_sprint/PETE_PR296_DESK_REVIEW_2026-05-07.md

Jason,

PR #296 is merged and 187/187 PASS. Good work. Below are the 4 post-merge
suggestions from my review, each with exact file:line, the gap, and a ready-to-drop
fix. These should be a single follow-up PR — ~5-10 lines of code changes plus 1 unit
test.

---

## S1 — .env.example gap for RISK_* vars

STATUS: VERIFIED CLOSED. No action needed.

Confirmed: `apps/api/.env.example` lines 64-70 already contain all three vars
added by PR #298 (or present in the same PR):

```
# Paper trading 4-layer risk gate thresholds (PR #296).
# L2: max single-order notional as % of total equity (buy side only).
RISK_MAX_POSITION_PCT=30
# L3: daily loss limit as % of equity; auto-engages kill switch on breach (submit path only).
RISK_DAILY_LOSS_PCT=2
# L4: per-symbol concentration cap as % of equity (buy side only).
RISK_PER_SYMBOL_MAX_PCT=30
```

All three are documented with defaults. S1 is DONE.

---

## S2 — L3 block test gap: negative PnL path (preview mode, blocked=true)

FILE: `apps/api/src/__tests__/paper-submit-risk.test.ts`
(New test to add at end of file — after T09 / GP01)

GAP: The existing test suite (`paper-submit-risk.test.ts`) covers
`buildPaperOrderContext` and `normalizePaperQuantity` arithmetic only. No test
exercises `evaluateFourLayerRiskGate` directly with a negative-PnL account state
and asserts `blocked=true, layer=3, killSwitchAutoEngaged`.

The preview path (`server.ts` line 7565: `evaluateFourLayerRiskGate({..., isPreview: true})`)
does NOT auto-engage the kill switch — but should still return `blocked=true`.
The current test gap means preview-mode L3 with a fresh (PnL=0) account has never
been exercised against a loss-injected account.

SUGGESTED NEW FILE:
`apps/api/src/__tests__/paper-four-layer-risk-gate.test.ts`

Drop-in test (no HTTP, no DB, pure unit via module mock injection):

```typescript
/**
 * paper-four-layer-risk-gate.test.ts
 *
 * Coverage:
 *   TL01: L1 (kill switch ON) → blocked=true, layer=1
 *   TL02: L3 preview mode, negative PnL injected → blocked=true, layer=3,
 *          killSwitchAutoEngaged=false (preview must NOT mutate kill switch)
 *   TL03: L3 submit mode, negative PnL injected → blocked=true, layer=3,
 *          killSwitchAutoEngaged=true
 *
 * Hard lines:
 *   - No HTTP. No DB. No KGI SDK.
 *   - _setKillSwitchEnabled reset to false before each L3 test.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { mock } from "node:test";

// Patch paper-broker before importing gate
import * as paperBroker from "../broker/paper-broker.js";
import * as execMode from "../domain/trading/execution-mode.js";
import { evaluateFourLayerRiskGate } from "../paper-four-layer-risk-gate.js";

// Minimal AppSession stub
const stubSession = {
  workspace: { slug: "test-ws" },
  user: { id: "test-user" }
} as any;

// Minimal buy limit order stub (2330, 1 SHARE @ 100 TWD)
function makeOrder(overrides = {}) {
  return {
    accountId: "paper-default",
    symbol: "2330",
    side: "buy",
    type: "limit",
    timeInForce: "rod",
    quantity: 1,
    quantity_unit: "SHARE",
    price: 100,
    stopPrice: null,
    tradePlanId: null,
    strategyId: null,
    overrideGuards: [],
    overrideReason: "",
    ...overrides
  } as any;
}

// Reusable balance stub factory
function makeBalance(realizedPnlToday: number, unrealizedPnl: number, equity = 10_000) {
  return {
    accountId: "paper-default",
    currency: "TWD",
    cash: equity,
    availableCash: equity,
    equity,
    marketValue: 0,
    unrealizedPnl,
    realizedPnlToday,
    marginUsed: 0,
    updatedAt: new Date().toISOString()
  };
}

// ─── TL01: L1 kill switch ────────────────────────────────────────────────────

test("TL01: L1 kill switch ON → blocked=true, layer=1", async () => {
  execMode._setKillSwitchEnabled(true);

  const result = await evaluateFourLayerRiskGate({
    session: stubSession,
    order: makeOrder(),
    isPreview: false
  });

  assert.equal(result.blocked, true);
  if (result.blocked) {
    assert.equal(result.layer, 1);
    assert.equal(result.auditType, "kill_switch_on");
  }

  execMode._setKillSwitchEnabled(false); // cleanup
});

// ─── TL02: L3 preview mode — negative PnL → blocked, NO kill-switch mutation ─

test("TL02: L3 preview — negative PnL → blocked=true, layer=3, killSwitchAutoEngaged=false", async () => {
  execMode._setKillSwitchEnabled(false);

  // equity=10_000; daily loss limit=2% → threshold=-200 TWD
  // inject realizedPnlToday=-150, unrealizedPnl=-100 → total=-250 ≤ -200 → L3 triggers
  const mockBalance = makeBalance(-150, -100, 10_000);
  const mockPositions: any[] = [];

  const balanceStub = mock.method(paperBroker, "getPaperBalance", async () => mockBalance);
  const posStub = mock.method(paperBroker, "listPaperPositions", async () => mockPositions);

  const result = await evaluateFourLayerRiskGate({
    session: stubSession,
    order: makeOrder(),
    isPreview: true   // preview: must NOT auto-engage kill switch
  });

  assert.equal(result.blocked, true);
  if (result.blocked) {
    assert.equal(result.layer, 3);
    assert.equal(result.auditType, "risk_block_daily_loss");
    // KEY ASSERTION: preview must not auto-engage kill switch
    assert.equal(result.killSwitchAutoEngaged, false);
    // Kill switch must remain OFF after preview
    assert.equal(execMode.isKillSwitchEnabled(), false);
  }

  balanceStub.mock.restore();
  posStub.mock.restore();
});

// ─── TL03: L3 submit mode — negative PnL → blocked + kill switch auto-engaged ─

test("TL03: L3 submit — negative PnL → blocked=true, layer=3, killSwitchAutoEngaged=true", async () => {
  execMode._setKillSwitchEnabled(false);

  const mockBalance = makeBalance(-150, -100, 10_000);
  const mockPositions: any[] = [];

  const balanceStub = mock.method(paperBroker, "getPaperBalance", async () => mockBalance);
  const posStub = mock.method(paperBroker, "listPaperPositions", async () => mockPositions);

  const result = await evaluateFourLayerRiskGate({
    session: stubSession,
    order: makeOrder(),
    isPreview: false  // submit: MUST auto-engage kill switch
  });

  assert.equal(result.blocked, true);
  if (result.blocked) {
    assert.equal(result.layer, 3);
    assert.equal(result.killSwitchAutoEngaged, true);
    // Kill switch must now be ON — side-effect verified
    assert.equal(execMode.isKillSwitchEnabled(), true);
  }

  balanceStub.mock.restore();
  posStub.mock.restore();
  execMode._setKillSwitchEnabled(false); // cleanup for downstream tests
});
```

Run command:
```
node --test --import tsx/esm apps/api/src/__tests__/paper-four-layer-risk-gate.test.ts
```

Note on mock.method: Node 22 `node:test` `mock.method` patches the named export on
the module object in place — this works because `paper-four-layer-risk-gate.ts`
imports `getPaperBalance`/`listPaperPositions` as named imports from the same
module object. If ESM live-binding prevents patching, fallback is to extract a
`_setPaperBrokerOverride` injection point in `paper-four-layer-risk-gate.ts` (same
pattern as `_setKillSwitchEnabled`). Either approach keeps the test pure-unit
with no HTTP/DB.

---

## S3 — Market order L2/L4 bypass undocumented

FILE: `apps/api/src/paper-four-layer-risk-gate.ts`

LOCATION 1 (referencePrice helper): lines 89-95
LOCATION 2 (L2 guard): lines 162-179 — `if (refPrice !== null && refPrice > 0)`
LOCATION 3 (L4 guard): lines 210-228 — `if (refPrice !== null && refPrice > 0)`

GAP: A market order (price=null, stopPrice=null) silently bypasses L2 and L4.
The `referencePrice()` function returns null for market orders, and the guards
short-circuit. The current code has a comment on lines 89-92 explaining the
intent but it only appears on the `referencePrice` helper — not at the actual
guard sites where reviewers and future owners will land first.

FIX — add inline comment at both guard sites:

```typescript
// ── L2: Max position size cap ─────────────────────────────────────────────
if (order.side === "buy") {
  const maxPositionPct = readMaxPositionPct();
  const refPrice = referencePrice(order);
  // Market orders (price=null, stopPrice=null): refPrice is null → L2 skipped.
  // By design: notional cannot be calculated without a reference price.
  // Market order risk is handled upstream by the stale_quote guard in
  // evaluatePaperOrderRisk (paper-risk-bridge.ts).
  if (refPrice !== null && refPrice > 0) {
```

Same comment block at the L4 guard site (line ~210):

```typescript
// ── L4: Per-symbol concentration cap ─────────────────────────────────────
if (order.side === "buy") {
  const perSymbolMaxPct = readPerSymbolMaxPct();
  const refPrice = referencePrice(order);
  // Market orders (price=null, stopPrice=null): refPrice is null → L4 skipped.
  // By design: same rationale as L2 above — upstream stale_quote guard covers
  // market order risk.
  if (refPrice !== null && refPrice > 0) {
```

This is a comment-only change — zero behavioural delta. Makes the bypass
intentional and searchable for future auditors.

---

## S4 — `paper_submit_rejected` exclusion from `total` undocumented

FILE: `apps/api/src/server.ts`

LOCATION: lines 9245-9253 (the `paper_submit_rejected` sub-query block)
and line 9184 (JSDoc `@returns` list for the endpoint)

GAP: `paper_submit_rejected` is a JSONB-filtered sub-query on `audit_logs` where
`action='paper_submit' AND (payload->>'status')::int >= 422`. It counts a subset
of rows already counted in `paper_submit`. However, the endpoint response and
JSDoc do not explain that `paper_submit_rejected` is NOT added to `total` — the
`total` field comes only from the GROUP BY aggregate query (lines 9222-9242)
which does not include a `paper_submit_rejected` group (it is not a distinct
`action` value in the DB). A reader seeing two counters could assume they are
additive; that assumption is wrong.

FIX — add inline comment at the sub-query site (~line 9245):

```typescript
// paper_submit_rejected = paper_submit rows where payload->>'status' >= 422.
// This is a JSONB-filtered SUBSET of paper_submit rows — NOT a separate
// audit_log action. Therefore paper_submit_rejected is NOT included in `total`
// (total comes from the GROUP BY aggregate above which only counts distinct
// action strings; 'paper_submit_rejected' is never written as an action).
// Consumer note: paper_submit_rejected <= paper_submit always holds.
const rejRows = await db.execute(
```

---

## Suggested PR scope

Single PR: "chore(risk-gate): post-merge doc + test follow-up for PR #296"

Changes:
1. NEW `apps/api/src/__tests__/paper-four-layer-risk-gate.test.ts` (TL01/TL02/TL03)
2. `apps/api/src/paper-four-layer-risk-gate.ts` — 2x comment block (S3, ~6 lines)
3. `apps/api/src/server.ts` — 1x comment block at rejRows query (S4, ~5 lines)

S1 is already done — no file change needed.

LOC delta estimate: +150 (new test) / +11 (comments) / -0

---

Pete
Reviewer
2026-05-08 | W7 Paper Sprint
Ref: evidence/w7_paper_sprint/PETE_PR296_DESK_REVIEW_2026-05-07.md
