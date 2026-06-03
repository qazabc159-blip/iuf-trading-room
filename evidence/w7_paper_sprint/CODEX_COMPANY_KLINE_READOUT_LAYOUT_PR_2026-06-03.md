# Codex Evidence - Company K-line Readout Layout

Date: 2026-06-03
Branch: fix/kline-readout-placement-20260603

## Scope

Frontend-only company/trading-room K-line polish. Yang reported that the company-page K-line top-right readout box can cover chart information. This change moves the readout out of the chart canvas and turns it into a normal top information row inside the chart shell.

## Shipped

- Company-page K-line readout is no longer absolutely positioned over the chart canvas.
- The readout now sits above the chart as a full-width compact information row.
- The chart canvas is explicitly ordered below the readout.
- Desktop readout uses a 4-column grid: label, price, date, OHLCV detail.
- Mobile readout wraps detail to a new line instead of overflowing.
- Trading-room compact iframe override remains intact and is not redesigned in this PR.

## Files Changed

- `apps/web/app/globals.css`
- `apps/web/lib/final-v031-paper-ticket.test.ts`

## Verification

- `pnpm.cmd --filter @iuf-trading-room/web test -- final-v031-paper-ticket`
  - 28 files passed
  - 249 tests passed
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
  - passed
- `pnpm.cmd --filter @iuf-trading-room/web build`
  - passed
  - Existing Sentry/OpenTelemetry dynamic import warning remains unrelated to this change.
- `git diff --check`
  - no whitespace errors; only Windows CRLF conversion warnings.

## Hardline Check

- No backend endpoints touched.
- No broker/risk/contracts touched.
- No fake live data introduced.
- No KGI live broker write path touched.
- No tactical homepage redesign.
