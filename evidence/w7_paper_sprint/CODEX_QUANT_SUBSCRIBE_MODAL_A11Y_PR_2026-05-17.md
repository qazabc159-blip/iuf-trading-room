# CODEX Quant Subscribe Modal A11y PR - 2026-05-17

## Scope
- Branch: `fix/web-quant-subscribe-modal-a11y-pr-2026-05-17`
- Base: `origin/main` at `b4f2952` (`fix(web): label portfolio frame as sim preview (#579)`)
- Frontend-owned change only: `apps/web/app/quant-strategies/[strategyId]/StrategyDetailClient.tsx`
- No API, broker, risk, contract, or order-path changes.

## Shipped
- The `/quant-strategies/cont_liq_v36` SIM subscription confirmation dialog now:
  - Moves focus to the cancel button when opened.
  - Supports Escape close while not busy.
  - Supports backdrop click close while not busy.
  - Restores focus to the launcher button after close.
  - Provides `aria-describedby="sim-confirm-description"` for the dialog body copy.
  - Renders through a portal into `document.body`, so the backdrop covers the tactical chrome instead of sitting inside the page stacking context.

## Verification
- `pnpm.cmd install --frozen-lockfile --prefer-offline` - pass
- `pnpm.cmd --filter @iuf-trading-room/contracts build` - pass
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` - pass after final portal change

## Browser Smoke
- Target: `http://127.0.0.1:3065/quant-strategies/cont_liq_v36`
- Session: `iuf_session=codex-smoke`
- Viewport: `1366x900`
- Assertions:
  - SIM-only safety checkbox enables `建立 SIM 訂閱`.
  - Dialog opens with `aria-describedby="sim-confirm-description"`.
  - Focus after open: `取消`.
  - Escape closes the dialog and restores focus to `建立 SIM 訂閱`.
  - Left-top backdrop hit target is `QuantStrategies_modalBackdrop__2NcO1`.
  - Backdrop click closes the dialog and restores focus to `建立 SIM 訂閱`.
  - Browser console errors/warnings: `0`.
  - Page errors: `0`.
  - Failed requests: `0`.
  - HTTP 4xx/5xx responses: `0`.

## Artifact
- Screenshot: `evidence/w7_paper_sprint/quant-subscribe-modal-a11y-1366x900.png`
