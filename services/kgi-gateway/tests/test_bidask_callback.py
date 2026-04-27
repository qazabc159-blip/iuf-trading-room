"""
tests/test_bidask_callback.py — W2c unit tests for bidask callback + subscribe_bidask fix.

Root cause addressed: kgi_quote.py used `set_cb_bid_ask` (non-existent) instead of
`set_cb_bidask` (correct kgisuperpy 2.0.3 method name). That caused getattr to return
None → NotImplementedError always raised → 501 stub on every subscribe attempt.

Tests:
  T1: bidask callback appends to buffer (_write_bidask_to_buffer → get_latest_bidask)
  T2: bidask buffer overwrites (latest-snapshot semantics)
  T3: get_latest_bidask for unknown symbol returns None
  T4: subscribe_bidask with correct SDK mock → returns label + registers symbol
  T5: subscribe_bidask with missing set_cb_bidask → raises NotImplementedError (regression guard)

Runs without kgisuperpy installed (monkeypatches the stub).
Run: PYTHONUTF8=1 python -m pytest tests/test_bidask_callback.py -v
"""

from __future__ import annotations

import sys
import types
from unittest.mock import MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# Minimal kgisuperpy stub — mirrors test_quote_ring_buffer.py pattern
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

# Safe to import after stub
import kgi_quote as kq  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _clear_buffers():
    """Reset all module-level buffers between tests."""
    with kq._BUFFER_LOCK:
        kq._TICK_BUFFER.clear()
        kq._BIDASK_LATEST.clear()
        kq._TICK_SUBSCRIBED.clear()
        kq._BIDASK_SUBSCRIBED.clear()


def _sample_bidask_dict(symbol: str = "2330") -> dict:
    return {
        "exchange": "TWSE",
        "symbol": symbol,
        "delay_time": 0.0,
        "odd_lot": False,
        "datetime": "2026-04-27T09:01:00",
        "bid_prices": [580.0, 579.0, 578.0, 577.0, 576.0],
        "bid_volumes": [100, 200, 300, 400, 500],
        "ask_prices": [581.0, 582.0, 583.0, 584.0, 585.0],
        "ask_volumes": [150, 250, 350, 450, 550],
        "diff_bid_vol": [0, 0, 0, 0, 0],
        "diff_ask_vol": [0, 0, 0, 0, 0],
        "simtrade": 0,
        "suspend": 0,
    }


# ---------------------------------------------------------------------------
# T1: bidask callback appends to buffer
# ---------------------------------------------------------------------------

def test_bidask_callback_appends_to_buffer():
    """_write_bidask_to_buffer stores data; get_latest_bidask retrieves it."""
    _clear_buffers()
    symbol = "2330"
    data = _sample_bidask_dict(symbol)
    kq._write_bidask_to_buffer(symbol, data)
    result = kq.get_latest_bidask(symbol)
    assert result is not None, "Expected non-None after write"
    assert result["symbol"] == symbol
    assert result["bid_prices"] == data["bid_prices"]
    assert result["ask_prices"] == data["ask_prices"]
    assert "_received_at" in result, "Expected _received_at timestamp injected"


# ---------------------------------------------------------------------------
# T2: bidask buffer overwrites (latest-snapshot semantics)
# ---------------------------------------------------------------------------

def test_bidask_buffer_overwrite():
    """Writing bidask twice for same symbol: second replaces first."""
    _clear_buffers()
    symbol = "0050"
    first = _sample_bidask_dict(symbol)
    first["bid_prices"] = [100.0, 99.0, 98.0, 97.0, 96.0]

    second = _sample_bidask_dict(symbol)
    second["bid_prices"] = [101.0, 100.0, 99.0, 98.0, 97.0]

    kq._write_bidask_to_buffer(symbol, first)
    kq._write_bidask_to_buffer(symbol, second)

    result = kq.get_latest_bidask(symbol)
    assert result is not None
    assert result["bid_prices"][0] == 101.0, (
        f"Expected second write (101.0) to replace first (100.0), got: {result['bid_prices']}"
    )


# ---------------------------------------------------------------------------
# T3: get_latest_bidask for unknown symbol returns None
# ---------------------------------------------------------------------------

def test_get_latest_bidask_unknown_symbol_returns_none():
    """Symbol never written to buffer → get_latest_bidask returns None."""
    _clear_buffers()
    result = kq.get_latest_bidask("9999_NEVER_SEEN")
    assert result is None, f"Expected None for unknown symbol, got: {result}"


# ---------------------------------------------------------------------------
# T4: subscribe_bidask with correct SDK mock → registers symbol, returns label
# ---------------------------------------------------------------------------

def test_subscribe_bidask_with_correct_sdk_mock():
    """
    W2c regression guard (positive path):
    SDK mock has both `subscribe_bidask` AND `set_cb_bidask` (correct name).
    subscribe_bidask() should succeed: return label + register in _BIDASK_SUBSCRIBED.

    This test would FAIL on the pre-W2c code (which checked `set_cb_bid_ask`).
    """
    _clear_buffers()
    symbol = "2330"

    # Build a mock api.Quote with the correct method names
    mock_quote = MagicMock()
    mock_quote.subscribe_bidask = MagicMock(return_value="bidask_label_2330")
    mock_quote.set_cb_bidask = MagicMock(return_value=None)  # correct name

    mock_api = MagicMock()
    mock_api.Quote = mock_quote

    manager = kq.KgiQuoteManager()
    label = manager.subscribe_bidask(mock_api, symbol, odd_lot=False)

    assert label == "bidask_label_2330", f"Expected label 'bidask_label_2330', got: {label!r}"
    assert symbol in kq._BIDASK_SUBSCRIBED, (
        f"Expected '{symbol}' in _BIDASK_SUBSCRIBED, got: {kq._BIDASK_SUBSCRIBED}"
    )
    mock_quote.set_cb_bidask.assert_called_once()
    mock_quote.subscribe_bidask.assert_called_once_with(symbol, odd_lot=False, version="v1")


# ---------------------------------------------------------------------------
# T5: subscribe_bidask with missing set_cb_bidask → NotImplementedError
# ---------------------------------------------------------------------------

def test_subscribe_bidask_raises_when_set_cb_bidask_missing():
    """
    W2c regression guard (negative path):
    If SDK does NOT have set_cb_bidask, NotImplementedError must be raised.
    This ensures future SDK downgrades are caught at subscribe time (not silently ignored).
    """
    _clear_buffers()
    symbol = "2330"

    # Build a mock api.Quote with subscribe_bidask but NO set_cb_bidask
    mock_quote = MagicMock(spec=[])  # spec=[] means only explicitly set attrs exist
    mock_quote.subscribe_bidask = MagicMock(return_value="label_ok")
    # set_cb_bidask intentionally NOT added to mock — getattr will return None via spec

    mock_api = MagicMock()
    mock_api.Quote = mock_quote

    manager = kq.KgiQuoteManager()
    with pytest.raises(NotImplementedError) as exc_info:
        manager.subscribe_bidask(mock_api, symbol)

    assert "set_cb_bidask" in str(exc_info.value), (
        f"Expected error message to mention set_cb_bidask, got: {exc_info.value}"
    )
    assert symbol not in kq._BIDASK_SUBSCRIBED, (
        f"Symbol should NOT be registered when NotImplementedError raised"
    )
