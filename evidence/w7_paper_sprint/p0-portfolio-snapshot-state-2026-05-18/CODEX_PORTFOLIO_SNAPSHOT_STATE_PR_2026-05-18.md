# P0 Portfolio Snapshot State - 2026-05-18

## Scope
- Page: `/admin/portfolio/snapshots`
- Route alias from PR #698: `/portfolio-snapshot`
- Backend read routes from PR #699:
  - `GET /api/v1/portfolio/snapshots`
  - `GET /api/v1/portfolio/snapshots/:id`
  - `GET /api/v1/portfolio/snapshots/diff`

## Problem
- The frontend still described the API as waiting on an old Phase A migration (`0037`) even after PR #699 shipped read routes.
- Empty/error states were too vague for Yang's P0 rule: no blank panel, no fake data, must state missing data source/endpoint/owner/next action.

## Fix
- Added `portfolioSnapshotStateCopy()` to classify `loading`, `live`, `empty`, and `blocked`.
- The page now displays:
  - endpoint
  - owner
  - next action
  - explicit no-fake-data wording
- Empty state now says the API is connected but no backend snapshot has been written yet.
- Blocked state shows HTTP status and asks Bruce/Elva/Jason to verify route/session/store.
- Diff failure now names `/api/v1/portfolio/snapshots/diff` and tells the user to confirm both snapshot IDs exist.

## Verification
- `pnpm.cmd install --offline --frozen-lockfile`
- `pnpm.cmd --filter @iuf-trading-room/web test -- portfolio-snapshot-state`
  - 10 test files passed, 158 tests passed.
- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- Local SSR smoke on `http://localhost:3109/admin/portfolio/snapshots` with middleware-only dummy session:
  - route title present
  - endpoint present
  - owner present
  - no `0037`
  - no stale `migration` pending wording

## Data Truth
- No fake snapshot, position, order, fill, or fund data was added.
- This is a frontend product-state fix only; snapshot writer ownership remains backend/data lane.
