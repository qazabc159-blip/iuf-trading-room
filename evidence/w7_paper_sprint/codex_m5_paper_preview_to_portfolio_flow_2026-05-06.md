# Codex M-5 — Paper Preview To Portfolio Flow

Time: 2026-05-06 19:20 Taipei

Trade Capability Score: +1

## Workflow Improved

The company page paper ticket now tells the user where the workflow goes after preview:

- Company page paper preview is explicitly labelled as preview, not a real order.
- The panel shows symbol, unit, actual shares, estimated notional, demo capital, and Taiwan stock unit rules.
- The user gets direct links to `/portfolio#paper-readiness` and `/portfolio#paper-fills`.
- `/portfolio` now exposes stable anchors for the readiness rail and paper fill readout.

## Sources / Endpoints

- `GET /api/v1/paper/health`
- `POST /api/v1/paper/preview`
- `GET /api/v1/paper/orders`
- `GET /api/v1/paper/health/detail`
- `GET /api/v1/paper/portfolio`
- `GET /api/v1/paper/fills`

No new backend route was added. This PR does not alter execution behavior.

## Unit Safety

- Default remains `SHARE` / odd-lot flow.
- The guide repeats that `1 張 = 1,000 股`.
- Estimated notional uses the same frontend unit conversion helpers as the existing ticket.
- UI states that FinMind / K-line is reference data only and not a fill price.

## Screenshot Manifest

`evidence/w7_paper_sprint/local_visual_qa_m5_paper_flow_2026-05-06/manifest.json`

Screenshots:

- `desktop1365_company2330_flow_default.png`
- `desktop1365_company2330_lot_unit.png`
- `desktop1365_portfolio_readiness_anchor.png`
- `mobile390_company2330_flow.png`

## Checks

- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS
- `pnpm.cmd --filter @iuf-trading-room/web build` PASS
- `pnpm.cmd run build:api` PASS
- `git diff --check` PASS, CRLF warnings only
- Browser QA: local web + local memory API, no production credentials
- 1365px: no horizontal overflow
- 390px: no horizontal overflow

## Stop-Line Proof

- No token displayed or logged.
- No real-order route was added or touched.
- No KGI write-side.
- No new submit call.
- No fake fill.
- No FinMind / K-line fill price.
- No paper or live readiness claim.
- No buy/sell recommendation.

## Stack Dependency

This is stacked after:

1. #216 paper portfolio wire
2. #219 paper fills readout
3. #221 paper readiness rail

It should be reviewed after the stack is queued or merged in order.
