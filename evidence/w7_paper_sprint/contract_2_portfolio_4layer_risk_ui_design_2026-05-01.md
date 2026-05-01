# Contract 2 — Portfolio + 4-Layer Risk Badge UI (Design)

**Date**: 2026-05-01 16:43 Taipei (W7 Day 2, Block 1, 20min cadence)
**Drafter**: Elva
**Type**: Design only — UI spec for Codex; backend deps on Jason
**Owner-after-ack**: Codex (frontend) + Jason (backend Contract 2 routes)
**Priority**: P1-1 — institutional-grade desk首頁基本盤
**Status**: DESIGN_DRAFT — needs 楊董 ACK + Jason Contract 2 routes shipped

---

## 1. Why this needs a dedicated design

Today `apps/web/app/portfolio/page.tsx` already wires `kill-switch` reads but the **4-layer risk surface is invisible**: an institutional desk wants to see at a glance "account=72% used / strategy=warn / symbol=ok / session=N/A" on the same page where positions are listed. Without the badge, the operator has to drill into `/risk/limits` admin to know if next order will be blocked.

Per `evidence/w7_paper_sprint/institutional_grade_roadmap_2026-05-01.md` §3 P1-1: portfolio + 4-layer risk badge is the **first-page institutional pre-trade signal** — without it the home page does not earn "機構級".

---

## 2. Scope

**In**:
1. New section on `/portfolio` page: **■ RISK SURFACE** — 4 horizontal cells (account / strategy / symbol / session), each shows `limit / current / utilization% / status badge`.
2. Per-position row: small sub-badge showing which layer would block a hypothetical new order on that symbol/strategy.
3. New backend route `GET /api/v1/risk/portfolio-overview` aggregating all 4 layers + per-symbol/strategy attribution.
4. 30s polling refresh.
5. Click any layer cell → navigate to `/risk/limits?layer=<account|strategy|symbol|session>` (admin route) for adjustment.

**Out**:
- ❌ No risk-limit edit from /portfolio page (admin route owns mutate).
- ❌ No automatic limit adjustment.
- ❌ No predicted-loss calc beyond what session-layer (P1-5) provides.

---

## 3. Backend contract — `RiskPortfolioOverview`

```typescript
// New: contracts/risk-portfolio-overview.ts
export interface RiskPortfolioOverview {
  workspaceSlug: string;
  generatedAt: string;
  killSwitchState: "ARMED" | "DISARMED";
  paperGateState: "ARMED" | "DISARMED";

  layers: {
    account: RiskLayerCell;
    strategy: RiskLayerCell;
    symbol: RiskLayerCell;
    session: RiskLayerCell;  // P1-5 dependency; "no_limit_set" until session-layer ships
  };

  // Per-position risk attribution
  positionAttribution: PositionRiskRow[];

  // Active strategy / symbol breakdown (top-N by exposure)
  strategyBreakdown: StrategyExposureRow[];
  symbolBreakdown: SymbolExposureRow[];
}

export interface RiskLayerCell {
  layer: "account" | "strategy" | "symbol" | "session";
  status: "ok" | "warn" | "block" | "no_limit_set" | "blocked_killswitch";
  limit: { kind: string; value: number; unit: "ntd" | "lots" | "count" };
  current: number;
  utilizationPct: number;       // 0.0-1.5 (over-limit possible if breach)
  warnThresholdPct: number;     // typically 0.8
  blockThresholdPct: number;    // typically 1.0
  reason: string | null;        // human-readable when status != "ok"
  topContributors: Array<{ key: string; value: number }>; // e.g. top 3 strategies eating account budget
}

export interface PositionRiskRow {
  symbol: string;
  qtyLots: number;
  marketValueNtd: number;
  unrealizedPnlNtd: number;
  // hypothetical: if operator added 1 lot of this symbol now, which layer would block?
  hypotheticalBlockingLayer: "none" | "account" | "strategy" | "symbol" | "session";
  hypotheticalBlockReason: string | null;
}

export interface StrategyExposureRow {
  strategyTag: string;
  exposureNtd: number;
  utilizationPct: number;       // vs strategy_risk_limits
  status: "ok" | "warn" | "block" | "no_limit_set";
}

export interface SymbolExposureRow {
  symbol: string;
  exposureNtd: number;
  utilizationPct: number;       // vs symbol_risk_limits
  status: "ok" | "warn" | "block" | "no_limit_set";
}
```

---

## 4. New API route

| Method | Path | Purpose | Auth | Cadence |
|---|---|---|---|---|
| `GET` | `/api/v1/risk/portfolio-overview` | Aggregate 4-layer + per-position + breakdown | Owner / Trader / Viewer | client polls 30s |

Backend impl reuses existing `risk-engine.ts` evaluators (`evaluateAccountLayer`, `evaluateStrategyLayer`, `evaluateSymbolLayer`) — no new logic, just an aggregator endpoint. Session layer returns `no_limit_set` until P1-5 ships.

---

## 5. UI layout (portfolio page top section)

```
┌──────────────────────────────────────────────────────────────────┐
│ ■ RISK SURFACE                          generated 16:42:18 [LIVE]│
├──────────────┬──────────────┬──────────────┬────────────────────┤
│ ACCOUNT      │ STRATEGY     │ SYMBOL       │ SESSION            │
│ ────────     │ ────────     │ ────────     │ ────────           │
│ NT$ 720k     │ TW-AI-MOMNT  │ 2330         │ N/A                │
│ /1.0M        │ 92% utilized │ 45% utilized │ no_limit_set       │
│ ▰▰▰▰▰▰▰░░░ 72%│▰▰▰▰▰▰▰▰▰▰ 92%│▰▰▰▰▰░░░░░ 45%│ pending P1-5      │
│ [OK]         │ [WARN]       │ [OK]         │ [GREY]             │
│ kill=ARMED   │ TW-AI-DEF 78%│ 3008 41%     │ Block-1 cycle done │
└──────────────┴──────────────┴──────────────┴────────────────────┘
```

Each cell:
- **Header**: layer name (uppercase, amber)
- **Body line 1**: top contributor (`TW-AI-MOMNT` for strategy / `2330` for symbol)
- **Body line 2**: numeric (current / limit) + utilization %
- **ASCII bar**: `▰` filled to utilizationPct (clamped 0.0-1.0); over-limit shows `▰▰▰▰▰▰▰▰▰▰` red
- **Status badge**: `[OK]` (green/cyan) / `[WARN]` (amber) / `[BLOCK]` (red) / `[GREY]` (no_limit_set)
- **Footer**: kill-switch state on Account cell; #2 contributor on others

Status badge colors map to existing CRT phosphor palette:
- `OK` → cyan-300
- `WARN` → amber-400
- `BLOCK` → red-400 with blink
- `GREY` → zinc-500
- `BLOCKED_KILLSWITCH` → red-500 solid + ⚠ icon

### 5.1 Position rows (existing positions table — augment, don't replace)

Each row gets a 4-character status code in a new column:

```
SYMBOL   QTY    MARK_VAL   PNL      RISK_NEXT_ORDER
2330     5      720,000   +12,500   [OK--]   ← all 4 layers OK
3008     2      280,000   -3,200    [OWSO]   ← account OK / WARN strategy / OK symbol / no session
1101     10     510,000   +1,800    [OOBN]   ← account OK / OK strategy / BLOCK symbol / N/A
```

The 4-char code is account/strategy/symbol/session in order:
- `O` = ok
- `W` = warn
- `B` = block
- `N` = no_limit_set
- `K` = killswitch_blocked
- `-` = layer_not_evaluated

Hover any character → tooltip shows full reason.

### 5.2 Sub-strategy and sub-symbol breakdown (optional drawer)

Click [+] on RISK SURFACE → expands a drawer showing:
```
TOP STRATEGIES BY EXPOSURE
  TW-AI-MOMNT       NT$ 460,000   92% util   [WARN]
  TW-AI-DEF         NT$ 390,000   78% util   [OK]
  TW-DIV-CORE       NT$ 110,000   22% util   [OK]

TOP SYMBOLS BY EXPOSURE
  2330              NT$ 720,000   45% util   [OK]
  3008              NT$ 280,000   41% util   [OK]
  1101              NT$ 510,000  103% util   [BLOCK] ← over symbol cap
```

Drawer reuses existing CRT-styled list.

---

## 6. 4-state hard rule conformance

| State | Render |
|---|---|
| **LIVE** | Full 4-cell surface + position attribution + breakdown |
| **EMPTY** | RISK SURFACE shows `[no positions yet]` with grey cells; layers still show limits even with 0 current |
| **BLOCKED** | RISK SURFACE shows BLOCKED reason banner (e.g. "risk-store load failed; admin notified"); cells grey; portfolio page does NOT render fake zero risk |
| **HIDDEN** | Section hidden when user role = Viewer-Read (per backlog `viewer-read-drafts` tightening) |

Critical rule: **never render a cell as `[OK]` if the underlying layer is BLOCKED at fetch**. If aggregator endpoint fails, the entire RISK SURFACE collapses to a `BLOCKED` banner — not 4 grey cells which could mislead operator that risk is 0% used.

---

## 7. Frontend implementation notes (for Codex)

### 7.1 Files

- `apps/web/lib/risk-portfolio-api.ts` — fetcher + zod schema (mirrors backend contract)
- `apps/web/components/portfolio/RiskSurface.tsx` — 4-cell horizontal block + drawer
- `apps/web/components/portfolio/PositionRiskBadge.tsx` — 4-char status code component
- `apps/web/app/portfolio/page.tsx` — wire RiskSurface above existing positions table; pass per-symbol attribution to PositionRiskBadge

### 7.2 Polling cadence

- 30s `useSWR` interval (matches existing portfolio polling)
- On focus, immediate refetch
- On submit success in PaperOrderPanel (any page), broadcast invalidate via custom event → RiskSurface refetches

### 7.3 Accessibility

- ASCII bars use `aria-label="utilization 72 percent"`
- Status badges have `role="status"` and the visible 4-char code mirrors as `aria-label="account ok, strategy warn, symbol ok, session no limit"`

### 7.4 No silent mock

- If `riskPortfolioOverview` fetch fails, render BLOCKED banner with HTTP error code + retry button
- Do NOT fall back to localStorage-cached prior-snapshot; stale risk = dangerous false confidence
- If 4-state code is unresolved (e.g. layer evaluator throws), render `?` not `O`

---

## 8. Backend implementation notes (for Jason)

### 8.1 Aggregator endpoint

```typescript
// apps/api/src/server.ts
app.get('/api/v1/risk/portfolio-overview', requireAuth, async (req, res) => {
  const session = getSession(req);
  const ws = session.workspaceSlug;

  const accountCell = await evaluateAccountLayerForOverview(ws);
  const strategyCell = await evaluateStrategyLayerForOverview(ws);
  const symbolCell = await evaluateSymbolLayerForOverview(ws);
  const sessionCell = await evaluateSessionLayerForOverview(ws); // returns no_limit_set if 0021 not migrated

  const positions = await loadPositions(ws);
  const attribution = await Promise.all(
    positions.map(async p => ({
      ...p,
      hypotheticalBlockingLayer: await dryRunHypotheticalOrder(ws, p.symbol, 1, "buy"),
    }))
  );

  const strategyBreakdown = await loadTopStrategiesByExposure(ws, 5);
  const symbolBreakdown = await loadTopSymbolsByExposure(ws, 5);

  return ok({
    workspaceSlug: ws,
    generatedAt: new Date().toISOString(),
    killSwitchState: getKillSwitchState(ws),
    paperGateState: 'ARMED',
    layers: { account: accountCell, strategy: strategyCell, symbol: symbolCell, session: sessionCell },
    positionAttribution: attribution,
    strategyBreakdown,
    symbolBreakdown,
  });
});
```

### 8.2 No new migration

Reuses existing `risk_limits`, `strategy_risk_limits`, `symbol_risk_limits`, and risk-store file-backed snapshot (already shipped). Session layer cell pulled from P1-5 work when that ships.

### 8.3 Performance

- `dryRunHypotheticalOrder` for each position is O(positions × 4 layers); for typical 10 positions = 40 in-memory map lookups, < 5ms
- Cache aggregate result for 5s in-memory keyed by workspaceSlug
- 30s client polling × 5s server cache = ~6 evaluations/min/workspace, cheap

---

## 9. Hard-line matrix

| # | Hard line | Status |
|---|---|---|
| 1 | No `/order/create` change | ✓ |
| 2 | No KGI SDK import | ✓ |
| 3 | Paper gate untouched | ✓ |
| 4 | No new migration | ✓ — reuses risk-store |
| 5 | Kill-switch ARMED untouched | ✓ — read-only display |
| 6 | OPENAI_MODEL pinned | ✓ — no LLM call |
| 7 | No secret rotation | ✓ |
| 8 | 4-state UI rule | ✓ — §6 conforms |
| 9 | No silent mock | ✓ — §7.4 explicit |
| 10 | Audit log | N/A — read-only endpoint |
| 11 | Idempotency | N/A — GET |
| 12 | No risk over-ride from /portfolio page | ✓ — clicks navigate to admin route |

12/12 PASS.

---

## 10. Effort + sequencing

| Task | Owner | LOC est | Hours |
|---|---|---|---|
| `contracts/risk-portfolio-overview.ts` | Jason | ~80 | 1h |
| `evaluate*LayerForOverview` 4 helpers (extend existing) | Jason | ~140 | 2h |
| Aggregator route + 5s server cache | Jason | ~110 | 1.5h |
| `dryRunHypotheticalOrder` per-position | Jason | ~60 | 1h |
| `risk-portfolio-api.ts` client + zod | Codex | ~80 | 1h |
| `RiskSurface.tsx` (4-cell + drawer) | Codex | ~280 | 4h |
| `PositionRiskBadge.tsx` (4-char + tooltips) | Codex | ~120 | 2h |
| Wire into `apps/web/app/portfolio/page.tsx` | Codex | ~60 | 1h |
| 4-state conformance polish | Codex | ~40 | 1h |
| Bruce 4-state regression + risk-overview integration | Bruce | — | 1.5h |
| Pete 7-axis desk review | Pete | — | 1h |

**Total**: ~970 LOC / **~16h engineering** + ~2.5h verify = ~18.5h end-to-end.

**Sequencing**:
1. **W8 D1** (5/5 Mon): Jason ships aggregator endpoint + helpers as one PR.
2. **W8 D1-D2** (5/5-5/6): Codex ships RiskSurface + PositionRiskBadge + portfolio wire as one PR (depends on Jason contract entity merged).
3. **W8 D3** (5/7): Bruce + Pete audit; merge if green.
4. **W8 D3-D4** (5/7-5/8): Operator visual smoke + edge cases (over-limit display / kill-switch armed display / session N/A display).

P1-1 ships ahead of P1-3 (Contract 4 promote) since portfolio surface has no human-flow dependency. **Both fit before 5/9 paper E2E deadline**.

---

## 11. Open questions for 楊董

| # | Question | Elva default |
|---|---|---|
| Q1 | Show RISK SURFACE on `/portfolio` only or also on `/` (dashboard)? | **Both** — dashboard shows account+session compact; portfolio shows full 4-cell |
| Q2 | Per-position row 4-char code OK or prefer separate emoji column? | **4-char** — denser, terminal-like, matches CRT identity |
| Q3 | Drawer expand by default? | **No** — collapsed; click [+] to expand |
| Q4 | Top-N for breakdown? | **5** — fits within drawer |
| Q5 | Polling cadence 30s OK? | **YES** — matches existing portfolio polling |
| Q6 | Should clicking layer cell navigate or open in-place modal? | **Navigate** — `/risk/limits?layer=...` already exists |
| Q7 | If session layer no_limit_set, show grey cell or hide? | **Show grey** — hiding would make 機構級 surface incomplete |
| Q8 | Bruce verify includes `pageA → submit → RiskSurface refetch` test? | **YES** — invalidate broadcast must trigger refetch |

---

## 12. Status + next action

**Status**: DESIGN_DRAFT.

**Next action**: Park until 楊董ACK Q1-Q8 + Jason ships Contract 2 portfolio endpoints (P1-1 backend prerequisite). Then dispatch as W8 D1-D3 sequenced bundle. Together with P1-3 (Contract 4 promote), **W8 closes the institutional-desk experience triangle**: research surface → risk surface → execution loop.

**Block 1 cycle deliverable**: 6th P1 design doc this Block 1 (P1-1 added to P1-3 / P1-5 / P1-6 / P1-11). Block 1 design coverage now complete for the 5/9 paper E2E target except for P1-4 (KGI bidask WS — gated on operator) and P1-2 (Watchlist — depends on P1-1 patterns).

— Elva, 2026-05-01 16:43 Taipei
