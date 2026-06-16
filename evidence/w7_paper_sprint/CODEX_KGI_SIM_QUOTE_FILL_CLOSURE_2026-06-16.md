# Codex KGI SIM Quote + Fill Closure - 2026-06-16

## Scope

Rooted the KGI SIM daily health / quote / order lifecycle issue without promoting any real-order path.

This PR changes the product behavior from "KGI quote auth failed, explain why" to:

- KGI SIM login/trade remains broker-side.
- Product quote health is independently satisfied by TWSE MIS when KGI quote entitlement is unavailable.
- KGI quote entitlement is surfaced as a broker capability, not a product-blocking failure.
- KGI SIM submitted orders are reconciled against recent order events, trades, and deals before showing filled / partially filled / rejected / cancelled / unconfirmed.
- S1/F-AUTO holdings only count confirmed fills, never accepted-only submissions.

## Verification

- `pnpm.cmd run build:packages`
- `pnpm.cmd --filter @iuf-trading-room/integrations build`
- `pnpm.cmd --filter @iuf-trading-room/api typecheck`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- `pnpm.cmd test` -> 561/561 pass
- `python -m pytest services\kgi-gateway\tests\test_order_gate.py -q` -> 15/15 pass

## New Regression Coverage

- `DS5b`: KGI quote auth unavailable + TWSE MIS usable keeps product quote lane usable.
- `ORT5`: mismatched broker trade id cannot confirm the current SIM order.
- `ORT6`: matched deals promote an order to filled with fill quantity, average price, and settlement source.
- Gateway `test_order_gate.py`: `/order/create` response carries a parsed `trade_id`.

## Product Notes

- If KGI quote entitlement remains unavailable, the product can still show and validate quotes from TWSE MIS.
- If KGI accepts a SIM order but no matching order event/trade/deal appears, the UI now says unconfirmed instead of pretending it filled.
- F-AUTO/S1 position reconstruction now requires confirmed fill or partial fill evidence.
