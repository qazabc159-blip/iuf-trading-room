# F-AUTO Production Client Crash Fix - 2026-06-01

## Finding

Production browser smoke for `/ops/f-auto` failed with:

`Application error: a client-side exception has occurred`

Captured page error:

`e.data.slice is not a function`

The backend endpoints were healthy with an owner cookie:

- `/api/v1/internal/s1-sim/status` returned 200
- `/api/v1/kgi/sim/positions` returned 200
- `/api/v1/kgi/sim/balance` returned 200
- `/api/v1/kgi/sim/orders` returned 200

## Root Cause

The F-AUTO client expected `getKgiSimOrders()` to return an array, but the production endpoint returns an object shaped like:

`{ data: { orders: [], source, fetchedAt } }`

The panel then executed `.slice()` on the object.

## Fix

Normalize F-AUTO API helper responses before they reach React panels:

- KGI SIM orders: always return `KgiSimRawOrderItem[]`
- SIM positions: map production `quantity/avgPrice/marketPrice` fields into panel `qty/avgCost/lastPrice`
- SIM funds: map production `cash/availableCash/equity/marketValue` fields into panel fields

## Verification

- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS
- `pnpm.cmd --filter @iuf-trading-room/web test` PASS, 246 tests

Production browser re-smoke must be rerun after deploy.
