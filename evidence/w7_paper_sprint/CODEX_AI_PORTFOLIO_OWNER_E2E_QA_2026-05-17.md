# CODEX AI to Portfolio Owner E2E QA - 2026-05-17

## Scope

- Frontend-owned QA and fix in `apps/web`.
- Flow tested: `/ai-recommendations -> /ai-recommendations/[id] -> /portfolio`.
- Safety boundary: no backend broker/risk/contracts changes, no KGI write path, no real-order promotion, no `apps/api` change, no `IUF_QUANT_LAB` or `IUF_SHARED_CONTRACTS` change, and no vendor homepage rewrite.

## Production Probe

- Target: `https://app.eycvector.com/ai-recommendations`.
- Result: redirected to `https://app.eycvector.com/login?next=%2Fai-recommendations`.
- Interpretation: true production Owner QA is blocked in this Codex browser because there is no Owner login state available.
- No credentials, session material, identity data, or production auth material were entered, copied, exported, or stored.

## Local E2E QA

- Ran local Next.js with a mock Recommendation Orchestrator / paper-room API.
- Used a local-only test login marker for localhost routing.
- Recommendation list rendered 3 cards.
- List handoff link preserved:
  - `ticker=2330`
  - `prefill=true`
  - `from_rec=rec_2330_20260514`
  - `side=buy`
  - entry / stop / target values
- Detail page rendered:
  - score blocks
  - data-quality display with degraded news / quant quality and 12% confidence penalty
  - source trail
  - risk blocks
  - active portfolio handoff link
- Feedback wiring verified:
  - `like` from list
  - `skip` from detail
  - `acted` from handoff navigation
- Portfolio handoff verified:
  - outer `/portfolio` wrapper forwarded the sanitized handoff query to the embedded paper room
  - embedded `#rec-prefill-box` rendered the AI recommendation SIM preview
  - order ticket symbol was prefilled with `2330`
  - order ticket price was prefilled from entry zone `950-960`
  - buy side was selected

## Bug Found And Fixed

- Finding: mobile `/portfolio` after AI handoff still rendered the embedded paper room as a three-column desktop grid inside the iframe.
- Cause: the vendor HTML had a mobile stacking rule, but the frontend route injected `trading.css` after that inline rule, so the later grid rule won.
- Fix: added a scoped mobile override in `apps/web/app/api/ui-final-v031/[screen]/route.ts` for the embedded `paper-trading-room` shell.
- Result: mobile 390x844 now stacks watchlist, quote/chart, and ticket vertically without horizontal overflow.

## Verification

- `pnpm.cmd install --frozen-lockfile --prefer-offline`
- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- Browser smoke: `node .\\.codex-smoke\\ai-portfolio-owner-e2e.cjs`
  - production probe: blocked by missing Owner login state
  - local list/detail/portfolio E2E: passed
  - desktop screenshots: passed
  - mobile overflow assertion: passed
  - browser console errors: none
  - non-navigation request failures: none

## Screenshots

- `evidence/w7_paper_sprint/ai-portfolio-owner-production-probe-1366x900.png`
- `evidence/w7_paper_sprint/ai-portfolio-e2e-list-1366x900.png`
- `evidence/w7_paper_sprint/ai-portfolio-e2e-detail-1366x900.png`
- `evidence/w7_paper_sprint/ai-portfolio-e2e-portfolio-1366x900.png`
- `evidence/w7_paper_sprint/ai-portfolio-e2e-mobile-390x844.png`

## Notes For Elva / Jason / Bruce

- Elva: the frontend AI handoff path is locally verified end to end; true production Owner QA still needs an already-authenticated Owner browser context.
- Jason: no backend endpoint change requested in this cycle.
- Bruce: the SIM-only safety copy and no-real-order boundary remain visible in the embedded trading room.
