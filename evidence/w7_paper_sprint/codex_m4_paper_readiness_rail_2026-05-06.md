# Codex M-4 Paper Readiness Rail

Date: 2026-05-06
Branch: `feat/web-paper-readiness-rail-2026-05-06`
Trade Capability Score: `+1`

## What changed

- `/portfolio` now reads the existing read-only `GET /api/v1/paper/health/detail` endpoint.
- The page displays a six-step Paper E2E readiness rail:
  - risk preview
  - paper ticket
  - paper submit stage
  - paper fills
  - paper portfolio
  - audit log
- Each stage shows `READY`, `DEGRADED`, `BLOCKED`, or `ERROR` without turning missing rows into fake success.

## Source / endpoint list

- `GET /api/v1/paper/health/detail`
- `GET /api/v1/paper/portfolio`
- `GET /api/v1/paper/fills`

## User-visible workflow improved

The paper trading page no longer only says “no position” or “no fills.” It now shows which backend stage is ready or blocked, so the operator can understand whether preview, paper ticket, paper submit, fills, portfolio aggregation, and audit logging are available.

## Safety proof

- No token value is rendered or logged.
- No KGI write-side code is touched.
- No real-order route is touched.
- No paper order is created by this UI.
- No `POST /api/v1/paper/submit` call is added.
- FinMind and K-line data are explicitly described as reference-only, not fill price or risk source.
- Internal `userId` and `idempotencyKey` fields are not displayed.

## Checks

- `pnpm.cmd --filter @iuf-trading-room/contracts build` PASS
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS
- `pnpm.cmd --filter @iuf-trading-room/web build` PASS
- Local 1365px + 390px browser QA PASS

## Screenshot manifest

- `evidence/w7_paper_sprint/local_visual_qa_m4_paper_readiness_2026-05-06/manifest.json`
- `evidence/w7_paper_sprint/local_visual_qa_m4_paper_readiness_2026-05-06/desktop1365_portfolio_readiness.png`
- `evidence/w7_paper_sprint/local_visual_qa_m4_paper_readiness_2026-05-06/mobile390_portfolio_readiness.png`

## Blocker / next

This is stacked on PR #219, which is stacked on PR #216. Merge order remains:

1. #216 paper portfolio wire
2. #219 paper fills readout
3. this M-4 paper readiness rail PR

