"""
src/agent/ingest_pusher.py — W7 H3: Outbound push to cloud ingest endpoint

Responsibilities:
  - Sign MarketEvent payloads with HMAC-SHA256
  - POST to INGEST_URL with exponential backoff retry
  - In-memory queue (max 10000 events) — overflow → oldest dropped + warn
  - MARKET_AGENT_HMAC_SECRET never logged

Hard lines:
  - No KGI SDK import
  - No /order/create
  - Secret NEVER appears in logs, queue snapshots, or response bodies
"""

from __future__ import annotations

import asyncio
import collections
import hashlib
import hmac as _hmac
import json
import logging
import os
import time
from typing import Any

import httpx

logger = logging.getLogger("market-agent.ingest_pusher")

# ── Config ────────────────────────────────────────────────────────────────────

INGEST_URL: str = os.environ.get("INGEST_URL", "http://localhost:3001/internal/market/ingest")
MAX_QUEUE_DEPTH = 10_000
RETRY_DELAYS_SEC = [1.0, 2.0, 4.0, 8.0]
MAX_RETRIES = 3

# ── State ─────────────────────────────────────────────────────────────────────

# In-memory FIFO queue of pending events
_queue: collections.deque[dict[str, Any]] = collections.deque(maxlen=MAX_QUEUE_DEPTH)
# Per (type, symbol) sequence counters
_seq_counters: dict[str, int] = {}
# Tracking for last push timestamp
_last_push_at: float | None = None


# ── HMAC signing ──────────────────────────────────────────────────────────────

def _sign_event(
    secret: str,
    event_type: str,
    symbol: str,
    ts: str,
    seq: int,
    data: dict[str, Any],
) -> str:
    """
    HMAC-SHA256 over canonical message.
    Format: `{type}:{symbol}:{ts}:{seq}:{json(data)}`

    Must match verifyMarketEventHmac in apps/api/src/market-ingest.ts.
    Secret is never logged.
    """
    message = f"{event_type}:{symbol}:{ts}:{seq}:{json.dumps(data, separators=(',', ':'))}"
    return _hmac.new(
        secret.encode("utf-8"),
        message.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def _next_seq(event_type: str, symbol: str) -> int:
    key = f"{event_type}:{symbol}"
    _seq_counters[key] = _seq_counters.get(key, -1) + 1
    return _seq_counters[key]


# ── Queue operations ──────────────────────────────────────────────────────────

def enqueue_event(event_type: str, symbol: str, ts: str, data: dict[str, Any]) -> None:
    """
    Enqueue a raw event for HMAC signing + push.
    If queue is full (maxlen=10000), oldest event is silently dropped (deque behavior).
    """
    if len(_queue) >= MAX_QUEUE_DEPTH:
        logger.warning("ingest_pusher: queue at MAX_QUEUE_DEPTH=%d, oldest event dropped", MAX_QUEUE_DEPTH)

    seq = _next_seq(event_type, symbol)
    _queue.append({
        "type": event_type,
        "symbol": symbol,
        "ts": ts,
        "seq": seq,
        "data": data,
    })


def get_queue_depth() -> int:
    return len(_queue)


def get_last_push_at() -> float | None:
    return _last_push_at


# ── Push worker ───────────────────────────────────────────────────────────────

async def push_event(
    client: httpx.AsyncClient,
    event_type: str,
    symbol: str,
    ts: str,
    seq: int,
    data: dict[str, Any],
) -> bool:
    """
    Sign and POST one event to INGEST_URL.
    Retries up to MAX_RETRIES on network error / 5xx.
    Returns True on success, False after max retries.
    """
    global _last_push_at

    secret = os.environ.get("MARKET_AGENT_HMAC_SECRET", "")
    if not secret:
        logger.error("push_event: MARKET_AGENT_HMAC_SECRET not set — cannot push")
        return False

    hmac_hex = _sign_event(secret, event_type, symbol, ts, seq, data)
    payload = {
        "type": event_type,
        "symbol": symbol,
        "ts": ts,
        "seq": seq,
        "hmac": hmac_hex,
        "data": data,
    }
    # Note: Bearer token is the HMAC secret (server-side pre-check; full verify uses the per-event HMAC)
    headers = {"Authorization": f"Bearer {secret}"}

    last_err: Exception | None = None
    for attempt in range(MAX_RETRIES + 1):
        try:
            resp = await client.post(INGEST_URL, json=payload, headers=headers, timeout=10.0)
            if resp.status_code in (200, 201):
                _last_push_at = time.time()
                logger.debug("push OK %s/%s seq=%d", event_type, symbol, seq)
                return True
            if resp.status_code == 409:
                # Duplicate sequence — treat as success (idempotent)
                _last_push_at = time.time()
                logger.debug("push duplicate %s/%s seq=%d (409)", event_type, symbol, seq)
                return True
            if resp.status_code >= 500:
                last_err = RuntimeError(f"HTTP {resp.status_code}")
            else:
                # 4xx except 409 — non-retryable (auth / validation error)
                logger.warning("push rejected %s/%s seq=%d: HTTP %d", event_type, symbol, seq, resp.status_code)
                return False
        except httpx.RequestError as exc:
            last_err = exc

        if attempt < MAX_RETRIES:
            delay = RETRY_DELAYS_SEC[min(attempt, len(RETRY_DELAYS_SEC) - 1)]
            logger.warning("push retry %d/%d for %s/%s after %.1fs: %s", attempt + 1, MAX_RETRIES, event_type, symbol, delay, last_err)
            await asyncio.sleep(delay)

    logger.error("push failed %s/%s seq=%d after %d retries: %s", event_type, symbol, seq, MAX_RETRIES, last_err)
    return False


async def drain_queue(client: httpx.AsyncClient, max_events: int = 50) -> int:
    """
    Drain up to max_events from the queue and push them.
    Returns number of events successfully pushed.
    """
    pushed = 0
    for _ in range(min(max_events, len(_queue))):
        if not _queue:
            break
        event = _queue.popleft()
        ok = await push_event(
            client,
            event_type=event["type"],
            symbol=event["symbol"],
            ts=event["ts"],
            seq=event["seq"],
            data=event["data"],
        )
        if ok:
            pushed += 1
    return pushed
