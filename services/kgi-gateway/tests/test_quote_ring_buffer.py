"""
tests/test_quote_ring_buffer.py — W2b unit tests for ring buffer + quote endpoints.

Runs without kgisuperpy installed (monkeypatches session + quote internals).
Run: PYTHONUTF8=1 python -m pytest tests/test_quote_ring_buffer.py -v
"""

from __future__ import annotations

import sys
import types
from unittest.mock import MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# Minimal kgisuperpy stub so imports in kgi_quote / app don't fail
# ---------------------------------------------------------------------------

def _make_kgisuperpy_stub():
    pkg = types.ModuleType("kgisuperpy")
    md = types.ModuleType("kgisuperpy.marketdata")
    qd_pkg = types.ModuleType("kgisuperpy.marketdata.quote_data")
    qd_mod = types.ModuleType("kgisuperpy.marketdata.quote_data.quotedata")

    class _QuoteData:
        class QuoteVersion:
            v1 = "v1"

    qd_mod.QuoteData = _QuoteData
    sys.modules.setdefault("kgisuperpy", pkg)
    sys.modules.setdefault("kgisuperpy.marketdata", md)
    sys.modules.setdefault("kgisuperpy.marketdata.quote_data", qd_pkg)
    sys.modules.setdefault("kgisuperpy.marketdata.quote_data.quotedata", qd_mod)


_make_kgisuperpy_stub()

# Now safe to import our modules
import kgi_quote as kq  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers to reset module-level buffers between tests
# ---------------------------------------------------------------------------

def _clear_buffers():
    with kq._BUFFER_LOCK:
        kq._TICK_BUFFER.clear()
        kq._BIDASK_LATEST.clear()
        kq._TICK_SUBSCRIBED.clear()
        kq._BIDASK_SUBSCRIBED.clear()


# ---------------------------------------------------------------------------
# T1: tick_callback_appends_to_buffer
# ---------------------------------------------------------------------------

def test_tick_callback_appends_to_buffer():
    """_write_tick_to_buffer enqueues dicts; get_recent_ticks returns them."""
    _clear_buffers()
    symbol = "2330"
    for i in range(5):
        kq._write_tick_to_buffer(symbol, {"close": 580.0 + i, "symbol": symbol})
    result = kq.get_recent_ticks(symbol, limit=10)
    assert len(result) == 5
    assert result[0]["close"] == 580.0
    assert "_received_at" in result[0]


# ---------------------------------------------------------------------------
# T2: buffer_respects_maxlen (enqueue 250 → keep 200, drop oldest 50)
# ---------------------------------------------------------------------------

def test_buffer_respects_maxlen():
    """deque(maxlen=200): enqueueing 250 items drops oldest 50."""
    _clear_buffers()
    symbol = "0050"
    for i in range(250):
        kq._write_tick_to_buffer(symbol, {"close": float(i), "symbol": symbol})
    all_ticks = kq.get_recent_ticks(symbol, limit=200)
    assert len(all_ticks) == 200
    # oldest kept should be item 50 (0-indexed), i.e. close == 50.0
    assert all_ticks[0]["close"] == 50.0
    # newest should be item 249
    assert all_ticks[-1]["close"] == 249.0


# ---------------------------------------------------------------------------
# T3: GET /quote/ticks endpoint — 200 with correct shape
# ---------------------------------------------------------------------------

def test_get_quote_ticks_endpoint_shape():
    """TestClient GET /quote/ticks returns 200 + correct JSON shape when subscribed."""
    _clear_buffers()
    symbol = "2330"

    # Pre-populate buffer and mark as subscribed
    kq._write_tick_to_buffer(symbol, {"close": 580.0, "symbol": symbol})
    with kq._BUFFER_LOCK:
        kq._TICK_SUBSCRIBED.add(symbol)

    from fastapi.testclient import TestClient

    # Patch session to appear logged in, then import app
    with patch("kgi_session.KgiSession.is_logged_in", new_callable=lambda: property(lambda self: True)):
        import app as gateway_app  # noqa: PLC0415
        client = TestClient(gateway_app.app)
        resp = client.get(f"/quote/ticks?symbol={symbol}&limit=5")

    assert resp.status_code == 200
    body = resp.json()
    assert body["symbol"] == symbol
    assert isinstance(body["ticks"], list)
    assert "count" in body
    assert "buffer_size" in body
    assert body["count"] >= 1


# ---------------------------------------------------------------------------
# T4: quote_disabled circuit breaker → 503
# ---------------------------------------------------------------------------

def test_quote_disabled_breaker_returns_503():
    """When KGI_GATEWAY_QUOTE_DISABLED=true, GET /quote/ticks returns 503."""
    _clear_buffers()
    symbol = "2330"
    kq._write_tick_to_buffer(symbol, {"close": 580.0, "symbol": symbol})
    with kq._BUFFER_LOCK:
        kq._TICK_SUBSCRIBED.add(symbol)

    from fastapi.testclient import TestClient
    import config as cfg  # noqa: PLC0415

    with (
        patch.object(cfg.settings, "QUOTE_DISABLED", True),
        patch("kgi_session.KgiSession.is_logged_in", new_callable=lambda: property(lambda self: True)),
    ):
        import app as gateway_app  # noqa: PLC0415
        client = TestClient(gateway_app.app)
        resp = client.get(f"/quote/ticks?symbol={symbol}&limit=5")

    assert resp.status_code == 503
    body = resp.json()
    # FastAPI wraps HTTPException.detail under {"detail": ...}
    assert body["detail"]["error"]["code"] == "QUOTE_DISABLED"


# ---------------------------------------------------------------------------
# T5: unsubscribed symbol → 404
# ---------------------------------------------------------------------------

def test_unsubscribed_symbol_returns_404():
    """GET /quote/ticks for a symbol that was never subscribed → 404."""
    _clear_buffers()

    from fastapi.testclient import TestClient

    with patch("kgi_session.KgiSession.is_logged_in", new_callable=lambda: property(lambda self: True)):
        import app as gateway_app  # noqa: PLC0415
        client = TestClient(gateway_app.app)
        resp = client.get("/quote/ticks?symbol=NEVER_SUBSCRIBED&limit=5")

    assert resp.status_code == 404
    body = resp.json()
    # FastAPI wraps HTTPException.detail under {"detail": ...}
    assert body["detail"]["error"]["code"] == "SYMBOL_NOT_SUBSCRIBED"
