"""
src/agent/redis_snapshot.py — W7 H3: Redis read path for quote snapshots

Reads quote snapshots from Redis hot-cache keys:
  mkt:quote:{symbol}  — latest quote
  mkt:bidask:{symbol} — latest bid/ask
  mkt:kbar:{symbol}   — latest kbar

Falls back gracefully when Redis unavailable (returns None).
Hard lines: no secrets in cache keys or values.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

logger = logging.getLogger("market-agent.redis_snapshot")

_redis_client: Any = None


def _get_redis() -> Any:
    """Lazy Redis connection. Returns None if REDIS_URL not set or connect fails."""
    global _redis_client

    if _redis_client is not None:
        return _redis_client

    url = os.environ.get("REDIS_URL")
    if not url:
        return None

    try:
        import redis  # type: ignore[import-untyped]
        _redis_client = redis.from_url(url, decode_responses=True, socket_connect_timeout=2)
        # Ping to verify connectivity
        _redis_client.ping()
        logger.info("redis_snapshot: connected to Redis")
        return _redis_client
    except Exception as exc:
        logger.warning("redis_snapshot: Redis unavailable (%s) — running without cache", exc)
        _redis_client = None
        return None


def _read_key(key: str) -> dict[str, Any] | None:
    """Read and parse a JSON key from Redis. Returns None on any error."""
    client = _get_redis()
    if client is None:
        return None
    try:
        raw = client.get(key)
        if raw is None:
            return None
        return json.loads(raw)
    except Exception as exc:
        logger.debug("redis_snapshot: read error for %s: %s", key, exc)
        return None


def get_quote_snapshot(symbol: str) -> dict[str, Any] | None:
    """Read latest quote snapshot for a symbol. Returns None if not in cache."""
    return _read_key(f"mkt:quote:{symbol}")


def get_bidask_snapshot(symbol: str) -> dict[str, Any] | None:
    """Read latest bid/ask snapshot for a symbol."""
    return _read_key(f"mkt:bidask:{symbol}")


def get_kbar_snapshot(symbol: str) -> dict[str, Any] | None:
    """Read latest kbar snapshot for a symbol."""
    return _read_key(f"mkt:kbar:{symbol}")
