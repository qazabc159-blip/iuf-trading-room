# Market Agent — W7 KGI Market Data Pusher

## Status

**MOCK-ONLY** — D1 skeleton. Real KGI SDK subscriber will be wired once
`libCGCrypt.so` arrives from KGI internal. All `TODO(libCGCrypt)` markers in
`main.py` show where the real hooks go.

## Architecture

```
KGI Windows (this agent)
    ↓ HTTPS POST signed with HMAC-SHA256
Cloud apps/api /internal/market/ingest
    ↓
Redis hot cache (mkt:{type}:{symbol})
Postgres market_events table
    ↓
SSE broadcast + REST snapshot
    ↓
RADAR frontend + Lightweight Charts
```

## Required env vars (NEVER commit values)

| Var | Description |
|-----|-------------|
| `MARKET_AGENT_HMAC_SECRET` | Shared secret — 32+ random bytes (hex or base64). Must match `MARKET_AGENT_HMAC_SECRET` on the Cloud API side. |
| `INGEST_URL` | Cloud API ingest endpoint, e.g. `https://api.eycvector.com/internal/market/ingest` |
| `HEARTBEAT_URL` | Cloud API heartbeat endpoint, e.g. `https://api.eycvector.com/internal/market/heartbeat` |

## Optional env vars

| Var | Default | Description |
|-----|---------|-------------|
| `AGENT_ID` | `market-agent-dev` | Agent identifier in heartbeat payloads |
| `MOCK_SYMBOLS` | `2330.TW,2317.TW` | Comma-separated symbols for mock mode |
| `EMIT_INTERVAL_SEC` | `5` | Seconds between mock emission cycles |

## Run (mock mode)

```bash
# Ensure env vars are set (use a local .env file — NOT committed)
export MARKET_AGENT_HMAC_SECRET="<secret>"
export INGEST_URL="http://localhost:3001/internal/market/ingest"
export HEARTBEAT_URL="http://localhost:3001/internal/market/heartbeat"

python main.py
```

## libCGCrypt.so unblock plan

1. Receive `libCGCrypt.so` from KGI internal team.
2. Install `kgisuperpy>=2.0.3` (add to `pyproject.toml` dependencies).
3. Replace each `_mock_*_data()` function with real KGI SDK callback wiring
   (see `TODO(libCGCrypt)` comments in `main.py`).
4. Remove the `_emit_loop` timer; real events are push-driven by KGI callbacks.
5. Run on Windows only (KGI SDK requires Windows COM environment).
   Docker dev mode uses mock; EC2 prod uses real Windows gateway VM.

## Security notes

- HMAC secret is read from `MARKET_AGENT_HMAC_SECRET` env — never hardcoded.
- Tunnel URL/token must not be committed; use Railway/Render env var injection.
- Frontend cannot access the ingest bearer token (server-to-server only).
- Redis/Postgres writes contain no raw secrets or account credentials.
