# Codex M-3 Paper Fills Readout — 2026-05-06

## Trade Capability Score

+1

## User-visible workflow improved

`/portfolio` now reads both paper position and paper fill endpoints, so the paper workflow can show a visible chain from filled simulated orders to aggregated paper positions. This is read-only and does not create, submit, cancel, or route any order.

## Endpoint / source list

- `GET /api/v1/paper/portfolio`
- `GET /api/v1/paper/fills`

## State semantics

- `LIVE`: endpoint returns rows and the table renders real paper fills / positions.
- `EMPTY`: endpoint returns an empty array; UI shows no filled paper orders and does not invent rows.
- `BLOCKED`: auth/API fails; UI shows the friendly blocker and keeps values at safe zero.

## Safety proof

- No token display/logging.
- No fake-live rows: empty/blocked states do not invent fills or positions.
- No order submit: `/portfolio` only calls read endpoints.
- No KGI write-side / broker route.
- No FinMind / K-line fill price: fill price comes only from `/api/v1/paper/fills`.
- Internal user fields and idempotency keys are not typed into the visible fill row model and are not rendered.

## Checks

- `pnpm.cmd --filter @iuf-trading-room/contracts build` PASS
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS
- `pnpm.cmd --filter @iuf-trading-room/web build` PASS
- `git diff --check` PASS with CRLF warnings only

## Screenshot manifest

- `evidence/w7_paper_sprint/local_visual_qa_m3_fills_2026-05-06/manifest.json`
- `evidence/w7_paper_sprint/local_visual_qa_m3_fills_2026-05-06/desktop1365_portfolio_fills.png`
- `evidence/w7_paper_sprint/local_visual_qa_m3_fills_2026-05-06/mobile390_portfolio_fills.png`

Local QA used a non-secret local session-presence cookie. Production API rejected it as invalid, so the expected visual state is `BLOCKED`, proving no fake rows are shown.

## Next

After PR #216 and this PR merge/deploy, Bruce should run authenticated production smoke for:

1. `/portfolio` renders `GET /api/v1/paper/portfolio`.
2. `/portfolio` renders `GET /api/v1/paper/fills`.
3. No `userId`, idempotency key, token, `/order/create`, or `/paper/submit` appears in DOM.
