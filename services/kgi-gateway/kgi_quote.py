"""
kgi_quote.py — wrap api.Quote.subscribe_tick + callback bridge + ring buffer.

Tick callbacks from kgisuperpy run in an internal SDK thread.
We bridge them into asyncio by posting to a queue that the WS pump drains.
W2b: also write ticks / bidask into in-memory ring buffers for REST poll.

Design:
  - KGI SDK thread → tick_queue.put_nowait(tick_dict)
  - FastAPI asyncio event loop → WS pump reads queue → broadcasts to WS clients
  - KGI SDK thread → _TICK_BUFFER[symbol].append(tick_dict) (deque maxlen=200)
  - KGI SDK thread → _BIDASK_LATEST[symbol] = bidask_dict

This avoids blocking the event loop with synchronous KGI callbacks.
"""

from __future__ import annotations

import asyncio
import json
import logging
import threading
from collections import deque
from datetime import datetime, timezone
from typing import Optional

from kgisuperpy.marketdata.quote_data.quotedata import QuoteData as _QuoteData
QuoteVersion = _QuoteData.QuoteVersion

from schemas import TickEvent

logger = logging.getLogger("kgi_quote")

# ---------------------------------------------------------------------------
# W2b: In-memory ring buffers (module-level, shared across requests)
# ---------------------------------------------------------------------------

_TICK_BUFFER: dict[str, deque] = {}          # symbol → deque(maxlen=200)
_BIDASK_LATEST: dict[str, dict] = {}         # symbol → latest bidask dict
_TICK_SUBSCRIBED: set[str] = set()           # symbols with active tick subscription
_BIDASK_SUBSCRIBED: set[str] = set()         # symbols with active bidask subscription
_BUFFER_LOCK = threading.Lock()
_BUFFER_MAXLEN = 200


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _write_tick_to_buffer(symbol: str, tick_dict: dict) -> None:
    """Write a tick dict into the ring buffer. Called from SDK callback thread."""
    with _BUFFER_LOCK:
        if symbol not in _TICK_BUFFER:
            _TICK_BUFFER[symbol] = deque(maxlen=_BUFFER_MAXLEN)
        _TICK_BUFFER[symbol].append({**tick_dict, "_received_at": _now_iso()})


def _write_bidask_to_buffer(symbol: str, bidask_dict: dict) -> None:
    """Write a bidask dict as latest snapshot. Called from SDK callback thread."""
    with _BUFFER_LOCK:
        _BIDASK_LATEST[symbol] = {**bidask_dict, "_received_at": _now_iso()}


def get_recent_ticks(symbol: str, limit: int = 10) -> list[dict]:
    """Return last `limit` ticks for symbol. Thread-safe."""
    with _BUFFER_LOCK:
        buf = _TICK_BUFFER.get(symbol)
        if buf is None:
            return []
        return list(buf)[-limit:]


def get_latest_bidask(symbol: str) -> dict | None:
    """Return latest bidask snapshot for symbol, or None if not available."""
    with _BUFFER_LOCK:
        return _BIDASK_LATEST.get(symbol)


def is_tick_subscribed(symbol: str) -> bool:
    with _BUFFER_LOCK:
        return symbol in _TICK_SUBSCRIBED


def is_bidask_subscribed(symbol: str) -> bool:
    with _BUFFER_LOCK:
        return symbol in _BIDASK_SUBSCRIBED


def get_quote_status() -> dict:
    """Return current state of quote subsystem for GET /quote/status."""
    with _BUFFER_LOCK:
        tick_info = {}
        for sym, buf in _TICK_BUFFER.items():
            last_at = buf[-1].get("_received_at") if buf else None
            tick_info[sym] = {
                "count": len(buf),
                "maxlen": _BUFFER_MAXLEN,
                "last_received_at": last_at,
            }
        bidask_info = {}
        for sym, snap in _BIDASK_LATEST.items():
            bidask_info[sym] = {
                "present": True,
                "last_received_at": snap.get("_received_at"),
            }
        return {
            "subscribed_symbols": {
                "tick": sorted(_TICK_SUBSCRIBED),
                "bidask": sorted(_BIDASK_SUBSCRIBED),
            },
            "buffer": {
                "tick": tick_info,
                "bidask": bidask_info,
            },
        }


class KgiQuoteManager:
    """Manages tick subscriptions and bridges KGI callbacks to asyncio."""

    def __init__(self) -> None:
        self._subscriptions: dict[str, str] = {}         # symbol → tick label
        self._bidask_subscriptions: dict[str, str] = {}  # symbol → bidask label
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._tick_queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=1000)
        self._ws_clients: set = set()
        self._lock = threading.Lock()

    def set_event_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """Register the running event loop for thread-safe bridging."""
        self._loop = loop

    def register_ws_client(self, ws) -> None:
        self._ws_clients.add(ws)

    def unregister_ws_client(self, ws) -> None:
        self._ws_clients.discard(ws)

    # ------------------------------------------------------------------
    # Subscribe
    # ------------------------------------------------------------------

    def subscribe_tick(self, api, symbol: str, odd_lot: bool = False) -> str:
        """
        Register on_tick callback and subscribe to symbol tick stream.
        Callback runs in KGI internal thread — bridges via asyncio queue AND ring buffer.

        Returns subscription label.
        """
        if symbol in self._subscriptions:
            return self._subscriptions[symbol]

        def on_tick(tick):
            """Single-param callback — NOT (exchange, tick)."""
            # Source: brokerport_golden_2026-04-23.md §60-63
            try:
                tick_dict = _tick_to_dict(tick)
                # W2b: write to ring buffer for REST poll
                _write_tick_to_buffer(symbol, tick_dict)
                if self._loop and self._loop.is_running():
                    asyncio.run_coroutine_threadsafe(
                        self._tick_queue.put(tick_dict), self._loop
                    )
            except Exception:
                logger.exception("Error in on_tick bridge")

        # Register callback first, then subscribe
        api.Quote.set_cb_tick(on_tick, version=QuoteVersion.v1)
        label = api.Quote.subscribe_tick(symbol, odd_lot=odd_lot, version=QuoteVersion.v1)
        label_str = str(label) if label is not None else f"tick_{symbol}"

        with self._lock:
            self._subscriptions[symbol] = label_str
        with _BUFFER_LOCK:
            _TICK_SUBSCRIBED.add(symbol)
            if symbol not in _TICK_BUFFER:
                _TICK_BUFFER[symbol] = deque(maxlen=_BUFFER_MAXLEN)

        logger.info("Subscribed tick: symbol=%s label=%s", symbol, label_str)
        return label_str

    def subscribe_bidask(self, api, symbol: str, odd_lot: bool = False) -> str:
        """
        Register on_bidask callback and subscribe to symbol bid/ask stream.
        W2b: attempts api.Quote.subscribe_bidask if SDK supports it.
        Returns subscription label, or raises NotImplementedError if SDK does not support.
        """
        if symbol in self._bidask_subscriptions:
            return self._bidask_subscriptions[symbol]

        def on_bidask(bidask):
            try:
                bidask_dict = _bidask_to_dict(bidask)
                _write_bidask_to_buffer(symbol, bidask_dict)
            except Exception:
                logger.exception("Error in on_bidask bridge")

        # Attempt to use SDK bidask subscription — SDK may not support this in all versions
        subscribe_fn = getattr(api.Quote, "subscribe_bidask", None)
        set_cb_fn = getattr(api.Quote, "set_cb_bidask", None)  # W2c fix: was set_cb_bid_ask (typo)
        if subscribe_fn is None or set_cb_fn is None:
            raise NotImplementedError(
                "KGI SDK does not expose api.Quote.subscribe_bidask / set_cb_bidask "
                "on this version. BidAsk endpoint surface exists but SDK call is stubbed (501)."
            )

        set_cb_fn(on_bidask, version=QuoteVersion.v1)
        label = subscribe_fn(symbol, odd_lot=odd_lot, version=QuoteVersion.v1)
        label_str = str(label) if label is not None else f"bidask_{symbol}"

        with self._lock:
            self._bidask_subscriptions[symbol] = label_str
        with _BUFFER_LOCK:
            _BIDASK_SUBSCRIBED.add(symbol)

        logger.info("Subscribed bidask: symbol=%s label=%s", symbol, label_str)
        return label_str

    # ------------------------------------------------------------------
    # WS broadcast pump
    # ------------------------------------------------------------------

    async def tick_broadcast_pump(self) -> None:
        """
        Runs as an asyncio background task.
        Drains tick_queue and broadcasts JSON to all connected WS clients.
        """
        while True:
            tick_dict = await self._tick_queue.get()
            if not self._ws_clients:
                continue
            message = json.dumps({"type": "tick", "data": tick_dict})
            dead = set()
            for ws in self._ws_clients:
                try:
                    await ws.send_text(message)
                except Exception:
                    dead.add(ws)
            for ws in dead:
                self._ws_clients.discard(ws)


# ---------------------------------------------------------------------------
# Helper: convert KGI Tick object to plain dict
# ---------------------------------------------------------------------------

def _tick_to_dict(tick) -> dict:
    """
    Convert a kgisuperpy Tick_Stock_v1 object to a plain dict.
    Matches TickEvent schema (snake_case).

    KGI tick attrs:
      exchange, symbol, delay_time, odd_lot, datetime,
      open, high, low, close, volume, total_volume,
      chg_type, price_chg, pct_chg, simtrade, suspend, amount
    Source: brokerport_golden_2026-04-23.md §62-64
    """
    return {
        "exchange": getattr(tick, "exchange", ""),
        "symbol": getattr(tick, "symbol", ""),
        "delay_time": float(getattr(tick, "delay_time", 0.0)),
        "odd_lot": bool(getattr(tick, "odd_lot", False)),
        "datetime": str(getattr(tick, "datetime", "")),
        "open": float(getattr(tick, "open", 0.0)),
        "high": float(getattr(tick, "high", 0.0)),
        "low": float(getattr(tick, "low", 0.0)),
        "close": float(getattr(tick, "close", 0.0)),
        "volume": float(getattr(tick, "volume", 0.0)),
        "total_volume": float(getattr(tick, "total_volume", 0.0)),
        "chg_type": int(getattr(tick, "chg_type", 0)),
        "price_chg": float(getattr(tick, "price_chg", 0.0)),
        "pct_chg": float(getattr(tick, "pct_chg", 0.0)),
        "simtrade": int(getattr(tick, "simtrade", 0)),
        "suspend": int(getattr(tick, "suspend", 0)),
        "amount": float(getattr(tick, "amount", 0.0)),
    }


def _bidask_to_dict(bidask) -> dict:
    """
    Convert a kgisuperpy BidAsk_Stock_v1 object to a plain dict.
    Matches BidAskEvent schema (snake_case).
    Source: schemas.py BidAskEvent field list.
    """
    return {
        "exchange": getattr(bidask, "exchange", ""),
        "symbol": getattr(bidask, "symbol", ""),
        "delay_time": float(getattr(bidask, "delay_time", 0.0)),
        "odd_lot": bool(getattr(bidask, "odd_lot", False)),
        "datetime": str(getattr(bidask, "datetime", "")),
        "bid_prices": list(getattr(bidask, "bid_prices", [])),
        "bid_volumes": list(getattr(bidask, "bid_volumes", [])),
        "ask_prices": list(getattr(bidask, "ask_prices", [])),
        "ask_volumes": list(getattr(bidask, "ask_volumes", [])),
        "diff_ask_vol": list(getattr(bidask, "diff_ask_vol", [])),
        "diff_bid_vol": list(getattr(bidask, "diff_bid_vol", [])),
        "simtrade": int(getattr(bidask, "simtrade", 0)),
        "suspend": int(getattr(bidask, "suspend", 0)),
    }


# Module-level singleton
quote_manager = KgiQuoteManager()
