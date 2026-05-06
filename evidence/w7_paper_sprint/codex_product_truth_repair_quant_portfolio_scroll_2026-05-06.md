# Codex Product Truth Repair - Quant / Portfolio / Overflow

Date: 2026-05-06
Branch: feat/web-product-truth-repair-2026-05-06
Trade Capability Score: +1

## Why This Exists

This is not a cosmetic pass. It repairs three production-visible product truth failures:

1. Quant Lab was still capable of showing unapproved strategy performance-looking numbers.
2. Paper portfolio could look like an empty or broken product when the actual state was an expired session.
3. Long source labels and operational rows could create bright horizontal browser scrollbars and clipped content.

## Pages / Components Changed

- apps/web/app/lab/LabClient.tsx
- apps/web/app/lab/[bundleId]/LabBundleDetailClient.tsx
- apps/web/app/portfolio/page.tsx
- apps/web/app/globals.css

## Endpoint / Source List

- GET /api/v1/lab/bundles
- GET /api/v1/lab/bundles/:id
- GET /api/v1/paper/portfolio
- GET /api/v1/paper/fills

## Behavior Change

### Quant Lab

- Hides unapproved win-rate, return, drawdown, equity-curve, and period-stat surfaces.
- Keeps the bundle inbox, bundle detail, review actions, status, source, symbol, theme, and summary visible.
- States that approval is a research intake state, not a trading, paper, live, or backtest promotion.
- Does not create orders, fills, or strategy promotion claims.

### Portfolio

- Adds an explicit session-expired repair panel when paper portfolio/fill reads are blocked by login state.
- Explains that the user should log in again instead of interpreting the page as deleted data or missing backend wiring.
- Keeps the page read-only and does not create positions, fills, or orders.

### Layout / Overflow

- Replaces exposed white horizontal scrollbars with theme-colored scrollbars where horizontal scroll is intentional.
- Prevents long source/status strings from stretching dashboard, brief, and data-diagnostic rows.
- Does not hide real data; it wraps or clips only layout overflow.

## State Semantics

- Quant unapproved metrics: HIDDEN / BLOCKED by governance.
- Portfolio expired session: BLOCKED with login repair action.
- Data rows with long labels: LIVE / EMPTY / BLOCKED semantics unchanged; only layout containment changes.

## Checks

- contracts build: PASS before this slice.
- web typecheck: PASS.
- web build: PASS.
- git diff --check: PASS with CRLF warnings only.
- added-line stop-line grep: PASS.

## Stop-Line Proof

- No token value displayed or logged.
- No fake live data added.
- No real broker, no broker write path, and no formal order route touched.
- No migration, schema, Railway secret, or destructive DB action touched.
- No FinMind or K-line data used as paper fill or risk source.
- No unapproved strategy performance metric is newly exposed.

## Next Slice

After this PR lands, continue with trade-capability work:

1. Paper E2E company page to portfolio flow guide.
2. OpenAlice daily brief automation source trail and publish state.
3. Market Intel / major-info frontend once the FinMind news backend path is fully deployed.
