# Codex — Paper E2E Frontend Route Alignment

Date: 2026-05-05
Branch: codex/paper-e2e-route-copy-20260505
Scope: apps/web paper order client

## Done

- Updated `previewPaperOrder()` from `POST /api/v1/paper/orders/preview` to Jason's `POST /api/v1/paper/preview`.
- Updated `submitPaperOrder()` from `POST /api/v1/paper/orders` to Jason's `POST /api/v1/paper/submit`.
- Kept `get/list/cancel` on the existing ledger routes because the P3 reopen skeleton only exposes `fills` and `portfolio`, not order detail/cancel replacement routes.
- Replaced broken mojibake order error copy with readable Traditional Chinese messages.

## State / Safety Semantics

- Paper preview remains calculation-only.
- Paper submit remains paper-only; no KGI write-side and no live broker route touched.
- `quantity_unit` is still required by the frontend type and request body.
- Odd lot / board lot ambiguity remains guarded by explicit `SHARE` / `LOT`.

## Stop-Line Proof

- No token, Railway secret, DB migration, backend schema, KGI SDK, or live submit touched.
- No TradingView / FinMind fill source added.
- No buy/sell recommendation wording added.
