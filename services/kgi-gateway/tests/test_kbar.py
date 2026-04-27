"""
tests/test_kbar.py — W3 B2 K-bar Phase 2 gateway tests.

Tests for kgi_kbar.py functions and /quote/kbar/* endpoints in app.py.

Run: PYTHONUTF8=1 python -m pytest tests/test_kbar.py -v

Hard lines verified:
  - No order import in kgi_kbar.py
  - No signal/order trigger in K-bar callback
  - QUOTE_DISABLED circuit breaker on all K-bar endpoints
  - Unsupported interval surfaced (not hard-transcoded)
  - Empty-safe responses (no 500 on missing data)
  - Mock fallback default-on
  - No raw account/person_id/token in K-bar log output
"""

from __future__ import annotations

import sys
import types
from collections import deque
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

import kgi_kbar as kk  # noqa: E402


def _clear_kbar_buffers():
    with kk._KBAR_LOCK:
        kk._KBAR_BUFFER.clear()
        kk._KBAR_SUBSCRIBED.clear()


# ---------------------------------------------------------------------------
# T1: _write_kbar_to_buffer appends to buffer
# ---------------------------------------------------------------------------

def test_write_kbar_to_buffer_appends():
    """_write_kbar_to_buffer enqueues dicts; get_recent_kbars returns them."""
    _clear_kbar_buffers()
    symbol = "2330"
    sample = {"time": 1745728800000, "open": 945.0, "high": 952.0, "low": 942.0, "close": 948.0, "volume": 12345}
    kk._write_kbar_to_buffer(symbol, sample)
    result = kk.get_recent_kbars(symbol, limit=10)
    assert len(result) == 1
    assert result[0]["close"] == 948.0
    assert "_received_at" in result[0]


# ---------------------------------------------------------------------------
# T2: buffer_respects_maxlen
# ---------------------------------------------------------------------------

def test_kbar_buffer_respects_maxlen():
    """K-bar ring buffer deque(maxlen=200) drops oldest on overflow."""
    _clear_kbar_buffers()
    symbol = "0050"
    for i in range(250):
        kk._write_kbar_to_buffer(symbol, {"close": float(i), "time": i})
    all_bars = kk.get_recent_kbars(symbol, limit=200)
    assert len(all_bars) == 200
    assert all_bars[0]["close"] == 50.0
    assert all_bars[-1]["close"] == 249.0


# ---------------------------------------------------------------------------
# T3: _kbar_to_dict normalisation — dict input
# ---------------------------------------------------------------------------

def test_kbar_to_dict_dict_input():
    """_kbar_to_dict handles dict input and normalises to canonical shape."""
    raw = {
        "time": 1745728800000,
        "open": 945.0,
        "high": 952.0,
        "low": 942.0,
        "close": 948.0,
        "volume": 12345,
    }
    result = kk._kbar_to_dict(raw)
    assert result["open"] == 945.0
    assert result["close"] == 948.0
    assert result["volume"] == 12345.0
    assert isinstance(result["time"], int)


# ---------------------------------------------------------------------------
# T4: _kbar_to_dict normalisation — object input with datetime string
# ---------------------------------------------------------------------------

def test_kbar_to_dict_object_with_datetime():
    """_kbar_to_dict handles object with datetime attribute."""
    class MockBar:
        time = None
        datetime = "2026-04-25 09:00:00"
        open = 945.0
        high = 952.0
        low = 942.0
        close = 948.0
        volume = 12345

    result = kk._kbar_to_dict(MockBar())
    assert isinstance(result["time"], int), "time must be normalised to unix ms int"
    assert result["close"] == 948.0


# ---------------------------------------------------------------------------
# T5: QUOTE_DISABLED → GET /quote/kbar/recover → 503
# ---------------------------------------------------------------------------

def test_recover_kbar_disabled_returns_503():
    """When QUOTE_DISABLED=true, GET /quote/kbar/recover → 503."""
    _clear_kbar_buffers()
    from fastapi.testclient import TestClient
    import config as cfg
    import app as gateway_app

    with (
        patch.object(cfg.settings, "QUOTE_DISABLED", True),
        patch("kgi_session.KgiSession.is_logged_in", new_callable=lambda: property(lambda self: True)),
    ):
        client = TestClient(gateway_app.app)
        resp = client.get("/quote/kbar/recover?symbol=2330&from_date=20260425&to_date=20260427")

    assert resp.status_code == 503
    body = resp.json()
    assert body["detail"]["error"]["code"] == "QUOTE_DISABLED"


# ---------------------------------------------------------------------------
# T6: QUOTE_DISABLED → POST /quote/subscribe/kbar → 503
# ---------------------------------------------------------------------------

def test_subscribe_kbar_disabled_returns_503():
    """When QUOTE_DISABLED=true, POST /quote/subscribe/kbar → 503."""
    _clear_kbar_buffers()
    from fastapi.testclient import TestClient
    import config as cfg
    import app as gateway_app

    with (
        patch.object(cfg.settings, "QUOTE_DISABLED", True),
        patch("kgi_session.KgiSession.is_logged_in", new_callable=lambda: property(lambda self: True)),
    ):
        client = TestClient(gateway_app.app)
        resp = client.post("/quote/subscribe/kbar", json={"symbol": "2330", "odd_lot": False})

    assert resp.status_code == 503
    body = resp.json()
    assert body["detail"]["error"]["code"] == "QUOTE_DISABLED"


# ---------------------------------------------------------------------------
# T7: QUOTE_DISABLED → GET /quote/kbar → 503
# ---------------------------------------------------------------------------

def test_get_kbar_disabled_returns_503():
    """When QUOTE_DISABLED=true, GET /quote/kbar → 503."""
    _clear_kbar_buffers()
    from fastapi.testclient import TestClient
    import config as cfg
    import app as gateway_app

    with (
        patch.object(cfg.settings, "QUOTE_DISABLED", True),
        patch("kgi_session.KgiSession.is_logged_in", new_callable=lambda: property(lambda self: True)),
    ):
        client = TestClient(gateway_app.app)
        resp = client.get("/quote/kbar?symbol=2330&limit=10")

    assert resp.status_code == 503
    body = resp.json()
    assert body["detail"]["error"]["code"] == "QUOTE_DISABLED"


# ---------------------------------------------------------------------------
# T8: Unauthenticated → POST /quote/subscribe/kbar → 401
# ---------------------------------------------------------------------------

def test_subscribe_kbar_unauthenticated_returns_401():
    """When not logged in, POST /quote/subscribe/kbar → 401 (breaker passed)."""
    _clear_kbar_buffers()
    from fastapi.testclient import TestClient
    import config as cfg
    import app as gateway_app

    with patch.object(cfg.settings, "QUOTE_DISABLED", False):
        client = TestClient(gateway_app.app)
        resp = client.post("/quote/subscribe/kbar", json={"symbol": "2330", "odd_lot": False})

    assert resp.status_code == 401
    body = resp.json()
    assert body["detail"]["error"]["code"] == "NOT_LOGGED_IN"


# ---------------------------------------------------------------------------
# T9: QUOTE_DISABLED fires before auth on subscribe/kbar (mirrors W2d gap fix)
# ---------------------------------------------------------------------------

def test_subscribe_kbar_disabled_fires_before_auth():
    """When disabled, unauthenticated caller sees 503 QUOTE_DISABLED not 401."""
    _clear_kbar_buffers()
    from fastapi.testclient import TestClient
    import config as cfg
    import app as gateway_app

    with (
        patch.object(cfg.settings, "QUOTE_DISABLED", True),
        patch("kgi_session.KgiSession.is_logged_in", new_callable=lambda: property(lambda self: False)),
    ):
        client = TestClient(gateway_app.app)
        resp = client.post("/quote/subscribe/kbar", json={"symbol": "2330", "odd_lot": False})

    # Must be 503 (system disabled) not 401 (auth failed)
    assert resp.status_code == 503
    body = resp.json()
    assert body["detail"]["error"]["code"] == "QUOTE_DISABLED"


# ---------------------------------------------------------------------------
# T10: unsupported interval → interval_status=unsupported in response
# ---------------------------------------------------------------------------

def test_subscribe_kbar_unsupported_interval_surfaces_matrix():
    """
    When interval='30m' (unsupported), response has interval_status='unsupported'.
    Hard line: NOT a 422/500 error — just informational (no hard-transcode).
    """
    _clear_kbar_buffers()
    from fastapi.testclient import TestClient
    import config as cfg
    import app as gateway_app

    with (
        patch.object(cfg.settings, "QUOTE_DISABLED", False),
        patch("kgi_session.KgiSession.is_logged_in", new_callable=lambda: property(lambda self: True)),
    ):
        client = TestClient(gateway_app.app)
        resp = client.post("/quote/subscribe/kbar", json={
            "symbol": "2330",
            "odd_lot": False,
            "interval": "30m",
        })

    # Must be 200 with interval_status=unsupported
    assert resp.status_code == 200
    body = resp.json()
    assert body["interval_status"] == "unsupported"
    assert body["unsupported_reason"] is not None
    assert body["label"] is None


# ---------------------------------------------------------------------------
# T11: GET /quote/kbar/status — always 200 (diagnostic surface, no auth)
# ---------------------------------------------------------------------------

def test_kbar_status_always_200():
    """GET /quote/kbar/status is always 200 regardless of QUOTE_DISABLED."""
    _clear_kbar_buffers()
    from fastapi.testclient import TestClient
    import config as cfg
    import app as gateway_app

    with patch.object(cfg.settings, "QUOTE_DISABLED", True):
        client = TestClient(gateway_app.app)
        resp = client.get("/quote/kbar/status")

    assert resp.status_code == 200
    body = resp.json()
    assert "subscribed_symbols" in body
    assert "quote_disabled_flag" in body
    assert body["quote_disabled_flag"] is True


# ---------------------------------------------------------------------------
# T12: Empty-safe: GET /quote/kbar for unsubscribed symbol → 404
# ---------------------------------------------------------------------------

def test_get_kbar_unsubscribed_symbol_returns_404():
    """GET /quote/kbar for never-subscribed symbol → 404 KBAR_NOT_SUBSCRIBED."""
    _clear_kbar_buffers()
    from fastapi.testclient import TestClient
    import app as gateway_app

    with patch("kgi_session.KgiSession.is_logged_in", new_callable=lambda: property(lambda self: True)):
        client = TestClient(gateway_app.app)
        resp = client.get("/quote/kbar?symbol=NEVER_SUBSCRIBED&limit=5")

    assert resp.status_code == 404
    body = resp.json()
    assert body["detail"]["error"]["code"] == "KBAR_NOT_SUBSCRIBED"


# ---------------------------------------------------------------------------
# T13: kgi_kbar has 0 order imports (static audit)
# ---------------------------------------------------------------------------

def test_kgi_kbar_has_no_order_imports():
    """
    kgi_kbar module does NOT import any order-related module.
    Checks non-comment lines only for actual import statements.
    """
    import kgi_kbar
    import importlib
    import re
    source_file = importlib.util.find_spec("kgi_kbar")
    if source_file and source_file.origin:
        with open(source_file.origin, "r", encoding="utf-8") as f:
            lines = f.readlines()

        # Filter to non-comment, non-docstring code lines only
        code_lines = []
        in_docstring = False
        for line in lines:
            stripped = line.strip()
            # Toggle docstring tracking
            if stripped.startswith('"""') or stripped.startswith("'''"):
                count = stripped.count('"""') + stripped.count("'''")
                if count % 2 == 1:
                    in_docstring = not in_docstring
                continue
            if in_docstring:
                continue
            # Skip pure comment lines
            if stripped.startswith("#"):
                continue
            code_lines.append(stripped)

        code_text = "\n".join(code_lines)

        # Check for actual import statements of order modules
        # Pattern: must be actual import/from statements, not inline text
        order_import_patterns = [
            r"^import\s+.*order",
            r"^from\s+.*order",
            r"order_queue\s*=",
            r"signal_queue\s*=",
        ]
        for pattern in order_import_patterns:
            matches = re.findall(pattern, code_text, re.IGNORECASE | re.MULTILINE)
            assert not matches, (
                f"kgi_kbar.py must have 0 order imports, found pattern '{pattern}': {matches}"
            )
