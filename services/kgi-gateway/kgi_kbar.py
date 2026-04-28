"""
kgi_kbar.py — KGI Gateway K-bar (OHLCV) endpoint backend.

W3 B2: K-bar Phase 2 backend implementation.

Endpoints (registered in app.py):
  GET  /quote/kbar/recover?symbol=<S>&from=<YYYYMMDD>&to=<YYYYMMDD>
       → TWStockQuote.recover_kbar(symbol, from, to)
  POST /quote/subscribe/kbar   (body: {symbol, odd_lot})
       → TWStockQuote.subscribe_kbar(symbol) + set_cb_kbar(callback)
  GET  /quote/kbar?symbol=<S>&limit=<N>
       → ring buffer of last N K-bars for a subscribed symbol

Hard lines (W3 B2):
  - NO K-bar import of any order module
  - NO K-bar callback that triggers signal / order queue
  - Unsupported intervals are recorded in UNSUPPORTED_INTERVAL_MATRIX; NOT hard-transcoded
  - subscribe_kbar has QUOTE_DISABLED breaker (mirror W2d subscribe-gap fix pattern)
  - Production-side WS push is DRAFT-only / sandbox-only — not activated in production

KBar shape (aligned with Jim sandbox mock-kbar shape):
  { time: int (unix ms), open: float, high: float, low: float, close: float, volume: float }

Interval handling:
  - W3 B2 first version: SDK does not expose interval parameter on subscribe_kbar
    (confirmed via introspection — see v0_7_0_kbar_api_audit.md §6 Q1)
  - Interval stored in unsupported matrix for Q1–Q5 resolution at Phase 3
  - recover_kbar accepts from/to date range (YYYYMMDD strings)
  - All timestamps normalised to UTC ISO8601 before sending to apps/api

Design mirrors W2d tick/bidask pattern:
  - ring buffer: _KBAR_BUFFER[symbol] = deque(maxlen=200)
  - subscribed set: _KBAR_SUBSCRIBED
  - write callback: set_kbar_callback(api) → called once per subscribe
  - broadcast: kbar_broadcast_pump (asyncio task, mirrors tick_broadcast_pump)
"""

from __future__ import annotations

import asyncio
import json
import logging
import threading
from collections import deque
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger("kgi_kbar")

# ---------------------------------------------------------------------------
# W3 B2: Interval support matrix
# ---------------------------------------------------------------------------

# Supported interval values (per W3 B2 first-version spec)
SUPPORTED_INTERVALS = frozenset({"1m", "5m", "15m", "1d"})

# Unsupported interval matrix — populated when unsupported intervals are requested.
# Hard line: do NOT hard-transcode unsupported intervals — record them here instead.
# Keys are interval strings; values are the reason they are unsupported.
UNSUPPORTED_INTERVAL_MATRIX: dict[str, str] = {
    "30m": "SDK subscribe_kbar does not expose resolution parameter; 30m interval not confirmed",
    "1h": "SDK subscribe_kbar does not expose resolution parameter; 1h interval not confirmed",
    "4h": "SDK subscribe_kbar does not expose resolution parameter; 4h interval not confirmed",
    "1w": "SDK subscribe_kbar does not expose resolution parameter; 1w interval not confirmed",
    "1M": "SDK subscribe_kbar does not expose resolution parameter; monthly interval not confirmed",
}

# Note on Q1 (interval resolution): Per v0_7_0_kbar_api_audit.md §6 Q1,
# kgisuperpy subscribe_kbar does not have a documented resolution parameter.
# The SDK appears to push bars at whatever granularity the exchange provides.
# The supported set {1m, 5m, 15m, 1d} is the INTENDED supported set for W3 B2;
# actual resolution confirmation requires a live session (Phase 3 Q1 resolution).
# Until then, only recover_kbar with from/to date range is live-verified.

# ---------------------------------------------------------------------------
# Ring buffer (module-level, mirrors _TICK_BUFFER pattern)
# ---------------------------------------------------------------------------

_KBAR_BUFFER: dict[str, deque] = {}       # symbol → deque(maxlen=200)
_KBAR_SUBSCRIBED: set[str] = set()        # symbols with active kbar subscription
_KBAR_LOCK = threading.Lock()
_KBAR_BUFFER_MAXLEN = 200


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _write_kbar_to_buffer(symbol: str, kbar_dict: dict) -> None:
    """Write a K-bar dict into the ring buffer. Called from SDK callback thread."""
    with _KBAR_LOCK:
        if symbol not in _KBAR_BUFFER:
            _KBAR_BUFFER[symbol] = deque(maxlen=_KBAR_BUFFER_MAXLEN)
        _KBAR_BUFFER[symbol].append({**kbar_dict, "_received_at": _now_iso()})


def get_recent_kbars(symbol: str, limit: int = 10) -> list[dict]:
    """Return last `limit` K-bars for symbol from ring buffer. Thread-safe."""
    with _KBAR_LOCK:
        buf = _KBAR_BUFFER.get(symbol)
        if buf is None:
            return []
        return list(buf)[-limit:]


def is_kbar_subscribed(symbol: str) -> bool:
    """Return True if symbol has an active K-bar subscription."""
    with _KBAR_LOCK:
        return symbol in _KBAR_SUBSCRIBED


def get_kbar_buffer_status() -> dict:
    """Return current K-bar buffer state (mirrors get_quote_status pattern)."""
    with _KBAR_LOCK:
        kbar_info = {}
        for sym, buf in _KBAR_BUFFER.items():
            last_at = buf[-1].get("_received_at") if buf else None
            kbar_info[sym] = {
                "count": len(buf),
                "maxlen": _KBAR_BUFFER_MAXLEN,
                "last_received_at": last_at,
            }
        return {
            "subscribed_symbols": sorted(_KBAR_SUBSCRIBED),
            "buffer": kbar_info,
        }


# ---------------------------------------------------------------------------
# K-bar object normalisation
# ---------------------------------------------------------------------------

def _normalise_timestamp(ts) -> int:
    """
    Normalise a K-bar timestamp to Unix milliseconds (int).

    SDK may return:
      - datetime object
      - string "2026-04-27 09:00:00" (TST, no tz info)
      - string "2026-04-27T09:00:00+08:00" (with tz)
      - int (unix seconds or ms)
      - float (unix seconds)

    Per Q3 (v0_7_0_kbar_api_audit.md §6): We treat bare strings as TST (UTC+8).
    All outputs are in unix milliseconds for Jim sandbox lightweight-charts compat.
    """
    if ts is None:
        return int(datetime.now(timezone.utc).timestamp() * 1000)

    if isinstance(ts, (int, float)):
        # If value looks like seconds (< 1e10), convert to ms
        if ts < 1e10:
            return int(ts * 1000)
        return int(ts)

    if isinstance(ts, datetime):
        if ts.tzinfo is None:
            # Assume TST (UTC+8)
            import zoneinfo
            try:
                tst = zoneinfo.ZoneInfo("Asia/Taipei")
                ts = ts.replace(tzinfo=tst)
            except Exception:
                # Fallback: treat as UTC
                ts = ts.replace(tzinfo=timezone.utc)
        return int(ts.timestamp() * 1000)

    if isinstance(ts, str):
        # Try ISO parse first
        for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
            try:
                dt = datetime.strptime(ts, fmt)
                if dt.tzinfo is None:
                    # Assume TST
                    import zoneinfo
                    try:
                        tst = zoneinfo.ZoneInfo("Asia/Taipei")
                        dt = dt.replace(tzinfo=tst)
                    except Exception:
                        dt = dt.replace(tzinfo=timezone.utc)
                return int(dt.timestamp() * 1000)
            except ValueError:
                continue
        # Last resort: epoch
        logger.warning("kbar_ts_parse_failed: cannot parse '%s', using now", ts)
        return int(datetime.now(timezone.utc).timestamp() * 1000)

    return int(datetime.now(timezone.utc).timestamp() * 1000)


def _kbar_to_dict(kbar) -> dict:
    """
    Convert a kgisuperpy KBar object (or dict) to the canonical KBar shape.

    Output shape: { time, open, high, low, close, volume }
    (Per Jim sandbox mock-kbar alignment — v0_7_0_kbar_api_audit.md §1)

    Hard line: NO signal/order write — this is a pure data normalisation step.
    """
    if isinstance(kbar, dict):
        raw = kbar
    else:
        raw = {}
        for attr in ["time", "datetime", "date", "open", "high", "low", "close", "volume"]:
            val = getattr(kbar, attr, None)
            if val is not None:
                raw[attr] = val

    # Time field resolution order: time > datetime > date
    ts_raw = raw.get("time") or raw.get("datetime") or raw.get("date")
    time_ms = _normalise_timestamp(ts_raw)

    return {
        "time": time_ms,
        "open": float(raw.get("open") or 0.0),
        "high": float(raw.get("high") or 0.0),
        "low": float(raw.get("low") or 0.0),
        "close": float(raw.get("close") or 0.0),
        "volume": float(raw.get("volume") or 0.0),
    }


# ---------------------------------------------------------------------------
# KgiKbarManager — manages subscriptions + callback bridge
# ---------------------------------------------------------------------------

class KgiKbarManager:
    """
    Manages K-bar subscriptions and bridges SDK callbacks to asyncio.
    Mirrors KgiQuoteManager pattern from kgi_quote.py.

    Hard lines:
      - on_kbar callback MUST NOT write to any signal queue or order queue
      - subscribe_kbar has QUOTE_DISABLED pre-check (enforced in app.py)
      - WS push is DRAFT-only / sandbox-only
    """

    def __init__(self) -> None:
        self._subscriptions: dict[str, str] = {}   # symbol → label
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._kbar_queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=1000)
        self._ws_clients: set = set()
        self._lock = threading.Lock()
        self._cb_registered = False   # set_cb_kbar called once globally

    def set_event_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def register_ws_client(self, ws) -> None:
        self._ws_clients.add(ws)

    def unregister_ws_client(self, ws) -> None:
        self._ws_clients.discard(ws)

    def subscribe_kbar(self, api, symbol: str, odd_lot: bool = False) -> str:
        """
        Register on_kbar callback and subscribe to symbol K-bar stream.

        Callback runs in SDK thread → bridges via asyncio queue AND ring buffer.
        Idempotent: returns existing label if already subscribed.

        Hard line: on_kbar MUST NOT write to signal/order queue.
        Returns subscription label.
        """
        if symbol in self._subscriptions:
            return self._subscriptions[symbol]

        def on_kbar(kbar):
            """
            Single-param K-bar callback — NOT a signal/order trigger.
            Writes to ring buffer for REST poll + asyncio queue for WS push.
            Hard line: no signal queue write, no order queue write.
            """
            try:
                kbar_dict = _kbar_to_dict(kbar)
                # Write to ring buffer (REST poll consumers)
                _write_kbar_to_buffer(symbol, kbar_dict)
                # Bridge to asyncio WS push queue (DRAFT-only / sandbox-only)
                if self._loop and self._loop.is_running():
                    asyncio.run_coroutine_threadsafe(
                        self._kbar_queue.put({**kbar_dict, "symbol": symbol}),
                        self._loop,
                    )
            except Exception:
                logger.exception("Error in on_kbar bridge for symbol=%s", symbol)

        # Register callback once per manager (SDK global callback)
        if not self._cb_registered:
            subscribe_fn = getattr(api.Quote, "set_cb_kbar", None)
            if subscribe_fn is not None:
                try:
                    # Try with version kwarg first (mirrors tick pattern)
                    from kgisuperpy.marketdata.quote_data.quotedata import QuoteData as _QuoteData
                    QuoteVersion = _QuoteData.QuoteVersion
                    subscribe_fn(on_kbar, version=QuoteVersion.v1)
                except Exception:
                    subscribe_fn(on_kbar)
            self._cb_registered = True
        else:
            # Callback already registered — just update with new symbol closure
            # This is a limitation: SDK has one global callback.
            # For W3 B2 single-symbol scope this is acceptable.
            logger.debug("kbar_cb_already_registered: symbol=%s reusing existing callback", symbol)

        # Subscribe to K-bar for this symbol
        kbar_subscribe_fn = getattr(api.Quote, "subscribe_kbar", None)
        if kbar_subscribe_fn is None:
            raise NotImplementedError(
                "KGI SDK does not expose api.Quote.subscribe_kbar on this version."
            )

        try:
            from kgisuperpy.marketdata.quote_data.quotedata import QuoteData as _QuoteData
            QuoteVersion = _QuoteData.QuoteVersion
            # odd_lot kwarg removed: installed kgisuperpy subscribe_kbar() does not accept it (W4 B2 Q1 fix)
            label = kbar_subscribe_fn(symbol, version=QuoteVersion.v1)
        except Exception:
            # Fallback: no version kwarg, no odd_lot kwarg
            label = kbar_subscribe_fn(symbol)

        label_str = str(label) if label is not None else f"kbar_{symbol}"

        with self._lock:
            self._subscriptions[symbol] = label_str
        with _KBAR_LOCK:
            _KBAR_SUBSCRIBED.add(symbol)
            if symbol not in _KBAR_BUFFER:
                _KBAR_BUFFER[symbol] = deque(maxlen=_KBAR_BUFFER_MAXLEN)

        logger.info("kbar_subscribed: symbol=%s label=%s", symbol, label_str)
        return label_str

    async def kbar_broadcast_pump(self) -> None:
        """
        Asyncio background task.
        Drains kbar_queue and broadcasts JSON to all connected WS clients.

        DRAFT-only / sandbox-only: production-side WS is not activated in W3 B2.
        Hard line: broadcast payload is kbar data only — no signal/order content.
        """
        while True:
            kbar_dict = await self._kbar_queue.get()
            if not self._ws_clients:
                continue
            message = json.dumps({"type": "kbar", "data": kbar_dict})
            dead = set()
            for ws in self._ws_clients:
                try:
                    await ws.send_text(message)
                except Exception:
                    dead.add(ws)
            for ws in dead:
                self._ws_clients.discard(ws)


# ---------------------------------------------------------------------------
# recover_kbar — historical K-bar REST helper
# ---------------------------------------------------------------------------

def recover_kbar_from_sdk(api, symbol: str, from_date: str, to_date: str) -> list[dict]:
    """
    Call TWStockQuote.recover_kbar(symbol, from_date, to_date) and normalise result.

    Returns list of KBar dicts: [{time, open, high, low, close, volume}, ...]
    Returns [] if SDK returns None or empty.

    Hard line: no signal/order write.
    """
    recover_fn = getattr(api.Quote, "recover_kbar", None)
    if recover_fn is None:
        raise NotImplementedError("KGI SDK does not expose api.Quote.recover_kbar")

    try:
        raw = recover_fn(symbol, from_date, to_date)
    except Exception as exc:
        logger.error("recover_kbar_failed: symbol=%s from=%s to=%s error=%s",
                     symbol, from_date, to_date, type(exc).__name__)
        raise

    if raw is None:
        return []

    if hasattr(raw, "empty") and raw.empty:
        return []

    # SDK may return DataFrame or list-like
    if hasattr(raw, "to_dict"):
        # pandas DataFrame
        try:
            rows = raw.reset_index().to_dict(orient="records")
        except Exception:
            rows = raw.to_dict(orient="records")
        return [_kbar_to_dict(row) for row in rows]

    if isinstance(raw, (list, tuple)):
        return [_kbar_to_dict(item) for item in raw]

    logger.warning("recover_kbar_unknown_type: type=%s", type(raw).__name__)
    return []


# ---------------------------------------------------------------------------
# Module-level manager singleton
# ---------------------------------------------------------------------------

kbar_manager = KgiKbarManager()
