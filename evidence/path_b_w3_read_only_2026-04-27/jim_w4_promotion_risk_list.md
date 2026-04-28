# W4 Frontend Cutover — Production Promotion Risk List

**Date**: 2026-04-28 (overnight augment)
**Branch**: `feat/w4-frontend-cutover`
**PR**: #8 (DRAFT — do NOT merge per §7.2)
**Author**: Jim (frontend-consume-jim)

---

## §1 What Changes for Users (Visual + Interaction)

### New visual changes
- Dashboard `/` — `TopKpiStrip` 7-cell KPI bar added at top (PnL, exposure, drawdown, win rate, position count, daily gain, open risk). Mock data only.
- `/companies/[symbol]` — New stock detail page with `StatStrip` 8-cell header + `StockDetailPanel` (K-line chart, interval toggle, bid/ask ladder, tick tape)
- CRT color tokens — `--tw-up` (red = gain) / `--tw-dn` (green = loss) added globally per TW market convention
- `RightInspector` sheet — slide-in drawer from companies list rows, shows mini K-line + radar chart + catalyst list
- `CommandPalette` (⌘K) — 13 new ACTION items: timezone (TST/UTC/ET) and interval (1m/5m/15m/1h/4h/D/W/M) dispatch

### Interaction changes
- ⌘K palette now has a top "指令" group — typing ACTION commands changes chart timezone/interval live
- Companies list rows now have click-to-inspect via `RightInspector`
- `/companies/[symbol]` shows live bid/ask (polling every 2s) and tick tape when backend is connected

### What is visible in the inspector/chart
- K-line: mock data by default; live data when `NEXT_PUBLIC_USE_REAL_KBAR_API=true` (env gate)
- Bid/ask: live polling to `/api/v1/kgi/quote/bidask`; falls back to mock on error
- Ticks: live polling to `/api/v1/kgi/quote/ticks`; falls back to mock on error
- Both bid/ask and ticks display `[ERR→MOCK]` FreshnessBadge when endpoint unavailable

---

## §2 What Does NOT Change

- **No order entry capability** — `order-ticket.tsx` (`[02] 下單台`) is pre-existing from W2d. PR #8 adds zero order-entry code.
- **No position write** — no POST to any `/position` endpoint anywhere in PR #8 files
- **No paper trading activation** — no wording "paper ready", "live ready", "paper trading" in any PR #8 file
- **No broker integration** — PR #8 files do not import from broker routes
- **No auth changes** — login flow unchanged
- **No contracts changes** — `packages/contracts` HEAD `9957c91` unchanged
- **No backend changes** — `apps/api/src/*` unchanged
- **Kill switch** — portfolio kill switch UI unchanged (pre-existing)
- **Existing pages** — `/ideas`, `/runs`, `/runs/[id]`, `/portfolio`, `/quote`, `/briefs`, `/themes` all unchanged by this PR

---

## §3 Risks (Ranked by Impact)

### Risk A — MEDIUM: New deps missing from committed package.json
**Description**: `apps/web/package.json` at commit `f0b7834` does NOT include `lightweight-charts`, `@radix-ui/react-dialog`, `cmdk`, `clsx`, `class-variance-authority`, `tailwind-merge`. These are installed locally in `node_modules` but not declared. Fresh install / CI will fail to resolve `lightweight-charts` import in `KLineChart.tsx`.

**Impact**: Build fails on Railway / fresh clone. Must fix before merge.

**Fix**: Commit working-tree `package.json` + `pnpm-lock.yaml` to PR branch (already staged in overnight augment commit).

### Risk B — LOW: `/companies/[symbol]` not in `sitemap.xml` / static generation
**Description**: New dynamic route is server-rendered on demand (ƒ). No pre-generation needed. Sitemap not applicable (operator tool).

**Impact**: None — this is expected behavior for an operator tool.

### Risk C — LOW: Mock K-line shown to users until `NEXT_PUBLIC_USE_REAL_KBAR_API=true`
**Description**: By default `USE_REAL_KBAR_API=false` — charts show deterministic mock data. Users may be confused if they expect live data.

**Impact**: UX confusion only. No data integrity risk. `FreshnessBadge` shows `[MOCK]` label clearly.

**Mitigation**: `FreshnessBadge` wording is explicit. Tooltip explains endpoint state.

### Risk D — LOW: Pre-existing `order-ticket.tsx` `[SUBMIT 送單]` button (NOT from PR #8)
**Description**: `/portfolio` page has a full `OrderTicket` component with `[SUBMIT 送單]` button. This was merged as part of W2d (commit `95466f4`) and is NOT introduced by PR #8. The button is gated by `submitGate.allow` which depends on quote readiness + risk check. The server endpoint `/api/v1/orders` does exist and forwards to the broker.

**Impact**: Operator risk — portfolio page allows order submission if the system is live. This is a **pre-existing W2d design decision**, not a W4 regression.

**Note for Elva/楊董**: If `[02] 下單台` should be locked during W4, that requires a separate PR touching `apps/web/app/portfolio/page.tsx`. Jim scope does not cover this decision — escalating per hard-line rule.

---

## §4 Pre-Merge Gates

### Mandatory
- [ ] `typecheck` — run `pnpm -F @iuf-trading-room/web typecheck`; expected: 8 pre-existing errors only (all `@types/react` version mismatch), 0 new errors
- [ ] `build` — run `pnpm -F @iuf-trading-room/web build`; expected: EXIT 0, 20+ pages
- [ ] Verify `package.json` includes all new deps (`lightweight-charts`, `lightweight-charts/dist/lightweight-charts.standalone.development.mjs` check)
- [ ] `pnpm install` on fresh clone with committed `pnpm-lock.yaml`

### Manual smoke (before prod)
- [ ] `/companies/[symbol]` — loads StockDetailPanel, shows mock K-line, shows `[MOCK]` badge
- [ ] `/companies/[symbol]` — `OrderLockedBanner` visible at top of panel
- [ ] `/companies/[symbol]` — `PositionContainmentBadge` visible at bottom of panel
- [ ] Dashboard `/` — `TopKpiStrip` renders without JS error
- [ ] ⌘K palette — ACTION group visible, tz dispatch changes header without console error
- [ ] `RightInspector` — open/close via row click; Esc key closes; backdrop click closes

---

## §5 Post-Merge Monitoring

### What to watch in Railway production logs
1. `[kbar-adapter]` console.warn — indicates `USE_REAL_KBAR_API=true` but endpoint unreachable
2. `[use-readonly-quote]` console.warn — bid/ask polling failure
3. Any `500` on `/companies/[*]` — new dynamic route regression

### What to watch in browser console
1. `iuf:timezone` / `iuf:interval` CustomEvent dispatch — should fire on ⌘K ACTION
2. `lightweight-charts` initialization warning — if canvas not mounted

### Rollback trigger
- Any `500`/`404` on pages that existed before (dashboard, ideas, runs, portfolio)
- Build regression (new TypeScript errors in CI)
- User-visible crash (white screen) on any existing page
