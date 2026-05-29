# Codex heatmap visible representatives coordination - 2026-05-29 23:35 TST

## Latest state checked

- `origin/main`: `7aec94d fix(ai-rec-v3): expose source states and canonical names (#784)`.
- Open PRs observed:
  - `#786 fix(ci): wait longer for Railway deployment convergence` - Codex workflow false-red fix; merged after checks passed (`fd05a74`).
  - `#757 feat(strategy): V3 7-axis...` - Jason/backend schema lane, do not touch.
- Elva lane remains F-AUTO / S1 / KGI SIM readiness. This cycle avoids `apps/api/src/server.ts`, `tests/ci.test.ts`, migrations, contracts, and `IUF_QUANT_LAB`.

## P0 chosen task

Heatmap fixed representative pools still had a structural weakness: each sector pool was only 12-13 symbols and the UI correctly hides `sourceState="no_data"` rows to avoid gray empty tiles. When 3-5 fixed representatives have no verifiable quote, a sector can fall under Yang's required 10 visible tiles.

## Frontend-safe fix

- Keep representative pools fixed and curated, not random sector dumps.
- Expand every visible sector pool to exactly 15 Taiwan tickers.
- Raise the per-sector render cap from 13 to 15.
- Keep missing no-data representatives hidden instead of rendering gray filler tiles.
- Add source-gate tests so future changes cannot shrink sector pools below the 15-symbol buffer.

## Verification

- Production precheck: current `/` heatmap is no longer gray/no-data, and shipping renders 10 tiles on 2026-05-29 data.
- Local tests: `pnpm.cmd --filter @iuf-trading-room/web test -- industry-heatmap-representatives` passed.
- Local typecheck: contracts build + `pnpm.cmd --filter @iuf-trading-room/web typecheck` passed.
- Local production build: `pnpm.cmd --filter @iuf-trading-room/web build` passed with the existing Sentry/OpenTelemetry warning only.
