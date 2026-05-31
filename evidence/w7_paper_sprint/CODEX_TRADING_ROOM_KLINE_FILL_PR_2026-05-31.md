# Trading Room K-line Fill Follow-up - 2026-05-31

## Scope

- Follow-up for the production trading room layout rescue.
- Fixes the remaining visual issue where the K-line iframe container was wide, but the actual company-page chart body stayed constrained on the left and left a large empty black area.
- Frontend only. No backend, KGI, contracts, migrations, broker/risk, or live-order paths touched.

## Changes

- Force the trading-room K-line frame root to use `100vw`.
- Force the embedded K-line host, panel, chart shell, and canvas to stretch to the available iframe width.
- Keep the previous stability fix intact: no timestamp `rev` reload on live refresh and no overlay price ribbon blocking the canvas.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/web test`
  - 27 files passed
  - 232 tests passed
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
  - pass

## Notes

- This PR does not hide or remove the tape/ledger sections.
- This PR does not degrade or suppress chart features; it corrects the iframe sizing so the real company-page chart fills the trading-room center pane.
