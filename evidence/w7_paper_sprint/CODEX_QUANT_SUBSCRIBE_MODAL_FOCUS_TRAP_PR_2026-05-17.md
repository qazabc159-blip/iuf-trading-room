# CODEX Quant Subscribe Modal Focus Trap PR - 2026-05-17

## Scope
- Branch: `fix/web-quant-modal-focus-trap-pr-2026-05-17`
- Base: `origin/main` at `fdd7c35` (`fix(web): improve quant subscribe modal accessibility (#580)`)
- Frontend-owned change only: `apps/web/app/quant-strategies/[strategyId]/StrategyDetailClient.tsx`
- No API, broker, risk, contract, or order-path changes.

## Shipped
- Completed the `/quant-strategies/[strategyId]` SIM subscription confirmation modal keyboard loop.
- Tab from the final dialog action wraps back to the cancel action.
- Shift+Tab from the cancel action wraps to the final dialog action.
- If no enabled dialog controls remain during a busy state, focus stays on the dialog shell instead of escaping to the page behind it.
- Escape close, backdrop close, body-portal backdrop coverage, and focus restore from #580 remain intact.

## Verification
- `pnpm.cmd install --frozen-lockfile --prefer-offline` - pass
- `pnpm.cmd --filter @iuf-trading-room/contracts build` - pass
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` - pass

## Browser Smoke
- Target: `http://127.0.0.1:3066/quant-strategies/cont_liq_v36`
- Session: `iuf_session=codex-smoke`
- Viewport: `1366x900`
- Assertions:
  - SIM-only safety checkbox enables `建立 SIM 訂閱`.
  - Dialog opens with `aria-describedby="sim-confirm-description"`.
  - Focus after open: `取消`.
  - Shift+Tab from cancel wraps to `確認建立`.
  - Tab from `確認建立` wraps to `取消`.
  - Escape closes and restores focus to `建立 SIM 訂閱`.
  - Left-top backdrop hit target is `QuantStrategies_modalBackdrop__2NcO1`.
  - Backdrop click closes and restores focus to `建立 SIM 訂閱`.
  - Browser console errors/warnings: `0`.
  - Page errors: `0`.
  - Failed requests: `0`.
  - HTTP 4xx/5xx responses: `0`.

## Artifact
- Screenshot: `evidence/w7_paper_sprint/quant-subscribe-modal-focus-trap-1366x900.png`
