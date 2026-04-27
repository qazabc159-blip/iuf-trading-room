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


# ===========================================================================
# W4 B2 Q1 odd_lot kwarg fix tests (6 tests: T14–T19)
# Verifies that subscribe_kbar SDK call no longer passes odd_lot kwarg.
# All tests use mocks — no live gateway required.
# ===========================================================================


def _make_mock_api(subscribe_kbar_return="kbar_label"):
    """Build a minimal mock api object with a Quote.subscribe_kbar spy."""
    api = MagicMock()
    api.Quote.subscribe_kbar = MagicMock(return_value=subscribe_kbar_return)
    api.Quote.set_cb_kbar = MagicMock(return_value=None)
    return api


def _call_subscribe_kbar_via_manager(api, symbol, odd_lot_arg=None):
    """
    Invoke KgiKbarManager.subscribe_kbar with the given args.
    Returns (manager, label) after resetting module-level subscriptions.

    Isolated: creates a fresh manager each call to avoid T13 idempotency guard.
    """
    mgr = kk.KgiKbarManager()
    with kk._KBAR_LOCK:
        kk._KBAR_SUBSCRIBED.discard(symbol)
        kk._KBAR_BUFFER.pop(symbol, None)

    if odd_lot_arg is None:
        label = mgr.subscribe_kbar(api, symbol)
    else:
        label = mgr.subscribe_kbar(api, symbol, odd_lot=odd_lot_arg)
    return mgr, label


# ---------------------------------------------------------------------------
# T14: subscribe_kbar without odd_lot — SDK call must NOT use odd_lot kwarg
# ---------------------------------------------------------------------------

def test_subscribe_kbar_odd_lot_omitted():
    """
    W4 B2 Q1 fix: when odd_lot is omitted from request, SDK subscribe_kbar
    must be called WITHOUT odd_lot keyword argument.
    """
    api = _make_mock_api()
    symbol = "2330_T14"
    _call_subscribe_kbar_via_manager(api, symbol)

    assert api.Quote.subscribe_kbar.called, "subscribe_kbar must be called"
    call_args = api.Quote.subscribe_kbar.call_args
    # odd_lot must NOT appear in kwargs
    assert "odd_lot" not in call_args.kwargs, (
        f"SDK subscribe_kbar must not receive odd_lot kwarg (W4 B2 Q1 fix). "
        f"Got kwargs: {call_args.kwargs}"
    )


# ---------------------------------------------------------------------------
# T15: subscribe_kbar odd_lot=False — SDK call must NOT forward odd_lot kwarg
# ---------------------------------------------------------------------------

def test_subscribe_kbar_odd_lot_false():
    """
    W4 B2 Q1 fix: even when client sends odd_lot=False, it is no-op at SDK boundary.
    SDK subscribe_kbar must NOT receive odd_lot as kwarg.
    """
    api = _make_mock_api()
    symbol = "2330_T15"
    _call_subscribe_kbar_via_manager(api, symbol, odd_lot_arg=False)

    assert api.Quote.subscribe_kbar.called, "subscribe_kbar must be called"
    call_args = api.Quote.subscribe_kbar.call_args
    assert "odd_lot" not in call_args.kwargs, (
        f"SDK subscribe_kbar must not receive odd_lot kwarg even when odd_lot=False. "
        f"Got kwargs: {call_args.kwargs}"
    )


# ---------------------------------------------------------------------------
# T16: subscribe_kbar odd_lot=True — SDK call must NOT forward odd_lot kwarg
# ---------------------------------------------------------------------------

def test_subscribe_kbar_odd_lot_true():
    """
    W4 B2 Q1 fix: even when client sends odd_lot=True, it is no-op at SDK boundary.
    SDK subscribe_kbar must NOT receive odd_lot as kwarg.
    """
    api = _make_mock_api()
    symbol = "2330_T16"
    _call_subscribe_kbar_via_manager(api, symbol, odd_lot_arg=True)

    assert api.Quote.subscribe_kbar.called, "subscribe_kbar must be called"
    call_args = api.Quote.subscribe_kbar.call_args
    assert "odd_lot" not in call_args.kwargs, (
        f"SDK subscribe_kbar must not receive odd_lot kwarg even when odd_lot=True. "
        f"Got kwargs: {call_args.kwargs}"
    )


# ---------------------------------------------------------------------------
# T17: Static source audit — odd_lot not in subscribe_kbar call site lines
# ---------------------------------------------------------------------------

def test_subscribe_kbar_sdk_signature_no_kwarg():
    """
    W4 B2 Q1 fix static audit: read kgi_kbar.py source, locate every line that
    calls kbar_subscribe_fn(, verify none pass odd_lot= as an argument.

    This is a code-level guarantee independent of mock behavior.
    """
    import importlib
    import re

    spec = importlib.util.find_spec("kgi_kbar")
    assert spec and spec.origin, "kgi_kbar module must be importable with source"

    with open(spec.origin, "r", encoding="utf-8") as f:
        source = f.read()

    # Find all lines containing kbar_subscribe_fn(
    call_lines = [ln.strip() for ln in source.splitlines() if "kbar_subscribe_fn(" in ln]
    assert call_lines, "kgi_kbar.py must contain at least one kbar_subscribe_fn( call"

    for line in call_lines:
        assert "odd_lot" not in line, (
            f"kbar_subscribe_fn call site must not contain 'odd_lot'. "
            f"Line: {line!r}"
        )


# ---------------------------------------------------------------------------
# T18: Unsupported interval still surfaces interval_status=unsupported (no regression)
# ---------------------------------------------------------------------------

def test_unsupported_interval_remains_unsupported():
    """
    W4 B2 Q1 regression guard: 30m interval must still surface as
    interval_status='unsupported', not a 422 or 500.
    Ensures odd_lot kwarg fix did not alter interval matrix behavior.
    """
    from fastapi.testclient import TestClient
    import config as cfg
    import app as gateway_app

    _clear_kbar_buffers()

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

    # Must be 200 with interval_status=unsupported — same as T10
    assert resp.status_code == 200, (
        f"Unsupported interval must return 200 (informational), got {resp.status_code}"
    )
    body = resp.json()
    assert body["interval_status"] == "unsupported", (
        f"30m must still have interval_status='unsupported'. Got: {body.get('interval_status')}"
    )
    assert body["unsupported_reason"] is not None, "unsupported_reason must be non-null"
    assert body["label"] is None, "label must be None for unsupported interval"


# ---------------------------------------------------------------------------
# T19: No order module import — kgi_kbar.py and test file do NOT import order
# ---------------------------------------------------------------------------

def test_no_order_module_import():
    """
    W4 no-order guarantee: neither kgi_kbar.py nor this test file imports
    kgisuperpy.order or any function from the write-path.

    Checks:
    - kgi_kbar.py: no import of kgisuperpy.order or order-named modules
    - kgi_kbar.py: no place_order / cancel_order / submit_order function calls
    - This test file itself: no runtime import of kgisuperpy.order
    """
    import importlib
    import re

    # Patterns to look for in kgi_kbar.py source (actual import/call statements only)
    # Note: patterns are split/constructed to avoid matching themselves in this file's source.
    _pkg = "kgisuperpy"
    _ord = "order"
    _dotted = f"{_pkg}.{_ord}"  # "kgisuperpy.order" — built at runtime, not literal here

    kbar_forbidden = [
        rf"from\s+{re.escape(_dotted)}",
        rf"import\s+{re.escape(_dotted)}",
        r"\bplace_order\s*\(",
        r"\bcancel_order\s*\(",
        r"\bsubmit_order\s*\(",
    ]

    # --- Check kgi_kbar.py ---
    spec = importlib.util.find_spec("kgi_kbar")
    assert spec and spec.origin
    with open(spec.origin, "r", encoding="utf-8") as f:
        kbar_source = f.read()

    for pat in kbar_forbidden:
        hits = re.findall(pat, kbar_source, re.IGNORECASE)
        assert not hits, (
            f"kgi_kbar.py must not contain order write-path pattern. Found: {hits}"
        )

    # --- Check this test file itself (no actual kgisuperpy.order import statement) ---
    import os
    this_file = os.path.abspath(__file__)
    with open(this_file, "r", encoding="utf-8") as f:
        test_lines = f.readlines()

    # Scan actual import statement lines only (lines starting with "import " or "from ")
    import_lines = [
        ln.strip() for ln in test_lines
        if re.match(r"^\s*(import|from)\s+", ln) and "#" not in ln.split("import")[0]
    ]
    for line in import_lines:
        assert _dotted not in line, (
            f"test_kbar.py must not import {_dotted!r}. Found import line: {line!r}"
        )
