# Fubon Gateway Mock — GAP-v1 contract-mock

Not the real gateway. 楊董's 富邦開戶/Neo API 尚未申請（安全閘 spec O-4）— this is
GAP-v1's executable spec (`FUBON_ADAPTER_INTERFACE_FREEZE_v1.md` §2/§5) so the
API-side adapter (`apps/api/src/broker/fubon-*.ts`) can be built and tested now.
When O-4 documentation lands, the real `services/fubon-gateway/` (Python, Neo
SDK, runs on the client's own machine per Option A) replaces this — GAP-v1 does
not change, only the implementation behind it.

## Endpoints (all fixture-backed)

| Endpoint | Method | Notes |
|---|---|---|
| `/health` | GET | `{ok, broker:"fubon", is_simulation:true, read_only_mode}` |
| `/session/status` | GET | fixture logged-in session |
| `/positions` | GET | fixture positions (incl. one odd-lot row) |
| `/balances` | GET | fixture cash balance |
| `/order/create` | POST | gated — see below |
| `/order/cancel` | POST | gated, idempotent (`already_cancelled` on repeat) |
| `/orders/today` | GET | fixture order/fill history |

## Safety gates (§3, read live at request time)

- `FUBON_READ_ONLY_MODE` (default `true`) — `true` blocks all mutation with 403 `FUBON_READ_ONLY_MODE_BLOCKED`.
- `FUBON_LIVE_TRADING_ENABLED` (default `false`) — `false` blocks `/order/create` + `/order/cancel` with 409 `FUBON_LIVE_DISABLED_STAGE_GATE`.

Both default to the locked state. The API-side adapter (`fubon-broker-adapter.ts`)
additionally hardcodes `FUBON_ORDER_WRITE_LOCKED = true` and never calls these
endpoints for writes regardless of gateway state — this mock's own gates are a
second, independent layer, not the only one.

## Usage in tests

`createFubonMockGatewayServer()` returns a plain `node:http` `Server`. Tests
call `.listen(0)` for an ephemeral port and point `FubonGatewayClient` at it —
no subprocess needed. See `tests/ci.test.ts` UTA-C3 section.
