# Codex M-2 Portfolio Wire-Up - 2026-05-06

Status: PR PREP
Owner: Codex frontend product owner lane
Branch: feat/web-wire-paper-portfolio-2026-05-06
Trade Capability Score: +1

## Workflow Improved

`/portfolio` now reads the paper portfolio endpoint directly instead of the older mixed `trading/*` and risk-surface paths. The page is a read-only paper portfolio surface: positions, share counts, odd-lot / board-lot clarity, simulated capital baseline, and no-broker boundary.

## Files Changed

- `apps/web/app/portfolio/page.tsx`
- `apps/web/lib/paper-orders-api.ts`
- `apps/web/app/globals.css`

## Endpoint / Source

- `GET /api/v1/paper/portfolio`

Expected backend shape:

```json
[
  {
    "symbol": "2330",
    "netQtyShares": 1000,
    "avgCostPerShare": 780.5,
    "fillCount": 1,
    "note": null
  }
]
```

## State Semantics

- LIVE: route returns one or more paper positions.
- EMPTY: route returns an empty array; page says there are no filled simulated orders and does not invent positions.
- BLOCKED: route fails or auth expires; page shows the reason and keeps all numbers at safe zero display.

## Safety Proof

- No token display or logging.
- No `/order/create` route call.
- No KGI / broker write-side call.
- No `submitPaperOrder` call from this page.
- No FinMind / K-line price used as fill price or risk source.
- Taiwan stock unit is explicit: `1 張 = 1,000 股`, while every position also shows actual share count.

## Checks

- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS
- `pnpm.cmd --filter @iuf-trading-room/web build` PASS
- `git diff --check` PASS with CRLF warnings only

## Screenshot Manifest

- Clean manifest: `evidence/w7_paper_sprint/local_visual_qa_m2_portfolio_2026-05-06/manifest.md`
- Desktop: `desktop1365_final2.png`
- Mobile: `mobile390_final2.png`

Local visual QA used a dummy local-only `iuf_session` cookie to pass middleware; the API correctly returned blocked/auth-expired state without exposing token values.
