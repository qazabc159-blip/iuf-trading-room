"""
src/agent/source_status.py — W7 H3: Per-symbol source status tracking

Tracks last event timestamps per symbol for the /source/status endpoint.
Thread-safe (asyncio single-threaded; no locks needed for simple dict ops).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


# In-memory tracking of last event timestamps per (type, symbol)
_last_event_ts: dict[str, dict[str, str]] = {}


def record_event(event_type: str, symbol: str) -> None:
    """Record that an event was received for a symbol."""
    ts = datetime.now(timezone.utc).isoformat()
    if symbol not in _last_event_ts:
        _last_event_ts[symbol] = {}
    _last_event_ts[symbol][event_type] = ts


def get_source_status() -> list[dict[str, Any]]:
    """
    Return per-symbol status summary.

    Shape: [{"symbol": str, "last_quote_at": str|null, "last_tick_at": str|null, ...}]
    """
    result = []
    for symbol, types in _last_event_ts.items():
        result.append({
            "symbol": symbol,
            "last_quote_at": types.get("quote"),
            "last_tick_at": types.get("tick"),
            "last_bidask_at": types.get("bidask"),
            "last_kbar_at": types.get("kbar"),
        })
    return result
