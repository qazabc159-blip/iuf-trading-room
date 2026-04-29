"""
market-agent/main.py — W7 KGI Windows Market Data Agent (MOCK-ONLY for D1)

Architecture:
  KGI Windows Market Data Agent (this process)
      ↓ HTTPS POST (HMAC-SHA256 signed)
  Cloud apps/api /internal/market/ingest
      ↓
  Redis hot cache + Postgres market_events
      ↓
  SSE broadcast + REST snapshot → RADAR frontend

This file is the MOCK subscriber.  Real KGI SDK hooks are clearly marked with
TODO(libCGCrypt) comments — they will be wired once libCGCrypt.so arrives from
KGI internal.

Hard lines (W7):
  - MARKET_AGENT_HMAC_SECRET is read from env; never printed, never committed
  - INGEST_URL (Cloud API endpoint) is read from env; never committed
  - No /order/create call
  - No kill-switch state machine

Env vars (document in README.md):
  MARKET_AGENT_HMAC_SECRET  — shared HMAC secret with Cloud API (required)
  INGEST_URL                — https://<api-host>/internal/market/ingest (required)
  HEARTBEAT_URL             — https://<api-host>/internal/market/heartbeat (required)
  AGENT_ID                  — identifier string, default "market-agent-dev"
  MOCK_SYMBOLS              — comma-separated symbols, default "2330.TW,2317.TW"
  EMIT_INTERVAL_SEC         — seconds between mock ticks, default 5
"""

import asyncio
import hashlib
import hmac
import json
import logging
import os
import random
import time
from datetime import datetime, timezone
from typing import Any

import httpx

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger("market-agent")

# ── Config ────────────────────────────────────────────────────────────────────

HMAC_SECRET: str = os.environ.get("MARKET_AGENT_HMAC_SECRET", "")
INGEST_URL: str = os.environ.get("INGEST_URL", "http://localhost:3001/internal/market/ingest")
HEARTBEAT_URL: str = os.environ.get(
    "HEARTBEAT_URL", "http://localhost:3001/internal/market/heartbeat"
)
AGENT_ID: str = os.environ.get("AGENT_ID", "market-agent-dev")
MOCK_SYMBOLS: list[str] = [
    s.strip()
    for s in os.environ.get("MOCK_SYMBOLS", "2330.TW,2317.TW").split(",")
    if s.strip()
]
EMIT_INTERVAL_SEC: float = float(os.environ.get("EMIT_INTERVAL_SEC", "5"))
HEARTBEAT_INTERVAL_SEC: float = 15.0


# ── HMAC signing ──────────────────────────────────────────────────────────────

def _sign_event(
    event_type: str,
    symbol: str,
    ts: str,
    seq: int,
    data: dict[str, Any],
) -> str:
    """
    HMAC-SHA256 over canonical message string.

    Message format: `{type}:{symbol}:{ts}:{seq}:{json(data)}`

    Must match verifyMarketEventHmac in apps/api/src/market-ingest.ts.
    """
    message = f"{event_type}:{symbol}:{ts}:{seq}:{json.dumps(data, separators=(',', ':'))}"
    return hmac.new(
        HMAC_SECRET.encode("utf-8"),
        message.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


# ── Sequence counters (per symbol, per type) ─────────────────────────────────

_seq_counters: dict[str, int] = {}


def _next_seq(event_type: str, symbol: str) -> int:
    key = f"{event_type}:{symbol}"
    _seq_counters[key] = _seq_counters.get(key, -1) + 1
    return _seq_counters[key]


# ── Mock data producers ───────────────────────────────────────────────────────
#
# TODO(libCGCrypt): Replace each mock producer below with real KGI SDK hooks.
#
# Pattern for real quote:
#   from kgisuperpy import MasterSet
#   ms = MasterSet()
#   ms.OnNotifyQuote = lambda row: _on_kgi_quote(row)   # <-- wire here
#   ms.Subscribe(stock_id=symbol)
#
# Pattern for real tick:
#   ms.OnNotifyTick = lambda row: _on_kgi_tick(row)
#
# Pattern for real bidask:
#   ms.OnNotifyBidAsk = lambda row: _on_kgi_bidask(row)
#
# Pattern for real kbar:
#   from kgisuperpy import KGIBar
#   bar = KGIBar()
#   bar.OnNotifyKBar = lambda row: _on_kgi_kbar(row)
#   bar.Subscribe(stock_id=symbol, n_type=0)   # 0 = 1-min bar

BASE_PRICES: dict[str, float] = {
    "2330.TW": 950.0,
    "2317.TW": 120.0,
}


def _mock_base_price(symbol: str) -> float:
    base = BASE_PRICES.get(symbol, 100.0)
    return round(base * (1 + random.uniform(-0.01, 0.01)), 2)


def _mock_quote_data(symbol: str) -> dict[str, Any]:
    """TODO(libCGCrypt): Replace with real KGI OnNotifyQuote row mapping."""
    last = _mock_base_price(symbol)
    return {
        "last": last,
        "bid": round(last - 0.5, 2),
        "ask": round(last + 0.5, 2),
        "open": round(last * 0.99, 2),
        "high": round(last * 1.005, 2),
        "low": round(last * 0.995, 2),
        "prevClose": round(last * 0.99, 2),
        "volume": random.randint(100, 5000) * 1000,
        "changePct": round(random.uniform(-2.0, 2.0), 2),
    }


def _mock_tick_data(symbol: str) -> dict[str, Any]:
    """TODO(libCGCrypt): Replace with real KGI OnNotifyTick row mapping."""
    price = _mock_base_price(symbol)
    return {
        "price": price,
        "size": random.randint(1, 100) * 1000,
        "side": random.choice(["buy", "sell"]),
    }


def _mock_bidask_data(symbol: str) -> dict[str, Any]:
    """TODO(libCGCrypt): Replace with real KGI OnNotifyBidAsk row mapping."""
    last = _mock_base_price(symbol)
    return {
        "bid": round(last - 0.5, 2),
        "ask": round(last + 0.5, 2),
        "bidSize": random.randint(10, 500) * 1000,
        "askSize": random.randint(10, 500) * 1000,
    }


def _mock_kbar_data(symbol: str) -> dict[str, Any]:
    """TODO(libCGCrypt): Replace with real KGI OnNotifyKBar row mapping."""
    now_utc = datetime.now(timezone.utc)
    open_ts = now_utc.strftime("%Y-%m-%dT%H:%M:00Z")
    close_ts = now_utc.strftime("%Y-%m-%dT%H:%M:59Z")
    o = _mock_base_price(symbol)
    return {
        "interval": "1m",
        "openTime": open_ts,
        "closeTime": close_ts,
        "open": o,
        "high": round(o * 1.003, 2),
        "low": round(o * 0.997, 2),
        "close": round(o * (1 + random.uniform(-0.003, 0.003)), 2),
        "volume": random.randint(500, 10000) * 1000,
        "turnover": 0,
        "isClosed": False,
    }


# ── HTTP push ─────────────────────────────────────────────────────────────────

async def _push_event(
    client: httpx.AsyncClient,
    event_type: str,
    symbol: str,
    data: dict[str, Any],
) -> None:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    seq = _next_seq(event_type, symbol)
    hmac_hex = _sign_event(event_type, symbol, ts, seq, data)

    payload = {
        "type": event_type,
        "symbol": symbol,
        "ts": ts,
        "seq": seq,
        "hmac": hmac_hex,
        "data": data,
    }

    try:
        resp = await client.post(
            INGEST_URL,
            json=payload,
            headers={"Authorization": f"Bearer {HMAC_SECRET}"},
            timeout=10.0,
        )
        if resp.status_code not in (200, 201):
            logger.warning(
                "ingest rejected %s/%s seq=%d: HTTP %d — %s",
                event_type,
                symbol,
                seq,
                resp.status_code,
                resp.text[:200],
            )
        else:
            result = resp.json()
            logger.debug(
                "ingest OK %s/%s seq=%d eventId=%s cached=%s persisted=%s",
                event_type,
                symbol,
                seq,
                result.get("eventId"),
                result.get("cached"),
                result.get("persisted"),
            )
    except httpx.RequestError as exc:
        logger.error("ingest network error %s/%s: %s", event_type, symbol, exc)


async def _push_heartbeat(client: httpx.AsyncClient) -> None:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    payload = {
        "agentId": AGENT_ID,
        "ts": ts,
        "symbols": MOCK_SYMBOLS,
        "version": "w7-d1-mock",
    }
    try:
        resp = await client.post(
            HEARTBEAT_URL,
            json=payload,
            headers={"Authorization": f"Bearer {HMAC_SECRET}"},
            timeout=5.0,
        )
        if resp.status_code != 200:
            logger.warning("heartbeat rejected: HTTP %d — %s", resp.status_code, resp.text[:100])
        else:
            logger.info("heartbeat OK agentId=%s ts=%s", AGENT_ID, ts)
    except httpx.RequestError as exc:
        logger.error("heartbeat network error: %s", exc)


# ── Main loop ─────────────────────────────────────────────────────────────────

async def _emit_loop(client: httpx.AsyncClient) -> None:
    """
    Round-robin emit mock events for all configured symbols.

    TODO(libCGCrypt): Once KGI SDK is available, remove this timer loop.
    Real events will be push-driven via KGI callbacks (OnNotifyQuote, etc.).
    This loop can remain as a fallback / simulation mode.
    """
    event_types = ["quote", "tick", "bidask", "kbar"]
    mock_producers = {
        "quote": _mock_quote_data,
        "tick": _mock_tick_data,
        "bidask": _mock_bidask_data,
        "kbar": _mock_kbar_data,
    }

    while True:
        for symbol in MOCK_SYMBOLS:
            for etype in event_types:
                data = mock_producers[etype](symbol)
                await _push_event(client, etype, symbol, data)
                await asyncio.sleep(0.1)   # small gap between each push

        logger.info(
            "mock cycle complete: %d symbols × %d types",
            len(MOCK_SYMBOLS),
            len(event_types),
        )
        await asyncio.sleep(EMIT_INTERVAL_SEC)


async def _heartbeat_loop(client: httpx.AsyncClient) -> None:
    while True:
        await _push_heartbeat(client)
        await asyncio.sleep(HEARTBEAT_INTERVAL_SEC)


async def main() -> None:
    if not HMAC_SECRET:
        raise RuntimeError(
            "MARKET_AGENT_HMAC_SECRET env var is required but not set. "
            "Set it in your .env file or deployment environment."
        )

    logger.info(
        "Market Agent starting — AGENT_ID=%s symbols=%s mode=MOCK",
        AGENT_ID,
        MOCK_SYMBOLS,
    )
    logger.info(
        "INGEST_URL=%s  HEARTBEAT_URL=%s",
        INGEST_URL,
        HEARTBEAT_URL,
    )
    logger.warning(
        "TODO(libCGCrypt): Real KGI SDK subscriber NOT wired. "
        "Mock data only until libCGCrypt.so arrives from KGI internal."
    )

    async with httpx.AsyncClient() as client:
        await asyncio.gather(
            _emit_loop(client),
            _heartbeat_loop(client),
        )


if __name__ == "__main__":
    asyncio.run(main())
