# Contract 4 — Strategy Idea → Paper Order Promote Pipeline (Design)

**Date**: 2026-05-01 16:23 Taipei (W7 Day 2, sprint Block 1 final)
**Drafter**: Elva
**Type**: Design only — no code, no migration, no PR
**Owner-after-ack**: Jason (backend) + Codex (frontend)
**Priority**: P1-3 — research→execution closed loop, 機構級 highlight
**Status**: DESIGN_DRAFT — needs 楊董 ACK + Jason confirm before impl dispatch

---

## 1. Why this contract exists (institutional-grade gap)

Right now `apps/web/app/ideas/page.tsx` shows strategy ideas (score / direction / theme / quoteContext snapshot) but the **only path to a paper order is manual**: user reads idea → opens `/companies/[symbol]` → clicks PaperOrderPanel → fills price/qty/side/strategy → submits.

That breaks the **research → execution** cycle. An institutional desk wires the brief into the ticket: `idea.preferredQty + idea.entryPriceHint + idea.symbol + idea.strategyTag + idea.runId` should pre-populate the paper order ticket with one click. The operator still confirms before submit; Code never auto-submits without human intent.

This contract closes that loop without crossing the paper gate.

---

## 2. Scope (what is in / out)

**In**:
1. New route `POST /api/v1/strategy/ideas/:ideaId/promote-to-paper-preview` that emits a fully-populated `PaperOrderIntent` candidate (no submit, just preview).
2. Frontend "Promote to paper ticket" button on idea card (idea row in `/ideas` page + idea detail in `/runs/[id]`) that: (a) calls promote-to-preview, (b) navigates to `/companies/[symbol]?paperOrderDraft=<intentId>`, (c) PaperOrderPanel hydrates from that draft, (d) operator reviews + confirms + submits via existing `POST /api/v1/paper/orders` (Contract 1 path).
3. Persisted `idea_promotion_log` table — every promote click writes an audit row (ideaId, runId, intentDraftId, operatorUserId, snapshotAt, finalAction = submitted | abandoned | timeout). Closes the lineage gap.
4. UI badge on idea showing `Promoted: 0` / `Promoted: 3 (1 submitted)` running count.

**Out** (explicitly):
- ❌ No auto-submit. Operator click → preview → confirm → existing PaperOrderPanel submit. Two human steps minimum.
- ❌ No KGI broker live submit. Preview emits a paper-only `PaperOrderIntent`; the existing 409 hard line on `/order/create` stays.
- ❌ No batch promote (one idea → one ticket per click).
- ❌ No idea→multi-symbol expansion (1 idea = 1 symbol; if idea is theme-level, we surface theme constituents and operator picks one).
- ❌ No automated sizing beyond what idea already declares (`preferredQtyLots` if present, else operator types qty).

---

## 3. Contract entity — `IdeaPromotionPreview`

```typescript
// New: contracts/strategy-idea-promote.ts
export interface IdeaPromotionPreview {
  promotionId: string;          // UUID, also written to idea_promotion_log
  ideaId: string;
  runId: string | null;
  workspaceSlug: string;

  // Pre-populated paper order draft (matches PaperOrderIntent shape)
  draft: {
    symbol: string;             // resolved from idea.symbol
    side: "buy" | "sell";       // from idea.direction
    qtyLots: number;            // idea.preferredQtyLots ?? 1 (operator can edit)
    qtyLotsSource: "idea" | "default_1";
    priceHint: number | null;   // idea.entryPriceHint ?? null
    priceMode: "limit" | "market"; // "limit" if priceHint set, else "market"
    strategyTag: string;        // idea.strategyTag
    notes: string;              // auto-composed: "from idea <ideaId> · score=<...> · theme=<...>"
  };

  // Quote context snapshot (frozen at promote time)
  quoteContext: {
    capturedAt: string;
    sourcedFromIdea: boolean;   // idea already has quoteContext attached?
    bid: number | null;
    ask: number | null;
    last: number | null;
    staleness: "fresh" | "stale" | "blocked";
  };

  // 4-layer risk preview (advisory — operator still gets blocked at submit if breach)
  riskAdvisory: {
    accountLayer: "ok" | "warn" | "block";
    strategyLayer: "ok" | "warn" | "block" | "no_limit_set";
    symbolLayer: "ok" | "warn" | "block" | "no_limit_set";
    sessionLayer: "ok" | "warn" | "block" | "no_limit_set"; // P1-5 dependency
    advisoryReason: string | null;
  };

  // Lineage
  generatedAt: string;
  expiresAt: string;            // 5 minutes; preview unusable after
  paperGateState: "ARMED" | "DISARMED";
  killSwitchState: "ARMED" | "DISARMED";
}
```

The frontend stores this on the URL hash / query and PaperOrderPanel hydrates from `apps/api/src/server.ts` lookup `GET /api/v1/strategy/ideas/promote-preview/:promotionId` (the GET re-fetch — useful if the user copy-pastes the URL).

---

## 4. New API routes

| Method | Path | Purpose | Auth |
|---|---|---|---|
| `POST` | `/api/v1/strategy/ideas/:ideaId/promote-to-paper-preview` | Generate `IdeaPromotionPreview`, log row in `idea_promotion_log` with `finalAction = pending_review` | Owner / Trader |
| `GET` | `/api/v1/strategy/ideas/promote-preview/:promotionId` | Re-fetch preview (URL share scenario, expires after 5min) | Owner / Trader |
| `PATCH` | `/api/v1/strategy/ideas/promote-preview/:promotionId/abandon` | Operator abandoned ticket without submitting; promotion log updates `finalAction = abandoned` | Owner / Trader |
| `GET` | `/api/v1/strategy/ideas/:ideaId/promotion-stats` | Aggregate count: `{ totalPromotions, submitted, abandoned, expired }` for idea card badge | Owner / Trader / Viewer |

**Hooked into existing flow**:
- `POST /api/v1/paper/orders` (Contract 1) — when caller passes `promotionId` in body, the backend updates `idea_promotion_log.finalAction = submitted` + writes `paperOrderId` link.

---

## 5. Migration `0022_idea_promotion_log.sql`

```sql
-- 0022_idea_promotion_log.sql
CREATE TABLE IF NOT EXISTS idea_promotion_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_slug TEXT NOT NULL,
  promotion_id UUID NOT NULL UNIQUE,
  idea_id UUID NOT NULL REFERENCES strategy_ideas(id) ON DELETE CASCADE,
  run_id UUID REFERENCES strategy_runs(id) ON DELETE SET NULL,
  operator_user_id UUID NOT NULL REFERENCES users(id),
  draft_snapshot JSONB NOT NULL,
  quote_context_snapshot JSONB,
  risk_advisory JSONB,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  final_action TEXT NOT NULL DEFAULT 'pending_review'
    CHECK (final_action IN ('pending_review', 'submitted', 'abandoned', 'expired')),
  paper_order_id UUID REFERENCES paper_orders(id) ON DELETE SET NULL,
  finalized_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_promo_idea ON idea_promotion_log(idea_id);
CREATE INDEX IF NOT EXISTS idx_promo_workspace_generated_at
  ON idea_promotion_log(workspace_slug, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_promo_pending
  ON idea_promotion_log(workspace_slug, generated_at)
  WHERE final_action = 'pending_review';
```

Idempotent. Reversible via `0022_idea_promotion_log.down.sql` (DROP TABLE).
Mike audit checklist: 4 items (FK references, ON DELETE behavior, CHECK constraint, index coverage).

---

## 6. Frontend wiring (Codex lane)

### 6.1 Idea card "Promote to paper" button

`apps/web/app/ideas/page.tsx` row + `apps/web/app/runs/[id]/page.tsx` idea row:

```tsx
{idea.workflowStatus === "ready" && paperGateArmed && killSwitchArmed && (
  <button
    className="text-xs uppercase tracking-wider text-amber-400 hover:text-amber-200"
    onClick={async () => {
      const preview = await promoteIdeaToPaper(idea.id);
      if (preview.paperGateState !== "ARMED") {
        toast("Paper gate disarmed — promotion blocked");
        return;
      }
      if (preview.riskAdvisory.accountLayer === "block") {
        toast(`Risk blocked: ${preview.riskAdvisory.advisoryReason}`);
        return;
      }
      router.push(
        `/companies/${preview.draft.symbol}?paperOrderDraft=${preview.promotionId}`
      );
    }}
    disabled={!idea.preferredQtyLots && !idea.entryPriceHint}
  >
    [PROMOTE → TICKET]
  </button>
)}
```

### 6.2 PaperOrderPanel hydration

`apps/web/app/companies/[symbol]/PaperOrderPanel.tsx` reads `?paperOrderDraft=<id>` query param on mount, calls GET preview, hydrates form fields, renders amber banner: `■ Hydrated from idea <ideaId> · expires in 04:32`. Operator edits if needed → submits via existing Contract 1 flow with `promotionId` attached.

### 6.3 Idea card promotion badge

Background fetch `GET /api/v1/strategy/ideas/:ideaId/promotion-stats` (cached 30s); render below score:

```
SCORE 7.4 · DEFENSIVE · TW-AI
PROMOTED 3 (2 submitted · 1 abandoned)
```

### 6.4 4-state hard rule conformance

| State | Render |
|---|---|
| LIVE | Promote button enabled, badge shows real count |
| EMPTY | Promote button enabled but idea has no `preferredQtyLots` → button disabled with tooltip "no qty hint" |
| BLOCKED | Promote button hidden + idea card shows source BLOCKED badge |
| HIDDEN | Promote button hidden (idea workflowStatus = `archived` / `superseded`) |

---

## 7. Pipeline stages (operator flow)

```
[Idea LIVE]
   │
   │ click "PROMOTE → TICKET"
   ▼
[POST /promote-to-paper-preview] ──► creates idea_promotion_log row (final_action=pending_review)
   │                                  + 4-layer risk advisory snapshot
   │                                  + quote context snapshot
   │                                  + 5min expiry
   ▼
[Navigate /companies/:symbol?paperOrderDraft=<id>]
   │
   │ PaperOrderPanel reads ?paperOrderDraft=<id>
   │ GET /promote-preview/:id → hydrates form
   ▼
[Operator reviews + edits] (qty / price / strategy override)
   │
   │ ┌─ click "ABANDON"          │ ┌─ click "SUBMIT PAPER"
   │ ▼                            │ ▼
[PATCH /abandon]              [POST /paper/orders { ..., promotionId }]
   │                              │
   │                              │ existing Contract 1 flow:
   │                              │ - 4-layer risk gate
   │                              │ - paper-only execute (live=409)
   │                              │ - PaperOrder row written
   │                              │ - idea_promotion_log.final_action=submitted
   │                              │ - paper_order_id linked
   ▼                              ▼
[final_action=abandoned]   [final_action=submitted, paper_order_id=...]
```

Expiry path: cron sweeps `final_action=pending_review AND expires_at<NOW()` every 5min, sets `final_action=expired`.

---

## 8. 4-layer risk surface

The promote-to-preview endpoint runs the **same** 4-layer risk evaluator as `POST /paper/orders` but with `dryRun: true`. The advisory map exposes which layer would block:

```
accountLayer: 'ok' | 'warn' | 'block'         // workspace risk_limits store
strategyLayer: 'ok' | 'warn' | 'block' | 'no_limit_set'  // strategy_risk_limits store
symbolLayer: 'ok' | 'warn' | 'block' | 'no_limit_set'    // symbol_risk_limits store
sessionLayer: 'ok' | 'warn' | 'block' | 'no_limit_set'   // P1-5 session_risk_limits (NOT YET IMPL)
```

Until P1-5 (session-layer risk) ships, sessionLayer always returns `no_limit_set` with note `"session-layer pending P1-5"`.

UI highlights blocking layers in red ASCII bar at top of PaperOrderPanel:

```
■ RISK ADVISORY  account=ok  strategy=warn  symbol=ok  session=N/A
  warn: strategy "TW-AI-MOMENTUM" 80% of daily realized-loss budget
```

This **does not** prevent submit at preview stage (operator may have a justification or the limits may shift); the actual block happens at `POST /paper/orders` execute time per existing Contract 1 risk path. The preview is **advisory-only** by design — operator sees the gate before committing.

---

## 9. Hard-line matrix (W7 paper sprint conformance)

| # | Hard line | This contract status |
|---|---|---|
| 1 | No `/order/create` change | ✓ untouched |
| 2 | No KGI SDK import in apps/api | ✓ no broker call |
| 3 | Paper gate 409 untouched | ✓ live submit still 409 |
| 4 | Migration idempotent (`IF NOT EXISTS`) | ✓ 0022 follows pattern |
| 5 | Kill-switch ARMED untouched | ✓ no kill-switch toggle |
| 6 | OPENAI_MODEL pinned `gpt-5.4-mini` | ✓ no LLM call |
| 7 | No secret rotation | ✓ no auth surface change |
| 8 | 4-state hard rule (UI) | ✓ §6.4 conforms |
| 9 | No auto-submit | ✓ §2 explicit; 2 human steps minimum |
| 10 | Audit log every action | ✓ idea_promotion_log table |
| 11 | Idempotency on submit | ✓ Contract 1 already enforces; promotionId is informational |
| 12 | No silent mock fallback | ✓ promote-preview emits real preview or 4xx |

12/12 PASS.

---

## 10. Effort + sequencing

| Task | Owner | LOC est | Hours |
|---|---|---|---|
| `contracts/strategy-idea-promote.ts` (entity + zod) | Jason | ~120 | 1.5h |
| Migration `0022_idea_promotion_log.sql` + `.down.sql` | Jason | ~50 | 1h |
| 4 routes in `apps/api/src/server.ts` | Jason | ~280 | 4h |
| Hook `POST /paper/orders` to consume `promotionId` | Jason | ~40 | 1h |
| Cron sweep expired promotions | Jason | ~50 | 1h |
| Idea card "Promote" button + idea-promote-api.ts client | Codex | ~180 | 3h |
| PaperOrderPanel hydration from `?paperOrderDraft=` | Codex | ~140 | 2.5h |
| Promotion stats badge + 30s cache | Codex | ~80 | 1.5h |
| 4-state conformance polish | Codex | ~40 | 1h |
| Mike migration audit (0022) | Mike | — | 0.5h |
| Pete 7-axis desk review | Pete | — | 1h |
| Bruce 4-state regression + idempotency verify | Bruce | — | 1.5h |

**Total**: ~980 LOC / **~19.5h engineering** + ~3h review/verify = ~22.5h end-to-end.

**Sequencing**:
1. **W8 D1** (5/5 Mon, market open): Jason ships `0022 + entity + 5 routes` as one PR, gated on PR #39 (0020 v2) merged + Codex Contract 1 cleanup green.
2. **W8 D2** (5/6): Codex ships Idea promote button + PaperOrderPanel hydration as one PR, depends on Jason's contract entity merged.
3. **W8 D3** (5/7): Bruce regression + Mike + Pete audit; merge if green.
4. **W8 D4** (5/8): Operator promote→submit live demo on `2330` 1-lot.
5. **W8 D5** (5/9): Paper E2E full demo `idea → promote → ticket → submit → fill → cancel → timeline`. **5/9 paper E2E deadline met.**

This means P1-3 ships on the original W7→W8 paper E2E target without crowding the 5/4 09:00 open.

---

## 11. Open questions for 楊董

| # | Question | Elva default if no answer |
|---|---|---|
| Q1 | Idea promote button visible to Viewer role? | Default: **NO** — Owner / Trader only; Viewer sees badge but no button |
| Q2 | Preview expiry 5min OK? | Default: **YES** — 5min covers ticket-edit window |
| Q3 | Should `/runs/[id]/page.tsx` show promote button on every idea row? | Default: **YES** — symmetric with `/ideas` page |
| Q4 | Promote button enabled when idea has no `preferredQtyLots`? | Default: **NO** — operator must size manually via existing PaperOrderPanel; promote requires hint |
| Q5 | Should promote auto-fill `notes` field? | Default: **YES** — `"from idea <ideaId> · score=<...> · theme=<...>"` for traceability |
| Q6 | If 4-layer risk advisory shows `block`, can operator still proceed to PaperOrderPanel? | Default: **YES** — preview is advisory; final block happens at submit per Contract 1; toast shows reason |
| Q7 | Promotion stats badge Viewer-readable? | Default: **YES** — read-only counters, useful for review |
| Q8 | Does idea need a new field `promotionEligible: boolean`? | Default: **NO** — derive from `workflowStatus === "ready" && (preferredQtyLots != null || entryPriceHint != null)` |
| Q9 | Should Bruce verify add a "no auto-submit" grep in 4-state harness? | Default: **YES** — verify pattern: `promote-to-paper-preview` exists but no path auto-calls `POST /paper/orders` |

---

## 12. Status + next action

**Status**: DESIGN_DRAFT — design only, no impl, no PR.

**Next action**: Park until 楊董ACK on Q1-Q9 + Jason 0020 v2 merged + Codex Contract 1 stable. Then dispatch as W8 D1-D5 (5/5 → 5/9) sequenced bundle. Slots cleanly into the 5/9 paper E2E deadline.

**Block 1 cycle deliverable**: Closes the **research → execution** loop without breaking any hard line. Together with P1-5 (session risk persist), P1-6 (session-layer schema), P1-11 (OpenAlice 100-co batch) — Block 1 design coverage is complete for the research/risk/promotion triangle.

— Elva, 2026-05-01 16:23 Taipei
