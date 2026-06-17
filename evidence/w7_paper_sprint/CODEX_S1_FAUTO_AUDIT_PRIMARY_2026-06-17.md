# Codex Evidence - S1 F-AUTO Audit-Primary Portfolio

## Problem

Production showed the F-AUTO/S1 portfolio as the raw KGI account position `0050 x2`, while the actual S1 strategy cycle had 8 submitted SIM orders from the latest Tuesday basket.

That made the product look like S1 had no active strategy exposure. The root cause was that `/portfolio/f-auto` trusted any raw KGI gateway position before durable S1 audit holdings.

## Fix

- `apps/api/src/s1-sim-runner.ts`
  - Uses durable S1 audit holdings as the primary F-AUTO portfolio.
  - Uses KGI gateway positions only to enrich matching S1 symbols with marks/PnL.
  - Ignores unrelated gateway positions for S1 and exposes a diagnostic note such as `gateway_extra_positions_ignored_for_s1`.
- `apps/api/src/server.ts`
  - Makes `/api/v1/internal/s1-sim/status` search a 7-day observation window for latest basket/orders/EOD.
  - Keeps status visible mid-week instead of showing `today_orders=null`.
- `tests/ci.test.ts`
  - Adds regression guards for audit-primary holdings and 7-day S1 status lookup.

## Local verification

- `pnpm.cmd test` - 571/571 passed.
- `pnpm.cmd --filter @iuf-trading-room/api typecheck` - passed.
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` - passed.
- `git diff --check` - passed with CRLF conversion warnings only.

## Production verification plan after deploy

- `/api/v1/portfolio/f-auto`
  - Must show the latest S1 strategy holdings, not only raw `0050`.
  - Notes must explain ignored unrelated KGI gateway positions.
- `/api/v1/internal/s1-sim/status`
  - Must expose latest basket and latest order/EOD metadata from the weekly observation window.
- `/api/v1/kgi/sim/positions`
  - May still show raw account `0050 x2`; that is correct for raw account view, not for S1 strategy view.
- `/api/v1/kgi/sim/orders`
  - Must still distinguish submitted/unconfirmed orders from broker-confirmed fills.
