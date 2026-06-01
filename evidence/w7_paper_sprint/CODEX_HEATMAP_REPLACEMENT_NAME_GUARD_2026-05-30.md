# Codex Heatmap Replacement-Name Guard - 2026-05-30

## Scope

- Product lane: `apps/web` frontend heatmap display.
- Route verified: `https://app.eycvector.com/`.
- No KGI live broker write, no real-order path, no backend/KGI SIM/F-AUTO changes.

## Production QA Before Fix

Production heatmap was healthy enough to render fixed representative pools, but one data-quality leak remained:

- `noDataCount=0` for every sector tab, so the gray empty tile regression is not currently present on prod.
- Sector visible counts after latest deploy:
  - Core: 38 visible / 40 fixed pool
  - Semiconductor: 13 visible / 15 fixed pool
  - Components: 15 visible / 15 fixed pool
  - Computer: 13 visible / 15 fixed pool
  - Communication: 15 visible / 15 fixed pool
  - Finance: 14 visible / 15 fixed pool
  - Steel: 15 visible / 15 fixed pool
  - Shipping: 13 visible / 15 fixed pool
- Communication tile `6285` rendered as `啟��` because the frontend trusted a feed name containing replacement characters instead of falling back to the fixed representative label table.

Evidence files:

- `evidence/w7_paper_sprint/heatmap-replacement-name-prod-audit-20260530.json`
- `evidence/w7_paper_sprint/heatmap-replacement-name-communication-before-20260530.png`

## Fix

- Updated `representativeCompanyName()` so fixed representative names are used when the feed name contains the Unicode replacement character `�`.
- Added a source gate test to preserve fixed labels for representative tickers that appeared in the production heatmap audit.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/qa-playwright exec playwright test --project=desktop-chromium --no-deps` - PASS, 6/6 production desktop acceptance tests.
- `pnpm.cmd --filter @iuf-trading-room/web test -- industry-heatmap-representatives` - PASS, 23 files / 208 tests.
- `pnpm.cmd run build:packages` - PASS.
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` - PASS.
- `pnpm.cmd --filter @iuf-trading-room/web build` - PASS; existing Sentry/OpenTelemetry dynamic import warning only.

## Follow-Up After Deploy

After this PR deploys, rerun the same heatmap probe and confirm:

- `6285` renders as `啟碁`.
- `noDataCount=0` remains true for every sector.
- Sector tabs stay within the fixed 10-15 visible representative target unless the feed legitimately lacks quote data.
