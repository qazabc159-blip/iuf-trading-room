# Codex Paper Order Preview Guard — 2026-05-06

## Trade Capability Score

+1

## User-visible workflow improved

Company-page paper ticket now blocks invalid / over-capital drafts before the operator can run the paper preview path.
This specifically protects Taiwan-stock unit safety: odd-lot `SHARE` remains 1 share, board-lot `LOT` remains 1,000 shares, and a high-price board-lot draft cannot be advanced as if it were a small odd-lot test.

## Page / component

- `apps/web/app/companies/[symbol]/PaperOrderPanel.tsx`

## Endpoint / source list

- `GET /api/v1/paper/health`
- `POST /api/v1/paper/preview`
- `POST /api/v1/paper/submit`
- `GET /api/v1/paper/orders`

## State semantics

- `LIVE`: paper preview can be requested only when quantity, unit, price, and demo-capital checks pass.
- `BLOCKED`: validation reasons now block the preview button and the handler, not only the final submit.
- `EMPTY`: no order history or no preview remains truthful; no fake fills are rendered.

## Checks

- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS
- `pnpm.cmd --filter @iuf-trading-room/web build` PASS
- `git diff --check` PASS with CRLF warnings only

## Proof

- no-token: PASS; no token/env path touched.
- no-fake-data: PASS; no mock data added or promoted to live.
- no-order: PASS; no KGI/broker/live route touched; this remains paper UI only.

