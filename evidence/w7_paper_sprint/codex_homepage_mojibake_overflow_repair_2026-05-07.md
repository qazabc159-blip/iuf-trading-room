# Codex Homepage Mojibake / Overflow Repair

Date: 2026-05-07
Branch: fix-web-overflow-product-usability-2026-05-07
Trade Capability Score: +1

## Why

The production homepage and shared frame still contained mojibake labels and long operational rows that could produce bright horizontal scrollbars. That made the trading cockpit look broken and made workflow links harder to use.

## Changes

- Rewrote `apps/web/components/PageFrame.tsx` labels in clean Traditional Chinese.
- Rewrote homepage copy/state labels in `apps/web/app/page.tsx` to remove mojibake and stale wording.
- Kept homepage as a real workflow cockpit: FinMind, market data, OpenAlice, Paper, Quant, and Market Intel each disclose LIVE / EMPTY / BLOCKED state.
- Added overflow containment for dashboard, brief, and company workbench panels so long source/status text wraps inside the product surface instead of creating white horizontal browser scrollbars.

## Sources / Endpoints

- `GET /api/v1/data-sources/finmind/status`
- `GET /api/v1/diagnostics/finmind`
- `GET /api/v1/market-data/overview`
- `GET /api/v1/ops/snapshot`
- `GET /api/v1/briefs`
- `GET /api/v1/content-drafts`
- `GET /api/v1/paper/health`
- `GET /api/v1/strategy/ideas`
- `GET /api/v1/strategy/runs`

## Checks

- `pnpm.cmd --filter @iuf-trading-room/web typecheck`: PASS
- `pnpm.cmd --filter @iuf-trading-room/web build`: PASS
- `git diff --check`: PASS
- Added-line stop-line grep: PASS

## Stop-Line Proof

- No token value.
- No fake live data.
- No order route or broker write path.
- No migration/schema/destructive DB change.
- No FinMind/K-line fill or risk-source change.
- No unapproved strategy metrics added.

## Next

- Continue OpenAlice daily brief source-trail closure.
- Continue Market Intel live frontend once backend/deploy state is clean.
- Continue Paper E2E company page to portfolio flow.
