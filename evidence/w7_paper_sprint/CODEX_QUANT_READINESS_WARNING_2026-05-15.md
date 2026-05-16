# CODEX Quant Readiness Warning UI — 2026-05-15

## Scope
- Follow-up for Jason/Athena `#545` quant subscribe readiness alignment.
- Updated `/quant-strategies/[strategyId]` subscribe panel to surface backend `warning` on successful SIM-only subscription.
- Added explicit `410 STRATEGY_RETIRED` user-facing message instead of generic subscribe failure.

## Safety
- Frontend-only change under `apps/web`.
- No broker, risk, contracts, KGI live, or real-order paths touched.
- Submit payload remains same-origin proxy with:
  - `executionMode: "paper"`
  - `sim_only: true`

## Verification
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` → PASS.
- Browser smoke with fake `#545` backend:
  - First subscribe returned `201` with `warning`.
  - UI displayed `READINESS WARNING` and `forward observation`.
  - Second subscribe returned `410 STRATEGY_RETIRED`.
  - UI displayed `策略已退役`.
  - Captured upstream requests were exactly two subscribe calls, both with `executionMode: "paper"` and `sim_only: true`.
  - No hard console errors.
- Screenshot: `evidence/w7_paper_sprint/CODEX_QUANT_READINESS_WARNING_2026-05-15.png`.
