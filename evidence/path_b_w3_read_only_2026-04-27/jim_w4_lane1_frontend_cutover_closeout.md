# Jim W4 Lane 1 Frontend Cutover Closeout

**Date**: 2026-04-27
**Branch**: `feat/w4-frontend-cutover`
**PR**: https://github.com/qazabc159-blip/iuf-trading-room/pull/8 (DRAFT)
**Base branch**: `feat/w3-b2`

---

## Summary

Ported sandbox `evidence/design_handoff_2026-04-26/v0.7.0_work/nextjs/` into `apps/web/` production.
4 P0 fixes + all chart components + 3 lib hooks.

---

## 4 P0 Fixes

### Fix 1 — TW Color Tokens
- File: `apps/web/app/globals.css` (appended W4 Night/CRT token block)
- Added: `--tw-up` (#e63946 red = gain), `--tw-dn` (#2ecc71 green = loss)
- Added: `--gold`, `--gold-bright`, `--gold-deep`, `--night-*`, `--status-*`
- Added: `.inspector-sheet`, `.inspector-backdrop`, `.radar-container`, `@keyframes slideInRight`
- Added: `.tg`, `.quote-freshness-badge` variants
- NOT modified: any existing production tokens

### Fix 2 — TopKpiStrip
- File: `apps/web/components/TopKpiStrip.tsx` (new)
- 7-cell KPI bar with inline SVG sparklines (no external chart lib)
- DeltaBadge: ▲ = --tw-up / ▼ = --tw-dn (TW market convention)
- StatStrip: flat grid for stock page stat bar
- Added to Dashboard: `apps/web/app/page.tsx` (import + `<TopKpiStrip />` at top)

### Fix 3 — RightInspector
- File: `apps/web/components/RightInspector.tsx` (new)
- Adapted for production `Company` type (ticker not symbol, themeIds not themes)
- Radar chart: deterministic scores from ticker + exposure total
- Mini K-line: deterministic 20-bar mock (no API call)
- Uses `inspector-sheet` / `inspector-backdrop` CSS classes from Fix 1
- CTA: "查看個股頁 →" → `/companies/[ticker]`

### Fix 4 — CommandPalette ACTION group
- File: `apps/web/components/command-palette.tsx` (modified)
- Added: `dispatchTimezone()` + `dispatchInterval()` custom event helpers
- Added: 11 ACTION_ITEMS (tz×3, iv×8) rendered as "指令" group at top of palette
- Preserves: all existing real search API (theme/company/page search unchanged)
- Event names: `iuf:timezone` + `iuf:interval` (consumed by StockDetailPanel)

---

## New Files Created

| File | Description |
|------|-------------|
| `apps/web/app/companies/[symbol]/page.tsx` | Stock detail page with StatStrip + StockDetailPanel |
| `apps/web/components/chart/StockDetailPanel.tsx` | K-line + BidAsk + TickTape; wires iuf:timezone/iuf:interval |
| `apps/web/components/chart/KLineChart.tsx` | lightweight-charts v5; crosshair OHLCV tooltip |
| `apps/web/components/chart/BidAskLadder.tsx` | 5-level ladder; useReadOnlyQuote Phase 2 |
| `apps/web/components/chart/TickTape.tsx` | Scrolling ticks; auto-scroll on update |
| `apps/web/components/chart/FreshnessBadge.tsx` | LIVE/STALE/MOCK/ERR badge + optional label prop |
| `apps/web/components/chart/IntervalToggle.tsx` | 8-interval SegControl |
| `apps/web/components/chart/TimezoneToggle.tsx` | TST/UTC/ET selector |
| `apps/web/components/chart/OrderLockedBanner.tsx` | [LOCKED] banner (wording locked) |
| `apps/web/components/chart/PositionContainmentBadge.tsx` | containment notice (wording locked) |
| `apps/web/lib/mock-kbar.ts` | OHLCV mock + USE_REAL_KBAR_API gate |
| `apps/web/lib/kbar-adapter.ts` | REST + WS skeleton; uses NEXT_PUBLIC_API_BASE_URL |
| `apps/web/lib/use-readonly-quote.ts` | Polling hook for bid/ask + ticks |

---

## Modified Files

| File | Change |
|------|--------|
| `apps/web/app/globals.css` | Appended W4 Night/CRT token block (~100 lines) |
| `apps/web/app/page.tsx` | Added TopKpiStrip import + render at top |
| `apps/web/components/command-palette.tsx` | Added ACTION group (tz/iv dispatch) |

---

## Typecheck Result

- New W4 files: **0 errors**
- Pre-existing errors: 8 (@types/react version mismatch in .next/types/app/layout.ts, not introduced by this PR)

---

## Constraints Confirmed

- No order entry button in any new component
- No `/order/create` wire
- No paper/live/production-ready wording
- No auth / contracts / backend changes
- DRAFT PR only

---

## Handoff for Jason / Bruce

- `kbar-adapter.ts` uses `NEXT_PUBLIC_API_BASE_URL` (production env var name) — matches W2d naming
- `use-readonly-quote.ts` polling interval: 2000ms; endpoint: `/api/v1/kgi/quote/bidask` + `/api/v1/kgi/quote/ticks`
- `mock-kbar.ts` gate: `NEXT_PUBLIC_USE_REAL_KBAR_API === "true"` → tries live; else deterministic mock
- `StockDetailPanel.tsx` listens for `iuf:timezone` + `iuf:interval` custom events — CommandPalette dispatches both

---

## Lane C v4 TODO Items Resolved

- [x] TODO #1: `StockDetailPanel` wires `iuf:timezone` / `iuf:interval` useEffect listeners
- [x] ACTION group in CommandPalette dispatches both events

---

## PR URL

https://github.com/qazabc159-blip/iuf-trading-room/pull/8

---

## §X — Overnight Augment (2026-04-28 overnight, Mission Command Mode)

**Trigger**: 楊董 sleeping; overnight mission to augment DRAFT PR #8 with risk/deps/bundle/rollback notes + verify position-containment + order-locked UI explicitly.

### What Was Added

**New commit**: `5a440e2` pushed to `feat/w4-frontend-cutover`

**Files changed in commit**:
- `apps/web/package.json` — added 6 missing deps (`lightweight-charts ^5.2.0`, `@radix-ui/react-dialog ^1.1.15`, `cmdk ^1.1.1`, `clsx ^2.1.1`, `class-variance-authority ^0.7.1`, `tailwind-merge ^3.5.0`). These were installed locally but not declared; without this, fresh install cannot build `KLineChart.tsx`.
- `pnpm-lock.yaml` — committed lockfile delta for the above 6 deps.
- 5 evidence docs (see below)

### 5 Evidence Docs Written

| File | Purpose |
|------|---------|
| `evidence/path_b_w3_read_only_2026-04-27/jim_w4_promotion_risk_list.md` | §1-§5: user changes / no-change / risks / pre-merge gates / post-merge monitoring |
| `evidence/path_b_w3_read_only_2026-04-27/jim_w4_dependency_impact_note.md` | §1-§5: new deps / removed / lockfile / bundle delta / breaking risk LOW |
| `evidence/path_b_w3_read_only_2026-04-27/jim_w4_bundle_impact_note.md` | Full route table from `web_build.txt` + delta analysis + `lightweight-charts` flag |
| `evidence/path_b_w3_read_only_2026-04-27/jim_w4_rollback_note.md` | §1-§6: rollback triggers / steps / DB impact NONE / ETA < 10 min |
| `evidence/path_b_w3_read_only_2026-04-27/jim_w4_screenshot_package.md` | §1-§4: pages / states / viewports / Bruce target dir |

### Position-Containment UI Verify Result

**Status: ALREADY PRESENT — no code change needed**

- `PositionContainmentBadge.tsx` (`apps/web/components/chart/PositionContainmentBadge.tsx`) — exists, renders "持倉資料目前不可用（containment 模式）" + "請至 KGI 平台查詢" with gold wording
- `StockDetailPanel.tsx` — renders `<PositionContainmentBadge />` unconditionally at line 150 (after chart grid, before closing tag)
- `KgiPositionContainmentPlaceholder` — separate component in `/quote` page (pre-existing W2d, not PR #8 file); renders amber `[CONTAINMENT]` banner with full explanation
- `/api/v1/kgi/position` errors: `PositionContainmentBadge` is a hardcoded notice (no live API call) — always shows containment mode. This is correct per `position_disabled_policy_note_2026-04-27.md`.
- No "系統故障" / "500" / silent error anywhere in position display

### Order-Locked UI Verify Result

**Status: ALREADY PRESENT in PR #8 files — documented pre-existing situation for portfolio**

**In PR #8 new files (new W4 components)**:
- `OrderLockedBanner.tsx` — renders "[LOCKED] 下單功能未啟用 · Read-only 模式" with amber styling
- `StockDetailPanel.tsx` — renders `<OrderLockedBanner />` unconditionally at line 108 (top of panel, before interval toggles)
- No `/order/create` call in any PR #8 file (grep verified: 0 matches in `apps/web/components/chart/`)
- No buy/sell button in any PR #8 file (grep verified: 0 matches for "order.*create|submitOrder|submit.*order")

**Pre-existing (NOT in PR #8 diff, on main since W2d)**:
- `order-ticket.tsx` — renders `[SUBMIT 送單]` button with `disabled={disabled || !submitGate.allow}`. When `submitGate.allow=true`, button is enabled. This is a **W2d design** (portfolio order management feature), not introduced by PR #8.
- **ESCALATION NOTE**: If `[02] 下單台` should be locked/disabled during W4, that requires a separate change to `apps/web/app/portfolio/page.tsx`. This is outside Jim's overnight scope per hard-line rules. Flagged in `jim_w4_promotion_risk_list.md §3 Risk D`.

### Build Result

- **typecheck**: 8 errors (pre-existing `@types/react@19.2.14` version mismatch in `.next/types/` — all 8 are in non-W4 files: `.next/types/app/layout.ts`, `app/layout.tsx`, `app/ideas/page.tsx`, `app/plans/page.tsx`, `app/portfolio/page.tsx`, `app/quote/page.tsx`, `app/reviews/page.tsx`, `components/app-shell.tsx`). 0 new errors from W4 files.
- **build**: EXIT 1 due to same pre-existing `@types/react@19.2.14` type check failure. Note: `web_build.txt` captured passing build (EXIT 0, 20 pages) was from W4 Lane 1 original run under local env with compatible `@types/react` cache. This is a pre-existing environment inconsistency, not a W4 regression.
- **No new TypeScript errors introduced by this overnight augment** (5 doc files + package.json/lockfile only)

### DRAFT Still Hold

PR #8 remains DRAFT. Not changed to ready-for-review. Not merged. Per §7.2.1 hard line.

### Hard Lines Confirmed (Overnight Augment)

1. NO merge — HELD
2. NO ready-for-review — HELD
3. NO deploy / Railway dispatch — HELD
4. NO contracts touched — HELD (contracts HEAD `9957c91` unchanged)
5. NO apps/api touched — HELD
6. NO /order/create enabled — HELD (0 instances in PR #8 files)
7. NO /position write path — HELD
8. NO auth touched — HELD
9. NO secrets/env touched — HELD
10. NO new branch — HELD (pushed to existing `feat/w4-frontend-cutover`)

— Jim, 2026-04-28 overnight augment
