# Codex Evidence - KGI SIM Odd-Lot Position Quantity

Date: 2026-06-17
Branch: fix/kgi-sim-oddlot-position-quantity-20260617

## Problem

Production KGI SIM account reads became reachable after gateway re-login, but the current SIM holding returned by KGI was an odd-lot position:

- Symbol: 0050
- KGI raw quantity arrays showed 2 odd-lot shares.
- API display quantity used `netQuantity`, which counted only cash + margin and therefore displayed 0.

That is not product-grade. If a customer holds odd-lot shares, the product must show the real holding quantity.

## Fix

Update KGI position normalization so `netQuantity` counts:

`odd + cash + margin - short`

Updated files:

- `apps/api/src/broker/kgi-gateway-client.ts`
- `apps/api/src/broker/kgi-broker.ts`
- `apps/api/src/broker/broker-port.ts`
- `tests/ci.test.ts`

## Verification

- `pnpm.cmd --filter @iuf-trading-room/api typecheck`
- `pnpm.cmd test` (568/568 pass)
- `git diff --check` (line-ending warnings only)

## Production Follow-Up

After deploy, re-check:

- `/api/v1/kgi/sim/positions`
- `/api/v1/paper/positions?source=sim`

Expected: the 0050 odd-lot holding should display quantity 2 instead of 0.
