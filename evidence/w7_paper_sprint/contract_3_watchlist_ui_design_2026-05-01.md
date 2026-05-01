# Contract 3 — Watchlist UI Design (P1-2)

**Author:** Elva (orchestrator)
**Date:** 2026-05-01 17:23 TST
**Sprint window:** W7 paper sprint, day 2 of 4 (5/1 → 5/4 09:00 TWSE open)
**Lane:** Codex frontend (apps/web) + Jason backend (1 aggregator route, no migration)
**Hard rule:** 4-state UI (LIVE / EMPTY / BLOCKED / HIDDEN), zero silent mock
**Linked:** Contract 2 (P1-1 portfolio 4-layer risk badge), Contract 4 (P1-3 idea→paper promote), Paper E2E demo runbook (P1-8)
**Pattern:** Mirror Contract 2 — `WatchlistSurfaceState` is `LIVE | BLOCKED` only, list rows are `EMPTY | LIVE`, no fallback shadow data.

---

## §1 Purpose

The watchlist is the operator's **pre-trade radar** during paper E2E demo. It must:

1. Surface real-time bid/ask + last trade for the operator's tracked symbols, with no silent stale fallback.
2. Light up a 4-layer risk advisory badge per row (re-uses Contract 2 `PositionRiskBadge` pattern), so the operator sees *before clicking* whether a hypothetical 1-lot buy would be blocked.
3. Provide a **one-click "PROMOTE → TICKET"** that pre-fills the paper-order ticket with `{ symbol, quote_at_click, side: BUY }` (passed as `?paperOrderDraft=<id>`, hydrating the same `PaperOrderPanel` used by Contract 4).
4. Render in the **3-pane top dashboard** (left: watchlist; center: kline; right: portfolio + risk surface — Contract 2). Maximum 12 rows visible, scrollable to 50.

The watchlist must **survive a quote-source outage gracefully**: if `bidask`/`last` is BLOCKED, the per-row state flips to BLOCKED and the "PROMOTE → TICKET" button greys out (button hover surfaces reason). Whole surface flips to BLOCKED only if the watchlist persistence backend itself is down.

## §2 Non-goals (explicitly out of scope for W7)

- Watchlist editing UX (add/remove/reorder symbols) — Codex already has a primitive `apps/web/components/watchlist/WatchlistEditor.tsx`; we do **not** redesign it this cycle. Rows are read-only this sprint; mutate via existing route.
- Multi-watchlist (groups, folders) — single user-level list only for W7.
- Sparklines / mini-charts in the row — adds quote-history fan-out cost; defer to W8.
- Streaming push (SSE/WS) for quote refresh — W7 uses 5s poll (matches Contract 2 cadence). WS push deferred to Contract 5 (KGI WS).
- Mobile layout — desktop terminal first; mobile collapses watchlist to BLOCKED state on viewport < 1024px (already the standing rule).

---

## §3 Domain entities

### 3.1 `WatchlistOverview` (route response)

```ts
type WatchlistOverview = {
  generatedAt: string;        // ISO-8601 server time
  source: "watchlist-store@v1";
  workspaceId: string;
  killSwitchState: "ARMED" | "ENGAGED";
  paperGateState: "ARMED" | "ENGAGED";
  rows: WatchlistRow[];        // 0..50
  // surface-level reasons
  warnings: string[];          // non-fatal (e.g. "12/15 rows hydrated; 3 rows quote-blocked")
};
```

### 3.2 `WatchlistRow`

```ts
type WatchlistRow = {
  symbol: string;              // e.g. "2330"
  symbolName: string | null;   // e.g. "台積電"
  // quote columns (each has its own state — row-level state derived from these)
  last: QuoteCell;             // last trade
  bid: QuoteCell;              // best bid
  ask: QuoteCell;              // best ask
  changePct: QuoteCell;        // session % change
  // risk preview
  hypothetical1LotBuyRisk: RiskAdvisoryPreview;  // 4-char code, same as Contract 2 PositionRiskBadge
  // promote affordance
  canPromote: boolean;         // false if any quote cell BLOCKED OR kill-switch ENGAGED
  promoteBlockedReason: string | null;
};

type QuoteCell =
  | { state: "LIVE"; value: number; updatedAt: string }
  | { state: "BLOCKED"; reason: string; lastSeenAt: string | null };
```

### 3.3 `RiskAdvisoryPreview`

Re-uses Contract 2 `PositionRiskBadge` payload exactly:

```ts
type RiskAdvisoryPreview = {
  layers: { account: AdvisoryStatus; strategy: AdvisoryStatus; symbol: AdvisoryStatus; session: AdvisoryStatus };
  worstStatus: "ok" | "warn" | "block" | "no_limit_set" | "blocked_killswitch";
  badgeCode: string;           // 4-char e.g. "OWBN"
  hypotheticalBlockingLayer: "account" | "strategy" | "symbol" | "session" | null;
};

type AdvisoryStatus = "ok" | "warn" | "block" | "no_limit_set";
```

### 3.4 `WatchlistSurfaceState` (frontend wrapper)

```ts
type WatchlistSurfaceState =
  | { state: "LIVE"; data: WatchlistOverview; updatedAt: string; source: string }
  | { state: "BLOCKED"; updatedAt: string; source: string; reason: string };
```

No `EMPTY` state at the surface level — empty is `LIVE` with `rows.length === 0`, and the list shows the standard empty hint. The wrapper flips to BLOCKED only when the persistence layer or the workspace lookup itself fails.

---

## §4 Backend route (Jason lane)

### 4.1 `GET /api/watchlist/overview`

**Auth:** existing session middleware (workspace membership required).
**Aggregator only — no new migration.** Joins:
- `watchlist_entries` (existing table, read-only)
- `quote-store` per symbol (last/bid/ask) — fan-out via existing `getQuote(symbol)` helper
- `risk-store.previewHypothetical1LotBuy(symbol)` — re-uses Contract 2's risk evaluator (advisory-only, no submit)

**Fan-out budget:** 50 symbols × 1 quote-fetch + 1 risk-eval. Quote-fetch is in-memory cache hit (5s TTL); risk-eval is pure local computation (no I/O). Target p95 ≤ 200ms total for 50 rows.

**Failure modes (mapping to 4-state hard rule):**

| Failure | Surface state | Per-row behavior |
|---|---|---|
| Workspace lookup fails | BLOCKED (whole surface) | n/a |
| `watchlist_entries` query fails | BLOCKED | n/a |
| `watchlist_entries` returns 0 | LIVE, rows=[] | empty hint shown |
| Single symbol quote fails | LIVE | row keeps symbol+name, all QuoteCells = BLOCKED, `canPromote=false` |
| Single symbol risk-eval fails | LIVE | row keeps quote, risk badge = `????`, `canPromote=false` |
| Kill-switch ENGAGED | LIVE | rows render normally but `canPromote=false`, `promoteBlockedReason="KILL_SWITCH_ENGAGED"` |

**Response shape:** matches `WatchlistOverview` above.

### 4.2 No new migration

`watchlist_entries` already exists from a prior wave. We re-use it as-is. If schema review (Mike) flags anything, we hold and re-spec — but expectation is zero migration cost.

---

## §5 Frontend components (Codex lane, apps/web)

### 5.1 New file: `apps/web/components/watchlist/WatchlistSurface.tsx`

```ts
export type WatchlistSurfaceState =
  | { state: "LIVE"; data: WatchlistOverview; updatedAt: string; source: string }
  | { state: "BLOCKED"; updatedAt: string; source: string; reason: string };

export function WatchlistSurface({ result }: { result: WatchlistSurfaceState }) {
  if (result.state === "BLOCKED") return <BlockedBanner reason={result.reason} source={result.source} updatedAt={result.updatedAt} />;
  const { data } = result;
  return (
    <div>
      <SourceLine source={result.source} generatedAt={data.generatedAt} kill={data.killSwitchState} paper={data.paperGateState} />
      {data.warnings.map(w => <WarningBanner key={w} text={w} />)}
      {data.rows.length === 0 ? <EmptyHint /> : <WatchlistTable rows={data.rows} />}
    </div>
  );
}
```

Same skeleton as `RiskSurface.tsx` — prop is the **state envelope**, not raw data. Component renders all 4 states explicitly.

### 5.2 New file: `apps/web/components/watchlist/WatchlistTable.tsx`

Table with 7 columns: SYMBOL / NAME / LAST / BID / ASK / Δ% / RISK / [PROMOTE]. Each numeric cell is its own `QuoteCellRender` — if state=BLOCKED, cell renders `--` with red dot; if LIVE, renders value + amber color when stale > 30s.

The RISK column re-uses `PositionRiskBadge` from Contract 2 (already implemented — verified at commit `13ca56a`, file `apps/web/components/portfolio/PositionRiskBadge.tsx` per my Contract 2 spec).

The PROMOTE button:
- If `row.canPromote === true`: renders enabled link `<Link href={\`/orders/paper?paperOrderDraft=${promotionId}\`}>PROMOTE → TICKET</Link>`. Click invokes `POST /api/idea/promote-to-paper-preview` with `{ symbol: row.symbol, quoteContext: { last, bid, ask, source: row.last.state === "LIVE" ? "watchlist-row" : "n/a" } }` first, **then** navigates with the returned `promotionId`. Same flow as Contract 4 §4.1.
- If `row.canPromote === false`: renders disabled button styled grey, `title={row.promoteBlockedReason}`. No navigation. Aria: `aria-disabled="true"`.

### 5.3 Edits: `apps/web/app/dashboard/page.tsx` (or wherever the 3-pane is)

Replace any current watchlist placeholder with:

```tsx
<WatchlistSurface result={watchlistResult} />
```

Hydrated by a sibling server-side fetch (same pattern as `riskSurfaceResult`). 5s poll cadence. On poll error → wrapper flips to BLOCKED.

### 5.4 Edits: `apps/web/lib/api.ts`

Add export type `WatchlistOverview`, `WatchlistRow`, `QuoteCell`, `RiskAdvisoryPreview` (re-use existing if Contract 2 already exported them — Codex `13ca56a` did add `RiskLayerCell` and `RiskPortfolioOverview`; we extend, not duplicate).

---

## §6 4-state hard rule matrix

| Surface | LIVE | EMPTY | BLOCKED | HIDDEN |
|---|---|---|---|---|
| Surface envelope | watchlist route returns 200 with rows[] | rows.length===0 | route 4xx/5xx, network fail, workspace lookup fail | viewport mobile (<1024px) |
| QuoteCell (per cell) | quote fresh < 30s | n/a (cell never empty — symbol always known) | quote-store fail OR stale > 5min | n/a |
| Risk badge | all 4 layers evaluated | n/a | risk-eval throws → badge = `????` | n/a |
| PROMOTE button | row.canPromote=true | n/a | row.canPromote=false (any cell BLOCKED, kill ENGAGED, paper not ARMED) | n/a |

**Zero silent fallback.** No "use last known value if quote fails." If quote fails, cell is BLOCKED with `lastSeenAt` shown as text but value rendered as `--`.

---

## §7 Visual design (mirrors Contract 2 RiskSurface palette)

- Header: source line `LIVE / watchlist-store@v1 / generated 17:23:14 / kill ARMED / paper ARMED`
- Each row: monospace, `font-family: var(--mono)`, 11px
- Status colors:
  - `--tw-up-bright` (cyan): LIVE quote fresh
  - `--gold-bright` (amber): LIVE quote stale 30s–5min
  - `--tw-dn-bright` (red): BLOCKED cell
  - `--exec-soft` (grey): row PROMOTE disabled
- Risk badge (4-char): same colors as Contract 2 PositionRiskBadge
- Row hover: subtle highlight `rgba(255,255,255,0.024)`, Cursor pointer on PROMOTE only

---

## §8 Hard-line matrix (12 rules)

| # | Rule | Pass criteria |
|---|---|---|
| 1 | Zero silent mock | grep `apps/web/components/watchlist/` for `mock\|fake\|sample` → 0 hits |
| 2 | Stop-line clean | grep `broker\.submit\|live\.submit\|kgi-broker\|/order/create` in any new file → 0 hits |
| 3 | 4-state explicit | `WatchlistSurface` switch covers all 4 states with explicit JSX, no fallthrough |
| 4 | No new migration | `apps/api/migrations/` diff = 0 |
| 5 | Re-use Contract 2 | `PositionRiskBadge` imported, not re-implemented |
| 6 | Promote integrates with Contract 4 | Click → `POST /api/idea/promote-to-paper-preview` first, then navigate with returned id |
| 7 | Kill-switch hard-blocks PROMOTE | If `killSwitchState === "ENGAGED"`, every row's `canPromote === false` |
| 8 | Paper gate hard-blocks PROMOTE | If `paperGateState !== "ARMED"`, every row's `canPromote === false` |
| 9 | Quote BLOCKED hard-blocks PROMOTE for that row | Cell BLOCKED → `canPromote === false` (per row) |
| 10 | Aggregator p95 ≤ 200ms | Bruce harness measures with 50-row mock workspace |
| 11 | All numeric cells use mono font | CSS `var(--mono)` on every value cell |
| 12 | No client-side ordering hack | Backend returns rows in workspace-stored order; frontend doesn't re-sort |

All 12 expected PASS at design time. Bruce will re-verify post-implement.

---

## §9 LOC + time estimate

| File | LOC | Owner |
|---|---|---|
| `apps/api/routes/watchlist.ts` aggregator | ~140 | Jason |
| `apps/api/lib/risk-store.ts` `previewHypothetical1LotBuy()` extension | ~40 (re-use) | Jason |
| `apps/web/components/watchlist/WatchlistSurface.tsx` | ~120 | Codex |
| `apps/web/components/watchlist/WatchlistTable.tsx` | ~180 | Codex |
| `apps/web/components/watchlist/QuoteCellRender.tsx` | ~50 | Codex |
| `apps/web/lib/api.ts` types | ~60 | Codex |
| `apps/web/app/dashboard/page.tsx` integration | ~30 | Codex |
| Bruce harness verify (4-state) | ~80 | Bruce |
| **Total** | **~700 LOC** | |

**Time estimate:** Jason 4h + Codex 8h + Bruce 2h = ~14h e2e. Sequence W8 D1 (5/5) → D2 (5/6) → D3 (5/7) → desk review.

---

## §10 Open questions for 楊董 (8)

1. **Q1 — 5s poll OK for W7?** Or push to 3s for the demo? (Contract 2 uses 5s; consistency argument says yes.)
2. **Q2 — Watchlist row max:** 50 rows OK as upper bound? Default render slice 12 (scrollable)?
3. **Q3 — PROMOTE side default:** BUY only for Contract 3 button? (Sell-side requires existing position — defer to Contract 4 idea cards.)
4. **Q4 — Stale color threshold:** 30s/5min OK? (KGI quote refresh is ~1-2s; 30s = clearly stale.)
5. **Q5 — Per-row PROMOTE during kill-switch ENGAGED:** show button greyed with reason hover, or hide entirely? (Default: greyed + hover — keeps spatial layout stable.)
6. **Q6 — Workspace ordering:** if user has no explicit sort, default to symbol asc? Or session-volume desc? (Default: as-stored — matches existing editor's order.)
7. **Q7 — Risk badge `????` (eval fail):** clickable to re-try, or read-only? (Default: read-only this sprint; click → next refresh.)
8. **Q8 — Empty-list copy:** "No symbols on watchlist — add via [editor]" vs simpler "Watchlist empty"? (Default: short copy; editor route exists.)

Defaults applied unless 楊董 overrides — design proceeds on defaults so Codex can pick this up immediately if they finish the next P1 burst.

---

## §11 Sequencing relative to 5/4 demo

The Watchlist UI is **on the demo path** (Step A of the runbook §3.1: "Operator opens dashboard, watchlist is the first surface"). If we want it ready for 5/4 09:00:

- **5/2 (Sat):** Jason ships aggregator route (no migration) + Codex ships `WatchlistSurface` + `WatchlistTable` skeleton with LIVE/BLOCKED only.
- **5/3 (Sun):** Codex ships `QuoteCellRender` + RISK badge wiring + PROMOTE click handler. Bruce 4-state harness against staging.
- **5/4 06:00 pre-open:** preflight runs WatchlistSurface against 3 known symbols (2330, 2317, 0050).

If 5/2-5/3 weekend ships drop scope, fall back: **strip the PROMOTE button** (Contract 4 leg). Watchlist still renders LIVE quotes and risk badges read-only — operator promotes via the idea panel instead. Contract 4 path covers the demo.

---

## §12 Cross-references

- Contract 2 design: `evidence/w7_paper_sprint/contract_2_portfolio_4layer_risk_ui_design_2026-05-01.md`
- Contract 4 design: `evidence/w7_paper_sprint/contract_4_idea_to_order_promote_design_2026-05-01.md`
- Paper E2E demo runbook: `evidence/w7_paper_sprint/paper_e2e_live_demo_runbook_2026-05-04.md`
- Status board: `evidence/w7_paper_sprint/frontend_realdata_status_board_2026-05-01.md`
- Codex direct exec proof: commit `13ca56a` implemented Contract 2's `RiskSurface.tsx` + `PositionRiskBadge.tsx` within 20min of design push — same pattern expected here.

---

**Status:** DRAFT v1 — ready for Codex pickup the moment the next P1 burst starts. No 楊董 ack required to proceed (defaults applied), but any of the 8 open Q can be re-run if 楊董 overrides.
