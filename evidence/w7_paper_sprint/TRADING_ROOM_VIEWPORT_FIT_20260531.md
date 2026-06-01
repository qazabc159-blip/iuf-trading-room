# Trading Room Viewport Fit - 2026-05-31

Scope: Final v031 paper trading room embedded viewport and ticket panel fit.

## Issue

The production trading room could show ugly internal scrollbars and a slightly oversized embedded body:

- Safety bar + `.troom` height produced a small vertical overflow in the embedded document.
- The right-side paper ticket form could exceed its panel height at 1440x900.
- The extra internal scrollbars made the workbench feel like stacked iframes instead of a single trading surface.

## Fix

- Lock the embedded safety strip to exactly `34px`.
- Keep the trading room body at `calc(100dvh - 34px)`.
- Compact the right-side ticket form gap.
- Hide ticket form overflow after making the contents fit the panel.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/web test -- final-v031-paper-ticket.test.ts`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- Local browser check at `1440x900`:
  - document/body `scrollHeight == clientHeight`
  - document/body `scrollWidth == clientWidth`
  - `.tform` `scrollHeight == clientHeight`
  - `.tform` `scrollWidth == clientWidth`
  - K-line iframe frame remains clipped to its container

Evidence:

- `evidence/w7_paper_sprint/trading-room-viewport-fit-local-20260531.png`
- `evidence/w7_paper_sprint/trading-room-viewport-fit-local-20260531.json`
