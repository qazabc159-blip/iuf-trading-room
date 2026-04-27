"""
tests/test_subscribe_gap.py — W2d subscribe-gap pre-fix tests.

Verifies that POST /quote/subscribe/tick and POST /quote/subscribe/bidask
return 503 QUOTE_DISABLED when KGI_GATEWAY_QUOTE_DISABLED=true, matching
the same breaker pattern already in GET /quote/ticks and GET /quote/bidask.

Spec: w2d_quote_consumption_plan.md §11
Run: PYTHONUTF8=1 python -m pytest tests/test_subscribe_gap.py -v
"""

from __future__ import annotations

import sys
import types
from unittest.mock import MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# Minimal kgisuperpy stub (no real SDK required)
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

import kgi_quote as kq  # noqa: E402


def _clear_buffers():
    with kq._BUFFER_LOCK:
        kq._TICK_BUFFER.clear()
        kq._BIDASK_LATEST.clear()
        kq._TICK_SUBSCRIBED.clear()
        kq._BIDASK_SUBSCRIBED.clear()


# ---------------------------------------------------------------------------
# T1: QUOTE_DISABLED=true → POST /quote/subscribe/tick → 503 QUOTE_DISABLED
# ---------------------------------------------------------------------------

def test_subscribe_tick_disabled_returns_503():
    """When QUOTE_DISABLED=true, POST /quote/subscribe/tick → 503."""
    _clear_buffers()
    from fastapi.testclient import TestClient
    import config as cfg  # noqa: PLC0415

    with (
        patch.object(cfg.settings, "QUOTE_DISABLED", True),
        patch("kgi_session.KgiSession.is_logged_in", new_callable=lambda: property(lambda self: True)),
    ):
        import app as gateway_app  # noqa: PLC0415
        client = TestClient(gateway_app.app)
        resp = client.post("/quote/subscribe/tick", json={"symbol": "2330", "odd_lot": False})

    assert resp.status_code == 503
    body = resp.json()
    assert body["detail"]["error"]["code"] == "QUOTE_DISABLED"


# ---------------------------------------------------------------------------
# T2: QUOTE_DISABLED=true → POST /quote/subscribe/bidask → 503 QUOTE_DISABLED
# ---------------------------------------------------------------------------

def test_subscribe_bidask_disabled_returns_503():
    """When QUOTE_DISABLED=true, POST /quote/subscribe/bidask → 503."""
    _clear_buffers()
    from fastapi.testclient import TestClient
    import config as cfg  # noqa: PLC0415

    with (
        patch.object(cfg.settings, "QUOTE_DISABLED", True),
        patch("kgi_session.KgiSession.is_logged_in", new_callable=lambda: property(lambda self: True)),
    ):
        import app as gateway_app  # noqa: PLC0415
        client = TestClient(gateway_app.app)
        resp = client.post("/quote/subscribe/bidask", json={"symbol": "2330", "odd_lot": False})

    assert resp.status_code == 503
    body = resp.json()
    assert body["detail"]["error"]["code"] == "QUOTE_DISABLED"


# ---------------------------------------------------------------------------
# T3: QUOTE_DISABLED=false → POST /quote/subscribe/tick → not blocked by breaker
# (returns 401 because no real KGI session — breaker is NOT the reason for failure)
# ---------------------------------------------------------------------------

def test_subscribe_tick_enabled_passes_breaker():
    """When QUOTE_DISABLED=false, subscribe/tick proceeds past the breaker (hits auth)."""
    _clear_buffers()
    from fastapi.testclient import TestClient
    import config as cfg  # noqa: PLC0415

    with patch.object(cfg.settings, "QUOTE_DISABLED", False):
        import app as gateway_app  # noqa: PLC0415
        client = TestClient(gateway_app.app)
        resp = client.post("/quote/subscribe/tick", json={"symbol": "2330", "odd_lot": False})

    # With no real session, expect 401 (not 503) — breaker passed
    assert resp.status_code == 401
    body = resp.json()
    assert body["detail"]["error"]["code"] == "NOT_LOGGED_IN"


# ---------------------------------------------------------------------------
# T4: QUOTE_DISABLED=false → POST /quote/subscribe/bidask → not blocked by breaker
# ---------------------------------------------------------------------------

def test_subscribe_bidask_enabled_passes_breaker():
    """When QUOTE_DISABLED=false, subscribe/bidask proceeds past the breaker (hits auth)."""
    _clear_buffers()
    from fastapi.testclient import TestClient
    import config as cfg  # noqa: PLC0415

    with patch.object(cfg.settings, "QUOTE_DISABLED", False):
        import app as gateway_app  # noqa: PLC0415
        client = TestClient(gateway_app.app)
        resp = client.post("/quote/subscribe/bidask", json={"symbol": "2330", "odd_lot": False})

    # Without real session → 401 (not 503) — breaker passed
    assert resp.status_code == 401
    body = resp.json()
    assert body["detail"]["error"]["code"] == "NOT_LOGGED_IN"


# ---------------------------------------------------------------------------
# T5: QUOTE_DISABLED=true → GET /quote/status → 200 (diagnostic surface, no breaker)
# ---------------------------------------------------------------------------

def test_quote_status_always_200_when_disabled():
    """GET /quote/status is always 200 regardless of QUOTE_DISABLED (diagnostic surface)."""
    _clear_buffers()
    from fastapi.testclient import TestClient
    import config as cfg  # noqa: PLC0415

    with patch.object(cfg.settings, "QUOTE_DISABLED", True):
        import app as gateway_app  # noqa: PLC0415
        client = TestClient(gateway_app.app)
        resp = client.get("/quote/status")

    assert resp.status_code == 200
    body = resp.json()
    assert body["quote_disabled_flag"] is True


# ---------------------------------------------------------------------------
# T6: QUOTE_DISABLED breaker fires before auth check on subscribe/tick
# (unauthenticated caller should see 503 not 401 when system is disabled)
# ---------------------------------------------------------------------------

def test_subscribe_tick_disabled_fires_before_auth():
    """When disabled, unauthenticated caller sees 503 QUOTE_DISABLED not 401."""
    _clear_buffers()
    from fastapi.testclient import TestClient
    import config as cfg  # noqa: PLC0415

    # QUOTE_DISABLED=true AND session is NOT logged in
    with (
        patch.object(cfg.settings, "QUOTE_DISABLED", True),
        patch("kgi_session.KgiSession.is_logged_in", new_callable=lambda: property(lambda self: False)),
    ):
        import app as gateway_app  # noqa: PLC0415
        client = TestClient(gateway_app.app)
        resp = client.post("/quote/subscribe/tick", json={"symbol": "2330", "odd_lot": False})

    # Must be 503 (system disabled) not 401 (auth failed)
    assert resp.status_code == 503
    body = resp.json()
    assert body["detail"]["error"]["code"] == "QUOTE_DISABLED"
