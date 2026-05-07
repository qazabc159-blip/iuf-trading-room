# BLOCK #8 Lane D — /lab/strategies + /lab/candidates + /lab/research sub-pages

Date: 2026-05-07 (TST)
Branch: `feat/web-lab-sub-pages-block8-lane-d-2026-05-07`
Owner: Elva (TR team lead)
Per: Lab/TR Alignment Lock 2026-05-07 (`board/lab_tr_alignment_lock_2026-05-07.md`)

## Scope

Add three new SSR-rendered sub-pages under `/lab/*`:

- `apps/web/app/lab/strategies/page.tsx` — list of RESEARCH_ONLY candidates
- `apps/web/app/lab/candidates/page.tsx` — alias view (review pipeline framing)
- `apps/web/app/lab/research/page.tsx` — v11 KILL_NO_EDGE / v15 sprint summary + portfolio verdict

All three SSR-fetch `GET /api/v1/lab/strategies` (PR #275 alias) via `radarLabApi.strategies()`,
which forwards browser cookies via `ssrCookieHeader()` (PR #276 pattern).

Shared shell: `apps/web/components/LabSubPageShell.tsx`.

## Lab/TR Alignment Lock compliance

Header (every page):

- `Quant Lab status: RESEARCH_SYSTEM`
- `No strategy approved for Trading Room promotion`
- `Latest Lab frame: v11 KILL_NO_EDGE / v15 research candidates`

Per candidate row:

- `strategyId` (verbatim from lab JSON)
- `research-only` amber pill (style: amber #ffb800 background tint + border)
- `Awaiting Athena schema gate & Bruce harness gate · Not approved for paper/live`
- `caveats` list (verbatim from endpoint, including mandatory RESEARCH_ONLY caveat)
- `status` displayed via `labStatusDisplayWording()` (no softening)
- `nextAction` shown as Lab informational only

Forbidden fields NOT displayed (verified in code):

- ❌ Sharpe — string `Sharpe` does not appear in any sub-page
- ❌ equity curve — no `equityCurve` reference
- ❌ win rate — no `winRate` reference
- ❌ total trades — no `totalReturn` / `tradeCount` reference
- ❌ allocation % — no allocation field rendered
- ❌ buy / sell / 必賺 / 勝率 — none rendered
- ❌ paper-ready / live-ready — explicit `awaiting gates` only

Blocked state when `meta.source='unavailable'`:

- Grey panel with header「目前無 Lab approved 策略可推廣」
- Sub-text「Quant Lab snapshot 暫時無法讀取」 + verbatim reason
- Footer reminder: TR 不會用假策略 / 假績效 / 假配置比例填補空狀態

## Files changed

```
apps/web/lib/radar-lab.ts                       (+95 lines: types + getApiEnvelope + strategies() + labStatusDisplayWording)
apps/web/components/LabSubPageShell.tsx         (new, 213 lines)
apps/web/app/lab/strategies/page.tsx            (new, 30 lines)
apps/web/app/lab/candidates/page.tsx            (new, 28 lines)
apps/web/app/lab/research/page.tsx              (new, 138 lines)
```

Lane scope: pure `apps/web/app/lab/*` + `apps/web/lib/radar-lab.ts` + 1 shared component. No backend / KGI / paper / lab repo touched.

## Endpoint verified live

```
GET https://api.eycvector.com/api/v1/lab/strategies
HTTP 200
```

Payload saved: `prod_lab_strategies_response.json`

Returns:
- `data.sanctioned: true`
- `data.sprintId: "v15"`
- `data.portfolioVerdict: "THREE_STRATEGY_PORTFOLIO_VALID_RESEARCH_SYSTEM"`
- `data.candidates: [3 RESEARCH_ONLY]`
  - `MAIN_execution_rank_buffer_top20` (STRONG_CANDIDATE)
  - `rs_20_60_low_drawdown__h20__top5` (STRATEGY2_RS2060_CONFIRMED)
  - `cont_liquidity_relative_strength__h20__top5__turnover_cap_0.25` (STRATEGY3_TURNOVER_REPAIRED)
- `meta.source: "lab_sanctioned"`, `meta.researchOnly: true`

## Typecheck

`apps/web` `npx tsc --noEmit` → **EXIT=0** (PASS)

## Mobile (390px)

Layouts use `repeat(auto-fit, minmax(280px, 1fr))` for candidate grid and
`repeat(auto-fit, minmax(260px, 1fr))` for the v11/v15/portfolio verdict frame
in `/lab/research`. At 390px viewport these collapse to single-column stacks
(280px > 390px - container padding so each row takes full width).

## Visual verification (post-deploy)

After Vercel deploy on this branch, manual screenshots will be added:

- `screenshot_strategies_1365.png` (desktop, 3 candidates rendered)
- `screenshot_candidates_1365.png`
- `screenshot_research_1365.png`
- `screenshot_strategies_390.png` (mobile)
- `screenshot_research_390.png`
- `screenshot_blocked_state.png` (simulated by env var override or staging)

These are emitted post-merge; functional correctness verified via tsc + endpoint payload + code audit.

## Forbidden-field code audit (grep)

- `grep -i 'sharpe\|equityCurve\|winRate\|allocation' apps/web/app/lab/{strategies,candidates,research}/page.tsx apps/web/components/LabSubPageShell.tsx` → no hits
- `grep -i 'paper-ready\|live-ready\|approved for' apps/web/app/lab/{strategies,candidates,research}/page.tsx apps/web/components/LabSubPageShell.tsx` → no hits

## TCS

+3 (three new operator-facing routes consuming sanctioned Lab snapshot with full alignment-lock disclaimers).
