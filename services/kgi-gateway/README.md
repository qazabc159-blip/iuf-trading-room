# KGI Gateway — Windows FastAPI Bridge

REST+WS gateway that runs **kgisuperpy** on Windows and exposes a local HTTP/WS surface
for the IUF Trading Room API (Linux/Railway) to consume.

Path B architecture: `IUF API (Linux) → HTTP+WS → KGI Gateway (Windows)`

---

## Requirements

- Python 3.10+
- Windows (kgisuperpy only runs on Windows)
- kgisuperpy installed (KGI-provided SDK)

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `KGI_PERSON_ID` | Yes (for auto-login) | `""` | KGI person ID — **MUST be uppercase** |
| `KGI_PERSON_PWD` | Yes (for auto-login) | `""` | KGI password |
| `GATEWAY_HOST` | No | `127.0.0.1` | Bind host |
| `GATEWAY_PORT` | No | `8787` | Bind port |
| `AUTO_LOGIN` | No | `false` | Auto-login on startup (not recommended for W1) |

**Important:** `KGI_PERSON_ID` is case-sensitive — must be uppercase (e.g. `YOUR_PERSON_ID`).  
Source: `feedback_kgi_env_var_uppercase_rule.md`

### `KGI_GATEWAY_POSITION_DISABLED` (W2a Candidate F)

- Type: `bool` (string `"true"` / `"false"`; default `false`)
- Effect: when `true`, `GET /position` returns `503 POSITION_DISABLED` immediately, without calling any KGI SDK or pandas operation.
- Use case: emergency containment during W2a `/position` native crash investigation. Set to `true` in env, restart gateway.
- Rollback: unset or set to `false`, restart gateway. No data migration.
- Does NOT affect: `/trades`, `/deals`, `/order/create`, `/quote/*`, `/events/*`, `/health`, `/session/*`.

### `KGI_GATEWAY_QUOTE_DISABLED` (W2b circuit breaker)

- Type: `bool` (string `"true"` / `"false"`; default `false`)
- Effect: when `true`, `GET /quote/ticks` and `GET /quote/bidask` return `503 QUOTE_DISABLED` immediately.
- Pattern mirrors Candidate F (`KGI_GATEWAY_POSITION_DISABLED`).
- Does NOT affect: `/position`, `/trades`, `/deals`, `/health`, `/session/*`, `/quote/status`, `/quote/subscribe/*`.

---

## Install

```bash
# Using pip (Windows CMD or PowerShell)
pip install fastapi "uvicorn[standard]" kgisuperpy websockets pydantic

# Or using uv
uv pip install fastapi "uvicorn[standard]" kgisuperpy websockets pydantic
```

---

## Start (local development)

```bash
# From services/kgi-gateway/ directory
uvicorn app:app --host 127.0.0.1 --port 8787 --reload
```

Server waits for `POST /session/login` — does NOT auto-login.

---

## Verify /health

```bash
curl http://127.0.0.1:8787/health
# Expected: {"status":"ok","kgi_logged_in":false,"account_set":false}
```

---

## Verify login + show accounts

```bash
curl -X POST http://127.0.0.1:8787/session/login \
  -H "Content-Type: application/json" \
  -d '{"person_id":"YOUR_PERSON_ID","person_pwd":"YOUR_PWD","simulation":false}'

# Expected:
# {"ok":true,"accounts":[{"account":"YOUR_ACCOUNT","account_flag":"證券","broker_id":"YOUR_BROKER_ID"}]}
```

---

## Verify show-account

```bash
curl http://127.0.0.1:8787/session/show-account
# {"accounts":[{"account":"YOUR_ACCOUNT","account_flag":"證券","broker_id":"YOUR_BROKER_ID"}]}
```

---

## Verify set-account (CRITICAL: string only, not dict)

```bash
# CORRECT — account is a plain string
curl -X POST http://127.0.0.1:8787/session/set-account \
  -H "Content-Type: application/json" \
  -d '{"account":"YOUR_ACCOUNT"}'
# Expected: {"ok":true,"account_flag":"證券","broker_id":"YOUR_BROKER_ID"}

# WRONG — passing dict causes 422
# -d '{"account":{"account":"YOUR_ACCOUNT","account_flag":"證券","broker_id":"YOUR_BROKER_ID"}}'
```

---

## W2b Quote Read-Side Surface (5 routes)

Ring buffer design: `deque(maxlen=200)` per symbol, protected by `threading.Lock`.
KGI SDK callbacks write to buffer from SDK thread. REST endpoints read from buffer (thread-safe).
Gateway crash clears buffer — reconnect and resubscribe to repopulate.

### `GET /quote/status` (no auth required)

```bash
curl http://127.0.0.1:8787/quote/status
# {"subscribed_symbols":{"tick":["2330"],"bidask":[]},"buffer":{"tick":{"2330":{"count":5,"maxlen":200,"last_received_at":"2026-04-27T..."}},"bidask":{}},"kgi_logged_in":true,"quote_disabled_flag":false}
```

### `POST /quote/subscribe/tick` (auth required)

```bash
curl -X POST http://127.0.0.1:8787/quote/subscribe/tick \
  -H "Content-Type: application/json" \
  -d '{"symbol":"2330"}'
# Expected: {"ok":true,"label":"tick_2330"}  (label from KGI subscribe return)
# W2b: callback also writes to ring buffer for REST poll.
```

### `GET /quote/ticks` (auth required)

```bash
curl "http://127.0.0.1:8787/quote/ticks?symbol=2330&limit=10"
# 200: {"symbol":"2330","ticks":[{"close":580.0,...,"_received_at":"..."}],"count":5,"buffer_size":200,"buffer_used":5}
# 401: not logged in
# 404: symbol not subscribed (call POST /quote/subscribe/tick first)
# 503: KGI_GATEWAY_QUOTE_DISABLED=true
```

### `POST /quote/subscribe/bidask` (auth required)

```bash
curl -X POST http://127.0.0.1:8787/quote/subscribe/bidask \
  -H "Content-Type: application/json" \
  -d '{"symbol":"2330"}'
# 200 if SDK supports bidask subscription
# 501 NOT_IMPLEMENTED if SDK does not expose subscribe_bidask / set_cb_bid_ask
# Endpoint surface always exists (bidask design must not disappear).
```

### `GET /quote/bidask` (auth required)

```bash
curl "http://127.0.0.1:8787/quote/bidask?symbol=2330"
# 200: {"symbol":"2330","bidask":{"bid_prices":[...],"ask_prices":[...],...,"_received_at":"..."}}
# 401: not logged in
# 404: no bidask data (subscribe first)
# 503: KGI_GATEWAY_QUOTE_DISABLED=true
```

---

## Verify order event WS (passive)

```bash
# Using wscat (npm install -g wscat)
wscat -c ws://127.0.0.1:8787/events/order/attach
# Connected — events broadcast when order activity occurs
# Send "ping" → receives "pong" (keepalive)
```

---

## Verify order create returns 409

```bash
curl -X POST http://127.0.0.1:8787/order/create \
  -H "Content-Type: application/json" \
  -d '{"action":"Buy","symbol":"2330","qty":1}'
# Expected 409: {"error":{"code":"NOT_ENABLED_IN_W1","message":"..."}}
```

---

## W1 Hardlines

- `/order/create` always returns `409 NOT_ENABLED_IN_W1`
- Server does NOT auto-login on startup
- `set_Account` only accepts account string — passing dict → `422`
- Tick callback runs in KGI SDK thread → bridged to asyncio queue (no event loop blocking)
- `get_position` read endpoint deferred to W1.5

---

## File Structure

```
services/kgi-gateway/
  app.py              FastAPI entry + all route handlers
  kgi_session.py      kgisuperpy login / show_account / set_Account lifecycle
  kgi_quote.py        subscribe_tick + ring buffer (W2b) + asyncio bridge for tick broadcast
  kgi_events.py       api.Order.set_event + asyncio bridge for order event broadcast
  schemas.py          Pydantic request/response models (mirrors TS broker-port types)
  config.py           Environment variable loading
  pyproject.toml      Python dependencies
  SCHEMA_MAPPING.md   Full TS ↔ Pydantic ↔ KGI raw field mapping table
  README.md           This file
  tests/
    test_quote_ring_buffer.py  W2b unit tests (5 tests; run with pytest)
```
