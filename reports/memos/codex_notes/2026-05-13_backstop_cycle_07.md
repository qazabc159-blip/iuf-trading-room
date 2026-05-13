# Codex Backstop Cycle 07 - 2026-05-13 14:25 TST

## Shipped

- Cleaned Lab render-path wording so the strategy pages avoid endorsement and capital-deployment phrasing.
- Restored web type safety after the v0.3.1 / TWSE OpenAPI homepage merge by wiring the missing market dashboard API client functions and types.
- Finished the homepage realtime-market data path: `loadRealtimeMarketDashboard()` is now included in the parallel fetch set, KGI core heatmap is preferred when available, and `HeroPanel` receives realtime index/breadth data instead of falling through undeclared variables.

Changed files:

- `apps/web/app/lab/page.tsx`
- `apps/web/app/lab/LabClient.tsx`
- `apps/web/app/lab/three-strategy/page.tsx`
- `apps/web/app/lab/three-strategy/[strategyId]/page.tsx`
- `apps/web/app/lab/three-strategy/[strategyId]/StrategyDetailClient.tsx`
- `apps/web/app/lab/three-strategy/[strategyId]/StrategyChartPanel.tsx`
- `apps/web/app/lab/three-strategy/cont_liq_v36/page.tsx`
- `apps/web/app/lab/three-strategy/cont_liq_v36/ContLiqPeriod1Panel.tsx`
- `apps/web/app/lab/three-strategy/cont_liq_v36/ContLiqHistoricalEvidencePanel.tsx`
- `apps/web/app/page.tsx`
- `apps/web/lib/api.ts`
- `apps/web/lib/radar-lab.ts`
- `apps/api/src/server.ts`

## Verified

- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS.
- `pnpm.cmd --filter @iuf-trading-room/api typecheck` PASS.
- Lab render-path wording scan PASS for the strategy/lab surface.
- Homepage realtime-market compile path PASS: KGI/TWSE client functions and `HeroPanel.realtimeMarket` are now typechecked together.
- Production API `/health` PASS.
- Taipei KGI EC2 is `stopped` after the 14:10 TST cost-control schedule, as expected.
- Taipei weekday stop schedule is enabled.

## Blockers / Yellow

- Production Lab snapshot API returns 401 without session context; this is expected for unauthenticated shell probes. Browser/session QA remains the right verification route.
- General API code still contains content-draft status literals such as `approved`; these are content workflow statuses, not Lab strategy render-path wording.
- KGI gateway is intentionally off after 14:10 TST. Next autostart proof is the 2026-05-14 08:20 TST cycle.
- cont_liq Period 1 Day 5 remains a real forward-observation drawdown warning: basket -9.30% vs 0050 -0.26%, data finality still needs canonical-source retro-verify.

## Owner Map

- Codex: Lab wording cleanup + typecheck repair complete; next is intraperiod drawdown reconstruction.
- Athena: keep strategy truth board aligned with Day 5 drawdown and post-KGI state.
- Scott: turn CPCV / PBO / WRC plan into executable scripts.
- Diana: retro-verify Day 5 adjusted-close data once source credentials are usable.
- Elva/Jason: keep homepage v0.3.1 market dashboard consuming the new TWSE/KGI client functions.
- Bruce: verify next Taipei gateway autostart cycle and Lab render-path wording after merge.

## Next 30-Min Actions

1. Build cont_liq historical intraperiod drawdown reconstruction plan and input locator.
2. Prepare a small PR / patch summary for Elva so the wording + typecheck fix is not lost in the dirty tree.
3. Keep production broker-write at zero and leave KGI EC2 schedule untouched.

## Yang Needed

- Not needed for this cycle.
- Future Yang decision still needed for MAIN PBO path and any production broker action.

## Hard Lines

- no broker action
- no production write
- no registry change
- no shared-contract edit
- no secret echo
- no promotion wording
