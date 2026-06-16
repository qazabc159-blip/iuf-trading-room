# Codex Evidence - KGI SIM Account Reads After Hours

Date: 2026-06-17
Branch: fix/kgi-sim-offhours-account-read-20260616

## Problem

KGI SIM gateway credentials were present in AWS SSM and the watchdog could log in, but production API account panels still reported `gateway_unreachable` after the scheduled KGI quote window.

This made F-AUTO / KGI SIM status look worse than reality:

- Gateway was running and logged in.
- `/events/order/recent` existed and returned an empty event list.
- `/position` returned the current SIM position.
- API still blocked account reads because the quote uptime guard short-circuited all gateway calls after hours.

## Root Cause

`KgiGatewayClient.gatewayFetch()` used the EventBridge scheduled-off guard for every gateway call. That guard is correct for quote/UI paths because KGI quote connectivity is not expected after the market window, but it is too broad for account-read paths.

Account reads such as positions, trades, deals, order events, and balance reconciliation should be allowed when the EC2 gateway is manually kept alive and logged in.

## Fix

- Added `ignoreScheduleGuard?: boolean` to `KgiGatewayClientConfig`.
- Kept the scheduled-off guard active by default.
- Passed the bypass only for account-read methods:
  - `getTrades`
  - `getDeals`
  - `getRecentOrderEvents`
  - `getPosition`
  - `health`
- Updated SIM/account API read routes to instantiate the client with `ignoreScheduleGuard: true`.
- Added CI tests:
  - `KGI-SIM-UNLOCK-6`
  - `KGI-SIM-UNLOCK-7`

## AWS / Gateway Check

AWS SSM parameters exist and are readable as SecureString values:

- `/iuf/kgi/sim_person_id`
- `/iuf/kgi/sim_person_pwd`

Values were not printed or committed. The old startup-login task is stale and returns 401; the correct watchdog is the KGI gateway watchdog, which successfully re-logged in after clearing cooldown state.

Gateway local verification after watchdog login:

- `/health`: logged in, account set
- `/events/order/recent`: 200, empty event list
- `/position`: 200, current real SIM account state available
- `/trades`: 200, empty
- `/deals`: 200, empty

## Product Interpretation

The 8 S1 orders remain submission-only / unconfirmed until KGI SIM returns trades, deals, or order events. The product must not show fake fills or fake PnL for those orders.

The current verified SIM position from KGI was a small odd-lot/cash position, not the 8 S1 targets. That is expected until fills are confirmed.

## Verification

Local:

- `pnpm.cmd --filter @iuf-trading-room/api typecheck`
- `pnpm.cmd test`
- `git diff --check`

Production verification is required after merge and deploy:

- `/api/v1/kgi/sim/positions` should return KGI SIM account data instead of scheduled-off `gateway_unreachable`.
- `/api/v1/kgi/sim/balance` should derive funds/PnL from the KGI SIM account read.
- `/api/v1/paper/positions?source=sim` should show the same SIM position view.
- `/api/v1/paper/funds?source=sim` should show SIM funds summary.
- `/api/v1/kgi/sim/orders` should keep S1 orders as unconfirmed unless trades/deals/events confirm fills.
